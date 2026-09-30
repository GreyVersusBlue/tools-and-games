import { du, fx, damage, enemiesIn, slow, dirTo, dist2d, chest, validEnemy } from '../util.js';

export default [
  {
    id: 'morvane_grave_frost', name: 'Grave Frost', icon: '🥶', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.4,
    description: "Blasts an enemy with grave-cold frost that also hits enemies around it, damaging and slowing their movement and attacks.",
    cooldown: [8, 7, 6, 5], manaCost: [125, 140, 155, 170], castRange: [du(600)], radius: du(200), damageType: 'magical',
    values: { targetDamage: [70, 100, 130, 160], aoeDamage: [75, 125, 175, 225], slow: 0.3, attackSlow: 20, duration: 4, speed: du(1000) },
    cast(ab, t) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      g.projectiles?.launch({
        source: h, target: t, speed: ab.v('speed'), kind: 'grave_frost',
        onHit: (tt) => {
          if (!tt?.alive) return;
          fx(g, 'grave_frost_impact', { position: tt.position.clone(), radius: r, unit: tt });
          if (!tt.isMagicImmune) damage(tt, ab.v('targetDamage'), 'magical', h, ab);
          for (const e of enemiesIn(g, h, tt.position, r)) {
            damage(e, ab.v('aoeDamage'), 'magical', h, ab);
            slow(e, ab.v('slow'), ab.v('duration'), h, { id: 'grave_frost_slow', name: 'Grave Frost', icon: '🥶', attackSlow: ab.v('attackSlow'), vfxName: 'frost_slow' });
          }
        },
      });
    },
  },
  {
    id: 'morvane_rime_armor', name: 'Rime Armor', icon: '🛡️', targetType: 'unit', targetTeam: 'ally', allowSelf: true, targetStructures: true, castPoint: 0.3,
    description: "Coats an ally in rime. Attacks against it deal less physical damage, and the armor pulses to damage and slow nearby enemies.",
    cooldown: [22, 20, 18, 16], manaCost: [100, 100, 100, 100], castRange: [du(1000)], radius: du(600), damageType: 'magical',
    values: { reduction: [0.3, 0.4, 0.5, 0.6], pulseDamage: [30, 40, 50, 60], slow: 0.3, duration: 6, interval: 1 },
    hint: { type: 'ally', defensive: true },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      let acc = 0;
      fx(g, 'frost', { position: chest(t), radius: 2 });
      t.addModifier({
        id: 'rime_armor', name: 'Rime Armor', icon: '🛡️', duration: ab.v('duration'), source: h, vfxName: 'rime_armor',
        onDamageTaken(u, info) { if (info.isAttack) info.amount *= 1 - ab.v('reduction'); },
        onTick(u, dt) {
          acc += dt;
          if (acc < ab.v('interval')) return;
          acc -= ab.v('interval');
          fx(g, 'frost_pulse', { position: u.position.clone(), radius: ab.getRadius() });
          for (const e of enemiesIn(g, h, u.position, ab.getRadius())) {
            damage(e, ab.v('pulseDamage'), 'magical', h, ab);
            slow(e, ab.v('slow'), 1.2, h, { id: 'rime_armor_slow', name: 'Rime Armor', icon: '🛡️', vfxName: 'frost_slow' });
          }
        },
      });
    },
  },
  {
    id: 'morvane_dread_stare', name: 'Dread Stare', icon: '👁️', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Morvane fixes an enemy with a dreadful stare. It shambles toward him against its will while he drains its mana.",
    cooldown: [30, 26, 22, 18], manaCost: [70, 85, 100, 115], castRange: [du(550)],
    values: { duration: [1.6, 1.8, 2.0, 2.2], manaDrainPct: [0.15, 0.2, 0.25, 0.3], walkSpeed: 0.35 },
    hint: { type: 'enemy', channel: true, disable: true },
    channel: {
      duration: (ab) => ab.v('duration'),
      tick(ab, dt) {
        const t = ab.data.target, h = ab.hero;
        if (!t?.alive || !t.hasModifier('dread_stare') || dist2d(t.position, h.position) > ab.getCastRange() + 8) { ab.stopChannel(true); return; }
        h.faceToward?.(t.position, dt);
        const drain = Math.min(t.mana, (t.getStat('maxMana') * ab.v('manaDrainPct') / ab.v('duration')) * dt);
        if (drain > 0) { t.mana -= drain; h.restoreMana(drain); }
      },
      end(ab) { ab.data.target?.removeModifier?.('dread_stare'); ab.data.target = null; },
    },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      ab.data.target = t;
      const speedMult = ab.v('walkSpeed');
      t.addModifier({
        id: 'dread_stare', name: 'Dread Stare', icon: '👁️', debuff: true, duration: ab.v('duration') + 0.2, stun: true, noStunVfx: true, source: h,
        vfxName: 'dread_stare',
        onTick(u, dt) {
          if (u.immobile || !h.alive) return;
          const d = dist2d(u.position, h.position);
          if (d <= u.radius + h.radius + 0.3) return;
          const dir = dirTo(u.position, h.position);
          u.facing = Math.atan2(dir.x, dir.z);
          const sp = u.baseStats.moveSpeed * speedMult * dt;
          u.tryStep(dir.x * sp, dir.z * sp);
        },
        onApply(u) { u.playAnim?.('run'); },
        onExpire(u) { if (u.alive) u.playAnim?.('idle'); },
      });
      fx(g, 'dread_stare_cast', { unit: t, source: h });
    },
  },
  {
    id: 'morvane_leaping_cold', name: 'Leaping Cold', icon: '🔮', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0.3,
    description: "Releases an orb of frost that leaps between nearby enemies up to 10 times, damaging and slowing each one it hits.",
    cooldown: [100, 80, 60], manaCost: [200, 325, 450], castRange: [du(750)], radius: du(600), damageType: 'magical',
    values: { damage: [280, 370, 460], bounces: 10, slow: 0.65, attackSlow: 65, slowDuration: 2.5, speed: du(850), bounceDelay: 0.2 },
    scepter: { description: 'Leaping Cold bounces up to 40 times, deals +100 damage and travels faster.', values: { damage: [380, 470, 560], bounces: 40, speed: du(1100) } },
    hint: { type: 'enemy', teamfight: true },
    cast(ab, first) {
      const h = ab.hero, g = ab.game;
      const dmg = ab.v('damage'), r = ab.getRadius();
      const throwTo = (target, from, remaining) => {
        g.projectiles?.launch({
          source: h, from, target, speed: ab.v('speed'), kind: 'leaping_cold', keepOnDeath: true,
          onHit: (t, pos) => {
            const at = t?.position?.clone() ?? pos;
            fx(g, 'leaping_cold_hit', { position: at.clone().setY(1.2), unit: t });
            if (t?.alive && !t.isMagicImmune) {
              damage(t, dmg, 'magical', h, ab);
              slow(t, ab.v('slow'), ab.v('slowDuration'), h, { id: 'leaping_cold_slow', name: 'Leaping Cold', icon: '🔮', attackSlow: ab.v('attackSlow'), vfxName: 'frost_slow' });
            }
            if (remaining <= 0) return;
            const cands = g.unitsInRadius(at, r, (u) => u !== t && validEnemy(h, u) && g.canSee(h.team, u));
            if (!cands.length) return;
            const heroes = cands.filter((u) => u.kind === 'hero');
            const pool = heroes.length ? heroes : cands;
            const next = pool[Math.floor(Math.random() * pool.length)];
            const src = at.clone(); src.y = t?.alive ? chest(t).y : 1.4;
            g.delay(ab.v('bounceDelay'), () => { if (next.alive) throwTo(next, src, remaining - 1); });
          },
        });
      };
      throwTo(first, chest(h, 0.8), ab.v('bounces'));
    },
  },
];
