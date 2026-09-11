// graph.mjs — the story as a graph, walked with no browser.
//
//   node Projects/daredevil/test/graph.mjs            # the report; exits 1 on a finding
//   import { buildGraph, walk, walkWithRels } from './graph.mjs'
//
// Phase 5 (see WISHLIST.md). Four transcripts prove four paths exist and
// smoke-page.mjs proves every `goto`/`next` target is *routable* — that
// goToScene() will answer it. Neither says whether anything *names* a scene.
// That is how three procedural routes and two finished scenes were unreachable
// under a green suite, and how the one orphaned scene in the file took three
// rounds and a static grep to find. This walks every edge the game has and
// says what is on the far side of none of them.
//
// WHERE THE EDGES COME FROM
//
//   - SCENES, as data: `next`, `choices[].goto`, and the string literals in a
//     `_gateRoute` closure's source (two today, both naming one scene).
//   - engine.js, as text: goToScene()'s `if(id === '_x'){ ... }` blocks. Each
//     block's edges are every quoted literal in it that is a scene id or a
//     route id, plus the body of any handler a `launchMinigame(..., handler)`
//     call names, plus a route table's scenes when the block calls
//     `routeByCast(TABLE, ...)`. The four hub renderers are read the same way
//     for their card ids and their milestone buttons.
//   - A scene with neither `next` nor `choices` falls through afterScene() to
//     currentHubRoute(), which is one of the four hubs; the graph gives it all
//     four.
//
// Reading the engine as text is an over-approximation on purpose: a literal
// behind an `if` the tool cannot evaluate is still an edge. That direction
// never reports a false orphan — it can only miss one — and the relationship
// walk below is exact wherever Phase 3 put the relationship logic into data.
//
// THE RELATIONSHIP WALK
//
// `walkWithRels` searches (scene, relationship bag) pairs from the cold open
// with a fresh bag. A choice or a hub card with `_needs` is taken only when
// the bag meets it; a route-table block answers exactly what routeByCast()
// would; a choice's `effects.rels` and a scene's `statUpdate.rels` move the
// bag. Flags and stats are not modelled — a gate on one is treated as open,
// both ways — so a scene the walk never reaches is one no relationship state
// can reach, whatever the flags do. That is the question the row asked.
//
// Exits non-zero on any finding (locked decision #13). smoke-save.mjs imports
// this and asserts the same things, so the report costs nothing extra.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENES, M3_PRESTUNT_ROUTES, M3_PRESTUNT_FALLBACK, M4_PRESTUNT_ROUTES, M4_PRESTUNT_FALLBACK, M5_QUESTION_ROUTES, M5_QUESTION_FALLBACK } from '../js/scenes.js';
import { CAST, startingRels, meetsNeeds, routeByCast, statesOf, presentStates } from '../js/cast.js';

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

export const ROOT = 'cold_open_01';
const HUBS = ['_hub_fr1', '_hub_fr2', '_hub_fr3', '_hub_fr4'];
const ROUTE_TABLES = {
  M3_PRESTUNT_ROUTES: [M3_PRESTUNT_ROUTES, M3_PRESTUNT_FALLBACK],
  M4_PRESTUNT_ROUTES: [M4_PRESTUNT_ROUTES, M4_PRESTUNT_FALLBACK],
  M5_QUESTION_ROUTES: [M5_QUESTION_ROUTES, M5_QUESTION_FALLBACK],
};

/* ------------------------------------------------------------ text tools */

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The text of the `{...}` whose opening brace is at `open`. */
function braceBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  throw new Error(`graph: unbalanced braces from ${open}`);
}

/** The body of `function name(`. */
function fnBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) throw new Error(`graph: no function ${name} in engine.js`);
  return braceBody(src, m.index + m[0].length - 1);
}

/** Every quoted literal in a stretch of source that is a scene id or a route id. */
function idsIn(text, known) {
  const out = new Set();
  for (const m of text.matchAll(/'([A-Za-z_][\w]*)'/g)) if (known.has(m[1]) || m[1].startsWith('_')) out.add(m[1]);
  return out;
}

