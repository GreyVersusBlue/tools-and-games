// The data model: constants, ranges, defaults and the lookups every other
// module shares. A project is one plain JSON object (FORMATS.md has every
// field). This module imports nothing, and is one of the modules a published
// file carries, so it keeps to the linker rule: no default export, no
// re-export, `export` only directly before a declaration.

export const FORMAT = 'sv2-project';
export const PUBLISHED_FORMAT = 'sv2-published';
export const CURRENT_VERSION = 1;

// The crowd model's column: six students to one lane cell.
export const STUDENTS_PER_LANE_CELL = 6;

// Inclusive ranges, [lowest, highest].
export const RANGES = {
  periods: [1, 16],
  defaultPassingSeconds: [0, 3600],
  headCount: [1, 999],
  capacity: [1, 999],
  secondsPerCell: [1, 10],
  secondsPerStair: [2, 30],
  floorSize: [5, 200],
  consecutiveLimit: [1, 16],
  passingMarginSeconds: [0, 600],
  stalenessDays: [1, 3650],
  colourBand: [1, 99999],
};

export const PERIOD_WORDS = ['Period', 'Mod', 'Block', 'Hour'];
export const TIME_FORMATS = ['12h', '24h'];
// The papers a print can be laid out for (ui/prints/document.js PAPERS has
// their sizes and names). Values are only ever added: a project saved with
// one this version does not know reads as the default through repair.
export const PAPER_SIZES = ['letter', 'a4', 'tabloid', 'a3', 'a2', 'a1', 'a0', 'poster-24x36'];
export const PAPER_ORIENTATIONS = ['portrait', 'landscape'];
export const THEMES = ['auto', 'light', 'dark'];
export const COLOUR_SCALE_MODES = ['relative', 'absolute'];
// Cell scale (spec 16): how long one cell is in real life, in one of these
// units, kept as settings.cellScale = { unit, length }. It is optional and
// not in defaultSettings(): absent or null means not set, so a project saved
// before the setting existed reads unchanged, and a new project is as it was. Today only the traced image's
// scaling tool reads it (ui/building/scale-tool.js); real units in
// directions and reports, walking speed as a speed and corridor width are
// still a wish.
export const CELL_SCALE_UNITS = ['feet', 'metres'];
// A cell is longer than 0 and at most this long, in either unit.
export const CELL_LENGTH_MOST = 1000;
export const METRES_PER_FOOT = 0.3048;
export const OTHER_KINDS = ['bathroom', 'office', 'storage', 'library', 'outdoor', 'utility', 'other'];
export const DOOR_SIDES = ['n', 'e', 's', 'w'];
export const CONNECTION_DIRECTIONS = ['both', 'ab', 'ba'];
export const CHANGE_KINDS = ['move', 'swapPeriods', 'swapRooms'];
export const PUBLISH_VIEWS = ['teacher', 'group', 'room', 'map', 'free', 'now', 'common', 'coverage', 'sub', 'directions', 'staffing'];
// Views a project keeps a switch for that the published file does not carry
// yet. The calendar page (ARCHITECTURE 17.4) is switched on and off from
// SV2-75, and published from SV2-77, which moves it into PUBLISH_VIEWS: the
// published data's key set is pinned by publish-data.test.mjs, which that
// unit owns. Absent from a project's views means on.
export const LATER_PUBLISH_VIEWS = ['calendar'];

// ---------------------------------------------------------------- day types, bell schedules, the calendar (ARCHITECTURE 17)
//
// Every field below is additive: a project saved before them has none, and
// every rule reads an absent one as its default (no bell schedules, no
// calendar, a day type the same as the first, a short name worked out from
// the name). The limits on names and counts are kept by the actions that add
// and rename, never by validate for a field that already existed (17.1).

