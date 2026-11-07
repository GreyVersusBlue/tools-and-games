// The sample school: Marrowby Middle School. Everything here is invented:
// the school, the building, every teacher and every group. It exists so that
// every part of the tool can be explored in the first minute, and so the tests
// have one complete project to run against.
//
// The building has three floors of 40 by 14 cells, each with one corridor
// along the middle. Stairs A join Floor 1 and Floor 2 near the west end, with
// stairs C (up only) a little further west;
// stairs B join Floor 2 and Floor 3 near the east end. So a walk between
// Floor 1 and Floor 3 crosses most of Floor 2. There are two exits on
// Floor 1: Door A at the end of the Front Hall, Door B at the east end of the
// Main Corridor. Thirteen rooms: ten classrooms, and the Gym, the Cafeteria
// and the Library, which are shared spaces. Twelve teachers, eight groups,
// an A Day and a B Day that is its own copy, each with bell times and four
// minutes of passing time. Two bell schedules sit beside them: Early Release
// (Periods 5 to 8 off, used on Wednesdays) and Assembly (used on two dates,
// on a third day type, Assembly Day, that is the same as B Day). The calendar
// is an invented school year, 31 August 2026 to 11 June 2027, with a fall
// break, a winter break, a snow day, a Saturday make-up day and the
// re-syncs that keep A and B in step. Over the day sit three lunch and
// assembly marks, three duties (before school, lunch, after school) and a
// Wednesday science meeting.
//
// Two things are wrong on purpose, both on A Days, for a new user to find.
// SAMPLE_PROBLEMS below names them for the tests and the help. The checks
// (engine/checks.js) report them as one problem and one warning:
//
// 1. A problem: a room double-booking. Groups 6C and 7C are both in Room 203
//    in Period 2. Room 203 is not a shared space, and the two groups together
//    are 45 students in a room that seats 30.
// 2. A warning: a walk that is too long. Group 8A goes from the Gym in
//    Period 6 to Room 303 in Period 7: along Floor 1 to stairs A, across
//    Floor 2 to stairs B, then the length of Floor 3 to the Music Wing. That
//    is 81 cells and two stair connections: a route of 259 seconds at the
//    default speeds, which the crowd model walks in 261, against 240 seconds
//    of passing time. The warning is there once walk figures are (the
//    movement engines have run); the schedule checks alone cannot see it.
//
// Two things are done right on purpose, for the movement view and the scenario
// lab to show. Grade 6 leaves a minute after the bell from Period 3, the
// period before its lunch (a staggered dismissal, project.release). And
// Stairs C, a second way between Floors 1 and 2 beside Room 102, are up
// only: Stairs A carry everything coming down, so the one-way rule traps
// nobody and the checks say nothing about either.
//
// The checks also report two notes, and nothing else. Both are about the
// Cafeteria, both are true of a lunch room, and they stay: it has no subject,
// and it has groups scheduled into it and no teacher.
//
// Every other transition on both day types is 180 seconds of plain walking
// or less, no teacher is in two rooms at once, no teacher teaches more than
// four periods in a row, every teacher has a planning period, and no room
// but Room 203 in that one period holds more students than it seats, counting
// every group in it. test/engine/sample-school.test.mjs checks each of those
// claims, and that the checks report exactly the four findings above.
//
// sampleSchool() returns a fresh project every call. It is plain data in the
// shape FORMATS.md describes, with fixed ids and fixed dates, so it is the
// same on every machine.

const WIDTH = 40;
const HEIGHT = 14;
const CORRIDOR_ROW = 7;
// The elevator's stop, on every floor: the cell east of Stairs A.
const LIFT = [13, 8];
const SAMPLE_DATE = '2026-09-01T12:00:00.000Z';

export const SAMPLE_PROJECT_ID = 'psample001';
export const SAMPLE_SCHOOL_NAME = 'Marrowby Middle School (sample)';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
// The day the two assemblies fall on: the same classes as a B Day, and not
// in the rotation, so a mark can name it without naming every B Day (the two problems are on A Days).
const DAY_ASSEMBLY = 'dsample0as';
const BELLS_EARLY = 'bsample0er';
const BELLS_ASSEMBLY = 'bsample0as';

