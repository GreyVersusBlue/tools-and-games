// plat.js — draws the ground under the markers. Phase 6.
//
// paintPlat(ctx, view, opts) paints a surveyor's plat onto a 2D canvas
// context: the double rule around the sheet, the tracks' brown rule, every
// cell's terrain with the same textures the .terrain-cell CSS used to paint
// (dots on a clearing, a diagonal hatch on a hill, two dot lattices in the
// woods, ticks along a path), a cartouche and a compass in the bottom band,
// and, in screen space, a shade on any edge the content runs past. All of
// it in content units under the view's transform from mapview.js, so the
// terrain sits exactly under the DOM marker layer that shares the view.
//
// Nothing here reads the document. The ctx is a parameter, which is what
// lets tests/mapview.mjs hand it a recorder and count the cells.

import { FRAME, TRACK, contentSize, trackSize, cellOrigin, edges } from './mapview.js';

export const INK = '#6B5433';
export const RULE_INK = 'rgba(107, 84, 51, 0.85)';
export const TERRAIN_FILL = {
  clearing: '#93A052',
  hill: '#BC9C52',
  woods: '#33512F',
  path: '#A57B4C',
};
export const EDGE_SHADE = 24;

export function paintPlat(ctx, view, opts) {
  const dpr = opts.dpr || 1;
  const terrainAt = opts.terrainAt;
  const vw = view.viewport.w, vh = view.viewport.h;
  const c = contentSize(view.cols, view.rows, view.cell);
  const t = trackSize(view.cols, view.rows, view.cell);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  // Content space from here down.
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);

  // The paper's double rule: an outer heavy line and an inner hairline,
  // the way a real plat sheet is bordered.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(1.5, 1.5, c.w - 3, c.h - 3);
  ctx.lineWidth = 0.6;
  ctx.strokeRect(5, 5, c.w - 10, c.h - 10);

  // The tracks: a brown slab exactly the size of the grid, which shows
  // through the 1px gaps as the rule between cells and round the outside
  // as the border. Not a pixel wider (#247).
  ctx.fillStyle = INK;
  ctx.fillRect(FRAME.left, FRAME.top, t.w, t.h);

  for (let y = 0; y < view.rows; y++) {
    for (let x = 0; x < view.cols; x++) {
      const terrain = terrainAt(x, y) || 'clearing';
      const o = cellOrigin(x, y, view.cell);
      paintCell(ctx, o.x, o.y, view.cell, terrain);
    }
  }

  paintCartouche(ctx, c, t, opts);

  // Screen space: a shade on any side the content runs past, so a panned
  // map says which way the rest of it is.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const e = edges(view);
  const shade = (x0, y0, x1, y1, w, h) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(20, 17, 14, 0.55)');
    g.addColorStop(1, 'rgba(20, 17, 14, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
  };
  if (e.west) shade(0, 0, EDGE_SHADE, 0, EDGE_SHADE, vh);
  if (e.east) shade(vw, 0, vw - EDGE_SHADE, 0, EDGE_SHADE, vh);
  if (e.north) shade(0, 0, 0, EDGE_SHADE, vw, EDGE_SHADE);
  if (e.south) shade(0, vh, 0, vh - EDGE_SHADE, vw, EDGE_SHADE);
  return e;
}

function paintCell(ctx, x, y, cell, terrain) {
  ctx.fillStyle = TERRAIN_FILL[terrain] || TERRAIN_FILL.clearing;
  ctx.fillRect(x, y, cell, cell);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, cell, cell);
  ctx.clip();
  if (terrain === 'clearing') {
    // radial-gradient(rgba(255,255,255,0.13) 1px, transparent 1.4px) on a 9px lattice
    ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
    dots(ctx, x, y, cell, 9, 0, 0, 1.1);
  } else if (terrain === 'hill') {
    // repeating-linear-gradient(58deg, rgba(94,68,26,0.24) 0 1px, transparent 1px 7px)
    ctx.strokeStyle = 'rgba(94, 68, 26, 0.24)';
    ctx.lineWidth = 1;
    hatch(ctx, x, y, cell, 58, 7);
  } else if (terrain === 'woods') {
    // two 11px dot lattices, one light and one dark, offset (5, 6)
    ctx.fillStyle = 'rgba(126, 168, 106, 0.5)';
    dots(ctx, x, y, cell, 11, 0, 0, 1.6);
    ctx.fillStyle = 'rgba(18, 36, 20, 0.55)';
    dots(ctx, x, y, cell, 11, 5, 6, 1.6);
  } else if (terrain === 'path') {
    // repeating-linear-gradient(90deg, rgba(255,240,214,0.16) 0 1px, transparent 1px 5px)
    ctx.fillStyle = 'rgba(255, 240, 214, 0.16)';
    for (let px = 0; px < cell; px += 5) ctx.fillRect(x + px, y, 1, cell);
  }
  ctx.restore();
}

