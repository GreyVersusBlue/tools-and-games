// Part-time teachers and period names in the planner's readers (ARCHITECTURE
// 22.7, 22.10, 22.17): the teacher-away check, what no-planning and consecutive
// do with a period a teacher is away, "Not in school" in every reader of
// `marked`, and imports and CSV headers that take a period by its number name,
// its own name or its bare number. No clock is read; dates are plain strings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchedule, teachingRunEnd, MARK_AS_NAMED } from '../../engine/checks.js';
import { CHECK_KINDS } from '../../engine/schema.js';
import { teacherDay, teacherDays, isFree } from '../../engine/teacher-day.js';
import { setTeacherAway, setPeriodName, setPeriodCustom } from '../../engine/w7-actions.js';
import * as actions from '../../engine/actions.js';
import { teacherGridRows, groupsHeader, templateRows, csvText } from '../../engine/exports.js';
import { guessColumns, checkMapping } from '../../engine/import-groups.js';
import { render } from '../../ui/prints/checks-report.js';
import { teacherTable } from '../../ui/schedule/grid/readonly.js';
import { school, ctx, assertValid, clone } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const HALLORAN = 'tsample001'; // A Day: free | 8B | 6A | free x5 (B Day: free | 7B | ...)
const entry = (extra) => ({ dayTypeIds: [], weekdays: [], periods: [], ...extra });
const ofKind = (result, kind) => result.findings.filter((finding) => finding.kind === kind);

function withAway(away, project) {
  const next = project || school();
  const found = next.teachers.find((teacher) => teacher.id === HALLORAN);
  found.away = away;
  return next;
}

// Halloran with a group in every period of A Day, so that she has no planning
// period: the setup no-planning is checked on elsewhere.
function busyHalloran(away) {
  const project = school();
  project.groups.push({ id: 'gtest00001', name: '9Z', grade: '9', headCount: 20, colour: '#999999', days: { [A]: school().groups[0].days[A].map((slot) => ({ ...slot, room: 'rsample101' })), [B]: school().groups[0].days[B] } });
  if (away) withAway(away, project);
  return project;
}


// The read-only table builds real elements. These stand in for just the parts of
// the DOM its helpers touch, so that its text can be read in plain Node.
function withFakeDom(build) {
  class FakeNode {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.className = '';
      this.hidden = false;
    }
    append(...nodes) { for (const node of nodes) this.children.push(node); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener() {}
    get textContent() { return this.own === undefined ? this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('') : this.own; }
    set textContent(value) { this.own = String(value); }
  }
  const saved = { document: globalThis.document, Node: globalThis.Node, window: globalThis.window };
  globalThis.Node = FakeNode;
  globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {} };
  globalThis.document = { createElement: (tag) => new FakeNode(tag), createTextNode: (text) => String(text), activeElement: null };
  try {
    return build();
  } finally {
    globalThis.document = saved.document;
    globalThis.Node = saved.Node;
    globalThis.window = saved.window;
  }
}

// The cells of the row whose header says `name`: its text, one string a period.
function rowTexts(root, name) {
  const found = [];
  const walk = (node) => {
    if (typeof node === 'string' || !node || !node.children) return;
    if (node.tag === 'tr' && node.children.length > 1 && node.children[0].tag === 'th' && node.children[0].textContent === name) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root.root || root.el || root);
  assert.equal(found.length, 1, 'one row for ' + name);
  return found[0].children.slice(1).map((cell) => cell.textContent.replace(/\s*\(.*\)$/, '').trim());
}

// ---------------------------------------------------------------- the check

test('teacher-away is a warning with the sentence and id of 22.10, about the teacher and the group, in each day type it holds on', () => {
  const project = withAway([entry({ periods: [1, 2] })]);
  assertValid(project);
  const result = checkSchedule(project, null);
  const found = ofKind(result, 'teacher-away');
  assert.deepEqual(found.map((finding) => finding.id), ['teacher-away:dsample00a:1:tsample001', 'teacher-away:dsample00a:2:tsample001', 'teacher-away:dsample00b:1:tsample001']);
  const first = found[0];
  assert.equal(first.severity, 'warning');
  assert.equal(first.text, 'Ms. Halloran is not in school in Period 2 on A Day (in Periods 2 to 3), but 8B is in Room 101 then. Change the entry, or give that group another teacher.');
  assert.deepEqual(first.where, { dayTypeId: A, period: 1, groupIds: ['gsample08b'], roomId: 'rsample101', teacherId: HALLORAN });
  assert.deepEqual(first.about, ['gsample08b', HALLORAN]);
  assert.equal(first.fixable, false);
  assert.match(found[2].text, /^Ms\. Halloran is not in school in Period 2 on B Day \(in Periods 2 to 3\), but 7B is in Room 101 then\./);
});

