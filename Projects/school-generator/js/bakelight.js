// bakelight.js — light that stops at walls, computed offline.
//
// Phase 27. The backlog said it for three arcs: no shadows from the
// building's own lights, light that respects distance and never geometry — a
// troffer shines through the wall its range crosses. Real-time shadow maps
// for dozens of interior lights would spend the frame budget the whole
// renderer is built to protect, but this tool's buildings *hold still*, so
// the static answer is to bake: this module computes illumination against
// the same occluder rules sightline.js already knows (a wall blocks, glass
// and rails pass a look whole, a window passes at the heights of its band, a
// doorway is a hole), and the renderer wears the result at zero per-frame
// cost.
//
// The bake is a field, not a texture atlas: one 2ft grid per storey, sampled
// at desk height, that the renderer reads back per *vertex* — the merged
// storey geometry already carries vertex colours for paint and facades, and
// baked light is one more multiplier on the same attribute. Two channels are
// banked separately and never summed here:
//
//   day   0..1 — how much of the sky reaches this point, through the
//         apertures the storey actually has. Directionless on purpose: it is
//         a daylight-access factor, not a sun patch, which is exactly what
//         lets a Phase 20 mood *recombine* the bake (day × the mood's sun,
//         fix × the mood's lamp level) instead of re-running it.
//   fix   RGB — the fixtures' own contribution, from the same sources the
//         live budget counts (lights.js's placed emitters and the ceiling's
//         generic troffer lattice), each cast against the occluders so a
//         corridor darkens around its corner and light pools under the pans.
//
// Direct light plus one gathered bounce: the bounce is a short diffusion of
// the direct field through the openings between cells — deliberately a
// spill, not a solver. It is what makes a doorway throw a pool into the
// corridor and borrowed light cross an interior window, and it respects the
// same walls the direct pass does.
//
// A bake is a *cache*, keyed on a hash of the structural state that made it
// (`bakeKey`): rooms, walls, openings, the vertical links, the emitting
// props — never the environment, never a name, never paint. Change the hour
// and the bake recombines; move a wall and the key changes, which is how
// staleness stays honest without this module ever hearing about an editor.
//
// Pure module: no three.js, no DOM, no worker — bakeworker.js is the thin
// shell that runs it off the main thread. Exercised by test/bakelight.test.mjs.

import { FLOOR_H, WALL_H, EYE_H } from './grid.js';
import {
  shapesOf, segEnds, shapeBBox, pointInShape, shapeAt,
  openingSpec, isDoorOpening, isBuilt, SEG_WALL,
} from './shapes.js';
import { segsCross } from './collide.js';
import { windowBand } from './openings.js';
import { sightBlockers, sightClear } from './sightline.js';
import { lightSources, trofferSources, emitOf } from './lights.js';

// The format, stated once. Anything that changes what the numbers mean bumps
// this, and every stored bake quietly stops matching — a version mismatch is
// just a cache miss.
export const BAKE_VERSION = 1;

export const BAKE_CELL = 2;      // ft per bake cell — half the drawing grid
export const BAKE_PLANE = 3;     // ft above the storey's floor: desk height
export const BAKE_PAD = 4;       // cells of outdoors kept around the storey

// How far daylight reaches inward from an aperture, in feet. Deeper than any
// daylighting rule of thumb (2.5× head height) because the day channel is
// access, not compliance — the fade to that depth is what the eye reads as a
// room going dim toward its back wall.
export const DAY_RANGE = 44;

// The bounce: how many diffusion passes the gathered spill takes and how
// much of it is added back. Four passes at 2ft is a spill of about eight
// feet — a doorway's pool, not a radiosity solve.
export const BOUNCE_PASSES = 4;
export const BOUNCE_GAIN = 0.5;

// ---------- recombining, stated here so both renderers agree ----------

// The floor of the tint. Never zero: a bake multiplies the vertex colours
// the geometry carries, and a surface at true zero would be a hole in the
// picture rather than a dark room.
export const BAKE_TINT_MIN = 0.14;
// One artistic constant per channel, same bargain as render.js's LIGHT_GAIN:
// FIX_GAIN says how bright a troffer-lit desk reads against everything else.
export const BAKE_FIX_GAIN = 0.7;

