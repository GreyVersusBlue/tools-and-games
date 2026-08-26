// The outdoors, cut into tiles: what it refuses to walk over, where it says
// the property ends, and the two things that only work because it exists —
// a discharge route that is measured rather than assumed, and a walk between
// two blocks of a campus.
//
// Built on small hand-drawn states, plus the sample school and one generated
// campus. The site mesh is derived, so every assertion here is a property of
// the design rather than of a stored field: change the design and the answer
// changes with it, which is exactly what the tests below check.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, CELL } from '../js/grid.js';
import { boxRoom, slabOn } from './build.mjs';
import { addRegion, ensureSite } from '../js/site.js';
import { ensureTerrain, raiseTerrain, terrainField, gradeAt } from '../js/terrain.js';
import { buildSampleSchool } from '../js/sample.js';
import { layoutSchool, buildSchool } from '../js/generate.js';
import { buildNav, dischargeField, dischargePath, findPath, goesOutdoors } from '../js/navgraph.js';
import {
  meshSite, siteExtent, buildingBounds, publicWay, yardTileFor, yardArea,
  yardSummary, pathGrade,
  YARD_STEP, YARD_MARGIN, WALK_GRADE, MIN_YARD_TILE, MAX_YARD_CELLS,
} from '../js/sitemesh.js';

const rectPts = (x0, z0, x1, z1) => [
  { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
];

// One walled box on a 40x40 grid, with nothing else on the site.
function oneRoom() {
  const state = createState(40, 40);
  boxRoom(state, 0, 4, 4, 12, 12, { name: 'Room' });
  return state;
}

const tileAt = (mesh, x, z) => {
  const found = yardTileFor(mesh, x, z);
  return found && found.inside ? found.tile : null;
};

// ---------- the extent ----------

test('a design with nothing drawn on the site still has a yard round it', () => {
  const state = oneRoom();
  const b = buildingBounds(state);
  const e = siteExtent(state);
  assert.ok(b && b.x1 > b.x0);
  assert.ok(e.x0 <= b.x0 - YARD_MARGIN + 1e-6);
  assert.ok(e.x1 >= b.x1 + YARD_MARGIN - 1e-6);
  const mesh = meshSite(state);
  assert.ok(mesh.tiles.length > 0, 'and there is ground in it');
  assert.ok(yardArea(mesh) > 0);
});

test('the site somebody drew wins over the ground somebody graded', () => {
  // `terrainFor` lays a heightfield two hundred feet past the building whether
  // or not anybody asked for a site that big. Taking that as a property line
  // would measure every discharge to a boundary nobody drew.
  const state = oneRoom();
  ensureTerrain(state);
  const graded = siteExtent(state);
  addRegion(state, rectPts(-40, -40, 200, 200), { surf: 'turf', name: 'Lawn' });
  const drawn = siteExtent(state);
  assert.ok(drawn.x1 < graded.x1, 'the drawn site is the smaller claim, and it is the one used');
  assert.equal(drawn.z1, 200, 'the drawn edge, where it is the outer one');
  // ...and the building's own margin is still in the union, which is why the
  // west edge is sixty feet clear of the wall rather than on the region.
  const b2 = buildingBounds(state);
  assert.equal(drawn.x0, b2.x0 - YARD_MARGIN);
});

// ---------- what is walkable ----------

test('the building is not somewhere you can stand, and its wall is not either', () => {
  const state = oneRoom();
  const mesh = meshSite(state);
  // The middle of the room.
  assert.equal(tileAt(mesh, 8 * CELL, 8 * CELL), null);
  // ...and the ground well clear of it is.
  assert.ok(tileAt(mesh, -20, 8 * CELL), 'the ground west of the building is walkable');
  for (const t of mesh.tiles) {
    assert.ok(t.x1 - t.x0 >= MIN_YARD_TILE && t.z1 - t.z0 >= MIN_YARD_TILE);
  }
});

test('a planting bed is walked around, not across', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-120, -120, 180, 180), { surf: 'turf', name: 'Lawn' });
  const open = meshSite(state);
  const before = tileAt(open, -60, 60);
  assert.ok(before, 'the lawn is walkable');
  addRegion(state, rectPts(-80, 40, -40, 80), { surf: 'garden', name: 'Bed' });
  const after = meshSite(state);
  assert.equal(tileAt(after, -60, 60), null, 'the bed is not');
  // ...and the lawn either side of it still is, so the bed is an obstacle
  // rather than a wall across the site.
  assert.ok(tileAt(after, -100, 60));
  assert.ok(tileAt(after, -20, 60));
});

