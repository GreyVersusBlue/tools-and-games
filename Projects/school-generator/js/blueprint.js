// blueprint.js — the printable top-down floor plan, distinct from both the
// editor's 3D top-down camera and the walkthrough. `computeFloorPlan` is pure
// (no canvas/DOM), so it's unit-tested the same way every other model module
// is; the drawing half below it only runs in the browser.
//
// A plan reads the same model everything else does — cells/edges, polygon
// rooms, props, and stairs/links — and turns it into architectural-style
// symbols: walls by kind, a door swing arc at every opening, a tread-and-arrow
// stair symbol (or a dashed hole for the floor a stair opens into), room
// labels with square footage, a scale bar and a north arrow. Nothing here
// changes the save format; it only reads it.

import { CELL, DOOR_W, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL, computeLabels, floorLabel } from './grid.js';
import { shapesOf, segEnds, shapeArea, interiorPoint, SEG_WALL, SEG_GLASS, SEG_RAIL } from './shapes.js';
import { solidSpans } from './collide.js';
import { stairMetrics, linksFrom, floorCuts, footprintPolygon, stairWidth } from './stairs.js';
import { propsOnFloor } from './props.js';
import { catalogEntry } from './catalog.js';
import { footprintOf } from './propplace.js';

const EDGE_KIND_NAME = { [EDGE_WALL]: 'wall', [EDGE_GLASS]: 'glass', [EDGE_RAIL]: 'rail' };
const SEG_KIND_NAME = { [SEG_WALL]: 'wall', [SEG_GLASS]: 'glass', [SEG_RAIL]: 'rail' };

function pushWallRun(walls, kind, ax, az, bx, bz) {
  if (Math.hypot(bx - ax, bz - az) < 0.01) return;
  walls.push({ ax, az, bx, bz, kind });
}

// A door is drawn as the gap in the wall (the caller never draws a wall
// across it) plus a leaf + quarter-circle swing arc. The swing always opens
// 90° to the left of the wall's own direction — a fixed hand rather than a
// "correct" one, since nothing in the model says which side of a wall is the
// room the door opens into.
function pushDoor(doors, ax, az, bx, bz, t0, t1) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.01 || t1 <= t0) return;
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  doors.push({ hx: ax + ux * t0, hz: az + uz * t0, ux, uz, w: t1 - t0 });
}

function addGridEdge(v, ax, az, bx, bz, walls, doors) {
  const kind = EDGE_KIND_NAME[v];
  if (v === EDGE_DOOR) {
    const len = Math.hypot(bx - ax, bz - az);
    const jamb = (CELL - DOOR_W) / 2;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    pushWallRun(walls, 'wall', ax, az, ax + ux * jamb, az + uz * jamb);
    pushWallRun(walls, 'wall', ax + ux * (jamb + DOOR_W), az + uz * (jamb + DOOR_W), bx, bz);
    pushDoor(doors, ax, az, bx, bz, jamb, jamb + DOOR_W);
  } else if (kind) {
    pushWallRun(walls, kind, ax, az, bx, bz);
  }
}

function gridWalls(floor, walls, doors) {
  for (let y = 0; y <= floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const v = floor.edgesH[y * floor.w + x];
      if (v) addGridEdge(v, x * CELL, y * CELL, (x + 1) * CELL, y * CELL, walls, doors);
    }
  }
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x <= floor.w; x++) {
      const v = floor.edgesV[y * (floor.w + 1) + x];
      if (v) addGridEdge(v, x * CELL, y * CELL, x * CELL, (y + 1) * CELL, walls, doors);
    }
  }
}

// Polygon walls reuse `solidSpans` — the same cut-the-run-at-each-opening
// logic the walkthrough collider uses — so a plan's gaps line up with the
// doorways you can actually walk through.
function polyWalls(floor, walls, doors) {
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        const kind = SEG_KIND_NAME[ring.walls[i]];
        if (!kind) continue;
        const [a, b] = segEnds(ring, i);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.01) continue;
        const openings = ring.openings.filter((o) => o.seg === i);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        if (!openings.length) {
          pushWallRun(walls, kind, a.x, a.z, b.x, b.z);
          continue;
        }
        const cuts = openings.map((o) => ({ a: o.t * len - o.w / 2, b: o.t * len + o.w / 2 }));
        for (const [s, e] of solidSpans(len, cuts, 0)) {
          pushWallRun(walls, kind, a.x + ux * s, a.z + uz * s, a.x + ux * e, a.z + uz * e);
        }
        for (const o of openings) {
          const t0 = Math.max(0, o.t * len - o.w / 2), t1 = Math.min(len, o.t * len + o.w / 2);
          pushDoor(doors, a.x, a.z, b.x, b.z, t0, t1);
        }
      }
    }
  }
}

