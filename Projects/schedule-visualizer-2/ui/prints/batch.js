// Batch printing (spec 12.4): every teacher's schedule, or every door sign,
// as one print document, so a whole school's worth goes to the printer (or to
// one PDF) in a single job.
//
// render(project, derived, options) → { title, html }
//   options.batch  'teachers' (the default) or 'doors'
//   options.day    doors only: true puts the room's day on each sign
//   and what every output takes (document.js)
//
// The first sheet is a cover: the header every print document has, and the
// list of what follows, in order, so a pile can be checked against it. After
// it comes one sheet per teacher or per room, each an element with the class
// "new-sheet".
//
// What a sheet says is the staff browser's own answer, from the staff
// browser's own data: the project is published first (publishedModel, the
// copy a published file carries) and the school is opened from that copy the
// way the staff browser opens it (staff/model.js), so nothing the planner
// alone knows can be on a sheet. A teacher's day and the sentence about it
// are staff/views/teacher.js's and are written out here as text with every
// name escaped, because a print document is a string. A door sign is not
// written here at all: it is the staff browser's sign (doorSignMarkup,
// staff/views/door-sign.js), put inside a sheet. The sheets' rules are the
// marked block at the end of ui/print.css.
//
// BATCHES are the three entries ui/prints/index.js lists, each with the fixed
// options the preview sheet cannot pass.
//
// A door sign is an upright sheet: the number, the teacher and the room's day
// under them are about 227 mm tall, and a sheet turned on its side has 188.
// So the door signs print in portrait whatever orientation is chosen: the
// entries say so (`upright`), the preview sheet offers no orientation for
// them, and render() itself turns a landscape sheet upright and says so on
// the cover.

import { count } from '../components/words.js';
import { publishedModel } from '../../engine/publish-data.js';
import { openSchool } from '../../staff/model.js';
import { wordsJoined, partsToText, dayKindsOf, teacherSummaryOf } from '../../staff/views/teacher.js';
import { doorSignMarkup } from '../../staff/views/door-sign.js';
import { esc, frame, paperOf, printDate, schoolName } from './document.js';

export const UPRIGHT_SENTENCE = 'Door signs are upright sheets: they print in portrait.';
export const UPRIGHT_COVER = 'Landscape is chosen for this project. Door signs are upright sheets, so these print in portrait.';

export const id = 'batch';
export const name = 'Batch printing';

const NOT_IN_BUILDING = 'not in the building';

// "a", "a and b", "a, b and c", as text.
function joined(items) {
  return wordsJoined(items).join('');
}

function kindTitle(kind) {
  return joined(kind.dayTypes.map((dayType) => dayType.name));
}

function when(school, bell) {
  return bell && bell.start && bell.end ? school.time(bell.start) + ' to ' + school.time(bell.end) : '';
}

// One kind of day as a table. `rowOf(dayType, period)` gives the cells after
// the period's own, each already markup.
function dayTable(school, kind, heads, rowOf) {
  const bells = school.bells(kind.first.id);
  const out = ['<section class="batch-day">', '<h2 class="batch-day__name">' + esc(kindTitle(kind)) + '</h2>', '<table class="batch-day__table">'];
  out.push('<thead><tr>' + heads.map((head) => '<th scope="col">' + esc(head) + '</th>').join('') + '</tr></thead>', '<tbody>');
  bells.forEach((bell, period) => {
    const time = when(school, bell);
    out.push('<tr><th scope="row">' + esc(school.periodName(period)) + (time === '' ? '' : '<span class="batch-day__time">' + esc(time) + '</span>') + '</th>'
      + rowOf(kind.first, period).map((cell) => '<td>' + cell + '</td>').join('') + '</tr>');
  });
  out.push('</tbody>', '</table>', '</section>');
  return out.join('\n');
}

function days(kinds, tables) {
  return '<div class="batch-days" style="--batch-days: ' + Math.min(kinds.length, 3) + ';">\n' + tables.join('\n') + '\n</div>';
}

