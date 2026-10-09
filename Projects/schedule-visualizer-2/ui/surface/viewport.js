// The viewport of a floor plan: where the plan sits in the window and how big
// a cell is. Every map in the tool uses this one, so zoom and pan behave the
// same everywhere (spec 3.12): zoom from 25% to 300%, a real fit to the
// window, and a zoom that keeps the point under the pointer where it is.
//
// No DOM in here. Lengths are CSS pixels measured from the top left of the
// canvas; the renderer multiplies by the device's pixel ratio.
//
//   const view = createViewport();
//   view.resize(width, height)
//   view.toScreen(column, row)        the top left of a cell
//   view.toCell(sx, sy)               { x, y } as fractions of cells
//   view.cellAt(floor, sx, sy)        { x, y, index, inside }, clamped to the floor
//   view.panBy(dx, dy)
//   view.zoomAbout(zoom, sx, sy)      set the zoom, keeping (sx, sy) still
//   view.fit(box, margin)             box is { x, y, w, h } in cells
//   view.visible(floor)               the cells on screen: { x0, y0, x1, y1 }, x1 and y1 exclusive
//   view.keepNear(floor)              never let the floor leave the window altogether
//   view.reveal(x, y)                 pan just enough to show a cell

export const CELL = 24;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.25;
// How much of the floor stays in the window however far it is dragged.
const KEEP = 48;

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function createViewport() {
  const view = {
    zoom: 1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,

    // The side of one cell, in CSS pixels.
    get size() {
      return CELL * view.zoom;
    },

    resize(width, height) {
      view.width = Math.max(0, width);
      view.height = Math.max(0, height);
    },

    toScreen(column, row) {
      return { x: view.x + column * view.size, y: view.y + row * view.size };
    },

    toCell(sx, sy) {
      return { x: (sx - view.x) / view.size, y: (sy - view.y) / view.size };
    },

    cellAt(floor, sx, sy) {
      const at = view.toCell(sx, sy);
      const column = Math.floor(at.x);
      const row = Math.floor(at.y);
      const inside = column >= 0 && row >= 0 && column < floor.width && row < floor.height;
      const x = Math.min(floor.width - 1, Math.max(0, column));
      const y = Math.min(floor.height - 1, Math.max(0, row));
      return { x, y, index: y * floor.width + x, inside };
    },

    panBy(dx, dy) {
      view.x += dx;
      view.y += dy;
    },

    zoomAbout(zoom, sx, sy) {
      const next = clampZoom(zoom);
      const at = view.toCell(sx, sy);
      view.zoom = next;
      view.x = sx - at.x * view.size;
      view.y = sy - at.y * view.size;
    },

    // Show the whole box, as large as the window and the zoom range allow,
    // in the middle of the window.
    fit(box, margin) {
      const pad = margin === undefined ? CELL : margin;
      const w = Math.max(1, box.w);
      const h = Math.max(1, box.h);
      const room = { w: Math.max(1, view.width - pad * 2), h: Math.max(1, view.height - pad * 2) };
      view.zoom = clampZoom(Math.min(room.w / (w * CELL), room.h / (h * CELL)));
      view.x = (view.width - w * view.size) / 2 - box.x * view.size;
      view.y = (view.height - h * view.size) / 2 - box.y * view.size;
    },

    visible(floor) {
      const from = view.toCell(0, 0);
      const to = view.toCell(view.width, view.height);
      return {
        x0: Math.max(0, Math.floor(from.x)),
        y0: Math.max(0, Math.floor(from.y)),
        x1: Math.min(floor.width, Math.ceil(to.x)),
        y1: Math.min(floor.height, Math.ceil(to.y)),
      };
    },

    keepNear(floor) {
      const w = floor.width * view.size;
      const h = floor.height * view.size;
      const keepX = Math.min(KEEP, w, view.width);
      const keepY = Math.min(KEEP, h, view.height);
      view.x = Math.min(view.width - keepX, Math.max(keepX - w, view.x));
      view.y = Math.min(view.height - keepY, Math.max(keepY - h, view.y));
    },

    reveal(column, row) {
      const at = view.toScreen(column, row);
      const pad = Math.min(view.size, view.width / 4, view.height / 4);
      if (at.x < pad) view.x += pad - at.x;
      else if (at.x + view.size > view.width - pad) view.x -= at.x + view.size - (view.width - pad);
      if (at.y < pad) view.y += pad - at.y;
      else if (at.y + view.size > view.height - pad) view.y -= at.y + view.size - (view.height - pad);
    },

    // The zoom and the place, to put back later (another floor, another visit).
    save() {
      return { zoom: view.zoom, x: view.x, y: view.y };
    },

    restore(saved) {
      view.zoom = clampZoom(saved.zoom);
      view.x = saved.x;
      view.y = saved.y;
    },
  };
  return view;
}

// The box around everything drawn on a floor, in cells, with one cell of air
// round it; the whole floor when nothing is drawn.
export function drawnBox(floor) {
  let x0 = floor.width;
  let y0 = floor.height;
  let x1 = -1;
  let y1 = -1;
  const take = (cell) => {
    const x = cell % floor.width;
    const y = Math.floor(cell / floor.width);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (let cell = 0; cell < floor.cells.length; cell += 1) if (floor.cells[cell] !== '.') take(cell);
  for (const space of floor.spaces) for (const cell of space.cells) take(cell);
  if (x1 === -1) return { x: 0, y: 0, w: floor.width, h: floor.height, empty: true };
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(floor.width - 1, x1 + 1);
  y1 = Math.min(floor.height - 1, y1 + 1);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, empty: false };
}
