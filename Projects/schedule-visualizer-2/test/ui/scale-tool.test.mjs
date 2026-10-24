// The arithmetic of scaling a traced image from a length (SV2-73a), in plain
// Node: node test/ui/scale-tool.test.mjs
//
// Two points on the image and a length in feet, metres or cells give the
// image a new scale and corner with the first point kept where it was on the
// floor, a turned image included; the Cell scale converts feet and metres;
// what cannot be a length is refused in a sentence; and the setting travels
// through a saved project, while an older one with no setting reads unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagePoint, floorPoint, pixelsApart, cellsFor, cellLengthIn, scaledPlacement, readLength, lengthWords, placeWords, ScaleError, LEAST_PIXELS, MOST_CELLS, LENGTH_UNITS, pointsPlacement, plainDegrees, LEAST_CELLS } from '../../ui/building/scale-tool.js';
import { fitPlacement, cornersOf, cornerPlacement, steppedPlacement, tracePlacement, STEP, handleUnder, SMALL_REACHES } from '../../ui/building/trace.js';
import * as actions from '../../engine/actions.js';
import { writeProjectFile, readProjectFile } from '../../engine/project-file.js';
import { validate } from '../../engine/validate.js';
import { METRES_PER_FOOT } from '../../engine/schema.js';
import { emptyProject, school, ctx } from '../engine/helpers.mjs';

const FORMATS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'formats');
const near = (a, b, what, within = 1e-9) => assert.ok(Math.abs(a - b) <= within, what + ': ' + a + ' is not ' + b);

// 1600 by 1200 pixels drawn 16 cells wide (0.01 cells a pixel), its corner at 3, 2
const IMAGE = { imageId: 'iscale0001', width: 1600, height: 1200, scale: 0.01, x: 3, y: 2, rotation: 0, opacity: 0.4, visible: true, locked: false, missing: false };

