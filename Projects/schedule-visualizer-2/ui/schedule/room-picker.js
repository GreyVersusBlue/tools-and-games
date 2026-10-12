// The room picker of the group editor: a field that shows the slot's room as
// "204 — Ms. Okafor" and, under it, the building's rooms to pick from. Typing
// narrows the list (by number or by teacher). Arrow keys move, Enter picks,
// Escape closes the list and then puts the room back. Typing a room number and
// leaving the field picks that room; an emptied field means no room. Text that
// is no room of the building is kept as typed, with no room, and the slot is
// marked "not in the building" (spec 5: a schedule can be entered before the
// building is drawn, and a room that has gone stays in the schedule). The
// grid does the same with a number typed into a cell.
//
// roomPicker({ name, key, text, missing, describedBy, options, onPick, onKeep })
//   text      what the slot holds now, as shown
//   missing   true when that text is not a room of the building
//   options   a function returning [{ id, label, detail, number }]; id null is "No room"
//   onPick(id)
//   onKeep(text)   keep the text as typed, with no room
// returns { element, input }

import { h, uid } from '../components/dom.js';
import { roomNumberKey } from '../../engine/schema.js';
import { NOT_IN_BUILDING } from '../../engine/exports.js';
import { keyed } from './common.js';

export function roomPicker(options) {
  const id = uid('room');
  const listId = id + '-list';
  const missingId = id + '-missing';
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
  // Under the field while what it holds is not a room of the building.
  const missing = h('p', { class: 'sch-room__missing', id: missingId, hidden: options.missing !== true },
    h('span', { 'aria-hidden': 'true' }, '▲ '), NOT_IN_BUILDING.charAt(0).toUpperCase() + NOT_IN_BUILDING.slice(1) + '. It is kept as typed.');
  const element = h('div', { class: 'picker sch-room' }, input, list, missing);
  if (options.missing === true) input.classList.add('sch-room--missing');

  function describe() {
    const ids = [options.describedBy, missing.hidden ? null : missingId].filter(Boolean).join(' ');
    if (ids) input.setAttribute('aria-describedby', ids);
    else input.removeAttribute('aria-describedby');
  }
  describe();

  const rooms = () => options.options().filter((option) => option.id !== null);

  // Is what the field holds one room of the building: its number, or its
  // whole label? Null when it is not.
  function exact(text) {
    const found = rooms().filter((option) => roomNumberKey(option.number) === roomNumberKey(text) || option.label.toLowerCase() === text.toLowerCase());
    return found.length > 0 ? found[0] : null;
  }

  // Marked as it is typed: text that matches nothing in the list.
  function markTyped() {
    const text = input.value.trim();
    input.classList.toggle('sch-room--missing', dirty ? text !== '' && shown.length === 0 : options.missing === true);
  }

  function matching() {
    const all = options.options();
    const wanted = dirty ? input.value.trim().toLowerCase() : '';
    return wanted === '' ? all : all.filter((option) => option.id !== null && option.label.toLowerCase().includes(wanted));
  }

  function mark() {
    Array.from(list.children).forEach((item, index) => {
      if (item.getAttribute('role') === 'option') item.setAttribute('aria-selected', String(index === active));
    });
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
    // The list's last line when there is nothing to pick: why, and what
    // happens to what is typed. With no rooms at all it says where they come
    // from, and goes there (on the press, as an option picks: the field must
    // not have lost the focus and shut the list first).
    const none = rooms().length === 0
      ? h('li', { class: 'picker__empty', role: 'presentation', data: { empty: 'building' } }, 'No rooms in the building yet. ',
        h('a', {
          href: '#building',
          tabindex: '-1',
          on: {
            pointerdown: (event) => {
              event.preventDefault();
              location.hash = '#building';
            },
          },
        }, 'Number them in Building.'))
      : shown.length === 0 ? h('li', { class: 'picker__empty', role: 'presentation', data: { empty: 'match' } }, 'No room matches. It is kept as typed, and marked as not in the building.') : null;
    if (shown.length === 0) {
      list.replaceChildren(none);
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
      if (none) list.append(none);
    }
    mark();
    markTyped();
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
    input.value = option.id === null ? '' : option.label;
    options.onPick(option.id);
  }

  // Keep what was typed, with no room. The slot is drawn again for the
  // change, and says then that the text is not in the building.
  function keep(text) {
    dirty = false;
    close();
    input.value = text;
    options.onKeep(text);
  }

  function revert() {
    dirty = false;
    input.value = options.text;
    missing.hidden = options.missing !== true;
    input.classList.toggle('sch-room--missing', options.missing === true);
    describe();
  }

  // What was typed, read when the field is left or Enter is pressed with
  // nothing chosen in the list: nothing is no room; a room's number or its
  // whole label is that room; text that names one room by its teacher is that
  // room; anything else is kept as typed. A number is never turned into
  // another number: "10" is not Room 101, however few rooms there are yet.
  function resolve() {
    const text = input.value.trim();
    if (text === '') {
      if (options.text === '') revert();
      else pick({ id: null });
      return;
    }
    const found = exact(text);
    if (found) {
      pick(found);
      return;
    }
    const wanted = text.toLowerCase();
    const byTeacher = rooms().filter((option) => option.label.slice(option.number.length).toLowerCase().includes(wanted));
    if (byTeacher.length === 1) pick(byTeacher[0]);
    else if (options.missing === true && text === options.text) revert();
    else keep(text);
  }

  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    dirty = true;
    active = 0;
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
      } else if (dirty) {
        event.preventDefault();
        event.stopPropagation();
        revert();
      }
    }
  });

  return { element, input };
}
