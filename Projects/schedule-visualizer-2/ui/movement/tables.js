// The Travel time tab of the movement view's inspector (spec 8.3): how long
// each group walks and waits, as two tables, slowest first.
//
//   one transition   each group's walking time, waiting time, total, and
//                    whether it fits the passing time
//   the whole day    the same added up for each group, with how many of its
//                    walks are late
//
// Every figure is the crowd model's, read from the walk results the checks
// read (results.walks.groups, engine/crowd.js walkResults), so "late" here is
// the same rule as the walk-time check. The model walks every group of the
// school whatever the map shows; the tables list every group for the day
// type on the map. The transition is the one chosen on the map, or, with the
// whole day on the map, the one holding the day's slowest walk until another
// is picked here.
//
// A day type that is the same as another has no walks and no bells of its
// own. Its tables are the other's, all of them from that one day type
// (travelDay), and every heading says so: "B Day (same as A Day)".
//
//   tablesPanel(env) -> { element, update(state) }
//
// "Print the travel times" prints both tables of the day type on the map,
// every transition's and the whole day's (ui/prints/travel-time.js), made
// from the view's own state as the tables here are.
//
// `env` and `state` are described at the top of ./index.js.
//
// The rows, as plain data for the screen, the prints and the CSV files:
//
//   travelDay(project, dayTypeId, bellsId)
//     -> { id, bellsId (only under a bell schedule), name, heading }: the day type whose walks and bells answer for
//     the one chosen (itself, or the one it is the same as), the chosen one's
//     name, and that name as a heading ("B Day (same as A Day)", and with a
//     bell schedule "B Day (same as A Day) with Early Release bells")
//   transitionRows(project, results, dayTypeId, period, bellsId)
//     -> { rows, still, failed }
//     rows    [{ group, period, toPeriod, from, to, passingSeconds, walking, waiting, released, total, late, arrived, over }]
//             `released` (seconds the group left after the bell) is there only when above 0
//             slowest first; `from` and `to` are the rooms' numbers as typed;
//             `over` is by how many seconds a late walk misses
//     still   the groups that stay in their room; failed  the groups with no route
//   dayRows(project, results, dayTypeId, bellsId)
//     -> [{ group, walks, walking, waiting, released, total, late, lost, slowest }]
//     `released` is there only when above 0
//     slowest first by total; `lost` counts walks that did not arrive at all;
//     `slowest` is the group's slowest walk, a row as above
//   Rows gain `riding` (seconds held in an elevator's car, ARCHITECTURE 19.5) only when above 0,
//   and `ride` ({ car, trips, perTrip, wait }: the car's letter, the trips the group's head count
//   takes, the school's people per trip and wait) on a walk that rides, so a late walk can say why.
//   anyRiding(results, dayTypeId, bellsId)   whether any walk of the run rides: the tables and the
//                                       CSV files gain "Riding" only then, as "Left after the bell" does
//   slowestPeriod(results, dayTypeId, bellsId)   the transition holding the slowest walk, or null
//   lateWords(row)                      "In time", "Late by 21 s", "Did not arrive"; a late
//                                       walk that was held back says so: "Late by 40 s · left 2 min after the bell"
//   anyHeldBack(results, dayTypeId, bellsId)   whether any walk of the run left after the bell
//                                       (staggered dismissal, ARCHITECTURE 18.2): the tables and
//                                       the CSV files gain "Left after the bell" only then, so a
//                                       school with none sees exactly what it did before
//   heldBackWords(project, results, dayTypeId, bellsId)   one sentence naming the staggered
//                                       dismissal in force on the run, or ''
//   transitionsCsv(project, results, dayTypeId, bellsId), dayCsv(...)   rows of cells for engine/csv.js;
//     dayTypeId and bellsId are the run chosen, and the files name it as travelDay does
//
// Every function takes `bellsId` last, null or left out for the regular
// bells, and reads that run's walks (engine/worker.js runResults); the
// transitions it lists are the walks between meeting periods, past the ones
// that do not meet ("Period 2 to Period 4"; each row has toPeriod).
//
// transitionRows, dayRows and slowestPeriod take the id of a day type that is
// its own copy: travelDay(...).id.

