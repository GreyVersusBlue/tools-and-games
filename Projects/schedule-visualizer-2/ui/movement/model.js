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
//     transition,            null for all of the day, or the period walked out of
//     measure: 'busiest' | 'total',   what the colours count over a whole day
//     floors: 'auto' | 'side' | 'stacked' | a floor id,
//     labels,                period labels on the room markers
//     constantWidth }        lines keep their width when the map is zoomed
//
//   defaultChoice(project)             every group, the first day type, all transitions
//   settleChoice(project, choice)      the same choice with whatever the project no longer has put right
//   shownGroups(project, choice)       the groups on screen, in the project's order
//   addGroup(choice, groupId)          -> { choice, refused } (four at most; COMPARE_REASON says why)
//   gradesOf(project)                  the grades there are, as typed, sorted
//   transitionsOf(project, dayTypeId)  [{ period, name, short, from, to, times, seconds }]
//   pictureOf(project, results, graph, choice)   everything the map and the legend draw
//   sentenceOf(project, picture, health)         the screen's first line, in pieces
//   groupRows(project, results, picture)         the legend of the groups on screen
//   routeHealth(project, results)                every failed route of every group on every day type
//   cellCard(project, results, graph, picture, floorId, cell)   what a corridor cell's card says

import { findDayType, effectiveDayType, effectiveSchedule, ownDayTypes } from '../../engine/day-types.js';
import { bellsFor, periodName, periodLabel, formatTime } from '../../engine/bells.js';
import { resolveSlotRoom } from '../../engine/schema.js';
import { loads, contributors, bandOf, bandEdges } from '../../engine/load.js';
import { describeFailure } from '../../engine/directions.js';
import { placeAt } from '../../engine/places.js';
import { buildLanes, BAND_EXCLUDED } from '../surface/overlays/lanes.js';

export const COMPARE_LIMIT = 4;
export const COMPARE_REASON = 'Four groups at most are compared at once: with more, the lines are too thin to tell apart. Take one off to add another, or show a grade or every group.';

export function defaultChoice(project) {
  return { who: 'all', grade: '', groupIds: [], dayTypeId: project.dayTypes[0].id, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };
}

export function gradesOf(project) {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return Array.from(new Set(project.groups.map((group) => group.grade))).sort((a, b) => collator.compare(a, b));
}

