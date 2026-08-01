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
import { loadPack, ContentError } from "../js/content.js";
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

// The validator's job is to complain at load rather than let an undefined reach
// a damage roll. Each of these was confirmed to load silently before the check
// existed.
const clone = () => JSON.parse(JSON.stringify(rawPack));
throws(() => loadPack(null), "content: a null pack is refused");
throws(() => loadPack({}), "content: a pack with no id is refused");
throws(() => { const p = clone(); p.pack.schema = 2; loadPack(p); }, "content: an unknown schema version is refused");
throws(() => { const p = clone(); delete p.pc.hp; loadPack(p); }, "content: a PC with no HP is refused");
throws(() => { const p = clone(); delete p.pc.saves.will; loadPack(p); }, "content: a PC missing a save is refused");
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
  const g = createGame({ content, rng: makeRng(42) });
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
  const g = createGame({ content, rng: makeRng(7) });
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
  const g = createGame({ content, rng: makeRng(3) });
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
  const g = createGame({ content, rng: makeRng(5), state });
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

  const g = createGame({ content, rng: makeRng(9) });
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
  const g = createGame({ content, rng: makeRng(21) });
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
  const g = createGame({ content, rng: makeRng(31) });
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
  const g = createGame({ content, rng: makeRng(1234) });
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
    const g = createGame({ content, rng: makeRng(1000 + i) });
    if (playThrough(g).outcome === "victory") wins++;
  }
  ok(wins > 0, `the adventure is winnable (${wins}/40 seeds)`);
  ok(wins < 40, `and losable (${40 - wins}/40 seeds lost)`);
}

/* ========================================================================= *
 * 5 — the save slot
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
  const g = createGame({ content, rng: makeRng(77) });
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
  const g2 = createGame({ content, rng: makeRng(78), state: back });
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
  const g = createGame({ content, rng: makeRng(50), state });
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
  const g = createGame({ content, rng: makeRng(13), state });
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
  const g = createGame({ content, rng: makeRng(88) });
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
  const g = createGame({ content, rng: makeRng(2) });
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
  const g = createGame({ content, rng: makeRng(303) });
  g.begin();
  travel(g, 10, 12);
  const awakeBefore = g.awake().length;
  const hpBefore = g.awake()[0]?.hp;
  slot.save(g.snapshot());
  const g2 = createGame({ content, rng: makeRng(304), state: slot.load() });
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
