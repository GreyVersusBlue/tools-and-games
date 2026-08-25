// main.js — bootstrap and UI wiring.

import * as THREE from 'three';
import {
  createState, ROOM_COLORS, MAX_FLOORS, CELL, EYE_H, floorBaseY,
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
import { FLOOR_FINISHES, DEFAULT_FINISH, FACADE_MATERIALS, DEFAULT_FACADE } from './finish.js';
import { SITE_SURFACES, SITE_MARKINGS, surfaceEntry, markingEntry, regionArea, siteSchedule } from './site.js';
import { terrainField, terrainRange, ensureTerrain, groundAt } from './terrain.js';
import { ROOF_STYLES, ensureRoof, normalizeRoof, isPitched, roofPlan } from './roof.js';
import {
  SUN_PRESETS, MONTH_NAMES, MAX_LAT, normalizeEnv, presetMinutes, daysInMonth,
  formatClock, formatDate, formatLat, skyState,
} from './sky.js';
import { initWalkthrough } from './walkthrough.js';
import { buildNav, navSummary } from './navgraph.js';
import {
  blockAt, bellsBetween, nextBell, clockText, countdownText, wrapMinutes,
  normalizeSchedule,
} from './schedule.js';
import {
  makePopulation, makeContext, retargetAll, stepAgents, census, drillReport,
  bodiesOn, makeCrowdField, crowdCells, clearCrowd, normalizeLife,
} from './agents.js';
import { buildCollider, storeyAt, WALKER_R } from './collide.js';
import { initAudio } from './audio.js';
import { doorEvents } from './sound.js';
import { roomsOnFloor, isOutside } from './acoustics.js';
import {
  downloadSave, loadFromFile, autosave, autosaveNow, loadAutosave, clearAutosave,
  listDesigns, saveDesign, loadDesign, deleteDesign, renameDesign,
} from './save-load.js';
import { renderFloorPlanCanvas, renderSitePlanCanvas, downloadCanvasPNG } from './blueprint.js';
import { buildReport, reportCSV } from './report.js';
import { isTouchCapable, joystickAxes } from './touch.js';
// --- Phase 8 ---
import { BANDS, DEFAULT_BRIEF, normalizeBrief, buildProgram, programLines } from './program.js';
import { parseBrief } from './brief.js';
import { layoutSchool, buildSchool, generationSummary } from './generate.js';
import { AUTO_ENTRY, AUTO_KEY } from './templateedit.js';
import {
  ALL_FLOORS, MAX_PIXELS, MAX_BYTES,
  makeOverlay, setOverlay, calibrate, describeOverlay, centreOn, showsOn,
} from './overlay.js';
import { buildingOverhang, floorOverhang } from './shadow.js';

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
    renderSiteReadout();
    // The tracing image is part of the design, so undo and redo can move it,
    // fade it or take it away entirely — and the panel has to follow.
    if (editor.tool === 'overlay') renderOverlayPanel();
    // Placing or deleting a fixture changes what the light budget is doing,
    // and the sky panel is the only place that says so.
    renderEnvReadout();
    // Same for sound: a diffuser placed, a room's finish changed or a wall
    // moved all change what there is to hear and how long it rings, and both
    // answers are derived rather than stored, so re-deriving is the whole
    // update. Skipped mid-drag — a stroke ends in an unthrottled call.
    if (!info.throttled) { audio.setWorld(state); renderAudioReadout(); }
    // ...and the same for the people. The graph is derived from the model, so
    // an edited model is a stale graph — and the colliders the crowd walks
    // against were built once, from the building that used to be there.
    if (!info.throttled && life.on) {
      lifeRebuildWorld();
      retargetAll(life.ctx, life.agents);
      renderLifeReadout();
    }
    // ...and the report, which is the most derived thing in the building: an
    // edit invalidates every number in it. It is a second of arithmetic on a
    // real school, so it is marked stale now and rebuilt when the drawing hand
    // stops rather than on every cell of a drag.
    if (!info.throttled) reportInvalidate();
  },
  // The polygon tools have more to say than a fixed per-tool hint — how many
  // corners are down, how big the room is — so they drive the status line.
  onStatus: (text) => { $('status').textContent = text; },
  onHoleMode: (on) => {
    $('hole-btn').classList.toggle('on', on);
    $('hole-btn').setAttribute('aria-pressed', String(on));
  },
  // The overlay tool has taken a measurement and wants to know what it is.
  // The dialog belongs to the shell, not to the tool — same division of
  // labour every other prompt in this file follows.
  onMeasure: (a, b) => askMeasurement(a, b),
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
    '👥 Life fills the building with people<br />' +
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
    if (life.on) walk.setBodies((i) => bodiesOn(life.agents, i));
    audio.setWorld(state);
    openModal(walkOverlay, $('walk-start'));
    closeModal($('designs-overlay'));
    closeModal($('export-overlay'));
    $('mode-btn').textContent = '✏️ Edit Mode';
  } else {
    setPhotoMode(false);
    walk.setFollow(null);
    walk.disable();
    audio.setActive(false);
    closeModal(walkOverlay);
    document.body.classList.remove('touch-walk');
    resetTouchWalkUI();
    editor.setEnabled(true);
    $('mode-btn').textContent = '🚶 Walk Through';
  }
  if (!lifePanel.classList.contains('hidden')) renderLifePanel();
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
  // The eleventh tool, on the key that comes after the ten digits on every
  // keyboard there is.
  Minus: 'site', NumpadSubtract: 'site',
  // ...and the twelfth, on the key after that one.
  Equal: 'overlay', NumpadAdd: 'overlay',
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
  site: 'Site — lay hardscape and fields, or grade the ground. Region: click corners, close the loop. Grade: drag to raise, ⇧ to lower, Alt to smooth.',
  overlay: 'Overlay — a plan or a sketch to trace over. Load an image, measure something you know the length of, say what it is, and the picture is scaled to match. Drag to move, R to turn.',
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
  $('site-panel').classList.toggle('hidden', t !== 'site');
  $('overlay-panel').classList.toggle('hidden', t !== 'overlay');
  if (t === 'stair') renderStairReadout();
  if (t === 'site') renderSitePanel();
  if (t === 'overlay') renderOverlayPanel();
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
//
// Phase 8 puts one more swatch at the top of it: "Auto", which doesn't stamp a
// fixed layout at all — it reads the room you clicked, picks the layout its
// *name* asks for, turns it to face the door and drops whatever doesn't fit.
// It is the same gesture as every other swatch here, which is why it lives in
// the same palette rather than in a menu of its own.
const templatePalette = $('template-palette');
[AUTO_ENTRY, ...ROOM_TEMPLATES].forEach((tpl) => {
  const auto = tpl.key === AUTO_KEY;
  const b = document.createElement('button');
  b.className = 'palette-item' + (tpl.key === editor.templateKey ? ' active' : '');
  b.dataset.key = tpl.key;
  b.title = auto
    ? 'Click a room and it gets the layout its name asks for — "Science Lab 2" ' +
      'gets benches, "Room 104" gets desks, and anything too big for the room is dropped.'
    : `${tpl.name} — ${tpl.stamps.length} pieces, ~${tpl.footprint.w}×${tpl.footprint.d}ft`;
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
  renderShadowReadout();
}

// --- the structural shadow ---
//
// Phase 8's rule, and the whole of its interface: on an upper storey you build
// inside the footprint of the storey below unless you say otherwise, the
// shadow is drawn under the plan so you can see what that footprint is, and
// what you have already built outside it is counted in one line.
//
// The switch is on the floor panel rather than in a dialog because it belongs
// to the storey you are on, and the readout is a sentence rather than a
// warning triangle because a cantilever is a thing people draw on purpose.
const floorOverhangRow = $('floor-overhang-row');
const floorOverhangBox = $('floor-overhang');

floorOverhangBox.addEventListener('change', (e) => {
  editor.setAllowOverhang(e.target.checked);
  renderShadowReadout();
  $('status').textContent = e.target.checked
    ? 'Overhangs on — you can build past the storey below. Nothing carries what hangs over.'
    : 'Overhangs off — this storey is limited to the footprint below it.';
});

function renderShadowReadout() {
  const upper = state.currentFloor > 0;
  floorOverhangRow.classList.toggle('hidden', !upper);
  const el = $('floor-shadow-readout');
  if (!upper) {
    el.textContent = 'The ground floor stands on the ground — nothing to line up with.';
    return;
  }
  const o = floorOverhang(state, state.currentFloor);
  const below = floorLabel(state.currentFloor - 1);
  if (!o.count) {
    el.textContent = `Every part of this storey stands on ${below}.` +
      (editor.allowOverhang ? ' Overhangs are allowed.' : '');
    return;
  }
  el.textContent = `${Math.round(o.area).toLocaleString()} ft² of this storey — ` +
    `${Math.round(o.ratio * 100)}% of it — is outside ${below}. ` +
    'Measured at 4ft lattice resolution.';
}

// Switching floors doesn't change the design, so it skips undo and reuses the
// geometry already built — only which storeys are drawn changes.
function goToFloor(i) {
  if (!setCurrentFloor(state, i)) return;
  renderApi.applyFloorVisibility();
  renderOverlayPanel();
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
$('undo-btn').addEventListener('click', () => { editor.undo(); afterEdit(); });
$('redo-btn').addEventListener('click', () => { editor.redo(); afterEdit(); });

// Undo restores the model in place, which the crowd is standing on: its graph
// is now describing a building that has been edited out from under it.
function afterEdit() {
  autosave(state);
  updateUndoButtons();
  if (life.on) {
    lifeRebuildWorld();
    retargetAll(life.ctx, life.agents);
  }
  reportInvalidate();
}

// --- file actions ---

// Replacing the whole design — New, Load, a saved slot, or the generator —
// is the same eight calls every time, and Phase 8 made it ten: the tracing
// overlay and the structural shadow both belong to the design and both have to
// be re-read when it changes underneath them. One function, so a new way of
// arriving at a design can't forget one of them.
//
// `keepAutosave` is the New button's exception: it has just cleared the
// autosave on purpose and writing an empty school straight back over it would
// undo that.
function adoptState(next, opts = {}) {
  state = next;
  renderApi.fitEditView(state);
  rebuild();
  editor.refreshOverlay();
  renderApi.refreshOverlay(state);
  renderFloorList();
  renderStairReadout();
  renderEnvPanel();
  renderSitePanel();
  renderOverlayPanel();
  adoptedByAudio();
  reportInvalidate();
  if (!opts.keepAutosave) autosaveNow(state);
  updateUndoButtons();
}

$('save-btn').addEventListener('click', () => downloadSave(state, 'school.json'));

$('load-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    editor.pushUndo();
    adoptState(await loadFromFile(file));
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
        adoptState(loadDesign(d.id));
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
    showOccupancy: $('export-occupancy').checked,
    contours: $('export-contours').checked,
  };
}

// The site plan is a sheet, not a floor — it has no storey — so it rides
// alongside the floor scope rather than inside it.
const wantsSite = () => $('export-site').checked;

$('export-btn').addEventListener('click', () => openModal(exportOverlay));
$('export-close').addEventListener('click', () => closeModal(exportOverlay));

$('export-png').addEventListener('click', () => {
  const opts = exportOpts();
  for (const i of exportScope()) {
    const canvas = renderFloorPlanCanvas(state, i, opts);
    if (canvas) downloadCanvasPNG(canvas, `school-floor-plan-level-${i + 1}.png`);
  }
  if (wantsSite()) {
    const canvas = renderSitePlanCanvas(state, opts);
    if (canvas) downloadCanvasPNG(canvas, 'school-site-plan.png');
  }
});

$('export-print').addEventListener('click', () => {
  const opts = exportOpts();
  printArea.textContent = '';
  const sheet = (canvas) => {
    if (!canvas) return;
    const page = document.createElement('div');
    page.className = 'print-page';
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    page.appendChild(img);
    printArea.appendChild(page);
  };
  // The site plan leads, the way it does in a real set: you look at where the
  // building sits before you look at what is inside it.
  if (wantsSite()) sheet(renderSitePlanCanvas(state, opts));
  for (const i of exportScope()) sheet(renderFloorPlanCanvas(state, i, opts));
  closeModal(exportOverlay);
  window.print();
});

$('new-btn').addEventListener('click', () => {
  if (!confirm('Start a new empty school? (Current design stays in your undo history.)')) return;
  editor.pushUndo();
  clearAutosave();
  adoptState(createState(), { keepAutosave: true });
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
  ['layer-overlay', 'overlay'],
  ['layer-shadow', 'shadow'],
];
for (const [id, key] of LAYER_CHECKBOXES) {
  $(id).checked = renderApi.layers[key];
  $(id).addEventListener('change', (e) => renderApi.setLayers({ [key]: e.target.checked }));
}

// --- overlay panel: the tracing image ---
//
// The image itself lives on the design (overlay.js, save v9) and is drawn by
// render.js. This panel is the five things you can do to it — load one, move
// or measure it, fade it, pin it to a storey, lock it — plus a readout that
// says how big the picture turned out to be, which is the number that tells
// you whether the measurement was right.
//
// Importing resamples. A phone photograph of a sketch is four thousand pixels
// across and eight megabytes, and putting eight megabytes in a design that
// autosaves to localStorage on every edit is how you lose a design. So an
// import is drawn into a canvas at most `MAX_PIXELS` on its long side and
// re-encoded as WebP, which takes a typical plan scan to a few hundred
// kilobytes without visibly touching what you are tracing.

const OVERLAY_MODES = [
  { key: 'move', label: 'Move' },
  { key: 'measure', label: 'Measure' },
];

const overlayModes = $('overlay-modes');
OVERLAY_MODES.forEach((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = m.label;
  b.title = m.key === 'measure'
    ? 'Click the two ends of something you know the length of'
    : 'Drag the image into place';
  b.addEventListener('click', () => {
    editor.setOverlayMode(m.key);
    renderOverlayPanel();
    $('status').textContent = m.key === 'measure'
      ? 'Measure — click one end of something you know the length of, then the other.'
      : HINTS.overlay;
  });
  overlayModes.appendChild(b);
});

function overlayOf() { return state.overlay || null; }

// Read a file, resample it, and hand back a data URL plus the pixel size the
// overlay records. Rejects rather than guesses when the browser can't decode
// what it was given.
function importOverlayImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file.')); return; }
    if (!/^image\//.test(file.type)) {
      reject(new Error('That is not an image. PNG, JPEG, WebP, GIF, AVIF or BMP — not PDF.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const long = Math.max(img.naturalWidth, img.naturalHeight);
      const k = long > MAX_PIXELS ? MAX_PIXELS / long : 1;
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      // WebP first; a browser that doesn't encode it hands back a PNG data
      // URL from the same call, which is still something overlay.js accepts.
      let src = cv.toDataURL('image/webp', 0.82);
      if (!/^data:image\/webp/.test(src)) src = cv.toDataURL('image/png');
      if (src.length > MAX_BYTES) src = cv.toDataURL('image/jpeg', 0.7);
      if (src.length > MAX_BYTES) {
        reject(new Error('That image is too big to keep inside a design, even resampled.'));
        return;
      }
      resolve({ src, w, h, resampled: k < 1 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This browser could not decode that image.'));
    };
    img.src = url;
  });
}

// Where a freshly loaded picture lands: over the middle of what is already
// drawn, or over the middle of the lattice when the design is empty.
function designCentre() {
  const cells = floorCellCount(state.floors[state.currentFloor]);
  if (!cells) return { x0: 0, z0: 0, x1: state.w * CELL, z1: state.h * CELL };
  return { x0: 0, z0: 0, x1: state.w * CELL, z1: state.h * CELL };
}

$('overlay-load').addEventListener('click', () => $('overlay-file').click());

$('overlay-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('status').textContent = 'Reading the image…';
  try {
    const img = await importOverlayImage(file);
    let o = makeOverlay(img.src, img.w, img.h, { floor: ALL_FLOORS });
    if (!o) throw new Error('That image could not be used as an overlay.');
    o = centreOn(o, designCentre());
    editor.pushUndo();
    state.overlay = o;
    applyOverlayChange();
    $('status').textContent = `${file.name} loaded${img.resampled ? ' (resampled)' : ''} — ` +
      'switch to Measure and click the two ends of something you know the length of.';
  } catch (err) {
    $('status').textContent = err.message || 'Could not load that image.';
  }
  renderOverlayPanel();
});

$('overlay-clear').addEventListener('click', () => {
  if (!overlayOf()) return;
  editor.pushUndo();
  delete state.overlay;
  applyOverlayChange();
  $('status').textContent = 'Tracing image removed.';
  renderOverlayPanel();
});

$('overlay-opacity').addEventListener('input', (e) => {
  const o = overlayOf();
  if (!o) return;
  state.overlay = setOverlay(o, { opacity: Number(e.target.value) / 100 });
  renderApi.refreshOverlay(state);
  $('overlay-opacity-value').textContent = `${e.target.value}%`;
});
$('overlay-opacity').addEventListener('change', () => { if (overlayOf()) applyOverlayChange(); });

$('overlay-floor').addEventListener('change', (e) => {
  const o = overlayOf();
  if (!o) return;
  editor.pushUndo();
  const v = e.target.value;
  state.overlay = setOverlay(o, { floor: v === 'all' ? ALL_FLOORS : Number(v) });
  applyOverlayChange();
  renderOverlayPanel();
});

$('overlay-lock').addEventListener('change', (e) => {
  const o = overlayOf();
  if (!o) return;
  state.overlay = setOverlay(o, { locked: e.target.checked });
  applyOverlayChange();
  renderOverlayPanel();
});

// One place to say "the overlay changed": redraw the plane, refresh the tool's
// handles, and autosave — which is the call that can fail on a full
// localStorage, so it is also the one place that says so.
function applyOverlayChange() {
  renderApi.refreshOverlay(state);
  editor.refreshOverlay();
  updateUndoButtons();
  autosave(state, (result) => {
    if (result === 'partial') {
      $('status').textContent = 'Autosaved without the tracing image — it is too big for ' +
        "this browser's storage. Use Save to keep a file with the image in it.";
    } else if (result === 'failed') {
      $('status').textContent = 'Autosave failed — this browser refused to store the design.';
    }
  });
}

function renderOverlayPanel() {
  const o = overlayOf();
  $('overlay-clear').disabled = !o;
  $('overlay-lock').checked = !!(o && o.locked);
  $('overlay-lock').disabled = !o;
  $('overlay-opacity').disabled = !o;
  $('overlay-floor').disabled = !o;
  const pct = Math.round((o ? o.opacity : 0.55) * 100);
  $('overlay-opacity').value = String(pct);
  $('overlay-opacity-value').textContent = `${pct}%`;

  const sel = $('overlay-floor');
  const want = o ? (o.floor === ALL_FLOORS ? 'all' : String(o.floor)) : 'all';
  sel.textContent = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'Every storey';
  sel.appendChild(all);
  state.floors.forEach((_, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = floorLabel(i);
    sel.appendChild(opt);
  });
  sel.value = want;

  for (const b of overlayModes.children) {
    const on = b.textContent === (editor.overlayMode === 'measure' ? 'Measure' : 'Move');
    b.classList.toggle('active', on);
  }

  const lines = [describeOverlay(o)];
  if (o && !showsOn(o, state.currentFloor)) {
    lines.push(`Hidden here — it is pinned to ${floorLabel(o.floor)}.`);
  }
  if (o && !o.cal) {
    lines.push('Measure something on it and the scale follows. Until then the ' +
      'size above is a placeholder, not a reading.');
  }
  $('overlay-readout').textContent = lines.join(' ');
}

// --- the measurement prompt ---
//
// The tool has two points on the picture; this asks what the distance between
// them is and hands the answer to `calibrate`. A dialog rather than an inline
// field because the answer is a number somebody has to go and look up, and
// because the two clicks that produced it are worth confirming — the detail
// line says how far apart they were in pixels, which is how you notice you
// mis-clicked before you scale the whole image by it.
let pendingMeasure = null;

function askMeasurement(a, b) {
  const o = overlayOf();
  if (!o) return;
  pendingMeasure = { a, b };
  const px = Math.hypot(b.u - a.u, b.v - a.v);
  const now = px * o.scale;
  $('measure-detail').textContent =
    `${Math.round(px)} pixels apart, which is ${now.toFixed(1)} ft at the current scale.`;
  const input = $('measure-ft');
  input.value = String(Math.max(0.5, Math.round(now * 2) / 2));
  openModal($('measure-overlay'), input);
  input.select();
}

function closeMeasure() {
  pendingMeasure = null;
  closeModal($('measure-overlay'));
  editor.cancelMeasure();
}

$('measure-cancel').addEventListener('click', closeMeasure);
$('measure-ok').addEventListener('click', () => {
  const o = overlayOf();
  if (!o || !pendingMeasure) { closeMeasure(); return; }
  const ft = Number($('measure-ft').value);
  const r = calibrate(o, pendingMeasure.a, pendingMeasure.b, ft);
  if (!r.ok) {
    $('measure-detail').textContent = r.reason;
    return;
  }
  editor.pushUndo();
  state.overlay = r.overlay;
  applyOverlayChange();
  closeMeasure();
  renderOverlayPanel();
  $('status').textContent = `Scaled — the image is now ${Math.round(r.size.w).toLocaleString()} × ` +
    `${Math.round(r.size.d).toLocaleString()} ft.` + (r.reason ? ` ${r.reason}` : '');
});
$('measure-ft').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('measure-ok').click(); }
});

