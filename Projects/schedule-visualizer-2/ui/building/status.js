// The status line (DESIGN 5.1, spec 4.10): the bottom edge of the surface.
// What a click will do with the tool in hand, the cell under the pointer, the
// live counts of the building, and the zoom with "Fit".

import { h } from '../components/dom.js';

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

// statusLine({ zoomIn, zoomOut, fit }) -> { element, hintId, setHint, setCell, setCounts, setZoom }
export function statusLine(options) {
  const hint = h('p', { class: 'bld-status__hint', id: 'plan-hint' });
  const cell = h('p', { class: 'bld-status__cell', id: 'plan-cell' });
  const counts = h('ul', { class: 'bld-status__counts', id: 'plan-counts', 'aria-label': 'The building so far' });
  const zoom = h('output', { class: 'bld-status__zoom-value', id: 'plan-zoom', 'aria-label': 'Zoom' });
  // the outer element is measured (a container query), the inner one is laid out
  const element = h('div', { class: 'bld-status' }, h('div', { class: 'bld-status__in' },
    hint,
    cell,
    counts,
    h('div', { class: 'bld-status__zoom', role: 'group', 'aria-label': 'Zoom' },
      h('button', { type: 'button', class: 'bld-status__btn', title: 'Zoom out (-)', 'aria-label': 'Zoom out', 'aria-keyshortcuts': '-', data: { action: 'zoom-out' }, on: { click: options.zoomOut } }, '−'),
      zoom,
      h('button', { type: 'button', class: 'bld-status__btn', title: 'Zoom in (=)', 'aria-label': 'Zoom in', 'aria-keyshortcuts': '=', data: { action: 'zoom-in' }, on: { click: options.zoomIn } }, '+'),
      h('button', { type: 'button', class: 'bld-status__btn bld-status__btn--fit', title: 'Fit the plan to the window (0)', 'aria-keyshortcuts': '0', data: { action: 'fit' }, on: { click: options.fit } }, 'Fit'),
    ),
  ));

  return {
    element,
    hintId: hint.id,
    setHint(text) {
      if (hint.textContent !== text) hint.textContent = text;
    },
    // "Column 6, row 4 · Room 204", or nothing when the pointer is elsewhere.
    setCell(text) {
      if (cell.textContent !== text) cell.textContent = text;
    },
    // total: what engine/building.js counts(building) returns.
    setCounts(total) {
      const items = [
        ['rooms', total.rooms === 0 ? 'No rooms' : total.numberedRooms + ' of ' + plural(total.rooms, 'room', 'rooms') + ' numbered'],
        ['corridor', plural(total.corridorCells, 'corridor cell', 'corridor cells')],
        ['connections', plural(total.connections, 'stairs connection', 'stairs connections')],
        ['exits', plural(total.exits, 'exit', 'exits')],
        ['floors', plural(total.floors, 'floor', 'floors')],
      ];
      const text = items.map((item) => item[1]).join('|');
      if (counts.dataset.text === text) return;
      counts.dataset.text = text;
      counts.replaceChildren(...items.map(([id, words]) => h('li', { data: { count: id } }, words)));
    },
    setZoom(value) {
      const text = Math.round(value * 100) + '%';
      if (zoom.textContent !== text) zoom.textContent = text;
    },
  };
}
