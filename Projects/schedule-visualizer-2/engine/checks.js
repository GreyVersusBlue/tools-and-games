// The schedule checks of spec 5.7. checkSchedule(project, walkResults) runs
// every kind over every day type that is its own copy and gives
//
//   { findings, accepted, changed, off, gone }
//
// `findings` are the ones that count, in the order of the findings table;
// `accepted` are the ones the school has accepted, set apart and never
// dropped. The other three are accepted records, as the project holds them:
// `changed` when the finding is still there and names somebody else now (it
// counts again), `off` when its check is switched off, `gone` when nothing
// matches it in this run. findings.js's splitAccepted has the rule.
// findings.js has the shape of a finding, the ids, and the shape of
// `walkResults`, which is null until the routes and the crowd model have run.
//
// A day type that is "the same as A Day" is not checked a second time: what
// is true of A Day is reported once, and the sentence names both day types.
//
// The rules, one per kind:
//
//   room-double          two or more groups in one room in one period, unless
//                        the room is a shared space.
//   teacher-double       a teacher's day (teacher-day.js) puts them in two or
//                        more places in one period. A room that is not in the
//                        building is a place too, told apart by the number
//                        its slots kept.
//   over-capacity        a group has more students than its room seats. In a
//                        shared space the groups there together are counted.
//   no-planning          a teacher has a group in every period of the day.
//   consecutive          a teacher has a group in more periods in a row than
//                        the school's limit.
//   teacher-walk,        a walk the figures handed in call late, when the
//   group-walk           figure is for the walk as it is now: the same two
//                        rooms and the same passing time.
//   room-missing         a slot names a room that is not in the building.
//   empty-period         a slot with no room at all. A group with no room all
//                        day gets one note, not one a period.
//   teacher-multi-room   a teacher is based in two or more rooms.
//   teacher-room-unused  a room a teacher is based in has no group all day.
//                        One note a room, naming everybody based there.
//   room-unused          a numbered room nobody is based in has no group all
//                        day. (A room somebody is based in is the note above,
//                        so one empty room is one note.)
//   room-no-subject      a numbered room has no subject.
//   room-no-teacher      a room has a group in it and neither the room nor
//                        the slot names a teacher. One note a room.
//
// Head counts fall back to the school default, as everywhere else.

import { allRooms, findRoom, findById, resolveSlotRoom } from './schema.js';
import { ownDayTypes, effectiveSchedule, isOwnCopy, findDayType } from './day-types.js';
import { bellsFor, periodName } from './bells.js';
import { teacherDays, slotTeacherIds, entryPlaces, teacherMoves } from './teacher-day.js';
import { makeFinding, sortFindings, splitAccepted, countWord, listWords, periodWord, roomName, formatDuration } from './findings.js';

// "on A Day", or "on A Day and B Day" when B Day is the same as A Day.
function onDays(project, dayType) {
  const names = [dayType.name];
  if (project.dayTypes[0] === dayType) {
    for (let i = 1; i < project.dayTypes.length; i += 1) {
      if (project.dayTypes[i].own !== true) names.push(project.dayTypes[i].name);
    }
  }
  return 'on ' + listWords(names);
}

function isNumbered(room) {
  return typeof room.number === 'string' && room.number.trim() !== '';
}

function headCount(project, group) {
  return Number.isInteger(group.headCount) ? group.headCount : project.settings.defaultHeadCount;
}

function isWholeSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function checkSchedule(project, walkResults) {
  const settings = project.settings;
  const periods = settings.periods;
  const checks = settings.checks || {};
  const off = new Set(Array.isArray(checks.off) ? checks.off : []);
  const limit = Number.isInteger(checks.consecutiveLimit) && checks.consecutiveLimit >= 1 ? checks.consecutiveLimit : 4;
  const margin = isWholeSeconds(checks.passingMarginSeconds) ? checks.passingMarginSeconds : 0;
  const word = periodWord(settings, false);
  const rooms = allRooms(project);

  const found = [];
  const ids = new Set();
  const add = (kind, parts, text, where, about) => {
    if (off.has(kind)) return null;
    const finding = makeFinding(kind, parts, text, where, about);
    if (ids.has(finding.id)) return null;
    ids.add(finding.id);
    found.push(finding);
    return finding;
  };
  // finding id -> { start, end } of a consecutive run, for splitAccepted
  const runs = new Map();

  // room id -> the first slot found there with no teacher, for room-no-teacher
  const untaught = new Map();
  const ownDays = ownDayTypes(project);

  ownDays.forEach((dayType, dayIndex) => {
    const d = dayType.id;
    const on = onDays(project, dayType);
    const occupancy = [];
    for (let p = 0; p < periods; p += 1) occupancy.push(new Map());
    const used = new Set();

    for (const group of project.groups) {
      const day = effectiveSchedule(project, group.id, d);
      const empty = [];
      for (let p = 0; p < periods; p += 1) {
        const slot = day[p];
        const resolved = resolveSlotRoom(project, slot);
        if (resolved.room) {
          const roomId = resolved.room.id;
          if (!occupancy[p].has(roomId)) occupancy[p].set(roomId, []);
          occupancy[p].get(roomId).push(group);
          used.add(roomId);
          if (slotTeacherIds(project, slot).length === 0) {
            const first = untaught.get(roomId);
            if (!first) untaught.set(roomId, { dayType, dayIndex, period: p, groups: [group] });
            else if (first.dayIndex === dayIndex && first.period === p) first.groups.push(group);
            else if (first.dayIndex === dayIndex && p < first.period) untaught.set(roomId, { dayType, dayIndex, period: p, groups: [group] });
          }
        } else if (resolved.missing) {
          const named = resolved.text === '' ? 'a room' : '"' + resolved.text + '"';
          add('room-missing', [d, p, group.id],
            group.name + ' is scheduled into ' + named + ' in ' + periodName(settings, p) + ' ' + on + ', and that room is not in the building. Pick a room that is in the building, or draw this one.',
            { dayTypeId: d, period: p, groupIds: [group.id] });
        } else {
          empty.push(p);
        }
      }
      if (empty.length === periods) {
        add('empty-period', [d, group.id],
          group.name + ' has no room in any ' + word + ' ' + on + '.',
          { dayTypeId: d, groupIds: [group.id] });
      } else {
        for (const p of empty) {
          add('empty-period', [d, p, group.id],
            group.name + ' has no room in ' + periodName(settings, p) + ' ' + on + '.',
            { dayTypeId: d, period: p, groupIds: [group.id] });
        }
      }
    }

    for (let p = 0; p < periods; p += 1) {
      const when = periodName(settings, p) + ' ' + on;
      for (const [roomId, groups] of occupancy[p]) {
        const room = findRoom(project, roomId);
        const names = groups.map((group) => group.name);
        const where = { dayTypeId: d, period: p, roomId };

        if (groups.length > 1 && room.shared !== true) {
          add('room-double', [d, p, roomId],
            roomName(room, true) + ' has ' + countWord(groups.length) + ' groups in ' + when + ': ' + listWords(names) + '. '
              + (groups.length === 2 ? 'One of them needs' : 'All but one of them need') + ' another room or another ' + word + '.',
            { ...where, groupIds: groups.map((group) => group.id) });
        }

        if (Number.isInteger(room.capacity)) {
          if (room.shared === true && groups.length > 1) {
            const total = groups.reduce((sum, group) => sum + headCount(project, group), 0);
            if (total > room.capacity) {
              add('over-capacity', [d, p, roomId],
                roomName(room, true) + ' seats ' + room.capacity + ' and has ' + total + ' students in ' + when + ': '
                  + listWords(groups.map((group) => group.name + ' (' + headCount(project, group) + ')')) + '. One of them needs a larger room or another ' + word + '.',
                { ...where, groupIds: groups.map((group) => group.id) });
            }
          } else {
            const large = groups.filter((group) => headCount(project, group) > room.capacity);
            if (large.length === 1) {
              add('over-capacity', [d, p, roomId],
                large[0].name + ' has ' + headCount(project, large[0]) + ' students and ' + roomName(room, false) + ' seats ' + room.capacity + ', in ' + when + '. The group needs a larger room.',
                { ...where, groupIds: [large[0].id] });
            } else if (large.length > 1) {
              add('over-capacity', [d, p, roomId],
                roomName(room, true) + ' seats ' + room.capacity + ', and ' + countWord(large.length) + ' groups there in ' + when + ' are each larger than that: '
                  + listWords(large.map((group) => group.name + ' (' + headCount(project, group) + ')')) + '. Each needs a larger room.',
                { ...where, groupIds: large.map((group) => group.id) });
            }
          }
        }
      }
    }

    const days = teacherDays(project, d);
    const basedIn = new Map();
    for (const teacher of project.teachers) {
      const day = days.get(teacher.id);

      for (const entry of day) {
        const places = entryPlaces(entry);
        if (places.length < 2) continue;
        // each place already holds an "and", so the places are set apart by "; "
        const named = places.map((place) => {
          const names = place.groupIds.map((groupId) => findById(project.groups, groupId).name);
          const where = place.roomId === null ? '"' + place.roomText + '" (not in the building)' : roomName(findRoom(project, place.roomId), false);
          return where + ' with ' + listWords(names);
        });
        const roomIds = places.filter((place) => place.roomId !== null).map((place) => place.roomId).sort();
        add('teacher-double', [d, entry.period, teacher.id],
          teacher.name + ' is in ' + countWord(places.length) + ' rooms in ' + periodName(settings, entry.period) + ' ' + on + ': ' + named.join('; ') + '. '
            + (places.length === 2 ? 'One of those groups needs' : 'All but one of those groups need') + ' another teacher or another ' + word + '.',
          { dayTypeId: d, period: entry.period, groupIds: places.flatMap((place) => place.groupIds), roomId: roomIds.length > 0 ? roomIds[0] : null, teacherId: teacher.id });
      }

      if (day.every((entry) => entry.kind === 'teaching')) {
        add('no-planning', [d, teacher.id],
          teacher.name + ' has no planning ' + word + ' ' + on + ': there is a group in every ' + word + '.',
          { dayTypeId: d, teacherId: teacher.id });
      }

      let start = 0;
      while (start < periods) {
        if (day[start].kind !== 'teaching') {
          start += 1;
          continue;
        }
        let end = start;
        while (end + 1 < periods && day[end + 1].kind === 'teaching') end += 1;
        const length = end - start + 1;
        if (length > limit) {
          const run = add('consecutive', [d, start, teacher.id],
            teacher.name + ' teaches ' + length + ' ' + periodWord(settings, true) + ' in a row ' + on + ', ' + periodName(settings, start) + ' to ' + periodName(settings, end) + '. The limit set for this school is ' + limit + '.',
            { dayTypeId: d, period: start, teacherId: teacher.id, groupIds: day[start].groups.map((taught) => taught.groupId) }, [teacher.id]);
          if (run) runs.set(run.id, { start, end });
        }
        start = end + 1;
      }

      for (const roomId of Array.isArray(teacher.roomIds) ? teacher.roomIds : []) {
        if (used.has(roomId) || !findRoom(project, roomId)) continue;
        if (!basedIn.has(roomId)) basedIn.set(roomId, []);
        if (!basedIn.get(roomId).includes(teacher)) basedIn.get(roomId).push(teacher);
      }
    }

    // one empty room is one note, however many teachers are based in it:
    // named with the room's main teacher first, as the room lists them
    for (const [roomId, based] of basedIn) {
      const room = findRoom(project, roomId);
      const order = Array.isArray(room.teacherIds) ? room.teacherIds : [];
      const place = (teacher) => (order.includes(teacher.id) ? order.indexOf(teacher.id) : order.length);
      const named = based.map((teacher, index) => ({ teacher, index })).sort((a, b) => place(a.teacher) - place(b.teacher) || a.index - b.index).map((entry) => entry.teacher);
      const teacherIds = based.map((teacher) => teacher.id).sort();
      add('teacher-room-unused', [d, teacherIds[0], roomId],
        roomName(room, true) + ', where ' + listWords(named.map((teacher) => teacher.name)) + (named.length === 1 ? ' is' : ' are') + ' based, has no group in any ' + word + ' ' + on + '.',
        { dayTypeId: d, roomId, teacherId: teacherIds[0] }, teacherIds);
    }

    for (const room of rooms) {
      if (!isNumbered(room) || used.has(room.id)) continue;
      if (Array.isArray(room.teacherIds) && room.teacherIds.length > 0) continue;
      add('room-unused', [d, room.id],
        roomName(room, true) + ' has no group in any ' + word + ' ' + on + '.',
        { dayTypeId: d, roomId: room.id });
    }
  });

  for (const teacher of project.teachers) {
    const based = (Array.isArray(teacher.roomIds) ? teacher.roomIds : []).map((roomId) => findRoom(project, roomId)).filter(Boolean);
    if (based.length < 2) continue;
    add('teacher-multi-room', [teacher.id],
      teacher.name + ' is based in ' + countWord(based.length) + ' rooms: ' + listWords(based.map((room) => roomName(room, false))) + '.',
      { teacherId: teacher.id, roomId: based[0].id });
  }

  for (const room of rooms) {
    if (isNumbered(room) && !findById(project.subjects, room.subjectId)) {
      add('room-no-subject', [room.id], roomName(room, true) + ' has no subject.', { roomId: room.id });
    }
    const first = untaught.get(room.id);
    if (first) {
      add('room-no-teacher', [room.id],
        roomName(room, true) + ' has groups scheduled into it and no teacher, starting with ' + listWords(first.groups.map((group) => group.name)) + ' in ' + periodName(settings, first.period) + ' ' + onDays(project, first.dayType) + '.',
        { dayTypeId: first.dayType.id, period: first.period, groupIds: first.groups.map((group) => group.id), roomId: room.id });
    }
  }

  if (walkResults) {
    const passingText = (seconds) => 'the passing time is ' + formatDuration(seconds) + (margin > 0 ? ' plus a margin of ' + formatDuration(margin) : '');
    const ownDay = (dayTypeId) => (isOwnCopy(project, dayTypeId) ? findDayType(project, dayTypeId) : null);
    const isTransition = (period) => Number.isInteger(period) && period >= 0 && period < periods - 1;

    for (const walk of Array.isArray(walkResults.groups) ? walkResults.groups : []) {
      if (!walk || walk.late !== true || !isTransition(walk.period) || !isWholeSeconds(walk.total)) continue;
      const dayType = ownDay(walk.dayTypeId);
      const group = findById(project.groups, walk.groupId);
      if (!dayType || !group) continue;
      const day = effectiveSchedule(project, group.id, dayType.id);
      const from = resolveSlotRoom(project, day[walk.period]).room;
      const to = resolveSlotRoom(project, day[walk.period + 1]).room;
      if (!from || !to || from === to) continue;
      // a figure for other rooms, or decided against another passing time,
      // is not a figure for this walk
      if (walk.fromRoomId !== from.id || walk.toRoomId !== to.id) continue;
      if (walk.passingSeconds !== bellsFor(project, dayType.id)[walk.period].passingAfter) continue;
      const passing = walk.passingSeconds;
      const after = ' after ' + periodName(settings, walk.period) + ' ' + onDays(project, dayType);
      const text = walk.arrived === false
        ? group.name + ' did not arrive at ' + roomName(to, false) + ' from ' + roomName(from, false) + after + ': it was still on the way after ' + formatDuration(walk.total) + ', and ' + passingText(passing) + '.'
        : group.name + ' needs ' + formatDuration(walk.total) + ' to get from ' + roomName(from, false) + ' to ' + roomName(to, false) + after
          + (isWholeSeconds(walk.waiting) && walk.waiting > 0 ? ', ' + formatDuration(walk.waiting) + ' of it waiting in crowded corridors' : '') + ', and ' + passingText(passing) + '.';
      add('group-walk', [dayType.id, walk.period, group.id], text, { dayTypeId: dayType.id, period: walk.period, groupIds: [group.id], roomId: to.id });
    }

    const daysOf = new Map();
    for (const walk of Array.isArray(walkResults.teachers) ? walkResults.teachers : []) {
      if (!walk || walk.late !== true || !isTransition(walk.period) || !isWholeSeconds(walk.walking)) continue;
      const dayType = ownDay(walk.dayTypeId);
      const teacher = findById(project.teachers, walk.teacherId);
      if (!dayType || !teacher) continue;
      if (!daysOf.has(dayType.id)) daysOf.set(dayType.id, teacherDays(project, dayType.id));
      const day = daysOf.get(dayType.id).get(teacher.id);
      const move = teacherMoves(day).find((candidate) => candidate.period === walk.period);
      if (!move || walk.fromRoomId !== move.fromRoomId || walk.toRoomId !== move.toRoomId) continue;
      if (walk.passingSeconds !== bellsFor(project, dayType.id)[walk.period].passingAfter) continue;
      add('teacher-walk', [dayType.id, walk.period, teacher.id],
        teacher.name + ' needs ' + formatDuration(walk.walking) + ' to walk from ' + roomName(findRoom(project, move.fromRoomId), false) + ' to ' + roomName(findRoom(project, move.toRoomId), false)
          + ' after ' + periodName(settings, walk.period) + ' ' + onDays(project, dayType) + ', before any crowding, and ' + passingText(walk.passingSeconds) + '.',
        { dayTypeId: dayType.id, period: walk.period, groupIds: day[walk.period + 1].groups.map((taught) => taught.groupId), roomId: move.toRoomId, teacherId: teacher.id }, [teacher.id]);
    }
  }

  return splitAccepted(sortFindings(found, project), project.accepted, { off, limit, runs });
}
