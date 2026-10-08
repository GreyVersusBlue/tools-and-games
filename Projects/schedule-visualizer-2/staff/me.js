// #/me  My schedule
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-23 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h } from './dom.js';
import { pageOf, NOT_BUILT_SENTENCE } from './page.js';

export const meView = {
  id: 'me',
  flag: 'teacher',
  nav: 'me',
  title(ctx, route) {
    return 'My schedule';
  },
  render(ctx, route) {
    return pageOf('My schedule', 'Choose yourself once, and this file opens on your page.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
