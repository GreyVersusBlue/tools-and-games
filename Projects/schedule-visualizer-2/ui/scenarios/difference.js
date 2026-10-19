// The scenario lab's difference map (spec 9.2; DESIGN 5.4; ARCHITECTURE 6.6
// "The difference map"): the lab's plan map painted with how each corridor
// cell's load changes when the open scenario is applied, the card of a cell,
// and the text alternative, a table of the ten largest changes in the
// inspector beside the comparison. The painting is
// ui/surface/overlays/difference.js; this is what feeds it.
//
//   mountDifference({ ctx, store, plan, memory, lane, inspector }) -> { update() }
//   whenWords, sidesWords, cardText: the card's words (below)
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
// answer's result. Both carry their `loads` whole through trimResult. With
// no answer the map is not painted. While a newer answer is worked out the
// last one stays painted and the section's data-difference reads 'old'.
//
// The card (on hover, on a tap, at the keyboard cursor) gives a walkable
// cell's place, its change in words, its load before and after, and the
// groups that walk there only before or only after. Only a group the
// scenario edits can walk anywhere else: their walks are routed for the
// card, for the real schedule and for the scenario, by the engine's own
// routesForSchedule, and engine/load.js's contributors says who crosses.
//
// The test handle is document.querySelector('.scn').difference.

import { h } from '../components/dom.js';
import { slotAt } from '../surface/plan-layout.js';
import { differenceOverlay, differenceOf, differenceWords, rankPlaces, apartGroups, strengthOf, DIFFERENCE_ALPHA, DIFFERENCE_TOP } from '../surface/overlays/difference.js';
import { applyChanges, editedGroupIds } from '../../engine/scenario.js';
import { routesForSchedule, routingGraph, createRouteCache } from '../../engine/routing.js';
import { contributors } from '../../engine/load.js';
import { buildGraph } from '../../engine/graph.js';
import { periodName } from '../../engine/bells.js';
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
//   whenWords(project, transition, dayTypeId)
//     "at its busiest in one transition, on A Day" for the whole day,
//     "in Period 2 to Period 3, on A Day" for one transition
//   sidesWords(info)   "Before 12, after 26 students, <when>."
//   cardText(info)     the card as one sentence, for the live region:
//     "<place>, <floor>: 14 busier. Before 12, after 26 students, <when>.
//      Walk here only before: 7A. Walk here only after: 8B."
//   info: { parts, floorName, words, before, after, unit, when, excluded,
//           groups: { onlyBefore, onlyAfter } (groups, by name as typed) or null }
export function whenWords(project, transition, dayTypeId) {
  const day = project.dayTypes.find((each) => each.id === dayTypeId);
  const on = day ? ', on ' + day.name : '';
  if (transition === null) return 'at its busiest in one transition' + on;
  return 'in ' + periodName(project.settings, transition) + ' to ' + periodName(project.settings, transition + 1) + on;
}

export function sidesWords(info) {
  return 'Before ' + info.before + ', after ' + info.after + ' ' + unitWord(info.unit, info.after) + ', ' + info.when + '.';
}

function namesText(groups) {
  return groups.map((group) => group.name).join(', ');
}

export function cardText(info) {
  let text = partsToText(info.parts) + ', ' + info.floorName + ': ' + info.words + '. ' + sidesWords(info);
  if (info.excluded) text += ' In an exclusion zone.';
  if (info.groups && info.groups.onlyBefore.length > 0) text += ' Walk here only before: ' + namesText(info.groups.onlyBefore) + '.';
  if (info.groups && info.groups.onlyAfter.length > 0) text += ' Walk here only after: ' + namesText(info.groups.onlyAfter) + '.';
  return text;
}

// a swatch of the tint at a strength, in the theme on screen (the tokens
// follow the theme, so the swatch does too)
function swatch(kind, strength) {
  const share = Math.round(DIFFERENCE_ALPHA[strength - 1] * 100);
  return h('span', { class: 'mov-swatch', 'aria-hidden': 'true', style: 'background:color-mix(in srgb, var(--' + kind + ') ' + share + '%, var(--corridor))' });
}

