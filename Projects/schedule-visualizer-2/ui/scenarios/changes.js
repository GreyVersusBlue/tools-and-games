// The scenario's name and its changes (DESIGN 5.4, spec 9.1): the name as a
// field that commits when it is left or on Enter; each change that applies as
// a chip in plain words with × to take it out; the changes that no longer
// apply listed with why, and "Remove them"; with no scenario open, a name
// and "Start a scenario".
//
// changesPanel(env) -> { element, update(view), said(text) }
//   env.ctx, env.project(), env.apply(action, payload) (false when refused,
//   and said), env.home() (where the focus goes when what held it is gone)

import { h } from '../components/dom.js';
import { newScenario, renameScenario, removeScenarioChange, removeScenarioChanges } from '../../engine/actions.js';
import { count } from '../components/words.js';

function words(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

export function changesPanel(env) {
  const ctx = env.ctx;
  // ---- with no scenario open
  const startName = h('input', { class: 'field__input', id: 'scenario-start-name', type: 'text', autocomplete: 'off', placeholder: 'New scenario', data: { key: 'scenario-start-name' } });
  const startButton = h('button', { type: 'button', class: 'btn btn--primary', data: { action: 'start' }, on: { click: start } }, 'Start a scenario');
  startName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      start();
    }
  });
  const starting = h('div', { class: 'scn-start', data: { part: 'start' } },
    h('label', { class: 'field__label', for: 'scenario-start-name' }, 'Name it (optional)'),
    h('div', { class: 'scn-start__row' }, startName, startButton));

  // ---- with one open
  const nameInput = h('input', { class: 'field__input scn-name__input', id: 'scenario-name', type: 'text', autocomplete: 'off', spellcheck: 'false', data: { key: 'scenario-name' } });
  let nameHeld = null;
  // the name the field was last set from (the stored name): leaving the field
  // commits only what was typed over it, never a name an Undo has replaced
  let nameSet = '';
  nameInput.addEventListener('focus', () => {
    nameHeld = nameInput.value;
  });
  nameInput.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      rename();
    } else if (event.key === 'Escape' && nameHeld !== null && nameInput.value !== nameHeld) {
      event.preventDefault();
      event.stopPropagation();
      nameInput.value = nameHeld;
    }
  });
  nameInput.addEventListener('blur', () => {
    rename();
    nameHeld = null;
  });
  const naming = h('div', { class: 'scn-name' }, h('label', { class: 'field__label', for: 'scenario-name' }, 'Scenario name'), nameInput);

  const chipsTitle = h('h2', { class: 'scn-panel__title', id: 'scenario-chips-title' }, 'Changes');
  const chips = h('ul', { class: 'scn-chips', 'aria-labelledby': 'scenario-chips-title', data: { part: 'chips' } });
  const none = h('p', { class: 'scn-none', hidden: true }, 'No changes yet. Add one below.');
  // what the last action said about itself (a change that cancelled itself)
  const status = h('p', { class: 'scn-status', role: 'status', data: { part: 'status' } });

  const droppedTitle = h('h2', { class: 'scn-panel__title', id: 'scenario-dropped-title' }, 'No longer applies');
  const droppedNote = h('p', { class: 'scn-dropped__note' }, 'The schedule has changed under these. They are skipped when you apply, and come back if the change under them is undone.');
  const droppedList = h('ul', { class: 'scn-dropped__list', 'aria-labelledby': 'scenario-dropped-title' });
  const removeDropped = h('button', { type: 'button', class: 'btn', data: { action: 'remove-dropped' }, on: { click: removeThem } }, 'Remove them');
  const dropped = h('div', { class: 'scn-dropped', hidden: true, data: { part: 'dropped' } }, droppedTitle, droppedNote, droppedList, removeDropped);

  const open = h('div', { class: 'scn-open', data: { part: 'open' } }, naming, chipsTitle, none, chips, status, dropped);
  const element = h('div', { class: 'scn-changes' }, starting, open);

  let view = null;

  function start() {
    const name = startName.value;
    if (env.apply(newScenario, { name })) {
      startName.value = '';
      ctx.announce('Started a scenario.');
      // the name field takes the focus: it is the open scenario's first control
      if (nameInput.isConnected && !open.hidden) nameInput.focus();
    }
  }

  function rename() {
    if (!view) return;
    const current = env.project().scenario ? env.project().scenario.name : '';
    if (nameInput.value === current || nameInput.value === nameSet) return;
    if (env.apply(renameScenario, { name: nameInput.value })) nameHeld = nameInput.value;
    else nameInput.value = current;
  }

  // the × of a chip: the change out by its index in scenario.changes; the
  // focus to the chip now in its place, else the one before, else the list's heading
  // Said in the same live region as an added change.
  function remove(index, at) {
    const chip = view ? view.kept.find((each) => each.index === index) : null;
    if (!env.apply(removeScenarioChange, { index })) return;
    if (chip) {
      const text = 'Removed: ' + chip.words.text + '.';
      status.textContent = text;
      ctx.announce(text);
    }
    // the panel is drawn again by now (the store tells the section at once)
    const buttons = chips.querySelectorAll('[data-action="remove"]');
    const next = buttons[Math.min(at, buttons.length - 1)];
    if (next) next.focus();
    else env.home();
  }

  // Remove them: the dropped changes out, as one step of undo
  // (removeScenarioChanges, SV2-72d); one Undo brings them all back.
  function removeThem() {
    if (!view || view.dropped.length === 0) return;
    const indexes = view.dropped.map((each) => each.index).filter((index) => index >= 0);
    const n = indexes.length;
    if (!env.apply(removeScenarioChanges, { indexes })) return;
    const text = 'Removed ' + count(n, 'change') + ' that no longer applied.';
    status.textContent = text;
    ctx.announce(text);
    env.home();
  }

  function update(next) {
    view = next;
    starting.hidden = Boolean(view);
    open.hidden = !view;
    if (!view) {
      status.textContent = '';
      return;
    }
    const stored = env.project().scenario.name;
    // a field being typed in keeps what was typed; one that holds the name it
    // was set from follows the stored name (an Undo of a rename while it has
    // the focus), and Escape then puts back that name
    const typed = document.activeElement === nameInput && nameInput.value !== nameSet;
    if (!typed) {
      if (nameInput.value !== stored) nameInput.value = stored;
      if (document.activeElement === nameInput) nameHeld = stored;
    }
    nameSet = stored;
    if (stored !== view.name) nameInput.placeholder = view.name;
    none.hidden = view.kept.length > 0;
    chips.hidden = view.kept.length === 0;
    chips.replaceChildren(...view.kept.map((each, at) => h('li', { class: 'scn-chip', data: { index: String(each.index), kind: each.change.kind } },
      h('span', { class: 'scn-chip__words', dir: 'auto' }, words(each.words.parts)),
      h('button', { type: 'button', class: 'scn-chip__remove', 'aria-label': 'Remove: ' + each.words.text, title: 'Remove this change', data: { action: 'remove' }, on: { click: () => remove(each.index, at) } }, '×'))));
    dropped.hidden = view.dropped.length === 0;
    droppedList.replaceChildren(...view.dropped.map((each) => h('li', { class: 'scn-dropped__item', data: { index: String(each.index) } }, h('span', { dir: 'auto' }, words(each.parts)))));
    removeDropped.textContent = view.dropped.length === 1 ? 'Remove it' : 'Remove them';
  }

  return {
    element,
    update,
    said(text) {
      status.textContent = text;
    },
    focusName() {
      if (!open.hidden) nameInput.focus();
      else startName.focus();
    },
  };
}
