// The step-free report on paper (spec 11, "a report of rooms that cannot be
// reached without stairs"; DESIGN 13.6; ARCHITECTURE 19.6): the Step-free tab of
// the Safety section as a sheet.
//
//   the opening   with nothing step-free marked yet, the sentence that says the
//                 building is assumed level (UNMARKED_SAYS), first
//   the report    "Every room can be reached without stairs." or the rooms that
//                 cannot, floor by floor, each with its reason; with no
//                 step-free exit, the engine's line and every room under it
//   the groups    the step-free groups scheduled into those rooms, by day type
//                 and period
//   the last line the two views kept apart (TWO_VIEWS_SAYS): reaching a room may
//                 use an elevator, leaving in an emergency may not
//
// The report is engine/step-free.js's; nothing here works a route out.
//
// render(project, derived, options) → { title, html }; options as document.js.
// Every name (room, floor, group, corridor) is escaped and set in a span with
// dir="auto", whatever script it is in.

import { stepFreeReport } from '../../engine/step-free.js';
import { nameOfRoom } from '../../engine/schema.js';
import { periodName } from '../../engine/bells.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { count } from '../components/words.js';
import { UNMARKED_SAYS, TWO_VIEWS_SAYS, ALL_REACHED_SAYS } from '../safety/ways.js';
import { esc, frame } from './document.js';

export const id = 'step-free';
export const name = 'Step-free report';

function typed(value) {
  return '<span dir="auto">' + esc(value) + '</span>';
}

function upper(text) {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// The sheet, one: [{ body }] (frame() in document.js).
export function pages(project, derived, options) {
  const report = stepFreeReport(project);
  const floors = project.building.floors;
  const rooms = new Map();
  for (const floor of floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.set(space.id, space);

  const body = [];
  if (!report.marked) body.push('<p class="doc-lead stepfree__unmarked" data-line="unmarked">' + esc(UNMARKED_SAYS) + '</p>');
  if (report.line) body.push('<p class="doc-lead stepfree__noexit" data-line="no-exit">' + esc(report.line) + '</p>');
  if (report.rooms.length === 0) {
    body.push('<p class="doc-lead stepfree__none" data-line="none">' + esc(ALL_REACHED_SAYS) + '</p>');
  } else {
    body.push('<p class="doc-lead stepfree__count" data-line="count">' + esc(count(report.rooms.length, 'room') + ' cannot be reached without stairs.') + '</p>');
    for (const floor of floors) {
      const here = report.rooms.filter((entry) => entry.floorId === floor.id);
      if (here.length === 0) continue;
      body.push('<section class="doc-section" data-floor="' + esc(floor.id) + '"><h2>' + typed(floor.name) + ' <span class="doc-count">' + here.length + '</span></h2>');
      body.push('<table class="doc-table doc-table--stepfree"><thead><tr><th scope="col">Room</th><th scope="col">Why</th></tr></thead><tbody>');
      for (const entry of here) {
        body.push('<tr data-room="' + esc(entry.roomId) + '" data-reason="' + esc(entry.reason) + '"><th scope="row">' + typed(nameOfRoom(rooms.get(entry.roomId), true)) + '</th><td>' + typed(upper(entry.why)) + '</td></tr>');
      }
      body.push('</tbody></table></section>');
    }
    if (report.groups.length > 0) {
      const dayTypes = new Map(ownDayTypes(project).map((dayType) => [dayType.id, dayType]));
      const many = dayTypes.size > 1;
      const groupNames = new Map((project.groups || []).map((group) => [group.id, group.name]));
      body.push('<section class="doc-section" data-section="groups"><h2>Step-free groups in these rooms</h2>');
      body.push('<table class="doc-table doc-table--stepfree-groups"><thead><tr>' + (many ? '<th scope="col">Day</th>' : '') + '<th scope="col">' + esc(String(project.settings.periodWord || 'Period')) + '</th><th scope="col">Group, room</th></tr></thead><tbody>');
      for (const row of report.groups) {
        const dayType = dayTypes.get(row.dayTypeId);
        const cells = row.entries.map((entry) => typed(groupNames.get(entry.groupId) || 'A group') + ', ' + typed(nameOfRoom(rooms.get(entry.roomId), true))).join('<br>');
        body.push('<tr data-period="' + row.period + '">' + (many ? '<td>' + typed(dayType ? dayType.name : '') + '</td>' : '') + '<th scope="row">' + esc(periodName(project.settings, row.period)) + '</th><td>' + cells + '</td></tr>');
      }
      body.push('</tbody></table></section>');
    }
  }
  body.push('<p class="doc-meaning stepfree__views" data-line="views">' + esc(TWO_VIEWS_SAYS) + '</p>');
  return [{ body: body.join('\n') }];
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
