// The Safety section. This is the stub: the sentence the screen opens with and
// what the project holds for it. The real screen replaces it.

import { h } from '../components/dom.js';
import { intro, NOT_BUILT } from '../components/card.js';
import { count, figures } from '../components/words.js';

function first(project) {
  return 'It shows the way out from every room to its nearest exit, and prints a door card for each room. Mark at least one exit on a corridor first.';
}

function facts(project) {
  const f = figures(project);
  return f.exits === 0 ? 'No exits are marked yet.' : 'There ' + (f.exits === 1 ? 'is ' : 'are ') + count(f.exits, 'exit') + ' for ' + count(f.rooms, 'room') + '.';
}

export const section = {
  id: 'safety',
  label: 'Safety',
  name: 'Safety',
  key: '5',
  icon: 'safety',
  mount(ctx) {
    const element = h('div', { class: 'stub' });
    function update(project) {
      element.replaceChildren(intro({
        headline: 'This is the safety section.',
        first: first(project),
        facts: facts(project),
        note: NOT_BUILT,
      }));
    }
    update(ctx.store.project);
    return { element, update };
  },
};
