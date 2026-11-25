// Crowd-aware routes: a what-if for Movement (ARCHITECTURE 23.4 as revised by
// 23.12, spec 6). Where groups wait in a jam, would a slightly longer way
// round have got them there sooner? It is asked, never answered into the
// project: nothing here is written anywhere, the checks and every finding stay
// on the usual routes, and teachers are not rerouted (one person is not a
// crowd).
//
//   crowdAwareRun(project, results, graph, { dayTypeId, bellsId = null,
//                 cache, rounds = CROWD_ROUNDS, groupsMost = CROWD_GROUPS,
//                 detour = DETOUR })
//
// `results` is the main lane's pipeline result: the usual routes, crowd and
// loads of the run are read from it and never worked out again (a transition
// that has nobody waiting WAIT_FROM seconds is the main lane's own object).
// A day type that is the same as another asks the run it copies, as every
// reader does; the answer names that run's day type. Null when the run is not
// in `results`. `cache` is accepted for the lane's sake and left alone: a
// search with extra seconds never reads or writes a route cache (routing.js),
// and handing it one would only make routing re-stamp it.
//
// The rule, for each transition of the run in period order:
//
//   1. start from the usual routes and the main lane's crowd result;
//   2. the groups with a route and waiting WAIT_FROM seconds or more may try
//      another way, the most waiting first, then group id as a plain string
//      (crowd.js's own order), the first `groupsMost`;
//   3. the cost of a jam, per lane: extra[slot] = ceil(slotDelay[slot] /
//      through[slot]), and per link extraLink[link] = ceil(connectionDelay /
//      through), through being the groups whose route enters that slot or
//      takes that link in this transition;
//   4. each tries route() with its own plan (a step-free group stays
//      step-free, any other keeps staff-only cars shut) and those extras, and
//      the way is taken when its cells differ from the route the group has and
//      its plain seconds are at most the usual route's plus
//      max(DETOUR.seconds, DETOUR.share × the usual route's seconds);
//   5. the transition is simulated with every way taken at once and the new
//      assignment is kept only when the summed `total` of its groups is lower
//      than before; otherwise the previous one stays and the transition is done;
//   6. from a kept assignment, up to `rounds` rounds in all; a group already
//      moved may move again, or come back to its usual route.
//
// Late counts may rise while waiting falls (the keep rule is total time), and
// the words on screen say so.

import { routingGraph, route, runRoutes } from './routing.js';
import { effectiveDayType, findDayType } from './day-types.js';
import { routePath, simulateDayTransition, groupWalks } from './crowd.js';
import { loads } from './load.js';

export const CROWD_ROUNDS = 2;
export const CROWD_GROUPS = 16;
export const WAIT_FROM = 10;
export const DETOUR = { seconds: 30, share: 0.25 };

function byText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameBells(entry, bellsId) {
  return (typeof entry.bellsId === 'string' ? entry.bellsId : null) === bellsId;
}

function runEntry(list, dayTypeId, bellsId) {
  return Array.isArray(list) ? list.find((entry) => entry && entry.dayTypeId === dayTypeId && sameBells(entry, bellsId)) || null : null;
}

function sameCells(a, b) {
  if (a === b) return true;
  if (!a || !b || a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i += 1) if (a.cells[i].cell !== b.cells[i].cell || a.cells[i].floorId !== b.cells[i].floorId) return false;
  return true;
}

function sumTotals(transition) {
  let sum = 0;
  for (const group of transition.groups) sum += group.total;
  return sum;
}

// The sums DESIGN 17.7 item 4 reads, over the run's group walks.
function figuresOf(walks) {
  const sums = { waiting: 0, total: 0, late: 0, notArrived: 0, walking: 0 };
  for (const walk of walks) {
    sums.waiting += walk.waiting;
    sums.total += walk.total;
    sums.walking += walk.walking + (walk.riding > 0 ? walk.riding : 0);
    if (walk.late) sums.late += 1;
    if (!walk.arrived) sums.notArrived += 1;
  }
  return sums;
}

function walksOfRun(results, dayTypeId, bellsId) {
  const walks = results && results.walks ? (bellsId === null ? results.walks : results.walks.bells) : null;
  const list = walks && Array.isArray(walks.groups) ? walks.groups : [];
  return list.filter((walk) => walk.dayTypeId === dayTypeId && (typeof walk.bellsId === 'string' ? walk.bellsId : null) === bellsId);
}

