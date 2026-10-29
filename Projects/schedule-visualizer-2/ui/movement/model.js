// What the movement view shows, worked out from the project, the derived
// results (store.derived.results()) and what is chosen on screen. No DOM in
// here: it runs in Node, and the screen only draws what this gives.
//
// The choice (kept by the view while the page is open):
//
//   { who: 'all' | 'grade' | 'groups',
//     grade,                 the grade shown when who is 'grade'
//     groupIds,              the groups compared when who is 'groups' (none: nothing is shown)
//     dayTypeId,
//     bellsId,               null for the day type's regular bells, or a bell schedule's id (ARCHITECTURE 17.8)
//     transition,            null for all of the day, or the period walked out of
//     measure: 'busiest' | 'total',   what the colours count over a whole day
//     floors: 'auto' | 'side' | 'stacked' | a floor id,
//     labels,                period labels on the room markers
//     constantWidth }        lines keep their width when the map is zoomed
//
//   defaultChoice(project)             every group, the first day type, all transitions
//   settleChoice(project, choice)      the same choice with whatever the project no longer has put right
//   compareReason(limit), compareFull(limit)   the words for the limit on compared groups, from the limit
//   standingOf(project, derived)       what is on screen while an answer is awaited, or after one failed
//   failedSentence(standing)           the first line when the routes could not be worked out
//   shownGroups(project, choice)       the groups on screen, in the project's order
//   addGroup(choice, groupId)          -> { choice, refused } (COMPARE_LIMIT at most; COMPARE_REASON says why)
//   gradesOf(project)                  the grades there are, as typed, sorted
//   transitionsOf(project, dayTypeId, bellsId)  [{ period, toPeriod, name, short, from, to, times, seconds }]: the
//                                      walks between meeting periods, past the ones that do not meet ("Period 2 to Period 4")
//   walkWords(settings, period, toPeriod)  "Period 2 to Period 4"
//   nothingMeets(project, bellsId), nothingMeetsParts(project, bellsId)   every period off under these bells; "No period meets under Early Release bells."
//   offWords(project, bellsId)         "Periods 5 to 8 do not meet", or '' when every period meets
//   runOf(results, dayTypeId, bellsId) one run's parts of the results: { routes, crowd, loads, walks }
//   routesOfRun(routes, entry, groups) a routes object of the entry's run for these groups alone (engine/load.js reads it)
//   pictureOf(project, results, graph, choice)   everything the map and the legend draw
//   sentenceOf(project, picture, health)         the screen's first line, in pieces
//   groupRows(project, results, picture)         the legend of the groups on screen
//   routeHealth(project, results)                every failed route of every group on every day type
//   foldHealth(health)                           the same as it is listed: one line for failures one change puts right
//   cellCard(project, results, graph, picture, floorId, cell)   what a corridor cell's card says

import { findDayType, effectiveDayType, ownDayTypes } from '../../engine/day-types.js';
import { bellsFor, periodName, periodLabel, formatTime, findBellSchedule, offPeriods, parseTime } from '../../engine/bells.js';
import { transitionPlan } from '../../engine/crowd.js';
import { resolveSlotRoom, bellSchedulesOf } from '../../engine/schema.js';
import { meetingSlots } from '../../engine/runs.js';
import { runResults } from '../../engine/worker.js';
import { periodWords, list } from '../components/words.js';
import { loads, contributors, indexRoutes, bandOf, bandEdges } from '../../engine/load.js';
import { describeFailure, startsAsTyped } from '../../engine/directions.js';
import { placeAt } from '../../engine/places.js';
import { buildLanes, BAND_EXCLUDED } from '../surface/overlays/lanes.js';

export const COMPARE_LIMIT = 4;

// The limit in words, so that changing COMPARE_LIMIT changes every place it is said.
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
function numberWord(n) {
  return NUMBER_WORDS[n] || String(n);
}

// Why a group more is refused, under the chips.
export function compareReason(limit) {
  return numberWord(limit) + (limit === 1 ? ' group at most is' : ' groups at most are') + ' compared at once: with more, the lines are too thin to tell apart. Take one off to add another, or show a grade or every group.';
}

// What the field for adding a group says once the limit is reached.
export function compareFull(limit) {
  return numberWord(limit) + (limit === 1 ? ' group is shown' : ' groups are shown');
}

export const COMPARE_REASON = compareReason(COMPARE_LIMIT);

export function defaultChoice(project) {
  return { who: 'all', grade: '', groupIds: [], dayTypeId: project.dayTypes[0].id, bellsId: null, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };
}

export function gradesOf(project) {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return Array.from(new Set(project.groups.map((group) => group.grade))).sort((a, b) => collator.compare(a, b));
}

