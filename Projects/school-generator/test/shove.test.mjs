// The furniture you walk into. Pure module, like everything else here, so the
// whole of it runs headless: a chair, a walker, and the question of whether
// the chair ended up anywhere sensible.
//
// The thing to hold in mind while reading is the contract. By the time this
// module runs in the real walkthrough, `moveWalker` has already resolved the
// walker to *exactly touching* whatever stopped them — penetration is zero
// every frame, by construction — so a shove cannot be sized by how far inside
// a chair somebody is. It is sized by what this frame's collisions took away
// from them: the step asked for minus the step got. Every test below hands
// that in as `blocked`, and the two states worth separating are "walking into
// it" and "standing against it", which look identical to a contact test and
// are not the same thing at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL } from '../js/grid.js';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { addProp } from '../js/props.js';
import { catalogEntry } from '../js/catalog.js';
import { buildCollider, WALKER_R, propObstacles } from '../js/collide.js';
import {
  shoveProps, shoveClear, shoveWeight, MAX_SHOVE, MIN_SHOVE, REACH, BACKOFF,
} from '../js/shove.js';

// A big open room, walled, so a prop has somewhere to go and one place it
// can't. Cells x 2..12, y 2..12 — 44ft square at 4ft cells.
function room() {
  const s = createState(20, 20);
  const f = sheet(s, 0);
  f.fill(2, 2, 12, 12);
  for (let x = 2; x <= 12; x++) {
    f.edgesH[edgeHIdx(f, x, 2)] = EDGE_WALL;
    f.edgesH[edgeHIdx(f, x, 13)] = EDGE_WALL;
  }
  for (let y = 2; y <= 12; y++) {
    f.edgesV[edgeVIdx(f, 2, y)] = EDGE_WALL;
    f.edgesV[edgeVIdx(f, 13, y)] = EDGE_WALL;
  }
  f.bake();
  return s;
}

const collide = (s) => buildCollider(s, 0, catalogEntry, { index: false });
const obstacleFor = (c, id) => c.props.find((p) => p.id === id);

// One frame of being stopped dead: the whole of the step asked for is the step
// taken away. A tenth of a foot is what a 6ft/s walk covers at sixty frames a
// second.
const STEP = 0.1;
const intoZ = { dx: 0, dz: STEP };        // walking south, stopped
const intoNegZ = { dx: 0, dz: -STEP };    // walking north, stopped
const still = { dx: 0, dz: 0 };           // going nowhere, so blocked by nothing

// Where a walker stopped by the north face of `o` ends up: exactly touching,
// which is what `moveWalker` leaves behind and what this module has to cope
// with.
const touchingNorth = (o) => o.z - o.hd - WALKER_R;

// One frame of walking south into whatever `id` is, from wherever it now is.
const press = (c, id, blocked = intoZ) =>
  shoveProps(c, obstacleFor(c, id).x, touchingNorth(obstacleFor(c, id)), blocked);

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

test('the obstacle record carries the id, the weight and its own index through', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 30, z: 20 });
  const obs = propObstacles(s, 0, catalogEntry);
  assert.equal(obs.find((o) => o.id === chair.id).light, true);
  assert.equal(obs.find((o) => o.id === desk.id).light, undefined);
  // `shoveProps` hands `idx` to the index's `reindex`; if it ever disagreed
  // with the array, a shove would re-bucket somebody else's prop.
  obs.forEach((o, i) => assert.equal(o.idx, i, `${o.type} knows where it is`));
});

// ---------- the shove ----------

test('walking into a chair moves it, and moves it away from you', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  const moved = press(c, chair.id);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, chair.id);
  const after = obstacleFor(c, chair.id);
  assert.ok(after.z > before.z, 'shoved along +z, which is away from a walker at -z');
  assert.ok(Math.abs(after.x - before.x) < 1e-9, 'and not sideways, from dead ahead');
});

