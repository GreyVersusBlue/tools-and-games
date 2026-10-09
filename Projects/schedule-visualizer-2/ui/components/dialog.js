// The tool's own dialog. Centred, at most 560 px wide, the title a sentence,
// then the body, then a row of buttons that name the action, the safe one last
// and focused. It traps focus, closes on Escape (which is the safe button's
// answer), and returns focus to whatever opened it, or to `fallbackFocus()`
// when the opener has gone (a menu item that no longer exists).
//
// openDialog({ title, body, buttons, opener, fallbackFocus, id, wide })
//   body      a node, a string, or a list of either
//   buttons   [{ label, value, kind: 'primary' | 'danger' | 'plain' }], safe one last
// returns { element, close(value), closed } where `closed` resolves with the
// value of the button used, or null for Escape.

import { h, uid, focusables } from './dom.js';

export function dialogIsOpen() {
  return document.querySelector('dialog[open]') !== null;
}

export function openDialog(options) {
  const titleId = uid('dialog-title');
  const opener = options.opener || document.activeElement;
  let settle;
  const closed = new Promise((resolve) => {
    settle = resolve;
  });

  const buttons = options.buttons.map((button) => h('button', {
    type: 'button',
    class: 'btn' + (button.kind === 'primary' ? ' btn--primary' : button.kind === 'danger' ? ' btn--danger' : ''),
    on: { click: () => close(button.value) },
  }, button.label));

  const element = h('dialog', { class: 'dialog' + (options.wide ? ' dialog--wide' : ''), 'aria-labelledby': titleId, id: options.id },
    h('h2', { class: 'dialog__title', id: titleId }, options.title),
    h('div', { class: 'dialog__body' }, typeof options.body === 'string' ? h('p', null, options.body) : options.body),
    h('div', { class: 'dialog__buttons' }, buttons),
  );

  function close(value) {
    if (!element.open) return;
    element.close();
    element.remove();
    const target = opener && opener.isConnected && typeof opener.focus === 'function' ? opener : null;
    if (target) target.focus();
    else if (typeof options.fallbackFocus === 'function') options.fallbackFocus();
    settle(value === undefined ? null : value);
  }

  // Escape. The browser would close it by itself; doing it here keeps the
  // focus return and the answer in one place.
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    close(null);
  });

  // Tab stays inside.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const stops = focusables(element);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.body.append(element);
  element.showModal();
  buttons[buttons.length - 1].focus();
  return { element, close, closed };
}

// A question with two answers. Resolves true only when the action button was
// used. confirm({ title, body, action, keep, danger, opener })
export function confirm(options) {
  return openDialog({
    title: options.title,
    body: options.body,
    opener: options.opener,
    fallbackFocus: options.fallbackFocus,
    buttons: [
      { label: options.action, value: true, kind: options.danger ? 'danger' : 'primary' },
      { label: options.keep, value: false },
    ],
  }).closed.then((value) => value === true);
}
