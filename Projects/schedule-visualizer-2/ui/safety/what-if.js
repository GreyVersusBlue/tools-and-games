// The What if tab of the Safety inspector (spec 10.1 "what if this exit or stair is
// blocked?"; DESIGN 14.3, 14.4, 14.7): tick what cannot be used, and see how every
// room gets out without it. A trial: view state, never saved, never in undo.
//
//   whatIfPanel(env) -> { element, update() }
//     env   { ctx, project(), picture(), blocked() (the trial's set), chips()
//             ([{ name, floorId, cells }], the corridors brought in from the scenario),
//             closures() (blockedFromScenario's answer for the open scenario, or null),
//             dropped() (sentences as parts, from the last change that took something out),
//             tick(kind, id, on) with kind 'exit' or 'stairs', useScenario(),
//             removeChip(index), clear(), show(roomId), swatch(number), themeKey(),
//             home() (puts the focus on the map) }
//
// What is on it, top to bottom: the heading and the lead; the Exits fieldset, one tick
// each, "1 · Door A, Floor 1", the number on its colour; the Stairs fieldset, a legend
// a floor and a tick a stairs connection ("Stairs B, Floor 1 to Floor 2": a chained
// stairwell's connections each their own row), with the elevator line and the corridor
// line under it; "Use the scenario's closures" and the corridors it brought in as chips
// when the open scenario closes stairs or corridors; Clear the trial; and the results:
// the trial's sentence, the rooms with no way out, the rooms that go out another way
// (biggest change first, each with words for its arrows and a Show button), and the
// exits' figures before and after.
//
// Ticking keeps the focus on the checkbox; Clear moves it to the first checkbox;
// Use the scenario's closures keeps it on itself. Every typed name is set as text.

import { h, uid } from '../components/dom.js';
import { count } from '../components/words.js';
import { formatDuration } from '../../engine/findings.js';
import { ELEVATOR_KIND } from '../../engine/schema.js';
import { blockedCount } from './model.js';

export const WHAT_IF_HEAD = 'What if an exit or stairs is blocked?';
export const WHAT_IF_LEAD = 'Tick what cannot be used. The map, Exits and Step-free then show how every room gets out without it. This is a trial: nothing in the building changes, door cards and posters print the building as it is, and the trial stays while you move around the planner and is forgotten when you close the page or open another project.';
export const NO_ELEVATORS_SAYS = 'Elevators are not listed: an evacuation never uses them.';
export const CORRIDOR_SAYS = 'To block a corridor, close it in a scenario and press Use the scenario’s closures.';
export const NOTHING_BLOCKED = 'Nothing is blocked. Tick an exit or stairs above to see how the rooms would go out without it.';
export const FOR_SCENARIO = 'Use the scenario’s closures';
export const CLEAR_TRIAL = 'Clear the trial';

// "2 blocked": what the live region says after each tick
export const blockedSays = (n) => n + ' blocked';

// a sentence as nodes: [{ text, name }] with what a user typed set apart (bdi), or the plain string
export function partsNodes(parts, plain) {
  if (!Array.isArray(parts)) return [plain || ''];
  return parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
}

// a duration said whole, for the hidden words beside an arrow
export function spoken(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  const part = (n, one) => n + ' ' + one + (n === 1 ? '' : 's');
  if (m === 0) return part(s, 'second');
  return s === 0 ? part(m, 'minute') : part(m, 'minute') + ' ' + part(s, 'second');
}

// A stairs connection as the words say it: "Stairs B, Floor 1 to Floor 2" with the typed names set apart.
function stairsWords(project, connection) {
  const label = typeof connection.label === 'string' ? connection.label : '';
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const a = floors.get(connection.a && connection.a.floorId);
  const b = floors.get(connection.b && connection.b.floorId);
  const out = ['Stairs', label === '' ? null : [' ', h('bdi', null, label)]];
  if (a && b) {
    if (a.id === b.id) out.push(', ', h('bdi', null, a.name));
    else {
      const [low, high] = a.level <= b.level ? [a, b] : [b, a];
      out.push(', ', h('bdi', null, low.name), ' to ', h('bdi', null, high.name));
    }
  }
  return out;
}

// the floor a stairs is listed under: its lower floor
function lowerFloor(project, connection) {
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const a = floors.get(connection.a && connection.a.floorId);
  const b = floors.get(connection.b && connection.b.floorId);
  if (!a) return b || null;
  if (!b) return a;
  return a.level <= b.level ? a : b;
}

export function stairsOfBuilding(project) {
  return (project.building.connections || []).filter((connection) => connection && connection.kind !== ELEVATOR_KIND);
}

