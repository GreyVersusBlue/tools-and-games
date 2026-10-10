import { du, fx, damage, slow, dirTo, dist2d, forceMove, alliesIn, chest, THREE } from '../util.js';

// Tobren (model bone_shaman). A ranged support who makes the heroes beside him better at what they already do: an
// ally's attacks land twice (Twice Told), an enemy is driven toward the nearest ally (Beat the Brush), abilities cast
// near him come back sooner (Good Counsel) and his ultimate hands every basic ability back at once (Throw Again).
// No Math.random anywhere in this file.

const GREEN = 0x80ff60;

// The allied hero nearest to `pos` other than `self`, no further than `reach`. A tie goes to the earlier hero in the
// game's own list, so the same stage gives the same answer.
export function nearestAlly(game, self, pos, reach) {
  let best = null, bd = Infinity;
  for (const a of game.heroes) {
    if (a === self || a.team !== self.team || !a.alive) continue;
    const d = dist2d(a.position, pos);
    if (d <= reach && d < bd) { bd = d; best = a; }
  }
  return best;
}

// The basic abilities Throw Again would hand back: learned, not passive, not an ultimate, with more than `minLeft`
// seconds of cooldown left or a charge missing, on allied heroes inside its radius (Tobren included).
export function renewable(ab, minLeft = 0) {
  const h = ab.hero, out = [];
  for (const a of alliesIn(ab.game, h, h.position, ab.getRadius(), (u) => u.kind === 'hero')) {
    for (const x of a.abilities ?? []) {
      if (x.level <= 0 || x.isPassive || x.def.ultimate) continue; // Throw Again is an ultimate, so it is never its own
      if (x.def.charges ? x.charges < x.def.charges.max : x.cooldownRemaining > minLeft) out.push(x);
    }
  }
  return out;
}

