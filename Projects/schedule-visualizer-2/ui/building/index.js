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
//                               the Menu key and Shift+F10 all call it (./menu.js)
//   ed.underlay, ed.overlays    drawn under and over the plan (./trace.js draws
//                               the traced image; connect mode and "Show me"
//                               each lay a mark over the plan)
//   ./inspector.js              the panel on the right
//   ed.show(where)              bring a room or cells onto the plan and mark
//                               them (./search.js); #building/f…?room=r… does
//                               the same from an address
// The editor of the section on screen is at document.querySelector('.bld').editor.

import { h } from '../components/dom.js';
import { singleKeyAllowed, IS_MAC } from '../components/shortcuts.js';
import { dialogIsOpen } from '../components/dialog.js';
import { count, figures, list, pendingElevatorLetter } from '../components/words.js';
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
import { wayLine } from './inspector/floor.js';
import { buildingMenu } from './menu.js';
import { createConnect } from './connect.js';
import { createTrace } from './trace.js';
import { floorMenu } from './floor-menu.js';
import { createFinder, parseBuildingRest } from './search.js';
import { ActionError, addFloor, placeRoom, deleteSpaces, pasteSpaces, describeSpaceDelete } from '../../engine/actions.js';
import { nextRoomNumber, firstRoomNumber, plainNext, splitNumber } from '../../engine/numbering.js';
import { readAutoNumber, writeAutoNumber } from '../../storage/device.js';
import { counts, describeCell, copySpaces, isLoss } from '../../engine/building.js';
import { buildingChecks } from '../../engine/building-checks.js';
import { spaceOwners, stairsLetter, roomNumberKey, allRooms } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';
import { SAMPLE_PROJECT_ID } from '../../data/sample-school.js';

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
//
// Auto-number's view state is here too (ARCHITECTURE 22.5, DESIGN 16.12 item 5), never
// saved and never undone: `autoNext` is the next number per floor, and `autoStack`
// the numbers it assigned, newest last, so Undo of a drawn room steps the next back.
const memory = { projectId: null, floorId: null, toolId: null, view: null, fitBox: null, clip: null, autoNext: new Map(), autoStack: [] };

const HEADLINE = 'This is the building.';
const FIRST = 'Draw a corridor, then rooms along it. Give each room its number, and mark the stairs and the exits.';
const FIRST_EMPTY = 'Draw each floor here: a corridor first, then rooms along it.';
// Over a traced image the card would stand on the plan the reader is tracing
// and take its clicks (SV2-73b): it yields to this one line at the top of the
// stage, which takes no pointer, and is away while the image is being scaled,
// placed or moved, whose banners stand there.
const NOTE_TRACED = 'Draw over the image: a corridor first, then rooms along it.';
const NOTE_STYLE = 'top: var(--s-2); transform: translateX(-50%); width: auto; max-width: calc(100% - var(--s-4)); padding: var(--s-1) var(--s-3); text-align: center; font-size: var(--t-sm); line-height: var(--lh-sm)';
const KEYS = 'Arrow keys move the cursor one cell. Enter does what a click would. Hold Shift and press the arrows to drag; let go of Shift to finish. Hold Space and press the arrows to move the map. Escape cancels. Page Up and Page Down change floor.';

