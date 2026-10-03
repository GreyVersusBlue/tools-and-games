// daylight.js — how much glass a room has, against how much floor it has.
//
// The honest half of a daylight study. A real one traces the sky through a
// window and onto a desk; this one measures the glazed area in a room's
// exterior walls and divides. That is the check a code actually writes down
// (IBC 1205.2: net glazed area not less than 8% of the floor area of the room
// served), it is computable from the model exactly, and it is the number an
// architect sketching a wing wants before any of the rest.
//
// What the ratio does not know, the second half of this file does (#822): how
// much sky each pane sees past the wing opposite, the storey jettied out above
// it and the eave of a pitched roof; how deep the room runs behind its glass;
// which way the glass faces; and how long the sun Phase 3 places stands in it.
// Three numbers come out, each a published rule of thumb rather than a traced
// ray, and each named for what it is:
//
//   adf       the BRE average daylight factor, percent. T·ΣAw·θ / (A·(1−R²)),
//             under a CIE overcast sky, which has no compass: orientation does
//             not move this number, and the file does not pretend it does.
//   deep      the limiting-depth rule for a room glazed on one side,
//             L/W + L/H ≤ 2/(1−Rb). Past it the back of the room is dim
//             whatever the average says.
//   sunHours  hours between 08:00 and 16:00, on the design's own date,
//             latitude and north, that direct sun reaches any of the room's
//             glass. This is where orientation and the overhang count.
//
// What it still does not claim: neighbours, trees and terrain are not in the
// model, a curtain wall is read at its midpoint, reflectance and transmittance
// are one stated constant each, and none of it is an illuminance. The code's
// line is still the glazing ratio; these are notes, never warnings.
//
// **Only exterior glass counts.** A window into a corridor lights the room
// from the corridor's borrowed light; a glazed office front is a lovely thing
// and not a source of daylight. Both are measured, both are reported, and only
// the first goes into the ratio.
//
// Pure module: no three.js, no DOM. Exercised by test/daylight.test.mjs.

import { WALL_H, floorLabel, floorBaseY } from './grid.js';
import {
  shapesOf, segEnds, openingSpec, isWindowOpening, SEG_GLASS,
} from './shapes.js';
import { buildNav, PROBE } from './navgraph.js';
import { buildingOccupancy } from './occupancy.js';
import { editionOf, editionEntry, citeFor, DEFAULT_EDITION } from './codes.js';
import { EAVE, isPitched } from './roof.js';
import { normalizeEnv, solarPosition, sunVector } from './sky.js';

// IBC 1205.2 — the floor of the thing, for a room people occupy. The default
// edition's number, for a caller with none in hand; since Phase 41 the
// analysis reads it off the edition the design stores, and says which.
export const MIN_RATIO = editionEntry(DEFAULT_EDITION).glazing;
// What a daylit classroom is usually drawn at. Above the code minimum, below
// a curtain wall; a room over this is not short of light.
export const GOOD_RATIO = 0.15;

// The uses this check applies to. A corridor, a store and a restroom are
// allowed to be windowless, and flagging them buries the finding that matters.
export const NEEDS_LIGHT = new Set([
  'classroom', 'library', 'lab', 'assembly-seats', 'assembly-tables',
  'office', 'gym', 'stage', 'unassigned',
]);

// ---------- the sky a pane sees ----------

// The BRE average daylight factor's constants. Diffuse transmittance of clear
// double glazing with a maintenance factor for dirt, and the area-weighted
// reflectance of a light-coloured room. An opening's whole area is taken as
// glass, the same reading the glazing ratio makes.
export const GLASS_T = 0.68 * 0.9;
export const ROOM_R = 0.5;
// BS 8206-2's two lines: under 2% a room needs electric light most of the
// day, over 5% it rarely does.
export const ADF_MIN = 2;
export const ADF_GOOD = 5;
// Reflectance of the back half of the room, for the limiting-depth rule.
export const BACK_R = 0.5;
export const DEPTH_LIMIT = 2 / (1 - BACK_R);
// How far out, and how finely, the building is searched for its own bulk.
export const SKY_REACH = 96;   // ft
export const SKY_STEP = 2;     // ft, at the wall
// The school day the sun is counted over, in minutes past midnight.
export const SUN_FROM = 8 * 60;
export const SUN_TO = 16 * 60;
export const SUN_STEP = 15;

