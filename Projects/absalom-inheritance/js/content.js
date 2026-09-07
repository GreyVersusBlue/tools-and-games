// content.js — read a content pack, refuse a broken one, hand back a usable
// object with the strings already parsed into numbers.
//
// The rule here is the same one gvb-save applies to a save file: reject at the
// door rather than let a missing field turn into an `undefined` that multiplies
// into somebody's damage roll three modules later. An author who mistypes
// "1d6+" gets a line number's worth of complaint at load, not a sentinel that
// silently hits for nothing.
//
// Pure — no DOM, no fetch. `loadPack` takes an already-parsed object so the
// browser can fetch() it and a Node test can readFileSync it.

import { parseDamage } from "./rules.js";
import { TILE_ID_BY_NAME, TILE_NAMES } from "./world.js";
import {
  CONDITION_IDS, CONDITION_TRAITS, ATTACK_ABILITIES, SAVE_STATS, isCondition, defOf,
} from "./conditions.js";
import { AI_KINDS } from "./ai.js";

/**
 * The three points at which this engine's turn loop can be interrupted, and
 * the two things a reaction is allowed to do when it is.
 *
 * These are closed vocabularies for the same reason the tile names are: a
 * command whose `triggers` names a fourth event would sit in the pack looking
 * correct and never fire, which is the kind of silence a content author cannot
 * debug. `game.js` fires exactly these three names and nothing else, and
 * `smoke.mjs` asserts the two lists match.
 *
 * The names are Torchbearer's. Its `js/combat.js` shipped the same seam first
 * (its Phase 3), and the two projects agreed to spell the events the same way
 * even though locked #17 keeps them from sharing a line of code — an engine
 * that calls the moment "move-out-of-reach" and another that calls it
 * "leaves-reach" makes every future comparison an act of translation.
 */
export const REACTION_TRIGGERS = Object.freeze([
  // A Strike is about to be rolled. Fired from both sides of the board.
  "incoming-attack",
  // Someone has just stepped out of a square within the reactor's reach.
  "move-out-of-reach",
  // Damage is resolved and about to land. The last point at which it can be
  // reduced, and the only one at which the number is known.
  "incoming-damage",
]);

/** What a reaction does when it fires. */
export const REACTION_EFFECTS = Object.freeze([
  // A Strike back, at no MAP. The PC's numbers come from the command; a
  // creature's come from its own stat block, because a basalt fist is not a
  // longsword whichever feat swings it.
  "strike",
  // Reduce `ctx.dmg` by `hardness`, before a single hit point moves.
  "reduce",
]);

const KINDS = ["attack", "buff", "debuff", "self-heal", "cone", "burst", "emanation", "unerring", "consume", "reaction"];

/**
 * The kinds whose save needs a DC from somewhere.
 *
 * The three area shapes, and now `debuff` — the kind whose entire effect is a
 * condition on something that failed a save. It reads its DC by exactly the
 * same rule and for exactly the same reason: a spell rolls against the heir's
 * spell DC, so stupefied moves it, and anything else writes its own number
 * down.
 */
const DC_KINDS = Object.freeze(["cone", "burst", "emanation", "debuff"]);

/**
 * The kinds that put a shape on the board rather than picking a creature.
 *
 * All three resolve the same way — everything standing in the template rolls
 * one basic save against one DC — and they differ only in where the shape
 * starts: a cone from you toward a click, a burst around a click you have
 * range and line of effect to, an emanation around you.
 */
export const AREA_KINDS = Object.freeze(["cone", "burst", "emanation"]);

/**
 * When something a pack writes leaves a condition behind.
 *
 * "hit" and "crit" read the attacker's own degree of success; "fail" and
 * "crit-fail" read the *target's*, which is the shape a save wants — a
 * creature that critically fails its Reflex save against a cone catches fire,
 * and the roll that decides it is the creature's, not the caster's. "fail" is
 * "failure or worse", the mirror of what "hit" means on the other side, and it
 * is here because a `debuff` is a command with nothing in it but the condition:
 * one that only fired on a critical failure would be a build built on a
 * one-in-five. One closed list,
 * the way the trigger names and the tile names are closed, because an
 * `inflicts` naming "critfail" would sit in the pack looking correct and
 * never fire.
 */
export const INFLICT_ON = Object.freeze(["hit", "crit", "fail", "crit-fail"]);

/**
 * Validate an `inflicts` block off a command or a creature.
 *
 * One object or an array of them, and the result is always an array or null —
 * the Keeper's fist leaves two things behind and a single-object shape would
 * have made the second one a schema change instead of a comma. A pack that
 * writes the old single object still validates, because every pack that
 * already exists writes one.
 */
