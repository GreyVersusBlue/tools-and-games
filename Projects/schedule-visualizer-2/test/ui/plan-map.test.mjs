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

import { fitClear, paintedUnder, ZOOM_GAP, ZOOM_GAP_LEAST, FIT_MARGIN, bestLayout } from '../../ui/surface/plan-layout.js';
import { sampleSchool } from '../../data/sample-school.js';

// the zoom box as drawn: 12 px from the stage's edge, 38 px tall with a
// mouse (46 with touch), about 170 px wide
const corner = (height, tall = 38) => ({ x: 12, y: height - 12 - tall, w: 170, h: tall });
const grown = (box, gap = ZOOM_GAP) => ({ x: box.x - gap, y: box.y - gap, w: box.w + gap * 2, h: box.h + gap * 2 });

// stages of a section: a desktop window's, a phone's upright and on its
// side (160 is W5's least); the box 38 px tall with a mouse, 46 with touch.
// The walk-through's 110 px on its side has no clear fit with the map whole
// and is SV2-72f's case below.
const STAGES = [[1080, 640, 38], [920, 540, 38], [390, 470, 46], [844, 160, 46], [900, 140, 38]];

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
    // the gap may close to ZOOM_GAP_LEAST over the box where the floors' names would run off the top
    assert.equal(paintedUnder(layout, fitted, grown(box, ZOOM_GAP_LEAST)), false, width + ' by ' + height + ': a painted cell under the zoom box at Fit');
    assert.ok(fitted.y >= -1e-9 || fitted.how === 'beside', width + ' by ' + height + ': the floors\' names run off the stage\'s top: ' + JSON.stringify(fitted));
    assert.ok(fitted.zoom <= plain.zoom + 1e-9, 'a fit round the box is never larger than the plain one');
  }
  assert.ok(plainCovered >= 3, 'the plain fit covers a painted cell on only ' + plainCovered + ' stages: the case tests nothing');
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

// ---- SV2-72f

// The floors a fit leaves off a stage, each with its name row over it
// (TITLE_ROWS cells), as the browser checks count them (test/browser/plan-map.mjs
// and m5-pass.mjs): a floor whose name runs off the top is not whole.
const offStage = (layout, place, width, height) => {
  const size = CELL * place.zoom;
  return layout.slots.filter((slot) => place.x + slot.x * size < -1e-9 || place.y + (slot.y - TITLE_ROWS) * size < -1e-9 || place.x + (slot.x + slot.w) * size > width + 1e-9 || place.y + (slot.y + slot.h) * size > height + 1e-9);
};

test('SV2-72f: where no band clears the zoom box with the map whole, Fit is the plain fit, every floor on the stage', () => {
  const floors = sampleSchool().building.floors;
  // Movement at 844 by 390 with touch: the stage 788 by 110, the zoom box 182 by 46 at 12 px
  const [width, height] = [788, 110];
  const layout = layoutFloors(floors, bestLayout(floors, width, height));
  const box = { x: 12, y: height - 12 - 46, w: 182, h: 46 };
  const fitted = fitClear(layout, width, height, box);
  const size = CELL * fitted.zoom;
  const floorsOff = offStage(layout, fitted, width, height);
  assert.equal(fitted.zoom, 0.25, 'the map is not at the least zoom: the case tests nothing');
  // the band beside the box is clear and runs off the stage's right: what Fit took before
  const beside = (width - box.x - box.w - ZOOM_GAP - FIT_MARGIN) / (layout.width * CELL);
  assert.ok(beside < 0.25, 'the floors fit beside the box: the case tests nothing');
  assert.deepEqual(floorsOff.map((slot) => slot.floor.name), [], 'floors off the stage at Fit: ' + JSON.stringify(fitted));
  assert.equal(fitted.how, 'whole', JSON.stringify(fitted));
  assert.equal(fitted.clear, false, 'the plain fit has painted cells under the box here, and says so');
  // and a strip the plain fit cannot hold whole either keeps the clear band
  const strip = fitClear(layout, 844, 60, corner(60, 46));
  assert.equal(strip.how, 'beside', JSON.stringify(strip));
});

// The plan map passes plainWhole false where the floors cannot be whole
// above a sticky foot (its choose): the clear band stands over the plain fit.
test('SV2-72f2: with plainWhole false the 110 px stage keeps the clear band beside the zoom box, not the plain fit', () => {
  const floors = sampleSchool().building.floors;
  const [width, height] = [788, 110];
  const layout = layoutFloors(floors, bestLayout(floors, width, height));
  const box = { x: 12, y: height - 12 - 46, w: 182, h: 46 };
  const plain = fitClear(layout, width, height, box);
  assert.equal(plain.how, 'whole', 'with plainWhole true the plain fit is not taken here: the case tests nothing: ' + JSON.stringify(plain));
  const kept = fitClear(layout, width, height, box, FIT_MARGIN, false);
  assert.equal(kept.clear, true, JSON.stringify(kept));
  assert.equal(kept.how, 'beside', JSON.stringify(kept));
  assert.equal(paintedUnder(layout, kept, grown(box)), false, 'a painted cell under the zoom box: ' + JSON.stringify(kept));
});

