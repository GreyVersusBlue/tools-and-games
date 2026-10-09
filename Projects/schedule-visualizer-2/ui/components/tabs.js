// Tabs. Left and Right move between them and select as they go, Home and End
// jump to the ends, and only the selected tab is a Tab stop.
//
// tabs({ label, items: [{ id, label, panel: () => node }], selected, onSelect })
// returns { element, select(id), selected }

import { h, uid } from './dom.js';

export function tabs(options) {
  const base = uid('tabs');
  const list = h('div', { class: 'tabs__list', role: 'tablist', 'aria-label': options.label });
  const panel = h('div', { class: 'tabs__panel', role: 'tabpanel', tabindex: '0', id: base + '-panel' });
  const element = h('div', { class: 'tabs' }, list, panel);
  let selected = null;

  const buttons = options.items.map((item) => {
    const button = h('button', {
      type: 'button',
      class: 'tabs__tab',
      role: 'tab',
      id: base + '-' + item.id,
      'aria-controls': base + '-panel',
      'aria-selected': 'false',
      tabindex: '-1',
      data: { tab: item.id },
      on: { click: () => choose(item.id, true) },
    }, item.label);
    list.append(button);
    return button;
  });

  function show(id) {
    const index = Math.max(0, options.items.findIndex((item) => item.id === id));
    const item = options.items[index];
    selected = item.id;
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', buttons[index].id);
    panel.replaceChildren(item.panel());
    return buttons[index];
  }

  function choose(id, tell) {
    if (id === selected) return;
    show(id);
    if (tell && options.onSelect) options.onSelect(id);
  }

  list.addEventListener('keydown', (event) => {
    const at = buttons.indexOf(document.activeElement);
    if (at === -1) return;
    let next = at;
    if (event.key === 'ArrowRight') next = (at + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    choose(options.items[next].id, true);
    buttons[next].focus();
  });

  show(options.selected);
  return {
    element,
    // Select without calling onSelect (the address changed, the tab follows).
    select(id) {
      choose(id, false);
    },
    // Draw the selected panel again (the project changed under it).
    refresh() {
      show(selected);
    },
    get selected() {
      return selected;
    },
  };
}
