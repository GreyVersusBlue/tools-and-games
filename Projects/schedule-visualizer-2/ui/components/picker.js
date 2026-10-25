// A picker: a field with a list under it that narrows as you type. Arrow keys
// move through the list, Enter picks, Escape closes the list. What is typed is
// matched anywhere in an option's label, without regard to case.
//
// picker({ label, labelledBy, describedBy, placeholder, options, onPick, emptyText, keepText })
//   options   a function returning [{ id, label, detail }], asked each time
//   onPick(option)
//   keepText  true leaves the picked label in the field; otherwise it clears,
//             ready for the next pick
// While the field is readOnly the list does not open and nothing is picked.
// Each option in the list carries its id as `data-id` (as text; an option
// with no id has ''), which is how a drawing hands the highlight over
// (`picker:resume` below).
// returns { element, input, close() }

import { h, uid } from './dom.js';

export function filterOptions(options, text) {
  const wanted = text.trim().toLowerCase();
  if (wanted === '') return options.slice();
  return options.filter((option) => option.label.toLowerCase().includes(wanted));
}

// An option's id as the list carries it.
export function optionKey(option) {
  return option.id === undefined || option.id === null ? '' : String(option.id);
}

export function picker(options) {
  const id = uid('picker');
  const listId = id + '-list';
  let shown = [];
  let active = -1;
  let open = false;

  const input = h('input', {
    class: 'field__input picker__input',
    id,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: options.placeholder,
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-labelledby': options.labelledBy,
    'aria-describedby': options.describedBy,
  });
  const list = h('ul', { class: 'picker__list', role: 'listbox', id: listId, 'aria-label': options.listLabel || options.label || 'Choices', hidden: true });
  const element = h('div', { class: 'picker' },
    options.label ? h('label', { class: 'field__label', for: id }, options.label) : null,
    input,
    list,
  );

  function mark() {
    Array.from(list.children).forEach((item, index) => {
      if (item.getAttribute('role') !== 'option') return;
      item.setAttribute('aria-selected', String(index === active));
    });
    if (active >= 0 && list.children[active]) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function draw() {
    shown = filterOptions(options.options(), input.value);
    active = shown.length > 0 ? Math.min(Math.max(active, 0), shown.length - 1) : -1;
    if (shown.length === 0) {
      list.replaceChildren(h('li', { class: 'picker__empty', role: 'presentation' }, options.emptyText || 'Nothing matches.'));
    } else {
      list.replaceChildren(...shown.map((option, index) => h('li', {
        class: 'picker__option',
        role: 'option',
        id: listId + '-' + index,
        'aria-selected': 'false',
        data: { id: optionKey(option) },
        on: {
          // The press must not take the focus from the field, or the list
          // would shut before the click came; the pick is on the click, which
          // a finger that swipes the list or the page never makes (as
          // ui/schedule/room-picker.js does).
          pointerdown: (event) => event.preventDefault(),
          mousedown: (event) => event.preventDefault(),
          click: (event) => {
            if (event.button === 0) pick(option);
          },
        },
      }, h('span', null, option.label), option.detail ? h('span', { class: 'picker__detail' }, option.detail) : null)));
    }
    mark();
  }

  // A field that is read only shows what it holds and offers nothing: it
  // neither opens its list nor picks from it.
  function show() {
    if (input.readOnly) return;
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
    if (input.readOnly) {
      close();
      return;
    }
    input.value = options.keepText ? option.label : '';
    close();
    options.onPick(option);
  }

  input.addEventListener('input', () => {
    active = 0;
    show();
  });
  input.addEventListener('click', () => {
    if (!open) show();
  });
  // A section that draws this field again while its list is open hands the
  // list over (ui/schedule/index.js dispatches `picker:resume` on the field
  // drawn in its place, with { id } of the option that was highlighted, or
  // id null for none): the new field opens its list on that option, or on
  // none when the new list does not have it, never on the first instead.
  // An event with no id at all opens the list as a click does.
  input.addEventListener('picker:resume', (event) => {
    if (document.activeElement !== input) return;
    show();
    if (!open || !event.detail || !('id' in event.detail)) return;
    const wanted = event.detail.id;
    active = typeof wanted === 'string' ? shown.findIndex((option) => optionKey(option) === wanted) : -1;
    mark();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      if (shown.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // with nothing highlighted, Down goes to the first and Up to the last
      if (active === -1) active = step === 1 ? 0 : shown.length - 1;
      else active = (active + step + shown.length) % shown.length;
      mark();
    } else if (event.key === 'Enter') {
      if (open && active >= 0 && shown[active]) {
        event.preventDefault();
        pick(shown[active]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
  });

  return { element, input, close };
}
