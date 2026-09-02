// commonpath.js — how far you walk before you have a choice.
//
// Phase 41. The common path of egress travel is the part of the way out that
// everybody in a room has to take: measured from the most remote point of the
// room to the point where a person first has separate and distinct access to
// two exits. Past that point a fire at one door is a walk to the other; before
// it, the one route is the only route. IBC Table 1006.2.1 holds a Group E
// space to 75ft of it, and until this phase that number was a constant in
// egress.js that "nothing measures" — the backlog's own words.
//
// **Measured on the graph, as two paths that share nothing.** A point has two
// separate ways out when there are two routes from it to two different exits
// that pass through no doorway, stair or lift in common — node-disjoint paths
// in the graph navgraph.js already builds, which is Menger's theorem asked as
// a two-unit flow. Open floor is not a constraint: a gate is the midpoint of a
// seam between two tiles of one room, and two people can cross a seam a yard
// apart, so a room node and a gate node carry as many paths as want them and
// only the one-body-wide things — a portal, a link — are capacity one. That
// reading is the strict one: two doors out of a classroom into a corridor
// with one way off it are two doorways and not two ways out, and the common
// path runs on down the corridor to wherever the ways actually part.
//
// Then, from every corner of every room, a Dijkstra out over real feet that
// stops at the first node with two ways out — or at an exit, because a walk
// that reaches the door without ever having had a choice was common the whole
// way. The room's common path is the longest of its corners' walks.
//
// The two-path test is the expensive half and is asked once per node, kept in
// a memo the whole analysis shares; the walk from a corner stops at the first
// hit, so a school with doors at both ends of every corridor asks it of a
// handful of nodes per room.
//
// Pure module: no three.js, no DOM. Exercised by test/commonpath.test.mjs.

import { MinHeap } from './heap.js';
import { outdoors } from './navgraph.js';
import { tileFor } from './navmesh.js';

// Nodes a way out may pass through: anything inside the building. The
// outdoors is where a way out *ends* — the same rule `egressField` keeps.
const inside = (nav, id) => !!id && id !== nav.outside && !outdoors(nav, id) && nav.nodes.has(id);

// The things one body passes through at a time. Everything else on the graph
// is a point on open floor, and open floor carries a crowd.
const narrow = (n) => !!n && (n.kind === 'portal' || n.kind === 'link');

// ---------- two ways out ----------

