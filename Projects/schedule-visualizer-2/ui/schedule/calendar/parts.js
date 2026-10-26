// Controls the setup card and the panel share: a date field, and the
// rotation as chips (DESIGN 11.4, 11.2: every chip and its × is 44 px on a
// coarse pointer or under 640 px).

import { h } from '../../components/dom.js';
import { ROTATION_RANGE } from '../../../engine/schema.js';
import { keyed } from '../common.js';

// A date field: `input(value)` as it is typed, `commit(value)` when it is
// left changed (a date field's change event) or Enter is pressed.
export function dateInput(key, label, value, input, commit) {
  const id = key.replace(/[^a-z0-9-]/gi, '-');
  const field = keyed(h('input', { type: 'date', id, class: 'field__input cal-date', name: key }), key);
  field.value = value || '';
  field.addEventListener('input', () => input(field.value));
  field.addEventListener('change', () => {
    input(field.value);
    commit(field.value);
  });
  return { element: h('div', { class: 'field cal-field' }, h('label', { class: 'field__label', for: id }, label), field), input: field };
}

// The rotation: one chip per place, in order, each with its ×; then "Add to
// the rotation", a choice of the day types. hooks: { keyBase, remove(index),
// add(dayTypeId) }. The last chip has no ×: a rotation has at least one day.
export function rotationChips(project, rotation, hooks) {
  const names = new Map(project.dayTypes.map((dayType) => [dayType.id, dayType.name]));
  const chips = h('ol', { class: 'cal-chips', data: { part: 'rotation' } }, rotation.map((id, index) => h('li', { class: 'cal-chip' },
    h('span', { class: 'cal-chip__name' }, names.get(id) || ''),
    rotation.length > ROTATION_RANGE[0]
      ? keyed(h('button', { type: 'button', class: 'cal-chip__remove', 'aria-label': 'Take ' + (names.get(id) || '') + ' out of the rotation, place ' + (index + 1), title: 'Take it out', on: { click: () => hooks.remove(index) } }, '×'), hooks.keyBase + ':' + index + ':remove')
      : null)));
  const full = rotation.length >= ROTATION_RANGE[1];
  const add = keyed(h('select', {
    class: 'field__input cal-select',
    'aria-label': 'Add to the rotation',
    disabled: full ? '' : null,
    on: {
      change: (event) => {
        const value = event.target.value;
        if (value !== '') hooks.add(value);
      },
    },
  }, h('option', { value: '' }, full ? 'The rotation is full (' + ROTATION_RANGE[1] + ')' : 'Add to the rotation…'), project.dayTypes.map((dayType) => h('option', { value: dayType.id }, dayType.name))), hooks.keyBase + '-add');
  add.value = '';
  return h('div', { class: 'cal-rotation' }, chips, add);
}
