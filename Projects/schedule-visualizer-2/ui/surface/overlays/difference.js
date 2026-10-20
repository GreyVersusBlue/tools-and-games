// The difference map, laid over a floor plan (spec 9.2; DESIGN 5.4;
// ARCHITECTURE 6.6 "The difference map"). The scenario lab's map shows, on
// every corridor and stairs cell, how its load changes when the open
// scenario is applied: busier in --problem tints, quieter in --accent tints,
// in five strengths by the size of the change against the largest change on
// the map. A cell whose load does not change is not painted, and neither is
// a cell in an exclusion zone. No lanes are drawn, and every tint is inset
// from its cell's edges so the walls between corridor and room stay in view.
// The numbers are engine/scenario.js's loadDifference; nothing here counts
// a load.
//
// The first half of this file has no canvas in it and runs in Node:
//
//   DIFFERENCE_STRENGTHS   5
//   DIFFERENCE_ALPHA       the five opacities a tint is laid over its cell
//                          at, weakest first. test/ui/difference.test.mjs
//                          holds, in both themes, over the corridor and over
//                          the stairs colour (a landing is painted too): the
//                          weakest at 1.2:1 or more, each strength 1.25 times
//                          the one under it or more, the strongest at 3:1 or
//                          more. Measured on 2026-10-19, not held: the weakest
//                          1.24 to 1.37, each step 1.26 or more, the strongest
//                          3.78 or more (over the corridor alone, 4.43)
//   DIFFERENCE_TOP         10, the rows of the text alternative
//   strengthOf(delta, largest) -> 0 to 5
//     0 for no change (or nothing changing anywhere), else the fifth of the
//     largest change |delta| reaches, rounded up: the relative bands of the
//     load colours (engine/load.js bandOf) applied to the size of a change
//   tintOf(delta, strength, theme) -> '#rrggbb'
//     the colour a cell reads as once painted over the corridor: the
//     problem colour for busier, the accent for quieter, at the strength's
//     opacity. Null for no change.
//   differenceOf(before, after, { dayTypeId, transition, measure }?)
//     before and after are two pipeline results' `loads` lists (the real
//     schedule's and the scenario's), one entry an own day type. For one day
//     type, loadDifference for it; for every day type (dayTypeId null), each
//     cell and connection takes the day type whose change there is largest,
//     the earlier day type on a tie. Null when nothing can be compared.
//     largest is taken from the cells alone, the ones the map paints: a stairs
//     connection is never painted, so its change is in the table and the
//     card's figures but does not set the strengths or the key's figure.
//       { dayTypeId, transition, measure, unit, dayTypeIds,
//         cells, connections            Int32Array: after less before
//         before: { cells, connections } Int32Array: before's load as compared
//         after:  { cells, connections } Int32Array: after's
//         dayOfCell, dayOfConnection     index into dayTypeIds: a Uint8Array, or
//                                        a Uint16Array or Uint32Array past 256 day types
//         largest                        the largest |change| of a cell outside the zones
//         excluded, excludedConnections }
//   differenceWords(delta) -> '14 busier' | '9 quieter' | 'no change'
//   rankPlaces(difference, places, limit?) -> { rows, changed }
//     the places whose load changes, largest change first (then the order
//     of the places), at most `limit` (DIFFERENCE_TOP) rows; a place's change
//     is its member cell (or connection) whose change is largest, the first
//     of them on a tie, cells in a zone left out. changed: how many places
//     change in all.
//       row: { place, placeId, name, parts, floorIds, node, link, before,
//              after, delta, dayTypeId }
//   apartGroups(before, after) -> { onlyBefore, onlyAfter }
//     two lists of group ids (who crosses a cell before and after, from
//     engine/load.js contributors), as the ids in one and not the other,
//     each in its list's order
//
// The second half draws:
//
//   differenceOverlay(read) -> (g, view, floor, theme) => {}   for map.overlays
//     read()   null, or { difference, graph }: the graph the difference's
//              node numbers are of (buildGraph of the project on the map).
//              A graph of another size than the difference is not painted.

import { mix } from '../../colour.js';
import { loadDifference } from '../../../engine/scenario.js';

export const DIFFERENCE_STRENGTHS = 5;
export const DIFFERENCE_ALPHA = Object.freeze([0.16, 0.32, 0.48, 0.66, 0.85]);
export const DIFFERENCE_TOP = 10;

export function strengthOf(delta, largest) {
  const size = Math.abs(delta);
  if (!(size > 0) || !(largest > 0)) return 0;
  return Math.min(DIFFERENCE_STRENGTHS, Math.max(1, Math.ceil((DIFFERENCE_STRENGTHS * size) / largest)));
}

export function tintOf(delta, strength, theme) {
  if (!delta || !(strength >= 1)) return null;
  const colour = delta > 0 ? theme.problem : theme.accent;
  return mix(colour, theme.corridor, DIFFERENCE_ALPHA[Math.min(strength, DIFFERENCE_STRENGTHS) - 1]);
}

export function differenceWords(delta) {
  if (!delta) return 'no change';
  return Math.abs(delta) + (delta > 0 ? ' busier' : ' quieter');
}

// The load a side is compared by, as loadDifference picks it: one
// transition's, or over the whole day each cell's busiest or its total.
function picked(load, part, transition, measure) {
  if (transition === null) return measure === 'total' ? load[part].total : load[part].busiest;
  return load[part].byTransition[transition] || new Int32Array(load[part].busiest.length);
}

