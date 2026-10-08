// The Grid tab: every group at once, like a spreadsheet. Rows are groups,
// under a heading for each grade; columns are the periods of each day type.
// What a tab of the schedule is, is said at the top of ui/schedule/index.js.
//
// Edits here are staged: nothing reaches the schedule until Apply, which is
// one step for undo (engine/actions.js applyGridEdits). The bar across the
// top says what is waiting. Staged edits are kept while the page is open
// (staged.js), so leaving the tab or the section loses nothing, and closing
// the page with edits waiting asks first.
//
// For the shell, which does not use them yet:
//   gridEditsPending(projectId)   are there edits waiting, for the dot on the
//                                 Schedule item of the rail
//   watchGridEdits(fn)            fn(projectId, pending) when that changes
//   GRID_KEYS                     the grid's keys, for Help

import { h, uid } from '../../components/dom.js';
import { choice } from '../../components/choice.js';
import { openMenu } from '../../components/menu.js';
import { isEditing, IS_MAC } from '../../components/shortcuts.js';
import { periodWords } from '../../components/words.js';
import { applyGridEdits } from '../../../engine/actions.js';
import { ownDayTypes, isOwnCopy, baseDayType } from '../../../engine/day-types.js';
import { allRooms } from '../../../engine/schema.js';
import { fill, apply, button, keyed, emptyState, roomLabel } from '../common.js';
import { draftFor, gridEditsPending, anyGridEditsPending, preview, payloadOf, touch, discard, remember, takeBack, forgetSteps, stageSlot, stageField, stageAdd, stageRemove, stageKeep } from './staged.js';
import { sheetModel, namesOf, newGroup } from './model.js';
import { sheet as makeSheet, cellKey } from './sheet.js';
import { teacherTable, roomTable } from './readonly.js';

export { gridEditsPending, watchGridEdits } from './staged.js';

const MOD = IS_MAC ? '⌘' : 'Ctrl+';

export const GRID_KEYS = [
  { id: 'grid-arrows', does: 'Move from cell to cell in the grid', shown: 'Arrows' },
  { id: 'grid-select', does: 'Select a block of cells', shown: 'Shift+Arrows' },
  { id: 'grid-edit', does: 'Edit the cell, keeping what it holds', shown: 'Enter, F2' },
  { id: 'grid-escape', does: 'Leave the cell as it was', shown: 'Esc' },
  { id: 'grid-copy', does: 'Copy the selected cells, for the grid or a spreadsheet', shown: MOD + 'C' },
  { id: 'grid-paste', does: 'Paste cells from the grid or a spreadsheet', shown: MOD + 'V' },
  { id: 'grid-fill', does: 'Fill down from the top row of the selection', shown: MOD + 'D' },
  { id: 'grid-clear', does: 'Empty the selected cells', shown: 'Delete' },
];

const ROWS = [
  { value: 'groups', label: 'Groups' },
  { value: 'teachers', label: 'Teachers' },
  { value: 'rooms', label: 'Rooms' },
];

const SHEET = new URL('./grid.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="grid"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'grid' } }));
}

