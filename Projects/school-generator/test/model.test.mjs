// Data-model tests for the parts of School Generator that don't need a browser:
// grid.js, props.js and the save format. Polygon rooms have their own file
// (shapes.test.mjs). Run `node --test` from Projects/school-generator
// (no dependencies, no build step).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL, FLOOR_H, MAX_FLOORS, EDGE_WALL, EDGE_GLASS, EDGE_RAIL,
  createState, createFloor,
  activeFloor, floorBaseY, topOfBuilding, wallHeightOf, floorCellCount,
  addFloor, duplicateFloor, removeFloor, setCurrentFloor,
  setTile, getCell, floodRegion, computeLabels, cellIdx, edgeHIdx,
} from '../js/grid.js';
import { buildSampleSchool } from '../js/sample.js';
import {
  addProp, removeProp, getProp, propsOnFloor, propCell,
  addLink, removeLink, linksOnFloor, normalizeProp, normalizeLink, reseedIds,
} from '../js/props.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { isDefaultEnv } from '../js/sky.js';

// ---------- grid basics still hold, one floor at a time ----------

test('a new state is one empty floor on a shared footprint', () => {
  const s = createState(10, 8);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.floors.length, 1);
  assert.equal(s.currentFloor, 0);
  assert.deepEqual([s.w, s.h], [10, 8]);
  assert.deepEqual([s.floors[0].w, s.floors[0].h], [10, 8]);
  assert.equal(floorCellCount(s.floors[0]), 0);
  assert.deepEqual(s.props, []);
  assert.deepEqual(s.links, []);
});

test('flood fill and labels operate on a single floor', () => {
  const s = createState(8, 8);
  addFloor(s);
  const [ground, upper] = s.floors;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) setTile(ground, x, y, true);
  setTile(upper, 0, 0, true);

  assert.equal(floodRegion(ground, 0, 0).length, 16);
  assert.equal(floodRegion(upper, 0, 0).length, 1);
  assert.equal(floodRegion(upper, 1, 1).length, 0, 'upper floor is otherwise empty');

  ground.cells[cellIdx(ground, 0, 0)].room = 'Gym';
  ground.cells[cellIdx(ground, 0, 0)].color = '#b8dfa2';
  assert.deepEqual(computeLabels(ground).map((l) => l.name), ['Gym']);
  assert.deepEqual(computeLabels(upper), []);
});

test('a wall on one floor does not bound the floor above', () => {
  const s = createState(6, 6);
  addFloor(s);
  const [ground, upper] = s.floors;
  for (const f of [ground, upper])
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) setTile(f, x, y, true);
  for (let x = 0; x < 4; x++) ground.edgesH[edgeHIdx(ground, x, 2)] = 1;

  assert.equal(floodRegion(ground, 0, 0).length, 8, 'wall splits the ground floor');
  assert.equal(floodRegion(upper, 0, 0).length, 16, 'upper floor is untouched');
});

// ---------- floor stacking ----------

test('floor elevations stack by floor-to-floor height', () => {
  const s = createState();
  addFloor(s);
  addFloor(s);
  assert.equal(s.floors.length, 3);
  assert.deepEqual([0, 1, 2].map((i) => floorBaseY(s, i)), [0, FLOOR_H, FLOOR_H * 2]);
  assert.equal(topOfBuilding(s), FLOOR_H * 2 + 10);
  // levels with something above them run full height so there's no gap band
  assert.deepEqual([0, 1, 2].map((i) => wallHeightOf(s, i)), [FLOOR_H, FLOOR_H, 10]);
});

test('adding a floor selects it and caps out at MAX_FLOORS', () => {
  const s = createState();
  for (let i = 1; i < MAX_FLOORS; i++) assert.equal(addFloor(s), i);
  assert.equal(s.floors.length, MAX_FLOORS);
  assert.equal(addFloor(s), -1, 'refuses past the cap');
  assert.equal(s.floors.length, MAX_FLOORS);
});

test('duplicating a floor copies structure without sharing it', () => {
  const s = createState(6, 6);
  const ground = s.floors[0];
  setTile(ground, 1, 1, true);
  ground.cells[cellIdx(ground, 1, 1)].room = 'Room 101';
  ground.edgesH[edgeHIdx(ground, 1, 1)] = 2;

  assert.equal(duplicateFloor(s, 0), 1);
  const upper = s.floors[1];
  assert.equal(upper.cells[cellIdx(upper, 1, 1)].room, 'Room 101');
  assert.equal(upper.edgesH[edgeHIdx(upper, 1, 1)], 2);

  upper.cells[cellIdx(upper, 1, 1)].room = 'Room 201';
  setTile(upper, 2, 2, true);
  assert.equal(ground.cells[cellIdx(ground, 1, 1)].room, 'Room 101', 'cells are cloned');
  assert.equal(getCell(ground, 2, 2), null, 'edits do not leak downward');
});

