// The calendar on paper (ui/prints/calendar.js) and the words the Calendar
// tab and the print share (ui/schedule/calendar/model.js), in plain Node,
// read as strings. The calendar is the sample school's with a winter break,
// Thanksgiving, Wednesdays on Early Release bells, a snow day and a Saturday
// make-up day, all through the engine's own actions.
//
//   node test/engine/prints-calendar.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as calendarPrint from '../../ui/prints/calendar.js';
import { OUTPUTS, outputFor, printButtons } from '../../ui/prints/index.js';
import { makeCalendar, setCalendarDates, addBellSchedule, renameDayType, removeCalendar, scheduleOutcome } from '../../engine/actions.js';
import { calendarDays } from '../../engine/calendar.js';
import { DAY_CLOSED, DAY_ROTATION, BELLS_REGULAR } from '../../engine/schema.js';
import {
  dateName, summaryWords, whyWords, dayEntry, breaksOf, runWords, changeWords, doneWords, movedWords, monthsOf, firstDayOf, closedWord, todayOf, changeOn,
} from '../../ui/schedule/calendar/model.js';
import { school, ctx, PINNED } from './helpers.mjs';

const NOW = { now: PINNED };
const LANDSCAPE = { paper: { size: 'letter', orientation: 'landscape' } };
const PORTRAIT = { paper: { size: 'a4', orientation: 'portrait' } };

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// The sample school with a calendar: 31 August 2026 to 11 June 2027, A and
// B in the rotation, Wednesdays on Early Release bells, a winter break and
// Thanksgiving.
function withCalendar() {
  let p = school();
  p = addBellSchedule(p, { name: 'Early Release' }, ctx());
  const early = p.bellSchedules[0].id;
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((w) => ({ day: w < 5 ? DAY_ROTATION : DAY_CLOSED, bells: w === 2 ? early : null }));
  p = makeCalendar(p, { start: '2026-08-31', end: '2027-06-11', weekdays, breaks: [{ from: '2026-12-21', to: '2027-01-01', label: 'Winter break' }, { from: '2026-11-26', label: 'Thanksgiving' }] }, ctx());
  return { p, early };
}

// The button is the calendar panel's own (ui/schedule/calendar/panel.js),
// not an entry of printButtons, whose screens are pinned in prints.test.mjs.
test('the calendar print is an output the preview can find', () => {
  assert.ok(OUTPUTS.includes(calendarPrint));
  assert.equal(outputFor('calendar'), calendarPrint);
  assert.equal(printButtons.some((entry) => entry.output === 'calendar'), false);
});

test('with no calendar the print says where to make one', () => {
  const { html } = calendarPrint.render(school(), null, NOW);
  assert.match(html, /This project has no calendar yet\. Make one under Schedule › Calendar\./);
});

test('one sheet of months: 4 across on a landscape sheet, 3 upright; every month of the range, in order', () => {
  const { p } = withCalendar();
  const wide = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE });
  const tall = calendarPrint.render(p, null, { ...NOW, ...PORTRAIT });
  assert.equal(wide.title, 'Calendar · ' + p.settings.schoolName);
  assert.match(wide.html, /class="cal-print cal-print--wide"/);
  assert.match(tall.html, /class="cal-print cal-print--tall"/);
  const months = Array.from(wide.html.matchAll(/<section class="cal-print__month"><h2>([^<]+)<\/h2>/g)).map((match) => match[1]);
  assert.deepEqual(months, ['August 2026', 'September 2026', 'October 2026', 'November 2026', 'December 2026', 'January 2027', 'February 2027', 'March 2027', 'April 2027', 'May 2027', 'June 2027']);
  assert.equal(countOf(wide.html, '<section class="page">'), 1, 'eleven months are one sheet');
  assert.match(wide.html, /<p class="cal-print__summary">\d+ school days from 31 August 2026 to 11 June 2027\.<\/p>/);
});

