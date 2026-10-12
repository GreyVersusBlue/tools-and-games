// The Travel time tab of the movement view's inspector (spec 8.3): how long
// each group walks and waits, as two tables, slowest first.
//
//   one transition   each group's walking time, waiting time, total, and
//                    whether it fits the passing time
//   the whole day    the same added up for each group, with how many of its
//                    walks are late
//
// Every figure is the crowd model's, read from the walk results the checks
// read (results.walks.groups, engine/crowd.js walkResults), so "late" here is
// the same rule as the walk-time check. The model walks every group of the
// school whatever the map shows; the tables list every group for the day
// type on the map. The transition is the one chosen on the map, or, with the
// whole day on the map, the one holding the day's slowest walk until another
// is picked here.
//
//   tablesPanel(env) -> { element, update(state) }
//
// `env` and `state` are described at the top of ./index.js.
//
// The rows, as plain data for the screen, the prints and the CSV files:
//
//   transitionRows(project, results, dayTypeId, period)
//     -> { rows, still, failed }
//     rows    [{ group, period, from, to, passingSeconds, walking, waiting, total, late, arrived, over }]
//             slowest first; `from` and `to` are the rooms' numbers as typed;
//             `over` is by how many seconds a late walk misses
//     still   the groups that stay in their room; failed  the groups with no route
//   dayRows(project, results, dayTypeId)
//     -> [{ group, walks, walking, waiting, total, late, lost, slowest }]
//     slowest first by total; `lost` counts walks that did not arrive at all;
//     `slowest` is the group's slowest walk, a row as above
//   slowestPeriod(results, dayTypeId)   the transition holding the slowest walk, or null
//   lateWords(row)                      "In time", "Late by 21 s", "Did not arrive"
//   transitionsCsv(project, results, dayTypeId, dayTypeName), dayCsv(...)   rows of cells for engine/csv.js

import { h, uid } from '../components/dom.js';
import { count } from '../components/words.js';
import { formatDuration } from '../../engine/findings.js';
import { periodName } from '../../engine/bells.js';
import { parse } from '../colour.js';
import { transitionsOf } from './model.js';

function roomNumbers(project) {
  const numbers = new Map();
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) if (space.kind === 'room') numbers.set(space.id, typeof space.number === 'string' ? space.number : '');
  }
  return numbers;
}

function walksOf(results, dayTypeId) {
  const list = results && results.walks && Array.isArray(results.walks.groups) ? results.walks.groups : [];
  return list.filter((walk) => walk.dayTypeId === dayTypeId);
}

function rowOf(project, walk, group, numbers) {
  const margin = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
  return {
    group,
    period: walk.period,
    from: numbers.get(walk.fromRoomId) || '',
    to: numbers.get(walk.toRoomId) || '',
    passingSeconds: walk.passingSeconds,
    walking: walk.walking,
    waiting: walk.waiting,
    total: walk.total,
    late: walk.late === true,
    arrived: walk.arrived !== false,
    over: walk.late === true ? Math.max(0, walk.total - walk.passingSeconds - margin) : 0,
  };
}

function slowestFirst(order) {
  return (a, b) => b.total - a.total || b.waiting - a.waiting || order.get(a.group.id) - order.get(b.group.id) || (a.period || 0) - (b.period || 0);
}

export function transitionRows(project, results, dayTypeId, period) {
  const numbers = roomNumbers(project);
  const groups = new Map(project.groups.map((group) => [group.id, group]));
  const order = new Map(project.groups.map((group, index) => [group.id, index]));
  const rows = walksOf(results, dayTypeId)
    .filter((walk) => walk.period === period && groups.has(walk.groupId))
    .map((walk) => rowOf(project, walk, groups.get(walk.groupId), numbers))
    .sort(slowestFirst(order));
  const still = [];
  const failed = [];
  const day = results && results.routes && Array.isArray(results.routes.days) ? results.routes.days.find((each) => each.dayTypeId === dayTypeId) : null;
  for (const entry of day ? day.groups : []) {
    const group = groups.get(entry.groupId);
    const route = entry.routes[period];
    if (!group || !route) continue;
    if (route.ok !== true) failed.push(group);
    else if (route.same === true) still.push(group);
  }
  return { rows, still, failed };
}

export function dayRows(project, results, dayTypeId) {
  const numbers = roomNumbers(project);
  const order = new Map(project.groups.map((group, index) => [group.id, index]));
  const walks = walksOf(results, dayTypeId);
  const rows = [];
  for (const group of project.groups) {
    const mine = walks.filter((walk) => walk.groupId === group.id).map((walk) => rowOf(project, walk, group, numbers));
    if (mine.length === 0) continue;
    const row = { group, walks: mine.length, walking: 0, waiting: 0, total: 0, late: 0, lost: 0, slowest: null };
    for (const walk of mine) {
      row.walking += walk.walking;
      row.waiting += walk.waiting;
      row.total += walk.total;
      if (walk.late) row.late += 1;
      if (!walk.arrived) row.lost += 1;
      if (!row.slowest || walk.total > row.slowest.total) row.slowest = walk;
    }
    rows.push(row);
  }
  return rows.sort(slowestFirst(order));
}