// The length of a line between two image places once the image is `image`, in cells.
function cellsBetween(image, a, b) {
  const p = floorPoint(image, a);
  const q = floorPoint(image, b);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

test('a place on the floor and a place on the image are one place, both ways, turned or not', () => {
  for (const rotation of [0, 30, 90, -135, 400]) {
    const image = { ...IMAGE, rotation };
    for (const at of [{ x: 3, y: 2 }, { x: 11, y: 8 }, { x: -4.25, y: 30.5 }]) {
      const back = floorPoint(image, imagePoint(image, at));
      near(back.x, at.x, 'x at ' + rotation + '°');
      near(back.y, at.y, 'y at ' + rotation + '°');
    }
  }
  // unturned, the corner is pixel 0, 0 and the far corner the image's size
  assert.deepEqual(imagePoint(IMAGE, { x: 3, y: 2 }), { u: 0, v: 0 });
  const far = imagePoint(IMAGE, { x: 19, y: 14 });
  near(far.u, 1600, 'u');
  near(far.v, 1200, 'v');
  // turned 90° clockwise about its middle (11, 8), the top left corner of the image lies at its top right on the floor
  const turned = floorPoint({ ...IMAGE, rotation: 90 }, { u: 0, v: 0 });
  near(turned.x, 17, 'x');
  near(turned.y, 0, 'y');
});

test('two points and a length in cells: the line is that long after, and the first point has not moved', () => {
  const a = { u: 100, v: 600 };
  const b = { u: 1100, v: 600 };
  assert.equal(cellsBetween(IMAGE, a, b), 10, 'the line is 10 cells before');
  const placed = scaledPlacement(IMAGE, a, b, 25);
  near(placed.scale, 0.025, 'scale: 25 cells over 1000 pixels');
  const after = { ...IMAGE, ...placed };
  near(cellsBetween(after, a, b), 25, 'the line');
  const before = floorPoint(IMAGE, a);
  const kept = floorPoint(after, a);
  near(kept.x, before.x, 'the first point x');
  near(kept.y, before.y, 'the first point y');
  assert.deepEqual(Object.keys(placed).sort(), ['scale', 'x', 'y'], 'only the scale and the corner change');
});

test('feet and metres go through the Cell scale, either way round', () => {
  assert.equal(cellsFor(12, 'cells', null), 12, 'cells need no Cell scale');
  assert.equal(cellsFor(30, 'feet', { unit: 'feet', length: 5 }), 6);
  assert.equal(cellsFor(9, 'metres', { unit: 'metres', length: 1.5 }), 6);
  near(cellsFor(30, 'feet', { unit: 'metres', length: 1.524 }), 6, 'one cell of 1.524 m is 5 ft');
  near(cellsFor(9.144, 'metres', { unit: 'feet', length: 5 }), 6, '9.144 m is 30 ft');
  near(cellLengthIn({ unit: 'feet', length: 5 }, 'metres'), 5 * METRES_PER_FOOT, 'feet to metres');
  near(cellLengthIn({ unit: 'metres', length: 1 }, 'feet'), 1 / 0.3048, 'metres to feet');
  assert.throws(() => cellsFor(30, 'feet', null), (error) => error instanceof ScaleError && error.code === 'no-cell-scale');
  assert.throws(() => cellsFor(30, 'yards', { unit: 'feet', length: 5 }), (error) => error instanceof ScaleError && error.code === 'unit');
  assert.deepEqual(LENGTH_UNITS.map((unit) => unit.value), ['feet', 'metres', 'cells'], 'feet first, as Devon thinks in feet');

  // Devon's case: a wall known to be 60 feet, cells of 5 feet: 12 cells
  const a = { u: 200, v: 300 };
  const b = { u: 200, v: 900 };
  const after = { ...IMAGE, ...scaledPlacement(IMAGE, a, b, cellsFor(60, 'feet', { unit: 'feet', length: 5 })) };
  near(cellsBetween(after, a, b), 12, 'the wall');
  near(after.scale, 0.02, 'scale');
});

// This case measures with the module's own floorPoint, so a turn that both
// floorPoint and scaledPlacement got wrong the same way would pass here: the
// first case pins floorPoint to numbers worked by hand (an image turned 90°
// puts its top left corner at its top right), and that is what catches it.
test('a turned image keeps its turn, its line takes the length, and its first point stays put', () => {
  for (const rotation of [15, 90, 180, -60]) {
    const image = { ...IMAGE, rotation, scale: 0.0137, x: -2.5, y: 7 };
    const a = { u: 1400, v: 150 };
    const b = { u: 300, v: 1000 };
    const placed = scaledPlacement(image, a, b, 19.5);
    const after = { ...image, ...placed };
    near(cellsBetween(after, a, b), 19.5, 'the line at ' + rotation + '°', 1e-9);
    const before = floorPoint(image, a);
    const kept = floorPoint(after, a);
    near(kept.x, before.x, 'first point x at ' + rotation + '°');
    near(kept.y, before.y, 'first point y at ' + rotation + '°');
    assert.equal(after.rotation, rotation);
  }
});

test('two points in one place, a length of nothing, and an image grown past any floor or shrunk under a cell are refused in a sentence', () => {
  const refused = (run, code) => assert.throws(run, (error) => {
    assert.ok(error instanceof ScaleError, 'a ScaleError, not ' + error);
    assert.equal(error.code, code);
    assert.match(error.message, /\.$/);
    return true;
  });
  refused(() => scaledPlacement(IMAGE, { u: 10, v: 10 }, { u: 10.4, v: 10.4 }, 5), 'same-place');
  assert.equal(LEAST_PIXELS, 1);
  assert.doesNotThrow(() => scaledPlacement(IMAGE, { u: 10, v: 10 }, { u: 11, v: 10 }, 0.01));
  refused(() => scaledPlacement(IMAGE, { u: 0, v: 0 }, { u: 100, v: 0 }, 0), 'length');
  refused(() => scaledPlacement(IMAGE, { u: 0, v: 0 }, { u: 100, v: 0 }, Number.NaN), 'length');
  refused(() => scaledPlacement(IMAGE, { u: 0, v: 0 }, { u: 10, v: 0 }, 13), 'too-large');
  assert.equal(MOST_CELLS, 2000);
  assert.match(scaleMessage(() => scaledPlacement(IMAGE, { u: 0, v: 0 }, { u: 10, v: 0 }, 13)), /^That would make the image 2,080 cells across, far larger than any floor can be \(200 cells\)\. Check the length and its unit\.$/);
  refused(() => scaledPlacement(IMAGE, { u: 0, v: 0 }, { u: 1000, v: 0 }, 0.5), 'too-small');
});

function scaleMessage(run) {
  try {
    run();
  } catch (error) {
    return error.message;
  }
  return '';
}

test('a typed length is a number above 0; anything else is refused with what to do', () => {
  assert.equal(readLength('30', 'The line'), 30);
  assert.equal(readLength(' 12.5 ', 'The line'), 12.5);
  assert.equal(readLength('12,5', 'The line'), 12.5, 'a decimal comma');
  assert.equal(readLength('.5', 'One cell'), 0.5);
  const message = (text, what, most) => scaleMessage(() => readLength(text, what, most));
  assert.equal(message('0', 'The line'), 'The line needs a length above 0.');
  assert.equal(message('-3', 'The line'), 'The line cannot be shorter than nothing. Type a length above 0.');
  assert.equal(message('thirty', 'The line'), '"thirty" is not a number. Type how long the line is, like 30.');
  assert.equal(message('30 ft', 'The line'), '"30 ft" is not a number. Type how long the line is, like 30.');
  assert.equal(message('', 'The line'), 'Type how long the line is, like 30.');
  assert.equal(message('  ', 'One cell'), 'Type how long one cell is, like 5.');
  assert.equal(message('1001', 'One cell', 1000), 'One cell can be at most 1000.');
  assert.equal(message('0', 'One cell', 1000), 'One cell needs a length above 0.');
});

test('lengths and places are said to two and one places, with the unit', () => {
  assert.equal(lengthWords(1, 'feet'), '1 foot');
  assert.equal(lengthWords(2.456, 'metres'), '2.46 metres');
  assert.equal(lengthWords(1.001, 'cells'), '1 cell');
  assert.equal(lengthWords(12, 'cells'), '12 cells');
  assert.equal(placeWords({ x: 12.44, y: 7.06 }), '12.4, 7.1');
});

test('scaling is one action: the result is a valid project and the first point is where it was on the floor', () => {
  let project = emptyProject();
  const floorId = project.building.floors[0].id;
  project = actions.setTraceImage(project, { floorId, image: { ...IMAGE, rotation: 30 } }, ctx());
  const image = project.building.floors[0].image;
  const a = imagePoint(image, { x: 5.5, y: 6.5 });
  const b = imagePoint(image, { x: 14.5, y: 6.5 });
  assert.ok(pixelsApart(a, b) > 800);
  const placed = scaledPlacement(image, a, b, cellsFor(45, 'feet', { unit: 'feet', length: 5 }));
  const after = actions.scaleTraceImage(project, { floorId, image: placed, cellScale: { unit: 'feet', length: 5 } }, ctx());
  assert.deepEqual(validate(after), []);
  const kept = floorPoint(after.building.floors[0].image, a);
  near(kept.x, 5.5, 'x', 1e-9);
  near(kept.y, 6.5, 'y', 1e-9);
  near(cellsBetween(after.building.floors[0].image, a, b), 9, 'the line is 45 feet, 9 cells');
  assert.deepEqual(after.settings.cellScale, { unit: 'feet', length: 5 });
});

test('the Cell scale travels through a saved project file, and an older file with no setting reads unchanged', () => {
  const set = actions.setSetting(school(), { key: 'cellScale', value: { unit: 'metres', length: 1.25 } }, ctx());
  const text = writeProjectFile(set);
  assert.match(text, /"cellScale": \{\n\s+"unit": "metres",\n\s+"length": 1\.25\n\s+\}/);
  const read = readProjectFile(text);
  assert.deepEqual(read.project.settings.cellScale, { unit: 'metres', length: 1.25 });
  assert.deepEqual(read.notes, []);
  assert.equal(writeProjectFile(read.project, { images: read.images }), text, 'export, import, export is the same file');

  for (const name of ['project-v1.json', 'project-v0.json']) {
    const older = readProjectFile(readFileSync(path.join(FORMATS, name), 'utf8'));
    assert.equal('cellScale' in older.project.settings, false, name + ' gains no Cell scale');
    assert.deepEqual(older.notes.filter((note) => /cell scale/i.test(note)), [], name + ' says nothing about one');
  }
  const v1 = readFileSync(path.join(FORMATS, 'project-v1.json'), 'utf8');
  const again = readProjectFile(v1);
  assert.equal(writeProjectFile(again.project, { images: again.images }), v1, 'a format 1 file from before the setting writes back byte for byte');

  const cleared = actions.setSetting(set, { key: 'cellScale', value: null }, ctx());
  assert.equal(readProjectFile(writeProjectFile(cleared)).project.settings.cellScale, null, 'not set, kept as null');
});

// ---------------------------------------------------------------- SV2-73b

// Placing by two points, the fits, the corner handles and + and -, in plain
// Node, with the two actions they go through.

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Where an image place lands once the image is placed as `placed`.
const landing = (image, placed, at) => floorPoint({ ...image, ...placed }, at);

function lands(image, placed, at, want, what) {
  const there = landing(image, placed, at);
  near(there.x, want.x, what + ' x', 1e-9);
  near(there.y, want.y, what + ' y', 1e-9);
}

test('two points and two places: each point lands on its place, the image unturned, turned, or turned over the half circle', () => {
  const a1 = { u: 200, v: 300 };
  const a2 = { u: 1400, v: 300 };
  // unturned: a line 1200 pixels long put 24 cells long, from 4, 5 to 28, 5
  const flat = pointsPlacement(IMAGE, a1, a2, { x: 4, y: 5 }, { x: 28, y: 5 });
  near(flat.scale, 0.02, 'scale');
  assert.equal(flat.rotation, 0, 'no turn, and no -0');
  lands(IMAGE, flat, a1, { x: 4, y: 5 }, 'first');
  lands(IMAGE, flat, a2, { x: 28, y: 5 }, 'second');
  // the places straight down from each other: the image turns a quarter clockwise
  const quarter = pointsPlacement(IMAGE, a1, a2, { x: 10, y: 2 }, { x: 10, y: 14 });
  near(quarter.rotation, 90, 'turned 90');
  near(quarter.scale, 0.01, 'scale');
  lands(IMAGE, quarter, a1, { x: 10, y: 2 }, 'first, turned');
  lands(IMAGE, quarter, a2, { x: 10, y: 14 }, 'second, turned');
  // an image already turned 30° and points on a slant: the answer is whole, not added to the old turn
  const turned = { ...IMAGE, rotation: 30 };
  const b1 = { x: 7.25, y: 20.5 };
  const b2 = { x: 2.5, y: 9 };
  const slant = pointsPlacement(turned, { u: 100, v: 1100 }, { u: 900, v: 150 }, b1, b2);
  assert.ok(slant.rotation > -180 && slant.rotation <= 180, 'the turn is said between -180 and 180: ' + slant.rotation);
  lands(turned, slant, { u: 100, v: 1100 }, b1, 'first, slanted');
  lands(turned, slant, { u: 900, v: 150 }, b2, 'second, slanted');
  // left to right on the image, right to left on the floor: half a turn, said as 180
  const back = pointsPlacement(IMAGE, a1, a2, { x: 30, y: 6 }, { x: 6, y: 6 });
  near(back.rotation, 180, 'half a turn');
  lands(IMAGE, back, a1, { x: 30, y: 6 }, 'first, half turned');
});

test('the pairs in either order give the same placement', () => {
  const a1 = { u: 250, v: 900 };
  const a2 = { u: 1300, v: 200 };
  const b1 = { x: 3, y: 18 };
  const b2 = { x: 33.5, y: 4 };
  const one = pointsPlacement(IMAGE, a1, a2, b1, b2);
  const other = pointsPlacement(IMAGE, a2, a1, b2, b1);
  for (const key of ['scale', 'rotation', 'x', 'y']) near(other[key], one[key], key, 1e-9);
});

test('two points too close, on the image or on the floor, and a placement past any floor or under a cell, are refused in a sentence', () => {
  const refused = (run) => {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof ScaleError, 'a ScaleError: ' + error);
      return error.code + ': ' + error.message;
    }
    return 'not refused';
  };
  const a1 = { u: 200, v: 300 };
  assert.equal(refused(() => pointsPlacement(IMAGE, a1, { u: 200.5, v: 300.5 }, { x: 1, y: 1 }, { x: 20, y: 1 })), 'same-place: The two points are in the same place on the image. Place the second point somewhere else on it, as far from the first as you can.');
  assert.equal(refused(() => pointsPlacement(IMAGE, a1, { u: 900, v: 300 }, { x: 1, y: 1 }, { x: 1.1, y: 1.1 })), 'same-cell: The two places on the floor are in the same place. Place the second where the second point belongs, as far from the first as you can.');
  assert.equal(LEAST_CELLS, 0.25);
  // 2 pixels apart put 40 cells apart: 32,000 cells across
  assert.match(refused(() => pointsPlacement(IMAGE, a1, { u: 202, v: 300 }, { x: 1, y: 1 }, { x: 41, y: 1 })), /^too-large: That would make the image 32,000 cells across/);
  // 1600 pixels apart put 0.5 cells apart: the whole image half a cell
  assert.match(refused(() => pointsPlacement(IMAGE, { u: 0, v: 0 }, { u: 1600, v: 0 }, { x: 1, y: 1 }, { x: 1.5, y: 1 })), /^too-small: That would make the whole image less than one cell across/);
});

