// The sample school: Marrowby Middle School. Everything here is invented:
// the school, the building, every teacher and every group. It exists so that
// every part of the tool can be explored in the first minute, and so the tests
// have one complete project to run against.
//
// The building has three floors of 40 by 14 cells, each with one corridor
// along the middle. Stairs A join Floor 1 and Floor 2 near the west end;
// stairs B join Floor 2 and Floor 3 near the east end. So a walk between
// Floor 1 and Floor 3 crosses most of Floor 2. There are two exits on
// Floor 1: Door A at the end of the Front Hall, Door B at the east end of the
// Main Corridor. Thirteen rooms: ten classrooms, and the Gym, the Cafeteria
// and the Library, which are shared spaces. Twelve teachers, eight groups,
// an A Day and a B Day that is its own copy, each with bell times and four
// minutes of passing time.
//
// There are exactly two deliberate problems, both on A Days, for a new user
// to find. SAMPLE_PROBLEMS below names them for the tests and the help.
//
// 1. A room double-booking. Groups 6C and 7C are both in Room 203 in
//    Period 2. Room 203 is not a shared space.
// 2. A walk that is too long. Group 8A goes from the Gym in Period 6 to
//    Room 303 in Period 7: along Floor 1 to stairs A, across Floor 2 to
//    stairs B, then the length of Floor 3 to the Music Wing. That is 81 cells
//    and two stair connections, about 259 seconds of plain walking at the
//    default speeds, against 240 seconds of passing time.
//
// Every other transition on both day types is 180 seconds of plain walking
// or less, no teacher is in two rooms at once, no teacher teaches more than
// four periods in a row, and every teacher has a planning period.
// test/engine/sample-school.test.mjs checks each of those claims.
//
// sampleSchool() returns a fresh project every call. It is plain data in the
// shape FORMATS.md describes, with fixed ids and fixed dates, so it is the
// same on every machine.

const WIDTH = 40;
const HEIGHT = 14;
const CORRIDOR_ROW = 7;
const SAMPLE_DATE = '2026-09-01T12:00:00.000Z';

export const SAMPLE_PROJECT_ID = 'psample001';
export const SAMPLE_SCHOOL_NAME = 'Marrowby Middle School (sample)';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';

export const SAMPLE_PROBLEMS = {
  roomDouble: { dayTypeId: DAY_A, period: 1, roomId: 'rsample203', groupIds: ['gsample06c', 'gsample07c'] },
  longWalk: { dayTypeId: DAY_A, groupId: 'gsample08a', fromPeriod: 5, toPeriod: 6, fromRoomId: 'rsamplegym', toRoomId: 'rsample303' },
};

const SUBJECTS = [
  { id: 'ssample001', code: 'MATH', name: 'Mathematics', colour: '#2a6f97' },
  { id: 'ssample002', code: 'ENG', name: 'English', colour: '#b5524a' },
  { id: 'ssample003', code: 'SCI', name: 'Science', colour: '#3f8f5b' },
  { id: 'ssample004', code: 'SOC', name: 'Social Studies', colour: '#b7791f' },
  { id: 'ssample005', code: 'LANG', name: 'World Languages', colour: '#7a5aa6' },
  { id: 'ssample006', code: 'ART', name: 'Art', colour: '#c0568f' },
  { id: 'ssample007', code: 'MUS', name: 'Music', colour: '#2f8f9d' },
  { id: 'ssample008', code: 'PE', name: 'Physical Education', colour: '#5b6f2a' },
  { id: 'ssample009', code: 'LIB', name: 'Library', colour: '#5a6b7b' },
];

// name, subject code, the number of the room the teacher is based in
const TEACHERS = [
  ['tsample001', 'Ms. Halloran', 'MATH', '101'],
  ['tsample002', 'Mr. Brightwater', 'MATH', '102'],
  ['tsample003', 'Dr. Quillfeather', 'SCI', '103'],
  ['tsample004', 'Coach Dunmore', 'PE', 'Gym'],
  ['tsample005', 'Ms. Oyelaran', 'ENG', '201'],
  ['tsample006', 'Mr. Castellanos', 'ENG', '202'],
  ['tsample007', 'Ms. Vandermeer', 'SOC', '203'],
  ['tsample008', 'Mme. Dufrêne', 'LANG', '204'],
  ['tsample009', 'Mr. Pennywhistle', 'LIB', 'Library'],
  ['tsample010', 'Ms. Thistlewood', 'SCI', '301'],
  ['tsample011', 'Mr. Larkspur', 'ART', '302'],
  ['tsample012', 'Ms. O\'Fennimore', 'MUS', '303'],
];

