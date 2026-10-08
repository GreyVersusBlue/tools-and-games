// The floor tabs (DESIGN 4): the top bar's second row on the Building
// section. One tab a floor, in the building's order, each with a small count
// of the problems the building checks found on it, and a "+" that adds a
// floor the size of the one on screen. Left and Right move between tabs.

import { h } from '../components/dom.js';

// floorTabs({ panelId, open(floorId), add() }) -> { element, update(floors, currentId, problems) }
//   problems   Map of floor id -> how many problems are on it
export function floorTabs(options) {
  const list = h('div', { class: 'bld-floors__list', role: 'tablist', 'aria-label': 'Floors' });
  const addButton = h('button', { type: 'button', class: 'bld-floors__add', id: 'add-floor', title: 'Add a floor the size of this one', 'aria-label': 'Add a floor', on: { click: () => options.add() } }, '+');
  const element = h('div', { class: 'bld-floors' }, list, addButton);
  let signature = '';

  list.addEventListener('keydown', (event) => {
    const tabs = Array.from(list.children);
    const at = tabs.indexOf(document.activeElement);
    if (at === -1) return;
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
