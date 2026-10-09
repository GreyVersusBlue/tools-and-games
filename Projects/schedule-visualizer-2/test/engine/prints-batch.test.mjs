// Batch printing (ui/prints/batch.js): every teacher's schedule and every
// door sign as one print document each, rendered in plain Node from the
// sample school, from a school with nothing in it, and from a school whose
// every name is hostile.
//
//   node test/engine/prints-batch.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, BATCHES, batchCount, batchWords } from '../../ui/prints/batch.js';
import { outputFor } from '../../ui/prints/index.js';
import { esc, TOOL_NAME } from '../../ui/prints/document.js';
import { teacherDay } from '../../engine/teacher-day.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { allRooms } from '../../engine/schema.js';
import { SAMPLE_SCHOOL_NAME } from '../../data/sample-school.js';
import { planProject } from '../fixtures/buildings/plans.mjs';
import { school, room, group, PINNED } from './helpers.mjs';

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = { now: PINNED };

const teachers = (project, options) => render(project, null, { ...NOW, ...options, batch: 'teachers' }).html;
const doors = (project, options) => render(project, null, { ...NOW, ...options, batch: 'doors' }).html;

function countOf(html, piece) {
  return html.split(piece).length - 1;
}

// The sheets of a document, in order: [{ kind, id, html }].
function sheetsOf(html) {
  const starts = Array.from(html.matchAll(/<section class="[^"]*\bnew-sheet\b[^"]*" data-sheet="([a-z]+)" data-id="([^"]*)">/g));
  return starts.map((match, at) => ({
    kind: match[1],
    id: match[2],
    html: html.slice(match.index, at + 1 < starts.length ? starts[at + 1].index : html.indexOf('</div>\n</section>\n<footer')),
  }));
}

// The body rows of each table on a sheet: [[[cell text, …], …], …], tags taken out.
function tablesOf(sheet) {
  return Array.from(sheet.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)).map((table) => Array.from(table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g))
    .map((row) => Array.from(row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)).map((cell) => cell[1].replace(/<span class="batch-day__time">[\s\S]*?<\/span>/, '').replace(/<[^>]+>/g, ''))));
}

const HOSTILE = [
  '<script>alert("s")</script>',
  '"><img src=x onerror=alert(1)>',
  '</title></style><svg onload=alert(2)>',
  "O'Neil & <b>Sons</b>",
  '<!-- -->&amp;&lt;',
];

// The sample school with a hostile string, each its own, in every name a
// batch sheet prints.
function hostileSchool() {
  const project = school();
  let next = 0;
  const made = [];
  const nasty = (what) => {
    const value = HOSTILE[next % HOSTILE.length] + ' #' + next;
    next += 1;
    made.push({ what, value });
    return value;
  };
  project.settings.schoolName = nasty('school');
  for (const floor of project.building.floors) {
    floor.name = nasty('floor');
    for (const space of floor.spaces) if (space.kind === 'room') space.number = nasty('room');
  }
  for (const subject of project.subjects) subject.name = nasty('subject');
  for (const teacher of project.teachers) teacher.name = nasty('teacher');
  for (const each of project.groups) {
    each.name = nasty('group');
    for (const day of Object.values(each.days)) for (const slot of day) if (slot.room) slot.label = nasty('label');
  }
  for (const dayType of project.dayTypes) dayType.name = nasty('day type');
  return { project, made };
}

// ---------------------------------------------------------------- the sample school