const DEG = 180 / Math.PI;
const ONE_WALL = Math.cos(Math.PI / 6);
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// A plan-space outward normal as a true compass bearing. The plan's north is
// -Z and `north` is how far that sits east of true north (sky.js).
export const bearingOf = (nx, nz, north = 0) =>
  (((Math.atan2(nx, -nz) * DEG + north) % 360) + 360) % 360;
export const compassOf = (bearing) => COMPASS[Math.round(bearing / 45) % 8];

// The band of sky a point on a wall sees, in the vertical plane along its
// outward normal: `lo` degrees is the top of whatever stands opposite, `hi`
// is the underside of whatever hangs over. An open field is 0 to 90.
//
// The building is its own only obstruction here. A sample that lands in a room
// on the pane's own storey is a wing standing on the ground opposite, and it
// blocks from the horizon up to the roof of the highest storey stacked on it.
// A sample that is open at this storey and roofed by a higher one is an
// overhang, and counts only while it is continuous from the wall: a bridge
// sixty feet out is a band of sky lost, not everything above it.
export function skyBand(state, nav, floorIndex, x, z, nx, nz, height) {
  const count = state.floors.length;
  const y = floorBaseY(state, floorIndex) + height;
  let lo = 0, hi = 90;
  if (floorIndex === count - 1 && isPitched(state.roof && state.roof.style)) {
    hi = Math.atan2(floorBaseY(state, floorIndex) + WALL_H - y, EAVE) * DEG;
  }
  let hanging = true;
  // The stride widens with distance: an angle is as coarse at 12ft in 96 as
  // at 2ft in 16, and no wing is thinner than the widest stride.
  for (let d = SKY_STEP; d <= SKY_REACH; d += Math.max(SKY_STEP, d / 8)) {
    const px = x + nx * d, pz = z + nz * d;
    if (nav.roomIdAt(floorIndex, px, pz)) {
      hanging = false;
      let top = floorIndex;
      while (top + 1 < count && nav.roomIdAt(top + 1, px, pz)) top++;
      lo = Math.max(lo, Math.atan2(floorBaseY(state, top) + WALL_H - y, d) * DEG);
      continue;
    }
    if (!hanging) continue;
    let over = -1;
    for (let j = floorIndex + 1; j < count && over < 0; j++) {
      if (nav.roomIdAt(j, px, pz)) over = j;
    }
    if (over < 0) { hanging = false; continue; }
    hi = Math.min(hi, Math.atan2(floorBaseY(state, over) - y, d) * DEG);
  }
  return { lo, hi: Math.max(lo, hi) };
}

// Where the sun stands at each step of the school day, as vectors toward it
// in plan space, or null while it is down.
export function sunTrack(env) {
  const e = normalizeEnv(env);
  const out = [];
  for (let m = SUN_FROM; m < SUN_TO; m += SUN_STEP) {
    const sun = solarPosition({ ...e, minutes: m + SUN_STEP / 2 });
    out.push(sun.altitude > 0 ? sunVector(sun.altitude, sun.azimuth, e.north) : null);
  }
  return out;
}

// Does the sun at this step stand in the pane's band of sky? Its profile
// angle, the altitude seen in the plane of the pane's normal, is the one an
// overhang and a wing opposite are measured against.
const sunIn = (sun, pane) => {
  if (!sun) return false;
  // A sun behind the wall has a profile angle past 90, which no band holds,
  // so the one comparison is also the test for which side it is on.
  const profile = Math.atan2(sun.y, sun.x * pane.nx + sun.z * pane.nz) * DEG;
  return profile > pane.lo && profile < pane.hi;
};