test('teacher-away names only the periods the teacher teaches in: a free period away is no finding, and no entry is no finding', () => {
  assert.deepEqual(ofKind(checkSchedule(withAway([entry({ periods: [0, 3, 4] })]), null), 'teacher-away'), [], 'Halloran is free in those');
  assert.deepEqual(ofKind(checkSchedule(school(), null), 'teacher-away'), []);
  assert.deepEqual(ofKind(checkSchedule(withAway([entry({ dayTypeIds: [B], periods: [2] })]), null), 'teacher-away'), [], 'B Day period 3 is free there');
  const onlyA = ofKind(checkSchedule(withAway([entry({ dayTypeIds: [A] })]), null), 'teacher-away');
  assert.deepEqual(onlyA.map((finding) => finding.id), ['teacher-away:dsample00a:1:tsample001', 'teacher-away:dsample00a:2:tsample001']);
});

test('teacher-away follows a day type that is the same as another: an entry naming either holds for both', () => {
  const same = withAway([entry({ dayTypeIds: [B] })]);
  same.dayTypes[1].own = false;
  same.dayTypes[1].bells = same.dayTypes[1].bells.map(() => null);
  for (const one of same.groups) delete one.days[B];
  const result = ofKind(checkSchedule(same, null), 'teacher-away');
  // the id is the check's own day type's (A Day, which B Day is the same as); the words say which holds
  assert.deepEqual(result.map((finding) => finding.id), ['teacher-away:dsample00a:1:tsample001', 'teacher-away:dsample00a:2:tsample001']);
  assert.match(result[0].text, / on B Day, but /);
  assert.equal(result[0].where.dayTypeId, A);
});

test('a weekdays-only entry is a note, not a warning: the check cannot know the date', () => {
  const project = withAway([entry({ weekdays: [4], periods: [1] })]);
  assertValid(project);
  const found = ofKind(checkSchedule(project, null), 'teacher-away');
  assert.equal(found.length, 2, 'A Day and B Day period 2');
  assert.equal(found[0].severity, 'note');
  // SV2-142b: a note's id names the entry (its weekdays and periods), not a class
  assert.equal(found[0].id, 'teacher-away:dsample00a:on4p1:tsample001');
  assert.deepEqual(found[0].about, ['tsample001'], 'about is the teacher alone');
  assert.equal(found[0].text, 'Ms. Halloran is not in school on Fridays, and 8B is in Room 101 in Period 2 on A Day. On those days that group needs another teacher.');
  // a whole entry on the same period wins: it is the warning
  const both = ofKind(checkSchedule(withAway([entry({ weekdays: [4], periods: [1] }), entry({ periods: [1] })]), null), 'teacher-away');
  assert.equal(both[0].severity, 'warning');
});

test('teacher-away is not in CHECK_KINDS and is always on, whatever checks.off holds', () => {
  assert.equal(CHECK_KINDS.includes('teacher-away'), false);
  const project = withAway([entry({ periods: [1] })]);
  project.settings.checks = { ...project.settings.checks, off: CHECK_KINDS.slice() };
  assert.equal(checkSchedule(project, null).findings.filter((finding) => finding.kind === 'teacher-away').length, 2, 'every check is switched off and this one still speaks');
  assert.equal(checkSchedule(project, null).findings.every((finding) => finding.kind === 'teacher-away'), true);
});

test('teacher-away can be accepted, and then it is listed as accepted and not counted', () => {
  const project = withAway([entry({ periods: [1] })]);
  const id = 'teacher-away:dsample00a:1:tsample001';
  const accepted = actions.acceptFinding(project, { findingId: id, reason: 'Covered by a sub' }, ctx());
  const result = checkSchedule(accepted, null);
  assert.equal(result.findings.some((finding) => finding.id === id), false);
  assert.equal(result.accepted.some((finding) => finding.id === id), true);
  assert.equal(result.findings.some((finding) => finding.id === 'teacher-away:dsample00b:1:tsample001'), true, 'the other day type is not accepted');
});

test('a teacher name and a group name are printed as typed in the sentence', () => {
  const project = withAway([entry({ periods: [1] })]);
  project.teachers[0].name = '<i>Ms</i> "H"';
  project.groups.find((one) => one.id === 'gsample08b').name = '8<b>B</b>';
  const found = ofKind(checkSchedule(project, null), 'teacher-away')[0];
  assert.match(found.text, /^<i>Ms<\/i> "H" is not in school in Period 2 on A Day/);
  assert.match(found.text, /but 8<b>B<\/b> is in Room 101 then/);
});

