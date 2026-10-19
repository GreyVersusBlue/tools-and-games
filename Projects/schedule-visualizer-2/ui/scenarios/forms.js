// "Add a change" (spec 9.1, DESIGN 5.4): the three kinds of change a
// scenario holds, each as a form. Move a group's room for a period on a day
// type; swap two of a group's periods; swap two groups' rooms for a period.
// The day types offered are those that are their own copy, with the ones
// that follow them named ("A Day (B Day is the same)"). The room is picked
// with the schedule's own room picker (ui/schedule/room-picker.js, used as
// it is). Under each form, what the change will say as a chip, and that
// teachers follow rooms when it changes who teaches.
//
// formsPanel(env) -> { element, update(project) }
//   env.ctx, env.memory (the lab's memory: memory.form), env.add(change)
//   (true when added; it says what happened)

import { h } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { roomPicker } from '../schedule/room-picker.js';
import { roomLabel } from '../schedule/common.js';
import { allRooms } from '../../engine/schema.js';
import { changeWords } from '../../engine/scenario.js';
import { periodWords } from '../components/words.js';
import { dayChoices, periodChoices, groupChoices, slotWords, TEACHERS_FOLLOW } from './model.js';

export const FORM_KINDS = [
  { value: 'move', label: 'Move a room' },
  { value: 'swapPeriods', label: 'Swap periods' },
  { value: 'swapRooms', label: 'Swap rooms' },
];

// What each form starts with, and what the lab keeps of it while the page is open.
export function freshForm() {
  return {
    kind: 'move',
    move: { groupId: null, dayTypeId: null, period: 0, roomId: null },
    swapPeriods: { groupId: null, dayTypeId: null, periodA: 0, periodB: 1 },
    swapRooms: { groupA: null, groupB: null, dayTypeId: null, period: 0 },
  };
}

// A form's values made good for the project as it is: a group, a day type
// or a period gone is replaced by the first there is.
function settle(project, form) {
  const groups = project.groups.map((group) => group.id);
  const days = dayChoices(project).map((day) => day.value);
  const periods = project.settings.periods;
  const group = (id, other) => (groups.includes(id) ? id : groups.find((each) => each !== other) || groups[0] || null);
  const day = (id) => (days.includes(id) ? id : days[0] || null);
  const period = (p, fallback) => (Number.isInteger(p) && p >= 0 && p < periods ? p : Math.min(fallback, Math.max(0, periods - 1)));
  const rooms = new Set(allRooms(project).map((room) => room.id));
  form.move.groupId = group(form.move.groupId);
  form.move.dayTypeId = day(form.move.dayTypeId);
  form.move.period = period(form.move.period, 0);
  if (!rooms.has(form.move.roomId)) form.move.roomId = null;
  form.swapPeriods.groupId = group(form.swapPeriods.groupId);
  form.swapPeriods.dayTypeId = day(form.swapPeriods.dayTypeId);
  form.swapPeriods.periodA = period(form.swapPeriods.periodA, 0);
  form.swapPeriods.periodB = period(form.swapPeriods.periodB, 1);
  form.swapRooms.groupA = group(form.swapRooms.groupA);
  form.swapRooms.groupB = group(form.swapRooms.groupB, form.swapRooms.groupA);
  form.swapRooms.dayTypeId = day(form.swapRooms.dayTypeId);
  form.swapRooms.period = period(form.swapRooms.period, 0);
}

// The change a form stands for, or { why } when it is not one yet.
export function formChange(form) {
  if (form.kind === 'move') {
    const f = form.move;
    if (!f.groupId || !f.dayTypeId) return { why: 'There is no group or day type to change.' };
    if (!f.roomId) return { why: 'Pick the room to move to.' };
    return { change: { kind: 'move', dayTypeId: f.dayTypeId, groupId: f.groupId, period: f.period, roomId: f.roomId } };
  }
  if (form.kind === 'swapPeriods') {
    const f = form.swapPeriods;
    if (!f.groupId || !f.dayTypeId) return { why: 'There is no group or day type to change.' };
    if (f.periodA === f.periodB) return { why: 'Pick two different ' + (form.periodWord || 'period').toLowerCase() + 's.' };
    return { change: { kind: 'swapPeriods', dayTypeId: f.dayTypeId, groupId: f.groupId, periodA: f.periodA, periodB: f.periodB } };
  }
  const f = form.swapRooms;
  if (!f.groupA || !f.groupB || !f.dayTypeId) return { why: 'There is no group or day type to change.' };
  if (f.groupA === f.groupB) return { why: 'Pick two different groups.' };
  return { change: { kind: 'swapRooms', dayTypeId: f.dayTypeId, groupA: f.groupA, groupB: f.groupB, period: f.period } };
}