test('every teacher gets one new sheet, in the order of the Teachers list, after a cover that lists them', () => {
  const project = school();
  const html = teachers(project);
  const sheets = sheetsOf(html);
  assert.deepEqual(sheets.map((sheet) => sheet.id), project.teachers.map((teacher) => teacher.id));
  assert.equal(countOf(html, 'new-sheet'), project.teachers.length, 'one new-sheet a teacher and no other');
  assert.ok(sheets.every((sheet) => sheet.kind === 'teacher'));
  assert.equal(project.teachers.length, 12);
  sheets.forEach((sheet, at) => {
    const teacher = project.teachers[at];
    assert.equal(countOf(sheet.html, '<h2 class="batch-sheet__name">' + esc(teacher.name) + '</h2>'), 1, teacher.name);
    assert.ok(sheet.html.includes('<span>' + esc(SAMPLE_SCHOOL_NAME) + ' · Teacher schedule</span><span>1 September 2026</span>'), teacher.name + ': the line that says what the sheet is');
  });
  // the cover: the document's own header, the count, and every name once, before the first sheet
  const cover = html.slice(0, html.indexOf('new-sheet'));
  assert.ok(cover.includes('<h1 class="doc-head__what">Teacher schedules</h1>'));
  assert.ok(cover.includes('<p class="doc-lead">12 schedules follow, one sheet each, in the order of the Teachers list.</p>'));
  assert.equal(countOf(cover, '<li>'), 12);
  let last = -1;
  for (const teacher of project.teachers) {
    const at = cover.indexOf('<li>' + esc(teacher.name) + ' ');
    assert.ok(at > last, teacher.name + ' is on the cover, in order');
    last = at;
  }
});

test('a teacher\'s sheet is the engine\'s day for that teacher: a row a period on each day type, planning where the engine says planning', () => {
  const project = school();
  const sheets = sheetsOf(teachers(project));
  project.teachers.forEach((teacher, at) => {
    const tables = tablesOf(sheets[at].html);
    assert.equal(tables.length, project.dayTypes.length, teacher.name + ': the sample\'s two day types differ, so two tables side by side');
    assert.ok(sheets[at].html.includes('<div class="batch-days" style="--batch-days: 2;">'), teacher.name);
    project.dayTypes.forEach((dayType, d) => {
      const day = teacherDay(project, teacher.id, dayType.id);
      assert.equal(tables[d].length, project.settings.periods, teacher.name + ' on ' + dayType.name);
      day.forEach((entry, period) => {
        const [, what, where] = tables[d][period];
        if (entry.kind === 'planning') {
          assert.equal(what, 'Planning', teacher.name + ', ' + dayType.name + ', period ' + period);
          assert.equal(where, '');
        } else {
          for (const taught of entry.groups) {
            const name = project.groups.find((each) => each.id === taught.groupId).name;
            assert.ok(what.includes(name), teacher.name + ' has ' + name + ' in period ' + period + ' on ' + dayType.name + ': ' + what);
          }
          assert.notEqual(where, '', teacher.name + ': a class is somewhere');
        }
      });
    });
  });
  // one teacher, spelled out: Ms. Halloran's A Day
  const halloran = tablesOf(sheets[0].html)[0];
  assert.deepEqual(halloran.slice(0, 4), [['Period 1', 'Planning', ''], ['Period 2', '8B', 'Room 101'], ['Period 3', '6A', 'Room 101'], ['Period 4', 'Planning', '']]);
  assert.ok(sheets[0].html.includes('<p class="batch-sheet__facts">Mathematics · Room 101</p>'));
  assert.ok(sheets[0].html.includes('<span class="batch-day__time">8:52 AM to 9:40 AM</span>'), 'the bell times, in the school\'s format');
  assert.ok(sheets[0].html.includes('<p class="batch-sheet__says">Teaches 2 classes on A Day and 3 on B Day. Has 6 planning periods on A Day and 5 on B Day.</p>'), 'the staff browser\'s own sentence');
});

test('day types that are the same share one table, named for both', () => {
  const project = school();
  project.dayTypes[1].own = false;
  for (const each of project.groups) delete each.days[project.dayTypes[1].id];
  project.dayTypes[1].bells = project.dayTypes[0].bells.map((bell) => (bell ? { ...bell } : null));
  const sheet = sheetsOf(teachers(project))[0].html;
  assert.equal(tablesOf(sheet).length, 1);
  assert.ok(sheet.includes('<h2 class="batch-day__name">A Day and B Day</h2>'));
  assert.ok(sheet.includes('style="--batch-days: 1;"'));
});