// ---------------------------------------------------------------- no-planning and consecutive

test('no-planning is not raised for a day a teacher is away all day, and is for one they are only partly away', () => {
  const plain = ofKind(checkSchedule(busyHalloran(), null), 'no-planning');
  assert.equal(plain.length, 1, 'the setup does raise it');
  assert.equal(ofKind(checkSchedule(busyHalloran([entry({ dayTypeIds: [A] })]), null), 'no-planning').length, 0, 'away all day on A Day');
  assert.equal(ofKind(checkSchedule(busyHalloran([entry({ dayTypeIds: [A], weekdays: [4] })]), null), 'no-planning').length, 1, 'away on Fridays only: sometimes is not all day');
  assert.equal(ofKind(checkSchedule(busyHalloran([entry({ dayTypeIds: [A], periods: [0, 1, 2, 3, 4, 5, 6] })]), null), 'no-planning').length, 1, 'one period short of all day');
  const day = ofKind(checkSchedule(busyHalloran([entry({ dayTypeIds: [A] })]), null), 'teacher-away');
  assert.equal(day.filter((finding) => finding.where.dayTypeId === A).length, 8, 'she teaches all 8 and is away for all 8: each is said');
});

test('no-planning does not count an away period as planning, and says it is not in school', () => {
  const project = school();
  // Brightwater is free in periods 2, 5 and 6 of A Day (index 1, 4, 5); all three away, and teaching elsewhere: no planning left
  const brightwater = project.teachers.find((teacher) => teacher.id === 'tsample002');
  brightwater.away = [entry({ dayTypeIds: [A], periods: [1, 4, 5] })];
  const days = teacherDays(project, A);
  assert.deepEqual(days.get('tsample002').filter((one) => one.kind === 'planning').map((one) => one.marked), ['away', 'away', 'away']);
  assert.equal(days.get('tsample002').some(isFree), false, 'an away period is not free');
  const found = ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === 'tsample002');
  assert.equal(found.length, 1);
  assert.match(found[0].text, /: they are not in school in Period 2, Period 5 and Period 6, and there is a group in every other period\./);
});

test('consecutive ends a run at an away period, but an always duty between two classes does not', () => {
  const teaching = { kind: 'teaching', marked: undefined, duties: [] };
  const away = { kind: 'planning', marked: 'away', duties: [] };
  const duty = { kind: 'planning', marked: 'duty', duties: [] };
  assert.equal(teachingRunEnd([teaching, teaching, away, teaching, teaching], 0, null), 1);
  assert.equal(teachingRunEnd([teaching, teaching, duty, teaching, teaching], 0, null), 4);
  assert.equal(teachingRunEnd([teaching, away, teaching], 0, null), 0);
});

test('consecutive does not run through an away period that an always duty would have bridged', () => {
  const project = school();
  project.settings.checks = { ...project.settings.checks, consecutiveLimit: 3 };
  const pennywhistle = project.teachers.find((teacher) => teacher.id === 'tsample009');
  // Pennywhistle's A Day: free | free | 7A | 7B | free | 7C | 6C | 6B. A duty in period 5 sits between two classes
  project.duties = [{ id: 'ugiven0001', kind: 'duty', label: '', when: 'period', period: 4, start: '', end: '', dayTypeIds: [A], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: ['tsample009'], subjectIds: [], everyone: false }];
  const runs = (one) => ofKind(checkSchedule(one, null), 'consecutive').filter((finding) => finding.where.teacherId === 'tsample009' && finding.where.dayTypeId === A);
  assert.equal(runs(project).length, 1, 'the duty bridges 7A 7B and 7C 6C 6B: five classes in a row');
  assert.match(runs(project)[0].text, /teaches 5 periods in a row/);
  pennywhistle.away = [entry({ dayTypeIds: [A], periods: [4] })];
  assert.equal(runs(project).length, 0, 'away in that period ends the run: 2 and 3');
}); 

// ---------------------------------------------------------------- free, for Coverage and Common planning

