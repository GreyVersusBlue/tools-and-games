// Data-model tests for the parts of School Generator that don't need a
// browser: grid.js, props.js and the save format. Rooms have their own file
// (shapes.test.mjs), the 4ft brush has two more (lattice, paint), and the v11
// migration has migrate.test.mjs. Run `node --test` from
// Projects/school-generator (no dependencies, no build step).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL, FLOOR_H, MAX_FLOORS, createState, createFloor, activeFloor, floorBaseY,
  topOfBuilding, wallHeightOf, floorShapeCount,
  addFloor, duplicateFloor, removeFloor, setCurrentFloor,
} from '../js/grid.js';
import { EDGE_WALL, EDGE_GLASS, EDGE_RAIL, EDGE_DOOR } from '../js/lattice.js';
import { totalShapeArea, shapeArea } from '../js/shapes.js';
import { sheet } from './build.mjs';
import { buildSampleSchool } from '../js/sample.js';
import {
  addProp, removeProp, getProp, propsOnFloor, propCell,
  addLink, removeLink, linksOnFloor, normalizeProp, normalizeLink, reseedIds,
} from '../js/props.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import { ensureTerrain, terrainField, groundAt, raiseTerrain } from '../js/terrain.js';
import { addRegion, regionsOf } from '../js/site.js';
import { ensureRoof } from '../js/roof.js';
import { isDefaultLife, MAX_POP } from '../js/agents.js';

