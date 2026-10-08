// The Building section: the floor plan as the page (DESIGN 5.1), with the
// tool strip down its left edge, the status line along its bottom, the floor
// tabs in the top bar's second row and the inspector on the right.
//
// This module is the editor: it owns what is transient (the floor on screen,
// the tool in hand, the selection, a tool's preview, the zoom) and hands the
// drawing tools one object, `ed`, to work through. A tool never touches the
// store itself: it calls ed.commit(action, payload), which makes exactly one
// undo entry, says what happened in a sentence, and shows a refusal as it is.
//
// Where a later unit plugs in:
//   ui/surface/tools/index.js   the list of tools; the strip draws what is there
//   ed.menu = (ev) => {}        the menu for a cell: right-click, long-press,
//                               the Menu key and Shift+F10 all call it
//   ed.underlay, ed.overlays    drawn under and over the plan (a traced image)
//   ./inspector.js              the panel on the right
// The editor of the section on screen is at document.querySelector('.bld').editor.

import { h } from '../components/dom.js';
import { singleKeyAllowed, IS_MAC } from '../components/shortcuts.js';
import { dialogIsOpen } from '../components/dialog.js';
import { count, figures, list } from '../components/words.js';
import { createViewport, drawnBox, ZOOM_STEP } from '../surface/viewport.js';
import { createRenderer } from '../surface/renderer.js';
import { attachInput } from '../surface/input.js';
import { attachCursor } from '../surface/cursor.js';
import { TOOLS, toolById, toolForKey } from '../surface/tools/index.js';
import { nameOf, capital, count as countOf } from '../surface/tools/words.js';
import { toolStrip } from './strip.js';
import { floorTabs } from './floors.js';
import { statusLine } from './status.js';
import { buildingInspector } from './inspector.js';
import { ActionError, addFloor, deleteSpaces, pasteSpaces, describeSpaceDelete } from '../../engine/actions.js';
import { counts, describeCell, copySpaces, isLoss } from '../../engine/building.js';
import { buildingChecks } from '../../engine/building-checks.js';
import { spaceOwners } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';

// The section's own stylesheet, which index.html links. The plan waits for it
// before it measures itself.
let sheet = null;

function stylesheet() {
  if (sheet) return sheet;
  const link = document.querySelector('link[rel="stylesheet"][href$="ui/building/building.css"]');
  sheet = new Promise((resolve) => {
    if (!link) resolve(false);
    else if (link.sheet) resolve(true);
    else {
      link.addEventListener('load', () => resolve(true));
      link.addEventListener('error', () => resolve(false));
    }
  });
  return sheet;
}

// What this section remembers while another one is on screen: the floor, the
// tool and the zoom of the project that is open.
const memory = { projectId: null, floorId: null, toolId: null, view: null, fitBox: null, clip: null };

const HEADLINE = 'This is the building.';
const FIRST = 'Draw a corridor, then rooms along it. Give each room its number, and mark the stairs and the exits.';
const FIRST_EMPTY = 'Draw a corridor, then rooms along it.';
const KEYS = 'Arrow keys move the cursor one cell. Enter does what a click would. Hold Shift and press the arrows to drag; let go of Shift to finish. Hold Space and press the arrows to move the map. Escape cancels. Page Up and Page Down change floor.';

// The keys of the plan. The plan answers them itself, so they are listed for
// Help only (spec 3.15): section.start, below, hands them to the shell's list.
export const PLAN_KEYS = [
  ...TOOLS.map((tool) => ({ id: 'tool-' + tool.id, does: 'The ' + tool.name + ' tool', shown: tool.key.toUpperCase() })),
  { id: 'plan-arrows', does: 'Move the cursor one cell', shown: 'Arrows' },
  { id: 'plan-enter', does: 'Do what a click would, with the tool in hand', shown: 'Enter' },
  { id: 'plan-drag', does: 'Drag: let go of Shift to finish', shown: 'Shift+Arrows' },
  { id: 'plan-pan', does: 'Move the map', shown: 'Space+Arrows' },
  { id: 'plan-escape', does: 'Cancel a drag, or select nothing', shown: 'Esc' },
  { id: 'plan-floors', does: 'The next floor, and the one before', shown: 'Page Down, Page Up' },
  { id: 'plan-zoom-in', does: 'Zoom in', shown: '=' },
  { id: 'plan-zoom-out', does: 'Zoom out', shown: '-' },
  { id: 'plan-fit', does: 'Fit the plan to the window', shown: '0' },
  { id: 'plan-delete', does: 'Delete the selected rooms and spaces', shown: 'Delete' },
  { id: 'plan-copy', does: 'Copy the selected rooms and spaces', shown: IS_MAC ? '⌘C' : 'Ctrl+C' },
  { id: 'plan-paste', does: 'Paste the copy at the cursor, on any floor', shown: IS_MAC ? '⌘V' : 'Ctrl+V' },
];

