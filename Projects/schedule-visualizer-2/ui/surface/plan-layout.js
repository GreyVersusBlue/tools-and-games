// Where each floor sits on the plan map (./plan-map.js), which Movement,
// Scenarios and Safety mount. Every floor on screen is on the same canvas,
// in one space measured in cells, so one zoom and one pan move them all and
// a stairs link can be drawn from a floor to the next. A floor takes the
// box of what is drawn on it (viewport.js's drawnBox), with a row above for
// its name.
//
//   layoutFloors(floors, how) -> { how, slots, width, height }
//     how     'side' (side by side, in the building's order) or 'stacked'
//             (one under another)
//     slots   [{ floor, box, x, y, w, h }]: (x, y) is where the box's top
//             left cell is, in the map's cells
//   bestLayout(floors, width, height)   'side' or 'stacked': whichever fits the window larger
//   slotAt(layout, x, y)                { slot, x, y, cell } for a place on the map, or null between floors
//   placeOf(layout, floorId, cell)      { x, y }: the top left of a floor's cell on the map, or null
//   stageLeast(layout, width, zoomRoom) the least height the stage is given, in CSS pixels
//   keepShift(view, layout, keep)       { dx, dy }: the pan that leaves `keep` px of the floors on the stage
//   fitClear(layout, width, height, corner, margin)   { zoom, x, y, how, clear }: the fit
//                                       that leaves no painted cell under `corner` (the zoom box)
//   paintedUnder(layout, place, rect)   true when a painted cell lies under rect at that place
//
// No DOM in here.

import { CELL, clampZoom, drawnBox } from './viewport.js';

// Cells between two floors, and the rows kept above a floor for its name.
// Whole numbers, so the keyboard cursor's cells are the floors' cells.
export const FLOOR_GAP = 2;
export const TITLE_ROWS = 2;

export function layoutFloors(floors, how) {
  const slots = [];
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  for (const floor of floors) {
    const box = drawnBox(floor);
    if (how === 'stacked') {
      slots.push({ floor, box, x: 0, y: y + TITLE_ROWS, w: box.w, h: box.h });
      y += TITLE_ROWS + box.h + FLOOR_GAP;
      width = Math.max(width, box.w);
      height = y - FLOOR_GAP;
    } else {
      slots.push({ floor, box, x, y: TITLE_ROWS, w: box.w, h: box.h });
      x += box.w + FLOOR_GAP;
      width = x - FLOOR_GAP;
      height = Math.max(height, TITLE_ROWS + box.h);
    }
  }
  return { how: how === 'stacked' ? 'stacked' : 'side', slots, width: Math.max(1, width), height: Math.max(1, height) };
}

// The zoom at which a map of this size fits the window.
export function fitZoom(layout, width, height, margin) {
  const pad = margin === undefined ? CELL : margin;
  return clampZoom(Math.min(Math.max(1, width - pad * 2) / (layout.width * CELL), Math.max(1, height - pad * 2) / (layout.height * CELL)));
}

// The map is fitted with this margin, in CSS pixels, all round.
export const FIT_MARGIN = 20;

// The least the stage is given, in CSS pixels, however little the section
// has (SV2-55): the zoom buttons' 44 px finger targets with their 12 px
// margins (68), and over them the 48 px a pan or a zoom always leaves of
// the floors (KEEP_ON_STAGE in ./plan-map.js), 116, so 120. A stage under that
// is a strip with the zoom lying over it (41 px at 844 by 390 on a touch
// screen, on the live site after #562). When the floors' whole box, fitted
// across the stage's width, is shorter than that, the box is enough, but
// never less than the zoom box needs (SV2-57): a long low building's box is
// 58 px at 844 px wide, under the zoom's 70 (44 px buttons, their 2 px of
// border and 12 px of margin each way), and the zoom then lay over all of
// it. `zoomRoom` is that need as the view measures it; ZOOM_ROOM when it is
// not given.
export const STAGE_LEAST = 120;
export const ZOOM_ROOM = 70;

// `most` is a least a section asks for in place of STAGE_LEAST (Safety's
// 160, SV2-72c W5). It is capped by the floors' box at Fit across the width
// standing above the zoom buttons (the box, its top margin, ZOOM_GAP and
// the zoom box's need), not by the box alone: a stage only as tall as the
// box puts the floors beside the buttons at the least zoom (Safety on a
// phone on its side was 137 px, the sample's floors 96 px tall at 25 %).
export function stageLeast(layout, width, zoomRoom, most) {
  const own = most > 0;
  const top = own ? most : STAGE_LEAST;
  if (!layout || !(width > 0)) return top;
  const need = zoomRoom > 0 ? Math.ceil(zoomRoom) : ZOOM_ROOM;
  const floor = Math.min(top, need);
  const zoom = clampZoom(Math.max(1, width - FIT_MARGIN * 2) / (layout.width * CELL));
  const box = layout.height * CELL * zoom;
  const enough = own ? box + FIT_MARGIN + ZOOM_GAP + need : box + FIT_MARGIN * 2;
  return Math.max(floor, Math.min(top, Math.ceil(enough)));
}