import { h, uid } from '../components/dom.js';
import { count, periodWords } from '../components/words.js';
import { formatDuration } from '../../engine/findings.js';
import { findDayType, effectiveDayType } from '../../engine/day-types.js';
import { findBellSchedule, offPeriods, periodName } from '../../engine/bells.js';
import { parse } from '../colour.js';
import { transitionsOf, runOf, walkWords, nothingMeets, nothingMeetsParts } from './model.js';
import { ELEVATOR_KIND, elevatorSettings } from '../../engine/schema.js';
import { printButtons } from '../prints/index.js';
import { printButton } from '../components/print-preview.js';

function roomNumbers(project) {
  const numbers = new Map();
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') numbers.set(space.id, typeof space.number === 'string' ? space.number : '');
  }
  return numbers;
}

// When exactly one period meets (a one-period day, or every other period off
// under the bells), the bells leave nothing to walk between; the Travel tab
// and its print say so in place of advice about giving groups rooms. In
// pieces ({ text, name }), or null when two or more meet, or none does
// (nothingMeets says that).
export function nothingBetweenParts(project, bellsId) {
  const periods = project.settings.periods;
  const schedule = findBellSchedule(project, bellsId);
  const off = schedule ? offPeriods(project, bellsId) : new Set();
  const meeting = [];
  for (let period = 0; period < periods; period += 1) if (!off.has(period)) meeting.push(period);
  if (meeting.length !== 1) return null;
  // a day of one period has one whatever the bells: "only Period 1 meets" would say a period was dropped
  if (!schedule || periods === 1) return [{ text: 'The day has one ' + periodWords(project.settings).one + ', so the bells leave nothing to walk between.' }];
  return [{ text: 'Only ' + periodName(project.settings, meeting[0]) + ' meets under ' }, { text: schedule.name, name: true }, { text: ' bells, so they leave nothing to walk between.' }];
}

// The one source of a day type's travel times: the day type that answers for
// it, by the one rule for "same as" (engine/day-types.js).
export function travelDay(project, dayTypeId, bellsId) {
  const chosen = findDayType(project, dayTypeId) || project.dayTypes[0];
  const own = effectiveDayType(project, chosen.id) || chosen;
  const schedule = findBellSchedule(project, bellsId);
  const heading = (own.id === chosen.id ? chosen.name : chosen.name + ' (same as ' + own.name + ')') + (schedule ? ' with ' + schedule.name + ' bells' : '');
  // the regular bells add nothing to the day type's shape
  return schedule ? { id: own.id, bellsId: schedule.id, name: chosen.name, heading } : { id: own.id, name: chosen.name, heading };
}

function walksOf(results, dayTypeId, bellsId) {
  return runOf(results, dayTypeId, bellsId).walks.groups;
}

// Why a walk that rides takes what it does: the elevator it used (the first
// one on the route), how many trips the group's head count needs, and the
// school's wait. null when the route has no ride.
function rideOf(project, route, group) {
  if (!route || route.ok !== true || !(route.rides > 0)) return null;
  const connections = new Map(project.building.connections.map((connection) => [connection.id, connection]));
  const id = (route.connections || []).find((each) => connections.has(each) && connections.get(each).kind === ELEVATOR_KIND);
  if (id === undefined) return null;
  const car = connections.get(id);
  const { wait, perTrip } = elevatorSettings(project.settings);
  const heads = Number.isInteger(group.headCount) ? group.headCount : project.settings.defaultHeadCount;
  return { car: car.car || car.label, trips: Math.max(1, Math.ceil(heads / perTrip)), perTrip, wait };
}

function routeOf(results, dayTypeId, bellsId, groupId, period) {
  const day = runOf(results, dayTypeId, bellsId).routes;
  const entry = day ? day.groups.find((each) => each.groupId === groupId) : null;
  return entry ? entry.routes[period] : null;
}

function rowOf(project, walk, group, numbers, ride) {
  const margin = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
  return {
    group,
    period: walk.period,
    ...(Number.isInteger(walk.toPeriod) ? { toPeriod: walk.toPeriod } : {}),
    from: numbers.get(walk.fromRoomId) || '',
    to: numbers.get(walk.toRoomId) || '',
    passingSeconds: walk.passingSeconds,
    walking: walk.walking,
    ...(walk.riding > 0 ? { riding: walk.riding } : {}),
    waiting: walk.waiting,
    ...(walk.released > 0 ? { released: walk.released } : {}),
    ...(walk.riding > 0 && ride ? { ride } : {}),
    total: walk.total,
    late: walk.late === true,
    arrived: walk.arrived !== false,
    over: walk.late === true ? Math.max(0, walk.total - walk.passingSeconds - margin) : 0,
  };
}