function ringToPts(ring) { return ring.pts.map((p) => ({ x: p.x, z: p.z })); }

function polyRooms(floor) {
  return shapesOf(floor).map((shape) => {
    const label = interiorPoint(shape);
    return {
      outer: ringToPts(shape.rings[0]),
      holes: shape.rings.slice(1).map(ringToPts),
      color: shape.color,
      name: shape.name,
      sqft: shapeArea(shape),
      labelX: label.x,
      labelZ: label.z,
    };
  });
}

function gridCellFills(floor) {
  const out = [];
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const c = floor.cells[y * floor.w + x];
      if (c) out.push({ x: x * CELL, z: y * CELL, color: c.color });
    }
  }
  return out;
}

function planProps(state, floorIndex) {
  const out = [];
  for (const p of propsOnFloor(state, floorIndex)) {
    if (p.mount === 'ceiling') continue; // nothing to show on a floor plan
    const entry = catalogEntry(p.type);
    if (!entry) continue;
    const { hw, hd } = footprintOf(entry, p);
    out.push({ x: p.x, z: p.z, hw, hd, rotationY: p.rotationY || 0, mount: p.mount, name: entry.name });
  }
  return out;
}

function stairSymbols(state, floorIndex) {
  const metrics = stairMetrics(state);
  const out = [];
  for (const link of linksFrom(state, floorIndex)) {
    const poly = footprintPolygon(link, metrics);
    if (link.type === 'stair') {
      out.push({
        kind: 'stair', poly, link, steps: metrics.steps, run: metrics.run, width: stairWidth(link),
      });
    } else {
      out.push({ kind: 'opening', poly });
    }
  }
  // Holes this floor's slab has cut into it by a stair rising from the level
  // below — a different set of links than the ones placed on this floor.
  for (const poly of floorCuts(state, floorIndex)) out.push({ kind: 'hole', poly });
  return out;
}

function extendBounds(b, x, z) {
  b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
  b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
}

function computeBounds(floor, rooms, propsList, stairs) {
  const b = { minX: 0, minZ: 0, maxX: floor.w * CELL, maxZ: floor.h * CELL };
  for (const r of rooms) for (const p of r.outer) extendBounds(b, p.x, p.z);
  for (const p of propsList) {
    const r = Math.hypot(p.hw, p.hd);
    extendBounds(b, p.x - r, p.z - r); extendBounds(b, p.x + r, p.z + r);
  }
  for (const s of stairs) for (const p of s.poly) extendBounds(b, p.x, p.z);
  // A little breathing room so a wall or label on the building's edge isn't
  // clipped by the page margin.
  const pad = 2;
  b.minX -= pad; b.minZ -= pad; b.maxX += pad; b.maxZ += pad;
  return b;
}

// The pure half: everything a floor plan needs to draw, in world feet, with
// no canvas/DOM dependency so it can run under `node --test`.
export function computeFloorPlan(state, floorIndex) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  const walls = [], doors = [];
  gridWalls(floor, walls, doors);
  polyWalls(floor, walls, doors);
  const rooms = polyRooms(floor);
  const propsList = planProps(state, floorIndex);
  const stairs = stairSymbols(state, floorIndex);
  return {
    floorIndex,
    label: floorLabel(floorIndex),
    bounds: computeBounds(floor, rooms, propsList, stairs),
    cellFills: gridCellFills(floor),
    gridLabels: computeLabels(floor),
    rooms,
    walls,
    doors,
    props: propsList,
    stairs,
  };
}

// ---------- drawing (browser only, past this point) ----------

const WALL_T_FT = 0.5;

function toPx(plan, layout, x, z) {
  return {
    x: layout.margin + (x - plan.bounds.minX) * layout.scale,
    y: layout.margin + layout.titleH + (z - plan.bounds.minZ) * layout.scale,
  };
}

function strokePath(ctx, plan, layout, pts, close = false) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const { x, y } = toPx(plan, layout, p.x, p.z);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

