// guests.js — pure functions only, same rule as engine.js: no DOM, nothing
// mutates its inputs except the guest records this module itself creates.
//
// Phase 1 (guests who walk). Through Stage 22 the crowd was one number and
// every siting mechanic — foot traffic, reachability, grounds draw — was a
// coefficient on averages of it. This module is the crowd as people: a
// typed population spawned off the attendance number simulateDay already
// computes, walked across the authored path network one time block at a
// time toward whatever serves the need each of them feels most.
//
// What it is NOT, yet: the economy. Ticket revenue is still attendance ×
// price and stall sales are still the Stage 14/17 coefficients. The walk
// reports what the crowd did — who ate, who watched, who reached a stall
// with money in hand, which built plots nobody could walk to — and the day
// report says it out loud. Reconciling that with the money is Phase 1's
// next increment, and the SIGNIFICANCE checks are its acceptance criteria.
//
// Invariants, each pinned in tests/guests.mjs:
//  - a guest is always on a path tile the gate can reach; never off-grid;
//  - the walk is a pure function of (state, guests, rng): same seed, same
//    report, so a day is final once the gates close (#45);
//  - a built plot with no finite walk from the gate is never arrived at,
//    and is named in `unreachable` rather than shrugged at.

import { GUESTS, TIME_BLOCKS, ENTRANCE, GRID } from './data.js';
import { terrainAt, computePathRoutes, plotFootprintCells, orthogonalNeighbors, computePlotAttributes, effectivePopularity, performerById, vendorById, clamp } from './engine.js';

const key = (x, y) => `${x},${y}`;

// ---------- the population ----------
// `n` is the attendance number. At most GUESTS.sampleCap agents are spawned
// and each stands for `represents` people, so a 3,000-guest Saturday costs
// the same to walk as a 300-guest Friday. Archetype is drawn against the
// authored shares, the purse uniformly within the archetype's range. The
// needs vector is copied per guest because the walk spends it.
export function spawnGuests(n, rng) {
  const count = Math.max(0, Math.min(Math.round(n), GUESTS.sampleCap));
  const represents = count > 0 ? n / count : 0;
  const guests = [];
  const totalShare = GUESTS.archetypes.reduce((s, a) => s + a.share, 0) || 1;
  for (let i = 0; i < count; i++) {
    let roll = rng() * totalShare;
    let arch = GUESTS.archetypes[GUESTS.archetypes.length - 1];
    for (const a of GUESTS.archetypes) {
      roll -= a.share;
      if (roll < 0) { arch = a; break; }
    }
    const [lo, hi] = arch.budget;
    guests.push({
      id: i,
      archetype: arch.id,
      needs: { ...arch.needs },
      affinity: arch.affinity,
      budget: Math.round(lo + rng() * (hi - lo)),
      spent: 0,
      x: ENTRANCE.x,
      y: ENTRANCE.y,
      steps: 0,
      arrivals: 0,
      meals: 0,
      visits: {},
    });
  }
  return { guests, represents };
}

// ---------- routes between two path cells ----------
// The gate tree answers gate-to-anywhere. A guest mid-grounds needs
// anywhere-to-anywhere, so this is a BFS from the asked cell over the same
// tiles, cached per source cell: the network is 30 tiles, so the whole
// all-pairs table is under a thousand short lists and is built lazily as
// the crowd actually needs it. Only cells the gate can reach are ever a
// source or a destination — a guest cannot stand on the col-3 spur to ask.
const _routeFrom = new Map();
function treeFrom(sx, sy) {
  const k = key(sx, sy);
  if (_routeFrom.has(k)) return _routeFrom.get(k);
  const reachable = computePathRoutes();
  const prev = new Map();
  const dist = new Map();
  if (reachable.has(k)) {
    prev.set(k, null);
    dist.set(k, 0);
    const queue = [[sx, sy]];
    while (queue.length) {
      const [x, y] = queue.shift();
      const d = dist.get(key(x, y));
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        const nk = key(nx, ny);
        if (!reachable.has(nk) || prev.has(nk)) continue;
        prev.set(nk, key(x, y));
        dist.set(nk, d + 1);
        queue.push([nx, ny]);
      }
    }
  }
  const tree = { prev, dist };
  _routeFrom.set(k, tree);
  return tree;
}

