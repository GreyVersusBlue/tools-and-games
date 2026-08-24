// main.js — bootstrap and UI wiring.

import * as THREE from 'three';
import {
  createState, ROOM_COLORS, MAX_FLOORS,
  floorLabel, floorCellCount, floorShapeCount,
  addFloor, duplicateFloor, removeFloor, setCurrentFloor,
} from './grid.js';
import { buildSampleSchool } from './sample.js';
import { catalogByCategory } from './catalog.js';
import { initRender } from './render.js';
import { initEditor, WALL_KINDS } from './editor.js';
import { stairMetrics, linksFrom } from './stairs.js';
import { initWalkthrough } from './walkthrough.js';
import {
  downloadSave, loadFromFile, autosave, autosaveNow, loadAutosave, clearAutosave,
} from './save-load.js';

const canvas = document.getElementById('view');
const $ = (id) => document.getElementById(id);

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
  },
  // The polygon tools have more to say than a fixed per-tool hint — how many
  // corners are down, how big the room is — so they drive the status line.
  onStatus: (text) => { $('status').textContent = text; },
  onHoleMode: (on) => {
    $('hole-btn').classList.toggle('on', on);
    $('hole-btn').setAttribute('aria-pressed', String(on));
  },
});

const walk = initWalkthrough(renderApi.walkCamera, canvas);

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
    walkOverlay.classList.remove('hidden');
    $('mode-btn').textContent = '✏️ Edit Mode';
  } else {
    walk.disable();
    walkOverlay.classList.add('hidden');
    editor.setEnabled(true);
    $('mode-btn').textContent = '🚶 Walk Through';
  }
}

$('mode-btn').addEventListener('click', () => setMode(mode === 'edit' ? 'walk' : 'edit'));
$('walk-start').addEventListener('click', () => walk.controls.lock());
$('walk-exit').addEventListener('click', () => setMode('edit'));

walk.controls.addEventListener('lock', () => walkOverlay.classList.add('hidden'));
walk.controls.addEventListener('unlock', () => {
  if (mode === 'walk') walkOverlay.classList.remove('hidden');
});

// --- tool buttons ---
const TOOL_KEYS = {
  Digit1: 'floor', Digit2: 'wall', Digit3: 'door', Digit4: 'room',
  Digit5: 'erase', Digit6: 'poly', Digit7: 'vertex', Digit8: 'prop',
  Digit9: 'stair',
};
const HINTS = {
  floor: 'Floor — click / drag to lay floor tiles',
  wall: 'Wall — drag along cell edges, or click a polygon wall to raise it. G switches between solid, glass and railing.',
  door: 'Door — click a wall edge, or anywhere along a polygon wall',
  room: 'Room — pick a name & color, then click a floor area to label it',
  erase: 'Eraser — drag to remove walls, doors, and floor; click a polygon room to delete it',
  poly: 'Polygon — click to place corners, click the first one (or Enter) to close. Alt = ignore snapping, Shift = 15° steps.',
  vertex: 'Shape — click a room to select it. A grid room becomes a polygon when you do.',
  prop: 'Furniture — pick a piece, click to place. Click/drag a piece to move it, drag empty space to box-select. R rotates, Delete removes, Ctrl+C/V/D copy/paste/duplicate.',
  stair: 'Stairs — click to place a run up to the next level, which cuts its own opening in that floor. R rotates, drag to move, Delete removes.',
};

function selectTool(t) {
  editor.setTool(t);
  document.querySelectorAll('#toolbar .tool').forEach((b) =>
    b.classList.toggle('active', b.dataset.tool === t));
  // The polygon tool names its room from the same panel the room tool uses —
  // one place to pick a name and a color, whichever kind of room it lands on.
  $('room-panel').classList.toggle('hidden', t !== 'room' && t !== 'poly');
  $('poly-extra').classList.toggle('hidden', t !== 'poly');
  $('prop-panel').classList.toggle('hidden', t !== 'prop');
  $('wall-panel').classList.toggle('hidden', t !== 'wall');
  $('stair-panel').classList.toggle('hidden', t !== 'stair');
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
  b.addEventListener('click', () => {
    swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
    b.classList.add('active');
    editor.setRoom($('room-name').value, c);
  });
  swatches.appendChild(b);
});
$('room-name').value = editor.roomName;
$('room-name').addEventListener('input', (e) => editor.setRoom(e.target.value, editor.roomColor));

