// The modules a published file contains: the staff browser's own, and the
// engine modules it uses. The assembler (ui/staff/assemble.js) reads exactly
// these and joins them in the order their imports need; this list's order only
// settles ties. test/publish/manifest.test.mjs fails when the list is not
// exactly what staff/main.js loads, so a module cannot be added to the staff
// browser without being added here, and nothing rides along unused.
//
// A module on this list keeps to the linker rule written at the top of
// ui/staff/assemble.js, and every exported name is the only one of that name
// on the whole list.

export const PAGE = 'staff/index.html';
export const ENTRY = 'staff/main.js';

export const MODULES = [
  'engine/schema.js',
  'engine/day-types.js',
  'engine/bells.js',
  'engine/teacher-day.js',
  'engine/findings.js',
  'engine/graph.js',
  'engine/routing.js',
  'engine/directions.js',
  'engine/publish-crypto.js',
  'staff/dom.js',
  'staff/router.js',
  'staff/storage.js',
  'staff/dates.js',
  'staff/source.js',
  'staff/model.js',
  'staff/find.js',
  'staff/page.js',
  'staff/passcode.js',
  'staff/search.js',
  'staff/views/teacher.js',
  'staff/views/group.js',
  'staff/views/room.js',
  'staff/views/map.js',
  'staff/views/staffing.js',
  'staff/views/free.js',
  'staff/views/now.js',
  'staff/views/common.js',
  'staff/views/coverage.js',
  'staff/views/sub.js',
  'staff/views/directions.js',
  'staff/me.js',
  'staff/views.js',
  'staff/shell.js',
  'staff/main.js',
];