// The words for the stairs on a cell: "Stairs B", and for a one-way stair its
// way beside the letter, "Stairs B (up only)" (SV2-90b, DESIGN 12.6), as the
// planner's cursor line and status read it. Two connections on one cell are
// joined by ", ". The flights of a stairwell that meet here are one letter;
// where they go different ways the drawn badge has no mark, so the words name
// each flight's way (ARCHITECTURE 22.17): "Stairs A (Floor 1 to Floor 2 up
// only; Floor 2 to Floor 3 both ways)".
export function stairsWords(project, connections) {
  const byLetter = new Map();
  for (const connection of connections) {
    const letter = stairsLetter(connection);
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(connection);
  }
  const floors = project.building.floors;
  const floorOf = (id) => floors.find((each) => each.id === id) || { name: 'a floor that is gone', level: 0 };
  // a flight's floors, the lower first
  const span = (connection) => {
    const ends = [floorOf(connection.a.floorId), floorOf(connection.b.floorId)];
    if (ends[1].level < ends[0].level) ends.reverse();
    return ends[0].name + ' to ' + ends[1].name;
  };
  return 'Stairs ' + Array.from(byLetter, ([letter, flights]) => {
    const ways = flights.map((connection) => (connection.direction === 'both' || connection.direction === undefined ? '' : wayLine(project, connection).replace(/, towards .*$/, '')));
    if (ways.every((each) => each === ways[0])) return letter + (ways[0] === '' ? '' : ' (' + ways[0] + ')');
    return letter + ' (' + flights.map((connection, i) => span(connection) + ' ' + (ways[i] === '' ? 'both ways' : ways[i])).join('; ') + ')';
  }).join(', ');
}

// "Elevator D, staff only" for a connected stop, "Elevator D, not connected" for
// a stop alone (it has its letter from the first placement). `at` is
// describeCell's answer; cellWords adds a step and an area of refuge.
export function elevatorWords(project, at) {
  const car = at.elevator;
  const name = 'Elevator ' + (car && car.label !== '' ? car.label : pendingElevatorLetter(project.building));
  return name + (car && car.connected ? '' : ', not connected') + (car && car.staffOnly ? ', staff only' : '');
}

// What is on a cell, in a word or two: the planner's cursor line and the
// announcement of a move.
export function cellWords(project, floorId, cell) {
  const at = describeCell(project.building, floorId, cell);
  if (!at) return '';
  const marks = (at.step ? ', has a step' : '') + (at.refuge ? ', area of refuge' + (typeof at.refuge.name === 'string' && at.refuge.name.trim() !== '' ? ' ' + at.refuge.name.trim() : '') : '');
  if (at.kind === 'corridor') return 'Corridor' + (at.corridorName === '' ? '' : ', ' + at.corridorName) + (at.exit ? ', exit' + (at.exit.doorName === '' ? '' : ' ' + at.exit.doorName) : '') + marks;
  if (at.kind === 'elevator') return elevatorWords(project, at) + marks;
  if (at.kind === 'stairs') return (at.connections.length > 0 ? stairsWords(project, at.connections) : 'Stairs, not connected') + marks;
  if (at.kind === 'room') return roomName(at.space, true) + marks;
  if (at.kind === 'other') return (at.space.label.trim() === '' ? 'Other space' : at.space.label) + marks;
  return 'Empty' + marks;
}

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
  if (f.rooms === 0 && f.exits === 0 && f.floors === 1) return 'Nothing is drawn yet. ' + first.name + ' is ' + first.width + ' × ' + first.height + ' cells.';
  return 'So far: ' + list([count(f.floors, 'floor'), count(f.rooms, 'room'), count(f.otherSpaces, 'other space'), count(f.connections, 'stairs connection')].concat(f.elevators > 0 ? [count(f.elevators, 'elevator')] : [], [count(f.exits, 'exit')])) + '.';
}

