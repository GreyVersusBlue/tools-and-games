// session.test.mjs — the design as a log, and what happens when two of them
// disagree.
//
// Two properties carry most of this suite:
//
//   1. Round trip. Apply the ops a change produced to the design it changed
//      *from*, and you have the design it changed *to* — for a room moved, a
//      prop deleted, a storey's finish repainted, a whole sample school.
//   2. Convergence. Two peers who saw the same two conflicting edits in
//      opposite orders end up with the same building. That is the property
//      last-write-wins is *for*, and it is the one that would fail silently.
//
// Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession, opsBetween, applyOps, applyOp, recordsOf, recordKey,
  baseVersions, beats, describeOps, blockOf, idBase, adoptIds, blocksClash,
  makeSite, BLOCK_SIZE, BLOCKS, RESYNC_OPS, DESIGN_FIELDS, SHEET,
} from '../js/session.js';
import { createState, addFloor } from '../js/grid.js';
import { addProp, addLink } from '../js/props.js';
import { buildSampleSchool } from '../js/sample.js';
import { clone } from '../js/history.js';
import { sheet } from './build.mjs';

const json = (v) => JSON.parse(JSON.stringify(v));

// A small school with two rooms and something in one of them.
function school() {
  const s = createState(16, 12);
  sheet(s, 0)
    .box(1, 1, 4, 4, { name: 'Art', color: '#f5d491' })
    .box(6, 1, 9, 4, { name: 'Music', color: '#b8dfa2' })
    .bake();
  addProp(s, 'desk', { x: 10, z: 10 });
  return s;
}

const rooms = (s, f = 0) => s.floors[f].shapes;
const roomNamed = (s, name) => {
  for (const f of s.floors) for (const sh of f.shapes) if (sh.name === name) return sh;
  return null;
};

// What a peer does with what another peer sent.
function deliver(target, ops) {
  const res = applyOps(target.design, ops, target.versions);
  return res;
}
const peer = (design) => ({ design: json(design), versions: baseVersions(design) });

// ---------- addressing ----------

test('every room, prop, link and setting is a record with a key', () => {
  const s = school();
  const recs = recordsOf(json(s));
  const roomKeys = [...recs.keys()].filter((k) => k.startsWith('room:'));
  assert.equal(roomKeys.length, rooms(s).length);
  assert.equal(rooms(s).length, 2);
  assert.equal([...recs.keys()].filter((k) => k.startsWith('prop:')).length, 1);
  // The drawing surface is always a record; the optional design-wide ones are
  // there only when the design has them.
  assert.ok(recs.has(recordKey('design', SHEET)));
  assert.ok(recs.has(recordKey('design', 'env')));
});

test('a record key names the room, not where it happens to sit in the array', () => {
  const s = school();
  const before = json(s);
  // Delete the first room. The second one keeps its key even though its index
  // moved — which is the whole difference between this and a JSON patch.
  const keep = rooms(s)[1].id;
  s.floors[0].shapes.splice(0, 1);
  const { ops } = opsBetween(before, json(s));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].k, 'room');
  assert.equal(ops[0].v, null);
  assert.notEqual(ops[0].id, keep);
});

test('the person-shaped fields never travel', () => {
  const s = school();
  const before = json(s);
  s.currentFloor = 0;
  s.nextId = 5000;
  s.version = 99;
  const { ops } = opsBetween(before, json(s));
  assert.deepEqual(ops, []);
});

// ---------- the round trip ----------

test('ops from a change turn the old design into the new one', () => {
  const s = school();
  const before = json(s);
  roomNamed(s, 'Art').name = 'Ceramics';
  addProp(s, { type: 'chair', x: 4, z: 4 });
  s.env = { ...s.env, hour: 15 };
  const after = json(s);

  const { ops, resync } = opsBetween(before, after);
  assert.equal(resync, false);
  const target = peer(before);
  const res = deliver(target, ops.map((op) => ({ ...op, t: 1, site: 'a' })));
  assert.equal(res.applied, ops.length);
  assert.deepEqual(target.design, after);
});

test('a room dragged to another storey travels as one record', () => {
  const s = school();
  addFloor(s);
  const before = json(s);
  const moving = rooms(s)[0];
  s.floors[0].shapes.splice(0, 1);
  s.floors[1].shapes.push(moving);
  const after = json(s);

  const { ops } = opsBetween(before, after);
  assert.equal(ops.length, 1, 'one record moved, not a delete and an add');
  assert.equal(ops[0].f, 1);

  const target = peer(before);
  deliver(target, ops.map((op) => ({ ...op, t: 1, site: 'a' })));
  assert.equal(target.design.floors[0].shapes.length, rooms(s, 0).length);
  assert.equal(target.design.floors[1].shapes.length, 1);
  assert.deepEqual(target.design, after);
});

