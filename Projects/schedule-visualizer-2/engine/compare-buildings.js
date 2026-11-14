// Comparing two buildings (spec 9.3, ARCHITECTURE 21.3 with 21.10's
// corrections). compareResults needs two results of one building; this
// compares two files that describe different buildings, say this year and a
// proposal with a new wing, each with its own result.
//
//   compareBuildings(projectA, resultA, projectB, resultB, { dayTypeName, transition }?)
//
// A is "before" (the open project), B is "after" (the other file). A result
// is a createPipeline().run() result or a trimResult() answer; both are
// read through trimResult. Plain Node: it reads no clock and no page.
//
// Day types are matched by name (NFKC, lower case, spaces collapsed, as
// scenarioFromDiff does, and with its spaces collapsed) among the own day types both sides worked out. The
// comparison is for one matched day type: options.dayTypeName's, or the
// first of A's that B has. None matched, or the one asked for not matched:
// { refused: 'no-day-type', sentence } and nothing else.
//
// The answer:
//   { figures, groups, places, findings, rooms, matched, transition }
//   matched    { dayTypeName, dayTypes: [names matched, A's order], dayTypeIdA, dayTypeIdB }
//   figures    as compareResults': walking, crowding, busiest, late, failed
//              and findings by severity, each { before, after, difference },
//              each side reckoned from its own result and its own day type id
//   groups     { rows, onlyBefore, onlyAfter }: rows are matched by name and
//              as compareResults' groups are ({ name, groupIdBefore,
//              groupIdAfter, before, after, difference, failedChange }),
//              in its order; onlyBefore and onlyAfter are names as typed.
//              A name two groups of one side share is one row: their walks
//              add up.
//   places     { busier, quieter, new, gone, ambiguous, unnamed }
//              Named corridors are matched by kind, floor name and name;
//              stairs and elevators by kind, label and the floor names they
//              join. busier and quieter: [{ key, kind, name, floorNames,
//              before, after, difference }], biggest change first, then A's
//              order; `new` is the matched-by-nobody places only B has and
//              `gone` those only A has ({ key, kind, name, floorNames, load }).
//              A key that occurs twice on one side is `ambiguous`
//              ({ kind, name, floorNames, before, after }: how many on each
//              side) and is matched with nothing. `unnamed` is { before,
//              after, sentence }: the places with no name of their own on
//              each side (stretches, junctions, unnamed corridors, unlabelled
//              stairs), which are left out, and the sentence saying so (null
//              when there are none).
//   findings   { new, resolved, unchanged } matched by a key of the kind, the
//              day type's name, the period and the NAMES of what it is about
//              (group names, room numbers, teacher names), never ids; new and
//              unchanged are B's findings, resolved are A's
//   rooms      { same, added: [numbers], removed: [numbers] }: numbers as
//              matchRooms counts them (added are only in B, removed only in A)
//
// Every name is returned as typed and is only ever data. Throws a TypeError
// for a missing project or result; everything else is a value.

import { roomNumberKey, allRooms } from './schema.js';
import { countBySeverity, SEVERITIES } from './findings.js';
import { trimResult, walkFigures, busiestOf, findingsOf, roomKeys, matchRooms } from './scenario.js';

export const UNNAMED_SENTENCE = 'Corridors without names cannot be matched between two buildings, so they are left out of this list.';

const PLACES_LIMIT_DEFAULT = 10;