// Hops from one path cell to another along reachable tiles; Infinity when
// either end is off the network. The pull calculation reads this and only
// the chosen attraction's route is ever materialised.
export function pathHopsBetween(from, to) {
  const d = treeFrom(from.x, from.y).dist.get(key(to.x, to.y));
  return d === undefined ? Infinity : d;
}

// Ordered cells from `from` (exclusive) to `to` (inclusive), or null when
// either end is off the reachable network. A route from a cell to itself
// is an empty list, which is "already there", not "cannot get there".
export function pathRouteBetween(from, to) {
  const { prev } = treeFrom(from.x, from.y);
  const toK = key(to.x, to.y);
  if (!prev.has(toK)) return null;
  const out = [];
  let k = toK;
  while (k !== null && k !== key(from.x, from.y)) {
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y });
    k = prev.get(k);
  }
  return out.reverse();
}

// ---------- attractions ----------
// Everything a guest can want, with the path cell it is served from: the
// reachable path tile touching the plot's footprint with the shortest walk
// from the gate (the same frontage rule reachabilityDistance reads). A
// plot whose frontage is all on unreachable path has no stop and goes in
// `unreachable` — a stall with nobody seated is a shed and is skipped
// outright, same rule computeGroundsDraw follows.
export function buildAttractions(state) {
  const routes = computePathRoutes();
  const built = (state.builtPlots || []).filter(p => p && p.status === 'built');
  const attractions = [];
  const unreachable = [];
  for (const plot of built) {
    if ((plot.kind === 'food' || plot.kind === 'vendor') && !plot.assignedVendorId) continue;
    let stop = null;
    const consider = (c) => {
      const node = routes.get(key(c.x, c.y));
      if (node && (!stop || node.dist < stop.dist)) stop = node;
    };
    for (const c of plotFootprintCells(plot)) {
      consider(c);
      for (const nb of orthogonalNeighbors(c)) consider(nb);
    }
    if (!stop) { unreachable.push(plot.id); continue; }
    const attrs = computePlotAttributes(plot, state.builtPlots);
    const vendor = plot.assignedVendorId ? vendorById(plot.assignedVendorId) : null;
    attractions.push({
      plotId: plot.id,
      kind: plot.kind,
      need: plot.kind === 'food' ? 'food' : plot.kind === 'vendor' ? 'spend' : 'spectacle',
      stop: { x: stop.x, y: stop.y },
      gateHops: stop.dist,
      shade: attrs.shade,
      sightline: attrs.sightline,
      vendor,
      price: vendor ? vendor.avgTicket : 0,
      plot,
    });
  }
  return { attractions, unreachable };
}

// How hard a given attraction pulls at a given guest this block: the need
// it serves, the archetype's taste for the kind, what is actually on (an
// empty stage draws the way simulateDay's ambient 1.2 does; a seated
// vendor draws by quality), a shade bonus scaled by the block's heat, all
// divided by distance. A craft stall a guest cannot afford pulls nothing.
function pullOf(guest, attraction, block, schedule) {
  let quality;
  if (attraction.kind === 'stage') {
    const performerId = ((schedule || {})[block.id] || {})[attraction.plotId];
    const perf = performerId ? performerById(performerId) : null;
    const drawPop = perf ? effectivePopularity(perf, block.id) : 1.2;
    quality = (drawPop / 10) * (0.6 + 0.4 * attraction.sightline);
  } else if (attraction.kind === 'demo') {
    quality = GUESTS.demoPull;
  } else {
    quality = attraction.vendor ? attraction.vendor.quality / 10 : 0;
    if (guest.budget < attraction.price) return 0;
  }
  const need = guest.needs[attraction.need];
  const taste = guest.affinity[attraction.kind] || 1;
  const heat = typeof block.heat === 'number' ? clamp(block.heat, 0, 1) : 1;
  const shadeBonus = 1 + GUESTS.shadeWeight * guest.needs.shade * heat * attraction.shade;
  const hops = pathHopsBetween(guest, attraction.stop);
  if (!Number.isFinite(hops)) return 0;
  const again = Math.pow(GUESTS.repeatPenalty, guest.visits[attraction.plotId] || 0);
  return (need * quality * taste * shadeBonus * again) / (1 + hops / GUESTS.walkTolerance);
}