// Rooms: x, y, width and height in cells, and the door as the x of the room
// cell that opens onto the corridor. Rooms above the corridor open south,
// rooms below it open north.
const FLOORS = [
  {
    id: 'fsample001',
    name: 'Floor 1',
    level: 1,
    corridor: [[1, CORRIDOR_ROW, 39, 1], [20, 8, 1, 6]],
    stairs: [[12, 8]],
    rooms: [
      { id: 'rsample101', number: '101', x: 1, y: 3, w: 5, h: 4, doors: [3], subject: 'MATH', capacity: 30, wing: 'West' },
      { id: 'rsample102', number: '102', x: 7, y: 3, w: 5, h: 4, doors: [9], subject: 'MATH', capacity: 30, wing: 'West' },
      { id: 'rsample103', number: '103', x: 13, y: 3, w: 5, h: 4, doors: [15], subject: 'SCI', capacity: 30, wing: 'West' },
      { id: 'rsamplecaf', number: 'Cafeteria', x: 19, y: 2, w: 9, h: 5, doors: [21, 25], subject: null, capacity: 150, shared: true, wing: '' },
      { id: 'rsamplegym', number: 'Gym', x: 30, y: 1, w: 9, h: 6, doors: [36], subject: 'PE', capacity: 120, shared: true, wing: 'East' },
    ],
    others: [
      { id: 'osample001', label: 'Office', otherKind: 'office', x: 1, y: 8, w: 6, h: 4, colour: '#b9a58c' },
      { id: 'osample002', label: 'Bathrooms', otherKind: 'bathroom', x: 14, y: 8, w: 4, h: 3, colour: '#9aa3ad' },
      { id: 'osample003', label: 'Kitchen', otherKind: 'utility', x: 22, y: 8, w: 6, h: 3, colour: '#a9a9a0' },
      { id: 'osample004', label: 'Courtyard', otherKind: 'outdoor', x: 30, y: 9, w: 9, h: 4, colour: '#a8c29a' },
    ],
    names: [
      { id: 'ksample001', name: 'Main Corridor', rect: [1, CORRIDOR_ROW, 39, 1] },
      { id: 'ksample002', name: 'Front Hall', rect: [20, 8, 1, 6] },
    ],
    exits: [
      { id: 'xsample00a', x: 20, y: 13, doorName: 'Door A', assembly: 'Front lawn by the flagpole' },
      { id: 'xsample00b', x: 39, y: CORRIDOR_ROW, doorName: 'Door B', assembly: 'East field by the backstop' },
    ],
  },
  {
    id: 'fsample002',
    name: 'Floor 2',
    level: 2,
    corridor: [[1, CORRIDOR_ROW, 38, 1]],
    stairs: [[12, 8], [33, 8]],
    rooms: [
      { id: 'rsample201', number: '201', x: 1, y: 3, w: 6, h: 4, doors: [3], subject: 'ENG', capacity: 30, wing: 'West' },
      { id: 'rsample202', number: '202', x: 8, y: 3, w: 6, h: 4, doors: [10], subject: 'ENG', capacity: 30, wing: 'West' },
      { id: 'rsample203', number: '203', x: 15, y: 3, w: 6, h: 4, doors: [17], subject: 'SOC', capacity: 30, wing: '' },
      { id: 'rsample204', number: '204', x: 22, y: 3, w: 6, h: 4, doors: [24], subject: 'LANG', capacity: 30, wing: 'East' },
      { id: 'rsamplelib', number: 'Library', x: 29, y: 2, w: 10, h: 5, doors: [31], subject: 'LIB', capacity: 60, shared: true, wing: 'East' },
    ],
    others: [
      { id: 'osample005', label: 'Bathrooms', otherKind: 'bathroom', x: 14, y: 8, w: 4, h: 3, colour: '#9aa3ad' },
      { id: 'osample006', label: 'Staff Room', otherKind: 'office', x: 19, y: 8, w: 7, h: 4, colour: '#b9a58c' },
      { id: 'osample007', label: 'Book Store', otherKind: 'storage', x: 27, y: 8, w: 4, h: 3, colour: '#a9a9a0' },
    ],
    names: [{ id: 'ksample003', name: 'Upper Corridor', rect: [1, CORRIDOR_ROW, 38, 1] }],
    exits: [],
  },
  {
    id: 'fsample003',
    name: 'Floor 3',
    level: 3,
    corridor: [[1, CORRIDOR_ROW, 38, 1]],
    stairs: [[33, 8]],
    rooms: [
      { id: 'rsample303', number: '303', x: 1, y: 2, w: 7, h: 5, doors: [4], subject: 'MUS', capacity: 40, wing: 'Music Wing' },
      { id: 'rsample302', number: '302', x: 18, y: 3, w: 7, h: 4, doors: [21], subject: 'ART', capacity: 30, wing: 'East' },
      { id: 'rsample301', number: '301', x: 26, y: 3, w: 6, h: 4, doors: [29], subject: 'SCI', capacity: 30, wing: 'East' },
    ],
    others: [
      { id: 'osample008', label: 'Instrument Store', otherKind: 'storage', x: 9, y: 3, w: 4, h: 4, colour: '#a9a9a0' },
      { id: 'osample009', label: 'Bathrooms', otherKind: 'bathroom', x: 14, y: 8, w: 4, h: 3, colour: '#9aa3ad' },
      { id: 'osample010', label: 'Plant Room', otherKind: 'utility', x: 35, y: 3, w: 4, h: 4, colour: '#8f979f' },
    ],
    names: [
      { id: 'ksample004', name: 'Music Wing', rect: [1, CORRIDOR_ROW, 16, 1] },
      { id: 'ksample005', name: 'Top Corridor', rect: [17, CORRIDOR_ROW, 22, 1] },
    ],
    exits: [],
  },
];

