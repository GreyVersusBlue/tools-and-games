import test from 'node:test';
import assert from 'node:assert/strict';
import { dayOn, calendarDays, calendarCounts, isCalendarDate, dayNumber, dateOfNumber, addDays, daysBetween, weekdayOf, datesFrom, dateWords } from '../../engine/calendar.js';
import { dayShort, bellsShort } from '../../engine/day-types.js';
import { CALENDAR_DAYS_MOST, defaultWeekdays } from '../../engine/schema.js';
import { validate } from '../../engine/validate.js';
import { repair } from '../../engine/repair.js';
import { makeCalendar, setCalendarDates, deleteDayType, deleteBellSchedule, scheduleOutcome } from '../../engine/actions.js';
import { school, ctx } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const C = 'dsample00c';
const ER = 'bsample0er';

// The sample school with a C Day (the same as A Day, and in no rotation
// unless a case puts it there) and an Early Release bell schedule with
// periods 6 to 8 off.
function project(calendar) {
  const p = school();
  p.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: null, short: '', bells: Array(8).fill(null) });
  p.bellSchedules = [{ id: ER, name: 'Early Release', short: '', bells: p.dayTypes[0].bells.slice(), off: [5, 6, 7] }];
  p.calendar = { weekdays: defaultWeekdays(), rotation: [A, B], dates: [], changedAt: null, ...calendar };
  return p;
}

const weekday = (index, day, bells) => {
  const list = defaultWeekdays();
  list[index] = { day, bells: bells || null };
  return list;
};

// One line per date, as a reader checks it against a wall planner:
//   date        weekday  day type (short; "-" for no school)  bells ("." for regular)  why, "*" when changed by hand  note
function table(p) {
  return calendarDays(p).map((entry) => {
    const dayType = p.dayTypes.find((one) => one.id === entry.dayTypeId);
    const schedule = (p.bellSchedules || []).find((one) => one.id === entry.bellsId);
    const day = entry.school ? dayShort(dayType, p.dayTypes) : '-';
    const bells = schedule ? bellsShort(schedule, p.bellSchedules) : '.';
    return [entry.date, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][entry.weekday], day.padEnd(2), bells.padEnd(2), entry.why + (entry.changed ? '*' : ''), entry.label].join(' ').trimEnd();
  });
}

function rows(text) {
  return text.trim().split('\n').map((line) => line.trim().replace(/\s+/g, ' '));
}

function expectTable(p, text) {
  assert.deepEqual(table(p).map((line) => line.replace(/\s+/g, ' ')), rows(text));
}

// ---------------------------------------------------------------- the walk, by eye

