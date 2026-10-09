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