// Everything a room's exterior panes say together.
function readSky(row, shape, track, north) {
  const panes = row.panes;
  delete row.panes;
  let perimeter = 0;
  for (const ring of shape.rings) {
    for (let i = 0; i < ring.pts.length; i++) {
      const [a, b] = segEnds(ring, i);
      perimeter += Math.hypot(b.x - a.x, b.z - a.z);
    }
  }
  const surfaces = 2 * row.area + perimeter * WALL_H;
  let skyArea = 0, sx = 0, sz = 0, head = 0, steps = 0;
  for (const p of panes) {
    skyArea += p.area * (p.hi - p.lo);
    sx += p.nx * p.area; sz += p.nz * p.area;
    head = Math.max(head, p.head);
  }
  for (const sun of track) if (panes.some((p) => sunIn(sun, p))) steps++;
  row.adf = surfaces > 0 ? (GLASS_T * skyArea) / (surfaces * (1 - ROOM_R * ROOM_R)) : 0;
  row.sky = row.glazed > 0 ? skyArea / row.glazed : 0;
  row.sunHours = (steps * SUN_STEP) / 60;
  row.facing = null;
  row.depth = 0; row.reach = 0; row.deep = false;
  const mag = Math.hypot(sx, sz);
  if (!panes.length || mag < 1e-9) return;
  const nx = sx / mag, nz = sz / mag;
  // Glass on two walls has no one facing, and the depth rule is written for
  // glass on one: a room lit from both sides is not judged by it.
  // Thirty degrees either way is one wall, bent or chorded; a corner room's
  // two walls are 45 off their sum and fall outside it.
  if (!panes.every((p) => p.nx * nx + p.nz * nz >= ONE_WALL)) return;
  row.facing = compassOf(bearingOf(nx, nz, north));
  let depth = 0, t0 = Infinity, t1 = -Infinity;
  for (const ring of shape.rings) {
    for (const pt of ring.pts) {
      for (const p of panes) depth = Math.max(depth, (p.x - pt.x) * nx + (p.z - pt.z) * nz);
      const t = pt.x * -nz + pt.z * nx;
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
  }
  const width = t1 - t0;
  if (!(width > 0) || !(head > 0)) return;
  row.depth = depth;
  row.reach = DEPTH_LIMIT / (1 / width + 1 / head);
  row.deep = depth > row.reach + 1e-9;
}

// ---------- reading the glass off a storey ----------

function addGlazing(rows, id, area, exterior, pane = null) {
  const row = rows.get(id);
  if (!row) return;
  if (exterior) {
    row.glazed += area; row.openings++;
    if (pane) row.panes.push(pane);
  } else { row.borrowed += area; }
}

// Every glazed thing on one storey, attributed to the room behind it. Both
// wall systems answer here — a lattice edge and a polygon segment are the same
// question, asked once, of the one kind of room there is.
export function daylightOnFloor(state, floorIndex, opts = {}) {
  const nav = opts.nav || buildNav(state);
  const fr = nav.perFloor && nav.perFloor[floorIndex];
  const floor = fr && fr.floor;
  const rows = new Map();
  if (!floor) return [];
  for (const room of fr.rooms) {
    rows.set(room.id, {
      id: room.id,
      floor: floorIndex,
      name: room.name || null,
      area: room.area,
      x: room.x, z: room.z,
      glazed: 0,      // ft² of exterior glass
      borrowed: 0,    // ft² of glass onto another room
      openings: 0,
      panes: [],
    });
  }
  const env = normalizeEnv(state.env);
  const track = sunTrack(env);

  // Which room is on each side of a boundary, as ids. `null` is the outside.
  const sides = (x, z, nx, nz) => [
    nav.roomIdAt(floorIndex, x + nx * PROBE, z + nz * PROBE),
    nav.roomIdAt(floorIndex, x - nx * PROBE, z - nz * PROBE),
  ];

  for (const shape of shapesOf(floor)) {
    const id = `r${floorIndex}:s${shape.id}`;
    for (const ring of shape.rings) {
      for (let i = 0; i < ring.pts.length; i++) {
        const [a, b] = segEnds(ring, i);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.01) continue;
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const [s0, s1] = sides(mid.x, mid.z, -uz, ux);
        // The far side is whichever of the two probes isn't this room.
        const other = s0 === id ? s1 : s0;
        const exterior = !other;
        // **Both sides of an interior pane are credited.** Since Phase 12 a
        // partition belongs to exactly one of the two rooms it divides, so
        // "whose glass is this?" has an owner and a neighbour rather than two
        // equal claimants — and borrowed light is borrowed in both directions
        // however the boundary happens to be written down.
        // An exterior pane also says where it is, which way is out and how
        // much sky that way holds. `t` is its place along the run, `sill` and
        // `head` its height off the floor.
        const out = s0 ? -1 : 1;
        const lit = (area, t = 0.5, sill = 0, head = WALL_H) => {
          let pane = null;
          if (exterior) {
            const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
            const nx = -uz * out, nz = ux * out;
            pane = {
              x, z, nx, nz, area, head,
              ...skyBand(state, nav, floorIndex, x, z, nx, nz, (sill + head) / 2),
            };
          }
          addGlazing(rows, id, area, exterior, pane);
          if (!exterior && other) addGlazing(rows, other, area, false);
        };
        if (ring.walls[i] === SEG_GLASS) {
          // A curtain wall is glazed for its whole length and height; a
          // doorway through one is a hole in the glass, so it comes off.
          const doors = ring.openings
            .filter((o) => o.seg === i && !isWindowOpening(o))
            .reduce((w, o) => w + (o.w || 0), 0);
          lit(Math.max(0, len - doors) * WALL_H);
        }
        for (const o of ring.openings) {
          if (o.seg !== i || !isWindowOpening(o)) continue;
          const spec = openingSpec(o);
          lit(spec.w * spec.h, Number.isFinite(o.t) ? o.t : 0.5, spec.sill, spec.head);
        }
      }
    }
    if (rows.has(id)) readSky(rows.get(id), shape, track, env.north);
  }

  return [...rows.values()];
}

