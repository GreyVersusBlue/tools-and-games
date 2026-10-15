// Batch printing (ui/prints/batch.js): every teacher's schedule and every
// door sign as one print document each, rendered in plain Node from the
// sample school, from a school with nothing in it, and from a school whose
// every name is hostile. A door sign in the batch is the staff browser's own
// sign (doorSignMarkup, staff/views/door-sign.js), made from the published
// model: the cases at the end hold the two together.
//
//   node test/engine/prints-batch.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, BATCHES, batchCount, batchWords } from '../../ui/prints/batch.js';
import * as doorModule from '../../staff/views/door-sign.js';
import { openSchool } from '../../staff/model.js';
import { publishedModel } from '../../engine/publish-data.js';
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

// A line of a sign as the builder writes it: a name somebody typed is kept
// apart from the words around it, in a span with dir="auto".
const typedName = (text) => '<span dir="auto">' + esc(text) + '</span>';
const signLine = (part, text) => '<p class="sign__' + part + '" data-sign="' + part + '">' + typedName(text) + '</p>';
const signNumber = (fit, text, plain) => '<p class="sign__number" style="--sign-fit: ' + fit + '" data-sign="number">' + (plain ? esc(text) : typedName(text)) + '</p>';

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
  // noon on the device, with no zone: the day printed is the same in every zone the test runs in
  const html = teachers(project, { now: '2026-09-01T12:00:00' });
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
  assert.equal(countOf(html, signLine('school', SAMPLE_SCHOOL_NAME)), 13, 'the school at the foot of every sign');
});

test('a sign: "Room" over a number, a named room alone, the teacher and the subject, a long name set smaller', () => {
  const project = school();
  const sheets = sheetsOf(doors(project));
  const byId = (id) => sheets.find((sheet) => sheet.id === id).html;

  const numbered = byId(room(project, '203').id);
  assert.ok(numbered.includes('<p class="sign__word">Room</p>' + signNumber(1, '203')));
  assert.ok(numbered.includes(signLine('teacher', 'Ms. Vandermeer')));
  assert.ok(numbered.includes(signLine('subject', 'Social Studies')));

  const gym = byId(room(project, 'Gym').id);
  assert.equal(countOf(gym, 'sign__word'), 0, 'a room with a name is not "Room Gym"');
  assert.ok(gym.includes(signNumber(1, 'Gym')));

  // nine letters at 120 pt would run off the sheet: seven fit, so it is set at 7/9 of the size
  const cafeteria = byId(room(project, 'Cafeteria').id);
  assert.ok(cafeteria.includes(signNumber(String(7 / 9), 'Cafeteria')));
  assert.equal(countOf(cafeteria, 'sign__teacher'), 0, 'no teacher is based in the Cafeteria, so no line for one');

  // a room with no number still gets a sign, and it does not invent one
  room(project, '101').number = '  ';
  const blank = sheetsOf(doors(project)).find((sheet) => sheet.id === allRooms(project)[0].id).html;
  assert.ok(blank.includes(signNumber(1, 'Room', true)));
  assert.equal(countOf(blank, 'sign__word'), 0);
});

