// The step-free route sheet (spec 11, "a printable route sheet for one person's
// day"; DESIGN 13.7; ARCHITECTURE 19.7): one group's or one teacher's day on
// one day type, each transition's step-free way from room to room, timed for
// one person.
//
// render(project, derived, options) → { title, html }
//   options.groupId     the group whose day it is; or
//   options.teacherId   the teacher whose day it is. Both left out: the first
//                       group that needs step-free routes, else the first
//                       group, else the first teacher. An id that is nobody's
//                       prints one sheet saying so, never someone else's day.
//   options.dayTypeId   the day type: its sheet alone. Left out, or not a day
//                       type of the project, every day type that is its own
//                       copy, each starting a sheet, and a line for the day
//                       types that are the same as another
//   options.bellsId     a bell schedule: the day under those bells, with no
//                       walk into or out of a period that does not meet
//   options.movement    { project, results, graph }: the movement view's own
//                       state (as ./travel-time.js). Given, the sheet is made
//                       from that project, and a step-free group that
//                       Movement shows late in a transition says so there
//                       (the whole group, with its trips when it needs more
//                       than one). `derived.results` serves the same when the
//                       planner has them. With neither, no such line: this
//                       module never works the crowd out.
//   and what every output takes (document.js)
//
// A person's day is the engine's own: a group's meeting slots
// (engine/runs.js, effectiveSchedule with the periods that do not meet
// emptied) or a teacher's day (engine/teacher-day.js), the bells' passing
// times (crowd.js transitionPlan, which also skips a period that does not
// meet and walks across one), and routing.js's `route` with avoidStairs: the
// step-free plan, which leaves staff-only elevators open, as any step-free
// route does. The time is crowd.js's walkingSeconds, the one figure every
// screen calls walking: cells at the school's pace, and each ride's wait and
// travel for one person, so the sheet's time and Movement's agree where a
// group of one would. Nothing here works out a route of its own.
//
// Per transition, one of:
//   a block    "Period 2 → Period 3 · Room 204 to Room 310": the numbered
//              directions (engine/directions.js, as a door card's), the
//              time, the passing time and whether it fits, and, only when the
//              route changes floor, a map of each floor it passes
//              (plan-svg.js, drawn as the door cards draw theirs)
//   a block    with the routing engine's own sentence, when no step-free
//              route joins the two rooms
//   a line     for a person who stays in the room, has no room, is in more
//              than one, or whose room is not in the building
//
// Every name is as typed: escaped, and set in a span with dir="auto". No
// clock is read: the date line is options.now.

import { route, routingGraph } from '../../engine/routing.js';
import { walkingSeconds, transitionPlan, isLate } from '../../engine/crowd.js';
import { directions } from '../../engine/directions.js';
import { cardSteps, CROP_MARGIN } from '../../engine/evacuation.js';
import { bellsFor, periodName } from '../../engine/bells.js';
import { findDayType, ownDayTypes, effectiveDayType } from '../../engine/day-types.js';
import { meetingSlots } from '../../engine/runs.js';
import { teacherDay, entryPlaces } from '../../engine/teacher-day.js';
import { ELEVATOR_KIND, elevatorSettings, nameOfRoom } from '../../engine/schema.js';
import { list } from '../components/words.js';
import { durationWords } from '../scenarios/model.js';
import { runOf } from '../movement/model.js';
import { travelDay } from '../movement/tables.js';
import { planSvg } from './plan-svg.js';
import { esc, frame, mm, paperOf, printableBox } from './document.js';

export const id = 'route-sheet';
export const name = 'Step-free route sheet';

export const TIMES_SAY = 'Times are for one person, without crowds, including each elevator’s wait.';
export const NOBODY_SAYS = 'There is no group or teacher to print a route sheet for. Add one in the Schedule section, then print it again.';
export const NOTHING_SAYS = 'Nobody walks anywhere on this day: no two periods that follow each other have a room in them.';

