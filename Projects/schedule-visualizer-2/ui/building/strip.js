// The tool strip (DESIGN 5.1): a vertical strip on the left edge of the
// surface, each button an icon with a one-word label under it and its single
// key in the corner, with a divider between the five tools used most and the
// rest. It is a toolbar: one Tab stop, and the arrow keys move inside it.
// On a phone the same buttons lie in two rows across the top of the plan
// (building.css, under 640 px), and the toolbar says it runs across.

import { h } from '../components/dom.js';

const SVG = 'http://www.w3.org/2000/svg';

function toolIcon(d) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

// toolStrip({ tools, pick(id) }) -> { element, setActive(id) }
export function toolStrip(options) {
  const buttons = new Map();
  const element = h('div', { class: 'bld-strip', role: 'toolbar', 'aria-label': 'Drawing tools', 'aria-orientation': 'vertical' });
  let group = null;
  for (const tool of options.tools) {
    if (group !== null && tool.group !== group) element.append(h('div', { class: 'bld-strip__divider', role: 'separator', 'aria-orientation': 'horizontal' }));
    group = tool.group;
    const key = tool.key.toUpperCase();
    const button = h('button', {
      type: 'button',
      class: 'bld-tool',
      title: tool.name + ' (' + key + ')',
      'aria-pressed': 'false',
      'aria-keyshortcuts': key,
      tabindex: '-1',
      data: { tool: tool.id },
      on: { click: () => options.pick(tool.id) },
    },
    toolIcon(tool.icon),
    h('span', { class: 'bld-tool__label' }, tool.label, tool.name === tool.label ? null : h('span', { class: 'vh' }, tool.name.slice(tool.label.length))),
    h('span', { class: 'bld-tool__key', 'aria-hidden': 'true' }, key));
    buttons.set(tool.id, button);
    element.append(button);
  }

  // which way the strip runs, for whoever is told rather than shown
  const across = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)') : null;
  const turn = () => element.setAttribute('aria-orientation', across && across.matches ? 'horizontal' : 'vertical');
  if (across) across.addEventListener('change', turn);
  turn();

  element.addEventListener('keydown', (event) => {
    const list = Array.from(buttons.values());
    const at = list.indexOf(document.activeElement);
    if (at === -1) return;
    let next = at;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (at + 1) % list.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (at - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    list[next].focus();
  });

  return {
    element,
    setActive(id) {
      for (const [toolId, button] of buttons) {
        button.setAttribute('aria-pressed', String(toolId === id));
        button.tabIndex = toolId === id ? 0 : -1;
      }
    },
  };
}
