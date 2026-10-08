// repair(project) runs on every load, after migrate. It turns any object into
// one validate() accepts, and gives back { project, notes }: the notes are
// plain sentences, one per thing it had to change, for the toast and the log.
// A project that needs nothing comes back as the very same object.
//
// The rules it follows when it has to choose:
// - A field that is absent gets its default and no note. A field that is
//   there and unusable gets a note.
// - Nothing a user typed is thrown away when it can be kept. A slot whose room
//   is gone keeps the room's number as text. Two rooms with one number, two
//   groups or two teachers with one name: the later one gets " (2)".
// - A cell claimed twice goes to the space that is earlier in the list, and a
//   space's cell is never also a corridor or stairs cell.
// - A day type marked "same as the first" that carries bell times or group
//   days of its own becomes its own copy, so nothing entered disappears.
// - When `settings.periods` is missing or out of range it becomes the longest
//   day present (else 8), and when it is in range and a day or a bell
//   schedule is longer, it rises to that length, so the setting never
//   truncates a day. Only a day past 16 periods, the most there are, is cut.
// - An id is 10 characters with its kind's letter first (ids.js). A thing
//   with any other id, or with an id something earlier of its kind has, gets
//   a new one, and everything that named it by the old id follows: slots,
//   lists of teachers and rooms, a group's days, stair connections, zones,
//   scenario changes, accepted findings. So an id that a teacher and a room
//   both carry stays with the room, and nothing that pointed at either is
//   emptied.
// - A project with no day types gets them from the days its groups have, in
//   the order the keys first appear, each its own copy; A Day and B Day only
//   when there are none.
// - A floor's missing or fractional width or height is worked out from its
//   cells when the other side divides them exactly.
// - A scenario's changes are checked for shape only. Whether they still point
//   at things that exist is for the scenario module, which tells the user
//   what it dropped.
//
// options: { ids, clock, imageIds }. `ids` and `clock` are used only when
// something has no id or no date; without them a generator seeded from the
// project and the date 1970-01-01 stand in. `imageIds` is the set of traced
// images this device holds; with it, each floor's image is marked missing or
// not.

import { FORMAT, PUBLISHED_FORMAT, CURRENT_VERSION, RANGES, PERIOD_WORDS, TIME_FORMATS, PAPER_SIZES, PAPER_ORIENTATIONS, THEMES, COLOUR_SCALE_MODES, OTHER_KINDS, DOOR_SIDES, CONNECTION_DIRECTIONS, CHANGE_KINDS, PUBLISH_VIEWS, CHECK_KINDS, CELL_CORRIDOR, CELL_STAIRS, CELL_EMPTY, DEFAULT_FLOOR_WIDTH, DEFAULT_FLOOR_HEIGHT, DEFAULT_OTHER_COLOUR, DEFAULT_DAY_TYPE_NAMES } from './schema.js';
import { defaultSettings, defaultPublish, defaultOnboarding, emptyCells, emptySlot, emptyDay, newFloor, newDayType, roomNumberKey, nameKey, isHexColour, isBellTime, isIsoDate, inRange, neighbourCell, isEdgeCorridorCell, nextGroupColour, nextConnectionLabel } from './schema.js';
import { createIds, seededRandom, collectIds, isId } from './ids.js';

const FALLBACK_DATE = '1970-01-01T00:00:00.000Z';
const FALLBACK_SUBJECT_COLOUR = '#5a6b7b';
export const UNKNOWN_ROOM_TEXT = 'unknown room';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