test('inserting a floor renumbers the props and links above it', () => {
  const s = createState();
  addFloor(s);           // -> 2 floors, current = 1
  const upperDesk = addProp(s, 'desk', { floor: 1 });
  const groundDesk = addProp(s, 'desk', { floor: 0 });
  const stair = addLink(s, 'stair', { from: 0, to: 1, x: 8, z: 8 });

  addFloor(s, 1);        // squeeze a new level between them
  assert.equal(s.floors.length, 3);
  assert.equal(getProp(s, upperDesk.id).floor, 2, 'prop rode up with its floor');
  assert.equal(getProp(s, groundDesk.id).floor, 0, 'ground floor unaffected');
  assert.deepEqual([stair.from, stair.to], [0, 2], 'link endpoints follow');
});

test('removing a floor drops what was anchored to it and shifts the rest down', () => {
  const s = createState();
  addFloor(s);
  addFloor(s);           // 3 floors
  const a = addProp(s, 'desk', { floor: 0 });
  const b = addProp(s, 'desk', { floor: 1 });
  const c = addProp(s, 'desk', { floor: 2 });
  addLink(s, 'stair', { from: 0, to: 1 });   // touches the doomed floor
  const keep = addLink(s, 'stair', { from: 0, to: 2 });

  assert.equal(removeFloor(s, 1), true);
  assert.equal(s.floors.length, 2);
  assert.equal(getProp(s, b.id), null, 'props on the deleted floor are gone');
  assert.equal(getProp(s, a.id).floor, 0);
  assert.equal(getProp(s, c.id).floor, 1, 'floors above shift down');
  assert.equal(s.links.length, 1);
  assert.deepEqual([s.links[0].id, s.links[0].from, s.links[0].to], [keep.id, 0, 1]);
});

test('the ground floor of a one-storey building cannot be removed', () => {
  const s = createState();
  assert.equal(removeFloor(s, 0), false);
  assert.equal(s.floors.length, 1);
});

test('setCurrentFloor clamps and reports whether it moved', () => {
  const s = createState();
  addFloor(s);                         // current = 1
  assert.equal(setCurrentFloor(s, 1), false, 'already there');
  assert.equal(setCurrentFloor(s, 0), true);
  assert.equal(setCurrentFloor(s, 99), true);
  assert.equal(s.currentFloor, 1, 'clamped to the top floor');
  assert.equal(activeFloor(s), s.floors[1]);
});

// ---------- prop layer ----------

test('props are free-floating in feet, not snapped to the grid', () => {
  const s = createState();
  const p = addProp(s, 'student-desk', { x: 13.5, z: 22.25, rotationY: Math.PI / 4 });
  assert.equal(p.floor, 0);
  assert.deepEqual([p.x, p.z], [13.5, 22.25]);
  assert.equal(p.mount, 'floor');
  assert.equal(p.scale, 1);
  // ...but the cell underneath is still a one-liner when a tool needs it
  assert.deepEqual(propCell(p), { x: Math.floor(13.5 / CELL), y: Math.floor(22.25 / CELL) });
});

test('props get unique ids and can be looked up, listed and removed', () => {
  const s = createState();
  addFloor(s);
  const a = addProp(s, 'chair', { floor: 0 });
  const b = addProp(s, 'chair', { floor: 1 });
  const c = addProp(s, 'bookshelf', { floor: 1 });
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  assert.deepEqual(propsOnFloor(s, 1).map((p) => p.id), [b.id, c.id]);
  assert.equal(removeProp(s, b.id), true);
  assert.equal(removeProp(s, b.id), false, 'removing twice is a no-op');
  assert.deepEqual(propsOnFloor(s, 1).map((p) => p.id), [c.id]);
});

test('normalizeProp rejects junk and clamps the rest', () => {
  assert.equal(normalizeProp(null), null);
  assert.equal(normalizeProp({ x: 1 }), null, 'a prop needs a type');
  const p = normalizeProp(
    { type: 'tv', floor: 99, x: 'nope', z: 1e9, rotationY: -Math.PI, scale: 500, mount: 'wall' },
    2
  );
  assert.equal(p.floor, 1, 'floor clamped to what exists');
  assert.equal(p.x, 0, 'non-numeric position falls back to 0');
  assert.equal(p.z, 4000, 'runaway position clamped');
  assert.ok(p.rotationY > 0 && p.rotationY < Math.PI * 2, 'rotation wrapped into [0, 2pi)');
  assert.equal(p.scale, 20, 'scale clamped');
  assert.equal(p.mount, 'wall');
});

