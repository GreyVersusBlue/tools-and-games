import { du, fx, damage, enemiesIn, slow, stun, forceMove, safePoint, facingDir, dist2d, chest, validEnemy } from '../util.js';

export default [
  {
    id: 'thalor_forked_spark', name: 'Forked Spark', icon: '🌩️', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.2,
    description: "Casts a spark of lightning that forks from enemy to enemy.",
    cooldown: [1.6, 1.6, 1.6, 1.6], manaCost: [80, 85, 90, 95], castRange: [du(700)], radius: du(500), damageType: 'magical',
    values: { damage: [85, 110, 135, 160], jumps: [5, 7, 9, 15], jumpDelay: 0.25 },
    hint: { type: 'enemy', farm: true },
    cast(ab, first) {
      const h = ab.hero, g = ab.game;
      const hit = new Set();
      const dmg = ab.v('damage'), r = ab.getRadius();
      const strike = (t, fromPos, left) => {
        if (!t?.alive) return;
        hit.add(t);
        fx(g, 'forked_spark', { position: fromPos.clone(), target: chest(t), unit: t });
        damage(t, dmg, 'magical', h, ab);
        if (left <= 0) return;
        const origin = chest(t);
        const cands = g.unitsInRadius(t.position, r, (u) => !hit.has(u) && validEnemy(h, u) && g.canSee(h.team, u));
        if (!cands.length) return;
        let next = cands[0], bd = Infinity;
        for (const u of cands) { const d = dist2d(u.position, t.position); if (d < bd) { bd = d; next = u; } }
        g.delay(ab.v('jumpDelay'), () => strike(next, origin, left - 1));
      };
      strike(first, chest(h, 0.9), ab.v('jumps'));
    },
  },
  {
    id: 'thalor_skybolt', name: 'Skybolt', icon: '⚡', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.4,
    description: "Calls down a bolt from the sky on one enemy, damaging it with a mini-stun. Reveals invisible units nearby.",
    cooldown: [6, 6, 6, 6], manaCost: [120, 125, 130, 135], castRange: [du(700)], damageType: 'magical',
    values: { damage: [125, 200, 275, 350], stun: [0.3, 0.4, 0.5, 0.6] },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      fx(g, 'skybolt', { position: t.position.clone(), unit: t });
      damage(t, ab.v('damage'), 'magical', h, ab);
      stun(t, ab.v('stun'), h);
    },
  },
  {
    id: 'thalor_storm_leap', name: 'Storm Leap', icon: '🌠', targetType: 'none', castPoint: 0,
    description: "Thalor bounds forward on the wind, shocking the nearest enemies at his takeoff point and slowing them.",
    cooldown: [18, 16, 14, 12], manaCost: [75, 85, 95, 105], radius: du(575), damageType: 'magical',
    values: { distance: du(425), damage: [100, 150, 200, 250], slow: 0.5, slowDuration: [1, 1.25, 1.5, 1.75], targets: 3, jumpTime: 0.5 },
    hint: { type: 'self', escape: true, forward: true },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      const start = h.position.clone();
      const cands = enemiesIn(g, h, start, ab.getRadius()).filter((u) => g.canSee(h.team, u));
      cands.sort((a, b) => (a.kind === 'hero' ? 0 : 1) - (b.kind === 'hero' ? 0 : 1) || dist2d(a.position, start) - dist2d(b.position, start));
      for (const e of cands.slice(0, ab.v('targets'))) {
        fx(g, 'forked_spark', { position: chest(h, 0.9), target: chest(e), unit: e });
        damage(e, ab.v('damage'), 'magical', h, ab);
        slow(e, ab.v('slow'), ab.v('slowDuration'), h, { id: 'storm_leap_slow', name: 'Storm Leap', icon: '🌠', attackSlow: 50 });
      }
      const dest = safePoint(g, start.clone().addScaledVector(facingDir(h), ab.v('distance')), start);
      fx(g, 'storm_leap', { unit: h, position: start, target: dest.clone() });
      forceMove(g, h, dest, ab.v('jumpTime'), { arc: 3, disable: true, id: 'storm_leap', onEnd: () => fx(g, 'shockwave', { position: h.position.clone(), radius: 3, color: 0x88ccff }) });
    },
  },
  {
    id: 'thalor_heavens_verdict', name: "Heaven's Verdict", icon: '🌩', targetType: 'none', ultimate: true, castPoint: 0.4,
    description: "Thalor passes judgment on every enemy hero at once, striking each with lightning wherever it is on the map.",
    cooldown: [120, 110, 100], manaCost: [250, 350, 450], damageType: 'magical',
    values: { damage: [300, 400, 500] },
    scepter: { description: 'Deals +100 damage and grants vision around every struck hero for 4s.', values: { damage: [400, 500, 600], revealRadius: du(500) } },
    hint: { type: 'self', global: true },
    cast(ab) {
      const h = ab.hero, g = ab.game;
      fx(g, 'heavens_verdict_cast', { unit: h, position: h.position.clone() });
      const dmg = ab.v('damage');
      let i = 0;
      for (const e of g.heroes) {
        if (!e.alive || e.team === h.team || e.isInvulnerable) continue;
        const delay = 0.05 * i++;
        g.delay(delay, () => {
          if (!e.alive) return;
          fx(g, 'heavens_verdict', { position: e.position.clone(), unit: e });
          if (ab.hasScepter) g.world?.addVision?.(h.team, e.position.x, e.position.z, ab.v('revealRadius'), 4, true);
          damage(e, dmg, 'magical', h, ab);
        });
      }
    },
  },
];
