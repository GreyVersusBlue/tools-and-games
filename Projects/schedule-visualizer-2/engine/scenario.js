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
//     matter. The change being added is removed too when it leaves its slots
//     as the real schedule has them: "move 7C to 204 and back" leaves
//     nothing. An older change is never removed for that: the schedule may
//     have caught up with it only for now, and reconcile (a view) leaves it
//     out of what applies until the schedule moves on again.
//   - reconcile is a view, never a write. It says which changes no longer
//     apply to the project as it is and why, in a sentence, and hands back
//     the rest. The scenario keeps every change: undoing the deletion that
//     dropped one brings it back.
//   - A move changes the room and nothing else of the slot. A slot that
//     names no teacher is taught by its room's teachers (teacher-day.js
//     slotTeacherIds), so moving it can change who teaches; changeWords says
//     so whenever it does. A swap of periods moves whole slots, teachers and
//     labels with them. A swap of rooms trades the room (or the number a slot
//     kept for a room not in the building) and nothing else.
//
// Wherever a function takes `changes`, it takes a list of changes or a
// scenario ({ changes }); null is no change at all.
//
// What this module gives:
//
//   applyChanges(project, changes?)
//       the project with exactly these changes applied, as pure data; left
//       out, project.scenario's changes. Throws the ActionError setSlot or
//       moveSlot gave for a change that cannot be applied, and changes
//       nothing then. project.scenario is left as it was. (applyScenario,
//       the undoable action that applies and clears the scenario, is
//       SV2-61's, in actions.js.)
//   changeSlots(change)
//       [{ dayTypeId, groupId, period }], the slots a change touches
//   editedGroupIds(changes)
//       [groupId], the groups the changes name, each once, in order
//   normalise(project, changes, { added }?)
//       the changes, one per slot, and the added one gone when it changes
//       nothing; `added` is the index of the change just added (default the
//       last), or null to remove no change for changing nothing (a file)
//   reconcile(project, changes)
//       { changes, dropped: [{ change, parts, sentence }] }
//   changeWords(project, change)
//       { parts, text, teachers: [{ groupId, from, to }] } for a chip
//   leverRouteOptions(project, levers)
//       { ways, shutLinks, shutCells }: the building's levers as routing.js
//       takes them (ways, avoidConnections, shutCells); leverOptionsKey of
//       that is '' for none, and what the page compares to move the lane's
//       `levers` counter
//   trialOnlyWords(project, levers)
//       { parts, text } for what Apply leaves out ("Closing Stairs B and
//       North Corridor is a trial: Apply leaves the building as it is."), or null
//   trimResult(result)
//       { places, loads, bellLoads?, walks, findings, failedWalks }: what
//       compareResults reads of a pipeline result, and nothing else
//   compareResults(before, after, options?)
//       every figure of spec 9.2 (the shape is at the function)
//   loadDifference(before, after, options?)
//       { cells, connections, largest, excluded, excludedConnections }
//   scenarioFromDiff(projectA, projectB, options?)
//       { scenario, skipped }, "compare with another project file"
//
// `parts` are [{ text, name }], name true for a piece a user typed, as in
// places.js and directions.js, so a screen can isolate typed text.
//
// What compareResults and loadDifference read. The scenario lane (SV2-64)
// sends a trimmed result, so this is the whole list; nothing else of a
// pipeline result is read, and `crowd` and `routes` are never read:
//
//   compareResults, of each result (or of trimResult's answer for it):
//     places.places[]    id, name, parts, kind, link, nodes, floorId, floorIds
//     places.placeOfNode, places.placeOfLink
//     loads[]            dayTypeId, unit, transitions, excluded,
//                        excludedConnections, and of cells and of
//                        connections: busiest, peak, total, byTransition
//     walks.groups[]     dayTypeId, groupId, walking, waiting, total, late
//                        (with the school's margin), arrived
//     bellLoads[], walks.bells.groups[]   the same for the bell-schedule
//                        runs, each with its bellsId, when one is asked about
//     findings.findings[]  whole: id, severity and where.dayTypeId are read,
//                        and the findings are handed back as they are
//     failedWalks[]      dayTypeId, groupId, and bellsId for a bell-schedule
//                        run's: the walks with no way through.
//                        A pipeline result has no such field: trimResult
//                        builds it from `routes`, and compareResults calls
//                        trimResult on a result that does not carry it. It
//                        cannot come from `walks`: crowd.js leaves a walk
//                        with no route out of the crowd model, so it is not
//                        in walks.groups at all (`arrived` false is a walk
//                        stopped in the crowd, which is late, not failed).
//   loadDifference, of two loads() results (one entry of result.loads each):
//     dayTypeId, excluded, excludedConnections, and of cells and of
//     connections: busiest, total, byTransition
//
// engine/actions.js will import this module (SV2-61's applyScenario action
// composes applyChanges), and this module imports actions.js. The cycle is
// safe because neither module uses the other's bindings while it is being
// evaluated: setSlot, moveSlot and ActionError are only read inside this
// module's function bodies, never at its top level. Keep it so: no top-level
// `class extends ActionError`, no constant built from an actions.js export.

import { findRoom, findById, resolveSlotRoom, nameKey, roomNumberKey, allRooms, bellSchedulesOf, releaseOf, isBellTime, inRange, RANGES, RELEASE_SECONDS, CELL_CORRIDOR, ELEVATOR_KIND } from './schema.js';
import { findDayType, isOwnCopy, ownDayTypes, effectiveSchedule, describeDayType } from './day-types.js';
import { periodName, formatTime } from './bells.js';
import { slotTeacherIds } from './teacher-day.js';
import { countBySeverity, SEVERITIES, countWord, listWords, periodWord, formatDuration } from './findings.js';
import { releaseDelay, releaseKind } from './release.js';
import { setSlot, moveSlot, setBell, setBellSchedule, setRoomFields, editGroup, ActionError } from './actions.js';

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

// The project with exactly the changes given applied, each to its own day
// type, in order; left out, project.scenario's changes. A change that cannot
// be applied throws, and nothing is half done: the project handed in is
// never changed. Apply what reconcile kept to skip the changes that no
// longer apply.
export function applyChanges(project, changes) {
  const list = changesOf(changes === undefined ? project.scenario : changes);
  let next = project;
  for (const change of list) next = applyOne(next, change);
  return next;
}

// ---------------------------------------------------------------- normalise

