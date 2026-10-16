// Suggestions for a finding (engine/suggest.js, spec 5.8, ARCHITECTURE 6.6
// "Suggestions", SV2-63): the candidates, the two stages, the order, the
// sentence, at most five, never "best", and "No small change clears this."
// The cases run on the sample school, whose A Day has 6C and 7C both in Room
// 203 in Period 2 (a problem) and 8A's walk from the Gym in Period 6 to Room
// 303 in Period 7, longer than the passing time (a warning). Every check of
// a suggestion's effect is made again here on a fresh pipeline, so the test
// does not take suggest's word for what a change does. Nothing here reads a
// clock: the engine takes none, and the actions get the pinned one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, suggestionCandidates, NO_SUGGESTION, SUGGESTION_LIMIT, SUGGESTION_KINDS, RUN_TRIES } from '../../engine/suggest.js';
import { applyChanges, normalise } from '../../engine/scenario.js';
import { createPipeline } from '../../engine/worker.js';
import { setPeriods, setRoomTeachers, editTeacher, editGroup, setSlot } from '../../engine/actions.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { school, ctx } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const G6C = 'gsample06c';
const G7C = 'gsample07c';
const G8A = 'gsample08a';
const R203 = 'rsample203';
const R301 = 'rsample301';
const CAFETERIA = 'rsamplecaf';
const DOUBLE = 'room-double:' + A + ':1:' + R203;
const WALK = 'group-walk:' + A + ':5:' + G8A;
const RANKS = { reorder: 0, 'teachers-room': 1, 'free-room': 1, 'other-teachers-room': 2 };

function teacherId(project, name) {
  return project.teachers.find((teacher) => teacher.name === name).id;
}

function run(project) {
  return createPipeline().run(project);
}

function findingOf(project, id) {
  const found = run(project).findings.findings.find((finding) => finding.id === id);
  assert.ok(found, 'the finding ' + id + ' is there to start with');
  return found;
}

// The crowd model's walking for one group over one day, from a fresh run.
function walkingOf(result, groupId, dayTypeId) {
  return result.walks.groups.filter((walk) => walk.groupId === groupId && walk.dayTypeId === dayTypeId).reduce((sum, walk) => sum + walk.walking, 0);
}

function routeSecondsOf(result, groupId, dayTypeId) {
  const day = result.routes.days.find((entry) => entry.dayTypeId === dayTypeId);
  const routes = day.groups.find((entry) => entry.groupId === groupId).routes;
  return routes.reduce((sum, found) => sum + (found && found.ok === true && found.same !== true ? found.seconds : 0), 0);
}

// Every suggestion, checked again from nothing: the finding is gone, no
// problem is new, no walk lost its way, and the effects are what a fresh run
// says.
function assertHonest(project, finding, answer) {
  const before = run(project);
  const problemsBefore = new Set(before.findings.findings.filter((one) => one.severity === 'problem').map((one) => one.id));
  const idsBefore = new Set(before.findings.findings.map((one) => one.id));
  for (const suggestion of answer.suggestions) {
    const after = run(applyChanges(project, [suggestion.change]));
    const ids = after.findings.findings.map((one) => one.id).concat(after.findings.accepted.map((one) => one.id));
    assert.ok(!ids.includes(finding.id), suggestion.text + ': the finding is cleared');
    const newProblems = after.findings.findings.filter((one) => one.severity === 'problem' && !problemsBefore.has(one.id));
    assert.deepEqual(newProblems.map((one) => one.id), [], suggestion.text + ': no new problem');
    const fresh = after.findings.findings.filter((one) => !idsBefore.has(one.id));
    for (const severity of ['problem', 'warning', 'note']) {
      assert.equal(suggestion.effects.findings.new[severity], fresh.filter((one) => one.severity === severity).length, suggestion.text + ': new ' + severity + 's');
    }
    const groupId = suggestion.change.groupId;
    const d = suggestion.change.dayTypeId;
    assert.equal(suggestion.effects.walking.before, walkingOf(before, groupId, d), suggestion.text + ': walking before is the crowd model\'s');
    assert.equal(suggestion.effects.walking.after, walkingOf(after, groupId, d), suggestion.text + ': walking after is the crowd model\'s');
    assert.equal(suggestion.effects.walking.difference, suggestion.effects.walking.after - suggestion.effects.walking.before);
  }
}

