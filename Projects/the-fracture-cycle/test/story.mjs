// test/story.mjs — the story as the page ships it, and the walker that plays
// every path of it. One copy, read by both suites: smoke.mjs (pure Node) and
// browser.mjs (the real page). It was smoke.mjs's own code until the page
// suite needed the same paths; a second walker would have been a second
// opinion about what the game does (#34).
//
// Nothing here restructures the page. The inline `initialState` and `nodes`
// literals are read out of the shipped HTML as text and eval'd, the technique
// Torchbearer's smoke test uses for its inline packs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAME_DIR = path.join(HERE, "..");
export const PAGE = path.join(GAME_DIR, "..", "the-fracture-cycle.html");

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
export function extractBalanced(src, start) {
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

export function literalAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const start = src.indexOf("{", at);
  return extractBalanced(src, start);
}

export const cloneState = s => JSON.parse(JSON.stringify(s));

/**
 * The story in `html` (the shipped page unless a caller hands in a doctored
 * copy). `nodes`'s effect and choices functions close over `state`, `hasFrag`
 * and `addFrag` exactly as they do in the page: all three are declared in this
 * scope before the literal is eval'd, so the closures resolve them. `use(s)`
 * is how a caller says which state a `choices()` call reads.
 */
export function loadStory(html = fs.readFileSync(PAGE, "utf8")) {
  const initialStateSrc = literalAfter(html, "const initialState = () => (");
  const nodesSrc = literalAfter(html, "const nodes = {");

  let state;
  function hasFrag(f) { return state.fragments.includes(f); }
  function addFrag(f) { if (!hasFrag(f)) state.fragments.push(f); }
  // eslint-disable-next-line no-eval
  const initialState = () => eval("(" + initialStateSrc + ")");
  // eslint-disable-next-line no-eval
  const nodes = eval("(" + nodesSrc + ")");
  const use = s => { state = s; };

  const optionsFor = node => (typeof node.choices === "function" ? node.choices() : node.choices);

  // What the page's render() shows for a node in a given state. The one
  // substitution is the page's own line; smoke.mjs asserts it as text so this
  // copy cannot drift from it unseen.
  const shown = (node, s) =>
    (node.dynamic ? node.text.replace("${fragCount}", String(s.fragments.length)) : node.text);

  /**
   * Every complete path from `intro` to an ending, each walked on its own (no
   * memo). `steps` is what a player saw and did and is what smoke.mjs hashes,
   * so its shape does not change; `picks` (the index of the choice taken at
   * each step) and `lists` (every choice offered at each step, the seam's
   * entrance included) ride beside it for a driver that has to click.
   */
  function enumerate(depthCap = 40) {
    const paths = [];
    const deadEnds = [];
    (function go(id, curState, steps, picks, lists) {
      const node = nodes[id];
      if (!node) { deadEnds.push(`"${id}" is not a node`); return; }
      if (node.ending) {
        paths.push({ steps: [...steps, { id, title: node.title, text: shown(node, curState) }], end: id, state: curState, picks, lists });
        return;
      }
      if (steps.length >= depthCap) { deadEnds.push(`${id}: no ending within ${depthCap} steps`); return; }
      state = curState;
      let opts;
      // a node shown to a state it was not written for is a dead end, said by name
      try { opts = optionsFor(node); } catch (e) { deadEnds.push(`${id}: choices() threw (${e.message}) with ${JSON.stringify(curState)}`); return; }
      if (!opts.length) { deadEnds.push(`${id}: no choice offered with ${JSON.stringify(curState)}`); return; }
      // The seam's entrance is the one thing an old path is allowed to see that
      // it did not see before, and it is left out of what is compared here only.
      const offered = opts.filter(o => !(id === "intro" && o.next === "seam_walk"))
        .map(o => (o.mark || "") + "|" + o.label + "|" + o.next);
      const list = opts.map(o => ({ mark: o.mark || "", label: o.label, next: o.next }));
      opts.forEach((opt, i) => {
        const branchState = cloneState(curState);
        state = branchState;
        try { if (opt.effect) opt.effect(branchState); }
        catch (e) { deadEnds.push(`${id}: the effect of "${opt.label}" threw (${e.message})`); return; }
        go(opt.next, branchState, [...steps, {
          id, title: node.title, text: shown(node, curState), offered, took: opt.label, after: JSON.stringify(branchState),
        }], [...picks, i], [...lists, list]);
        state = curState;
      });
    })("intro", initialState(), [], [], []);
    return { paths, deadEnds };
  }

  return { initialStateSrc, nodesSrc, initialState, nodes, use, optionsFor, shown, enumerate };
}