// How large a cell of a route map is drawn at most, and how tall a map stands
// at most, in millimetres; the gap between two maps.
export const CELL_MM = 4.2;
export const MAP_TALL_MM = 62;
export const MAP_GAP_MM = 6; // the gap of .rs__maps in ui/print.css

function typed(value) {
  return '<span dir="auto">' + esc(value) + '</span>';
}

function upper(text) {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------- who and when

function lookup(project) {
  const rooms = new Map();
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') rooms.set(space.id, { room: space, floor });
  }
  return rooms;
}

// The person the sheet is for: { kind: 'group' | 'teacher', item } or null.
function personFor(project, options) {
  const opts = options || {};
  const given = (value) => typeof value === 'string' && value !== '';
  if (given(opts.groupId)) {
    const item = project.groups.find((group) => group.id === opts.groupId);
    return item ? { kind: 'group', item } : null;
  }
  if (given(opts.teacherId)) {
    const item = project.teachers.find((teacher) => teacher.id === opts.teacherId);
    return item ? { kind: 'teacher', item } : null;
  }
  const first = project.groups.find((group) => group.stepFree === true) || project.groups[0];
  if (first) return { kind: 'group', item: first };
  return project.teachers[0] ? { kind: 'teacher', item: project.teachers[0] } : null;
}

// Where the person is in each period, in the three ways it can be told:
//   { at: 'room', roomId } | { at: 'none' } | { at: 'many' } | { at: 'missing', text }
function placesOf(project, person, dayTypeId, bellsId, rooms) {
  const periods = project.settings.periods;
  if (person.kind === 'group') {
    const slots = meetingSlots(project, person.item.id, dayTypeId, bellsId) || [];
    return Array.from({ length: periods }, (_, period) => {
      const slot = slots[period];
      if (!slot) return { at: 'none' };
      if (typeof slot.room === 'string' && slot.room !== '') return rooms.has(slot.room) ? { at: 'room', roomId: slot.room } : { at: 'missing', text: typeof slot.roomText === 'string' ? slot.roomText : '' };
      const text = typeof slot.roomText === 'string' ? slot.roomText.trim() : '';
      return text === '' ? { at: 'none' } : { at: 'missing', text: slot.roomText };
    });
  }
  const day = teacherDay(project, person.item.id, dayTypeId, bellsId ? { bellsId } : undefined) || [];
  return Array.from({ length: periods }, (_, period) => {
    const entry = day[period];
    if (!entry) return { at: 'none' };
    const places = entryPlaces(entry);
    if (places.length === 0) return { at: 'none' };
    if (places.length > 1) return { at: 'many' };
    return places[0].roomId === null ? { at: 'missing', text: places[0].roomText } : { at: 'room', roomId: places[0].roomId };
  });
}

// ---------------------------------------------------------------- the route

function boxOf(floor, cells) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const cell of cells) {
    const x = cell % floor.width;
    const y = (cell - x) / floor.width;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const x = Math.max(0, left - CROP_MARGIN);
  const y = Math.max(0, top - CROP_MARGIN);
  return { x, y, width: Math.min(floor.width - 1, right + CROP_MARGIN) - x + 1, height: Math.min(floor.height - 1, bottom + CROP_MARGIN) - y + 1 };
}

// The floors a route passes, in the order it first reaches them: each with
// every cell it walks there (a floor it leaves and returns to is one map with
// both stretches on it), its start where the walk leaves the first room, its
// end where it reaches the second, and the window that holds them.
function floorsOf(project, found, from, to) {
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const held = [];
  const seen = new Map();
  for (const place of found.cells) {
    let one = seen.get(place.floorId);
    if (!one) {
      one = { floorId: place.floorId, name: floors.get(place.floorId).name, cells: [], start: null, end: null, box: null };
      seen.set(place.floorId, one);
      held.push(one);
    }
    one.cells.push(place.cell);
  }
  const last = found.cells[found.cells.length - 1];
  seen.get(found.from.floorId).start = found.from.cell;
  seen.get(last.floorId).end = last.cell;
  for (const one of held) {
    const room = [];
    if (from.floor.id === one.floorId) room.push(...from.room.cells);
    if (to.floor.id === one.floorId) room.push(...to.room.cells);
    one.box = boxOf(floors.get(one.floorId), one.cells.concat(room));
  }
  return held;
}