function slowestFirst(order) {
  return (a, b) => b.total - a.total || b.waiting - a.waiting || order.get(a.group.id) - order.get(b.group.id) || (a.period || 0) - (b.period || 0);
}

export function transitionRows(project, results, dayTypeId, period, bellsId) {
  const numbers = roomNumbers(project);
  const groups = new Map(project.groups.map((group) => [group.id, group]));
  const order = new Map(project.groups.map((group, index) => [group.id, index]));
  const rows = walksOf(results, dayTypeId, bellsId)
    .filter((walk) => walk.period === period && groups.has(walk.groupId))
    .map((walk) => rowOf(project, walk, groups.get(walk.groupId), numbers, walk.riding > 0 ? rideOf(project, routeOf(results, dayTypeId, bellsId, walk.groupId, walk.period), groups.get(walk.groupId)) : null))
    .sort(slowestFirst(order));
  const still = [];
  const failed = [];
  const day = runOf(results, dayTypeId, bellsId).routes;
  for (const entry of day ? day.groups : []) {
    const group = groups.get(entry.groupId);
    const route = entry.routes[period];
    if (!group || !route) continue;
    if (route.ok !== true) failed.push(group);
    else if (route.same === true) still.push(group);
  }
  return { rows, still, failed };
}

export function dayRows(project, results, dayTypeId, bellsId) {
  const numbers = roomNumbers(project);
  const order = new Map(project.groups.map((group, index) => [group.id, index]));
  const walks = walksOf(results, dayTypeId, bellsId);
  const rows = [];
  for (const group of project.groups) {
    const mine = walks.filter((walk) => walk.groupId === group.id).map((walk) => rowOf(project, walk, group, numbers, walk.riding > 0 ? rideOf(project, routeOf(results, dayTypeId, bellsId, walk.groupId, walk.period), group) : null));
    if (mine.length === 0) continue;
    const row = { group, walks: mine.length, walking: 0, waiting: 0, total: 0, late: 0, lost: 0, slowest: null };
    for (const walk of mine) {
      row.walking += walk.walking;
      if (walk.riding > 0) row.riding = (row.riding || 0) + walk.riding;
      row.waiting += walk.waiting;
      if (walk.released > 0) row.released = (row.released || 0) + walk.released;
      row.total += walk.total;
      if (walk.late) row.late += 1;
      if (!walk.arrived) row.lost += 1;
      if (!row.slowest || walk.total > row.slowest.total) row.slowest = walk;
    }
    rows.push(row);
  }
  return rows.sort(slowestFirst(order));
}

export function slowestPeriod(results, dayTypeId, bellsId) {
  let best = null;
  for (const walk of walksOf(results, dayTypeId, bellsId)) {
    if (!best || walk.total > best.total || (walk.total === best.total && walk.period < best.period)) best = walk;
  }
  return best ? best.period : null;
}

export function lateWords(row) {
  if (!row.arrived) return 'Did not arrive';
  if (!row.late) return 'In time';
  // a group held back has less of the passing time to walk in: say so where "late" is said
  return 'Late by ' + formatDuration(row.over) + heldWords(row.released) + rideWords(row.ride);
}

// The cause of a late walk that rode, " · 4 trips of 8 in Elevator D, 30 s wait"; '' with none.
export function rideWords(ride) {
  if (!ride) return '';
  const wait = ride.wait === 0 ? 'no wait' : formatDuration(ride.wait) + ' wait';
  return ' · ' + (ride.trips > 1 ? ride.trips + ' trips of ' + ride.perTrip + ' in ' : '') + 'Elevator ' + ride.car + ', ' + wait;
}

// Whether any walk of the run rode an elevator.
export function anyRiding(results, dayTypeId, bellsId) {
  return results ? walksOf(results, dayTypeId, bellsId).some((walk) => walk.riding > 0) : false;
}

// A group that needs step-free routes, named as such in words after its name
// (DESIGN 13.4): the symbol is only a mark beside the words.
export function stepFreeTag(group) {
  return group.stepFree === true ? h('span', { class: 'mov-stepfree', data: { part: 'step-free' } }, h('span', { 'aria-hidden': 'true' }, '\u267F '), 'step-free') : null;
}

// The cause of a late walk that was held back, " · left 2 min after the bell"; '' with none.
export function heldWords(released) {
  return released > 0 ? ' · left ' + formatDuration(released) + ' after the bell' : '';
}

