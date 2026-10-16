// The scenario lab's engine (spec 9, ARCHITECTURE 6.6): trial changes to the
// schedule, held apart from it, applied to a copy, reconciled with the real
// schedule as it changes underneath, and compared figure by figure.
//
// A scenario is { name, changes, compared } (schema.js), and a change is one
// of three kinds, each naming its own day type:
//
//   { kind: 'move',        dayTypeId, groupId, period, roomId }
//   { kind: 'swapPeriods', dayTypeId, groupId, periodA, periodB }
//   { kind: 'swapRooms',   dayTypeId, groupA, groupB, period }
//
// A change touches slots: a move one, a swap two. The rules:
//
//   - A change names only a day type that is its own copy. Applying one on a
//     day type that is "the same as A Day" is refused with the schedule
//     editor's own words (engine/actions.js setSlot and moveSlot, which this
//     module composes and never re-implements).
//   - normalise keeps one change per slot: a later change that touches a
//     slot an earlier one touches replaces the earlier one, whole. So no two
//     kept changes share a slot, and the order they are applied in does not
//     matter. A change that leaves its slots as the real schedule has them
//     is removed: "move 7-1 to 204 and back" leaves nothing.
//   - reconcile is a view, never a write. It says which changes no longer
//     apply to the project as it is (a group, day type, period or room gone,
//     a day type made "the same as" again, or a change the real schedule now
//     already has) and why, in a sentence, and hands back the rest. The
//     scenario keeps every change: undoing the deletion that dropped one
//     brings it back.
//   - A move changes the room and nothing else of the slot. A slot that
//     names no teacher is taught by its room's teachers (teacher-day.js
//     slotTeacherIds), so moving it can change who teaches; changeWords says
//     so whenever it does. A swap of periods moves whole slots, teachers and
//     labels with them. A swap of rooms trades the room (or the number a slot
//     kept for a room not in the building) and nothing else.
//
// What this module gives:
//
//   applyScenario(project, scenario?)    the project with every change applied,
//                                        as pure data; scenario defaults to
//                                        project.scenario. Throws the
//                                        ActionError setSlot or moveSlot gave
//                                        for a change that cannot be applied.
//                                        project.scenario is left as it was.
//   changeSlots(change)                  the slots a change touches
//   editedGroupIds(changes)              the groups the changes name, in order
//   normalise(project, changes)          the changes, one per slot, no-ops gone
//   reconcile(project, scenario)         { changes, dropped: [{ change, sentence }] }
//   changeWords(project, change)         { parts, text, teachers } for a chip
//   compareResults(before, after, options?)   every figure of spec 9.2
//   loadDifference(before, after, options?)   the difference map's numbers
//   scenarioFromDiff(projectA, projectB, options?)   "compare with another project file"
//
// `parts` are [{ text, name }], name true for a piece a user typed, as in
// places.js and directions.js, so a screen can isolate typed text.

import { findRoom, findById, resolveSlotRoom, nameKey, roomNumberKey, allRooms } from './schema.js';
import { findDayType, isOwnCopy, ownDayTypes, baseDayType, effectiveSchedule } from './day-types.js';
import { periodName } from './bells.js';
import { slotTeacherIds } from './teacher-day.js';
import { isLate } from './crowd.js';
import { countBySeverity, SEVERITIES } from './findings.js';
import { setSlot, moveSlot, ActionError } from './actions.js';

// ---------------------------------------------------------------- slots

// The slots a change touches, each { dayTypeId, groupId, period }.
export function changeSlots(change) {
  if (!change || typeof change !== 'object') return [];
  const d = change.dayTypeId;
  if (change.kind === 'move') return [{ dayTypeId: d, groupId: change.groupId, period: change.period }];
  if (change.kind === 'swapPeriods') return [{ dayTypeId: d, groupId: change.groupId, period: change.periodA }, { dayTypeId: d, groupId: change.groupId, period: change.periodB }];
  if (change.kind === 'swapRooms') return [{ dayTypeId: d, groupId: change.groupA, period: change.period }, { dayTypeId: d, groupId: change.groupB, period: change.period }];
  return [];
}

function slotKey(slot) {
  return slot.dayTypeId + '\u0000' + slot.groupId + '\u0000' + slot.period;
}

function changesOf(scenario) {
  if (Array.isArray(scenario)) return scenario;
  return scenario && Array.isArray(scenario.changes) ? scenario.changes : [];
}

