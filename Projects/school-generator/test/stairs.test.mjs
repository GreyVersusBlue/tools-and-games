// Tests for stairs.js — the run geometry, the opening it cuts, the railings
// around that opening, and walking up one. Pure module, so all of it runs under
// `node --test` from Projects/school-generator with no browser and no build.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, setTile, addFloor, removeFloor, FLOOR_H } from '../js/grid.js';
import { addShape } from '../js/shapes.js';
import { serialize, deserialize } from '../js/save-load.js';
import { buildSampleSchool } from '../js/sample.js';
import {
  RISER_TARGET, TREAD, LANDING, HEADROOM, STAIR_W, CUT_MARGIN,
  stairRun, stairMetrics, stairWidth, openingSize, cutStart,
  localToWorld, worldToLocal, footprintBox, cutBox, rectCorners,
  footprintPolygon, cutPolygon, pointInPolygon,
  floorCuts, inFloorCut, cellCut, openingRails,
  stairSurfaceAt, stairUnder, linkAt, linkById, linksFrom, addStair, stairsOf,
  floorSolidAt,
  RAMP_SLOPE, RAMP_W, MIN_RAMP_SLOPE, MAX_RAMP_SLOPE, ELEV_W, ELEV_D,
  LINK_KINDS, RUN_TYPES, isRun, isElevator, rampSlope, runLength, runMetrics,
  elevatorSize, elevatorWalls, elevatorDoorWidth, elevatorsOn, elevatorAt,
} from '../js/stairs.js';

const HALF_PI = Math.PI / 2;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function twoFloors() {
  const s = createState(40, 30);
  addFloor(s);
  s.currentFloor = 0;
  return s;
}

// ---------- the run ----------

test('a run fits whole risers into the storey height', () => {
  const m = stairRun(FLOOR_H);
  assert.equal(m.steps, 21);
  assert.ok(near(m.riser * m.steps, FLOOR_H), 'the risers add up to exactly one storey');
  assert.ok(Math.abs(m.riser - RISER_TARGET) < 0.05, 'and land near the 7in target');
  assert.ok(near(m.run, m.steps * TREAD));
  assert.equal(m.rise, FLOOR_H);
});

test('a shallower storey gets fewer, shorter steps and a shorter run', () => {
  const tall = stairRun(FLOOR_H);
  const short = stairRun(8);
  assert.ok(short.steps < tall.steps);
  assert.ok(short.run < tall.run);
  assert.ok(near(short.riser * short.steps, 8));
});

test('a nonsense floor height falls back rather than dividing by zero', () => {
  for (const h of [0, -4, NaN, undefined]) {
    const m = stairRun(h);
    assert.ok(m.steps >= 3 && Number.isFinite(m.riser) && m.riser > 0, `height ${h}`);
  }
});

test('the cut starts where the run stops clearing the floor above', () => {
  const m = stairRun(FLOOR_H);
  const z = cutStart(m);
  // Just before it, a person's head is still under the slab; just after, it isn't.
  const heightAt = (t) => (t / m.run) * m.rise;
  assert.ok(heightAt(z - 0.1) + HEADROOM < m.rise);
  assert.ok(heightAt(z + 0.1) + HEADROOM > m.rise);
});

test('stair width and opening size clamp whatever the file offered', () => {
  assert.equal(stairWidth({ data: {} }), STAIR_W);
  assert.equal(stairWidth({ data: { width: 999 } }), 12);
  assert.equal(stairWidth({ data: { width: 0.1 } }), 3);
  assert.equal(stairWidth({ data: { width: 'wide' } }), STAIR_W);
  assert.deepEqual(openingSize({ data: { w: 1, d: 500 } }), { w: 3, d: 120 });
});

// ---------- local frame ----------

test('local +Z is the way you walk up, whatever the heading', () => {
  const link = { x: 10, z: 20, rotationY: HALF_PI, type: 'stair', data: {} };
  // rotationY = atan2(dx, dz) = pi/2 points local +Z along world +X.
  const up = localToWorld(link, 0, 5);
  assert.ok(near(up.x, 15) && near(up.z, 20));
  // ...and the sideways axis follows it round.
  const side = localToWorld(link, 2, 0);
  assert.ok(near(side.x, 10) && near(side.z, 18));
});