test('degrees are said above -180 and up to 180', () => {
  assert.equal(plainDegrees(0), 0);
  assert.equal(Object.is(plainDegrees(-360), 0), true, 'no -0');
  assert.equal(plainDegrees(190), -170);
  assert.equal(plainDegrees(-180), 180);
  assert.equal(plainDegrees(540), 180);
  assert.equal(plainDegrees(-725), -5);
});

test('placing by two points is one action: refused while locked, its label, and the round trip through a saved project', () => {
  let project = emptyProject();
  const floorId = project.building.floors[0].id;
  project = actions.setTraceImage(project, { floorId, image: { ...IMAGE, imageId: 'isample001', rotation: 12 } }, ctx());
  const image = project.building.floors[0].image;
  const a1 = { u: 120, v: 80 };
  const a2 = { u: 1450, v: 1010 };
  const b1 = { x: 2, y: 27 };
  const b2 = { x: 37, y: 3 };
  const placed = pointsPlacement(image, a1, a2, b1, b2);
  const after = actions.placeTraceImage(project, { floorId, image: placed, how: 'points' }, ctx());
  assert.deepEqual(validate(after), []);
  lands(image, after.building.floors[0].image, a1, b1, 'first, as kept');
  lands(image, after.building.floors[0].image, a2, b2, 'second, as kept');
  assert.equal(actions.placeTraceImage.label(project, { floorId, how: 'points' }, after), 'Place the traced image by two points on Floor 1');
  assert.deepEqual(actions.placeTraceImage.bumps, ['building']);
  // through a project file and back: the same numbers, so the points land on their places again
  const images = { isample001: { data: PNG, type: 'image/png' } };
  const text = writeProjectFile(after, { images });
  const read = readProjectFile(text);
  assert.deepEqual(read.project.building.floors[0].image, after.building.floors[0].image);
  lands(image, read.project.building.floors[0].image, a2, b2, 'second, read back');
  assert.equal(writeProjectFile(read.project, { images: read.images }), text, 'export, import, export is the same file');

  const locked = actions.setTraceImage(project, { floorId, image: { locked: true } }, ctx());
  assert.throws(() => actions.placeTraceImage(locked, { floorId, image: placed, how: 'points' }, ctx()), (error) => error.code === 'locked' && error.message === 'The image is locked, so it cannot be moved or resized. Untick "Lock the image" on the Floor tab first.');
  assert.throws(() => actions.placeTraceImage(emptyProject(), { floorId: emptyProject().building.floors[0].id, image: placed }, ctx()), (error) => error.code === 'missing');
  assert.throws(() => actions.placeTraceImage(project, { floorId, image: { ...placed, scale: 0 } }, ctx()), (error) => error.code === 'bad-value');
  assert.equal(actions.placeTraceImage.label(project, { floorId, how: 'fit' }, after), 'Fit the traced image to Floor 1');
  assert.equal(actions.placeTraceImage.label(project, { floorId, how: 'corner' }, after), 'Resize the traced image on Floor 1');
});

