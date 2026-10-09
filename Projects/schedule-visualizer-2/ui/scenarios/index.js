// The Scenarios section. This is the stub: the sentence the screen opens with and
// what the project holds for it. The real screen replaces it.

import { h } from '../components/dom.js';
import { intro, NOT_BUILT } from '../components/card.js';
import { count, figures } from '../components/words.js';

function first(project) {
  return 'Try a change to the schedule here: move a group, swap two rooms. See what it does to the corridors, then apply it or discard it. The real schedule is not touched until you apply.';
}

function facts(project) {
  const f = figures(project);
  if (project.scenario) return 'A scenario is open: ' + project.scenario.name + ', with ' + count(project.scenario.changes.length, 'change') + '.';
  return f.groups === 0 ? 'A scenario needs a schedule to change. Add groups first.' : 'No scenario is open.';
}

export const section = {
  id: 'scenarios',
  label: 'Scenarios',
  name: 'Scenarios',
  key: '4',
  icon: 'scenarios',
  mount(ctx) {
    const element = h('div', { class: 'stub' });
    function update(project) {
      element.replaceChildren(intro({
        headline: 'This is the scenario lab.',
        first: first(project),
        facts: facts(project),
        note: NOT_BUILT,
      }));
    }
    update(ctx.store.project);
    return { element, update };
  },
};