test('world -> local undoes local -> world', () => {
  const link = { x: -13.5, z: 7.25, rotationY: 0.9, type: 'stair', data: {} };
  for (const [lx, lz] of [[0, 0], [2, 19], [-3.5, 0.5]]) {
    const w = localToWorld(link, lx, lz);
    const back = worldToLocal(link, w.x, w.z);
    assert.ok(near(back.lx, lx, 1e-9) && near(back.lz, lz, 1e-9));
  }
});

// ---------- footprint and cut ----------

test('a stair stands on its run and cuts a longer hole above it', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { x: 40, z: 40 });
  const m = stairMetrics(s);
  const foot = footprintBox(link, m);
  const cut = cutBox(link, m);
  assert.deepEqual([foot.z0, foot.z1], [0, m.run]);
  assert.ok(near(foot.x1 - foot.x0, STAIR_W));
  // The hole is wider than the run by its margins, starts partway up it, and
  // carries on past the top by a landing.
  assert.ok(near(cut.x1 - cut.x0, STAIR_W + CUT_MARGIN * 2));
  assert.ok(cut.z0 > 0 && cut.z0 < m.run);
  assert.ok(near(cut.z1, m.run + LANDING));
});

test('a plain opening is its own footprint, and its own hole', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'opening', x: 20, z: 20, w: 10, d: 6 });
  const m = stairMetrics(s);
  assert.deepEqual(footprintBox(link, m), cutBox(link, m));
  assert.deepEqual(footprintBox(link, m), { x0: -5, x1: 5, z0: -3, z1: 3 });
});

test('rect corners come back wound one consistent way, turned or not', () => {
  const area = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    }
    return a / 2;
  };
  const box = { x0: -2, x1: 2, z0: 0, z1: 10 };
  for (const rotationY of [0, HALF_PI, Math.PI, 2.3, -1.1]) {
    const pts = rectCorners({ x: 3, z: 4, rotationY }, box);
    assert.equal(pts.length, 4);
    assert.ok(area(pts) > 0, `winding holds at ${rotationY}`);
    assert.ok(near(Math.abs(area(pts)), 40, 1e-6), 'and rotation preserves area');
  }
});

test('a turned stair puts its footprint where you walked', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { x: 100, z: 40, rotationY: HALF_PI });
  const m = stairMetrics(s);
  const pts = footprintPolygon(link, m);
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  assert.ok(near(Math.min(...xs), 100) && near(Math.max(...xs), 100 + m.run));
  assert.ok(near(Math.min(...zs), 38) && near(Math.max(...zs), 42));
});

// ---------- what a floor sees ----------

test('the hole belongs to the storey above, not the one the stair stands on', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { x: 40, z: 40 });
  assert.deepEqual([link.from, link.to], [0, 1]);
  assert.equal(floorCuts(s, 0).length, 0, 'the ground floor keeps its slab');
  assert.equal(floorCuts(s, 1).length, 1, 'the level above is opened');
  const m = stairMetrics(s);
  const cut = cutPolygon(link, m);
  assert.ok(pointInPolygon(cut, 40, 40 + m.run));
  assert.ok(!pointInPolygon(cut, 40, 40 - 1), 'nothing is cut behind the bottom step');
});

test('inFloorCut and cellCut agree about where the floor is missing', () => {
  const s = twoFloors();
  addStair(s, 0, { type: 'opening', x: 40, z: 40, w: 8, d: 8 });
  const cuts = floorCuts(s, 1);
  assert.ok(inFloorCut(cuts, 40, 40));
  assert.ok(!inFloorCut(cuts, 40, 60));
  // (10, 10) in cells is 40..44ft — it overlaps the 36..44ft hole.
  assert.ok(cellCut(cuts, 9, 9), 'a cell wholly inside is cut');
  assert.ok(cellCut(cuts, 10, 10), 'and so is one only partly over the hole');
  assert.ok(!cellCut(cuts, 12, 12), 'a cell clear of it is left alone');
  assert.ok(!cellCut([], 9, 9), 'no cuts, no holes');
});

// ---------- railings ----------

test('a stair opening is railed on three sides — you arrive on the fourth', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { x: 40, z: 40 });
  const rails = openingRails(link, stairMetrics(s));
  assert.equal(rails.length, 3);
  assert.ok(!rails.some((r) => r.side === 'far'), 'the landing side is left open');
});

test('a plain floor opening is railed all the way round', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'opening', x: 40, z: 40 });
  assert.equal(openingRails(link, stairMetrics(s)).length, 4);
});

// ---------- walking on one ----------

