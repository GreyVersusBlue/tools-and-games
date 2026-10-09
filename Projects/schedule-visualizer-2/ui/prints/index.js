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

export const OUTPUTS = [floorPlan, roomList, checksReport];

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
export const printButtons = [
  { id: 'print-checks', output: 'checks', screen: '#schedule/checks', place: 'the Checks tab of the Schedule section', label: 'Print the checks report', floors: false },
  { id: 'print-floor-plan', output: 'floor-plan', screen: '#building', place: 'the Floor tab of the Building inspector', label: 'Print the floor plan', floors: true },
  { id: 'print-room-list', output: 'room-list', screen: '#building', place: 'the Floor tab of the Building inspector', label: 'Print the room list', floors: true },
];