// --- site panel: the ground, what's laid on it, and what caps the building ---
//
// Three groups of controls that all mean "the outside": the region tool's
// surface and marking, the grading brush, and the roof and facade. They share
// a panel because they share a mental mode — you are looking at the building
// from outside it — and because none of them is big enough to earn its own.
//
// The surface and marking pickers do double duty, the way the room panel's do:
// they set what the *next* region will be, and they restyle the selected one.

const siteSurfaceSel = $('site-surface');
SITE_SURFACES.forEach((row) => {
  const o = document.createElement('option');
  o.value = row.key;
  o.textContent = row.label;
  siteSurfaceSel.appendChild(o);
});

const siteMarkingSel = $('site-marking');
{
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'None';
  siteMarkingSel.appendChild(none);
  for (const m of SITE_MARKINGS) {
    const o = document.createElement('option');
    o.value = m.key;
    o.textContent = m.label;
    siteMarkingSel.appendChild(o);
  }
}

const SITE_MODES = [
  { mode: 'region', label: 'Region', title: 'Draw a paved, planted or playing surface' },
  { mode: 'grade', label: 'Grade', title: 'Raise, lower and smooth the ground' },
];
const siteModes = $('site-modes');
SITE_MODES.forEach((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.mode = m.mode;
  b.textContent = m.label;
  b.title = m.title;
  b.addEventListener('click', () => {
    editor.setSiteMode(m.mode);
    renderSitePanel();
    $('status').textContent = HINTS.site;
  });
  siteModes.appendChild(b);
});

