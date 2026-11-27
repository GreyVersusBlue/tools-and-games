// Crowd-aware routes as Movement reads them (ARCHITECTURE 23.7, 23.12 "One
// results view for every Movement reader"; DESIGN 17.4, 17.7). Pure: no DOM.
//
// `crowdResultsView(main, crowd)` is the one results object every panel, the
// bar, the card, playback, export, the print and the caption read while the
// choice is Crowd-aware and the lane has answered. It is the main result with
// one run's parts put in their place: that run's routes entry, crowd entry,
// loads entry and group walks are the crowd-aware run's. `findings`,
// `buildingFindings`, `places` and the versions are the main result's own, so
// what the checks say never moves, and no reader needs to know the lens
// exists to draw it. The view is memoised by the two objects' identity, so a
// panel that keeps what it drew against `state.results` keeps it.
//
// The one thing a reader may ask is `lensOf(results)`: the view's mark,
//   { run, usual, dayTypeId, bellsId }
// `run` is crowdAwareRun's answer, `usual` the main result it was worked out
// from (the usual routes, and what Checks use). Of any other results it is
// null, and `usualOf(results)` is the results themselves.
//
//   crowdResultsView(main, crowd)       the view; main itself when either is missing
//   lensOf(results), usualOf(results)   the view's mark; the usual routes' results
//   lensFits(results, dayTypeId, bellsId)   does the lens answer for this run?
//   lensFigures(results, picture)       { usual, aware } sums over the walks of the groups on screen (late: walks; lateGroups: groups)
//   anotherWay(lens, groupIds, period)  the changed ways of those groups: [{ groupId, … }]
//   movedBy(lens, groupId)              { walks, saved } for one group over the day
//   usualRouteOf(results, groupId, period)   the usual route of one walk, or null
//   usualWalkOf(results, dayTypeId, bellsId, groupId, period)   its usual walk figures, or null
//   waitingIn(results, dayTypeId, bellsId, groupIds)   is some walk of these groups kept waiting WAIT_FROM or more?
//   anotherWords(another)               "another way · 7 s saved", a group's row in the legend and the print (movedBy's answer)
//   comparisonParts(picture)            the first line's words, in pieces
//   hasWaiting(picture)                 is the link "Try crowd-aware routes" worth offering?

import { runResults } from '../../engine/worker.js';
import { WAIT_FROM } from '../../engine/crowd-routes.js';
import { formatDuration } from '../../engine/findings.js';

const views = new WeakMap();

function sameRun(entry, dayTypeId, bellsId) {
  return Boolean(entry) && entry.dayTypeId === dayTypeId && (typeof entry.bellsId === 'string' ? entry.bellsId : null) === bellsId;
}

function swap(list, dayTypeId, bellsId, entry) {
  return Array.isArray(list) ? list.map((each) => (sameRun(each, dayTypeId, bellsId) ? entry : each)) : list;
}

// The walks of every run, the one run's put where its first walk stood.
function swapWalks(list, dayTypeId, bellsId, entries) {
  if (!Array.isArray(list)) return list;
  const out = [];
  let put = false;
  for (const walk of list) {
    if (!sameRun(walk, dayTypeId, bellsId)) {
      out.push(walk);
    } else if (!put) {
      out.push(...entries);
      put = true;
    }
  }
  if (!put) out.push(...entries);
  return out;
}

export function crowdResultsView(main, crowd) {
  if (!main || !crowd || !main.routes || !crowd.routes) return main || null;
  let byCrowd = views.get(main);
  if (!byCrowd) {
    byCrowd = new WeakMap();
    views.set(main, byCrowd);
  }
  const kept = byCrowd.get(crowd);
  if (kept) return kept;
  const dayTypeId = crowd.dayTypeId;
  const bellsId = typeof crowd.bellsId === 'string' ? crowd.bellsId : null;
  const regular = bellsId === null;
  const view = { ...main };
  view.routes = regular ? { ...main.routes, days: swap(main.routes.days, dayTypeId, null, crowd.routes) } : { ...main.routes, bells: swap(main.routes.bells, dayTypeId, bellsId, crowd.routes) };
  view.crowd = main.crowd ? (regular ? { ...main.crowd, days: swap(main.crowd.days, dayTypeId, null, crowd.crowd) } : { ...main.crowd, bells: swap(main.crowd.bells, dayTypeId, bellsId, crowd.crowd) }) : main.crowd;
  if (regular) view.loads = swap(main.loads, dayTypeId, null, crowd.loads);
  else view.bellLoads = swap(main.bellLoads, dayTypeId, bellsId, crowd.loads);
  const mine = crowd.walks && Array.isArray(crowd.walks.groups) ? crowd.walks.groups : [];
  if (main.walks) {
    view.walks = regular
      ? { ...main.walks, groups: swapWalks(main.walks.groups, dayTypeId, null, mine) }
      : { ...main.walks, bells: { ...main.walks.bells, groups: swapWalks(main.walks.bells ? main.walks.bells.groups : [], dayTypeId, bellsId, mine) } };
  }
  view.crowdAware = { run: crowd, usual: main, dayTypeId, bellsId };
  byCrowd.set(crowd, view);
  return view;
}

export function lensOf(results) {
  return results && results.crowdAware ? results.crowdAware : null;
}

export function usualOf(results) {
  return results && results.crowdAware ? results.crowdAware.usual : results;
}

export function lensFits(results, dayTypeId, bellsId) {
  const lens = lensOf(results);
  return lens !== null && lens.dayTypeId === dayTypeId && lens.bellsId === (typeof bellsId === 'string' ? bellsId : null);
}