test('type-specific fields survive in data, one scalar level deep', () => {
  const p = normalizeProp({
    type: 'shelf',
    data: { shelves: 4, low: true, finish: 'oak', nested: { no: 1 }, fn: 'x'.repeat(500) },
  });
  assert.equal(p.data.shelves, 4);
  assert.equal(p.data.low, true);
  assert.equal(p.data.finish, 'oak');
  assert.equal(p.data.nested, undefined, 'nested objects are dropped');
  assert.equal(p.data.fn.length, 200, 'long strings are truncated');
});

test('links connect two different floors', () => {
  const s = createState();
  addFloor(s);
  assert.equal(addLink(s, 'stair', { from: 0, to: 0 }), null, 'a link needs two levels');
  assert.equal(normalizeLink({ type: 'escalator', from: 0, to: 1 }), null, 'unknown kind');
  assert.ok(normalizeLink({ type: 'elevator', from: 0, to: 1 }), 'Phase 2 kinds are known');
  assert.ok(normalizeLink({ type: 'ramp', from: 0, to: 1 }), 'Phase 2 kinds are known');
  const l = addLink(s, 'stair', { from: 0, to: 1, x: 12, z: 16 });
  assert.deepEqual(linksOnFloor(s, 1).map((x) => x.id), [l.id]);
  assert.equal(removeLink(s, l.id), true);
  assert.deepEqual(s.links, []);
});

// ---------- save format ----------

test('a design round-trips unchanged, polygon rooms included', () => {
  const s = buildSampleSchool();
  duplicateFloor(s, 0);
  addProp(s, 'teacher-desk', { x: 30.5, z: 34.25, rotationY: 1.2, data: { finish: 'oak' } });
  addLink(s, 'stair', { from: 0, to: 1, x: 24, z: 56 });
  setCurrentFloor(s, 1);

  const back = deserialize(serialize(s));
  assert.equal(back.version, SAVE_VERSION);
  assert.equal(back.floors.length, s.floors.length);
  assert.equal(back.currentFloor, 1);
  assert.deepEqual(back.floors[0].cells, s.floors[0].cells);
  assert.deepEqual(back.floors[1].edgesV, s.floors[1].edgesV);
  assert.deepEqual(back.props, s.props);
  assert.deepEqual(back.links, s.links);
  assert.deepEqual(back.floors[0].shapes, s.floors[0].shapes);
  assert.ok(back.floors[0].shapes.length, 'the sample school has a polygon room in it');
});

test('a v1 save loads as a one-floor current-version design', () => {
  // Exactly the shape v1 wrote: flat grid, no floors/props/links.
  const v1 = {
    version: 1,
    cellFt: 4,
    w: 6, h: 5,
    cells: new Array(30).fill(null),
    edgesH: new Array(6 * 6).fill(0),
    edgesV: new Array(7 * 5).fill(0),
  };
  v1.cells[7] = { room: 'Room 101', color: '#f5d491' };
  v1.cells[8] = { room: null, color: null };
  v1.edgesH[7] = 1;
  v1.edgesV[9] = 2;

  const s = deserialize(JSON.stringify(v1));
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.floors.length, 1);
  assert.equal(s.currentFloor, 0);
  assert.deepEqual(s.props, []);
  assert.deepEqual(s.links, []);
  // A v1 cell arrives with Phase 2's finish fields present and empty — the
  // room is still VCT and off-white, it just now says so by not saying so.
  assert.deepEqual(s.floors[0].cells[7],
    { room: 'Room 101', color: '#f5d491', fin: null, paint: null });
  assert.equal(s.floors[0].edgesH[7], 1);
  assert.equal(s.floors[0].edgesV[9], 2);
  assert.equal(floorCellCount(s.floors[0]), 2);
  assert.deepEqual(s.floors[0].shapes, [], 'an old design simply has no polygon rooms');
});

test('load rejects hostile or malformed content instead of trusting it', () => {
  assert.throws(() => deserialize('{}'), /save file/);
  assert.throws(() => deserialize('null'), /save file/);

  const s = deserialize(JSON.stringify({
    version: 2,
    w: 1e6, h: -4,                                  // out of range dims
    floors: new Array(MAX_FLOORS + 5).fill(null).map(() => createFloor(4, 4)),
    currentFloor: 999,
    cells: null,
    props: [{ type: 'desk', floor: 3 }, { nope: true }, 'string'],
    links: [{ type: 'stair', from: 0, to: 1 }, { type: 'wormhole', from: 0, to: 1 }],
  }));
  assert.equal(s.w, 200, 'width clamped to the max');
  assert.equal(s.h, 4, 'height clamped to the min');
  assert.equal(s.floors.length, MAX_FLOORS, 'floor count capped');
  assert.equal(s.currentFloor, MAX_FLOORS - 1);
  assert.equal(s.props.length, 1, 'unusable props dropped');
  assert.equal(s.links.length, 1, 'unknown link kinds dropped');
  assert.equal(s.floors[0].cells.length, 200 * 4, 'floors reallocated to the clamped footprint');
});