function readInflicts(raw, where) {
  if (raw === undefined || raw === null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  need(list.length > 0, `content: ${where} inflicts must not be an empty array`);
  const seen = new Set();
  const out = list.map(one => {
    need(one && typeof one === "object", `content: ${where} inflicts must be an object or an array of them`);
    need(isCondition(one.condition),
      `content: ${where} inflicts names unknown condition "${one.condition}" ` +
      `(known: ${CONDITION_IDS.join(", ")})`);
    need(INFLICT_ON.includes(one.on),
      `content: ${where} inflicts needs an "on" of ${INFLICT_ON.join(", ")}, got "${one.on}"`);
    const value = one.value ?? 1;
    need(Number.isInteger(value) && value >= 1,
      `content: ${where} inflicts value must be an integer of 1 or more, got ${one.value}`);
    // Two entries naming the same condition would race through addCondition's
    // higher-value-wins merge and one of them would silently never apply.
    need(!seen.has(one.condition),
      `content: ${where} inflicts names "${one.condition}" twice`);
    seen.add(one.condition);
    return Object.freeze({ condition: one.condition, value, on: one.on });
  });
  return Object.freeze(out);
}

/**
 * Validate an `applies` block — the condition a `buff` puts up.
 *
 * The mirror of `inflicts`, minus the `on`: a buff rolls nothing, so there is
 * no degree to read and no way for it to miss. It exists because the branch it
 * replaces wrote `applyCondition("pc", "shielded", cmd.acBonus || 1, ...)` in
 * game.js — one condition id, one duration and one default, all three of them
 * hardcoded in the engine for a thing that is content. A pack could ship a
 * second buff and get the disc.
 *
 * `helpful` is checked because that is the whole of what makes this kind
 * different from `debuff`, and the catalogue already knows which conditions
 * are: a "buff" that leaves its caster clumsy would validate, fire, log, and
 * read as a renderer bug.
 */
function readApplies(raw, where) {
  if (raw === undefined || raw === null) return null;
  need(raw && typeof raw === "object" && !Array.isArray(raw), `content: ${where} applies must be an object`);
  need(isCondition(raw.condition),
    `content: ${where} applies names unknown condition "${raw.condition}" ` +
    `(known: ${CONDITION_IDS.join(", ")})`);
  need(defOf(raw.condition).helpful,
    `content: ${where} applies "${raw.condition}", which the catalogue does not call helpful — ` +
    `a buff is the kind that helps the heir, and an unhelpful one here is silence a player would read as a bug`);
  const value = raw.value ?? 1;
  need(Number.isInteger(value) && value >= 1,
    `content: ${where} applies value must be an integer of 1 or more, got ${raw.value}`);
  return Object.freeze({ condition: raw.condition, value });
}

/**
 * Validate a `precision` block — extra damage an attack deals only while its
 * target is already in some state.
 *
 * A rider on `attack` rather than a kind of its own, because it changes one
 * damage roll and nothing else about how the swing resolves. `when` names a
 * condition rather than meaning off-guard by definition: PF2e's own precision
 * damage is gated on off-guard, and writing that id into the engine would be
 * the same hardcoding the `applies` block above exists to undo.
 *
 * It has to be unhelpful for the same reason a debuff's does — a rider keyed
 * on the heir's own disc would fire on nothing this adventure ever produces.
 */
function readPrecision(raw, where) {
  if (raw === undefined || raw === null) return null;
  need(raw && typeof raw === "object" && !Array.isArray(raw), `content: ${where} precision must be an object`);
  need(typeof raw.damage === "string" && raw.damage,
    `content: ${where} precision needs a damage expression`);
  need(isCondition(raw.when),
    `content: ${where} precision names unknown condition "${raw.when}" ` +
    `(known: ${CONDITION_IDS.join(", ")})`);
  need(!defOf(raw.when).helpful,
    `content: ${where} precision fires on "${raw.when}", which the catalogue calls helpful — ` +
    `nothing in this engine puts a helpful condition on a foe, so the rider would never fire`);
  return Object.freeze({ damage: Object.freeze(parseDamage(raw.damage)), when: raw.when });
}

/**
 * Validate an `ends` block — what a command takes *off*.
 *
 * `flatDC` is there because Rousing Splash does not simply end persistent
 * fire: Player Core p.409 lets a particularly appropriate action lower the
 * flat check, and this is the number it lowers it to. A block with no flatDC
 * ends the condition outright.
 */
function readEnds(raw, where) {
  if (raw === undefined || raw === null) return null;
  need(raw && typeof raw === "object" && !Array.isArray(raw), `content: ${where} ends must be an object`);
  need(isCondition(raw.condition),
    `content: ${where} ends names unknown condition "${raw.condition}" ` +
    `(known: ${CONDITION_IDS.join(", ")})`);
  const flatDC = raw.flatDC ?? null;
  need(flatDC === null || (Number.isInteger(flatDC) && flatDC >= 2 && flatDC <= 20),
    `content: ${where} ends flatDC must be an integer 2-20 when present, got ${raw.flatDC}`);
  return Object.freeze({ condition: raw.condition, flatDC });
}

/**
 * Which ability swings an attack.
 *
 * Defaulted rather than required, because every attack in every pack that
 * predates the catalogue is a Strength attack and a required field would have
 * been a migration. Finesse is the one that has to say so — and the dagger
 * does, which is what makes clumsy and enfeebled different conditions instead
 * of the same one twice.
 */
/** A creature's turn policy. Absent is the old one-line strategy. */
function readAi(value, where) {
  const ai = value || "brawler";
  need(AI_KINDS.includes(ai),
    `content: ${where} has unknown ai "${ai}" (want ${AI_KINDS.join(", ")})`);
  return ai;
}

function readAbility(raw, where) {
  const ability = raw || "str";
  need(ATTACK_ABILITIES.includes(ability),
    `content: ${where} ability must be one of ${ATTACK_ABILITIES.join(", ")}, got "${raw}"`);
  return ability;
}

/** A closed list, like the trigger names: an unknown trait is a typo. */
function readImmunities(raw, where) {
  if (raw === undefined || raw === null) return Object.freeze([]);
  need(Array.isArray(raw), `content: ${where} immunities must be an array`);
  for (const t of raw) {
    need(CONDITION_TRAITS.includes(t),
      `content: ${where} names unknown immunity "${t}" (known: ${CONDITION_TRAITS.join(", ")})`);
  }
  return Object.freeze([...raw]);
}

/**
 * A build's three prism faces, as hex colours.
 *
 * Three and not one, because `render.js` extrudes a top diamond and two side
 * faces and shading them from a single colour would need a colour space this
 * renderer does not have. Hex only, and validated here rather than trusted:
 * a canvas fillStyle silently keeps its previous value when handed nonsense,
 * so a typo in a pack would draw the *last thing drawn*'s colour and look like
 * a renderer bug.
 */
function readPalette(raw, where) {
  need(raw && typeof raw === "object", `content: ${where} needs a palette with top, left and right`);
  const out = {};
  for (const face of ["top", "left", "right"]) {
    const v = raw[face];
    need(typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v),
      `content: ${where} palette.${face} must be a #rrggbb colour, got ${JSON.stringify(v)}`);
    out[face] = v;
  }
  return Object.freeze(out);
}