/* ------------------------------------------------------------- the graph */

/**
 * Build the graph. Returns { nodes, edges, cards, routes, blocks, lists }:
 *   nodes   every scene id and every `_` route id goToScene handles
 *   edges   Map from id → [{ to, needs?, rels?, via }]
 *   routes  the `_` ids goToScene handles
 *   named   the `_` ids something names
 *   cards   Map hub → [{ id, needs }] (what the walk needs to gate a card)
 *   tables  Map route id → table name, for the blocks that call routeByCast
 */
export function buildGraph() {
  const engine = strip(fs.readFileSync(path.join(JS, 'engine.js'), 'utf8'));
  const known = new Set(Object.keys(SCENES));
  const edges = new Map();
  const add = (from, to, extra = {}) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push({ to, ...extra });
  };

  // 1. The story as data.
  for (const [id, sc] of Object.entries(SCENES)) {
    edges.set(id, edges.get(id) || []);
    const choices = sc.choices || [];
    for (const ch of choices) if (ch.goto) add(id, ch.goto, { needs: ch._needs, rels: ch.effects && ch.effects.rels, via: 'choice' });
    if (sc.next) add(id, sc.next, { via: 'next' });
    else if (choices.length === 0) for (const h of HUBS) add(id, h, { via: 'afterScene default' });
    if (typeof sc._gateRoute === 'function') for (const t of idsIn(sc._gateRoute.toString(), known)) add(id, t, { via: '_gateRoute' });
  }

  // 2. goToScene's procedural routes, block by block.
  const go = fnBody(engine, 'goToScene');
  const routes = [];
  const tables = new Map();
  for (const m of go.matchAll(/if\s*\(\s*id\s*===\s*'(_[\w]+)'\s*\)\s*\{/g)) {
    const id = m[1];
    routes.push(id);
    edges.set(id, edges.get(id) || []);
    let body = braceBody(go, m.index + m[0].length - 1);
    // A named minigame handler is part of the block: its body is where the
    // outcome scenes are.
    for (const h of body.matchAll(/launchMinigame\([^)]*?,\s*([A-Za-z_]\w*)\s*\)/g)) body += '\n' + fnBody(engine, h[1]);
    const table = /routeByCast\(\s*([A-Z_0-9]+)/.exec(body);
    if (table) {
      if (!ROUTE_TABLES[table[1]]) throw new Error(`graph: ${id} routes by ${table[1]}, which this tool does not import`);
      tables.set(id, table[1]);
      const [rows, fallback] = ROUTE_TABLES[table[1]];
      for (const r of rows) add(id, r.scene, { via: table[1] });
      add(id, fallback, { via: table[1] + ' fallback' });
    }
    for (const t of idsIn(body, known)) if (t !== id && !(table && [...edges.get(id)].some(e => e.to === t))) add(id, t, { via: 'engine literal' });
  }

  // 3. The four hubs: card ids and milestone buttons out of each renderer.
  const cards = new Map();
  const lists = relLists(engine);
  for (const [hub, fn] of [['_hub_fr1', 'renderHubFR1'], ['_hub_fr2', 'renderHubFR2'], ['_hub_fr3', 'renderHubFR3'], ['_hub_fr4', 'renderHubFR4']]) {
    const body = fnBody(engine, fn);
    edges.set(hub, edges.get(hub) || []);
    const seen = new Set();
    const hubCards = [];
    for (const m of body.matchAll(/\{\s*id\s*:\s*'([\w]+)'/g)) {
      const obj = braceBody(body, m.index);
      const id = m[1];
      const needs = parseNeeds(obj, lists, id);
      hubCards.push({ id, needs });
      if (!seen.has(id)) { seen.add(id); add(hub, id, { via: 'hub card', needs }); }
    }
    for (const m of body.matchAll(/goToScene\('([\w]+)'\)/g)) if (!seen.has(m[1])) { seen.add(m[1]); add(hub, m[1], { via: 'hub button' }); }
    cards.set(hub, hubCards);
  }

  const nodes = new Set([...known, ...routes]);
  const named = new Set();
  for (const list of edges.values()) for (const e of list) if (e.to.startsWith('_')) named.add(e.to);
  return { nodes, edges, routes, named, cards, tables, known };
}

/** `const NAME = statesOf('id', { not: [...] })` / `presentStates('id')` in engine.js, evaluated. */
function relLists(engine) {
  const lists = {};
  for (const m of engine.matchAll(/const\s+([A-Z_0-9]+)\s*=\s*(statesOf|presentStates)\('(\w+)'(?:\s*,\s*\{\s*not\s*:\s*\[([^\]]*)\]\s*\})?\)/g)) {
    const not = m[4] ? [...m[4].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
    lists[m[1]] = m[2] === 'statesOf' ? statesOf(m[3], { not }) : presentStates(m[3]);
  }
  return lists;
}

/** A hub card's `_needs:{ who: LIST }` as data, or undefined. */
function parseNeeds(obj, lists, id) {
  const m = /_needs\s*:\s*\{([^}]*)\}/.exec(obj);
  if (!m) return undefined;
  const needs = {};
  for (const pair of m[1].matchAll(/(\w+)\s*:\s*([A-Z_0-9]+|\[[^\]]*\])/g)) {
    if (pair[2].startsWith('[')) needs[pair[1]] = [...pair[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
    else if (lists[pair[2]]) needs[pair[1]] = lists[pair[2]];
    else throw new Error(`graph: hub card ${id} needs ${pair[2]}, which is not a statesOf/presentStates constant`);
  }
  return needs;
}

/* -------------------------------------------------------------- the walks */

/** Plain reachability from the root over every edge, gates ignored. */
export function walk(g, root = ROOT) {
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const n = queue.shift();
    for (const e of g.edges.get(n) || []) if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  return seen;
}

const key = rels => CAST.map(c => rels[c.id]).join('|');

/**
 * Reachability over (scene, relationship bag). Returns { scenes: Set, states:
 * number, bags: Map scene → Set of bag keys }. Gates on flags and stats are
 * open; gates on relationships are exact.
 */
export function walkWithRels(g, root = ROOT) {
  const start = startingRels();
  const seen = new Set();
  const bags = new Map();
  const queue = [[root, start]];
  const push = (id, rels) => {
    const k = id + '#' + key(rels);
    if (seen.has(k)) return;
    seen.add(k);
    (bags.get(id) || bags.set(id, new Set()).get(id)).add(key(rels));
    queue.push([id, rels]);
  };
  push(root, start);
  while (queue.length) {
    const [id, rels] = queue.shift();
    const sc = SCENES[id];
    // Entering a scene applies its statUpdate.rels before anything else.
    let here = rels;
    if (sc && sc.statUpdate && sc.statUpdate.rels && Object.keys(sc.statUpdate.rels).length) here = { ...rels, ...sc.statUpdate.rels };
    if (here !== rels) { const k = id + '#' + key(here); if (!seen.has(k)) { seen.add(k); bags.get(id).add(key(here)); } }
    const table = g.tables.get(id);
    if (table) {
      // Exact: what routeByCast answers for this bag. `_m5_question_route`
      // also lets Cal ask first when a flag says he already did; the flag is
      // open here, so his row is taken too when his state allows it.
      const [rows, fallback] = ROUTE_TABLES[table];
      push(routeByCast(rows, here, fallback), here);
      if (id === '_m5_question_route') { const cal = rows.find(r => r.who === 'cal'); if (cal && cal.states.includes(here.cal)) push(cal.scene, here); }
      for (const e of g.edges.get(id) || []) if (e.via === 'engine literal') push(e.to, here);
      continue;
    }
    for (const e of g.edges.get(id) || []) {
      if (e.needs && !meetsNeeds(e.needs, here)) continue;
      push(e.to, e.rels ? { ...here, ...e.rels } : here);
    }
  }
  return { scenes: new Set(bags.keys()), states: seen.size, bags };
}

/* ------------------------------------------------------------- findings */

/**
 * Scenes the relationship walk cannot reach, frozen the way flags.mjs freezes
 * its write-only list (#264): the list can shrink, a new name fails, and a
 * name that has since found a path fails too. One entry today, and it is the
 * first thing the walk found: `m5_question_earl` is Milestone 5's question
 * asked by Earl, behind the table's `earl: mentor` row — and the only way to
 * `earl: 'mentor'` is "I want Cal in the room" on `fr3_eve_earl`, whose
 * choice writes `cal: 'loyal'` and whose target, `fr3_eve_earl_cal`, writes
 * it again. Cal's row is above Earl's and nothing after Milestone 1 moves
 * Cal off loyal, so every run in which Earl could ask has Cal asking
 * instead. A written scene, a labelled route row, and no bag of
 * relationships that reaches it. Fixing it is a story call (who asks, or a
 * second way to a mentor) and is on WISHLIST.md. Removing only one of the
 * two Cal writes leaves it unreachable, which the break-on-purpose run
 * confirmed; removing both makes this entry stale and fails the suite.
 */
export const UNREACHABLE_BY_RELS = ['m5_question_earl'];

/** Everything the report asserts, as data, so a suite can assert it too. */
export function findings(g = buildGraph()) {
  const plain = walk(g);
  const withRels = walkWithRels(g);
  const orphans = [...g.known].filter(id => !plain.has(id)).sort();
  const unnamedRoutes = g.routes.filter(r => !g.named.has(r)).sort();
  const unrouted = [];
  for (const [from, list] of g.edges) for (const e of list) if (!g.nodes.has(e.to)) unrouted.push(`${from} → ${e.to}`);
  const noRels = [...plain].filter(id => g.known.has(id) && !withRels.scenes.has(id)).sort();
  const noHub = [];   // a scene relying on afterScene's default, listed so the number is known
  for (const [id, sc] of Object.entries(SCENES)) if (!sc.next && !(sc.choices || []).length) noHub.push(id);
  return { g, plain, withRels, orphans, unnamedRoutes, unrouted: [...new Set(unrouted)].sort(), noRels, noHub };
}

/* ------------------------------------------------------------------- cli */

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const f = findings();
  const { g } = f;
  let fail = 0;
  const line = (cond, what) => { if (cond) console.log('  ok   ' + what); else { fail++; console.error('  FAIL ' + what); } };
  console.log(`\n  ${g.known.size} scenes, ${g.routes.length} procedural routes, ${[...g.edges.values()].reduce((n, l) => n + l.length, 0)} edges`);
  console.log(`  plain walk reaches ${[...f.plain].filter(id => g.known.has(id)).length} scenes; relationship walk reaches ${[...f.withRels.scenes].filter(id => g.known.has(id)).length} scenes over ${f.withRels.states} (scene, bag) states`);
  console.log(`  ${f.noHub.length} scenes fall through to the current hub (no next, no choices)\n`);
  line(f.unrouted.length === 0, `every edge lands on a scene or a handled route (unrouted: ${f.unrouted.join(', ') || 'none'})`);
  line(f.orphans.length === 0, `every scene is reachable from the cold open (orphans: ${f.orphans.join(', ') || 'none'})`);
  line(f.unnamedRoutes.length === 0, `every route goToScene handles is named by something (dead routes: ${f.unnamedRoutes.join(', ') || 'none'})`);
  const newNoRels = f.noRels.filter(id => !UNREACHABLE_BY_RELS.includes(id));
  const staleNoRels = UNREACHABLE_BY_RELS.filter(id => !f.noRels.includes(id));
  line(newNoRels.length === 0, `every reachable scene is reachable under some relationship state, or is on the frozen list (under none: ${newNoRels.join(', ') || 'none'})`);
  line(staleNoRels.length === 0, `every scene on the frozen list is still reachable under no relationship state (stale: ${staleNoRels.join(', ') || 'none'})`);
  console.log(`\n  ${fail ? fail + ' finding(s)' : 'no findings'}`);
  process.exit(fail ? 1 : 0);
}
