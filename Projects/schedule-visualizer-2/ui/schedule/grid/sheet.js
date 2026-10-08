// The sheet itself: a table that is a grid. One cell is the Tab stop; the
// arrow keys move, Shift with them selects a block, typing replaces what a
// cell holds, Enter or F2 edits it, Escape leaves it as it was. Every cell
// carries a `data-key`, and the field a cell is edited in carries the cell's
// key with ":edit" after it, so when the tab is drawn again mid-word the
// section puts the text and the caret back (ui/schedule/index.js).
//
// sheet({ view, ids, stage(ops, said), undo(), remove(row), keep(row), say(text), roomLabel(room) })
//   view    { at, anchor }: the cell the cursor is on and the other corner of
//           the selection, each { row, col } by id, kept while the page is open
//   stage   take a list of ops (model.js) and draw again
// returns { element, draw(model), copy(), paste(text), clear(), fillDown(), keyOfCursor(), has(node) }

import { h, uid } from '../../components/dom.js';
import { SEVERITY_WORDS } from '../common.js';
import { cellState, cellText, readCell, planPaste, namesOf } from './model.js';
import { parseTsv, writeTsv } from './tsv.js';

const LIST_LIMIT = 60;

export function cellKey(rowId, columnId) {
  return 'grid:' + rowId + ':' + columnId;
}