// Are there two node-disjoint routes from a source to two distinct exits?
// `starts` are the nodes the source is directly joined to (a point's tile
// anchors, or a node's neighbours); `opts.exclude` is a set of node ids no
// route may use, which is how a node asks about itself without walking back
// through itself.
//
// Unit-capacity max-flow with node splitting, run to a flow of two: every
// node `v` is `v|i` → `v|o` at capacity one when it is narrow and unbounded
// when it is open floor; every graph edge is capacity one each way; the
// source feeds each start once and every exit drains once into the sink.
// Two BFS augmentations at most, each over the residual graph.
export function twoWaysOut(nav, starts, opts = {}) {
  if (!nav || !nav.exits || nav.exits.length < 2 || !starts || !starts.length) return false;
  const exclude = opts.exclude || null;
  const isExit = new Set(nav.exits.map((e) => e.id));
  const ok = (id) => inside(nav, id) && !(exclude && exclude.has(id));
  const from = [...new Set(starts)].filter(ok);
  if (from.length < 1) return false;

  const nodeFlow = new Map();   // v → units through v
  const edgeFlow = new Set();   // "a>b" — a unit a → b
  const srcFlow = new Set();    // starts the source has used
  const sinkFlow = new Set();   // exits drained into the sink

  const augment = () => {
    const prev = new Map([['S', null]]);
    const queue = ['S'];
    let head = 0;
    const push = (cur, next) => {
      if (prev.has(next)) return;
      prev.set(next, cur);
      queue.push(next);
    };
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur === 'T') break;
      if (cur === 'S') {
        for (const v of from) if (!srcFlow.has(v)) push(cur, `${v}|i`);
        continue;
      }
      const bar = cur.lastIndexOf('|');
      const id = cur.slice(0, bar);
      const side = cur.slice(bar + 1);
      if (side === 'i') {
        // Forward through the node while it has room; backward along any edge
        // carrying flow *into* it, which cancels that unit.
        if (!narrow(nav.nodes.get(id)) || !(nodeFlow.get(id) > 0)) push(cur, `${id}|o`);
        for (const e of nav.adj.get(id) || []) {
          if (edgeFlow.has(`${e.to}>${id}`)) push(cur, `${e.to}|o`);
        }
      } else {
        if (isExit.has(id) && !sinkFlow.has(id)) push(cur, 'T');
        for (const e of nav.adj.get(id) || []) {
          if (ok(e.to) && !edgeFlow.has(`${id}>${e.to}`)) push(cur, `${e.to}|i`);
        }
        // Backward through the node cancels a unit that went through it.
        if (nodeFlow.get(id) > 0) push(cur, `${id}|i`);
      }
    }
    if (!prev.has('T')) return false;
    // Apply the path, sink back to source.
    let at = 'T';
    while (at !== 'S') {
      const back = prev.get(at);
      apply(back, at);
      at = back;
    }
    return true;
  };

  const apply = (a, b) => {
    if (a === 'S') { srcFlow.add(b.slice(0, b.lastIndexOf('|'))); return; }
    if (b === 'T') { sinkFlow.add(a.slice(0, a.lastIndexOf('|'))); return; }
    const ab = a.lastIndexOf('|'), bb = b.lastIndexOf('|');
    const ia = a.slice(0, ab), sa = a.slice(ab + 1);
    const ib = b.slice(0, bb), sb = b.slice(bb + 1);
    if (ia === ib) {
      // Through the node, or back through it.
      if (sa === 'i' && sb === 'o') nodeFlow.set(ia, (nodeFlow.get(ia) || 0) + 1);
      else nodeFlow.set(ia, (nodeFlow.get(ia) || 0) - 1);
      return;
    }
    if (sa === 'o' && sb === 'i') {
      // Forward along an edge — or, if the other way already carries a unit,
      // the two cancel rather than pass each other.
      if (edgeFlow.has(`${ib}>${ia}`)) edgeFlow.delete(`${ib}>${ia}`);
      else edgeFlow.add(`${ia}>${ib}`);
      return;
    }
    // sa === 'i' && sb === 'o': backward along an edge that carried b → a.
    edgeFlow.delete(`${ib}>${ia}`);
  };

  if (!augment()) return false;
  return augment();
}

// Does a *node* have two ways out — not counting any route back through
// itself? Memoised per analysis: the answer is a property of the graph, and
// every corner of every room downstream of the node asks it.
export function splitsAt(nav, id, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  let out = false;
  if (inside(nav, id)) {
    const next = (nav.adj.get(id) || []).map((e) => e.to).filter((n) => inside(nav, n));
    // One neighbour is a corridor with one end; nothing to part at.
    if (new Set(next).size >= 2) out = twoWaysOut(nav, next, { exclude: new Set([id]) });
  }
  memo.set(id, out);
  return out;
}

// ---------- the walk from a point ----------

