// designdiff.js — what changed between two designs, as sentences and as marks.
//
// Phase 34. The file remembers everything and can answer nothing: autosave
// holds exactly one past, undo holds one session's, and the question every
// real project asks — *what changed since Tuesday* — had no answer anywhere
// in the tool. This is the answer's arithmetic: two designs in, and out come
// sentences a person can read ("Room 204 appeared — 640 ft², Level 2";
// "Main Hall grew from 1,200 to 1,480 ft²"; "a stair was added between
// Level 1 and Level 2") and a set of *marks* the sheet can paint — added in
// green, removed in red, changed in amber — each in world feet on the storey
// it belongs to.
//
// What it compares, and how it matches:
//
//   rooms     by id (Phase 12 gave every room one, and an edit keeps it),
//             then by name for the ones left over on both sides — a room
//             erased and redrawn under the same name is one room that
//             changed, not two events. A matched room is *changed* when its
//             name, outline, area, finish, use or openings differ.
//   walls     free-standing walls, by id; endpoints and kind.
//   props     by id; type, storey and position.
//   links     stairs, ramps and lifts, by id; type, storeys and position.
//   regions   the site's, by id; outline, surface and marking.
//   storeys   added or removed outright, and the sheet's size.
//   records   the design-wide ones — sky, roof, ground, code, life, school
//             day, rates, phasing, weather, grid reference, sections, the
//             tracing image, the models, the tours — each one sentence when
//             it differs, because "the roof changed" is a thing worth
//             reading even when no room did.
//
// Everything in `sentences` is derived from `changes`; everything in `marks`
// is too. A caller wanting a headline composes it from `summary`. Inputs are
// designs as `deserialize` returns them or as `JSON.parse(serialize())`
// gives them — this reads only what both shapes carry.
//
// Pure module: no DOM, no three.js. Exercised by test/designdiff.test.mjs.

import { shapesOf, shapeArea, ringCentroid, isWindowOpening } from './shapes.js';
import { floorLabel } from './grid.js';
import { wallLinesOf } from './wallrun.js';
import { regionArea } from './site.js';
import { same } from './history.js';

export const CHANGES = ['added', 'removed', 'changed'];

// The design-wide records, and the sentence each one earns when it differs.
export const RECORD_SENTENCES = {
  env: 'The sun and sky settings changed.',
  roof: 'The roof changed.',
  terrain: 'The ground was regraded.',
  code: 'The code settings changed.',
  life: 'The population settings changed.',
  timetable: 'The school day changed.',
  rates: 'The rate table changed.',
  phasing: 'The phasing plan changed.',
  weather: 'The weather changed.',
  gridRef: 'The grid reference point moved.',
  sections: 'The drawn section lines changed.',
  overlay: 'The tracing image changed.',
  models: 'The imported model library changed.',
  tours: 'The recorded tours changed.',
};

// Below this, a room has not "grown" or "shrunk": a bake can move an outline
// by a hair and an area by a square inch without anybody having done a thing.
const AREA_EPS_FT2 = 4;
const AREA_EPS_FRAC = 0.01;
const MOVE_EPS_FT = 0.5;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const ft = (n) => Math.round(n).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const a = (n, one, many) => (n === 1 ? `a ${one}` : plural(n, one, many));

const floorsOf = (d) => (d && Array.isArray(d.floors) ? d.floors : []);
const propsOf = (d) => (d && Array.isArray(d.props) ? d.props : []);
const linksOf = (d) => (d && Array.isArray(d.links) ? d.links : []);
const regionsIn = (d) => (d && d.site && Array.isArray(d.site.regions) ? d.site.regions : []);
const outerPts = (shape) => (shape && shape.rings && shape.rings[0] ? shape.rings[0].pts : []);
const roomName = (shape) => (shape && shape.name ? shape.name : 'an unnamed room');
const copyPts = (pts) => (pts || []).map((p) => ({ x: p.x, z: p.z }));

