// Connect mode (spec 4.5, DESIGN 5.1): "Connect…" on one stairs cell, then a
// click on the other, on any floor. While it lasts a banner across the top of
// the plan says what to do; the mode outlives a change of floor and ends on
// Escape, on the banner's button, or when the stairs it started from are gone.
//
// The same mode serves an elevator (DESIGN 13.2): "Connect…" on one elevator
// stop. The banner then names the car ("Connecting Elevator D: click its stop
// on another floor."), has a 44 px Cancel and a list of the stops it can join,
// each with "Connect here", so a keyboard or phone user never has to find a
// cell on another floor. A refusal is said in the banner's own live region
// and the mode goes on. After a join the banner says what the car serves and
// offers "Connect another floor" and "Done". Focus goes to the banner when the
// mode starts and back to the stop when it ends.
//
// A connection between two stairs on one floor is unusual (a split level, a
// detached part of the building), so the tool asks first.

import { h } from '../components/dom.js';
import { connectStairs, describeConnect, ActionError } from '../../engine/actions.js';
import { CELL_STAIRS, elevatorCars, isLiftCell, nextConnectionLabel } from '../../engine/schema.js';
import { list, pendingElevatorLetter } from '../components/words.js';
import { inspectorSheet } from './inspector/sheet.js';

// How far a press may move and still be a click on a cell.
const CLICK_SLOP = 6;

