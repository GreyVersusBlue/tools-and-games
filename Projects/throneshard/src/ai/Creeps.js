import * as THREE from 'three';
import { TEAM, enemyOf, CREEP_WAVE_INTERVAL, FIRST_WAVE_TIME, du } from '../core/constants.js';
import { CREEP_STATS, SUPER_CREEP, MEGA_CREEP } from './AIDefs.js';
import { LANE_PATHS } from './LanePath.js';

const TEAMS = [TEAM.SUNWARD, TEAM.DUSKWARD];
const LANES = ['top', 'mid', 'bot'];
const LEASH = du(900); // max lateral distance from the lane a creep will chase before giving up
const AGGRO_DURATION = 2.3;

// Lane creep brain: walk the lane, fight the nearest enemy (creeps > structures > heroes), hero-aggro,
// leash back to the lane, anti-stuck.
export class CreepController {
  constructor(director, lane, team) {
    this.d = director;
    this.game = director.game;
    this.lane = lane;
    this.path = LANE_PATHS[team][lane];
    this.t = Math.random() * 0.25;
    this.stuckT = 0;
    this.lastPos = null;
    this.progressBoost = 0;
  }

  update(unit, dt) {
    this.t -= dt;
    if (this.t > 0) return;
    const step = 0.25 - this.t;
    this.t = 0.25;
    const g = this.game;
    const proj = this.path.project(unit.position.x, unit.position.z);
    const cur = unit.order.type === 'attack' ? unit.order.target : null;
    const valid = (u) => u && unit.canAttack(u);

    // 1) Hero-aggro override (enemy hero attacked an allied hero near us)
    const ag = unit.data.aggroTarget;
    if (ag && g.time < unit.data.aggroUntil && valid(ag) && unit.distanceTo(ag) < unit.getStat('acquireRange') * 1.4 && proj.dist < LEASH) {
      if (cur !== ag) unit.issueOrder({ type: 'attack', target: ag });
      return;
    }
    unit.data.aggroTarget = null;

    // 2) Keep current target while it is valid and we are not leashed
    if (cur && valid(cur) && proj.dist < LEASH) {
      const keepR = unit.getStat('acquireRange') * 1.3 + unit.getStat('attackRange');
      if (unit.distanceTo(cur) < keepR && !(cur.kind === 'hero' && this.betterNonHero(unit))) return;
    }

    // 3) Acquire
    const target = proj.dist < LEASH ? this.pickTarget(unit) : null;
    if (target) {
      if (cur !== target) unit.issueOrder({ type: 'attack', target });
      this.stuckT = 0;
      return;
    }

    // 4) Walk the lane (toward next waypoint; if pulled off-lane, rejoin at the projection first)
    let dest;
    if (proj.dist > 5) {
      const p = this.path.pointAt(proj.s + 4);
      dest = new THREE.Vector3(p.x, 0, p.z);
    } else {
      const next = this.path.points[Math.min(proj.seg + 1, this.path.points.length - 1)];
      const nearEnd = proj.s > this.path.length - 1;
      if (nearEnd) {
        // At the enemy base end: attack-move into the base (throneshard) — acquisition above handles targets
        const anc = this.d.structures.throneshard[enemyOf(unit.team)];
        dest = anc ? anc.position.clone() : new THREE.Vector3(next.x, 0, next.z);
      } else dest = new THREE.Vector3(next.x, 0, next.z);
      // Skip ahead if we're hugging a corner waypoint
      if (Math.hypot(dest.x - unit.position.x, dest.z - unit.position.z) < 2.5 && proj.seg + 2 < this.path.points.length) {
        const n2 = this.path.points[proj.seg + 2];
        dest.set(n2.x, 0, n2.z);
      }
    }
    // Anti-stuck: no progress while trying to move → nudge sideways / skip ahead
    if (this.lastPos && unit.position.distanceTo(this.lastPos) < 0.15 * step * unit.getStat('moveSpeed')) {
      this.stuckT += step;
    } else this.stuckT = Math.max(0, this.stuckT - step);
    this.lastPos = (this.lastPos ?? new THREE.Vector3()).copy(unit.position);
    if (this.stuckT > 2) {
      this.stuckT = 0;
      const p = this.path.pointAt(proj.s + 10 + Math.random() * 6);
      dest = new THREE.Vector3(p.x + (Math.random() - 0.5) * 6, 0, p.z + (Math.random() - 0.5) * 6);
      unit.issueOrder({ type: 'move', point: dest });
      return;
    }
    const o = unit.order;
    if (o.type !== 'move' || o.point.distanceToSquared(dest) > 1) unit.issueOrder({ type: 'move', point: dest });
  }

  betterNonHero(unit) {
    const t = this.pickTarget(unit, true);
    return !!t;
  }

  pickTarget(unit, nonHeroOnly = false) {
    const g = this.game;
    const acq = unit.getStat('acquireRange');
    let best = null, bestS = Infinity;
    for (const u of g.unitsInRadius(unit.position, acq + 3)) {
      if (u.team === unit.team || !unit.canAttack(u) || u.kind === 'ward') continue;
      // Ignore neutrals / Grimmaw unless they attacked us recently
      if ((u.kind === 'neutral' || u.kind === 'grimmaw') && !(unit.lastAttacker === u && g.time - unit.lastDamagedTime < 3)) continue;
      if (nonHeroOnly && u.kind === 'hero') continue;
      const d = unit.edgeDistanceTo(u);
      if (d > acq) continue;
      let s = d;
      if (u.kind === 'hero') s += 10; // creeps prefer other creeps / summons
      else if (u.isStructure) s += 2.5;
      if (s < bestS) { bestS = s; best = u; }
    }
    return best;
  }
}

