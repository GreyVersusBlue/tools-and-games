import * as THREE from 'three';
import { TOWERS, BARRACKS, THRONESHARD, FOUNTAIN, SHOPS, TEAM, enemyOf, du } from '../core/constants.js';
import { TOWER_STATS, TOWER_COMMON, BARRACKS_STATS, THRONESHARD_STATS, FOUNTAIN_STATS } from './AIDefs.js';

const TEAMS = [TEAM.SUNWARD, TEAM.DUSKWARD];
const BACKDOOR_RANGE = du(900);

// Tower / fountain targeting brain. Keeps its target until it dies or leaves range; switches to an enemy hero
// that attacks an allied hero inside its range (tower aggro).
export class StructureController {
  constructor(director) {
    this.d = director;
    this.t = Math.random() * 0.2;
  }
  update(unit, dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    const range = unit.getStat('attackRange');
    const cur = unit.order.type === 'attack' ? unit.order.target : null;
    const inRange = (u) => unit.canAttack(u) && unit.edgeDistanceTo(u) <= range + 0.3;
    // Hero aggro: an enemy hero attacked one of our heroes recently, both in range
    const aggro = this.d.heroAggroFor(unit.team, unit.position, range + 2);
    if (aggro && inRange(aggro) && cur !== aggro) {
      unit.issueOrder({ type: 'attack', target: aggro });
      return;
    }
    if (cur && inRange(cur)) return;
    // Acquire: nearest enemy, non-heroes preferred (bias) — creeps usually tank towers.
    let best = null, bestScore = Infinity;
    for (const u of this.d.game.unitsInRadius(unit.position, range + 4)) {
      if (!inRange(u) || u.kind === 'ward') continue;
      let s = unit.edgeDistanceTo(u);
      if (u.kind === 'hero') s += 6;
      if (u.kind === 'tower' || u.kind === 'building') s += 20;
      if (s < bestScore) { bestScore = s; best = u; }
    }
    if (best) unit.issueOrder({ type: 'attack', target: best });
    else if (unit.order.type !== 'idle' && unit.order.type !== 'hold') unit.issueOrder({ type: 'hold' });
  }
}

// Spawns and manages towers, barracks, throneshards, fountains and shop decorations. Handles tier protection.
export class Structures {
  constructor(director) {
    this.d = director;
    this.game = director.game;
    this.towers = { sunward: [], duskward: [] };
    this.barracks = { sunward: [], duskward: [] };
    this.throneshard = { sunward: null, duskward: null };
    this.fountain = { sunward: null, duskward: null };
    this.all = [];
    this.decor = [];
  }

  spawnAll() {
    const g = this.game;
    for (const team of TEAMS) {
      const enemyAnc = THRONESHARD[enemyOf(team)];
      const faceTo = (x, z) => Math.atan2(enemyAnc[0] - x, enemyAnc[1] - z);
      for (const t of TOWERS[team]) {
        const [x, z] = t.pos;
        const u = g.spawnUnit({
          kind: 'tower', subtype: t.tier, team, lane: t.lane, name: `Tier ${t.tier} Tower`,
          position: new THREE.Vector3(x, 0, z), modelKind: 'tower', facing: faceTo(x, z),
          stats: { ...TOWER_COMMON, ...TOWER_STATS[t.tier] },
          data: { tier: t.tier, projectileKind: 'tower' },
        });
        u.controller = new StructureController(this.d);
        this.towers[team].push(u);
        this.register(u);
      }
      for (const b of BARRACKS[team]) {
        const [x, z] = b.pos;
        const u = g.spawnUnit({
          kind: 'building', subtype: `barracks_${b.kind}`, team, lane: b.lane,
          name: b.kind === 'melee' ? 'Melee Barracks' : 'Ranged Barracks',
          position: new THREE.Vector3(x, 0, z), modelKind: `barracks_${b.kind}`, facing: faceTo(x, z),
          stats: { ...BARRACKS_STATS[b.kind] }, data: { raxKind: b.kind },
        });
        this.barracks[team].push(u);
        this.register(u);
      }
      {
        const [x, z] = THRONESHARD[team];
        const u = g.spawnUnit({
          kind: 'building', subtype: 'throneshard', team, name: team === TEAM.SUNWARD ? 'Sunward Throneshard' : 'Duskward Throneshard',
          position: new THREE.Vector3(x, 0, z), modelKind: 'throneshard', facing: faceTo(x, z), stats: { ...THRONESHARD_STATS },
        });
        this.throneshard[team] = u;
        this.register(u);
      }
      {
        const [x, z] = FOUNTAIN[team];
        const u = g.spawnUnit({
          kind: 'building', subtype: 'fountain', team, name: 'Fountain', invulnerable: true,
          position: new THREE.Vector3(x, 0, z), modelKind: 'fountain', facing: faceTo(x, z), stats: { ...FOUNTAIN_STATS },
          data: { projectileKind: 'fountain' },
        });
        u.controller = new StructureController(this.d);
        this.fountain[team] = u; // not blocked: heroes (re)spawn on top of it
      }
    }
    // Decorative shops (not units)
    const shopSpots = [
      { pos: SHOPS.sunward, team: TEAM.SUNWARD }, { pos: SHOPS.duskward, team: TEAM.DUSKWARD },
      ...SHOPS.secret.map((p) => ({ pos: p, team: TEAM.NEUTRAL, secret: true })),
    ];
    for (const s of shopSpots) {
      try {
        const model = g.models?.create?.('shop', { team: s.team, secret: !!s.secret });
        if (!model?.root) continue;
        const obj = new THREE.Group();
        obj.add(model.root);
        const y = g.world?.getHeight?.(s.pos[0], s.pos[1]) ?? 0;
        obj.position.set(s.pos[0], y, s.pos[1]);
        obj.rotation.y = Math.atan2(-s.pos[0], -s.pos[1]); // face the map centre
        obj.userData.shop = s;
        g.scene.add(obj);
        this.decor.push({ obj, model });
        g.world?.blockCircle?.(s.pos[0], s.pos[1], 1.6);
      } catch (e) { console.warn('[ai] shop model failed', e); }
    }
    this.updateProtection();
  }