// A zoom box lifted to the stage's top (a foot over all of a short stage)
// leaves no band above it: Fit is still a place on the stage, never the band
// of no height, and with plainWhole false still a clear one.
test('SV2-72f2: a zoom box at the stage\'s top or above it leaves a band of 0 or less: Fit is finite, not the band above, and clear with plainWhole false', () => {
  const floors = sampleSchool().building.floors;
  const [width, height] = [788, 110];
  const layout = layoutFloors(floors, bestLayout(floors, width, height));
  for (const y of [0, -10]) {
    const box = { x: 12, y, w: 182, h: 46 };
    for (const plainWhole of [true, false]) {
      const place = fitClear(layout, width, height, box, FIT_MARGIN, plainWhole);
      const what = 'box at ' + y + ', plainWhole ' + plainWhole + ': ' + JSON.stringify(place);
      assert.ok([place.zoom, place.x, place.y].every(Number.isFinite), what);
      assert.notEqual(place.how, 'above', what);
      if (plainWhole) assert.deepEqual(offStage(layout, place, width, height), [], what);
      else assert.equal(place.clear, true, what);
    }
  }
});

// ---- SV2-72c2

test('item 9: on a phone on its side Safety\'s 160 px stage keeps the floors\' names whole at Fit, the map above the zoom box', () => {
  const floors = sampleSchool().building.floors;
  // 844 by 390 with touch: the stage 788 px wide beside the rail, 160 tall, the zoom box 182 by 46 at 12 px
  const layout = layoutFloors(floors, bestLayout(floors, 788, 160));
  const box = { x: 12, y: 160 - 12 - 46, w: 182, h: 46 };
  const fitted = fitClear(layout, 788, 160, box);
  assert.equal(fitted.how, 'above', JSON.stringify(fitted));
  assert.equal(fitted.zoom, 0.25, 'the map is not at the least zoom: the case tests nothing');
  assert.ok(layout.height * CELL * 0.25 > box.y - FIT_MARGIN - ZOOM_GAP, 'the map fits the band above with its margins: the case tests nothing');
  assert.ok(fitted.y >= 0, 'the floors\' name row runs ' + (-fitted.y).toFixed(1) + ' px off the stage\'s top');
  assert.ok(fitted.y + layout.height * CELL * fitted.zoom <= box.y - ZOOM_GAP_LEAST + 1e-9, 'the map runs into the gap over the zoom box');
  assert.equal(paintedUnder(layout, fitted, grown(box, ZOOM_GAP_LEAST)), false);
});

test('item 7: a section\'s own least is capped by the floors\' box at Fit with its top margin, the gap and the zoom box\'s need over it, not by the box and two margins', () => {
  // a building two rows high across 844 px: its box at Fit is 40.2 px
  const low = { width: 40, height: 2 };
  const zoom = Math.min(1, (844 - FIT_MARGIN * 2) / (low.width * CELL));
  const box = low.height * CELL * zoom;
  assert.equal(stageLeast(low, 844, 70), Math.ceil(box + FIT_MARGIN * 2), 'with no least of its own the stage gets the box and two margins');
  assert.equal(stageLeast(low, 844, 70, 160), Math.ceil(box + FIT_MARGIN + ZOOM_GAP + 70), 'a least of 160 is not capped at the box, its top margin, the gap and the zoom box\'s need');
  assert.equal(stageLeast(low, 844, 70, 160), 139);
  // a building the least does not cap: 160 whole; and never under what the zoom box needs
  assert.equal(stageLeast(SQUARE, 844, 70, 160), 160);
  assert.equal(stageLeast(ONE_ROW, 844, 70, 160), Math.min(160, Math.ceil(ONE_ROW.height * CELL * 0.25 + FIT_MARGIN + ZOOM_GAP + 70)));
  assert.equal(stageLeast(null, 844, 70, 160), 160, 'with no floors yet the least is the section\'s own');
  assert.equal(stageLeast(SQUARE, 844, 70, 0), STAGE_LEAST, 'a least of 0 is no least of the section\'s own');
});