// The doors and windows on a room's own rings, by kind. Half the rooms in a
// real plan carry none of their own (the corridor holds the shared wall's),
// so this counts what the *record* says rather than what a walker meets;
// a door that moved from one side of a partition to the other reads as one
// lost and one gained, which is what the file says happened.
function openingCounts(shape) {
  const out = { doors: 0, windows: 0 };
  for (const ring of (shape && shape.rings) || []) {
    for (const o of ring.openings || []) {
      if (isWindowOpening(o)) out.windows += 1; else out.doors += 1;
    }
  }
  return out;
}

const byId = (list) => {
  const m = new Map();
  for (const x of list) if (x && Number.isFinite(x.id)) m.set(x.id, x);
  return m;
};

// ---------- rooms ----------

function compareRoom(before, after, floor) {
  const whats = [];
  const areaA = shapeArea(before), areaB = shapeArea(after);
  const dArea = areaB - areaA;
  if (before.name !== after.name) whats.push(`renamed from ${roomName(before)} to ${roomName(after)}`);
  if (Math.abs(dArea) > Math.max(AREA_EPS_FT2, AREA_EPS_FRAC * Math.max(areaA, areaB))) {
    whats.push(`${dArea > 0 ? 'grew' : 'shrank'} from ${ft(areaA)} to ${ft(areaB)} ft²`);
  } else {
    const ca = ringCentroid(outerPts(before)), cb = ringCentroid(outerPts(after));
    const moved = ca && cb ? Math.hypot(cb.x - ca.x, cb.z - ca.z) : 0;
    if (moved > MOVE_EPS_FT) whats.push(`moved ${ft(moved)} ft`);
    else if (!same(copyPts(outerPts(before)), copyPts(outerPts(after)))) whats.push('was redrawn');
  }
  const oa = openingCounts(before), ob = openingCounts(after);
  if (ob.doors > oa.doors) whats.push(`gained ${a(ob.doors - oa.doors, 'door')}`);
  if (ob.doors < oa.doors) whats.push(`lost ${a(oa.doors - ob.doors, 'door')}`);
  if (ob.windows > oa.windows) whats.push(`gained ${a(ob.windows - oa.windows, 'window')}`);
  if (ob.windows < oa.windows) whats.push(`lost ${a(oa.windows - ob.windows, 'window')}`);
  if ((before.fin || null) !== (after.fin || null) || (before.paint || null) !== (after.paint || null)) {
    whats.push('was refinished');
  }
  if ((before.group || null) !== (after.group || null) || (before.load || null) !== (after.load || null)) {
    whats.push('changed its use or occupant load');
  }
  if (!whats.length) return null;
  return {
    kind: 'room', change: 'changed', floor, id: after.id, name: roomName(after), whats,
    sentence: `${roomName(after)} ${whats.join(', ')} (${floorLabel(floor)}).`,
    mark: { floor, kind: 'room', change: 'changed', pts: copyPts(outerPts(after)), was: copyPts(outerPts(before)), label: roomName(after) },
  };
}

function diffRooms(fa, fb, floor, out) {
  const A = byId(shapesOf(fa)), B = byId(shapesOf(fb));
  const leftA = [], leftB = [];
  for (const [id, sa] of A) {
    const sb = B.get(id);
    if (!sb) { leftA.push(sa); continue; }
    const c = compareRoom(sa, sb, floor);
    if (c) out.push(c);
  }
  for (const [id, sb] of B) if (!A.has(id)) leftB.push(sb);
  // Second pass: a name that is on exactly one unmatched room each side is
  // the same room, redrawn.
  const nameA = new Map(), nameB = new Map();
  for (const s of leftA) if (s.name) nameA.set(s.name, nameA.has(s.name) ? null : s);
  for (const s of leftB) if (s.name) nameB.set(s.name, nameB.has(s.name) ? null : s);
  const paired = new Set();
  for (const [name, sa] of nameA) {
    const sb = nameB.get(name);
    if (!sa || !sb) continue;
    paired.add(sa); paired.add(sb);
    // A new id and nothing else is not a change anybody drew.
    const c = compareRoom(sa, sb, floor);
    if (c) out.push(c);
  }
  for (const s of leftA) {
    if (paired.has(s)) continue;
    out.push({
      kind: 'room', change: 'removed', floor, id: s.id, name: roomName(s),
      sentence: `${roomName(s)} vanished — ${ft(shapeArea(s))} ft², ${floorLabel(floor)}.`,
      mark: { floor, kind: 'room', change: 'removed', pts: copyPts(outerPts(s)), label: roomName(s) },
    });
  }
  for (const s of leftB) {
    if (paired.has(s)) continue;
    out.push({
      kind: 'room', change: 'added', floor, id: s.id, name: roomName(s),
      sentence: `${roomName(s)} appeared — ${ft(shapeArea(s))} ft², ${floorLabel(floor)}.`,
      mark: { floor, kind: 'room', change: 'added', pts: copyPts(outerPts(s)), label: roomName(s) },
    });
  }
}

