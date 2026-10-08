// #/staffing  Staffing
//
// For every subject the school has defined, with or without a teacher: how
// many teachers it has and how many periods they teach on each day type.

import { h, typed } from '../dom.js';
import { pageOf } from '../page.js';
import { countOf, linkToTeacher, subjectChipOf, wordsJoined, teacherDaysOn } from './teacher.js';

// One row a subject, in the school's own order, then a row for teachers with
// no subject when there are any:
// [{ subject, teachers, taught: [periods taught on each own day type] }]
// A taught period is one period of one teacher's day with a group in it, by
// the engine's rule for a teacher's day.
export function staffingRows(school) {
  const dayTypes = school.ownDayTypes();
  const rowFor = (subject, teachers) => ({
    subject,
    teachers,
    taught: dayTypes.map((dayType) => {
      const days = teacherDaysOn(school, dayType.id);
      return teachers.reduce((sum, teacher) => sum + days.get(teacher.id).filter((entry) => entry.kind === 'teaching').length, 0);
    }),
  });
  const rows = school.subjects.map((subject) => rowFor(subject, school.teachers.filter((teacher) => teacher.subjectId === subject.id)));
  const loose = school.teachers.filter((teacher) => !school.subject(teacher.subjectId));
  if (loose.length > 0) rows.push(rowFor(null, loose));
  return rows;
}

export const staffingView = {
  id: 'staffing',
  flag: 'staffing',
  nav: 'search',
  title() {
    return 'Staffing';
  },
  render(ctx) {
    const school = ctx.school;
    const dayTypes = school.ownDayTypes();
    const followers = school.dayTypes.filter((dayType) => !school.isOwnCopy(dayType.id));
    const rows = staffingRows(school);
    const total = dayTypes.map((dayType, at) => rows.reduce((sum, row) => sum + row.taught[at], 0));

    const table = h('div', { class: 'scroll', role: 'region', tabindex: '0', 'aria-label': 'Teachers and taught periods by subject' },
      h('table', { class: 'table table--figures' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Subject'),
          h('th', { scope: 'col' }, 'Teachers'),
          dayTypes.map((dayType) => h('th', { scope: 'col' }, 'Taught periods on ', typed(dayType.name))))),
        h('tbody', null, rows.map((row) => h('tr', { dataset: { subject: row.subject ? row.subject.id : '' } },
          h('th', { scope: 'row' },
            subjectChipOf(row.subject),
            row.teachers.length > 0 ? h('span', { class: 'table__under' }, wordsJoined(row.teachers.map((teacher) => linkToTeacher(school, teacher)))) : null),
          h('td', null, String(row.teachers.length)),
          row.taught.map((n) => h('td', null, String(n)))))),
        h('tfoot', null, h('tr', null,
          h('th', { scope: 'row' }, 'All subjects'),
          h('td', null, String(school.teachers.length)),
          total.map((n) => h('td', null, String(n)))))));

    const lede = countOf(school.teachers.length, 'teacher', 'teachers') + ' in ' + countOf(school.subjects.length, 'subject', 'subjects') + '.';
    return pageOf('Staffing', lede,
      table,
      followers.length > 0 ? h('p', { class: 'muted' }, wordsJoined(followers.map((dayType) => typed(dayType.name))), followers.length === 1 ? ' is' : ' are', ' the same as ', typed(school.dayTypes[0].name), '.') : null);
  },
};
