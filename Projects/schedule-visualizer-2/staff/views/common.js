// #/common?t=…,…  Common planning
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-22 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h } from '../dom.js';
import { pageOf, NOT_BUILT_SENTENCE } from '../page.js';

export const commonView = {
  id: 'common',
  flag: 'common',
  nav: 'search',
  title(ctx, route) {
    return 'Common planning';
  },
  render(ctx, route) {
    return pageOf('Common planning', 'The periods when several teachers are free together.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
