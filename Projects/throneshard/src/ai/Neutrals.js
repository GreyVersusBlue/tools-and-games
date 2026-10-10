import * as THREE from 'three';
import { TEAM, NEUTRAL_CAMPS, GRIMMAW_LAIR, NEUTRAL_RESPAWN_INTERVAL, du } from '../core/constants.js';
import { CAMP_DEFS, GRIMMAW_STATS } from './AIDefs.js';

const FIRST_SPAWN = 60;

// Neutral creep brain: idle at the camp, fight back when attacked (whole camp aggroes), leash back & regen.
export class NeutralController {
  constructor(director, camp, home, leash = du(650)) {
    this.d = director;
    this.game = director.game;
    this.camp = camp;
    this.home = home; // Vector3
    this.leash = leash;
    this.returning = false;
    this.t = Math.random() * 0.25;
  }
  update(unit, dt) {
    const g = this.game;
    if (this.returning) {
      // Regenerate quickly while walking home (leash reset)
      unit.heal(unit.getStat('maxHp') * 0.08 * dt);
    }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const dHome = unit.distanceTo(this.home);
    if (this.returning) {
      if (dHome < 1.2) {
        this.returning = false;
        unit.issueOrder({ type: 'idle' });
        unit.facing = Math.random() * Math.PI * 2;
      } else if (unit.order.type !== 'move') unit.issueOrder({ type: 'move', point: this.home });
      return;
    }
    if (dHome > this.leash) { this.goHome(unit); return; }
    // Aggro: whoever attacked us or our campmates recently
    let target = null;
    if (unit.lastAttacker && g.time - unit.lastDamagedTime < 4 && unit.canAttack(unit.lastAttacker)) target = unit.lastAttacker;
    else if (this.camp && this.camp.aggro && g.time - this.camp.aggroTime < 4 && unit.canAttack(this.camp.aggro)) target = this.camp.aggro;
    const cur = unit.order.type === 'attack' ? unit.order.target : null;
    if (cur && unit.canAttack(cur) && cur.distanceTo(this.home) < this.leash + 2) {
      if (target && target !== cur && target.kind === 'hero' && cur.kind !== 'hero') unit.issueOrder({ type: 'attack', target });
      return;
    }
    if (target && target.distanceTo(this.home) < this.leash + 2) {
      if (this.camp) { this.camp.aggro = target; this.camp.aggroTime = g.time; }
      unit.issueOrder({ type: 'attack', target });
      return;
    }
    if (dHome > 1.5) this.goHome(unit);
    else if (unit.order.type !== 'idle') unit.issueOrder({ type: 'idle' });
  }
  goHome(unit) {
    this.returning = true;
    unit.issueOrder({ type: 'move', point: this.home });
  }
}

// Grimmaw brain: neutral-style leash to the pit + bash (on the unit) + periodic slam.
class GrimmawController extends NeutralController {
  constructor(director, home) {
    super(director, null, home, 11);
    this.slamCd = 6;
  }
  update(unit, dt) {
    this.slamCd -= dt;
    super.update(unit, dt);
    if (this.slamCd > 0 || !unit.alive || this.returning) return;
    const g = this.game;
    const r = du(350);
    const foes = g.unitsInRadius(unit.position, r + 1, (u) => u.team !== unit.team && !u.isInvulnerable && (u.kind === 'hero' || u.kind === 'summon'));
    if (foes.length >= 2 || (foes.length && unit.healthPct < 0.8)) {
      this.slamCd = 10;
      const min = Math.max(0, g.time / 60);
      unit.playAnim('cast', { once: true });
      g.vfx?.spawn?.('explosion', { position: unit.position.clone(), radius: r, color: 0xffaa55, duration: 0.8 });
      g.audio?.play?.('grimmaw_slam', { position: unit.position });
      for (const f of foes) {
        f.takeDamage(70 + min * 4, 'magical', unit, { ability: { def: { id: 'grimmaw_slam', name: 'Slam' } } });
        f.addModifier?.({ id: 'grimmaw_slam_slow', name: 'Slam', icon: '🪨', debuff: true, duration: 2, slow: 0.4 });
      }
    }
  }
}

export class Neutrals {
  constructor(director) {
    this.d = director;
    this.game = director.game;
    this.camps = NEUTRAL_CAMPS.map((c, i) => ({
      index: i, kind: c.kind, pos: new THREE.Vector3(c.pos[0], 0, c.pos[1]),
      side: c.pos[0] < c.pos[1] ? TEAM.SUNWARD : TEAM.DUSKWARD, units: [], aggro: null, aggroTime: -99,
    }));
    this.nextSpawn = FIRST_SPAWN;
    this.grimmaw = null;
    this.grimmawRespawnAt = 0;
    this.grimmawKills = 0;
    this.lanternHolder = null;
  }

  onMatchStart() {
    this.nextSpawn = FIRST_SPAWN;
    this.spawnGrimmaw();
  }

  update() {
    const g = this.game;
    if (g.time >= this.nextSpawn) {
      this.nextSpawn += NEUTRAL_RESPAWN_INTERVAL;
      for (const c of this.camps) if (this.campEmpty(c)) this.spawnCamp(c);
    }
    if (!this.grimmaw?.alive && this.grimmawRespawnAt && g.time >= this.grimmawRespawnAt) {
      this.grimmawRespawnAt = 0;
      this.spawnGrimmaw();
    }
  }

  campEmpty(c) {
    c.units = c.units.filter((u) => u.alive);
    if (c.units.length) return false;
    // Spawn box: blocked if heroes/creeps stand in the camp
    return this.game.unitsInRadius(c.pos, 4, (u) => u.kind === 'hero' || u.kind === 'creep' || u.kind === 'ward').length === 0;
  }

