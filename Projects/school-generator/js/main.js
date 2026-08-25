// main.js — bootstrap and UI wiring.

import * as THREE from 'three';
import {
  createState, ROOM_COLORS, MAX_FLOORS, CELL,
  floorLabel, floorCellCount, floorShapeCount,
  addFloor, duplicateFloor, removeFloor, setCurrentFloor,
} from './grid.js';
import { totalShapeArea } from './shapes.js';
import { buildSampleSchool } from './sample.js';
import { catalogByCategory, catalogEntry } from './catalog.js';
import { ROOM_TEMPLATES } from './templates.js';
import { initRender } from './render.js';
import { initEditor, WALL_KINDS, DOOR_KINDS } from './editor.js';
import { stairMetrics, linksFrom, elevatorsOn, RAMP_SLOPES } from './stairs.js';
import { FLOOR_FINISHES, DEFAULT_FINISH } from './finish.js';
import {
  SUN_PRESETS, MONTH_NAMES, MAX_LAT, normalizeEnv, presetMinutes, daysInMonth,
  formatClock, formatDate, formatLat, skyState,
} from './sky.js';
import { initWalkthrough } from './walkthrough.js';
import { initAudio } from './audio.js';
import { doorEvents } from './sound.js';
import { roomsOnFloor, isOutside } from './acoustics.js';
import {
  downloadSave, loadFromFile, autosave, autosaveNow, loadAutosave, clearAutosave,
  listDesigns, saveDesign, loadDesign, deleteDesign, renameDesign,
} from './save-load.js';
import { renderFloorPlanCanvas, downloadCanvasPNG } from './blueprint.js';
import { isTouchCapable, joystickAxes } from './touch.js';

const canvas = document.getElementById('view');
const $ = (id) => document.getElementById(id);

// --- modal focus management ---
// A keyboard/AT user needs focus to land inside a dialog when it opens (a
// panel with only `.hidden` toggled leaves focus stranded on a button that's
// no longer visible) and to come back to whatever opened it when it closes.
let modalReturnFocus = null;
function openModal(overlay, focusEl) {
  modalReturnFocus = document.activeElement;
  overlay.classList.remove('hidden');
  (focusEl || overlay.querySelector('button, input, [tabindex]'))?.focus();
}
function closeModal(overlay) {
  if (overlay.classList.contains('hidden')) return; // already closed — don't steal focus again
  overlay.classList.add('hidden');
  if (modalReturnFocus && document.body.contains(modalReturnFocus)) modalReturnFocus.focus();
  modalReturnFocus = null;
}

// --- state ---
let state = loadAutosave() || buildSampleSchool();

const renderApi = initRender(canvas);

let rebuildQueued = false;
let lastRebuild = 0;
function rebuild(throttled = false) {
  const now = performance.now();
  if (throttled && now - lastRebuild < 90) {
    if (!rebuildQueued) {
      rebuildQueued = true;
      setTimeout(() => { rebuildQueued = false; rebuild(); }, 100);
    }
    return;
  }
  lastRebuild = now;
  renderApi.buildFromState(state);
}

const editor = initEditor({
  canvas,
  renderApi,
  getState: () => state,
  onChange: (info = {}) => {
    rebuild(!!info.throttled);
    autosave(state);
    updateUndoButtons();
    renderFloorList();
    renderStairReadout();
    // Placing or deleting a fixture changes what the light budget is doing,
    // and the sky panel is the only place that says so.
    renderEnvReadout();
    // Same for sound: a diffuser placed, a room's finish changed or a wall
    // moved all change what there is to hear and how long it rings, and both
    // answers are derived rather than stored, so re-deriving is the whole
    // update. Skipped mid-drag — a stroke ends in an unthrottled call.
    if (!info.throttled) { audio.setWorld(state); renderAudioReadout(); }
  },
  // The polygon tools have more to say than a fixed per-tool hint — how many
  // corners are down, how big the room is — so they drive the status line.
  onStatus: (text) => { $('status').textContent = text; },
  onHoleMode: (on) => {
    $('hole-btn').classList.toggle('on', on);
    $('hole-btn').setAttribute('aria-pressed', String(on));
  },
});

const walkHud = $('walk-hud');

// --- sound ---
//
// The mixer is built around the walk camera because that camera *is* the
// listener: three's AudioListener rides it, so the Web Audio listener's
// position and orientation come from the same transform the renderer draws
// from, and nothing has to be kept in step by hand.
const audio = initAudio(renderApi.walkCamera, { catalogEntry });

// The leaves' own open/shut fractions, remembered between frames so a latch
// fires once rather than every frame the door is moving. sound.js does the
// diff; this only holds the map.
let doorState = new Map();

const walk = initWalkthrough(renderApi.walkCamera, canvas, {
  onHud: (text) => { walkHud.textContent = text; },
  // The leaves the walker is being stopped by are the leaves the renderer
  // poses. Neither side describes a door to the other — they're the same
  // objects, matched by openings.js's keys. Phase 4 reads the same array a
  // third time to hear them.
  onDoors: (leaves) => {
    renderApi.poseDoors(leaves);
    const d = doorEvents(leaves, doorState);
    doorState = d.next;
    // A latch is about chest height, which is a couple of feet under the eye
    // of whoever is close enough to it to have set it off.
    for (const ev of d.events) {
      audio.door(ev.kind, { x: ev.x, y: renderApi.walkCamera.position.y - 2, z: ev.z });
    }
  },
  // A foot hitting a surface. walkthrough.js has already worked out which
  // material and how hard; all that is left is to play it.
  onStep: (spec, at, force, landing) => {
    if (landing) audio.land(spec, at, force);
    else audio.step(spec, at);
  },
});

// --- touch walkthrough controls ---
// A touch device has no pointer to lock, so walking there skips Pointer Lock
// entirely (see walkthrough.js's enableTouch()) in favor of an on-screen
// joystick for movement and a drag-anywhere-on-the-canvas look, wired here.
const isTouch = isTouchCapable();
const JOY_RADIUS = 44; // px — half the base minus the knob, kept in step with the CSS

const joystickEl = $('touch-joystick');
const joystickKnob = $('touch-joystick-knob');
let joyPointerId = null;
let joyCenter = null;

function joystickReset() {
  joystickKnob.style.transform = '';
  walk.setMoveAxes(0, 0);
}
function joystickUpdate(e) {
  const axes = joystickAxes(e.clientX - joyCenter.x, e.clientY - joyCenter.y, JOY_RADIUS);
  joystickKnob.style.transform = `translate(${axes.x * JOY_RADIUS}px, ${-axes.y * JOY_RADIUS}px)`;
  walk.setMoveAxes(axes.x, axes.y);
}
joystickEl.addEventListener('pointerdown', (e) => {
  if (joyPointerId !== null) return;
  joyPointerId = e.pointerId;
  const r = joystickEl.getBoundingClientRect();
  joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  joystickEl.setPointerCapture(e.pointerId);
  joystickUpdate(e);
});
joystickEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointerId) joystickUpdate(e); });
function joystickEnd(e) {
  if (e.pointerId !== joyPointerId) return;
  joyPointerId = null;
  joystickReset();
}
joystickEl.addEventListener('pointerup', joystickEnd);
joystickEl.addEventListener('pointercancel', joystickEnd);