test('every date with no school prints a word in its square, so the sheet reads without backgrounds', () => {
  const { p } = withCalendar();
  const { html } = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE });
  const closed = calendarDays(p).filter((day) => !day.school);
  assert.equal(countOf(html, '<td class="is-closed">'), closed.length);
  // a closed square's word: "No", or its note's first word
  assert.equal(countOf(html, '<span class="cal-print__t">Winter</span>'), closed.filter((day) => day.label === 'Winter break').length);
  assert.equal(countOf(html, '<span class="cal-print__t">Thanksgiving</span>'), 1);
  assert.equal(closedWord({ label: '' }), 'No');
  assert.equal(closedWord({ label: '  Snow   day' }), 'Snow');
});

test('the key names the day types and bell schedules in use, no school and the hand-change mark; the squares carry the short names', () => {
  const { p } = withCalendar();
  const { html } = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE });
  const key = html.slice(html.indexOf('<ul class="cal-print__key"'), html.indexOf('</ul>', html.indexOf('<ul class="cal-print__key"')));
  assert.deepEqual(Array.from(key.matchAll(/<\/span>([^<]+)<\/li>/g)).map((match) => match[1]), ['A Day', 'B Day', 'Early Release bells', 'No school', 'Changed by hand']);
  const wednesdays = calendarDays(p).filter((day) => day.school && day.weekday === 2).length;
  assert.equal(countOf(html, '<span class="cal-print__b">ER</span>'), wednesdays, 'every school Wednesday says ER under its day type');
  assert.equal(countOf(html, '<span class="cal-print__mark"></span>'), calendarDays(p).filter((day) => day.changed).length + 1, 'a mark on every date changed by hand, and one in the key');
});

test('nothing of the screen reaches paper: no today ring, no selection, no focus stop', () => {
  const { p } = withCalendar();
  const { html } = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE });
  assert.doesNotMatch(html, /aria-current|aria-selected|tabindex/);
  assert.match(html, /data-theme="light"/);
  assert.match(html, /print-color-adjust: exact/);
});

test('a two-year calendar is three sheets of at most twelve months, each headed with its months', () => {
  let p = school();
  // the longest calendar there is, 731 days, touches 25 months
  p = makeCalendar(p, { start: '2026-06-30', end: '2028-06-29' }, ctx());
  const { html } = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE });
  assert.equal(countOf(html, '<section class="page">'), 3);
  assert.equal(countOf(html, '<section class="cal-print__month">'), 25);
  assert.deepEqual(Array.from(html.matchAll(/<h1 class="doc-head__what">([^<]+)<\/h1>/g)).map((match) => match[1]), ['Calendar, June 2026 to May 2027', 'Calendar, June 2027 to May 2028', 'Calendar, June 2028']);
  // 24 months are two sheets, not three with an empty one
  const two = calendarPrint.render(makeCalendar(school(), { start: '2026-07-01', end: '2028-06-30' }, ctx()), null, { ...NOW, ...LANDSCAPE }).html;
  assert.equal(countOf(two, '<section class="page">'), 2);
});

test('weeks start on the day asked, Sunday when none is: the headers and the first week follow', () => {
  const { p } = withCalendar();
  const sunday = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE }).html;
  const monday = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE, firstDay: 0 }).html;
  const heads = (html) => Array.from(html.slice(0, html.indexOf('</thead>')).matchAll(/<th scope="col" title="(\w+)">/g)).map((match) => match[1]);
  assert.deepEqual(heads(sunday), ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  assert.deepEqual(heads(monday), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  // August 2026 begins on a Saturday
  assert.deepEqual(monthsOf('2026-08-31', '2026-08-31', 6)[0].weeks[0], [null, null, null, null, null, null, '2026-08-01']);
  assert.deepEqual(monthsOf('2026-08-31', '2026-08-31', 0)[0].weeks[0], [null, null, null, null, null, '2026-08-01', '2026-08-02']);
  assert.equal(monthsOf('2026-08-31', '2027-06-11', 6).length, 11);
  assert.equal(firstDayOf('en-GB'), 0, 'a British week starts on Monday');
  assert.equal(firstDayOf('not a locale at all'), 6, 'no week information: Sunday');
});

