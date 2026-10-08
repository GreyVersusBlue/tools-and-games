// The floor plan on paper: one floor to a sheet, or every floor, each under
// the header, labelled, cropped to what is drawn and as large as the sheet
// allows. Always on light paper; the traced image is off unless asked for,
// and nothing of the editor (selection, hover, cursor) can be in it, because
// the picture is drawn from the model (plan-svg.js) and not from the screen.
//
// render(project, derived, options) → { title, html }
//   options.floorId     a floor's id, or 'all' (the default)
//   options.traceImage  false by default. Drawing the traced image on paper
//                       waits for the unit that defines how it is placed;
//                       until then it is never drawn, whatever this says.
//   and what every output takes (document.js)

import { count, list } from '../components/words.js';
import { esc, frame, mm, paperOf, printableBox } from './document.js';
import { planSvg } from './plan-svg.js';

export const id = 'floor-plan';
export const name = 'Floor plan';

// Room on the sheet for the header above the plan and the sentence under it.
const HEADER_MM = 26;
const CAPTION_MM = 12;
// A small building is not blown up past this many millimetres a cell.
const LARGEST_CELL_MM = 14;

function sentence(floor, plan) {
  const parts = [count(plan.rooms, 'room'), count(plan.exits, 'exit')];
  const stairs = plan.letters.length === 0 ? 'no stairs' : 'stairs ' + list(plan.letters.slice().sort());
  return floor.name + ': ' + parts.join(', ') + ', ' + stairs + '.';
}

export function floorsFor(project, options) {
  const floors = project.building.floors;
  const asked = options && options.floorId;
  if (!asked || asked === 'all') return floors;
  const one = floors.filter((floor) => floor.id === asked);
  return one.length > 0 ? one : floors;
}

export function render(project, derived, options) {
  const opts = options || {};
  const box = printableBox(paperOf(project, opts));
  const room = { width: box.width, height: box.height - HEADER_MM - CAPTION_MM };
  const pages = floorsFor(project, opts).map((floor) => {
    const plan = planSvg(project, floor);
    const what = name + ': ' + floor.name;
    if (!plan.drawn) {
      return { what, body: '<p class="doc-lead">' + esc('Nothing is drawn on ' + floor.name + ' yet.') + '</p>' };
    }
    const cell = Math.min(room.width / plan.width, room.height / plan.height, LARGEST_CELL_MM);
    const figure = '<figure class="plan-figure">'
      + '<div class="plan-figure__plan" style="width: ' + mm(plan.width * cell) + '; height: ' + mm(plan.height * cell) + ';">' + plan.svg + '</div>'
      + '<figcaption class="plan-figure__caption">' + esc(sentence(floor, plan)) + '</figcaption>'
      + '</figure>';
    return { what, body: figure };
  });
  return frame(project, { output: id, what: name, pages, options: opts });
}
