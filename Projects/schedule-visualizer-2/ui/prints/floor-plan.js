// The floor plan on paper: one floor to a sheet, or every floor, each under
// the header, labelled, cropped to what is drawn and as large as the sheet
// allows. Always on light paper; the traced image is off unless asked for,
// and nothing of the editor (selection, hover, cursor) can be in it, because
// the picture is drawn from the model (plan-svg.js) and not from the screen.
//
// render(project, derived, options) → { title, html }
// planImage(project, options) → the same plan as one SVG picture, for a PNG
//                     (see there)
//   options.floorId     a floor's id, or 'all' (the default)
//   options.traceImage  false by default. True draws each floor's traced
//                       image under its plan, where the screen has it.
//   options.traceImages { [imageId]: 'data:image/…' }: the bytes of the
//                       images, as data URLs. This module reads no storage,
//                       so a floor whose image is not in here prints without
//                       it, as does one whose image is hidden or missing.
//   and what every output takes (document.js)

import { count, list } from '../components/words.js';
import { esc, escXml, frame, mm, paperOf, printableBox, printDate, schoolName } from './document.js';
import { planSvg, planStyleText, textEms, PLAN_INK, PLAN_PAPER } from './plan-svg.js';

export const id = 'floor-plan';
export const name = 'Floor plan';

// Room on the sheet for the header above the plan and the sentence under it.
const HEADER_MM = 26;
const CAPTION_MM = 12;
// A small building is not blown up past this many millimetres a cell on US
// Letter. A larger sheet lets a cell grow with its shorter side, so a plan on
// a poster fills the poster as one on Letter fills Letter.
const LARGEST_CELL_MM = 14;
const LETTER_SHORT_MM = printableBox({ size: 'letter', orientation: 'portrait' }).width;

export function largestCell(box) {
  return LARGEST_CELL_MM * Math.max(1, Math.min(box.width, box.height) / LETTER_SHORT_MM);
}

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

// The floors of this output that have a traced image a print could show:
// one that is shown on screen and is on this device. The preview sheet asks,
// to know whether to offer the image and which bytes to fetch.
export function tracedFloors(project, options) {
  return floorsFor(project, options).filter((floor) => floor.image && floor.image.visible === true && floor.image.missing !== true);
}

export function render(project, derived, options) {
  const opts = options || {};
  const box = printableBox(paperOf(project, opts));
  const room = { width: box.width, height: box.height - HEADER_MM - CAPTION_MM };
  const pages = floorsFor(project, opts).map((floor) => {
    const plan = planSvg(project, floor, { traceImage: opts.traceImage === true, traceImages: opts.traceImages });
    const what = name + ': ' + floor.name;
    if (!plan.drawn) {
      return { what, body: '<p class="doc-lead">' + esc('Nothing is drawn on ' + floor.name + ' yet.') + '</p>' };
    }
    const cell = Math.min(room.width / plan.width, room.height / plan.height, largestCell(box));
    const figure = '<figure class="plan-figure">'
      + '<div class="plan-figure__plan" style="width: ' + mm(plan.width * cell) + '; height: ' + mm(plan.height * cell) + ';">' + plan.svg + '</div>'
      + '<figcaption class="plan-figure__caption">' + esc(sentence(floor, plan)) + '</figcaption>'
      + '</figure>';
    return { what, body: figure };
  });
  return frame(project, { output: id, what: name, pages, options: opts });
}

// ---------------------------------------------------------------- the picture

// The floor plan as one SVG that stands alone, to be drawn onto a canvas and
// saved as a PNG (ui/building/plan-png.js, SV2-32c). It is labelled and
// cropped as the print is: the school, what it is and the date over it; each
// floor's plan cropped to what is drawn, under its name when there are
// several, with the print's sentence under it. Every floor is in the one
// picture, one under the other, at one scale, so a cell is as large on each.
// Light paper whatever the screen shows, no traced image and nothing of the
// editor, as on paper. The picture reads no stylesheet: the plan's look is
// written into it (planStyleText), and so are the faces, when given.
//
// planImage(project, options) → { svg, width, height, drawn, floors }
//   options.floorId   a floor's id, or 'all' (the default)
//   options.now       the date in the heading, as for a print
//   options.fonts     [{ family, weight, url }]: faces to carry in the
//                     picture; url is a data URL of a woff2 file, and
//                     anything else is left out. Without them the picture
//                     names the faces and a browser uses what it has.
//   options.measure   (value, weight) → the width of value in ems in the
//                     face the picture falls back to (IMAGE_FALLBACK_FONT)
//                     at that weight. A heading line whose Public Sans face
//                     is not carried is sized by it, since the browser sets
//                     it in that face; without it such a line is sized at
//                     FALLBACK_WIDTH, wider than Public Sans (SV2-32k).
//   Every name is written with escXml: a character XML cannot hold is
//   U+FFFD in the picture, so it parses; the print keeps it as typed.
//   width, height     of the picture in CSS pixels, at IMAGE_CELL a cell
//   drawn             false when no floor in it has anything drawn
//   floors            [{ id, name, drawn }] in the picture's order
export const IMAGE_CELL = 24;
const IMAGE_PAD = 32;
const IMAGE_NARROWEST = 640;
// What a browser sets the heading in when Public Sans is not in the picture.
export const IMAGE_FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const IMAGE_FONT = '"Public Sans", ' + IMAGE_FALLBACK_FONT;
const IMAGE_INK_2 = '#515761';
// Public Sans runs wider than the plan's condensed face: its Latin about 0.6 of its size.
const UI_WIDTH = 1.2;
// A system sans at its widest bold Latin about 0.75 of its size: what a line
// is sized by when its face is not carried and nothing measured it.
const FALLBACK_WIDTH = 1.5;
const FONT_URL = /^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/;

