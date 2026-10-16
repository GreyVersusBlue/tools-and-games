// Suggestions for a finding (spec 5.8, ARCHITECTURE 6.6 "Suggestions"): up to
// five small changes to the schedule that would clear one finding, each said
// as a sentence with what else it changes. A suggestion is never applied
// here: it is a scenario change (engine/scenario.js) for the lab to try.
//
//   suggest(project, finding, options?)
//     { suggestions: [{ change, kind, parts, text, chip, effects }],
//       none }      "No small change clears this." when the list is empty,
//                   null otherwise
//
//   options:
//     pipeline            a createPipeline() from engine/worker.js to run the
//                         candidates through. Pass the one the caller keeps,
//                         so the candidates share its route cache. Left out,
//                         a pipeline of this call's own.
//     versions            { geometry, building, schedule }, the store's
//                         counters for `project`. With them a candidate runs
//                         again only the transitions it changes; without them
//                         a shared pipeline works every candidate out whole.
//     otherTeachersRooms  true to look at other teachers' rooms too (kind d);
//                         off by default (spec 5.8)
//     limit               at most this many, 1 to 5 (default 5)
//
// The finding is one checkSchedule() gave for `project` (its id, kind and
// `where` are read). The candidates, for a finding about groups G on day
// type D in period p:
//
//   a  'reorder'               swapPeriods(g, p, q) for every other q of the
//                              day; for a walk finding the swap of p and p+1
//                              first, then the other periods nearest first
//   b  'teachers-room'         move g to another room of the slot's own
//                              teachers that no group uses in (D, p)
//   c  'free-room'             move g to a room with no teachers that no
//                              group uses in (D, p), rooms seating the group
//                              first
//   d  'other-teachers-room'   with otherTeachersRooms only: move g to a free
//                              room of another teacher of the same subject;
//                              the sentence says whose room it is
//
// G and p come from the finding's `where`, except: a teacher with no
// planning period has every period of the day in which they teach, and a
// run of consecutive periods has each period of the run; a walk finding
// (group-walk, teacher-walk) has both ends of the walk, p and p+1.
//
// Two stages decide which candidates stay:
//
//   1. the static checks (checkSchedule with no walk figures): a candidate
//      after which the finding's id is still there goes, and so does one
//      that adds a problem. The walk kinds skip this stage, since the static
//      checks cannot see a walk.
//   2. the pipeline, on what is left: a candidate goes when the finding is
//      still there, when it adds a problem, or when it leaves a walk with no
//      way through that had one (a walk that fails is not walked, and would
//      read as walking saved).
//
// The order: the kind (a, then b and c together, then d), fewer new
// warnings, fewer new notes, the change in the edited group's walking over
// day D (the crowd model's `walking`, never a route's seconds; less first),
// then the period and the room number. The words never say "best": each
// sentence says the trade and the reader chooses.
//
// The sentence is built as parts, [{ text, name }] with name true for a
// piece somebody typed (as in scenario.js, places.js and directions.js):
//
//   <verb>: <rooms>, <teachers>, <walking>, <findings>
//   "Swap 6C's Periods 2 and 3: same rooms, same teachers, 40 seconds less
//    walking, no new findings"
//   "Move 7C to Cafeteria for Period 2: from Room 203, no longer taught by
//    Ms. Vandermeer, 12 seconds more walking, one new note"
//   "Move 7C to Room 301, Ms. Thistlewood's room, for Period 2: from Room
//    203, taught by Ms. Thistlewood instead of Ms. Vandermeer, …"
//
// The work is bounded so one finding is answered in about the time of a
// screen's redraw at the size of spec 3.13: each kind tries at most
// STATIC_TRIES candidates in stage 1 and RUN_TRIES in stage 2, in the order
// given above, and a kind is only tried while fewer than `limit` suggestions
// of earlier kinds have been found (those would come first whatever the
// later kinds found). The candidates a cap leaves out are the ones the
// order puts last.
//
// The pipeline. suggest runs `project` through it under `versions` first, and
// takes that run's answer as the schedule as it is, so the pipeline handed in
// must not hold another project under the same counters (a scenario's, say):
// give suggestions a pipeline of their own that shares the route cache. It is
// left holding the last candidate it ran, under schedule counters below zero,
// which a store never uses; its next run with the store's counters works out
// what differs, as after any other change.

