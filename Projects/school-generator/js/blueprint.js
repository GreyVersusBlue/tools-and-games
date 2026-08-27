// blueprint.js — the printable top-down floor plan, distinct from both the
// editor's 3D top-down camera and the walkthrough. `computeFloorPlan` is pure
// (no canvas/DOM), so it's unit-tested the same way every other model module
// is; the drawing half below it only runs in the browser.
//
// A plan reads the same model everything else does — rooms, polygon
// rooms, props, and stairs/links — and turns it into architectural-style
// symbols: walls by kind, a door swing arc at every opening, a tread-and-arrow
// stair symbol (or a dashed hole for the floor a stair opens into), room
// labels with square footage, a scale bar and a north arrow. Nothing here
// changes the save format; it only reads it.
//
// Phase 5 of the second arc adds a second sheet on the same terms: the *site*
// plan. Same pure-then-draw split (`computeSitePlan`, then `drawSitePlan`),
// same symbols where they apply, and one new one — contour lines, which come
// straight out of terrain.js's marching squares over the same field the walker
// stands on. The building appears on it as an outline and nothing else, which
// is what a site plan is: the ground, and where the building sits on it.

import {
  CELL, floorLabel,
} from './grid.js';
import {
  shapesOf, segEnds, shapeArea, interiorPoint, openingSpec, isWindowOpening,
  SEG_WALL, SEG_GLASS, SEG_RAIL,
} from './shapes.js';
import { solidSpans } from './collide.js';
import {
  stairMetrics, linksFrom, floorCuts, footprintPolygon, stairWidth, runMetrics,
  rampSlope, elevatorsOn, elevatorSize,
} from './stairs.js';
import { propsOnFloor } from './props.js';
import { catalogEntry, variantKey } from './catalog.js';
import { footprintOf } from './propplace.js';
import { wallProbe } from './walls.js';
import { finishSchedule } from './finish.js';
import { floorOccupancy } from './occupancy.js';
import { segLeaves, leafEnd, leafAngle } from './openings.js';
import { regionsOf, markingsFor, surfaceEntry, markingEntry, siteSchedule, regionArea } from './site.js';
import { terrainField, contours, terrainRange, CONTOUR_FT } from './terrain.js';
import { roofMask, maskOutlines } from './roof.js';
import { INK, withAlpha, paperTint } from './theme.js';

const SEG_KIND_NAME = { [SEG_WALL]: 'wall', [SEG_GLASS]: 'glass', [SEG_RAIL]: 'rail' };

function pushWallRun(walls, kind, ax, az, bx, bz, t) {
  if (Math.hypot(bx - ax, bz - az) < 0.01) return;
  walls.push({ ax, az, bx, bz, kind, t });
}

// An opening's plan symbol. Both kinds are the gap in the wall (the caller
// never draws a wall across one) plus something drawn into it:
//
//   a door    the leaf at 90° with the quarter-circle it sweeps — the hand and
//             the swing side come off the record now, so the plan states which
//             way the door was designed to open rather than a fixed guess.
//   a window  the glazing line across the gap, jamb to jamb.
//
// The leaves come from openings.js, which is also what the renderer hangs and
// what the walker is stopped by — one description of a door, drawn three ways.
function pushOpening(openings, spec, a, b, t) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.01) return;
  const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  const at = spec.t * len;
  openings.push({
    kind: spec.window ? 'window' : 'door',
    hx: a.x + ux * (at - spec.w / 2), hz: a.z + uz * (at - spec.w / 2),
    ux, uz, w: spec.w, t,
    // The plan never draws these two — an elevation would, and Phase 7's
    // takeoff prices glass by the square foot, so the opening carries its
    // own height rather than leaving a reader to assume one.
    h: spec.h, sill: spec.sill,
    leaves: segLeaves(spec, a, b).map((leaf) => ({
      hx: leaf.hx, hz: leaf.hz, len: leaf.len,
      open: leafAngle(leaf, 1), shut: leafAngle(leaf, 0),
      end: leafEnd(leaf, 1),
    })),
  });
}

// Walls reuse `solidSpans` — the same cut-the-run-at-each-opening logic the
// walkthrough collider uses — so a plan's gaps line up with the doorways you
// can actually walk through.
function roomWalls(floor, walls, openings, thick) {
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        const kind = SEG_KIND_NAME[ring.walls[i]];
        if (!kind) continue;
        const [a, b] = segEnds(ring, i);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.01) continue;
        const t = thick(a.x, a.z, b.x, b.z);
        const here = ring.openings.filter((o) => o.seg === i);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        if (!here.length) {
          pushWallRun(walls, kind, a.x, a.z, b.x, b.z, t);
          continue;
        }
        // A window doesn't break the wall run: in plan the wall carries on
        // through it and the glazing is drawn over the top. Only a doorway is
        // a gap — the same rule the collider follows, from the same predicate.
        const cuts = here
          .filter((o) => !isWindowOpening(o))
          .map((o) => ({ a: o.t * len - o.w / 2, b: o.t * len + o.w / 2 }));
        for (const [s, e] of solidSpans(len, cuts, 0)) {
          pushWallRun(walls, kind, a.x + ux * s, a.z + uz * s, a.x + ux * e, a.z + uz * e, t);
        }
        for (const o of here) pushOpening(openings, openingSpec(o), a, b, t);
      }
    }
  }
}

function ringToPts(ring) { return ring.pts.map((p) => ({ x: p.x, z: p.z })); }

