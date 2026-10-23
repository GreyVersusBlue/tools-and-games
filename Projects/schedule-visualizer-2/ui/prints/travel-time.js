// The travel-time tables on paper (spec 8.3, 17): for a day type, a table for
// each transition (every group's walking time, waiting time, total, and
// whether it fits the passing time, slowest first) and a table of every
// group over the whole day. They are the movement view's Travel time tab and
// its two CSV files: the rows are ui/movement/tables.js's transitionRows and
// dayRows, which transitionsCsv and dayCsv write, so the paper and the files
// never differ. Every figure is the crowd model's.
//
// render(project, derived, options) → { title, html }
//   derived            as ./movement.js: the results the planner has, or
//                      nothing, and they are worked out here
//   options.movement   { project, results, graph }: the movement view's own
//                      state; given, the document is made from it whole
//                      (printedFrom in ./movement.js)
//   options.dayTypeId  the day type chosen on the map: its tables alone,
//                      headed as the tab heads them ("B Day (same as A Day)"
//                      for one that is the same as another). Left out, or
//                      not a day type of the project, every day type that is
//                      its own copy, each starting a sheet, and a line for
//                      those that are the same as the first.
//   and what every output takes (document.js)
//
// A day's transitions flow one after another, each table under its own
// heading; the whole day starts a sheet of its own.

import { ownDayTypes, findDayType } from '../../engine/day-types.js';
import { periodName } from '../../engine/bells.js';
import { count, list } from '../components/words.js';
import { transitionsOf } from '../movement/model.js';
import { travelDay, transitionRows, dayRows, lateWords } from '../movement/tables.js';
import { durationWords } from '../scenarios/model.js';
import { esc, frame } from './document.js';
import { printedFrom } from './movement.js';

export const id = 'travel-time';
export const name = 'Travel time';

const time = (seconds) => durationWords(seconds);

// A room's number as the tab writes it.
export function roomWords(number) {
  return number === '' ? 'no number' : number;
}

// One transition's rows as the paper prints them: the cells in order.
//   [group, from, to, walking, waiting, total, fits]
export function transitionCells(row) {
  return [row.group.name, roomWords(row.from), roomWords(row.to), time(row.walking), row.waiting === 0 ? 'none' : time(row.waiting), time(row.total), lateWords(row)];
}

// One group's day as the paper prints it.
//   [group, walks, walking, waiting, total, late walks, slowest walk]
// The slowest walk is its transition and its time: "Period 3 to Period 4, 1 min 20 s".
export function dayCells(project, row) {
  const settings = project.settings;
  const slowest = periodName(settings, row.slowest.period) + ' to ' + periodName(settings, row.slowest.period + 1) + ', ' + time(row.slowest.total);
  return [row.group.name, String(row.walks), time(row.walking), row.waiting === 0 ? 'none' : time(row.waiting), time(row.total), row.late === 0 ? 'none' : String(row.late), slowest];
}

const TRANSITION_HEAD = ['Group', 'From', 'To', 'Walking', 'Waiting', 'Total', 'Fits the passing time'];
const DAY_HEAD = ['Group', 'Walks', 'Walking', 'Waiting', 'Total', 'Late walks', 'Slowest walk'];
const NUMBERS = new Set(['Walks', 'Walking', 'Waiting', 'Total', 'Late walks']);

function table(head, rows, late) {
  const out = ['<table class="doc-table doc-table--travel">', '<thead><tr>' + head.map((label) => '<th scope="col"' + (NUMBERS.has(label) ? ' class="is-number"' : '') + '>' + esc(label) + '</th>').join('') + '</tr></thead>', '<tbody>'];
  rows.forEach((cells, index) => {
    out.push('<tr' + (late[index] ? ' class="is-late"' : '') + '><th scope="row">' + esc(cells[0]) + '</th>' + cells.slice(1).map((cell, column) => '<td' + (NUMBERS.has(head[column + 1]) ? ' class="is-number"' : '') + '>' + esc(cell) + '</td>').join('') + '</tr>');
  });
  out.push('</tbody></table>');
  return out.join('\n');
}