test('item 7: with a least of its own the stage may take the docked line, which is then scrolled to under it: the cap is the section less the foot, not less the foot and the docked line', () => {
  // the phone on its side: 230 px of section, the bar 74 px, the docked line 46
  const plain = stageRoom({ ...SIDE, height: 230 });
  assert.equal(plain.room, 110, 'with no least of its own the stage is what is over the foot and the docked line');
  const own = stageRoom({ ...SIDE, height: 230, least: 160 });
  assert.equal(own.room, 230 - 74, 'the stage with a least of 160 is not the section less the bar alone');
  assert.equal(stageRoom({ ...SIDE, height: 300, least: 160 }).room, 160, 'with room for its least the stage is the least');
  // More is measured from what the section has under its first line, as before
  assert.equal(own.more, plain.more);
});

test('SV2-72g: where both layouts fit only at the least zoom, the one nearer to fitting is taken: at Movement\'s 648 by 320 (1024 by 600) the sample stacked, whole on the stage at 25 %', () => {
  const floors = sampleSchool().building.floors;
  const [width, height] = [648, 320];
  const side = layoutFloors(floors, 'side');
  // side by side at the least zoom is wider than the stage: what Fit had shown, 48 px off its left edge
  assert.ok(side.width * CELL * 0.25 > width, 'the floors side by side fit the stage: the case tests nothing');
  assert.equal(bestLayout(floors, width, height), 'stacked');
  const layout = layoutFloors(floors, 'stacked');
  const fitted = fitClear(layout, width, height, corner(height));
  const size = CELL * fitted.zoom;
  assert.equal(fitted.zoom, 0.25);
  assert.ok(fitted.x >= 0 && fitted.x + layout.width * size <= width && fitted.y >= 0 && fitted.y + layout.height * size <= height, 'stacked is not whole on the stage: ' + JSON.stringify(fitted));
  // and a stage too low for either keeps the floors side by side, the nearer there
  assert.equal(bestLayout(floors, 760, 60), 'side');
});

// ---- SV2-72h item 3 and SV2-72i items 1 and 2: the layout kept unless the
// other is clearly larger, and never kept off the stage where the other is on it

import { rawZoom, fitZoom, LAYOUT_MARGIN } from '../../ui/surface/plan-layout.js';
import { clampZoom, MIN_ZOOM } from '../../ui/surface/viewport.js';

// Where Fit itself puts a layout on a stage with no foot and no zoom box
// (fitClear), and whether every floor is on the stage there, read from the
// layout's own box at that place. Nothing of bestLayout's arithmetic is
// copied here: what is judged is the picture Fit draws (house rule #34).
function fitBox(floors, how, width, height) {
  const layout = layoutFloors(floors, how);
  const place = fitClear(layout, width, height, null);
  const size = CELL * place.zoom;
  const right = place.x + layout.width * size;
  const bottom = place.y + layout.height * size;
  const whole = place.x >= -1e-9 && place.y >= -1e-9 && right <= width + 1e-9 && bottom <= height + 1e-9;
  return { how, zoom: place.zoom, whole, x: Math.round(place.x), y: Math.round(place.y), right: Math.round(right), bottom: Math.round(bottom) };
}
const otherOf = (how) => (how === 'side' ? 'stacked' : 'side');

test('SV2-72i item 1: at 700 by 300 with side by side on the map, stacked is taken: side by side runs 22 px off each edge at 25 %, stacked is whole', () => {
  const floors = sampleSchool().building.floors;
  const side = fitBox(floors, 'side', 700, 300);
  const stacked = fitBox(floors, 'stacked', 700, 300);
  // the point: Fit puts side by side off both edges at the least zoom, stacked whole
  assert.ok(side.zoom === MIN_ZOOM && !side.whole && side.x === -22 && side.right === 722, 'side by side is not 22 px off each edge at 25 %: the case tests nothing: ' + JSON.stringify(side));
  assert.ok(stacked.whole, 'stacked is not whole at 700 by 300: the case tests nothing: ' + JSON.stringify(stacked));
  assert.equal(bestLayout(floors, 700, 300, 'side'), 'stacked', 'side by side, on the map, was kept with its floors off the stage where stacked is whole');
  assert.equal(bestLayout(floors, 700, 300, 'stacked'), 'stacked');
  assert.equal(bestLayout(floors, 700, 300), 'stacked');
});

