// The floor menu (DESIGN 16.2 and 16.12 items 1 and 10; spec 4.1): what can be
// done with a floor, from the ⋯ button on the selected floor tab, by right-click
// on a tab, and by the Menu key or Shift+F10 on one. On a phone the ⋯ button is
// the path (a tab is dragged to scroll the row, so there is no long-press).
//
//   Rename…  ·  Duplicate floor…  ·  Move left  ·  Move right  ·  Delete…
//
// Duplicate floor… opens a dialog that says, before anything changes, where the
// copy goes, what it is called, what is copied and what is not, how the room
// numbers will come out (room by room) and what joining the stairs will do. The engine decides
// (engine/floor-copy.js); the dialog only reads its description and sends its
// choices. The dialog has a scrolling body and a footer pinned at the bottom
// (16.12 item 10), so at 844 × 390 the buttons are always on screen.

import { h } from '../components/dom.js';
import { openMenu } from '../components/menu.js';
import { count } from '../components/words.js';
import { renameFloor, reorderFloor, deleteFloor, describeFloorDelete } from '../../engine/actions.js';
import { duplicateFloor, describeFloorDuplicate, FLOOR_NAME_MOST } from '../../engine/floor-copy.js';
import { textLength } from '../../engine/schema.js';
import { askText } from './menu.js';