export function settleChoice(project, choice) {
  const next = { ...defaultChoice(project), ...choice };
  if (!findDayType(project, next.dayTypeId)) next.dayTypeId = project.dayTypes[0].id;
  if (!findBellSchedule(project, next.bellsId)) next.bellsId = null;
  const known = new Set(project.groups.map((group) => group.id));
  // each group once, in the order chosen
  next.groupIds = Array.from(new Set((Array.isArray(next.groupIds) ? next.groupIds : []).filter((id) => known.has(id)))).slice(0, COMPARE_LIMIT);
  if (!['all', 'grade', 'groups'].includes(next.who)) next.who = 'all';
  const grades = gradesOf(project);
  if (next.who === 'grade' && !grades.includes(next.grade)) {
    if (grades.length === 0) next.who = 'all';
    else next.grade = grades[0];
  }
  // a transition is one between two periods that meet under the bells chosen
  if (!transitionsOf(project, next.dayTypeId, next.bellsId).some((each) => each.period === next.transition)) next.transition = null;
  if (!['busiest', 'total'].includes(next.measure)) next.measure = 'busiest';
  if (!['auto', 'side', 'stacked'].includes(next.floors) && !project.building.floors.some((floor) => floor.id === next.floors)) next.floors = 'auto';
  next.labels = next.labels !== false;
  next.constantWidth = next.constantWidth === true;
  return next;
}

export function shownGroups(project, choice) {
  if (choice.who === 'all') return project.groups.slice();
  if (choice.who === 'grade') return project.groups.filter((group) => group.grade === choice.grade);
  return project.groups.filter((group) => choice.groupIds.includes(group.id));
}

export function addGroup(choice, groupId) {
  if (choice.groupIds.includes(groupId)) return { choice, refused: null };
  if (choice.groupIds.length >= COMPARE_LIMIT) return { choice, refused: COMPARE_REASON };
  return { choice: { ...choice, who: 'groups', groupIds: choice.groupIds.concat([groupId]) }, refused: null };
}

// One entry per transition of the day: the walk from period `period` into the
// next one that meets. `toPeriod` is the period reached: the next one, or, past
// periods that do not meet, the first after them ("Period 2 to Period 4"
// under an assembly in Period 3), the passing time then the gap between the
// two. `times` is the passing time as the clock has it ("8:42 to 8:46"), or
// '' when the bells are not entered.
export function transitionsOf(project, dayTypeId, bellsId) {
  const settings = project.settings;
  const bells = bellsFor(project, dayTypeId, bellsId);
  const list = [];
  for (let period = 0; period + 1 < settings.periods; period += 1) {
    // no walk out of a period that does not meet, nor into the leading or trailing ones
    const plan = transitionPlan(project, bells, period);
    if (plan === null) continue;
    const toPeriod = plan.to;
    const from = bells[period] ? bells[period].end : null;
    const to = bells[toPeriod] ? bells[toPeriod].start : null;
    const clock = from && to && (toPeriod === period + 1 ? bells[period].passingFromBells : parseTime(to) > parseTime(from));
    list.push({
      period,
      toPeriod,
      name: periodName(settings, period) + ' to ' + periodName(settings, toPeriod),
      short: periodLabel(settings, period) + ' to ' + periodLabel(settings, toPeriod),
      from,
      to,
      times: clock ? formatTime(from, settings.timeFormat, { suffix: false }) + ' to ' + formatTime(to, settings.timeFormat, { suffix: false }) : '',
      seconds: plan.passing === null || plan.passing === undefined ? settings.defaultPassingSeconds : plan.passing,
    });
  }
  return list;
}

// The words for the walk out of `period` into `toPeriod` (the next one when
// that is left out): "Period 2 to Period 4".
export function walkWords(settings, period, toPeriod) {
  return periodName(settings, period) + ' to ' + periodName(settings, Number.isInteger(toPeriod) ? toPeriod : period + 1);
}

// "Period 2 to Period 4" for the walk kept under `period` in this list of
// transitions (picture.transitions, transitionsOf()); the next period when it
// is not in the list.
export function walkNamed(settings, transitions, period) {
  const found = transitions.find((each) => each.period === period);
  return walkWords(settings, period, found ? found.toPeriod : undefined);
}