function names(groups) {
  return list(groups.map((group) => group.name));
}

// The pages of one day type: its transitions, then its whole day.
function dayPages(project, results, day) {
  const transitions = transitionsOf(project, day.id);
  const margin = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
  const walks = transitions.map((transition) => ({ transition, found: transitionRows(project, results, day.id, transition.period) }));
  if (walks.every((each) => each.found.rows.length === 0)) {
    return [{ what: name + ': ' + day.heading, body: '<p class="doc-lead">' + esc('Nobody walks anywhere on ' + day.heading + ' yet: give a group a room in two periods that follow each other.') + '</p>' }];
  }
  const body = ['<p class="doc-lead">' + esc('How long every group takes on ' + day.heading + ', slowest first. Walking is the time in an empty corridor; waiting is the time lost to the crowd.'
    + (margin > 0 ? ' A walk is late when it takes longer than the passing time and ' + time(margin) + ' of margin.' : ' A walk is late when it takes longer than the passing time.')) + '</p>'];
  for (const { transition, found } of walks) {
    body.push('<section class="doc-section doc-section--travel" data-period="' + transition.period + '">');
    body.push('<h2>' + esc(transition.name) + '</h2>');
    body.push('<p class="doc-meaning">' + esc('Passing time ' + time(transition.seconds) + (transition.times ? ', ' + transition.times : '') + '.') + '</p>');
    if (found.rows.length === 0) body.push('<p class="doc-none">Nobody walks in this transition.</p>');
    else body.push(table(TRANSITION_HEAD, found.rows.map(transitionCells), found.rows.map((row) => row.late)));
    const rest = [];
    if (found.still.length > 0) rest.push(names(found.still) + (found.still.length === 1 ? ' stays in its room.' : ' stay in their rooms.'));
    if (found.failed.length > 0) rest.push(names(found.failed) + (found.failed.length === 1 ? ' has no route.' : ' have no route.'));
    if (rest.length > 0) body.push('<p class="doc-meaning">' + esc(rest.join(' ')) + '</p>');
    body.push('</section>');
  }
  const rows = dayRows(project, results, day.id);
  const lateGroups = rows.filter((row) => row.late > 0).length;
  body.push('<section class="doc-section doc-section--travel-day new-sheet">');
  body.push('<h2>' + esc('Each group over the whole of ' + day.heading) + '</h2>');
  body.push('<p class="doc-meaning">' + esc('Slowest first, by the time spent walking and waiting over the day. ' + (lateGroups === 0 ? 'No group is late.' : count(lateGroups, 'group') + (lateGroups === 1 ? ' is' : ' are') + ' late at least once.')) + '</p>');
  body.push(table(DAY_HEAD, rows.map((row) => dayCells(project, row)), rows.map((row) => row.late > 0)));
  body.push('</section>');
  return [{ what: name + ': ' + day.heading, body: body.join('\n') }];
}

export function render(given, derived, options) {
  const opts = options || {};
  const { project, results } = printedFrom(given, derived, opts);
  const chosen = opts.dayTypeId ? findDayType(project, opts.dayTypeId) : null;
  const days = chosen ? [travelDay(project, chosen.id)] : ownDayTypes(project).map((dayType) => travelDay(project, dayType.id));
  const pages = days.flatMap((day) => dayPages(project, results, day));
  if (!chosen) {
    const own = ownDayTypes(project);
    const followers = project.dayTypes.filter((dayType) => !own.includes(dayType));
    if (followers.length > 0) {
      pages[pages.length - 1].body += '\n<p class="doc-meaning">' + esc(list(followers.map((dayType) => dayType.name)) + (followers.length === 1 ? ' is' : ' are') + ' the same as ' + project.dayTypes[0].name + ' and ' + (followers.length === 1 ? 'has' : 'have') + ' the same travel times.') + '</p>';
    }
  }
  return frame(project, { output: id, what: name, pages, options: opts });
}
