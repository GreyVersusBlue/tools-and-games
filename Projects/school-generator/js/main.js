// main.js — bootstrap and UI wiring.

import * as THREE from 'three';
import {
  createState, ROOM_COLORS, MAX_FLOORS, CELL, EYE_H, floorBaseY,
  floorLabel, floorShapeCount,
  addFloor, duplicateFloor, removeFloor, setCurrentFloor,
} from './grid.js';
import { totalShapeArea } from './shapes.js';
import { buildSampleSchool } from './sample.js';
import { catalogByCategory, catalogEntry, PROP_PAINTS } from './catalog.js';
import { DECOR_PACKS, packByKey, packPaint, packTypes } from './decor.js';
import { MAX_SHOVE } from './shove.js';
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
  startHunt, huntWarmth, checkFind, huntSummary, DEFAULT_COUNT,
} from './hunt.js';
import {
  blockAt, bellsBetween, nextBell, clockText, countdownText, wrapMinutes,
  normalizeSchedule,
} from './schedule.js';
import {
  makePopulation, makeContext, retargetAll, stepAgents, census, drillReport,
  bodiesOn, makeCrowdField, crowdCells, clearCrowd, normalizeLife,
} from './agents.js';
import { buildCollider, storeyAt, resolvePoint, WALKER_R } from './collide.js';
import { initAudio } from './audio.js';
import { doorEvents } from './sound.js';
import { roomsOnFloor, isOutside } from './acoustics.js';
import {
  downloadSave, loadFromFile, autosave, autosaveNow, loadAutosave, clearAutosave,
  listDesigns, saveDesign, loadDesign, deleteDesign, renameDesign,
  serialize, deserialize,
} from './save-load.js';
import {
  renderFloorPlanCanvas, renderSitePlanCanvas, downloadCanvasPNG,
  computeFloorPlan, drawPlanBody,
} from './blueprint.js';
import { buildReport, reportCSV } from './report.js';
import { codeOf, normalizeCode, isDefaultCode, USES } from './occupancy.js';
import { isTouchCapable, joystickAxes } from './touch.js';
// --- Phase 8 ---
import {
  BANDS, SCHEMES, schemeEntry, DEFAULT_BRIEF, normalizeBrief, buildProgram, programLines,
} from './program.js';
import { parseBrief } from './brief.js';
import { layoutSchool, buildSchool, generationSummary } from './generate.js';
import { AUTO_ENTRY, AUTO_KEY } from './templateedit.js';
import {
  ALL_FLOORS, MAX_PIXELS, MAX_BYTES,
  makeOverlay, setOverlay, calibrate, describeOverlay, centreOn, showsOn,
} from './overlay.js';
import { floorOverhang, floorBounds } from './shadow.js';
// --- Phase 13 ---
import {
  MIN_FT, MAX_FT, cellsForFt, footprintFt, planBounds, overlayBounds,
  unionBounds, coversBounds, resizeFootprint, growToCover, fitToOverlay,
  describeFootprint,
} from './footprint.js';
// --- Phase 14 ---
import {
  createSession, adoptIds, blockOf, blocksClash, makeSite, describeOps,
} from './session.js';
import {
  createRoster, presenceOf, worthSending, peerColor, peerLabel,
  describeRoster, describePeer, TTL,
} from './presence.js';
import {
  makeRoom, validRoom, readSessionFragment, sessionURL,
  channelWire, socketWire, canChannel,
} from './wire.js';
import * as cloud from './cloud.js';
import { clone as deepClone } from './history.js';
// --- Phase 9 ---
import { registerRows } from './catalog.js';
import { loadModel as readModelFile, FT_TO_M } from './gltf.js';
import {
  MAX_MODELS, modelRows, modelsOf, importModel, addModel, removeModel,
  updateModel, describeModel, modelUseCount, modelType,
} from './models.js';
import {
  encodeShare, decodeShare, shareURL, readShareFragment, shareStatus, omissionNote,
} from './share.js';
import {
  MAX_TOURS, MAX_KEYS, makeTour, addKey, removeKey, moveKey, updateKey,
  toursOf, tourSummary, tourDuration, sampleTour, startPlayback, stepPlayback,
} from './tour.js';
import {
  MINI_SIZE, MIN_RANGE, MAX_RANGE, minimapView, worldToMini, viewCone, inView,
  markerAngle, scaleBar, nextMode, nextOrient, describeMinimap,
  findingMarks, markAt, markOnFloor, describeMark, markFill, markLine,
} from './minimap.js';
import { xrAvailability, rigPosition } from './xr.js';

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
//
// **What a pre-v11 file lost on the way in.** Phase 12 made the polygon the
// only representation of a room, so a design saved before it is *baked* on
// load rather than appended to (see save-load.js). Almost everything survives
// exactly; the one thing that cannot is a boundary that bounded no room — a
// wall drawn across empty cells, or a stub poking into a room without dividing
// it. `deserialize` counts those and hands the count back, and this is what
// says so, because a building that quietly lost two walls is worse than one
// that says it did.
let migrationNote = null;
const onMigrate = (info) => {
  const rooms = `${info.rooms} room${info.rooms === 1 ? '' : 's'}`;
  migrationNote = info.orphans
    ? `Opened a version ${info.from} design — ${rooms}. ` +
      `${info.orphans} wall${info.orphans === 1 ? '' : 's'} bounded no room and could not come with it.`
    : `Opened a version ${info.from} design — ${rooms}, everything kept.`;
};
const sayIfMigrated = () => {
  if (!migrationNote) return;
  $('status').textContent = migrationNote;
  migrationNote = null;
};

let state = loadAutosave({ onMigrate }) || buildSampleSchool();

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

// --- Phase 14: the shared session ---
//
// Declared up here rather than beside the rest of it, because `designChanged`
// below is the one thing in the file that has to know a session exists, and
// what it does about it is one line: mark the design as having moved. Nothing
// in the editing path sends anything.
const collab = {
  wire: null,          // the pipe, or null when this design is yours alone
  session: null,       // the log and the clock — see session.js
  roster: createRoster(),
  mirror: null,        // the design as the other people last heard it
  moved: false,        // something changed since the last flush
  pending: [],         // ops that arrived mid-gesture, waiting for the pointer
  room: '', relay: '', name: '',
  presence: null, presenceAt: 0, flushAt: 0, panelAt: 0,
  waiting: 0,          // when a joiner asked for the building, so it can give up
  note: '',            // what the wire last said about itself
};

// What everything downstream of an edit has to be told, in one function so
// that an edit which arrived from somebody else (Phase 14) goes through the
// same door as one made here. It was the editor's `onChange` closure until a
// second caller needed it.
function designChanged(info = {}) {
  // Phase 9. An undo can restore (or take away) the whole model library and
  // a tour list, so both are checked against what is registered before the
  // rebuild that would otherwise draw stand-in boxes. The check is an
  // identity comparison, not a re-parse: models.js never mutates a record
  // or its array in place, so a changed library is a different array.
  syncModelsIfChanged();
  rebuild(!!info.throttled);
  // ...and any structural edit is a different plan under the minimap.
  if (!info.throttled) invalidateMinimap();
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
  // The code settings are part of the design too, so an undo can put them
  // back and the two controls have to follow.
  renderCodePanel();
  // A prop placed, painted, deleted or undone can change which swatch is
  // lit and what colour the chip shows.
  if (editor.tool === 'prop') syncPropPaint();
  // A hunt's hints name rooms and its hiding places stand on tiles, and a
  // structural edit is a different set of both. Rather than quietly leave
  // the hamster inside a wall somebody has just drawn, the hunt ends.
  if (hunt && info.structural !== false) huntStop();
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
  // ...and anybody sharing this design has to hear about it. Deliberately
  // last, and deliberately not a send: it marks the design as having moved,
  // and the loop decides when a packet is worth it. See sessionFlush.
  if (collab.wire) collab.moved = true;
}

const editor = initEditor({
  canvas,
  renderApi,
  getState: () => state,
  onChange: designChanged,
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

// How often a shove is allowed to make a noise, and how far something has to
// have gone to count as one. See `onShove` below.
const SCOOT_GAP = 130;      // ms
const SCOOT_MIN = 0.02;     // ft in one frame
let lastScoot = 0;

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
  // Phase 11: the chair you just walked into. shove.js has already decided
  // what went where and refused anything that wouldn't fit; this moves the
  // instances and, when something travelled far enough to hear, scrapes.
  //
  // The scrape is throttled rather than played per prop per frame: a shove
  // lasts as long as you keep walking, and sixty scrapes a second is a
  // machine shop. One voice every eighth of a second, from the piece that
  // moved furthest, is a chair sliding.
  onShove: (list) => {
    renderApi.moveProps(list);
    let far = list[0], best = -1;
    for (const m of list) {
      const d = Math.hypot(m.dx, m.dz);
      if (d > best) { best = d; far = m; }
    }
    const now = performance.now();
    if (best < SCOOT_MIN || now - lastScoot < SCOOT_GAP) return;
    lastScoot = now;
    audio.scoot({ x: far.x, y: renderApi.walkCamera.position.y - 4, z: far.z },
      best / MAX_SHOVE);
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
    // The map is drawn from the plan, and the plan may have changed since the
    // last walk.
    invalidateMinimap();
    updateMinimapButtons();
    renderTourPanel();
    openModal(walkOverlay, $('walk-start'));
    closeModal($('designs-overlay'));
    closeModal($('export-overlay'));
    $('mode-btn').textContent = '✏️ Edit Mode';
  } else {
    setPhotoMode(false);
    tourStop();
    document.body.classList.remove('tours');
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
  floor: 'Floor — click / drag to lay floor in 4ft cells. A cell joins the room it can walk to, or starts one.',
  wall: 'Wall — click or drag along a room boundary to raise a wall on it. G switches between solid, glass and railing; , and . curve one into an arc.',
  door: 'Door — pick single, double, cased opening or window, then click anywhere along a wall. Clicking the same kind again removes it.',
  room: 'Room — pick a name, color, floor finish and wall paint, then click a room to apply them',
  erase: 'Eraser — drag to remove walls, doors, and floor a cell at a time; click a free-drawn room to delete it',
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

// --- what the room *is* ---
//
// v11's two room-record fields. The tool guesses both — the occupancy group
// off the room's name, the occupant load off its area — and these are how
// somebody says otherwise. Empty means "keep guessing", which is what every
// version before this one did with nowhere to record an answer.
const roomUse = $('room-use');
{
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'From the name';
  roomUse.appendChild(none);
  for (const u of USES) {
    const o = document.createElement('option');
    o.value = u.key;
    o.textContent = u.label;
    roomUse.appendChild(o);
  }
}
roomUse.addEventListener('change', (e) => {
  editor.setRoomUse(e.target.value || null, undefined);
  $('status').textContent = e.target.value
    ? `Room — click a room to read it as ${e.target.selectedOptions[0].textContent.toLowerCase()}.`
    : 'Room — click a room to read its use off its name again.';
});

const roomLoad = $('room-load');
roomLoad.addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  editor.setRoomUse(undefined, Number.isFinite(v) && v > 0 ? v : null);
});
$('room-load-clear').addEventListener('click', () => {
  roomLoad.value = '';
  editor.setRoomUse(undefined, null);
  $('status').textContent = 'Room — occupant load back to what the area says.';
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
let paletteGroups = [];
// The decoration pack in force, or null. Declared here rather than beside the
// swatch row below because `buildPalette` reads it and runs first.
let decorPack = null;
// Phase 9 makes this a function rather than a run-once loop: an imported
// model is a catalog row that arrives (and leaves) while the tool is open, so
// the palette is rebuilt whenever the design's model library changes — on
// import, on delete, on load and on undo.
function buildPalette() {
paletteGroups = [];
palette.textContent = '';
// A decoration pack rides at the top as a group of its own — the same rows
// that are still down under Decor, in the order the season wants them. It is
// a shortcut, not a filter: nothing is hidden below it.
const groups = catalogByCategory();
if (decorPack) {
  groups.unshift({
    category: `${decorPack.icon} ${decorPack.name}`,
    entries: packTypes(decorPack).map(catalogEntry).filter(Boolean),
  });
}
groups.forEach(({ category, entries }) => {
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
      // Matched by type rather than by button: a pack's pieces appear twice,
      // once in its group and once under Decor, and both copies are the same
      // choice.
      palette.querySelectorAll('.palette-item').forEach((x) => {
        const on = x.dataset.type === entry.type;
        x.classList.toggle('active', on);
        x.setAttribute('aria-pressed', String(on));
      });
      // A piece the pack has an opinion about arrives wearing that opinion;
      // anything else leaves the paint alone, so a pack never quietly
      // repaints the desk you reached for next.
      const packed = decorPack ? packPaint(decorPack, entry.type) : '';
      if (packed) editor.setPropColor(packed);
      // A different row means a different default colour behind the paint.
      syncPropPaint();
    });
    row.appendChild(b);
    return { b, entry };
  });
  group.append(head, row);
  palette.appendChild(group);
  paletteGroups.push({ group, head, items });
});
filterPalette();
}

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
buildPalette();