// The two things wrong on purpose: `roomDouble` is the problem, `longWalk` the
// warning. The two notes on the Cafeteria are not listed: nothing is wrong.
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
    stairs: [[8, 8], [12, 8]],
    // What the step-free group adds (left out of the level sample): a short
    // bypass under the Main Corridor, three cells long, round the step in the
    // corridor at x 29. A step-free walk to the Gym or to Door B goes by it.
    bypass: [[28, 8, 3, 1]],
    lifts: [LIFT],
    steps: [[29, CORRIDOR_ROW]],
    rooms: [
      { id: 'rsample101', number: '101', x: 1, y: 3, w: 5, h: 4, doors: [3], subject: 'MATH', capacity: 30, wing: 'West' },
      { id: 'rsample102', number: '102', x: 7, y: 3, w: 5, h: 4, doors: [9], subject: 'MATH', capacity: 30, wing: 'West' },
      { id: 'rsample103', number: '103', x: 13, y: 3, w: 5, h: 4, doors: [15], subject: 'SCI', capacity: 30, wing: 'West' },
      { id: 'rsamplecaf', number: 'Cafeteria', x: 19, y: 2, w: 9, h: 5, doors: [21, 25], stepDoors: [21], subject: null, capacity: 150, shared: true, wing: '' },
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
      { id: 'xsample00a', x: 20, y: 13, doorName: 'Door A', assembly: 'Front lawn by the flagpole', step: true },
      { id: 'xsample00b', x: 39, y: CORRIDOR_ROW, doorName: 'Door B', assembly: 'East field by the backstop' },
    ],
  },
  {
    id: 'fsample002',
    name: 'Floor 2',
    level: 2,
    corridor: [[1, CORRIDOR_ROW, 38, 1]],
    stairs: [[8, 8], [12, 8], [33, 8]],
    lifts: [LIFT],
    refuges: [{ id: 'asample001', x: 33, y: CORRIDOR_ROW }],
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
    lifts: [LIFT],
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
  // Stairs C: a second way between Floors 1 and 2, by Room 102, up only (the
  // connection's `a` is Floor 1). Stairs A, beside it, carry everything coming
  // down, so the one-way rule traps nobody.
  { id: 'csample0up', label: 'C', a: ['fsample001', 8, 8], b: ['fsample002', 8, 8], direction: 'ab' },
  // Elevator D, beside Stairs A, stops on every floor and is staff and
  // authorised only, which is what a new elevator is. Two connections make one
  // elevator: its letter is `car`, and each connection keeps a label of its own.
  { id: 'csample00d', label: 'D', a: ['fsample001', 13, 8], b: ['fsample002', 13, 8], elevator: true },
  { id: 'csample00e', label: 'E', a: ['fsample002', 13, 8], b: ['fsample003', 13, 8], elevator: true },
];

const BELLS_A = [['08:00', '08:48'], ['08:52', '09:40'], ['09:44', '10:32'], ['10:36', '11:24'], ['11:28', '12:16'], ['12:20', '13:08'], ['13:12', '14:00'], ['14:04', '14:52']];
// B Days start twenty minutes later, after a school-wide advisory.
const BELLS_B = [['08:20', '09:08'], ['09:12', '10:00'], ['10:04', '10:52'], ['10:56', '11:44'], ['11:48', '12:36'], ['12:40', '13:28'], ['13:32', '14:20'], ['14:24', '15:12']];

// Early Release: four periods of forty minutes, then home. Periods 5 to 8 do
// not meet, so they have no times.
const BELLS_EARLY_RELEASE = [['08:00', '08:40'], ['08:44', '09:24'], ['09:28', '10:08'], ['10:12', '10:52'], null, null, null, null];
// Assembly: every period shortened to 44 minutes except the last, which is
// the assembly itself.
const BELLS_ASSEMBLY_DAY = [['08:00', '08:44'], ['08:48', '09:32'], ['09:36', '10:20'], ['10:24', '11:08'], ['11:12', '11:56'], ['12:00', '12:44'], ['12:48', '13:32'], ['13:36', '14:30']];

// 6A needs step-free routes: its day goes up and down Floors 1 to 3, so it rides Elevator D.
const STEP_FREE_GROUP = 'gsample06a';

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

