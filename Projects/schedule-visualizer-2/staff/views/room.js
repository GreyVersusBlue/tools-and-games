// #/room/r…  Room
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-21 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h, typed } from '../dom.js';
import { pageOf, missingPage, NOT_BUILT_SENTENCE } from '../page.js';

export const roomView = {
  id: 'room',
  flag: 'room',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.room(route.id);
    return found ? ctx.school.roomName(found, true) : 'Room';
  },
  render(ctx, route) {
    const found = ctx.school.room(route.id);
    if (!found) return missingPage('room');
    return pageOf(typed(ctx.school.roomName(found, true)), 'Who is in a room each period.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
