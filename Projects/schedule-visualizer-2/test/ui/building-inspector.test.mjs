// The parts of the building inspector that are plain functions: the action
// that sets a floor's traced image and the arithmetic of where the image is
// drawn (ui/building/trace.js), what the search box finds and the address it
// goes to (ui/building/search.js), and the run of corridor a name goes on
// from one cell (ui/building/menu.js).
//
//   node test/ui/building-inspector.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { setTraceImage, reducedSize, fitPlacement, tracePlacement, MAX_SIDE, DEFAULT_OPACITY } from '../../ui/building/trace.js';
import { searchResults, searchIndex, searchAddress, parseBuildingRest } from '../../ui/building/search.js';
import { corridorRun } from '../../ui/building/menu.js';
import { SIZE_PRESETS } from '../../ui/building/inspector/floor.js';
import { ActionError, BUILDING } from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { validate } from '../../engine/validate.js';
import { RANGES } from '../../engine/schema.js';
import { planProject } from '../fixtures/buildings/plans.mjs';
import { school, emptyProject, ctx, clock, makeIds } from '../engine/helpers.mjs';

const IMAGE = { imageId: 'iabcdefghj', width: 1600, height: 1200 };

function withImage(project) {
  const floor = project.building.floors[0];
  return setTraceImage(project, { floorId: floor.id, image: { ...IMAGE, ...fitPlacement(floor, IMAGE.width, IMAGE.height) } }, ctx());
}

// ---------------------------------------------------------------- the traced image

test('an image larger than the limit is reduced to it, keeping its shape', () => {
  assert.equal(MAX_SIDE, 1600);
  assert.deepEqual(reducedSize(2000, 1500), { width: 1600, height: 1200, reduced: true });
  assert.deepEqual(reducedSize(1500, 3000), { width: 800, height: 1600, reduced: true });
  assert.deepEqual(reducedSize(4000, 3), { width: 1600, height: 1, reduced: true }, 'neither side goes under one pixel');
});

test('an image within the limit keeps its size', () => {
  assert.deepEqual(reducedSize(1600, 1200), { width: 1600, height: 1200, reduced: false });
  assert.deepEqual(reducedSize(640, 480), { width: 640, height: 480, reduced: false });
  assert.deepEqual(reducedSize(900, 500, 300), { width: 300, height: 167, reduced: true }, 'the limit can be given');
});

test('a new image is as large as fits on the floor, in its middle', () => {
  const wide = fitPlacement({ width: 40, height: 30 }, 1600, 600);
  assert.equal(wide.scale, 40 / 1600);
  assert.equal(wide.x, 0);
  assert.equal(wide.y, (30 - 600 * wide.scale) / 2);
  assert.equal(wide.rotation, 0);
  const tall = fitPlacement({ width: 40, height: 30 }, 600, 1200);
  assert.equal(tall.scale, 30 / 1200);
  assert.equal(tall.y, 0);
  assert.equal(tall.x, (40 - 600 * tall.scale) / 2);
});

test('the placement of an image is its box in cells, turned about its middle', () => {
  assert.equal(tracePlacement(null), null);
  const place = tracePlacement({ width: 800, height: 400, scale: 0.05, x: 2, y: 3, rotation: 90, opacity: 0.4 });
  assert.deepEqual(place, { x: 2, y: 3, w: 40, h: 20, cx: 22, cy: 13, rotation: 90, opacity: 0.4 });
});

test('setTraceImage puts an image on a floor with the defaults of the model, and the project stays valid', () => {
  const project = emptyProject();
  const after = withImage(project);
  const image = after.building.floors[0].image;
  assert.deepEqual(image, { imageId: 'iabcdefghj', opacity: DEFAULT_OPACITY, scale: 0.025, rotation: 0, x: 0, y: 0, visible: true, locked: false, width: 1600, height: 1200, missing: false });
  assert.deepEqual(validate(after), []);
  assert.equal(project.building.floors[0].image, null, 'the project it was given is untouched');
  assert.equal(after.subjects, project.subjects, 'what it did not change is the same object');
  assert.deepEqual(setTraceImage.bumps, [BUILDING]);
});

