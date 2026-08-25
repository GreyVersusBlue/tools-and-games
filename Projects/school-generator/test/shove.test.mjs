// The furniture you walk into. Pure module, like everything else here, so the
// whole of it runs headless: a chair, a walker, and the question of whether
// the chair ended up anywhere sensible.
//
// The four claims worth holding, because each of them is a way this could go
// wrong without looking wrong: only flagged rows move, a shove is the walker's
// own separation negated (so it always goes *away* from you), a prop against a
// wall stays put rather than sliding into it, and none of it touches the
// design.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, setTile, edgeHIdx, edgeVIdx, EDGE_WALL, CELL,
} from '../js/grid.js';
import { addProp } from '../js/props.js';
import { catalogEntry } from '../js/catalog.js';
import { buildCollider, WALKER_R, propObstacles } from '../js/collide.js';
import { shoveProps, shoveClear, shoveWeight, MAX_SHOVE, MIN_SHOVE } from '../js/shove.js';

// A big open room, walled, so a prop has somewhere to go and one place it
// can't. Cells x 2..12, y 2..12 — 44ft square at 4ft cells.
function room() {
  const s = createState(20, 20);
  const f = s.floors[0];
  for (let y = 2; y <= 12; y++) for (let x = 2; x <= 12; x++) setTile(f, x, y, true);
  for (let x = 2; x <= 12; x++) {
    f.edgesH[edgeHIdx(f, x, 2)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 13)] = EDGE_WALL;
  }
  for (let y = 2; y <= 12; y++) {
    f.edgesV[edgeVIdx(f, 2, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, 13, y)] = EDGE_WALL;
  }
  return s;
}

const collide = (s) => buildCollider(s, 0, catalogEntry, { index: false });
const obstacleFor = (c, id) => c.props.find((p) => p.id === id);

// ---------- the weight ----------

test('a row says whether it moves, and how easily', () => {
  assert.equal(shoveWeight(catalogEntry('student-chair')), 1, 'true means all of it');
  assert.equal(shoveWeight(catalogEntry('chair-lounge')), 0.5);
  assert.equal(shoveWeight(catalogEntry('teacher-desk')), 0, 'a desk is furniture');
  assert.equal(shoveWeight(catalogEntry('file-cabinet')), 0);
});

test('anything that is not a weight is not light', () => {
  for (const junk of [null, undefined, {}, 'yes', { light: 'yes' }, { light: NaN }, { light: -3 }]) {
    assert.equal(shoveWeight(junk), 0, `${JSON.stringify(junk)} does not move`);
  }
  assert.equal(shoveWeight({ light: 2 }), 1, 'and nothing takes more than the whole separation');
});

test('an obstacle knows its own place in the array', () => {
  // `shoveProps` hands `idx` to the index's `reindex`; if it ever disagreed
  // with the array, a shove would re-bucket somebody else's prop.
  const s = room();
  addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 20 });
  addProp(s, 'stool-lab-24', { floor: 0, x: 40, z: 20 });
  const obs = propObstacles(s, 0, catalogEntry);
  obs.forEach((o, i) => assert.equal(o.idx, i, `${o.type} knows where it is`));
});

test('the obstacle record carries the id and the weight through', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 20 });
  const obs = propObstacles(s, 0, catalogEntry);
  assert.equal(obs.find((o) => o.id === chair.id).light, true);
  assert.equal(obs.find((o) => o.id === desk.id).light, undefined);
});

// ---------- the shove ----------

test('walking into a chair moves it, and moves it away from you', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  // Standing just short of the chair's near face, so the circle overlaps it.
  const moved = shoveProps(c, 20, 20 - before.hd - WALKER_R + 0.2, WALKER_R);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, chair.id);
  const after = obstacleFor(c, chair.id);
  assert.ok(after.z > before.z, 'shoved along +z, which is away from a walker at -z');
  assert.ok(Math.abs(after.x - before.x) < 1e-9, 'and not sideways, from dead ahead');
});

test('a desk in the same place does not move', () => {
  const s = room();
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const before = { ...obstacleFor(c, desk.id) };
  assert.deepEqual(shoveProps(c, 20, 20 - before.hd - WALKER_R + 0.2, WALKER_R), []);
  assert.equal(obstacleFor(c, desk.id).z, before.z);
});

test('standing clear of it moves nothing', () => {
  const s = room();
  addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  assert.deepEqual(shoveProps(c, 30, 30, WALKER_R), []);
});

test('a lighter row goes further than a heavier one from the same contact', () => {
  const s = room();
  const stool = addProp(s, 'stool-lab-24', { floor: 0, x: 20, z: 20 });
  const lounge = addProp(s, 'chair-lounge', { floor: 0, x: 34, z: 20 });
  const c = collide(s);
  const travel = (id) => {
    const o = obstacleFor(c, id);
    const z0 = o.z;
    // Same overlap depth in both cases: a fifth of a foot inside the face.
    shoveProps(c, o.x, o.z - o.hd - WALKER_R + 0.2, WALKER_R);
    return obstacleFor(c, id).z - z0;
  };
  const light = travel(stool.id);
  const heavy = travel(lounge.id);
  assert.ok(light > 0 && heavy > 0, 'both moved');
  assert.ok(light > heavy * 1.5, `a stool (${light}) outruns a lounge chair (${heavy})`);
});

