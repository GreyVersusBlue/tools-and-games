// conditions.js — what is stuck to an actor, what it does to a number, and
// when it stops being true.
//
// Pure, and RNG-free. A bag of conditions is an ordinary array of
// `{ id, value, until }` that lives on the saved run — `run.pc.conditions` and
// a `conditions` array on each creature — so everything here is a function of
// that array and nothing else. There is no state in this module, and the one
// thing it deliberately does not do is roll: persistent damage hands back the
// spec it wants rolled and game.js rolls it, because a flat check for a value
// this module chose would make test/balance.mjs unable to replay a run.
//
// The shape it replaces is `turn.shielded`, a boolean on a runtime object that
// was the whole of this engine's status-effect system. Every check in game.js
// now routes its bonus through one funnel, and the deletion of that boolean is
// the proof the funnel is real: if anything still read it, it would be here.

import { parseDamage } from "./rules.js";

/**
 * The four things a condition can move.
 *
 * `attack` and `perception` and `save` are the actor's own d20 checks;
 * `ac` is the DC somebody else rolls against. AC is in the same list rather
 * than in a list of its own because in PF2e a status penalty hits both — a
 * frightened creature is worse at hitting and easier to hit, and modelling
 * that as two systems is how the two drift apart.
 */
export const MODIFIER_KINDS = Object.freeze(["attack", "save", "ac", "perception"]);

/**
 * Bonus types — Player Core p.443.
 *
 * Two bonuses of the same type do not stack: you take the highest bonus and
 * the worst penalty of each type, and untyped ones stack with everything. It
 * matters the first time two things want to move the same number, and this
 * catalogue is one condition away from that, which is why the rule is here
 * now rather than the day something breaks quietly.
 */
export const BONUS_TYPES = Object.freeze(["status", "circumstance", "item"]);

/**
 * The catalogue.
 *
 * A definition says what a condition is worth per point of value, what type
 * of bonus that is, whether its value wears off at the end of the afflicted
 * actor's turn, and whether it deals damage there. Content names these ids;
 * content.js refuses a pack that names one that is not here, for the same
 * reason it refuses an unknown tile: a condition that validates and never
 * fires is silence a content author cannot debug.
 */
export const CONDITIONS = Object.freeze({
  shielded: Object.freeze({
    id: "shielded",
    name: "Shielded",
    // The chip reads "Shielded", not "Shielded 1": the value here is the
    // pack's own acBonus, not a stack count, and showing it would invite a
    // player to read it as one.
    showsValue: false,
    bonusType: "circumstance",
    affects: Object.freeze({ ac: 1 }),
    note: "The Shield cantrip's disc of force. Ends at the start of your next turn, or when you block with it.",
  }),
  frightened: Object.freeze({
    id: "frightened",
    name: "Frightened",
    showsValue: true,
    bonusType: "status",
    // Player Core p.446: a status penalty equal to the value, to every check
    // and to every DC. Both directions, from the one number.
    affects: Object.freeze({ attack: -1, save: -1, perception: -1, ac: -1 }),
    decays: 1,
    note: "Player Core p.446. Reduces by 1 at the end of each of your turns.",
  }),
  "persistent-fire": Object.freeze({
    id: "persistent-fire",
    name: "Burning",
    showsValue: false,
    persistent: Object.freeze({
      damage: Object.freeze(parseDamage("1d4")),
      dtype: "fire",
      // Player Core p.409: a DC 15 flat check at the end of your turn ends it.
      // A flat check takes no modifiers at all, which is why it is the one
      // d20 in this engine that does not go through the condition funnel.
      flatDC: 15,
    }),
    note: "Player Core p.409, persistent damage. 1d4 fire at the end of your turn, then a DC 15 flat check to put it out.",
  }),
});

export const CONDITION_IDS = Object.freeze(Object.keys(CONDITIONS));

export const isCondition = id => Object.prototype.hasOwnProperty.call(CONDITIONS, id);
export const defOf = id => CONDITIONS[id] || null;

/** When a duration can end: at the start or the end of some actor's turn. */
const WHENS = ["start", "end"];

/**
 * Build one condition, or throw.
 *
 * Throws rather than returning a sentinel for the reason parseDamage does: a
 * condition that quietly becomes `{ id: undefined, value: NaN }` is a modifier
 * that adds NaN to every check its owner makes for the rest of the run, and
 * this repo has shipped that bug once already (v7 §2, the staffer with a NaN
 * walking speed).
 */
export function makeCondition(id, { value = 1, until = null } = {}) {
  if (!isCondition(id)) throw new Error(`conditions: unknown condition "${id}"`);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`conditions: "${id}" needs an integer value of 1 or more, got ${value}`);
  }
  if (until !== null) {
    if (!until || typeof until.who !== "string" || !WHENS.includes(until.when)) {
      throw new Error(`conditions: "${id}" until must be null or {who, when:"start"|"end"}`);
    }
    until = { who: until.who, when: until.when };
  }
  return { id, value, until };
}

export const hasCondition = (bag, id) => (bag || []).some(c => c.id === id);
export const findCondition = (bag, id) => (bag || []).find(c => c.id === id) || null;
export const valueOf = (bag, id) => (findCondition(bag, id)?.value ?? 0);