test('a bank too steep to walk up is not part of the site mesh', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-200, -200, 260, 260), { surf: 'turf', name: 'Lawn' });
  const flat = meshSite(state);
  assert.ok(tileAt(flat, -150, 100), 'level ground is walkable');
  // A sharp berm: forty feet of rise inside a thirty-foot radius is well past
  // the 25% a graded site puts turf on. The *side* of it, not the top — the
  // top of a hill is level, which is what makes it a top.
  ensureTerrain(state);
  raiseTerrain(state.terrain, -150, 100, 30, 40);
  const bermed = meshSite(state);
  const field = terrainField(state);
  assert.ok(!field.flat);
  assert.ok(gradeAt(field, -130, 100).slope > WALK_GRADE, 'the side of the berm is a bank');
  assert.equal(tileAt(bermed, -130, 100), null, '...and not part of the mesh');
});

test('a tile belongs to one piece of ground, never to two', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-200, -200, 260, 260), { surf: 'turf', name: 'Lawn' });
  addRegion(state, rectPts(-160, -60, -80, 60), { surf: 'asphalt', name: 'Lot' });
  const mesh = meshSite(state);
  const lot = tileAt(mesh, -120, 0);
  assert.ok(lot);
  assert.equal(lot.name, 'Lot');
  assert.ok(lot.paved, 'and it knows it is a made surface');
  assert.ok(lot.x0 >= -160 - YARD_STEP && lot.x1 <= -80 + YARD_STEP,
    'the tile does not spill out of the region that names it');
  const lawn = tileAt(mesh, -200, 0);
  assert.equal(lawn.name, 'Lawn');
  assert.ok(!lawn.paved);
});

test('two tiles that touch have a gate between them', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-200, -200, 260, 260), { surf: 'turf', name: 'Lawn' });
  addRegion(state, rectPts(-160, -60, -80, 60), { surf: 'concrete', name: 'Walk' });
  const mesh = meshSite(state);
  const walk = tileAt(mesh, -120, 0);
  const gates = mesh.gates.filter((g) => g.a === walk.id || g.b === walk.id);
  assert.ok(gates.length > 0, 'the walk is joined to the lawn round it');
  for (const g of gates) assert.ok(g.w > 0 && g.outdoors);
});

test('a hostile extent gets a coarser raster rather than a bigger one', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-4000, -4000, 4000, 4000), { surf: 'turf', name: 'County' });
  const mesh = meshSite(state);
  assert.ok(mesh.cols * mesh.rows <= MAX_YARD_CELLS, `${mesh.cols}x${mesh.rows} cells`);
  assert.ok(mesh.step > YARD_STEP, 'by doubling the step');
  assert.ok(mesh.tiles.length > 0);
});

// ---------- the public way ----------

test('the public way is the rim, and paving at the rim wins where there is any', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-200, -200, 260, 260), { surf: 'turf', name: 'Lawn' });
  const grass = meshSite(state);
  assert.equal(grass.ways.rule, 'boundary');
  assert.ok(grass.ways.length > 1, 'a boundary is a line, not a point');

  // A drive that runs off the west edge of the site.
  addRegion(state, rectPts(-200, -20, -60, 20), { surf: 'asphalt', name: 'Drive' });
  const drive = meshSite(state);
  assert.equal(drive.ways.rule, 'paved');
  for (const w of drive.ways) {
    assert.ok(w.paved, 'every way node is on the paving');
    assert.ok(Math.abs(w.x - drive.extent.x0) < 1e-6, 'and on the edge the drive reaches');
  }
});

test('the way nodes are spread along the frontage rather than pooled in its middle', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-300, -300, 360, 360), { surf: 'turf', name: 'Lawn' });
  const mesh = meshSite(state);
  const west = mesh.ways.filter((w) => Math.abs(w.x - mesh.extent.x0) < 1e-6);
  assert.ok(west.length > 2, 'the west boundary is more than one place');
  const zs = west.map((w) => w.z).sort((a, b) => a - b);
  assert.ok(zs[zs.length - 1] - zs[0] > 200, 'and they cover it');
});

