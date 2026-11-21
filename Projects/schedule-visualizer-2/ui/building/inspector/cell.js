// Properties of a cell, when no room or other space is selected (DESIGN 13.2,
// 13.3): an elevator stop, corridor cells whose step is marked, the area of
// refuge on a cell, any cell at all with its "Marks…" button.
//
// Which cells it is about is kept in ./cell-focus.js (the plan's own selection
// holds spaces only). Every change here is one store action through the
// editor; each says what it did, in the live region.
//
//   cellPanel(env) -> { render(state, focus) -> nodes }
//     env: { ctx, store, editor(), show(where, say) }
//
// The panel is drawn again whenever what it shows changes (a signature of the
// data), and the focus goes back to the control that had it, by key.

import { h } from '../../components/dom.js';
import { field } from '../../components/field.js';
import { count, list, pendingElevatorLetter } from '../../components/words.js';
import { describeCell } from '../../../engine/building.js';
import { elevatorSettings, elevatorCars, CELL_CORRIDOR, neighbourCell, stairsLetter } from '../../../engine/schema.js';
import { setElevator, disconnectStairs, setStepCells, addRefuge, setRefuge, removeRefuge } from '../../../engine/actions.js';
import { removeStairwellStop, splitStairwell, setStairwellDirection, setStairwellLetter } from '../../../engine/stairwells.js';
import { checkField, keepFocus, commitKeepingFocus, heading, cellWords } from './controls.js';
import { cellFocus } from './cell-focus.js';
import { openCellMenu, stairwellAt } from '../menu.js';
import { stairwellFacts, offerOfRun, openMakeStairwell } from '../stairwell.js';
import { stepFreeWaysOut } from '../../../engine/evacuation.js';

const SIDES = ['n', 'e', 's', 'w'];
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

function isCorridor(floor, cell) {
  return cell !== -1 && floor.cells[cell] === CELL_CORRIDOR;
}

// A junction: a corridor cell with corridor on three or four sides.
function isJunction(floor, cell) {
  return SIDES.filter((side) => isCorridor(floor, neighbourCell(floor, cell, side))).length >= 3;
}

// What "Select this corridor" selects: the named corridor the cell is in, else
// its straight stretch (the longer way it can be followed) up to the next
// junction on each side, the junction itself left out.
// -> { cells, named: name or '' }
export function corridorStretch(floor, cell) {
  const named = floor.corridors.find((corridor) => corridor.cells.includes(cell));
  if (named) return { cells: named.cells.slice().sort((a, b) => a - b), named: named.name };
  const walk = (a, b) => {
    const cells = [cell];
    for (const side of [a, b]) {
      for (let next = neighbourCell(floor, cell, side); isCorridor(floor, next) && !isJunction(floor, next); next = neighbourCell(floor, next, side)) cells.push(next);
    }
    return cells;
  };
  const across = walk('w', 'e');
  const down = walk('n', 's');
  const run = down.length > across.length ? down : across;
  return { cells: run.sort((a, b) => a - b), named: '' };
}

// The connection through which each other stop of a car is reached from this
// one, found by walking the car's connections outwards. Disconnecting that
// connection cuts the stop (and any stops beyond it) off from this one.
function reachedThrough(building, car, here) {
  const members = building.connections.filter((connection) => car.connectionIds.includes(connection.id));
  const key = (end) => end.floorId + ':' + end.cell;
  const through = new Map();
  const seen = new Set([key(here)]);
  const queue = [key(here)];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const connection of members) {
      const ends = [connection.a, connection.b];
      const here0 = ends.find((end) => key(end) === at);
      if (!here0) continue;
      const other = ends.find((end) => end !== here0);
      if (seen.has(key(other))) continue;
      seen.add(key(other));
      through.set(key(other), connection);
      queue.push(key(other));
    }
  }
  return through;
}

// How many rooms leave through this area of refuge (SV2-100's stepFreeWaysOut),
// or null when that cannot be worked out: then nothing is said, and the error is
// in the console. It is part of the panel's model, so a door or an exit ticked
// elsewhere redraws the number.
function refugeUse(project, refugeId) {
  try {
    const found = stepFreeWaysOut(project).refuges.find((each) => each.refugeId === refugeId);
    return found ? found.roomIds.length : 0;
  } catch (error) {
    console.error('Could not count the rooms that use an area of refuge:', error);
    return null;
  }
}

