// Connect mode (spec 4.5, DESIGN 5.1): "Connect…" on one stairs cell, then a
// click on the other, on any floor. While it lasts a banner across the top of
// the plan says what to do; the mode outlives a change of floor and ends on
// Escape, on the banner's button, or when the stairs it started from are gone.
//
// A connection between two stairs on one floor is unusual (a split level, a
// detached part of the building), so the tool asks first.

import { h } from '../components/dom.js';
import { connectStairs, describeConnect } from '../../engine/actions.js';
import { CELL_STAIRS, nextConnectionLabel } from '../../engine/schema.js';
import { inspectorSheet } from './inspector/sheet.js';

// How far a press may move and still be a click on a cell.
const CLICK_SLOP = 6;

// createConnect(ed, { stage }) -> { start({ floorId, cell }), cancel(), active, update(project), detach() }
export function createConnect(ed, options) {
  inspectorSheet();
  const ctx = ed.ctx;
  const canvas = ed.canvas;
  const words = h('p', { class: 'bld-connect__text', id: 'connect-text' });
  const stop = h('button', { type: 'button', class: 'btn', id: 'connect-cancel', on: { click: () => cancel(true) } }, 'Cancel');
  const banner = h('div', { class: 'bld-connect', id: 'connect-banner', role: 'status', hidden: true }, words, stop);
  options.stage.append(banner);
  let from = null;
  let press = null;
  let asking = false;

  function label() {
    return nextConnectionLabel(ed.project.building.connections);
  }

  function floorName(id) {
    const floor = ed.project.building.floors.find((each) => each.id === id);
    return floor ? floor.name : '';
  }

  function draw() {
    banner.hidden = from === null;
    if (from === null) {
      delete canvas.dataset.connecting;
      return;
    }
    canvas.dataset.connecting = 'true';
    words.textContent = 'Connecting stairs ' + label() + ' from ' + floorName(from.floorId) + ': click the other stairs, on any floor. Esc cancels.';
  }

  function end() {
    from = null;
    press = null;
    draw();
    ed.schedule();
  }

  function cancel(tell) {
    if (from === null) return false;
    end();
    if (tell) ed.say('Cancelled. No stairs were connected.');
    canvas.focus({ preventScroll: true });
    return true;
  }

  function start(end0) {
    from = { floorId: end0.floorId, cell: end0.cell };
    draw();
    ed.say(words.textContent);
    ed.schedule();
  }

  async function pick(cell) {
    if (from === null || asking) return;
    const floor = ed.floor;
    if (floor.cells[cell] !== CELL_STAIRS) {
      const message = 'That is not a stairs cell. Click the stairs at the other end, on any floor. Esc cancels.';
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

  // A click on the plan picks the other end; the tool in hand does not see it.
  function onDown(event) {
    if (from === null || event.button !== 0) return;
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
      cancel(true);
    } else if (event.key === 'Enter' && event.target === canvas && !event.ctrlKey && !event.metaKey && !event.altKey) {
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
    // The project changed: the stairs the mode started from may be gone.
    update(project) {
      if (from === null) return;
      const floor = project.building.floors.find((each) => each.id === from.floorId);
      if (!floor || floor.cells[from.cell] !== CELL_STAIRS) {
        end();
        ed.say('The stairs being connected are gone, so connecting has stopped.');
      } else draw();
    },
    // Marks the stairs the mode started from, when their floor is on screen.
    overlay(g, view, floor, theme) {
      if (from === null || floor.id !== from.floorId) return;
      const x = from.cell % floor.width;
      const y = Math.floor(from.cell / floor.width);
      const size = view.size;
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