test('an away period is not free: Coverage and Common planning leave the teacher out through isFree', () => {
  const project = withAway([entry({ dayTypeIds: [A], periods: [0] })]);
  const free = (period, dayTypeId, date) => teacherDays(project, dayTypeId, date ? { date } : undefined).get(HALLORAN)[period];
  assert.equal(isFree(free(0, A)), false);
  assert.equal(free(0, A).marked, 'away');
  assert.equal(isFree(free(0, B)), true, 'B Day is not named');
  assert.equal(isFree(free(3, A)), true);
  // a weekdays-only entry holds by date: 2026-11-13 is a Friday, 2026-11-12 a Thursday
  const fridays = withAway([entry({ weekdays: [4], periods: [0] })]);
  assert.equal(isFree(teacherDay(fridays, HALLORAN, A)[0]), true, 'with no date a weekdays entry is listed, not taking the period');
  assert.equal(isFree(teacherDay(fridays, HALLORAN, A, { date: '2026-11-13' })[0]), false);
  assert.equal(isFree(teacherDay(fridays, HALLORAN, A, { date: '2026-11-12' })[0]), true);
});

// ---------------------------------------------------------------- "Not in school" in every reader of marked

test('every reader of marked says "Not in school": the CSV grid, the checks report grid and the read-only table', () => {
  assert.equal(MARK_AS_NAMED.away, 'Not in school');
  const project = withAway([entry({ dayTypeIds: [A], periods: [0] })]);
  const row = teacherGridRows(project, A).find((one) => one[0] === 'Ms. Halloran');
  assert.equal(row[2], 'Not in school', 'period 1 of A Day, in the CSV: the teacher\'s name, the day type, then the periods');
  assert.equal(row[5], 'Planning', 'a free period is still Planning');
  const html = render(project, null, {}).html;
  assert.match(html, /<span class="doc-grid__planning">Not in school<\/span>/);
  const table = withFakeDom(() => teacherTable(project, new Map(), [A]));
  const cells = rowTexts(table, 'Ms. Halloran');
  assert.equal(cells[0], 'Not in school', 'the read-only table says it in period 1');
  assert.equal(cells[1], '8B in 101', 'and still shows what she teaches');
  assert.equal(cells[3], 'Planning');
});

test('a duty in an away period does not hide "Not in school": away comes first', () => {
  const project = withAway([entry({ dayTypeIds: [A], periods: [0] })]);
  project.duties = [{ id: 'ugiven0001', kind: 'duty', label: 'Bus duty', when: 'period', period: 0, start: '', end: '', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: [HALLORAN], subjectIds: [], everyone: false }];
  const row = teacherGridRows(project, A).find((one) => one[0] === 'Ms. Halloran');
  assert.equal(row[2], 'Not in school');
  assert.match(render(project, null, {}).html, /Not in school/);
});

// ---------------------------------------------------------------- imports and CSV headers by number name

// 'p2' for a period column, with '@day type' only when the header named it
const brief = (mapping) => mapping.map((item) => (item.role === 'period' ? 'p' + item.period : item.role));

function named(names) {
  let project = school();
  for (const [period, name] of names) project = actions.setPeriods ? setPeriodName(project, { period, name }, ctx()) : project;
  return project;
}

test('the CSV headers use number names whatever a period is called', () => {
  const project = named([[0, 'Advisory'], [4, 'Lunch']]);
  assert.deepEqual(groupsHeader(project).slice(4, 9), ['A Day Period 1', 'A Day Period 2', 'A Day Period 3', 'A Day Period 4', 'A Day Period 5']);
  const lessons = setPeriodCustom(named([[0, 'Advisory']]), { word: 'Lesson', count: 'letter' }, ctx());
  assert.equal(groupsHeader(lessons)[4], 'A Day Lesson A');
  assert.deepEqual(templateRows(project)[0].slice(4, 6), ['A Day Period 1', 'A Day Period 2']);
  const grid = teacherGridRows(project, A)[0];
  assert.deepEqual(grid.slice(0, 4), ['Teacher', 'Day type', 'Period 1', 'Period 2'], 'the teacher grid too');
  assert.equal(csvText([groupsHeader(project)]).includes('Advisory'), false);
});

test('an import matches a period by its number name, its own name or the bare number, ignoring case and spaces', () => {
  const project = named([[0, 'Advisory'], [4, 'Lunch'], [5, 'Late Start']]);
  const header = ['Group', 'PERIOD 2', 'period3', 'Advisory', ' lunch ', 'LateStart', '7', 'p8'];
  assert.deepEqual(brief(guessColumns(header, project)), ['name', 'p1', 'p2', 'p0', 'p4', 'p5', 'p6', 'p7']);
  const lessons = setPeriodCustom(project, { word: 'Lesson', count: 'letter' }, ctx());
  assert.deepEqual(brief(guessColumns(['Group', 'Lesson B', 'c', 'Lunch', '4'], lessons)), ['name', 'p1', 'p2', 'p4', 'p3'], 'the school\'s word, a bare letter in a lettered school, an own name, a bare number');
  const blocks = setPeriodCustom(school(), { word: 'Block', count: 'letter' }, ctx());
  assert.deepEqual(brief(guessColumns(['Group', 'Block A', 'b'], blocks)), ['name', 'p0', 'p1']);
});