// Every stage from 300 to 1400 wide by 100 to 500 tall, `step` px apart,
// with each layout on the map and none: where Fit puts one layout whole on
// the stage and not the other, the whole one is taken; where both are
// whole, the one taken is never more than LAYOUT_MARGIN smaller at Fit. The
// review counted 2074 points of 1 px where side by side was kept off the
// stage; the sample's boundaries are not on a 4 px grid, so this steps 3 px
// one way and 1 px across the boundaries the other.
test('SV2-72i item 2: across 300 to 1400 by 100 to 500, a layout off the stage at Fit is never taken where the other is whole, with either on the map', () => {
  const floors = sampleSchool().building.floors;
  const wrong = [];
  let split = 0;
  for (let width = 300; width <= 1400; width += 3) {
    for (let height = 100; height <= 500; height += 1) {
      const boxes = { side: fitBox(floors, 'side', width, height), stacked: fitBox(floors, 'stacked', width, height) };
      if (boxes.side.whole !== boxes.stacked.whole) split += 1;
      for (const current of ['side', 'stacked', undefined]) {
        const how = bestLayout(floors, width, height, current);
        const taken = boxes[how];
        const other = boxes[otherOf(how)];
        if (!taken.whole && other.whole) wrong.push({ width, height, current, how, taken });
        else if (taken.whole && other.whole && other.zoom > taken.zoom * (1 + LAYOUT_MARGIN) + 1e-12) wrong.push({ width, height, current, how, taken, other });
      }
    }
  }
  // the sweep crosses places where one layout is whole and the other is not, or it tests nothing
  assert.ok(split > 1000, 'the sweep met only ' + split + ' stages where one layout is whole and the other not: the case tests nothing');
  assert.equal(wrong.length, 0, wrong.length + ' stages took a layout Fit draws off the stage, or one more than the margin smaller: ' + JSON.stringify(wrong.slice(0, 5)));
});

// The window's width (or height) in 1 px steps up across the boundary and
// back down, the layout on the map handed in each time as the plan map hands it.
function sweep(floors, from, to, at) {
  const step = from < to ? 1 : -1;
  const seen = [];
  let current;
  for (let n = from; n !== to + step; n += step) {
    const [width, height] = at(n);
    current = bestLayout(floors, width, height, current);
    seen.push({ n, width, height, how: current, box: fitBox(floors, current, width, height), other: fitBox(floors, otherOf(current), width, height) });
  }
  return seen;
}
const turnsOf = (seen) => seen.filter((each, at) => at > 0 && each.how !== seen[at - 1].how);

for (const [what, from, to, at] of [
  ['400 px tall, the width swept, where both fit over 25 %', 600, 1400, (n) => [n, 400]],
  ['300 px tall, the width swept, across the clamp', 600, 1400, (n) => [n, 300]],
  ['322 px tall, the width swept, SV2-72h\'s 1 px flip at 749 to 783 wide', 600, 1400, (n) => [n, 322]],
  ['760 px wide, the height swept', 100, 700, (n) => [760, n]],
  ['1000 px wide, the height swept', 100, 700, (n) => [1000, n]],
]) {
  test('SV2-72h item 3, SV2-72i: the sample\'s floors on a stage ' + what + ' 1 px at a time each way: at most one turn each way, the turns apart, never a layout off the stage where the other is whole', () => {
    const floors = sampleSchool().building.floors;
    const up = sweep(floors, from, to, at);
    const down = sweep(floors, to, from, at);
    const upTurns = turnsOf(up);
    const downTurns = turnsOf(down);
    // the sweep turns the layout, or it tests nothing
    assert.equal(upTurns.length, 1, 'going up the layout turned ' + upTurns.length + ' times: ' + JSON.stringify(upTurns.map((each) => [each.n, each.how])));
    assert.equal(downTurns.length, 1, 'going down the layout turned ' + downTurns.length + ' times: ' + JSON.stringify(downTurns.map((each) => [each.n, each.how])));
    // a layout kept past the boundary each way: the turn up comes later than the turn down, never at one pixel back and forth
    assert.ok(upTurns[0].n > downTurns[0].n, 'the turns are at one pixel, a flip: ' + JSON.stringify({ up: upTurns[0].n, down: downTurns[0].n }));
    for (const each of up.concat(down)) assert.ok(each.box.whole || !each.other.whole, 'at ' + each.width + ' by ' + each.height + ' ' + each.how + ' was taken off the stage where the other is whole: ' + JSON.stringify(each.box));
  });
}

test('SV2-72h item 3: across the clamp a layout the window holds at 25 % beats the one on the map that it cannot hold, however near the two are', () => {
  const floors = sampleSchool().building.floors;
  // 742 wide: side by side at 25 % (744 px) does not fit by 2 px; stacked does
  const [width, height] = [742, 322];
  const side = fitBox(floors, 'side', width, height);
  const stacked = fitBox(floors, 'stacked', width, height);
  assert.ok(!side.whole && stacked.whole && side.zoom === MIN_ZOOM, 'the point is not across the clamp: the case tests nothing: ' + JSON.stringify({ stacked, side }));
  assert.equal(bestLayout(floors, width, height, 'side'), 'stacked', 'side by side, on the map, was kept where its floors run off the stage at 25 %');
  assert.equal(bestLayout(floors, width, height, 'stacked'), 'stacked');
  assert.equal(bestLayout(floors, width, height), 'stacked');
});

