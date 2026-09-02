// spec.js — which VCT.
//
// The takeoff says *how much* vinyl tile. This says which one, where it goes,
// and what it is held to. That is the difference between a quantity and a
// specification, and it is the difference between a drawing set somebody can
// price and a drawing set somebody can build from.
//
// Three columns, and the third is the interesting one:
//
//   **what it is**    the product row out of the table it came from —
//                     finish.js's floor finishes and facade materials,
//                     site.js's surfaces and markings, roof.js's styles.
//                     Every one of these has been in the model since the phase
//                     that drew it; nothing here is new data.
//   **where**         the storeys it appears on and the rooms that use it,
//                     out of `cost.js`'s per-room attribution. Worst first, so
//                     the rooms named are the ones with the most of it.
//   **rated at**      the performance number this tool actually knows, and
//                     *only* that. A floor finish knows its absorption
//                     coefficient at 500 Hz because acoustics.js needs it. A
//                     door knows its clear width because egress.js measures
//                     it. A ramp knows its slope. Nothing here knows a fire
//                     rating, an R-value or an STC, and rather than leave the
//                     column blank and let a reader assume, each of those says
//                     so in the sheet's own closing note.
//
// The result prints *with the drawing set* rather than living in a panel,
// which is the phase's own instruction: a spec that is not on the sheets is a
// spec nobody on site has ever read.
//
// Pure module: no three.js, no DOM. Exercised by test/spec.test.mjs.

import { floorLabel, WALL_T_INT, WALL_T_EXT } from './grid.js';
import { WINDOW_W, WINDOW_H, WINDOW_SILL } from './shapes.js';
import { MULLION_BAY } from './openings.js';
import { MIN_EXIT_CLEAR, MIN_EGRESS_STAIR_W } from './egress.js';
import {
  RISER_TARGET, TREAD, RAMP_SLOPE, ELEV_DOOR_W,
  stairsOf, stairMetrics, runMetrics, stairWidth, rampSlope, elevatorSize,
  isRun, isElevator,
} from './stairs.js';
import { normalizeRoof, ensureRoof, roofStyleEntry, PARAPET_H } from './roof.js';
import { ROOF_MEMBRANE, ROOF_SHINGLE } from './finish.js';
import { assemblyEntry, assemblyMaterial, splitKey, systemEntry } from './rates.js';
import { quantities } from './cost.js';
import { csvRows } from './csv.js';

