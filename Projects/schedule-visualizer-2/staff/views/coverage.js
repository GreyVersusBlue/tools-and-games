// #/coverage/t…  Coverage
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-22 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h, typed } from '../dom.js';
import { pageOf, missingPage, NOT_BUILT_SENTENCE } from '../page.js';

export const coverageView = {
  id: 'coverage',
  flag: 'coverage',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.teacher(route.id);
    return found ? 'Coverage: ' + found.name : 'Coverage';
  },
  render(ctx, route) {
    const found = route.id ? ctx.school.teacher(route.id) : null;
    if (route.id && !found) return missingPage('teacher');
    return pageOf(found ? ['Coverage: ', typed(found.name)] : 'Coverage', 'Who is free to cover each period of a teacher who is out.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