const siteRoofSel = $('site-roof');
ROOF_STYLES.forEach((r) => {
  const o = document.createElement('option');
  o.value = r.key;
  o.textContent = r.label;
  siteRoofSel.appendChild(o);
});

const siteFacadeSel = $('site-facade');
FACADE_MATERIALS.forEach((f) => {
  const o = document.createElement('option');
  o.value = f.key;
  o.textContent = f.label;
  siteFacadeSel.appendChild(o);
});

function siteStyleChanged() {
  // `setSiteStyle` restyles the selected region if there is one, and reports
  // whether it actually changed anything — so a picker that only sets the next
  // region's surface doesn't push an undo entry.
  if (editor.setSiteStyle(siteSurfaceSel.value, siteMarkingSel.value || null)) {
    $('status').textContent = 'Region restyled.';
  }
  renderSiteReadout();
}

siteSurfaceSel.addEventListener('change', () => {
  // Picking a marking implies a surface, so choosing one the other way round
  // shouldn't silently keep a court's paint on a lawn.
  const m = markingEntry(siteMarkingSel.value);
  if (m && m.surf !== siteSurfaceSel.value) siteMarkingSel.value = '';
  siteStyleChanged();
});
siteMarkingSel.addEventListener('change', () => {
  const m = markingEntry(siteMarkingSel.value);
  if (m) siteSurfaceSel.value = m.surf;
  siteStyleChanged();
});