// The line under a print of day types that are the same as another: who
// follows whom, and, when a bell schedule is chosen, that the figures above
// are that schedule's run. `what` is what a follower has no copy of:
// 'figures' ("have no figures of their own") or 'times' ("have the same
// travel times"). Plain text; the print escapes it.
export function followerWords(project, followers, bellsId, what) {
  const as = followers.map((dayType) => effectiveDayType(project, dayType.id));
  const one = followers.length === 1;
  const sameAsOne = as.every((own) => own.id === as[0].id);
  const tail = what === 'times' ? ' the same travel times.' : ' no figures of ' + (one ? 'its' : 'their') + ' own.';
  const who = sameAsOne ? followers.map((dayType) => dayType.name) : followers.map((dayType, index) => dayType.name + ' (the same as ' + as[index].name + ')');
  let text = (sameAsOne ? list(who) + (one ? ' is' : ' are') + ' the same as ' + as[0].name + ' and ' : list(who) + ' ') + (one ? 'has' : 'have') + tail;
  const schedule = findBellSchedule(project, bellsId);
  if (schedule) {
    const owns = Array.from(new Set(as.map((own) => own.name)));
    text += ' ' + (one ? 'Its' : 'Their') + ' figures are the ' + schedule.name + ' bells run\u2019s of ' + list(owns) + '.';
  }
  return text;
}

// Does no period meet under these bells? A bell schedule with every period in
// its `off` has nothing to draw, to time or to print; the screens then say so
// in place of advice about giving groups rooms.
export function nothingMeets(project, bellsId) {
  return findBellSchedule(project, bellsId) !== null && offPeriods(project, bellsId).size >= project.settings.periods;
}

// "No period meets under Early Release bells." in pieces ({ text, name }).
export function nothingMeetsParts(project, bellsId) {
  const schedule = findBellSchedule(project, bellsId);
  return [{ text: 'No ' + periodWords(project.settings).one + ' meets under ' }, { text: schedule ? schedule.name : '', name: true }, { text: ' bells.' }];
}

// Where `period` stands among the transitions shown (a strip that leaves
// periods out is shorter than the day), or -1 for All or a period not there.
export function positionOf(transitions, period) {
  return Number.isInteger(period) ? transitions.findIndex((each) => each.period === period) : -1;
}

// Is the walk out of `period` one of the transitions shown?
function meets(transitions, period) {
  return transitions.some((each) => each.period === period);
}

function byId(list) {
  return new Map(list.map((each) => [each.id, each]));
}

function dayRoutes(results, dayTypeId, bellsId) {
  return runOf(results, dayTypeId, bellsId).routes;
}

// One run's parts of the results (engine/worker.js runResults): the routes
// and the crowd model's transitions, the loads, and the walks that carry the
// run's day type and bells. Nothing of a run that is not there (no results
// yet, or no bell schedule of that id) is made up.
export function runOf(results, dayTypeId, bellsId) {
  return results ? runResults(results, dayTypeId, bellsId) : { routes: null, crowd: null, loads: null, walks: { groups: [], teachers: [] } };
}

// A routes object (engine/load.js reads it) holding one run's routes of some
// groups alone. `entry` is the run's whole entry.
export function routesOfRun(entry, groups) {
  const mine = { ...entry, groups };
  return typeof entry.bellsId === 'string' ? { days: [], bells: [mine] } : { days: [mine] };
}

// "Periods 5 to 8 do not meet": the periods the bell schedule leaves out, in
// the school's word and short form; '' when every period meets.
export function offWords(project, bellsId) {
  const off = Array.from(offPeriods(project, bellsId)).sort((a, b) => a - b);
  if (off.length === 0) return '';
  const settings = project.settings;
  const words = periodWords(settings);
  const parts = [];
  for (let i = 0; i < off.length;) {
    let j = i;
    while (j + 1 < off.length && off[j + 1] === off[j] + 1) j += 1;
    if (j - i >= 2) parts.push(periodLabel(settings, off[i]) + ' to ' + periodLabel(settings, off[j]));
    else for (let k = i; k <= j; k += 1) parts.push(periodLabel(settings, off[k]));
    i = j + 1;
  }
  const listed = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return off.length === 1 ? words.One + ' ' + listed + ' does not meet' : words.Many + ' ' + listed + ' do not meet';
}

// "1", "1–3", "1, 4–6": the periods a group is in a room, in the short form.
function periodsText(settings, periods) {
  const parts = [];
  let start = null;
  let last = null;
  const close = () => {
    if (start === null) return;
    parts.push(start === last ? periodLabel(settings, start) : periodLabel(settings, start) + '–' + periodLabel(settings, last));
  };
  for (const period of periods) {
    if (last !== null && period === last + 1) {
      last = period;
    } else {
      close();
      start = period;
      last = period;
    }
  }
  close();
  return parts.join(', ');
}

function boxOf(room, width) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const cell of room.cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// Which floors the choice puts on screen.
export function shownFloors(project, choice) {
  const one = project.building.floors.find((floor) => floor.id === choice.floors);
  return one ? [one] : project.building.floors.slice();
}

