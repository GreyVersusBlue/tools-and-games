// downtime.js — the time between the fights, and the state a fight opens in.
//
// Two halves of the same gap. Between two adventures there was nothing at all:
// `finish(true)` handed back half of missing HP and that was every form of rest
// the game had, there was no way to spend a day, and `gold` (Phase 7's second
// increment) had nowhere to be spent that was not a shop counter. Between two
// fights there was one hardcoded flag: `Combat.start` read `flags["surprise-round"]`
// and `flags["fatigued-start"]` by name, which meant the only opening state an
// author could write was the one the engine had a line for.
//
// So this file is two tables and the arithmetic that reads them:
//
//   OPENERS      — every state an encounter may begin in, keyed by the flag
//                  that turns it on. `combat.js` consumes it; `registry.js`
//                  validates against it; an author writes the flag.
//   EXPLORATION  — what a `"kind": "explore"` scene offers, and which opener
//                  each activity leaves behind for the encounter that follows.
//   DOWNTIME     — the four things a hero does between adventures, and the
//                  Player Core tables that say what each is worth.
//
// It imports nothing, for the same reason js/shop.js imports nothing:
// registry.js is the bottom of the stack and has to validate against these
// tables, and `test/smoke.mjs` drives every number here under plain Node with
// no page, no Registry and no dice.
//
// Nothing here rolls. `treatWounds` returns the formula and the bonus and lets
// the caller roll it, which is what makes the whole table assertable: a test
// pins "a critical success at Expert is 4d8 + 10" exactly, rather than pinning
// a distribution.

/* ---------- the opening state of an encounter ---------- */

/**
 * Every state an encounter can start in, keyed by the flag that sets it.
 *
 * `Combat.start` consumes each of these out of the flag map the way it always
 * consumed `surprise-round` — the flag is deleted, so it colours exactly one
 * fight and not every fight after it. That consumption is the whole reason
 * these are flags rather than scene fields: an author writes
 * `"onEnter": {"flag": "scouted"}` two scenes before the ambush, the same way
 * Barrowmoor's causeway scene has written `surprise-round` since session 3.
 *
 * The fields are what the engine does with it, not prose:
 *   surprise    — foes are off-guard in round 1 and roll initiative last.
 *   conditions  — applied to every party member at the top of the fight.
 *   hidden      — the hero begins Hidden from every foe (Phase 4's detection).
 *   shield      — the hero begins with a shield raised, if they carry one.
 *   initiative  — a circumstance bonus to every party member's initiative.
 *
 * A new opener lands here and nowhere else: the engine reads the fields, the
 * validator reads the keys, and the guide's table is generated from `note`.
 */
export const OPENERS = {
  "surprise-round": {
    name: "Surprise",
    note: "Foes are off-guard for the first round and act last.",
    surprise: true
  },
  "fatigued-start": {
    name: "Fatigued",
    note: "The party starts the fight fatigued: -1 AC and -1 to every save.",
    conditions: [{ c: "fatigued", v: 1, dur: 99 }]
  },
  "scouted": {
    name: "Scouted",
    note: "You saw them first: +2 circumstance bonus to the party's initiative.",
    initiative: 2
  },
  "hero-hidden": {
    name: "Unseen",
    note: "The hero begins Hidden from every foe, and stays hidden until they move or strike.",
    hidden: true
  },
  "shield-braced": {
    name: "Braced",
    note: "The hero enters with their shield already raised (+2 AC), if they carry one.",
    shield: true
  }
};

/** The flag names an encounter opener answers to. The validator's vocabulary. */
export const OPENER_FLAGS = Object.keys(OPENERS);

/* ---------- exploration, inside a scene ---------- */

/**
 * What a `"kind": "explore"` scene offers, in the order it renders them.
 *
 * Each one is a single check against the scene's DC, and each one leaves an
 * opener behind for whatever encounter comes next. Picking one is picking
 * *not* to do the other two, which is the entire decision: Search buys you the
 * first move, Avoid Notice buys you the first strike from somewhere they are
 * not looking, and Defend buys you the hit you were going to take anyway.
 *
 * `skill` is the skill the check rolls; `null` means the activity has no roll
 * at all. Defend is the one of those — bracing a shield is not a gamble, it
 * just costs you the other two activities, and an author who wants it to be a
 * gamble writes an ordinary check-and-goto scene instead.
 */