function dots(ctx, x, y, cell, pitch, ox, oy, r) {
  for (let dy = oy; dy < cell; dy += pitch) {
    for (let dx = ox; dx < cell; dx += pitch) {
      ctx.beginPath();
      ctx.arc(x + dx + pitch / 2, y + dy + pitch / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Parallel lines at `deg` from the x-axis, `pitch` apart, across the cell's
// bounding box (the caller has clipped to the cell).
function hatch(ctx, x, y, cell, deg, pitch) {
  const a = deg * Math.PI / 180;
  const nx = -Math.sin(a), ny = Math.cos(a); // unit normal to the lines
  const dx = Math.cos(a) * cell * 2, dy = Math.sin(a) * cell * 2;
  const cx = x + cell / 2, cy = y + cell / 2;
  const reach = cell; // half the diagonal is under cell * 0.71; a full cell covers it
  ctx.beginPath();
  for (let d = -reach; d <= reach; d += pitch) {
    const mx = cx + nx * d, my = cy + ny * d;
    ctx.moveTo(mx - dx, my - dy);
    ctx.lineTo(mx + dx, my + dy);
  }
  ctx.stroke();
}

// The bottom band: a title box at the west end, a scale bar beside it, and
// a compass rose at the east end.
function paintCartouche(ctx, c, t, opts) {
  const bandTop = FRAME.top + t.h + 4;
  const bandH = FRAME.bottom - 8;
  const left = FRAME.left;

  ctx.fillStyle = INK;
  ctx.font = `600 ${Math.round(bandH * 0.42)}px 'Barlow Semi Condensed', system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const title = opts.label || '';
  const sub = opts.sub || '';
  ctx.fillText(title.toUpperCase(), left + 2, bandTop + bandH * 0.36);
  ctx.font = `500 ${Math.round(bandH * 0.32)}px 'Barlow Semi Condensed', system-ui, sans-serif`;
  ctx.fillStyle = RULE_INK;
  ctx.fillText(sub, left + 2, bandTop + bandH * 0.78);

  // Scale bar: one cell wide, labelled.
  const barX = left + Math.min(t.w * 0.48, 200), barY = bandTop + bandH * 0.5;
  const cell = opts.cell || 46;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX, barY - 3); ctx.lineTo(barX, barY + 3);
  ctx.moveTo(barX, barY); ctx.lineTo(barX + cell, barY);
  ctx.moveTo(barX + cell, barY - 3); ctx.lineTo(barX + cell, barY + 3);
  ctx.stroke();
  ctx.font = `500 ${Math.round(bandH * 0.3)}px 'Barlow Semi Condensed', system-ui, sans-serif`;
  ctx.fillStyle = RULE_INK;
  ctx.fillText('one plot', barX + cell + 4, barY);

  // Compass: a ring, a north needle, an N.
  const r = bandH * 0.42;
  const cx = c.w - FRAME.right - r - 2, cy = bandTop + bandH / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 1);
  ctx.lineTo(cx + r * 0.22, cy);
  ctx.lineTo(cx, cy + r * 0.25);
  ctx.lineTo(cx - r * 0.22, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(107, 84, 51, 0.45)';
  ctx.beginPath();
  ctx.moveTo(cx, cy + r - 1);
  ctx.lineTo(cx + r * 0.22, cy);
  ctx.lineTo(cx, cy - r * 0.25);
  ctx.lineTo(cx - r * 0.22, cy);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${Math.round(r * 0.55)}px 'Fraunces', Georgia, serif`;
  ctx.fillStyle = '#F2E6C6';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - r * 0.45);
}