export function repair(input, options) {
  const opts = options || {};
  const notes = [];
  const note = (text) => notes.push(text);

  const source = isObject(input) ? input : {};
  if (!isObject(input)) note('The saved project could not be read as a project, so an empty one was made.');
  const published = source.format === PUBLISHED_FORMAT;

  const present = collectIds(source);
  const ids = opts.ids || createIds(seededRandom('sv2-repair:' + present.join(',')));
  if (typeof ids.reserve === 'function') ids.reserve(present);
  const now = opts.clock ? opts.clock().toISOString() : FALLBACK_DATE;

  // ---- small helpers

  // An id is kept by the first thing of its own kind that carries it. A
  // thing whose id is not an id of its kind gets a new one, and `renamed`
  // remembers old -> new for that kind, so whatever named the thing by the old
  // id can follow it. The old id is never an id of that kind, so it cannot
  // also be the id of a thing of that kind that kept its own.
  const seenIds = new Set();
  const renamed = { s: new Map(), t: new Map(), d: new Map(), f: new Map(), r: new Map(), g: new Map() };
  const claimId = (thing, prefix, what) => {
    const id = thing.id;
    if (isId(id, prefix) && !seenIds.has(id)) {
      seenIds.add(id);
      return id;
    }
    const fresh = ids(prefix);
    seenIds.add(fresh);
    if (typeof id !== 'string' || id === '') {
      note(what + ' had no id and was given one.');
    } else if (!isId(id, prefix)) {
      if (renamed[prefix] && !renamed[prefix].has(id)) renamed[prefix].set(id, fresh);
      note(what + ' had the id "' + id + '", which is not the id of such a thing, and was given a new one. What named it by that id follows it.');
    } else {
      note(what + ' shared the id "' + id + '" with something earlier and was given a new one.');
    }
    return fresh;
  };
  const follow = (prefix, id) => (typeof id === 'string' && renamed[prefix].has(id) ? renamed[prefix].get(id) : id);

  // The objects of a list; anything that is not an object is dropped.
  const objects = (list, what) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      note('The list of ' + what + ' could not be read and was emptied.');
      return [];
    }
    const kept = list.filter(isObject);
    if (kept.length !== list.length) note(plural(list.length - kept.length, 'entry', 'entries') + ' in the list of ' + what + ' could not be read and ' + (list.length - kept.length === 1 ? 'was' : 'were') + ' removed.');
    return kept;
  };

  const text = (thing, key, fallback, what) => {
    if (typeof thing[key] === 'string') return;
    if (thing[key] !== undefined && thing[key] !== null) note(what + ' was not text and was reset.');
    thing[key] = fallback;
  };

  const whole = (thing, key, range, fallback, what) => {
    const value = thing[key];
    if (inRange(value, range)) return;
    if (value === undefined) {
      thing[key] = fallback;
      return;
    }
    thing[key] = typeof value === 'number' && Number.isFinite(value) ? Math.min(range[1], Math.max(range[0], Math.round(value))) : fallback;
    note(what + ' was outside ' + range[0] + ' to ' + range[1] + ' and is now ' + thing[key] + '.');
  };

  const choice = (thing, key, allowed, fallback, what) => {
    if (allowed.includes(thing[key])) return;
    if (thing[key] !== undefined) note(what + ' was not one of the choices and was reset.');
    thing[key] = fallback;
  };

  const flag = (thing, key, fallback, what) => {
    if (typeof thing[key] === 'boolean') return;
    if (thing[key] !== undefined) note(what + ' was not true or false and was reset.');
    thing[key] = fallback;
  };

  // "204", then "204 (2)", "204 (3)": the first form no earlier thing uses.
  const uniqueText = (value, keyOf, used) => {
    if (!used.has(keyOf(value))) {
      used.add(keyOf(value));
      return value;
    }
    for (let n = 2; ; n += 1) {
      const candidate = value + ' (' + n + ')';
      if (!used.has(keyOf(candidate))) {
        used.add(keyOf(candidate));
        return candidate;
      }
    }
  };

  const project = { ...source };

  // ---- identity
  if (!published) project.format = FORMAT;
  if (project.version !== CURRENT_VERSION) {
    if (project.version !== undefined) note('The version number was reset to ' + CURRENT_VERSION + '.');
    project.version = CURRENT_VERSION;
  }
  project.id = claimId(project, 'p', 'The project');
  if (!published) {
    for (const key of ['created', 'modified']) {
      if (isIsoDate(project[key])) continue;
      if (project[key] !== undefined) note('The ' + key + ' date could not be read and was reset.');
      project[key] = now;
    }
  }

  // ---- settings
  const rawGroups = Array.isArray(source.groups) ? source.groups.filter(isObject) : [];
  const rawDayTypes = Array.isArray(source.dayTypes) ? source.dayTypes.filter(isObject) : [];
  const defaults = defaultSettings();
  if (source.settings !== undefined && !isObject(source.settings)) note('The settings could not be read and were reset.');
  const settings = isObject(source.settings) ? { ...source.settings } : {};
  project.settings = settings;
  text(settings, 'schoolName', defaults.schoolName, 'The school name');
  let longest = 0;
  for (const group of rawGroups) {
    if (!isObject(group.days)) continue;
    for (const day of Object.values(group.days)) if (Array.isArray(day)) longest = Math.max(longest, day.length);
  }
  for (const dayType of rawDayTypes) if (Array.isArray(dayType.bells)) longest = Math.max(longest, dayType.bells.length);
  if (!inRange(settings.periods, RANGES.periods)) {
    const had = settings.periods;
    settings.periods = longest === 0 ? defaults.periods : Math.min(RANGES.periods[1], longest);
    if (had !== undefined) note('Periods per day was not a number from ' + RANGES.periods[0] + ' to ' + RANGES.periods[1] + ' and is now ' + settings.periods + ', the longest day in the schedule.');
  } else if (longest > settings.periods) {
    // in range, and a day or a bell schedule runs past it: the setting gives way
    const had = settings.periods;
    settings.periods = Math.min(RANGES.periods[1], longest);
    note('Periods per day was ' + had + ' and a day in the schedule has ' + longest + ', so it is now ' + settings.periods + '.');
  }
  const periods = settings.periods;
  choice(settings, 'periodWord', PERIOD_WORDS, defaults.periodWord, 'The period word');
  whole(settings, 'defaultPassingSeconds', RANGES.defaultPassingSeconds, defaults.defaultPassingSeconds, 'The default passing time');
  if (!published) whole(settings, 'defaultHeadCount', RANGES.headCount, defaults.defaultHeadCount, 'The default head count');
  whole(settings, 'secondsPerCell', RANGES.secondsPerCell, defaults.secondsPerCell, 'Seconds per corridor cell');
  whole(settings, 'secondsPerStair', RANGES.secondsPerStair, defaults.secondsPerStair, 'Seconds per stair connection');
  choice(settings, 'timeFormat', TIME_FORMATS, defaults.timeFormat, 'The time format');
  if (!published) {
    if (settings.colourScale !== undefined && !isObject(settings.colourScale)) note('The colour scale could not be read and was reset.');
    const scale = isObject(settings.colourScale) ? { ...settings.colourScale } : {};
    settings.colourScale = scale;
    choice(scale, 'mode', COLOUR_SCALE_MODES, defaults.colourScale.mode, 'The colour scale');
    const bands = scale.bands;
    if (!(Array.isArray(bands) && bands.length === 4 && bands.every((band, i) => inRange(band, RANGES.colourBand) && (i === 0 || band > bands[i - 1])))) {
      if (bands !== undefined) note('The absolute colour bands were not four rising numbers and were reset.');
      scale.bands = defaults.colourScale.bands;
    }
    if (settings.checks !== undefined && !isObject(settings.checks)) note('The check settings could not be read and were reset.');
    const checks = isObject(settings.checks) ? { ...settings.checks } : {};
    settings.checks = checks;
    whole(checks, 'consecutiveLimit', RANGES.consecutiveLimit, defaults.checks.consecutiveLimit, 'The consecutive-periods limit');
    whole(checks, 'passingMarginSeconds', RANGES.passingMarginSeconds, defaults.checks.passingMarginSeconds, 'The passing margin');
    if (!Array.isArray(checks.off)) {
      if (checks.off !== undefined) note('The list of checks switched off could not be read and was emptied.');
      checks.off = [];
    } else {
      const off = Array.from(new Set(checks.off.filter((kind) => CHECK_KINDS.includes(kind))));
      if (off.length !== checks.off.length) {
        note('The list of checks switched off had entries that are not a check, or the same one twice; they were removed.');
        checks.off = off;
      }
    }
    if (settings.paper !== undefined && !isObject(settings.paper)) note('The paper setting could not be read and was reset.');
    const paper = isObject(settings.paper) ? { ...settings.paper } : {};
    settings.paper = paper;
    choice(paper, 'size', PAPER_SIZES, defaults.paper.size, 'The paper size');
    choice(paper, 'orientation', PAPER_ORIENTATIONS, defaults.paper.orientation, 'The paper orientation');
    choice(settings, 'theme', THEMES, defaults.theme, 'The theme');
  }

  // ---- subjects
  const subjectIds = new Set();
  project.subjects = objects(source.subjects, 'subjects').map((raw) => {
    const subject = { ...raw };
    subject.id = claimId(subject, 's', 'A subject');
    subjectIds.add(subject.id);
    text(subject, 'code', '', 'A subject code');
    text(subject, 'name', '', 'A subject name');
    if (!isHexColour(subject.colour)) {
      if (subject.colour !== undefined) note('The colour of subject "' + subject.name + '" could not be read and was reset.');
      subject.colour = FALLBACK_SUBJECT_COLOUR;
    }
    return subject;
  });
  const subjectRef = (thing, what) => {
    if (renamed.s.has(thing.subjectId)) thing.subjectId = renamed.s.get(thing.subjectId);
    if (thing.subjectId === null || subjectIds.has(thing.subjectId)) return;
    if (thing.subjectId !== undefined) note(what + ' named a subject that is not on the list and now has no subject.');
    thing.subjectId = null;
  };

  // ---- teachers (their rooms come after the building)
  const teacherIds = new Set();
  const teacherNames = new Set();
  const teacherRawRooms = new Map();
  project.teachers = objects(source.teachers, 'teachers').map((raw) => {
    const teacher = { ...raw };
    teacher.id = claimId(teacher, 't', 'A teacher');
    teacherIds.add(teacher.id);
    if (typeof teacher.name !== 'string' || teacher.name.trim() === '') {
      note('A teacher had no name and is now called "Teacher".');
      teacher.name = 'Teacher';
    }
    const name = uniqueText(teacher.name, nameKey, teacherNames);
    if (name !== teacher.name) {
      note('Two teachers were both called "' + teacher.name + '". The second is now "' + name + '"; merge them if they are one person.');
      teacher.name = name;
    }
    subjectRef(teacher, 'Teacher "' + teacher.name + '"');
    text(teacher, 'notes', '', 'A teacher\'s notes');
    teacherRawRooms.set(teacher.id, Array.isArray(teacher.roomIds) ? teacher.roomIds : []);
    if (teacher.roomIds !== undefined && !Array.isArray(teacher.roomIds)) note('The rooms of teacher "' + teacher.name + '" could not be read and were worked out from the rooms.');
    return teacher;
  });
  const teacherRefs = (list, what) => {
    if (!Array.isArray(list)) {
      if (list !== undefined) note(what + ' had a list of teachers that could not be read; it was emptied.');
      return [];
    }
    const named = list.some((id) => renamed.t.has(id)) ? list.map((id) => follow('t', id)) : list;
    const kept = Array.from(new Set(named.filter((id) => teacherIds.has(id))));
    if (kept.length === list.length) return named;
    note(what + ' named ' + plural(list.length - kept.length, 'teacher', 'teachers') + ' not on the list, or the same one twice; ' + (list.length - kept.length === 1 ? 'that entry was' : 'those entries were') + ' removed.');
    return kept;
  };

  // ---- day types
  let dayTypes = objects(source.dayTypes, 'day types').map((raw) => ({ ...raw }));
  if (dayTypes.length === 0) {
    // the days the groups have say which day types there were: one for each
    // key, in the order the keys first appear, the first of them the base
    const keys = [];
    for (const group of rawGroups) {
      if (!isObject(group.days)) continue;
      for (const key of Object.keys(group.days)) if (Array.isArray(group.days[key]) && !keys.includes(key)) keys.push(key);
    }
    if (keys.length > 0) {
      note('The project had no day types, so ' + plural(keys.length, 'day type was', 'day types were') + ' made from the days the groups have.');
      dayTypes = keys.map((key, i) => ({ id: key, name: DEFAULT_DAY_TYPE_NAMES[i] || 'Day ' + (i + 1), own: true, bells: [] }));
    } else {
      if (source.dayTypes !== undefined) note('The project had no day types, so ' + DEFAULT_DAY_TYPE_NAMES.join(' and ') + ' were added.');
      dayTypes = DEFAULT_DAY_TYPE_NAMES.map((name, i) => newDayType(ids('d'), name, i === 0, periods));
    }
  }
  const ownIds = new Set();
  const promoted = new Set();
  dayTypes.forEach((dayType, i) => {
    const rawId = dayType.id;
    dayType.id = claimId(dayType, 'd', 'A day type');
    text(dayType, 'name', DEFAULT_DAY_TYPE_NAMES[i] || 'Day ' + (i + 1), 'A day type name');
    let bells = dayType.bells;
    if (!Array.isArray(bells)) {
      if (bells !== undefined) note('The bell schedule of ' + dayType.name + ' could not be read and was emptied.');
      bells = [];
    }
    let fixed = bells.map((bell) => (bell === null || (isObject(bell) && isBellTime(bell.start) && isBellTime(bell.end)) ? bell : undefined));
    const bad = fixed.filter((bell) => bell === undefined).length;
    if (bad > 0) {
      note(plural(bad, 'bell time', 'bell times') + ' on ' + dayType.name + ' could not be read and ' + (bad === 1 ? 'was' : 'were') + ' cleared.');
      fixed = fixed.map((bell) => (bell === undefined ? null : bell));
    }
    if (fixed.length > periods) {
      const lost = fixed.slice(periods).filter((bell) => bell !== null).length;
      if (lost > 0) note(dayType.name + ' had bell times for more periods than the school has; ' + plural(lost, 'entry was', 'entries were') + ' removed.');
      fixed = fixed.slice(0, periods);
    }
    while (fixed.length < periods) fixed.push(null);
    const changed = bad > 0 || fixed.length !== bells.length || !Array.isArray(dayType.bells);
    const hasBells = fixed.some((bell) => bell !== null);
    const hasDays = rawGroups.some((group) => isObject(group.days) && (Array.isArray(group.days[dayType.id]) || (typeof rawId === 'string' && renamed.d.get(rawId) === dayType.id && Array.isArray(group.days[rawId]))));
    if (i === 0) {
      if (dayType.own !== true) {
        if (dayType.own !== undefined) note('The first day type, ' + dayType.name + ', is always its own copy.');
        dayType.own = true;
      }
    } else if (dayType.own !== true) {
      if (hasBells || hasDays) {
        note(dayType.name + ' was marked the same as ' + dayTypes[0].name + ' and had ' + (hasDays ? 'days' : 'bell times') + ' of its own, so it is its own copy now.');
        dayType.own = true;
        promoted.add(dayType.id);
      } else {
        flag(dayType, 'own', false, 'Whether ' + dayType.name + ' is its own copy');
      }
    }
    if (changed) dayType.bells = fixed;
    if (dayType.own) ownIds.add(dayType.id);
  });
  project.dayTypes = dayTypes;
  const baseId = dayTypes[0].id;

  // ---- building
  if (source.building !== undefined && !isObject(source.building)) note('The building could not be read and was emptied.');
  const building = isObject(source.building) ? { ...source.building } : {};
  project.building = building;
  const roomById = new Map();
  const goneRooms = new Map(); // id of a room that could not be kept -> its number
  const roomNumbers = new Set();
  const floorById = new Map();

  let rawFloors = objects(building.floors, 'floors');
  if (rawFloors.length === 0) {
    if (building.floors !== undefined) note('The building had no floors, so an empty Floor 1 was added.');
    rawFloors = [newFloor(ids('f'), 'Floor 1', 1, DEFAULT_FLOOR_WIDTH, DEFAULT_FLOOR_HEIGHT)];
  }
  building.floors = rawFloors.map((raw, f) => {
    const floor = { ...raw };
    floor.id = claimId(floor, 'f', 'A floor');
    text(floor, 'name', 'Floor ' + (f + 1), 'A floor name');
    if (!Number.isInteger(floor.level)) {
      if (floor.level !== undefined) note('The level of ' + floor.name + ' was not a whole number and is now ' + (f + 1) + '.');
      floor.level = f + 1;
    }
    // one side missing or not a whole number, and the other divides the
    // cells exactly: the cells say what the side was
    if (typeof floor.cells === 'string') {
      for (const [key, other] of [['width', 'height'], ['height', 'width']]) {
        if (Number.isInteger(floor[key]) || !inRange(floor[other], RANGES.floorSize)) continue;
        const side = floor.cells.length / floor[other];
        if (!inRange(side, RANGES.floorSize)) continue;
        note('The ' + key + ' of ' + floor.name + ' ' + (floor[key] === undefined || floor[key] === null ? 'was missing' : 'was not a whole number') + ' and was worked out from its cells: ' + side + '.');
        floor[key] = side;
      }
    }
    whole(floor, 'width', RANGES.floorSize, DEFAULT_FLOOR_WIDTH, 'The width of ' + floor.name);
    whole(floor, 'height', RANGES.floorSize, DEFAULT_FLOOR_HEIGHT, 'The height of ' + floor.name);
    const count = floor.width * floor.height;
    let cells = floor.cells;
    if (typeof cells !== 'string') {
      if (cells !== undefined) note('The cells of ' + floor.name + ' could not be read and were emptied.');
      cells = emptyCells(floor.width, floor.height);
    }
    if (/[^.#S]/.test(cells)) {
      note('Some cells of ' + floor.name + ' held something that is not a cell and were emptied.');
      cells = cells.replace(/[^.#S]/g, CELL_EMPTY);
    }
    if (cells.length !== count) {
      note('The cells of ' + floor.name + ' did not match its size of ' + floor.width + ' by ' + floor.height + ' and were ' + (cells.length > count ? 'cut' : 'filled out') + ' to fit.');
      cells = cells.length > count ? cells.slice(0, count) : cells + CELL_EMPTY.repeat(count - cells.length);
    }

    // spaces: cells and ownership first, since a space wins its cells back
    // from corridor and stairs
    const owner = new Set();
    const cellList = cells.split('');
    let cleared = 0;
    const ownCells = new Map();
    const spaces = [];
    for (const rawSpace of objects(floor.spaces, 'spaces on ' + floor.name)) {
      const space = { ...rawSpace };
      if (space.kind !== 'room' && space.kind !== 'other') {
        space.kind = 'otherKind' in space || ('label' in space && !('number' in space)) ? 'other' : 'room';
        note('A space on ' + floor.name + ' did not say what it is and is now ' + (space.kind === 'room' ? 'a room' : 'an other space') + '.');
      }
      space.id = claimId(space, space.kind === 'other' ? 'o' : 'r', 'A space on ' + floor.name);
      const label = space.kind === 'room' ? 'Room "' + (typeof space.number === 'string' ? space.number : '') + '"' : 'The other space "' + (typeof space.label === 'string' ? space.label : '') + '"';
      const rawCells = Array.isArray(space.cells) ? space.cells : [];
      const own = [];
      const ownSet = new Set();
      let taken = 0;
      for (const cell of rawCells) {
        if (!Number.isInteger(cell) || cell < 0 || cell >= count || ownSet.has(cell)) continue;
        if (owner.has(cell)) {
          taken += 1;
          continue;
        }
        owner.add(cell);
        ownSet.add(cell);
        own.push(cell);
        if (cellList[cell] !== CELL_EMPTY) {
          cellList[cell] = CELL_EMPTY;
          cleared += 1;
        }
      }
      if (own.length !== rawCells.length || !Array.isArray(space.cells)) {
        if (taken > 0) note(label + ' on ' + floor.name + ' lost ' + plural(taken, 'cell', 'cells') + ' that an earlier space already had.');
        if (rawCells.length - own.length - taken > 0) note(label + ' on ' + floor.name + ' listed ' + plural(rawCells.length - own.length - taken, 'cell', 'cells') + ' that are not on the floor, or listed twice; they were removed.');
        space.cells = own;
      }
      if (own.length === 0) {
        note(label + ' on ' + floor.name + ' had no cells left and was removed.');
        if (space.kind === 'room') goneRooms.set(space.id, typeof space.number === 'string' ? space.number : '');
        continue;
      }
      ownCells.set(space, ownSet);
      spaces.push(space);
    }
    if (cleared > 0) note(plural(cleared, 'corridor or stairs cell', 'corridor or stairs cells') + ' on ' + floor.name + ' lay under a room or other space and ' + (cleared === 1 ? 'was' : 'were') + ' cleared.');
    cells = cleared > 0 ? cellList.join('') : cells;
    floor.cells = cells;

    for (const space of spaces) {
      const own = ownCells.get(space);
      if (space.kind === 'room') {
        text(space, 'number', '', 'A room number on ' + floor.name);
        if (space.number.trim() !== '') {
          const number = uniqueText(space.number, roomNumberKey, roomNumbers);
          if (number !== space.number) {
            note('Two rooms were both numbered "' + space.number + '". The one on ' + floor.name + ' is now "' + number + '".');
            space.number = number;
          }
        }
        const label = 'Room "' + space.number + '"';
        const teachers = teacherRefs(space.teacherIds, label);
        if (teachers !== space.teacherIds) space.teacherIds = teachers;
        subjectRef(space, label);
        text(space, 'wing', '', 'The wing of ' + label);
        if (space.capacity !== null) {
          if (space.capacity === undefined) space.capacity = null;
          else if (typeof space.capacity !== 'number' || !Number.isFinite(space.capacity)) {
            note('The capacity of ' + label + ' was not a number and was cleared.');
            space.capacity = null;
          } else whole(space, 'capacity', RANGES.capacity, null, 'The capacity of ' + label);
        }
        flag(space, 'shared', false, 'The shared-space flag of ' + label);
        const rawDoors = Array.isArray(space.doors) ? space.doors : [];
        const seenDoors = new Set();
        const doors = rawDoors.filter((door) => {
          if (!isObject(door) || !DOOR_SIDES.includes(door.side) || !own.has(door.cell)) return false;
          const key = door.cell + door.side;
          if (seenDoors.has(key)) return false;
          const across = neighbourCell(floor, door.cell, door.side);
          if (across === -1 || (cells[across] !== CELL_CORRIDOR && cells[across] !== CELL_STAIRS)) return false;
          seenDoors.add(key);
          return true;
        });
        if (doors.length !== rawDoors.length || !Array.isArray(space.doors)) {
          if (rawDoors.length !== doors.length) note(label + ' had ' + plural(rawDoors.length - doors.length, 'door', 'doors') + ' that did not face a corridor or stairs; ' + (rawDoors.length - doors.length === 1 ? 'it was' : 'they were') + ' removed.');
          space.doors = doors;
        }
        roomById.set(space.id, space);
      } else {
        text(space, 'label', '', 'The label of an other space');
        choice(space, 'otherKind', OTHER_KINDS, 'other', 'The kind of the other space "' + space.label + '"');
        if (!isHexColour(space.colour)) {
          if (space.colour !== undefined) note('The colour of the other space "' + space.label + '" could not be read and was reset.');
          space.colour = DEFAULT_OTHER_COLOUR;
        }
      }
    }
    floor.spaces = spaces;

    // corridor names
    const named = new Set();
    const corridors = [];
    for (const rawCorridor of objects(floor.corridors, 'corridor names on ' + floor.name)) {
      const corridor = { ...rawCorridor };
      corridor.id = claimId(corridor, 'k', 'A corridor name on ' + floor.name);
      text(corridor, 'name', '', 'A corridor name on ' + floor.name);
      const rawCells = Array.isArray(corridor.cells) ? corridor.cells : [];
      const kept = [];
      for (const cell of rawCells) {
        if (!Number.isInteger(cell) || cell < 0 || cell >= count || cells[cell] !== CELL_CORRIDOR || named.has(cell)) continue;
        named.add(cell);
        kept.push(cell);
      }
      if (kept.length === 0) {
        note('The corridor name "' + corridor.name + '" on ' + floor.name + ' covered no corridor cells and was removed.');
        continue;
      }
      if (kept.length !== rawCells.length) {
        note('The corridor name "' + corridor.name + '" on ' + floor.name + ' covered ' + plural(rawCells.length - kept.length, 'cell', 'cells') + ' that are not corridor, or already named; they were left out.');
        corridor.cells = kept;
      }
      corridors.push(corridor);
    }
    floor.corridors = corridors;

    // exits
    const exitCells = new Set();
    const exits = [];
    for (const rawExit of objects(floor.exits, 'exits on ' + floor.name)) {
      const exit = { ...rawExit };
      exit.id = claimId(exit, 'x', 'An exit on ' + floor.name);
      text(exit, 'doorName', '', 'The door name of an exit');
      text(exit, 'assembly', '', 'The assembly point of an exit');
      const cell = exit.cell;
      if (!Number.isInteger(cell) || cell < 0 || cell >= count || exitCells.has(cell) || !isEdgeCorridorCell(floor, cell)) {
        note('The exit "' + exit.doorName + '" on ' + floor.name + ' was not on a corridor cell at the edge of the building and was removed.');
        continue;
      }
      exitCells.add(cell);
      exits.push(exit);
    }
    floor.exits = exits;

    // traced image
    if (!published || floor.image !== undefined) {
      if (!isObject(floor.image) || typeof floor.image.imageId !== 'string' || floor.image.imageId === '') {
        if (floor.image !== null && floor.image !== undefined) note('The traced image of ' + floor.name + ' could not be read and was removed.');
        floor.image = null;
      } else {
        const image = { ...floor.image };
        const number = (key, ok, fallback) => {
          if (typeof image[key] === 'number' && ok(image[key])) return;
          if (image[key] !== undefined) note('The ' + key + ' of the traced image on ' + floor.name + ' was reset.');
          image[key] = fallback;
        };
        number('opacity', (v) => v >= 0 && v <= 1, 0.4);
        number('scale', (v) => v > 0 && Number.isFinite(v), 1);
        number('rotation', Number.isFinite, 0);
        number('x', Number.isFinite, 0);
        number('y', Number.isFinite, 0);
        number('width', (v) => Number.isInteger(v) && v >= 1, 1);
        number('height', (v) => Number.isInteger(v) && v >= 1, 1);
        flag(image, 'visible', true, 'The show flag of the traced image on ' + floor.name);
        flag(image, 'locked', false, 'The lock of the traced image on ' + floor.name);
        flag(image, 'missing', false, 'The missing flag of the traced image on ' + floor.name);
        if (opts.imageIds) {
          const missing = !opts.imageIds.has(image.imageId);
          if (missing !== image.missing) {
            image.missing = missing;
            note(missing ? 'The traced image of ' + floor.name + ' is not on this device. Its position is kept; choose the file again to see it.' : 'The traced image of ' + floor.name + ' is on this device again.');
          }
        }
        floor.image = image;
      }
    }

    floorById.set(floor.id, floor);
    return floor;
  });

  // connections
  const rawConnections = objects(building.connections, 'stair connections');
  const labels = rawConnections.map((connection) => ({ label: typeof connection.label === 'string' ? connection.label : '' }));
  const usedLabels = new Set();
  const connections = [];
  for (const rawConnection of rawConnections) {
    const connection = { ...rawConnection };
    for (const key of ['a', 'b']) if (isObject(connection[key]) && renamed.f.has(connection[key].floorId)) connection[key] = { ...connection[key], floorId: renamed.f.get(connection[key].floorId) };
    const endOk = (end) => isObject(end) && floorById.has(end.floorId) && Number.isInteger(end.cell) && floorById.get(end.floorId).cells[end.cell] === CELL_STAIRS;
    const label = typeof connection.label === 'string' && connection.label.trim() !== '' ? connection.label : null;
    if (!endOk(connection.a) || !endOk(connection.b) || (connection.a.floorId === connection.b.floorId && connection.a.cell === connection.b.cell)) {
      note('The stair connection' + (label ? ' ' + label : '') + ' did not join two stairs cells and was removed.');
      continue;
    }
    connection.id = claimId(connection, 'c', 'A stair connection');
    if (label === null) {
      connection.label = nextConnectionLabel(labels);
      labels.push({ label: connection.label });
      note('A stair connection had no letter and is now ' + connection.label + '.');
    } else {
      const unique = uniqueText(connection.label, (value) => value, new Set(usedLabels));
      if (unique !== connection.label) {
        note('Two stair connections were both labelled "' + connection.label + '". The later is now "' + unique + '".');
        connection.label = unique;
        labels.push({ label: unique });
      }
    }
    usedLabels.add(connection.label);
    choice(connection, 'direction', CONNECTION_DIRECTIONS, 'both', 'The direction of stair connection ' + connection.label);
    connections.push(connection);
  }
  building.connections = connections;

  // zones
  if (!published || building.zones !== undefined) {
    const zones = [];
    for (const rawZone of objects(building.zones, 'zones')) {
      const zone = { ...rawZone };
      text(zone, 'label', '', 'A zone label');
      if (renamed.f.has(zone.floorId)) zone.floorId = renamed.f.get(zone.floorId);
      const floor = floorById.get(zone.floorId);
      const sound = floor && [zone.x, zone.y, zone.w, zone.h].every(Number.isInteger);
      if (sound) {
        const x0 = Math.max(0, zone.x);
        const y0 = Math.max(0, zone.y);
        const x1 = Math.min(floor.width, zone.x + zone.w);
        const y1 = Math.min(floor.height, zone.y + zone.h);
        if (x1 > x0 && y1 > y0) {
          if (x0 !== zone.x || y0 !== zone.y || x1 - x0 !== zone.w || y1 - y0 !== zone.h) {
            note('The zone "' + zone.label + '" reached past the edge of ' + floor.name + ' and was trimmed.');
            zone.x = x0;
            zone.y = y0;
            zone.w = x1 - x0;
            zone.h = y1 - y0;
          }
          zone.id = claimId(zone, 'z', 'A zone');
          zones.push(zone);
          continue;
        }
      }
      note('The zone "' + zone.label + '" was not a rectangle on a floor of this building and was removed.');
    }
    building.zones = zones;
  }

  // ---- teachers and rooms say the same thing: the union of both lists
  if (renamed.r.size > 0) {
    for (const [teacherId, rooms] of teacherRawRooms) teacherRawRooms.set(teacherId, rooms.map((roomId) => follow('r', roomId)));
  }
  const addedToRooms = new Map();
  for (const teacher of project.teachers) {
    for (const roomId of teacherRawRooms.get(teacher.id)) {
      const room = roomById.get(roomId);
      if (!room || room.teacherIds.includes(teacher.id)) continue;
      if (!addedToRooms.has(room)) {
        room.teacherIds = room.teacherIds.slice();
        addedToRooms.set(room, true);
      }
      room.teacherIds.push(teacher.id);
      note('Teacher "' + teacher.name + '" listed room "' + room.number + '" and the room did not list the teacher; the room does now.');
    }
  }
  for (const teacher of project.teachers) {
    const raw = teacherRawRooms.get(teacher.id);
    const listed = new Set();
    for (const [roomId, room] of roomById) if (room.teacherIds.includes(teacher.id)) listed.add(roomId);
    const rooms = Array.from(new Set(raw.filter((roomId) => listed.has(roomId))));
    for (const roomId of listed) if (!rooms.includes(roomId)) rooms.push(roomId);
    const same = Array.isArray(teacher.roomIds) && rooms.length === teacher.roomIds.length && rooms.every((roomId, i) => roomId === teacher.roomIds[i]);
    if (!same) {
      const followed = Array.isArray(teacher.roomIds) && rooms.length === teacher.roomIds.length && rooms.every((roomId, i) => roomId === follow('r', teacher.roomIds[i]));
      if (teacher.roomIds !== undefined && !followed) note('The rooms of teacher "' + teacher.name + '" did not match the rooms that list the teacher and were brought into line.');
      teacher.roomIds = rooms;
    }
  }

  // ---- groups
  const groupNames = new Set();
  const groups = [];
  for (const raw of objects(source.groups, 'groups')) {
    const group = { ...raw };
    group.id = claimId(group, 'g', 'A group');
    if (typeof group.name !== 'string' || group.name.trim() === '') {
      note('A group had no name and is now called "Group".');
      group.name = 'Group';
    }
    const name = uniqueText(group.name, nameKey, groupNames);
    if (name !== group.name) {
      note('Two groups were both called "' + group.name + '". The second is now "' + name + '".');
      group.name = name;
    }
    text(group, 'grade', '', 'The grade of group "' + group.name + '"');
    if (!published || group.headCount !== undefined) {
      if (group.headCount !== null) {
        if (group.headCount === undefined) group.headCount = null;
        else if (typeof group.headCount !== 'number' || !Number.isFinite(group.headCount)) {
          note('The head count of group "' + group.name + '" was not a number and was cleared.');
          group.headCount = null;
        } else whole(group, 'headCount', RANGES.headCount, null, 'The head count of group "' + group.name + '"');
      }
    }
    if (!isHexColour(group.colour)) {
      if (group.colour !== undefined) note('The colour of group "' + group.name + '" could not be read and was reset.');
      group.colour = nextGroupColour(groups);
    }

    let rawDays = isObject(group.days) ? group.days : {};
    if (group.days !== undefined && !isObject(group.days)) note('The days of group "' + group.name + '" could not be read and were emptied.');
    const days = {};
    let daysChanged = !isObject(group.days);
    if (Object.keys(rawDays).some((key) => renamed.d.has(key))) {
      // a day type that was given a new id takes its days with it
      const moved = {};
      for (const key of Object.keys(rawDays)) {
        const to = follow('d', key);
        if (!(to in moved) || to === key) moved[to] = rawDays[key];
      }
      rawDays = moved;
      daysChanged = true;
    }
    const fixDay = (rawDay, dayName) => {
      let changed = false;
      let lost = 0;
      let unknown = 0;
      let day = rawDay.map((rawSlot) => {
        if (!isObject(rawSlot)) {
          changed = true;
          if (rawSlot !== null && rawSlot !== undefined) lost += 1;
          return emptySlot();
        }
        let slot = rawSlot;
        const set = (key, value) => {
          if (slot === rawSlot) slot = { ...rawSlot };
          slot[key] = value;
          changed = true;
        };
        if (typeof slot.roomText !== 'string') set('roomText', '');
        if (typeof slot.label !== 'string') set('label', '');
        if (renamed.r.has(slot.room)) set('room', renamed.r.get(slot.room));
        if (slot.room !== null && !roomById.has(slot.room)) {
          if (slot.room !== undefined) {
            unknown += 1;
            if (slot.roomText === '') set('roomText', goneRooms.get(slot.room) || UNKNOWN_ROOM_TEXT);
          }
          set('room', null);
        }
        const teachers = teacherRefs(slot.teacherIds, 'A slot of group "' + group.name + '" on ' + dayName);
        if (teachers !== slot.teacherIds) set('teacherIds', teachers);
        return slot;
      });
      if (lost > 0) note(plural(lost, 'slot', 'slots') + ' of group "' + group.name + '" on ' + dayName + ' could not be read and ' + (lost === 1 ? 'was' : 'were') + ' emptied.');
      if (unknown > 0) note('Group "' + group.name + '" on ' + dayName + ' had ' + plural(unknown, 'slot', 'slots') + ' in a room that is not in the building. ' + (unknown === 1 ? 'It is' : 'They are') + ' kept and shown as not in the building.');
      if (day.length > periods) {
        const cut = day.slice(periods).filter((slot) => slot.room !== null || slot.roomText !== '' || slot.label !== '' || slot.teacherIds.length > 0).length;
        if (cut > 0) note('Group "' + group.name + '" on ' + dayName + ' had ' + plural(cut, 'slot', 'slots') + ' past the last period; ' + (cut === 1 ? 'it was' : 'they were') + ' removed.');
        day = day.slice(0, periods);
        changed = true;
      }
      while (day.length < periods) {
        day.push(emptySlot());
        changed = true;
      }
      return changed ? day : rawDay;
    };
    for (const dayType of dayTypes) {
      if (!ownIds.has(dayType.id)) continue;
      const rawDay = rawDays[dayType.id];
      if (Array.isArray(rawDay)) {
        days[dayType.id] = fixDay(rawDay, dayType.name);
        if (days[dayType.id] !== rawDay) daysChanged = true;
      } else if (promoted.has(dayType.id) && days[baseId]) {
        // the group followed the first day type until now; it still does
        days[dayType.id] = days[baseId].map((slot) => ({ ...slot, teacherIds: slot.teacherIds.slice() }));
        daysChanged = true;
      } else {
        if (rawDay !== undefined) note('The day of group "' + group.name + '" on ' + dayType.name + ' could not be read and was emptied.');
        days[dayType.id] = emptyDay(periods);
        daysChanged = true;
      }
    }
    for (const key of Object.keys(rawDays)) {
      if (ownIds.has(key)) continue;
      note('Group "' + group.name + '" had a day for a day type that is not in the project; it was removed.');
      daysChanged = true;
    }
    if (daysChanged) group.days = days;
    groups.push(group);
  }
  project.groups = groups;

  if (!published) {
    // ---- accepted findings
    const accepted = objects(source.accepted, 'accepted findings');
    const keptAccepted = accepted.filter((entry) => typeof entry.findingId === 'string' && entry.findingId !== '');
    if (keptAccepted.length !== accepted.length) note(plural(accepted.length - keptAccepted.length, 'accepted finding', 'accepted findings') + ' did not name a finding and ' + (accepted.length - keptAccepted.length === 1 ? 'was' : 'were') + ' removed.');
    // a finding's id is its kind and the ids it is about, joined by colons;
    // a part that is the old id of exactly one renamed thing follows it
    const renamedParts = new Map();
    for (const map of Object.values(renamed)) for (const [from, to] of map) renamedParts.set(from, renamedParts.has(from) ? null : to);
    const followFinding = (findingId) => (renamedParts.size === 0 ? findingId : findingId.split(':').map((part) => (renamedParts.get(part) ? renamedParts.get(part) : part)).join(':'));
    project.accepted = keptAccepted.map((raw) => {
      const findingId = followFinding(raw.findingId);
      if (typeof raw.reason === 'string' && isIsoDate(raw.at) && findingId === raw.findingId) return raw;
      const entry = { ...raw, findingId };
      text(entry, 'reason', '', 'The reason on an accepted finding');
      if (!isIsoDate(entry.at)) entry.at = now;
      return entry;
    });
    if (Array.isArray(source.accepted) && project.accepted.length === source.accepted.length && project.accepted.every((entry, i) => entry === source.accepted[i])) project.accepted = source.accepted;

    // ---- scenario
    if (!isObject(source.scenario)) {
      if (source.scenario !== null && source.scenario !== undefined) note('The scenario could not be read and was removed.');
      project.scenario = null;
    } else {
      const scenario = { ...source.scenario };
      text(scenario, 'name', '', 'The scenario name');
      const wholePeriod = (value) => Number.isInteger(value) && value >= 0;
      const isText = (value) => typeof value === 'string';
      const changes = objects(scenario.changes, 'scenario changes').filter((change) => {
        if (!CHANGE_KINDS.includes(change.kind) || !isText(change.dayTypeId)) return false;
        if (change.kind === 'move') return isText(change.groupId) && wholePeriod(change.period) && isText(change.roomId);
        if (change.kind === 'swapPeriods') return isText(change.groupId) && wholePeriod(change.periodA) && wholePeriod(change.periodB);
        return isText(change.groupA) && isText(change.groupB) && wholePeriod(change.period);
      });
      // a change follows a day type, group or room that was given a new id
      const REFERS = { dayTypeId: 'd', groupId: 'g', groupA: 'g', groupB: 'g', roomId: 'r' };
      const followed = changes.map((change) => {
        let next = change;
        for (const [key, prefix] of Object.entries(REFERS)) {
          if (!renamed[prefix].has(change[key])) continue;
          if (next === change) next = { ...change };
          next[key] = renamed[prefix].get(change[key]);
        }
        return next;
      });
      const moved = followed.some((change, i) => change !== changes[i]);
      if (!Array.isArray(scenario.changes) || changes.length !== scenario.changes.length || moved) {
        if (Array.isArray(scenario.changes) && scenario.changes.filter(isObject).length !== changes.length) note(plural(scenario.changes.filter(isObject).length - changes.length, 'scenario change', 'scenario changes') + ' could not be read and ' + (scenario.changes.filter(isObject).length - changes.length === 1 ? 'was' : 'were') + ' removed.');
        scenario.changes = followed;
      }
      const compared = scenario.compared;
      const names = (list) => Array.isArray(list) && list.every(isText);
      if (compared !== null && !(isObject(compared) && isText(compared.fileName) && names(compared.addedGroups) && names(compared.removedGroups))) {
        if (compared !== undefined) note('The record of the file the scenario was compared with could not be read and was removed.');
        scenario.compared = null;
      }
      project.scenario = scenario;
    }

    // ---- publish settings
    const publishDefaults = defaultPublish();
    if (source.publish !== undefined && !isObject(source.publish)) note('The publish settings could not be read and were reset.');
    const publish = isObject(source.publish) ? { ...source.publish } : {};
    project.publish = publish;
    text(publish, 'passcode', publishDefaults.passcode, 'The staff passcode');
    whole(publish, 'stalenessDays', RANGES.stalenessDays, publishDefaults.stalenessDays, 'The staleness period');
    if (publish.views !== undefined && !isObject(publish.views)) note('The list of published views could not be read and was reset.');
    const views = isObject(publish.views) ? { ...publish.views } : {};
    publish.views = views;
    for (const view of PUBLISH_VIEWS) flag(views, view, true, 'Whether the ' + view + ' view is published');
    flag(publish, 'teacherNamesOnMap', publishDefaults.teacherNamesOnMap, 'Teacher names on the map');
    if (publish.lastPublishedAt !== null && !isIsoDate(publish.lastPublishedAt)) {
      if (publish.lastPublishedAt !== undefined) note('The last published time could not be read and was cleared.');
      publish.lastPublishedAt = null;
    }

    // ---- onboarding
    const onboardingDefaults = defaultOnboarding();
    if (source.onboarding !== undefined && !isObject(source.onboarding)) note('The getting-started record could not be read and was reset.');
    const onboarding = isObject(source.onboarding) ? { ...source.onboarding } : {};
    project.onboarding = onboarding;
    if (!isObject(onboarding.steps) || !Object.values(onboarding.steps).every((value) => value === true)) {
      const steps = {};
      if (isObject(onboarding.steps)) for (const [step, value] of Object.entries(onboarding.steps)) if (value === true) steps[step] = true;
      onboarding.steps = steps;
    }
    flag(onboarding, 'dismissed', onboardingDefaults.dismissed, 'The dismissed flag of getting started');
    flag(onboarding, 'neverShow', onboardingDefaults.neverShow, 'The never-show flag of getting started');
  }

  // A project that needed nothing is handed back as it came.
  if (isObject(input) && notes.length === 0 && JSON.stringify(project) === JSON.stringify(input)) {
    return { project: input, notes };
  }
  return { project, notes };
}
