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
// select of their labels and a Compare button. A kept project is read with
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
  async function compareRead(fileName, read, returnTo) {
    if (!env.mounted()) return;
    // what cannot be compared, against the project as it is now; another
    // building is refused by the action itself, in its own words
    let skipped = [];
    let another = null;
    try {
      skipped = scenarioFromDiff(ctx.store.project, read.project, { fileName }).skipped;
    } catch (error) {
      skipped = [];
      if (error && error.code === 'different-building') another = error.message;
    }
    if (another !== null) {
      sayAnother(fileName, read, another);
      return;
    }
    // a scenario is made now: a building comparison held gives way to it
    if (env.buildings().held()) env.buildings().stop({ say: false });
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
    const done = env.apply(setScenarioFromFile, { project: read.project, fileName, replace }, (message) => refused(quote(fileName) + ' was not compared, and nothing has changed. ' + message));
    if (!done) return;
    const scenario = ctx.store.project.scenario;
    memory.file = { compared: scenario.compared, skipped };
    say('Compared with ' + quote(fileName) + ': ' + count(scenario.changes.length, 'change') + '.' + (skipped.length > 0 ? ' ' + count(skipped.length, 'slot') + ' could not be compared; they are listed below.' : ''), 'done', scenario.compared);
    // the store drew the panel before this line was said: draw it for this scenario
    update({ compared: scenario.compared });
    ctx.announce(result.textContent);
  }

  // The refusal's sentence, and the way on: Compare the two buildings
  function sayAnother(fileName, read, message) {
    if (!env.mounted()) return;
    about = null;
    result.dataset.result = 'refused';
    const button = h('button', { type: 'button', class: 'btn', data: { action: 'compare-buildings' }, on: { click: () => compareBuildings(fileName, read, button) } }, 'Compare the two buildings');
    result.replaceChildren(
      h('p', { role: 'alert' }, quote(fileName) + ' was not compared as a scenario, and nothing has changed. ' + message + ' ' + ANOTHER_BUILDING_ON),
      button);
    ctx.announce(result.textContent);
  }

  async function compareBuildings(fileName, read, button) {
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    result.dataset.result = 'working';
    const working = h('p', { role: 'status' }, 'Comparing the two buildings…');
    result.replaceChildren(working);
    let answer;
    try {
      answer = await env.buildings().start({ project: read.project }, fileName);
    } catch (error) {
      answer = { ok: false, sentence: 'The two buildings could not be compared, and nothing has changed. ' + (error && error.message ? error.message : String(error)) };
    }
    if (!env.mounted()) return;
    if (answer.ok) {
      result.dataset.result = 'compared-buildings';
      result.replaceChildren(h('p', { role: 'status' }, 'Comparing with ' + quote(fileName) + ', another building. The band above the map says how to stop.'));
      env.buildings().focusSwitch();
      return;
    }
    if (answer.superseded) return;
    refused(answer.sentence);
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

  async function compareShelf() {
    const row = shelfRows.find((each) => each.id === shelfSelect.value);
    if (!row) return;
    const label = shelfLabel(row);
    shelfButton.setAttribute('aria-busy', 'true');
    let got;
    try {
      got = await ctx.storage.projects.read(row.id);
    } catch (error) {
      got = { ok: false, text: error && error.message ? error.message : String(error) };
    } finally {
      shelfButton.removeAttribute('aria-busy');
    }
    if (!env.mounted()) return;
    if (!got.ok) {
      refused(quote(label) + ' was not compared, and nothing has changed. ' + got.text);
      return;
    }
    await compareRead(label, { project: got.project }, shelfButton);
  }

  readShelf();

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