test('fit the image to the floor: the whole image inside the floor and in its middle, turned as it is', () => {
  const floor = { width: 40, height: 30 };
  for (const rotation of [0, 30, 90, -45, 170]) {
    const placed = fitPlacement(floor, 1600, 1200, rotation);
    assert.equal(placed.rotation, rotation, 'the turn is kept');
    const box = actions.traceImageBox({ ...IMAGE, ...placed });
    assert.ok(box.x0 >= -1e-9 && box.y0 >= -1e-9 && box.x1 <= 40 + 1e-9 && box.y1 <= 30 + 1e-9, rotation + '° inside the floor: ' + JSON.stringify(box));
    // as large as fits: it touches two opposite edges
    assert.ok(Math.abs(box.x1 - box.x0 - 40) < 1e-9 || Math.abs(box.y1 - box.y0 - 30) < 1e-9, rotation + '° touches the floor\'s edges');
    near((box.x0 + box.x1) / 2, 20, rotation + '° centred across');
    near((box.y0 + box.y1) / 2, 15, rotation + '° centred down');
  }
  assert.deepEqual(fitPlacement(floor, 1600, 1200), { scale: 0.025, x: 0, y: 0, rotation: 0 }, 'a new image, unturned');
});

test('the box an image covers, and the floor fitted to it rounded out to whole cells', () => {
  near(actions.traceImageBox(IMAGE).x1, 19, 'right edge unturned');
  const quarter = actions.traceImageBox({ ...IMAGE, rotation: 90 });
  near(quarter.x0, 5, 'turned 90, left');
  near(quarter.y0, 0, 'turned 90, top');
  near(quarter.x1, 17, 'turned 90, right');
  near(quarter.y1, 16, 'turned 90, bottom');
  // 3, 2 to 19, 14 on a 40 by 30 floor: cut 3 at the left, 2 at the top, 21 at the right and 16 at the bottom
  assert.deepEqual(actions.floorForImage({ width: 40, height: 30 }, IMAGE), { left: -3, top: -2, right: -21, bottom: -16, width: 16, height: 12 });
  // 2.5 to 18.5 across and -1.25 to 10.75 down: rounded out, 2 to 19 and -2 to 11
  assert.deepEqual(actions.floorForImage({ width: 40, height: 30 }, { ...IMAGE, x: 2.5, y: -1.25 }), { left: -2, top: 2, right: -21, bottom: -19, width: 17, height: 13 });
  // an edge a hair either side of a whole number is that whole number: no column gained at either edge
  assert.equal(actions.floorForImage({ width: 40, height: 30 }, { ...IMAGE, x: 3 + 1e-12 }).width, 16, 'nudged right');
  assert.equal(actions.floorForImage({ width: 40, height: 30 }, { ...IMAGE, x: 3 - 1e-12 }).width, 16, 'nudged left');
});

