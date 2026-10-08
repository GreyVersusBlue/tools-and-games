import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSchedule, isOwnCopy, effectiveDayType, ownDayTypes, baseDayType, describeDayType, findDayType } from '../../engine/day-types.js';
import { bellsFor } from '../../engine/bells.js';
import { addGroup, setSlot, setBell, makeOwnCopy } from '../../engine/actions.js';
import { emptyProject, school, ctx, group } from './helpers.mjs';

// A school of one room on a corridor, one group, A Day entered, B Day untouched.
function withEmptyBDay() {
  let project = school();
  project.dayTypes[1] = { ...project.dayTypes[1], own: false, bells: project.dayTypes[1].bells.map(() => null) };
  project.groups = project.groups.map((g) => ({ ...g, days: { dsample00a: g.days.dsample00a } }));
  return project;
}

test('the empty B Day: a day type with nothing entered means the same as A Day', () => {
  const project = withEmptyBDay();
  assert.equal(isOwnCopy(project, 'dsample00b'), false);
  for (const g of project.groups) {
    assert.equal(effectiveSchedule(project, g.id, 'dsample00b'), g.days.dsample00a, g.name + ' has A Day\'s very slots on B Day');
  }
  assert.deepEqual(bellsFor(project, 'dsample00b'), bellsFor(project, 'dsample00a'));
  assert.deepEqual(describeDayType(project, 'dsample00b'), { name: 'B Day', own: false, sameAs: 'A Day' });
});

test('the empty B Day follows A Day as A Day is edited', () => {
  let project = withEmptyBDay();
  project = setSlot(project, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: 'rsample302' } }, ctx());
  project = setBell(project, { dayTypeId: 'dsample00a', period: 0, bell: { start: '07:30', end: '08:10' } }, ctx());
  assert.equal(effectiveSchedule(project, 'gsample06a', 'dsample00b')[0].room, 'rsample302');
  assert.equal(bellsFor(project, 'dsample00b')[0].start, '07:30');
});

test('once B Day is its own copy it stops following A Day', () => {
  let project = makeOwnCopy(withEmptyBDay(), { dayTypeId: 'dsample00b' }, ctx());
  assert.equal(isOwnCopy(project, 'dsample00b'), true);
  project = setSlot(project, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period: 0, slot: { room: 'rsample302' } }, ctx());
  assert.equal(effectiveSchedule(project, 'gsample06a', 'dsample00b')[0].room, 'rsample201');
  assert.deepEqual(describeDayType(project, 'dsample00b'), { name: 'B Day', own: true, sameAs: null });
});

test('the first day type is always its own copy, even if its flag said otherwise', () => {
  const project = school();
  project.dayTypes[0].own = false;
  assert.equal(isOwnCopy(project, 'dsample00a'), true);
  assert.equal(effectiveDayType(project, 'dsample00a'), project.dayTypes[0]);
  assert.equal(baseDayType(project), project.dayTypes[0]);
});

test('an own B Day answers with its own slots', () => {
  const project = school();
  assert.equal(effectiveSchedule(project, 'gsample06a', 'dsample00b'), group(project, '6A').days.dsample00b);
  assert.notDeepEqual(effectiveSchedule(project, 'gsample06a', 'dsample00b'), effectiveSchedule(project, 'gsample06a', 'dsample00a'));
});

test('ownDayTypes lists the first and every own copy', () => {
  assert.deepEqual(ownDayTypes(school()).map((d) => d.name), ['A Day', 'B Day']);
  assert.deepEqual(ownDayTypes(withEmptyBDay()).map((d) => d.name), ['A Day']);
  assert.deepEqual(ownDayTypes(emptyProject()).map((d) => d.name), ['A Day']);
});

test('a group or a day type that does not exist gives null, not a guess', () => {
  const project = school();
  assert.equal(effectiveSchedule(project, 'gnobody000', 'dsample00a'), null);
  assert.equal(effectiveSchedule(project, 'gsample06a', 'dnowhere00'), null);
  assert.equal(isOwnCopy(project, 'dnowhere00'), false);
  assert.equal(effectiveDayType(project, 'dnowhere00'), null);
  assert.equal(describeDayType(project, 'dnowhere00'), null);
  assert.equal(findDayType(project, 'dnowhere00'), null);
});

test('a new group in a new project has a full empty day on both day types', () => {
  const project = addGroup(emptyProject(), { name: '7-1' }, ctx());
  const id = project.groups[0].id;
  for (const dayType of project.dayTypes) {
    const day = effectiveSchedule(project, id, dayType.id);
    assert.equal(day.length, 8);
    assert.ok(day.every((slot) => slot.room === null));
  }
});