// At most this many day types, and this many bell schedules.
export const DAY_TYPES_MOST = 12;
export const BELL_SCHEDULES_MOST = 12;
// A day type's or a bell schedule's name, in characters.
export const NAME_MOST = 40;
// A short name, for the calendar's squares: "A", "ER".
export const SHORT_MOST = 4;
// A calendar covers at most this many dates, first and last included.
export const CALENDAR_DAYS_MOST = 731;
// The rotation is 1 to 24 day type ids.
export const ROTATION_RANGE = [1, 24];
// A dated change's note, in characters.
export const DATE_LABEL_MOST = 60;
// What a weekday's rule or a dated change says the day is, other than a day
// type id: the next day type in the rotation, or no school.
export const DAY_ROTATION = 'rotation';
export const DAY_CLOSED = 'closed';
// A dated change's bells: null is as the weekday says; this is the day
// type's own regular bells.
export const BELLS_REGULAR = 'regular';
// Index 0 is Monday.
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// The kinds a schedule check can report (spec 5.7), in the table's order.
// `settings.checks.off` holds the ones a school has switched off.
export const CHECK_KINDS = [
  'room-double',
  'teacher-double',
  'over-capacity',
  'no-planning',
  'consecutive',
  'teacher-walk',
  'group-walk',
  'room-missing',
  'empty-period',
  'teacher-multi-room',
  'teacher-room-unused',
  'room-unused',
  'room-no-subject',
  'room-no-teacher',
];

export const CELL_EMPTY = '.';
export const CELL_CORRIDOR = '#';
export const CELL_STAIRS = 'S';

export const DEFAULT_FLOOR_WIDTH = 40;
export const DEFAULT_FLOOR_HEIGHT = 30;
export const DEFAULT_OTHER_COLOUR = '#9aa3ad';
export const DEFAULT_DAY_TYPE_NAMES = ['A Day', 'B Day'];

const BASE_GROUP_COLOURS = ['#d1495b', '#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#8c6d31', '#7b4ea3', '#f0e442', '#999999'];

function rotateHue(hex, degrees) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + degrees) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// The ten presets of DESIGN 3 in order, then the same hues turned 30 degrees.
// The grey has no hue to turn, so its second copy is left out: 19 presets.
export const GROUP_COLOUR_PRESETS = BASE_GROUP_COLOURS.concat(
  BASE_GROUP_COLOURS.map((hex) => rotateHue(hex, 30)).filter((hex) => !BASE_GROUP_COLOURS.includes(hex)),
);

// Load bands, quiet to busy (DESIGN 3).
export const LOAD_BAND_COLOURS = ['#e9eef2', '#bcd7e8', '#7fb3d5', '#d98a3e', '#b3261e'];

// The starter subject list. data/subjects-starter.js re-exports it; it lives
// here because the engine imports nothing outside engine/.
export const STARTER_SUBJECTS = [
  { code: 'MATH', name: 'Mathematics', colour: '#2a6f97' },
  { code: 'ENG', name: 'English', colour: '#b5524a' },
  { code: 'SCI', name: 'Science', colour: '#3f8f5b' },
  { code: 'SOC', name: 'Social Studies', colour: '#b7791f' },
  { code: 'LANG', name: 'World Languages', colour: '#7a5aa6' },
  { code: 'ART', name: 'Art', colour: '#c0568f' },
  { code: 'MUS', name: 'Music', colour: '#2f8f9d' },
  { code: 'PE', name: 'Physical Education', colour: '#5b6f2a' },
  { code: 'TECH', name: 'Technology', colour: '#5a6b7b' },
  { code: 'SUP', name: 'Student Support', colour: '#8a5a44' },
];

// ---------------------------------------------------------------- keys

// Room numbers are compared without regard to case or surrounding spaces.
export function roomNumberKey(number) {
  return String(number).trim().toLowerCase();
}

// Group and teacher names are compared the same way.
export function nameKey(name) {
  return String(name).trim().toLowerCase();
}

