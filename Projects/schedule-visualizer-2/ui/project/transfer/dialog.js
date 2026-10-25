// The dialog both sides of a sending run in. Unlike the shell's openDialog,
// its body changes as the sending goes on, and its title and Close stay in
// view while the body scrolls under them (a phone, upright or on its side).
//
//   const dialog = transferDialog({ id, title, opener, fallbackFocus, onClose })
//   dialog.show(state, ...children)   replaces the body; sets data-state
//   dialog.status                     the role=status line at the body's top
//   dialog.close()                    Close, Escape and this all end here
//
// It traps Tab, closes on Escape, and gives the focus back to the opener (or
// to fallbackFocus() when the opener has gone). onClose() runs first, once,
// so the camera and the connection are stopped whichever way it was closed:
// Close, Escape, close() here, the element's own close() (its close event),
// and the page under it going away. The opener is the card's button, so when
// it leaves the document the Project page has been taken down (Back, or a
// section key) and the dialog goes with it, leaving the focus to the shell.

import { h, uid, focusables } from '../../components/dom.js';

export function transferDialog(options) {
  const titleId = uid('xfer-title');
  // the page's body is nobody to give the focus back to (SV2-32r, as dialog.js)
  const given = options.opener || document.activeElement;
  const opener = given === document.body ? null : given;
  const status = h('p', { class: 'xfer__status', role: 'status', tabindex: '-1', data: { line: 'status' } });
  const body = h('div', { class: 'xfer__body' });
  const shut = h('button', { type: 'button', class: 'btn', data: { action: 'close-transfer' } }, 'Close');
  const element = h('dialog', { class: 'dialog xfer', id: options.id, 'aria-labelledby': titleId, data: { state: 'opening' } },
    h('div', { class: 'xfer__head' }, h('h2', { class: 'dialog__title', id: titleId }, options.title), shut),
    h('div', { class: 'xfer__scroll' }, status, body),
  );
  let settle;
  const closed = new Promise((resolve) => {
    settle = resolve;
  });

  let ended = false;
  let watch = null;

  // Every way out ends here, once. `refocus` is false when the page under
  // the dialog has gone, and the focus is the shell's to place.
  function end(refocus) {
    if (ended) return;
    ended = true;
    if (watch) watch.disconnect();
    try {
      if (options.onClose) options.onClose();
    } finally {
      if (element.open) element.close();
      element.remove();
      if (refocus) {
        const target = opener && opener.isConnected && typeof opener.focus === 'function' ? opener : null;
        if (target) target.focus();
        else if (typeof options.fallbackFocus === 'function') options.fallbackFocus();
      }
      settle();
    }
  }

  function close() {
    end(true);
  }

  shut.addEventListener('click', close);
  // the element closed by anything else (its own close(), a form)
  element.addEventListener('close', () => end(true));
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
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

  // A new body. The sentence goes in the status line; `focus` is what takes
  // the focus afterwards (the status line when it is left out and the focus
  // was in the old body, so it is never left on nothing).
  function show(state, sentence, children, focus) {
    const hadFocus = body.contains(document.activeElement) || document.activeElement === element;
    element.dataset.state = state;
    status.textContent = sentence;
    body.replaceChildren(...(children || []).filter(Boolean));
    if (focus) focus.focus();
    else if (hadFocus) status.focus();
  }

  document.body.append(element);
  element.showModal();
  shut.focus();
  if (opener && opener.isConnected && typeof MutationObserver === 'function') {
    watch = new MutationObserver(() => {
      if (!opener.isConnected) end(false);
    });
    watch.observe(document.body, { childList: true, subtree: true });
  }
  return { element, status, body, show, close, closed, closeButton: shut };
}
