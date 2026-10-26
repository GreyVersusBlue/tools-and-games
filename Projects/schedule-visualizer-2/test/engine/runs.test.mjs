import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingSlots, runsOf } from '../../engine/runs.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { emptySlot } from '../../engine/schema.js';
import { school, emptyProject } from './helpers.mjs';

function withSchedules() {
  const project = school();
  const bells = project.dayTypes[0].bells.slice();
  project.bellSchedules = [
    { id: 'bsample0er', name: 'Early Release', short: '', bells, off: [5, 6, 7] },
    { id: 'bsample0as', name: 'Assembly', short: '', bells, off: [] },
  ];
  project.dayTypes.push({ id: 'dsample00c', name: 'C Day', own: false, sameAs: 'dsample00b', short: '', bells: Array(8).fill(null) });
  return project;
}

test('meetingSlots with no bells, or bells where every period meets, is effectiveSchedule\'s very array', () => {
  const project = withSchedules();
  for (const g of project.groups) {
    for (const dayType of project.dayTypes) {
      const day = effectiveSchedule(project, g.id, dayType.id);
      assert.equal(meetingSlots(project, g.id, dayType.id), day);
      assert.equal(meetingSlots(project, g.id, dayType.id, null), day);
      assert.equal(meetingSlots(project, g.id, dayType.id, 'bsample0as'), day);
      assert.equal(meetingSlots(project, g.id, dayType.id, 'bnowhere00'), day);
    }
  }
  // a project with no bell schedules at all
  const plain = school();
  assert.equal(meetingSlots(plain, 'gsample06a', 'dsample00a'), effectiveSchedule(plain, 'gsample06a', 'dsample00a'));
});

test('meetingSlots under Early Release empties the periods that do not meet, and keeps the slot itself', () => {
  const project = withSchedules();
  const day = effectiveSchedule(project, 'gsample06a', 'dsample00c');
  const meeting = meetingSlots(project, 'gsample06a', 'dsample00c', 'bsample0er');
  assert.deepEqual(meeting.slice(0, 5), day.slice(0, 5));
  assert.ok(meeting.slice(0, 5).every((slot, p) => slot === day[p]));
  assert.deepEqual(meeting.slice(5), [emptySlot(), emptySlot(), emptySlot()]);
  // the group's own day still holds what it held
  assert.notDeepEqual(day.slice(5), [emptySlot(), emptySlot(), emptySlot()]);
  assert.equal(meetingSlots(project, 'gnobody000', 'dsample00a', 'bsample0er'), null);
  assert.equal(meetingSlots(project, 'gsample06a', 'dnowhere00', 'bsample0er'), null);
});

test('runsOf: each own day type with its regular bells, then each with each bell schedule', () => {
  assert.deepEqual(runsOf(withSchedules()), [
    { dayTypeId: 'dsample00a', bellsId: null },
    { dayTypeId: 'dsample00b', bellsId: null },
    { dayTypeId: 'dsample00a', bellsId: 'bsample0er' },
    { dayTypeId: 'dsample00a', bellsId: 'bsample0as' },
    { dayTypeId: 'dsample00b', bellsId: 'bsample0er' },
    { dayTypeId: 'dsample00b', bellsId: 'bsample0as' },
  ]);
  // no bell schedules: one run per own day type, keyed as a day type was
  assert.deepEqual(runsOf(school()), [{ dayTypeId: 'dsample00a', bellsId: null }, { dayTypeId: 'dsample00b', bellsId: null }]);
  assert.deepEqual(runsOf(emptyProject()), [{ dayTypeId: emptyProject().dayTypes[0].id, bellsId: null }]);
});
