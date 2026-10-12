// The room picker of the group editor: a field that shows the slot's room as
// "204 — Ms. Okafor" and, under it, the building's rooms to pick from. Typing
// narrows the list (by number or by teacher). The arrow keys move a highlight
// through the list and Enter picks what they highlighted; Escape closes the
// list and then puts the room back.
//
// Enter with nothing highlighted by the arrows reads what was typed exactly
// as leaving the field does (room-rules.js, `readTyped`): a room's number or
// whole label is that room, text that names one room by its teacher is that
// room, an emptied field means no room, and text that is no room of the
// building is kept as typed, with no room, the slot marked "not in the
// building" (spec 5: a schedule can be entered before the building is drawn,
// and a room that has gone stays in the schedule). The grid does the same
// with a number typed into a cell. Text that two rooms answer to is not
// settled for the user: Enter keeps the list open on the two and says so,
// and leaving the field keeps the text as typed.
//
// A field that holds a room opens with that room highlighted, so Enter there
// changes nothing.
//
// One line under the field carries the words that are not options: that
// nothing matches, that two rooms do, that the building has no rooms yet
// (with a link to it). It is a status and the field is described by it, so
// it is heard as well as seen, and its link is a Tab away.
//
// roomPicker({ name, key, text, roomId, missing, describedBy, options, onPick, onKeep })
//   text      what the slot holds now, as shown
//   roomId    the id of the room it holds, or null
//   missing   true when that text is not a room of the building
//   options   a function returning [{ id, label, detail, number }]; id null is "No room"
//   onPick(id)
//   onKeep(text)   keep the text as typed, with no room
// While the field is readOnly the list does not open and nothing is picked
// or kept.
// returns { element, input }

import { h, uid } from '../components/dom.js';
import { NOT_IN_BUILDING } from '../../engine/exports.js';
import { keyed } from './common.js';
import { readTyped, listFor, severalWords } from './room-rules.js';