// Whether any walk of the run (a day type under a bell schedule) left after the bell.
export function anyHeldBack(results, dayTypeId, bellsId) {
  return results ? walksOf(results, dayTypeId, bellsId).some((walk) => walk.released > 0) : false;
}

// "Staggered dismissal is in force: 4 groups leave up to 2 min after the bell."
// Counted from the walks, so it says only what the run shows; '' with none.
export function heldBackWords(project, results, dayTypeId, bellsId) {
  if (!results) return '';
  const held = new Map();
  for (const walk of walksOf(results, dayTypeId, bellsId)) {
    if (walk.released > 0) held.set(walk.groupId, Math.max(held.get(walk.groupId) || 0, walk.released));
  }
  if (held.size === 0) return '';
  const longest = Math.max(...held.values());
  return 'Staggered dismissal is in force: ' + count(held.size, 'group') + (held.size === 1 ? ' leaves ' : ' leave ') + 'up to ' + formatDuration(longest) + ' after the bell.';
}

function transitionName(settings, period, toPeriod) {
  return walkWords(settings, period, toPeriod);
}

// Every walk of the day, transition by transition, slowest first in each.
export function transitionsCsv(project, results, dayTypeId, bellsId) {
  const day = travelDay(project, dayTypeId, bellsId);
  const held = anyHeldBack(results, day.id, day.bellsId);
  const rides = anyRiding(results, day.id, day.bellsId);
  const table = [['Day type', 'Transition', 'Passing time (seconds)', 'Group', 'From room', 'To room', 'Walking (seconds)'].concat(rides ? ['Riding (seconds)'] : [], ['Waiting (seconds)']).concat(held ? ['Left after the bell (seconds)'] : [], ['Total (seconds)', 'Late', 'Late by (seconds)'])];
  for (const { period, toPeriod } of transitionsOf(project, day.id, day.bellsId)) {
    for (const row of transitionRows(project, results, day.id, period, day.bellsId).rows) {
      table.push([day.heading, transitionName(project.settings, period, toPeriod), row.passingSeconds, row.group.name, row.from, row.to, row.walking].concat(rides ? [row.riding || 0] : [], [row.waiting]).concat(held ? [row.released || 0] : [], [row.total, !row.arrived ? 'did not arrive' : row.late ? 'late' : 'in time', row.late ? row.over : '']));
    }
  }
  return table;
}

export function dayCsv(project, results, dayTypeId, bellsId) {
  const day = travelDay(project, dayTypeId, bellsId);
  const held = anyHeldBack(results, day.id, day.bellsId);
  const rides = anyRiding(results, day.id, day.bellsId);
  const table = [['Day type', 'Group', 'Walks', 'Walking (seconds)'].concat(rides ? ['Riding (seconds)'] : [], ['Waiting (seconds)']).concat(held ? ['Left after the bell (seconds)'] : [], ['Total (seconds)', 'Late walks', 'Slowest walk', 'Slowest walk (seconds)'])];
  for (const row of dayRows(project, results, day.id, day.bellsId)) {
    table.push([day.heading, row.group.name, row.walks, row.walking].concat(rides ? [row.riding || 0] : [], [row.waiting]).concat(held ? [row.released || 0] : [], [row.total, row.late, transitionName(project.settings, row.slowest.period, row.slowest.toPeriod), row.slowest.total]));
  }
  return table;
}

function swatch(group) {
  return h('span', { class: 'mov-swatch', style: parse(group.colour) ? 'background:' + group.colour : null });
}

function names(groups) {
  return groups.flatMap((group, index) => [index === 0 ? null : index === groups.length - 1 ? ' and ' : ', ', h('bdi', null, group.name)]);
}