const quiet = (text) => '<span class="batch-day__quiet">' + esc(text) + '</span>';

// The line at the top of every sheet: the school, what this is, the date.
function sheetLine(project, what, options) {
  const date = printDate(options.now);
  return '<p class="batch-sheet__line"><span>' + esc(schoolName(project)) + ' · ' + esc(what) + '</span>' + (date === '' ? '' : '<span>' + esc(date) + '</span>') + '</p>';
}

// ---------------------------------------------------------------- teachers

function slotRoom(school, slot) {
  const room = slot && slot.room ? school.room(slot.room) : null;
  if (room) return school.roomName(room, true);
  const text = slot && typeof slot.roomText === 'string' ? slot.roomText : '';
  return text === '' ? null : text + ' · ' + NOT_IN_BUILDING;
}

function teacherSheet(project, school, teacher, options) {
  const subject = school.subject(teacher.subjectId);
  const rooms = (teacher.roomIds || []).map((roomId) => school.room(roomId)).filter(Boolean);
  const slotOf = (dayType, taught, period) => school.groupDay(taught.groupId, dayType.id)[period];
  const kinds = dayKindsOf(school, (dayType) => (school.teacherDay(teacher.id, dayType.id) || []).map((entry) => entry.groups.map((taught) => {
    const slot = slotOf(dayType, taught, entry.period);
    return [taught.groupId, taught.roomId, slot.label, slot.roomText];
  })));
  const tables = kinds.map((kind) => dayTable(school, kind, [school.data.settings.periodWord, 'Group', 'Room'], (dayType, period) => {
    const entry = school.teacherDay(teacher.id, dayType.id)[period];
    if (!entry || entry.kind === 'planning') return [quiet('Planning'), ''];
    const what = [];
    const where = [];
    for (const taught of entry.groups) {
      const group = school.group(taught.groupId);
      const slot = slotOf(dayType, taught, period);
      what.push(esc(group ? group.name : '') + (slot.label ? ' ' + quiet(slot.label) : ''));
      const place = slotRoom(school, slot);
      const text = place === null ? quiet('No room') : esc(place);
      if (!where.includes(text)) where.push(text);
    }
    return [joined(what), joined(where)];
  }));
  const facts = [
    subject ? subject.name : null,
    rooms.length === 0 ? 'No room of their own' : joined(rooms.map((room) => school.roomName(room, true))),
  ].filter(Boolean);
  return [
    '<section class="batch-sheet batch-sheet--teacher new-sheet" data-sheet="teacher" data-id="' + esc(teacher.id) + '">',
    sheetLine(project, 'Teacher schedule', options),
    '<h2 class="batch-sheet__name">' + esc(teacher.name) + '</h2>',
    '<p class="batch-sheet__facts">' + esc(facts.join(' · ')) + '</p>',
    '<p class="batch-sheet__says">' + esc(partsToText(teacherSummaryOf(school, teacher.id))) + '</p>',
    days(kinds, tables),
    '</section>',
  ].join('\n');
}

// ---------------------------------------------------------------- door signs

// The staff browser's sign for the room, in a sheet of its own. The line at
// its foot is the school's name as every print document writes it.
function signSheet(project, school, room, options) {
  return [
    '<section class="batch-sheet batch-sign new-sheet" data-sheet="door" data-id="' + esc(room.id) + '">',
    doorSignMarkup(school, room, { day: options.day === true, school: schoolName(project) }),
    '</section>',
  ].join('\n');
}

// ---------------------------------------------------------------- the document

function cover(lead, items) {
  const out = ['<p class="doc-lead">' + esc(lead) + '</p>'];
  if (items.length > 0) {
    out.push('<ul class="batch-cover__list">');
    for (const item of items) out.push('<li>' + esc(item.name) + (item.detail ? ' <span class="batch-cover__detail">' + esc(item.detail) + '</span>' : '') + '</li>');
    out.push('</ul>');
  }
  return out.join('\n');
}