export function slowestPeriod(results, dayTypeId) {
  let best = null;
  for (const walk of walksOf(results, dayTypeId)) {
    if (!best || walk.total > best.total || (walk.total === best.total && walk.period < best.period)) best = walk;
  }
  return best ? best.period : null;
}

export function lateWords(row) {
  if (!row.arrived) return 'Did not arrive';
  return row.late ? 'Late by ' + formatDuration(row.over) : 'In time';
}

function transitionName(settings, period) {
  return periodName(settings, period) + ' to ' + periodName(settings, period + 1);
}

// Every walk of the day, transition by transition, slowest first in each.
export function transitionsCsv(project, results, dayTypeId, dayTypeName) {
  const table = [['Day type', 'Transition', 'Passing time (seconds)', 'Group', 'From room', 'To room', 'Walking (seconds)', 'Waiting (seconds)', 'Total (seconds)', 'Late', 'Late by (seconds)']];
  for (let period = 0; period + 1 < project.settings.periods; period += 1) {
    for (const row of transitionRows(project, results, dayTypeId, period).rows) {
      table.push([dayTypeName, transitionName(project.settings, period), row.passingSeconds, row.group.name, row.from, row.to, row.walking, row.waiting, row.total, !row.arrived ? 'did not arrive' : row.late ? 'late' : 'in time', row.late ? row.over : '']);
    }
  }
  return table;
}

export function dayCsv(project, results, dayTypeId, dayTypeName) {
  const table = [['Day type', 'Group', 'Walks', 'Walking (seconds)', 'Waiting (seconds)', 'Total (seconds)', 'Late walks', 'Slowest walk', 'Slowest walk (seconds)']];
  for (const row of dayRows(project, results, dayTypeId)) {
    table.push([dayTypeName, row.group.name, row.walks, row.walking, row.waiting, row.total, row.late, transitionName(project.settings, row.slowest.period), row.slowest.total]);
  }
  return table;
}

function swatch(group) {
  return h('span', { class: 'mov-swatch', style: parse(group.colour) ? 'background:' + group.colour : null });
}

function names(groups) {
  return groups.flatMap((group, index) => [index === 0 ? null : index === groups.length - 1 ? ' and ' : ', ', h('bdi', null, group.name)]);
}

// A travel-time table. A group takes two lines: who, where and whether it
// fits, across the table; then its three times under their headings. Each
// group is a row group of its own, and each time names both its headings.
//   entries   [{ row: { group, walking, waiting, total, late }, who: [nodes after the name] }]
function travelTable(caption, entries) {
  const base = uid('travel');
  const heads = ['Walking', 'Waiting', 'Total'].map((label, index) => h('th', { scope: 'col', class: 'table__num', id: base + '-c' + index }, label));
  return h('table', { class: 'table mov-travel__table' },
    h('caption', { class: 'vh' }, caption),
    h('thead', null, h('tr', null, heads)),
    entries.map((entry, index) => {
      const row = entry.row;
      const id = base + '-g' + index;
      const cell = (column, text) => h('td', { class: 'table__num', headers: id + ' ' + base + '-c' + column }, text);
      return h('tbody', { class: 'mov-travel__group', data: { group: row.group.id, total: String(row.total), late: String(row.late) } },
        h('tr', null, h('th', { scope: 'rowgroup', colspan: '3', id }, swatch(row.group), h('bdi', { class: 'mov-travel__name' }, row.group.name), entry.who)),
        h('tr', null, cell(0, formatDuration(row.walking)), cell(1, row.waiting === 0 ? 'none' : formatDuration(row.waiting)), cell(2, formatDuration(row.total))));
    }));
}

