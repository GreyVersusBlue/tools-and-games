// The Teachers tab: the list of teachers as a table that is edited in place.
// Names that look like the same person are flagged, with a button to merge
// them.

import { h } from '../components/dom.js';
import { field } from '../components/field.js';
import { picker } from '../components/picker.js';
import { icon } from '../components/icons.js';
import { count } from '../components/words.js';
import { addTeacher, editTeacher, deleteTeacher, mergeTeachers, findNearDuplicateTeachers } from '../../engine/actions.js';
import { allRooms, findRoom } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';
import { buildExport } from '../../engine/exports.js';
import { fill, apply, button, keyed, emptyState, marksFor, freeName, quote, collator, download } from './common.js';

const WHAT = 'A teacher is a named member of staff, with a subject and one or more rooms.';

export function mount(env) {
  const { ctx, view } = env;
  const element = h('div', { class: 'sch-teachers' });

  function add() {
    const project = ctx.store.project;
    if (!apply(env, addTeacher, { name: freeName(project.teachers.map((teacher) => teacher.name), 'New teacher') })) return;
    const teachers = ctx.store.project.teachers;
    env.render('teacher:' + teachers[teachers.length - 1].id + ':name');
  }

  function exportCsv() {
    const file = buildExport(ctx.store.project, 'teachers', { date: ctx.clock() });
    download(file.fileName, file.mime, file.text);
    ctx.toast({ text: 'Saved ' + file.fileName + ' to your downloads.' });
  }

  function duplicates(project) {
    return findNearDuplicateTeachers(project).map((same) => {
      const keep = same[0];
      return h('div', { class: 'sch-flag', role: 'group', 'aria-label': 'Names that look alike', data: { duplicate: keep.id } },
        h('p', null, same.map((teacher) => quote(teacher.name)).join(' and ') + ' look like the same teacher. Merging keeps one name and moves every room and ' + 'assignment to it.'),
        h('div', { class: 'sch-flag__actions' }, same.slice(1).map((gone) => button('Merge into ' + quote(keep.name), () => {
          if (!apply(env, mergeTeachers, { keepId: keep.id, mergeId: gone.id })) return;
          ctx.toast({ text: 'Merged ' + gone.name + ' into ' + keep.name + '.', action: { label: 'Undo', run: ctx.undo } });
          env.render('teacher:' + keep.id + ':name');
        }, { small: true, key: 'merge:' + gone.id, action: 'merge', name: 'Merge ' + quote(gone.name) + ' into ' + quote(keep.name) }))));
    });
  }

  function row(project, model, teacher, alike) {
    const key = 'teacher:' + teacher.id + ':';
    const name = field({ value: teacher.name, name: 'teacherName', commit: (value) => {
      ctx.store.apply(editTeacher, { id: teacher.id, name: value });
    } });
    name.input.setAttribute('aria-label', 'Name');
    keyed(name.input, key + 'name');

    const subject = keyed(h('select', { class: 'field__input', 'aria-label': 'Subject of ' + teacher.name },
      h('option', { value: '' }, 'No subject'),
      project.subjects.map((each) => h('option', { value: each.id }, each.name === '' ? each.code : each.name))), key + 'subject');
    subject.value = teacher.subjectId === null ? '' : teacher.subjectId;
    subject.addEventListener('change', () => apply(env, editTeacher, { id: teacher.id, subjectId: subject.value === '' ? null : subject.value }));

    const rooms = teacher.roomIds.map((id) => findRoom(project, id)).filter(Boolean);
    const addRoom = picker({
      placeholder: rooms.length === 0 ? 'Add a room' : 'Add another',
      listLabel: 'Rooms',
      emptyText: allRooms(project).length === 0 ? 'No rooms yet. Draw them in the Building section.' : 'No room matches.',
      options: () => allRooms(ctx.store.project).filter((room) => !teacher.roomIds.includes(room.id)).sort((a, b) => collator.compare(a.number, b.number))
        .map((room) => ({ id: room.id, label: room.number.trim() === '' ? roomName(room) : room.number })),
      onPick: (option) => {
        env.focusAfter(key + 'room');
        apply(env, editTeacher, { id: teacher.id, roomIds: teacher.roomIds.concat([option.id]) });
      },
    });
    addRoom.input.setAttribute('aria-label', 'Add a room for ' + teacher.name);
    keyed(addRoom.input, key + 'room');

    const notes = field({ value: teacher.notes, name: 'teacherNotes', commit: (value) => {
      ctx.store.apply(editTeacher, { id: teacher.id, notes: value });
    } });
    notes.input.setAttribute('aria-label', 'Notes on ' + teacher.name);
    keyed(notes.input, key + 'notes');

    const found = model.byTeacher.get(teacher.id) || [];
    return h('tr', { data: { teacher: teacher.id, shown: view.shown && view.shown.teacherId === teacher.id ? 'true' : null } },
      h('td', { class: 'sch-teachers__name' }, name.element,
        alike ? h('p', { class: 'sch-finding-line sch-finding-line--warning' }, 'Looks like another name in the list.') : null,
        found.length > 0 ? h('p', { class: 'sch-teachers__marks' }, marksFor(found)) : null),
      h('td', null, subject),
      h('td', null,
        rooms.length > 0 ? h('div', { class: 'chips' }, rooms.map((room) => h('span', { class: 'chip' }, h('span', null, room.number.trim() === '' ? roomName(room) : room.number), keyed(h('button', {
          type: 'button',
          class: 'chip__remove',
          'aria-label': 'Take ' + roomName(room) + ' from ' + teacher.name,
          on: { click: () => {
            env.focusAfter(key + 'room');
            apply(env, editTeacher, { id: teacher.id, roomIds: teacher.roomIds.filter((id) => id !== room.id) });
          } },
        }, icon('close', 14)), key + 'chip:' + room.id)))) : null,
        addRoom.element),
      h('td', null, notes.element),
      h('td', null, button('Delete', () => {
        const index = project.teachers.indexOf(teacher);
        if (!apply(env, deleteTeacher, { id: teacher.id })) return;
        ctx.toast({ text: 'Deleted teacher ' + teacher.name + '.', action: { label: 'Undo', run: ctx.undo } });
        const left = ctx.store.project.teachers;
        const next = left[Math.min(index, left.length - 1)];
        env.render(next ? 'teacher:' + next.id + ':name' : 'teacher-add');
      }, { small: true, key: key + 'delete', action: 'delete', name: 'Delete ' + teacher.name })));
  }

  function draw(project) {
    const model = env.model();
    const addButton = button('Add a teacher', add, { primary: true, key: 'teacher-add', action: 'add-teacher' });
    if (project.teachers.length === 0) {
      fill(element, emptyState('No teachers yet. ' + WHAT, addButton));
      return;
    }
    const alike = new Set(findNearDuplicateTeachers(project).flat().map((teacher) => teacher.id));
    fill(element, 
      h('p', { class: 'sch-lead' }, WHAT + ' This project has ' + count(project.teachers.length, 'teacher') + '.'),
      h('div', { class: 'sch-toolbar' },
        addButton,
        button('Export CSV', exportCsv, { key: 'teacher-export', action: 'export', name: 'Export the teachers as a CSV file' }),
        h('a', { class: 'btn', href: '#schedule/import', data: { action: 'import' } }, 'Import CSV…')),
      duplicates(project),
      h('div', { class: 'sch-scroll' }, h('table', { class: 'table sch-edit-table' },
        h('caption', { class: 'vh' }, 'Teachers'),
        h('thead', null, h('tr', null, ['Name', 'Subject', 'Rooms', 'Notes'].map((label) => h('th', { scope: 'col' }, label)), h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Delete')))),
        h('tbody', null, project.teachers.map((teacher) => row(project, model, teacher, alike.has(teacher.id)))))));
  }

  draw(ctx.store.project);
  return { element, update: draw };
}
