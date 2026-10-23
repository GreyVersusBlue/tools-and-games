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
import { imagePoint, floorPoint, pixelsApart, cellsFor, cellLengthIn, scaledPlacement, readLength, lengthWords, placeWords, ScaleError, LEAST_PIXELS, MOST_CELLS, LENGTH_UNITS } from '../../ui/building/scale-tool.js';
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