export function mountDifference({ ctx, store, plan, memory, lane, inspector }) {
  const element = plan.root;
  // what is painted: the answer it is from, the before it is compared
  // with, and the difference worked out for the lab's choice
  const held = { answer: null, before: null, key: null, difference: null, ranked: { rows: [], changed: 0 }, graph: null, project: null };
  // the painter's last paint, for the tests: which picture it painted
  // (data-difference-made when it painted) and in which theme
  const painted = { count: 0, theme: null, made: null };
  const draw = differenceOverlay(() => (held.difference ? { difference: held.difference, graph: held.graph } : null));
  plan.overlays.push((g, view, floor, theme) => {
    if (!held.difference) return;
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
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Place'), h('th', { scope: 'col' }, 'Floor'), h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'After'), h('th', { scope: 'col' }, 'Change'))),
    tableBody);
  const note = h('p', { class: 'scn-compare__note', data: { part: 'difference-note' } });
  const section = h('section', { class: 'scn-difference-block', 'aria-labelledby': 'scenario-difference-title', data: { part: 'difference' }, hidden: true }, title, key, table, note);

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

  function drawTable() {
    place();
    const difference = held.difference;
    const project = held.project;
    if (!difference || !project) {
      section.hidden = true;
      tableBody.replaceChildren();
      return;
    }
    section.hidden = false;
    const unit = difference.unit;
    title.textContent = difference.transition === null
      ? 'Corridors that change most over the day'
      : 'Corridors that change most in ' + periodName(project.settings, difference.transition) + ' to ' + periodName(project.settings, difference.transition + 1);
    key.replaceChildren('On the map: busier ', swatch('problem', 3), ', quieter ', swatch('accent', 3), '. ',
      difference.largest > 0 ? 'The stronger the colour, the larger the change; the largest is ' + difference.largest + ' ' + unitWord(unit, difference.largest) + '. A place with no change is not coloured.' : 'Nothing on the map changes.');
    const several = difference.dayTypeIds.length > 1;
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
    note.textContent = held.ranked.changed === 0
      ? (difference.transition === null ? 'No corridor gets busier or quieter over the day.' : 'No corridor gets busier or quieter in this transition.')
      : more > 0 ? (more === 1 ? '1 other place changes less.' : more + ' other places change less.') : '';
    note.hidden = note.textContent === '';
  }

  // ---- working out the picture
  function stateOf() {
    if (!held.answer) return 'none';
    if (!held.difference) return 'waiting';
    return lane.pending ? 'old' : 'shown';
  }

  function settle() {
    element.dataset.difference = stateOf();
  }

  function compute() {
    const answer = held.answer;
    if (!answer || !held.before) return;
    const next = [answer, held.before, memory.dayTypeId, memory.transition];
    if (held.key && next.every((each, i) => each === held.key[i])) return;
    held.key = next;
    held.project = store.project;
    held.graph = store.derived.get('graph', ['building'], (project) => buildGraph(project));
    held.difference = differenceOf(held.before.loads, answer.result.loads, { dayTypeId: memory.dayTypeId, transition: memory.transition, measure: 'busiest' });
    held.ranked = held.difference ? rankPlaces(held.difference, answer.result.places, DIFFERENCE_TOP) : { rows: [], changed: 0 };
    element.dataset.differenceMade = String(Number(element.dataset.differenceMade || 0) + 1);
    drawTable();
    refreshCard();
    plan.paint();
  }

  function clear() {
    held.answer = null;
    held.before = null;
    held.key = null;
    held.difference = null;
    held.ranked = { rows: [], changed: 0 };
    hideCard();
    drawTable();
    plan.paint();
  }

  function update() {
    const answer = lane.answer;
    if (!answer || !answer.result) {
      if (held.answer || held.difference) clear();
      settle();
      return;
    }
    if (answer !== held.answer) {
      held.answer = answer;
      held.before = null;
      const asked = answer;
      if (!store.derived || typeof store.derived.results !== 'function') {
        settle();
        return;
      }
      store.derived.results().then((main) => {
        if (held.answer !== asked) return;
        // the store has moved on: a newer answer is on its way, and the
        // last picture stays until it comes
        if (!main || !sameVersions(main.versions, asked.versions)) return;
        held.before = main;
        compute();
        settle();
      }, () => {});
    }
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

  // the walks of the edited groups, for the real schedule and the scenario,
  // worked out once an answer and day type
  const walks = new Map();
  function walksOf(answer, project, graph) {
    const key = answer;
    if (walks.has(key)) return walks.get(key);
    walks.clear();
    const edited = new Set(editedGroupIds(answer.changes || []));
    let found = null;
    if (edited.size > 0) {
      const after = applyChanges(project, answer.changes);
      const only = (whole) => ({ ...whole, groups: whole.groups.filter((group) => edited.has(group.id)) });
      const routing = routingGraph(project, graph);
      const options = { cache, geometryVersion: store.geometryVersion };
      found = { before: { project, routes: routesForSchedule(only(project), routing, options) }, after: { project: after, routes: routesForSchedule(only(after), routing, options) } };
    }
    walks.set(key, found);
    return found;
  }

  // who walks over this node only before, and only after
  function groupsApart(node, dayTypeId) {
    const answer = held.answer;
    const project = held.project;
    if (!answer || !project || !sameVersions(answer.versions, { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion })) return null;
    const found = walksOf(answer, project, held.graph);
    if (!found) return { onlyBefore: [], onlyAfter: [] };
    const options = held.difference.transition === null ? undefined : { period: held.difference.transition };
    const who = (side) => contributors(side.project, side.routes, dayTypeId, { nodes: [node] }, held.graph, options).map((each) => each.groupId);
    const apart = apartGroups(who(found.before), who(found.after));
    const named = (ids) => ids.map((id) => project.groups.find((group) => group.id === id)).filter(Boolean);
    return { onlyBefore: named(apart.onlyBefore), onlyAfter: named(apart.onlyAfter) };
  }

  // what the card says of a cell, or null where there is nothing to say
  function cardOf(floorId, cell) {
    const difference = held.difference;
    const graph = held.graph;
    const project = held.project;
    if (!difference || !graph || !project || graph.count !== difference.cells.length) return null;
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
      delta,
      words: differenceWords(delta),
      strength: strengthOf(delta, difference.largest),
      before: difference.before.cells[node],
      after: difference.after.cells[node],
      unit: difference.unit,
      when: whenWords(project, difference.transition, dayTypeId),
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
    cardBefore.replaceChildren(...(groups.onlyBefore.length > 0 ? namesNodes('Walk here only before: ', groups.onlyBefore) : []));
    cardAfter.hidden = groups.onlyAfter.length === 0;
    cardAfter.replaceChildren(...(groups.onlyAfter.length > 0 ? namesNodes('Walk here only after: ', groups.onlyAfter) : []));
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

  plan.onCell((ev) => {
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
      // the lab has said what is under the cursor; on a walkable cell this says more
      // the lab's own line about the cell is said first (its handler runs
      // after this one), so this one goes after it
      const { info } = pointAt(ev.x, ev.y, 'keyboard');
      if (info) queueMicrotask(() => ctx.announce(cardText(info)));
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
    cardOf,
    cardText,
    // what is painted, cell by cell, read from the picture rather than the pixels
    state() {
      const difference = held.difference;
      const graph = held.graph;
      const out = { state: stateOf(), answer: held.answer, dayTypeId: memory.dayTypeId, transition: memory.transition, largest: difference ? difference.largest : 0, busier: [], quieter: [], top: held.ranked.rows.map((row) => ({ placeId: row.placeId, delta: row.delta, before: row.before, after: row.after })) };
      if (!difference || !graph || graph.count !== difference.cells.length) return out;
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
  return { update };
}