import { allRooms, findRoom, findById, resolveSlotRoom, roomNumberKey, nameOfRoom } from './schema.js';
import { isOwnCopy, effectiveSchedule } from './day-types.js';
import { periodName } from './bells.js';
import { slotTeacherIds, teacherDays } from './teacher-day.js';
import { checkSchedule } from './checks.js';
import { countWord } from './findings.js';
import { applyChanges, normalise, changeWords, compareResults } from './scenario.js';
import { createPipeline } from './worker.js';

export const SUGGESTION_LIMIT = 5;
export const NO_SUGGESTION = 'No small change clears this.';
export const STATIC_TRIES = 30;
export const RUN_TRIES = 16;

// The kinds, in the order the list shows them; b and c share a rank.
export const SUGGESTION_KINDS = ['reorder', 'teachers-room', 'free-room', 'other-teachers-room'];
const RANK = { reorder: 0, 'teachers-room': 1, 'free-room': 1, 'other-teachers-room': 2 };

const WALK_KINDS = ['group-walk', 'teacher-walk'];
const KINDS_WITH_SUGGESTIONS = ['room-double', 'teacher-double', 'over-capacity', 'no-planning', 'consecutive', 'teacher-walk', 'group-walk'];

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

function possessive(name) {
  return [typed(name), words("'s")];
}

function listParts(names) {
  const parts = [];
  names.forEach((name, i) => {
    if (i > 0) parts.push(words(i === names.length - 1 ? ' and ' : ', '));
    parts.push(typed(name));
  });
  return parts;
}

function teacherNameList(project, ids) {
  return ids.map((id) => findById(project.teachers, id)).filter(Boolean).map((teacher) => teacher.name);
}

// "Periods 2 and 5", "Blocks B and E", "Mods 1 and 4", "2nd and 5th Hours".
function twoPeriods(settings, a, b) {
  const first = Math.min(a, b);
  const second = Math.max(a, b);
  const nameA = periodName(settings, first);
  const nameB = periodName(settings, second);
  if (settings.periodWord === 'Hour') return nameA.replace(/ Hour$/, '') + ' and ' + nameB.replace(/ Hour$/, '') + ' Hours';
  const space = nameA.indexOf(' ');
  return nameA.slice(0, space) + 's ' + nameA.slice(space + 1) + ' and ' + nameB.slice(nameB.indexOf(' ') + 1);
}

// 40 -> "40 seconds", 60 -> "1 minute", 95 -> "1 minute 35 seconds".
function durationWords(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const unit = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
  if (minutes === 0) return unit(rest, 'second');
  return rest === 0 ? unit(minutes, 'minute') : unit(minutes, 'minute') + ' ' + unit(rest, 'second');
}

function walkingWords(difference) {
  if (difference === 0) return 'no change in walking';
  return durationWords(Math.abs(difference)) + (difference < 0 ? ' less walking' : ' more walking');
}

// "no new findings", "one new warning", "one new warning and two new notes".
function findingWords(counts) {
  const pieces = [];
  for (const severity of ['problem', 'warning', 'note']) {
    const n = counts[severity];
    if (n > 0) pieces.push(countWord(n) + ' new ' + severity + (n === 1 ? '' : 's'));
  }
  if (pieces.length === 0) return 'no new findings';
  return pieces.length === 1 ? pieces[0] : pieces.slice(0, -1).join(', ') + ' and ' + pieces[pieces.length - 1];
}

// A room as a sentence names it (schema.js nameOfRoom: "Room 204", "Gym",
// "a room with no number"), with the typed number or name marked as typed.
function roomNameParts(room) {
  const name = nameOfRoom(room, false);
  const number = typeof room.number === 'string' ? room.number : '';
  if (number.trim() === '') return [words(name)];
  const at = name.lastIndexOf(number);
  return at > 0 ? [words(name.slice(0, at)), typed(number)] : [typed(number)];
}

// Where a slot is, for "from …": a room, a number kept for a room not in the
// building, or no room.
function slotPlaceParts(project, slot) {
  const resolved = resolveSlotRoom(project, slot);
  if (resolved.room) return roomNameParts(resolved.room);
  if (resolved.text !== '') return [typed(resolved.text), words(' (not in the building)')];
  return [words('no room')];
}

function teacherShiftParts(project, shift) {
  if (!shift) return [words('same teachers')];
  const to = teacherNameList(project, shift.to);
  const from = teacherNameList(project, shift.from);
  if (to.length === 0) return [words('no longer taught by '), ...listParts(from)];
  if (from.length === 0) return [words('taught by '), ...listParts(to)];
  return [words('taught by '), ...listParts(to), words(' instead of '), ...listParts(from)];
}