test('a walker resolved to exactly touching still shoves', () => {
  // The state the real walkthrough is always in: zero penetration, so a
  // contact test at the body's own radius would find nothing at all. REACH is
  // what makes "pressed against this" detectable rather than always just
  // missed.
  assert.ok(REACH > 0);
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const o = obstacleFor(c, chair.id);
  assert.equal(shoveProps(c, 20, touchingNorth(o), intoZ).length, 1, 'touching is contact');
  assert.deepEqual(shoveProps(c, 20, touchingNorth(o) - REACH - 0.05, intoZ), [],
    'and a hand further back is not');
});

test('nothing was taken away from you, so you pushed nothing', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const z0 = obstacleFor(c, chair.id).z;
  assert.deepEqual(press(c, chair.id, still), [], 'standing against it is not pushing it');
  assert.equal(obstacleFor(c, chair.id).z, z0);
});

test('a chair beside you takes none of the motion something else took', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  // Against its north face, but what stopped you was northward — this chair is
  // behind you, and a wall in front of you is not its fault.
  assert.deepEqual(press(c, chair.id, intoNegZ), []);
});

test('a desk in the same place does not move', () => {
  const s = room();
  const desk = addProp(s, 'teacher-desk', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const before = { ...obstacleFor(c, desk.id) };
  assert.deepEqual(press(c, desk.id), []);
  assert.equal(obstacleFor(c, desk.id).z, before.z);
});

test('standing clear of it moves nothing', () => {
  const s = room();
  addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  assert.deepEqual(shoveProps(c, 30, 30, intoZ), []);
});

test('a shove moves it about as far as you were stopped', () => {
  // The whole feel of it: a chair travels at the speed you walked into it,
  // not at the speed of some spring.
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const z0 = obstacleFor(c, chair.id).z;
  press(c, chair.id);
  const went = obstacleFor(c, chair.id).z - z0;
  assert.ok(Math.abs(went - STEP) < 1e-9, `${went} is the step that was taken away`);
});

test('a lighter row goes further than a heavier one from the same shove', () => {
  const s = room();
  const stool = addProp(s, 'stool-lab-24', { floor: 0, x: 20, z: 20 });
  const lounge = addProp(s, 'chair-lounge', { floor: 0, x: 34, z: 20 });
  const c = collide(s);
  const travel = (id) => {
    const z0 = obstacleFor(c, id).z;
    press(c, id);
    return obstacleFor(c, id).z - z0;
  };
  const light = travel(stool.id);
  const heavy = travel(lounge.id);
  assert.ok(light > 0 && heavy > 0, 'both moved');
  assert.ok(light > heavy * 1.5, `a stool (${light}) outruns a lounge chair (${heavy})`);
});

test('a shove that will not fit whole takes as much of itself as does', () => {
  // The frame-rate independence this buys: a long frame asks for a big shove,
  // and the gap to the desk is smaller than that. Without the backoff the
  // chair would simply refuse to move on a slow frame and move freely on a
  // fast one — the same walk, a different answer.
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  addProp(s, 'teacher-desk', { floor: 0, x: 20, z: 22.1 });
  const c = collide(s);
  const z0 = obstacleFor(c, chair.id).z;
  const moved = press(c, chair.id, { dx: 0, dz: 10 });   // a very long frame
  assert.equal(moved.length, 1, 'it moved');
  const went = obstacleFor(c, chair.id).z - z0;
  assert.ok(went > 0 && went < MAX_SHOVE - 1e-9, `${went} is a fraction of the full shove`);
  assert.ok(BACKOFF[0] === 1, 'the first thing tried is the whole of it');
});

test('no single frame moves anything further than the cap', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  // A frame so long the walker asked for ten feet and got none of it — a tab
  // that was in the background, or a headset re-projecting.
  const moved = press(c, chair.id, { dx: 0, dz: 10 });
  assert.equal(moved.length, 1);
  const o = obstacleFor(c, chair.id);
  const went = Math.hypot(o.x - before.x, o.z - before.z);
  assert.ok(went <= MAX_SHOVE + 1e-9, `${went} is within the per-frame cap`);
});

test('a shove too small to see does not jitter the furniture', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const c = collide(s);
  assert.deepEqual(press(c, chair.id, { dx: 0, dz: MIN_SHOVE / 100 }), []);
});