test('two periods with one name are matched by number only, and the import says so', () => {
  const project = named([[1, 'Study'], [6, ' study ']]);
  const mapping = guessColumns(['Group', 'Study', 'Period 7', '2'], project);
  assert.deepEqual(brief(mapping), ['name', 'ignore', 'p6', 'p1']);
  assert.equal(mapping[1].note, 'Two periods are called "Study", so this column is not matched by that name. Call it by its number, like Period 2.');
  assert.deepEqual(checkMapping(project, mapping).filter((problem) => /Study/.test(problem)), []);
});

test('a period name that begins with a day type\'s name is still a period, and a day type prefix still works', () => {
  const project = named([[2, 'A Day Advisory'], [3, 'B Day Lunch']]);
  const mapping = guessColumns(['Group', 'A Day Advisory', 'B Day Lunch', 'A Day Period 5', 'Period 1 (B Day)'], project);
  assert.deepEqual(brief(mapping), ['name', 'p2', 'p3', 'p4', 'p0']);
  assert.equal(mapping[3].dayTypeId, A, 'a prefix still names its day type');
  assert.equal(mapping[4].dayTypeId, B);
  const split = guessColumns(['Group', 'B Day: B Day Lunch'], project);
  assert.deepEqual([split[1].period, split[1].dayTypeId], [3, B], 'a day type, then a period whose name begins with one');
  // a day type, then a period's own name
  const plain = named([[2, 'Advisory']]);
  const both = guessColumns(['Group', 'B Day Advisory', 'A Day Period 1'], plain);
  assert.deepEqual(both.map((item) => [item.period, item.dayTypeId]).slice(1), [[2, B], [0, A]]);
  // the exported headers (number names) read back to the periods they came from, names or not
  const back = guessColumns(groupsHeader(project), project);
  assert.equal(back.slice(4).every((item, at) => item.role === 'period' && item.period === at % 8 && item.dayTypeId === (at < 8 ? A : B)), true);
});

test('a period name is shown in the check sentences and numbers stay in the CSV (periodName vs periodNumberName)', () => {
  const project = setPeriodName(withAway([entry({ periods: [1] })]), { period: 1, name: 'Advisory' }, ctx());
  const found = ofKind(checkSchedule(project, null), 'teacher-away')[0];
  assert.match(found.text, /^Ms\. Halloran is not in school in Advisory on A Day, but 8B is in Room 101 then\./, 'the period\'s own name where it names the period; the entry\'s one period is not said twice');
  const range = setPeriodName(withAway([entry({ periods: [1, 2] })]), { period: 1, name: 'Advisory' }, ctx());
  assert.match(ofKind(checkSchedule(range, null), 'teacher-away')[0].text, /in Advisory on A Day \(in Periods 2 to 3\), but/, 'the number names in a range, which adds the other period');
});

test('the checks report names its grids by the school\'s own period word, as typed', () => {
  assert.match(render(school(), null, {}).html, /Teachers by period: A Day/);
  const custom = setPeriodCustom(school(), { word: 'Lesson', count: 'number' }, ctx());
  assert.match(render(custom, null, {}).html, /Teachers by Lesson: A Day/);
});

// ---------------------------------------------------------------- SV2-127b: malformed entries, sentences, ids

// B Day the same as A Day, so one check speaks for both
function withFollower(away) {
  const project = withAway(away);
  project.dayTypes[1].own = false;
  project.dayTypes[1].sameAs = A;
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
  for (const one of project.groups) delete one.days[B];
  return project;
}

test('a weekdays entry the rule cannot read gives no finding, and one with a readable weekday still gives its note', () => {
  const unreadable = withAway([{ dayTypeIds: [], weekdays: [9], periods: [1] }]);
  assert.deepEqual(ofKind(checkSchedule(unreadable, null), 'teacher-away'), [], 'awayFor ignores it, so the check must not word it');
  const half = withAway([{ dayTypeIds: [], weekdays: [9, 4], periods: [1] }]);
  const found = ofKind(checkSchedule(half, null), 'teacher-away');
  assert.deepEqual(found.map((finding) => finding.severity), ['note', 'note']);
  assert.match(found[0].text, /^Ms\. Halloran is not in school on Fridays, and 8B is in Room 101 in Period 2 on A Day\./);
});

