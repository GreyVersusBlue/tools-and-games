// #/directions?from=…&to=…  Directions
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-22 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h } from '../dom.js';
import { pageOf, NOT_BUILT_SENTENCE } from '../page.js';

export const directionsView = {
  id: 'directions',
  flag: 'directions',
  nav: 'search',
  title(ctx, route) {
    return 'Directions';
  },
  render(ctx, route) {
    return pageOf('Directions', 'The way from one room to another.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
