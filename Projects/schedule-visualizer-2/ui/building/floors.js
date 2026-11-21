// The floor tabs (DESIGN 4): the top bar's second row on the Building
// section. One tab a floor, in the building's order, each with a small count
// of the problems the building checks found on it, and a "+" that adds a
// floor the size of the one on screen. Left and Right move between tabs.
// The selected tab has a "⋯" button beside it, "Floor 2 actions", and a tab
// opens the same menu by right-click, the Menu key or Shift+F10 (DESIGN 16.12
// item 1; floor-menu.js has the items). A phone has the button: a tab is
// dragged to scroll the row, so there is no long-press on one.

import { h } from '../components/dom.js';

// floorTabs({ panelId, open(floorId), add(), actions(floorId, anchor, opener) }) -> { element, update(floors, currentId, problems) }
//   actions    opens the floor menu for a floor; `anchor` is an element or { x, y }
//   problems   Map of floor id -> how many problems are on it
export function floorTabs(options) {
  const list = h('div', { class: 'bld-floors__list', role: 'tablist', 'aria-label': 'Floors' });
  const addButton = h('button', { type: 'button', class: 'bld-floors__add', id: 'add-floor', title: 'Add a floor the size of this one', 'aria-label': 'Add a floor', on: { click: () => options.add() } }, '+');
  const more = h('button', {
    type: 'button',
    class: 'bld-floors__more',
    id: 'floor-actions',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': 'Floor actions',
    title: 'Floor actions',
    on: { click: () => { if (current) options.actions(current, more, more); } },
  }, '⋯');
  const element = h('div', { class: 'bld-floors' }, list, more, addButton);
  let signature = '';
  let current = null;

  function tabOf(target) {
    return target && target.closest ? target.closest('[data-floor]') : null;
  }

  // The Menu key opens the menu on its keydown (below); Windows then raises a
  // contextmenu as the key comes up, on the tab or on whatever has the focus by
  // then. That one is the same press: it is swallowed, once, so the menu opens
  // once. Any other key or a pointer press first means it is not coming.
  let pressed = false;
  function swallow(event) {
    if (!pressed) return;
    pressed = false;
    forget();
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function forget() {
    pressed = false;
    document.removeEventListener('contextmenu', swallow, true);
    document.removeEventListener('pointerdown', forget, true);
    document.removeEventListener('keydown', other, true);
  }
  function other(event) {
    if (event.key !== 'ContextMenu') forget();
  }
  function expect() {
    forget();
    pressed = true;
    document.addEventListener('contextmenu', swallow, true);
    document.addEventListener('pointerdown', forget, true);
    document.addEventListener('keydown', other, true);
  }

  // right-click on a tab: the menu at the pointer, for that tab's floor
  list.addEventListener('contextmenu', (event) => {
    const tab = tabOf(event.target);
    if (!tab || !options.actions) return;
    event.preventDefault();
    // the Menu key raises this too, with no pointer position: it hangs under the tab
    const keyboard = event.button === -1 || (event.clientX === 0 && event.clientY === 0);
    options.actions(tab.dataset.floor, keyboard ? tab : { x: event.clientX, y: event.clientY }, tab);
  });

  list.addEventListener('keydown', (event) => {
    const tabs = Array.from(list.children);
    const at = tabs.indexOf(document.activeElement);
    if (at === -1) return;
    // the Menu key and Shift+F10: this tab's menu, under the tab
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      if (event.key === 'ContextMenu') expect();
      if (options.actions) options.actions(tabs[at].dataset.floor, tabs[at], tabs[at]);
      return;
    }
    let next = at;
    if (event.key === 'ArrowRight') next = (at + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    options.open(tabs[next].dataset.floor);
    // the list is drawn again by the change of floor; the focus follows the tab
    const now = list.querySelector('[data-floor="' + tabs[next].dataset.floor + '"]');
    if (now) now.focus();
  });

  function update(floors, currentId, problems) {
    current = floors.some((floor) => floor.id === currentId) ? currentId : null;
    const selected = floors.find((floor) => floor.id === currentId);
    more.hidden = !selected;
    if (selected) {
      more.setAttribute('aria-label', selected.name + ' actions');
      more.title = selected.name + ' actions';
    }
    const next = JSON.stringify(floors.map((floor) => [floor.id, floor.name, problems.get(floor.id) || 0])) + currentId;
    if (next === signature) return;
    signature = next;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.floor : null;
    list.replaceChildren(...floors.map((floor) => {
      const count = problems.get(floor.id) || 0;
      const current = floor.id === currentId;
      return h('button', {
        type: 'button',
        class: 'bld-floors__tab',
        role: 'tab',
        id: 'floor-tab-' + floor.id,
        'aria-selected': String(current),
        'aria-controls': options.panelId,
        tabindex: current ? '0' : '-1',
        data: { floor: floor.id },
        on: { click: () => options.open(floor.id) },
      },
      h('span', { class: 'bld-floors__name' }, floor.name),
      count > 0 ? h('span', { class: 'bld-floors__badge', title: count === 1 ? '1 problem on this floor' : count + ' problems on this floor' }, String(count), h('span', { class: 'vh' }, count === 1 ? ' problem' : ' problems')) : null);
    }));
    if (focused) {
      const again = list.querySelector('[data-floor="' + focused + '"]');
      if (again) again.focus();
    }
  }

  return { element, update };
}