// ---------- walls, props, links, regions ----------

const lineMark = (line, floor, change) => ({
  floor, kind: 'wall', change, a: { x: line.ax, z: line.az }, b: { x: line.bx, z: line.bz },
});

function diffWalls(fa, fb, floor, out) {
  const A = byId(wallLinesOf(fa)), B = byId(wallLinesOf(fb));
  let added = 0, removed = 0, changed = 0;
  const marks = [];
  for (const [id, la] of A) {
    const lb = B.get(id);
    if (!lb) { removed += 1; marks.push(lineMark(la, floor, 'removed')); continue; }
    const moved = la.ax !== lb.ax || la.az !== lb.az || la.bx !== lb.bx || la.bz !== lb.bz;
    const rekinded = (la.kind || 'wall') !== (lb.kind || 'wall');
    const doors = (la.openings || []).length !== (lb.openings || []).length;
    if (moved || rekinded || doors) { changed += 1; marks.push(lineMark(lb, floor, 'changed')); }
  }
  for (const [id, lb] of B) if (!A.has(id)) { added += 1; marks.push(lineMark(lb, floor, 'added')); }
  if (!added && !removed && !changed) return;
  const parts = [];
  if (added) parts.push(`${a(added, 'free-standing wall')} drawn`);
  if (removed) parts.push(`${a(removed, 'free-standing wall')} erased`);
  if (changed) parts.push(`${a(changed, 'free-standing wall')} changed`);
  out.push({
    kind: 'wall', change: added && !removed && !changed ? 'added' : (removed && !added && !changed ? 'removed' : 'changed'),
    floor, counts: { added, removed, changed },
    sentence: `${parts.join(', ')} on ${floorLabel(floor)}.`,
    marks,
  });
}

function diffProps(da, db, out) {
  const A = byId(propsOf(da)), B = byId(propsOf(db));
  const perFloor = new Map();
  const tally = (floor) => {
    if (!perFloor.has(floor)) perFloor.set(floor, { added: 0, removed: 0, moved: 0, marks: [] });
    return perFloor.get(floor);
  };
  for (const [id, pa] of A) {
    const pb = B.get(id);
    if (!pb) { const t = tally(num(pa.floor)); t.removed += 1; t.marks.push({ floor: num(pa.floor), kind: 'prop', change: 'removed', x: pa.x, z: pa.z }); continue; }
    const moved = pa.floor !== pb.floor || Math.hypot(pb.x - pa.x, pb.z - pa.z) > MOVE_EPS_FT
      || Math.abs(num(pb.rotationY) - num(pa.rotationY)) > 1e-6 || pa.type !== pb.type;
    if (moved) { const t = tally(num(pb.floor)); t.moved += 1; t.marks.push({ floor: num(pb.floor), kind: 'prop', change: 'changed', x: pb.x, z: pb.z }); }
  }
  for (const [id, pb] of B) {
    if (A.has(id)) continue;
    const t = tally(num(pb.floor)); t.added += 1; t.marks.push({ floor: num(pb.floor), kind: 'prop', change: 'added', x: pb.x, z: pb.z });
  }
  for (const [floor, t] of [...perFloor.entries()].sort((x, y) => x[0] - y[0])) {
    const parts = [];
    if (t.added) parts.push(`${a(t.added, 'piece of furniture', 'pieces of furniture')} placed`);
    if (t.removed) parts.push(`${a(t.removed, 'piece', 'pieces')} removed`);
    if (t.moved) parts.push(`${a(t.moved, 'piece', 'pieces')} moved`);
    out.push({
      kind: 'prop', change: t.added && !t.removed && !t.moved ? 'added' : (t.removed && !t.added && !t.moved ? 'removed' : 'changed'),
      floor, counts: { added: t.added, removed: t.removed, moved: t.moved },
      sentence: `${parts.join(', ')} on ${floorLabel(floor)}.`,
      marks: t.marks,
    });
  }
}

