import { du, fx, damage, enemiesIn, alliesIn, stun, dirTo } from '../util.js';

export default [
  {
    id: 'aldric_thunder_gauntlet', name: 'Thunder Gauntlet', icon: '🔨', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Aldric flings his gauntlet at an enemy. It bursts on impact, damaging and stunning units in a small area.",
    cooldown: [18, 16, 14, 12], manaCost: [110, 115, 120, 125], castRange: [du(600)], radius: du(255), damageType: 'magical',
    values: { damage: [80, 160, 240, 320], stun: [1.25, 1.5, 1.75, 2.0], speed: du(1000) },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const dmg = ab.v('damage'), st = ab.v('stun'), r = ab.getRadius();
      g.projectiles?.launch({
        source: h, target: t, speed: ab.v('speed'), kind: 'thunder_gauntlet', keepOnDeath: true,
        onHit: (tt, pos) => {
          const p = tt?.position?.clone() ?? pos;
          fx(g, 'thunder_gauntlet_impact', { position: p.clone().setY(0), radius: r });
          for (const e of enemiesIn(g, h, p, r)) { damage(e, dmg, 'magical', h, ab); stun(e, st, h); }
        },
      });
    },
  },
  {
    id: 'aldric_wide_sweep', name: 'Wide Sweep', icon: '🗡️', targetType: 'passive',
    description: "Aldric's swings carry through, damaging every enemy in an arc in front of him.",
    radius: du(300), values: { cleave: [0.4, 0.6, 0.8, 1.0] },
    passive(ab) {
      return {
        onAttackLanded(u, t, info) {
          if (!t || t.isStructure || u.kind === 'summon') return;
          const g = ab.game, r = ab.getRadius();
          const fwd = dirTo(u.position, t.position);
          const amt = (info.amount ?? 0) * ab.v('cleave');
          fx(g, 'cleave', { unit: u, position: t.position.clone(), direction: fwd, radius: r });
          if (amt <= 0) return;
          for (const e of enemiesIn(g, u, t.position, r, { pierceImmunity: true })) {
            if (e === t) continue;
            const dx = e.position.x - u.position.x, dz = e.position.z - u.position.z;
            if (dx * fwd.x + dz * fwd.z < 0) continue; // only in front
            damage(e, amt, 'pure', u, ab, { cleave: true });
          }
        },
      };
    },
  },
  {
    id: 'aldric_rally_shout', name: 'Rally Shout', icon: '📯', targetType: 'none', castPoint: 0,
    description: "Aldric's battle shout rallies nearby allies, granting them armor and movement speed.",
    cooldown: [36, 32, 28, 24], manaCost: [30, 40, 50, 60], radius: du(700),
    values: { armor: [6, 9, 12, 15], moveSpeed: [0.12, 0.16, 0.2, 0.24], duration: 8 },
    hint: { type: 'self', teamfight: true },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      fx(g, 'rally_shout', { unit: h, position: h.position.clone(), radius: ab.getRadius() });
      for (const a of alliesIn(g, h, h.position, ab.getRadius(), (u) => u.kind === 'hero' || u === h)) {
        a.addModifier({ id: 'rally_shout', name: 'Rally Shout', icon: '📯', duration: ab.v('duration'), bonus: { armor: ab.v('armor'), moveSpeedPct: ab.v('moveSpeed') }, vfxName: 'rally_shout_buff' });
      }
    },
  },
  {
    id: 'aldric_titans_might', name: "Titan's Might", icon: '💪', targetType: 'none', ultimate: true, castPoint: 0.3,
    description: "Aldric draws on a titan's strength, gaining a large bonus to damage for a time.",
    cooldown: [110, 105, 100], manaCost: [100, 150, 200],
    values: { damagePct: [1.0, 1.5, 2.0], duration: 25 },
    scepter: { description: "+10s duration and Titan's Might also grants +60 attack speed and 10% movement speed.", values: { duration: 35 } },
    hint: { type: 'self', teamfight: true, attackBuff: true },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      fx(g, 'titans_might_cast', { unit: h, position: h.position.clone() });
      const pct = ab.v('damagePct');
      h.addModifier({
        id: 'titans_might', name: "Titan's Might", icon: '💪', duration: ab.v('duration'), vfxName: 'titans_might',
        bonus: {
          get damage() { return ((h.baseStats.damageMin + h.baseStats.damageMax) / 2 + h.attr('str')) * pct; },
          get attackSpeed() { return ab.hasScepter ? 60 : 0; },
          get moveSpeedPct() { return ab.hasScepter ? 0.1 : 0; },
        },
      });
    },
  },
];

