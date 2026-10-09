// The Summary tab of the movement view's inspector (spec 7.6): the figures
// for what is on screen, a legend of the groups on screen, and route health.
//
//   summaryPanel(env) -> { element, update(state), focusHealth() }
//
// Route health is not about what is on screen: it looks at every group on
// every day type, and names each transition whose route failed, why, and
// where to put it right. It is worked out whenever the view has new results,
// which is as soon as it opens.
//
// `env` and `state` are described at the top of ./index.js.

import { h } from '../components/dom.js';
import { count } from '../components/words.js';
import { formatDuration } from '../../engine/findings.js';
import { periodName } from '../../engine/bells.js';
import { findDayType, ownDayTypes } from '../../engine/day-types.js';
import { floorOfRoom } from '../../engine/schema.js';
import { failureParts, groupRows, unitWord } from './model.js';

function parts(list) {
  return list.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

// Where a failed route is put right. A room that opens onto nothing, or that
// nothing leads to, is a matter for the building; a period with no room, or
// with a room that is not in the building, is one for the schedule.
export function fixFor(project, failure) {
  const route = failure.route;
  const floor = route.roomId ? floorOfRoom(project, route.roomId) : null;
  if ((route.reason === 'no-entry' || route.reason === 'unreachable') && floor) {
    return { label: 'Show the room', hash: '#building/' + floor.id + '?room=' + encodeURIComponent(route.roomId), slot: null };
  }
  return { label: 'Fix it in the schedule', hash: '#schedule/groups', slot: { groupId: failure.groupId, dayTypeId: failure.dayTypeId, period: failure.fixPeriod } };
}

export function summaryPanel(env) {
  const figures = h('dl', { class: 'mov-figures', data: { summary: 'figures' } });
  const groupsTitle = h('h3', { class: 'mov-panel__sub' }, 'Groups on screen');
  const groups = h('div', { class: 'mov-groups', data: { summary: 'groups' } });
  const healthTitle = h('h3', { class: 'mov-panel__sub', tabindex: '-1', id: 'movement-health' }, 'Route health');
  const healthLine = h('p', { class: 'mov-health__line', data: { summary: 'health-line' } });
  const health = h('ul', { class: 'mov-health', data: { summary: 'health' } });
  const element = h('div', { class: 'mov-panel', data: { panel: 'summary' } },
    h('h2', { class: 'mov-panel__title' }, 'Summary'),
    figures, groupsTitle, groups, healthTitle, healthLine, health);

  function figure(key, name, value, more) {
    return h('div', { class: 'mov-figure', data: { figure: key } },
      h('dt', null, name),
      h('dd', null, h('span', { class: 'mov-figure__value' }, value), more ? h('span', { class: 'mov-figure__more' }, more) : null));
  }

  function drawFigures(project, picture) {
    const settings = project.settings;
    const list = [];
    list.push(figure('routes', 'Routes drawn', String(picture.drawn), picture.same > 0 ? [count(picture.same, 'transition') + ' with no walk: the group stays in its room.'] : null));
    if (picture.busiest) {
      const b = picture.busiest;
      const where = b.place ? parts(b.place.parts) : ['A corridor'];
      const floor = b.floorName && b.place && b.place.kind !== 'connection' && b.place.name !== b.floorName ? [' on ', h('bdi', null, b.floorName)] : [];
      const when = b.period !== null && picture.load.measure === 'busiest' ? [', ' + periodName(settings, b.period) + ' to ' + periodName(settings, b.period + 1)] : [];
      list.push(figure('busiest', picture.load.measure === 'total' ? 'Highest total over the day' : 'Busiest load', b.load + ' ' + unitWord(b.unit, b.load), [...where, ...floor, ...when, '.']));
    } else {
      list.push(figure('busiest', 'Busiest load', 'None', picture.mode === 'empty' ? null : ['Nobody on screen crosses a corridor.']));
    }
    const late = new Map();
    for (const walk of picture.late) {
      if (!late.has(walk.groupId)) late.set(walk.groupId, []);
      late.get(walk.groupId).push(walk.period);
    }
    const lateWords = [];
    for (const [groupId, periods] of late) {
      const group = project.groups.find((each) => each.id === groupId);
      if (lateWords.length > 0) lateWords.push('; ');
      lateWords.push(h('bdi', null, group ? group.name : '?'), ': ' + periods.map((period) => periodName(settings, period) + ' to ' + periodName(settings, period + 1)).join(', '));
    }
    list.push(figure('late', 'Cannot make a transition in time', late.size === 0 ? 'None' : count(late.size, 'group'), late.size === 0 ? null : [...lateWords, '.']));
    list.push(figure('failed', 'Routes that failed', picture.failed.length === 0 ? 'None' : String(picture.failed.length), picture.failed.length === 0 ? null : ['Named under Route health, below.']));
    figures.replaceChildren(...list);
  }

  function drawGroups(project, results, picture) {
    const rows = groupRows(project, results, picture);
    groupsTitle.hidden = rows.length === 0;
    groups.hidden = rows.length === 0;
    if (rows.length === 0) return;
    groups.replaceChildren(h('table', { class: 'table mov-groups__table' },
      h('caption', { class: 'vh' }, 'The groups on screen, over the whole of ' + picture.dayTypeName),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Group'),
        h('th', { scope: 'col', class: 'table__num' }, 'Walking'),
        h('th', { scope: 'col', class: 'table__num' }, 'Lost to crowds'),
        h('th', { scope: 'col' }, 'Stairs'))),
      h('tbody', null, rows.map((row) => h('tr', { data: { group: row.group.id, failed: String(row.failed), late: String(row.late) } },
        h('th', { scope: 'row' },
          h('span', { class: 'mov-swatch', style: 'background:' + row.group.colour }), h('bdi', null, row.group.name),
          row.late > 0 ? h('span', { class: 'mov-groups__late' }, 'late ' + (row.late === 1 ? 'once' : row.late + ' times')) : null,
          row.failed > 0 ? h('span', { class: 'mov-groups__failed' }, count(row.failed, 'failed route')) : null),
        h('td', { class: 'table__num' }, formatDuration(row.walking)),
        h('td', { class: 'table__num' }, row.waiting === 0 ? 'none' : formatDuration(row.waiting)),
        h('td', null, row.stairs ? 'Yes' : 'No'))))));
  }

  function drawHealth(project, list) {
    const days = ownDayTypes(project).length;
    health.hidden = list.length === 0;
    if (list.length === 0) {
      healthLine.textContent = project.groups.length === 0
        ? 'There are no groups to check yet.'
        : 'Every route was found: ' + count(project.groups.length, 'group') + ' on ' + count(days, 'day type') + '.';
      health.replaceChildren();
      return;
    }
    healthLine.textContent = count(list.length, 'route') + ' failed, of every group on ' + (days === 1 ? 'the one day type' : 'all ' + days + ' day types') + '. Each is a transition nobody can be drawn walking.';
    health.replaceChildren(...list.map((failure) => {
      const fix = fixFor(project, failure);
      const dayType = findDayType(project, failure.dayTypeId);
      return h('li', { class: 'mov-health__item', data: { group: failure.groupId, day: failure.dayTypeId, period: String(failure.period), reason: failure.route.reason } },
        h('p', { class: 'mov-health__text' }, parts(failureParts(project, failure, Boolean(dayType))), '.'),
        h('button', { type: 'button', class: 'mov-link', data: { action: 'fix' }, on: { click: () => env.fix(fix) } }, fix.label));
    }));
  }

  return {
    element,
    update(state) {
      drawFigures(state.project, state.picture);
      drawGroups(state.project, state.results, state.picture);
      drawHealth(state.project, state.health);
    },
    focusHealth() {
      healthTitle.scrollIntoView({ block: 'start' });
      const first = health.querySelector('button');
      (first || healthTitle).focus();
    },
  };
}
