// Load: the one rule for how busy a corridor cell or a stairs connection is.
//
// For one day type, in each transition (period t into t + 1), every group
// whose route was found adds its head count (or the school default) to each
// corridor or stairs cell on the route and to each connection it uses, once.
// A group that stays in the same room, or has no route, adds nothing.
//
//   busiest   for each cell, the highest load in any one transition
//   total     for each cell, the sum over the day's transitions
//
// The unit is students when any group in the project has a head count;
// otherwise it is groups, and each group counts 1.
//
// Cells inside an exclusion zone are counted like any other and flagged
// `excluded`: the colour scale and the hotspot table leave them out. A
// connection is excluded when either of its ends is in a zone.
//
//   loads(project, routes, dayTypeId, graph?)
//
// `routes` is what routesForSchedule() gave; `graph` is buildGraph(project)
// or routingGraph(project) when the caller has one. A day type that is the
// same as A Day is answered from A Day. Null when the day type or its routes
// are not there. The result, with every array indexed by graph node (cells)
// or by index into graph.links (connections):
//
//   { dayTypeId, unit: 'students' | 'groups', transitions,
//     cells:       { busiest, total, peak, byTransition: [Int32Array] },
//     connections: { busiest, total, peak, byTransition: [Int32Array] },
//       peak is the first transition in which the busiest load is reached, −1 where nothing crosses
//     excluded,            Uint8Array over nodes: 1 inside a zone
//     excludedConnections, Uint8Array over links
//     zones,               how many exclusion zones the building has
//     max: { busiest, total } }   the highest of each over what is not excluded, cells and connections together
//
//   contributors(project, routes, dayTypeId, where, graph?)
//     the groups that cross `where` ({ nodes, links }, lists or Sets, either
//     may be left out), busiest first:
//     [{ groupId, count, times, transitions }] with count the load one
//     crossing adds, times how many transitions the group crosses in (once a
//     transition, however many of the cells it walks) and transitions which.
//     options.period keeps one transition only.
//
//   bandOf(load, scale, max) and bandEdges(scale, max)
//     the five colour bands, quiet to busy. `scale` is settings.colourScale.
//     relative: the bands are fifths of `max`, the busiest load on screen.
//     absolute: scale.bands are the loads at which bands 2 to 5 begin.
//     bandOf gives 0 for no load, else 1 to 5. bandEdges gives the five
//     bands as [{ band, from, to }] in whole loads for the legend; `to` is
//     null where a band has no upper end, and a band no whole load can fall
//     in has from > to.

import { RANGES, inRange, defaultSettings } from './schema.js';
import { buildGraph } from './graph.js';
import { effectiveDayType } from './day-types.js';

export const LOAD_BANDS = 5;

function hasHeadCount(group) {
  return Number.isInteger(group.headCount) && inRange(group.headCount, RANGES.headCount);
}

// The unit loads are in, and what one crossing by each group adds.
function counting(project) {
  const students = project.groups.some(hasHeadCount);
  const fallback = project.settings && Number.isInteger(project.settings.defaultHeadCount) && project.settings.defaultHeadCount >= 1
    ? project.settings.defaultHeadCount : defaultSettings().defaultHeadCount;
  const countOf = new Map();
  for (const group of project.groups) countOf.set(group.id, students ? (hasHeadCount(group) ? group.headCount : fallback) : 1);
  return { unit: students ? 'students' : 'groups', countOf };
}

function dayOf(project, routes, dayTypeId) {
  const dayType = effectiveDayType(project, dayTypeId);
  if (!dayType || !routes || !Array.isArray(routes.days)) return null;
  const day = routes.days.find((candidate) => candidate.dayTypeId === dayType.id);
  return day ? { dayType, day } : null;
}

// Calls back with each node and each link a found route crosses. A cell or a
// connection met twice on one route still counts once.
function eachCrossed(graph, linkOfId, found, onNode, onLink) {
  if (!found || found.ok !== true || found.same === true) return;
  const seen = new Set();
  for (const place of found.cells) {
    const f = graph.floorIndex.get(place.floorId);
    if (f === undefined || !(place.cell >= 0 && place.cell < graph.floors[f].nodeOfCell.length)) continue;
    const node = graph.floors[f].nodeOfCell[place.cell];
    if (node === -1 || seen.has(node)) continue;
    seen.add(node);
    onNode(node);
  }
  const links = new Set();
  for (const id of found.connections || []) {
    const link = linkOfId.get(id);
    if (link === undefined || links.has(link)) continue;
    links.add(link);
    onLink(link);
  }
}

function linkIndex(graph) {
  return new Map(graph.links.map((link, index) => [link.id, index]));
}

// Which nodes lie inside an exclusion zone.
function zoned(project, graph) {
  const excluded = new Uint8Array(graph.count);
  const zones = project.building && Array.isArray(project.building.zones) ? project.building.zones : [];
  for (const zone of zones) {
    const f = graph.floorIndex.get(zone.floorId);
    if (f === undefined) continue;
    const floor = graph.floors[f];
    for (let y = Math.max(0, zone.y); y < Math.min(floor.height, zone.y + zone.h); y += 1) {
      for (let x = Math.max(0, zone.x); x < Math.min(floor.width, zone.x + zone.w); x += 1) {
        const node = floor.nodeOfCell[y * floor.width + x];
        if (node !== -1) excluded[node] = 1;
      }
    }
  }
  return { excluded, zones: zones.length };
}

