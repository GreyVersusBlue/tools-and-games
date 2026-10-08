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

import { PUBLISHED_FORMAT, CURRENT_VERSION, PUBLISH_VIEWS, RANGES, defaultPublish, inRange } from './schema.js';

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

// publishedModel(project, { clock }) → the published data. `clock` gives the
// publish time; the file is stale `publish.stalenessDays` days after it.
export function publishedModel(project, options) {
  const opts = options || {};
  if (typeof opts.clock !== 'function') throw new TypeError('Publishing needs a clock.');
  const published = opts.clock();
  const settings = project.settings;
  const publish = project.publish || defaultPublish();
  const days = inRange(publish.stalenessDays, RANGES.stalenessDays) ? publish.stalenessDays : defaultPublish().stalenessDays;
  const views = {};
  for (const view of PUBLISH_VIEWS) views[view] = !publish.views || publish.views[view] !== false;
  return {
    format: PUBLISHED_FORMAT,
    version: PUBLISHED_VERSION,
    id: project.id,
    publishedAt: published.toISOString(),
    staleAfter: new Date(published.getTime() + days * DAY_MS).toISOString(),
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
    dayTypes: list(project.dayTypes).map((dayType) => ({
      id: dayType.id,
      name: dayType.name,
      own: dayType.own,
      bells: list(dayType.bells).map((bell) => (bell ? { start: bell.start, end: bell.end } : null)),
    })),
    groups: list(project.groups).map(group),
    publish: { views, teacherNamesOnMap: publish.teacherNamesOnMap !== false },
  };
}

// Is the file protected? An empty passcode means protection is off.
export function isProtected(project) {
  return Boolean(project.publish) && typeof project.publish.passcode === 'string' && project.publish.passcode !== '';
}
