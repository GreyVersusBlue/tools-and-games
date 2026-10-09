// The timing fixture: an invented school at the size the tool promises to
// stay responsive at. 4 floors of 60 by 40 cells, 150 rooms, 150 teachers,
// 80 groups, 10 periods, and two day types that are each their own copy.
// The timing suites for routing, the crowd model and the checks all use it.
//
//   bigProject({ seed })   a valid project; the same seed gives the same
//                          project on every machine. seed is a number or a
//                          string and defaults to 1.
//   BIG                    the sizes above, for a test to assert against
//
// Nothing here reads the clock or the machine's randomness: every choice
// comes from seededRandom(seed), and the dates are pinned.
//
// Each floor has three corridors running west to east (rows 9, 19 and 29)
// joined by three running north to south (columns 2, 29 and 57), and four
// stairs cells just outside the corners of that grid. Rooms are 4 by 3 cells
// in bands above and below each west-to-east corridor: 72 places a floor, of
// which the seed picks which hold a room, which an other space, and which
// stay empty. About a third of the rooms have one door drawn, a few have
// two, and the rest are entered from any side that touches a corridor. Every
// stairs cell is joined to the one above it, so there are 12 connections.
// Floor 1 has two exits. The west-to-east corridors are named.

import { createIds, seededRandom } from '../../engine/ids.js';
import { newProject, newFloor, newRoom, newOtherSpace, newDayType, emptySlot, GROUP_COLOUR_PRESETS, OTHER_KINDS } from '../../engine/schema.js';

export const BIG = { floors: 4, width: 60, height: 40, rooms: 150, teachers: 150, groups: 80, periods: 10, dayTypes: 2, connections: 12 };

const CORRIDOR_ROWS = [9, 19, 29];
const CORRIDOR_COLUMNS = [2, 29, 57];
const STAIRS = [[1, 9], [58, 9], [1, 29], [58, 29]];
const ROOM_WIDTH = 4;
const ROOM_HEIGHT = 3;
const SLOT_COLUMNS = [4, 8, 12, 16, 20, 24, 31, 35, 39, 43, 47, 51];
const OTHERS_PER_FLOOR = 6;
const CORRIDOR_WORDS = ['North', 'Middle', 'South'];
const FAMILY_STARTS = ['Bram', 'Cord', 'Dell', 'Fen', 'Garr', 'Hal', 'Isk', 'Jor', 'Kes', 'Lun', 'Marr', 'Nev', 'Orr', 'Pell', 'Quin', 'Rost', 'Sarn', 'Tev', 'Ull', 'Vesk'];
const FAMILY_ENDS = ['aby', 'ander', 'ello', 'ingham', 'owick', 'umber', 'wether', 'yard'];
const TITLES = ['Ms.', 'Mr.', 'Dr.', 'Mx.'];

const clock = () => new Date('2026-09-01T12:00:00Z');

function pad(number, width) {
  return String(number).padStart(width, '0');
}

function bellTime(minutes) {
  return pad(Math.floor(minutes / 60), 2) + ':' + pad(minutes % 60, 2);
}

