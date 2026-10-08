// The Staff browser section. This is the stub: the sentence the screen opens with and
// what the project holds for it. The real screen replaces it.

import { h } from '../components/dom.js';
import { intro, NOT_BUILT } from '../components/card.js';
import { count, figures } from '../components/words.js';

function first(project) {
  return 'It is what your staff see: a published file they open on a phone to look up a teacher, a room or a group. Publish it once the schedule is in.';
}

function facts(project) {
  const f = figures(project);
  return project.publish.lastPublishedAt ? 'A file has been published from this project.' : 'Nothing has been published from this project yet. It has ' + count(f.teachers, 'teacher') + ' and ' + count(f.groups, 'group') + ' to show.';
}

export const section = {
  id: 'staff',
  label: 'Staff',
  name: 'Staff browser',
  key: '6',
  icon: 'staff',
  mount(ctx) {
    const element = h('div', { class: 'stub' });
    function update(project) {
      element.replaceChildren(intro({
        headline: 'This is the staff browser.',
        first: first(project),
        facts: facts(project),
        note: NOT_BUILT,
      }));
    }
    update(ctx.store.project);
    return { element, update };
  },
};
