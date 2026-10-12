// Toasts: bottom-left, one at a time, six seconds, with the timer paused while
// the pointer is over one or focus is inside it. The host is a `role="status"`
// element that is always in the page, so a screen reader hears each one.
//
// A section that scrolls ends in a band of paper for the message to lie on
// (ui/app.css, --toast-room), so that with the page at its end the message is
// not on the last row of a table it is about. A message taller than the band
// raises it, once, and a page that was at its end is kept there.

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

  // Make the band at the page's end as tall as this message and its gap,
  // when it is not already. It only grows: taking it back when the message
  // leaves would move the page under the reader a second time.
  // `atEnd`: was the page at its end before the message was put on it (the
  // message rises into place, and for that moment adds to the page's height).
  let room = 0;
  const atEndOf = (scroller) => Boolean(scroller) && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1;
  function makeRoom(atEnd) {
    const scroller = host.parentElement;
    if (!scroller) return;
    const gap = scroller.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
    const needed = Math.ceil(element.offsetHeight + Math.max(gap, 0) + 8);
    const standing = room || parseFloat(getComputedStyle(scroller).getPropertyValue('--toast-room')) || 76;
    if (needed <= standing) return;
    room = needed;
    // only a section that ends in the band grows with it; on one that does
    // not (the plan, the map) nothing has moved and nothing is scrolled
    const page = host.previousElementSibling;
    const before = page ? getComputedStyle(page).paddingBottom : '';
    scroller.style.setProperty('--toast-room', needed + 'px');
    if (atEnd && page && getComputedStyle(page).paddingBottom !== before) scroller.scrollTop = scroller.scrollHeight;
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
    const atEnd = atEndOf(host.parentElement);
    host.append(element);
    makeRoom(atEnd);
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
