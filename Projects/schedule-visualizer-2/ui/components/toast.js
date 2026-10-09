// Toasts: bottom-left, one at a time, six seconds, with the timer paused while
// the pointer is over one or focus is inside it. The host is a `role="status"`
// element that is always in the page, so a screen reader hears each one.
//
// createToasts(host, { back }) -> { show({ text, action: { label, run }, duration }), dismiss(), focus(), showing }
//   back()   where the focus goes when a toast that held it leaves the page

import { h } from './dom.js';
import { icon } from './icons.js';

export const TOAST_MS = 6000;

export function createToasts(host, options) {
  const back = options && options.back;
  let element = null;
  let timer = null;
  let remaining = 0;
  let startedAt = 0;
  let held = 0;

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function run() {
    stop();
    if (remaining === Infinity) return;
    startedAt = performance.now();
    timer = setTimeout(dismiss, remaining);
  }

  function hold() {
    held += 1;
    if (held === 1 && timer !== null) {
      remaining = Math.max(0, remaining - (performance.now() - startedAt));
      stop();
    }
  }

  function release() {
    held = Math.max(0, held - 1);
    if (held === 0 && element) run();
  }

  function dismiss() {
    stop();
    if (!element) return;
    const hadFocus = element.contains(document.activeElement);
    element.remove();
    element = null;
    held = 0;
    if (hadFocus && back) back();
  }

  function show(options) {
    dismiss();
    const action = options.action
      ? h('button', {
        type: 'button',
        class: 'toast__action',
        on: {
          click: () => {
            const act = options.action.run;
            dismiss();
            act();
          },
        },
      }, options.action.label)
      : null;
    element = h('div', { class: 'toast' + (options.kind === 'problem' ? ' toast--problem' : '') },
      h('span', { class: 'toast__text' }, options.text),
      action,
      h('button', { type: 'button', class: 'toast__close', 'aria-label': 'Dismiss this message', on: { click: dismiss } }, icon('close', 16)),
    );
    element.addEventListener('pointerenter', hold);
    element.addEventListener('pointerleave', release);
    element.addEventListener('focusin', hold);
    element.addEventListener('focusout', release);
    host.append(element);
    held = 0;
    remaining = options.duration === undefined ? TOAST_MS : options.duration;
    run();
  }

  return {
    show,
    dismiss,
    get showing() {
      return element !== null;
    },
    // F6 lands here: the action when there is one, else the close button.
    focus() {
      if (!element) return false;
      (element.querySelector('.toast__action') || element.querySelector('.toast__close')).focus();
      return true;
    },
  };
}
