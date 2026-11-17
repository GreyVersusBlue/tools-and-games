// The school as the pages ask about it: one object made from the published
// data, with the lookups every view needs and the engine's own answers behind
// them. No rule is written here. A teacher's day is engine/teacher-day.js's,
// a bell time is engine/bells.js's, a route is engine/routing.js's: the same
// functions the planner uses, run on the published data.

import { findById, findRoom, floorOfRoom, allRooms, findFloor, bellSchedulesOf, calendarOf, DAY_CLOSED, BELLS_REGULAR, ELEVATOR_KIND, REFUGE_DEFAULT_NAME, elevatorCars, stairsLetter, nameKey } from '../engine/schema.js';
import { ownDayTypes, isOwnCopy, effectiveSchedule, effectiveDayType, dayShort, bellsShort } from '../engine/day-types.js';
import { bellsFor, findBellSchedule, periodName, periodLabel, periodWordForms, parseTime, formatTime } from '../engine/bells.js';
import { dayOn, calendarDays, isCalendarDate, addDays, daysBetween, weekdayOf, dateWords } from '../engine/calendar.js';
import { teacherDay, awayWords } from '../engine/teacher-day.js';
import { awayEntries } from '../engine/marks.js';
import { roomName, formatDuration } from '../engine/findings.js';
import { buildGraph } from '../engine/graph.js';
import { routingGraph, route } from '../engine/routing.js';
import { directions, CELL_UNITS } from '../engine/directions.js';

export const SCHOOL_FALLBACK_NAME = 'Staff schedule';

// Is this connection an elevator's? Its kind says so (ARCHITECTURE 19.2); a
// connection with no kind is stairs. The views ask this and never read the
// kind themselves.
export function isElevatorLink(link) {
  return Boolean(link) && link.kind === ELEVATOR_KIND;
}

// What a stairs connection is called on screen: its stairwell's letter when it
// has one, else its own. The views ask this and never read the label themselves
// (the views reach the engine only through the school).
export function letterOfStairs(link) {
  return stairsLetter(link);
}

// The one-way stairs that touch a floor, grouped by letter (a stairwell's
// flights are one letter, compared as names are), in the building's order:
// [{ id, letter, ways, text, sentence }]. `ways` is each distinct way a flight
// there may be walked, { way: 'up only' | 'down only' | 'one way only', from,
// to } by floor name (between floors the way goes by floor level; on one floor
// it is "one way only"). A letter whose flights all go one way reads
// "Stairs B (up only)" as a `text` and "Stairs B is up only." as a `sentence`;
// one with flights of different ways says each, "Stairs A: up only from Floor 1
// to Floor 2, down only from Floor 3 to Floor 2", never two sentences that
// contradict. A stair that runs both ways is not listed.
export function oneWayGroups(data, floor) {
  const building = data && data.building ? data.building : {};
  const floors = Array.isArray(building.floors) ? building.floors : [];
  const links = Array.isArray(building.connections) ? building.connections : [];
  const at = (id) => floors.find((each) => each && each.id === id) || { level: 0, name: '' };
  const touches = (end) => Boolean(end) && end.floorId === floor.id;
  const groups = new Map();
  for (const link of links) {
    if (!link || isElevatorLink(link) || (link.direction !== 'ab' && link.direction !== 'ba') || !(touches(link.a) || touches(link.b))) continue;
    const from = link.direction === 'ab' ? link.a : link.b;
    const to = link.direction === 'ab' ? link.b : link.a;
    const rise = at(to.floorId).level - at(from.floorId).level;
    const way = { way: rise > 0 ? 'up only' : rise < 0 ? 'down only' : 'one way only', from: at(from.floorId).name, to: at(to.floorId).name };
    const letter = letterOfStairs(link);
    const key = nameKey(letter);
    if (!groups.has(key)) groups.set(key, { id: link.id, letter, ways: [] });
    const held = groups.get(key).ways;
    if (!held.some((other) => other.way === way.way && other.from === way.from && other.to === way.to)) held.push(way);
  }
  return Array.from(groups.values()).map((group) => {
    const kinds = new Set(group.ways.map((each) => each.way));
    if (kinds.size === 1) {
      const way = group.ways[0].way;
      return { ...group, ways: group.ways, text: 'Stairs ' + group.letter + ' (' + way + ')', sentence: 'Stairs ' + group.letter + ' is ' + way + '.' };
    }
    const said = group.ways.map((each) => (each.way === 'one way only' ? 'one way only on ' + each.from : each.way + ' from ' + each.from + ' to ' + each.to)).join(', ');
    return { ...group, text: 'Stairs ' + group.letter + ': ' + said, sentence: 'Stairs ' + group.letter + ': ' + said + '.' };
  });
}