// Jump is held (matches Space on a keyboard); sprint is a toggle, since
// holding a second on-screen button down alongside the joystick thumb is
// awkward on a phone-sized screen.
const touchJumpBtn = $('touch-jump');
touchJumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); walk.touchKey('Space', true); });
touchJumpBtn.addEventListener('pointerup', () => walk.touchKey('Space', false));
touchJumpBtn.addEventListener('pointercancel', () => walk.touchKey('Space', false));

// The elevator button is the touch equivalent of E: a no-op anywhere but
// inside a car, which is why it can sit on screen all the time.
const touchLiftBtn = $('touch-lift');
touchLiftBtn.addEventListener('click', () => walk.rideElevator());

const touchSprintBtn = $('touch-sprint');
let touchSprintOn = false;
touchSprintBtn.addEventListener('click', () => {
  touchSprintOn = !touchSprintOn;
  walk.touchKey('ShiftLeft', touchSprintOn);
  touchSprintBtn.setAttribute('aria-pressed', String(touchSprintOn));
});
function resetTouchWalkUI() {
  touchSprintOn = false;
  touchSprintBtn.setAttribute('aria-pressed', 'false');
  joyPointerId = null;
  joystickReset();
}

if (isTouch) {
  $('walk-start').textContent = 'Tap to Walk';
  $('walk-controls-hint').innerHTML =
    'Left joystick to move &nbsp;·&nbsp; drag anywhere else to look<br />' +
    '🏃 toggles sprint &nbsp;·&nbsp; ⤒ jumps<br />' +
    '✕ (top right) exits';
}

// --- initial view ---
renderApi.fitEditView(state);
renderApi.resize();
rebuild();

// --- mode toggle ---
const walkOverlay = $('walk-overlay');
let mode = 'edit';

function setMode(m) {
  if (m === mode) return;
  mode = m;
  renderApi.setMode(m);
  document.body.dataset.mode = m;
  if (m === 'walk') {
    editor.setEnabled(false);
    walk.enable(state);
    doorState = new Map();
    audio.setWorld(state);
    openModal(walkOverlay, $('walk-start'));
    closeModal($('designs-overlay'));
    closeModal($('export-overlay'));
    $('mode-btn').textContent = '✏️ Edit Mode';
  } else {
    setPhotoMode(false);
    walk.disable();
    audio.setActive(false);
    closeModal(walkOverlay);
    document.body.classList.remove('touch-walk');
    resetTouchWalkUI();
    editor.setEnabled(true);
    $('mode-btn').textContent = '🚶 Walk Through';
  }
}

$('mode-btn').addEventListener('click', () => setMode(mode === 'edit' ? 'walk' : 'edit'));
$('walk-start').addEventListener('click', () => {
  // An AudioContext may only start inside a user gesture, and this click is
  // the first one that means "I want to be in the building" — which is
  // exactly when the building should start making a noise.
  audio.setActive(true);
  renderAudioPanel();
  if (isTouch) {
    walk.enableTouch();
    document.body.classList.add('touch-walk');
    closeModal(walkOverlay);
  } else {
    walk.controls.lock();
  }
});
$('walk-exit').addEventListener('click', () => setMode('edit'));
$('touch-exit').addEventListener('click', () => setMode('edit'));

walk.controls.addEventListener('lock', () => closeModal(walkOverlay));
walk.controls.addEventListener('unlock', () => {
  // In photo mode the released pointer is the point — you let it go to reach
  // the lens controls — so the overlay stays down.
  if (mode === 'walk' && !photoMode) openModal(walkOverlay, $('walk-start'));
});

// --- tool buttons ---
const TOOL_KEYS = {
  Digit1: 'floor', Digit2: 'wall', Digit3: 'door', Digit4: 'room',
  Digit5: 'erase', Digit6: 'poly', Digit7: 'vertex', Digit8: 'prop',
  Digit9: 'stair', Digit0: 'template',
};
const HINTS = {
  floor: 'Floor — click / drag to lay floor tiles',
  wall: 'Wall — drag along cell edges, or click a polygon wall to raise it. G switches between solid, glass and railing; , and . curve a polygon wall into an arc.',
  door: 'Door — pick single, double, cased opening or window, then click a wall edge or anywhere along a polygon wall. Clicking the same kind again removes it.',
  room: 'Room — pick a name, color, floor finish and wall paint, then click a floor area to apply them',
  erase: 'Eraser — drag to remove walls, doors, and floor; click a polygon room to delete it',
  poly: 'Polygon — click to place corners, click the first one (or Enter) to close. Alt = ignore snapping, Shift = 15° steps.',
  vertex: 'Shape — click a room to select it, Shift-click to select several. Drag a corner, Alt-click removes one. Delete removes the selection, R/⇧R rotates it 90°, M mirrors it, Ctrl+C/V/D copy/paste/duplicate it (with any props inside).',
  prop: 'Furniture — pick a piece, click to place. Click/drag a piece to move it, drag empty space to box-select. R rotates, Delete removes, Ctrl+C/V/D copy/paste/duplicate.',
  stair: 'Vertical — stairs, ramps, elevators and plain floor openings. Click to place one up to the next level. R rotates, drag to move, Delete removes.',
  template: 'Layout — pick a preset, click to stamp its whole furniture list at once. R/⇧R rotates it before you place it.',
};