test('SV2-72h nits: fitZoom is rawZoom clamped, and bestLayout takes the layout Fit puts at the larger zoom', () => {
  const floors = sampleSchool().building.floors;
  for (const how of ['side', 'stacked']) {
    const layout = layoutFloors(floors, how);
    for (const [width, height] of [[200, 100], [749, 322], [990, 400], [3000, 3000], [60, 40]]) {
      for (const margin of [undefined, 0, FIT_MARGIN]) assert.equal(fitZoom(layout, width, height, margin), clampZoom(rawZoom(layout, width, height, margin)));
    }
  }
  // every 1 px across the boundary at 400 px tall: no layout handed in, the one Fit draws larger (above the clamp, where Fit's zoom tells them apart)
  for (let width = 960; width <= 1020; width += 1) {
    const side = fitBox(floors, 'side', width, 400);
    const stacked = fitBox(floors, 'stacked', width, 400);
    if (side.zoom === stacked.zoom) continue;
    assert.equal(bestLayout(floors, width, 400), side.zoom > stacked.zoom ? 'side' : 'stacked', 'at ' + width + ' by 400 bestLayout took the layout Fit draws smaller: ' + JSON.stringify({ side, stacked }));
  }
});

// ---- SV2-32a: Fit judged against what it draws, with the sticky foot and
// the zoom box. Every place below is chooseFit's own (the plan map's choose
// hands it the boxes it measures and returns what it says), and every
// judgement is read from the floors' boxes at that place: nothing of
// bestLayout's or chooseFit's arithmetic is copied here (house rule #34).

import { chooseFit, zoomCornerAt, liftOver } from '../../ui/surface/plan-layout.js';

// the zoom box as the sheet draws it: 12 px in, 170 by 38 under a mouse, 182 by 46 under a finger
const ZOOM_IN = 12;
const MOUSE = { w: 170, h: 38 };
const FINGER = { w: 182, h: 46 };
// where the plan map's choose puts it, lifted over a foot `foot` px over the stage
const cornerOver = (height, foot, box) => zoomCornerAt(height, box, ZOOM_IN, liftOver(height, box.h, ZOOM_IN, foot));

// What Fit draws of `layout` on the stage, and how it lies: every floor
// with its name row whole on the stage, and whole above the foot.
function drawn(layout, width, height, foot, box) {
  const place = chooseFit(layout, width, height, foot, box ? cornerOver(height, foot, box) : null, FIT_MARGIN);
  const size = CELL * place.zoom;
  const boxes = layout.slots.map((slot) => ({ name: slot.floor.name, left: place.x + slot.x * size, top: place.y + (slot.y - TITLE_ROWS) * size, right: place.x + (slot.x + slot.w) * size, bottom: place.y + (slot.y + slot.h) * size }));
  const off = boxes.filter((b) => b.left < -1e-9 || b.top < -1e-9 || b.right > width + 1e-9 || b.bottom > height + 1e-9);
  const under = boxes.filter((b) => b.bottom > height - foot + 1e-9);
  return { how: layout.how, place, whole: off.length === 0, above: off.length === 0 && under.length === 0, off: off.map((b) => b.name + ' ' + Math.round(b.left) + '..' + Math.round(b.right) + ' x ' + Math.round(b.top) + '..' + Math.round(b.bottom)) };
}

test('SV2-32a: at 798 by 120 with a 40 px foot every floor is drawn on the stage: side by side was fitted beside the zoom box, past the right edge, where its plain fit is whole', () => {
  const floors = sampleSchool().building.floors;
  const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
  for (const box of [MOUSE, FINGER]) {
    const say = (box === MOUSE ? 'with a mouse' : 'with a finger') + ': ';
    // the point: neither layout can be whole above the foot, and side by side at 25 % is narrower than the stage
    assert.ok(!drawn(both.side, 798, 80, 0, box).whole && !drawn(both.stacked, 798, 80, 0, box).whole, say + 'a layout is whole above the foot: the case tests nothing');
    assert.ok(both.side.width * CELL * 0.25 <= 798 && both.side.height * CELL * 0.25 <= 120, say + 'side by side at 25 % is not inside the stage: the case tests nothing');
    for (const current of ['side', 'stacked', undefined]) {
      const how = bestLayout(floors, 798, 120, current, both, { foot: 40, corner: cornerOver(120, 40, box) });
      const got = drawn(both[how], 798, 120, 40, box);
      assert.deepEqual(got.off, [], say + 'with ' + current + ' on the map ' + how + ' was drawn off the stage: ' + JSON.stringify(got.place));
    }
  }
});

// The feet a section's sticky foot lies over the stage by: none, a phone on
// its side once the first line stops the scroll (12), a playback bar (40),
// most of a short stage (100); the zoom box under a mouse and a finger.
const FEET = [0, 12, 40, 100];