// The school as a published file would carry it. The publish time is on no
// sheet; it is the document's own date, so no clock is read for it.
function publishedSchool(project, now) {
  const given = now instanceof Date ? now : new Date(now === null || now === undefined ? 0 : now);
  const at = Number.isNaN(given.getTime()) ? new Date(0) : given;
  return openSchool(publishedModel(project, { clock: () => at }));
}

export function render(project, derived, options) {
  const given = options || {};
  const doors = given.batch === 'doors';
  const asked = paperOf(project, given);
  // a door sign is never laid on its side: not when landscape is asked for,
  // and the cover says so whenever landscape is what the project is set to
  // (the preview sheet asks for portrait itself, and the reader still chose
  // landscape somewhere)
  const turned = doors && (asked.orientation === 'landscape' || paperOf(project, null).orientation === 'landscape');
  const opts = turned ? { ...given, paper: { ...asked, orientation: 'portrait' } } : given;
  const school = publishedSchool(project, opts.now);
  let what;
  let body;
  if (doors) {
    const rooms = school.rooms;
    what = opts.day === true ? 'Door signs with each room’s day' : 'Door signs';
    body = [cover(rooms.length === 0
      ? 'There are no rooms in the building yet, so there is no sign to print.'
      : (rooms.length === 1 ? 'One door sign follows' : rooms.length + ' door signs follow, one sheet each') + ', in the order of the building’s floors.' + (turned ? ' ' + UPRIGHT_COVER : ''),
    rooms.map((room) => {
      const floor = school.floorOfRoom(room.id);
      return { name: school.roomName(room, true), detail: floor ? floor.name : '' };
    }))].concat(rooms.map((room) => signSheet(project, school, room, opts)));
  } else {
    const teachers = school.teachers;
    what = 'Teacher schedules';
    body = [cover(teachers.length === 0
      ? 'There are no teachers in the schedule yet, so there is no schedule to print.'
      : (teachers.length === 1 ? 'One schedule follows' : teachers.length + ' schedules follow, one sheet each') + ', in the order of the Teachers list.',
    teachers.map((teacher) => {
      const subject = school.subject(teacher.subjectId);
      return { name: teacher.name, detail: subject ? subject.name : '' };
    }))].concat(teachers.map((teacher) => teacherSheet(project, school, teacher, opts)));
  }
  return frame(project, { output: doors ? (opts.day === true ? 'door-signs-day' : 'door-signs') : 'teacher-schedules', what, pages: [{ body: body.join('\n') }], options: opts });
}

// How many sheets a batch is, the cover not counted: for the words beside
// the buttons. It is counted from the school render() opens, the copy a
// published file carries, so the words and the sheets cannot disagree.
export function batchCount(project, batch) {
  const school = publishedSchool(project, null);
  return batch === 'doors' ? school.rooms.length : school.teachers.length;
}

function entry(entryId, entryName, fixed) {
  const made = { id: entryId, name: entryName, render: (project, derived, options) => render(project, derived, { ...options, ...fixed }) };
  // the preview sheet reads these: no orientation to choose, and why
  if (fixed.batch === 'doors') {
    made.upright = true;
    made.uprightSays = UPRIGHT_SENTENCE;
  }
  return made;
}

export const BATCHES = [
  entry('teacher-schedules', 'Teacher schedules', { batch: 'teachers' }),
  entry('door-signs', 'Door signs', { batch: 'doors', day: false }),
  entry('door-signs-day', 'Door signs with each room’s day', { batch: 'doors', day: true }),
];

// "12 teachers", for the lines beside the buttons.
export function batchWords(project) {
  return { teachers: count(batchCount(project, 'teachers'), 'teacher'), rooms: count(batchCount(project, 'doors'), 'room') };
}
