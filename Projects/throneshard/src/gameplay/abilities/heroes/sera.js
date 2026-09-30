import { du, fx, damage, enemiesIn, stun, dirTo, validEnemy, chest } from '../util.js';

export default [
  {
    id: 'sera_flame_wave', name: 'Flame Wave', icon: '🐉', targetType: 'point', castPoint: 0.45,
    description: "Sera sends a rolling wave of fire forward, burning every enemy in its path.",
    cooldown: [9, 8, 7, 6], manaCost: [100, 115, 130, 145], castRange: [du(1075)], radius: du(110), damageType: 'magical',
    values: { damage: [85, 160, 235, 310], distance: du(1075), speed: du(1200) },
    hint: { type: 'point', line: true, width: du(220) },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      const dir = dirTo(h.position, p);
      const from = h.position.clone().addScaledVector(dir, 0.8);
      from.y += 1.0;
      g.projectiles?.launch({
        source: h, from, direction: dir, distance: ab.v('distance'), width: ab.getRadius() - 0.8, speed: ab.v('speed'), kind: 'flame_wave',
        filter: (u) => validEnemy(h, u),
        onUnitHit: (u) => { damage(u, ab.v('damage'), 'magical', h, ab); fx(g, 'fire_hit', { position: chest(u, 0.5), unit: u }); },
      });
      fx(g, 'flame_wave_cast', { unit: h, position: from.clone(), direction: dir });
    },
  },
  {
    id: 'sera_pillar_of_flame', name: 'Pillar of Flame', icon: '🔆', targetType: 'point', castPoint: 0.45,
    description: "Marks a spot on the ground. After a short delay a pillar of flame erupts there, damaging and stunning enemies.",
    cooldown: [7, 7, 7, 7], manaCost: [100, 110, 120, 130], castRange: [du(625)], radius: du(250), damageType: 'magical',
    values: { damage: [80, 120, 160, 200], stun: [1.6, 1.9, 2.2, 2.5], delay: 0.5 },
    hint: { type: 'aoe', delay: 0.5 },
    cast(ab, p) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      const pos = p.clone();
      fx(g, 'pillar_of_flame_pre', { position: pos.clone(), radius: r, duration: ab.v('delay') });
      const dmg = ab.v('damage'), st = ab.v('stun');
      g.delay(ab.v('delay'), () => {
        fx(g, 'pillar_of_flame', { position: pos.clone(), radius: r });
        for (const e of enemiesIn(g, h, pos, r)) {
          damage(e, dmg, 'magical', h, ab);
          stun(e, st, h);
        }
      });
    },
  },
  {
    id: 'sera_kindled_heart', name: 'Kindled Heart', icon: '♨️', targetType: 'passive',
    description: "Each spell Sera casts stokes her inner fire, granting attack and movement speed. Stacks 3 times.",
    values: { attackSpeed: [40, 55, 70, 85], moveSpeed: [0.05, 0.06, 0.07, 0.08], duration: 12, maxStacks: 3 },
    onLearn(ab) {
      ab.data.off?.();
      ab.data.off = ab.game.bus.on('ability:cast', ({ hero, ability }) => {
        if (hero !== ab.hero || !hero.alive || ability === ab || ability?.isItem) return;
        hero.addModifier({
          id: 'kindled_heart', name: 'Kindled Heart', icon: '♨️', duration: ab.v('duration'), stackable: true, maxStacks: ab.v('maxStacks'),
          bonus: { get attackSpeed() { return ab.v('attackSpeed'); }, get moveSpeedPct() { return ab.v('moveSpeed'); } },
          vfxName: 'kindled_heart',
        });
        const m = hero.modifiers.find((x) => x.id === 'kindled_heart');
        if (m) m.remaining = ab.v('duration');
      });
    },
  },
  {
    id: 'sera_sunlance', name: 'Sunlance', icon: '⚡', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0.45,
    description: "Sera hurls a spear of concentrated sunlight at one enemy for enormous magical damage.",
    cooldown: [70, 60, 50], manaCost: [150, 250, 350], castRange: [du(600)], damageType: 'magical',
    values: { damage: [450, 675, 950], delay: 0.25 },
    scepter: { description: 'Sunlance deals pure damage and pierces magic immunity.', pierceImmunity: true },
    hint: (ab) => ({ type: 'enemy', finisher: ab.v('damage') }),
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      fx(g, 'sunlance', { unit: h, source: h, target: t, position: chest(h, 0.65) });
      const dmg = ab.v('damage');
      const pure = ab.hasScepter;
      g.delay(ab.v('delay'), () => {
        if (!t.alive || (t.isMagicImmune && !pure)) return;
        damage(t, dmg, pure ? 'pure' : 'magical', h, ab);
      });
    },
  },
];