// The load of the groups on screen. With every group shown it is the
// pipeline's own answer; for some of them it is the same rule, loads(), given
// only their routes.
function loadFor(project, results, graph, dayType, bellsId, groups, routes) {
  const all = groups.length === project.groups.length;
  const kept = all ? runOf(results, dayType.id, bellsId).loads : null;
  if (kept && kept.cells.busiest.length === graph.count) return kept;
  const wanted = new Set(groups.map((group) => group.id));
  return loads(project, routesOfRun(routes, routes.groups.filter((entry) => wanted.has(entry.groupId))), dayType.id, graph, bellsId);
}

// How many exclusion zones leave something out of the scale on screen: the
// zones on these floors that cover a cell someone can walk on. (The engine's
// own `zones` is every zone the building has.)
function zonesOnScreen(project, graph, floorIds) {
  let found = 0;
  for (const zone of Array.isArray(project.building.zones) ? project.building.zones : []) {
    const f = floorIds.has(zone.floorId) ? graph.floorIndex.get(zone.floorId) : undefined;
    if (f === undefined) continue;
    const floor = graph.floors[f];
    let covers = false;
    for (let y = Math.max(0, zone.y); y < Math.min(floor.height, zone.y + zone.h) && !covers; y += 1) {
      for (let x = Math.max(0, zone.x); x < Math.min(floor.width, zone.x + zone.w) && !covers; x += 1) {
        if (floor.nodeOfCell[y * floor.width + x] !== -1) covers = true;
      }
    }
    if (covers) found += 1;
  }
  return found;
}