export function roomPicker(options) {
  const id = uid('room');
  const listId = id + '-list';
  const missingId = id + '-missing';
  const lineId = id + '-line';
  const held = options.roomId === undefined ? null : options.roomId;
  let shown = [];
  let active = -1;
  let open = false;
  let dirty = false;
  // the rooms Enter found the text to name, while the list is open on them
  let several = null;
  let said = '';

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
  // The words that are not options (the top of this file).
  const line = h('p', { class: 'sch-room__line', id: lineId, role: 'status' });
  const element = h('div', { class: 'picker sch-room' }, input, line, missing, list);
  if (options.missing === true) input.classList.add('sch-room--missing');

  const rooms = () => options.options().filter((option) => option.id !== null);

  // Kept text that two rooms answer to says so for as long as it is kept.
  const lasting = options.missing === true ? readTyped(options.text, rooms()) : null;
  const lastingWords = lasting && lasting.kind === 'several' ? severalWords(lasting.options.length) : '';

  function describe() {
    const ids = [options.describedBy, missing.hidden ? null : missingId, line.firstChild ? lineId : null].filter(Boolean).join(' ');
    if (ids) input.setAttribute('aria-describedby', ids);
    else input.removeAttribute('aria-describedby');
  }

  // To the building, where rooms get their numbers. What was typed is kept
  // first, as leaving the field keeps it.
  function toBuilding(event) {
    event.preventDefault();
    if (dirty) resolve('leave');
    else close();
    location.hash = '#building';
  }

  // Put the line's words up. They are set only when they change, so a status
  // is said once and not at every key.
  function say(kind, words) {
    const key = kind + '|' + words;
    if (key !== said) {
      said = key;
      line.dataset.says = kind;
      if (kind === 'building') {
        line.replaceChildren(words, h('a', {
          href: '#building',
          on: {
            // the press must not take the focus from the field on a browser
            // that gives a pressed link none: the list would shut on the link
            pointerdown: (event) => event.preventDefault(),
            click: toBuilding,
            blur: (event) => {
              if (event.relatedTarget !== input) leave();
            },
          },
        }, 'Number them in Building.'));
      } else if (words === '') {
        line.replaceChildren();
      } else {
        line.replaceChildren(words);
      }
    }
    describe();
  }

  // The line for the picker as it stands.
  function words() {
    if (several) return say('several', severalWords(several.length));
    if (open && rooms().length === 0) return say('building', 'No rooms in the building yet. ');
    if (open && dirty && input.value.trim() !== '' && shown.length === 0) return say('none', 'No room matches. It is kept as typed, and marked as not in the building.');
    if (!dirty && lastingWords !== '') return say('several', lastingWords);
    return say('', '');
  }

  // Marked as it is typed: text that matches nothing in the list.
  function markTyped() {
    const text = input.value.trim();
    input.classList.toggle('sch-room--missing', dirty ? text !== '' && shown.length === 0 : options.missing === true);
    // the line about what the slot holds is not about what is being typed
    missing.hidden = dirty || options.missing !== true;
  }

  function matching() {
    const all = options.options();
    if (several) return several;
    if (dirty) return listFor(input.value, all);
    // kept text opens on the rooms it could be, when there are any
    const hinted = options.missing === true ? listFor(options.text, all) : [];
    return hinted.length > 0 ? hinted : all;
  }

  function mark() {
    Array.from(list.children).forEach((item, index) => {
      item.setAttribute('aria-selected', String(index === active));
    });
    if (active >= 0 && list.children[active]) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  // With nothing to pick there is no list, only the line: a listbox has
  // options. (With no rooms in the building "No room" is not offered either;
  // emptying the field is the way to it.)
  function draw() {
    shown = rooms().length === 0 ? [] : matching();
    if (active >= shown.length) active = -1;
    list.hidden = shown.length === 0;
    input.setAttribute('aria-expanded', String(shown.length > 0));
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
    mark();
    markTyped();
    words();
  }

  // Open the list. A field that holds a room and has not been typed in
  // opens with that room highlighted, where Enter changes nothing; anything
  // else opens with no highlight. So the highlight is only ever on the
  // slot's own room or where the arrow keys put it, and Enter picking what
  // is highlighted picks nothing the arrow keys did not go to.
  function show() {
    if (input.readOnly) return;
    const was = open;
    open = true;
    draw();
    if (!was && !dirty) {
      active = held === null ? -1 : shown.findIndex((option) => option.id === held);
      mark();
    }
  }

  function close() {
    open = false;
    active = -1;
    several = null;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    words();
  }

  function revert() {
    dirty = false;
    close();
    input.value = options.text;
    markTyped();
    words();
  }

  function pick(option) {
    // the room the slot already holds, or no room for a slot that has none:
    // nothing to change
    if (input.readOnly || (options.missing !== true && option.id === held)) {
      revert();
      return;
    }
    dirty = false;
    close();
    input.value = option.id === null ? '' : option.label;
    options.onPick(option.id);
  }

  // Keep what was typed, with no room. The slot is drawn again for the
  // change, and says then that the text is not in the building.
  function keep(text) {
    if (input.readOnly || (options.missing === true && text === options.text)) {
      revert();
      return;
    }
    dirty = false;
    close();
    input.value = text;
    options.onKeep(text);
  }

  // What was typed, read by the one rule (room-rules.js). `how` is 'enter'
  // or 'leave': with two rooms to choose between, Enter leaves the list open
  // on them and says so; leaving the field keeps the text as typed. Neither
  // picks one of them.
  function resolve(how) {
    const result = readTyped(input.value, rooms());
    if (result.kind === 'none') pick({ id: null });
    else if (result.kind === 'room') pick(result.option);
    else if (result.kind === 'several' && how === 'enter') {
      several = result.options;
      active = -1;
      open = true;
      draw();
    } else keep(input.value.trim());
  }

  // The focus has left the picker (the field, and the line's link).
  function leave() {
    const typed = dirty;
    if (typed) resolve('leave');
    else close();
  }

  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    if (input.readOnly) return;
    dirty = true;
    several = null;
    // typing takes the highlight off: Enter then reads the text
    active = -1;
    show();
  });
  input.addEventListener('click', () => {
    if (!open) show();
  });
  input.addEventListener('blur', (event) => {
    // to the line's link: the picker still has the focus
    if (event.relatedTarget && line.contains(event.relatedTarget)) return;
    leave();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (input.readOnly) return;
      const down = event.key === 'ArrowDown';
      if (!open) {
        show();
        // nothing of its own to open on: the arrow goes to the first, or the last
        if (active === -1 && shown.length > 0) {
          active = down ? 0 : shown.length - 1;
          mark();
        }
        return;
      }
      if (shown.length === 0) return;
      active = active === -1 ? (down ? 0 : shown.length - 1) : (active + (down ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && shown[active]) pick(shown[active]);
      else if (dirty) resolve('enter');
      else close();
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

  words();
  return { element, input };
}