const CONNECTIONS = [
  { id: 'csample00a', label: 'A', a: ['fsample001', 12, 8], b: ['fsample002', 12, 8] },
  { id: 'csample00b', label: 'B', a: ['fsample002', 33, 8], b: ['fsample003', 33, 8] },
];

const BELLS_A = [['08:00', '08:48'], ['08:52', '09:40'], ['09:44', '10:32'], ['10:36', '11:24'], ['11:28', '12:16'], ['12:20', '13:08'], ['13:12', '14:00'], ['14:04', '14:52']];
// B Days start twenty minutes later, after a school-wide advisory.
const BELLS_B = [['08:20', '09:08'], ['09:12', '10:00'], ['10:04', '10:52'], ['10:56', '11:44'], ['11:48', '12:36'], ['12:40', '13:28'], ['13:32', '14:20'], ['14:24', '15:12']];

// name, grade, head count (null uses the school default), colour, then the
// room for each of the eight periods on A Days and on B Days.
const GROUPS = [
  ['gsample06a', '6A', '6', 24, '#d1495b',
    ['201', '103', '101', 'Cafeteria', '302', '303', '204', '203'],
    ['201', '204', 'Gym', 'Cafeteria', '102', 'Library', '301', '303']],
  ['gsample06b', '6B', '6', 26, '#0072b2',
    ['203', 'Gym', '103', 'Cafeteria', '204', '202', '102', 'Library'],
    ['103', '102', 'Library', 'Cafeteria', '201', '302', '303', '203']],
  ['gsample06c', '6C', '6', 23, '#e69f00',
    ['301', '203', '302', 'Cafeteria', 'Gym', '204', 'Library', '202'],
    ['102', 'Gym', '202', 'Cafeteria', 'Library', '303', '203', '103']],
  ['gsample07a', '7A', '7', 27, '#009e73',
    ['204', '302', 'Library', '102', 'Cafeteria', '201', '203', '301'],
    ['303', '302', '204', '103', 'Cafeteria', '203', '101', '202']],
  ['gsample07b', '7B', '7', 25, '#cc79a7',
    ['303', '204', '102', 'Library', 'Cafeteria', '302', '103', '201'],
    ['203', '101', '201', 'Gym', 'Cafeteria', '301', '204', '302']],
  ['gsample07c', '7C', '7', 22, '#56b4e9',
    ['302', '203', 'Gym', '201', 'Cafeteria', 'Library', '301', '102'],
    ['Gym', '103', '102', '302', 'Cafeteria', '204', '201', 'Library']],
  ['gsample08a', '8A', '8', 28, '#8c6d31',
    ['102', '202', '203', '103', 'Cafeteria', 'Gym', '303', '302'],
    ['204', '303', '302', '201', 'Cafeteria', '103', 'Gym', '101']],
  ['gsample08b', '8B', '8', null, '#7b4ea3',
    ['Gym', '101', '204', '203', 'Cafeteria', '103', '202', '303'],
    ['Library', '203', '303', '301', 'Cafeteria', '102', '302', '201']],
];

function rectCells(x, y, w, h) {
  const cells = [];
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) cells.push(row * WIDTH + column);
  }
  return cells;
}

