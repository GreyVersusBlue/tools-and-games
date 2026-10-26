// The printable outputs, and where each one's button goes.
//
// An output is a module with `id`, `name` and
// `render(project, derived, options) → { title, html }`: a complete document
// built from the model, with every string escaped (document.js). The preview
// sheet (ui/components/print-preview.js) shows any of them and prints it.
//
// A unit that adds an output adds its module here. A unit that owns a screen
// mounts the buttons listed for it: `printButtons` says which, in the words of
// DESIGN 5, and `printButton(ctx, entry, getOptions)` from the preview sheet's
// module makes the button itself.

import * as floorPlan from './floor-plan.js';
import * as roomList from './room-list.js';
import * as checksReport from './checks-report.js';
import { BATCHES } from './batch.js';
import * as movementPicture from './movement.js'; // SV2-18
import * as congestionReport from './congestion.js'; // SV2-18
import * as doorCards from './door-cards.js'; // SV2-66
import { GRIDS } from './schedule-grids.js'; // SV2-32d
import * as travelTime from './travel-time.js'; // SV2-32d
import * as calendarPrint from './calendar.js'; // SV2-80

export const OUTPUTS = [floorPlan, roomList, checksReport, ...BATCHES, movementPicture, congestionReport, doorCards, ...GRIDS, travelTime, calendarPrint];

export function outputFor(id) {
  return OUTPUTS.find((output) => output.id === id) || null;
}

// Render one output by its id. Null when there is no such output.
export function renderOutput(id, project, derived, options) {
  const output = outputFor(id);
  return output ? output.render(project, derived, options) : null;
}

// Where the buttons go.
//   output   an id in OUTPUTS
//   screen   the hash route of the screen that carries the button
//   place    where on that screen, in DESIGN's words
//   label    the button's words
//   floors   true when the sheet offers "this floor / every floor", and the
//            mounting screen passes { floorId } for the floor on show
// An output with buttons in two places has an entry for each: the id is the
// button's, and two buttons on one page never share one.
export const printButtons = [
  { id: 'print-checks', output: 'checks', screen: '#schedule/checks', place: 'the Checks tab of the Schedule section', label: 'Print the checks report', floors: false },
  { id: 'print-floor-plan', output: 'floor-plan', screen: '#building', place: 'the Floor tab of the Building inspector', label: 'Print the floor plan', floors: true },
  { id: 'print-door-cards', output: 'door-cards', screen: '#building', place: 'the Floor tab of the Building inspector', label: 'Print door cards', floors: true },
  { id: 'print-room-list', output: 'room-list', screen: '#building', place: 'the Floor tab of the Building inspector', label: 'Print the room list', floors: true },
  // SV2-32d: the schedule as its CSV files have it, and the travel-time tables
  { id: 'print-grid-groups', output: 'groups', screen: '#schedule/grid', place: 'the Grid tab\'s toolbar, with the rows set to Groups', label: 'Print the groups', floors: false },
  { id: 'print-grid-teachers', output: 'teacher-grid', screen: '#schedule/grid', place: 'the Grid tab\'s toolbar, with the rows set to Teachers', label: 'Print the teachers by period', floors: false },
  { id: 'print-grid-rooms', output: 'room-grid', screen: '#schedule/grid', place: 'the Grid tab\'s toolbar, with the rows set to Rooms', label: 'Print the rooms by period', floors: false },
  { id: 'print-teachers', output: 'teachers', screen: '#schedule/teachers', place: 'the Teachers tab\'s toolbar', label: 'Print the teacher list', floors: false },
  { id: 'print-export-groups', output: 'groups', screen: '#schedule/import', place: 'the Export panel of the Import tab, beside the groups CSV', label: 'Print the groups', floors: false },
  { id: 'print-export-teachers', output: 'teachers', screen: '#schedule/import', place: 'the Export panel of the Import tab, beside the teachers CSV', label: 'Print the teacher list', floors: false },
  { id: 'print-export-teacher-grid', output: 'teacher-grid', screen: '#schedule/import', place: 'the Export panel of the Import tab, beside the teachers by period CSV', label: 'Print the teachers by period', floors: false },
  { id: 'print-export-room-grid', output: 'room-grid', screen: '#schedule/import', place: 'the Export panel of the Import tab, beside the rooms by period CSV', label: 'Print the rooms by period', floors: false },
  { id: 'print-travel-time', output: 'travel-time', screen: '#movement', place: 'the Travel time tab of the Movement inspector', label: 'Print the travel times', floors: false },
];

// An entry's words in the school's own word for a period: "Print the
// teachers by block". Every other word of the label is as written above.
export function buttonLabel(entry, settings) {
  const word = settings && typeof settings.periodWord === 'string' && settings.periodWord !== '' ? settings.periodWord.toLowerCase() : 'period';
  return entry.label.replace(/ by period$/, ' by ' + word);
}