$('site-brush').addEventListener('input', (e) => {
  editor.setSiteBrush(e.target.value);
  $('site-brush-value').textContent = `${editor.siteBrush} ft`;
});

// A roof change is a change to the design but not an undoable edit, the same
// call the sky panel makes — nobody wants Ctrl+Z to walk back through the
// eleven pitches a slider passed through.
function roofChanged() {
  state.roof = normalizeRoof(state.roof);
  rebuild();
  autosave(state);
  renderSitePanel();
}

siteRoofSel.addEventListener('change', (e) => {
  ensureRoof(state).style = e.target.value;
  roofChanged();
});
$('site-pitch').addEventListener('input', (e) => {
  ensureRoof(state).pitch = Number(e.target.value);
  roofChanged();
});
siteFacadeSel.addEventListener('change', (e) => {
  ensureRoof(state).facade = e.target.value;
  roofChanged();
});

// What the site currently is, in the two numbers a civil drawing would lead
// with: how much of it is paved, and how much it falls across.
function renderSiteReadout() {
  const el = $('site-readout');
  if (!el) return;
  const rows = siteSchedule(state);
  const relief = terrainRange(terrainField(state)).relief;
  const total = rows.reduce((n, r) => n + r.sqft, 0);
  const paved = rows
    .filter((r) => ['asphalt', 'concrete', 'court', 'track'].includes(r.key))
    .reduce((n, r) => n + r.sqft, 0);
  const sel = editor.siteSelection;
  const lines = [];
  if (sel) {
    const entry = surfaceEntry(sel.surf);
    const m = sel.mark ? markingEntry(sel.mark) : null;
    lines.push(`<b>${sel.name || entry.label}</b> — ${Math.round(regionArea(sel)).toLocaleString()} ft²` +
      (m ? ` · ${m.label}` : ''));
  }
  lines.push(rows.length
    ? `${editor.siteRegionCount} regions · ${Math.round(total).toLocaleString()} ft² ` +
      `(${Math.round(paved).toLocaleString()} paved)`
    : 'No site regions yet.');
  lines.push(relief > 0.05
    ? `Relief ${relief.toFixed(1)} ft across the site.`
    : 'Level site — nothing graded yet.');
  const plan = roofPlan(state);
  lines.push(`Roof: ${plan.style}${isPitched(plan.style) ? ` ${plan.pitch}:12` : ''} · ` +
    `${plan.blocks.length || plan.outlines.length} mass${(plan.blocks.length || plan.outlines.length) === 1 ? '' : 'es'}.`);
  el.innerHTML = lines.join('<br />');
}

function renderSitePanel() {
  const mode = editor.siteMode;
  siteModes.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('site-region-opts').classList.toggle('hidden', mode !== 'region');
  $('site-grade-opts').classList.toggle('hidden', mode !== 'grade');
  siteSurfaceSel.value = editor.siteSurface;
  siteMarkingSel.value = editor.siteMarking || '';
  $('site-brush').value = String(editor.siteBrush);
  $('site-brush-value').textContent = `${editor.siteBrush} ft`;
  const roof = normalizeRoof(state.roof);
  siteRoofSel.value = roof.style;
  siteFacadeSel.value = roof.facade;
  $('site-pitch').value = String(roof.pitch);
  $('site-pitch-value').textContent = `${roof.pitch}:12`;
  // Pitch is meaningless on a flat roof, so it isn't offered on one.
  const pitched = isPitched(roof.style);
  $('site-pitch').disabled = !pitched;
  $('site-pitch-label').style.opacity = pitched ? '' : '0.45';
  renderSiteReadout();
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
  adoptedByLife();
  reportInvalidate();
}

