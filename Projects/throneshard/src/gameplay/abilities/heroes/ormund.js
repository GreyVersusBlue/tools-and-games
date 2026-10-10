import { du, fx, damage, slow, dirTo, dist2d, forceMove, enemiesIn, chest, orderAfterCast, THREE } from '../util.js';

// Ormund (model rift_stalker). A melee guardian: he takes an ally's damage on himself (Stand Surety), keeps a ledger of
// everything he took and hands it back (Called to Account), takes an attacker's weapon (Confiscate) and slows whoever
// turns to leave (No Free Passage). No Math.random anywhere in this file.

// An enemy's back is to Ormund when it faces more than 90 degrees away from him.
export function backTurned(u, to) {
  const dx = to.x - u.position.x, dz = to.z - u.position.z;
  return Math.sin(u.facing) * dx + Math.cos(u.facing) * dz < 0;
}

// Damage Ormund took inside the ledger's window, oldest entries dropped as they age out.
export function ledgerTotal(ab) {
  const since = ab.game.time - ab.v('window');
  let sum = 0;
  for (const e of ab.data.ledger ?? []) if (e.t > since) sum += e.amount;
  return sum;
}
const LEDGER_KEEP = 10; // seconds kept; the longest window is the scepter's

export default [
  {
    id: 'ormund_stand_surety', name: 'Stand Surety', icon: '🤝', targetType: 'unit', targetTeam: 'ally', heroesOnly: true, allowSelf: false, castPoint: 0.2,
    description: "Ormund vouches for another allied hero. While the bond holds and Ormund is above 30% health, he takes a share of all damage dealt to that ally in its place. The bond breaks if the two move more than 900 apart or either dies. Cannot be cast at or below 30% health.",
    cooldown: [22, 20, 18, 16], manaCost: [60, 70, 80, 90], castRange: [du(700)],
    values: { sharePct: [0.3, 0.4, 0.5, 0.6], duration: 7, breakRange: du(900), floorPct: 0.3 },
    hint: { type: 'ally', defensive: true, allyBelow: 0.8 },
    canCast(ab) {
      return ab.hero.healthPct > ab.v('floorPct') ? { ok: true } : { ok: false, reason: 'Too wounded to stand surety' };
    },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const share = ab.v('sharePct'), floor = ab.v('floorPct'), brk = ab.v('breakRange');
      fx(g, 'shield', { position: h.position.clone(), radius: 2.5, color: 0xb090ff });
      t.removeModifier('stand_surety');
      t.addModifier({
        id: 'stand_surety', name: 'Stand Surety', icon: '🤝', duration: ab.v('duration'), source: h, vfxName: 'shield',
        onTick(u) { if (!h.alive || dist2d(u.position, h.position) > brk) this.remaining = 0; },
        onDamageTaken(u, info) {
          if (info.surety || !(info.amount > 0) || !h.alive || h.healthPct <= floor) return;
          const part = info.amount * share;
          info.amount -= part;
          // Already reduced by the ally's own armour or resistance, so Ormund takes it as it stands.
          h.takeDamage(part, 'pure', info.source, { surety: true });
        },
      });
    },
  },
  {
    id: 'ormund_confiscate', name: 'Confiscate', icon: '⛓️', targetType: 'unit', targetTeam: 'enemy', castPoint: 0.3,
    description: "Ormund lunges at an enemy and knocks the weapon out of its hands. The blow deals physical damage, and the enemy cannot attack until the disarm ends.",
    cooldown: [15, 14, 13, 12], manaCost: [80, 90, 100, 110], castRange: [du(400)], damageType: 'physical',
    values: { damage: [80, 130, 180, 230], duration: [1.75, 2.25, 2.75, 3.25], jumpTime: 0.2 },
    hint: { type: 'enemy', disable: false },
    cast(ab, t) {
      const h = ab.hero, g = ab.game;
      const dmg = ab.v('damage'), dur = ab.v('duration');
      const back = dirTo(t.position, h.position);
      const reach = (t.radius ?? 0.7) + (h.radius ?? 0.7) + 0.1;
      const dest = new THREE.Vector3(t.position.x + back.x * reach, 0, t.position.z + back.z * reach);
      fx(g, 'dust', { position: h.position.clone() });
      const land = () => {
        if (!h.alive || !t.alive || t.isInvulnerable || t.isMagicImmune) return;
        h.facing = Math.atan2(t.position.x - h.position.x, t.position.z - h.position.z);
        damage(t, dmg, 'physical', h, ab);
        if (!t.alive) return;
        t.addModifier({ id: 'confiscated', name: 'Confiscate', icon: '⛓️', debuff: true, duration: dur, disarm: true, source: h, vfxName: 'silence' });
        fx(g, 'crit', { unit: t, source: h, position: t.position.clone(), amount: dmg, color: 0xb090ff });
      };
      orderAfterCast(h, ab, { type: 'attack', target: t });
      if (h.immobile || dist2d(h.position, dest) < 0.3) land();
      else forceMove(g, h, dest, ab.v('jumpTime'), { id: 'confiscate_lunge', onEnd: land });
    },
  },
  {
    id: 'ormund_no_free_passage', name: 'No Free Passage', icon: '🚧', targetType: 'passive',
    description: "Enemies within 350 of Ormund that have their backs to him are slowed. A unit's back is to him when it faces more than 90 degrees away from him. The slow lasts 0.6 seconds after it last applied.",
    radius: du(350), values: { slow: [0.14, 0.2, 0.26, 0.32] },
    aura: {
      interval: 0.25,
      targets: (ab) => enemiesIn(ab.game, ab.hero, ab.hero.position, ab.getRadius()).filter((u) => u.kind !== 'ward' && !u.immobile && backTurned(u, ab.hero.position)),
      modifier: (ab) => ({ id: 'no_free_passage', name: 'No Free Passage', icon: '🚧', debuff: true, slow: ab.v('slow'), source: ab.hero, aura: true }),
    },
  },
  {
    id: 'ormund_called_to_account', name: 'Called to Account', icon: '📜', targetType: 'none', ultimate: true, castPoint: 0.4,
    description: "Ormund keeps a ledger of all damage he took in the last 6 seconds, his share from Stand Surety included. He brings his mace down and every enemy within 550 takes magical damage plus a share of the ledger, up to a cap, and is slowed by 40% for 2.5 seconds. The ledger is wiped when it is called in and when Ormund dies.",
    cooldown: [110, 100, 90], manaCost: [150, 200, 250], radius: du(550), damageType: 'magical',
    values: { damage: [130, 190, 250], returnPct: [0.4, 0.5, 0.6], cap: [200, 300, 400], window: 6, slow: 0.4, slowDuration: 2.5 },
    scepter: { description: 'The ledger covers the last 10 seconds, its cap rises to 350/450/550 and the radius grows to 700.', values: { window: 10, cap: [350, 450, 550] }, radius: du(700) },
    hint: { type: 'self', teamfight: true, minEnemies: 2 },
    onLearn(ab) {
      const bus = ab.game.bus;
      ab.data.ledger = [];
      ab.data.off?.forEach((off) => off());
      ab.data.off = [
        bus.on('unit:damaged', ({ unit, amount }) => {
          if (unit !== ab.hero || !(amount > 0)) return;
          const led = ab.data.ledger, now = ab.game.time;
          led.push({ t: now, amount });
          while (led.length && led[0].t <= now - LEDGER_KEEP) led.shift();
        }),
        bus.on('unit:died', ({ unit }) => { if (unit === ab.hero) ab.data.ledger.length = 0; }),
      ];
    },
    cast(ab) {
      const h = ab.hero, g = ab.game, r = ab.getRadius();
      const dmg = ab.v('damage') + Math.min(ab.v('cap'), ledgerTotal(ab) * ab.v('returnPct'));
      ab.data.ledger.length = 0;
      fx(g, 'shockwave', { position: h.position.clone(), radius: r, color: 0xb090ff, duration: 0.5 });
      fx(g, 'dust', { position: h.position.clone(), radius: 1.6 });
      for (const e of enemiesIn(g, h, h.position, r)) {
        if (e.kind === 'ward') continue;
        damage(e, dmg, 'magical', h, ab);
        slow(e, ab.v('slow'), ab.v('slowDuration'), h, { id: 'called_to_account_slow', name: 'Called to Account', icon: '📜' });
        fx(g, 'hit', { position: chest(e), unit: e, color: 0xb090ff });
      }
    },
  },
];