test('the sentence repeats nothing: day types and a lone period are left out of the parenthesis, a range and other day types are not', () => {
  const lead = 'Ms. Halloran is not in school in Period 2 on A Day';
  const tail = ', but 8B is in Room 101 then. Change the entry, or give that group another teacher.';
  const text = (away) => ofKind(checkSchedule(withAway(away), null), 'teacher-away')[0].text;
  assert.equal(text([entry({ dayTypeIds: [A], periods: [1] })]), lead + tail, 'neither the day type nor the one period is said twice');
  assert.equal(text([entry({ periods: [1] })]), lead + tail);
  assert.equal(text([entry({ dayTypeIds: [A], periods: [1, 2] })]), lead + ' (in Periods 2 to 3)' + tail, 'the other period is news');
  assert.equal(text([entry({ dayTypeIds: [A, B], periods: [1] })]), lead + ' (also on B Day)' + tail, 'B Day is not in this sentence, and A Day is not said twice');
  assert.equal(text([entry({ dayTypeIds: [A, B], periods: [1, 2] })]), lead + ' (in Periods 2 to 3, also on B Day)' + tail);
});

test('the note says what the entry adds: the weekdays, and a range of periods; a day type and weekdays together are one note', () => {
  const found = (away) => ofKind(checkSchedule(withAway(away), null), 'teacher-away');
  const both = found([entry({ dayTypeIds: [A], weekdays: [4], periods: [1] })]);
  assert.deepEqual(both.map((finding) => [finding.id, finding.severity]), [['teacher-away:dsample00a:on4p1ddsample00a:tsample001', 'note']], 'only A Day is named');
  assert.equal(both[0].text, 'Ms. Halloran is not in school on Fridays, and 8B is in Room 101 in Period 2 on A Day. On those days that group needs another teacher.');
  const range = found([entry({ weekdays: [3, 4], periods: [1, 2] })]);
  // SV2-142: the two classes in the range are one note, not one each
  assert.equal(range.filter((finding) => finding.where.dayTypeId === A).length, 1);
  assert.equal(range[0].text, 'Ms. Halloran is not in school in Periods 2 to 3 on Thursdays and Fridays, and 8B is in Room 101 in Period 2; 6A is in Room 101 in Period 3 on A Day. On those days those groups need another teacher.');
});

test('SV2-142: a weekdays-only entry is one note for the teacher and the entry on each day type, however many classes it touches; its id is the entry\'s', () => {
  const project = withAway([entry({ weekdays: [4] })]);
  const found = ofKind(checkSchedule(project, null), 'teacher-away');
  const onA = found.filter((finding) => finding.where.dayTypeId === A);
  const onB = found.filter((finding) => finding.where.dayTypeId === B);
  assert.equal(onA.length, 1, 'one note on A Day, not one for each class');
  assert.equal(onB.length, 1, 'one note on B Day');
  assert.equal(found.length, 2);
  assert.equal(onA[0].severity, 'note');
  assert.equal(onA[0].id, 'teacher-away:dsample00a:on4:tsample001', 'the id names the entry, not the first class');
  assert.equal(onA[0].where.period, 1, 'Show me goes to the first class (Period 2)');
  assert.ok(onA[0].where.groupIds.length > 1, 'it names every group it touches');
  assert.match(onA[0].text, /^Ms\. Halloran is not in school on Fridays, and .+; .+ on A Day\. On those days those groups need another teacher\.$/);
  // two entries are two notes
  const two = ofKind(checkSchedule(withAway([entry({ weekdays: [4], periods: [1] }), entry({ weekdays: [3], periods: [2] })]), null), 'teacher-away').filter((finding) => finding.where.dayTypeId === A);
  assert.equal(two.length, 2, 'one for each entry');
});

// SV2-142b: an acceptance of a weekdays-only note holds as classes come and go
const NOTE = 'teacher-away:dsample00a:on4:tsample001';
const oldRecord = (period, groupId) => ({ findingId: 'teacher-away:dsample00a:' + period + ':tsample001', reason: 'A sub covers Fridays', at: '2026-09-01T12:00:00.000Z', about: [groupId, 'tsample001'].sort() });
const inRoom101 = (project, groupId, period, room) => { project.groups.find((group) => group.id === groupId).days[A][period].room = room; return project; };