export function differenceOf(before, after, options) {
  const opts = options || {};
  const dayTypeId = opts.dayTypeId === undefined ? null : opts.dayTypeId;
  const transition = Number.isInteger(opts.transition) ? opts.transition : null;
  const measure = opts.measure === 'total' ? 'total' : 'busiest';
  const was = new Map((Array.isArray(before) ? before : []).filter(Boolean).map((load) => [load.dayTypeId, load]));
  const pairs = (Array.isArray(after) ? after : []).filter((load) => load && was.has(load.dayTypeId) && (dayTypeId === null || load.dayTypeId === dayTypeId));
  if (pairs.length === 0) return null;
  const first = pairs[0];
  const nodes = first.cells.busiest.length;
  // wide enough for every day type's index (SV2-72d: a Uint8Array wrapped past 256)
  const DayIndex = pairs.length <= 0x100 ? Uint8Array : pairs.length <= 0x10000 ? Uint16Array : Uint32Array;
  const links = first.connections.busiest.length;
  const out = {
    dayTypeId,
    transition,
    measure,
    unit: first.unit,
    dayTypeIds: pairs.map((load) => load.dayTypeId),
    cells: new Int32Array(nodes),
    connections: new Int32Array(links),
    before: { cells: new Int32Array(nodes), connections: new Int32Array(links) },
    after: { cells: new Int32Array(nodes), connections: new Int32Array(links) },
    dayOfCell: new DayIndex(nodes),
    dayOfConnection: new DayIndex(links),
    largest: 0,
    excluded: first.excluded,
    excludedConnections: first.excludedConnections,
  };
  pairs.forEach((load, day) => {
    const earlier = was.get(load.dayTypeId);
    const found = loadDifference(earlier, load, { transition, measure });
    const take = (part, deltas, days) => {
      const a = picked(earlier, part, transition, measure);
      const b = picked(load, part, transition, measure);
      for (let i = 0; i < deltas.length; i += 1) {
        if (day > 0 && Math.abs(deltas[i]) <= Math.abs(out[part][i])) continue;
        out[part][i] = deltas[i];
        out.before[part][i] = a[i];
        out.after[part][i] = b[i];
        days[i] = day;
      }
    };
    take('cells', found.cells, out.dayOfCell);
    take('connections', found.connections, out.dayOfConnection);
  });
  // the strengths are of what is painted: cells outside the zones
  for (let i = 0; i < nodes; i += 1) {
    if (out.excluded && out.excluded[i]) continue;
    if (Math.abs(out.cells[i]) > out.largest) out.largest = Math.abs(out.cells[i]);
  }
  return out;
}

export function rankPlaces(difference, places, limit) {
  const most = Number.isInteger(limit) && limit >= 0 ? limit : DIFFERENCE_TOP;
  if (!difference || !places || !Array.isArray(places.places)) return { rows: [], changed: 0 };
  const rows = [];
  places.places.forEach((place, order) => {
    const isLink = place.kind === 'connection';
    const members = isLink ? [place.link] : place.nodes;
    const part = isLink ? 'connections' : 'cells';
    const shut = isLink ? difference.excludedConnections : difference.excluded;
    const days = isLink ? difference.dayOfConnection : difference.dayOfCell;
    let best = -1;
    for (const member of members) {
      if (!(member >= 0) || member >= difference[part].length || (shut && shut[member])) continue;
      if (difference[part][member] === 0) continue;
      if (best === -1 || Math.abs(difference[part][member]) > Math.abs(difference[part][best])) best = member;
    }
    if (best === -1) return;
    rows.push({
      place,
      placeId: place.id,
      name: place.name,
      parts: place.parts && place.parts.length > 0 ? place.parts : [{ text: place.name }],
      floorIds: place.floorIds || [place.floorId],
      node: isLink ? null : best,
      link: isLink ? best : null,
      before: difference.before[part][best],
      after: difference.after[part][best],
      delta: difference[part][best],
      dayTypeId: difference.dayTypeIds[days[best]],
      order,
    });
  });
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.order - b.order);
  return { rows: rows.slice(0, most).map(({ order, ...row }) => row), changed: rows.length };
}

export function apartGroups(before, after) {
  const was = new Set(before);
  const now = new Set(after);
  return { onlyBefore: before.filter((id) => !now.has(id)), onlyAfter: after.filter((id) => !was.has(id)) };
}

// ---- drawing

export function differenceOverlay(read) {
  return (g, view, floor, theme) => {
    const given = read();
    if (!given || !given.difference || !given.graph) return;
    const { difference, graph } = given;
    if (graph.count !== difference.cells.length) return;
    const f = graph.floorIndex.get(floor.id);
    if (f === undefined) return;
    const at = graph.floors[f];
    const size = view.size;
    // the tint stands inside its cell, so the walls and the corridor's
    // hairlines between cells still show
    const inset = Math.max(1, Math.round(size * 0.08));
    const fill = size - inset * 2;
    if (fill <= 0) return;
    // only what is in the window
    const left = Math.max(0, Math.floor(-view.x / size));
    const right = Math.min(floor.width - 1, Math.floor((view.width - view.x) / size));
    const top = Math.max(0, Math.floor(-view.y / size));
    const bottom = Math.min(floor.height - 1, Math.floor((view.height - view.y) / size));
    g.save();
    for (let node = at.offset; node < at.offset + at.count; node += 1) {
      const delta = difference.cells[node];
      if (delta === 0 || (difference.excluded && difference.excluded[node])) continue;
      const cell = graph.nodeCell[node];
      const x = cell % floor.width;
      const y = Math.floor(cell / floor.width);
      if (x < left || x > right || y < top || y > bottom) continue;
      const strength = strengthOf(delta, difference.largest);
      g.globalAlpha = DIFFERENCE_ALPHA[strength - 1];
      g.fillStyle = delta > 0 ? theme.problem : theme.accent;
      g.fillRect(Math.round(view.x + x * size) + inset, Math.round(view.y + y * size) + inset, fill, fill);
    }
    g.restore();
  };
}