/**
 * Add one, and hand back a new bag.
 *
 * A second instance of the same condition does not stack — the higher value
 * wins (Player Core p.444). An equal value replaces, which is what makes
 * re-applying a duration refresh it rather than leave the old expiry standing.
 * Every function here returns a new array rather than mutating: the bag on the
 * run is a saved field, and a mutation in place is a save the autosave layer
 * can have already snapshotted half of.
 */
export function addCondition(bag, cond) {
  const out = [];
  let merged = false;
  for (const c of bag || []) {
    if (c.id !== cond.id) { out.push(c); continue; }
    merged = true;
    out.push(cond.value >= c.value ? { ...cond } : { ...c });
  }
  if (!merged) out.push({ ...cond });
  return out;
}

export function removeCondition(bag, id) {
  return (bag || []).filter(c => c.id !== id);
}

/**
 * What this bag is worth to one kind of number.
 *
 * The same-type rule, in the four lines it takes: bonuses and penalties of a
 * type do not stack, so keep the best bonus and the worst penalty of each
 * type and sum what is left. An untyped condition stacks with everything,
 * which is why it gets a bucket of its own per entry.
 */
export function modifiers(bag, kind) {
  if (!MODIFIER_KINDS.includes(kind)) {
    throw new Error(`conditions: unknown modifier kind "${kind}" (want ${MODIFIER_KINDS.join(", ")})`);
  }
  const best = new Map();       // bonusType -> { up, down }
  let untyped = 0;
  for (const c of bag || []) {
    const def = CONDITIONS[c.id];
    if (!def || !def.affects) continue;
    const per = def.affects[kind];
    if (!per) continue;
    const amount = per * c.value;
    if (!def.bonusType) { untyped += amount; continue; }
    const slot = best.get(def.bonusType) || { up: 0, down: 0 };
    if (amount > 0) slot.up = Math.max(slot.up, amount);
    else slot.down = Math.min(slot.down, amount);
    best.set(def.bonusType, slot);
  }
  let total = untyped;
  for (const slot of best.values()) total += slot.up + slot.down;
  return total;
}

/** The persistent damage in this bag, as specs for the caller to roll. */
export function persistentIn(bag) {
  const out = [];
  for (const c of bag || []) {
    const def = CONDITIONS[c.id];
    if (def && def.persistent) out.push({ id: c.id, ...def.persistent });
  }
  return out;
}

/**
 * Move one turn boundary.
 *
 * `owner` is whose bag this is; `boundary` is whose turn is starting or
 * ending. The two are separate because a duration is allowed to name somebody
 * else's turn — "until the start of your next turn" on a condition you put on
 * a creature expires at *your* boundary, not its — while a value that wears
 * off does so at the end of the afflicted actor's own turn and nowhere else.
 * Collapsing them is the bug where a frightened creature loses a point every
 * time anybody in the initiative order finishes a turn.
 *
 * Returns a new bag and the list of what came off, so the caller can write a
 * line for each: a condition that vanishes silently is one the player has to
 * infer from arithmetic.
 */
export function tick(bag, owner, boundary, when) {
  const out = [];
  const expired = [];
  for (const c of bag || []) {
    if (c.until && c.until.who === boundary && c.until.when === when) {
      expired.push({ id: c.id, value: c.value, why: "duration" });
      continue;
    }
    const def = CONDITIONS[c.id];
    if (def && def.decays && owner === boundary && when === "end") {
      const value = c.value - def.decays;
      if (value < 1) { expired.push({ id: c.id, value: c.value, why: "decayed" }); continue; }
      out.push({ ...c, value });
      continue;
    }
    out.push(c);
  }
  return { bag: out, expired };
}

/** "Frightened 2", "Shielded" — for a chip, a log line, or a screen reader. */
export function describe(cond) {
  const def = CONDITIONS[cond.id];
  if (!def) return String(cond.id);
  return def.showsValue ? `${def.name} ${cond.value}` : def.name;
}

/**
 * Clean a bag off a save.
 *
 * Same job as save.js's `repair`, and it runs from there: drop conditions this
 * build no longer defines (the catalogue shrank between sessions), clamp a
 * value that is not a positive integer, drop an `until` that is not shaped
 * like one, and collapse a duplicated id down to its highest value. A save
 * with no `conditions` key at all — every save written before this phase —
 * comes through as an empty array, which is the whole of the migration (#37).
 */
export function repairBag(raw) {
  if (!Array.isArray(raw)) return [];
  let bag = [];
  for (const c of raw) {
    if (!c || !isCondition(c.id)) continue;
    const value = Math.round(Number(c.value));
    if (!Number.isFinite(value) || value < 1) continue;
    let until = null;
    if (c.until && typeof c.until.who === "string" && WHENS.includes(c.until.when)) {
      until = { who: c.until.who, when: c.until.when };
    }
    bag = addCondition(bag, { id: c.id, value: Math.min(value, 99), until });
  }
  return bag;
}

/**
 * What goes into a snapshot — `undefined` for an empty bag.
 *
 * The phase's rule was additive: a save from a run with no conditions carries
 * no `conditions` key at all, so a save written by this build and a save
 * written before this build are byte-identical when nothing is afflicted.
 */
export function packBag(bag) {
  if (!bag || !bag.length) return undefined;
  return bag.map(c => ({ id: c.id, value: c.value, until: c.until ? { ...c.until } : null }));
}