test('every name a user typed prints as typed and is never markup', () => {
  let { p } = withCalendar();
  const hostile = '<b>"C&D"</b>';
  p = renameDayType(p, { dayTypeId: p.dayTypes[0].id, name: hostile }, ctx());
  p = setCalendarDates(p, { dates: ['2026-10-14'], day: DAY_CLOSED, label: '<script>x</script>' }, ctx());
  const { html } = calendarPrint.render(p, null, { ...NOW, ...LANDSCAPE });
  assert.doesNotMatch(html, /<script>x|<b>"C/);
  assert.match(html, /&lt;b&gt;&quot;C&amp;D&quot;&lt;\/b&gt;/);
  assert.match(html, /<span class="cal-print__t">&lt;script&gt;x&lt;\/script&gt;<\/span>/);
});

test('a date’s name is the whole sentence: day type, bells, note, changed by hand, today', () => {
  let { p, early } = withCalendar();
  assert.equal(dateName(p, '2026-11-26', ''), 'Thursday 26 November 2026: no school, Thanksgiving. Changed by hand.');
  assert.equal(dateName(p, '2026-09-02', '2026-09-02'), 'Wednesday 2 September 2026: A Day with Early Release bells. Today.');
  assert.equal(dateName(p, '2026-08-31', ''), 'Monday 31 August 2026: A Day.');
  assert.equal(dateName(p, '2026-09-05', ''), 'Saturday 5 September 2026: no school.');
  assert.equal(dateName(p, '2027-06-14', ''), 'Monday 14 June 2027: not in the calendar.');
  p = setCalendarDates(p, { dates: ['2026-09-03'], bells: early, label: 'Conferences' }, ctx());
  assert.equal(dateName(p, '2026-09-03', ''), 'Thursday 3 September 2026: B Day with Early Release bells, Conferences. Changed by hand.');
  assert.ok(early);
});

test('a change of bells or a note alone leaves the day to the weekday (day null) and moves nothing later', () => {
  let { p, early } = withCalendar();
  const before = calendarDays(p).map((day) => day.dayTypeId);
  p = setCalendarDates(p, { dates: ['2026-09-03'], bells: early }, ctx());
  assert.deepEqual(changeOn(p, '2026-09-03'), { date: '2026-09-03', day: null, bells: early, label: '' });
  assert.deepEqual(calendarDays(p).map((day) => day.dayTypeId), before, 'no date’s day type moved');
  assert.equal(scheduleOutcome(p).movedFrom, null);
  assert.equal(whyWords(p, dayEntry(p, '2026-09-03')), 'rotation; changed by hand');
  // the same change named in the dialog's words
  assert.equal(changeWords(p, ['2026-09-03'], { bells: BELLS_REGULAR }), 'Set 3 September to Regular bells');
});

test('why a date is what it is, in words the list shows', () => {
  let { p } = withCalendar();
  assert.equal(whyWords(p, dayEntry(p, '2026-08-31')), 'rotation');
  assert.equal(whyWords(p, dayEntry(p, '2026-09-02')), 'rotation; Wednesdays have Early Release bells');
  assert.equal(whyWords(p, dayEntry(p, '2026-09-05')), 'Saturdays have no school');
  assert.equal(whyWords(p, dayEntry(p, '2026-11-26')), 'changed by hand');
  const fixed = makeCalendar(school(), { start: '2026-08-31', end: '2026-09-30', weekdays: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ day: w === 4 ? school().dayTypes[1].id : w < 5 ? DAY_ROTATION : DAY_CLOSED, bells: null })) }, ctx());
  assert.equal(whyWords(fixed, dayEntry(fixed, '2026-09-04')), 'Fridays are always B Day');
});

