// The unlock screen. A locked file shows nothing of the school until the
// staff passcode is typed: not its name, not a teacher. What it can show is
// when it was published, which travels outside the lock.

import { h } from './dom.js';
import { dayText } from './dates.js';

export const WRONG_PASSCODE_SENTENCE = 'That passcode did not open this schedule. Check it and try again.';

// unlockScreen({ publishedAt, now, unlock }) → { element, focus() }.
// `unlock(passcode)` resolves true when it opened, false when the passcode was
// wrong, and may reject with an Error whose message is shown as it is.
export function unlockScreen(options) {
  const field = h('input', {
    class: 'field__input',
    id: 'passcode',
    type: 'password',
    name: 'passcode',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    required: true,
    'aria-describedby': 'passcode-says',
  });
  const says = h('p', { class: 'field__says', id: 'passcode-says', role: 'alert' });
  const button = h('button', { class: 'btn btn--primary btn--wide', type: 'submit' }, 'Unlock');
  let busy = false;

  const form = h('form', {
    class: 'gate__form',
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      if (busy) return;
      if (field.value === '') {
        says.textContent = 'Enter the staff passcode.';
        field.focus();
        return;
      }
      busy = true;
      says.textContent = '';
      button.textContent = 'Unlocking…';
      button.setAttribute('aria-disabled', 'true');
      field.readOnly = true;
      let opened = false;
      let message = WRONG_PASSCODE_SENTENCE;
      try {
        opened = await options.unlock(field.value);
      } catch (error) {
        message = error && error.message ? error.message : String(error);
      }
      if (opened) return;
      busy = false;
      button.textContent = 'Unlock';
      button.removeAttribute('aria-disabled');
      field.readOnly = false;
      says.textContent = message;
      field.focus();
      field.select();
    },
  },
  h('div', { class: 'field' },
    h('label', { class: 'field__label', for: 'passcode' }, 'Staff passcode'),
    field,
    says),
  button);

  const element = h('div', { class: 'gate' },
    h('main', { class: 'gate__card' },
      h('h1', { class: 'gate__title' }, 'Staff schedule'),
      h('p', { class: 'lede' }, 'This schedule is for staff. Enter the staff passcode.'),
      form,
      h('p', { class: 'gate__foot' }, 'Published ' + dayText(options.publishedAt, options.now) + '. Nothing you type leaves this device.')));

  return {
    element,
    focus() {
      field.focus();
    },
  };
}
