// The Import tab: bring groups, teachers and subjects in from a spreadsheet
// saved as CSV, the schedule from a schedule file, and send any of them out.
// What a tab of the schedule is, is said at the top of ui/schedule/index.js.
//
// What has been chosen and answered so far is kept in `env.view.imports`, so
// it outlives the tab being drawn again and a visit to another tab: a file
// stays read, with its column choices, until it is imported or put away.
// Nothing in the project changes before an import button is pressed, and
// each import is one undo step.

import { h } from '../../components/dom.js';
import { fill } from '../common.js';
import { groupsPanel } from './groups.js';
import { teachersPanel, subjectsPanel } from './lists.js';
import { schedulePanel } from './schedule-file.js';
import { exportsPanel } from './exports.js';

// The tab's own stylesheet, asked for once.
const SHEET = new URL('./import.css', import.meta.url).href;
function loadSheet() {
  if (document.querySelector('link[data-sheet="import"]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: SHEET, data: { sheet: 'import' } }));
}

export function mount(env) {
  loadSheet();
  if (!env.view.imports) env.view.imports = { groups: null, teachers: null, subjects: null, schedule: null, done: {}, refused: {} };
  const state = env.view.imports;
  const element = h('div', { class: 'imp' });
  const panels = [groupsPanel, teachersPanel, subjectsPanel, schedulePanel, exportsPanel].map((make) => make(env, state));

  function draw(project) {
    fill(element,
      h('p', { class: 'sch-lead' }, 'Import brings groups, teachers and subjects in from a spreadsheet saved as CSV, and the schedule from a file this tool wrote. Every file is checked first and shown to you; nothing changes until you press its import button, and one undo takes an import back.'),
      panels.map((each) => each.draw(project)));
  }

  draw(env.ctx.store.project);
  return { element, update: draw };
}