// The recombination — the only place the two channels meet. `dayLevel` is
// how hard the sky is on (0 at night, 1 at noon); `lampLevel` is sky.js's
// fixture ramp. Writes into `out` {r,g,b} so a per-vertex loop allocates
// nothing.
export function bakedTint(sample, dayLevel, lampLevel, out = { r: 0, g: 0, b: 0 }) {
  const day = sample.day * dayLevel;
  out.r = Math.min(1, BAKE_TINT_MIN + day + sample.r * BAKE_FIX_GAIN * lampLevel);
  out.g = Math.min(1, BAKE_TINT_MIN + day + sample.g * BAKE_FIX_GAIN * lampLevel);
  out.b = Math.min(1, BAKE_TINT_MIN + day + sample.b * BAKE_FIX_GAIN * lampLevel);
  return out;
}

// ---------- the key ----------

// FNV-1a, run twice with different offsets, because 32 bits of key on a
// cache that silently *wears* a stale answer is not enough to stop worrying
// about.
const fnv = (str, seed) => {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

// What the bake depends on, and nothing else: the rings (points, wall kinds,
// openings), the vertical links (stairs cut the troffer lattice, lifts
// occlude), the storey height, and the emitting props. A rename, a repaint,
// a mood, a moved chair — none of them touch the key, which is what lets a
// stored bake survive everything that doesn't change the light.
export function bakeKey(state, catalogEntry) {
  if (!state || !Array.isArray(state.floors)) return `v${BAKE_VERSION}:empty`;
  const parts = [`v${BAKE_VERSION}`, `ht:${state.floorHt || FLOOR_H}`];
  state.floors.forEach((floor, i) => {
    parts.push(`f${i}`);
    for (const shape of shapesOf(floor)) {
      for (const ring of shape.rings) {
        parts.push(JSON.stringify(ring.pts), JSON.stringify(ring.walls),
          JSON.stringify(ring.openings));
      }
    }
  });
  parts.push(JSON.stringify(state.links || []));
  for (const p of state.props || []) {
    if (!emitOf(catalogEntry ? catalogEntry(p.type) : null)) continue;
    parts.push(`p:${p.type}:${p.floor}:${p.x}:${p.z}:${p.y || 0}:${p.scale || 1}`);
  }
  const s = parts.join('|');
  return `${fnv(s, 0x811c9dc5).toString(16).padStart(8, '0')}` +
    `${fnv(s, 0x9747b28c).toString(16).padStart(8, '0')}`;
}

// ---------- one storey's grid ----------

const floorGridBounds = (floor) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const shape of shapesOf(floor)) {
    const bb = shapeBBox(shape);
    x0 = Math.min(x0, bb.x0); z0 = Math.min(z0, bb.z0);
    x1 = Math.max(x1, bb.x1); z1 = Math.max(z1, bb.z1);
  }
  if (x0 > x1) return null;
  return {
    x0: Math.floor(x0 / BAKE_CELL - BAKE_PAD) * BAKE_CELL,
    z0: Math.floor(z0 / BAKE_CELL - BAKE_PAD) * BAKE_CELL,
    x1: Math.ceil(x1 / BAKE_CELL + BAKE_PAD) * BAKE_CELL,
    z1: Math.ceil(z1 / BAKE_CELL + BAKE_PAD) * BAKE_CELL,
  };
};

// Occluder segments pruned to a circle, because every cast below is bounded
// by a range and a room's worth of segments beats a building's worth.
const segsNear = (segs, x, z, r) => {
  const out = [];
  for (const s of segs) {
    if (Math.min(s.ax, s.bx) > x + r || Math.max(s.ax, s.bx) < x - r) continue;
    if (Math.min(s.az, s.bz) > z + r || Math.max(s.az, s.bz) < z - r) continue;
    out.push(s);
  }
  return out;
};

// ---------- the apertures the sky comes in through ----------
//
// Everything on the storey with outdoors on its far side that a look passes:
// each window (at its band — the band is why a clerestory still counts: the
// sky doesn't stand at eye height), each doorway, and each run of curtain
// wall or guardrail, cut into bays so a long storefront reads as many small
// skylights rather than one point. `nx/nz` is the wall's unit normal; which
// side is outdoors is probed the way doorPoints probes rooms.
const OUT_PROBE = 2;   // ft past the wall line when asking "is that outdoors?"
const GLASS_APERTURE_BAY = 8;   // ft per aperture along an unbroken glazed run