export default [
  {
    id: 'tobren_twice_told', name: 'Twice Told', icon: '🔁', targetType: 'unit', targetTeam: 'ally', heroesOnly: true, allowSelf: true, castPoint: 0.3,
    description: "Tobren tells an allied hero, or himself, how its blows will fall. For 6 seconds each of that hero's attacks that lands strikes a second time 0.35 seconds later, for a share of the damage the first strike dealt, as pure damage. The second strike triggers no attack effects and does not land on buildings or wards.",
    cooldown: [20, 18, 16, 14], manaCost: [70, 80, 90, 100], castRange: [du(700)],
    values: { echoPct: [0.25, 0.35, 0.45, 0.55], duration: 6, delay: 0.35 },
    hint: { type: 'ally' },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const share = ab.v('echoPct'), wait = ab.v('delay');
      fx(g, 'hit', { position: chest(t), unit: t, color: GREEN });
      t.removeModifier('twice_told');
      t.addModifier({
        id: 'twice_told', name: 'Twice Told', icon: '🔁', duration: ab.v('duration'), source: h, vfxName: 'rally_shout_buff',
        onAttackLanded(u, target, landed) {
          if (!(landed.dealt > 0) || target.isStructure || target.kind === 'ward') return;
          // A share of what the first strike dealt after armour, so nothing reduces it a second time.
          const part = landed.dealt * share;
          g.delay(wait, () => {
            if (!target.alive) return;
            target.takeDamage(part, 'pure', u, { echo: true });
            fx(g, 'hit', { position: chest(target), unit: target, color: GREEN, small: true });
          });
        },
      });
    },
  },
  {
    id: 'tobren_beat_the_brush', name: 'Beat the Brush', icon: '🌾', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Tobren rattles his staff at an enemy and drives it toward his friends. It takes magical damage, is slowed by 30%, and is shoved up to 300 toward the allied hero nearest to it, stopping short of that hero. With no allied hero other than Tobren within 1200 of it, it is not moved.",
    cooldown: [14, 13, 12, 11], manaCost: [90, 100, 110, 120], castRange: [du(600)], damageType: 'magical',
    values: { damage: [70, 120, 170, 220], slow: 0.3, slowDuration: [2, 2.5, 3, 3.5], distance: du(300), allyRange: du(1200), jumpTime: 0.3 },
    hint: { type: 'enemy', disable: false },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      damage(t, ab.v('damage'), 'magical', h, ab);
      fx(g, 'dust', { position: t.position.clone() });
      if (!t.alive) return;
      slow(t, ab.v('slow'), ab.v('slowDuration'), h, { id: 'beat_the_brush_slow', name: 'Beat the Brush', icon: '🌾' });
      const a = nearestAlly(g, h, t.position, ab.v('allyRange'));
      if (!a || t.immobile) return;
      const gap = dist2d(t.position, a.position) - ((t.radius ?? 0.7) + (a.radius ?? 0.7) + 0.1);
      const step = Math.min(ab.v('distance'), gap);
      if (step < 0.3) return;
      const d = dirTo(t.position, a.position);
      forceMove(g, t, new THREE.Vector3(t.position.x + d.x * step, 0, t.position.z + d.z * step), ab.v('jumpTime'), { id: 'beat_the_brush' });
    },
  },
  {
    id: 'tobren_good_counsel', name: 'Good Counsel', icon: '🗣️', targetType: 'passive',
    description: "Allied heroes within 900 of Tobren, and Tobren himself, put their abilities on a shorter cooldown. It counts at the moment an ability is cast and stays with a hero for 0.6 seconds after it leaves his side. Items are not touched.",
    radius: du(900), values: { cdrPct: [0.06, 0.09, 0.12, 0.15] },
    aura: {
      interval: 0.25,
      targets: (ab) => alliesIn(ab.game, ab.hero, ab.hero.position, ab.getRadius(), (u) => u.kind === 'hero'),
      modifier(ab, u) {
        const pct = ab.v('cdrPct');
        // A hero that never leaves his side keeps the one modifier, so a level gained has to be written into it.
        const held = u.modifiers.find((m) => m.id === 'good_counsel');
        if (held) held.bonus.cooldownReduction = pct;
        return { id: 'good_counsel', name: 'Good Counsel', icon: '🗣️', bonus: { cooldownReduction: pct }, source: ab.hero, aura: true };
      },
    },
  },
  {
    id: 'tobren_throw_again', name: 'Throw Again', icon: '🎲', targetType: 'none', ultimate: true, castPoint: 0.4,
    description: "Tobren gathers the lots and throws again. Every basic ability of every allied hero within 700, his own included, comes off cooldown at once, and abilities that hold charges are filled. Each of those heroes but Tobren also regains mana. Ultimates and items are not touched.",
    cooldown: [120, 105, 90], manaCost: [125, 175, 225], radius: du(700),
    values: { mana: [60, 100, 140], ultPct: 0 },
    scepter: { description: "Throw Again also takes 40% off what is left of the cooldown of every other allied hero's ultimate in its radius, and the radius grows to 900.", values: { ultPct: 0.4 }, radius: du(900) },
    // Bots throw when three or more basic abilities around him have over 5 seconds left and an enemy hero is in the radius.
    hint: (ab) => ({ type: 'self', ult: true, minEnemies: renewable(ab, 5).length >= 3 ? 1 : 99 }),
    cast(ab) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      const ultPct = ab.v('ultPct'), mana = ab.v('mana');
      const back = renewable(ab);
      ab.data.renewed = (ab.data.renewed ?? 0) + back.length;
      for (const x of back) x.resetCooldown();
      fx(g, 'shockwave', { position: h.position.clone(), radius: r, color: GREEN, duration: 0.5 });
      for (const a of alliesIn(g, h, h.position, r, (u) => u.kind === 'hero')) {
        fx(g, 'hit', { position: chest(a), unit: a, color: GREEN });
        if (a === h) continue;
        a.restoreMana(mana);
        if (ultPct > 0) for (const x of a.abilities ?? []) if (x.def.ultimate && x.cooldownRemaining > 0) x.cooldownRemaining *= 1 - ultPct;
      }
    },
  },
];
