// The Movement section. This is the stub: the sentence the screen opens with and
// what the project holds for it. The real screen replaces it.

import { h } from '../components/dom.js';
import { intro, NOT_BUILT } from '../components/card.js';
import { count, figures, periodWords } from '../components/words.js';

function first(project) {
  const one = periodWords(project.settings).one;
  return 'It draws every group’s walk between one ' + one + ' and the next, so you can see where the corridors fill and who cannot make it in time. Draw the building and give a group its rooms first.';
}

function facts(project) {
  const f = figures(project);
  if (f.groups === 0 || f.rooms === 0) return 'There is nothing to draw yet: this project has ' + count(f.rooms, 'room') + ' and ' + count(f.groups, 'group') + '.';
  return 'There ' + (f.groups === 1 ? 'is ' : 'are ') + count(f.groups, 'group') + ' to follow across ' + count(f.floors, 'floor') + '.';
}

export const section = {
  id: 'movement',
  label: 'Movement',
  name: 'Movement',
  key: '3',
  icon: 'movement',
  mount(ctx) {
    const element = h('div', { class: 'stub' });
    function update(project) {
      element.replaceChildren(intro({
        headline: 'This is the movement view.',
        first: first(project),
        facts: facts(project),
        note: NOT_BUILT,
      }));
    }
    update(ctx.store.project);
    return { element, update };
  },
};
