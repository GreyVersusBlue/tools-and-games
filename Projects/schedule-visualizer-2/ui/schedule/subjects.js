// The Subjects tab: the school's own ordered list of subjects, edited in
// place. A row moves by dragging its handle, or with the up and down arrows
// while the handle has focus.

import { h } from '../components/dom.js';
import { field } from '../components/field.js';
import { count, list } from '../components/words.js';
import { addSubject, renameSubject, recolourSubject, reorderSubject, deleteSubject, describeSubjectUse } from '../../engine/actions.js';
import { fill, apply, button, keyed, emptyState, freeName, dragRows } from './common.js';

const WHAT = 'A subject is a department. It has a code, a name and a colour, and the colour is how its rooms are drawn.';

function useText(use) {
  const parts = [];
  if (use.rooms > 0) parts.push(count(use.rooms, 'room'));
  if (use.teachers > 0) parts.push(count(use.teachers, 'teacher'));
  return parts.length === 0 ? 'Not used yet' : list(parts);
}

export function mount(env) {
  const { ctx } = env;
  const element = h('div', { class: 'sch-subjects' });

  function add() {
    const project = ctx.store.project;
    if (!apply(env, addSubject, { code: '', name: freeName(project.subjects.map((subject) => subject.name), 'New subject') })) return;
    const subjects = ctx.store.project.subjects;
    env.render('subject:' + subjects[subjects.length - 1].id + ':code');
  }

  function move(subject, toIndex) {
    const total = ctx.store.project.subjects.length;
    if (toIndex < 0 || toIndex >= total) return;
    if (!apply(env, reorderSubject, { id: subject.id, toIndex })) return;
    ctx.announce((subject.name || subject.code) + ' is now ' + (toIndex + 1) + ' of ' + total + '.');
    env.render('subject:' + subject.id + ':move');
  }

  function row(project, subject, index) {
    const key = 'subject:' + subject.id + ':';
    const called = subject.name || subject.code || 'this subject';
    const handle = keyed(h('button', {
      type: 'button',
      class: 'sch-grip sch-grip--button',
      'aria-label': 'Move ' + called + ', ' + (index + 1) + ' of ' + project.subjects.length + '. The up and down arrows move it.',
      title: 'Drag, or press the up and down arrows, to move ' + called,
      on: { keydown: (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        move(subject, index + (event.key === 'ArrowUp' ? -1 : 1));
      } },
    }, '⠿'), key + 'move');
    const code = field({ value: subject.code, name: 'subjectCode', width: '6rem', commit: (value) => {
      ctx.store.apply(renameSubject, { id: subject.id, code: value });
    } });
    code.input.setAttribute('aria-label', 'Code');
    keyed(code.input, key + 'code');
    const name = field({ value: subject.name, name: 'subjectName', commit: (value) => {
      ctx.store.apply(renameSubject, { id: subject.id, name: value });
    } });
    name.input.setAttribute('aria-label', 'Name');
    keyed(name.input, key + 'name');
    const colour = keyed(h('input', { type: 'color', class: 'sch-colour__custom', 'aria-label': 'Colour of ' + called, value: subject.colour }), key + 'colour');
    colour.addEventListener('change', () => apply(env, recolourSubject, { id: subject.id, colour: colour.value }));
    const use = describeSubjectUse(project, subject.id);
    return h('tr', { data: { index: String(index), subject: subject.id } },
      h('td', { class: 'sch-subjects__move' }, handle),
      h('td', null, code.element),
      h('td', null, name.element),
      h('td', null, colour, h('span', { class: 'sch-subjects__hex' }, subject.colour)),
      h('td', { class: 'sch-subjects__use' }, useText(use)),
      h('td', null, button('Delete', () => {
        if (!apply(env, deleteSubject, { id: subject.id })) return;
        const left = [];
        if (use.rooms > 0) left.push(count(use.rooms, 'room'));
        if (use.teachers > 0) left.push(count(use.teachers, 'teacher'));
        const one = use.rooms + use.teachers === 1;
        ctx.toast({
          text: 'Deleted ' + called + '.' + (left.length > 0 ? ' ' + list(left).replace(/^./, (c) => c.toUpperCase()) + ' now ' + (one ? 'has' : 'have') + ' no subject.' : ''),
          action: { label: 'Undo', run: ctx.undo },
        });
        const after = ctx.store.project.subjects;
        const next = after[Math.min(index, after.length - 1)];
        env.render(next ? 'subject:' + next.id + ':name' : 'subject-add');
      }, { small: true, key: key + 'delete', action: 'delete', name: 'Delete ' + called + (use.rooms + use.teachers > 0 ? ', used by ' + useText(use) : '') })));
  }

  function draw(project) {
    const addButton = button('Add a subject', add, { primary: true, key: 'subject-add', action: 'add-subject' });
    if (project.subjects.length === 0) {
      fill(element, emptyState('No subjects yet. ' + WHAT, addButton));
      return;
    }
    const body = h('tbody', null, project.subjects.map((subject, index) => row(project, subject, index)));
    dragRows(body, (from, to) => move(ctx.store.project.subjects[from], to));
    fill(element, 
      h('p', { class: 'sch-lead' }, WHAT + ' This project has ' + count(project.subjects.length, 'subject') + ', in the order shown.'),
      h('div', { class: 'sch-toolbar' }, addButton),
      h('div', { class: 'sch-scroll' }, h('table', { class: 'table sch-edit-table' },
        h('caption', { class: 'vh' }, 'Subjects, in order'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Move')), ['Code', 'Name', 'Colour', 'Used by'].map((label) => h('th', { scope: 'col' }, label)), h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Delete')))),
        body)));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
