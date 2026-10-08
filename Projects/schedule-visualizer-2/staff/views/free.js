// #/free  Free right now
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-22 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h } from '../dom.js';
import { pageOf, NOT_BUILT_SENTENCE } from '../page.js';

export const freeView = {
  id: 'free',
  flag: 'free',
  nav: 'now',
  title(ctx, route) {
    return 'Free right now';
  },
  render(ctx, route) {
    return pageOf('Free right now', 'Which teachers and rooms are free in a period.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
