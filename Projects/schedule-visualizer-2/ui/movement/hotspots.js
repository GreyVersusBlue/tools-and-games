// The Hotspots tab of the movement view's inspector. This is the placeholder:
// the tab is in the list and says what will be here. SV2-18 replaces this
// file and keeps the export.
//
//   hotspotsPanel(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js.

import { h } from '../components/dom.js';
import { NOT_BUILT } from '../components/card.js';

export function hotspotsPanel() {
  const element = h('div', { class: 'mov-panel', data: { panel: 'hotspots' } },
    h('h2', { class: 'mov-panel__title' }, 'Hotspots'),
    h('p', null, 'The busiest places, ranked: where, how many, in which transition, which groups, and the delay there.'),
    h('p', { class: 'mov-panel__note' }, NOT_BUILT));
  return { element, update() {} };
}