function assertOrdered(answer) {
  const list = answer.suggestions;
  for (let i = 1; i < list.length; i += 1) {
    const x = list[i - 1];
    const y = list[i];
    const key = (s) => [RANKS[s.kind], s.effects.findings.new.warning, s.effects.findings.new.note, s.effects.walking.difference];
    const a = key(x);
    const b = key(y);
    const order = a.findIndex((value, k) => value !== b[k]);
    if (order === -1) continue;
    assert.ok(a[order] < b[order], 'in order: "' + x.text + '" before "' + y.text + '" (key ' + order + ')');
  }
}

function assertWords(answer) {
  for (const suggestion of answer.suggestions) {
    assert.equal(suggestion.text, suggestion.parts.map((part) => part.text).join(''), 'the text is the parts joined');
    const own = suggestion.parts.filter((part) => part.name !== true).map((part) => part.text).join(' ');
    assert.ok(!/best/i.test(own), 'never "best": ' + suggestion.text);
    // <verb>: <rooms>, <teachers>, <walking>, <findings>
    assert.match(suggestion.text, /^(Swap|Move) .+: .+, (same teachers|taught by .+|no longer taught by .+), (no change in walking|\d.* (less|more) walking), (no new findings|.+ new (warning|note)s?)$/);
  }
}

// ---------------------------------------------------------------- the double-booked room

test('the double-booked room: up to five, each clears it with no new problem, swaps first', () => {
  const project = school();
  const finding = findingOf(project, DOUBLE);
  assert.deepEqual(finding.where.groupIds.slice().sort(), SAMPLE_PROBLEMS.roomDouble.groupIds.slice().sort());
  const answer = suggest(project, finding);
  assert.equal(answer.none, null);
  assert.equal(answer.suggestions.length, SUGGESTION_LIMIT);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
  assert.equal(answer.suggestions[0].kind, 'reorder');
  assert.equal(answer.suggestions[0].text, "Swap 7C's Periods 2 and 6: same rooms, same teachers, no change in walking, no new findings");
  for (const suggestion of answer.suggestions) {
    assert.ok([G6C, G7C].includes(suggestion.change.groupId), 'it moves one of the two groups');
    assert.equal(suggestion.change.dayTypeId, A);
    assert.ok(SUGGESTION_KINDS.includes(suggestion.kind));
    assert.equal(normalise(project, [suggestion.change]).length, 1, 'a suggestion is a change, never a no-op');
  }
});

test('the double-booked room: a move to a room with no teacher says the teacher changes', () => {
  const project = school();
  const answer = suggest(project, findingOf(project, DOUBLE));
  const move = answer.suggestions.find((suggestion) => suggestion.kind === 'free-room' && suggestion.change.groupId === G7C);
  assert.ok(move, 'moving 7C to the Cafeteria, which has no teacher, is offered');
  assert.equal(move.change.roomId, CAFETERIA);
  assert.equal(move.text, 'Move 7C to Cafeteria for Period 2: from Room 203, no longer taught by Ms. Vandermeer, 12 seconds less walking, no new findings');
  assert.deepEqual(move.effects.teachers, [{ groupId: G7C, from: [teacherId(project, 'Ms. Vandermeer')], to: [] }]);
  assert.match(move.chip.text, /^7C · A Day · Period 2: 203 → Cafeteria, no longer taught by Ms\. Vandermeer$/);
});