// A different design is a different building, and the crowd in it was walking
// around the old one — its graph, its colliders and its timetables all name
// rooms that may not exist any more. So a new state restarts the school rather
// than trying to carry it over: same size, same seed, new building.
function adoptedByLife() {
  if (life.on) lifeStart();
  else if (!lifePanel.classList.contains('hidden')) renderLifePanel();
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


// --- school life ---
//
// Phase 6. The building gets people in it, and a clock that tells them where
// to be. Everything about *what* they do lives in agents.js, navgraph.js and
// schedule.js — this is the part that can't: a rebuild trigger, a frame loop,
// a panel, and the two places the crowd touches something that already
// existed (the camera walks around it; the bells it rings are the ones the
// sound panel already knows how to play).
//
// The one structural thing worth saying: **the crowd's colliders have the same
// lifetime as the crowd, not as a walkthrough.** collide.js builds a storey
// once because editing and walking were exclusive; a school with people in it
// is being edited *while* they walk, so an edit invalidates them and the next
// frame builds what it needs again. That is the whole of the "collides with
// the collider's build-once lifecycle" the wishlist warned about, and it costs
// one `null` and a lazy rebuild.
const life = {
  on: false,
  agents: [],
  nav: null,
  ctx: null,
  colliders: new Map(),
  site: null,
  crowd: makeCrowdField(),
  rate: 1,           // simulated minutes per real second, 0 = the clock is held
  drill: false,
  drillAt: 0,
  heat: false,
  followIdx: -1,
  seed: 1,
  students: 90,
  heatAt: 0,
  clockAcc: 0,
};

const lifePanel = $('life-panel');

function lifeSettings() {
  const l = normalizeLife(state.life);
  return l;
}

// Everything derived from the design: the graph, the ground and the colliders.
// Torn down on any edit and rebuilt on the next frame that needs it — the
// crowd itself survives, because a wall moving is not a reason for the school
// to go home.
function lifeRebuildWorld() {
  life.nav = buildNav(state);
  life.site = terrainField(state);
  life.colliders = new Map();
  if (life.ctx) {
    life.ctx.nav = life.nav;
    life.ctx.site = life.site;
    life.ctx.egress = null;
    life.ctx.seats = new Map();
    life.ctx.taken = new Set();
  }
}

function lifeColliderFor(i) {
  let c = life.colliders.get(i);
  if (!c) {
    c = buildCollider(state, i, catalogEntry, { site: life.site });
    life.colliders.set(i, c);
  }
  return c;
}

function lifeStart() {
  const settings = lifeSettings();
  life.seed = settings.seed;
  life.students = settings.students;
  lifeRebuildWorld();
  life.crowd = makeCrowdField();
  life.ctx = makeContext(state, life.nav, {
    site: life.site,
    schedule: settings.schedule,
    colliderFor: lifeColliderFor,
    catalogGet: catalogEntry,
    crowd: life.crowd,
    minutes: state.env.minutes,
  });
  life.agents = makePopulation(state, life.nav, {
    seed: life.seed, students: life.students, schedule: life.ctx.schedule,
  });
  life.drill = false;
  life.drillAt = 0;
  life.followIdx = -1;
  life.on = life.agents.length > 0;
  retargetAll(life.ctx, life.agents);
  walk.setBodies((floorIndex) => (life.on ? bodiesOn(life.agents, floorIndex) : null));
  // One collider per storey for the whole building, shared by the crowd and
  // the camera — see walkthrough.js's `setColliders`. It also means an edit
  // that invalidates the crowd's world invalidates the walker's, which is the
  // first time in this codebase that has been true.
  walk.setColliders(lifeColliderFor);
  walk.setFollow(null);
  renderLifePanel();
  return life.on;
}

function lifeStop() {
  life.on = false;
  life.agents = [];
  life.drill = false;
  life.followIdx = -1;
  walk.setBodies(null);
  walk.setColliders(null);
  walk.setFollow(null);
  renderApi.clearCrowd();
  renderApi.setHeat(null);
  renderLifePanel();
}

// The clock. `life.rate` is simulated minutes per real second — the *clock*
// runs fast, never the people: a corridor at ten times speed is a blur nobody
// can read, and the thing worth watching is a passing period at the pace a
// passing period actually happens.
function lifeAdvanceClock(dt) {
  if (!life.rate) return;
  life.clockAcc += dt * life.rate;
  // Whole minutes only. `env.minutes` is an integer — the sun is placed from
  // it, and the sky panel redraws whenever it moves — so a clock that
  // "advances" by four hundredths of a minute every frame would rebuild the
  // environment sixty times a second to show the same time.
  if (life.clockAcc < 1) return;
  const step = Math.floor(life.clockAcc);
  life.clockAcc -= step;
  const before = state.env.minutes;
  const next = wrapMinutes(before + step);
  // The bells crossed on the way — rung once each, and only when there is an
  // ear in the building to hear them.
  for (const bell of bellsBetween(life.ctx.schedule, before, next)) {
    if (audio.running) audio.ring();
    lifeFlashBell(bell);
  }
  const blockBefore = blockAt(life.ctx.schedule, before);
  state.env.minutes = next;
  life.ctx.minutes = next;
  envChanged();
  // A new block is a new set of instructions for everybody. Re-derived at the
  // moment the clock crosses it rather than per frame, because a route is a
  // search and the answer only changes when the timetable does.
  if (blockAt(life.ctx.schedule, next).label !== blockBefore.label && !life.drill) {
    retargetAll(life.ctx, life.agents);
  }
}

let bellFlash = 0;
function lifeFlashBell(bell) {
  bellFlash = 2.5;
  $('life-block').innerHTML = `<span class="bell">🔔 ${bell.label}</span>`;
}

// One frame of school. Called from the main loop in both modes — a crowd is
// worth watching from above as well as from inside it.
function lifeUpdate(dt) {
  if (!life.on || !life.ctx) return;
  if (!life.nav) lifeRebuildWorld();
  lifeAdvanceClock(dt);
  // The camera is a body like any other, and the storey it is on already has
  // its doors driven by walkthrough.js — so the crowd is told to leave that
  // one alone rather than swinging the same leaves twice a frame.
  const opts = {};
  if (mode === 'walk') {
    const eye = renderApi.walkCamera.position;
    const floorIndex = storeyAt(state, eye.y - EYE_H, groundAt(life.site, eye.x, eye.z));
    opts.bodies = [{ id: 'camera', x: eye.x, z: eye.z, r: WALKER_R, push: 1 }];
    opts.skipFloors = new Set([floorIndex]);
  }
  stepAgents(life.ctx, life.agents, Math.min(dt, 0.05), opts);
  // Doors the crowd moved on storeys the camera isn't on.
  for (const collider of life.ctx.doorsMoved || []) renderApi.poseDoors(collider.doors);

  renderApi.setCrowd(life.agents, {
    // While editing, people below the storey you are working on would be
    // walking through the slab you are drawing on. Same rule the props follow.
    hideAbove: mode === 'edit' ? state.currentFloor : undefined,
    recolor: true,
  });
  lifeFollowTick();
  lifeHeatTick(dt);
  if (bellFlash > 0) bellFlash -= dt;
  lifeReadoutTick(dt);
}

let readoutAcc = 0;
function lifeReadoutTick(dt) {
  readoutAcc += dt;
  if (readoutAcc < 0.4 || lifePanel.classList.contains('hidden')) return;
  readoutAcc = 0;
  renderLifeClock();
  renderLifeReadout();
}

function lifeHeatTick(dt) {
  if (!life.heat) return;
  life.heatAt -= dt;
  if (life.heatAt > 0) return;
  life.heatAt = 0.75;
  const floorIndex = mode === 'edit'
    ? state.currentFloor
    : storeyAt(state, renderApi.walkCamera.position.y - EYE_H);
  renderApi.setHeat(crowdCells(life.crowd, floorIndex), {
    cell: life.crowd.cell,
    baseY: floorBaseY(state, floorIndex),
  });
}

// --- following somebody ---

const FOLLOW_MODES = ['ots', 'fps'];

// Nobody → over the shoulder → first person → nobody. Three states on one
// button, because "whose eyes" is one question with three answers rather than
// two settings.
function lifeFollow() {
  if (!life.on || mode !== 'walk') return;
  const inside = life.agents.filter((a) => a.state !== 'out');
  if (!inside.length) return;
  const current = walk.following;
  if (!current) {
    // Somebody who is actually going somewhere, if anyone is — following a
    // person who is sitting in a chair for forty-seven minutes is a lesson,
    // not a walkthrough.
    const moving = inside.filter((a) => a.state === 'walk');
    const pool = moving.length ? moving : inside;
    walk.setFollow(pool[Math.floor(Math.random() * pool.length)], 'ots');
  } else if (walk.followMode === 'ots') {
    walk.setFollow(current, 'fps');
  } else {
    walk.setFollow(null);
  }
  renderFollowButton();
}

function renderFollowButton() {
  const btn = $('life-follow');
  const who = walk.following;
  btn.setAttribute('aria-pressed', String(!!who));
  btn.classList.toggle('on', !!who);
  btn.textContent = who
    ? (walk.followMode === 'fps' ? '👁 First person' : '👤 Over the shoulder')
    : '👤 Follow a student';
  renderLifeReadout();
}

// The person you are following can walk out of the building, and then you are
// standing in a car park watching a bus loop. Hand the camera back instead.
function lifeFollowTick() {
  const who = walk.following;
  if (!who) return;
  if (who.state === 'out' || mode !== 'walk') {
    walk.setFollow(null);
    renderFollowButton();
  }
}

// --- the drill ---

function lifeSetDrill(on) {
  if (!life.on) return;
  life.drill = !!on;
  life.ctx.mode = on ? 'drill' : 'day';
  life.ctx.egress = null;
  life.ctx.elapsed = 0;
  life.drillAt = 0;
  if (on) {
    clearCrowd(life.crowd);
    for (const a of life.agents) { a.state = a.state === 'out' ? 'walk' : a.state; a.outAt = null; }
    if (audio.running) audio.announce();
  }
  retargetAll(life.ctx, life.agents);
  $('life-drill').classList.toggle('on', life.drill);
  $('life-drill').setAttribute('aria-pressed', String(life.drill));
  renderLifePanel();
}

// --- the panel ---

const LIFE_RATES = [
  { key: 0, label: 'Hold' },
  { key: 0.25, label: 'Slow' },
  { key: 1, label: '1×' },
  { key: 4, label: 'Fast' },
];

function renderLifeRates() {
  const host = $('life-rate');
  host.innerHTML = '';
  for (const r of LIFE_RATES) {
    const b = document.createElement('button');
    b.textContent = r.label;
    b.className = life.rate === r.key ? 'active' : '';
    b.setAttribute('aria-pressed', String(life.rate === r.key));
    b.title = r.key === 0 ? 'Stop the clock — the people keep moving'
      : `${r.key} school minute${r.key === 1 ? '' : 's'} per second`;
    b.addEventListener('click', () => { life.rate = r.key; renderLifeRates(); });
    host.appendChild(b);
  }
}

function renderLifeClock() {
  $('life-time').textContent = clockText(state.env.minutes);
  if (bellFlash > 0) return;
  const sched = life.ctx ? life.ctx.schedule : normalizeSchedule(lifeSettings().schedule);
  const b = blockAt(sched, state.env.minutes);
  const next = nextBell(sched, state.env.minutes);
  $('life-block').innerHTML = life.drill
    ? '<span class="bell">🚨 Evacuating</span>'
    : `${b.label}<br />next bell in ${next ? countdownText(next.in) : '—'}`;
}

function renderLifeReadout() {
  const el = $('life-readout');
  if (!life.on) {
    const nav = life.nav || buildNav(state);
    const sum = navSummary(nav);
    el.innerHTML = `<b>${sum.rooms}</b> rooms · <b>${sum.doors}</b> doors · ` +
      `<b>${sum.links}</b> stairs &amp; lifts<br />` +
      (sum.exits
        ? `<b>${sum.exits}</b> way${sum.exits === 1 ? '' : 's'} out. Populate to fill it.`
        : '<span class="warn">No exterior doors</span> — nobody could get out.');
    return;
  }
  const c = census(life.agents);
  const lines = [
    `<b>${c.total}</b> people — ${c.teachers} staff · <b>${c.walking}</b> walking · ` +
    `<b>${c.seated}</b> seated · ${c.idle} standing`,
  ];
  if (life.drill) {
    const r = drillReport(life.agents, life.ctx.elapsed);
    lines.push(`<b>${r.out}/${r.total}</b> out in <b>${Math.round(r.elapsed)}s</b>` +
      (r.longest ? ` · last out at ${Math.round(r.longest)}s` : ''));
    if (r.stranded) lines.push(`<span class="warn">${r.stranded} with no way out</span>`);
    if (r.done) lines.push('Building clear.');
  } else if (c.out) {
    lines.push(`${c.out} have left the building`);
  }
  if (walk.following) lines.push(`Following <b>${walk.following.name}</b>`);
  el.innerHTML = lines.join('<br />');
}

function renderLifePanel() {
  $('life-students-value').textContent = String(life.students);
  $('life-students').value = String(life.students);
  $('life-toggle').textContent = life.on ? '✖ Clear' : '👥 Populate';
  $('life-toggle').classList.toggle('on', life.on);
  $('life-drill').disabled = !life.on;
  $('life-follow').disabled = !life.on || mode !== 'walk';
  renderLifeRates();
  renderLifeClock();
  renderLifeReadout();
}

$('life-btn').addEventListener('click', () => {
  const hidden = lifePanel.classList.toggle('hidden');
  $('life-btn').classList.toggle('off', hidden);
  $('life-btn').setAttribute('aria-pressed', String(!hidden));
  if (!hidden) renderLifePanel();
});

$('life-toggle').addEventListener('click', () => {
  if (life.on) lifeStop();
  else if (!lifeStart()) renderLifeReadout();
});

$('life-reseed').addEventListener('click', () => {
  state.life = { ...lifeSettings(), seed: Math.floor(Math.random() * 0x7ffffffe) + 1 };
  autosave(state);
  if (life.on) lifeStart(); else renderLifePanel();
});

$('life-students').addEventListener('input', (e) => {
  const n = Number(e.target.value);
  life.students = n;
  $('life-students-value').textContent = String(n);
});
$('life-students').addEventListener('change', () => {
  state.life = { ...lifeSettings(), students: life.students };
  autosave(state);
  if (life.on) lifeStart();
});

$('life-drill').addEventListener('click', () => lifeSetDrill(!life.drill));

$('life-heat').addEventListener('click', () => {
  life.heat = !life.heat;
  life.heatAt = 0;
  $('life-heat').classList.toggle('on', life.heat);
  $('life-heat').setAttribute('aria-pressed', String(life.heat));
  if (!life.heat) renderApi.setHeat(null);
});

$('life-follow').addEventListener('click', () => lifeFollow());

// --- the report ---
//
// Phase 7. Everything above this line draws a building; this asks whether the
// building works. The arithmetic all lives in the pure modules (occupancy,
// egress, daylight, takeoff, and report.js composing them), so what is left
// here is the same four things every panel in this file is: a staleness rule,
// a renderer, a download, and a key.
//
// **The staleness rule is the interesting one.** A report is the most derived
// thing in the codebase — a graph, an occupant load per room, a multi-source
// Dijkstra, a reverberation estimate per room and a takeoff over every wall —
// and it is wrong the instant a wall moves. Rebuilding it on every frame of a
// drag would be absurd; leaving a stale number on screen would be worse than
// showing nothing. So an edit marks it stale, the badge says so, and the
// rebuild happens a beat after the drawing hand stops.
const reportPanel = $('report-panel');
const report = {
  data: null,
  stale: true,
  sprinklered: true,
  timer: 0,
};

const REPORT_DEBOUNCE = 500;   // ms after the last edit

// Room names come from a text field, and this panel prints them into markup.
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function reportInvalidate() {
  report.stale = true;
  if (reportPanel.classList.contains('hidden')) return;
  renderReportStale();
  clearTimeout(report.timer);
  report.timer = setTimeout(() => reportBuild(), REPORT_DEBOUNCE);
}

function reportBuild() {
  clearTimeout(report.timer);
  report.data = buildReport(state, { sprinklered: report.sprinklered });
  report.stale = false;
  renderReportPanel();
}

function renderReportStale() {
  $('report-stale').classList.toggle('hidden', !report.stale);
}

const VERDICTS = {
  fail: { mark: '✕', line: (r) => `${plural(r.summary.fails, 'thing')} to fix before this is a school.` },
  warn: { mark: '!', line: (r) => `Nothing failing, ${plural(r.summary.warns, 'thing')} worth a look.` },
  ok: { mark: '✓', line: () => 'Passes every check this tool knows how to make.' },
};

function findingHTML(f, i) {
  return `<div class="finding ${f.level}" data-finding="${i}">` +
    `<button type="button" aria-expanded="false">` +
    `<b>${esc(f.title)}</b><span class="why">${esc(f.detail)}</span>` +
    `</button></div>`;
}

// The sections under the findings: the numbers themselves, in the order a
// person reads a building — how many people, how they get out, who can get
// in, what it is like inside, and what it is made of.
function reportSections(r) {
  const out = [];
  const sec = (key, lines) => out.push(
    `<div class="sec"><div class="k">${key}</div>${lines.join('')}</div>`);
  const row = (a, b) => `<div class="row"><span>${a}</span><span>${b}</span></div>`;

  const uses = r.occupancy.byUse.filter((u) => u.occ > 0).slice(0, 4);
  sec('Occupancy', [
    row(`<b>${r.summary.occupants}</b> occupants`, `${ft(r.summary.area)} ft²`),
    ...uses.map((u) => row(esc(u.label), `<b>${u.occ}</b>`)),
  ]);

  const e = r.egress.summary;
  const worst = e.worst;
  sec('Egress', [
    row(`${plural(e.exits, 'exit')} · carries <b>${e.capacity}</b>`,
      e.capacity >= e.occupants ? 'enough' : '<span class="warn">short</span>'),
    worst
      ? row('Longest walk out', `<b>${ft(worst.travel)} ft</b> / ${r.egress.limits.travel}`)
      : row('Longest walk out', '—'),
    r.egress.deadEnds.length
      ? row('Deepest dead end', `<b>${ft(r.egress.deadEnds[0].depth)} ft</b> / ${r.egress.limits.deadEnd}`)
      : row('Dead ends', 'none'),
  ]);

  const a = r.accessible.summary;
  sec('Accessible route', [
    row(`${plural(a.entrances, 'entrance')} · ${plural(a.lifts, 'lift')}`,
      `${a.ramps ? plural(a.ramps, 'ramp') : 'no ramps'}`),
    row('Reachable on wheels', a.unreachable
      ? `<b>${a.reachable}</b> of ${a.reachable + a.unreachable}`
      : 'every room'),
  ]);

  const d = r.daylight.summary;
  sec('Daylight & sound', [
    row('Glazing, whole building', `<b>${(d.ratio * 100).toFixed(1)}%</b> of floor`),
    row(`${plural(d.rooms, 'room')} held to 8%`, d.dark
      ? `<span class="warn">${d.dark} under</span>` : 'all over'),
    row('Rooms over the ANSI reverb limit',
      r.acoustics.summary.over ? `<b>${r.acoustics.summary.over}</b>` : 'none'),
  ]);

  if (r.structure && r.summary.storeys > 1) {
    const st = r.structure;
    sec('Structure', [
      row('Upper storeys checked', plural(st.floors.length, 'storey')),
      row('Standing on nothing', st.area
        ? `<span class="warn">${ft(st.area)} ft²</span>`
        : 'none'),
    ]);
  }

  if (r.takeoff) {
    const t = r.takeoff.totals;
    sec('Materials', [
      row('Walls', `<b>${ft(t.wallLf)} lf</b> (${ft(t.exteriorLf)} ext)`),
      row('Glazing', `${ft(t.glazing)} ft² · ${t.bays} bays`),
      row('Doors &amp; windows', `${t.doors} · ${t.windows}`),
      row('Furniture', `${t.props} pieces`),
      row('Roof / site', `${ft(t.roof)} · ${ft(t.site)} ft²`),
    ]);
  }
  return out.join('');
}

function renderReportPanel() {
  renderReportStale();
  const r = report.data;
  const verdictEl = $('report-verdict');
  if (!r) {
    verdictEl.className = '';
    verdictEl.innerHTML = '<span class="mark">•</span><span class="line">Reading the model…</span>';
    $('report-findings').innerHTML = '';
    $('report-readout').innerHTML = '';
    return;
  }
  const v = VERDICTS[r.summary.verdict];
  verdictEl.className = r.summary.verdict;
  verdictEl.innerHTML = `<span class="mark">${v.mark}</span><span class="line">${v.line(r)}</span>`;
  $('report-findings').innerHTML = r.findings.map(findingHTML).join('');
  $('report-readout').innerHTML = reportSections(r);
}

// A finding is a headline until you ask it why.
$('report-findings').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const host = btn && btn.closest('.finding');
  if (!host) return;
  const open = host.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(open));
});

