// "Compare with another project file" (spec 9.3): a second project file of
// the same building (this year's against next year's proposal) read with the
// project file reader (engine/project-file.js, as the Project section reads
// one), then made into the scenario by setScenarioFromFile, which matches
// groups by name and refuses another building with the count of rooms that
// differ. What could not be compared (scenarioFromDiff's `skipped`) is the
// lab's to say: it is worked out here, kept in the lab's memory for the
// comparison it was made with (the scenario's `compared` object, which the
// scenario keeps through its edits), and listed under the button.
//
// Another building (SV2-123): a file or a kept project whose rooms differ is not
// a scenario. The refusal's sentence says so, and gains "You can still compare
// the two buildings" with the button "Compare the two buildings" (./buildings.js
// holds that comparison: view state, never saved). "Compare with another project
// on this device" is the same question asked of the projects kept on the shelf: a
// select of their labels and a Compare button, which compares another building at
// once (the person has already chosen it). A kept project is read with
// ctx.storage.projects.read(id), the same path open() reads it by; the same
// building makes the scenario as a file does, another building the comparison.
//
// filePanel(env) -> { element, update(view), focusHeading() }
//   env.ctx, env.memory (memory.file: { compared, skipped }),
//   env.apply(action, payload) (false when refused, and said in `say`),
//   env.mounted() (false once the section is off the page),
//   env.buildings() (the building comparison's panel, ./buildings.js)

import { h } from '../components/dom.js';
import { count } from '../components/words.js';
import { readProjectFile } from '../../engine/project-file.js';
import { scenarioFromDiff } from '../../engine/scenario.js';
import { setScenarioFromFile } from '../../engine/actions.js';
import { scenarioName } from './model.js';

export const ANOTHER_BUILDING_ON = 'You can still compare the two buildings: crowds, travel times and findings, matched by group and room names.';
export const SHELF_TITLE = 'Compare with another project on this device';

function quote(text) {
  return '“' + text + '”';
}