const round = (n, places = 1) => {
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

const inches = (ft) => `${Math.round(ft * 12)} in`;

// ---------- what it is ----------

// The product description, out of whichever table the variant came from. Each
// of these rows has carried its own colour and texture since the phase that
// drew it; this is the first reader that asks them to describe themselves.
function describe(key, state) {
  const a = assemblyEntry(key);
  if (!a) return '';
  const mat = assemblyMaterial(key);
  const { family } = splitKey(key);
  switch (family) {
    case 'slab':
      return 'Structural floor slab, area as drawn.';
    case 'facade':
      return mat ? `${mat.label}, ${round(WALL_T_EXT, 2)} ft exterior wall assembly.` : '';
    case 'glazing':
      return `Glazed wall, mullions at ${MULLION_BAY} ft on centre.`;
    case 'window':
      return `Punched window, ${WINDOW_W}×${WINDOW_H} ft nominal, ${WINDOW_SILL} ft sill.`;
    case 'roof': {
      const roof = normalizeRoof(state.roof || ensureRoof(state));
      const entry = roofStyleEntry(roof.style);
      const cover = entry.pitched ? ROOF_SHINGLE : ROOF_MEMBRANE;
      return entry.pitched
        ? `${entry.label} roof, ${cover.grain} covering at ${roof.pitch}:12.`
        : `${entry.label} roof, ${cover.grain} membrane over deck.`;
    }
    case 'wall-int':
      return `Painted partition, ${round(WALL_T_INT, 2)} ft, room to room.`;
    case 'wall-glass':
      return 'Glazed interior partition, borrowed light.';
    case 'wall-rail':
      return 'Guardrail at a floor opening or stair well.';
    case 'paint':
      return 'Wall paint, interior faces. Both sides of a partition, one side of an exterior wall.';
    case 'finish':
      return mat ? `${mat.label}, ${mat.tile} ft module.` : '';
    case 'door':
      return {
        single: 'Single-leaf door in a partition or an exterior wall.',
        double: 'Pair of doors — the corridor and egress opening.',
        cased: 'Cased opening, no leaf.',
      }[a.variant] || '';
    case 'stair':
      return `Stair, ${inches(RISER_TARGET)} riser and ${inches(TREAD)} tread nominal.`;
    case 'ramp':
      return 'Ramp, sloped floor between two levels.';
    case 'elevator':
      return `Passenger lift, ${round(ELEV_DOOR_W, 1)} ft clear car door.`;
    case 'furniture':
      return `Loose furniture and equipment — ${a.variant}.`;
    case 'paving':
      return mat ? `${mat.label}, ${mat.step} underfoot.` : '';
    case 'marking':
      return mat ? `${mat.label}, painted on ${mat.surf}.` : '';
    default:
      return '';
  }
}

// ---------- what it is rated at ----------
//
// Only what the model actually measures. Every one of these numbers is already
// a number some other reader checks against a limit, which is the test for
// whether it belongs in this column at all.
function rating(key, state) {
  const a = assemblyEntry(key);
  if (!a) return '';
  const mat = assemblyMaterial(key);
  const { family } = splitKey(key);
  const metrics = stairMetrics(state);
  switch (family) {
    case 'finish':
      return mat ? `α ≈ ${mat.absorb.toFixed(2)} at 500 Hz — the figure acoustics.js sums` : '';
    case 'paving':
      return mat ? `α ≈ ${mat.absorb.toFixed(2)} · ${mat.step} footfall` : '';
    case 'facade':
      return `${round(WALL_T_EXT, 2)} ft assembly — no fire, thermal or acoustic rating known`;
    case 'wall-int':
      return `${round(WALL_T_INT, 2)} ft — no fire or STC rating known`;
    case 'glazing':
    case 'wall-glass':
      return 'daylight only — rooms are held to 8% of floor area in glass';
    case 'window':
      return `${round(WINDOW_W * WINDOW_H)} ft² of glass each`;
    case 'door': {
      if (a.variant === 'cased') return 'no leaf, no closer, no rating';
      const widest = a.variant === 'double' ? 'pair' : 'single';
      return `clear width measured per leaf; egress minimum ${inches(MIN_EXIT_CLEAR)} (${widest})`;
    }
    case 'stair': {
      const runs = stairsOf(state).filter((l) => isRun(l) && l.type === 'stair');
      if (!runs.length) return '';
      const w = Math.min(...runs.map((l) => stairWidth(l)));
      const steps = Math.max(...runs.map((l) => runMetrics(l, metrics).steps));
      return `narrowest ${round(w, 1)} ft, tallest ${steps} risers; ` +
        `${inches(MIN_EGRESS_STAIR_W)} minimum where it serves 50 or more`;
    }
    case 'ramp': {
      const ramps = stairsOf(state).filter((l) => isRun(l) && l.type === 'ramp');
      if (!ramps.length) return '';
      const steepest = Math.min(...ramps.map((l) => rampSlope(l)));
      return `steepest 1:${round(steepest, 1)} — 1:${RAMP_SLOPE} is the accessible maximum`;
    }
    case 'elevator': {
      const cars = stairsOf(state).filter((l) => isElevator(l));
      if (!cars.length) return '';
      const { w, d } = elevatorSize(cars[0]);
      return `car ${round(w, 1)}×${round(d, 1)} ft, ${round(ELEV_DOOR_W, 1)} ft door`;
    }
    case 'roof': {
      const roof = normalizeRoof(state.roof || ensureRoof(state));
      const entry = roofStyleEntry(roof.style);
      if (entry.pitched) return `${roof.pitch}:12 pitch — sloped area, not footprint`;
      return roof.style === 'parapet'
        ? `flat, ${PARAPET_H} ft parapet — no fall or insulation value known`
        : 'flat, no parapet — no fall or insulation value known';
    }
    case 'slab':
      return 'area as drawn — no thickness or structural capacity known';
    case 'paint':
      return 'no sheen, VOC or coverage rate known';
    case 'wall-rail':
      return 'height and infill are the renderer\'s — no load rating known';
    default:
      return '';
  }
}

// ---------- where it is used ----------

const MAX_NAMED = 4;

function whereUsed(key, q) {
  const storeys = [];
  const rooms = [];
  for (const f of q.floors) {
    if (!(f.lines.get(key) > 0)) continue;
    storeys.push(floorLabel(f.floor));
    for (const r of f.rooms) {
      const qty = r.lines.get(key) || 0;
      if (qty > 0 && r.name) rooms.push({ name: r.name, qty });
    }
  }
  const shared = q.shared.get(key) > 0;
  rooms.sort((a, b) => b.qty - a.qty);
  const named = rooms.slice(0, MAX_NAMED).map((r) => r.name);
  const more = rooms.length - named.length;
  // Whether *any* room owns some of it, named or not — so a line whose rooms
  // are all unnamed says that, rather than claiming it is in no room.
  const anyRoom = q.floors.some((f) => f.rooms.some((r) => r.lines.get(key) > 0));
  const where = storeys.length
    ? storeys.join(', ') + (shared ? ' + building-wide' : '')
    : 'Building-wide';
  return {
    where,
    storeys,
    shared,
    rooms: named,
    moreRooms: more > 0 ? more : 0,
    // What the sheet prints under the room column: the four biggest users and
    // a count of the rest, because a spec line that lists sixty rooms is a
    // spec line nobody reads.
    roomsLabel: named.length
      ? named.join(', ') + (more > 0 ? ` +${more} more` : '')
      : (anyRoom ? 'unnamed rooms' : 'not in a room'),
  };
}

// ---------- the sheet ----------

// What this tool does not know, said once, at the bottom, in the same voice
// every other check in the codebase uses. Leaving the rating column blank and
// hoping is how a spec sheet becomes a liability.
export const SPEC_DISCLAIMER = [
  'Every rating on this sheet is a number this tool measures from the model.',
  'It knows nothing about fire-resistance ratings, thermal performance, sound ' +
  'transmission class, structural capacity, slip resistance or product ' +
  'approvals, and no line here should be read as a claim about any of them.',
  'Materials are named from the design\'s own finish and facade tables; ' +
  'manufacturer, series and colour are yours to fill in.',
];

export function specSheet(state, opts = {}) {
  const q = opts.quantities || quantities(state, opts);
  const lines = [];
  for (const [key, qty] of q.all) {
    const a = assemblyEntry(key);
    if (!a || !(qty > 0)) continue;
    const used = whereUsed(key, q);
    lines.push({
      key,
      label: a.label,
      system: a.system,
      systemLabel: systemEntry(a.system).label,
      unit: a.unit,
      qty,
      what: describe(key, state),
      rated: rating(key, state),
      ...used,
    });
  }
  // Grouped by system in the fixed order the systems table declares, and
  // biggest first inside each — the order a spec book is bound in, near
  // enough, and the order the cost panel already prints.
  const order = new Map(['substructure', 'shell', 'interiors', 'vertical', 'furnishings', 'site']
    .map((k, i) => [k, i]));
  lines.sort((a, b) =>
    (order.get(a.system) ?? 99) - (order.get(b.system) ?? 99) ||
    b.qty - a.qty ||
    a.key.localeCompare(b.key));
  return {
    lines,
    disclaimer: SPEC_DISCLAIMER,
    summary: {
      assemblies: lines.length,
      // How many lines carry a real measured rating rather than an admission.
      rated: lines.filter((l) => l.rated && !/no .* known/.test(l.rated)).length,
      systems: [...new Set(lines.map((l) => l.system))].length,
    },
  };
}

// ---------- the spreadsheet ----------


export function specCSV(spec) {
  const rows = [['Specification', '', '', '', '', '', '']];
  rows.push(['System', 'Assembly', 'What it is', 'Where', 'Rooms', 'Quantity', 'Unit', 'Rated at']);
  for (const l of spec.lines) {
    rows.push([l.systemLabel, l.label, l.what, l.where, l.roomsLabel,
      round(l.qty), l.unit, l.rated]);
  }
  rows.push([]);
  for (const line of spec.disclaimer) rows.push(['Note', line, '', '', '', '', '', '']);
  return csvRows(rows);
}