// A travel-time table. A group takes two lines: who, where and whether it
// fits, across the table; then its three times under their headings. Each
// group is a row group of its own, and each time names both its headings.
//   entries   [{ row: { group, walking, waiting, released, total, late }, who: [nodes after the name] }]
//   held      whether a column "Left after the bell" stands between Waiting and Total
function travelTable(caption, entries, held, rides) {
  const base = uid('travel');
  const labels = ['Walking'].concat(rides ? ['Riding'] : [], ['Waiting'], held ? ['Left after the bell'] : [], ['Total']);
  const heads = labels.map((label, index) => h('th', { scope: 'col', class: 'table__num', id: base + '-c' + index }, label));
  return h('table', { class: 'table mov-travel__table' + (held ? ' mov-travel__table--held' : '') },
    h('caption', { class: 'vh' }, caption),
    h('thead', null, h('tr', null, heads)),
    entries.map((entry, index) => {
      const row = entry.row;
      const id = base + '-g' + index;
      const cell = (column, text) => h('td', { class: 'table__num', headers: id + ' ' + base + '-c' + column }, text);
      return h('tbody', { class: 'mov-travel__group', data: { group: row.group.id, total: String(row.total), late: String(row.late) } },
        h('tr', null, h('th', { scope: 'rowgroup', colspan: String(labels.length), id }, swatch(row.group), h('bdi', { class: 'mov-travel__name' }, row.group.name), stepFreeTag(row.group), entry.who)),
        h('tr', null, labels.map((label, column) => {
          if (label === 'Walking') return cell(column, formatDuration(row.walking));
          if (label === 'Riding') return cell(column, row.riding > 0 ? formatDuration(row.riding) : 'none');
          if (label === 'Waiting') return cell(column, row.waiting === 0 ? 'none' : formatDuration(row.waiting));
          if (label === 'Left after the bell') return cell(column, row.released > 0 ? formatDuration(row.released) : 'none');
          return cell(column, formatDuration(row.total));
        })));
    }));
}