// ---------- the analysis ----------

export function daylightAnalysis(state, opts = {}) {
  const nav = opts.nav || buildNav(state);
  const edition = editionOf(opts.edition, state);
  const min = edition.glazing;
  const occupancy = opts.occupancy || buildingOccupancy(state, { nav, edition });
  const loads = new Map(occupancy.rooms.map((r) => [r.id, r]));
  const rooms = [];
  const count = (state && state.floors ? state.floors.length : 0);
  for (let i = 0; i < count; i++) {
    for (const row of daylightOnFloor(state, i, { nav })) {
      const load = loads.get(row.id);
      const use = load ? load.use : 'unassigned';
      const wanted = NEEDS_LIGHT.has(use) && !(load && load.tiny);
      const ratio = row.area > 0 ? row.glazed / row.area : 0;
      rooms.push({
        ...row,
        use,
        useLabel: load ? load.useLabel : 'Unassigned',
        occ: load ? load.occ : 0,
        ratio,
        wanted,
        dark: wanted && ratio < min,
        // A room with no exterior wall at all is a different problem from a
        // room with a small window, and worth saying differently.
        windowless: wanted && row.glazed <= 0,
        bright: ratio >= GOOD_RATIO,
        // The code's line is the ratio, so a room is only called dim once it
        // has passed that: a room short of glass has one finding, not two.
        dim: wanted && ratio >= min && row.adf < ADF_MIN,
        deep: wanted && row.deep,
      });
    }
  }
  rooms.sort((a, b) => a.ratio - b.ratio);
  const graded = rooms.filter((r) => r.wanted);
  const glazed = rooms.reduce((n, r) => n + r.glazed, 0);
  const area = rooms.reduce((n, r) => n + r.area, 0);
  const factors = graded.map((r) => r.adf).sort((a, b) => a - b);
  const summary = {
    rooms: graded.length,
    dark: graded.filter((r) => r.dark).length,
    windowless: graded.filter((r) => r.windowless).length,
    bright: graded.filter((r) => r.bright).length,
    glazed,
    borrowed: rooms.reduce((n, r) => n + r.borrowed, 0),
    area,
    ratio: area > 0 ? glazed / area : 0,
    // The middle room's daylight factor: the building's own would be an
    // average of averages, and no room is lit by the building.
    adf: factors.length ? factors[Math.floor((factors.length - 1) / 2)] : 0,
    dim: graded.filter((r) => r.dim).length,
    deep: graded.filter((r) => r.deep).length,
    sunless: graded.filter((r) => r.glazed > 0 && r.sunHours <= 0).length,
    min,
    edition: edition.key,
    editionLabel: edition.label,
  };
  return {
    rooms, summary, edition: edition.key,
    findings: daylightFindings(graded, summary, edition),
  };
}