// The elevators a route rides, once each: [{ letter, staffOnly }], from the
// connections the route crosses.
function carsOf(project, found) {
  const connections = new Map(project.building.connections.map((connection) => [connection.id, connection]));
  const cars = [];
  for (const connectionId of found.connections || []) {
    const connection = connections.get(connectionId);
    if (!connection || connection.kind !== ELEVATOR_KIND) continue;
    const letter = typeof connection.car === 'string' && connection.car !== '' ? connection.car : typeof connection.label === 'string' ? connection.label : '';
    if (!cars.some((car) => car.letter === letter)) cars.push({ letter, staffOnly: connection.staffOnly === true });
  }
  return cars;
}

// What Movement says of this walk, from its results: the whole group is late
// in it. Only for a group that needs step-free routes, whose walk Movement
// timed on the same kind of route; null for anyone else, and when there are
// no results.
function lateFrom(project, results, day, person, period, toPeriod) {
  if (!results || person.kind !== 'group' || person.item.stepFree !== true) return null;
  const run = runOf(results, day.id, day.bellsId);
  const walk = run && run.walks ? run.walks.groups.find((each) => each.groupId === person.item.id && each.period === period && (each.toPeriod === undefined ? toPeriod === period + 1 : each.toPeriod === toPeriod)) : null;
  if (!walk || walk.late !== true) return null;
  const heads = Number.isInteger(person.item.headCount) ? person.item.headCount : project.settings.defaultHeadCount;
  const trips = walk.riding > 0 ? Math.max(1, Math.ceil(heads / elevatorSettings(project.settings).perTrip)) : 1;
  return { trips };
}

