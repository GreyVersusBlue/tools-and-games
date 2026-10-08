// #/sub/t…  Substitute plan
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-22 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h, typed } from '../dom.js';
import { pageOf, missingPage, NOT_BUILT_SENTENCE } from '../page.js';

export const subView = {
  id: 'sub',
  flag: 'sub',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.teacher(route.id);
    return found ? 'Substitute plan: ' + found.name : 'Substitute plan';
  },
  render(ctx, route) {
    const found = route.id ? ctx.school.teacher(route.id) : null;
    if (route.id && !found) return missingPage('teacher');
    return pageOf(found ? ['Substitute plan: ', typed(found.name)] : 'Substitute plan', 'One page for a substitute.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
