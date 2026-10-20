// The plan map's rules for the stage, through the module that Movement,
// Scenarios and Safety mount (ui/surface/plan-map.js, SV2-65): the room the
// stage is given in a section (stageRoom, which the map's room() measures
// for), the keep on the stage (keepOnStage, which every pan, zoom and resize
// of the map goes through), which floors a choice puts on the map, and the
// two options a section cannot leave out. The pure arithmetic under them is
// ui/surface/plan-layout.js, whose own cases are in test/ui/movement.test.mjs;
// these pin that the module applies it. The module in a page, mounted as a
// section mounts it, is test/browser/plan-map.mjs.
//
//   node test/ui/plan-map.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlanMap, stageRoom, keepOnStage, floorsShown, KEEP_ON_STAGE, CURSOR_LEAST } from '../../ui/surface/plan-map.js';
import * as planLayout from '../../ui/surface/plan-layout.js';
import * as oldPath from '../../ui/movement/layout.js';
import { layoutFloors, stageLeast, STAGE_LEAST, ZOOM_ROOM, TITLE_ROWS } from '../../ui/surface/plan-layout.js';
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

test('SV2-65b: a map needs a name and a frame, and is told which one is missing before it makes anything', () => {
  const ctx = { store: { project: null } };
  assert.throws(() => createPlanMap({ ctx, label: 'A map', frame: {} }), (error) => error instanceof TypeError && /needs a name/.test(error.message), 'a map with no name took Movement\'s ids');
  assert.throws(() => createPlanMap({ ctx, label: 'A map', name: '', frame: {} }), (error) => error instanceof TypeError && /needs a name/.test(error.message), 'an empty name was taken');
  assert.throws(() => createPlanMap({ ctx, label: 'A map', name: 'lab' }), (error) => error instanceof TypeError && /needs a frame/.test(error.message), 'a map with no frame was made, and its room and dock would do nothing');
  assert.throws(() => createPlanMap({ ctx, label: 'A map', name: 'lab', frame: null }), (error) => error instanceof TypeError && /needs a frame/.test(error.message));
  assert.throws(() => createPlanMap(), (error) => error instanceof TypeError && /needs a name/.test(error.message));
});

test('SV2-65b: the layout is ui/surface/plan-layout.js, and the old path under ui/movement hands on the same functions', () => {
  assert.ok(Object.keys(planLayout).length >= 10, 'the module lost its exports: ' + Object.keys(planLayout).join(', '));
  assert.deepEqual(Object.keys(oldPath).sort(), Object.keys(planLayout).sort());
  for (const key of Object.keys(planLayout)) assert.equal(oldPath[key], planLayout[key], key + ' at the old path is not the same one');
});

// ---- SV2-72c item 1 (W1): Fit leaves the zoom buttons' corner clear

import { fitClear, paintedUnder, ZOOM_GAP, FIT_MARGIN, bestLayout } from '../../ui/surface/plan-layout.js';
import { sampleSchool } from '../../data/sample-school.js';

// the zoom box as drawn: 12 px from the stage's edge, 38 px tall with a
// mouse (46 with touch), about 170 px wide
const corner = (height, tall = 38) => ({ x: 12, y: height - 12 - tall, w: 170, h: tall });
const grown = (box) => ({ x: box.x - ZOOM_GAP, y: box.y - ZOOM_GAP, w: box.w + ZOOM_GAP * 2, h: box.h + ZOOM_GAP * 2 });

// stages of a section: a desktop window's, a phone's upright and on its
// side (110 px was the walk-through's, 160 W5's least); the box 38 px tall
// with a mouse, 46 with touch
const STAGES = [[1080, 640, 38], [920, 540, 38], [390, 470, 46], [844, 160, 46], [844, 110, 46], [900, 140, 38]];

