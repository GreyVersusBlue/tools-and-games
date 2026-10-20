// The Project section: a page of cards, top to bottom, in the order of
// DESIGN 5.7: Saved on this device, Project file, Snapshots, Recovery points,
// Settings, Clear…, Sample school, and About and help. The card for sending
// to another device joins the list when it is built, after Recovery points.
//
// start(ctx), at boot, makes the page's snapshots (storage/snapshots.js), so
// any section can take an automatic one before the Project section is open.

import { h } from '../components/dom.js';
import { figures } from '../components/words.js';
import { savedCard } from './saved.js';
import { filesCard } from './files.js';
import { snapshotsCard } from './snapshots.js';
import { recoveryCard } from './recovery.js';
import { transferCard } from './transfer/index.js';
import { settingsCard } from './settings.js';
import { sampleCard } from './sample.js';
import { clearCard } from './clear.js';
import { aboutCard } from './about.js';
import { startSnapshots } from '../../storage/snapshots.js';

// The cards, top to bottom. Each is a function (ctx) -> { element, update(project) }.
export const CARDS = [savedCard, filesCard, snapshotsCard, recoveryCard, transferCard, settingsCard, clearCard, sampleCard, aboutCard];

// The section's own stylesheet. index.html may link it (with data-sheet,
// which is how it is found here); this adds it on a page that does not.
const SHEET = new URL('./project.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="project"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'project' } }));
}

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
  start(ctx) {
    startSnapshots(ctx);
  },
  mount(ctx) {
    loadSheet();
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