test('deleting a prop and a link says so, once each', () => {
  const s = school();
  addFloor(s);
  addLink(s, 'stair', { x: 8, z: 8, from: 0, to: 1 });
  const before = json(s);
  s.props.length = 0;
  s.links.length = 0;
  const { ops } = opsBetween(before, json(s));
  assert.equal(ops.length, 2);
  assert.ok(ops.every((op) => op.v === null));
  const target = peer(before);
  deliver(target, ops.map((op) => ({ ...op, t: 2, site: 'a' })));
  assert.deepEqual(target.design.props, []);
  assert.deepEqual(target.design.links, []);
});

test('the sheet is a record, so resizing the plan travels', () => {
  const s = school();
  const before = json(s);
  s.w = 30; s.h = 24;
  s.floors[0].w = 30; s.floors[0].h = 24;
  const { ops } = opsBetween(before, json(s));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].id, SHEET);
  const target = peer(before);
  deliver(target, ops.map((op) => ({ ...op, t: 1, site: 'a' })));
  assert.equal(target.design.w, 30);
  assert.equal(target.design.floors[0].h, 24);
});

test('a design-wide setting that is taken away is taken away at the other end', () => {
  const s = school();
  s.site = { regions: [{ id: 1, kind: 'lawn', pts: [0, 0, 4, 0, 4, 4] }] };
  const before = json(s);
  delete s.site;
  const { ops } = opsBetween(before, json(s));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].v, null);
  const target = peer(before);
  deliver(target, ops.map((op) => ({ ...op, t: 3, site: 'a' })));
  assert.equal('site' in target.design, false);
});

test('a design-wide setting only travels when it is one this build knows', () => {
  const design = { floors: [{ w: 4, h: 4, shapes: [] }], w: 4, h: 4 };
  assert.equal(applyOp(design, { k: 'design', id: 'somethingElse', v: 3 }), false);
  assert.equal('somethingElse' in design, false);
  for (const f of DESIGN_FIELDS) {
    assert.equal(applyOp(design, { k: 'design', id: f, v: { a: 1 } }), true);
  }
});

// ---------- resync ----------

test('a change of storey count asks for a resync rather than guessing', () => {
  const s = school();
  const before = json(s);
  addFloor(s);
  const out = opsBetween(before, json(s));
  assert.equal(out.resync, true);
  assert.match(out.reason, /storeys/);
  assert.deepEqual(out.ops, []);
});

test('a whole building arriving at once is a resync, not a log', () => {
  // A generated school is thousands of records. Sending it as ops would be
  // slower and larger than sending it as a file, so past the line it is a
  // snapshot — and the line is the only place the log gives up.
  const s = createState(120, 90);
  const before = json(s);
  const draw = sheet(s, 0);
  for (let i = 0; i < RESYNC_OPS + 20; i++) {
    const x = 1 + (i % 20) * 5, y = 1 + Math.floor(i / 20) * 5;
    draw.box(x, y, x + 2, y + 2);
  }
  draw.bake();
  const out = opsBetween(before, json(s));
  assert.equal(out.resync, true);
  assert.match(out.reason, /records changed/);
  assert.deepEqual(out.ops, []);
});

test('an edit right under the resync line is still a log', () => {
  const s = createState(120, 90);
  const before = json(s);
  const draw = sheet(s, 0);
  const n = RESYNC_OPS - 10;
  for (let i = 0; i < n; i++) {
    const x = 1 + (i % 20) * 5, y = 1 + Math.floor(i / 20) * 5;
    draw.box(x, y, x + 2, y + 2);
  }
  draw.bake();
  const out = opsBetween(before, json(s));
  assert.equal(out.resync, false, `${out.ops.length} ops`);
  // n rooms and the sheet is unchanged, so the count is the rooms themselves.
  assert.equal(out.ops.length, n);
});

// ---------- the conflict rule ----------

test('the newer stamp wins and the older one is dropped', () => {
  const versions = {};
  assert.equal(beats(versions, 'room:1', { t: 1, site: 'a' }), true);
  versions['room:1'] = { t: 4, site: 'a' };
  assert.equal(beats(versions, 'room:1', { t: 3, site: 'b' }), false);
  assert.equal(beats(versions, 'room:1', { t: 5, site: 'b' }), true);
});