function buildFloor(plan, subjectByCode, teachersByRoom) {
  const grid = new Array(WIDTH * HEIGHT).fill('.');
  for (const rect of plan.corridor) for (const cell of rectCells(rect[0], rect[1], rect[2], rect[3])) grid[cell] = '#';
  for (const stair of plan.stairs) grid[stair[1] * WIDTH + stair[0]] = 'S';
  const spaces = [];
  for (const room of plan.rooms) {
    const above = room.y < CORRIDOR_ROW;
    spaces.push({
      id: room.id,
      kind: 'room',
      cells: rectCells(room.x, room.y, room.w, room.h),
      number: room.number,
      teacherIds: teachersByRoom.get(room.number) || [],
      subjectId: room.subject === null ? null : subjectByCode.get(room.subject),
      wing: room.wing,
      capacity: room.capacity,
      shared: room.shared === true,
      doors: room.doors.map((x) => ({ cell: (above ? CORRIDOR_ROW - 1 : CORRIDOR_ROW + 1) * WIDTH + x, side: above ? 's' : 'n' })),
    });
  }
  for (const other of plan.others) {
    spaces.push({ id: other.id, kind: 'other', cells: rectCells(other.x, other.y, other.w, other.h), label: other.label, otherKind: other.otherKind, colour: other.colour });
  }
  return {
    id: plan.id,
    name: plan.name,
    level: plan.level,
    width: WIDTH,
    height: HEIGHT,
    cells: grid.join(''),
    spaces,
    corridors: plan.names.map((named) => ({ id: named.id, name: named.name, cells: rectCells(named.rect[0], named.rect[1], named.rect[2], named.rect[3]) })),
    exits: plan.exits.map((exit) => ({ id: exit.id, cell: exit.y * WIDTH + exit.x, doorName: exit.doorName, assembly: exit.assembly })),
    image: null,
  };
}

export function sampleSchool() {
  const subjectByCode = new Map(SUBJECTS.map((subject) => [subject.code, subject.id]));
  const teachersByRoom = new Map(TEACHERS.map((teacher) => [teacher[3], [teacher[0]]]));
  const roomIdByNumber = new Map();
  for (const plan of FLOORS) for (const room of plan.rooms) roomIdByNumber.set(room.number, room.id);

  const day = (numbers) => numbers.map((number) => ({
    room: roomIdByNumber.get(number),
    roomText: '',
    label: number === 'Cafeteria' ? 'Lunch' : '',
    teacherIds: [],
  }));
  const bells = (list) => list.map((bell) => ({ start: bell[0], end: bell[1] }));
  const views = {};
  for (const view of ['teacher', 'group', 'room', 'map', 'free', 'now', 'common', 'coverage', 'sub', 'directions', 'staffing']) views[view] = true;

  return {
    format: 'sv2-project',
    version: 1,
    id: SAMPLE_PROJECT_ID,
    created: SAMPLE_DATE,
    modified: SAMPLE_DATE,
    settings: {
      schoolName: SAMPLE_SCHOOL_NAME,
      periods: 8,
      periodWord: 'Period',
      defaultPassingSeconds: 240,
      defaultHeadCount: 25,
      secondsPerCell: 3,
      secondsPerStair: 8,
      colourScale: { mode: 'relative', bands: [10, 25, 50, 100] },
      checks: { consecutiveLimit: 4, passingMarginSeconds: 0, off: [] },
      timeFormat: '12h',
      paper: { size: 'letter', orientation: 'portrait' },
      theme: 'auto',
    },
    building: {
      floors: FLOORS.map((plan) => buildFloor(plan, subjectByCode, teachersByRoom)),
      connections: CONNECTIONS.map((connection) => ({
        id: connection.id,
        label: connection.label,
        a: { floorId: connection.a[0], cell: connection.a[2] * WIDTH + connection.a[1] },
        b: { floorId: connection.b[0], cell: connection.b[2] * WIDTH + connection.b[1] },
        direction: 'both',
      })),
      zones: [{ id: 'zsample001', floorId: 'fsample001', label: 'Cafeteria doors', x: 19, y: CORRIDOR_ROW, w: 9, h: 1 }],
    },
    subjects: SUBJECTS.map((subject) => ({ ...subject })),
    teachers: TEACHERS.map((teacher) => ({
      id: teacher[0],
      name: teacher[1],
      subjectId: subjectByCode.get(teacher[2]),
      roomIds: [roomIdByNumber.get(teacher[3])],
      notes: '',
    })),
    groups: GROUPS.map((group) => ({
      id: group[0],
      name: group[1],
      grade: group[2],
      headCount: group[3],
      colour: group[4],
      days: { [DAY_A]: day(group[5]), [DAY_B]: day(group[6]) },
    })),
    dayTypes: [
      { id: DAY_A, name: 'A Day', own: true, bells: bells(BELLS_A) },
      { id: DAY_B, name: 'B Day', own: true, bells: bells(BELLS_B) },
    ],
    accepted: [],
    scenario: null,
    publish: { passcode: 'bulldogs2015', stalenessDays: 60, views, teacherNamesOnMap: true, lastPublishedAt: null },
    onboarding: { steps: {}, dismissed: false, neverShow: false },
  };
}