test('the surface climbs from the bottom step to the storey above', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { x: 40, z: 40 });
  const m = stairMetrics(s);
  assert.ok(near(stairSurfaceAt(link, m, 40, 40), 0), 'flat at the bottom');
  assert.ok(near(stairSurfaceAt(link, m, 40, 40 + m.run / 2), m.rise / 2), 'half way up in the middle');
  assert.ok(near(stairSurfaceAt(link, m, 40, 40 + m.run), m.rise), 'a full storey at the top');
  assert.ok(near(stairSurfaceAt(link, m, 40, 40 + m.run + 2), m.rise), 'and level across the landing');
  assert.equal(stairSurfaceAt(link, m, 40, 40 - 3), null, 'nothing before the first step');
  assert.equal(stairSurfaceAt(link, m, 60, 45), null, 'nothing off to the side');
});

test('a plain opening is not something you can walk up', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'opening', x: 40, z: 40 });
  assert.equal(stairSurfaceAt(link, stairMetrics(s), 40, 40), null);
});

test('stairUnder reports the world height, and picks the nearer of two stacked runs', () => {
  const s = createState(40, 30);
  addFloor(s); addFloor(s);
  const lower = addStair(s, 0, { x: 40, z: 40 }).link;
  const upper = addStair(s, 1, { x: 40, z: 40 }).link;
  const m = stairMetrics(s);
  const mid = 40 + m.run / 2;

  const fromBelow = stairUnder(s, 40, mid, 1);
  assert.equal(fromBelow.link.id, lower.id);
  assert.ok(near(fromBelow.y, m.rise / 2));

  const fromAbove = stairUnder(s, 40, mid, FLOOR_H + 4);
  assert.equal(fromAbove.link.id, upper.id);
  assert.ok(near(fromAbove.y, FLOOR_H + m.rise / 2));

  assert.equal(stairUnder(s, 200, 200, 1), null, 'nowhere near a stair');
});

// ---------- placing, picking, removing ----------

test('a stair needs somewhere to arrive', () => {
  const s = createState(20, 20);
  const first = addStair(s, 0, { x: 20, z: 20 });
  assert.equal(first.link, null);
  assert.match(first.reason, /level above/);
  addFloor(s);
  assert.ok(addStair(s, 0, { x: 20, z: 20 }).link, 'and places once there is one');
});

test('a placed link is picked back up by where it stands', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { x: 40, z: 40, rotationY: HALF_PI });
  const m = stairMetrics(s);
  assert.equal(linkAt(s, 0, 40 + m.run / 2, 40).id, link.id);
  assert.equal(linkAt(s, 0, 40, 80), null, 'not from across the room');
  assert.equal(linkAt(s, 1, 40 + m.run / 2, 40), null, 'and not from the storey it climbs to');
  assert.equal(linkById(s, link.id).id, link.id);
  assert.equal(linksFrom(s, 0).length, 1);
  assert.equal(linksFrom(s, 1).length, 0);
});

test('the topmost link wins when two overlap', () => {
  const s = twoFloors();
  addStair(s, 0, { x: 40, z: 40 });
  const second = addStair(s, 0, { x: 40, z: 40 }).link;
  assert.equal(linkAt(s, 0, 40, 45).id, second.id);
});

test('deleting a storey takes the stairs anchored to it', () => {
  const s = createState(20, 20);
  addFloor(s); addFloor(s);
  addStair(s, 0, { x: 20, z: 20 });   // 0 -> 1
  addStair(s, 1, { x: 20, z: 20 });   // 1 -> 2
  assert.equal(stairsOf(s).length, 2);
  removeFloor(s, 2);
  assert.equal(stairsOf(s).length, 1, 'the run that arrived at the deleted level goes with it');
  assert.deepEqual([stairsOf(s)[0].from, stairsOf(s)[0].to], [0, 1]);
});

// ---------- persistence ----------

test('stairs survive a save round-trip with their width and heading', () => {
  const s = twoFloors();
  addStair(s, 0, { x: 33.5, z: 41.25, rotationY: HALF_PI, width: 6 });
  addStair(s, 0, { type: 'opening', x: 60, z: 60, w: 12, d: 9 });
  const back = deserialize(serialize(s));
  assert.equal(back.links.length, 2);
  const [stair, opening] = back.links;
  assert.deepEqual(
    [stair.type, stair.from, stair.to, stair.x, stair.z],
    ['stair', 0, 1, 33.5, 41.25]
  );
  assert.equal(stairWidth(stair), 6);
  assert.ok(near(stair.rotationY, HALF_PI));
  assert.deepEqual(openingSize(opening), { w: 12, d: 9 });
  // ...and the hole they cut is the same hole after the trip.
  assert.deepEqual(floorCuts(back, 1), floorCuts(s, 1));
});