function facts(project) {
  const f = figures(project);
  const first = project.building.floors[0];
  if (f.rooms === 0 && f.exits === 0 && f.floors === 1) return 'Nothing is drawn yet. ' + first.name + ' is ' + first.width + ' × ' + first.height + ' squares.';
  return 'So far: ' + list([count(f.floors, 'floor'), count(f.rooms, 'room'), count(f.otherSpaces, 'other space'), count(f.connections, 'stairs connection'), count(f.exits, 'exit')]) + '.';
}

// How many problems the building checks found on each floor.
function problemsByFloor(project) {
  const byFloor = new Map();
  for (const finding of buildingChecks(project)) {
    if (finding.severity !== 'problem' || !finding.where || !finding.where.floorId) continue;
    byFloor.set(finding.where.floorId, (byFloor.get(finding.where.floorId) || 0) + 1);
  }
  return byFloor;
}

export const section = {
  id: 'building',
  label: 'Building',
  name: 'Building',
  key: '1',
  icon: 'building',
  // Once, before anything is mounted: the plan's keys go on the shell's list.
  start(ctx) {
    for (const key of PLAN_KEYS) ctx.shortcuts.add({ id: key.id, group: 'Building', does: key.does, shown: key.shown });
  },
  mount(ctx, rest) {
    const store = ctx.store;
    let project = store.project;
    let floor = null;
    let tool = null;
    let selection = [];
    let preview = null;
    let hover = null;
    let needsFit = true;
    // true from a fit until the map is moved by hand: the fit then follows the window
    let fitted = false;
    let fitBox = null;
    let styled = false;
    let queued = false;
    let cardDismissed = false;
    let lastSource = 'pointer';
    let pointerOver = false;
    let spaceDown = false;

    const view = createViewport();
    const canvas = h('canvas', { class: 'bld-plan', id: 'plan', tabindex: '0', role: 'application', 'aria-describedby': 'plan-keys plan-hint' });
    const renderer = createRenderer(canvas);

    const headline = h('h1', { class: 'intro__headline' }, HEADLINE);
    const first = h('p', { class: 'intro__first' }, FIRST);
    const factsLine = h('p', { class: 'intro__facts' });
    const intro = h('div', { class: 'vh' }, headline, first, factsLine, h('p', { id: 'plan-keys' }, KEYS));

    const traceButton = h('button', { type: 'button', class: 'btn', data: { action: 'trace' }, on: { click: () => inspector.showTab('floor') } }, 'Trace over a photo of your floor plan');
    const sizeButton = h('button', { type: 'button', class: 'btn', data: { action: 'size' }, on: { click: () => inspector.showTab('floor') } });
    const sampleButton = h('button', { type: 'button', class: 'btn', data: { action: 'load-sample' }, on: { click: () => ctx.loadSample(sampleButton) } }, 'Load the sample school');
    const cardWords = h('div', { class: 'bld-empty__words' });
    const card = h('div', { class: 'bld-empty', id: 'empty-floor', hidden: true }, cardWords, h('div', { class: 'bld-empty__actions' }, traceButton, sizeButton, sampleButton));

    const strip = toolStrip({ tools: TOOLS, pick: (id) => setTool(id) });
    const status = statusLine({ zoomIn: () => zoomBy(ZOOM_STEP), zoomOut: () => zoomBy(1 / ZOOM_STEP), fit: () => fit() });
    const tabs = floorTabs({ panelId: 'plan', open: (id) => ctx.navigate('#building/' + id), add: () => addAFloor() });
    const inspector = buildingInspector({ store, toSurface: () => toSurface() });
    const stage = h('div', { class: 'bld-stage' }, canvas, card);
    const element = h('div', { class: 'bld', data: { styled: 'false' } }, intro, strip.element, stage, status.element);

    // ------------------------------------------------------------ drawing

    function drawNow() {
      queued = false;
      if (!floor || view.width === 0) return;
      renderer.draw({
        project,
        floor,
        view,
        selection,
        hover: ed.gesture ? null : hover,
        cursor: cursor.showing && document.activeElement === canvas ? cursor.cell : null,
        preview,
        underlay: ed.underlay,
        overlays: ed.overlays,
      });
    }

    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        if (queued) drawNow();
      });
    }

    function measure() {
      if (!element.isConnected) return;
      const box = stage.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      renderer.resize(box.width, box.height, window.devicePixelRatio || 1);
      view.resize(box.width, box.height);
      if (needsFit && styled) {
        needsFit = false;
        if (memory.view) {
          view.restore(memory.view);
          fitted = memory.fitBox !== null;
          fitBox = memory.fitBox;
        } else {
          fitted = true;
          fitBox = drawnBox(floor);
          view.fit(fitBox);
        }
      }
      // the fit follows the window, but never under a gesture that is going on
      // the fit follows the window: the same part of the floor, at the new size
      if (fitted && fitBox) view.fit(fitBox);
      settle();
      drawNow();
    }

    function settle() {
      if (floor) view.keepNear(floor);
      status.setZoom(view.zoom);
      if (!needsFit) {
        memory.view = view.save();
        memory.fitBox = fitted ? fitBox : null;
      }
      // the shell's messages sit just above the status line, not over it
      document.documentElement.style.setProperty('--bld-status-height', Math.round(status.element.getBoundingClientRect().height) + 'px');
      schedule();
    }

    // The map was moved or zoomed by hand.
    function viewChanged() {
      fitted = false;
      settle();
    }

    function zoomBy(factor) {
      // the zoom is never animated, so reduced motion has nothing to turn off
      view.zoomAbout(view.zoom * factor, view.width / 2, view.height / 2);
      viewChanged();
      say('Zoom ' + Math.round(view.zoom * 100) + '%.');
    }

    // Bring a part of the floor into the window, as large as it will go:
    // box is { x, y, w, h } in cells.
    function fitTo(box) {
      fitBox = box;
      view.fit(fitBox);
      fitted = true;
      settle();
    }

    function fit() {
      fitTo(drawnBox(floor));
      say('The plan fits the window, at ' + Math.round(view.zoom * 100) + '%.');
    }

    // ------------------------------------------------------------ words

    function say(text) {
      ctx.announce(text);
    }

    function refuse(message) {
      ctx.toast({ kind: 'problem', text: message });
      say(message);
    }

    // What is on a cell, in a word or two.
    function whatIsAt(cell) {
      const at = describeCell(project.building, floor.id, cell);
      if (!at) return '';
      if (at.kind === 'corridor') return 'Corridor' + (at.corridorName === '' ? '' : ', ' + at.corridorName) + (at.exit ? ', exit' + (at.exit.doorName === '' ? '' : ' ' + at.exit.doorName) : '');
      if (at.kind === 'stairs') return at.connections.length > 0 ? 'Stairs ' + at.connections.map((connection) => connection.label).join(', ') : 'Stairs, not connected';
      if (at.kind === 'room') return roomName(at.space, true);
      if (at.kind === 'other') return at.space.label.trim() === '' ? 'Other space' : at.space.label;
      return 'Empty';
    }

    function showCell(ev) {
      if (!ev || !ev.inside) status.setCell('');
      else status.setCell('Column ' + (ev.x + 1) + ', row ' + (ev.y + 1) + ' · ' + whatIsAt(ev.index));
    }

    // ------------------------------------------------------------ what the tools work through

    const ed = {
      ctx,
      store,
      view,
      canvas,
      gesture: null,
      toolState: {},
      menu: null,
      underlay: null,
      overlays: [],
      get project() {
        return project;
      },
      get floor() {
        return floor;
      },
      get tool() {
        return tool;
      },
      get selection() {
        return selection;
      },
      get preview() {
        return preview;
      },
      get cursor() {
        return cursor;
      },
      setTool: (id) => setTool(id),
      drawNow,
      schedule,
      fit,
      fitTo,
      say,
      spaceAt(cell) {
        return spaceOwners(floor).get(cell) || null;
      },
      select(ids) {
        selection = ids.filter((id) => floor.spaces.some((space) => space.id === id));
        inspector.update(project, floor, selection);
        schedule();
      },
      setPreview(next) {
        preview = next;
        schedule();
      },
      setHint(text) {
        status.setHint(text);
      },
      endGesture() {
        ed.gesture = null;
        preview = null;
        schedule();
      },
      // The action a drag is building up to, said only to someone drawing by keys.
      pending(text) {
        if (lastSource === 'keyboard') say(text);
      },
      // Run something that may refuse; a refusal is shown and null comes back.
      attempt(run) {
        try {
          return run();
        } catch (error) {
          if (!(error instanceof ActionError)) throw error;
          refuse(error.message);
          return null;
        }
      },
      // One completed gesture, one store action, one undo entry.
      //   options.done(outcome)    the sentence for what happened
      //   options.same             the sentence when nothing changed
      //   options.toast(outcome)   the message to show, or null for none. By
      //                            default one is shown when something was replaced.
      // Returns what engine/building.js reported (cells, loss, spaceId), or null.
      commit(action, payload, options) {
        const opts = options || {};
        const before = store.project;
        let outcome = null;
        const done = ed.attempt(() => {
          // the action runs once, in the store; what it reported for the
          // change (cells, loss, the new space's id) is on the undo entry
          if (store.apply(action, payload) === before) return false;
          outcome = store.undoOutcome || {};
          return true;
        });
        if (done === null) return null;
        if (done === false) {
          say(opts.same || 'Nothing changed.');
          return null;
        }
        const sentence = opts.done ? opts.done(outcome) : capital(store.undoLabel || 'Done') + '.';
        say(sentence);
        const message = opts.toast === undefined ? (outcome.loss && isLoss(outcome.loss) ? sentence : null) : opts.toast === null ? null : opts.toast(outcome);
        if (message) ctx.toast({ text: message, action: { label: 'Undo', run: ctx.undo } });
        return outcome;
      },
      // A new room is selected; its number field takes the focus unless a
      // finger drew it, so the on-screen keyboard does not rise over the plan.
      placedRoom(spaceId, ev) {
        ed.select([spaceId]);
        if (ev.pointerType !== 'touch') inspector.focusNumber();
      },
      // Is this place on the canvas within `margin` pixels of the selection's box?
      nearSelection(sx, sy, margin) {
        if (selection.length === 0) return false;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const space of floor.spaces) {
          if (!selection.includes(space.id)) continue;
          for (const cell of space.cells) {
            const x = cell % floor.width;
            const y = Math.floor(cell / floor.width);
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x + 1);
            y1 = Math.max(y1, y + 1);
          }
        }
        const a = view.toScreen(x0, y0);
        const b = view.toScreen(x1, y1);
        return sx >= a.x - margin && sx <= b.x + margin && sy >= a.y - margin && sy <= b.y + margin;
      },
    };
    element.editor = ed;

    // ------------------------------------------------------------ the tool in hand

    function setTool(id, quiet) {
      const next = toolById(id);
      if (!next) return;
      if (tool && tool.onLeave) tool.onLeave(ed);
      input.reset();
      cursor.reset();
      ed.gesture = null;
      ed.toolState = {};
      preview = null;
      tool = next;
      memory.toolId = next.id;
      strip.setActive(next.id);
      status.setHint(next.hint);
      canvas.dataset.tool = next.id;
      canvas.style.cursor = next.cursor;
      if (!quiet) say(next.hint);
      schedule();
    }

    // ------------------------------------------------------------ input

    const host = {
      view,
      floor: () => floor,
      down(ev) {
        lastSource = ev.source;
        dismissCard();
        if (ev.source === 'pointer') {
          cursor.moveTo(ev.x, ev.y, false);
          hover = null;
        }
        return tool.onDown(ed, ev);
      },
      move(ev) {
        tool.onMove(ed, ev);
        showCell(ev);
      },
      up(ev) {
        const result = tool.onUp(ed, ev);
        // a tool that asks a question first finishes later
        if (result && typeof result.catch === 'function') result.catch((error) => setTimeout(() => { throw error; }, 0));
      },
      cancel() {
        const going = ed.gesture !== null;
        tool.onCancel(ed);
        if (going) say('Cancelled. Nothing was changed.');
      },
      tap(ev) {
        if (tool.onTap) tool.onTap(ed, ev);
      },
      hover(ev) {
        const cell = ev && ev.inside ? ev.index : null;
        showCell(ev);
        if (tool.onHover) tool.onHover(ed, ev && ev.inside ? ev : null);
        if (cell === hover) return;
        hover = cell;
        schedule();
      },
      hasMenu: () => typeof ed.menu === 'function',
      menu(ev) {
        ed.menu(ev || cursor.event());
      },
      spaceHeld: () => spaceDown || cursor.spaceHeld,
      viewChanged,
      // the keyboard cursor is on another cell
      moved(ev) {
        lastSource = 'keyboard';
        showCell(ev);
        if (tool.onHover && !cursor.dragging) tool.onHover(ed, ev);
        if (!cursor.dragging) say(whatIsAt(ev.index) + ', column ' + (ev.x + 1) + ', row ' + (ev.y + 1) + '. ' + tool.name + ' tool.');
        schedule();
      },
      escape() {
        if (tool.onLeave && tool.onLeave(ed)) {
          preview = null;
          say('Cancelled. Nothing was changed.');
          schedule();
          return true;
        }
        if (selection.length > 0) {
          ed.select([]);
          say('Nothing is selected.');
          return true;
        }
        return false;
      },
      shown: () => schedule(),
    };
    const input = attachInput(canvas, host);
    const cursor = attachCursor(canvas, host);

    function toSurface() {
      canvas.focus({ preventScroll: true });
      cursor.moveTo(cursor.x, cursor.y, true);
    }

    canvas.addEventListener('pointerenter', () => {
      pointerOver = true;
    });
    canvas.addEventListener('pointerleave', () => {
      pointerOver = false;
    });
    canvas.addEventListener('focus', () => {
      // arriving by Tab: the cursor shows, and the keyboard mode is said
      if (canvas.matches(':focus-visible')) {
        cursor.moveTo(cursor.x, cursor.y, true);
        say('The floor plan of ' + floor.name + '. ' + tool.name + ' tool. Arrow keys move the cursor, Enter acts.');
      }
      schedule();
    });
    canvas.addEventListener('blur', () => schedule());

    const mod = (event) => (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey;

    // Keys that belong to the plan when it has the focus, beside the cursor's.
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        stepFloor(event.key === 'PageDown' ? 1 : -1);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (selection.length === 0) return;
        event.preventDefault();
        deleteSelection();
      } else if (mod(event) && !event.shiftKey && event.key.toLowerCase() === 'c') {
        if (selection.length === 0) return;
        event.preventDefault();
        memory.clip = copySpaces(project.building, { spaceIds: selection });
        say('Copied ' + (selection.length === 1 ? nameOf(floor.spaces.find((space) => space.id === selection[0])) : countOf(selection.length, 'space')) + '.');
      } else if (mod(event) && !event.shiftKey && event.key.toLowerCase() === 'v') {
        if (!memory.clip) return;
        event.preventDefault();
        paste();
      }
    });

    // Keys that work anywhere on the section: the tool letters and the zoom.
    // Every one goes through the single-key guard, so none fires while a
    // field has the focus or while Ctrl, Alt or Meta is held.
    function onDocumentKey(event) {
      if (event.defaultPrevented || dialogIsOpen()) return;
      if (event.target && event.target.closest && event.target.closest('[role="menu"]')) return;
      if (!singleKeyAllowed(event)) return;
      if (event.key === ' ') {
        // Space with the pointer over the plan: the plan takes the focus, so
        // Space pans and presses no button
        if (pointerOver && document.activeElement !== canvas) {
          event.preventDefault();
          canvas.focus({ preventScroll: true });
          spaceDown = true;
        }
        return;
      }
      if (event.key.length !== 1 || (event.shiftKey && event.key !== '+')) return;
      const wanted = toolForKey(event.key);
      if (wanted) {
        event.preventDefault();
        setTool(wanted.id);
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        fit();
      }
    }

    function onDocumentKeyUp(event) {
      if (event.key === ' ') spaceDown = false;
    }

    function onWindowBlur() {
      spaceDown = false;
    }

    const observer = new ResizeObserver(() => measure());

    // The shell calls this when the section leaves the page.
    function unmount() {
      document.removeEventListener('keydown', onDocumentKey);
      document.removeEventListener('keyup', onDocumentKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      observer.disconnect();
      input.detach();
      cursor.detach();
    }

    document.addEventListener('keydown', onDocumentKey);
    document.addEventListener('keyup', onDocumentKeyUp);
    window.addEventListener('blur', onWindowBlur);
    observer.observe(stage);

    // ------------------------------------------------------------ the selection

    function deleteSelection() {
      const ids = selection.slice();
      const described = ed.attempt(() => describeSpaceDelete(project, { spaceIds: ids }));
      if (!described) return;
      const name = ids.length === 1 ? nameOf(floor.spaces.find((space) => space.id === ids[0])) : countOf(ids.length, 'space');
      const warn = described.slots === 0 ? null : capital(countOf(described.groups, 'group')) + (described.groups === 1 ? ' is' : ' are') + ' scheduled there for ' + countOf(described.slots, 'period') + '. Those periods now say the room is not in the building.';
      ed.commit(deleteSpaces, { spaceIds: ids }, {
        done: () => 'Deleted ' + name + '.',
        toast: warn ? () => 'Deleted ' + name + '. ' + warn : null,
      });
    }

    function paste() {
      const clip = memory.clip;
      let at;
      if (cursor.showing) at = { x: cursor.x, y: cursor.y };
      else if (hover !== null) at = { x: hover % floor.width, y: Math.floor(hover / floor.width) };
      else {
        const middle = view.cellAt(floor, view.width / 2, view.height / 2);
        at = { x: Math.max(0, middle.x - Math.floor(clip.width / 2)), y: Math.max(0, middle.y - Math.floor(clip.height / 2)) };
      }
      const had = new Set(floor.spaces.map((space) => space.id));
      const outcome = ed.commit(pasteSpaces, { floorId: floor.id, clip, x: at.x, y: at.y }, {
        done: () => 'Pasted ' + countOf(clip.spaces.length, 'space') + ' on ' + floor.name + '.',
      });
      if (outcome) ed.select(floor.spaces.filter((space) => !had.has(space.id)).map((space) => space.id));
    }

    // ------------------------------------------------------------ floors

    function stepFloor(step) {
      const floors = project.building.floors;
      const at = floors.findIndex((each) => each.id === floor.id);
      const next = floors[at + step];
      if (!next) {
        say(step > 0 ? floor.name + ' is the last floor.' : floor.name + ' is the first floor.');
        return;
      }
      ctx.navigate('#building/' + next.id);
    }

    function addAFloor() {
      const from = floor;
      const done = ed.attempt(() => store.apply(addFloor, { likeFloorId: from.id }));
      if (!done) return;
      const added = store.project.building.floors[store.project.building.floors.length - 1];
      ctx.navigate('#building/' + added.id);
      say('Added ' + added.name + ', ' + added.width + ' by ' + added.height + ' squares, the size of ' + from.name + '.');
    }

    // Another floor comes on screen. The tool and the zoom stay as they are.
    function showFloor(id, quiet) {
      const next = project.building.floors.find((each) => each.id === id);
      if (!next || (floor && next.id === floor.id)) return;
      if (tool && tool.onLeave) tool.onLeave(ed);
      input.reset();
      cursor.reset();
      ed.gesture = null;
      preview = null;
      hover = null;
      selection = [];
      cardDismissed = false;
      floor = next;
      memory.floorId = next.id;
      refresh();
      fitted = false;
      settle();
      if (!quiet) say(next.name + '.');
    }

    // ------------------------------------------------------------ the empty floor

    function dismissCard() {
      if (card.hidden) return;
      cardDismissed = true;
      placeCard();
    }

    function placeCard() {
      const empty = drawnBox(floor).empty;
      if (!empty) cardDismissed = false;
      const show = empty && !cardDismissed;
      if (show === !card.hidden && headline.isConnected) return;
      card.hidden = !show;
      if (show) {
        first.textContent = FIRST_EMPTY;
        cardWords.append(headline, first);
      } else {
        first.textContent = FIRST;
        intro.prepend(headline, first);
      }
    }

    // ------------------------------------------------------------ the project changed

    function refresh() {
      selection = selection.filter((id) => floor.spaces.some((space) => space.id === id));
      tabs.update(project.building.floors, floor.id, store.derived.get('building:problems-by-floor', ['building'], problemsByFloor));
      status.setCounts(counts(project.building));
      inspector.update(project, floor, selection);
      factsLine.textContent = facts(project);
      sizeButton.textContent = 'Change the size (' + floor.name + ' is ' + floor.width + ' × ' + floor.height + ' squares)';
      canvas.setAttribute('aria-label', 'The floor plan of ' + floor.name);
      placeCard();
      schedule();
    }

    // A project this section has not shown before: its first floor, the
    // default tool (Corridor on an empty floor, Select otherwise), a fresh fit.
    function adopt() {
      const floors = project.building.floors;
      memory.projectId = project.id;
      memory.floorId = floors[0].id;
      memory.view = null;
      memory.fitBox = null;
      memory.clip = null;
      floor = floors[0];
      selection = [];
      needsFit = true;
      cardDismissed = false;
      const box = drawnBox(floor);
      setTool(box.empty ? 'corridor' : 'select', true);
      cursor.moveTo(box.x + Math.floor(box.w / 2), box.y + Math.floor(box.h / 2));
    }

    function update(next) {
      project = next;
      const floors = project.building.floors;
      const gone = !floors.some((each) => each.id === floor.id);
      if (project.id !== memory.projectId) {
        adopt();
        measure();
      } else if (gone) {
        // the floor on screen is gone (an undo took it): show the first one
        floor = floors[0];
        memory.floorId = floor.id;
        selection = [];
        settle();
      } else {
        floor = floors.find((each) => each.id === floor.id);
      }
      // the address no longer names a floor of this building
      if (location.hash.startsWith('#building/') && !floors.some((each) => '#building/' + each.id === location.hash)) history.replaceState(null, '', '#building');
      refresh();
    }

    // ------------------------------------------------------------ go

    ctx.setSecondRow(tabs.element);
    ctx.setInspector(inspector.element);

    const named = project.building.floors.find((each) => each.id === String(rest || '').split('/')[0]);
    if (memory.projectId === project.id) {
      floor = named || project.building.floors.find((each) => each.id === memory.floorId) || project.building.floors[0];
      memory.floorId = floor.id;
      setTool(toolById(memory.toolId) ? memory.toolId : 'select', true);
      const box = drawnBox(floor);
      cursor.moveTo(box.x + Math.floor(box.w / 2), box.y + Math.floor(box.h / 2));
    } else {
      floor = project.building.floors[0];
      adopt();
      if (named) {
        floor = named;
        memory.floorId = named.id;
      }
    }
    refresh();

    stylesheet().then(() => {
      styled = true;
      element.dataset.styled = 'true';
      measure();
    });
    // the plan's typeface, which nothing in the page asks for until the canvas does
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('600 12px "Barlow Semi Condensed"'), document.fonts.load('500 12px "Barlow Semi Condensed"')]).then(() => schedule(), () => {});
    }

    return {
      element,
      update,
      // #building/f…: that floor. #building alone keeps the floor on screen.
      route(next) {
        const id = String(next || '').split('/')[0];
        if (id !== '') showFloor(id);
        return true;
      },
      unmount,
    };
  },
};
