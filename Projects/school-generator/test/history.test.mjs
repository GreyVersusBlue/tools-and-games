// history.test.mjs — the structural diff an undo step is made of.
//
// One property does most of the work here and every test leans on it:
// `apply(a, diff(a, b))` deep-equals `b`, for any pair of JSON values. The
// rest is about what a patch *costs*, because the whole reason this module
// exists is that a copy of the design cost too much.
//
// Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { diff, apply, same, clone, patchSize, step } from '../js/history.js';
import { createState } from '../js/grid.js';
import { buildSampleSchool } from '../js/sample.js';
import { addProp } from '../js/props.js';
import { serialize } from '../js/save-load.js';
import { sheet } from './build.mjs';

const json = (v) => JSON.parse(JSON.stringify(v));
const roundTrip = (a, b, msg) =>
  assert.deepEqual(apply(a, diff(a, b)), b, msg);

// ---------- the property ----------

test('applying a diff turns one value into the other, whatever they are', () => {
  const pairs = [
    [1, 2],
    ['a', 'b'],
    [null, 0],
    [true, false],
    [{}, {}],
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 2 }],
    [{ a: 1, b: 2 }, { a: 1 }],
    [{ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }],
    [[1, 2, 3], [1, 9, 3]],
    [[1, 2, 3], [1, 2]],
    [[1, 2], [1, 2, 3]],
    [[], [1, 2, 3, 4, 5, 6]],
    [[{ id: 1 }, { id: 2 }], [{ id: 1, x: 4 }, { id: 2 }]],
    [{ a: [1, { b: 2 }] }, { a: [1, { b: 3 }, 'new'] }],
    [{ a: 1 }, [1, 2]],
    [[1, 2], { a: 1 }],
    [{ a: null }, { a: { deep: [1, 2] } }],
  ];
  for (const [a, b] of pairs) {
    roundTrip(a, b, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    roundTrip(b, a, `${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
  }
});

test('two equal values have no diff at all, and a step of nothing is nothing', () => {
  assert.equal(diff(1, 1), undefined);
  assert.equal(diff({ a: [1, 2] }, { a: [1, 2] }), undefined);
  assert.equal(diff(null, null), undefined);
  assert.equal(step({ a: 1 }, { a: 1 }), null);
  assert.ok(step({ a: 1 }, { a: 2 }));
});

test('same() is deep equality and stops at the first difference', () => {
  assert.ok(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!same({ a: 1 }, { a: 1, b: undefined }), 'an extra key is a difference');
  assert.ok(!same([1, 2], [1, 2, 3]));
  assert.ok(!same({ a: 1 }, [1]));
  assert.ok(same(null, null));
  assert.ok(!same(null, {}));
});

// ---------- what the editor needs of it ----------

test('nothing comes back sharing anything with what went in', () => {
  const before = { rooms: [{ id: 1, name: 'A', pts: [{ x: 0 }] }] };
  const after = json(before);
  after.rooms[0].name = 'B';
  const patch = diff(before, after);
  const out = apply(before, patch);
  assert.deepEqual(out, after);
  // Mutating the result must not touch either input, or an undo would
  // rewrite the history that produced it.
  out.rooms[0].pts[0].x = 99;
  out.rooms.push({ id: 2 });
  assert.equal(before.rooms[0].pts[0].x, 0);
  assert.equal(after.rooms[0].pts[0].x, 0);
  assert.equal(before.rooms.length, 1);
  // ...and the patch itself is not a window onto the value it came from.
  after.rooms[0].name = 'C';
  assert.equal(apply(before, patch).rooms[0].name, 'B');
});

test('a patch is plain JSON, so a hundred of them can be kept or sent', () => {
  const a = { floors: [{ shapes: [{ id: 1, name: 'A' }] }] };
  const b = { floors: [{ shapes: [{ id: 1, name: 'B' }] }] };
  const patch = diff(a, b);
  const wired = JSON.parse(JSON.stringify(patch));
  assert.deepEqual(apply(a, wired), b);
});

test('a step carries both directions, and each undoes the other', () => {
  const before = { a: 1, b: { c: [1, 2, 3] } };
  const after = { a: 1, b: { c: [1, 9, 3] }, d: true };
  const s = step(before, after);
  assert.deepEqual(apply(before, s.fwd), after);
  assert.deepEqual(apply(after, s.back), before);
  assert.ok(s.size > 0);
});

// ---------- the point of the whole thing ----------

test('moving one prop is a patch about one prop, not about the design', () => {
  const s = buildSampleSchool();
  const before = json(s);
  s.props[3].x += 2;
  const after = json(s);
  const patch = diff(before, after);
  assert.equal(patchSize(patch), 1, 'one leaf changed, one leaf in the patch');
  const bytes = JSON.stringify(patch).length;
  const whole = serialize(s).length;
  assert.ok(bytes * 200 < whole,
    `a one-prop nudge is ${bytes} bytes against ${whole} for the design`);
  assert.deepEqual(apply(before, patch), after);
});

test('renaming one room is a patch about one room', () => {
  const s = buildSampleSchool();
  const before = json(s);
  s.floors[0].shapes[2].name = 'Room 103A';
  const after = json(s);
  const patch = diff(before, after);
  assert.equal(patchSize(patch), 1);
  assert.ok(JSON.stringify(patch).length < 200);
  assert.deepEqual(apply(before, patch), after);
});

test('painting one cell touches the room it grew and nothing else', () => {
  const s = createState(20, 20);
  sheet(s, 0).box(2, 2, 5, 5, { name: 'Room 101' }).bake();
  sheet(s, 0).box(10, 2, 13, 5, { name: 'Room 102' }).bake();
  const before = json(s);
  // Grow the first room by one cell, the way the brush does.
  s.floors[0].shapes[0].rings[0].pts.push({ x: 24, z: 24 });
  const after = json(s);
  const patch = diff(before, after);
  const text = JSON.stringify(patch);
  assert.ok(text.includes('"0"'), 'the first room is in it');
  assert.ok(!text.includes('Room 102'), 'and the second room is not');
  assert.deepEqual(apply(before, patch), after);
});

test('a hundred edits cost a hundred patches, not a hundred buildings', () => {
  const s = buildSampleSchool();
  let baseline = json(s);
  const steps = [];
  for (let i = 0; i < 100; i++) {
    addProp(s, 'student-chair', { floor: 0, x: 30 + i * 0.1, z: 40 });
    const next = json(s);
    steps.push(step(baseline, next));
    baseline = next;
  }
  const history = steps.reduce((n, st) => n + JSON.stringify(st).length, 0);
  const design = JSON.stringify(json(s)).length;
  assert.ok(history < design,
    `a hundred edits of history is ${history} bytes; one copy of the design is ${design}`);
  // ...and walking every one of them backwards lands exactly where it began.
  let cur = json(s);
  for (let i = steps.length - 1; i >= 0; i--) cur = apply(cur, steps[i].back);
  assert.equal(cur.props.length, json(buildSampleSchool()).props.length);
});

test('an array rewritten end to end is said outright rather than index by index', () => {
  const a = { list: [1, 2, 3, 4, 5, 6, 7, 8] };
  const b = { list: [8, 7, 6, 5, 4, 3, 2, 1] };
  const patch = diff(a, b);
  assert.ok(patch.obj.list.set, 'a wholesale rewrite is a wholesale patch');
  assert.deepEqual(apply(a, patch), b);
  // ...but one changed entry in a long array still is not.
  const c = { list: [1, 2, 3, 4, 5, 6, 7, 9] };
  assert.ok(diff(a, c).obj.list.arr, 'one changed index stays an index');
  assert.equal(patchSize(diff(a, c)), 1);
});

test('clone is a copy, all the way down', () => {
  const a = { x: [1, { y: [2, 3] }], z: null };
  const b = clone(a);
  assert.deepEqual(b, a);
  b.x[1].y.push(4);
  assert.equal(a.x[1].y.length, 2);
});