// One watch on the clipboard and on the page closing, for whichever grid is
// on screen.
let live = null;
function current() {
  return live && live.element.isConnected && live.rows() === 'groups' ? live : null;
}
function watchPage() {
  if (watchPage.done) return;
  watchPage.done = true;
  document.addEventListener('copy', (event) => {
    const grid = current();
    if (!grid || !grid.sheet.has(document.activeElement)) return;
    const text = grid.sheet.copy();
    if (text === null) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  });
  document.addEventListener('cut', (event) => {
    const grid = current();
    if (!grid || !grid.sheet.has(document.activeElement)) return;
    const text = grid.sheet.copy();
    if (text === null) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    grid.sheet.clear();
  });
  document.addEventListener('paste', (event) => {
    const grid = current();
    if (!grid || !event.clipboardData) return;
    const active = document.activeElement;
    // on a cell; or anywhere in an empty grid that is not a field, since
    // there is no cell there yet to be on
    if (!grid.sheet.has(active) && !(grid.empty() && !isEditing(active) && !document.querySelector('dialog[open]'))) return;
    event.preventDefault();
    grid.sheet.paste(event.clipboardData.getData('text/plain'));
  });
  window.addEventListener('beforeunload', (event) => {
    if (!anyGridEditsPending()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

export function mount(env) {
  const { ctx, view } = env;
  loadSheet();
  watchPage();
  if (!view.grid) view.grid = { rows: 'groups', at: null, anchor: null };
  const state = view.grid;
  const element = h('div', { class: 'grd' });
  const status = h('p', { class: 'grd-status' });
  let model = null;
  let editNext = null;

  const projectId = () => ctx.store.project.id;

  function say(text) {
    status.textContent = text;
    ctx.announce(text);
  }

  function stage(ops, said) {
    const id = projectId();
    if (ops.length > 0) {
      remember(id);
      for (const op of ops) {
        if (op.op === 'add') stageAdd(id, { ...op.group });
        else if (op.op === 'field') stageField(id, op.groupId, op.field, op.value);
        else stageSlot(id, op.groupId, op.dayTypeId, op.period, op.fields);
      }
      touch(id);
    }
    if (said) say(said);
    env.render();
  }

  const sheet = makeSheet({
    view: state,
    ids: ctx.ids,
    stage,
    say,
    roomLabel,
    undo() {
      if (!takeBack(projectId())) return false;
      say('Took back the last change in the grid.');
      env.render();
      return true;
    },
    remove(row) {
      const id = projectId();
      remember(id);
      stageRemove(id, row.id);
      touch(id);
      say(row.added ? 'Took out ' + row.group.name + ', which was not in the schedule yet.' : row.group.name + ' will be removed when the changes are applied.');
      env.render();
    },
    keep(row) {
      const id = projectId();
      remember(id);
      stageKeep(id, row.id);
      touch(id);
      say('Put ' + row.group.name + ' back.');
      env.render();
    },
  });

  function add() {
    const colours = model.rows.filter((row) => !row.removed).map((row) => row.group);
    const cursor = state.at ? model.rows.find((row) => row.id === state.at.row) : null;
    const group = newGroup(model, ctx.ids, namesOf(model), colours, cursor ? cursor.group.grade : '');
    state.at = state.anchor = { row: group.id, col: 'name' };
    editNext = group.id;
    stage([{ op: 'add', group }], 'Added ' + group.name + '. Type its name.');
    env.focusAfter(cellKey(group.id, 'name') + ':edit');
  }

  function applyAll() {
    const project = ctx.store.project;
    const staged = preview(project, project.id, ctx);
    if (!apply(env, applyGridEdits, payloadOf(draftFor(project.id)))) return;
    discard(project.id);
    forgetSteps(project.id);
    say('Applied to the schedule: ' + staged.text + '.');
    ctx.toast({ text: 'Applied to the schedule: ' + staged.text + '.', action: { label: 'Undo', run: ctx.undo } });
    env.render(sheet.keyOfCursor());
  }

  async function discardAll(opener) {
    const project = ctx.store.project;
    const staged = preview(project, project.id, ctx);
    const ok = await ctx.confirm({
      title: 'Discard the changes in the grid?',
      body: 'Not applied yet: ' + staged.text + '. Discarding them leaves the schedule as it is, and they cannot be brought back.',
      action: 'Discard the changes',
      keep: 'Keep them',
      danger: true,
      opener,
    });
    if (!ok) return;
    discard(project.id);
    forgetSteps(project.id);
    say('Discarded the changes in the grid.');
    env.render(sheet.keyOfCursor());
  }

  // ---------------------------------------------------------------- bulk actions

  function everySlot(dayTypeIds, fieldsFor) {
    const ops = [];
    for (const row of model.rows) {
      if (row.removed) continue;
      for (const dayTypeId of dayTypeIds) {
        for (let period = 0; period < model.after.settings.periods; period += 1) {
          ops.push({ op: 'slot', groupId: row.id, dayTypeId, period, fields: fieldsFor(row, period) });
        }
      }
    }
    return ops;
  }

  const emptied = () => ({ room: null, roomText: '', label: '', teacherIds: [] });

  function bulkItems() {
    const base = baseDayType(model.after);
    const own = ownDayTypes(model.after);
    const items = own.filter((dayType) => dayType.id !== base.id).map((dayType) => ({
      label: 'Copy ' + base.name + ' to ' + dayType.name + ' for every group',
      run: () => stage(everySlot([dayType.id], (row, period) => {
        const from = row.group.days[base.id][period];
        return { room: from.room, roomText: from.roomText, label: from.label, teacherIds: from.teacherIds.slice() };
      }), 'Copied ' + base.name + ' to ' + dayType.name + ' for every group. It is not applied yet.'),
    }));
    if (items.length > 0) items.push('separator');
    for (const dayType of own) {
      items.push({ label: 'Clear ' + dayType.name, run: () => stage(everySlot([dayType.id], emptied), 'Cleared ' + dayType.name + ' for every group. It is not applied yet.') });
    }
    items.push({ label: 'Clear all', danger: true, run: () => stage(everySlot(own.map((dayType) => dayType.id), emptied), 'Cleared every group’s rooms. It is not applied yet.') });
    return items;
  }

  // ---------------------------------------------------------------- drawing

  function toolbar() {
    const labelId = uid('grid-rows');
    const rows = choice({
      name: uid('grid-rows'),
      labelledBy: labelId,
      options: ROWS,
      value: state.rows,
      onChange: (value) => {
        state.rows = value;
        env.render('grid-rows:' + value);
      },
    });
    for (const input of rows.element.querySelectorAll('input')) keyed(input, 'grid-rows:' + input.value);
    const tools = [h('span', { class: 'grd-toolbar__label', id: labelId }, 'Rows'), rows.element];
    if (state.rows === 'groups' && model.rows.length > 0) {
      const bulk = button('Bulk actions', (opener) => openMenu({ items: bulkItems(), anchor: opener, label: 'Bulk actions' }), { key: 'grid-bulk', action: 'bulk' });
      bulk.setAttribute('aria-haspopup', 'menu');
      tools.push(
        button('Add a group', add, { key: 'grid-add', action: 'add-group' }),
        button('Fill down', () => sheet.fillDown(), { key: 'grid-fill', action: 'fill-down', title: 'Copy the top row of the selection into the rows under it (' + MOD + 'D)' }),
        bulk);
    }
    return h('div', { class: 'sch-toolbar grd-toolbar' }, tools);
  }

  function bar(staged) {
    return h('div', { class: 'grd-bar', role: 'group', 'aria-label': 'Changes not applied' },
      h('p', { class: 'grd-bar__text' }, h('strong', null, 'Not applied yet: '), staged.text + (staged.refusal ? '. ' + staged.refusal : '')),
      button('Apply', applyAll, { primary: true, key: 'grid-apply', action: 'apply' }),
      button('Discard', discardAll, { key: 'grid-discard', action: 'discard' }));
  }

  function body(project, staged) {
    const words = periodWords(project.settings);
    if (state.rows === 'teachers') {
      if (staged.project.teachers.length === 0) {
        return emptyState('No teachers yet. Add a teacher, and this shows each teacher’s day.', button('Go to Teachers', () => ctx.navigate('#schedule/teachers'), { primary: true, key: 'grid-go' }));
      }
      return [h('p', { class: 'sch-hint' }, 'Each teacher’s day, for reading: the groups they have each ' + words.one + ', and where. To change a room, set the rows to Groups.'), teacherTable(staged.project)];
    }
    if (state.rows === 'rooms') {
      if (allRooms(staged.project).length === 0) {
        return emptyState('No rooms yet. Draw rooms in the building, and this shows who is in each.', button('Go to Building', () => ctx.navigate('#building'), { primary: true, key: 'grid-go' }));
      }
      return [h('p', { class: 'sch-hint' }, 'Each room’s day, for reading: the groups in it each ' + words.one + '. To change a room, set the rows to Groups.'), roomTable(staged.project)];
    }
    if (model.rows.length === 0) {
      return [
        emptyState('Add the first group here, or paste a block from a spreadsheet.', button('Add a group', add, { primary: true, key: 'grid-add', action: 'add-group' })),
        h('p', { class: 'sch-hint' }, 'A group is a set of students who travel together all day. To paste, copy rows whose columns are a name, a grade, a head count, a colour, then a room number for each ' + words.one + ', and press ' + MOD + 'V here. Columns you leave out at the end stay empty.'),
      ];
    }
    return h('p', { class: 'sch-hint grd-hint' }, 'Arrow keys move. Type to replace a cell; Enter or F2 edits it; Escape leaves it as it was. Shift with the arrows selects a block. '
      + MOD + 'C and ' + MOD + 'V copy and paste, to and from a spreadsheet; ' + MOD + 'D fills down; Delete empties. A room number with a dotted line under it is not in the building.');
  }

  // The sheet stays where it is from one drawing to the next (taking it out
  // of the page would lose where it is scrolled to); what is above and below
  // it is drawn again.
  const above = h('div', { class: 'grd-above' });
  const below = h('div', { class: 'grd-below' });
  element.append(above, sheet.element, below, status);

  function draw(project) {
    const staged = preview(project, project.id, ctx);
    const pending = gridEditsPending(project.id);
    model = sheetModel(project, staged.project, draftFor(project.id));
    sheet.draw(model);
    const sheetShown = state.rows === 'groups' && model.rows.length > 0;
    sheet.element.hidden = !sheetShown;
    element.dataset.rows = state.rows;
    element.dataset.staged = String(pending);
    const same = sheetShown ? project.dayTypes.filter((dayType) => !isOwnCopy(project, dayType.id)) : [];
    fill(above,
      toolbar(),
      pending ? bar(staged) : null,
      same.map((dayType) => h('p', { class: 'sch-hint' }, dayType.name + ' is the same as ' + baseDayType(project).name + ', so it has no columns of its own here. Give it its own copy on the Day tab.')));
    fill(below, body(project, staged));
    if (editNext && sheetShown) sheet.startEditing(editNext, 'name');
    editNext = null;
  }

  live = { element, sheet, rows: () => state.rows, empty: () => Boolean(model) && model.rows.length === 0 };
  draw(ctx.store.project);

  // Edits staged before the tab was left are still here: say so. (After the
  // shell has said which section this is.)
  if (gridEditsPending(projectId())) {
    setTimeout(() => {
      const project = ctx.store.project;
      if (element.isConnected && gridEditsPending(project.id)) ctx.announce('Not applied yet: ' + preview(project, project.id, ctx).text + '. Apply and Discard are above the grid.');
    }, 400);
  }

  return { element, update: draw };
}