$('report-btn').addEventListener('click', () => {
  const hidden = reportPanel.classList.toggle('hidden');
  $('report-btn').classList.toggle('off', hidden);
  $('report-btn').setAttribute('aria-pressed', String(!hidden));
  if (hidden) { clearTimeout(report.timer); return; }
  if (report.stale || !report.data) reportBuild();
  else renderReportPanel();
  // The rail is a scrolling column and this is the tallest thing in it: with
  // the sky panel open above, a report opened at the bottom of the rail opens
  // off the bottom of the screen.
  reportPanel.scrollIntoView({ block: 'nearest' });
});

$('report-refresh').addEventListener('click', () => reportBuild());

$('report-sprinklered').addEventListener('change', (e) => {
  report.sprinklered = e.target.checked;
  reportBuild();
});

$('report-csv').addEventListener('click', () => {
  if (report.stale || !report.data) reportBuild();
  const blob = new Blob([reportCSV(report.data)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'school-analysis.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// --- the generator ---
//
// Phase 8's front door. Everything it does is in program.js, brief.js and
// generate.js; this is the sheet that collects five numbers, prints the
// schedule of accommodation those numbers imply, and then replaces the design.
//
// Two things about it are deliberate. The schedule is shown *before* you press
// Generate, because a list of rooms is checkable and a building is not; and the
// sentence box is labelled as a phrase table rather than as an assistant,
// because it is one. What it understood and what it ignored are both printed.

const genOverlay = $('gen-overlay');
const genBand = $('gen-band');
BANDS.forEach((b) => {
  const opt = document.createElement('option');
  opt.value = b.key;
  opt.textContent = b.label;
  genBand.appendChild(opt);
});

const GEN_FIELDS = {
  students: 'gen-students', storeys: 'gen-storeys', seed: 'gen-seed',
};
const GEN_FLAGS = {
  gym: 'gen-gym', cafeteria: 'gen-cafeteria', library: 'gen-library', site: 'gen-site',
};

// The brief the sheet is currently showing, kept normalized so the schedule
// below it is always the schedule of what the controls say.
let genBrief = { ...DEFAULT_BRIEF };

function readGenFields() {
  const raw = { band: genBand.value };
  for (const [key, id] of Object.entries(GEN_FIELDS)) raw[key] = Number($(id).value);
  for (const [key, id] of Object.entries(GEN_FLAGS)) raw[key] = $(id).checked;
  return normalizeBrief(raw);
}

function writeGenFields(brief) {
  genBand.value = brief.band;
  for (const [key, id] of Object.entries(GEN_FIELDS)) $(id).value = String(brief[key]);
  for (const [key, id] of Object.entries(GEN_FLAGS)) $(id).checked = brief[key];
}

function renderGenSchedule() {
  const program = buildProgram(genBrief);
  const lines = programLines(program);
  const rows = lines.map((l) =>
    `<div class="row-line" title="${esc(l.rule)}"><span>${esc(l.label)}</span>` +
    `<span>${esc(l.size)} · ${Math.round(l.area).toLocaleString()} ft²</span></div>`).join('');
  const totals =
    `<div class="totals"><div class="row-line"><span>${program.stations} teaching stations</span>` +
    `<span>${program.roomCount} rooms</span></div>` +
    `<div class="row-line"><span>${Math.round(program.netArea).toLocaleString()} ft² of rooms</span>` +
    `<span>~${Math.round(program.grossArea).toLocaleString()} ft² gross</span></div>` +
    `<div class="row-line"><span>${program.staff} staff</span>` +
    `<span>${program.parking} parking spaces</span></div></div>`;
  $('gen-schedule').innerHTML = rows + totals +
    `<p class="hint">${esc(program.caveat)}</p>`;
}

function genChanged() {
  genBrief = readGenFields();
  renderGenSchedule();
}

for (const id of [...Object.values(GEN_FIELDS), ...Object.values(GEN_FLAGS), 'gen-band']) {
  $(id).addEventListener('change', genChanged);
  $(id).addEventListener('input', genChanged);
}

$('gen-read').addEventListener('click', () => {
  const r = parseBrief($('gen-brief').value, readGenFields());
  genBrief = r.brief;
  writeGenFields(genBrief);
  renderGenSchedule();
  const read = `<span class="read">Read: ${esc(r.echo)}.</span>`;
  const ignored = r.ignored.length
    ? ` <span class="ignored">Ignored: ${esc(r.ignored.join(', '))}.</span>`
    : ' <span class="read">Nothing was ignored.</span>';
  $('gen-echo').innerHTML = read + ignored;
});

$('gen-btn').addEventListener('click', openGenerator);

function openGenerator() {
  if (mode === 'walk') setMode('edit');
  writeGenFields(genBrief);
  renderGenSchedule();
  openModal(genOverlay, $('gen-brief'));
}

$('gen-cancel').addEventListener('click', () => closeModal(genOverlay));
genOverlay.addEventListener('click', (e) => { if (e.target === genOverlay) closeModal(genOverlay); });

$('gen-go').addEventListener('click', () => {
  genBrief = readGenFields();
  const furnish = $('gen-furnish').checked;
  $('gen-go').disabled = true;
  $('status').textContent = 'Generating…';
  // One frame, so the status line paints before a second of arithmetic.
  requestAnimationFrame(() => {
    try {
      const plan = layoutSchool(genBrief);
      const next = buildSchool(plan, { furnish });
      adoptState(next);
      const sum = generationSummary(plan, next);
      const bits = [
        `${sum.students} students`,
        `${sum.rooms} rooms on ${sum.storeys} storey${sum.storeys === 1 ? '' : 's'}`,
        `${sum.wings} wing${sum.wings === 1 ? '' : 's'}`,
        `${sum.footprintFt.w}×${sum.footprintFt.d} ft`,
        `${sum.exits} ways out`,
        `${sum.props.toLocaleString()} pieces of furniture`,
      ];
      let text = `Generated — ${bits.join(', ')}.`;
      if (plan.oversize) {
        text += ` ${plan.unplaced.length} room${plan.unplaced.length === 1 ? '' : 's'} ` +
          "didn't fit on the grid: this brief wants more building than the 800ft lattice holds.";
      }
      text += ' Open the Report to see what it got wrong.';
      $('status').textContent = text;
      closeModal(genOverlay);
    } catch (err) {
      $('status').textContent = `Could not generate that: ${err.message}`;
    } finally {
      $('gen-go').disabled = false;
    }
  });
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
  // The measure prompt goes first: it is the one dialog that can be open on
  // top of another, and Escape there means "I mis-clicked", not "close the
  // generator".
  if (e.code === 'Escape' && !$('measure-overlay').classList.contains('hidden')) {
    closeMeasure(); return;
  }
  if (e.code === 'Escape' && !genOverlay.classList.contains('hidden')) {
    closeModal(genOverlay); return;
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
  // The crowd's four, in both modes: the panel, the drill, the heatmap, and
  // whose shoulder you are looking over.
  if (e.code === 'KeyL' && !typing && !e.ctrlKey && !e.metaKey) { $('life-btn').click(); return; }
  // The report is the sixth panel and the last free letter next to them: M for
  // the measurements, in both modes, because a finding you read while walking
  // is a finding about the corridor you are standing in.
  if (e.code === 'KeyM' && !typing && !e.ctrlKey && !e.metaKey) { $('report-btn').click(); return; }
  if (e.code === 'KeyK' && !typing && !e.ctrlKey && !e.metaKey) { lifeSetDrill(!life.drill); return; }
  if (e.code === 'KeyH' && !typing && !e.ctrlKey && !e.metaKey) { $('life-heat').click(); return; }
  if (e.code === 'KeyV' && !typing && !e.ctrlKey && !e.metaKey && mode === 'walk') {
    lifeFollow();
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
    afterEdit();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
    e.preventDefault();
    editor.redo(); afterEdit();
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
  // The school runs in both modes. A crowd seen from 200ft up, moving between
  // periods over a plan you are drawing, is half of what this phase is for —
  // and the other half is meeting one of them in a corridor.
  lifeUpdate(dt);
  renderApi.render(dt);
}

selectTool('floor');
renderFloorList();
renderStairReadout();
renderEnvPanel();
renderSitePanel();
renderAudioPanel();
renderLifePanel();
audio.setWorld(state);
updateUndoButtons();
loop();

// debug/test hook
window.app = {
  get state() { return state; },
  setMode, renderApi, editor, walk,
  setPhotoMode, envChanged, audio,
  life, lifeStart, lifeStop, lifeSetDrill, lifeFollow,
  report, reportBuild,
};
