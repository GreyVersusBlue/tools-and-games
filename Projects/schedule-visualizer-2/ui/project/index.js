// The Project section: a page of cards. This unit brings three of them:
// Settings, Sample school, and About and help. The cards about saving, files,
// snapshots, recovery points, sending and clearing join the list as they are
// built, in the order of DESIGN 5.7.

import { h } from '../components/dom.js';
import { figures } from '../components/words.js';
import { savedCard } from './saved.js';
import { recoveryCard } from './recovery.js';
import { settingsCard } from './settings.js';
import { sampleCard } from './sample.js';
import { aboutCard } from './about.js';

// The cards, top to bottom. Each is a function (ctx) -> { element, update(project) }.
export const CARDS = [savedCard, recoveryCard, settingsCard, sampleCard, aboutCard];

const FIGURES = [
  ['floors', 'Floors'],
  ['rooms', 'Rooms'],
  ['teachers', 'Teachers'],
  ['groups', 'Groups'],
  ['subjects', 'Subjects'],
  ['dayTypes', 'Day types'],
  ['exits', 'Exits'],
];

export const section = {
  id: 'project',
  label: 'Project',
  name: 'Project',
  key: '7',
  icon: 'project',
  page: true,
  mount(ctx) {
    const strip = h('dl', { class: 'figures' });
    const first = h('p', { class: 'intro__first' });
    const cards = CARDS.map((make) => make(ctx));
    const element = h('div', { class: 'page' },
      h('div', { class: 'intro intro--page' }, h('h1', { class: 'intro__headline' }, 'This is the project.'), first),
      strip,
      cards.map((each) => each.element),
    );
    function update(project) {
      const f = figures(project);
      first.textContent = 'One school: its building, its schedule and its settings. '
        + (project.settings.schoolName === '' ? 'It has no school name yet; set one below.' : 'This one is ' + project.settings.schoolName + '.');
      strip.replaceChildren(...FIGURES.map(([key, label]) => h('div', { class: 'figures__item', data: { figure: key } }, h('dt', null, label), h('dd', null, String(f[key])))));
      for (const each of cards) each.update(project);
    }
    update(ctx.store.project);
    return { element, update };
  },
};