test('the double-booked room: a room of the slot\'s own teacher keeps the teacher, ranked with the free rooms', () => {
  // a day of two periods (no swap helps). 7C's slot in 203 names Ms.
  // Thistlewood, whose room is 301, free in Period 2. (A move to another room
  // of Ms. Vandermeer's would not do: she teaches 6C there and would be in
  // two rooms at once, a new problem.)
  let project = school();
  project = setPeriods(project, { periods: 2 }, ctx());
  const thistlewood = teacherId(project, 'Ms. Thistlewood');
  project = setSlot(project, { groupId: G7C, dayTypeId: A, period: 1, slot: { teacherIds: [thistlewood] } }, ctx());
  const finding = findingOf(project, DOUBLE);
  const own = suggestionCandidates(project, finding).filter((candidate) => candidate.kind === 'teachers-room');
  assert.deepEqual(own.map((candidate) => [candidate.change.groupId, candidate.change.roomId]), [[G7C, R301]]);
  const answer = suggest(project, finding);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
  assert.deepEqual(answer.suggestions.map((s) => s.kind).sort(), ['free-room', 'free-room', 'teachers-room']);
  for (const kept of answer.suggestions.filter((suggestion) => suggestion.kind === 'teachers-room')) {
    assert.match(kept.text, /^Move 7C to Room 301 for Period 2: from Room 203, same teachers, /);
    assert.deepEqual(kept.effects.teachers, []);
  }
  // b and c share a rank: the order between them is the trade, not the kind
  const ranks = answer.suggestions.map((s) => s.effects.walking.difference);
  assert.deepEqual(ranks, ranks.slice().sort((x, y) => x - y), 'by walking: ' + answer.suggestions.map((s) => s.text).join(' / '));
});

// ---------------------------------------------------------------- the long walk

test('the long walk: swapping its two periods comes first among the candidates, and every one clears the walk', () => {
  const project = school();
  const finding = findingOf(project, WALK);
  const candidates = suggestionCandidates(project, finding);
  assert.deepEqual(candidates[0].change, { kind: 'swapPeriods', dayTypeId: A, groupId: G8A, periodA: 5, periodB: 6 });
  assert.ok(candidates.every((candidate) => candidate.change.groupId === G8A));
  assert.ok(candidates.some((candidate) => candidate.change.kind === 'move' && candidate.change.period === 5), 'the walk\'s start can move');
  assert.ok(candidates.some((candidate) => candidate.change.kind === 'move' && candidate.change.period === 6), 'and its end');
  const answer = suggest(project, finding);
  assert.equal(answer.none, null);
  assert.ok(answer.suggestions.length > 0 && answer.suggestions.length <= SUGGESTION_LIMIT);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
});

test('the long walk: walking is the crowd model\'s walking over the day, never the routes\' seconds', () => {
  const project = school();
  const answer = suggest(project, findingOf(project, WALK));
  const before = run(project);
  // the two differ on this school (stairs are rounded into virtual slots), so
  // a sum of route seconds would show here
  assert.notEqual(walkingOf(before, G8A, A), routeSecondsOf(before, G8A, A));
  for (const suggestion of answer.suggestions) {
    const after = run(applyChanges(project, [suggestion.change]));
    assert.equal(suggestion.effects.walking.difference, walkingOf(after, G8A, A) - walkingOf(before, G8A, A), suggestion.text);
    const words = suggestion.effects.walking.difference === 0 ? 'no change in walking' : (suggestion.effects.walking.difference < 0 ? ' less walking' : ' more walking');
    assert.ok(suggestion.text.includes(words), suggestion.text);
  }
});

// ---------------------------------------------------------------- the fourth kind

// A day of two periods, where no swap can help (each puts 203 beside 6B in
// Period 1), and Ms. Thistlewood of Room 301 teaching Social Studies too.
function shortDay() {
  let project = school();
  project = setPeriods(project, { periods: 2 }, ctx());
  project = editTeacher(project, { id: teacherId(project, 'Ms. Thistlewood'), subjectId: 'ssample004' }, ctx());
  return project;
}

