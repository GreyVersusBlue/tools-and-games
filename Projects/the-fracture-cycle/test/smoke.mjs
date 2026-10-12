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
//   3. Every path (decision #958, the fourth prong). The walk in 2 memoises
//      on (node, state) and so proves reachability, not sameness. Section 3
//      enumerates every complete path from `intro` to an ending and pins the
//      ones that do not start on the seam to a hash taken from the page as it
//      stood before the prong was written: same nodes, same text, same
//      choices offered, same state after each step. A typo fixed in an old
//      node moves that hash on purpose: rerun with --paths and paste the new
//      figures, in a commit that says why.
//
// Run with: node Projects/the-fracture-cycle/test/smoke.mjs
//           node Projects/the-fracture-cycle/test/smoke.mjs --paths   (prints the counts and hashes)

import fs from "node:fs";
import crypto from "node:crypto";
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

// The fourth prong (#958). PRONG_WIRED says whether a player can enter it, and
// it is the one switch: while it is false the entrance must be absent and no
// seam node may be reached from `intro`, however much of the prong is written;
// once it is true all seven nodes must exist. A prong is never half-reachable.
const PRONG_WIRED = true;
const OLD_ENDINGS = ["end_radiant", "end_dire", "end_convergence", "end_ascension", "end_corruption"];
const SEAM_ENDINGS = ["end_witness", "end_named"];
const SEAM_NODES = ["seam_walk", "seam_cairn", "seam_stone", "seam_named", "seam_answer", ...SEAM_ENDINGS];
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
    // an unfinished prong may point at a node not written yet; nothing reaches it
    if (!PRONG_WIRED && SEAM_NODES.includes(id)) continue;
    state = initialState();
    // the seam's nodes are only ever shown to a walker, who has this
    if (SEAM_NODES.includes(id)) state.seam = { name: "own" };
    let opts;
    try { opts = optionsFor(node); } catch (e) { badRefs.push(`${id}: choices() threw ${e.message}`); continue; }
    for (const opt of opts) {
      if (!(opt.next in nodes)) badRefs.push(`${id} -> "${opt.next}" (no such node)`);
    }
  }
  ok(badRefs.length === 0, "every choice's `next` resolves to a real node" +
    (badRefs.length ? ": " + badRefs.join("; ") : ""));
}

// and the same from the source, which also sees a choice no state above offered
{
  const named = [...nodesSrc.matchAll(/next:\s*"([^"]+)"/g)].map(m => m[1]);
  const lost = [...new Set(named)].filter(id => !(id in nodes) && (PRONG_WIRED || !SEAM_NODES.includes(id)));
  ok(named.length > 0 && lost.length === 0, "every `next` written in the source names a real node" + (lost.length ? ": " + lost.join(", ") : ""));
}

// the walk: DFS from intro, cloning state per branch, applying effects,
// recording every ending reached and every node visited. A (nodeId, state)
// memo guards the side_hub loop (radiant/dire/invoker contacts) from
// exploding or recursing forever.
const cloneState = s => JSON.parse(JSON.stringify(s));
const endingsSeen = new Set();
const nodesVisited = new Set();
const memo = new Set();
const walkErrors = [];

function walk(id, curState) {
  const key = id + "|" + JSON.stringify(curState);
  if (memo.has(key)) return;
  memo.add(key);
  const node = nodes[id];
  if (!node) { walkErrors.push(`a choice leads to "${id}", which is not a node`); return; }
  nodesVisited.add(id);
  if (node.ending) { endingsSeen.add(id); return; }
  state = curState; // choices() reads `state.visited`/`state.align` via closure
  let opts;
  try { opts = optionsFor(node); } catch (e) { walkErrors.push(`${id}: choices() threw (${e.message})`); return; }
  for (const opt of opts) {
    const branchState = cloneState(curState);
    state = branchState;
    try { if (opt.effect) opt.effect(branchState); }
    catch (e) { walkErrors.push(`${id}: the effect of "${opt.label}" threw (${e.message})`); continue; }
    walk(opt.next, branchState);
  }
}
walk("intro", initialState());
// A broken graph is reported here by name; the suite does not die of it (#34).
ok(walkErrors.length === 0, "the walk meets no missing node and no choice or effect that throws" +
  (walkErrors.length ? ": " + [...new Set(walkErrors)].slice(0, 4).join("; ") : ""));