// The groups the changes name, each once, in the order first named.
export function editedGroupIds(changes) {
  const ids = [];
  for (const change of changesOf(changes)) {
    for (const slot of changeSlots(change)) if (!ids.includes(slot.groupId)) ids.push(slot.groupId);
  }
  return ids;
}

// The slot as the real schedule has it, or null when the group, the day type
// or the period is not there. Only an own day type has slots of its own.
function realSlot(project, dayTypeId, groupId, period) {
  const group = findById(project.groups, groupId);
  if (!group || !isOwnCopy(project, dayTypeId)) return null;
  const day = group.days ? group.days[dayTypeId] : undefined;
  if (!Array.isArray(day) || !Number.isInteger(period) || period < 0 || period >= project.settings.periods) return null;
  return day[period] || null;
}

// Where a slot is: a room in the building, or the number it kept.
function placeOfSlot(project, slot) {
  const resolved = resolveSlotRoom(project, slot);
  return resolved.room ? { room: resolved.room.id, roomText: '' } : { room: null, roomText: resolved.text };
}

function samePlace(a, b) {
  return a.room === b.room && (a.room !== null || roomNumberKey(a.roomText) === roomNumberKey(b.roomText));
}

function sameIds(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameSlot(a, b) {
  return a.room === b.room && a.roomText === b.roomText && a.label === b.label && sameIds(a.teacherIds || [], b.teacherIds || []);
}

// Does this change leave its slots as the real schedule has them? False when
// a slot it names is not there: that is for reconcile to say.
function isNoChange(project, change) {
  const slots = changeSlots(change).map((slot) => realSlot(project, slot.dayTypeId, slot.groupId, slot.period));
  if (slots.length === 0 || slots.some((slot) => slot === null)) return false;
  if (change.kind === 'move') return slots[0].room === change.roomId && findRoom(project, change.roomId) !== null;
  if (change.kind === 'swapPeriods') return change.periodA === change.periodB || sameSlot(slots[0], slots[1]);
  return change.groupA === change.groupB || samePlace(placeOfSlot(project, slots[0]), placeOfSlot(project, slots[1]));
}

// ---------------------------------------------------------------- apply

function applyOne(project, change) {
  if (change.kind === 'move') {
    return setSlot(project, { groupId: change.groupId, dayTypeId: change.dayTypeId, period: change.period, slot: { room: change.roomId } });
  }
  if (change.kind === 'swapPeriods') {
    return moveSlot(project, { groupId: change.groupId, dayTypeId: change.dayTypeId, from: change.periodA, to: change.periodB });
  }
  if (change.kind === 'swapRooms') {
    // read through setSlot's own refusals first, so a missing group or a
    // "same as" day type is refused in its words before a slot is read
    const probe = (groupId) => setSlot(project, { groupId, dayTypeId: change.dayTypeId, period: change.period, slot: {} });
    probe(change.groupA);
    probe(change.groupB);
    const a = placeOfSlot(project, realSlot(project, change.dayTypeId, change.groupA, change.period));
    const b = placeOfSlot(project, realSlot(project, change.dayTypeId, change.groupB, change.period));
    const first = setSlot(project, { groupId: change.groupA, dayTypeId: change.dayTypeId, period: change.period, slot: b });
    return setSlot(first, { groupId: change.groupB, dayTypeId: change.dayTypeId, period: change.period, slot: a });
  }
  throw new ActionError('A scenario change is one of move, swapPeriods and swapRooms.', 'bad-value');
}

// The project with every change applied to its own day type, in order. A
// change that cannot be applied throws, and nothing is half done: the
// project handed in is never changed. Apply what reconcile kept to skip the
// changes that no longer apply.
export function applyScenario(project, scenario) {
  const changes = changesOf(scenario === undefined ? project.scenario : scenario);
  let next = project;
  for (const change of changes) next = applyOne(next, change);
  return next;
}

// ---------------------------------------------------------------- normalise

// One change per slot, the later replacing the earlier, and no change that
// leaves the schedule as it is. Returns the list it was given when nothing
// was removed.
export function normalise(project, changes) {
  const list = changesOf(changes);
  const keep = new Array(list.length).fill(true);
  const owner = new Map();
  list.forEach((change, index) => {
    for (const slot of changeSlots(change)) {
      const key = slotKey(slot);
      if (owner.has(key)) keep[owner.get(key)] = false;
    }
    for (const slot of changeSlots(change)) owner.set(slotKey(slot), index);
  });
  // an earlier change that lost one slot is gone whole, so its other slot is free again
  list.forEach((change, index) => {
    if (keep[index] && isNoChange(project, change)) keep[index] = false;
  });
  const kept = list.filter((change, index) => keep[index]);
  return kept.length === list.length ? list : kept;
}

// ---------------------------------------------------------------- words

function typed(text) {
  return { text: String(text), name: true };
}

function words(text) {
  return { text, name: false };
}

function joinParts(parts) {
  return parts.map((part) => part.text).join('');
}

function groupParts(project, groupId) {
  const group = findById(project.groups, groupId);
  return group ? [typed(group.name)] : [words('a group no longer in the project')];
}

// A room as a chip shows it: its number as typed. A slot with no room is
// "no room"; one whose room is not in the building shows the number it kept.
function slotRoomParts(project, slot) {
  if (!slot) return [words('?')];
  const resolved = resolveSlotRoom(project, slot);
  if (resolved.room) return roomParts(resolved.room);
  if (resolved.text !== '') return [typed(resolved.text)];
  return [words('no room')];
}

function roomParts(room) {
  if (!room) return [words('a room no longer in the building')];
  return typeof room.number === 'string' && room.number.trim() !== '' ? [typed(room.number)] : [words('a room with no number')];
}

function teacherNames(project, ids) {
  return ids.map((id) => {
    const teacher = findById(project.teachers, id);
    return teacher ? teacher.name : null;
  }).filter((name) => name !== null);
}

// [{text, name}] for "Ms. A and Mr. B", or "no teacher".
function teacherParts(project, ids) {
  const names = teacherNames(project, ids);
  if (names.length === 0) return [words('no teacher')];
  const parts = [];
  names.forEach((name, i) => {
    if (i > 0) parts.push(words(i === names.length - 1 ? ' and ' : ', '));
    parts.push(typed(name));
  });
  return parts;
}

function dayParts(project, dayTypeId) {
  // the day type is named only where the school has more than one to tell apart
  if (ownDayTypes(project).length < 2 && project.dayTypes.length < 2) return [];
  const dayType = findDayType(project, dayTypeId);
  return [words(' · '), dayType ? typed(dayType.name) : words('a day type no longer in the project')];
}

function periodParts(project, period) {
  return [words(Number.isInteger(period) && period >= 0 ? periodName(project.settings, period) : '?')];
}

// Who teaches a group in a slot before and after a change, when that differs.
function teacherShift(project, groupId, before, after) {
  const from = slotTeacherIds(project, before);
  const to = slotTeacherIds(project, after);
  if (sameIds(from.slice().sort(), to.slice().sort())) return null;
  return { groupId, from: from.slice(), to: to.slice() };
}

// Chip text for one change, built as parts: "7-1 · Block C: 204 → Library".
// When the move changes who teaches the group, the words say so: ", taught
// by Mr. B instead of Ms. A", ", taught by Mr. B" where nobody taught it, or
// ", no longer taught by Ms. A" where nobody will. `teachers` lists each such shift as
// { groupId, from, to } (teacher ids), empty when nobody changes.
export function changeWords(project, change) {
  const parts = [];
  const teachers = [];
  const shiftParts = (shift, named) => {
    if (!shift) return [];
    const out = [words(', ')];
    if (named) out.push(...groupParts(project, shift.groupId), words(' '));
    if (shift.to.length === 0) out.push(words('no longer taught by '), ...teacherParts(project, shift.from));
    else if (shift.from.length === 0) out.push(words('taught by '), ...teacherParts(project, shift.to));
    else out.push(words('taught by '), ...teacherParts(project, shift.to), words(' instead of '), ...teacherParts(project, shift.from));
    return out;
  };
  if (!change || typeof change !== 'object') return { parts: [words('A change that could not be read')], text: 'A change that could not be read', teachers };

  if (change.kind === 'move') {
    const slot = realSlot(project, change.dayTypeId, change.groupId, change.period);
    const room = findRoom(project, change.roomId);
    parts.push(...groupParts(project, change.groupId), ...dayParts(project, change.dayTypeId), words(' · '), ...periodParts(project, change.period), words(': '));
    parts.push(...slotRoomParts(project, slot), words(' → '), ...roomParts(room));
    if (slot && room) {
      const shift = teacherShift(project, change.groupId, slot, { ...slot, room: room.id, roomText: '' });
      if (shift) {
        teachers.push(shift);
        parts.push(...shiftParts(shift, false));
      }
    }
  } else if (change.kind === 'swapPeriods') {
    const a = realSlot(project, change.dayTypeId, change.groupId, change.periodA);
    const b = realSlot(project, change.dayTypeId, change.groupId, change.periodB);
    parts.push(...groupParts(project, change.groupId), ...dayParts(project, change.dayTypeId), words(' · '), ...periodParts(project, change.periodA), words(' ↔ '), ...periodParts(project, change.periodB), words(': '));
    parts.push(...slotRoomParts(project, a), words(' ↔ '), ...slotRoomParts(project, b));
  } else if (change.kind === 'swapRooms') {
    const a = realSlot(project, change.dayTypeId, change.groupA, change.period);
    const b = realSlot(project, change.dayTypeId, change.groupB, change.period);
    parts.push(...groupParts(project, change.groupA), words(' ↔ '), ...groupParts(project, change.groupB), ...dayParts(project, change.dayTypeId), words(' · '), ...periodParts(project, change.period), words(': '));
    parts.push(...slotRoomParts(project, a), words(' ↔ '), ...slotRoomParts(project, b));
    if (a && b) {
      const placeA = placeOfSlot(project, a);
      const placeB = placeOfSlot(project, b);
      for (const shift of [teacherShift(project, change.groupA, a, { ...a, ...placeB }), teacherShift(project, change.groupB, b, { ...b, ...placeA })]) {
        if (!shift) continue;
        teachers.push(shift);
        parts.push(...shiftParts(shift, true));
      }
    }
  } else {
    parts.push(words('A change of a kind this version does not know'));
  }
  return { parts, text: joinParts(parts), teachers };
}

// ---------------------------------------------------------------- reconcile

// Why a change no longer applies to this project, as parts to follow the
// chip's words, or null when it still applies.
function whyDropped(project, change) {
  const dayType = findDayType(project, change.dayTypeId);
  if (!dayType) return [words('its day type is no longer in the project.')];
  if (!isOwnCopy(project, change.dayTypeId)) {
    return [typed(dayType.name), words(' is the same as '), typed(baseDayType(project).name), words(' again, so it has no schedule of its own to change.')];
  }
  const slots = changeSlots(change);
  if (slots.some((slot) => !findById(project.groups, slot.groupId))) {
    return [words(slots.length > 1 && change.kind === 'swapRooms' ? 'one of its groups is no longer in the project.' : 'its group is no longer in the project.')];
  }
  const periods = project.settings.periods;
  const outside = slots.map((slot) => slot.period).filter((period) => !(Number.isInteger(period) && period >= 0 && period < periods));
  if (outside.length > 0) {
    const name = Number.isInteger(outside[0]) && outside[0] >= 0 ? periodName(project.settings, outside[0]) : 'its period';
    return [words(name + ' is no longer in the school day, which has ' + periods + '.')];
  }
  if (change.kind === 'move' && !findRoom(project, change.roomId)) return [words('the room it moves to is no longer in the building.')];
  if (isNoChange(project, change)) return [words('the schedule already has this.')];
  return null;
}

// Which changes no longer apply to the project as it is, and why. Pure: the
// scenario is not changed. `changes` are the ones that still apply, in their
// order, and are what applyScenario should be given; `dropped` are the
// others, each with a sentence. A change a later one on the same slot
// replaces is dropped too, so `changes` never share a slot.
export function reconcile(project, scenario) {
  const list = changesOf(scenario);
  const replaced = new Set();
  const owner = new Map();
  list.forEach((change, index) => {
    for (const slot of changeSlots(change)) {
      const key = slotKey(slot);
      if (owner.has(key)) replaced.add(owner.get(key));
    }
    for (const slot of changeSlots(change)) owner.set(slotKey(slot), index);
  });
  const changes = [];
  const dropped = [];
  list.forEach((change, index) => {
    let why = null;
    if (!change || typeof change !== 'object' || !changeSlots(change).length) why = [words('it is not a change this version can read.')];
    else if (replaced.has(index)) why = [words('a later change to the same ' + String(project.settings.periodWord).toLowerCase() + ' replaces it.')];
    else why = whyDropped(project, change);
    if (why === null) {
      changes.push(change);
      return;
    }
    const readable = change && typeof change === 'object' && changeSlots(change).length > 0;
    const parts = readable ? changeWords(project, change).parts.concat([words(': ')], why) : [words('A change could not be read: ')].concat(why);
    dropped.push({ change, parts, sentence: joinParts(parts) });
  });
  return { changes, dropped };
}

// ---------------------------------------------------------------- compare

function sideOf(figureBefore, figureAfter) {
  return { before: figureBefore, after: figureAfter, difference: figureAfter - figureBefore };
}

function wantedDays(result, dayTypeId) {
  const days = result && result.crowd && Array.isArray(result.crowd.days) ? result.crowd.days : [];
  return dayTypeId === null ? days : days.filter((day) => day.dayTypeId === dayTypeId);
}

function wantedLoads(result, dayTypeId) {
  const list = result && Array.isArray(result.loads) ? result.loads.filter(Boolean) : [];
  return dayTypeId === null ? list : list.filter((load) => load.dayTypeId === dayTypeId);
}

// Walking, crowding and lateness from the crowd model, per group and in all.
// `walking` is the crowd model's own (ARCHITECTURE 6.3 rule 8), never a
// route's seconds; late is isLate against the transition's passing time and
// margin, and a group stopped before it arrived is late.
function walkFigures(result, dayTypeId) {
  const groups = new Map();
  const all = { walking: 0, waiting: 0, total: 0, late: 0, walks: 0 };
  for (const day of wantedDays(result, dayTypeId)) {
    for (const transition of day.transitions) {
      if (!transition) continue;
      for (const walk of transition.groups) {
        const late = !walk.arrived || isLate(walk.total, transition.passingSeconds, transition.marginSeconds);
        if (!groups.has(walk.groupId)) groups.set(walk.groupId, { walking: 0, waiting: 0, total: 0, late: 0, walks: 0 });
        for (const into of [groups.get(walk.groupId), all]) {
          into.walking += walk.walking;
          into.waiting += walk.waiting;
          into.total += walk.total;
          into.late += late ? 1 : 0;
          into.walks += 1;
        }
      }
    }
  }
  return { groups, all };
}

function failedRoutes(result, dayTypeId) {
  const days = result && result.routes && Array.isArray(result.routes.days) ? result.routes.days : [];
  let failed = 0;
  for (const day of days) {
    if (dayTypeId !== null && day.dayTypeId !== dayTypeId) continue;
    for (const group of day.groups) for (const found of group.routes) if (found && found.ok === false && found.reason !== 'no-room') failed += 1;
  }
  return failed;
}

// The busiest place: the highest load in any one transition of a cell or a
// connection outside the exclusion zones, the cells first and then the
// connections, lower index first on a tie. Null when nothing is crossed.
function busiestOf(result, dayTypeId) {
  let best = null;
  for (const load of wantedLoads(result, dayTypeId)) {
    const consider = (source, shut, isLink) => {
      for (let i = 0; i < source.busiest.length; i += 1) {
        if (shut[i] || source.busiest[i] === 0) continue;
        if (best !== null && source.busiest[i] <= best.load) continue;
        best = { load: source.busiest[i], unit: load.unit, dayTypeId: load.dayTypeId, period: source.peak[i] === -1 ? null : source.peak[i], node: isLink ? null : i, link: isLink ? i : null };
      }
    };
    consider(load.cells, load.excluded, false);
    consider(load.connections, load.excludedConnections, true);
  }
  if (best === null) return null;
  const cut = result.places;
  const index = cut ? (best.link === null ? cut.placeOfNode[best.node] : cut.placeOfLink[best.link]) : -1;
  const place = cut && index >= 0 ? cut.places[index] : null;
  return { ...best, placeId: place ? place.id : null, name: place ? place.name : '', parts: place ? place.parts : [] };
}

function findingsOf(result) {
  return result && result.findings && Array.isArray(result.findings.findings) ? result.findings.findings : [];
}

// A place's load on one day: the highest of its members outside the zones,
// in the one transition asked for, or in its busiest transition.
function placeLoad(load, place, transition, measure) {
  const isLink = place.kind === 'connection';
  const members = isLink ? [place.link] : place.nodes;
  const source = isLink ? load.connections : load.cells;
  const shut = isLink ? load.excludedConnections : load.excluded;
  const values = transition === null ? (measure === 'total' ? source.total : source.busiest) : source.byTransition[transition];
  let best = 0;
  let open = 0;
  for (const member of members) {
    if (shut[member]) continue;
    open += 1;
    if (values && values[member] > best) best = values[member];
  }
  return open === 0 ? null : best;
}

function sameGeometry(before, after) {
  const a = before && before.places ? before.places.places : null;
  const b = after && after.places ? after.places.places : null;
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((place, i) => place.id === b[i].id);
}

// Every figure of spec 9.2 for two results of createPipeline().run() (or the
// same shape), `before` for the real schedule and `after` for the schedule
// with the scenario applied. Both are of one building, so their places and
// load arrays line up; a pair that does not is refused with a TypeError.
//
// options:
//   dayTypeId   one own day type, or null (the default) for all of them
//   transition  for the places: one transition (the period walked out of),
//               or null for the whole day
//   measure     for the places over the whole day: 'busiest' (the default)
//               or 'total'
//   floorIds    the floors shown: the places are ranked among those with an
//               end on one of them; null (the default) ranks the building
//   changes     the scenario's changes (or the scenario), to mark the edited groups
//   limit       how many places busier and how many quieter (default 10)
//
// The answer:
//   { dayTypeId,
//     figures: {
//       walking:  { before, after, difference }   seconds, the crowd model's walking
//       crowding: { before, after, difference }   seconds lost waiting in the crowd
//       busiest:  { before, after, difference }   before and after are
//                 { load, unit, dayTypeId, period, placeId, name, parts } or null;
//                 difference is after's load less before's
//       late:     { before, after, difference }   walks that arrive late
//       failed:   { before, after, difference }   walks with no way through
//                 (a slot with no room is not one)
//       findings: { problem, warning, note }, each { before, after, difference }
//     },
//     groups: [{ groupId, edited, before, after, difference }]
//       before and after are { walking, waiting, total, late, walks } or null
//       for a group with no walk on that side; difference is the change in
//       total travel time, null when a side is null. Biggest change first
//       (by size), then the edited groups, then by id; nulls last.
//     places: { covers: 'building' | 'floors', busier, quieter, elsewhere }
//       busier and quieter are [{ place, placeId, name, parts, dayTypeId,
//       before, after, difference }], biggest change first, then the order
//       of the places; `elsewhere` is how many places that change have no
//       end on a floor shown (0 when the ranking covers the building)
//     findings: { new, resolved, unchanged }
//       findings that count (not accepted), told apart by id: new and
//       unchanged are after's, resolved are before's. }
export function compareResults(before, after, options) {
  const opts = options || {};
  const dayTypeId = opts.dayTypeId === undefined ? null : opts.dayTypeId;
  const transition = Number.isInteger(opts.transition) ? opts.transition : null;
  const measure = opts.measure === 'total' ? 'total' : 'busiest';
  const limit = Number.isInteger(opts.limit) && opts.limit >= 0 ? opts.limit : 10;
  const floorIds = Array.isArray(opts.floorIds) ? new Set(opts.floorIds) : null;
  if (!sameGeometry(before, after)) throw new TypeError('compareResults needs two results for one building.');

  // ---- figures
  const walksBefore = walkFigures(before, dayTypeId);
  const walksAfter = walkFigures(after, dayTypeId);
  const busyBefore = busiestOf(before, dayTypeId);
  const busyAfter = busiestOf(after, dayTypeId);
  const findingsBefore = findingsOf(before).filter((finding) => dayTypeId === null || finding.where.dayTypeId === null || finding.where.dayTypeId === dayTypeId);
  const findingsAfter = findingsOf(after).filter((finding) => dayTypeId === null || finding.where.dayTypeId === null || finding.where.dayTypeId === dayTypeId);
  const countsBefore = countBySeverity(findingsBefore);
  const countsAfter = countBySeverity(findingsAfter);
  const bySeverity = {};
  for (const severity of SEVERITIES) bySeverity[severity] = sideOf(countsBefore[severity], countsAfter[severity]);
  const figures = {
    walking: sideOf(walksBefore.all.walking, walksAfter.all.walking),
    crowding: sideOf(walksBefore.all.waiting, walksAfter.all.waiting),
    busiest: { before: busyBefore, after: busyAfter, difference: (busyAfter ? busyAfter.load : 0) - (busyBefore ? busyBefore.load : 0) },
    late: sideOf(walksBefore.all.late, walksAfter.all.late),
    failed: sideOf(failedRoutes(before, dayTypeId), failedRoutes(after, dayTypeId)),
    findings: bySeverity,
  };

  // ---- groups
  const edited = new Set(editedGroupIds(opts.changes || []));
  const groupIds = Array.from(new Set([...walksBefore.groups.keys(), ...walksAfter.groups.keys()]));
  const groups = groupIds.map((groupId) => {
    const was = walksBefore.groups.get(groupId) || null;
    const now = walksAfter.groups.get(groupId) || null;
    return { groupId, edited: edited.has(groupId), before: was, after: now, difference: was && now ? now.total - was.total : null };
  });
  groups.sort((a, b) => {
    if ((a.difference === null) !== (b.difference === null)) return a.difference === null ? 1 : -1;
    const size = Math.abs(b.difference || 0) - Math.abs(a.difference || 0);
    if (size !== 0) return size;
    if (a.edited !== b.edited) return a.edited ? -1 : 1;
    return a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0;
  });

  // ---- places
  const busier = [];
  const quieter = [];
  let elsewhere = 0;
  const cut = after && after.places ? after.places.places : [];
  const loadsBefore = new Map(wantedLoads(before, dayTypeId).map((load) => [load.dayTypeId, load]));
  const loadsAfter = wantedLoads(after, dayTypeId);
  cut.forEach((place, order) => {
    let best = null;
    for (const load of loadsAfter) {
      const was = loadsBefore.get(load.dayTypeId);
      if (!was || (transition !== null && !(transition < load.transitions))) continue;
      const a = placeLoad(was, place, transition, measure);
      const b = placeLoad(load, place, transition, measure);
      if (a === null || b === null || a === b) continue;
      if (best === null || Math.abs(b - a) > Math.abs(best.difference)) best = { dayTypeId: load.dayTypeId, before: a, after: b, difference: b - a };
    }
    if (best === null) return;
    const ends = place.floorIds || [place.floorId];
    if (floorIds !== null && !ends.some((id) => floorIds.has(id))) {
      elsewhere += 1;
      return;
    }
    const row = { place, placeId: place.id, name: place.name, parts: place.parts, order, ...best };
    (row.difference > 0 ? busier : quieter).push(row);
  });
  const rank = (a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.order - b.order;
  const trim = (rows) => rows.sort(rank).slice(0, limit).map(({ order, ...row }) => row);

  // ---- findings
  const idsBefore = new Set(findingsBefore.map((finding) => finding.id));
  const idsAfter = new Set(findingsAfter.map((finding) => finding.id));

  return {
    dayTypeId,
    figures,
    groups,
    places: { covers: floorIds === null ? 'building' : 'floors', busier: trim(busier), quieter: trim(quieter), elsewhere },
    findings: {
      new: findingsAfter.filter((finding) => !idsBefore.has(finding.id)),
      resolved: findingsBefore.filter((finding) => !idsAfter.has(finding.id)),
      unchanged: findingsAfter.filter((finding) => idsBefore.has(finding.id)),
    },
  };
}

// The difference map's numbers for two loads() results of one day type on
// one building: after less before, per graph node (cells) and per index into
// graph.links (connections), as Int32Arrays.
//
// options.transition picks one transition's loads (the period walked out
// of); null or left out is the whole day, by options.measure: 'busiest' (the
// default, each cell's highest load in any one transition) or 'total'.
//
//   { cells, connections,    Int32Array deltas
//     largest,               the largest |delta| outside the exclusion zones, 0 when nothing changes
//     excluded, excludedConnections }   after's zone flags, for the painter to leave alone
export function loadDifference(before, after, options) {
  const opts = options || {};
  const transition = Number.isInteger(opts.transition) ? opts.transition : null;
  const measure = opts.measure === 'total' ? 'total' : 'busiest';
  if (!before || !after) throw new TypeError('loadDifference needs two loads() results.');
  if (before.cells.busiest.length !== after.cells.busiest.length || before.connections.busiest.length !== after.connections.busiest.length) {
    throw new TypeError('loadDifference needs two loads() results for one building.');
  }
  const pick = (load, part) => {
    if (transition === null) return measure === 'total' ? load[part].total : load[part].busiest;
    const found = load[part].byTransition[transition];
    return found || new Int32Array(load[part].busiest.length);
  };
  let largest = 0;
  const delta = (part, shut) => {
    const a = pick(before, part);
    const b = pick(after, part);
    const out = new Int32Array(b.length);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = b[i] - a[i];
      if (!shut[i] && Math.abs(out[i]) > largest) largest = Math.abs(out[i]);
    }
    return out;
  };
  const cells = delta('cells', after.excluded);
  const connections = delta('connections', after.excludedConnections);
  return { cells, connections, largest, excluded: after.excluded, excludedConnections: after.excludedConnections };
}

// ---------------------------------------------------------------- compare with a file

// Room numbers are matched without regard to case or spaces: NFKC, lower
// case, every space removed. An unnumbered room has no key and is matched
// by nothing.
function looseRoomKey(number) {
  return roomNumberKey(String(number).normalize('NFKC')).replace(/\s+/g, '');
}

function roomKeys(project) {
  const keys = new Map();
  for (const room of allRooms(project)) {
    const key = looseRoomKey(room.number);
    if (key === '') continue;
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(room);
  }
  return keys;
}

// "Compare with another project file": `projectA` is the project as it is,
// `projectB` the other file (this year against next year's proposal). Rooms
// are matched by number, groups by name (case-insensitive) and day types by
// name. Every slot of a matched group on a matched day type whose room
// differs becomes a move to A's room of that number.
//
// Refused with an ActionError (code 'different-building') when the two sets
// of room numbers differ, saying how many rooms differ.
//
// options: { fileName, name }. Returns
//   { scenario: { name, changes, compared: { fileName, addedGroups, removedGroups } },
//     skipped: [{ groupName, dayTypeName, period, sentence }] }
// where addedGroups are the names only in B, removedGroups those only in A,
// and `skipped` the differing slots a move cannot say: B has no room there,
// or a room not in the building, or a room with no number; or the day type
// is "the same as" in A, so it has no schedule of its own to change.
export function scenarioFromDiff(projectA, projectB, options) {
  const opts = options || {};
  const fileName = typeof opts.fileName === 'string' ? opts.fileName : '';
  const keysA = roomKeys(projectA);
  const keysB = roomKeys(projectB);
  let differ = 0;
  for (const [key, rooms] of keysA) differ += Math.abs(rooms.length - (keysB.get(key) || []).length);
  for (const [key, rooms] of keysB) if (!keysA.has(key)) differ += rooms.length;
  if (differ > 0) {
    throw new ActionError('This file describes a different building: ' + differ + (differ === 1 ? ' room differs' : ' rooms differ') + ' by number. Compare a file of the same building.', 'different-building');
  }

  const groupsB = new Map();
  for (const group of projectB.groups) if (!groupsB.has(nameKey(group.name))) groupsB.set(nameKey(group.name), group);
  const namesA = new Set(projectA.groups.map((group) => nameKey(group.name)));
  const addedGroups = projectB.groups.filter((group) => !namesA.has(nameKey(group.name))).map((group) => group.name);
  const removedGroups = projectA.groups.filter((group) => !groupsB.has(nameKey(group.name))).map((group) => group.name);
  const daysB = new Map();
  for (const dayType of projectB.dayTypes) if (!daysB.has(nameKey(dayType.name))) daysB.set(nameKey(dayType.name), dayType);

  const changes = [];
  const skipped = [];
  const periods = Math.min(projectA.settings.periods, projectB.settings.periods);
  for (const dayType of projectA.dayTypes) {
    const other = daysB.get(nameKey(dayType.name));
    if (!other) continue;
    const own = isOwnCopy(projectA, dayType.id);
    // a day type that follows the base in both files has nothing of its own to compare
    if (!own && !isOwnCopy(projectB, other.id)) continue;
    for (const group of projectA.groups) {
      const twin = groupsB.get(nameKey(group.name));
      if (!twin) continue;
      const mine = effectiveSchedule(projectA, group.id, dayType.id);
      const theirs = effectiveSchedule(projectB, twin.id, other.id);
      for (let period = 0; period < periods; period += 1) {
        const a = resolveSlotRoom(projectA, mine[period]);
        const b = resolveSlotRoom(projectB, theirs[period]);
        const keyA = a.room ? looseRoomKey(a.room.number) : null;
        const keyB = b.room ? looseRoomKey(b.room.number) : null;
        if (a.room && b.room && keyA === keyB && keyA !== '') continue;
        if (!a.room && !b.room && roomNumberKey(a.text) === roomNumberKey(b.text)) continue;
        const skip = (why) => skipped.push({ groupName: group.name, dayTypeName: dayType.name, period, sentence: group.name + ' · ' + dayType.name + ' · ' + periodName(projectA.settings, period) + ': ' + why });
        if (!own) {
          skip(dayType.name + ' is the same as ' + baseDayType(projectA).name + ' here, so it has no schedule of its own to change.');
          continue;
        }
        if (!b.room) {
          skip(b.text === '' ? 'the file has no room there.' : 'the file has ' + b.text + ' there, which is not in the building.');
          continue;
        }
        const matched = keyB === '' ? [] : keysA.get(keyB) || [];
        if (matched.length !== 1) {
          skip('the file has a room with no number there, which cannot be matched.');
          continue;
        }
        changes.push({ kind: 'move', dayTypeId: dayType.id, groupId: group.id, period, roomId: matched[0].id });
      }
    }
  }
  const name = typeof opts.name === 'string' ? opts.name : fileName === '' ? 'Compared with another file' : 'Compared with ' + fileName;
  return { scenario: { name, changes, compared: { fileName, addedGroups, removedGroups } }, skipped };
}