export function cellPanel(env) {
  const { store, ctx } = env;
  const ed = () => env.editor();

  const button = (label, key, run, extra) => h('button', { type: 'button', class: 'btn' + (extra && extra.quiet ? ' btn--quiet bi-small' : ''), data: { key, action: key.split(':')[0] }, 'aria-label': extra && extra.aria, on: { click: run } }, label);

  // A change that replaces the button that was pressed: the focus goes to the heir
  const keeping = (fallback, run) => commitKeepingFocus(holder.host || document.body, fallback, run);

  // Put the keyboard back in the panel after Show moved the plan to another floor.
  function landInPanel() {
    const title = document.querySelector('#inspector-properties [data-key="panel-title"]');
    if (title) title.focus({ preventScroll: true });
  }

  function showStop(floorId, cell, say) {
    env.show({ floorId, cells: [cell] }, say);
    cellFocus(ed()).set(floorId, [cell]);
    ed().select([]);
    landInPanel();
  }

  // ---------------------------------------------------------- an elevator stop

  function elevatorModel(state, focus, at) {
    const building = state.project.building;
    const floor = state.floor;
    const cell = focus.cells[0];
    const car = at.elevator;
    const full = require0(building, floor.id, cell);
    const others = [];
    if (car && full) {
      const through = reachedThrough(building, full, { floorId: floor.id, cell });
      for (const stop of full.stops) {
        if (stop.floorId === floor.id && stop.cell === cell) continue;
        const floorName = building.floors.find((each) => each.id === stop.floorId).name;
        const link = through.get(stop.floorId + ':' + stop.cell);
        others.push({ floorId: stop.floorId, cell: stop.cell, floorName, connectionId: link ? link.id : null });
      }
    }
    return {
      kind: 'elevator',
      cell,
      floorName: floor.name,
      carId: car ? car.carId : null,
      label: car && car.label !== '' ? car.label : pendingElevatorLetter(building),
      connected: Boolean(car && car.connected),
      staffOnly: Boolean(car && car.staffOnly),
      floors: car ? car.floors : [floor.name],
      others,
      timings: elevatorSettings(state.project.settings),
      connectable: Boolean(ed().connect),
    };
  }

  // the car (elevatorCars entry) this stop belongs to
  function require0(building, floorId, cell) {
    return elevatorCars(building).find((car) => car.stops.some((stop) => stop.floorId === floorId && stop.cell === cell)) || null;
  }

  function drawElevator(model) {
    const name = 'Elevator ' + model.label;
    const nodes = [
      h('h2', { class: 'bld-inspector__title', id: 'inspector-title', tabindex: '-1', data: { key: 'panel-title' } }, model.connected ? name : name + ', not connected'),
      h('p', { class: 'bi-lead', id: 'stop-floors' }, model.connected ? 'Stops at ' + list(model.floors) + '.' : 'This stop is on ' + model.floorName + ' and is not connected to a stop on another floor yet.'),
    ];
    if (model.connected) {
      const staff = checkField({
        id: 'stop-staff-only',
        label: name + ': staff and authorised only (all stops)',
        hint: 'Students on step-free routes, and staff, may use it; other students\' routes do not. Untick it only if everyone may.',
        name: 'elevatorStaffOnly',
        key: 'staff-only',
        checked: model.staffOnly,
        commit: (on) => {
          const outcome = ed().commit(setElevator, { carId: model.carId, staffOnly: on }, {
            done: (made) => 'Applied to ' + count(made.stops, 'stop') + '.',
            same: 'Applied to ' + count(model.others.length + 1, 'stop') + ': nothing changed.',
          });
          if (outcome === null && on === model.staffOnly) return;
          if (outcome === null) throw new Error('That could not be applied. The tick is back as it was.');
        },
      });
      nodes.push(staff.element);
    }
    const t = model.timings;
    nodes.push(h('p', { class: 'bld-inspector__small', id: 'stop-timings' },
      'Wait ' + t.wait + ' s · ' + t.perFloor + ' s a floor · ' + count(t.perTrip, 'person', 'people') + ' a trip · change in ',
      h('a', { href: '#project', class: 'bi-link', id: 'stop-settings-link' }, 'Project › Settings'),
      '.'));
    if (model.connectable) {
      nodes.push(h('div', { class: 'bi-buttons' }, button('Connect to another floor…', 'stop-connect', () => {
        const at = ed().floor;
        ed().connect.start({ floorId: at.id, cell: model.cell });
      })));
    }
    if (model.others.length > 0) {
      nodes.push(heading('The other stops', 'stop-others-heading'));
      nodes.push(h('ul', { class: 'bi-rows', id: 'stop-others', 'aria-labelledby': 'stop-others-heading' }, ...model.others.map((stop) => h('li', { class: 'bi-row', data: { stop: stop.floorId + ':' + stop.cell } },
        h('span', { class: 'bi-row__text' }, stop.floorName),
        button('Show', 'show-stop:' + stop.floorId, () => showStop(stop.floorId, stop.cell, 'Showing the stop of ' + name + ' on ' + stop.floorName + '.'), { quiet: true, aria: 'Show the ' + name + ' stop on ' + stop.floorName }),
        stop.connectionId === null ? null : button('Disconnect', 'disconnect-stop:' + stop.floorId, () => {
          keeping(['panel-title'], () => ed().commit(disconnectStairs, { connectionId: stop.connectionId }, { done: () => 'Disconnected ' + stop.floorName + ' from ' + name + '. The stop stays where it is.' }));
        }, { quiet: true, aria: 'Disconnect the ' + stop.floorName + ' stop from ' + model.floorName + ' (' + name + ')' }),
      ))));
    }
    return nodes;
  }

  // ---------------------------------------------------------- corridor cells

  function corridorModel(state, focus) {
    const floor = state.floor;
    const corridor = focus.cells.filter((cell) => isCorridor(floor, cell));
    const marked = corridor.filter((cell) => (floor.notStepFree || []).includes(cell));
    const first = focus.cells[0];
    const at = focus.cells.length === 1 ? describeCell(state.project.building, floor.id, first) : null;
    return {
      kind: 'corridor',
      cells: focus.cells,
      corridor,
      marked: marked.length,
      skipped: focus.cells.length - corridor.length,
      where: focus.cells.length === 1 ? floor.name + ', ' + cellWords(floor, first) : floor.name + ', ' + count(focus.cells.length, 'cell') + ' selected',
      name: at ? at.corridorName : '',
      exit: at && at.exit ? at.exit.doorName : null,
      refuge: at && at.refuge ? { id: at.refuge.id, name: at.refuge.name, used: refugeUse(state.project, at.refuge.id) } : null,
      floorId: floor.id,
    };
  }

  function stepTick(model) {
    const n = model.corridor.length;
    const label = 'Step here (blocks step-free routes)' + (n > 1 ? ', ' + n + ' cells selected' : '');
    const tick = checkField({
      id: 'cell-step',
      label,
      hint: model.skipped > 0 ? count(model.skipped, 'selected cell') + (model.skipped === 1 ? ' is' : ' are') + ' not corridor and ' + (model.skipped === 1 ? 'is' : 'are') + ' left out.' : null,
      name: 'cellStep',
      key: 'step',
      checked: model.marked === n,
      mixed: model.marked > 0 && model.marked < n,
      commit: (on) => {
        const outcome = ed().commit(setStepCells, { floorId: model.floorId, cells: model.cells, stepFree: !on }, {
          done: (made) => (on
            ? 'Marked ' + count(made.changed, 'cell') + (made.skipped > 0 ? '; ' + made.skipped + ' skipped, not corridor' : '') + '.'
            : 'Cleared the step from ' + count(made.changed, 'cell') + (made.skipped > 0 ? '; ' + made.skipped + ' skipped, not corridor' : '') + '.'),
          same: 'Nothing changed: the cells were marked that way already.',
        });
        if (outcome === null) throw new Error('The step could not be changed. The tick is back as it was.');
      },
    });
    // a native checkbox with `indeterminate` is "mixed" to a screen reader; no aria-checked to keep in step
    tick.input.dataset.mixed = String(model.marked > 0 && model.marked < n);
    return tick;
  }

  function drawCorridor(model) {
    const title = model.cells.length === 1 ? (model.name === '' ? 'Corridor cell' : 'Corridor cell, ' + model.name) : count(model.cells.length, 'cell') + ' selected';
    const nodes = [
      h('h2', { class: 'bld-inspector__title', id: 'inspector-title', tabindex: '-1', data: { key: 'panel-title' } }, title),
      h('p', { class: 'bi-lead', id: 'cell-where' }, model.where + '.'),
    ];
    if (model.corridor.length > 0) {
      nodes.push(stepTick(model).element);
      nodes.push(h('div', { class: 'bi-buttons' }, button('Select this corridor', 'select-corridor', () => selectCorridor(model))));
    } else {
      nodes.push(h('p', { class: 'bld-inspector__small' }, 'None of the selected cells is corridor, so there is no step to mark here.'));
    }
    if (model.exit !== null) nodes.push(h('p', { class: 'bld-inspector__small' }, 'This cell is an exit' + (model.exit.trim() === '' ? '' : ', ' + model.exit) + '. Its step-free tick is in the Exits tab.'));
    if (model.cells.length === 1) nodes.push(...refugeNodes(model));
    return nodes;
  }

  function selectCorridor(model) {
    const { state } = holder;
    const first = model.cells[0];
    const stretch = corridorStretch(state.floor, first);
    const said = stretch.named !== ''
      ? 'Selected the corridor ' + stretch.named + ', ' + count(stretch.cells.length, 'cell') + '.'
      : 'Selected the stretch of corridor between junctions, ' + count(stretch.cells.length, 'cell') + '.';
    cellFocus(ed()).set(state.floor.id, stretch.cells);
    env.show({ floorId: state.floor.id, cells: stretch.cells }, said);
    ed().select([]);
    // the tick of the new selection takes the focus, so a keyboard user can mark it at once
    const tick = document.querySelector('#inspector-properties [data-key="step"]');
    if (tick) tick.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------- an area of refuge

  function refugeNodes(model) {
    const floorId = model.floorId;
    const cell = model.cells[0];
    if (!model.refuge) {
      return [h('div', { class: 'bi-buttons' }, button('Make this an area of refuge', 'make-refuge', () => {
        keeping(['refuge-name', 'panel-title'], () => ed().commit(addRefuge, { floorId, cell }, { done: (made) => 'Made the cell ' + made.name + ', an area of refuge.' }));
      }))];
    }
    const refuge = model.refuge;
    const name = field({
      id: 'refuge-name',
      label: 'Area of refuge: name',
      name: 'refugeName',
      value: refuge.name,
      commit: (value) => {
        store.apply(setRefuge, { floorId, refugeId: refuge.id, name: value });
        ctx.announce('Named the area of refuge ' + value + '.');
      },
    });
    name.input.dataset.key = 'refuge-name';
    const used = refuge.used;
    return [
      heading('Area of refuge', 'refuge-heading'),
      name.element,
      used === null ? null : h('p', { class: 'bld-inspector__small', id: 'refuge-used' }, used === 0 ? 'Not used by any room.' : 'Used by ' + count(used, 'room') + '.'),
      h('div', { class: 'bi-buttons' }, button('Remove ' + refuge.name, 'remove-refuge', () => {
        keeping(['panel-title'], () => ed().commit(removeRefuge, { floorId, refugeId: refuge.id }, { done: () => 'Took the area of refuge ' + refuge.name + ' off. The cell stays.' }));
      }, { aria: 'Remove ' + refuge.name + ', area of refuge' })),
    ];
  }

  // ---------------------------------------------------------- any other cell

  function plainModel(state, focus, at) {
    const floor = state.floor;
    const cell = focus.cells[0];
    const building = state.project.building;
    // a stop of a stairwell is the stairwell's; a stair of plain flights may offer to become one
    const wellHere = at.kind === 'stairs' ? stairwellAt(building, floor.id, cell, at.connections) : null;
    const facts = wellHere ? stairwellFacts(state.project, wellHere.letter) : null;
    const plain = at.connections.filter((connection) => !(facts && connection.well));
    let offer = null;
    if (!facts && plain.length > 0) {
      const found = offerOfRun(state.project, plain[0].id);
      if (found) offer = { connectionId: plain[0].id, sentence: 'Stairs ' + list(found.letters) + ' join ' + found.floors[0] + ' to ' + found.floors[found.floors.length - 1] + '. As one stairwell they show one letter, ' + found.letter + ', on every floor.' };
    }
    return {
      kind: at.kind,
      cell,
      where: floor.name + ', ' + cellWords(floor, cell),
      connections: plain.map((connection) => stairsLetter(connection)),
      // at a stop of a stairwell, the plain flights that land here too: shown under it, each with Disconnect, as the menu offers
      others: facts ? plain.map((connection) => {
        const names = [connection.a, connection.b].map((end) => (building.floors.find((each) => each.id === end.floorId) || { name: 'a floor that is gone' }).name);
        return { id: connection.id, letter: stairsLetter(connection), joins: names[0] === names[1] ? 'two places on ' + names[0] : names[0] + ' and ' + names[1] };
      }) : [],
      well: facts,
      offer,
      refuge: at.refuge ? { id: at.refuge.id, name: at.refuge.name, used: refugeUse(state.project, at.refuge.id) } : null,
      cells: [cell],
      floorId: floor.id,
    };
  }

  // ---------------------------------------------------------- a stairwell (DESIGN 16.7)

  const WAYS = [{ value: 'both', label: 'Both ways' }, { value: 'up', label: 'Up only' }, { value: 'down', label: 'Down only' }];

  function wellNodes(model) {
    const well = model.well;
    const name = 'Stairwell ' + well.letter;
    const letter = field({
      id: 'stairwell-letter-field',
      label: 'Letter or name',
      name: 'stairwellLetter',
      value: well.letter,
      // a refusal is the field's own, under it, in the engine's words
      commit: (value) => {
        store.apply(setStairwellLetter, { well: well.letter, letter: value });
        ctx.announce((store.undoOutcome || {}).text || 'Renamed the stairwell.');
      },
    });
    letter.input.dataset.key = 'well-letter';
    // which way, for the whole stairwell: the chips of one stair, applied to every flight
    const legendId = 'well-way-legend';
    const ways = h('fieldset', { class: 'bi-way', data: { way: 'well' } }, h('legend', { class: 'bi-way__legend', id: legendId }, 'Which way'),
      ...WAYS.map((option) => {
        const input = h('input', { type: 'radio', class: 'bi-way__input', name: 'well-way', value: option.value, data: { key: 'well-way:' + option.value } });
        input.checked = well.way === option.value;
        input.addEventListener('change', () => {
          if (!input.checked) return;
          const outcome = ed().commit(setStairwellDirection, { well: well.letter, direction: option.value }, { done: (made) => made.text, toast: (made) => made.text });
          // refused: the choice there was before is ticked again (none where the flights differ)
          if (outcome === null) for (const each of ways.querySelectorAll('.bi-way__input')) each.checked = each.value === well.way;
        });
        return h('label', { class: 'bi-way__chip' }, input, h('span', { class: 'bi-way__text' }, option.label));
      }));
    const stops = h('ul', { class: 'bi-rows', id: 'well-stops', 'aria-label': 'The stops of ' + name },
      ...well.stops.map((stop) => {
        const here = stop.floorId === model.floorId && stop.cell === model.cell;
        const two = well.stops.length <= 2;
        const row = [
          h('span', { class: 'bi-row__text' }, stop.floorName + (here ? ' (this stop)' : '')),
          button('Show', 'show-stop:' + stop.floorId, () => showStop(stop.floorId, stop.cell, 'Showing the stop of ' + name + ' on ' + stop.floorName + '.'), { quiet: true, aria: 'Show the ' + name + ' stop on ' + stop.floorName }),
        ];
        if (two) {
          // two stops are one flight: Disconnect, as for any stairs
          if (here) row.push(button('Disconnect', 'disconnect-well', () => {
            keeping(['panel-title'], () => ed().commit(disconnectStairs, { connectionId: well.flightIds[0] }, { done: () => 'Disconnected ' + name + '. Its stairs stay, not connected.' }));
          }, { quiet: true, aria: 'Disconnect: ' + name + ' has only two stops' }));
        } else {
          row.push(button('Remove from stairwell', 'remove-stop:' + stop.floorId, () => {
            keeping(['panel-title'], () => ed().commit(removeStairwellStop, { well: well.letter, floorId: stop.floorId }, { done: (made) => made.text, toast: (made) => made.text }));
          }, { quiet: true, aria: 'Remove from stairwell: ' + stop.floorName + ' (' + name + ')' }));
        }
        return h('li', { class: 'bi-row', data: { stop: stop.floorId + ':' + stop.cell } }, ...row);
      }));
    const nodes = [
      h('h2', { class: 'bld-inspector__title', id: 'inspector-title', tabindex: '-1', data: { key: 'panel-title' } }, name),
      h('p', { class: 'bi-lead', id: 'cell-where' }, model.where + '.'),
      h('p', { class: 'bi-lead', id: 'well-floors' }, well.sentence),
      letter.element,
      ways,
      h('p', { class: 'bld-inspector__small', id: 'well-way-says' }, well.way === 'mixed' ? 'The flights run different ways; choose one to set them all.' : name + ' runs ' + well.wayWords + '. Applied to ' + count(well.flights, 'flight') + '.'),
      heading('Stops', 'well-stops-heading'),
      stops,
      h('div', { class: 'bi-buttons' },
        button('Connect another floor…', 'well-connect', () => {
          if (ed().connect) ed().connect.start({ floorId: model.floorId, cell: model.cell });
        }),
        button('Split into separate stairs', 'well-split', () => {
          keeping(['panel-title'], () => ed().commit(splitStairwell, { well: well.letter }, { done: (made) => made.text, toast: (made) => made.text }));
        })),
    ];
    if (well.parts > 1) nodes.push(h('p', { class: 'bld-inspector__small', id: 'well-parts' }, name + ' is in ' + well.parts + ' parts that share no stairs. Building checks offers to join them.'));
    if (model.others.length > 0) {
      nodes.push(heading('Other stairs at this stop', 'well-others-heading'));
      nodes.push(h('ul', { class: 'bi-rows', id: 'well-others', 'aria-label': 'Other stairs at this stop' },
        ...model.others.map((other) => h('li', { class: 'bi-row', data: { other: other.id } },
          h('span', { class: 'bi-row__text' }, 'Stairs ' + other.letter + ': joins ' + other.joins),
          button('Disconnect', 'disconnect-other:' + other.id, () => {
            keeping(['panel-title'], () => ed().commit(disconnectStairs, { connectionId: other.id }, { done: () => 'Disconnected stairs ' + other.letter + '.' }));
          }, { quiet: true, aria: 'Disconnect stairs ' + other.letter })))));
    }
    return nodes;
  }

  function drawPlain(model) {
    if (model.kind === 'stairs' && model.well) return [...wellNodes(model), ...refugeNodes(model)];
    const words = { stairs: 'Stairs cell', empty: 'Empty cell', room: 'Room cell', other: 'Cell of an other space' };
    const title = model.kind === 'stairs' && model.connections.length > 0 ? 'Stairs ' + model.connections.join(' and ') : model.kind === 'stairs' ? 'Stairs, not connected' : words[model.kind] || 'Cell';
    const nodes = [
      h('h2', { class: 'bld-inspector__title', id: 'inspector-title', tabindex: '-1', data: { key: 'panel-title' } }, title),
      h('p', { class: 'bi-lead', id: 'cell-where' }, model.where + '.'),
    ];
    if (model.kind === 'stairs') {
      nodes.push(h('div', { class: 'bi-buttons' }, button('Connect these stairs…', 'stairs-connect', () => {
        if (ed().connect) ed().connect.start({ floorId: model.floorId, cell: model.cell });
      })));
      if (model.offer) {
        nodes.push(h('p', { class: 'bi-lead', id: 'well-offer' }, model.offer.sentence));
        nodes.push(h('div', { class: 'bi-buttons' }, button('Make one stairwell', 'well-make', () => {
          openMakeStairwell(ed(), model.offer.connectionId, document.querySelector('#inspector-properties [data-key="well-make"]'));
        })));
      }
      nodes.push(...refugeNodes(model));
    }
    return nodes;
  }

  // ---------------------------------------------------------- the whole panel

  const holder = { state: null, host: null };
  let signature = null;
  let marks = null;

  // render(state, focus) -> the nodes for the panel, or null when nothing has changed
  function render(state, focus, host) {
    holder.state = state;
    holder.host = host;
    const building = state.project.building;
    const first = focus.cells[0];
    const at = describeCell(building, state.floor.id, first);
    if (!at) return false;
    let model;
    let draw;
    const anyCorridor = focus.cells.some((cell) => isCorridor(state.floor, cell));
    if (focus.cells.length === 1 && at.kind === 'elevator') {
      model = elevatorModel(state, focus, at);
      draw = drawElevator;
    } else if (anyCorridor) {
      model = corridorModel(state, focus);
      draw = drawCorridor;
    } else {
      model = plainModel(state, focus, at);
      draw = drawPlain;
    }
    const next = JSON.stringify(model) + '@' + state.floor.id;
    if (next === signature) return true;
    signature = next;
    keepFocus(host, () => {
      // the menu is about one cell: with several selected the Step tick covers them, and Marks… is not offered
      if (focus.cells.length === 1) {
        marks = button('Marks…', 'marks', () => openCellMenu(ed(), focus.cells[0], marks), { aria: 'Marks… and other changes for this cell' });
        marks.setAttribute('aria-haspopup', 'menu');
        marks.id = 'cell-marks';
      } else {
        marks = null;
      }
      host.replaceChildren(...draw(model), ...(marks ? [h('div', { class: 'bi-buttons bi-buttons--marks' }, marks)] : []));
    });
    return true;
  }

  // the panel is gone: the next cell drawn is drawn whole
  function forget() {
    signature = null;
  }

  return { render, forget };
}
