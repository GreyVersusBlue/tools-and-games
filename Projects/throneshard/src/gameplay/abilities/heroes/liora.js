import { du, fx, damage, enemiesIn, stun, slow, dirTo, validEnemy, chest, orderAfterCast } from '../util.js';

// Liora (WS5).
export default [
  {
    id: 'liora_tether_shot', name: 'Tether Shot', icon: '⛓️', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.15,
    description: "Fires a tethered arrow that binds the target to an enemy or tree behind it, stunning both. With nothing to bind to, the stun is short.",
    cooldown: [16, 14, 12, 10], manaCost: [80, 90, 100, 110], castRange: [du(800)], damageType: 'magical',
    values: { stun: [2.2, 2.6, 3.0, 3.4], lone: 0.75, latch: du(575), angle: 0.45, damage: [50, 100, 150, 200], speed: du(1650) },
    hint: { type: 'enemy', disable: true },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      g.projectiles?.launch({
        source: h, target: t, speed: ab.v('speed'), kind: 'tether_shot',
        onHit: (tt) => {
          if (!tt?.alive || tt.isMagicImmune) return;
          const dir = dirTo(h.position, tt.position);
          const latch = g.unitsInRadius(tt.position, ab.v('latch'), (u) => u !== tt && validEnemy(h, u) && u.kind !== 'ward').find((u) => {
            const d = dirTo(tt.position, u.position);
            return Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.z * dir.z))) < ab.v('angle');
          });
          const tree = !latch && (g.world?.getTreesInRadius?.(tt.position.x + dir.x * 3, tt.position.z + dir.z * 3, 3)?.length ?? 0) > 0;
          const dur = latch || tree ? ab.v('stun') : ab.v('lone');
          damage(tt, ab.v('damage'), 'magical', h, ab);
          stun(tt, dur, h);
          if (latch) { stun(latch, dur, h); fx(g, 'lightning', { position: chest(tt), target: chest(latch), source: tt, unit: latch, color: 0xc8b070 }); }
        },
      });
    },
  },
  {
    id: 'liora_piercing_gale', name: 'Piercing Gale', icon: '🏹', targetType: 'point', castPoint: 0.8,
    description: "Liora draws back and releases an arrow that pierces through every enemy in a long line, losing 15% damage per unit hit.",
    cooldown: [12, 11, 10, 9], manaCost: [90, 100, 110, 120], castRange: [du(2600)], radius: du(125), damageType: 'magical',
    values: { damage: [180, 280, 380, 480], distance: du(2600), speed: du(3000), falloff: 0.15 },
    hint: { type: 'point', line: true, width: du(250), harass: true },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      const dir = dirTo(h.position, p);
      const from = h.position.clone().addScaledVector(dir, 0.8); from.y += 1.2;
      let mult = 1;
      g.projectiles?.launch({
        source: h, from, direction: dir, distance: ab.v('distance'), width: ab.getRadius(), speed: ab.v('speed'), kind: 'piercing_gale',
        filter: (u) => validEnemy(h, u) && u.kind !== 'ward',
        onUnitHit: (u) => { damage(u, ab.v('damage') * mult, 'magical', h, ab); mult *= 1 - ab.v('falloff'); fx(g, 'hit', { position: chest(u), unit: u, color: 0xe8e0a0 }); },
      });
    },
  },
  {
    id: 'liora_tailwind', name: 'Tailwind', icon: '💨', targetType: 'none', castPoint: 0,
    description: "Liora rides the wind: she moves faster, physical attacks against her miss, and nearby enemies are slowed.",
    cooldown: [15, 14, 13, 12], manaCost: [60, 60, 60, 60], radius: du(325),
    values: { duration: [3, 4, 5, 6], moveSpeed: 0.6, slow: 0.35 },
    hint: { type: 'self', escape: true },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      h.addModifier({
        id: 'tailwind', name: 'Tailwind', icon: '💨', duration: ab.v('duration'), vfxName: 'speed_boost', bonus: { moveSpeedPct: ab.v('moveSpeed') },
        onDamageTaken(u, info) { if (info.isAttack) info.amount = 0; },
        onTick(u, dt) {
          this._acc = (this._acc ?? 0) + dt;
          if (this._acc < 0.25) return;
          this._acc = 0;
          for (const e of enemiesIn(g, u, u.position, ab.getRadius())) slow(e, ab.v('slow'), 0.5, u, { id: 'tailwind_slow', name: 'Tailwind', icon: '💨' });
        },
      });
    },
  },
  {
    id: 'liora_arrow_storm', name: 'Arrow Storm', icon: '🎯', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0,
    description: "Liora looses arrows at one target with massively increased attack speed, at the cost of reduced damage per arrow.",
    cooldown: [70, 50, 30], manaCost: [75, 100, 125], castRange: [du(600)], targetStructures: true,
    values: { attackSpeed: [350, 400, 450], damageReduction: [0.5, 0.4, 0.3], duration: 20 },
    scepter: { description: 'Damage reduction lowered to 15% and Arrow Storm also applies a mini-stun every 3 seconds.', values: { damageReduction: 0.15, ministun: 3 } },
    hint: { type: 'enemy', attackBuff: true },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      h.removeModifier('arrow_storm');
      let tick = 0;
      h.addModifier({
        id: 'arrow_storm', name: 'Arrow Storm', icon: '🎯', duration: ab.v('duration'), target: t,
        bonus: { get attackSpeed() { return (h.attackTarget === t || h.order?.target === t) && t.alive ? ab.v('attackSpeed') : 0; } },
        onAttackStart(u, tt, info) { if (tt === t) info.amount *= 1 - ab.v('damageReduction'); },
        onAttackLanded(u, tt) {
          if (tt !== t || !ab.hasScepter || !tt.alive) return;
          if (g.time - tick >= ab.v('ministun')) { tick = g.time; stun(tt, 0.1, u, { id: 'ministun', vfxName: null }); }
        },
        onTick() { if (!t.alive) this.remaining = 0; },
      });
      orderAfterCast(h, ab, { type: 'attack', target: t });
    },
  },
];