test('an off-centre shove turns it; a head-on one does not', () => {
  const s = room();
  const a = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  const b = addProp(s, 'student-chair', { floor: 0, x: 34, z: 20 });
  const c = collide(s);
  press(c, a.id);
  assert.equal(obstacleFor(c, a.id).rotationY, 0, 'dead ahead is no torque at all');
  const ob = obstacleFor(c, b.id);
  shoveProps(c, ob.x + ob.hw * 0.9, touchingNorth(ob), intoZ);
  assert.notEqual(obstacleFor(c, b.id).rotationY, 0, 'caught with a hip, it turns');
});

// ---------- what stops it ----------

test('a chair hard against a wall has nowhere to go', () => {
  const s = room();
  // The south wall of the room is at z = 13 * CELL; put the chair as close to
  // it as the clearance test allows and push it further south.
  const wallZ = 13 * CELL;
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: wallZ - 0.7 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  press(c, chair.id);
  assert.equal(obstacleFor(c, chair.id).z, before.z, 'snug already, so it went nowhere');
});

test('a chair shoved at a wall creeps up to it and stops', () => {
  // Not the same claim: from a foot out it *does* move, because a shove backs
  // off to a fraction that fits rather than refusing outright. What it must
  // never do is end up in the wall.
  const wallZ = 13 * CELL;
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: wallZ - 1.6 });
  const c = collide(s);
  for (let i = 0; i < 60; i++) press(c, chair.id);
  const o = obstacleFor(c, chair.id);
  assert.ok(o.z > wallZ - 1.6, 'it closed the gap');
  assert.ok(o.z < wallZ, `it stopped short of the wall (${o.z} vs ${wallZ})`);
  // And having stopped, it stays stopped.
  const settled = o.z;
  for (let i = 0; i < 20; i++) press(c, chair.id);
  assert.equal(obstacleFor(c, chair.id).z, settled, 'no creeping through');
});

test('a chair does not slide inside a desk', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 20 });
  addProp(s, 'teacher-desk', { floor: 0, x: 20, z: 21.9 });
  const c = collide(s);
  const before = { ...obstacleFor(c, chair.id) };
  press(c, chair.id);
  assert.equal(obstacleFor(c, chair.id).z, before.z, 'the desk is in the way');
});

test('shoveClear knows the real footprint, not a circle of its half-width', () => {
  // Phase 22: a hand-built collider, no walls — just a long thin prop and a
  // box off to the side of its end. A circle of min(hw, hd) at the centre
  // never reaches the box; the real footprint's end lands inside it.
  const long = { id: 1, x: 0, z: 0, hw: 3, hd: 0.5, rotationY: 0, light: true };
  const other = { id: 2, x: 2.5, z: 2, hw: 0.5, hd: 0.5, rotationY: 0 };
  const c = { segs: [], props: [long, other], doors: [], index: null };
  assert.equal(shoveClear(c, long, 0, 2), false,
    'slid alongside, its far end is inside the other box');
  assert.equal(shoveClear(c, long, 0, 0.5), true, 'clear floor is still clear');
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
  for (let i = 0; i < 20; i++) press(c, chair.id);
  assert.ok(obstacleFor(c, chair.id).z > 20, 'the collider learned about it');
  assert.equal(s.props[0].x, 20, 'and the design did not');
  assert.equal(s.props[0].z, 20);
  assert.equal(s.props[0].rotationY, 0);
});

test('a walk of many frames keeps pushing, and the chair stays in the room', () => {
  const s = room();
  const chair = addProp(s, 'student-chair', { floor: 0, x: 20, z: 12 });
  const c = collide(s);
  // Walking south into it, a frame at a time, staying pressed against it the
  // way a walker resolved by `moveWalker` is.
  for (let i = 0; i < 800; i++) press(c, chair.id);
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
  let shoves = 0;
  for (let i = 0; i < 300; i++) shoves += press(c, chair.id).length;
  const o = obstacleFor(c, chair.id);
  assert.ok(shoves > 200, `kept finding it (${shoves} shoves)`);
  assert.ok(o.z > 30, `and kept moving it (ended at ${o.z})`);
  assert.ok(o.z < 13 * CELL);
});
