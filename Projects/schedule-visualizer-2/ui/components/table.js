// A table whose columns sort. A sortable column's header is a button; the
// header says which way it is sorted (`aria-sort`). Sorting is stable, and
// text is compared the way a person would ("Room 9" before "Room 10").
//
// table({ caption, columns, rows, sort: { column, direction }, key })
//   columns  [{ id, label, value(row), render(row), sortable, numeric }]
//            render returns a node or a string; default is value(row) as text
// returns { element, setRows(rows), sortBy(column, direction), sort }

import { h } from './dom.js';
import { icon } from './icons.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

export function sortRows(rows, column, direction) {
  if (!column) return rows.slice();
  const sign = direction === 'descending' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => sign * compareValues(column.value(a.row), column.value(b.row)) || a.index - b.index)
    .map((entry) => entry.row);
}

export function table(options) {
  let rows = options.rows;
  let sort = options.sort || { column: null, direction: 'ascending' };
  const body = h('tbody');
  const heads = new Map();

  const headRow = h('tr', null, options.columns.map((column) => {
    const th = h('th', { scope: 'col', class: column.numeric ? 'table__num' : null });
    if (column.sortable) {
      th.append(h('button', {
        type: 'button',
        class: 'table__sort',
        on: { click: () => sortBy(column.id, sort.column === column.id && sort.direction === 'ascending' ? 'descending' : 'ascending') },
      }, column.label, h('span', { class: 'table__arrow' })));
    } else {
      th.textContent = column.label;
    }
    heads.set(column.id, th);
    return th;
  }));

  const element = h('table', { class: 'table' },
    options.caption ? h('caption', { class: 'vh' }, options.caption) : null,
    h('thead', null, headRow),
    body,
  );

  function draw() {
    const column = options.columns.find((candidate) => candidate.id === sort.column) || null;
    for (const [id, th] of heads) {
      const arrow = th.querySelector('.table__arrow');
      if (!arrow) continue;
      const on = id === sort.column;
      if (on) th.setAttribute('aria-sort', sort.direction);
      else th.removeAttribute('aria-sort');
      arrow.replaceChildren(icon(on ? (sort.direction === 'ascending' ? 'up' : 'down') : 'sort', 14));
    }
    body.replaceChildren(...sortRows(rows, column, sort.direction).map((row) => h('tr', { data: options.key ? { key: String(options.key(row)) } : null },
      options.columns.map((col) => h('td', { class: col.numeric ? 'table__num' : null }, col.render ? col.render(row) : String(col.value(row)))))));
  }

  function sortBy(column, direction) {
    sort = { column, direction: direction || 'ascending' };
    draw();
  }

  draw();
  return {
    element,
    setRows(next) {
      rows = next;
      draw();
    },
    sortBy,
    get sort() {
      return sort;
    },
  };
}