test('fit the floor to the image is one action: the drawing and the image stay where they are on each other; refused when it would cut, when locked, or past a floor\'s sizes', () => {
  let project = emptyProject();
  const floorId = project.building.floors[0].id;
  project = actions.setTraceImage(project, { floorId, image: { ...IMAGE, imageId: 'isample001' } }, ctx());
  // a corridor cell at 5, 4, inside the image
  project = actions.paintCorridor(project, { floorId, cells: [4 * 40 + 5] }, ctx());
  const after = actions.fitFloorToImage(project, { floorId }, ctx());
  const floor = after.building.floors[0];
  assert.equal(floor.width, 16);
  assert.equal(floor.height, 12);
  assert.equal(floor.cells[(4 - 2) * 16 + (5 - 3)], '#', 'the corridor cell moved with the edges');
  assert.deepEqual([floor.image.x, floor.image.y], [0, 0], 'the image at the floor\'s corner, over the same cells');
  assert.deepEqual(validate(after), []);
  assert.equal(actions.fitFloorToImage.label(project, { floorId }, after), 'Fit Floor 1 to its traced image, 16 by 12');
  assert.deepEqual(actions.fitFloorToImage.bumps(project, { floorId }, after), ['geometry']);
  assert.equal(actions.fitFloorToImage(after, { floorId }, ctx()), after, 'already fitted: nothing changes');

  // a room at 30, 20 lies outside the image: refused, saying what would go
  const outside = actions.placeRoom(project, { floorId, rect: { x: 30, y: 20, w: 2, h: 2 }, number: '204' }, ctx());
  assert.throws(() => actions.fitFloorToImage(outside, { floorId }, ctx()), (error) => error.code === 'cuts' && error.message === 'Fitting Floor 1 to the image would cut Room 204, outside the image. Move them over the image first, or resize the floor by its edges instead.');
  const locked = actions.setTraceImage(project, { floorId, image: { locked: true } }, ctx());
  assert.throws(() => actions.fitFloorToImage(locked, { floorId }, ctx()), (error) => error.code === 'locked');
  const huge = actions.setTraceImage(project, { floorId, image: { scale: 0.2 } }, ctx());
  assert.throws(() => actions.fitFloorToImage(huge, { floorId }, ctx()), (error) => error.code === 'bad-size' && error.message === 'The image covers 320 by 240 cells, and a floor is from 5 to 200 cells each way, so Floor 1 cannot be fitted to it. Resize the image first.');
  const tiny = actions.setTraceImage(project, { floorId, image: { scale: 0.001 } }, ctx());
  assert.throws(() => actions.fitFloorToImage(tiny, { floorId }, ctx()), (error) => error.code === 'bad-size');
});

