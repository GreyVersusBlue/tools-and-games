import test from 'node:test';
import assert from 'node:assert/strict';
import { periodName, periodLabel, formatTime, parseTime, toBellTime, bellsFor, bellFindings, LONG_GAP_MINUTES } from '../../engine/bells.js';
import { emptyProject, school } from './helpers.mjs';

const settings = (periodWord) => ({ periodWord });

test('periodName: Period 1, Period 2', () => {
  assert.deepEqual([0, 1, 15].map((i) => periodName(settings('Period'), i)), ['Period 1', 'Period 2', 'Period 16']);
});

test('periodName: Mod 1, Mod 2', () => {
  assert.deepEqual([0, 1, 15].map((i) => periodName(settings('Mod'), i)), ['Mod 1', 'Mod 2', 'Mod 16']);
});

test('periodName: Block A, Block B, lettered through all sixteen', () => {
  assert.deepEqual([0, 1, 15].map((i) => periodName(settings('Block'), i)), ['Block A', 'Block B', 'Block P']);
  assert.equal(periodLabel(settings('Block'), 26), 'AA');
});

test('periodName: 1st Hour, 2nd Hour, with the right ordinals', () => {
  assert.deepEqual([0, 1, 2, 3, 10, 11, 12, 15].map((i) => periodName(settings('Hour'), i)), ['1st Hour', '2nd Hour', '3rd Hour', '4th Hour', '11th Hour', '12th Hour', '13th Hour', '16th Hour']);
  assert.equal(periodLabel(settings('Hour'), 20), '21st');
});

test('periodLabel is the short form of each', () => {
  assert.deepEqual(['Period', 'Mod', 'Block', 'Hour'].map((word) => periodLabel(settings(word), 2)), ['3', '3', 'C', '3rd']);
});

test('formatTime in 12-hour form', () => {
  assert.equal(formatTime('00:00', '12h'), '12:00 AM');
  assert.equal(formatTime('00:05', '12h'), '12:05 AM');
  assert.equal(formatTime('08:42', '12h'), '8:42 AM');
  assert.equal(formatTime('11:59', '12h'), '11:59 AM');
  assert.equal(formatTime('12:00', '12h'), '12:00 PM');
  assert.equal(formatTime('13:08', '12h'), '1:08 PM');
  assert.equal(formatTime('23:59', '12h'), '11:59 PM');
  assert.equal(formatTime('14:05', '12h', { suffix: false }), '2:05');
});

test('formatTime in 24-hour form', () => {
  assert.equal(formatTime('00:00', '24h'), '00:00');
  assert.equal(formatTime('08:42', '24h'), '08:42');
  assert.equal(formatTime('14:05', '24h'), '14:05');
});

test('formatTime takes minutes after midnight too, and gives "" for what is not a time', () => {
  assert.equal(formatTime(522, '12h'), '8:42 AM');
  assert.equal(formatTime(522, '24h'), '08:42');
  assert.equal(formatTime(null, '12h'), '');
  assert.equal(formatTime('8:42', '12h'), '');
  assert.equal(formatTime('25:00', '24h'), '');
  assert.equal(formatTime(NaN, '24h'), '');
});

test('parseTime and toBellTime are each other\'s reverse', () => {
  assert.equal(parseTime('08:42'), 522);
  assert.equal(parseTime('8:42'), null);
  assert.equal(toBellTime(522), '08:42');
  assert.equal(toBellTime(0), '00:00');
  assert.equal(toBellTime(1439), '23:59');
});

test('bellsFor: the sample school\'s A Day, with four minutes of passing time from the bells', () => {
  const bells = bellsFor(school(), 'dsample00a');
  assert.equal(bells.length, 8);
  assert.deepEqual(bells[0], { start: '08:00', end: '08:48', passingAfter: 240, passingFromBells: true });
  assert.deepEqual(bells.slice(0, 7).map((bell) => bell.passingAfter), [240, 240, 240, 240, 240, 240, 240]);
  assert.deepEqual(bells[7], { start: '14:04', end: '14:52', passingAfter: null, passingFromBells: false });
});

test('bellsFor: passing time comes from the bells, not the default, when they differ', () => {
  const project = school();
  project.dayTypes[0].bells[1] = { start: '08:55', end: '09:40' };
  project.settings.defaultPassingSeconds = 180;
  const bells = bellsFor(project, 'dsample00a');
  assert.equal(bells[0].passingAfter, 420, 'seven minutes from 08:48 to 08:55');
  assert.equal(bells[0].passingFromBells, true);
});

test('bellsFor: the default passing time where times are missing', () => {
  const project = school();
  project.dayTypes[0].bells[2] = null;
  project.settings.defaultPassingSeconds = 300;
  const bells = bellsFor(project, 'dsample00a');
  assert.deepEqual([bells[1].passingAfter, bells[1].passingFromBells], [300, false], 'into the period with no times');
  assert.deepEqual([bells[2].passingAfter, bells[2].passingFromBells], [300, false], 'out of it');
  assert.deepEqual([bells[2].start, bells[2].end], [null, null]);
  assert.deepEqual([bells[3].passingAfter, bells[3].passingFromBells], [240, true]);
});