// createConnect(ed, { stage }) -> { start({ floorId, cell }), cancel(), active, update(project), detach() }
export function createConnect(ed, options) {
  inspectorSheet();
  const ctx = ed.ctx;
  const canvas = ed.canvas;
  const words = h('p', { class: 'bld-connect__text', id: 'connect-text' });
  // a finger's size, whatever the sheet says (the banner's buttons)
  const FINGER = 'min-height: 44px; min-width: 44px';
  const stop = h('button', { type: 'button', class: 'btn', id: 'connect-cancel', style: FINGER, on: { click: () => cancel(true) } }, 'Cancel');
  const another = h('button', { type: 'button', class: 'btn', id: 'connect-another', style: FINGER, hidden: true, on: { click: () => again() } }, 'Connect another floor');
  const finished = h('button', { type: 'button', class: 'btn', id: 'connect-done', style: FINGER, hidden: true, on: { click: () => finish() } }, 'Done');
  // a refusal, in words, where it can be read and heard (the banner is a live region)
  const note = h('p', { class: 'bld-connect__note', id: 'connect-note', style: 'flex: 1 1 100%; margin: 0', hidden: true });
  const stops = h('ul', { class: 'bld-connect__stops', id: 'connect-stops', 'aria-label': 'Elevator stops you can join', style: 'flex: 1 1 100%; margin: 0; padding: 0; list-style: none; display: grid; gap: var(--s-1)', hidden: true });
  const banner = h('div', { class: 'bld-connect', id: 'connect-banner', role: 'status', tabindex: '-1', hidden: true }, words, stop, another, finished, note, stops);
  options.stage.append(banner);
  let from = null;
  let press = null;
  let asking = false;
  // 'stairs' or 'elevator'; for an elevator, 'picking' a stop or 'joined' with the result on show
  let kind = 'stairs';
  let phase = 'picking';

  function label() {
    return nextConnectionLabel(ed.project.building.connections);
  }

  function floorName(id) {
    const floor = ed.project.building.floors.find((each) => each.id === id);
    return floor ? floor.name : '';
  }

  // The car the mode started from: its letter (or the letter the next elevator
  // will take), and the floors it stops on.
  function carOf(end0) {
    const building = ed.project.building;
    return elevatorCars(building).find((car) => car.stops.some((stop0) => stop0.floorId === end0.floorId && stop0.cell === end0.cell)) || null;
  }

  function carName() {
    const car = from === null ? null : carOf(from);
    const letter = car && car.label !== '' ? car.label : pendingElevatorLetter(ed.project.building);
    return 'Elevator ' + letter;
  }

  // "Floors 1, 2 and 3" for floors named Floor N; otherwise their own names.
  function floorsWords(names) {
    const numbers = names.map((name) => /^Floor (\S+)$/.exec(name));
    return numbers.every(Boolean) ? 'Floors ' + list(numbers.map((match) => match[1])) : list(names);
  }

  // The stops this one can join, each as { floorId, cell, text }, in the order
  // of the floors. describeConnect is the judge: what it would refuse is not listed.
  function joinable() {
    const building = ed.project.building;
    const found = [];
    for (const car of elevatorCars(building)) {
      for (const stop0 of car.stops) {
        if (stop0.floorId === from.floorId && stop0.cell === from.cell) continue;
        try {
          describeConnect(ed.project, { a: from, b: { floorId: stop0.floorId, cell: stop0.cell } });
        } catch (error) {
          if (!(error instanceof ActionError)) throw error;
          continue;
        }
        found.push({ floorId: stop0.floorId, cell: stop0.cell, car });
      }
    }
    const order = building.floors.map((floor) => floor.id);
    found.sort((a, b) => order.indexOf(a.floorId) - order.indexOf(b.floorId) || a.cell - b.cell);
    return found.map((stop0) => {
      const floor = building.floors.find((each) => each.id === stop0.floorId);
      const several = found.filter((other) => other.floorId === stop0.floorId).length > 1;
      const where = several ? ', column ' + ((stop0.cell % floor.width) + 1) + ', row ' + (Math.floor(stop0.cell / floor.width) + 1) : '';
      const what = stop0.car.connectionIds.length > 0 ? 'stop of Elevator ' + stop0.car.label : 'stop not connected';
      return { floorId: stop0.floorId, cell: stop0.cell, text: floor.name + where + ', ' + what };
    });
  }

  function drawStops() {
    const rows = kind === 'elevator' && phase === 'picking' && from !== null ? joinable() : [];
    stops.hidden = rows.length === 0 && !(kind === 'elevator' && phase === 'picking' && from !== null);
    if (stops.hidden) {
      stops.replaceChildren();
      return;
    }
    if (rows.length === 0) {
      stops.replaceChildren(h('li', { class: 'bld-connect__none' }, 'No other elevator stop is free to join. Place a stop with the Elevator tool (U) on another floor, then connect it.'));
      return;
    }
    stops.replaceChildren(...rows.map((row) => h('li', { class: 'bld-connect__stop', style: 'display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2)', data: { floor: row.floorId, cell: String(row.cell) } },
      h('span', { style: 'flex: 1 1 12rem' }, row.text),
      h('button', { type: 'button', class: 'btn', style: FINGER, 'aria-label': 'Connect here: ' + row.text, on: { click: () => pickEnd({ floorId: row.floorId, cell: row.cell }) } }, 'Connect here'))));
  }

  function draw() {
    banner.hidden = from === null;
    if (from === null) {
      delete canvas.dataset.connecting;
      note.hidden = true;
      note.textContent = '';
      stops.hidden = true;
      stops.replaceChildren();
      another.hidden = true;
      finished.hidden = true;
      stop.hidden = false;
      return;
    }
    if (kind === 'elevator' && phase === 'joined') delete canvas.dataset.connecting;
    else canvas.dataset.connecting = 'true';
    if (kind === 'stairs') {
      words.textContent = 'Connecting stairs ' + label() + ' from ' + floorName(from.floorId) + ': click the other stairs, on any floor. Esc cancels.';
      return;
    }
    const joined = phase === 'joined';
    stop.hidden = joined;
    another.hidden = !joined;
    finished.hidden = !joined;
    if (!joined) words.textContent = 'Connecting ' + carName() + ': click its stop on another floor.';
    drawStops();
  }

  // The mode is over. An elevator's returns the focus to the stop it began on.
  function end() {
    const stopped = kind === 'elevator' && from !== null ? from : null;
    from = null;
    press = null;
    phase = 'picking';
    note.textContent = '';
    note.hidden = true;
    draw();
    ed.schedule();
    if (stopped !== null) returnTo(stopped);
  }

  function returnTo(end0) {
    if (ed.floor.id !== end0.floorId && ed.openFloor) ed.openFloor(end0.floorId);
    const floor = ed.floor;
    if (floor.id === end0.floorId) ed.cursor.moveTo(end0.cell % floor.width, Math.floor(end0.cell / floor.width), true);
    canvas.focus({ preventScroll: true });
  }

  function cancel(tell) {
    if (from === null) return false;
    const elevator = kind === 'elevator';
    end();
    if (tell) ed.say(elevator ? 'Cancelled. No elevator was connected.' : 'Cancelled. No stairs were connected.');
    if (!elevator) canvas.focus({ preventScroll: true });
    return true;
  }

  // After a join: the banner's "Done".
  function finish() {
    if (from === null) return;
    end();
  }

  // After a join: the banner's "Connect another floor".
  function again() {
    if (from === null || kind !== 'elevator') return;
    phase = 'picking';
    note.textContent = '';
    note.hidden = true;
    draw();
    ed.say(words.textContent);
    ed.schedule();
    focusBanner();
  }

  function focusBanner() {
    banner.focus({ preventScroll: true });
    // a menu that has just closed may hand the focus back to the plan after this
    requestAnimationFrame(() => {
      if (from !== null && !banner.contains(document.activeElement)) banner.focus({ preventScroll: true });
    });
  }

  function start(end0) {
    from = { floorId: end0.floorId, cell: end0.cell };
    kind = isLiftCell(ed.project.building, end0.floorId, end0.cell) ? 'elevator' : 'stairs';
    phase = 'picking';
    note.textContent = '';
    note.hidden = true;
    draw();
    ed.say(words.textContent);
    ed.schedule();
    if (kind === 'elevator') focusBanner();
  }

  // A refusal in an elevator's mode: in the banner, where it is heard, and the mode goes on.
  function refuseHere(message) {
    note.textContent = message;
    note.hidden = false;
  }

  async function pick(cell) {
    return pickEnd({ floorId: ed.floor.id, cell });
  }

  async function pickEnd(target) {
    if (from === null || asking || (kind === 'elevator' && phase !== 'picking')) return;
    if (kind === 'elevator') return pickLift(target);
    const floor = ed.project.building.floors.find((each) => each.id === target.floorId) || ed.floor;
    const cell = target.cell;
    // an elevator stop is "S" too, and stairs do not join one
    if (floor.cells[cell] !== CELL_STAIRS || isLiftCell(ed.project.building, floor.id, cell)) {
      const message = floor.cells[cell] === CELL_STAIRS
        ? 'That is an elevator stop. Stairs join only stairs. Click the stairs at the other end, on any floor. Esc cancels.'
        : 'That is not a stairs cell. Click the stairs at the other end, on any floor. Esc cancels.';
      ctx.toast({ kind: 'problem', text: message });
      ed.say(message);
      return;
    }
    const payload = { a: from, b: { floorId: floor.id, cell } };
    // a refusal (the same cell, or two stairs already connected) is shown and the mode goes on
    const described = ed.attempt(() => describeConnect(ed.project, payload));
    if (!described) return;
    if (described.sameFloor) {
      asking = true;
      const ok = await ctx.confirm({
        title: 'Connect two stairs on ' + described.fromFloor + '?',
        body: 'A connection normally joins two floors. One that joins two places on the same floor is for a split level or a detached part of the building.',
        action: 'Connect them on ' + described.fromFloor,
        keep: 'Do not connect them',
        opener: canvas,
      });
      asking = false;
      if (!ok) {
        ed.say('Not connected. Click the other stairs, on any floor. Esc cancels.');
        return;
      }
    }
    const done = ed.commit(connectStairs, payload, {
      done: (outcome) => 'Connected stairs ' + outcome.label + ': ' + (outcome.sameFloor ? 'two places on ' + outcome.fromFloor : outcome.fromFloor + ' to ' + outcome.toFloor) + '. The letter is on both ends.',
    });
    if (done) end();
  }

  // The other end of an elevator: a stop on another floor.
  function pickLift(target) {
    const building = ed.project.building;
    const floor = building.floors.find((each) => each.id === target.floorId);
    if (!floor) return;
    if (floor.cells[target.cell] !== CELL_STAIRS) {
      refuseHere('That is not an elevator stop. Click the stop at the other end, on another floor, or choose one from the list. Esc cancels.');
      return;
    }
    const payload = { a: from, b: { floorId: floor.id, cell: target.cell } };
    try {
      describeConnect(ed.project, payload);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      refuseHere(error.message + ' Esc cancels.');
      return;
    }
    note.textContent = '';
    note.hidden = true;
    const done = ed.commit(connectStairs, payload, {
      done: (outcome) => 'Elevator ' + outcome.car + ': ' + floorsWords(outcome.floors) + '. Connected.',
    });
    if (!done) return;
    phase = 'joined';
    words.textContent = 'Elevator ' + done.car + ': ' + floorsWords(done.floors) + '. Connected.';
    draw();
    ed.schedule();
    another.focus({ preventScroll: true });
  }

  // A click on the plan picks the other end; the tool in hand does not see it.
  function onDown(event) {
    if (from === null || event.button !== 0 || phase !== 'picking') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function onUp(event) {
    if (!press || event.pointerId !== press.id) return;
    event.stopImmediatePropagation();
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    press = null;
    if (from === null || event.type !== 'pointerup' || moved > CLICK_SLOP) return;
    const box = canvas.getBoundingClientRect();
    const at = ed.view.cellAt(ed.floor, event.clientX - box.left, event.clientY - box.top);
    if (at.inside) pick(at.index);
  }

  function onKey(event) {
    if (from === null || asking) return;
    if (event.key === 'Escape') {
      // the menu and a dialog have Escape first
      if (event.target && event.target.closest && event.target.closest('[role="menu"], dialog')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (kind === 'elevator' && phase === 'joined') finish();
      else cancel(true);
    } else if (event.key === 'Enter' && event.target === canvas && phase === 'picking' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pick(ed.cursor.cell);
    }
  }

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onUp, true);
  // on the window, ahead of everything in the page: Escape here is this mode's
  window.addEventListener('keydown', onKey, true);

  return {
    start,
    cancel,
    get active() {
      return from !== null;
    },
    get from() {
      return from;
    },
    get kind() {
      return from === null ? null : kind;
    },
    // The project changed: the stop the mode started from may be gone.
    update(project) {
      if (from === null) return;
      const floor = project.building.floors.find((each) => each.id === from.floorId);
      const lift = floor ? isLiftCell(project.building, floor.id, from.cell) : false;
      const there = floor && floor.cells[from.cell] === CELL_STAIRS && lift === (kind === 'elevator');
      if (!there) {
        const elevator = kind === 'elevator';
        // the mode's own end() would try to return the focus to a stop that is gone
        from = null;
        press = null;
        phase = 'picking';
        draw();
        ed.schedule();
        ed.say(elevator ? 'The elevator stop being connected is gone, so connecting has stopped.' : 'The stairs being connected are gone, so connecting has stopped.');
      } else draw();
    },
    // Marks the stop the mode started from, when its floor is on screen, and
    // the stops it can join, dashed.
    overlay(g, view, floor, theme) {
      if (from === null) return;
      const size = view.size;
      if (kind === 'elevator' && phase === 'picking') {
        g.save();
        g.setLineDash([4, 3]);
        g.strokeStyle = theme.accent;
        g.lineWidth = 2;
        for (const row of Array.from(stops.querySelectorAll('[data-cell]'))) {
          if (row.dataset.floor !== floor.id) continue;
          const cell = Number(row.dataset.cell);
          g.strokeRect(Math.round(view.x + (cell % floor.width) * size) + 1.5, Math.round(view.y + Math.floor(cell / floor.width) * size) + 1.5, Math.round(size) - 3, Math.round(size) - 3);
        }
        g.restore();
      }
      if (floor.id !== from.floorId) return;
      const x = from.cell % floor.width;
      const y = Math.floor(from.cell / floor.width);
      g.strokeStyle = theme.accent;
      g.lineWidth = 3;
      g.strokeRect(Math.round(view.x + x * size) + 1.5, Math.round(view.y + y * size) + 1.5, Math.round(size) - 3, Math.round(size) - 3);
    },
    detach() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      banner.remove();
    },
  };
}
