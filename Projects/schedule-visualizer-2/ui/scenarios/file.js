// "Compare with another project file" (spec 9.3): a second project file of
// the same building (this year's against next year's proposal) read with the
// project file reader (engine/project-file.js, as the Project section reads
// one), then made into the scenario by setScenarioFromFile, which matches
// groups by name and refuses another building with the count of rooms that
// differ. What could not be compared (scenarioFromDiff's `skipped`) is the
// lab's to say: it is worked out here, kept in the lab's memory for the
// scenario it was made with, and listed under the button.
//
// filePanel(env) -> { element, update(view) }
//   env.ctx, env.memory (memory.file: { fileName, skipped }),
//   env.apply(action, payload) (false when refused, and said in `say`)

import { h } from '../components/dom.js';
import { count } from '../components/words.js';
import { readProjectFile } from '../../engine/project-file.js';
import { scenarioFromDiff } from '../../engine/scenario.js';
import { setScenarioFromFile } from '../../engine/actions.js';
import { scenarioName } from './model.js';

function quote(text) {
  return '“' + text + '”';
}

export function filePanel(env) {
  const ctx = env.ctx;
  const memory = env.memory;
  const result = h('p', { class: 'scn-file__result', role: 'status', data: { part: 'file-result' } });
  const groupsLine = h('p', { class: 'scn-file__groups', hidden: true, data: { part: 'file-groups' } });
  const skippedBox = h('details', { class: 'scn-file__skipped', hidden: true, data: { part: 'file-skipped' } });
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, tabindex: '-1', 'aria-hidden': 'true', data: { file: 'compare' } });
  const opener = h('button', { type: 'button', class: 'btn', data: { action: 'compare-file' }, on: { click: () => input.click() } }, 'Compare with another project file…');
  const element = h('section', { class: 'scn-file', 'aria-labelledby': 'scenario-file-title' },
    h('h3', { class: 'scn-panel__title', id: 'scenario-file-title' }, 'Compare with another project file'),
    h('p', { class: 'scn-file__lead' }, 'A project file of this building, next year’s proposal say, becomes a scenario: every slot that differs is a change, groups matched by name.'),
    opener, input, result, groupsLine, skippedBox);

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const picked = file.text();
    // the same file chosen again is a change again
    input.value = '';
    picked.then((text) => compare(file.name, text), (error) => say(quote(file.name) + ' could not be read. ' + (error && error.message ? error.message : '')));
  });

  function say(text) {
    result.textContent = text;
  }

  async function compare(fileName, text) {
    let read;
    try {
      read = readProjectFile(text, { ids: ctx.ids, clock: ctx.clock });
    } catch (error) {
      say(quote(fileName) + ' was not compared, and nothing has changed. ' + (error && error.message ? error.message : ''));
      return;
    }
    const project = ctx.store.project;
    // what cannot be compared, said before anything changes; another
    // building is refused by the action itself, in its own words
    let skipped = [];
    try {
      skipped = scenarioFromDiff(project, read.project, { fileName }).skipped;
    } catch (error) {
      skipped = [];
    }
    let replace = false;
    if (project.scenario) {
      replace = await ctx.confirm({
        title: 'Replace the scenario ' + quote(scenarioName(project.scenario)) + ' with the comparison?',
        body: [h('p', null, 'The open scenario’s ' + count(project.scenario.changes.length, 'change') + ' give way to the differences in ' + quote(fileName) + '. Undo brings the scenario back while this tab stays open.')],
        action: 'Replace the scenario',
        keep: 'Keep the scenario',
        opener,
      });
      if (!replace) {
        say(quote(fileName) + ' was read and not compared. Nothing has changed.');
        return;
      }
    }
    const done = env.apply(setScenarioFromFile, { project: read.project, fileName, replace }, (message) => say(quote(fileName) + ' was not compared, and nothing has changed. ' + message));
    if (!done) return;
    const scenario = ctx.store.project.scenario;
    memory.file = { fileName, skipped };
    say('Compared with ' + quote(fileName) + ': ' + count(scenario.changes.length, 'change') + '.' + (skipped.length > 0 ? ' ' + count(skipped.length, 'slot') + ' could not be compared; they are listed below.' : ''));
    ctx.announce(result.textContent);
  }

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
    // the slots that could not be compared, while the scenario is the one made from the file
    const kept = memory.file && compared && memory.file.fileName === compared.fileName ? memory.file : null;
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

  return { element, update };
}