// ---------- the walk ----------
// One block at a time: every guest picks the attraction that pulls hardest
// from where it stands, walks up to GUESTS.stepsPerBlock hops toward it,
// and on arrival is served — the need drops by satisfyRate, a stall takes
// its ticket out of the purse — and is counted at that plot. A guest that
// nothing pulls hard enough sits the block out. Guests are mutated in
// place (they are this module's own records); `state` is read only.
//
// Returns raw sample counts. simulateDay scales them by `represents`.
export function walkGuests(state, guests, rng) {
  const { attractions, unreachable } = buildAttractions(state);
  const arrivals = {};
  const arrivalsByBlock = {};
  const buyers = {};
  const served = { food: 0, spectacle: 0, spend: 0, shade: 0 };
  let spent = 0, steps = 0, idle = 0, offGrid = 0;
  for (const a of attractions) { arrivals[a.plotId] = 0; buyers[a.plotId] = 0; }
  const reachable = computePathRoutes();

  for (const block of TIME_BLOCKS) {
    const heat = typeof block.heat === 'number' ? clamp(block.heat, 0, 1) : 1;
    const thisBlock = arrivalsByBlock[block.id] = {};
    for (const g of guests) {
      let best = null, bestPull = GUESTS.restThreshold;
      for (const a of attractions) {
        const pull = pullOf(g, a, block, state.schedule);
        // rng breaks exact ties so two identical stalls split a crowd
        // instead of the first-listed one taking all of it.
        if (pull > bestPull || (pull === bestPull && best && rng() < 0.5)) { best = a; bestPull = pull; }
      }
      if (!best) { idle++; continue; }
      const route = pathRouteBetween({ x: g.x, y: g.y }, best.stop);
      if (!route) { idle++; continue; }
      const take = Math.min(route.length, GUESTS.stepsPerBlock);
      if (take > 0) {
        const cell = route[take - 1];
        g.x = cell.x; g.y = cell.y;
        g.steps += take; steps += take;
      }
      if (take === route.length) {
        g.arrivals++;
        g.visits[best.plotId] = (g.visits[best.plotId] || 0) + 1;
        arrivals[best.plotId]++;
        thisBlock[best.plotId] = (thisBlock[best.plotId] || 0) + 1;
        g.needs[best.need] *= (1 - GUESTS.satisfyRate);
        served[best.need]++;
        if (best.need === 'food') g.meals++;
        // The purse was checked in pullOf: a stall a guest cannot afford
        // pulls nothing, so nobody arrives at one. That is the one rule,
        // on purpose — a second check here guarded the same absence and
        // stayed green when either was deleted (#34).
        if (best.price > 0) {
          g.budget -= best.price;
          g.spent += best.price;
          spent += best.price;
          buyers[best.plotId]++;
        }
        if (heat >= 0.5 && best.shade >= 0.5) {
          served.shade++;
          g.needs.shade *= (1 - GUESTS.satisfyRate);
        }
      }
      if (!reachable.has(key(g.x, g.y)) || g.x < 0 || g.y < 0 || g.x >= GRID.cols || g.y >= GRID.rows || terrainAt(g.x, g.y) !== 'path') offGrid++;
    }
  }

  // Went hungry: came in wanting a meal (an archetype whose food need is
  // at least half) and never reached a food stall. Read off the table and
  // the meal count, not the spent needs vector, so a guest who ate is
  // never counted however much appetite it has left.
  const wantsFood = (g) => { const a = GUESTS.archetypes.find(x => x.id === g.archetype); return (a ? a.needs.food : g.needs.food) >= 0.5; };
  const hungry = guests.filter(g => g.meals === 0 && wantsFood(g)).length;
  const unspent = guests.filter(g => g.spent === 0 && g.budget > 0).length;
  const byArchetype = {};
  for (const g of guests) byArchetype[g.archetype] = (byArchetype[g.archetype] || 0) + 1;
  return { arrivals, arrivalsByBlock, buyers, served, spent, steps, idle, offGrid, hungry, unspent, byArchetype, unreachable, sampled: guests.length };
}