test('two weeks of A and B: the rotation moves on school days, and weekends have no school', () => {
  expectTable(project({ start: '2026-08-31', end: '2026-09-13' }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed A  . rotation
    2026-09-03 Thu B  . rotation
    2026-09-04 Fri A  . rotation
    2026-09-05 Sat -  . weekday
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon B  . rotation
    2026-09-08 Tue A  . rotation
    2026-09-09 Wed B  . rotation
    2026-09-10 Thu A  . rotation
    2026-09-11 Fri B  . rotation
    2026-09-12 Sat -  . weekday
    2026-09-13 Sun -  . weekday
  `);
});

test('a snow day pushes every later day back by one', () => {
  expectTable(project({ start: '2026-08-31', end: '2026-09-07', dates: [{ date: '2026-09-02', day: 'closed', bells: null, label: 'Snow day' }] }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed -  . date* Snow day
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri B  . rotation
    2026-09-05 Sat -  . weekday
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon A  . rotation
  `);
});

test('a re-sync: after a snow day, the next day set to what it would have been keeps the old order from then on', () => {
  // A, B, C: without the snow day Wednesday would be C, Thursday A, Friday B.
  // (With a rotation of two, setting a day to the other day type lands the
  // rotation in the same place whether or not the date moves it, so three
  // are needed to see the rule.)
  expectTable(project({ start: '2026-08-31', end: '2026-09-07', rotation: [A, B, C], dates: [{ date: '2026-09-02', day: 'closed', bells: null, label: 'Snow day' }, { date: '2026-09-03', day: A, bells: null, label: '' }] }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed -  . date* Snow day
    2026-09-03 Thu A  . date*
    2026-09-04 Fri B  . rotation
    2026-09-05 Sat -  . weekday
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon C  . rotation
  `);
  // the same with A and B: the day after the snow day set to B Day
  expectTable(project({ start: '2026-08-31', end: '2026-09-04', dates: [{ date: '2026-09-02', day: 'closed', bells: null, label: 'Snow day' }, { date: '2026-09-03', day: B, bells: null, label: '' }] }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed -  . date* Snow day
    2026-09-03 Thu B  . date*
    2026-09-04 Fri A  . rotation
  `);
});

test('a day type that is not in the rotation, on a date, leaves the rotation where it was', () => {
  expectTable(project({ start: '2026-08-31', end: '2026-09-04', dates: [{ date: '2026-09-02', day: C, bells: null, label: 'Assembly' }] }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed C  . date* Assembly
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri B  . rotation
  `);
});

test('a weekday that is always one day type never moves the rotation, in it or not', () => {
  // Wednesdays always C Day, which is not in the rotation
  expectTable(project({ start: '2026-08-31', end: '2026-09-07', weekdays: weekday(2, C) }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed C  . weekday
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri B  . rotation
    2026-09-05 Sat -  . weekday
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon A  . rotation
  `);
  // Wednesdays always A Day, which is in the rotation: it is still not a step of it
  expectTable(project({ start: '2026-08-31', end: '2026-09-04', weekdays: weekday(2, A) }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed A  . weekday
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri B  . rotation
  `);
});

test('Mondays and Wednesdays A, Tuesdays and Thursdays B, Fridays alternate', () => {
  const weekdays = defaultWeekdays();
  weekdays[0] = { day: A, bells: null };
  weekdays[1] = { day: B, bells: null };
  weekdays[2] = { day: A, bells: null };
  weekdays[3] = { day: B, bells: null };
  expectTable(project({ start: '2026-08-31', end: '2026-09-18', weekdays }), `
    2026-08-31 Mon A  . weekday
    2026-09-01 Tue B  . weekday
    2026-09-02 Wed A  . weekday
    2026-09-03 Thu B  . weekday
    2026-09-04 Fri A  . rotation
    2026-09-05 Sat -  . weekday
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon A  . weekday
    2026-09-08 Tue B  . weekday
    2026-09-09 Wed A  . weekday
    2026-09-10 Thu B  . weekday
    2026-09-11 Fri B  . rotation
    2026-09-12 Sat -  . weekday
    2026-09-13 Sun -  . weekday
    2026-09-14 Mon A  . weekday
    2026-09-15 Tue B  . weekday
    2026-09-16 Wed A  . weekday
    2026-09-17 Thu B  . weekday
    2026-09-18 Fri A  . rotation
  `);
});

test('a day type twice in the rotation, and a date that puts the rotation at its next B', () => {
  expectTable(project({ start: '2026-08-31', end: '2026-09-04', rotation: [A, A, B] }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue A  . rotation
    2026-09-02 Wed B  . rotation
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri A  . rotation
  `);
  // Tuesday set to B: the first B at or after where the rotation stands is
  // its third place, so Wednesday starts it again at the first A
  expectTable(project({ start: '2026-08-31', end: '2026-09-04', rotation: [A, A, B], dates: [{ date: '2026-09-01', day: B, bells: null, label: '' }] }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . date*
    2026-09-02 Wed A  . rotation
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri B  . rotation
  `);
});

test('"next in the rotation" makes a Saturday a make-up day that takes the next one', () => {
  expectTable(project({ start: '2026-09-03', end: '2026-09-07', dates: [{ date: '2026-09-05', day: 'rotation', bells: null, label: 'Make-up day' }] }), `
    2026-09-03 Thu A  . rotation
    2026-09-04 Fri B  . rotation
    2026-09-05 Sat A  . rotation* Make-up day
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon B  . rotation
  `);
});

test('bells: from a weekday, from a date, and a date back to the regular bells', () => {
  expectTable(project({
    start: '2026-08-31',
    end: '2026-09-09',
    weekdays: weekday(2, 'rotation', ER),
    dates: [
      { date: '2026-09-01', day: 'rotation', bells: ER, label: 'Conferences' },
      { date: '2026-09-09', day: 'rotation', bells: 'regular', label: '' },
    ],
  }), `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  ER rotation* Conferences
    2026-09-02 Wed A  ER rotation
    2026-09-03 Thu B  . rotation
    2026-09-04 Fri A  . rotation
    2026-09-05 Sat -  . weekday
    2026-09-06 Sun -  . weekday
    2026-09-07 Mon B  . rotation
    2026-09-08 Tue A  . rotation
    2026-09-09 Wed B  . rotation*
  `);
  // a date with no school rings no bells, whatever its weekday says
  const closed = project({ start: '2026-09-02', end: '2026-09-02', weekdays: weekday(2, 'rotation', ER), dates: [{ date: '2026-09-02', day: 'closed', bells: null, label: '' }] });
  assert.deepEqual(dayOn(closed, '2026-09-02'), { known: true, school: false, dayTypeId: null, bellsId: null, why: 'date', label: '', changed: true });
});

test('a leap day is a day like any other', () => {
  expectTable(project({ start: '2028-02-28', end: '2028-03-01' }), `
    2028-02-28 Mon A  . rotation
    2028-02-29 Tue B  . rotation
    2028-03-01 Wed A  . rotation
  `);
});

// ---------------------------------------------------------------- dayOn

test('dayOn: no calendar, outside the range, the range\'s own ends', () => {
  const none = school();
  assert.deepEqual(dayOn(none, '2026-09-01'), { known: false, why: 'none' });
  none.calendar = null;
  assert.deepEqual(dayOn(none, '2026-09-01'), { known: false, why: 'none' });
  none.calendar = 'a calendar';
  assert.deepEqual(dayOn(none, '2026-09-01'), { known: false, why: 'none' });
  const p = project({ start: '2026-08-31', end: '2026-09-04' });
  assert.deepEqual(dayOn(p, '2026-08-30'), { known: false, why: 'outside' });
  assert.deepEqual(dayOn(p, '2026-09-05'), { known: false, why: 'outside' });
  assert.deepEqual(dayOn(p, 'tomorrow'), { known: false, why: 'outside' });
  assert.deepEqual(dayOn(p, '2026-08-31'), { known: true, school: true, dayTypeId: A, bellsId: null, why: 'rotation', label: '', changed: false });
  assert.deepEqual(dayOn(p, '2026-09-04'), { known: true, school: true, dayTypeId: A, bellsId: null, why: 'rotation', label: '', changed: false });
  assert.deepEqual(calendarDays(school()), []);
});

test('the 731-day limit: 731 days walk, 732 are refused by validate, cut by repair, and read as no calendar', () => {
  const most = project({ start: '2026-08-01', end: addDays('2026-08-01', CALENDAR_DAYS_MOST - 1) });
  assert.equal(calendarDays(most).length, 731);
  assert.deepEqual(validate(most), []);
  const over = project({ start: '2026-08-01', end: addDays('2026-08-01', CALENDAR_DAYS_MOST) });
  assert.deepEqual(validate(over).map((finding) => finding.path), ['calendar.end']);
  assert.deepEqual(dayOn(over, '2026-08-03'), { known: false, why: 'none' });
  const repaired = repair(over);
  assert.equal(repaired.project.calendar.end, most.calendar.end);
  assert.deepEqual(repaired.notes, ['The calendar covered 732 days, and covers at most 731; it now ends on 31 July 2028.']);
});

test('calendarDays is worked out once per calendar, day types and bell schedules', () => {
  const p = project({ start: '2026-08-31', end: '2027-06-11' });
  assert.equal(calendarDays(p), calendarDays(p));
  assert.notEqual(calendarDays({ ...p, dayTypes: p.dayTypes.slice() }), calendarDays(p));
  assert.notEqual(calendarDays({ ...p, bellSchedules: p.bellSchedules.slice() }), calendarDays(p));
  assert.equal(calendarDays(p).length, 285);
});

test('calendarCounts: school days per day type and per bell schedule', () => {
  const p = project({ start: '2026-08-31', end: '2026-09-13', weekdays: weekday(2, 'rotation', ER), dates: [{ date: '2026-09-07', day: 'closed', bells: null, label: 'Labor Day' }] });
  assert.deepEqual(calendarCounts(p), {
    days: 14,
    schoolDays: 9,
    closed: 5,
    dayTypes: [{ dayTypeId: A, count: 5 }, { dayTypeId: B, count: 4 }, { dayTypeId: C, count: 0 }],
    bells: [{ bellsId: null, count: 7 }, { bellsId: ER, count: 2 }],
  });
  assert.deepEqual(calendarCounts(school()), { days: 0, schoolDays: 0, closed: 0, dayTypes: [{ dayTypeId: A, count: 0 }, { dayTypeId: B, count: 0 }], bells: [{ bellsId: null, count: 0 }] });
});

// ---------------------------------------------------------------- breaks and deletions

test('a break writes "No school" only on school days, and counts them', () => {
  const p = project({});
  delete p.calendar;
  const made = makeCalendar(p, { start: '2026-08-31', end: '2027-06-11', breaks: [{ from: '2026-12-21', to: '2027-01-01', label: 'Winter break' }, { from: '2026-11-26', label: 'Thanksgiving' }] }, ctx());
  assert.deepEqual(scheduleOutcome(made).breaks, [
    { from: '2026-12-21', to: '2027-01-01', label: 'Winter break', schoolDays: 10 },
    { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', schoolDays: 1 },
  ]);
  assert.equal(scheduleOutcome(made).text, 'Winter break: 10 school days; Thanksgiving: 1 school day');
  // the weekend inside the break is no school by its weekday, not by the break
  assert.equal(made.calendar.dates.length, 11);
  assert.equal(dayOn(made, '2026-12-26').why, 'weekday');
  assert.deepEqual([dayOn(made, '2026-12-21').label, dayOn(made, '2026-12-21').school], ['Winter break', false]);
  assert.equal(made.calendar.changedAt, '2026-09-01T12:00:00.000Z');
  assert.deepEqual(validate(made), []);
  // a run over a weekend through the date dialog counts its school days the same way
  const snow = setCalendarDates(made, { dates: { from: '2027-02-05', to: '2027-02-08' }, day: 'closed', label: 'Snow' }, ctx());
  assert.deepEqual([scheduleOutcome(snow).schoolDays, scheduleOutcome(snow).skipped], [2, 2]);
});

test('deleting a day type takes it out of the rotation, its dated changes and its weekdays', () => {
  const p = project({ start: '2026-08-31', end: '2026-09-11', rotation: [A, C, B], weekdays: weekday(4, C), dates: [{ date: '2026-09-02', day: C, bells: null, label: 'Assembly' }, { date: '2026-09-03', day: 'closed', bells: null, label: 'Snow' }] });
  const after = deleteDayType(p, { dayTypeId: C }, ctx());
  assert.deepEqual(after.calendar.rotation, [A, B]);
  assert.deepEqual(after.calendar.dates, [{ date: '2026-09-03', day: 'closed', bells: null, label: 'Snow' }]);
  assert.equal(after.calendar.weekdays[4].day, 'rotation');
  assert.deepEqual(validate(after), []);
  // a rotation left empty becomes the first day type
  const alone = deleteDayType(project({ start: '2026-08-31', end: '2026-09-04', rotation: [C] }), { dayTypeId: C }, ctx());
  assert.deepEqual(alone.calendar.rotation, [A]);
});

test('deleting a bell schedule rings the regular bells wherever the calendar named it', () => {
  const p = project({ start: '2026-08-31', end: '2026-09-11', weekdays: weekday(2, 'rotation', ER), dates: [{ date: '2026-09-01', day: B, bells: ER, label: '' }, { date: '2026-09-08', day: 'rotation', bells: ER, label: '' }] });
  const after = deleteBellSchedule(p, { bellScheduleId: ER }, ctx());
  assert.equal(after.calendar.weekdays[2].bells, null);
  // a change left saying nothing its weekday does not is taken out, as repair would
  assert.deepEqual(after.calendar.dates, [{ date: '2026-09-01', day: B, bells: null, label: '' }]);
  assert.equal(scheduleOutcome(after).text, 'Deleted Early Release, used on Wednesdays and 2 dates in the calendar');
  assert.deepEqual(validate(after), []);
});

test('a calendar the staff browser holds unrepaired: what names something gone reads as not there', () => {
  const p = project({
    start: '2026-08-31',
    end: '2026-09-04',
    rotation: [A, 'dgone00000', B],
    weekdays: weekday(4, 'dgone00000', 'bgone00000'),
    dates: [{ date: '2026-09-01', day: 'dgone00000', bells: null, label: 'gone' }, { date: '2026-09-02', day: 'rotation', bells: 'bgone00000', label: '' }],
  });
  expectTable(p, `
    2026-08-31 Mon A  . rotation
    2026-09-01 Tue B  . rotation
    2026-09-02 Wed A  . rotation*
    2026-09-03 Thu B  . rotation
    2026-09-04 Fri A  . rotation
  `);
});

// ---------------------------------------------------------------- dates

test('dates: real ones only, whole days from 1970, Monday 0', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2027-02-29'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('2026-9-1'), false);
  assert.equal(isCalendarDate('2026-09-01T00:00:00Z'), false);
  assert.equal(isCalendarDate(20260901), false);
  assert.equal(dayNumber('1970-01-01'), 0);
  assert.equal(dayNumber('1969-12-31'), -1);
  for (const date of ['1970-01-01', '2000-02-29', '2026-10-26', '2100-03-01', '1600-03-01']) assert.equal(dateOfNumber(dayNumber(date)), date);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(daysBetween('2026-08-31', '2027-06-11'), 284);
  assert.deepEqual(['2026-08-31', '2026-09-05', '2026-09-06', '1970-01-01'].map(weekdayOf), [0, 5, 6, 3]);
  assert.deepEqual(datesFrom('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(datesFrom('2026-12-30', '2026-12-29'), []);
  assert.equal(dateWords('2026-11-26'), '26 November 2026');
  assert.equal(dateWords('2026-11-26', { weekday: true, year: false }), 'Thursday 26 November');
});