test('a hostile links table loads as far as it can and no further', () => {
  const s = twoFloors();
  setTile(s.floors[0], 0, 0, true);
  const json = JSON.stringify({
    ...s,
    links: [
      { type: 'stair', from: 0, to: 1, x: 1e9, z: -1e9, data: { width: 1e6 } },
      { type: 'teleporter', from: 0, to: 1, x: 0, z: 0 },   // not a link kind
      { type: 'stair', from: 2, to: 2, x: 0, z: 0 },        // goes nowhere
      null,
    ],
  });
  const back = deserialize(json);
  assert.equal(back.links.length, 1, 'only the one that could be made sense of');
  assert.ok(Math.abs(back.links[0].x) <= 4000, 'clamped to a sane extent');
  assert.equal(stairWidth(back.links[0]), 12, 'and to a buildable width');
});

// ---------- the sample school ----------

test('the sample school has a stair that lands on its upper floor', () => {
  const s = buildSampleSchool();
  assert.equal(s.floors.length, 2);
  assert.equal(s.currentFloor, 0, 'and opens on the ground floor');
  const stairs = stairsOf(s).filter((l) => l.type === 'stair');
  assert.equal(stairs.length, 1);

  const m = stairMetrics(s);
  const cut = cutPolygon(stairs[0], m);
  // The opening lands inside the upper floor's stair hall (cells x 27..33,
  // y 7..12 — 108..136ft by 28..52ft) rather than out over the car park.
  for (const p of cut) {
    assert.ok(p.x > 108 && p.x < 136, `cut x ${p.x} inside the stair hall`);
    assert.ok(p.z > 28 && p.z < 52, `cut z ${p.z} inside the stair hall`);
  }
  // ...and walking off the top of it puts you on floor cells that still exist.
  const top = localToWorld(stairs[0], 0, m.run + LANDING + 3);
  const cuts = floorCuts(s, 1);
  assert.ok(!inFloorCut(cuts, top.x, top.z), 'the far side of the landing is solid floor');
});

test('the sample school glazes a wall on each storey', () => {
  const s = buildSampleSchool();
  const glazed = (floor) => floor.shapes.some(
    (sh) => sh.rings.some((r) => r.walls.includes(2)));
  const [ground, upper] = s.floors;
  assert.ok(glazed(ground), 'glass downstairs');
  assert.ok(glazed(upper), 'and up');
  // ...and one of them is on the free-drawn room, which is where the curtain
  // wall is rather than an office front.
  const commons = ground.shapes.find((sh) => sh.name === 'Learning Commons');
  assert.ok(commons && commons.rings[0].walls.includes(2), 'and a glazed polygon segment');
});

test('the sample school opens a railed atrium through both storeys', () => {
  const s = buildSampleSchool();
  const [ground, upper] = s.floors;
  const atrium = stairsOf(s).find((l) => l.type === 'opening');
  assert.ok(atrium, 'the hall is open through the upper floor');

  const m = stairMetrics(s);
  // Every side of it has upper-floor corridor to stand on, so every side is
  // railed — and the hole reaches both the upper slab and the ceiling below it.
  assert.equal(openingRails(atrium, m, upper).length, 4);
  const cuts = floorCuts(s, 1);
  assert.ok(inFloorCut(cuts, atrium.x, atrium.z), 'the upper slab is open over the hall');
  assert.ok(!inFloorCut(floorCuts(s, 0), atrium.x, atrium.z), 'the hall floor itself is not');
  assert.ok(cellCut(cuts, Math.floor(atrium.x / 4), Math.floor(atrium.z / 4)));
  assert.ok(!floorSolidAt(null, 0, 0));
  assert.ok(floorSolidAt(ground, atrium.x, atrium.z), 'and you can still walk under it');
});