test('setTraceImage adjusts the fields given and leaves the rest', () => {
  const before = withImage(emptyProject());
  const floorId = before.building.floors[0].id;
  const after = setTraceImage(before, { floorId, image: { opacity: 0.7, rotation: -12.5, locked: true } }, ctx());
  const image = after.building.floors[0].image;
  assert.equal(image.opacity, 0.7);
  assert.equal(image.rotation, -12.5);
  assert.equal(image.locked, true);
  assert.equal(image.imageId, IMAGE.imageId);
  assert.equal(image.scale, before.building.floors[0].image.scale);
  assert.deepEqual(validate(after), []);
});

test('setTraceImage with nothing new returns the project it was given', () => {
  const before = withImage(emptyProject());
  const floorId = before.building.floors[0].id;
  assert.equal(setTraceImage(before, { floorId, image: { opacity: DEFAULT_OPACITY, visible: true } }, ctx()), before);
  const none = emptyProject();
  assert.equal(setTraceImage(none, { floorId: none.building.floors[0].id, image: null }, ctx()), none);
});

test('setTraceImage with null takes the image off, and only that floor changes', () => {
  const start = school();
  const [first, second] = start.building.floors;
  const before = setTraceImage(start, { floorId: second.id, image: { ...IMAGE, ...fitPlacement(second, IMAGE.width, IMAGE.height) } }, ctx());
  assert.equal(before.building.floors[0], first, 'another floor is the same object');
  const after = setTraceImage(before, { floorId: second.id, image: null }, ctx());
  assert.equal(after.building.floors[1].image, null);
  assert.equal(after.building.floors[0], first);
  assert.deepEqual(validate(after), []);
});

test('setTraceImage refuses what the model does not allow, in a sentence', () => {
  const before = withImage(emptyProject());
  const floorId = before.building.floors[0].id;
  const refused = (image, pattern) => assert.throws(() => setTraceImage(before, { floorId, image }, ctx()), (error) => error instanceof ActionError && pattern.test(error.message));
  refused({ opacity: 1.5 }, /Opacity/);
  refused({ scale: 0 }, /width above 0/);
  refused({ scale: Infinity }, /width above 0/);
  refused({ rotation: NaN }, /rotation/);
  refused({ x: 'left' }, /x of a traced image/);
  refused({ visible: 'yes' }, /visible/);
  refused({ width: 12.5 }, /whole number of pixels/);
  refused('picture', /null or an object/);
  assert.throws(() => setTraceImage(before, { floorId: 'fnotafloor', image: null }, ctx()), /no longer in the building/);
  const none = emptyProject();
  assert.throws(() => setTraceImage(none, { floorId: none.building.floors[0].id, image: { opacity: 0.5 } }, ctx()), /names its stored image/, 'a floor with no image needs the image named');
});

test('the labels say whether an image was added, adjusted or removed, and undo takes each back', () => {
  const store = createStore({ project: emptyProject(), clock, ids: makeIds(3) });
  const floor = store.project.building.floors[0];
  const building = store.buildingVersion;
  const geometry = store.geometryVersion;
  store.apply(setTraceImage, { floorId: floor.id, image: { ...IMAGE, ...fitPlacement(floor, IMAGE.width, IMAGE.height) } });
  assert.equal(store.undoLabel, 'Trace over an image on Floor 1');
  assert.equal(store.buildingVersion, building + 1);
  assert.equal(store.geometryVersion, geometry, 'an image changes no route');
  store.apply(setTraceImage, { floorId: floor.id, image: { x: 3 } });
  assert.equal(store.undoLabel, 'Adjust the traced image on Floor 1');
  store.apply(setTraceImage, { floorId: floor.id, image: null });
  assert.equal(store.undoLabel, 'Remove the traced image from Floor 1');
  assert.equal(store.history.past.length, 3);
  store.undo();
  assert.equal(store.project.building.floors[0].image.x, 3, 'undo brought the image back where it was');
  store.undo();
  store.undo();
  assert.equal(store.project.building.floors[0].image, null);
});

// ---------------------------------------------------------------- search

test('search finds a room by its number, on whatever floor it is', () => {
  const project = school();
  const found = searchResults(project, '203');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Room 203');
  assert.equal(found[0].floorName, 'Floor 2');
  assert.equal(searchAddress(found[0]), '#building/' + project.building.floors[1].id + '?room=' + found[0].id);
});