export function pictureOf(project, results, graph, input) {
  const choice = settleChoice(project, input);
  const dayType = effectiveDayType(project, choice.dayTypeId);
  const chosenDay = findDayType(project, choice.dayTypeId);
  const groups = shownGroups(project, choice);
  const floors = shownFloors(project, choice);
  const floorIds = new Set(floors.map((floor) => floor.id));
  const transitions = transitionsOf(project, choice.dayTypeId, choice.bellsId);
  const bellSchedule = findBellSchedule(project, choice.bellsId);
  const picture = {
    choice,
    ready: Boolean(results),
    dayTypeId: dayType.id,
    bellsId: bellSchedule ? bellSchedule.id : null,
    bellsName: bellSchedule ? bellSchedule.name : null,
    offWords: offWords(project, choice.bellsId),
    // what the picture is of, as every heading and caption says it: "A Day",
    // or "A Day with Early Release bells"; dayName is the day type alone
    dayName: chosenDay.name,
    dayTypeName: bellSchedule ? chosenDay.name + ' with ' + bellSchedule.name + ' bells' : chosenDay.name,
    groups,
    floors,
    transitions,
    transition: choice.transition === null ? null : transitions.find((each) => each.period === choice.transition) || null,
    mode: groups.length === 0 ? 'empty' : groups.length === 1 ? 'single' : 'load',
    drawn: 0,
    same: 0,
    failed: [],
    lanes: null,
    bands: null,
    markers: new Map(),
    links: [],
    load: null,
    busiest: null,
    late: [],
  };
  const settings = project.settings;
  const rank = new Map(project.groups.map((group, index) => [group.id, index]));
  const periods = choice.transition === null ? settings.periods : 2;
  const firstPeriod = choice.transition === null ? 0 : choice.transition;

  // the room markers: where each group on screen is, period by period
  const rooms = new Map();
  for (const group of groups) {
    const slots = meetingSlots(project, group.id, dayType.id, picture.bellsId) || [];
    for (let p = firstPeriod; p < Math.min(slots.length, firstPeriod + periods); p += 1) {
      const room = resolveSlotRoom(project, slots[p]).room;
      if (!room) continue;
      if (!rooms.has(room.id)) rooms.set(room.id, new Map());
      const here = rooms.get(room.id);
      if (!here.has(group.id)) here.set(group.id, []);
      here.get(group.id).push(p);
    }
  }
  for (const floor of floors) {
    const list = [];
    for (const space of floor.spaces) {
      const here = space.kind === 'room' ? rooms.get(space.id) : null;
      if (!here) continue;
      list.push({
        roomId: space.id,
        box: boxOf(space, floor.width),
        pills: groups.filter((group) => here.has(group.id)).map((group) => ({ groupId: group.id, colour: group.colour, text: periodsText(settings, here.get(group.id)), periods: here.get(group.id) })),
      });
    }
    picture.markers.set(floor.id, list);
  }

  const run = runOf(results, dayType.id, picture.bellsId);
  const routes = run.routes;
  if (!results || !routes || !graph) return picture;
  // who crosses which cell, worked out with the picture and kept (engine/load.js): the first cell card is then as quick as the rest
  indexRoutes(project, results.routes, dayType.id, graph, picture.bellsId);

  // the routes on screen
  const entries = [];
  const shown = new Set(groups.map((group) => group.id));
  for (const entry of routes.groups) {
    if (!shown.has(entry.groupId)) continue;
    entry.routes.forEach((route, t) => {
      if (choice.transition !== null && t !== choice.transition) return;
      // a walk into or out of a period that does not meet is not one
      if (!meets(transitions, t)) return;
      if (!route || route.ok !== true) {
        if (route) picture.failed.push({ groupId: entry.groupId, period: t, toPeriod: transitions.find((each) => each.period === t).toPeriod, route });
        return;
      }
      if (route.same === true) {
        picture.same += 1;
        return;
      }
      picture.drawn += 1;
      entries.push({ groupId: entry.groupId, rank: rank.get(entry.groupId), route });
    });
  }
  picture.lanes = buildLanes(project, entries);
  const connections = byId(project.building.connections);
  for (const [id, groupIds] of picture.lanes.links) {
    const connection = connections.get(id);
    if (connection) picture.links.push({ id, label: connection.label, a: connection.a, b: connection.b, groupIds });
  }

  // who is late, by the crowd model's own rule
  {
    for (const walk of run.walks.groups) {
      if (walk.late !== true || !shown.has(walk.groupId)) continue;
      if (choice.transition !== null && walk.period !== choice.transition) continue;
      picture.late.push(walk);
    }
  }

  // the load of what is on screen. One group alone is not coloured by it
  // (spec 7.3), but its card and the summary still give the numbers.
  if (picture.mode === 'empty') return picture;
  const load = loadFor(project, results, graph, dayType, picture.bellsId, groups, routes);
  if (!load) return picture;
  const cells = choice.transition !== null ? load.cells.byTransition[choice.transition] : choice.measure === 'total' ? load.cells.total : load.cells.busiest;
  const links = choice.transition !== null ? load.connections.byTransition[choice.transition] : choice.measure === 'total' ? load.connections.total : load.connections.busiest;
  if (!cells || !links) return picture;
  // the busiest of what is on screen and not in an exclusion zone: the cells
  // of the floors shown, and a stairs connection only when its link is drawn
  // (someone on screen takes it, and an end of it is on a floor shown)
  const drawnLinks = new Set(picture.links.filter((link) => floorIds.has(link.a.floorId) || floorIds.has(link.b.floorId)).map((link) => link.id));
  let max = 0;
  let maxNode = -1;
  let maxLink = -1;
  for (const floor of graph.floors) {
    if (!floorIds.has(floor.id)) continue;
    for (let node = floor.offset; node < floor.offset + floor.count; node += 1) {
      if (load.excluded[node] || cells[node] <= max) continue;
      max = cells[node];
      maxNode = node;
    }
  }
  graph.links.forEach((link, index) => {
    if (!drawnLinks.has(link.id) || load.excludedConnections[index] || links[index] <= max) return;
    max = links[index];
    maxLink = index;
    maxNode = -1;
  });
  const scale = settings.colourScale;
  if (picture.mode === 'load') picture.bands = new Map();
  for (const floor of graph.floors) {
    if (!picture.bands || !floorIds.has(floor.id)) continue;
    const bands = new Uint8Array(floor.width * floor.height);
    for (let i = 0; i < floor.count; i += 1) {
      const node = floor.offset + i;
      if (cells[node] === 0) continue;
      bands[graph.nodeCell[node]] = load.excluded[node] ? BAND_EXCLUDED : bandOf(cells[node], scale, max);
    }
    picture.bands.set(floor.id, bands);
  }
  picture.load = {
    unit: load.unit,
    zones: zonesOnScreen(project, graph, floorIds),
    mode: scale && scale.mode === 'absolute' ? 'absolute' : 'relative',
    measure: choice.transition !== null ? 'transition' : choice.measure,
    max,
    edges: bandEdges(scale, max),
    cells,
    links,
    excluded: load.excluded,
    peak: choice.transition === null && choice.measure === 'busiest' ? load.cells.peak : null,
    source: load,
  };
  if (max > 0) {
    let place = null;
    let period = choice.transition;
    if (maxNode !== -1) {
      place = results.places ? results.places.places[results.places.placeOfNode[maxNode]] : null;
      if (picture.load.peak) period = picture.load.peak[maxNode];
    } else {
      place = results.places ? results.places.places[results.places.placeOfLink[maxLink]] : null;
      if (choice.transition === null && choice.measure === 'busiest') period = load.connections.peak[maxLink];
    }
    const floor = maxNode !== -1 ? graph.floors[graph.nodeFloor[maxNode]] : null;
    picture.busiest = { load: max, unit: load.unit, place, floorId: floor ? floor.id : null, floorName: floor ? floor.name : null, cell: maxNode !== -1 ? graph.nodeCell[maxNode] : null, period: Number.isInteger(period) && period >= 0 ? period : null };
  }
  return picture;
}