// --- prop palette ---
// One button per catalog entry, grouped under its category — parallel to the
// room-color swatches, but the "color" being picked is a whole prop type.
const palette = $('palette');
catalogByCategory().forEach(({ category, entries }) => {
  const h = document.createElement('h3');
  h.textContent = category;
  palette.appendChild(h);
  const row = document.createElement('div');
  row.className = 'palette-row';
  entries.forEach((entry) => {
    const b = document.createElement('button');
    b.className = 'palette-item' + (entry.type === editor.propType ? ' active' : '');
    b.dataset.type = entry.type;
    b.title = `${entry.name} — ${entry.w}×${entry.d}ft`;
    b.innerHTML = `<span class="icon">${entry.icon}</span>${entry.name}`;
    b.addEventListener('click', () => {
      editor.setPropType(entry.type);
      palette.querySelectorAll('.palette-item').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    row.appendChild(b);
  });
  palette.appendChild(row);
});

// --- wall type panel ---
// The wall tool builds one of three things. Which one is editor state (the grid
// and the polygon rooms spell each differently), so the buttons just set it.
const wallKinds = $('wall-kinds');
function renderWallKinds() {
  wallKinds.querySelectorAll('.kind-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.kind === editor.wallKind));
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

// --- stairs panel ---
const STAIR_KINDS = [
  { type: 'stair', icon: '🪜', label: 'Staircase' },
  { type: 'opening', icon: '⬛', label: 'Floor opening' },
];
const stairKinds = $('stair-kinds');
function renderStairKinds() {
  stairKinds.querySelectorAll('.kind-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.type === editor.stairType));
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
  const stairs = here.filter((l) => l.type === 'stair').length;
  const holes = here.length - stairs;
  const above = state.floors[state.currentFloor + 1];
  const tally = [
    stairs ? `${stairs} stair${stairs === 1 ? '' : 's'}` : null,
    holes ? `${holes} opening${holes === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  $('stair-readout').innerHTML =
    `${m.steps} risers at ${(m.riser * 12).toFixed(1)}in · ${m.run.toFixed(1)}ft of run<br />` +
    (above
      ? `Rises to ${floorLabel(state.currentFloor + 1)}` + (tally ? `<br />${tally} here` : '')
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
    count.textContent = `${floorCellCount(state.floors[i])} cells` +
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
    autosaveNow(state);
    updateUndoButtons();
  } catch (err) {
    alert('Could not load that file: ' + err.message);
  }
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
  updateUndoButtons();
});

$('fx-btn').addEventListener('click', () => {
  renderApi.fxEnabled = !renderApi.fxEnabled;
  $('fx-btn').classList.toggle('off', !renderApi.fxEnabled);
});

// --- keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT';
  if (e.code === 'Tab' && !typing) { e.preventDefault(); setMode(mode === 'edit' ? 'walk' : 'edit'); return; }
  if (mode !== 'edit' || typing) return;
  // Enter / Escape / Backspace / Delete belong to the polygon tools while one
  // of them is holding an outline or a selection.
  if (!e.ctrlKey && !e.metaKey && editor.handleKey(e)) {
    e.preventDefault();
    autosave(state);
    updateUndoButtons();
    return;
  }
  // Copy/paste/duplicate for the prop tool's selection — Ctrl combos, so they
  // never reach editor.handleKey above.
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && editor.propCopy()) {
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && editor.propPaste()) {
    e.preventDefault();
    autosave(state); updateUndoButtons();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD' && editor.propDuplicate()) {
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
  if (mode === 'walk') walk.update(dt);
  renderApi.render(dt);
}

selectTool('floor');
renderFloorList();
renderStairReadout();
updateUndoButtons();
loop();

// debug/test hook
window.app = { get state() { return state; }, setMode, renderApi, editor };
