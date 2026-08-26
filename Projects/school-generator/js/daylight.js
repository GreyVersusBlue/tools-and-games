// daylight.js — how much glass a room has, against how much floor it has.
//
// The honest half of a daylight study. A real one traces the sky through a
// window and onto a desk; this one measures the glazed area in a room's
// exterior walls and divides. That is the check a code actually writes down
// (IBC 1205.2: net glazed area not less than 8% of the floor area of the room
// served), it is computable from the model exactly, and it is the number an
// architect sketching a wing wants before any of the rest.
//
// What it deliberately does not claim: nothing here knows about orientation,
// overhangs, the roof Phase 5 put on, or the sun Phase 3 places — the sky
// model could answer all four and a room's *illuminance* is still a
// simulation rather than a reading. So the panel says "glazing ratio", not
// "daylight", and the phase's promise of an honest approximation is kept by
// naming the approximation.
//
// **Only exterior glass counts.** A window into a corridor lights the room
// from the corridor's borrowed light; a glazed office front is a lovely thing
// and not a source of daylight. Both are measured, both are reported, and only
// the first goes into the ratio.
//
// Pure module: no three.js, no DOM. Exercised by test/daylight.test.mjs.

import { WALL_H, floorLabel } from './grid.js';
import {
  shapesOf, segEnds, openingSpec, isWindowOpening, SEG_GLASS,
} from './shapes.js';
import { buildNav, PROBE } from './navgraph.js';
import { buildingOccupancy } from './occupancy.js';

// IBC 1205.2 — the floor of the thing, for a room people occupy.
export const MIN_RATIO = 0.08;
// What a daylit classroom is usually drawn at. Above the code minimum, below
// a curtain wall; a room over this is not short of light.
export const GOOD_RATIO = 0.15;

// The uses this check applies to. A corridor, a store and a restroom are
// allowed to be windowless, and flagging them buries the finding that matters.
export const NEEDS_LIGHT = new Set([
  'classroom', 'library', 'lab', 'assembly-seats', 'assembly-tables',
  'office', 'gym', 'stage', 'unassigned',
]);

// ---------- reading the glass off a storey ----------

function addGlazing(rows, id, area, exterior) {
  const row = rows.get(id);
  if (!row) return;
  if (exterior) { row.glazed += area; row.openings++; }
  else { row.borrowed += area; }
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
    });
  }

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
        const lit = (area) => {
          addGlazing(rows, id, area, exterior);
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
          lit(spec.w * spec.h);
        }
      }
    }
  }

  return [...rows.values()];
}

// ---------- the analysis ----------

export function daylightAnalysis(state, opts = {}) {
  const nav = opts.nav || buildNav(state);
  const occupancy = opts.occupancy || buildingOccupancy(state, { nav });
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
        dark: wanted && ratio < MIN_RATIO,
        // A room with no exterior wall at all is a different problem from a
        // room with a small window, and worth saying differently.
        windowless: wanted && row.glazed <= 0,
        bright: ratio >= GOOD_RATIO,
      });
    }
  }
  rooms.sort((a, b) => a.ratio - b.ratio);
  const graded = rooms.filter((r) => r.wanted);
  const glazed = rooms.reduce((n, r) => n + r.glazed, 0);
  const area = rooms.reduce((n, r) => n + r.area, 0);
  const summary = {
    rooms: graded.length,
    dark: graded.filter((r) => r.dark).length,
    windowless: graded.filter((r) => r.windowless).length,
    bright: graded.filter((r) => r.bright).length,
    glazed,
    borrowed: rooms.reduce((n, r) => n + r.borrowed, 0),
    area,
    ratio: area > 0 ? glazed / area : 0,
    min: MIN_RATIO,
  };
  return { rooms, summary, findings: daylightFindings(graded, summary) };
}

function daylightFindings(rooms, summary) {
  const out = [];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const name = (r) => r.name || `an unnamed room on ${floorLabel(r.floor)}`;
  if (!summary.rooms) {
    out.push({
      level: 'note', code: 'daylight-none', title: 'Nothing here needs daylight yet',
      detail: 'No classroom, office or assembly space has been named, so there ' +
        'is nothing to hold to the 8% glazing rule.',
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
    });
  }
  const dark = rooms.filter((r) => r.dark && !r.windowless);
  if (dark.length) {
    out.push({
      level: 'warn', code: 'glazing-ratio',
      title: `${dark.length} room${dark.length === 1 ? '' : 's'} under the 8% glazing rule`,
      detail: `${name(dark[0])} is glazed to ${pct(dark[0].ratio)} of its floor ` +
        `area (${Math.round(dark[0].glazed)} ft² of glass over ${Math.round(dark[0].area)} ft²).`,
      rooms: dark.slice(0, 8),
    });
  }
  if (!windowless.length && !dark.length) {
    out.push({
      level: 'ok', code: 'glazing-ratio', title: 'Every occupied room meets the 8% glazing rule',
      detail: `${summary.rooms} rooms measured, ${summary.bright} of them glazed ` +
        `past ${pct(GOOD_RATIO)}. Ratios are glass area over floor area — an ` +
        'approximation of daylight, not a simulation of it.',
    });
  }
  return out;
}
