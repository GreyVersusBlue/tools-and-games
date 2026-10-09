// The small controls the inspector's tabs are made of, beside the shared
// field and picker: a select and a checkbox that commit by themselves, a list
// whose rows are kept while only their values change, and a way to draw a
// part again without losing the focus.
//
// A control that can be drawn again carries `data-key`; the focus goes back
// to whatever has the same key afterwards.

import { h, uid } from '../../components/dom.js';

// Run `draw`, then put the focus back on the control with the key the
// focused one had, when the focus was inside `root`.
export function keepFocus(root, draw) {
  const active = document.activeElement;
  const key = active && root.contains(active) && active.dataset ? active.dataset.key : null;
  draw();
  if (!key) return;
  const again = Array.from(root.querySelectorAll('[data-key]')).find((el) => el.dataset.key === key);
  if (again && again !== document.activeElement) again.focus();
}

// selectField({ id, label, name, key, options: [{ value, label }], value, commit })
//   commit(value)   may throw; the message is shown under the select and the
//                   choice goes back
// returns { element, select, set(value), setOptions(options, value) }
export function selectField(options) {
  const id = options.id || uid('select');
  let committed = options.value;
  const select = h('select', { class: 'bi-select', id, name: options.name, data: options.key ? { key: options.key } : null, 'aria-label': options.ariaLabel });
  const refusal = h('p', { class: 'field__refusal', hidden: true });

  function fill(list) {
    select.replaceChildren(...list.map((option) => h('option', { value: option.value }, option.label)));
  }

  function set(value) {
    committed = value;
    select.value = value;
    refusal.hidden = true;
    select.removeAttribute('aria-invalid');
  }

  select.addEventListener('change', () => {
    try {
      options.commit(select.value);
      committed = select.value;
      refusal.hidden = true;
      select.removeAttribute('aria-invalid');
    } catch (error) {
      select.value = committed;
      refusal.textContent = error && error.message ? error.message : 'That could not be saved. Try again.';
      refusal.hidden = false;
    }
  });

  fill(options.options);
  select.value = committed;
  const element = h('div', { class: 'field' }, options.label ? h('label', { class: 'field__label', for: id }, options.label) : null, select, refusal);
  return {
    element,
    select,
    set,
    setOptions(list, value) {
      fill(list);
      set(value);
    },
  };
}

// checkField({ id, label, hint, name, key, checked, commit })
// returns { element, input, set(checked) }
export function checkField(options) {
  const id = options.id || uid('check');
  const hintId = options.hint ? id + '-hint' : null;
  const input = h('input', { type: 'checkbox', class: 'bi-check__box', id, name: options.name, data: options.key ? { key: options.key } : null, 'aria-describedby': hintId });
  input.checked = options.checked === true;
  const refusal = h('p', { class: 'field__refusal', hidden: true });
  input.addEventListener('change', () => {
    try {
      options.commit(input.checked);
      refusal.hidden = true;
    } catch (error) {
      input.checked = !input.checked;
      refusal.textContent = error && error.message ? error.message : 'That could not be saved. Try again.';
      refusal.hidden = false;
    }
  });
  const element = h('div', { class: 'bi-check' },
    input,
    h('label', { class: 'bi-check__label', for: id }, options.label),
    options.hint ? h('p', { class: 'bi-check__hint bld-inspector__small', id: hintId }, options.hint) : null,
    refusal,
  );
  return {
    element,
    input,
    set(checked) {
      input.checked = checked === true;
    },
  };
}

// A number that may be left empty: '' is null.
export function wholeOrEmpty(what) {
  return (text) => {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    if (!/^\d+$/.test(trimmed)) throw new Error(what + ' is a whole number, or empty. "' + text + '" is neither.');
    return Number(trimmed);
  };
}

// A number with a decimal point allowed.
export function decimal(what) {
  return (text) => {
    const trimmed = text.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new Error(what + ' is a number. "' + text + '" is not one.');
    return Number(trimmed);
  };
}

// A list whose rows stay as long as the same things are in it in the same
// order: then each row is only told the new values (so a field being typed
// in is never replaced under the typing). When the things change, the rows
// are built again and the focus goes back by key.
//
// keyedList(element) -> { update(items, { key(item), build(item) -> { element, sync(item) } }) }
export function keyedList(element) {
  let signature = null;
  let rows = [];
  return {
    update(items, spec) {
      const next = items.map(spec.key).join('|');
      if (next === signature) {
        items.forEach((item, index) => rows[index].sync(item));
        return;
      }
      signature = next;
      keepFocus(element, () => {
        rows = items.map((item) => spec.build(item));
        element.replaceChildren(...rows.map((row) => row.element));
        items.forEach((item, index) => rows[index].sync(item));
      });
    },
  };
}

// A heading inside a tab.
export function heading(text, id) {
  return h('h3', { class: 'bi-heading', id }, text);
}

// "column 6, row 4", counting from 1.
export function cellWords(floor, cell) {
  return 'column ' + ((cell % floor.width) + 1) + ', row ' + (Math.floor(cell / floor.width) + 1);
}