const LINK_WORD = { stair: 'stair', ramp: 'ramp', elevator: 'lift', opening: 'floor opening' };
const linkWord = (l) => LINK_WORD[l.type] || l.type || 'link';
const between = (l) => `between ${floorLabel(Math.min(l.from, l.to))} and ${floorLabel(Math.max(l.from, l.to))}`;

function diffLinks(da, db, out) {
  const A = byId(linksOf(da)), B = byId(linksOf(db));
  for (const [id, la] of A) {
    const lb = B.get(id);
    if (!lb) {
      out.push({ kind: 'link', change: 'removed', floor: num(la.from), id,
        sentence: `A ${linkWord(la)} ${between(la)} was removed.`,
        marks: [la.from, la.to].map((f) => ({ floor: f, kind: 'link', change: 'removed', x: la.x, z: la.z })) });
      continue;
    }
    const changed = la.type !== lb.type || la.from !== lb.from || la.to !== lb.to
      || Math.hypot(lb.x - la.x, lb.z - la.z) > MOVE_EPS_FT || Math.abs(num(lb.rotationY) - num(la.rotationY)) > 1e-6;
    if (changed) {
      out.push({ kind: 'link', change: 'changed', floor: num(lb.from), id,
        sentence: `A ${linkWord(lb)} ${between(lb)} changed.`,
        marks: [lb.from, lb.to].map((f) => ({ floor: f, kind: 'link', change: 'changed', x: lb.x, z: lb.z })) });
    }
  }
  for (const [id, lb] of B) {
    if (A.has(id)) continue;
    out.push({ kind: 'link', change: 'added', floor: num(lb.from), id,
      sentence: `A ${linkWord(lb)} was added ${between(lb)}.`,
      marks: [lb.from, lb.to].map((f) => ({ floor: f, kind: 'link', change: 'added', x: lb.x, z: lb.z })) });
  }
}

function diffRegions(da, db, out) {
  const A = byId(regionsIn(da)), B = byId(regionsIn(db));
  let added = 0, removed = 0, changed = 0;
  const marks = [];
  for (const [id, ra] of A) {
    const rb = B.get(id);
    if (!rb) { removed += 1; marks.push({ floor: 0, kind: 'region', change: 'removed', pts: copyPts(ra.pts) }); continue; }
    if (!same(copyPts(ra.pts), copyPts(rb.pts)) || ra.surf !== rb.surf || (ra.mark || null) !== (rb.mark || null) || (ra.kind || null) !== (rb.kind || null)) {
      changed += 1; marks.push({ floor: 0, kind: 'region', change: 'changed', pts: copyPts(rb.pts), was: copyPts(ra.pts) });
    }
  }
  for (const [id, rb] of B) if (!A.has(id)) { added += 1; marks.push({ floor: 0, kind: 'region', change: 'added', pts: copyPts(rb.pts) }); }
  if (!added && !removed && !changed) return;
  const parts = [];
  if (added) parts.push(`${a(added, 'site region')} laid`);
  if (removed) parts.push(`${a(removed, 'site region')} removed`);
  if (changed) parts.push(`${a(changed, 'site region')} changed`);
  const area = regionsIn(db).reduce((n, r) => n + regionArea(r), 0);
  out.push({
    kind: 'region', change: added && !removed && !changed ? 'added' : (removed && !added && !changed ? 'removed' : 'changed'),
    floor: 0, counts: { added, removed, changed },
    sentence: `${parts.join(', ')} — ${ft(area)} ft² of site now.`,
    marks,
  });
}

