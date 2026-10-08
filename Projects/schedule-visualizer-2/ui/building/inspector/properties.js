// The Properties tab: the fields of what is selected on the plan. Every field
// keeps itself when it is left or when Enter is pressed (spec 3.1), and each
// kept change is one undo step.
//
// A room: its number, its teachers (the first is the main teacher; a name
// that is new can be added as a teacher from here), its subject, wing,
// capacity, whether it is a shared space, and its doors. An other space: its
// label, kind and colour.

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { picker } from '../../components/picker.js';
import { icon } from '../../components/icons.js';
import { ActionError, setRoomFields, setRoomTeachers, addTeacher, clearRoomDetails, setOtherSpaceFields, removeDoor } from '../../../engine/actions.js';
import { SIDE_WORDS } from '../../../engine/building.js';
import { OTHER_KINDS, nameKey } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { selectField, checkField, wholeOrEmpty, keepFocus, heading, cellWords } from './controls.js';
import { deleteSpace } from '../menu.js';

const NO_SUBJECT = '';
const NEW_TEACHER = 'new-teacher';
const KIND_WORDS = { bathroom: 'Bathroom', office: 'Office', storage: 'Storage', library: 'Library', outdoor: 'Outdoor', utility: 'Utility', other: 'Other' };

function subjectOptions(project) {
  return [{ value: NO_SUBJECT, label: 'No subject' }].concat(project.subjects.map((subject) => ({ value: subject.id, label: subject.name })));
}