function selectTool(t) {
  editor.setTool(t);
  document.querySelectorAll('#toolbar .tool').forEach((b) => {
    const on = b.dataset.tool === t;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // The polygon tool names its room from the same panel the room tool uses —
  // one place to pick a name and a color, whichever kind of room it lands on.
  $('room-panel').classList.toggle('hidden', t !== 'room' && t !== 'poly');
  $('poly-extra').classList.toggle('hidden', t !== 'poly');
  $('prop-panel').classList.toggle('hidden', t !== 'prop');
  $('wall-panel').classList.toggle('hidden', t !== 'wall');
  $('door-panel').classList.toggle('hidden', t !== 'door');
  $('stair-panel').classList.toggle('hidden', t !== 'stair');
  $('template-panel').classList.toggle('hidden', t !== 'template');
  if (t === 'stair') renderStairReadout();
  // Hole mode is sticky, so coming back to the polygon tool has to say which
  // of the two things a loop is going to do.
  $('status').textContent = t === 'poly' && editor.holeMode
    ? 'Cut hole — draw a loop inside a polygon room to carve an opening out of it.'
    : HINTS[t];
}

$('hole-btn').addEventListener('click', () => editor.setHoleMode(!editor.holeMode));

document.querySelectorAll('#toolbar .tool').forEach((b) =>
  b.addEventListener('click', () => selectTool(b.dataset.tool)));

// --- room panel ---
const swatches = $('swatches');
ROOM_COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'swatch' + (i === 0 ? ' active' : '');
  b.style.background = c;
  b.title = c;
  b.setAttribute('aria-label', `Room color ${c}`);
  b.setAttribute('aria-pressed', String(i === 0));
  b.addEventListener('click', () => {
    swatches.querySelectorAll('.swatch').forEach((s) => {
      s.classList.remove('active');
      s.setAttribute('aria-pressed', 'false');
    });
    b.classList.add('active');
    b.setAttribute('aria-pressed', 'true');
    editor.setRoom($('room-name').value, c);
  });
  swatches.appendChild(b);
});
$('room-name').value = editor.roomName;
$('room-name').addEventListener('input', (e) => editor.setRoom(e.target.value, editor.roomColor));

// --- room finishes ---
// The label tint above says which wing a room is in; these say what it's made
// of. Two different questions, so two different controls — and the plan's
// finish schedule reads the second one, never the first.
const roomFinish = $('room-finish');
FLOOR_FINISHES.forEach((f) => {
  const o = document.createElement('option');
  o.value = f.key;
  o.textContent = f.label;
  roomFinish.appendChild(o);
});
roomFinish.value = DEFAULT_FINISH;
roomFinish.addEventListener('change', (e) => {
  editor.setRoomFinish(e.target.value, undefined);
  $('status').textContent =
    `Room — click a floor area to lay ${e.target.selectedOptions[0].textContent.toLowerCase()}.`;
});

// Paint. The first swatch is "none", which is not a colour but the absence of
// one: it clears the field so the room renders in the default off-white the
// scene has always used, rather than being painted off-white.
const PAINTS = [null, '#e9e6df', '#dfe7ea', '#e6e3ee', '#e9e4d6',
  '#d7e3d5', '#f0dcd8', '#cfd6dd', '#c9d8d2'];
const paintSwatches = $('paint-swatches');
PAINTS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'swatch' + (i === 0 ? ' active' : '');
  b.style.background = c || 'transparent';
  if (!c) b.style.border = '1px dashed rgba(255,255,255,0.45)';
  b.title = c || 'Default paint';
  b.setAttribute('aria-label', c ? `Wall paint ${c}` : 'Default wall paint');
  b.setAttribute('aria-pressed', String(i === 0));
  b.addEventListener('click', () => {
    paintSwatches.querySelectorAll('.swatch').forEach((sw) => {
      sw.classList.remove('active');
      sw.setAttribute('aria-pressed', 'false');
    });
    b.classList.add('active');
    b.setAttribute('aria-pressed', 'true');
    editor.setRoomFinish(undefined, c);
  });
  paintSwatches.appendChild(b);
});