export function dayApertures(floor) {
  const out = [];
  if (!floor) return out;
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        const kind = ring.walls[i];
        if (!isBuilt(kind)) continue;
        const [a, b] = segEnds(ring, i);
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = -dz / len, nz = dx / len;
        const outdoorSide = (x, z) => {
          if (!shapeAt(floor, x + nx * OUT_PROBE, z + nz * OUT_PROBE)) return 1;
          if (!shapeAt(floor, x - nx * OUT_PROBE, z - nz * OUT_PROBE)) return -1;
          return 0;
        };
        if (kind === SEG_WALL) {
          for (const o of ring.openings) {
            if (o.seg !== i) continue;
            const spec = openingSpec(o);
            const x = a.x + dx * spec.t, z = a.z + dz * spec.t;
            const side = outdoorSide(x, z);
            if (!side) continue;
            // Weight by how much of the wall's height is actually open —
            // a full-height double door outshines a ribbon window.
            const h = isDoorOpening(o) ? spec.h : windowBand(spec).h;
            out.push({ x, z, nx, nz, w: spec.w, weight: Math.min(1, h / WALL_H), side });
          }
        } else {
          // Glass or rail: the whole run passes light. Bays, so distance
          // falloff is measured to the nearest stretch of it.
          const bays = Math.max(1, Math.round(len / GLASS_APERTURE_BAY));
          for (let k = 0; k < bays; k++) {
            const t = (k + 0.5) / bays;
            const x = a.x + dx * t, z = a.z + dz * t;
            const side = outdoorSide(x, z);
            if (!side) continue;
            out.push({ x, z, nx, nz, w: len / bays, weight: kind === SEG_WALL ? 1 : 0.92, side });
          }
        }
      }
    }
  }
  return out;
}

// ---------- the bake ----------

// Distance falloff for a fixture: an inverse-square core inside a smooth
// window that lands at zero exactly at the source's stated range — the same
// promise three.js's `distance` makes, kept by the bake so a fixture's reach
// is one number in both worlds. The 4ft floor under d² keeps the cell a
// troffer hangs directly over finite rather than blinding.
const falloff = (d2, range) => {
  if (d2 >= range * range) return 0;
  const w = 1 - d2 / (range * range);
  return (w * w) / (4 * Math.PI * Math.max(16, d2));
};

