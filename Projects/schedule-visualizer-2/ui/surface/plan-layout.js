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
//   bestLayout(floors, width, height, current, layouts, at)   'side' or 'stacked': one Fit
//                                       draws whole on the window over one it does not (`at`:
//                                       { foot, corner }, the sticky foot and the zoom box); then
//                                       one whole above the foot at no less zoom; else whichever fits
//                                       larger (a tie at the least zoom to the one nearer to
//                                       fitting); `current` is kept unless the other wins by
//                                       more than LAYOUT_MARGIN
//   fitZoom(layout, width, height, margin)   the zoom a map fits a window at, 25 % to 300 %
//   rawZoom(layout, width, height, margin)   the same before the clamp
//   slotAt(layout, x, y)                { slot, x, y, cell } for a place on the map, or null between floors
//   placeOf(layout, floorId, cell)      { x, y }: the top left of a floor's cell on the map, or null
//   stageLeast(layout, width, zoomRoom) the least height the stage is given, in CSS pixels
//   keepShift(view, layout, keep)       { dx, dy }: the pan that leaves `keep` px of the floors on the stage
//   fitClear(layout, width, height, corner, margin)   { zoom, x, y, how, clear }: the fit
//                                       that leaves no painted cell under `corner` (the zoom box)
//   paintedUnder(layout, place, rect)   true when a painted cell lies under rect at that place
//   chooseFit(layout, width, height, foot, corner, margin)   { zoom, x, y, how, clear, in }:
//                                       where Fit puts the floors with `foot` px of a sticky
//                                       foot over the stage (the plan map's choose)
//   zoomCornerAt(height, box, margin, lift)   the zoom box on the stage, lifted
//   liftOver(height, box, margin, over)  how far the zoom box lifts over a foot
//
// No DOM in here.

import { CELL, MIN_ZOOM, MAX_ZOOM, clampZoom, drawnBox } from './viewport.js';

// Cells between two floors, and the rows kept above a floor for its name.
// Whole numbers, so the keyboard cursor's cells are the floors' cells.
export const FLOOR_GAP = 2;
export const TITLE_ROWS = 2;

// A floor's drawn box, kept by the floor object as paintedMask keeps its
// cells: a floor of the project is never changed in place (the store makes a
// new one), and the layout is asked for both arrangements on every measure.
const drawnBoxes = new WeakMap();
function boxOf(floor) {
  let box = drawnBoxes.get(floor);
  if (!box) {
    box = drawnBox(floor);
    drawnBoxes.set(floor, box);
  }
  return { ...box };
}

