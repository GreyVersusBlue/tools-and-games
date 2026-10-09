// #/common?t=…,…  Common planning
//
// Pick two or more teachers: the periods when every one of them is free, for
// each day type, with the full grid beneath. Day types that give the same
// answer at the same times share one card. The teachers picked are kept in the
// address, so the page can be shared and bookmarked.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf } from '../page.js';
import { everyTeacherDay, periodTimes, dayTypeNames, viewLink, entryWords } from '../clock.js';
import { dayKindsOf } from './teacher.js';

function chosenFrom(school, text) {
  const ids = [];
  for (const id of String(text || '').split(',')) {
    if (id !== '' && school.teacher(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// The periods in which every one of the teachers is free, on one day type.
export function commonPeriods(school, teacherIds, dayTypeId) {
  const days = everyTeacherDay(school, dayTypeId);
  const periods = [];
  for (let period = 0; period < school.data.settings.periods; period += 1) {
    if (teacherIds.every((id) => days.get(id)[period].kind === 'planning')) periods.push(period);
  }
  return periods;
}

function listOf(words) {
  const pieces = [];
  words.forEach((word, index) => {
    if (index > 0) pieces.push(index === words.length - 1 ? ' and ' : ', ');
    pieces.push(word);
  });
  return pieces;
}

export const commonView = {
  id: 'common',
  flag: 'common',
  nav: 'search',
  title(ctx, route) {
    return 'Common planning';
  },
  render(ctx, route) {
    const school = ctx.school;
    let chosen = chosenFrom(school, route.query.t);

    const says = h('p', { class: 'lede', role: 'status' });
    const picked = h('ul', { class: 'chips', 'aria-label': 'Teachers chosen' });
    const adder = h('select', { class: 'field__input', id: 'common-add' });
    const out = h('div', { class: 'stack', dataset: { out: 'common' } });

    const dayCard = (set) => {
      const dayTypeId = set.first.id;
      const days = everyTeacherDay(school, dayTypeId);
      const together = commonPeriods(school, chosen, dayTypeId);
      const everyone = chosen.length === 2 ? 'Both are' : 'All ' + chosen.length + ' are';
      const rows = [];
      for (let period = 0; period < school.data.settings.periods; period += 1) {
        const all = together.includes(period);
        const times = periodTimes(school, dayTypeId, period);
        rows.push(h('tr', { class: all ? 'table__row--all' : null, dataset: { period: String(period), all: all ? 'true' : null } },
          h('th', { scope: 'row' }, school.periodName(period), times ? h('span', { class: 'table__sub' }, times) : null),
          chosen.map((id) => {
            const entry = days.get(id)[period];
            return h('td', null, entry.kind === 'planning' ? 'Free' : entryWords(school, entry));
          }),
          h('td', null, all ? h('strong', null, 'All free') : null)));
      }
      return h('section', { class: 'card', dataset: { days: set.dayTypes.map((dayType) => dayType.id).join(' ') } },
        h('h2', { class: 'card__title' }, dayTypeNames(set.dayTypes)),
        h('p', { dataset: { common: 'sentence' } }, together.length === 0
          ? 'There is no ' + school.data.settings.periodWord.toLowerCase() + ' when ' + (chosen.length === 2 ? 'both' : 'all ' + chosen.length) + ' are free.'
          : [everyone, ' free in ', listOf(together.map((period) => school.periodName(period))), '.']),
        h('div', { class: 'scroll', role: 'region', tabindex: '0', 'aria-label': 'The full grid for ' + set.dayTypes.map((dayType) => dayType.name).join(', ') },
          h('table', { class: 'table' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, school.data.settings.periodWord),
              chosen.map((id) => h('th', { scope: 'col' }, viewLink(school, 'teacher', id, typed(school.teacher(id).name)))),
              h('th', { scope: 'col' }, 'Together'))),
            h('tbody', null, rows))));
    };

    const draw = () => {
      picked.replaceChildren(...chosen.map((id) => {
        const teacher = school.teacher(id);
        return h('li', { class: 'chips__item' },
          h('span', null, typed(teacher.name)),
          h('button', { class: 'chips__remove', type: 'button', 'aria-label': 'Remove ' + teacher.name, dataset: { remove: id }, onclick: () => {
            chosen = chosen.filter((other) => other !== id);
            ctx.replace(makeHash('common', '', { t: chosen.join(',') }));
            draw();
            adder.focus();
          } }, 'Remove'));
      }));
      picked.hidden = chosen.length === 0;
      const rest = school.teachers.filter((teacher) => !chosen.includes(teacher.id));
      adder.replaceChildren(
        h('option', { value: '' }, rest.length === 0 ? 'Every teacher is chosen' : 'Choose a teacher…'),
        ...rest.map((teacher) => h('option', { value: teacher.id }, teacher.name)));
      adder.disabled = rest.length === 0;

      if (chosen.length < 2) {
        says.replaceChildren(h('span', null, chosen.length === 0 ? 'Choose two or more teachers to see when all of them are free.' : 'Choose one more teacher to see when both are free.'));
        out.replaceChildren();
        return;
      }
      const sets = dayKindsOf(school, (dayType) => chosen.map((id) => everyTeacherDay(school, dayType.id).get(id)));
      const found = sets.map((set) => ({ set, periods: commonPeriods(school, chosen, set.first.id) })).filter((part) => part.periods.length > 0);
      says.replaceChildren(h('span', null, found.length === 0
        ? (chosen.length === 2 ? 'These two teachers are' : 'These ' + chosen.length + ' teachers are') + ' never all free in the same ' + school.data.settings.periodWord.toLowerCase() + '.'
        : [chosen.length === 2 ? 'Both are' : 'All ' + chosen.length + ' are', ' free in ', found.map((part, index) => [
          index > 0 ? '; in ' : null,
          listOf(part.periods.map((period) => school.periodName(period))),
          ' on ',
          dayTypeNames(part.set.dayTypes),
        ]), '.']));
      out.replaceChildren(...sets.map(dayCard));
    };

    adder.addEventListener('change', () => {
      if (adder.value === '' || !school.teacher(adder.value)) return;
      chosen = chosen.concat(adder.value);
      ctx.replace(makeHash('common', '', { t: chosen.join(',') }));
      draw();
    });

    draw();
    return pageOf('Common planning', null, says,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'common-add' }, 'Add a teacher'), adder),
      picked, out);
  },
};