export const EXPLORATION = [
  {
    id: "search",
    name: "Search",
    skill: "perception",
    opener: "scouted",
    desc: "Move slowly and read the ground. On a success you see them before they see you."
  },
  {
    id: "avoid-notice",
    name: "Avoid Notice",
    skill: "stealth",
    opener: "hero-hidden",
    desc: "Keep to cover and take the long way. On a success you open the fight unseen."
  },
  {
    id: "defend",
    name: "Defend",
    skill: null,
    opener: "shield-braced",
    desc: "Shield up, pace short, eyes front. Slower, and nothing catches you flat."
  }
];

/** The activity ids a scene's `explore.activities` may name. */
export const EXPLORATION_IDS = EXPLORATION.map(a => a.id);

/** One activity by id, or null. */
export function explorationById(id) {
  return EXPLORATION.find(a => a.id === id) || null;
}

/**
 * The activities a scene offers: everything, unless it names a subset.
 *
 * An unknown id is dropped rather than rendered as an empty card, and the
 * validator rejects it separately — this function is what the page calls, and
 * the page has already loaded a pack that may predate a rename.
 */
export function activitiesFor(scene) {
  const named = scene && Array.isArray(scene.explore && scene.explore.activities)
    ? scene.explore.activities : null;
  if (!named) return EXPLORATION.slice();
  return named.map(explorationById).filter(Boolean);
}

/**
 * A degree of success from a check turns into the opener flag it earns, or
 * null. A success or better earns it; a failure earns nothing, and a critical
 * failure earns nothing either — the punishment for creeping badly is the
 * ordinary fight, not a worse one. An author who wants a botched Avoid Notice
 * to open with the party fatigued writes `fatigued-start` on the scene it
 * fails into, where the player can read it.
 */
export function openerFor(activity, deg) {
  if (!activity) return null;
  if (activity.skill === null) return activity.opener;
  return deg >= 2 ? activity.opener : null;
}

/* ---------- downtime, between adventures ---------- */

/**
 * The four things a hero does with a day. `skill` is what the activity rolls,
 * `null` for the one that does not roll.
 */
export const DOWNTIME = [
  { id: "rest", name: "Long Rest", skill: null,
    desc: "Eight hours, a fire, and somebody else on watch. HP back, spells back, one step off Wounded." },
  { id: "treat-wounds", name: "Treat Wounds", skill: "medicine",
    desc: "Bandages, a needle, and an hour. Heals a die of damage against a DC your Medicine rank sets." },
  { id: "earn-income", name: "Earn Income", skill: null,
    desc: "A day's honest work at a task of your own level. Paid by the Player Core's table, by how well it went." },
  { id: "craft", name: "Craft", skill: "crafting",
    desc: "Half the price in materials and four days at a bench, and every extra day pays off some of the rest." }
];

/** One downtime activity by id, or null. */
export function downtimeById(id) {
  return DOWNTIME.find(a => a.id === id) || null;
}

/**
 * A long rest, in HP: "your Constitution modifier multiplied by your level
 * (minimum 1 HP)". A Constitution penalty does not heal you backwards, and a
 * level-1 hero with a +0 Constitution still gets the floor.
 */
export function restHP(conMod, level) {
  const c = Math.floor(Number(conMod) || 0);
  const l = Math.max(1, Math.floor(Number(level) || 1));
  return Math.max(1, c * l);
}

/**
 * Treat Wounds, by Medicine rank: the DC you attempt and the bonus HP that DC
 * buys. Untrained cannot Treat Wounds at all, which is why "U" is absent
 * rather than mapped to 15.
 */
export const TREAT_DC = { T: 15, E: 20, M: 30, L: 40 };
export const TREAT_BONUS = { T: 0, E: 10, M: 30, L: 50 };

/**
 * What a Treat Wounds check of this degree is worth, as a formula for the
 * caller to roll and a flat bonus to add to it.
 *
 * A plain failure returns a null formula rather than "0d8": nothing is rolled,
 * because a die the caller has to roll and then discard is a die that ends up
 * in the Chronicle saying the hero healed 0.
 *
 * `harm` is the critical failure: 1d8 damage to the patient, and no bonus —
 * a botched Expert attempt hurts exactly as much as a botched trained one.
 * A rank the table does not know returns null, which is "this hero cannot
 * Treat Wounds", not "this heals nothing".
 */
export function treatWounds(rank, deg) {
  if (!Object.prototype.hasOwnProperty.call(TREAT_DC, rank)) return null;
  const bonus = TREAT_BONUS[rank];
  if (deg >= 3) return { formula: "4d8", bonus, harm: false };
  if (deg === 2) return { formula: "2d8", bonus, harm: false };
  if (deg === 1) return { formula: null, bonus: 0, harm: false };
  return { formula: "1d8", bonus: 0, harm: true };
}