/**
 * How far the heir sees, and how far a dormant creature notices her.
 *
 * Two keys, not three. `standardDC: 15` sat in this table from the pack's
 * first commit and nothing has ever read it — the one DC 15 in the engine is
 * the persistent-damage flat check in `conditions.js`, which is Player Core
 * p.409 and not a knob a room gets to turn. A tuning key nothing reads is a
 * promise to a content author the engine does not keep, and per-area overrides
 * would have made one dead key into one per area (locked decision #173). The
 * closed key list below is what catches the next one: a room that writes
 * `standardDC` now gets a refusal naming what it may write instead.
 */
const TUNING_DEFAULTS = Object.freeze({ visionFeet: 30, noticeFeet: 30 });
const TUNING_KEYS = Object.freeze(Object.keys(TUNING_DEFAULTS));

/**
 * A tuning block, layered on a base. The pack's layers on the defaults; an
 * area's layers on the pack's, so a dark room writes `visionFeet` alone and
 * inherits the rest rather than restating a table it does not care about.
 */
function readTuning(raw, base, where) {
  if (raw === undefined || raw === null) return base;
  need(raw && typeof raw === "object" && !Array.isArray(raw),
    `content: ${where} tuning must be an object`);
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    need(TUNING_KEYS.includes(k),
      `content: ${where} tuning has unknown key "${k}" (known: ${TUNING_KEYS.join(", ")})`);
    need(typeof v === "number" && Number.isFinite(v) && v > 0,
      `content: ${where} tuning.${k} must be a positive number, got ${JSON.stringify(v)}`);
    out[k] = v;
  }
  return Object.freeze(out);
}

/**
 * What a boon can hand back.
 *
 * Closed, like the trigger names and the tile names, and for the same reason:
 * `restore: ["spells"]` validated and did nothing before this list existed,
 * because the three branches in game.js's applyRestore read the array by
 * membership and a name none of them tests for is silence.
 */
export const RESTORABLE = Object.freeze(["hp", "slots", "focus"]);

function readRestore(raw, where) {
  if (raw === undefined || raw === null) return Object.freeze([]);
  need(Array.isArray(raw), `content: ${where} restore must be an array`);
  for (const k of raw) {
    need(RESTORABLE.includes(k),
      `content: ${where} restore names unknown resource "${k}" (known: ${RESTORABLE.join(", ")})`);
  }
  need(new Set(raw).size === raw.length, `content: ${where} restore names the same resource twice`);
  return Object.freeze([...raw]);
}

class ContentError extends Error {}

function need(cond, msg) {
  if (!cond) throw new ContentError(msg);
}

/**
 * Validate and normalise a parsed pack.
 *
 * Returns a frozen object. The engine never writes to content — a run's state
 * lives in game.js — so freezing it makes "the sentinel's max HP changed
 * halfway through" impossible rather than merely unlikely.
 */