// One change per slot, the later replacing the earlier whole. Of the
// changes that leave the schedule as it is, only the one being added goes:
// options.added is its index (default the last change), or null when no
// change is being added (a list read from a file). An older change the
// schedule has caught up with stays, so undoing the schedule edit that
// caught up with it brings it back; reconcile leaves it out of what applies
// meanwhile. Returns the list it was given when nothing was removed.
export function normalise(project, changes, options) {
  const list = changesOf(changes);
  const opts = options || {};
  const added = opts.added === undefined ? list.length - 1 : opts.added;
  if (added !== null && !Number.isInteger(added)) throw new TypeError('normalise: options.added is an index into the changes, or null.');
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
  if (added !== null && added >= 0 && added < list.length && keep[added] && isNoChange(project, list[added])) keep[added] = false;
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
  if (LEVER_KINDS.includes(change.kind)) return isReadableLever(change) ? leverWords(project, change) : { parts: [words('A lever that could not be read')], text: 'A lever that could not be read', teachers };

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

// Why a change cannot apply to this project whatever the other changes are,
// as parts to follow the chip's words, or null when nothing it names is gone.
// The most basic reason first: the day type, its own schedule, the groups,
// the periods, the room.
function whyGone(project, change) {
  const dayType = findDayType(project, change.dayTypeId);
  if (!dayType) return [words('its day type is no longer in the project.')];
  if (!isOwnCopy(project, change.dayTypeId)) {
    return [typed(dayType.name), words(' is the same as '), typed(describeDayType(project, dayType.id).follows), words(' again, so it has no schedule of its own to change.')];
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
  return null;
}

function isReadable(change) {
  return Boolean(change) && typeof change === 'object' && changeSlots(change).length > 0;
}

// Which changes no longer apply to the project as it is, and why. Pure: the
// scenario is not changed. `changes` are the ones that still apply, in their
// order, and are what applyChanges should be given; `dropped` are the
// others, each { change, parts, sentence }. A change is dropped for the
// first of these that holds:
//
//   1. it cannot be read, or something it names is gone (whyGone: a day
//      type gone, a day type "the same as" again, a group gone, a period
//      gone, the room a move goes to gone);
//   2. a later change on one of its slots replaces it. Only a later change
//      that is not dropped for a reason of (1) replaces anything: the user's
//      later word on a slot stands while it can apply, and when it cannot,
//      the earlier change applies again. A later change the schedule
//      already has (3) still replaces: the slot is as the user last asked;
//   3. the schedule already has it.
//
// So `changes` never share a slot.
export function reconcile(project, scenario) {
  const list = changesOf(scenario);
  const gone = list.map((change) => (isReadable(change) ? whyGone(project, change) : [words('it is not a change this version can read.')]));
  // from the last change back: the slots a later change that is not gone touches
  const replaced = new Array(list.length).fill(false);
  const later = new Set();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (gone[index] !== null) continue;
    const keys = changeSlots(list[index]).map(slotKey);
    replaced[index] = keys.some((key) => later.has(key));
    for (const key of keys) later.add(key);
  }
  const changes = [];
  const dropped = [];
  list.forEach((change, index) => {
    let why = gone[index];
    if (why === null && replaced[index]) why = [words('a later change to the same ' + String(project.settings.periodWord).toLowerCase() + ' replaces it.')];
    if (why === null && isNoChange(project, change)) why = [words('the schedule already has this.')];
    if (why === null) {
      changes.push(change);
      return;
    }
    const parts = isReadable(change) ?changeWords(project, change).parts.concat([words(': ')], why) : [words('A change could not be read: ')].concat(why);
    dropped.push({ change, parts, sentence: joinParts(parts) });
  });
  const result = { changes, dropped };
  // the levers are reconciled only for a scenario that carries them, so a
  // list of changes, or a scenario with none, answers exactly as before
  if (scenario && !Array.isArray(scenario) && Array.isArray(scenario.levers)) {
    const levers = reconcileLevers(project, scenario);
    result.levers = levers.levers;
    result.droppedLevers = levers.dropped;
  }
  return result;
}

// ---------------------------------------------------------------- several scenarios
//
// project.scenario is the open scenario (or null); project.scenarios the kept
// ones, absent = [] (ARCHITECTURE 21.2). The constants are here and not in
// schema.js, which the staff browser loads.

// the open scenario and the kept ones together: the most a project holds
export const SCENARIOS_MOST = 12;
// the most characters of a project's label, after trimming
export const PROJECT_LABEL_MOST = 60;

// The kept scenarios as a list; absent, or not a list, reads as none.
export function keptScenarios(project) {
  return project && Array.isArray(project.scenarios) ? project.scenarios : [];
}

// `fn` applied to the open scenario (when there is one) and to each kept
// scenario, in that order; fn(scenario) returns the scenario itself when it
// changes nothing (undefined reads so too), a new object when it does, and
// null to remove a kept one
// (the open one cannot be removed this way: null leaves it as it was). The
// same project comes back when nothing changed, so an action that finds
// nothing to do makes no history entry. A project with no `scenarios` list
// gets none.
export function mapScenarios(project, fn) {
  let next = project;
  const open = project.scenario;
  if (open && typeof open === 'object') {
    const result = fn(open);
    if (result && result !== open) next = { ...next, scenario: result };
  }
  if (Array.isArray(project.scenarios)) {
    let changed = false;
    const kept = [];
    for (const scenario of project.scenarios) {
      const answer = scenario && typeof scenario === 'object' ? fn(scenario) : scenario;
      // undefined (a callback that forgot to return) is "unchanged"; only null removes
      const result = answer === undefined ? scenario : answer;
      if (result !== scenario) changed = true;
      if (result !== null) kept.push(result);
    }
    if (changed) next = { ...next, scenarios: kept };
  }
  return next;
}

// The project as `scenario` would make it: the changes that still apply
// (reconcile), then its levers that do (bells, leaving late, seats and head
// counts). The building's own levers are route options, not an edit
// (leverRouteOptions). The same function the scenario lane runs for the open
// scenario, so a kept scenario and the open one are run alike. The project
// handed in is not changed. Pure.
export function scenarioProject(project, scenario) {
  return scenarioInputs(project, scenario).project;
}

// What the scenario lane runs for `scenario`: { project, routeOptions }, the
// project with the scenario's reconciled changes and levers applied, and the
// route options of those levers (leverRouteOptions: a stair one way or
// closed, closed corridor cells), which the building itself never takes.
// scenarioProject is its `project`. Pure; the project handed in is not changed.
export function scenarioInputs(project, scenario) {
  const kept = reconcile(project, scenario);
  const levers = kept.levers || [];
  return { project: applyLevers(applyChanges(project, kept.changes), levers), routeOptions: leverRouteOptions(project, levers) };
}

// ---------------------------------------------------------------- levers
//
// The scenario's second list (ARCHITECTURE 18.3): scenario.levers, absent =
// []. A lever is not a Change (CHANGE_KINDS does not move: an older copy of
// the tool strips an unknown change kind and refuses a file that holds one).
// The building's two kinds (way and corridor) never change the building in
// the scenario's copy: applyLevers leaves them out, and leverRouteOptions
// turns them into route options for routing.js (18.3).
//
//   { kind: 'release',  who, seconds, after, dayTypeIds }    18.2's entry, no id
//   { kind: 'bell',     dayTypeId | bellsId, period, start, end }
//   { kind: 'capacity', roomId, capacity: null | 1..999 }
//   { kind: 'headCount', groupId, headCount: null | 1..999 }
//   { kind: 'way',      connectionId, way: 'both' | 'ab' | 'ba' | 'closed' }
//   { kind: 'corridor', floorId, cells: [index, …], name }   closed
//
// Wherever a function takes `levers`, it takes a list of levers or a
// scenario ({ levers }); null is none at all.

export const LEVER_KINDS = ['release', 'bell', 'way', 'corridor', 'capacity', 'headCount'];
export const SCHEDULE_LEVER_KINDS = ['release', 'bell', 'capacity', 'headCount'];
const WAYS = ['both', 'ab', 'ba', 'closed'];

function leversOf(scenario) {
  if (Array.isArray(scenario)) return scenario;
  return scenario && Array.isArray(scenario.levers) ? scenario.levers : [];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value !== '';
}

function wholeFrom(value, low) {
  return Number.isInteger(value) && value >= low;
}

// Does the lever have every field its kind needs, with a value of the right
// kind? Whether what it names still exists is for reconcile.
export function isReadableLever(lever) {
  if (!isObject(lever) || !LEVER_KINDS.includes(lever.kind)) return false;
  if (lever.kind === 'release') {
    const kind = releaseKind(lever.who);
    if (kind === null) return false;
    if (kind === 'groups') {
      if (!Array.isArray(lever.who.groups) || lever.who.groups.length === 0 || !lever.who.groups.every(isText)) return false;
    } else if (typeof lever.who[kind] !== 'string' || lever.who[kind].trim() === '') {
      return false;
    }
    const low = kind === 'groups' ? 0 : RELEASE_SECONDS[0];
    if (!Number.isInteger(lever.seconds) || lever.seconds < low || lever.seconds > RELEASE_SECONDS[1]) return false;
    if (lever.after !== null && !(Array.isArray(lever.after) && lever.after.length > 0 && lever.after.every((period) => wholeFrom(period, 0)))) return false;
    return lever.dayTypeIds === null || (Array.isArray(lever.dayTypeIds) && lever.dayTypeIds.length > 0 && lever.dayTypeIds.every(isText));
  }
  if (lever.kind === 'bell') {
    const one = (isText(lever.dayTypeId) ? 1 : 0) + (isText(lever.bellsId) ? 1 : 0);
    const clean = (lever.dayTypeId === undefined || lever.dayTypeId === null || isText(lever.dayTypeId)) && (lever.bellsId === undefined || lever.bellsId === null || isText(lever.bellsId));
    return one === 1 && clean && wholeFrom(lever.period, 0) && isBellTime(lever.start) && isBellTime(lever.end);
  }
  if (lever.kind === 'capacity') return isText(lever.roomId) && (lever.capacity === null || (Number.isInteger(lever.capacity) && inRange(lever.capacity, RANGES.capacity)));
  if (lever.kind === 'headCount') return isText(lever.groupId) && (lever.headCount === null || (Number.isInteger(lever.headCount) && inRange(lever.headCount, RANGES.headCount)));
  if (lever.kind === 'way') return isText(lever.connectionId) && WAYS.includes(lever.way);
  return isText(lever.floorId) && Array.isArray(lever.cells) && lever.cells.length > 0 && lever.cells.every((cell) => wholeFrom(cell, 0)) && typeof lever.name === 'string';
}

function listKey(list) {
  return list === null ? '*' : list.slice().sort().join(',');
}

function releaseWhoKey(who) {
  const kind = releaseKind(who);
  if (kind === 'groups') return 'groups:' + listKey(who.groups);
  return kind === null ? '?' : kind + ':' + nameKey(String(who[kind]));
}

// What a lever is keyed by: one lever per key, a later one replacing an
// earlier. Release by who, periods and day types together; bell by set and
// period; way by connection; corridor by floor and cells; capacity by room;
// head count by group. Null for a lever that cannot be read.
export function leverKey(lever) {
  if (!isReadableLever(lever)) return null;
  const sep = '\u0000';
  if (lever.kind === 'release') {
    const periods = lever.after === null ? '*' : Array.from(new Set(lever.after)).sort((a, b) => a - b).join(',');
    return ['release', releaseWhoKey(lever.who), periods, listKey(lever.dayTypeIds)].join(sep);
  }
  if (lever.kind === 'bell') return ['bell', isText(lever.bellsId) ? 'b:' + lever.bellsId : 'd:' + lever.dayTypeId, lever.period].join(sep);
  if (lever.kind === 'way') return ['way', lever.connectionId].join(sep);
  if (lever.kind === 'corridor') return ['corridor', lever.floorId, Array.from(new Set(lever.cells)).sort((a, b) => a - b).join(',')].join(sep);
  if (lever.kind === 'capacity') return ['capacity', lever.roomId].join(sep);
  return ['headCount', lever.groupId].join(sep);
}

// The groups the levers name outright: a head-count lever's group and a
// release lever's groups. (A release lever for a grade or a wing reaches
// groups only the project knows; compareResults reads those off the walks.)
export function leverGroupIds(levers) {
  const ids = [];
  const add = (id) => {
    if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
  };
  for (const lever of leversOf(levers)) {
    if (!isObject(lever)) continue;
    if (lever.kind === 'headCount') add(lever.groupId);
    if (lever.kind === 'release' && isObject(lever.who) && Array.isArray(lever.who.groups)) lever.who.groups.forEach(add);
  }
  return ids;
}

// ---- apply

function sameEntryKey(entry, lever) {
  return leverKey({ kind: 'release', who: entry.who, seconds: lever.seconds, after: entry.after === undefined ? null : entry.after, dayTypeIds: entry.dayTypeIds === undefined ? null : entry.dayTypeIds }) === leverKey(lever);
}

// The project with these release levers laid over project.release: each
// replaces the real entries of its own key and is one more entry beside the
// rest. `idFor(index)` gives the entry its id: a trial id for a run, a real
// one when Apply writes it.
export function layReleases(project, releases, idFor) {
  if (releases.length === 0) return project;
  const real = releaseOf(project).filter((entry) => !releases.some((lever) => sameEntryKey(entry, lever)));
  return { ...project, release: real.concat(releases.map((lever, index) => ({ id: idFor(index), who: lever.who, seconds: lever.seconds, after: lever.after, dayTypeIds: lever.dayTypeIds }))) };
}

function applyBell(project, lever) {
  const bell = { start: lever.start, end: lever.end };
  if (isText(lever.bellsId)) return setBellSchedule(project, { bellScheduleId: lever.bellsId, period: lever.period, bell });
  return setBell(project, { dayTypeId: lever.dayTypeId, period: lever.period, bell });
}

// The project with exactly these levers applied, as pure data; left out,
// project.scenario's levers. A trial release entry is laid over
// project.release: it beats a real entry of its own key and is otherwise one
// more entry under 18.2's ranking. A bell is set by setBell's and
// setBellSchedule's rules, a capacity by setRoomFields', a head count by
// editGroup's. Throws the ActionError one of them gave for a lever that
// cannot be applied, changing nothing then. The building's levers (way,
// corridor) are not applied here: they travel as route options.
export function applyLevers(project, levers) {
  const list = leversOf(levers === undefined ? project.scenario : levers);
  let next = project;
  const trials = [];
  for (const lever of list) {
    if (!isObject(lever)) continue;
    if (lever.kind === 'release') trials.push(lever);
    else if (lever.kind === 'bell') next = applyBell(next, lever);
    else if (lever.kind === 'capacity') next = setRoomFields(next, { roomId: lever.roomId, capacity: lever.capacity });
    else if (lever.kind === 'headCount') next = editGroup(next, { id: lever.groupId, headCount: lever.headCount });
    else if (lever.kind !== 'way' && lever.kind !== 'corridor') throw new ActionError('A scenario lever is one of release, bell, capacity and headCount, or a way or a corridor in the building.', 'bad-value');
  }
  return layReleases(next, trials, (index) => 'trial' + index);
}

// ---- the building's levers

function connectionOf(project, id) {
  const building = project.building ? project.building : project;
  return (building.connections || []).find((connection) => connection && connection.id === id) || null;
}

function floorOf(project, id) {
  const building = project.building ? project.building : project;
  return building.floors.find((floor) => floor.id === id) || null;
}

// The route options the building's levers mean (ARCHITECTURE 18.3):
//
//   { ways: { [connectionId]: 'both' | 'ab' | 'ba' },
//     shutLinks: [connectionId, …],               a closed stairs connection
//     shutCells: [{ floorId, cell }, …] }          a closed corridor's cells
//
// routing.js takes ways, avoidConnections (= shutLinks) and shutCells. Only
// what changes something is in them: a lever whose connection or floor is not
// in the building, or a way equal to the connection's own direction, is left
// out, and the lists are sorted and without repeats, so options that mean the
// same thing are the same object to JSON. The building itself is not read
// further. Pure.
export function leverRouteOptions(project, levers) {
  const ways = {};
  const shutLinks = new Set();
  const cells = new Map();
  for (const lever of leversOf(levers)) {
    if (!isReadableLever(lever)) continue;
    if (lever.kind === 'way') {
      const connection = connectionOf(project, lever.connectionId);
      // a car runs both ways and is no W4 lever (ARCHITECTURE 19.5): routing
      // never sees a way or a closure on an elevator
      if (!connection || connection.kind === ELEVATOR_KIND) continue;
      if (lever.way === 'closed') shutLinks.add(connection.id);
      else if (lever.way !== connection.direction) ways[connection.id] = lever.way;
    } else if (lever.kind === 'corridor') {
      if (!floorOf(project, lever.floorId)) continue;
      if (!cells.has(lever.floorId)) cells.set(lever.floorId, new Set());
      for (const cell of lever.cells) cells.get(lever.floorId).add(cell);
    }
  }
  // a closed connection needs no way
  for (const id of shutLinks) delete ways[id];
  const sortedWays = {};
  for (const id of Object.keys(ways).sort()) sortedWays[id] = ways[id];
  const building = project.building ? project.building : project;
  const shutCells = [];
  for (const floor of building.floors) {
    if (!cells.has(floor.id)) continue;
    for (const cell of Array.from(cells.get(floor.id)).sort((a, b) => a - b)) shutCells.push({ floorId: floor.id, cell });
  }
  return { ways: sortedWays, shutLinks: Array.from(shutLinks).sort(), shutCells };
}

// A string that is the same for route options that mean the same thing and
// '' for none: what the page compares to know the scenario lane's `levers`
// counter must move (ui/engine-client.js).
export function leverOptionsKey(options) {
  if (!options) return '';
  const ways = Object.keys(options.ways || {}).sort().map((id) => id + '=' + options.ways[id]);
  const links = (options.shutLinks || []).slice().sort();
  const cells = (options.shutCells || []).map((place) => place.floorId + ':' + place.cell).sort();
  if (ways.length === 0 && links.length === 0 && cells.length === 0) return '';
  return ['w', ways.join(','), 'l', links.join(','), 'c', cells.join(',')].join('|');
}

// Does the scenario carry a lever of the building that reaches routing?
export function hasBuildingLevers(project, levers) {
  return leverOptionsKey(leverRouteOptions(project, levers)) !== '';
}

// Is this a lever of the building (a way or a corridor)?
export function isBuildingLever(lever) {
  return isObject(lever) && (lever.kind === 'way' || lever.kind === 'corridor');
}

// Does Apply write this lever into the building? A way of both, ab or ba sets
// the connection's direction; a closed stairs and a closed corridor are
// trials only (ARCHITECTURE 18.3) and Apply leaves them out.
export function isWrittenWay(lever) {
  return isObject(lever) && lever.kind === 'way' && (lever.way === 'both' || lever.way === 'ab' || lever.way === 'ba');
}

export function isTrialOnly(lever) {
  return isObject(lever) && ((lever.kind === 'way' && lever.way === 'closed') || lever.kind === 'corridor');
}

// What Apply leaves out, in a line of its own: "Closing Stairs B and North
// Corridor is a trial: Apply leaves the building as it is." Names as typed.
// { parts, text } for the closed stairs and the closed corridors among the
// levers, in the order given; null when there are none.
export function trialOnlyWords(project, levers) {
  const items = [];
  for (const lever of leversOf(levers)) {
    if (!isReadableLever(lever) || !isTrialOnly(lever)) continue;
    if (lever.kind === 'way') items.push(stairsParts(project, connectionOf(project, lever.connectionId)));
    else {
      const floor = floorOf(project, lever.floorId);
      items.push(lever.name.trim() !== '' ? [typed(lever.name)] : [words(lever.cells.length + (lever.cells.length === 1 ? ' corridor cell' : ' corridor cells') + ' on '), floor ? typed(floor.name) : words('a floor no longer in the building')]);
    }
  }
  if (items.length === 0) return null;
  const parts = [words('Closing '), ...joinedParts(items), words(' is a trial: Apply leaves the building as it is.')];
  return { parts, text: joinParts(parts) };
}

// A connection as a lever says it: "Stairs B". With no label, "Stairs".
function stairsParts(project, connection) {
  return connection ? [words('Stairs '), typed(typeof connection.label === 'string' ? connection.label : '')] : [words('Stairs no longer in the building')];
}

// What a way means for this connection, by the floors it joins: "up only" when
// `ab` goes to the higher floor, "down only" when it goes to the lower one; a
// connection on one floor has "from the A end only" and "from the B end only".
export function wayWords(project, connection, way) {
  if (way === 'both') return 'both ways';
  if (way === 'closed') return 'closed';
  if (!connection) return 'one way only';
  const a = floorOf(project, connection.a.floorId);
  const b = floorOf(project, connection.b.floorId);
  if (!a || !b || a.level === b.level) return way === 'ab' ? 'from the A end only' : 'from the B end only';
  const toHigher = (a.level < b.level) === (way === 'ab');
  return toHigher ? 'up only' : 'down only';
}

// ---- no-ops

function realBell(project, lever) {
  if (isText(lever.bellsId)) {
    const schedule = bellSchedulesOf(project).find((candidate) => candidate.id === lever.bellsId);
    return schedule ? schedule.bells[lever.period] : undefined;
  }
  const dayType = findDayType(project, lever.dayTypeId);
  return dayType && isOwnCopy(project, dayType.id) ? dayType.bells[lever.period] : undefined;
}

// A release lever changes nothing when releaseDelay already gives every
// group, in every day type and period, what it gives with the lever laid over.
function releaseChangesNothing(project, lever) {
  const applied = applyLevers(project, [lever]);
  const periods = project.settings.periods;
  for (const group of project.groups) {
    for (const dayType of ownDayTypes(project)) {
      const day = group.days ? group.days[dayType.id] : undefined;
      for (let period = 0; period < periods; period += 1) {
        const slot = Array.isArray(day) ? day[period] : undefined;
        const room = slot ? resolveSlotRoom(project, slot).room : null;
        const from = room ? room.id : null;
        if (releaseDelay(project, group.id, dayType.id, period, from) !== releaseDelay(applied, group.id, dayType.id, period, from)) return false;
      }
    }
  }
  return true;
}

// Does this lever leave things as the real schedule has them? False when
// what it names is not there: that is for reconcile to say.
function isNoLever(project, lever) {
  if (lever.kind === 'bell') {
    const bell = realBell(project, lever);
    return Boolean(bell) && bell.start === lever.start && bell.end === lever.end;
  }
  if (lever.kind === 'capacity') {
    const room = findRoom(project, lever.roomId);
    return room !== null && room.capacity === lever.capacity;
  }
  if (lever.kind === 'headCount') {
    const group = findById(project.groups, lever.groupId);
    if (!group) return false;
    // a group with no head count of its own has the school's, so the lever
    // that says that number (or none) leaves things as they are
    const standard = project.settings.defaultHeadCount;
    return (Number.isInteger(group.headCount) ? group.headCount : standard) === (lever.headCount === null ? standard : lever.headCount);
  }
  if (lever.kind === 'release') return releaseChangesNothing(project, lever);
  if (lever.kind === 'way') {
    // closing is always a change; a direction the connection already has is none
    const connection = connectionOf(project, lever.connectionId);
    return connection !== null && lever.way === connection.direction;
  }
  return false;
}

// One lever per key, the later replacing the earlier whole; the one being
// added (options.added, an index, default the last, or null for none, as
// for a file) goes too when it leaves the schedule as it is. An older lever
// the schedule has caught up with stays, as a change does. Returns the list
// it was given when nothing was removed.
export function normaliseLevers(project, levers, options) {
  const list = leversOf(levers);
  const opts = options || {};
  const added = opts.added === undefined ? list.length - 1 : opts.added;
  if (added !== null && !Number.isInteger(added)) throw new TypeError('normaliseLevers: options.added is an index into the levers, or null.');
  const keep = new Array(list.length).fill(true);
  const owner = new Map();
  list.forEach((lever, index) => {
    const key = leverKey(lever);
    if (key === null) return;
    if (owner.has(key)) keep[owner.get(key)] = false;
    owner.set(key, index);
  });
  if (added !== null && added >= 0 && added < list.length && keep[added] && isReadableLever(list[added]) && isNoLever(project, list[added])) keep[added] = false;
  const kept = list.filter((lever, index) => keep[index]);
  return kept.length === list.length ? list : kept;
}

// ---- words

function dayTypeNameParts(project, ids) {
  const parts = [];
  ids.forEach((id, i) => {
    if (i > 0) parts.push(words(i === ids.length - 1 ? ' and ' : ', '));
    const dayType = findDayType(project, id);
    parts.push(dayType ? typed(dayType.name) : words('a day type no longer in the project'));
  });
  return parts;
}

function joinedParts(items) {
  const parts = [];
  items.forEach((item, i) => {
    if (i > 0) parts.push(words(i === items.length - 1 ? ' and ' : ', '));
    parts.push(...item);
  });
  return parts;
}

function clockWords(project, bell) {
  const format = project.settings.timeFormat;
  return bell ? formatTime(bell.start, format) + ' to ' + formatTime(bell.end, format) : 'no bell';
}

function seatWords(count) {
  return count === null || count === undefined ? 'not set' : String(count);
}

// A lever as a chip says it, as parts like changeWords' ("Room 204 seats 30
// (was 24)"); `teachers` is always empty, so the answer has changeWords' shape.
function leverWords(project, lever) {
  const parts = [];
  if (lever.kind === 'release') {
    const kind = releaseKind(lever.who);
    if (kind === 'groups') parts.push(...joinedParts(lever.who.groups.map((id) => groupParts(project, id))));
    else if (kind === 'grade') parts.push(words('Grade '), typed(String(lever.who.grade).trim()));
    else if (kind === 'wing') parts.push(typed(String(lever.who.wing).trim()), words(' wing'));
    else parts.push(words('A staggered dismissal'));
    const verb = kind === 'groups' && lever.who.groups.length > 1 ? ' leave' : ' leaves';
    parts.push(words(lever.seconds === 0 ? verb + ' on the bell' : verb + ' ' + formatDuration(lever.seconds) + ' after the bell'));
    if (Array.isArray(lever.after)) parts.push(words(', after ' + listWords(lever.after.map((period) => periodName(project.settings, period)))));
    if (Array.isArray(lever.dayTypeIds)) parts.push(words(', on '), ...dayTypeNameParts(project, lever.dayTypeIds));
  } else if (lever.kind === 'bell') {
    if (isText(lever.bellsId)) {
      const schedule = bellSchedulesOf(project).find((candidate) => candidate.id === lever.bellsId);
      parts.push(schedule ? typed(schedule.name) : words('A bell schedule no longer in the project'), words(' bells'));
    } else {
      const dayType = findDayType(project, lever.dayTypeId);
      parts.push(dayType ? typed(dayType.name) : words('A day type no longer in the project'));
    }
    parts.push(words(', '), ...periodParts(project, lever.period), words(': ' + clockWords(project, lever) + ' (was ' + clockWords(project, realBell(project, lever) || null) + ')'));
  } else if (lever.kind === 'capacity') {
    const room = findRoom(project, lever.roomId);
    parts.push(...(room && typeof room.number === 'string' && room.number.trim() !== '' ? [words('Room '), typed(room.number)] : roomParts(room)));
    parts.push(words(lever.capacity === null ? ' has no capacity set' : ' seats ' + lever.capacity), words(' (was ' + seatWords(room ? room.capacity : null) + ')'));
  } else if (lever.kind === 'headCount') {
    const group = findById(project.groups, lever.groupId);
    const real = group && Number.isInteger(group.headCount) ? group.headCount : project.settings.defaultHeadCount;
    parts.push(...groupParts(project, lever.groupId));
    parts.push(words(lever.headCount === null ? ': the school\'s ' + project.settings.defaultHeadCount + ' students' : ': ' + lever.headCount + ' students'), words(' (was ' + real + ')'));
  } else if (lever.kind === 'way') {
    const connection = connectionOf(project, lever.connectionId);
    if (lever.way === 'closed') parts.push(words('Close '), ...stairsParts(project, connection));
    else parts.push(...stairsParts(project, connection), words(': ' + wayWords(project, connection, lever.way)));
  } else if (lever.kind === 'corridor') {
    const floor = floorOf(project, lever.floorId);
    if (lever.name.trim() !== '') parts.push(words('Close '), typed(lever.name));
    else parts.push(words('Close ' + lever.cells.length + (lever.cells.length === 1 ? ' corridor cell' : ' corridor cells') + ' on '), floor ? typed(floor.name) : words('a floor no longer in the building'));
  } else {
    parts.push(words('A lever of a kind this version does not know'));
  }
  return { parts, text: joinParts(parts), teachers: [] };
}

// ---- reconcile

// A release lever with what the project no longer has taken out of it: the
// groups, day types and periods that are gone (a period is gone when it is
// past the school day). The very same lever when nothing was; only called
// for a lever whyLeverGone found something left in.
function trimLever(project, lever) {
  if (lever.kind === 'corridor') {
    // the cells that are no longer corridor drop out, as a deleted group
    // drops out of a release lever; whyLeverGone has said some are left
    const floor = floorOf(project, lever.floorId);
    const cells = lever.cells.filter((cell) => floor && cell < floor.cells.length && floor.cells[cell] === CELL_CORRIDOR);
    return cells.length === lever.cells.length ? lever : { ...lever, cells };
  }
  if (lever.kind !== 'release') return lever;
  let who = lever.who;
  let after = lever.after;
  let dayTypeIds = lever.dayTypeIds;
  if (Array.isArray(who.groups)) {
    const groups = who.groups.filter((id) => findById(project.groups, id));
    if (groups.length !== who.groups.length) who = { groups };
  }
  if (Array.isArray(after) && after.some((period) => period >= project.settings.periods)) after = after.filter((period) => period < project.settings.periods);
  if (Array.isArray(dayTypeIds) && dayTypeIds.some((id) => !findDayType(project, id))) dayTypeIds = dayTypeIds.filter((id) => findDayType(project, id));
  if (who === lever.who && after === lever.after && dayTypeIds === lever.dayTypeIds) return lever;
  return { ...lever, who, after, dayTypeIds };
}

// Why a lever cannot apply to this project, as parts to follow its words, or
// null when nothing it names is gone.
function whyLeverGone(project, lever) {
  if (lever.kind === 'release') {
    if (Array.isArray(lever.who.groups) && !lever.who.groups.some((id) => findById(project.groups, id))) return [words(lever.who.groups.length > 1 ? 'its groups are no longer in the project.' : 'its group is no longer in the project.')];
    if (Array.isArray(lever.dayTypeIds) && !lever.dayTypeIds.some((id) => findDayType(project, id))) return [words(lever.dayTypeIds.length > 1 ? 'its day types are no longer in the project.' : 'its day type is no longer in the project.')];
    if (Array.isArray(lever.after) && !lever.after.some((period) => period < project.settings.periods)) return [words('its periods are no longer in the school day, which has ' + project.settings.periods + '.')];
    return null;
  }
  if (lever.kind === 'bell') {
    if (isText(lever.bellsId)) {
      if (!bellSchedulesOf(project).some((schedule) => schedule.id === lever.bellsId)) return [words('its bell schedule is no longer in the project.')];
    } else {
      const dayType = findDayType(project, lever.dayTypeId);
      if (!dayType) return [words('its day type is no longer in the project.')];
      if (!isOwnCopy(project, dayType.id)) return [typed(dayType.name), words(' is the same as '), typed(describeDayType(project, dayType.id).follows), words(' again, so it has no bells of its own to change.')];
    }
    if (lever.period >= project.settings.periods) return [words(periodName(project.settings, lever.period) + ' is no longer in the school day, which has ' + project.settings.periods + '.')];
    return null;
  }
  if (lever.kind === 'capacity') return findRoom(project, lever.roomId) ? null : [words('the room is no longer in the building.')];
  if (lever.kind === 'headCount') return findById(project.groups, lever.groupId) ? null : [words('its group is no longer in the project.')];
  if (lever.kind === 'way') {
    const connection = connectionOf(project, lever.connectionId);
    if (!connection) return [words('the stairs connection is no longer in the building.')];
    if (connection.kind === ELEVATOR_KIND) return [words('it names an elevator, and only stairs can be closed or made one way here.')];
    return null;
  }
  if (lever.kind === 'corridor') {
    const floor = floorOf(project, lever.floorId);
    if (!floor) return [words('its floor is no longer in the building.')];
    if (!lever.cells.some((cell) => cell < floor.cells.length && floor.cells[cell] === CELL_CORRIDOR)) return [words('its cells are no longer corridor.')];
    return null;
  }
  return null;
}

// Which levers no longer apply to the project as it is, and why: { levers,
// dropped: [{ lever, parts, sentence }] }, in the order given. A lever goes
// for the first that holds: it cannot be read; what it names is gone
// (whyLeverGone); a later lever of its key replaces it; the schedule already
// has it (the building, for a way). A corridor lever loses the cells that are
// no longer corridor and goes when none is left. Pure.
export function reconcileLevers(project, scenario) {
  const original = leversOf(scenario);
  const gone = original.map((lever) => (isReadableLever(lever) ? whyLeverGone(project, lever) : [words('it is not a lever this version can read.')]));
  // what a release lever names that is gone is trimmed, as a real entry's is
  // when its group, day type or period is deleted; so the lane and Apply
  // (which writes this list) see one lever
  const list = original.map((lever, index) => (gone[index] === null ? trimLever(project, lever) : lever));
  const replaced = new Array(list.length).fill(false);
  const later = new Set();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (gone[index] !== null) continue;
    const key = leverKey(list[index]);
    replaced[index] = later.has(key);
    later.add(key);
  }
  const levers = [];
  const dropped = [];
  list.forEach((lever, index) => {
    let why = gone[index];
    if (why === null && replaced[index]) why = [words('a later lever of the same kind for the same thing replaces it.')];
    if (why === null && isNoLever(project, lever)) why = [words(lever.kind === 'way' ? 'the building already has this.' : 'the schedule already has this.')];
    if (why === null) {
      levers.push(lever);
      return;
    }
    const parts = isReadableLever(lever) ? leverWords(project, lever).parts.concat([words(': ')], why) : [words('A lever could not be read: ')].concat(why);
    dropped.push({ lever, parts, sentence: joinParts(parts) });
  });
  return { levers, dropped };
}