test('with the room\'s day, a sign shows who is there each period, and a double-booked room shows both groups', () => {
  const project = school();
  const sheets = sheetsOf(doors(project, { day: true }));
  assert.equal(sheets.length, 13);
  const sign = sheets.find((sheet) => sheet.id === room(project, '203').id).html;
  const [aDay, bDay] = tablesOf(sign);
  assert.equal(aDay.length, 8);
  assert.equal(bDay.length, 8);
  assert.deepEqual(aDay[0], ['Period 1', '8:00 AM to 8:48 AM', '6B', 'Ms. Vandermeer'], 'the four columns of the staff browser\'s own sign');
  assert.deepEqual(aDay[1], ['Period 2', '8:52 AM to 9:40 AM', '6C and 7C', 'Ms. Vandermeer'], 'the sample\'s double-booking: neither group is dropped');
  assert.deepEqual(aDay[4], ['Period 5', '11:28 AM to 12:16 PM', 'Empty', '']);
  // against the schedule itself, for every room and period: a group is on the sign exactly when its slot names the room
  for (const each of allRooms(project)) {
    const tables = tablesOf(sheets.find((sheet) => sheet.id === each.id).html);
    project.dayTypes.forEach((dayType, d) => {
      for (let period = 0; period < project.settings.periods; period += 1) {
        const here = project.groups.filter((candidate) => effectiveSchedule(project, candidate.id, dayType.id)[period].room === each.id).map((candidate) => candidate.name);
        const cell = tables[d][period][2];
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
    // SV2-49 item 3: no closing line after the last sheet, which is as tall as the paper; a browser
    // with no page margin boxes printed that line on a sheet of its own, one more than the preview said
    assert.equal(countOf(html, 'doc-foot'), 0, batch.id + ': a batch has no closing line');
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
  assert.equal(countOf(doors(project), signLine('school', TOOL_NAME)), 13);
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
  assert.equal(countOf(sign, typedName(number) + '</p>'), 1);
  assert.match(sign, /style="--sign-fit: 0\.\d+"/);
});

// ---------------------------------------------------------------- the sheets' rules

test('every class a batch sheet uses has a rule in print.css, under the document\'s root', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8');
  const used = new Set();
  for (const batch of BATCHES) {
    for (const match of batch.render(school(), null, NOW).html.matchAll(/class="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) if (name.startsWith('batch-') || name.startsWith('sign')) used.add(name);
    }
  }
  assert.ok(used.size >= 20, 'the sheets are made of batch- classes and the sign\'s own: ' + used.size);
  for (const name of used) {
    if (name === 'batch-sheet--teacher' || name === 'batch-day' || name === 'sign__kind') continue; // a hook for a later rule, and two plain sections
    assert.match(css, new RegExp('\\.print-doc \\.' + name + '(?![a-zA-Z0-9_-])'), name);
  }
  assert.match(css, /\.print-doc \.sign__number \{[^}]*font-size: calc\(120pt \* var\(--sign-fit, 1\)\)/, 'the number at 120 pt (DESIGN 7), times the fit');
  // the batch has no sign of its own any more: what is left for it is the sheet
  assert.deepEqual(Array.from(used).filter((name) => name.startsWith('batch-sign')), ['batch-sign']);
  assert.equal(countOf(css, '.batch-sign__'), 0, 'a rule for a second door sign');
});

// ---------------------------------------------------------------- one door sign (SV2-41)

const model = (project) => openSchool(publishedModel(project, { clock: () => new Date(PINNED) }));

// The declarations of every rule in `css` whose selector starts with `prefix`
// then ".sign": { '.sign__number': { 'font-size': '…' } }.
function signRules(css, prefix) {
  const rules = {};
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(',').map((each) => each.trim())) {
      if (!selector.startsWith(prefix + '.sign')) continue;
      const name = selector.slice(prefix.length);
      rules[name] = rules[name] || {};
      for (const line of match[2].split(';')) {
        const at = line.indexOf(':');
        if (at !== -1) rules[name][line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
    }
  }
  return rules;
}

test('a door sign in the batch is the staff browser\'s own sign for that room, row for row', () => {
  const build = doorModule.doorSignMarkup;
  assert.equal(typeof build, 'function', 'staff/views/door-sign.js has no string-returning builder of the sign');
  const project = school();
  for (const day of [false, true]) {
    const sheets = sheetsOf(doors(project, { day }));
    for (const each of allRooms(project)) {
      const own = build(model(project), model(project).room(each.id), { day, school: SAMPLE_SCHOOL_NAME });
      const sheet = sheets.find((candidate) => candidate.id === each.id).html;
      assert.deepEqual(tablesOf(sheet), tablesOf(own), each.number + ': the rows of the room\'s day');
      assert.ok(sheet.includes(own), each.number + ': the batch sheet holds the sign whole');
      assert.equal(countOf(sheet, 'class="sign"'), 1, each.number);
    }
  }
  const rows = tablesOf(build(model(project), model(project).room('rsample203'), { day: true }))[0];
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => row.length === 4), 'period, time, group, teacher');
  // the builder is text in and text out: it stands in plain Node, where there is no page
  assert.equal(typeof globalThis.document, 'undefined');
});

test('a room whose teachers are of different subjects names no subject; teachers of one subject name theirs', () => {
  const project = school();
  const shared = room(project, '203');
  const sign = () => sheetsOf(doors(project)).find((sheet) => sheet.id === shared.id).html;
  assert.ok(sign().includes(signLine('subject', 'Social Studies')), 'the room\'s own subject');
  const first = project.teachers[0];
  const second = project.teachers.find((teacher) => teacher.subjectId !== first.subjectId);
  assert.notEqual(first.subjectId, second.subjectId, 'the fixture this case stands on');
  shared.subjectId = null;
  shared.teacherIds = [first.id, second.id];
  assert.equal(countOf(sign(), 'sign__subject'), 0, 'the first teacher\'s subject is not the room\'s: ' + sign());
  assert.ok(sign().includes(signLine('teacher', first.name).replace('</p>', ' and ' + typedName(second.name) + '</p>')), 'both teachers are named');
  second.subjectId = first.subjectId;
  assert.ok(sign().includes(signLine('subject', 'Mathematics')), 'two teachers of one subject');
  shared.teacherIds = [first.id];
  assert.ok(sign().includes(signLine('subject', 'Mathematics')), 'one teacher: theirs');
});

test('the batch is made from the published model: the project\'s own objects are read once, by the publisher', () => {
  const project = school();
  const watched = room(project, '203');
  let reads = 0;
  Object.defineProperty(watched, 'number', { enumerable: true, get: () => { reads += 1; return '203'; } });
  const html = doors(project, { day: true });
  assert.ok(sheetsOf(html).find((sheet) => sheet.id === watched.id).html.includes(signNumber(1, '203')));
  assert.equal(reads, 1, 'the room\'s number was read ' + reads + ' times: a sheet is asking the project, not the copy the staff browser gets');
  // and a field the published file does not carry cannot be on a sheet
  const marked = school();
  marked.teachers[0].planner = 'PLANNER-ONLY';
  for (const each of marked.groups) each.headCount = 987;
  for (const batch of BATCHES) assert.equal(batch.render(marked, null, NOW).html, batch.render(school(), null, NOW).html, batch.id);
  // no date given is no date read: the publisher's clock is not the machine's
  assert.equal(doors(school(), { now: undefined }), render(school(), null, { batch: 'doors' }).html);
});

// What a value says once the tokens both sheets share are written out: a
// weight by its number, and the plan face with or without its fallback.
function plain(value) {
  return value
    .replace(/var\(--w-regular\)/g, '400').replace(/var\(--w-medium\)/g, '500').replace(/var\(--w-semibold\)/g, '600').replace(/var\(--w-bold\)/g, '700')
    .replace(/var\(--font-plan, var\(--font-ui\)\)/g, 'var(--font-plan)');
}

// The sign's rules in the staff sheet, as they stand on paper: each property
// is what the paper rule says, or, where the paper rules say nothing, what
// the screen rule says, since that is what cascades onto the paper. The
// phone's rules (a screen under 640 px) and the container-unit sizes behind
// @supports are no part of that.
function staffSign() {
  const staff = readFileSync(path.join(TOOL_DIR, 'staff', 'staff.css'), 'utf8').replace(/\r\n?/g, '\n');
  const block = staff.slice(staff.indexOf('/* ---------- SV2-23:'), staff.indexOf('/* ---------- SV2-23: end'));
  const printAt = block.indexOf('@media print');
  let screen = block.slice(0, printAt);
  for (const start of ['@media screen and (max-width: 639.98px) {', '@supports (font-size: 1cqw) {']) {
    const from = screen.indexOf(start);
    assert.notEqual(from, -1, 'the staff sheet has ' + start);
    screen = screen.slice(0, from) + screen.slice(screen.indexOf('\n}\n', from) + 3);
  }
  return { screen: signRules(screen, ''), paper: signRules(block.slice(printAt), '') };
}

// Properties a size on screen is given in (rem, then container units) and the
// paper rules always replace: the screen's value never reaches paper.
const SCREEN_SIZES = ['font-size', 'padding', 'padding-top', 'margin-top', 'gap'];
// What print.css has to say that the staff sheet does not: a print document
// has no reset, so each line of the sign takes its browser margin off.
const ONLY_IN_PRINT = { margin: '0' };

test('the sign\'s paper rules say the same in the staff browser\'s sheet and in the print document\'s, each way, with what cascades from the screen', () => {
  const staff = staffSign();
  const batch = signRules(readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8').replace(/\r\n?/g, '\n'), '.print-doc ');
  assert.ok(Object.keys(staff.paper).length >= 8, 'the staff sheet\'s paper rules for the sign: ' + Object.keys(staff.paper).join(' '));
  // what the staff sheet says of a property on paper, or undefined
  const onPaper = (selector, property) => {
    const paper = staff.paper[selector] && staff.paper[selector][property];
    if (paper !== undefined) return paper;
    const screen = staff.screen[selector] ? staff.screen[selector][property] : undefined;
    // a size the screen gives in its own units is the screen's alone; "auto" is not a size
    if (screen !== undefined && SCREEN_SIZES.includes(property) && /rem|cqw/.test(screen)) return undefined;
    return screen;
  };
  // one way: everything the staff sheet's paper is, the print document is
  let compared = 0;
  const cascaded = [];
  for (const selector of new Set([...Object.keys(staff.paper), ...Object.keys(staff.screen)])) {
    for (const property of new Set([...Object.keys(staff.paper[selector] || {}), ...Object.keys(staff.screen[selector] || {})])) {
      const want = onPaper(selector, property);
      if (want === undefined) continue;
      assert.ok(batch[selector], 'print.css has no rule for ' + selector);
      assert.equal(plain(batch[selector][property] === undefined ? '(nothing)' : batch[selector][property]), plain(want), selector + ' { ' + property + ' } on paper: print.css against staff.css');
      compared += 1;
      if (!(staff.paper[selector] && property in staff.paper[selector])) cascaded.push(selector + ' ' + property);
    }
  }
  // the other way: everything the print document says, the staff sheet's paper says
  for (const [selector, declared] of Object.entries(batch)) {
    for (const [property, value] of Object.entries(declared)) {
      if (ONLY_IN_PRINT[property] === value) continue;
      const want = onPaper(selector, property);
      assert.notEqual(want, undefined, 'print.css says ' + selector + ' { ' + property + ': ' + value + ' } and the staff sheet says nothing of it on paper');
      assert.equal(plain(value), plain(want), selector + ' { ' + property + ' } on paper: staff.css against print.css');
    }
  }
  assert.ok(compared >= 60, 'compared ' + compared + ' declarations');
  // the ones that reach paper from the screen rules are in the comparison: the face and its weight, the line, the spacing of the word "Room", the table's rule
  for (const each of ['.sign__word font-family', '.sign__word letter-spacing', '.sign__word text-transform', '.sign__number font-weight', '.sign__number line-height', '.sign__number overflow-wrap',
    '.sign__teacher font-weight', '.sign__teacher line-height', '.sign__subject color', '.sign__table line-height', '.sign__table border-collapse', '.sign__school color']) {
    assert.ok(cascaded.includes(each), each + ' reaches paper from the screen rule and was compared');
  }
  // and the rule under each row of the day is the same hairline in both, in a paper unit
  assert.equal(staff.paper['.sign__table th']['border-top'], '0.2mm solid var(--line)');
  assert.equal(batch['.sign__table th']['border-top'], '0.2mm solid var(--line)');
});

test('a number too long for one line wraps on the sheet: nothing keeps it on one line', () => {
  const css = readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8');
  const rules = signRules(css, '.print-doc ');
  assert.ok(rules['.sign__number'], 'print.css has no rule for the number');
  assert.equal(rules['.sign__number']['white-space'], undefined);
  assert.equal(rules['.sign__number']['overflow-wrap'], 'anywhere');
  // only the period column of a teacher schedule is kept on one line, and a name with the comma after it (SV2-51 item 9); the sign wraps between its words (SV2-45 item 4)
  assert.equal(countOf(css.slice(css.indexOf('SV2-24: batch sheets')), 'nowrap'), 2);
  assert.equal(rules['.sign__with']['white-space'], 'nowrap');
  assert.equal(rules['.sign__with > span']['white-space'], 'normal', 'the name inside still wraps');
});

// SV2-51 item 9. A browser with no container units drops a 36cqw width, and a
// name of sixty letters would then stand whole, past the sheet. staff.css
// gives each such size a line before it in another unit; print.css's names
// have the same.
test('a name\'s 36cqw has a line before it in a unit every browser knows, in print.css as in staff.css', () => {
  const block = (css, selector) => {
    const at = css.indexOf('\n' + selector + ' {');
    assert.notEqual(at, -1, selector);
    return css.slice(at, css.indexOf('}', at));
  };
  const widths = (text) => Array.from(text.matchAll(/max-width:\s*([^;]+);/g), (match) => match[1].trim());
  const print = widths(block(readFileSync(path.join(TOOL_DIR, 'ui', 'print.css'), 'utf8').replace(/\r\n?/g, '\n'), '.print-doc .sign__table td span[dir]'));
  const staff = widths(block(readFileSync(path.join(TOOL_DIR, 'staff', 'staff.css'), 'utf8').replace(/\r\n?/g, '\n'), '.sign__table td span[dir]'));
  for (const [sheet, list] of [['staff.css', staff], ['print.css', print]]) {
    assert.equal(list.length, 2, sheet + ': ' + list.join(', '));
    assert.equal(list[1], '36cqw', sheet);
    assert.doesNotMatch(list[0], /cq/, sheet + ': the line before is in a unit every browser knows');
  }
});