// The faces given that the picture can carry: woff2 data, a plain family, a whole weight.
function carried(fonts) {
  if (!Array.isArray(fonts)) return [];
  return fonts.filter((face) => face && typeof face.family === 'string' && /^[A-Za-z ]+$/.test(face.family) && Number.isInteger(face.weight) && typeof face.url === 'string' && FONT_URL.test(face.url));
}

function faces(list) {
  return list.map((face) => '@font-face { font-family: "' + face.family + '"; font-weight: ' + face.weight + '; font-style: normal; src: url(' + face.url + ') format("woff2"); }')
    .join('\n');
}

export function planImage(project, options) {
  const opts = options || {};
  const fonts = carried(opts.fonts);
  // A heading line's width in ems in the face it will be set in: Public Sans
  // when the picture carries it at that weight, else the fallback, measured
  // when a measure is given.
  const ems = (value, weight) => {
    if (fonts.some((face) => face.family === 'Public Sans' && face.weight === weight)) return textEms(value) * UI_WIDTH;
    const measured = typeof opts.measure === 'function' ? Number(opts.measure(String(value), weight)) : NaN;
    return Number.isFinite(measured) && measured >= 0 ? measured : textEms(value) * FALLBACK_WIDTH;
  };
  // A line of text no wider than `room`: its size, down to `least`.
  const lineSize = (value, weight, most, least) => {
    const wide = ems(value, weight);
    return wide === 0 ? most : Math.max(least, Math.min(most, room / wide));
  };
  const floors = floorsFor(project, opts);
  const many = floors.length > 1;
  const one = !opts.floorId || opts.floorId === 'all' ? null : floors[0];
  const plans = floors.map((floor) => ({ floor, plan: planSvg(project, floor, { xml: true }) }));
  const widest = Math.max(0, ...plans.map(({ plan }) => plan.width * IMAGE_CELL));
  const width = Math.ceil(Math.max(IMAGE_NARROWEST, widest) + IMAGE_PAD * 2);
  const room = width - IMAGE_PAD * 2;
  const middle = width / 2;
  const parts = [];
  let y = IMAGE_PAD;
  const line = (value, size, cls) => {
    parts.push('<text class="img ' + cls + '" x="' + middle + '" y="' + Math.round((y + size * 0.8) * 100) / 100 + '" font-size="' + Math.round(size * 100) / 100 + '">' + escXml(value) + '</text>');
    y += size * 1.35;
  };

  // the heading: the school, what this is, the date (DESIGN 8)
  line(schoolName(project), lineSize(schoolName(project), 600, 16, 8), 'img__school');
  const what = one && !many ? name + ': ' + one.name : name;
  line(what, lineSize(what, 700, 26, 10), 'img__what');
  const date = printDate(opts.now);
  if (date !== '') line(date, 14, 'img__date');
  y += 16;

  for (const { floor, plan } of plans) {
    if (many) line(floor.name, lineSize(floor.name, 600, 20, 9), 'img__floor');
    if (!plan.drawn) {
      line('Nothing is drawn on ' + floor.name + ' yet.', lineSize('Nothing is drawn on ' + floor.name + ' yet.', 400, 14, 7), 'img__caption');
      y += 24;
      continue;
    }
    const w = plan.width * IMAGE_CELL;
    const h = plan.height * IMAGE_CELL;
    const placed = planSvg(project, floor, { xml: true, place: { x: (width - w) / 2, y, width: w, height: h } });
    parts.push(placed.svg);
    y += h + 10;
    const said = sentence(floor, plan);
    line(said, lineSize(said, 400, 14, 7), 'img__caption');
    y += 24;
  }
  const height = Math.ceil(y - 24 + IMAGE_PAD);

  const style = [
    faces(fonts),
    // the picture's own lines only: a rule on every text would beat the
    // plan's face and the fill each room number carries as an attribute
    '.img { text-anchor: middle; font-family: ' + IMAGE_FONT + '; fill: ' + PLAN_INK + '; }',
    '.img__school { fill: ' + IMAGE_INK_2 + '; font-weight: 600; }',
    '.img__what { font-weight: 700; }',
    '.img__date, .img__caption { fill: ' + IMAGE_INK_2 + '; }',
    '.img__floor { font-weight: 600; }',
    planStyleText(),
  ].filter((part) => part !== '').join('\n');

  const title = what + ' · ' + schoolName(project);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">\n'
    + '<title>' + escXml(title) + '</title>\n'
    + '<style>\n' + style + '\n</style>\n'
    + '<rect width="100%" height="100%" fill="' + PLAN_PAPER + '"/>\n'
    + parts.join('\n') + '\n</svg>\n';
  return { svg, width, height, drawn: plans.some(({ plan }) => plan.drawn), floors: plans.map(({ floor, plan }) => ({ id: floor.id, name: floor.name, drawn: plan.drawn })) };
}