// Every stage from 300 to 1400 wide by 100 to 500 tall with each foot, each
// layout on the map and none, as the plan map judges it (the foot and the
// zoom box handed in): what is taken is never drawn with a floor off the
// stage where its own plain fit (no foot, no zoom box) is whole, nor where
// the other is drawn whole, nor drawn under the foot where the
// other is drawn whole above it larger (or as large, with no layout on the map). Steps of 7 by 3 px, not on
// the sample's boundaries.
test('SV2-32a: across 300 to 1400 by 100 to 500 with feet of 0, 12, 40 and 100 px, the layout taken is never drawn off the stage where it or the other can be whole, nor under the foot where the other is whole above it and larger', () => {
  const floors = sampleSchool().building.floors;
  const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
  const wrong = [];
  const met = { split: 0, aboveSplit: 0, offTaken: 0, under: 0 };
  for (const foot of FEET) {
    const box = foot % 24 === 0 ? MOUSE : FINGER;
    for (let width = 300; width <= 1400; width += 7) {
      for (let height = 100; height <= 500; height += 3) {
        if (foot >= height) continue;
        const pictures = { side: drawn(both.side, width, height, foot, box), stacked: drawn(both.stacked, width, height, foot, box) };
        // and whether the plain fit, no foot and no zoom box, has every floor on the stage
        const plain = { side: drawn(both.side, width, height, 0, null).whole, stacked: drawn(both.stacked, width, height, 0, null).whole };
        if (pictures.side.whole !== pictures.stacked.whole) met.split += 1;
        if (pictures.side.whole && pictures.stacked.whole && pictures.side.above !== pictures.stacked.above) met.aboveSplit += 1;
        for (const current of ['side', 'stacked', undefined]) {
          const how = bestLayout(floors, width, height, current, both, { foot, corner: cornerOver(height, foot, box) });
          const taken = pictures[how];
          const other = pictures[otherOf(how)];
          if (!taken.whole) met.offTaken += 1;
          if (taken.whole && !taken.above) met.under += 1;
          if (!taken.whole && plain[how]) wrong.push({ width, height, foot, current, how, off: taken.off, plainWhole: true });
          else if (!taken.whole && other.whole) wrong.push({ width, height, foot, current, how, off: taken.off });
          else if (taken.whole && !taken.above && other.above && (other.place.zoom > taken.place.zoom || (current === undefined && other.place.zoom === taken.place.zoom))) wrong.push({ width, height, foot, current, how, under: true, zoom: [taken.place.zoom, other.place.zoom] });
        }
      }
    }
  }
  // the sweep meets each thing it judges, or it tests nothing
  assert.ok(met.split > 1000, 'the sweep met only ' + met.split + ' stages where one layout is drawn whole and the other not: ' + JSON.stringify(met));
  assert.ok(met.aboveSplit > 100, 'the sweep met only ' + met.aboveSplit + ' stages where one layout is drawn above the foot and the other under it: ' + JSON.stringify(met));
  assert.ok(met.under > 100, 'the sweep met only ' + met.under + ' stages where the layout taken lies under the foot: ' + JSON.stringify(met));
  assert.equal(wrong.length, 0, wrong.length + ' stages took a layout Fit draws off the stage where it or the other can be whole, or under the foot where the other is above it: ' + JSON.stringify(wrong.slice(0, 5)));
});

// A window a pixel either way at every pixel of a sweep, from the layout
// the window took there: once it turns a pixel back, a pixel forward again
// keeps what it turned to. A flip at a single pixel is a layout turning
// each way as a window's edge is dragged across one pixel.
function flipsOn(floors, both, foot, box, sizes) {
  const take = ([width, height], current) => bestLayout(floors, width, height, current, both, { foot, corner: cornerOver(height, foot, box) });
  const flips = [];
  let turns = 0;
  let current;
  for (let at = 0; at < sizes.length; at += 1) {
    const was = current;
    current = take(sizes[at], current);
    if (at > 0 && current !== was) turns += 1;
    if (at === 0) continue;
    // back a pixel from here, then forward again
    const back = take(sizes[at - 1], current);
    const again = take(sizes[at], back);
    if (back !== current && again !== back) flips.push({ at: sizes[at], from: current, back, again });
  }
  return { flips, turns };
}

