// The views, by the first word of their address. A view is
//
//   export const teacherView = {
//     id: 'teacher',     the first word of the address: #/teacher/…
//     flag: 'teacher',   the publish.views key that switches it off, or null
//     nav: 'search',     which item of the bar is marked: search, map, now, me
//     title(ctx, route)  the tab's title, plain text
//     render(ctx, route) the page: a node, normally pageOf(…) from page.js
//   };
//
// `route` is { view, id, query } from router.js. `ctx` is
//
//   ctx.school          the lookups of model.js (ctx.school.data is the published data)
//   ctx.store           the device storage guard of storage.js, for this school
//   ctx.now()           the time, as a Date
//   ctx.go(hash)        move to an address (a history entry)
//   ctx.replace(hash)   change the address in place, without drawing again
//   ctx.redraw()        draw the current page again
//
// A view draws with h() and typed() from dom.js and the classes named at the
// top of staff.css, and never sets innerHTML. Its exported name has to be the
// only one of that name in the published file, which is why each is called
// after its view. A view that needs a module of its own adds it to
// staff/manifest.js.

import { searchView } from './search.js';
import { teacherView } from './views/teacher.js';
import { groupView } from './views/group.js';
import { roomView } from './views/room.js';
import { mapView } from './views/map.js';
import { staffingView } from './views/staffing.js';
import { freeView } from './views/free.js';
import { nowView } from './views/now.js';
import { commonView } from './views/common.js';
import { coverageView } from './views/coverage.js';
import { subView } from './views/sub.js';
import { directionsView } from './views/directions.js';
import { meView } from './me.js';
import { doorView } from './views/door-sign.js';

export const VIEWS = [searchView, teacherView, groupView, roomView, mapView, staffingView, freeView, nowView, commonView, coverageView, subView, directionsView, meView, doorView];

// The view an address names; an address that names none is the search page.
export function viewFor(id) {
  return VIEWS.find((view) => view.id === id) || searchView;
}