  spawnCamp(c) {
    const g = this.game;
    const defs = CAMP_DEFS[c.kind] ?? CAMP_DEFS.small;
    const min = Math.max(0, g.time / 60);
    const scale = 1 + Math.min(0.6, min * 0.012); // neutrals grow slightly tougher
    defs.forEach((def, i) => {
      const a = (i / defs.length) * Math.PI * 2 + c.index;
      const home = new THREE.Vector3(c.pos.x + Math.cos(a) * 1.8, 0, c.pos.z + Math.sin(a) * 1.8);
      const stats = { ...def.stats, maxHp: Math.round(def.stats.maxHp * scale) };
      const u = g.spawnUnit({
        kind: 'neutral', subtype: c.kind, team: TEAM.NEUTRAL, name: def.name, position: home,
        modelKind: `neutral_${c.kind}`, facing: Math.random() * Math.PI * 2, stats,
        data: { camp: c.index, leader: i === 0, projectileKind: `neutral_${c.kind}` },
      });
      u.controller = new NeutralController(this.d, c, home);
      c.units.push(u);
    });
    g.vfx?.spawn?.('spawn', { position: c.pos.clone(), radius: 3 });
  }

  aliveCampUnits(c) { return c.units.filter((u) => u.alive); }

  spawnGrimmaw() {
    const g = this.game;
    const min = Math.max(0, g.time / 60);
    const stats = {
      ...GRIMMAW_STATS,
      maxHp: Math.round(GRIMMAW_STATS.maxHp + 130 * min),
      damageMin: GRIMMAW_STATS.damageMin + 5 * min, damageMax: GRIMMAW_STATS.damageMax + 5 * min,
      armor: GRIMMAW_STATS.armor + 0.3 * min,
    };
    const home = new THREE.Vector3(GRIMMAW_LAIR[0], 0, GRIMMAW_LAIR[1]);
    const u = g.spawnUnit({
      kind: 'grimmaw', subtype: 'grimmaw', team: TEAM.NEUTRAL, name: 'Grimmaw', position: home, modelKind: 'grimmaw',
      facing: Math.PI * 0.25, stats, data: { projectileKind: 'grimmaw' },
    });
    u.controller = new GrimmawController(this.d, home);
    this.applyBash(u);
    this.grimmaw = u;
    g.bus.emit('grimmaw:spawned', { unit: u });
  }

  applyBash(u) {
    const g = this.game;
    u.addModifier({
      id: 'grimmaw_bash', name: 'Bash', icon: '🔨', duration: Infinity, hidden: true,
      onAttackLanded: (src, target) => {
        if (!target?.alive || target.isStructure || Math.random() > 0.15) return;
        target.addModifier({ id: 'bashed', name: 'Bashed', icon: '💫', debuff: true, stun: true, duration: 1.65 });
        target.takeDamage(50, 'magical', src, { ability: { def: { id: 'grimmaw_bash', name: 'Bash' } } });
        g.vfx?.spawn?.('stun', { unit: target, position: target.position.clone(), duration: 1.65 });
      },
    });
  }

  onGrimmawDied(u, killer) {
    const g = this.game;
    this.grimmawKills++;
    this.grimmawRespawnAt = g.time + 480 + Math.random() * 180;
    const killerHero = killer?.kind === 'hero' ? killer : killer?.owner?.kind === 'hero' ? killer.owner : null;
    const team = killerHero?.team ?? killer?.team ?? null;
    // Team bounty on top of the killer's last-hit bounty (Rules)
    if (team && team !== TEAM.NEUTRAL) for (const h of g.heroes) if (h.team === team) h.addGold(150, 'grimmaw');
    // The Lantern goes to the killer (or the nearest hero of the killing team)
    let holder = killerHero;
    if (!holder && team) {
      let best = Infinity;
      for (const h of g.heroes) if (h.alive && h.team === team && h.distanceTo(u) < best) { best = h.distanceTo(u); holder = h; }
    }
    if (holder) this.giveLantern(holder);
    g.bus.emit('grimmaw:killed', { unit: u, killer, killerHero, team, holder, count: this.grimmawKills });
    g.bus.emit('ui:message', { text: `${team === TEAM.SUNWARD ? 'Sunward' : team === TEAM.DUSKWARD ? 'Duskward' : 'Someone'} has slain Grimmaw!`, color: '#ffcc33' });
  }

  giveLantern(hero) {
    const g = this.game;
    this.lanternHolder = hero;
    // Item systems may provide their own Lantern implementation via giveLantern(hero)
    try { if (g.items?.giveLantern?.(hero)) return; } catch (e) { /* fall through */ }
    // Fallback: the Lantern as a modifier — prevents the next death (instant reincarnation), expires after 5 min.
    hero.addModifier({
      id: 'lantern', name: 'Lantern of Second Dawn', icon: '🏮', duration: 300,
      onDamageTaken: (unit, info) => {
        if (info.amount < unit.hp) return;
        info.amount = 0;
        unit.removeModifier('lantern');
        unit.hp = unit.getStat('maxHp');
        unit.mana = unit.getStat('maxMana');
        unit.interrupt?.();
        g.vfx?.spawn?.('teleport', { position: unit.position.clone(), unit, radius: 2 });
        g.bus.emit('ui:message', { text: `${unit.name} reincarnated by the Lantern!`, color: '#ffcc33' });
        g.bus.emit('lantern:consumed', { hero: unit });
      },
    });
  }
}