// The whole sheet as data, for the document and for a test to read.
//   → { ok: false } when nobody is there to print a day for, else
//     { ok: true, kind, name, day, bellsId, blocks, staffOnly, walks }
//   day         { id, name, heading } as ui/movement/tables.js travelDay
//   walks       how many blocks are walks
//   staffOnly   the letters of the staff-only cars any route rides
//   a block     { kind: 'walk', period, toPeriod, from, to, ok, steps, text, seconds,
//                passing, fits, spare, over, within, cars, floors, late }
//               or { kind: 'same' | 'none' | 'many' | 'missing', period, toPeriod, … }
//               from and to are room names ({ name }); ok is false when no
//               step-free route joins them, with `sentence` for why
export function routeSheet(project, options) {
  const opts = options || {};
  const person = personFor(project, opts);
  if (!person) return { ok: false };
  const asked = opts.dayTypeId ? findDayType(project, opts.dayTypeId) : null;
  const chosen = asked || ownDayTypes(project)[0] || project.dayTypes[0];
  const bellsId = typeof opts.bellsId === 'string' && opts.bellsId !== '' ? opts.bellsId : undefined;
  const day = travelDay(project, chosen.id, bellsId);
  const rooms = lookup(project);
  const places = placesOf(project, person, chosen.id, bellsId, rooms);
  const bells = bellsFor(project, chosen.id, bellsId);
  const graph = routingGraph(project, opts.movement && opts.movement.graph ? opts.movement.graph : undefined);
  const margin = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
  const results = opts.movement && opts.movement.results ? opts.movement.results : opts.derived && opts.derived.results ? opts.derived.results : null;
  const staffOnly = [];
  const blocks = [];
  let walks = 0;
  const roomName = (roomId) => nameOfRoom(rooms.get(roomId).room, false);
  for (let period = 0; period + 1 < bells.length; period += 1) {
    const plan = transitionPlan(project, bells, period);
    if (plan === null) continue;
    const head = { period, toPeriod: plan.to };
    const a = places[period];
    const b = places[plan.to];
    const bad = [a, b].find((end) => end.at !== 'room');
    if (bad) {
      const which = a.at !== 'room' ? period : plan.to;
      blocks.push({ ...head, kind: bad.at, in: which, text: bad.at === 'missing' ? bad.text : '' });
      continue;
    }
    if (a.roomId === b.roomId) {
      blocks.push({ ...head, kind: 'same', room: roomName(a.roomId) });
      continue;
    }
    walks += 1;
    const from = rooms.get(a.roomId);
    const to = rooms.get(b.roomId);
    const block = { ...head, kind: 'walk', from: roomName(a.roomId), to: roomName(b.roomId), passing: plan.passing };
    const found = route(graph, a.roomId, b.roomId, { avoidStairs: true });
    if (found.ok !== true) {
      const said = directions(project, found);
      blocks.push({ ...block, ok: false, sentence: said.text });
      continue;
    }
    const seconds = walkingSeconds(graph, found);
    const steps = cardSteps(directions(project, found).steps);
    const cars = carsOf(project, found);
    for (const car of cars) if (car.staffOnly && !staffOnly.includes(car.letter)) staffOnly.push(car.letter);
    const floors = floorsOf(project, found, from, to);
    const fits = seconds <= plan.passing;
    blocks.push({
      ...block,
      ok: true,
      steps,
      text: steps.map((step) => step.n + '. ' + step.text).join('\n'),
      seconds,
      fits,
      spare: fits ? plan.passing - seconds : 0,
      over: fits ? 0 : seconds - plan.passing,
      within: !fits && !isLate(seconds, plan.passing, margin),
      margin,
      cars,
      floors: floors.length > 1 ? floors : [],
      late: lateFrom(project, results, day, person, period, plan.to),
    });
  }
  return { ok: true, kind: person.kind, name: person.item.name, day, bellsId: bellsId || null, blocks, staffOnly, walks };
}

// ---------------------------------------------------------------- the words

// "Period 2 → Period 3", across periods that do not meet when there are any.
export function blockTitle(project, block) {
  return periodName(project.settings, block.period) + ' → ' + periodName(project.settings, block.toPeriod);
}

// The time line of a walk as its three parts: "1 min 50 s", "passing time 4
// min" and the verdict, "fits, 2 min 10 s to spare" or "over by 25 s" (within
// the school's margin, "over by 5 s, inside the 10 s margin": it is late only
// past the margin).
export function timeParts(block) {
  const spare = block.spare === 0 ? 'fits, with no time to spare' : 'fits, ' + durationWords(block.spare) + ' to spare';
  const over = 'over by ' + durationWords(block.over) + (block.within ? ', inside the ' + durationWords(block.margin) + ' margin' : '');
  return { time: durationWords(block.seconds), passing: 'passing time ' + durationWords(block.passing), verdict: block.fits ? spare : over };
}

export function timeWords(block) {
  const parts = timeParts(block);
  return parts.time + ' \u00b7 ' + parts.passing + ' \u00b7 ' + parts.verdict;
}

export function lateWords(late) {
  return 'Movement shows the whole group late here' + (late.trips > 1 ? ' (' + late.trips + ' trips)' : '');
}

function carWords(cars) {
  return cars.map((car) => 'Elevator ' + car.letter);
}

// The map's label for a screen reader: "Route from Floor 1 to Floor 3 by Elevator D".
export function mapLabel(block) {
  const first = block.floors[0];
  const last = block.floors[block.floors.length - 1];
  const by = block.cars.length === 0 ? '' : ' by ' + carWords(block.cars).join(' then ');
  return 'Route from ' + first.name + ' to ' + last.name + by;
}