export function bestLayout(floors, width, height) {
  if (floors.length < 2) return 'side';
  return fitZoom(layoutFloors(floors, 'stacked'), width, height) > fitZoom(layoutFloors(floors, 'side'), width, height) ? 'stacked' : 'side';
}

export function slotAt(layout, x, y) {
  for (const slot of layout.slots) {
    if (x < slot.x || y < slot.y || x >= slot.x + slot.w || y >= slot.y + slot.h) continue;
    const fx = Math.floor(x - slot.x) + slot.box.x;
    const fy = Math.floor(y - slot.y) + slot.box.y;
    return { slot, x: fx, y: fy, cell: fy * slot.floor.width + fx };
  }
  return null;
}

export function placeOf(layout, floorId, cell) {
  const slot = layout.slots.find((each) => each.floor.id === floorId);
  if (!slot) return null;
  return { x: slot.x + (cell % slot.floor.width) - slot.box.x, y: slot.y + Math.floor(cell / slot.floor.width) - slot.box.y };
}

// The pan, in CSS pixels, that leaves at least `keep` px of the floors' box
// on the stage each way (all of the box where it is smaller), so no pan or
// zoom takes the map off the stage. `view` is { x, y, size, width, height }.
// The keep is never more than the stage itself (SV2-55, as the building
// editor's keepNear): a stage shorter than the keep cannot hold it at both
// edges at once, and the pan would go one way and back again on every event
// (a 30 px stage over a 60 px box went -12, -18, -12, -18).
export function keepShift(view, layout, keep) {
  if (!layout || !(view.width > 0) || !(view.height > 0)) return { dx: 0, dy: 0 };
  const across = layout.width * view.size;
  const down = layout.height * view.size;
  const keepX = Math.min(keep, across, view.width);
  const keepY = Math.min(keep, down, view.height);
  let dx = 0;
  let dy = 0;
  if (view.x + across < keepX) dx = keepX - (view.x + across);
  else if (view.x > view.width - keepX) dx = view.width - keepX - view.x;
  if (view.y + down < keepY) dy = keepY - (view.y + down);
  else if (view.y > view.height - keepY) dy = view.height - keepY - view.y;
  return { dx, dy };
}

// ---- Fit with the zoom box's corner clear (SV2-72c, the M5 walk-through's
// W1). The zoom buttons sit over the stage's bottom left corner, and a plain
// fit puts the floors under them: Floor 3's lower rooms in Scenarios at 1440
// and 1280, Room 303 on a phone. A fit that would put a painted cell (a
// corridor, stairs, a room or another space, anything but an empty cell)
// under the box is made instead in the stage less the box: in the band
// above the box, or where that cannot clear it (a strip of a stage at the
// least zoom), in the band right of it. Where the
// plain fit puts only empty cells there (the drawn box's air, a gap between
// floors, a building that does not reach the corner), it stands. The bands
// are an inset at fit rather than the buttons moved where no floor is drawn:
// every map keeps its buttons in the one place a finger and a test know,
// and a pan or a zoom after Fit may still go under them, as it may under any
// control (DESIGN 1, "never over the plan", holds at Fit, the picture every
// section opens on).

// The gap kept between the floors and the zoom box, in CSS pixels; where
// the floors' names would otherwise run off the stage's top, as little as
// ZOOM_GAP_LEAST over the box.
export const ZOOM_GAP = 8;
export const ZOOM_GAP_LEAST = 4;

// which cells of a floor are drawn on: 1 for a painted cell, kept by the floor object
const paintedMasks = new WeakMap();
export function paintedMask(floor) {
  const held = paintedMasks.get(floor);
  if (held) return held;
  const mask = new Uint8Array(floor.width * floor.height);
  for (let cell = 0; cell < mask.length; cell += 1) if (floor.cells[cell] !== '.') mask[cell] = 1;
  for (const space of floor.spaces) for (const cell of space.cells) if (cell >= 0 && cell < mask.length) mask[cell] = 1;
  paintedMasks.set(floor, mask);
  return mask;
}

// place = { zoom, x, y } (the map's top left on the stage), rect = { x, y, w, h } in stage px
export function paintedUnder(layout, place, rect) {
  const size = CELL * place.zoom;
  for (const slot of layout.slots) {
    const left = place.x + slot.x * size;
    const top = place.y + slot.y * size;
    const x0 = Math.max(0, Math.floor((rect.x - left) / size));
    const y0 = Math.max(0, Math.floor((rect.y - top) / size));
    const x1 = Math.min(slot.w, Math.ceil((rect.x + rect.w - left) / size));
    const y1 = Math.min(slot.h, Math.ceil((rect.y + rect.h - top) / size));
    if (x0 >= x1 || y0 >= y1) continue;
    const mask = paintedMask(slot.floor);
    const width = slot.floor.width;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) if (mask[(slot.box.y + y) * width + slot.box.x + x]) return true;
    }
  }
  return false;
}

