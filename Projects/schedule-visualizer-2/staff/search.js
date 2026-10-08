// The search page: one box that finds teachers, groups and rooms together,
// with the results grouped by kind. Down and Up move through the results from
// the box, Enter in the box opens the first, Escape empties it. What was typed
// is kept in the address, so Back returns to the same results.

import { h, typed } from './dom.js';
import { makeHash } from './router.js';
import { searchIndex, searchSchool } from './find.js';
import { pageOf } from './page.js';

const MORE = [
  ['directions', 'Directions', 'From one room to another'],
  ['common', 'Common planning', 'When several teachers are free together'],
  ['coverage', 'Coverage', 'Who is free when a teacher is out'],
  ['sub', 'Substitute plan', 'One page for a substitute'],
  ['staffing', 'Staffing', 'Teachers and taught periods by subject'],
];

const indexes = new WeakMap();

function indexOf(school) {
  if (!indexes.has(school)) indexes.set(school, searchIndex(school));
  return indexes.get(school);
}

function countText(found) {
  if (found.query === '') return '';
  if (found.total === 0) return 'Nothing in this schedule matches that. Try part of a name, a room number or a subject.';
  const parts = [];
  const say = (n, one, many) => {
    if (n > 0) parts.push(n + ' ' + (n === 1 ? one : many));
  };
  say(found.teachers.total, 'teacher', 'teachers');
  say(found.groups.total, 'group', 'groups');
  say(found.rooms.total, 'room', 'rooms');
  return 'Found ' + parts.join(', ') + '.';
}

function kindList(title, view, kind) {
  if (kind.total === 0) return null;
  const more = kind.total - kind.items.length;
  return h('section', { class: 'results__kind', 'aria-label': title },
    h('h2', { class: 'results__heading' }, title),
    h('ul', { class: 'list' }, kind.items.map((item) => h('li', null,
      h('a', { class: 'list__link', href: makeHash(view, item.id), dataset: { result: view } },
        h('span', { class: 'list__name' }, typed(item.name)),
        item.detail ? h('span', { class: 'list__detail' }, typed(item.detail)) : null)))),
    more > 0 ? h('p', { class: 'muted' }, 'And ' + more + ' more. Type more of the name to narrow it down.') : null);
}

export const searchView = {
  id: 'search',
  flag: null,
  nav: 'search',
  title() {
    return 'Search';
  },
  render(ctx, route) {
    const school = ctx.school;
    const input = h('input', {
      class: 'field__input field__input--search',
      id: 'find',
      type: 'search',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      'aria-describedby': 'find-count',
      value: route.query.q || '',
    });
    const count = h('p', { class: 'results__count', id: 'find-count', role: 'status' });
    const results = h('div', { class: 'results' });

    const links = () => Array.from(results.querySelectorAll('a[data-result]'));
    const draw = () => {
      const found = searchSchool(indexOf(school), input.value);
      count.textContent = countText(found);
      results.replaceChildren(...[
        school.has('teacher') ? kindList('Teachers', 'teacher', found.teachers) : null,
        school.has('group') ? kindList('Groups', 'group', found.groups) : null,
        school.has('room') ? kindList('Rooms', 'room', found.rooms) : null,
      ].filter(Boolean));
    };

    input.addEventListener('input', () => {
      draw();
      ctx.replace(makeHash('search', '', { q: input.value }));
    });
    input.addEventListener('keydown', (event) => {
      const found = links();
      if (event.key === 'ArrowDown' && found.length > 0) {
        event.preventDefault();
        found[0].focus();
      } else if (event.key === 'Enter' && found.length > 0) {
        event.preventDefault();
        ctx.go(found[0].getAttribute('href'));
      } else if (event.key === 'Escape' && input.value !== '') {
        event.preventDefault();
        input.value = '';
        draw();
        ctx.replace(makeHash('search'));
      }
    });
    results.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const found = links();
      const at = found.indexOf(event.target.closest('a[data-result]'));
      if (at === -1) return;
      event.preventDefault();
      if (event.key === 'ArrowDown') found[Math.min(found.length - 1, at + 1)].focus();
      else if (at === 0) input.focus();
      else found[at - 1].focus();
    });

    const more = MORE.filter(([view]) => school.has(view));
    draw();
    return pageOf(typed(school.name), 'Find a teacher, a group or a room. Type a name, a room number or a subject.',
      h('div', { class: 'field field--search', role: 'search' },
        h('label', { class: 'field__label', for: 'find' }, 'Search'),
        input),
      count,
      results,
      more.length > 0 ? h('section', { class: 'more', 'aria-label': 'More' },
        h('h2', { class: 'results__heading' }, 'More'),
        h('ul', { class: 'list' }, more.map(([view, name, what]) => h('li', null,
          h('a', { class: 'list__link', href: makeHash(view) },
            h('span', { class: 'list__name' }, name),
            h('span', { class: 'list__detail' }, what)))))) : null);
  },
};
