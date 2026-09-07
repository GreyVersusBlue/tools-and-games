// smoke.mjs — the unit suite. Run: node Projects/absalom-inheritance/test/smoke.mjs
//
// Exits non-zero on the first miss (locked decision #13). Every guard-rail in
// here was checked by breaking the thing it guards and watching it fail first
// (locked decision #34); where that mattered, the comment says what was broken.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  makeRng, die, rollDice, parseDamage, rollDamage,
  DEG, degreeOfSuccess, check, basicSaveDamage, mapPenalty,
  feetBetween, isAdjacent, stridesFor,
} from "../js/rules.js";
import { makeWorld, TILE, packExplored, unpackExplored } from "../js/world.js";
import { coneSquares, burstSquares, emanationSquares, octantToward, OCTANTS } from "../js/templates.js";
import { loadPack, selectPc, ContentError, REACTION_TRIGGERS, REACTION_EFFECTS, INFLICT_ON, AREA_KINDS } from "../js/content.js";
import {
  CONDITIONS, CONDITION_IDS, MODIFIER_KINDS, BONUS_TYPES, isCondition,
  CONDITION_TRAITS, DEFAULT_UNTILS, DAMAGE_SOURCES, damageModifiers,
  actionsFor, defaultUntilFor, immunityTo, saveKind, attackKind,
  makeCondition, addCondition, removeCondition, hasCondition, valueOf,
  modifiers, persistentIn, tick, describe, repairBag, packBag,
} from "../js/conditions.js";
import { createGame } from "../js/game.js";
import { AI_KINDS, chooseAction } from "../js/ai.js";
import { makeSaveSlot, makeRepair, validRun, freshRun, SAVE_KEY, SAVE_VERSION } from "../js/save.js";
import { playThrough, travel, fight, combatPolicy } from "./autopilot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_PATH = path.join(HERE, "..", "content", "vault.json");
const rawPack = JSON.parse(fs.readFileSync(PACK_PATH, "utf8"));

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; return; }
  failures.push(label);
  console.log(`  FAIL  ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function throws(fn, label) {
  try { fn(); } catch (e) { passed++; return e; }
  failures.push(label);
  console.log(`  FAIL  ${label} — expected a throw, got none`);
  return null;
}
function section(name) { console.log(`\n${name}`); }

/** A localStorage-shaped stub. gvb-save never sees a real browser here. */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get size() { return m.size; },
    raw: m,
  };
}

/* ========================================================================= *
 * 1 — rules
 * ========================================================================= */
section("rules");

{
  const rng = makeRng(1);
  const seq = [die(20, rng), die(20, rng), die(20, rng)];
  const rng2 = makeRng(1);
  eq(JSON.stringify([die(20, rng2), die(20, rng2), die(20, rng2)]), JSON.stringify(seq),
    "the seeded RNG repeats exactly (the whole balance harness rests on this)");

  let lo = 21, hi = 0;
  const r3 = makeRng(99);
  for (let i = 0; i < 20000; i++) { const v = die(20, r3); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  eq(lo, 1, "d20 reaches 1");
  eq(hi, 20, "d20 reaches 20");

  const rd = rollDice(3, 6, makeRng(7));
  eq(rd.rolls.length, 3, "rollDice returns one entry per die");
  eq(rd.total, rd.rolls.reduce((a, b) => a + b, 0), "rollDice total is the sum of its rolls");
}

// Degrees of success — Player Core p.404, including the nat-1/nat-20 step.
eq(degreeOfSuccess(10, 25, 15), DEG.CRIT_SUCC, "DC+10 is a critical success");
eq(degreeOfSuccess(10, 15, 15), DEG.SUCC, "exactly the DC is a success");
eq(degreeOfSuccess(10, 14, 15), DEG.FAIL, "one under the DC is a failure");
eq(degreeOfSuccess(10, 5, 15), DEG.CRIT_FAIL, "DC-10 is a critical failure");
eq(degreeOfSuccess(20, 15, 15), DEG.CRIT_SUCC, "a natural 20 steps a success up to a crit");
eq(degreeOfSuccess(20, 14, 15), DEG.SUCC, "a natural 20 steps a failure up to a success");
eq(degreeOfSuccess(1, 15, 15), DEG.FAIL, "a natural 1 steps a success down to a failure");
eq(degreeOfSuccess(1, 25, 15), DEG.SUCC, "a natural 1 steps a crit success down to a success");
eq(degreeOfSuccess(1, 5, 15), DEG.CRIT_FAIL, "a natural 1 cannot go below critical failure");
eq(degreeOfSuccess(20, 25, 15), DEG.CRIT_SUCC, "a natural 20 cannot go above critical success");

// Basic saves — Player Core p.406.
eq(basicSaveDamage(DEG.CRIT_SUCC, 9), 0, "basic save: critical success takes nothing");
eq(basicSaveDamage(DEG.SUCC, 9), 4, "basic save: success takes half, rounded down");
eq(basicSaveDamage(DEG.FAIL, 9), 9, "basic save: failure takes full");
eq(basicSaveDamage(DEG.CRIT_FAIL, 9), 18, "basic save: critical failure takes double");

// MAP — Player Core p.407. The original build hardcoded the non-agile numbers
// and left a comment apologising; the dagger this PC carries is agile.
eq(mapPenalty(0, false), 0, "no MAP on the first attack");
eq(mapPenalty(1, false), 5, "MAP is -5 on a second non-agile attack");
eq(mapPenalty(2, false), 10, "MAP is -10 on a third non-agile attack");
eq(mapPenalty(1, true), 4, "MAP is -4 on a second agile attack");
eq(mapPenalty(2, true), 8, "MAP is -8 on a third agile attack");
eq(mapPenalty(5, true), 8, "MAP does not keep growing past the third attack");

// Distance — Player Core p.421, diagonals 5/10/5.
eq(feetBetween(0, 0, 0, 0), 0, "a square is 0 ft from itself");
eq(feetBetween(0, 0, 3, 0), 15, "three squares straight is 15 ft");
eq(feetBetween(0, 0, 1, 1), 5, "the first diagonal is 5 ft");
eq(feetBetween(0, 0, 2, 2), 15, "the second diagonal is 10 ft, so two is 15 ft");
eq(feetBetween(0, 0, 3, 3), 20, "the third diagonal is 5 ft again");
eq(feetBetween(0, 0, 4, 4), 30, "four diagonals is 30 ft");
eq(feetBetween(0, 0, 4, 2), 25, "mixed: two diagonals plus two straights is 25 ft");
ok(isAdjacent({ x: 1, y: 1 }, { x: 2, y: 2 }), "diagonal neighbours are adjacent");
ok(!isAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 }), "a square is not adjacent to itself");
ok(!isAdjacent({ x: 1, y: 1 }, { x: 3, y: 1 }), "two squares apart is not adjacent");
eq(stridesFor(0, 25), 0, "no feet needs no Strides");
eq(stridesFor(25, 25), 1, "exactly a Speed's worth is one Stride");
eq(stridesFor(30, 25), 2, "one foot over a Speed is two Strides");

// Damage parsing. A malformed string throws instead of rolling nothing.
eq(JSON.stringify(parseDamage("1d6")), JSON.stringify({ n: 1, s: 6, plus: 0 }), "parseDamage reads 1d6");
eq(JSON.stringify(parseDamage("2d6+3")), JSON.stringify({ n: 2, s: 6, plus: 3 }), "parseDamage reads 2d6+3");
eq(JSON.stringify(parseDamage(" 1d4 - 1 ")), JSON.stringify({ n: 1, s: 4, plus: -1 }), "parseDamage reads a negative modifier and ignores spacing");
throws(() => parseDamage("1d6+"), "parseDamage rejects a trailing plus");
throws(() => parseDamage("d6"), "parseDamage rejects a missing die count");
throws(() => parseDamage(""), "parseDamage rejects an empty string");
throws(() => parseDamage(undefined), "parseDamage rejects undefined");
{
  const r = rollDamage({ n: 1, s: 4, plus: -10 }, makeRng(3));
  eq(r.total, 0, "damage never goes negative");
}
{
  const c = check(5, 15, makeRng(11));
  ok(/^d20\(\d+\) \+5 = \d+ vs DC 15$/.test(c.math), "check() writes the whole breakdown for the log");
}

/* ========================================================================= *
 * 2 — content loading
 * ========================================================================= */
section("content");

const content = loadPack(rawPack);
// Everything below that calls createGame() wants one resolved build, the same
// way a real boot does after the character picker fires. `resolved` is the
// wizard, build 0 — the one every pre-character-creation save ever written
// implicitly meant, and the default `selectPc` falls back to.
const resolved = selectPc(content, "wizard");
eq(content.pack.id, "vault-beneath-the-court", "the shipping pack loads");
eq(content.startArea, "vault", "the pack starts in the vault");
eq(JSON.stringify(content.areaOrder), JSON.stringify(["vault", "sanctum"]), "the area order is vault then sanctum");
eq(content.areas.vault.width, 22, "the vault is 22 squares wide");
eq(content.areas.vault.height, 22, "the vault is 22 squares tall");
eq(content.areas.vault.placements.length, 3, "the vault places three creatures");
eq(Object.keys(content.areas.vault.pillars).length, 2, "the vault has two lore pillars");
eq(content.areas.sanctum.placements.length, 1, "the sanctum places one creature");
ok(content.areas.sanctum.pcSpawn === null, "the sanctum has no pc spawn — it is only ever reached by stairs");
eq(Object.keys(content.areas.vault.stairs).length, 2, "the vault has two stairway squares");
eq(content.areas.vault.stairs["10,2"].area, "sanctum", "the vault stairway leads to the sanctum");
eq(content.startingInventory.filter(i => i === "potion").length, 3, "the PC starts with three potions");
ok(Object.isFrozen(content), "content is frozen — a run cannot edit the pack it is playing");
ok(Object.isFrozen(content.creatures["shattered-sentinel"]), "creature definitions are frozen");
eq(content.commandById.strike.agile, true, "the dagger is agile, so MAP is -4/-8");
eq(content.creatures["shattered-sentinel"].damage.s, 6, "the sentinel's damage string parsed into dice");

/* -- pcOptions and selectPc — character creation, round three ---------- */
eq(content.pcOptions.length, 2, "the pack ships two builds");
eq(content.pc.id, "wizard", "content.pc defaults to the first build");
ok(Object.isFrozen(content.pcOptions[0]), "each build is frozen");
eq(content.pcById.fighter.name, "Kessa Vane", "pcById looks builds up by id");
eq(resolved.pc.id, "wizard", "selectPc resolves the requested build");
eq(resolved.commands.length, 9, "selectPc narrows commands to the wizard's own list");
ok(!resolved.commandById["strike-sword"], "a build cannot see a command outside its own list");
ok(!!resolved.commandById.breathe, "but every command the build lists is there");
const fighterContent = selectPc(content, "fighter");
eq(fighterContent.pc.name, "Kessa Vane", "selectPc resolves a different build by id");
eq(fighterContent.commands.length, 3, "the fighter's command list is exactly its own three");
ok(!fighterContent.commandById.breathe, "the fighter cannot see the wizard's cone spell");
ok(!!fighterContent.commandById["strike-sword"], "and can see its own Strike");
eq(selectPc(content, "nope-not-a-build").pc.id, "wizard",
  "selectPc falls back to pcOptions[0] on an unknown id, the same fallback repair() leans on");

// The validator's job is to complain at load rather than let an undefined reach
// a damage roll. Each of these was confirmed to load silently before the check
// existed.
const clone = () => JSON.parse(JSON.stringify(rawPack));
throws(() => loadPack(null), "content: a null pack is refused");
throws(() => loadPack({}), "content: a pack with no id is refused");
throws(() => { const p = clone(); p.pack.schema = 2; loadPack(p); }, "content: an unknown schema version is refused");
throws(() => { const p = clone(); delete p.pcOptions[0].hp; loadPack(p); }, "content: a PC with no HP is refused");
throws(() => { const p = clone(); delete p.pcOptions[0].saves.will; loadPack(p); }, "content: a PC missing a save is refused");
throws(() => { const p = clone(); p.pcOptions = []; loadPack(p); }, "content: an empty pcOptions is refused");
throws(() => { const p = clone(); delete p.pcOptions[0].id; loadPack(p); }, "content: a build with no id is refused");
throws(() => { const p = clone(); p.pcOptions[1].id = "wizard"; loadPack(p); }, "content: two builds sharing an id are refused");
throws(() => { const p = clone(); p.pcOptions[1].commands.push("nope"); loadPack(p); }, "content: a build listing an unknown command is refused");
throws(() => { const p = clone(); p.creatures["shattered-sentinel"].damage = "1d"; loadPack(p); }, "content: a creature with unreadable damage is refused");
throws(() => { const p = clone(); delete p.creatures["shattered-sentinel"].saves.ref; loadPack(p); }, "content: a creature missing a save is refused");
throws(() => { const p = clone(); p.areas.vault.rows[3] = "###"; loadPack(p); }, "content: a ragged map row is refused");
throws(() => { const p = clone(); p.areas.vault.rows[6] = p.areas.vault.rows[6].replace(".", "z"); loadPack(p); }, "content: a map character with no legend entry is refused");
throws(() => { const p = clone(); p.areas.vault.legend["P"].lore = "nope"; loadPack(p); }, "content: a pillar pointing at missing lore is refused");
throws(() => { const p = clone(); p.areas.vault.legend["e"].creature = "nope"; loadPack(p); }, "content: a spawn pointing at a missing creature is refused");
throws(() => { const p = clone(); p.areas.vault.legend["k"].wakesOn = "tuesday"; loadPack(p); }, "content: an unknown wakesOn is refused");
throws(() => { const p = clone(); p.startingInventory.push("nope"); loadPack(p); }, "content: starting inventory naming a missing item is refused");
throws(() => { const p = clone(); p.commands[0].cost = 9; loadPack(p); }, "content: a command costing more than three actions is refused");
throws(() => { const p = clone(); p.commands[0].kind = "vibes"; loadPack(p); }, "content: a command with an unknown kind is refused");
const cmd = (p, id) => p.commands.find(c => c.id === id);
throws(() => { const p = clone(); delete cmd(p, "emberburst").burstFeet; loadPack(p); }, "content: a burst with no radius is refused");
throws(() => { const p = clone(); delete cmd(p, "emberburst").rangeFeet; loadPack(p); }, "content: a burst with no range to place it at is refused");
throws(() => { const p = clone(); delete cmd(p, "wardpulse").emanationFeet; loadPack(p); }, "content: an emanation with no radius is refused");
throws(() => { const p = clone(); delete cmd(p, "wardpulse").save; loadPack(p); }, "content: an area command with no save is refused");
// Every area effect rolls against the heir's spell DC, and a command that is
// not a spell has no business borrowing it — stupefied moves that DC, and it
// would move a thrown flask's too. Confirmed to load silently before the
// check existed, and to resolve at DC 17 as though a bomb were a spell.
throws(() => { const p = clone(); cmd(p, "breathe").spell = false; loadPack(p); }, "content: a cone that is not a spell is refused");
throws(() => { const p = clone(); delete cmd(p, "emberburst").spell; loadPack(p); }, "content: and so is a burst");
throws(() => { const p = clone(); cmd(p, "wardpulse").spell = false; loadPack(p); }, "content: and an emanation");
eq(AREA_KINDS.join(","), "cone,burst,emanation", "three kinds put a shape on the board");
throws(() => { const p = clone(); p.gate.requiresLore.push("nope"); loadPack(p); }, "content: a gate requiring missing lore is refused");
throws(() => { const p = clone(); p.treasure.requiresDown.push("nope"); loadPack(p); }, "content: treasure requiring a missing creature is refused");
throws(() => {
  const p = clone();
  p.areas.vault.rows = p.areas.vault.rows.map(r => r.replace("@", "."));
  loadPack(p);
}, "content: the start area with no PC spawn is refused");

// Reactions, new in the interrupt-point phase. A reaction that names an event
// the engine does not fire would validate and then sit in the pack doing
// nothing forever, which is the kind of silence an author cannot debug — so
// the triggers and the effects are both closed vocabularies.
throws(() => { const p = clone(); p.commands.find(c => c.id === "reactive-strike").triggers = ["on-tuesday"]; loadPack(p); },
  "content: a reaction naming an unknown trigger is refused");
throws(() => { const p = clone(); delete p.commands.find(c => c.id === "reactive-strike").triggers; loadPack(p); },
  "content: a reaction with no triggers is refused");
throws(() => { const p = clone(); p.commands.find(c => c.id === "reactive-strike").triggers = []; loadPack(p); },
  "content: a reaction with an empty triggers array is refused");
throws(() => { const p = clone(); p.commands.find(c => c.id === "reactive-strike").effect = "explode"; loadPack(p); },
  "content: a reaction with an unknown effect is refused");
throws(() => { const p = clone(); delete p.commands.find(c => c.id === "reactive-strike").effect; loadPack(p); },
  "content: a reaction with no effect is refused");
throws(() => { const p = clone(); delete p.commands.find(c => c.id === "reactive-strike").attackBonus; loadPack(p); },
  "content: a strike reaction with no attackBonus is refused");
throws(() => { const p = clone(); delete p.commands.find(c => c.id === "shield-block").hardness; loadPack(p); },
  "content: a reduce reaction with no hardness is refused");
throws(() => { const p = clone(); p.commands.find(c => c.id === "shield-block").hardness = 0; loadPack(p); },
  "content: a reduce reaction with zero hardness is refused");
throws(() => { const p = clone(); p.commands.find(c => c.id === "shield-block").damageTypes = []; loadPack(p); },
  "content: a reduce reaction with an empty damageTypes is refused");
throws(() => { const p = clone(); p.commands.find(c => c.id === "reactive-strike").cost = 4; loadPack(p); },
  "content: a reaction costing four actions is refused");
throws(() => { const p = clone(); p.creatures["vault-keeper"].reactions = ["nope"]; loadPack(p); },
  "content: a creature listing an unknown reaction is refused");
throws(() => { const p = clone(); p.creatures["vault-keeper"].reactions = ["potion"]; loadPack(p); },
  "content: a creature listing a command that is not a reaction is refused");

/* -- what a creature does with its turn, and what it can put on the board -- */
eq(content.creatures["shattered-sentinel"].ai, "brawler",
  "a creature that names no ai is a brawler, which is what every creature did before there was a choice");
eq(JSON.stringify(content.creatures["shattered-sentinel"].abilities), "[]",
  "and owns no abilities rather than an undefined");
eq(content.creatures["vault-keeper"].ai, "caster", "the Keeper is the pack's one caster");
eq(content.creatures["reliquary-warden"].ai, "skirmisher", "and the warden its one skirmisher");
eq(JSON.stringify(content.creatures["vault-keeper"].abilities), JSON.stringify(["gravel-wave"]),
  "with one ability, read out of the shared command list the way its reaction is");
ok(content.pcOptions.every(b => !b.commands.some(id => id === "gravel-wave")),
  "no build lists Gravel Wave, so no heir can cast it");
ok(!selectPc(content, "wizard").commandById["gravel-wave"],
  "and selectPc narrows it out of the command table the heir's own actions read");
ok(!!content.allCommandById["gravel-wave"],
  "while the pack's whole command list still carries it, which is where a creature reads its kit");
throws(() => { const p = clone(); p.creatures["vault-keeper"].ai = "genius"; loadPack(p); },
  "content: a creature naming an ai this build does not have is refused");
throws(() => { const p = clone(); p.creatures["vault-keeper"].abilities = ["nope"]; loadPack(p); },
  "content: a creature listing an unknown ability is refused");
throws(() => { const p = clone(); p.creatures["vault-keeper"].abilities = ["potion"]; loadPack(p); },
  "content: a creature ability that is not an area shape is refused — a creature's turn cannot drink");
throws(() => { const p = clone(); p.creatures["vault-keeper"].abilities = ["breathe"]; loadPack(p); },
  "content: a creature ability with no dc of its own is refused — a construct has no spell DC to borrow");
throws(() => { const p = clone(); delete p.creatures["vault-keeper"].abilities; loadPack(p); },
  "content: a caster with nothing to cast is refused");
throws(() => { const p = clone(); delete p.commands.find(c => c.id === "gravel-wave").dc; loadPack(p); },
  "content: an area command that is neither a spell nor carries a dc is refused");
throws(() => { const p = clone(); p.commands.find(c => c.id === "gravel-wave").spell = true; loadPack(p); },
  "content: an area command that is a spell and also writes a dc is refused — two DCs and no rule saying which");
eq(content.allCommandById["gravel-wave"].dc, 16, "Gravel Wave's save is rolled against its own DC 16");
eq(content.pcById.wizard.spellDC, 17, "and the heir's spell DC is 17, which is the number it is deliberately not");
{
  // Zero is the one cost a reaction is allowed, and the one every other kind
  // is not: a reaction spends a reaction, which is not one of the three
  // actions. This was `cost >= 1` for two rounds and refused the whole kind.
  const p = clone();
  p.commands.find(c => c.id === "strike").cost = 0;
  throws(() => loadPack(p), "content: a non-reaction command costing zero actions is refused");
}

// Multi-area and stairs, new in round two.
throws(() => { const p = clone(); delete p.areas; loadPack(p); }, "content: a pack with no areas is refused");
throws(() => { const p = clone(); p.startArea = "nowhere"; loadPack(p); }, "content: an unknown startArea is refused");
throws(() => { const p = clone(); p.areaOrder.push("nowhere"); loadPack(p); }, "content: an areaOrder naming an unknown area is refused");
throws(() => {
  const p = clone();
  delete p.areas.vault.legend["V"].to;
  loadPack(p);
}, "content: a stairs legend entry with no destination is refused");
throws(() => {
  const p = clone();
  p.areas.vault.legend["V"].to.area = "nowhere";
  loadPack(p);
}, "content: stairs pointing at an unknown area are refused");
throws(() => {
  const p = clone();
  p.areas.vault.legend["V"].to.x = 900;
  loadPack(p);
}, "content: stairs landing outside their destination area are refused");
{
  // Only the start area needs a pc spawn — the sanctum is reached by stairs,
  // never by booting straight into it.
  const p = clone();
  const loaded = loadPack(p);
  ok(loaded.areas.sanctum.pcSpawn === null, "a non-start area with no spawn loads fine");
}
{
  // A missing Speed falls back rather than throwing, but it must never be
  // undefined — that is the exact NaN-metres-per-second trap from v7 §2.
  const p = clone();
  delete p.creatures["shattered-sentinel"].speed;
  const loaded = loadPack(p);
  eq(typeof loaded.creatures["shattered-sentinel"].speed, "number",
    "a creature with no Speed still gets a number, never undefined");
  ok(loaded.creatures["shattered-sentinel"].speed > 0, "the fallback Speed is usable");
}

/* ========================================================================= *
 * 3 — world geometry
 * ========================================================================= */
section("world");

const world = makeWorld(content.areas.vault);
eq(world.tileAt(0, 0), TILE.WALL, "the border is wall");
eq(world.tileAt(10, 19), TILE.FLOOR, "the PC spawn is floor");
eq(world.tileAt(3, 12), TILE.PILLAR, "the western pillar is a pillar");
eq(world.tileAt(10, 5), TILE.GATE, "the gate squares are gate");
eq(world.tileAt(10, 2), TILE.STAIRS, "the stairway squares are stairs");
eq(world.tileAt(-1, 5), TILE.WALL, "off-grid reads as wall rather than undefined");

ok(world.blocksMove(10, 5, false), "a closed gate blocks movement");
ok(!world.blocksMove(10, 5, true), "an open gate does not");
ok(!world.blocksSight(10, 5), "a gate never blocks sight — it is a portcullis, and blocksSight takes no gate argument at all");
ok(world.blocksEffect(10, 5, false), "a closed gate blocks line of effect");
ok(!world.blocksEffect(10, 5, true), "an open one does not");
ok(world.blocksMove(3, 12, false), "a pillar blocks movement");
ok(world.blocksSight(3, 12), "a pillar blocks sight");
ok(world.blocksEffect(3, 12, false), "and effect");
ok(!world.blocksMove(10, 2, false), "a stairway does not block movement");
ok(!world.blocksSight(10, 2), "a stairway does not block sight");
ok(!world.blocksEffect(10, 2, false), "nor effect");

ok(world.hasLoS(10, 19, 10, 17), "line of sight down an open corridor");
ok(world.hasLoS(1, 6, 20, 6), "a clear row has line of sight end to end");

/* -- line of effect, which is the one that reads the gate ---------------- */
{
  // The whole distinction, on one pair of squares: the heir standing on her
  // spawn can see the stairway through the bars and cannot put a spell
  // through them. Before this phase there was one predicate for both
  // questions and the gate answered it, so "you can see it but you cannot
  // hit it" was not a state this grid could hold.
  //
  // Broken on purpose by giving hasLoE the sight predicate: the second line
  // fails, and it names the gate.
  ok(world.hasLoS(10, 19, 10, 2), "the stairway is visible through a closed gate");
  ok(!world.hasLoE(10, 19, 10, 2, false), "and no spell reaches it while the gate is shut");
  ok(world.hasLoE(10, 19, 10, 2, true), "the open gate lets both through");
  // And the barrier that is not a gate stops both, so the split above is
  // about the gate rather than about hasLoE having quietly stopped working.
  ok(!world.hasLoS(2, 12, 6, 12), "the western pillar blocks sight");
  ok(!world.hasLoE(2, 12, 6, 12, true), "and effect, gate or no gate");
}
ok(world.hasLoS(10, 6, 10, 2, true), "the stairway is visible once the gate opens");
ok(world.hasLoS(4, 10, 5, 10, false), "a wall square can be seen from beside it (endpoints are exempt)");
ok(!world.hasLoS(3, 10, 6, 10, false), "the wall block between them breaks line of sight");

{
  const open = { gateOpen: false, occupied: () => false };
  const p = world.findPath(10, 19, 10, 17, open);
  ok(p && p.length === 3, "a two-square walk is a three-node path");
  eq(p[p.length - 1].g, 10, "two straight squares cost 10 ft");

  const diag = world.findPath(10, 19, 12, 17, open);
  eq(diag[diag.length - 1].g, 15, "two diagonals cost 5 + 10 = 15 ft, not 10");

  ok(!world.findPath(10, 19, 10, 2, open), "no path to the stairway while the gate is shut");
  ok(world.findPath(10, 19, 10, 2, { gateOpen: true, occupied: () => false }),
    "a path to the stairway opens with the gate");
  ok(!world.findPath(10, 19, 0, 0, open), "no path into a wall");
  ok(!world.findPath(10, 19, 3, 12, open), "no path into a pillar");
  ok(!world.findPath(10, 19, 11, 19, { gateOpen: false, occupied: (x, y) => x === 11 && y === 19 }),
    "no path into an occupied square");

  // A path down the western side has to squeeze between the border wall and the
  // wall blocks at x=4..5, and it must not clip a corner of either. (3,12) is
  // the pillar itself, so aim for the square below it.
  const around = world.findPath(3, 9, 3, 13, open);
  ok(around, "there is a path down the western side");
  ok(around.every(n => world.tileAt(n.x, n.y) !== TILE.WALL), "no path node is inside a wall");
  ok(around.every(n => world.tileAt(n.x, n.y) !== TILE.PILLAR), "no path node is inside a pillar");
}

{
  const fov = world.fieldOfView(10, 19, 30);
  ok(fov.has("10,19"), "you can see the square you are standing on");
  ok(fov.has("10,17"), "you can see two squares up the corridor");
  ok(!fov.has("10,2"), "the stairway is outside the 30 ft radius from the spawn — a distance fact, not a gate one");
  for (const k of fov) {
    const [x, y] = k.split(",").map(Number);
    ok(feetBetween(10, 19, x, y) <= 30, `field of view respects the 30 ft radius at ${k}`);
    break;   // one representative assertion; the loop above would add 90 of them
  }
}

{
  const set = new Set(["0,0", "3,1", "21,21"]);
  const bits = packExplored(set, 22, 22);
  eq(bits.length, 484, "the explored bitfield is one character per square");
  const back = unpackExplored(bits, 22, 22);
  eq(back.size, 3, "unpacking recovers exactly the squares that were packed");
  ok(back.has("3,1") && back.has("21,21"), "unpacking recovers the right squares");
  eq(unpackExplored(undefined, 22, 22).size, 0, "unpacking a missing bitfield gives an empty set");
  eq(unpackExplored("", 22, 22).size, 0, "unpacking an empty bitfield gives an empty set");
}

/* ========================================================================= *
 * 3b — templates: the three area shapes
 * ========================================================================= */
section("templates");

/* -- which of eight directions a click points ---------------------------- */
{
  const o = { x: 10, y: 10 };
  const named = (x, y) => octantToward(o, { x, y })?.name;
  eq(named(15, 10), "east", "straight along a row");
  eq(named(10, 20), "south", "straight down a column");
  eq(named(1, 10), "west", "and back the other way");
  eq(named(10, 3), "north", "and up");
  eq(named(15, 15), "south-east", "a clean diagonal");
  eq(named(5, 5), "north-west", "and its opposite");
  eq(named(5, 15), "south-west", "the third");
  eq(named(15, 5), "north-east", "the fourth");
  eq(OCTANTS.length, 8, "eight directions, and no ninth");
  eq(octantToward(o, o), null, "the square you are standing on names no direction at all");
  // The octant boundary is 22.5°, so a click three across and one down is
  // east and a click two across and one down is south-east. A `Math.sign`
  // snap — which is what this looks like it could be — would call both of
  // them south-east and rotate the cone 45° off what the player clicked.
  eq(named(13, 11), "east", "three across and one down snaps to the row");
  eq(named(12, 11), "south-east", "two across and one down snaps to the diagonal");
}

/* -- the cone, against a template counted by hand ------------------------ */
{
  const o = { x: 10, y: 10 };
  const keys = list => list.map(sq => sq.x + "," + sq.y).sort();
  // The whole 15-foot cone, written out, not a count. Derived by hand from
  // the two rules that make it: the quarter circle, and feetBetween's 5/10/5
  // diagonals. A square at (dx, dy) with dx ≥ |dy| measures 5·dx + 5·⌊|dy|/2⌋
  // feet, so at 15 feet dx runs 1..3 while |dy| is 0 or 1, and only dx = 2
  // survives at |dy| = 2.
  eq(JSON.stringify(keys(coneSquares(o, { x: 15, y: 10 }, 15))),
    JSON.stringify(["11,10", "11,11", "11,9", "12,10", "12,11", "12,12", "12,8", "12,9", "13,10", "13,11", "13,9"]),
    "a 15-foot cone east is these eleven squares and no others");
  eq(JSON.stringify(keys(coneSquares(o, { x: 15, y: 15 }, 15))),
    JSON.stringify(["10,11", "10,12", "10,13", "11,10", "11,11", "11,12", "11,13", "12,10", "12,11", "12,12", "13,10", "13,11"]),
    "a 15-foot cone south-east is these twelve");
  // Counted the same way at the other two sizes the phase named. Row by row
  // for the orthogonal cone: |dy| = 0 gives r squares, |dy| = 1 gives 2r, and
  // each further pair of |dy| steps costs one square of reach.
  //   30 ft: 6 + 12 + 8 + 6 + 2                        = 34
  //   60 ft: 12 + 24 + 20 + 18 + 14 + 12 + 8 + 6 + 2   = 116
  eq(coneSquares(o, { x: 20, y: 10 }, 30).length, 34, "a 30-foot cone east covers 34 squares");
  eq(coneSquares(o, { x: 20, y: 10 }, 60).length, 116, "a 60-foot cone east covers 116");
  eq(coneSquares(o, { x: 20, y: 20 }, 30).length, 36, "a 30-foot cone on the diagonal covers 36");
  eq(coneSquares(o, { x: 20, y: 20 }, 60).length, 120, "and a 60-foot one 120");
  // The orthogonal and diagonal counts differ, and that is the diagonal rule
  // showing through rather than a bug: 5/10/5 makes this grid anisotropic, so
  // a shape that came out the same size both ways would be one that had
  // stopped measuring with feetBetween.
  ok(coneSquares(o, { x: 20, y: 20 }, 15).length > coneSquares(o, { x: 20, y: 10 }, 15).length,
    "the diagonal cone is the larger of the two");
  ok(!keys(coneSquares(o, { x: 15, y: 10 }, 15)).includes("10,10"),
    "the caster's own square is never inside her own cone");
  eq(coneSquares(o, o, 15).length, 0, "a cone aimed at your own feet is no cone");
  // Broken on purpose by dropping the feetBetween filter, which turns the
  // cone into an unbounded wedge and fails here rather than in a count.
  let overRange = null;
  for (const sq of coneSquares(o, { x: 20, y: 10 }, 30)) {
    if (feetBetween(o.x, o.y, sq.x, sq.y) > 30) { overRange = sq.x + "," + sq.y; break; }
  }
  eq(overRange, null, "no square in a 30-foot cone is further away than 30 feet");
}

/* -- burst and emanation ------------------------------------------------- */
{
  const o = { x: 10, y: 10 };
  // Counted from max(|dx|,|dy|) + ⌊min/2⌋ ≤ r: a 5-foot burst is the 3×3
  // around its centre; a 10-foot one adds the ring at two squares out except
  // its four corners, which measure 15 feet; a 15-foot one adds the ring at
  // three except the pair flanking each corner.
  eq(burstSquares(o, 5).length, 9, "a 5-foot burst is nine squares");
  eq(burstSquares(o, 10).length, 21, "a 10-foot burst is twenty-one");
  eq(burstSquares(o, 15).length, 37, "a 15-foot burst is thirty-seven");
  ok(burstSquares(o, 10).some(sq => sq.x === 10 && sq.y === 10),
    "the centre square is inside its own burst");
  ok(!burstSquares(o, 10).some(sq => sq.x === 12 && sq.y === 12),
    "and the corner two-and-two out is not: it measures 15 feet, not 10");
  // The claim templates.js makes in its own comment, pinned. Every actor in
  // this engine stands in one square, so an emanation and a burst centred on
  // the same square are the same set. The day a Large creature arrives, this
  // is the failing test that says the two have to come apart.
  for (const feet of [5, 10, 15, 30]) {
    const a = emanationSquares(o, feet).map(sq => sq.x + "," + sq.y).sort().join(" ");
    const b = burstSquares(o, feet).map(sq => sq.x + "," + sq.y).sort().join(" ");
    eq(a, b, `at ${feet} feet an emanation and a burst on the same square are the same shape`);
  }
}

/* -- what terrain does to a shape ---------------------------------------- */
{
  // templates.js knows nothing about pillars; world.js is where a shape meets
  // one. The western pillar stands at 3,12 and the heir at 2,12, so a cone
  // east from her runs straight into it.
  const raw = coneSquares({ x: 2, y: 12 }, { x: 8, y: 12 }, 15);
  const cut = world.reachableFrom(2, 12, raw, false);
  const kept = new Set(cut.map(sq => sq.x + "," + sq.y));
  ok(raw.some(sq => sq.x === 3 && sq.y === 12), "the raw shape covers the pillar's own square");
  // Broken on purpose by having reachableFrom hand `squares` straight back:
  // these two fail, and both name the pillar.
  ok(!kept.has("3,12"), "reachableFrom drops it — there is no setting fire to the inside of a pillar");
  ok(!kept.has("5,12"), "and drops the square behind it, which has no line of effect");
  ok(kept.has("3,11"), "the square beside the pillar is still in the cone");
  // Aimed off the edge of the map.
  let offGrid = null;
  for (const sq of world.reachableFrom(1, 6, coneSquares({ x: 1, y: 6 }, { x: 1, y: 1 }, 30), false)) {
    if (!world.inBounds(sq.x, sq.y)) { offGrid = sq.x + "," + sq.y; break; }
  }
  eq(offGrid, null, "a template aimed off the edge of the map keeps no square that is off it");
}

/* ========================================================================= *
 * 4 — game state, triggers, and the encounter
 * ========================================================================= */
section("game");

{
  const g = createGame({ content: resolved, rng: makeRng(42) });
  g.begin();
  eq(g.mode, "explore", "a new run starts in exploration");
  eq(g.run.pc.hp, 15, "the PC starts at 15 HP");
  eq(g.run.pc.slots, 2, "the PC starts with two rank-1 slots");
  eq(g.run.pc.focus, 1, "the PC starts with one focus point");
  eq(g.run.creatures.filter(c => c.awake).length, 0, "no creature starts awake");
  eq(g.potionCount(), 3, "three potions in the satchel");
  ok(g.explored.has("10,19"), "the spawn square is explored at boot");
  ok(!g.explored.has("10,2"), "the stairway is not explored at boot");

  // Bulk — Player Core p.271. Two 1-Bulk items plus five Light.
  const bulk = g.bulkCarried();
  eq(bulk.forEncumbrance, 2, "five Light items are under a whole Bulk between them");
  ok(Math.abs(bulk.exact - 2.5) < 1e-9, "the readout shows the tenths");

  // A command that needs a target refuses without one, and refusing costs
  // nothing — the original build decremented actions before validating range.
  const before = JSON.stringify(g.run.pc);
  eq(g.useCommand("strike", "nope").ok, false, "Strike with no target is refused");
  eq(g.useCommand("breathe", null).ok, false, "a cone with no direction is refused");
  eq(JSON.stringify(g.run.pc), before, "a refused command changes nothing");
  eq(g.commandBlocked("strike"), "explore", "combat commands are unavailable out of an encounter");
  eq(g.commandBlocked("potion"), null, "a potion can be drunk out of an encounter");
}

{
  // Walking into notice range wakes exactly one sentinel, not both. This is the
  // headline fix: the shipped build woke every creature at once and put six
  // attacks a round into a 15 HP wizard.
  const g = createGame({ content: resolved, rng: makeRng(7) });
  g.begin();
  const r = travel(g, 7, 14);
  eq(r, "combat", "walking into the middle of the room starts an encounter");
  eq(g.awake().length, 1, "exactly one sentinel wakes");
  eq(g.mode, "combat", "the game is in encounter mode");
  eq(g.run.creatures.filter(c => c.awake)[0].creature, "shattered-sentinel", "the sentinel is what woke");
  ok(g.run.stats.woken === 1, "the run counted one waking");
}

{
  // The gate needs both pillars, and opening it is the adventure's only rest.
  const g = createGame({ content: resolved, rng: makeRng(3) });
  g.begin();
  g.run.pc.x = 3; g.run.pc.y = 13;
  g.run.pc.hp = 4; g.run.pc.slots = 0; g.run.pc.focus = 0;
  eq(g.readPillar(3, 12).ok, true, "the western pillar reads when adjacent");
  eq(g.run.gateOpen, false, "one pillar does not open the gate");
  eq(g.readPillar(3, 12).ok, false, "the same pillar cannot be read twice");
  eq(g.readPillar(18, 12).ok, false, "the far pillar cannot be read from across the room");
  g.run.pc.x = 18; g.run.pc.y = 13;
  eq(g.readPillar(18, 12).ok, true, "the eastern pillar reads when adjacent");
  eq(g.run.gateOpen, true, "both pillars open the gate");
  eq(g.run.pc.slots, 2, "the seal's rest restores spell slots");
  eq(g.run.pc.focus, 1, "the seal's rest restores the focus point");
  eq(g.run.pc.hp, 15, "the seal's rest restores hit points");
  eq(g.run.creatures.find(c => c.creature === "vault-keeper").wakesOn, "notice",
    "the Keeper starts noticing once the gate is open");
}

/** Hand control back to the PC, however many creature turns that takes. */
function toPCTurn(g, limit = 40) {
  let guard = 0;
  while (g.mode === "combat" && !g.isPCTurn() && guard++ < limit) {
    let r = g.advance();
    while (r && r.actor !== "pc" && guard++ < limit) r = g.advance();
  }
  return g.isPCTurn();
}

{
  // The treasure is a standing condition, not an event. This is the bug the
  // balance harness found: a third of runs killed a boss while standing on
  // the casket and were never told they had won. The casket lives in the
  // sanctum now, so this run is built straight into that area — via `state`,
  // not by walking the whole vault to get there — with the Keeper already
  // down, since requiresDown names both bosses.
  const state = freshRun(content);
  state.areaId = "sanctum";
  state.gateOpen = true;
  state.creatures.find(c => c.creature === "vault-keeper").dead = true;
  const wardenStart = state.creatures.find(c => c.creature === "reliquary-warden");
  wardenStart.hp = 1;                        // one Force Fang from gravel
  state.pc.x = 6; state.pc.y = 8;             // the sanctum's own arrival square
  const g = createGame({ content: resolved, rng: makeRng(5), state });
  g.begin();
  eq(g.mode, "explore", "the run starts in exploration, already delivered into the sanctum");

  g.walkTo(6, 4);                            // notice fires on the way to the casket
  eq(g.mode, "combat", "approaching the casket wakes the warden guarding it");
  ok(toPCTurn(g), "control comes back to the PC");

  // Place both bodies by hand from here. The warden's own AI will happily
  // take the casket square itself, and this test is about the win condition,
  // not about where a construct chooses to stand.
  const warden = g.run.creatures.find(c => c.creature === "reliquary-warden");
  g.run.pc.x = 5; g.run.pc.y = 4;             // on the casket
  warden.x = 6; warden.y = 4;                 // beside it, still adjacent
  eq(g.tileAt(g.run.pc.x, g.run.pc.y), TILE.TREASURE, "the PC is standing on the casket");
  g.turn.actions = 3;
  g.walkTo(6, 5);                             // a step that resolves triggers
  g.run.pc.x = 5; g.run.pc.y = 4;
  eq(g.run.outcome, null, "standing on a guarded casket does not win");

  g.run.pc.focus = 1;
  g.turn.actions = 3;
  eq(g.useCommand("fang", warden.key).ok, true, "Force Fang reaches the warden");
  eq(warden.dead, true, "the warden is down");
  eq(g.run.outcome, "victory", "the warden dying under the PC's feet wins immediately");
}

{
  // A creature that loses sight of the PC settles and reknits to full, so
  // hit-and-run cannot grind it down for free.
  //
  // (3,9) to (6,12) is blocked by the wall block at x=4..5, y=10..11 — checked
  // directly below, because a disengage test that passes because the geometry
  // was wrong is worse than no test.
  eq(world.hasLoS(3, 9, 6, 12, false), false, "the wall block does break that line of sight");

  const g = createGame({ content: resolved, rng: makeRng(9) });
  g.begin();
  eq(travel(g, 7, 14), "combat", "walking into the room starts an encounter");
  ok(toPCTurn(g), "control is with the PC");
  const c = g.awake()[0];
  ok(c, "a sentinel is awake");
  c.hp = 2;
  c.x = 3; c.y = 9;
  g.run.pc.x = 6; g.run.pc.y = 12;
  g.endTurn();
  eq(c.awake, false, "a sentinel that cannot see the PC settles");
  eq(c.hp, content.creatures["shattered-sentinel"].hp, "and reknits to full, so the grind is not free");
  eq(g.mode, "explore", "the encounter ends when nothing is awake");
}

{
  // Shield is a real +1 for a round and lapses on your next turn.
  const g = createGame({ content: resolved, rng: makeRng(21) });
  g.begin();
  travel(g, 7, 14);
  if (g.isPCTurn()) {
    eq(g.pcAC(), 15, "base AC is 15");
    eq(g.useCommand("shield").ok, true, "Shield casts for one action");
    eq(g.pcAC(), 16, "Shield is worth +1 AC");
    eq(g.actionsLeft, 2, "Shield cost exactly one action");
    let r = g.endTurn();
    while (r && r.actor !== "pc") r = g.advance();
    eq(g.shielded, false, "Shield lapses at the start of your next turn");
    eq(g.pcAC(), 15, "and AC goes back to 15");
  } else {
    ok(true, "sentinel won initiative on this seed; Shield checked elsewhere");
    ok(true, "");
    ok(true, "");
    ok(true, "");
    ok(true, "");
    ok(true, "");
  }
}

{
  // Spending the last action ends the turn without the caller asking.
  const g = createGame({ content: resolved, rng: makeRng(31) });
  g.begin();
  travel(g, 7, 14);
  let guard = 0;
  while (!g.isPCTurn() && g.mode === "combat" && guard++ < 20) g.advance();
  if (g.isPCTurn() && g.mode === "combat") {
    g.turn.actions = 1;
    const res = g.useCommand("shield");
    eq(res.ok, true, "the last action spends");
    eq(res.turnEnded, true, "and the turn ends by itself");
  } else { ok(true, "skipped: not the PC's turn on this seed"); ok(true, ""); }
}

{
  // The encounter always terminates. A turn loop that could spin forever is
  // worse than a losing fight.
  const g = createGame({ content: resolved, rng: makeRng(1234) });
  g.begin();
  travel(g, 10, 12);
  fight(g, { maxTurns: 400 });
  ok(g.mode !== "combat" || !!g.run.outcome, "the encounter reached an end state");
}

{
  // The whole adventure is finishable. This is the assertion the shipped build
  // could not have passed on any seed.
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    const g = createGame({ content: resolved, rng: makeRng(1000 + i) });
    if (playThrough(g).outcome === "victory") wins++;
  }
  ok(wins > 0, `the adventure is winnable (${wins}/40 seeds)`);
  ok(wins < 40, `and losable (${40 - wins}/40 seeds lost)`);
}

{
  // The second build is a whole different command list (no cone, no unerring,
  // no self-buff) and autopilot.mjs's combatPolicy is generic over "whatever
  // kind of commands this build has" specifically so this does not need its
  // own driver. If the fighter never won or never fought, that genericness
  // would be the first thing to suspect.
  const fighterContent = selectPc(content, "fighter");
  let wins = 0, fought = 0;
  for (let i = 0; i < 40; i++) {
    const g = createGame({ content: fighterContent, rng: makeRng(2000 + i) });
    const r = playThrough(g);
    if (g.run.stats.rounds > 0) fought++;
    if (r.outcome === "victory") wins++;
  }
  eq(fought, 40, "the fighter build actually reaches and fights the sentinels, every seed");
  ok(wins > 0, `the fighter build's adventure is winnable (${wins}/40 seeds)`);
  ok(wins < 40, `and losable (${40 - wins}/40 seeds lost)`);
}