// ---------------------------------------------------------------- candidates

function headCountOf(project, group) {
  return Number.isInteger(group.headCount) ? group.headCount : project.settings.defaultHeadCount;
}

// The rooms some group uses in (d, p), by id.
function usedRooms(project, dayTypeId, period) {
  const used = new Set();
  for (const group of project.groups) {
    const slot = effectiveSchedule(project, group.id, dayTypeId)[period];
    const resolved = resolveSlotRoom(project, slot);
    if (resolved.room) used.add(resolved.room.id);
  }
  return used;
}

// The floor each room is on, and the floor's level.
function roomFloors(project) {
  const out = new Map();
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') out.set(space.id, floor);
  }
  return out;
}

function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The slots the finding is about: [{ groupId, period }], each once, in the
// order they come from the finding. Walk kinds mark which end each is.
function findingSlots(project, finding) {
  const where = finding.where || {};
  const d = where.dayTypeId;
  const periods = project.settings.periods;
  const out = [];
  const seen = new Set();
  const add = (groupId, period) => {
    if (!findById(project.groups, groupId) || !Number.isInteger(period) || period < 0 || period >= periods) return;
    const key = groupId + '\u0000' + period;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ groupId, period });
  };
  const groupIds = Array.isArray(where.groupIds) ? where.groupIds : [];
  if (finding.kind === 'no-planning' || finding.kind === 'consecutive' || finding.kind === 'teacher-walk') {
    const days = teacherDays(project, d);
    const day = days ? days.get(where.teacherId) : null;
    if (!day) return out;
    let from = 0;
    let to = periods - 1;
    if (finding.kind === 'consecutive') {
      from = where.period;
      to = where.period;
      while (to + 1 < periods && day[to + 1].kind === 'teaching') to += 1;
    } else if (finding.kind === 'teacher-walk') {
      from = where.period;
      to = where.period + 1;
    }
    for (let p = from; p <= to && p < periods; p += 1) {
      for (const taught of day[p].groups) add(taught.groupId, p);
    }
    return out;
  }
  if (finding.kind === 'group-walk') {
    for (const groupId of groupIds) {
      add(groupId, where.period);
      add(groupId, where.period + 1);
    }
    return out;
  }
  for (const groupId of groupIds) add(groupId, where.period);
  return out;
}