test('search finds rooms by teacher, by subject and by wing, without regard to case', () => {
  const project = school();
  const room = project.building.floors[0].spaces.find((space) => space.kind === 'room' && space.teacherIds.length > 0);
  const teacher = project.teachers.find((each) => each.id === room.teacherIds[0]);
  const surname = teacher.name.split(' ').pop();
  assert.ok(searchResults(project, surname.toUpperCase()).some((entry) => entry.id === room.id), 'not found by teacher');
  const subject = project.subjects.find((each) => each.id === room.subjectId);
  assert.ok(searchResults(project, subject.name.toLowerCase()).some((entry) => entry.id === room.id), 'not found by subject name');
  assert.ok(searchResults(project, subject.code.toLowerCase()).some((entry) => entry.id === room.id), 'not found by subject code');
  assert.ok(searchResults(project, room.wing).some((entry) => entry.id === room.id), 'not found by wing');
});

test('search finds an other space by its label, and a room called by a name', () => {
  const project = school();
  const other = project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.kind === 'other' && space.label !== '');
  assert.ok(searchResults(project, other.label.slice(0, 4)).some((entry) => entry.id === other.id));
  assert.equal(searchResults(project, 'gym')[0].name, 'Gym');
});

test('every word typed has to match, an exact number comes first, and nothing typed finds nothing', () => {
  const project = school();
  assert.deepEqual(searchResults(project, '   '), []);
  assert.deepEqual(searchResults(project, 'zzzz'), []);
  const ones = searchResults(project, '10');
  assert.ok(ones.length > 1);
  assert.ok(ones.every((entry) => entry.words.some((word) => word.includes('10'))));
  assert.equal(searchResults(project, '101')[0].name, 'Room 101');
  const both = searchResults(project, 'floor nothing');
  assert.deepEqual(both, [], 'two words, one of them nowhere');
});

test('what is typed is matched as text, never as a pattern or as markup', () => {
  const project = school();
  const room = project.building.floors[0].spaces.find((space) => space.kind === 'room');
  room.number = 'Lab <b>(1)</b> .*';
  assert.equal(searchResults(project, '<b>(1)')[0].id, room.id);
  assert.equal(searchResults(project, '.*')[0].id, room.id);
  assert.equal(searchIndex(project).find((entry) => entry.id === room.id).name, 'Lab <b>(1)</b> .*');
});

test('the address of a room is read back as a floor and a room', () => {
  assert.deepEqual(parseBuildingRest('fabc?room=rxyz'), { floorId: 'fabc', roomId: 'rxyz' });
  assert.deepEqual(parseBuildingRest('fabc'), { floorId: 'fabc', roomId: null });
  assert.deepEqual(parseBuildingRest(''), { floorId: '', roomId: null });
  assert.deepEqual(parseBuildingRest(undefined), { floorId: '', roomId: null });
  assert.deepEqual(parseBuildingRest('fabc?x=1&room=r%20q'), { floorId: 'fabc', roomId: 'r q' });
});

// ---------------------------------------------------------------- a corridor's run, and the sizes offered

test('the run of corridor through a cell is the longer straight way through it', () => {
  const project = planProject([[
    '.......',
    '.#####.',
    '...#...',
    '...#...',
    '.......',
  ]]);
  const floor = project.building.floors[0];
  const at = (x, y) => y * floor.width + x;
  assert.deepEqual(corridorRun(floor, at(1, 1)), [at(1, 1), at(2, 1), at(3, 1), at(4, 1), at(5, 1)]);
  assert.deepEqual(corridorRun(floor, at(3, 3)), [at(3, 1), at(3, 2), at(3, 3)]);
  assert.deepEqual(corridorRun(floor, at(3, 1)), [at(1, 1), at(2, 1), at(3, 1), at(4, 1), at(5, 1)], 'at the crossing the longer way wins');
});

test('the sizes offered are small, medium and large, all inside the range a floor may be', () => {
  assert.deepEqual(SIZE_PRESETS.map((preset) => preset.id), ['small', 'medium', 'large']);
  for (const preset of SIZE_PRESETS) {
    for (const side of [preset.width, preset.height]) assert.ok(side >= RANGES.floorSize[0] && side <= RANGES.floorSize[1]);
  }
});
