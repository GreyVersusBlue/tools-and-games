// The sheet itself: a table that is a grid. One cell is the Tab stop; the
// arrow keys move, Shift with them selects a block, typing replaces what a
// cell holds, Enter or F2 edits it, Escape leaves it as it was. Every cell
// carries a `data-key`, and the field a cell is edited in carries the cell's
// key with ":edit" after it, so when the tab is drawn again mid-word the
// section puts the text and the caret back (ui/schedule/index.js).
//
// sheet({ role, view, ids, stage(ops, said), edit(cells, kind), undo(), remove(row), keep(row), say(text), roomLabel(room), focusCursor(key), makeOwn(dayType) })
//   role    'groups' (the default), 'teachers' or 'rooms': what a row is. The
//           last two are the same sheet drawn from the other sides
//           (across.js): the same cursor and keys, a slot that holds group
//           names, and edits that go through `edit` (index.js stages them
//           as one step, from engine/grid-across.js)
//   view    { at, anchor, fields }: the cell the cursor is on and the other
//           corner of the selection, each { row, col } by id, kept while the
//           page is open; and whether a narrow screen shows the field columns
//   stage   take a list of ops (model.js) and draw again
//   focusCursor(key)   the cursor was moved by a drawing while the focus was
//           in the sheet (its column went out of sight): put the focus on
//           the cell with this key once the drawing is done
// returns { element, draw(model), copy(), paste(text), clear(), fillDown(), keyOfCursor(), has(node) }

import { h, uid } from '../../components/dom.js';
import { SEVERITY_WORDS } from '../common.js';
import { cellState as groupState, cellText as groupText, readCell, planPaste, namesOf } from './model.js';
import { cellState as acrossState, cellText as acrossText, namesUnknown, acrossOptions, teacherRooms, defaultRoom, cellRequest, cellsOf, followersLeft } from './across.js';
import { watchWhy } from './why.js';
import { parseTsv, writeTsv } from './tsv.js';
import { findingWords, worstFirst, MARK_WORDS } from './words.js';

const LIST_LIMIT = 60;

// Under this width the grid shows Group and the periods, and the other field
// columns wait behind the Fields button. grid.css has the same number.
export const NARROW = '(max-width: 640px)';

// The Teachers and Rooms rows of a large school (the timing fixture's 150
// rooms by 20 periods is three thousand slots) are drawn a screenful of rows
// and a margin at a time: the browser's cost of an edit is the cost of the
// table it has to lay out, and a table of three thousand slots takes it
// 190 ms a time on the machine ARCHITECTURE 23.12 measured on. A table of
// up to ROW_WINDOW rows is drawn whole, as the Groups rows are.
export const ROW_WINDOW = 60;
const MARGIN = 12;

export function cellKey(rowId, columnId) {
  return 'grid:' + rowId + ':' + columnId;
}

const CAPTIONS = { groups: 'Every group, one row each', teachers: 'Every teacher, one row each', rooms: 'Every room, one row each' };