// The layout fitted in a band of the stage, with its own margins { t, r, b,
// l }, in the band's middle. At the least zoom a map can be larger than its
// band; it is then kept to the band on the side `keep` names ('bottom' for
// the band above the zoom box, 'left' for the band beside it), so the box's
// corner stays clear and the map runs off the stage's other side. 'top'
// keeps the band above the box with the map's top in it: the floors' names
// stay whole and the margins over and under go first (Safety on a phone on
// its side cut "Floor 1" by 2 px running off the top, SV2-72c2).
function placeIn(layout, band, m, keep) {
  const zoom = clampZoom(Math.min(Math.max(1, band.w - m.l - m.r) / (layout.width * CELL), Math.max(1, band.h - m.t - m.b) / (layout.height * CELL)));
  const size = CELL * zoom;
  let x = band.x + m.l + (band.w - m.l - m.r - layout.width * size) / 2;
  let y = band.y + m.t + (band.h - m.t - m.b - layout.height * size) / 2;
  if (keep === 'left') x = Math.max(x, band.x + m.l);
  if (keep === 'bottom' || keep === 'top') y = Math.min(y, band.y + band.h - m.b - layout.height * size);
  if (keep === 'top') y = Math.max(y, band.y);
  return { zoom, x, y };
}

// corner = the zoom box on the stage { x, y, w, h }, or null when it has no
// box yet. The band above the box is taken whenever it leaves the corner
// clear with the map whole on the stage, the band beside it only when that
// one cannot, and the plain fit, not clear, when neither is whole on the
// stage and it is (SV2-72f); only where the plain fit is not whole either
// (a strip at the least zoom) the clear band that shows more. The band beside moves the floors
// right, toward a card on the stage's bottom right, so a section that asks
// where the floors lie at Fit asks this, not a plain fit (the map's fitAt;
// Movement's legend, docked when its card would lie on a floor:
// ui/movement/index.js coversFloor, SV2-72c2).
export function fitClear(layout, width, height, corner, margin) {
  const pad = margin === undefined ? FIT_MARGIN : margin;
  const all = { t: pad, r: pad, b: pad, l: pad };
  const whole = placeIn(layout, { x: 0, y: 0, w: width, h: height }, all);
  if (!corner || !(corner.w > 0) || !(corner.h > 0)) return { ...whole, how: 'whole', clear: true };
  const box = { x: corner.x - ZOOM_GAP, y: corner.y - ZOOM_GAP, w: corner.w + ZOOM_GAP * 2, h: corner.h + ZOOM_GAP * 2 };
  if (!paintedUnder(layout, whole, box)) return { ...whole, how: 'whole', clear: true };
  // each band's fit, whether it clears the corner, and how much of the map
  // is on the stage in it (all of it, except at the least zoom)
  const onStage = (place) => {
    const size = CELL * place.zoom;
    const w = layout.width * size;
    const h = layout.height * size;
    const seen = Math.max(0, Math.min(width, place.x + w) - Math.max(0, place.x)) * Math.max(0, Math.min(height, place.y + h) - Math.max(0, place.y));
    return seen / (w * h);
  };
  // the band above with the map's top kept on the stage: the gap over the
  // box is what is left under the map, ZOOM_GAP_LEAST to ZOOM_GAP, and the
  // corner is clear when no painted cell lies in the box or that gap
  const band = { x: 0, y: 0, w: width, h: Math.max(0, corner.y) };
  const kept = placeIn(layout, band, { ...all, b: ZOOM_GAP }, 'top');
  const left = Math.max(ZOOM_GAP_LEAST, Math.min(ZOOM_GAP, corner.y - (kept.y + layout.height * CELL * kept.zoom)));
  const keptBox = { x: box.x, y: corner.y - left, w: box.w, h: corner.h + left + ZOOM_GAP };
  const [above, beside, off] = [
    { ...kept, how: 'above', clear: !paintedUnder(layout, kept, keptBox) },
    { ...placeIn(layout, { x: corner.x + corner.w, y: 0, w: Math.max(0, width - corner.x - corner.w), h: height }, { ...all, l: ZOOM_GAP }, 'left'), how: 'beside' },
    // a strip at the least zoom: the band above, the map run off the stage's top
    { ...placeIn(layout, band, { ...all, b: ZOOM_GAP }, 'bottom'), how: 'above' },
  ].map((place) => ({ ...place, clear: place.clear === undefined ? !paintedUnder(layout, place, box) : place.clear, shown: onStage(place) }));
  // above, clear and whole; else beside, clear and whole; else the plain
  // fit when it is whole on the stage, the zoom buttons over some of it
  // (SV2-72f: a fit that leaves a floor off the stage is no fit, spec 3.12;
  // at 844 by 390 the band beside put Floor 3 158 px past the stage's right
  // edge); else of those that are clear the one that shows more of the map,
  // the top kept on a tie
  const clear = [above, beside, off].filter((place) => place.clear);
  const wholeOn = { ...whole, how: 'whole', clear: false };
  const pick = clear.find((place) => place.shown > 1 - 1e-9) || (onStage(wholeOn) > 1 - 1e-9 ? wholeOn : null) || clear.sort((a, b) => b.shown - a.shown + (a === off ? 1e-9 : 0) - (b === off ? 1e-9 : 0))[0] || above;
  const { shown, ...place } = pick;
  return place;
}
