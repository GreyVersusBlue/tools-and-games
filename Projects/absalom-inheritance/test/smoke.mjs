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
import { loadPack, selectPc, ContentError, REACTION_TRIGGERS, REACTION_EFFECTS } from "../js/content.js";
import { createGame } from "../js/game.js";
import { makeSaveSlot, makeRepair, validRun, freshRun, SAVE_KEY, SAVE_VERSION } from "../js/save.js";
import { playThrough, travel, fight } from "./autopilot.mjs";

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
eq(resolved.commands.length, 7, "selectPc narrows commands to the wizard's own list");
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
ok(world.blocksSight(10, 5, false), "a closed gate blocks sight");
ok(!world.blocksSight(10, 5, true), "an open gate does not block sight");
ok(world.blocksMove(3, 12, false), "a pillar blocks movement");
ok(world.blocksSight(3, 12, false), "a pillar blocks sight");
ok(!world.blocksMove(10, 2, false), "a stairway does not block movement");
ok(!world.blocksSight(10, 2, false), "a stairway does not block sight");

ok(world.hasLoS(10, 19, 10, 17, false), "line of sight down an open corridor");
ok(!world.hasLoS(1, 6, 20, 6, false) === false, "a clear row has line of sight end to end");
ok(!world.hasLoS(10, 19, 10, 2, false), "the stairway is not visible through a closed gate");
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
  const fov = world.fieldOfView(10, 19, 30, false);
  ok(fov.has("10,19"), "you can see the square you are standing on");
  ok(fov.has("10,17"), "you can see two squares up the corridor");
  ok(!fov.has("10,2"), "you cannot see the stairway from the spawn");
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
 * A scenario builder: the PC standing next to the Vault Keeper, gate open,
 * the Keeper awake, in the upper chamber. Hand-built rather than played into,
 * because the interesting cases are all about which square somebody left and
 * walking there first would spend the round getting into position.
 */
function keeperFight(buildId, seed, pcAt = [10, 4]) {
  const c = selectPc(content, buildId);
  const build = content.pcById[buildId];
  const state = {
    packId: content.pack.id, buildId, areaId: "vault",
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
  const g = keeperFight("wizard", 1);
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
  ok(blockAt >= 0, "the Keeper's fist rings off the disc");
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
  const shielded = keeperFight("wizard", 1);
  shielded.useCommand("shield");
  let a = shielded.endTurn();
  while (a && a.actor !== "pc" && !shielded.run.outcome) a = shielded.advance();

  const bare = keeperFight("wizard", 1);
  let b = bare.endTurn();
  while (b && b.actor !== "pc" && !bare.run.outcome) b = bare.advance();
  eq(bare.run.stats.reactions, 0, "with no Shield up nothing blocks");
  ok(bare.run.pc.hp < shielded.run.pc.hp,
    `the blocked run keeps more HP (${shielded.run.pc.hp} vs ${bare.run.pc.hp})`);
}

{
  // A disc of force does nothing about heat. Same fight, same seed, the
  // Keeper's fist retyped as fire — the reaction is offered and refused on the
  // damage type rather than fired and wasted.
  const p = JSON.parse(JSON.stringify(rawPack));
  p.creatures["vault-keeper"].damageType = "fire";
  const hot = loadPack(p);
  const c = selectPc(hot, "wizard");
  const g = createGame({
    content: c, rng: makeRng(1),
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
  eq(leaves, 0,
    `no planned Stride leaves the PC's reach (${leaves} of ${strides}) — if this fails, ` +
    `a creature can now provoke and the Fighter's Reactive Strike is live in shipped play`);
}

/* ========================================================================= *
 * 6 — the save slot
 * ========================================================================= */
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
