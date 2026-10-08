// #/group/g…  Group
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-21 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h, typed } from '../dom.js';
import { pageOf, missingPage, NOT_BUILT_SENTENCE } from '../page.js';

export const groupView = {
  id: 'group',
  flag: 'group',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.group(route.id);
    return found ? found.name : 'Group';
  },
  render(ctx, route) {
    const found = ctx.school.group(route.id);
    if (!found) return missingPage('group');
    return pageOf(typed(found.name), 'A group\'s day and who teaches it.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
