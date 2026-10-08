// #/staffing  Staffing
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-21 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h } from '../dom.js';
import { pageOf, NOT_BUILT_SENTENCE } from '../page.js';

export const staffingView = {
  id: 'staffing',
  flag: 'staffing',
  nav: 'search',
  title(ctx, route) {
    return 'Staffing';
  },
  render(ctx, route) {
    return pageOf('Staffing', 'Teachers and taught periods for every subject.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
