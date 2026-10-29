// The scenario lab's difference map (spec 9.2; DESIGN 5.4; ARCHITECTURE 6.6
// "The difference map"): the lab's plan map painted with how each corridor
// cell's load changes when the open scenario is applied, the card of a cell,
// and the text alternative, a table of the ten largest changes in the
// inspector beside the comparison. The painting is
// ui/surface/overlays/difference.js; this is what feeds it.
//
//   mountDifference({ ctx, store, plan, memory, lane, inspector }) -> { update() }
//   whenWords, sidesWords, cardText: the card's words (below)
//   cardWalks, groupsAt: who walks a cell before and after (below)
//     plan       the lab's plan map (ui/surface/plan-map.js)
//     memory     the lab's memory: dayTypeId and transition are its own
//                choice in the comparison (null for every day type, null for
//                the whole day), followed here, never chosen a second time
//     lane       the lab's lane: lane.answer is store.derived.scenario()'s
//                last answer ({ result, changes, versions, … }) or null,
//                lane.pending while a newer one is being worked out
//     inspector  () => the inspector's box, where the table goes
//     update()   the lab calls it whenever its comparison is drawn: a new
//                answer, an asking, a choice of day type or transition,
//                the scenario closed
//
// Before is the main lane's result for the answer's counters
// (store.derived.results(), which keeps one answer per counter triple, so
// this is the result the comparison was made against); after is the
// answer's result. Both carry their `loads` whole through trimResult. An
// answer is taken only together with its before: until results() gives the
// before for the answer's counters, the last answer and its picture stay.
// With no answer the map is not painted. The section's data-difference:
//   'none'     no answer
//   'waiting'  an answer is coming and nothing is painted: the first one,
//              or the building has changed under the picture (the store's
//              geometry counter is not the answer's), which leaves the map
//              unpainted and the card closed until an answer for it comes
//   'old'      a newer answer is coming; the last picture stays painted
//   'failed'   results() refused; the section says so in the comparison's
//              words, and the next update asks again
//   'shown'    the picture is the lane's newest answer
//
// The card (on hover, on a tap, at the keyboard cursor) gives a walkable
// cell's place, its change in words, its load before and after, and the
// groups that walk there only before or only after. Only a group the
// scenario edits can walk anywhere else: their walks are routed by the
// engine's own routesForSchedule, for the real schedule and the scenario,
// once an answer, on the first card after it comes (cardWalks), and every
// card after that only looks up who crosses its cell (groupsAt). For one
// transition the groups are counted in that transition, the one the
// figures are of. For the whole day the figures are each side's busiest
// transition, which before and after can be two different transitions, so
// the groups are counted over the whole day and the card says "Over the
// day".
//
// The test handle is document.querySelector('.scn').difference.

import { h } from '../components/dom.js';
import { slotAt } from '../surface/plan-layout.js';
import { differenceOverlay, differenceOf, differenceWords, rankPlaces, apartGroups, strengthOf, DIFFERENCE_ALPHA, DIFFERENCE_TOP } from '../surface/overlays/difference.js';
import { applyChanges, editedGroupIds } from '../../engine/scenario.js';
import { routesForSchedule, routingGraph, createRouteCache } from '../../engine/routing.js';
import { buildGraph } from '../../engine/graph.js';
import { findBellSchedule } from '../../engine/bells.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { meetingSlots } from '../../engine/runs.js';
import { transitionName } from './model.js';
import { unitWord } from '../movement/model.js';

// the card's walks share one route cache, as the movement view's do
const cache = createRouteCache(16);

function sameVersions(a, b) {
  return Boolean(a) && Boolean(b) && a.geometry === b.geometry && a.building === b.building && a.schedule === b.schedule;
}