test('a rail is not hung in mid-air where the floor above stops short', () => {
  const s = createState(20, 20);
  addFloor(s);
  const [ground, upper] = s.floors;
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) setTile(ground, x, y, true);
  // The upper storey covers only the north half, so an opening on its edge has
  // floor on one side of it and forty feet of nothing on the other.
  for (let x = 0; x < 10; x++) for (let y = 0; y < 5; y++) setTile(upper, x, y, true);
  const { link } = addStair(s, 0, { type: 'opening', x: 20, z: 16, w: 8, d: 8 });
  const m = stairMetrics(s);
  assert.equal(openingRails(link, m).length, 4, 'all four sides, asked bluntly');
  const kept = openingRails(link, m, upper).map((r) => r.side).sort();
  assert.deepEqual(kept, ['left', 'near', 'right'],
    'but not the one whose far side is open air');
});

test('an empty design has no stairs to draw and nothing to cut', () => {
  const s = createState(10, 10);
  assert.deepEqual(stairsOf(s), []);
  assert.deepEqual(floorCuts(s, 0), []);
  assert.equal(stairUnder(s, 0, 0, 0), null);
  addShape(s, 0, [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
  assert.deepEqual(floorCuts(s, 0), [], 'a polygon room alone opens no holes');
});


// ---------- ramps ----------
//
// A ramp is the stair's own machinery at a different pitch, so most of what is
// tested here is that it went through the *same* code — not a parallel path.

test('a ramp is a run whose length comes off its slope, not its risers', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 20 });
  assert.ok(link);
  const m = stairMetrics(s);
  assert.equal(runLength(link, m), m.rise * RAMP_SLOPE);
  assert.equal(runLength(link, m), FLOOR_H * 12, '144ft at the ADA maximum, and we say so');
  const rm = runMetrics(link, m);
  assert.equal(rm.steps, 0, 'no risers');
  assert.equal(rm.riser, 0);
  assert.ok(rm.pitch > 0 && rm.pitch < 0.1, 'and a very shallow pitch');
});

test('a ramp gets steeper on demand, and never past the limits', () => {
  const s = twoFloors();
  const steep = addStair(s, 0, { type: 'ramp', x: 20, z: 20, slope: 8 }).link;
  assert.equal(rampSlope(steep), 8);
  assert.equal(runLength(steep, stairMetrics(s)), FLOOR_H * 8);
  assert.equal(rampSlope({ type: 'ramp', data: { slope: 900 } }), MAX_RAMP_SLOPE);
  assert.equal(rampSlope({ type: 'ramp', data: { slope: 0.1 } }), MIN_RAMP_SLOPE);
  assert.equal(rampSlope({ type: 'ramp', data: {} }), RAMP_SLOPE);
});

test('a ramp is walkable end to end, as a continuous slope', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 20, slope: 8 });
  const m = stairMetrics(s);
  const run = runLength(link, m);
  assert.ok(isRun(link));
  assert.equal(stairSurfaceAt(link, m, 20, 20), 0, 'at the bottom you are on the floor');
  assert.ok(near(stairSurfaceAt(link, m, 20, 20 + run / 2), m.rise / 2), 'halfway up, halfway');
  assert.equal(stairSurfaceAt(link, m, 20, 20 + run), m.rise, 'and at the top, arrived');
  assert.equal(stairSurfaceAt(link, m, 20, 20 + run + LANDING + 1), null, 'past the landing, off it');
  assert.equal(stairSurfaceAt(link, m, 20 + RAMP_W, 20 + run / 2), null, 'and off the side is off it');
});

test('a ramp cuts its own hole the same way a stair does', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'ramp', x: 20, z: 20, slope: 8 });
  const m = stairMetrics(s);
  const box = cutBox(link, m);
  const run = runLength(link, m);
  assert.ok(box.z1 > run, 'the cut runs past the top step onto the landing');
  assert.ok(box.z0 > 0 && box.z0 < run, 'and starts where headroom runs out, not at the bottom');
  assert.equal(floorCuts(s, 1).length, 1);
  assert.deepEqual(openingRails(link, m).map((r) => r.side).sort(),
    ['left', 'near', 'right'], 'railed everywhere but the landing you walk off');
});

// ---------- elevators ----------

test('an elevator serves two levels and cuts nothing at all', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'elevator', x: 40, z: 40 });
  assert.ok(link);
  assert.ok(isElevator(link));
  assert.equal(isRun(link), false, 'there is no run to walk up');
  const m = stairMetrics(s);
  assert.equal(cutBox(link, m), null);
  assert.equal(cutPolygon(link, m), null);
  assert.deepEqual(floorCuts(s, 1), [], 'the slab above is whole — you arrive on top of it');
  assert.deepEqual(openingRails(link, m), [], 'and there is no hole to rail');
  assert.equal(stairSurfaceAt(link, m, 40, 40), null, 'nothing to stand on but the floor');
});

