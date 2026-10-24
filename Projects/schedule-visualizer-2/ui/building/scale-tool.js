// Scaling the traced image from a length (SV2-73a). Devon's words: "place two
// points on the image, then say how many feet wide it is." On the Floor tab,
// "Scale the image from a length" starts a mode: the reader places two points
// on the image (a click, a tap, or the keyboard cursor and Enter), then says
// how long the line between them really is, in feet, metres or cells, and the
// image is scaled so that it is, with the first point kept where it was on the
// floor. One undo step. Feet and metres need the length of one cell, the
// project's Cell scale (spec 16); when it is not set the same form asks for
// it and keeps it.
//
// The first part of this file is pure and has no DOM in it: the arithmetic,
// with Node cases in test/ui/scale-tool.test.mjs. It works on the TraceImage
// as ui/building/trace.js describes it (scale is cells per image pixel; x and
// y the unturned top left corner in cells; rotation degrees clockwise about
// the image's middle).
//
// Points are kept in image pixels while the mode lasts, so an undo or a typed
// change to the image that moves it carries the points with it: they stay on
// the same marks of the plan.
//
// While points are placed the plan's tools are out of the way: a press on
// the plan places a point and nothing else (as in connect mode). The wheel,
// the zoom buttons and the =, - and 0 keys still zoom. On touch the point
// goes in where the finger lifts, at a marker drawn OFFSET pixels above the
// finger (below it near the top of the plan), so the finger never hides the
// point it is placing; the finger can slide before it lifts.
//
// The same mode places the image by two points (SV2-73b), "Place the image by
// two points": two points on the image, then the two places on the floor they
// belong at, placed the same way; the image's scale, turn and corner are set
// so both land where they belong, in one undo step, the moment the fourth is
// placed (pointsPlacement). The first two are kept in image pixels like the
// scaling points; the two places are kept in cells, since they are on the floor.

import { h } from '../components/dom.js';
import { choice } from '../components/choice.js';
import { scaleTraceImage, placeTraceImage } from '../../engine/actions.js';
import { CELL_SCALE_UNITS, CELL_LENGTH_MOST, METRES_PER_FOOT, RANGES } from '../../engine/schema.js';
import { inspectorSheet } from './inspector/sheet.js';

// ---------------------------------------------------------------- pure

// The units a length is given in, feet first since Devon thinks in feet.
export const LENGTH_UNITS = [
  { value: 'feet', label: 'Feet', one: 'foot', many: 'feet' },
  { value: 'metres', label: 'Metres', one: 'metre', many: 'metres' },
  { value: 'cells', label: 'Cells', one: 'cell', many: 'cells' },
];

// Two points nearer than this on the image (in its own pixels) are one place.
export const LEAST_PIXELS = 1;
// The scaled image's longer side may be at most this many cells: ten times
// the largest floor. Past it the length or its unit was surely mistyped.
export const MOST_CELLS = 10 * RANGES.floorSize[1];

export class ScaleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ScaleError';
    this.code = code;
  }
}

const unitOf = (value) => LENGTH_UNITS.find((unit) => unit.value === value);

export const round = (value, places) => {
  const unit = 10 ** places;
  return Math.round(value * unit) / unit;
};

// "1 foot", "2.5 feet", "1 cell": a number to two places and its unit.
export function lengthWords(length, unit) {
  const shown = round(length, 2);
  const words = unitOf(unit);
  return shown + ' ' + (shown === 1 ? words.one : words.many);
}

// The middle of the image, in cells, and its turn in radians.
function frame(image) {
  const w = image.width * image.scale;
  const hgt = image.height * image.scale;
  return { cx: image.x + w / 2, cy: image.y + hgt / 2, turn: (image.rotation * Math.PI) / 180 };
}

// A place on the floor (in cells) to the image's own pixels: { u, v }, from
// its top left corner as stored, before it is turned.
export function imagePoint(image, at) {
  const { cx, cy, turn } = frame(image);
  const dx = at.x - cx;
  const dy = at.y - cy;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { u: (dx * cos + dy * sin) / image.scale + image.width / 2, v: (-dx * sin + dy * cos) / image.scale + image.height / 2 };
}

// A place on the image (its pixels) to the floor, in cells: { x, y }.
export function floorPoint(image, at) {
  const { cx, cy, turn } = frame(image);
  const du = (at.u - image.width / 2) * image.scale;
  const dv = (at.v - image.height / 2) * image.scale;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { x: cx + du * cos - dv * sin, y: cy + du * sin + dv * cos };
}