// ---------------------------------------------------------------- compare

function sideOf(figureBefore, figureAfter) {
  return { before: figureBefore, after: figureAfter, difference: figureAfter - figureBefore };
}

// The loads of the runs asked about: every own day type's, or one's, under
// the regular bells (bellsId null) or under one bell schedule.
function wantedLoads(result, dayTypeId, bellsId) {
  const source = bellsId === null ? (result ? result.loads : null) : result ? result.bellLoads : null;
  const list = Array.isArray(source) ? source.filter((load) => load && (bellsId === null || load.bellsId === bellsId)) : [];
  return dayTypeId === null ? list : list.filter((load) => load.dayTypeId === dayTypeId);
}

function runOfEntry(entry) {
  return typeof entry.bellsId === 'string' ? entry.bellsId : null;
}

// Walking, crowding, lateness and failed walks, per group and in all, from
// result.walks and result.failedWalks. `walking` is the crowd model's own
// (ARCHITECTURE 6.3 rule 8), never a route's seconds; `late` is the crowd
// model's, against the transition's passing time and the school's margin,
// and a group stopped before it arrived is late. A walk with no way through
// is not in walks at all: it is counted in `failed`, and in nothing else.
// A teacher's is in walks.teachers with `failed: true`, and counts in the
// total `failed` only.
function emptyFigures() {
  return { walking: 0, waiting: 0, total: 0, late: 0, walks: 0, failed: 0 };
}

