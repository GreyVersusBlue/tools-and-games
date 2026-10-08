// #/coverage/t…  Coverage
//
// A teacher is out: for each period they teach on the chosen day type, the
// teachers who are free then, those of the same subject first, each with
// their rooms. With no teacher in the address the page asks for one.
//
// Marking who will cover, and sending the marked plan back as a link, are not
// built (a wish in the specification).

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage } from '../page.js';
import { dayTypeFor, periodTimes, everyTeacherDay, dayTypePicker, viewLink, sectionHeading, shareRow, teacherDetail, entryWords } from '../clock.js';
import { freeTeachers } from './free.js';

// For each period a teacher teaches on a day type, who is free to cover it:
//
//   [{ period, entry, candidates: [{ teacher, sameSubject }] }]
//
// Same-subject teachers come first; within each part the order is the
// school's own. A teacher with no subject is the same subject as nobody.
export function coverageFor(school, teacherId, dayTypeId) {
  const absent = school.teacher(teacherId);
  const day = everyTeacherDay(school, dayTypeId).get(teacherId) || [];
  const periods = [];
  for (const entry of day) {
    if (entry.kind !== 'teaching') continue;
    const free = freeTeachers(school, dayTypeId, entry.period).filter((teacher) => teacher.id !== teacherId);
    const same = (teacher) => Boolean(absent.subjectId) && teacher.subjectId === absent.subjectId;
    periods.push({
      period: entry.period,
      entry,
      candidates: free.filter(same).map((teacher) => ({ teacher, sameSubject: true })).concat(free.filter((teacher) => !same(teacher)).map((teacher) => ({ teacher, sameSubject: false }))),
    });
  }
  return periods;
}

// The page that asks which teacher, for Coverage and for the substitute plan.
export function teacherChooser(ctx, view, title, lede) {
  const school = ctx.school;
  const select = h('select', { class: 'field__input', id: view + '-teacher' },
    h('option', { value: '' }, 'Choose a teacher…'),
    school.teachers.map((teacher) => h('option', { value: teacher.id }, teacher.name)));
  select.addEventListener('change', () => {
    if (select.value !== '') ctx.go(makeHash(view, select.value));
  });
  return pageOf(title, lede,
    school.teachers.length === 0
      ? h('p', { class: 'muted' }, 'This schedule has no teachers.')
      : h('div', { class: 'field' }, h('label', { class: 'field__label', for: view + '-teacher' }, 'Teacher who is out'), select));
}

function listOf(words) {
  const pieces = [];
  words.forEach((word, index) => {
    if (index > 0) pieces.push(index === words.length - 1 ? ' and ' : ', ');
    pieces.push(word);
  });
  return pieces;
}

export const coverageView = {
  id: 'coverage',
  flag: 'coverage',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.teacher(route.id);
    return found ? 'Coverage: ' + found.name : 'Coverage';
  },
  render(ctx, route) {
    const school = ctx.school;
    const absent = route.id ? school.teacher(route.id) : null;
    if (route.id && !absent) return missingPage('teacher');
    if (!absent) return teacherChooser(ctx, 'coverage', 'Coverage', 'Who is free to cover each period of a teacher who is out.');

    let dayType = dayTypeFor(ctx, route);
    const says = h('p', { class: 'lede', role: 'status' });
    const picker = h('div', { class: 'controls' });
    const out = h('div', { class: 'stack', dataset: { out: 'coverage' } });
    const links = h('p', { class: 'actions' });
    const word = school.data.settings.periodWord.toLowerCase();

    const draw = () => {
      const periods = coverageFor(school, absent.id, dayType.id);
      const nobody = periods.filter((item) => item.candidates.length === 0);
      const name = typed(absent.name);
      let sentence;
      if (periods.length === 0) sentence = [name, ' teaches no group on ', typed(dayType.name), ', so there is nothing to cover.'];
      else {
        sentence = [name, ' teaches ', String(periods.length), ' of ', String(school.data.settings.periods), ' ', word, 's on ', typed(dayType.name), '. ',
          nobody.length === 0 ? 'Somebody is free in every one of them.' : ['Nobody is free in ', listOf(nobody.map((item) => school.periodName(item.period))), '.']];
      }
      says.replaceChildren(h('span', null, sentence));

      out.replaceChildren(...periods.map((item) => {
        const times = periodTimes(school, dayType.id, item.period);
        return h('section', { class: 'card', dataset: { period: String(item.period) } },
          h('h2', { class: 'card__title' }, school.periodName(item.period), times ? h('span', { class: 'card__when' }, times) : null),
          h('p', null, entryWords(school, item.entry)),
          sectionHeading('Free to cover', item.candidates.length),
          item.candidates.length === 0
            ? h('p', { class: 'muted' }, 'Nobody is free this ' + word + '.')
            : h('ul', { class: 'list', dataset: { list: 'candidates' } }, item.candidates.map((candidate) => h('li', { dataset: { same: candidate.sameSubject ? 'true' : 'false' } },
              viewLink(school, 'teacher', candidate.teacher.id, [
                h('span', { class: 'list__name' }, typed(candidate.teacher.name), candidate.sameSubject ? h('span', { class: 'tag' }, 'Same subject') : null),
                h('span', { class: 'list__detail' }, teacherDetail(school, candidate.teacher)),
              ], 'list__link')))));
      }));

      links.replaceChildren(...[
        school.has('sub') ? h('a', { class: 'btn', href: makeHash('sub', absent.id, { d: dayType.id }) }, 'Substitute plan') : null,
        school.has('teacher') ? h('a', { class: 'btn', href: makeHash('teacher', absent.id) }, 'The teacher\'s page') : null,
      ].filter(Boolean));
    };

    const chosen = dayTypePicker(ctx, dayType.id, (next) => {
      dayType = next;
      ctx.replace(makeHash('coverage', absent.id, { d: route.query.d ? dayType.id : '' }));
      draw();
    });
    if (chosen) picker.appendChild(chosen);
    draw();
    return pageOf(['Coverage: ', typed(absent.name)], null, says, picker, out, links, shareRow(() => 'Coverage: ' + absent.name + ' · ' + school.name));
  },
};