// ---------------------------------------------------------------- words

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many || one + 's');
}

export function unitWord(unit, n) {
  if (unit === 'groups') return n === 1 ? 'group' : 'groups';
  return n === 1 ? 'student' : 'students';
}

// The words for one failed route: "7-2, Period 3, Room 105 does not open onto a corridor"
// in pieces, with the group's name marked as typed. The period is the one
// that has to be put right (failurePeriod): the period walked into when the
// route failed at that end. The reason comes after a comma, so a sentence
// that opens with a word of the tool's own loses its capital there.
export function failureParts(project, failure, withDay) {
  const group = project.groups.find((each) => each.id === failure.groupId);
  const dayType = withDay ? findDayType(project, failure.dayTypeId) : null;
  const sentence = describeFailure(project, failure.route).replace(/\.$/, '');
  // the directions say whether the sentence opens with what was typed (engine/directions.js): one rule, kept there
  const text = startsAsTyped(project, failure.route) ? sentence : sentence[0].toLowerCase() + sentence.slice(1);
  return [
    { text: group ? group.name : 'A group', name: true },
    { text: ', ' + periodName(project.settings, failurePeriod(failure)) + (dayType ? ' on ' : '') },
    ...(dayType ? [{ text: dayType.name, name: true }] : []),
    { text: ', ' },
    // the sentence names rooms as typed, so the whole of it is set as typed
    { text, name: true },
  ];
}

// Which slot to open to put a failed route right: the period of the end the
// router named, or the period walked out of.
export function failurePeriod(failure) {
  return failure.route && failure.route.end === 'to' ? (Number.isInteger(failure.toPeriod) ? failure.toPeriod : failure.period + 1) : failure.period;
}

// What the screen stands on. `derived` is what the view keeps of the engine's
// answers: { project, results, failed }, the last good results, the project
// they were worked out for, and the message of a derive that failed since.
//   { project, results, failed, stale }
//   project, results   what is drawn: the last good answer against its own
//                      project, or the project as it is with no results yet
//   failed             the message, or null
//   stale              a derive failed and an older answer is still drawn:
//                      the picture is from before the change
// What the first line gives as the reason when nothing is attached to work
// the routes out (the store's derived.engine is null).
export const NO_ENGINE = 'Nothing is attached to work out the routes.';

// Whether an answer that has just come is for the screen: the view is still
// up, the answer is for the project last asked about, and the store has not
// moved on from that project meanwhile. An answer that is not is dropped
// and changes nothing.
//   { gone, asked, answered, now }   the view left; the project last asked
//                                    about; the one this answer is for; the
//                                    store's project now
export function answerCounts({ gone, asked, answered, now }) {
  return !gone && asked === answered && now === answered;
}

// With nothing attached to work out the routes, how often the view looks
// again for something that is.
export const ENGINE_LOOK_MS = 1000;

// How the view asks for the results, with no DOM in it, so a Node case runs
// the code the view runs (SV2-55 item 6). One asker per visit of the view.
//   createAsker({ store, graph, gone, timers, pending, settled, lookMs })
//     store             the planner's store: store.project, and store.derived
//                       with `engine` and `results()` once an engine is attached
//     graph()           the store's graph now, kept beside an answer
//     gone()            true once the view has left
//     timers            { set(fn, ms) -> id, clear(id) }
//     pending()         an answer is awaited
//     settled(failed, answered)   draw again: an answer came (answered), with
//                       the failure's words or null; or an engine was found
//   -> { ask(), stop(), derived, waiting }
//     ask()      ask about the store's project, once per project; with no
//                engine the first line says so (derived.failed is NO_ENGINE),
//                and the asker looks again every lookMs until one is
//                attached, then asks about the project as it is then
//     stop()     no more looking
//     derived    { asked, project, results, graph, failed }: the last answer
//     waiting    a look again is set
export function createAsker({ store, graph, gone, timers, pending, settled, lookMs }) {
  const every = lookMs === undefined ? ENGINE_LOOK_MS : lookMs;
  let derived = { asked: null, project: null, results: null, graph: null, failed: null };
  let wait = null;
  function look() {
    wait = null;
    if (gone()) return;
    if (store.derived && store.derived.engine) {
      derived.failed = null;
      ask();
      settled(null, false);
    } else {
      wait = timers.set(look, every);
    }
  }
  function ask() {
    const project = store.project;
    if (derived.asked === project) return;
    derived.asked = project;
    if (!store.derived || !store.derived.engine) {
      // nothing to ask, and nothing is awaited: the first line says so. The
      // project is not marked asked, and the view looks again now and then,
      // so an engine attached later is asked for this same project.
      derived.asked = null;
      derived.failed = NO_ENGINE;
      if (wait === null) wait = timers.set(look, every);
      return;
    }
    pending();
    const settle = (results, failed) => {
      // an answer for a state the project has left is not for the screen
      if (!answerCounts({ gone: gone(), asked: derived.asked, answered: project, now: store.project })) return;
      // store.project is `project` here, so the store's graph is this answer's
      derived = { asked: project, project: results ? project : derived.project, results: results || derived.results, graph: results ? graph() : derived.graph, failed };
      settled(failed, true);
    };
    store.derived.results().then((results) => settle(results, null), (error) => settle(null, error && error.message ? error.message : String(error)));
  }
  return {
    ask,
    stop() {
      if (wait !== null) timers.clear(wait);
      wait = null;
    },
    get derived() {
      return derived;
    },
    get waiting() {
      return wait !== null;
    },
  };
}

