// The Import tab. A placeholder: the import and export screens replace this
// file. What a tab of the schedule is, is said at the top of
// ui/schedule/index.js.

import { h } from '../../components/dom.js';

export function mount() {
  const element = h('div', { class: 'sch-coming', data: { coming: 'import' } },
    h('p', { class: 'sch-lead' }, 'Import brings groups and teachers in from a spreadsheet saved as CSV, and the schedule from a file this tool wrote.'),
    h('p', { class: 'sch-hint' }, 'Import is coming. Until it is here, groups and teachers are added in their own tabs.'));
  return { element, update() {} };
}
