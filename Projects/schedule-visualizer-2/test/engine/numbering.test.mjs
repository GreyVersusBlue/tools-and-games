// Auto-number's engine (SV2-134; ARCHITECTURE 22.5, 22.15): nextRoomNumber and
// firstRoomNumber, with the cases the architecture names: "099", "B-12",
// "1004A", "2.07", numbers already taken skipped, a seed with no digits,
// the limit of 999 steps, and the first number on a floor with and without
// numbered rooms. Plain Node.

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRoomNumber, firstRoomNumber, plainNext, splitNumber, copyNumber, SKIP_MOST } from '../../engine/numbering.js';
import { newFloor, newRoom } from '../../engine/schema.js';
import { school, clone } from './helpers.mjs';

// The sample school's rooms are 101…, 201…, 301…; this adds rooms numbered as
// given to a copy of it, on Floor 1.
function withNumbers(numbers) {
  const project = clone(school());
  const floor = project.building.floors[0];
  const free = [];
  for (let cell = 0; cell < floor.cells.length && free.length < numbers.length; cell += 1) {
    if (floor.cells[cell] === '.' && !floor.spaces.some((space) => space.cells.includes(cell))) free.push(cell);
  }
  numbers.forEach((number, n) => {
    const room = newRoom('rnumber' + String(n).padStart(3, '0'), [free[n]]);
    room.number = number;
    floor.spaces.push(room);
  });
  return project;
}

function bare(level) {
  const project = clone(school());
  project.building.floors = [newFloor('fbare00001', 'Basement', level, 8, 8)];
  project.building.connections = [];
  project.building.zones = [];
  project.groups = [];
  project.teachers = [];
  return project;
}

const empty = clone(school());
empty.building.floors = [newFloor('fempty0001', 'Floor 1', 1, 8, 8)];
empty.building.connections = [];
empty.building.zones = [];

test('splitNumber: the last run of digits, with its prefix and suffix', () => {
  assert.deepEqual(splitNumber('104'), { prefix: '', digits: '104', suffix: '' });
  assert.deepEqual(splitNumber('B-12'), { prefix: 'B-', digits: '12', suffix: '' });
  assert.deepEqual(splitNumber('1004A'), { prefix: '', digits: '1004', suffix: 'A' });
  assert.deepEqual(splitNumber('2.07'), { prefix: '2.', digits: '07', suffix: '' });
  assert.deepEqual(splitNumber('  104  '), { prefix: '', digits: '104', suffix: '' }, 'spaces round it do not count');
  assert.equal(splitNumber('Gym'), null);
  assert.equal(splitNumber(''), null);
  assert.equal(splitNumber(7), null);
});

test('nextRoomNumber: digits plus one at the same width or wider', () => {
  assert.equal(nextRoomNumber(empty, '104'), '105');
  assert.equal(nextRoomNumber(empty, '099'), '100', '"099" becomes "100"');
  assert.equal(nextRoomNumber(empty, '9'), '10', '"9" becomes "10"');
  assert.equal(nextRoomNumber(empty, '007'), '008', 'the width is kept');
  assert.equal(nextRoomNumber(empty, '999'), '1000');
});

test('nextRoomNumber: the prefix and the suffix stay', () => {
  assert.equal(nextRoomNumber(empty, 'B-12'), 'B-13');
  assert.equal(nextRoomNumber(empty, '1004A'), '1005A');
  assert.equal(nextRoomNumber(empty, '2.07'), '2.08', 'only the last run of digits moves');
  assert.equal(nextRoomNumber(empty, 'B-99'), 'B-100');
});

test('nextRoomNumber: a seed with no digits has no next', () => {
  assert.equal(nextRoomNumber(empty, 'Gym'), null);
  assert.equal(nextRoomNumber(empty, ''), null);
  assert.equal(nextRoomNumber(empty, '   '), null);
});

test('nextRoomNumber: numbers already in the building are skipped, whatever the floor, the case or the spaces', () => {
  // the sample has 101 to 10x, 201… and 301…; 106 is checked first
  const project = withNumbers(['X-5', 'x-6', ' X-7 ', 'X-9']);
  assert.equal(nextRoomNumber(project, 'X-4'), 'X-8', 'X-5, x-6 and " X-7 " are one number each, and taken');
  assert.equal(nextRoomNumber(project, 'X-8'), 'X-10', 'X-9 is taken too');
  const second = withNumbers(['A1', 'A2']);
  second.building.floors.push(Object.assign(newFloor('fother0001', 'Floor 9', 9, 8, 8), { spaces: [Object.assign(newRoom('rother0001', [0]), { number: 'A3' })] }));
  assert.equal(nextRoomNumber(second, 'A0'), 'A4', 'a number on another floor is taken as well');
});