export function filePanel(env) {
  const ctx = env.ctx;
  const memory = env.memory;
  // what the last file came to: a refusal is an alert, as the Project section says one
  const result = h('div', { class: 'scn-file__result', data: { part: 'file-result' } });
  const groupsLine = h('p', { class: 'scn-file__groups', hidden: true, data: { part: 'file-groups' } });
  const skippedBox = h('details', { class: 'scn-file__skipped', hidden: true, data: { part: 'file-skipped' } });
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, tabindex: '-1', 'aria-hidden': 'true', data: { file: 'compare' } });
  const opener = h('button', { type: 'button', class: 'btn', data: { action: 'compare-file' }, on: { click: () => input.click() } }, 'Compare with another project file…');
  const heading = h('h2', { class: 'scn-panel__title', id: 'scenario-file-title', tabindex: '-1' }, 'Compare with another project file');
  // the projects kept on this device (the open one and unreadable ones left out)
  const shelfSelect = h('select', { class: 'field__input', id: 'scenario-shelf-project', data: { key: 'scenario-shelf-project' } });
  const shelfButton = h('button', { type: 'button', class: 'btn', data: { action: 'compare-shelf' }, on: { click: () => compareShelf() } }, 'Compare');
  const shelf = h('div', { class: 'scn-file__shelf', hidden: true, data: { part: 'shelf' } },
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'scenario-shelf-project' }, SHELF_TITLE), shelfSelect), shelfButton);
  const element = h('section', { class: 'scn-file', 'aria-labelledby': 'scenario-file-title' },
    heading,
    h('p', { class: 'scn-file__lead' }, 'A project file of this building, next year’s proposal say, becomes a scenario: every slot that differs is a change, groups matched by name.'),
    opener, input, shelf, result, groupsLine, skippedBox);

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const picked = file.text();
    // the same file chosen again is a change again
    input.value = '';
    picked.then((text) => compare(file.name, text), (error) => refused(quote(file.name) + ' could not be read. ' + (error && error.message ? error.message : '')));
  });

  // `about`: the compared object a result line describes; the line goes when
  // that is no longer the open scenario's (an Undo, a Discard)
  let about = null;
  function say(text, kind, compared) {
    if (!env.mounted()) return;
    about = compared || null;
    result.dataset.result = kind || 'said';
    result.replaceChildren(h('p', { role: kind === 'refused' ? 'alert' : 'status' }, text));
  }
  function refused(text) {
    say(text, 'refused');
  }

  async function compare(fileName, text) {
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      refused(quote(fileName) + ' was not compared, and nothing has changed. ' + (error && error.message ? error.message : ''));
      return;
    }
    await compareRead(fileName, read, opener);
  }

  // A project that has been read, from a file or from the shelf: the same
  // building makes the scenario, another building the comparison.
  // `direct`: a kept project was chosen and Compare pressed, so another building is
  // compared at once (a file first gets the refusal's sentence and its button).
  async function compareRead(fileName, read, returnTo, direct, owned) {
    if (!env.mounted()) return;
    // another building is not a scenario: the action refuses it in its own words
    let another = null;
    try {
      scenarioFromDiff(ctx.store.project, read.project, { fileName });
    } catch (error) {
      if (error && error.code === 'different-building') another = error.message;
    }
    if (another !== null) {
      if (direct) await compareBuildings(fileName, read, returnTo, owned);
      else sayAnother(fileName, read, another);
      return;
    }
    const project = ctx.store.project;
    let replace = false;
    if (project.scenario) {
      replace = await ctx.confirm({
        title: 'Replace the scenario ' + quote(scenarioName(project.scenario)) + ' with the comparison?',
        body: [h('p', null, 'The open scenario’s ' + count(project.scenario.changes.length, 'change') + ' give way to the differences in ' + quote(fileName) + '. Undo brings the scenario back while this tab stays open.')],
        action: 'Replace the scenario',
        keep: 'Keep the scenario',
        opener: returnTo,
      });
      // the section may have gone, or the project changed, while it asked
      if (!env.mounted()) return;
      if (!replace) {
        say(quote(fileName) + ' was read and not compared. Nothing has changed.');
        return;
      }
    }
    // a scenario is made now (the question, if there was one, is answered): a building
    // comparison held gives way to it, and the focus goes to this panel's heading
    if (env.buildings().held()) env.buildings().stop({ say: false, refocus: true });
    // what could not be compared, against the project as it is now that the question is answered
    let skipped = [];
    try {
      skipped = scenarioFromDiff(ctx.store.project, read.project, { fileName }).skipped;
    } catch (error) {
      skipped = [];
    }
    const done = env.apply(setScenarioFromFile, { project: read.project, fileName, replace }, (message) => refused(quote(fileName) + ' was not compared, and nothing has changed. ' + message));
    if (!done) return;
    const scenario = ctx.store.project.scenario;
    memory.file = { compared: scenario.compared, skipped };
    say('Compared with ' + quote(fileName) + ': ' + count(scenario.changes.length, 'change') + '.' + (skipped.length > 0 ? ' ' + count(skipped.length, 'slot') + ' could not be compared; they are listed below.' : ''), 'done', scenario.compared);
    // the store drew the panel before this line was said: draw it for this scenario
    update({ compared: scenario.compared });
  }

  // The refusal's sentence, and the way on: Compare the two buildings
  function sayAnother(fileName, read, message) {
    if (!env.mounted()) return;
    about = null;
    result.dataset.result = 'refused';
    const button = h('button', { type: 'button', class: 'btn', data: { action: 'compare-buildings' }, on: { click: () => compareBuildings(fileName, read, button) } }, 'Compare the two buildings');
    result.replaceChildren(
      h('p', { role: 'alert' }, quote(fileName) + ' was not compared, and nothing has changed. ' + message + ' ' + ANOTHER_BUILDING_ON),
      button);
  }

  // One press at a time: a press while one is being worked out (aria-busy, or aria-disabled
  // on the button) does nothing. The shelf's select and button are left alone meanwhile.
  let busy = false;
  function enter(button) {
    if (busy || button.getAttribute('aria-busy') === 'true' || button.getAttribute('aria-disabled') === 'true') return false;
    busy = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
    shelfSelect.inert = true;
    shelfButton.setAttribute('aria-busy', 'true');
    shelfButton.setAttribute('aria-disabled', 'true');
    if (document.activeElement !== shelfButton) shelfButton.inert = true;
    return true;
  }
  function leave(button) {
    busy = false;
    for (const each of [button, shelfButton]) {
      each.removeAttribute('aria-busy');
      each.removeAttribute('aria-disabled');
    }
    shelfSelect.inert = false;
    shelfButton.inert = false;
  }
  // the focus went with a control that is gone: to this panel's heading
  function keepFocus() {
    const at = document.activeElement;
    if (!at || at === document.body || !at.isConnected) heading.focus();
  }

  // `owned`: the caller (compareShelf) holds the press already
  async function compareBuildings(fileName, read, button, owned) {
    if (!owned && !enter(button)) return;
    try {
      result.dataset.result = 'working';
      // the line that was there stays (and the button that was pressed keeps its focus) while the answer is worked out
      for (const old of result.querySelectorAll('[data-part="working"]')) old.remove();
      result.append(h('p', { data: { part: 'working' } }, 'Comparing the two buildings…'));
      let answer;
      try {
        answer = await env.buildings().start({ project: read.project }, fileName);
      } catch (error) {
        answer = { ok: false, sentence: 'The two buildings could not be compared, and nothing has changed. ' + (error && error.message ? error.message : String(error)) };
      }
      if (!env.mounted()) return;
      if (answer.ok) {
        // the band's inspector says it aloud; this line is the panel's own record of it
        result.dataset.result = 'compared-buildings';
        result.replaceChildren(h('p', null, 'Comparing with ' + quote(fileName) + ', another building. The band above the map says how to stop.'));
        env.buildings().focusSwitch();
        return;
      }
      if (answer.superseded) return;
      refused(answer.sentence);
      keepFocus();
    } finally {
      if (!owned) leave(button);
    }
  }

  // ---- the projects kept on this device
  let shelfKey = '';
  let shelfRows = [];
  function shelfLabel(row) {
    return row.label || row.schoolName || 'Untitled project';
  }
  async function readShelf() {
    const storage = ctx.storage;
    if (!storage || !storage.projects || typeof storage.projects.list !== 'function') return;
    let rows = [];
    try {
      rows = await storage.projects.list();
    } catch (error) {
      rows = [];
    }
    if (!env.mounted()) return;
    shelfRows = rows.filter((row) => row && !row.open && !row.unreadable && typeof row.id === 'string');
    const key = JSON.stringify(shelfRows.map((row) => [row.id, shelfLabel(row)]));
    if (key !== shelfKey) {
      const chosen = shelfSelect.value;
      shelfKey = key;
      shelfSelect.replaceChildren(...shelfRows.map((row) => h('option', { value: row.id, title: shelfLabel(row) }, shelfLabel(row))));
      if (shelfRows.some((row) => row.id === chosen)) shelfSelect.value = chosen;
    }
    shelf.hidden = shelfRows.length === 0;
    shelf.dataset.count = String(shelfRows.length);
  }
  shelf.addEventListener('focusin', () => {
    readShelf();
  });
  // the rows follow the device's shelf: each change of the projects kept is read again
  if (ctx.storage && typeof ctx.storage.subscribe === 'function') {
    const off = ctx.storage.subscribe((state, what) => {
      if (!env.mounted()) {
        off();
        return;
      }
      if (what === 'projects' || what === 'switched' || what === 'ready') readShelf();
    });
  }

  async function compareShelf() {
    if (!enter(shelfButton)) return;
    try {
      const row = shelfRows.find((each) => each.id === shelfSelect.value);
      if (!row) {
        readShelf();
        return;
      }
      const label = shelfLabel(row);
      let got;
      try {
        got = await ctx.storage.projects.read(row.id);
      } catch (error) {
        got = { ok: false, text: error && error.message ? error.message : String(error) };
      }
      if (!env.mounted()) return;
      if (!got || !got.ok) {
        refused(quote(label) + ' was not compared, and nothing has changed. ' + (got && got.text ? got.text : 'It could not be read.'));
        // the row may be gone (deleted in another tab): the shelf is read again
        readShelf();
        return;
      }
      // only the project is used: the record's pictures stay where they are
      await compareRead(label, { project: got.project }, shelfButton, true, true);
    } finally {
      leave(shelfButton);
    }
  }

  readShelf();

  // a comparison ended: Stop comparing says so here (this line is a status, the page's one voice for it);
  // the line that said it was held goes either way
  env.buildings().onEnd(({ name, why, say: speak }) => {
    if (!env.mounted()) return;
    if (why === 'stop' && speak) say('Stopped comparing with ' + name + '.', 'stopped');
    else if (result.dataset.result === 'compared-buildings') {
      delete result.dataset.result;
      result.replaceChildren();
    }
  });

  function update(view) {
    const compared = view && view.compared ? view.compared : null;
    groupsLine.hidden = !compared;
    if (compared) {
      const added = compared.addedGroups || [];
      const removed = compared.removedGroups || [];
      const parts = ['From ', h('bdi', null, compared.fileName || 'another file'), '. '];
      if (added.length === 0 && removed.length === 0) parts.push('Both files have the same groups.');
      if (added.length > 0) parts.push('Added there (only in that file): ', ...names(added), '. ');
      if (removed.length > 0) parts.push('Removed there (only in this project): ', ...names(removed), '.');
      groupsLine.replaceChildren(...parts);
      groupsLine.dataset.added = String(added.length);
      groupsLine.dataset.removed = String(removed.length);
    }
    // a result line about a comparison that is no longer open goes
    if (about && about !== compared) {
      about = null;
      delete result.dataset.result;
      result.replaceChildren();
    }
    // the slots that could not be compared, while the scenario is the one made
    // from the file (its comparison, kept as the same object through its edits)
    const kept = memory.file && compared && memory.file.compared === compared ? memory.file : null;
    const skipped = kept ? kept.skipped : [];
    skippedBox.hidden = skipped.length === 0;
    if (skipped.length > 0) {
      skippedBox.replaceChildren(h('summary', null, count(skipped.length, 'slot') + ' could not be compared'),
        h('ul', null, skipped.map((each) => h('li', { dir: 'auto', data: { reason: each.reason } }, each.sentence))));
    }
  }

  function names(items) {
    const out = [];
    items.forEach((name, i) => {
      if (i > 0) out.push(i === items.length - 1 ? ' and ' : ', ');
      out.push(h('bdi', null, name));
    });
    return out;
  }

  return { element, update, focusHeading: () => heading.focus() };
}