export function walkFigures(view, dayTypeId, bellsId) {
  const groups = new Map();
  const all = emptyFigures();
  const into = (groupId) => {
    if (!groups.has(groupId)) groups.set(groupId, emptyFigures());
    return [groups.get(groupId), all];
  };
  const source = bellsId === null ? view.walks : view.walks && view.walks.bells;
  const walks = source && Array.isArray(source.groups) ? source.groups : [];
  for (const walk of walks) {
    if (dayTypeId !== null && walk.dayTypeId !== dayTypeId) continue;
    if (bellsId !== null && walk.bellsId !== bellsId) continue;
    const late = walk.late === true || walk.arrived === false;
    for (const figures of into(walk.groupId)) {
      figures.walking += walk.walking;
      figures.waiting += walk.waiting;
      figures.total += walk.total;
      figures.late += late ? 1 : 0;
      figures.walks += 1;
    }
  }
  for (const failed of view.failedWalks) {
    if (dayTypeId !== null && failed.dayTypeId !== dayTypeId) continue;
    if (runOfEntry(failed) !== bellsId) continue;
    for (const figures of into(failed.groupId)) figures.failed += 1;
  }
  // a teacher with no way through is a failed walk too, counted in all and in
  // no group's row (SV2-90b), so a closure that strands a teacher shows
  const stranded = source && Array.isArray(source.teachers) ? source.teachers : [];
  for (const walk of stranded) {
    if (walk.failed !== true) continue;
    if (dayTypeId !== null && walk.dayTypeId !== dayTypeId) continue;
    if (bellsId !== null && walk.bellsId !== bellsId) continue;
    all.failed += 1;
  }
  return { groups, all };
}

