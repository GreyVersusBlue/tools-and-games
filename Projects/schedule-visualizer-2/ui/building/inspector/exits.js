// The Exits tab: every exit of the building, floor by floor (spec 4.6), each
// with its door name and its assembly point, a "Show me" and a way to take
// the mark off. An exit is marked on the plan: the Exit tool, or the menu on
// a corridor cell at the building's edge.

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { count } from '../../components/words.js';
import { setExit, unmarkExit } from '../../../engine/actions.js';
import { keyedList, cellWords } from './controls.js';

// exitsPanel(env) -> { element, update(state), focusExit(exitId) }
export function exitsPanel(env) {
  const { store } = env;
  const lead = h('p', { id: 'exits-lead' });
  const host = h('ul', { class: 'bi-rows', id: 'exits-list', 'aria-label': 'The exits of the building' });
  const element = h('div', { class: 'bld-inspector__panel', id: 'inspector-exits' },
    h('h2', { class: 'bld-inspector__title' }, 'Exits'),
    lead,
    host,
    h('p', { class: 'bld-inspector__small' }, 'To mark an exit, choose the Exit tool (X) and click a corridor cell on the building\'s edge. Click an exit with the same tool to take the mark off.'),
  );
  const rows = keyedList(host);
  let state = null;

  const find = (floorId, exitId) => {
    const floor = state.project.building.floors.find((each) => each.id === floorId);
    const exit = floor ? floor.exits.find((each) => each.id === exitId) : null;
    return exit ? { floor, exit } : null;
  };

  function update(next) {
    state = next;
    const all = [];
    for (const floor of state.project.building.floors) for (const exit of floor.exits) all.push({ floor, exit });
    const floors = new Set(all.map((entry) => entry.floor.id)).size;
    lead.textContent = all.length === 0
      ? 'No exit is marked yet. Evacuation routes need at least one.'
      : 'The building has ' + count(all.length, 'exit') + (floors > 1 ? ' on ' + count(floors, 'floor') : '') + '.';
    host.hidden = all.length === 0;
    rows.update(all, {
      key: (entry) => entry.floor.id + ':' + entry.exit.id,
      build: (entry) => {
        const floorId = entry.floor.id;
        const exitId = entry.exit.id;
        const door = field({ label: 'Door name', placeholder: 'Door B', value: entry.exit.doorName, commit: (value) => store.apply(setExit, { floorId, exitId, doorName: value }) });
        door.input.dataset.key = 'door:' + exitId;
        door.input.dataset.exit = exitId;
        // Enter after naming a new exit goes back to the plan, as a room's number does
        door.input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && door.input.dataset.fresh === 'true') {
            delete door.input.dataset.fresh;
            env.toSurface();
          }
        });
        door.input.addEventListener('blur', () => {
          delete door.input.dataset.fresh;
        });
        const assembly = field({ label: 'Assembly point', placeholder: 'Front lawn by the flagpole', value: entry.exit.assembly, commit: (value) => store.apply(setExit, { floorId, exitId, assembly: value }) });
        assembly.input.dataset.key = 'assembly:' + exitId;
        const where = h('p', { class: 'bi-row__where' });
        const show = h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'show:' + exitId, action: 'show' }, on: { click: () => {
          const now = find(floorId, exitId);
          if (now) env.show({ floorId, cells: [now.exit.cell] });
        } } }, 'Show me');
        const remove = h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'remove:' + exitId, action: 'remove-exit' }, on: { click: () => {
          const now = find(floorId, exitId);
          if (!now) return;
          const name = now.exit.doorName.trim() === '' ? 'the exit on ' + now.floor.name : 'the exit ' + now.exit.doorName;
          env.editor().commit(unmarkExit, { floorId, exitId }, { done: () => 'Took the mark off ' + name + '. The corridor cell stays.', toast: () => 'Took the mark off ' + name + '.' });
        } } }, 'Remove');
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { exit: exitId } }, where, door.element, assembly.element, h('div', { class: 'bi-row__buttons' }, show, remove)),
          sync: (now) => {
            door.set(now.exit.doorName);
            assembly.set(now.exit.assembly);
            where.textContent = now.floor.name + ', ' + cellWords(now.floor, now.exit.cell);
            const name = now.exit.doorName.trim() === '' ? 'the exit on ' + now.floor.name + ' at ' + cellWords(now.floor, now.exit.cell) : 'the exit ' + now.exit.doorName;
            show.setAttribute('aria-label', 'Show ' + name);
            remove.setAttribute('aria-label', 'Remove ' + name);
          },
        };
      },
    });
  }

  return {
    element,
    update,
    // The door name of an exit that has just been marked takes the focus.
    focusExit(exitId) {
      const input = Array.from(element.querySelectorAll('input[data-exit]')).find((each) => each.dataset.exit === exitId);
      if (!input) return false;
      input.dataset.fresh = 'true';
      input.focus();
      input.select();
      return true;
    },
  };
}
