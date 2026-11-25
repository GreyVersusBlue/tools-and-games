// A teacher's own movement through one day (ARCHITECTURE 23.6, as revised by
// 23.12): where the teacher is in each period, the walks between those rooms,
// and notes for the periods that cannot be drawn. Plain Node, no page. The
// movement view's teacher picture reads it, and so does anything that wants
// the line and the figure of a teacher's walk to be one route.
//
//   teacherTrail(project, graph, { teacherId, dayTypeId, bellsId, cache, walks })
//
// returns null when the teacher or the day type is not in the project, else
//
//   { teacherId, dayTypeId, bellsId,
//     stops: [{ period, kind, marked, rooms: [{ roomId, roomText }], groupIds }],
//     walks: [{ period, toPeriod, fromRoomId, toRoomId, route, walking, riding,
//               passingSeconds, late, failed, across }],
//     notes: [{ period, kind, roomIds, text, parts }] }
//
// stops   teacherDay's entry for each period that meets under the bells, in
//         period order (an off period of the bell schedule is left out).
//         `rooms` is entryPlaces: each room of the building once (roomText
//         ''), and each room that is not in the building once (roomId null,
//         roomText as the slot kept it). A planning period has none.
// walks   in period order, each routed by teacherRoute, the one route call
//         teacherWalks makes, so the line drawn and the figure timed are one
//         route. `period` is the period walked out of, `toPeriod` the one
//         walked into, `across` the periods between that are free (empty for
//         a walk from one period into the next that meets).
//           consecutive  every move bellMoves names: two periods that meet one
//                        after the other, a single room in each, the rooms
//                        differing. walking, riding, late and failed are
//                        copied from `walks` (walkResults' teacher entries of
//                        this run), the entry matched by teacher, period, the
//                        two rooms and the passing time. With no match (the
//                        answer is not in yet, or it differs) the walk keeps
//                        its route and has no figure: all four null.
//           across       a walk from the last room taught to the next room
//                        taught over one or more periods in which the
//                        teacher is free (isFree). `walking` is
//                        walkingSeconds (a ride counted inside it, `riding`
//                        null), `late` is null (nobody is waiting for the
//                        teacher), `failed` true for a route with no way
//                        through, `passingSeconds` the time from the end of
//                        the first period to the start of the next taught one
//                        when both bells are known, else null. A gap period
//                        that is not free (a duty, lunch, an away day, a
//                        period nobody meets in) draws no walk across it: the
//                        teacher's whereabouts are not known.
// notes   a period in two rooms draws no walk into or out of it; a room that
//         is not in the building says so. `text` is the sentence, `parts` the
//         same with each typed name marked ({ text, name: true }), as the
//         movement view's sentences are built.
//
// options.walks is the teacher entries of the run's walkResults, as
// runResults(results, dayTypeId, bellsId).walks.teachers gives them (the
// object { teachers } is read too); left out, no walk has a figure.
// options.cache is a route cache (createRouteCache(16) on the page, one of
// its own); left out, a fresh one. options.geometryVersion, ways,
// avoidConnections and shutCells are routing's, passed to teacherRoute.

