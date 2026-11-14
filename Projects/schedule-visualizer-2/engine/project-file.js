// The three files a project travels in: the project file, the building file
// and the schedule file. FORMATS.md defines each. This module writes them,
// reads them, and works out what importing one would make of a project.
//
//   writeProjectFile(project, { images })   → text
//   writeBuildingFile(project, { images })  → text
//   writeScheduleFile(project)              → text
//   readProjectFile(text, { ids, clock })   → { project, images, notes, migratedFrom, summary }
//   readBuildingFile(text)                  → { file, images, summary }
//   readScheduleFile(text)                  → { file, summary }
//   applyBuilding(project, file, { ids, unnumberedText }) → { project, summary }
//   applySchedule(project, file, { policy, takeSettings, ids, clock }) → { project, summary }
//
// Reading takes nothing on trust. A file is checked in full before anything
// is returned, and a reader either returns something every other module may
// rely on or throws a FileError whose message says what was wrong and what
// to do. A file from a newer version of the tool is refused whole. Nothing
// here changes the project it is given: the actions in actions.js put the
// result in place as one undo step.
//
// Traced images. The device keeps image bytes apart from the project. A file
// carries them as base64 inside each floor's `image`, as `data` and `type`.
// `images` is { [imageId]: { data, type } } both ways: the page passes what
// it holds to a writer, and stores what a reader hands back.

import { FORMAT, PUBLISHED_FORMAT, CURRENT_VERSION, defaultSettings, defaultPublish, defaultOnboarding, emptyBells, emptySlot, emptyDay, roomNumberKey, nameKey, spacelessKey, allRooms, findRoom, bellSchedulesOf, calendarOf, marksOf, dutiesOf, releaseOf, RELEASE_MOST, DAY_TYPES_MOST, BELL_SCHEDULES_MOST, DAY_ROTATION, DAY_CLOSED, BELLS_REGULAR, CHECK_KINDS, RANGES, PERIOD_WORDS, TIME_FORMATS, COLOUR_SCALE_MODES } from './schema.js';
import { DEFAULT_PASSCODE } from './publish-defaults.js';
import { migrate, MigrateError, versionOf, NEWER_VERSION_MESSAGE, NOT_A_PROJECT_MESSAGE } from './migrate.js';
import { repair } from './repair.js';
import { validate } from './validate.js';
import { collectIds, isId } from './ids.js';
import { mergeGroups, ImportError, CLASH_POLICIES } from './import-groups.js';
import { isOwnCopy, effectiveDayType, findDayType } from './day-types.js';

export const BUILDING_FORMAT = 'sv2-building';
export const SCHEDULE_FORMAT = 'sv2-schedule';
export const BUILDING_VERSION = 1;
export const SCHEDULE_VERSION = 1;

// The settings a schedule file carries.
export const SCHEDULE_SETTINGS = ['periods', 'periodWord', 'defaultPassingSeconds', 'defaultHeadCount'];

export const NOT_JSON_MESSAGE = 'This file could not be read. It is not a Schedule Visualizer 2 file, or it was cut short when it was saved or sent. Export it again and choose the new file.';
export const NOT_A_BUILDING_MESSAGE = 'This is not a Schedule Visualizer 2 building file. Choose a building file the tool exported.';
export const NOT_A_SCHEDULE_MESSAGE = 'This is not a Schedule Visualizer 2 schedule file. Choose a schedule file the tool exported.';

const KIND_WORDS = {
  [FORMAT]: 'a project file',
  [BUILDING_FORMAT]: 'a building file',
  [SCHEDULE_FORMAT]: 'a schedule file',
  [PUBLISHED_FORMAT]: 'a published file for staff',
  'sv2-published-locked': 'a published file for staff',
};

const KIND_ADVICE = {
  [FORMAT]: 'It holds a whole project: import it as a project.',
  [BUILDING_FORMAT]: 'It holds a building and no schedule: import it as a building.',
  [SCHEDULE_FORMAT]: 'It holds a schedule and no building: import it as a schedule.',
  [PUBLISHED_FORMAT]: 'It is for reading, and cannot be imported. Choose the project file it was published from.',
  'sv2-published-locked': 'It is for reading, and cannot be imported. Choose the project file it was published from.',
};

