// The Building section. This is the stub: the sentence the screen opens with
// and what the project holds. The drawing surface, the tool strip, the floor
// tabs and the inspector replace it.

import { h } from '../components/dom.js';
import { intro, NOT_BUILT } from '../components/card.js';
import { count, figures, list } from '../components/words.js';

function facts(project) {
  const f = figures(project);
  if (f.rooms === 0 && f.exits === 0 && f.floors === 1) return 'Nothing is drawn yet. ' + project.building.floors[0].name + ' is ' + project.building.floors[0].width + ' × ' + project.building.floors[0].height + ' squares.';
  return 'So far: ' + list([count(f.floors, 'floor'), count(f.rooms, 'room'), count(f.otherSpaces, 'other space'), count(f.connections, 'stairs connection'), count(f.exits, 'exit')]) + '.';
}

export const section = {
  id: 'building',
  label: 'Building',
  name: 'Building',
  key: '1',
  icon: 'building',
  mount(ctx) {
    const element = h('div', { class: 'stub' });
    function update(project) {
      element.replaceChildren(intro({
        headline: 'This is the building.',
        first: 'Draw a corridor, then rooms along it. Give each room its number, and mark the stairs and the exits.',
        facts: facts(project),
        note: NOT_BUILT,
      }));
    }
    update(ctx.store.project);
    return { element, update };
  },
};