import { findById, findRoom, nameOfRoom } from './schema.js';
import { routingGraph, createRouteCache } from './routing.js';
import { bellMoves, teacherRoute, walkingSeconds, transitionPlan } from './crowd.js';
import { teacherDays, entryRoomIds, entryPlaces, isFree } from './teacher-day.js';
import { bellsFor, offPeriods, parseTime, periodName } from './bells.js';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function countWord(n) {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function listParts(items) {
  const parts = [];
  items.forEach((item, i) => {
    if (i > 0) parts.push({ text: i === items.length - 1 ? ' and ' : ', ' });
    parts.push(item);
  });
  return parts;
}

function textOf(parts) {
  return parts.map((part) => part.text).join('');
}

// A room as the note names it: its number as typed ("204"), or the words of
// a room with no number.
function roomPart(project, roomId) {
  const room = findRoom(project, roomId);
  if (!room) return { text: 'a room that is not in the building' };
  return typeof room.number === 'string' && room.number.trim() !== '' ? { text: room.number, name: true } : { text: nameOfRoom(room) };
}

function noteOf(period, kind, roomIds, parts) {
  return { period, kind, roomIds, text: textOf(parts), parts };
}

function twoRoomsNote(project, teacher, period, roomIds) {
  const parts = [{ text: 'In ' + periodName(project.settings, period) + ' ' }, { text: teacher.name, name: true }, { text: ' is in ' + countWord(roomIds.length) + ' rooms (' }];
  parts.push(...listParts(roomIds.map((roomId) => roomPart(project, roomId))));
  parts.push({ text: '), so no walk is drawn to or from it.' });
  return noteOf(period, 'two-rooms', roomIds, parts);
}

function missingNote(project, teacher, period, texts) {
  const shown = texts.map((text) => (text.trim() === '' ? { text: 'a room with no number' } : { text, name: true }));
  const parts = [{ text: 'In ' + periodName(project.settings, period) + ' ' }, { text: teacher.name, name: true }, { text: ' is in ' }];
  parts.push(...listParts(shown));
  parts.push({ text: texts.length === 1 ? ', which is not in the building, so no route can be drawn to it.' : ', which are not in the building, so no routes can be drawn to them.' });
  return noteOf(period, 'room-missing', [], parts);
}

function figuresOf(walks) {
  if (Array.isArray(walks)) return walks;
  return walks && Array.isArray(walks.teachers) ? walks.teachers : [];
}

const NO_FIGURE = { walking: null, riding: null, late: null, failed: null };

export function teacherTrail(project, graph, options) {
  const opts = options || {};
  const teacher = findById(project.teachers, opts.teacherId);
  if (!teacher) return null;
  const bellsId = typeof opts.bellsId === 'string' ? opts.bellsId : null;
  const days = teacherDays(project, opts.dayTypeId, bellsId === null ? undefined : { bellsId });
  const day = days ? days.get(teacher.id) : null;
  if (!day) return null;
  const off = offPeriods(project, bellsId);
  const bells = bellsId === null ? bellsFor(project, opts.dayTypeId) : bellsFor(project, opts.dayTypeId, bellsId);
  const figures = figuresOf(opts.walks).filter((walk) => walk && walk.teacherId === teacher.id);

  const routing = routingGraph(project, graph);
  const routeOptions = { cache: opts.cache ? opts.cache : createRouteCache(16) };
  for (const key of ['geometryVersion', 'ways', 'avoidConnections', 'shutCells']) if (opts[key] !== undefined) routeOptions[key] = opts[key];

  const meets = [];
  for (let period = 0; period < day.length; period += 1) if (!off.has(period)) meets.push(period);

  const stops = meets.map((period) => {
    const entry = day[period];
    return { period, kind: entry.kind, marked: entry.marked, rooms: entryPlaces(entry).map((place) => ({ roomId: place.roomId, roomText: place.roomText })), groupIds: entry.groups.map((taught) => taught.groupId) };
  });

  const notes = [];
  for (const period of meets) {
    const entry = day[period];
    const roomIds = entryRoomIds(entry);
    if (roomIds.length >= 2) notes.push(twoRoomsNote(project, teacher, period, roomIds));
    const missing = entryPlaces(entry).filter((place) => place.roomId === null).map((place) => place.roomText);
    if (missing.length > 0) notes.push(missingNote(project, teacher, period, missing));
  }

  const walks = [];

  // consecutive: bellMoves' moves, timed as teacherWalks times them
  for (const move of bellMoves(day, off)) {
    const plan = transitionPlan(project, bells, move.period);
    const passingSeconds = plan === null ? null : plan.passing;
    const route = teacherRoute(routing, move.fromRoomId, move.toRoomId, routeOptions);
    const match = figures.find((walk) => walk.period === move.period && walk.fromRoomId === move.fromRoomId && walk.toRoomId === move.toRoomId && walk.passingSeconds === passingSeconds);
    let figure = NO_FIGURE;
    if (match) {
      figure = match.failed === true
        ? { walking: null, riding: null, late: match.late === true, failed: true }
        : { walking: match.walking, riding: typeof match.riding === 'number' ? match.riding : 0, late: match.late === true, failed: false };
    }
    walks.push({ period: move.period, toPeriod: move.toPeriod === undefined ? move.period + 1 : move.toPeriod, fromRoomId: move.fromRoomId, toRoomId: move.toRoomId, route, ...figure, passingSeconds, across: [] });
  }

  // across: from the last room taught to the next over periods that are free
  const taught = meets.filter((period) => day[period].kind === 'teaching');
  for (let i = 0; i + 1 < taught.length; i += 1) {
    const from = taught[i];
    const to = taught[i + 1];
    const gap = meets.filter((period) => period > from && period < to);
    if (gap.length === 0 || !gap.every((period) => isFree(day[period]))) continue;
    const here = entryRoomIds(day[from]);
    const there = entryRoomIds(day[to]);
    if (here.length !== 1 || there.length !== 1 || here[0] === there[0]) continue;
    const route = teacherRoute(routing, here[0], there[0], routeOptions);
    const walking = walkingSeconds(routing, route);
    const stranded = walking === null && route && route.ok === false && (route.reason === 'unreachable' || route.reason === 'no-entry');
    if (walking === null && !stranded) continue;
    const ends = parseTime(bells[from].end);
    const starts = parseTime(bells[to].start);
    const passingSeconds = ends !== null && starts !== null && starts > ends ? (starts - ends) * 60 : null;
    walks.push({ period: from, toPeriod: to, fromRoomId: here[0], toRoomId: there[0], route, walking: stranded ? null : walking, riding: null, passingSeconds, late: null, failed: stranded, across: gap });
  }
  walks.sort((a, b) => a.period - b.period);
  notes.sort((a, b) => a.period - b.period);

  return { teacherId: teacher.id, dayTypeId: opts.dayTypeId, bellsId, stops, walks, notes };
}