const seamWritten = SEAM_NODES.filter(id => id in nodes);
const seamReached = SEAM_NODES.filter(id => nodesVisited.has(id));
const entrance = nodes.intro.choices.filter(c => c.next === "seam_walk");
if (PRONG_WIRED) {
  ok(entrance.length === 1, `the seam's entrance is one choice at intro, got ${entrance.length}`);
  ok(seamWritten.length === SEAM_NODES.length,
    `the prong is wired, so all ${SEAM_NODES.length} of its nodes exist (missing: ${SEAM_NODES.filter(id => !(id in nodes)).join(", ") || "none"})`);
} else {
  ok(entrance.length === 0, "the prong is not finished, so intro offers no way onto the seam");
  ok(seamReached.length === 0, "the prong is not finished, so no seam node is reached from intro" +
    (seamReached.length ? `: ${seamReached.join(", ")}` : ""));
}

const ALL_ENDINGS = PRONG_WIRED ? [...OLD_ENDINGS, ...SEAM_ENDINGS] : OLD_ENDINGS;
for (const id of ALL_ENDINGS) {
  ok(endingsSeen.has(id), `${id} is reachable from intro (found: [${[...endingsSeen].join(", ")}])`);
}
ok(endingsSeen.size === ALL_ENDINGS.length, `exactly ${ALL_ENDINGS.length} endings exist and all are reachable, got ${endingsSeen.size}`);

const orphans = nodeIds.filter(id => !nodesVisited.has(id) && (PRONG_WIRED || !SEAM_NODES.includes(id)));
ok(orphans.length === 0, "every defined node is reached by the walk" + (orphans.length ? `: ${orphans.join(", ")} never visited` : ""));

/* ---------------------------------------------------------------------
   Section 3: every path, node by node
--------------------------------------------------------------------- */
group("every path");

// What the page's render() shows for a node in a given state. The one
// substitution is the page's own line, asserted as text below so this copy
// cannot drift from it unseen.
function shown(node, s) {
  return node.dynamic ? node.text.replace("${fragCount}", String(s.fragments.length)) : node.text;
}
ok(html.includes("html = html.replace('${fragCount}', String(state.fragments.length));"),
  "the page's render() still makes the one substitution this suite copies");

// No memo here: every complete path is walked on its own. `steps` is what a
// player saw and did; `end` is where it stopped.
const DEPTH_CAP = 40;
const paths = [];
const deadEnds = [];
function enumerate(id, curState, steps) {
  const node = nodes[id];
  if (!node) { deadEnds.push(`"${id}" is not a node`); return; }
  if (node.ending) {
    paths.push({ steps: [...steps, { id, title: node.title, text: shown(node, curState) }], end: id, state: curState });
    return;
  }
  if (steps.length >= DEPTH_CAP) { deadEnds.push(`${id}: no ending within ${DEPTH_CAP} steps`); return; }
  state = curState;
  let opts;
  // a node shown to a state it was not written for is a dead end, said by name
  try { opts = optionsFor(node); } catch (e) { deadEnds.push(`${id}: choices() threw (${e.message}) with ${JSON.stringify(curState)}`); return; }
  if (!opts.length) { deadEnds.push(`${id}: no choice offered with ${JSON.stringify(curState)}`); return; }
  // The seam's entrance is the one thing an old path is allowed to see that
  // it did not see before, and it is left out of what is compared here only.
  const offered = opts.filter(o => !(id === "intro" && o.next === "seam_walk"))
    .map(o => (o.mark || "") + "|" + o.label + "|" + o.next);
  for (const opt of opts) {
    const branchState = cloneState(curState);
    state = branchState;
    try { if (opt.effect) opt.effect(branchState); }
    catch (e) { deadEnds.push(`${id}: the effect of "${opt.label}" threw (${e.message})`); continue; }
    enumerate(opt.next, branchState, [...steps, {
      id, title: node.title, text: shown(node, curState), offered, took: opt.label, after: JSON.stringify(branchState),
    }]);
    state = curState;
  }
}
enumerate("intro", initialState(), []);

const onSeam = p => p.steps[1] && p.steps[1].id === "seam_walk";
const oldPaths = paths.filter(p => !onSeam(p));
const seamPaths = paths.filter(onSeam);
const sha = list => crypto.createHash("sha256")
  .update(JSON.stringify(list.map(p => JSON.stringify(p.steps)).sort())).digest("hex");
const words = t => t.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
const countOf = ids => {
  let choices = 0, w = 0;
  for (const id of ids) {
    const n = nodes[id];
    w += words(n.title) + words(n.text);
    if (n.ending) continue;
    // a choice list built by a function is counted at its longest
    const src = typeof n.choices === "function" ? String(n.choices).match(/label:/g).length : n.choices.length;
    choices += src;
    const labels = typeof n.choices === "function" ? [...String(n.choices).matchAll(/label:"([^"]*)"/g)].map(m => m[1]) : n.choices.map(c => c.label);
    for (const l of labels) w += words(l);
  }
  return { nodes: ids.length, choices, words: w };
};