const near2 = (a, b, eps) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (±${eps})`);
import { isDefaultEnv } from '../js/sky.js';

// ---------- grid basics still hold, one floor at a time ----------

test('a new state is one empty floor on a shared footprint', () => {
  const s = createState(10, 8);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.floors.length, 1);
  assert.equal(s.currentFloor, 0);
  assert.deepEqual([s.w, s.h], [10, 8]);
  assert.deepEqual([s.floors[0].w, s.floors[0].h], [10, 8]);
  assert.equal(floorShapeCount(s.floors[0]), 0);
  assert.deepEqual(Object.keys(s.floors[0]).sort(), ['h', 'shapes', 'w'],
    'a floor is its footprint and its rooms — no cells, no edge arrays');
  assert.deepEqual(s.props, []);
  assert.deepEqual(s.links, []);
});

test('rooms belong to one storey and nothing leaks between them', () => {
  const s = createState(8, 8);
  addFloor(s);
  sheet(s, 0).fill(0, 0, 3, 3).label(0, 0, 3, 3, { name: 'Gym', color: '#b8dfa2' }).bake();
  sheet(s, 1).fill(0, 0, 0, 0).bake();

  const [ground, upper] = s.floors;
  assert.equal(floorShapeCount(ground), 1);
  assert.equal(floorShapeCount(upper), 1);
  assert.equal(ground.shapes[0].name, 'Gym');
  assert.equal(ground.shapes[0].color, '#b8dfa2');
  assert.equal(upper.shapes[0].name, null);
  assert.equal(totalShapeArea(ground), 16 * CELL * CELL);
  assert.equal(totalShapeArea(upper), CELL * CELL);
  assert.notEqual(ground.shapes[0].id, upper.shapes[0].id, 'ids are unique building-wide');
});

test('a wall on one floor does not bound the floor above', () => {
  const s = createState(6, 6);
  addFloor(s);
  const walled = (i, wall) => {
    const f = sheet(s, i);
    f.fill(0, 0, 3, 3);
    if (wall) f.hrun(0, 3, 2, EDGE_WALL);
    f.bake();
  };
  walled(0, true);
  walled(1, false);
  assert.equal(floorShapeCount(s.floors[0]), 2, 'the wall splits the ground floor');
  assert.equal(floorShapeCount(s.floors[1]), 1, 'the upper floor is untouched');
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

test('duplicating a floor copies its rooms without sharing them', () => {
  const s = createState(6, 6);
  sheet(s, 0).box(1, 1, 2, 2, { name: 'Room 101' }).edgeH(1, 1, EDGE_DOOR).bake();
  const ground = s.floors[0];

  assert.equal(duplicateFloor(s, 0), 1);
  const upper = s.floors[1];
  assert.equal(upper.shapes.length, 1);
  assert.equal(upper.shapes[0].name, 'Room 101');
  assert.equal(upper.shapes[0].rings[0].openings.length, 1, 'the doorway came too');
  assert.notEqual(upper.shapes[0].id, ground.shapes[0].id,
    'a copied room is a new room, with an id of its own');

  upper.shapes[0].name = 'Room 201';
  upper.shapes[0].rings[0].pts[0].x = 99;
  assert.equal(ground.shapes[0].name, 'Room 101', 'records are cloned');
  assert.notEqual(ground.shapes[0].rings[0].pts[0].x, 99, 'and so are their points');
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
  assert.deepEqual(back.floors[1].shapes, s.floors[1].shapes);
  assert.deepEqual(back.props, s.props);
  assert.deepEqual(back.links, s.links);
  assert.deepEqual(back.floors[0].shapes, s.floors[0].shapes);
  assert.ok(back.floors[0].shapes.length, 'the sample school has a polygon room in it');
});

test('a v1 save loads as a one-floor current-version design', () => {
  // Exactly the shape v1 wrote: flat lattice, no floors/props/links. Since
  // Phase 12 it arrives as rooms — see migrate.test.mjs for the whole of what
  // the bake does with an old file; this is the version handshake only.
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

  const s = deserialize(JSON.stringify(v1));
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.floors.length, 1);
  assert.equal(s.currentFloor, 0);
  assert.deepEqual(s.props, []);
  assert.deepEqual(s.links, []);
  assert.equal(floorShapeCount(s.floors[0]), 1, 'two adjoining cells are one room');
  const room = s.floors[0].shapes[0];
  assert.equal(room.name, 'Room 101');
  assert.equal(room.color, '#f5d491');
  assert.ok(room.id > 0, 'and it has an id, which a v1 design could not have had');
  assert.equal(shapeArea(room), 2 * CELL * CELL);
  // Phase 2's finish fields arrive present and empty — the room is still VCT
  // and off-white, it just now says so by not saying so.
  assert.equal(room.fin, null);
  assert.equal(room.paint, null);
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
  assert.deepEqual([s.floors[0].w, s.floors[0].h], [200, 4],
    'floors reallocated to the clamped footprint');
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

test('a footprint is shared by every floor', () => {
  const s = createState(12, 9);
  addFloor(s);
  for (const f of s.floors) assert.deepEqual([f.w, f.h], [12, 9]);
  assert.deepEqual([s.w, s.h], [12, 9]);
});

// ---------- boundary kinds ----------

test('glass and railings bound a room the way a wall does', () => {
  for (const kind of [EDGE_WALL, EDGE_GLASS, EDGE_RAIL]) {
    const s = createState(6, 6);
    sheet(s, 0).fill(0, 0, 3, 3).hrun(0, 3, 2, kind).bake();
    assert.equal(floorShapeCount(s.floors[0]), 2,
      `kind ${kind} splits the room — a glazed partition separates two rooms, a railing is the floor's edge`);
    for (const shape of s.floors[0].shapes) {
      assert.equal(shapeArea(shape), 8 * CELL * CELL);
    }
  }
});

// ---------- v6: the environment ----------

test('a fresh design carries an environment, and it is the default one', () => {
  const s = createState(8, 8);
  assert.equal(s.version, SAVE_VERSION);
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
  sheet(s, 0).fill(2, 2, 2, 2).bake();
  addProp(s, 'troffer-2x4', { floor: 0, x: 10, z: 10, y: 9.5 });
  const back = deserialize(serialize(s));
  assert.deepEqual(back.env, {
    month: 1, day: 8, minutes: 1020, lat: -33.9, north: 215, lights: 'on',
  });
  assert.equal(back.props.length, 1);
});

// ---------- v8: who is in the building ----------

test('a fresh design carries no population settings', () => {
  const s = createState(8, 8);
  assert.equal(s.life, undefined);
  assert.ok(!serialize(s).includes('"life"'), 'a v7 file round-trips through v8 unchanged');
});

