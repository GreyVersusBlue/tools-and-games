// Small invented buildings for the engine tests, drawn as text so a test can
// be read against its plan. planProject() turns drawings into a valid project.
//
// One string per row of a floor, one character per cell:
//   .        empty
//   #        corridor
//   S        stairs
//   A to Z   a room, except S; every cell with the same letter is one room
//   a to z   an other space, the same way
//
// A room drawn as "A" on the first floor has the id rplan1a000 and the number
// "1A"; on the second floor rplan2a000 and "2A". Floors are fplan00001,
// fplan00002 and so on, named "Floor 1", "Floor 2", with levels 1, 2.
// Rows shorter than the widest are padded with empty cells, and a floor is
// never smaller than 5 by 5.
//
// options:
//   doors        { '1A': [[x, y, side], …] }  by room number
//   connections  [[floorNumber, x, y, floorNumber, x, y], …]  lettered A, B, …
//   exits        [[floorNumber, x, y, doorName], …]
//   numbers      { '1A': '204' }  to give a room another number ('' for none)

import { createIds, seededRandom } from '../../../engine/ids.js';
import { newProject, newFloor, newRoom, newOtherSpace } from '../../../engine/schema.js';

const clock = () => new Date('2026-09-01T12:00:00Z');

export function floorId(number) {
  return 'fplan' + String(number).padStart(5, '0');
}

export function roomId(number) {
  return 'rplan' + number.toLowerCase().padEnd(5, '0');
}

export function planProject(drawings, options) {
  const opts = options || {};
  const project = newProject(createIds(seededRandom('plans')), clock);
  project.building.floors = drawings.map((rows, f) => {
    const width = Math.max(5, ...rows.map((row) => row.length));
    const height = Math.max(5, rows.length);
    const floor = newFloor(floorId(f + 1), 'Floor ' + (f + 1), f + 1, width, height);
    const characters = floor.cells.split('');
    const spaces = new Map();
    rows.forEach((row, y) => {
      Array.from(row).forEach((character, x) => {
        const cell = y * width + x;
        if (character === '#' || character === 'S') characters[cell] = character;
        else if (/[A-Za-z]/.test(character)) {
          if (!spaces.has(character)) spaces.set(character, []);
          spaces.get(character).push(cell);
        }
      });
    });
    floor.cells = characters.join('');
    for (const [letter, cells] of Array.from(spaces).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (letter === letter.toUpperCase()) {
        const number = (f + 1) + letter;
        const room = newRoom(roomId(number), cells);
        room.number = opts.numbers && opts.numbers[number] !== undefined ? opts.numbers[number] : number;
        for (const [x, y, side] of (opts.doors && opts.doors[number]) || []) room.doors.push({ cell: y * width + x, side });
        floor.spaces.push(room);
      } else {
        const other = newOtherSpace('oplan' + (f + 1) + letter + '000', cells);
        other.label = 'Space ' + letter;
        floor.spaces.push(other);
      }
    }
    return floor;
  });
  const at = (number, x, y) => {
    const floor = project.building.floors[number - 1];
    return { floorId: floor.id, cell: y * floor.width + x };
  };
  (opts.connections || []).forEach(([fa, xa, ya, fb, xb, yb], i) => {
    project.building.connections.push({ id: 'cplan' + String(i + 1).padStart(5, '0'), label: String.fromCharCode(65 + i), a: at(fa, xa, ya), b: at(fb, xb, yb), direction: 'both' });
  });
  (opts.exits || []).forEach(([number, x, y, doorName], i) => {
    project.building.floors[number - 1].exits.push({ id: 'xplan' + String(i + 1).padStart(5, '0'), cell: at(number, x, y).cell, doorName: doorName || '', assembly: '' });
  });
  return project;
}

// The cell at column x, row y of a floor of the project (floors count from 1).
export function cellAt(project, number, x, y) {
  return y * project.building.floors[number - 1].width + x;
}

// Two rooms across a corridor. Room 1A has two doors, onto the corridor from
// its south side; room 1B has none drawn and touches the corridor along its
// whole north side. An exit at the east end.
export function twoRooms() {
  return planProject([[
    '.AAAA....',
    '.AAAA....',
    '#########',
    '.BBB.....',
    '.BBB.....',
  ]], { doors: { '1A': [[1, 1, 's'], [4, 1, 's']] }, exits: [[1, 8, 2, 'East Door']] });
}

// One floor in two halves that do not meet: a west corridor with two rooms
// and the exit, and an east wing with two rooms and no way across.
export function disconnectedWing() {
  return planProject([[
    '.AA.BB...CC.DD.',
    '.AA.BB...CC.DD.',
    '######...######',
    '...............',
    '...............',
  ]], { exits: [[1, 0, 2, 'West Door']] });
}

// Three floors with a stairwell drawn once per floor at the same place and
// connected as a chain: A joins floors 1 and 2, B joins floors 2 and 3.
export function threeFloors() {
  const floor = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];
  return planProject([floor, floor, floor], { connections: [[1, 0, 2, 2, 0, 2], [2, 0, 2, 3, 0, 2]], exits: [[1, 6, 2, 'Main Door']] });
}

// Two floors drawn and nothing joining them: each has stairs, not connected.
export function unjoinedFloors() {
  const floor = ['.AA.BB.', '.AA.BB.', 'S######', '.......', '.......'];
  return planProject([floor, floor], { exits: [[1, 6, 2, 'Main Door']] });
}

// A split-level floor: two corridors that do not touch, joined by a
// connection between two stairs on the same floor.
export function splitLevel() {
  return planProject([[
    '.AA....BB.',
    '.AA....BB.',
    '###S..S###',
    '..........',
    '..........',
  ]], { connections: [[1, 3, 2, 1, 6, 2]], exits: [[1, 0, 2, 'Low Door']] });
}
