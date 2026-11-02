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
  assert.deepEqual(describeDayType(project, 'dsample00b'), { name: 'B Day', own: false, sameAs: 'A Day', follows: 'A Day' });
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
  assert.deepEqual(describeDayType(project, 'dsample00b'), { name: 'B Day', own: true, sameAs: null, follows: null });
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

// ---------------------------------------------------------------- ARCHITECTURE 17.2: any number of day types

import { dayShort, bellsShort, followersOf } from '../../engine/day-types.js';
import { addDayType, renameDayType, setDayTypeKind, setDayTypeShort, copyDay } from '../../engine/actions.js';
import { DAY_TYPES_MOST } from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';

// The sample school (A Day and B Day, both their own) with C Day the same as
// B Day and D Day the same as A Day.
function fourDays() {
  const project = school();
  project.dayTypes.push({ id: 'dsample00c', name: 'C Day', own: false, sameAs: 'dsample00b', short: '', bells: Array(8).fill(null) });
  project.dayTypes.push({ id: 'dsample00d', name: 'D Day', own: false, short: '', bells: Array(8).fill(null) });
  return project;
}

test('sameAs to a day type that is not the first: C Day has B Day\'s classes and bells', () => {
  const project = fourDays();
  assert.deepEqual(validate(project), []);
  assert.equal(effectiveDayType(project, 'dsample00c').id, 'dsample00b');
  for (const g of project.groups) assert.equal(effectiveSchedule(project, g.id, 'dsample00c'), g.days.dsample00b, g.name);
  assert.deepEqual(bellsFor(project, 'dsample00c'), bellsFor(project, 'dsample00b'));
  assert.deepEqual(describeDayType(project, 'dsample00c'), { name: 'C Day', own: false, sameAs: 'B Day', follows: 'B Day' });
  // sameAs absent is the first day type, as it always was
  assert.equal(effectiveDayType(project, 'dsample00d').id, 'dsample00a');
  assert.deepEqual(describeDayType(project, 'dsample00d'), { name: 'D Day', own: false, sameAs: 'A Day', follows: 'A Day' });
  assert.deepEqual(followersOf(project, 'dsample00b').map((d) => d.name), ['C Day']);
  assert.deepEqual(followersOf(project, 'dsample00a').map((d) => d.name), ['D Day']);
});

test('sameAs one hop only: naming a day type that is itself the same as another, or itself, or nothing, is the first day type', () => {
  for (const sameAs of ['dsample00d', 'dsample00c', 'dnowhere00', 42, '']) {
    const project = fourDays();
    project.dayTypes[2].sameAs = sameAs;
    assert.equal(effectiveDayType(project, 'dsample00c').id, 'dsample00a', String(sameAs));
    assert.equal(describeDayType(project, 'dsample00c').follows, 'A Day');
  }
});

test('making B Day the same as A Day takes C Day with it, in one step', () => {
  const project = setDayTypeKind(fourDays(), { dayTypeId: 'dsample00b', own: false }, ctx());
  assert.equal(project.dayTypes[1].own, false);
  assert.equal(project.dayTypes[2].sameAs, null);
  assert.equal(effectiveDayType(project, 'dsample00c').id, 'dsample00a');
  assert.ok(project.groups.every((g) => !('dsample00b' in g.days)));
  assert.deepEqual(validate(project), []);
});

test('making C Day its own copy starts it as a copy of B Day, the day it was the same as', () => {
  const before = fourDays();
  const project = setDayTypeKind(before, { dayTypeId: 'dsample00c', own: true }, ctx());
  assert.equal(isOwnCopy(project, 'dsample00c'), true);
  for (const g of project.groups) assert.deepEqual(g.days.dsample00c, before.groups.find((one) => one.id === g.id).days.dsample00b, g.name);
  assert.deepEqual(project.dayTypes[2].bells, before.dayTypes[1].bells);
  assert.deepEqual(validate(project), []);
});

