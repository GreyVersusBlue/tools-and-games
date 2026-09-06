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

/** The three saving throws, exactly as a stat block writes them. */
export const SAVE_STATS = Object.freeze(["fort", "ref", "will"]);

/** `saveKind("ref")` → `"save-ref"`. One spelling, in one place. */
export function saveKind(stat) {
  if (!SAVE_STATS.includes(stat)) {
    throw new Error(`conditions: unknown save "${stat}" (want ${SAVE_STATS.join(", ")})`);
  }
  return `save-${stat}`;
}

/**
 * Every number a condition is allowed to move.
 *
 * One entry per number this engine actually rolls or sets, because the whole
 * point of the funnel is that a condition cannot half-apply. The list is finer
 * than increment 1's four:
 *
 * - **`attack-str` and `attack-dex`** are separate because PF2e's two most
 *   ordinary debuffs disagree about which one they hit. Enfeebled is a penalty
 *   to Strength-based attacks and clumsy to Dexterity-based ones, and a single
 *   `attack` kind makes Vesper's finesse dagger and Kessa's longsword the same
 *   weapon. A command says which ability swings it.
 * - **`damage`** is the hole increment 1 left. Every `rollDamage` call site
 *   added the weapon's own `plus` and nothing else, which is the same
 *   hardcoding `turn.shielded` was, one layer down. Enfeebled is unwritable
 *   without it.
 * - **The three saves are separate** because clumsy is Reflex and stupefied is
 *   Will, and folding them into one `save` makes both of them frightened with
 *   a different name.
 * - **`ac` and `spell-dc`** are DCs somebody else rolls against, not checks.
 *   They are in the same list rather than a list of their own because in PF2e
 *   a status penalty hits both directions from one number — a frightened
 *   creature is worse at hitting, easier to hit, and worse at being resisted —
 *   and modelling that as two systems is how the two drift apart.
 */
export const MODIFIER_KINDS = Object.freeze([
  "attack-str", "attack-dex", "damage",
  "save-fort", "save-ref", "save-will",
  "ac", "perception", "spell-dc",
]);

/** Which ability an attack roll uses. A pack says so per command. */
export const ATTACK_ABILITIES = Object.freeze(["str", "dex"]);

/** `attackKind("dex")` → `"attack-dex"`. */
export function attackKind(ability) {
  if (!ATTACK_ABILITIES.includes(ability)) {
    throw new Error(`conditions: unknown attack ability "${ability}" (want ${ATTACK_ABILITIES.join(", ")})`);
  }
  return `attack-${ability}`;
}

/**
 * Where a damage roll came from.
 *
 * The funnel needs this because enfeebled moves weapon damage and nothing
 * else: a spell's damage comes off the caster's proficiency, persistent damage
 * is the condition itself ticking, and healing is not damage at all. A caller
 * that had to guess would guess wrong once and then be wrong forever, so every
 * `rollDamage` in game.js names its source out loud.
 */
export const DAMAGE_SOURCES = Object.freeze(["weapon", "spell", "persistent", "healing"]);

/** The only source a condition can move. */
const MODIFIED_DAMAGE = "weapon";

/**
 * Traits a condition carries, for immunity.
 *
 * Closed, the way the tile names and the trigger names are closed. Every
 * creature in this pack is a construct and PF2e constructs are immune to
 * mental effects, so `frightened` is the one that can bounce.
 */
export const CONDITION_TRAITS = Object.freeze(["mental"]);

/**
 * Bonus types — Player Core p.443.
 *
 * Two bonuses of the same type do not stack: you take the highest bonus and
 * the worst penalty of each type, and untyped ones stack with everything. It
 * mattered the first time two things wanted to move the same number, which is
 * now: off-guard is a circumstance penalty to AC and the Shield cantrip is a
 * circumstance bonus to it, and clumsy and frightened are both status
 * penalties to AC from two different conditions.
 */
export const BONUS_TYPES = Object.freeze(["status", "circumstance", "item"]);

