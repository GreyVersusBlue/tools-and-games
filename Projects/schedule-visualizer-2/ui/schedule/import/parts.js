// What the Import tab's panels share: a panel with its heading, the button
// that asks for a file and reads it, the answer to groups whose names are
// already here, and the one way an import is run.

import { h, uid } from '../../components/dom.js';
import { count } from '../../components/words.js';
import { CLASH_POLICIES } from '../../../engine/import-groups.js';
import { button, keyed, quote } from '../common.js';

// panel('groups', 'Groups from a spreadsheet', ...children) -> a <section>
// labelled by its heading.
export function panel(id, title, ...children) {
  const titleId = uid('imp');
  return h('section', { class: 'imp-panel', 'aria-labelledby': titleId, data: { panel: id } },
    h('h2', { class: 'imp-panel__title', id: titleId }, title),
    children);
}

// The text of a file. A CSV that is not UTF-8 (a spreadsheet on Windows
// saving "CSV" rather than "CSV UTF-8") is read as Windows-1252, which is
// what such a file is; a file this tool wrote is always UTF-8.
export async function readText(file, loose) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (!loose) throw new Error('This file is not text this tool can read. Choose a file the tool exported.');
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// A button that asks for a file, with the <input type="file"> it stands for.
// onText(name, text) is called with the file's name and text.
//   options: { label, accept, key, kind, primary, csv, onText, onError }
export function fileButton(options) {
  const input = h('input', { type: 'file', accept: options.accept, hidden: true, tabindex: '-1', 'aria-hidden': 'true', data: { file: options.kind } });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    readText(file, options.csv === true).then((text) => options.onText(file.name, text), (error) => options.onError(file.name, error));
    // the same file chosen again is a change again
    input.value = '';
  });
  const opener = button(options.label, () => input.click(), { primary: options.primary, key: options.key, action: 'choose-' + options.kind });
  return [opener, input];
}

const CLASH_WORDS = {
  skip: 'Skip it',
  overwrite: 'Overwrite the group here',
  rename: 'Import it under a new name',
};

const CLASH_ALL_WORDS = {
  skip: 'Skip them: the groups here stay as they are',
  overwrite: 'Overwrite them: each group here keeps its identity and takes the file\'s rooms',
  rename: 'Import them under new names, beside the groups here',
};

// The answer to name clashes: once for all, and per group. `clashes` is a
// list of { key, name } (the group's name in the file); `policy` is
// { all, per, names } and is changed in place; `changed(key)` is called after
// every change with the key of the control to put focus back on.
export function clashChooser(prefix, clashes, policy, changed) {
  const legendId = uid('imp-clash');
  const all = h('fieldset', { class: 'imp-clash__all' },
    h('legend', { id: legendId }, clashes.length === 1
      ? 'One group in the file has the name of a group already here: ' + quote(clashes[0].name) + '. What should happen to it?'
      : count(clashes.length, 'group') + ' in the file have the names of groups already here. What should happen to them?'),
    CLASH_POLICIES.map((value) => {
      const key = prefix + ':all:' + value;
      const input = keyed(h('input', { type: 'radio', name: prefix + '-all', value }), key);
      input.checked = policy.all === value;
      input.addEventListener('change', () => {
        policy.all = value;
        changed(key);
      });
      return h('label', { class: 'imp-clash__option' }, input, h('span', null, clashes.length === 1 ? CLASH_WORDS[value] : CLASH_ALL_WORDS[value]));
    }));
  if (clashes.length === 1) return h('div', { class: 'imp-clash', data: { clash: prefix } }, all, renameField(prefix, clashes[0], policy, changed, policy.all));

  const rows = clashes.map((clash) => {
    const key = prefix + ':per:' + clash.key;
    const answer = Object.prototype.hasOwnProperty.call(policy.per, clash.key) ? policy.per[clash.key] : '';
    const select = keyed(h('select', { class: 'field__input', 'aria-label': 'What happens to ' + clash.name },
      h('option', { value: '' }, 'As chosen above'),
      CLASH_POLICIES.map((value) => h('option', { value }, CLASH_WORDS[value]))), key);
    select.value = answer;
    select.addEventListener('change', () => {
      if (select.value === '') delete policy.per[clash.key];
      else policy.per[clash.key] = select.value;
      changed(key);
    });
    return h('tr', { data: { clash: clash.key } },
      h('th', { scope: 'row' }, clash.name),
      h('td', null, select),
      h('td', null, renameField(prefix, clash, policy, changed, answer === '' ? policy.all : answer)));
  });
  return h('div', { class: 'imp-clash', data: { clash: prefix } }, all,
    h('div', { class: 'sch-scroll' }, h('table', { class: 'table imp-table' },
      h('caption', { class: 'vh' }, 'Groups already here, one by one'),
      h('thead', null, h('tr', null, ['Group', 'What happens', 'New name'].map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', null, rows))));
}

// The new name for one group, when its answer is "rename". Empty means the
// tool picks one ("7-1 (2)").
function renameField(prefix, clash, policy, changed, answer) {
  if (answer !== 'rename') return null;
  const key = prefix + ':name:' + clash.key;
  const input = keyed(h('input', {
    class: 'field__input',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: clash.name + ' (2)',
    'aria-label': 'New name for ' + clash.name + ' (leave empty and the tool adds a number)',
  }), key);
  input.value = Object.prototype.hasOwnProperty.call(policy.names, clash.key) ? policy.names[clash.key] : '';
  const commit = () => {
    const had = Object.prototype.hasOwnProperty.call(policy.names, clash.key) ? policy.names[clash.key] : '';
    if (input.value === had) return;
    if (input.value.trim() === '') delete policy.names[clash.key];
    else policy.names[clash.key] = input.value;
    changed(key);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit();
  });
  return input;
}

export function newPolicy() {
  return { all: 'skip', per: {}, names: {} };
}

// Ids for working out what an import would do, without using up any of the
// project's own. Nothing made with them is kept.
export function previewIds() {
  let n = 0;
  const make = (prefix) => {
    n += 1;
    return prefix + String(n).padStart(9, '0');
  };
  make.reserve = () => {};
  return make;
}

// Run an import: a recovery point first (spec 13.3), then the action, which
// is one undo entry. Returns { changed, outcome, label }, or null when the
// action refused (the refusal is shown as the sentence it gave).
export async function runImport(ctx, action, payload) {
  try {
    if (ctx.storage) await ctx.storage.takeRecoveryPoint('import');
  } catch (error) { /* storage has said so itself; the import is still one undo step */ }
  const before = ctx.store.project;
  try {
    ctx.store.apply(action, payload);
  } catch (error) {
    ctx.toast({ kind: 'problem', text: error && error.message ? error.message : 'That could not be imported. Try again.' });
    return null;
  }
  const changed = ctx.store.project !== before;
  return { changed, outcome: changed ? ctx.store.undoOutcome : null, label: changed ? ctx.store.undoLabel : '' };
}

// The line a panel keeps after an import, until another file is chosen.
export function doneLine(kind, done) {
  if (!done) return null;
  return h('p', { class: 'imp-done', data: { done: kind } }, done.text, done.link ? [' ', h('a', { href: done.link.href }, done.link.label)] : null);
}

// What a file said that stopped it being used.
export function refusal(kind, text) {
  if (!text) return null;
  return h('p', { class: 'imp-refusal', data: { refused: kind } }, text);
}