// How far apart two places on the image are, in its pixels.
export function pixelsApart(a, b) {
  return Math.hypot(b.u - a.u, b.v - a.v);
}

// A length in feet, metres or cells, as cells. Feet and metres need the
// Cell scale ({ unit, length }: one cell is that long); one given in the
// other unit is converted.
export function cellsFor(length, unit, cellScale) {
  if (unit === 'cells') return length;
  if (!CELL_SCALE_UNITS.includes(unit)) throw new ScaleError('A length is in feet, metres or cells.', 'unit');
  if (!cellScale) throw new ScaleError('How long one cell is in ' + unit + ' is needed first.', 'no-cell-scale');
  return length / cellLengthIn(cellScale, unit);
}

// How long one cell is in feet or in metres, from the Cell scale.
export function cellLengthIn(cellScale, unit) {
  if (cellScale.unit === unit) return cellScale.length;
  return unit === 'feet' ? cellScale.length / METRES_PER_FOOT : cellScale.length * METRES_PER_FOOT;
}

// The image's new scale and top left corner, so that the line from a to b
// (places on the image, in its pixels) is `cells` long and a stays where it is
// on the floor; the turn is kept. { scale, x, y }, or a ScaleError.
export function scaledPlacement(image, a, b, cells) {
  const apart = pixelsApart(a, b);
  if (!(apart >= LEAST_PIXELS)) throw new ScaleError('The two points are in the same place on the image. Place the second point at the other end of a length you know.', 'same-place');
  if (!(cells > 0) || !Number.isFinite(cells)) throw new ScaleError('The line needs a length above 0.', 'length');
  const scale = cells / apart;
  const longer = Math.max(image.width, image.height) * scale;
  if (longer > MOST_CELLS) throw new ScaleError('That would make the image ' + Math.round(longer).toLocaleString('en-US') + ' cells across, far larger than any floor can be (' + RANGES.floorSize[1] + ' cells). Check the length and its unit.', 'too-large');
  if (longer < 1) throw new ScaleError('That would make the whole image less than one cell across. Check the length and its unit.', 'too-small');
  const kept = floorPoint(image, a);
  const next = { ...image, scale, x: 0, y: 0 };
  // where a lands with the new scale and the corner at 0, 0; then move it back
  const landed = floorPoint(next, a);
  return { scale, x: kept.x - landed.x, y: kept.y - landed.y };
}

// The text of a length field to a number above 0, or a refusal in a sentence.
// `what` names it ("The line", "One cell"); `most` caps it when given.
export function readLength(text, what, most) {
  const trimmed = String(text).trim().replace(',', '.');
  if (trimmed === '') throw new ScaleError(what === 'One cell' ? 'Type how long one cell is, like 5.' : 'Type how long the line is, like 30.', 'empty');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) throw new ScaleError('"' + text + '" is not a number. ' + (what === 'One cell' ? 'Type how long one cell is, like 5.' : 'Type how long the line is, like 30.'), 'not-a-number');
  const value = Number(trimmed);
  if (value < 0) throw new ScaleError(what + ' cannot be shorter than nothing. Type a length above 0.', 'negative');
  if (value === 0) throw new ScaleError(what + ' needs a length above 0.', 'zero');
  if (most !== undefined && value > most) throw new ScaleError(what + ' can be at most ' + most + '.', 'too-long');
  return value;
}

// Where a place is, in cells, to one place: "12.4, 7.8".
export function placeWords(at) {
  return round(at.x, 1) + ', ' + round(at.y, 1);
}

// Two places on the floor nearer than this (in cells) are one place.
export const LEAST_CELLS = 0.25;

// Degrees to the range above -180 and up to 180, with no -0.
export function plainDegrees(degrees) {
  let turned = degrees % 360;
  if (turned > 180) turned -= 360;
  if (turned <= -180) turned += 360;
  return turned === 0 ? 0 : turned;
}

