// Full validation of a project object. validate(project) returns a list of
// findings { path, message }; an empty list means the object is a project
// every other module may trust. It never throws, whatever it is given, and it
// never rejects a character in a name: names are data.
//
// What it does not check, on purpose: whether a scenario's changes still
// point at things that exist (engine/scenario.js reconciles a scenario and
// tells the user what it dropped), what an accepted finding's id means, and
// whether a bell schedule makes sense (bells.js warns about that inline; a
// warning never blocks), and the form of a traced image's id (it is the key
// the image is stored under on the device, so nothing here could replace it).

import { FORMAT, PUBLISHED_FORMAT, CURRENT_VERSION, RANGES, PERIOD_WORDS, TIME_FORMATS, PAPER_SIZES, PAPER_ORIENTATIONS, THEMES, COLOUR_SCALE_MODES, OTHER_KINDS, DOOR_SIDES, CONNECTION_DIRECTIONS, CHANGE_KINDS, PUBLISH_VIEWS, CHECK_KINDS, CELL_CORRIDOR, CELL_STAIRS, CELL_EMPTY } from './schema.js';
import { isId, ID_LENGTH } from './ids.js';
import { roomNumberKey, nameKey, isHexColour, isBellTime, isIsoDate, inRange, neighbourCell } from './schema.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isBlank(value) {
  return !isString(value) || value.trim() === '';
}

function rangeText(range) {
  return range[0] + ' to ' + range[1];
}