// --- prop paint and the decoration packs (Phase 11) ---
// The swatch row under the palette. Same gesture as the room panel's two
// rows, and the same first cell: a dashed empty square that means "whatever
// the catalog says", not a colour of its own. It paints the selection if
// there is one and sets the paint for the next placement either way, so
// select-then-click and click-then-place both do what they look like.
//
// A decoration pack swaps the colours in that row for a season's six, and
// adds a group at the top of the palette holding the pieces that season is
// about. Picking one of those pieces takes the pack's paint with it, so
// "Winter Holidays → Wreath → click" puts a green wreath on the wall without
// anybody choosing a green. Nothing about the pack is stored: what lands in
// the design is an ordinary prop wearing an ordinary `data.color`, so
// switching packs afterwards leaves the decorations you already hung alone.
const propSwatches = $('prop-swatches');
const propPaintChip = $('prop-paint-chip');
const decorPackSelect = $('decor-pack');
const decorNote = $('decor-note');

function buildPaintRow() {
  const colors = decorPack ? [null, ...decorPack.palette] : PROP_PAINTS;
  propSwatches.textContent = '';
  colors.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = c || '';
    b.style.background = c || 'transparent';
    if (!c) b.style.border = '2px dashed rgba(255,255,255,0.45)';
    b.title = c || 'As catalogued';
    b.setAttribute('aria-label', c ? `Furniture paint ${c}` : 'Catalog colour');
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      editor.setPropColor(c || '');
      syncPropPaint();
    });
    propSwatches.appendChild(b);
  });
}