// Names are matched as ARCHITECTURE 21.3 says: NFKC, lower case, every run of
// spaces one space, the ends trimmed. (schema.js's nameKey only trims and
// lower-cases, which scenarioFromDiff uses; "B  Day" and "B Day" are one day
// type here.) The names themselves are never changed.
function nameKey(name) {
  return String(name).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function need(project, result, side) {
  if (!project || typeof project !== 'object' || !project.building || !Array.isArray(project.dayTypes) || !Array.isArray(project.groups)) {
    throw new TypeError('compareBuildings needs project ' + side + '.');
  }
  if (!result || typeof result !== 'object') throw new TypeError('compareBuildings needs a result for project ' + side + '.');
  return trimResult(result);
}

function sideOf(before, after) {
  return { before, after, difference: after - before };
}

function loadOf(view, dayTypeId) {
  const list = Array.isArray(view.loads) ? view.loads : [];
  return list.find((load) => load && load.dayTypeId === dayTypeId) || null;
}

// A place's load, as scenario.js's own placeLoad reads it: the highest of its
// members outside the exclusion zones, in one transition or in the busiest
// one. Null when the place is wholly inside zones or the transition is not
// one of this day's.
function placeLoad(load, place, transition) {
  if (!load) return null;
  const isLink = place.kind === 'connection';
  const members = isLink ? [place.link] : place.nodes;
  const source = isLink ? load.connections : load.cells;
  const shut = isLink ? load.excludedConnections : load.excluded;
  let values;
  if (transition === null) values = source.busiest;
  else if (transition < load.transitions) values = source.byTransition[transition];
  else return null;
  let best = 0;
  let open = 0;
  for (const member of members) {
    if (shut[member]) continue;
    open += 1;
    if (values && values[member] > best) best = values[member];
  }
  return open === 0 ? null : best;
}

function blank(text) {
  return typeof text !== 'string' || text.trim() === '';
}

// The named places of one side, keyed building-neutrally. Each entry:
// { key, kind, name, floorNames, load, order }; ambiguous keys are counted,
// unnamed places are counted.
function namedPlaces(project, view, dayTypeId, transition) {
  const cut = view.places && Array.isArray(view.places.places) ? view.places.places : [];
  const load = loadOf(view, dayTypeId);
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const corridors = new Map();
  for (const floor of project.building.floors) for (const corridor of floor.corridors || []) corridors.set(corridor.id, corridor);
  const connections = new Map((project.building.connections || []).map((connection) => [connection.id, connection]));
  const floorName = (id) => (floors.has(id) ? floors.get(id).name : '');
  const found = new Map();
  let unnamed = 0;
  cut.forEach((place, order) => {
    let name = '';
    let kind = '';
    let floorNames = [];
    let key = null;
    if (place.kind === 'corridor') {
      const corridor = corridors.get(place.corridorId);
      if (corridor && !blank(corridor.name)) {
        kind = 'corridor';
        name = corridor.name;
        floorNames = [floorName(place.floorId)];
        key = 'corridor|' + nameKey(floorNames[0]) + '|' + nameKey(name);
      }
    } else if (place.kind === 'connection') {
      const connection = connections.get(place.connectionId);
      if (connection && !blank(connection.label)) {
        kind = place.elevator === true ? 'elevator' : 'stairs';
        name = connection.label;
        floorNames = (place.floorIds || [place.floorId]).map(floorName);
        key = kind + '|' + nameKey(name) + '|' + floorNames.map(nameKey).sort().join('|');
      }
    }
    if (key === null) {
      unnamed += 1;
      return;
    }
    if (!found.has(key)) found.set(key, []);
    found.get(key).push({ key, kind, name, floorNames, load: placeLoad(load, place, transition), order });
  });
  return { found, unnamed };
}

// The names a finding is about, as this side writes them. A finding about
// ids that this side no longer holds names nothing for them.
function findingKeys(project, findings, dayTypeNames) {
  const groups = new Map(project.groups.map((group) => [group.id, group.name]));
  const teachers = new Map((project.teachers || []).map((teacher) => [teacher.id, teacher.name]));
  const rooms = new Map(allRooms(project).map((room) => [room.id, room.number]));
  const seen = new Map();
  return findings.map((finding) => {
    const where = finding.where || {};
    const names = [];
    for (const id of where.groupIds || []) if (groups.has(id)) names.push('g:' + nameKey(groups.get(id)));
    if (where.roomId && rooms.has(where.roomId)) names.push('r:' + roomNumberKey(rooms.get(where.roomId)));
    if (where.teacherId && teachers.has(where.teacherId)) names.push('t:' + nameKey(teachers.get(where.teacherId)));
    for (const id of finding.about || []) {
      if (groups.has(id)) names.push('g:' + nameKey(groups.get(id)));
      else if (teachers.has(id)) names.push('t:' + nameKey(teachers.get(id)));
      else if (rooms.has(id)) names.push('r:' + roomNumberKey(rooms.get(id)));
    }
    const dayName = where.dayTypeId && dayTypeNames.has(where.dayTypeId) ? nameKey(dayTypeNames.get(where.dayTypeId)) : '';
    const base = [finding.kind, dayName, where.period === null || where.period === undefined ? '' : where.period, Array.from(new Set(names)).sort().join('\u0000')].join('|');
    // two findings that read the same on one side are told apart by their order
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { finding, key: base + '|' + count };
  });
}

export function compareBuildings(projectA, resultA, projectB, resultB, options) {
  const opts = options || {};
  const viewA = need(projectA, resultA, 'A');
  const viewB = need(projectB, resultB, 'B');
  const transition = Number.isInteger(opts.transition) && opts.transition >= 0 ? opts.transition : null;

  // ---- day types: matched by name, own and worked out on both sides
  const worked = (project, view) => new Map(project.dayTypes.filter((dayType) => loadOf(view, dayType.id) !== null).map((dayType) => [nameKey(dayType.name), dayType]));
  const daysA = worked(projectA, viewA);
  const daysB = worked(projectB, viewB);
  const names = [];
  for (const [key, dayType] of daysA) if (daysB.has(key)) names.push(dayType.name);
  const wanted = typeof opts.dayTypeName === 'string' ? nameKey(opts.dayTypeName) : null;
  const chosen = wanted === null ? (names.length > 0 ? nameKey(names[0]) : null) : daysA.has(wanted) && daysB.has(wanted) ? wanted : null;
  if (chosen === null) {
    const sentence = names.length === 0
      ? 'These two projects have no day type with the same name, so there is nothing to compare. Give a day of each the same name, then compare again.'
      : 'Only one of these projects has a day type named ' + opts.dayTypeName + '. Choose ' + names.join(' or ') + ', the day types both have.';
    return { refused: 'no-day-type', sentence };
  }
  const idA = daysA.get(chosen).id;
  const idB = daysB.get(chosen).id;
  const matched = { dayTypeName: daysA.get(chosen).name, dayTypes: names, dayTypeIdA: idA, dayTypeIdB: idB };

  // ---- figures
  const walksA = walkFigures(viewA, idA, null);
  const walksB = walkFigures(viewB, idB, null);
  const busyA = busiestOf(viewA, idA, null);
  const busyB = busiestOf(viewB, idB, null);
  const dayNamesA = new Map(projectA.dayTypes.map((dayType) => [dayType.id, dayType.name]));
  const dayNamesB = new Map(projectB.dayTypes.map((dayType) => [dayType.id, dayType.name]));
  const ofDay = (id) => (finding) => finding.where.dayTypeId === null || finding.where.dayTypeId === id;
  const findingsA = findingsOf(viewA).filter(ofDay(idA));
  const findingsB = findingsOf(viewB).filter(ofDay(idB));
  const countsA = countBySeverity(findingsA);
  const countsB = countBySeverity(findingsB);
  const bySeverity = {};
  for (const severity of SEVERITIES) bySeverity[severity] = sideOf(countsA[severity], countsB[severity]);
  const figures = {
    walking: sideOf(walksA.all.walking, walksB.all.walking),
    crowding: sideOf(walksA.all.waiting, walksB.all.waiting),
    busiest: { before: busyA, after: busyB, difference: (busyB ? busyB.load : 0) - (busyA ? busyA.load : 0) },
    late: sideOf(walksA.all.late, walksB.all.late),
    failed: sideOf(walksA.all.failed, walksB.all.failed),
    findings: bySeverity,
  };

  // ---- groups, by name
  const byName = (project, walks) => {
    const out = new Map();
    for (const group of project.groups) {
      const key = nameKey(group.name);
      if (!out.has(key)) out.set(key, { name: group.name, ids: [], figures: null });
      const entry = out.get(key);
      entry.ids.push(group.id);
      const mine = walks.groups.get(group.id);
      if (mine) {
        if (entry.figures === null) entry.figures = { walking: 0, waiting: 0, total: 0, late: 0, walks: 0, failed: 0 };
        for (const field of Object.keys(entry.figures)) entry.figures[field] += mine[field];
      }
    }
    return out;
  };
  const groupsA = byName(projectA, walksA);
  const groupsB = byName(projectB, walksB);
  const rows = [];
  const onlyBefore = [];
  const onlyAfter = [];
  for (const [key, a] of groupsA) {
    const b = groupsB.get(key);
    if (!b) {
      onlyBefore.push(a.name);
      continue;
    }
    if (a.figures === null && b.figures === null) continue;
    const failedChange = (b.figures ? b.figures.failed : 0) - (a.figures ? a.figures.failed : 0);
    const difference = a.figures && b.figures && failedChange === 0 ? b.figures.total - a.figures.total : null;
    rows.push({ name: a.name, groupIdBefore: a.ids[0], groupIdAfter: b.ids[0], before: a.figures, after: b.figures, difference, failedChange, order: rows.length });
  }
  for (const [key, b] of groupsB) if (!groupsA.has(key)) onlyAfter.push(b.name);
  const band = (row) => (row.failedChange > 0 ? 0 : row.failedChange < 0 ? 1 : row.difference !== null ? 2 : 3);
  rows.sort((x, y) => {
    if (band(x) !== band(y)) return band(x) - band(y);
    const size = Math.abs(y.failedChange) - Math.abs(x.failedChange) || Math.abs(y.difference || 0) - Math.abs(x.difference || 0);
    return size !== 0 ? size : x.order - y.order;
  });

  // ---- places
  const placesA = namedPlaces(projectA, viewA, idA, transition);
  const placesB = namedPlaces(projectB, viewB, idB, transition);
  const keys = [];
  for (const key of placesA.found.keys()) keys.push(key);
  for (const key of placesB.found.keys()) if (!placesA.found.has(key)) keys.push(key);
  const busier = [];
  const quieter = [];
  const fresh = [];
  const gone = [];
  const ambiguous = [];
  keys.forEach((key, order) => {
    const a = placesA.found.get(key) || [];
    const b = placesB.found.get(key) || [];
    const any = a[0] || b[0];
    if (a.length > 1 || b.length > 1) {
      ambiguous.push({ kind: any.kind, name: any.name, floorNames: any.floorNames, before: a.length, after: b.length });
      return;
    }
    if (a.length === 0 || b.length === 0) {
      const only = a.length === 0 ? b[0] : a[0];
      (a.length === 0 ? fresh : gone).push({ key, kind: only.kind, name: only.name, floorNames: only.floorNames, load: only.load });
      return;
    }
    if (a[0].load === null || b[0].load === null || a[0].load === b[0].load) return;
    const row = { key, kind: a[0].kind, name: a[0].name, floorNames: a[0].floorNames, before: a[0].load, after: b[0].load, difference: b[0].load - a[0].load, order };
    (row.difference > 0 ? busier : quieter).push(row);
  });
  const limit = Number.isInteger(opts.limit) && opts.limit >= 0 ? opts.limit : PLACES_LIMIT_DEFAULT;
  const rank = (x, y) => Math.abs(y.difference) - Math.abs(x.difference) || x.order - y.order;
  const trim = (list) => list.sort(rank).slice(0, limit).map(({ order, ...row }) => row);
  const places = {
    busier: trim(busier),
    quieter: trim(quieter),
    new: fresh,
    gone,
    ambiguous,
    unnamed: { before: placesA.unnamed, after: placesB.unnamed, sentence: placesA.unnamed + placesB.unnamed > 0 ? UNNAMED_SENTENCE : null },
  };

  // ---- findings, by a key of names
  const keyedA = findingKeys(projectA, findingsA, dayNamesA);
  const keyedB = findingKeys(projectB, findingsB, dayNamesB);
  const inA = new Set(keyedA.map((entry) => entry.key));
  const inB = new Set(keyedB.map((entry) => entry.key));
  const findings = {
    new: keyedB.filter((entry) => !inA.has(entry.key)).map((entry) => entry.finding),
    resolved: keyedA.filter((entry) => !inB.has(entry.key)).map((entry) => entry.finding),
    unchanged: keyedB.filter((entry) => inA.has(entry.key)).map((entry) => entry.finding),
  };

  // ---- rooms
  const keysA = roomKeys(projectA);
  const keysB = roomKeys(projectB);
  const paired = matchRooms(keysA, keysB);
  let numbered = 0;
  for (const list of keysA.values()) numbered += list.length;
  const rooms = { same: numbered - paired.missing, added: paired.addedNumbers, removed: paired.missingNumbers };

  return { figures, groups: { rows, onlyBefore, onlyAfter }, places, findings, rooms, matched, transition };
}