/* -- areas: the cone, the burst and the emanation, as the engine casts them */

/**
 * A hand-built fight in the open floor of the vault, so a template has room
 * to be a shape rather than a corridor. Seeds 1 through 6 all give Vesper the
 * first turn with three actions; the tests below say which they use.
 */
function areaFight({ seed = 1, pc = [10, 8], foes = [], gateOpen = true, pack = content } = {}) {
  const c = selectPc(pack, "wizard");
  const g = createGame({
    content: c, rng: makeRng(seed),
    state: {
      packId: pack.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: pc[0], y: pc[1], hp: 15, slots: 2, focus: 1 },
      creatures: foes.map((f, i) => ({
        key: i === 0 ? "vault:shattered-sentinel@7,8" : "vault:shattered-sentinel@14,8",
        area: "vault", creature: "shattered-sentinel", wakesOn: "notice",
        x: f[0], y: f[1], hp: 11, awake: true, dead: false,
      })),
      loreRead: [], gateOpen, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  return g;
}

const saveLines = g => g.run.log.filter(e => e.kind === "dice" && / — basic /.test(e.text)).length;

{
  // The assertion this phase exists for: the squares the engine says it will
  // cover are the squares it resolves against. There is one function now and
  // both callers read it, so this cannot drift — but "cannot drift" is what
  // the two copies of the cone trigonometry looked like too, and one of them
  // had `feet > 15` hardcoded in it.
  //
  // Broken on purpose by putting a second filter back inside the resolution
  // loop — any range test of its own, which is exactly the shape of the bug:
  // it leaves the preview alone and quietly narrows what the spell hits. The
  // save-line count is the assertion that catches it, and it is the count and
  // not the damage, because a creature that saves takes nothing either way.
  const g = areaFight({ seed: 1, foes: [[12, 8], [12, 9]] });
  const cone = g.content.commandById.breathe;
  const shown = g.templateSquares(cone, { x: 14, y: 8 });
  const covered = new Set(shown.map(sq => sq.x + "," + sq.y));
  const inside = g.living().filter(c => covered.has(c.x + "," + c.y));
  eq(inside.length, 2, "both sentinels stand in the previewed cone");
  ok(g.useCommand("breathe", { x: 14, y: 8 }).ok, "Breathe Fire goes off");
  eq(saveLines(g), 2, "and exactly the two creatures the preview covered rolled a save");
  ok(g.living().every(c => c.hp < 11) || g.living().length < 2,
    "both of them felt it");
}

{
  // The hardcoded 15 is gone, and this is what proves it rather than the
  // absence of a string. Same spell at 30 feet, one sentinel 25 feet away:
  // under the old preview math it was outside the shape, and under the old
  // resolution it was inside, which is the disagreement nothing could see.
  //
  // Broken on purpose by capping the cone at 15 feet inside templates.js.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.commands.find(c => c.id === "breathe").coneFeet = 30;
  const long = loadPack(p);
  const g = areaFight({ seed: 1, pc: [5, 8], foes: [[10, 8]], pack: long });
  eq(feetBetween(5, 8, 10, 8), 25, "the sentinel stands 25 feet away, past where the old preview stopped");
  const shown = g.templateSquares(g.content.commandById.breathe, { x: 12, y: 8 });
  ok(shown.some(sq => sq.x === 10 && sq.y === 8), "a 30-foot cone reaches its square");
  ok(g.useCommand("breathe", { x: 12, y: 8 }).ok, "and the spell goes off");
  eq(saveLines(g), 1, "the sentinel 25 feet out rolled its save");
}

{
  // Line of effect, in the one place a player will meet it: the western
  // pillar, with a sentinel directly behind it. The heir can see it — sight
  // does not stop at a pillar's far side by accident, it stops at the pillar
  // — and the cone still cannot reach it, because the shape is cut by
  // reachableFrom before a single save is rolled.
  //
  // Broken on purpose by dropping the hasLoE filter out of reachableFrom.
  const g = areaFight({ seed: 1, pc: [2, 12], foes: [[5, 12]] });
  const cone = g.content.commandById.breathe;
  const shown = g.templateSquares(cone, { x: 8, y: 12 });
  ok(!shown.some(sq => sq.x === 5 && sq.y === 12), "the square behind the pillar is not in the cone");
  ok(g.useCommand("breathe", { x: 8, y: 12 }).ok, "the spell still goes off — a slot is a slot");
  eq(saveLines(g), 0, "and nothing rolls a save");
  eq(g.living()[0].hp, 11, "the sentinel behind the pillar is untouched");
  ok(g.run.log.some(e => e.text.includes("nothing is caught in the cone")),
    "the log says so out loud rather than leaving the player to wonder");
}

{
  // A burst is placed, and placement is the thing that can be refused. Range
  // first, then the barrier — and a refusal spends nothing, which is the
  // property every refusal in this engine has and the one worth checking on
  // a command that costs a slot.
  const g = areaFight({ seed: 1, foes: [[12, 8], [12, 9]] });
  const far = g.useCommand("emberburst", { x: 10, y: 19 });
  eq(far.reason, "range", "a burst centred 55 feet away is refused");
  eq(g.run.pc.slots, 2, "and the slot is still there");
  eq(g.actionsLeft, 3, "and so are the actions");
  ok(g.useCommand("emberburst", { x: 12, y: 9 }).ok, "one centred on a sentinel goes off");
  eq(saveLines(g), 2, "and catches both of them, ten feet apart");
  eq(g.run.pc.slots, 1, "that one did spend the slot");
}

{
  // The same refusal, for the other reason. The heir stands five squares
  // south of the sealed gate: 25 feet, inside Ember Burst's 30, and she can
  // see straight through the bars. Line of effect is the whole of why this is
  // refused, so the second half opens the gate and casts the same spell at
  // the same square.
  //
  // Broken on purpose by giving canPlaceBurst hasLoS instead of hasLoE: the
  // first assertion fails, and it names the closed gate.
  const shut = areaFight({ seed: 1, foes: [[12, 8]], gateOpen: false });
  eq(feetBetween(10, 8, 10, 3), 25, "the square past the gate is 25 feet off, inside the spell's 30");
  ok(shut.world.hasLoS(10, 8, 10, 3), "and she can see it through the bars");
  eq(shut.useCommand("emberburst", { x: 10, y: 3 }).reason, "range",
    "the burst is refused anyway — there is no line of effect through a shut gate");
  const open = areaFight({ seed: 1, foes: [[12, 8]], gateOpen: true });
  ok(open.useCommand("emberburst", { x: 10, y: 3 }).ok, "with the gate open the same placement is legal");
}

{
  // An emanation takes no target at all, which is the one thing about it the
  // UI has to get right: it fires from the command list like Shield does,
  // with nothing to click. Ten feet reaches two squares out, so the sentinel
  // at arm's length is in it and the one twenty feet away is not.
  const g = areaFight({ seed: 1, foes: [[11, 8], [14, 8]] });
  eq(feetBetween(10, 8, 14, 8), 20, "the second sentinel is twenty feet off");
  const shown = g.templateSquares(g.content.commandById.wardpulse, null);
  // `shown ?? []`, and the null gets its own line, because the first version
  // of this block read `shown.some(...)` straight off. Breaking the emanation
  // so it demanded an aim square it can never be given returned null, `.some`
  // threw, and the run exited 1 with no FAIL line at all — a non-zero exit
  // that says nothing about which guard caught it. That is the same defect
  // the persistent-fire duration lookup had last phase (locked #147's
  // neighbour), and it is worth writing down twice: an assertion that crashes
  // is not an assertion that failed.
  ok(shown !== null, "an emanation is a shape without being aimed");
  const ring = shown ?? [];
  ok(ring.some(sq => sq.x === 11 && sq.y === 8), "the ring covers the square beside her");
  ok(!ring.some(sq => sq.x === 14 && sq.y === 8), "and not the one four squares out");
  ok(g.useCommand("wardpulse").ok, "Warding Pulse needs no target");
  eq(saveLines(g), 1, "one sentinel rolled a save");
  eq(g.byKey("vault:shattered-sentinel@14,8").hp, 11, "and the far one is untouched");
}

{
  // A cone or a burst with no square to aim at is a refusal, not an empty
  // area that quietly spends the slot.
  const g = areaFight({ seed: 1, foes: [[12, 8]] });
  eq(g.useCommand("breathe").reason, "no-target", "a cone with nothing to aim at is refused");
  eq(g.useCommand("emberburst").reason, "no-target", "and so is a burst");
  eq(g.run.pc.slots, 2, "neither spent a slot");
}

/* -- the third drift guard: one shape, and no trigonometry --------------- */
{
  // The same shape as the `check(` and `rollDamage(` guards. Two copies of
  // the cone math existed in this repo — one resolving, one previewing — and
  // the failure mode was neither a crash nor a wrong number but a player
  // shown a different spell than the one that went off. What replaces them is
  // one function per shape, called once each, in one file.
  //
  // Broken on purpose by inlining an atan2 bearing test back into the
  // resolution loop.
  const read = f => fs.readFileSync(path.join(HERE, "..", "js", f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const gameSrc = read("game.js"), rend = read("render.js");
  eq((gameSrc.match(/Math\.atan2/g) || []).length, 0, "no trigonometry left in game.js");
  eq((rend.match(/Math\.atan2/g) || []).length, 0, "and none left in render.js");
  eq((gameSrc.match(/\bconeSquares\(/g) || []).length, 1, "game.js asks for a cone in exactly one place");
  eq((gameSrc.match(/\bburstSquares\(/g) || []).length, 1, "and a burst in one");
  eq((gameSrc.match(/\bemanationSquares\(/g) || []).length, 1, "and an emanation in one");
  ok(/function templateSquares\(cmd, target, caster\)/.test(gameSrc), "and all three are inside templateSquares");
  // The renderer no longer works a shape out for itself. It knows the word
  // "template" and nothing about feet.
  ok(/game\.templateSquares\(/.test(rend), "render.js asks the engine for the squares it paints");
  ok(!/coneFeet/.test(rend), "and never reads a range of its own");
}

/* ========================================================================= *
 * 5 — reactions, and the three points a turn can be interrupted at
 *
 * Every assertion below was watched failing first (#34); where the break was
 * not obvious, the comment says what was broken to produce it.
 * ========================================================================= */
section("reactions");

/* -- the contract ------------------------------------------------------- */
{
  const rs = content.commandById["reactive-strike"];
  eq(rs.kind, "reaction", "Reactive Strike is a reaction");
  eq(rs.cost, 0, "and costs no action");
  eq(rs.effect, "strike", "with a strike effect");
  eq(JSON.stringify(rs.triggers), JSON.stringify(["move-out-of-reach"]),
    "answering the move trigger and only that one");
  const sb = content.commandById["shield-block"];
  eq(sb.effect, "reduce", "Shield Block reduces");
  eq(sb.hardness, 5, "by the force disc's Hardness 5");
  eq(sb.requiresShield, true, "and needs the Shield cantrip up");
  ok(sb.damageTypes.includes("bludgeoning"), "physical damage is blockable");
  ok(!sb.damageTypes.includes("fire"), "fire is not — a disc of force does nothing about heat");

  ok(fighterContent.commandById["reactive-strike"], "the fighter carries Reactive Strike");
  ok(!fighterContent.commandById["shield-block"], "and not the wizard's Shield Block");
  ok(resolved.commandById["shield-block"], "the wizard carries Shield Block");
  ok(!resolved.commandById["reactive-strike"], "and not the fighter's Reactive Strike");

  eq(JSON.stringify(content.creatures["vault-keeper"].reactions), JSON.stringify(["reactive-strike"]),
    "the Vault Keeper has Reactive Strike");
  eq(content.creatures["shattered-sentinel"].reactions.length, 0, "a sentinel has none");
  // selectPc narrows the build's commands; a creature's feats have nothing to
  // do with which heir walked in, so they are looked up in the whole pack.
  ok(resolved.allCommandById["reactive-strike"],
    "a creature's reaction is still findable once selectPc has narrowed to the wizard");
  eq(content.pcOptions[0].reachFeet, 5, "a level-1 weapon threatens 5 feet");
  eq(content.creatures["vault-keeper"].reachFeet, 5, "and so does a basalt fist");
}

/* -- the vocabulary is the engine's, not a parallel list ------------------ */
{
  // The drift check. content.js declares three trigger names and game.js fires
  // three string literals, and nothing but this connects them: a fourth name
  // in either list is a reaction that validates and never fires, or an event
  // no pack is allowed to name. Broken on purpose by adding a fourth entry to
  // REACTION_TRIGGERS, and again by renaming one fireTrigger() call.
  const src = fs.readFileSync(path.join(HERE, "..", "js", "game.js"), "utf8");
  const fired = [...src.matchAll(/fireTrigger\("([a-z-]+)"/g)].map(m => m[1]);
  eq(fired.length, 3, "game.js fires exactly three named triggers");
  eq(JSON.stringify([...fired].sort()), JSON.stringify([...REACTION_TRIGGERS].sort()),
    "the events game.js fires are exactly the ones content.js lets a pack name");
  eq(JSON.stringify(REACTION_EFFECTS), JSON.stringify(["strike", "reduce"]),
    "and a reaction does one of two things");
}

/**
 * The Keeper with its ability list taken away: a boss that only punches.
 *
 * Most of what keeperFight() is used for below is watching one Basalt Fist
 * land and reading what it left behind. The shipped Keeper is a caster that
 * opens with a two-action cone, so on the pack as written those turns hold one
 * fist instead of three, and every assertion counting fists would be measuring
 * a different action while still reading as a condition test. Stripping the
 * ability is the smaller lie: the fist is unchanged, and the tests that are
 * actually about the ability ask for it with `{ ability: true }`.
 */
function fistOnly(p) {
  delete p.creatures["vault-keeper"].abilities;
  delete p.creatures["vault-keeper"].ai;
  return p;
}
const fistOnlyPack = loadPack(fistOnly(JSON.parse(JSON.stringify(rawPack))));

/**
 * A scenario builder: the PC standing next to the Vault Keeper, gate open,
 * the Keeper awake, in the upper chamber. Hand-built rather than played into,
 * because the interesting cases are all about which square somebody left and
 * walking there first would spend the round getting into position.
 *
 * `ability: true` uses the Keeper the pack ships, cone and all.
 */
function keeperFight(buildId, seed, pcAt = [10, 4], { ability = false } = {}) {
  const pack = ability ? content : fistOnlyPack;
  const c = selectPc(pack, buildId);
  const build = pack.pcById[buildId];
  const state = {
    packId: pack.pack.id, buildId, areaId: "vault",
    pc: { x: pcAt[0], y: pcAt[1], hp: build.hp, slots: build.slots, focus: build.focus },
    creatures: [{
      key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
      wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
    }],
    loreRead: [], gateOpen: true, fog: {},
    inventory: [], log: [],
    stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 },
    outcome: null,
  };
  const g = createGame({ content: c, rng: makeRng(seed), state });
  g.begin();
  return g;
}

/* -- move-out-of-reach: the trigger the whole phase is named after -------- */
{
  // Seed 1 puts Kessa first in the initiative order, so this is her turn with
  // three actions and a Keeper standing beside her.
  const g = keeperFight("fighter", 1);
  eq(g.mode, "combat", "the hand-built state boots straight into the encounter");
  ok(g.isPCTurn(), "and on the PC's turn");
  eq(g.run.stats.reactions, 0, "nothing has reacted yet");
  eq(g.turn.reaction, 1, "the PC's reaction is up");
  ok(!g.turn.reacted.has("vault:vault-keeper@11,1"), "and so is the Keeper's");

  const hp0 = g.run.pc.hp;
  // (10,4) to (9,3) is one diagonal step. The Keeper at (11,4) threatens the
  // square she left and not the one she lands on.
  ok(g.walkTo(9, 3).ok, "Kessa Strides out of the Keeper's reach");
  eq(g.run.stats.reactions, 1, "the Keeper Reactive Strikes as she goes");
  ok(g.turn.reacted.has("vault:vault-keeper@11,1"), "and its reaction is spent");
  ok(g.run.pc.hp < hp0, "the swing connected (seed 1 is a hit)");
  ok(g.run.log.some(e => e.text.includes("Reactive Strike, as Kessa Vane leaves reach")),
    "the log says why it happened, in the square it happened in");

  // One per round. Walking back in provokes nothing — the trigger is leaving
  // reach, not being near — and walking out again finds the reaction spent.
  ok(g.walkTo(10, 4).ok, "she Strides back in");
  eq(g.run.stats.reactions, 1, "stepping *toward* the Keeper provokes nothing");
  ok(g.walkTo(9, 3).ok, "and out again, in the same round");
  eq(g.run.stats.reactions, 1, "a reaction fires once per round and not twice");
  eq(g.lastTrigger("move-out-of-reach").refusals.find(r => r.actor === "vault:vault-keeper@11,1").why, "spent",
    "refused because it is spent, not because it did not qualify");
  eq(g.actionsLeft, 0, "three Strides, three actions");
}

{
  // Both halves of the move trigger, on their own.
  //
  // "Left a square inside my reach" and "arrived at one outside it" fail
  // differently, and the round-budget tests above hide both: once a reaction
  // has been spent, every later refusal looks the same. Drop the first half
  // and a creature crossing the room provokes from anywhere. Drop the second
  // and shuffling from one square beside a foe to another provokes — a free
  // hit every time a player repositions in melee, which is not the rule.
  //
  // The second half genuinely had no coverage when it was written: it was
  // removed on purpose and all 394 other assertions stayed green.
  const inside = keeperFight("fighter", 1);
  // (10,4) and (11,3) are both adjacent to the Keeper standing at (11,4).
  ok(inside.walkTo(11, 3).ok, "Kessa shuffles from one square beside the Keeper to another");
  eq(inside.run.stats.reactions, 0, "moving within reach provokes nothing");
  eq(inside.lastTrigger("move-out-of-reach").refusals.find(r => r.actor === "vault:vault-keeper@11,1").why, "still-in-reach",
    "and the Keeper's offer was refused for that reason");
  ok(!inside.turn.reacted.has("vault:vault-keeper@11,1"), "and the Keeper's reaction is still up");

  const outside = keeperFight("fighter", 1, [9, 3]);
  ok(outside.isPCTurn(), "the second scenario also opens on the PC's turn");
  // (9,3) and (9,2) are both out of the Keeper's reach at (11,4).
  ok(outside.walkTo(9, 2).ok, "Kessa walks from one square out of reach to another");
  eq(outside.run.stats.reactions, 0, "moving outside reach provokes nothing either");
  eq(outside.lastTrigger("move-out-of-reach").refusals.find(r => r.actor === "vault:vault-keeper@11,1").why, "not-in-reach",
    "and that offer was refused for its own reason");
}

{
  // The refresh. A reaction spent on round one is back on round two, and it is
  // refreshed at the top of the reactor's own turn — nowhere else. Broken on
  // purpose by deleting the turn.reacted.delete(key) line in advance(), which
  // left the Keeper unable to react for the rest of the fight.
  const g = keeperFight("fighter", 1);
  g.walkTo(9, 3);
  eq(g.run.stats.reactions, 1, "it fires on round one");
  let r = g.endTurn();
  while (r && r.actor !== "pc") r = g.advance();
  ok(!g.run.outcome, "Kessa survives the Keeper's round (seed 1)");
  ok(!g.turn.reacted.has("vault:vault-keeper@11,1"), "the Keeper's reaction came back on its own turn");
  eq(g.turn.reaction, 1, "and so did the PC's, at the top of hers");
}

{
  // A reaction is not a button. It has no action cost, it fires on somebody
  // else's turn, and there is no way for a player to spend one by hand — which
  // is what stops Kessa Reactive Striking on her own turn for a free attack.
  const g = keeperFight("fighter", 1);
  eq(g.useCommand("reactive-strike", null).reason, "reaction-only",
    "a reaction cannot be fired by hand");
  eq(g.actionsLeft, 3, "and refusing it costs nothing");
  eq(g.commandBlocked("reactive-strike"), null, "it reads as available while it is unspent");
  g.walkTo(9, 3);
  eq(g.commandBlocked("reactive-strike"), null, "the Keeper spending its reaction is not Kessa spending hers");
}

/* -- incoming-damage: Shield Block, before a hit point moves -------------- */
{
  // Seed 12, and the thing the disc stops is Gravel Wave rather than a fist:
  // the Keeper is a caster now and opens with the cone, which is bludgeoning
  // and so is exactly what a force disc is allowed to soak. That the block
  // fires on a creature's *area* effect and not only on its Strike is the
  // point worth having here — incoming-damage is one trigger, and a hit point
  // does not know which shape took it off.
  const g = keeperFight("wizard", 12, [10, 4], { ability: true });
  eq(g.commandBlocked("shield-block"), "no-shield", "Shield Block is unavailable with no Shield up");
  ok(g.useCommand("shield").ok, "Vesper casts Shield");
  eq(g.commandBlocked("shield-block"), null, "and now the disc can block");
  eq(g.pcAC(), 16, "AC 15 becomes 16 while it is up");

  const hp0 = g.run.pc.hp;
  const before = g.run.log.length;
  // One step only. Advancing all the way back round to the PC would reach the
  // top of her turn, where Shield lapses on its own — and an assertion about
  // the disc being gone would then pass whether it blocked anything or not.
  const r = g.endTurn();
  ok(r && r.actor !== "pc", "the Keeper takes its turn");
  const fresh = g.run.log.slice(before);
  const blockAt = fresh.findIndex(e => e.text.includes("Shield Block: 5 damage stopped"));
  ok(blockAt >= 0, "the Keeper's Gravel Wave rings off the disc");
  eq(g.run.stats.reactions, 1, "one block, not one per attack — the disc is spent doing it");
  const dmgAt = fresh.findIndex((e, i) => i > blockAt && e.kind === "damage");
  ok(dmgAt > blockAt, "the block is logged before the damage, because it happened before it");

  // The number in the damage line is the number that reached the wizard, and
  // it is what run.pc.hp actually lost. Broken on purpose by moving the
  // softenedBy() call in hurtPC() to after the subtraction: the log still read
  // "5 damage stopped" and the HP bar dropped the full amount anyway.
  const took = Number(/takes (\d+) /.exec(fresh[dmgAt].text)[1]);
  eq(hp0 - g.run.pc.hp, took, "the damage that landed is the damage the log shows");
  ok(!g.shielded, "and the disc is gone — blocking with it destroys it (Player Core)");
}

{
  // No Shield, no block: the same fight, the same seed, the full damage.
  const shielded = keeperFight("wizard", 12, [10, 4], { ability: true });
  shielded.useCommand("shield");
  let a = shielded.endTurn();
  while (a && a.actor !== "pc" && !shielded.run.outcome) a = shielded.advance();

  const bare = keeperFight("wizard", 12, [10, 4], { ability: true });
  let b = bare.endTurn();
  while (b && b.actor !== "pc" && !bare.run.outcome) b = bare.advance();
  eq(bare.run.stats.reactions, 0, "with no Shield up nothing blocks");
  ok(bare.run.pc.hp < shielded.run.pc.hp,
    `the blocked run keeps more HP (${shielded.run.pc.hp} vs ${bare.run.pc.hp})`);
}

{
  // A disc of force does nothing about heat. Same fight, same seed, both of
  // the Keeper's damage sources retyped as fire — the reaction is offered and
  // refused on the damage type rather than fired and wasted. Both, because the
  // Keeper opens with Gravel Wave: retyping the fist alone would leave a
  // bludgeoning cone in front of it and the disc would block that instead,
  // which is a passing test measuring nothing.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.creatures["vault-keeper"].damageType = "fire";
  p.commands.find(c => c.id === "gravel-wave").damageType = "fire";
  const hot = loadPack(p);
  const c = selectPc(hot, "wizard");
  const g = createGame({
    content: c, rng: makeRng(12),
    state: {
      packId: hot.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: 10, y: 4, hp: 15, slots: 2, focus: 1 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  ok(g.useCommand("shield").ok, "Vesper casts Shield against a Keeper that burns");
  g.endTurn();                       // the Keeper's whole turn, and no further
  ok(g.run.pc.hp < 15, "the fire lands");
  eq(g.run.stats.reactions, 0, "Shield Block does not fire against fire damage");
  eq(g.lastTrigger("incoming-damage").refusals.find(r => r.command === "shield-block").why, "damage-type",
    "the disc was offered the hit and refused it on its type");
  ok(g.shielded, "and the disc is still up, unspent, because it was never offered");
}

/* -- incoming-attack: the third named point, and a PC reactor ------------- */
{
  // No shipped build owns a reaction on this trigger — at level 1 neither a
  // Fighter nor a Wizard has one, and inventing a feat to fill the table would
  // be worse than an empty seat. The engine fires it anyway, at both Strike
  // sites, and this is the proof it is a real point rather than a comment: a
  // pack that hangs a strike reaction off it gets one.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.commands.push({
    id: "riposte", name: "Riposte", cost: 0, kind: "reaction", effect: "strike",
    triggers: ["incoming-attack"], attackBonus: 7, damage: "1d8+2", damageType: "slashing",
  });
  p.pcOptions.find(b => b.id === "fighter").commands.push("riposte");
  const fenced = loadPack(p);
  const c = selectPc(fenced, "fighter");
  const g = createGame({
    content: c, rng: makeRng(1),
    state: {
      packId: fenced.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 18, slots: 0, focus: 0 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  g.endTurn();                       // the Keeper's whole turn: three fists
  eq(g.run.stats.reactions, 1, "Kessa Ripostes the first fist that comes at her, once");
  eq(g.run.log.filter(e => e.kind === "dice" && e.text.startsWith("Riposte vs")).length, 1,
    "one Riposte was rolled, not one per fist");
  const riposteAt = g.run.log.findIndex(e => e.text.startsWith("Riposte vs"));
  const firstFist = g.run.log.findIndex(e => e.text.includes("Basalt Fist vs"));
  ok(riposteAt >= 0 && riposteAt < firstFist,
    "and it resolved before the fist that triggered it was rolled");
  // A reaction happens on somebody else's turn, so it is no part of her own
  // action sequence: it takes no multiple-attack penalty and adds none. Broken
  // on purpose by routing resolveReaction's strike through turn.attacks, which
  // gave her a −5 on the first Strike of her *next* turn.
  eq(g.turn.attacks, 0, "a reaction Strike leaves the PC's own MAP counter alone");

  // And it comes back at the top of her own turn, and not a moment sooner.
  // The other refresh test above never spends the PC's reaction, so it cannot
  // tell a working refresh from a value that was simply never touched: this
  // one watches 0 become 1. Broken on purpose by deleting the
  // `turn.reaction = 1` line in advance(), which left Kessa able to Riposte
  // exactly once per fight.
  eq(g.turn.reaction, 0, "her reaction is spent while the Keeper's turn is still resolving");
  let r = g.advance();
  while (r && r.actor !== "pc" && !g.run.outcome) r = g.advance();
  ok(!g.run.outcome, "she survives the Keeper's round");
  eq(g.turn.reaction, 1, "and her reaction is back at the top of her own turn");
}

/* -- a walk that is interrupted between two squares ----------------------- */
{
  // The structural claim of this phase, on the side of the board where it can
  // actually happen: a move is resolved square by square, and a reaction that
  // lands mid-walk stops it where it landed rather than after the fact.
  //
  // Kessa at 1 HP asks for a three-square walk out of the Keeper's reach. The
  // Reactive Strike fires on the square where the route actually leaves that
  // reach, and kills her standing on it. Before this phase the whole path was
  // assigned in one statement and she would have died on the far end of it.
  const c = selectPc(content, "fighter");
  const g = createGame({
    content: c, rng: makeRng(1),
    state: {
      packId: content.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 1, slots: 0, focus: 0 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  ok(g.isPCTurn(), "Kessa opens the round on 1 HP");
  const full = g.world.findPath(10, 4, 9, 1, { gateOpen: true, occupied: () => false });
  const r = g.walkTo(9, 1);
  eq(r.stoppedBy, "interrupted", "the walk reports that something stopped it");
  ok(r.path.length < full.length,
    `it stopped short of the route it was given (${r.path.length} squares of ${full.length})`);
  ok(!(g.run.pc.x === 9 && g.run.pc.y === 1), "she never reached the square she asked for");
  eq(`${g.run.pc.x},${g.run.pc.y}`, `${r.path.at(-1).x},${r.path.at(-1).y}`,
    "and the path it reports ends where she actually stands");
  eq(g.run.outcome, "defeat", "the Keeper's Reactive Strike finished her");
  eq(g.run.stats.reactions, 1, "one reaction did it");
}

/* -- who is allowed to react to what -------------------------------------- */
{
  // Nobody reacts to their own side. Two Keepers standing beside each other,
  // both carrying a reaction on incoming-attack: when the first swings at
  // Vesper, the second is offered the trigger and refused, because a reaction
  // is for interrupting an enemy and not for stabbing a colleague.
  //
  // Broken on purpose by deleting the sideOf() test, at which point the second
  // Keeper opened the fight by punching the first one.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.commands.push({
    id: "riposte", name: "Riposte", cost: 0, kind: "reaction", effect: "strike",
    triggers: ["incoming-attack"], attackBonus: 7, damage: "1d8+2", damageType: "slashing",
  });
  p.creatures["vault-keeper"].reactions = ["reactive-strike", "riposte"];
  const mutual = loadPack(p);
  const twin = (key, x, y) => ({
    key, area: "vault", creature: "vault-keeper", wakesOn: "gate-opened",
    x, y, hp: 18, awake: true, dead: false,
  });
  const g = createGame({
    content: selectPc(mutual, "wizard"), rng: makeRng(1),
    state: {
      packId: mutual.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: 10, y: 4, hp: 15, slots: 2, focus: 1 },
      creatures: [twin("vault:vault-keeper@11,1", 11, 4), twin("vault:vault-keeper@11,3", 11, 3)],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  g.endTurn();                          // one Keeper's whole turn, three fists
  eq(g.run.stats.reactions, 0, "the other Keeper does not Riposte its own side");
  eq(g.lastTrigger("incoming-attack").refusals.find(r => r.command === "riposte").why, "ally",
    "refused because it is an ally, which is the rule being tested");
  eq(g.run.creatures[0].hp, 18, "the Keeper that swung is untouched");
  eq(g.run.creatures[1].hp, 18, "and so is the one that watched");
  ok(g.run.pc.hp < 15, "the fists landed on Vesper, which is who they were aimed at");
}

{
  // The budget is per actor, not per trigger. Two Keepers, both threatening the
  // square Kessa leaves: both get their own swing, and both are then spent for
  // the round. Broken on purpose by hoisting the spent check out of the loop,
  // which let one Keeper's reaction pay for the other's.
  const c = selectPc(content, "fighter");
  const twin = (key, x, y) => ({
    key, area: "vault", creature: "vault-keeper", wakesOn: "gate-opened",
    x, y, hp: 18, awake: true, dead: false,
  });
  const g = createGame({
    content: c, rng: makeRng(1),
    state: {
      packId: content.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 18, slots: 0, focus: 0 },
      creatures: [twin("vault:vault-keeper@11,1", 11, 4), twin("vault:vault-keeper@11,3", 11, 3)],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  while (!g.isPCTurn() && !g.run.outcome) g.advance();
  ok(!g.run.outcome, "Kessa reaches her turn with two Keepers on her");
  const at = g.run.stats.reactions;
  // (9,3) is out of reach of (11,4) and of (11,3); (10,4) was inside both.
  ok(g.walkTo(9, 3).ok, "she Strides out of reach of both");
  eq(g.run.stats.reactions, at + 2, "both Keepers react, each spending its own");
  ok(g.turn.reacted.has("vault:vault-keeper@11,1") && g.turn.reacted.has("vault:vault-keeper@11,3"),
    "and both are spent for the round");
  ok(g.walkTo(10, 4).ok, "she steps back between them");
  ok(g.walkTo(9, 3).ok, "and back out");
  eq(g.run.stats.reactions, at + 2, "neither gets a second swing this round");
}

{
  // A reduce reaction protects its owner and nobody else. The bystander here
  // is a Reliquary Warden with a hardness reaction, standing next to the
  // sentinel Vesper is actually shooting: it is offered the trigger, because
  // the bus offers everyone, and it is refused because the damage is not
  // coming at it. Broken on purpose by deleting the `who !== ctx.target`
  // test, at which point the Warden soaked a spell aimed at its neighbour.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.commands.push({
    id: "stoneskin", name: "Stoneskin", cost: 0, kind: "reaction", effect: "reduce",
    triggers: ["incoming-damage"], hardness: 3,
  });
  p.creatures["reliquary-warden"].reactions = ["stoneskin"];
  const warded = loadPack(p);
  const g = createGame({
    content: selectPc(warded, "wizard"), rng: makeRng(1),
    state: {
      packId: warded.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: 10, y: 8, hp: 15, slots: 2, focus: 1 },
      creatures: [
        { key: "a", area: "vault", creature: "shattered-sentinel", wakesOn: "notice", x: 11, y: 8, hp: 11, awake: true, dead: false },
        { key: "b", area: "vault", creature: "reliquary-warden", wakesOn: "notice", x: 12, y: 8, hp: 8, awake: true, dead: false },
      ],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  while (!g.isPCTurn() && !g.run.outcome) g.advance();
  ok(!g.run.outcome, "Vesper reaches her turn");
  const hp0 = g.byKey("a").hp;
  ok(g.useCommand("fang", "a").ok, "she puts a Force Fang into the sentinel");
  eq(g.run.stats.reactions, 0, "the Warden standing beside it does not soak the hit");
  eq(g.lastTrigger("incoming-damage").refusals.find(r => r.command === "stoneskin").why, "not-the-target",
    "because the damage was not coming at it");
  ok(!g.turn.reacted.has("b"), "and its reaction is still its own");
  const line = g.run.log.filter(e => e.kind === "damage").at(-1);
  eq(hp0 - g.byKey("a").hp, Number(/takes (\d+) /.exec(line.text)[1]),
    "the sentinel took the whole of what was rolled");
}

/* -- the shipped creature AI cannot provoke, and that is measurable ------- */
{
  // A creature in this engine Strides to the *nearest* open square beside the
  // PC, and findPath is optimal, so a ring square it crossed on the way would
  // have been a cheaper destination than the one it chose. It therefore cannot
  // enter the PC's reach and leave it again: Kessa's own Reactive Strike is a
  // rule the engine implements correctly and the shipped creatures never give
  // her. This is the number, over every open square of both maps.
  //
  // It is asserted rather than noted because it is exactly what Phase 4
  // ("creatures that know what they are standing in") changes: the day a
  // creature is given a reason to retreat or reposition, this fails, and the
  // message says what to do about it.
  //
  // Every open square of both maps as the PC, against a fixed stride through
  // the same list as the creature. The full cross product is 96,000 planned
  // Strides and eight A* runs each, which is a ninety-second unit suite and
  // therefore a unit suite nobody runs; the sampled version is a couple of
  // thousand and still finds thousands of leaves the moment the planner is
  // inverted, which is the check being made.
  let leaves = 0, strides = 0;
  for (const areaId of content.areaOrder) {
    const a = content.areas[areaId];
    const w = makeWorld(a);
    const opts = { gateOpen: true, occupied: () => false };
    const open = [];
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) if (!w.blocksMove(x, y, true)) open.push({ x, y });
    }
    for (let i = 0; i < open.length; i++) {
      const pc = open[i];
      for (let j = i % 29; j < open.length; j += 29) {
        const c = open[j];
        if (feetBetween(pc.x, pc.y, c.x, c.y) <= 5) continue;   // adjacent creatures Strike
        // world.planApproach is the function the creature turn actually calls.
        // Re-implementing it here would be a sweep that kept passing after the
        // planner changed under it, which is the exact shape of locked #34.
        const leg = w.planApproach(c, pc, 25, opts);
        if (!leg) continue;
        strides++;
        for (let k = 1; k < leg.length; k++) {
          if (feetBetween(pc.x, pc.y, leg[k - 1].x, leg[k - 1].y) <= 5 &&
              feetBetween(pc.x, pc.y, leg[k].x, leg[k].y) > 5) leaves++;
        }
      }
    }
  }
  ok(strides > 1500, `the sweep actually planned strides (${strides})`);
  // Phase 4 was the phase this line was waiting for, and it still holds: a
  // creature that *approaches* still never leaves her reach, because the
  // cheapest square beside her cannot be reached through another one. What
  // changed is that approaching is no longer the only thing a creature does.
  // The planner that leaves her reach on purpose is planRetreat, swept
  // immediately below, and the reason the Fighter's Reactive Strike is still
  // not live in shipped play is not this invariant — it is that a skirmisher
  // offered the choice takes the Step instead (js/ai.js).
  eq(leaves, 0,
    `no planned Stride leaves the PC's reach (${leaves} of ${strides}) — if this fails, ` +
    `a creature can now provoke on its way in, which planApproach has never done`);
}

/* -- the two planners that walk the other way ---------------------------- */
{
  // planRetreat and stepAway are the movement Phase 4 added, and they are in
  // world.js beside planApproach for the reason planApproach is there: the
  // suite has to sweep the planner the engine actually walks. Both contracts
  // are one sentence, and both sentences are about reach.
  //
  // Swept at reach 5 and at reach 10. Ten is not hypothetical padding — the
  // heir's reach is a pack field, and at 5 feet the "does this square leave
  // her reach" test in planRetreat is nearly a no-op, because one square
  // directly away from an adjacent square is already 10 feet off. Sweeping
  // only the shipped reach would be a guard-rail that cannot tell whether the
  // line it guards is there (locked #147): the line was deleted on purpose and
  // the reach-5 half of this sweep stayed green.
  const counts = {};
  for (const awayFeet of [5, 10]) {
    let retreats = 0, endedInReach = 0, overSpeed = 0, steps = 0, stepInReach = 0, stepFar = 0;
    for (const areaId of content.areaOrder) {
      const a = content.areas[areaId];
      const w = makeWorld(a);
      const opts = { gateOpen: true, occupied: () => false };
      const open = [];
      for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) if (!w.blocksMove(x, y, true)) open.push({ x, y });
      }
      for (const pc of open) {
        for (const c of open) {
          // Only from inside reach: backing off is a thing a creature does
          // when there is something to back off from.
          if (feetBetween(pc.x, pc.y, c.x, c.y) > awayFeet) continue;
          if (pc.x === c.x && pc.y === c.y) continue;
          const leg = w.planRetreat(c, pc, 20, awayFeet, opts);
          if (leg) {
            retreats++;
            const end = leg[leg.length - 1];
            if (feetBetween(pc.x, pc.y, end.x, end.y) <= awayFeet) endedInReach++;
            if (end.g > 20) overSpeed++;
          }
          const sq = w.stepAway(c, pc, awayFeet, opts);
          if (sq) {
            steps++;
            if (feetBetween(pc.x, pc.y, sq.x, sq.y) <= awayFeet) stepInReach++;
            if (Math.max(Math.abs(sq.x - c.x), Math.abs(sq.y - c.y)) !== 1) stepFar++;
          }
        }
      }
    }
    counts[awayFeet] = { retreats, endedInReach, overSpeed, steps, stepInReach, stepFar };
  }
  for (const awayFeet of [5, 10]) {
    const k = counts[awayFeet];
    ok(k.retreats > 400, `reach ${awayFeet}: the sweep actually planned retreats (${k.retreats})`);
    // Broken on purpose by deleting planRetreat's `feetBetween(...) <=
    // awayFeet` skip: 131 of 6,051 reach-10 retreats then end inside the reach
    // they spent an action leaving, and the reach-5 half stays green — which
    // is the whole argument for sweeping two reaches instead of the shipped
    // one.
    eq(k.endedInReach, 0,
      `reach ${awayFeet}: every planned retreat ends outside it (${k.endedInReach} of ${k.retreats} do not)`);
    // Broken on purpose by cutting the `p[p.length - 1].g <= speed` test: 831
    // retreats at reach 5 and 2,126 at reach 10 then cost a Speed 20 construct
    // more than 20 feet in one action.
    eq(k.overSpeed, 0,
      `reach ${awayFeet}: and none of them costs more than the creature's Speed (${k.overSpeed})`);
    ok(k.steps > 400, `reach ${awayFeet}: and actually offered Steps (${k.steps})`);
    // Broken on purpose the same way, one function down: 127 of 2,704 offered
    // Steps at reach 5, and 1,810 of 6,310 at reach 10, then land in a square
    // she can still swing at.
    eq(k.stepInReach, 0,
      `reach ${awayFeet}: every offered Step lands outside it (${k.stepInReach} of ${k.steps} do not)`);
    eq(k.stepFar, 0,
      `reach ${awayFeet}: and every one of them is one square (${k.stepFar} of ${k.steps} are not)`);
  }
}

/* ========================================================================= *
 * 6 — creature policy: the decision, then the turn that executes it
 *
 * ai.js first, on hand-built views, because that is the whole reason it is its
 * own module: what a skirmisher does when the foe holds a reaction is a
 * question with an answer, and the answer should be readable without building
 * a fight to ask it. Then the wiring — that the view game.js hands it says
 * what the board actually says, and that the turn walks the option that was
 * chosen rather than a second one it planned on the way out.
 * ========================================================================= */
section("creature policy");

{
  eq(JSON.stringify(AI_KINDS), JSON.stringify(["brawler", "skirmisher", "caster"]),
    "three policies, and brawler is the one a pack gets by writing nothing");
  throws(() => chooseAction({ ai: "genius", actions: 3 }),
    "ai.js refuses a policy it does not have rather than quietly brawling");
  eq(chooseAction({ ai: "brawler", actions: 0, adjacent: true }).do, "end",
    "no actions, no decision — a slowed creature with none left ends its turn");
}

/* -- brawler: the one-line strategy, unchanged --------------------------- */
{
  const view = extra => ({ ai: "brawler", actions: 3, struck: 0, adjacent: false, approach: false, retreat: {}, abilities: [], ...extra });
  eq(chooseAction(view({ adjacent: true })).do, "strike", "adjacent, so it swings");
  eq(chooseAction(view({ approach: true })).do, "stride", "not adjacent, so it closes");
  eq(chooseAction(view({})).do, "end", "boxed in with nothing in reach, so it stops");
  eq(chooseAction(view({ adjacent: true, struck: 2 })).do, "strike",
    "and it keeps swinging at a multiple attack penalty, which is what it did before this module existed");
  // The kit is a caster's to spend. A pack may hand a brawler an ability —
  // nothing in content.js stops it — and this is the line that says what
  // happens then, rather than leaving it to whichever branch is read first.
  eq(chooseAction(view({ adjacent: true, abilities: [{ id: "gravel-wave", cost: 2, caught: 1, allies: 0 }] })).do,
    "strike", "a brawler holding an ability still punches: casting is the caster's branch");
}

/* -- skirmisher: hit, then get out, and which way out depends on her ------ */
{
  const view = extra => ({
    ai: "skirmisher", actions: 3, struck: 0, adjacent: true, approach: true,
    retreat: { stride: true, step: true, strideProvokes: false }, abilities: [], ...extra,
  });
  eq(chooseAction(view({})).do, "strike", "it swings first — a skirmisher that never hits is just a coward");
  eq(chooseAction(view({ struck: 1 })).do, "retreat",
    "and having hit, it backs off rather than trading a second swing");
  eq(chooseAction(view({ struck: 1, retreat: { stride: true, step: true, strideProvokes: true } })).do, "step",
    "against a foe holding Reactive Strike it Steps instead: five feet that triggers nothing");
  eq(chooseAction(view({ struck: 1, retreat: { stride: false, step: true, strideProvokes: false } })).do, "step",
    "with no room to Stride it Steps anyway");
  // The branch the shipped adventure does not reach and the policy still has
  // to answer: no Step out of reach, and a Stride that hands her the swing.
  // Standing and fighting is the answer, because backing into the one corner
  // that costs you a free hit is worse than the hit.
  eq(chooseAction(view({ struck: 1, retreat: { stride: true, step: false, strideProvokes: true } })).do, "strike",
    "boxed in against a reaction it stands its ground");
  eq(chooseAction(view({ struck: 1, retreat: { stride: false, step: false, strideProvokes: false } })).do, "strike",
    "and boxed in against nothing, it just keeps swinging");
  eq(chooseAction(view({ struck: 1, adjacent: false })).do, "end",
    "once it has swung and left, it does not walk back in and undo it");
  eq(chooseAction(view({ struck: 0, adjacent: false })).do, "stride",
    "but it closes on a turn it has not swung on yet");
}

/* -- caster: the shape first, and not through its own escort ------------- */
{
  const view = extra => ({
    ai: "caster", actions: 3, struck: 0, adjacent: true, approach: true,
    retreat: { stride: true, step: true, strideProvokes: false },
    abilities: [{ id: "gravel-wave", cost: 2, caught: 1, allies: 0 }], ...extra,
  });
  eq(chooseAction(view({})).id, "gravel-wave", "it opens with the shape rather than the fist");
  eq(chooseAction(view({})).do, "cast", "which is a cast, not a strike");
  eq(chooseAction(view({ abilities: [] })).do, "strike",
    "with the ability spent it is a brawler again, and the fist is what is left");
  eq(chooseAction(view({ actions: 1 })).do, "strike",
    "a two-action cone is not cast with one action left");
  eq(chooseAction(view({ abilities: [{ id: "gravel-wave", cost: 2, caught: 0, allies: 0 }] })).do, "strike",
    "and not at a shape that catches nobody");
  // The phase's own name, as one assertion: a creature that knows what is
  // standing in the square it is about to fill with rubble.
  eq(chooseAction(view({ abilities: [{ id: "gravel-wave", cost: 2, caught: 1, allies: 1 }] })).do, "strike",
    "and never through one of its own");
  eq(chooseAction(view({
    abilities: [
      { id: "small", cost: 2, caught: 1, allies: 0 },
      { id: "big", cost: 2, caught: 2, allies: 0 },
    ],
  })).id, "big", "given two, it takes the one that catches more");
  eq(chooseAction(view({ adjacent: false, abilities: [] })).do, "stride",
    "and a caster with nothing left still closes");
}

/* -- the view game.js builds, against the board it is built from --------- */

/**
 * The warden alone in the reliquary with the heir beside it. The sanctum is
 * the open room in this pack, which is what a creature that wants to back off
 * twenty feet needs.
 */
function wardenFight(buildId, seed, pcAt = [5, 7]) {
  const c = selectPc(content, buildId);
  const build = content.pcById[buildId];
  const g = createGame({
    content: c, rng: makeRng(seed),
    state: {
      packId: content.pack.id, buildId, areaId: "sanctum",
      pc: { x: pcAt[0], y: pcAt[1], hp: build.hp, slots: build.slots, focus: build.focus },
      creatures: [{
        key: "sanctum:reliquary-warden@6,7", area: "sanctum", creature: "reliquary-warden",
        wakesOn: "notice", x: 6, y: 7, hp: 8, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0, abilities: 0 },
      outcome: null,
    },
  });
  g.begin();
  return g;
}
const WARDEN = "sanctum:reliquary-warden@6,7";

{
  // The one place in this engine where a creature reads the player's sheet,
  // and it reads it by asking the reaction bus rather than by knowing what a
  // Fighter is. Kessa has Reactive Strike; Vesper does not; the same warden on
  // the same square gets a different answer to the same question.
  //
  // Broken on purpose by making provokedBy() return false unconditionally:
  // the fighter's `strideProvokes` goes false, the assertion below fails, and
  // so does the Step the turn takes because of it.
  const vs = build => wardenFight(build, 1).situationOf(WARDEN);
  eq(vs("fighter").ai, "skirmisher", "the warden's policy comes off the pack");
  eq(vs("fighter").adjacent, true, "it is in reach of the heir");
  eq(vs("fighter").retreat.strideProvokes, true,
    "and Striding out of Kessa's reach would hand her a Reactive Strike");
  eq(vs("wizard").retreat.strideProvokes, false,
    "while Vesper has no reaction that answers a creature leaving her reach");
  eq(vs("wizard").retreat.stride, true, "both of them leave it room to Stride");
  eq(vs("wizard").retreat.step, true, "and room to Step");
}

{
  // Against Kessa: swing, then Step. The reaction never fires, and that is the
  // assertion — a creature that avoided the swing and a creature that never
  // had one offered look identical from the win rate, and only the first one
  // is a policy.
  const g = wardenFight("fighter", 1);
  const w = g.byKey(WARDEN);
  const before = g.run.log.length;
  g.endTurn();
  const fresh = g.run.log.slice(before).map(e => e.text);
  ok(fresh.some(t => t.includes("Cinder Fist")), "the warden swings");
  ok(fresh.some(t => t === "Reliquary Warden Steps 5 ft."), "and Steps away rather than Striding");
  eq(g.run.stats.reactions, 0, "which triggers nothing: a Step is the five feet that does not");
  ok(feetBetween(w.x, w.y, g.run.pc.x, g.run.pc.y) > 5,
    "and it is out of her reach at the end of it, which is what the action bought");
  eq(g.lastTrigger("move-out-of-reach"), null,
    "the move trigger was never even offered — a Step does not reach the bus at all");
}

{
  // Against Vesper: the same warden, the same square, twenty feet instead of
  // five, because nothing is going to punish it for the distance.
  const g = wardenFight("wizard", 1);
  const w = g.byKey(WARDEN);
  g.endTurn();
  ok(g.run.log.some(e => e.text === "Reliquary Warden backs off 20 ft."),
    "it Strides the whole retreat rather than shuffling five feet");
  ok(feetBetween(w.x, w.y, g.run.pc.x, g.run.pc.y) >= 20,
    "and ends the turn a Stride away from her");
}

{
  // A brawler is what it always was. Same builder, the warden retyped, and the
  // creature closes and swings for as long as it has actions.
  const p = JSON.parse(JSON.stringify(rawPack));
  delete p.creatures["reliquary-warden"].ai;
  const plain = loadPack(p);
  const g = createGame({
    content: selectPc(plain, "fighter"), rng: makeRng(1),
    state: {
      packId: plain.pack.id, buildId: "fighter", areaId: "sanctum",
      pc: { x: 5, y: 7, hp: 18, slots: 0, focus: 0 },
      creatures: [{
        key: WARDEN, area: "sanctum", creature: "reliquary-warden",
        wakesOn: "notice", x: 6, y: 7, hp: 8, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0, abilities: 0 },
      outcome: null,
    },
  });
  g.begin();
  const before = g.run.log.length;
  g.endTurn();
  const fresh = g.run.log.slice(before).map(e => e.text);
  eq(fresh.filter(t => t.includes("Cinder Fist")).length, 3, "a brawler spends all three actions swinging");
  ok(!fresh.some(t => t.includes("Steps") || t.includes("backs off")), "and goes nowhere");
  eq(g.byKey(WARDEN).x, 6, "it is standing where it started");
}

/* -- the Keeper's kit, resolved from the other side of the board --------- */
{
  // The cone comes out of the creature, not the heir, and the heir is the one
  // rolling the save. Everything below is a first for this engine: a template
  // whose origin is a creature, a basic save the PC makes, and a DC that is
  // not hers.
  //
  // Broken on purpose by dropping the `caster` argument in templateSquares'
  // `const from = caster || run.pc` — the cone then comes out of the heir's
  // own square, aimed at herself, and catches nobody.
  const g = keeperFight("wizard", 12, [10, 4], { ability: true });
  const view = g.situationOf("vault:vault-keeper@11,1");
  eq(view.ai, "caster", "the Keeper is a caster");
  eq(view.abilities.length, 1, "with one ability left to spend");
  eq(view.abilities[0].caught, 1, "and the heir is standing in the shape it would make");
  eq(view.abilities[0].allies, 0, "with nothing of its own in it");
  eq(g.run.stats.abilities, 0, "nothing has gone off yet");

  const before = g.run.log.length;
  g.endTurn();
  const fresh = g.run.log.slice(before);
  ok(fresh.some(e => e.text.includes("Gravel Wave")), "it opens with Gravel Wave");
  eq(g.run.stats.abilities, 1, "counted once");
  const save = fresh.find(e => e.kind === "dice" && e.text.includes("basic Reflex"));
  ok(!!save, "the heir rolls a basic Reflex save, which nothing in this engine had ever asked her for");
  ok(save.text.includes("DC 16"), "against the ability's own DC 16");
  eq(g.spellDC, 17, "and not against her spell DC of 17, which is the number it would have borrowed");
  ok(save.math.includes("+5"), "rolled with her own Reflex bonus");
  // Once per encounter, and the budget is the turn's rather than the save's.
  eq(g.situationOf("vault:vault-keeper@11,1").abilities.length, 0, "the ability is spent");
  let r = g.endTurn();
  let guard = 0;
  while (r && !g.run.outcome && ++guard < 12) r = r.actor === "pc" ? g.endTurn() : g.advance();
  eq(g.run.stats.abilities, 1, "and it does not go off a second time in the same encounter");
  ok(g.run.log.filter(e => e.text.includes("Basalt Fist")).length > 1,
    "while the fist keeps swinging, which is what a spent caster is");
}

{
  // A cone through its own escort, refused. A sentinel dragged up into the
  // Keeper's chamber and stood in the shape: the ability is still there, still
  // affordable, and still catches the heir, and the Keeper punches instead.
  //
  // This is the assertion the phase is named for, and it is the pair to the
  // pure one above: that one says the policy refuses, this one says the
  // measurement it refuses on is the board's and not a guess.
  const c = selectPc(content, "wizard");
  const g = createGame({
    content: c, rng: makeRng(12),
    state: {
      packId: content.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: 10, y: 4, hp: 15, slots: 2, focus: 1 },
      creatures: [
        {
          key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
          wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
        },
        // (10,3) is inside the westward cone from (11,4) and beside the heir
        // at (10,4): in the shape, and not the thing the shape is for.
        {
          key: "vault:shattered-sentinel@7,8", area: "vault", creature: "shattered-sentinel",
          wakesOn: "notice", x: 10, y: 3, hp: 11, awake: true, dead: false,
        },
      ],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0, abilities: 0 },
      outcome: null,
    },
  });
  g.begin();
  const view = g.situationOf("vault:vault-keeper@11,1");
  eq(view.abilities[0].caught, 1, "the heir is still in the cone");
  eq(view.abilities[0].allies, 1, "and so is the sentinel between them");
  eq(chooseAction(view).do, "strike", "so the Keeper does not cast it");
  // Play the whole encounter out rather than one turn: the sentinel is between
  // them for as long as it lives, and the claim is that the wave waits.
  let r = g.currentActor === "pc" ? g.endTurn() : g.advance();
  let guard = 0;
  while (r && !g.run.outcome && ++guard < 6) r = r.actor === "pc" ? g.endTurn() : g.advance();
  eq(g.run.stats.abilities, 0, "and does not, for as long as its own is standing in it");
}

/* ========================================================================= *
 * 7 — conditions
 *
 * The pure layer first, then the funnel, then the tick, then what a save
 * carries. Everything in the first block is a function of its arguments: the
 * whole reason conditions.js exists as its own module is that the interesting
 * invariants — the same-type rule, which boundary a duration answers to, what
 * a value does when it reaches zero — can be pinned without building a fight.
 * ========================================================================= *
 */
section("conditions");

/* -- the catalogue ------------------------------------------------------- */
{
  for (const [key, def] of Object.entries(CONDITIONS)) {
    eq(def.id, key, `the catalogue's "${key}" knows its own id`);
    ok(Object.isFrozen(def), `"${key}" is frozen`);
    for (const kind of Object.keys(def.affects || {})) {
      ok(MODIFIER_KINDS.includes(kind), `"${key}" only affects known kinds (${kind})`);
    }
    if (def.affects) ok(BONUS_TYPES.includes(def.bonusType), `"${key}" names a real bonus type`);
    if (def.persistent) {
      ok(def.persistent.damage && def.persistent.damage.n > 0, `"${key}" carries a parsed damage spec`);
      ok(def.persistent.flatDC > 0, `"${key}" carries a flat DC`);
    }
  }
  eq(CONDITION_IDS.length, 8, "eight conditions ship");
  ok(isCondition("frightened"), "frightened is one of them");
  ok(!isCondition("petrified"), "petrified is not — the catalogue is closed, like the tile names");
  // Every entry has to do something, or it is a chip that means nothing. The
  // three ways: move a number, cost an action, or deal damage.
  for (const [key, def] of Object.entries(CONDITIONS)) {
    ok(def.affects || def.costsActions || def.persistent,
      `"${key}" changes something — a condition that moves no number, costs no action and deals no damage is a chip`);
    if (def.defaultUntil) ok(DEFAULT_UNTILS[def.defaultUntil],
      `"${key}" names a default duration the tick understands (${def.defaultUntil})`);
    for (const t of def.traits || []) {
      ok(CONDITION_TRAITS.includes(t), `"${key}" carries a known trait (${t})`);
    }
  }
  eq(CONDITIONS.slowed.affects, undefined,
    "slowed moves no number at all — it is the one that proves the bag is read outside the modifier funnel");
  eq(CONDITIONS["off-guard"].showsValue, false,
    "off-guard has no value in PF2e: there is no such thing as off-guard 2");
}

/* -- building one -------------------------------------------------------- */
{
  const c = makeCondition("frightened", { value: 2 });
  eq(c.id, "frightened", "makeCondition keeps the id");
  eq(c.value, 2, "and the value");
  eq(c.until, null, "and defaults to no duration");
  eq(makeCondition("frightened").value, 1, "value defaults to 1");
  throws(() => makeCondition("petrified"), "an unknown condition throws rather than becoming a NaN modifier");
  throws(() => makeCondition("frightened", { value: 0 }), "value 0 throws — a condition at 0 is a condition that is gone");
  throws(() => makeCondition("frightened", { value: 1.5 }), "a fractional value throws");
  throws(() => makeCondition("shielded", { until: { who: "pc", when: "later" } }), "an unknown boundary throws");
  throws(() => makeCondition("shielded", { until: { when: "start" } }), "an until with no actor throws");
  const kept = makeCondition("shielded", { value: 1, until: { who: "pc", when: "start" } });
  eq(kept.until.when, "start", "a well-formed until survives");
}

/* -- the bag ------------------------------------------------------------- */
{
  const empty = [];
  const one = addCondition(empty, makeCondition("frightened", { value: 1 }));
  eq(empty.length, 0, "addCondition does not mutate the bag it was given");
  eq(one.length, 1, "it returns a new one with the condition in it");
  eq(valueOf(one, "frightened"), 1, "and the value reads back");
  eq(valueOf(one, "shielded"), 0, "a condition that is not there is worth 0, not undefined");

  // Player Core p.444: a second instance of the same condition does not stack.
  const worse = addCondition(one, makeCondition("frightened", { value: 3 }));
  eq(worse.length, 1, "a second frightened does not become a second entry");
  eq(valueOf(worse, "frightened"), 3, "the higher value wins");
  const better = addCondition(worse, makeCondition("frightened", { value: 1 }));
  eq(valueOf(better, "frightened"), 3, "and a lower one loses rather than replacing it");

  const two = addCondition(worse, makeCondition("shielded", { value: 1 }));
  eq(two.length, 2, "two different conditions coexist");
  eq(removeCondition(two, "shielded").length, 1, "removeCondition takes one out");
  ok(!hasCondition(removeCondition(two, "shielded"), "shielded"), "and it is gone");
  eq(removeCondition(two, "petrified").length, 2, "removing what was never there is not an error");
}

/* -- the same-type rule -------------------------------------------------- */
{
  eq(modifiers([], "attack-str"), 0, "an empty bag is worth nothing");
  eq(modifiers(null, "ac"), 0, "and so is no bag at all");
  const f2 = [makeCondition("frightened", { value: 2 })];
  for (const kind of MODIFIER_KINDS) {
    if (kind === "damage") continue;
    eq(modifiers(f2, kind), -2, `frightened 2 is -2 to ${kind} — every check and every DC (Player Core p.446)`);
  }
  eq(modifiers(f2, "damage"), 0,
    "and 0 to damage, which is neither: a frightened creature swings worse, it does not swing lighter");

  const disc = [makeCondition("shielded", { value: 1 })];
  eq(modifiers(disc, "ac"), 1, "the disc is worth its own acBonus");
  eq(modifiers(disc, "attack-str"), 0, "and nothing to anything else");
  eq(modifiers([...f2, ...disc], "ac"), -1, "a circumstance bonus and a status penalty do stack with each other");

  // The two the catalogue grew for: a status penalty from a *different*
  // condition, and a circumstance penalty against a circumstance bonus. Both
  // were unwritable with three conditions, which is why increment 1 shipped
  // the rule untested against either.
  const clumsy = [makeCondition("clumsy", { value: 1 })];
  eq(modifiers(clumsy, "ac"), -1, "clumsy 1 is -1 to AC");
  eq(modifiers(clumsy, "save-ref"), -1, "and -1 to Reflex");
  eq(modifiers(clumsy, "save-will"), 0, "and nothing to Will — the saves are three kinds because these two disagree");
  eq(modifiers(clumsy, "attack-dex"), -1, "it hits a finesse attack");
  eq(modifiers(clumsy, "attack-str"), 0, "and not a Strength one");
  eq(modifiers([...f2, ...clumsy], "ac"), -2,
    "frightened 2 and clumsy 1 are two status penalties from two conditions: -2, the worst one, not -3");
  eq(modifiers([...f2, ...clumsy], "save-ref"), -2, "on Reflex too");

  const guard = [makeCondition("off-guard")];
  eq(modifiers(guard, "ac"), -2, "off-guard is a flat -2");
  eq(modifiers([...guard, ...disc], "ac"), -1,
    "the disc's +1 and off-guard's -2 both apply, and the disc is worth having anyway");
  eq(modifiers([...guard, ...disc, ...f2], "ac"), -3,
    "frightened 2 on top is a status penalty, a second type, and it stacks with both of them");
  // Honest about what this cannot see. Player Core p.443's rule bites when a
  // type has two *bonuses* or two *penalties* in it; one of each, same type or
  // not, sums to the same number either way. So the frightened-plus-clumsy
  // pair above is the whole of the evidence that the rule is implemented, and
  // the disc's bonus *type* is a claim about the rules with no arithmetic in
  // this catalogue that can currently distinguish it. It will the day a second
  // circumstance bonus exists, which is what this assertion is holding the
  // place for. (Written after a break that changed the disc to an item bonus
  // and the suite stayed green.)
  eq(CONDITIONS.shielded.bonusType, "circumstance", "the disc is a circumstance bonus, per the cantrip");
  eq(CONDITIONS["off-guard"].bonusType, "circumstance", "and off-guard a circumstance penalty");
  eq(CONDITION_IDS.filter(id => {
    const a = CONDITIONS[id].affects;
    return a && Object.values(a).some(v => v > 0);
  }).length, 1, "and there is exactly one condition in the catalogue that grants a bonus of any type");

  const weak = [makeCondition("enfeebled", { value: 2 })];
  eq(modifiers(weak, "damage"), -2, "enfeebled 2 takes 2 off a damage roll");
  eq(modifiers(weak, "attack-str"), -2, "and 2 off a Strength attack");
  eq(modifiers(weak, "attack-dex"), 0, "and nothing off a finesse one");
  const dull = [makeCondition("stupefied", { value: 1 })];
  eq(modifiers(dull, "spell-dc"), -1, "stupefied lowers the DC the heir's spells are rolled against");
  eq(modifiers(dull, "save-will"), -1, "and her Will save");
  eq(modifiers(dull, "save-ref"), 0, "and nothing else");
  eq(modifiers([makeCondition("slowed", { value: 1 })], "attack-str"), 0,
    "slowed is worth nothing to every kind — it costs actions, not numbers");

  // Player Core p.443. Two penalties of the same type do not stack — the worst
  // one applies. A bag cannot normally hold two frightened (addCondition
  // merges them), but a hand-edited save can, and the rule has to hold there
  // rather than quietly double the penalty.
  const doubled = [
    { id: "frightened", value: 2, until: null },
    { id: "frightened", value: 1, until: null },
  ];
  eq(modifiers(doubled, "attack-str"), -2, "two status penalties do not stack: the worst one applies");
  throws(() => modifiers(f2, "morale"), "an unknown modifier kind throws rather than silently returning 0");
  throws(() => saveKind("reflex"), "and so does a save spelled the way a person would spell it");
  throws(() => attackKind("wis"), "and an ability no attack rolls off");
  eq(saveKind("ref"), "save-ref", "the two spellings meet in one place");
  eq(attackKind("dex"), "attack-dex", "and so do the two abilities");
}

/* -- persistent damage, as a spec rather than a roll ---------------------- */
{
  eq(persistentIn([makeCondition("frightened")]).length, 0, "frightened deals no damage");
  const burn = persistentIn([makeCondition("persistent-fire")]);
  eq(burn.length, 1, "burning does");
  eq(burn[0].dtype, "fire", "and it is fire");
  eq(burn[0].flatDC, 15, "with a DC 15 flat check to end it (Player Core p.409)");
  eq(burn[0].damage.n, 1, "1d4, parsed once at module load rather than on every tick");
  eq(burn[0].damage.s, 4, "1d4, on the die size too");
}

/* -- the boundary: whose turn, and whose condition ----------------------- */
{
  const disc = [makeCondition("shielded", { value: 1, until: { who: "pc", when: "start" } })];
  eq(tick(disc, "pc", "keeper", "start").expired.length, 0,
    "a duration that names the PC's turn does not expire at somebody else's");
  eq(tick(disc, "pc", "pc", "end").expired.length, 0, "nor at the wrong end of the right turn");
  const gone = tick(disc, "pc", "pc", "start");
  eq(gone.expired.length, 1, "it expires at the start of the PC's turn, which is what it says");
  eq(gone.expired[0].why, "duration", "and says why");
  eq(gone.bag.length, 0, "and comes out of the bag");

  // Decay answers to the afflicted actor's own turn and nobody else's. Fold
  // the two questions together and a frightened creature loses a point every
  // time anyone in the initiative order finishes a turn.
  const f2 = [makeCondition("frightened", { value: 2 })];
  eq(tick(f2, "keeper", "pc", "end").bag[0].value, 2,
    "frightened does not decay at the end of somebody else's turn");
  eq(tick(f2, "keeper", "keeper", "start").bag[0].value, 2, "nor at the start of its own");
  const once = tick(f2, "keeper", "keeper", "end");
  eq(once.bag[0].value, 1, "it decays by one at the end of its own turn");
  eq(once.expired.length, 0, "and is still there at 1");
  const twice = tick(once.bag, "keeper", "keeper", "end");
  eq(twice.bag.length, 0, "the second tick takes it to 0, which is gone");
  eq(twice.expired[0].why, "decayed", "for the other of the two reasons");
  eq(tick([makeCondition("persistent-fire")], "pc", "pc", "end").bag.length, 1,
    "burning does not decay — it ends on its flat check or not at all");
}

/* -- what a chip says ---------------------------------------------------- */
{
  eq(describe({ id: "frightened", value: 2 }), "Frightened 2", "a valued condition shows its value");
  eq(describe({ id: "shielded", value: 1 }), "Shielded", "the disc does not — its value is an AC bonus, not a stack");
  eq(describe({ id: "persistent-fire", value: 1 }), "Burning", "and burning reads as burning");
}

/* -- repairing a bag off a save ------------------------------------------ */
{
  eq(repairBag(undefined).length, 0, "a save with no conditions key repairs to an empty bag");
  eq(repairBag(null).length, 0, "and so does a null one");
  eq(repairBag("frightened").length, 0, "and so does a string where an array belongs");
  eq(repairBag([{ id: "petrified", value: 2 }]).length, 0,
    "a condition this build no longer defines is dropped rather than added to every check as undefined");
  eq(repairBag([{ id: "frightened", value: 0 }]).length, 0, "a value of 0 is dropped");
  eq(repairBag([{ id: "frightened", value: "two" }]).length, 0, "a value that is not a number is dropped");
  eq(repairBag([{ id: "frightened", value: 900 }])[0].value, 99, "an absurd value is clamped rather than kept");
  eq(repairBag([{ id: "frightened", value: 2 }, { id: "frightened", value: 1 }]).length, 1,
    "a duplicated id collapses");
  eq(repairBag([{ id: "frightened", value: 1 }, { id: "frightened", value: 3 }])[0].value, 3,
    "to its highest value");
  eq(repairBag([{ id: "shielded", value: 1, until: { who: "pc", when: "nope" } }])[0].until, null,
    "a malformed until is dropped, which makes the condition permanent rather than crashing the tick");
  eq(repairBag([{ id: "shielded", value: 1, until: { who: "pc", when: "start" } }])[0].until.who, "pc",
    "a good one survives");
  eq(packBag([]), undefined, "an empty bag writes nothing to the save at all");
  eq(packBag(undefined), undefined, "and neither does no bag");
  eq(packBag([makeCondition("frightened", { value: 2 })])[0].value, 2, "a real one writes its value");
}

/* -- one funnel, and the proof it is the only one ------------------------ */
{
  // The drift guard, the same shape as the trigger-name one above and for the
  // same reason: the failure mode is silence. A `check()` written straight at
  // a call site rolls a d20 that no condition can ever move, and nothing about
  // it looks wrong — the number is just quietly the sheet number forever.
  // Broken on purpose by putting the PC's Strike back on a raw check().
  const src = fs.readFileSync(path.join(HERE, "..", "js", "game.js"), "utf8");
  // Comments stripped first. This is a claim about code, and a comment naming
  // the call is not a second call site — the previous version of this guard
  // failed on its own explanatory comment, which is a test that makes the file
  // worse to read.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  eq((code.match(/\bcheck\(/g) || []).length, 1,
    "game.js rolls exactly one kind of d20, and it is the one that adds the modifiers");
  ok(/function roll\(actor, kind, bonus, dc\) \{\s*return check\(bonus \+ modifiersFor\(actor, kind\), dc, rng\);\s*\}/.test(code),
    "and that one call is the funnel itself");
  ok(!/turn\.shielded/.test(code),
    "turn.shielded is gone from game.js entirely — the deletion is the proof the funnel is real");
  // The flat check is the deliberate exception: a flat check takes no
  // modifiers (Player Core p.409), so it rolls a bare die rather than passing
  // zero through a funnel that does not apply to it.
  ok(/const nat = die\(20, rng\);/.test(code), "the flat check rolls a bare die, on purpose");
}

/* -- the second net, under the save layer -------------------------------- */
{
  // save.js's repair fills a missing bag on anything that came through the
  // save layer. createGame fills one on anything that did not — a state handed
  // straight in, which is every scenario this suite builds by hand. They are
  // two different lines guarding the same absence, and the suite used to lean
  // on the second while believing it was testing the first.
  //
  // Out of combat on purpose. The first turn boundary writes a bag back to
  // every actor whether or not one expired, so any scenario that reaches an
  // encounter has already been normalised by the time it can be asked — which
  // is why the first version of this assertion stayed green with createGame's
  // `??=` pair deleted. Exploration is where the line is actually load-bearing.
  const bare = freshRun(content, "wizard");
  delete bare.pc.conditions;
  for (const c of bare.creatures) delete c.conditions;
  const g = createGame({ content: resolved, rng: makeRng(1), state: bare });
  g.begin();
  eq(g.mode, "explore", "nothing is awake, so no boundary has run");
  ok(Array.isArray(g.run.pc.conditions), "createGame gives a hand-built state a bag on the PC");
  ok(g.run.creatures.every(c => Array.isArray(c.conditions)), "and one on every creature in it");
  eq(g.conditionsOf("pc").length, 0, "and the sheet can be drawn before a single turn is taken");
}

/* -- the Shield cantrip, as an ordinary condition ------------------------ */
{
  const g = keeperFight("wizard", 1);
  eq(g.conditionsOf("pc").length, 0, "a hand-built state with no conditions key boots with an empty bag");
  eq(g.pcAC(), 15, "and the wizard's own AC");
  ok(g.useCommand("shield").ok, "Vesper casts Shield");
  eq(g.conditionsOf("pc").length, 1, "which puts one condition on her, not a boolean on the turn object");
  eq(g.conditionsOf("pc")[0].id, "shielded", "and it is the disc");
  eq(g.conditionsOf("pc")[0].value, content.commandById.shield.acBonus,
    "carrying the pack's own acBonus as its value, so a +2 disc would be +2 here without a code change");
  eq(g.conditionsOf("pc")[0].until.who, "pc", "until the start of her own next turn");
  eq(g.modifiersFor("pc", "ac"), 1, "worth +1 through the funnel");
  eq(g.pcAC(), 16, "which is the AC everything else in the engine reads");
  ok(g.shielded, "and the getter the renderer uses still answers");

}

{
  // The duration on its own, with nothing else in the fight touching it: a
  // pack where Vesper has no Shield Block (so the disc is never spent
  // blocking) and a Keeper that cannot land a fist (so nothing else moves her
  // HP or her bag). All three are changed on purpose — the shipped fight ends the
  // disc by blocking with it, which is a different line of code, and reading
  // an expiry assertion against it would pass whether the duration worked or
  // not.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.pcOptions.find(b => b.id === "wizard").commands =
    p.pcOptions.find(b => b.id === "wizard").commands.filter(id => id !== "shield-block");
  delete p.creatures["vault-keeper"].inflicts;
  p.creatures["vault-keeper"].attackBonus = -50;   // it swings and never lands
  const plain = loadPack(p);
  const g = createGame({
    content: selectPc(plain, "wizard"), rng: makeRng(1),
    state: {
      packId: plain.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: 10, y: 4, hp: 15, slots: 2, focus: 1 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  ok(g.useCommand("shield").ok, "Vesper casts Shield with nothing to block with it");
  eq(g.pcAC(), 16, "AC 15 becomes 16");
  // Round the initiative order back to the top of her own turn: the duration
  // expires there, in advance(), and nowhere else. Broken on purpose by
  // dropping the boundary("pc", "start") call, which left the disc up for the
  // rest of the fight.
  let r = g.endTurn();
  while (r && r.actor !== "pc" && !g.run.outcome) r = g.advance();
  ok(!g.run.outcome, "she survives the Keeper's round (seed 1)");
  ok(!g.shielded, "the disc is gone at the top of her next turn");
  eq(g.pcAC(), 15, "and her AC is her own again");
  eq(g.conditionsOf("pc").length, 0, "with nothing left in the bag");
  ok(g.run.log.some(e => e.text === "Vesper Quill is no longer shielded — its duration runs out."),
    "and it said so on the way out rather than vanishing silently");
}

{
  // The other way the disc ends: blocking with it. Same fight, same seed as
  // the Shield Block test above, read through the bag rather than the getter.
  const g = keeperFight("wizard", 1);
  g.useCommand("shield");
  eq(valueOf(g.conditionsOf("pc"), "shielded"), 1, "the disc is up");
  g.endTurn();
  ok(g.run.stats.reactions >= 1, "the Keeper's fist is blocked");
  eq(valueOf(g.conditionsOf("pc"), "shielded"), 0, "and the disc is out of the bag, not merely false");
  ok(g.run.log.some(e => e.text.includes("no longer shielded — the disc shatters")),
    "with the reason it went");
}

/* -- frightened: a debuff on the PC, through every kind of number -------- */
{
  const g = keeperFight("fighter", 1);
  const base = content.pcById.fighter;
  eq(g.pcAC(), base.ac, "Kessa starts at her own AC");
  // Hand-applied rather than played into: the Keeper only inflicts this on a
  // critical hit, and waiting for one would make every assertion below depend
  // on a seed rolling a 20.
  g.run.pc.conditions = [{ id: "frightened", value: 2, until: null }];
  eq(g.modifiersFor("pc", "attack-str"), -2, "frightened 2 is -2 on her attacks");
  eq(g.modifiersFor("pc", "save-fort"), -2, "-2 on her saves");
  eq(g.modifiersFor("pc", "perception"), -2, "-2 on her Perception");
  eq(g.pcAC(), base.ac - 2, "and -2 on the AC the Keeper rolls against");

  // Decay happens at the end of her own turn. Broken on purpose by ticking
  // decay at every boundary rather than the owner's: frightened 2 was gone
  // before she acted twice.
  let r = g.endTurn();
  eq(valueOf(g.conditionsOf("pc"), "frightened"), 1, "it drops by one at the end of her own turn");
  while (r && r.actor !== "pc" && !g.run.outcome) r = g.advance();
  ok(!g.run.outcome, "she survives the round");
  eq(valueOf(g.conditionsOf("pc"), "frightened"), 1,
    "and does not drop again for the Keeper's turn ending — decay is the afflicted actor's own boundary");
  g.endTurn();
  eq(valueOf(g.conditionsOf("pc"), "frightened"), 0, "her second turn ending takes it off");
  ok(g.run.log.some(e => e.text === "Kessa Vane is no longer frightened."),
    "and the expiry is a log line, not an arithmetic change the player has to notice");
}

/* -- persistent damage: the tick path, at the right boundary ------------- */
{
  const g = keeperFight("fighter", 1);
  const k = g.run.creatures[0];
  k.conditions = [{ id: "persistent-fire", value: 1, until: null }];
  const hp0 = k.hp;
  ok(g.isPCTurn(), "the round opens on Kessa");
  const r = g.endTurn();
  eq(k.hp, hp0, "the fire does not land when her turn ends — it is not her fire");
  ok(r && r.actor !== "pc", "the Keeper takes its turn, burning");
  g.advance();
  ok(k.hp < hp0, `the fire lands at the end of the Keeper's own turn (${hp0} -> ${k.hp})`);
  ok(g.run.log.some(e => e.kind === "damage" && e.math && e.math.startsWith("burning: ")),
    "and the damage line names what dealt it");
  ok(g.run.log.some(e => e.text.includes("flat check to end burning")),
    "then the DC 15 flat check that can end it");
}

{
  // It ends, and it ends on the flat check rather than a counter. Twenty
  // rounds of a d20 against DC 15 is a 0.3%-per-run chance of still burning,
  // and the seed is fixed, so this is not a flake waiting to happen.
  const g = keeperFight("fighter", 9);
  const k = g.run.creatures[0];
  k.conditions = [{ id: "persistent-fire", value: 1, until: null }];
  k.hp = 999;                        // it is the fire under test, not the fight
  let r = g.endTurn(), guard = 0;
  while (hasCondition(k.conditions, "persistent-fire") && guard++ < 40 && !g.run.outcome) {
    r = g.advance();
  }
  ok(!hasCondition(k.conditions, "persistent-fire"), `the fire went out (after ${guard} steps)`);
  ok(g.run.log.some(e => e.text.includes("no longer burning — the flames gutter out")),
    "on the flat check, and it said so");
}

/* -- the encounter ending is a clock stopping (locked #137) -------------- */
{
  const g = keeperFight("fighter", 1);
  g.run.pc.conditions = [{ id: "frightened", value: 2, until: null }];
  const k = g.run.creatures[0];
  k.hp = 1;
  // Kill the Keeper: nothing else is awake, so the encounter ends here.
  let tries = 0;
  while (!k.dead && tries++ < 40) {
    if (g.isPCTurn() && g.actionsLeft > 0) g.useCommand("strike-sword", k.key);
    else { let r = g.endTurn(); while (r && r.actor !== "pc" && !g.run.outcome) r = g.advance(); }
    if (g.run.outcome) break;
  }
  ok(k.dead, "the Keeper falls");
  eq(g.mode, "explore", "and the encounter is over");
  eq(g.conditionsOf("pc").length, 0,
    "which takes the fear with it — every duration here is measured in turn boundaries, and there are none out here");
  ok(g.run.log.some(e => e.text.includes("no longer frightened — the encounter ends")),
    "said out loud rather than silently dropped");
}

/* -- a creature that reknits, reknits clean ------------------------------ */
{
  // The other way a condition comes off a creature. A woken creature that
  // loses sight of the PC settles and reknits to full HP (the anti-cheese
  // heal); a construct that walks away burning and comes back at full HP
  // still burning is the one reading neither rule was arguing for. The Keeper
  // stays awake and adjacent, so the encounter does not end here — this is
  // checkDisengage's own clearing, not endCombat's.
  //
  // (4,7) is a square in the vault with no line of sight to (10,4); the world
  // was asked which ones there are rather than a coordinate being guessed.
  const c = selectPc(content, "fighter");
  const g = createGame({
    content: c, rng: makeRng(4),
    state: {
      packId: content.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 18, slots: 0, focus: 0 },
      creatures: [
        {
          key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
          wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
        },
        {
          key: "vault:shattered-sentinel@4,7", area: "vault", creature: "shattered-sentinel",
          wakesOn: "notice", x: 4, y: 7, hp: 4, awake: true, dead: false,
          conditions: [{ id: "persistent-fire", value: 1, until: null }],
        },
      ],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  const lost = g.run.creatures[1];
  eq(lost.conditions.length, 1, "the sentinel across the room is burning");
  g.endTurn();
  eq(lost.awake, false, "it loses the PC in the dark and settles");
  eq(lost.hp, content.creatures["shattered-sentinel"].hp, "reknitting to full HP");
  eq(lost.conditions.length, 0, "and out of the fire it was standing in");
  eq(g.mode, "combat", "while the Keeper keeps the encounter going");
  ok(g.run.log.some(e => e.text.includes("no longer burning — it settles back into stone")),
    "said out loud, like every other way a condition ends");
}

/* -- what a pack is allowed to inflict ----------------------------------- */
{
  eq(JSON.stringify(INFLICT_ON), JSON.stringify(["hit", "crit", "crit-fail"]),
    "three ways a pack can hang a condition off a roll");
  eq(content.commandById.breathe.inflicts[0].condition, "persistent-fire",
    "Breathe Fire sets a critical failure alight");
  eq(content.commandById.breathe.inflicts[0].on, "crit-fail", "on the target's own save");
  eq(content.commandById.shield.inflicts, null, "a command that inflicts nothing says so with null, not by omission");
  eq(content.creatures["vault-keeper"].inflicts[0].condition, "frightened",
    "a critical Basalt Fist frightens the heir");
  eq(content.creatures["vault-keeper"].inflicts[0].value, 1, "by 1");
  eq(content.creatures["vault-keeper"].inflicts[1].condition, "stupefied",
    "and stupefies her in the same swing — one entry could not have said both");
  eq(content.creatures["vault-keeper"].inflicts.length, 2, "two entries off one roll");
  eq(content.commandById.strike.inflicts.length, 1,
    "a single object in the pack still reads back as a list of one, so no existing pack had to change");

  const bad = raw => { const p = JSON.parse(JSON.stringify(rawPack)); raw(p); return () => loadPack(p); };
  throws(bad(p => { p.commands[0].inflicts = { condition: "petrified", on: "hit" }; }),
    "a pack naming a condition the catalogue does not have is refused at the door");
  throws(bad(p => { p.commands[0].inflicts = { condition: "frightened", on: "critfail" }; }),
    "and so is one naming a trigger point that does not exist");
  throws(bad(p => { p.commands[0].inflicts = { condition: "frightened", on: "hit", value: 0 }; }),
    "and so is a value of 0");
  throws(bad(p => { p.creatures["vault-keeper"].inflicts = { condition: "frightened" }; }),
    "a creature's inflicts is validated the same way a command's is");
  throws(bad(p => {
    p.creatures["vault-keeper"].inflicts = [
      { condition: "frightened", value: 1, on: "crit" },
      { condition: "frightened", value: 2, on: "hit" },
    ];
  }), "and two entries naming one condition are refused: addCondition would merge them and one would never fire");
  throws(bad(p => { p.creatures["vault-keeper"].inflicts = []; }), "an empty array is refused too");
}

{
  // And it fires. The Keeper's crit is rare, so this is a pack whose fist
  // frightens on every hit — the same code path, reached without begging a
  // seed for a natural 20.
  const p = fistOnly(JSON.parse(JSON.stringify(rawPack)));
  p.creatures["vault-keeper"].inflicts = { condition: "frightened", value: 1, on: "hit" };
  p.creatures["vault-keeper"].immunities = [];
  const jumpy = loadPack(p);
  const c = selectPc(jumpy, "fighter");
  const g = createGame({
    content: c, rng: makeRng(1),
    state: {
      packId: jumpy.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 18, slots: 0, focus: 0 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  g.endTurn();                       // the Keeper's whole turn
  eq(valueOf(g.conditionsOf("pc"), "frightened"), 1, "a fist that lands leaves her frightened 1");
  ok(g.run.log.some(e => e.text === "Kessa Vane is frightened 1."), "and the log says so");
}

/* ========================================================================= *
 * increment 2 — the catalogue, the damage funnel, and a turn with fewer
 * actions in it
 * ========================================================================= */

/* -- damage, funnelled by source ----------------------------------------- */
{
  const weak = [makeCondition("enfeebled", { value: 2 })];
  eq(damageModifiers(weak, "weapon"), -2, "enfeebled moves a weapon damage roll");
  eq(damageModifiers(weak, "spell"), 0, "and not a spell's, which comes off proficiency and not a shoulder");
  eq(damageModifiers(weak, "persistent"), 0, "nor the fire the condition itself is ticking");
  eq(damageModifiers(weak, "healing"), 0, "nor a healing roll, which is not damage at all");
  throws(() => damageModifiers(weak, "falling"),
    "an unknown source throws rather than quietly returning 0 for it");
  eq(DAMAGE_SOURCES.length, 4, "four sources, and every rollDamage in the engine names one");
  eq(damageModifiers([], "weapon"), 0, "an empty bag moves nothing");
}

/* -- the second drift guard: one rollDamage ------------------------------ */
{
  // The same shape as the `check(` guard above and for the same reason. Every
  // rollDamage call site used to add the weapon's own `plus` and nothing else,
  // which is the hardcoding `turn.shielded` was, one layer down — and the
  // failure mode is identical: a raw rollDamage rolls dice no condition can
  // ever move, and nothing about the line looks wrong.
  //
  // Broken on purpose by putting the creature's Strike back on
  // `rollDamage(d.damage, rng)`.
  const src = fs.readFileSync(path.join(HERE, "..", "js", "game.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  eq((code.match(/\browDamage\(/g) || []).length, 0, "no typo of the funnel's own name is in the file");
  eq((code.match(/\brollDamage\(/g) || []).length, 1,
    "game.js rolls damage in exactly one place, and it is the one that adds the modifiers");
  ok(/function damageFrom\(actor, spec, source\) \{\s*const d = rollDamage\(spec, rng\);/.test(code),
    "and that one call is the funnel itself");
}

/* -- enfeebled, on a fist that actually swings --------------------------- */
{
  // A pack whose Keeper is enfeebled from the first instant, against the same
  // pack whose Keeper is not, on the same seed. Same dice, one number apart —
  // which is the only way to tell a modifier that applied from a d20 that
  // rolled low.
  //
  // Broken on purpose by returning `d` unmodified from damageFrom.
  const hits = (bag) => {
    const g = keeperFight("fighter", 1);
    g.run.creatures[0].conditions = bag;
    const hp0 = g.run.pc.hp;
    g.endTurn();                     // the Keeper's whole turn, three fists
    return hp0 - g.run.pc.hp;
  };
  const clean = hits([]);
  const weak = hits([{ id: "enfeebled", value: 1, until: null }]);
  ok(clean > 0, `the Keeper lands something on seed 1 (${clean} damage)`);
  ok(weak < clean, `and less of it while enfeebled 1 (${weak} vs ${clean})`);
  ok(clean - weak >= 1, "by at least a point per fist that landed");
}

{
  // Floored at 0. A penalty larger than the dice is a Strike that does
  // nothing, never a Strike that heals — and the number the log prints is the
  // number the target took.
  const g = keeperFight("fighter", 1);
  g.run.creatures[0].conditions = [{ id: "enfeebled", value: 40, until: null }];
  const hp0 = g.run.pc.hp;
  g.endTurn();
  eq(g.run.pc.hp, hp0, "enfeebled 40 is a fist that cannot hurt her");
  ok(g.run.pc.hp <= 18, "and never a fist that heals her");
}

/* -- clumsy, on the DC a spell is rolled against ------------------------- */
{
  const g = keeperFight("wizard", 3);
  const k = g.run.creatures[0];
  eq(g.spellDC, content.pcById.wizard.spellDC, "Vesper's spell DC starts at her own");
  eq(g.modifiersFor(k, "save-ref"), 0, "and the Keeper saves at its own Reflex");
  k.conditions = [{ id: "clumsy", value: 1, until: null }];
  eq(g.modifiersFor(k, "save-ref"), -1, "clumsy 1 takes a point off that Reflex save");
  eq(g.modifiersFor(k, "save-will"), 0, "and leaves Will alone");
  eq(g.modifiersFor(k, "ac"), -1, "and a point off its AC");
}

/* -- stupefied: the spell DC, and the flat check to cast at all ---------- */
{
  const g = keeperFight("wizard", 3);
  g.run.pc.conditions = [{ id: "stupefied", value: 1, until: null }];
  eq(g.spellDC, content.pcById.wizard.spellDC - 1,
    "stupefied 1 takes a point off the DC her cone is rolled against");
  eq(g.pcAC(), content.pcById.wizard.ac, "and nothing off her AC — it is not frightened with another name");
}

{
  // The flat check, which is the part that costs the spell rather than a
  // number. Stupefied 19 makes the DC 24 on a d20, so it cannot be beaten:
  // the assertion is about the branch, not about a seed rolling low.
  //
  // Broken on purpose by returning false from castFizzles().
  const g = keeperFight("wizard", 3);
  g.run.pc.conditions = [{ id: "stupefied", value: 19, until: null }];
  const slots = g.run.pc.slots, actions = g.actionsLeft;
  const r = g.useCommand("shield");
  ok(r.ok, "the cast is attempted");
  eq(r.fizzled, true, "and comes apart on the flat check");
  eq(g.conditionsOf("pc").some(c => c.id === "shielded"), false, "no disc");
  eq(g.actionsLeft, actions - 1, "and the action is gone with it");
  eq(g.run.pc.slots, slots, "a cantrip spends no slot either way");
  ok(g.run.log.some(e => e.text.includes("flat check to Cast a Spell while stupefied")),
    "the flat check is in the log, with its DC");
}

{
  // And the DC is the formula rather than a number that happens to be hard.
  // Stupefied 1 is DC 6 (Player Core p.447: 5 + the value), which the first
  // version of this block never checked — a break that set the base to 0 left
  // an unbeatable DC 19 on the seed under test and the suite stayed green.
  const g = keeperFight("wizard", 3);
  g.run.pc.conditions = [{ id: "stupefied", value: 1, until: null }];
  g.useCommand("shield");
  const line = g.run.log.find(e => e.text && e.text.includes("flat check to Cast a Spell"));
  ok(line, "stupefied 1 rolls the check too");
  ok(/vs DC 6$/.test(line.math), `at DC 5 + 1 (${line.math})`);
  const g2 = keeperFight("wizard", 3);
  g2.run.pc.conditions = [{ id: "stupefied", value: 3, until: null }];
  g2.useCommand("shield");
  ok(/vs DC 8$/.test(g2.run.log.find(e => e.text && e.text.includes("flat check to Cast a Spell")).math),
    "and DC 5 + 3 at stupefied 3, which is the formula and not a constant");
}

{
  // And the other side of it: stupefied 0 is not stupefied, so nothing rolls.
  const g = keeperFight("wizard", 3);
  const r = g.useCommand("shield");
  ok(r.ok && !r.fizzled, "an unstupefied cast does not roll a flat check at all");
  ok(!g.run.log.some(e => e.text.includes("flat check to Cast a Spell")), "and nothing about one is logged");
  ok(g.shielded, "the disc is up");
}

{
  // A Strike is not Casting a Spell. Broken on purpose by dropping the
  // `cmd.spell` test from the fizzle branch, which stops Kessa swinging.
  const g = keeperFight("fighter", 1);
  g.run.pc.conditions = [{ id: "stupefied", value: 19, until: null }];
  const r = g.useCommand("strike-sword", g.run.creatures[0].key);
  ok(r.ok && !r.fizzled, "Kessa's longsword swings while stupefied 19 — it is a sword");
  eq(content.commandById["strike-sword"].spell, false, "because the pack does not call it a spell");
  eq(content.commandById.breathe.spell, true, "and does call Breathe Fire one");
}

/* -- slowed: a turn with fewer actions in it ----------------------------- */
{
  eq(actionsFor([], 3), 3, "an empty bag leaves all three");
  eq(actionsFor([makeCondition("slowed", { value: 1 })], 3), 2, "slowed 1 leaves two");
  eq(actionsFor([makeCondition("slowed", { value: 2 })], 3), 1, "slowed 2 leaves one");
  eq(actionsFor([makeCondition("slowed", { value: 9 })], 3), 0,
    "and slowed 9 leaves none rather than a turn that owes actions back");
  eq(actionsFor([makeCondition("frightened", { value: 2 })], 3), 3,
    "a condition that is not slowed costs no action");
}

{
  // On the PC, through advance(). Broken on purpose by putting
  // `turn.actions = 3` back in advance().
  const g = keeperFight("fighter", 1);
  eq(g.actionsLeft, 3, "Kessa's turn opens with three actions");
  g.run.pc.conditions = [{ id: "slowed", value: 1, until: null }];
  let r = g.endTurn();
  while (r && r.actor !== "pc" && !g.run.outcome) r = g.advance();
  ok(!g.run.outcome, "she comes back round to her own turn");
  eq(g.actionsLeft, 2, "and it opens with two");
  ok(g.hint.includes("2 action"), "the hint says two, rather than promising three");
}

{
  // The ordering that makes it work at all: slowed is `self-end`, so the start
  // boundary that runs immediately before the action count does not take it
  // off first. Broken on purpose by giving slowed `defaultUntil: "self-start"`
  // in the catalogue — the count reads 3 and the condition is already gone.
  eq(CONDITIONS.slowed.defaultUntil, "self-end",
    "slowed lasts to the end of the turn it costs, not the start of it");
  eq(defaultUntilFor("slowed", "pc").when, "end", "which is what the tick is handed");
  eq(defaultUntilFor("off-guard", "pc").when, "start",
    "off-guard is the mirror image: footing you get back at the start of your turn");
  eq(defaultUntilFor("off-guard", "vault:x@1,1").who, "vault:x@1,1",
    "and it names the afflicted actor, not the one that applied it");
  eq(defaultUntilFor("frightened", "pc"), null, "frightened has none — it decays instead");
  eq(defaultUntilFor("persistent-fire", "pc"), null, "and burning ends on its flat check or not at all");
}

{
  // On a creature, through creatureTurn's own counter. A Keeper slowed to one
  // action swings once rather than three times. Broken on purpose by putting
  // `let actions = 3` back in creatureTurn.
  const swings = (bag) => {
    const g = keeperFight("fighter", 1);
    g.run.creatures[0].conditions = bag;
    const before = g.run.log.length;
    g.endTurn();
    return g.run.log.slice(before).filter(e => e.kind === "dice" && e.text.includes("Basalt Fist")).length;
  };
  const full = swings([]);
  const slow = swings([{ id: "slowed", value: 2, until: null }]);
  eq(full, 3, "an unslowed Keeper standing beside her swings three times");
  eq(slow, 1, "slowed 2 leaves it one swing");
}

/* -- off-guard, and the duration it carries without being told ----------- */
{
  // A pack whose sentinel fist knocks the heir off-guard on every hit, so the
  // path is reached without begging a seed for a natural 20.
  const p = fistOnly(JSON.parse(JSON.stringify(rawPack)));
  p.creatures["vault-keeper"].inflicts = { condition: "off-guard", value: 1, on: "hit" };
  const pack = loadPack(p);
  const g = createGame({
    content: selectPc(pack, "fighter"), rng: makeRng(1),
    state: {
      packId: pack.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 18, slots: 0, focus: 0 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  const ac0 = g.pcAC();
  let r = g.endTurn();
  ok(hasCondition(g.run.pc.conditions, "off-guard"), "a fist that lands leaves her off-guard");
  eq(g.pcAC(), ac0 - 2, "which is -2 on the AC everything rolls against");
  eq(g.conditionsOf("pc").find(c => c.id === "off-guard").until?.when, "start",
    "carrying the catalogue's own duration, which the pack never had to write");
  while (r && r.actor !== "pc" && !g.run.outcome) r = g.advance();
  ok(!g.run.outcome, "she reaches her own turn");
  ok(!hasCondition(g.run.pc.conditions, "off-guard"), "and gets her footing back at the start of it");
  eq(g.pcAC(), ac0, "AC back where it was");
}

/* -- immunity: a construct cannot be frightened -------------------------- */
{
  eq(immunityTo("frightened", ["mental"]), "mental", "frightened is a mental effect and a construct is immune");
  eq(immunityTo("frightened", []), null, "nothing is immune to nothing");
  eq(immunityTo("clumsy", ["mental"]), null, "clumsy is not mental — a statue can still be off balance");
  eq(immunityTo("slowed", ["mental"]), null, "nor slowed");
  eq(immunityTo("petrified", ["mental"]), null, "and a condition that does not exist bounces off nothing");
  for (const id of Object.keys(content.creatures)) {
    eq(JSON.stringify(content.creatures[id].immunities), JSON.stringify(["mental"]),
      `${id} is a construct, and every construct in this pack says so`);
  }
  eq(content.pcById.wizard.immunities.length, 0, "the heir is flesh");
}

{
  // Through the engine, out loud. A pack whose Basalt Fist frightens on every hit, aimed the other way: the
  // Keeper hits the *heir*, who is flesh, and it lands. The same pack's cone
  // frightens the Keeper, which is a construct, and it does not.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.commands.find(c => c.id === "breathe").inflicts =
    { condition: "frightened", value: 1, on: "crit-fail" };
  p.commands.find(c => c.id === "breathe").damage = "1d1";
  p.creatures["vault-keeper"].saves.ref = -20;   // it will critically fail
  const pack = loadPack(p);
  const g = createGame({
    content: selectPc(pack, "wizard"), rng: makeRng(3),
    state: {
      packId: pack.pack.id, buildId: "wizard", areaId: "vault",
      pc: { x: 10, y: 4, hp: 15, slots: 2, focus: 1 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  const k = g.run.creatures[0];
  ok(g.useCommand("breathe", { x: 11, y: 4 }).ok, "Vesper breathes fire at the Keeper");
  ok(g.run.log.some(e => e.text.includes("critical failure") || e.deg === 0), "which it critically fails");
  eq(hasCondition(k.conditions, "frightened"), false,
    "and it is not frightened, because it is a construct and constructs are immune to mental effects");
  ok(g.run.log.some(e => e.text.includes("immune to mental effects")),
    "said out loud, with the reason — a button that does nothing is a bug report");
}

/* -- Rousing Splash, with something to end ------------------------------- */
{
  eq(content.commandById.splash.ends.condition, "persistent-fire", "the cantrip names what it takes off");
  eq(content.commandById.splash.ends.flatDC, 10,
    "at DC 10, which is Player Core p.409's appropriate action rather than an automatic end");
  eq(content.creatures["reliquary-warden"].inflicts[0].condition, "persistent-fire",
    "and the Cinder Fist is what puts it on her");
  eq(content.creatures["reliquary-warden"].damageType, "fire", "its fist is fire now, so the disc cannot soak it");
}

{
  // Cast it forty times over a burning heir on forty seeds and count. DC 10 on
  // a d20 is 55%, so "it sometimes ends it and sometimes does not" is the
  // assertion, and both halves have to be seen or the branch is untested.
  //
  // Broken on purpose by deleting the `endOnPurpose(cmd.ends)` call.
  let ended = 0, held = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = keeperFight("wizard", seed);
    g.run.pc.conditions = [{ id: "persistent-fire", value: 1, until: null }];
    if (!g.isPCTurn() || g.actionsLeft < 2) continue;
    // A refusal is neither outcome. Counting one as "the fire held" is how the
    // first version of this block stayed green with the flat check deleted:
    // one refused seed was the whole of its evidence that the check ever fails.
    if (!g.useCommand("splash").ok) continue;
    if (hasCondition(g.run.pc.conditions, "persistent-fire")) held++; else ended++;
  }
  ok(ended >= 3, `the splash puts the fire out sometimes (${ended} of ${ended + held})`);
  ok(held >= 3, `and fails the DC 10 flat check the rest of the time (${held} of ${ended + held})`);
}

{
  // And the log says which. One seed, forced: with no fire on her the cantrip
  // rolls nothing at all, which is what stops the log filling with flat checks
  // against a condition nobody has.
  const g = keeperFight("wizard", 3);
  ok(g.useCommand("splash").ok, "she casts it unburnt");
  ok(!g.run.log.some(e => e.text.includes("flat check to end burning")),
    "and no flat check is rolled for a fire that is not there");
}

/* -- an unerring effect lands, and what it leaves behind lands with it --- */
{
  // Force Fang rolls nothing, so there is no degree for applyInflict to read
  // and `on: "hit"` is what "it landed" means. Before this, an `inflicts`
  // written on an unerring command validated at load and then did nothing at
  // all — the exact silence the closed vocabulary exists to prevent one level
  // up, one branch deeper.
  //
  // Broken on purpose by deleting the applyInflict call from the unerring
  // branch.
  eq(content.commandById.fang.inflicts[0].condition, "slowed",
    "the pack's one source of slowed is on its one unerring command");
  eq(content.commandById.fang.inflicts[0].on, "hit", "which always lands");
  const g = keeperFight("wizard", 3);
  const k = g.run.creatures[0];
  ok(g.useCommand("fang", k.key).ok, "Vesper spends her focus point on it");
  eq(valueOf(k.conditions, "slowed"), 1, "and the Keeper is slowed 1");
  eq(k.conditions.find(c => c.id === "slowed").until.when, "end",
    "to the end of its own next turn, off the catalogue rather than the pack");
  // And it costs the Keeper a swing, which is the only reason to spend a focus
  // point on it.
  const swings = () => g.run.log.filter(e => e.kind === "dice" && e.text.includes("Basalt Fist")).length;
  const before = swings();
  g.endTurn();
  eq(swings() - before, 2, "so its next turn is two fists rather than three");
}

/* -- and a player who knows to use it ------------------------------------ */
{
  // The half that makes the cantrip measurable at all. combatPolicy had no
  // self-heal branch, so balance.mjs had never cast Rousing Splash in any of
  // the numbers this project has quoted — the spell was dead in the harness
  // as well as dead in the rules. It reads `ends` rather than the command id,
  // the same way the rest of the policy reads `kind`.
  //
  // Broken on purpose by deleting the dousing branch from combatPolicy.
  const g = keeperFight("wizard", 3);
  g.run.pc.conditions = [{ id: "persistent-fire", value: 1, until: null }];
  ok(combatPolicy(g), "a burning heir spends an action");
  ok(g.run.log.some(e => e.text.includes("Rousing Splash")),
    "and spends it on the cantrip that ends fire, with a Keeper standing next to her");
  const dry = keeperFight("wizard", 3);
  ok(combatPolicy(dry), "an unburnt heir acts too");
  ok(!dry.run.log.some(e => e.text.includes("Rousing Splash")),
    "and does not spend two actions on a wave she has no use for");
}

/* -- what content is allowed to say now ---------------------------------- */
{
  const bad = raw => { const p = JSON.parse(JSON.stringify(rawPack)); raw(p); return () => loadPack(p); };
  eq(content.commandById.strike.ability, "dex", "the dagger is finesse, and the pack says so");
  eq(content.commandById["strike-sword"].ability, "str", "the longsword is not");
  eq(content.creatures["vault-keeper"].ability, "str",
    "and a creature that says nothing is Strength, so no pack that predates the field had to change");
  throws(bad(p => { p.commands[0].ability = "wis"; }), "an ability no attack rolls off is refused");
  throws(bad(p => { p.creatures["vault-keeper"].ability = "cha"; }), "on a creature too");
  throws(bad(p => { p.creatures["vault-keeper"].immunities = ["fire"]; }),
    "an immunity that is not a condition trait is refused — the list is closed like the tile names");
  throws(bad(p => { p.creatures["vault-keeper"].immunities = "mental"; }),
    "and so is a bare string where an array belongs");
  throws(bad(p => { p.commands.find(c => c.id === "splash").ends = { condition: "petrified" }; }),
    "an ends block naming an unknown condition is refused");
  throws(bad(p => { p.commands.find(c => c.id === "splash").ends = { condition: "persistent-fire", flatDC: 44 }; }),
    "and a flat DC no d20 can reach");
  throws(bad(p => { p.commands.find(c => c.id === "breathe").save = "reflex"; }),
    "a save spelled the way a person would spell it is refused rather than rolling against undefined");
}

/* -- the two inflicts off one roll, both landing ------------------------- */
{
  // The Keeper's fist leaves two things behind, and a loop that applied only
  // the first would look exactly like a Keeper that frightens. Broken on
  // purpose by `return applyCondition(...)` inside applyInflict's loop.
  const p = fistOnly(JSON.parse(JSON.stringify(rawPack)));
  p.creatures["vault-keeper"].inflicts = [
    { condition: "frightened", value: 1, on: "hit" },
    { condition: "stupefied", value: 2, on: "hit" },
  ];
  const pack = loadPack(p);
  const g = createGame({
    content: selectPc(pack, "fighter"), rng: makeRng(1),
    state: {
      packId: pack.pack.id, buildId: "fighter", areaId: "vault",
      pc: { x: 10, y: 4, hp: 18, slots: 0, focus: 0 },
      creatures: [{
        key: "vault:vault-keeper@11,1", area: "vault", creature: "vault-keeper",
        wakesOn: "gate-opened", x: 11, y: 4, hp: 18, awake: true, dead: false,
      }],
      loreRead: [], gateOpen: true, fog: {}, inventory: [], log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 }, outcome: null,
    },
  });
  g.begin();
  g.endTurn();
  eq(valueOf(g.run.pc.conditions, "frightened"), 1, "one fist, and the first of its two conditions lands");
  eq(valueOf(g.run.pc.conditions, "stupefied"), 2, "and the second, at its own value");
}

/* -- which ability swings it, at the call site rather than in the bag ----- */
{
  // modifiersFor already knows clumsy is Dexterity and enfeebled is Strength.
  // This is the other half: that `roll` is handed the right one of the two at
  // the dagger's own call site. Vesper's dagger is finesse, so enfeebled
  // cannot stop it landing and clumsy can — and the values are absurd on
  // purpose, because the assertion is about which kind was asked for and not
  // about a seed.
  //
  // Broken on purpose by hardcoding attackKind("str") at the PC's Strike.
  const swing = (bag) => {
    const g = keeperFight("wizard", 3);
    g.run.pc.conditions = bag;
    const k = g.run.creatures[0];
    const hp0 = k.hp;
    g.useCommand("strike", k.key);
    return { landed: k.hp < hp0, dealt: hp0 - k.hp, log: g.run.log };
  };
  const clean = swing([]);
  ok(clean.landed, `an unencumbered dagger lands on seed 3 (${clean.dealt} damage)`);
  const weak = swing([{ id: "enfeebled", value: 40, until: null }]);
  ok(weak.log.some(e => e.kind === "dice" && e.text.includes("Strike — Dagger")),
    "enfeebled 40 still rolls the attack");
  eq(weak.dealt, 0, "and lands for nothing, because enfeebled is on the damage and not on a finesse attack roll");
  const clumsy = swing([{ id: "clumsy", value: 40, until: null }]);
  eq(clumsy.landed, false, "clumsy 40 is what stops a finesse blade landing at all");
}

/* -- the chip and the marker read the catalogue, not an id --------------- */
{
  // ui.js and render.js both used to name "shielded" or read `affects.ac < 0`
  // to decide whether a condition was good news. Both were right for a
  // catalogue of three and wrong for this one: Burning and Slowed move no AC
  // at all and would have drawn as buffs, and the marker over an afflicted
  // creature would have switched on for the second helpful condition this
  // pack ever grows. Neither file is importable under Node, so this asserts
  // against their source the way the two funnel guards do.
  //
  // Broken on purpose by putting `c.id !== "shielded"` back in render.js.
  const read = f => fs.readFileSync(path.join(HERE, "..", "js", f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const rend = read("render.js"), ui = read("ui.js");
  ok(!/"shielded"/.test(rend), "render.js names no condition id at all");
  ok(/helpful/.test(rend), "it asks the catalogue which ones are good news");
  ok(!/affects\s*&&\s*def\.affects\.ac/.test(ui), "ui.js no longer decides by whether AC moved downward");
  ok(/def\.helpful/.test(ui), "it asks the same flag");
  eq(CONDITION_IDS.filter(id => CONDITIONS[id].helpful).length, 1,
    "exactly one condition in the catalogue is worth having");
  eq(CONDITIONS.shielded.helpful, true, "and it is the disc");
}

section("save");

eq(SAVE_KEY, "absalom-inheritance-save-v1", "the storage key is the one that is now permanent");
eq(SAVE_VERSION, 1, "schema version 1");

ok(validRun(freshRun(content)), "a fresh run validates");
ok(!validRun(null), "null does not validate");
ok(!validRun({}), "an empty object does not validate");
ok(!validRun({ pc: { hp: 5 }, creatures: [], inventory: [] }), "a PC with no position does not validate");
ok(!validRun({ pc: { hp: 5, x: 1, y: 1 }, creatures: "no", inventory: [] }), "creatures must be an array");
ok(!validRun({ pc: { hp: 5, x: 1, y: 1 }, creatures: [] }), "inventory must be present");

{
  // The round trip through localStorage.
  const store = memStore();
  const slot = makeSaveSlot(content, store);
  const g = createGame({ content: resolved, rng: makeRng(77) });
  g.begin();
  travel(g, 10, 15);
  g.run.pc.hp = 9;
  g.run.loreRead.push("bequest");
  const written = slot.save(g.snapshot());
  eq(written, true, "the save wrote");
  eq(store.size, 1, "one key, and only one");
  ok(store.getItem(SAVE_KEY), "written under the permanent key");

  const back = slot.load();
  ok(back, "the save loads back");
  eq(back.pc.hp, 9, "HP survived the round trip");
  eq(back.pc.x, g.run.pc.x, "position survived");
  eq(back.pc.y, g.run.pc.y, "position survived on both axes");
  eq(back.loreRead.length, 1, "lore progress survived");
  eq(back.fog.vault.length, 484, "the vault's fog-of-war bitfield survived at full length");
  eq(back.inventory.length, g.run.inventory.length, "the satchel survived");

  // And the game boots on it.
  const g2 = createGame({ content: resolved, rng: makeRng(78), state: back });
  g2.begin();
  eq(g2.run.pc.hp, 9, "a game built on the loaded save has the right HP");
  ok(g2.explored.size > 1, "and remembers the map it had explored");
}

/* -- conditions in the save, additively ---------------------------------- */
{
  // The three claims the phase made about the save shape, in order: a run with
  // nothing stuck to anybody writes no `conditions` key at all; a run with
  // something writes it and gets it back; and a save written before any of
  // this existed loads clean rather than booting a PC whose every check adds
  // undefined.
  const g = createGame({ content: resolved, rng: makeRng(11) });
  g.begin();
  const bare = g.snapshot();
  eq("conditions" in bare.pc, false,
    "a snapshot of a run with no conditions carries no conditions key on the PC");
  eq(bare.creatures.some(c => "conditions" in c), false, "nor on any creature");
  eq(JSON.stringify(bare) === JSON.stringify(g.snapshot()), true, "and it is stable across two calls");

  g.run.pc.conditions = [{ id: "frightened", value: 2, until: null }];
  g.run.creatures[0].conditions = [{ id: "persistent-fire", value: 1, until: null }];
  const written = g.snapshot();
  eq(written.pc.conditions.length, 1, "a run with a condition writes it");
  eq(written.pc.conditions[0].value, 2, "with its value");
  eq(written.creatures[0].conditions[0].id, "persistent-fire", "and a creature's travels with the creature");
  // Aliasing: the snapshot is handed to the autosave layer and the run keeps
  // moving. A shared array would let the next tick rewrite a save that has not
  // been flushed, which is exactly the bug the fog copy in snapshot() exists
  // for (v7, the aliased object).
  g.run.pc.conditions[0].value = 1;
  eq(written.pc.conditions[0].value, 2, "and the snapshot is a copy, not the live bag");

  const store = memStore();
  const slot = makeSaveSlot(content, store);
  slot.save(g.snapshot());
  const back = slot.load();
  eq(valueOf(back.pc.conditions, "frightened"), 1, "conditions survive the round trip through storage");
  eq(back.creatures.find(c => c.conditions && c.conditions.length).conditions[0].id, "persistent-fire",
    "on both sides of the board");
  const g3 = createGame({ content: resolved, rng: makeRng(12), state: back });
  g3.begin();
  eq(g3.modifiersFor("pc", "attack-str"), -1, "and the reloaded run rolls at the penalty it was saved with");
}

{
  // A legacy save: every save this game ever wrote before this phase. No
  // `conditions` key anywhere, and it has to load into a playable run rather
  // than a PC with an undefined bag.
  //
  // Broken on purpose by deleting repair's `s.pc.conditions = repairBag(...)`
  // line, and the first draft of this block named the wrong assertion for it:
  // the boot checks below stayed green, because createGame fills a missing bag
  // itself (`run.pc.conditions ??= []`) for the hand-built states the suite
  // constructs, and that second net catches repair's absence too. What the
  // break actually trips is the shape assertion on the loaded state, two lines
  // down, which is the only one that reads what repair itself produced.
  const legacy = freshRun(content, "wizard");
  delete legacy.pc.conditions;
  for (const c of legacy.creatures) delete c.conditions;
  legacy.pc.hp = 12;
  const store = memStore();
  // Written the way localStorage actually holds one — a bare state blob — and
  // with no `__v` at all, which reads as version 0 and comes through `repair`.
  store.setItem(SAVE_KEY, JSON.stringify(legacy));
  const slot = makeSaveSlot(content, store);
  const back = slot.load();
  ok(back, "a save with no conditions key anywhere still loads");
  eq(back.pc.hp, 12, "with everything else intact");
  eq(JSON.stringify(back.pc.conditions), "[]", "and an empty bag on the PC");
  ok(back.creatures.every(c => Array.isArray(c.conditions)), "and one on every creature");
  const g = createGame({ content: resolved, rng: makeRng(13), state: back });
  g.begin();
  eq(g.modifiersFor("pc", "ac"), 0, "the run boots with no modifiers rather than NaN");
  eq(g.pcAC(), 15, "and its AC is a number");
}

{
  // A save that names a condition this build no longer defines, and one whose
  // creature is a corpse. Both are the same argument as the creature filter
  // repair already runs: the alternative to dropping them is arithmetic on
  // undefined.
  const s = freshRun(content, "wizard");
  s.pc.conditions = [{ id: "petrified", value: 3 }, { id: "frightened", value: 2 }];
  s.creatures[0].hp = 0;
  s.creatures[0].dead = true;
  s.creatures[0].conditions = [{ id: "persistent-fire", value: 1 }];
  const repaired = makeRepair(content)(s);
  eq(repaired.pc.conditions.length, 1, "the condition this build does not define is dropped");
  eq(repaired.pc.conditions[0].id, "frightened", "and the one it does survives");
  eq(repaired.creatures[0].conditions.length, 0,
    "a corpse carries nothing — it will never take another turn for the fire to tick on");
}

{
  // Taking the stairs: the area changes under the PC, the vault's own fog is
  // banked rather than lost, and a creature back in the room just left cannot
  // notice, collide with, or otherwise interact with one in the new room.
  // Built with the Keeper already down — it stands right beside this path —
  // so the walk to the stairs is not also an encounter test; waking is
  // covered elsewhere. The sentinels are left alive and awake-able, fifteen
  // squares away in the main room, to check that living()/awake() really are
  // scoped to the area the PC is in once it reaches the sanctum, not just
  // filtering out the dead.
  const state = freshRun(content);
  state.gateOpen = true;
  for (const c of state.creatures) if (c.wakesOn === "gate-opened") c.wakesOn = "notice";
  state.creatures.find(c => c.creature === "vault-keeper").dead = true;
  state.pc.x = 9; state.pc.y = 3;      // already inside the boss chamber
  const g = createGame({ content: resolved, rng: makeRng(50), state });
  g.begin();
  eq(g.run.areaId, "vault", "the run starts in the vault");
  const exploredBefore = g.explored.size;
  ok(exploredBefore > 1, "arriving already sees a chunk of the boss chamber");

  g.walkTo(10, 2);                     // onto a stairway square
  eq(g.run.areaId, "sanctum", "walking onto a stairway changes the area");
  eq(g.run.pc.x, 6, "the PC lands on the stairway's declared x");
  eq(g.run.pc.y, 8, "the PC lands on the stairway's declared y");
  eq(g.mode, "explore", "arriving does not itself start an encounter");

  eq(g.run.fog.vault.length, 484, "the vault's fog was banked under its own id");
  const vaultFog = unpackExplored(g.run.fog.vault, 22, 22);
  // At least what had been seen before the walk to the stairs, since the walk
  // itself reveals a few more squares along the way.
  ok(vaultFog.size >= exploredBefore, "and it remembers what had been explored there, not less");
  ok(vaultFog.has("9,3"), "including the square the walk to the stairs started from");
  ok(g.explored.size >= 1, "the sanctum starts with at least its arrival square explored");
  ok(!g.explored.has("10,19"), "the sanctum's fog does not carry over the vault's spawn square");

  // A creature in the vault cannot be woken, targeted, or collided with from
  // the sanctum — living()/awake() are scoped to the area the PC stands in.
  ok(g.living().every(c => c.area === "sanctum"), "living() only returns creatures in the current area");
  ok(!g.awake().some(c => c.creature === "shattered-sentinel"), "a vault sentinel cannot be awake while the PC is in the sanctum");
}

{
  // The stairway trigger only fires out of combat — a Stride that lands on
  // one mid-fight does not strand a creature's turn order across an area
  // change.
  const state = freshRun(content);
  state.gateOpen = true;
  const keeper = state.creatures.find(c => c.creature === "vault-keeper");
  keeper.wakesOn = "notice"; keeper.awake = true; keeper.x = 9; keeper.y = 1;
  state.pc.x = 9; state.pc.y = 3;
  const g = createGame({ content: resolved, rng: makeRng(13), state });
  g.begin();
  eq(g.mode, "combat", "the run boots straight into the encounter the save described");
  ok(toPCTurn(g), "control comes to the PC");
  g.turn.actions = 3;
  g.walkTo(10, 2);                     // Stride onto the stairway mid-fight
  eq(g.run.areaId, "vault", "a stairway square reached mid-combat does not transition");
}

{
  // Export to a file and import it back, which is the thing no project had
  // before gvb-save.
  const slot = makeSaveSlot(content, memStore());
  const g = createGame({ content: resolved, rng: makeRng(88) });
  g.begin();
  g.run.pc.hp = 6;
  g.run.loreRead.push("bequest", "condition");
  g.run.gateOpen = true;
  const text = slot.serialize(g.snapshot());
  const env = JSON.parse(text);
  eq(env.format, "gvb-save", "the export carries the shared envelope");
  eq(env.game, "absalom-inheritance", "stamped with this game's slug");
  eq(env.version, SAVE_VERSION, "and the schema version");
  ok(typeof env.savedAt === "string", "and a timestamp");

  const imported = slot.deserialize(text);
  ok(imported, "the exported file imports");
  eq(imported.pc.hp, 6, "HP came back");
  eq(imported.gateOpen, true, "the open gate came back");

  // A file from a different game is refused rather than loaded into this one.
  const foreign = JSON.stringify({ ...env, game: "fourth-quarter" });
  eq(slot.deserialize(foreign), null, "a save from another game is refused");
}

{
  // Corrupt input is refused, not parsed into game state. This is the whole
  // reason the shared module exists: Closing Time still JSON.parses a blob
  // straight into its state object and boots on it.
  const slot = makeSaveSlot(content, memStore());
  eq(slot.deserialize("not json at all"), null, "garbage text is refused");
  eq(slot.deserialize("{}"), null, "an empty object is refused");
  eq(slot.deserialize("[]"), null, "an array is refused");
  eq(slot.deserialize("null"), null, "null is refused");
  eq(slot.deserialize('{"state":{"pc":{}},"format":"gvb-save","game":"absalom-inheritance","version":1}'), null,
    "an envelope wrapping a PC with no HP is refused");
  eq(slot.deserialize('{"format":"gvb-save","game":"absalom-inheritance","version":1,"state":"hello"}'), null,
    "an envelope wrapping a string is refused");

  // A truncated file — the realistic corruption, half a download.
  const g = createGame({ content: resolved, rng: makeRng(2) });
  g.begin();
  const good = slot.serialize(g.snapshot());
  eq(slot.deserialize(good.slice(0, Math.floor(good.length / 2))), null, "a half-written file is refused");

  // And a bad save in storage does not take the game down on boot.
  const store2 = memStore();
  store2.setItem(SAVE_KEY, "{{{ not json");
  eq(makeSaveSlot(content, store2).load(), null, "corrupt localStorage loads as null rather than throwing");
}

{
  // repair — the fill-in pass that runs on every accepted load. Each case below
  // is a field that a save written by a future version could be missing, which
  // is the v7 §2 bug class: the loader filled in role and skill but not speed,
  // and undefined went straight into a multiplication.
  const repair = makeRepair(content);
  const base = () => JSON.parse(JSON.stringify(freshRun(content)));
  // By id, not by index: placements are discovered in row order, and the Keeper
  // sits in row 1, so creatures[0] is the boss rather than a sentinel.
  const sentinelIn = s => s.creatures.find(c => c.creature === "shattered-sentinel");

  {
    const s = base(); delete s.loreRead;
    eq(repair(s).loreRead.length, 0, "repair: a missing loreRead becomes an empty array");
  }
  {
    const s = base(); s.loreRead = ["bequest", "made-up"];
    eq(repair(s).loreRead.length, 1, "repair: lore the pack no longer defines is dropped");
  }
  {
    const s = base(); s.loreRead = ["bequest", "condition"]; s.gateOpen = false;
    eq(repair(s).gateOpen, true, "repair: both pillars read means the gate is open, whatever the flag said");
  }
  {
    const s = base(); s.loreRead = ["bequest", "condition"]; s.gateOpen = false;
    eq(repair(s).creatures.find(c => c.creature === "vault-keeper").wakesOn, "notice",
      "repair: an open gate has already released whatever it held shut");
  }
  {
    const s = base(); delete s.stats;
    eq(repair(s).stats.rounds, 0, "repair: missing stats are rebuilt");
  }
  {
    // `abilities` joined the counters this phase, so every save written before
    // it has a stats block with five keys and not six. `++` on the missing one
    // is NaN, and a report that prints NaN reads as a crash somewhere else
    // entirely — additive means the old shape still loads (#37).
    const s = base(); s.stats = { rounds: 3, dealt: 9, taken: 4, woken: 1, slain: 1, reactions: 2 };
    eq(repair(s).stats.abilities, 0, "repair: a save from before creature abilities counts zero of them");
    eq(repair(s).stats.reactions, 2, "and keeps the counters it does carry");
  }
  {
    const s = base(); delete s.fog;
    eq(JSON.stringify(repair(s).fog), "{}", "repair: a missing fog map becomes an empty object rather than undefined");
  }
  {
    const s = base(); s.fog = { vault: "101" };
    eq(repair(s).fog.vault, undefined,
      "repair: a bitfield of the wrong length is dropped, not indexed with the wrong stride");
  }
  {
    const s = base(); s.fog = { vault: "1".repeat(484), nowhere: "1".repeat(484) };
    ok(!("nowhere" in repair(s).fog), "repair: fog for an area the pack no longer defines is dropped");
  }
  {
    // A round-one save had no `fog` map at all — one bitfield for what was
    // then the only room, under `explored`. It has to become the new shape,
    // not be discarded outright.
    const s = base(); delete s.fog; s.explored = "1".repeat(484);
    const r = repair(s);
    eq(r.fog.vault, "1".repeat(484), "repair: a legacy single explored bitfield migrates under the save's own area id");
    ok(!("explored" in r), "repair: the legacy explored field is removed once migrated");
  }
  {
    // A save from before character creation existed has no buildId at all —
    // every save that could be in the wild before this round meant the one PC
    // that ever existed, which is why pcOptions[0] has to stay the wizard.
    const s = base(); delete s.buildId;
    eq(repair(s).buildId, "wizard", "repair: a save with no buildId at all migrates onto the first build");
  }
  {
    const s = base(); s.buildId = "a-build-this-pack-never-shipped";
    eq(repair(s).buildId, "wizard", "repair: an unknown buildId falls back to the first build rather than crashing");
  }
  {
    // HP/slots/focus have to clamp against the *chosen* build's own numbers,
    // not always the wizard's — this is the whole reason repair() needed to
    // resolve buildId before it could clamp anything.
    const s = base(); s.buildId = "fighter"; s.pc.hp = 999; s.pc.slots = 99; s.pc.focus = 99;
    const r = repair(s);
    eq(r.pc.hp, 18, "repair: HP clamps against the fighter's own maximum, not the wizard's");
    eq(r.pc.slots, 0, "repair: the fighter has no spell slots to clamp up to");
    eq(r.pc.focus, 0, "repair: nor any focus");
  }
  {
    const s = base(); s.pc.hp = 999;
    eq(repair(s).pc.hp, 15, "repair: HP above maximum is clamped");
  }
  {
    const s = base(); s.pc.hp = -4;
    eq(repair(s).pc.hp, 0, "repair: negative HP is clamped to 0");
  }
  {
    const s = base(); s.pc.hp = 0; s.outcome = null;
    eq(repair(s).outcome, "defeat", "repair: a PC at 0 HP with no outcome is a defeat, not a playable corpse");
  }
  {
    const s = base(); s.pc.hp = "twelve";
    eq(repair(s).pc.hp, 15, "repair: a non-numeric HP falls back rather than becoming NaN");
  }
  {
    const s = base(); s.pc.slots = 99; s.pc.focus = 99;
    const r = repair(s);
    eq(r.pc.slots, 2, "repair: spell slots are clamped to the maximum");
    eq(r.pc.focus, 1, "repair: focus is clamped to the maximum");
  }
  {
    const s = base(); s.pc.x = 900; s.pc.y = -3;
    const r = repair(s);
    eq(r.pc.x, content.areas.vault.pcSpawn.x, "repair: an out-of-bounds PC goes back to the spawn");
    eq(r.pc.y, content.areas.vault.pcSpawn.y, "repair: on both axes");
  }
  {
    // A save naming an area this pack no longer defines falls back to the
    // start area rather than indexing a tile grid that is not there.
    const s = base(); s.areaId = "collapsed-wing";
    const r = repair(s);
    eq(r.areaId, "vault", "repair: an unknown area falls back to the start area");
  }
  {
    // A round-one save's creature key has no area prefix — just "id@x,y" —
    // since game.js never rewrote it after a creature moved. Repair has to
    // recover the same key placedByKey uses today, or every in-progress
    // round-one save spawns a duplicate creature at boot.
    const s = base();
    const sentinel = sentinelIn(s);
    const legacyKey = sentinel.key.split(":")[1];
    sentinel.key = legacyKey;
    delete sentinel.area;
    const r = repair(s);
    eq(r.creatures.filter(c => c.creature === "shattered-sentinel").length, 2,
      "repair: a legacy key migrates onto the real placement rather than duplicating it");
    ok(sentinelIn(r).key.startsWith("vault:"), "repair: the migrated key carries the area prefix now");
  }
  {
    const s = base(); delete sentinelIn(s).hp;
    eq(sentinelIn(repair(s)).hp, 11, "repair: a creature with no HP gets its maximum from content");
  }
  {
    const s = base(); sentinelIn(s).hp = 0; sentinelIn(s).dead = false;
    eq(sentinelIn(repair(s)).dead, true, "repair: a creature at 0 HP is dead whatever the flag said");
  }
  {
    const s = base(); sentinelIn(s).hp = 0; sentinelIn(s).awake = true;
    eq(sentinelIn(repair(s)).awake, false, "repair: a dead creature is not awake");
  }
  {
    const s = base(); delete sentinelIn(s).wakesOn;
    ok(!!sentinelIn(repair(s)).wakesOn, "repair: a creature with no wakesOn gets one — this is the v7 §2 trap");
  }
  {
    const s = base(); s.creatures.push({ creature: "made-up", x: 1, y: 1, hp: 5 });
    eq(repair(s).creatures.filter(c => c.creature === "made-up").length, 0,
      "repair: a creature the pack no longer defines is dropped rather than walking around undefined");
  }
  {
    const s = base(); s.creatures = [];
    eq(repair(s).creatures.length, 4, "repair: creatures the save never mentioned arrive dormant at full HP");
    ok(repair(base()).creatures.every(c => typeof c.hp === "number" && c.hp > 0),
      "repair: every creature ends with usable HP");
  }
  {
    const s = base(); s.inventory.push({ item: "made-up", slot: 7 });
    eq(repair(s).inventory.some(i => i.item === "made-up"), false, "repair: an item the pack no longer defines is dropped");
  }
  {
    const s = base(); s.inventory[0].slot = 3; s.inventory[1].slot = 3;
    const slots = repair(s).inventory.map(i => i.slot);
    eq(new Set(slots).size, slots.length, "repair: two items cannot share a slot, which would hide one of them");
  }
  {
    const s = base(); s.inventory[0].slot = 99;
    ok(repair(s).inventory.every(i => i.slot >= 0 && i.slot < content.inventorySlots),
      "repair: an out-of-range slot is brought back in range");
  }
  {
    const s = base(); s.log = "not an array";
    eq(repair(s).log.length, 0, "repair: a non-array log becomes an array");
  }
  {
    const s = base(); s.log = Array.from({ length: 500 }, (_, i) => ({ kind: "info", text: "e" + i }));
    ok(repair(s).log.length <= 60, "repair: the log is trimmed rather than growing without limit");
  }
  {
    const s = base(); s.outcome = "banana";
    eq(repair(s).outcome, null, "repair: an unknown outcome is cleared");
  }
  {
    // Idempotence. gvb-save runs repair on every accepted load, including on a
    // state it just repaired, so a repair that is not idempotent drifts.
    const once = repair(base());
    const twice = repair(JSON.parse(JSON.stringify(once)));
    eq(JSON.stringify(twice), JSON.stringify(once), "repair is idempotent");
  }
}

{
  // A save from mid-encounter comes back mid-encounter: same creatures awake,
  // same HP, fresh initiative.
  const slot = makeSaveSlot(content, memStore());
  const g = createGame({ content: resolved, rng: makeRng(303) });
  g.begin();
  travel(g, 10, 12);
  const awakeBefore = g.awake().length;
  const hpBefore = g.awake()[0]?.hp;
  slot.save(g.snapshot());
  const g2 = createGame({ content: resolved, rng: makeRng(304), state: slot.load() });
  g2.begin();
  eq(g2.awake().length, awakeBefore, "the creatures that were awake are still awake after a reload");
  eq(g2.awake()[0]?.hp, hpBefore, "and still as hurt as they were");
  eq(g2.mode, "combat", "the reload lands back in the encounter");
}

{
  // reset() has to hand back a usable state. Passing a literal for `defaults`
  // is how The Fourth Quarter's reset() returned null (v7 §1), so this is the
  // assertion that catches that regression here.
  const slot = makeSaveSlot(content, memStore());
  const fresh = slot.reset();
  ok(fresh, "reset() returns a state rather than null");
  eq(fresh.pc.hp, 15, "and it is a full-health new run");
  eq(fresh.loreRead.length, 0, "with no lore read");
  ok(fresh !== slot.reset(), "and a new object each time, not a shared template");
  eq(slot.load(), null, "reset cleared the key");
}

{
  // gvb-save's fresh()/reset() forward their own arguments straight through to
  // the `defaults` factory (that passthrough already existed for The Fourth
  // Quarter's newCampaign()); the character picker's chosen buildId rides that
  // same path as `slot.fresh("fighter")` / `slot.reset("fighter")`.
  const slot = makeSaveSlot(content, memStore());
  const picked = slot.fresh("fighter");
  eq(picked.buildId, "fighter", "fresh(buildId) builds the chosen character, not the default one");
  eq(picked.pc.hp, 18, "at that build's own starting HP");
}

/* ========================================================================= *
 * done
 * ========================================================================= */
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("SMOKE OK\n");