function partsToNodes(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

export function formsPanel(env) {
  const ctx = env.ctx;
  const memory = env.memory;
  const kinds = choice({
    name: 'scenario-kind',
    labelledBy: 'scenario-add-title',
    value: memory.form.kind,
    options: FORM_KINDS,
    onChange(value) {
      memory.form.kind = value;
      draw(ctx.store.project, true);
    },
  });
  const title = h('h3', { class: 'scn-panel__title', id: 'scenario-add-title' }, 'Add a change');
  const body = h('div', { class: 'scn-form', data: { part: 'form' } });
  const element = h('section', { class: 'scn-add', 'aria-labelledby': 'scenario-add-title' }, title, kinds.element, body);

  // the form's parts that follow its values without being drawn again
  let now = null;
  let preview = null;
  let follow = null;
  let line = null;
  let drawnKey = '';

  const select = (id, label, options, value, onChange) => {
    const input = h('select', { class: 'field__input', id, data: { key: id } },
      options.map((option) => h('option', { value: option.value }, option.label)));
    input.value = value === null || value === undefined ? '' : String(value);
    input.addEventListener('change', () => onChange(input.value));
    return h('div', { class: 'field scn-field' }, h('label', { class: 'field__label', for: id }, label), input);
  };

  // what the slots hold now, and what the chip will say
  function follows() {
    const project = ctx.store.project;
    const form = memory.form;
    if (form.kind === 'move') {
      const f = form.move;
      now.textContent = f.groupId && f.dayTypeId ? 'Now: ' + slotWords(project, f.dayTypeId, f.groupId, f.period) + '.' : '';
    } else if (form.kind === 'swapPeriods') {
      const f = form.swapPeriods;
      const periods = periodChoices(project);
      now.textContent = f.groupId && f.dayTypeId ? 'Now: ' + periods[f.periodA].label + ', ' + slotWords(project, f.dayTypeId, f.groupId, f.periodA) + '; ' + periods[f.periodB].label + ', ' + slotWords(project, f.dayTypeId, f.groupId, f.periodB) + '.' : '';
    } else {
      const f = form.swapRooms;
      const name = (id) => (project.groups.find((group) => group.id === id) || { name: '' }).name;
      now.replaceChildren(...(f.groupA && f.groupB && f.dayTypeId ? ['Now: ', h('bdi', null, name(f.groupA)), ', ' + slotWords(project, f.dayTypeId, f.groupA, f.period) + '; ', h('bdi', null, name(f.groupB)), ', ' + slotWords(project, f.dayTypeId, f.groupB, f.period) + '.'] : []));
    }
    const made = formChange(form);
    if (made.change) {
      const said = changeWords(project, made.change);
      preview.replaceChildren('The change: ', ...partsToNodes(said.parts));
      follow.hidden = said.teachers.length === 0;
    } else {
      preview.replaceChildren();
      follow.hidden = true;
    }
  }

  function add() {
    const made = formChange(memory.form);
    if (!made.change) {
      line.textContent = made.why;
      return;
    }
    line.textContent = '';
    if (env.add(made.change)) follows();
  }

  function draw(project, focusKinds) {
    const form = memory.form;
    settle(project, form);
    const days = dayChoices(project);
    const periods = periodChoices(project);
    const groups = groupChoices(project);
    const word = periodWords(project.settings).One;
    form.periodWord = word;
    kinds.set(form.kind);
    drawnKey = keyOf(project);
    now = h('p', { class: 'scn-form__now', dir: 'auto', data: { part: 'now' } });
    preview = h('p', { class: 'scn-form__preview', dir: 'auto', data: { part: 'preview' } });
    follow = h('p', { class: 'scn-form__follow', hidden: true, data: { part: 'follow' } }, TEACHERS_FOLLOW);
    line = h('p', { class: 'scn-form__line', role: 'status', data: { part: 'line' } });
    const fields = [];
    const set = (part, key, value) => {
      form[part][key] = value;
      follows();
    };
    const whole = (value) => Number(value);
    if (form.kind === 'move') {
      const f = form.move;
      fields.push(select('scenario-move-group', 'Group', groups, f.groupId, (value) => set('move', 'groupId', value)));
      fields.push(select('scenario-move-day', 'Day type', days, f.dayTypeId, (value) => set('move', 'dayTypeId', value)));
      fields.push(select('scenario-move-period', word, periods, f.period, (value) => set('move', 'period', whole(value))));
      const rooms = allRooms(project).slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
      const room = rooms.find((each) => each.id === f.roomId) || null;
      const picker = roomPicker({
        name: 'Room to move to',
        key: 'scenario-move-room',
        text: room ? roomLabel(project, room) : '',
        roomId: room ? room.id : null,
        missing: false,
        options: () => allRooms(ctx.store.project).map((each) => ({ id: each.id, number: each.number, label: roomLabel(ctx.store.project, each), teachers: '', detail: '' })),
        onPick(id) {
          set('move', 'roomId', id);
          line.textContent = '';
          return true;
        },
        onKeep(text) {
          if (text.trim() === '') {
            set('move', 'roomId', null);
            return true;
          }
          line.textContent = 'A move goes to a room of the building. Pick one from the list.';
          return false;
        },
      });
      fields.push(h('div', { class: 'field scn-field scn-field--room' }, h('label', { class: 'field__label', for: picker.input.id }, 'Room to move to'), picker.element));
    } else if (form.kind === 'swapPeriods') {
      const f = form.swapPeriods;
      fields.push(select('scenario-periods-group', 'Group', groups, f.groupId, (value) => set('swapPeriods', 'groupId', value)));
      fields.push(select('scenario-periods-day', 'Day type', days, f.dayTypeId, (value) => set('swapPeriods', 'dayTypeId', value)));
      fields.push(select('scenario-periods-a', 'Swap ' + word.toLowerCase(), periods, f.periodA, (value) => set('swapPeriods', 'periodA', whole(value))));
      fields.push(select('scenario-periods-b', 'With', periods, f.periodB, (value) => set('swapPeriods', 'periodB', whole(value))));
    } else {
      const f = form.swapRooms;
      fields.push(select('scenario-rooms-a', 'Group', groups, f.groupA, (value) => set('swapRooms', 'groupA', value)));
      fields.push(select('scenario-rooms-b', 'Swaps rooms with', groups, f.groupB, (value) => set('swapRooms', 'groupB', value)));
      fields.push(select('scenario-rooms-day', 'Day type', days, f.dayTypeId, (value) => set('swapRooms', 'dayTypeId', value)));
      fields.push(select('scenario-rooms-period', word, periods, f.period, (value) => set('swapRooms', 'period', whole(value))));
    }
    const button = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'add-change' }, on: { click: add } }, 'Add this change');
    body.dataset.kind = form.kind;
    body.replaceChildren(h('div', { class: 'scn-form__fields' }, fields), now, preview, follow, h('div', { class: 'scn-form__actions' }, button), line);
    follows();
    if (focusKinds) {
      // the choice of kind keeps the focus it had
      const checked = kinds.element.querySelector('input:checked');
      if (checked && document.activeElement !== checked) checked.focus();
    }
  }

  // drawn again only when what the form lists changes, so a field being
  // typed in is not taken away by a change elsewhere
  function keyOf(project) {
    return JSON.stringify([
      project.groups.map((group) => [group.id, group.name]),
      project.dayTypes.map((day) => [day.id, day.name, day.own]),
      project.settings.periods,
      project.settings.periodWord,
      allRooms(project).map((room) => [room.id, room.number, room.teacherIds.join(',')]),
    ]);
  }

  function update(project) {
    if (keyOf(project) !== drawnKey) {
      const held = body.contains(document.activeElement) ? document.activeElement.dataset.key : null;
      draw(project, false);
      if (held) {
        const back = body.querySelector('[data-key="' + held + '"]');
        if (back) back.focus();
      }
    } else if (now) {
      // the slots' rooms may have changed under the same lists
      follows();
    }
  }

  return { element, update };
}