test('a population setting survives a round trip, and a hostile one is clamped', () => {
  const s = createState(12, 12);
  s.life = { students: 240, seed: 77, schedule: { periods: 5, periodMin: 60 } };
  const back = deserialize(serialize(s));
  assert.equal(back.life.students, 240);
  assert.equal(back.life.seed, 77);
  assert.equal(back.life.schedule.periods, 5);
  assert.equal(back.life.schedule.periodMin, 60);

  const hostile = createState(12, 12);
  hostile.life = { students: 1e9, seed: -4, schedule: 'nope' };
  const clamped = deserialize(serialize(hostile));
  assert.ok(clamped.life.students <= MAX_POP);
  assert.ok(clamped.life.seed >= 1);
  assert.equal(clamped.life.schedule, undefined, 'a default schedule is not written');
});

test('a v7 file loads into a school with the default population settings', () => {
  const v7 = { version: 7, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [] };
  const s = deserialize(JSON.stringify(v7));
  assert.equal(s.life, undefined);
  assert.ok(isDefaultLife(s.life), 'which is the default one');
});

// ---------- v7: the site ----------

test('a fresh design has no terrain, no site regions and no roof record', () => {
  const s = createState(8, 8);
  assert.equal(s.terrain, undefined, 'the ground is level until it is graded');
  assert.equal(s.site, undefined, 'and bare until something is drawn on it');
  assert.equal(s.roof, undefined, 'and roofed by the default until asked otherwise');
  const json = serialize(s);
  for (const key of ['terrain', 'site', 'roof']) {
    assert.ok(!json.includes(`"${key}"`), `a v6 file round-trips through v7 with no "${key}"`);
  }
});

test('a v6 file loads as a building on level ground with a bare site', () => {
  const v6 = { version: 6, w: 12, h: 12, floorHt: 12, floors: [], currentFloor: 0, props: [], links: [] };
  const s = deserialize(JSON.stringify(v6));
  assert.equal(s.terrain, undefined);
  assert.equal(s.site, undefined);
  assert.equal(groundAt(terrainField(s), 40, 40), 0, 'and the ground under it is datum');
});

test('a graded site, a drawn region and a chosen roof all survive a round trip', () => {
  const s = createState(12, 12);
  raiseTerrain(ensureTerrain(s), 200, 200, 120, 6.4);
  addRegion(s, [{ x: 0, z: 200 }, { x: 90, z: 200 }, { x: 90, z: 260 }, { x: 0, z: 260 }],
    { surf: 'asphalt', mark: 'stalls', name: 'Staff lot' });
  ensureRoof(s).style = 'gable';
  s.roof.facade = 'panel';

  const back = deserialize(serialize(s));
  assert.ok(back.terrain, 'the terrain came back');
  assert.equal(back.terrain.cols, s.terrain.cols);
  near2(groundAt(terrainField(back), 200, 200), groundAt(terrainField(s), 200, 200), 0.05);
  assert.equal(regionsOf(back).length, 1);
  assert.equal(regionsOf(back)[0].surf, 'asphalt');
  assert.equal(regionsOf(back)[0].mark, 'stalls');
  assert.equal(regionsOf(back)[0].name, 'Staff lot');
  assert.equal(back.roof.style, 'gable');
  assert.equal(back.roof.facade, 'panel');
});

test('a hostile site cannot stop a design from loading', () => {
  const s = deserialize(JSON.stringify({
    version: 7, w: 10, h: 10, floors: [],
    terrain: { cols: 'lots', rows: -3, h: 'yes' },
    site: { regions: [null, 3, { pts: [] }] },
    roof: { style: 'thatch', pitch: 'steep' },
  }));
  assert.equal(s.terrain, undefined, 'an unreadable terrain is a level one');
  assert.equal(s.site, undefined, 'an unreadable region is one that is not there');
  assert.equal(s.roof, undefined, 'and an unreadable roof is the default one');
});

test('a site region takes an id off the same counter rooms do', () => {
  const s = createState(10, 10);
  addRegion(s, [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 60 }, { x: 0, z: 60 }]);
  const back = deserialize(serialize(s));
  const region = regionsOf(back)[0];
  assert.ok(region.id > 0);
  assert.ok(back.nextId > region.id, 'and the counter is past it');
});