// Every walk with no way through in a routesForSchedule() result: a route
// that failed for any reason but a slot with no room ('no-room' is an empty
// period, not a walk).
// The walks of a bell-schedule run come after the regular runs', each with
// its bellsId after dayTypeId. A walk into or out of a period that does not
// meet is 'no-room' too (meetingSlots empties the period).
function failedWalksOf(routes) {
  const out = [];
  const days = routes && Array.isArray(routes.days) ? routes.days : [];
  const bells = routes && Array.isArray(routes.bells) ? routes.bells : [];
  for (const day of days.concat(bells)) {
    const head = typeof day.bellsId === 'string' ? { dayTypeId: day.dayTypeId, bellsId: day.bellsId } : { dayTypeId: day.dayTypeId };
    for (const group of day.groups) {
      group.routes.forEach((found, period) => {
        if (found && found.ok === false && found.reason !== 'no-room') out.push({ ...head, groupId: group.groupId, period, reason: found.reason });
      });
    }
  }
  return out;
}

// What compareResults reads of a createPipeline().run() result, and nothing
// else: { places, loads, walks, findings, failedWalks }, the first four the
// result's own (the same objects), with bellLoads after loads when the
// result has bell-schedule runs, and failedWalks [{ dayTypeId, groupId,
// period, reason }] worked out from result.routes. A result that already
// carries failedWalks (one trimResult gave) comes back as it is. The
// scenario lane sends this in place of the whole result. A result with
// neither failedWalks nor routes is refused with a TypeError: it would read
// as one where no walk fails.
export function trimResult(result) {
  if (!result || typeof result !== 'object') throw new TypeError('trimResult needs a pipeline result.');
  if (Array.isArray(result.failedWalks)) return result;
  if (!result.routes || !Array.isArray(result.routes.days)) throw new TypeError('trimResult needs a pipeline result with its routes, or one trimResult gave.');
  const trimmed = { places: result.places, loads: result.loads };
  if (Array.isArray(result.bellLoads)) trimmed.bellLoads = result.bellLoads;
  trimmed.walks = result.walks;
  trimmed.findings = result.findings;
  trimmed.failedWalks = failedWalksOf(result.routes);
  return trimmed;
}