/**
 * How long a condition lasts when whatever applied it did not say.
 *
 * `"self-start"` is "until the start of your next turn" and `"self-end"` is
 * "until the end of it"; both name the afflicted actor's own turn, which is
 * what "self" means here. The difference is not cosmetic for anything that
 * costs an action: a slowed that expired at the start of your turn would come
 * off before the turn had any actions to take away from it, so slowed is
 * `self-end` and off-guard — which is about footing you recover — is
 * `self-start`.
 */
export const DEFAULT_UNTILS = Object.freeze({ "self-start": "start", "self-end": "end" });

/**
 * The catalogue.
 *
 * A definition says what a condition is worth per point of value, what type of
 * bonus that is, whether its value wears off at the end of the afflicted
 * actor's turn, whether it deals damage there, what it costs in actions, what
 * traits it carries, and how long it lasts when nothing says otherwise.
 * Content names these ids; content.js refuses a pack that names one that is not
 * here, for the same reason it refuses an unknown tile: a condition that
 * validates and never fires is silence a content author cannot debug.
 */
export const CONDITIONS = Object.freeze({
  shielded: Object.freeze({
    id: "shielded",
    name: "Shielded",
    // The chip reads "Shielded", not "Shielded 1": the value here is the
    // pack's own acBonus, not a stack count, and showing it would invite a
    // player to read it as one.
    showsValue: false,
    // The one condition in the catalogue anybody wants. ui.js and render.js
    // ask this rather than naming the id, which is what stops the marker over
    // an afflicted creature from turning on for a buff the day a second one
    // exists.
    helpful: true,
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
    // and to every DC. Both directions, from the one number — which is why it
    // is the only entry that names all nine kinds.
    affects: Object.freeze({
      "attack-str": -1, "attack-dex": -1,
      "save-fort": -1, "save-ref": -1, "save-will": -1,
      ac: -1, perception: -1, "spell-dc": -1,
    }),
    decays: 1,
    traits: Object.freeze(["mental"]),
    note: "Player Core p.446. A status penalty to every check and every DC. Reduces by 1 at the end of each of your turns. Mental — a construct cannot be frightened.",
  }),
  "off-guard": Object.freeze({
    id: "off-guard",
    name: "Off-Guard",
    // Off-guard has no value in PF2e: it is a flat −2 and there is no such
    // thing as off-guard 2. The chip says so by not showing a number.
    showsValue: false,
    bonusType: "circumstance",
    affects: Object.freeze({ ac: -2 }),
    defaultUntil: "self-start",
    note: "Player Core p.446. A −2 circumstance penalty to AC. Circumstance, like the Shield cantrip's disc — the disc's +1 and this −2 do not add up to −1 by stacking, they resolve to −1 because the best bonus and the worst penalty of a type are what count.",
  }),
  clumsy: Object.freeze({
    id: "clumsy",
    name: "Clumsy",
    showsValue: true,
    bonusType: "status",
    // Player Core p.444: a status penalty to Dexterity-based checks and DCs.
    // In this engine that is AC, Reflex saves and a finesse attack, and it is
    // exactly why `attack` had to split in two.
    affects: Object.freeze({ "attack-dex": -1, "save-ref": -1, ac: -1 }),
    defaultUntil: "self-end",
    note: "Player Core p.444. A status penalty to Dexterity-based checks and DCs: AC, Reflex saves, and an attack made with a finesse weapon.",
  }),
  enfeebled: Object.freeze({
    id: "enfeebled",
    name: "Enfeebled",
    showsValue: true,
    bonusType: "status",
    // Player Core p.444: Strength-based rolls, which is where the damage kind
    // earns its place. A finesse weapon still adds Strength to damage even
    // when Dexterity swung it, so this hits the dagger's damage and not the
    // dagger's attack roll.
    affects: Object.freeze({ "attack-str": -1, damage: -1 }),
    defaultUntil: "self-end",
    note: "Player Core p.444. A status penalty to Strength-based attack rolls and to melee weapon damage — including a finesse weapon's, because finesse changes what swings the blade and not what puts weight behind it.",
  }),
  stupefied: Object.freeze({
    id: "stupefied",
    name: "Stupefied",
    showsValue: true,
    bonusType: "status",
    // Player Core p.447: Intelligence-, Wisdom- and Charisma-based checks and
    // DCs, which here is Will saves and the heir's spell DC.
    affects: Object.freeze({ "save-will": -1, "spell-dc": -1 }),
    // And the part that actually hurts: a flat check to cast at all, DC 5 plus
    // the value. A flat check takes no modifiers (Player Core p.409), so
    // game.js rolls it as a bare die rather than through the funnel.
    castFlatDC: 5,
    defaultUntil: "self-end",
    note: "Player Core p.447. A status penalty to Will saves and to your spell DC, and a DC 5 + value flat check every time you Cast a Spell. Fail it and the spell is lost along with the actions.",
  }),
  slowed: Object.freeze({
    id: "slowed",
    name: "Slowed",
    showsValue: true,
    // No bonusType and no `affects`: slowed moves no number at all. It is the
    // first condition in this catalogue that touches the action economy
    // instead, which is why it is the one that proves the bag is read
    // somewhere other than the modifier funnel.
    costsActions: 1,
    defaultUntil: "self-end",
    note: "Player Core p.446. You lose this many actions at the start of your turn. Nothing else about you changes.",
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
    note: "Player Core p.409, persistent damage. 1d4 fire at the end of your turn, then a DC 15 flat check to put it out. A particularly appropriate action — Rousing Splash — lowers that check to DC 10.",
  }),
});

