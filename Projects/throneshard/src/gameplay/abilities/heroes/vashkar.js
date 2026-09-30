import { du, fx, damage, stun, slow, dirTo, dist2d, forceMove, validEnemy, chest, enemiesIn } from '../util.js';

export default [
  {
    id: 'vashkar_stone_spines', name: 'Stone Spines', icon: '🪨', targetType: 'point', castPoint: 0.3,
    description: "Jagged stone spines erupt along a line, tossing enemies into the air, then stunning and damaging them.",
    cooldown: [12, 12, 12, 12], manaCost: [100, 120, 140, 160], castRange: [du(600)], radius: du(125), damageType: 'magical',
    values: { damage: [80, 140, 200, 260], stun: [1.2, 1.6, 2.0, 2.4], distance: du(825), speed: du(1600), airTime: 0.5 },
    hint: { type: 'point', line: true, disable: true },
    cast(ab, p) {
      const h = ab.hero, g = ab.game;
      const dir = dirTo(h.position, p);
      const from = h.position.clone().addScaledVector(dir, 0.8);
      from.y = 0.05;
      const dmg = ab.v('damage'), st = ab.v('stun'), air = ab.v('airTime');
      g.projectiles?.launch({
        source: h, from, direction: dir, distance: ab.v('distance'), width: ab.getRadius() - 0.5, speed: ab.v('speed'), kind: 'stone_spines',
        filter: (u) => validEnemy(h, u),
        onUnitHit: (u) => {
          fx(g, 'stone_spines_hit', { position: u.position.clone(), unit: u });
          if (!u.immobile) forceMove(g, u, u.position.clone(), air, { arc: 2.5, id: 'stone_spines_air' });
          stun(u, st, h);
          g.delay(air, () => { if (u.alive) { damage(u, dmg, 'magical', h, ab); fx(g, 'dust', { position: u.position.clone() }); } });
        },
      });
    },
  },
  {
    id: 'vashkar_toadcurse', name: 'Toadcurse', icon: '🐸', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Curses an enemy into a harmless toad. It cannot attack or cast and moves slowly.",
    cooldown: [30, 24, 18, 12], manaCost: [125, 150, 175, 200], castRange: [du(500)],
    values: { duration: [2.5, 3.0, 3.5, 4.0], slow: 0.6 },
    hint: { type: 'enemy', disable: true },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      fx(g, 'morph_poof', { position: t.position.clone(), unit: t });
      t.addModifier({
        id: 'toadcursed', name: 'Toadcurse', icon: '🐸', debuff: true, duration: ab.v('duration'), morph: true, slow: ab.v('slow'), source: h,
        vfxName: 'morph',
      });
    },
  },
  {
    id: 'vashkar_siphon_will', name: 'Siphon Will', icon: '💧', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Channels to draw mana out of an enemy while slowing it. Breaks if the target gets too far away.",
    cooldown: [16, 12, 8, 4], manaCost: [10, 10, 10, 10], castRange: [du(850)], targetStructures: false,
    values: { drain: [20, 40, 60, 80], duration: 5, breakRange: du(1100), slow: [0.16, 0.19, 0.22, 0.25] },
    hint: { type: 'enemy', channel: true, manaSustain: true },
    channel: {
      duration: (ab) => ab.v('duration'),
      tick(ab, dt) {
        const t = ab.data.target, h = ab.hero, g = ab.game;
        if (!t?.alive || dist2d(t.position, h.position) > ab.v('breakRange') || !g.canSee(h.team, t) || t.isMagicImmune || t.isInvulnerable) { ab.stopChannel(true); return; }
        h.faceToward?.(t.position, dt);
        const want = ab.v('drain') * dt;
        const got = Math.min(t.mana ?? 0, want);
        if (got > 0) { t.mana -= got; h.restoreMana(got); }
        if (got < want * 0.5) {
          // No mana to drain — burn a little health instead so the channel stays useful vs creeps.
          ab.data.acc = (ab.data.acc ?? 0) + dt;
          if (ab.data.acc >= 0.5) { ab.data.acc = 0; damage(t, ab.v('drain') * 0.25, 'magical', h, ab); }
        }
        slow(t, ab.v('slow'), 0.3, h, { id: 'siphon_will_slow', name: 'Siphon Will', icon: '💧' });
      },
      end(ab) { ab.data.beam?.remove?.(); ab.data.beam = null; ab.data.target = null; },
    },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      ab.data.target = t;
      ab.data.beam?.remove?.();
      ab.data.beam = g.vfx?.attachToUnit?.(h, 'siphon_will', { target: t, duration: ab.v('duration') + 0.3 }) ?? null;
    },
  },
  {
    id: 'vashkar_death_mark', name: 'Death Mark', icon: '👉', targetType: 'unit', targetTeam: 'enemy', ultimate: true, castPoint: 0.3,
    description: "Vashkar brands an enemy with a death mark that tears at it from within for massive magical damage.",
    cooldown: [100, 85, 70], manaCost: [200, 420, 650], castRange: [du(900)], damageType: 'magical',
    values: { damage: [600, 725, 850], delay: 0.25 },
    scepter: { description: 'Death Mark hits all enemies within 325 of the target and its cooldown is reduced to 60/50/40.', cooldown: [60, 50, 40], values: { splash: du(325) } },
    hint: (ab) => ({ type: 'enemy', finisher: ab.v('damage') }),
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      fx(g, 'death_mark', { unit: h, source: h, target: t, position: chest(h, 0.7) });
      const dmg = ab.v('damage');
      const splash = ab.hasScepter ? enemiesIn(g, h, t.position, ab.v('splash')).filter((e) => e !== t) : [];
      for (const e of splash) fx(g, 'death_mark', { unit: h, source: h, target: e, position: chest(h, 0.7) });
      g.delay(ab.v('delay'), () => {
        for (const e of splash) if (e.alive && !e.isMagicImmune) damage(e, dmg, 'magical', h, ab);
        if (!t.alive || t.isMagicImmune) return;
        damage(t, dmg, 'magical', h, ab);
        if (!t.alive) fx(g, 'blood', { position: chest(t), amount: 3 });
      });
    },
  },
];