export function crowdAwareRun(project, results, graph, options) {
  const opts = options || {};
  const rounds = Number.isInteger(opts.rounds) && opts.rounds >= 0 ? opts.rounds : CROWD_ROUNDS;
  const groupsMost = Number.isInteger(opts.groupsMost) && opts.groupsMost >= 0 ? opts.groupsMost : CROWD_GROUPS;
  const detour = opts.detour && Number.isFinite(opts.detour.seconds) && Number.isFinite(opts.detour.share) ? opts.detour : DETOUR;
  const bellsId = typeof opts.bellsId === 'string' ? opts.bellsId : null;
  if (!project || !results || !results.routes || !results.crowd) return null;

  // the run: the day type itself when it has a run of its own, else the one it copies
  const own = findDayType(project, opts.dayTypeId);
  const dayType = own && runRoutes(results.routes, own.id, bellsId) ? own : effectiveDayType(project, opts.dayTypeId);
  if (!dayType) return null;
  const usualRoutes = runRoutes(results.routes, dayType.id, bellsId);
  const usualCrowd = runEntry(bellsId === null ? results.crowd.days : results.crowd.bells, dayType.id, bellsId);
  if (!usualRoutes || !usualCrowd) return null;
  const routing = routingGraph(project, graph);
  const head = bellsId === null ? { dayTypeId: dayType.id } : { dayTypeId: dayType.id, bellsId };
  const groupOf = new Map(project.groups.map((group) => [group.id, group]));
  const entryOf = new Map(usualRoutes.groups.map((entry) => [entry.groupId, entry]));
  const usualWalks = walksOfRun(results, dayType.id, bellsId);

  const pathOf = new WeakMap();
  const pathFor = (found) => {
    if (!pathOf.has(found)) pathOf.set(found, routePath(routing, found));
    return pathOf.get(found);
  };
  // a routes object holding the run with these ways (groupId → route) in transition t
  const routesWith = (t, moved) => {
    const groups = usualRoutes.groups.map((entry) => (moved.has(entry.groupId) ? { groupId: entry.groupId, routes: entry.routes.map((found, i) => (i === t ? moved.get(entry.groupId) : found)) } : entry));
    const day = { ...usualRoutes, groups };
    return bellsId === null ? { days: [day] } : { days: [], bells: [day] };
  };
  const simulate = (t, moved) => simulateDayTransition(project, routesWith(t, moved), dayType.id, t, routing, bellsId);

  let searches = 0;
  const roundLog = [];
  const keptWays = []; // per transition: the Map of groupId → route, empty when nothing moved
  const transitions = usualCrowd.transitions.map((first, t) => {
    let current = first;
    let moved = new Map();
    keptWays[t] = moved;
    if (!first || first.off === true || !Array.isArray(first.groups)) return first;
    // a result handed in without the lane delays (an older object) is simulated once for them
    if (!first.slotDelay) {
      const again = simulate(t, moved);
      if (!again) return first;
      current = again;
    }
    for (let round = 1; round <= rounds; round += 1) {
      const waiting = current.groups
        .filter((group) => group.waiting >= WAIT_FROM)
        .sort((a, b) => b.waiting - a.waiting || byText(a.groupId, b.groupId))
        .slice(0, groupsMost);
      if (waiting.length === 0) break;
      const wayOf = (groupId) => (moved.has(groupId) ? moved.get(groupId) : entryOf.get(groupId).routes[t]);
      // the cost of a jam, per lane and per link, shared by those who went through it
      const slotThrough = new Int32Array(routing.count * 4);
      const linkThrough = new Int32Array(routing.links.length);
      for (const group of current.groups) {
        const path = pathFor(wayOf(group.groupId));
        if (!path) continue;
        const seenLink = new Set();
        for (let p = 0; p < path.length; p += 1) {
          if (path.links[p] === -1) slotThrough[path.slots[p]] += 1;
          else if (!seenLink.has(path.links[p])) {
            seenLink.add(path.links[p]);
            linkThrough[path.links[p]] += 1;
          }
        }
      }
      const extra = new Int32Array(routing.count * 4);
      for (let slot = 0; slot < extra.length; slot += 1) if (current.slotDelay[slot] > 0) extra[slot] = Math.ceil(current.slotDelay[slot] / Math.max(1, slotThrough[slot]));
      const extraLink = new Int32Array(routing.links.length);
      for (let link = 0; link < extraLink.length; link += 1) if (current.connectionDelay[link] > 0) extraLink[link] = Math.ceil(current.connectionDelay[link] / Math.max(1, linkThrough[link]));

      const trial = new Map(moved);
      let taken = 0;
      for (const walker of waiting) {
        const usual = entryOf.get(walker.groupId).routes[t];
        const group = groupOf.get(walker.groupId);
        if (!group || !usual || usual.ok !== true || usual.same === true) continue;
        const plan = group.stepFree === true ? { avoidStairs: true } : { studentsOnly: true };
        searches += 1;
        const found = route(routing, usual.fromRoomId, usual.toRoomId, { ...plan, extraSeconds: extra, extraLinkSeconds: extraLink });
        if (!found || found.ok !== true || found.same === true) continue;
        if (found.seconds > usual.seconds + Math.max(detour.seconds, detour.share * usual.seconds)) continue;
        if (sameCells(found, wayOf(walker.groupId))) continue;
        taken += 1;
        // back on the usual way is the usual route's own object
        if (sameCells(found, usual)) trial.delete(walker.groupId);
        else trial.set(walker.groupId, found);
      }
      let kept = false;
      let next = null;
      if (taken > 0) {
        next = simulate(t, trial);
        kept = Boolean(next) && sumTotals(next) < sumTotals(current);
      }
      roundLog.push({ transition: t, round, tried: waiting.length, taken, kept });
      if (!kept) break;
      current = next;
      moved = trial;
      keptWays[t] = moved;
    }
    return moved.size === 0 ? first : current;
  });

  const nothing = keptWays.every((ways) => ways.size === 0);
  const usualFigures = figuresOf(usualWalks);
  if (nothing) {
    return { ...head, routes: usualRoutes, crowd: usualCrowd, loads: runLoads(project, results, dayType.id, routing, bellsId, usualRoutes), walks: { groups: usualWalks }, changed: [], figures: { usual: usualFigures, aware: usualFigures }, rounds: roundLog, searches };
  }

  // the run's parts with the ways kept: a group entry is new only where it moved
  const ways = new Map();
  keptWays.forEach((moved, t) => {
    for (const [groupId, found] of moved) {
      if (!ways.has(groupId)) ways.set(groupId, new Map());
      ways.get(groupId).set(t, found);
    }
  });
  const awareRoutes = { ...usualRoutes, groups: usualRoutes.groups.map((entry) => (ways.has(entry.groupId) ? { groupId: entry.groupId, routes: entry.routes.map((found, t) => (ways.get(entry.groupId).has(t) ? ways.get(entry.groupId).get(t) : found)) } : entry)) };
  const awareCrowd = { ...usualCrowd, transitions };
  const awareWalks = groupWalks([awareCrowd]);
  const changed = [];
  keptWays.forEach((moved, t) => {
    if (moved.size === 0) return;
    const before = new Map(usualCrowd.transitions[t].groups.map((group) => [group.groupId, group]));
    const after = new Map(transitions[t].groups.map((group) => [group.groupId, group]));
    for (const groupId of [...moved.keys()].sort(byText)) {
      const a = before.get(groupId);
      const b = after.get(groupId);
      if (!a || !b) continue;
      const figure = (group) => ({ seconds: group.walking + (group.riding > 0 ? group.riding : 0), waiting: group.waiting, total: group.total, late: group.late });
      changed.push({ groupId, period: t, ...(transitions[t].toPeriod === undefined ? {} : { toPeriod: transitions[t].toPeriod }), usual: figure(a), aware: figure(b), cells: moved.get(groupId).cells.length });
    }
  });
  return { ...head, routes: awareRoutes, crowd: awareCrowd, loads: runLoads(project, results, dayType.id, routing, bellsId, awareRoutes), walks: { groups: awareWalks }, changed, figures: { usual: usualFigures, aware: figuresOf(awareWalks) }, rounds: roundLog, searches };
}

// loads() of this run's routes: the main lane's own object when the routes are
// the usual ones and it holds one
function runLoads(project, results, dayTypeId, routing, bellsId, runRoutesEntry) {
  const usual = runRoutes(results.routes, dayTypeId, bellsId);
  if (runRoutesEntry === usual) {
    const held = runEntry(bellsId === null ? results.loads : results.bellLoads, dayTypeId, bellsId);
    if (held) return held;
  }
  const routes = bellsId === null ? { days: [runRoutesEntry] } : { days: [], bells: [runRoutesEntry] };
  return loads(project, routes, dayTypeId, routing, bellsId === null ? undefined : bellsId);
}