export function loadPack(raw) {
  need(raw && typeof raw === "object", "content: pack is not an object");
  need(raw.pack && raw.pack.id, "content: pack.id is required");
  need(raw.pack.schema === 1, `content: pack.schema must be 1, got ${raw.pack.schema}`);

  const tuning = readTuning(raw.tuning, TUNING_DEFAULTS, "pack");

  // ---- commands -------------------------------------------------------
  // Parsed before pcOptions because each build's own `commands` list is
  // validated against these ids.
  need(Array.isArray(raw.commands) && raw.commands.length, "content: commands must be a non-empty array");
  const commands = raw.commands.map(c => {
    need(c.id && c.name, "content: every command needs an id and a name");
    // A reaction costs a reaction, which is not one of the three actions, so
    // it is the one kind allowed to cost 0. Everything else is 1-3.
    const costFloor = c.kind === "reaction" ? 0 : 1;
    need(typeof c.cost === "number" && c.cost >= costFloor && c.cost <= 3,
      `content: command "${c.id}" cost must be ${costFloor}-3, got ${c.cost}`);
    const out = {
      id: c.id, name: c.name, flavour: c.flavour || "", cost: c.cost,
      costGlyph: c.costGlyph || (c.kind === "reaction" ? "↺" : "◆".repeat(c.cost)), kind: c.kind,
      hint: c.hint || "", note: c.note || "",
      target: c.target || null, agile: !!c.agile,
      spendSlot: !!c.spendSlot, spendFocus: !!c.spendFocus,
      consumes: c.consumes || null,
      attackBonus: c.attackBonus,
      // What this command puts up on the heir, and what extra damage it rolls
      // against a target already in some state. Null on every other kind
      // rather than absent, so a consumer never has to ask first.
      applies: readApplies(c.applies, `command "${c.id}"`),
      precision: readPrecision(c.precision, `command "${c.id}"`),
      coneFeet: c.coneFeet, burstFeet: c.burstFeet, emanationFeet: c.emanationFeet,
      rangeFeet: c.rangeFeet,
      save: c.save || null, damageType: c.damageType || "damage",
      // An area effect's own DC, for the one caster in the pack who is not the
      // heir. Null on everything else rather than absent, so a consumer never
      // has to ask whether the property exists first.
      dc: typeof c.dc === "number" ? c.dc : null,
      // Which ability rolls this attack, and whether casting it is Casting a
      // Spell. Both are flat defaults on every other kind rather than absent,
      // so a consumer never has to ask whether the property exists first.
      ability: readAbility(c.ability, `command "${c.id}"`),
      spell: !!c.spell,
      ends: readEnds(c.ends, `command "${c.id}"`),
      // Reaction fields. Null on every other kind rather than absent, so a
      // consumer never has to ask whether the property exists first.
      triggers: null, effect: null, hardness: null, damageTypes: null,
      requiresShield: !!c.requiresShield,
      // What this command leaves behind, or null. Null rather than absent on
      // every other command, so a consumer never has to ask first.
      inflicts: readInflicts(c.inflicts, `command "${c.id}"`),
    };
    if (c.damage) out.damage = parseDamage(c.damage);
    if (c.healing) out.healing = parseDamage(c.healing);
    need(KINDS.includes(out.kind),
      `content: command "${c.id}" has unknown kind "${c.kind}"`);
    if (out.kind === "attack") need(typeof out.attackBonus === "number" && out.damage,
      `content: attack command "${c.id}" needs attackBonus and damage`);
    if (out.kind === "cone") need(out.coneFeet && out.damage && out.save,
      `content: cone command "${c.id}" needs coneFeet, damage and save`);
    if (out.kind === "burst") need(out.rangeFeet && out.burstFeet && out.damage && out.save,
      `content: burst command "${c.id}" needs rangeFeet, burstFeet, damage and save`);
    if (out.kind === "emanation") need(out.emanationFeet && out.damage && out.save,
      `content: emanation command "${c.id}" needs emanationFeet, damage and save`);
    // An area effect's save needs a DC, and there are exactly two places one
    // can come from: the heir's spell DC, which is what `spell` means, or a
    // number the command writes down for itself, which is what a creature's
    // ability does. A command with neither would get a DC quietly borrowed
    // from a stat its caster does not have — and stupefied, which moves the
    // heir's DC, would move a construct's too. A command with *both* is the
    // same silence from the other side: two DCs and no rule saying which one
    // a given caster reads. Refuse either at load.
    if (DC_KINDS.includes(out.kind)) {
      need(out.spell || out.dc !== null,
        `content: ${out.kind} command "${c.id}" must be a spell (its save rolls against the heir's spell DC) or carry its own dc`);
      need(!(out.spell && out.dc !== null),
        `content: ${out.kind} command "${c.id}" is a spell and also writes a dc — it cannot be both`);
    }
    if (out.kind === "buff") {
      need(out.applies,
        `content: buff command "${c.id}" needs an applies block naming the condition it puts up`);
    } else {
      need(!out.applies,
        `content: command "${c.id}" is a ${out.kind} and writes an applies block — only a buff puts a condition up on the heir`);
    }
    if (out.kind === "debuff") {
      need(out.rangeFeet && out.save && out.inflicts,
        `content: debuff command "${c.id}" needs rangeFeet, save and inflicts`);
      // The line between this kind and an attack with a rider. A debuff that
      // also rolled damage would be an attack command spelled a second way,
      // and the engine would then have two answers to "does a failed save
      // hurt" — which is how the multiple attack penalty comes to apply to one
      // of them and not the other.
      need(!out.damage,
        `content: debuff command "${c.id}" carries damage — a debuff's whole effect is the condition; a command that does both is an attack or an area with an inflicts rider`);
      for (const spec of out.inflicts) {
        need(!defOf(spec.condition).helpful,
          `content: debuff command "${c.id}" inflicts "${spec.condition}", which the catalogue calls helpful — a debuff that helps its target is silence`);
      }
    }
    need(!out.precision || out.kind === "attack",
      `content: command "${c.id}" is a ${out.kind} and carries precision damage — the rider is on the weapon swing, and only "attack" rolls one`);
    if (out.save) need(SAVE_STATS.includes(out.save),
      `content: command "${c.id}" names unknown save "${out.save}" (want ${SAVE_STATS.join(", ")})`);
    if (out.kind === "unerring") need(out.rangeFeet && out.damage,
      `content: unerring command "${c.id}" needs rangeFeet and damage`);
    if (out.kind === "self-heal" || out.kind === "consume") need(out.healing,
      `content: command "${c.id}" needs healing`);
    if (out.kind === "reaction") {
      need(Array.isArray(c.triggers) && c.triggers.length,
        `content: reaction command "${c.id}" needs a non-empty triggers array`);
      for (const t of c.triggers) {
        need(REACTION_TRIGGERS.includes(t),
          `content: reaction command "${c.id}" names unknown trigger "${t}" ` +
          `(known: ${REACTION_TRIGGERS.join(", ")})`);
      }
      need(REACTION_EFFECTS.includes(c.effect),
        `content: reaction command "${c.id}" needs an effect of ${REACTION_EFFECTS.join(" or ")}, got "${c.effect}"`);
      out.triggers = Object.freeze([...c.triggers]);
      out.effect = c.effect;
      if (out.effect === "strike") {
        need(typeof out.attackBonus === "number" && out.damage,
          `content: strike reaction "${c.id}" needs attackBonus and damage (a creature using it strikes with its own attack instead)`);
      }
      if (out.effect === "reduce") {
        need(typeof c.hardness === "number" && c.hardness > 0,
          `content: reduce reaction "${c.id}" needs a positive hardness`);
        out.hardness = c.hardness;
        // Absent means "any damage". Present narrows it, which is what keeps
        // Shield Block off a fire cone.
        if (c.damageTypes) {
          need(Array.isArray(c.damageTypes) && c.damageTypes.length,
            `content: reduce reaction "${c.id}" damageTypes must be a non-empty array when present`);
          out.damageTypes = Object.freeze([...c.damageTypes]);
        }
      }
    }
    return Object.freeze(out);
  });
  const commandById = Object.fromEntries(commands.map(c => [c.id, c]));
  const allCommandIds = commands.map(c => c.id);

  // ---- pcOptions --------------------------------------------------------
  // What used to be a single `pc` object is now an array of builds — this is
  // the whole point of character creation: `pcOptions[i]` is one full
  // character sheet, and `commands` on a build is which of the pack's global
  // commands that build can use (a Fighter and a Wizard read from the same
  // command list; each just gets a different slice of it). A build that omits
  // `commands` gets all of them, which is what kept a one-build pack (this
  // engine's whole history before this) working without every field present.
  need(Array.isArray(raw.pcOptions) && raw.pcOptions.length,
    "content: pcOptions must be a non-empty array");
  const rawInventoryByBuild = {};
  const pcOptions = raw.pcOptions.map(p => {
    need(p.id, "content: every pcOptions entry needs an id");
    if (p.startingInventory !== undefined) rawInventoryByBuild[p.id] = p.startingInventory;
    need(typeof p.hp === "number" && p.hp > 0, `content: pcOptions "${p.id}".hp must be a positive number`);
    need(typeof p.ac === "number", `content: pcOptions "${p.id}".ac must be a number`);
    need(p.saves && ["fort", "ref", "will"].every(k => typeof p.saves[k] === "number"),
      `content: pcOptions "${p.id}" needs fort, ref and will saves`);
    const cmdIds = p.commands && p.commands.length ? p.commands : allCommandIds;
    for (const id of cmdIds) {
      need(commandById[id], `content: pcOptions "${p.id}" lists unknown command "${id}"`);
    }
    return Object.freeze({
      id: p.id,
      name: p.name || "The heir", title: p.title || "", note: p.note || "",
      blurb: p.blurb || "",
      hp: p.hp, ac: p.ac, acNote: p.acNote || "", speed: p.speed || 25,
      // How far this build threatens, for the reaction bus. Every level-1
      // weapon in this pack is 5 ft; a reach weapon would say 10 and the
      // move-out-of-reach trigger would follow it without another change.
      reachFeet: p.reachFeet || 5,
      perception: p.perception || 0, saves: { ...p.saves },
      // The heir is flesh. It is here as an empty array rather than absent so
      // game.js can ask either side the same question.
      immunities: readImmunities(p.immunities, `pcOptions "${p.id}"`),
      spellDC: p.spellDC || 10, spellAttack: p.spellAttack || 0,
      slots: p.slots || 0, focus: p.focus || 0,
      // The three faces render.js extrudes this build's prism from. Required
      // rather than defaulted, because a default is how two builds come to
      // look identical on the board: the wizard and the fighter drew the same
      // blue prism for two whole rounds and nothing said so. A pack that adds
      // a third build has to decide what it looks like, and a validator saying
      // so at load is cheaper than noticing it in a screenshot.
      palette: readPalette(p.palette, `pcOptions "${p.id}"`),
      commands: Object.freeze([...cmdIds]),
    });
  });
  need(new Set(pcOptions.map(p => p.id)).size === pcOptions.length,
    "content: pcOptions ids must be unique");
  const pcById = Object.fromEntries(pcOptions.map(p => [p.id, p]));

  // ---- creatures ------------------------------------------------------
  need(raw.creatures && typeof raw.creatures === "object", "content: creatures must be an object");
  const creatures = {};
  for (const [id, c] of Object.entries(raw.creatures)) {
    need(typeof c.hp === "number" && c.hp > 0, `content: creature "${id}" needs a positive hp`);
    need(typeof c.ac === "number", `content: creature "${id}" needs an ac`);
    need(c.saves && ["fort", "ref", "will"].every(k => typeof c.saves[k] === "number"),
      `content: creature "${id}" needs fort, ref and will saves`);
    creatures[id] = Object.freeze({
      id, name: c.name || id, level: c.level ?? 0,
      hp: c.hp, ac: c.ac, perception: c.perception || 0,
      // The Fourth Quarter shipped a saved staffer with no walking speed and
      // multiplied the undefined straight into metres per second (v7 §2). A
      // creature with no Speed here would path zero feet and stand still
      // forever, which reads as a broken game rather than an error.
      speed: c.speed || 25,
      saves: { ...c.saves },
      attackBonus: c.attackBonus ?? 0,
      attackName: c.attackName || "Strike",
      damage: parseDamage(c.damage),
      damageType: c.damageType || "damage",
      ability: readAbility(c.ability, `creature "${id}"`),
      reachFeet: c.reachFeet || 5,
      // What this creature's Strike leaves behind, or null.
      inflicts: readInflicts(c.inflicts, `creature "${id}"`),
      // What refuses to stick to it. Every creature in this pack is a
      // construct and PF2e constructs are immune to mental effects, which is
      // the difference between "nothing frightens a sentinel yet" and "nothing
      // can".
      immunities: readImmunities(c.immunities, `creature "${id}"`),
      // Which reaction commands this creature can fire. The ids are looked up
      // in the pack's whole command list, not the chosen build's slice — a
      // creature's feats have nothing to do with which heir walked in.
      reactions: Object.freeze([...(c.reactions || [])]),
      // The area effects it can put on the board, once each per encounter, and
      // read out of the same global command list for the same reason.
      abilities: Object.freeze([...(c.abilities || [])]),
      // How it spends a turn. Absent means "brawler", which is the one-line
      // strategy every creature in this engine played before there was a
      // choice — so a pack written before this phase keeps its behaviour
      // without an edit, and one that names a policy this build does not have
      // is refused rather than quietly demoted to it.
      ai: readAi(c.ai, `creature "${id}"`),
      deathLine: c.deathLine || "{name} falls.",
      wakeLine: c.wakeLine || "{name} stirs.",
      sleepLine: c.sleepLine || "{name} settles back into stillness.",
    });
  }

  for (const [id, c] of Object.entries(creatures)) {
    for (const rid of c.reactions) {
      need(commandById[rid], `content: creature "${id}" lists unknown reaction "${rid}"`);
      need(commandById[rid].kind === "reaction",
        `content: creature "${id}" lists "${rid}", which is a ${commandById[rid].kind} command, not a reaction`);
    }
    for (const aid of c.abilities) {
      const cmd = commandById[aid];
      need(cmd, `content: creature "${id}" lists unknown ability "${aid}"`);
      // Area kinds only. A creature's turn knows how to put a shape on the
      // board and nothing else — it has no slots, no focus pool and no
      // inventory — so an ability naming a self-buff or a potion would
      // validate here and then be silently unreachable in game.js, which is
      // the exact failure this pack has now shipped three times.
      need(AREA_KINDS.includes(cmd.kind),
        `content: creature "${id}" ability "${aid}" is a ${cmd.kind} command; a creature can only use ${AREA_KINDS.join(", ")}`);
      need(cmd.dc !== null,
        `content: creature "${id}" ability "${aid}" needs its own dc — a construct has no spell DC to borrow`);
    }
    // A caster with nothing to cast is a brawler wearing a label, and the
    // label is what a later reader would trust.
    need(c.ai !== "caster" || c.abilities.length,
      `content: creature "${id}" is a caster with no abilities`);
  }

  // ---- items ----------------------------------------------------------
  need(Array.isArray(raw.items), "content: items must be an array");
  const items = {};
  for (const it of raw.items) {
    need(it.id && it.name, "content: every item needs an id and a name");
    need(it.bulk === "L" || typeof it.bulk === "number",
      `content: item "${it.id}" bulk must be a number or "L"`);
    items[it.id] = Object.freeze({ id: it.id, name: it.name, glyph: it.glyph || "▪", bulk: it.bulk });
  }
  const readInventory = (list, where) => Object.freeze((list || []).map(id => {
    need(items[id], `content: ${where} names unknown item "${id}"`);
    return id;
  }));
  const startingInventory = readInventory(raw.startingInventory, "startingInventory");
  // A satchel per build, layered over the pack's. Round three skipped this
  // because two builds were happy sharing one; four are not, and the Fighter
  // has been carrying the Wizard's spellbook down four rooms since the day
  // character creation shipped. Validated here rather than in the pcOptions
  // pass above because `items` is parsed after it, and the whole value of the
  // check is that it names the item that is not there.
  const perBuildInventory = {};
  for (const [buildId, list] of Object.entries(rawInventoryByBuild)) {
    need(Array.isArray(list),
      `content: pcOptions "${buildId}".startingInventory must be an array`);
    perBuildInventory[buildId] = readInventory(list, `pcOptions "${buildId}".startingInventory`);
  }

  // ---- lore -----------------------------------------------------------
  const lore = {};
  for (const [id, l] of Object.entries(raw.lore || {})) {
    need(l.title && Array.isArray(l.body), `content: lore "${id}" needs a title and a body array`);
    lore[id] = Object.freeze({
      id, title: l.title, body: [...l.body], logLine: l.logLine || "",
      // A pillar may hand something back, in exactly the shape the gate's
      // seal-release already had. That is the whole mechanism a pack has for
      // rewarding an optional fight: the alternative was a tile kind that
      // yields an item, which costs render.js a colour and ui.js a sentence
      // and would have made a room stop being a content file (#175).
      restore: readRestore(l.restore, `lore "${id}"`),
      restoreHp: typeof l.restoreHp === "number" ? l.restoreHp : null,
      restoreNarrative: l.restoreNarrative || "",
    });
  }

  // ---- areas ------------------------------------------------------------
  // `raw.areas` is an object keyed by area id; `raw.startArea` names the one
  // the PC begins in. A legend entry whose tile is "stairs" needs a `to`
  // naming the destination area and square — validated in a second pass below
  // once every area has been parsed, so a stairway can point forward at an
  // area declared later in the file.
  need(raw.areas && typeof raw.areas === "object" && Object.keys(raw.areas).length,
    "content: areas must be a non-empty object, keyed by area id");
  need(raw.startArea && raw.areas[raw.startArea], "content: startArea must name a defined area");

  const areas = {};
  for (const [areaId, a] of Object.entries(raw.areas)) {
    need(a && Array.isArray(a.rows) && a.rows.length,
      `content: area "${areaId}".rows must be a non-empty array`);
    need(a.legend && typeof a.legend === "object", `content: area "${areaId}".legend is required`);
    const height = a.rows.length;
    const width = a.rows[0].length;
    a.rows.forEach((r, i) => need(r.length === width,
      `content: area "${areaId}" row ${i} is ${r.length} wide, expected ${width}`));

    const tiles = [];
    const pillars = {};          // "x,y" -> lore id
    const placements = [];       // { creature, x, y, wakesOn }
    const stairs = {};           // "x,y" -> { area, x, y }
    let pcSpawn = null;

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const ch = a.rows[y][x];
        const def = a.legend[ch];
        need(def, `content: area "${areaId}" row ${y} column ${x} uses "${ch}", which is not in the legend`);
        const t = TILE_ID_BY_NAME[def.tile];
        need(t !== undefined,
          `content: area "${areaId}" legend "${ch}" has unknown tile "${def.tile}" ` +
          `(known: ${TILE_NAMES.join(", ")})`);
        row.push(t);
        if (def.lore) {
          need(lore[def.lore], `content: area "${areaId}" legend "${ch}" points at unknown lore "${def.lore}"`);
          pillars[x + "," + y] = def.lore;
        }
        if (def.creature) {
          need(creatures[def.creature],
            `content: area "${areaId}" legend "${ch}" points at unknown creature "${def.creature}"`);
          placements.push({ creature: def.creature, x, y, wakesOn: def.wakesOn || "notice" });
        }
        if (def.spawn === "pc") pcSpawn = { x, y };
        if (def.tile === "stairs") {
          need(def.to && typeof def.to.area === "string"
            && typeof def.to.x === "number" && typeof def.to.y === "number",
            `content: area "${areaId}" legend "${ch}" is stairs and needs a "to": {area, x, y}`);
          stairs[x + "," + y] = { area: def.to.area, x: def.to.x, y: def.to.y };
        }
      }
      tiles.push(row);
    }
    if (areaId === raw.startArea) {
      need(pcSpawn, `content: the start area "${areaId}" has no pc spawn — mark one square with spawn "pc"`);
    }
    need(placements.length, `content: area "${areaId}" places no creatures`);
    for (const pl of placements) {
      need(["notice", "gate-opened"].includes(pl.wakesOn),
        `content: area "${areaId}" creature placement at ${pl.x},${pl.y} has unknown wakesOn "${pl.wakesOn}"`);
    }

    areas[areaId] = Object.freeze({
      id: areaId, name: a.name || areaId, hint: a.hint || "", width, height,
      // The pack's tuning, with this room's overrides on top. game.js reads
      // `area.tuning`, never `content.tuning`, so a stairway into a dark room
      // changes what the heir can see the moment she arrives.
      tuning: readTuning(a.tuning, tuning, `area "${areaId}"`),
      tiles: Object.freeze(tiles.map(r => Object.freeze(r))),
      pillars: Object.freeze(pillars),
      placements: Object.freeze(placements.map(Object.freeze)),
      pcSpawn: pcSpawn ? Object.freeze(pcSpawn) : null,
      stairs: Object.freeze(stairs),
    });
  }

  // Second pass: a stairway's destination area and square must actually
  // exist. Nothing above can check this while areas are still being built,
  // since a stairway is allowed to point at an area declared later in the
  // object.
  for (const a of Object.values(areas)) {
    for (const [k, dest] of Object.entries(a.stairs)) {
      need(areas[dest.area], `content: area "${a.id}" stairs at ${k} point at unknown area "${dest.area}"`);
      const target = areas[dest.area];
      need(dest.x >= 0 && dest.y >= 0 && dest.x < target.width && dest.y < target.height,
        `content: area "${a.id}" stairs at ${k} land outside area "${dest.area}"`);
      // A stairway swaps the whole board out, and the hint bar is the one
      // line on the page that says what to do next. An area you can arrive in
      // has to carry one, so `transitionTo` never has a fallback branch to
      // pick between — an area nothing points at needs none, which is why this
      // is checked here, against the stairways, rather than on every area.
      need(target.hint, `content: area "${a.id}" stairs at ${k} lead to "${dest.area}", which has no hint for the hint bar`);
    }
  }

  const areaOrder = raw.areaOrder || Object.keys(areas);
  need(Array.isArray(areaOrder) && areaOrder.every(id => areas[id]),
    "content: areaOrder must list only defined area ids");

  // ---- gate and treasure ----------------------------------------------
  const gate = { requiresLore: [], ...(raw.gate || {}) };
  gate.restore = readRestore(gate.restore, "gate");
  gate.restoreHp = typeof gate.restoreHp === "number" ? gate.restoreHp : null;
  gate.restoreNarrative = gate.restoreNarrative || "";
  for (const id of gate.requiresLore) {
    need(lore[id], `content: gate.requiresLore names unknown lore "${id}"`);
  }
  const treasure = { requiresDown: [], body: [], ...(raw.treasure || {}) };
  for (const id of treasure.requiresDown) {
    need(creatures[id], `content: treasure.requiresDown names unknown creature "${id}"`);
  }

  return Object.freeze({
    pack: Object.freeze({ ...raw.pack }),
    tuning: Object.freeze(tuning),
    // `pc` here is a convenience default (the first build) for any caller that
    // has not chosen one yet. Real play always goes through `selectPc` below —
    // this is what game.js, save.js, ui.js and render.js read, and none of
    // them changed for character creation because every one of them just
    // trusts whatever `content.pc` says.
    pc: pcOptions[0],
    pcOptions: Object.freeze(pcOptions),
    pcById: Object.freeze(pcById),
    commands: Object.freeze(commands),
    commandById: Object.freeze(commandById),
    creatures: Object.freeze(creatures),
    items: Object.freeze(items),
    // Every command in the pack, by id, and it stays whole through selectPc()
    // — which narrows `commands`/`commandById` to one build. A creature's
    // reaction is looked up here for exactly that reason: the Vault Keeper
    // does not stop having Reactive Strike because the Wizard was picked.
    allCommandById: Object.freeze({ ...commandById }),
    startingInventory: Object.freeze(startingInventory),
    // Keyed by build id, and only for the builds that name one. `selectPc`
    // is what turns this into the single `startingInventory` game.js reads,
    // the same way it turns `pcOptions` into `pc`.
    startingInventoryByBuild: Object.freeze(perBuildInventory),
    inventorySlots: raw.inventorySlots || 8,
    bulkLimit: raw.bulkLimit ?? 5,
    bulkLimitNote: raw.bulkLimitNote || "",
    lore: Object.freeze(lore),
    areas: Object.freeze(areas),
    startArea: raw.startArea,
    areaOrder: Object.freeze(areaOrder),
    gate: Object.freeze(gate),
    treasure: Object.freeze(treasure),
    defeat: Object.freeze({ title: "Defeated", body: [], ...(raw.defeat || {}) }),
    intro: Object.freeze({ narrative: "", goal: "", hint: "", ...(raw.intro || {}) }),
  });
}