export function bakeLight(state, catalogEntry, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const ht = (state && state.floorHt) || FLOOR_H;
  const floors = [];
  const nFloors = state && Array.isArray(state.floors) ? state.floors.length : 0;

  // Every emitting thing in the design, once — placed fixtures and the
  // ceiling's generic pans, exactly the sources the live budget counts
  // (`troffers: false` is the same escape hatch budgetFor offers, for a
  // caller asking only about placed fixtures). Outdoor sources stay out of
  // the bake: the site's poles remain real lights in the renderer, so they
  // are not baked *and* burned.
  const sources = lightSources(state, catalogEntry, ht)
    .concat(opts.troffers === false ? [] : trofferSources(state, ht))
    .filter((s) => !s.outdoor);

  const hex = (c) => {
    const n = parseInt(String(c || '#ffffff').slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  for (let f = 0; f < nFloors; f++) {
    const floor = state.floors[f];
    const bounds = floorGridBounds(floor);
    if (!bounds) {
      floors.push({ f, x0: 0, z0: 0, w: 0, h: 0, day: new Float32Array(0), fix: new Float32Array(0) });
      if (onProgress) onProgress((f + 1) / nFloors);
      continue;
    }
    const w = Math.round((bounds.x1 - bounds.x0) / BAKE_CELL);
    const h = Math.round((bounds.z1 - bounds.z0) / BAKE_CELL);
    const n = w * h;
    const day = new Float32Array(n);
    const fix = new Float32Array(n * 3);
    const cx = (i) => bounds.x0 + ((i % w) + 0.5) * BAKE_CELL;
    const cz = (i) => bounds.z0 + (Math.floor(i / w) + 0.5) * BAKE_CELL;

    // The same occluders a look obeys: solid walls minus their openings
    // (windows are holes at eye height, doorways are holes), lift shafts
    // added. No leaves — a bake has no live doors, so doorways pass.
    const segs = sightBlockers(state, f, { eyeH: EYE_H });

    // Indoors or out, per cell. Outdoors *is* the sky: day = 1.
    const indoor = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const inside = shapeAt(floor, cx(i), cz(i));
      indoor[i] = inside ? 1 : 0;
      if (!inside) day[i] = 1;
    }

    // Daylight, gathered from the apertures. The cast aims just short of the
    // aperture on the cell's own side, the way doorSeen does, so the ray
    // never has to thread the exact hole its target sits in.
    const apertures = dayApertures(floor);
    for (const ap of apertures) {
      const near = segsNear(segs, ap.x, ap.z, DAY_RANGE);
      const gx0 = Math.max(0, Math.floor((ap.x - DAY_RANGE - bounds.x0) / BAKE_CELL));
      const gx1 = Math.min(w - 1, Math.ceil((ap.x + DAY_RANGE - bounds.x0) / BAKE_CELL));
      const gz0 = Math.max(0, Math.floor((ap.z - DAY_RANGE - bounds.z0) / BAKE_CELL));
      const gz1 = Math.min(h - 1, Math.ceil((ap.z + DAY_RANGE - bounds.z0) / BAKE_CELL));
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gz * w + gx;
          if (!indoor[i] || day[i] >= 1) continue;
          const x = cx(i), z = cz(i);
          const dx = x - ap.x, dz = z - ap.z;
          const d = Math.hypot(dx, dz);
          if (d >= DAY_RANGE || d < 0.01) continue;
          // Only the indoor side of the aperture gathers from it.
          const side = Math.sign(dx * ap.nx + dz * ap.nz) || 1;
          if (side === ap.side) continue;
          const tx = ap.x + ap.nx * side * 0.3, tz = ap.z + ap.nz * side * 0.3;
          if (!sightClear(near, null, x, z, tx, tz)) continue;
          const fade = 1 - d / DAY_RANGE;
          day[i] = Math.min(1, day[i] + ap.weight * (ap.w / 8) * fade * fade);
        }
      }
    }

    // The fixtures, cast one by one. `planeY` is the desk-height sample
    // plane; a source's height above it is real distance, which is what
    // keeps a pan's pool tight and a high bay's wide.
    const planeY = f * ht + BAKE_PLANE;
    for (const s of sources) {
      if (s.floor !== f) continue;
      const [r, g, b] = hex(s.color);
      const range = s.range > 0 ? s.range : 30;
      const near = segsNear(segs, s.x, s.z, range);
      const gx0 = Math.max(0, Math.floor((s.x - range - bounds.x0) / BAKE_CELL));
      const gx1 = Math.min(w - 1, Math.ceil((s.x + range - bounds.x0) / BAKE_CELL));
      const gz0 = Math.max(0, Math.floor((s.z - range - bounds.z0) / BAKE_CELL));
      const gz1 = Math.min(h - 1, Math.ceil((s.z + range - bounds.z0) / BAKE_CELL));
      const dy = s.y - planeY;
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gz * w + gx;
          const x = cx(i), z = cz(i);
          const dx = x - s.x, dz = z - s.z;
          const d2 = dx * dx + dz * dz + dy * dy;
          const e = s.lm * falloff(d2, range);
          if (e <= 0) continue;
          if (!sightClear(near, null, s.x, s.z, x, z)) continue;
          fix[i * 3] += e * r;
          fix[i * 3 + 1] += e * g;
          fix[i * 3 + 2] += e * b;
        }
      }
    }

    // One gathered bounce: diffuse both channels through the openings
    // between adjacent cells. An edge is open when no occluder crosses the
    // 2ft between the two centres — so spill turns corners through doorways
    // and stops dead at walls, which is the entire point.
    const openX = new Uint8Array(n);   // cell i <-> i+1
    const openZ = new Uint8Array(n);   // cell i <-> i+w
    for (let i = 0; i < n; i++) {
      const x = cx(i), z = cz(i);
      const near = segsNear(segs, x, z, BAKE_CELL * 1.5);
      if ((i % w) < w - 1) openX[i] = sightClear(near, null, x, z, x + BAKE_CELL, z) ? 1 : 0;
      if (i + w < n) openZ[i] = sightClear(near, null, x, z, x, z + BAKE_CELL) ? 1 : 0;
    }
    const diffuse = (src) => {
      const stride = src.length / n;   // 1 for day, 3 for fix
      let cur = src.slice();
      const next = new Float32Array(src.length);
      for (let pass = 0; pass < BOUNCE_PASSES; pass++) {
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < stride; c++) {
            let sum = cur[i * stride + c];
            let count = 1;
            if ((i % w) < w - 1 && openX[i]) { sum += cur[(i + 1) * stride + c]; count++; }
            if ((i % w) > 0 && openX[i - 1]) { sum += cur[(i - 1) * stride + c]; count++; }
            if (i + w < n && openZ[i]) { sum += cur[(i + w) * stride + c]; count++; }
            if (i >= w && openZ[i - w]) { sum += cur[(i - w) * stride + c]; count++; }
            next[i * stride + c] = sum / count;
          }
        }
        const t = cur; cur = next.slice(); void t;
      }
      return cur;
    };
    const dayB = diffuse(day);
    const fixB = diffuse(fix);
    for (let i = 0; i < n; i++) {
      // Outdoors stays exactly 1 — the sky is not dimmed by the doorway it
      // happens to stand beside.
      day[i] = indoor[i]
        ? Math.min(1, day[i] * (1 - BOUNCE_GAIN) + dayB[i] * BOUNCE_GAIN)
        : 1;
      for (let c = 0; c < 3; c++) {
        fix[i * 3 + c] = fix[i * 3 + c] * (1 - BOUNCE_GAIN) + fixB[i * 3 + c] * BOUNCE_GAIN;
      }
    }

    floors.push({ f, x0: bounds.x0, z0: bounds.z0, w, h, day, fix });
    if (onProgress) onProgress((f + 1) / nFloors);
  }

  return {
    version: BAKE_VERSION,
    key: bakeKey(state, catalogEntry),
    cell: BAKE_CELL,
    floors,
  };
}