test('nextRoomNumber: the seed itself may be taken (it is the room just drawn)', () => {
  const project = withNumbers(['Z-1']);
  assert.equal(nextRoomNumber(project, 'Z-1'), 'Z-2');
});

test('nextRoomNumber: gives up after ' + SKIP_MOST + ' steps over taken numbers', () => {
  const taken = [];
  for (let n = 1; n <= SKIP_MOST; n += 1) taken.push('N' + n);
  const project = clone(school());
  const floor = project.building.floors[0];
  floor.width = 40;
  floor.height = 40;
  floor.cells = '.'.repeat(1600);
  floor.spaces = taken.map((number, n) => Object.assign(newRoom('rbulk' + String(n).padStart(5, '0'), [n]), { number }));
  floor.corridors = [];
  floor.exits = [];
  project.building.connections = [];
  project.building.floors = [floor];
  project.building.zones = [];
  assert.equal(nextRoomNumber(project, 'N0'), null, 'N1 to N999 are all taken, so there is no number to give');
  assert.equal(nextRoomNumber(project, 'N1'), 'N1000', 'one step past the run is free');
});

test('plainNext is the next number with no regard to the building', () => {
  assert.equal(plainNext('105'), '106');
  assert.equal(plainNext('B-12'), 'B-13');
  assert.equal(plainNext('Gym'), null);
});

test('firstRoomNumber: one past the highest number on the floor, by the digits as numbers', () => {
  const project = bare(1);
  const floor = project.building.floors[0];
  for (const [n, number] of ['101', '99', '108'].entries()) floor.spaces.push(Object.assign(newRoom('rhigh' + String(n).padStart(5, '0'), [n]), { number }));
  assert.equal(firstRoomNumber(project, floor.id), '109', '108 is the highest, and 99 is not higher than 101 as text would have it');
});

test('firstRoomNumber: the highest by digits, whatever its prefix', () => {
  const project = bare(2);
  const floor = project.building.floors[0];
  for (const [n, number] of ['A-3', 'B-12', '7'].entries()) floor.spaces.push(Object.assign(newRoom('rfirst' + String(n).padStart(4, '0'), [n]), { number }));
  assert.equal(firstRoomNumber(project, floor.id), 'B-13');
});

test('firstRoomNumber: with none numbered, the level times 100 plus 1', () => {
  assert.equal(firstRoomNumber(bare(3), 'fbare00001'), '301');
  assert.equal(firstRoomNumber(bare(1), 'fbare00001'), '101');
  assert.equal(firstRoomNumber(bare(12), 'fbare00001'), '1201');
});

test('firstRoomNumber: level 0 and below start at 1', () => {
  assert.equal(firstRoomNumber(bare(0), 'fbare00001'), '1');
  assert.equal(firstRoomNumber(bare(-1), 'fbare00001'), '1');
});

test('firstRoomNumber: skips numbers in use on other floors, and a floor that is not there has none', () => {
  const project = bare(3);
  const floor = project.building.floors[0];
  project.building.floors.push(Object.assign(newFloor('fother0002', 'Floor 4', 4, 8, 8), { spaces: [Object.assign(newRoom('rtaken0001', [0]), { number: '301' }), Object.assign(newRoom('rtaken0002', [1]), { number: '302' })] }));
  assert.equal(firstRoomNumber(project, floor.id), '303', '301 and 302 belong to rooms on another floor');
  assert.equal(firstRoomNumber(project, 'fnothere01'), null);
});

test('firstRoomNumber: a floor of rooms with no digits starts from the level', () => {
  const project = bare(2);
  const floor = project.building.floors[0];
  floor.spaces.push(Object.assign(newRoom('rgym0000001', [0]), { number: 'Gym' }));
  assert.equal(firstRoomNumber(project, floor.id), '201');
});

// A duplicated floor's room that cannot take the new level (ARCHITECTURE 22.17;
// Devon 2026-11-21, SV2-141): its own number with a count after it.
test('copyNumber: "Library" is "Library 2", "Library 3" when that is taken in any case, and the one given is kept as used', () => {
  const used = new Set(['library']);
  assert.equal(copyNumber('Library', used), 'Library 2');
  assert.ok(used.has('library 2'), 'added to the used set');
  assert.equal(copyNumber('  Library ', used), 'Library 3', 'trimmed, and the next count once 2 is taken');
  assert.equal(copyNumber('Library', new Set(['LIBRARY 2'.toLowerCase()])), 'Library 3');
  assert.equal(copyNumber('B-201', new Set()), 'B-201 2', 'the form as typed, a space and the count');
  assert.equal(copyNumber('Library 2', new Set()), 'Library 3', 'a copy\'s copy goes on counting');
  assert.equal(copyNumber('201', new Set()), '201 2', 'digits with no space before them are the number, not a count');
});
