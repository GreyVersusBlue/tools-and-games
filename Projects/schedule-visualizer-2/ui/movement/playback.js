// The playback bar along the bottom of the movement view (DESIGN 5.3). This
// is the placeholder: the bar's place is kept and says what will be here.
// SV2-19 replaces this file and keeps the export.
//
//   playbackBar(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js. The bar's height
// is whatever its contents take; the map gives it the room.

import { h } from '../components/dom.js';

export function playbackBar() {
  const element = h('div', { class: 'mov-bar', role: 'group', 'aria-label': 'Playback', data: { bar: 'playback' } },
    h('p', { class: 'mov-bar__note' }, 'Playback is still being built: it will walk each group along its route, one transition at a time.'));
  return { element, update() {} };
}