export function openSchool(data) {
  let graph = null;
  // the calendar with one reader's answer laid over it (see dayOn below),
  // made once for each answer
  const answered = new Map();
  const school = {
    data,
    // The school's name as typed, or the plain words when none was given.
    name: typeof data.settings.schoolName === 'string' && data.settings.schoolName.trim() !== '' ? data.settings.schoolName : SCHOOL_FALLBACK_NAME,
    // The elevators of the building: [{ id, label, stops: [{ floorId, cell }], connectionIds, staffOnly }]
    // (engine/schema.js elevatorCars), the stops no connection reaches included.
    elevators() {
      return elevatorCars(data.building);
    },
    // An area of refuge's name as typed, or the plain words when it has none.
    refugeName(refuge) {
      return refuge && typeof refuge.name === 'string' && refuge.name.trim() !== '' ? refuge.name : REFUGE_DEFAULT_NAME;
    },
    teachers: data.teachers,
    groups: data.groups,
    subjects: data.subjects,
    floors: data.building.floors,
    dayTypes: data.dayTypes,
    rooms: allRooms(data),
    // Is a view in this file? The publisher chose which to include.
    has(view) {
      return data.publish.views[view] !== false;
    },
    teacher(id) {
      return findById(data.teachers, id);
    },
    // The teacher's away entries that apply to a day type (always and
    // sometimes), in words: [{ words, sometimes, periods }], for a day card.
    // An entry that holds nowhere is not listed (engine/marks.js awayEntry).
    awayOf(teacherId, dayTypeId) {
      return awayEntries(findById(data.teachers, teacherId), dayTypeId, { project: data }).map((read) => ({ words: awayWords(data.settings, read.entry, data.dayTypes), sometimes: read.sometimes, periods: read.periods }));
    },
    group(id) {
      return findById(data.groups, id);
    },
    subject(id) {
      return id ? findById(data.subjects, id) : null;
    },
    room(id) {
      return findRoom(data, id);
    },
    floor(id) {
      return findFloor(data, id);
    },
    floorOfRoom(id) {
      return floorOfRoom(data, id);
    },
    // "Room 204", "Gym", "a room with no number".
    roomName(room, start) {
      return roomName(room, start);
    },
    // The day types that have a day of their own, and whether one does.
    ownDayTypes() {
      return ownDayTypes(data);
    },
    isOwnCopy(dayTypeId) {
      return isOwnCopy(data, dayTypeId);
    },
    periodName(index) {
      return periodName(data.settings, index);
    },
    // The school's word for a period in every form ("Lesson", "Lessons"), for
    // sentences and column heads: { one, many, oneLower, manyLower, count }.
    periodWords() {
      return periodWordForms(data.settings);
    },
    // The period without its word, for a badge on a room: "3", "C", "3rd".
    periodLabel(index) {
      return periodLabel(data.settings, index);
    },
    time(value) {
      return formatTime(value, data.settings.timeFormat);
    },
    // A bell time as minutes after midnight, or null when it is not one.
    parseTime(value) {
      return parseTime(value);
    },
    // A length of time in the engine's words: "45 s", "4 min 19 s".
    formatDuration(seconds) {
      return formatDuration(seconds);
    },
    // When each period rings on day type D: its regular bells, or with B
    // the times of bell schedule B, a period B leaves out being { off: true }.
    bells(dayTypeId, bellsId) {
      return bellsFor(data, dayTypeId, bellsId);
    },
    // The other bell schedules (early release, assembly), in the school's
    // order; none in a file published before there were any.
    bellSchedules: bellSchedulesOf(data).filter((schedule) => schedule && typeof schedule.id === 'string'),
    bellSchedule(bellsId) {
      return findBellSchedule(data, bellsId);
    },
    // The own day type whose classes D has: D, or the one it is the same as.
    effectiveDayType(dayTypeId) {
      return effectiveDayType(data, dayTypeId);
    },
    // "A", "ER": the short names of the calendar's squares.
    dayShort(dayType) {
      return dayShort(dayType, data.dayTypes);
    },
    bellsShort(schedule) {
      return bellsShort(schedule, school.bellSchedules);
    },
    // ---- the calendar (engine/calendar.js), when the file has one
    calendar: calendarOf(data),
    // Every date the calendar covers, first to last; none without one.
    calendarDays() {
      return calendarDays(data);
    },
    // What day type and bells `date` ("YYYY-MM-DD") is, by the calendar's
    // rule. `answer` ({ date, dayTypeId, bellsId }) is a reader's own word on
    // an earlier date, laid over the calendar as a dated change of its own so
    // the rotation follows on from it (ARCHITECTURE 17.9).
    dayOn(date, answer) {
      const calendar = calendarOf(data);
      if (!answer || calendar === null) return dayOn(data, date);
      const key = JSON.stringify([answer.date, answer.dayTypeId, answer.bellsId]);
      if (!answered.has(key)) {
        const dates = (Array.isArray(calendar.dates) ? calendar.dates : []).filter((entry) => !entry || entry.date !== answer.date);
        const change = { date: answer.date, day: answer.dayTypeId === null ? DAY_CLOSED : answer.dayTypeId, bells: answer.bellsId === null ? BELLS_REGULAR : answer.bellsId, label: '' };
        answered.set(key, { ...data, calendar: { ...calendar, dates: dates.concat([change]) } });
      }
      return dayOn(answered.get(key), date);
    },
    isDate(value) {
      return isCalendarDate(value);
    },
    addDays(date, days) {
      return addDays(date, days);
    },
    daysBetween(from, to) {
      return daysBetween(from, to);
    },
    // 0 Monday to 6 Sunday.
    weekdayOf(date) {
      return weekdayOf(date);
    },
    // "26 November 2026"; { weekday: true } "Thursday 26 November 2026";
    // { year: false } leaves the year out.
    dateWords(date, options) {
      return dateWords(date, options);
    },
    teacherDay(teacherId, dayTypeId) {
      return teacherDay(data, teacherId, dayTypeId);
    },
    groupDay(groupId, dayTypeId) {
      return effectiveSchedule(data, groupId, dayTypeId);
    },
    // The walkable building, worked out the first time something asks.
    graph() {
      if (graph === null) graph = routingGraph(data, buildGraph(data));
      return graph;
    },
    route(fromRoomId, toRoomId, options) {
      return route(school.graph(), fromRoomId, toRoomId, options);
    },
    // Written for a reader: distances in cells of the floor plan, the
    // planner's word too (spec 2).
    directions(found) {
      return directions(data, found, CELL_UNITS);
    },
  };
  return school;
}