// The busiest place: the highest load in any one transition of a cell or a
// connection outside the exclusion zones, the cells first and then the
// connections, lower index first on a tie. Null when nothing is crossed.
export function busiestOf(result, dayTypeId, bellsId) {
  let best = null;
  for (const load of wantedLoads(result, dayTypeId, bellsId)) {
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

export function findingsOf(result) {
  return result && result.findings && Array.isArray(result.findings.findings) ? result.findings.findings : [];
}

// Does this finding belong to the run under bells `bellsId` (null for the
// regular bells)? A walk that is late is a figure of the runs it is late in
// (where.bellsIds, with null for the regular run; none at all when only the
// regular run has it); every other finding is about the day type's classes
// and is the same under any bells.
function inRun(finding, bellsId) {
  if (finding.kind !== 'group-walk' && finding.kind !== 'teacher-walk') return true;
  const runs = finding.where && Array.isArray(finding.where.bellsIds) ? finding.where.bellsIds : [null];
  return runs.includes(bellsId);
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

// Every figure of spec 9.2 for two results of createPipeline().run(), or two
// trimResult() answers (the header says which fields are read), `before` for
// the real schedule and `after` for the schedule with the scenario applied.
// Both are of one building, so their places and load arrays line up; a pair
// that does not is refused with a TypeError.
//
// options:
//   dayTypeId   one own day type, or null (the default) for all of them
//   bellsId     the bell schedule whose runs are compared, or null (the
//               default) for the regular bells. The findings are the day
//               type's whatever the bells, unless runFindings is true.
//   runFindings true: the findings (new, resolved, unchanged, and the counts)
//               are those of the run chosen, as the walking and the loads
//               are: a walk that is late is counted where it is late under
//               these bells, the other kinds are the day type's. The lab
//               asks for this; suggest() does not, since a suggestion that
//               makes a walk late under other bells has a cost to report.
//   transition  for the places: one transition (the period walked out of),
//               or null for the whole day
//   measure     for the places over the whole day: 'busiest' (the default)
//               or 'total'
//   floorIds    the floors shown: the places are ranked among those with an
//               end on one of them; null (the default) ranks the building
//   changes     the scenario's changes (or the scenario), to mark the edited groups
//   levers      the scenario's levers (or the scenario): a head-count lever's group, a
//               release lever's groups, and the groups whose time held back differs
//               between the two sides (a grade or a wing) are marked edited too
//   limit       how many places busier and how many quieter (default 10)
//
// The answer:
//   { dayTypeId, bellsId (when one was asked for),
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
//     groups: [{ groupId, edited, before, after, difference, failedChange }]
//       before and after are { walking, waiting, total, late, walks, failed }
//       or null for a group with neither a walk nor a failed walk on that
//       side; walking to late add up the walks that have a way through,
//       `failed` counts those that have none. failedChange is after's failed
//       less before's (a null side counts 0). difference is the change in
//       total travel time, and null when a side is null or when failedChange
//       is not 0: then the two totals add up different walks, and a walk
//       that fails would read as time saved. Order: the rows with more
//       failed walks after first (most first), then those with fewer (most
//       first), then the rest by the size of the time change, then the rows
//       whose difference is null; within each, edited groups first, then by
//       id. A screen words a row with failedChange not 0 by failedChange.
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
  const bellsId = typeof opts.bellsId === 'string' ? opts.bellsId : null;
  const transition = Number.isInteger(opts.transition) ? opts.transition : null;
  const measure = opts.measure === 'total' ? 'total' : 'busiest';
  const runFindings = opts.runFindings === true;
  const limit = Number.isInteger(opts.limit) && opts.limit >= 0 ? opts.limit : 10;
  const floorIds = Array.isArray(opts.floorIds) ? new Set(opts.floorIds) : null;
  const was = trimResult(before);
  const now = trimResult(after);
  if (!sameGeometry(was, now)) throw new TypeError('compareResults needs two results for one building.');

  // ---- figures
  const walksBefore = walkFigures(was, dayTypeId, bellsId);
  const walksAfter = walkFigures(now, dayTypeId, bellsId);
  const busyBefore = busiestOf(was, dayTypeId, bellsId);
  const busyAfter = busiestOf(now, dayTypeId, bellsId);
  const findingsBefore = findingsOf(was).filter((finding) => (!runFindings || inRun(finding, bellsId)) && (dayTypeId === null || finding.where.dayTypeId === null || finding.where.dayTypeId === dayTypeId));
  const findingsAfter = findingsOf(now).filter((finding) => (!runFindings || inRun(finding, bellsId)) && (dayTypeId === null || finding.where.dayTypeId === null || finding.where.dayTypeId === dayTypeId));
  const countsBefore = countBySeverity(findingsBefore);
  const countsAfter = countBySeverity(findingsAfter);
  const bySeverity = {};
  for (const severity of SEVERITIES) bySeverity[severity] = sideOf(countsBefore[severity], countsAfter[severity]);
  const figures = {
    walking: sideOf(walksBefore.all.walking, walksAfter.all.walking),
    crowding: sideOf(walksBefore.all.waiting, walksAfter.all.waiting),
    busiest: { before: busyBefore, after: busyAfter, difference: (busyAfter ? busyAfter.load : 0) - (busyBefore ? busyBefore.load : 0) },
    late: sideOf(walksBefore.all.late, walksAfter.all.late),
    failed: sideOf(walksBefore.all.failed, walksAfter.all.failed),
    findings: bySeverity,
  };

  // ---- groups
  const edited = new Set(editedGroupIds(opts.changes || []));
  const levers = leversOf(opts.levers || []);
  for (const id of leverGroupIds(levers)) edited.add(id);
  // a staggered dismissal for a grade or a wing names no group: the groups it
  // held back are those whose time spent held back differs between the sides
  if (levers.some((lever) => isObject(lever) && lever.kind === 'release')) {
    const heldOf = (view) => {
      const held = new Map();
      for (const source of [view.walks, view.walks && view.walks.bells]) {
        for (const walk of source && Array.isArray(source.groups) ? source.groups : []) {
          if ((dayTypeId !== null && walk.dayTypeId !== dayTypeId) || (bellsId !== null && walk.bellsId !== bellsId) || (bellsId === null && walk.bellsId !== undefined)) continue;
          held.set(walk.groupId, (held.get(walk.groupId) || 0) + (walk.released || 0));
        }
      }
      return held;
    };
    const wasHeld = heldOf(was);
    const nowHeld = heldOf(now);
    for (const id of new Set([...wasHeld.keys(), ...nowHeld.keys()])) if ((wasHeld.get(id) || 0) !== (nowHeld.get(id) || 0)) edited.add(id);
  }
  const groupIds = Array.from(new Set([...walksBefore.groups.keys(), ...walksAfter.groups.keys()]));
  const groups = groupIds.map((groupId) => {
    const sideBefore = walksBefore.groups.get(groupId) || null;
    const sideAfter = walksAfter.groups.get(groupId) || null;
    const failedChange = (sideAfter ? sideAfter.failed : 0) - (sideBefore ? sideBefore.failed : 0);
    const difference = sideBefore && sideAfter && failedChange === 0 ? sideAfter.total - sideBefore.total : null;
    return { groupId, edited: edited.has(groupId), before: sideBefore, after: sideAfter, difference, failedChange };
  });
  // 0: more failed walks after, 1: fewer, 2: a time change, 3: no difference to show
  const band = (row) => (row.failedChange > 0 ? 0 : row.failedChange < 0 ? 1 : row.difference !== null ? 2 : 3);
  groups.sort((a, b) => {
    if (band(a) !== band(b)) return band(a) - band(b);
    const size = Math.abs(b.failedChange) - Math.abs(a.failedChange) || Math.abs(b.difference || 0) - Math.abs(a.difference || 0);
    if (size !== 0) return size;
    if (a.edited !== b.edited) return a.edited ? -1 : 1;
    return a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0;
  });

  // ---- places
  const busier = [];
  const quieter = [];
  let elsewhere = 0;
  const cut = now.places ? now.places.places : [];
  const loadsBefore = new Map(wantedLoads(was, dayTypeId, bellsId).map((load) => [load.dayTypeId, load]));
  const loadsAfter = wantedLoads(now, dayTypeId, bellsId);
  cut.forEach((place, order) => {
    let best = null;
    for (const load of loadsAfter) {
      const earlier = loadsBefore.get(load.dayTypeId);
      if (!earlier || (transition !== null && !(transition < load.transitions))) continue;
      const a = placeLoad(earlier, place, transition, measure);
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
    ...(bellsId === null ? {} : { bellsId }),
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

// The difference map's numbers for two loads() results of one run on one
// building: after less before, per graph node (cells) and per index into
// graph.links (connections), as Int32Arrays. Two results of different day
// types, of different bells, or of different buildings, are refused with a
// TypeError.
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
  if (before.dayTypeId !== after.dayTypeId) throw new TypeError('loadDifference needs two loads() results of one day type.');
  if (runOfEntry(before) !== runOfEntry(after)) throw new TypeError('loadDifference needs two loads() results under the same bells.');
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

// Room numbers are matched loosely where that is unambiguous: NFKC, lower
// case, every space removed, so "Gym" is "GYM" and "２０４" is " 2 04 ". An
// unnumbered room has no key and is matched by nothing.
function looseRoomKey(number) {
  return roomNumberKey(String(number).normalize('NFKC')).replace(/\s+/g, '');
}

export function roomKeys(project) {
  const keys = new Map();
  for (const room of allRooms(project)) {
    const key = looseRoomKey(room.number);
    if (key === '') continue;
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(room);
  }
  return keys;
}

// Pairs each numbered room of B with one room of A. A loose key that one
// room in each file has pairs them. Where two rooms of one file share a
// loose key ("B12" and "B 12"), those rooms are paired by the engine's own
// key (roomNumberKey: trimmed, lower case) instead, and a room that still
// has no one partner is `alike`: B's room id to the rooms of A whose numbers
// read like it. Also counts the rooms of A the file has no room for
// (`missing`) and the rooms of the file A has none for (`added`), by loose
// key.
export function matchRooms(keysA, keysB) {
  let missing = 0;
  let added = 0;
  const missingNumbers = [];
  const addedNumbers = [];
  // the numbers of the surplus rooms, as each file writes them: the rooms of a
  // key past as many as the other file has, in the order the file lists them
  for (const [key, rooms] of keysA) {
    const extra = rooms.slice((keysB.get(key) || []).length);
    missing += extra.length;
    for (const room of extra) missingNumbers.push(room.number);
  }
  for (const [key, rooms] of keysB) {
    const extra = rooms.slice((keysA.get(key) || []).length);
    added += extra.length;
    for (const room of extra) addedNumbers.push(room.number);
  }
  const pairOf = new Map();
  const alike = new Map();
  for (const [key, roomsB] of keysB) {
    const roomsA = keysA.get(key) || [];
    if (roomsA.length === 1 && roomsB.length === 1) {
      pairOf.set(roomsB[0].id, roomsA[0]);
      continue;
    }
    for (const room of roomsB) {
      const strict = roomNumberKey(room.number);
      const inA = roomsA.filter((candidate) => roomNumberKey(candidate.number) === strict);
      const inB = roomsB.filter((candidate) => roomNumberKey(candidate.number) === strict);
      if (inA.length === 1 && inB.length === 1) pairOf.set(room.id, inA[0]);
      else alike.set(room.id, roomsA);
    }
  }
  return { missing, added, missingNumbers, addedNumbers, pairOf, alike };
}

// "1 room is missing and 1 is added", "2 rooms are added"
function buildingWords(missing, added) {
  const count = (n, noun) => n + (noun ? (n === 1 ? ' room' : ' rooms') : '') + (n === 1 ? ' is' : ' are');
  const out = [];
  if (missing > 0) out.push(count(missing, true) + ' missing');
  if (added > 0) out.push(count(added, out.length === 0) + ' added');
  return out.join(' and ');
}

// "Compare with another project file": `projectA` is the project as it is,
// `projectB` the other file (this year against next year's proposal). Rooms
// are matched by number (above), groups by name (case-insensitive) and day
// types by name. Every slot of a matched group on a matched day type whose
// room differs becomes a move to A's room of that number.
//
// Refused with an ActionError (code 'different-building') when the two sets
// of room numbers differ: "This file describes a different building: 1 room
// is missing and 1 is added." (a renumbered room is one of each).
//
// options: { fileName, name }. Returns
//   { scenario: { name, changes, compared: { fileName, addedGroups, removedGroups } },
//     skipped: [{ reason, groupName, dayTypeName, period, sentence }] }
// where addedGroups are the names only in B, removedGroups those only in A,
// and `skipped` what was not compared or cannot be said as a move, never
// guessed. By reason:
//   'day-type'         a day type only one file has (groupName and period null)
//   'period'           a period beyond the shorter day (groupName and
//                      dayTypeName null); periods are compared up to it
//   'same-as'          a slot that differs on a day type "the same as" in A
//   'no-room'          B has no room in the slot
//   'not-in-building'  B's slot keeps a number that is not a room
//   'no-number'        B's room has no number
//   'alike'            B's room is one of rooms whose numbers read alike
//                      ("B12" and "B 12") and cannot be told apart
// The file-wide entries come first, then the slots, by day type, group and
// period. Group names that occur twice in B match the first.
export function scenarioFromDiff(projectA, projectB, options) {
  const opts = options || {};
  const fileName = typeof opts.fileName === 'string' ? opts.fileName : '';
  const keysA = roomKeys(projectA);
  const keysB = roomKeys(projectB);
  const rooms = matchRooms(keysA, keysB);
  if (rooms.missing + rooms.added > 0) {
    throw new ActionError('This file describes a different building: ' + buildingWords(rooms.missing, rooms.added) + '.', 'different-building');
  }

  const groupsB = new Map();
  for (const group of projectB.groups) if (!groupsB.has(nameKey(group.name))) groupsB.set(nameKey(group.name), group);
  const namesA = new Set(projectA.groups.map((group) => nameKey(group.name)));
  const addedGroups = projectB.groups.filter((group) => !namesA.has(nameKey(group.name))).map((group) => group.name);
  const removedGroups = projectA.groups.filter((group) => !groupsB.has(nameKey(group.name))).map((group) => group.name);
  const daysB = new Map();
  for (const dayType of projectB.dayTypes) if (!daysB.has(nameKey(dayType.name))) daysB.set(nameKey(dayType.name), dayType);
  const daysA = new Set(projectA.dayTypes.map((dayType) => nameKey(dayType.name)));

  const changes = [];
  const skipped = [];
  const note = (reason, groupName, dayTypeName, period, sentence) => skipped.push({ reason, groupName, dayTypeName, period, sentence });

  // ---- what is not compared at all
  for (const dayType of projectA.dayTypes) {
    if (!daysB.has(nameKey(dayType.name))) note('day-type', null, dayType.name, null, dayType.name + ': the file has no day type of this name, so it is not compared.');
  }
  for (const dayType of projectB.dayTypes) {
    if (!daysA.has(nameKey(dayType.name))) note('day-type', null, dayType.name, null, dayType.name + ': only the file has this day type, so it is not compared.');
  }
  const periodsA = projectA.settings.periods;
  const periodsB = projectB.settings.periods;
  const periods = Math.min(periodsA, periodsB);
  for (let period = periods; period < periodsA; period += 1) {
    note('period', null, null, period, periodName(projectA.settings, period) + ': the file\'s day has ' + periodsB + ' ' + periodWord(projectB.settings, periodsB !== 1) + ', so it is not compared.');
  }
  for (let period = periods; period < periodsB; period += 1) {
    note('period', null, null, period, periodName(projectB.settings, period) + ' of the file: this project\'s day has ' + periodsA + ' ' + periodWord(projectA.settings, periodsA !== 1) + ', so it is not compared.');
  }

  // ---- slot by slot
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
        if (!a.room && !b.room && roomNumberKey(a.text) === roomNumberKey(b.text)) continue;
        const matched = b.room ? rooms.pairOf.get(b.room.id) || null : null;
        if (a.room && matched === a.room) continue;
        const skip = (reason, why) => note(reason, group.name, dayType.name, period, group.name + ' · ' + dayType.name + ' · ' + periodName(projectA.settings, period) + ': ' + why);
        if (!own) {
          skip('same-as', dayType.name + ' is the same as ' + describeDayType(projectA, dayType.id).follows + ' here, so it has no schedule of its own to change.');
          continue;
        }
        if (!b.room) {
          if (b.text === '') skip('no-room', 'the file has no room there.');
          else skip('not-in-building', 'the file has ' + b.text + ' there, which is not in the building.');
          continue;
        }
        if (looseRoomKey(b.room.number) === '') {
          skip('no-number', 'the file has a room with no number there, which cannot be matched.');
          continue;
        }
        if (matched === null) {
          const alike = rooms.alike.get(b.room.id) || [];
          skip('alike', countWord(alike.length) + ' rooms in this building have numbers that read alike: ' + listWords(alike.map((room) => room.number)) + '.');
          continue;
        }
        changes.push({ kind: 'move', dayTypeId: dayType.id, groupId: group.id, period, roomId: matched.id });
      }
    }
  }
  const name = typeof opts.name === 'string' ? opts.name : fileName === '' ? 'Compared with another file' : 'Compared with ' + fileName;
  return { scenario: { name, changes, compared: { fileName, addedGroups, removedGroups } }, skipped };
}