// Placing the image by two points (SV2-73b): a1 and a2 are places on the
// image (its pixels), b1 and b2 the places on the floor (cells) they belong
// at. The image's scale, turn and top left corner so that each lands on its
// own: { scale, rotation, x, y }, or a ScaleError. The pairs may come in
// either order; the answer is the same.
export function pointsPlacement(image, a1, a2, b1, b2) {
  if (!(pixelsApart(a1, a2) >= LEAST_PIXELS)) throw new ScaleError('The two points are in the same place on the image. Place the second point somewhere else on it, as far from the first as you can.', 'same-place');
  const across = Math.hypot(b2.x - b1.x, b2.y - b1.y);
  if (!(across >= LEAST_CELLS)) throw new ScaleError('The two places on the floor are in the same place. Place the second where the second point belongs, as far from the first as you can.', 'same-cell');
  const du = a2.u - a1.u;
  const dv = a2.v - a1.v;
  const scale = across / Math.hypot(du, dv);
  const longer = Math.max(image.width, image.height) * scale;
  if (longer > MOST_CELLS) throw new ScaleError('That would make the image ' + Math.round(longer).toLocaleString('en-US') + ' cells across, far larger than any floor can be (' + RANGES.floorSize[1] + ' cells). Place the points farther apart on the image, or nearer on the floor.', 'too-large');
  if (longer < 1) throw new ScaleError('That would make the whole image less than one cell across. Place the points nearer on the image, or farther apart on the floor.', 'too-small');
  const turn = Math.atan2(b2.y - b1.y, b2.x - b1.x) - Math.atan2(dv, du);
  const rotation = plainDegrees((turn * 180) / Math.PI);
  // a1, turned and scaled about the image's middle, lands on b1: the middle follows
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const ou = (a1.u - image.width / 2) * scale;
  const ov = (a1.v - image.height / 2) * scale;
  const cx = b1.x - (ou * cos - ov * sin);
  const cy = b1.y - (ou * sin + ov * cos);
  return { scale, rotation, x: cx - (image.width * scale) / 2, y: cy - (image.height * scale) / 2 };
}

// ---------------------------------------------------------------- on the page

// How far a mouse or pen press may move and still place a point.
const CLICK_SLOP = 6;
// How far above a finger (in CSS pixels) a touch places its point.
export const OFFSET = 56;
// Narrower than this the inspector is a sheet over the plan (ui/app.js).
const SHEET_QUERY = '(max-width: 900px)';