export function layoutFloors(floors, how) {
  const slots = [];
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  for (const floor of floors) {
    const box = boxOf(floor);
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

// The zoom at which a map of this size fits the window; rawZoom is it
// before the clamp (bestLayout's tie at the least zoom reads it).
export function fitZoom(layout, width, height, margin) {
  return clampZoom(rawZoom(layout, width, height, margin));
}
export function rawZoom(layout, width, height, margin) {
  const pad = margin === undefined ? CELL : margin;
  return Math.min(Math.max(1, width - pad * 2) / (layout.width * CELL), Math.max(1, height - pad * 2) / (layout.height * CELL));
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

// A layout fits a stage when Fit can put every floor on it: its box at the
// least zoom no wider and no taller than the stage, Fit's margin left out
// (SV2-72i). Fit centres a map it cannot give its margin, so a box that
// fits the stage at 25 % is whole on it with less margin; one that fits only
// with the margin left out was judged not to fit before, and the layout on
// the map was kept off the stage where the other was whole (700 by 300 with
// side by side on the map: 22 px off each edge, stacked 282 px tall in 300).
//
// One that fits beats one that does not, whichever is on the map: a fit with
// a floor off the stage is no fit (SV2-72f). Where both fit, or neither, a
// layout's score is its zoom unclamped with Fit's margin, capped at the
// most: where both fit only at the least zoom the clamp makes them a tie,
// and the tie goes to the one that comes nearer to fitting with its margin
// (SV2-72g: at 1024 wide Movement's 648 px stage took the sample's floors
// side by side, 744 px at 25 %, 48 px off the stage's left edge, where
// stacked, 240 by 282, fits).
//
// The layout on the map now (`current`) is kept unless the other's score is
// more than LAYOUT_MARGIN over its own (SV2-72h): the stage's least follows
// the layout (stageLeast), so where the two are near a choice moved the
// stage and the stage moved the choice, and a size opened stacked or side by
// side by the order things were measured in, or turned at each pixel of a
// resize. 5 %: a fifth of one press of the zoom buttons (25 %), less than
// anyone sees between two layouts, and more than a scroll bar coming or
// going takes from a stage (15 px of a 400 px stage, 3.75 %).
//
// No margin across the fit itself (SV2-72i): a layout that stops fitting is
// left at that pixel, since keeping it would put a floor off the stage, and
// one that starts fitting is taken at once only where the one on the map
// does not fit; where both fit the turn to it waits for LAYOUT_MARGIN like
// any other. So a window moved a pixel either way across where one layout
// stops fitting turns at most once each way, at different pixels, and the
// two-way flip SV2-72h's review found at 321 and 322 px tall (749 to 783
// wide) is gone with the margin left out of the fit: stacked fits from 282
// px there, not from 322.
//
// "Fits" is judged on what Fit draws (SV2-32a): the place chooseFit puts
// the layout at, with the sticky foot and the zoom box as `at` gives them
// ({ foot, corner }; none when left out), every floor whole on the stage
// there. It was judged on the box at the least zoom with no foot, and where
// the foot lay over the stage Fit could draw a layout called fitting off it
// (798 by 120 with a 40 px foot: side by side past the right edge, the clear
// band beside the zoom box). chooseFit now keeps a layout on the stage
// wherever its plain fit is, so the two answers agree, and a scroll that
// moves the foot cannot turn the layout; the judgement reads the drawing so
// that a later change to chooseFit is judged as it draws.
//
// Where both are whole on the stage and the foot lies over one and not the
// other, the one Fit draws whole above the foot is taken where Fit draws it
// larger, LAYOUT_MARGIN waived, and on a tie where no layout is on the map
// yet (SV2-32a: a layout was kept under the foot where the other was whole
// above it). Not on a tie with one on the map: a layout that has just
// started fitting is at the least zoom, and taking it there over one at the
// least zoom under the foot turned the layout back and forth across a
// single pixel (744 by 300 with a 40 px foot: side by side whole above the
// foot at 744 wide, off the stage at 743). Larger cannot happen at that
// pixel, so the turn to it waits for the zoom to tell the two apart.
//
// `layouts`, when given, is { side, stacked } already laid out for these
// floors (layoutFloors), so the plan map lays them out once per arrange.
export const LAYOUT_MARGIN = 0.05;
export function bestLayout(floors, width, height, current, layouts, at) {
  if (floors.length < 2) return 'side';
  const foot = at && at.foot > 0 ? at.foot : 0;
  const corner = at ? at.corner || null : null;
  const score = (how) => {
    const layout = (layouts && layouts[how]) || layoutFloors(floors, how);
    const place = chooseFit(layout, width, height, foot, corner, FIT_MARGIN);
    return { fits: wholeAt(layout, place, width, height), above: place.in === 'shown', zoom: place.zoom, value: Math.min(rawZoom(layout, width, height, FIT_MARGIN), MAX_ZOOM) };
  };
  const stacked = score('stacked');
  const side = score('side');
  if (stacked.fits !== side.fits) return stacked.fits ? 'stacked' : 'side';
  // whole above the foot over whole under it, where it costs no zoom
  if (stacked.fits && stacked.above !== side.above) {
    const [up, down] = stacked.above ? [stacked, side] : [side, stacked];
    const fresh = current !== 'stacked' && current !== 'side';
    if (up.zoom > down.zoom || (fresh && up.zoom === down.zoom)) return stacked.above ? 'stacked' : 'side';
  }
  if (current === 'stacked' || current === 'side') {
    const kept = current === 'stacked' ? stacked : side;
    const other = current === 'stacked' ? side : stacked;
    if (!(other.value > kept.value * (1 + LAYOUT_MARGIN))) return current;
    return current === 'stacked' ? 'side' : 'stacked';
  }
  return stacked.value > side.value ? 'stacked' : 'side';
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
// (a strip at the least zoom), or `plainWhole` is false, the clear band
// that shows more. The plan map passes false where the floors cannot be
// whole above a sticky foot: whole there would be under the foot. The band
// beside moves the floors right, toward a card on the stage's bottom right,
// so a section that asks where the floors lie at Fit asks the map's fitAt,
// never this alone or a plain fit: fitAt takes the plan map's choose, this
// above the foot and on the whole stage as Fit does (Movement's legend,
// docked when its card would lie on a floor: ui/movement/index.js
// coversFloor, SV2-72c2 and SV2-72f2).
export function fitClear(layout, width, height, corner, margin, plainWhole = true) {
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
  const pick = clear.find((place) => place.shown > 1 - 1e-9) || (plainWhole && onStage(wholeOn) > 1 - 1e-9 ? wholeOn : null) || clear.sort((a, b) => b.shown - a.shown + (a === off ? 1e-9 : 0) - (b === off ? 1e-9 : 0))[0] || above;
  const { shown, ...place } = pick;
  return place;
}

// ---- The zoom box over a sticky foot, and Fit with the foot (the plan
// map's choose; SV2-72c2, SV2-72f, SV2-72f2). Here, with no DOM, so the
// rule that picks a layout (bestLayout) and a Node sweep can judge the very
// place Fit draws (SV2-32a). The plan map reads the boxes off the page and
// hands them in.

// How far the zoom buttons lift over a foot `over` px over a stage `height`
// tall: by the foot, never out of the stage's top. `box` is the zoom box's
// height, `margin` its distance from the stage's edges (its CSS left).
export function liftOver(height, box, margin, over) {
  const most = Math.max(0, height - box - margin * 2);
  return Math.round(Math.min(most, Math.max(0, over)));
}

// The zoom box on a stage `height` tall, lifted by `lift`: { x, y, w, h }
// in the stage's pixels, its bottom left corner where the sheet puts it.
export function zoomCornerAt(height, box, margin, lift) {
  const rest = height - margin - box.h;
  return { x: margin, y: rest - Math.max(0, Math.min(lift, rest)), w: box.w, h: box.h };
}

// Where Fit puts `layout` on a stage `width` by `height` with `foot` px of a
// sticky foot over its foot and the zoom box at `corner` (null for none):
// in the part of the stage the foot leaves (all of it with no foot over
// it), where the floors are whole in it, clear of the zoom buttons if a
// band can be, else the plain fit (SV2-72f: at 844 by 390 the foot still
// lies 12 px over Movement's stage once the first line stops clearFoot).
// Where they cannot be whole there, on the whole stage by fitClear's own
// rule: a band clear of the zoom buttons with the floors whole, else the
// plain fit with the buttons over some of it, and only where neither is
// whole the clear band that shows more. `in` says which: 'shown' or 'stage'.
//
// The whole stage took the clear band before the plain fit (plainWhole
// false; SV2-72f2), for "whole there would be under the foot". So is the
// band: it is fitted on the whole stage too, and the one it came to was the
// band beside the zoom box, which at the least zoom runs past the stage's
// right edge (SV2-32a: 798 by 120 with a 40 px foot, Floor 3 to 934 px of
// 798 with a mouse, where the plain fit puts every floor on the stage). A
// fit with a floor off the stage is no fit (SV2-72f), under the foot or not.
// So a layout is drawn whole on the stage exactly where its plain fit is
// whole, whatever the foot and the zoom box, and bestLayout's judgement of
// what is drawn cannot be turned by a scroll.
export function chooseFit(layout, width, height, foot, corner, margin) {
  const shown = height - foot;
  const seen = fitClear(layout, width, shown, corner, margin);
  if (wholeAt(layout, seen, width, shown)) return { ...seen, in: 'shown' };
  return { ...fitClear(layout, width, height, corner, margin), in: 'stage' };
}

// true when the map's box (the floors with their names) lies whole on a
// stage `width` by `height` at `place`
export function wholeAt(layout, place, width, height) {
  const size = CELL * place.zoom;
  return place.y >= -1e-9 && place.y + layout.height * size <= height + 1e-9 && place.x >= -1e-9 && place.x + layout.width * size <= width + 1e-9;
}
