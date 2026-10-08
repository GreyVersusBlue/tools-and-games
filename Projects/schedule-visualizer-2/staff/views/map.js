// #/map/f…  Building map
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-21 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h, typed } from '../dom.js';
import { pageOf, missingPage, NOT_BUILT_SENTENCE } from '../page.js';

export const mapView = {
  id: 'map',
  flag: 'map',
  nav: 'map',
  title(ctx, route) {
    const found = ctx.school.floor(route.id) || ctx.school.floors[0];
    return found ? 'Building map: ' + found.name : 'Building map';
  },
  render(ctx, route) {
    const found = route.id ? ctx.school.floor(route.id) : ctx.school.floors[0];
    if (!found) return missingPage('floor');
    return pageOf(['Building map: ', typed(found.name)], 'The building, one floor at a time.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