function partsToNodes(parts) {
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

function partsToText(parts) {
  return parts.map((part) => part.text).join('');
}

// The card's words, in Node as on the page:
//
//   whenWords(project, transition, dayTypeId, bellsId)
//     "at its busiest in one transition, on A Day" for the whole day,
//     "in Period 2 to Period 3, on A Day" for one transition; under a bell
//     schedule the day says so: "on A Day with Early Release bells"
//   sidesWords(info)   "Before 12, after 26 students, <when>."
//   apartLabel(side, transition)
//     "Walk here only before: " for one transition,
//     "Over the day, walk here only before: " for the whole day (null)
//   cardText(info)     the card as one sentence, for the live region:
//     "<place>, <floor>, corridor: 14 busier. Before 12, after 26 students,
//      <when>. Walk here only before: 7A. Walk here only after: 8B."
//     It is said in place of the lab's own line about the cell ("Floor 1:
//     corridor."), so it names the floor and corridor or stairs as that does.
//   info: { parts, floorName, stairs, words, before, after, unit, when,
//           transition, excluded,
//           groups: { onlyBefore, onlyAfter } (groups, by name as typed) or null }
export function whenWords(project, transition, dayTypeId, bellsId) {
  const day = project.dayTypes.find((each) => each.id === dayTypeId);
  const schedule = findBellSchedule(project, bellsId);
  const on = day ? ', on ' + day.name + (schedule ? ' with ' + schedule.name + ' bells' : '') : '';
  if (transition === null) return 'at its busiest in one transition' + on;
  return 'in ' + transitionName(project, bellsId, transition) + on;
}

export function sidesWords(info) {
  return 'Before ' + info.before + ', after ' + info.after + ' ' + unitWord(info.unit, info.after) + ', ' + info.when + '.';
}

function namesText(groups) {
  return groups.map((group) => group.name).join(', ');
}

export function apartLabel(side, transition) {
  return (transition === null ? 'Over the day, walk' : 'Walk') + ' here only ' + side + ': ';
}

export function cardText(info) {
  const transition = info.transition === undefined ? null : info.transition;
  let text = partsToText(info.parts) + ', ' + info.floorName + ', ' + (info.stairs ? 'stairs' : 'corridor') + ': ' + info.words + '. ' + sidesWords(info);
  if (info.excluded) text += ' In an exclusion zone.';
  if (info.groups && info.groups.onlyBefore.length > 0) text += ' ' + apartLabel('before', transition) + namesText(info.groups.onlyBefore) + '.';
  if (info.groups && info.groups.onlyAfter.length > 0) text += ' ' + apartLabel('after', transition) + namesText(info.groups.onlyAfter) + '.';
  return text;
}

// Who walks where, before and after, for the card: worked out once an
// answer.
//
//   cardWalks(project, changes, graph, { cache, geometryVersion, bellsId }?)
//     project is the real schedule, changes the answer's (reconcile's kept
//     changes) and graph buildGraph(project). The groups the changes edit
//     are routed for the real schedule and for it with the changes applied;
//     no other group walks anywhere else. Null when no change edits a group.
//       { order: Map groupId -> its place in project.groups,
//         before, after: Map dayTypeId -> Map node -> Map groupId -> Set of
//                        the transitions it crosses the node in }
//     A route crosses the cells it walks, each once, as engine/load.js
//     counts a load (a route not found, or one that stays in its room,
//     crosses nothing); test/ui/difference.test.mjs holds it to
//     contributors' answer at every node.
//   groupsAt(walks, node, dayTypeId, transition) -> { onlyBefore, onlyAfter }
//     the group ids that cross the node on that day only before and only
//     after, in the transition (null: in any transition of the day), each in
//     the order of the project's groups
function crossings(routes, graph, edited, bellsId) {
  const byDay = new Map();
  for (const day of (bellsId === null ? routes.days : routes.bells || [])) {
    const nodes = new Map();
    for (const entry of day.groups) {
      if (!edited.has(entry.groupId)) continue;
      entry.routes.forEach((found, t) => {
        if (!found || found.ok !== true || found.same === true) return;
        for (const place of found.cells) {
          const f = graph.floorIndex.get(place.floorId);
          if (f === undefined) continue;
          const node = graph.floors[f].nodeOfCell[place.cell];
          if (node === undefined || node < 0) continue;
          let groups = nodes.get(node);
          if (!groups) nodes.set(node, (groups = new Map()));
          let times = groups.get(entry.groupId);
          if (!times) groups.set(entry.groupId, (times = new Set()));
          times.add(t);
        }
      });
    }
    byDay.set(day.dayTypeId, nodes);
  }
  return byDay;
}

export function cardWalks(project, changes, graph, options) {
  const edited = new Set(editedGroupIds(changes || []));
  for (const id of edited) if (!project.groups.some((group) => group.id === id)) edited.delete(id);
  if (edited.size === 0) return null;
  const after = applyChanges(project, changes);
  const only = (whole) => ({ ...whole, groups: whole.groups.filter((group) => edited.has(group.id)) });
  const routing = routingGraph(project, graph);
  const opts = options || {};
  const asked = { cache: opts.cache, geometryVersion: opts.geometryVersion };
  const bellsId = typeof opts.bellsId === 'string' ? opts.bellsId : null;
  // the run under the bells chosen: its routes put each group where meetingSlots does, a walk across periods that do not meet included
  const routesOf = (whole) => routesForSchedule(only(whole), routing, bellsId === null ? asked : { ...asked, runs: ownDayTypes(whole).map((dayType) => ({ dayTypeId: dayType.id, bellsId })), meetingSlots });
  return {
    order: new Map(project.groups.map((group, index) => [group.id, index])),
    before: crossings(routesOf(project), graph, edited, bellsId),
    after: crossings(routesOf(after), graph, edited, bellsId),
  };
}

export function groupsAt(walks, node, dayTypeId, transition) {
  if (!walks) return { onlyBefore: [], onlyAfter: [] };
  const who = (side) => {
    const nodes = side.get(dayTypeId);
    const groups = nodes ? nodes.get(node) : null;
    if (!groups) return [];
    const ids = [];
    for (const [id, times] of groups) if (transition === null || transition === undefined || times.has(transition)) ids.push(id);
    return ids.sort((a, b) => walks.order.get(a) - walks.order.get(b));
  };
  return apartGroups(who(walks.before), who(walks.after));
}

// a swatch of the tint at a strength, in the theme on screen (the tokens
// follow the theme, so the swatch does too)
function swatch(kind, strength) {
  const share = Math.round(DIFFERENCE_ALPHA[strength - 1] * 100);
  return h('span', { class: 'mov-swatch', 'aria-hidden': 'true', style: 'background:color-mix(in srgb, var(--' + kind + ') ' + share + '%, var(--corridor))' });
}

export function mountDifference({ ctx, store, plan, memory, lane, inspector }) {
  const element = plan.root;
  // what is painted: the answer it is from and the before it is compared
  // with (taken together, never one without the other), the difference
  // worked out for the lab's choice, and the card's walks for the answer
  const held = { answer: null, before: null, key: null, difference: null, ranked: { rows: [], changed: 0 }, graph: null, project: null, walks: null };
  // the newest answer whose before is asked for: { answer, state: 'out' | 'failed' }
  let asking = null;
  // what results() refused with, said in the section until an answer is taken
  let failed = null;
  // the painter's last paint, for the tests: which picture it painted
  // (data-difference-made when it painted) and in which theme
  const painted = { count: 0, theme: null, made: null };
  const draw = differenceOverlay(() => (held.difference && current() ? { difference: held.difference, graph: held.graph } : null));
  plan.overlays.push((g, view, floor, theme) => {
    if (!held.difference || !current()) return;
    painted.count += 1;
    painted.theme = theme.problem + ' ' + theme.accent + ' ' + theme.corridor;
    painted.made = element.dataset.differenceMade;
    draw(g, view, floor, theme);
  });

  // ---- the text alternative, in the inspector
  const title = h('h3', { class: 'scn-compare__heading', id: 'scenario-difference-title' });
  const key = h('p', { class: 'scn-compare__note', data: { part: 'difference-key' } });
  const tableBody = h('tbody');
  const table = h('table', { class: 'scn-table scn-difference', data: { part: 'difference-table' } },
    h('caption', { class: 'vh' }, 'The ' + DIFFERENCE_TOP + ' largest changes on the difference map, largest first'),
    // five columns in the inspector's 320 px, at the shares of scenarios.css's
    // .scn-difference, the figures' headings over their figures at the right
    h('thead', null, h('tr', null, ...['Place', 'Floor', 'Before', 'After', 'Change'].map((text) => h('th', { scope: 'col' }, text)))),
    tableBody);
  const note = h('p', { class: 'scn-compare__note', data: { part: 'difference-note' } });
  // laid out as the comparison above it is (its padding and spacing)
  const section = h('section', { class: 'scn-compare scn-difference-block', 'aria-labelledby': 'scenario-difference-title', data: { part: 'difference' }, hidden: true }, title, key, table, note);

  function place() {
    const box = inspector();
    if (box && section.parentNode !== box) box.append(section);
  }

  function floorNames(project, floorIds) {
    return floorIds.map((id) => {
      const floor = project.building.floors.find((each) => each.id === id);
      return floor ? floor.name : '';
    }).filter((name) => name !== '');
  }

  // in the comparison's own words (ui/scenarios/compare.js)
  function failedWords() {
    return 'The difference map could not be worked out: ' + failed + (held.difference ? ' The map and the table are from before your last change.' : '');
  }

  function drawTable() {
    place();
    const difference = held.difference;
    const project = held.project;
    if (!difference || !project) {
      tableBody.replaceChildren();
      if (failed === null) {
        section.hidden = true;
        return;
      }
      section.hidden = false;
      title.textContent = 'The difference map';
      key.hidden = true;
      table.hidden = true;
      note.textContent = failedWords();
      note.hidden = false;
      return;
    }
    section.hidden = false;
    key.hidden = false;
    const unit = difference.unit;
    title.textContent = difference.transition === null
      ? 'Corridors that change most over the day'
      : 'Corridors that change most in ' + transitionName(project, memory.bellsId, difference.transition);
    key.replaceChildren('On the map: ', swatch('problem', 3), 'busier, ', swatch('accent', 3), 'quieter. ',
      difference.largest > 0 ? 'The stronger the colour, the larger the change; the largest is ' + difference.largest + ' ' + unitWord(unit, difference.largest) + '. A place with no change is not coloured.' : 'Nothing on the map changes.');
    // the day type is named on a row only when the rows come from more than one
    const several = new Set(held.ranked.rows.map((row) => row.dayTypeId)).size > 1;
    const dayName = (id) => {
      const day = project.dayTypes.find((each) => each.id === id);
      return day ? day.name : '';
    };
    tableBody.replaceChildren(...held.ranked.rows.map((row) => h('tr', { data: { place: row.placeId, delta: String(row.delta), trend: row.delta > 0 ? 'busier' : 'quieter' } },
      h('th', { scope: 'row' }, h('span', { dir: 'auto' }, partsToNodes(row.parts)), several ? h('span', { class: 'scn-tag' }, ' ', h('bdi', null, dayName(row.dayTypeId))) : null),
      h('td', null, ...floorNames(project, row.floorIds).flatMap((name, i) => (i === 0 ? [h('bdi', null, name)] : [', ', h('bdi', null, name)]))),
      h('td', { class: 'num' }, String(row.before)),
      h('td', { class: 'num' }, String(row.after)),
      h('td', { class: 'num' }, differenceWords(row.delta)))));
    table.hidden = held.ranked.rows.length === 0;
    const more = held.ranked.changed - held.ranked.rows.length;
    const said = held.ranked.changed === 0
      ? (difference.transition === null ? 'No corridor gets busier or quieter over the day.' : 'No corridor gets busier or quieter in this transition.')
      : more > 0 ? (more === 1 ? '1 other place changes less.' : more + ' other places change less.') : '';
    note.textContent = failed === null ? said : failedWords() + (said ? ' ' + said : '');
    note.hidden = note.textContent === '';
  }

  // ---- working out the picture
  // the answer taken is of the building on the map: the store's geometry
  // counter is still the one it was worked out at
  function current() {
    return Boolean(held.answer) && Boolean(held.answer.versions) && held.answer.versions.geometry === store.geometryVersion;
  }

  function stateOf() {
    if (!held.answer && !asking) return 'none';
    if (asking && asking.state === 'failed') return 'failed';
    if (!held.difference) return 'waiting';
    return lane.pending || asking || lane.answer !== held.answer ? 'old' : 'shown';
  }

  function settle() {
    element.dataset.difference = stateOf();
  }

  function compute() {
    const answer = held.answer;
    if (!answer || !held.before || !current()) return;
    const next = [answer, held.before, memory.dayTypeId, memory.transition, memory.bellsId];
    if (held.key && next.every((each, i) => each === held.key[i])) return;
    held.key = next;
    held.project = store.project;
    held.graph = store.derived.get('graph', ['building'], (project) => buildGraph(project));
    // the loads of the run chosen: the regular bells' or one bell schedule's
    const runLoads = (result) => (memory.bellsId === null ? result.loads : (Array.isArray(result.bellLoads) ? result.bellLoads : []).filter((load) => load && load.bellsId === memory.bellsId));
    held.difference = differenceOf(runLoads(held.before), runLoads(answer.result), { dayTypeId: memory.dayTypeId, transition: memory.transition, measure: 'busiest' });
    held.ranked = held.difference ? rankPlaces(held.difference, answer.result.places, DIFFERENCE_TOP) : { rows: [], changed: 0 };
    element.dataset.differenceMade = String(Number(element.dataset.differenceMade || 0) + 1);
    drawTable();
    refreshCard();
    plan.paint();
  }

  // the picture taken down, the answer kept: the building changed under it
  function blank() {
    held.key = null;
    held.difference = null;
    held.ranked = { rows: [], changed: 0 };
    hideCard();
    drawTable();
    plan.paint();
  }

  function clear() {
    held.answer = null;
    held.before = null;
    held.walks = null;
    asking = null;
    failed = null;
    blank();
  }

  // the before for this answer; the answer is taken only with it
  function fetchBefore(answer) {
    const mine = { answer, state: 'out' };
    asking = mine;
    if (failed !== null) {
      failed = null;
      drawTable();
    }
    const refused = (error) => {
      if (asking !== mine) return;
      mine.state = 'failed';
      failed = error && error.message ? error.message : String(error);
      drawTable();
      settle();
    };
    if (!store.derived || typeof store.derived.results !== 'function') {
      refused(new Error('the engine is not running on this page.'));
      return;
    }
    store.derived.results().then((main) => {
      if (asking !== mine) return;
      asking = null;
      // the store has moved on: a newer answer is on its way, and the last
      // picture stays until it comes (the next update asks again)
      if (!main || !sameVersions(main.versions, answer.versions)) {
        settle();
        return;
      }
      held.answer = answer;
      held.before = main;
      held.key = null;
      compute();
      settle();
    }, refused);
  }

  function update() {
    const answer = lane.answer;
    if (!answer || !answer.result) {
      if (held.answer || held.difference || asking || failed !== null) clear();
      settle();
      return;
    }
    if (answer !== held.answer && !(asking && asking.answer === answer && asking.state === 'out')) fetchBefore(answer);
    if (held.difference && !current()) blank();
    compute();
    settle();
  }

  // ---- the card
  const cardPlace = h('p', { class: 'mov-card__place' });
  const cardChange = h('p', { class: 'mov-card__load', data: { part: 'change' } });
  const cardSides = h('p', { data: { part: 'sides' } });
  const cardZone = h('p', { class: 'mov-card__zone', hidden: true }, 'In an exclusion zone: the map leaves it uncoloured.');
  const cardBefore = h('p', { data: { part: 'only-before' }, hidden: true });
  const cardAfter = h('p', { data: { part: 'only-after' }, hidden: true });
  const card = h('div', { class: 'mov-card', hidden: true, data: { card: 'difference' } }, cardPlace, cardChange, cardSides, cardZone, cardBefore, cardAfter);
  plan.stage.append(card);
  // the cell whose card shows: { floorId, cell, x, y, source }
  let point = null;

  // who walks over this node only before, and only after: the walks are
  // worked out on the first card after an answer is taken, and kept with it
  function groupsApart(node, dayTypeId) {
    const answer = held.answer;
    const project = store.project;
    if (!answer || !sameVersions(answer.versions, { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion })) return null;
    if (!held.walks || held.walks.answer !== answer || held.walks.bellsId !== memory.bellsId) {
      held.walks = { answer, bellsId: memory.bellsId, walks: cardWalks(project, answer.changes || [], held.graph, { cache, geometryVersion: store.geometryVersion, bellsId: memory.bellsId }) };
      builds.walks += 1;
    }
    const apart = groupsAt(held.walks.walks, node, dayTypeId, held.difference.transition);
    const named = (ids) => ids.map((id) => project.groups.find((group) => group.id === id)).filter(Boolean);
    return { onlyBefore: named(apart.onlyBefore), onlyAfter: named(apart.onlyAfter) };
  }

  // how many times the card's walks were worked out, for the tests
  const builds = { walks: 0 };

  // what the card says of a cell, or null where there is nothing to say
  function cardOf(floorId, cell) {
    const difference = held.difference;
    const graph = held.graph;
    const project = held.project;
    if (!difference || !graph || !project || !current() || graph.count !== difference.cells.length) return null;
    const f = graph.floorIndex.get(floorId);
    if (f === undefined) return null;
    const node = graph.floors[f].nodeOfCell[cell];
    if (node === undefined || node < 0) return null;
    const places = held.answer.result.places;
    const at = places ? places.places[places.placeOfNode[node]] : null;
    const dayTypeId = difference.dayTypeIds[difference.dayOfCell[node]];
    const delta = difference.cells[node];
    return {
      floorId,
      cell,
      node,
      parts: at && at.parts && at.parts.length > 0 ? at.parts : [{ text: at ? at.name : 'Corridor' }],
      floorName: graph.floors[f].name,
      stairs: Boolean(graph.stairs && graph.stairs[node]),
      delta,
      words: differenceWords(delta),
      strength: strengthOf(delta, difference.largest),
      before: difference.before.cells[node],
      after: difference.after.cells[node],
      unit: difference.unit,
      when: whenWords(project, difference.transition, dayTypeId, memory.bellsId),
      transition: difference.transition,
      dayTypeId,
      excluded: Boolean(difference.excluded && difference.excluded[node]),
      groups: groupsApart(node, dayTypeId),
    };
  }

  function namesNodes(label, groups) {
    const out = [h('span', { class: 'mov-card__floor' }, label)];
    groups.forEach((group, i) => {
      if (i > 0) out.push(', ');
      out.push(h('bdi', { data: { group: group.id } }, group.name));
    });
    return out;
  }

  function showCard(info, x, y) {
    cardPlace.replaceChildren(...partsToNodes(info.parts), h('span', { class: 'mov-card__floor' }, ' · ', h('bdi', null, info.floorName)));
    cardChange.textContent = info.words;
    cardChange.dataset.trend = info.delta > 0 ? 'busier' : info.delta < 0 ? 'quieter' : 'same';
    cardSides.textContent = sidesWords(info);
    cardZone.hidden = !info.excluded;
    const groups = info.groups || { onlyBefore: [], onlyAfter: [] };
    cardBefore.hidden = groups.onlyBefore.length === 0;
    cardBefore.replaceChildren(...(groups.onlyBefore.length > 0 ? namesNodes(apartLabel('before', info.transition), groups.onlyBefore) : []));
    cardAfter.hidden = groups.onlyAfter.length === 0;
    cardAfter.replaceChildren(...(groups.onlyAfter.length > 0 ? namesNodes(apartLabel('after', info.transition), groups.onlyAfter) : []));
    card.dataset.floor = info.floorId;
    card.dataset.cell = String(info.cell);
    card.hidden = false;
    // beside the cell, on whichever side has room
    const view = plan.view;
    const at = view.toScreen(Math.floor(x), Math.floor(y));
    const size = view.size;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let left = at.x + size + 10;
    if (left + width > plan.stage.clientWidth - 8) left = at.x - width - 10;
    let top = at.y + size + 10;
    if (top + height > plan.stage.clientHeight - 8) top = at.y - height - 10;
    card.style.left = Math.max(8, left) + 'px';
    card.style.top = Math.max(8, top) + 'px';
  }

  function hideCard() {
    if (!point && card.hidden) return;
    point = null;
    card.hidden = true;
    plan.hover(null);
    plan.paint();
  }

  // the card for the map cell at (x, y) in the map's cells: what was found
  function pointAt(x, y, source) {
    const world = plan.world;
    const found = world ? slotAt(world, x, y) : null;
    const info = found ? cardOf(found.slot.floor.id, found.cell) : null;
    if (!info) {
      hideCard();
      return { found, info: null };
    }
    point = { floorId: info.floorId, cell: info.cell, x, y, source, difference: held.difference };
    plan.hover(source === 'keyboard' ? null : info.floorId, info.cell);
    showCard(info, x, y);
    plan.paint();
    return { found, info };
  }

  // a card the reader tapped open stays on its cell through a new picture
  function refreshCard() {
    if (!point) return;
    if (point.source === 'tap') pointAt(point.x, point.y, 'tap');
    else hideCard();
  }

  // the card's sentence for the keyboard cursor's last move, for the lab to
  // say (cursorWords); null on a cell with no card
  let heard = null;
  plan.onCell((ev) => {
    if (ev.kind === 'keyboard') heard = null;
    if (!held.difference) {
      if (ev.kind === 'escape' && point) {
        hideCard();
        return true;
      }
      return false;
    }
    const world = plan.world;
    if (ev.kind === 'tap') {
      const found = world && ev.inside ? slotAt(world, ev.x, ev.y) : null;
      if (!found || (point && point.source === 'tap' && point.floorId === found.slot.floor.id && point.cell === found.cell)) hideCard();
      else pointAt(ev.x, ev.y, 'tap');
    } else if (ev.kind === 'hover') {
      if (point && point.source === 'tap') return false;
      if (!ev.inside) {
        hideCard();
        return false;
      }
      const found = point && point.source === 'hover' && point.difference === held.difference && world ? slotAt(world, ev.x, ev.y) : null;
      if (found && found.slot.floor.id === point.floorId && found.cell === point.cell) return false;
      pointAt(ev.x, ev.y, 'hover');
    } else if (ev.kind === 'keyboard') {
      // On a cell with a card the card's sentence is the one said, by the
      // lab's own cursor handler, which runs after this one and asks
      // cursorWords() (SV2-72d: one line in the live region, never the lab's
      // then this). It names the floor and corridor or stairs, as the lab's
      // line does, before the rest of the card.
      const { info } = pointAt(ev.x, ev.y, 'keyboard');
      if (info) heard = cardText(info);
    } else if (ev.kind === 'escape') {
      if (!point) return false;
      hideCard();
      return true;
    } else if (ev.kind === 'view') {
      if (point && point.source === 'tap') pointAt(point.x, point.y, 'tap');
      else hideCard();
    } else if (ev.kind === 'resize') {
      refreshCard();
    }
    return false;
  });

  // ---- the test handle
  element.difference = {
    card,
    section,
    get difference() { return held.difference; },
    get answer() { return held.answer; },
    get rows() { return held.ranked.rows; },
    get changed() { return held.ranked.changed; },
    painted,
    builds,
    get failed() { return failed; },
    cardOf,
    cardText,
    // what is painted, cell by cell, read from the picture rather than the pixels
    state() {
      const difference = held.difference;
      const graph = held.graph;
      const out = { state: stateOf(), answer: held.answer, dayTypeId: memory.dayTypeId, transition: memory.transition, largest: difference ? difference.largest : 0, busier: [], quieter: [], top: held.ranked.rows.map((row) => ({ placeId: row.placeId, delta: row.delta, before: row.before, after: row.after })) };
      if (!difference || !graph || !current() || graph.count !== difference.cells.length) return out;
      for (let node = 0; node < difference.cells.length; node += 1) {
        const delta = difference.cells[node];
        if (delta === 0 || (difference.excluded && difference.excluded[node])) continue;
        const floor = graph.floors[graph.nodeFloor[node]];
        const each = { floorId: floor.id, cell: graph.nodeCell[node], node, delta, strength: strengthOf(delta, difference.largest) };
        (delta > 0 ? out.busier : out.quieter).push(each);
      }
      return out;
    },
  };

  settle();
  return {
    update,
    // What the keyboard cursor's move should say when it is on a cell with a
    // card: the card's sentence, once; else null, and the lab says its own line.
    cursorWords() {
      const said = heard;
      heard = null;
      return said;
    },
  };
}