test('an elevator belongs to both its storeys, unlike every other link', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'elevator', x: 40, z: 40 });
  addStair(s, 0, { type: 'stair', x: 80, z: 40 });
  assert.deepEqual(elevatorsOn(s, 0).map((l) => l.id), [link.id]);
  assert.deepEqual(elevatorsOn(s, 1).map((l) => l.id), [link.id], 'the car is a room on each');
  // ...and can be picked from either, which `linksFrom` alone would not allow.
  assert.equal(linkAt(s, 0, 40, 40).id, link.id);
  assert.equal(linkAt(s, 1, 40, 40).id, link.id);
});

test('standing in a car finds the other floor; standing beside it does not', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'elevator', x: 40, z: 40 });
  const ht = s.floorHt;
  const up = elevatorAt(s, 40, 40, 0);
  assert.ok(up);
  assert.equal(up.to, 1);
  assert.equal(up.y, ht);
  const down = elevatorAt(s, 40, 40, 1);
  assert.equal(down.to, 0, 'and it goes back');
  assert.equal(down.y, 0);
  assert.equal(elevatorAt(s, 40 + ELEV_W, 40, 0), null, 'leaning on the outside is not riding');
  assert.equal(elevatorAt(s, 40, 40, 0).link.id, link.id);
});

test('an elevator turns with its rotation, doors and all', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'elevator', x: 0, z: 0, rotationY: HALF_PI });
  assert.ok(elevatorAt(s, 0, 0, 0), 'still in the car when it is turned');
  // The car is 7 wide (local x) by 5.5 deep (local z); turned a quarter turn,
  // those swap over in world space — so the car is now the long way along z.
  assert.ok(elevatorAt(s, 0, 2.5, 0), 'roomy along world z now, where the width went');
  assert.equal(elevatorAt(s, 3.5, 0, 0), null, 'and tight along world x, where the depth went');
  assert.equal(elevatorAt(s, 0, ELEV_W / 2 + 1, 0), null, 'past the end of it either way');
});

test('the shaft walls bound the car and leave one way in', () => {
  const s = twoFloors();
  const { link } = addStair(s, 0, { type: 'elevator', x: 40, z: 40 });
  const walls = elevatorWalls(link);
  assert.equal(walls.length, 5, 'three sides plus two jambs');
  assert.deepEqual(walls.map((w) => w.side), ['left', 'right', 'back', 'jamb', 'jamb']);
  const door = elevatorDoorWidth(link);
  assert.ok(door > 2.5 && door < elevatorSize(link).w, 'wide enough to walk through, narrower than the car');
  // Every wall is a real segment, not a degenerate point.
  for (const w of walls) {
    assert.ok(Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) > 0.1, `${w.side} has length`);
  }
});

test('the new kinds need a level above, and say so in their own words', () => {
  const s = createState(20, 20);   // one storey
  for (const type of ['ramp', 'elevator']) {
    const { link, reason } = addStair(s, 0, { type });
    assert.equal(link, null);
    assert.ok(/above first/.test(reason), `${type}: ${reason}`);
  }
});

test('ramps and elevators survive a save round trip with their settings', () => {
  const s = twoFloors();
  addStair(s, 0, { type: 'ramp', x: 12, z: 12, slope: 10, width: 5 });
  addStair(s, 0, { type: 'elevator', x: 40, z: 40, w: 8, d: 6 });
  const back = deserialize(serialize(s));
  assert.deepEqual(back.links, s.links);
  const [ramp, lift] = back.links;
  assert.equal(rampSlope(ramp), 10);
  assert.equal(stairWidth(ramp), 5);
  assert.deepEqual(elevatorSize(lift), { w: 8, d: 6 });
});

test('every link kind is a known link kind', () => {
  assert.deepEqual(LINK_KINDS, ['stair', 'opening', 'ramp', 'elevator']);
  assert.deepEqual(RUN_TYPES, ['stair', 'ramp']);
  assert.equal(isRun({ type: 'opening' }), false);
  assert.equal(isRun(null), false);
  assert.equal(isElevator(null), false);
  assert.ok(ELEV_W >= 6 && ELEV_D >= 5, 'a school car takes a wheelchair and an attendant');
});