export class FileError extends Error {
  constructor(message, code, findings) {
    super(message);
    this.name = 'FileError';
    this.code = code || 'refused';
    this.findings = findings || [];
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// "This is a building file, not a project file. It holds …"
export function wrongKindMessage(found, wanted) {
  return 'This is ' + KIND_WORDS[found] + ', not ' + KIND_WORDS[wanted] + '. ' + KIND_ADVICE[found];
}

// The refusal for a file that parsed and is not as its format says.
export function invalidMessage(what, findings) {
  const count = findings.length;
  const first = findings[0];
  return 'This ' + what + ' file cannot be imported, and nothing was changed. ' + count + (count === 1 ? ' thing in it is' : ' things in it are') + ' not as the format says. The first: ' + (first.path === '' ? '' : first.path + ': ') + first.message;
}

function parseJson(text) {
  if (typeof text !== 'string') throw new FileError(NOT_JSON_MESSAGE, 'not-json');
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    throw new FileError(NOT_JSON_MESSAGE, 'not-json');
  }
}

// Which of the tool's files this text is: 'project', 'building', 'schedule',
// 'published', or null. A file with no `format` that still looks like a
// project (one from before files carried a version) is 'project'.
export function fileKind(text) {
  let value;
  try {
    value = parseJson(text);
  } catch (error) {
    return null;
  }
  if (!isObject(value)) return null;
  if (value.format === FORMAT) return 'project';
  if (value.format === BUILDING_FORMAT) return 'building';
  if (value.format === SCHEDULE_FORMAT) return 'schedule';
  if (value.format === PUBLISHED_FORMAT || value.format === 'sv2-published-locked') return 'published';
  if (value.format === undefined && looksLikeProject(value)) return 'project';
  return null;
}

function looksLikeProject(value) {
  return isObject(value.building) || Array.isArray(value.groups) || Array.isArray(value.dayTypes);
}

function stringify(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

// ---------------------------------------------------------------- images

function withImages(building, images) {
  const held = images || {};
  return {
    ...building,
    floors: building.floors.map((floor) => {
      const image = floor.image;
      if (!image || !Object.prototype.hasOwnProperty.call(held, image.imageId)) return floor;
      const stored = held[image.imageId];
      return { ...floor, image: { ...image, data: stored.data, type: stored.type } };
    }),
  };
}

// Take the image bytes out of a building as read from a file. Returns
// { building, images, findings }; the building is untouched when it has no
// bytes in it or is not shaped like a building at all.
function withoutImages(building) {
  const images = {};
  const findings = [];
  if (!isObject(building) || !Array.isArray(building.floors)) return { building, images, findings };
  let changed = false;
  const floors = building.floors.map((floor, index) => {
    if (!isObject(floor) || !isObject(floor.image)) return floor;
    const image = floor.image;
    if (image.data === undefined && image.type === undefined) return floor;
    const path = 'building.floors[' + index + '].image';
    const { data, type, ...rest } = image;
    changed = true;
    if (typeof data !== 'string' || data === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) findings.push({ path: path + '.data', message: 'The bytes of a traced image are base64 text.' });
    else if (typeof type !== 'string' || !/^image\/[a-z0-9.+-]+$/.test(type)) findings.push({ path: path + '.type', message: 'The type of a traced image is an image type, for example image/png.' });
    else if (typeof image.imageId === 'string' && image.imageId !== '') images[image.imageId] = { data, type };
    return { ...floor, image: rest };
  });
  return { building: changed ? { ...building, floors } : building, images, findings };
}

// What a file holds, for the sentence shown before and after an import.
export function summarise(project) {
  const building = isObject(project.building) ? project.building : { floors: [] };
  let rooms = 0;
  let otherSpaces = 0;
  let images = 0;
  for (const floor of building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room') rooms += 1;
      else otherSpaces += 1;
    }
    if (floor.image) images += 1;
  }
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return { floors: building.floors.length, rooms, otherSpaces, images, subjects: count(project.subjects), teachers: count(project.teachers), groups: count(project.groups), dayTypes: count(project.dayTypes) };
}

// ---------------------------------------------------------------- the project file

// The whole project as text. It is the project object, with each traced
// image's bytes beside its position.
export function writeProjectFile(project, options) {
  const images = options && options.images;
  return stringify({ ...project, building: withImages(project.building, images) });
}

// Read a project file. options: { ids, clock }, used only when an older file
// has something with no id or no date.
export function readProjectFile(text, options) {
  const opts = options || {};
  const value = parseJson(text);
  if (!isObject(value)) throw new FileError(NOT_A_PROJECT_MESSAGE, 'not-a-project');
  if (value.format !== undefined && value.format !== FORMAT) {
    if (KIND_WORDS[value.format]) throw new FileError(wrongKindMessage(value.format, FORMAT), 'wrong-kind');
    throw new FileError(NOT_A_PROJECT_MESSAGE, 'not-a-project');
  }
  let migrated;
  try {
    migrated = migrate(value);
  } catch (error) {
    if (error instanceof MigrateError) throw new FileError(error.message, error.code);
    throw error;
  }
  const from = versionOf(value);
  if (from < CURRENT_VERSION && !looksLikeProject(value)) throw new FileError(NOT_A_PROJECT_MESSAGE, 'not-a-project');

  const taken = withoutImages(migrated.building);
  let project = taken.building === migrated.building ? migrated : { ...migrated, building: taken.building };
  if (taken.findings.length > 0) throw new FileError(invalidMessage('project', taken.findings), 'invalid', taken.findings);

  // A file in the current format has to be right as it stands. An older one
  // is brought up to date first, and has to be right after that.
  if (from === CURRENT_VERSION) {
    const findings = validate(project);
    if (findings.length > 0) throw new FileError(invalidMessage('project', findings), 'invalid', findings);
  }
  const repaired = repair(project, { ids: opts.ids, clock: opts.clock, imageIds: new Set(Object.keys(taken.images)) });
  project = repaired.project;
  const findings = validate(project);
  if (findings.length > 0) throw new FileError(invalidMessage('project', findings), 'invalid', findings);
  return { project, images: taken.images, notes: repaired.notes, migratedFrom: from, summary: summarise(project) };
}

// ---------------------------------------------------------------- scaffolds

// validate() checks a whole project. A building file and a schedule file are
// each part of one, so each is stood inside the plainest project that could
// hold it and checked there: one set of rules, not two.
const SCAFFOLD_DATE = '1970-01-01T00:00:00.000Z';

function scaffold(parts) {
  return {
    format: FORMAT,
    version: CURRENT_VERSION,
    id: 'pscaffold0',
    created: SCAFFOLD_DATE,
    modified: SCAFFOLD_DATE,
    settings: parts.settings || defaultSettings(),
    building: parts.building,
    subjects: parts.subjects || [],
    teachers: parts.teachers || [],
    groups: parts.groups || [],
    dayTypes: parts.dayTypes || [{ id: 'dscaffold0', name: 'A Day', own: true, bells: emptyBells(defaultSettings().periods) }],
    accepted: [],
    scenario: null,
    publish: defaultPublish(DEFAULT_PASSCODE),
    onboarding: defaultOnboarding(),
  };
}

function header(value, format, version, notMessage) {
  if (!isObject(value)) throw new FileError(notMessage, 'not-this-kind');
  if (value.format !== format) {
    const found = value.format === undefined && looksLikeProject(value) ? FORMAT : value.format;
    if (KIND_WORDS[found]) throw new FileError(wrongKindMessage(found, format), 'wrong-kind');
    throw new FileError(notMessage, 'not-this-kind');
  }
  if (!Number.isInteger(value.version) || value.version < 1) throw new FileError(notMessage, 'not-this-kind');
  if (value.version > version) throw new FileError(NEWER_VERSION_MESSAGE, 'newer-version');
}

// ---------------------------------------------------------------- the building file

// The building alone: every floor, connection and zone, traced images
// included, and the subjects its rooms use.
export function writeBuildingFile(project, options) {
  const images = options && options.images;
  const used = new Set(allRooms(project).map((room) => room.subjectId));
  return stringify({
    format: BUILDING_FORMAT,
    version: BUILDING_VERSION,
    building: withImages(project.building, images),
    subjects: project.subjects.filter((subject) => used.has(subject.id)),
  });
}

export function readBuildingFile(text) {
  const value = parseJson(text);
  header(value, BUILDING_FORMAT, BUILDING_VERSION, NOT_A_BUILDING_MESSAGE);
  const findings = [];
  if (!isObject(value.building)) findings.push({ path: 'building', message: 'A building file holds a building.' });
  if (value.subjects !== undefined && !Array.isArray(value.subjects)) findings.push({ path: 'subjects', message: 'The subjects are a list.' });
  if (findings.length > 0) throw new FileError(invalidMessage('building', findings), 'invalid', findings);

  const taken = withoutImages(value.building);
  findings.push(...taken.findings);
  const subjects = value.subjects || [];
  const known = new Set(subjects.filter(isObject).map((subject) => subject.id));

  // The rooms' teachers belong to the project the file came from. They are
  // checked for shape here and matched to this project's teachers on import.
  const bare = !Array.isArray(taken.building.floors) ? taken.building : {
    ...taken.building,
    floors: taken.building.floors.map((floor, f) => {
      if (!isObject(floor) || !Array.isArray(floor.spaces)) return floor;
      return {
        ...floor,
        spaces: floor.spaces.map((space, s) => {
          if (!isObject(space) || space.kind !== 'room') return space;
          const path = 'building.floors[' + f + '].spaces[' + s + ']';
          const teachersOk = Array.isArray(space.teacherIds) && space.teacherIds.every((id) => typeof id === 'string' && id !== '') && new Set(space.teacherIds).size === space.teacherIds.length;
          if (!teachersOk) findings.push({ path: path + '.teacherIds', message: 'The teachers of a room are a list of ids, each once.' });
          const subjectOk = space.subjectId === null || (typeof space.subjectId === 'string' && space.subjectId !== '');
          if (!subjectOk) findings.push({ path: path + '.subjectId', message: 'The subject of a room is an id or null.' });
          return { ...space, teacherIds: [], subjectId: known.has(space.subjectId) ? space.subjectId : null };
        }),
      };
    }),
  };
  findings.push(...validate(scaffold({ building: bare, subjects })));
  if (findings.length > 0) throw new FileError(invalidMessage('building', findings), 'invalid', findings);

  // An image is on hand exactly when the file carried its bytes.
  const building = {
    ...taken.building,
    floors: taken.building.floors.map((floor) => {
      if (!floor.image) return floor;
      const missing = !Object.prototype.hasOwnProperty.call(taken.images, floor.image.imageId);
      return missing === floor.image.missing ? floor : { ...floor, image: { ...floor.image, missing } };
    }),
  };
  const file = { format: BUILDING_FORMAT, version: value.version, building, subjects };
  return { file, images: taken.images, summary: summarise({ building, subjects }) };
}

// The building part of a project file already read, as readBuildingFile
// would return it from writeBuildingFile(read.project, { images: read.images }),
// without the round trip: the same subject filter (only the subjects rooms
// use) and the same `missing` rewrite (an image is on hand exactly when
// `read.images` holds its bytes). `images` holds the bytes of the images the
// building refers to, in the shape keepFileImages takes.
export function buildingPart(read) {
  const project = read.project;
  const held = read.images || {};
  const images = {};
  const building = {
    ...project.building,
    floors: project.building.floors.map((floor) => {
      if (!floor.image) return floor;
      const present = Object.prototype.hasOwnProperty.call(held, floor.image.imageId);
      if (present) images[floor.image.imageId] = held[floor.image.imageId];
      const missing = !present;
      return missing === floor.image.missing ? floor : { ...floor, image: { ...floor.image, missing } };
    }),
  };
  const used = new Set(allRooms(project).map((room) => room.subjectId));
  const subjects = project.subjects.filter((subject) => used.has(subject.id));
  const file = { format: BUILDING_FORMAT, version: BUILDING_VERSION, building, subjects };
  return { file, images, summary: summarise({ building, subjects }) };
}

function sameSubject(a, b) {
  return nameKey(a.code) === nameKey(b.code) && nameKey(a.name) === nameKey(b.name);
}

function reserve(ids, list) {
  if (ids && typeof ids.reserve === 'function') ids.reserve(list);
}

function keepOrMake(id, prefix, taken, ids) {
  const kept = isId(id, prefix) && !taken.has(id) ? id : ids(prefix);
  taken.add(kept);
  return kept;
}

// Rooms by number, for matching. A room with no number matches nothing.
function roomsByNumber(rooms) {
  const byNumber = new Map();
  for (const room of rooms) {
    const key = roomNumberKey(room.number);
    if (key !== '' && !byNumber.has(key)) byNumber.set(key, room);
  }
  return byNumber;
}

// What the project would be with the file's building in place of its own.
// `file` is what readBuildingFile returned. The rules:
// - The building is replaced whole; the file's ids are kept.
// - A room keeps the teachers it lists who are teachers of this project,
//   and every teacher's rooms are worked out again from the rooms.
// - A room's subject is matched to this project's by id, then by code and
//   name; a subject the project does not have is added.
// - A schedule slot stays with its room when the new building has a room of
//   the same id; otherwise it goes to the room with the same number;
//   otherwise it keeps the number as text and reads "not in the building".
//   A slot already holding only a number is given the room with that number.
// options: { ids, unnumberedText }, the text for a slot whose old room had no
// number.
export function applyBuilding(project, file, options) {
  const ids = options.ids;
  const incoming = file.building;
  const taken = new Set(collectIds({ ...project, building: incoming }));
  reserve(ids, taken);

  // subjects
  const subjectMap = new Map();
  let subjects = project.subjects;
  const added = [];
  const used = new Set(allRooms({ building: incoming }).map((room) => room.subjectId));
  for (const subject of file.subjects) {
    if (!used.has(subject.id)) continue;
    const match = project.subjects.find((candidate) => candidate.id === subject.id) || subjects.find((candidate) => sameSubject(candidate, subject));
    if (match) {
      subjectMap.set(subject.id, match.id);
      continue;
    }
    const id = keepOrMake(subject.id, 's', taken, ids);
    subjects = subjects.concat([{ id, code: subject.code, name: subject.name, colour: subject.colour }]);
    subjectMap.set(subject.id, id);
    added.push(subject.name);
  }
  for (const subject of project.subjects) if (!subjectMap.has(subject.id)) subjectMap.set(subject.id, subject.id);

  // rooms
  const teacherIds = new Set(project.teachers.map((teacher) => teacher.id));
  const building = {
    ...incoming,
    floors: incoming.floors.map((floor) => ({
      ...floor,
      spaces: floor.spaces.map((space) => {
        if (space.kind !== 'room') return space;
        return { ...space, teacherIds: space.teacherIds.filter((id) => teacherIds.has(id)), subjectId: subjectMap.has(space.subjectId) ? subjectMap.get(space.subjectId) : null };
      }),
    })),
  };
  const newRooms = allRooms({ building });
  const newById = new Map(newRooms.map((room) => [room.id, room]));
  const newByNumber = roomsByNumber(newRooms);
  const oldById = new Map(allRooms(project).map((room) => [room.id, room]));

  // teachers
  const teachers = project.teachers.map((teacher) => {
    const listed = newRooms.filter((room) => room.teacherIds.includes(teacher.id)).map((room) => room.id);
    const roomIds = teacher.roomIds.filter((id) => listed.includes(id)).concat(listed.filter((id) => !teacher.roomIds.includes(id)));
    const same = roomIds.length === teacher.roomIds.length && roomIds.every((id, i) => id === teacher.roomIds[i]);
    return same ? teacher : { ...teacher, roomIds };
  });

  // slots
  const summary = { ...summarise({ building, subjects: [] }), subjectsAdded: added, slotsKept: 0, slotsMoved: 0, slotsLost: 0, lostRooms: [] };
  delete summary.subjects;
  delete summary.teachers;
  delete summary.groups;
  delete summary.dayTypes;
  const lost = new Set();
  const groups = project.groups.map((group) => {
    const days = {};
    for (const dayTypeId of Object.keys(group.days)) {
      days[dayTypeId] = group.days[dayTypeId].map((slot) => {
        if (slot.room !== null) {
          if (newById.has(slot.room)) {
            summary.slotsKept += 1;
            return slot;
          }
          const old = oldById.get(slot.room);
          const number = old ? old.number : '';
          const match = newByNumber.get(roomNumberKey(number));
          if (match) {
            summary.slotsMoved += 1;
            return { ...slot, room: match.id, roomText: '' };
          }
          summary.slotsLost += 1;
          const text = number.trim() === '' ? options.unnumberedText : number;
          lost.add(text);
          return { ...slot, room: null, roomText: text };
        }
        const match = newByNumber.get(roomNumberKey(slot.roomText));
        if (!match) return slot;
        summary.slotsMoved += 1;
        return { ...slot, room: match.id, roomText: '' };
      });
    }
    return { ...group, days };
  });
  summary.lostRooms = Array.from(lost);

  const next = { ...project, building, subjects, teachers, groups };
  const findings = validate(next);
  if (findings.length > 0) throw new FileError(invalidMessage('building', findings), 'invalid', findings);
  return { project: next, summary };
}

// ---------------------------------------------------------------- the schedule file

// The schedule alone: the school day's settings, subjects, teachers, groups
// and day types, the bell schedules and the calendar when the project has
// them, and an index of the rooms they name, so the file can be read against
// a building whose rooms have other ids. A project with no bell schedules
// and no calendar writes the file exactly as before they existed. The same
// holds for the marked periods and the duties (ARCHITECTURE 17.5, 17.6): a
// duty's room is in the index of rooms, so the file can be read against a
// building whose rooms have other ids. The staggered dismissals (18.2) are
// written only when the project has some, so an older project's file is
// byte-identical.
function scheduleFileObject(project) {
  const named = new Set();
  for (const teacher of project.teachers) for (const roomId of teacher.roomIds) named.add(roomId);
  for (const group of project.groups) {
    for (const dayTypeId of Object.keys(group.days)) for (const slot of group.days[dayTypeId]) if (slot.room !== null) named.add(slot.room);
  }
  const marks = marksOf(project);
  const duties = dutiesOf(project);
  const release = releaseOf(project);
  for (const duty of duties) if (typeof duty.roomId === 'string') named.add(duty.roomId);
  const settings = {};
  for (const key of SCHEDULE_SETTINGS) settings[key] = project.settings[key];
  const file = {
    format: SCHEDULE_FORMAT,
    version: SCHEDULE_VERSION,
    settings,
    rooms: allRooms(project).filter((room) => named.has(room.id)).map((room) => ({ id: room.id, number: room.number })),
    subjects: project.subjects,
    teachers: project.teachers,
    groups: project.groups,
    dayTypes: project.dayTypes,
  };
  const schedules = bellSchedulesOf(project);
  if (schedules.length > 0) file.bellSchedules = schedules;
  const calendar = calendarOf(project);
  if (calendar !== null) file.calendar = calendar;
  if (marks.length > 0) file.marks = marks;
  if (duties.length > 0) file.duties = duties;
  if (release.length > 0) file.release = release;
  return file;
}

export function writeScheduleFile(project) {
  return stringify(scheduleFileObject(project));
}

// The sentence's figures for a schedule file, as readScheduleFile reports them.
function scheduleSummary(file) {
  return { periods: file.settings.periods, subjects: file.subjects.length, teachers: file.teachers.length, groups: file.groups.length, dayTypes: file.dayTypes.length, bellSchedules: file.bellSchedules.length, calendar: file.calendar !== null, marks: file.marks.length, duties: file.duties.length, release: file.release.length };
}

// The schedule part of a project, as readScheduleFile would return it from
// writeScheduleFile(project), without the round trip: what the file would
// hold, with what it leaves out when the project has none read as empty
// (bell schedules, marks, duties and dismissals as lists, the calendar as
// null). A project file already read is valid, so nothing here is checked again.
export function schedulePart(project) {
  const written = scheduleFileObject(project);
  const file = {
    format: SCHEDULE_FORMAT,
    version: SCHEDULE_VERSION,
    settings: written.settings,
    rooms: written.rooms,
    subjects: written.subjects,
    teachers: written.teachers,
    groups: written.groups,
    dayTypes: written.dayTypes,
    bellSchedules: written.bellSchedules === undefined ? [] : written.bellSchedules,
    calendar: written.calendar === undefined ? null : written.calendar,
    marks: written.marks === undefined ? [] : written.marks,
    duties: written.duties === undefined ? [] : written.duties,
    release: written.release === undefined ? [] : written.release,
  };
  return { file, summary: scheduleSummary(file) };
}

const SCAFFOLD_WIDTH = 200;

export function readScheduleFile(text) {
  const value = parseJson(text);
  header(value, SCHEDULE_FORMAT, SCHEDULE_VERSION, NOT_A_SCHEDULE_MESSAGE);
  const findings = [];
  if (!isObject(value.settings)) findings.push({ path: 'settings', message: 'A schedule file holds the settings of the school day.' });
  else for (const key of SCHEDULE_SETTINGS) if (value.settings[key] === undefined) findings.push({ path: 'settings.' + key, message: 'This setting is missing.' });
  for (const key of ['rooms', 'subjects', 'teachers', 'groups', 'dayTypes']) {
    if (!Array.isArray(value[key])) findings.push({ path: key, message: 'A schedule file holds a list here.' });
  }
  if (findings.length === 0) {
    value.rooms.forEach((room, index) => {
      if (!isObject(room) || typeof room.id !== 'string' || room.id === '' || typeof room.number !== 'string') findings.push({ path: 'rooms[' + index + ']', message: 'A room in the index is { id, number }.' });
    });
  }
  if (findings.length > 0) throw new FileError(invalidMessage('schedule', findings), 'invalid', findings);

  // Stand the schedule in a building of one-cell rooms, one per index entry.
  // The bell schedules and the calendar, when the file has them, are checked
  // there by the project's own rules.
  const count = value.rooms.length;
  const width = Math.max(5, Math.min(SCAFFOLD_WIDTH, count));
  const height = Math.max(5, Math.ceil(count / SCAFFOLD_WIDTH));
  const based = (roomId) => value.teachers.filter((teacher) => isObject(teacher) && Array.isArray(teacher.roomIds) && teacher.roomIds.includes(roomId)).map((teacher) => teacher.id);
  const floor = {
    id: 'fscaffold0',
    name: 'Floor 1',
    level: 1,
    width,
    height,
    cells: '.'.repeat(width * height),
    spaces: value.rooms.map((room, index) => ({ id: room.id, kind: 'room', cells: [index], number: room.number, teacherIds: based(room.id), subjectId: null, wing: '', capacity: null, shared: false, doors: [] })),
    corridors: [],
    exits: [],
    image: null,
  };
  const settings = { ...defaultSettings() };
  for (const key of SCHEDULE_SETTINGS) settings[key] = value.settings[key];
  const stood = scaffold({ settings, building: { floors: [floor], connections: [], zones: [] }, subjects: value.subjects, teachers: value.teachers, groups: value.groups, dayTypes: value.dayTypes });
  if (value.bellSchedules !== undefined) stood.bellSchedules = value.bellSchedules;
  if (value.calendar !== undefined) stood.calendar = value.calendar;
  if (value.marks !== undefined) stood.marks = value.marks;
  if (value.duties !== undefined) stood.duties = value.duties;
  if (value.release !== undefined) stood.release = value.release;
  for (const finding of validate(stood)) {
    findings.push({ path: finding.path.replace(/^building\.floors\[0\]\.spaces\[(\d+)\]/, 'rooms[$1]'), message: finding.message });
  }
  if (findings.length > 0) throw new FileError(invalidMessage('schedule', findings), 'invalid', findings);

  // Absent is none: a file written before bell schedules and the calendar
  // reads as one with neither.
  const bellSchedules = value.bellSchedules === undefined ? [] : value.bellSchedules;
  const calendar = value.calendar === undefined ? null : value.calendar;
  const marks = value.marks === undefined ? [] : value.marks;
  const duties = value.duties === undefined ? [] : value.duties;
  const release = value.release === undefined ? [] : value.release;
  const file = { format: SCHEDULE_FORMAT, version: value.version, settings: value.settings, rooms: value.rooms, subjects: value.subjects, teachers: value.teachers, groups: value.groups, dayTypes: value.dayTypes, bellSchedules, calendar, marks, duties, release };
  return { file, summary: scheduleSummary(file) };
}

function padTo(list, length, make) {
  if (list.length >= length) return list;
  const next = list.slice();
  while (next.length < length) next.push(make());
  return next;
}

function copySlot(slot) {
  return { room: slot.room, roomText: slot.roomText, label: slot.label, teacherIds: slot.teacherIds.slice() };
}

function copyBells(bells) {
  return bells.map((bell) => (bell === null ? null : { ...bell }));
}

// Is `short` free to be typed on one more item of `list`? Empty always is.
function shortFree(short, list) {
  if (typeof short !== 'string' || short === '') return true;
  const key = short.toLowerCase();
  return !list.some((item) => typeof item.short === 'string' && item.short !== '' && item.short.toLowerCase() === key);
}

// A day type in the order of its fields, with `sameAs` and `short` only when
// they are given (undefined leaves the field out, as a file written before
// them has it).
function dayTypeOf(id, name, own, sameAs, short, bells) {
  const dayType = { id, name, own };
  if (sameAs !== undefined) dayType.sameAs = sameAs;
  if (short !== undefined) dayType.short = short;
  dayType.bells = bells;
  return dayType;
}

// Fill each bell that is empty in `here` from `from`; `here` itself when
// there is nothing to fill.
function filledBells(here, from) {
  if (!here.some((bell, period) => bell === null && from[period])) return here;
  return here.map((bell, period) => (bell === null && from[period] ? { ...from[period] } : bell));
}

// The project with a longer school day: every day type's bells, every
// group's slots on every day type and every bell schedule padded to `periods`
// with empty ones. The project itself when `periods` is no more than it has,
// so a day is never shortened. applySchedule and applySettings both raise the
// day through this one helper.
export function raisePeriods(project, periods) {
  if (!Number.isInteger(periods) || periods <= project.settings.periods) return project;
  let next = {
    ...project,
    settings: { ...project.settings, periods },
    dayTypes: project.dayTypes.map((dayType) => ({ ...dayType, bells: padTo(dayType.bells, periods, () => null) })),
    groups: project.groups.map((group) => {
      const days = {};
      for (const dayTypeId of Object.keys(group.days)) days[dayTypeId] = padTo(group.days[dayTypeId], periods, emptySlot);
      return { ...group, days };
    }),
  };
  if (Array.isArray(next.bellSchedules)) next = { ...next, bellSchedules: next.bellSchedules.map((schedule) => ({ ...schedule, bells: padTo(schedule.bells, periods, () => null) })) };
  return next;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What the project would be with the file's schedule brought into it. `file`
// is what readScheduleFile returned. The rules:
// - Subjects, teachers, day types and bell schedules are matched to this
//   project's by id, then by name (a subject by code and name; a day type
//   whatever the capitals and the spaces at its ends, as before SV2-77; a bell
//   schedule whatever the capitals and any spaces). One that matches is
//   left as it is here. One that does not is added, with the file's id when
//   that id is free, and with its typed short name when no other has it.
// - A room is matched by id, then by number. A slot whose room is not in
//   this building keeps the number as text; a teacher's room that is not in
//   this building is left off the teacher.
// - Groups are matched by name, and a clash is answered by `policy`, as for
//   a CSV import: skip, overwrite (the group here keeps its id), or import
//   under a new name.
// - A school day in the file longer than the one here makes the day here
//   longer. A shorter one leaves the later periods as they are.
// - A bell time already entered here is never changed; one that is empty
//   here is filled from the file, for day types and bell schedules alike.
// - A day type that is "same as" here and has classes or bells of its own in
//   the file (or, in the file, is the same as another day type than here)
//   becomes its own copy here, starting as a copy of what it was the same as
//   here (not of the first day type). A day type the file adds as "same as"
//   is the same as the day type its own one matched. A file in which no day
//   type has `sameAs` (one written before it) is read as it was then: a day
//   type it adds is its own copy when the file's first day type is not this
//   project's first, and no `sameAs` is written for it.
// - The calendar, when the file has one, replaces this project's, with every
//   day type and bell schedule it names re-pointed through the matches above.
//   A reference that matches nothing is dropped and counted.
// - Marks and duties are matched by id, and a clash is answered by `policy`
//   as a group's is (`all`, or `per[id]` for one): skip leaves the one here as
//   it is, overwrite replaces it in place with the file's (same id), rename
//   adds the file's under a new id. The summary counts those kept and those
//   replaced. One that is not here is added (with the file's id when it is
//   free), and every
//   reference in it is re-pointed through the matches above (groups by name,
//   as the groups are, rooms as a slot's are). A reference that matches
//   nothing is dropped and counted: only a duty's room can fail to match,
//   since every day type, group, teacher and subject of the file is matched
//   or added. A duty whose room is not in this building keeps its number as
//   its place.
// - Staggered dismissals (ARCHITECTURE 18.2) are matched by id and answered
//   by `policy` as marks are. A groups entry's groups are re-pointed through
//   the groups' matches and its day types through the day types'; one left
//   naming no group, or no day type, is dropped and counted in
//   `releaseDropped`. The summary counts `releaseAdded`, `releaseKept` and
//   `releaseReplaced`. A file that would bring the project past RELEASE_MOST
//   is refused whole.
// - The period word and the two defaults are taken only when `takeSettings`
//   is true.
// - At most DAY_TYPES_MOST day types and BELL_SCHEDULES_MOST bell schedules:
//   a file that would bring more is refused whole.
// options: { policy, takeSettings, ids, clock }. `clock`, when given, stamps
// a replaced calendar's changedAt, so the publish form knows staff copies
// have the old one; without it the file's changedAt is kept.
export function applySchedule(project, file, options) {
  const ids = options.ids;
  const summary = { subjectsAdded: [], teachersAdded: [], dayTypesAdded: [], bellSchedulesAdded: [], madeOwn: [], periodsRaised: null, settingsTaken: [], unknownRooms: [], roomsLeftOff: 0, calendarReplaced: false, referencesDropped: 0, marksAdded: 0, dutiesAdded: 0, marksKept: 0, marksReplaced: 0, dutiesKept: 0, dutiesReplaced: 0, releaseAdded: 0, releaseKept: 0, releaseReplaced: 0, releaseDropped: 0 };
  const fileSchedules = Array.isArray(file.bellSchedules) ? file.bellSchedules : [];
  const fileCalendar = isObject(file.calendar) ? file.calendar : null;
  const fileMarks = Array.isArray(file.marks) ? file.marks : [];
  const fileDuties = Array.isArray(file.duties) ? file.duties : [];
  const fileRelease = Array.isArray(file.release) ? file.release : [];
  const taken = new Set(collectIds(project));
  reserve(ids, collectIds({ subjects: file.subjects, teachers: file.teachers, groups: file.groups, dayTypes: file.dayTypes, bellSchedules: fileSchedules, marks: fileMarks, duties: fileDuties, release: fileRelease }));
  let next = project;

  // the school day
  const periods = Math.max(project.settings.periods, file.settings.periods);
  if (periods > project.settings.periods) {
    summary.periodsRaised = { from: project.settings.periods, to: periods };
    next = raisePeriods(next, periods);
  }
  if (options.takeSettings) {
    for (const key of SCHEDULE_SETTINGS) {
      if (key === 'periods' || next.settings[key] === file.settings[key]) continue;
      next = { ...next, settings: { ...next.settings, [key]: file.settings[key] } };
      summary.settingsTaken.push(key);
    }
  }

  // subjects
  const subjectMap = new Map();
  for (const subject of file.subjects) {
    const match = project.subjects.find((candidate) => candidate.id === subject.id) || next.subjects.find((candidate) => sameSubject(candidate, subject));
    if (match) {
      subjectMap.set(subject.id, match.id);
      continue;
    }
    const id = keepOrMake(subject.id, 's', taken, ids);
    next = { ...next, subjects: next.subjects.concat([{ id, code: subject.code, name: subject.name, colour: subject.colour }]) };
    subjectMap.set(subject.id, id);
    summary.subjectsAdded.push(subject.name);
  }

  // rooms
  const numberOf = new Map(file.rooms.map((room) => [room.id, room.number]));
  const byNumber = roomsByNumber(allRooms(project));
  const resolveRoom = (roomId) => {
    const same = findRoom(project, roomId);
    if (same) return same.id;
    const match = byNumber.get(roomNumberKey(numberOf.get(roomId) || ''));
    return match ? match.id : null;
  };
  const unknown = new Set();

  // teachers
  const teacherMap = new Map();
  const homes = new Map();
  for (const teacher of file.teachers) {
    const match = project.teachers.find((candidate) => candidate.id === teacher.id) || next.teachers.find((candidate) => nameKey(candidate.name) === nameKey(teacher.name));
    if (match) {
      teacherMap.set(teacher.id, match.id);
      continue;
    }
    const id = keepOrMake(teacher.id, 't', taken, ids);
    const roomIds = [];
    for (const roomId of teacher.roomIds) {
      const resolved = resolveRoom(roomId);
      if (resolved === null) summary.roomsLeftOff += 1;
      else if (!roomIds.includes(resolved)) roomIds.push(resolved);
    }
    next = { ...next, teachers: next.teachers.concat([{ id, name: teacher.name, subjectId: teacher.subjectId === null ? null : subjectMap.get(teacher.subjectId) || null, roomIds, notes: teacher.notes }]) };
    for (const roomId of roomIds) homes.set(roomId, (homes.get(roomId) || []).concat([id]));
    teacherMap.set(teacher.id, id);
    summary.teachersAdded.push(teacher.name);
  }
  if (homes.size > 0) {
    next = {
      ...next,
      building: {
        ...next.building,
        floors: next.building.floors.map((floor) => (floor.spaces.some((space) => homes.has(space.id)) ? { ...floor, spaces: floor.spaces.map((space) => (homes.has(space.id) ? { ...space, teacherIds: space.teacherIds.concat(homes.get(space.id)) } : space)) } : floor)),
      },
    };
  }

  // day types. In the file, as here, a day type that is not its own copy is
  // answered from what it is the same as: day-types.js says which.
  const inFile = { dayTypes: file.dayTypes };
  const fileOwn = (dayType) => isOwnCopy(inFile, dayType.id);
  const fileSource = (dayType) => effectiveDayType(inFile, dayType.id);
  const fileDay = (group, dayType) => group.days[fileSource(dayType).id];
  const hasData = (dayType) => fileSource(dayType).bells.some((bell) => bell !== null) || file.groups.some((group) => fileDay(group, dayType).some((slot) => slot.room !== null || slot.roomText !== ''));
  // A file written before "same as" could name a day type (no day type in
  // it has `sameAs`) is read exactly as it was then: an added day type is its
  // own copy when it is in the file or when the two first day types do not
  // match, so no `sameAs` is written into the project for it.
  const fileHasSameAs = file.dayTypes.some((dayType) => dayType.sameAs !== undefined);
  const dayMap = new Map();
  const added = new Set();
  for (const dayType of file.dayTypes) {
    const match = project.dayTypes.find((candidate) => candidate.id === dayType.id) || next.dayTypes.find((candidate) => nameKey(candidate.name) === nameKey(dayType.name));
    if (match) dayMap.set(dayType.id, match.id);
  }
  const basesAgree = dayMap.get(file.dayTypes[0].id) === project.dayTypes[0].id;
  for (const dayType of file.dayTypes) {
    if (dayMap.has(dayType.id)) continue;
    const id = keepOrMake(dayType.id, 'd', taken, ids);
    const own = fileOwn(dayType) || (!fileHasSameAs && !basesAgree);
    // a "same as" day type's sameAs is set below, once every day type is here
    const sameAs = dayType.sameAs === undefined ? undefined : null;
    const short = dayType.short === undefined ? undefined : shortFree(dayType.short, next.dayTypes) ? dayType.short : '';
    const base = next.dayTypes[0];
    next = {
      ...next,
      dayTypes: next.dayTypes.concat([dayTypeOf(id, dayType.name, own, sameAs, short, own ? padTo(copyBells(fileSource(dayType).bells), periods, () => null) : emptyBells(periods))]),
      groups: own ? next.groups.map((group) => ({ ...group, days: { ...group.days, [id]: group.days[base.id].map(copySlot) } })) : next.groups,
    };
    dayMap.set(dayType.id, id);
    added.add(id);
    summary.dayTypesAdded.push(dayType.name);
  }
  if (next.dayTypes.length > Math.max(DAY_TYPES_MOST, project.dayTypes.length)) {
    throw new FileError('This schedule file cannot be imported, and nothing was changed. It would bring the project to ' + next.dayTypes.length + ' day types, and a project has at most ' + DAY_TYPES_MOST + '. Delete the day types you do not need, here or in the file, and import it again.', 'too-many-day-types');
  }
  // A day type that is "same as" here becomes its own copy when the file
  // gives it classes or bells of its own, or makes it the same as another
  // day type than here. It starts as a copy of what it was the same as here;
  // the file's groups then fill it. Own day types in the file first, so a
  // "same as" in the file can follow one made own here.
  const promote = (id) => {
    const from = effectiveDayType(next, id);
    next = {
      ...next,
      dayTypes: next.dayTypes.map((candidate) => {
        if (candidate.id !== id) return candidate;
        return dayTypeOf(candidate.id, candidate.name, true, candidate.sameAs === undefined ? undefined : null, candidate.short, copyBells(from.bells));
      }),
      groups: next.groups.map((group) => ({ ...group, days: { ...group.days, [id]: (group.days[from.id] || emptyDay(periods)).map(copySlot) } })),
    };
  };
  for (const pass of [true, false]) {
    for (const dayType of file.dayTypes) {
      if (fileOwn(dayType) !== pass) continue;
      const id = dayMap.get(dayType.id);
      if (added.has(id) || isOwnCopy(next, id)) continue;
      const differs = fileOwn(dayType) || (fileHasSameAs ? effectiveDayType(next, dayMap.get(fileSource(dayType).id)).id !== effectiveDayType(next, id).id : !basesAgree);
      if (!differs || !hasData(dayType)) continue;
      promote(id);
      summary.madeOwn.push(findDayType(next, id).name);
    }
  }
  // A day type the file adds as "same as" is the same as the day type here
  // that its own one in the file matched (null for the first).
  for (const dayType of file.dayTypes) {
    const id = dayMap.get(dayType.id);
    if (!added.has(id) || isOwnCopy(next, id)) continue;
    const target = effectiveDayType(next, dayMap.get(fileSource(dayType).id));
    const sameAs = target === next.dayTypes[0] ? null : target.id;
    next = { ...next, dayTypes: next.dayTypes.map((candidate) => (candidate.id === id ? dayTypeOf(id, candidate.name, false, candidate.sameAs === undefined && sameAs === null ? undefined : sameAs, candidate.short, candidate.bells) : candidate)) };
  }
  // bells: fill what is empty here
  for (const dayType of file.dayTypes) {
    const id = dayMap.get(dayType.id);
    if (!isOwnCopy(next, id)) continue;
    const here = findDayType(next, id);
    const bells = filledBells(here.bells, fileSource(dayType).bells);
    if (bells !== here.bells) next = { ...next, dayTypes: next.dayTypes.map((candidate) => (candidate === here ? { ...here, bells } : candidate)) };
  }

  // bell schedules: matched as day types are; an empty bell here is filled
  const bellMap = new Map();
  const schedulesHere = bellSchedulesOf(project);
  const schedulesBefore = bellSchedulesOf(next);
  let schedules = schedulesBefore;
  for (const schedule of fileSchedules) {
    const match = schedulesHere.find((candidate) => candidate.id === schedule.id) || schedules.find((candidate) => spacelessKey(candidate.name) === spacelessKey(schedule.name));
    if (match) {
      bellMap.set(schedule.id, match.id);
      const current = schedules.find((candidate) => candidate.id === match.id);
      const bells = filledBells(current.bells, schedule.bells);
      if (bells !== current.bells) schedules = schedules.map((candidate) => (candidate === current ? { ...current, bells } : candidate));
      continue;
    }
    const id = keepOrMake(schedule.id, 'b', taken, ids);
    const short = shortFree(schedule.short, schedules) ? schedule.short : '';
    schedules = schedules.concat([{ id, name: schedule.name, short, bells: padTo(copyBells(schedule.bells), periods, () => null), off: schedule.off.slice() }]);
    bellMap.set(schedule.id, id);
    summary.bellSchedulesAdded.push(schedule.name);
  }
  if (schedules.length > Math.max(BELL_SCHEDULES_MOST, schedulesHere.length)) {
    throw new FileError('This schedule file cannot be imported, and nothing was changed. It would bring the project to ' + schedules.length + ' bell schedules, and a project has at most ' + BELL_SCHEDULES_MOST + '. Delete the bell schedules you do not need, here or in the file, and import it again.', 'too-many-bell-schedules');
  }
  if (schedules !== schedulesBefore) next = { ...next, bellSchedules: schedules };

  // the calendar: the file's replaces this one, re-pointed
  if (fileCalendar !== null) {
    const dayRef = (value) => (value === null || value === DAY_ROTATION || value === DAY_CLOSED ? value : dayMap.get(value));
    const bellsRef = (value) => (value === null || value === BELLS_REGULAR ? value : bellMap.get(value));
    const dropped = (value) => {
      if (value === undefined) summary.referencesDropped += 1;
      return value === undefined;
    };
    const weekdays = fileCalendar.weekdays.map((rule) => {
      const day = dayRef(rule.day);
      const bells = bellsRef(rule.bells);
      return { day: dropped(day) ? DAY_ROTATION : day, bells: dropped(bells) ? null : bells };
    });
    let rotation = fileCalendar.rotation.map(dayRef).filter((id) => !dropped(id));
    if (rotation.length === 0) rotation = [next.dayTypes[0].id];
    const dates = [];
    for (const entry of fileCalendar.dates) {
      const day = dayRef(entry.day);
      if (dropped(day)) continue;
      const bells = bellsRef(entry.bells);
      dates.push({ date: entry.date, day, bells: dropped(bells) ? null : bells, label: entry.label });
    }
    const calendar = { start: fileCalendar.start, end: fileCalendar.end, weekdays, rotation, dates, changedAt: fileCalendar.changedAt };
    const here = calendarOf(next);
    const unchanged = here !== null && sameJson({ ...here, changedAt: null }, { ...calendar, changedAt: null });
    if (!unchanged) {
      if (typeof options.clock === 'function') calendar.changedAt = options.clock().toISOString();
      next = { ...next, calendar };
      summary.calendarReplaced = true;
    }
  }

  // groups
  const incoming = file.groups.map((group) => {
    const days = {};
    for (const dayType of file.dayTypes) {
      const id = dayMap.get(dayType.id);
      if (!isOwnCopy(next, id)) continue;
      if (days[id] !== undefined && !fileOwn(dayType)) continue;
      days[id] = fileDay(group, dayType).map((slot) => {
        let room = slot.room === null ? null : resolveRoom(slot.room);
        let roomText = '';
        if (room === null) {
          const text = slot.room === null ? slot.roomText : numberOf.get(slot.room) || '';
          const match = byNumber.get(roomNumberKey(text));
          if (match) room = match.id;
          else roomText = text;
          if (!match && roomNumberKey(text) !== '') unknown.add(text);
        }
        const teacherIds = [];
        for (const teacherId of slot.teacherIds) {
          const mapped = teacherMap.get(teacherId);
          if (mapped !== undefined && !teacherIds.includes(mapped)) teacherIds.push(mapped);
        }
        return { room, roomText, label: slot.label, teacherIds };
      });
    }
    return { key: nameKey(group.name), name: group.name, id: group.id, fields: group.stepFree === true ? { grade: group.grade, headCount: group.headCount, colour: group.colour, stepFree: true } : { grade: group.grade, headCount: group.headCount, colour: group.colour }, days };
  });
  const merged = mergeGroups(next, incoming, options.policy, ids);
  const madeOwn = summary.madeOwn.concat(merged.summary.madeOwn);
  Object.assign(summary, merged.summary);
  summary.madeOwn = madeOwn;
  summary.unknownRooms = Array.from(unknown);

  let result = merged.project;

  // marks and duties, now that every group is here: matched by id, otherwise
  // added, with their references re-pointed
  if (fileMarks.length > 0 || fileDuties.length > 0 || fileRelease.length > 0) {
    const groupMap = new Map();
    for (const group of file.groups) {
      const renamed = merged.summary.renamed.find((entry) => entry.from === group.name);
      const found = result.groups.find((candidate) => nameKey(candidate.name) === nameKey(renamed ? renamed.to : group.name));
      if (found) groupMap.set(group.id, found.id);
    }
    // a list of ids through a map: the ids that matched, each once
    const through = (list, map) => {
      const out = [];
      for (const id of list) {
        const mapped = map.get(id);
        if (mapped === undefined) summary.referencesDropped += 1;
        else if (!out.includes(mapped)) out.push(mapped);
      }
      return out;
    };
    // a clash on an id is answered as a group's name is: `per[id]`, else `all`, else skip
    const answer = (id) => {
      const policy = options.policy;
      const per = policy && policy.per && Object.prototype.hasOwnProperty.call(policy.per, id) ? policy.per[id] : undefined;
      const chosen = per === undefined ? (policy && policy.all !== undefined ? policy.all : 'skip') : per;
      if (!CLASH_POLICIES.includes(chosen)) throw new ImportError('A name clash is answered with one of: ' + CLASH_POLICIES.join(', ') + '.', 'bad-policy');
      return chosen;
    };
    let marksHere = marksOf(result);
    const addedMarks = [];
    let changedMarks = false;
    for (const mark of fileMarks) {
      const clash = marksHere.findIndex((candidate) => candidate.id === mark.id);
      const pointed = { ...mark, dayTypeIds: through(mark.dayTypeIds, dayMap), groupIds: through(mark.groupIds, groupMap) };
      if (clash >= 0) {
        const choice = answer(mark.id);
        if (choice === 'skip' || sameJson(marksHere[clash], pointed)) {
          summary.marksKept += 1;
          continue;
        }
        if (choice === 'overwrite') {
          marksHere = marksHere.slice();
          marksHere[clash] = pointed;
          changedMarks = true;
          summary.marksReplaced += 1;
          continue;
        }
      }
      addedMarks.push({ ...pointed, id: keepOrMake(mark.id, 'm', taken, ids) });
    }
    let dutiesHere = dutiesOf(result);
    const addedDuties = [];
    let changedDuties = false;
    for (const duty of fileDuties) {
      const clash = dutiesHere.findIndex((candidate) => candidate.id === duty.id);
      let choice = 'add';
      if (clash >= 0) {
        choice = answer(duty.id);
        if (choice === 'skip') {
          summary.dutiesKept += 1;
          continue;
        }
      }
      let roomId = null;
      let place = duty.place;
      if (duty.roomId !== null) {
        roomId = resolveRoom(duty.roomId);
        if (roomId === null) {
          summary.referencesDropped += 1;
          if (place === '') place = numberOf.get(duty.roomId) || '';
        }
      }
      const pointed = { ...duty, dayTypeIds: through(duty.dayTypeIds, dayMap), roomId, place, teacherIds: through(duty.teacherIds, teacherMap), subjectIds: through(duty.subjectIds, subjectMap) };
      if (clash >= 0 && sameJson(dutiesHere[clash], pointed)) {
        summary.dutiesKept += 1;
        continue;
      }
      if (choice === 'overwrite') {
        dutiesHere = dutiesHere.slice();
        dutiesHere[clash] = pointed;
        changedDuties = true;
        summary.dutiesReplaced += 1;
        continue;
      }
      addedDuties.push({ ...pointed, id: keepOrMake(duty.id, 'u', taken, ids) });
    }
    if (addedMarks.length > 0 || changedMarks) result = { ...result, marks: marksHere.concat(addedMarks) };
    if (addedDuties.length > 0 || changedDuties) result = { ...result, duties: dutiesHere.concat(addedDuties) };
    summary.marksAdded = addedMarks.length;
    summary.dutiesAdded = addedDuties.length;

    // staggered dismissals, matched by id as marks are
    let releaseHere = releaseOf(result);
    const addedRelease = [];
    let changedRelease = false;
    for (const entry of fileRelease) {
      const groups = Array.isArray(entry.who.groups) ? through(entry.who.groups, groupMap) : null;
      const days = Array.isArray(entry.dayTypeIds) ? through(entry.dayTypeIds, dayMap) : null;
      if ((groups !== null && groups.length === 0) || (days !== null && days.length === 0)) {
        summary.releaseDropped += 1;
        continue;
      }
      const pointed = { ...entry, who: groups === null ? entry.who : { groups }, dayTypeIds: days };
      const clash = releaseHere.findIndex((candidate) => candidate.id === entry.id);
      if (clash >= 0) {
        const choice = answer(entry.id);
        if (choice === 'skip' || sameJson(releaseHere[clash], pointed)) {
          summary.releaseKept += 1;
          continue;
        }
        if (choice === 'overwrite') {
          releaseHere = releaseHere.slice();
          releaseHere[clash] = pointed;
          changedRelease = true;
          summary.releaseReplaced += 1;
          continue;
        }
      }
      addedRelease.push({ ...pointed, id: keepOrMake(entry.id, 'l', taken, ids) });
    }
    if (releaseHere.length + addedRelease.length > Math.max(RELEASE_MOST, releaseOf(project).length)) {
      throw new FileError('This schedule file cannot be imported, and nothing was changed. It would bring the project to ' + (releaseHere.length + addedRelease.length) + ' staggered dismissals, and a project has at most ' + RELEASE_MOST + '. Remove the ones you do not need, here or in the file, and import it again.', 'too-many-release');
    }
    if (addedRelease.length > 0 || changedRelease) result = { ...result, release: releaseHere.concat(addedRelease) };
    summary.releaseAdded = addedRelease.length;
  }

  if (result === project) return { project, summary };
  const findings = validate(result);
  if (findings.length > 0) throw new FileError(invalidMessage('schedule', findings), 'invalid', findings);
  return { project: result, summary };
}

// ---------------------------------------------------------------- the settings part

// What bringing in only the settings takes and leaves (ARCHITECTURE 21.10).
// Both lists name keys of defaultSettings(); applySettings walks that list,
// never the file's keys, and a test checks that these two cover it exactly.
// `schoolName` is taken only when this project's is blank. The theme and the
// paper belong to the device; the cell size, the walking and stair times
// belong to the building they were measured on. Settings kept only as
// optional extras (cellScale, the three elevator numbers) are not in
// defaultSettings(), so they are never walked, and so never taken.
export const SETTINGS_TAKEN = ['schoolName', 'periods', 'periodWord', 'defaultPassingSeconds', 'defaultHeadCount', 'colourScale', 'checks', 'timeFormat'];
export const SETTINGS_LEFT = ['secondsPerCell', 'secondsPerStair', 'paper', 'theme'];

// The project with the settings of a file's project brought in. `fileSettings`
// is the `settings` of a project file already read. Returns { project, summary }:
// `taken` lists { key, from, to } for each setting that changed (`periods`
// among them when raised); `periodsRaised` is { from, to } or null;
// `periodsStay` is { at, file } when the file has fewer periods than this
// project, which keeps its own (a day is never shortened). A key the file does
// not hold leaves the value here. `checks.off` keeps only the kinds this
// version knows. A file that changes nothing returns the project itself.
// Every key taken that the file does hold is checked first, whether or not it
// would change anything: one of the wrong type or out of range refuses the
// whole import ('invalid', naming the setting) before anything changes.
// `colourScale` is rebuilt as { mode, bands } and `checks` from its known
// keys, so a key of a future version is not carried; two values are "the
// same" when their contents are, whatever the order of their keys.
function badSetting(key, message) {
  const findings = [{ path: 'settings.' + key, message }];
  return new FileError(invalidMessage('settings', findings), 'invalid', findings);
}

const wholeIn = (value, range) => Number.isInteger(value) && value >= range[0] && value <= range[1];

function checkedSettings(project, fileSettings) {
  const out = {};
  for (const key of SETTINGS_TAKEN) {
    const value = fileSettings[key];
    if (value === undefined) continue;
    const here = project.settings[key];
    if (key === 'schoolName') {
      if (typeof value !== 'string') throw badSetting(key, 'The school name is text.');
      out[key] = value;
    } else if (key === 'periods') {
      if (!wholeIn(value, RANGES.periods)) throw badSetting(key, 'Periods per day is a whole number from ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + '.');
      out[key] = value;
    } else if (key === 'periodWord') {
      if (!PERIOD_WORDS.includes(value)) throw badSetting(key, 'The period word is one of: ' + PERIOD_WORDS.join(', ') + '.');
      out[key] = value;
    } else if (key === 'defaultPassingSeconds') {
      if (!wholeIn(value, RANGES.defaultPassingSeconds)) throw badSetting(key, 'The default passing time is a whole number of seconds from ' + RANGES.defaultPassingSeconds[0] + ' to ' + RANGES.defaultPassingSeconds[1] + '.');
      out[key] = value;
    } else if (key === 'defaultHeadCount') {
      if (!wholeIn(value, RANGES.headCount)) throw badSetting(key, 'The default head count is a whole number from ' + RANGES.headCount[0] + ' to ' + RANGES.headCount[1] + '.');
      out[key] = value;
    } else if (key === 'timeFormat') {
      if (!TIME_FORMATS.includes(value)) throw badSetting(key, 'The time format is one of: ' + TIME_FORMATS.join(', ') + '.');
      out[key] = value;
    } else if (key === 'colourScale') {
      if (!isObject(value)) throw badSetting(key, 'The colour scale is an object with a mode and four bands.');
      const own = isObject(here) ? here : defaultSettings().colourScale;
      const mode = value.mode === undefined ? own.mode : value.mode;
      const bands = value.bands === undefined ? own.bands : value.bands;
      if (!COLOUR_SCALE_MODES.includes(mode)) throw badSetting(key, 'The colour scale mode is one of: ' + COLOUR_SCALE_MODES.join(', ') + '.');
      if (!Array.isArray(bands) || bands.length !== 4 || !bands.every((band, i) => wholeIn(band, RANGES.colourBand) && (i === 0 || band > bands[i - 1]))) throw badSetting(key, 'The colour bands are four whole numbers, each larger than the one before.');
      out[key] = { mode, bands: bands.slice() };
    } else if (key === 'checks') {
      if (!isObject(value)) throw badSetting(key, 'The checks are an object with a limit, a margin and a list switched off.');
      const own = isObject(here) ? here : defaultSettings().checks;
      const checks = { consecutiveLimit: own.consecutiveLimit, passingMarginSeconds: own.passingMarginSeconds, off: Array.isArray(own.off) ? own.off.slice() : [] };
      if (value.consecutiveLimit !== undefined) {
        if (!wholeIn(value.consecutiveLimit, RANGES.consecutiveLimit)) throw badSetting(key, 'The consecutive-periods limit is a whole number from ' + RANGES.consecutiveLimit[0] + ' to ' + RANGES.consecutiveLimit[1] + '.');
        checks.consecutiveLimit = value.consecutiveLimit;
      }
      if (value.passingMarginSeconds !== undefined) {
        if (!wholeIn(value.passingMarginSeconds, RANGES.passingMarginSeconds)) throw badSetting(key, 'The passing margin is a whole number of seconds from ' + RANGES.passingMarginSeconds[0] + ' to ' + RANGES.passingMarginSeconds[1] + '.');
        checks.passingMarginSeconds = value.passingMarginSeconds;
      }
      if (value.off !== undefined) {
        if (!Array.isArray(value.off) || !value.off.every((kind) => typeof kind === 'string')) throw badSetting(key, 'The checks switched off are a list of check kinds.');
        checks.off = Array.from(new Set(value.off.filter((kind) => CHECK_KINDS.includes(kind))));
      }
      out[key] = checks;
    }
  }
  return out;
}

// The same contents, whatever the order of the keys of an object in it.
function sameContents(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameContents(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameContents(a[key], b[key]));
  }
  return a === b;
}

export function applySettings(project, fileSettings) {
  const summary = { taken: [], periodsRaised: null, periodsStay: null };
  if (!isObject(fileSettings)) throw new FileError(invalidMessage('settings', [{ path: 'settings', message: 'A project file holds settings.' }]), 'invalid', [{ path: 'settings', message: 'A project file holds settings.' }]);
  const given = checkedSettings(project, fileSettings);
  let next = project;
  for (const key of Object.keys(defaultSettings())) {
    if (!SETTINGS_TAKEN.includes(key)) continue;
    const value = given[key];
    if (value === undefined) continue;
    const here = project.settings[key];
    if (key === 'periods') {
      if (value > here) {
        next = raisePeriods(next, value);
        summary.periodsRaised = { from: here, to: value };
        summary.taken.push({ key, from: here, to: value });
      } else if (value < here) summary.periodsStay = { at: here, file: value };
      continue;
    }
    if (key === 'schoolName' && (typeof here !== 'string' || here.trim() !== '' || value.trim() === '')) continue;
    if (sameContents(value, here)) continue;
    next = { ...next, settings: { ...next.settings, [key]: value } };
    summary.taken.push({ key, from: here, to: value });
  }
  if (next !== project) {
    const findings = validate(next);
    if (findings.length > 0) throw new FileError(invalidMessage('settings', findings), 'invalid', findings);
  }
  return { project: next, summary };
}