// createScaleTool(ed, ctx, { stopMoving, isMissing, changed }) -> { start(event, kind), cancel(tell), active, kind, points, targets, overlay, detach() }
//   kind 'scale' (from a length, the default) or 'place' (by two points);
//   changed() is called whenever the mode starts or ends
export function createScaleTool(ed, ctx, options) {
  inspectorSheet();
  const canvas = ed.canvas;
  const stage = canvas.parentElement;
  // the mode: null, or { kind, floorId, imageId, points: [{ u, v }], targets: [{ x, y }], hover, press }
  let mode = null;
  const placing = () => mode !== null && mode.kind === 'place';

  // ---------------------------------------------------------- the banner and the form

  const words = h('p', { class: 'bld-connect__text', id: 'scale-text' });
  const stop = h('button', { type: 'button', class: 'btn', id: 'scale-cancel', on: { click: () => cancel(true) } }, 'Cancel');
  // placing by two points: start over, from the first point on the image
  const over = h('button', { type: 'button', class: 'btn', id: 'place-again', hidden: true, on: { click: () => restart() } }, 'Start again');
  // connect mode's banner, in the flow of this box rather than over it
  const banner = h('div', { class: 'bld-connect', id: 'scale-banner', role: 'status', style: 'position: static' }, words, over, stop);

  const lineWords = h('p', { id: 'scale-line', style: 'flex: 1 1 100%; margin: 0' });
  const lengthInput = h('input', { class: 'field__input', id: 'scale-length', name: 'scale-length', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', style: 'width: 7rem' });
  let unit = LENGTH_UNITS[0].value;
  const unitLabel = h('span', { class: 'field__label', id: 'scale-unit-label' }, 'In');
  const units = choice({ name: 'scale-unit', labelledBy: 'scale-unit-label', options: LENGTH_UNITS.map((each) => ({ value: each.value, label: each.label })), value: unit, onChange: (value) => {
    unit = value;
    drawForm();
  } });
  const cellLabel = h('label', { class: 'field__label', for: 'scale-cell' });
  const cellInput = h('input', { class: 'field__input', id: 'scale-cell', name: 'scale-cell', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', style: 'width: 7rem' });
  const cellPart = h('div', { class: 'field', id: 'scale-cell-part', hidden: true }, cellLabel, cellInput);
  const cellKnown = h('p', { id: 'scale-cell-known', style: 'flex: 1 1 100%; margin: 0', hidden: true });
  const refusal = h('p', { class: 'field__refusal', id: 'scale-refusal', style: 'flex: 1 1 100%; margin: 0', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary', id: 'scale-apply' }, 'Scale the image');
  const again = h('button', { type: 'button', class: 'btn', id: 'scale-again', on: { click: () => restart() } }, 'Place the points again');
  const form = h('form', {
    id: 'scale-form',
    novalidate: true,
    'aria-label': 'How long the line is',
    hidden: true,
    style: 'display: flex; flex-wrap: wrap; align-items: end; gap: var(--s-3); padding: var(--s-3) var(--s-4); background: var(--card); color: var(--ink); border-bottom: var(--border); box-shadow: var(--shadow)',
    on: { submit: (event) => {
      event.preventDefault();
      apply();
    } },
  },
  lineWords,
  h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'scale-length' }, 'How long is the line?'), lengthInput),
  h('div', { class: 'field' }, unitLabel, units.element),
  cellPart,
  cellKnown,
  refusal,
  h('div', { class: 'bi-buttons' }, submit, again));
  const box = h('div', { class: 'bld-scale', id: 'scale-mode', hidden: true, style: 'position: absolute; top: 0; left: 0; right: 0; z-index: 2' }, banner, form);
  stage.append(box);

  function floorOf(id) {
    return ed.project.building.floors.find((floor) => floor.id === id) || null;
  }

  function imageNow() {
    const floor = mode && floorOf(mode.floorId);
    return floor && floor.image && floor.image.imageId === mode.imageId ? floor.image : null;
  }

  function cellScale() {
    const value = ed.project.settings.cellScale;
    return value && typeof value === 'object' ? value : null;
  }

  // the words for where the mode is, said in the banner and the status line
  function sentence() {
    const image = imageNow();
    if (!image) return '';
    const places = mode.points.map((point) => floorPoint(image, point));
    if (placing()) {
      if (places.length === 0) return 'Placing the image: put the first point on a mark of the image you can find on the floor too, such as a corner (click, tap, or move the cursor and press Enter). Esc cancels.';
      if (places.length === 1) return 'First point on the image at ' + placeWords(places[0]) + ' cells. Now the second point on the image, as far from the first as you can. Esc cancels.';
      if (mode.targets.length === 0) return 'Both points are on the image. Now click or tap the place on the floor where the first point belongs. Esc cancels.';
      return 'The first point belongs at ' + placeWords(mode.targets[0]) + ' cells. Now the place on the floor where the second point belongs. Esc cancels.';
    }
    if (places.length === 0) return 'Scaling the image: place the first point at one end of a length you know, such as a wall (click, tap, or move the cursor and press Enter). Esc cancels.';
    if (places.length === 1) return 'First point at ' + placeWords(places[0]) + ' cells. Now place the second point at the other end of the length. Esc cancels.';
    const cells = Math.hypot(places[1].x - places[0].x, places[1].y - places[0].y);
    return 'The line runs from ' + placeWords(places[0]) + ' to ' + placeWords(places[1]) + ' cells, ' + lengthWords(cells, 'cells') + ' long now. Click or tap near a point to place it again. Esc cancels.';
  }

  function drawForm() {
    const known = cellScale();
    const feetOrMetres = unit !== 'cells';
    cellPart.hidden = !(feetOrMetres && !known);
    cellLabel.textContent = 'One cell is how many ' + unit + '?';
    cellKnown.hidden = !(feetOrMetres && known);
    if (known && feetOrMetres) {
      const converted = known.unit === unit ? '' : ' (' + lengthWords(cellLengthIn(known, unit), unit) + ')';
      cellKnown.textContent = 'One cell is ' + lengthWords(known.length, known.unit) + converted + ', the project\'s Cell scale. Change it in Settings.';
    }
  }

  function draw() {
    box.hidden = mode === null;
    if (mode === null) {
      delete canvas.dataset.scaling;
      return;
    }
    canvas.dataset.scaling = 'true';
    box.dataset.kind = mode.kind;
    const text = sentence();
    words.textContent = text;
    ed.setHint(text);
    over.hidden = !placing() || mode.points.length === 0;
    form.hidden = placing() || mode.points.length < 2;
    if (!form.hidden) {
      const image = imageNow();
      const a = floorPoint(image, mode.points[0]);
      const b = floorPoint(image, mode.points[1]);
      lineWords.textContent = 'The line is ' + lengthWords(Math.hypot(b.x - a.x, b.y - a.y), 'cells') + ' long on the floor now.';
      drawForm();
    }
  }

  function refuse(message, input) {
    refusal.textContent = message;
    refusal.hidden = false;
    for (const each of [lengthInput, cellInput]) {
      if (each === input) {
        each.setAttribute('aria-invalid', 'true');
        each.setAttribute('aria-describedby', 'scale-refusal');
      } else {
        each.removeAttribute('aria-invalid');
        each.removeAttribute('aria-describedby');
      }
    }
    ed.say(message);
    if (input) input.focus();
  }

  function clearRefusal() {
    refusal.textContent = '';
    refusal.hidden = true;
    for (const each of [lengthInput, cellInput]) {
      each.removeAttribute('aria-invalid');
      each.removeAttribute('aria-describedby');
    }
  }

  // ---------------------------------------------------------- the mode

  function end() {
    const was = mode !== null;
    mode = null;
    clearRefusal();
    lengthInput.value = '';
    cellInput.value = '';
    canvas.style.cursor = ed.tool.cursor;
    ed.setHint(ed.tool.hint);
    draw();
    ed.schedule();
    if (was && options.changed) options.changed();
  }

  function cancel(tell) {
    if (mode === null) return false;
    end();
    // the focus first: the plan says what it is when the keyboard brings it the focus
    canvas.focus({ preventScroll: true });
    if (tell) ed.say('Cancelled. The image is as it was.');
    return true;
  }

  function refuseStart(message) {
    ctx.toast({ kind: 'problem', text: message });
    ed.say(message);
  }

  // start(event, kind): from the Floor tab's buttons; a press by keyboard (no
  // pointer, event.detail 0) brings the plan's cursor up, ready for Enter
  function start(event, kind) {
    const how = kind === 'place' ? 'place' : 'scale';
    const floor = ed.floor;
    const image = floor.image;
    if (!image) return;
    if (image.locked) {
      refuseStart(how === 'place' ? 'The image is locked, so it cannot be placed. Untick "Lock the image" first.' : 'The image is locked, so it cannot be scaled. Untick "Lock the image" first.');
      return;
    }
    if (image.missing === true || options.isMissing(image)) {
      refuseStart('The image is not on this device, so there is nothing to place the points on. Choose the file again first.');
      return;
    }
    if (!image.visible) {
      refuseStart('The image is hidden, so the points cannot be placed on it. Tick "Show the image" first.');
      return;
    }
    options.stopMoving();
    if (ed.connect && ed.connect.active) ed.connect.cancel(false);
    if (mode !== null) end();
    mode = { kind: how, floorId: floor.id, imageId: image.imageId, points: [], targets: [], hover: null, press: null };
    unit = LENGTH_UNITS[0].value;
    units.set(unit);
    canvas.style.cursor = 'crosshair';
    if (ctx.closeInspector && typeof matchMedia === 'function' && matchMedia(SHEET_QUERY).matches) ctx.closeInspector();
    draw();
    canvas.focus({ preventScroll: true });
    if (event && event.detail === 0) ed.cursor.moveTo(ed.cursor.x, ed.cursor.y, true);
    ed.say(words.textContent);
    ed.schedule();
    if (options.changed) options.changed();
  }

  function restart() {
    if (mode === null) return;
    mode.points = [];
    mode.targets = [];
    clearRefusal();
    draw();
    canvas.focus({ preventScroll: true });
    ed.say(words.textContent);
    ed.schedule();
  }

  // A point at a place on the floor (cells). With two placed already, the
  // nearer of them is placed again.
  function place(at, how) {
    const image = imageNow();
    if (!image) return;
    if (placing() && mode.points.length === 2) {
      placeTarget(at);
      return;
    }
    const point = imagePoint(image, at);
    let which;
    if (mode.points.length < 2) {
      which = mode.points.length;
      mode.points.push(point);
    } else {
      const near = mode.points.map((each) => {
        const there = floorPoint(image, each);
        return Math.hypot(there.x - at.x, there.y - at.y);
      });
      which = near[1] < near[0] ? 1 : 0;
      mode.points[which] = point;
    }
    if (mode.points.length === 2 && pixelsApart(mode.points[0], mode.points[1]) < LEAST_PIXELS) {
      mode.points.splice(which, 1);
      const message = placing() ? 'The two points are in the same place on the image. Place the second point somewhere else on it, as far from the first as you can.' : 'The two points are in the same place on the image. Place the ' + (which === 0 ? 'first' : 'second') + ' point at the other end of a length you know.';
      ctx.toast({ kind: 'problem', text: message });
      draw();
      ed.say(message);
      ed.schedule();
      return;
    }
    const fresh = form.hidden;
    clearRefusal();
    draw();
    ed.schedule();
    if (mode.points.length < 2 || placing()) {
      ed.say(words.textContent);
      return;
    }
    ed.say(lineWords.textContent + ' How long is it really? Type the length, choose feet, metres or cells, and press Enter.');
    // the length field takes the focus, except under a finger: the on-screen
    // keyboard would rise over the plan the reader may still be placing on
    if (how !== 'touch' && fresh) lengthInput.focus({ preventScroll: true });
  }

  // Placing by two points: a place on the floor where a point belongs. The
  // second of them places the image, in one undo step.
  function placeTarget(at) {
    const image = imageNow();
    mode.targets.push({ x: at.x, y: at.y });
    if (mode.targets.length < 2) {
      draw();
      ed.schedule();
      ed.say(words.textContent);
      return;
    }
    let placed;
    try {
      placed = pointsPlacement(image, mode.points[0], mode.points[1], mode.targets[0], mode.targets[1]);
    } catch (error) {
      if (!(error instanceof ScaleError)) throw error;
      // the second place is taken back; the reader places it again
      mode.targets.pop();
      ctx.toast({ kind: 'problem', text: error.message });
      draw();
      ed.schedule();
      ed.say(error.message);
      return;
    }
    const floor = floorOf(mode.floorId);
    const said = 'Placed the image by two points: it is ' + round(image.width * placed.scale, 1) + ' cells wide, turned ' + round(placed.rotation, 1) + ' degrees.';
    const done = ed.commit(placeTraceImage, { floorId: floor.id, image: placed, how: 'points' }, { done: () => said, toast: () => said });
    if (!done) return;
    end();
    canvas.focus({ preventScroll: true });
    ed.say(said);
  }

  function apply() {
    const image = imageNow();
    if (!image || mode.points.length < 2) return;
    let length;
    try {
      length = readLength(lengthInput.value, 'The line');
    } catch (error) {
      refuse(error.message, lengthInput);
      return;
    }
    let known = cellScale();
    let fresh;
    if (unit !== 'cells' && !known) {
      try {
        fresh = { unit, length: readLength(cellInput.value, 'One cell', CELL_LENGTH_MOST) };
      } catch (error) {
        refuse(error.message, cellInput);
        return;
      }
      known = fresh;
    }
    let placement;
    let cells;
    try {
      cells = cellsFor(length, unit, known);
      placement = scaledPlacement(image, mode.points[0], mode.points[1], cells);
    } catch (error) {
      if (!(error instanceof ScaleError)) throw error;
      refuse(error.message, lengthInput);
      return;
    }
    const floor = floorOf(mode.floorId);
    const wide = round(image.width * placement.scale, 1);
    const said = 'Scaled the image: the line is ' + (unit === 'cells' ? lengthWords(length, 'cells') : lengthWords(length, unit) + ', ' + lengthWords(cells, 'cells')) + ', and the image is ' + wide + ' cells wide.'
      + (fresh ? ' One cell is ' + lengthWords(fresh.length, fresh.unit) + ' is kept as the project\'s Cell scale, in Settings.' : '');
    const payload = { floorId: floor.id, image: placement };
    if (fresh) payload.cellScale = fresh;
    const done = ed.commit(scaleTraceImage, payload, { done: () => said, toast: () => said });
    if (!done) return;
    end();
    canvas.focus({ preventScroll: true });
    ed.say(said);
  }

  // ---------------------------------------------------------- the plan's input

  function placeAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return ed.view.toCell(clientX - rect.left, clientY - rect.top);
  }

  // where a finger at (sx, sy) on the canvas puts its point, on the canvas
  function offsetFrom(sx, sy) {
    return { sx, sy: sy - OFFSET < 8 ? sy + OFFSET : sy - OFFSET };
  }

  function offFloor() {
    if (mode && ed.floor.id !== mode.floorId) {
      end();
      ed.say('Another floor is on show, so scaling the image has stopped.');
      return true;
    }
    return false;
  }

  function onDown(event) {
    if (mode === null) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (offFloor()) return;
    if (mode.press) {
      // a second finger: the point being placed is called off
      mode.press.off = true;
      ed.schedule();
      return;
    }
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) { /* a synthetic pointer has nothing to capture */ }
    const rect = canvas.getBoundingClientRect();
    mode.press = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, sx: event.clientX - rect.left, sy: event.clientY - rect.top, off: false };
    ed.schedule();
  }

  function onMove(event) {
    if (mode === null) return;
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    if (mode.press && event.pointerId === mode.press.id) {
      mode.press.sx = sx;
      mode.press.sy = sy;
      mode.press.moved = Math.max(mode.press.moved || 0, Math.hypot(event.clientX - mode.press.x, event.clientY - mode.press.y));
    } else if (!mode.press && event.pointerType !== 'touch') {
      mode.hover = { sx, sy };
    }
    ed.schedule();
  }

  function onUp(event) {
    if (mode === null) return;
    event.stopImmediatePropagation();
    const press = mode.press;
    if (!press || event.pointerId !== press.id) return;
    mode.press = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) { /* already let go */ }
    ed.schedule();
    if (press.off || event.type !== 'pointerup') return;
    if (press.type === 'touch') {
      const rect = canvas.getBoundingClientRect();
      const at = offsetFrom(event.clientX - rect.left, event.clientY - rect.top);
      place(ed.view.toCell(at.sx, at.sy), 'touch');
    } else {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) return;
      place(placeAt(event.clientX, event.clientY), press.type);
    }
  }

  function onLeave() {
    if (mode && mode.hover) {
      mode.hover = null;
      ed.schedule();
    }
  }

  function onKey(event) {
    if (mode === null) return;
    if (event.key === 'Escape') {
      // the menu and a dialog have Escape first
      if (event.target && event.target.closest && event.target.closest('[role="menu"], dialog')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel(true);
    } else if (event.key === 'Enter' && event.target === canvas && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (offFloor()) return;
      place({ x: ed.cursor.x + 0.5, y: ed.cursor.y + 0.5 }, 'keyboard');
    }
  }

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onUp, true);
  canvas.addEventListener('pointerleave', onLeave);
  // on the window, ahead of everything in the page: Escape and Enter here are this mode's
  window.addEventListener('keydown', onKey, true);

  // The project changed: the image may be gone, replaced or locked. A change
  // that only moves or resizes it keeps the points, which ride on the image.
  const unsubscribe = ed.store.subscribe(() => {
    if (mode === null) return;
    const floor = floorOf(mode.floorId);
    if (!floor || !floor.image || floor.image.imageId !== mode.imageId) {
      end();
      ed.say('The image is gone, so scaling it has stopped.');
    } else if (floor.image.locked) {
      end();
      ed.say('The image is locked now, so scaling it has stopped.');
    } else if (!floor.image.visible) {
      end();
      ed.say('The image is hidden now, so scaling it has stopped.');
    } else draw();
  });

  // ---------------------------------------------------------- the markers

  // Each point a ringed dot with its number, the line between them, and while
  // the second is placed by a mouse, a dashed line to the pointer. Under a
  // finger, the marker where the point will go and a thin line to the finger.
  function overlay(g, view, floor, theme) {
    if (mode === null) return;
    if (floor.id !== mode.floorId) {
      // drawn while another floor is on show: the mode ends after this draw
      queueMicrotask(offFloor);
      return;
    }
    const image = imageNow();
    if (!image) return;
    const size = view.size;
    const screen = (point) => {
      const at = floorPoint(image, point);
      return { sx: view.x + at.x * size, sy: view.y + at.y * size };
    };
    const shown = mode.points.map(screen);
    const halo = theme.paper;
    const ink = theme.accent;
    const stroke = (from, to, dashed) => {
      g.setLineDash([]);
      g.lineCap = 'round';
      g.strokeStyle = halo;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(from.sx, from.sy);
      g.lineTo(to.sx, to.sy);
      g.stroke();
      g.strokeStyle = ink;
      g.lineWidth = 2;
      if (dashed) g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(from.sx, from.sy);
      g.lineTo(to.sx, to.sy);
      g.stroke();
      g.setLineDash([]);
    };
    const marker = (at, label) => {
      g.fillStyle = halo;
      g.beginPath();
      g.arc(at.sx, at.sy, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(at.sx, at.sy, 7, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = ink;
      g.beginPath();
      g.arc(at.sx, at.sy, 2, 0, Math.PI * 2);
      g.fill();
      if (label) {
        g.font = '600 13px ' + theme.font;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.lineWidth = 4;
        g.strokeStyle = halo;
        g.strokeText(label, at.sx + 12, at.sy - 12);
        g.fillStyle = theme.ink;
        g.fillText(label, at.sx + 12, at.sy - 12);
      }
    };
    const press = mode.press;
    if (placing()) {
      placeMarks(g, view, theme, shown, stroke, marker);
      return;
    }
    if (shown.length === 2) stroke(shown[0], shown[1], false);
    let pending = pendingAt(g, ink);
    // with both points placed, the pointer alone draws nothing
    if ((!press || press.off) && shown.length >= 2) pending = null;
    if (pending && shown.length === 1) stroke(shown[0], pending, true);
    shown.forEach((at, i) => marker(at, String(i + 1)));
    if (pending && (press || shown.length < 2)) crosshair(g, pending, halo, ink);
  }

  // Where a press would put its point now: under a finger, the marker above
  // it (with a thin line to the finger); under a mouse, the pointer.
  function pendingAt(g, ink) {
    const press = mode.press;
    if (press && !press.off && press.type === 'touch') {
      const at = offsetFrom(press.sx, press.sy);
      g.strokeStyle = ink;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(press.sx, press.sy);
      g.lineTo(at.sx, at.sy);
      g.stroke();
      return at;
    }
    if (press && !press.off) return { sx: press.sx, sy: press.sy };
    return mode.hover;
  }

  // Placing by two points: the points on the image as numbered dots, each
  // place on the floor as a numbered square, and a dashed line from each point
  // to its place (to the pointer, for the place being chosen).
  function placeMarks(g, view, theme, shown, stroke, marker) {
    const halo = theme.paper;
    const ink = theme.accent;
    const size = view.size;
    const targets = mode.targets.map((at) => ({ sx: view.x + at.x * size, sy: view.y + at.y * size }));
    const pending = pendingAt(g, ink);
    targets.forEach((at, i) => stroke(shown[i], at, true));
    if (pending && shown.length === 2 && targets.length < 2) stroke(shown[targets.length], pending, true);
    if (pending && shown.length === 1) stroke(shown[0], pending, true);
    shown.forEach((at, i) => marker(at, String(i + 1)));
    targets.forEach((at, i) => {
      g.fillStyle = halo;
      g.fillRect(at.sx - 9, at.sy - 9, 18, 18);
      g.strokeStyle = ink;
      g.lineWidth = 2;
      g.strokeRect(at.sx - 6.5, at.sy - 6.5, 13, 13);
      g.fillStyle = ink;
      g.fillRect(at.sx - 2, at.sy - 2, 4, 4);
      g.font = '600 13px ' + theme.font;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      g.strokeStyle = halo;
      g.strokeText(String(i + 1), at.sx + 12, at.sy + 12);
      g.fillStyle = theme.ink;
      g.fillText(String(i + 1), at.sx + 12, at.sy + 12);
    });
    if (pending && (mode.press || targets.length < 2)) crosshair(g, pending, halo, ink);
  }

  // a crosshair where the point would go
  function crosshair(g, pending, halo, ink) {
    g.strokeStyle = halo;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(pending.sx - 10, pending.sy);
    g.lineTo(pending.sx + 10, pending.sy);
    g.moveTo(pending.sx, pending.sy - 10);
    g.lineTo(pending.sx, pending.sy + 10);
    g.stroke();
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.stroke();
  }

  return {
    start,
    cancel,
    get active() {
      return mode !== null;
    },
    get kind() {
      return mode === null ? null : mode.kind;
    },
    // for tests and the Floor tab: the points placed so far, in cells on the floor
    get points() {
      const image = imageNow();
      return mode && image ? mode.points.map((point) => floorPoint(image, point)) : [];
    },
    // placing by two points: the places on the floor chosen so far, in cells
    get targets() {
      return mode ? mode.targets.map((at) => ({ ...at })) : [];
    },
    overlay,
    detach() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onUp, true);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey, true);
      unsubscribe();
      box.remove();
    },
  };
}
