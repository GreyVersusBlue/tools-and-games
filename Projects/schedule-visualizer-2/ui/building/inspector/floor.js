// The Floor tab: what the floor on screen is and what it carries. Its name,
// its level (which storey it is: the stairs cost a walk for each level they
// change, whatever order the tabs are in) and place among the floors, its size (with what a new size would cut off,
// said before anything is cut), the image traced over, and the things drawn
// on it that are not rooms: stairs connections, corridor names and the areas
// left out of the colour scale. Deleting the floor is at the bottom.

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { choice } from '../../components/choice.js';
import { count } from '../../components/words.js';
import { ActionError, renameFloor, setFloorLevel, reorderFloor, deleteFloor, describeFloorDelete, describeResize, resizeFloor, disconnectStairs, setConnection, renameCorridor, removeCorridorName, setZone, removeZone } from '../../../engine/actions.js';
import { lossText } from '../../../engine/building.js';
import { RANGES } from '../../../engine/schema.js';
import { keyedList, heading, cellWords } from './controls.js';

export const SIZE_PRESETS = [
  { id: 'small', label: 'Small', width: 30, height: 20 },
  { id: 'medium', label: 'Medium', width: 40, height: 30 },
  { id: 'large', label: 'Large', width: 60, height: 40 },
];

function scheduledWords(described) {
  if (!described.slots) return '';
  return ' ' + count(described.groups, 'group') + (described.groups === 1 ? ' is' : ' are') + ' scheduled into what would go, for ' + count(described.slots, 'period') + '; those periods would say the room is not in the building.';
}