export function validate(project) {
  const findings = [];
  const add = (path, message) => findings.push({ path, message });

  if (!isObject(project)) {
    add('', 'A project is an object.');
    return findings;
  }

  // ---- identity
  if (project.format !== FORMAT && project.format !== PUBLISHED_FORMAT) add('format', 'The format is "' + FORMAT + '".');
  if (project.version !== CURRENT_VERSION) add('version', 'The version is ' + CURRENT_VERSION + '.');
  if (project.format !== PUBLISHED_FORMAT) {
    if (!isIsoDate(project.created)) add('created', 'The created time is an ISO date in UTC.');
    if (!isIsoDate(project.modified)) add('modified', 'The modified time is an ISO date in UTC.');
  }

  const seenIds = new Map();
  // `prefix` is the letter the ids of this kind of thing start with (ids.js).
  // An id of another form is found here and still returned, so that what
  // names the thing by it is not reported a second time as naming nothing.
  const checkId = (path, thing, prefix) => {
    const id = isObject(thing) ? thing.id : undefined;
    if (!isString(id) || id === '') {
      add(path + '.id', 'An id is a string that is not empty.');
      return null;
    }
    if (!isId(id, prefix)) add(path + '.id', 'An id is ' + ID_LENGTH + ' characters, lowercase letters and digits' + (prefix ? ', and this one starts with "' + prefix + '"' : '') + '. "' + id + '" is not.');
    if (seenIds.has(id)) add(path + '.id', 'The id "' + id + '" is already used at ' + seenIds.get(id) + '.');
    else seenIds.set(id, path);
    return id;
  };
  checkId('project', project, 'p');

  // ---- settings
  const settings = project.settings;
  let periods = null;
  if (!isObject(settings)) {
    add('settings', 'The settings are an object.');
  } else {
    if (!isString(settings.schoolName)) add('settings.schoolName', 'The school name is text.');
    if (!inRange(settings.periods, RANGES.periods)) add('settings.periods', 'Periods per day is a whole number from ' + rangeText(RANGES.periods) + '.');
    else periods = settings.periods;
    if (!PERIOD_WORDS.includes(settings.periodWord)) add('settings.periodWord', 'The period word is one of ' + PERIOD_WORDS.join(', ') + '.');
    if (!inRange(settings.defaultPassingSeconds, RANGES.defaultPassingSeconds)) add('settings.defaultPassingSeconds', 'The default passing time is a whole number of seconds from ' + rangeText(RANGES.defaultPassingSeconds) + '.');
    if (project.format !== PUBLISHED_FORMAT && !inRange(settings.defaultHeadCount, RANGES.headCount)) add('settings.defaultHeadCount', 'The default head count is a whole number from ' + rangeText(RANGES.headCount) + '.');
    if (!inRange(settings.secondsPerCell, RANGES.secondsPerCell)) add('settings.secondsPerCell', 'Seconds per corridor cell is a whole number from ' + rangeText(RANGES.secondsPerCell) + '.');
    if (!inRange(settings.secondsPerStair, RANGES.secondsPerStair)) add('settings.secondsPerStair', 'Seconds per stair connection is a whole number from ' + rangeText(RANGES.secondsPerStair) + '.');
    if (project.format !== PUBLISHED_FORMAT) {
      const scale = settings.colourScale;
      if (!isObject(scale)) {
        add('settings.colourScale', 'The colour scale is an object.');
      } else {
        if (!COLOUR_SCALE_MODES.includes(scale.mode)) add('settings.colourScale.mode', 'The colour scale is relative or absolute.');
        const bands = scale.bands;
        const sound = Array.isArray(bands) && bands.length === 4 && bands.every((band, i) => inRange(band, RANGES.colourBand) && (i === 0 || band > bands[i - 1]));
        if (!sound) add('settings.colourScale.bands', 'The absolute bands are four whole numbers, each larger than the one before.');
      }
      const checks = settings.checks;
      if (!isObject(checks)) {
        add('settings.checks', 'The check settings are an object.');
      } else {
        if (!inRange(checks.consecutiveLimit, RANGES.consecutiveLimit)) add('settings.checks.consecutiveLimit', 'The consecutive-periods limit is a whole number from ' + rangeText(RANGES.consecutiveLimit) + '.');
        if (!inRange(checks.passingMarginSeconds, RANGES.passingMarginSeconds)) add('settings.checks.passingMarginSeconds', 'The passing margin is a whole number of seconds from ' + rangeText(RANGES.passingMarginSeconds) + '.');
        if (!Array.isArray(checks.off) || !checks.off.every(isString) || new Set(checks.off).size !== checks.off.length) add('settings.checks.off', 'The checks switched off are a list of check kinds, each once.');
        else checks.off.forEach((kind, k) => {
          if (!CHECK_KINDS.includes(kind)) add('settings.checks.off[' + k + ']', '"' + kind + '" is not one of the checks: ' + CHECK_KINDS.join(', ') + '.');
        });
      }
      const paper = settings.paper;
      if (!isObject(paper)) {
        add('settings.paper', 'The paper setting is an object.');
      } else {
        if (!PAPER_SIZES.includes(paper.size)) add('settings.paper.size', 'The paper size is letter or a4.');
        if (!PAPER_ORIENTATIONS.includes(paper.orientation)) add('settings.paper.orientation', 'The paper orientation is portrait or landscape.');
      }
      if (!THEMES.includes(settings.theme)) add('settings.theme', 'The theme is auto, light or dark.');
    }
    if (!TIME_FORMATS.includes(settings.timeFormat)) add('settings.timeFormat', 'The time format is 12h or 24h.');
  }

  // ---- subjects
  const subjectIds = new Set();
  if (!Array.isArray(project.subjects)) {
    add('subjects', 'The subjects are a list.');
  } else {
    project.subjects.forEach((subject, i) => {
      const path = 'subjects[' + i + ']';
      if (!isObject(subject)) return add(path, 'A subject is an object.');
      const id = checkId(path, subject, 's');
      if (id) subjectIds.add(id);
      if (!isString(subject.code)) add(path + '.code', 'A subject code is text.');
      if (!isString(subject.name)) add(path + '.name', 'A subject name is text.');
      if (!isHexColour(subject.colour)) add(path + '.colour', 'A colour is written #rrggbb.');
      return undefined;
    });
  }

  // ---- teachers (ids first, so rooms can be checked against them)
  const teacherIds = new Set();
  const teachersOk = Array.isArray(project.teachers);
  if (!teachersOk) {
    add('teachers', 'The teachers are a list.');
  } else {
    project.teachers.forEach((teacher, i) => {
      if (!isObject(teacher)) return add('teachers[' + i + ']', 'A teacher is an object.');
      const id = checkId('teachers[' + i + ']', teacher, 't');
      if (id) teacherIds.add(id);
      return undefined;
    });
  }

  // ---- day types
  const dayTypeIds = new Set();
  const ownIds = new Set();
  if (!Array.isArray(project.dayTypes) || project.dayTypes.length === 0) {
    add('dayTypes', 'A project has at least one day type.');
  } else {
    project.dayTypes.forEach((dayType, i) => {
      const path = 'dayTypes[' + i + ']';
      if (!isObject(dayType)) return add(path, 'A day type is an object.');
      const id = checkId(path, dayType, 'd');
      if (id) dayTypeIds.add(id);
      if (!isString(dayType.name)) add(path + '.name', 'A day type name is text.');
      if (typeof dayType.own !== 'boolean') add(path + '.own', 'A day type says whether it is its own copy, true or false.');
      else if (i === 0 && dayType.own !== true) add(path + '.own', 'The first day type is always its own copy.');
      if (id && (i === 0 || dayType.own === true)) ownIds.add(id);
      if (!Array.isArray(dayType.bells)) {
        add(path + '.bells', 'A bell schedule is a list with one entry per period.');
      } else {
        if (periods !== null && dayType.bells.length !== periods) add(path + '.bells', 'A bell schedule has one entry per period: ' + periods + ', not ' + dayType.bells.length + '.');
        dayType.bells.forEach((bell, p) => {
          if (bell === null) return;
          const bellPath = path + '.bells[' + p + ']';
          if (!isObject(bell) || !isBellTime(bell.start) || !isBellTime(bell.end)) add(bellPath, 'A bell entry is null, or a start and an end written HH:MM on the 24-hour clock.');
          else if (i !== 0 && dayType.own === false) add(bellPath, 'A day type that is the same as the first has no bell times of its own.');
        });
      }
      return undefined;
    });
  }

  // ---- building
  const roomIds = new Set();
  const roomTeachers = new Map(); // room id -> teacher ids listed on the room
  const floorById = new Map();
  const building = project.building;
  if (!isObject(building)) {
    add('building', 'The building is an object.');
  } else {
    if (!Array.isArray(building.floors) || building.floors.length === 0) {
      add('building.floors', 'A building has at least one floor.');
    } else {
      const numbers = new Map();
      building.floors.forEach((floor, f) => {
        const path = 'building.floors[' + f + ']';
        if (!isObject(floor)) return add(path, 'A floor is an object.');
        const floorId = checkId(path, floor, 'f');
        if (!isString(floor.name)) add(path + '.name', 'A floor name is text.');
        if (!Number.isInteger(floor.level)) add(path + '.level', 'A floor level is a whole number.');
        const sizeOk = inRange(floor.width, RANGES.floorSize) && inRange(floor.height, RANGES.floorSize);
        if (!inRange(floor.width, RANGES.floorSize)) add(path + '.width', 'A floor is from ' + rangeText(RANGES.floorSize) + ' cells wide.');
        if (!inRange(floor.height, RANGES.floorSize)) add(path + '.height', 'A floor is from ' + rangeText(RANGES.floorSize) + ' cells tall.');
        const count = sizeOk ? floor.width * floor.height : 0;
        let cellsOk = false;
        if (!isString(floor.cells)) {
          add(path + '.cells', 'The cells are one string, a character per cell.');
        } else if (sizeOk && floor.cells.length !== count) {
          add(path + '.cells', 'The cells string has ' + floor.cells.length + ' characters; a ' + floor.width + ' by ' + floor.height + ' floor has ' + count + '.');
        } else if (/[^.#S]/.test(floor.cells)) {
          add(path + '.cells', 'A cell is ".", "#" or "S".');
        } else {
          cellsOk = sizeOk;
        }
        if (floorId && cellsOk) floorById.set(floorId, floor);
        const cellInGrid = (cell) => Number.isInteger(cell) && cell >= 0 && cell < count;

        // spaces
        const owner = new Map();
        if (!Array.isArray(floor.spaces)) {
          add(path + '.spaces', 'The spaces of a floor are a list.');
        } else {
          floor.spaces.forEach((space, s) => {
            const sp = path + '.spaces[' + s + ']';
            if (!isObject(space)) return add(sp, 'A space is an object.');
            const spaceId = checkId(sp, space, space.kind === 'room' ? 'r' : space.kind === 'other' ? 'o' : undefined);
            const own = new Set();
            if (!Array.isArray(space.cells) || space.cells.length === 0) {
              add(sp + '.cells', 'A space has at least one cell.');
            } else if (cellsOk) {
              space.cells.forEach((cell, c) => {
                const cp = sp + '.cells[' + c + ']';
                if (!cellInGrid(cell)) return add(cp, 'Cell ' + cell + ' is not on this floor.');
                if (own.has(cell)) return add(cp, 'Cell ' + cell + ' is listed twice.');
                own.add(cell);
                if (floor.cells[cell] !== CELL_EMPTY) add(cp, 'Cell ' + cell + ' is a corridor or stairs cell and cannot also belong to a space.');
                if (owner.has(cell)) add(cp, 'Cell ' + cell + ' already belongs to ' + owner.get(cell) + '.');
                else owner.set(cell, sp);
                return undefined;
              });
            }
            if (space.kind === 'room') {
              if (spaceId) {
                roomIds.add(spaceId);
                roomTeachers.set(spaceId, Array.isArray(space.teacherIds) ? space.teacherIds : []);
              }
              if (!isString(space.number)) {
                add(sp + '.number', 'A room number is text.');
              } else if (space.number.trim() !== '') {
                const key = roomNumberKey(space.number);
                if (numbers.has(key)) add(sp + '.number', 'Room number "' + space.number + '" is already used at ' + numbers.get(key) + '. Room numbers are unique across the building, whatever the capitals or the spaces around them.');
                else numbers.set(key, sp);
              }
              if (!Array.isArray(space.teacherIds)) {
                add(sp + '.teacherIds', 'The teachers of a room are a list of teacher ids.');
              } else {
                const seen = new Set();
                space.teacherIds.forEach((teacherId, t) => {
                  if (!teacherIds.has(teacherId)) add(sp + '.teacherIds[' + t + ']', 'There is no teacher with the id "' + teacherId + '".');
                  else if (seen.has(teacherId)) add(sp + '.teacherIds[' + t + ']', 'A teacher is listed on a room once.');
                  seen.add(teacherId);
                });
              }
              if (space.subjectId !== null && !subjectIds.has(space.subjectId)) add(sp + '.subjectId', 'A room\'s subject is null or the id of a subject on the list.');
              if (!isString(space.wing)) add(sp + '.wing', 'A wing is text.');
              if (space.capacity !== null && !inRange(space.capacity, RANGES.capacity)) add(sp + '.capacity', 'A capacity is empty or a whole number from ' + rangeText(RANGES.capacity) + '.');
              if (typeof space.shared !== 'boolean') add(sp + '.shared', 'Shared space is true or false.');
              if (!Array.isArray(space.doors)) {
                add(sp + '.doors', 'The doors of a room are a list.');
              } else if (cellsOk) {
                const seenDoors = new Set();
                space.doors.forEach((door, d) => {
                  const dp = sp + '.doors[' + d + ']';
                  if (!isObject(door) || !DOOR_SIDES.includes(door.side) || !own.has(door.cell)) return add(dp, 'A door names one of the room\'s own cells and a side: n, e, s or w.');
                  const key = door.cell + door.side;
                  if (seenDoors.has(key)) return add(dp, 'This door is listed twice.');
                  seenDoors.add(key);
                  const across = neighbourCell(floor, door.cell, door.side);
                  const there = across === -1 ? null : floor.cells[across];
                  if (there !== CELL_CORRIDOR && there !== CELL_STAIRS) add(dp, 'A door is on an outer edge of the room that faces a corridor or stairs cell. This one faces ' + (across === -1 ? 'the edge of the floor' : 'a cell that cannot be walked on') + '.');
                  return undefined;
                });
              }
            } else if (space.kind === 'other') {
              if (!isString(space.label)) add(sp + '.label', 'A label is text.');
              if (!OTHER_KINDS.includes(space.otherKind)) add(sp + '.otherKind', 'The kind of an other space is one of ' + OTHER_KINDS.join(', ') + '.');
              if (!isHexColour(space.colour)) add(sp + '.colour', 'A colour is written #rrggbb.');
            } else {
              add(sp + '.kind', 'A space is a room or an other space.');
            }
            return undefined;
          });
        }

        // corridor names
        if (!Array.isArray(floor.corridors)) {
          add(path + '.corridors', 'The corridor names of a floor are a list.');
        } else {
          const named = new Set();
          floor.corridors.forEach((corridor, k) => {
            const kp = path + '.corridors[' + k + ']';
            if (!isObject(corridor)) return add(kp, 'A corridor name is an object.');
            checkId(kp, corridor, 'k');
            if (!isString(corridor.name)) add(kp + '.name', 'A corridor name is text.');
            if (!Array.isArray(corridor.cells) || corridor.cells.length === 0) {
              add(kp + '.cells', 'A corridor name covers at least one cell.');
            } else if (cellsOk) {
              corridor.cells.forEach((cell, c) => {
                const cp = kp + '.cells[' + c + ']';
                if (!cellInGrid(cell) || floor.cells[cell] !== CELL_CORRIDOR) add(cp, 'A corridor name covers corridor cells only; cell ' + cell + ' is not one.');
                else if (named.has(cell)) add(cp, 'Cell ' + cell + ' already has a corridor name.');
                named.add(cell);
              });
            }
            return undefined;
          });
        }

        // exits
        if (!Array.isArray(floor.exits)) {
          add(path + '.exits', 'The exits of a floor are a list.');
        } else {
          const exitCells = new Set();
          floor.exits.forEach((exit, x) => {
            const xp = path + '.exits[' + x + ']';
            if (!isObject(exit)) return add(xp, 'An exit is an object.');
            checkId(xp, exit, 'x');
            if (!isString(exit.doorName)) add(xp + '.doorName', 'A door name is text.');
            if (!isString(exit.assembly)) add(xp + '.assembly', 'An assembly point is text.');
            if (cellsOk) {
              let onEdge = false;
              if (cellInGrid(exit.cell) && floor.cells[exit.cell] === CELL_CORRIDOR) {
                for (const side of DOOR_SIDES) {
                  const next = neighbourCell(floor, exit.cell, side);
                  if (next === -1 || (floor.cells[next] === CELL_EMPTY && !owner.has(next))) onEdge = true;
                }
              }
              if (!onEdge) add(xp + '.cell', 'An exit is on a corridor cell with at least one side that is empty or the edge of the floor.');
              else if (exitCells.has(exit.cell)) add(xp + '.cell', 'There is already an exit on cell ' + exit.cell + '.');
              exitCells.add(exit.cell);
            }
            return undefined;
          });
        }

        // traced image
        const image = floor.image;
        if (image !== null && image !== undefined) {
          const ip = path + '.image';
          if (!isObject(image)) {
            add(ip, 'A traced image is null or an object.');
          } else {
            if (!isString(image.imageId) || image.imageId === '') add(ip + '.imageId', 'A traced image names its stored image.');
            if (typeof image.opacity !== 'number' || !(image.opacity >= 0 && image.opacity <= 1)) add(ip + '.opacity', 'Opacity is a number from 0 to 1.');
            if (typeof image.scale !== 'number' || !(image.scale > 0) || !Number.isFinite(image.scale)) add(ip + '.scale', 'Scale is a number above 0.');
            for (const key of ['rotation', 'x', 'y']) if (!Number.isFinite(image[key])) add(ip + '.' + key, 'The ' + key + ' of a traced image is a number.');
            for (const key of ['visible', 'locked', 'missing']) if (typeof image[key] !== 'boolean') add(ip + '.' + key, 'The ' + key + ' flag of a traced image is true or false.');
            for (const key of ['width', 'height']) if (!Number.isInteger(image[key]) || image[key] < 1) add(ip + '.' + key, 'The ' + key + ' of a traced image is a whole number of pixels.');
          }
        } else if (image === undefined && project.format !== PUBLISHED_FORMAT) {
          add(path + '.image', 'A traced image is null or an object.');
        }
        return undefined;
      });
    }

    // connections
    if (!Array.isArray(building.connections)) {
      add('building.connections', 'The connections are a list.');
    } else {
      const labels = new Map();
      building.connections.forEach((connection, c) => {
        const path = 'building.connections[' + c + ']';
        if (!isObject(connection)) return add(path, 'A connection is an object.');
        checkId(path, connection, 'c');
        if (isBlank(connection.label)) add(path + '.label', 'A connection has a letter or a name.');
        else if (labels.has(connection.label)) add(path + '.label', 'The label "' + connection.label + '" is already used at ' + labels.get(connection.label) + '. Each stair connection has its own.');
        else labels.set(connection.label, path);
        if (!CONNECTION_DIRECTIONS.includes(connection.direction)) add(path + '.direction', 'A connection\'s direction is both, ab or ba.');
        const ends = [];
        for (const key of ['a', 'b']) {
          const end = connection[key];
          const floor = isObject(end) ? floorById.get(end.floorId) : undefined;
          if (!isObject(end) || !isString(end.floorId) || !Number.isInteger(end.cell)) {
            add(path + '.' + key, 'An end of a connection names a floor and a cell.');
          } else if (!floor) {
            add(path + '.' + key + '.floorId', 'There is no floor with the id "' + end.floorId + '".');
          } else if (floor.cells[end.cell] !== CELL_STAIRS) {
            add(path + '.' + key + '.cell', 'Both ends of a connection are stairs cells; cell ' + end.cell + ' on ' + floor.name + ' is not one.');
          } else {
            ends.push(end.floorId + ':' + end.cell);
          }
        }
        if (ends.length === 2 && ends[0] === ends[1]) add(path + '.b', 'A connection joins two different stairs cells.');
        return undefined;
      });
    }

    // zones
    if (project.format === PUBLISHED_FORMAT && building.zones === undefined) {
      // a published file carries no zones
    } else if (!Array.isArray(building.zones)) {
      add('building.zones', 'The zones are a list.');
    } else {
      building.zones.forEach((zone, z) => {
        const path = 'building.zones[' + z + ']';
        if (!isObject(zone)) return add(path, 'A zone is an object.');
        checkId(path, zone, 'z');
        if (!isString(zone.label)) add(path + '.label', 'A zone label is text.');
        const floor = floorById.get(zone.floorId);
        if (!floor) {
          add(path + '.floorId', 'A zone names a floor of this building.');
        } else {
          const whole = [zone.x, zone.y, zone.w, zone.h].every(Number.isInteger);
          if (!whole || zone.w < 1 || zone.h < 1 || zone.x < 0 || zone.y < 0 || zone.x + zone.w > floor.width || zone.y + zone.h > floor.height) add(path, 'A zone is a rectangle of whole cells inside its floor.');
        }
        return undefined;
      });
    }
  }

  // ---- teachers (the rest)
  if (teachersOk) {
    const names = new Map();
    project.teachers.forEach((teacher, i) => {
      const path = 'teachers[' + i + ']';
      if (!isObject(teacher)) return;
      if (isBlank(teacher.name)) {
        add(path + '.name', 'A teacher has a name.');
      } else {
        const key = nameKey(teacher.name);
        if (names.has(key)) add(path + '.name', 'The name "' + teacher.name + '" is already used at ' + names.get(key) + '. Each teacher is on the list once.');
        else names.set(key, path);
      }
      if (teacher.subjectId !== null && !subjectIds.has(teacher.subjectId)) add(path + '.subjectId', 'A teacher\'s subject is null or the id of a subject on the list.');
      if (!isString(teacher.notes)) add(path + '.notes', 'Notes are text.');
      if (!Array.isArray(teacher.roomIds)) {
        add(path + '.roomIds', 'The rooms of a teacher are a list of room ids.');
      } else {
        const seen = new Set();
        teacher.roomIds.forEach((roomId, r) => {
          const rp = path + '.roomIds[' + r + ']';
          if (!roomIds.has(roomId)) add(rp, 'There is no room with the id "' + roomId + '".');
          else if (seen.has(roomId)) add(rp, 'A room is listed for a teacher once.');
          else if (!roomTeachers.get(roomId).includes(teacher.id)) add(rp, 'The room does not list this teacher. A teacher\'s rooms and a room\'s teachers say the same thing.');
          seen.add(roomId);
        });
        for (const [roomId, listed] of roomTeachers) {
          if (listed.includes(teacher.id) && !seen.has(roomId)) add(path + '.roomIds', 'Room "' + roomId + '" lists this teacher, and the teacher does not list the room. A teacher\'s rooms and a room\'s teachers say the same thing.');
        }
      }
    });
  }

  // ---- groups
  if (!Array.isArray(project.groups)) {
    add('groups', 'The groups are a list.');
  } else {
    const names = new Map();
    project.groups.forEach((group, i) => {
      const path = 'groups[' + i + ']';
      if (!isObject(group)) return add(path, 'A group is an object.');
      checkId(path, group, 'g');
      if (isBlank(group.name)) {
        add(path + '.name', 'A group has a name.');
      } else {
        const key = nameKey(group.name);
        if (names.has(key)) add(path + '.name', 'The name "' + group.name + '" is already used at ' + names.get(key) + '. Group names are unique, whatever the capitals.');
        else names.set(key, path);
      }
      if (!isString(group.grade)) add(path + '.grade', 'A grade is text.');
      if (project.format !== PUBLISHED_FORMAT || group.headCount !== undefined) {
        if (group.headCount !== null && !inRange(group.headCount, RANGES.headCount)) add(path + '.headCount', 'A head count is empty or a whole number from ' + rangeText(RANGES.headCount) + '.');
      }
      if (!isHexColour(group.colour)) add(path + '.colour', 'A colour is written #rrggbb.');
      if (!isObject(group.days)) {
        add(path + '.days', 'The days of a group are an object with one list of slots per day type that is its own copy.');
        return undefined;
      }
      for (const dayTypeId of ownIds) {
        if (!Array.isArray(group.days[dayTypeId])) add(path + '.days.' + dayTypeId, 'The group has no day for this day type. Every day type that is its own copy has one.');
      }
      for (const dayTypeId of Object.keys(group.days)) {
        const dp = path + '.days.' + dayTypeId;
        const day = group.days[dayTypeId];
        if (!ownIds.has(dayTypeId)) {
          add(dp, dayTypeIds.has(dayTypeId) ? 'This day type is the same as the first, so a group has no day of its own for it.' : 'There is no day type with the id "' + dayTypeId + '".');
          continue;
        }
        if (!Array.isArray(day)) continue;
        if (periods !== null && day.length !== periods) add(dp, 'A day has one slot per period: ' + periods + ', not ' + day.length + '.');
        day.forEach((slot, p) => {
          const sp = dp + '[' + p + ']';
          if (!isObject(slot)) return add(sp, 'A slot is an object.');
          if (slot.room !== null && !roomIds.has(slot.room)) add(sp + '.room', 'A slot\'s room is null or the id of a room in the building.');
          if (!isString(slot.roomText)) add(sp + '.roomText', 'The room text of a slot is text.');
          if (!isString(slot.label)) add(sp + '.label', 'The label of a slot is text.');
          if (!Array.isArray(slot.teacherIds)) {
            add(sp + '.teacherIds', 'The teachers of a slot are a list of teacher ids.');
          } else {
            const seen = new Set();
            slot.teacherIds.forEach((teacherId, t) => {
              if (!teacherIds.has(teacherId)) add(sp + '.teacherIds[' + t + ']', 'There is no teacher with the id "' + teacherId + '".');
              else if (seen.has(teacherId)) add(sp + '.teacherIds[' + t + ']', 'A teacher is named on a slot once.');
              seen.add(teacherId);
            });
          }
          return undefined;
        });
      }
      return undefined;
    });
  }

  if (project.format === PUBLISHED_FORMAT) return findings;

  // ---- accepted findings
  if (!Array.isArray(project.accepted)) {
    add('accepted', 'The accepted findings are a list.');
  } else {
    project.accepted.forEach((accepted, i) => {
      const path = 'accepted[' + i + ']';
      if (!isObject(accepted)) return add(path, 'An accepted finding is an object.');
      if (!isString(accepted.findingId) || accepted.findingId === '') add(path + '.findingId', 'An accepted finding names the finding.');
      if (!isString(accepted.reason)) add(path + '.reason', 'A reason is text.');
      if (!isIsoDate(accepted.at)) add(path + '.at', 'The time a finding was accepted is an ISO date in UTC.');
      return undefined;
    });
  }

  // ---- scenario
  const scenario = project.scenario;
  if (scenario !== null) {
    if (!isObject(scenario)) {
      add('scenario', 'The scenario is null or an object.');
    } else {
      if (!isString(scenario.name)) add('scenario.name', 'A scenario name is text.');
      if (!Array.isArray(scenario.changes)) {
        add('scenario.changes', 'The changes of a scenario are a list.');
      } else {
        const wholePeriod = (value) => Number.isInteger(value) && value >= 0;
        scenario.changes.forEach((change, i) => {
          const path = 'scenario.changes[' + i + ']';
          if (!isObject(change) || !CHANGE_KINDS.includes(change.kind)) return add(path, 'A change is one of ' + CHANGE_KINDS.join(', ') + '.');
          if (!isString(change.dayTypeId)) add(path + '.dayTypeId', 'Every change names its own day type.');
          let sound = true;
          if (change.kind === 'move') sound = isString(change.groupId) && wholePeriod(change.period) && isString(change.roomId);
          if (change.kind === 'swapPeriods') sound = isString(change.groupId) && wholePeriod(change.periodA) && wholePeriod(change.periodB);
          if (change.kind === 'swapRooms') sound = isString(change.groupA) && isString(change.groupB) && wholePeriod(change.period);
          if (!sound) add(path, 'This ' + change.kind + ' change is missing one of its fields.');
          return undefined;
        });
      }
      const compared = scenario.compared;
      if (compared !== null) {
        const names = (list) => Array.isArray(list) && list.every(isString);
        if (!isObject(compared) || !isString(compared.fileName) || !names(compared.addedGroups) || !names(compared.removedGroups)) add('scenario.compared', 'The compared file is null, or a file name and two lists of group names.');
      }
    }
  }

  // ---- publish settings
  const publish = project.publish;
  if (!isObject(publish)) {
    add('publish', 'The publish settings are an object.');
  } else {
    if (!isString(publish.passcode)) add('publish.passcode', 'The passcode is text; empty means protection is off.');
    if (!inRange(publish.stalenessDays, RANGES.stalenessDays)) add('publish.stalenessDays', 'The staleness period is a whole number of days from ' + rangeText(RANGES.stalenessDays) + '.');
    if (!isObject(publish.views)) {
      add('publish.views', 'The published views are an object.');
    } else {
      for (const view of PUBLISH_VIEWS) if (typeof publish.views[view] !== 'boolean') add('publish.views.' + view, 'Each published view is switched on or off, true or false.');
    }
    if (typeof publish.teacherNamesOnMap !== 'boolean') add('publish.teacherNamesOnMap', 'Teacher names on the map is true or false.');
    if (publish.lastPublishedAt !== null && !isIsoDate(publish.lastPublishedAt)) add('publish.lastPublishedAt', 'The last published time is null or an ISO date in UTC.');
  }

  // ---- onboarding
  const onboarding = project.onboarding;
  if (!isObject(onboarding)) {
    add('onboarding', 'The getting-started record is an object.');
  } else {
    if (!isObject(onboarding.steps) || !Object.values(onboarding.steps).every((value) => value === true)) add('onboarding.steps', 'The steps done are an object whose values are all true.');
    if (typeof onboarding.dismissed !== 'boolean') add('onboarding.dismissed', 'Dismissed is true or false.');
    if (typeof onboarding.neverShow !== 'boolean') add('onboarding.neverShow', 'Never show is true or false.');
  }

  return findings;
}

export function isValid(project) {
  return validate(project).length === 0;
}