// Spawns creep waves, applies upgrades, super/mega creeps, and handles hero-aggro events.
export class CreepWaves {
  constructor(director) {
    this.d = director;
    this.game = director.game;
    this.nextWave = FIRST_WAVE_TIME;
    this.waveIndex = 0;
    this.creeps = new Set();
    this.superLanes = { sunward: {}, duskward: {} }; // team -> { `${lane}_${kind}`: true } (this team's creeps are super)
    this.mega = { sunward: false, duskward: false };
    this.enabled = true;
  }

  onMatchStart() {
    this.nextWave = FIRST_WAVE_TIME;
    this.waveIndex = 0;
  }

  update() {
    if (!this.enabled) return;
    const g = this.game;
    let guard = 0;
    while (g.time >= this.nextWave && guard++ < 3) {
      this.spawnWave();
      this.nextWave += CREEP_WAVE_INTERVAL;
    }
  }

  spawnWave() {
    const g = this.game;
    this.waveIndex++;
    const min = Math.max(0, g.time / 60);
    const melee = 3 + (min >= 15 ? 1 : 0) + (min >= 45 ? 1 : 0);
    const ranged = 1 + (min >= 30 ? 1 : 0);
    const siege = this.waveIndex % 5 === 0 ? 1 + (min >= 35 ? 1 : 0) : 0;
    const upg = Math.floor(min / 7.5);
    for (const team of TEAMS) {
      for (const lane of LANES) {
        const types = [...Array(melee).fill('melee'), ...Array(ranged).fill('ranged'), ...Array(siege).fill('siege')];
        types.forEach((type, i) => this.spawnCreep(team, lane, type, i, upg));
      }
    }
    g.bus.emit('wave:spawn', { index: this.waveIndex, time: g.time });
  }

  spawnCreep(team, lane, type, i, upg) {
    const g = this.game;
    const path = LANE_PATHS[team][lane];
    const isSuper = this.mega[team] || this.superLanes[team][`${lane}_${type === 'siege' ? 'melee' : type}`];
    const over = this.mega[team] ? MEGA_CREEP[type] : isSuper ? SUPER_CREEP[type] : null;
    const stats = { ...CREEP_STATS[type], ...(over ?? {}) };
    // Slow upgrades over time (every 7.5 minutes)
    const hpMul = 1 + 0.06 * upg, dmgMul = 1 + 0.08 * upg;
    stats.maxHp = Math.round(stats.maxHp * hpMul);
    stats.damageMin = Math.round(stats.damageMin * dmgMul);
    stats.damageMax = Math.round(stats.damageMax * dmgMul);
    stats.bountyGold = [stats.bountyGold[0] + upg, stats.bountyGold[1] + upg];
    // Formation: melee in front, ranged/siege behind, spread laterally
    const dir = path.dirAt(2);
    const row = type === 'melee' ? 0 : type === 'ranged' ? 1 : 2;
    const lat = (i % 3 - 1) * 1.4;
    const p0 = path.pointAt(2);
    const pos = new THREE.Vector3(p0.x - dir.x * row * 1.8 - dir.z * lat, 0, p0.z - dir.z * row * 1.8 + dir.x * lat);
    const tname = team === TEAM.SUNWARD ? 'Sunward' : 'Duskward';
    const label = type === 'melee' ? 'Melee' : type === 'ranged' ? 'Ranged' : 'Siege';
    const u = g.spawnUnit({
      kind: 'creep', subtype: type, team, lane, name: `${tname} ${this.mega[team] ? 'Mega ' : isSuper ? 'Super ' : ''}${label} Creep`,
      position: pos, modelKind: `creep_${type}`, facing: Math.atan2(dir.x, dir.z), stats,
      data: { super: !!isSuper, mega: !!this.mega[team], projectileKind: `creep_${type}` },
    });
    u.controller = new CreepController(this.d, lane, team);
    this.creeps.add(u);
    return u;
  }

  onBarracksDestroyed(rax) {
    // The *other* team's creeps in that lane become super
    const team = enemyOf(rax.team);
    this.superLanes[team][`${rax.lane}_${rax.data.raxKind}`] = true;
    const allDead = this.d.structures.barracks[rax.team].every((r) => !r.alive);
    if (allDead) {
      this.mega[team] = true;
      this.game.bus.emit('ui:message', { text: `${team === TEAM.SUNWARD ? 'Sunward' : 'Duskward'} now has Mega Creeps!`, color: '#ffcc33' });
    }
  }

  onUnitDied(u) { this.creeps.delete(u); }

  // Enemy hero attacked an allied hero: nearby creeps of the victim's team switch to the attacker.
  onHeroAttack(attacker, victim) {
    const g = this.game;
    for (const c of g.unitsInRadius(attacker.position, du(500), (u) => u.kind === 'creep' && u.team === victim.team)) {
      c.data.aggroTarget = attacker;
      c.data.aggroUntil = g.time + AGGRO_DURATION;
    }
  }

  laneCreeps(team, lane) {
    const out = [];
    for (const c of this.creeps) if (c.alive && c.team === team && c.lane === lane) out.push(c);
    return out;
  }
}