// floorPanel(env) -> { element, update(state), focusZone(zoneId) }
//   env: { ctx, store, editor(), trace, show(where), toSurface() }
export function floorPanel(env) {
  const { store, ctx } = env;
  const element = h('div', { class: 'bld-inspector__panel', id: 'inspector-floor' });
  let state = null;
  let built = null;
  let parts = null;

  const ed = () => env.editor();

  // ---------------------------------------------------------- size

  // What the size fields ask for, as resizeFloor's payload, or a refusal.
  function wanted() {
    const floor = state.floor;
    const width = Number(parts.width.value.trim());
    const height = Number(parts.height.value.trim());
    if (!/^\d+$/.test(parts.width.value.trim()) || !/^\d+$/.test(parts.height.value.trim())) return { error: 'A size is two whole numbers of squares, each from ' + RANGES.floorSize[0] + ' to ' + RANGES.floorSize[1] + '.' };
    const dx = width - floor.width;
    const dy = height - floor.height;
    const payload = { floorId: floor.id };
    if (dx !== 0) payload[parts.sideX] = dx;
    if (dy !== 0) payload[parts.sideY] = dy;
    return { width, height, same: dx === 0 && dy === 0, payload };
  }

  function preview() {
    const floor = state.floor;
    const ask = wanted();
    let text;
    let ok = false;
    let described = null;
    if (ask.error) text = ask.error;
    else if (ask.same) text = 'That is the size ' + floor.name + ' is now.';
    else {
      try {
        described = describeResize(state.project, ask.payload);
        ok = true;
        text = floor.name + ' would be ' + described.width + ' × ' + described.height + ' squares. '
          + (described.losesData ? 'That would cut off ' + lossText(described.loss) + '.' + scheduledWords(described) : 'Nothing drawn would be cut off.');
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        text = error.message;
      }
    }
    parts.preview.textContent = text;
    parts.preview.dataset.loss = described && described.losesData ? 'true' : 'false';
    parts.resize.setAttribute('aria-disabled', String(!ok));
    parts.resize.textContent = ok ? 'Resize to ' + ask.width + ' × ' + ask.height : 'Resize';
    return ok ? { ask, described } : null;
  }

  async function resize() {
    const ready = preview();
    if (!ready) {
      ctx.announce(parts.preview.textContent);
      return;
    }
    const { ask, described } = ready;
    const floor = state.floor;
    if (described.losesData) {
      const answer = await ctx.openDialog({
        id: 'resize-dialog',
        title: 'Resize ' + floor.name + ' to ' + described.width + ' × ' + described.height + ' and remove what is cut off?',
        body: [
          h('p', null, 'This would cut off ' + lossText(described.loss) + '.' + scheduledWords(described)),
          h('p', null, 'Undo brings it all back.'),
        ],
        opener: parts.resize,
        buttons: [
          { label: 'Resize and remove what is cut off', value: true, kind: 'danger' },
          { label: 'Keep ' + floor.name + ' at ' + floor.width + ' × ' + floor.height, value: false },
        ],
      }).closed;
      if (answer !== true) {
        ctx.announce('The size was not changed.');
        return;
      }
    }
    ed().commit(resizeFloor, ask.payload, {
      done: (outcome) => 'Resized ' + floor.name + ' to ' + outcome.width + ' by ' + outcome.height + (described.losesData ? ', which removed ' + lossText(outcome.loss) : '') + '.',
    });
  }

  // ---------------------------------------------------------- build

  function build(floor) {
    const name = field({ id: 'floor-name', label: 'Floor name', name: 'floorName', value: floor.name, commit: (value) => store.apply(renameFloor, { id: state.floor.id, name: value }) });
    // The storey: a whole number, typed. The words under it say what it is for.
    const level = field({
      id: 'floor-level',
      label: 'Level',
      name: 'floorLevel',
      inputMode: 'numeric',
      describedBy: 'floor-level-hint',
      value: floor.level,
      parse: (text) => {
        const typed = text.trim().replace(/^\u2212/, '-');
        if (!/^-?\d+$/.test(typed)) throw new Error('A level is a whole number: 1 for the ground floor, 2 for the one above, 0 or -1 for a basement.');
        return Number(typed);
      },
      commit: (value) => {
        const before = state.floor.level;
        store.apply(setFloorLevel, { id: state.floor.id, level: value });
        if (value !== before) ctx.announce(state.floor.name + ' is now level ' + value + '.');
      },
    });
    level.input.dataset.key = 'level';
    const levelHint = h('p', { class: 'bld-inspector__small', id: 'floor-level-hint' }, 'Which storey this is: 1 for the ground floor, 2 for the one above. Stairs take longer for each level they change, so two floors on the same level are a walk across, not a climb.');
    const about = h('p', { id: 'floor-about' });
    const earlier = h('button', { type: 'button', class: 'btn', id: 'floor-earlier', data: { key: 'earlier' }, on: { click: () => move(-1) } }, 'Move it earlier');
    const later = h('button', { type: 'button', class: 'btn', id: 'floor-later', data: { key: 'later' }, on: { click: () => move(1) } }, 'Move it later');

    const width = h('input', { class: 'field__input', id: 'floor-width', name: 'floorWidth', type: 'text', inputmode: 'numeric', autocomplete: 'off', data: { key: 'width' } });
    const height = h('input', { class: 'field__input', id: 'floor-height', name: 'floorHeight', type: 'text', inputmode: 'numeric', autocomplete: 'off', data: { key: 'height' } });
    width.value = String(floor.width);
    height.value = String(floor.height);
    const previewLine = h('p', { class: 'bi-preview', id: 'floor-size-preview', role: 'status' });
    const resizeButton = h('button', { type: 'button', class: 'btn btn--primary', id: 'floor-resize', 'aria-disabled': 'true', 'aria-describedby': 'floor-size-preview', data: { key: 'resize' }, on: { click: () => resize() } }, 'Resize');
    const sideX = choice({ name: 'floor-side-x', labelledBy: 'floor-side-x-label', value: 'right', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], onChange: (value) => {
      parts.sideX = value;
      preview();
    } });
    const sideY = choice({ name: 'floor-side-y', labelledBy: 'floor-side-y-label', value: 'bottom', options: [{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }], onChange: (value) => {
      parts.sideY = value;
      preview();
    } });
    const presets = h('div', { class: 'bi-buttons', role: 'group', 'aria-label': 'Sizes to start from' }, SIZE_PRESETS.map((preset) => h('button', {
      type: 'button',
      class: 'btn',
      data: { preset: preset.id, key: 'preset:' + preset.id },
      on: { click: () => {
        width.value = String(preset.width);
        height.value = String(preset.height);
        preview();
        ctx.announce(parts.preview.textContent);
      } },
    }, preset.label + ' ' + preset.width + ' × ' + preset.height)));
    for (const input of [width, height]) {
      input.addEventListener('input', () => preview());
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          resize();
        }
      });
    }

    const connections = h('ul', { class: 'bi-rows', id: 'floor-connections' });
    const noConnections = h('p', { class: 'bld-inspector__small' });
    const corridors = h('ul', { class: 'bi-rows', id: 'floor-corridors' });
    const noCorridors = h('p', { class: 'bld-inspector__small' }, 'No corridor on this floor has a name yet. Choose the Name tool (N) and drag along a corridor.');
    const zones = h('ul', { class: 'bi-rows', id: 'floor-zones' });
    const noZones = h('p', { class: 'bld-inspector__small' }, 'Nothing on this floor is left out of the colour scale. A place that is busy by design, like the cafeteria doors, can be: choose the Leave out tool (Z) and drag a rectangle over it.');
    const remove = h('button', { type: 'button', class: 'btn btn--danger', id: 'floor-delete', data: { key: 'delete' }, on: { click: () => removeFloor() } });
    const lastNote = h('p', { class: 'bld-inspector__small', id: 'floor-last' }, 'This is the only floor, and a building has at least one, so it cannot be deleted.');

    element.replaceChildren(
      h('h2', { class: 'bld-inspector__title', id: 'floor-title' }),
      name.element,
      level.element,
      levelHint,
      about,
      h('div', { class: 'bi-buttons' }, earlier, later),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-size-heading' },
        heading('Size', 'floor-size-heading'),
        presets,
        h('div', { class: 'bi-pair' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'floor-width' }, 'Squares across'), width),
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'floor-height' }, 'Squares down'), height)),
        h('div', { class: 'bi-side' }, h('span', { class: 'field__label', id: 'floor-side-x-label' }, 'Add or cut across at the'), sideX.element),
        h('div', { class: 'bi-side' }, h('span', { class: 'field__label', id: 'floor-side-y-label' }, 'Add or cut down at the'), sideY.element),
        previewLine,
        h('div', { class: 'bi-buttons' }, resizeButton)),
      env.trace.controls.element,
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-connections-heading' }, heading('Stairs connections', 'floor-connections-heading'), connections, noConnections),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-corridors-heading' }, heading('Corridor names', 'floor-corridors-heading'), corridors, noCorridors),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-zones-heading' }, heading('Left out of the colour scale', 'floor-zones-heading'), zones, noZones),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-delete-heading' }, heading('Delete', 'floor-delete-heading'), lastNote, h('div', { class: 'bi-buttons' }, remove)),
    );
    parts = {
      name, level, about, earlier, later, width, height, preview: previewLine, resize: resizeButton, sideX: 'right', sideY: 'bottom',
      connections: keyedList(connections), connectionsHost: connections, noConnections,
      corridors: keyedList(corridors), corridorsHost: corridors, noCorridors,
      zones: keyedList(zones), zonesHost: zones, noZones,
      remove, lastNote, size: floor.width + 'x' + floor.height,
    };
  }

  function move(step) {
    const floors = state.project.building.floors;
    const at = floors.findIndex((each) => each.id === state.floor.id);
    const to = at + step;
    if (to < 0 || to >= floors.length) return;
    store.apply(reorderFloor, { id: state.floor.id, toIndex: to });
    ctx.announce(state.floor.name + ' is now floor ' + (to + 1) + ' of ' + floors.length + ' in the tabs.');
  }

  async function removeFloor() {
    const floor = state.floor;
    const described = describeFloorDelete(state.project, floor.id);
    if (!described || described.last) return;
    const takes = [];
    if (described.rooms > 0) takes.push(count(described.rooms, 'room'));
    if (described.otherSpaces > 0) takes.push(count(described.otherSpaces, 'other space'));
    if (described.connections > 0) takes.push(count(described.connections, 'stairs connection'));
    if (described.exits > 0) takes.push(count(described.exits, 'exit'));
    if (described.zones > 0) takes.push(count(described.zones, 'left-out area'));
    const body = [h('p', null, takes.length === 0 ? 'Nothing is drawn on it.' : 'With it go ' + takes.join(', ') + '.')];
    if (described.slots > 0) body.push(h('p', null, count(described.slots, 'period') + ' of the schedule ' + (described.slots === 1 ? 'is' : 'are') + ' in its rooms. Those would say the room is not in the building.'));
    body.push(h('p', null, 'Undo brings the floor back.'));
    const ok = await ctx.confirm({ title: 'Delete ' + floor.name + '?', body, action: 'Delete ' + floor.name, keep: 'Keep ' + floor.name, danger: true, opener: parts.remove });
    if (!ok) return;
    const sentence = 'Deleted ' + floor.name + (described.connections > 0 ? ' and ' + count(described.connections, 'stairs connection') + ' with it' : '') + '.';
    ed().commit(deleteFloor, { id: floor.id }, { done: () => sentence, toast: () => sentence });
  }

  // ---------------------------------------------------------- the lists

  const small = (label, key, aria, run) => h('button', { type: 'button', class: 'btn btn--quiet bi-small', data: { key, action: key.split(':')[0] }, 'aria-label': aria, on: { click: run } }, label);

  function syncLists() {
    const { project, floor } = state;
    const building = project.building;
    const floorName = (id) => (building.floors.find((each) => each.id === id) || { name: 'a floor that is gone' }).name;

    const links = building.connections.filter((connection) => connection.a.floorId === floor.id || connection.b.floorId === floor.id);
    parts.connectionsHost.hidden = links.length === 0;
    parts.noConnections.hidden = links.length > 0;
    parts.noConnections.textContent = floor.cells.includes('S')
      ? 'No stairs on this floor are connected yet. Open the menu on a stairs cell (right-click, or the Menu key) and choose Connect.'
      : 'There are no stairs on this floor yet. Place some with the Stairs tool (S), then connect them to the stairs on another floor.';
    parts.connections.update(links, {
      key: (connection) => connection.id,
      build: (connection) => {
        const label = field({ label: 'Letter or name', value: connection.label, commit: (value) => store.apply(setConnection, { connectionId: connection.id, label: value }) });
        label.input.dataset.key = 'connection:' + connection.id;
        const where = h('p', { class: 'bld-inspector__small' });
        const buttons = [
          small('Show me', 'show-connection:' + connection.id, 'Show me: stairs ' + connection.label, () => {
            const now = state.project.building.connections.find((each) => each.id === connection.id);
            const end = now.a.floorId === state.floor.id ? now.a : now.b;
            env.show({ floorId: end.floorId, cells: [end.cell] });
          }),
          small('Disconnect', 'disconnect:' + connection.id, 'Disconnect stairs ' + connection.label, () => {
            const now = state.project.building.connections.find((each) => each.id === connection.id);
            ed().commit(disconnectStairs, { connectionId: connection.id }, { done: () => 'Disconnected stairs ' + now.label + '.', toast: () => 'Disconnected stairs ' + now.label + '.' });
          }),
        ];
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { connection: connection.id } }, label.element, where, h('div', { class: 'bi-row__buttons' }, buttons)),
          sync: (now) => {
            label.set(now.label);
            const same = now.a.floorId === now.b.floorId;
            where.textContent = same
              ? 'Joins two places on ' + floorName(now.a.floorId) + ': ' + cellWords(floor, now.a.cell) + ' and ' + cellWords(floor, now.b.cell) + '.'
              : 'Joins ' + floorName(now.a.floorId) + ' and ' + floorName(now.b.floorId) + '.';
          },
        };
      },
    });

    parts.corridorsHost.hidden = floor.corridors.length === 0;
    parts.noCorridors.hidden = floor.corridors.length > 0;
    parts.corridors.update(floor.corridors, {
      key: (corridor) => corridor.id,
      build: (corridor) => {
        const name = field({ label: 'Corridor name', value: corridor.name, commit: (value) => {
          if (value === '') throw new Error('A corridor name is text. To take the name off, use Take the name off.');
          store.apply(renameCorridor, { floorId: state.floor.id, corridorId: corridor.id, name: value });
        } });
        name.input.dataset.key = 'corridor:' + corridor.id;
        const where = h('p', { class: 'bld-inspector__small' });
        const buttons = [
          small('Show me', 'show-corridor:' + corridor.id, 'Show me: the corridor ' + corridor.name, () => {
            const now = state.floor.corridors.find((each) => each.id === corridor.id);
            env.show({ floorId: state.floor.id, cells: now.cells });
          }),
          small('Take the name off', 'unname:' + corridor.id, 'Take the name off the corridor ' + corridor.name, () => {
            const now = state.floor.corridors.find((each) => each.id === corridor.id);
            ed().commit(removeCorridorName, { floorId: state.floor.id, corridorId: corridor.id }, { done: () => 'Took the name ' + now.name + ' off the corridor. The cells are still corridor.', toast: () => 'Took the name ' + now.name + ' off the corridor.' });
          }),
        ];
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { corridor: corridor.id } }, name.element, where, h('div', { class: 'bi-row__buttons' }, buttons)),
          sync: (now) => {
            name.set(now.name);
            where.textContent = count(now.cells.length, 'cell') + '.';
          },
        };
      },
    });

    const areas = building.zones.filter((zone) => zone.floorId === floor.id);
    parts.zonesHost.hidden = areas.length === 0;
    parts.noZones.hidden = areas.length > 0;
    parts.zones.update(areas, {
      key: (zone) => zone.id,
      build: (zone) => {
        const label = field({ label: 'Label', value: zone.label, placeholder: 'Cafeteria doors', commit: (value) => store.apply(setZone, { zoneId: zone.id, label: value }) });
        label.input.dataset.key = 'zone:' + zone.id;
        label.input.dataset.zone = zone.id;
        // Enter after labelling a new area goes back to the plan, as a room's number does
        label.input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && label.input.dataset.fresh === 'true') {
            delete label.input.dataset.fresh;
            env.toSurface();
          }
        });
        label.input.addEventListener('blur', () => {
          delete label.input.dataset.fresh;
        });
        const where = h('p', { class: 'bld-inspector__small' });
        const buttons = [
          small('Show me', 'show-zone:' + zone.id, 'Show me: this area', () => {
            const now = state.project.building.zones.find((each) => each.id === zone.id);
            const cells = [];
            for (let y = now.y; y < now.y + now.h; y += 1) for (let x = now.x; x < now.x + now.w; x += 1) cells.push(y * state.floor.width + x);
            env.show({ floorId: state.floor.id, cells });
          }),
          small('Remove', 'remove-zone:' + zone.id, 'Remove this area', () => {
            ed().commit(removeZone, { zoneId: zone.id }, { done: () => 'The area is back in the colour scale.', toast: () => 'The area is back in the colour scale.' });
          }),
        ];
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { zone: zone.id } }, label.element, where, h('div', { class: 'bi-row__buttons' }, buttons)),
          sync: (now) => {
            label.set(now.label);
            where.textContent = now.w + ' × ' + now.h + ' squares from column ' + (now.x + 1) + ', row ' + (now.y + 1) + '.';
          },
        };
      },
    });
  }

  function update(next) {
    state = next;
    const { floor, project } = state;
    if (floor.id !== built) {
      built = floor.id;
      build(floor);
    }
    const floors = project.building.floors;
    const at = floors.findIndex((each) => each.id === floor.id);
    const title = element.querySelector('#floor-title');
    if (title.textContent !== floor.name) title.textContent = floor.name;
    parts.name.set(floor.name);
    parts.level.set(floor.level);
    parts.about.textContent = floor.name + ' is ' + floor.width + ' × ' + floor.height + ' squares.' + (floors.length > 1 ? ' It is floor ' + (at + 1) + ' of ' + floors.length + ' in the tabs.' : '');
    parts.earlier.disabled = at === 0;
    parts.later.disabled = at === floors.length - 1;
    parts.earlier.parentElement.hidden = floors.length < 2;
    // the fields follow the floor when its size changed under them
    const size = floor.width + 'x' + floor.height;
    if (size !== parts.size) {
      parts.size = size;
      parts.width.value = String(floor.width);
      parts.height.value = String(floor.height);
    }
    preview();
    parts.remove.textContent = 'Delete ' + floor.name;
    parts.remove.disabled = floors.length === 1;
    parts.lastNote.hidden = floors.length > 1;
    env.trace.controls.update(floor);
    syncLists();
  }

  return {
    element,
    update,
    // The label of an area that has just been drawn takes the focus.
    focusZone(zoneId) {
      const input = Array.from(element.querySelectorAll('input[data-zone]')).find((each) => each.dataset.zone === zoneId);
      if (!input) return false;
      input.dataset.fresh = 'true';
      input.focus();
      input.select();
      return true;
    },
  };
}