test('W1: the sample school at Fit has no painted cell under the zoom box on any stage of the walk-through, where a plain fit has', () => {
  const floors = sampleSchool().building.floors;
  let plainCovered = 0;
  for (const [width, height, tall] of STAGES) {
    const layout = layoutFloors(floors, bestLayout(floors, width, height));
    const box = corner(height, tall);
    const plain = fitClear(layout, width, height, null);
    if (paintedUnder(layout, plain, grown(box))) plainCovered += 1;
    const fitted = fitClear(layout, width, height, box);
    assert.equal(fitted.clear, true, width + ' by ' + height + ': ' + JSON.stringify(fitted));
    assert.equal(paintedUnder(layout, fitted, grown(box)), false, width + ' by ' + height + ': a painted cell under the zoom box at Fit');
    assert.ok(fitted.zoom <= plain.zoom + 1e-9, 'a fit round the box is never larger than the plain one');
  }
  assert.ok(plainCovered >= 4, 'the plain fit covers a painted cell on only ' + plainCovered + ' stages: the case tests nothing');
});

test('W1: a plain fit with only empty cells under the box stands, number for number the viewport\'s own fit', () => {
  // one floor whose drawing is all in its top right quarter
  const floor = { id: 'f1', name: 'Floor 1', width: 40, height: 30, cells: Array(1200).fill('.'), spaces: [], exits: [], corridors: [] };
  for (let y = 0; y < 15; y += 1) for (let x = 20; x < 40; x += 1) floor.cells[y * 40 + x] = 'c';
  floor.cells[29 * 40] = '.';
  // the drawn box is the corridor with its air; make it reach the corner by a lone empty frame
  floor.spaces.push({ id: 'o1', kind: 'other', cells: [29 * 40 + 39], doors: [] });
  const layout = layoutFloors([floor], 'side');
  const fitted = fitClear(layout, 800, 500, corner(500));
  assert.equal(fitted.how, 'whole');
  const view = createViewport();
  view.resize(800, 500);
  view.fit({ x: 0, y: 0, w: layout.width, h: layout.height }, FIT_MARGIN);
  assert.deepEqual([fitted.zoom, fitted.x, fitted.y], [view.zoom, view.x, view.y]);
});

test('W1: the band above the box is taken where it clears the corner, never wider or lower than the plain fit; the band beside only where it cannot', () => {
  const floors = sampleSchool().building.floors;
  // the three floors side by side on a wide low stage: above, though beside would be larger
  const side = layoutFloors(floors, 'side');
  const low = fitClear(side, 1120, 160, corner(160));
  assert.equal(low.how, 'above', JSON.stringify(low));
  const plain = fitClear(side, 1120, 160, null);
  const size = (place) => CELL * place.zoom;
  assert.ok(low.x >= plain.x - 1e-9 && low.x + side.width * size(low) <= plain.x + side.width * size(plain) + 1e-9, 'the map above the box is wider than the plain fit\'s');
  assert.ok(low.y + side.height * size(low) <= plain.y + side.height * size(plain) + 1e-9, 'the map above the box runs lower than the plain fit\'s');
  // stacked on a phone upright: above, its foot over the box
  const stacked = layoutFloors(floors, 'stacked');
  const high = fitClear(stacked, 390, 470, corner(470, 46));
  assert.equal(high.how, 'above', JSON.stringify(high));
  assert.ok(high.y + stacked.height * CELL * high.zoom <= 470 - 12 - 46 - ZOOM_GAP + 1e-9, 'the floors run down past the band above the box');
  // a strip 60 px tall: 25 % is too tall for the band above, and the band beside clears the corner
  const strip = fitClear(side, 844, 60, corner(60, 46));
  assert.equal(strip.zoom, 0.25);
  assert.equal(strip.how, 'beside', JSON.stringify(strip));
  assert.equal(strip.clear, true, JSON.stringify(strip));
  assert.ok(strip.x >= 12 + 170 + ZOOM_GAP - 1e-9, 'the floors start under the zoom box');
});