test('a class in a room that is not in the building is printed with the room as typed, and says so', () => {
  const project = school();
  const slot = group(project, '8B').days[project.dayTypes[0].id][1];
  assert.equal(slot.room, room(project, '101').id, 'the fixture this case stands on');
  // with no room to say whose class it is, the slot names its teacher itself
  slot.room = null;
  slot.roomText = 'Portable <9>';
  slot.teacherIds = [project.teachers[0].id];
  const halloran = tablesOf(sheetsOf(teachers(project))[0].html)[0];
  assert.deepEqual(halloran[1], ['Period 2', '8B', 'Portable &lt;9&gt; · not in the building']);
});

test('every room gets one door sign, in the order of the building, after a cover that lists them', () => {
  const project = school();
  const rooms = allRooms(project);
  const html = doors(project);
  const sheets = sheetsOf(html);
  assert.equal(rooms.length, 13);
  assert.deepEqual(sheets.map((sheet) => sheet.id), rooms.map((each) => each.id));
  assert.equal(countOf(html, 'new-sheet'), rooms.length);
  assert.ok(sheets.every((sheet) => sheet.kind === 'door'));
  assert.ok(html.includes('<p class="doc-lead">13 door signs follow, one sheet each, in the order of the building’s floors.</p>'));
  assert.equal(countOf(html.slice(0, html.indexOf('new-sheet')), '<li>'), 13);
  assert.equal(countOf(html, '<table'), 0, 'no day on a sign unless it is asked for');
  assert.equal(countOf(html, '<p class="batch-sign__school">' + esc(SAMPLE_SCHOOL_NAME) + '</p>'), 13, 'the school at the foot of every sign');
});

test('a sign: "Room" over a number, a named room alone, the teacher and the subject, a long name set smaller', () => {
  const project = school();
  const sheets = sheetsOf(doors(project));
  const byId = (id) => sheets.find((sheet) => sheet.id === id).html;

  const numbered = byId(room(project, '203').id);
  assert.ok(numbered.includes('<p class="batch-sign__word">Room</p>\n<p class="batch-sign__number" style="--sign-fit: 1;">203</p>'));
  assert.ok(numbered.includes('<p class="batch-sign__teacher">Ms. Vandermeer</p>'));
  assert.ok(numbered.includes('<p class="batch-sign__subject">Social Studies</p>'));

  const gym = byId(room(project, 'Gym').id);
  assert.equal(countOf(gym, 'batch-sign__word'), 0, 'a room with a name is not "Room Gym"');
  assert.ok(gym.includes('<p class="batch-sign__number" style="--sign-fit: 1;">Gym</p>'));

  // nine letters at 120 pt would run off the sheet: seven fit, so it is set at 7/9 of the size
  const cafeteria = byId(room(project, 'Cafeteria').id);
  assert.ok(cafeteria.includes('<p class="batch-sign__number" style="--sign-fit: ' + String(7 / 9) + ';">Cafeteria</p>'));
  assert.equal(countOf(cafeteria, 'batch-sign__teacher'), 0, 'no teacher is based in the Cafeteria, so no line for one');

  // a room with no number still gets a sign, and it does not invent one
  room(project, '101').number = '  ';
  const blank = sheetsOf(doors(project)).find((sheet) => sheet.id === allRooms(project)[0].id).html;
  assert.ok(blank.includes('<p class="batch-sign__number" style="--sign-fit: 1;">Room</p>'));
  assert.equal(countOf(blank, 'batch-sign__word'), 0);
});