function buildFloor(plan, subjectByCode, teachersByRoom, stepFree) {
  const grid = new Array(WIDTH * HEIGHT).fill('.');
  const lifts = stepFree ? plan.lifts : undefined;
  for (const rect of plan.corridor.concat(stepFree ? plan.bypass || [] : [])) for (const cell of rectCells(rect[0], rect[1], rect[2], rect[3])) grid[cell] = '#';
  for (const stair of plan.stairs) grid[stair[1] * WIDTH + stair[0]] = 'S';
  for (const lift of lifts || []) grid[lift[1] * WIDTH + lift[0]] = 'S';
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
      doors: room.doors.map((x) => {
        const door = { cell: (above ? CORRIDOR_ROW - 1 : CORRIDOR_ROW + 1) * WIDTH + x, side: above ? 's' : 'n' };
        if (stepFree && (room.stepDoors || []).includes(x)) door.stepFree = false;
        return door;
      }),
    });
  }
  for (const other of plan.others) {
    spaces.push({ id: other.id, kind: 'other', cells: rectCells(other.x, other.y, other.w, other.h), label: other.label, otherKind: other.otherKind, colour: other.colour });
  }
  const floor = {
    id: plan.id,
    name: plan.name,
    level: plan.level,
    width: WIDTH,
    height: HEIGHT,
    cells: grid.join(''),
    spaces,
    corridors: plan.names.map((named) => ({ id: named.id, name: named.name, cells: rectCells(named.rect[0], named.rect[1], named.rect[2], named.rect[3]) })),
    exits: plan.exits.map((exit) => {
      const out = { id: exit.id, cell: exit.y * WIDTH + exit.x, doorName: exit.doorName, assembly: exit.assembly };
      if (stepFree && exit.step) out.stepFree = false;
      return out;
    }),
    image: null,
  };
  // The three lists a floor gains for elevators and steps are there only on a
  // floor that has something in them, as the building actions leave them.
  if (stepFree && plan.lifts) floor.lifts = plan.lifts.map((lift) => lift[1] * WIDTH + lift[0]);
  if (stepFree && plan.steps) floor.notStepFree = plan.steps.map((step) => step[1] * WIDTH + step[0]);
  if (stepFree && plan.refuges) floor.refuges = plan.refuges.map((refuge) => ({ id: refuge.id, cell: refuge.y * WIDTH + refuge.x, name: 'Area of refuge' }));
  return floor;
}

// A school year that never happened: 31 August 2026 to 11 June 2027, A Days
// and B Days taking turns, Wednesdays on Early Release, and the changes a
// real year has. The rotation steps on every school day and a closed day does
// not step it, so a snow day pushes every later day back by one. The day after
// the snow day is set to A, the day the old order had: keeping the old order
// skips the snow day's B, so the A before the snow day and the A after it have
// the same classes, on purpose. That is the re-sync, and the one place the
// classes repeat. Assembly Day is not in the rotation, so an
// assembly does not step it: each assembly sits on a date that is a B turn
// (it has B's classes) and the school day after it is set to A, which puts the
// rotation back in step. Everywhere else the classes alternate A, B.
function sampleCalendar() {
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((index) => ({ day: index < 5 ? 'rotation' : 'closed', bells: index === 2 ? BELLS_EARLY : null }));
  const closed = (date, label) => ({ date, day: 'closed', bells: null, label });
  const winter = ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'];
  const dates = [
    closed('2026-10-19', 'Fall break'), closed('2026-10-20', 'Fall break'), closed('2026-10-21', 'Fall break'), closed('2026-10-22', 'Fall break'), closed('2026-10-23', 'Fall break'),
    { date: '2026-11-13', day: DAY_ASSEMBLY, bells: BELLS_ASSEMBLY, label: 'Assembly' },
    { date: '2026-11-16', day: DAY_A, bells: null, label: 'Back in step after the assembly' },
    ...winter.map((date) => closed(date, 'Winter break')),
    closed('2027-01-12', 'Snow day'),
    { date: '2027-01-13', day: DAY_A, bells: null, label: 'Back in step after the snow day' },
    { date: '2027-03-11', day: DAY_ASSEMBLY, bells: BELLS_ASSEMBLY, label: 'Assembly' },
    { date: '2027-03-12', day: DAY_A, bells: null, label: 'Back in step after the assembly' },
    { date: '2027-03-27', day: 'rotation', bells: null, label: 'Make-up day for the snow day' },
  ];
  return { start: '2026-08-31', end: '2027-06-11', weekdays, rotation: [DAY_A, DAY_B], dates, changedAt: SAMPLE_DATE };
}

// Lunch, by grade, where the slots allow: on both day types Grade 6 eats in
// Period 4 and Grades 7 and 8 in Period 5 (the Cafeteria slots in the
// groups below), and a lunch mark lies over each of them. The assembly is an
// Activity mark in the last period of the Assembly Day, for the whole school.
// It lies over the slot and takes nobody out of a room.
function sampleMarks() {
  return [
    { id: 'msample001', kind: 'lunch', label: '', period: 3, dayTypeIds: [], scope: 'grades', grades: ['6'], groupIds: [] },
    { id: 'msample002', kind: 'lunch', label: '', period: 4, dayTypeIds: [], scope: 'grades', grades: ['7', '8'], groupIds: [] },
    { id: 'msample003', kind: 'activity', label: 'Assembly', period: 7, dayTypeIds: [DAY_ASSEMBLY], scope: 'school', grades: [], groupIds: [] },
  ];
}