test('ids from a loaded file are never reused by new placements', () => {
  const s = deserialize(JSON.stringify({
    version: 2, w: 8, h: 8,
    floors: [createFloor(8, 8), createFloor(8, 8)],
    props: [{ id: 42, type: 'desk', floor: 0 }],
    links: [{ id: 77, type: 'stair', from: 0, to: 1 }],
  }));
  assert.equal(s.nextId, 78);
  const p = addProp(s, 'chair');
  assert.equal(p.id, 78);
  assert.equal(reseedIds(s), 79);
});

test('cell and edge counts follow the shared footprint on every floor', () => {
  const s = createState(12, 9);
  addFloor(s);
  for (const f of s.floors) {
    assert.equal(f.cells.length, 12 * 9);
    assert.equal(f.edgesH.length, 12 * 10);
    assert.equal(f.edgesV.length, 13 * 9);
  }
});

// ---------- edge kinds ----------

test('glass and railings bound a region the way a wall does', () => {
  const s = createState(6, 6);
  const f = s.floors[0];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) setTile(f, x, y, true);
  assert.equal(floodRegion(f, 0, 0).length, 16);

  for (const kind of [EDGE_WALL, EDGE_GLASS, EDGE_RAIL]) {
    for (let x = 0; x < 4; x++) f.edgesH[edgeHIdx(f, x, 2)] = kind;
    assert.equal(floodRegion(f, 0, 0).length, 8,
      `kind ${kind} splits the room — a glazed partition separates two rooms, a railing is the floor's edge`);
  }
});

test('an edge kind from a newer build loads as a wall, not as a gap', () => {
  const s = createState(6, 6);
  const f = s.floors[0];
  f.edgesH[edgeHIdx(f, 0, 0)] = EDGE_GLASS;
  const json = JSON.parse(serialize(s));
  json.floors[0].edgesH[1] = 9;    // a kind this build has never heard of
  json.floors[0].edgesH[2] = -3;
  const back = deserialize(JSON.stringify(json));
  assert.equal(back.floors[0].edgesH[0], EDGE_GLASS, 'known kinds come through as themselves');
  assert.equal(back.floors[0].edgesH[1], EDGE_WALL, 'and unknown ones fall back to solid');
  assert.equal(back.floors[0].edgesH[2], EDGE_WALL);
});

// ---------- v6: the environment ----------

test('a fresh design carries an environment, and it is the default one', () => {
  const s = createState(8, 8);
  assert.equal(s.version, 6);
  assert.ok(isDefaultEnv(s.env));
  assert.equal(s.env.lights, 'auto');
});

test('a v5 file loads as a building that never said what time it was', () => {
  // No `env` anywhere in the file — which is every design saved before Phase 3.
  const v5 = { version: 5, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [] };
  const s = deserialize(JSON.stringify(v5));
  assert.ok(isDefaultEnv(s.env), 'and is lit exactly the way it always was');
});

test('a design at the default environment writes no environment at all', () => {
  const s = createState(8, 8);
  assert.ok(!serialize(s).includes('"env"'), 'a v5 file round-trips through v6 unchanged');
  s.env.minutes = 1150;
  assert.ok(serialize(s).includes('"env"'), 'but a moved clock is recorded');
  assert.equal(deserialize(serialize(s)).env.minutes, 1150);
});

test('a hostile environment is clamped rather than believed', () => {
  const s = createState(8, 8);
  const raw = JSON.parse(serialize(s));
  raw.env = { month: 77, day: 77, minutes: -5, lat: 1e6, north: 1e6, lights: { evil: true } };
  const back = deserialize(JSON.stringify(raw));
  assert.equal(back.env.month, 12);
  assert.equal(back.env.minutes, 0);
  assert.ok(Math.abs(back.env.lat) <= 66);
  assert.ok(back.env.north >= 0 && back.env.north < 360);
  assert.equal(back.env.lights, 'auto');
});

test('the environment survives every other kind of edit round-tripping', () => {
  const s = createState(10, 10);
  s.env = { month: 1, day: 8, minutes: 1020, lat: -33.9, north: 215, lights: 'on' };
  setTile(s.floors[0], 2, 2, true);
  addProp(s, 'troffer-2x4', { floor: 0, x: 10, z: 10, y: 9.5 });
  const back = deserialize(serialize(s));
  assert.deepEqual(back.env, {
    month: 1, day: 8, minutes: 1020, lat: -33.9, north: 215, lights: 'on',
  });
  assert.equal(back.props.length, 1);
});