// ---------- the whole design ----------

export function designDiff(before, after) {
  const changes = [];
  const fa = floorsOf(before), fb = floorsOf(after);
  const n = Math.max(fa.length, fb.length);
  for (let i = 0; i < n; i++) {
    if (i >= fa.length) {
      const rooms = shapesOf(fb[i]).length;
      changes.push({ kind: 'storey', change: 'added', floor: i,
        sentence: `${floorLabel(i)} was added${rooms ? `, with ${plural(rooms, 'room')}` : ''}.`,
        marks: shapesOf(fb[i]).map((s) => ({ floor: i, kind: 'room', change: 'added', pts: copyPts(outerPts(s)), label: roomName(s) })) });
      continue;
    }
    if (i >= fb.length) {
      const rooms = shapesOf(fa[i]).length;
      changes.push({ kind: 'storey', change: 'removed', floor: i,
        sentence: `${floorLabel(i)} was removed${rooms ? `, and ${plural(rooms, 'room')} with it` : ''}.`,
        marks: [] });
      continue;
    }
    diffRooms(fa[i], fb[i], i, changes);
    diffWalls(fa[i], fb[i], i, changes);
  }
  diffProps(before, after, changes);
  diffLinks(before, after, changes);
  diffRegions(before, after, changes);
  if (before && after && (num(before.w) !== num(after.w) || num(before.h) !== num(after.h))) {
    changes.push({ kind: 'sheet', change: 'changed', floor: null,
      sentence: `The sheet was resized from ${num(before.w)} × ${num(before.h)} to ${num(after.w)} × ${num(after.h)} cells.`,
      marks: [] });
  }
  for (const key of Object.keys(RECORD_SENTENCES)) {
    const va = before ? before[key] : undefined, vb = after ? after[key] : undefined;
    if (same(va ?? null, vb ?? null)) continue;
    changes.push({ kind: 'record', change: 'changed', floor: null, key, sentence: RECORD_SENTENCES[key], marks: [] });
  }

  const summary = { added: 0, removed: 0, changed: 0, rooms: { added: 0, removed: 0, changed: 0 }, total: changes.length };
  for (const c of changes) {
    summary[c.change] += 1;
    if (c.kind === 'room') summary.rooms[c.change] += 1;
  }
  const marks = [];
  for (const c of changes) {
    if (c.mark) marks.push(c.mark);
    if (c.marks) marks.push(...c.marks);
  }
  const sentences = changes.map((c) => c.sentence);
  return { summary, changes, sentences, marks };
}

// The headline a panel prints above the sentences. Written here so the
// panel, the sheet and the suite agree on the words.
export function diffHeadline(diff) {
  if (!diff || !diff.changes.length) return 'Nothing changed.';
  const r = diff.summary.rooms;
  const parts = [];
  if (r.added) parts.push(`${plural(r.added, 'room')} appeared`);
  if (r.removed) parts.push(`${plural(r.removed, 'room')} vanished`);
  if (r.changed) parts.push(`${plural(r.changed, 'room')} changed`);
  const other = diff.changes.length - r.added - r.removed - r.changed;
  if (other) parts.push(`${plural(other, 'other change')}`);
  return `${parts.join(', ')}.`;
}

// The marks that belong on one storey's sheet — a link's mark appears on both
// storeys it joins, a region's on the ground storey only.
export const marksOn = (diff, floor) =>
  (diff && Array.isArray(diff.marks) ? diff.marks : []).filter((m) => m.floor === floor);
