// What the staff browser receives. publishedModel() is the one answer to
// "what does the published file contain?": a subset of the project, in the
// project's own shape, so every engine function the staff browser uses
// (teacherDay, effectiveSchedule, bellsFor, buildGraph, route, directions)
// takes it unchanged.
//
// It is built by naming every field that goes in. A field the planner gains
// later is not published until it is named here, so nothing reaches staff by
// accident. Never present: head counts, traced images, exclusion zones, the
// scenario, accepted findings, the getting-started record, the passcode, the
// settings only the planner uses, findings, and anything about the device.
//
// Nothing is dropped from what is named: a double-booked room, a teacher with
// two rooms and a slot whose room is not in the building are all published as
// they are.

import { PUBLISHED_FORMAT, CURRENT_VERSION, PUBLISH_VIEWS, LATER_PUBLISH_VIEWS, RANGES, defaultPublish, inRange, bellSchedulesOf, calendarOf } from './schema.js';
import { isCalendarDate, addDays } from './calendar.js';

export const PUBLISHED_VERSION = CURRENT_VERSION;

const DAY_MS = 24 * 60 * 60 * 1000;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function space(source) {
  if (source.kind === 'room') {
    return {
      id: source.id,
      kind: 'room',
      cells: list(source.cells).slice(),
      number: source.number,
      teacherIds: list(source.teacherIds).slice(),
      subjectId: source.subjectId,
      wing: source.wing,
      capacity: source.capacity,
      shared: source.shared,
      doors: list(source.doors).map((door) => ({ cell: door.cell, side: door.side })),
    };
  }
  return {
    id: source.id,
    kind: 'other',
    cells: list(source.cells).slice(),
    label: source.label,
    otherKind: source.otherKind,
    colour: source.colour,
  };
}

function floor(source) {
  return {
    id: source.id,
    name: source.name,
    level: source.level,
    width: source.width,
    height: source.height,
    cells: source.cells,
    spaces: list(source.spaces).map(space),
    corridors: list(source.corridors).map((corridor) => ({ id: corridor.id, name: corridor.name, cells: list(corridor.cells).slice() })),
    exits: list(source.exits).map((exit) => ({ id: exit.id, cell: exit.cell, doorName: exit.doorName, assembly: exit.assembly })),
  };
}

function connection(source) {
  return {
    id: source.id,
    label: source.label,
    a: { floorId: source.a.floorId, cell: source.a.cell },
    b: { floorId: source.b.floorId, cell: source.b.cell },
    direction: source.direction,
  };
}

function slot(source) {
  return { room: source.room, roomText: source.roomText, label: source.label, teacherIds: list(source.teacherIds).slice() };
}

function group(source) {
  const days = {};
  for (const [dayTypeId, day] of Object.entries(source.days || {})) days[dayTypeId] = list(day).map(slot);
  return { id: source.id, name: source.name, grade: source.grade, colour: source.colour, days };
}

function bells(source) {
  return list(source).map((bell) => (bell ? { start: bell.start, end: bell.end } : null));
}

// A bell schedule (ARCHITECTURE 17.3), field by field.
function bellSchedule(source) {
  return { id: source.id, name: source.name, short: source.short, bells: bells(source.bells), off: list(source.off).slice() };
}

// The calendar (ARCHITECTURE 17.4), field by field, with changedAt: spec
// 12.5's "the calendar if any". Null when there is none.
function calendar(source) {
  if (source === null) return null;
  return {
    start: source.start,
    end: source.end,
    weekdays: list(source.weekdays).map((rule) => ({ day: rule.day, bells: rule.bells })),
    rotation: list(source.rotation).slice(),
    dates: list(source.dates).map((entry) => ({ date: entry.date, day: entry.day, bells: entry.bells, label: entry.label })),
    changedAt: source.changedAt === undefined ? null : source.changedAt,
  };
}

// When is a file published at `published` (a Date) stale? With a calendar
// and publish.staleAtCalendarEnd (absent meaning true), the day after the
// calendar's last date at 12:00 UTC: a date is what the school means, and
// noon UTC falls on that date from UTC-11 to UTC+11 (ARCHITECTURE 17.4).
// Otherwise, or when that day is not after the publish time (a calendar
// that has already ended), publish.stalenessDays after it. Returns
// { staleAfter, why }: why is 'calendar', 'days', or 'calendar-ended' when a
// calendar was meant to say and could not, so the publish form can say why.
export function staleness(project, published) {
  const publish = project.publish || defaultPublish();
  const days = inRange(publish.stalenessDays, RANGES.stalenessDays) ? publish.stalenessDays : defaultPublish().stalenessDays;
  const byDays = new Date(published.getTime() + days * DAY_MS).toISOString();
  const source = calendarOf(project);
  if (source === null || publish.staleAtCalendarEnd === false || !isCalendarDate(source.end)) return { staleAfter: byDays, why: 'days' };
  const atEnd = addDays(source.end, 1) + 'T12:00:00.000Z';
  if (Date.parse(atEnd) <= published.getTime()) return { staleAfter: byDays, why: 'calendar-ended' };
  return { staleAfter: atEnd, why: 'calendar' };
}

// publishedModel(project, { clock }) → the published data. `clock` gives the
// publish time; staleness() says when the file goes stale.
export function publishedModel(project, options) {
  const opts = options || {};
  if (typeof opts.clock !== 'function') throw new TypeError('Publishing needs a clock.');
  const published = opts.clock();
  const settings = project.settings;
  const publish = project.publish || defaultPublish();
  // every view a project keeps a switch for, the calendar's too; absent is on
  const views = {};
  for (const view of PUBLISH_VIEWS.concat(LATER_PUBLISH_VIEWS)) views[view] = !publish.views || publish.views[view] !== false;
  return {
    format: PUBLISHED_FORMAT,
    version: PUBLISHED_VERSION,
    id: project.id,
    publishedAt: published.toISOString(),
    staleAfter: staleness(project, published).staleAfter,
    settings: {
      schoolName: settings.schoolName,
      periods: settings.periods,
      periodWord: settings.periodWord,
      defaultPassingSeconds: settings.defaultPassingSeconds,
      secondsPerCell: settings.secondsPerCell,
      secondsPerStair: settings.secondsPerStair,
      timeFormat: settings.timeFormat,
    },
    building: {
      floors: list(project.building.floors).map(floor),
      connections: list(project.building.connections).map(connection),
    },
    subjects: list(project.subjects).map((subject) => ({ id: subject.id, code: subject.code, name: subject.name, colour: subject.colour })),
    teachers: list(project.teachers).map((teacher) => ({ id: teacher.id, name: teacher.name, subjectId: teacher.subjectId, roomIds: list(teacher.roomIds).slice(), notes: teacher.notes })),
    // sameAs null and short "" when a project saved before them has none
    dayTypes: list(project.dayTypes).map((dayType) => ({
      id: dayType.id,
      name: dayType.name,
      own: dayType.own,
      sameAs: typeof dayType.sameAs === 'string' ? dayType.sameAs : null,
      short: typeof dayType.short === 'string' ? dayType.short : '',
      bells: bells(dayType.bells),
    })),
    bellSchedules: bellSchedulesOf(project).map(bellSchedule),
    calendar: calendar(calendarOf(project)),
    groups: list(project.groups).map(group),
    publish: { views, teacherNamesOnMap: publish.teacherNamesOnMap !== false },
  };
}

// Is the file protected? An empty passcode means protection is off.
export function isProtected(project) {
  return Boolean(project.publish) && typeof project.publish.passcode === 'string' && project.publish.passcode !== '';
}