export const CONDITION_IDS = Object.freeze(Object.keys(CONDITIONS));

export const isCondition = id => Object.prototype.hasOwnProperty.call(CONDITIONS, id);
export const defOf = id => CONDITIONS[id] || null;

/**
 * The duration a condition carries when whatever applied it did not say one.
 *
 * `whoKey` is the afflicted actor's key, because "self" is a sentence about
 * the wearer and `tick` only understands actor keys. A condition with no
 * default — frightened, which decays, and persistent fire, which ends on a
 * flat check — comes back null, and null means "until something takes it off".
 */
export function defaultUntilFor(id, whoKey) {
  const def = CONDITIONS[id];
  if (!def || !def.defaultUntil) return null;
  const when = DEFAULT_UNTILS[def.defaultUntil];
  if (!when) return null;
  return { who: whoKey, when };
}

/**
 * Which trait of `id` this list of immunities blocks, or null.
 *
 * Returns the trait rather than a boolean so the log line can say *why*: "the
 * sentinel is immune to mental effects" is a rule a player can learn, and
 * "nothing happens" is a bug report.
 */
export function immunityTo(id, immunities) {
  const def = CONDITIONS[id];
  if (!def || !def.traits || !immunities || !immunities.length) return null;
  for (const t of def.traits) if (immunities.includes(t)) return t;
  return null;
}

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

/**
 * What this bag is worth to a damage roll from `source`.
 *
 * Separate from `modifiers` because the answer is "nothing" for three of the
 * four sources and the caller must not be the one deciding that: a spell's
 * damage, a persistent condition's own tick and a healing roll are all
 * `rollDamage` calls that enfeebled has no business touching, and a funnel
 * that let each site guess would be the hardcoding it replaced.
 */
export function damageModifiers(bag, source) {
  if (!DAMAGE_SOURCES.includes(source)) {
    throw new Error(`conditions: unknown damage source "${source}" (want ${DAMAGE_SOURCES.join(", ")})`);
  }
  if (source !== MODIFIED_DAMAGE) return 0;
  return modifiers(bag, "damage");
}

/**
 * How many actions this bag leaves of `base`.
 *
 * The one place the bag is read outside the modifier funnel, because slowed is
 * not a number on a roll: it is a turn with fewer things in it. Floored at 0 —
 * slowed 4 is slowed 3, not a turn that owes actions back.
 */
export function actionsFor(bag, base = 3) {
  let lost = 0;
  for (const c of bag || []) {
    const def = CONDITIONS[c.id];
    if (def && def.costsActions) lost += def.costsActions * c.value;
  }
  return Math.max(0, base - lost);
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
