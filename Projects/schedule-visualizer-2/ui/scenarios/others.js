// The Other scenarios strip (spec 9.3; DESIGN 15.6, 15.9 items 7, 10, 11): the
// scenarios that are kept and not open, one row each, "Stagger 8th grade ·
// 4 changes", with its two messages when they are true ("1 change is already
// in the schedule", "2 changes no longer apply") and four visible buttons:
// Switch to, Duplicate, Rename…, Delete…. No menu, nothing that needs a
// pointer, nothing that scrolls sideways: on a phone the buttons wrap under
// the name. With no scenario kept the strip is hidden.
//
// Each row is a list item; its buttons carry aria-describedby the row's line,
// so a screen reader hears "Switch to, Stagger 8th grade, 4 changes". A
// button that cannot be used (Duplicate at the limit of twelve) is
// aria-disabled with the reason as its description, and stays focusable.
//
// Focus (15.9 item 11): after Delete, the next row's first button, else the
// previous row's, else the strip's heading when rows are left, else the open
// scenario's name (or the start field when none is open); after Switch to,
// the newly open scenario's name (a heading with tabindex -1, in changes.js).
//
// othersPanel(env) -> { element, update(project), said(text), focusHeading() }
//   env.ctx, env.project(), env.apply(action, payload, onRefuse) (false when
//   refused; says the refusal itself unless onRefuse is given), env.memory
//   (memory.compareWith: the id of the kept scenario the comparison's Before
//   side is, or null), env.focusOpened() (the open scenario's name heading),
//   env.home() (the panel's first control).
//
// Everything written goes through the scenario actions (engine/actions.js);
// nothing here is stored.

import { h } from '../components/dom.js';
import { openScenario, duplicateScenario, renameScenario, deleteScenario } from '../../engine/actions.js';
import { otherRows, rowCount, rowMessages, fullWords, scenarioName, switchedSentence, SWITCHED_TO_COMPARED } from './model.js';

const NOT_KEPT = 'That scenario is not among the kept scenarios any more. It may have been deleted or opened, so it was not renamed.';
const GONE = 'That scenario is already gone.';
const ACTIONS = [
  { id: 'switch', label: 'Switch to' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'rename', label: 'Rename…' },
  { id: 'delete', label: 'Delete…' },
];