export function whatIfPanel(env) {
  const base = uid('whatif');
  const element = h('div', { class: 'mov-panel sfy-panel sfy-whatif', data: { panel: 'whatif' } });
  const heading = h('h2', { class: 'mov-panel__title' }, WHAT_IF_HEAD);
  const lead = h('p', { class: 'sfy-panel__lead' }, WHAT_IF_LEAD);
  const exitsBox = h('fieldset', { class: 'sfy-ticks', data: { ticks: 'exits' } });
  const stairsBox = h('div', { class: 'sfy-ticks-group', data: { ticks: 'stairs' } });
  const stairsNote = h('p', { class: 'sfy-panel__lead', data: { line: 'elevators-not-listed' } }, NO_ELEVATORS_SAYS);
  const corridorNote = h('p', { class: 'sfy-panel__lead', data: { line: 'corridors' } }, CORRIDOR_SAYS);
  const scenarioButton = h('button', { type: 'button', class: 'btn', hidden: true, data: { action: 'use-scenario' }, on: { click: () => env.useScenario() } }, FOR_SCENARIO);
  const scenarioWords = h('p', { class: 'sfy-panel__lead', hidden: true, data: { part: 'scenario-words' } });
  const chips = h('ul', { class: 'sfy-chips', 'aria-label': 'Corridors brought in from the scenario', hidden: true });
  const clearButton = h('button', { type: 'button', class: 'btn', hidden: true, data: { action: 'clear-trial' }, on: { click: () => env.clear() } }, CLEAR_TRIAL);
  const dropped = h('p', { class: 'sfy-panel__lead sfy-whatif__dropped', role: 'note', hidden: true, data: { part: 'dropped' } });
  const results = h('div', { class: 'sfy-results', data: { part: 'results' } });
  element.append(heading, lead, exitsBox, stairsBox, stairsNote, corridorNote, h('div', { class: 'sfy-whatif__actions' }, scenarioButton, clearButton), scenarioWords, chips, dropped, results);

  let drawnBuilding = null;
  let drawnTheme = null;
  let drawnPicture = null;
  let drawnChips = '';

  const tickId = (kind, id) => base + '-' + kind + '-' + id;

  function tick(kind, id, label) {
    const box = h('input', { type: 'checkbox', class: 'sfy-tick__box', id: tickId(kind, id), data: { kind, id } });
    box.addEventListener('change', () => env.tick(kind, id, box.checked));
    return h('li', { class: 'sfy-tick', data: { kind, id } }, box, h('label', { class: 'sfy-tick__label', for: box.id }, label));
  }

  // the ticks are drawn again when the building or the theme changes, the focus put back on the same tick
  function drawTicks() {
    const project = env.project();
    const picture = env.picture();
    const held = element.contains(document.activeElement) && document.activeElement.matches('.sfy-tick__box') ? document.activeElement.id : null;
    const exitRows = picture.exits.map((exit) => tick('exit', exit.exitId, [
      h('span', { class: 'sfy-swatch sfy-swatch--small', style: env.swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)),
      h('span', { class: 'vh' }, 'Exit ' + exit.number + ': '),
      ' ',
      h('bdi', null, exit.name),
      exit.name === 'The exit on ' + exit.floorName ? null : [', ', h('bdi', null, exit.floorName)],
    ]));
    exitsBox.replaceChildren(h('legend', { class: 'sfy-ticks__legend' }, 'Exits'), h('ul', { class: 'sfy-ticks__list' }, exitRows));
    const stairs = stairsOfBuilding(project);
    const groups = [];
    for (const floor of project.building.floors) {
      const here = stairs.filter((connection) => {
        const low = lowerFloor(project, connection);
        return low && low.id === floor.id;
      });
      if (here.length === 0) continue;
      groups.push(h('fieldset', { class: 'sfy-ticks sfy-ticks--floor', data: { ticks: 'stairs', floor: floor.id } },
        h('legend', { class: 'sfy-ticks__legend' }, 'Stairs from ', h('bdi', null, floor.name)),
        h('ul', { class: 'sfy-ticks__list' }, here.map((connection) => tick('stairs', connection.id, stairsWords(project, connection))))));
    }
    stairsBox.replaceChildren(...(groups.length > 0 ? groups : [h('p', { class: 'sfy-panel__lead', data: { line: 'no-stairs' } }, 'This building has no stairs to block.')]));
    if (held) {
      const again = document.getElementById(held);
      if (again) again.focus();
    }
  }

  function syncTicks() {
    const set = env.blocked();
    for (const box of element.querySelectorAll('.sfy-tick__box')) {
      const on = box.dataset.kind === 'exit' ? set.exits.includes(box.dataset.id) : set.connections.includes(box.dataset.id);
      if (box.checked !== on) box.checked = on;
    }
  }

  function drawActions() {
    const set = env.blocked();
    const closures = env.closures();
    const has = closures && (closures.connections.length > 0 || closures.cells.length > 0);
    scenarioButton.hidden = !has;
    scenarioWords.hidden = !has;
    if (has) {
      const parts = closures.words.parts.map((part) => (part.name ? h('bdi', null, part.text) : part.text));
      scenarioWords.replaceChildren('The open scenario closes: ', ...parts, '.');
    }
    clearButton.hidden = blockedCount(set) === 0;
    const list = env.chips();
    const key = JSON.stringify(list.map((chip) => [chip.name, chip.floorId, chip.cells.length]));
    chips.hidden = list.length === 0;
    if (key !== drawnChips) {
      drawnChips = key;
      const held = chips.contains(document.activeElement) ? Array.from(chips.querySelectorAll('button')).indexOf(document.activeElement) : -1;
      chips.replaceChildren(...list.map((chip, i) => h('li', { class: 'sfy-chip', data: { chip: String(i) } },
        h('span', { class: 'sfy-chip__words', dir: 'auto' }, h('bdi', null, chip.name), ' (from the scenario)'),
        h('button', { type: 'button', class: 'mov-link sfy-chip__remove', on: { click: () => env.removeChip(i) } }, 'Remove', h('span', { class: 'vh' }, ' ', chip.name)))));
      if (held !== -1) {
        const buttons = chips.querySelectorAll('button');
        if (buttons.length > 0) buttons[Math.min(held, buttons.length - 1)].focus();
        else scenarioButton.hidden ? clearButton.focus() : scenarioButton.focus();
      }
    }
    const said = env.dropped();
    dropped.hidden = said.length === 0;
    dropped.replaceChildren(...said.flatMap((parts, i) => [i > 0 ? ' ' : '', ...partsNodes(parts)]));
  }

  function showButton(room, name) {
    return h('button', { type: 'button', class: 'mov-link sfy-row__show', data: { action: 'show', room: room.roomId }, on: { click: () => env.show(room.roomId) } }, 'Show', h('span', { class: 'vh' }, ' ', name, ' on the map'));
  }

  function exitLabel(exit) {
    return [h('span', { class: 'sfy-swatch sfy-swatch--small', style: env.swatch(exit.number), 'aria-hidden': 'true' }, String(exit.number)), ' ', h('bdi', null, exit.name)];
  }

  function drawResults() {
    const picture = env.picture();
    const trial = picture.trial;
    const held = results.contains(document.activeElement) && document.activeElement.dataset.room ? document.activeElement.dataset.room : null;
    const heldAt = held ? Array.from(results.querySelectorAll('.sfy-row__show')).indexOf(document.activeElement) : -1;
    if (!trial) {
      results.dataset.state = 'none';
      results.replaceChildren(h('p', { class: 'sfy-results__none', data: { part: 'sentence' } }, NOTHING_BLOCKED));
      return;
    }
    results.dataset.state = 'on';
    const nameOf = new Map(picture.rows.map((row) => [row.roomId, row]));
    const exitOf = new Map(picture.exits.map((exit) => [exit.exitId, exit]));
    const lost = trial.rooms.filter((room) => room.change === 'lost');
    const moved = trial.rooms
      .map((room, order) => ({ room, order }))
      .filter((entry) => entry.room.change === 'other-exit' || entry.room.change === 'slower')
      .sort((x, y) => Math.abs(y.room.delta || 0) - Math.abs(x.room.delta || 0) || x.order - y.order)
      .map((entry) => entry.room);
    const lostRows = lost.map((room) => {
      const row = nameOf.get(room.roomId);
      const name = row ? row.name : '';
      return h('li', { class: 'sfy-row', data: { room: room.roomId, change: 'lost' } },
        h('div', { class: 'sfy-row__head' }, h('span', { class: 'sfy-row__name' }, h('bdi', null, name)), showButton(room, name)),
        h('p', { class: 'sfy-row__way', dir: 'auto' }, ...partsNodes(room.sentenceParts, room.sentence)));
    });
    const movedRows = moved.map((room) => {
      const row = nameOf.get(room.roomId);
      const name = row ? row.name : '';
      const was = exitOf.get(room.before.exitId);
      const now = exitOf.get(room.after.exitId);
      const same = room.before.exitId === room.after.exitId;
      const wasName = was ? was.name : 'an exit';
      const nowName = now ? now.name : 'an exit';
      const visible = same
        ? [h('bdi', null, nowName), ' (' + (now ? now.number : '') + ') · ', formatDuration(room.before.seconds), ' → ', formatDuration(room.after.seconds)]
        : [h('bdi', null, wasName), ' (' + (was ? was.number : '') + ') → ', h('bdi', null, nowName), ' (' + (now ? now.number : '') + ') · ', formatDuration(room.before.seconds), ' → ', formatDuration(room.after.seconds)];
      const said = same
        ? ': still ' + wasName + '; ' + spoken(room.before.seconds) + ', now ' + spoken(room.after.seconds)
        : ': was ' + wasName + ', now ' + nowName + '; ' + spoken(room.before.seconds) + ', now ' + spoken(room.after.seconds);
      return h('li', { class: 'sfy-row', data: { room: room.roomId, change: room.change } },
        h('div', { class: 'sfy-row__head' }, h('span', { class: 'sfy-row__name' }, h('bdi', null, name)), showButton(room, name)),
        h('p', { class: 'sfy-row__way', dir: 'auto' }, h('span', { 'aria-hidden': 'true' }, ...visible), h('span', { class: 'vh' }, h('bdi', null, name), said)));
    });
    const exitRows = trial.exits.map((entry) => {
      const exit = exitOf.get(entry.exitId);
      if (!exit) return null;
      const before = entry.before || { rooms: 0, people: 0 };
      const after = entry.after || { rooms: 0, people: 0 };
      const note = exit.blocked ? 'Blocked in this trial' : exit.heavy ? 'Far more than the others' : '';
      const figure = (a, b, one, many) => [h('span', { 'aria-hidden': 'true' }, a + ' → ' + b), h('span', { class: 'vh' }, count(a, one, many) + ' before, ' + b + ' after')];
      return h('tr', { class: 'sfy-table__row', data: { exit: exit.exitId, blocked: String(exit.blocked), heavy: String(exit.heavy) } },
        h('th', { scope: 'row', class: 'sfy-table__exit' }, ...exitLabel(exit)),
        h('td', { class: 'sfy-table__rooms', data: { label: 'Rooms' } }, ...figure(before.rooms, after.rooms, 'room', 'rooms')),
        h('td', { class: 'sfy-table__people', data: { label: 'People' } }, ...figure(before.people, after.people, 'person', 'people')),
        h('td', { class: 'sfy-table__note' }, note === '' ? null : h('span', { class: exit.blocked ? 'sfy-heavy sfy-heavy--blocked' : 'sfy-heavy' }, note)));
    });
    const sentence = partsNodes(trial.sentenceParts, trial.sentence);
    results.replaceChildren(
      h('p', { class: 'sfy-results__sentence', data: { part: 'sentence' } }, ...sentence),
      h('h3', { class: 'mov-panel__sub', id: base + '-lost' }, 'Rooms with no way out (' + lost.length + ')'),
      lost.length === 0 ? h('p', { class: 'sfy-missing__none', data: { count: '0', list: 'lost' } }, 'Every room still has a way out.') : h('ul', { class: 'sfy-rows', 'aria-labelledby': base + '-lost', data: { list: 'lost', count: String(lost.length) } }, lostRows),
      h('h3', { class: 'mov-panel__sub', id: base + '-moved' }, 'Rooms that go out another way (' + moved.length + ')'),
      moved.length === 0 ? h('p', { class: 'sfy-missing__none', data: { count: '0', list: 'moved' } }, 'No room goes out another way.') : h('ul', { class: 'sfy-rows', 'aria-labelledby': base + '-moved', data: { list: 'moved', count: String(moved.length) } }, movedRows),
      h('h3', { class: 'mov-panel__sub', id: base + '-exits' }, 'Exits'),
      h('table', { class: 'sfy-table', 'aria-labelledby': base + '-exits' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Exit'), h('th', { scope: 'col' }, 'Rooms, before → after'), h('th', { scope: 'col' }, 'People at full capacity, before → after'), h('th', { scope: 'col' }, h('span', { class: 'vh' }, 'Note')))),
        h('tbody', null, exitRows)));
    if (held) {
      const again = results.querySelector('.sfy-row__show[data-room="' + CSS.escape(held) + '"]');
      if (again) again.focus();
      else {
        const now = results.querySelectorAll('.sfy-row__show');
        if (now.length > 0) now[Math.min(Math.max(heldAt, 0), now.length - 1)].focus();
        else env.home();
      }
    }
  }

  function update() {
    const picture = env.picture();
    if (!picture) return;
    const project = env.project();
    if (drawnBuilding !== project.building || drawnTheme !== env.themeKey()) {
      drawnBuilding = project.building;
      drawnTheme = env.themeKey();
      drawTicks();
    }
    syncTicks();
    drawActions();
    if (drawnPicture !== picture) {
      drawnPicture = picture;
      drawResults();
    }
  }

  // Clear puts the focus on the first tick; the section calls this once the trial is gone
  function focusFirst() {
    const box = element.querySelector('.sfy-tick__box');
    if (box) box.focus();
    else env.home();
  }

  return { element, update, focusFirst };
}