export function sheet(options) {
  const { view } = options;
  const listId = uid('grid-rooms');
  const table = h('table', { class: 'grd-table', role: 'grid', 'aria-label': 'Every group, one row each', 'aria-multiselectable': 'true' });
  const scroll = h('div', { class: 'grd-scroll' }, table);
  const list = h('ul', { class: 'picker__list grd-list', role: 'listbox', id: listId, 'aria-label': 'Rooms', hidden: true });
  const element = h('div', { class: 'grd-sheet' }, scroll, list);

  let model = null;
  let cells = new Map();
  let editor = null;
  let drawing = false;
  let painted = [];
  let drag = null;
  let lastPointer = { type: 'mouse', onCursor: false };

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
    for (let r = box.r0; r <= box.r1; r += 1) {
      for (let c = box.c0; c <= box.c1; c += 1) {
        const cell = cellAt(r, c);
        cell.setAttribute('aria-selected', 'true');
        painted.push(cell);
      }
    }
    const at = place(view.at);
    cellAt(at.r, at.c).tabIndex = 0;
  }

  // Put the cursor on a cell. `extend` keeps the other corner where it is.
  function goTo(r, c, extend, focus) {
    if (!model || model.rows.length === 0) return;
    const row = Math.min(Math.max(r, 0), model.rows.length - 1);
    const column = Math.min(Math.max(c, 0), model.columns.length - 1);
    view.at = refAt(row, column);
    if (!extend) view.anchor = view.at;
    paint();
    if (focus !== false) {
      const cell = cellAt(row, column);
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // ---------------------------------------------------------------- drawing

  function findingWords(findings) {
    return findings.map((finding) => SEVERITY_WORDS[finding.severity].one.replace(/^./, (first) => first.toUpperCase()) + ': ' + finding.text).join(' ');
  }

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
    if (column.field === 'colour') parts.push(h('span', { class: 'sch-dot', style: 'background:' + state.text }));
    parts.push(h('span', { class: 'grd-cell__text' }, state.text));
    if (column.field === 'name' && row.removed) parts.push(h('span', { class: 'grd-tag' }, 'will be removed'));
    if (column.field === 'name' && row.added) parts.push(h('span', { class: 'grd-tag' }, 'new'));
    if (column.kind === 'slot' && state.text === '') parts.push(h('span', { class: 'vh' }, 'No room'));
    if (state.unknown) parts.push(h('span', { class: 'vh' }, ' (not in the building)'));
    if (state.findings.length > 0) {
      const worst = ['problem', 'warning', 'note'].find((severity) => state.findings.some((finding) => finding.severity === severity));
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

  function cellElement(row, column) {
    const state = cellState(model, row, column);
    const header = column.field === 'name';
    const cell = h(header ? 'th' : 'td', {
      class: 'grd-cell grd-cell--' + (column.kind === 'field' ? column.field : column.kind)
        + (state.staged ? ' is-staged' : '') + (state.unknown ? ' is-unknown' : ''),
      role: header ? 'rowheader' : 'gridcell',
      scope: header ? 'row' : null,
      tabindex: '-1',
      'aria-selected': 'false',
      'aria-readonly': row.removed && column.kind !== 'actions' ? 'true' : null,
      title: state.unknown ? state.text + ' is not in the building' : state.findings.length > 0 ? findingWords(state.findings) : null,
      data: { key: cellKey(row.id, column.id), row: row.id, col: column.id },
    }, cellContent(row, column));
    if (state.findings.length > 0) cell.dataset.severity = state.findings.some((finding) => finding.severity === 'problem') ? 'problem' : state.findings[0].severity;
    cells.set(cell.dataset.key, cell);
    return cell;
  }

  function head() {
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
    const reopen = editor ? { row: editor.row.id, col: editor.column.id } : null;
    drawing = true;
    closeEditor();
    model = next;
    cells = new Map();
    painted = [];
    table.replaceChildren(head(), ...model.sections.map((section) => h('tbody', null,
      h('tr', { class: 'grd-grade' }, h('th', { scope: 'rowgroup', colspan: String(model.columns.length) },
        section.label, h('span', { class: 'grd-grade__count' }, ' · ' + section.rows.length + (section.rows.length === 1 ? ' group' : ' groups')))),
      section.rows.map((row) => h('tr', { class: 'grd-row' + (row.removed ? ' is-removed' : ''), data: { group: row.id } },
        model.columns.map((column) => cellElement(row, column)))))));
    table.setAttribute('aria-rowcount', String(model.rows.length + model.sections.length + 2));
    if (model.rows.length > 0) {
      if (!place(view.at)) view.at = view.anchor = refAt(0, 0);
      if (!place(view.anchor)) view.anchor = view.at;
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
    editor.shown = roomOptions(typed);
    editor.active = Math.min(editor.active, editor.shown.length - 1);
    const known = typed.trim() === '' || model.rooms.has(typed.trim().toLowerCase());
    editor.input.classList.toggle('is-unknown', !known);
    if (editor.shown.length === 0) {
      list.replaceChildren(h('li', { class: 'picker__empty', role: 'presentation' }, 'No room matches. It is kept as typed, and marked as not in the building.'));
    } else {
      list.replaceChildren(...editor.shown.map((option, index) => h('li', {
        class: 'picker__option',
        role: 'option',
        id: listId + '-' + index,
        'aria-selected': String(index === editor.active),
        data: { room: option.room.id },
        on: {
          // pointerdown, not click: the field must not lose focus first
          pointerdown: (event) => {
            event.preventDefault();
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
    const base = element.getBoundingClientRect();
    const box = editor.cell.getBoundingClientRect();
    // under the cell, and inside the sheet: the section is its own layer, so
    // a list that reached past its edge would go under whatever is beside it
    list.hidden = false;
    list.style.left = Math.max(0, Math.min(box.left - base.left, base.width - list.offsetWidth)) + 'px';
    list.style.top = box.bottom - base.top + 'px';
  }

  function openEditor(r, c, how) {
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

  // Take the field away and put back what the cell showed.
  function closeEditor(text) {
    if (!editor) return;
    const { cell, kept } = editor;
    editor = null;
    list.hidden = true;
    delete cell.dataset.editing;
    if (text === undefined) cell.replaceChildren(...kept);
    else cell.replaceChildren(h('span', { class: 'grd-cell__text' }, text));
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
    closeEditor(text);
    drawing = false;
    if (!leaving) goTo(at.r + dr, at.c + dc, false);
    options.stage([read.op]);
    return true;
  }

  function editorKey(event) {
    const slot = editor.column.kind === 'slot';
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.shiftKey ? -1 : 1, 0);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      commit(0, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
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

  function copy() {
    const box = range();
    if (!box) return null;
    const rows = [];
    for (let r = box.r0; r <= box.r1; r += 1) {
      const out = [];
      for (let c = box.c0; c <= box.c1; c += 1) out.push(cellText(model, model.rows[r], model.columns[c]));
      rows.push(out);
    }
    options.say('Copied ' + cellCount(rows.length * rows[0].length) + '.');
    return writeTsv(rows);
  }

  function cellCount(n) {
    return n + (n === 1 ? ' cell' : ' cells');
  }

  function notTaken(refused) {
    if (refused.length === 0) return '';
    return ' ' + cellCount(refused.length) + (refused.length === 1 ? ' was' : ' were') + ' not taken: ' + refused[0];
  }

  // Paste a block with its corner on the cursor's block. One copied cell
  // pasted over a selection fills the selection.
  function paste(text) {
    let block = parseTsv(text);
    if (block.length === 0 || !model) return;
    const box = range() || { r0: 0, r1: 0, c0: 0, c1: 0 };
    if (block.length === 1 && block[0].length === 1 && (box.r1 > box.r0 || box.c1 > box.c0)) {
      const one = block[0][0];
      block = [];
      for (let r = box.r0; r <= box.r1; r += 1) block.push(new Array(box.c1 - box.c0 + 1).fill(one));
    }
    const plan = planPaste(model, box.r0, box.c0, block, options.ids);
    if (plan.ops.length === 0 && plan.refused.length === 0) return;
    if (model.rows.length > 0) {
      // the block that was pasted is selected, with the cursor on its corner
      const r1 = Math.min(box.r0 + block.length - 1, model.rows.length - 1);
      const c1 = Math.max(box.c0, Math.min(box.c0 + Math.max(...block.map((cells) => cells.length)) - 1, model.columns.length - 2));
      goTo(r1, c1, false, false);
      goTo(box.r0, box.c0, true);
    }
    options.stage(plan.ops, 'Pasted ' + cellCount(plan.cells) + '.'
      + (plan.added > 0 ? ' Added ' + plan.added + (plan.added === 1 ? ' group.' : ' groups.') : '')
      + notTaken(plan.refused)
      + (plan.clipped > 0 ? ' ' + plan.clipped + (plan.clipped === 1 ? ' column' : ' columns') + ' ran past the last column and ' + (plan.clipped === 1 ? 'was' : 'were') + ' left out.' : ''));
  }

  function clear() {
    const box = range();
    if (!box) return;
    const ops = [];
    for (let r = box.r0; r <= box.r1; r += 1) {
      for (let c = box.c0; c <= box.c1; c += 1) {
        const column = model.columns[c];
        // a name cannot be empty and a colour is always one: neither is cleared
        if (column.kind === 'actions' || column.field === 'name' || column.field === 'colour') continue;
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
    const from = box.r0 === box.r1 ? box.r0 - 1 : box.r0;
    const first = box.r0 === box.r1 ? box.r0 : box.r0 + 1;
    if (from < 0) {
      options.say('There is no row above to fill down from.');
      return;
    }
    const source = model.rows[from];
    const names = namesOf(model);
    const ops = [];
    const refused = [];
    for (let c = box.c0; c <= box.c1; c += 1) {
      const column = model.columns[c];
      if (column.kind === 'actions') continue;
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
    const moves = {
      ArrowUp: [at.r - 1, at.c],
      ArrowDown: [at.r + 1, at.c],
      ArrowLeft: [at.r, at.c - 1],
      ArrowRight: [at.r, at.c + 1],
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
      view.at = refAt(lastRow, lastColumn - 1);
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
    has(node) {
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
