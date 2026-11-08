// The Floor tab: what the floor on screen is and what it carries. Its name,
// its level (which storey it is: the stairs cost a walk for each level they
// change, whatever order the tabs are in) and place among the floors, its size (with what a new size would cut off,
// said before anything is cut), the image traced over, and the things drawn
// on it that are not rooms: stairs connections, corridor names and the areas
// left out of the colour scale. Clearing the floor and deleting it are at the
// bottom.
//
// Clearing a floor and a resize that cuts something off are large changes
// that keep an automatic snapshot of the project from before them (spec
// 13.3, SV2-28b). The change is made at once and the snapshot is kept
// afterwards (storage/snapshots.js snapshotAfter), so a device that cannot
// keep one never holds the change up. The change is said at once with its
// Undo, as every other change is; when the snapshot settles a second message
// says whether it was kept (SV2-28d), with the Undo again only while the
// change is still the step Undo takes back.
// Clearing asks nothing: it is one undo step and the snapshot keeps the rest
// (spec 3.8). What it removes, decided here: everything drawn on the floor,
// as the eraser takes it over every cell (rooms, other spaces, corridor and
// stairs cells, and with them the doors, exits, corridor names and stairs
// connections that stood on them). The floor keeps its name, level, size,
// traced image and the areas left out of the colour scale, which are a
// choice about counting rather than something drawn.

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { choice } from '../../components/choice.js';
import { count, list } from '../../components/words.js';
import { ActionError, renameFloor, setFloorLevel, reorderFloor, deleteFloor, describeFloorDelete, describeResize, resizeFloor, eraseCells, disconnectStairs, setConnection, renameCorridor, removeCorridorName, setZone, removeZone, setStepCells } from '../../../engine/actions.js';
import { lossText, counts, describeFloor } from '../../../engine/building.js';
import { snapshotAfter, undoForStep } from '../../../storage/snapshots.js';
import { RANGES, nameOfRoom, ELEVATOR_KIND } from '../../../engine/schema.js';
import { keyedList, heading, cellWords, commitKeepingFocus } from './controls.js';
import { legend } from './legend.js';
import { focusCells } from './cell-focus.js';

// ---- which way a stairs connection may be walked (spec 4.5, DESIGN 12.5)

// Where one end of a connection is, in words: the room nearest to it (within
// six cells), else the corridor it stands in or beside, else its floor's
// west or east end.
function endPlace(floor, cell) {
  const x = cell % floor.width;
  const y = Math.floor(cell / floor.width);
  let best = null;
  for (const space of floor.spaces) {
    if (space.kind !== 'room') continue;
    for (const at of space.cells) {
      const distance = Math.abs((at % floor.width) - x) + Math.abs(Math.floor(at / floor.width) - y);
      if (distance <= 6 && (best === null || distance < best.distance)) best = { distance, space };
    }
  }
  if (best) return nameOfRoom(best.space, false);
  const near = [cell, cell - 1, cell + 1, cell - floor.width, cell + floor.width];
  const corridor = floor.corridors.find((entry) => entry.name !== '' && near.some((at) => entry.cells.includes(at)));
  if (corridor) return corridor.name;
  return floor.name + ' ' + (x < floor.width / 2 ? 'west end' : 'east end');
}

// The three ways of a connection as radio chips: [{ value, label }] with value
// the direction it writes ('both', 'ab', 'ba'). Between floors the words go by
// floor level ("Up only, towards Floor 3", "Down only, towards Floor 1"); on
// one floor they name the end ("Only from the end by Room 104").
export function wayChoices(project, connection) {
  const floors = project.building.floors;
  const a = floors.find((each) => each.id === connection.a.floorId);
  const b = floors.find((each) => each.id === connection.b.floorId);
  const both = { value: 'both', label: 'Both ways' };
  if (!a || !b) return [both, { value: 'ab', label: 'From the A end only' }, { value: 'ba', label: 'From the B end only' }];
  if (a.level === b.level) {
    let first = endPlace(a, connection.a.cell);
    let second = endPlace(b, connection.b.cell);
    if (first === second) {
      first += ' (' + cellWords(a, connection.a.cell) + ')';
      second += ' (' + cellWords(b, connection.b.cell) + ')';
    }
    return [both, { value: 'ab', label: 'Only from the end by ' + first }, { value: 'ba', label: 'Only from the end by ' + second }];
  }
  const lowToHigh = a.level < b.level ? 'ab' : 'ba';
  const highToLow = lowToHigh === 'ab' ? 'ba' : 'ab';
  const higher = a.level < b.level ? b : a;
  const lower = a.level < b.level ? a : b;
  return [both, { value: lowToHigh, label: 'Up only, towards ' + higher.name }, { value: highToLow, label: 'Down only, towards ' + lower.name }];
}