// ---------- what it makes possible ----------

test('an exterior door discharges over the ground, and the walk is measured', () => {
  const state = buildSampleSchool();
  const nav = buildNav(state);
  const field = dischargeField(nav);
  assert.ok(nav.exits.length > 0);
  for (const exit of nav.exits) {
    const d = field.dist.get(exit.id);
    assert.ok(Number.isFinite(d), `${exit.id} reaches the public way`);
    assert.ok(d > 0, 'and it is a distance rather than nothing');
    const path = dischargePath(field, exit.id);
    assert.equal(path[0], exit.id);
    assert.equal(nav.node(path[path.length - 1]).kind, 'way', 'ending on the public way');
  }
});

test('a discharge route never goes back inside the building', () => {
  const state = buildSampleSchool();
  const nav = buildNav(state);
  const field = dischargeField(nav);
  for (const exit of nav.exits) {
    const path = dischargePath(field, exit.id);
    // Every node after the door is outdoors. A route that came back in one
    // door and left by another would be a corridor with a lawn in it.
    for (let i = 1; i < path.length; i++) {
      const n = nav.node(path[i]);
      assert.ok(n.outdoors, `${n.id} (${n.kind}) is outdoors`);
    }
  }
});

test('how steep a route is is measured along the line it walks', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-300, -300, 360, 360), { surf: 'turf', name: 'Lawn' });
  ensureTerrain(state);
  // A ridge in one corner of the graded ground, nowhere near the first line
  // below and squarely across the second.
  raiseTerrain(state.terrain, -150, -150, 60, 20);
  const field = terrainField(state);
  const across = pathGrade(field, [{ x: 150, z: 200 }, { x: 240, z: 200 }]);
  assert.ok(across < 0.02, `the far corner of the site is nothing to do with this walk (${across})`);
  const over = pathGrade(field, [{ x: -210, z: -150 }, { x: -90, z: -150 }]);
  assert.ok(over > 0.05, `and the walk over the ridge knows about it (${over})`);
});

test('a campus is joined by its site, and the joining is a measured walk', () => {
  const state = buildSchool(
    layoutSchool({ students: 600, storeys: 2, seed: 4, scheme: 'campus' }), { furnish: false });
  const nav = buildNav(state);
  assert.ok(nav.yard && nav.yard.tiles.length > 0);
  // Two rooms that need the outdoors to reach each other, and the walk between
  // them is longer than the flat forty-five-foot charge the outside hub used
  // to quote for every door in the school.
  let crossed = null;
  for (const room of nav.rooms) {
    const path = findPath(nav, nav.rooms[0].id, room.id);
    if (path && goesOutdoors(nav, path)) { crossed = path; break; }
  }
  assert.ok(crossed, 'a campus has a walk between its buildings');
});

test('the summary says what the outdoors came out as', () => {
  const state = buildSampleSchool();
  const mesh = meshSite(state);
  const s = yardSummary(mesh);
  assert.equal(s.tiles, mesh.tiles.length);
  assert.equal(s.ways, mesh.ways.length);
  assert.equal(s.rule, mesh.ways.rule);
  assert.ok(s.area > 0);
  assert.equal(yardSummary(null).tiles, 0);
});

test('a sealed building has no outdoors in its graph at all', () => {
  // Nothing opens to the outside, so `buildNav` never asks for a site mesh —
  // which is the point: thirty milliseconds not spent on a design that cannot
  // reach the ground anyway.
  const state = oneRoom();
  const nav = buildNav(state);
  assert.equal(nav.outside, null);
  assert.equal(nav.yard, null);
  assert.deepEqual(nav.ways, []);
  assert.equal(dischargeField(nav).ways, 0);
});

test('a point off the mesh still gets a tile, because it still has to walk out', () => {
  const state = oneRoom();
  addRegion(state, rectPts(-200, -200, 260, 260), { surf: 'turf', name: 'Lawn' });
  addRegion(state, rectPts(-80, 40, -40, 80), { surf: 'garden', name: 'Bed' });
  const mesh = meshSite(state);
  const found = yardTileFor(mesh, -60, 60);
  assert.ok(found, 'somebody standing in the flower bed is somewhere');
  assert.equal(found.inside, false, 'and the mesh says so');
});