ok(deadEnds.length === 0, "no path stops short of an ending" + (deadEnds.length ? ": " + deadEnds.join("; ") : ""));
ok(paths.every(p => nodes[p.end].ending), "every path ends on an ending node");

// The three old prongs, as they played at d40aa09, before a line of the
// fourth was written. 171 paths; the hash covers every step of every one.
const OLD_PATHS = 171;
const OLD_SHA = "4bd66e1d435aacca26bd084da7fcc5ecf8102f69e4dfca0e4d180e32f1516d9b";
ok(oldPaths.length === OLD_PATHS, `the three old prongs still have ${OLD_PATHS} paths, got ${oldPaths.length}`);
ok(sha(oldPaths) === OLD_SHA, "every old path plays as it did: same nodes, text, choices offered and state at every step");
ok(oldPaths.every(p => !("seam" in p.state)), "no old path ends carrying any of the seam's state");
ok(oldPaths.every(p => OLD_ENDINGS.includes(p.end)), "no old path ends on one of the seam's endings");

// The seam, every path of it and every crossing with the trunk it rejoins.
if (PRONG_WIRED) {
  const SEAM_PATHS = 348;
  const ends = id => seamPaths.filter(p => p.end === id);
  const through = (p, id) => p.steps.some(st => st.id === id);
  ok(seamPaths.length === SEAM_PATHS, `the seam has ${SEAM_PATHS} paths, got ${seamPaths.length}`);
  ok(seamPaths.every(p => ["seam_walk", "seam_cairn", "seam_stone", "seam_named", "hub_bazaar", "core_approach", "core_confrontation"].every(id => through(p, id))),
    "every seam path walks its beginning and middle, rejoins at Roseleaf and reaches the socket");
  ok(seamPaths.every(p => p.state.seam && ["borne", "own"].includes(p.state.seam.name)),
    "no walker reaches an ending without one of the two names");
  ok(["borne", "own"].every(n => seamPaths.some(p => p.state.seam.name === n)), "each of the two names is some walker's");
  ok(seamPaths.every(p => p.steps.find(st => st.id === "core_confrontation").offered.some(o => o.endsWith("|seam_answer"))),
    "the socket offers every named walker the hollow");
  for (const id of ["end_convergence", "end_ascension", "end_corruption", ...SEAM_ENDINGS]) {
    ok(ends(id).length > 0, `${id} is reachable by a walker of the seam`);
  }
  // Decided, #958: walking the line never moves align past 1, so a walker is
  // never offered a court's ending. This line fails the day a seam choice
  // moves align by 2, which is a design change and should be made on purpose.
  ok(ends("end_radiant").length === 0 && ends("end_dire").length === 0,
    "a walker of the seam is never offered the Sanctuary's ending or the Wildwoods'");
  ok(seamPaths.every(p => Math.abs(p.state.align) <= 1), "the seam never moves align past 1 either way");
  ok(ends("end_named").length > 0 && ends("end_named").every(p => p.state.seam.name === "own" && p.state.fragments.length === 0),
    "the name is given only by a walker whose name is their own and whose hands are empty");
  {
    const atHollow = seamPaths.filter(p => through(p, "seam_answer"));
    const could = p => p.state.seam.name === "own" && p.state.fragments.length === 0;
    const offeredNamed = p => p.steps.find(st => st.id === "seam_answer").offered.some(o => o.endsWith("|end_named"));
    ok(atHollow.length > 0 && atHollow.every(p => offeredNamed(p) === could(p)),
      "the hollow offers the name to exactly those walkers, and to every one of them");
    ok(atHollow.every(p => p.steps.find(st => st.id === "seam_answer").offered.filter(o => o.endsWith("|end_witness")).length === 1),
      "the hollow offers every walker the way back to the cairn, once");
    ok(atHollow.every(p => {
      const way = p.steps.find(st => st.id === "seam_answer").offered.find(o => o.endsWith("|end_witness"));
      return /empty hands/.test(way) === (p.state.fragments.length === 0) && /Carry the pieces/.test(way) === (p.state.fragments.length > 0);
    }), "the way back is worded for what the walker carries");
    for (const n of [0, 1, 2, 3]) {
      ok(atHollow.some(p => p.state.fragments.length === n && p.steps.find(st => st.id === "seam_answer").text.includes(`You carry ${n} of the pieces`)),
        `a walker reaches the hollow carrying ${n} and is told so`);
    }
  }
}