test('SV2-142b: a note accepted one class at a time (before SV2-142) stays accepted as the merged note, and no record is gone', () => {
  for (const records of [[oldRecord(1, 'gsample08b')], [oldRecord(1, 'gsample08b'), oldRecord(2, 'gsample06a')], [oldRecord(2, 'gsample06a')]]) {
    const project = withAway([entry({ weekdays: [4] })]);
    project.accepted = records;
    assertValid(project);
    const result = checkSchedule(project, null);
    assert.equal(result.findings.some((finding) => finding.id === NOTE), false, 'the note does not count');
    const kept = result.accepted.find((finding) => finding.id === NOTE);
    assert.ok(kept, 'accepted under its own id');
    assert.equal(kept.accepted.reason, 'A sub covers Fridays');
    assert.deepEqual(kept.accepted.from, records.map((record) => record.findingId), 'the records it stands on');
    assert.deepEqual([result.changed, result.gone], [[], []], 'nothing changed, nothing put right');
    // taking it back removes every record it stands on, so it counts again
    const back = actions.unacceptFinding(project, { findingId: NOTE }, ctx());
    assert.deepEqual(back.accepted, []);
    assert.equal(checkSchedule(back, null).findings.some((finding) => finding.id === NOTE), true);
  }
});

test('SV2-142b: adding, removing or moving a class keeps an accepted note accepted, and removing the first class keeps the id', () => {
  const project = withAway([entry({ weekdays: [4] })]);
  const first = ofKind(checkSchedule(project, null), 'teacher-away').find((finding) => finding.where.dayTypeId === A);
  assert.equal(first.id, NOTE);
  const accepted = actions.acceptFinding(project, { findingId: NOTE, reason: 'A sub covers Fridays' }, ctx());
  const still = (changed, message) => {
    const result = checkSchedule(changed, null);
    assert.equal(result.findings.some((finding) => finding.id === NOTE), false, message + ': not counted');
    assert.ok(result.accepted.some((finding) => finding.id === NOTE), message + ': accepted under the same id');
    assert.deepEqual([result.changed, result.gone], [[], []], message + ': nothing changed or gone');
    return result.accepted.find((finding) => finding.id === NOTE);
  };
  // 7A into Room 101 in Period 1: a third class
  const added = still(inRoom101(clone(accepted), 'gsample07a', 0, 'rsample101'), 'a class added');
  assert.equal(added.where.groupIds.length, 3);
  // 8B (the first class, Period 2) moved out of Room 101
  const removed = still(inRoom101(clone(accepted), 'gsample08b', 1, 'rsample201'), 'the first class removed');
  assert.deepEqual(removed.where.groupIds, ['gsample06a']);
  assert.equal(removed.where.period, 2);
  // an old per-class record migrates the same way when the first class goes
  const old = withAway([entry({ weekdays: [4] })]);
  old.accepted = [oldRecord(1, 'gsample08b'), oldRecord(2, 'gsample06a')];
  const migrated = checkSchedule(inRoom101(old, 'gsample08b', 1, 'rsample201'), null);
  assert.ok(migrated.accepted.some((finding) => finding.id === NOTE));
  assert.deepEqual([migrated.changed, migrated.gone], [[], []], 'the record of the class that went is not "put right"');
});

test('SV2-142b: each weekdays-only entry has its own note, even where another holds in the same period', () => {
  const notesOnA = (away, project) => ofKind(checkSchedule(withAway(away, project), null), 'teacher-away').filter((finding) => finding.where.dayTypeId === A);
  // Thursdays and Fridays as two entries: two notes, not only the Friday one
  const two = notesOnA([entry({ weekdays: [4] }), entry({ weekdays: [3] })]);
  assert.deepEqual(two.map((finding) => finding.id).sort(), ['teacher-away:dsample00a:on3:tsample001', 'teacher-away:dsample00a:on4:tsample001']);
  assert.ok(two.some((finding) => / on Thursdays, /.test(finding.text)) && two.some((finding) => / on Fridays, /.test(finding.text)));
  // the same weekdays on A Day and on B Day (the same as A Day): two notes
  const followed = withFollower([]);
  const days = notesOnA([entry({ weekdays: [4], dayTypeIds: [A] }), entry({ weekdays: [4], dayTypeIds: [B] })], followed);
  assert.equal(days.length, 2, 'one note for each entry');
  assert.deepEqual(days.map((finding) => finding.id).sort(), ['teacher-away:dsample00a:on4ddsample00a:tsample001', 'teacher-away:dsample00a:on4ddsample00b:tsample001']);
});

