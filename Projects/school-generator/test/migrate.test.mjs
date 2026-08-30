// migrate.test.mjs — the v11 migration, from one save file per era.
//
// Ten versions of "read the extra field if it is there" ended at v11: a floor
// no longer carries `cells`, `edgesH` or `edgesV`, so an older design has to be
// *baked* rather than appended to. The promise this file checks is the one
// that replaced "the same bytes come out": **an older design opens as the same
// building.**
//
// The fixtures in test/fixtures/ are real files, not hand-typed excerpts. The
// two v10 ones were written by the build immediately before this phase — the
// sample school and a generated one — so they carry every kind of thing the
// lattice could say. Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CELL } from '../js/grid.js';
import { serialize, deserialize, SAVE_VERSION } from '../js/save-load.js';
import {
  shapesOf, totalShapeArea, shapeArea, segEnds, isBuilt, isDoorOpening,
  isWindowOpening, openingSpec, pointInShape, SEG_GLASS, SEG_RAIL,
} from '../js/shapes.js';
import { buildNav, navSummary } from '../js/navgraph.js';
import { buildReport } from '../js/report.js';
import { computeFloorPlan } from '../js/blueprint.js';
import { wallSegments } from '../js/collide.js';

const FIXTURES = ['plan-v1', 'plan-v2', 'plan-v5', 'sample-v10', 'generated-v10'];

const raw = (name) => fs.readFileSync(`test/fixtures/${name}.json`, 'utf8');
const load = (name, opts = {}) => deserialize(raw(name), opts);

// What the file said the floor area was, counted off its own cells — the one
// number that has to survive a bake exactly.
function latticeArea(json) {
  const floors = Array.isArray(json.floors) ? json.floors : [json];
  return floors.map((f) => {
    let n = 0;
    for (const c of (f && f.cells) || []) if (c) n++;
    return n * CELL * CELL;
  });
}

const openingsOf = (floor) =>
  shapesOf(floor).flatMap((sh) => sh.rings.flatMap((r) => r.openings));

// ---------- the shape of what comes back ----------

test('every fixture opens, and none of them brings a lattice with it', () => {
  for (const name of FIXTURES) {
    const s = load(name);
    assert.equal(s.version, SAVE_VERSION, name);
    for (const floor of s.floors) {
      assert.deepEqual(Object.keys(floor).sort(), ['h', 'shapes', 'w'], name);
      for (const shape of floor.shapes) {
        assert.ok(shape.id > 0, `${name}: every room has an id`);
        assert.ok(shape.rings.length >= 1);
        assert.ok(shapeArea(shape) > 0);
      }
    }
    const ids = s.floors.flatMap((f) => f.shapes.map((sh) => sh.id));
    assert.equal(new Set(ids).size, ids.length, `${name}: no two rooms share an id`);
    assert.ok(s.nextId > Math.max(0, ...ids), `${name}: the counter is past them`);
  }
});

test('the floor area a file drew is the floor area it opens with', () => {
  for (const name of FIXTURES) {
    const json = JSON.parse(raw(name));
    const want = latticeArea(json);
    const s = load(name);
    // Plus whatever polygon rooms the file already had — those are added, not
    // baked, so they are counted separately.
    const drawn = (Array.isArray(json.floors) ? json.floors : [json])
      .map((f) => ((f && f.shapes) || []).length);
    s.floors.forEach((floor, i) => {
      const got = totalShapeArea(floor);
      if (!drawn[i]) {
        assert.ok(Math.abs(got - want[i]) < 1e-6,
          `${name} floor ${i}: ${got} ft² out, ${want[i]} ft² in`);
      } else {
        assert.ok(got >= want[i] - 1e-6, `${name} floor ${i}: lost area`);
      }
    });
  }
});

test('a migration says which version it came from and what it could not keep', () => {
  const seen = [];
  for (const name of FIXTURES) load(name, { onMigrate: (info) => seen.push([name, info]) });
  assert.equal(seen.length, FIXTURES.length, 'every fixture is a pre-v11 file');
  for (const [name, info] of seen) {
    assert.ok(info.from >= 1 && info.from <= 10, name);
    assert.ok(info.rooms > 0, `${name} produced ${info.rooms} rooms`);
    assert.equal(info.orphans, 0, `${name} had no boundary that bounded nothing`);
  }
  // A v11 file is not migrated at all, and says so by not calling back.
  let called = false;
  deserialize(serialize(load('plan-v5')), { onMigrate: () => { called = true; } });
  assert.equal(called, false);
});

test('a migrated design round-trips through v11 byte for byte', () => {
  for (const name of FIXTURES) {
    const once = serialize(load(name));
    const twice = serialize(deserialize(once));
    assert.equal(once, twice, `${name} is not stable across a second trip`);
  }
});

// ---------- Phase 35's two ----------

test('a design nobody has re-gridded writes no gridRef and the cellFt it always did', () => {
  for (const name of FIXTURES) {
    const json = JSON.parse(serialize(load(name)));
    assert.equal('gridRef' in json, false, `${name} grew a gridRef key it never asked for`);
    assert.equal(json.cellFt, CELL, `${name} changed what a cell is worth`);
  }
});

test('a reference point and a refined raster survive a round trip', () => {
  const s = load('plan-v5');
  s.gridRef = { x: 3.25, z: -1.5, u: 120, v: 64 };
  s.cellFt = 2;
  const back = deserialize(serialize(s));
  assert.deepEqual(back.gridRef, { x: 3.25, z: -1.5, u: 120, v: 64 });
  assert.equal(back.cellFt, 2);
  assert.equal(serialize(back), serialize(deserialize(serialize(back))));
});

