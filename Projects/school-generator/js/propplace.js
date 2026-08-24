// propplace.js — pure placement logic for props: picking, footprints and the
// three snap tiers the tool offers (grid, wall, other props). No three.js —
// the pointer stream and overlay live in propedit.js, same split as
// shapes.js (model) vs. polyedit.js (interaction).
//
// Rotation convention: `rotationY` is used exactly as three.js uses it —
// `Object3D.rotation.y` / `Matrix4.makeRotationY(rotationY)` — so a value
// computed here can go straight into a prop's transform in render.js. Under
// that convention a local point (lx, lz) maps to world
// (lx·cosθ + lz·sinθ, -lx·sinθ + lz·cosθ); `faceDirection` inverts that for
// "make local +Z point this way", which is how wall-mounted props orient
// themselves away from the wall they're snapped to.

import { CELL, WALL_T } from './grid.js';
import { shapesOf, segEnds, projectOnSeg, SEG_WALL } from './shapes.js';

// Furniture snaps to a finer lattice than room walls do — half a cell reads
// as "on grid" for a 2ft desk the way a full 4ft cell does for a wall.
export const FURN_GRID = CELL / 2;

// ---------- footprint / picking ----------

// Half-extents of a prop's footprint in feet, at its own scale.
export function footprintOf(entry, prop) {
  const scale = (prop && typeof prop.scale === 'number' && prop.scale > 0) ? prop.scale : 1;
  return { hw: (entry.w * scale) / 2, hd: (entry.d * scale) / 2 };
}

// World point -> the prop's local space (see the rotation-convention note
// above for the inverse this undoes).
export function worldToLocal(prop, x, z) {
  const c = Math.cos(prop.rotationY || 0), s = Math.sin(prop.rotationY || 0);
  const wx = x - prop.x, wz = z - prop.z;
  return { lx: wx * c - wz * s, lz: wx * s + wz * c };
}

export function pointInProp(entry, prop, x, z, pad = 0) {
  const { hw, hd } = footprintOf(entry, prop);
  const { lx, lz } = worldToLocal(prop, x, z);
  return Math.abs(lx) <= hw + pad && Math.abs(lz) <= hd + pad;
}

// Topmost prop under a point — later entries in `props` win, same rule
// `shapeAt` uses, so a prop placed on top of another is the one you select.
// `catalogGet` is injected (rather than importing catalog.js) so this stays
// usable with a stub catalog in tests.
export function pickPropAt(props, floorIndex, catalogGet, x, z, pad = 0.15) {
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i];
    if (p.floor !== floorIndex) continue;
    const entry = catalogGet(p.type);
    if (!entry) continue;
    if (pointInProp(entry, p, x, z, pad)) return p;
  }
  return null;
}

// Props whose footprint overlaps an axis-aligned box — used for marquee
// select. Approximate: test the prop's own AABB (from its rotated corners)
// against the box rather than exact polygon overlap; good enough for a
// rubber-band selection where near-misses just mean one more click.
export function propsInBox(props, floorIndex, catalogGet, x0, z0, x1, z1) {
  const lo = { x: Math.min(x0, x1), z: Math.min(z0, z1) };
  const hi = { x: Math.max(x0, x1), z: Math.max(z0, z1) };
  const out = [];
  for (const p of props) {
    if (p.floor !== floorIndex) continue;
    const entry = catalogGet(p.type);
    if (!entry) continue;
    const { hw, hd } = footprintOf(entry, p);
    const c = Math.cos(p.rotationY || 0), s = Math.sin(p.rotationY || 0);
    // AABB of the four rotated corners.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      const wx = p.x + lx * c + lz * s, wz = p.z - lx * s + lz * c;
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
    if (maxX < lo.x || minX > hi.x || maxZ < lo.z || minZ > hi.z) continue;
    out.push(p);
  }
  return out;
}

// rotationY such that a prop's local +Z axis points along (dx, dz).
export function faceDirection(dx, dz) {
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return Math.atan2(dx, dz);
}

// ---------- wall snapping ----------
//
// Wall-mounted props (TVs, smart boards) snap onto the nearest wall — a
// polygon wall segment or a grid edge, whichever is closer — flush against
// its face and turned to look into the room the cursor was on the side of.

function nearestGridWall(floor, x, z, maxDist) {
  let best = null;
  for (let y = 0; y <= floor.h; y++) {
    for (let gx = 0; gx < floor.w; gx++) {
      if (floor.edgesH[y * floor.w + gx] !== 1) continue;
      const a = { x: gx * CELL, z: y * CELL }, b = { x: (gx + 1) * CELL, z: y * CELL };
      const p = projectOnSeg(a, b, x, z);
      if (p.dist <= maxDist && (!best || p.dist < best.dist)) best = { a, b, x: p.x, z: p.z, dist: p.dist };
    }
  }
  for (let gy = 0; gy < floor.h; gy++) {
    for (let gx = 0; gx <= floor.w; gx++) {
      if (floor.edgesV[gy * (floor.w + 1) + gx] !== 1) continue;
      const a = { x: gx * CELL, z: gy * CELL }, b = { x: gx * CELL, z: (gy + 1) * CELL };
      const p = projectOnSeg(a, b, x, z);
      if (p.dist <= maxDist && (!best || p.dist < best.dist)) best = { a, b, x: p.x, z: p.z, dist: p.dist };
    }
  }
  return best;
}