// `late` counts walks that were late (the run's own `figures.late`, ARCHITECTURE 23.4); `lateGroups` counts the groups
// that had at least one, which is what the words "groups late" say (a group late twice is one group).
function sums(walks) {
  const found = { waiting: 0, walking: 0, total: 0, late: 0, lateGroups: 0, walks: 0 };
  const lateOnes = new Set();
  for (const walk of walks) {
    found.walks += 1;
    found.waiting += walk.waiting;
    found.walking += walk.walking + (walk.riding > 0 ? walk.riding : 0);
    found.total += walk.total;
    if (walk.late === true) {
      found.late += 1;
      lateOnes.add(walk.groupId);
    }
  }
  found.lateGroups = lateOnes.size;
  return found;
}

// The usual and the crowd-aware sums over the walks of the groups on screen
// (and of the transition chosen), so a sentence about three groups is about
// three groups. With every group on screen and the whole day they are the
// run's own `figures` (a Node case holds that).
export function lensFigures(results, picture) {
  const lens = lensOf(results);
  if (!lens) return null;
  const shown = new Set(picture.groups.map((group) => group.id));
  const period = picture.choice.transition;
  const pick = (from) => runResults(from, lens.dayTypeId, lens.bellsId).walks.groups.filter((walk) => shown.has(walk.groupId) && (period === null || walk.period === period));
  return { usual: sums(pick(lens.usual)), aware: sums(pick(results)) };
}

export function anotherWay(lens, groupIds, period) {
  if (!lens) return [];
  const shown = groupIds instanceof Set ? groupIds : new Set(groupIds);
  return lens.run.changed.filter((row) => shown.has(row.groupId) && (period === null || period === undefined || row.period === period));
}

// One group's changed ways: how many walks, and the seconds its own total fell over them (negative: rose).
export function movedBy(lens, groupId) {
  const rows = lens ? lens.run.changed.filter((row) => row.groupId === groupId) : [];
  if (rows.length === 0) return null;
  let saved = 0;
  for (const row of rows) saved += row.usual.total - row.aware.total;
  return { walks: rows.length, saved, periods: rows.map((row) => row.period) };
}

export function usualRouteOf(results, groupId, period) {
  const lens = lensOf(results);
  if (!lens) return null;
  const day = runResults(lens.usual, lens.dayTypeId, lens.bellsId).routes;
  const entry = day ? day.groups.find((each) => each.groupId === groupId) : null;
  return entry && entry.routes[period] ? entry.routes[period] : null;
}

export function usualWalkOf(results, dayTypeId, bellsId, groupId, period) {
  const lens = lensOf(results);
  if (!lens || !lensFits(results, dayTypeId, bellsId)) return null;
  return runResults(lens.usual, dayTypeId, bellsId).walks.groups.find((walk) => walk.groupId === groupId && walk.period === period) || null;
}

export function waitingIn(results, dayTypeId, bellsId, groupIds) {
  const shown = groupIds instanceof Set ? groupIds : new Set(groupIds);
  return runResults(usualOf(results), dayTypeId, bellsId).walks.groups.some((walk) => shown.has(walk.groupId) && walk.waiting >= WAIT_FROM);
}

// "another way · 7 s saved": the seconds a group's own total fell over the walks that took another way ("7 s more" when it rose)
export function anotherWords(another) {
  return 'another way \u00b7 ' + (another.saved > 0 ? formatDuration(another.saved) + ' saved' : another.saved < 0 ? formatDuration(-another.saved) + ' more' : 'no time saved');
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

// "Crowd-aware routes on A Day: 6 groups take another way: 3 min 40 s less
// waiting, 1 min 10 s more walking (summed over the groups' walks); groups
// late 5 → 3. A what-if: checks use the usual routes." (DESIGN 17.4, 17.7
// items 4 and 7), in pieces ({ text, name }). `picture.compare` is
// lensFigures'. A picture that is not of the lens has no words.
export function comparisonParts(picture) {
  if (picture.routesMode !== 'crowd' || !picture.compare) return [];
  const { usual, aware } = picture.compare;
  const moved = new Set(picture.changed.map((row) => row.groupId)).size;
  const parts = [{ text: 'Crowd-aware routes on ' }, { text: picture.dayTypeName, name: true }];
  if (picture.transition) parts.push({ text: ', ' + picture.transition.name });
  parts.push({ text: ': ' });
  if (moved === 0) {
    parts.push({ text: picture.elsewhere > 0
      ? 'none of the groups shown takes another way; ' + plural(picture.elsewhere, 'group', 'groups') + ' elsewhere ' + (picture.elsewhere === 1 ? 'does' : 'do') + '.'
      : 'no group finds a quicker way round. The usual routes already use the building well.' });
  } else {
    const less = usual.waiting - aware.waiting;
    const more = aware.walking - usual.walking;
    const waiting = less === 0 ? 'the same waiting' : formatDuration(Math.abs(less)) + (less > 0 ? ' less waiting' : ' more waiting');
    const walking = more === 0 ? 'the same walking' : formatDuration(Math.abs(more)) + (more > 0 ? ' more walking' : ' less walking');
    // groups, not walks: a group that is late in two transitions is one group late
    const late = usual.lateGroups === 0 && aware.lateGroups === 0 ? 'no group late' : 'groups late ' + usual.lateGroups + ' → ' + aware.lateGroups;
    parts.push({ text: plural(moved, 'group takes', 'groups take') + ' another way: ' + waiting + ', ' + walking + ' (summed over the groups’ walks); ' + late + '.' });
  }
  parts.push({ text: ' A what-if: checks use the usual routes.' });
  return parts;
}

// The link that offers the lens where Routes is folded away: some place has waiting, on the usual routes, and the lens is not
// already chosen (being worked out, or failed).
export function hasWaiting(picture) {
  return picture.routesMode === 'usual' && picture.waiting === true && picture.choice.routes !== 'crowd';
}