test('a corner handle resizes about the opposite corner with the shape kept; with Shift about the middle; a turned image too', () => {
  for (const rotation of [0, 35, -120]) {
    const image = { ...IMAGE, rotation };
    const corners = cornersOf(image);
    for (let corner = 0; corner < 4; corner += 1) {
      const opposite = corners[(corner + 2) % 4];
      // the pointer half as far again from the opposite corner, along the diagonal
      const at = { x: opposite.x + (corners[corner].x - opposite.x) * 1.5, y: opposite.y + (corners[corner].y - opposite.y) * 1.5 };
      const placed = cornerPlacement(image, corner, at, false);
      near(placed.scale, IMAGE.scale * 1.5, rotation + '° corner ' + corner + ' scale');
      const after = cornersOf({ ...image, ...placed });
      near(after[(corner + 2) % 4].x, opposite.x, rotation + '° corner ' + corner + ': the opposite corner stays, x');
      near(after[(corner + 2) % 4].y, opposite.y, rotation + '° corner ' + corner + ': the opposite corner stays, y');
      near(after[corner].x, at.x, rotation + '° corner ' + corner + ' follows the pointer, x');
      near(after[corner].y, at.y, rotation + '° corner ' + corner + ' follows the pointer, y');
    }
    // with Shift, about the middle: the middle stays and the image doubles
    const middle = tracePlacement(image);
    const placed = cornerPlacement(image, 2, { x: middle.cx + (corners[2].x - middle.cx) * 2, y: middle.cy + (corners[2].y - middle.cy) * 2 }, true);
    near(placed.scale, IMAGE.scale * 2, rotation + '° about the middle');
    const moved = tracePlacement({ ...image, ...placed });
    near(moved.cx, middle.cx, rotation + '° the middle stays, x');
    near(moved.cy, middle.cy, rotation + '° the middle stays, y');
  }
  // a pointer off the diagonal: the shape is kept, the corner goes to the nearest place on the diagonal
  const off = cornerPlacement(IMAGE, 2, { x: 19 + 4, y: 14 }, false);
  near(off.scale * 1200 / (off.scale * 1600), 0.75, 'the shape is kept');
  assert.equal(off.x, 3, 'the top left corner stays');
  // dragged past the opposite corner, the image is held at one cell across, never turned over
  const past = cornerPlacement(IMAGE, 2, { x: 0, y: 0 }, false);
  near(past.scale * 1600, 1, 'one cell across');
});