// One staggered dismissal: Grade 6 leaves a minute after the bell from the
// period before its lunch (Period 3, which is 2 when counted from 0), so the
// three Grade 6 groups do not meet the whole of Floor 1 at the Cafeteria doors.
function sampleRelease() {
  return [{ id: 'lsample001', who: { grade: '6' }, seconds: 60, after: [2], dayTypeIds: null }];
}

// Three duties and one meeting, all invented. Bus duty is before school with
// times and a place; the lunch duty is in Period 5 in the Cafeteria; car line
// is after school. The Wednesday science meeting names the subject, so a new
// science teacher is in it without anyone editing it. It is after school
// because Wednesday is Early Release and Period 5 does not meet.
function sampleDuties() {
  return [
    { id: 'usample001', kind: 'duty', label: 'Bus duty', when: 'before', period: 0, start: '07:30', end: '07:55', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: 'Bus loop', teacherIds: ['tsample004', 'tsample009'], subjectIds: [], everyone: false },
    { id: 'usample002', kind: 'duty', label: 'Lunch duty', when: 'period', period: 4, start: '', end: '', dayTypeIds: [], weekdays: [0, 1, 3, 4], from: '', to: '', roomId: 'rsamplecaf', place: '', teacherIds: ['tsample001', 'tsample007'], subjectIds: [], everyone: false },
    { id: 'usample003', kind: 'duty', label: 'Car line', when: 'after', period: 0, start: '15:15', end: '15:35', dayTypeIds: [], weekdays: [0, 1, 3, 4], from: '', to: '', roomId: null, place: 'Front drive', teacherIds: ['tsample004', 'tsample005'], subjectIds: [], everyone: false },
    { id: 'usample004', kind: 'meeting', label: 'Science department', when: 'after', period: 0, start: '11:00', end: '11:45', dayTypeIds: [], weekdays: [2], from: '', to: '', roomId: 'rsample103', place: '', teacherIds: [], subjectIds: ['ssample003'], everyone: false },
  ];
}

// sampleSchool({ level: true }) is the same school without what the elevator
// and the step-free group add: no Elevator D, no step, step door or step exit,
// no area of refuge, no bypass, and no group that needs step-free routes. It
// is what the school was before those were added, byte for byte, so a test of
// "a building with no elevator is unchanged" has a real one to hold against.
export function sampleSchool(options) {
  const stepFree = !(options && options.level === true);
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
  const bells = (list) => list.map((bell) => (bell ? { start: bell[0], end: bell[1] } : null));
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
      floors: FLOORS.map((plan) => buildFloor(plan, subjectByCode, teachersByRoom, stepFree)),
      connections: CONNECTIONS.filter((connection) => stepFree || !connection.elevator).map((connection) => ({
        id: connection.id,
        label: connection.label,
        a: { floorId: connection.a[0], cell: connection.a[2] * WIDTH + connection.a[1] },
        b: { floorId: connection.b[0], cell: connection.b[2] * WIDTH + connection.b[1] },
        direction: connection.direction || 'both',
        ...(connection.elevator ? { kind: 'elevator', car: 'D', staffOnly: true } : {}),
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
      ...(stepFree && group[0] === STEP_FREE_GROUP ? { stepFree: true } : {}),
      days: { [DAY_A]: day(group[5]), [DAY_B]: day(group[6]) },
    })),
    dayTypes: [
      { id: DAY_A, name: 'A Day', own: true, bells: bells(BELLS_A) },
      { id: DAY_B, name: 'B Day', own: true, bells: bells(BELLS_B) },
      { id: DAY_ASSEMBLY, name: 'Assembly Day', own: false, sameAs: DAY_B, short: 'AD', bells: Array(8).fill(null) },
    ],
    bellSchedules: [
      { id: BELLS_EARLY, name: 'Early Release', short: 'ER', bells: bells(BELLS_EARLY_RELEASE), off: [4, 5, 6, 7] },
      { id: BELLS_ASSEMBLY, name: 'Assembly', short: 'AS', bells: bells(BELLS_ASSEMBLY_DAY), off: [] },
    ],
    calendar: sampleCalendar(),
    marks: sampleMarks(),
    release: sampleRelease(),
    duties: sampleDuties(),
    accepted: [],
    scenario: null,
    publish: { passcode: 'bulldogs2015', stalenessDays: 60, views, teacherNamesOnMap: true, lastPublishedAt: null },
    onboarding: { steps: {}, dismissed: false, neverShow: false },
  };
}