export function othersPanel(env) {
  const ctx = env.ctx;
  const title = h('h2', { class: 'scn-panel__title scn-others__title', id: 'scenario-others-title', tabindex: '-1', data: { part: 'others-title' } }, 'Other scenarios');
  // the visible line; the page's one live region (ctx.announce) says it aloud
  const status = h('p', { class: 'scn-others__status', data: { part: 'others-status' } });
  const list = h('ul', { class: 'scn-others__list', 'aria-labelledby': 'scenario-others-title', data: { part: 'others-list' } });
  const full = h('p', { class: 'scn-others__full', id: 'scenario-others-full', hidden: true, data: { part: 'others-full' } });
  const element = h('section', { class: 'scn-others', hidden: true, 'aria-labelledby': 'scenario-others-title', data: { part: 'others' } }, title, status, list, full);

  // the rows on screen, by the key of their scenario: { li, line, name, count, messages, buttons }
  const shown = new Map();
  let rows = [];
  let n = 0;

  function keyOf(row, index) {
    return row.id === null ? '#' + index : row.id;
  }

  function make(row, index) {
    n += 1;
    const lineId = 'scenario-other-' + n;
    const name = h('bdi', { class: 'scn-other__name' });
    const countText = h('span', { class: 'scn-other__count' });
    const line = h('p', { class: 'scn-other__line', id: lineId }, name, ' · ', countText);
    const messages = h('div', { class: 'scn-other__messages' });
    const buttons = {};
    const bar = h('div', { class: 'scn-other__buttons' });
    for (const each of ACTIONS) {
      const button = h('button', { type: 'button', class: 'btn scn-other__button', 'aria-describedby': lineId, data: { action: 'other-' + each.id } }, each.label);
      button.addEventListener('click', () => act(each.id, keyOf(row, index), button));
      buttons[each.id] = button;
      bar.append(button);
    }
    const li = h('li', { class: 'scn-other', data: { scenario: row.id === null ? '' : row.id } }, line, messages, bar);
    return { li, lineId, line, name, countText, messages, buttons };
  }

  // the row's current scenario, by the key it was made for: rows are matched
  // by id (a scenario an older file left without one by its place)
  function rowFor(key) {
    return rows.find((row, index) => keyOf(row, index) === key) || null;
  }

  function fill(entry, row) {
    entry.name.textContent = row.name;
    entry.countText.textContent = rowCount(row);
    const said = rowMessages(row);
    const had = Array.from(entry.messages.children).map((el) => el.dataset.message + ':' + el.textContent).join('|');
    if (had !== said.map((each) => each.id + ':' + each.text).join('|')) {
      entry.messages.replaceChildren(...said.map((each) => h('p', { class: 'scn-other__message', id: entry.lineId + '-' + each.id, data: { message: each.id } }, each.text)));
    }
    // the label line first, then the row's messages (15.10: "aria-describedby on a row button")
    const describedBy = [entry.lineId, ...said.map((each) => entry.lineId + '-' + each.id)].join(' ');
    entry.buttons.switch.setAttribute('aria-describedby', describedBy);
    entry.buttons.rename.setAttribute('aria-describedby', describedBy);
    entry.buttons.delete.setAttribute('aria-describedby', describedBy);
    // Duplicate at the limit: said and focusable, never silent (15.9 item 15)
    const why = fullWords(env.project());
    entry.buttons.duplicate.setAttribute('aria-describedby', why ? describedBy + ' scenario-others-full' : describedBy);
    if (why) entry.buttons.duplicate.setAttribute('aria-disabled', 'true');
    else entry.buttons.duplicate.removeAttribute('aria-disabled');
  }

  // where the focus is, as a row and a button, so that a drawing that keeps
  // the row keeps the focus on its button
  function focusedButton() {
    const active = document.activeElement;
    if (!active || !list.contains(active)) return null;
    for (const [key, entry] of shown) for (const [id, button] of Object.entries(entry.buttons)) if (button === active) return { key, id };
    return null;
  }

  function update(project) {
    rows = otherRows(project);
    element.hidden = rows.length === 0;
    const held = focusedButton();
    const keys = rows.map((row, index) => keyOf(row, index));
    for (const key of Array.from(shown.keys())) {
      if (keys.includes(key)) continue;
      shown.get(key).li.remove();
      shown.delete(key);
    }
    rows.forEach((row, index) => {
      const key = keys[index];
      if (!shown.has(key)) shown.set(key, make(row, index));
      fill(shown.get(key), row);
    });
    // reordered only when the order differs: a node moved loses its focus
    const now = Array.from(list.children);
    const want = keys.map((key) => shown.get(key).li);
    if (now.length !== want.length || now.some((li, i) => li !== want[i])) list.replaceChildren(...want);
    const why = fullWords(project);
    full.hidden = !why;
    full.textContent = why || '';
    if (held && shown.has(held.key) && document.activeElement !== shown.get(held.key).buttons[held.id]) shown.get(held.key).buttons[held.id].focus();
  }

  function say(text) {
    status.textContent = text;
    ctx.announce(text);
  }

  function refusal(error) {
    status.textContent = error.message;
    ctx.toast({ kind: 'problem', text: error.message });
  }

  function act(id, key, button) {
    const row = rowFor(key);
    if (!row) return;
    if (id === 'switch') return switchTo(row);
    if (id === 'duplicate') return duplicate(row, button);
    if (id === 'rename') return rename(row, button);
    return remove(row, key, button);
  }

  // a row's scenario is still kept (not deleted, not opened) in the project now
  function stillKept(row) {
    const list = Array.isArray(env.project().scenarios) ? env.project().scenarios : [];
    return row.id === null || list.some((scenario) => scenario && scenario.id === row.id);
  }

  function gone() {
    say(GONE);
  }

  // ---- Switch to: one step of undo; the open scenario (if any) takes this
  // one's place in the list
  function switchTo(row) {
    const project = env.project();
    const was = project.scenario ? scenarioName(project.scenario) : null;
    const comparing = row.id !== null && env.memory.compareWith === row.id;
    if (!stillKept(row)) return gone();
    if (!env.placeFocus(() => env.apply(openScenario, { id: row.id }, (message) => refusal({ message })))) return;
    // the comparison's other side was this one: it is now the open scenario,
    // so the comparison goes back to the real schedule (15.9 item 8)
    if (comparing) env.resetCompare();
    const text = switchedSentence(row.name, was) + (comparing ? ' ' + SWITCHED_TO_COMPARED : '');
    status.textContent = text;
    ctx.announce(text);
    env.focusOpened();
  }

  // ---- Duplicate: a copy right after its source, named "<name> (copy)"
  function duplicate(row, button) {
    const why = fullWords(env.project());
    if (why) {
      status.textContent = why;
      ctx.announce(why);
      return;
    }
    if (!stillKept(row)) return gone();
    const before = env.project();
    if (!env.apply(duplicateScenario, { id: row.id }, (message) => refusal({ message }))) return;
    // the copy is the scenario that was not there before (by its id)
    const had = new Set((Array.isArray(before.scenarios) ? before.scenarios : []).map((scenario) => scenario && scenario.id));
    const copy = (Array.isArray(env.project().scenarios) ? env.project().scenarios : []).find((scenario) => scenario && !had.has(scenario.id));
    say('Duplicated ' + row.name + (copy ? ' as ' + scenarioName(copy) : '') + '.');
    if (button.isConnected) button.focus();
  }

  // ---- Rename…: a dialog with the name in a field; a refusal ("Another
  // scenario is called…") is said in the dialog, which comes back with what
  // was typed
  async function rename(row, opener) {
    let typed = row.name;
    let problem = '';
    for (;;) {
      const input = h('input', { class: 'field__input', id: 'scenario-rename-input', type: 'text', autocomplete: 'off', spellcheck: 'false', value: typed, data: { key: 'scenario-rename' } });
      const note = h('p', { class: 'field__error', role: 'alert', hidden: problem === '', data: { part: 'rename-problem' } }, problem);
      const body = h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'scenario-rename-input' }, 'Name'), input, note);
      const dialog = ctx.openDialog({
        title: 'Rename the scenario ' + '“' + row.name + '”',
        body,
        id: 'scenario-rename',
        opener,
        buttons: [{ label: 'Rename', value: 'rename', kind: 'primary' }, { label: 'Cancel', value: null }],
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          dialog.close('rename');
        }
      });
      input.focus();
      input.select();
      const answer = await dialog.closed;
      if (answer !== 'rename') return;
      typed = input.value;
      // gone while the dialog stood open (deleted, or opened: a rename would then rename the open one)
      if (!stillKept(row)) return notKept();
      let refused = null;
      env.apply(renameScenario, { id: row.id, name: typed }, (message) => {
        refused = message;
      });
      if (refused === null) {
        // renamed, or the same name typed again (nothing to say)
        if (typed.trim() !== row.name) say('Renamed to ' + typed.trim() + '.');
        return;
      }
      problem = refused;
    }
  }

  // the dialog is closed and the row's scenario is not among the kept ones now
  function notKept() {
    say(NOT_KEPT);
  }

  // ---- Delete…: asks first
  async function remove(row, key, opener) {
    const ok = await ctx.confirm({
      title: 'Delete the scenario “' + row.name + '”?',
      body: [h('p', null, 'Its ' + rowCount(row) + (row.total === 1 ? ' goes' : ' go') + ', and the real schedule stays as it is. Undo brings the scenario back while this tab stays open.')],
      action: 'Delete the scenario',
      keep: 'Keep the scenario',
      danger: true,
      opener,
    });
    if (!ok) return;
    const index = rows.findIndex((each, at) => keyOf(each, at) === key);
    // gone while the question stood open (deleted, or opened, which takes its
    // row out of the strip: the engine would then delete the open scenario)
    if (index === -1) {
      gone();
      if (!opener.isConnected) env.home();
      return;
    }
    const comparing = row.id !== null && env.memory.compareWith === row.id;
    if (!env.placeFocus(() => env.apply(deleteScenario, { id: row.id }, (message) => refusal({ message })))) return;
    if (comparing) env.resetCompare('gone');
    const left = rows.length;
    // the drawing has made the rows again (the store tells the section at once)
    const next = list.children[Math.min(index, left - 1)];
    const text = 'Deleted ' + row.name + '.' + (comparing ? ' The scenario you were comparing with is gone, so it is now compared with the real schedule.' : '');
    status.textContent = text;
    ctx.announce(text);
    const first = next ? next.querySelector('button') : null;
    if (first) first.focus();
    else env.home();
  }

  return {
    element,
    update,
    said(text) {
      status.textContent = text;
    },
    focusHeading() {
      if (!element.hidden) title.focus();
    },
    count: () => rows.length,
  };
}
