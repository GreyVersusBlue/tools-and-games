// The plan map's rules for the stage, through the module that Movement,
// Scenarios and Safety mount (ui/surface/plan-map.js, SV2-65): the room the
// stage is given in a section (stageRoom, which the map's room() measures
// for), the keep on the stage (keepOnStage, which every pan, zoom and resize
// of the map goes through) and which floors a choice puts on the map. The
// pure arithmetic under them stays in ui/movement/layout.js, whose own cases
// are in test/ui/movement.test.mjs; these pin that the module applies it.
//
//   node test/ui/plan-map.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { stageRoom, keepOnStage, floorsShown, KEEP_ON_STAGE, CURSOR_LEAST } from '../../ui/surface/plan-map.js';
import { layoutFloors, stageLeast, STAGE_LEAST, ZOOM_ROOM, TITLE_ROWS } from '../../ui/movement/layout.js';
import { createViewport, CELL } from '../../ui/surface/viewport.js';

// A square building: its box at Fit across 844 px is taller than 120 px, so
// its least is STAGE_LEAST.
const SQUARE = { width: 40, height: 40 };
// One row of rooms under the floor's name: its box at Fit is under the zoom.
const ONE_ROW = { width: 200, height: 1 + TITLE_ROWS };

// A phone on its side (844 by 390 with touch): the first line folded with
// its padding 52 px, the bar 74 px, the legend's docked line 46 px.
const SIDE = { world: SQUARE, width: 844, zoomRoom: ZOOM_ROOM, line: 52, foot: 74 + 46, docked: 46, gap: 8, bar: 74 };

test('the constants the three sections share: 48 px kept on the stage, a 14 px cursor ring', () => {
  assert.equal(KEEP_ON_STAGE, 48);
  assert.equal(CURSOR_LEAST, 14);
  assert.equal(stageLeast(SQUARE, 844, ZOOM_ROOM), STAGE_LEAST, 'the fixture is no longer a building whose least is 120 px');
});

test('a section with room to spare gives the stage what is left under the first line and over the foot', () => {
  const room = stageRoom({ ...SIDE, height: 800 });
  assert.equal(room.room, 800 - 52 - 120);
  assert.equal(room.more, 800 - 52 - 120 + 46 - 8, 'More takes the map\'s height and the docked line, never the first line');
  assert.equal(room.bar, 74);
});

test('DECISIONS 2026-10-15 11:54: a section with less than the least scrolls; the stage is never squeezed under 120 px', () => {
  // 280 px of section: 108 px under the first line, so without the least the stage is 108
  const room = stageRoom({ ...SIDE, height: 280 });
  assert.equal(room.room, 120, 'the stage was squeezed to what the section has under its first line: ' + room.room);
  // More is measured from what the section has, not from the least
  assert.equal(room.more, 280 - 52 - 120 + 46 - 8);
});

test('DECISIONS 2026-10-16 01:15: under about 350 px the cap wins: the least is never more than the section has over the foot', () => {
  // 230 px: 110 px over the foot and the docked line (the 844 by 390 phone with touch)
  assert.equal(stageRoom({ ...SIDE, height: 230 }).room, 110);
  // 150 px: 30 over the foot, and nothing at all under the first line
  const tiny = stageRoom({ ...SIDE, height: 150 });
  assert.equal(tiny.room, 30);
  assert.equal(tiny.more, 46 - 8, 'with nothing under the first line More has the docked line less the gap');
  assert.equal(stageRoom({ ...SIDE, height: 100 }).room, 0, 'a section shorter than its foot gives the stage nothing, never a negative height');
});

test('DECISIONS 2026-10-16 01:15: a building one row high still gets what the zoom box needs as drawn: 70 px with touch, 62 with a mouse', () => {
  const one = { ...SIDE, world: ONE_ROW, height: 200 };
  // 200 - 52 - 120 = 28 px under the first line; 80 over the foot
  assert.equal(stageRoom(one).room, 70, 'under a finger');
  assert.equal(stageRoom({ ...one, zoomRoom: 62 }).room, 62, 'under a mouse');
  // and never more than the section has over the foot, whatever the zoom needs
  assert.equal(stageRoom({ ...one, height: 180 }).room, 60);
  // the box at Fit is enough where it is taller than the zoom: the least follows the floors
  const low = { width: 40, height: 2 };
  assert.equal(stageLeast(low, 844, 62), 81);
  assert.equal(stageRoom({ ...SIDE, world: low, zoomRoom: 62, height: 230 }).room, 81);
});

test('the foot\'s height is rounded up for scroll-padding-bottom, and measured in fractions everywhere else', () => {
  const room = stageRoom({ ...SIDE, height: 800.6, line: 52.3, foot: 120.2, bar: 74.2 });
  assert.equal(room.room, Math.floor(800.6 - 52.3 - 120.2));
  assert.equal(room.bar, 75);
});

test('SV2-52: a pan or a zoom far off leaves 48 px of the floors on the stage each way, through the module', () => {
  const world = layoutFloors([{ id: 'f1', width: 40, height: 30, cells: '#'.repeat(1200), spaces: [] }], 'side');
  const view = createViewport();
  view.resize(400, 300);
  view.fit({ x: 0, y: 0, w: world.width, h: world.height }, 20);
  assert.equal(keepOnStage(view, world), false, 'a fitted map was moved');
  // dragged far to the right and down
  view.panBy(5000, 5000);
  assert.equal(keepOnStage(view, world), true);
  assert.equal(view.x, 400 - KEEP_ON_STAGE);
  assert.equal(view.y, 300 - KEEP_ON_STAGE);
  // and far to the left and up
  view.panBy(-10000, -10000);
  assert.equal(keepOnStage(view, world), true);
  assert.equal(Math.round(view.x + world.width * view.size), KEEP_ON_STAGE);
  assert.equal(Math.round(view.y + world.height * view.size), KEEP_ON_STAGE);
  assert.equal(keepOnStage(view, world), false, 'a map already kept was moved again');
});

test('SV2-55 item 3: a 30 px stage over a 60 px box settles at once through the module, and a stage not yet measured is left alone', () => {
  const view = createViewport();
  view.resize(400, 30);
  view.zoom = 6 / CELL;
  view.x = 0;
  view.y = -200;
  const world = { width: 40, height: 10 };
  const ys = [];
  for (let event = 0; event < 4; event += 1) {
    keepOnStage(view, world);
    ys.push(view.y);
  }
  assert.deepEqual(ys, [-30, -30, -30, -30], 'the pan went one way and back: ' + ys.join(', '));
  const unmeasured = createViewport();
  unmeasured.x = -5000;
  assert.equal(keepOnStage(unmeasured, world), false);
  assert.equal(unmeasured.x, -5000);
  assert.equal(keepOnStage(view, null), false, 'with no floors laid out there is nothing to keep');
});

test('which floors a choice puts on the map: one by its id, every floor in the building\'s order otherwise', () => {
  const project = { building: { floors: [{ id: 'fa', name: 'One' }, { id: 'fb', name: 'Two' }] } };
  assert.deepEqual(floorsShown(project, 'fb').map((floor) => floor.id), ['fb']);
  for (const value of ['auto', 'side', 'stacked', 'fgone', undefined]) assert.deepEqual(floorsShown(project, value).map((floor) => floor.id), ['fa', 'fb'], String(value));
  assert.notEqual(floorsShown(project, 'auto'), project.building.floors, 'the building\'s own list was handed out');
});