// From a point on the floor to the nearest place that has two ways out, in
// feet walked. `known` is the room the point belongs to when the caller has
// it — a room's own corner sits on its boundary, and asking which side of
// itself a vertex is on has no answer worth having (see `pointField`).
//
// Returns `{ dist, at, exit }`: `at` the node the choice appears at (null
// when the point itself has it), `exit` true when the walk reached an exit
// without ever having had one — the whole way was common. Null for a point
// with no way out at all, which is a different finding and already made.
export function commonPathFrom(nav, floorIndex, x, z, known = null, memo = new Map()) {
  if (!nav || !nav.exits || !nav.exits.length) return null;
  const roomId = known || nav.roomIdAt(floorIndex, x, z);
  if (!roomId) return null;
  const found = nav.mesh[floorIndex] ? tileFor(nav.mesh[floorIndex], roomId, x, z) : null;
  if (!found) return null;
  const anchors = found.tile.anchors;
  // A point with two doors in sight has its choice where it stands.
  if (twoWaysOut(nav, anchors.map((a) => a.id))) return { dist: 0, at: null, exit: false };

  const isExit = new Set(nav.exits.map((e) => e.id));
  const dist = new Map();
  const open = new MinHeap();
  for (const a of anchors) {
    if (!inside(nav, a.id)) continue;
    // Real feet: the straight line across the tile, plus a stair's run where
    // the anchor is the head of one (`span`, the metric charge).
    const d = Math.hypot(a.x - x, a.z - z) + (a.span || 0);
    if (d < (dist.get(a.id) ?? Infinity)) {
      dist.set(a.id, d);
      open.push({ id: a.id, d }, d);
    }
  }
  const done = new Set();
  while (open.size) {
    const cur = open.pop();
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    if (isExit.has(cur.id)) return { dist: cur.d, at: cur.id, exit: true };
    if (splitsAt(nav, cur.id, memo)) return { dist: cur.d, at: cur.id, exit: false };
    for (const e of nav.adj.get(cur.id) || []) {
      if (!inside(nav, e.to)) continue;
      const d = cur.d + e.dist;
      if (d >= (dist.get(e.to) ?? Infinity)) continue;
      dist.set(e.to, d);
      open.push({ id: e.to, d }, d);
    }
  }
  return null;
}

// ---------- per room ----------

// One room's common path: the longest of its corners' walks to a choice.
// `samples` is egress.js's `roomSamples` — every corner of the outline — so
// the most remote point is the same most remote point travel distance uses.
export function commonPathOf(nav, samples, room, memo = new Map()) {
  const pts = samples.get(room.id) || [];
  let worst = null;
  for (const p of pts) {
    const r = commonPathFrom(nav, room.floor, p.x, p.z, room.id, memo);
    if (!r) continue;
    if (!worst || r.dist > worst.dist) worst = { ...r, x: p.x, z: p.z };
  }
  return worst;
}

// Every room, measured, worst first. `limit` is the edition's number for the
// occupancy; a row is `over` when its walk to a choice is past it. A room
// the field never reached has no row here — "unreachable" is its finding.
export function commonPathAnalysis(nav, opts = {}) {
  const samples = opts.samples;
  const limit = Number.isFinite(opts.limit) ? opts.limit : Infinity;
  const memo = opts.memo || new Map();
  const rows = [];
  for (const room of nav.rooms) {
    const r = commonPathOf(nav, samples, room, memo);
    if (!r) continue;
    const at = r.at ? nav.nodes.get(r.at) : null;
    rows.push({
      id: room.id,
      floor: room.floor,
      name: room.name || null,
      common: r.dist,
      limit,
      over: r.dist > limit,
      // Where the ways part: the doorway, the corridor point, or the exit
      // itself when the whole walk was common. Carried as a point so a plan
      // can mark it.
      at: at ? { id: at.id, kind: at.kind, x: at.x, z: at.z, floor: at.floor ?? room.floor } : null,
      toExit: !!r.exit,
      x: r.x, z: r.z,
    });
  }
  rows.sort((a, b) => b.common - a.common);
  return {
    rows,
    summary: {
      limit,
      rooms: rows.length,
      over: rows.filter((r) => r.over).length,
      worst: rows[0] || null,
      // How many rooms have no choice at all before the door — a single-exit
      // wing reads as every room in it.
      toExit: rows.filter((r) => r.toExit).length,
    },
  };
}