test('+ and - make the image 5 % larger or smaller about its middle', () => {
  assert.equal(STEP, 1.05);
  const larger = steppedPlacement(IMAGE, STEP);
  near(larger.scale, 0.0105, 'larger');
  const middle = tracePlacement(IMAGE);
  const moved = tracePlacement({ ...IMAGE, ...larger });
  near(moved.cx, middle.cx, 'the middle stays, x');
  near(moved.cy, middle.cy, 'the middle stays, y');
  const smaller = steppedPlacement({ ...IMAGE, ...larger }, 1 / STEP);
  near(smaller.scale, 0.01, 'smaller again');
  near(smaller.x, 3, 'back where it was', 1e-9);
  // never under one cell across
  near(steppedPlacement({ ...IMAGE, scale: 1 / 1600 }, 1 / STEP).scale * 1600, 1, 'held at one cell');
});

test('+ never makes an image outside the held range smaller, nor - a sub-cell one larger: the step is held where the image is', () => {
  // a typed width of 5,000 cells, past MOST_CELLS (2,000)
  const huge = { ...IMAGE, scale: 5000 / 1600, x: -100, y: -50 };
  assert.ok(5000 > MOST_CELLS, 'the image is past the held range');
  const plus = steppedPlacement(huge, STEP);
  assert.deepEqual(plus, { scale: huge.scale, x: -100, y: -50 }, '+ on a 5,000-cell image holds it where it is, the place unmoved');
  const minus = steppedPlacement(huge, 1 / STEP);
  assert.ok(minus.scale < huge.scale, '- still makes it smaller: ' + minus.scale * 1600);
  // a quarter of a cell across, under the one cell the range starts at
  const tiny = { ...IMAGE, scale: 0.25 / 1600, x: 4, y: 6 };
  assert.deepEqual(steppedPlacement(tiny, 1 / STEP), { scale: tiny.scale, x: 4, y: 6 }, '- on a quarter-cell image holds it where it is');
  assert.ok(steppedPlacement(tiny, STEP).scale > tiny.scale, '+ still makes it larger');
  // at the edge of the range the step is held too, so the caller says "as large as it can be"
  const most = { ...IMAGE, scale: MOST_CELLS / 1600 };
  near(steppedPlacement(most, STEP).scale, most.scale, 'held at the most');
});