// A one-line transition, in markup: what a person typed is set apart.
function lineMarkup(project, block) {
  const named = esc(periodName(project.settings, block.in === undefined ? block.period : block.in));
  if (block.kind === 'same') return 'Stays in ' + typed(block.room) + '.';
  if (block.kind === 'many') return 'In more than one room in ' + named + ', so there is no one route.';
  if (block.kind === 'missing') return (block.text.trim() === '' ? 'The room' : 'Room ' + typed(block.text)) + ' in ' + named + ' is not in the building, so there is no route.';
  return 'No room in ' + named + ', so no walk.';
}

function stepWords(step) {
  const parts = Array.isArray(step.parts) && step.parts.length > 0 ? step.parts : [{ text: step.text, name: false }];
  return parts.map((part) => (part.name ? typed(part.text) : esc(part.text))).join('');
}

function stepsList(steps) {
  return '<ul class="card__steps rs__steps">' + steps.map((step) => '<li class="card__step" data-n="' + step.n + '"><span class="card__n">' + step.n + '.</span> <span class="card__words">' + stepWords(step) + '</span></li>').join('') + '</ul>';
}

// A block's maps in one row at one scale, each cropped to its floor's window.
function mapsMarkup(project, block, width) {
  const byId = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const plans = block.floors.map((held) => planSvg(project, byId.get(held.floorId), { crop: held.box, route: { cells: held.cells, start: held.start, exit: held.end } }));
  const across = plans.reduce((sum, plan) => sum + plan.width, 0);
  const tall = Math.max(...plans.map((plan) => plan.height));
  const cell = Math.max(0.1, Math.min(CELL_MM, (width - (plans.length - 1) * MAP_GAP_MM) / across, MAP_TALL_MM / tall));
  const figures = block.floors.map((held, i) => {
    const what = held.start !== null && held.end !== null ? ' · start and end' : held.start !== null ? ' · start' : held.end !== null ? ' · end' : '';
    return '<figure class="card__map rs__map" data-floor="' + esc(held.floorId) + '">'
      + '<div class="card__plan" style="width: ' + mm(plans[i].width * cell) + '; height: ' + mm(plans[i].height * cell) + ';">' + plans[i].svg + '</div>'
      + '<figcaption class="card__map-name">' + typed(held.name) + esc(what) + '</figcaption>'
      + '</figure>';
  });
  return '<div class="rs__maps" role="img" aria-label="' + esc(mapLabel(block)) + '">' + figures.join('') + '</div>';
}

function blockMarkup(project, block, width) {
  const where = ' data-period="' + block.period + '"' + (block.toPeriod !== block.period + 1 ? ' data-to="' + block.toPeriod + '"' : '');
  if (block.kind !== 'walk') return '<p class="rs__line" data-kind="' + block.kind + '"' + where + '>' + esc(blockTitle(project, block)) + ' \u00b7 ' + lineMarkup(project, block) + '</p>';
  const head = '<h2>' + esc(blockTitle(project, block)) + ' · ' + typed(block.from) + ' to ' + typed(block.to) + '</h2>';
  const open = '<section class="doc-section rs__block" data-kind="walk" data-ok="' + block.ok + '"' + where + '>';
  if (!block.ok) return open + head + '<p class="rs__noroute" data-line="no-route">' + typed(block.sentence) + '</p></section>';
  const parts = timeParts(block);
  const verdict = block.fits ? esc(parts.verdict) : '<span class="rs__over">' + esc(parts.verdict) + '</span>';
  const time = '<span class="rs__time" data-fits="' + block.fits + '">' + esc(parts.time + ' \u00b7 ' + parts.passing + ' \u00b7 ') + verdict + '</span>';
  const late = block.late ? ' · <span class="rs__movement" data-line="movement">' + esc(lateWords(block.late)) + '</span>' : '';
  return open + head + stepsList(block.steps) + '<p class="rs__result" data-line="time">' + time + late + '</p>' + (block.floors.length > 0 ? mapsMarkup(project, block, width) : '') + '</section>';
}

