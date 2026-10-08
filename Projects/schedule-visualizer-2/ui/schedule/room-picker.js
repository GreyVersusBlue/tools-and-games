// The room picker of the group editor: a field that shows the slot's room as
// "204 — Ms. Okafor" and, under it, the building's rooms to pick from. Typing
// narrows the list (by number or by teacher). Arrow keys move, Enter picks,
// Escape closes the list and then puts the room back. Typing a room number and
// leaving the field picks that room; an emptied field means no room. Text that
// matches no room is refused in a sentence and stays to be fixed.
//
// roomPicker({ name, key, text, describedBy, options, onPick })
//   text      what the slot holds now, as shown
//   options   a function returning [{ id, label, detail, number }]; id null is "No room"
//   onPick(id)
// returns { element, input }

import { h, uid } from '../components/dom.js';
import { roomNumberKey } from '../../engine/schema.js';
import { keyed } from './common.js';

export function roomPicker(options) {
  const id = uid('room');
  const listId = id + '-list';
  const refusalId = id + '-refusal';
  let shown = [];
  let active = -1;
  let open = false;
  let dirty = false;

  const input = keyed(h('input', {
    class: 'field__input picker__input',
    id,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'No room',
    'aria-label': options.name,
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
  }), options.key);
  input.value = options.text;
  const list = h('ul', { class: 'picker__list', role: 'listbox', id: listId, 'aria-label': 'Rooms', hidden: true });
  const refusal = h('p', { class: 'field__refusal', id: refusalId, hidden: true });
  const element = h('div', { class: 'picker sch-room' }, input, list, refusal);

  function describe() {
    const ids = [options.describedBy, refusal.hidden ? null : refusalId].filter(Boolean).join(' ');
    if (ids) input.setAttribute('aria-describedby', ids);
    else input.removeAttribute('aria-describedby');
  }
  describe();

  function refuse(message) {
    refusal.textContent = message;
    refusal.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    describe();
  }

  function accept() {
    refusal.hidden = true;
    refusal.textContent = '';
    input.removeAttribute('aria-invalid');
    describe();
  }

  function matching() {
    const all = options.options();
    const wanted = dirty ? input.value.trim().toLowerCase() : '';
    return wanted === '' ? all : all.filter((option) => option.id !== null && option.label.toLowerCase().includes(wanted));
  }

  function mark() {
    Array.from(list.children).forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
    if (active >= 0 && list.children[active] && list.children[active].id) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function draw() {
    shown = matching();
    active = shown.length > 0 ? Math.min(Math.max(active, 0), shown.length - 1) : -1;
    if (shown.length === 0) {
      list.replaceChildren(h('li', { class: 'picker__empty', role: 'presentation' }, 'No room matches.'));
    } else {
      list.replaceChildren(...shown.map((option, index) => h('li', {
        class: 'picker__option',
        role: 'option',
        id: listId + '-' + index,
        'aria-selected': 'false',
        data: { room: option.id === null ? '' : option.id },
        on: {
          // pointerdown, not click: the field must not blur first
          pointerdown: (event) => {
            event.preventDefault();
            pick(option);
          },
        },
      }, h('span', null, option.label), option.detail ? h('span', { class: 'picker__detail' }, ' ', option.detail) : null)));
    }
    mark();
  }

  function show() {
    open = true;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    draw();
  }

  function close() {
    open = false;
    active = -1;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pick(option) {
    dirty = false;
    close();
    accept();
    input.value = option.id === null ? '' : option.label;
    options.onPick(option.id);
  }

  function revert() {
    dirty = false;
    input.value = options.text;
    accept();
  }

  // What was typed, turned into a room: nothing is no room; a room's number
  // or its whole label is that room; one match is that match.
  function resolve() {
    const text = input.value.trim();
    if (text === '') {
      if (options.text === '') revert();
      else pick({ id: null });
      return;
    }
    const rooms = options.options().filter((option) => option.id !== null);
    const exact = rooms.filter((option) => roomNumberKey(option.number) === roomNumberKey(text) || option.label.toLowerCase() === text.toLowerCase());
    const narrowed = exact.length > 0 ? exact : rooms.filter((option) => option.label.toLowerCase().includes(text.toLowerCase()));
    if (narrowed.length === 1) pick(narrowed[0]);
    else if (narrowed.length === 0) refuse('No room matches "' + text + '". Pick one from the list, or empty the field for no room.');
    else refuse('"' + text + '" matches ' + narrowed.length + ' rooms. Pick one from the list.');
  }

  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    dirty = true;
    active = 0;
    accept();
    show();
  });
  input.addEventListener('click', () => {
    if (!open) show();
  });
  input.addEventListener('blur', () => {
    close();
    if (dirty) resolve();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (shown.length === 0) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && active >= 0 && shown[active]) pick(shown[active]);
      else if (dirty) {
        close();
        resolve();
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (dirty || !refusal.hidden) {
        event.preventDefault();
        event.stopPropagation();
        revert();
      }
    }
  });

  return { element, input };
}