test('with the room\'s day, a sign shows who is there each period, and a double-booked room shows both groups', () => {
  const project = school();
  const sheets = sheetsOf(doors(project, { day: true }));
  assert.equal(sheets.length, 13);
  const sign = sheets.find((sheet) => sheet.id === room(project, '203').id).html;
  const [aDay, bDay] = tablesOf(sign);
  assert.equal(aDay.length, 8);
  assert.equal(bDay.length, 8);
  assert.deepEqual(aDay[0], ['Period 1', '6B', 'Ms. Vandermeer']);
  assert.deepEqual(aDay[1], ['Period 2', '6C and 7C', 'Ms. Vandermeer'], 'the sample\'s double-booking: neither group is dropped');
  assert.deepEqual(aDay[4], ['Period 5', 'Empty', '']);
  // against the schedule itself, for every room and period: a group is on the sign exactly when its slot names the room
  for (const each of allRooms(project)) {
    const tables = tablesOf(sheets.find((sheet) => sheet.id === each.id).html);
    project.dayTypes.forEach((dayType, d) => {
      for (let period = 0; period < project.settings.periods; period += 1) {
        const here = project.groups.filter((candidate) => effectiveSchedule(project, candidate.id, dayType.id)[period].room === each.id).map((candidate) => candidate.name);
        const cell = tables[d][period][1];
        if (here.length === 0) assert.equal(cell, 'Empty', each.number + ' period ' + period);
        else for (const name of here) assert.ok(cell.split(/, | and /).includes(name), each.number + ' period ' + period + ' on ' + dayType.name + ' has ' + name + ': ' + cell);
      }
    });
  }
});

// ---------------------------------------------------------------- the three outputs

test('the three batch outputs are in the list the preview sheet reads, each with its own fixed choice', () => {
  assert.deepEqual(BATCHES.map((batch) => batch.id), ['teacher-schedules', 'door-signs', 'door-signs-day']);
  const project = school();
  for (const batch of BATCHES) {
    assert.equal(outputFor(batch.id), batch);
    const { title, html } = batch.render(project, null, NOW);
    assert.equal(title, batch.name + ' · ' + SAMPLE_SCHOOL_NAME);
    assert.ok(html.includes('data-output="' + batch.id + '"'), batch.id);
    assert.equal(countOf(html, '<section class="page">'), 1, batch.id + ': one .page, the sheets inside it');
    assert.equal(countOf(html, '<footer class="doc-foot">' + TOOL_NAME + '</footer>'), 1);
  }
  // what the preview sheet passes cannot turn one batch into another
  assert.equal(BATCHES[0].render(project, null, { ...NOW, batch: 'doors' }).html, teachers(project));
  assert.equal(BATCHES[1].render(project, null, { ...NOW, day: true }).html, doors(project));
  assert.equal(BATCHES[2].render(project, null, NOW).html, doors(project, { day: true }));
  assert.equal(batchCount(project, 'teachers'), 12);
  assert.equal(batchCount(project, 'doors'), 13);
  assert.deepEqual(batchWords(project), { teachers: '12 teachers', rooms: '13 rooms' });
});

test('the same project and options give the same document, and the date is the one given', () => {
  for (const batch of BATCHES) {
    assert.equal(batch.render(school(), null, NOW).html, batch.render(school(), null, NOW).html, batch.id);
    const undated = batch.render(school(), null, {}).html;
    assert.equal(countOf(undated, 'September 2026'), 0, batch.id + ': no date was given, so none is printed');
    assert.doesNotMatch(undated, /\b20\d\d\b/, batch.id + ': and no clock was read for one');
  }
});

test('a school with no teachers, or no rooms, gets a sentence and no sheets', () => {
  const project = planProject([['.....']]);
  const noTeachers = teachers(project);
  assert.ok(noTeachers.includes('<p class="doc-lead">There are no teachers in the schedule yet, so there is no schedule to print.</p>'));
  assert.equal(countOf(noTeachers, 'new-sheet'), 0);
  assert.equal(countOf(noTeachers, '<ul'), 0);
  const noRooms = doors(project);
  assert.ok(noRooms.includes('<p class="doc-lead">There are no rooms in the building yet, so there is no sign to print.</p>'));
  assert.equal(countOf(noRooms, 'new-sheet'), 0);

  const one = school();
  one.teachers.length = 1;
  assert.ok(teachers(one).includes('<p class="doc-lead">One schedule follows, in the order of the Teachers list.</p>'));
});

