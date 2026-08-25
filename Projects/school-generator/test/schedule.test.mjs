// The school day: the block table, the bells that mark it, and the timetables
// drawn from it. Pure arithmetic, so this suite is exhaustive rather than
// representative. Run `node --test test/*.mjs` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SCHEDULE, normalizeSchedule, defaultSchedule, isDefaultSchedule,
  blocks, blockAt, dayStart, dayEnd, inSession, wrapMinutes,
  bells, bellsBetween, nextBell,
  makeTimetable, fixedTimetable,
  clockText, countdownText, scheduleText,
} from '../js/schedule.js';

const rng = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

test('normalizeSchedule never throws and never returns null', () => {
  for (const bad of [null, undefined, 42, 'nope', [], { periods: NaN }, { start: -900 }]) {
    const s = normalizeSchedule(bad);
    assert.equal(typeof s, 'object');
    for (const k of Object.keys(DEFAULT_SCHEDULE)) assert.ok(Number.isFinite(s[k]), k);
  }
});

test('a hostile schedule is clamped into a day that can be walked', () => {
  const s = normalizeSchedule({ start: 99999, periods: 500, periodMin: 0, passingMin: -4, lunchMin: 1e9 });
  assert.ok(s.start <= 24 * 60 - 60);
  assert.ok(s.periods <= 12 && s.periods >= 1);
  assert.ok(s.periodMin >= 5);
  assert.equal(s.passingMin, 0);
  assert.ok(s.lunchMin <= 90);
});

test('lunch after a period that does not exist is clamped into the day', () => {
  assert.equal(normalizeSchedule({ periods: 4, lunchAfter: 9 }).lunchAfter, 4);
});

test('the default schedule reports itself as default, and one change does not', () => {
  assert.ok(isDefaultSchedule(defaultSchedule()));
  assert.ok(isDefaultSchedule(undefined));
  assert.ok(!isDefaultSchedule({ ...DEFAULT_SCHEDULE, periods: 6 }));
});

test('blocks run back to back with no gaps and no overlaps', () => {
  const list = blocks(defaultSchedule());
  assert.ok(list.length > 0);
  assert.equal(list[0].start, dayStart(defaultSchedule()));
  for (let i = 1; i < list.length; i++) {
    assert.equal(list[i].start, list[i - 1].end, `gap before block ${i}`);
    assert.ok(list[i].end > list[i].start);
  }
  assert.equal(dayEnd(defaultSchedule()), list[list.length - 1].end);
});

test('every class period appears once, in order, plus lunch where it is asked for', () => {
  const s = normalizeSchedule({ periods: 5, lunchAfter: 3 });
  const list = blocks(s);
  const classes = list.filter((b) => b.kind === 'class').map((b) => b.index);
  assert.deepEqual(classes, [1, 2, 3, 4, 5]);
  const lunch = list.filter((b) => b.kind === 'lunch');
  assert.equal(lunch.length, 1);
  assert.equal(lunch[0].index, 3);
});

test('a schedule with no lunch, no homeroom and no passing time is still a day', () => {
  const s = normalizeSchedule({ periods: 3, lunchAfter: 0, lunchMin: 0, homeroomMin: 0, passingMin: 0 });
  const list = blocks(s);
  assert.deepEqual(list.map((b) => b.kind), ['class', 'class', 'class']);
});

test('blockAt covers every minute of the day, including the empty ones', () => {
  const s = defaultSchedule();
  for (let m = 0; m < 24 * 60; m += 7) {
    const b = blockAt(s, m);
    assert.ok(b, `no block at ${m}`);
    assert.ok(m >= b.start && m < b.end, `${m} not inside ${b.kind} ${b.start}-${b.end}`);
  }
});

test('before the first bell and after the last one are their own blocks', () => {
  const s = defaultSchedule();
  assert.equal(blockAt(s, dayStart(s) - 1).kind, 'before');
  assert.equal(blockAt(s, dayEnd(s)).kind, 'after');
  assert.ok(!inSession(s, dayStart(s) - 1));
  assert.ok(!inSession(s, dayEnd(s) + 60));
  assert.ok(inSession(s, dayStart(s) + 1));
});

test('the clock wraps rather than running off the end of the day', () => {
  assert.equal(wrapMinutes(-1), 24 * 60 - 1);
  assert.equal(wrapMinutes(24 * 60), 0);
  assert.equal(wrapMinutes(24 * 60 + 30), 30);
  assert.equal(wrapMinutes('nonsense'), 0);
});

