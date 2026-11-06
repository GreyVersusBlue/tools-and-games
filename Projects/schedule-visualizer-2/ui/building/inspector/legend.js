// The legend of the step-free marks (DESIGN 13.3): each glyph the plan draws,
// with its words, so a mark is never known by its look alone. The glyphs are
// drawn here in small SVG from the page's tokens; the plan's own drawing of
// them is the surface's (ui/surface), and this legend says what that draws.

import { h } from '../../components/dom.js';

const SVG = 'http://www.w3.org/2000/svg';

function svg(shapes) {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('viewBox', '0 0 20 20');
  root.setAttribute('width', '24');
  root.setAttribute('height', '24');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  root.setAttribute('class', 'bi-glyph');
  for (const [tag, attributes] of shapes) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    root.append(node);
  }
  return root;
}

// an elevator stop: a solid square with two triangles, up over down
const STOP = () => svg([
  ['rect', { x: '2', y: '2', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
  ['path', { d: 'M10 4.5 14 9H6z M10 15.5 6 11h8z', fill: 'currentColor' }],
]);
// staff only: the car's pill with a key-shaped notch
const STAFF = () => svg([
  ['rect', { x: '2', y: '6', width: '16', height: '8', rx: '4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
  ['path', { d: 'M12 10h4 M14 10v2.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
]);
// a step: two short parallel bars across the cell
const STEP = () => svg([
  ['rect', { x: '2', y: '2', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1', opacity: '0.4' }],
  ['path', { d: 'M3 8h14 M3 12h14', fill: 'none', stroke: 'var(--warn)', 'stroke-width': '2.5' }],
]);
// an area of refuge: a rounded square outline with a seated figure
const REFUGE = () => svg([
  ['rect', { x: '2', y: '2', width: '16', height: '16', rx: '4', fill: 'none', stroke: 'var(--accent)', 'stroke-width': '1.5' }],
  ['circle', { cx: '9', cy: '6.5', r: '1.5', fill: 'currentColor' }],
  ['path', { d: 'M9 8.5V12h4l1 3 M9 10h3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' }],
]);

export const LEGEND = [
  { id: 'stop', glyph: STOP, words: 'Elevator stop' },
  { id: 'staff', glyph: STAFF, words: 'Staff and authorised only (on the elevator\'s letter)' },
  { id: 'step', glyph: STEP, words: 'Step: step-free routes go round it' },
  { id: 'refuge', glyph: REFUGE, words: 'Area of refuge' },
];

// legend() -> the list element
export function legend() {
  return h('ul', { class: 'bi-legend', id: 'floor-legend', 'aria-labelledby': 'floor-legend-heading' },
    ...LEGEND.map((entry) => h('li', { class: 'bi-legend__row', data: { legend: entry.id } }, entry.glyph(), h('span', { class: 'bi-legend__words' }, entry.words))));
}
