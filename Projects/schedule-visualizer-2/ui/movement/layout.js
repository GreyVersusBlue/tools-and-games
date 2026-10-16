// Where each floor sits on the movement view's one map. Every floor on
// screen is on the same canvas, in one space measured in cells, so one zoom
// and one pan move them all and a stairs link can be drawn from a floor to
// the next. A floor takes the box of what is drawn on it (viewport.js's
// drawnBox), with a row above for its name.
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
//
// No DOM in here.

import { CELL, clampZoom, drawnBox } from '../surface/viewport.js';

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
// the floors (KEEP_ON_STAGE in index.js), 116, so 120. A stage under that
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

export function stageLeast(layout, width, zoomRoom) {
  if (!layout || !(width > 0)) return STAGE_LEAST;
  const floor = Math.min(STAGE_LEAST, zoomRoom > 0 ? Math.ceil(zoomRoom) : ZOOM_ROOM);
  const zoom = clampZoom(Math.max(1, width - FIT_MARGIN * 2) / (layout.width * CELL));
  return Math.max(floor, Math.min(STAGE_LEAST, Math.ceil(layout.height * CELL * zoom + FIT_MARGIN * 2)));
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