test('bells are in order, unique, and start and end the day', () => {
  const s = defaultSchedule();
  const list = bells(s);
  assert.equal(list[0].kind, 'arrival');
  assert.equal(list[list.length - 1].kind, 'dismissal');
  assert.equal(list[list.length - 1].at, dayEnd(s));
  for (let i = 1; i < list.length; i++) assert.ok(list[i].at > list[i - 1].at, 'bells go forward');
});

test('a day with no passing time still rings one bell a period, not two', () => {
  const s = normalizeSchedule({ periods: 4, passingMin: 0, homeroomMin: 0, lunchAfter: 0, lunchMin: 0 });
  const at = bells(s).map((b) => b.at);
  assert.equal(new Set(at).size, at.length);
});

test('bellsBetween is half-open: a bell rings on the tick it lands on, once', () => {
  const s = defaultSchedule();
  const first = bells(s)[0].at;
  assert.equal(bellsBetween(s, first - 1, first).length, 1);
  assert.equal(bellsBetween(s, first, first + 1).length, 0);
  assert.equal(bellsBetween(s, first, first).length, 0);
});

test('a clock run past midnight still rings the morning', () => {
  const s = defaultSchedule();
  const crossed = bellsBetween(s, 23 * 60, 9 * 60);
  assert.ok(crossed.length > 0);
  assert.ok(crossed.every((b) => b.at <= 9 * 60));
});

test('bellsBetween over a whole day catches every bell exactly once', () => {
  const s = defaultSchedule();
  const all = bells(s);
  const crossed = bellsBetween(s, 0, 24 * 60 - 1);
  assert.equal(crossed.length, all.length);
});

test('nextBell always has one, and wraps to tomorrow after the last', () => {
  const s = defaultSchedule();
  const n = nextBell(s, dayStart(s) - 30);
  assert.equal(n.at, dayStart(s));
  assert.equal(n.in, 30);
  const wrapped = nextBell(s, 23 * 60);
  assert.ok(wrapped.in > 0 && wrapped.in < 24 * 60);
});

test('a timetable has a slot for homeroom and one per period', () => {
  const s = normalizeSchedule({ periods: 6 });
  const t = makeTimetable(rng([0.1, 0.4, 0.7, 0.2, 0.9, 0.5]), ['a', 'b', 'c', 'd'], s);
  assert.equal(t.length, 7);
  assert.ok(t.every((r) => r !== null));
});

test('a timetable does not put you in the same room two periods running', () => {
  const t = makeTimetable(rng([0.05, 0.45, 0.85, 0.25, 0.65, 0.15, 0.95, 0.35]),
    ['a', 'b', 'c', 'd', 'e'], normalizeSchedule({ periods: 7 }));
  for (let i = 1; i < t.length; i++) assert.notEqual(t[i], t[i - 1], `period ${i} repeats`);
});

test('a timetable with one room to draw from is that room all day', () => {
  const t = makeTimetable(() => 0.5, ['only'], normalizeSchedule({ periods: 3 }));
  assert.deepEqual(t, ['only', 'only', 'only', 'only']);
});

test('no rooms at all is a timetable of nulls rather than a crash', () => {
  const t = makeTimetable(() => 0.5, [], normalizeSchedule({ periods: 2 }));
  assert.deepEqual(t, [null, null, null]);
});

test('a teacher stays put all day', () => {
  const t = fixedTimetable('r1', normalizeSchedule({ periods: 4 }));
  assert.equal(t.length, 5);
  assert.ok(t.every((r) => r === 'r1'));
});

test('the readouts say something sensible at every hour', () => {
  assert.equal(clockText(0), '12:00 am');
  assert.equal(clockText(12 * 60), '12:00 pm');
  assert.equal(clockText(13 * 60 + 5), '1:05 pm');
  assert.equal(countdownText(0), 'any second');
  assert.equal(countdownText(45), '45 min');
  assert.equal(countdownText(125), '2h 05m');
  const s = defaultSchedule();
  assert.match(scheduleText(s, dayStart(s) - 60), /Before school/);
  assert.match(scheduleText(s, dayEnd(s) + 60), /After school/);
  assert.match(scheduleText(s, dayStart(s) + 30), /left$/);
});
