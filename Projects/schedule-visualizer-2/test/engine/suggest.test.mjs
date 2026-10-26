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
import { suggest, suggestionCandidates, suggestionParts, NO_SUGGESTION, SUGGESTION_LIMIT, SUGGESTION_KINDS } from '../../engine/suggest.js';
import { applyChanges, normalise, compareResults } from '../../engine/scenario.js';
import { createPipeline } from '../../engine/worker.js';
import { checkSchedule } from '../../engine/checks.js';
import { setPeriods, setRoomTeachers, setRoomFields, editTeacher, editGroup, setSlot } from '../../engine/actions.js';
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

// kind, day type, period and group or teacher: what a walk finding is about,
// whichever runs it is late in
function walkBase(id) {
  return id.split(':').slice(0, 4).join(':');
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
    if (finding.kind === 'group-walk' || finding.kind === 'teacher-walk') {
      // under any id: a walk's id says which runs it is late in
      const base = walkBase(finding.id);
      assert.deepEqual(ids.filter((id) => walkBase(id) === base), [], suggestion.text + ': the walk is late in no run');
    }
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
    // and the walking figure is the one the lab will show when it is tried
    const compared = compareResults(before, after, { dayTypeId: d, changes: [suggestion.change], limit: 0 });
    const row = compared.groups.find((entry) => entry.groupId === groupId);
    assert.equal(suggestion.effects.walking.difference, (row && row.after ? row.after.walking : 0) - (row && row.before ? row.before.walking : 0), suggestion.text + ': the lab\'s walking');
    assert.ok(compared.figures.failed.difference <= 0, suggestion.text + ': no walk loses its way');
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
  const lastFree = on.suggestions.map((suggestion) => suggestion.kind).lastIndexOf('free-room');
  assert.ok(lastFree >= 0 && lastFree < on.suggestions.indexOf(theirs[0]), 'after the free rooms');
});

test('another teacher\'s room comes after the free rooms even when its trade is better', () => {
  // with the planning check off, a move to Room 301 adds nothing and walks
  // less, while each move to the Cafeteria adds a note and walks more; the
  // kind still comes first
  let project = shortDay();
  project = { ...project, settings: { ...project.settings, checks: { ...project.settings.checks, off: ['no-planning'] } } };
  const on = suggest(project, findingOf(project, DOUBLE), { otherTeachersRooms: true });
  assertHonest(project, findingOf(project, DOUBLE), on);
  assert.deepEqual(on.suggestions.map((suggestion) => suggestion.kind), ['free-room', 'free-room', 'other-teachers-room', 'other-teachers-room']);
  const [free, theirs] = [on.suggestions[0], on.suggestions[2]];
  assert.ok(theirs.effects.walking.difference < free.effects.walking.difference && theirs.effects.findings.new.note < free.effects.findings.new.note, 'the later one walks less and adds less: ' + on.suggestions.map((s) => s.text).join(' / '));
});

test('another teacher\'s room of another subject is never offered', () => {
  let project = shortDay();
  project = editTeacher(project, { id: teacherId(project, 'Ms. Thistlewood'), subjectId: 'ssample003' }, ctx());
  const finding = findingOf(project, DOUBLE);
  assert.ok(!suggestionCandidates(project, finding, { otherTeachersRooms: true }).some((candidate) => candidate.kind === 'other-teachers-room'));
});

