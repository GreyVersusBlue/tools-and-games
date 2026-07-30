// test/smoke.mjs — The Fracture Cycle's first test suite. Plain Node, no
// framework, exits non-zero on any failure (locked decision #13).
//
// Two things are under test:
//
//   1. Reachability of the story graph, extracted verbatim from
//      the-fracture-cycle.html's inline `nodes` object (no restructuring of
//      the page itself — this test reads the shipped file as text and pulls
//      the literal out, the same technique torchbearer's smoke test uses for
//      its inline packs). This is the walk described in the session notes'
//      branch map, made permanent: every one of the five endings must be
//      reachable from `intro`, and every `next` a choice points at must
//      resolve to a real node. Before the align+=1 fix at radiant_gate this
//      test failed — end_radiant was mathematically unreachable (max
//      achievable align was +1, and the ending needs align>=2). Reintroduce
//      that bug and this suite is the thing that catches it (locked decision
//      #34).
//   2. The save slot (save-config.js + assets/js/gvb-save.js), through every
//      door: a fresh load, a round trip, a corrupt blob, an ending id that
//      doesn't exist.
//
// Run with: node Projects/the-fracture-cycle/test/smoke.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.join(HERE, "..");
const PROJECTS_DIR = path.join(GAME_DIR, "..");
const PAGE = path.join(PROJECTS_DIR, "the-fracture-cycle.html");

// Windows: a bare `C:\...` is read by Node as URL scheme `c:` and refused
// outright, so every dynamic import goes through pathToFileURL (v7 §7).
const mod = p => import(pathToFileURL(path.join(GAME_DIR, p)).href);

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else fails.push(label); }
function group(name) { console.log("\n\u2500\u2500 " + name); }

const html = fs.readFileSync(PAGE, "utf8");

/**
 * Pull a balanced `{...}` or `[...]` literal out of JS source starting at
 * `start` (which must point at the opening bracket). String- and
 * template-literal-aware: a brace inside a "...", '...', or `...` (including
 * inside a `${...}` substitution, which is tracked as its own nested frame)
 * never affects depth. Comments are skipped too. This file's `nodes` object
 * is full of backtick prose with straight double quotes in dialogue and one
 * escaped `${'${fragCount}'}` substitution, all of which a plain
 * quote-toggling counter (fine for JSON-shaped data) would trip over.
 */
function extractBalanced(src, start) {
  const stack = [];
  let i = start;
  let mode = "code";
  while (i < src.length) {
    const c = src[i];
    if (mode === "code") {
      if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j + 1; continue; }
      if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; continue; }
      if (c === "'") { mode = "sq"; i++; continue; }
      if (c === '"') { mode = "dq"; i++; continue; }
      if (c === "`") { mode = "bt"; i++; continue; }
      if (c === "{") { stack.push("{"); i++; continue; }
      if (c === "[") { stack.push("["); i++; continue; }
      if (c === "}") {
        const top = stack.pop();
        i++;
        if (top === "tplExpr") { mode = "bt"; continue; }
        if (stack.length === 0) return src.slice(start, i);
        continue;
      }
      if (c === "]") {
        stack.pop();
        i++;
        if (stack.length === 0) return src.slice(start, i);
        continue;
      }
      i++; continue;
    }
    if (mode === "sq" || mode === "dq") {
      const quote = mode === "sq" ? "'" : '"';
      if (c === "\\") { i += 2; continue; }
      if (c === quote) { mode = "code"; i++; continue; }
      i++; continue;
    }
    if (mode === "bt") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { mode = "code"; i++; continue; }
      if (c === "$" && src[i + 1] === "{") { stack.push("tplExpr"); mode = "code"; i += 2; continue; }
      i++; continue;
    }
  }
  throw new Error("extractBalanced: unterminated literal");
}

function literalAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const start = src.indexOf("{", at);
  return extractBalanced(src, start);
}

/* ---------------------------------------------------------------------
   Section 1: page wiring sanity
--------------------------------------------------------------------- */
group("page wiring");
ok(/<script type="module">/.test(html), "the inline script is a module");
ok(html.includes('from "../assets/js/gvb-save.js"'), "imports the shared save module");
ok(html.includes('from "./the-fracture-cycle/save-config.js"'), "imports save-config.js");
ok(!/fonts\.googleapis\.com/.test(html), "no Google Fonts hotlink remains");
ok(/@font-face/.test(html), "local @font-face rules are present");
ok(/<!-- gvb:social:start/.test(html) && /gvb:social:end -->/.test(html), "the social block is intact");
const codeOnly = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
ok(!/localStorage\s*\./.test(codeOnly), "the page makes no direct localStorage call");

/* ---------------------------------------------------------------------
   Section 2: story graph reachability
--------------------------------------------------------------------- */
group("story graph reachability");

const initialStateSrc = literalAfter(html, "const initialState = () => (");
const nodesSrc = literalAfter(html, "const nodes = {");

// `nodes`'s effect/choices functions close over `state`, `hasFrag`, `addFrag`
// exactly as they do in the page — declared here in the same scope before the
// literal is eval'd, so the closures resolve them correctly.
let state;
function hasFrag(f) { return state.fragments.includes(f); }
function addFrag(f) { if (!hasFrag(f)) state.fragments.push(f); }
// eslint-disable-next-line no-eval
const initialState = () => eval("(" + initialStateSrc + ")");
// eslint-disable-next-line no-eval
const nodes = eval("(" + nodesSrc + ")");

