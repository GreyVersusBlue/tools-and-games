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
//   applySchedule(project, file, { policy, takeSettings, ids }) → { project, summary }
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

import { FORMAT, PUBLISHED_FORMAT, CURRENT_VERSION, defaultSettings, defaultPublish, defaultOnboarding, emptyBells, emptySlot, roomNumberKey, nameKey, allRooms, findRoom } from './schema.js';
import { DEFAULT_PASSCODE } from './publish-defaults.js';
import { migrate, MigrateError, versionOf, NEWER_VERSION_MESSAGE, NOT_A_PROJECT_MESSAGE } from './migrate.js';
import { repair } from './repair.js';
import { validate } from './validate.js';
import { collectIds, isId } from './ids.js';
import { mergeGroups } from './import-groups.js';

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
// and day types, and an index of the rooms they name, so the file can be read
// against a building whose rooms have other ids.
export function writeScheduleFile(project) {
  const named = new Set();
  for (const teacher of project.teachers) for (const roomId of teacher.roomIds) named.add(roomId);
  for (const group of project.groups) {
    for (const dayTypeId of Object.keys(group.days)) for (const slot of group.days[dayTypeId]) if (slot.room !== null) named.add(slot.room);
  }
  const settings = {};
  for (const key of SCHEDULE_SETTINGS) settings[key] = project.settings[key];
  return stringify({
    format: SCHEDULE_FORMAT,
    version: SCHEDULE_VERSION,
    settings,
    rooms: allRooms(project).filter((room) => named.has(room.id)).map((room) => ({ id: room.id, number: room.number })),
    subjects: project.subjects,
    teachers: project.teachers,
    groups: project.groups,
    dayTypes: project.dayTypes,
  });
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
  for (const finding of validate(stood)) {
    findings.push({ path: finding.path.replace(/^building\.floors\[0\]\.spaces\[(\d+)\]/, 'rooms[$1]'), message: finding.message });
  }
  if (findings.length > 0) throw new FileError(invalidMessage('schedule', findings), 'invalid', findings);

  const file = { format: SCHEDULE_FORMAT, version: value.version, settings: value.settings, rooms: value.rooms, subjects: value.subjects, teachers: value.teachers, groups: value.groups, dayTypes: value.dayTypes };
  return { file, summary: { periods: value.settings.periods, subjects: value.subjects.length, teachers: value.teachers.length, groups: value.groups.length, dayTypes: value.dayTypes.length } };
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

// What the project would be with the file's schedule brought into it. `file`
// is what readScheduleFile returned. The rules:
// - Subjects, teachers and day types are matched to this project's by id,
//   then by name (a subject by code and name). One that matches is left as
//   it is here. One that does not is added, with the file's id when that id
//   is free.
// - A room is matched by id, then by number. A slot whose room is not in
//   this building keeps the number as text; a teacher's room that is not in
//   this building is left off the teacher.
// - Groups are matched by name, and a clash is answered by `policy`, as for
//   a CSV import: skip, overwrite (the group here keeps its id), or import
//   under a new name.
// - A school day in the file longer than the one here makes the day here
//   longer. A shorter one leaves the later periods as they are.
// - A bell time already entered here is never changed; one that is empty
//   here is filled from the file.
// - The period word and the two defaults are taken only when `takeSettings`
//   is true.
// options: { policy, takeSettings, ids }.
export function applySchedule(project, file, options) {
  const ids = options.ids;
  const summary = { subjectsAdded: [], teachersAdded: [], dayTypesAdded: [], periodsRaised: null, settingsTaken: [], unknownRooms: [], roomsLeftOff: 0 };
  const taken = new Set(collectIds(project));
  reserve(ids, collectIds({ subjects: file.subjects, teachers: file.teachers, groups: file.groups, dayTypes: file.dayTypes }));
  let next = project;

  // the school day
  const periods = Math.max(project.settings.periods, file.settings.periods);
  if (periods > project.settings.periods) {
    summary.periodsRaised = { from: project.settings.periods, to: periods };
    next = {
      ...next,
      settings: { ...next.settings, periods },
      dayTypes: next.dayTypes.map((dayType) => ({ ...dayType, bells: padTo(dayType.bells, periods, () => null) })),
      groups: next.groups.map((group) => {
        const days = {};
        for (const dayTypeId of Object.keys(group.days)) days[dayTypeId] = padTo(group.days[dayTypeId], periods, emptySlot);
        return { ...group, days };
      }),
    };
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

  // day types
  const fileBase = file.dayTypes[0];
  const fileOwn = (dayType) => dayType === fileBase || dayType.own === true;
  const fileBells = (dayType) => (fileOwn(dayType) ? dayType.bells : fileBase.bells);
  const fileDay = (group, dayType) => group.days[fileOwn(dayType) ? dayType.id : fileBase.id];
  const hasRooms = (dayType) => file.groups.some((group) => fileDay(group, dayType).some((slot) => slot.room !== null || slot.roomText !== ''));
  const dayMap = new Map();
  for (const dayType of file.dayTypes) {
    const match = project.dayTypes.find((candidate) => candidate.id === dayType.id) || next.dayTypes.find((candidate) => nameKey(candidate.name) === nameKey(dayType.name));
    if (match) dayMap.set(dayType.id, match.id);
  }
  const basesAgree = dayMap.get(fileBase.id) === project.dayTypes[0].id;
  for (const dayType of file.dayTypes) {
    if (dayMap.has(dayType.id)) continue;
    const id = keepOrMake(dayType.id, 'd', taken, ids);
    const own = fileOwn(dayType) || !basesAgree;
    const base = next.dayTypes[0];
    next = {
      ...next,
      dayTypes: next.dayTypes.concat([{ id, name: dayType.name, own, bells: own ? padTo(fileBells(dayType).map((bell) => (bell === null ? null : { ...bell })), periods, () => null) : emptyBells(periods) }]),
      groups: own ? next.groups.map((group) => ({ ...group, days: { ...group.days, [id]: group.days[base.id].map(copySlot) } })) : next.groups,
    };
    dayMap.set(dayType.id, id);
    summary.dayTypesAdded.push(dayType.name);
  }
  // A day type that has its own bells or rooms in the file, and is the same
  // as the first day type here, becomes its own copy here.
  for (const dayType of file.dayTypes) {
    const id = dayMap.get(dayType.id);
    const index = next.dayTypes.findIndex((candidate) => candidate.id === id);
    if (index === 0 || next.dayTypes[index].own) continue;
    const differs = fileOwn(dayType) || !basesAgree;
    if (!differs || !(fileBells(dayType).some((bell) => bell !== null) || hasRooms(dayType))) continue;
    const base = next.dayTypes[0];
    next = {
      ...next,
      dayTypes: next.dayTypes.map((candidate) => (candidate.id === id ? { ...candidate, own: true, bells: base.bells.map((bell) => (bell === null ? null : { ...bell })) } : candidate)),
      groups: next.groups.map((group) => ({ ...group, days: { ...group.days, [id]: group.days[base.id].map(copySlot) } })),
    };
  }
  // bells: fill what is empty here
  for (const dayType of file.dayTypes) {
    const id = dayMap.get(dayType.id);
    const index = next.dayTypes.findIndex((candidate) => candidate.id === id);
    const here = next.dayTypes[index];
    if (index !== 0 && !here.own) continue;
    const from = fileBells(dayType);
    if (!here.bells.some((bell, period) => bell === null && from[period])) continue;
    next = { ...next, dayTypes: next.dayTypes.map((candidate) => (candidate === here ? { ...here, bells: here.bells.map((bell, period) => (bell === null && from[period] ? { ...from[period] } : bell)) } : candidate)) };
  }

  // groups
  const ownHere = (id) => {
    const index = next.dayTypes.findIndex((candidate) => candidate.id === id);
    return index === 0 || next.dayTypes[index].own === true;
  };
  const incoming = file.groups.map((group) => {
    const days = {};
    for (const dayType of file.dayTypes) {
      const id = dayMap.get(dayType.id);
      if (!ownHere(id)) continue;
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
    return { key: nameKey(group.name), name: group.name, id: group.id, fields: { grade: group.grade, headCount: group.headCount, colour: group.colour }, days };
  });
  const merged = mergeGroups(next, incoming, options.policy, ids);
  Object.assign(summary, merged.summary);
  summary.unknownRooms = Array.from(unknown);

  if (merged.project === project) return { project, summary };
  const findings = validate(merged.project);
  if (findings.length > 0) throw new FileError(invalidMessage('schedule', findings), 'invalid', findings);
  return { project: merged.project, summary };
}
