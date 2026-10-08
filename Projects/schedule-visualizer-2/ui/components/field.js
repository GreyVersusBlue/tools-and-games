// A field that commits by itself: when it is left, or when Enter is pressed.
// There is no Save button. A refusal (the action said no, or the text could
// not be read) is shown under the field in a sentence, the field is marked,
// and what was typed stays so it can be fixed. Escape puts the last committed
// value back.
//
// field({ value, commit, parse, format, label, labelledBy, describedBy, type, inputMode, width, name, placeholder })
//   commit(parsed)   may throw, or return a promise; an Error's message is the
//                    refusal. Returning false (or a promise of it) means the
//                    change was called off and the field goes back.
//   parse(text)      text to value; may throw with a sentence. Default: the text.
//   format(value)    value to text. Default: String.
// returns { element, input, set(value), refuse(message) }

import { h, uid } from './dom.js';

export function field(options) {
  const parse = options.parse || ((text) => text);
  const format = options.format || ((value) => String(value));
  const id = options.id || uid('field');
  const refusalId = id + '-refusal';
  let committed = options.value;
  let busy = false;

  const input = h('input', {
    class: 'field__input',
    id,
    type: options.type || 'text',
    inputmode: options.inputMode,
    name: options.name,
    placeholder: options.placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-labelledby': options.labelledBy,
    'aria-describedby': options.describedBy,
    style: options.width ? 'width:' + options.width : null,
  });
  input.value = format(committed);
  const refusal = h('p', { class: 'field__refusal', id: refusalId, hidden: true });
  const element = h('div', { class: 'field' },
    options.label ? h('label', { class: 'field__label', for: id }, options.label) : null,
    input,
    refusal,
  );

  function describe(withRefusal) {
    const ids = [options.describedBy, withRefusal ? refusalId : null].filter(Boolean).join(' ');
    if (ids) input.setAttribute('aria-describedby', ids);
    else input.removeAttribute('aria-describedby');
  }

  function refuse(message) {
    refusal.textContent = message;
    refusal.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    describe(true);
  }

  function accept() {
    refusal.textContent = '';
    refusal.hidden = true;
    input.removeAttribute('aria-invalid');
    describe(false);
  }

  function set(value) {
    committed = value;
    // never pull the text out from under someone typing
    if (document.activeElement === input && input.value !== format(value) && !busy) return;
    input.value = format(value);
    accept();
  }

  async function commit() {
    if (busy) return;
    if (input.value === format(committed) && refusal.hidden) return;
    busy = true;
    try {
      const parsed = parse(input.value);
      const result = await options.commit(parsed);
      if (result === false) {
        input.value = format(committed);
      } else {
        committed = parsed;
        input.value = format(parsed);
      }
      accept();
    } catch (error) {
      refuse(error && error.message ? error.message : 'That could not be saved. Try again.');
    } finally {
      busy = false;
    }
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape' && (input.value !== format(committed) || !refusal.hidden)) {
      event.preventDefault();
      event.stopPropagation();
      input.value = format(committed);
      accept();
    }
  });

  return { element, input, set, refuse };
}

// A whole number typed into a field. `what` starts the refusal sentence.
export function wholeNumber(what) {
  return (text) => {
    const trimmed = text.trim();
    if (!/^-?\d+$/.test(trimmed)) throw new Error(what + ' is a whole number. "' + text + '" is not one.');
    return Number(trimmed);
  };
}
