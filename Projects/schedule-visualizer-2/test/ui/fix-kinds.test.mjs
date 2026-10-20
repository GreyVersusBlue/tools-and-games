// Fix… is on a finding whose kind is in FIXABLE_KINDS (engine/findings.js),
// and the suggestion engine works only on the kinds in its own list
// (engine/suggest.js, not exported). The header of ui/schedule/checks-fix.js
// says the two are the same; this holds them to it, with no page.
//
// suggest.js's list is read through suggestionCandidates: a finding of a
// kind outside it has no candidates at all, and one inside it, about a slot
// a teacher teaches, has some (at least the swaps of the group's own day).
//
//   node test/ui/fix-kinds.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { FIXABLE_KINDS, KIND_SEVERITY } from '../../engine/findings.js';
import { suggestionCandidates } from '../../engine/suggest.js';
import { teacherDays } from '../../engine/teacher-day.js';
import { sampleSchool } from '../../data/sample-school.js';

const DAY_A = 'dsample00a';

// A slot on A Day that a teacher teaches: the group, the period, the teacher.
function taughtSlot(project) {
  const days = teacherDays(project, DAY_A);
  for (const [teacherId, day] of days) {
    for (const entry of day) {
      if (entry.kind === 'teaching' && entry.groups.length > 0 && entry.period + 1 < project.settings.periods) {
        return { teacherId, period: entry.period, groupId: entry.groups[0].groupId };
      }
    }
  }
  throw new Error('the sample school has no taught slot on A Day');
}

// The kinds suggest.js works on, as its candidates show them.
function kindsWithCandidates(project, kinds) {
  const slot = taughtSlot(project);
  const where = { dayTypeId: DAY_A, period: slot.period, groupIds: [slot.groupId], teacherId: slot.teacherId };
  return kinds.filter((kind) => suggestionCandidates(project, { id: kind + ':test', kind, where }).length > 0);
}

test('every kind a finding can have is named in KIND_SEVERITY, the fixable ones included', () => {
  for (const kind of FIXABLE_KINDS) assert.ok(kind in KIND_SEVERITY, kind);
});

test('the kinds Fix… is on and the kinds the suggestion engine works on are the same set', () => {
  const project = sampleSchool();
  const kinds = Object.keys(KIND_SEVERITY).concat(['not-a-kind']);
  const engine = kindsWithCandidates(project, kinds);
  assert.deepEqual(new Set(engine), new Set(FIXABLE_KINDS));
  assert.equal(engine.length, FIXABLE_KINDS.length);
});