// ---------- sampling ----------

// Bilinear over cell centres, writing into `out` so a hundred-thousand-vertex
// loop allocates nothing. A point outside the grid — or on a storey with no
// grid — is outdoors: full sky, no fixtures.
export function sampleBake(bake, floorIndex, x, z, out = { day: 1, r: 0, g: 0, b: 0 }) {
  const fl = bake && bake.floors ? bake.floors[floorIndex] : null;
  if (!fl || !fl.w || !fl.h) {
    out.day = 1; out.r = 0; out.g = 0; out.b = 0;
    return out;
  }
  const cell = bake.cell || BAKE_CELL;
  const gx = Math.min(fl.w - 1.001, Math.max(0, (x - fl.x0) / cell - 0.5));
  const gz = Math.min(fl.h - 1.001, Math.max(0, (z - fl.z0) / cell - 0.5));
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const tx = gx - x0, tz = gz - z0;
  const i00 = z0 * fl.w + x0, i10 = i00 + 1, i01 = i00 + fl.w, i11 = i01 + 1;
  const mix = (arr, s) => {
    const a = arr[i00 * s.stride + s.c] * (1 - tx) + arr[i10 * s.stride + s.c] * tx;
    const b = arr[i01 * s.stride + s.c] * (1 - tx) + arr[i11 * s.stride + s.c] * tx;
    return a * (1 - tz) + b * tz;
  };
  out.day = mix(fl.day, { stride: 1, c: 0 });
  out.r = mix(fl.fix, { stride: 3, c: 0 });
  out.g = mix(fl.fix, { stride: 3, c: 1 });
  out.b = mix(fl.fix, { stride: 3, c: 2 });
  return out;
}

// ---------- packing ----------
//
// A bake at rest — in IndexedDB beside the autosave, or riding a walk
// export — is quantized to a byte a channel: 255 levels of light is more
// than a tone-mapped screen shows, and it is a quarter of the Float32 it
// came from. `fixScale` keeps the fixture channel honest across the
// quantization: bytes are fractions of the brightest cell in the bake.