/** The DC a hero of this Medicine rank attempts, or null when they cannot. */
export function treatDC(rank) {
  return Object.prototype.hasOwnProperty.call(TREAT_DC, rank) ? TREAT_DC[rank] : null;
}

/**
 * The Player Core's Income Earned table, in **copper** (js/shop.js explains
 * why every coin in this game is counted in the smallest one), by task level
 * and then by proficiency rank. `F` is the failure column, which pays a
 * pittance rather than nothing.
 *
 * Row 11 exists for one reason: a critical success pays the row for the task
 * level **plus one**, and MAX_LEVEL is 10, so a legendary hero critting their
 * own level's task falls off the end of the table without it.
 */
export const INCOME_BY_LEVEL = {
  0:  { F: 1,  T: 5,   E: 5,   M: 5,   L: 5 },
  1:  { F: 2,  T: 20,  E: 20,  M: 20,  L: 20 },
  2:  { F: 4,  T: 30,  E: 30,  M: 30,  L: 30 },
  3:  { F: 8,  T: 50,  E: 50,  M: 50,  L: 50 },
  4:  { F: 10, T: 70,  E: 80,  M: 80,  L: 80 },
  5:  { F: 20, T: 90,  E: 100, M: 100, L: 100 },
  6:  { F: 30, T: 150, E: 200, M: 200, L: 200 },
  7:  { F: 40, T: 200, E: 250, M: 250, L: 250 },
  8:  { F: 50, T: 250, E: 300, M: 300, L: 300 },
  9:  { F: 60, T: 300, E: 400, M: 400, L: 400 },
  10: { F: 70, T: 400, E: 500, M: 600, L: 600 },
  11: { F: 80, T: 500, E: 600, M: 800, L: 800 }
};

/**
 * A day of Earn Income, in copper.
 *
 *   critical success — the row one task level higher, same rank.
 *   success          — the row for the task level and rank.
 *   failure          — the failure column, which is a day's board and not
 *                      much else.
 *   critical failure — nothing, and the job is over.
 *
 * An untrained hero earns the failure column at best, because Earn Income is a
 * trained action: `rank` of "U" reads the `F` cell whatever the roll said.
 */
export function earnIncome(taskLevel, deg, rank) {
  const l = Math.max(0, Math.min(11, Math.floor(Number(taskLevel) || 0)));
  const r = Object.prototype.hasOwnProperty.call(INCOME_BY_LEVEL[l], rank) ? rank : "F";
  if (deg <= 0) return 0;
  if (deg === 1 || r === "F") return INCOME_BY_LEVEL[l].F;
  if (deg >= 3) return INCOME_BY_LEVEL[Math.min(11, l + 1)][r];
  return INCOME_BY_LEVEL[l][r];
}

/** The number of days Crafting takes before you may finish it at all. */
export const CRAFT_DAYS = 4;

/**
 * What an item actually costs to Craft, in copper.
 *
 * The Player Core's shape, kept whole: half the price up front in materials,
 * four days at the bench, and then either pay the rest or spend more days,
 * each of which knocks your own Earn Income for the day off what is still
 * owed. `perDay` is that rate — `earnIncome(heroLevel, 2, craftingRank)` — so
 * a hero who is better at Crafting finishes cheaper, which is the incentive
 * the rule exists to create.
 *
 * Rounding goes against the hero: materials are the ceiling half, so a 5 cp
 * item costs 3 cp in materials and 2 cp to finish, never 2 and 2.
 */
export function craftCost(price, extraDays, perDay) {
  const p = Math.max(0, Math.floor(Number(price) || 0));
  const days = Math.max(0, Math.floor(Number(extraDays) || 0));
  const rate = Math.max(0, Math.floor(Number(perDay) || 0));
  const materials = Math.ceil(p / 2);
  const owed = p - materials;
  const remainder = Math.max(0, owed - days * rate);
  return { materials, owed, remainder, total: materials + remainder, days: CRAFT_DAYS + days };
}

/**
 * The most extra days that are worth spending: one more than that pays for
 * nothing. Zero when the rate is zero, which is an untrained hero at a bench.
 */
export function craftDaysToFree(price, perDay) {
  const { owed } = craftCost(price, 0, perDay);
  const rate = Math.max(0, Math.floor(Number(perDay) || 0));
  return rate > 0 ? Math.ceil(owed / rate) : 0;
}