// What every screen is made of. The game's accessibility lives in its markup
// and one stylesheet (one h2 a screen, real buttons, a focus ring, transitions
// off under reduced motion); a new screen keeps it by adding nothing to either.
{
  const styleBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  ok(!/seam|witness|named/.test(styleBlock), "the prong adds no rule to the stylesheet");
  ok(/@media \(prefers-reduced-motion: reduce\)\{\s*\*\{ transition:none !important; \}/.test(styleBlock) && /\.choice-btn:focus-visible\{/.test(styleBlock),
    "the reduced-motion rule and the focus ring are still in the stylesheet");
  const tagsOf = ids => new Set(ids.flatMap(id => [...nodes[id].text.matchAll(/<\/?([a-z0-9]+)([^>]*)>/g)].map(m => m[1] + (m[2].trim() ? " " + m[2].trim() : ""))));
  const oldTags = tagsOf(nodeIds.filter(id => !SEAM_NODES.includes(id)));
  const strange = [...tagsOf(seamWritten)].filter(t => !oldTags.has(t));
  ok(strange.length === 0, "a seam screen uses no element or attribute the old screens do not" + (strange.length ? `: ${strange.join(", ")}` : ""));
  ok(seamWritten.every(id => nodes[id].title && /^<p>/.test(nodes[id].text.trim()) && /<\/p>$/.test(nodes[id].text.trim())),
    "every seam screen has a title for the h2 and prose in paragraphs");
  ok(nodeIds.every(id => !!nodes[id].ending === /^Ending: /.test(nodes[id].title)), "an ending's title says Ending, and only an ending's does");
  ok(nodeIds.every(id => nodes[id].text.includes("${fragCount}") === !!nodes[id].dynamic || (nodes[id].dynamic && id === "core_confrontation")),
    "a node that counts the fragments is marked dynamic, so the count is never printed as ${fragCount}");
  ok(paths.every(p => p.steps.every(st => !st.text.includes("${"))), "no screen on any path shows an unfilled ${...}");
  ok(html.includes(`id="trackerCount">0 / ${nodeIds.filter(id => nodes[id].ending).length}</span>`), "the tracker's first paint counts the endings there are");
}

if (process.argv.includes("--paths")) {
  const tally = list => Object.fromEntries([...OLD_ENDINGS, ...SEAM_ENDINGS].map(e => [e, list.filter(p => p.end === e).length]));
  console.log(JSON.stringify({
    all: countOf(nodeIds), old: countOf(nodeIds.filter(id => !SEAM_NODES.includes(id))), seam: countOf(seamWritten),
    endings: nodeIds.filter(id => nodes[id].ending).length,
    paths: { old: oldPaths.length, seam: seamPaths.length }, oldSha: sha(oldPaths), seamSha: sha(seamPaths),
    oldEnds: tally(oldPaths), seamEnds: tally(seamPaths),
  }, null, 2));
}

/* ---------------------------------------------------------------------
   Section 4: the save slot (save-config.js + gvb-save.js)
--------------------------------------------------------------------- */
group("save slot");

const { createSaveSlot } = await mod("../../assets/js/gvb-save.js");
const { SAVE_KEY, SAVE_VERSION, ENDING_IDS, freshProgress, validateProgress, repairProgress } =
  await mod("save-config.js");

ok(ALL_ENDINGS.every(id => ENDING_IDS.includes(id)) && ENDING_IDS.length === ALL_ENDINGS.length,
  `save-config's ENDING_IDS matches the ${ALL_ENDINGS.length} endings the graph actually has`);
ok(SAVE_KEY === "fracture-cycle-v1" && SAVE_VERSION === 1, "the storage key and version are the ones every save out there was written under (#36)");
ok(OLD_ENDINGS.every((id, i) => ENDING_IDS[i] === id), "the five old ending ids come first and in their old order, so the tracker's first five chips do not move");

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

  // a save from before the fourth prong: five endings, all kept, 5 of 7
  storage.setItem(SAVE_KEY, JSON.stringify({ seenEndings: [...OLD_ENDINGS], __v: SAVE_VERSION }));
  const before958 = slot.load();
  ok(before958 && JSON.stringify(before958.seenEndings) === JSON.stringify(OLD_ENDINGS), "a save holding the five old endings loads with all five, in order");
  if (PRONG_WIRED) {
    before958.seenEndings.push(...SEAM_ENDINGS);
    slot.save(before958);
    ok(slot.load().seenEndings.length === 7, "the seam's two endings are saved and survive repair()");
  }

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
