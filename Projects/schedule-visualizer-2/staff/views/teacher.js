// #/teacher/t…  Teacher
//
// The stub: the address works, the name is shown, and the page says it is not
// built. SV2-21 replaces this file, keeping the export's name and its id, flag
// and nav (staff/views.js has the contract).

import { h, typed } from '../dom.js';
import { pageOf, missingPage, NOT_BUILT_SENTENCE } from '../page.js';

export const teacherView = {
  id: 'teacher',
  flag: 'teacher',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.teacher(route.id);
    return found ? found.name : 'Teacher';
  },
  render(ctx, route) {
    const found = ctx.school.teacher(route.id);
    if (!found) return missingPage('teacher');
    return pageOf(typed(found.name), 'A teacher\'s day, period by period.', h('p', { class: 'muted' }, NOT_BUILT_SENTENCE));
  },
};
