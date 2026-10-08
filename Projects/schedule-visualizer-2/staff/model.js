// The school as the pages ask about it: one object made from the published
// data, with the lookups every view needs and the engine's own answers behind
// them. No rule is written here. A teacher's day is engine/teacher-day.js's,
// a bell time is engine/bells.js's, a route is engine/routing.js's: the same
// functions the planner uses, run on the published data.

import { findById, findRoom, floorOfRoom, allRooms, findFloor } from '../engine/schema.js';
import { ownDayTypes, isOwnCopy, effectiveSchedule } from '../engine/day-types.js';
import { bellsFor, periodName, formatTime } from '../engine/bells.js';
import { teacherDay } from '../engine/teacher-day.js';
import { roomName } from '../engine/findings.js';
import { buildGraph } from '../engine/graph.js';
import { routingGraph, route } from '../engine/routing.js';
import { directions } from '../engine/directions.js';

export const SCHOOL_FALLBACK_NAME = 'Staff schedule';

export function openSchool(data) {
  let graph = null;
  const school = {
    data,
    // The school's name as typed, or the plain words when none was given.
    name: typeof data.settings.schoolName === 'string' && data.settings.schoolName.trim() !== '' ? data.settings.schoolName : SCHOOL_FALLBACK_NAME,
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
    time(value) {
      return formatTime(value, data.settings.timeFormat);
    },
    bells(dayTypeId) {
      return bellsFor(data, dayTypeId);
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
    directions(found) {
      return directions(data, found);
    },
  };
  return school;
}