test('a tie is broken by site id, the same way on both sides', () => {
  const versions = {};
  versions['room:1'] = { t: 4, site: 'aaa' };
  assert.equal(beats(versions, 'room:1', { t: 4, site: 'zzz' }), true);
  const other = { 'room:1': { t: 4, site: 'zzz' } };
  assert.equal(beats(other, 'room:1', { t: 4, site: 'aaa' }), false);
});

test('two peers who saw the same edits in opposite orders agree', () => {
  const base = json(school());
  const id = base.floors[0].shapes[0].id;

  const fromA = [{ k: 'room', id, f: 0, site: 'aaa', t: 7, v: { ...base.floors[0].shapes[0], name: 'A wins' } }];
  const fromB = [{ k: 'room', id, f: 0, site: 'bbb', t: 7, v: { ...base.floors[0].shapes[0], name: 'B wins' } }];

  const one = peer(base);
  deliver(one, fromA);
  deliver(one, fromB);

  const two = peer(base);
  deliver(two, fromB);
  deliver(two, fromA);

  assert.deepEqual(one.design, two.design);
  assert.equal(one.design.floors[0].shapes[0].name, 'B wins', 'the higher site id breaks the tie');
});

test('a stale op cannot undo a newer local edit', () => {
  const s = school();
  const a = createSession({ site: 'aaa' });
  a.baseline(json(s));
  const before = json(s);
  roomNamed(s, 'Art').name = 'Mine';
  const mine = a.emit(before, json(s));
  assert.equal(mine.ops.length, 1);

  // Somebody else's edit to the same room, stamped before ours.
  const stale = [{ ...mine.ops[0], site: 'bbb', t: mine.ops[0].t - 1, v: { ...mine.ops[0].v, name: 'Theirs' } }];
  const res = a.receive(s, stale);
  assert.equal(res.applied, 0);
  assert.equal(res.dropped, 1);
  assert.equal(roomNamed(s, 'Mine').name, 'Mine');
});

// ---------- the clock ----------

test('the clock only goes up, and a received op pushes it', () => {
  const a = createSession({ site: 'aaa' });
  const s = school();
  a.baseline(json(s));
  const before = json(s);
  roomNamed(s, 'Art').name = 'One';
  assert.equal(a.emit(before, json(s)).ops[0].t, 1);

  a.receive(s, [{ k: 'prop', id: 900001, site: 'bbb', t: 40, v: { id: 900001, type: 'chair', x: 1, z: 1, floor: 0 } }]);
  assert.equal(a.clock, 40);

  const mid = json(s);
  roomNamed(s, 'One').name = 'Two';
  assert.equal(a.emit(mid, json(s)).ops[0].t, 41, 'the next local edit is after what it saw');
});

test('every op in one gesture shares a tick, so a gesture wins or loses as a unit', () => {
  const s = school();
  const a = createSession({ site: 'aaa' });
  a.baseline(json(s));
  const before = json(s);
  roomNamed(s, 'Art').name = 'X';
  roomNamed(s, 'Music').name = 'Y';
  const { ops } = a.emit(before, json(s));
  assert.equal(ops.length, 2);
  assert.equal(ops[0].t, ops[1].t);
});

test('an edit that changed nothing costs no ops', () => {
  const s = school();
  const a = createSession({ site: 'aaa' });
  a.baseline(json(s));
  const out = a.emit(json(s), json(s));
  assert.deepEqual(out.ops, []);
  assert.equal(out.resync, false);
});

// ---------- a session between two of them ----------

test('two sessions round-trip a conversation and stay identical', () => {
  const design = json(school());
  const a = { s: createSession({ site: 'aaa' }), d: json(design) };
  const b = { s: createSession({ site: 'bbb' }), d: json(design) };
  a.s.baseline(a.d); b.s.baseline(b.d);

  // A renames a room; B hears it.
  let before = json(a.d);
  a.d.floors[0].shapes[0].name = 'Kiln';
  b.s.receive(b.d, a.s.emit(before, json(a.d)).ops);

  // B adds a prop out of its own id block; A hears it.
  before = json(b.d);
  b.d.props.push({ id: idBase('bbb'), type: 'chair', x: 3, z: 3, floor: 0, rot: 0, data: {} });
  a.s.receive(a.d, b.s.emit(before, json(b.d)).ops);

  assert.deepEqual(a.d, b.d);
  assert.equal(a.d.floors[0].shapes[0].name, 'Kiln');
  assert.equal(a.d.props.length, 2);
});

