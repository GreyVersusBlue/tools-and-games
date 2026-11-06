// The Exits tab: every exit of the building, floor by floor (spec 4.6), each
// with its door name and its assembly point, a "Show me" and a way to take
// the mark off. An exit is marked on the plan: the Exit tool, or the menu on
// a corridor cell at the building's edge.

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { count } from '../../components/words.js';
import { setExit, unmarkExit, setExitStepFree, setRefuge, removeRefuge } from '../../../engine/actions.js';
import { keyedList, cellWords, checkField, heading } from './controls.js';

// exitsPanel(env) -> { element, update(state), focusExit(exitId) }
export function exitsPanel(env) {
  const { store } = env;
  const refugeLead = h('p', { class: 'bld-inspector__small', id: 'exits-refuges-lead' });
  const refugeHost = h('ul', { class: 'bi-rows', id: 'exits-refuge-list', 'aria-labelledby': 'exits-refuges-heading' });
  const lead = h('p', { id: 'exits-lead' });
  const host = h('ul', { class: 'bi-rows', id: 'exits-list', 'aria-label': 'The exits of the building' });
  const element = h('div', { class: 'bld-inspector__panel', id: 'inspector-exits' },
    h('h2', { class: 'bld-inspector__title' }, 'Exits'),
    lead,
    host,
    h('p', { class: 'bld-inspector__small' }, 'To mark an exit, choose the Exit tool (X) and click a corridor cell on the building\'s edge. Click an exit with the same tool to take the mark off.'),
    h('section', { class: 'bi-part', id: 'exits-refuges', 'aria-labelledby': 'exits-refuges-heading' },
      heading('Areas of refuge', 'exits-refuges-heading'),
      refugeLead,
      refugeHost,
    ),
  );
  const rows = keyedList(host);
  const refugeRows = keyedList(refugeHost);
  let state = null;

  const find = (floorId, exitId) => {
    const floor = state.project.building.floors.find((each) => each.id === floorId);
    const exit = floor ? floor.exits.find((each) => each.id === exitId) : null;
    return exit ? { floor, exit } : null;
  };

  function syncRefuges() {
    const all = [];
    for (const floor of state.project.building.floors) for (const refuge of floor.refuges || []) all.push({ floor, refuge });
    refugeLead.textContent = all.length === 0
      ? 'No area of refuge is marked. Open the menu on a corridor or stairs cell (right-click, or the Menu key) and choose Make this an area of refuge.'
      : 'The building has ' + count(all.length, 'area of refuge', 'areas of refuge') + '.';
    refugeHost.hidden = all.length === 0;
    refugeRows.update(all, {
      key: (entry) => entry.floor.id + ':' + entry.refuge.id,
      build: (entry) => {
        const floorId = entry.floor.id;
        const refugeId = entry.refuge.id;
        const name = field({ label: 'Name', value: entry.refuge.name, commit: (value) => store.apply(setRefuge, { floorId, refugeId, name: value }) });
        name.input.dataset.key = 'refuge:' + refugeId;
        const where = h('p', { class: 'bi-row__where' });
        const find = () => {
          const floor = state.project.building.floors.find((each) => each.id === floorId);
          const refuge = floor ? (floor.refuges || []).find((each) => each.id === refugeId) : null;
          return refuge ? { floor, refuge } : null;
        };
        const show = h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'show-refuge:' + refugeId, action: 'show-refuge' }, on: { click: () => {
          const now = find();
          if (now) env.show({ floorId, cells: [now.refuge.cell] });
        } } }, 'Show me');
        const remove = h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key: 'remove-refuge:' + refugeId, action: 'remove-refuge' }, on: { click: () => {
          const now = find();
          if (!now) return;
          env.editor().commit(removeRefuge, { floorId, refugeId }, { done: () => 'Took the area of refuge ' + now.refuge.name + ' off. The cell stays.', toast: () => 'Took the area of refuge ' + now.refuge.name + ' off.' });
        } } }, 'Remove');
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { refuge: refugeId } }, where, name.element, h('div', { class: 'bi-row__buttons' }, show, remove)),
          sync: (now) => {
            name.set(now.refuge.name);
            where.textContent = now.floor.name + ', ' + cellWords(now.floor, now.refuge.cell);
            show.setAttribute('aria-label', 'Show me: the area of refuge ' + now.refuge.name);
            remove.setAttribute('aria-label', 'Remove the area of refuge ' + now.refuge.name);
          },
        };
      },
    });
  }

  function update(next) {
    state = next;
    syncRefuges();
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
        const level = checkField({
          label: 'Step-free',
          name: 'exitStepFree',
          key: 'exit-step-free:' + exitId,
          checked: entry.exit.stepFree !== false,
          commit: (on) => {
            const outcome = env.editor().commit(setExitStepFree, { floorId, exitId, stepFree: on }, {
              done: () => (on ? 'The exit is step-free.' : 'The exit has a step outside its door.'),
            });
            if (outcome === null) throw new Error('That could not be changed. The tick is back as it was.');
          },
        });
        level.input.dataset.exitStepFree = exitId;
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
          element: h('li', { class: 'bi-row bi-row--stack', data: { exit: exitId } }, where, door.element, assembly.element, level.element, h('div', { class: 'bi-row__buttons' }, show, remove)),
          sync: (now) => {
            door.set(now.exit.doorName);
            assembly.set(now.exit.assembly);
            where.textContent = now.floor.name + ', ' + cellWords(now.floor, now.exit.cell);
            const name = now.exit.doorName.trim() === '' ? 'the exit on ' + now.floor.name + ' at ' + cellWords(now.floor, now.exit.cell) : 'the exit ' + now.exit.doorName;
            level.set(now.exit.stepFree !== false);
            // its own name: which exit it is the tick of
            level.input.setAttribute('aria-label', (now.exit.doorName.trim() === '' ? 'Exit on ' + now.floor.name + ' at ' + cellWords(now.floor, now.exit.cell) : 'Exit ' + now.exit.doorName) + ', step-free');
            show.setAttribute('aria-label', 'Show me: ' + name);
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
