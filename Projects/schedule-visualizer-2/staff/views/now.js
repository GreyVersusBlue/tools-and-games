// #/now  Where right now
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-22 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h } from '../dom.js';
import { pageOf, NOT_BUILT_SENTENCE } from '../page.js';

export const nowView = {
  id: 'now',
  flag: 'now',
  nav: 'now',
  title(ctx, route) {
    return 'Where right now';
  },
  render(ctx, route) {
    return pageOf('Where right now', 'Where a group or a teacher is this period.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
