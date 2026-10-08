// Making elements. Text always goes in as text: a name with angle brackets in
// it is shown as typed and is never read as markup. Nothing in the staff
// browser sets innerHTML.

const SVG = 'http://www.w3.org/2000/svg';

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

// h('a', { class: 'row', href: '#/room/r1', onclick: fn }, 'Room ', number)
// An attribute that is false, null or undefined is left off; true gives the
// bare attribute; `on…` with a function listens; `dataset` is an object.
export function h(tag, attrs, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

// A name somebody typed, kept apart from the sentence around it so a name in
// a right-to-left script does not reorder its neighbours.
export function typed(text) {
  return h('bdi', null, text);
}

const ICONS = {
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13z', 'M15.5 15.5L20 20'],
  map: ['M4 6.5l5-2l6 2l5-2v13l-5 2l-6-2l-5 2z', 'M9 4.5v13', 'M15 6.5v13'],
  now: ['M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z', 'M12 8v4.5l3 2'],
  me: ['M12 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z', 'M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5'],
};

// One of the four marks on the bar: 'search', 'map', 'now', 'me'. Decoration
// only; the word beside it is the name.
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon');
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