// The inspector's tabs as the shell's folded strip shows them: an icon each.
const INSPECTOR_TABS = [
  { id: 'properties', label: 'Properties', icon: 'properties' },
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'floor', label: 'Floor', icon: 'floor' },
  { id: 'checks', label: 'Checks', icon: 'checks' },
  { id: 'exits', label: 'Exits', icon: 'exits' },
];

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
    let lastPointer = 'mouse';
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
    const cardActions = h('div', { class: 'bld-empty__actions' }, traceButton, sizeButton, sampleButton);
    const cardNote = h('p', { class: 'bld-empty__note', id: 'empty-floor-note', hidden: true, style: 'margin: 0' }, NOTE_TRACED);
    const card = h('div', { class: 'bld-empty', id: 'empty-floor', hidden: true, data: { empty: 'building' } }, cardWords, cardActions, cardNote);

    const strip = toolStrip({ tools: TOOLS, pick: (id) => setTool(id) });
    // The Room tool's options (DESIGN 16.3): Auto-number, and its Next number
    const autoSwitch = h('input', { type: 'checkbox', role: 'switch', id: 'auto-number', class: 'bld-options__switch', 'aria-describedby': 'auto-number-hint' });
    const nextInput = h('input', { type: 'text', inputmode: 'text', id: 'next-number', class: 'field__input bld-options__input', size: '7', maxlength: '12', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'next-number-hint next-number-note' });
    const nextField = h('div', { class: 'bld-options__field', id: 'next-number-field', hidden: true }, h('label', { class: 'bld-options__label', for: 'next-number' }, 'Next number'), nextInput);
    const nextHint = h('p', { class: 'bld-options__hint', id: 'next-number-hint', hidden: true }, 'Starts after the highest number on this floor.');
    const nextNote = h('p', { class: 'bld-options__note', id: 'next-number-note', role: 'status', hidden: true });
    const options = h('div', { class: 'bld-options', id: 'plan-options', role: 'group', 'aria-label': 'Room options', hidden: true },
      h('label', { class: 'bld-options__toggle' }, autoSwitch, h('span', null, 'Auto-number')),
      nextField, nextHint, nextNote);
    const status = statusLine({ zoomIn: () => zoomBy(ZOOM_STEP), zoomOut: () => zoomBy(1 / ZOOM_STEP), fit: () => fit() });
    const tabs = floorTabs({ panelId: 'plan', open: (id) => ctx.navigate('#building/' + id), add: () => addAFloor(), actions: (id, anchor, opener) => ed.floorMenu.open(id, anchor, opener) });
    const stage = h('div', { class: 'bld-stage' }, canvas, card);
    const element = h('div', { class: 'bld', data: { styled: 'false' } }, intro, strip.element, options, stage, status.element);

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
      // the room the address asked for, now that the plan has a size
      if (asked && !needsFit) {
        const where = asked;
        asked = null;
        finder.show(where);
      }
      drawNow();
    }

    function settle() {
      if (floor) view.keepNear(floor);
      status.setZoom(view.zoom);
      if (!needsFit) {
        memory.view = view.save();
        memory.fitBox = fitted ? fitBox : null;
      }
      // the shell's messages sit just above the status line and beside the
      // strip, not over either (the strip is beside the plan only when wide)
      const stripBox = strip.element.getBoundingClientRect();
      const statusBox = status.element.getBoundingClientRect();
      document.documentElement.style.setProperty('--bld-status-height', Math.round(statusBox.height) + 'px');
      document.documentElement.style.setProperty('--bld-strip-width', (stripBox.bottom <= stage.getBoundingClientRect().top + 1 ? 0 : Math.round(stripBox.width)) + 'px');
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
      return cellWords(project, floor.id, cell);
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
      placeCard,
      say,
      spaceAt(cell) {
        return spaceOwners(floor).get(cell) || null;
      },
      select(ids) {
        selection = ids.filter((id) => floor.spaces.some((space) => space.id === id));
        inspector.update(project, floor, selection);
        nameInspector();
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
      // While Auto-number is on, a room drawn gets the next number in the same step.
      commit(action, payload, options) {
        if (action === placeRoom && autoSwitch.checked && payload && payload.number === undefined) return commitNumbered(payload, options);
        return commitPlain(action, payload, options);
      },
      // A new room is selected; its number field takes the focus unless a
      // finger drew it, so the on-screen keyboard does not rise over the plan.
      placedRoom(spaceId, ev) {
        ed.select([spaceId]);
        if (ev.pointerType !== 'touch') inspector.focusNumber();
      },
      // The same for a new exit's door name and a new left-out area's label.
      markedExit(exitId, ev) {
        if (ev.pointerType !== 'touch') inspector.focusExit(exitId);
      },
      placedZone(zoneId, ev) {
        if (ev.pointerType !== 'touch') inspector.focusZone(zoneId);
      },
      // Another floor, at once, with the address following (Back returns).
      openFloor(id) {
        if (!project.building.floors.some((each) => each.id === id) || id === floor.id) return;
        history.pushState(null, '', '#building/' + id);
        showFloor(id, true);
      },
      // Bring a place on the floor (in cells) to the middle of the window.
      centreOn(x, y) {
        const at = view.toScreen(x, y);
        view.panBy(view.width / 2 - at.x, view.height / 2 - at.y);
        viewChanged();
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

function commitPlain(action, payload, options) {
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
}

    // ------------------------------------------------------------ auto-number

    // The next number of a floor: the one kept for it this session, else one past the
    // highest on the floor. '' for none to give (every step taken).
    function nextFor(each) {
      if (!memory.autoNext.has(each.id)) memory.autoNext.set(each.id, firstRoomNumber(project, each.id) || '');
      return memory.autoNext.get(each.id);
    }

    // The options row follows the tool, the switch and the floor.
    function showOptions() {
      options.hidden = !tool || tool.id !== 'room';
      const on = autoSwitch.checked;
      nextField.hidden = !on;
      nextHint.hidden = !on;
      if (!on) {
        nextNote.hidden = true;
        return;
      }
      if (document.activeElement !== nextInput) nextInput.value = nextFor(floor);
      checkNext();
    }

    // "Auto-number needs digits, such as 101": the field's refusal. The switch stays on, and
    // rooms are drawn without numbers until it is put right.
    function checkNext() {
      const bad = nextInput.value.trim() !== '' && splitNumber(nextInput.value) === null;
      const empty = nextInput.value.trim() === '';
      nextInput.setAttribute('aria-invalid', String(bad || empty));
      nextNote.hidden = !(bad || empty);
      nextNote.textContent = bad || empty ? 'Auto-number needs digits, such as 101' : '';
    }

    autoSwitch.checked = (() => {
      try {
        return readAutoNumber();
      } catch (error) {
        return false;
      }
    })();
    autoSwitch.addEventListener('change', () => {
      try {
        writeAutoNumber(autoSwitch.checked);
      } catch (error) {
        refuse('This browser is not keeping the Auto-number switch: ' + error.message + '. It lasts until this tab closes.');
      }
      // turned on, the sequence starts again after the highest number on the floor
      if (autoSwitch.checked) memory.autoNext.delete(floor.id);
      showOptions();
      say(autoSwitch.checked ? 'Auto-number is on. Next: ' + (nextFor(floor) || 'none') + '.' : 'Auto-number is off.');
    });
    nextInput.addEventListener('input', () => {
      memory.autoNext.set(floor.id, nextInput.value.trim());
      checkNext();
    });
    nextInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        toSurface();
      }
    });

    // A room drawn while Auto-number is on: the number is in the placement, so
    // drawing and numbering are one undo step. A number taken is skipped, and said.
    function commitNumbered(payload, opts) {
      const seed = nextFor(floor);
      const before = seed;
      let number;
      let skipped = null;
      if (splitNumber(seed) !== null) {
        const taken = new Set(allRooms(project).filter((room) => room.number.trim() !== '').map((room) => roomNumberKey(room.number)));
        number = taken.has(roomNumberKey(seed)) ? nextRoomNumber(project, seed) : seed.trim();
        if (number !== null && number !== seed.trim()) skipped = seed.trim();
      }
      if (number === undefined || number === null) return commitPlain(placeRoom, payload, opts);
      const info = { following: null, said: '' };
      const outcome = commitPlain(placeRoom, { ...payload, number }, {
        ...opts,
        done: (result) => {
          info.following = nextRoomNumber(store.project, number) || plainNext(number) || '';
          const said = 'Room ' + number + ' drawn. Next: ' + info.following + '.';
          info.said = skipped === null ? said : skipped + ' is taken; this is ' + number + '. ' + said;
          return info.said;
        },
        toast: (result) => {
          if (skipped !== null) return skipped + ' is taken; this is ' + number;
          if (lastPointer === 'touch') return 'Room ' + number;
          return result.loss && isLoss(result.loss) ? info.said : null;
        },
      });
      if (outcome === null) return null;
      memory.autoStack.push({ floorId: floor.id, roomId: outcome.spaceId, number, previous: before });
      memory.autoNext.set(floor.id, info.following);
      status.setHint('Room ' + number + ' drawn. Next: ' + info.following + '.');
      showOptions();
      return outcome;
    }

    // After any change of the project: a number whose room is gone is popped and the next
    // steps back (Undo of the drawing); a number typed into the room just drawn re-seats
    // the sequence from it. Typing into any other room never moves it.
    function keepSequence() {
      const stack = memory.autoStack;
      let changed = false;
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const each = project.building.floors.find((candidate) => candidate.id === top.floorId);
        const room = each ? each.spaces.find((space) => space.id === top.roomId) : null;
        if (room) {
          const typed = room.number.trim();
          if (typed !== top.number && roomNumberKey(typed) !== roomNumberKey(top.number) && splitNumber(typed) !== null) {
            top.number = typed;
            const following = nextRoomNumber(project, typed) || plainNext(typed) || '';
            memory.autoNext.set(top.floorId, following);
            status.setHint('Next: ' + following + '.');
            say('Next: ' + following + '.');
            changed = true;
          }
          break;
        }
        stack.pop();
        if (each) memory.autoNext.set(top.floorId, top.previous);
        changed = true;
      }
      if (changed && floor && !options.hidden) showOptions();
    }

    // ------------------------------------------------------------ the inspector, the menu, finding

    const trace = createTrace(ed, ctx);
    const connect = createConnect(ed, { stage });
    const finder = createFinder(ed);
    const inspector = buildingInspector({ ctx, store, editor: () => ed, trace, show: finder.show, toSurface: () => toSurface() });
    ed.underlay = trace.underlay;
    ed.overlays.push(connect.overlay, finder.overlay);
    ed.menu = buildingMenu(ed, { connect: () => connect, inspector: () => inspector });
    ed.floorMenu = floorMenu(ed);
    ed.show = finder.show;
    ed.finder = finder;
    ed.inspector = inspector;
    ed.connect = connect;
    ed.trace = trace;
    // the room an address asked for (#building/f…?room=r…), until the plan has a size
    let asked = null;

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
      showOptions();
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
        lastPointer = ev.pointerType || 'mouse';
        dismissCard();
        finder.clear();
        if (ev.source === 'pointer') {
          cursor.moveTo(ev.x, ev.y, false);
          hover = null;
        }
        // connect mode has the press: a finger is let through to here for a pan
        // or a pinch, and no tool acts on it
        if (ev.source === 'pointer' && ed.connect && ed.connect.picking) return false;
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
        if (finder.marked) {
          finder.clear();
          say('The mark is off the plan.');
          return true;
        }
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

    // The plan is drawn in the theme's colours, read when it is drawn (the
    // renderer keeps them by theme). So a change of theme is a reason to
    // draw: the switch in the top bar, and the device going dark or light
    // while the planner follows it.
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => schedule();
    const themeWatch = new MutationObserver(onTheme);

    // The shell calls this when the section leaves the page.
    function unmount() {
      document.removeEventListener('keydown', onDocumentKey);
      document.removeEventListener('keyup', onDocumentKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      darkQuery.removeEventListener('change', onTheme);
      themeWatch.disconnect();
      observer.disconnect();
      input.detach();
      cursor.detach();
      trace.detach();
      connect.detach();
    }

    document.addEventListener('keydown', onDocumentKey);
    document.addEventListener('keyup', onDocumentKeyUp);
    window.addEventListener('blur', onWindowBlur);
    darkQuery.addEventListener('change', onTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
      say('Added ' + added.name + ', ' + added.width + ' by ' + added.height + ' cells, the size of ' + from.name + '.');
    }

    // Another floor comes on screen. The tool and the zoom stay as they are.
    function showFloor(id, quiet) {
      const next = project.building.floors.find((each) => each.id === id);
      if (!next || (floor && next.id === floor.id)) return;
      if (tool && tool.onLeave) tool.onLeave(ed);
      trace.stopMoving();
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
      showOptions();
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
      // on the sample school, loading the sample school does nothing (SV2-30c)
      sampleButton.hidden = project.id === SAMPLE_PROJECT_ID;
      const empty = drawnBox(floor).empty;
      if (!empty) cardDismissed = false;
      const shape = floor.image ? 'note' : 'card';
      const busy = shape === 'note' && Boolean(ed.trace) && (ed.trace.moving || ed.trace.scaling.active);
      const show = empty && !cardDismissed && !busy;
      if (show === !card.hidden && card.dataset.shape === shape && headline.isConnected) return;
      card.hidden = !show;
      card.dataset.shape = shape;
      cardWords.hidden = shape === 'note';
      cardActions.hidden = shape === 'note';
      cardNote.hidden = shape !== 'note';
      card.style.cssText = shape === 'note' ? NOTE_STYLE : '';
      if (show && shape === 'card') {
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
      sizeButton.textContent = 'Change the size (' + floor.name + ' is ' + floor.width + ' × ' + floor.height + ' cells)';
      canvas.setAttribute('aria-label', 'The floor plan of ' + floor.name);
      placeCard();
      nameInspector();
      schedule();
    }

    // The inspector's handle says what it is about: the selection, or the floor.
    function nameInspector() {
      const chosen = selection.length === 1 ? nameOf(floor.spaces.find((space) => space.id === selection[0])) : selection.length > 1 ? countOf(selection.length, 'space') + ' selected' : floor.name;
      ctx.setInspectorTitle('Inspector: ' + chosen);
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
      memory.autoNext = new Map();
      memory.autoStack = [];
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
      if (location.hash.startsWith('#building/') && !floors.some((each) => '#building/' + each.id === location.hash.split('?')[0])) history.replaceState(null, '', '#building');
      connect.update(project);
      keepSequence();
      refresh();
    }

    // ------------------------------------------------------------ go

    ctx.setSecondRow(tabs.element);
    ctx.setInspector(inspector.element, { title: 'Inspector', tabs: INSPECTOR_TABS, openTab: (id) => inspector.showTab(id) });

    const addressed = parseBuildingRest(rest);
    const named = project.building.floors.find((each) => each.id === addressed.floorId);
    if (addressed.roomId) asked = { floorId: addressed.floorId, roomId: addressed.roomId };
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
      // #building/f…?room=r…: that room, in the middle of the plan and marked.
      route(next) {
        const wanted = parseBuildingRest(next);
        if (wanted.floorId !== '') showFloor(wanted.floorId);
        if (wanted.roomId) finder.show({ floorId: floor.id, roomId: wanted.roomId });
        return true;
      },
      unmount,
      // The section's surface is the plan: the keyboard goes there, with the
      // cursor showing, when the shell is asked for the surface. Until the
      // sheet has loaded the section is not visible and cannot take the
      // focus, so a section opened by its key put the keyboard on the page's
      // body (SV2-32h1); it waits for the sheet, and gives way to a focus put
      // anywhere but the page or the region it is in meanwhile.
      focus: () => {
        if (styled) {
          toSurface();
          return;
        }
        stylesheet().then(() => {
          const now = document.activeElement;
          if (element.isConnected && (now === null || now.contains(element))) toSurface();
        });
      },
    };
  },
};