  register(u) {
    this.all.push(u);
    this.block(u);
    // Backdoor protection: structures take 40% less damage when no enemy creeps are nearby.
    const game = this.game;
    let cacheT = -1, cacheV = false;
    u.addModifier({
      id: 'backdoor_protection', name: 'Backdoor Protection', hidden: true, duration: Infinity,
      onDamageTaken: (unit, info) => {
        if (game.time - cacheT > 0.5) {
          cacheT = game.time;
          cacheV = game.unitsInRadius(unit.position, BACKDOOR_RANGE, (o) => o.kind === 'creep' && o.team !== unit.team).length > 0;
        }
        if (!cacheV) info.amount *= 0.6;
      },
    });
  }

  block(u) {
    try { this.game.world?.blockCircle?.(u.position.x, u.position.z, u.radius * 0.9); } catch (e) { /* ignore */ }
  }

  onStructureDied(u) {
    try { this.game.world?.unblockCircle?.(u.position.x, u.position.z, u.radius * 0.9); } catch (e) { /* ignore */ }
    this.updateProtection();
    if (u.kind === 'building' && u.subtype?.startsWith?.('barracks')) this.d.creeps?.onBarracksDestroyed(u);
  }

  towerAlive(team, lane, tier) {
    return this.towers[team].some((t) => t.alive && t.lane === lane && t.data.tier === tier);
  }

  updateProtection() {
    for (const team of TEAMS) {
      const towers = this.towers[team];
      for (const t of towers) {
        if (!t.alive) continue;
        const tier = t.data.tier;
        if (tier === 1) t.invulnerable = false;
        else if (tier <= 3) t.invulnerable = this.towerAlive(team, t.lane, tier - 1);
      }
      const anyT3Dead = ['top', 'mid', 'bot'].some((l) => !this.towerAlive(team, l, 3));
      for (const t of towers) if (t.alive && t.data.tier === 4) t.invulnerable = !anyT3Dead;
      for (const r of this.barracks[team]) if (r.alive) r.invulnerable = this.towerAlive(team, r.lane, 3);
      const t4Alive = towers.some((t) => t.alive && t.data.tier === 4);
      const anc = this.throneshard[team];
      if (anc?.alive) anc.invulnerable = t4Alive;
    }
  }

  // Outermost alive tower (lowest tier) of a team in a lane; null if none
  frontTower(team, lane) {
    let best = null;
    for (const t of this.towers[team]) if (t.alive && t.lane === lane && (!best || t.data.tier < best.data.tier)) best = t;
    return best;
  }

  // Next attackable enemy structure for `team` pushing `lane` (tower → rax → T4 → throneshard)
  nextTarget(team, lane) {
    const e = enemyOf(team);
    const ft = this.frontTower(e, lane);
    if (ft) return ft;
    const rax = this.barracks[e].filter((r) => r.alive && r.lane === lane);
    if (rax.length) return rax.find((r) => r.data.raxKind === 'melee') ?? rax[0];
    const t4 = this.towers[e].filter((t) => t.alive && t.data.tier === 4);
    if (t4.length) return t4[0];
    const anc = this.throneshard[e];
    return anc?.alive ? anc : null;
  }

  aliveStructures(team) { return this.all.filter((u) => u.alive && u.team === team); }

  update() {
    for (const d of this.decor) d.model?.update?.(0.016);
  }
}