export function tablesPanel(env) {
  const pickId = uid('travel-pick');
  const pick = h('select', { class: 'field__input mov-ctl__select mov-travel__pick', id: pickId, data: { travel: 'pick' } });
  const lead = h('p', { class: 'mov-travel__lead', data: { travel: 'lead' } });
  const oneTitle = h('h3', { class: 'mov-panel__sub', data: { travel: 'transition-title' } }, 'One transition');
  const oneLine = h('p', { class: 'mov-panel__note', data: { travel: 'transition-line' } });
  const one = h('div', { class: 'mov-travel', data: { travel: 'transition' } });
  const oneRest = h('p', { class: 'mov-panel__note', data: { travel: 'transition-rest' } });
  const dayTitle = h('h3', { class: 'mov-panel__sub', data: { travel: 'day-title' } }, 'The whole day');
  const day = h('div', { class: 'mov-travel', data: { travel: 'day' } });
  const picker = h('div', { class: 'mov-travel__choose' }, h('label', { class: 'mov-ctl__label', for: pickId }, 'Transition'), pick);
  const tables = h('div', { class: 'mov-travel__tables' }, oneTitle, picker, oneLine, one, oneRest, dayTitle, day);
  const element = h('div', { class: 'mov-panel', data: { panel: 'tables' } },
    h('h2', { class: 'mov-panel__title' }, 'Travel time'),
    lead, tables);

  let last = null;
  // the transition picked here; null follows the map
  let picked = null;
  let mapTransition = null;
  let pickKey = '';

  function draw(state) {
    const project = state.project;
    const picture = state.picture;
    const results = state.results;
    const transitions = transitionsOf(project, picture.choice.dayTypeId);
    const any = walksOf(results, picture.dayTypeId).length > 0;
    tables.hidden = !any;
    if (!results) {
      lead.textContent = 'Working out the routes.';
      return;
    }
    if (!any) {
      lead.replaceChildren('Nobody walks anywhere on ', h('bdi', null, picture.dayTypeName), ' yet: give a group a room in two periods that follow each other.');
      return;
    }
    lead.replaceChildren('How long every group takes on ', h('bdi', null, picture.dayTypeName), ', slowest first. Walking is the time in an empty corridor; waiting is the time lost to the crowd. The figures do not depend on which groups the map shows.');

    // the map's transition leads; with the whole day on the map, the one picked here, else the slowest
    if (picture.choice.transition !== mapTransition) {
      mapTransition = picture.choice.transition;
      picked = null;
    }
    if (picked !== null && !transitions[picked]) picked = null;
    const slowest = slowestPeriod(results, picture.dayTypeId);
    const period = mapTransition !== null ? mapTransition : picked !== null ? picked : slowest !== null ? slowest : 0;

    const nextKey = JSON.stringify(transitions.map((each) => [each.name, each.times]));
    if (nextKey !== pickKey) {
      pickKey = nextKey;
      pick.replaceChildren(...transitions.map((each) => h('option', { value: String(each.period) }, each.name + (each.times ? ' (' + each.times + ')' : ''))));
    }
    pick.value = String(period);

    const found = transitionRows(project, results, picture.dayTypeId, period);
    const transition = transitions[period];
    const margin = project.settings.checks ? project.settings.checks.passingMarginSeconds : 0;
    oneLine.textContent = transition
      ? 'Passing time ' + formatDuration(transition.seconds) + (margin > 0 ? ', and ' + formatDuration(margin) + ' of margin before a walk counts as late.' : '.')
        + (mapTransition === null && picked === null && period === slowest ? ' This transition holds the day\'s slowest walk.' : '')
      : '';
    one.dataset.period = String(period);
    one.replaceChildren(found.rows.length === 0
      ? h('p', { class: 'mov-panel__note' }, 'Nobody walks in this transition.')
      : travelTable('Each group\'s walk in ' + (transition ? transition.name : 'this transition') + ', slowest first', found.rows.map((row) => ({
        row,
        who: [
          h('span', { class: 'mov-travel__rooms' }, h('bdi', null, row.from === '' ? 'no number' : row.from), ' to ', h('bdi', null, row.to === '' ? 'no number' : row.to)),
          h('span', { class: row.late ? 'mov-groups__late' : 'mov-travel__fits', data: { fits: String(!row.late) } }, lateWords(row)),
        ],
      }))));
    const rest = [];
    if (found.still.length > 0) rest.push(...names(found.still), found.still.length === 1 ? ' stays in its room.' : ' stay in their rooms.');
    if (found.failed.length > 0) rest.push(rest.length > 0 ? ' ' : null, ...names(found.failed), found.failed.length === 1 ? ' has no route: see Summary.' : ' have no route: see Summary.');
    oneRest.replaceChildren(...rest);
    oneRest.hidden = rest.length === 0;

    day.replaceChildren(travelTable('Each group over the whole of ' + picture.dayTypeName + ', slowest first', dayRows(project, results, picture.dayTypeId).map((row) => ({
      row,
      who: [
        h('span', { class: 'mov-travel__rooms' }, count(row.walks, 'walk') + ', the slowest ' + formatDuration(row.slowest.total)),
        row.late > 0 ? h('span', { class: 'mov-groups__late' }, 'late ' + (row.late === 1 ? 'once' : row.late + ' times')) : null,
      ],
    }))));
  }

  pick.addEventListener('change', () => {
    const period = Number(pick.value);
    // with one transition on the map, the map is what is changed; otherwise only this table
    if (mapTransition !== null) env.change({ transition: period });
    else {
      picked = period;
      if (last) draw(last);
    }
  });

  return {
    element,
    update(state) {
      last = state;
      draw(state);
    },
  };
}