const nodeIds = Object.keys(nodes);
ok(nodeIds.length > 0, "nodes is non-empty");

function optionsFor(node) {
  return typeof node.choices === "function" ? node.choices() : node.choices;
}

// integrity: every `next` a choice points at must be a real node id
{
  const badRefs = [];
  for (const id of nodeIds) {
    const node = nodes[id];
    if (node.ending) continue;
    state = initialState();
    let opts;
    try { opts = optionsFor(node); } catch (e) { badRefs.push(`${id}: choices() threw ${e.message}`); continue; }
    for (const opt of opts) {
      if (!(opt.next in nodes)) badRefs.push(`${id} -> "${opt.next}" (no such node)`);
    }
  }
  ok(badRefs.length === 0, "every choice's `next` resolves to a real node" +
    (badRefs.length ? ": " + badRefs.join("; ") : ""));
}

// the walk: DFS from intro, cloning state per branch, applying effects,
// recording every ending reached and every node visited. A (nodeId, state)
// memo guards the side_hub loop (radiant/dire/invoker contacts) from
// exploding or recursing forever.
const cloneState = s => JSON.parse(JSON.stringify(s));
const endingsSeen = new Set();
const nodesVisited = new Set();
const memo = new Set();

function walk(id, curState) {
  const key = id + "|" + JSON.stringify(curState);
  if (memo.has(key)) return;
  memo.add(key);
  nodesVisited.add(id);
  const node = nodes[id];
  if (node.ending) { endingsSeen.add(id); return; }
  state = curState; // choices() reads `state.visited`/`state.align` via closure
  const opts = optionsFor(node);
  for (const opt of opts) {
    const branchState = cloneState(curState);
    state = branchState;
    if (opt.effect) opt.effect(branchState);
    walk(opt.next, branchState);
  }
}
walk("intro", initialState());

const ALL_ENDINGS = ["end_radiant", "end_dire", "end_convergence", "end_ascension", "end_corruption"];
for (const id of ALL_ENDINGS) {
  ok(endingsSeen.has(id), `${id} is reachable from intro (found: [${[...endingsSeen].join(", ")}])`);
}
ok(endingsSeen.size === ALL_ENDINGS.length, `exactly ${ALL_ENDINGS.length} endings exist and all are reachable, got ${endingsSeen.size}`);

const orphans = nodeIds.filter(id => !nodesVisited.has(id));
ok(orphans.length === 0, "every defined node is reached by the walk" + (orphans.length ? `: ${orphans.join(", ")} never visited` : ""));

/* ---------------------------------------------------------------------
   Section 3: the save slot (save-config.js + gvb-save.js)
--------------------------------------------------------------------- */
group("save slot");

const { createSaveSlot } = await mod("../../assets/js/gvb-save.js");
const { SAVE_KEY, SAVE_VERSION, ENDING_IDS, freshProgress, validateProgress, repairProgress } =
  await mod("save-config.js");

ok(ALL_ENDINGS.every(id => ENDING_IDS.includes(id)) && ENDING_IDS.length === ALL_ENDINGS.length,
  "save-config's ENDING_IDS matches the five endings the graph actually has");

function memStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

{
  const storage = memStore();
  const slot = createSaveSlot({ game: "fracture-cycle", key: SAVE_KEY, version: SAVE_VERSION, validate: validateProgress, repair: repairProgress, defaults: freshProgress, storage });

  ok(slot.load() === null, "load() is null before anything is saved");
  const fresh = slot.fresh();
  ok(Array.isArray(fresh.seenEndings) && fresh.seenEndings.length === 0, "fresh() starts with no endings seen");

  fresh.seenEndings.push("end_dire", "end_convergence");
  ok(slot.save(fresh) === true, "save() succeeds against a working store");
  const reloaded = slot.load();
  ok(reloaded && reloaded.seenEndings.length === 2, "load() round-trips what was saved");

  // repair: drop anything that isn't a real ending id, dedupe
  storage.setItem(SAVE_KEY, JSON.stringify({ seenEndings: ["end_dire", "end_dire", "not_a_real_ending"], __v: SAVE_VERSION }));
  const repaired = slot.load();
  ok(repaired.seenEndings.length === 1 && repaired.seenEndings[0] === "end_dire", "repair() drops unknown ids and dedupes");

  // corrupt blob refused, not thrown
  storage.setItem(SAVE_KEY, "{not json");
  ok(slot.load() === null, "a corrupt blob loads as null rather than throwing");

  storage.setItem(SAVE_KEY, JSON.stringify({ notSeenEndings: 1 }));
  ok(slot.load() === null, "a save missing seenEndings fails validate() and loads as null");

  // export/import envelope round trip
  const state1 = slot.fresh();
  state1.seenEndings.push("end_ascension");
  const exported = slot.serialize(state1);
  const imported = slot.deserialize(exported);
  ok(imported && imported.seenEndings.includes("end_ascension"), "serialize/deserialize round-trips a real save");
  ok(slot.deserialize("garbage") === null, "deserialize() refuses non-JSON text");
}

/* ---------------------------------------------------------------------
--------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFAILED:");
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