test('no single frame moves anything further than the cap', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const o = obstacleFor(c, chair.id);
  const before = { x: o.x, z: o.z };
  // Standing dead centre of it — the deepest overlap there is.
  const moved = shoveProps(c, 20, 20, WALKER_R);
  assert.equal(moved.length, 1);
  const went = Math.hypot(o.x - before.x, o.z - before.z);
  assert.ok(went <= MAX_SHOVE + 1e-9, `${went} is within the per-frame cap`);
});

test('a contact too shallow to see does not jitter the furniture', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const o = obstacleFor(c, chair.id);
  // Grazing it: overlapping by a hundredth of MIN_SHOVE.
  const graze = o.z - o.hd - WALKER_R + MIN_SHOVE / 100;
  assert.deepEqual(shoveProps(c, o.x, graze, WALKER_R), []);
});

test('an off-centre shove turns it; a head-on one does not', () => {
  const s = room();
  const a = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const b = addProp(s, 'student-chair', { floor: 0, x: 34, z: 20 });
  const c = collide(s);
  const oa = obstacleFor(c, a.id), ob = obstacleFor(c, b.id);
  shoveProps(c, oa.x, oa.z - oa.hd - WALKER_R + 0.2, WALKER_R);
  assert.equal(obstacleFor(c, a.id).rotationY, 0, 'dead ahead is no torque at all');
  shoveProps(c, ob.x + ob.hw * 0.9, ob.z - ob.hd - WALKER_R + 0.2, WALKER_R);
  assert.notEqual(obstacleFor(c, b.id).rotationY, 0, 'caught with a hip, it turns');
});

// ---------- what stops it ----------

test('a chair against a wall stays against the wall', () => {
  const s = room();
  // The south wall of the room is at z = 13 * CELL; put the chair hard up
  // against it and push it further south.
  const wallZ = 13 * CELL;
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: wallZ - 1.1 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  shoveProps(c, 20, before.z - before.hd - WALKER_R + 0.3, WALKER_R);
  const after = obstacleFor(c, chair.id);
  assert.equal(after.z, before.z, 'nowhere to go, so it went nowhere');
});

test('a chair does not slide inside a desk', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  addProp(s, 'teacher-desk', { floor: 0, x: 20, z: 22 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  shoveProps(c, 20, before.z - before.hd - WALKER_R + 0.3, WALKER_R);
  assert.equal(obstacleFor(c, chair.id).z, before.z, 'the desk is in the way');
});

test('shoveClear says no through a wall and yes in open floor', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const o = obstacleFor(c, chair.id);
  assert.equal(shoveClear(c, o, 20, 20), true, 'the middle of the room is clear');
  assert.equal(shoveClear(c, o, 20, 13 * CELL), false, 'the wall line is not');
});

// ---------- and none of it is stored ----------

test('a shove never reaches the design', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  for (let i = 0; i < 20; i++) shoveProps(c, 20, 19, WALKER_R);
  assert.ok(obstacleFor(c, chair.id).z > 20, 'the collider learned about it');
  assert.equal(s.props[0].x, 20, 'and the design did not');
  assert.equal(s.props[0].z, 20);
  assert.equal(s.props[0].rotationY, 0);
});

test('a walk of many frames keeps pushing, and the chair stays in the room', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 12 });
  const c = collide(s);
  // Walk south into it, a frame at a time, following it as it goes.
  let walker = 9;
  for (let i = 0; i < 200; i++) {
    shoveProps(c, 20, walker, WALKER_R);
    walker += 0.25;
  }
  const o = obstacleFor(c, chair.id);
  assert.ok(o.z > 12, 'it travelled');
  assert.ok(o.z < 13 * CELL, 'and stopped at the far wall rather than going through it');
});

// ---------- with the broad-phase index on ----------

test('an indexed collider finds the chair again after it has moved', () => {
  // The index buckets props by where they were; a shoved prop that is not
  // re-bucketed simply stops being found, and a chair you pushed once can
  // never be pushed again.
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 12 });
  const c = buildCollider(s, 0, catalogEntry);
  assert.ok(c.index, 'this one has an index');
  let walker = 9;
  let shoves = 0;
  for (let i = 0; i < 120; i++) {
    shoves += shoveProps(c, 20, walker, WALKER_R).length;
    walker += 0.25;
  }
  const o = obstacleFor(c, chair.id);
  assert.ok(shoves > 40, `kept finding it (${shoves} shoves)`);
  assert.ok(o.z > 30, `and kept moving it (ended at ${o.z})`);
  assert.ok(o.z < 13 * CELL);
});
