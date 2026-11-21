// Toasts: bottom-left, one at a time, six seconds, with the timer paused while
// the pointer is over one or focus is inside it. The host is a `role="status"`
// element that is always in the page, so a screen reader hears each one.
//
// A section that scrolls ends in a band of paper for the message to lie on
// (ui/app.css, --toast-room), so that with the page at its end the message is
// not on the last row of a table it is about. A message taller than the band
// raises it while the message is up, and a page that was at its end is kept
// there; when the message leaves, the band is its own height again. A page
// too short to scroll is never moved.
//
// A section that docks something along the bottom of the surface (the
// movement view's playback bar and zoom buttons) says how far it reaches up
// (--toast-clear on the surface, ui/app.css), and the message sits above it.
//
// A toast's Undo stands for the one change it was shown for (SV2-87b). The
// store's Undo takes back the latest change, whatever the toast says, so when
// a newer change is made (an edit, an undo, a redo, a project loaded; not a
// quiet action, which is no step) the toast closes, with its Undo. Every toast
// whose action is labelled Undo does this, so no caller has to ask.

import { h, focusables } from './dom.js';
import { icon } from './icons.js';

export const TOAST_MS = 6000;

export function createToasts(host, options) {
  const back = options && options.back;
  let element = null;
  let timer = null;
  let remaining = 0;
  let startedAt = 0;
  let held = 0;
  let unwatch = null;

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
    if (unwatch !== null) unwatch();
    unwatch = null;
    if (!element) return;
    const hadFocus = element.contains(document.activeElement);
    // over a dialog, the focus stays in the dialog: the page behind is inert
    const dialog = over === null ? null : over.dialog;
    unlift();
    element.remove();
    element = null;
    held = 0;
    lowerRoom();
    if (hadFocus && dialog !== null && dialog.open) {
      const stops = focusables(dialog);
      (stops.length > 0 ? stops[stops.length - 1] : dialog).focus();
    } else if (hadFocus && back) back();
  }

  // Make the band at the page's end as tall as this message and its gap,
  // when it is not already, for as long as the message is up.
  // `atEnd`: was the page scrolled to its end before the message was put on
  // it (the message rises into place, and for that moment adds to the page's
  // height). A page that does not scroll is at no end: it is left where it is.
  let raised = null;
  const atEndOf = (scroller) => Boolean(scroller) && scroller.scrollHeight - scroller.clientHeight > 1 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1;
  function makeRoom(atEnd) {
    const scroller = host.parentElement;
    if (!scroller) return;
    // what a section docks at the bottom lifts the message; that is not part of the band
    const lifted = parseFloat(getComputedStyle(scroller).getPropertyValue('--toast-clear')) || 0;
    const gap = scroller.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom - lifted;
    const needed = Math.ceil(element.offsetHeight + Math.max(gap, 0) + 8);
    const standing = parseFloat(getComputedStyle(scroller).getPropertyValue('--toast-room')) || 76;
    if (needed <= standing) return;
    raised = scroller;
    // only a section that ends in the band grows with it; on one that does
    // not (the plan, the map) nothing has moved and nothing is scrolled
    const page = host.previousElementSibling;
    const before = page ? getComputedStyle(page).paddingBottom : '';
    scroller.style.setProperty('--toast-room', needed + 'px');
    if (atEnd && page && getComputedStyle(page).paddingBottom !== before) scroller.scrollTop = scroller.scrollHeight;
  }

  // The message has left: the band is the sheet's own height again.
  function lowerRoom() {
    if (!raised) return;
    raised.style.removeProperty('--toast-room');
    raised = null;
  }

  // A message raised while a modal dialog is open would lie behind it (the
  // host is in the page, which the dialog makes inert: not heard, not
  // reached). So it goes into the dialog itself, into a status region of its
  // own there (made once per dialog, and filled a frame after it is made so
  // the region exists before its words do), and is shown as a popover in the
  // top layer: heard once, from inside the dialog, and its Undo is the next
  // Tab stop after the dialog's own buttons. It is set in the free space
  // above the dialog, else below it, else at the window's foot, and set
  // again when the window or the dialog changes size. When the dialog closes
  // it goes to the modal dialog still open under it, if any, else back to its
  // place in the page, where it makes room as any message does (SV2-142,
  // SV2-142b).
  const LIFT_GAP = 8;
  let over = null;
  function modalOpen() {
    const open = Array.from(document.querySelectorAll('dialog[open]')).filter((each) => each.matches(':modal'));
    return open.length > 0 ? open[open.length - 1] : null;
  }
  function unlift() {
    if (over === null) return;
    if (over.observer) over.observer.disconnect();
    window.removeEventListener('resize', over.place);
    over.dialog.removeEventListener('close', over.closed);
    over = null;
  }
  function place() {
    const mine = element;
    if (!mine || over === null || !mine.isConnected) return;
    const box = over.dialog.getBoundingClientRect();
    const height = mine.offsetHeight;
    const width = mine.offsetWidth;
    let top;
    if (box.top - height - LIFT_GAP >= LIFT_GAP) top = box.top - height - LIFT_GAP;
    else if (box.bottom + height + LIFT_GAP <= window.innerHeight - LIFT_GAP) top = box.bottom + LIFT_GAP;
    else top = Math.max(LIFT_GAP, window.innerHeight - height - LIFT_GAP);
    mine.style.top = Math.round(top) + 'px';
    mine.style.left = Math.round(Math.max(LIFT_GAP, Math.min(box.left, window.innerWidth - width - LIFT_GAP))) + 'px';
  }
  // Back from over a dialog: to the modal still open, else into the page.
  function land(mine) {
    if (element !== mine) return;
    unlift();
    try {
      mine.hidePopover();
    } catch (error) {
      // already hidden, or taken out with its dialog
    }
    mine.removeAttribute('popover');
    mine.classList.remove('toast--over');
    mine.style.top = '';
    mine.style.left = '';
    const next = modalOpen();
    if (next !== null && liftOver(next)) return;
    const atEnd = atEndOf(host.parentElement);
    host.append(mine);
    makeRoom(atEnd);
  }
  function liftOver(dialog) {
    const mine = element;
    if (!mine || typeof mine.showPopover !== 'function') return false;
    unlift();
    let inner = Array.from(dialog.children).find((child) => child.classList.contains('toasts-over'));
    const fresh = !inner;
    if (fresh) {
      inner = h('div', { class: 'toasts-over', role: 'status' });
      dialog.append(inner);
    }
    mine.setAttribute('popover', 'manual');
    mine.classList.add('toast--over');
    over = { dialog, place: () => place(), closed: () => land(mine), observer: null };
    window.addEventListener('resize', over.place);
    dialog.addEventListener('close', over.closed);
    if (typeof ResizeObserver === 'function') {
      over.observer = new ResizeObserver(() => place());
      over.observer.observe(dialog);
      over.observer.observe(mine);
    }
    const put = () => {
      if (element !== mine || over === null || over.dialog !== dialog) return;
      inner.append(mine);
      mine.showPopover();
      place();
    };
    if (fresh) requestAnimationFrame(put);
    else put();
    return true;
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
    const dialog = modalOpen();
    if (dialog === null || !liftOver(dialog)) {
      host.append(element);
      makeRoom(atEnd);
    }
    // The store is the page's, found when the message is shown: a message
    // shown before the page has one (start-up) has nothing to follow. The
    // version tells a change made while this message was being shown from a
    // newer one.
    const store = globalThis.sv2 && globalThis.sv2.store;
    if (options.action && options.action.label === 'Undo' && store && typeof store.subscribe === 'function') {
      const shownAt = store.version;
      const mine = element;
      const stopWatching = store.subscribe((project, change) => {
        if ((change && change.quiet) || store.version === shownAt) return;
        stopWatching();
        if (element === mine) dismiss();
      });
      unwatch = stopWatching;
    }
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