// propertiesPanel(env) -> { element, update(state), focusNumber() }
//   env: { ctx, store, editor(), toSurface() }
export function propertiesPanel(env) {
  const { store, ctx } = env;
  const element = h('div', { class: 'bld-inspector__panel', id: 'inspector-properties' });
  let shown = null;
  let parts = null;
  let state = null;

  const current = () => {
    const id = state.selection[0];
    return state.floor.spaces.find((space) => space.id === id) || null;
  };

  function numberField(room) {
    // Enter keeps the number and goes back to the plan, with the tool still
    // in hand. A refusal (the number is taken) keeps the focus here.
    let byEnter = false;
    const made = field({
      id: 'room-number',
      label: 'Room number',
      name: 'roomNumber',
      value: room.number,
      commit: (value) => {
        const enter = byEnter;
        byEnter = false;
        store.apply(setRoomFields, { roomId: room.id, number: value });
        if (enter) env.toSurface();
      },
    });
    // heard before the field's own listener, which does the keeping
    made.input.addEventListener('keydown', (event) => {
      byEnter = event.key === 'Enter';
    }, true);
    // heard after it: Enter on a number that was not changed has nothing to
    // keep, and goes back to the plan all the same
    made.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !byEnter) return;
      byEnter = false;
      if (made.input.getAttribute('aria-invalid') !== 'true') env.toSurface();
    });
    made.input.addEventListener('blur', () => {
      byEnter = false;
    });
    return made;
  }

  function refuse(error) {
    if (!(error instanceof ActionError)) throw error;
    ctx.toast({ kind: 'problem', text: error.message });
    ctx.announce(error.message);
  }

  function buildRoom(room) {
    const number = numberField(room);
    const teachers = h('ul', { class: 'bi-people', id: 'room-teachers', 'aria-label': 'Teachers based in this room' });
    const noTeachers = h('p', { class: 'bld-inspector__small', id: 'room-no-teachers' }, 'No teacher is based in this room yet.');
    const add = picker({
      label: 'Add a teacher',
      placeholder: 'Type a name',
      listLabel: 'Teachers to add',
      emptyText: 'Type a name to add a new teacher.',
      options: () => {
        const now = current();
        const typed = add.input.value;
        const based = new Set(now ? now.teacherIds : []);
        const list = state.project.teachers.filter((teacher) => !based.has(teacher.id)).map((teacher) => {
          const subject = teacher.subjectId ? state.project.subjects.find((each) => each.id === teacher.subjectId) : null;
          return { id: teacher.id, label: teacher.name, detail: subject ? subject.name : '' };
        });
        const known = state.project.teachers.some((teacher) => nameKey(teacher.name) === nameKey(typed));
        if (typed.trim() !== '' && !known) list.push({ id: NEW_TEACHER, label: 'Add \'' + typed.trim() + '\' as a new teacher', name: typed.trim() });
        return list;
      },
      onPick: (option) => {
        const now = current();
        if (!now) return;
        try {
          if (option.id === NEW_TEACHER) {
            store.apply(addTeacher, { name: option.name, roomIds: [now.id] });
            ctx.announce('Added ' + option.name + ' as a new teacher, based in ' + roomName(now) + '.');
          } else {
            store.apply(setRoomTeachers, { roomId: now.id, teacherIds: now.teacherIds.concat([option.id]) });
            ctx.announce(option.label + ' is based in ' + roomName(now) + '.');
          }
        } catch (error) {
          refuse(error);
        }
      },
    });
    add.input.id = 'room-teacher-add';
    add.input.dataset.key = 'teacher-add';
    add.element.querySelector('label').setAttribute('for', 'room-teacher-add');

    const subject = selectField({
      id: 'room-subject',
      label: 'Subject',
      name: 'roomSubject',
      key: 'subject',
      options: subjectOptions(state.project),
      value: room.subjectId || NO_SUBJECT,
      commit: (value) => store.apply(setRoomFields, { roomId: room.id, subjectId: value === NO_SUBJECT ? null : value }),
    });
    const wing = field({ id: 'room-wing', label: 'Wing or area', name: 'roomWing', value: room.wing, commit: (value) => store.apply(setRoomFields, { roomId: room.id, wing: value }) });
    const capacity = field({
      id: 'room-capacity',
      label: 'Capacity, in seats',
      name: 'roomCapacity',
      inputMode: 'numeric',
      value: room.capacity,
      parse: wholeOrEmpty('A capacity'),
      format: (value) => (value === null ? '' : String(value)),
      commit: (value) => store.apply(setRoomFields, { roomId: room.id, capacity: value }),
    });
    const shared = checkField({
      id: 'room-shared',
      label: 'Shared space',
      hint: 'Several groups may be here at once without it counting as a double-booking: a gym, a cafeteria, a library.',
      name: 'roomShared',
      key: 'shared',
      checked: room.shared,
      commit: (on) => store.apply(setRoomFields, { roomId: room.id, shared: on }),
    });
    const doors = h('ul', { class: 'bi-rows', id: 'room-doors', 'aria-labelledby': 'room-doors-heading' });
    const doorsNote = h('p', { class: 'bld-inspector__small', id: 'room-doors-note' });

    const clear = h('button', { type: 'button', class: 'btn', id: 'room-clear', data: { key: 'clear' }, on: { click: () => {
      const now = current();
      if (!now) return;
      const name = roomName(now);
      env.editor().commit(clearRoomDetails, { roomId: now.id }, {
        done: () => 'Cleared the details of ' + name + '. The room itself stays.',
        same: 'There are no details to clear.',
        toast: () => 'Cleared the details of ' + name + '. The room itself stays.',
      });
    } } }, 'Clear its details');
    const remove = h('button', { type: 'button', class: 'btn btn--danger', id: 'room-delete', data: { key: 'delete' }, on: { click: () => {
      const now = current();
      if (now) deleteSpace(env.editor(), now.id);
    } } }, 'Delete the room');

    element.replaceChildren(
      h('h2', { class: 'bld-inspector__title', id: 'inspector-title' }),
      number.element,
      h('p', { class: 'bld-inspector__small' }, 'A room needs a number before a group can be scheduled into it. A name works too: Gym, Library.'),
      heading('Teachers', 'room-teachers-heading'),
      teachers,
      noTeachers,
      add.element,
      subject.element,
      wing.element,
      capacity.element,
      shared.element,
      heading('Doors', 'room-doors-heading'),
      doors,
      doorsNote,
      h('div', { class: 'bi-buttons' }, clear, remove),
    );
    parts = { kind: 'room', number, teachers, noTeachers, subject, wing, capacity, shared, doors, doorsNote, teachersKey: null, doorsKey: null, subjectsKey: null };
  }

  function syncRoom(room) {
    const { project, floor } = state;
    parts.number.set(room.number);
    parts.wing.set(room.wing);
    parts.capacity.set(room.capacity);
    parts.shared.set(room.shared);
    const subjectsKey = project.subjects.map((subject) => subject.id + ':' + subject.name).join('|');
    if (subjectsKey !== parts.subjectsKey) {
      parts.subjectsKey = subjectsKey;
      parts.subject.setOptions(subjectOptions(project), room.subjectId || NO_SUBJECT);
    } else {
      parts.subject.set(room.subjectId || NO_SUBJECT);
    }

    const based = room.teacherIds.map((id) => project.teachers.find((teacher) => teacher.id === id)).filter(Boolean);
    const teachersKey = based.map((teacher) => teacher.id + ':' + teacher.name).join('|');
    if (teachersKey !== parts.teachersKey) {
      parts.teachersKey = teachersKey;
      parts.noTeachers.hidden = based.length > 0;
      parts.teachers.hidden = based.length === 0;
      keepFocus(parts.teachers, () => parts.teachers.replaceChildren(...based.map((teacher, index) => h('li', { class: 'bi-person', data: { teacher: teacher.id } },
        h('span', { class: 'bi-person__name' }, teacher.name),
        index === 0
          ? h('span', { class: 'bi-person__main' }, 'Main teacher')
          : h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'main:' + teacher.id, action: 'main' }, 'aria-label': 'Make ' + teacher.name + ' the main teacher', on: { click: () => {
            const now = current();
            if (!now) return;
            store.apply(setRoomTeachers, { roomId: now.id, teacherIds: [teacher.id].concat(now.teacherIds.filter((id) => id !== teacher.id)) });
            ctx.announce(teacher.name + ' is the main teacher of ' + roomName(now) + '.');
          } } }, 'Make main'),
        h('button', { type: 'button', class: 'chip__remove', data: { key: 'out:' + teacher.id, action: 'remove-teacher' }, 'aria-label': 'Take ' + teacher.name + ' out of this room', title: 'Take ' + teacher.name + ' out of this room', on: { click: () => {
          const now = current();
          if (!now) return;
          store.apply(setRoomTeachers, { roomId: now.id, teacherIds: now.teacherIds.filter((id) => id !== teacher.id) });
          ctx.announce(teacher.name + ' is no longer based in ' + roomName(now) + '.');
        } } }, icon('close', 14)),
      ))));
    }

    const doorsKey = room.doors.map((door) => door.cell + door.side).join('|') + '@' + floor.width;
    if (doorsKey !== parts.doorsKey) {
      parts.doorsKey = doorsKey;
      parts.doors.hidden = room.doors.length === 0;
      parts.doorsNote.textContent = room.doors.length === 0
        ? 'No door is drawn, so the room is entered from any side that touches a corridor. To add a door, click an edge of the selected room with the Select tool, or use the menu on one of its cells (right-click, or the Menu key).'
        : 'The room is entered only through ' + (room.doors.length === 1 ? 'this door' : 'these doors') + '. Click an edge of the selected room to add another, or a door to remove it.';
      keepFocus(parts.doors, () => parts.doors.replaceChildren(...room.doors.map((door) => h('li', { class: 'bi-row', data: { door: door.cell + ':' + door.side } },
        h('span', { class: 'bi-row__text' }, 'On the ' + SIDE_WORDS[door.side] + ' edge, ' + cellWords(floor, door.cell)),
        h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'door:' + door.cell + door.side, action: 'remove-door' }, 'aria-label': 'Remove the door on the ' + SIDE_WORDS[door.side] + ' edge, ' + cellWords(floor, door.cell), on: { click: () => {
          const now = current();
          if (!now) return;
          env.editor().commit(removeDoor, { roomId: now.id, cell: door.cell, side: door.side }, { done: () => 'Removed the door on the ' + SIDE_WORDS[door.side] + ' edge of ' + roomName(now) + '.' });
        } } }, 'Remove'),
      ))));
    }
  }

  function buildOther(space) {
    const label = field({ id: 'space-label', label: 'Label', name: 'spaceLabel', value: space.label, commit: (value) => store.apply(setOtherSpaceFields, { spaceId: space.id, label: value }) });
    const kind = selectField({
      id: 'space-kind',
      label: 'Kind',
      name: 'spaceKind',
      key: 'kind',
      options: OTHER_KINDS.map((value) => ({ value, label: KIND_WORDS[value] || value })),
      value: space.otherKind,
      commit: (value) => store.apply(setOtherSpaceFields, { spaceId: space.id, otherKind: value }),
    });
    const colour = h('input', { type: 'color', class: 'bi-colour', id: 'space-colour', name: 'spaceColour', data: { key: 'colour' } });
    colour.value = space.colour;
    colour.addEventListener('change', () => {
      try {
        store.apply(setOtherSpaceFields, { spaceId: space.id, colour: colour.value });
      } catch (error) {
        refuse(error);
      }
    });
    const remove = h('button', { type: 'button', class: 'btn btn--danger', id: 'space-delete', data: { key: 'delete' }, on: { click: () => {
      const now = current();
      if (now) deleteSpace(env.editor(), now.id);
    } } }, 'Delete this space');
    element.replaceChildren(
      h('h2', { class: 'bld-inspector__title', id: 'inspector-title' }),
      h('p', { class: 'bld-inspector__small' }, 'An other space is shown and labelled. Nobody is scheduled into it or walks through it.'),
      label.element,
      kind.element,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'space-colour' }, 'Colour'), colour),
      h('div', { class: 'bi-buttons' }, remove),
    );
    parts = { kind: 'other', label, otherKind: kind, colour };
  }

  function update(next) {
    state = next;
    const { floor, selection } = state;
    const spaces = selection.map((id) => floor.spaces.find((space) => space.id === id)).filter(Boolean);
    const key = spaces.map((space) => space.id).join(' ');
    const one = spaces.length === 1 ? spaces[0] : null;
    if (key !== shown) {
      shown = key;
      parts = null;
      if (spaces.length === 0) {
        element.replaceChildren(
          h('h2', { class: 'bld-inspector__title' }, 'Nothing is selected'),
          h('p', null, 'Click a room with the Select tool to see it here. A room you have just drawn is selected already.'),
          h('p', { class: 'bld-inspector__small' }, 'Every room of the floor is in the Rooms tab, and the same things can be changed there.'),
        );
      } else if (!one) {
        element.replaceChildren(
          h('h2', { class: 'bld-inspector__title' }, spaces.length + ' spaces are selected'),
          h('p', null, 'Drag one to move them together. Delete removes them. Ctrl+C copies them, and Ctrl+V pastes the copy where the pointer is, on any floor.'),
        );
      } else if (one.kind === 'room') {
        buildRoom(one);
      } else {
        buildOther(one);
      }
    }
    if (!one || !parts) return;
    const title = element.querySelector('#inspector-title');
    const name = one.kind === 'room' ? roomName(one, true) : (one.label.trim() === '' ? 'An other space' : one.label);
    if (title.textContent !== name) title.textContent = name;
    if (parts.kind === 'room') syncRoom(one);
    else {
      parts.label.set(one.label);
      parts.otherKind.set(one.otherKind);
      if (document.activeElement !== parts.colour) parts.colour.value = one.colour;
    }
  }

  return {
    element,
    update,
    // Put the cursor in the room number, everything in it selected.
    focusNumber() {
      if (!parts || parts.kind !== 'room') return false;
      parts.number.input.focus();
      parts.number.input.select();
      return true;
    },
  };
}