/**
 * Resolve a loaded pack onto one chosen build.
 *
 * Every other module in this engine (game.js, save.js, ui.js, render.js,
 * test/autopilot.mjs) reads `content.pc`, `content.commands` and
 * `content.commandById` as if there were only ever one PC — that was true for
 * two whole rounds, and staying true to it is what let character creation land
 * without touching any of those files. This function is the one place the
 * pack-with-many-builds becomes the content-with-one-pc every other module
 * still expects: `pc` becomes the chosen build, and `commands`/`commandById`
 * narrow to exactly the ids that build lists, so a Fighter cannot spend a
 * Wizard's Shield cantrip just because the definition still exists globally.
 *
 * An unknown or missing `buildId` falls back to `pcOptions[0]` rather than
 * throwing — the one case that matters in practice is a save written before
 * this feature existed, which has no `buildId` at all and always meant the
 * one build that existed then. `pcOptions[0]` has to stay that build for that
 * fallback to mean what it says; see save.js's `repair`.
 */
export function selectPc(content, buildId) {
  const pc = content.pcById[buildId] || content.pcOptions[0];
  const commands = content.commands.filter(c => pc.commands.includes(c.id));
  return Object.freeze({
    ...content,
    pc,
    commands: Object.freeze(commands),
    commandById: Object.freeze(Object.fromEntries(commands.map(c => [c.id, c]))),
    // The satchel resolves here for the same reason `pc` does: game.js reads
    // one `startingInventory` and has never known there was more than one.
    // A build that names none gets the pack's, which is what keeps every pack
    // written before this feature working unchanged.
    startingInventory: content.startingInventoryByBuild[pc.id] || content.startingInventory,
  });
}

