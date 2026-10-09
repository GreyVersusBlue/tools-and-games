// The About and help card.

import { h } from '../components/dom.js';
import { card } from '../components/card.js';
import { CURRENT_VERSION } from '../../engine/schema.js';

export function aboutCard(ctx) {
  const help = h('button', { type: 'button', class: 'btn', data: { action: 'help' }, on: { click: () => ctx.openHelp(help) } }, 'Keyboard shortcuts');
  const start = h('button', { type: 'button', class: 'btn', data: { action: 'show-getting-started' }, on: { click: () => ctx.showGettingStarted() } }, 'Show Getting started');
  const element = card({ id: 'about', title: 'About and help' },
    h('p', { class: 'card__lead' }, 'Schedule Visualizer 2 is a planning tool for a school: draw the building, enter who is where each period, and see how the corridors fill between them.'),
    h('p', null, 'It runs entirely in this browser. Nothing you enter is sent anywhere, and the page asks no other site for anything.'),
    h('div', { class: 'card__buttons' }, help, start),
    h('p', { class: 'card__small' }, 'Project format ' + CURRENT_VERSION + '. Set in Public Sans and Barlow Semi Condensed, both under the SIL Open Font License: ',
      h('a', { href: 'fonts/LICENSE-public-sans.txt', target: '_blank', rel: 'noopener' }, 'Public Sans licence'), ', ',
      h('a', { href: 'fonts/LICENSE-barlow-semi-condensed.txt', target: '_blank', rel: 'noopener' }, 'Barlow Semi Condensed licence'), '.'),
  );
  return { element, update() {} };
}
