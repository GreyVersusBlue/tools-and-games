// The Export tab of the movement view's inspector. This is the placeholder:
// the tab is in the list and says what will be here. SV2-18 replaces this
// file and keeps the export.
//
//   exportPanel(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js.

import { h } from '../components/dom.js';
import { NOT_BUILT } from '../components/card.js';

export function exportPanel() {
  const element = h('div', { class: 'mov-panel', data: { panel: 'export' } },
    h('h2', { class: 'mov-panel__title' }, 'Export'),
    h('p', null, 'The picture as an image or a print, the tables as CSV, and the congestion report.'),
    h('p', { class: 'mov-panel__note' }, NOT_BUILT));
  return { element, update() {} };
}