test('a school with no name prints under the tool\'s name on every sheet', () => {
  const project = school();
  project.settings.schoolName = '  ';
  assert.equal(countOf(teachers(project), '<span>' + TOOL_NAME + ' · Teacher schedule</span>'), 12);
  assert.equal(countOf(doors(project), '<p class="batch-sign__school">' + TOOL_NAME + '</p>'), 13);
});

// ---------------------------------------------------------------- hostile names

const TAGS = new Set(['html', 'head', 'meta', 'title', 'link', 'style', 'body', 'section', 'header', 'footer', 'div', 'p', 'h1', 'h2', 'ul', 'li', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);

test('hostile names come through every batch as text, never as markup', () => {
  const { project, made } = hostileSchool();
  const expected = {
    'teacher-schedules': ['school', 'room', 'teacher', 'subject', 'group', 'label', 'day type'],
    'door-signs': ['school', 'floor', 'room', 'teacher', 'subject'],
    'door-signs-day': ['school', 'floor', 'room', 'teacher', 'subject', 'group', 'day type'],
  };
  for (const batch of BATCHES) {
    const { title, html } = batch.render(project, null, NOW);
    assert.ok(title.includes(project.settings.schoolName), batch.id + ': the title is the name as typed');
    for (const { what, value } of made) assert.equal(countOf(html, value), 0, batch.id + ': the ' + what + ' name ' + value + ' is in the markup as typed');
    for (const raw of HOSTILE) assert.equal(countOf(html, raw), 0, batch.id + ': ' + raw);
    for (const what of expected[batch.id]) {
      const names = made.filter((entry) => entry.what === what);
      assert.ok(names.some((entry) => html.includes(esc(entry.value))), batch.id + ': no ' + what + ' name was printed at all');
    }
    const stray = Array.from(html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)).map((match) => match[1]).filter((tag) => !TAGS.has(tag));
    assert.deepEqual(stray, [], batch.id + ': a tag that no batch document has');
    assert.equal(countOf(html, '<script'), 0, batch.id);
    assert.equal(countOf(html, '<style'), 1, batch.id + ': the page rule and no other style');
    assert.doesNotMatch(html.replace(/="[^"]*"/g, ''), /<[^>]*\son[a-z]+\s*=/i, batch.id + ': an event handler attribute');
    // every teacher and every room is still there, one sheet each
    assert.equal(countOf(html, 'new-sheet'), batch.id === 'teacher-schedules' ? project.teachers.length : allRooms(project).length, batch.id);
  }
  // each teacher's name is on its own sheet, escaped, exactly as typed
  const sheets = sheetsOf(teachers(project));
  project.teachers.forEach((teacher, at) => {
    assert.ok(sheets[at].html.includes('<h2 class="batch-sheet__name">' + esc(teacher.name) + '</h2>'), 'teacher ' + at);
  });
  // a long hostile room number is a number like any other: on the sign once, escaped, and sized by its length
  const sign = sheetsOf(doors(project))[0].html;
  const number = allRooms(project)[0].number;
  assert.equal(countOf(sign, '>' + esc(number) + '</p>'), 1);
  assert.match(sign, /style="--sign-fit: 0\.\d+;"/);
});

// ---------------------------------------------------------------- the sheets' rules

test('every class a batch sheet uses has a rule in print.css, under the document\'s root', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8');
  const used = new Set();
  for (const batch of BATCHES) {
    for (const match of batch.render(school(), null, NOW).html.matchAll(/class="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) if (name.startsWith('batch-')) used.add(name);
    }
  }
  assert.ok(used.size >= 15, 'the sheets are made of batch- classes: ' + used.size);
  for (const name of used) {
    if (name === 'batch-sheet--teacher' || name === 'batch-day') continue; // a hook for a later rule, and a plain section
    assert.match(css, new RegExp('\\.print-doc \\.' + name + '(?![a-zA-Z0-9_-])'), name);
  }
  assert.match(css, /\.print-doc \.batch-sign__number \{[^}]*font-size: calc\(120pt \* var\(--sign-fit, 1\)\)/, 'the number at 120 pt (DESIGN 7), times the fit');
});
