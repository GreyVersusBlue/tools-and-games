import { du, fx, damage, enemiesIn, stun, dirTo, unitsOnLine, chest } from '../util.js';

// Ondur (WS5). Tremor is a passive hooked on ability:cast; Deep Quake scales with units around.
function tremor(ab) {
  const h = ab.hero, g = ab.game;
  if (!(ab.level > 0) || !h.alive) return;
  const r = ab.getRadius();
  fx(g, 'shockwave', { position: h.position.clone(), radius: r, color: 0xd8a860 });
  for (const e of enemiesIn(g, h, h.position, r)) {
    damage(e, ab.v('damage'), 'magical', h, ab);
    stun(e, ab.v('stun'), h);
  }
}

export default [
  {
    id: 'ondur_rift_wall', name: 'Rift Wall', icon: '🪨', targetType: 'point', castPoint: 0.69,
    description: "Strikes the ground to raise a wall of stone along a line. Enemies on the line are damaged and stunned, and nothing can walk through the wall until it crumbles.",
    cooldown: [18, 17, 16, 15], manaCost: [110, 130, 150, 170], castRange: [du(1400)], radius: du(225), damageType: 'magical',
    values: { damage: [110, 160, 210, 260], stun: [1.0, 1.25, 1.5, 1.75], length: du(1400) },
    hint: { type: 'point', line: true, width: du(225) },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      const dir = dirTo(h.position, p);
      const from = h.position.clone().addScaledVector(dir, 1);
      const len = ab.v('length');
      for (let d = 0; d <= len; d += 2.2) {
        const q = from.clone().addScaledVector(dir, d);
        g.delay(d / 60, () => fx(g, 'explosion', { position: q, radius: 1.2, color: 0xa07040, small: true }));
      }
      for (const e of unitsOnLine(g, h, from, dir, len, ab.getRadius() * 0.5)) {
        damage(e, ab.v('damage'), 'magical', h, ab);
        stun(e, ab.v('stun'), h);
      }
    },
  },
  {
    id: 'ondur_totem_swing', name: 'Totem Swing', icon: '🗿', targetType: 'none', castPoint: 0.5,
    description: "Ondur winds up his totem. His next attack within 14 seconds hits with massive bonus damage.",
    cooldown: [5, 5, 5, 5], manaCost: [35, 40, 45, 50],
    values: { bonusPct: [1.0, 2.0, 3.0, 4.0], duration: 14 },
    hint: { type: 'self', attackBuff: true, minEnemies: 1 },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      fx(g, 'titans_might_cast', { unit: h, position: h.position.clone() });
      h.addModifier({
        id: 'totem_swing', name: 'Totem Swing', icon: '🗿', duration: ab.v('duration'),
        onAttackStart(u, t, info) {
          const base = (u.baseStats.damageMin + u.baseStats.damageMax) / 2 + (u.attr?.('str') ?? 0);
          info.amount += base * ab.v('bonusPct');
          info.totem = true;
        },
        onAttackLanded(u, t, info) {
          if (!info.totem) return;
          fx(g, 'crit', { unit: t, source: u, position: t.position.clone(), amount: info.dealt, color: 0xffcc66 });
          g.delay(0, () => u.removeModifier('totem_swing'));
        },
      });
    },
  },
  {
    id: 'ondur_tremor', name: 'Tremor', icon: '💢', targetType: 'passive',
    description: "Whenever Ondur casts an ability, the ground trembles around him, damaging and stunning nearby enemies.",
    radius: du(300), damageType: 'magical', values: { damage: [70, 100, 130, 160], stun: [0.6, 0.8, 1.0, 1.2] },
    onLearn(ab) {
      ab.data.off?.();
      ab.data.off = ab.game.bus.on('ability:cast', ({ hero, ability }) => {
        if (hero !== ab.hero || ability?.isItem || ability === ab) return;
        ab.game.delay(ability?.def?.id === 'ondur_rift_wall' ? 0.05 : 0, () => tremor(ab));
      });
    },
  },
  {
    id: 'ondur_deep_quake', name: 'Deep Quake', icon: '🌋', targetType: 'none', ultimate: true, castPoint: 0,
    description: "A quake shakes the ground under every nearby enemy. Each enemy it hits sends out a tremor of its own that damages the others.",
    cooldown: [130, 120, 110], manaCost: [145, 205, 265], radius: du(600), damageType: 'magical',
    values: { initial: [100, 140, 180], echo: [85, 105, 125] },
    scepter: { description: 'Deep Quake radius increased to 800, echoes deal +40 damage and heroes send out two echoes.', values: { echo: [125, 145, 165] }, radius: du(800), cooldown: [110, 100, 90] },
    hint: { type: 'self', teamfight: true, minEnemies: 2 },
    cast(ab) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      fx(g, 'shockwave', { position: h.position.clone(), radius: r, color: 0xffa040 });
      fx(g, 'explosion', { position: h.position.clone(), radius: 3, color: 0xffa040 });
      const targets = enemiesIn(g, h, h.position, r).filter((u) => u.kind !== 'ward');
      const echoes = targets.reduce((n, u) => n + (u.kind === 'hero' && ab.hasScepter ? 2 : 1), 0);
      for (const e of targets) {
        damage(e, ab.v('initial'), 'magical', h, ab);
        const own = e.kind === 'hero' && ab.hasScepter ? 2 : 1;
        const n = echoes - own;
        if (n > 0) g.delay(0.3, () => { if (e.alive) { damage(e, ab.v('echo') * n, 'magical', h, ab); fx(g, 'hit', { position: chest(e), unit: e, color: 0xffa040 }); } });
      }
    },
  },
];

