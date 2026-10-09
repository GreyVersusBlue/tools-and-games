// The Travel time tab of the movement view's inspector. This is the placeholder:
// the tab is in the list and says what will be here. SV2-18 replaces this
// file and keeps the export.
//
//   tablesPanel(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js.

import { h } from '../components/dom.js';
import { NOT_BUILT } from '../components/card.js';

export function tablesPanel() {
  const element = h('div', { class: 'mov-panel', data: { panel: 'tables' } },
    h('h2', { class: 'mov-panel__title' }, 'Travel time'),
    h('p', null, 'How long each group walks and waits, transition by transition and over the day, slowest first.'),
    h('p', { class: 'mov-panel__note' }, NOT_BUILT));
  return { element, update() {} };
}