test('a joiner that adopts the sender bookkeeping does not lose to a stale op', () => {
  const design = json(school());
  const a = createSession({ site: 'aaa' });
  a.baseline(design);
  const before = json(design);
  design.floors[0].shapes[0].name = 'Kiln';
  const { ops } = a.emit(before, json(design));
  applyOps(design, ops, a.versions);

  // The joiner takes the snapshot *and* the bookkeeping.
  const b = createSession({ site: 'bbb' });
  const theirs = json(design);
  b.adoptMeta(a.snapshotMeta());
  assert.equal(b.clock >= a.clock, true);
  // ...so a replayed copy of that same op changes nothing.
  const res = b.receive(theirs, ops);
  assert.equal(res.applied, 0);
});

// ---------- id blocks ----------

test('a site allocates from its own block, and two sites rarely share one', () => {
  const a = 'aaaaaaaaaaaa', b = 'bbbbbbbbbbbb';
  assert.notEqual(blockOf(a), blockOf(b));
  assert.equal(blocksClash(a, b), false);
  assert.ok(blockOf(a) >= 0 && blockOf(a) < BLOCKS);
  assert.equal(idBase(a), blockOf(a) * BLOCK_SIZE + 1);
});

test('adopting a block moves the counter forward and never back', () => {
  const s = school();
  const site = 'zzzzzzzzzzzz';
  const was = s.nextId;
  adoptIds(s, site);
  assert.equal(s.nextId, Math.max(was, idBase(site)));
  s.nextId = idBase(site) + 50;
  adoptIds(s, site);
  assert.equal(s.nextId, idBase(site) + 50, 'ids already handed out are not reused');
});

test('two peers editing at once never mint the same id', () => {
  const a = 'site-one-aaaa', b = 'site-two-bbbb';
  const sa = school(); const sb = json(sa);
  adoptIds(sa, a);
  const sbState = sb; adoptIds(sbState, b);
  const idsA = [], idsB = [];
  for (let i = 0; i < 200; i++) {
    idsA.push(sa.nextId++);
    idsB.push(sbState.nextId++);
  }
  const overlap = idsA.filter((id) => idsB.includes(id));
  assert.deepEqual(overlap, []);
});

test('a site id is twelve hex characters, and a fixed generator repeats it', () => {
  let n = 0;
  const rand = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
  n = 1; const first = makeSite(rand);
  n = 1; const second = makeSite(rand);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{12}$/);
});

// ---------- saying what happened ----------

test('a batch of ops describes itself in a sentence', () => {
  assert.equal(describeOps([]), 'nothing');
  assert.equal(describeOps([{ k: 'room' }]), '1 room');
  assert.equal(describeOps([{ k: 'room' }, { k: 'room' }]), '2 rooms');
  const many = describeOps([{ k: 'room' }, { k: 'prop' }, { k: 'design' }]);
  assert.match(many, /1 room, 1 object and 1 setting/);
});

test('applying a batch reports what it applied and what it dropped', () => {
  const design = json(school());
  const versions = baseVersions(design);
  const id = design.floors[0].shapes[0].id;
  const res = applyOps(design, [
    { k: 'room', id, f: 0, site: 'a', t: 5, v: { ...design.floors[0].shapes[0], name: 'New' } },
    { k: 'room', id, f: 0, site: 'a', t: 2, v: { ...design.floors[0].shapes[0], name: 'Old' } },
  ], versions);
  assert.equal(res.applied, 1);
  assert.equal(res.dropped, 1);
  assert.equal(res.kinds.room, 1);
  assert.equal(design.floors[0].shapes[0].name, 'New');
});

test('a malformed op is ignored rather than half-applied', () => {
  const design = json(school());
  const before = json(design);
  const res = applyOps(design, [null, 3, 'room', {}, { id: 1 }], {});
  assert.equal(res.applied, 0);
  assert.deepEqual(design, before);
});

// ---------- the sample school, end to end ----------

test('a session carries every edit of a real school between two peers', () => {
  const s = buildSampleSchool();
  const design = json(s);
  const a = { s: createSession({ site: 'aaa' }), d: json(design) };
  const b = { s: createSession({ site: 'bbb' }), d: json(design) };
  a.s.baseline(a.d); b.s.baseline(b.d);

  const edits = [
    (d) => { d.floors[0].shapes[2].name = 'Reading Room'; },
    (d) => { d.floors[0].shapes[3].color = '#123456'; },
    (d) => { d.props.splice(0, 1); },
    (d) => { d.env = { ...d.env, hour: 7 }; },
    (d) => { d.floors[0].shapes[1].fin = 'carpet'; },
  ];
  for (const edit of edits) {
    const before = json(a.d);
    edit(a.d);
    const out = a.s.emit(before, json(a.d));
    assert.equal(out.resync, false);
    b.s.receive(b.d, out.ops);
  }
  assert.deepEqual(b.d, a.d);
});