// Reads back off the tool rather than remembering what was clicked, because
// selecting a prop moves the highlight to *its* colour. A paint that isn't in
// the row — a pack colour still on the tool after the pack was switched, or a
// prop painted under a different pack — simply lights nothing, which is
// honest: the chip beside the heading still shows what the next placement
// would actually be.
function syncPropPaint() {
  const cur = editor.propColor || '';
  propSwatches.querySelectorAll('.swatch').forEach((b) => {
    const on = b.dataset.color === cur;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  propPaintChip.style.background = editor.propPreviewColor;
}

decorPackSelect.appendChild(Object.assign(document.createElement('option'),
  { value: '', textContent: 'No decoration pack' }));
DECOR_PACKS.forEach((p) => {
  decorPackSelect.appendChild(Object.assign(document.createElement('option'),
    { value: p.key, textContent: `${p.icon} ${p.name}` }));
});
decorPackSelect.addEventListener('change', (e) => {
  decorPack = packByKey(e.target.value);
  decorNote.textContent = decorPack ? decorPack.note : '';
  buildPaintRow();
  // The pack's own group goes at the top of the palette, so rebuild it — and
  // take the pack's paint for whatever type is already selected, so switching
  // from Harvest to Winter recolours the garland you were about to hang.
  buildPalette();
  editor.setPropColor(decorPack ? packPaint(decorPack, editor.propType) : '');
  syncPropPaint();
  $('status').textContent = decorPack
    ? `${decorPack.name} — its pieces are at the top of the palette, in its colours.`
    : 'Decoration pack off — furniture is back to its catalog colours.';
});

buildPaintRow();
syncPropPaint();
// Selecting a prop is not an edit, so it never reaches `onChange` — but it
// does move the highlight onto that prop's own colour, so the row follows the
// pointer as well as the model.
canvas.addEventListener('pointerup', () => { if (editor.tool === 'prop') syncPropPaint(); });

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
// The wall tool builds one of three things. Which one is editor state rather
// than design state, so the buttons just set it.
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
    const sqft = totalShapeArea(state.floors[i]);
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
  renderSheetPanel();
  reserveForFloorPanel();
}

// The toolbar and the floor panel share the left-hand column, one hung from
// the top and the other from the bottom, and the floor panel is the one whose
// height moves: a storey added, an overhang readout, and since Phase 13 the
// plan size. It was a constant in the stylesheet and the twelve-tool column
// had been quietly sliding under it on a laptop screen for two phases. So the
// stylesheet gets told the real number, every time the panel is redrawn.
function reserveForFloorPanel() {
  const h = $('floor-panel').offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--floor-panel-h', `${h}px`);
}

// --- the sheet ---
//
// Phase 13. The drawing surface was 160 x 120 ft and there was no way to
// change it: `createState` picked 40 x 30 cells, `save-load` clamped a loaded
// design to somewhere between 4 and 200, and nothing in between could set a
// number. Anybody who arrived with a plan of a real school — which is what the
// tracing overlay is *for* — measured their image, found it three hundred feet
// across, and discovered that two thirds of it lay off the sheet where the
// brush could not reach.
//
// So: two numbers in feet, and a Fit button. Feet rather than cells because a
// plan is dimensioned in feet and nobody thinks in fours; rounded out to whole
// cells on the way in, because the brush cannot paint two thirds of one.
//
// The origin never moves. The sheet starts at (0, 0) and grows +x and +z —
// see footprint.js for why that is a constraint rather than an oversight, and
// what follows from it when a picture has to be fitted onto it.
const sheetW = $('sheet-w');
const sheetD = $('sheet-d');

function renderSheetPanel() {
  const f = footprintFt(state);
  if (document.activeElement !== sheetW) sheetW.value = String(f.w);
  if (document.activeElement !== sheetD) sheetD.value = String(f.d);
  sheetW.min = sheetD.min = String(MIN_FT);
  sheetW.max = sheetD.max = String(MAX_FT);
  // The two fields already say how big the sheet is, so the readout says only
  // what they cannot — whether anything is off it. Silence means everything
  // fits, which is worth the silence: this column is shared with the toolbar.
  //
  // Two different facts can put something off the sheet, and only one of them
  // is a problem. A room outside it is *allowed* — a room is a free-floating
  // polygon in world feet, and grid.js has said since v1 that the footprint is
  // what the drawing surface covers, not a box a room has to fit inside; the
  // sample school's Learning Commons has stuck out past it since Phase 12, on
  // purpose. So that is reported as a measurement. A tracing image outside it
  // *is* a problem, because the only thing an image is for is drawing on top
  // of, so that is reported as something to do — and it is what Fit is for.
  const el = $('sheet-readout');
  const drawn = planBounds(state);
  const picture = overlayBounds(state.overlay);
  const lines = [];
  if (picture && !coversBounds(state, picture)) {
    lines.push('Part of the tracing image is off it, where the brush cannot reach — Fit covers it.');
  } else if (drawn && !coversBounds(state, drawn)) {
    lines.push(`The plan reaches ${Math.round(Math.max(drawn.x1, f.w))} × ` +
      `${Math.round(Math.max(drawn.z1, f.d))} ft. The 4ft brush stops at the edge; ` +
      'the vertex tool does not.');
  }
  $('sheet-fit').disabled = coversBounds(state, unionBounds(drawn, picture));
  el.textContent = lines.join(' ');
}

// One resize, through undo, with the rebuild and the readouts that follow it.
// `note` is what the status line says when it worked.
function applySheet(mutate, note, opts = {}) {
  // `open: true` means the caller has an edit of its own in flight — a
  // measurement, which has just written the overlay — and the resize belongs
  // in the same undo step rather than in one of its own. `pushUndo()` closes
  // whatever is open (see editor.js), so the whole of joining them is not
  // calling it.
  if (!opts.open) editor.pushUndo();
  const out = mutate();
  if (!out || !out.changed) { renderSheetPanel(); return out; }
  rebuild();
  renderApi.refreshOverlay(state);
  editor.refreshOverlay();
  renderFloorList();     // ...which redraws the plan-size row and its readout
  renderOverlayPanel();  // ...and the tracing image's own Fit, which this may
                         //    have just satisfied
  reportInvalidate();
  autosave(state);
  updateUndoButtons();
  const said = [typeof note === 'function' ? note(out) : note];
  // Shrinking is the one direction that can cost something: a room hanging off
  // the edge of the sheet comes back from the next repaint clipped, because
  // the brush rasterizes a storey onto a lattice the size of the footprint.
  // Said plainly rather than refused — the fix is one undo away.
  if (out.risk && out.risk.length) {
    said.push(`${out.risk.length} room${out.risk.length === 1 ? '' : 's'} now hang` +
      `${out.risk.length === 1 ? 's' : ''} off the sheet — the 4ft brush will clip ` +
      'them if you paint that storey again.');
  }
  if (out.clamped) said.push(`A plan is held between ${MIN_FT} and ${MAX_FT} ft.`);
  $('status').textContent = said.filter(Boolean).join(' ');
  return out;
}

// The fields are in feet and the sheet is in cells, so what comes back is
// rarely exactly what was typed: 250ft is 63 cells is 252ft. `resizeFootprint`
// is handed cells that are already in range, so whether the *typed* number was
// out of range is a question only this side can answer.
function sheetFromInputs() {
  const w = Number(sheetW.value), d = Number(sheetD.value);
  const out = resizeFootprint(state, cellsForFt(w), cellsForFt(d));
  const outOfRange = (v) => !Number.isFinite(v) || v < MIN_FT || v > MAX_FT;
  out.clamped = out.clamped || outOfRange(w) || outOfRange(d);
  return out;
}

for (const input of [sheetW, sheetD]) {
  input.addEventListener('change', () => {
    applySheet(sheetFromInputs, (out) => `Plan is ${out.w * CELL} × ${out.h * CELL} ft.`);
    // What the sheet actually became, which is not always what was typed.
    sheetW.value = String(state.w * CELL);
    sheetD.value = String(state.h * CELL);
  });
  // Enter commits without waiting for the field to lose focus.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });
}

// Grow until everything — every room on every storey, and the tracing image —
// is on the sheet. Never shrinks, and never moves the image: this button is
// reached from a design that has already been drawn in, where the picture is
// what the walls were traced from. (The overlay panel's own Fit will move an
// untraced picture; see there.)
$('sheet-fit').addEventListener('click', () => {
  applySheet(
    () => growToCover(state, unionBounds(planBounds(state), overlayBounds(state.overlay))),
    (out) => `Plan grown to ${out.w * CELL} × ${out.h * CELL} ft.` +
      (out.covered ? '' : ' Part of it is at negative coordinates, which no sheet reaches — ' +
        'move it back onto the plan first.'),
  );
});

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
  // Phase 9: the model library belongs to the design, so it is registered
  // with the catalog and parsed *before* the first rebuild — otherwise the
  // rebuild draws a stand-in box for every imported prop and then has to be
  // told to do it again.
  syncModels({ quiet: true });
  // A design that arrived from somebody else mid-session is the *same*
  // building being re-stated, so the camera stays where it was — re-framing
  // the plan under somebody's hands because a peer added a storey would be
  // the rudest thing this phase could do.
  if (!opts.keepView) renderApi.fitEditView(state);
  rebuild();
  editor.refreshOverlay();
  renderApi.refreshOverlay(state);
  renderFloorList();
  renderStairReadout();
  renderEnvPanel();
  renderSitePanel();
  renderOverlayPanel();
  renderCodePanel();
  adoptedByAudio();
  reportInvalidate();
  // A different design is a different plan under the minimap and a different
  // list of tours in the panel.
  invalidateMinimap();
  tourStop();
  tourIndex = 0;
  renderTourPanel();
  if (!opts.keepAutosave) autosaveNow(state);
  // A whole different design replaced the one the editor was holding. Callers
  // that want the swap itself to be undoable push an undo step *before* they
  // call in here (loading a file, opening a saved slot); everyone else — a
  // shared link, a generated school, a fresh start — wants the new design to
  // be where the history begins.
  if (!opts.undoable) editor.markClean();
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
    adoptState(await loadFromFile(file, { onMigrate }), { undoable: true });
    sayIfMigrated();
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
        adoptState(loadDesign(d.id, { onMigrate }), { undoable: true });
        sayIfMigrated();
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
  adoptState(createState(), { keepAutosave: true, undoable: true });
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

// Where a freshly loaded picture lands: over the middle of the lattice, which
// is where the building is and where the view is already pointed. Not over the
// middle of what is *drawn* — an empty design has no middle, and a design with
// one room in the corner would fling the picture off to meet it.
const designCentre = () => ({ x0: 0, z0: 0, x1: state.w * CELL, z1: state.h * CELL });

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

// The overlay panel's own Fit, which is the one that will *move* the picture.
//
// Two moves, and which of them is allowed is the whole of the decision (see
// footprint.js): slide the image onto the positive quadrant, then grow the
// sheet to cover it. Sliding is safe exactly while nothing has been traced
// from it — a wall drawn over the picture would come away from the line it was
// traced from — so a design with rooms in it, or a locked overlay, only grows.
function fitPlanToOverlay(opts = {}) {
  const o = overlayOf();
  if (!o) return null;
  const out = applySheet(() => fitToOverlay(state), (r) => {
    const said = [];
    if (opts.lead) said.push(opts.lead);
    said.push(`The plan is now ${r.w * CELL} × ${r.h * CELL} ft` +
      (r.moved ? ', with the image slid onto it' : '') + '.');
    if (!r.covered) {
      said.push(o.locked
        ? 'Part of it is still off the plan — unlock the image and fit again to slide it on.'
        : 'Part of it is still off the plan: something is drawn here already, so the image ' +
          'was left where it is. Move it with the overlay tool, or fit again on an empty plan.');
    }
    return said.join(' ');
  }, opts);
  renderOverlayPanel();
  return out;
}

$('overlay-fit').addEventListener('click', () => {
  if (!overlayOf()) return;
  fitPlanToOverlay({ lead: 'Plan fitted to the tracing image.' });
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

// What a partial or failed autosave sounds like. Phase 8 said it once, for
// the tracing image; Phase 9 has a second heavy record (imported models) and
// so the sentence is shared rather than repeated.
function autosaveNote(result) {
  if (result === 'partial') {
    $('status').textContent = "Autosaved without the tracing image and imported models — " +
      "they are too big for this browser's storage. Use Save to keep a file with everything in it.";
  } else if (result === 'failed') {
    $('status').textContent = 'Autosave failed — this browser refused to store the design.';
  }
}

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
  // Nothing to fit to, or nothing left to gain by fitting.
  $('overlay-fit').disabled = !o || coversBounds(state, overlayBounds(o));
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
  // Phase 13's own line. A picture bigger than the sheet is the state this
  // whole feature exists for, and it used to be silent: you found out by
  // dragging the brush across the bottom of the image and nothing happening.
  if (o && !coversBounds(state, overlayBounds(o))) {
    lines.push('Part of this image is off the plan, where the brush cannot reach it — ' +
      'Fit plan grows the sheet to cover it.');
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
  const scaled = `Scaled — the image is now ${Math.round(r.size.w).toLocaleString()} × ` +
    `${Math.round(r.size.d).toLocaleString()} ft.` + (r.reason ? ` ${r.reason}` : '');
  // The moment the sheet was too small, every time: a measurement is what
  // turns a picture of unknown size into three hundred feet of school, and
  // until Phase 13 the plan stayed 160 x 120 and said nothing about it. So the
  // fit happens here rather than waiting to be asked — it is undoable, it is
  // reported, and it only ever grows.
  if (!coversBounds(state, overlayBounds(state.overlay))) {
    const fitted = fitPlanToOverlay({ lead: scaled, open: true });
    if (fitted && fitted.changed) {
      // The picture has just changed size and probably moved; framing the
      // whole plan is what you would do next by hand anyway.
      renderApi.fitEditView(state);
      rebuild();
      return;
    }
  }
  $('status').textContent = scaled;
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
    el.innerHTML = `<b>${sum.rooms}</b> rooms (<b>${sum.tiles}</b> tiles) · ` +
      `<b>${sum.doors}</b> doors · <b>${sum.links}</b> stairs &amp; lifts<br />` +
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
  // No `sprinklered` option: since v11 it is a field on the design, and the
  // checkbox below writes it there rather than holding it for the session.
  report.data = buildReport(state);
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

// The two code settings are part of the design, so changing one is an edit:
// it goes on the undo stack, it autosaves, and it travels with the file.
function setCode(patch) {
  editor.pushUndo();
  state.code = normalizeCode({ ...codeOf(state), ...patch });
  if (isDefaultCode(state.code)) delete state.code;
  autosave(state);
  reportBuild();
  updateUndoButtons();
}

function renderCodePanel() {
  const code = codeOf(state);
  $('report-sprinklered').checked = code.sprinklered;
  $('report-edition').value = code.edition;
}

$('report-sprinklered').addEventListener('change', (e) => {
  setCode({ sprinklered: e.target.checked });
});

$('report-edition').addEventListener('change', (e) => {
  setCode({ edition: e.target.value });
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
// Phase 10's one control: what the word "generate" means. Until it there was
// exactly one scheme and it was a property of the file rather than a choice.
const genScheme = $('gen-scheme');
SCHEMES.forEach((s) => {
  const opt = document.createElement('option');
  opt.value = s.key;
  opt.textContent = s.label;
  genScheme.appendChild(opt);
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
  // The controls do not carry the adjacency rules — nothing on the sheet
  // edits them except the chips — so they come off the brief the sheet is
  // already holding.
  const raw = { band: genBand.value, scheme: genScheme.value, adjacency: genBrief.adjacency };
  for (const [key, id] of Object.entries(GEN_FIELDS)) raw[key] = Number($(id).value);
  for (const [key, id] of Object.entries(GEN_FLAGS)) raw[key] = $(id).checked;
  return normalizeBrief(raw);
}

function writeGenFields(brief) {
  genBand.value = brief.band;
  genScheme.value = brief.scheme;
  for (const [key, id] of Object.entries(GEN_FIELDS)) $(id).value = String(brief[key]);
  for (const [key, id] of Object.entries(GEN_FLAGS)) $(id).checked = brief[key];
}

// The adjacency rules the sheet is holding, as chips with a way to take one
// off again. They come only from the sentence box — there is no widget for
// "pick two rooms and a relation", because the sentence *is* that widget and
// a second way to say the same thing is a second thing to keep in step.
function renderGenAdjacency() {
  const el = $('gen-adjacency');
  const rules = genBrief.adjacency || [];
  el.classList.toggle('hidden', !rules.length);
  el.innerHTML = rules.map((r, i) =>
    `<span class="rule">${esc(r.a)} ${r.want === 'apart' ? 'away from' : 'next to'} ` +
    `${esc(r.b)}<button type="button" data-rule="${i}" title="Drop this rule" ` +
    `aria-label="Drop ${esc(r.a)} ${esc(r.want)} ${esc(r.b)}">×</button></span>`).join('');
}

$('gen-adjacency').addEventListener('click', (e) => {
  const i = Number(e.target.dataset && e.target.dataset.rule);
  if (!Number.isInteger(i)) return;
  genBrief = normalizeBrief({ ...genBrief, adjacency: genBrief.adjacency.filter((_, n) => n !== i) });
  renderGenAdjacency();
});

function renderGenSchedule() {
  $('gen-scheme-note').textContent = schemeEntry(genBrief.scheme).note;
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

for (const id of [...Object.values(GEN_FIELDS), ...Object.values(GEN_FLAGS), 'gen-band', 'gen-scheme']) {
  $(id).addEventListener('change', genChanged);
  $(id).addEventListener('input', genChanged);
}

$('gen-read').addEventListener('click', () => {
  const r = parseBrief($('gen-brief').value, readGenFields());
  genBrief = r.brief;
  writeGenFields(genBrief);
  renderGenAdjacency();
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
  renderGenAdjacency();
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
        `${sum.schemeLabel.toLowerCase()}`,
        `${sum.students} students`,
        `${sum.rooms} rooms on ${sum.storeys} storey${sum.storeys === 1 ? '' : 's'}`,
        `${sum.footprintFt.w}×${sum.footprintFt.d} ft`,
        `${sum.exits} ways out`,
        `${sum.props.toLocaleString()} pieces of furniture`,
      ];
      let text = `Generated — ${bits.join(', ')}.`;
      // What the brief asked about where two rooms sit, and whether the layout
      // could do it. Said out loud in both directions.
      const kept = sum.adjacency.filter((r) => r.done);
      const missed = sum.adjacency.filter((r) => !r.done);
      if (kept.length) {
        text += ` Kept ${kept.map((r) => `${r.a} ${r.want === 'apart' ? 'away from' : 'next to'} ${r.b}`).join(' and ')}.`;
      }
      if (missed.length) {
        text += ` Could not ${missed.map((r) => `put ${r.a} ${r.want === 'apart' ? 'away from' : 'next to'} ${r.b}` +
          (r.why ? ` (${r.why})` : r.gap !== null ? ` (closest ${r.gap} ft)` : '')).join(' or ')}.`;
      }
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
  // --- Phase 9's three, all walkthrough-only ---
  if (mode === 'walk' && !typing && !e.ctrlKey && !e.metaKey) {
    if (e.code === 'KeyT') {
      const on = document.body.classList.toggle('tours');
      if (on) renderTourPanel();
      return;
    }
    if (e.code === 'KeyJ') { miniOn = !miniOn; updateMinimapButtons(); return; }
    if (e.code === 'KeyR') { tourMark(); return; }
    // Phase 10's one: the findings, on the map in your hand. Bracket keys
    // step through them, which is the same gesture as the report panel's own
    // list read top-down.
    if (e.code === 'KeyO') { setMiniFindings(!miniFindings); return; }
    // Phase 11's one: start (or give up on) the scavenger hunt without going
    // back out to the overlay for it — the overlay costs you the pointer lock,
    // and losing the pointer lock in the middle of a hunt is losing the hunt.
    if (e.code === 'KeyG') { $('walk-hunt').click(); return; }
    if (e.code === 'BracketLeft') { stepMiniFinding(-1); return; }
    if (e.code === 'BracketRight') { stepMiniFinding(1); return; }
    if (e.code === 'Enter' && document.body.classList.contains('tours')) {
      tourPlay ? tourStop() : tourStart(false);
      return;
    }
    // Escape stops a tour before it stops the walkthrough.
    if (e.code === 'Escape' && tourPlay) { tourStop(); e.preventDefault(); return; }
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
window.addEventListener('resize', () => { renderApi.resize(); reserveForFloorPanel(); });


// ============================================================
// Phase 9 — sharing, and beyond the tab
// ============================================================

// The last model library that was registered, by identity. See the editor's
// onChange above for why identity is enough.
let registeredModels = null;

function syncModelsIfChanged() {
  // `state.models` itself, not `modelsOf`, which manufactures a fresh empty
  // array for a design that has none — and would therefore never compare
  // equal to itself.
  const models = state.models || null;
  if (models === registeredModels) return;
  syncModels({ quiet: true });
  renderTourPanel();
}

// --- imported models ---
//
// The library lives on the design (`state.models`), the rows it produces are
// registered with catalog.js, and the geometry is parsed once by render.js.
// This is the one function that keeps those three in step, and it is called
// from every place a design can change underneath them: load, import, delete,
// undo.
function syncModels(opts = {}) {
  const models = modelsOf(state);
  registeredModels = state.models || null;
  registerRows(modelRows(models));
  const failed = renderApi.setModels(models);
  buildPalette();
  if (!models.length) $('model-manage').textContent = 'Manage';
  else $('model-manage').textContent = `Manage (${models.length})`;
  if (failed.length && !opts.quiet) {
    alert(`Could not read ${failed.length === 1 ? 'a model' : `${failed.length} models`}:\n` +
      failed.map((f) => `· ${f.name}: ${f.message}`).join('\n'));
  }
  return failed;
}

const modelOverlay = $('model-overlay');
const modelsOverlay = $('models-overlay');
// The file waiting on the "how big is it?" dialog: its bytes, its suggested
// name, and the size the file itself claims to be.
let pendingModel = null;

$('model-import').addEventListener('click', () => $('model-file').click());
$('models-add').addEventListener('click', () => $('model-file').click());

$('model-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (modelsOf(state).length >= MAX_MODELS) {
    alert(`This design already has ${MAX_MODELS} imported models.`);
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Parse it *now*, so a file that isn't a model fails at the file input
    // rather than three dialogs later.
    const { model } = importModel(bytes, file.name);
    // ...and read its own bounding box, so the dialog can open with the size
    // the file thinks it is rather than with a guess. glTF is metres; this
    // build is feet.
    let suggested = null;
    try {
      const read = readModelFile(bytes, null);
      const b = read.bbox;
      const ft = (v) => Math.round((v / FT_TO_M) * 4) / 4;
      suggested = {
        w: Math.max(0.25, ft(b.maxX - b.minX)),
        d: Math.max(0.25, ft(b.maxZ - b.minZ)),
        h: Math.max(0.25, ft(b.maxY - b.minY)),
        tris: read.triangles,
      };
    } catch { /* the fit dialog's defaults will do */ }
    pendingModel = { bytes, name: model.name, suggested };
    $('model-name').value = model.name;
    $('model-w').value = suggested ? suggested.w : 3;
    $('model-d').value = suggested ? suggested.d : 3;
    $('model-h').value = suggested ? suggested.h : 3;
    $('model-mount').value = 'floor';
    $('model-stretch').checked = false;
    $('model-site').checked = false;
    $('model-detail').textContent = suggested
      ? `${file.name} — ${suggested.tris.toLocaleString()} triangles, and the file says it is ` +
        `${suggested.w} × ${suggested.d} × ${suggested.h} ft. Change the numbers to resize it; ` +
        `the model is fitted to whatever box you give it.`
      : `${file.name} — set the size this should stand at, in feet.`;
    closeModal(modelsOverlay);
    openModal(modelOverlay, $('model-name'));
  } catch (err) {
    alert(`Could not import that model: ${err.message}`);
  }
});

$('model-cancel').addEventListener('click', () => { pendingModel = null; closeModal(modelOverlay); });

$('model-ok').addEventListener('click', () => {
  if (!pendingModel) return closeModal(modelOverlay);
  const numOr = (id, fallback) => {
    const v = Number($(id).value);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  try {
    const { model } = importModel(pendingModel.bytes, pendingModel.name, {
      name: $('model-name').value,
      w: numOr('model-w', 3),
      d: numOr('model-d', 3),
      h: numOr('model-h', 3),
      mount: $('model-mount').value,
      fit: $('model-stretch').checked ? 'stretch' : 'contain',
      site: $('model-site').checked,
    });
    editor.pushUndo();
    const added = addModel(modelsOf(state), model);
    state.models = added.models;
    pendingModel = null;
    closeModal(modelOverlay);
    // `syncModels` registers the row, parses the file and rebuilds the
    // palette; all that is left is to pick the thing that just arrived,
    // because importing something and then having to find it in the palette
    // is a step nobody wanted.
    const failed = syncModels();
    if (!failed.length) {
      selectTool('prop');
      editor.setPropType(modelType(added.model.id));
      buildPalette();
      $('status').textContent = `Imported "${added.model.name}" — click in a room to place it`;
    }
    autosave(state, autosaveNote);
    rebuild();
    updateUndoButtons();
  } catch (err) {
    alert(err.message);
  }
});

function renderModelsList() {
  const list = $('models-list');
  list.textContent = '';
  const models = modelsOf(state);
  if (!models.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing imported yet — bring in a .glb and it becomes a prop type.';
    list.appendChild(empty);
    return;
  }
  for (const m of models) {
    const uses = modelUseCount(state, m.id);
    const row = document.createElement('div');
    row.className = 'model';

    const name = document.createElement('div');
    name.className = 'name';
    const title = document.createElement('input');
    title.type = 'text';
    title.value = m.name;
    title.maxLength = 40;
    title.setAttribute('aria-label', `Name of ${m.name}`);
    title.addEventListener('change', () => {
      editor.pushUndo();
      state.models = updateModel(modelsOf(state), m.id, { name: title.value });
      syncModels();
      renderModelsList();
      autosave(state, autosaveNote);
    });
    const meta = document.createElement('small');
    meta.textContent = describeModel(m, uses);
    name.append(title, meta);

    // Resizing re-fits the geometry into the new box, which is why it lives
    // here rather than on the prop: every copy of an imported chair is the
    // same chair, the way every student desk is the same desk.
    const dims = document.createElement('div');
    for (const key of ['w', 'd', 'h']) {
      const n = document.createElement('input');
      n.type = 'number';
      n.min = '0.25'; n.max = '60'; n.step = '0.25';
      n.value = String(m[key]);
      n.title = { w: 'Width (ft)', d: 'Depth (ft)', h: 'Height (ft)' }[key];
      n.setAttribute('aria-label', `${n.title} of ${m.name}`);
      n.addEventListener('change', () => {
        const v = Number(n.value);
        if (!Number.isFinite(v) || v <= 0) return;
        editor.pushUndo();
        state.models = updateModel(modelsOf(state), m.id, { [key]: v });
        syncModels();
        renderModelsList();
        rebuild();
        autosave(state, autosaveNote);
      });
      dims.appendChild(n);
    }

    const del = document.createElement('button');
    del.textContent = '🗑';
    del.title = 'Remove this model from the design';
    del.setAttribute('aria-label', `Remove ${m.name}`);
    del.addEventListener('click', () => {
      if (uses && !confirm(`${m.name} is placed ${uses} time${uses === 1 ? '' : 's'}. ` +
        'Removing the model leaves those props in the design with nothing to draw them — ' +
        'importing the same file again brings them back. Remove it?')) return;
      editor.pushUndo();
      state.models = removeModel(modelsOf(state), m.id);
      syncModels();
      renderModelsList();
      rebuild();
      autosave(state, autosaveNote);
      updateUndoButtons();
    });

    row.append(name, dims, del);
    list.appendChild(row);
  }
}

$('model-manage').addEventListener('click', () => {
  renderModelsList();
  openModal(modelsOverlay, $('models-close'));
});
$('models-close').addEventListener('click', () => closeModal(modelsOverlay));

// --- sharing ---

const shareOverlay = $('share-overlay');
let shareHref = '';

async function buildShareLink() {
  const note = $('share-note');
  const box = $('share-link');
  box.value = 'Compressing…';
  note.textContent = '';
  note.className = '';
  try {
    // The two megabyte-sized records are dropped rather than truncated, and
    // the dialog says so above the link — see share.js's `omissionNote`.
    const json = serializeForShare(state);
    const payload = await encodeShare(json);
    const href = shareURL(location.href, payload);
    const status = shareStatus(payload, location.href.split('#')[0]);
    if (!status.ok) {
      box.value = '';
      shareHref = '';
      note.textContent = status.note;
      note.className = 'bad';
      $('share-copy').disabled = true;
      $('share-open').disabled = true;
      return;
    }
    shareHref = href;
    box.value = href;
    const omitted = omissionNote(state);
    note.textContent = omitted ? `${status.note} ${omitted}` : status.note;
    note.className = status.comfortable ? '' : 'warn';
    $('share-copy').disabled = false;
    $('share-open').disabled = false;
  } catch (err) {
    box.value = '';
    note.textContent = `Could not build a link: ${err.message}`;
    note.className = 'bad';
  }
}

// A link carries the design and not the heavy records — the tracing image and
// the imported model files, both of which are megabytes and neither of which
// survives base64 in a URL.
function serializeForShare(st) {
  return serialize(st, { omitOverlay: true, omitModels: true });
}

$('share-btn').addEventListener('click', () => {
  openModal(shareOverlay, $('share-copy'));
  buildShareLink();
});
$('share-close').addEventListener('click', () => closeModal(shareOverlay));
$('share-open').addEventListener('click', () => { if (shareHref) window.open(shareHref, '_blank', 'noopener'); });
$('share-copy').addEventListener('click', async () => {
  if (!shareHref) return;
  const box = $('share-link');
  try {
    await navigator.clipboard.writeText(shareHref);
    $('share-copy').textContent = '✓ Copied';
    setTimeout(() => { $('share-copy').textContent = '📋 Copy link'; }, 1600);
  } catch {
    // Clipboard permission refused, or an insecure origin: select it and let
    // the person press the two keys themselves.
    box.focus();
    box.select();
    $('share-note').textContent = 'Press Ctrl+C (⌘C on a Mac) to copy the selected link.';
  }
});

// A link that was *opened* rather than made. Runs once, after everything else
// is wired, and replaces whatever the autosave restored — which is the right
// way round: somebody who clicked a link wants the school in the link.
async function openSharedDesign() {
  const payload = readShareFragment(location.hash);
  if (!payload) return;
  try {
    const json = await decodeShare(payload);
    const shared = deserialize(json, { onMigrate });
    // The autosave is left alone until the shared design is edited, so
    // opening somebody's link doesn't cost you your own work in progress.
    adoptState(shared, { keepAutosave: true });
    $('status').textContent = migrationNote
      ? `${migrationNote} Save it to keep it.`
      : 'Opened a shared design — save it to keep it.';
    migrationNote = null;
  } catch (err) {
    $('status').textContent = `That link could not be opened: ${err.message}`;
  }
}


// --- Phase 14: two people, one plan ---
//
// The rule this whole section is built on: **nothing below changes what the
// tool does when there is no session.** `collab.wire` is null until somebody
// deliberately opens one, every function here returns immediately while it is,
// and the design on the disk is the same file it always was.
//
// The pieces are session.js (what an edit is, and who wins), presence.js (who
// is here) and wire.js (the pipe). What is left for the shell is the four
// things a shell is for: when to send, what to do with what arrives, where to
// draw the other people, and what to say about all of it.

const sessionOn = () => !!collab.wire;

// The design, minus the two records that are megabytes and never travel in an
// op — the same pair editor.js holds out of the undo diff, for the same
// reason. Both go in a snapshot instead, once, at the join.
function sessionDesign() {
  const { overlay, models, ...rest } = state;
  return rest;
}

const sessionStatus = (text) => { $('status').textContent = text; };

// How long a joiner waits for somebody to send it the building before
// deciding it is the first one here. Two seconds is long enough for a relay
// on the other side of an ocean and short enough not to look broken.
const SNAPSHOT_WAIT = 2200;
// How often the design is checked for changes worth sending. A flush walks
// the records and compares them, which is the same arithmetic an undo step
// costs, so it happens on a timer rather than on every mutation.
const FLUSH_MS = 350;

// ---------- starting, joining, leaving ----------

function sessionStart({ room, relay = '', joining = false } = {}) {
  sessionLeave({ quiet: true });
  const id = validRoom(room) ? room : makeRoom();
  const site = makeSite();
  let wire;
  try {
    wire = relay ? socketWire(relay, id, site) : channelWire(id, site);
  } catch (err) {
    sessionStatus(`Could not open a session: ${err.message}`);
    return false;
  }
  collab.wire = wire;
  collab.session = createSession({ site, name: collab.name, room: id });
  collab.room = id;
  collab.relay = relay;
  collab.roster.clear();
  collab.pending.length = 0;
  collab.presence = null;
  collab.moved = false;
  collab.note = '';
  collab.waiting = joining ? performance.now() : 0;
  // From here on, anything this browser creates is numbered out of this
  // site's own block, so two people drawing at once cannot mint the same id
  // for two different rooms. Ids already in the design are left alone.
  adoptIds(state, site);
  collab.session.baseline(sessionDesign());
  collab.mirror = deepClone(sessionDesign());

  wire.onMessage(onSessionMessage);
  wire.onStatus((st, note) => {
    collab.note = st === 'open' ? '' : st === 'waiting' ? `reconnecting in ${note}` : st;
    renderSessionPanel();
  });
  wire.start();
  wire.send('hello', { name: collab.name, block: blockOf(site), want: joining ? 1 : 0 });

  history.replaceState(null, '', sessionURL(location.href, id, relay));
  renderSessionPanel();
  sessionStatus(joining
    ? `Joined session ${id} — waiting for the building…`
    : `Session ${id} — send the link and they can draw with you.`);
  return true;
}

function sessionLeave({ quiet = false } = {}) {
  if (!collab.wire) return;
  try { collab.wire.send('bye', {}); } catch { /* the pipe may already be gone */ }
  collab.wire.close();
  collab.wire = null;
  collab.session = null;
  collab.mirror = null;
  collab.roster.clear();
  collab.pending.length = 0;
  collab.presence = null;
  clearPeerMarkers();
  if (!quiet) {
    history.replaceState(null, '', location.href.split('#')[0]);
    renderSessionPanel();
    sessionStatus('Left the session. The design is yours, exactly as it stands.');
  }
}

// ---------- what arrives ----------

function onSessionMessage(msg) {
  if (!sessionOn()) return;
  const now = performance.now();
  const me = collab.session.site;

  if (msg.k === 'hello') {
    // Two sites in one id block would allocate the same ids for different
    // things. One in four thousand, caught here rather than discovered later:
    // the higher site id re-rolls, which is cheap because it has barely
    // allocated anything yet.
    if (blocksClash(me, msg.s) && me > msg.s) {
      sessionStatus('Two of us drew the same id block — taking another one.');
      sessionStart({ room: collab.room, relay: collab.relay, joining: false });
      return;
    }
    collab.roster.see(msg.s, { name: msg.name, block: msg.block }, now);
    // Answer, so the newcomer sees everybody who was already here — but only
    // to a first hello, or two tabs would greet each other forever.
    if (!msg.re) collab.wire.send('hello', { name: collab.name, block: blockOf(me), re: 1 });
    if (msg.want) sendSnapshot(msg.s);
    renderSessionPanel();
    return;
  }

  if (msg.k === 'bye') {
    const peer = collab.roster.get(msg.s);
    collab.roster.drop(msg.s);
    if (peer) sessionStatus(`${peerLabel(peer)} left the session.`);
    renderSessionPanel();
    return;
  }

  if (msg.k === 'pres') {
    collab.roster.see(msg.s, { p: msg.p }, now);
    return;
  }

  if (msg.k === 'want') { sendSnapshot(msg.s); return; }

  if (msg.k === 'snap') {
    // Addressed to somebody: only they take it, and only if they are still
    // waiting — three people answering one joiner is three snapshots.
    // Addressed to nobody: it is a resync, and everybody takes it.
    if (msg.to && msg.to !== me) return;
    if (msg.to && !collab.waiting) return;
    collab.roster.see(msg.s, {}, now);
    takeSnapshot(msg);
    return;
  }

  if (msg.k === 'ops') {
    // Somebody whose hello went missing is still somebody in the session.
    collab.roster.see(msg.s, {}, now);
    // Mid-gesture, an arriving edit waits: applying it would close the stroke
    // somebody has their hand on and split it into two undo steps.
    if (pointerBusy) { collab.pending.push(...msg.ops); return; }
    applyRemoteOps(msg.ops, msg.s);
  }
}

function applyRemoteOps(ops, from) {
  if (!sessionOn() || !ops || !ops.length) return;
  // Whatever this browser has drawn and not yet sent goes first, so that the
  // mirror below is a design everybody has already heard about. Without this,
  // an edit made in the last third of a second would be swallowed.
  sessionFlush();
  const res = collab.session.receive(state, ops);
  if (!res.applied) return;
  collab.mirror = deepClone(sessionDesign());
  // Their edit is not an entry in your undo stack. Undo is for what you did.
  editor.markClean();
  designChanged({ structural: true });
  collab.moved = false;
  const who = peerLabel(collab.roster.get(from) || { site: from });
  sessionStatus(`${who} changed ${describeOps(ops)}.`);
  renderSessionPanel();
}

// ---------- snapshots ----------
//
// The log carries edits; a snapshot carries the building. It is sent in three
// situations and no others: somebody has just joined, somebody added or
// removed a storey (which is the one change a record-addressed log cannot
// say), or an edit touched so much of the design that saying it record by
// record would cost more than saying it whole.

function sendSnapshot(to = null) {
  if (!sessionOn()) return false;
  let json;
  try {
    json = serialize(state);
  } catch (err) {
    sessionStatus(`Could not send the design: ${err.message}`);
    return false;
  }
  collab.mirror = deepClone(sessionDesign());
  return collab.wire.send('snap', { to, design: json, meta: collab.session.snapshotMeta() });
}

function takeSnapshot(msg) {
  // Joining is arriving at somebody else's building, so the view goes with
  // it. A resync mid-session is the same building re-stated, so it does not.
  const joining = !!collab.waiting;
  try {
    const next = deserialize(msg.design, { onMigrate });
    collab.waiting = 0;
    // Their bookkeeping as well as their building: a joiner that started its
    // clock at zero would lose every argument for the first few edits.
    collab.session.adoptMeta(msg.meta);
    // ...and its own ids stay its own. `deserialize` renumbers from what is in
    // the file, so the block has to be re-claimed on the way in.
    adoptState(next, { keepAutosave: true, keepView: !joining });
    adoptIds(state, collab.session.site);
    collab.mirror = deepClone(sessionDesign());
    collab.moved = false;
    const who = peerLabel(collab.roster.get(msg.s) || { site: msg.s });
    const line = joining
      ? `Opened ${who}'s building — you are drawing on the same plan.`
      : `${who} changed something a log cannot say — the whole plan came across.`;
    sessionStatus(migrationNote ? `${migrationNote} ${line}` : line);
    migrationNote = null;
    renderSessionPanel();
  } catch (err) {
    sessionStatus(`The building that arrived could not be opened: ${err.message}`);
  }
}

// ---------- what goes out ----------

function sessionFlush() {
  if (!sessionOn() || !collab.mirror) return;
  collab.moved = false;
  const live = sessionDesign();
  const out = collab.session.emit(collab.mirror, live);
  if (out.resync) {
    sendSnapshot(null);
    return;
  }
  if (!out.ops.length) return;
  // The mirror moves *before* the send, not after. A transport is free to
  // deliver the answer synchronously — the loopback one in the suites does —
  // and a mirror still holding the old design when that reply lands makes the
  // reply's flush say everything a second time.
  collab.mirror = deepClone(live);
  collab.wire.send('ops', { ops: out.ops });
}

// Where this browser is looking, for everybody else's map. The two modes
// answer it differently on purpose: walking, it is where you are standing;
// drawing, it is the middle of what you are looking at, which is the closest
// thing a plan view has to a position.
function sessionPresence(now) {
  if (!sessionOn()) return;
  let view;
  if (mode === 'walk') {
    const cam = renderApi.walkCamera;
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    view = {
      x: cam.position.x, z: cam.position.z, yaw: e.y,
      floor: storeyAt(state, cam.position.y - EYE_H), mode: 'walk',
    };
  } else {
    const v = renderApi.editView;
    view = { x: v.x, z: v.z, yaw: 0, floor: state.currentFloor, mode: 'plan' };
  }
  const p = presenceOf(view);
  if (!worthSending(collab.presence, p, now, collab.presenceAt)) return;
  collab.presence = p;
  collab.presenceAt = now;
  collab.wire.send('pres', { p });
}

// Called once per frame. Everything time-based about a session is here, so
// there is one place to look when a session is doing something surprising.
function sessionTick(now) {
  if (!sessionOn()) return;
  if (collab.pending.length && !pointerBusy) {
    const ops = collab.pending.splice(0);
    applyRemoteOps(ops, ops[0] && ops[0].site);
  }
  if (collab.moved && now - collab.flushAt > FLUSH_MS && !pointerBusy) {
    collab.flushAt = now;
    sessionFlush();
  }
  sessionPresence(now);
  const gone = collab.roster.prune(now);
  if (gone.length) {
    sessionStatus(`${gone.map(peerLabel).join(' and ')} ${gone.length === 1 ? 'has' : 'have'} gone.`);
    renderSessionPanel();
  }
  // Where the peers are is on the panel as words, and words go stale. Once a
  // second, and only while somebody is looking at it.
  if (now - collab.panelAt > 1000 && !$('session-panel').classList.contains('hidden')) {
    collab.panelAt = now;
    renderSessionPanel();
  }
  // A joiner that nobody answered is the first one here, which is a perfectly
  // good thing to be — it keeps the design it already had.
  if (collab.waiting && now - collab.waiting > SNAPSHOT_WAIT) {
    collab.waiting = 0;
    sessionStatus(`Nobody else is in session ${collab.room} yet — this design is the one they will get.`);
    renderSessionPanel();
  }
  updatePeerMarkers();
}

// The pointer being down is the one thing that makes an arriving edit wait,
// so it is tracked here rather than reached for inside the editor.
let pointerBusy = false;
canvas.addEventListener('pointerdown', () => { pointerBusy = true; });
canvas.addEventListener('pointerup', () => { pointerBusy = false; });
canvas.addEventListener('pointercancel', () => { pointerBusy = false; });

// ---------- where everybody else is standing ----------
//
// One flat arrow per peer, in their colour, on the storey they are on. Drawn
// without depth testing on purpose: a collaborator behind a wall is exactly
// the person you want to be able to see.

const peerLayer = new THREE.Group();
peerLayer.renderOrder = 620;
renderApi.scene.add(peerLayer);
const peerMarkers = new Map();

const PEER_ARROW = (() => {
  const g = new THREE.BufferGeometry();
  // A 3ft arrow lying on the floor, pointing down -Z, which is the direction
  // a yaw of zero looks in.
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -2.2, 1.5, 0, 1.4, 0, 0, 0.5,
    0, 0, 0.5, -1.5, 0, 1.4, 0, 0, -2.2,
  ], 3));
  g.computeVertexNormals();
  return g;
})();
const PEER_PIN = new THREE.CylinderGeometry(0.16, 0.16, 5.4, 6);

function makePeerMarker(color) {
  const group = new THREE.Group();
  const tint = new THREE.Color(color);
  const arrow = new THREE.Mesh(PEER_ARROW, new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide,
  }));
  arrow.renderOrder = 621;
  const pin = new THREE.Mesh(PEER_PIN, new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.4, depthTest: false,
  }));
  pin.position.y = 2.7;
  pin.renderOrder = 622;
  group.add(arrow, pin);
  return group;
}

function clearPeerMarkers() {
  for (const m of peerMarkers.values()) peerLayer.remove(m);
  peerMarkers.clear();
}

function updatePeerMarkers() {
  const live = new Set();
  for (const peer of collab.roster.list()) {
    if (!peer.moved) continue;   // nothing to draw until they have said where
    live.add(peer.site);
    let marker = peerMarkers.get(peer.site);
    if (!marker) {
      marker = makePeerMarker(peer.color);
      peerMarkers.set(peer.site, marker);
      peerLayer.add(marker);
    }
    marker.position.set(peer.x, floorBaseY(state, Math.min(peer.f, state.floors.length - 1)) + 0.12, peer.z);
    marker.rotation.y = peer.yaw;
    // On the plan, only the storey being drawn; walking, everybody, because a
    // colleague one floor up is worth knowing about.
    marker.visible = mode === 'walk' || peer.f === state.currentFloor;
  }
  for (const [site, marker] of peerMarkers) {
    if (live.has(site)) continue;
    peerLayer.remove(marker);
    peerMarkers.delete(site);
  }
}

// ---------- the panel ----------

function renderSessionPanel() {
  const stateLine = $('session-state');
  const on = sessionOn();
  $('session-start').classList.toggle('hidden', on);
  $('session-leave').classList.toggle('hidden', !on);
  $('session-link-row').classList.toggle('hidden', !on);
  $('session-btn').classList.toggle('on', on);

  if (!on) {
    stateLine.innerHTML = 'Not in a session — this design is yours alone. ' +
      (canChannel() ? '' : '<span class="warn">This browser cannot share between windows.</span>');
  } else {
    const others = collab.roster.list();
    const where = collab.relay ? esc(collab.relay) : 'the other windows of this browser';
    const trouble = collab.note ? ` <span class="warn">${esc(collab.note)}</span>` : '';
    stateLine.innerHTML =
      `<span class="live">Live</span> in <b>${esc(collab.room)}</b>, over ${where}.${trouble}<br />` +
      `${esc(describeRoster(others))}`;
    $('session-link').textContent = sessionURL(location.href, collab.room, collab.relay);
  }

  const list = $('session-peers');
  const rows = sessionOn() ? collab.roster.list() : [];
  list.innerHTML = rows.map((peer) => {
    const floor = peer.f < state.floors.length ? floorLabel(peer.f) : `Level ${peer.f + 1}`;
    return `<div class="peer"><span class="dot" style="background:${esc(peer.color)}"></span>` +
      `${esc(peerLabel(peer))}<span class="doing">${esc(describePeer(peer, floor))}</span></div>`;
  }).join('');

  const cfg = cloud.readConfig();
  $('session-note').textContent = cloud.describeCloud(cfg);
}

// ---------- the controls ----------

$('session-btn').addEventListener('click', () => {
  const panel = $('session-panel');
  const hidden = panel.classList.toggle('hidden');
  if (!hidden) renderSessionPanel();
  $('session-btn').setAttribute('aria-pressed', String(!hidden));
});

$('session-start').addEventListener('click', () => {
  const cfg = cloud.readConfig();
  sessionStart({ room: makeRoom(), relay: cfg.relay, joining: false });
});

$('session-leave').addEventListener('click', () => sessionLeave());

$('session-name').addEventListener('change', () => {
  collab.name = $('session-name').value.trim().slice(0, 24);
  const cfg = cloud.readConfig();
  cloud.writeConfig({ ...cfg, name: collab.name });
  if (sessionOn()) collab.wire.send('hello', { name: collab.name, block: blockOf(collab.session.site), re: 1 });
  renderSessionPanel();
});

$('session-copy').addEventListener('click', async () => {
  const link = $('session-link').textContent;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    $('session-copy').textContent = '✓';
    setTimeout(() => { $('session-copy').textContent = 'Copy'; }, 1500);
  } catch {
    sessionStatus(`Copy this: ${link}`);
  }
});

// A session id, or a whole link with one in it — both are things somebody
// will paste in here, so both are read.
function roomFromInput(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const cut = raw.indexOf('#');
  const frag = cut >= 0 ? readSessionFragment(raw.slice(cut)) : null;
  if (frag) return frag;
  return validRoom(raw) ? { room: raw, relay: '' } : null;
}

$('session-go').addEventListener('click', () => {
  const found = roomFromInput($('session-join').value);
  if (!found) {
    sessionStatus('That is not a session id — it is eight letters, or the whole link.');
    return;
  }
  const cfg = cloud.readConfig();
  sessionStart({ room: found.room, relay: found.relay || cfg.relay, joining: true });
  $('session-join').value = '';
});

$('session-server-save').addEventListener('click', () => {
  const cfg = cloud.writeConfig({
    base: $('session-store').value,
    relay: $('session-relay').value || cloud.impliedRelay($('session-store').value),
    name: collab.name,
  });
  $('session-store').value = cfg.base;
  $('session-relay').value = cfg.relay;
  renderSessionPanel();
  sessionStatus(cfg.base || cfg.relay
    ? 'Addresses saved. A session started from now on will use the relay.'
    : 'Cleared — sessions stay between the windows of this browser.');
});

$('cloud-put').addEventListener('click', async () => {
  const cfg = cloud.readConfig();
  if (!cloud.cloudReady(cfg)) {
    sessionStatus('No design store is set — put its address in the Server box first.');
    return;
  }
  const btn = $('cloud-put');
  btn.disabled = true;
  try {
    const id = cloudId || cloud.newDesignId();
    const key = cloud.keyFor(id) || cloud.newWriteKey();
    const json = serialize(state);
    await cloud.putDesign(cfg.base, id, key, json, {});
    cloud.rememberKey(id, key, 'design');
    cloudId = id;
    const link = cloud.cloudURL(location.href, id, cfg.base);
    try { await navigator.clipboard.writeText(link); } catch { /* say it instead */ }
    sessionStatus(`Uploaded — the link is on your clipboard: ${link}`);
  } catch (err) {
    sessionStatus(`Could not upload: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// Which design in the store this one is, once it has been up there — so a
// second upload replaces it rather than making a second copy.
let cloudId = '';

// A design that came out of a store, and a session that was in the address
// bar. Both run at startup, after the autosave has been restored, and in that
// order: open the building first, then join the people.
async function openCloudDesign() {
  const found = cloud.readCloudFragment(location.hash);
  if (!found) return false;
  const cfg = cloud.readConfig();
  const base = found.base || cfg.base;
  if (!base) {
    sessionStatus('That link points at a design store this browser has no address for.');
    return false;
  }
  try {
    const json = await cloud.getDesign(base, found.id, {});
    adoptState(deserialize(json, { onMigrate }), { keepAutosave: true });
    cloudId = found.id;
    if (!cfg.base) cloud.writeConfig({ ...cfg, base, relay: cfg.relay || cloud.impliedRelay(base) });
    sessionStatus(migrationNote
      ? `${migrationNote} Opened from the store.`
      : 'Opened from the store — save it to keep a copy of your own.');
    migrationNote = null;
    return true;
  } catch (err) {
    sessionStatus(`That design could not be opened: ${err.message}`);
    return false;
  }
}

function joinFromFragment() {
  const found = readSessionFragment(location.hash);
  if (!found) return false;
  const cfg = cloud.readConfig();
  sessionStart({ room: found.room, relay: found.relay || cfg.relay, joining: true });
  return true;
}

// The saved addresses and name, into the panel, once.
function initSessionPanel() {
  const cfg = cloud.readConfig();
  collab.name = cfg.name;
  $('session-name').value = cfg.name;
  $('session-store').value = cfg.base;
  $('session-relay').value = cfg.relay;
  renderSessionPanel();
}

// --- the building, as a 3D file ---

$('export-glb').addEventListener('click', () => {
  const opts = {
    site: $('export-glb-site').checked,
    terrain: $('export-glb-terrain').checked,
    ceilings: $('export-glb-ceilings').checked,
  };
  const btn = $('export-glb');
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Writing…';
  // A frame's grace so the button repaints before a hundred thousand
  // triangles are copied into a buffer.
  setTimeout(() => {
    try {
      const stats = renderApi.exportStats(opts);
      const bytes = renderApi.downloadGLB('school.glb', opts);
      $('export-glb-note').textContent =
        `Wrote ${(bytes / 1048576).toFixed(1)} MB — ${stats.triangles.toLocaleString()} triangles, ` +
        `in metres, one material, colours baked into the vertices.`;
    } catch (err) {
      alert(`Could not write the model: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  }, 30);
});

// --- guided tours ---

const tourPanel = $('tour-panel');
// Which tour is selected, whether one is playing, and whether the playback is
// being recorded to a file. None of it belongs in the design — the tours do,
// the playhead does not.
let tourIndex = 0;
let tourPlay = null;
// Which stop the panel is currently highlighting, so playback repaints it
// once per stop rather than once per frame.
let tourShown = -1;
// Set for the fraction of a second between a tour running out and the
// recorder being told to stop.
let tourEnding = false;
let tourRecorder = null;
let tourChunks = [];

const tours = () => toursOf(state);
const currentTour = () => tours()[tourIndex] || null;

function setTours(list) {
  state.tours = list;
  if (!list.length) delete state.tours;
  tourIndex = Math.min(tourIndex, Math.max(0, list.length - 1));
}

function replaceTour(next) {
  const list = tours().slice();
  list[tourIndex] = next;
  setTours(list);
}

// Where the camera is, as a tour stop: position, the two angles, and which
// storey it is standing on.
function cameraStop() {
  const cam = renderApi.walkCamera;
  const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
  return {
    x: cam.position.x, y: cam.position.y, z: cam.position.z,
    yaw: e.y, pitch: e.x,
    floor: storeyAt(state, cam.position.y - EYE_H),
  };
}

function applyStop(at) {
  const cam = renderApi.walkCamera;
  cam.position.set(at.x, at.y, at.z);
  cam.quaternion.setFromEuler(new THREE.Euler(at.pitch, at.yaw, 0, 'YXZ'));
}

function renderTourPanel() {
  const list = tours();
  const pick = $('tour-pick');
  pick.textContent = '';
  list.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${t.name} — ${tourSummary(t)}`;
    pick.appendChild(o);
  });
  if (!list.length) {
    const o = document.createElement('option');
    o.value = '0';
    o.textContent = 'No tours yet';
    pick.appendChild(o);
  }
  pick.value = String(tourIndex);
  pick.disabled = !list.length;

  const tour = currentTour();
  $('tour-name').value = tour ? tour.name : '';
  $('tour-name').disabled = !tour;
  $('tour-loop').checked = !!(tour && tour.loop);
  $('tour-loop').disabled = !tour;
  // Deliberately live with no tour selected: `tourMark` starts one, so the
  // first stop you record is also the tour you didn't have to think about
  // making.
  $('tour-mark').disabled = !!tour && tour.keys.length >= MAX_KEYS;
  $('tour-play').disabled = !tour || tour.keys.length < 2;
  $('tour-record').disabled = !tour || tour.keys.length < 2 || !canRecordVideo();
  $('tour-delete').disabled = !tour;
  $('tour-play').textContent = tourPlay ? '⏹ Stop' : '▶ Play';

  const stops = $('tour-stops');
  stops.textContent = '';
  if (!tour) return;
  const at = tourPlay ? sampleTour(tour, tourPlay.t) : null;
  tour.keys.forEach((k, i) => {
    const row = document.createElement('div');
    row.className = 'stop' + (at && at.index === i ? ' at' : '');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1);
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = k.label || `Level ${k.floor + 1} · ${Math.round(k.x)}, ${Math.round(k.z)} ft`;
    where.title = i === 0
      ? 'The tour starts here'
      : `${k.sec.toFixed(1)}s to get here${k.hold ? `, then holds ${k.hold.toFixed(1)}s` : ''}`;
    const go = document.createElement('button');
    go.textContent = '↦';
    go.title = 'Stand here';
    go.addEventListener('click', () => { applyStop(k); });
    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = 'Move this stop earlier';
    up.disabled = i === 0;
    up.addEventListener('click', () => { replaceTour(moveKey(currentTour(), i, -1)); afterTourEdit(); });
    const hold = document.createElement('button');
    hold.textContent = k.hold ? `⏸${k.hold.toFixed(0)}s` : '⏸';
    hold.title = 'Wait here for another second before moving on';
    hold.addEventListener('click', () => {
      replaceTour(updateKey(currentTour(), i, { hold: (k.hold || 0) + 1 > 6 ? 0 : (k.hold || 0) + 1 }));
      afterTourEdit();
    });
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Remove this stop';
    del.addEventListener('click', () => { replaceTour(removeKey(currentTour(), i)); afterTourEdit(); });
    row.append(n, where, go, up, hold, del);
    stops.appendChild(row);
  });

  const out = $('tour-readout');
  out.textContent = '';
  const line = document.createElement('div');
  line.innerHTML = `<b>${tour.keys.length}</b> stop${tour.keys.length === 1 ? '' : 's'} · <b>${
    Math.round(tourDuration(tour) * 10) / 10}s</b>`;
  out.appendChild(line);
  if (tourRecorder) {
    const rec = document.createElement('div');
    rec.className = 'rec';
    rec.textContent = '⏺ Recording — the file downloads when the tour ends';
    out.appendChild(rec);
  }
}

function afterTourEdit() {
  autosave(state, autosaveNote);
  renderTourPanel();
  updateUndoButtons();
}

$('tour-pick').addEventListener('change', (e) => {
  tourIndex = Number(e.target.value) || 0;
  renderTourPanel();
});
$('tour-name').addEventListener('change', () => {
  const tour = currentTour();
  if (!tour) return;
  replaceTour({ ...tour, name: $('tour-name').value.slice(0, 40) || 'Tour' });
  afterTourEdit();
});
$('tour-loop').addEventListener('change', () => {
  const tour = currentTour();
  if (!tour) return;
  replaceTour({ ...tour, loop: $('tour-loop').checked });
  afterTourEdit();
});
$('tour-new').addEventListener('click', () => {
  if (tours().length >= MAX_TOURS) { alert(`A design holds ${MAX_TOURS} tours.`); return; }
  editor.pushUndo();
  const tour = makeTour(`Tour ${tours().length + 1}`);
  tour.id = state.nextId++;
  setTours(tours().concat([tour]));
  tourIndex = tours().length - 1;
  afterTourEdit();
});
$('tour-delete').addEventListener('click', () => {
  const tour = currentTour();
  if (!tour) return;
  if (tour.keys.length && !confirm(`Delete "${tour.name}"?`)) return;
  editor.pushUndo();
  setTours(tours().filter((_, i) => i !== tourIndex));
  afterTourEdit();
});
$('tour-mark').addEventListener('click', () => tourMark());

function tourMark() {
  let tour = currentTour();
  if (!tour) {
    editor.pushUndo();
    tour = makeTour('Tour 1');
    tour.id = state.nextId++;
    setTours(tours().concat([tour]));
    tourIndex = tours().length - 1;
    tour = currentTour();
  } else {
    editor.pushUndo();
  }
  replaceTour(addKey(tour, cameraStop()));
  afterTourEdit();
  $('status').textContent = `Stop ${currentTour().keys.length} recorded`;
}

// --- playback ---

function tourStart(record = false) {
  const tour = currentTour();
  if (!tour || tour.keys.length < 2) return;
  tourPlay = startPlayback(tour);
  document.body.classList.add('touring');
  if (record) startTourRecording();
  renderTourPanel();
}

function tourStop() {
  if (!tourPlay) return;
  tourPlay = null;
  tourShown = -1;
  document.body.classList.remove('touring');
  stopTourRecording();
  renderTourPanel();
}

$('tour-play').addEventListener('click', () => (tourPlay ? tourStop() : tourStart(false)));
$('tour-record').addEventListener('click', () => { if (!tourPlay) tourStart(true); });

// The video, from the canvas the tour is already being drawn on. No new
// dependency: `captureStream` plus `MediaRecorder` is the whole of it, and the
// file that comes out is a WebM anybody can drop into a video editor.
const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}
const canRecordVideo = () => !!videoType() && typeof canvas.captureStream === 'function';

function startTourRecording() {
  const type = videoType();
  if (!type) return;
  try {
    const stream = canvas.captureStream(60);
    tourChunks = [];
    tourRecorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12000000 });
    tourRecorder.ondataavailable = (e) => { if (e.data && e.data.size) tourChunks.push(e.data); };
    tourRecorder.onstop = () => {
      const blob = new Blob(tourChunks, { type });
      tourChunks = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(currentTour() || { name: 'tour' }).name.replace(/[^\w -]/g, '') || 'tour'}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      $('status').textContent = `Saved ${(blob.size / 1048576).toFixed(1)} MB of video`;
    };
    tourRecorder.start();
  } catch (err) {
    tourRecorder = null;
    alert(`Could not record: ${err.message}`);
  }
}

function stopTourRecording() {
  if (!tourRecorder) return;
  if (tourRecorder.state !== 'inactive') tourRecorder.stop();
  tourRecorder = null;
}

// One frame of a tour. Called from the main loop instead of walk.update, and
// it is the entire runtime cost of the feature: sample, pose, done.
function tourUpdate(dt) {
  if (!tourPlay) return;
  tourPlay = stepPlayback(tourPlay, dt);
  const at = sampleTour(tourPlay.tour, tourPlay.t);
  if (at) applyStop(at);
  if (!tourPlay.playing && !tourEnding) {
    // A recorder needs the last frames to have been drawn before it is asked
    // to stop, so the stop is deferred — once, which is what the flag is for.
    tourEnding = true;
    setTimeout(() => { tourEnding = false; tourStop(); }, 200);
  }
}

// --- the minimap ---

let miniOn = true;
let miniMode = 'follow';
let miniOrient = 'heading';
let miniRange = 90;
// One computed plan per storey — the expensive half, and the half that only
// changes when the design does — and one *raster* per (storey, scale), which
// is the cheap half and the one that has to follow the zoom.
//
// The scale matters more than it looks: a plan rastered at four pixels to the
// foot and then blitted at a seventh of that has hairline walls that fall
// between pixels and vanish. Drawing it at roughly the scale it will be shown
// at keeps a wall a wall, which is why the raster is keyed by a bucketed
// scale rather than drawn once and squeezed.
const MINI_SCALES = [0.25, 0.5, 1, 2, 4];
let miniPlans = new Map();   // floor -> { plan, bounds } | null
let miniRasters = new Map(); // `${floor}:${scale}` -> canvas
const miniCanvas = $('minimap');
const miniCtx = miniCanvas.getContext('2d');

// The findings, drawn on the plan. The report has sorted them worst-first
// since Phase 7 and the map has drawn a floor since Phase 9; this is the wire
// between them. `miniNav` is here rather than reused from `life.nav` because
// the crowd is not necessarily running, and what this wants out of it is the
// mesh — the rectangles a room is made of, which are what gets filled.
let miniFindings = false;
let miniMarks = [];
let miniMarkIndex = 0;
let miniMarksDirty = true;
let miniMarksPending = false;
let miniNav = null;

function invalidateMinimap() {
  miniPlans = new Map();
  miniRasters = new Map();
  // A different design is a different set of findings and a different mesh
  // under them. Both are re-derived on the next frame that needs them.
  miniNav = null;
  miniMarksDirty = true;
}

function refreshMiniMarks() {
  if (!miniFindings) { miniMarks = []; miniMarksDirty = false; return; }
  if (!miniMarksDirty) return;
  if (!report.data || report.stale) {
    // A report on a generated school is a second or two of arithmetic, and
    // this is called from inside a frame of a walkthrough. Building it here
    // would freeze the walk for as long as it takes — so the frame that
    // notices it is missing asks for it and draws without it, and the frame
    // after it arrives draws it.
    if (!miniMarksPending) {
      miniMarksPending = true;
      setTimeout(() => {
        miniMarksPending = false;
        reportBuild();
        miniMarksDirty = true;
        refreshMiniMarks();
      }, 0);
    }
    return;
  }
  miniMarks = findingMarks(report.data);
  if (miniMarkIndex >= miniMarks.length) miniMarkIndex = 0;
  miniMarksDirty = false;
  // The marks can arrive on any frame — the report the walk asked for, or one
  // the panel was already building — and the step buttons are dead until they
  // do. Whichever frame lands them is the one that turns the buttons on.
  updateMinimapButtons();
}

// The wash, the pins and the door rings. Rooms are filled through the same
// world-feet transform the plan is blitted with — `navmesh.js` cut them into
// rectangles and this is the first thing to ask it for them — and the markers
// are drawn afterwards in pixels, so a pin is the same size however far the
// map is zoomed out.
function drawMiniMarks(view, floorIndex, size) {
  const mark = markAt(miniMarks, miniMarkIndex);
  if (!mark) return;
  if (!miniNav) miniNav = buildNav(state);
  const here = markOnFloor(mark, floorIndex);
  const mesh = miniNav.mesh[floorIndex];
  if (!here.rooms.length && !here.doors.length) return;

  miniCtx.save();
  miniCtx.translate(size / 2, size / 2);
  miniCtx.rotate(view.rotation);
  miniCtx.scale(view.scale, view.scale);
  miniCtx.translate(-view.cx, -view.cz);
  miniCtx.fillStyle = markFill(mark.level);
  for (const r of here.rooms) {
    for (const t of (mesh && mesh.byRoom.get(r.id)) || []) {
      miniCtx.fillRect(t.x0, t.z0, t.x1 - t.x0, t.z1 - t.z0);
    }
  }
  miniCtx.restore();

  miniCtx.strokeStyle = markLine(mark.level);
  miniCtx.fillStyle = markLine(mark.level);
  miniCtx.lineWidth = 1.6;
  for (const r of here.rooms) {
    const node = miniNav.node(r.id);
    if (!node) continue;
    const p = worldToMini(view, node.x, node.z);
    miniCtx.beginPath();
    miniCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    miniCtx.fill();
  }
  // A doorway is a ring rather than a dot: the finding is about the hole, and
  // a filled dot on a 3ft opening covers the thing it is pointing at.
  for (const d of here.doors) {
    const p = worldToMini(view, d.x, d.z);
    miniCtx.beginPath();
    miniCtx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    miniCtx.stroke();
  }
}

function miniPlanFor(floorIndex) {
  let cached = miniPlans.get(floorIndex);
  if (cached !== undefined) return cached;
  const plan = computeFloorPlan(state, floorIndex);
  cached = plan ? { plan, bounds: miniBounds(state.floors[floorIndex], plan) } : null;
  miniPlans.set(floorIndex, cached);
  return cached;
}

// A plan's own bounds are drawn around *everything on the sheet*, which on the
// ground storey includes the trees at the far end of the car park — so "whole
// floor" on a generated school is a thumbnail of a field with a school in the
// middle of it. The map wants the storey's structure instead, which shadow.js
// already measures for the overhang check, padded enough to show the doors in
// the outside wall. The plan's bounds are the fallback for a storey that has
// no structure at all yet.
const MINI_BOUND_PAD = 12; // ft
function miniBounds(floor, plan) {
  const b = floorBounds(floor);
  if (!b) return plan.bounds;
  return {
    minX: Math.max(plan.bounds.minX, b.x0 * CELL - MINI_BOUND_PAD),
    minZ: Math.max(plan.bounds.minZ, b.y0 * CELL - MINI_BOUND_PAD),
    maxX: Math.min(plan.bounds.maxX, (b.x1 + 1) * CELL + MINI_BOUND_PAD),
    maxZ: Math.min(plan.bounds.maxZ, (b.y1 + 1) * CELL + MINI_BOUND_PAD),
  };
}

const miniScaleFor = (want) => MINI_SCALES.find((s) => s >= want) || MINI_SCALES[MINI_SCALES.length - 1];

// The raster is drawn against the *plan's* own bounds, because that is what
// blueprint.js measures its coordinates from — `record.bounds` is only what
// the view is fitted to, and using it here would slide the drawing sideways.
function miniRasterFor(floorIndex, record, scale) {
  const key = `${floorIndex}:${scale}`;
  let c = miniRasters.get(key);
  if (c !== undefined) return c;
  const b = record.plan.bounds;
  const w = Math.max(1, Math.ceil((b.maxX - b.minX) * scale));
  const h = Math.max(1, Math.ceil((b.maxZ - b.minZ) * scale));
  // A plan bigger than this is a school the size of a town; the cap keeps a
  // hostile footprint from asking for a gigabyte of canvas.
  if (w > 4000 || h > 4000) { miniRasters.set(key, null); return null; }
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, w, h);
  // No translate: blueprint.js's own `toPx` already measures from the plan's
  // bounds, so a zero margin puts the north-west corner on the origin.
  // `drawPlanBody` draws in world feet through the same layout record the
  // export sheet uses — with no margin and no title block, which is the whole
  // reason it was split out of `drawFloorPlan`.
  drawPlanBody(ctx, record.plan, { scale, margin: 0, titleH: 0 }, {
    // Furniture only when there are pixels to draw it with: at a quarter of a
    // pixel to the foot a desk is smaller than the wall beside it.
    showFurniture: scale >= 1,
    showLabels: false,
    showDimensions: false,
  });
  miniRasters.set(key, c);
  return c;
}

function drawMinimap() {
  const cam = renderApi.walkCamera;
  const floorIndex = Math.max(0, Math.min(state.floors.length - 1,
    storeyAt(state, cam.position.y - EYE_H)));
  const record = miniPlanFor(floorIndex);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = MINI_SIZE;
  if (miniCanvas.width !== size * dpr) {
    miniCanvas.width = size * dpr;
    miniCanvas.height = size * dpr;
  }
  const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
  const eye = { x: cam.position.x, z: cam.position.z, yaw: e.y };
  const view = minimapView(record ? record.bounds : null, eye,
    { size, mode: miniMode, orient: miniOrient, range: miniRange });
  const raster = record ? miniRasterFor(floorIndex, record, miniScaleFor(view.scale)) : null;

  miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  miniCtx.clearRect(0, 0, size, size);
  miniCtx.fillStyle = '#f4f2ec';
  miniCtx.fillRect(0, 0, size, size);

  if (raster) {
    // World feet straight onto the thumbnail: the same transform
    // `worldToMini` describes, handed to the canvas so the cached plan can be
    // blitted in one call.
    miniCtx.save();
    miniCtx.translate(size / 2, size / 2);
    miniCtx.rotate(view.rotation);
    miniCtx.scale(view.scale, view.scale);
    miniCtx.translate(-view.cx, -view.cz);
    const b = record.plan.bounds;
    miniCtx.drawImage(raster, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    miniCtx.restore();
  }

  // What the camera can see.
  const cone = viewCone(view, eye);
  miniCtx.beginPath();
  miniCtx.moveTo(cone.at.x, cone.at.y);
  miniCtx.lineTo(cone.left.x, cone.left.y);
  miniCtx.lineTo(cone.right.x, cone.right.y);
  miniCtx.closePath();
  miniCtx.fillStyle = 'rgba(77, 163, 255, 0.28)';
  miniCtx.fill();

  // ...and where it is standing. A triangle rather than a dot, because under
  // north-up the heading has to be readable from the marker itself.
  const at = worldToMini(view, eye.x, eye.z);
  const a = markerAngle(view, eye.yaw);
  miniCtx.save();
  miniCtx.translate(at.x, at.y);
  miniCtx.rotate(a);
  miniCtx.beginPath();
  miniCtx.moveTo(0, -6);
  miniCtx.lineTo(4.2, 5);
  miniCtx.lineTo(0, 3);
  miniCtx.lineTo(-4.2, 5);
  miniCtx.closePath();
  miniCtx.fillStyle = '#2f6fd0';
  miniCtx.strokeStyle = '#ffffff';
  miniCtx.lineWidth = 1.2;
  miniCtx.fill();
  miniCtx.stroke();
  miniCtx.restore();

  // ...and everybody else, on this storey. Smaller than the marker above and
  // in their own colour, because the question a shared plan has to answer at
  // a glance is "where is the other person", not "who is that".
  if (collab.wire) {
    for (const peer of collab.roster.onFloor(floorIndex)) {
      if (!peer.moved) continue;
      const at = worldToMini(view, peer.x, peer.z);
      if (!inView(view, peer.x, peer.z, 8)) continue;
      miniCtx.save();
      miniCtx.translate(at.x, at.y);
      miniCtx.rotate(markerAngle(view, peer.yaw));
      miniCtx.beginPath();
      miniCtx.moveTo(0, -5);
      miniCtx.lineTo(3.4, 4);
      miniCtx.lineTo(-3.4, 4);
      miniCtx.closePath();
      miniCtx.fillStyle = peer.color;
      miniCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      miniCtx.lineWidth = 1;
      miniCtx.fill();
      miniCtx.stroke();
      miniCtx.restore();
    }
  }

  // The scale bar, bottom-left, so a window of feet reads as a distance.
  const bar = scaleBar(view);
  miniCtx.strokeStyle = 'rgba(26, 32, 41, 0.75)';
  miniCtx.lineWidth = 2;
  miniCtx.beginPath();
  miniCtx.moveTo(8, size - 10);
  miniCtx.lineTo(8 + bar.px, size - 10);
  miniCtx.stroke();
  miniCtx.fillStyle = 'rgba(26, 32, 41, 0.8)';
  miniCtx.font = '9px system-ui, sans-serif';
  miniCtx.fillText(bar.label, 8, size - 14);

  if (miniFindings) {
    refreshMiniMarks();
    drawMiniMarks(view, floorIndex, size);
  }

  const note = $('minimap-note');
  const text = `Level ${floorIndex + 1} · ${describeMinimap(view)}`;
  if (note.textContent !== text) note.textContent = text;

  const caption = $('minimap-finding');
  if (!miniFindings) {
    caption.classList.add('hidden');
  } else {
    caption.classList.remove('hidden');
    const mark = markAt(miniMarks, miniMarkIndex);
    const line = mark
      ? `<span class="lv ${esc(mark.level)}">${esc(mark.level.toUpperCase())}</span> ` +
        esc(describeMark(miniMarks, miniMarkIndex, floorIndex))
      : (miniMarksDirty ? 'Reading the report…' : 'Nothing on this plan to point at.');
    if (caption.innerHTML !== line) caption.innerHTML = line;
  }
}

function updateMinimapButtons() {
  $('minimap-mode').textContent = miniMode === 'fit' ? 'Whole floor' : 'Follow';
  $('minimap-orient').textContent = miniOrient === 'heading' ? 'Heading' : 'North';
  $('minimap-in').disabled = miniMode === 'fit' || miniRange <= MIN_RANGE;
  $('minimap-out').disabled = miniMode === 'fit' || miniRange >= MAX_RANGE;
  $('minimap-findings').classList.toggle('on', miniFindings);
  $('minimap-prev').disabled = !miniFindings || miniMarks.length < 2;
  $('minimap-next').disabled = !miniFindings || miniMarks.length < 2;
  document.body.classList.toggle('minimap', miniOn);
}

function setMiniFindings(on) {
  miniFindings = on;
  miniMarksDirty = true;
  if (on) {
    $('status').textContent = report.data && !report.stale
      ? 'Findings on the plan — the map highlights one at a time, worst first.'
      : 'Reading the report…';
  }
  updateMinimapButtons();
}

function stepMiniFinding(by) {
  if (!miniFindings || !miniMarks.length) return;
  miniMarkIndex = (miniMarkIndex + by + miniMarks.length) % miniMarks.length;
  updateMinimapButtons();
}

$('minimap-findings').addEventListener('click', () => setMiniFindings(!miniFindings));
$('minimap-prev').addEventListener('click', () => stepMiniFinding(-1));
$('minimap-next').addEventListener('click', () => stepMiniFinding(1));

$('minimap-mode').addEventListener('click', () => { miniMode = nextMode(miniMode); updateMinimapButtons(); });
$('minimap-orient').addEventListener('click', () => { miniOrient = nextOrient(miniOrient); updateMinimapButtons(); });
$('minimap-in').addEventListener('click', () => {
  miniRange = Math.max(MIN_RANGE, Math.round(miniRange / 1.5));
  updateMinimapButtons();
});
$('minimap-out').addEventListener('click', () => {
  miniRange = Math.min(MAX_RANGE, Math.round(miniRange * 1.5));
  updateMinimapButtons();
});

// --- the headset ---

let xrStatus = { supported: false, reason: 'unknown', note: 'Checking for a headset…' };
let xrSession = null;

xrAvailability(navigator.xr).then((status) => {
  xrStatus = status;
  const btn = $('walk-vr');
  btn.disabled = !status.supported;
  btn.title = status.note;
  if (!status.supported) btn.textContent = '🥽 VR unavailable';
});

// The controllers, read once a frame. WebXR reports a gamepad per hand; the
// left stick walks and the right stick turns, which is the layout every VR
// application has used since the first one. A headset with one controller
// gets both jobs on it.
function readXRInput() {
  const session = xrSession;
  const out = { move: { x: 0, y: 0 }, turn: 0, sprint: false };
  if (!session) return out;
  for (const src of session.inputSources) {
    const pad = src.gamepad;
    if (!pad || !pad.axes) continue;
    // Axes 2/3 are the thumbstick on every WebXR profile that has one; 0/1
    // are the trackpad, used as a fallback for the devices that only have
    // that.
    const x = pad.axes.length > 2 ? pad.axes[2] : (pad.axes[0] || 0);
    const y = pad.axes.length > 3 ? pad.axes[3] : (pad.axes[1] || 0);
    const squeeze = pad.buttons && pad.buttons[1] && pad.buttons[1].pressed;
    if (src.handedness === 'right') {
      out.turn = x;
    } else {
      out.move.x = x;
      out.move.y = y;
    }
    if (squeeze) out.sprint = true;
    // One controller: it does both, with the stick walking and the trigger
    // sprinting, rather than leaving somebody unable to turn.
    if (session.inputSources.length === 1) {
      out.move.x = 0;
      out.move.y = y;
      out.turn = x;
    }
  }
  return out;
}

async function enterVR() {
  if (xrSession) return;
  try {
    // Walking is a prerequisite: the collider, the doors and the crowd are
    // all built by walk.enable(), and a headset uses every one of them.
    if (mode !== 'walk') setMode('walk');
    closeModal(walkOverlay);
    audio.setActive(true);
    const session = await renderApi.enterXR({
      onFrame: (dt) => {
        // The session's own clock drives everything the page loop drives,
        // minus the render call — render.js does that one itself, because in
        // XR it has to happen inside the headset's frame.
        walk.update(dt);
        audio.update(dt);
        lifeUpdate(dt);
      },
      onEnd: () => {
        xrSession = null;
        walk.disableXR();
        document.body.classList.remove('xr');
        $('walk-vr').textContent = '🥽 Enter VR';
        if (mode === 'walk') openModal(walkOverlay, $('walk-start'));
      },
    });
    xrSession = session;
    document.body.classList.add('xr');
    $('walk-vr').textContent = '🥽 Exit VR';
    walk.enableXR({
      input: readXRInput,
      // The rig stands wherever puts the head where the walker says it is —
      // see xr.js. The head's own offset comes back from render.js, because
      // the rig is the renderer's object and the headset writes the camera.
      onPose: (pose) => {
        renderApi.setXRRig({ ...rigPosition(pose, renderApi.xrHeadLocal(), pose.y), yaw: pose.yaw });
      },
    });
  } catch (err) {
    xrSession = null;
    alert(`Could not start VR: ${err.message}`);
  }
}

$('walk-vr').addEventListener('click', () => {
  if (xrSession) renderApi.exitXR();
  else enterVR();
});

// --- the scavenger hunt (Phase 11) ---
//
// Eight things hidden around the design and a panel that says roughly where.
// Nothing about it is stored: `hunt` lives as long as the page does and the
// design never learns it happened, which is the same bargain the shove
// physics strikes and for the same reason — this is something you do in a
// building, not something the building is.
//
// It runs off its own nav rather than the crowd's, because a hunt is worth
// having in a school with nobody in it, and it is rebuilt on every start so a
// wall moved since the last one is a wall the hints know about.
let hunt = null;
let huntWarm = '';          // the band last printed, so a frame that hasn't
                            // changed it doesn't rebuild the line

const huntPanel = $('hunt-panel');
const huntList = $('hunt-list');
const huntCount = $('hunt-count');
const huntWarmthEl = $('hunt-warmth');
const huntDone = $('hunt-done');

// Somewhere a person could actually stand. A hiding place is a point on the
// nav mesh, and the mesh knows about walls and knows nothing about furniture —
// so this is the filing cabinet check, and it is collide.js's own resolver
// asked whether a walker put down here would have to move.
function huntClearance() {
  const site = terrainField(state);
  const cache = new Map();
  return (x, z, floor) => {
    let c = cache.get(floor);
    if (!c) { c = buildCollider(state, floor, catalogEntry, { site }); cache.set(floor, c); }
    const out = resolvePoint(c, x, z, WALKER_R);
    return Math.hypot(out.x - x, out.z - z) < 0.05;
  };
}

function huntStop(quiet = false) {
  hunt = null;
  huntWarm = '';
  renderApi.setHunt([]);
  document.body.classList.remove('hunting');
  if (!quiet) $('status').textContent = 'Scavenger hunt ended.';
}

function huntBegin() {
  const nav = buildNav(state);
  hunt = startHunt(nav, {
    seed: 1 + Math.floor(Math.random() * 0xfffffe),
    count: DEFAULT_COUNT,
    clear: huntClearance(),
  });
  if (!hunt.places.length) {
    hunt = null;
    $('status').textContent =
      'Nothing to hide anything behind yet — draw a room or two first.';
    return false;
  }
  renderApi.setHunt(hunt.places);
  document.body.classList.add('hunting');
  huntWarm = '';
  renderHuntPanel();
  return true;
}

function renderHuntPanel() {
  if (!hunt) return;
  const sum = huntSummary(hunt);
  huntCount.textContent = `${sum.found} / ${sum.total}`;
  huntList.textContent = '';
  for (const p of hunt.places) {
    const li = document.createElement('li');
    const got = hunt.found.has(p.id);
    li.className = got ? 'found' : '';
    li.innerHTML = `<span class="ic">${p.icon}</span><span>${got ? p.name : `${p.name} — ${p.hint}`}</span>`;
    huntList.appendChild(li);
  }
  huntDone.textContent = sum.done ? 'Every one of them found. Nicely walked.' : '';
}

// Once a frame while walking. Two questions: is anything close enough to be
// found, and how close is the nearest thing that isn't.
function huntUpdate(dt) {
  if (!hunt) return;
  const at = walk.at;
  const got = checkFind(hunt, at);
  if (got) {
    audio.scoot({ x: got.x, y: at.y - 1, z: got.z }, 1);
    const sum = huntSummary(hunt);
    $('walk-hud').textContent = sum.done
      ? `Found ${got.name} — that is all eight.`
      : `Found ${got.name} — ${sum.total - sum.found} to go.`;
    renderHuntPanel();
  }
  // The band changes rarely and the distance changes every frame, so the line
  // is built once per band and only the number is written after that.
  const warm = huntWarmth(hunt, at);
  if (!warm) {
    if (huntWarm !== 'done') { huntWarm = 'done'; huntWarmthEl.textContent = ''; }
  } else {
    if (warm.key !== huntWarm) {
      huntWarm = warm.key;
      huntWarmthEl.innerHTML =
        `<span class="band ${warm.key}">${warm.label}</span> — nearest is <span id="hunt-dist"></span>ft away`;
    }
    const d = huntWarmthEl.querySelector('#hunt-dist');
    if (d) d.textContent = String(Math.round(warm.dist));
  }
  renderApi.updateHunt(at, hunt.found, dt);
}

$('walk-hunt').addEventListener('click', () => {
  if (hunt) { huntStop(); return; }
  if (huntBegin()) closeModal(walkOverlay);
});

// --- main loop ---
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  // A headset drives its own frames off its own clock (see render.js's
  // enterXR), so the page's loop does nothing at all while one is running —
  // including the render call, which has to happen inside an XR frame.
  if (renderApi.xrPresenting) return;
  if (mode === 'walk') {
    // A tour has the camera; the walker does not get a vote while one plays.
    if (tourPlay) tourUpdate(dt);
    else walk.update(dt);
    audio.update(dt);
    // A tour has the camera too, and a hunt found by a camera flying itself
    // around is not a hunt.
    if (!tourPlay) huntUpdate(dt);
  }
  // The school runs in both modes. A crowd seen from 200ft up, moving between
  // periods over a plan you are drawing, is half of what this phase is for —
  // and the other half is meeting one of them in a corridor.
  lifeUpdate(dt);
  // Everybody else in the session: their edits, their cameras and this one's,
  // on a timer of its own. Costs nothing at all when there is no session.
  if (collab.wire) sessionTick(performance.now());
  renderApi.render(dt);
  // Drawn after the 3D frame so the map is over it, and only while walking —
  // it is a thing you carry, not a thing on the drawing board.
  if (mode === 'walk' && miniOn && !document.body.classList.contains('photo')) drawMinimap();
  // The panel follows the playhead, but only when the playhead has actually
  // moved to another stop — rebuilding a list of DOM nodes sixty times a
  // second to highlight the same row is the sort of thing that shows up as a
  // dropped frame in the video being recorded.
  if (tourPlay) {
    const at = sampleTour(tourPlay.tour, tourPlay.t);
    if (at && at.index !== tourShown) { tourShown = at.index; renderTourPanel(); }
  }
}

selectTool('floor');
syncModels({ quiet: true });
updateMinimapButtons();
renderTourPanel();
renderFloorList();
renderStairReadout();
renderEnvPanel();
renderSitePanel();
renderCodePanel();
renderAudioPanel();
renderLifePanel();
audio.setWorld(state);
updateUndoButtons();
loop();
// ...and if the autosave was from before v11, say what the bake did with it.
sayIfMigrated();
// A design that arrived in the address bar, opened last so it replaces
// whatever the autosave restored rather than racing it. Three kinds of link
// can be in there now, and they are read in the order they replace things:
// a design in the link itself, a design in a store, then the session to join
// — which is last because joining hands the building over to whoever is
// already in there.
initSessionPanel();
openSharedDesign()
  .then(() => openCloudDesign())
  .then(() => joinFromFragment());

// debug/test hook
window.app = {
  get state() { return state; },
  setMode, renderApi, editor, walk,
  setPhotoMode, envChanged, audio,
  life, lifeStart, lifeStop, lifeSetDrill, lifeFollow,
  report, reportBuild,
  // --- Phase 9 ---
  syncModels, buildShareLink, enterVR,
  get tours() { return toursOf(state); },
  tourMark, tourStart, tourStop,
  get xrStatus() { return xrStatus; },
  // --- Phase 11 ---
  huntBegin, huntStop,
  get hunt() { return hunt; },
  // --- Phase 14 ---
  sessionStart, sessionLeave, sessionFlush, sendSnapshot,
  get collab() { return collab; },
  get peers() { return collab.roster.list(); },
};
