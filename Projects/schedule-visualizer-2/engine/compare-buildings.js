// Comparing two buildings (spec 9.3, ARCHITECTURE 21.3 with 21.10's
// corrections). compareResults needs two results of one building; this
// compares two files that describe different buildings, say this year and a
// proposal with a new wing, each with its own result.
//
//   compareBuildings(projectA, resultA, projectB, resultB, { dayTypeName, transition, limit }?)
//
// A is "before" (the open project), B is "after" (the other file). A result
// is a createPipeline().run() result or a trimResult() answer; both are
// read through trimResult. Plain Node: it reads no clock and no page.
//
// Options
//   dayTypeName  the day type to compare, by name (see below)
//   transition   one passing time (an integer from 0 to the day's transitions
//                less one on both sides) to measure places in. Left out (or
//                null), each place's load is its OWN busiest transition: a
//                whole-day figure, so two places' loads may be of different
//                passing times and are not a sum. A transition that is not an
//                integer, is negative or is not one of this day's on both
//                sides is refused ({ refused: 'transition', sentence }), never
//                echoed back as null.
//   limit        the most rows each of places.busier, places.quieter and
//                places.changed lists (default 10; a non-integer or negative
//                limit means the default). The lists are capped, the totals
//                (busierTotal, quieterTotal, changedTotal) are not.
//
// Day types are matched by name (NFKC, lower case, spaces collapsed, as the
// engine's other name matching is) among the day types both sides worked out
// a load for. A name two day types of one side share keeps the first and is
// listed in matched.duplicateDayTypes. The comparison is for one matched day
// type: options.dayTypeName's, or the first of A's that B has. A refusal is
// { refused, sentence } and nothing else:
//   'no-day-type'  the asked day type is on neither side; on one side only;
//                  or no day type at all has the same name on both sides
//                  (three sentences)
//   'no-loads'     a result with no loads at all (a trimmed result that lost
//                  them): the sentence says which side
//   'transition'   see the option
//
// The answer:
//   { figures, groups, places, findings, rooms, matched, transition, unitsDiffer }
//   matched    { dayTypeName, dayTypes: [names matched, A's order], dayTypeIdA,
//              dayTypeIdB, unworked: [names both sides have but one has no
//              load for], duplicateDayTypes: { before: [names], after: [names] } }
//   unitsDiffer  null, or { before, after, sentence } when one side counts
//              'students' and the other 'groups'. Then loads are not
//              comparable numbers: figures.busiest and every place row carry
//              `unitsDiffer: true` and a null difference, and busier/quieter
//              are empty (the matched places are in `changed`, unranked).
//   figures    as compareResults': walking, crowding, busiest, late, failed
//              and findings by severity, each { before, after, difference },
//              each side reckoned from its own result and its own day type id.
//              busiest.before/after have no node or link indices (they mean
//              nothing across two buildings); placeId is its own side's.
//              onlyBefore and onlyAfter: { groups, walks, walking, waiting,
//              late, failed } summed over the groups no group of the other
//              side matches (blank-named ones included), so a new wing's added
//              walking, lateness and failed walks are explained.
//   groups     { rows, onlyBefore, onlyAfter, noNameBefore, noNameAfter }: rows
//              are matched by name and as compareResults' groups are ({ name,
//              groupIdBefore, groupIdAfter, before, after, difference,
//              failedChange, mergedBefore, mergedAfter }) in its order.
//              A name two groups of one side share is one row: their walks
//              add up, and mergedBefore/mergedAfter count the groups behind
//              it (1 when it is one). A group with a blank name is never
//              matched: onlyBefore/onlyAfter list "(no name)" once and
//              noNameBefore/noNameAfter count them. Names are as typed.
//   places     { busier, quieter, changed, busierTotal, quieterTotal,
//              changedTotal, new, gone, ambiguous, unnamed }
//              Keys are built from their parts by JSON.stringify, so no name
//              can collide with a separator. Named corridors are matched by
//              floor name and name; a floor that was renamed, whose set of
//              corridor names matches exactly one floor of the other side (and
//              no other), is matched through, and its rows carry
//              renamedFloor: { before, after }. Elevators are matched by their
//              name alone (the car letter, as elevatorCars names a car, else
//              the label) and so keep their row when the floors they serve
//              change. Stairs are matched by label and floor names; a stairs
//              whose label is the only one of that label on each side is
//              matched with the other even when its floor names differ.
//              Every connection row carries floorsBefore, floorsAfter and
//              floorsChanged. Rows: { key, kind, name, floorNames (as A
//              writes them), before, after, difference } (+ the above),
//              biggest change first, then A's order. A row whose floors
//              changed but whose load did not is no row (no change in load).
//              `new` and `gone` are the places only B or only A has ({ key,
//              kind, name, floorNames, load, unit }). A key that occurs
//              twice on one side is `ambiguous` ({ kind, name, floorNames,
//              before, after }: how many on each side) and is matched with
//              nothing. `unnamed` is { before, after, sentence }: the places
//              with no name of their own, which are left out, and the sentence
//              saying so (null when there are none).
//   findings   { new, resolved, unchanged } by a key of the kind, the day
//              type's name, the period and the NAMES of what it is about
//              (group names, room numbers as rooms.same reads them, teacher
//              names), never ids. A finding about an unnumbered room, a
//              blank name, or nothing at all is matched only by the floor
//              name plus its text, and only when that is unique on both sides;
//              otherwise it is not matched (new or resolved), never paired by
//              order. new and unchanged are B's findings, resolved are A's.
//   rooms      { same, added: [numbers], removed: [numbers] }: numbers as
//              matchRooms counts them (added are only in B, removed only in A)
//
// Every name is returned as typed and is only ever data. Throws a TypeError
// for a missing project or result, or a result whose loads are of day types
// the project does not have; everything else is a value.