test('another teacher\'s room only behind the switch, and the sentence says whose it is', () => {
  const project = shortDay();
  const finding = findingOf(project, DOUBLE);
  assert.ok(!suggestionCandidates(project, finding).some((candidate) => candidate.kind === 'other-teachers-room'), 'off by default');
  const off = suggest(project, finding);
  assert.ok(off.suggestions.every((suggestion) => suggestion.kind !== 'other-teachers-room'));
  assert.ok(off.suggestions.every((suggestion) => suggestion.kind === 'free-room'), 'no swap clears it on a day of two periods');

  const on = suggest(project, finding, { otherTeachersRooms: true });
  assertHonest(project, finding, on);
  assertOrdered(on);
  assertWords(on);
  const theirs = on.suggestions.filter((suggestion) => suggestion.kind === 'other-teachers-room');
  assert.equal(theirs.length, 2, '6C and 7C can each go to Room 301');
  const thistlewood = teacherId(project, 'Ms. Thistlewood');
  for (const suggestion of theirs) {
    assert.equal(suggestion.change.roomId, R301);
    assert.match(suggestion.text, /^Move (6C|7C) to Room 301, Ms\. Thistlewood's room, for Period 2: from Room 203, taught by Ms\. Thistlewood instead of Ms\. Vandermeer, /);
    assert.deepEqual(suggestion.effects.owners, [thistlewood]);
  }
  assert.ok(on.suggestions.indexOf(theirs[0]) > on.suggestions.findIndex((suggestion) => suggestion.kind === 'free-room'), 'after the free rooms');
});

test('another teacher\'s room of another subject is never offered', () => {
  let project = shortDay();
  project = editTeacher(project, { id: teacherId(project, 'Ms. Thistlewood'), subjectId: 'ssample003' }, ctx());
  const finding = findingOf(project, DOUBLE);
  assert.ok(!suggestionCandidates(project, finding, { otherTeachersRooms: true }).some((candidate) => candidate.kind === 'other-teachers-room'));
});

// ---------------------------------------------------------------- none

test('"No small change clears this." when nothing survives', () => {
  // one period: no swap; the Cafeteria given a teacher of another subject:
  // no free room with no teacher, and the switch finds no room of the subject
  let project = school();
  project = setPeriods(project, { periods: 1 }, ctx());
  project = setSlot(project, { groupId: G7C, dayTypeId: A, period: 0, slot: { room: 'rsample203' } }, ctx());
  project = setRoomTeachers(project, { roomId: CAFETERIA, teacherIds: [teacherId(project, 'Mr. Larkspur')] }, ctx());
  const finding = findingOf(project, 'room-double:' + A + ':0:' + R203);
  for (const otherTeachersRooms of [false, true]) {
    const answer = suggest(project, finding, { otherTeachersRooms });
    assert.deepEqual(answer, { suggestions: [], none: NO_SUGGESTION });
  }
  assert.equal(NO_SUGGESTION, 'No small change clears this.');
});

test('a finding with no kind of change to offer, or no longer there, gets the same sentence', () => {
  const project = school();
  const notes = run(project).findings.findings.filter((finding) => !finding.fixable);
  assert.ok(notes.length > 0);
  for (const finding of notes) assert.deepEqual(suggest(project, finding), { suggestions: [], none: NO_SUGGESTION }, finding.id);
  const stale = { ...findingOf(project, DOUBLE), id: 'room-double:' + A + ':3:' + R203 };
  assert.deepEqual(suggest(project, stale), { suggestions: [], none: NO_SUGGESTION });
});

// ---------------------------------------------------------------- limit, order, words

test('at most five, or fewer when asked, the first ones of the same order', () => {
  const project = school();
  const finding = findingOf(project, DOUBLE);
  const five = suggest(project, finding);
  for (const limit of [1, 2, 3]) {
    const fewer = suggest(project, finding, { limit });
    assert.equal(fewer.suggestions.length, limit);
    assert.deepEqual(fewer.suggestions.map((s) => s.text), five.suggestions.slice(0, limit).map((s) => s.text));
  }
  assert.equal(suggest(project, finding, { limit: 50 }).suggestions.length, SUGGESTION_LIMIT, 'never more than five');
});

test('typed names are parts marked as typed, as typed, and the words never say "best"', () => {
  let project = school();
  const hostile = '<b>"Best" & 7C</b>';
  project = editGroup(project, { id: G7C, name: hostile }, ctx());
  const answer = suggest(project, findingOf(project, DOUBLE));
  const withName = answer.suggestions.filter((suggestion) => suggestion.change.groupId === G7C);
  assert.ok(withName.length > 0);
  for (const suggestion of withName) {
    assert.ok(suggestion.parts.some((part) => part.name === true && part.text === hostile), 'the name is one typed part, as typed');
    assert.ok(suggestion.text.includes(hostile));
  }
  assertWords(answer);
});

test('a finding on B Day suggests changes to B Day', () => {
  // 6A and 7A both in Room 101 in Period 7 on B Day
  let project = school();
  project = setSlot(project, { groupId: 'gsample06a', dayTypeId: B, period: 6, slot: { room: 'rsample101' } }, ctx());
  const finding = findingOf(project, 'room-double:' + B + ':6:rsample101');
  const answer = suggest(project, finding);
  assert.ok(answer.suggestions.length > 0);
  assert.ok(answer.suggestions.every((suggestion) => suggestion.change.dayTypeId === B));
  assertHonest(project, finding, answer);
});

// ---------------------------------------------------------------- the pipeline

test('one pipeline handed in: the project first under its counters, then each candidate under its own, sharing the routes', () => {
  const project = school();
  const finding = findingOf(project, DOUBLE);
  const real = createPipeline();
  const versions = { geometry: 3, building: 4, schedule: 5 };
  real.run(project, versions);
  const calls = [];
  const pipeline = {
    run(next, counters) {
      const result = real.run(next, counters);
      calls.push({ counters, work: result.work });
      return result;
    },
  };
  const shared = suggest(project, finding, { pipeline, versions });
  assert.deepEqual(calls[0].counters, versions, 'the schedule as it is, first');
  const candidates = calls.slice(1);
  assert.ok(candidates.length > 0);
  const schedules = candidates.map((call) => call.counters.schedule);
  assert.equal(new Set(schedules).size, schedules.length, 'each candidate has a counter of its own');
  assert.ok(schedules.every((n) => n < 0), 'below zero, where the store never counts');
  assert.ok(candidates.every((call) => call.counters.geometry === 3 && call.counters.building === 4));
  // a swap walks between rooms the schedule already walks between: nothing is searched again
  assert.ok(candidates.every((call) => call.work.routesRun === true && call.work.searches === 0), 'the route cache is shared: ' + candidates.map((call) => call.work.searches).join(','));
  // against the run before it (the last candidate): the two transitions at
  // each end of either swap, at most eight of the fourteen
  assert.ok(candidates.every((call) => call.work.transitionsRun <= 8 && call.work.transitions === 14), 'a candidate runs only the transitions that changed: ' + candidates.map((call) => call.work.transitionsRun).join(','));
  // the same answer as with a pipeline of its own
  const alone = suggest(project, finding);
  assert.deepEqual(shared.suggestions.map((s) => s.text), alone.suggestions.map((s) => s.text));
});

test('the static checks come first for a room finding, and are skipped for a walk', () => {
  const project = school();
  const count = (finding) => {
    const real = createPipeline();
    let runs = 0;
    suggest(project, finding, { pipeline: { run: (next, counters) => { runs += 1; return real.run(next, counters); } } });
    return runs - 1;
  };
  const double = findingOf(project, DOUBLE);
  const doubleCandidates = suggestionCandidates(project, double);
  // stage 1 drops the swaps that leave 203 double-booked or book another room twice
  assert.ok(count(double) < doubleCandidates.length, 'the pipeline runs fewer than all ' + doubleCandidates.length);
  const walk = findingOf(project, WALK);
  const reorders = suggestionCandidates(project, walk).filter((candidate) => candidate.kind === 'reorder').length;
  assert.ok(count(walk) >= Math.min(reorders, RUN_TRIES), 'every swap of a walk goes to the pipeline');
});

test('the same answer every time', () => {
  const project = school();
  const finding = findingOf(project, WALK);
  assert.deepEqual(suggest(project, finding), suggest(project, finding));
});
