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
export const PAPER_SIZES = ['letter', 'a4'];
export const PAPER_ORIENTATIONS = ['portrait', 'landscape'];
export const THEMES = ['auto', 'light', 'dark'];
export const COLOUR_SCALE_MODES = ['relative', 'absolute'];
export const OTHER_KINDS = ['bathroom', 'office', 'storage', 'library', 'outdoor', 'utility', 'other'];
export const DOOR_SIDES = ['n', 'e', 's', 'w'];
export const CONNECTION_DIRECTIONS = ['both', 'ab', 'ba'];
export const CHANGE_KINDS = ['move', 'swapPeriods', 'swapRooms'];
export const PUBLISH_VIEWS = ['teacher', 'group', 'room', 'map', 'free', 'now', 'common', 'coverage', 'sub', 'directions', 'staffing'];

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
export const DEFAULT_PASSCODE = 'bulldogs2015';
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

export function isBellTime(value) {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value);
}

export function inRange(value, range) {
  return Number.isInteger(value) && value >= range[0] && value <= range[1];
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

export function defaultPublish() {
  const views = {};
  for (const view of PUBLISH_VIEWS) views[view] = true;
  return {
    passcode: DEFAULT_PASSCODE,
    stalenessDays: 60,
    views,
    teacherNamesOnMap: true,
    lastPublishedAt: null,
  };
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

export function newDayType(id, name, own, periods) {
  return { id, name, own, bells: emptyBells(periods) };
}

// newProject(ids, clock) is a valid empty project: one floor of 40 by 30, an
// A Day and a B Day that is the same as A Day, the starter subjects, and the
// settings of spec 16. `options.paperSize` is how the page passes the device's
// region; `options.subjects` replaces the starter list.
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
    accepted: [],
    scenario: null,
    publish: defaultPublish(),
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