test('bellsFor: no bells at all gives the default everywhere', () => {
  const bells = bellsFor(emptyProject(), emptyProject().dayTypes[0].id);
  assert.equal(bells.length, 8);
  assert.deepEqual(bells.map((bell) => bell.passingAfter), [240, 240, 240, 240, 240, 240, 240, null]);
  assert.ok(bells.every((bell) => bell.start === null && bell.passingFromBells === false));
});

test('bellsFor: periods that overlap or touch fall back to the default rather than zero or less', () => {
  const project = school();
  project.dayTypes[0].bells[1] = { start: '08:40', end: '09:40' };
  project.dayTypes[0].bells[3] = { start: '10:32', end: '11:24' };
  const bells = bellsFor(project, 'dsample00a');
  assert.deepEqual([bells[0].passingAfter, bells[0].passingFromBells], [240, false]);
  assert.deepEqual([bells[2].passingAfter, bells[2].passingFromBells], [240, false]);
});

test('bellsFor: a day type that is the same as A Day has A Day\'s bells', () => {
  const project = school();
  project.dayTypes[1] = { ...project.dayTypes[1], own: false };
  assert.deepEqual(bellsFor(project, 'dsample00b'), bellsFor(project, 'dsample00a'));
  assert.equal(bellsFor(project, 'dsample00b')[0].start, '08:00');
});

test('bell checks: the sample school\'s bells have nothing to report', () => {
  assert.deepEqual(bellFindings(school(), 'dsample00a'), []);
  assert.deepEqual(bellFindings(school(), 'dsample00b'), []);
  assert.deepEqual(bellFindings(emptyProject(), emptyProject().dayTypes[0].id), [], 'and nothing entered is nothing to report');
});

test('bell checks: end before start', () => {
  const project = school();
  project.dayTypes[0].bells[2] = { start: '10:32', end: '09:44' };
  const findings = bellFindings(project, 'dsample00a');
  const found = findings.filter((finding) => finding.kind === 'end-before-start');
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].path, found[0].period], ['dayTypes[0].bells[2]', 2]);
  assert.equal(found[0].message, 'Period 3 ends at 9:44 AM, which is not after its start at 10:32 AM. Check the two times.');
});

test('bell checks: an end equal to its start is the same finding', () => {
  const project = school();
  project.dayTypes[0].bells[0] = { start: '08:00', end: '08:00' };
  assert.deepEqual(bellFindings(project, 'dsample00a').map((finding) => finding.kind), ['end-before-start']);
});

test('bell checks: overlap with any other period, not only the next one', () => {
  const project = school();
  project.dayTypes[0].bells[5] = { start: '08:30', end: '09:00' };
  const overlaps = bellFindings(project, 'dsample00a').filter((finding) => finding.kind === 'overlap');
  assert.deepEqual(overlaps.map((finding) => finding.period), [5, 5], 'Period 6 overlaps Period 1 and Period 2');
  assert.equal(overlaps[0].message, 'Period 6 (8:30 AM to 9:00 AM) overlaps Period 1 (8:00 AM to 8:48 AM). One of them needs different times.');
});

test('bell checks: a period with no times among periods that have them is a gap', () => {
  const project = school();
  project.dayTypes[0].bells[4] = null;
  const findings = bellFindings(project, 'dsample00a');
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.period]), [['gap', 4]]);
  assert.match(findings[0].message, /^Period 5 has no times\. .* default of 240 seconds\.$/);
});

test('bell checks: no passing time at all between two periods is a gap', () => {
  const project = school();
  project.dayTypes[0].bells[1] = { start: '08:48', end: '09:40' };
  const findings = bellFindings(project, 'dsample00a');
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.period]), [['gap', 0]]);
  assert.match(findings[0].message, /no passing time between Period 1 and Period 2/);
});

test('bell checks: a gap longer than half an hour is pointed out, and half an hour is not', () => {
  const project = school();
  const shift = (minutes) => {
    project.dayTypes[0].bells = project.dayTypes[0].bells.map((bell, p) => (p < 4 ? bell : { start: toBellTime(parseTime(bell.start) + minutes), end: toBellTime(parseTime(bell.end) + minutes) }));
  };
  shift(LONG_GAP_MINUTES - 4);
  assert.deepEqual(bellFindings(project, 'dsample00a'), [], 'exactly 30 minutes');
  shift(1);
  const findings = bellFindings(project, 'dsample00a');
  assert.deepEqual(findings.map((finding) => [finding.kind, finding.period]), [['gap', 3]]);
  assert.match(findings[0].message, /^There are 31 minutes between Period 4 and Period 5\./);
});

test('bell checks use the school\'s period word and time format', () => {
  const project = school();
  project.settings.periodWord = 'Block';
  project.settings.timeFormat = '24h';
  project.dayTypes[0].bells[2] = { start: '10:32', end: '09:44' };
  assert.equal(bellFindings(project, 'dsample00a')[0].message, 'Block C ends at 09:44, which is not after its start at 10:32. Check the two times.');
});