export function packBake(bake) {
  if (!bake || !Array.isArray(bake.floors)) return null;
  let peak = 0;
  for (const fl of bake.floors) {
    for (let i = 0; i < fl.fix.length; i++) peak = Math.max(peak, fl.fix[i]);
  }
  const fixScale = peak > 0 ? peak : 1;
  return {
    version: bake.version,
    key: bake.key,
    cell: bake.cell,
    fixScale,
    floors: bake.floors.map((fl) => {
      const day = new Uint8Array(fl.day.length);
      for (let i = 0; i < day.length; i++) {
        day[i] = Math.round(Math.min(1, Math.max(0, fl.day[i])) * 255);
      }
      const fix = new Uint8Array(fl.fix.length);
      for (let i = 0; i < fix.length; i++) {
        fix[i] = Math.round(Math.min(1, Math.max(0, fl.fix[i] / fixScale)) * 255);
      }
      return { f: fl.f, x0: fl.x0, z0: fl.z0, w: fl.w, h: fl.h, day, fix };
    }),
  };
}

// The reverse — and the gate: a packed bake from another version, or one
// that has lost its shape, unpacks to null and reads as a cache miss.
export function unpackBake(packed) {
  if (!packed || packed.version !== BAKE_VERSION) return null;
  if (typeof packed.key !== 'string' || !Array.isArray(packed.floors)) return null;
  const scale = typeof packed.fixScale === 'number' && packed.fixScale > 0 ? packed.fixScale : 1;
  const floors = [];
  for (const fl of packed.floors) {
    if (!fl || !Number.isFinite(fl.w) || !Number.isFinite(fl.h)) return null;
    const n = fl.w * fl.h;
    const dayQ = fl.day instanceof Uint8Array ? fl.day : new Uint8Array(fl.day || []);
    const fixQ = fl.fix instanceof Uint8Array ? fl.fix : new Uint8Array(fl.fix || []);
    if (dayQ.length !== n || fixQ.length !== n * 3) return null;
    const day = new Float32Array(n);
    for (let i = 0; i < n; i++) day[i] = dayQ[i] / 255;
    const fix = new Float32Array(n * 3);
    for (let i = 0; i < fix.length; i++) fix[i] = (fixQ[i] / 255) * scale;
    floors.push({ f: fl.f, x0: fl.x0, z0: fl.z0, w: fl.w, h: fl.h, day, fix });
  }
  return { version: packed.version, key: packed.key, cell: packed.cell || BAKE_CELL, floors };
}

// ---------- a bake as text ----------
//
// For the walk export, which carries its bake the way it carries its design:
// one string in a text script tag. Plain base64 (not base64url — this never
// rides a URL) over the packed bytes, inside ordinary JSON; share.js's codec
// then deflates the whole thing, so a run of dark corridor costs almost
// nothing on disk.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function b64ToBytes(text) {
  const clean = String(text || '').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0, buf = 0, bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('not base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out;
}

export function encodeBakeText(packed) {
  if (!packed) return '';
  return JSON.stringify({
    version: packed.version,
    key: packed.key,
    cell: packed.cell,
    fixScale: packed.fixScale,
    floors: packed.floors.map((fl) => ({
      f: fl.f, x0: fl.x0, z0: fl.z0, w: fl.w, h: fl.h,
      day: bytesToB64(fl.day), fix: bytesToB64(fl.fix),
    })),
  });
}

// Anything that isn't a bake this build wrote decodes to null — a hand-edited
// export falls back to live lighting rather than to a broken picture.
export function decodeBakeText(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || ''));
  } catch {
    return null;
  }
  if (!raw || raw.version !== BAKE_VERSION || !Array.isArray(raw.floors)) return null;
  try {
    return {
      version: raw.version,
      key: raw.key,
      cell: raw.cell,
      fixScale: raw.fixScale,
      floors: raw.floors.map((fl) => ({
        f: fl.f, x0: fl.x0, z0: fl.z0, w: fl.w, h: fl.h,
        day: b64ToBytes(fl.day), fix: b64ToBytes(fl.fix),
      })),
    };
  } catch {
    return null;
  }
}
