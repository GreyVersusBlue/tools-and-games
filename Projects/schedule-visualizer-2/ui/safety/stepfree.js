// The Step-free parts of the Safety inspector (spec 10.1, 11; DESIGN 13.6).
//
//   stepFreeWaysPanel(env) -> { element, update() }
//     what the Exits tab holds while the view is Step-free: the rooms listed by
//     how they leave, "To an exit (41)", "To an area of refuge (12)", "No
//     step-free way out (3)", each row with where it goes or its reason, and
//     Show; then the areas of refuge, each with "Used by 12 rooms." or "Not used by any room.".
//     With nothing step-free marked it
//     opens with the sentence that says so and a button to Building
//   stepFreeReportPanel(env) -> { element, update() }
//     the Step-free tab: the report (engine/step-free.js), by floor, each room
//     with its reason and Show; the step-free groups scheduled into those rooms,
//     by day type and period; the line that keeps reaching apart from leaving; and
//     Print, which opens the `step-free` output as a sheet
//     env   { ctx, step() (./model.js's stepFreePicture, or null), project(), picked(),
//             swatch(number), themeKey(), pick(roomId), home() (puts the focus on the map) }
//
// Every name is set as text. A control that held the focus when its panel is drawn
// again gets it back on the same room's control, or the next one, or the map.

import { h } from '../components/dom.js';
import { openPrintPreview } from '../components/print-preview.js';
import { count } from '../components/words.js';
import { nameOfRoom } from '../../engine/schema.js';
import { periodName } from '../../engine/bells.js';
import { formatDuration } from '../../engine/findings.js';
import { UNMARKED_SAYS, TWO_VIEWS_SAYS, ALL_REACHED_SAYS, EVACUATION_NO_ELEVATORS } from './ways.js';