/**
 * The pack manifest: which packs this game ships, and which one boots.
 *
 * `main.js` fetched `content/vault.json` by a literal URL, so "more than one
 * adventure" was a code change rather than a content one. This is the list,
 * and it is validated at the door on exactly the same argument the pack
 * validator is: a manifest naming a file that is not there fails at fetch
 * with a 404 nobody can read, and one naming a pack id that disagrees with
 * the file's own is a switch that quietly boots the wrong adventure.
 *
 * `file` is a bare filename, resolved beside the manifest. A path is refused
 * rather than resolved: the packs are content, they live in one folder, and a
 * manifest that can reach out of it is a manifest that can be pointed at
 * anything the host serves.
 */
export function loadManifest(raw) {
  need(raw && typeof raw === "object", "manifest: not an object");
  need(raw.schema === 1, `manifest: schema must be 1, got ${raw.schema}`);
  need(Array.isArray(raw.packs) && raw.packs.length, "manifest: packs must be a non-empty array");
  const packs = raw.packs.map(p => {
    need(p && typeof p.id === "string" && p.id, "manifest: every pack needs an id");
    need(typeof p.file === "string" && /^[\w.-]+\.json$/.test(p.file),
      `manifest: pack "${p.id}" needs a "file" naming a .json beside this manifest, got ${JSON.stringify(p.file)}`);
    return Object.freeze({ id: p.id, file: p.file, name: p.name || p.id, blurb: p.blurb || "" });
  });
  need(new Set(packs.map(p => p.id)).size === packs.length, "manifest: pack ids must be unique");
  const byId = Object.freeze(Object.fromEntries(packs.map(p => [p.id, p])));
  const startId = raw.default ?? packs[0].id;
  need(byId[startId],
    `manifest: default names "${startId}", which is not one of ${packs.map(p => p.id).join(", ")}`);
  return Object.freeze({ schema: 1, default: startId, packs: Object.freeze(packs), byId });
}

/**
 * Browser door: fetch and parse. Relative so it works from any host path.
 *
 * `expectId` is the manifest's name for this pack. A file whose own `pack.id`
 * disagrees is refused, because that id is what the save layer keys a slot on
 * and what it refuses a foreign save by — two names for one adventure is how
 * a player's vault save ends up in the proving ground's slot.
 */
export async function fetchPack(url, expectId = null) {
  const res = await fetch(url);
  if (!res.ok) throw new ContentError(`content: ${url} returned ${res.status}`);
  const pack = loadPack(await res.json());
  need(expectId === null || pack.pack.id === expectId,
    `content: the manifest calls ${url} "${expectId}" and the file says "${pack.pack.id}"`);
  return pack;
}

/** The same door, for the manifest. */
export async function fetchManifest(url) {
  const res = await fetch(url);
  if (!res.ok) throw new ContentError(`content: ${url} returned ${res.status}`);
  return loadManifest(await res.json());
}

export { ContentError };