function fillPath(ctx, plan, layout, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const { x, y } = toPx(plan, layout, p.x, p.z);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

function drawRooms(ctx, plan, layout) {
  for (const c of plan.cellFills) {
    const a = toPx(plan, layout, c.x, c.z);
    const s = CELL * layout.scale;
    ctx.fillStyle = c.color ? c.color + '33' : 'rgba(120,130,145,0.10)';
    ctx.fillRect(a.x, a.y, s, s);
  }
  for (const r of plan.rooms) {
    ctx.fillStyle = (r.color || '#cccccc') + '40';
    ctx.save();
    ctx.beginPath();
    const outer = (pts) => {
      pts.forEach((p, i) => {
        const { x, y } = toPx(plan, layout, p.x, p.z);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };
    outer(r.outer);
    for (const hole of r.holes) outer(hole.slice().reverse());
    ctx.fill('evenodd');
    ctx.restore();
  }
}

function drawLabels(ctx, plan, layout) {
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(layout.scale * 1.1)}px system-ui, sans-serif`;
  const draw = (name, sqft, x, z) => {
    const p = toPx(plan, layout, x, z);
    const nameY = p.y - layout.scale * 0.15;
    const areaY = p.y + layout.scale * 0.85;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    const nw = ctx.measureText(name).width;
    ctx.fillRect(p.x - nw / 2 - 3, nameY - layout.scale * 0.9, nw + 6, layout.scale * 1.6);
    ctx.fillStyle = '#1a2029';
    ctx.font = `600 ${Math.round(layout.scale * 1.1)}px system-ui, sans-serif`;
    ctx.fillText(name, p.x, nameY);
    ctx.font = `${Math.round(layout.scale * 0.8)}px system-ui, sans-serif`;
    ctx.fillStyle = '#5a6472';
    ctx.fillText(`${Math.round(sqft).toLocaleString()} ft²`, p.x, areaY);
  };
  for (const l of plan.gridLabels) draw(l.name, l.count * CELL * CELL, l.cx, l.cz);
  for (const r of plan.rooms) if (r.name) draw(r.name, r.sqft, r.labelX, r.labelZ);
}

function drawWalls(ctx, plan, layout) {
  for (const w of plan.walls) {
    const a = toPx(plan, layout, w.ax, w.az);
    const b = toPx(plan, layout, w.bx, w.bz);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineCap = 'square';
    if (w.kind === 'glass') {
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = Math.max(1.5, WALL_T_FT * layout.scale * 0.6);
      ctx.setLineDash([layout.scale * 0.5, layout.scale * 0.35]);
    } else if (w.kind === 'rail') {
      ctx.strokeStyle = '#9aa5b5';
      ctx.lineWidth = Math.max(1, WALL_T_FT * layout.scale * 0.35);
      ctx.setLineDash([layout.scale * 0.2, layout.scale * 0.25]);
    } else {
      ctx.strokeStyle = '#1a2029';
      ctx.lineWidth = Math.max(2, WALL_T_FT * layout.scale);
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawDoors(ctx, plan, layout) {
  ctx.strokeStyle = '#1a2029';
  ctx.lineWidth = Math.max(1, layout.scale * 0.08);
  ctx.setLineDash([]);
  for (const d of plan.doors) {
    const nx = -d.uz, nz = d.ux; // 90° left of the wall's own direction
    const hinge = toPx(plan, layout, d.hx, d.hz);
    const leafEnd = toPx(plan, layout, d.hx + nx * d.w, d.hz + nz * d.w);
    const jambEnd = toPx(plan, layout, d.hx + d.ux * d.w, d.hz + d.uz * d.w);
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(leafEnd.x, leafEnd.y);
    ctx.stroke();
    const r = Math.hypot(leafEnd.x - hinge.x, leafEnd.y - hinge.y);
    const a0 = Math.atan2(leafEnd.y - hinge.y, leafEnd.x - hinge.x);
    const a1 = Math.atan2(jambEnd.y - hinge.y, jambEnd.x - hinge.x);
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, r, a0, a1, false);
    ctx.stroke();
  }
}

function drawStairs(ctx, plan, layout) {
  for (const s of plan.stairs) {
    const pts = s.poly;
    ctx.lineWidth = Math.max(1, layout.scale * 0.06);
    // The hole/opening caption sits near the bottom of its own footprint
    // rather than dead centre — a room's own name label already claims the
    // centre of a space this small (a stairwell, a mezzanine void), and the
    // two would otherwise overlap.
    const captionAt = (poly) => {
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const maxZ = Math.max(...poly.map((p) => p.z));
      return toPx(plan, layout, cx, maxZ - (maxZ - Math.min(...poly.map((p) => p.z))) * 0.12);
    };
    if (s.kind === 'hole') {
      ctx.strokeStyle = '#9aa5b5';
      ctx.setLineDash([layout.scale * 0.3, layout.scale * 0.2]);
      strokePath(ctx, plan, layout, pts, true);
      ctx.setLineDash([]);
      const c = captionAt(pts);
      ctx.fillStyle = '#5a6472';
      ctx.font = `${Math.round(layout.scale * 0.65)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('OPEN BELOW', c.x, c.y);
      continue;
    }
    ctx.strokeStyle = '#1a2029';
    ctx.setLineDash([]);
    strokePath(ctx, plan, layout, pts, true);
    if (s.kind === 'opening') {
      const c = captionAt(pts);
      ctx.fillStyle = '#5a6472';
      ctx.font = `${Math.round(layout.scale * 0.65)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('FLOOR OPENING', c.x, c.y);
      continue;
    }
    // Tread lines evenly spaced along the run, plus an arrow the direction
    // you climb — the same "ramp, not 21 discrete steps" run the walkthrough
    // climbs, drawn here as its plan symbol.
    const link = s.link;
    const hw = s.width / 2;
    for (let k = 1; k < s.steps; k++) {
      const lz = (k / s.steps) * s.run;
      const a = ptWorld(link, -hw, lz), b = ptWorld(link, hw, lz);
      strokePath(ctx, plan, layout, [a, b]);
    }
    const tail = ptWorld(link, 0, s.run * 0.15);
    const head = ptWorld(link, 0, s.run * 0.85);
    drawArrow(ctx, plan, layout, tail, head);
  }
}

function ptWorld(link, lx, lz) {
  const c = Math.cos(link.rotationY || 0), s = Math.sin(link.rotationY || 0);
  return { x: link.x + lx * c + lz * s, z: link.z - lx * s + lz * c };
}

function drawArrow(ctx, plan, layout, from, to) {
  const a = toPx(plan, layout, from.x, from.z);
  const b = toPx(plan, layout, to.x, to.z);
  ctx.strokeStyle = '#1a2029';
  ctx.lineWidth = Math.max(1, layout.scale * 0.06);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const ah = layout.scale * 0.6;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - ah * Math.cos(ang - 0.4), b.y - ah * Math.sin(ang - 0.4));
  ctx.lineTo(b.x - ah * Math.cos(ang + 0.4), b.y - ah * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fillStyle = '#1a2029';
  ctx.fill();
}

function drawProps(ctx, plan, layout) {
  ctx.strokeStyle = '#8a93a3';
  ctx.lineWidth = Math.max(1, layout.scale * 0.05);
  ctx.setLineDash(ctx.mount === 'wall' ? [] : []);
  for (const p of plan.props) {
    const c = Math.cos(p.rotationY || 0), s = Math.sin(p.rotationY || 0);
    const corners = [[-p.hw, -p.hd], [p.hw, -p.hd], [p.hw, p.hd], [-p.hw, p.hd]]
      .map(([lx, lz]) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c }));
    ctx.fillStyle = p.mount === 'wall' ? 'rgba(77,163,255,0.18)' : 'rgba(138,147,163,0.16)';
    fillPath(ctx, plan, layout, corners);
    strokePath(ctx, plan, layout, corners, true);
  }
}

function drawDimensions(ctx, plan, layout) {
  const b = plan.bounds;
  const wFt = b.maxX - b.minX, hFt = b.maxZ - b.minZ;
  const top = toPx(plan, layout, b.minX, b.minZ);
  const topR = toPx(plan, layout, b.maxX, b.minZ);
  const left = toPx(plan, layout, b.minX, b.minZ);
  const leftB = toPx(plan, layout, b.minX, b.maxZ);
  const off = 14;
  ctx.strokeStyle = '#9aa5b5';
  ctx.fillStyle = '#5a6472';
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(layout.scale * 0.7)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.beginPath();
  ctx.moveTo(top.x, top.y - off); ctx.lineTo(topR.x, topR.y - off);
  ctx.stroke();
  ctx.fillText(`${Math.round(wFt)}'-0"`, (top.x + topR.x) / 2, top.y - off - 4);

  ctx.save();
  ctx.translate(left.x - off, (left.y + leftB.y) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(-(leftB.y - left.y) / 2, 0);
  ctx.lineTo((leftB.y - left.y) / 2, 0);
  ctx.strokeStyle = '#9aa5b5';
  ctx.stroke();
  ctx.fillText(`${Math.round(hFt)}'-0"`, 0, -4);
  ctx.restore();
}

function drawScaleAndNorth(ctx, plan, layout, canvasW, canvasH) {
  const x0 = canvasW - 140, y0 = canvasH - 34;
  const ftPerTick = 10;
  const pxPerTick = ftPerTick * layout.scale;
  ctx.strokeStyle = '#1a2029';
  ctx.fillStyle = '#1a2029';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + pxPerTick * 4, y0);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '10px system-ui, sans-serif';
  for (let i = 0; i <= 4; i++) {
    const x = x0 + i * pxPerTick;
    ctx.beginPath(); ctx.moveTo(x, y0 - 4); ctx.lineTo(x, y0 + 4); ctx.stroke();
    ctx.fillText(String(i * ftPerTick), x, y0 + 16);
  }
  // North arrow, pointing up canvas — the plan's own +z (world "south") runs
  // down the page, matching the editor's top-down camera.
  const nx = canvasW - 30, ny = canvasH - 70;
  ctx.beginPath();
  ctx.moveTo(nx, ny - 14);
  ctx.lineTo(nx - 6, ny + 8);
  ctx.lineTo(nx, ny + 3);
  ctx.lineTo(nx + 6, ny + 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('N', nx, ny - 18);
}

function drawTitleBlock(ctx, plan, layout, canvasW, opts) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, layout.titleH);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, layout.titleH - 1, canvasW, 1);
  ctx.fillStyle = '#1a2029';
  ctx.textAlign = 'left';
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillText(opts.title || 'School Generator', layout.margin, layout.titleH * 0.42);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#5a6472';
  ctx.fillText(`${plan.label} — Floor Plan`, layout.margin, layout.titleH * 0.75);
  ctx.textAlign = 'right';
  ctx.fillText(opts.date || new Date().toLocaleDateString(), canvasW - layout.margin, layout.titleH * 0.75);
}

// Draws one floor's plan into a 2D context whose canvas is already sized for
// it (see `renderFloorPlanCanvas`, which sizes and calls this).
export function drawFloorPlan(ctx, plan, layout, opts = {}) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawRooms(ctx, plan, layout);
  drawWalls(ctx, plan, layout);
  drawDoors(ctx, plan, layout);
  drawStairs(ctx, plan, layout);
  if (opts.showFurniture) drawProps(ctx, plan, layout);
  drawLabels(ctx, plan, layout);
  if (opts.showDimensions) drawDimensions(ctx, plan, layout);
  drawScaleAndNorth(ctx, plan, layout, ctx.canvas.width, ctx.canvas.height);
  drawTitleBlock(ctx, plan, layout, ctx.canvas.width, opts);
}

const MARGIN = 40;
const TITLE_H = 56;
const MAX_PX = 4000; // sane cap on export canvas size

export function renderFloorPlanCanvas(state, floorIndex, opts = {}) {
  const plan = computeFloorPlan(state, floorIndex);
  if (!plan) return null;
  const wFt = plan.bounds.maxX - plan.bounds.minX;
  const hFt = plan.bounds.maxZ - plan.bounds.minZ;
  let scale = opts.scale || 8; // px per ft
  const rawW = wFt * scale + MARGIN * 2;
  const rawH = hFt * scale + MARGIN * 2 + TITLE_H;
  if (rawW > MAX_PX || rawH > MAX_PX) scale *= Math.min(MAX_PX / rawW, MAX_PX / rawH);
  const layout = { scale, margin: MARGIN, titleH: TITLE_H };
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wFt * scale + MARGIN * 2);
  canvas.height = Math.ceil(hFt * scale + MARGIN * 2 + TITLE_H);
  const ctx = canvas.getContext('2d');
  drawFloorPlan(ctx, plan, layout, opts);
  return canvas;
}

export function downloadCanvasPNG(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}