test('a hostile grid record opens as the design it always was', () => {
  const s = load('plan-v5');
  const json = JSON.parse(serialize(s));
  json.gridRef = { x: 'somewhere' };
  json.cellFt = 999;
  const back = deserialize(JSON.stringify(json));
  assert.equal(back.gridRef, undefined);
  assert.equal(back.cellFt, CELL);
});

// ---------- what the building still says about itself ----------

test('the doorways, windows and glass a file drew all come through', () => {
  const s = load('plan-v5');
  const floor = s.floors[0];
  const ops = openingsOf(floor);
  // The fixture draws: two classroom doors, a way out at the west end (a
  // pair), a window band of three cells, a cased opening, and one door on the
  // polygon room it already had.
  assert.equal(ops.filter(isDoorOpening).length, 5);
  assert.equal(ops.filter(isWindowOpening).length, 3);
  assert.ok(ops.some((o) => openingSpec(o).leaf === 2), 'the pair is still a pair');
  assert.ok(ops.some((o) => openingSpec(o).leaf === 0), 'and the cased opening still hangs nothing');
  const walls = shapesOf(floor).flatMap((sh) => sh.rings.flatMap((r) => r.walls));
  assert.ok(walls.includes(SEG_GLASS), 'the glazed front is still glass');
  assert.ok(walls.includes(SEG_RAIL), 'and the railing is still a railing');
});

test('a room keeps its name, its tint and its finishes', () => {
  const s = load('plan-v5');
  const named = shapesOf(s.floors[0]).filter((sh) => sh.name);
  assert.deepEqual(named.map((sh) => sh.name).sort(),
    ['Commons', 'Corridor', 'Room 101', 'Room 102']);
  const r101 = named.find((sh) => sh.name === 'Room 101');
  assert.equal(r101.color, '#f5d491');
  assert.equal(r101.fin, 'carpet');
  assert.equal(r101.paint, '#dfe7ea');
  const hall = named.find((sh) => sh.name === 'Corridor');
  assert.equal(hall.fin, 'terrazzo');
  // ...and the two v11 fields it was never asked about are null, not absent.
  for (const sh of named) {
    assert.equal(sh.group, null);
    assert.equal(sh.load, null);
  }
});

test('a partition is drawn once, by one of the two rooms it divides', () => {
  const s = load('plan-v5');
  const floor = s.floors[0];
  // The wall between Room 101 and Room 102 runs down x = 20ft, z 4..20.
  const on = shapesOf(floor).flatMap((sh) => sh.rings.flatMap((ring) =>
    ring.walls.map((w, i) => {
      const [a, b] = segEnds(ring, i);
      return isBuilt(w) && a.x === 20 && b.x === 20 ? 1 : 0;
    })));
  assert.equal(on.reduce((n, v) => n + v, 0), 1, 'one wall, not two');
  // ...and the collider agrees: nothing is doubled up along that line.
  const doubled = wallSegments(floor).filter((g) => g.ax === 20 && g.bx === 20);
  assert.equal(doubled.length, 1);
});

// ---------- the readers, on a migrated design ----------

test('the sample school migrates to the building every reader recognises', () => {
  const s = load('sample-v10');
  assert.deepEqual(s.floors.map((f) => f.shapes.length), [9, 7]);
  const names = shapesOf(s.floors[0]).map((sh) => sh.name);
  assert.ok(names.includes('Main Hall'));
  assert.ok(names.includes('Learning Commons'), 'the free-drawn room came too');
  assert.ok(names.includes('Room 101'));

  const nav = navSummary(buildNav(s));
  assert.equal(nav.rooms, 16);
  assert.ok(nav.exits >= 2, 'both ways out are still ways out');
  assert.ok(nav.doors >= 12);
  assert.equal(nav.outside, true);

  const report = buildReport(s);
  assert.ok(report.findings.length > 0);
  assert.equal(report.findings.filter((f) => f.code === 'unreachable').length, 0,
    'no room lost its way out in the bake');

  const plan = computeFloorPlan(s, 0);
  assert.ok(plan.walls.length > 20);
  assert.ok(plan.rooms.filter((r) => r.name).length >= 8);
});

test('a generated school migrates without losing a room or stranding one', () => {
  const s = load('generated-v10');
  assert.ok(s.floors.length === 2);
  assert.ok(s.floors[0].shapes.length > 20);
  const report = buildReport(s);
  const stranded = report.findings.find((f) => f.code === 'unreachable');
  assert.ok(!stranded || stranded.level !== 'fail', 'nothing is sealed in');
  // Every room the file named still has a name.
  for (const floor of s.floors) {
    const unnamed = shapesOf(floor).filter((sh) => !sh.name).length;
    assert.equal(unnamed, 0, 'the generator names every room, and so does the bake');
  }
  // ...and the doors it cut are still cut.
  assert.ok(openingsOf(s.floors[0]).filter(isDoorOpening).length > 20);
});

test('a room drawn over the lattice is still drawn over it', () => {
  const s = load('plan-v5');
  const floor = s.floors[0];
  const commons = shapesOf(floor).find((sh) => sh.name === 'Commons');
  // The fixture's polygon room overhangs the painted ones to the east. It is
  // last in the list, which is what makes it the room you are standing in.
  assert.equal(floor.shapes[floor.shapes.length - 1].id, commons.id);
  assert.ok(pointInShape(commons, 48, 20));
});