test('a corner handle is caught within reach of a corner; on a small image a press inside it moves it, and a corner is caught from outside', () => {
  // a view of 20 pixels a cell, the floor's corner at 10, 10 on the canvas
  const view = { x: 10, y: 10, size: 20 };
  // IMAGE is 16 by 12 cells at 3, 2: 320 by 240 pixels from 70, 50, its corners at 70,50 / 390,50 / 390,290 / 70,290
  assert.equal(handleUnder(IMAGE, view, 75, 55, 10), 0, 'just inside the top left corner of a large image is the corner');
  assert.equal(handleUnder(IMAGE, view, 384, 284, 22), 2, 'a finger\'s reach inside the bottom right corner');
  assert.equal(handleUnder(IMAGE, view, 230, 170, 22), -1, 'the middle moves it');
  assert.equal(handleUnder(IMAGE, view, 395, 45, 10), 1, 'just outside the top right corner');
  assert.equal(handleUnder(IMAGE, view, 420, 50, 10), -1, 'out of reach');
  // the same image 1.6 by 1.2 cells: 32 by 24 pixels, under three of a finger's 22-pixel reaches
  const small = { ...IMAGE, scale: 0.001, x: 3, y: 2 };
  assert.ok(Math.min(small.width, small.height) * small.scale * view.size < SMALL_REACHES * 22);
  // every place inside it is within 22 pixels of a corner, and none is a corner
  for (const [sx, sy] of [[71, 51], [86, 62], [101, 73], [72, 72]]) assert.equal(handleUnder(small, view, sx, sy, 22), -1, sx + ', ' + sy + ' inside the small image moves it');
  assert.equal(handleUnder(small, view, 64, 44, 22), 0, 'outside its top left corner, the corner');
  assert.equal(handleUnder(small, view, 108, 80, 22), 2, 'outside its bottom right corner, the corner');
  // turned a quarter, the small image is caught by its turned box, not its unturned one
  const turned = { ...small, rotation: 90 };
  const middle = cornersOf(turned).reduce((sum, at) => ({ x: sum.x + at.x / 4, y: sum.y + at.y / 4 }), { x: 0, y: 0 });
  assert.equal(handleUnder(turned, view, view.x + middle.x * 20, view.y + (middle.y + 0.7) * 20, 22), -1, 'inside the turned image, below its middle');
});