test('the id and the day are this check\'s own: an accepted finding keeps its id when the day type that is the same as it changes', () => {
  const id = 'teacher-away:dsample00a:1:tsample001';
  const both = withFollower([entry({ dayTypeIds: [A, B], periods: [1] })]);
  const first = ofKind(checkSchedule(both, null), 'teacher-away');
  assert.equal(first[0].id, id);
  assert.equal(first.every((finding) => finding.where.dayTypeId === A), true, 'B Day has no finding of its own');
  assert.match(first[0].text, / on A Day and B Day, but /);
  const accepted = actions.acceptFinding(both, { findingId: id, reason: 'Covered' }, ctx());
  // the entry now names only the follower: the words change, the id does not
  const changed = clone(accepted);
  changed.teachers.find((one) => one.id === HALLORAN).away = [entry({ dayTypeIds: [B], periods: [1] })];
  const result = checkSchedule(changed, null);
  assert.equal(result.findings.some((finding) => finding.id === id), false, 'still accepted');
  const kept = result.accepted.find((finding) => finding.id === id);
  assert.ok(kept, 'listed as accepted under the same id');
  assert.match(kept.text, / on B Day, but /);
  assert.equal(kept.where.dayTypeId, A);
});

test('no-planning with a follower day type: away all day on a day type it is the same as counts, away on the follower alone does not', () => {
  const withC = (away) => {
    const project = busyHalloran(away);
    project.dayTypes.push({ id: 'dsample00c', name: 'C Day', own: false, sameAs: A, short: '', bells: Array(8).fill(null) });
    return project;
  };
  const planning = (project) => ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.dayTypeId === A);
  assert.equal(planning(withC()).length, 1, 'the setup raises it on A Day, which C Day shares');
  assert.equal(planning(withC([entry({ dayTypeIds: [A] })])).length, 0, 'away all day on A Day: C Day, the same as it, is away too');
  assert.equal(planning(withC([entry({ dayTypeIds: ['dsample00c'] })])).length, 1, 'C Day alone: A Day still has no planning');
  // every() over the members and the first member alone give the same answers here, since a follower is away whenever its own day type is: only some() is told apart (checked by breaking it)
});

test('no-planning names an away period apart from a duty: "they are not in school in Period 5 and Period 6"', () => {
  const project = school();
  project.teachers.find((one) => one.id === 'tsample002').away = [entry({ dayTypeIds: [A], periods: [4, 5] })];
  project.duties = [{ id: 'ugiven0001', kind: 'duty', label: '', when: 'period', period: 1, start: '', end: '', dayTypeIds: [A], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: ['tsample002'], subjectIds: [], everyone: false }];
  const found = ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === 'tsample002' && finding.where.dayTypeId === A);
  assert.equal(found.length, 1);
  assert.equal(found[0].text, 'Mr. Brightwater has no planning period on A Day: Period 2 is a duty and they are not in school in Period 5 and Period 6, and there is a group in every other period.');
});

test('a bell schedule\'s off period and a school No class mark take the period before an away entry does', () => {
  const project = withAway([entry({ dayTypeIds: [A], periods: [0, 3] })]);
  project.bellSchedules = [{ id: 'bsample001', name: 'Assembly', short: '', bells: project.dayTypes[0].bells.map((bell) => (bell ? { ...bell } : null)), off: [0] }];
  project.marks = [{ id: 'msample001', kind: 'noclass', label: 'Rally', period: 3, dayTypeIds: [], scope: 'school', grades: [], groupIds: [] }];
  const kinds = (options) => teacherDay(project, HALLORAN, A, options).map((one) => one.marked);
  assert.equal(kinds()[0], 'away', 'with the regular bells period 1 is away');
  assert.equal(kinds({ bellsId: 'bsample001' })[0], 'noclass', 'an off period is No class, not away');
  assert.equal(kinds()[3], 'noclass', 'a school No class mark is No class, not away');
  assert.equal(isFree(teacherDay(project, HALLORAN, A)[3]), false);
});

test('a name two periods share is not matched with a day type in front of it either: the column is ignored and the note says so', () => {
  const project = named([[1, 'Study'], [6, ' study ']]);
  const mapping = guessColumns(['Group', 'A Day Study', 'Study (B Day)', 'B Day: Period 7', 'A Day Period 2'], project);
  assert.deepEqual(brief(mapping), ['name', 'ignore', 'ignore', 'p6', 'p1']);
  assert.equal(mapping[1].note, 'Two periods are called "Study", so this column is not matched by that name. Call it by its number, like Period 2.');
  assert.equal(mapping[2].note, mapping[1].note);
  assert.equal(mapping[3].dayTypeId, B);
  // one period with that name still takes the prefix
  const once = named([[1, 'Study']]);
  const found = guessColumns(['Group', 'A Day Study', 'Study (B Day)'], once);
  assert.deepEqual(found.slice(1).map((item) => [item.period, item.dayTypeId]), [[1, A], [1, B]]);
});