// The footer pinned and the body scrolling, on the dialog itself.
function pin(dialog) {
  const element = dialog.element;
  element.style.display = 'flex';
  element.style.flexDirection = 'column';
  element.style.maxHeight = 'min(40rem, calc(100dvh - var(--s-4)))';
  element.style.overflow = 'hidden';
  const title = element.querySelector('.dialog__title');
  const body = element.querySelector('.dialog__body');
  const buttons = element.querySelector('.dialog__buttons');
  title.style.flex = 'none';
  body.style.flex = '1 1 auto';
  body.style.minHeight = '0';
  body.style.overflow = 'auto';
  buttons.style.flex = 'none';
  buttons.style.marginTop = 'var(--s-3)';
  buttons.style.paddingTop = 'var(--s-3)';
  buttons.style.borderTop = 'var(--border)';
  // a finger's size
  for (const button of buttons.querySelectorAll('button')) button.style.minHeight = '44px';
  // a button that cannot be used yet is aria-disabled, and stays in the Tab order: its
  // press, by click, Enter or Space, stops here, before the dialog closes
  buttons.addEventListener('click', (event) => {
    const pressed = event.target.closest ? event.target.closest('button') : null;
    if (pressed && pressed.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  return { body, buttons: Array.from(buttons.querySelectorAll('button')) };
}

// The line under the room-number rows: with Renumber chosen, the engine's one
// sentence of what happens to each numbered room, room by room (ARCHITECTURE
// 22.17; Devon 2026-11-21): "Rooms 201 to 204 become 401 to 404; Library
// becomes Library 2." With no numbered room there are no rows, and the line
// says so; with Leave them without numbers chosen, the row's own words say it.
function numbersLine(info, level) {
  if (info.rooms === 0) return null;
  if (info.renumber.reason === 'none') return info.name + '\'s rooms have no numbers yet, so the copies have none either.';
  return level ? info.renumber.text : null;
}

// A coarse pointer (a phone, a tablet): the Name field is not focused as the
// dialog opens, since the keyboard it raises would cover the dialog (as DESIGN
// 5.1 and 16.3 keep it off the plan); a fine pointer keeps it.
function coarsePointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

// floorMenu(ed) -> { items(floorId), open(floorId, anchor, opener), duplicate(floorId, opener) }
//   ed   the building section's editor (index.js)
export function floorMenu(ed) {
  const ctx = ed.ctx;

  function floorOf(floorId) {
    return ed.project.building.floors.find((floor) => floor.id === floorId) || null;
  }

  async function rename(floorId, opener) {
    const floor = floorOf(floorId);
    if (!floor) return;
    const name = await askText(ctx, {
      id: 'floor-rename-dialog',
      title: 'Rename ' + floor.name,
      label: 'Floor name',
      value: floor.name,
      action: 'Rename ' + floor.name,
      keep: 'Keep the name',
      opener,
    });
    if (name === null) {
      ed.say('The name was kept.');
      return;
    }
    if (name.trim() === '') {
      ed.say('A floor needs a name. The name was kept.');
      ctx.toast({ kind: 'problem', text: 'A floor needs a name. Type one, like Annex, and try again.' });
      return;
    }
    ed.commit(renameFloor, { id: floorId, name: name.trim() }, { done: () => 'Renamed ' + floor.name + ' to ' + name.trim() + '.', toast: () => null, same: 'The floor is called ' + name.trim() + ' already.' });
  }

  function move(floorId, step) {
    const floors = ed.project.building.floors;
    const at = floors.findIndex((floor) => floor.id === floorId);
    const to = at + step;
    if (at === -1 || to < 0 || to >= floors.length) return;
    const name = floors[at].name;
    ed.commit(reorderFloor, { id: floorId, toIndex: to }, { done: () => name + ' is now floor ' + (to + 1) + ' of ' + floors.length + ' in the tabs.', toast: () => null });
  }

  async function remove(floorId, opener) {
    const floor = floorOf(floorId);
    if (!floor) return;
    const described = describeFloorDelete(ed.project, floorId);
    if (!described || described.last) return;
    const takes = [];
    if (described.rooms > 0) takes.push(count(described.rooms, 'room'));
    if (described.otherSpaces > 0) takes.push(count(described.otherSpaces, 'other space'));
    if (described.connections > 0) takes.push(count(described.connections, 'stairs connection'));
    if (described.exits > 0) takes.push(count(described.exits, 'exit'));
    if (described.zones > 0) takes.push(count(described.zones, 'left-out area'));
    const body = [h('p', null, takes.length === 0 ? 'Nothing is drawn on it.' : 'With it go ' + takes.join(', ') + '.')];
    if (described.slots > 0) body.push(h('p', null, count(described.slots, 'period') + ' of the schedule ' + (described.slots === 1 ? 'is' : 'are') + ' in its rooms. Those would say the room is not in the building.'));
    body.push(h('p', null, 'Undo brings the floor back.'));
    const ok = await ctx.confirm({ title: 'Delete ' + floor.name + '?', body, action: 'Delete ' + floor.name, keep: 'Keep ' + floor.name, danger: true, opener });
    if (!ok) return;
    const sentence = 'Deleted ' + floor.name + (described.connections > 0 ? ' and ' + count(described.connections, 'stairs connection') + ' with it' : '') + '.';
    ed.commit(deleteFloor, { id: floorId }, { done: () => sentence, toast: () => sentence });
  }

  // Duplicate floor…: resolves true once duplicated.
  function duplicate(floorId, opener) {
    const floor = floorOf(floorId);
    if (!floor) return Promise.resolve(false);
    const first = describeFloorDuplicate(ed.project, floorId);
    const sentence = h('p', { id: 'duplicate-sentence', dir: 'auto' });
    const copied = h('p', { id: 'duplicate-copied', dir: 'auto' });
    const name = h('input', { class: 'field__input', id: 'duplicate-name', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'duplicate-sentence' });
    name.value = first.newName;
    const nameNote = h('p', { class: 'field__refusal', id: 'duplicate-name-note', role: 'status', hidden: true });

    const numbered = first.renumber.possible;
    const keepRadio = h('input', { type: 'radio', name: 'duplicate-numbers', id: 'duplicate-numbers-level', value: 'level', checked: numbered, data: { choice: 'level' } });
    const blankRadio = h('input', { type: 'radio', name: 'duplicate-numbers', id: 'duplicate-numbers-blank', value: 'blank', checked: !numbered, data: { choice: 'blank' } });
    const levelLabel = h('label', { for: 'duplicate-numbers-level' });
    const blankLabel = h('label', { for: 'duplicate-numbers-blank' });
    const numbersFieldset = h('fieldset', { class: 'bld-dup__numbers', id: 'duplicate-numbers' },
      h('legend', { class: 'field__label' }, 'Room numbers'),
      h('div', { class: 'bld-dup__row' }, keepRadio, levelLabel),
      h('div', { class: 'bld-dup__row' }, blankRadio, blankLabel));
    const numbersNote = h('p', { id: 'duplicate-numbers-note', dir: 'auto' });
    keepRadio.setAttribute('aria-describedby', 'duplicate-numbers-note');

    const join = h('input', { type: 'checkbox', id: 'duplicate-join', checked: true });
    const joinWords = h('span', { id: 'duplicate-join-words', dir: 'auto' });
    const joinRow = h('div', { class: 'bld-dup__row bld-dup__row--join' }, join, h('label', { for: 'duplicate-join' }, 'Join the stairs and elevators'));
    const joinBlock = h('div', { class: 'bld-dup__join', id: 'duplicate-join-block' }, joinRow, h('p', { class: 'bld-dup__sentence', id: 'duplicate-join-sentence', dir: 'auto' }, joinWords));
    const unjoinedLine = h('p', { id: 'duplicate-unjoined', class: 'bld-inspector__small', dir: 'auto' });
    const left = h('p', { id: 'duplicate-left', class: 'bld-inspector__small' });
    const notes = h('p', { id: 'duplicate-notes', class: 'bld-inspector__small' });

    const dialog = ctx.openDialog({
      id: 'duplicate-floor-dialog',
      class: 'bld-dup',
      title: 'Duplicate ' + floor.name,
      opener: opener || ed.canvas,
      body: [
        sentence,
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'duplicate-name' }, 'Name'), name, nameNote),
        copied,
        numbersFieldset,
        numbersNote,
        joinBlock,
        unjoinedLine,
        left,
        notes,
      ],
      buttons: [
        { label: 'Duplicate ' + floor.name, value: 'yes', kind: 'primary' },
        { label: 'Cancel', value: null },
      ],
    });
    const { buttons } = pin(dialog);
    const make = buttons[0];

    let info = first;
    let refused = false;

    function say(info) {
      sentence.textContent = 'The copy goes on top of the building, as ' + info.newName + '.';
      copied.textContent = 'It has ' + floor.name + '\'s corridors, stairs, rooms and other spaces: ' + info.copied + '.';
      const line = numbersLine(info, keepRadio.checked);
      numbersFieldset.hidden = !info.renumber.possible;
      numbersNote.hidden = line === null;
      numbersNote.textContent = line || '';
      if (info.renumber.possible) {
        levelLabel.textContent = 'Renumber them for ' + info.newName;
        blankLabel.textContent = 'Leave them without numbers (' + count(info.rooms, 'room') + ' to number)';
      }
      joinBlock.hidden = info.joins.length === 0;
      joinWords.textContent = info.joinText;
      left.textContent = 'Not copied: ' + info.notCopied + '.' + (info.notJoinedText === '' ? '' : ' ' + info.notJoinedText);
      unjoinedLine.hidden = info.unjoinedText === '';
      unjoinedLine.textContent = info.unjoinedText;
      const level = info.renumber.possible && keepRadio.checked && info.notes > 0;
      notes.hidden = !level;
      notes.textContent = level ? info.notesText : '';
    }

    function reread() {
      const typed = name.value.trim();
      let problem = '';
      if (typed === '') problem = 'A floor needs a name. Type one, like ' + first.newName + '.';
      else if (textLength(typed) > FLOOR_NAME_MOST) problem = 'A floor name is at most ' + FLOOR_NAME_MOST + ' characters, and this one has ' + textLength(typed) + '. Shorten it.';
      refused = problem !== '';
      nameNote.hidden = !refused;
      nameNote.textContent = problem;
      name.setAttribute('aria-invalid', String(refused));
      make.setAttribute('aria-disabled', String(refused));
      if (refused) make.setAttribute('aria-describedby', nameNote.id);
      else make.removeAttribute('aria-describedby');
      info = describeFloorDuplicate(ed.project, floorId, { name: typed });
      say(info);
    }
    name.addEventListener('input', reread);
    keepRadio.addEventListener('change', reread);
    blankRadio.addEventListener('change', reread);
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!refused) dialog.close('yes');
      }
    });
    reread();
    if (coarsePointer()) {
      // the first control that is not a text field, else the dialog itself
      const control = Array.from(dialog.element.querySelectorAll('.dialog__body input[type="radio"], .dialog__body input[type="checkbox"]'))
        .find((input) => input.closest('[hidden]') === null && (input.type !== 'radio' || input.checked));
      if (control) control.focus();
      else {
        dialog.element.tabIndex = -1;
        dialog.element.focus();
      }
    } else {
      name.focus();
      name.select();
    }

    return dialog.closed.then((answer) => {
      if (answer !== 'yes') {
        ed.say('No floor was duplicated.');
        if (!(opener && opener.isConnected)) ed.canvas.focus({ preventScroll: true });
        return false;
      }
      const payload = { floorId, name: name.value.trim(), numbers: info.renumber.possible && keepRadio.checked ? 'level' : 'blank', join: info.joins.length === 0 ? false : join.checked };
      const outcome = ed.commit(duplicateFloor, payload, { done: (result) => result.text, toast: (result) => 'Duplicated ' + floor.name + ' as ' + result.newName });
      if (outcome === null) return false;
      ctx.navigate('#building/' + outcome.floorId);
      return true;
    });
  }

  // The menu's items for one floor.
  function items(floorId, given) {
    const floors = ed.project.building.floors;
    const at = floors.findIndex((floor) => floor.id === floorId);
    if (at === -1) return [];
    // the focus goes back to what opened the menu (the ⋯ button, or the tab)
    const opener = () => (given && given.isConnected ? given : document.getElementById('floor-tab-' + floorId) || ed.canvas);
    return [
      { label: 'Rename…', run: () => rename(floorId, opener()) },
      { label: 'Duplicate floor…', run: () => duplicate(floorId, opener()) },
      { label: 'Move left', disabled: at === 0, run: () => move(floorId, -1) },
      { label: 'Move right', disabled: at === floors.length - 1, run: () => move(floorId, 1) },
      'separator',
      { label: 'Delete…', danger: true, disabled: floors.length === 1, run: () => remove(floorId, opener()) },
    ];
  }

  function open(floorId, anchor, opener) {
    const floor = floorOf(floorId);
    if (!floor) return null;
    return openMenu({ items: items(floorId, opener), anchor, opener, label: floor.name + ' actions' });
  }

  return { items, open, duplicate };
}