// Every candidate change for the finding, in the order the kinds are tried
// and, within a kind, the order a cap keeps: { change, kind, slot, room,
// owners, key }. The no-ops normalise would drop are left out, and so is a
// change named twice.
export function suggestionCandidates(project, finding, options) {
  const opts = options || {};
  const where = finding && finding.where ? finding.where : {};
  const d = where.dayTypeId;
  if (!finding || !KINDS_WITH_SUGGESTIONS.includes(finding.kind) || !isOwnCopy(project, d)) return [];
  const periods = project.settings.periods;
  const isWalk = WALK_KINDS.includes(finding.kind);
  const slots = findingSlots(project, finding);
  const floors = roomFloors(project);
  const rooms = allRooms(project);
  const out = [];
  const named = new Set();
  const push = (candidate) => {
    const key = JSON.stringify(candidate.change);
    if (named.has(key)) return;
    if (normalise(project, [candidate.change]).length === 0) return;
    named.add(key);
    out.push(candidate);
  };

  // a: reorder the group's own day
  const swaps = [];
  if (isWalk && Number.isInteger(where.period)) {
    for (const slot of slots) {
      if (slot.period === where.period && slots.some((other) => other.groupId === slot.groupId && other.period === where.period + 1)) {
        swaps.push({ groupId: slot.groupId, a: where.period, b: where.period + 1, distance: 0 });
      }
    }
  }
  for (const slot of slots) {
    for (let q = 0; q < periods; q += 1) {
      if (q !== slot.period) swaps.push({ groupId: slot.groupId, a: slot.period, b: q, distance: Math.abs(q - slot.period) });
    }
  }
  swaps.sort((x, y) => x.distance - y.distance);
  for (const swap of swaps) {
    const periodA = Math.min(swap.a, swap.b);
    const periodB = Math.max(swap.a, swap.b);
    push({
      change: { kind: 'swapPeriods', dayTypeId: d, groupId: swap.groupId, periodA, periodB },
      kind: 'reorder', slot: { groupId: swap.groupId, period: swap.a }, room: null, owners: [],
      key: { period: swap.b, room: '' },
    });
  }

  // b, c and d: move the group to another room for the period
  const moves = { 'teachers-room': [], 'free-room': [], 'other-teachers-room': [] };
  const usedAt = new Map();
  for (const slot of slots) {
    if (!usedAt.has(slot.period)) usedAt.set(slot.period, usedRooms(project, d, slot.period));
    const used = usedAt.get(slot.period);
    const group = findById(project.groups, slot.groupId);
    const current = effectiveSchedule(project, slot.groupId, d)[slot.period];
    const currentRoom = resolveSlotRoom(project, current).room;
    const homeFloor = currentRoom ? floors.get(currentRoom.id) : null;
    const teacherIds = slotTeacherIds(project, current);
    const subjects = new Set();
    for (const id of teacherIds) {
      const teacher = findById(project.teachers, id);
      if (teacher && teacher.subjectId) subjects.add(teacher.subjectId);
    }
    if (subjects.size === 0 && currentRoom && currentRoom.subjectId) subjects.add(currentRoom.subjectId);
    const ownRooms = new Set();
    for (const id of teacherIds) {
      const teacher = findById(project.teachers, id);
      for (const roomId of teacher && Array.isArray(teacher.roomIds) ? teacher.roomIds : []) ownRooms.add(roomId);
    }
    const seats = headCountOf(project, group);
    for (const room of rooms) {
      if (used.has(room.id) || (currentRoom && room.id === currentRoom.id)) continue;
      const roomTeachers = Array.isArray(room.teacherIds) ? room.teacherIds : [];
      let kind = null;
      if (ownRooms.has(room.id)) kind = 'teachers-room';
      else if (roomTeachers.length === 0) kind = 'free-room';
      else if (opts.otherTeachersRooms === true && !roomTeachers.some((id) => teacherIds.includes(id))) {
        const same = roomTeachers.some((id) => {
          const teacher = findById(project.teachers, id);
          return teacher && teacher.subjectId ? subjects.has(teacher.subjectId) : false;
        }) || (room.subjectId !== null && room.subjectId !== undefined && subjects.has(room.subjectId));
        if (same) kind = 'other-teachers-room';
      }
      if (kind === null) continue;
      const floor = floors.get(room.id);
      moves[kind].push({
        change: { kind: 'move', dayTypeId: d, groupId: slot.groupId, period: slot.period, roomId: room.id },
        kind, slot, room, owners: kind === 'other-teachers-room' ? roomTeachers.slice() : [],
        key: { period: slot.period, room: roomNumberKey(room.number) },
        fits: room.capacity === null || room.capacity === undefined || room.capacity >= seats ? 0 : 1,
        away: homeFloor && floor ? Math.abs(floor.level - homeFloor.level) : 0,
      });
    }
  }
  const preference = (x, y) => x.fits - y.fits || x.away - y.away || compareKeys(x.key.room, y.key.room) || compareKeys(x.room.id, y.room.id);
  for (const kind of ['teachers-room', 'free-room', 'other-teachers-room']) {
    for (const move of moves[kind].sort(preference)) {
      const { fits, away, ...candidate } = move;
      push(candidate);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the run

function findingIds(result) {
  const ids = new Set();
  const findings = result && result.findings ? result.findings : result;
  for (const list of [findings.findings, findings.accepted]) {
    for (const finding of Array.isArray(list) ? list : []) ids.add(finding.id);
  }
  return ids;
}

function problemIds(checked) {
  return new Set(checked.findings.filter((finding) => finding.severity === 'problem').map((finding) => finding.id));
}

function sentence(project, candidate, effects) {
  const settings = project.settings;
  const group = findById(project.groups, candidate.change.groupId);
  const parts = [];
  if (candidate.kind === 'reorder') {
    parts.push(words('Swap '), ...possessive(group.name), words(' ' + twoPeriods(settings, candidate.change.periodA, candidate.change.periodB) + ': same rooms, same teachers'));
  } else {
    const current = effectiveSchedule(project, group.id, candidate.change.dayTypeId)[candidate.change.period];
    parts.push(words('Move '), typed(group.name), words(' to '), ...roomNameParts(candidate.room));
    if (candidate.owners.length > 0) {
      const owners = teacherNameList(project, candidate.owners);
      parts.push(words(', '), ...listParts(owners).slice(0, -1), ...possessive(owners[owners.length - 1]), words(' room,'));
    }
    parts.push(words(' for ' + periodName(settings, candidate.change.period) + ': from '), ...slotPlaceParts(project, current), words(', '));
    parts.push(...teacherShiftParts(project, effects.teachers[0] || null));
  }
  parts.push(words(', ' + walkingWords(effects.walking.difference) + ', ' + findingWords(effects.findings.new)));
  return parts;
}

function bySuggestionOrder(x, y) {
  return RANK[x.kind] - RANK[y.kind]
    || x.effects.findings.new.warning - y.effects.findings.new.warning
    || x.effects.findings.new.note - y.effects.findings.new.note
    || x.effects.walking.difference - y.effects.walking.difference
    || x.key.period - y.key.period
    || compareKeys(x.key.room, y.key.room)
    || x.index - y.index;
}

export function suggest(project, finding, options) {
  const opts = options || {};
  const limit = Number.isInteger(opts.limit) ? Math.max(1, Math.min(SUGGESTION_LIMIT, opts.limit)) : SUGGESTION_LIMIT;
  const none = { suggestions: [], none: NO_SUGGESTION };
  if (!finding || typeof finding !== 'object' || !finding.where) return none;
  const own = !opts.pipeline;
  const pipeline = own ? createPipeline() : opts.pipeline;
  const versions = opts.versions || (own ? { geometry: 0, building: 0, schedule: 0 } : null);
  const counters = (n) => (versions ? { geometry: versions.geometry, building: versions.building, schedule: -n } : null);

  const before = pipeline.run(project, versions);
  if (!findingIds(before).has(finding.id)) return none;
  const d = finding.where.dayTypeId;
  const isWalk = WALK_KINDS.includes(finding.kind);
  const staticBefore = isWalk ? null : problemIds(checkSchedule(project, null));

  const candidates = suggestionCandidates(project, finding, opts);
  const found = [];
  let runs = 0;
  for (const rank of [0, 1, 2]) {
    if (found.length >= limit) break;
    let checked = 0;
    let tried = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (RANK[candidate.kind] !== rank) continue;
      const next = applyChanges(project, [candidate.change]);
      if (!isWalk) {
        if (checked >= STATIC_TRIES) break;
        checked += 1;
        const after = checkSchedule(next, null);
        if (findingIds(after).has(finding.id)) continue;
        const problems = problemIds(after);
        if (Array.from(problems).some((id) => !staticBefore.has(id))) continue;
      }
      if (tried >= RUN_TRIES) break;
      tried += 1;
      runs += 1;
      const result = pipeline.run(next, counters(runs));
      if (findingIds(result).has(finding.id)) continue;
      const compared = compareResults(before, result, { dayTypeId: d, changes: [candidate.change], limit: 0 });
      if (compared.findings.new.some((one) => one.severity === 'problem')) continue;
      if (compared.figures.failed.difference > 0) continue;
      const row = compared.groups.find((entry) => entry.groupId === candidate.change.groupId);
      const walkingBefore = row && row.before ? row.before.walking : 0;
      const walkingAfter = row && row.after ? row.after.walking : 0;
      const newCounts = { problem: 0, warning: 0, note: 0 };
      for (const one of compared.findings.new) newCounts[one.severity] += 1;
      const chip = changeWords(project, candidate.change);
      const effects = {
        teachers: chip.teachers,
        owners: candidate.owners,
        walking: { before: walkingBefore, after: walkingAfter, difference: walkingAfter - walkingBefore },
        findings: {
          new: newCounts,
          newIds: compared.findings.new.map((one) => one.id),
          resolvedIds: compared.findings.resolved.map((one) => one.id),
        },
      };
      found.push({ candidate, kind: candidate.kind, key: candidate.key, index, effects, chip });
    }
  }

  found.sort(bySuggestionOrder);
  const suggestions = found.slice(0, limit).map((entry) => {
    const parts = sentence(project, entry.candidate, entry.effects);
    return {
      change: entry.candidate.change,
      kind: entry.kind,
      parts,
      text: joinParts(parts),
      chip: { parts: entry.chip.parts, text: entry.chip.text },
      effects: entry.effects,
    };
  });
  return { suggestions, none: suggestions.length === 0 ? NO_SUGGESTION : null };
}