export function tablesPanel(env) {
  const pickId = uid('travel-pick');
  const pick = h('select', { class: 'field__input mov-ctl__select mov-travel__pick', id: pickId, data: { travel: 'pick' } });
  const lead = h('p', { class: 'mov-travel__lead', data: { travel: 'lead' } });
  const oneTitle = h('h3', { class: 'mov-panel__sub', data: { travel: 'transition-title' } }, 'One transition');
  const oneLine = h('p', { class: 'mov-panel__note', data: { travel: 'transition-line' } });
  const one = h('div', { class: 'mov-travel', data: { travel: 'transition' } });
  const oneRest = h('p', { class: 'mov-panel__note', data: { travel: 'transition-rest' } });
  const dayTitle = h('h3', { class: 'mov-panel__sub', data: { travel: 'day-title' } }, 'The whole day');
  const whole = h('div', { class: 'mov-travel', data: { travel: 'day' } });
  const picker = h('div', { class: 'mov-travel__choose' }, h('label', { class: 'mov-ctl__label', for: pickId }, 'Transition'), pick);
  let last = null;
  // what the tables are drawn from, handed to the print whole
  const print = printButton(env.ctx, printButtons.find((entry) => entry.id === 'print-travel-time'), () => ({
    dayTypeId: last.picture.choice.dayTypeId,
    bellsId: last.picture.choice.bellsId,
    movement: { project: last.project, results: last.results, graph: last.graph },
  }));
  const tables = h('div', { class: 'mov-travel__tables' }, h('div', { class: 'mov-export__buttons' }, print), oneTitle, picker, oneLine, one, oneRest, dayTitle, whole);
  const element = h('div', { class: 'mov-panel', data: { panel: 'tables' } },
    h('h2', { class: 'mov-panel__title' }, 'Travel time'),
    lead, tables);

  // the transition picked here; null follows the map
  let picked = null;
  let mapTransition = null;
  let pickKey = '';

  function draw(state) {
    const project = state.project;
    const picture = state.picture;
    const results = state.results;
    // the bells, the walks and the name all from the one day type that answers for the one chosen
    const day = travelDay(project, picture.choice.dayTypeId, picture.choice.bellsId);
    const transitions = transitionsOf(project, day.id, day.bellsId);
    const any = walksOf(results, day.id, day.bellsId).length > 0;
    element.dataset.day = day.id;
    // with every period off the print stays, to say so on paper; the tables go
    const between = nothingBetweenParts(project, day.bellsId);
    const printOnly = !any && (nothingMeets(project, day.bellsId) || between !== null);
    tables.hidden = !any && !printOnly;
    for (const part of [oneTitle, picker, oneLine, one, oneRest, dayTitle, whole]) part.hidden = printOnly || (part === oneRest && part.hidden);
    if (!results) {
      lead.textContent = 'Working out the routes.';
      return;
    }
    if (nothingMeets(project, day.bellsId)) {
      lead.replaceChildren(...nothingMeetsParts(project, day.bellsId).map((part) => (part.name ? h('bdi', null, part.text) : part.text)));
      return;
    }
    if (between && !any) {
      lead.replaceChildren(...between.map((part) => (part.name ? h('bdi', null, part.text) : part.text)));
      return;
    }
    if (!any) {
      lead.replaceChildren('Nobody walks anywhere on ', h('bdi', null, day.heading), ' yet: give a group a room in two periods that follow each other.');
      return;
    }
    const held = anyHeldBack(results, day.id, day.bellsId);
    const rides = anyRiding(results, day.id, day.bellsId);
    lead.replaceChildren('How long every group takes on ', h('bdi', null, day.heading), ', slowest first. Walking is the time in an empty corridor; waiting is the time lost to the crowd.' + (rides ? ' Riding is the time held in an elevator: its wait, the ride, and the further trips a large group needs. It counts in the total.' : '') + (held ? ' Left after the bell is the time a group was held back by a staggered dismissal; it counts in the total, so the group has less of the passing time to walk in.' : '') + ' The figures do not depend on which groups the map shows.');

    // the map's transition leads; with the whole day on the map, the one picked here, else the slowest
    if (picture.choice.transition !== mapTransition) {
      mapTransition = picture.choice.transition;
      picked = null;
    }
    if (picked !== null && !transitions.some((each) => each.period === picked)) picked = null;
    const slowest = slowestPeriod(results, day.id, day.bellsId);
    const period = mapTransition !== null ? mapTransition : picked !== null ? picked : slowest !== null ? slowest : transitions.length > 0 ? transitions[0].period : 0;

    const nextKey = JSON.stringify(transitions.map((each) => [each.name, each.times]));
    if (nextKey !== pickKey) {
      pickKey = nextKey;
      pick.replaceChildren(...transitions.map((each) => h('option', { value: String(each.period) }, each.name + (each.times ? ' (' + each.times + ')' : ''))));
    }
    pick.value = String(period);

    const found = transitionRows(project, results, day.id, period, day.bellsId);
    const transition = transitions.find((each) => each.period === period);
    const margin = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
    oneLine.textContent = transition
      ? 'Passing time ' + formatDuration(transition.seconds) + (margin > 0 ? ', and ' + formatDuration(margin) + ' of margin before a walk counts as late.' : '.')
        + (mapTransition === null && picked === null && period === slowest ? ' This transition holds the day\'s slowest walk.' : '')
      : '';
    one.dataset.period = String(period);
    one.replaceChildren(found.rows.length === 0
      ? h('p', { class: 'mov-panel__note' }, 'Nobody walks in this transition.')
      : travelTable('Each group\'s walk in ' + (transition ? transition.name : 'this transition') + ', slowest first', found.rows.map((row) => ({
        row,
        who: [
          h('span', { class: 'mov-travel__rooms' }, h('bdi', null, row.from === '' ? 'no number' : row.from), ' to ', h('bdi', null, row.to === '' ? 'no number' : row.to)),
          h('span', { class: row.late ? 'mov-groups__late' : 'mov-travel__fits', data: { fits: String(!row.late) } }, lateWords(row)),
        ],
      })), held, rides));
    const rest = [];
    if (found.still.length > 0) rest.push(...names(found.still), found.still.length === 1 ? ' stays in its room.' : ' stay in their rooms.');
    if (found.failed.length > 0) rest.push(rest.length > 0 ? ' ' : null, ...names(found.failed), found.failed.length === 1 ? ' has no route: see Summary.' : ' have no route: see Summary.');
    oneRest.replaceChildren(...rest);
    oneRest.hidden = rest.length === 0;

    whole.replaceChildren(travelTable('Each group over the whole of ' + day.heading + ', slowest first', dayRows(project, results, day.id, day.bellsId).map((row) => ({
      row,
      who: [
        h('span', { class: 'mov-travel__rooms' }, count(row.walks, 'walk') + ', the slowest ' + formatDuration(row.slowest.total)),
        row.late > 0 ? h('span', { class: 'mov-groups__late' }, 'late ' + (row.late === 1 ? 'once' : row.late + ' times')) : null,
      ],
    })), held, rides));
  }

  pick.addEventListener('change', () => {
    const period = Number(pick.value);
    // with one transition on the map, the map is what is changed; otherwise only this table
    if (mapTransition !== null) env.change({ transition: period });
    else {
      picked = period;
      if (last) draw(last);
    }
  });

  return {
    element,
    update(state) {
      last = state;
      draw(state);
    },
  };
}