// --- prop palette ---
// One button per catalog entry, grouped under its category — parallel to the
// room-color swatches, but the "color" being picked is a whole prop type.
// At Phase 1's catalog size the flat list stopped scaling, so each category
// is a collapsible group and a filter box narrows the list by name; the
// filter hides non-matching buttons rather than rebuilding them, so the
// click handlers and the active state never have to be re-wired.
const palette = $('palette');
const paletteSearch = $('palette-search');
const paletteGroups = [];
catalogByCategory().forEach(({ category, entries }) => {
  const group = document.createElement('div');
  group.className = 'palette-group';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'palette-head';
  head.setAttribute('aria-expanded', 'true');
  head.innerHTML = `<span class="chev" aria-hidden="true">▾</span>${category}<span class="count">${entries.length}</span>`;
  head.addEventListener('click', () => {
    const collapsed = group.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
  const row = document.createElement('div');
  row.className = 'palette-row';
  const items = entries.map((entry) => {
    const b = document.createElement('button');
    b.className = 'palette-item' + (entry.type === editor.propType ? ' active' : '');
    b.dataset.type = entry.type;
    b.title = `${entry.name} — ${entry.w}×${entry.d}ft`;
    b.setAttribute('aria-pressed', String(entry.type === editor.propType));
    b.innerHTML = `<span class="icon">${entry.icon}</span>${entry.name}`;
    b.addEventListener('click', () => {
      editor.setPropType(entry.type);
      palette.querySelectorAll('.palette-item').forEach((x) => {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');
    });
    row.appendChild(b);
    return { b, entry };
  });
  group.append(head, row);
  palette.appendChild(group);
  paletteGroups.push({ group, head, items });
});
function filterPalette() {
  const q = paletteSearch.value.trim().toLowerCase();
  for (const g of paletteGroups) {
    let shown = 0;
    for (const { b, entry } of g.items) {
      const hit = !q || entry.name.toLowerCase().includes(q) || entry.type.includes(q);
      b.hidden = !hit;
      if (hit) shown++;
    }
    g.group.hidden = shown === 0;
    // A search that matches something inside a collapsed group should show
    // it — otherwise the filter looks like it found nothing.
    if (q && shown && g.group.classList.contains('collapsed')) {
      g.group.classList.remove('collapsed');
      g.head.setAttribute('aria-expanded', 'true');
    }
  }
}
paletteSearch.addEventListener('input', filterPalette);
paletteSearch.addEventListener('keydown', (e) => {
  // Esc clears the filter (and stops here rather than reaching the editor's
  // global key handling, which would cancel the active tool instead).
  if (e.key === 'Escape' && paletteSearch.value) {
    paletteSearch.value = '';
    filterPalette();
    e.stopPropagation();
  }
});

// --- template (room layout) palette ---
// One button per preset, same look as the prop palette above — the "color"
// being picked here is a whole furniture layout rather than one piece.
const templatePalette = $('template-palette');
ROOM_TEMPLATES.forEach((tpl) => {
  const b = document.createElement('button');
  b.className = 'palette-item' + (tpl.key === editor.templateKey ? ' active' : '');
  b.dataset.key = tpl.key;
  b.title = `${tpl.name} — ${tpl.stamps.length} pieces, ~${tpl.footprint.w}×${tpl.footprint.d}ft`;
  b.setAttribute('aria-pressed', String(tpl.key === editor.templateKey));
  b.innerHTML = `<span class="icon">${tpl.icon}</span>${tpl.name}`;
  b.addEventListener('click', () => {
    editor.setTemplateKey(tpl.key);
    templatePalette.querySelectorAll('.palette-item').forEach((x) => {
      x.classList.remove('active');
      x.setAttribute('aria-pressed', 'false');
    });
    b.classList.add('active');
    b.setAttribute('aria-pressed', 'true');
  });
  templatePalette.appendChild(b);
});

// --- wall type panel ---
// The wall tool builds one of three things. Which one is editor state (the grid
// and the polygon rooms spell each differently), so the buttons just set it.
const wallKinds = $('wall-kinds');
function renderWallKinds() {
  wallKinds.querySelectorAll('.kind-item').forEach((b) => {
    const on = b.dataset.kind === editor.wallKind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
WALL_KINDS.forEach((k) => {
  const b = document.createElement('button');
  b.className = 'kind-item';
  b.dataset.kind = k.kind;
  b.innerHTML = `<span class="icon">${k.icon}</span>${k.label}`;
  b.addEventListener('click', () => { editor.setWallKind(k.kind); renderWallKinds(); });
  wallKinds.appendChild(b);
});
renderWallKinds();

function cycleWallKind() {
  const i = WALL_KINDS.findIndex((k) => k.kind === editor.wallKind);
  const next = WALL_KINDS[(i + 1) % WALL_KINDS.length];
  editor.setWallKind(next.kind);
  renderWallKinds();
  $('status').textContent = `Wall — building ${next.label.toLowerCase()}. G cycles.`;
}

// --- door panel ---
// The door tool cuts one of four things, and the options under them only apply
// to some of those — a window has no push bar, a cased opening has no hand —
// so the panel hides what the current kind can't use rather than offering
// controls that quietly do nothing.
const doorKinds = $('door-kinds');
function renderDoorKinds() {
  const kind = editor.doorKind;
  doorKinds.querySelectorAll('.kind-item').forEach((b) => {
    const on = b.dataset.kind === kind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const opts = editor.doorOpts;
  const isWindow = kind === 'window';
  const hasLeaf = kind === 'single' || kind === 'double';
  $('door-lite').parentElement.hidden = kind !== 'single';
  $('door-bar').parentElement.hidden = kind !== 'single';
  document.querySelector('#door-opts .flip').hidden = !hasLeaf;
  $('door-sill-row').hidden = !isWindow;
  $('door-lite').checked = !!opts.lite;
  $('door-bar').checked = !!opts.bar;
  $('door-sill').value = String(opts.sill);
  $('door-hand').textContent = `Hinge: ${opts.hand === 1 ? 'left' : 'right'}`;
  $('door-swing').textContent = `Swing: ${opts.sw === 1 ? 'left' : 'right'}`;
}
DOOR_KINDS.forEach((k) => {
  const b = document.createElement('button');
  b.className = 'kind-item';
  b.dataset.kind = k.kind;
  b.innerHTML = `<span class="icon">${k.icon}</span>${k.label}`;
  b.addEventListener('click', () => { editor.setDoorKind(k.kind); renderDoorKinds(); });
  doorKinds.appendChild(b);
});
$('door-lite').addEventListener('change', (e) => {
  editor.setDoorOpts({ lite: e.target.checked });
});
$('door-bar').addEventListener('change', (e) => {
  editor.setDoorOpts({ bar: e.target.checked });
});
$('door-hand').addEventListener('click', () => {
  editor.setDoorOpts({ hand: editor.doorOpts.hand === 1 ? -1 : 1 });
  renderDoorKinds();
});
$('door-swing').addEventListener('click', () => {
  editor.setDoorOpts({ sw: editor.doorOpts.sw === 1 ? -1 : 1 });
  renderDoorKinds();
});
$('door-sill').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  editor.setDoorOpts({ sill: Number.isFinite(v) ? Math.min(9, Math.max(0, v)) : 3 });
  renderDoorKinds();
});
renderDoorKinds();

// --- stairs panel ---
const STAIR_KINDS = [
  { type: 'stair', icon: '🪜', label: 'Staircase' },
  { type: 'ramp', icon: '📐', label: 'Ramp' },
  { type: 'elevator', icon: '🛗', label: 'Elevator' },
  { type: 'opening', icon: '⬛', label: 'Floor opening' },
];
const stairKinds = $('stair-kinds');
function renderStairKinds() {
  stairKinds.querySelectorAll('.kind-item').forEach((b) => {
    const on = b.dataset.type === editor.stairType;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
STAIR_KINDS.forEach((k) => {
  const b = document.createElement('button');
  b.className = 'kind-item';
  b.dataset.type = k.type;
  b.innerHTML = `<span class="icon">${k.icon}</span>${k.label}`;
  b.addEventListener('click', () => { editor.setStairType(k.type); renderStairKinds(); renderStairReadout(); });
  stairKinds.appendChild(b);
});
renderStairKinds();

// The run a stair will have is fixed by the floor-to-floor height, so it can be
// reported before anything is placed — the number that decides whether a
// staircase fits the room you meant to put it in.
function renderStairReadout() {
  const m = stairMetrics(state);
  const here = linksFrom(state, state.currentFloor);
  const above = state.floors[state.currentFloor + 1];
  const count = (t) => here.filter((l) => l.type === t).length;
  const tally = [
    count('stair') ? `${count('stair')} stair${count('stair') === 1 ? '' : 's'}` : null,
    count('ramp') ? `${count('ramp')} ramp${count('ramp') === 1 ? '' : 's'}` : null,
    elevatorsOn(state, state.currentFloor).length
      ? `${elevatorsOn(state, state.currentFloor).length} lift(s)` : null,
    count('opening') ? `${count('opening')} opening${count('opening') === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  // Each kind's own headline number — the one that decides whether it fits the
  // room you meant to put it in. For a ramp that number is uncomfortable on
  // purpose: a 12ft rise at the ADA maximum of 1:12 is 144ft of run, and a
  // tool that quietly steepened it to something that fits would be lying about
  // whether the route is accessible.
  let head;
  if (editor.stairType === 'ramp') {
    const run = m.rise * RAMP_SLOPES[0];
    head = `1:${RAMP_SLOPES[0]} over a ${m.rise}ft rise · ${run.toFixed(0)}ft of run<br />` +
      '<em>An elevator is the usual accessible route between storeys.</em>';
  } else if (editor.stairType === 'elevator') {
    head = 'Car stands on both levels · press <kbd>E</kbd> inside it to ride<br />' +
      'Cuts no hole — you arrive on the slab above.';
  } else if (editor.stairType === 'opening') {
    head = 'A hole in the level above, railed all round.';
  } else {
    head = `${m.steps} risers at ${(m.riser * 12).toFixed(1)}in · ${m.run.toFixed(1)}ft of run`;
  }

  $('stair-readout').innerHTML = `${head}<br />` +
    (above
      ? `Serves ${floorLabel(state.currentFloor + 1)}` + (tally ? `<br />${tally} here` : '')
      : 'Nothing above this level yet — add one first.');
}

// --- floor panel ---
// Editing is one storey at a time; the level below shows through as a ghost so
// walls can be lined up between floors. Listed top-down, the way you'd read a
// building section.
const floorList = $('floor-list');

function renderFloorList() {
  floorList.textContent = '';
  for (let i = state.floors.length - 1; i >= 0; i--) {
    const b = document.createElement('button');
    b.className = 'floor' + (i === state.currentFloor ? ' active' : '');
    b.dataset.floor = String(i);
    const name = document.createElement('span');
    name.textContent = floorLabel(i);
    const count = document.createElement('span');
    count.className = 'count';
    const shapes = floorShapeCount(state.floors[i]);
    // Only staircases are counted here — a floor opening has no footprint worth
    // reporting, and the stairs panel gives the precise tally for the storey
    // you're actually editing.
    const stairs = linksFrom(state, i).filter((l) => l.type === 'stair').length;
    const sqft = floorCellCount(state.floors[i]) * CELL * CELL + totalShapeArea(state.floors[i]);
    count.textContent = `${Math.round(sqft).toLocaleString()} ft²` +
      (shapes ? ` · ${shapes} poly` : '') +
      (stairs ? ` · ${stairs} stair` : '');
    b.append(name, count);
    b.addEventListener('click', () => goToFloor(i));
    floorList.appendChild(b);
  }
  $('floor-add').disabled = state.floors.length >= MAX_FLOORS;
  $('floor-dup').disabled = state.floors.length >= MAX_FLOORS;
  $('floor-del').disabled = state.floors.length <= 1;
}

// Switching floors doesn't change the design, so it skips undo and reuses the
// geometry already built — only which storeys are drawn changes.
function goToFloor(i) {
  if (!setCurrentFloor(state, i)) return;
  renderApi.applyFloorVisibility();
  editor.refreshOverlay();   // handles belong to the storey you're editing
  renderFloorList();
  renderStairReadout();
  autosave(state);
  $('status').textContent = `${floorLabel(state.currentFloor)} — editing this floor`;
}

// Adding, copying and deleting a storey all change the design, so they go
// through undo and force a full geometry rebuild.
function floorEdit(mutate) {
  editor.pushUndo();
  if (!mutate()) { editor.dropUndo(); return; }
  rebuild();
  renderFloorList();
  renderStairReadout();
  autosave(state);
  updateUndoButtons();
  $('status').textContent = `${floorLabel(state.currentFloor)} — editing this floor`;
}

$('floor-add').addEventListener('click', () => floorEdit(() => addFloor(state) >= 0));
$('floor-dup').addEventListener('click', () => floorEdit(() => duplicateFloor(state) >= 0));
$('floor-del').addEventListener('click', () => {
  if (state.floors.length <= 1) return;
  const label = floorLabel(state.currentFloor);
  if (!confirm(`Delete ${label}? Anything on it goes with it. (Undoable.)`)) return;
  floorEdit(() => removeFloor(state));
});

// --- undo/redo ---
function updateUndoButtons() {
  $('undo-btn').disabled = !editor.canUndo;
  $('redo-btn').disabled = !editor.canRedo;
}
$('undo-btn').addEventListener('click', () => { editor.undo(); autosave(state); updateUndoButtons(); });
$('redo-btn').addEventListener('click', () => { editor.redo(); autosave(state); updateUndoButtons(); });

// --- file actions ---
$('save-btn').addEventListener('click', () => downloadSave(state, 'school.json'));

$('load-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    editor.pushUndo();
    state = await loadFromFile(file);
    renderApi.fitEditView(state);
    rebuild();
    editor.refreshOverlay();
    renderFloorList();
    renderStairReadout();
    renderEnvPanel();
    adoptedByAudio();
    autosaveNow(state);
    updateUndoButtons();
  } catch (err) {
    alert('Could not load that file: ' + err.message);
  }
});

// --- named designs (localStorage slots, on top of the single autosave) ---
const designsOverlay = $('designs-overlay');
const designsList = $('designs-list');

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function renderDesignsList() {
  designsList.textContent = '';
  const designs = listDesigns();
  if (!designs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No saved designs yet — name your current work above and save it.';
    designsList.appendChild(empty);
    return;
  }
  for (const d of designs) {
    const row = document.createElement('div');
    row.className = 'design-row';
    const info = document.createElement('div');
    info.className = 'design-info';
    const name = document.createElement('div');
    name.className = 'design-name';
    name.textContent = d.name;
    const meta = document.createElement('div');
    meta.className = 'design-meta';
    meta.textContent = `Saved ${fmtDate(d.updatedAt)}`;
    info.append(name, meta);

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '📂 Load';
    loadBtn.title = 'Replace the current design with this one';
    loadBtn.addEventListener('click', () => {
      try {
        editor.pushUndo();
        state = loadDesign(d.id);
        renderApi.fitEditView(state);
        rebuild();
        editor.refreshOverlay();
        renderFloorList();
        renderStairReadout();
        renderEnvPanel();
        adoptedByAudio();
        autosaveNow(state);
        updateUndoButtons();
        designsOverlay.classList.add('hidden');
        $('status').textContent = `Loaded "${d.name}"`;
      } catch (err) {
        alert('Could not load that design: ' + err.message);
      }
    });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.title = 'Overwrite this saved design with the current work';
    saveBtn.addEventListener('click', () => {
      try {
        saveDesign(state, d.name, d.id);
        renderDesignsList();
      } catch (err) {
        alert(err.message);
      }
    });

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', () => {
      const next = prompt('Rename design:', d.name);
      if (next === null) return;
      renameDesign(d.id, next);
      renderDesignsList();
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
      deleteDesign(d.id);
      renderDesignsList();
    });

    row.append(info, loadBtn, saveBtn, renameBtn, delBtn);
    designsList.appendChild(row);
  }
}

$('designs-btn').addEventListener('click', () => {
  $('designs-new-name').value = '';
  renderDesignsList();
  openModal(designsOverlay, $('designs-new-name'));
});
$('designs-close').addEventListener('click', () => closeModal(designsOverlay));
$('designs-save-new').addEventListener('click', () => {
  try {
    saveDesign(state, $('designs-new-name').value);
    $('designs-new-name').value = '';
    renderDesignsList();
  } catch (err) {
    alert(err.message);
  }
});
$('designs-new-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('designs-save-new').click();
});

// --- export: printable top-down floor plan (PNG / print-to-PDF) ---
const exportOverlay = $('export-overlay');
const printArea = $('print-area');

function exportScope() {
  const all = document.querySelector('input[name="export-scope"]:checked').value === 'all';
  return all ? state.floors.map((_, i) => i) : [state.currentFloor];
}

function exportOpts() {
  return {
    showDimensions: $('export-dims').checked,
    showFurniture: $('export-furniture').checked,
    showFinishes: $('export-finishes').checked,
  };
}

$('export-btn').addEventListener('click', () => openModal(exportOverlay));
$('export-close').addEventListener('click', () => closeModal(exportOverlay));

$('export-png').addEventListener('click', () => {
  const opts = exportOpts();
  for (const i of exportScope()) {
    const canvas = renderFloorPlanCanvas(state, i, opts);
    if (canvas) downloadCanvasPNG(canvas, `school-floor-plan-level-${i + 1}.png`);
  }
});

$('export-print').addEventListener('click', () => {
  const opts = exportOpts();
  printArea.textContent = '';
  for (const i of exportScope()) {
    const canvas = renderFloorPlanCanvas(state, i, opts);
    if (!canvas) continue;
    const page = document.createElement('div');
    page.className = 'print-page';
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    page.appendChild(img);
    printArea.appendChild(page);
  }
  closeModal(exportOverlay);
  window.print();
});

$('new-btn').addEventListener('click', () => {
  if (!confirm('Start a new empty school? (Current design stays in your undo history.)')) return;
  editor.pushUndo();
  state = createState();
  clearAutosave();
  renderApi.fitEditView(state);
  rebuild();
  editor.refreshOverlay();
  renderFloorList();
  renderStairReadout();
  renderEnvPanel();
  adoptedByAudio();
  updateUndoButtons();
});

$('fx-btn').addEventListener('click', () => {
  renderApi.fxEnabled = !renderApi.fxEnabled;
  $('fx-btn').classList.toggle('off', !renderApi.fxEnabled);
  $('fx-btn').setAttribute('aria-pressed', String(renderApi.fxEnabled));
});

// --- layers panel ---
// What's drawn while editing, independent of which tool is active — see
// render.js's `layers`/`setLayers`. The checkboxes start matching its
// defaults (structure and this floor's furniture on, the floor below ghosted
// through, the floor above hidden), so opening the tool for the first time
// looks exactly like it always has.
const LAYER_CHECKBOXES = [
  ['layer-structure', 'structure'],
  ['layer-props', 'props'],
  ['layer-ghost-below', 'ghostBelow'],
  ['layer-ghost-above', 'ghostAbove'],
];
for (const [id, key] of LAYER_CHECKBOXES) {
  $(id).checked = renderApi.layers[key];
  $(id).addEventListener('change', (e) => renderApi.setLayers({ [key]: e.target.checked }));
}

// --- sky panel: the sun, the date and the building's own lights ---
//
// Everything here writes one field on `state.env` and then asks the renderer to
// re-light the scene. Nothing rebuilds geometry: the sun is a light, not a
// wall, so a scrub through an afternoon is a couple of uniform writes a frame
// and the building itself is never touched. That is what makes the time slider
// a *scrub* rather than a stepped preview, which was the point of the phase.
const envPanel = $('env-panel');

// A sky change is a change to the design (it saves, it's in the file), but it
// is not an undoable *edit* the way drawing a wall is — nobody wants Ctrl+Z to
// walk backwards through the sixty positions a slider passed through. So it
// autosaves and skips the undo stack, the same call floor switching makes.
function envChanged() {
  state.env = normalizeEnv(state.env);
  renderApi.setEnvironment(state.env);
  renderEnvPanel();
  autosave(state);
}

const envPresets = $('env-presets');
SUN_PRESETS.forEach((p) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.preset = p.key;
  b.title = `Jump to ${p.label.toLowerCase()} on this date, at this latitude`;
  b.innerHTML = `<span aria-hidden="true">${p.icon}</span> ${p.label}`;
  b.addEventListener('click', () => {
    state.env.minutes = presetMinutes(p.key, state.env);
    envChanged();
    $('status').textContent =
      `Sky — ${p.label.toLowerCase()}, ${formatClock(state.env.minutes)} on ${formatDate(state.env.month, state.env.day)}.`;
  });
  envPresets.appendChild(b);
});

const envMonth = $('env-month');
MONTH_NAMES.forEach((name, i) => {
  const o = document.createElement('option');
  o.value = String(i + 1);
  o.textContent = name;
  envMonth.appendChild(o);
});

envMonth.addEventListener('change', (e) => {
  state.env.month = Number(e.target.value);
  // February 30th isn't a date. `normalizeEnv` would clamp it anyway, but
  // moving the slider's own maximum keeps the control honest about it.
  state.env.day = Math.min(state.env.day, daysInMonth(state.env.month));
  envChanged();
});
$('env-day').addEventListener('input', (e) => {
  state.env.day = Number(e.target.value);
  envChanged();
});
$('env-time').addEventListener('input', (e) => {
  state.env.minutes = Number(e.target.value);
  envChanged();
});
$('env-lat').addEventListener('input', (e) => {
  state.env.lat = Number(e.target.value);
  envChanged();
});
$('env-north').addEventListener('input', (e) => {
  state.env.north = Number(e.target.value);
  envChanged();
});

const LIGHT_MODE_BUTTONS = [
  { mode: 'auto', label: 'Auto', title: 'On when the sun is down' },
  { mode: 'on', label: 'On', title: 'Always burning' },
  { mode: 'off', label: 'Off', title: 'Never burning' },
];
const envLights = $('env-lights');
LIGHT_MODE_BUTTONS.forEach((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.mode = m.mode;
  b.textContent = m.label;
  b.title = m.title;
  b.addEventListener('click', () => {
    state.env.lights = m.mode;
    envChanged();
  });
  envLights.appendChild(b);
});

// The controls, told what the state says. Called after every change (including
// a file load) so the panel can never disagree with the design.
function renderEnvPanel() {
  const env = state.env;
  $('env-time').value = String(env.minutes);
  $('env-time-value').textContent = formatClock(env.minutes);
  envMonth.value = String(env.month);
  $('env-day').max = String(daysInMonth(env.month));
  $('env-day').value = String(env.day);
  $('env-date-value').textContent = formatDate(env.month, env.day);
  $('env-lat').value = String(Math.round(env.lat));
  $('env-lat-value').textContent = formatLat(env.lat);
  $('env-north').value = String(Math.round(env.north / 5) * 5);
  $('env-north-value').textContent = `${Math.round(env.north)}°`;
  for (const b of envLights.children) {
    const on = b.dataset.mode === env.lights;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  renderEnvReadout();
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const bearingName = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// What the numbers actually mean, in words. The sun's own position, when it
// rises and sets on this date, and — the part that justifies having written a
// budget at all — how many of the design's fixtures are real lights right now.
function renderEnvReadout() {
  const sky = skyState(state.env);
  const t = sky.times;
  const daylight = t.sunrise === null
    ? (t.polar === 'day' ? 'Sun never sets here today' : 'Sun never rises here today')
    : `Sunrise ${formatClock(t.sunrise)} · sunset ${formatClock(t.sunset)}`;
  // The light budget, in the terms the panel can be honest about: how many
  // fixtures the design holds, how few lights they cluster down to, and how
  // many of those the renderer will make real at once. The last line says
  // whether any of it is switched on, since in daylight the answer is none.
  const lights = renderApi.lightReport();
  const burning = lights.burning
    ? `${lights.lit} lit here now`
    : (sky.daylight ? 'off — daylight' : 'off');
  const fixtures = lights.sources
    ? `${lights.sources} fixture${lights.sources === 1 ? '' : 's'} · ` +
      `${lights.clustered} group${lights.clustered === 1 ? '' : 's'}, ${lights.cap} live at once · ${burning}`
    : `No fixtures placed — the ceiling's own troffers are ${lights.burning ? 'on' : 'off'}.`;
  $('env-readout').innerHTML =
    `<b>${sky.phase}</b><br />` +
    `Sun ${sky.sun.altitude.toFixed(0)}° up, bearing ${sky.sun.azimuth.toFixed(0)}° (${bearingName(sky.sun.azimuth)})<br />` +
    `${daylight}<br />` +
    `Plan north points ${bearingName(state.env.north)}<br />` +
    `${fixtures}`;
}

$('env-btn').addEventListener('click', () => {
  const hidden = envPanel.classList.toggle('hidden');
  $('env-btn').classList.toggle('off', hidden);
  $('env-btn').setAttribute('aria-pressed', String(!hidden));
});

// --- sound panel ---
//
// Two jobs, and only the first one is about audio. The mix controls are
// obvious. The readout is the interesting half: it prints what acoustics.js
// derives about the room you are standing in — its volume, its total
// absorption, its Sabine reverberation time — and holds that number against
// the one ANSI/ASA S12.60 asks a classroom to meet. That makes it the first
// piece of Phase 7's "is this a *good* building" analysis, arriving early
// because the sound needed the same numbers anyway.
//
// While editing there is no walker to stand anywhere, so it rolls the whole
// current storey up instead: how many rooms, and which of them ring too long.

const audioPanel = $('audio-panel');

function adoptedByAudio() {
  audio.setWorld(state);
  renderAudioPanel();
}

function renderAudioPanel() {
  const vol = Math.round(audio.volume * 100);
  $('audio-volume').value = String(vol);
  $('audio-volume-value').textContent = `${vol}%`;
  renderAudioReadout();
}

const ft = (n) => Math.round(n).toLocaleString();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The room the walker is in, in the terms the panel can be honest about.
function roomLines(ac) {
  if (!ac || isOutside(ac)) {
    return '<b>Outside</b><br />No room, no reverberation — open air and whatever the wind is doing.';
  }
  const limit = ac.limit !== null
    ? (ac.overLimit
      ? ` · <span class="over">over the ${ac.limit.toFixed(1)} s limit</span>`
      : ` · under the ${ac.limit.toFixed(1)} s limit`)
    : '';
  // The ceiling is a room-wide average now (see acoustics.js's roomCeiling), so
  // a hall with an atrium down the middle of it says how much of it is open
  // rather than claiming the whole lid is off.
  const lid = ac.openFraction > 0
    ? `${ac.height.toFixed(0)} ft, ${Math.round(ac.openFraction * 100)}% open above`
    : `${ac.height.toFixed(0)} ft ceiling`;
  return `<b>${ac.name || (ac.kind === 'shape' ? 'Unnamed room' : 'Unlabelled area')}</b><br />` +
    `${ft(ac.area)} ft² · ${lid} · ${ft(ac.volume)} ft³<br />` +
    `<b>RT60 ${ac.rt60.toFixed(2)} s</b> — ${ac.verdict}${limit}<br />` +
    `${ft(ac.sabins)} sabins absorbing · ${plural(ac.props, 'piece')} of furniture`;
}

// What the mixer is carrying, and what it isn't. The same bargain the sky
// panel's light budget makes: say what was dropped rather than let the cap be
// something you find out about by wondering why the corridor went quiet.
function mixLines(r) {
  if (r.total === 0) {
    return 'Nothing in this design makes a noise yet.<br />' +
      'No bells placed — <b>B</b> rings one where you stand.';
  }
  const bits = [];
  // The continuous sources, whose counts add up: every machine is either
  // audible from here, over the voice budget, or out of earshot.
  if (r.machines) {
    bits.push(`${plural(r.machines, 'machine')} · <b>${r.heard} audible here</b>` +
      (r.dropped ? ` · ${r.dropped} over budget` : '') +
      (r.muted ? ` · ${r.muted} out of earshot` : ''));
  }
  const kit = [];
  if (r.bells) kit.push(plural(r.bells, 'bell'));
  if (r.speakers) kit.push(plural(r.speakers, 'speaker'));
  if (r.clocks) kit.push(plural(r.clocks, 'clock'));
  bits.push(kit.length ? kit.join(' · ') : 'No bells placed — <b>B</b> rings one where you stand.');
  return bits.join('<br />');
}

// Editing: no walker, so roll the storey up instead. This is `roomsOnFloor`'s
// only caller today and the reason it exists — the same reader Phase 7's
// report will want, wired to something now so it can't rot.
function floorLines() {
  const rooms = roomsOnFloor(state, state.currentFloor, catalogEntry);
  if (!rooms.length) return 'Nothing enclosed on this level yet.';
  const over = rooms.filter((r) => r.overLimit);
  const worst = [...rooms].sort((a, b) => b.rt60 - a.rt60).slice(0, 3);
  const list = worst.map((r) =>
    `<div><span>${r.name || (r.kind === 'shape' ? 'Unnamed room' : 'Unlabelled area')}</span>` +
    `<span class="${r.overLimit ? 'over' : ''}">${r.rt60.toFixed(2)} s</span></div>`).join('');
  return `<b>${floorLabel(state.currentFloor)}</b><br />` +
    `${plural(rooms.length, 'enclosed room')}` +
    (over.length ? ` · <span class="over">${over.length} over the ANSI limit</span>` : ' · all within the ANSI limit') +
    `<div class="rooms">${list}</div>`;
}

function renderAudioReadout() {
  if (audioPanel.classList.contains('hidden')) return;
  const r = audio.report;
  $('audio-readout').innerHTML = mode === 'walk'
    ? `${roomLines(r.room)}<br />${mixLines(r)}`
    : `${floorLines()}<br />${mixLines(r)}<br />Walk through the building (Tab) to hear it.`;
}

$('audio-volume').addEventListener('input', (e) => {
  audio.setVolume(Number(e.target.value) / 100);
  $('audio-volume-value').textContent = `${Math.round(audio.volume * 100)}%`;
});
$('audio-bell').addEventListener('click', () => { audio.ring(); renderAudioReadout(); });
$('audio-pa').addEventListener('click', () => { audio.announce(); renderAudioReadout(); });

$('audio-btn').addEventListener('click', () => {
  const hidden = audioPanel.classList.toggle('hidden');
  $('audio-btn').classList.toggle('off', hidden);
  $('audio-btn').setAttribute('aria-pressed', String(!hidden));
  if (!hidden) renderAudioPanel();
});

// --- photo mode ---
//
// A walkthrough affordance, not an editor one: it takes the walker off its
// feet (free flight), takes the HUD and the crosshair off the screen, and puts
// a lens on the camera. None of it is saved with the design — a photograph is
// not part of the building.
let photoMode = false;

function setPhotoMode(on) {
  if (on === photoMode) return;
  if (on && mode !== 'walk') return;
  photoMode = on;
  document.body.classList.toggle('photo', on);
  walk.setGhost(on);
  renderApi.setPhoto({ on });
  if (on) {
    // The panel is unreachable behind a locked pointer, so entering photo mode
    // releases it and — unlike every other unlock — does *not* raise the walk
    // overlay over the controls you just asked for.
    if (walk.controls.isLocked) walk.controls.unlock();
    closeModal(walkOverlay);
    renderPhotoPanel();
  } else if (mode === 'walk' && !isTouch && !walk.controls.isLocked) {
    openModal(walkOverlay, $('walk-start'));
  }
}

function renderPhotoPanel() {
  const p = renderApi.photo;
  $('photo-fov').value = String(Math.round(p.fov));
  $('photo-fov-value').textContent = `${Math.round(p.fov)}°`;
  $('photo-focus').value = String(Math.round(p.focus));
  $('photo-focus-value').textContent = `${Math.round(p.focus)} ft`;
  $('photo-aperture').value = String(p.aperture);
  $('photo-aperture-value').textContent = `f/${p.aperture.toFixed(1)}`;
  $('photo-dof').checked = p.dof;
  $('photo-exposure').value = String(renderApi.exposureBias);
  $('photo-exposure-value').textContent = `${renderApi.exposureBias.toFixed(2)}×`;
}

$('photo-fov').addEventListener('input', (e) => {
  renderApi.setPhoto({ fov: Number(e.target.value) });
  renderPhotoPanel();
});
$('photo-focus').addEventListener('input', (e) => {
  renderApi.setPhoto({ focus: Number(e.target.value) });
  renderPhotoPanel();
});
$('photo-aperture').addEventListener('input', (e) => {
  renderApi.setPhoto({ aperture: Number(e.target.value) });
  renderPhotoPanel();
});
$('photo-dof').addEventListener('change', (e) => {
  renderApi.setPhoto({ dof: e.target.checked });
  renderPhotoPanel();
});
$('photo-exposure').addEventListener('input', (e) => {
  renderApi.exposureBias = Number(e.target.value);
  renderPhotoPanel();
});
for (const [id, scale] of [['photo-1x', 1], ['photo-2x', 2], ['photo-4x', 4]]) {
  $(id).addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    renderApi.downloadCapture(scale, `school-photo-${stamp}.png`);
  });
}

// --- keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !designsOverlay.classList.contains('hidden')) {
    closeModal(designsOverlay); return;
  }
  if (e.code === 'Escape' && !exportOverlay.classList.contains('hidden')) {
    closeModal(exportOverlay); return;
  }
  // A shortcut must never fire while somebody is filling in a field — and the
  // sky panel added the first <select> to the page, so this can't just be
  // "is it an input?" any more.
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
    e.target.tagName === 'TEXTAREA';
  if (e.code === 'Tab' && !typing) { e.preventDefault(); setMode(mode === 'edit' ? 'walk' : 'edit'); return; }
  // Two shortcuts that belong to the view rather than to a tool, so they work
  // in both modes: the sky panel, and photo mode (walkthrough only — there is
  // nothing to photograph from 200ft above a floor plan).
  if (e.code === 'KeyY' && !typing && !e.ctrlKey && !e.metaKey) { $('env-btn').click(); return; }
  // Sound's three, next to the sky's on the keyboard as well as in the rail.
  if (e.code === 'KeyU' && !typing && !e.ctrlKey && !e.metaKey) { $('audio-btn').click(); return; }
  if (e.code === 'KeyB' && !typing && !e.ctrlKey && !e.metaKey) {
    audio.ring(); renderAudioReadout(); return;
  }
  if (e.code === 'KeyN' && !typing && !e.ctrlKey && !e.metaKey) {
    audio.announce(); renderAudioReadout(); return;
  }
  if (e.code === 'KeyP' && !typing && !e.ctrlKey && !e.metaKey && mode === 'walk') {
    setPhotoMode(!photoMode);
    return;
  }
  if (mode !== 'edit' || typing) return;
  // Enter / Escape / Backspace / Delete belong to the polygon tools while one
  // of them is holding an outline or a selection.
  if (!e.ctrlKey && !e.metaKey && editor.handleKey(e)) {
    e.preventDefault();
    autosave(state);
    updateUndoButtons();
    return;
  }
  // Copy/paste/duplicate for whichever selection owns them — the prop tool's
  // or the vertex tool's whole-room-section selection. Ctrl combos, so they
  // never reach editor.handleKey above; each call below checks its own tool
  // and no-ops otherwise, so only the active one actually does anything.
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && (editor.propCopy() || editor.shapeCopy())) {
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && (editor.propPaste() || editor.shapePaste())) {
    e.preventDefault();
    autosave(state); updateUndoButtons();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD' && (editor.propDuplicate() || editor.shapeDuplicate())) {
    e.preventDefault();
    autosave(state); updateUndoButtons();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    e.shiftKey ? editor.redo() : editor.undo();
    autosave(state); updateUndoButtons();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
    e.preventDefault();
    editor.redo(); autosave(state); updateUndoButtons();
    return;
  }
  if (e.code === 'KeyG' && editor.tool === 'wall') { cycleWallKind(); return; }
  if (e.code === 'BracketLeft')  { goToFloor(state.currentFloor - 1); return; }
  if (e.code === 'BracketRight') { goToFloor(state.currentFloor + 1); return; }
  if (TOOL_KEYS[e.code]) selectTool(TOOL_KEYS[e.code]);
});

window.addEventListener('beforeunload', () => autosaveNow(state));
window.addEventListener('resize', () => renderApi.resize());

// --- main loop ---
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'walk') { walk.update(dt); audio.update(dt); }
  renderApi.render(dt);
}

selectTool('floor');
renderFloorList();
renderStairReadout();
renderEnvPanel();
renderAudioPanel();
audio.setWorld(state);
updateUndoButtons();
loop();

// debug/test hook
window.app = {
  get state() { return state; },
  setMode, renderApi, editor, walk,
  setPhotoMode, envChanged, audio,
};