test('copyDay onto a day type that is already the same as the source changes nothing; onto one that follows another, it is refused', () => {
  const project = fourDays();
  assert.equal(copyDay(project, { fromDayTypeId: 'dsample00b', toDayTypeId: 'dsample00c' }, ctx()), project);
  assert.equal(copyDay(project, { fromDayTypeId: 'dsample00c', toDayTypeId: 'dsample00c' }, ctx()), project);
  assert.throws(() => copyDay(project, { fromDayTypeId: 'dsample00a', toDayTypeId: 'dsample00c' }, ctx()), { code: 'same-as-base', message: 'C Day is the same as B Day. Make it its own copy to change it.' });
  // from a follower is from what it follows
  const copied = copyDay(project, { fromDayTypeId: 'dsample00c', toDayTypeId: 'dsample00a' }, ctx());
  for (const g of copied.groups) assert.deepEqual(g.days.dsample00a, g.days.dsample00b, g.name);
});

test('dayShort: "A Day" is A, initials otherwise, and every one unique among the day types', () => {
  const project = fourDays();
  assert.deepEqual(project.dayTypes.map((d) => dayShort(d, project.dayTypes)), ['A', 'B', 'C', 'D']);
  const names = ['A Day', 'a day', 'Half Day', 'Early Release', 'Testing', 'Testing Day Two', 'T', 'Τρίτη Ημέρα'];
  const list = names.map((name, i) => ({ id: 'd' + i, name, short: '' }));
  const shorts = list.map((d) => dayShort(d, list));
  assert.deepEqual(shorts, ['A', 'ad', 'HD', 'ER', 'T', 'TDT', 'T2', 'ΤΗ']);
  assert.equal(new Set(shorts.map((one) => one.toLowerCase())).size, shorts.length);
  assert.ok(shorts.every((one) => Array.from(one).length <= 4));
  // a typed short is kept as typed, and the worked-out ones go round it
  const typed = [{ id: 'd1', name: 'Assembly', short: '' }, { id: 'd2', name: 'Advisory', short: 'A' }];
  assert.deepEqual(typed.map((d) => dayShort(d, typed)), ['As', 'A']);
  assert.equal(bellsShort({ name: 'Early Release', short: '' }, [{ name: 'Early Release', short: '' }]), 'ER');
  // the same list gives the same answers, worked out once
  assert.equal(dayShort(list[1], list), 'ad');
});

test('twelve day types, and no thirteenth', () => {
  let project = school();
  for (let n = 3; n <= DAY_TYPES_MOST; n += 1) project = addDayType(project, { name: 'Day ' + n }, ctx(n));
  assert.equal(project.dayTypes.length, 12);
  assert.deepEqual(validate(project), []);
  const shorts = project.dayTypes.map((d) => dayShort(d, project.dayTypes));
  assert.equal(new Set(shorts).size, 12);
  assert.throws(() => addDayType(project, { name: 'Day 13' }, ctx()), { code: 'limit', message: 'A project has at most 12 day types, and this one has 12. Delete one to add another.' });
});

test('duplicate names: refused when added or renamed, ignoring case and spaces; an older file with two is still valid and left as it is', () => {
  const project = fourDays();
  assert.throws(() => addDayType(project, { name: 'b  day' }, ctx()), { code: 'duplicate-name' });
  assert.throws(() => renameDayType(project, { dayTypeId: 'dsample00c', name: 'BDay' }, ctx()), { code: 'duplicate-name', message: 'There is already a day type called "B Day". Day type names are unique, whatever the capitals and spaces; type a different name.' });
  assert.throws(() => renameDayType(project, { dayTypeId: 'dsample00c', name: 'x'.repeat(41) }, ctx()), { code: 'too-long' });
  assert.equal(renameDayType(project, { dayTypeId: 'dsample00c', name: 'x'.repeat(40) }, ctx()).dayTypes[2].name.length, 40);
  const old = school();
  old.dayTypes[1].name = 'A Day';
  assert.deepEqual(validate(old), []);
  // leaving the field as it was is no change, not a refusal
  assert.equal(renameDayType(old, { dayTypeId: 'dsample00b', name: 'A Day' }, ctx()), old);
  assert.throws(() => setDayTypeShort(project, { dayTypeId: 'dsample00c', short: 'abcde' }, ctx()), { code: 'too-long' });
});