export function bigProject(options) {
  const seed = options && options.seed !== undefined ? options.seed : 1;
  const random = seededRandom(seed);
  const pick = (n) => Math.min(n - 1, Math.floor(random() * n));
  const shuffled = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = pick(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const project = newProject(createIds(seededRandom('big:' + seed)), clock);
  project.settings.schoolName = 'Tarnwick Fixture School';
  project.settings.periods = BIG.periods;

  // the building
  const rooms = [];
  project.building.floors = [];
  for (let f = 0; f < BIG.floors; f += 1) {
    const floor = newFloor('fbig' + pad(f + 1, 6), 'Floor ' + (f + 1), f + 1, BIG.width, BIG.height);
    const cells = floor.cells.split('');
    const at = (x, y) => y * BIG.width + x;
    for (const y of CORRIDOR_ROWS) for (let x = CORRIDOR_COLUMNS[0]; x <= CORRIDOR_COLUMNS[2]; x += 1) cells[at(x, y)] = '#';
    for (const x of CORRIDOR_COLUMNS) for (let y = CORRIDOR_ROWS[0]; y <= CORRIDOR_ROWS[2]; y += 1) cells[at(x, y)] = '#';
    for (const [x, y] of STAIRS) cells[at(x, y)] = 'S';
    floor.cells = cells.join('');

    CORRIDOR_ROWS.forEach((y, index) => {
      const run = [];
      for (let x = CORRIDOR_COLUMNS[0]; x <= CORRIDOR_COLUMNS[2]; x += 1) run.push(at(x, y));
      floor.corridors.push({ id: 'kbig' + (f + 1) + pad(index + 1, 5), name: CORRIDOR_WORDS[index] + ' Corridor ' + (f + 1), cells: run });
    });

    // a place is a 4 by 3 block touching a west-to-east corridor from above or below
    const places = [];
    for (const row of CORRIDOR_ROWS) {
      for (const above of [true, false]) {
        for (const x of SLOT_COLUMNS) places.push({ x, y: above ? row - ROOM_HEIGHT : row + 1, doorY: above ? row - 1 : row + 1, side: above ? 's' : 'n' });
      }
    }
    const order = shuffled(places.map((place, index) => index));
    const roomCount = Math.floor(BIG.rooms / BIG.floors) + (f < BIG.rooms % BIG.floors ? 1 : 0);
    const kinds = new Array(places.length).fill('empty');
    order.forEach((index, n) => {
      kinds[index] = n < roomCount ? 'room' : n < roomCount + OTHERS_PER_FLOOR ? 'other' : 'empty';
    });
    let roomNumber = 0;
    let otherNumber = 0;
    places.forEach((place, index) => {
      if (kinds[index] === 'empty') return;
      const block = [];
      for (let y = place.y; y < place.y + ROOM_HEIGHT; y += 1) for (let x = place.x; x < place.x + ROOM_WIDTH; x += 1) block.push(at(x, y));
      if (kinds[index] === 'other') {
        otherNumber += 1;
        const other = newOtherSpace('obig' + (f + 1) + pad(otherNumber, 5), block);
        other.otherKind = OTHER_KINDS[pick(OTHER_KINDS.length)];
        other.label = 'Store ' + (f + 1) + '-' + otherNumber;
        floor.spaces.push(other);
        return;
      }
      roomNumber += 1;
      const room = newRoom('rbig' + (f + 1) + pad(roomNumber, 5), block);
      room.number = String((f + 1) * 100 + roomNumber);
      room.subjectId = project.subjects[pick(project.subjects.length)].id;
      room.capacity = 28 + pick(8);
      const doors = [0, 0, 0, 1, 1, 2][pick(6)];
      const columns = shuffled([0, 1, 2, 3]).slice(0, doors).sort((a, b) => a - b);
      for (const column of columns) room.doors.push({ cell: at(place.x + column, place.doorY), side: place.side });
      floor.spaces.push(room);
      rooms.push(room);
    });

    if (f === 0) {
      floor.exits.push({ id: 'xbig000001', cell: at(CORRIDOR_COLUMNS[0], CORRIDOR_ROWS[1]), doorName: 'West Door', assembly: 'West field' });
      floor.exits.push({ id: 'xbig000002', cell: at(CORRIDOR_COLUMNS[2], CORRIDOR_ROWS[1]), doorName: 'East Door', assembly: 'East field' });
    }
    project.building.floors.push(floor);
  }
  let letter = 0;
  for (let f = 0; f + 1 < BIG.floors; f += 1) {
    for (const [x, y] of STAIRS) {
      const cell = y * BIG.width + x;
      project.building.connections.push({
        id: 'cbig' + pad(letter + 1, 6),
        label: String.fromCharCode(65 + letter),
        a: { floorId: project.building.floors[f].id, cell },
        b: { floorId: project.building.floors[f + 1].id, cell },
        direction: 'both',
      });
      letter += 1;
    }
  }

  // one teacher to a room; the names are made of invented syllables
  project.teachers = rooms.map((room, index) => {
    const id = 'tbig' + pad(index + 1, 6);
    room.teacherIds = [id];
    const name = TITLES[pick(TITLES.length)] + ' ' + FAMILY_STARTS[pick(FAMILY_STARTS.length)] + FAMILY_ENDS[pick(FAMILY_ENDS.length)] + ' ' + (index + 1);
    return { id, name, subjectId: room.subjectId, roomIds: [room.id], notes: '' };
  });

  // two day types, each its own copy, ten periods of 45 minutes with 4 between
  const bells = (start) => Array.from({ length: BIG.periods }, (unused, p) => ({ start: bellTime(start + p * 49), end: bellTime(start + p * 49 + 45) }));
  const dayA = newDayType('dbig00000a', 'A Day', true, BIG.periods);
  const dayB = newDayType('dbig00000b', 'B Day', true, BIG.periods);
  dayA.bells = bells(8 * 60);
  dayB.bells = bells(8 * 60 + 15);
  project.dayTypes = [dayA, dayB];

  // each group is somewhere every period, with a free period now and then
  project.groups = Array.from({ length: BIG.groups }, (unused, index) => {
    const grade = 6 + (index % 3);
    const day = () => Array.from({ length: BIG.periods }, () => {
      const slot = emptySlot();
      if (pick(25) !== 0) slot.room = rooms[pick(rooms.length)].id;
      return slot;
    });
    return {
      id: 'gbig' + pad(index + 1, 6),
      name: grade + '-' + pad(Math.floor(index / 3) + 1, 2),
      grade: String(grade),
      headCount: pick(5) === 0 ? null : 20 + pick(11),
      colour: GROUP_COLOUR_PRESETS[index % GROUP_COLOUR_PRESETS.length],
      days: { [dayA.id]: day(), [dayB.id]: day() },
    };
  });

  return project;
}