for (const [what, sizes] of [
  ['the width swept at 200 px tall', Array.from({ length: 1101 }, (_, n) => [300 + n, 200])],
  ['the width swept at 300 px tall', Array.from({ length: 1101 }, (_, n) => [300 + n, 300])],
  ['the width swept at 322 px tall', Array.from({ length: 1101 }, (_, n) => [300 + n, 322])],
  ['the height swept at 760 px wide', Array.from({ length: 501 }, (_, n) => [760, 100 + n])],
  ['the height swept at 798 px wide', Array.from({ length: 501 }, (_, n) => [798, 100 + n])],
  ['the height swept at 1000 px wide', Array.from({ length: 501 }, (_, n) => [1000, 100 + n])],
]) {
  test('SV2-32a: ' + what + ', 1 px at a time with feet of 0, 12, 40 and 100 px: never a flip at a single pixel', () => {
    const floors = sampleSchool().building.floors;
    const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
    let turned = 0;
    for (const foot of FEET) {
      for (const box of [MOUSE, FINGER]) {
        const { flips, turns } = flipsOn(floors, both, foot, box, sizes.filter(([, height]) => height > foot));
        turned += turns;
        assert.deepEqual(flips.slice(0, 3), [], 'with a ' + foot + ' px foot and the ' + (box === MOUSE ? 'mouse' : 'finger') + '\'s zoom box the layout flips at a single pixel (' + flips.length + ' places)');
      }
    }
    // the sweep turns the layout, or it tests nothing
    assert.ok(turned > 0, 'the layout never turned along the sweep: the case tests nothing');
  });
}

// ---- SV2-32j: the second judgement as arrange() makes it. arrange() asks
// windowLayout (plan-map.js) with the layout on the map before it and a
// `take` that sets the stage's room and returns the stage as that leaves
// it; these cases hand it a stand-in stage, so the judgement is the plan
// map's own path, not bestLayout called as a test would call it.

import { windowLayout } from '../../ui/surface/plan-map.js';

// a stand-in stage: `width` by `height` whatever is taken, the foot over it
// by `foot` and the zoom box `box` lifted over it; every layout taken, in order
function standIn(width, height, foot, box) {
  const taken = [];
  const take = (how) => {
    taken.push(how);
    return { width, height, foot, corner: box ? cornerOver(height, foot, box) : null };
  };
  return { take, taken };
}
const arranged = (floors, both, onMap, [width, height], foot, box) => {
  const stage = standIn(width, height, foot, box);
  const how = windowLayout(floors, both, onMap, width, height, stage.take);
  return { how, taken: stage.taken };
};

test('SV2-32j: the sample opened fresh at 744 by 308 under a 40 px foot with a mouse is drawn side by side, whole above the foot, where stacked lies under it at the same 25 %', () => {
  const floors = sampleSchool().building.floors;
  const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
  const side = drawn(both.side, 744, 308, 40, MOUSE);
  const stacked = drawn(both.stacked, 744, 308, 40, MOUSE);
  // the point: both whole, only side by side above the foot, and the same zoom
  assert.ok(side.above && stacked.whole && !stacked.above && side.place.zoom === stacked.place.zoom, 'the stage is not the tie it was found at: the case tests nothing (' + JSON.stringify({ side: side.place, stacked: stacked.place }) + ')');
  const fresh = arranged(floors, both, undefined, [744, 308], 40, MOUSE);
  assert.equal(fresh.how, 'side', 'opened fresh, ' + fresh.taken.join(' then ') + ' was taken: stacked drawn under the foot where side by side is whole above it at the same zoom (the tie with none on the map judged as if the first choice were on it)');
  // with a layout on the map the tie keeps it (SV2-32a: that flipped at a pixel)
  assert.equal(arranged(floors, both, 'stacked', [744, 308], 40, MOUSE).how, 'stacked', 'stacked, on the map, was turned on a tie');
  assert.equal(arranged(floors, both, 'side', [744, 308], 40, MOUSE).how, 'side');
});

test('SV2-32j: the second judgement is made on the stage take() returns, not on the one measured before it', () => {
  const floors = sampleSchool().building.floors;
  const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
  // stacked on the map, measured at 744 by 300; the room set leaves 744 by 200 with the foot 40 px over it
  const before = { side: drawn(both.side, 744, 300, 40, MOUSE), stacked: drawn(both.stacked, 744, 300, 40, MOUSE) };
  const after = { side: drawn(both.side, 744, 200, 40, MOUSE), stacked: drawn(both.stacked, 744, 200, 40, MOUSE) };
  // the point: on the stage measured before, stacked is kept; on the one the
  // room leaves, it runs off the stage where side by side is whole, so no
  // tie rule decides it
  assert.equal(bestLayout(floors, 744, 300, 'stacked', both), 'stacked', 'at 744 by 300 the first judgement turns stacked: the case tests nothing');
  assert.equal(bestLayout(floors, 744, 300, 'stacked', both, { foot: 40, corner: cornerOver(300, 40, MOUSE) }), 'stacked', 'at 744 by 300 the foot turns stacked: the case tests nothing (' + JSON.stringify(before) + ')');
  assert.ok(after.side.whole && !after.stacked.whole, 'at 744 by 200 side by side is not whole where stacked runs off: the case tests nothing (' + JSON.stringify(after) + ')');
  const stage = standIn(744, 200, 40, MOUSE);
  const how = windowLayout(floors, both, 'stacked', 744, 300, stage.take);
  assert.equal(how, 'side', 'judged again on the 744 by 300 measured before, not the 744 by 200 the room left: ' + stage.taken.join(' then '));
  assert.deepEqual(stage.taken, ['stacked', 'side'], 'the layout turned more than once');
});