// Near-duplicate teacher names ("Ms. Okafor", "Ms Okafor") share this key.
export function looseNameKey(name) {
  return String(name).toLowerCase().replace(/[\s.,'’`-]+/g, '');
}

export function isHexColour(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

// Names of day types and of bell schedules are compared without regard to
// case or to any white space: "A Day", "a day" and "ADay" are one name.
export function spacelessKey(name) {
  return String(name).toLowerCase().replace(/\s+/gu, '');
}

// How many characters a text has, counting each code point once, so a name
// in any script is measured as it is read.
export function textLength(value) {
  return Array.from(String(value)).length;
}

export function isBellTime(value) {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value);
}

export function inRange(value, range) {
  return Number.isInteger(value) && value >= range[0] && value <= range[1];
}

// A Cell scale as settings.cellScale holds it: null (not set), or
// { unit, length } with unit one of CELL_SCALE_UNITS and length above 0 and at
// most CELL_LENGTH_MOST. Nothing else is one.
export function isCellScale(value) {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length === 2 && CELL_SCALE_UNITS.includes(value.unit) && typeof value.length === 'number' && Number.isFinite(value.length) && value.length > 0 && value.length <= CELL_LENGTH_MOST;
}

// ---------------------------------------------------------------- defaults

export function defaultSettings() {
  return {
    schoolName: '',
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
  };
}

// The publish settings a project starts with. `passcode` is the caller's:
// the planner hands over the tool's default from publish-defaults.js. This
// module knows no passcode, because a published file carries its source;
// with none handed over protection is off, which is a state a project can
// be in.
export function defaultPublish(passcode) {
  const views = {};
  for (const view of PUBLISH_VIEWS.concat(LATER_PUBLISH_VIEWS)) views[view] = true;
  return {
    passcode: typeof passcode === 'string' ? passcode : '',
    stalenessDays: 60,
    views,
    teacherNamesOnMap: true,
    lastPublishedAt: null,
    // with a calendar, a published file is stale the day after the
    // calendar's last date (ARCHITECTURE 17.4)
    staleAtCalendarEnd: true,
  };
}

// An accepted finding as the project keeps it. `about` is who the finding
// named when it was accepted: group ids, or teacher ids, sorted. An empty
// list is the default, and means the list was not kept (a record made before
// it was) or the finding names nobody; such a record never reads as changed.
export function newAcceptedFinding(findingId, reason, at, about) {
  return { findingId, reason, at, about: Array.isArray(about) ? about.slice().sort() : [] };
}

export function defaultOnboarding() {
  return { steps: {}, dismissed: false, neverShow: false };
}

export function emptyCells(width, height) {
  return CELL_EMPTY.repeat(width * height);
}

export function emptySlot() {
  return { room: null, roomText: '', label: '', teacherIds: [] };
}

export function emptyDay(periods) {
  const day = [];
  for (let i = 0; i < periods; i += 1) day.push(emptySlot());
  return day;
}

export function emptyBells(periods) {
  const bells = [];
  for (let i = 0; i < periods; i += 1) bells.push(null);
  return bells;
}

export function newFloor(id, name, level, width, height) {
  return {
    id,
    name,
    level,
    width,
    height,
    cells: emptyCells(width, height),
    spaces: [],
    corridors: [],
    exits: [],
    image: null,
  };
}

export function newRoom(id, cells) {
  return {
    id,
    kind: 'room',
    cells,
    number: '',
    teacherIds: [],
    subjectId: null,
    wing: '',
    capacity: null,
    shared: false,
    doors: [],
  };
}

export function newOtherSpace(id, cells) {
  return { id, kind: 'other', cells, label: '', otherKind: 'other', colour: DEFAULT_OTHER_COLOUR };
}

// `sameAs` is null for an own day type, and for one that is the same as the
// first; `short` is "" until one is typed.
export function newDayType(id, name, own, periods) {
  return { id, name, own, sameAs: null, short: '', bells: emptyBells(periods) };
}

// Another set of times for the same classes (ARCHITECTURE 17.3): the bells
// it starts with are the caller's, one entry per period.
export function newBellSchedule(id, name, bells) {
  return { id, name, short: '', bells, off: [] };
}

// A weekday's rule, as a new calendar has it: Monday to Friday take the
// rotation, Saturday and Sunday have no school.
export function defaultWeekdays() {
  return WEEKDAY_NAMES.map((weekday, index) => ({ day: index < 5 ? DAY_ROTATION : DAY_CLOSED, bells: null }));
}

// The project's bell schedules: absent, or anything but a list, is none.
// Every rule asks through here, since the staff browser never runs repair.
export function bellSchedulesOf(project) {
  return project && Array.isArray(project.bellSchedules) ? project.bellSchedules : [];
}

// The project's calendar, or null: absent, or anything but an object, is none.
export function calendarOf(project) {
  const calendar = project ? project.calendar : null;
  return calendar !== null && typeof calendar === 'object' && !Array.isArray(calendar) ? calendar : null;
}

// newProject(ids, clock) is a valid empty project: one floor of 40 by 30, an
// A Day and a B Day that is the same as A Day, no other bell schedules, no
// calendar, the starter subjects, and the settings of spec 16. `options.paperSize` is how the page passes the device's
// region; `options.subjects` replaces the starter list; `options.passcode` is
// the staff passcode the project starts with (none, and protection is off).
export function newProject(ids, clock, options) {
  const opts = options || {};
  const now = clock().toISOString();
  const settings = defaultSettings();
  if (PAPER_SIZES.includes(opts.paperSize)) settings.paper.size = opts.paperSize;
  const starter = Array.isArray(opts.subjects) ? opts.subjects : STARTER_SUBJECTS;
  return {
    format: FORMAT,
    version: CURRENT_VERSION,
    id: ids('p'),
    created: now,
    modified: now,
    settings,
    building: {
      floors: [newFloor(ids('f'), 'Floor 1', 1, DEFAULT_FLOOR_WIDTH, DEFAULT_FLOOR_HEIGHT)],
      connections: [],
      zones: [],
    },
    subjects: starter.map((subject) => ({ id: ids('s'), code: subject.code, name: subject.name, colour: subject.colour })),
    teachers: [],
    groups: [],
    dayTypes: [
      newDayType(ids('d'), DEFAULT_DAY_TYPE_NAMES[0], true, settings.periods),
      newDayType(ids('d'), DEFAULT_DAY_TYPE_NAMES[1], false, settings.periods),
    ],
    bellSchedules: [],
    calendar: null,
    accepted: [],
    scenario: null,
    publish: defaultPublish(opts.passcode),
    onboarding: defaultOnboarding(),
  };
}

// ---------------------------------------------------------------- cells

export function isWalkable(character) {
  return character === CELL_CORRIDOR || character === CELL_STAIRS;
}

export function cellIndex(floor, x, y) {
  return y * floor.width + x;
}

export function cellX(floor, cell) {
  return cell % floor.width;
}

export function cellY(floor, cell) {
  return Math.floor(cell / floor.width);
}

// The cell across one side of `cell`, or -1 when that is off the grid.
export function neighbourCell(floor, cell, side) {
  const x = cell % floor.width;
  const y = Math.floor(cell / floor.width);
  if (side === 'n') return y > 0 ? cell - floor.width : -1;
  if (side === 's') return y < floor.height - 1 ? cell + floor.width : -1;
  if (side === 'w') return x > 0 ? cell - 1 : -1;
  if (side === 'e') return x < floor.width - 1 ? cell + 1 : -1;
  return -1;
}

const ownerCache = new WeakMap();

// Map of cell -> the space that owns it, for one floor. Where two spaces
// claim a cell the earlier one in the array is the owner. Cached by the
// floor's `spaces` array, which a new project state replaces when it changes.
export function spaceOwners(floor) {
  const cached = ownerCache.get(floor.spaces);
  if (cached) return cached;
  const owners = new Map();
  for (const space of floor.spaces) {
    for (const cell of space.cells) if (!owners.has(cell)) owners.set(cell, space);
  }
  ownerCache.set(floor.spaces, owners);
  return owners;
}

// What a cell is: 'corridor', 'stairs', 'room', 'other' or 'empty'.
export function cellKind(floor, cell) {
  const character = floor.cells[cell];
  if (character === CELL_CORRIDOR) return 'corridor';
  if (character === CELL_STAIRS) return 'stairs';
  const owner = spaceOwners(floor).get(cell);
  return owner ? owner.kind : 'empty';
}

// An exit sits on a corridor cell with at least one side that is empty or off
// the grid.
export function isEdgeCorridorCell(floor, cell) {
  if (floor.cells[cell] !== CELL_CORRIDOR) return false;
  const owners = spaceOwners(floor);
  for (const side of DOOR_SIDES) {
    const next = neighbourCell(floor, cell, side);
    if (next === -1) return true;
    if (floor.cells[next] === CELL_EMPTY && !owners.has(next)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- lookups

const roomCache = new WeakMap();

function roomIndex(project) {
  const floors = project.building.floors;
  const cached = roomCache.get(floors);
  if (cached) return cached;
  const index = new Map();
  for (const floor of floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') index.set(space.id, { room: space, floor });
    }
  }
  roomCache.set(floors, index);
  return index;
}

export function allRooms(project) {
  return Array.from(roomIndex(project).values(), (entry) => entry.room);
}

export function findRoom(project, roomId) {
  const entry = roomIndex(project).get(roomId);
  return entry ? entry.room : null;
}

export function floorOfRoom(project, roomId) {
  const entry = roomIndex(project).get(roomId);
  return entry ? entry.floor : null;
}

export function findFloor(project, floorId) {
  return project.building.floors.find((floor) => floor.id === floorId) || null;
}

export function findById(list, id) {
  return list.find((item) => item.id === id) || null;
}

// What room is this slot in? `room` is the room object when the slot names a
// room that is in the building. Otherwise `missing` is true when the slot
// still has something to say (a deleted room's number, an imported number
// nobody has drawn), and false for a slot with nothing entered.
export function resolveSlotRoom(project, slot) {
  if (slot && slot.room) {
    const room = findRoom(project, slot.room);
    if (room) return { room, text: room.number, missing: false };
    return { room: null, text: slot.roomText || '', missing: true };
  }
  const text = slot && typeof slot.roomText === 'string' ? slot.roomText : '';
  return { room: null, text, missing: text !== '' };
}

// A room as a sentence names it (DESIGN 2). A number reads "Room 204": one
// that starts with a digit, in any script, or with one or two letters and
// then a digit ("B12", "A-7", "LL3"). A number that is a word is given as
// typed ("Gym", "Gym 2", "Library"). "Room 204" typed whole is a word by
// that rule too, so nothing ever reads "Room Gym" or "Room Room 204". A room
// with no number says so. `start` is for the first word of a sentence. What
// was typed goes in as it is, never trimmed.
//
// This is the rule every screen, check, print and published file knows as
// roomName: findings.js hands it on under that name. It has another name
// here because the modules a published file carries share one scope for what
// they export, and both of these are among them.
export function nameOfRoom(room, start) {
  const number = room && typeof room.number === 'string' ? room.number : '';
  if (number.trim() === '') return start ? 'A room with no number' : 'a room with no number';
  return /^\s*(\p{L}{1,2}[-. ]?)?\p{Nd}/u.test(number) ? 'Room ' + number : number;
}

// The next preset no group uses yet; when all are used, the one used least,
// earliest first.
export function nextGroupColour(groups) {
  const counts = new Map(GROUP_COLOUR_PRESETS.map((colour) => [colour, 0]));
  for (const group of groups) {
    const colour = String(group.colour).toLowerCase();
    if (counts.has(colour)) counts.set(colour, counts.get(colour) + 1);
  }
  let best = GROUP_COLOUR_PRESETS[0];
  for (const colour of GROUP_COLOUR_PRESETS) {
    if (counts.get(colour) < counts.get(best)) best = colour;
  }
  return best;
}

// The first unused connection letter: A to Z, then AA, AB and on.
export function nextConnectionLabel(connections) {
  const used = new Set(connections.map((connection) => connection.label));
  for (let n = 0; ; n += 1) {
    let label = '';
    let rest = n;
    do {
      label = String.fromCharCode(65 + (rest % 26)) + label;
      rest = Math.floor(rest / 26) - 1;
    } while (rest >= 0);
    if (!used.has(label)) return label;
  }
}