export function settleChoice(project, choice) {
  const next = { ...defaultChoice(project), ...choice };
  if (!findDayType(project, next.dayTypeId)) next.dayTypeId = project.dayTypes[0].id;
  const known = new Set(project.groups.map((group) => group.id));
  next.groupIds = (Array.isArray(next.groupIds) ? next.groupIds : []).filter((id) => known.has(id)).slice(0, COMPARE_LIMIT);
  if (!['all', 'grade', 'groups'].includes(next.who)) next.who = 'all';
  const grades = gradesOf(project);
  if (next.who === 'grade' && !grades.includes(next.grade)) {
    if (grades.length === 0) next.who = 'all';
    else next.grade = grades[0];
  }
  const transitions = Math.max(0, project.settings.periods - 1);
  if (!(Number.isInteger(next.transition) && next.transition >= 0 && next.transition < transitions)) next.transition = null;
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
// next. `times` is the passing time as the clock has it ("8:42 to 8:46"), or
// '' when the bells are not entered.
export function transitionsOf(project, dayTypeId) {
  const settings = project.settings;
  const bells = bellsFor(project, dayTypeId);
  const list = [];
  for (let period = 0; period + 1 < settings.periods; period += 1) {
    const from = bells[period] ? bells[period].end : null;
    const to = bells[period + 1] ? bells[period + 1].start : null;
    const clock = from && to && bells[period].passingFromBells;
    list.push({
      period,
      name: periodName(settings, period) + ' to ' + periodName(settings, period + 1),
      short: periodLabel(settings, period) + ' to ' + periodLabel(settings, period + 1),
      from,
      to,
      times: clock ? formatTime(from, settings.timeFormat, { suffix: false }) + ' to ' + formatTime(to, settings.timeFormat, { suffix: false }) : '',
      seconds: bells[period] ? bells[period].passingAfter : settings.defaultPassingSeconds,
    });
  }
  return list;
}

function byId(list) {
  return new Map(list.map((each) => [each.id, each]));
}

function dayRoutes(results, dayTypeId) {
  return results && results.routes && Array.isArray(results.routes.days) ? results.routes.days.find((day) => day.dayTypeId === dayTypeId) || null : null;
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
function loadFor(project, results, graph, dayType, groups, routes) {
  const all = groups.length === project.groups.length;
  const kept = all && Array.isArray(results.loads) ? results.loads.find((load) => load && load.dayTypeId === dayType.id) : null;
  if (kept && kept.cells.busiest.length === graph.count) return kept;
  const wanted = new Set(groups.map((group) => group.id));
  return loads(project, { days: [{ dayTypeId: dayType.id, groups: routes.groups.filter((entry) => wanted.has(entry.groupId)) }] }, dayType.id, graph);
}

export function pictureOf(project, results, graph, input) {
  const choice = settleChoice(project, input);
  const dayType = effectiveDayType(project, choice.dayTypeId);
  const chosenDay = findDayType(project, choice.dayTypeId);
  const groups = shownGroups(project, choice);
  const floors = shownFloors(project, choice);
  const floorIds = new Set(floors.map((floor) => floor.id));
  const transitions = transitionsOf(project, choice.dayTypeId);
  const picture = {
    choice,
    ready: Boolean(results),
    dayTypeId: dayType.id,
    dayTypeName: chosenDay.name,
    groups,
    floors,
    transitions,
    transition: choice.transition === null ? null : transitions[choice.transition],
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
    const slots = effectiveSchedule(project, group.id, dayType.id) || [];
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

  const routes = dayRoutes(results, dayType.id);
  if (!results || !routes || !graph) return picture;

  // the routes on screen
  const entries = [];
  const shown = new Set(groups.map((group) => group.id));
  for (const entry of routes.groups) {
    if (!shown.has(entry.groupId)) continue;
    entry.routes.forEach((route, t) => {
      if (choice.transition !== null && t !== choice.transition) return;
      if (!route || route.ok !== true) {
        if (route) picture.failed.push({ groupId: entry.groupId, period: t, route });
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
  if (results.walks && Array.isArray(results.walks.groups)) {
    for (const walk of results.walks.groups) {
      if (walk.late !== true || walk.dayTypeId !== dayType.id || !shown.has(walk.groupId)) continue;
      if (choice.transition !== null && walk.period !== choice.transition) continue;
      picture.late.push(walk);
    }
  }

  // the load of what is on screen. One group alone is not coloured by it
  // (spec 7.3), but its card and the summary still give the numbers.
  if (picture.mode === 'empty') return picture;
  const load = loadFor(project, results, graph, dayType, groups, routes);
  if (!load) return picture;
  const cells = choice.transition !== null ? load.cells.byTransition[choice.transition] : choice.measure === 'total' ? load.cells.total : load.cells.busiest;
  const links = choice.transition !== null ? load.connections.byTransition[choice.transition] : choice.measure === 'total' ? load.connections.total : load.connections.busiest;
  if (!cells || !links) return picture;
  // the busiest of what is on screen and not in an exclusion zone
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
    if (load.excludedConnections[index] || links[index] <= max) return;
    if (!floorIds.has(graph.floors[graph.nodeFloor[link.a]].id) && !floorIds.has(graph.floors[graph.nodeFloor[link.b]].id)) return;
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
    zones: load.zones,
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
// in pieces, with the group's name marked as typed.
export function failureParts(project, failure, withDay) {
  const group = project.groups.find((each) => each.id === failure.groupId);
  const dayType = withDay ? findDayType(project, failure.dayTypeId) : null;
  const text = describeFailure(project, failure.route).replace(/\.$/, '');
  return [
    { text: group ? group.name : 'A group', name: true },
    { text: ', ' + periodName(project.settings, failure.period) + (dayType ? ' on ' : '') },
    ...(dayType ? [{ text: dayType.name, name: true }] : []),
    { text: ', ' },
    // the sentence names rooms as typed, so the whole of it is set as typed
    { text, name: true },
  ];
}

// Which slot to open to put a failed route right: the period of the end the
// router named, or the period walked out of.
export function failurePeriod(failure) {
  return failure.route && failure.route.end === 'to' ? failure.period + 1 : failure.period;
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
  parts.push({ text: ' on ' }, { text: picture.dayTypeName, name: true }, { text: picture.transition ? ', ' + picture.transition.name + (picture.transition.times ? ' (' + picture.transition.times + ')' : '') + '. ' : ', all transitions. ' });
  if (!picture.ready) {
    parts.push({ text: 'Working out the routes.' });
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
  const routes = dayRoutes(results, picture.dayTypeId);
  const crowd = results && results.crowd && Array.isArray(results.crowd.days) ? results.crowd.days.find((day) => day.dayTypeId === picture.dayTypeId) : null;
  const walks = results && results.walks && Array.isArray(results.walks.groups) ? results.walks.groups : [];
  return picture.groups.map((group) => {
    const row = { group, walking: 0, waiting: 0, stairs: false, failed: 0, late: 0, walks: 0 };
    const entry = routes ? routes.groups.find((each) => each.groupId === group.id) : null;
    for (const route of entry ? entry.routes : []) {
      if (!route || route.ok !== true) row.failed += 1;
      else if (!route.same && (route.connections || []).length > 0) row.stairs = true;
    }
    for (const transition of crowd ? crowd.transitions : []) {
      const walker = transition.groups.find((each) => each.groupId === group.id);
      if (!walker) continue;
      row.walks += 1;
      row.walking += walker.walking;
      row.waiting += walker.waiting;
    }
    row.late = walks.filter((walk) => walk.late === true && walk.dayTypeId === picture.dayTypeId && walk.groupId === group.id).length;
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
  const routes = dayRoutes(results, picture.dayTypeId);
  const shown = new Set(picture.groups.map((group) => group.id));
  const mine = routes ? { days: [{ dayTypeId: picture.dayTypeId, groups: routes.groups.filter((entry) => shown.has(entry.groupId)) }] } : null;
  const period = picture.choice.transition;
  const crossing = mine ? contributors(project, mine, picture.dayTypeId, { nodes: [node] }, graph, period === null ? undefined : { period }) : [];
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