test('the panel’s sentence: school days, the range, and what today is', () => {
  const { p } = withCalendar();
  const school = calendarDays(p).filter((day) => day.school).length;
  assert.equal(summaryWords(p, '2026-09-02'), school + ' school days from 31 August 2026 to 11 June 2027. Today is an A Day with Early Release bells.');
  assert.equal(summaryWords(p, '2026-09-01'), school + ' school days from 31 August 2026 to 11 June 2027. Today is a B Day.');
  assert.equal(summaryWords(p, '2026-11-26'), school + ' school days from 31 August 2026 to 11 June 2027. There is no school today: Thanksgiving.');
  assert.equal(summaryWords(p, '2027-07-01'), school + ' school days from 31 August 2026 to 11 June 2027. Today, 1 July 2027, is not in the calendar.');
  assert.equal(summaryWords(removeCalendar(p, {}, ctx()), '2026-09-02'), '');
  assert.equal(todayOf(new Date(2026, 8, 2, 23, 30)), '2026-09-02', 'today is the device’s own date');
});

test('breaks are the runs of dated No school with one note, a weekend inside one keeping it one', () => {
  const { p } = withCalendar();
  const breaks = breaksOf(p).map((each) => [each.label, each.from, each.to, each.schoolDays]);
  assert.deepEqual(breaks, [['Thanksgiving', '2026-11-26', '2026-11-26', 1], ['Winter break', '2026-12-21', '2027-01-01', 10]]);
  assert.equal(runWords('2026-12-21', '2026-12-25'), '21 to 25 December');
  assert.equal(runWords('2026-11-30', '2026-12-02'), '30 November to 2 December');
  assert.equal(runWords('2026-12-28', '2027-01-01'), '28 December 2026 to 1 January 2027');
  assert.equal(runWords('2026-11-26', '2026-11-26'), '26 November');
});