function planRooms(floor) {
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

function planProps(state, floorIndex) {
  const out = [];
  for (const p of propsOnFloor(state, floorIndex)) {
    if (p.mount === 'ceiling') continue; // nothing to show on a floor plan
    const entry = catalogEntry(p.type);
    if (!entry) continue;
    const { hw, hd } = footprintOf(entry, p);
    // `site` rides along so the site plan can pick out the outdoor pieces
    // without looking the catalog row up a second time.
    out.push({
      x: p.x, z: p.z, hw, hd, rotationY: p.rotationY || 0,
      mount: p.mount, name: entry.name, site: !!entry.site, geo: entry.geo,
      // Phase 11: '' for a prop painted the colour its catalog row says, the
      // override hex otherwise. A plan sheet is deliberately near-monochrome,
      // so only the props somebody has *chosen* a colour for get one here —
      // filling every desk in its own brown would turn the drawing into a
      // rendering, and the thing worth seeing on a sheet is which pieces are
      // not standard.
      color: variantKey(entry, p),
    });
  }
  return out;
}

function stairSymbols(state, floorIndex) {
  const metrics = stairMetrics(state);
  const out = [];
  for (const link of linksFrom(state, floorIndex)) {
    const poly = footprintPolygon(link, metrics);
    if (link.type === 'stair' || link.type === 'ramp') {
      const m = runMetrics(link, metrics);
      out.push({
        kind: link.type, poly, link, width: stairWidth(link),
        steps: m.steps, run: m.run,
        // A ramp's plan symbol carries its slope, because that number is the
        // difference between an accessible route and a decorative one.
        slope: link.type === 'ramp' ? rampSlope(link) : 0,
      });
    } else if (link.type !== 'elevator') {
      out.push({ kind: 'opening', poly });
    }
  }
  // An elevator belongs to both its storeys, so it is drawn on both — from
  // `elevatorsOn`, not `linksFrom`.
  for (const link of elevatorsOn(state, floorIndex)) {
    const { w, d } = elevatorSize(link);
    out.push({
      kind: 'elevator', poly: footprintPolygon(link, metrics), link,
      caption: `ELEV ${Math.round(w)}'×${Math.round(d)}'`,
    });
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
// `opts.occupancy` adds the one thing a plan has never carried: how many
// people each room is allowed to hold. It is off by default because a plan is
// a drawing of a building and this is a statement about it — but a drawing
// that says "Room 101 · 672 ft² · 34 occupants" is the plan an authority
// having jurisdiction asks for, and Phase 6's crowd finally gave the number a
// reason to be on the sheet.
export function computeFloorPlan(state, floorIndex, opts = {}) {
  const floor = state.floors[floorIndex];
  if (!floor) return null;
  // One thickness probe for the whole plan: a plan asks about every boundary
  // twice (once for the wall run, once for the opening in it), and walls.js's
  // probe is a point-in-polygon walk apiece.
  const thick = wallProbe(floor);
  const walls = [], openings = [];
  roomWalls(floor, walls, openings, thick);
  const rooms = planRooms(floor);
  const propsList = planProps(state, floorIndex);
  const stairs = stairSymbols(state, floorIndex);
  return {
    floorIndex,
    label: floorLabel(floorIndex),
    bounds: computeBounds(floor, rooms, propsList, stairs),
    rooms,
    walls,
    // Doors *and* windows, each carrying its own leaves. Kept under the name
    // the plan has always used so a caller that only wanted door swings still
    // finds them here.
    doors: openings,
    finishes: finishSchedule(floor),
    props: propsList,
    stairs,
    // Every room the occupancy reader can price, at the same interior point
    // `planRooms` labels it at — so the tag lands in the room rather than
    // beside it.
    occupancy: opts.occupancy
      ? floorOccupancy(state, floorIndex).rooms.filter((r) => r.occ > 0)
      : null,
  };
}

// ---------- the site plan ----------

// Everything a site plan needs to draw, in world feet, with no canvas/DOM
// dependency — the same bargain `computeFloorPlan` strikes, and the reason
// both are testable headless.
//
// The building is one outline here, taken from the *ground* storey's mask
// rather than from its walls: a site plan cares where the building meets the
// earth, not how it is partitioned inside.
export function computeSitePlan(state, opts = {}) {
  const field = terrainField(state);
  const regions = regionsOf(state).map((r) => ({
    id: r.id,
    name: r.name,
    surf: r.surf,
    label: surfaceEntry(r.surf).label,
    color: surfaceEntry(r.surf).color,
    hatch: surfaceEntry(r.surf).hatch,
    mark: r.mark ? markingEntry(r.mark).label : null,
    sqft: regionArea(r),
    pts: r.pts.map((p) => ({ x: p.x, z: p.z })),
    strokes: markingsFor(r),
  }));
  const ground = state.floors[0] || null;
  const building = ground ? maskOutlines(roofMask(ground, state.w, state.h)) : [];
  const lines = opts.contours === false ? [] : contours(field, opts.interval || CONTOUR_FT);
  // Site props only: a desk inside the building has no business on a site
  // plan, and the catalog already says which rows are outdoor pieces.
  const propsList = planProps(state, 0).filter((p) => p.site);

  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const r of regions) for (const p of r.pts) extendBounds(b, p.x, p.z);
  for (const loop of building) for (const p of loop) extendBounds(b, p.x, p.z);
  for (const p of propsList) {
    const rad = Math.hypot(p.hw, p.hd);
    extendBounds(b, p.x - rad, p.z - rad); extendBounds(b, p.x + rad, p.z + rad);
  }
  if (!Number.isFinite(b.minX)) {
    b.minX = 0; b.minZ = 0;
    b.maxX = (state.w || 0) * CELL; b.maxZ = (state.h || 0) * CELL;
  }
  const pad = 12;
  b.minX -= pad; b.minZ -= pad; b.maxX += pad; b.maxZ += pad;

  return {
    label: 'Site',
    bounds: b,
    regions,
    building,
    contours: lines,
    props: propsList,
    schedule: siteSchedule(state),
    relief: terrainRange(field),
    interval: opts.interval || CONTOUR_FT,
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
  for (const r of plan.rooms) {
    ctx.fillStyle = paperTint(r.color);
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
  ctx.font = `${Math.round(layout.scale * 1.1)}px "Public Sans", system-ui, sans-serif`;
  const draw = (name, sqft, x, z) => {
    const p = toPx(plan, layout, x, z);
    const nameY = p.y - layout.scale * 0.15;
    const areaY = p.y + layout.scale * 0.85;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    const nw = ctx.measureText(name).width;
    ctx.fillRect(p.x - nw / 2 - 3, nameY - layout.scale * 0.9, nw + 6, layout.scale * 1.6);
    ctx.fillStyle = INK.line;
    ctx.font = `600 ${Math.round(layout.scale * 1.1)}px "Public Sans", system-ui, sans-serif`;
    ctx.fillText(name, p.x, nameY);
    ctx.font = `${Math.round(layout.scale * 0.8)}px "Public Sans", system-ui, sans-serif`;
    ctx.fillStyle = INK.dim;
    ctx.fillText(`${Math.round(sqft).toLocaleString()} ft²`, p.x, areaY);
  };
  for (const r of plan.rooms) if (r.name) draw(r.name, r.sqft, r.labelX, r.labelZ);
}

// The occupant load, as a tag under the room's name. Deliberately its own
// pass rather than a third line in `drawLabels`: a room with no name still
// gets a number, and a plan printed without this option is exactly the plan
// Phase 5 printed.
function drawOccupancy(ctx, plan, layout) {
  if (!plan.occupancy || !plan.occupancy.length) return;
  ctx.textAlign = 'center';
  const size = Math.max(7, Math.round(layout.scale * 0.75));
  for (const r of plan.occupancy) {
    const p = toPx(plan, layout, r.x, r.z);
    const text = `${r.occ} occ`;
    ctx.font = `600 ${size}px "Public Sans", system-ui, sans-serif`;
    const w = ctx.measureText(text).width;
    const y = p.y + layout.scale * 1.75;
    ctx.fillStyle = 'rgba(26, 32, 41, 0.86)';
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2 - 4, y - size, w + 8, size + 5, 3);
    ctx.fill();
    ctx.fillStyle = INK.paper;
    ctx.fillText(text, p.x, y);
  }
}

function drawWalls(ctx, plan, layout) {
  for (const w of plan.walls) {
    const a = toPx(plan, layout, w.ax, w.az);
    const b = toPx(plan, layout, w.bx, w.bz);
    // Line weight is the wall's real thickness now, so an exterior wall reads
    // heavier than a partition the way it does on a drawn plan — and it does
    // so without anyone having drawn it that way, because walls.js worked out
    // which is which from the rooms either side.
    const t = w.t || WALL_T_FT;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineCap = 'square';
    if (w.kind === 'glass') {
      ctx.strokeStyle = INK.accent;
      ctx.lineWidth = Math.max(1.5, t * layout.scale * 0.6);
      ctx.setLineDash([layout.scale * 0.5, layout.scale * 0.35]);
    } else if (w.kind === 'rail') {
      ctx.strokeStyle = INK.faint;
      ctx.lineWidth = Math.max(1, WALL_T_FT * layout.scale * 0.35);
      ctx.setLineDash([layout.scale * 0.2, layout.scale * 0.25]);
    } else {
      ctx.strokeStyle = INK.line;
      ctx.lineWidth = Math.max(2, t * layout.scale);
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// A door: each leaf drawn at 90° with the quarter-circle it sweeps, which is
// the symbol every floor plan uses. A doorway with no leaves — a cased opening
// — draws neither, and correctly so: there is nothing there to swing.
function drawDoorLeaves(ctx, plan, layout, d) {
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = Math.max(1, layout.scale * 0.08);
  for (const leaf of d.leaves) {
    const hinge = toPx(plan, layout, leaf.hx, leaf.hz);
    const open = toPx(plan, layout, leaf.end.x, leaf.end.z);
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(open.x, open.y);
    ctx.stroke();
    // The arc runs from where the leaf is drawn back to where it shuts. Canvas
    // angles are screen-space and the plan's +z runs down the page, so both
    // ends are measured in pixels rather than converted from world angles.
    const shut = toPx(plan, layout,
      leaf.hx + Math.cos(leaf.shut) * leaf.len, leaf.hz + Math.sin(leaf.shut) * leaf.len);
    const r = Math.hypot(open.x - hinge.x, open.y - hinge.y);
    const a0 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
    const a1 = Math.atan2(shut.y - hinge.y, shut.x - hinge.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, r, a0, a1, sweep < 0);
    ctx.stroke();
  }
}

// A window: the glazing line across the opening, with the wall's own faces
// carried through either side of it — the standard symbol, and the one that
// makes a window unmistakably not a door at a glance.
function drawWindow(ctx, plan, layout, d) {
  const nx = -d.uz, nz = d.ux;
  const half = (d.t || WALL_T_FT) / 2;
  const from = { x: d.hx, z: d.hz };
  const to = { x: d.hx + d.ux * d.w, z: d.hz + d.uz * d.w };
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = Math.max(1, layout.scale * 0.07);
  for (const off of [-half, half]) {
    const a = toPx(plan, layout, from.x + nx * off, from.z + nz * off);
    const b = toPx(plan, layout, to.x + nx * off, to.z + nz * off);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.strokeStyle = INK.accent;
  ctx.lineWidth = Math.max(1, layout.scale * 0.09);
  const a = toPx(plan, layout, from.x, from.z);
  const b = toPx(plan, layout, to.x, to.z);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawDoors(ctx, plan, layout) {
  ctx.setLineDash([]);
  for (const d of plan.doors) {
    if (d.kind === 'window') drawWindow(ctx, plan, layout, d);
    else drawDoorLeaves(ctx, plan, layout, d);
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
      ctx.strokeStyle = INK.faint;
      ctx.setLineDash([layout.scale * 0.3, layout.scale * 0.2]);
      strokePath(ctx, plan, layout, pts, true);
      ctx.setLineDash([]);
      const c = captionAt(pts);
      ctx.fillStyle = INK.dim;
      ctx.font = `${Math.round(layout.scale * 0.65)}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('OPEN BELOW', c.x, c.y);
      continue;
    }
    ctx.strokeStyle = INK.line;
    ctx.setLineDash([]);
    strokePath(ctx, plan, layout, pts, true);
    if (s.kind === 'opening') {
      const c = captionAt(pts);
      ctx.fillStyle = INK.dim;
      ctx.font = `${Math.round(layout.scale * 0.65)}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('FLOOR OPENING', c.x, c.y);
      continue;
    }
    if (s.kind === 'elevator') {
      // The plan symbol for a lift is the shaft with its diagonals — one
      // rectangle nobody mistakes for a room.
      const [p0, p1, p2, p3] = pts;
      strokePath(ctx, plan, layout, [p0, p2]);
      strokePath(ctx, plan, layout, [p1, p3]);
      const c = captionAt(pts);
      ctx.fillStyle = INK.dim;
      ctx.font = `${Math.round(layout.scale * 0.6)}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(s.caption, c.x, c.y);
      continue;
    }
    // Tread lines evenly spaced along the run, plus an arrow the direction
    // you climb — the same "ramp, not 21 discrete steps" run the walkthrough
    // climbs, drawn here as its plan symbol. A ramp draws the arrow and the
    // slope instead of treads, since a ramp with tread lines is a stair.
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
    if (s.kind === 'ramp') {
      const at = ptWorld(link, 0, s.run * 0.5);
      const c = toPx(plan, layout, at.x, at.z);
      const label = `RAMP 1:${Math.round(s.slope)}`;
      ctx.font = `${Math.round(layout.scale * 0.6)}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(c.x - w / 2 - 3, c.y - layout.scale * 0.55, w + 6, layout.scale * 0.85);
      ctx.fillStyle = INK.dim;
      ctx.fillText(label, c.x, c.y);
    }
  }
}

// The finish schedule: what each floor is made of, printed as a legend under
// the title block. Same numbers Phase 7's bill of materials will want, which
// is why they're summed in finish.js rather than counted here.
function drawFinishLegend(ctx, plan, layout, canvasW, canvasH) {
  const rows = (plan.finishes || []).filter((r) => r.sqft > 0);
  if (!rows.length) return;
  const lineH = 15;
  const pad = 8;
  const boxW = 210;
  const boxH = pad * 2 + 16 + rows.length * lineH;
  const x0 = 12;
  const y0 = canvasH - boxH - 12;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeStyle = '#d3d7de';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW - 1, boxH - 1);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.line;
  ctx.font = '600 11px "Public Sans", system-ui, sans-serif';
  ctx.fillText('FLOOR FINISH SCHEDULE', x0 + pad, y0 + pad + 10);
  ctx.font = '10px "Public Sans", system-ui, sans-serif';
  rows.forEach((r, i) => {
    const y = y0 + pad + 16 + i * lineH + 8;
    ctx.fillStyle = r.color;
    ctx.fillRect(x0 + pad, y - 8, 10, 10);
    ctx.strokeStyle = INK.faint;
    ctx.strokeRect(x0 + pad + 0.5, y - 7.5, 9, 9);
    ctx.fillStyle = INK.line;
    ctx.fillText(r.label, x0 + pad + 16, y);
    ctx.fillStyle = INK.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(r.sqft).toLocaleString()} ft²`, x0 + boxW - pad, y);
    ctx.textAlign = 'left';
  });
}

function ptWorld(link, lx, lz) {
  const c = Math.cos(link.rotationY || 0), s = Math.sin(link.rotationY || 0);
  return { x: link.x + lx * c + lz * s, z: link.z - lx * s + lz * c };
}

function drawArrow(ctx, plan, layout, from, to) {
  const a = toPx(plan, layout, from.x, from.z);
  const b = toPx(plan, layout, to.x, to.z);
  ctx.strokeStyle = INK.line;
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
  ctx.fillStyle = INK.line;
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
    ctx.fillStyle = p.color
      ? `${p.color}3d`
      : (p.mount === 'wall' ? 'rgba(77,163,255,0.18)' : 'rgba(138,147,163,0.16)');
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
  ctx.strokeStyle = INK.faint;
  ctx.fillStyle = INK.dim;
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(layout.scale * 0.7)}px "IBM Plex Mono", ui-monospace, monospace`;
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
  ctx.strokeStyle = INK.faint;
  ctx.stroke();
  ctx.fillText(`${Math.round(hFt)}'-0"`, 0, -4);
  ctx.restore();
}

function drawScaleAndNorth(ctx, plan, layout, canvasW, canvasH) {
  const x0 = canvasW - 140, y0 = canvasH - 34;
  const ftPerTick = 10;
  const pxPerTick = ftPerTick * layout.scale;
  ctx.strokeStyle = INK.line;
  ctx.fillStyle = INK.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + pxPerTick * 4, y0);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '10px "Public Sans", system-ui, sans-serif';
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
  ctx.font = '11px "Public Sans", system-ui, sans-serif';
  ctx.fillText('N', nx, ny - 18);
}

// ---------- the sheet panels ----------
//
// Phase 16's code panel, and now the school-day panel beside it. Both are the
// same object drawn the same way — a title, a verdict badge, a line of
// context, a column of key/value rows, a per-storey block that says which
// sheet you are holding, and a caveat in small type — so there is **one**
// drawer and two shapes fed to it, rather than the second panel being the
// first one copied. The one piece of judgement here is what it does when a
// panel says the building fails: it prints that, in the panel, in red. A
// drawing set that quietly omits its own analysis is worse than one that has
// none.
//
// Both shapes are built from `report.js` records and invent nothing. Neither
// of them computes: this module has no business building a nav graph, and the
// caller already has one report for the whole set.
const PANEL_W = 232;
const PANEL_PAD = 9;
const PANEL_LINE = 14;
// The gap between two stacked panels, and between the topmost and the title
// block above it.
const PANEL_GAP = 10;

const badgeOf = (p, ok) => (p.verdict === 'fail' ? `${p.fails} FAIL`
  : p.verdict === 'warn' ? `${p.warns} REVIEW` : ok);

// `report.js`'s `codePanel()`, as a panel this file can draw.
const codeShape = (p) => ({
  title: p.title,
  badge: badgeOf(p, 'PASSES'),
  verdict: p.verdict,
  sub: `${p.edition} · ${p.sprinklered ? 'sprinklered' : 'unsprinklered'}`,
  findings: p.findings || null,
  rows: p.rows,
  storeyHead: ['BY STOREY', 'AREA · LOAD · EXITS'],
  storeys: p.storeys.map((st) => ({
    label: st.label,
    current: st.current,
    text: `${Math.round(st.area).toLocaleString()} ft² · ${st.occ} · ${st.exits}`,
  })),
  caveat: p.caveat,
});

// ...and `report.js`'s `dayPanel()`. "WORKS" rather than "PASSES" because
// nothing here is a code check: a building that suits its timetable has not
// passed anything, it has been found to fit.
const dayShape = (p) => ({
  title: p.title,
  badge: badgeOf(p, 'WORKS'),
  verdict: p.verdict,
  sub: `${p.edition} · ${p.passing} min between bells`,
  findings: p.findings || null,
  rows: p.rows,
  storeyHead: ['BY STOREY', 'ROOMS USED · IDLE'],
  storeys: p.storeys.map((st) => ({
    label: st.label,
    current: st.current,
    text: `${st.used} of ${st.rooms} · ${st.idle}`,
  })),
  caveat: p.caveat,
});

// How tall this panel will come out, measured rather than guessed at — a
// panel whose last line falls outside its own border is a panel that says the
// tool cannot be trusted about rectangles either, and a second panel stacked
// under a mis-measured first one lands on top of it.
function panelHeight(ctx, panel) {
  ctx.font = '9px "Public Sans", system-ui, sans-serif';
  const caveat = wrapLines(ctx, panel.caveat, PANEL_W - PANEL_PAD * 2);
  // Phase 19: the finding text, wrapped now so the box is measured rather
  // than guessed at — each finding is a bullet plus as many 10px lines as
  // its title needs, and a "+N more" line when the report ran past three.
  const findingLines = [];
  if (panel.findings && panel.findings.lines.length) {
    ctx.font = '9px "Public Sans", system-ui, sans-serif';
    for (const f of panel.findings.lines) {
      findingLines.push({ level: f.level, lines: wrapLines(ctx, f.title, PANEL_W - PANEL_PAD * 2 - 10) });
    }
  }
  const findingsH = findingLines.length
    ? 10 + findingLines.reduce((n, f) => n + f.lines.length * 10 + 3, 0)
      + (panel.findings.more ? 10 : 0)
    : 0;
  const storeys = panel.storeys.length;
  const bodyH = 30 + panel.rows.length * PANEL_LINE
    + findingsH
    + (storeys ? 23 + storeys * PANEL_LINE : 0)
    + 16 + (caveat.length - 1) * 10 + 4;
  return { boxH: PANEL_PAD * 2 + bodyH, caveat, findingLines };
}

// Draws one panel with its top-left corner at (x0, y0), and answers with the
// y its bottom edge came out at so the next one can stack under it.
function drawPanel(ctx, panel, x0, y0) {
  const pad = PANEL_PAD;
  const lineH = PANEL_LINE;
  const { boxH, caveat, findingLines } = panelHeight(ctx, panel);

  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x0, y0, PANEL_W, boxH);
  ctx.strokeStyle = INK.faint;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, PANEL_W - 1, boxH - 1);

  let y = y0 + pad + 10;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.line;
  ctx.font = '600 11px "Public Sans", system-ui, sans-serif';
  ctx.fillText(panel.title, x0 + pad, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = panel.verdict === 'fail' ? '#b33a3a'
    : panel.verdict === 'warn' ? '#a26a1e' : '#3d7a4a';
  ctx.fillText(panel.badge, x0 + PANEL_W - pad, y);
  y += 6;

  ctx.font = '10px "Public Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.dim;
  y += lineH;
  ctx.fillText(panel.sub, x0 + pad, y);

  for (const [k, v] of panel.rows) {
    y += lineH;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK.dim;
    ctx.fillText(k, x0 + pad, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = INK.line;
    ctx.fillText(v, x0 + PANEL_W - pad, y);
  }

  // Phase 19: what the badge is counting, in words — a bullet in the level's
  // own ink and the finding's title, wrapped. The sheet leaves the room; the
  // count alone never survived the trip.
  if (findingLines.length) {
    y += 10;
    ctx.font = '9px "Public Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (const f of findingLines) {
      ctx.fillStyle = f.level === 'fail' ? '#b33a3a' : '#a26a1e';
      ctx.fillText('■', x0 + pad, y + 9);
      ctx.fillStyle = INK.line;
      f.lines.forEach((line, i) => ctx.fillText(line, x0 + pad + 10, y + 9 + i * 10));
      y += f.lines.length * 10 + 3;
    }
    if (panel.findings.more) {
      ctx.fillStyle = '#8a93a3';
      ctx.fillText(`+ ${panel.findings.more} more in the report`, x0 + pad + 10, y + 9);
      y += 10;
    }
    ctx.font = '10px "Public Sans", system-ui, sans-serif';
  }

  if (panel.storeys.length) {
    y += 10;
    ctx.strokeStyle = '#e0e3e8';
    ctx.beginPath();
    ctx.moveTo(x0 + pad, y + 0.5);
    ctx.lineTo(x0 + PANEL_W - pad, y + 0.5);
    ctx.stroke();
    y += 13;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK.dim;
    ctx.font = '600 9px "Public Sans", system-ui, sans-serif';
    ctx.fillText(panel.storeyHead[0], x0 + pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(panel.storeyHead[1], x0 + PANEL_W - pad, y);
    ctx.font = '10px "Public Sans", system-ui, sans-serif';
    for (const st of panel.storeys) {
      y += lineH;
      // The sheet's own storey in ink, the others greyed: one panel, printed
      // on every sheet, that still says which sheet you are holding.
      ctx.fillStyle = st.current ? INK.line : '#8a93a3';
      ctx.textAlign = 'left';
      ctx.fillText(st.current ? `▸ ${st.label}` : st.label, x0 + pad, y);
      ctx.textAlign = 'right';
      ctx.fillText(st.text, x0 + PANEL_W - pad, y);
    }
  }

  y += 16;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8a93a3';
  ctx.font = '9px "Public Sans", system-ui, sans-serif';
  caveat.forEach((text, i) => ctx.fillText(text, x0 + pad, y + i * 10));
  return y0 + boxH;
}

// Every panel the sheet was asked for, stacked down the right-hand margin in
// the order a set is read: what the code says about the building first, then
// what the school does in it. A sheet asked for neither draws neither and
// costs nothing.
function drawSheetPanels(ctx, layout, canvasW, opts) {
  const x0 = canvasW - PANEL_W - 12;
  let y = layout.titleH + 12;
  if (opts.codePanel) y = drawPanel(ctx, codeShape(opts.codePanel), x0, y) + PANEL_GAP;
  if (opts.dayPanel) y = drawPanel(ctx, dayShape(opts.dayPanel), x0, y) + PANEL_GAP;
  return y;
}

// Canvas has no text wrapping, and a caveat that runs off the edge of a panel
// is a caveat nobody reads. Word by word, measured.
function wrapText(ctx, str, x, y, maxW, lineH) {
  const words = String(str || '').split(/\s+/);
  let line = '';
  let ty = y;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      ctx.fillText(line, x, ty);
      ty += lineH;
      line = w;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, ty);
  return ty + lineH;
}

function drawTitleBlock(ctx, plan, layout, canvasW, opts) {
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, canvasW, layout.titleH);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, layout.titleH - 1, canvasW, 1);
  ctx.fillStyle = INK.line;
  ctx.textAlign = 'left';
  ctx.font = '600 16px "Public Sans", system-ui, sans-serif';
  ctx.fillText(opts.title || 'School Generator', layout.margin, layout.titleH * 0.42);
  ctx.font = '12px "Public Sans", system-ui, sans-serif';
  ctx.fillStyle = INK.dim;
  ctx.fillText(`${plan.label} — ${opts.sheet || 'Floor Plan'}`, layout.margin, layout.titleH * 0.75);
  ctx.textAlign = 'right';
  ctx.fillText(opts.date || new Date().toLocaleDateString(), canvasW - layout.margin, layout.titleH * 0.75);
}

// The drawing itself, without any of the sheet furniture around it: rooms,
// walls, openings, stairs, and optionally the furniture and the tags. Split
// out in Phase 9 for the minimap, which wants the plan at thumbnail size and
// emphatically does not want a title block, a legend or a north arrow drawn
// over the top of a 168-pixel square.
export function drawPlanBody(ctx, plan, layout, opts = {}) {
  drawRooms(ctx, plan, layout);
  drawWalls(ctx, plan, layout);
  drawDoors(ctx, plan, layout);
  drawStairs(ctx, plan, layout);
  if (opts.showFurniture) drawProps(ctx, plan, layout);
  if (opts.showLabels !== false) drawLabels(ctx, plan, layout);
  if (opts.showOccupancy) drawOccupancy(ctx, plan, layout);
  if (opts.showDimensions) drawDimensions(ctx, plan, layout);
}

// Draws one floor's plan into a 2D context whose canvas is already sized for
// it (see `renderFloorPlanCanvas`, which sizes and calls this).
export function drawFloorPlan(ctx, plan, layout, opts = {}) {
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawPlanBody(ctx, plan, layout, opts);
  if (opts.showFinishes !== false) {
    drawFinishLegend(ctx, plan, layout, ctx.canvas.width, ctx.canvas.height);
  }
  drawScaleAndNorth(ctx, plan, layout, ctx.canvas.width, ctx.canvas.height);
  // The report, on the sheet. Passed in rather than computed: this module has
  // no business building a nav graph, and the caller already has one report
  // for the whole set.
  drawSheetPanels(ctx, layout, ctx.canvas.width, opts);
  drawTitleBlock(ctx, plan, layout, ctx.canvas.width, opts);
}

// ---------- drawing the site plan ----------

function drawSiteRegions(ctx, plan, layout) {
  for (const r of plan.regions) {
    ctx.fillStyle = withAlpha(r.color, 0.8);
    fillPath(ctx, plan, layout, r.pts);
    ctx.strokeStyle = INK.dim;
    ctx.lineWidth = 1;
    strokePath(ctx, plan, layout, r.pts, true);
  }
}

function drawSiteMarkings(ctx, plan, layout) {
  ctx.lineCap = 'butt';
  for (const r of plan.regions) {
    for (const stroke of r.strokes) {
      ctx.strokeStyle = stroke.color || INK.paper;
      // Painted lines are inches wide and a plan is at eight pixels to the
      // foot, so a stripe drawn to scale would vanish. Held at a hairline
      // minimum instead, which is what a drawing does.
      ctx.lineWidth = Math.max(0.8, (stroke.w || 0.33) * layout.scale);
      strokePath(ctx, plan, layout, stroke.pts, !!stroke.closed);
    }
  }
}

// The ground, as a surveyor draws it: a light line per interval, a heavier one
// every fifth, and the elevation written on the heavy ones.
function drawContours(ctx, plan, layout) {
  if (!plan.contours.length) return;
  ctx.lineCap = 'round';
  for (const line of plan.contours) {
    const index = Math.abs(Math.round(line.level / plan.interval)) % 5 === 0;
    ctx.strokeStyle = index ? 'rgba(120,96,64,0.75)' : 'rgba(140,120,90,0.42)';
    ctx.lineWidth = index ? 1.4 : 0.8;
    ctx.beginPath();
    for (const [a, b] of line.segs) {
      const p0 = toPx(plan, layout, a.x, a.z);
      const p1 = toPx(plan, layout, b.x, b.z);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();
    if (index && line.segs.length) {
      // One label per index contour, on its longest segment — enough to read
      // the direction of fall without turning the sheet into a number soup.
      let best = null, bestLen = 0;
      for (const [a, b] of line.segs) {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len > bestLen) { bestLen = len; best = [a, b]; }
      }
      const mid = toPx(plan, layout, (best[0].x + best[1].x) / 2, (best[0].z + best[1].z) / 2);
      ctx.font = '9px "Public Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = INK.paper;
      ctx.fillRect(mid.x - 11, mid.y - 6, 22, 11);
      ctx.fillStyle = '#7a6240';
      ctx.fillText(`${line.level > 0 ? '+' : ''}${line.level}`, mid.x, mid.y + 3);
    }
  }
}

function drawBuildingOutline(ctx, plan, layout) {
  // Opaque, not a tint. On a site plan the building is the one thing that is
  // *not* ground, and washing the lawn through it makes it read as another
  // kind of surface — which was exactly the mistake the first draft made.
  for (const loop of plan.building) {
    ctx.fillStyle = '#e8e6e1';
    fillPath(ctx, plan, layout, loop);
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 2.5;
    strokePath(ctx, plan, layout, loop, true);
  }
  // ...and a hatch across it, so it reads as a mass rather than as a hole in
  // the drawing. Forty-five degrees, at a spacing that stays legible however
  // far the sheet has been scaled down.
  if (!plan.building.length) return;
  ctx.save();
  ctx.beginPath();
  for (const loop of plan.building) {
    loop.forEach((p, i) => {
      const { x, y } = toPx(plan, layout, p.x, p.z);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.clip();
  const a = toPx(plan, layout, plan.bounds.minX, plan.bounds.minZ);
  const b = toPx(plan, layout, plan.bounds.maxX, plan.bounds.maxZ);
  ctx.strokeStyle = 'rgba(26,32,41,0.16)';
  ctx.lineWidth = 1;
  const step = 9;
  ctx.beginPath();
  for (let d = a.x - (b.y - a.y); d < b.x; d += step) {
    ctx.moveTo(d, a.y);
    ctx.lineTo(d + (b.y - a.y), b.y);
  }
  ctx.stroke();
  ctx.restore();
}

// Planting draws round, everything else draws square. It is the one symbol a
// site plan has that a floor plan doesn't, and it is the difference between a
// row of trees and a row of filing cabinets.
const ROUND_GEO = new Set(['tree', 'shrub', 'planter', 'boulder']);

function drawSiteProps(ctx, plan, layout) {
  for (const p of plan.props) {
    if (ROUND_GEO.has(p.geo)) {
      const { x, y } = toPx(plan, layout, p.x, p.z);
      const r = Math.max(2, Math.max(p.hw, p.hd) * layout.scale);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color
        ? `${p.color}4d`
        : (p.geo === 'tree' ? 'rgba(74,122,58,0.30)' : 'rgba(96,132,84,0.28)');
      ctx.fill();
      ctx.strokeStyle = '#4f7a3f';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      if (p.geo === 'tree') {
        // The nurseryman's symbol: a cross at the trunk, so a canopy that
        // overlaps a walk still says where the thing is actually planted.
        ctx.beginPath();
        ctx.moveTo(x - r * 0.35, y); ctx.lineTo(x + r * 0.35, y);
        ctx.moveTo(x, y - r * 0.35); ctx.lineTo(x, y + r * 0.35);
        ctx.stroke();
      }
      continue;
    }
    const c = Math.cos(p.rotationY || 0), s = Math.sin(p.rotationY || 0);
    const corners = [[-p.hw, -p.hd], [p.hw, -p.hd], [p.hw, p.hd], [-p.hw, p.hd]]
      .map(([lx, lz]) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c }));
    ctx.fillStyle = p.color ? `${p.color}45` : 'rgba(90,100,114,0.24)';
    fillPath(ctx, plan, layout, corners);
    ctx.strokeStyle = INK.dim;
    ctx.lineWidth = 1.1;
    strokePath(ctx, plan, layout, corners, true);
  }
}

function drawSiteLabels(ctx, plan, layout) {
  ctx.textAlign = 'center';
  for (const r of plan.regions) {
    if (!r.name && !r.mark) continue;
    let cx = 0, cz = 0;
    for (const p of r.pts) { cx += p.x; cz += p.z; }
    cx /= r.pts.length; cz /= r.pts.length;
    const { x, y } = toPx(plan, layout, cx, cz);
    const text = r.name || r.mark;
    ctx.font = '600 11px "Public Sans", system-ui, sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(x - w / 2 - 4, y - 9, w + 8, 15);
    ctx.fillStyle = INK.line;
    ctx.fillText(text, x, y + 2);
    ctx.font = '9px "Public Sans", system-ui, sans-serif';
    ctx.fillStyle = INK.dim;
    ctx.fillText(`${Math.round(r.sqft).toLocaleString()} ft²`, x, y + 14);
  }
}

function drawSiteLegend(ctx, plan, layout, canvasW, canvasH) {
  const rows = plan.schedule.filter((r) => r.sqft > 0);
  if (!rows.length) return;
  const lineH = 15, pad = 8, boxW = 240;
  const boxH = pad * 2 + 16 + rows.length * lineH + 16;
  const x0 = 12, y0 = canvasH - boxH - 12;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeStyle = '#d3d7de';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW - 1, boxH - 1);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.line;
  ctx.font = '600 11px "Public Sans", system-ui, sans-serif';
  ctx.fillText('SITE SURFACE SCHEDULE', x0 + pad, y0 + pad + 10);
  ctx.font = '10px "Public Sans", system-ui, sans-serif';
  rows.forEach((r, i) => {
    const y = y0 + pad + 16 + i * lineH + 8;
    ctx.fillStyle = r.color;
    ctx.fillRect(x0 + pad, y - 8, 10, 10);
    ctx.strokeStyle = INK.faint;
    ctx.strokeRect(x0 + pad + 0.5, y - 7.5, 9, 9);
    ctx.fillStyle = INK.line;
    ctx.fillText(r.label, x0 + pad + 16, y);
    ctx.fillStyle = INK.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(r.sqft).toLocaleString()} ft²`, x0 + boxW - pad, y);
    ctx.textAlign = 'left';
  });
  ctx.fillStyle = INK.dim;
  ctx.font = '10px "Public Sans", system-ui, sans-serif';
  const relief = plan.relief.relief;
  ctx.fillText(
    relief > 0.05
      ? `Contours at ${plan.interval} ft · ${plan.relief.lo.toFixed(1)} to ${plan.relief.hi.toFixed(1)} ft`
      : 'Level site — no contours',
    x0 + pad, y0 + boxH - pad - 2);
}

export function drawSitePlan(ctx, plan, layout, opts = {}) {
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawSiteRegions(ctx, plan, layout);
  if (opts.contours !== false) drawContours(ctx, plan, layout);
  drawSiteMarkings(ctx, plan, layout);
  drawBuildingOutline(ctx, plan, layout);
  if (opts.showFurniture !== false) drawSiteProps(ctx, plan, layout);
  drawSiteLabels(ctx, plan, layout);
  if (opts.showFinishes !== false) drawSiteLegend(ctx, plan, layout, ctx.canvas.width, ctx.canvas.height);
  drawScaleAndNorth(ctx, plan, layout, ctx.canvas.width, ctx.canvas.height);
  drawSheetPanels(ctx, layout, ctx.canvas.width, opts);
  drawTitleBlock(ctx, plan, layout, ctx.canvas.width, { ...opts, sheet: 'Site Plan' });
}

const MARGIN = 40;
const TITLE_H = 56;
const MAX_PX = 4000; // sane cap on export canvas size

export function renderFloorPlanCanvas(state, floorIndex, opts = {}) {
  const plan = computeFloorPlan(state, floorIndex, { occupancy: !!opts.showOccupancy });
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

// The site plan's own canvas. Same sizing rules as a floor plan's — a site is
// four or five times as wide, so it usually lands on the MAX_PX cap and comes
// out at two or three pixels to the foot rather than eight.
export function renderSitePlanCanvas(state, opts = {}) {
  const plan = computeSitePlan(state, opts);
  if (!plan) return null;
  const wFt = plan.bounds.maxX - plan.bounds.minX;
  const hFt = plan.bounds.maxZ - plan.bounds.minZ;
  let scale = opts.scale || 4; // px per ft — a site is a wider drawing
  const rawW = wFt * scale + MARGIN * 2;
  const rawH = hFt * scale + MARGIN * 2 + TITLE_H;
  if (rawW > MAX_PX || rawH > MAX_PX) scale *= Math.min(MAX_PX / rawW, MAX_PX / rawH);
  const layout = { scale, margin: MARGIN, titleH: TITLE_H };
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wFt * scale + MARGIN * 2);
  canvas.height = Math.ceil(hFt * scale + MARGIN * 2 + TITLE_H);
  drawSitePlan(canvas.getContext('2d'), plan, layout, opts);
  return canvas;
}

// ---------- the specification sheet ----------
//
// A sheet rather than a panel, which is the whole point of it: the takeoff
// says how much VCT, `spec.js` says which VCT, and a specification that lives
// in a side panel is a specification nobody on site has read. It prints with
// the drawing set, in the same title block, at the same page width.
//
// Six columns and no drawing. The only real work is that two of them wrap, so
// the row heights have to be measured before anything is painted.
const SPEC_W = 1240;
const SPEC_COLS = [
  { key: 'systemLabel', title: 'System', w: 100, wrap: true },
  { key: 'label', title: 'Assembly', w: 178, wrap: true },
  { key: 'what', title: 'What it is', w: 268, wrap: true },
  { key: 'where', title: 'Level', w: 104, wrap: true },
  { key: 'roomsLabel', title: 'Rooms', w: 190, wrap: true },
  { key: 'qty', title: 'Quantity', w: 88, right: true },
  { key: 'rated', title: 'Rated at', w: 228, wrap: true },
];

function wrapLines(ctx, str, maxW) {
  const words = String(str ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const out = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) { out.push(line); line = w; }
    else line = next;
  }
  if (line) out.push(line);
  return out;
}

const specCell = (line, col) => (col.key === 'qty'
  ? `${Math.round(line.qty).toLocaleString()} ${line.unit}`
  : line[col.key] || '—');

export function renderSpecSheetCanvas(spec, opts = {}) {
  if (!spec || !spec.lines.length) return null;
  const margin = 28;
  const rowPad = 7;
  const lineH = 13;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '11px "Public Sans", system-ui, sans-serif';

  const rows = spec.lines.map((l) => {
    const cells = SPEC_COLS.map((c) => (c.wrap
      ? wrapLines(measure, specCell(l, c), c.w - 12)
      : [specCell(l, c)]));
    return { line: l, cells, h: Math.max(...cells.map((x) => x.length)) * lineH + rowPad * 2 };
  });

  const headH = 26;
  const notesH = 18 + spec.disclaimer.length * 26;
  const bodyH = rows.reduce((n, r) => n + r.h, 0);
  const canvas = document.createElement('canvas');
  canvas.width = SPEC_W;
  canvas.height = Math.min(MAX_PX,
    Math.ceil(TITLE_H + margin + headH + bodyH + notesH + margin));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const xs = [];
  let x = margin;
  for (const c of SPEC_COLS) { xs.push(x); x += c.w; }

  let y = TITLE_H + margin;
  ctx.font = '600 10px "Public Sans", system-ui, sans-serif';
  ctx.fillStyle = INK.dim;
  ctx.textAlign = 'left';
  SPEC_COLS.forEach((c, i) => {
    ctx.textAlign = c.right ? 'right' : 'left';
    ctx.fillText(c.title.toUpperCase(), c.right ? xs[i] + c.w - 6 : xs[i], y + 12);
  });
  y += headH;
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(margin, y - 6.5); ctx.lineTo(SPEC_W - margin, y - 6.5); ctx.stroke();

  ctx.font = '11px "Public Sans", system-ui, sans-serif';
  let lastSystem = null;
  for (const r of rows) {
    if (y + r.h > canvas.height - notesH - margin) {
      ctx.fillStyle = '#8a93a3';
      ctx.textAlign = 'left';
      ctx.fillText('…sheet full; the CSV export carries every line.', margin, y + 12);
      y += 20;
      break;
    }
    // A hairline between systems rather than between every row: the eye wants
    // the groups, and a full grid on a spec sheet is a spec sheet nobody
    // finishes reading.
    if (lastSystem !== null && r.line.system !== lastSystem) {
      ctx.strokeStyle = '#e0e3e8';
      ctx.beginPath(); ctx.moveTo(margin, y + 0.5); ctx.lineTo(SPEC_W - margin, y + 0.5); ctx.stroke();
    }
    lastSystem = r.line.system;
    SPEC_COLS.forEach((c, i) => {
      ctx.textAlign = c.right ? 'right' : 'left';
      ctx.fillStyle = c.key === 'label' ? INK.line : INK.dim;
      r.cells[i].forEach((text, li) => {
        ctx.fillText(text, c.right ? xs[i] + c.w - 6 : xs[i], y + rowPad + 10 + li * lineH);
      });
    });
    y += r.h;
  }

  y += 10;
  ctx.strokeStyle = INK.line;
  ctx.beginPath(); ctx.moveTo(margin, y + 0.5); ctx.lineTo(SPEC_W - margin, y + 0.5); ctx.stroke();
  y += 18;
  ctx.font = '10px "Public Sans", system-ui, sans-serif';
  ctx.fillStyle = '#8a93a3';
  ctx.textAlign = 'left';
  for (const note of spec.disclaimer) {
    y = wrapText(ctx, note, margin, y, SPEC_W - margin * 2, 12) + 2;
  }

  drawTitleBlock(ctx, { label: 'Whole building' }, { margin, titleH: TITLE_H }, SPEC_W,
    { ...opts, sheet: 'Specification' });
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