function summarise(byTransition, size) {
  const busiest = new Int32Array(size);
  const total = new Int32Array(size);
  const peak = new Int16Array(size).fill(-1);
  byTransition.forEach((counts, t) => {
    for (let i = 0; i < size; i += 1) {
      const count = counts[i];
      if (count === 0) continue;
      total[i] += count;
      if (count > busiest[i]) {
        busiest[i] = count;
        peak[i] = t;
      }
    }
  });
  return { busiest, total, peak, byTransition };
}

// How busy is this cell?
export function loads(project, routes, dayTypeId, graph) {
  const found = dayOf(project, routes, dayTypeId);
  if (!found) return null;
  const base = graph || buildGraph(project);
  const linkOfId = linkIndex(base);
  const { unit, countOf } = counting(project);
  const transitions = Math.max(0, project.settings.periods - 1);

  const cellCounts = [];
  const linkCounts = [];
  for (let t = 0; t < transitions; t += 1) {
    const cells = new Int32Array(base.count);
    const links = new Int32Array(base.links.length);
    for (const entry of found.day.groups) {
      const count = countOf.get(entry.groupId);
      if (count === undefined) continue;
      eachCrossed(base, linkOfId, entry.routes[t], (node) => { cells[node] += count; }, (link) => { links[link] += count; });
    }
    cellCounts.push(cells);
    linkCounts.push(links);
  }

  const { excluded, zones } = zoned(project, base);
  const excludedConnections = new Uint8Array(base.links.length);
  base.links.forEach((link, index) => {
    if (excluded[link.a] || excluded[link.b]) excludedConnections[index] = 1;
  });
  const cells = summarise(cellCounts, base.count);
  const connections = summarise(linkCounts, base.links.length);
  const max = { busiest: 0, total: 0 };
  for (let node = 0; node < base.count; node += 1) {
    if (excluded[node]) continue;
    if (cells.busiest[node] > max.busiest) max.busiest = cells.busiest[node];
    if (cells.total[node] > max.total) max.total = cells.total[node];
  }
  for (let index = 0; index < base.links.length; index += 1) {
    if (excludedConnections[index]) continue;
    if (connections.busiest[index] > max.busiest) max.busiest = connections.busiest[index];
    if (connections.total[index] > max.total) max.total = connections.total[index];
  }
  return { dayTypeId: found.dayType.id, unit, transitions, cells, connections, excluded, excludedConnections, zones, max };
}

// Who crosses these cells and connections, and how many times.
export function contributors(project, routes, dayTypeId, where, graph, options) {
  const found = dayOf(project, routes, dayTypeId);
  if (!found) return [];
  const base = graph || buildGraph(project);
  const linkOfId = linkIndex(base);
  const { countOf } = counting(project);
  const nodes = new Set(where && where.nodes ? where.nodes : []);
  const links = new Set(where && where.links ? where.links : []);
  const only = options && Number.isInteger(options.period) ? options.period : null;
  const transitions = Math.max(0, project.settings.periods - 1);
  const order = new Map(project.groups.map((group, index) => [group.id, index]));

  const list = [];
  for (const entry of found.day.groups) {
    const count = countOf.get(entry.groupId);
    if (count === undefined) continue;
    const crossedIn = [];
    for (let t = 0; t < transitions; t += 1) {
      if (only !== null && t !== only) continue;
      let crossed = false;
      eachCrossed(base, linkOfId, entry.routes[t], (node) => { if (nodes.has(node)) crossed = true; }, (link) => { if (links.has(link)) crossed = true; });
      if (crossed) crossedIn.push(t);
    }
    if (crossedIn.length > 0) list.push({ groupId: entry.groupId, count, times: crossedIn.length, transitions: crossedIn });
  }
  return list.sort((a, b) => b.times * b.count - a.times * a.count || b.times - a.times || order.get(a.groupId) - order.get(b.groupId));
}

function absoluteBands(scale) {
  const fallback = defaultSettings().colourScale.bands;
  const bands = scale && Array.isArray(scale.bands) && scale.bands.length === LOAD_BANDS - 1 && scale.bands.every((value) => Number.isFinite(value)) ? scale.bands : fallback;
  return bands;
}

// Which of the five bands a load falls in: 0 for no load, else 1 (quiet) to 5 (busy).
export function bandOf(load, scale, max) {
  if (!(load > 0)) return 0;
  if (scale && scale.mode === 'absolute') {
    const bands = absoluteBands(scale);
    let band = 1;
    for (let i = 0; i < bands.length; i += 1) if (load >= bands[i]) band = i + 2;
    return band;
  }
  if (!(max > 0)) return 1;
  return Math.min(LOAD_BANDS, Math.max(1, Math.ceil((load * LOAD_BANDS) / max)));
}

// What each band means in numbers, for the legend.
export function bandEdges(scale, max) {
  const edges = [];
  if (scale && scale.mode === 'absolute') {
    const bands = absoluteBands(scale);
    for (let band = 1; band <= LOAD_BANDS; band += 1) {
      edges.push({ band, from: band === 1 ? 1 : Math.ceil(bands[band - 2]), to: band === LOAD_BANDS ? null : Math.ceil(bands[band - 1]) - 1 });
    }
    return edges;
  }
  const top = max > 0 ? Math.floor(max) : 0;
  for (let band = 1; band <= LOAD_BANDS; band += 1) {
    // band b holds the loads with (b − 1) × max / 5 < load ≤ b × max / 5
    edges.push({ band, from: Math.floor(((band - 1) * top) / LOAD_BANDS) + 1, to: Math.floor((band * top) / LOAD_BANDS) });
  }
  return edges;
}