// The connection's way as one line, for the list and for a screen reader:
// "up only, towards Floor 2"; "" when it runs both ways.
export function wayLine(project, connection) {
  if (connection.direction === 'both') return '';
  const chosen = wayChoices(project, connection).find((choice) => choice.value === connection.direction);
  return chosen ? chosen.label.charAt(0).toLowerCase() + chosen.label.slice(1) : '';
}

export const SIZE_PRESETS = [
  { id: 'small', label: 'Small', width: 30, height: 20 },
  { id: 'medium', label: 'Medium', width: 40, height: 30 },
  { id: 'large', label: 'Large', width: 60, height: 40 },
];

// Every cell of the floor with something drawn on it: what clearing erases.
export function drawnCells(floor) {
  const cells = new Set();
  for (let cell = 0; cell < floor.cells.length; cell += 1) if (floor.cells[cell] !== '.') cells.add(cell);
  for (const space of floor.spaces) for (const cell of space.cells) cells.add(cell);
  return Array.from(cells).sort((a, b) => a - b);
}

// What clearing the floor would say beside its button: { empty, removes, keeps }.
export function clearFloorWords(project, floor) {
  let rooms = 0;
  let otherSpaces = 0;
  let corridorCells = 0;
  for (const space of floor.spaces) {
    if (space.kind === 'room') rooms += 1;
    else otherSpaces += 1;
  }
  for (const character of floor.cells) if (character === '#') corridorCells += 1;
  // stairs and elevator stops are told apart by what the building says they are:
  // a cell of the floor given, an end of an elevator connection, or listed in `lifts`
  const elevatorEnds = new Set();
  for (const connection of project.building.connections) {
    if (connection.kind !== ELEVATOR_KIND) continue;
    for (const end of [connection.a, connection.b]) if (end.floorId === floor.id) elevatorEnds.add(end.cell);
  }
  const own = { stairsCells: 0, liftCells: 0, steps: (floor.notStepFree || []).length, refuges: (floor.refuges || []).length };
  for (let cell = floor.cells.indexOf('S'); cell !== -1; cell = floor.cells.indexOf('S', cell + 1)) {
    if (elevatorEnds.has(cell) || (floor.lifts || []).includes(cell)) own.liftCells += 1;
    else own.stairsCells += 1;
  }
  const touching = project.building.connections.filter((connection) => connection.a.floorId === floor.id || connection.b.floorId === floor.id);
  const stairsConnections = touching.filter((connection) => connection.kind !== ELEVATOR_KIND).length;
  const elevatorConnections = touching.length - stairsConnections;
  const parts = [
    rooms > 0 ? count(rooms, 'room') : null,
    otherSpaces > 0 ? count(otherSpaces, 'other space') : null,
    corridorCells > 0 ? count(corridorCells, 'corridor cell') : null,
    own.stairsCells > 0 ? count(own.stairsCells, 'stairs cell') : null,
    own.liftCells > 0 ? count(own.liftCells, 'elevator stop') : null,
    floor.corridors.length > 0 ? count(floor.corridors.length, 'corridor name') : null,
    floor.exits.length > 0 ? count(floor.exits.length, 'exit') : null,
    stairsConnections > 0 ? count(stairsConnections, 'stairs connection') : null,
    elevatorConnections > 0 ? count(elevatorConnections, 'elevator connection') : null,
    own.steps > 0 ? count(own.steps, 'step cell') : null,
    own.refuges > 0 ? count(own.refuges, 'area of refuge', 'areas of refuge') : null,
  ].filter(Boolean);
  if (parts.length === 0) return { empty: true, removes: 'Nothing is drawn on ' + floor.name + ', so there is nothing to clear.', keeps: '' };
  return {
    empty: false,
    removes: 'Removes everything drawn on ' + floor.name + ': ' + list(parts) + '.',
    keeps: 'The floor stays, empty, with its name, level, size, traced image and the areas left out of the colour scale. A group in a room that goes keeps the room\'s number, which reads "not in the building". Undo brings it all back, and a snapshot of the project as it was is kept too when this device has room for one.',
  };
}

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
    if (!/^\d+$/.test(parts.width.value.trim()) || !/^\d+$/.test(parts.height.value.trim())) return { error: 'A size is two whole numbers of cells, each from ' + RANGES.floorSize[0] + ' to ' + RANGES.floorSize[1] + '.' };
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
        text = floor.name + ' would be ' + described.width + ' × ' + described.height + ' cells. '
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
    const before = store.project;
    const name = floor.name;
    let sentence = null;
    const outcome = ed().commit(resizeFloor, ask.payload, {
      done: (made) => {
        sentence = 'Resized ' + name + ' to ' + made.width + ' by ' + made.height + (described.losesData ? ', which removed ' + lossText(made.loss) : '') + '.';
        return sentence;
      },
      // a resize that cuts something off says so below, with an Undo of that step
      toast: described.losesData ? null : undefined,
    });
    if (outcome && described.losesData) await keptBefore('resize', 'Before resizing ' + name + ' to ' + outcome.width + ' × ' + outcome.height, before, sentence);
  }

  // ---------------------------------------------------------- clear

  // Called right after the change: the message that says what was done, with
  // an Undo of that step, at once; then the snapshot of `before`, kept after
  // the change was made, and a message that says whether it is there. That
  // one offers the Undo again only while the change is still the step Undo
  // takes back (an edit or a Ctrl+Z in the wait withdraws it), and otherwise
  // is the snapshot's sentence alone. The panel's data-snapshot says where
  // that stands, for tests: 'taking', then 'taken' or 'not-taken'.
  async function keptBefore(reason, name, before, sentence) {
    const step = undoForStep(store, ctx.undo);
    const offer = { label: 'Undo', run: () => step.run() };
    ctx.toast({ text: sentence, action: offer });
    element.dataset.snapshot = 'taking';
    const after = await snapshotAfter(reason, name, before);
    element.dataset.snapshot = after.taken ? 'taken' : 'not-taken';
    if (step.current) ctx.toast({ text: sentence + ' ' + after.said, action: offer });
    else ctx.toast({ text: after.alone });
  }

  async function clearFloor() {
    const before = store.project;
    const floor = before.building.floors.find((each) => each.id === state.floor.id);
    if (!floor) return;
    const words = clearFloorWords(before, floor);
    if (words.empty) {
      ctx.announce(words.removes);
      return;
    }
    const name = floor.name;
    let sentence = null;
    const outcome = ed().commit(eraseCells, { floorId: floor.id, cells: drawnCells(floor), whole: true }, {
      done: (made) => {
        sentence = 'Cleared ' + name + ', which removed ' + lossText(made.loss) + '.';
        return sentence;
      },
      same: words.removes,
      toast: null,
    });
    if (outcome) await keptBefore('clear-floor', 'Before clearing ' + name, before, sentence);
  }

  // ---------------------------------------------------------- build

  function build(floor) {
    const name = field({ id: 'floor-name', label: 'Floor name', name: 'floorName', value: floor.name, commit: (value) => store.apply(renameFloor, { id: state.floor.id, name: value }) });
    name.input.dataset.key = 'floor-name';
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
    const elevators = h('ul', { class: 'bi-rows', id: 'floor-elevators' });
    const noElevators = h('p', { class: 'bld-inspector__small', id: 'floor-no-elevators' });
    const steps = h('ul', { class: 'bi-rows', id: 'floor-steps' });
    const noSteps = h('p', { class: 'bld-inspector__small', id: 'floor-no-steps' });
    const corridors = h('ul', { class: 'bi-rows', id: 'floor-corridors' });
    const noCorridors = h('p', { class: 'bld-inspector__small' }, 'No corridor on this floor has a name yet. Choose the Name tool (N) and drag along a corridor.');
    const zones = h('ul', { class: 'bi-rows', id: 'floor-zones' });
    const noZones = h('p', { class: 'bld-inspector__small' }, 'Nothing on this floor is left out of the colour scale. A place that is busy by design, like the cafeteria doors, can be: choose the Leave out tool (Z) and drag a rectangle over it.');
    const clearSays = h('p', { id: 'floor-clear-says' });
    const clearKeeps = h('p', { class: 'bld-inspector__small', id: 'floor-clear-keeps' });
    const clearButton = h('button', { type: 'button', class: 'btn btn--danger', id: 'floor-clear', 'aria-describedby': 'floor-clear-says floor-clear-keeps', data: { key: 'clear' }, on: { click: () => clearFloor() } });
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
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'floor-width' }, 'Cells across'), width),
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'floor-height' }, 'Cells down'), height)),
        h('div', { class: 'bi-side' }, h('span', { class: 'field__label', id: 'floor-side-x-label' }, 'Add or cut across at the'), sideX.element),
        h('div', { class: 'bi-side' }, h('span', { class: 'field__label', id: 'floor-side-y-label' }, 'Add or cut down at the'), sideY.element),
        previewLine,
        h('div', { class: 'bi-buttons' }, resizeButton)),
      env.trace.controls.element,
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-connections-heading' }, heading('Stairs connections', 'floor-connections-heading'), connections, noConnections),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-elevators-heading' }, heading('Elevators', 'floor-elevators-heading'), elevators, noElevators),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-steps-heading' }, heading('Steps and areas of refuge', 'floor-steps-heading'), steps, noSteps),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-legend-heading' }, heading('What the marks look like', 'floor-legend-heading'), legend()),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-corridors-heading' }, heading('Corridor names', 'floor-corridors-heading'), corridors, noCorridors),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-zones-heading' }, heading('Left out of the colour scale', 'floor-zones-heading'), zones, noZones),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-clear-heading' }, heading('Clear', 'floor-clear-heading'), clearSays, clearKeeps, h('div', { class: 'bi-buttons' }, clearButton)),
      h('section', { class: 'bi-part', 'aria-labelledby': 'floor-delete-heading' }, heading('Delete', 'floor-delete-heading'), lastNote, h('div', { class: 'bi-buttons' }, remove)),
    );
    parts = {
      name, level, about, earlier, later, width, height, preview: previewLine, resize: resizeButton, sideX: 'right', sideY: 'bottom',
      connections: keyedList(connections), connectionsHost: connections, noConnections,
      elevators: keyedList(elevators), elevatorsHost: elevators, noElevators,
      steps: keyedList(steps), stepsHost: steps, noSteps,
      corridors: keyedList(corridors), corridorsHost: corridors, noCorridors,
      zones: keyedList(zones), zonesHost: zones, noZones,
      remove, lastNote, size: floor.width + 'x' + floor.height,
      clearSays, clearKeeps, clear: clearButton,
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

  // The elevators, the steps and the areas of refuge of this floor, as words (describeFloor).
  let crowded = false;
  // The aria-labels are set in sync(), from the floor as it is now: a resize moves columns
  // and rows, and the rows are kept (their keys do not hold the width).
  function syncStepFree(floor, building) {
    const described = describeFloor(building, floor.id);
    parts.elevatorsHost.hidden = described.elevators.length === 0;
    parts.noElevators.hidden = described.elevators.length > 0;
    parts.noElevators.textContent = 'There is no elevator stop on this floor. Open the menu on a corridor or stairs cell (right-click, or the Menu key) and choose Make this an elevator stop.';
    crowded = described.elevators.filter((stop) => !stop.connected).length > 1;
    parts.elevators.update(described.elevators, {
      key: (stop) => stop.carId + ':' + stop.cell + ':' + (stop.connected ? 'c' : 'u'),
      build: (stop) => {
        const text = h('p', { class: 'bi-row__text' });
        const buttons = [
          small('Show me', 'show-stop:' + stop.cell, '', () => env.show({ floorId: state.floor.id, cells: [stop.cell] })),
          small('Properties', 'stop-properties:' + stop.cell, '', () => {
            env.show({ floorId: state.floor.id, cells: [stop.cell] });
            focusCells(ed(), state.floor.id, [stop.cell]);
          }),
        ];
        if (!stop.connected) {
          buttons.push(small('Connect…', 'stop-connect:' + stop.cell, '', () => {
            if (ed().connect) ed().connect.start({ floorId: state.floor.id, cell: stop.cell });
          }));
        }
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { stop: String(stop.cell), connected: String(stop.connected) } }, text, h('div', { class: 'bi-row__buttons' }, buttons)),
          sync: (now) => {
            const here = state.floor;
            const where = cellWords(here, now.cell);
            text.textContent = now.connected
              ? 'Elevator ' + now.label + ': ' + list(now.floors) + (now.staffOnly ? ' · staff only' : '')
              // two stops on one floor that are not connected are told apart by where they are
              : here.name + ' stop' + (crowded ? ' at ' + where : '') + ': not connected';
            const [showMe, properties, connect] = buttons;
            showMe.setAttribute('aria-label', 'Show me: the elevator stop at ' + where);
            properties.setAttribute('aria-label', 'Properties of the elevator stop at ' + where);
            if (connect) connect.setAttribute('aria-label', 'Connect… the elevator stop at ' + where + ' to another floor');
          },
        };
      },
    });

    const none = described.steps.length === 0 && described.refuges.length === 0;
    parts.stepsHost.hidden = none;
    parts.noSteps.hidden = !none;
    parts.noSteps.textContent = 'No step and no area of refuge is marked on this floor. Open the menu on a corridor cell (right-click, or the Menu key) and choose Step here or Make this an area of refuge.';
    const entries = described.steps.map((run, index) => ({ type: 'step', id: 'step:' + run.cells[0], run, index })).concat(described.refuges.map((refuge) => ({ type: 'refuge', id: 'refuge:' + refuge.id, refuge })));
    parts.steps.update(entries, {
      key: (entry) => entry.id,
      build: (entry) => {
        const text = h('p', { class: 'bi-row__text' });
        const show = (cells) => env.show({ floorId: state.floor.id, cells });
        const buttons = entry.type === 'step'
          ? [
            small('Show me', 'show-' + entry.id, '', () => {
              const now = describeFloor(state.project.building, state.floor.id).steps.find((run) => run.cells[0] === entry.run.cells[0]);
              if (now) show(now.cells);
            }),
            small('Clear the step', 'clear-' + entry.id, '', () => {
              const now = describeFloor(state.project.building, state.floor.id).steps.find((run) => run.cells[0] === entry.run.cells[0]);
              if (!now) return;
              // the row is replaced by the redraw: the next row (else the floor's name field) takes the focus
              commitKeepingFocus(element, ['floor-name'], () => ed().commit(setStepCells, { floorId: state.floor.id, cells: now.cells, stepFree: true }, { done: (made) => 'Cleared the step from ' + count(made.changed, 'cell') + '.' }));
            }),
          ]
          : [small('Show me', 'show-' + entry.id, '', () => {
            const now = describeFloor(state.project.building, state.floor.id).refuges.find((refuge) => refuge.id === entry.refuge.id);
            if (now) show([now.cell]);
          })];
        return {
          element: h('li', { class: 'bi-row bi-row--stack', data: { mark: entry.id } }, text, h('div', { class: 'bi-row__buttons' }, buttons)),
          sync: (now) => {
            text.textContent = now.type === 'step' ? now.run.text : now.refuge.text;
            if (now.type === 'step') {
              const where = cellWords(state.floor, now.run.cells[0]);
              buttons[0].setAttribute('aria-label', 'Show me: the step at ' + where);
              buttons[1].setAttribute('aria-label', 'Clear the step at ' + where);
            } else {
              buttons[0].setAttribute('aria-label', 'Show me: the area of refuge ' + now.refuge.name);
            }
          },
        };
      },
    });
  }

  function syncLists() {
    const { project, floor } = state;
    const building = project.building;
    const floorName = (id) => (building.floors.find((each) => each.id === id) || { name: 'a floor that is gone' }).name;

    // stairs only: an elevator is listed under its own heading below
    const links = building.connections.filter((connection) => connection.kind !== ELEVATOR_KIND && (connection.a.floorId === floor.id || connection.b.floorId === floor.id));
    const stairsCells = counts(building).byFloor[floor.id].stairsCells;
    parts.connectionsHost.hidden = links.length === 0;
    parts.noConnections.hidden = links.length > 0;
    parts.noConnections.textContent = stairsCells > 0
      ? 'No stairs on this floor are connected yet. Open the menu on a stairs cell (right-click, or the Menu key) and choose Connect.'
      : 'There are no stairs on this floor yet. Place some with the Stairs tool (S), then connect them to the stairs on another floor.';

    syncStepFree(floor, building);
    parts.connections.update(links, {
      key: (connection) => connection.id,
      build: (connection) => {
        const label = field({ label: 'Letter or name', value: connection.label, commit: (value) => store.apply(setConnection, { connectionId: connection.id, label: value }) });
        label.input.dataset.key = 'connection:' + connection.id;
        const where = h('p', { class: 'bld-inspector__small' });
        // which way the stairs may be walked: radio chips, rebuilt when the words change
        const legendId = 'bi-way-legend-' + connection.id;
        const wayHost = h('fieldset', { class: 'bi-way', data: { way: connection.id } }, h('legend', { class: 'bi-way__legend', id: legendId }, 'Which way'));
        let wayShown = '';
        const syncWay = (now) => {
          const choices = wayChoices(state.project, now);
          const shown = choices.map((each) => each.value + ':' + each.label).join('|');
          if (shown !== wayShown) {
            wayShown = shown;
            const focused = wayHost.contains(document.activeElement) ? document.activeElement.value : null;
            Array.from(wayHost.querySelectorAll('.bi-way__chip')).forEach((chip) => chip.remove());
            for (const option of choices) {
              const input = h('input', { type: 'radio', class: 'bi-way__input', name: 'way-' + now.id, value: option.value, data: { key: 'way:' + now.id + ':' + option.value } });
              input.addEventListener('change', () => {
                if (!input.checked) return;
                const latest = state.project.building.connections.find((each) => each.id === now.id);
                if (!latest || latest.direction === option.value) return;
                const said = 'Stairs ' + latest.label + (option.value === 'both' ? ' now runs both ways.' : ' is now ' + option.label.charAt(0).toLowerCase() + option.label.slice(1) + '.');
                ed().commit(setConnection, { connectionId: now.id, direction: option.value }, { done: () => said, toast: () => said });
              });
              wayHost.append(h('label', { class: 'bi-way__chip' }, input, h('span', { class: 'bi-way__text' }, option.label)));
            }
            if (focused !== null) {
              const again = wayHost.querySelector('input[value="' + focused + '"]');
              if (again) again.focus();
            }
          }
          for (const input of wayHost.querySelectorAll('.bi-way__input')) input.checked = input.value === now.direction;
        };
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
          element: h('li', { class: 'bi-row bi-row--stack', data: { connection: connection.id } }, label.element, where, wayHost, h('div', { class: 'bi-row__buttons' }, buttons)),
          sync: (now) => {
            label.set(now.label);
            const same = now.a.floorId === now.b.floorId;
            where.textContent = same
              ? 'Joins two places on ' + floorName(now.a.floorId) + ': ' + cellWords(floor, now.a.cell) + ' and ' + cellWords(floor, now.b.cell) + '.'
              : 'Joins ' + floorName(now.a.floorId) + ' and ' + floorName(now.b.floorId) + '.';
            const way = wayLine(state.project, now);
            if (way !== '') where.textContent += ' Stairs ' + now.label + ' is ' + way + '.';
            syncWay(now);
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
            where.textContent = now.w + ' × ' + now.h + ' cells from column ' + (now.x + 1) + ', row ' + (now.y + 1) + '.';
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
    parts.about.textContent = floor.name + ' is ' + floor.width + ' × ' + floor.height + ' cells.' + (floors.length > 1 ? ' It is floor ' + (at + 1) + ' of ' + floors.length + ' in the tabs.' : '');
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
    const clearing = clearFloorWords(project, floor);
    parts.clearSays.textContent = clearing.removes;
    parts.clearKeeps.textContent = clearing.keeps;
    parts.clearKeeps.hidden = clearing.empty;
    parts.clear.textContent = 'Clear ' + floor.name;
    parts.clear.setAttribute('aria-disabled', String(clearing.empty));
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