test('a snow day: the button’s words, the toast’s, and the rotation moving back from the next school day', () => {
  const { p: before } = withCalendar();
  const dates = ['2026-10-14'];
  const change = { day: DAY_CLOSED, label: 'Snow day' };
  assert.equal(changeWords(before, dates, change), 'Set 14 October to No school');
  assert.equal(changeWords(before, ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'], change), 'Set 2 school days to No school', 'a weekend inside the run is not counted');
  const after = setCalendarDates(before, { dates, ...change }, ctx());
  const moved = scheduleOutcome(after).movedFrom;
  assert.equal(moved, '2026-10-15');
  assert.equal(doneWords(after, dates, change), 'No school on 14 October.');
  assert.equal(movedWords(before, after, dates, change, moved), 'The rotation moves back a day from 15 October.');
  // a Saturday make-up day takes the next one, and the rotation moves on
  const saturday = { day: DAY_ROTATION };
  const made = setCalendarDates(after, { dates: ['2026-10-17'], ...saturday }, ctx());
  assert.equal(changeWords(after, ['2026-10-17'], saturday), 'Set 17 October to Next in the rotation');
  assert.equal(doneWords(made, ['2026-10-17'], saturday), '17 October takes the next day in the rotation.');
  assert.equal(movedWords(after, made, ['2026-10-17'], saturday, scheduleOutcome(made).movedFrom), 'The rotation moves on from 19 October.');
  // a re-sync: a date set to the day type in the rotation; the days after follow on from it
  const resync = { day: before.dayTypes[0].id };
  const synced = setCalendarDates(made, { dates: ['2026-10-19'], ...resync }, ctx());
  assert.equal(doneWords(synced, ['2026-10-19'], resync), '19 October is A Day.');
  assert.equal(movedWords(made, synced, ['2026-10-19'], resync, scheduleOutcome(synced).movedFrom), 'Later dates follow on from it, from 20 October.');
  assert.equal(changeWords(synced, ['2026-10-14'], { day: null }), 'Set 14 October as the calendar says');
});

// ---------------------------------------------------------------- SV2-80b

const FORMS = await import('../../ui/staff/form.js');
const { printableBox } = await import('../../ui/prints/document.js');

test('a year fits one sheet in Letter and A4, both ways: the squares are as tall as the sheet leaves room for', () => {
  const { p } = withCalendar();
  for (const size of ['letter', 'a4']) {
    for (const orientation of ['landscape', 'portrait']) {
      const paper = { size, orientation };
      const cell = calendarPrint.cellHeightMm(paper);
      const rows = orientation === 'landscape' ? 3 : 4;
      // three or four rows of months, each a heading, the weekday names and six weeks, and what the sheet spends besides
      const used = rows * (9.6 + 6 * cell) + 4 * (rows - 1) + 54;
      assert.ok(used <= printableBox(paper).height, size + ' ' + orientation + ': ' + used.toFixed(1) + ' mm is more than the ' + printableBox(paper).height.toFixed(1) + ' mm a sheet holds');
      assert.ok(cell >= 4 && cell <= 7.5, size + ' ' + orientation + ': a square of ' + cell + ' mm');
      const { html } = calendarPrint.render(p, null, { ...NOW, paper });
      assert.equal(countOf(html, '<section class="page">'), 1, size + ' ' + orientation + ': eleven months are one sheet');
      assert.ok(html.includes('--cal-cell: ' + cell + 'mm'), 'the sheet carries its square’s height');
    }
  }
  assert.ok(calendarPrint.cellHeightMm({ size: 'a0', orientation: 'portrait' }) === 7.5, 'a poster keeps the roomy square');
});

test('a two-year calendar of 24 months is two sheets in every paper and way up; the print asks to open on a landscape sheet', () => {
  const p = makeCalendar(school(), { start: '2026-08-01', end: '2028-07-31' }, ctx());
  assert.equal(calendarDays(p).length, 731);
  for (const size of ['letter', 'a4']) {
    for (const orientation of ['landscape', 'portrait']) {
      assert.equal(countOf(calendarPrint.render(p, null, { ...NOW, paper: { size, orientation } }).html, '<section class="page">'), 2);
    }
  }
  assert.equal(calendarPrint.orientation, 'landscape');
  assert.deepEqual(OUTPUTS.filter((output) => output.orientation !== undefined).map((output) => output.id), ['calendar'], 'only the calendar names an orientation');
});

test('a run of bells alone is named in the dialog’s words and counts school days only', () => {
  const { p, early } = withCalendar();
  const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  assert.equal(changeWords(p, week, { bells: early }), 'Set 5 school days to Early Release bells');
  assert.equal(changeWords(p, ['2026-10-24', '2026-10-25'], { bells: early }), 'No school days to change');
  assert.equal(changeWords(p, ['2026-10-21'], { bells: early }), 'Set 21 October to Early Release bells');
  assert.equal(changeWords(p, week, { bells: null }), 'Set 5 school days to the weekday’s bells');
  assert.equal(changeWords(p, week, { day: DAY_CLOSED }), 'Set 5 school days to No school');
  assert.equal(changeWords(p, ['2027-03-13', '2027-03-14', '2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19', '2027-03-20', '2027-03-21'], { day: DAY_CLOSED }), 'Set 5 school days to No school', 'a run that starts on a Saturday counts its school days');
});

test('Apply over dates already closed says there are no school days to close, not that it sets them', () => {
  let { p } = withCalendar();
  const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  assert.equal(changeWords(p, week, { day: DAY_CLOSED }), 'Set 5 school days to No school');
  p = setCalendarDates(p, { dates: week, day: DAY_CLOSED, label: 'Spirit week' }, ctx());
  assert.equal(changeWords(p, week, { day: DAY_CLOSED }), 'No school days to close', 'a Shift-run over closed dates');
  assert.equal(changeWords(p, ['2026-11-04'], { day: DAY_CLOSED }), 'No school days to close', 'one closed date');
  assert.equal(changeWords(p, week, { day: DAY_CLOSED, label: 'Fair' }), 'Change 5 dates in the calendar', 'a new note on them is the change');
  assert.equal(changeWords(p, ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'], { day: DAY_CLOSED }), 'Set 9 November to No school', 'closed dates beside a school day are not counted');
  assert.equal(changeWords(p, ['2026-11-04', '2026-11-05', '2026-11-09', '2026-11-10'], { day: DAY_CLOSED }), 'Set 2 school days to No school');
});

test('breaks: dates side by side are one; a shared note joins across weekends and closed weekdays, never across a school day; no note joins only side by side', () => {
  let { p } = withCalendar();
  const closed = (dates, label) => (p = setCalendarDates(p, { dates, day: DAY_CLOSED, label }, ctx()));
  const named = (label) => breaksOf(p).filter((each) => each.label === label).map((each) => [each.from, each.to, each.schoolDays]);
  closed(['2026-10-14'], 'Snow day');
  closed(['2026-10-16'], 'Snow day'); // a Friday, the Thursday between is a school day
  closed(['2026-10-19'], 'Snow day'); // the Monday after: the weekend between is not
  closed(['2026-11-03', '2026-11-04'], 'Snow day');
  assert.deepEqual(named('Snow day'), [['2026-10-14', '2026-10-14', 1], ['2026-10-16', '2026-10-19', 2], ['2026-11-03', '2026-11-04', 2]]);
  assert.deepEqual(named('Winter break'), [['2026-12-21', '2027-01-01', 10]], 'the winter break is one, its weekend inside it');
  // a spring break that starts on a Friday (p10)
  closed(['2027-04-09', '2027-04-12', '2027-04-13', '2027-04-14', '2027-04-15', '2027-04-16'], 'Spring break');
  assert.deepEqual(named('Spring break'), [['2027-04-09', '2027-04-16', 6]], 'one break across the weekend');
  // no note: side by side only
  closed(['2027-02-05'], '');
  closed(['2027-02-08'], '');
  closed(['2027-02-09'], '');
  assert.deepEqual(named(''), [['2027-02-05', '2027-02-05', 1], ['2027-02-08', '2027-02-09', 2]], 'dates with no note do not join across a weekend');
  // a different note ends a break
  closed(['2027-05-07'], 'Fair');
  closed(['2027-05-10'], 'Picnic');
  assert.deepEqual([named('Fair'), named('Picnic')], [[['2027-05-07', '2027-05-07', 1]], [['2027-05-10', '2027-05-10', 1]]]);
});

test('the publish form says what staff copies hold: the calendar removed since, or none yet, from what this device noted', () => {
  const { p } = withCalendar();
  const at = '2026-09-02T12:00:00.000Z';
  const published = { ...p, publish: { ...p.publish, lastPublishedAt: at } };
  const removed = { ...published, calendar: null };
  assert.equal(FORMS.calendarChangedWords(removed, { at, calendar: true }), 'The calendar was removed after your last publish. Staff copies still have it.');
  assert.equal(FORMS.calendarChangedWords(removed, { at, calendar: false }), '', 'copies without a calendar lose nothing');
  assert.equal(FORMS.calendarChangedWords(removed, null), '', 'nothing noted: nothing to say');
  assert.equal(FORMS.calendarChangedWords(removed, { at: '2026-09-01T00:00:00.000Z', calendar: true }), '', 'a note of an older publish is not about the last');
  assert.equal(FORMS.calendarChangedWords(published, { at, calendar: false }), 'Staff copies have no calendar yet.');
  // without the note, the project’s own change time still speaks
  const changed = { ...published, calendar: { ...published.calendar, changedAt: '2026-09-03T00:00:00.000Z' } };
  assert.match(FORMS.calendarChangedWords(changed, null), /^The calendar changed after your last publish on /);
  assert.equal(FORMS.calendarChangedWords({ ...changed, publish: { ...changed.publish, lastPublishedAt: null } }, { at, calendar: true }), '', 'never published: nothing');
});
