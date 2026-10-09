// A floating menu, and the three ways to open one on a thing: right-click,
// long-press, and the keyboard's Menu key or Shift+F10.
//
// openMenu({ items, anchor, opener, label })
//   items    [{ label, run, checked, disabled, danger } | 'separator']
//            `checked` true or false makes the item one of a set of choices.
//   anchor   an element (the menu hangs under it) or { x, y } in the window
// One menu is open at a time. Arrow keys, Home and End move; a letter jumps to
// the next item starting with it; Enter or Space acts; Escape and Tab close;
// focus goes back to the opener.

import { h, layerFor } from './dom.js';

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 10;

let current = null;

export function closeMenu() {
  if (current) current.close(false);
}

export function openMenu(options) {
  closeMenu();
  const opener = options.opener || (options.anchor instanceof Element ? options.anchor : document.activeElement);
  const buttons = [];
  const element = h('div', { class: 'menu', role: 'menu', 'aria-label': options.label, tabindex: '-1' });

  for (const item of options.items) {
    if (item === 'separator') {
      element.append(h('div', { class: 'menu__separator', role: 'separator' }));
      continue;
    }
    const choice = typeof item.checked === 'boolean';
    const button = h('button', {
      type: 'button',
      class: 'menu__item' + (item.danger ? ' menu__item--danger' : ''),
      role: choice ? 'menuitemradio' : 'menuitem',
      'aria-checked': choice ? String(item.checked) : null,
      'aria-disabled': item.disabled ? 'true' : null,
      tabindex: '-1',
      on: {
        click: () => {
          if (item.disabled) return;
          close(true);
          item.run();
        },
      },
    }, h('span', { class: 'menu__mark', 'aria-hidden': 'true' }, item.checked === true ? '●' : ''), h('span', { class: 'menu__label' }, item.label));
    buttons.push(button);
    element.append(button);
  }

  function focusAt(index) {
    const n = buttons.length;
    if (n > 0) buttons[((index % n) + n) % n].focus();
  }

  function close(returnFocus) {
    if (current !== handle) return;
    current = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('blur', onResize);
    element.remove();
    if (opener && opener.setAttribute && opener.hasAttribute('aria-haspopup')) opener.setAttribute('aria-expanded', 'false');
    if (returnFocus !== false && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  function onOutside(event) {
    if (!element.contains(event.target)) close(false);
  }

  function onResize() {
    close(false);
  }

  element.addEventListener('keydown', (event) => {
    const at = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') focusAt(at + 1);
    else if (event.key === 'ArrowUp') focusAt(at === -1 ? -1 : at - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(-1);
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') {
      close(true);
      return;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      const letter = event.key.toLowerCase();
      for (let step = 1; step <= buttons.length; step += 1) {
        const index = (Math.max(at, 0) + step) % buttons.length;
        if (buttons[index].textContent.trim().toLowerCase().startsWith(letter)) {
          focusAt(index);
          break;
        }
      }
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });

  layerFor(opener).append(element);

  // Place it: under the anchor, or at the point; pulled back inside the window.
  const box = element.getBoundingClientRect();
  let x;
  let y;
  if (options.anchor instanceof Element) {
    const rect = options.anchor.getBoundingClientRect();
    x = rect.left;
    y = rect.bottom + 4;
    if (y + box.height > window.innerHeight - 8) y = Math.max(8, rect.top - box.height - 4);
  } else {
    x = options.anchor.x;
    y = options.anchor.y;
    if (y + box.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - box.height - 8);
  }
  if (x + box.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - box.width - 8);
  element.style.left = Math.round(x) + 'px';
  element.style.top = Math.round(y) + 'px';

  const handle = { element, close };
  current = handle;
  if (opener && opener.setAttribute && opener.hasAttribute('aria-haspopup')) opener.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('blur', onResize);
  const checked = buttons.findIndex((button) => button.getAttribute('aria-checked') === 'true');
  focusAt(checked === -1 ? 0 : checked);
  return handle;
}

// Open a menu for `target` on right-click, on a long-press (a finger held for
// 500 ms within 10 px, on this timer, never the browser's own), and on the
// Menu key or Shift+F10. `getItems(event)` returns the items, or nothing for
// no menu. Returns a function that takes the openers off again.
export function contextMenu(target, getItems, label) {
  let timer = null;
  let start = null;
  let pressed = false;

  function show(at, event) {
    const items = getItems(event);
    if (!items || items.length === 0) return;
    openMenu({ items, anchor: at, opener: target, label });
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    start = null;
  }

  function onContextMenu(event) {
    event.preventDefault();
    cancel();
    // a long-press on a touch screen also raises this; the timer has it
    if (pressed) {
      pressed = false;
      return;
    }
    // the Menu key and Shift+F10 arrive with no pointer position
    const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0);
    show(keyboard ? target : { x: event.clientX, y: event.clientY }, event);
  }

  function onDown(event) {
    pressed = false;
    if (event.pointerType !== 'touch') return;
    cancel();
    start = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      const at = start;
      cancel();
      pressed = true;
      show(at, event);
    }, LONG_PRESS_MS);
  }

  function onMove(event) {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancel();
  }

  target.addEventListener('contextmenu', onContextMenu);
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointercancel', cancel);
  return () => {
    cancel();
    target.removeEventListener('contextmenu', onContextMenu);
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', cancel);
    target.removeEventListener('pointercancel', cancel);
  };
}