// "Elevator D is staff and authorised only: arrange access with the office."
function staffOnlyMarkup(letters) {
  const spans = letters.map((letter) => typed(letter));
  const joined = spans.length <= 1 ? spans.join('') : spans.slice(0, -1).join(', ') + ' and ' + spans[spans.length - 1];
  return '<p class="doc-meaning rs__staff" data-line="staff-only">' + (letters.length === 1 ? 'Elevator ' + joined + ' is' : 'Elevators ' + joined + ' are') + ' staff and authorised only: arrange access with the office.</p>';
}

// The sheets a person's days make: the day type asked for, else each own day
// type, in order. [{ ...routeSheet, }] with nothing when nobody is there.
export function routeSheets(project, options) {
  const opts = options || {};
  const asked = opts.dayTypeId ? findDayType(project, opts.dayTypeId) : null;
  const days = asked ? [asked] : ownDayTypes(project);
  const sheets = days.map((day) => routeSheet(project, { ...opts, dayTypeId: day.id }));
  return sheets.every((sheet) => sheet.ok) ? sheets : [];
}

// The line under the sheets of a day with day types that are the same as
// another: whose route sheet they share.
export function followerWords(project, followers) {
  const as = followers.map((dayType) => effectiveDayType(project, dayType.id));
  const one = followers.length === 1;
  const sameAsOne = as.every((own) => own.id === as[0].id);
  const who = sameAsOne ? followers.map((dayType) => dayType.name) : followers.map((dayType, index) => dayType.name + ' (the same as ' + as[index].name + ')');
  return (sameAsOne ? list(who) + (one ? ' is' : ' are') + ' the same as ' + as[0].name + ' and ' : list(who) + ' ') + (one ? 'has' : 'have') + ' the same route sheet' + (sameAsOne || one ? '' : 's') + '.';
}

function sheetBody(project, sheet, width) {
  const body = [];
  body.push('<p class="doc-lead rs__who" data-line="who" data-kind="' + sheet.kind + '">' + (sheet.kind === 'group' ? 'Group' : 'Teacher') + ' ' + typed(sheet.name) + ' \u00b7 ' + typed(sheet.day.heading) + '</p>');
  body.push('<p class="doc-meaning" data-line="times">' + esc(TIMES_SAY) + '</p>');
  if (sheet.staffOnly.length > 0) body.push(staffOnlyMarkup(sheet.staffOnly));
  if (sheet.walks === 0) body.push('<p class="doc-none" data-line="nothing">' + esc(NOTHING_SAYS) + '</p>');
  for (const block of sheet.blocks) body.push(blockMarkup(project, block, width));
  return body.join('\n');
}

export function render(project, derived, options) {
  const opts = options || {};
  const given = opts.movement && opts.movement.project && opts.movement.results && opts.movement.results.routes ? opts.movement.project : null;
  const made = given || project;
  const sheets = routeSheets(made, { ...opts, derived });
  if (sheets.length === 0) return frame(project, { output: id, what: name, pages: [{ body: '<p class="doc-lead" data-line="nobody">' + esc(NOBODY_SAYS) + '</p>' }], options: opts });
  const width = printableBox(paperOf(project, opts)).width;
  const pages = sheets.map((sheet) => ({ what: name, body: sheetBody(made, sheet, width) }));
  const asked = opts.dayTypeId ? findDayType(made, opts.dayTypeId) : null;
  if (!asked) {
    const own = ownDayTypes(made);
    const followers = made.dayTypes.filter((dayType) => !own.includes(dayType));
    if (followers.length > 0) pages[pages.length - 1].body += '\n<p class="doc-meaning" data-line="followers">' + esc(followerWords(made, followers)) + '</p>';
  }
  return frame(made, { output: id, what: name, pages, options: opts });
}