function daylightFindings(rooms, summary, edition) {
  const out = [];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const rule = `${Math.round(summary.min * 100)}%`;
  const cite = citeFor(edition, 'glazing');
  const name = (r) => r.name || `an unnamed room on ${floorLabel(r.floor)}`;
  if (!summary.rooms) {
    out.push({
      level: 'note', code: 'daylight-none', title: 'Nothing here needs daylight yet',
      detail: 'No classroom, office or assembly space has been named, so there ' +
        `is nothing to hold to the ${rule} glazing rule.`,
      cite,
    });
    return out;
  }
  const windowless = rooms.filter((r) => r.windowless);
  if (windowless.length) {
    out.push({
      level: 'warn', code: 'windowless',
      title: `${windowless.length} occupied room${windowless.length === 1 ? '' : 's'} with no exterior glass`,
      detail: `${windowless.slice(0, 4).map(name).join(', ')}` +
        `${windowless.length > 4 ? `, and ${windowless.length - 4} more` : ''} — ` +
        'no window or curtain wall onto the outside.',
      rooms: windowless.slice(0, 8),
      cite,
    });
  }
  const dark = rooms.filter((r) => r.dark && !r.windowless);
  if (dark.length) {
    out.push({
      level: 'warn', code: 'glazing-ratio',
      title: `${dark.length} room${dark.length === 1 ? '' : 's'} under the ${rule} glazing rule`,
      detail: `${name(dark[0])} is glazed to ${pct(dark[0].ratio)} of its floor ` +
        `area (${Math.round(dark[0].glazed)} ft² of glass over ${Math.round(dark[0].area)} ft²).`,
      rooms: dark.slice(0, 8),
      cite,
    });
  }
  // The two below are a designer's rules of thumb, not the code's, so they are
  // notes and they cite where they come from.
  const dim = rooms.filter((r) => r.dim).sort((a, b) => a.adf - b.adf);
  if (dim.length) {
    out.push({
      level: 'note', code: 'daylight-factor',
      title: `${dim.length} room${dim.length === 1 ? '' : 's'} with enough glass and ` +
        `an average daylight factor under ${ADF_MIN}%`,
      detail: `${name(dim[0])} averages ${dim[0].adf.toFixed(1)}%: its glass sees ` +
        `${Math.round(dim[0].sky)}° of sky out of 90, over ${Math.round(dim[0].area)} ft² ` +
        'of floor. Under an overcast sky, so the compass does not move it.',
      rooms: dim.slice(0, 8),
      cite: 'BS 8206-2 · average daylight factor',
    });
  }
  const deep = rooms.filter((r) => r.deep).sort((a, b) => b.depth / b.reach - a.depth / a.reach);
  if (deep.length) {
    out.push({
      level: 'note', code: 'deep-room',
      title: `${deep.length} room${deep.length === 1 ? '' : 's'} deeper than ` +
        `${deep.length === 1 ? 'its' : 'their'} one glazed wall lights`,
      detail: `${name(deep[0])} runs ${Math.round(deep[0].depth)} ft back from glass ` +
        `facing ${deep[0].facing}, and daylight carries about ${Math.round(deep[0].reach)} ft. ` +
        'A taller window head or glass on a second wall reaches further.',
      rooms: deep.slice(0, 8),
      cite: 'BS 8206-2 · limiting depth',
    });
  }
  if (!windowless.length && !dark.length) {
    out.push({
      level: 'ok', code: 'glazing-ratio', title: `Every occupied room meets the ${rule} glazing rule`,
      detail: `${summary.rooms} rooms measured, ${summary.bright} of them glazed ` +
        `past ${pct(GOOD_RATIO)}. Ratios are glass area over floor area — an ` +
        'approximation of daylight, not a simulation of it.',
      cite,
    });
  }
  return out;
}