import { allRooms, floorOfRoom } from './schema.js';
import { countBySeverity, SEVERITIES } from './findings.js';
import { trimResult, walkFigures, busiestOf, findingsOf, roomKeys, matchRooms } from './scenario.js';

export const UNNAMED_SENTENCE = 'Corridors without names cannot be matched between two buildings, so they are left out of this list.';
export const NO_NAME = '(no name)';

const PLACES_LIMIT_DEFAULT = 10;

// Names are matched as ARCHITECTURE 21.3 says: NFKC, lower case, every run of
// spaces one space, the ends trimmed. The names themselves are never changed.
function nameKey(name) {
  return String(name).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

// A key from its parts: JSON, so a '|' or a NUL in a name cannot make two
// different parts read as one.
function keyOf(...parts) {
  return JSON.stringify(parts);
}

function need(project, result, side) {
  if (!project || typeof project !== 'object' || !project.building || !Array.isArray(project.dayTypes) || !Array.isArray(project.groups)) {
    throw new TypeError('compareBuildings needs project ' + side + '.');
  }
  if (!result || typeof result !== 'object') throw new TypeError('compareBuildings needs a result for project ' + side + '.');
  const view = trimResult(result);
  const own = new Set(project.dayTypes.map((dayType) => dayType && dayType.id));
  if (Array.isArray(view.loads)) {
    for (const load of view.loads) {
      if (load && !own.has(load.dayTypeId)) throw new TypeError('compareBuildings was given a result for project ' + side + ' that was not worked out from that project: it has a load for a day type the project does not have.');
    }
  }
  return view;
}

function sideOf(before, after) {
  return { before, after, difference: after - before };
}

function loadOf(view, dayTypeId) {
  const list = Array.isArray(view.loads) ? view.loads : [];
  return list.find((load) => load && load.dayTypeId === dayTypeId) || null;
}

// A place's load, as scenario.js's own placeLoad reads it: the highest of its
// members outside the exclusion zones, in one transition or (null) in the
// place's own busiest one. Null when the place is wholly inside zones.
function placeLoad(load, place, transition) {
  if (!load) return null;
  const isLink = place.kind === 'connection';
  const members = isLink ? [place.link] : place.nodes;
  const source = isLink ? load.connections : load.cells;
  const shut = isLink ? load.excludedConnections : load.excluded;
  const values = transition === null ? source.busiest : source.byTransition[transition];
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

// What an elevator is called, the way elevatorCars names a car: the first
// connection's car letter, else its label; failing both, the typed part of
// the place's own name ("Elevator D" is words and the name D).
function elevatorName(connection, place) {
  if (connection && !blank(connection.car)) return connection.car;
  if (connection && !blank(connection.label)) return connection.label;
  const typed = Array.isArray(place.parts) ? place.parts.find((part) => part && part.name === true && !blank(part.text)) : null;
  return typed ? typed.text : '';
}

// The named places of one side. Each entry: { kind, name, floorNames, load,
// order, floorKey (corridors) }; places with no name of their own are counted.
function namedPlaces(project, view, dayTypeId, transition) {
  const cut = view.places && Array.isArray(view.places.places) ? view.places.places : [];
  const load = loadOf(view, dayTypeId);
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const corridors = new Map();
  for (const floor of project.building.floors) for (const corridor of floor.corridors || []) corridors.set(corridor.id, corridor);
  const connections = new Map((project.building.connections || []).map((connection) => [connection.id, connection]));
  const floorName = (id) => (floors.has(id) ? floors.get(id).name : '');
  const entries = [];
  let unnamed = 0;
  cut.forEach((place, order) => {
    const value = placeLoad(load, place, transition);
    if (place.kind === 'corridor') {
      const corridor = corridors.get(place.corridorId);
      if (corridor && !blank(corridor.name)) {
        const floorNames = [floorName(place.floorId)];
        entries.push({ kind: 'corridor', name: corridor.name, floorNames, floorKey: nameKey(floorNames[0]), load: value, order });
        return;
      }
    } else if (place.kind === 'connection') {
      const connection = connections.get(place.connectionId);
      if (place.elevator === true) {
        const name = elevatorName(connection, place);
        if (!blank(name)) {
          const floorNames = [];
          for (const id of place.floorIds || [place.floorId]) if (!floorNames.includes(floorName(id))) floorNames.push(floorName(id));
          entries.push({ kind: 'elevator', name, floorNames, load: value, order });
          return;
        }
      } else if (connection && !blank(connection.label)) {
        entries.push({ kind: 'stairs', name: connection.label, floorNames: (place.floorIds || [place.floorId]).map(floorName), load: value, order });
        return;
      }
    }
    unnamed += 1;
  });
  return { entries, unnamed };
}

const floorsKey = (entry) => entry.floorNames.map(nameKey).sort();

// A floor renamed between the two files: a floor name only one side has
// corridors on, whose set of corridor names is exactly the set of exactly one
// floor name only the other side has corridors on, and which no other floor
// of that side has. A's entries on it then take B's floor in their key.
function renamedFloors(entriesA, entriesB) {
  const floorsOf = (entries) => {
    const out = new Map();
    for (const entry of entries) {
      if (entry.kind !== 'corridor') continue;
      if (!out.has(entry.floorKey)) out.set(entry.floorKey, { name: entry.floorNames[0], names: [] });
      out.get(entry.floorKey).names.push(nameKey(entry.name));
    }
    for (const floor of out.values()) floor.signature = JSON.stringify(floor.names.slice().sort());
    return out;
  };
  const a = floorsOf(entriesA);
  const b = floorsOf(entriesB);
  const lonelyA = [...a].filter(([key]) => !b.has(key));
  const lonelyB = [...b].filter(([key]) => !a.has(key));
  const map = new Map();
  for (const [keyA, floorA] of lonelyA) {
    const partners = lonelyB.filter(([, floorB]) => floorB.signature === floorA.signature);
    if (partners.length !== 1) continue;
    const [keyB, floorB] = partners[0];
    if (lonelyA.filter(([, other]) => other.signature === floorB.signature).length !== 1) continue;
    map.set(keyA, { key: keyB, before: floorA.name, after: floorB.name });
  }
  return map;
}

// Gives every entry its match key and groups each side's entries by it.
function keyPlaces(entriesA, entriesB) {
  const renamed = renamedFloors(entriesA, entriesB);
  for (const entry of entriesA) {
    if (entry.kind === 'corridor' && renamed.has(entry.floorKey)) {
      const through = renamed.get(entry.floorKey);
      entry.matchFloor = through.key;
      entry.renamedFloor = { before: through.before, after: through.after };
    } else entry.matchFloor = entry.floorKey;
  }
  for (const entry of entriesB) entry.matchFloor = entry.floorKey;
  const keyIt = (entry) => {
    if (entry.kind === 'corridor') entry.key = keyOf('corridor', entry.matchFloor, nameKey(entry.name));
    else if (entry.kind === 'elevator') entry.key = keyOf('elevator', nameKey(entry.name));
    else entry.key = keyOf('stairs', nameKey(entry.name), floorsKey(entry));
  };
  entriesA.forEach(keyIt);
  entriesB.forEach(keyIt);
  // stairs whose label is the one stairs of that label on each side, with
  // other floor names: the same stairs, its floors changed
  const byLabel = (entries) => {
    const out = new Map();
    for (const entry of entries) {
      if (entry.kind !== 'stairs') continue;
      const key = nameKey(entry.name);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(entry);
    }
    return out;
  };
  const labelsB = byLabel(entriesB);
  for (const [label, listA] of byLabel(entriesA)) {
    const listB = labelsB.get(label);
    if (listA.length === 1 && listB && listB.length === 1) listB[0].key = listA[0].key;
  }
  const group = (entries) => {
    const found = new Map();
    for (const entry of entries) {
      if (!found.has(entry.key)) found.set(entry.key, []);
      found.get(entry.key).push(entry);
    }
    return found;
  };
  return { foundA: group(entriesA), foundB: group(entriesB) };
}

// The names a finding is about, as this side writes them, and the key that
// pairs it with one of the other side (null: it is paired with none).
function findingKeys(project, findings, dayTypeNames) {
  const groups = new Map(project.groups.map((group) => [group.id, group.name]));
  const teachers = new Map((project.teachers || []).map((teacher) => [teacher.id, teacher.name]));
  const rooms = new Map(allRooms(project).map((room) => [room.id, room]));
  const loose = new Map();
  for (const [key, list] of roomKeys(project)) for (const room of list) loose.set(room.id, key);
  const counts = new Map();
  const listed = findings.map((finding) => {
    const where = finding.where || {};
    const names = new Map();
    let unmatchable = false;
    const add = (kind, key) => {
      if (key === '') unmatchable = true;
      else names.set(keyOf(kind, key), [kind, key]);
    };
    const group = (id) => { if (groups.has(id)) add('g', nameKey(groups.get(id))); };
    const teacher = (id) => { if (teachers.has(id)) add('t', nameKey(teachers.get(id))); };
    const room = (id) => {
      if (!rooms.has(id)) return;
      if (loose.has(id)) add('r', loose.get(id));
      else unmatchable = true;
    };
    for (const id of where.groupIds || []) group(id);
    if (where.roomId) room(where.roomId);
    if (where.teacherId) teacher(where.teacherId);
    for (const id of finding.about || []) {
      if (groups.has(id)) group(id);
      else if (teachers.has(id)) teacher(id);
      else if (rooms.has(id)) room(id);
    }
    const day = where.dayTypeId && dayTypeNames.has(where.dayTypeId) ? nameKey(dayTypeNames.get(where.dayTypeId)) : '';
    const period = where.period === null || where.period === undefined ? '' : where.period;
    if (names.size === 0 || unmatchable) {
      // the floor name plus the text: stable while the sentence is, and never
      // by order; with no floor to name, or no text, it is matched with nothing
      const floor = where.roomId ? floorOfRoom(project, where.roomId) : null;
      const text = typeof finding.text === 'string' ? finding.text : '';
      const key = floor && !blank(floor.name) && text !== '' ? keyOf('text', finding.kind, day, period, nameKey(floor.name), text) : null;
      if (key !== null) counts.set(key, (counts.get(key) || 0) + 1);
      return { finding, key, exact: true };
    }
    return { finding, key: keyOf('names', finding.kind, day, period, [...names.values()].sort((x, y) => (keyOf(...x) < keyOf(...y) ? -1 : 1))), exact: false };
  });
  // two findings that read the same on one side, with names, are told apart
  // by their order; one with only a floor and a text that is not unique is not
  const seen = new Map();
  for (const entry of listed) {
    if (entry.key === null) continue;
    if (entry.exact) {
      if (counts.get(entry.key) > 1) entry.key = null;
      continue;
    }
    const count = (seen.get(entry.key) || 0) + 1;
    seen.set(entry.key, count);
    entry.key = keyOf(entry.key, count);
  }
  return listed;
}

function sumFigures(list) {
  const total = { groups: 0, walks: 0, walking: 0, waiting: 0, late: 0, failed: 0 };
  for (const entry of list) {
    total.groups += entry.ids.length;
    if (entry.figures) for (const field of ['walks', 'walking', 'waiting', 'late', 'failed']) total[field] += entry.figures[field];
  }
  return total;
}

function withoutIndices(busiest) {
  if (!busiest) return busiest;
  const { node, link, ...rest } = busiest;
  return rest;
}

export function compareBuildings(projectA, resultA, projectB, resultB, options) {
  const opts = options || {};
  const viewA = need(projectA, resultA, 'A');
  const viewB = need(projectB, resultB, 'B');

  // ---- a result with no loads at all has nothing to compare
  const empty = [];
  if (!Array.isArray(viewA.loads) || viewA.loads.length === 0) empty.push('before');
  if (!Array.isArray(viewB.loads) || viewB.loads.length === 0) empty.push('after');
  if (empty.length > 0) {
    return { refused: 'no-loads', sentence: 'The result for the ' + empty.join(' and the ') + ' project has no loads in it, so there is nothing to compare. Work the schedule out again, then compare.' };
  }

  // ---- day types: matched by name, the first of a name kept, worked on both sides
  const daysOf = (project, view) => {
    const first = new Map();
    const duplicated = [];
    for (const dayType of project.dayTypes) {
      const key = nameKey(dayType.name);
      if (!first.has(key)) first.set(key, dayType);
      else if (!duplicated.includes(first.get(key).name)) duplicated.push(first.get(key).name);
    }
    const worked = new Map([...first].filter(([, dayType]) => loadOf(view, dayType.id) !== null));
    return { first, worked, duplicated };
  };
  const daysA = daysOf(projectA, viewA);
  const daysB = daysOf(projectB, viewB);
  const names = [];
  const unworked = [];
  for (const [key, dayType] of daysA.first) {
    if (!daysB.first.has(key)) continue;
    if (daysA.worked.has(key) && daysB.worked.has(key)) names.push(dayType.name);
    else unworked.push(dayType.name);
  }
  const wanted = typeof opts.dayTypeName === 'string' ? nameKey(opts.dayTypeName) : null;
  const chosen = wanted === null ? (names.length > 0 ? nameKey(names[0]) : null) : daysA.worked.has(wanted) && daysB.worked.has(wanted) ? wanted : null;
  if (chosen === null) {
    let sentence;
    if (wanted === null) {
      sentence = 'These two projects have no day type with the same name, so there is nothing to compare. Give a day of each the same name, then compare again.';
    } else {
      const inA = daysA.worked.has(wanted);
      const inB = daysB.worked.has(wanted);
      const choices = names.length > 0 ? ' Choose ' + names.join(' or ') + ', the day types both have.' : ' The two projects have no day type with the same name, so there is nothing to compare.';
      sentence = !inA && !inB
        ? 'Neither of these projects has a day type named ' + opts.dayTypeName + ' with a schedule worked out.' + choices
        : 'Only one of these projects has a day type named ' + opts.dayTypeName + ' with a schedule worked out.' + choices;
    }
    return { refused: 'no-day-type', sentence };
  }
  const idA = daysA.worked.get(chosen).id;
  const idB = daysB.worked.get(chosen).id;
  const matched = {
    dayTypeName: daysA.worked.get(chosen).name,
    dayTypes: names,
    dayTypeIdA: idA,
    dayTypeIdB: idB,
    unworked,
    duplicateDayTypes: { before: daysA.duplicated, after: daysB.duplicated },
  };

  // ---- the transition, when one is asked for
  const loadA = loadOf(viewA, idA);
  const loadB = loadOf(viewB, idB);
  let transition = null;
  if (opts.transition !== undefined && opts.transition !== null) {
    const fewest = Math.min(loadA.transitions, loadB.transitions);
    if (!Number.isInteger(opts.transition) || opts.transition < 0 || opts.transition >= fewest) {
      return { refused: 'transition', sentence: 'The transition asked for is not one of this day\'s passing times: ' + (fewest > 0 ? 'choose a whole number from 0 to ' + (fewest - 1) : 'there are none') + ', or leave it out to read each place at its own busiest time.' };
    }
    transition = opts.transition;
  }
  const unitsDiffer = loadA.unit !== loadB.unit;

  // ---- figures
  const walksA = walkFigures(viewA, idA, null);
  const walksB = walkFigures(viewB, idB, null);
  const busyA = withoutIndices(busiestOf(viewA, idA, null));
  const busyB = withoutIndices(busiestOf(viewB, idB, null));
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
    busiest: unitsDiffer
      ? { before: busyA, after: busyB, difference: null, unitsDiffer: true }
      : { before: busyA, after: busyB, difference: (busyB ? busyB.load : 0) - (busyA ? busyA.load : 0) },
    late: sideOf(walksA.all.late, walksB.all.late),
    failed: sideOf(walksA.all.failed, walksB.all.failed),
    findings: bySeverity,
  };

  // ---- groups, by name
  const byName = (project, walks) => {
    const out = new Map();
    const noName = { ids: [], figures: null };
    const add = (entry, group) => {
      entry.ids.push(group.id);
      const mine = walks.groups.get(group.id);
      if (!mine) return;
      if (entry.figures === null) entry.figures = { walking: 0, waiting: 0, total: 0, late: 0, walks: 0, failed: 0 };
      for (const field of Object.keys(entry.figures)) entry.figures[field] += mine[field];
    };
    for (const group of project.groups) {
      const key = nameKey(group.name);
      if (key === '') {
        add(noName, group);
        continue;
      }
      if (!out.has(key)) out.set(key, { name: group.name, ids: [], figures: null });
      add(out.get(key), group);
    }
    return { out, noName };
  };
  const groupsA = byName(projectA, walksA);
  const groupsB = byName(projectB, walksB);
  const ranked = [];
  const onlyBefore = [];
  const onlyAfter = [];
  const lostA = [];
  const lostB = [];
  for (const [key, a] of groupsA.out) {
    const b = groupsB.out.get(key);
    if (!b) {
      onlyBefore.push(a.name);
      lostA.push(a);
      continue;
    }
    if (a.figures === null && b.figures === null) continue;
    const failedChange = (b.figures ? b.figures.failed : 0) - (a.figures ? a.figures.failed : 0);
    const difference = a.figures && b.figures && failedChange === 0 ? b.figures.total - a.figures.total : null;
    ranked.push({
      order: ranked.length,
      row: { name: a.name, groupIdBefore: a.ids[0], groupIdAfter: b.ids[0], before: a.figures, after: b.figures, difference, failedChange, mergedBefore: a.ids.length, mergedAfter: b.ids.length },
    });
  }
  for (const [key, b] of groupsB.out) {
    if (groupsA.out.has(key)) continue;
    onlyAfter.push(b.name);
    lostB.push(b);
  }
  if (groupsA.noName.ids.length > 0) {
    onlyBefore.push(NO_NAME);
    lostA.push(groupsA.noName);
  }
  if (groupsB.noName.ids.length > 0) {
    onlyAfter.push(NO_NAME);
    lostB.push(groupsB.noName);
  }
  figures.onlyBefore = sumFigures(lostA);
  figures.onlyAfter = sumFigures(lostB);
  const band = (row) => (row.failedChange > 0 ? 0 : row.failedChange < 0 ? 1 : row.difference !== null ? 2 : 3);
  ranked.sort((x, y) => {
    if (band(x.row) !== band(y.row)) return band(x.row) - band(y.row);
    const size = Math.abs(y.row.failedChange) - Math.abs(x.row.failedChange) || Math.abs(y.row.difference || 0) - Math.abs(x.row.difference || 0);
    return size !== 0 ? size : x.order - y.order;
  });
  const groups = {
    rows: ranked.map((entry) => entry.row),
    onlyBefore,
    onlyAfter,
    noNameBefore: groupsA.noName.ids.length,
    noNameAfter: groupsB.noName.ids.length,
  };

  // ---- places
  const placesA = namedPlaces(projectA, viewA, idA, transition);
  const placesB = namedPlaces(projectB, viewB, idB, transition);
  const { foundA, foundB } = keyPlaces(placesA.entries, placesB.entries);
  const keys = [];
  for (const key of foundA.keys()) keys.push(key);
  for (const key of foundB.keys()) if (!foundA.has(key)) keys.push(key);
  const busier = [];
  const quieter = [];
  const changed = [];
  const fresh = [];
  const gone = [];
  const ambiguous = [];
  keys.forEach((key, order) => {
    const a = foundA.get(key) || [];
    const b = foundB.get(key) || [];
    const any = a[0] || b[0];
    if (a.length > 1 || b.length > 1) {
      ambiguous.push({ kind: any.kind, name: any.name, floorNames: any.floorNames, before: a.length, after: b.length });
      return;
    }
    if (a.length === 0 || b.length === 0) {
      const only = a.length === 0 ? b[0] : a[0];
      (a.length === 0 ? fresh : gone).push({ key, kind: only.kind, name: only.name, floorNames: only.floorNames, load: only.load, unit: a.length === 0 ? loadB.unit : loadA.unit });
      return;
    }
    if (a[0].load === null || b[0].load === null) return;
    if (!unitsDiffer && a[0].load === b[0].load) return;
    const row = { key, kind: a[0].kind, name: a[0].name, floorNames: a[0].floorNames, before: a[0].load, after: b[0].load, difference: unitsDiffer ? null : b[0].load - a[0].load };
    if (unitsDiffer) row.unitsDiffer = true;
    if (a[0].kind !== 'corridor') {
      row.floorsBefore = a[0].floorNames;
      row.floorsAfter = b[0].floorNames;
      row.floorsChanged = JSON.stringify(floorsKey(a[0])) !== JSON.stringify(floorsKey(b[0]));
    }
    if (a[0].renamedFloor) row.renamedFloor = a[0].renamedFloor;
    row.order = order;
    (unitsDiffer ? changed : row.difference > 0 ? busier : quieter).push(row);
  });
  const limit = Number.isInteger(opts.limit) && opts.limit >= 0 ? opts.limit : PLACES_LIMIT_DEFAULT;
  const rank = (x, y) => Math.abs(y.difference) - Math.abs(x.difference) || x.order - y.order;
  const trim = (list, sorted) => (sorted ? list.sort(rank) : list).slice(0, limit).map(({ order, ...row }) => row);
  const places = {
    busier: trim(busier, true),
    quieter: trim(quieter, true),
    changed: trim(changed, false),
    busierTotal: busier.length,
    quieterTotal: quieter.length,
    changedTotal: changed.length,
    new: fresh,
    gone,
    ambiguous,
    unnamed: { before: placesA.unnamed, after: placesB.unnamed, sentence: placesA.unnamed + placesB.unnamed > 0 ? UNNAMED_SENTENCE : null },
  };

  // ---- findings, by a key of names
  const keyedA = findingKeys(projectA, findingsA, dayNamesA);
  const keyedB = findingKeys(projectB, findingsB, dayNamesB);
  const inA = new Set(keyedA.map((entry) => entry.key).filter((key) => key !== null));
  const inB = new Set(keyedB.map((entry) => entry.key).filter((key) => key !== null));
  const findings = {
    new: keyedB.filter((entry) => entry.key === null || !inA.has(entry.key)).map((entry) => entry.finding),
    resolved: keyedA.filter((entry) => entry.key === null || !inB.has(entry.key)).map((entry) => entry.finding),
    unchanged: keyedB.filter((entry) => entry.key !== null && inA.has(entry.key)).map((entry) => entry.finding),
  };

  // ---- rooms
  const keysA = roomKeys(projectA);
  const keysB = roomKeys(projectB);
  const paired = matchRooms(keysA, keysB);
  let numbered = 0;
  for (const list of keysA.values()) numbered += list.length;
  const rooms = { same: numbered - paired.missing, added: paired.addedNumbers, removed: paired.missingNumbers };

  const unitsNote = unitsDiffer
    ? { before: loadA.unit, after: loadB.unit, sentence: 'These two projects count the crowd in different units (before: ' + loadA.unit + ', after: ' + loadB.unit + '), so their loads are not numbers to subtract. Walking, lateness and failed walks can still be compared.' }
    : null;
  return { figures, groups, places, findings, rooms, matched, transition, unitsDiffer: unitsNote };
}