test('a move into a room with no way in or out is never offered, though it walks less', () => {
  // a day of two periods (no swap helps); Room 301 has no teacher, and is
  // shut off as in scenario.test.mjs: no door, moved to a corner of its floor
  // away from every corridor
  let project = school();
  project = setPeriods(project, { periods: 2 }, ctx());
  project = setRoomTeachers(project, { roomId: R301, teacherIds: [] }, ctx());
  const shut = project.building.floors[2].spaces.find((space) => space.id === R301);
  shut.cells = [0];
  shut.doors = [];
  const finding = findingOf(project, DOUBLE);
  const into301 = suggestionCandidates(project, finding).filter((candidate) => candidate.change.roomId === R301);
  assert.equal(into301.length, 2, 'both groups could go to 301: it is free and has no teacher');
  // a walk that fails is not walked: moving 7C there would read as walking saved
  const before = run(project);
  const after = run(applyChanges(project, [into301.find((candidate) => candidate.change.groupId === G7C).change]));
  assert.ok(walkingOf(after, G7C, A) < walkingOf(before, G7C, A));
  const answer = suggest(project, finding);
  assert.ok(answer.suggestions.length > 0);
  const offered = answer.suggestions.map((s) => s.text).join(' / ');
  assert.ok(!answer.suggestions.some((suggestion) => suggestion.change.groupId === G7C && suggestion.change.roomId === R301), offered);
  // 6C is in 301 already in Period 1: staying there takes its failed walk away
  // rather than adding one, so that move is offered
  assert.ok(answer.suggestions.some((suggestion) => suggestion.change.groupId === G6C && suggestion.change.roomId === R301), offered);
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

test('one pipeline handed in: never run under the store\'s counters, each run under one of its own, sharing the routes', () => {
  const project = school();
  const finding = findingOf(project, DOUBLE);
  const real = createPipeline();
  const versions = { geometry: 3, building: 4, schedule: 5 };
  real.run(project, versions);
  const calls = [];
  const pipeline = {
    run(next, counters) {
      const result = real.run(next, counters);
      calls.push({ next, counters, work: result.work });
      return result;
    },
  };
  const shared = suggest(project, finding, { pipeline, versions });
  assert.equal(calls[0].next, project, 'the schedule as it is, first');
  const schedules = calls.map((call) => call.counters.schedule);
  assert.equal(new Set(schedules).size, schedules.length, 'each run has a counter of its own');
  assert.ok(schedules.every((n) => n < 0), 'below zero, where the store never counts: ' + schedules.join(','));
  assert.ok(calls.every((call) => call.counters.geometry === 3 && call.counters.building === 4));
  const again = [];
  suggest(project, finding, { pipeline: { run: (next, counters) => { again.push(counters.schedule); return real.run(next, counters); } }, versions });
  assert.ok(again.every((n) => !schedules.includes(n)), 'and never one an earlier call used');
  const candidates = calls.slice(1);
  assert.ok(candidates.length > 0);
  // a swap walks between rooms the schedule already walks between: nothing is searched again
  assert.ok(calls.every((call) => call.work.routesRun === true && call.work.searches === 0), 'the route cache is shared: ' + calls.map((call) => call.work.searches).join(','));
  // against the run before it: the two transitions at each end of either
  // swap, at most eight of the fourteen
  assert.ok(calls.every((call) => call.work.transitionsRun <= 8 && call.work.transitions === 14), 'a run works out only the transitions that changed: ' + calls.map((call) => call.work.transitionsRun).join(','));
  // the same answer as with a pipeline of its own
  const alone = suggest(project, finding);
  assert.deepEqual(shared.suggestions.map((s) => s.text), alone.suggestions.map((s) => s.text));
});

test('a pipeline holding a scenario under the store\'s counters: the same suggestions as a fresh one', () => {
  // the lane's pipeline holds the schedule with the first suggestion tried,
  // under the counters the store has for the schedule as it is. Read as the
  // schedule as it is, the room is no longer double-booked, and nothing
  // would be offered.
  const project = school();
  const finding = findingOf(project, DOUBLE);
  const versions = { geometry: 2, building: 3, schedule: 4 };
  const alone = suggest(project, finding).suggestions.map((s) => s.text);
  const lane = createPipeline();
  lane.run(applyChanges(project, [suggest(project, finding).suggestions[0].change]), versions);
  const answer = suggest(project, finding, { pipeline: lane, versions });
  assert.equal(answer.none, null, 'something to offer');
  assert.deepEqual(answer.suggestions.map((s) => s.text), alone);
});

test('a pipeline handed in after it held another project: the same suggestions as a fresh one', () => {
  // the first call stops after its first run (its finding is not in that
  // project), so the pipeline is left holding the other project under a
  // counter of suggest's own. A counter used twice would read it back.
  const project = school();
  const finding = findingOf(project, DOUBLE);
  const versions = { geometry: 2, building: 3, schedule: 4 };
  const alone = suggest(project, finding).suggestions.map((s) => s.text);
  const pipeline = createPipeline();
  const other = applyChanges(project, [{ kind: 'move', dayTypeId: A, groupId: G7C, period: 1, roomId: CAFETERIA }]);
  assert.deepEqual(suggest(other, finding, { pipeline, versions }), { suggestions: [], none: NO_SUGGESTION }, 'not a finding of the other project');
  const answer = suggest(project, finding, { pipeline, versions });
  assert.deepEqual(answer.suggestions.map((s) => s.text), alone);
});

test('the static checks come first for a room finding, and do not judge a walk', () => {
  const project = school();
  const count = (finding) => {
    const real = createPipeline();
    let runs = 0;
    const answer = suggest(project, finding, { pipeline: { run: (next, counters) => { runs += 1; return real.run(next, counters); } } });
    return { runs: runs - 1, answer };
  };
  const double = findingOf(project, DOUBLE);
  const doubleCandidates = suggestionCandidates(project, double);
  // stage 1 drops the swaps that leave 203 double-booked or book another room twice
  assert.ok(count(double).runs < doubleCandidates.length, 'the pipeline runs fewer than all ' + doubleCandidates.length);
  // the static checks cannot see a walk: the swaps reach the pipeline, and
  // it is the pipeline that says which clear it
  const walk = findingOf(project, WALK);
  const { runs, answer } = count(walk);
  assert.ok(runs > 0);
  assert.ok(answer.suggestions.some((s) => s.kind === 'reorder'), answer.suggestions.map((s) => s.text).join(' / '));
});

// What the pipeline was handed, told apart by the edited groups' days.
function spyPipeline(project, seen) {
  const real = createPipeline();
  return {
    run(next, counters) {
      if (next !== project) seen.push(next);
      return real.run(next, counters);
    },
  };
}

function sameDays(a, b) {
  return JSON.stringify(a.groups.map((group) => group.days)) === JSON.stringify(b.groups.map((group) => group.days));
}

test('stage 1: a candidate the static checks say leaves the finding, or adds a problem, never reaches the pipeline', () => {
  // the limit of consecutive periods at 3: Ms. Vandermeer teaches Periods 1
  // to 4 in Room 203 on A Day, and many swaps leave her run as long
  const sample = school();
  const project = { ...sample, settings: { ...sample.settings, checks: { ...sample.settings.checks, consecutiveLimit: 3 } } };
  const finding = findingOf(project, 'consecutive:' + A + ':0:' + teacherId(project, 'Ms. Vandermeer'));
  const problems = new Set(checkSchedule(project, null).findings.filter((one) => one.severity === 'problem').map((one) => one.id));
  const ruledOut = suggestionCandidates(project, finding).map((candidate) => applyChanges(project, [candidate.change])).filter((next) => {
    const after = checkSchedule(next, null);
    return after.findings.some((one) => one.id === finding.id) || after.findings.some((one) => one.severity === 'problem' && !problems.has(one.id));
  });
  const stays = ruledOut.filter((next) => checkSchedule(next, null).findings.some((one) => one.id === finding.id));
  assert.ok(stays.length > 0 && stays.length < ruledOut.length, 'some candidates leave the run as it is, others add a problem');
  const seen = [];
  const answer = suggest(project, finding, { pipeline: spyPipeline(project, seen) });
  assert.ok(answer.suggestions.length > 0 && seen.length > 0);
  for (const next of seen) assert.ok(!ruledOut.some((out) => sameDays(out, next)), 'the pipeline ran a candidate the static checks ruled out');
});

test('stage 2: a candidate the pipeline says leaves the finding is never offered, whatever the static checks said', () => {
  // the pipeline is told to report the finding still there for the first
  // suggestion's change; a room finding passes the static checks first, so
  // only stage 2 can drop it
  const project = school();
  const finding = findingOf(project, DOUBLE);
  const first = suggest(project, finding).suggestions[0];
  const target = applyChanges(project, [first.change]);
  const real = createPipeline();
  const pipeline = {
    run(next, counters) {
      const result = real.run(next, counters);
      if (next === project || !sameDays(next, target)) return result;
      return { ...result, findings: { ...result.findings, findings: result.findings.findings.concat([finding]) } };
    },
  };
  const answer = suggest(project, finding, { pipeline });
  assert.ok(answer.suggestions.length > 0);
  assert.ok(!answer.suggestions.some((suggestion) => JSON.stringify(suggestion.change) === JSON.stringify(first.change)), 'dropped: ' + first.text);
});

test('the same answer every time', () => {
  const project = school();
  const finding = findingOf(project, WALK);
  assert.deepEqual(suggest(project, finding), suggest(project, finding));
});

// ---------------------------------------------------------------- SV2-63b

test('the fourth kind goes by the teacher\'s subject, never the room\'s: a Science teacher\'s room is not offered for Social Studies', () => {
  // Room 301 given Social Studies as its own subject; its teacher, Ms.
  // Thistlewood, still teaches Science, and 6C and 7C are Ms. Vandermeer's
  // Social Studies
  let project = school();
  project = setPeriods(project, { periods: 2 }, ctx());
  project = setRoomFields(project, { roomId: R301, subjectId: 'ssample004' }, ctx());
  const finding = findingOf(project, DOUBLE);
  const theirs = suggestionCandidates(project, finding, { otherTeachersRooms: true }).filter((candidate) => candidate.kind === 'other-teachers-room');
  assert.deepEqual(theirs.map((candidate) => candidate.change.roomId), [], 'no room of another teacher of the subject');
  const on = suggest(project, finding, { otherTeachersRooms: true });
  assert.ok(on.suggestions.every((suggestion) => suggestion.change.roomId !== R301), on.suggestions.map((s) => s.text).join(' / '));
});

test('another teacher\'s room with two owners names both', () => {
  // Room 301 is Ms. Thistlewood's (Social Studies here) and Mr.
  // Pennywhistle's, who has nobody in Period 2
  let project = shortDay();
  project = setRoomTeachers(project, { roomId: R301, teacherIds: [teacherId(project, 'Ms. Thistlewood'), teacherId(project, 'Mr. Pennywhistle')] }, ctx());
  const finding = findingOf(project, DOUBLE);
  const on = suggest(project, finding, { otherTeachersRooms: true });
  assertHonest(project, finding, on);
  const theirs = on.suggestions.filter((suggestion) => suggestion.kind === 'other-teachers-room');
  assert.equal(theirs.length, 2, on.suggestions.map((s) => s.text).join(' / '));
  for (const suggestion of theirs) {
    assert.match(suggestion.text, /^Move (6C|7C) to Room 301, Ms\. Thistlewood and Mr\. Pennywhistle's room, for Period 2: from Room 203, taught by Ms\. Thistlewood and Mr\. Pennywhistle instead of Ms\. Vandermeer, /);
    assert.deepEqual(suggestion.effects.owners, [teacherId(project, 'Ms. Thistlewood'), teacherId(project, 'Mr. Pennywhistle')]);
    assert.ok(suggestion.parts.some((part) => part.name === true && part.text === 'Mr. Pennywhistle'), 'each name a typed part');
  }
});

// The sample school with 8B in the Cafeteria (shared, no teacher) in Period
// 2 on A Day, beside 6C (23) and 7C (22) double-booked in Room 203. 8B has
// the school's default head count, 25.
function cafeteriaInUse(capacity) {
  let project = school();
  project = setSlot(project, { groupId: 'gsample08b', dayTypeId: A, period: 1, slot: { room: CAFETERIA } }, ctx());
  if (capacity !== undefined) project = setRoomFields(project, { roomId: CAFETERIA, capacity }, ctx());
  return project;
}

test('a shared space in use is free while the groups there and the one moving in fit it', () => {
  const into = (project) => suggestionCandidates(project, findingOf(project, DOUBLE)).filter((candidate) => candidate.change.roomId === CAFETERIA).map((candidate) => candidate.change.groupId).sort();
  assert.deepEqual(into(cafeteriaInUse()), [G6C, G7C], 'it seats 150: either group can join 8B');
  assert.deepEqual(into(cafeteriaInUse(48)), [G6C, G7C], '25 and 23 is 48');
  assert.deepEqual(into(cafeteriaInUse(47)), [G7C], '25 and 23 is over 47; 25 and 22 is not');
  assert.deepEqual(into(cafeteriaInUse(null)), [], 'with no capacity it is free only when empty');
  const project = cafeteriaInUse();
  const finding = findingOf(project, DOUBLE);
  const answer = suggest(project, finding);
  assertHonest(project, finding, answer);
  const move = answer.suggestions.find((suggestion) => suggestion.change.roomId === CAFETERIA && suggestion.change.groupId === G7C);
  assert.ok(move, answer.suggestions.map((s) => s.text).join(' / '));
  assert.match(move.text, /^Move 7C to Cafeteria for Period 2: from Room 203, no longer taught by Ms\. Vandermeer, .*no new findings$/);
});

test('a room that seats the group comes before one that does not', () => {
  // a day of two periods; Room 301 has no teacher and seats 10, the
  // Cafeteria seats 150. Each is a floor from Room 203, and 301 comes first
  // by number, so only the seats put the Cafeteria ahead
  let project = school();
  project = setPeriods(project, { periods: 2 }, ctx());
  project = setRoomTeachers(project, { roomId: R301, teacherIds: [] }, ctx());
  const order = () => suggestionCandidates(project, findingOf(project, DOUBLE)).filter((candidate) => candidate.change.groupId === G7C && candidate.kind === 'free-room').map((candidate) => candidate.change.roomId);
  assert.deepEqual(order(), [R301, CAFETERIA], 'both seat 7C: by number');
  project = setRoomFields(project, { roomId: R301, capacity: 10 }, ctx());
  assert.deepEqual(order(), [CAFETERIA, R301], 'the one that seats 7C first');
});

test('a teacher in two rooms: moving the group from a room not in the building into the teacher\'s own room', () => {
  // one period; 8B's slot keeps "999", a room not in the building, and names
  // Ms. Vandermeer, who has 6B in Room 203, here a shared space seating 60
  let project = school();
  project = setPeriods(project, { periods: 1 }, ctx());
  const vandermeer = teacherId(project, 'Ms. Vandermeer');
  project = setSlot(project, { groupId: 'gsample08b', dayTypeId: A, period: 0, slot: { room: null, roomText: '999', teacherIds: [vandermeer] } }, ctx());
  project = setRoomFields(project, { roomId: R203, shared: true, capacity: 60 }, ctx());
  const finding = findingOf(project, 'teacher-double:' + A + ':0:' + vandermeer);
  const answer = suggest(project, finding);
  assertHonest(project, finding, answer);
  assertWords(answer);
  const move = answer.suggestions.find((suggestion) => suggestion.change.groupId === 'gsample08b');
  assert.ok(move, answer.suggestions.map((s) => s.text).join(' / '));
  assert.equal(move.kind, 'teachers-room');
  assert.match(move.text, /^Move 8B to Room 203 for Period 1: from 999 \(not in the building\), same teachers, /);
  assert.ok(move.parts.some((part) => part.name === true && part.text === '999'), 'the number as typed');
});

test('"from no room": the words for a group with no room in the period', () => {
  // a move changes the room and never who teaches, so no finding keeps a
  // move from an empty slot; the words are read straight from the sentence
  let project = school();
  project = setSlot(project, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: null } }, ctx());
  const candidate = { change: { kind: 'move', dayTypeId: A, groupId: G7C, period: 1, roomId: R301 }, kind: 'teachers-room', room: project.building.floors[2].spaces.find((space) => space.id === R301), owners: [] };
  const effects = { teachers: [], walking: { before: 0, after: 0, difference: 0 }, findings: { new: { problem: 0, warning: 0, note: 0 } } };
  const text = suggestionParts(project, candidate, effects).map((part) => part.text).join('');
  assert.equal(text, 'Move 7C to Room 301 for Period 2: from no room, same teachers, no change in walking, no new findings');
});

test('a teacher in two rooms is cleared by a suggestion', () => {
  // 8B's slot in Room 101 in Period 2 names Ms. Vandermeer, who has 6C and 7C in 203
  let project = school();
  project = setSlot(project, { groupId: 'gsample08b', dayTypeId: A, period: 1, slot: { teacherIds: [teacherId(project, 'Ms. Vandermeer')] } }, ctx());
  const finding = findingOf(project, 'teacher-double:' + A + ':1:' + teacherId(project, 'Ms. Vandermeer'));
  const answer = suggest(project, finding);
  assert.ok(answer.suggestions.length > 0);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
});

test('no planning period is cleared by a suggestion', () => {
  const project = setPeriods(school(), { periods: 2 }, ctx());
  const finding = findingOf(project, 'no-planning:' + A + ':' + teacherId(project, 'Coach Dunmore'));
  const answer = suggest(project, finding);
  assert.ok(answer.suggestions.length > 0);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
});

test('a teacher\'s walk is cleared by a suggestion', () => {
  // 8A's slot in Room 303 in Period 7 names Coach Dunmore, who has 8A in the
  // Gym in Period 6: 4 min 21 s before any crowding, with 4 min to pass
  let project = school();
  const dunmore = teacherId(project, 'Coach Dunmore');
  project = setSlot(project, { groupId: G8A, dayTypeId: A, period: 6, slot: { teacherIds: [dunmore] } }, ctx());
  const finding = findingOf(project, 'teacher-walk:' + A + ':5:' + dunmore);
  const answer = suggest(project, finding);
  assert.ok(answer.suggestions.length > 0);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
});

test('a room over capacity is cleared by a suggestion', () => {
  const project = editGroup(school(), { id: 'gsample07b', headCount: 35 }, ctx());
  const finding = findingOf(project, 'over-capacity:' + A + ':1:rsample204');
  const answer = suggest(project, finding);
  assert.ok(answer.suggestions.length > 0);
  assertHonest(project, finding, answer);
  assertOrdered(answer);
  assertWords(answer);
  assert.ok(answer.suggestions.some((suggestion) => suggestion.text === 'Move 7B to Cafeteria for Period 2: from Room 204, no longer taught by Mme. Dufrêne, 54 seconds more walking, no new findings'), answer.suggestions.map((s) => s.text).join(' / '));
});

test('the period words: Blocks, Hours and Mods', () => {
  const expected = {
    Block: ["Swap 7C's Blocks B and F: ", 'Move 7C to Cafeteria for Block B: '],
    Hour: ["Swap 7C's 2nd and 6th Hours: ", 'Move 7C to Cafeteria for 2nd Hour: '],
    Mod: ["Swap 7C's Mods 2 and 6: ", 'Move 7C to Cafeteria for Mod 2: '],
  };
  for (const [word, [swap, move]] of Object.entries(expected)) {
    const sample = school();
    const project = { ...sample, settings: { ...sample.settings, periodWord: word } };
    const texts = suggest(project, findingOf(project, DOUBLE)).suggestions.map((s) => s.text);
    assert.ok(texts.some((text) => text.startsWith(swap)), word + ': ' + texts.join(' / '));
    assert.ok(texts.some((text) => text.startsWith(move)), word + ': ' + texts.join(' / '));
  }
});

test('every suggestion for every finding of the sample school, and of its variants, is honest', () => {
  const variants = [school(), shortDay(), cafeteriaInUse(), editGroup(school(), { id: 'gsample07b', headCount: 35 }, ctx())];
  let offered = 0;
  for (const project of variants) {
    const before = run(project);
    for (const finding of before.findings.findings.concat(before.findings.accepted)) {
      for (const otherTeachersRooms of [false, true]) {
        const answer = suggest(project, finding, { otherTeachersRooms });
        offered += answer.suggestions.length;
        assertHonest(project, finding, answer);
        assertOrdered(answer);
        assertWords(answer);
      }
    }
  }
  assert.ok(offered > 50, offered + ' suggestions');
});

test('the cap changes no answer on the sample school: capped and uncapped give the same lists', () => {
  for (const project of [school(), shortDay(), editGroup(school(), { id: 'gsample07b', headCount: 35 }, ctx())]) {
    const pipeline = createPipeline();
    const versions = { geometry: 1, building: 1, schedule: 1 };
    for (const finding of pipeline.run(project, versions).findings.findings.filter((one) => one.fixable)) {
      for (const otherTeachersRooms of [false, true]) {
        const capped = suggest(project, finding, { pipeline, versions, otherTeachersRooms }).suggestions.map((s) => s.text);
        const uncapped = suggest(project, finding, { pipeline, versions, otherTeachersRooms, runTries: Infinity }).suggestions.map((s) => s.text);
        assert.deepEqual(capped, uncapped, finding.id);
      }
    }
  }
});

// ---------------------------------------------------------------- bell schedules

const ER = 'bsample0er';
function clock2(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
// eight 30-minute periods from 08:00 with `gap` minutes of passing time
function bellsWithGap(gap) {
  const bells = [];
  for (let p = 0; p < 8; p += 1) bells.push({ start: clock2(480 + (30 + gap) * p), end: clock2(510 + (30 + gap) * p) });
  return bells;
}

// A walk finding's id depends on the runs it is late in (the regular run's
// id, else the first schedule's added), so a change that only moves the
// lateness between the regular bells and a bell schedule renames the finding
// and clears nothing.
test('bell schedules: a walk late under the regular bells and Early Release is not cleared by making it late under Early Release alone', () => {
  const project = school();
  project.bellSchedules = [{ id: ER, name: 'Early Release', short: '', bells: bellsWithGap(2), off: [] }];
  const both = run(project).findings.findings.filter((one) => one.kind === 'group-walk' && Array.isArray(one.where.bellsIds) && one.where.bellsIds[0] === null && one.where.bellsIds.includes(ER));
  assert.ok(both.length > 0, 'a walk late under both');
  for (const finding of both) {
    const answer = suggest(project, finding, { limit: 50, otherTeachersRooms: true });
    for (const suggestion of answer.suggestions) {
      assert.ok(!suggestion.effects.findings.newIds.includes(finding.id + ':' + ER), suggestion.text + ': not a rename');
    }
    assertHonest(project, finding, answer);
  }
});

test('bell schedules: a walk late under Early Release alone is not cleared by making it late under the regular bells', () => {
  const project = school();
  for (const dayType of project.dayTypes) if (dayType.own) dayType.bells = bellsWithGap(3);
  project.bellSchedules = [{ id: ER, name: 'Early Release', short: '', bells: bellsWithGap(1), off: [] }];
  const only = run(project).findings.findings.filter((one) => one.kind === 'group-walk' && one.id.endsWith(':' + ER));
  assert.ok(only.length > 5, only.length + ' walks late under Early Release alone');
  // the review found renames for 6C's and 7B's walks out of Period 1
  const chosen = only.filter((one) => one.where.period === 0).slice(0, 4);
  assert.ok(chosen.length >= 2);
  for (const finding of chosen) {
    const answer = suggest(project, finding, { limit: 50, otherTeachersRooms: true });
    for (const suggestion of answer.suggestions) {
      assert.ok(!suggestion.effects.findings.newIds.includes(walkBase(finding.id)), suggestion.text + ': not a rename');
    }
    assertHonest(project, finding, answer);
  }
});
