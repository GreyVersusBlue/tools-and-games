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
// What a sheet says is the staff browser's own answer. The school is opened
// the way the staff browser opens it (staff/model.js) and asked the same
// questions: a teacher's day and the sentence about it (staff/views/
// teacher.js), who is in a room each period (roomUse, staff/views/room.js),
// which day types are the same (dayKindsOf), and how large a long room number
// may be set (signFit, staff/views/door-sign.js). Only the markup is written
// here, as text with every name escaped, because a print document is a string
// and the staff browser builds elements. The sheets' rules are the marked
// block at the end of ui/print.css.
//
// BATCHES are the three entries ui/prints/index.js lists, each with the fixed
// options the preview sheet cannot pass.

import { count } from '../components/words.js';
import { openSchool } from '../../staff/model.js';
import { wordsJoined, partsToText, dayKindsOf, teacherSummaryOf } from '../../staff/views/teacher.js';
import { roomUse } from '../../staff/views/room.js';
import { signFit } from '../../staff/views/door-sign.js';
import { esc, frame, printDate, schoolName } from './document.js';

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

function signSheet(project, school, room, options) {
  const numbered = room.number.trim() !== '';
  const named = school.roomName(room, true);
  // "Room 204" is the word and the number; "Gym" is the number alone
  const worded = numbered && named === 'Room ' + room.number;
  const big = numbered ? room.number : 'Room';
  const teachers = (room.teacherIds || []).map((teacherId) => school.teacher(teacherId)).filter(Boolean);
  const subject = school.subject(room.subjectId) || (teachers.length > 0 ? school.subject(teachers[0].subjectId) : null);
  const out = [
    '<section class="batch-sheet batch-sign new-sheet" data-sheet="door" data-id="' + esc(room.id) + '">',
    worded ? '<p class="batch-sign__word">Room</p>' : '',
    '<p class="batch-sign__number" style="--sign-fit: ' + signFit(big) + ';">' + esc(big) + '</p>',
    teachers.length > 0 ? '<p class="batch-sign__teacher">' + esc(joined(teachers.map((teacher) => teacher.name))) + '</p>' : '',
    subject ? '<p class="batch-sign__subject">' + esc(subject.name) + '</p>' : '',
  ];
  if (options.day === true) {
    const uses = new Map(school.dayTypes.map((dayType) => [dayType.id, roomUse(school, room.id, dayType.id)]));
    const kinds = dayKindsOf(school, (dayType) => uses.get(dayType.id).map((period) => period.map((use) => [use.group.id, use.label, use.teachers.map((teacher) => teacher.id)])));
    out.push(days(kinds, kinds.map((kind) => dayTable(school, kind, [school.data.settings.periodWord, 'Group', 'Teacher'], (dayType, period) => {
      const here = uses.get(dayType.id)[period];
      if (here.length === 0) return [quiet('Empty'), ''];
      const who = [];
      for (const use of here) {
        for (const teacher of use.teachers) {
          if (!who.includes(teacher.name)) who.push(teacher.name);
        }
      }
      return [esc(joined(here.map((use) => use.group.name))), esc(joined(who))];
    }))));
  }
  out.push('<p class="batch-sign__school">' + esc(schoolName(project)) + '</p>', '</section>');
  return out.filter((part) => part !== '').join('\n');
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

export function render(project, derived, options) {
  const opts = options || {};
  const school = openSchool(project);
  const doors = opts.batch === 'doors';
  let what;
  let body;
  if (doors) {
    const rooms = school.rooms;
    what = opts.day === true ? 'Door signs with each room’s day' : 'Door signs';
    body = [cover(rooms.length === 0
      ? 'There are no rooms in the building yet, so there is no sign to print.'
      : (rooms.length === 1 ? 'One door sign follows' : rooms.length + ' door signs follow, one sheet each') + ', in the order of the building’s floors.',
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

// How many sheets a batch is, cover included: for the button's own words.
export function batchCount(project, batch) {
  return batch === 'doors' ? openSchool(project).rooms.length : project.teachers.length;
}

function entry(entryId, entryName, fixed) {
  return { id: entryId, name: entryName, render: (project, derived, options) => render(project, derived, { ...options, ...fixed }) };
}

export const BATCHES = [
  entry('teacher-schedules', 'Teacher schedules', { batch: 'teachers' }),
  entry('door-signs', 'Door signs', { batch: 'doors', day: false }),
  entry('door-signs-day', 'Door signs with each room’s day', { batch: 'doors', day: true }),
];

// "12 teachers", for the lines beside the buttons.
export function batchWords(project) {
  return { teachers: count(project.teachers.length, 'teacher'), rooms: count(batchCount(project, 'doors'), 'room') };
}
