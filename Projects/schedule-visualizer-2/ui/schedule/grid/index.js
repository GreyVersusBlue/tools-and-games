// The Grid tab. A placeholder: the grid editor replaces this file. What a tab
// of the schedule is, is said at the top of ui/schedule/index.js.

import { h } from '../../components/dom.js';
import { periodWords } from '../../components/words.js';

export function mount(env) {
  const element = h('div', { class: 'sch-coming', data: { coming: 'grid' } });
  function draw(project) {
    const words = periodWords(project.settings);
    element.replaceChildren(
      h('p', { class: 'sch-lead' }, 'The grid shows every group against every ' + words.one + ', like a spreadsheet. Type room numbers straight in, or paste a block from a spreadsheet.'),
      h('p', { class: 'sch-hint' }, 'The grid is coming. Until it is here, each group’s rooms are entered in the Groups tab.'));
  }
  draw(env.ctx.store.project);
  return { element, update: draw };
}