// The SV2-32a sweep, through windowLayout: the stand-in stage the size the
// window measured, each layout on the map and none before the arrange.
test('SV2-32j: across 300 to 1400 by 100 to 500 with feet of 0, 12, 40 and 100 px, arrange()\'s path never takes a layout drawn off the stage where it or the other can be whole, nor under the foot where the other is whole above it and larger, or as large with none on the map', () => {
  const floors = sampleSchool().building.floors;
  const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
  const wrong = [];
  let freshTies = 0;
  let turns = 0;
  for (const foot of FEET) {
    const box = foot % 24 === 0 ? MOUSE : FINGER;
    for (let width = 300; width <= 1400; width += 7) {
      for (let height = 100; height <= 500; height += 3) {
        if (foot >= height) continue;
        const pictures = { side: drawn(both.side, width, height, foot, box), stacked: drawn(both.stacked, width, height, foot, box) };
        const plain = { side: drawn(both.side, width, height, 0, null).whole, stacked: drawn(both.stacked, width, height, 0, null).whole };
        for (const onMap of ['side', 'stacked', undefined]) {
          const { how, taken } = arranged(floors, both, onMap, [width, height], foot, box);
          if (taken.length > 2) wrong.push({ width, height, foot, onMap, taken });
          if (taken.length === 2) turns += 1;
          const got = pictures[how];
          const other = pictures[otherOf(how)];
          const tie = other.place.zoom === got.place.zoom;
          if (onMap === undefined && other.whole && got.above && !other.above && tie) freshTies += 1;
          if (!got.whole && plain[how]) wrong.push({ width, height, foot, onMap, how, off: got.off, plainWhole: true });
          else if (!got.whole && other.whole) wrong.push({ width, height, foot, onMap, how, off: got.off });
          else if (got.whole && !got.above && other.above && (other.place.zoom > got.place.zoom || (onMap === undefined && tie))) wrong.push({ width, height, foot, onMap, how, under: true, zoom: [got.place.zoom, other.place.zoom], taken });
        }
      }
    }
  }
  // the sweep meets the tie it judges, and the second judgement turns, or it tests nothing
  assert.ok(freshTies > 100, 'the sweep met only ' + freshTies + ' stages opened fresh at a tie taken above the foot');
  assert.ok(turns > 100, 'the second judgement turned the layout at only ' + turns + ' stages');
  assert.equal(wrong.length, 0, wrong.length + ' stages: ' + JSON.stringify(wrong.slice(0, 5)));
});

// SV2-32a's single-pixel sweeps, through windowLayout: a window dragged a
// pixel at a time, the layout taken at each pixel the one on the map at the next.
for (const [what, sizes] of [
  ['the width swept at 300 px tall', Array.from({ length: 1101 }, (_, n) => [300 + n, 300])],
  ['the width swept at 308 px tall', Array.from({ length: 1101 }, (_, n) => [300 + n, 308])],
  ['the height swept at 744 px wide', Array.from({ length: 501 }, (_, n) => [744, 100 + n])],
  ['the height swept at 798 px wide', Array.from({ length: 501 }, (_, n) => [798, 100 + n])],
]) {
  test('SV2-32j: ' + what + ' through arrange()\'s path, 1 px at a time with feet of 0, 12, 40 and 100 px: never a flip at a single pixel', () => {
    const floors = sampleSchool().building.floors;
    const both = { side: layoutFloors(floors, 'side'), stacked: layoutFloors(floors, 'stacked') };
    let turned = 0;
    for (const foot of FEET) {
      for (const box of [MOUSE, FINGER]) {
        const take = (size, onMap) => arranged(floors, both, onMap, size, foot, box).how;
        const flips = [];
        let current;
        const at = sizes.filter(([, height]) => height > foot);
        for (let n = 0; n < at.length; n += 1) {
          const was = current;
          current = take(at[n], current);
          if (n > 0 && current !== was) turned += 1;
          if (n === 0) continue;
          const back = take(at[n - 1], current);
          const again = take(at[n], back);
          if (back !== current && again !== back) flips.push({ at: at[n], from: current, back, again });
        }
        assert.deepEqual(flips.slice(0, 3), [], 'with a ' + foot + ' px foot and the ' + (box === MOUSE ? 'mouse' : 'finger') + '\'s zoom box the layout flips at a single pixel (' + flips.length + ' places)');
      }
    }
    assert.ok(turned > 0, 'the layout never turned along the sweep: the case tests nothing');
  });
}