export function standingOf(project, derived) {
  const kept = Boolean(derived && derived.results && derived.project);
  const failed = derived && derived.failed ? String(derived.failed) : null;
  return { project: kept ? derived.project : project, results: kept ? derived.results : null, failed, stale: kept && failed !== null };
}

// The first line when the routes could not be worked out, in pieces. The
// message is somebody else's text: it is handed on as typed, and a stop is
// put after it when it did not bring one of its own.
export function failedSentence(standing) {
  const stop = /[.!?]$/.test(standing.failed) ? '' : '.';
  const parts = [{ text: 'The routes could not be worked out: ' }, { text: standing.failed, name: true }];
  const after = stop + (standing.stale ? ' The map and the figures are from before your last change.' : '');
  if (after !== '') parts.push({ text: after });
  return { parts, showMe: false };
}

// The screen's first line (DESIGN 5.3), in pieces: [{ text, name }], and
// whether "Show me" has anything to show.
//   "Showing 8 groups on A Day, all transitions. 1 route failed: 7-2, Period 3, Room 105 does not open onto a corridor."
export function sentenceOf(project, picture, health) {
  const parts = [];
  const n = picture.groups.length;
  if (n === 0) {
    parts.push({ text: 'Nothing is shown. Choose a group, a grade or every group to see where they walk.' });
    return { parts, showMe: false };
  }
  parts.push({ text: 'Showing ' });
  if (n === 1) parts.push({ text: picture.groups[0].name, name: true });
  else if (picture.choice.who === 'grade') parts.push({ text: plural(n, 'group') + ' of grade ' }, { text: picture.choice.grade === '' ? '(none)' : picture.choice.grade, name: picture.choice.grade !== '' });
  else parts.push({ text: plural(n, 'group') });
  parts.push({ text: ' on ' }, { text: picture.dayName, name: true });
  if (picture.bellsName !== null) parts.push({ text: ' with ' }, { text: picture.bellsName, name: true }, { text: ' bells' });
  parts.push({ text: picture.transition ? ', ' + picture.transition.name + (picture.transition.times ? ' (' + picture.transition.times + ')' : '') + '. ' : ', all transitions. ' });
  if (!picture.ready) {
    parts.push({ text: 'Working out the routes.' });
    return { parts, showMe: false };
  }
  if (nothingMeets(project, picture.bellsId)) {
    parts.push(...nothingMeetsParts(project, picture.bellsId));
    return { parts, showMe: false };
  }
  const failed = picture.failed.length;
  const elsewhere = health ? health.length - failed : 0;
  if (failed === 0) {
    parts.push({ text: elsewhere > 0 ? 'No route failed here; ' + plural(elsewhere, 'route') + ' failed elsewhere.' : 'No route failed.' });
    return { parts, showMe: elsewhere > 0 };
  }
  parts.push({ text: plural(failed, 'route') + ' failed' + (failed === 1 ? ': ' : '. The first: ') });
  parts.push(...failureParts(project, { ...picture.failed[0], dayTypeId: picture.dayTypeId }, false));
  parts.push({ text: '.' });
  return { parts, showMe: true };
}

// ---------------------------------------------------------------- the legend of groups