function upper(text) {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

// A control of a room's row that had the focus, put back after the panel is drawn again.
function holdFocus(element, selector) {
  const active = element.contains(document.activeElement) ? document.activeElement : null;
  if (!active || !active.matches(selector)) return () => {};
  const room = active.dataset.room;
  const all = Array.from(element.querySelectorAll(selector));
  const at = all.indexOf(active);
  return (home) => {
    const again = element.querySelector(selector + '[data-room="' + CSS.escape(room) + '"]');
    if (again) again.focus();
    else {
      const now = element.querySelectorAll(selector);
      if (now.length > 0) now[Math.min(Math.max(at, 0), now.length - 1)].focus();
      else home();
    }
  };
}

function unmarked(env) {
  return h('div', { class: 'sfy-unmarked', data: { line: 'unmarked' } },
    h('p', { class: 'sfy-panel__lead' }, UNMARKED_SAYS),
    h('button', { type: 'button', class: 'btn', data: { action: 'to-building' }, on: { click: () => env.ctx.navigate('#building') } }, 'Go to Building'));
}

function showButton(env, roomId, name) {
  return h('button', { type: 'button', class: 'mov-link sfy-row__show', data: { action: 'show', room: roomId }, on: { click: () => env.pick(roomId) } }, 'Show', h('span', { class: 'vh' }, ' ', name, ' on the map'));
}

export function stepFreeWaysPanel(env) {
  const element = h('div', { class: 'mov-panel sfy-panel sfy-stepfree', data: { panel: 'ways' } });
  let drawnFor = null;
  let drawnTheme = null;

  function row(room) {
    const where = room.way === 'exit'
      ? [h('span', { class: 'sfy-swatch sfy-swatch--small', style: env.swatch(room.exitNumber), 'aria-hidden': 'true' }, String(room.exitNumber)), ' ', h('bdi', null, room.exitName), ' · ' + formatDuration(room.seconds)]
      : room.way === 'refuge' ? [h('bdi', null, room.refugeName), ' · ' + formatDuration(room.seconds) + ', then wait for help'] : [upper(room.why)];
    return h('li', { class: 'sfy-row sfy-way', data: { room: room.roomId, way: room.way, reason: room.reason || '' } },
      h('div', { class: 'sfy-row__head' },
        h('span', { class: 'sfy-row__name' }, h('bdi', null, room.name), ' ', h('span', { class: 'sfy-row__floor' }, '(', h('bdi', null, room.floorName), ')')),
        showButton(env, room.roomId, room.name)),
      h('p', { class: 'sfy-row__way', dir: 'auto' }, ...where));
  }

  function update() {
    const step = env.step();
    if (!step) return;
    if (drawnFor === step && drawnTheme === env.themeKey()) return;
    const restore = holdFocus(element, '.sfy-row__show');
    drawnFor = step;
    drawnTheme = env.themeKey();
    const groups = [['exit', 'To an exit'], ['refuge', 'To an area of refuge'], ['none', 'No step-free way out']];
    const sections = [];
    for (const [way, title] of groups) {
      const rooms = step.rooms.filter((room) => room.way === way);
      const id = 'sfy-ways-' + way;
      sections.push(h('section', { class: 'sfy-ways', data: { ways: way, count: String(rooms.length) } },
        h('h3', { class: 'mov-panel__sub', id }, title + ' (' + rooms.length + ')'),
        rooms.length === 0 ? h('p', { class: 'sfy-missing__none' }, way === 'none' ? 'Every room has a step-free way out.' : 'No room.') : h('ul', { class: 'sfy-rows', 'aria-labelledby': id }, rooms.map(row))));
    }
    const refuges = step.refuges.length === 0
      ? [h('p', { class: 'sfy-missing__none' }, 'No area of refuge is marked. Make one from the context menu on a corridor or stairs cell in Building.')]
      : [h('ul', { class: 'sfy-refuges', 'aria-label': 'Areas of refuge' }, step.refuges.map((refuge) => h('li', { class: 'sfy-refuge', data: { refuge: refuge.refugeId, used: String(refuge.roomIds.length) } },
        h('h4', { class: 'sfy-refuge__name' }, h('bdi', null, refuge.name), ' ', h('span', { class: 'sfy-row__floor' }, '(', h('bdi', null, refuge.floorName), refuge.by ? ', by ' + refuge.by : '', ')')),
        h('p', { class: 'sfy-refuge__use' }, refuge.use))))];
    element.replaceChildren(
      h('h2', { class: 'mov-panel__title' }, 'Step-free ways out'),
      step.report.marked ? null : unmarked(env),
      h('p', { class: 'sfy-panel__lead' }, 'Each room goes out by the step-free exit it reaches soonest, or waits at an area of refuge when it can reach none. ' + EVACUATION_NO_ELEVATORS),
      ...sections,
      h('h3', { class: 'mov-panel__sub', id: 'sfy-refuges' }, 'Areas of refuge'),
      ...refuges);
    restore(env.home);
  }

  return { element, update };
}

export function stepFreeReportPanel(env) {
  const element = h('div', { class: 'mov-panel sfy-panel sfy-report', data: { panel: 'stepfree' } });
  let drawnFor = null;
  const printButton = h('button', { type: 'button', class: 'btn btn--primary', data: { print: 'step-free' }, on: { click: (event) => openPrintPreview(env.ctx, 'step-free', { opener: event.currentTarget }) } }, 'Print');

  function update() {
    const step = env.step();
    if (!step) return;
    if (drawnFor === step) return;
    drawnFor = step;
    const restore = holdFocus(element, '.sfy-row__show');
    const project = env.project();
    const report = step.report;
    const floors = project.building.floors;
    const rooms = new Map();
    for (const floor of floors) for (const space of floor.spaces) if (space.kind === 'room') rooms.set(space.id, space);
    const parts = [];
    if (report.line) parts.push(h('p', { class: 'sfy-panel__lead', data: { line: 'no-exit' } }, report.line));
    parts.push(h('h3', { class: 'mov-panel__sub', id: 'sfy-unreached' }, 'Rooms that cannot be reached without stairs'));
    if (report.rooms.length === 0) {
      parts.push(h('p', { class: 'sfy-missing__none', data: { line: 'none' } }, ALL_REACHED_SAYS));
    } else {
      for (const floor of floors) {
        const here = report.rooms.filter((entry) => entry.floorId === floor.id);
        if (here.length === 0) continue;
        parts.push(h('section', { class: 'sfy-floor-report', data: { floor: floor.id } },
          h('h4', { class: 'sfy-floor__name' }, h('bdi', null, floor.name), ' ', h('span', { class: 'sfy-row__floor' }, '(' + here.length + ')')),
          h('ul', { class: 'sfy-rows' }, here.map((entry) => {
            const name = nameOfRoom(rooms.get(entry.roomId), true);
            return h('li', { class: 'sfy-row', data: { room: entry.roomId, reason: entry.reason } },
              h('div', { class: 'sfy-row__head' }, h('span', { class: 'sfy-row__name' }, h('bdi', null, name)), showButton(env, entry.roomId, name)),
              h('p', { class: 'sfy-row__way', dir: 'auto' }, upper(entry.why)));
          }))));
      }
    }
    if (report.groups.length > 0) {
      const dayTypes = new Map();
      for (const entry of report.groups) {
        if (!dayTypes.has(entry.dayTypeId)) dayTypes.set(entry.dayTypeId, []);
        dayTypes.get(entry.dayTypeId).push(entry);
      }
      const names = new Map((project.dayTypes || []).map((dayType) => [dayType.id, dayType.name]));
      const groupNames = new Map((project.groups || []).map((group) => [group.id, group.name]));
      parts.push(h('h3', { class: 'mov-panel__sub', id: 'sfy-groups' }, 'Step-free groups in these rooms'));
      for (const [dayTypeId, entries] of dayTypes) {
        parts.push(h('section', { class: 'sfy-day', data: { dayType: dayTypeId } },
          dayTypes.size > 1 ? h('h4', { class: 'sfy-floor__name' }, h('bdi', null, names.get(dayTypeId) || '')) : null,
          h('ul', { class: 'sfy-rows' }, entries.map((entry) => h('li', { class: 'sfy-row sfy-group', data: { period: String(entry.period) } },
            h('p', { class: 'sfy-row__way' }, h('strong', null, periodName(project.settings, entry.period)), ': ',
              ...entry.entries.flatMap((each, i) => [i > 0 ? '; ' : '', h('bdi', null, groupNames.get(each.groupId) || 'A group'), ' in ', h('bdi', null, nameOfRoom(rooms.get(each.roomId), true))])))))));
      }
    }
    element.replaceChildren(
      h('h2', { class: 'mov-panel__title' }, 'Step-free'),
      report.marked ? null : unmarked(env),
      ...parts,
      h('p', { class: 'sfy-panel__lead sfy-views', data: { line: 'views' } }, TWO_VIEWS_SAYS),
      h('div', { class: 'sfy-cards__print' }, printButton));
    restore(env.home);
  }

  return { element, update };
}