export function sheet(options) {
  const { view } = options;
  const role = options.role || 'groups';
  const across = role !== 'groups';
  const listId = uid('grid-rooms');
  const table = h('table', { class: 'grd-table' + (across ? ' grd-table--read' : ''), role: 'grid', 'aria-label': CAPTIONS[role], 'aria-multiselectable': 'true' });
  const why = h('div', { class: 'vh grd-why' });
  const scroll = h('div', { class: 'grd-scroll' }, table, across ? why : null);
  const list = h('ul', { class: 'picker__list grd-list', role: 'listbox', id: listId, 'aria-label': across ? 'Groups' : 'Rooms', hidden: true });
  // an edit the schedule refused is said under the slot, where the field is
  const refusal = h('p', { class: 'grd-refusal', role: 'alert', hidden: true });
  const element = h('div', { class: 'grd-sheet', data: { role } }, scroll, list, refusal);
  // (watched from the first drawing, so a table never drawn adds nothing to the page)
  let watched = false;
  if (across) {
    scroll.addEventListener('scroll', () => follow(), { passive: true });
    // the frame itself has the focus when the cursor's row is not drawn: it
    // goes to the cursor, which brings the row back
    scroll.addEventListener('focus', (event) => {
      if (event.target !== scroll || !model || !view.at) return;
      const at = place(view.at);
      if (at) goTo(at.r, at.c, false);
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => follow()).observe(scroll);
  }
  const cellState = (current, row, column) => (across ? acrossState(current, row, column) : groupState(current, row, column));
  const cellText = (current, row, column) => (across ? acrossText(current, row, column) : groupText(current, row, column));

  let model = null;
  let cells = new Map();
  let editor = null;
  let drawing = false;
  let painted = [];
  let drag = null;
  let lastPointer = { type: 'mouse', onCursor: false };
  let shape = null;
  // windowed drawing (across, more than ROW_WINDOW rows): the rows drawn are
  // [from, to); a row is `rowPx` tall and the header `headPx`, both measured
  let windowed = false;
  let rowPx = 36;
  let headPx = 58;
  let from = 0;
  let to = 0;
  let rowEls = new Map();
  let body = null;
  // Does the sheet have the focus? Asked of the page first; but a cell that
  // goes out of sight while it has the focus (its column hidden at 640 px)
  // loses it to the page without a word, or with a blur from a cell whose
  // column is hidden by then, so that is remembered here until the next
  // drawing. (Hidden by the rule, as everywhere in this file: no box is asked for.)
  let focusInside = false;
  let hiddenUnderFocus = false;
  element.addEventListener('focusin', () => {
    focusInside = true;
    hiddenUnderFocus = false;
  });
  element.addEventListener('focusout', (event) => {
    const cell = drawing || !model ? null : cellOf(event.target);
    const at = cell ? place({ row: cell.dataset.row, col: cell.dataset.col }) : null;
    if (at && hiddenColumns()[at.c]) hiddenUnderFocus = true;
    else if (!event.relatedTarget || !element.contains(event.relatedTarget)) focusInside = false;
  });

  // ---------------------------------------------------------------- where

  function place(ref) {
    if (!ref || !model) return null;
    const r = model.rows.findIndex((row) => row.id === ref.row);
    const c = model.columns.findIndex((column) => column.id === ref.col);
    return r === -1 || c === -1 ? null : { r, c };
  }

  function refAt(r, c) {
    return { row: model.rows[r].id, col: model.columns[c].id };
  }

  function cellAt(r, c) {
    return cells.get(cellKey(model.rows[r].id, model.columns[c].id)) || null;
  }

  function range() {
    const at = place(view.at);
    if (!at) return null;
    const anchor = place(view.anchor) || at;
    return { r0: Math.min(at.r, anchor.r), r1: Math.max(at.r, anchor.r), c0: Math.min(at.c, anchor.c), c1: Math.max(at.c, anchor.c) };
  }

  function paint() {
    for (const cell of painted) {
      cell.setAttribute('aria-selected', 'false');
      cell.tabIndex = -1;
    }
    painted = [];
    const box = range();
    if (!box) return;
    const hidden = hiddenColumns();
    for (let r = box.r0; r <= box.r1; r += 1) {
      for (let c = box.c0; c <= box.c1; c += 1) {
        // a block is what is on screen of it
        if (hidden[c]) continue;
        const cell = cellAt(r, c);
        // (a row of a windowed table that is not drawn has no slots to mark)
        if (!cell) continue;
        cell.setAttribute('aria-selected', 'true');
        painted.push(cell);
      }
    }
    const at = place(view.at);
    const cursor = cellAt(at.r, at.c);
    if (cursor) cursor.tabIndex = 0;
    // a cursor on a row that is not drawn leaves the frame the Tab stop; it
    // brings the row back when it has the focus
    if (windowed) {
      if (cursor) scroll.removeAttribute('tabindex');
      else scroll.tabIndex = 0;
    }
  }

  // ---------------------------------------------------------------- the rows drawn

  function pad(rows) {
    const el = h('tr', { class: 'grd-pad', 'aria-hidden': 'true' }, h('td', { colspan: String(model.columns.length) }));
    el.firstChild.style.height = rows * rowPx + 'px';
    return el;
  }

  function buildRow(r) {
    const row = model.rows[r];
    return h('tr', { class: 'grd-row', 'aria-rowindex': windowed ? String(r + 3) : null }, model.columns.map((column) => cellElement(row, column)));
  }

  // The rows that stay drawn wherever the window goes: the one being edited
  // and the one the cursor is on (the focus is in one of them, and a row
  // taken out of the page would drop it to the body).
  function kept(extra) {
    const rows = new Set();
    if (extra !== undefined && extra !== null) rows.add(extra);
    const at = place(view.at);
    if (at) rows.add(at.r);
    const editing = editor ? place({ row: editor.row.id, col: editor.column.id }) : null;
    if (editing) rows.add(editing.r);
    return rows;
  }

  // The pad rows stand for the rows not drawn, so the scroll bar is as long
  // as the whole table: one before the first row drawn, one in each gap
  // between two (a kept row can be far from the window), one after the last.
  function layoutPads() {
    for (const el of Array.from(body.children)) if (el.classList.contains('grd-pad')) el.remove();
    const drawn = Array.from(rowEls.keys()).sort((x, y) => x - y);
    let next = 0;
    for (const r of drawn) {
      if (r > next) body.insertBefore(pad(r - next), rowEls.get(r));
      next = r + 1;
    }
    if (next < model.rows.length) body.append(pad(model.rows.length - next));
  }

  // The lines of the findings of the rows now drawn are in the page, so a
  // slot's `aria-describedby` never names an id that is not there.
  function syncWhy() {
    for (const line of lineEls.values()) if (line.parentNode !== why) why.append(line);
  }

  // Draw rows [a, b) and the kept ones, and no others: the ones that were
  // drawn and still are stay as they are.
  function setWindow(a, b, extra) {
    const keep = windowed ? kept(extra) : new Set();
    for (const [r, tr] of Array.from(rowEls)) {
      if ((r >= a && r < b) || keep.has(r)) continue;
      for (const column of model.columns) {
        const key = cellKey(model.rows[r].id, column.id);
        cells.delete(key);
        sigs.delete(key);
      }
      tr.remove();
      rowEls.delete(r);
    }
    const add = (r) => {
      if (rowEls.has(r) || r < 0 || r >= model.rows.length) return;
      let after = null;
      for (const [k, el] of rowEls) if (k > r && (after === null || k < after.k)) after = { k, el };
      const tr = buildRow(r);
      body.insertBefore(tr, after ? after.el : null);
      rowEls.set(r, tr);
    };
    for (let r = a; r < b; r += 1) add(r);
    for (const r of keep) add(r);
    from = a;
    to = b;
    if (windowed) layoutPads();
    syncWhy();
  }

  // The rows the scroll position asks for: what is in view and a margin.
  function wanted() {
    const first = Math.max(0, Math.floor((scroll.scrollTop - headPx) / rowPx));
    const count = Math.ceil((scroll.clientHeight || rowPx * 30) / rowPx) + 1;
    return { first, last: first + count, a: Math.max(0, first - MARGIN), b: Math.min(model.rows.length, first + count + MARGIN) };
  }

  // The window follows the scroll when what is in view comes near its edge.
  function follow() {
    if (!windowed || !model) return;
    const ask = wanted();
    if ((ask.first < from + 3 && from > 0) || (ask.last > to - 3 && to < model.rows.length)) {
      setWindow(ask.a, ask.b);
      paint();
    }
  }

  // The heights the page gave: read when nothing is waiting to be laid out.
  function measure() {
    // (a row with the field open is taller than a row is: not the one measured)
    const editing = editor ? place({ row: editor.row.id, col: editor.column.id }) : null;
    let one = null;
    for (const [r, el] of rowEls) if ((!editing || r !== editing.r) && (one === null || r < one.r)) one = { r, el };
    one = one ? one.el : null;
    const head = table.tHead;
    let moved = false;
    if (one && one.offsetHeight > 0 && one.offsetHeight !== rowPx) {
      rowPx = one.offsetHeight;
      moved = true;
    }
    if (head && head.offsetHeight > 0) headPx = head.offsetHeight;
    if (moved) setWindow(from, to);
  }

  // Row r drawn, and in view.
  function reveal(r) {
    if (!windowed || !model) return;
    const top = r * rowPx;
    const at = scroll.scrollTop;
    if (top < at) scroll.scrollTop = top;
    else if (top + rowPx + headPx > at + scroll.clientHeight) scroll.scrollTop = top + rowPx + headPx - scroll.clientHeight;
    const ask = wanted();
    setWindow(ask.a, ask.b, r);
  }

  // On a narrow screen the field columns after Group are hidden until the
  // Fields button shows them (grid.css does the hiding, by the same rule).
  // The rule is asked, not the page: a sheet that is not in the page yet, or
  // is out of sight, has no boxes to go by.
  function hiddenColumns() {
    // (the Teachers and Rooms rows hide no column, and ask the page nothing)
    if (across) return model.columns.map(() => false);
    const hide = view.fields !== true && window.matchMedia(NARROW).matches;
    return model.columns.map((column) => hide && column.kind === 'field' && column.field !== 'name');
  }

  // The columns of a block that are on screen, as indexes, left to right.
  function shownIn(box) {
    const hidden = hiddenColumns();
    const columns = [];
    for (let c = box.c0; c <= box.c1; c += 1) if (!hidden[c]) columns.push(c);
    return columns;
  }

  // The column the cursor lands in when it is sent to `c`: `c` itself, or
  // when that one is hidden the next one shown, going the way the cursor was
  // going.
  function landing(c, from) {
    const hidden = hiddenColumns();
    if (!hidden[c]) return c;
    const step = from !== null && c < from ? -1 : 1;
    for (let next = c + step; next >= 0 && next < hidden.length; next += step) if (!hidden[next]) return next;
    for (let next = c - step; next >= 0 && next < hidden.length; next -= step) if (!hidden[next]) return next;
    return c;
  }

  // Put the cursor on a cell. `extend` keeps the other corner where it is.
  function goTo(r, c, extend, focus) {
    if (!model || model.rows.length === 0) return;
    const row = Math.min(Math.max(r, 0), model.rows.length - 1);
    const was = place(view.at);
    const column = landing(Math.min(Math.max(c, 0), model.columns.length - 1), was ? was.c : null);
    reveal(row);
    view.at = refAt(row, column);
    if (!extend) view.anchor = view.at;
    paint();
    if (focus !== false) {
      const cell = cellAt(row, column);
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    // the row the cursor has left is not kept any more: the rows drawn are the
    // window and the cursor's (the focus is on the new one by now)
    if (windowed) setWindow(from, to);
  }

  // ---------------------------------------------------------------- drawing

  function cellContent(row, column) {
    const state = cellState(model, row, column);
    if (column.kind === 'actions') {
      return [h('button', {
        type: 'button',
        class: 'btn sch-btn--small',
        tabindex: '-1',
        data: { action: row.removed ? 'keep' : 'remove' },
        on: { click: () => (row.removed ? options.keep(row) : options.remove(row)) },
      }, row.removed ? 'Put back' : 'Remove', h('span', { class: 'vh' }, ' ' + row.group.name))];
    }
    const parts = [];
    // A colour is shown by its swatch, which is also the control that picks
    // one. The hex is the cell's title and what the cell is edited as, and is
    // here in words for a screen reader. A row marked to be removed has no
    // control, so it gets a dot.
    if (column.field === 'colour' && row.removed) parts.push(h('span', { class: 'sch-dot', style: 'background:' + state.text }));
    parts.push(h('span', { class: 'grd-cell__text' + (column.field === 'colour' ? ' vh' : '') }, state.text));
    if (column.field === 'name' && row.removed) parts.push(h('span', { class: 'grd-tag' }, 'will be removed'));
    if (column.field === 'name' && row.added) parts.push(h('span', { class: 'grd-tag' }, 'new'));
    // a marked period with no room says its word, in the muted ink; one with a
    // room has the word for a screen reader only
    const word = state.mark ? (state.mark.label !== '' ? state.mark.label : MARK_WORDS[state.mark.kind]) : '';
    if (column.kind === 'slot' && state.text === '') parts.push(word === '' ? h('span', { class: 'vh' }, 'No room') : h('span', { class: 'grd-cell__markword', data: { mark: state.mark.kind } }, word));
    else if (word !== '') parts.push(h('span', { class: 'vh' }, ' (' + word + ')'));
    if (state.unknown) parts.push(h('span', { class: 'vh' }, ' (not in the building)'));
    if (state.findings.length > 0) {
      const worst = worstFirst(state.findings)[0].severity;
      parts.push(h('span', { class: 'grd-cell__mark sch-mark--' + worst, 'aria-hidden': 'true' }, SEVERITY_WORDS[worst].glyph));
      parts.push(h('span', { class: 'vh' }, ' ' + findingWords(state.findings)));
    }
    if (column.field === 'colour' && !row.removed) {
      const pick = h('input', { type: 'color', class: 'grd-colour', tabindex: '-1', 'aria-label': 'Pick a colour for ' + row.group.name, value: state.text });
      pick.addEventListener('change', () => options.stage([{ op: 'field', groupId: row.id, field: 'colour', value: pick.value.toLowerCase() }]));
      parts.push(pick);
    }
    return parts;
  }

  // One finding's sentence, drawn once under the table however many slots
  // carry it: a marked slot's description names it (`aria-describedby`). A
  // finding keeps its line (and the line its id) from one drawing to the next,
  // so a slot that did not change need not be touched for it.
  let lineEls = new Map();
  let usedLines = new Set();
  const lineFor = (finding) => {
    let line = lineEls.get(finding.id);
    if (!line) {
      line = h('p', { id: uid('grid-why') });
      lineEls.set(finding.id, line);
    }
    const words = findingWords([finding]);
    if (line.textContent !== words) line.textContent = words;
    usedLines.add(finding.id);
    return line.id;
  };

  // What a screen reader calls a row: a room by its number is "Room 204"
  const rowWords = (row) => (row.kind === 'room' && /^\d/.test(row.name) ? 'Room ' + row.name : row.name);

  const setAttr = (node, name, value) => {
    if (value === null || value === undefined) node.removeAttribute(name);
    else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };

  // What a slot of the Teachers or Rooms rows holds, written into its element.
  // The sentence of a finding is its `data-why`, drawn beside the slot while
  // the cursor is on it (why.js, grid.css), and is what a screen reader is
  // told through the line under the table. A slot of a day type that follows
  // another is greyed. A slot whose words, mark and look are what they were is
  // left alone: an edit changes a few slots of a table of three thousand, and
  // the table is drawn again from them, not from nothing (ARCHITECTURE 23.12's
  // budget of 150 ms an edit).
  const sigs = new Map();
  function fillAcross(cell, row, column) {
    const state = cellState(model, row, column);
    const name = column.kind === 'name';
    const slot = column.kind === 'slot';
    const marked = state.findings.length > 0;
    const words = marked ? findingWords(state.findings) : '';
    const sig = [rowWords(row), state.text, state.staged, state.follower, state.duty, marked ? state.findings.map((finding) => finding.id).join(',') + words : ''].join('\u0001');
    if (sigs.get(cell.dataset.key) === sig) {
      // (the lines it names still count as in use)
      if (marked) state.findings.forEach(lineFor);
      return;
    }
    sigs.set(cell.dataset.key, sig);
    cell.className = 'grd-cell grd-cell--read grd-cell--across' + (name ? ' grd-cell--name' : '') + (!name && state.text === '' ? ' is-free' : '') + (state.duty ? ' is-duty' : '')
      + (state.staged ? ' is-staged' : '') + (state.follower ? ' is-follower' : '') + (marked ? ' is-marked' : '');
    setAttr(cell, 'aria-label', slot ? rowWords(row) + ', ' + column.label + ': ' + (state.text === '' ? row.free : state.text) : null);
    setAttr(cell, 'aria-describedby', marked ? state.findings.map(lineFor).join(' ') : null);
    setAttr(cell, 'aria-disabled', state.follower ? 'true' : null);
    setAttr(cell, 'title', marked ? words : state.follower ? model.after.dayTypes.find((dayType) => dayType.id === column.dayTypeId).name + ' is the same as ' + column.follows.name + '. Make its own copy to change it.' : null);
    setAttr(cell, 'data-severity', marked ? state.findings[0].severity : null);
    setAttr(cell, 'data-why', marked ? words : null);
    const parts = [];
    if (name) parts.push(h('span', { class: 'grd-cell__text' }, row.name));
    // (a free slot says so as plain text that grid.css draws at no size: an
    // element for each of the three thousand would double what the browser
    // lays out at every edit)
    else parts.push(state.text === '' ? (slot ? row.free : 'No duty') : state.text);
    if (marked) {
      const worst = state.findings[0].severity;
      parts.push(
        h('span', { class: 'grd-cell__mark sch-mark--' + worst, 'aria-hidden': 'true' }, SEVERITY_WORDS[worst].glyph),
        h('span', { class: 'vh' }, ' (' + SEVERITY_WORDS[worst].one + ')'));
    }
    cell.replaceChildren(...parts);
  }

  function acrossCell(row, column) {
    const name = column.kind === 'name';
    const cell = h(name ? 'th' : 'td', {
      role: name ? 'rowheader' : 'gridcell',
      scope: name ? 'row' : null,
      tabindex: '-1',
      'aria-selected': 'false',
      'aria-readonly': column.kind === 'slot' ? null : 'true',
      data: { key: cellKey(row.id, column.id), row: row.id, col: column.id },
    });
    cells.set(cell.dataset.key, cell);
    fillAcross(cell, row, column);
    return cell;
  }

  function acrossHead() {
    const periods = model.columns.filter((column) => column.kind !== 'name');
    return h('thead', null,
      h('tr', null,
        h('th', { scope: 'col', rowspan: '2', class: 'grd-head grd-head--name' }, model.first),
        model.days.map((day) => h('th', { scope: 'colgroup', colspan: String(day.count), class: 'grd-head grd-head--day' + (day.follows ? ' is-follower' : '') },
          h('bdi', null, day.dayType.name),
          day.follows ? [' is the same as ', h('bdi', null, day.follows.name), ' · ',
            h('button', { type: 'button', class: 'btn sch-btn--small', data: { action: 'make-own', dayType: day.dayType.id }, on: { click: () => options.makeOwn(day.dayType) } }, 'Make its own copy', h('span', { class: 'vh' }, ': ' + day.dayType.name))] : null))),
      h('tr', null, periods.map((column) => h('th', {
        scope: 'col',
        class: 'grd-head grd-head--period' + (column.kind === 'extra' ? ' grd-head--extra' : '') + (column.kind === 'slot' && column.period === 0 ? ' grd-head--first' : '') + (column.follows ? ' is-follower' : ''),
        title: column.label,
      }, column.short))));
  }

  function cellElement(row, column) {
    if (across) return acrossCell(row, column);
    const state = cellState(model, row, column);
    const header = column.field === 'name';
    const cell = h(header ? 'th' : 'td', {
      class: 'grd-cell grd-cell--' + (column.kind === 'field' ? column.field : column.kind)
        + (state.staged ? ' is-staged' : '') + (state.unknown ? ' is-unknown' : '') + (state.mark && state.mark.kind === 'noclass' ? ' is-noclass' : ''),
      role: header ? 'rowheader' : 'gridcell',
      scope: header ? 'row' : null,
      tabindex: '-1',
      'aria-selected': 'false',
      'aria-readonly': row.removed && column.kind !== 'actions' ? 'true' : null,
      title: column.field === 'colour' ? state.text : state.unknown ? state.text + ' is not in the building' : state.findings.length > 0 ? findingWords(state.findings) : null,
      data: { key: cellKey(row.id, column.id), row: row.id, col: column.id },
    }, cellContent(row, column));
    if (state.findings.length > 0) cell.dataset.severity = worstFirst(state.findings)[0].severity;
    cells.set(cell.dataset.key, cell);
    return cell;
  }

  function head() {
    if (across) return acrossHead();
    const span = model.days.length > 0 ? '2' : null;
    return h('thead', null,
      h('tr', null,
        model.columns.filter((column) => column.kind === 'field').map((column) => h('th', { scope: 'col', rowspan: span, class: 'grd-head grd-head--' + column.field }, column.label)),
        model.days.map((day) => h('th', { scope: 'colgroup', colspan: String(day.count), class: 'grd-head grd-head--day' }, day.dayType.name)),
        h('th', { scope: 'col', rowspan: span, class: 'grd-head' }, h('span', { class: 'vh' }, 'Remove'))),
      model.days.length > 0
        ? h('tr', null, model.columns.filter((column) => column.kind === 'slot').map((column) => h('th', { scope: 'col', class: 'grd-head grd-head--period' + (column.period === 0 ? ' grd-head--first' : ''), title: column.label }, column.short)))
        : null);
  }

  function draw(next) {
    // was the focus in the sheet (on a cell, or in the field of one)?
    const lost = document.activeElement === document.body || document.activeElement === null;
    const held = element.contains(document.activeElement) || (lost && (hiddenUnderFocus || focusInside));
    hiddenUnderFocus = false;
    // A cell being edited whose column has gone out of sight (a phone turned
    // on its side, a window narrowed across 640 px): the field is not opened
    // again in a cell with no box, where it would hold the table's keys and
    // show nothing. What it held is read into the cell as leaving it does,
    // so what was typed is staged; text that cannot be read is let go.
    let reopen = editor && !editor.committed ? { row: editor.row.id, col: editor.column.id } : null;
    if (editor && model) {
      const at = place(reopen);
      if (at && hiddenColumns()[at.c]) {
        if (!commit(0, 0, true)) cancel(false);
        reopen = null;
      }
    }
    if (across && !watched) {
      watched = true;
      watchWhy(scroll, table);
    }
    drawing = true;
    closeEditor();
    model = next;
    if (across) {
      // the same rows and columns as the drawing before: only the slots that
      // changed are written, and what has the focus keeps it
      const shaped = model.rows.map((row) => row.id).join(',') + '|' + model.columns.map((column) => column.id + '/' + column.label + (column.follows ? '/' + column.follows.id : '')).join(',') + '|' + model.days.map((day) => day.dayType.name).join(',') + '|' + model.first;
      usedLines = new Set();
      if (shaped === shape && table.firstChild) {
        for (const [r] of rowEls) for (const column of model.columns) fillAcross(cells.get(cellKey(model.rows[r].id, column.id)), model.rows[r], column);
      } else {
        shape = shaped;
        cells = new Map();
        sigs.clear();
        painted = [];
        rowEls = new Map();
        windowed = model.rows.length > ROW_WINDOW;
        body = h('tbody', null);
        table.classList.toggle('grd-table--windowed', windowed);
        // Fixed columns: the browser does not measure every slot of a table of
        // three thousand to find a width (grid.css)
        table.replaceChildren(
          h('colgroup', null, model.columns.map((column) => h('col', { class: 'grd-col grd-col--' + (column.kind === 'name' ? 'name' : 'period') }))),
          head(),
          body);
        table.style.setProperty('--grd-periods', String(model.columns.length - 1));
        const ask = wanted();
        setWindow(windowed ? ask.a : 0, windowed ? ask.b : model.rows.length);
        // the heights are the page's to say once it has drawn them
        if (windowed) requestAnimationFrame(() => {
          measure();
          follow();
        });
      }
      for (const [id, line] of Array.from(lineEls)) if (!usedLines.has(id)) lineEls.delete(id);
      why.replaceChildren(...Array.from(lineEls.values()));
      table.setAttribute('aria-rowcount', String(model.rows.length + 2));
    } else {
      cells = new Map();
      painted = [];
      table.replaceChildren(head(), ...model.sections.map((section) => h('tbody', null,
        h('tr', { class: 'grd-grade' }, h('th', { scope: 'rowgroup', colspan: String(model.columns.length) },
          section.label, h('span', { class: 'grd-grade__count' }, ' · ' + section.rows.length + (section.rows.length === 1 ? ' group' : ' groups')))),
        section.rows.map((row) => h('tr', { class: 'grd-row' + (row.removed ? ' is-removed' : ''), data: { group: row.id } },
          model.columns.map((column) => cellElement(row, column)))))));
      table.setAttribute('aria-rowcount', String(model.rows.length + model.sections.length + 2));
    }
    if (model.rows.length > 0) {
      // (the cursor starts on a slot of the Teachers and Rooms rows: the name is not edited)
      if (!place(view.at)) view.at = view.anchor = refAt(0, across ? Math.min(1, model.columns.length - 1) : 0);
      if (!place(view.anchor)) view.anchor = view.at;
      // a cursor left in a column that is now hidden would take the grid's
      // one Tab stop out of reach: it goes to the group's name. The other
      // corner of a block goes there too.
      const hidden = hiddenColumns();
      if (hidden[place(view.at).c]) {
        view.at = view.anchor = { row: view.at.row, col: model.columns[0].id };
        // the focus goes with the cursor, when the sheet had it
        if (held && options.focusCursor) options.focusCursor(cellKey(view.at.row, view.at.col));
      } else if (hidden[place(view.anchor).c]) {
        view.anchor = { row: view.anchor.row, col: model.columns[0].id };
      }
      paint();
    }
    const again = place(reopen);
    if (again) openEditor(again.r, again.c, { focus: false });
    drawing = false;
  }

  // ---------------------------------------------------------------- editing

  // Every room until something is typed; then the rooms that match it.
  function roomOptions(typed) {
    const wanted = editor.typed ? typed.trim().toLowerCase() : '';
    const all = Array.from(model.rooms.values(), (room) => ({ room, label: options.roomLabel(model.after, room) }));
    return (wanted === '' ? all : all.filter((option) => option.label.toLowerCase().includes(wanted))).slice(0, LIST_LIMIT);
  }

  function drawList() {
    const typed = editor.input.value;
    let known;
    if (editor.across) {
      const found = acrossOptions(model, editor.row, editor.column, editor.typed ? typed : '', LIST_LIMIT);
      editor.shown = found.options;
      editor.from = found.from;
      known = typed.trim() === '' || !namesUnknown(model, typed);
    } else {
      editor.shown = roomOptions(typed);
      known = typed.trim() === '' || model.rooms.has(typed.trim().toLowerCase());
    }
    editor.active = Math.min(editor.active, editor.shown.length - 1);
    editor.input.classList.toggle('is-unknown', !known);
    if (editor.shown.length === 0) {
      list.replaceChildren(h('li', { class: 'picker__empty', role: 'presentation' }, editor.across ? 'No group matches. Add a group in the Groups rows first.' : 'No room matches. It is kept as typed, and marked as not in the building.'));
    } else if (editor.across) {
      list.replaceChildren(...editor.shown.map((option, index) => h('li', {
        class: 'picker__option',
        role: 'option',
        id: listId + '-' + index,
        'aria-selected': String(index === editor.active),
        data: { group: option.group.id },
        on: {
          pointerdown: (event) => event.preventDefault(),
          mousedown: (event) => event.preventDefault(),
          click: (event) => {
            if (event.button !== 0 || !editor || editor.shown[index] !== option) return;
            editor.active = index;
            commit(0, 0);
          },
        },
      }, option.label)));
    } else {
      list.replaceChildren(...editor.shown.map((option, index) => h('li', {
        class: 'picker__option',
        role: 'option',
        id: listId + '-' + index,
        'aria-selected': String(index === editor.active),
        data: { room: option.room.id },
        on: {
          // The press must not take the focus from the field, or the field
          // would be read before the click came; the pick is on the click,
          // which a finger that swipes the list or the page never makes (as
          // ui/components/picker.js does). The option clicked is the one
          // read, whatever the arrow keys had highlighted.
          pointerdown: (event) => event.preventDefault(),
          mousedown: (event) => event.preventDefault(),
          click: (event) => {
            if (event.button !== 0 || !editor || editor.shown[index] !== option) return;
            editor.active = index;
            editor.input.value = option.room.number;
            commit(0, 0);
          },
        },
      }, option.label)));
    }
    if (editor.active >= 0) {
      editor.input.setAttribute('aria-activedescendant', listId + '-' + editor.active);
      list.children[editor.active].scrollIntoView({ block: 'nearest' });
    } else {
      editor.input.removeAttribute('aria-activedescendant');
    }
    placeList();
  }

  // Under the slot, and inside the sheet: the section is its own layer, so a
  // list that reached past its edge would go under whatever is beside it. A
  // refusal is the first thing under the slot, the list under that.
  function placeList() {
    const base = element.getBoundingClientRect();
    const box = editor.cell.getBoundingClientRect();
    list.hidden = false;
    refusal.style.left = Math.max(0, Math.min(box.left - base.left, base.width - refusal.offsetWidth)) + 'px';
    refusal.style.top = box.bottom - base.top + 'px';
    // the In field of a teacher with several rooms is the first thing under the slot
    const field = editor.cell.querySelector('.grd-in__field');
    const under = field ? field.offsetHeight : 0;
    refusal.style.top = box.bottom - base.top + under + 'px';
    const below = (refusal.hidden ? 0 : refusal.offsetHeight) + under;
    list.style.left = Math.max(0, Math.min(box.left - base.left, base.width - list.offsetWidth)) + 'px';
    list.style.top = box.bottom - base.top + below + 'px';
  }

  // The schedule's own words for why an edit was not taken, under the slot,
  // with the field kept so the text can be fixed.
  function refuse(text) {
    editor.input.setAttribute('aria-invalid', 'true');
    refusal.textContent = text;
    refusal.hidden = false;
    placeList();
    options.say(text);
  }

  function relent() {
    refusal.hidden = true;
    refusal.textContent = '';
    if (editor) editor.input.removeAttribute('aria-invalid');
  }

  // Why a slot that is not a slot of a group is not typed into.
  function notTyped(column) {
    if (column.kind === 'name') return model.kind === 'teacher' ? 'Teachers are named in the Teachers tab. Change a name there.' : 'Rooms are named in the building. Change a room’s number there.';
    return 'Duties before and after school are set on the Day tab, not in the grid.';
  }

  function followerWords(column) {
    const dayType = model.after.dayTypes.find((each) => each.id === column.dayTypeId);
    return dayType.name + ' is the same as ' + column.follows.name + '.';
  }

  function openAcrossEditor(r, c, opts) {
    reveal(r);
    const row = model.rows[r];
    const column = model.columns[c];
    const cell = cellAt(r, c);
    if (column.kind !== 'slot') {
      options.say(notTyped(column));
      return;
    }
    // a day type that follows another has no slots of its own to type into:
    // the edit could only be refused, so no field opens
    if (column.follows) {
      options.say(followerWords(column) + ' Make its own copy in the column header to change it.');
      return;
    }
    const input = h('input', {
      class: 'grd-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': rowWords(row) + ', ' + column.label + ', groups',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'true',
      'aria-controls': listId,
      data: { key: cell.dataset.key + ':edit' },
    });
    const was = cellText(model, row, column);
    input.value = opts.text === undefined ? was : opts.text;
    // a teacher with several rooms says which one a class added goes in
    let into = null;
    if (model.kind === 'teacher') {
      const mine = teacherRooms(model.after, row.id);
      if (mine.length > 1) {
        into = h('select', { class: 'grd-in', 'aria-label': 'In', data: { key: cell.dataset.key + ':in' } }, mine.map((room) => h('option', { value: room.id }, room.number)));
        into.value = defaultRoom(model, row, column) || mine[0].id;
      }
    }
    editor = { across: true, row, column, cell, input, into, was, kept: Array.from(cell.childNodes), shown: [], active: -1, typed: opts.text !== undefined, from: 0 };
    cell.dataset.editing = 'true';
    cell.replaceChildren(input, ...(into ? [h('label', { class: 'grd-in__field' }, h('span', { class: 'grd-in__label' }, 'In'), into)] : []));
    input.addEventListener('input', () => {
      relent();
      editor.typed = true;
      editor.active = -1;
      drawList();
    });
    const leave = (event) => {
      if (drawing || !editor || editor.input !== input) return;
      // from the text to the In field, or back, is not leaving
      if (event.relatedTarget && cell.contains(event.relatedTarget)) return;
      if (!commit(0, 0, true)) cancel(false);
    };
    input.addEventListener('keydown', editorKey);
    input.addEventListener('blur', leave);
    if (into) {
      into.addEventListener('keydown', editorKey);
      into.addEventListener('blur', leave);
    }
    if (opts.focus !== false) {
      input.focus();
      if (opts.text === undefined) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    }
    drawList();
  }

  // Read what is in the field of a Teachers or Rooms slot into an edit.
  // `options.edit` works it out against the schedule as the staged edits
  // leave it and stages it as one step; { ok: false, why } when it was
  // refused, and the field stays.
  function commitAcross(dr, dc, leaving) {
    const { row, column, input, into, was } = editor;
    const at = place({ row: row.id, col: column.id });
    const picked = editor.active >= 0 ? editor.shown[editor.active] : null;
    let text = input.value;
    if (picked) {
      const head = text.slice(0, editor.from).replace(/\s+$/, '');
      text = (head === '' ? '' : head + (/[,;]$/.test(head) ? ' ' : ', ')) + picked.group.name;
      input.value = text;
    }
    if (text === was) {
      drawing = true;
      closeEditor();
      drawing = false;
      if (!leaving) goTo(at.r + dr, at.c + dc, false);
      return true;
    }
    const done = options.edit([cellRequest(model, row, column, text, into ? into.value : undefined)], 'edit');
    if (!done.ok) {
      refuse(done.why);
      return false;
    }
    if (done.staged) {
      // The field stays until the drawing the edit has brought (a moment from
      // now), which takes it away and puts the focus on the cursor's slot in
      // the one pass: taking it away here and moving the focus here would lay
      // a table of three thousand slots out twice more before that drawing
      // lays it out again (ARCHITECTURE 23.12: 150 ms an edit).
      editor.committed = true;
      if (!leaving) {
        const r = Math.min(Math.max(at.r + dr, 0), model.rows.length - 1);
        const c = landing(Math.min(Math.max(at.c + dc, 0), model.columns.length - 1), at.c);
        reveal(r);
        view.at = view.anchor = refAt(r, c);
        if (options.focusCursor) options.focusCursor(cellKey(view.at.row, view.at.col));
      }
      return true;
    }
    drawing = true;
    closeEditor();
    drawing = false;
    if (!leaving) goTo(at.r + dr, at.c + dc, false);
    return true;
  }

  function openEditor(r, c, how) {
    if (across) {
      openAcrossEditor(r, c, how || {});
      return;
    }
    const row = model.rows[r];
    const column = model.columns[c];
    const cell = cellAt(r, c);
    if (column.kind === 'actions') {
      cell.querySelector('button').click();
      return;
    }
    if (row.removed) {
      options.say(row.group.name + ' is marked to be removed. Put it back to change it.');
      return;
    }
    const opts = how || {};
    const slot = column.kind === 'slot';
    const input = h('input', {
      class: 'grd-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': row.group.name + ', ' + column.label + (slot ? ', room' : ''),
      role: slot ? 'combobox' : null,
      'aria-autocomplete': slot ? 'list' : null,
      'aria-expanded': slot ? 'true' : null,
      'aria-controls': slot ? listId : null,
      data: { key: cell.dataset.key + ':edit' },
    });
    const was = cellText(model, row, column);
    input.value = opts.text === undefined ? was : opts.text;
    editor = { row, column, cell, input, was, kept: Array.from(cell.childNodes), shown: [], active: -1, typed: opts.text !== undefined };
    cell.dataset.editing = 'true';
    cell.replaceChildren(input);
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      editor.typed = true;
      if (slot) {
        editor.active = -1;
        drawList();
      }
    });
    input.addEventListener('keydown', editorKey);
    input.addEventListener('blur', () => {
      if (drawing || !editor || editor.input !== input) return;
      if (!commit(0, 0, true)) cancel(false);
    });
    if (opts.focus !== false) {
      input.focus();
      if (opts.text === undefined) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    }
    if (slot) drawList();
  }

  // Take the field away and put back what the cell showed, or `text` when the
  // field was read into the cell. The tab is drawn again a moment later; until
  // then this is what the cell shows.
  function closeEditor(text) {
    if (!editor) return;
    const { cell, kept, column } = editor;
    editor = null;
    list.hidden = true;
    refusal.hidden = true;
    refusal.textContent = '';
    delete cell.dataset.editing;
    if (text === undefined) {
      cell.replaceChildren(...kept);
    } else if (column.field === 'colour') {
      // a colour is its swatch: that is kept, and shows the new colour
      cell.replaceChildren(...kept);
      cell.title = text;
      cell.querySelector('.grd-cell__text').textContent = text;
      cell.querySelector('.grd-colour').value = text;
    } else {
      cell.replaceChildren(h('span', { class: 'grd-cell__text' }, text));
    }
  }

  function cancel(focus) {
    const cell = editor.cell;
    drawing = true;
    closeEditor();
    drawing = false;
    if (focus !== false) cell.focus();
  }

  // Read what is in the field into the cell. dr, dc: where the cursor goes
  // after. False when the text was refused; the field then stays to be fixed.
  function commit(dr, dc, leaving) {
    // an edit already staged waits for the drawing it brought: a second Enter,
    // or the blur that drawing causes, must not stage it again
    if (editor.committed) return true;
    if (editor.across) return commitAcross(dr, dc, leaving);
    const { row, column, input, was } = editor;
    const at = place({ row: row.id, col: column.id });
    const picked = editor.active >= 0 ? editor.shown[editor.active] : null;
    const text = picked ? picked.room.number : input.value;
    if (text === was) {
      drawing = true;
      closeEditor();
      drawing = false;
      if (!leaving) goTo(at.r + dr, at.c + dc, false);
      return true;
    }
    const read = readCell(model, row, column, text, namesOf(model));
    if (!read.ok) {
      input.setAttribute('aria-invalid', 'true');
      options.say(read.why);
      return false;
    }
    drawing = true;
    // a colour as it was read (lower case, no spaces round it); the rest as typed
    closeEditor(column.field === 'colour' ? read.op.value : text);
    drawing = false;
    if (!leaving) goTo(at.r + dr, at.c + dc, false);
    options.stage([read.op]);
    return true;
  }

  function editorKey(event) {
    // (an Enter that comes after the drawing took the field away has nothing to read)
    if (!editor || (editor.input !== event.currentTarget && editor.into !== event.currentTarget)) return;
    const slot = editor.column.kind === 'slot';
    // the In field of a teacher's slot is a select: its arrow keys are its own
    const inField = event.target.tagName === 'SELECT';
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.shiftKey ? -1 : 1, 0);
    } else if (event.key === 'Tab') {
      // from the text to In (Tab), and from In back to the text (Shift+Tab),
      // the focus goes where the browser sends it; from anywhere else it is
      // the next slot
      if (editor.into && ((!inField && !event.shiftKey) || (inField && event.shiftKey))) return;
      event.preventDefault();
      commit(0, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !inField) {
      event.preventDefault();
      if (!slot) {
        commit(event.key === 'ArrowDown' ? 1 : -1, 0);
      } else if (editor.shown.length > 0) {
        const n = editor.shown.length;
        editor.active = event.key === 'ArrowDown' ? (editor.active + 1) % n : (Math.max(editor.active, 0) - 1 + n) % n;
        drawList();
      }
    }
  }

  // ---------------------------------------------------------------- blocks

  // The four things done to a block (copy, paste, Delete, Fill down) are done
  // to what is on screen of it: a column that is hidden is in none of them.

  function copy() {
    const box = range();
    if (!box) return null;
    // The Teachers and Rooms rows copy a slot as the names of the groups in
    // it, and a duty column as the duty shown; a paste lays the block on the
    // columns the way it was copied, so the two agree on where each is.
    const columns = shownIn(box).filter((c) => !across || model.columns[c].kind !== 'name');
    if (columns.length === 0) return null;
    const rows = [];
    for (let r = box.r0; r <= box.r1; r += 1) rows.push(columns.map((c) => (across && model.columns[c].kind === 'extra' ? dutyText(model.rows[r], model.columns[c]) : cellText(model, model.rows[r], model.columns[c]))));
    const slots = across ? columns.filter((c) => model.columns[c].kind === 'slot').length * rows.length : rows.length * rows[0].length;
    options.say('Copied ' + cellCount(slots) + '.');
    return writeTsv(rows);
  }

  // what a duty column shows: the duty, or nothing where there is none
  function dutyText(row, column) {
    const text = cellState(model, row, column).text;
    return text === 'No duty' ? '' : text;
  }

  // said as slots: spec 2's cell is a floor's
  function cellCount(n) {
    return n + (n === 1 ? ' slot' : ' slots');
  }

  function notTaken(refused) {
    if (refused.length === 0) return '';
    return ' ' + cellCount(refused.length) + (refused.length === 1 ? ' was' : ' were') + ' not taken: ' + refused[0];
  }

  // Paste a block with its corner on the cursor's block. One copied cell
  // pasted over a selection fills the selection. The block is laid over the
  // columns on screen: a pasted row wider than those skips the hidden ones.
  // The Teachers and Rooms rows: each pasted piece of text names groups, laid
  // on the slots from the corner of the block, in reading order, every one
  // worked out against the schedule the ones before it left, and all of it
  // one staged step. A copied slot pasted over a selection fills the slots in it.
  function pasteAcross(block, box) {
    const corner = Math.max(box.c0, model.columns.findIndex((column) => column.kind === 'slot'));
    const columns = [];
    for (let c = corner; c <= box.c1; c += 1) if (model.columns[c].kind === 'slot') columns.push(c);
    if (block.length === 1 && block[0].length === 1 && columns.length > 0 && (box.r1 > box.r0 || columns.length > 1)) {
      // one copied slot fills the slots of the selection; a duty column between
      // them keeps its place in the block and is left alone (null)
      const one = block[0][0];
      block = [];
      for (let r = box.r0; r <= box.r1; r += 1) {
        const texts = [];
        for (let c = corner; c <= box.c1; c += 1) texts.push(model.columns[c].kind === 'slot' ? one : null);
        block.push(texts);
      }
    }
    const laid = cellsOf(model, box.r0, corner, block);
    if (laid.cells.length === 0) {
      options.say(laid.followers.length > 0
        ? 'Nothing was pasted: ' + followersLeft(model.after, laid.followers) + '.'
        : 'Nothing was pasted: a block goes into the periods, and the name and the duties are not changed here.');
      return;
    }
    const done = options.edit(laid.cells, 'paste', { skipped: laid.skipped, runOff: laid.runOff, followers: laid.followers });
    if (!done.ok) return;
    const r1 = Math.min(box.r0 + block.length - 1, model.rows.length - 1);
    const c1 = Math.min(corner + Math.max(...block.map((texts) => texts.length)) - 1, model.columns.length - 1);
    goTo(r1, c1, false, false);
    goTo(box.r0, corner, true);
  }

  function paste(text) {
    let block = parseTsv(text);
    if (block.length === 0 || !model) return;
    const box = range() || { r0: 0, r1: 0, c0: 0, c1: 0 };
    if (across) {
      pasteAcross(block, box);
      return;
    }
    if (block.length === 1 && block[0].length === 1 && (box.r1 > box.r0 || box.c1 > box.c0)) {
      const one = block[0][0];
      const width = shownIn(box).length;
      block = [];
      for (let r = box.r0; r <= box.r1; r += 1) block.push(new Array(width).fill(one));
    }
    // the sheet as it is on screen, and the corner's place in that
    const shown = shownIn({ c0: 0, c1: model.columns.length - 1 });
    const corner = Math.max(0, shown.indexOf(box.c0));
    const plan = planPaste({ ...model, columns: shown.map((c) => model.columns[c]) }, box.r0, corner, block, options.ids);
    if (plan.ops.length === 0 && plan.refused.length === 0) return;
    if (model.rows.length > 0) {
      // the block that was pasted is selected, with the cursor on its corner
      const r1 = Math.min(box.r0 + block.length - 1, model.rows.length - 1);
      const c1 = shown[Math.max(corner, Math.min(corner + Math.max(...block.map((cells) => cells.length)) - 1, shown.length - 2))];
      goTo(r1, c1, false, false);
      goTo(box.r0, shown[corner], true);
    }
    options.stage(plan.ops, 'Pasted ' + cellCount(plan.cells) + '.'
      + (plan.added > 0 ? ' Added ' + plan.added + (plan.added === 1 ? ' group.' : ' groups.') : '')
      + notTaken(plan.refused)
      + (plan.clipped > 0 ? ' ' + plan.clipped + (plan.clipped === 1 ? ' column' : ' columns') + ' ran past the last column and ' + (plan.clipped === 1 ? 'was' : 'were') + ' left out.' : ''));
  }

  function clearAcross(box) {
    const cellsToEmpty = [];
    const followers = [];
    for (let r = box.r0; r <= box.r1; r += 1) {
      for (let c = box.c0; c <= box.c1; c += 1) {
        const column = model.columns[c];
        if (column.kind !== 'slot' || cellText(model, model.rows[r], column) === '') continue;
        // a day type that follows another has no slots of its own to empty
        if (column.follows) {
          followers.push(column);
          continue;
        }
        cellsToEmpty.push(cellRequest(model, model.rows[r], column, ''));
      }
    }
    if (cellsToEmpty.length === 0) {
      options.say(followers.length > 0 ? 'Nothing was emptied: ' + followersLeft(model.after, followers) + '.' : 'Nothing to empty: no group is in the slots selected.');
      return;
    }
    options.edit(cellsToEmpty, 'delete', { followers });
  }

  function clear() {
    const box = range();
    if (!box) return;
    if (across) {
      clearAcross(box);
      return;
    }
    const hidden = hiddenColumns();
    const ops = [];
    for (let r = box.r0; r <= box.r1; r += 1) {
      for (let c = box.c0; c <= box.c1; c += 1) {
        const column = model.columns[c];
        // a name cannot be empty and a colour is always one: neither is
        // cleared. Nor is a column that is hidden: what cannot be seen is not
        // emptied by a block drawn across it.
        if (column.kind === 'actions' || column.field === 'name' || column.field === 'colour' || hidden[c]) continue;
        const read = readCell(model, model.rows[r], column, '');
        if (read.ok && cellText(model, model.rows[r], column) !== '') ops.push(read.op);
      }
    }
    if (ops.length > 0) options.stage(ops, 'Cleared ' + cellCount(ops.length) + '.');
  }

  // Copy the top row of the selection into the rows under it. With one row
  // selected, the row above is the one copied.
  function fillDown() {
    const box = range();
    if (!box) return;
    if (across) {
      // it would put one group in every row below
      options.say('Fill down is for Groups rows. Here, type or paste the group where it belongs.');
      return;
    }
    const from = box.r0 === box.r1 ? box.r0 - 1 : box.r0;
    const first = box.r0 === box.r1 ? box.r0 : box.r0 + 1;
    if (from < 0) {
      options.say('There is no row above to fill down from.');
      return;
    }
    const source = model.rows[from];
    const names = namesOf(model);
    const hidden = hiddenColumns();
    const ops = [];
    const refused = [];
    for (let c = box.c0; c <= box.c1; c += 1) {
      const column = model.columns[c];
      // a hidden column is not filled either (see clear)
      if (column.kind === 'actions' || hidden[c]) continue;
      for (let r = first; r <= box.r1; r += 1) {
        const row = model.rows[r];
        const read = readCell(model, row, column, cellText(model, source, column), names);
        if (!read.ok) {
          refused.push(read.why);
          continue;
        }
        if (column.kind === 'slot') {
          // the room itself, not its number read back: a room with no number fills down too
          const slot = source.group.days[column.dayTypeId][column.period];
          read.op.fields = { room: slot.room, roomText: slot.roomText };
        }
        ops.push(read.op);
      }
    }
    if (ops.length === 0 && refused.length === 0) return;
    options.stage(ops, 'Filled down ' + cellCount(ops.length) + ' from ' + source.group.name + '.' + notTaken(refused));
  }

  // ---------------------------------------------------------------- keys and pointer

  function cellOf(node) {
    const cell = node && node.closest ? node.closest('[data-row][data-col]') : null;
    return cell && table.contains(cell) ? cell : null;
  }

  table.addEventListener('keydown', (event) => {
    if (editor || !model || model.rows.length === 0) return;
    const cell = cellOf(event.target);
    if (!cell || event.target !== cell) return;
    const at = place({ row: cell.dataset.row, col: cell.dataset.col });
    if (!at) return;
    const mod = event.ctrlKey || event.metaKey;
    const lastRow = model.rows.length - 1;
    const lastColumn = model.columns.length - 1;
    // where the page reads right to left the columns run that way too, and
    // an arrow goes the way it points
    const along = getComputedStyle(table).direction === 'rtl' ? -1 : 1;
    const moves = {
      ArrowUp: [at.r - 1, at.c],
      ArrowDown: [at.r + 1, at.c],
      ArrowLeft: [at.r, at.c - along],
      ArrowRight: [at.r, at.c + along],
      Home: [mod ? 0 : at.r, 0],
      End: [mod ? lastRow : at.r, lastColumn],
      PageUp: [at.r - 10, at.c],
      PageDown: [at.r + 10, at.c],
    };
    if (moves[event.key]) {
      event.preventDefault();
      goTo(moves[event.key][0], moves[event.key][1], event.shiftKey);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      openEditor(at.r, at.c);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      clear();
    } else if (event.key === 'Escape') {
      const box = range();
      if (box.r0 !== box.r1 || box.c0 !== box.c1) {
        event.preventDefault();
        goTo(at.r, at.c, false);
      }
    } else if (mod && !event.altKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      fillDown();
    } else if (mod && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      view.anchor = refAt(0, 0);
      view.at = refAt(lastRow, across ? lastColumn : lastColumn - 1);
      paint();
    } else if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      // the last thing staged here comes back first; with nothing staged
      // to take back, the shell undoes the last change to the project
      if (options.undo()) event.preventDefault();
    } else if (event.key === ' ' && model.columns[at.c].kind === 'actions') {
      event.preventDefault();
      openEditor(at.r, at.c);
    } else if (event.key.length === 1 && !mod && !event.altKey && model.columns[at.c].kind !== 'actions') {
      // typing replaces what the cell holds
      event.preventDefault();
      openEditor(at.r, at.c, { text: event.key });
    }
  });

  table.addEventListener('focusin', (event) => {
    const cell = cellOf(event.target);
    if (!cell || event.target !== cell || !model) return;
    if (view.at && view.at.row === cell.dataset.row && view.at.col === cell.dataset.col) return;
    const at = place({ row: cell.dataset.row, col: cell.dataset.col });
    if (at) goTo(at.r, at.c, false, false);
  });

  table.addEventListener('pointerdown', (event) => {
    const cell = cellOf(event.target);
    if (!cell || !model || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (editor && editor.cell === cell) return;
    const at = place({ row: cell.dataset.row, col: cell.dataset.col });
    if (!at) return;
    lastPointer = { type: event.pointerType, onCursor: Boolean(view.at) && view.at.row === cell.dataset.row && view.at.col === cell.dataset.col && document.activeElement === cell };
    // the button or the colour box in a cell does its own thing; the cursor comes along
    const inner = event.target.closest('button, input');
    goTo(at.r, at.c, event.shiftKey, !inner);
    if (!inner && event.pointerType !== 'touch') drag = { id: event.pointerId };
  });

  table.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId || event.buttons === 0) return;
    const hit = cellOf(document.elementFromPoint(event.clientX, event.clientY));
    if (!hit || (view.at.row === hit.dataset.row && view.at.col === hit.dataset.col)) return;
    const at = place({ row: hit.dataset.row, col: hit.dataset.col });
    if (at) goTo(at.r, at.c, true);
  });

  const endDrag = () => {
    drag = null;
  };
  table.addEventListener('pointerup', endDrag);
  table.addEventListener('pointercancel', endDrag);

  // A double click edits; so does a second tap on the cell the cursor is on.
  table.addEventListener('click', (event) => {
    const cell = cellOf(event.target);
    if (!cell || editor || event.target.closest('button, input')) return;
    if (event.detail < 2 && !(lastPointer.type === 'touch' && lastPointer.onCursor)) return;
    const at = place({ row: cell.dataset.row, col: cell.dataset.col });
    if (at && model.columns[at.c].kind !== 'actions') openEditor(at.r, at.c);
  });

  return {
    element,
    table,
    draw,
    copy,
    paste,
    clear,
    fillDown,
    // is the cursor of the page on a cell (and not in a field being typed in)?
    // put away, with nothing left in the page (the cursor is kept in `view`)
    release() {
      if (!model) return;
      closeEditor();
      model = null;
      cells = new Map();
      painted = [];
      shape = null;
      windowed = false;
      rowEls = new Map();
      sigs.clear();
      lineEls = new Map();
      table.replaceChildren();
      why.replaceChildren();
    },
    has(node) {
      // (the frame has the focus when the cursor's row is not drawn)
      if (across && node === scroll) return true;
      const cell = cellOf(node);
      return Boolean(cell) && node === cell;
    },
    keyOfCursor() {
      return view.at && place(view.at) ? cellKey(view.at.row, view.at.col) : null;
    },
    startEditing(rowId, columnId) {
      const at = place({ row: rowId, col: columnId });
      if (at) {
        goTo(at.r, at.c, false);
        openEditor(at.r, at.c);
      }
    },
  };
}