// One row a group on screen, for the whole of the day type shown:
// { group, walking, waiting, stairs, failed, late, walks }
//   walking   seconds of walking over the day (the crowd model's figure)
//   waiting   seconds lost to crowding
//   stairs    does any of its walks use a stairs connection?
//   failed    how many of its routes failed
//   late      how many transitions it cannot make in time
export function groupRows(project, results, picture) {
  const run = runOf(results, picture.dayTypeId, picture.bellsId);
  const routes = run.routes;
  const crowd = run.crowd;
  const walks = run.walks.groups;
  return picture.groups.map((group) => {
    const row = { group, walking: 0, waiting: 0, stairs: false, failed: 0, late: 0, walks: 0 };
    const entry = routes ? routes.groups.find((each) => each.groupId === group.id) : null;
    (entry ? entry.routes : []).forEach((route, t) => {
      if (!meets(picture.transitions, t)) return;
      if (!route || route.ok !== true) row.failed += 1;
      else if (!route.same && (route.connections || []).length > 0) row.stairs = true;
    });
    for (const transition of crowd ? crowd.transitions : []) {
      if (transition.off === true) continue;
      const walker = transition.groups.find((each) => each.groupId === group.id);
      if (!walker) continue;
      row.walks += 1;
      row.walking += walker.walking;
      row.waiting += walker.waiting;
    }
    row.late = walks.filter((walk) => walk.late === true && walk.groupId === group.id).length;
    return row;
  });
}

// ---------------------------------------------------------------- route health

// Every group on every day type that is its own copy: each transition whose
// route failed, with the reason and where to put it right.
//   [{ groupId, dayTypeId, period, fixPeriod, route, reason }]
export function routeHealth(project, results) {
  const found = [];
  if (!results || !results.routes || !Array.isArray(results.routes.days)) return found;
  const own = new Set(ownDayTypes(project).map((dayType) => dayType.id));
  const known = new Set(project.groups.map((group) => group.id));
  for (const day of results.routes.days) {
    if (!own.has(day.dayTypeId)) continue;
    for (const entry of day.groups) {
      if (!known.has(entry.groupId)) continue;
      entry.routes.forEach((route, period) => {
        if (!route || route.ok === true) return;
        const failure = { groupId: entry.groupId, dayTypeId: day.dayTypeId, period, route };
        found.push({ ...failure, fixPeriod: failurePeriod(failure), reason: describeFailure(project, route) });
      });
    }
  }
  return found;
}

// Route health as it is listed: failures that one change puts right are one
// line. A slot with no room, or with a room nothing reaches, fails the walk
// into it and the walk out of it for the one reason; the list names the slot
// once and says how many routes it stops.
//   [{ ...the first failure, periods: [the transitions that failed], count }]
export function foldHealth(list) {
  const folded = [];
  const at = new Map();
  for (const failure of list) {
    const key = [failure.groupId, failure.dayTypeId, failure.fixPeriod, failure.reason].join('\u0000');
    const kept = at.get(key);
    if (kept) {
      kept.periods.push(failure.period);
      kept.count += 1;
    } else {
      const first = { ...failure, periods: [failure.period], count: 1 };
      at.set(key, first);
      folded.push(first);
    }
  }
  return folded;
}

// ---------------------------------------------------------------- a cell's card

// What the card of a corridor or stairs cell says (spec 7.4, last line):
// { place, parts, floorName, load, unit, excluded, groups: [{ group, times, count }] },
// or null for a cell nobody can walk on.
export function cellCard(project, results, graph, picture, floorId, cell) {
  if (!results || !graph || !results.places) return null;
  const place = placeAt(results.places, graph, floorId, cell);
  if (!place) return null;
  const f = graph.floorIndex.get(floorId);
  const node = graph.floors[f].nodeOfCell[cell];
  const routes = dayRoutes(results, picture.dayTypeId, picture.bellsId);
  const shown = new Set(picture.groups.map((group) => group.id));
  const mine = routes ? routesOfRun(routes, routes.groups.filter((entry) => shown.has(entry.groupId))) : null;
  const period = picture.choice.transition;
  const crossing = mine ? contributors(project, mine, picture.dayTypeId, { nodes: [node] }, graph, { bellsId: picture.bellsId, ...(period === null ? {} : { period }) }) : [];
  const groups = byId(project.groups);
  return {
    place,
    parts: place.parts,
    floorName: graph.floors[f].name,
    load: picture.load ? picture.load.cells[node] : 0,
    unit: picture.load ? picture.load.unit : 'students',
    measure: period !== null ? 'transition' : picture.choice.measure,
    excluded: picture.load ? picture.load.excluded[node] === 1 : false,
    peak: picture.load && picture.load.peak && picture.load.peak[node] >= 0 ? picture.load.peak[node] : null,
    groups: crossing.filter((each) => groups.has(each.groupId)).map((each) => ({ group: groups.get(each.groupId), times: each.times, count: each.count })),
  };
}
