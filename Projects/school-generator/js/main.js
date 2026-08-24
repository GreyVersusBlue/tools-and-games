// main.js — bootstrap and UI wiring.

import * as THREE from 'three';
import { createState, buildSampleSchool, ROOM_COLORS } from './grid.js';
import { initRender } from './render.js';
import { initEditor } from './editor.js';
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
const TOOL_KEYS = { Digit1: 'floor', Digit2: 'wall', Digit3: 'door', Digit4: 'room', Digit5: 'erase' };
const HINTS = {
  floor: 'Floor — click / drag to lay floor tiles',
  wall: 'Wall — drag along cell edges to raise walls',
  door: 'Door — click a wall edge to toggle a doorway',
  room: 'Room — pick a name & color, then click a floor area to label it',
  erase: 'Eraser — drag to remove walls, doors, and floor',
};

function selectTool(t) {
  editor.setTool(t);
  document.querySelectorAll('#toolbar .tool').forEach((b) =>
    b.classList.toggle('active', b.dataset.tool === t));
  $('room-panel').classList.toggle('hidden', t !== 'room');
  $('status').textContent = HINTS[t];
}

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
updateUndoButtons();
loop();

// debug/test hook
window.app = { get state() { return state; }, setMode, renderApi, editor };