test('bell checks on a day type that is the same as A Day report A Day\'s, at A Day\'s path', () => {
  const project = school();
  project.dayTypes[1] = { ...project.dayTypes[1], own: false };
  project.dayTypes[0].bells[4] = null;
  assert.deepEqual(bellFindings(project, 'dsample00b').map((finding) => finding.path), ['dayTypes[0].bells[4]']);
  assert.deepEqual(bellFindings(project, 'dnowhere00'), []);
});

test('bell checks warn and never block: every finding is a path, a message, a kind and a period', () => {
  const project = school();
  project.dayTypes[0].bells[0] = { start: '09:00', end: '08:00' };
  project.dayTypes[0].bells[3] = null;
  for (const finding of bellFindings(project, 'dsample00a')) {
    assert.deepEqual(Object.keys(finding), ['path', 'message', 'kind', 'period']);
    assert.ok(['end-before-start', 'overlap', 'gap'].includes(finding.kind));
  }
});

// ---------------------------------------------------------------- ARCHITECTURE 17.3: bell schedules

import { findBellSchedule, offPeriods } from '../../engine/bells.js';

// The sample school with an Early Release schedule: A Day's bells with each
// period ending 10 minutes sooner, and Periods 6 to 8 not meeting.
function earlyRelease(off) {
  const project = school();
  const bells = project.dayTypes[0].bells.map((bell) => (bell === null ? null : { start: bell.start, end: toBellTime(parseTime(bell.end) - 10) }));
  project.bellSchedules = [{ id: 'bsample0er', name: 'Early Release', short: '', bells, off: off === undefined ? [5, 6, 7] : off }];
  return project;
}

test('bellsFor with a bell schedule: its times, and the periods that do not meet as off with no passing time into or out of them', () => {
  const project = earlyRelease();
  const regular = bellsFor(project, 'dsample00a');
  const early = bellsFor(project, 'dsample00a', 'bsample0er');
  assert.equal(early.length, 8);
  assert.deepEqual(early.slice(5), [0, 0, 0].map(() => ({ start: null, end: null, passingAfter: null, passingFromBells: false, off: true })));
  assert.equal(early[1].end, toBellTime(parseTime(regular[1].end) - 10));
  // Period 1 ends 10 minutes sooner and Period 2 starts when it did
  assert.equal(early[0].passingAfter, regular[0].passingAfter + 10 * 60);
  assert.equal(early[0].passingFromBells, true);
  // nothing passes from Period 5 into Period 6, which does not meet
  assert.equal(early[4].passingAfter, null);
  assert.equal(early.filter((bell) => bell.off).length, 3);
  // the meeting periods carry exactly the regular shape
  assert.deepEqual(Object.keys(early[0]), Object.keys(regular[0]));
  // the same classes: the day type decides nothing about the times
  assert.deepEqual(bellsFor(project, 'dsample00b', 'bsample0er'), early);
});

test('bellsFor with no bell schedule, or one that is not there, is the regular bells exactly as before', () => {
  const project = earlyRelease();
  const regular = bellsFor(project, 'dsample00a');
  assert.deepEqual(bellsFor(project, 'dsample00a', null), regular);
  assert.deepEqual(bellsFor(project, 'dsample00a', 'bnowhere00'), regular);
  assert.deepEqual(bellsFor(school(), 'dsample00a'), regular);
  assert.ok(regular.every((bell) => !('off' in bell)));
  assert.equal(findBellSchedule(project, 'bnowhere00'), null);
  assert.equal(findBellSchedule(school(), 'bsample0er'), null);
});

test('an off period in the middle of the day: no transition into it or out of it', () => {
  const early = bellsFor(earlyRelease([2]), 'dsample00a', 'bsample0er');
  assert.deepEqual(early.map((bell) => bell.passingAfter === null), [false, true, true, false, false, false, false, true]);
  assert.deepEqual(Array.from(offPeriods(earlyRelease([2, 9, -1, 2.5]), 'bsample0er')), [2]);
});

test('the bell checks skip a period that does not meet: no gap, overlap or end-before-start for it', () => {
  const project = earlyRelease();
  // times that would be wrong, left on periods that do not meet
  project.bellSchedules[0].bells[6] = { start: '09:00', end: '08:00' };
  project.bellSchedules[0].bells[7] = null;
  assert.deepEqual(bellFindings(project, 'dsample00a', 'bsample0er'), []);
  // the same times on a schedule where every period meets are pointed out
  project.bellSchedules[0].off = [];
  const kinds = bellFindings(project, 'dsample00a', 'bsample0er').map((finding) => [finding.kind, finding.period, finding.path]);
  assert.deepEqual(kinds, [['end-before-start', 6, 'bellSchedules[0].bells[6]'], ['gap', 7, 'bellSchedules[0].bells[7]']]);
});
