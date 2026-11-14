// The scenario's name and its changes (DESIGN 5.4, spec 9.1): the name as a
// field that commits when it is left or on Enter; each change that applies as
// a chip in plain words with × to take it out; the changes that no longer
// apply listed with why, and "Remove them"; with no scenario open, a name
// and "Start a scenario".
//
// changesPanel(env) -> { element, update(view), said(text) }
//   env.ctx, env.project(), env.apply(action, payload) (false when refused,
//   and said), env.home() (where the focus goes when what held it is gone),
//   env.focusKinds() (where the focus goes when the last chip is taken out:
//   the Kind of change fieldset, DESIGN 12.4)

import { h } from '../components/dom.js';
import { newScenario, renameScenario, duplicateScenario, removeScenarioChange, removeScenarioChanges, removeScenarioLever } from '../../engine/actions.js';
import { count } from '../components/words.js';
import { fullWords, scenarioName } from './model.js';

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
  // the open scenario's name as a heading, shown while other scenarios are
  // kept: where the focus goes after Switch to (DESIGN 15.9 item 11)
  const openTitle = h('h2', { class: 'scn-panel__title scn-open__title', id: 'scenario-open-title', tabindex: '-1', hidden: true, data: { part: 'open-title' } });
  // Keep and start another, Duplicate: in the panel, not on the sticky bar
  // (which keeps Apply… and Discard…). At the limit of twelve scenarios both
  // are aria-disabled with the reason as their description, and stay focusable.
  const keepButton = h('button', { type: 'button', class: 'btn', data: { action: 'keep-start' }, on: { click: () => keepAndStart() } }, 'Keep and start another');
  const duplicateButton = h('button', { type: 'button', class: 'btn', data: { action: 'duplicate' }, on: { click: () => duplicateOpen() } }, 'Duplicate');
  const fullNote = h('p', { class: 'scn-open__full', id: 'scenario-open-full', hidden: true, data: { part: 'open-full' } });
  const keeping = h('div', { class: 'scn-open__actions', role: 'group', 'aria-label': 'Keep this scenario', data: { part: 'open-actions' } }, keepButton, duplicateButton);
  const naming = h('div', { class: 'scn-name' }, h('label', { class: 'field__label', for: 'scenario-name' }, 'Scenario name'), nameInput);

  const chipsTitle = h('h2', { class: 'scn-panel__title', id: 'scenario-chips-title' }, 'Changes');
  const chips = h('ul', { class: 'scn-chips', 'aria-labelledby': 'scenario-chips-title', data: { part: 'chips' } });
  const none = h('p', { class: 'scn-none', hidden: true }, 'No changes yet. Add one below.');
  // what the last action said about itself (a change that cancelled itself)
  // the visible line; the page's one live region (ctx.announce) says it aloud
  const status = h('p', { class: 'scn-status', data: { part: 'status' } });

  const droppedTitle = h('h2', { class: 'scn-panel__title', id: 'scenario-dropped-title' }, 'No longer applies');
  const droppedNote = h('p', { class: 'scn-dropped__note' }, 'The schedule has changed under these. They are skipped when you apply, and come back if the change under them is undone.');
  const droppedList = h('ul', { class: 'scn-dropped__list', 'aria-labelledby': 'scenario-dropped-title' });
  const removeDropped = h('button', { type: 'button', class: 'btn', data: { action: 'remove-dropped' }, on: { click: removeThem } }, 'Remove them');
  const dropped = h('div', { class: 'scn-dropped', hidden: true, data: { part: 'dropped' } }, droppedTitle, droppedNote, droppedList, removeDropped);

  // what the cross-hatch on the plan means (a closed corridor or stairs), shown while one is closed
  const legend = h('p', { class: 'scn-legend', hidden: true, data: { part: 'legend' } }, h('span', { class: 'scn-legend__swatch', 'aria-hidden': 'true' }), 'Closed in this trial');
  const open = h('div', { class: 'scn-open', data: { part: 'open' } }, openTitle, naming, chipsTitle, none, chips, legend, status, dropped, keeping, fullNote);
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

  // Keep and start another: the open scenario goes to the kept list and a
  // new one opens, with its name field focused and selected
  function keepAndStart() {
    const why = fullWords(env.project());
    if (why) {
      status.textContent = why;
      ctx.announce(why);
      return;
    }
    const kept = view ? view.name : '';
    if (!env.apply(newScenario, { keep: true })) return;
    const text = 'Kept ' + kept + '. Started ' + scenarioName(env.project().scenario) + '.';
    status.textContent = text;
    ctx.announce(text);
    if (nameInput.isConnected && !open.hidden) {
      nameInput.focus();
      nameInput.select();
    }
  }

  // Duplicate: a copy is kept right after the open scenario's place in the
  // list; the open scenario stays open and the focus stays on the button
  function duplicateOpen() {
    const why = fullWords(env.project());
    if (why) {
      status.textContent = why;
      ctx.announce(why);
      return;
    }
    const had = new Set((Array.isArray(env.project().scenarios) ? env.project().scenarios : []).map((scenario) => scenario && scenario.id));
    if (!env.apply(duplicateScenario, {})) return;
    // the copy is the kept scenario that was not there before, found by its id
    const now = env.project().scenarios;
    const made = Array.isArray(now) ? now.find((scenario) => scenario && !had.has(scenario.id)) : null;
    const copy = made ? scenarioName(made) : '';
    const text = 'Duplicated ' + (view ? view.name : '') + ' as ' + copy + '. It is kept under Other scenarios.';
    status.textContent = text;
    ctx.announce(text);
  }

  function rename() {
    if (!view) return;
    const current = env.project().scenario ? env.project().scenario.name : '';
    if (nameInput.value === current || nameInput.value === nameSet) return;
    if (env.apply(renameScenario, { name: nameInput.value })) nameHeld = nameInput.value;
    else nameInput.value = current;
  }

  // the × of a chip: the change out by its index in scenario.changes (a
  // lever by its index in scenario.levers); the focus to the chip now in its
  // place, else the one before, else the Kind of change fieldset. Said in
  // the same live region as an added change, with how many are left.
  function remove(index, at, lever) {
    const chip = view ? (lever ? view.levers.find((each) => each.index === index) : view.kept.find((each) => each.index === index)) : null;
    if (!env.apply(lever ? removeScenarioLever : removeScenarioChange, { index })) return;
    if (chip) {
      // the panel is drawn again by now: view counts what is left
      const left = view.total;
      const text = 'Removed: ' + chip.words.text + '. ' + count(left, 'change') + '.';
      status.textContent = text;
      ctx.announce(text);
    }
    // the panel is drawn again by now (the store tells the section at once)
    const buttons = chips.querySelectorAll('[data-action="remove"]');
    const next = buttons[Math.min(at, buttons.length - 1)];
    if (next) next.focus();
    else env.focusKinds();
  }

  // Remove them: the dropped changes and the dropped levers out together, as
  // one step of undo (removeScenarioChanges with `leverIndexes`, SV2-90b); one
  // Undo brings them all back. A bad or repeated index refuses the whole step,
  // which removes nothing: the status then says none went, how many are still
  // listed, and the refusal, as it was said. A dropped lever whose place in the
  // scenario cannot be found stays listed and is counted so.
  function removeThem() {
    if (!view || view.dropped.length + view.droppedLevers.length === 0) return;
    const all = view.dropped.length + view.droppedLevers.length;
    const indexes = view.dropped.map((each) => each.index).filter((index) => index >= 0);
    const leverIndexes = view.droppedLevers.map((each) => each.index).filter((index) => index >= 0);
    status.textContent = '';
    const removed = indexes.length + leverIndexes.length;
    if (removed === 0 || !env.apply(removeScenarioChanges, { indexes, leverIndexes })) {
      const refusal = status.textContent;
      const text = 'Removed none of the ' + count(all, 'change') + ' that no longer applied. ' + all + (all === 1 ? ' is' : ' are') + ' still listed.' + (refusal !== '' ? ' ' + refusal : '');
      status.textContent = text;
      ctx.announce(text);
      return;
    }
    if (removed === all) {
      const text = 'Removed ' + count(removed, 'change') + ' that no longer applied.';
      status.textContent = text;
      ctx.announce(text);
      env.home();
      return;
    }
    const left = all - removed;
    const text = 'Removed ' + removed + ' of ' + count(all, 'change') + ' that no longer applied. ' + left + (left === 1 ? ' is' : ' are') + ' still listed.';
    status.textContent = text;
    ctx.announce(text);
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
    openTitle.replaceChildren(h('bdi', null, view.name), h('span', { class: 'vh' }, ', the open scenario'));
    const why = fullWords(env.project());
    for (const button of [keepButton, duplicateButton]) {
      if (why) {
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('aria-describedby', 'scenario-open-full');
      } else {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');
      }
    }
    fullNote.hidden = !why;
    fullNote.textContent = why || '';
    openTitle.hidden = !env.showOpenTitle();
    if (stored !== view.name) nameInput.placeholder = view.name;
    none.hidden = view.total > 0;
    legend.hidden = !view.levers.some((each) => each.trial);
    chips.hidden = view.total === 0;
    const sentence = (each) => [h('span', { class: 'scn-chip__words', dir: 'auto' }, words(each.words.parts), each.instead ? ', instead of ' + each.instead : ''), each.trial ? h('span', { class: 'scn-tag', data: { tag: 'trial' } }, 'Trial only') : null];
    const removeOf = (each, at, lever) => h('button', { type: 'button', class: 'scn-chip__remove', 'aria-label': 'Remove: ' + each.words.text, title: 'Remove this change', data: { action: 'remove' }, on: { click: () => remove(each.index, at, lever) } }, '×');
    chips.replaceChildren(
      ...view.kept.map((each, at) => h('li', { class: 'scn-chip', data: { index: String(each.index), kind: each.change.kind } }, h('span', { class: 'scn-chip__words', dir: 'auto' }, words(each.words.parts)), removeOf(each, at, false))),
      ...view.levers.map((each, at) => h('li', { class: 'scn-chip', data: { lever: String(each.index), kind: each.lever.kind, trial: String(each.trial) } }, ...sentence(each), removeOf(each, view.kept.length + at, true))));
    const droppedAll = view.dropped.concat(view.droppedLevers);
    dropped.hidden = droppedAll.length === 0;
    droppedList.replaceChildren(...droppedAll.map((each) => h('li', { class: 'scn-dropped__item', data: { index: String(each.index) } }, h('span', { dir: 'auto' }, words(each.parts)))));
    removeDropped.textContent = droppedAll.length === 1 ? 'Remove it' : 'Remove them';
  }

  return {
    element,
    update,
    said(text) {
      status.textContent = text;
    },
    focusOpened() {
      if (!open.hidden && !openTitle.hidden) openTitle.focus();
      else this.focusName();
    },
    focusName() {
      if (!open.hidden) nameInput.focus();
      else startName.focus();
    },
  };
}