// Same idea for polygon rooms, but only segments actually carrying a wall —
// `nearestSegment` in shapes.js answers "closest boundary", walled or not,
// which isn't what a TV should hang on.
function nearestPolyWall(floor, x, z, maxDist) {
  let best = null;
  for (const shape of shapesOf(floor)) {
    shape.rings.forEach((ring) => {
      for (let i = 0; i < ring.pts.length; i++) {
        if (ring.walls[i] !== SEG_WALL) continue;
        const [a, b] = segEnds(ring, i);
        const p = projectOnSeg(a, b, x, z);
        if (p.dist <= maxDist && (!best || p.dist < best.dist)) best = { a, b, x: p.x, z: p.z, dist: p.dist };
      }
    });
  }
  return best;
}

function nearestWall(floor, x, z, maxDist) {
  const g = nearestGridWall(floor, x, z, maxDist);
  const p = nearestPolyWall(floor, x, z, maxDist);
  if (!g) return p;
  if (!p) return g;
  return g.dist <= p.dist ? g : p;
}

// {x, z, rotationY} flush against the nearest wall within `tol`, facing into
// whichever side of it the raw cursor point was on — or null if no wall is
// close enough.
export function wallSnap(floor, x, z, depthFt, tol) {
  const w = nearestWall(floor, x, z, tol);
  if (!w) return null;
  const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  // Offset from the wall line, with the along-wall component projected out —
  // otherwise a cursor near a wall's end skews the "which side" reading.
  let ox = x - w.x, oz = z - w.z;
  const along = ox * ux + oz * uz;
  ox -= ux * along; oz -= uz * along;
  let mag = Math.hypot(ox, oz);
  let nx, nz;
  if (mag < 1e-6) { nx = -uz; nz = ux; } // cursor sat exactly on the line — pick a side
  else { nx = ox / mag; nz = oz / mag; }
  const offset = WALL_T / 2 + depthFt / 2;
  return {
    x: w.x + nx * offset,
    z: w.z + nz * offset,
    rotationY: faceDirection(nx, nz),
    dist: w.dist,
  };
}

// ---------- prop-to-prop snapping ----------
//
// Floor-standing props snap alongside a neighbour of the same rotation —
// lining up a row of desks — by testing the four positions flush against
// that neighbour's edges and taking whichever is both closest to the cursor
// and within tolerance.

export function rowSnap(props, floorIndex, catalogGet, excludeId, entry, prop, x, z, tol) {
  const { hw: mhw, hd: mhd } = footprintOf(entry, prop);
  let best = null;
  for (const other of props) {
    if (other.floor !== floorIndex || other.id === excludeId) continue;
    const oe = catalogGet(other.type);
    if (!oe || oe.mount !== entry.mount) continue;
    const { hw: ohw, hd: ohd } = footprintOf(oe, other);
    const c = Math.cos(other.rotationY || 0), s = Math.sin(other.rotationY || 0);
    // Other's local axes expressed in world space (see the rotation-
    // convention note at the top of the file).
    const ax = { x: c, z: -s };
    const az = { x: s, z: c };
    const candidates = [
      { x: other.x + ax.x * (ohw + mhw), z: other.z + ax.z * (ohw + mhw) },
      { x: other.x - ax.x * (ohw + mhw), z: other.z - ax.z * (ohw + mhw) },
      { x: other.x + az.x * (ohd + mhd), z: other.z + az.z * (ohd + mhd) },
      { x: other.x - az.x * (ohd + mhd), z: other.z - az.z * (ohd + mhd) },
    ];
    for (const cand of candidates) {
      const d = Math.hypot(cand.x - x, cand.z - z);
      if (d <= tol && (!best || d < best.d)) {
        best = { x: cand.x, z: cand.z, rotationY: other.rotationY || 0, d };
      }
    }
  }
  return best;
}

// ---------- grid snapping ----------

export function gridSnap(x, z, tol, step = FURN_GRID) {
  const gx = Math.round(x / step) * step, gz = Math.round(z / step) * step;
  const onX = Math.abs(gx - x) <= tol, onZ = Math.abs(gz - z) <= tol;
  if (!onX && !onZ) return null;
  return { x: onX ? gx : x, z: onZ ? gz : z };
}

// ---------- composed ----------
//
// Order of preference: wall (only for a wall-mounted type), then a
// neighbouring prop, then the furniture lattice, then free placement.
// `rotationY` is the fallback orientation (whatever the tool's current
// heading is) when nothing snaps rotation for you.
export function snapProp(floor, props, floorIndex, entry, prop, x, z, rotationY, opts = {}) {
  if (opts.free) return { x, z, rotationY, mount: entry.mount, kind: 'free' };
  const tol = opts.tol ?? 1.5;

  if (entry.mount === 'wall') {
    const w = wallSnap(floor, x, z, entry.d * ((prop && prop.scale) || 1), tol);
    if (w) return { x: w.x, z: w.z, rotationY: w.rotationY, mount: 'wall', kind: 'wall' };
  } else {
    const r = rowSnap(props, floorIndex, opts.catalogGet, opts.excludeId, entry, prop || { x, z, rotationY, scale: 1 }, x, z, tol);
    if (r) return { x: r.x, z: r.z, rotationY: r.rotationY, mount: entry.mount, kind: 'row' };
  }

  const g = gridSnap(x, z, tol);
  if (g) return { x: g.x, z: g.z, rotationY, mount: entry.mount, kind: 'grid' };

  return { x, z, rotationY, mount: entry.mount, kind: 'free' };
}
