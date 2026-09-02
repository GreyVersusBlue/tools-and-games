// main.js — bootstrap and UI wiring.

import * as THREE from 'three';
import {
  createState, ROOM_COLORS, MAX_FLOORS, CELL, floorBaseY,
  floorLabel, floorShapeCount, activeFloor,
  addFloor, duplicateFloor, removeFloor, setCurrentFloor,
} from './grid.js';
import {
  totalShapeArea, nextRoomName, shapesOf, shapeArea, interiorPoint,
} from './shapes.js';
import { buildSampleSchool } from './sample.js';
import { catalogByCategory, catalogEntry, PROP_PAINTS, PROP_CATALOG, registeredRows } from './catalog.js';
import { DECOR_PACKS, packByKey, packPaint, packTypes } from './decor.js';
import { MAX_SHOVE } from './shove.js';
import { ROOM_TEMPLATES } from './templates.js';
import { initRender } from './render.js';
import { initEditor, WALL_KINDS, DOOR_KINDS } from './editor.js';
import { stairMetrics, linksFrom, elevatorsOn, RAMP_SLOPES } from './stairs.js';
import { FLOOR_FINISHES, DEFAULT_FINISH, FACADE_MATERIALS, DEFAULT_FACADE } from './finish.js';
import {
  SITE_SURFACES, SITE_MARKINGS, SITE_KINDS, surfaceEntry, markingEntry, kindEntry,
  regionArea, siteSchedule, curbPointsFor,
} from './site.js';
import { terrainField, terrainRange, ensureTerrain } from './terrain.js';
import { ROOF_STYLES, ensureRoof, normalizeRoof, isPitched, roofPlan } from './roof.js';
import {
  MOODS, applyMood, moodEntry, MONTH_NAMES, MAX_LAT, normalizeEnv, daysInMonth,
  formatClock, formatDate, formatLat, skyState,
} from './sky.js';
import { initWalkthrough } from './walkthrough.js';
import { buildNav, navSummary } from './navgraph.js';
import {
  startHunt, huntWarmth, checkFind, huntSummary, DEFAULT_COUNT,
  startLate, checkLate, lateWarmth, lateScore, lateResult,
} from './hunt.js';
import { normalizeHaunt } from './haunt.js';
import { clearGridRef, describeGridRef, reanchorGridRef } from './gridref.js';
import {
  WEATHER_MOODS, applyWeatherMood, normalizeWeather, isDefaultWeather, weatherLabel,
} from './weather.js';
import {
  blockAt, bellsBetween, nextBell, clockText, countdownText, wrapMinutes,
  normalizeSchedule,
} from './schedule.js';
import {
  makePopulation, makeContext, retargetAll, stepAgents, census, drillReport,
  bodiesOn, makeCrowdField, crowdCells, clearCrowd, normalizeLife, MAX_POP, SPEED,
} from './agents.js';
import { buildCollider, resolvePoint, WALKER_R, refreshProps } from './collide.js';
// --- Phase 21 ---
import { makeLabelGate, LABEL_MODES, sightBlockers, sightClear } from './sightline.js';
import { murmurEmitters, paScript } from './murmur.js';
// --- Phase 22 ---
import { pickAhead, carryPoint, setDown, searchCatalog, WALK_PALETTE } from './carry.js';
import { footprintOf, faceDirection } from './propplace.js';
import { addProp, getProp, wrapAngle, MAX_PROPS } from './props.js';
import { initAudio } from './audio.js';
import { doorEvents } from './sound.js';
import { roomsOnFloor, isOutside } from './acoustics.js';
import { bakeKey, unpackBake, encodeBakeText } from './bakelight.js';
import { saveBake, loadBake } from './bakestore.js';
import {
  downloadSave, loadFromFile, autosave as autosaveStore, autosaveNow, loadAutosave, clearAutosave,
  listDesigns, saveDesign, loadDesign, deleteDesign, renameDesign,
  serialize, deserialize,
} from './save-load.js';
import {
  renderFloorPlanCanvas, renderSitePlanCanvas, renderSpecSheetCanvas, downloadCanvasPNG,
  computeFloorPlan, drawPlanBody, sheetSet, renderSheetCanvas,
} from './blueprint.js';
import { INK } from './theme.js';
import { buildReport, reportCSV, codePanel, dayPanel } from './report.js';
// --- Phase 16 ---
import {
  assemblies, systemEntry, normalizeRates, emptyRates, exampleRates,
  isEmptyRates, ratesCSV, importRatesCSV, setRate, ratesSummary, CURRENCIES,
} from './rates.js';
import { costCSV } from './cost.js';
import { specCSV } from './spec.js';
import {
  phasingOf, normalizePhasing, emptyPhasing, isEmptyPhasing, phaseByStorey,
  addPhase, removePhase, movePhase, renamePhase, claimShared, assignRooms,
  phasingCSV, roomIdOf,
} from './phasing.js';
import { USES, buildingOccupancy } from './occupancy.js';
import { codeOf, normalizeCode, isDefaultCode } from './codes.js';
import {
  buildTimetable, importTimetableCSV, timetableCSV, timetablePlan, timetableSummary,
  timetableIssues, normalizeTimetable, isEmptyTimetable, bindTimetable, roomPool, rollFor,
} from './timetable.js';
import { crowdSize } from './utilisation.js';
import { isTouchCapable, joystickAxes } from './touch.js';
// --- Phase 8 ---
import {
  BANDS, SCHEMES, schemeEntry, DEFAULT_BRIEF, normalizeBrief, buildProgram, programLines,
  bandEntry,
} from './program.js';
import { parseBrief } from './brief.js';
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
// --- Phase 32 ---
import { moveStorey } from './section.js';
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
  MAX_TOURS, MAX_KEYS, MAX_NARRATION, makeTour, addKey, removeKey, moveKey, updateKey,
  toursOf, tourSummary, tourDuration, sampleTour, sampleClock, startPlayback, stepPlayback,
} from './tour.js';
import {
  MINI_SIZE, MIN_RANGE, MAX_RANGE, minimapView, worldToMini, viewCone, inView,
  markerAngle, scaleBar, nextMode, nextOrient, describeMinimap,
  findingMarks, markAt, markOnFloor, describeMark, markFill, markLine,
} from './minimap.js';
import { xrAvailability, rigPosition } from './xr.js';
import { probeWebGL, failureText } from './bootcheck.js';
import { lazy } from './lazy.js';
// --- Phase 30 ---
import { galleryCards, thumbPaths } from './gallery.js';
import { REV as OFFLINE_REV, registrable, offlineStatus, INSTALL_LABEL } from './offline.js';
import {
  fileMode, modeNote, makeFileSession, noteOpened, noteSaved, noteEdited,
  hasFile, suggestName, savePickerOptions, openPickerOptions, docTitle,
  saveHint, shouldWarnOnClose, fileErrorText, AUTOSAVE_NOTE, FILE_EXT,
} from './filestore.js';
import { demoById, demoSpot, demoEvents, demoBounds, demoCommands } from './demo.js';

// The generator is the single largest module in the tool (109 KB) and is
// wanted exactly once, when somebody presses Go in the Generate dialog — so
// it is fetched then rather than on every load. See js/lazy.js.
const generateModule = lazy(() => import('./generate.js'));
// The gallery's three schools are 90 KB of share payloads and are wanted on
// exactly one load in a browser's life — the first one. Same bargain.
const galleryStock = lazy(() => import('./gallerystock.js'));

const canvas = document.getElementById('view');
const $ = (id) => document.getElementById(id);

// --- Phase 30: the design as a document ---
//
// Declared up here rather than beside its buttons because the autosave wrapper
// below is the tool's *one* signal that a design has been edited, and it is
// called from forty places, several of which are further up this file than the
// file panel is. See filestore.js for what a session is and why the handle
// never leaves this module.
let fileSession = makeFileSession('new');
const fileWorld = fileMode({ window });

// Every autosave is also the moment the file behind the design went stale.
// Wrapping the import is one edit; marking dirty at forty call sites is forty
// chances to miss one — and the one missed is the one where somebody loses an
// afternoon. `autosaveNow` is deliberately *not* wrapped: adoptState calls it
// to write a design that has just arrived, which is clean by definition.
function autosave(st, onResult = null) {
  const next = noteEdited(fileSession);
  if (next !== fileSession) { fileSession = next; syncFileChrome(); }
  return autosaveStore(st, onResult);
}

// --- can this browser run the tool at all? ---
//
// Asked before initRender rather than after it throws, so the answer is the
// specific one ("no WebGL here") rather than the generic one the boot guard
// would otherwise show ("something threw"). The probe uses a throwaway canvas
// because a canvas hands out exactly one context and the renderer wants the
// real one. See js/bootcheck.js; index.html's guard owns __sgFail.
if (!probeWebGL(() => document.createElement('canvas'))) {
  const t = failureText('no-webgl');
  window.__sgFail?.(t.title, t.detail, t.remedy);
  throw new Error('School Generator: no WebGL context available.');
}

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

// Whether this browser had work in it decides more than the starting state:
// a first visit gets the opening moment (Phase 19), a returning one gets its
// design back and no ceremony.
const restoredAutosave = loadAutosave({ onMigrate });
let state = restoredAutosave || buildSampleSchool();

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
  // A room drawn takes the number the field was offering, so the field has to
  // offer the next one. Skipped mid-drag like everything else derived here —
  // a stroke ends in an unthrottled call, which is when the room it baked
  // actually exists to be counted.
  if (!info.throttled) suggestRoomName();
  // A hunt's hints name rooms and its hiding places stand on tiles, and a
  // structural edit is a different set of both. Rather than quietly leave
  // the hamster inside a wall somebody has just drawn, the hunt ends.
  if (hunt && info.structural !== false) huntStop();
  // Phase 27: a structural edit is a different building under the baked
  // light — the worker is cancelled outright and the picture drops back to
  // live lighting rather than showing a half-true one. Cheap when nothing
  // is baked; the keyed cache means an undo straight back is still a hit.
  if (info.structural !== false) bakeInvalidate();
  // Same for sound: a diffuser placed, a room's finish changed or a wall
  // moved all change what there is to hear and how long it rings, and both
  // answers are derived rather than stored, so re-deriving is the whole
  // update. Skipped mid-drag — a stroke ends in an unthrottled call.
  if (!info.throttled) { audio.setWorld(state); renderAudioReadout(); }
  // ...and the same for the people. The graph is derived from the model, so
  // an edited model is a stale graph — and the colliders the crowd walks
  // against were built once, from the building that used to be there.
  //
  // Phase 22's exception: a walk-mode prop placement (`propsOnly`) is an
  // obstacle, not a different building. The nav graph, the seats and
  // everyone's routes are untouched; the storey's prop colliders are
  // refreshed in place by walkPropsChanged, which reaches the crowd's
  // colliders too because they are the same objects.
  if (!info.throttled && life.on && !info.propsOnly) {
    lifeRebuildWorld();
    retargetAll(life.ctx, life.agents);
    renderLifeReadout();
  }
  // One hint, at the moment it first applies — see coachTick. After the
  // stroke lands, never during one.
  if (!info.throttled) coachTick();
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
  // The same line, riding the pointer while a stroke is live. It lingers a
  // beat after the stroke ends so a click's worth of feedback (a door cut,
  // a room named) is readable, then gets out of the way.
  onLiveMeasure: (() => {
    const chip = $('measure');
    let linger = 0;
    return (text, x, y) => {
      clearTimeout(linger);
      if (text == null) {
        linger = setTimeout(() => chip.classList.add('hidden'), 900);
        return;
      }
      chip.textContent = text;
      chip.classList.remove('hidden');
      const pad = 16;
      const cx = Math.min(x + pad, window.innerWidth - chip.offsetWidth - 8);
      const cy = Math.min(y + pad, window.innerHeight - chip.offsetHeight - 8);
      chip.style.transform = `translate(${cx}px, ${cy}px)`;
    };
  })(),
  // Phase 25: the vertical-link panel lists what is on the storey and lights
  // whichever one is selected, so a selection made on the plan has to reach it.
  onStairSelect: () => { if (editor.tool === 'stair') renderStairList(); },
  onHoleMode: (on) => {
    $('hole-btn').classList.toggle('on', on);
    $('hole-btn').setAttribute('aria-pressed', String(on));
  },
  // The overlay tool has taken a measurement and wants to know what it is.
  // The dialog belongs to the shell, not to the tool — same division of
  // labour every other prompt in this file follows.
  onMeasure: (a, b) => askMeasurement(a, b),
  // Phase 38: the annotation panel edits the selected note's sentence, so a
  // selection made on the plan has to reach it — the stair panel's deal.
  onAnnoSelect: () => { if (editor.tool === 'anno') renderAnnoPanel(); },
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

// --- room labels earned by sight (Phase 21) ---
//
// The mode is a session decision that lives in the tool, never the file — a
// browser preference like the walk overlay's disclosure. The *gate* is per
// walk: built fresh in setMode('walk') so what a walk has learned lasts
// exactly as long as its colliders do, and no longer.
const LABEL_MODE_TEXT = {
  earned: 'Room labels: earned — a room joins the map when you first see its door',
  strict: 'Room labels: line of sight only',
  all: 'Room labels: all',
  none: 'Room labels: none',
};
let labelMode = 'earned';
try {
  const kept = localStorage.getItem('sg-labels');
  if (LABEL_MODES.includes(kept)) labelMode = kept;
} catch { /* fine */ }
let labelGate = null;
renderApi.setLabelMode(labelMode);
// One closure for the whole session; setMode only swaps what it reads.
renderApi.setLabelGate((floorIndex, roomId) =>
  (labelGate ? labelGate.visible(floorIndex, roomId, labelMode) : false));

function setLabelMode(m) {
  labelMode = LABEL_MODES.includes(m) ? m : 'earned';
  renderApi.setLabelMode(labelMode);
  try { localStorage.setItem('sg-labels', labelMode); } catch { /* fine */ }
  if (mode === 'walk') walkHud.textContent = LABEL_MODE_TEXT[labelMode];
}

const cycleLabelMode = () =>
  setLabelMode(LABEL_MODES[(LABEL_MODES.indexOf(labelMode) + 1) % LABEL_MODES.length]);

// A few sight casts, once a frame while walking. The leaves handed over are
// the walk collider's own — an agent holding a door open is exactly the
// opening the gate should see through.
function labelGateUpdate() {
  if (!labelGate || (labelMode !== 'earned' && labelMode !== 'strict')) return;
  const at = walk.at;
  labelGate.update({ x: at.x, z: at.z, floor: at.floor },
    walk.colliderAt(at.floor).doors, labelMode);
}

// --- hands (Phase 22) ---
//
// In walk mode you had feet and no hands. The pure half is carry.js — picking
// along the view ray, the same three snap tiers the editor gets, and an
// overlap-only fitting test; this block is the thin tool on top: the carry
// slot, the ghost, the keys, and the part that makes a walk placement a real
// edit. Structure stays edit-only; furniture is now something you can do from
// inside the building.
//
// `hands` is the slot: null, { kind: 'move', id, ... } for a prop picked up
// off the floor, or { kind: 'add', type } for a fresh one off the walk
// palette. Like every selection, it lives in the tool and never in the file —
// what reaches the file is only a committed set-down.
let hands = null;
let handsTarget = null;   // last frame's setDown answer, plus its storey

const HANDS_OK = 0x7ce0a0;
const HANDS_BAD = 0xff5f56;
const HANDS_ROT = Math.PI / 12; // 15°, the editor's own rotate step

// The ghost is the editor's placement ghost grown a walk-mode job: footprint
// plane plus a "front" tick, standing at the snapped set-down spot, green
// when it fits and red when it overlaps.
const handsGhost = new THREE.Group();
const handsGhostMat = new THREE.MeshBasicMaterial({
  color: HANDS_OK, transparent: true, opacity: 0.35, depthTest: false,
});
{
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  planeGeo.rotateX(-Math.PI / 2);
  const plane = new THREE.Mesh(planeGeo, handsGhostMat);
  plane.renderOrder = 620;
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.35, 0, 0, 0.35, 0, 0, 0, 0, 0.7], 3));
  tickGeo.setIndex([0, 1, 2]);
  const tick = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial({
    color: 0x1c2430, transparent: true, opacity: 0.85, depthTest: false,
  }));
  tick.renderOrder = 621;
  tick.name = 'tick';
  handsGhost.add(plane, tick);
  handsGhost.visible = false;
  renderApi.scene.add(handsGhost);
}

// Transient walk-mode feedback rides the HUD line, the way the label-mode
// announcement does — the next real HUD change takes it back.
const walkSay = (text) => { walkHud.textContent = text; };

// The invalidation clause, in one place. A prop was placed, removed or picked
// up, so every collider a body is resolving against re-derives its prop
// obstacles from the design — the walker's own cache, and, when a crowd is
// running, the shared per-storey colliders the camera and the agents already
// resolve against (one refresh reaches both, because they are the same
// objects). Walls and door leaves stay exactly what they were.
function walkPropsChanged(opts = {}) {
  if (life.on && life.colliders) {
    for (const c of life.colliders.values()) refreshProps(state, c, catalogEntry, opts);
  }
  walk.propsChanged(opts);
}

const handsEntry = () => (hands
  ? catalogEntry(hands.kind === 'add' ? hands.type : (getProp(state, hands.id) || {}).type)
  : null);

const _handsDir = new THREE.Vector3();
function handsView() {
  renderApi.walkCamera.getWorldDirection(_handsDir);
  return { x: _handsDir.x, z: _handsDir.z };
}

// Once a frame while carrying: where would it land, and does it fit. The
// carried prop is the *real* prop (or, for a palette piece, only the ghost)
// posed at the answer — you are looking at exactly what a set-down commits.
function handsUpdate() {
  if (!hands || mode !== 'walk' || photoMode || tourPlay) {
    handsGhost.visible = false;
    return;
  }
  const entry = handsEntry();
  if (!entry) { handsReset(); return; }
  const at = walk.at;
  const dir = handsView();
  const p = carryPoint({ x: at.x, z: at.z }, dir);
  const prop = hands.kind === 'move' ? getProp(state, hands.id) : null;
  handsTarget = setDown(
    state.floors[at.floor], walk.colliderAt(at.floor), state.props, at.floor,
    entry, prop, p.x, p.z, hands.rotationY,
    { catalogGet: catalogEntry, tol: 0.9, excludeId: prop ? prop.id : undefined });
  handsTarget.floor = at.floor;
  const { hw, hd } = footprintOf(entry, prop);
  const baseY = floorBaseY(state, at.floor);
  handsGhost.visible = true;
  handsGhost.position.set(handsTarget.x, baseY + 0.1, handsTarget.z);
  handsGhost.rotation.y = handsTarget.rotationY;
  handsGhost.children[0].scale.set(hw * 2, 1, hd * 2);
  handsGhost.getObjectByName('tick').position.set(0, 0.02, hd);
  handsGhostMat.color.setHex(handsTarget.clear ? HANDS_OK : HANDS_BAD);
  if (hands.kind === 'move' && prop) {
    renderApi.moveProps([{
      id: prop.id, x: handsTarget.x, z: handsTarget.z,
      y: baseY + (prop.y || 0), rotationY: handsTarget.rotationY,
    }]);
  }
}

// Q with empty hands: pick up whatever the view is pointing at, within reach.
function handsPick() {
  const at = walk.at;
  const hit = pickAhead(state.props, at.floor, catalogEntry,
    { x: at.x, z: at.z }, handsView());
  if (!hit) { walkSay('Nothing in reach to pick up.'); return; }
  const entry = catalogEntry(hit.type);
  hands = { kind: 'move', id: hit.id, rotationY: hit.rotationY || 0 };
  // The spot it was standing on stops blocking the moment it is in your
  // hands — for you and for the crowd.
  walkPropsChanged({ skipId: hit.id });
  walkSay(`Carrying ${entry ? entry.name : hit.type} — Q sets it down, R turns it, X puts it back.`);
}

// Q with full hands: the set-down. Refused only for overlap — a barricade is
// a legal placement, and the fire drill will tell you what it did. A commit
// is a props edit like any other: it closes into the same undo history,
// autosaves, and travels to a session peer, exactly as if propedit had done
// it — where a shove stays a session fact and never touches the file.
function handsPlace() {
  const t = handsTarget;
  const entry = handsEntry();
  if (!t || !entry) return;
  if (!t.clear) {
    walkSay(entry.mount === 'wall'
      ? 'A wall piece needs a wall — face one, within reach.'
      : "It won't fit there — it overlaps something.");
    return;
  }
  editor.pushUndo();
  let name = entry.name;
  if (hands.kind === 'move') {
    const p = getProp(state, hands.id);
    if (!p) { handsReset(); return; }
    p.x = t.x;
    p.z = t.z;
    p.rotationY = wrapAngle(t.rotationY);
    p.floor = t.floor;
    p.mount = t.mount;
  } else {
    if (state.props.length >= MAX_PROPS) { walkSay('Prop limit reached — nothing placed.'); return; }
    const added = addProp(state, hands.type, {
      floor: t.floor, x: t.x, z: t.z, y: entry.y || 0,
      rotationY: wrapAngle(t.rotationY), mount: t.mount, scale: 1,
    });
    if (!added) { walkSay('Could not place that.'); return; }
  }
  hands = null;
  handsTarget = null;
  handsGhost.visible = false;
  designChanged({ structural: false, propsOnly: true });
  walkPropsChanged();
  walkSay(`${name} set down${t.kind !== 'free' ? ` — snapped to ${t.kind}` : ''}.`);
}

const handsAction = () => (hands ? handsPlace() : handsPick());

// 1–8: the walk palette, a short ring of favourites, one per digit. 9 opens
// the whole catalog (Phase 36) — both roads end here, arming the carry slot
// with a fresh piece; nothing exists anywhere until it is set down.
function handsArmType(type) {
  const entry = type ? catalogEntry(type) : null;
  if (!entry) return;
  if (hands && hands.kind === 'move') {
    walkSay('Hands full — Q sets it down, X puts it back.');
    return;
  }
  const dir = handsView();
  hands = {
    kind: 'add', type,
    rotationY: hands ? hands.rotationY : faceDirection(dir.x, dir.z),
  };
  walkSay(`In hand: ${entry.name} — Q sets it down, R turns it, X empties your hands. 1–8 picks another, 9 the whole catalog.`);
}

const handsArm = (i) => handsArmType(WALK_PALETTE[i]);

function handsRotate(delta) {
  if (!hands) return;
  hands.rotationY = wrapAngle(hands.rotationY + delta);
}

// X: change your mind. A picked-up prop never left the file, so putting it
// back is putting the *instance* back where the design says it stands; a
// palette piece simply never was.
function handsCancel() {
  if (!hands) return;
  if (hands.kind === 'move') {
    const p = getProp(state, hands.id);
    if (p) {
      renderApi.moveProps([{ id: p.id, x: p.x, z: p.z, rotationY: p.rotationY }]);
    }
  }
  handsReset();
  walkPropsChanged();
  walkSay('Hands empty.');
}

// The quiet reset — leaving walk mode, or a carried prop vanishing under an
// undo that arrived from a peer.
function handsReset() {
  hands = null;
  handsTarget = null;
  handsGhost.visible = false;
}

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
  // The body class hides the keyboard sheet; the hint line replaces it with
  // the four gestures a thumb actually has.
  document.body.classList.add('touch');
  $('walk-start').textContent = 'Tap to Walk';
  $('walk-controls-hint').innerHTML =
    'Left joystick to move &nbsp;·&nbsp; drag anywhere else to look<br />' +
    '🏃 toggles sprint &nbsp;·&nbsp; ⤒ jumps &nbsp;·&nbsp; 🛗 calls the lift<br />' +
    '👥 Life fills the building with people<br />' +
    '✕ (top right) exits';
}

// --- initial view ---
renderApi.fitEditView(state);
renderApi.resize();
rebuild();

// --- mode toggle ---
const walkOverlay = $('walk-overlay');

// The overlay's prose is behind a disclosure. It arrives open the first time
// this browser ever sees the walkthrough and closed after that — the keys
// grid is what a returning visitor needs, and it fits without scrolling.
function openWalkOverlay() {
  const more = $('walk-more');
  let seen = false;
  try { seen = localStorage.getItem('sg-walk-seen') === '1'; } catch { /* fine */ }
  if (more) more.open = !seen;
  try { localStorage.setItem('sg-walk-seen', '1'); } catch { /* fine */ }
  // The start-point row is read off the storey every time the overlay opens:
  // rooms get drawn, named and deleted between one walk and the next.
  renderSpawnPanel();
  openModal(walkOverlay, $('walk-start'));
}
let mode = 'edit';

// --- Phase 27: light that stops at walls ---
//
// The bake belongs to the walk: entering walk mode asks for one, and the
// renderer wears it the moment it exists. The editor never sees it — a
// drafting table wants legible light, and every structural edit would
// invalidate it anyway. The pieces:
//
//   bakelight.js   the illumination model, pure, in a worker
//   bakeworker.js  the thread it runs on — terminated, never asked, when a
//                  structural edit lands
//   bakestore.js   IndexedDB beside the autosave, keyed on the structural
//                  hash, so re-walking an unchanged building is a cache hit
//
// `bakeObtain` is the one path: memory, then the store, then the worker —
// the walk and the export both go through it, which is why an export made
// after a walk splices the very bake the walk was wearing.
const bake = { key: null, packed: null, data: null, worker: null };
let bakeFlight = null;   // { key, p } — the one in-flight obtain

function bakeCancel() {
  if (bake.worker) {
    bake.worker.terminate();
    bake.worker = null;
  }
}

// Any structural edit: the worker dies mid-cast, the walk (if one is on)
// drops back to live lighting rather than wearing a half-true picture. The
// memory cache stays — it is keyed, and an undo straight back is a hit.
function bakeInvalidate() {
  bakeCancel();
  renderApi.setBake(null);
  if (mode === 'walk') bakeEnsure();
}

// The worker run, as a promise: packed bake, or null for a build that
// failed or was cancelled — both of which mean "stay live", never "throw".
function bakeRun(key) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./bakeworker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);   // no module workers — the live path is the picture
      return;
    }
    bake.worker = worker;
    const finish = (packed) => {
      if (bake.worker === worker) bake.worker = null;
      worker.terminate();
      resolve(packed);
    };
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') {
        $('status').textContent = `Baking light — ${Math.round(msg.frac * 100)}%`;
      } else if (msg.type === 'done') {
        finish(msg.bake && msg.bake.key === key ? msg.bake : null);
      } else if (msg.type === 'error') {
        $('status').textContent = `Light bake failed — staying live. (${msg.message})`;
        finish(null);
      }
    };
    worker.onerror = () => finish(null);
    worker.postMessage({ design: serialize(state, { omitOverlay: true, omitModels: true }) });
    $('status').textContent = 'Baking light…';
  });
}

// A packed bake for this structural key: memory, then the store, then the
// worker. Adopts and stores whatever it finds, so the next asker is cheaper.
function bakeObtain(key) {
  if (bake.packed && bake.key === key) return Promise.resolve(bake.packed);
  if (bakeFlight && bakeFlight.key === key) return bakeFlight.p;
  bakeCancel();
  const p = (async () => {
    const stored = await loadBake(key);
    if (stored) {
      const data = unpackBake(stored);
      if (data && data.key === key) {
        bake.key = key; bake.packed = stored; bake.data = data;
        return stored;
      }
    }
    // Still wanted? A structural edit while the store answered means this
    // key no longer names the building.
    if (bakeKey(state, catalogEntry) !== key) return null;
    const packed = await bakeRun(key);
    if (!packed) return null;
    const data = unpackBake(packed);
    if (!data) return null;
    bake.key = key; bake.packed = packed; bake.data = data;
    saveBake(packed);   // fire and forget — a refusal is weather
    return packed;
  })();
  bakeFlight = { key, p };
  p.finally(() => { if (bakeFlight && bakeFlight.p === p) bakeFlight = null; });
  return p;
}

async function bakeEnsure() {
  const key = bakeKey(state, catalogEntry);
  const packed = await bakeObtain(key);
  if (!packed || mode !== 'walk') return;
  if (bakeKey(state, catalogEntry) !== key) return;   // it moved on
  renderApi.setBake(bake.data);
  $('status').textContent = 'Light baked in — walls cast, corridors pool, rooms go dark.';
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  renderApi.setMode(m);
  document.body.dataset.mode = m;
  if (m === 'walk') {
    editor.setEnabled(false);
    walk.enable(state);
    doorState = new Map();
    // A fresh walk starts with a fresh memory of what it has seen.
    labelGate = makeLabelGate(state);
    if (life.on) walk.setBodies((i) => bodiesOn(life.agents, i));
    audio.setWorld(state);
    // The map is drawn from the plan, and the plan may have changed since the
    // last walk.
    invalidateMinimap();
    updateMinimapButtons();
    renderTourPanel();
    // Phase 27: ask for the baked light — a cache hit wears it now, a fresh
    // building bakes in the worker and wears it when it lands.
    bakeEnsure();
    openWalkOverlay();
    closeModal($('designs-overlay'));
    closeModal($('export-overlay'));
    $('mode-btn-label').textContent = 'Edit Mode';
    $('mode-btn-icon').setAttribute('href', '#i-pencil');
  } else {
    setPhotoMode(false);
    tourStop();
    document.body.classList.remove('tours');
    walk.setFollow(null);
    walk.disable();
    labelGate = null;
    // Anything still in hand goes back where the file says it stands —
    // render.js's restoreProps does the visual half on the same mode switch.
    handsReset();
    audio.setActive(false);
    // The PA's voice rides outside the audio graph, so it has to be shown
    // the door separately.
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch { /* gone */ } }
    closeModal(walkOverlay);
    document.body.classList.remove('touch-walk');
    document.body.classList.remove('drag-walk');
    resetTouchWalkUI();
    editor.setEnabled(true);
    $('mode-btn-label').textContent = 'Walk Through';
    $('mode-btn-icon').setAttribute('href', '#i-walk');
  }
  if (!lifePanel.classList.contains('hidden')) renderLifePanel();
}

// --- where the walk starts (Phase 26) ---
//
// Every walk before this one began in the same place: the deepest point inside
// the storey's biggest room. That is a good guess and a bad rule — the biggest
// room in a school is the gym, and "show me the entrance" then costs you the
// length of the building at 12 ft/s, every single time.
//
// So a storey can carry a start point. It is one record on the floor
// (`floor.spawn`, additive in the save file exactly like `floor.walls`), and
// there are two ways to set it, because there are two ways people think about
// where they want to be: *by room* — a list you pick "Gymnasium" out of — and
// *by standing there* — you walked to the front door, and the front door is
// where you want to arrive next time. Both write the same three numbers.
const spawnRoomSel = $('walk-spawn-room');

// Rooms on the storey, biggest first, so the list opens with the ones somebody
// is likely to want and the cupboards are at the bottom.
function spawnRooms() {
  return shapesOf(activeFloor(state))
    .map((sh) => ({ sh, area: shapeArea(sh) }))
    .filter((r) => r.area > 0)
    .sort((a, b) => b.area - a.area);
}

function renderSpawnPanel() {
  const f = activeFloor(state);
  const spawn = f && f.spawn;
  const rooms = spawnRooms();
  spawnRoomSel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    spawnRoomSel.appendChild(o);
  };
  add('', rooms.length
    ? `the biggest room — ${rooms[0].sh.name || 'unnamed'}`
    : 'the middle of the level');
  for (const { sh, area } of rooms) {
    add(String(sh.id), `${sh.name || 'Room'} — ${Math.round(area).toLocaleString()} ft²`);
  }
  // A point somebody stood on rather than a room they named has no id to
  // select, so the list grows an entry for it while it exists.
  if (spawn && !spawn.room) add('spot', 'the spot you chose');
  spawnRoomSel.value = spawn ? (spawn.room ? String(spawn.room) : 'spot') : '';
  // ...and if the room it named has since been deleted, the record is still a
  // point and still where the walk starts; say so rather than silently
  // showing the default.
  if (spawn && spawn.room && spawnRoomSel.value !== String(spawn.room)) {
    add('spot', 'the spot you chose');
    spawnRoomSel.value = 'spot';
  }
  $('walk-spawn-where').textContent = spawn
    ? `${floorLabel(state.currentFloor)} starts at ${Math.round(spawn.x)}, ${Math.round(spawn.z)} ft.`
    : `${floorLabel(state.currentFloor)} has no start point of its own — pick a room, ` +
      'or walk somewhere and say "start here".';
  $('walk-spawn-clear').disabled = !spawn;
}

// Write one. `move` is whether the walker should be stood on it now — true
// when the point was chosen from the room list (you asked to be somewhere
// else), false when it was taken from where the walker already is.
function setSpawn(spawn, { floor = state.currentFloor, move = true } = {}) {
  const f = state.floors[floor];
  if (!f) return;
  if (spawn) f.spawn = spawn; else delete f.spawn;
  autosave(state);
  renderSpawnPanel();
  if (move && floor === state.currentFloor) walk.respawn();
}

spawnRoomSel.addEventListener('change', () => {
  const v = spawnRoomSel.value;
  if (v === 'spot') { renderSpawnPanel(); return; }   // already the spot
  if (!v) { setSpawn(null); $('status').textContent = 'Walks start in the biggest room again.'; return; }
  const room = shapesOf(activeFloor(state)).find((sh) => String(sh.id) === v);
  if (!room) { renderSpawnPanel(); return; }
  const p = interiorPoint(room);
  // Facing is kept from whatever was there, or squared to the grid — a room
  // has no natural direction to look in, and guessing one badly is worse than
  // looking north.
  const was = activeFloor(state).spawn;
  setSpawn({ x: p.x, z: p.z, yaw: was ? was.yaw : 0, room: room.id });
  $('status').textContent = `Walks of ${floorLabel(state.currentFloor)} start in ${room.name || 'that room'}.`;
});

$('walk-spawn-here').addEventListener('click', () => {
  const at = walk.standing;
  if (!at || !state.floors[at.floor]) return;
  setSpawn({ x: at.x, z: at.z, yaw: at.yaw }, { floor: at.floor, move: false });
  $('status').textContent = at.floor === state.currentFloor
    ? `Walks of ${floorLabel(at.floor)} will start here, facing this way.`
    : `${floorLabel(at.floor)} will start here — you walked up, so that is the ` +
      `storey it was recorded on.`;
});

$('walk-spawn-clear').addEventListener('click', () => {
  setSpawn(null);
  $('status').textContent = 'Walks start in the biggest room again.';
});

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
    // Pointer Lock can simply not happen: an iframe without
    // `allow="pointer-lock"`, a browser that refuses, a dismissed permission.
    // `lock()` reports none of that — it returns nothing and the `lock` event
    // never fires — so the only honest test is to look a moment later. If the
    // pointer is not ours by then, walk anyway: drag to look, WASD to move.
    setTimeout(() => {
      if (mode !== 'walk' || walk.controls.isLocked || isTouch) return;
      startMouseLookWalk();
    }, 400);
  }
});

// The eight keys that mean "walk". WASD and the arrows, which walkthrough.js
// treats as the same four (see MOVE_ALIAS there).
const WALK_MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

// The fallback walk. Not offered as a choice — Pointer Lock is the better
// gesture and is always asked for first — but never left as a dead end either.
function startMouseLookWalk(why = 'refused') {
  if (walk.mouseLook) return;
  walk.enableMouseLook(true);
  document.body.classList.add('drag-walk');
  $('walk-drag-note').classList.remove('hidden');
  $('walk-start').textContent = 'Drag to Walk';
  closeModal(walkOverlay);
  $('status').textContent =
    'Walking — drag to look, WASD or the arrows to move, Shift to run, Space to jump.' +
    (why === 'refused'
      ? ' Your browser would not hand over the pointer, so the mouse steers by drag.'
      : '');
}

// A drag on the canvas in walk mode, when nothing is armed, means the same
// thing a movement key does: walk. Capture phase, so this runs before
// walkthrough.js's own look handler on the same element and the drag that
// arms the fallback is also the drag that turns the camera — otherwise the
// first gesture is always swallowed.
$('view').addEventListener('pointerdown', (e) => {
  if (mode !== 'walk' || isTouch || photoMode) return;
  if (walk.controls.isLocked || walk.mouseLook) return;
  if (e.pointerType === 'touch' || e.button !== 0) return;
  if (!walkOverlay.classList.contains('hidden')) return;   // the overlay is up
  startMouseLookWalk('drag');
}, true);

// A refused request arrives here rather than as a missing `lock` event, on the
// browsers that report it at all.
document.addEventListener('pointerlockerror', () => {
  if (mode === 'walk' && !isTouch) startMouseLookWalk();
});
$('walk-exit').addEventListener('click', () => setMode('edit'));
$('touch-exit').addEventListener('click', () => setMode('edit'));

walk.controls.addEventListener('lock', () => {
  // The real thing arrived after all — put the fallback away.
  walk.enableMouseLook(false);
  document.body.classList.remove('drag-walk');
  $('walk-drag-note').classList.add('hidden');
  $('walk-start').textContent = 'Click to Walk';
  closeModal(walkOverlay);
});
walk.controls.addEventListener('unlock', () => {
  // In photo mode the released pointer is the point — you let it go to reach
  // the lens controls — so the overlay stays down. Same when the command
  // palette or the catalog picker asked for the pointer: each hands the
  // overlay back itself.
  if (mode === 'walk' && !photoMode && !cmdkIsOpen() && !walkPickIsOpen()) openWalkOverlay();
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
  // The thirteenth ran out of number row; backslash sits under Backspace on
  // the keyboards the row runs out on.
  Backslash: 'section', IntlBackslash: 'section',
  // ...and the fourteenth takes the quote key, unclaimed until now.
  Quote: 'anno',
};
const HINTS = {
  floor: 'Floor — drag out a rectangle of grid tiles. R switches to the brush. Tiles join the room they can walk to, or start one.',
  wall: 'Wall — click one end, then the other; the run you draw is the wall you get. S squares it to the grid, Alt draws off the grid, Esc stops the run. G switches between solid, glass and railing.',
  door: 'Door — pick single, double, cased opening or window, then click anywhere along a wall you have already drawn. Draw the four walls first, then cut the openings. Clicking the same kind again removes it.',
  room: 'Room — pick a name, color, floor finish and wall paint, then click a room to apply them',
  erase: 'Eraser — click anything to delete it: a wall, a staircase, a lift, a ramp, a floor opening, a piece of furniture, a whole room. Drag out a rectangle to clear floor instead, or switch to the brush with R.',
  poly: 'Polygon — click to place corners, click the first one (or Enter) to close. Alt = ignore snapping, Shift = 15° steps.',
  vertex: 'Shape — click a room to select it, Shift-click to select several. Drag a corner, Alt-click removes one. Delete removes the selection, R/⇧R rotates it 90°, M mirrors it, Ctrl+C/V/D copy/paste/duplicate it (with any props inside).',
  prop: 'Furniture — pick a piece, click to place. Click/drag a piece to move it, drag empty space to box-select. R rotates, Delete removes, Ctrl+C/V/D copy/paste/duplicate.',
  stair: 'Vertical — stairs, ramps, elevators and plain floor openings. Click to place one up to the next level. R rotates, drag to move, Delete removes.',
  template: 'Layout — pick a preset, click to stamp its whole furniture list at once. R/⇧R rotates it before you place it.',
  site: 'Site — lay hardscape and fields, or grade the ground. Region: click corners, close the loop. Grade: drag to raise, ⇧ to lower, Alt to smooth.',
  overlay: 'Overlay — a plan or a sketch to trace over. Load an image, measure something you know the length of, say what it is, and the picture is scaled to match. Drag to move, R to turn.',
  section: 'Section — click one end of the cut, then the other; the drawn line prints on the plan and its cut prints with the set. Click a drawn line to remove it, Esc stops the gesture.',
  anno: 'Annotate — dimensions and notes that print with the sheet. Dimension: two anchors, then where the line stands; the number is measured, never typed. Chain: click a wall for its openings and piers end to end. Note: a point, a leader, a sentence.',
};

// --- one hint at a time (Phase 19) ---
//
// The per-tool panels used to teach with a block of kbd rows — everything at
// once, which is the same as nothing. The rows are now folded behind a
// "Keys & tips" disclosure in index.html, and this is the other half: the
// single next-useful hint, surfaced on the status line at the moment it
// first applies (first prop placed → "R rotates"), once per browser. Said
// hints live in localStorage because what somebody has already been told is
// a fact about their browser, never about a design.
const COACH_KEY = 'sg-hints-said';
let coachSaid = {};
try { coachSaid = JSON.parse(localStorage.getItem(COACH_KEY) || '{}'); } catch { coachSaid = {}; }

function coach(key, text) {
  if (coachSaid[key]) return false;
  coachSaid[key] = 1;
  try { localStorage.setItem(COACH_KEY, JSON.stringify(coachSaid)); } catch { /* fine */ }
  $('status').textContent = `💡 ${text}`;
  return true;
}

// The milestones, checked after an edit lands. Each is cheap arithmetic on
// the state, guarded by the tool that just did the thing — so the hint
// arrives exactly when its subject is on the board, and never again.
function coachTick() {
  const t = editor.tool;
  const props = (state.props || []).length;
  if (t === 'prop' && props === 1) {
    coach('prop-first', 'First piece placed. R rotates it, drag moves it, Delete removes it.');
    return;
  }
  if (t === 'prop' && props === 4) {
    coach('prop-many', 'Drag across empty floor to box-select — Ctrl+C/V/D copy, paste and duplicate.');
    return;
  }
  if (t === 'stair' && linksFrom(state, state.currentFloor).length === 1) {
    coach('stair-first', 'Drag the run to move it. The blue outline is the hole it opens in the level above.');
    return;
  }
  if (t === 'door') {
    const doors = state.floors.reduce((n, fl) => n + (fl.shapes || []).reduce(
      (m, sh) => m + sh.rings.reduce((k, r) => k + r.openings.length, 0), 0), 0);
    if (doors === 1) {
      coach('door-first', 'Click the same spot again to remove it — a different kind swaps it.');
      return;
    }
  }
  if (t === 'wall') {
    coach('wall-first', 'G cycles solid / glass / railing, and , or . bends a wall into an arc.');
    return;
  }
  if (state.floors.length === 2) {
    coach('floor-second', '[ and ] switch storeys — the level below ghosts through so walls line up.');
  }
}

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
  // The floor tool and the eraser share one panel: they draw and undraw the
  // same cells, so one rectangle/brush switch governs both.
  $('floor-tool-panel').classList.toggle('hidden', t !== 'floor' && t !== 'erase');
  $('door-panel').classList.toggle('hidden', t !== 'door');
  $('stair-panel').classList.toggle('hidden', t !== 'stair');
  $('template-panel').classList.toggle('hidden', t !== 'template');
  $('site-panel').classList.toggle('hidden', t !== 'site');
  $('overlay-panel').classList.toggle('hidden', t !== 'overlay');
  $('anno-panel').classList.toggle('hidden', t !== 'anno');
  if (t === 'wall') renderWallModes();
  if (t === 'door') renderDoorModes();
  if (t === 'floor' || t === 'erase') renderFloorModes();
  if (t === 'stair') renderStairReadout();
  if (t === 'site') renderSitePanel();
  if (t === 'overlay') renderOverlayPanel();
  if (t === 'anno') renderAnnoPanel();
  // Hole mode is sticky, so coming back to the polygon tool has to say which
  // of the two things a loop is going to do.
  $('status').textContent = t === 'poly' && editor.holeMode
    ? 'Cut hole — draw a loop inside a polygon room to carve an opening out of it.'
    : HINTS[t];
}

$('hole-btn').addEventListener('click', () => editor.setHoleMode(!editor.holeMode));

// --- how the drawing tools aim (Phase 25) ---
//
// Two toggles, one shape: a pair of buttons where exactly one is pressed, and
// a readout under the wall's pair that says what the grid is doing right now.
// Both settings live on the editor rather than on the design — they are
// decisions about the drawing session, not facts about the building.
function renderWallModes() {
  const on = editor.wallOrtho;
  $('wall-ortho').setAttribute('aria-pressed', String(on));
  $('wall-free').setAttribute('aria-pressed', String(!on));
  renderGridReadout();
}
function renderGridReadout() {
  const p = editor.gridPitch;
  const ft = p >= 1 ? `${p} ft` : `${Math.round(p * 12)} in`;
  // Phase 35: the grid has an origin as well as a pitch, and a grid that is
  // not where you expect it is exactly the thing a readout is for.
  const r = editor.gridRef;
  const ref = r
    ? `<br />Counted from the reference point${r.u === undefined ? '' : ' on the tracing image'}.`
    : '';
  $('wall-grid-readout').innerHTML =
    `Snapping to a <strong>${ft}</strong> grid — it gets finer as you zoom in, ` +
    'down to 2 ft.' + ref +
    (editor.wallOrtho ? '<br />Hold <kbd>Shift</kbd> for one run off the square.' : '');
}
$('wall-ortho').addEventListener('click', () => { editor.setWallOrtho(true); renderWallModes(); });
$('wall-free').addEventListener('click', () => { editor.setWallOrtho(false); renderWallModes(); });

// The door tool's pair (Phase 36): whether an opening slides along its wall
// in grid steps or freely. Same shape, same rule — session state, never saved.
function renderDoorModes() {
  const on = editor.doorSnap;
  $('door-snap').setAttribute('aria-pressed', String(on));
  $('door-free').setAttribute('aria-pressed', String(!on));
  renderDoorGridReadout();
}
function renderDoorGridReadout() {
  const p = editor.gridPitch;
  const ft = p >= 1 ? `${p} ft` : `${Math.round(p * 12)} in`;
  $('door-grid-readout').innerHTML = editor.doorSnap
    ? `Openings land on <strong>${ft}</strong> marks along the wall — finer as you zoom in.` +
      '<br />Hold <kbd>Alt</kbd> for one free placement; drag an opening to slide it.'
    : 'Openings slide freely along the wall — drag one to move it.';
}
$('door-snap').addEventListener('click', () => { editor.setDoorSnap(true); renderDoorModes(); });
$('door-free').addEventListener('click', () => { editor.setDoorSnap(false); renderDoorModes(); });

function renderFloorModes() {
  const on = editor.floorRect;
  $('floor-rect').setAttribute('aria-pressed', String(on));
  $('floor-brush').setAttribute('aria-pressed', String(!on));
}

// The annotation tool's panel (Phase 38): which of its three gestures is
// live, the sentence the next note gets, and what is selected right now. The
// text field edits the *selected* note when there is one — the same field, so
// there is exactly one place a sentence is ever typed.
function renderAnnoPanel() {
  const m = editor.annoMode;
  $('anno-dim').setAttribute('aria-pressed', String(m === 'dim'));
  $('anno-chain').setAttribute('aria-pressed', String(m === 'chain'));
  $('anno-note').setAttribute('aria-pressed', String(m === 'note'));
  const sel = editor.annoSelection;
  if (sel && sel.kind === 'note') $('anno-text').value = sel.text;
  $('anno-readout').textContent = !sel
    ? 'Nothing selected — click a drawn dimension or note to adjust it.'
    : sel.kind === 'note'
      ? 'Note selected — the sentence above is its text; drag moves it, Delete removes it.'
      : `Dimension selected — ${sel.label}, measured off its anchors. ` +
        'Drag slides the line, Delete removes it.';
  $('anno-delete').disabled = !sel;
}
for (const [btn, m] of [['anno-dim', 'dim'], ['anno-chain', 'chain'], ['anno-note', 'note']]) {
  $(btn).addEventListener('click', () => {
    editor.setAnnoMode(m);
    renderAnnoPanel();
  });
}
// `change`, not `input`: one undo step per edited sentence, not per keystroke.
$('anno-text').addEventListener('change', () => {
  editor.setAnnoText($('anno-text').value);
  autosave(state);
  updateUndoButtons();
  renderAnnoPanel();
});
$('anno-delete').addEventListener('click', () => {
  editor.annoDelete();
  autosave(state);
  updateUndoButtons();
  renderAnnoPanel();
});
$('floor-rect').addEventListener('click', () => { editor.setFloorRect(true); renderFloorModes(); });
$('floor-brush').addEventListener('click', () => { editor.setFloorRect(false); renderFloorModes(); });

// Whatever the active tool's panel shows about *itself*, brought back into
// step after a key changed it underneath.
function syncToolPanels() {
  const t = editor.tool;
  if (t === 'wall') renderWallModes();
  else if (t === 'door') renderDoorModes();
  else if (t === 'floor' || t === 'erase') renderFloorModes();
  else if (t === 'stair') renderStairList();
  else if (t === 'anno') renderAnnoPanel();
}

// The grid's pitch is a function of the zoom, so the readout under the wall
// toggles moves when the wheel does. Passive and cheap: the editor's own
// handler has already changed the view height by the time this runs.
canvas.addEventListener('wheel', () => {
  if (editor.tool === 'wall') renderGridReadout();
  if (editor.tool === 'door') renderDoorGridReadout();
}, { passive: true });

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
// --- the room name, and why it moves on by itself ---
//
// The field used to be seeded with the literal 'Room 101' and left there, so
// every room anybody drew by hand came out called Room 101. `nextRoomName`
// reads the building and answers with a number nobody has used; this keeps
// the field on that answer as rooms appear, and — the whole point — gets out
// of the way the moment somebody types a name of their own.
//
// `suggested` is the last thing this function put in the box. If the box
// still holds it, nobody has touched it and it is ours to advance; if it
// holds anything else, it is theirs and we leave it exactly alone.
let suggested = null;
function suggestRoomName({ force = false } = {}) {
  const box = $('room-name');
  if (!force && suggested !== null && box.value !== suggested) return;
  const next = nextRoomName(state);
  if (box.value === next) { suggested = next; return; }
  suggested = next;
  box.value = next;
  editor.setRoom(next, editor.roomColor);
}
$('room-name').addEventListener('input', (e) => {
  editor.setRoom(e.target.value, editor.roomColor);
});
suggestRoomName({ force: true });

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

// --- what is already on this storey (Phase 25) ---
//
// The tool could always select, drag, rotate and delete a stair; there was
// simply nothing on screen that said so, and a footprint you cannot find is a
// stair you cannot remove. This lists them, lights the selected one, and gives
// the three verbs a button each — the same three the pointer and the keyboard
// call, through the same functions, so the two can never disagree.
const STAIR_ICON = {
  stair: '🪜', ramp: '📐', elevator: '🛗', opening: '⬛',
};
const STAIR_NOUN = {
  stair: 'Staircase', ramp: 'Ramp', elevator: 'Elevator', opening: 'Floor opening',
};

function renderStairList() {
  const host = $('stair-list');
  const list = editor.stairList();
  const selectedId = editor.stairSelectedId;
  host.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing yet — click the plan to place one.';
    host.appendChild(p);
  }
  list.forEach((link, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    const on = link.id === selectedId;
    b.setAttribute('aria-pressed', String(on));
    const n = list.filter((l, j) => l.type === link.type && j <= i).length;
    // An elevator selected from the level it arrives at is still that
    // elevator; saying which way it runs is the honest label for it.
    const serves = link.from === state.currentFloor
      ? `→ ${floorLabel(link.to)}` : `← ${floorLabel(link.from)}`;
    b.innerHTML = `<span class="icon">${STAIR_ICON[link.type] || '·'}</span>` +
      `<span>${STAIR_NOUN[link.type] || link.type} ${n}</span>` +
      `<span class="where">${serves} · at ${Math.round(link.x)}, ${Math.round(link.z)} ft</span>`;
    b.addEventListener('click', () => {
      editor.stairSelect(link.id);
      renderStairList();
    });
    host.appendChild(b);
  });
  $('stair-actions').classList.toggle('hidden', !selectedId);
}

function afterStairEdit() {
  renderStairList();
  renderStairReadout();
  afterEdit();
}

$('stair-delete').addEventListener('click', () => {
  if (editor.stairDelete()) afterStairEdit();
});
$('stair-rot-cw').addEventListener('click', () => { editor.stairRotate(false); afterStairEdit(); });
$('stair-rot-ccw').addEventListener('click', () => { editor.stairRotate(true); afterStairEdit(); });
const NUDGE = CELL;
$('stair-nudge-up').addEventListener('click', () => { editor.stairNudge(0, -NUDGE); afterStairEdit(); });
$('stair-nudge-down').addEventListener('click', () => { editor.stairNudge(0, NUDGE); afterStairEdit(); });
$('stair-nudge-left').addEventListener('click', () => { editor.stairNudge(-NUDGE, 0); afterStairEdit(); });
$('stair-nudge-right').addEventListener('click', () => { editor.stairNudge(NUDGE, 0); afterStairEdit(); });

// The run a stair will have is fixed by the floor-to-floor height, so it can be
// reported before anything is placed — the number that decides whether a
// staircase fits the room you meant to put it in.
function renderStairReadout() {
  if (editor.tool === 'stair') renderStairList();
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

// The topbar gets the same treatment from the other edge: it wraps on a
// narrow window now, so its height is no longer a constant either, and the
// toolbar, the tool panels and the right rail all hang from it. A
// ResizeObserver rather than a resize listener, because the bar's height can
// change without the window's (a button label growing, a font arriving).
{
  const topbar = $('topbar');
  const reserve = () => {
    const h = topbar.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--topbar-h', `${h}px`);
  };
  new ResizeObserver(reserve).observe(topbar);
  reserve();
}

// The rail panels fold to their headers, and the folds survive a reload — a
// browser that always wants the sky open and the report closed gets to say so
// once. Opening a panel from the topbar unfolds it: that press means "show
// me", not "show me the header".
const RAIL_FOLDS_KEY = 'sg-rail-folds';
function railSetFold(panel, folded, save = true) {
  panel.classList.toggle('folded', folded);
  const btn = panel.querySelector('.rail-fold');
  if (btn) btn.setAttribute('aria-expanded', String(!folded));
  if (!save) return;
  try {
    const all = JSON.parse(localStorage.getItem(RAIL_FOLDS_KEY) || '{}');
    all[panel.id] = folded;
    localStorage.setItem(RAIL_FOLDS_KEY, JSON.stringify(all));
  } catch { /* a private window remembers nothing, which is fine */ }
}
function railUnfold(panel) {
  if (panel.classList.contains('folded')) railSetFold(panel, false);
}
{
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(RAIL_FOLDS_KEY) || '{}'); } catch { saved = {}; }
  for (const panel of document.querySelectorAll('.rail-panel')) {
    if (saved[panel.id]) railSetFold(panel, true, false);
    const btn = panel.querySelector('.rail-fold');
    if (btn) btn.addEventListener('click', () => {
      railSetFold(panel, !panel.classList.contains('folded'));
    });
  }
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
      `${Math.round(Math.max(drawn.z1, f.d))} ft. The floor brush stops at the edge; ` +
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
      `${out.risk.length === 1 ? 's' : ''} off the sheet — the floor brush will clip ` +
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

// Phase 32: the backlog's missing verb, "move everything on this storey by
// (dx, dz)". Shrinking the sheet can strand a room past the edge where the
// brush cannot reach it, and the origin never moves — so the way back is to
// slide the storey, not the sheet. Rooms, free-standing walls and props all
// go together (section.js); stairs and lifts stand on two storeys at once
// and stay put, which the status line says out loud rather than leaving a
// stair floating somewhere surprising.
const slideDx = $('slide-dx');
const slideDz = $('slide-dz');
$('sheet-slide').addEventListener('click', () => {
  const dx = Number(slideDx.value) || 0;
  const dz = Number(slideDz.value) || 0;
  if (!dx && !dz) {
    $('status').textContent = 'Slide — give it a distance in feet ' +
      '(negative moves toward the origin).';
    return;
  }
  applySheet(
    () => moveStorey(state, state.currentFloor, dx, dz),
    (out) => {
      const moved = [
        `${out.rooms} room${out.rooms === 1 ? '' : 's'}`,
        out.walls ? `${out.walls} wall${out.walls === 1 ? '' : 's'}` : null,
        out.props ? `${out.props} prop${out.props === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(', ');
      return `Slid ${floorLabel(state.currentFloor)} by (${dx}, ${dz}) ft — ${moved}.` +
        (out.links ? ` ${out.links === 1 ? 'A stair or lift connects' :
          `${out.links} stairs or lifts connect`} it to another storey and stayed put.` : '');
    },
  );
  slideDx.value = '0';
  slideDz.value = '0';
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
  // Room numbers are per-storey — 101 on the ground, 201 above it — so
  // changing which storey you are drawing on changes what to suggest.
  suggestRoomName();
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
  // A different building is a different set of room numbers, and the name in
  // the box belongs to the one that just left. Forced, unlike the nudge in
  // designChanged: a custom name carried over from another design is exactly
  // as wrong as a stale suggestion.
  suggestRoomName({ force: true });
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

// --- Phase 30: a real Save ---
//
// The design is a document now: `Save` writes back to the file it came from,
// `Save As` asks where, `Open` reads one, and the autosave is the safety net
// under all three rather than the place the work lives. Every decision about
// what that means — dirty, named, warned about on close — is filestore.js;
// what is here is the two live browser objects it deliberately does not hold:
// the file handle, and the DOM.
//
// Where the File System Access API is absent the same three verbs are a
// download, a download, and a file input. Nothing above this line knows which.

// The name a Save As dialog opens holding, when the file has none of its own:
// the school's own name, which is the name the PA says inside it and the name
// on its gallery card. One seed, one school, one name.
const designName = () => {
  try { return paScript(lifeSettings().seed).school; } catch { return ''; }
};

function syncFileChrome() {
  document.title = docTitle(fileSession);
  const hint = saveHint(fileSession, fileWorld);
  const save = $('save-btn');
  save.title = hint;
  save.classList.toggle('dirty', !!fileSession.dirty && hasFile(fileSession));
  $('saveas-btn').title = fileWorld === 'direct'
    ? 'Write the design to a file you choose (Ctrl+Shift+S)'
    : 'Download the design (Ctrl+Shift+S)';
  $('load-btn').title = fileWorld === 'direct'
    ? `Open a ${FILE_EXT} design from disk (Ctrl+O)`
    : 'Read a design from a file (Ctrl+O)';
}

async function writeDesign(handle) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([serialize(state)], { type: 'application/json' }));
  await writable.close();
}

async function fileSave({ as = false } = {}) {
  const name = suggestName(fileSession, designName());
  if (fileWorld !== 'direct') {
    downloadSave(state, name);
    fileSession = noteSaved(fileSession, { name });
    syncFileChrome();
    $('status').textContent = `Downloaded ${fileSession.name}. ${AUTOSAVE_NOTE}`;
    return;
  }
  try {
    const handle = (!as && fileSession.handle)
      || await window.showSaveFilePicker(savePickerOptions(name));
    await writeDesign(handle);
    fileSession = noteSaved(fileSession, { name: handle.name, handle });
    syncFileChrome();
    $('status').textContent = `Saved to ${fileSession.name}.`;
  } catch (err) {
    // A cancelled picker says nothing: the person pressed Escape, and a tool
    // that scolds them for it has opinions about its own dialogs.
    const text = fileErrorText(err, 'save');
    if (text) $('status').textContent = text;
  }
}

// The design that arrived, whichever door it came through. Kept in one place
// so a file, a link, a card and a slot cannot disagree about what happens to
// the undo stack or to the session behind them.
function adoptOpened(next, { name = null, handle = null, source = 'file', undoable = true } = {}) {
  if (undoable) editor.pushUndo();
  adoptState(next, { undoable });
  fileSession = noteOpened(fileSession, { name, handle, source });
  syncFileChrome();
}

async function fileOpen() {
  if (fileWorld !== 'direct') { $('file-input').click(); return; }
  try {
    const [handle] = await window.showOpenFilePicker(openPickerOptions());
    const file = await handle.getFile();
    adoptOpened(await loadFromFile(file, { onMigrate }),
      { name: file.name, handle, source: 'file' });
    sayIfMigrated();
    $('status').textContent = `Opened ${fileSession.name}. Ctrl+S writes straight back to it.`;
  } catch (err) {
    const text = fileErrorText(err, 'open');
    if (text) $('status').textContent = text;
  }
}

$('save-btn').addEventListener('click', () => fileSave());
$('saveas-btn').addEventListener('click', () => fileSave({ as: true }));
$('load-btn').addEventListener('click', () => fileOpen());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    // No handle: a file input hands over bytes and a name, never a way back
    // to the file, which is exactly the gap `showOpenFilePicker` closes.
    adoptOpened(await loadFromFile(file, { onMigrate }), { name: file.name, source: 'file' });
    sayIfMigrated();
  } catch (err) {
    alert('Could not load that file: ' + err.message);
  }
});
syncFileChrome();

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
        // Phase 30: a slot is not a file. Carrying the previous document's
        // handle over here would make the next Ctrl+S overwrite one design
        // with another — which is the whole footgun `noteOpened` exists to
        // disarm.
        fileSession = noteOpened(fileSession, { name: d.name, source: 'store' });
        syncFileChrome();
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

// Phase 16's two additions are the only ones that cost anything to prepare: a
// code panel and a specification sheet are both readings of the report, and
// the report is the most derived thing in the codebase. So it is built once,
// here, and handed to every sheet — rather than each sheet building its own.
function exportOpts() {
  const wantsCode = $('export-code').checked;
  const wantsSpec = $('export-spec').checked;
  const wantsDay = $('export-day').checked;
  // Phase 40: the failed turning circles, painted on the plan. A reading of
  // the same report, so it shares the one build.
  const wantsClearance = $('export-clearance').checked;
  let data = null;
  if (wantsCode || wantsSpec || wantsDay || wantsClearance) {
    if (report.stale || !report.data) reportBuild();
    data = report.data;
  }
  return {
    showDimensions: $('export-dims').checked,
    showAnnotations: $('export-anno').checked,
    showFurniture: $('export-furniture').checked,
    showFinishes: $('export-finishes').checked,
    showOccupancy: $('export-occupancy').checked,
    contours: $('export-contours').checked,
    clearance: wantsClearance && data
      ? data.accessible.turning.fails.map((c) => ({
        id: c.id, floor: c.floor, x: c.x, z: c.z, r: c.clear, need: c.need,
      }))
      : null,
    report: data,
    // A panel is per sheet — it says which storey you are holding — so what
    // travels in the options is the report, and each sheet asks it for its own.
    wantsCode,
    wantsDay,
    spec: wantsSpec && data ? data.spec : null,
  };
}

// The plan options for one storey: the shared set, plus that storey's own
// panels when they were asked for. `dayPanel` answers null for a design with
// no timetable, which is what keeps the checkbox honest — ticking it on a
// school nobody has described a day for draws nothing rather than a box of
// zeroes.
const sheetOpts = (opts, floorIndex) => {
  if (!opts.report) return opts;
  const out = { ...opts };
  if (opts.wantsCode) out.codePanel = codePanel(opts.report, { floor: floorIndex });
  if (opts.wantsDay) out.dayPanel = dayPanel(opts.report, { floor: floorIndex });
  return out;
};

// The site plan is a sheet, not a floor — it has no storey — so it rides
// alongside the floor scope rather than inside it.
const wantsSite = () => $('export-site').checked;

// Phase 38: the tracing overlay on the printed sheet — the backlog's
// "edit-mode only" complaint, closed behind a checkbox. The image has to be
// decoded before a canvas can draw it, and a canvas cannot await, so the
// shell decodes it here and hands blueprint.js `{ overlay, image }`. A design
// with no overlay, an unticked box, or an image the browser cannot decode all
// land on null — the sheet simply prints without the picture, as it always has.
async function exportTrace() {
  if (!$('export-trace').checked || !state.overlay || !state.overlay.src) return null;
  const image = new Image();
  image.src = state.overlay.src;
  try { await image.decode(); } catch { return null; }
  return { overlay: state.overlay, image };
}

$('export-btn').addEventListener('click', () => openModal(exportOverlay));
$('export-close').addEventListener('click', () => closeModal(exportOverlay));

// Phase 37: the set. `sheetSet` decides which sheets exist and in what
// order — site, plans, elevations, every drawn section, the specification —
// and numbers each through the title block; this builds one entry's options
// (the shared set, that storey's panels, and its place in the binding) and
// renders it.
function exportSheets(opts) {
  const set = sheetSet(state, {
    site: wantsSite(),
    floors: exportScope(),
    elevations: $('export-elev').checked,
    spec: !!opts.spec,
  });
  return set.map((entry, i) => ({
    entry,
    render: () => renderSheetCanvas(state, entry, {
      ...sheetOpts(opts, entry.kind === 'plan' ? entry.floorIndex : null),
      sheetIndex: i + 1,
      sheetCount: set.length,
    }),
  }));
}

const sheetSlug = (entry) =>
  `school-${entry.number}-${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    .replace(/-+$/, '');

$('export-png').addEventListener('click', async () => {
  const opts = { ...exportOpts(), trace: await exportTrace() };
  for (const { entry, render } of exportSheets(opts)) {
    const canvas = render();
    if (canvas) downloadCanvasPNG(canvas, `${sheetSlug(entry)}.png`);
  }
});

$('export-print').addEventListener('click', async () => {
  const opts = { ...exportOpts(), trace: await exportTrace() };
  printArea.textContent = '';
  // One dialog for the lot, bound the way a real set is bound: the site
  // leads, the plans follow, the elevations and cuts stand behind them, and
  // the specification closes the book.
  for (const { render } of exportSheets(opts)) {
    const canvas = render();
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
  clearAutosave();
  adoptState(createState(), { keepAutosave: true, undoable: true });
  fileSession = makeFileSession('new');
  syncFileChrome();
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
  { key: 'origin', label: 'Reference' },
];

const OVERLAY_MODE_TITLES = {
  move: 'Drag the image into place',
  measure: 'Click the two ends of something you know the length of',
  origin: 'Click the point the drawing grid should start from',
};

const OVERLAY_MODE_HINTS = {
  measure: 'Measure — click one end of something you know the length of, then the other.',
  origin: 'Reference — click the point the drawing grid should count from. ' +
    'A column centre, a corner of the building, whatever the plan itself is dimensioned off.',
};

const overlayModes = $('overlay-modes');
OVERLAY_MODES.forEach((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = m.label;
  b.title = OVERLAY_MODE_TITLES[m.key] || '';
  b.addEventListener('click', () => {
    editor.setOverlayMode(m.key);
    renderOverlayPanel();
    $('status').textContent = m.key === 'origin' && editor.gridLocked
      ? editor.gridRefText
      : (OVERLAY_MODE_HINTS[m.key] || HINTS.overlay);
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

// Back to the corner of the sheet. Allowed on exactly the terms setting it is
// — gridref.js decides, and says why when it says no.
$('overlay-origin-clear').addEventListener('click', () => {
  editor.pushUndo();
  const out = clearGridRef(state);
  if (!out.ok) {
    editor.dropUndo();
    $('status').textContent = out.reason;
    renderOverlayPanel();
    return;
  }
  designChanged({ structural: true, commit: true });
  $('status').textContent = describeGridRef(state);
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
  // A reference point picked on the picture rides with it, while that is still
  // allowed — see gridref.js. Nothing to redraw beyond the grid itself, which
  // `refreshOverlay` reaches through the renderer's own sheet sync.
  reanchorGridRef(state);
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

  const modeLabel = (OVERLAY_MODES.find((m) => m.key === editor.overlayMode) || OVERLAY_MODES[0]).label;
  for (const b of overlayModes.children) b.classList.toggle('active', b.textContent === modeLabel);

  // Phase 35's row: where the drawing grid starts, and the one button that
  // puts it back. Both go grey the moment anything is drawn, because that is
  // the moment the grid stops being movable — see gridref.js.
  $('overlay-origin-clear').disabled = !editor.gridRef || editor.gridLocked;
  $('overlay-grid-readout').textContent = editor.gridRefText;

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

// Phase 39: what the region is *for*. A kind implies curb points — where a
// bus's door opens, where a car pulls in, where a parked driver gets out —
// which is where the crowd's day starts and ends.
const siteKindSel = $('site-kind');
{
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'None';
  siteKindSel.appendChild(none);
  for (const k of SITE_KINDS) {
    const o = document.createElement('option');
    o.value = k.key;
    o.textContent = k.label;
    siteKindSel.appendChild(o);
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
  if (editor.setSiteStyle(siteSurfaceSel.value, siteMarkingSel.value || null,
    siteKindSel.value || null)) {
    $('status').textContent = 'Region restyled.';
  }
  renderSiteReadout();
}

siteKindSel.addEventListener('change', siteStyleChanged);

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
    const k = sel.kind ? kindEntry(sel.kind) : null;
    const curbs = k ? curbPointsFor(sel).length : 0;
    lines.push(`<b>${sel.name || entry.label}</b> — ${Math.round(regionArea(sel)).toLocaleString()} ft²` +
      (m ? ` · ${m.label}` : '') +
      (k ? ` · ${k.label}, ${curbs} curb point${curbs === 1 ? '' : 's'}` : ''));
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
  siteKindSel.value = editor.siteKind || '';
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
// Phase 33: what a tour stop captures when it records the sky along with the
// camera — the tour panel's own "🌅 capture the sky too" checkbox reads this.
// Never saved on its own; it is a fact about the sky panel's last click, not
// about the design. Declared ahead of `envChanged`, which reads it on every
// call: this file has twice shipped a `let` sitting below the function that
// reads it and landed a TDZ error on the one path nothing automates — see
// Phase 30 and Phase 31's own retrospectives.
let lastMoodKey = '';

function envChanged() {
  state.env = normalizeEnv(state.env);
  renderApi.setEnvironment(state.env);
  renderEnvPanel();
  autosave(state);
  // Any raw scrub of the sky panel means the last named mood no longer
  // describes what is showing — `setMood` sets this back right after calling
  // here, which is what keeps "was the sky panel's last word a mood, or a
  // scrub" honest for a tour stop that wants to capture it.
  lastMoodKey = '';
}

// Phase 20: five moods, one click each. A mood writes the whole look — the
// time on this date at this latitude, and the lights settled to match — so
// the row is a choice of pictures rather than a scrubber with seven detents.
// The same row is rendered into photo mode, because that is where the
// pictures get taken; both rows call this one function.
function setMood(key) {
  const mood = MOODS.find((m) => m.key === key);
  if (!mood) return;
  state.env = applyMood(state.env, key);
  envChanged();
  lastMoodKey = key;
  if (photoMode) renderPhotoPanel();
  $('status').textContent =
    `Sky — ${mood.label.toLowerCase()}, ${formatClock(state.env.minutes)} on ${formatDate(state.env.month, state.env.day)}.`;
}

function buildMoodRow(host) {
  MOODS.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.preset = m.key;
    b.title = `${m.label} on this date, at this latitude — time and lights in one click`;
    b.innerHTML = `<span aria-hidden="true">${m.icon}</span> ${m.label}`;
    b.addEventListener('click', () => setMood(m.key));
    host.appendChild(b);
  });
}

const envPresets = $('env-presets');
buildMoodRow(envPresets);
buildMoodRow($('photo-moods'));

// Phase 29: the weather, one click, beside the moods — and like a sky
// change, it autosaves and skips the undo stack: nobody wants Ctrl+Z to
// walk back through a shower. The record is optional the way `haunt` is —
// a clear day deletes the key, so a design with no weather writes none.
function weatherChanged() {
  if (state.weather && isDefaultWeather(state.weather)) delete state.weather;
  else if (state.weather) state.weather = normalizeWeather(state.weather);
  renderApi.setWeather(state.weather);
  renderWeatherRows();
  autosave(state);
}

function setWeatherMood(key) {
  const next = applyWeatherMood(state.weather, key);
  if (isDefaultWeather(next)) delete state.weather; else state.weather = next;
  weatherChanged();
  $('status').textContent = `Sky — ${weatherLabel(state.weather).toLowerCase()}.`;
}

function buildWeatherRow(host) {
  if (!host) return;
  WEATHER_MOODS.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.weather = m.key;
    b.title = `${m.label} — the same click puts the sky back`;
    b.innerHTML = `<span aria-hidden="true">${m.icon}</span> ${m.label}`;
    b.addEventListener('click', () => setWeatherMood(m.key));
    host.appendChild(b);
  });
}

function renderWeatherRows() {
  const kind = normalizeWeather(state.weather).kind;
  document.querySelectorAll('button[data-weather]').forEach((b) => {
    const on = b.dataset.weather === kind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

buildWeatherRow($('env-weather'));
buildWeatherRow($('photo-weather'));

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

// The sun study plays itself: a simulated hour per second through the exact
// path the slider drives, so what animates is what scrubbing shows. Under
// prefers-reduced-motion it steps on the hour once a second instead of
// sweeping — slower to watch, same study.
{
  const btn = $('env-play');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The float clock lives here: normalizeEnv rounds env.minutes to whole
  // minutes, and on a fast display a frame is less than half a minute of sun
  // — accumulating in state would round the advance away entirely.
  let raf = 0, last = 0, acc = 0, clock = 0;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    btn.textContent = '\u25b6';
    btn.setAttribute('aria-pressed', 'false');
  };
  const tick = (now) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (reduce.matches) {
      acc += dt;
      if (acc >= 1) {
        acc = 0;
        state.env.minutes = (Math.floor(state.env.minutes / 60) * 60 + 60) % 1440;
        envChanged();
      }
    } else {
      clock = (clock + dt * 60) % 1440;
      state.env.minutes = clock;
      envChanged();
    }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener('click', () => {
    if (raf) { stop(); return; }
    btn.textContent = '\u23f8';
    btn.setAttribute('aria-pressed', 'true');
    last = performance.now();
    acc = 0;
    clock = state.env.minutes;
    raf = requestAnimationFrame(tick);
  });
  // Touching the slider by hand takes the wheel back.
  $('env-time').addEventListener('pointerdown', stop);
}
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
  // Phase 29: the weather rides the same panel refresh, so a loaded file's
  // rain (or an undo that took it away) lights the right button. The scene
  // itself needs no write here — every path that changes the record either
  // clicked it (weatherChanged) or rebuilt the world (buildFromState).
  renderWeatherRows();
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
  // Phase 20: the ceiling's generic troffers are in the budget now, counted
  // apart from placed fixtures so the line stays honest about which is which.
  const fixtures = lights.sources || lights.troffers
    ? [
      lights.sources ? `${lights.sources} fixture${lights.sources === 1 ? '' : 's'}` : null,
      lights.troffers ? `${lights.troffers} ceiling troffer${lights.troffers === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' + ') +
      ` · ${lights.clustered} group${lights.clustered === 1 ? '' : 's'}, ${lights.cap} live at once · ${burning}`
    : `Nothing here emits yet — draw a room and its ceiling lights come with it.`;
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
  if (!hidden) railUnfold(envPanel);
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
  if (r.total === 0 && !r.murmurs) {
    return 'Nothing in this design makes a noise yet.<br />' +
      'No bells placed — <b>B</b> rings one where you stand.';
  }
  const bits = [];
  // Phase 28: the crowd's own emitters — lessons, chatter, the corridor rush.
  if (r.murmurs) bits.push(`${plural(r.murmurs, 'murmur emitter')} from the crowd`);
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
$('audio-pa').addEventListener('click', () => { paAnnounce(); });

$('audio-btn').addEventListener('click', () => {
  const hidden = audioPanel.classList.toggle('hidden');
  $('audio-btn').classList.toggle('off', hidden);
  $('audio-btn').setAttribute('aria-pressed', String(!hidden));
  if (!hidden) { railUnfold(audioPanel); renderAudioPanel(); }
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
  plan: null,
  heatAt: 0,
  clockAcc: 0,
  // Phase 28: occupancy's classified rooms (the murmur derivation reads
  // them) and the murmur feed's own throttle. Both derived, neither saved.
  occRooms: null,
  murmurAcc: 0,
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
  // The ground first, and handed to the graph: since Phase 17 `buildNav`
  // meshes the site as well as the storeys, and the heightfield it needs to
  // know which banks are too steep to walk is the one the walker is about to
  // be handed anyway. Building it twice is thirty milliseconds nobody gets
  // back.
  life.site = terrainField(state);
  life.nav = buildNav(state, { siteField: life.site });
  life.colliders = new Map();
  life.occRooms = null;
  chatSegs.clear();
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

// ---------- Phase 28: the crowd as sound ----------

// Occupancy's classified rooms, on the crowd's own graph, derived once per
// world — the same cache bargain the colliders make, torn down by the same
// rebuild.
function lifeOccRooms() {
  if (!life.occRooms) {
    if (!life.nav) lifeRebuildWorld();
    life.occRooms = buildingOccupancy(state, { nav: life.nav }).rooms;
  }
  return life.occRooms;
}

// The murmur feed: who is where, handed to the mixer as emitters a few times
// a second. Everything from here on is sound.js's existing plumbing — the
// same budget, the same ray through the same walls.
function murmurTick(dt) {
  life.murmurAcc += dt;
  if (life.murmurAcc < 0.35) return;
  life.murmurAcc = 0;
  if (!audio.running || !life.on) { audio.setMurmur([]); return; }
  audio.setMurmur(murmurEmitters(lifeOccRooms(), life.agents, life.ctx.schedule,
    state.env.minutes, { floorHt: state.floorHt }));
}

// The sightline gate for the speech bubbles — the same rule the labels obey:
// no clear cast from the eye to the pair, no 💬 through a wall. Segments per
// storey, cached until the world rebuilds.
const chatSegs = new Map();
function chatSeenGate() {
  if (mode !== 'walk') return null;
  const eye = renderApi.walkCamera.position;
  const f = walk.at.floor;
  let segs = chatSegs.get(f);
  if (!segs) { segs = sightBlockers(state, f); chatSegs.set(f, segs); }
  const collider = life.colliders ? life.colliders.get(f) : null;
  const leaves = collider ? collider.doors : null;
  return (a) => (a.floorIndex ?? 0) === f
    && sightClear(segs, leaves, eye.x, eye.z, a.x, a.z);
}

// The PA learns to talk: murmur.js writes the morning script — the school's
// name from the crowd's seed, today's date, the day's rooms — and the Web
// Speech API reads it over the chime the speakers already play. The chime,
// the key-click and their reverb ride the PA path as ever; the words cannot
// (speech synthesis never enters the Web Audio graph), so they ride on top,
// and a machine with no voice keeps the chime and gets the words on the HUD
// — which every machine gets anyway. Zero bytes shipped, zero server.
function paAnnounce(kind) {
  const script = paScript(lifeSettings().seed, {
    date: new Date(),
    rooms: lifeOccRooms().filter((r) => r.name && !r.circulation).map((r) => r.name),
    kind,
  });
  const text = script.lines.join(' ');
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const voice = !!synth && !audio.muted;
  audio.announce({ voice });
  if (voice) {
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.volume = audio.volume;
      // After the chime, the way a real PA waits for its own gong.
      setTimeout(() => { try { synth.speak(u); } catch { /* the HUD carries it */ } }, 1100);
    } catch { /* the chime and the HUD line carry it */ }
  }
  if (mode === 'walk') walkSay(`📢 ${text}`);
  else $('status').textContent = `📢 ${text}`;
  renderAudioReadout();
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
  // Phase 15: the school day the design carries, as the plan `makePopulation`
  // builds cohorts out of. A design with no timetable hands over nothing and
  // gets Phase 6's random intake, which is exactly what it got before.
  const tt = timetableOf(state);
  life.plan = isEmptyTimetable(tt) ? null : timetablePlan(tt, life.ctx.schedule);
  life.agents = makePopulation(state, life.nav, {
    seed: life.seed, students: life.students, schedule: life.ctx.schedule,
    plan: life.plan,
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
  // ...and the cars with them, for the same reason: the lift the camera
  // presses the button for has to be the lift forty people are queueing for,
  // or the doors it holds open are a different object's doors.
  walk.setLifts(() => (life.ctx ? life.ctx.lifts : null));
  walk.setFollow(null);
  renderLifePanel();
  return life.on;
}

function lifeStop() {
  life.on = false;
  life.agents = [];
  life.drill = false;
  life.followIdx = -1;
  audio.setMurmur([]);
  walk.setBodies(null);
  walk.setColliders(null);
  walk.setLifts(null);
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
    // The first bell of the day is when the PA clears its throat.
    if (bell.kind === 'arrival' && audio.running) paAnnounce();
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
    const floorIndex = walk.at.floor;
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
    chatSeen: chatSeenGate(),
  });
  murmurTick(dt);
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
    : walk.at.floor;
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
    if (audio.running) paAnnounce('drill');
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
  // Phase 39: the day's edges, when they show. `away` is the bus that
  // hasn't come; `out` is the one that has gone; `queueing` covers the lift
  // and the front door's morning crush alike.
  if (c.away || c.out) {
    lines.push(`<b>${c.away}</b> not arrived · <b>${c.out}</b> gone home`);
  }
  if (c.queueing || c.riding) {
    lines.push(`<b>${c.queueing}</b> queueing · <b>${c.riding}</b> in the lift`);
  }
  if (life.drill) {
    const r = drillReport(life.agents, life.ctx.elapsed);
    lines.push(`<b>${r.out}/${r.total}</b> out in <b>${Math.round(r.elapsed)}s</b>` +
      (r.longest ? ` · last out at ${Math.round(r.longest)}s` : ''));
    if (r.stranded) lines.push(`<span class="warn">${r.stranded} with no way out</span>`);
    // The other half of a finding the tool has had half of since Phase 7: the
    // travel-distance table says how far the furthest person is from a door,
    // and a drill says how long the last one actually took. One walk of that
    // distance is the floor; anything much above it is the queue, the door and
    // the corner the crowd shuffled somebody into — measured rather than
    // assumed, which is the only reason it is worth printing.
    const expected = report.data ? report.data.summary.travel / SPEED.drill : 0;
    if (r.done && expected > 1) {
      const ratio = r.longest / expected;
      lines.push(`Building clear in <b>${ratio.toFixed(1)}×</b> the ` +
        `${Math.round(expected)}s the travel-distance table implies.`);
    } else if (r.done) {
      lines.push('Building clear.');
    }
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
  renderLifeTimetable();
  renderLifeRates();
  renderLifeClock();
  renderLifeReadout();
}

$('life-btn').addEventListener('click', () => {
  const hidden = lifePanel.classList.toggle('hidden');
  $('life-btn').classList.toggle('off', hidden);
  $('life-btn').setAttribute('aria-pressed', String(!hidden));
  if (!hidden) { railUnfold(lifePanel); renderLifePanel(); }
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

// --- the timetable ---
//
// Phase 15. The life panel has had a size and a seed since Phase 6 and has
// never had a *source*: a population of ninety with a random room per period
// is a plausible school and was never this one. This is the source, and it is
// three buttons because it is three questions — build me one out of the rooms
// I have drawn, read me the one I already have, or give me the random day back.
//
// A timetable is a fact about the design (it names this building's rooms by
// their ids), so writing one is an edit: undo, autosave, and the report goes
// stale exactly as it does when a wall moves.

const timetableOf = (s2) => normalizeTimetable(s2 && s2.timetable);

// The rooms a section can go in, and what the analysis says each of them
// holds. Built off the same graph and the same occupant loads the report uses,
// because a timetable that thought a room held thirty while the report said
// twenty-four would be two panels arguing in public.
function timetableWorld() {
  const nav = life.nav || buildNav(state);
  const occupancy = buildingOccupancy(state, { nav });
  return { nav, occupancy, pool: roomPool(nav, { occupancy }) };
}

function setTimetable(tt) {
  editor.pushUndo();
  // Bound to the building as it stands before it is stored, never after: a
  // section whose room id still resolves keeps it, one whose room was redrawn
  // under the same name gets the new id, and one whose room is simply gone is
  // left unplaced with its name intact so a later rebinding can still find it.
  // Doing it here means the file never holds a binding this build knows is
  // stale.
  const next = isEmptyTimetable(normalizeTimetable(tt))
    ? normalizeTimetable(null)
    : bindTimetable(tt, timetableWorld().pool).timetable;
  if (isEmptyTimetable(next)) delete state.timetable; else state.timetable = next;
  autosave(state);
  reportInvalidate();
  updateUndoButtons();
  if (life.on) lifeStart(); else renderLifePanel();
}

// One line about the school day, under the students slider: which timetable
// this is, how big it is, and what it could not satisfy. The last of those is
// the whole reason the packing reports rather than fudges — a panel that says
// "24 groups, 168 sections" and nothing else is a panel hiding the four
// sections that had nowhere to go.
function renderLifeTimetable() {
  const el = $('life-tt-state');
  const tt = timetableOf(state);
  const has = !isEmptyTimetable(tt);
  $('life-tt-clear').disabled = !has;
  $('life-tt-csv').disabled = !has;
  if (!has) {
    el.innerHTML = 'No timetable — every student\'s day is random. ' +
      'Generate one, or read one in.';
    return;
  }
  const sum = timetableSummary(tt);
  const issues = timetableIssues(tt, timetableWorld().pool);
  const lines = [
    `<b>${sum.cohorts}</b> ${sum.cohorts === 1 ? 'group' : 'groups'} · ` +
    `<b>${sum.sections}</b> ${sum.sections === 1 ? 'section' : 'sections'} · ` +
    `<b>${sum.periods}</b> ${sum.periods === 1 ? 'period' : 'periods'} · ` +
    `${sum.students} students`,
    sum.source === 'csv' ? 'Read from a spreadsheet.' : 'Generated from this building.',
  ];
  if (issues.count) {
    const bits = [];
    if (issues.unplaced.length) bits.push(`${issues.unplaced.length} with no room`);
    if (issues.missing.length) bits.push(`${issues.missing.length} naming a room that is gone`);
    if (issues.over.length) bits.push(`${issues.over.length} over the room's load`);
    if (issues.mismatched.length) bits.push(`${issues.mismatched.length} in the wrong kind of room`);
    lines.push(`<span class="warn">${bits.join(' · ')}</span> — the report has the detail.`);
  }
  el.innerHTML = lines.join('<br />');
}

$('life-tt-make').addEventListener('click', () => {
  const { pool } = timetableWorld();
  if (!pool.length) {
    $('life-tt-state').innerHTML =
      '<span class="warn">No teaching rooms</span> — draw some rooms big enough to hold a class.';
    return;
  }
  // How many children the building can actually teach — rooms times class
  // size times utilisation, which is `program.js`'s own sizing arithmetic run
  // backwards over the rooms somebody has drawn. Deliberately *not* the
  // occupant load: that is what the building may hold, this is what it can
  // give a lesson to, and the ⚖ button beside the slider is where the other
  // number lives.
  const band = bandEntry(genBrief.band);
  const roll = rollFor(pool, {
    classSize: band.classSize, utilization: band.utilization,
  }).students || genBrief.students;
  setTimetable(buildTimetable(pool, {
    periods: lifeSettings().schedule ? lifeSettings().schedule.periods : undefined,
    students: roll,
    classSize: band.classSize,
    band: band.key,
    // The staff establishment, off the band's own students-per-adult ratio.
    // Not every adult on site teaches a section, so two thirds of them do —
    // which is the number that makes "no teacher free" mean something rather
    // than never firing.
    teachers: Math.max(1, Math.round((roll / band.staffRatio) * 0.66)),
    seed: lifeSettings().seed,
  }));
});

$('life-tt-clear').addEventListener('click', () => setTimetable(null));

$('life-tt-import').addEventListener('click', () => $('life-tt-file').click());

$('life-tt-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { pool } = timetableWorld();
    const band = bandEntry(genBrief.band);
    const read = importTimetableCSV(String(reader.result || ''), pool, {
      classSize: band.classSize,
      name: file.name.replace(/\.csv$/i, ''),
    });
    if (read.error) {
      $('life-tt-state').innerHTML = `<span class="warn">${esc(read.error)}</span>`;
      return;
    }
    setTimetable(read.timetable);
    // What it could not bind, said out loud and immediately. An import that
    // silently loses four rooms answers a question about a school that isn't
    // the one in the file.
    if (read.unbound.length) {
      const names = [...new Set(read.unbound.map((u) => u.token))].slice(0, 4);
      $('life-tt-state').innerHTML +=
        `<br /><span class="warn">${read.unbound.length} cell${read.unbound.length === 1 ? '' : 's'} ` +
        `named no room here</span> — ${esc(names.join(', '))}` +
        (names.length < new Set(read.unbound.map((u) => u.token)).size ? '…' : '') +
        '. Rename the rooms to match, or edit the sheet.';
    }
  };
  reader.onerror = () => {
    $('life-tt-state').innerHTML = '<span class="warn">Could not read that file.</span>';
  };
  reader.readAsText(file);
});

$('life-tt-csv').addEventListener('click', () => {
  const tt = timetableOf(state);
  if (isEmptyTimetable(tt)) return;
  const { pool } = timetableWorld();
  const blob = new Blob([timetableCSV(tt, pool)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'school-timetable.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// The crowd at the number the analysis worked out. One line, and the backlog
// item it closes has been open since Phase 7 wrote the occupant loads down and
// nothing read them: "the crowd doesn't know the occupant load the report
// computed."
$('life-atload').addEventListener('click', () => {
  const { occupancy } = timetableWorld();
  const at = crowdSize(occupancy, { timetable: timetableOf(state) });
  if (!at.students) {
    $('life-tt-state').innerHTML =
      '<span class="warn">Nothing to count</span> — no room here reads as a teaching space.';
    return;
  }
  const n = Math.min(MAX_POP, at.students);
  life.students = n;
  state.life = { ...lifeSettings(), students: n };
  autosave(state);
  if (life.on) lifeStart(); else renderLifePanel();
  $('life-readout').innerHTML =
    `Roll set to <b>${n}</b>${n < at.students ? ` (of ${at.students})` : ''} — ${esc(at.detail)}.`;
});


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

// Phase 19: a finding that names somewhere can take you there. Rooms carry
// ids the nav graph resolves to a point; doors and exits carry the point
// itself. A finding about the design as a whole (three exits where four are
// needed) has nowhere to go and gets no button — same rule findingMarks
// applies on the minimap.
function findingPlace(f) {
  const room = (f.rooms || []).find((r) => r && r.id) || null;
  // Phase 40's circles are points too — the centre of a turning circle that
  // did not fit is exactly somewhere to go and look.
  const door = [...(f.doors || []), ...(f.exits || []), ...(f.circles || [])]
    .find((d) => d && Number.isFinite(d.x) && Number.isFinite(d.z)) || null;
  return room || door ? { room, door } : null;
}

function findingHTML(f, i) {
  const goable = !!findingPlace(f);
  return `<div class="finding ${f.level}" data-finding="${i}">` +
    `<button type="button" aria-expanded="false">` +
    `<b>${esc(f.title)}</b><span class="why">${esc(f.detail)}</span>` +
    // Phase 41: what the finding was measured against — the edition and its
    // table, or the standard. Shown with the detail, never without it.
    (f.cite ? `<span class="cite">${esc(f.cite)}</span>` : '') +
    `</button>` +
    (goable
      ? `<button type="button" class="goto" data-goto="${i}">⌖ Show it on the plan</button>`
      : '') +
    `</div>`;
}

// Take the eye to a finding: while editing, the plan pans to the room it
// names and switches to its storey; while walking, the map in your hand
// lights up with exactly that finding.
function showFinding(i) {
  const f = report.data && report.data.findings[i];
  if (!f) return;
  const place = findingPlace(f);
  if (!place) return;
  if (mode === 'walk') {
    miniOn = true;
    setMiniFindings(true);
    refreshMiniMarks();
    const idx = miniMarks.findIndex((m) => m.title === f.title);
    if (idx >= 0) miniMarkIndex = idx;
    updateMinimapButtons();
    return;
  }
  let at = null, floor = 0;
  if (place.room) {
    const nav = buildNav(state);
    const node = nav.node(place.room.id);
    if (node) { at = { x: node.x, z: node.z }; floor = place.room.floor ?? 0; }
  }
  if (!at && place.door) {
    at = { x: place.door.x, z: place.door.z };
    floor = place.door.floor ?? 0;
  }
  if (!at) return;
  goToFloor(floor);
  renderApi.editView.x = at.x;
  renderApi.editView.z = at.z;
  renderApi.editView.height = Math.min(renderApi.editView.height, 140);
  $('status').textContent = `${f.title} — ` +
    `${place.room && place.room.name ? place.room.name : 'here'}, ${floorLabel(floor)}.`;
}

// Exit discharge, as the one or two rows a panel has room for. Empty for a
// sealed design, which has nothing to discharge.
function dischargeRows(d, row) {
  if (!d || !d.rows.length) return [];
  const out = [];
  if (d.summary.stranded) {
    out.push(row('Discharges nowhere',
      `<span class="warn"><b>${d.summary.stranded}</b> of ${d.summary.exits}</span>`));
  }
  if (d.summary.worst) {
    out.push(row(`Longest discharge · to the ${d.summary.rule === 'paved' ? 'paving' : 'site edge'}`,
      `<b>${ft(d.summary.worst.dist)} ft</b>`));
  }
  if (d.summary.impassable || d.summary.steep) {
    const n = d.summary.impassable || d.summary.steep;
    out.push(row('Discharge routes over 1:20',
      `<span class="warn"><b>${n}</b>${d.summary.impassable ? ' over 1:12' : ''}</span>`));
  }
  return out;
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
  // Phase 41: the range beside the point when any room was counted at a
  // guess — "437 (380–560)" — and the edition every number below was read
  // against, said once at the top.
  const spread = r.summary.occupantsHigh > r.summary.occupantsLow
    ? ` <span class="dim">(${r.summary.occupantsLow}–${r.summary.occupantsHigh})</span>` : '';
  sec('Occupancy', [
    row(`<b>${r.summary.occupants}</b>${spread} occupants`, `${ft(r.summary.area)} ft²`),
    ...uses.map((u) => row(esc(u.label), `<b>${u.occ}</b>`)),
    row('Read against', `${esc(r.editionLabel)} · ${r.sprinklered ? 'sprinklered' : 'unsprinklered'}`),
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
    // Phase 41: the walk to a choice, measured per room rather than assumed.
    e.commonPath
      ? row('Longest common path', `<b>${ft(e.commonPath.common)} ft</b> / ${r.egress.limits.commonPath}`)
      : row('Common path', '—'),
    // The half of the walk that used to stop at the threshold. No limit
    // against it, because the code sets no number for it — but a panel that
    // quotes a travel distance and says nothing about the car park after the
    // door has told half the story.
    ...dischargeRows(r.egress.discharge, row),
  ]);

  const a = r.accessible.summary;
  sec('Accessible route', [
    row(`${plural(a.entrances, 'entrance')} · ${plural(a.lifts, 'lift')}`,
      `${a.ramps ? plural(a.ramps, 'ramp') : 'no ramps'}` +
      (a.steepRamps ? ` · <span class="warn">${plural(a.steepRamps, 'ramp')} too steep</span>` : '')),
    row('Reachable on wheels', a.unreachable
      ? `<b>${a.reachable}</b> of ${a.reachable + a.unreachable}`
      : 'every room'),
    // Phase 40: the chair, once it has arrived. Two numbers each, so a
    // reader can tell "nothing fails" from "nothing was tried".
    row('Room to turn', a.turningFails
      ? `<span class="warn">${a.turningFails}</span> of ${plural(a.turningTested, 'place')} fail`
      : (a.turningTested ? `clear at all ${plural(a.turningTested, 'place')}` : 'nowhere to try')),
    row('Within reach', a.reachFails
      ? `<span class="warn">${a.reachFails}</span> of ${a.reachTested} out of range`
      : (a.reachTested ? `all ${a.reachTested} checked` : 'nothing to check')),
  ]);

  const d = r.daylight.summary;
  sec('Daylight & sound', [
    row('Glazing, whole building', `<b>${(d.ratio * 100).toFixed(1)}%</b> of floor`),
    row(`${plural(d.rooms, 'room')} held to 8%`, d.dark
      ? `<span class="warn">${d.dark} under</span>` : 'all over'),
    row('Rooms over the ANSI reverb limit',
      r.acoustics.summary.over ? `<b>${r.acoustics.summary.over}</b>` : 'none'),
    // ...and the ones the coefficients' range cannot clear: over at the
    // reflective end of every table, under at the absorptive one.
    r.acoustics.summary.maybe
      ? row('Could be over, by the range', `<span class="warn">${r.acoustics.summary.maybe}</span>`)
      : '',
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

  // Phase 15's section, and the only one that can be missing: it reads a
  // timetable, and a design that has not been given one has nothing to say
  // here rather than zeroes to print.
  if (r.utilisation && r.utilisation.has) {
    const u = r.utilisation;
    const t = u.travel.summary;
    sec('School day', [
      row(`${plural(u.summary.cohorts, 'group')} · ${plural(u.summary.sections, 'section')}`,
        `${u.summary.students} students`),
      row('Rooms working', `<b>${Math.round(u.summary.utilisation * 100)}%</b> of the day`),
      row('Empty at the busiest period', u.summary.idleAtPeak
        ? `<b>${u.summary.idleAtPeak}</b> of ${u.summary.rooms}`
        : 'none'),
      row('Walk per student per day', `<b>${ft(t.perDay)} ft</b> · ${t.milesPerYear.toFixed(1)} mi/yr`),
      t.worst
        ? row('Longest move between bells', `<b>${ft(t.worst.dist)} ft</b> / ${Math.round(t.worst.seconds)} s`)
        : row('Moves between bells', 'nobody changes room'),
      row('Moves that miss the bell', t.late
        ? `<span class="warn">${t.late}</span>` : 'none'),
    ]);
  }

  // Phase 16's section, and the second one that can be missing: it reads a
  // rate table, and a design nobody has priced has nothing here to say rather
  // than a column of zeroes. `cost.has` is the same flag `utilisation.has` is.
  if (r.cost && r.cost.has) {
    const c = r.cost.summary;
    const top = r.cost.bySystem[0];
    const worst = r.cost.worstRooms[0];
    sec('Cost', [
      row('<b>Estimate</b>', `<b>${c.symbol}${ft(c.total)}</b>`),
      row('Per square foot', `${c.symbol}${c.perSqft.toFixed(2)}`),
      top ? row('Biggest system', `${esc(top.label)} · ${Math.round(top.share * 100)}%`) : '',
      worst ? row('Dearest room',
        `${esc(worst.name || 'unnamed')} · ${c.symbol}${ft(worst.cost)}`) : '',
      row('Not in any room', `${Math.round(c.sharedShare * 100)}%`),
      row('Unpriced assemblies', c.unpriced
        ? `<span class="warn">${c.unpriced}</span>` : 'none'),
    ]);
  }

  // Phasing, when there is a plan. The cumulative column is the one a funding
  // schedule is written against, so it is the one printed.
  if (r.phasing && r.phasing.has) {
    const p = r.phasing;
    sec('Phasing', [
      ...p.rows.map((ph) => row(
        `${esc(ph.name)}${ph.shared ? ' <span class="warn">+shared</span>' : ''}`,
        `<b>${p.symbol}${ft(ph.cumulative)}</b>`)),
      p.unassigned
        ? row('<span class="warn">Not in any phase</span>',
          `${p.symbol}${ft(p.unassigned.cost)}`)
        : '',
      p.shared ? row('Shared &amp; sitework', `${p.symbol}${ft(p.shared.cost)}`) : '',
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

// A finding is a headline until you ask it why — and since Phase 19, an
// address once you ask where.
$('report-findings').addEventListener('click', (e) => {
  const goto = e.target.closest('.goto');
  if (goto) { showFinding(Number(goto.dataset.goto)); return; }
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
  railUnfold(reportPanel);
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

// --- what it costs ---
//
// Phase 16. The rate table, the estimate it produces and the phasing plan, in
// one sheet — because they are one conversation: these are the prices, this is
// what they come to, and this is the order it gets built in.
//
// **Everything in here is an edit to the design.** A rate is not a session
// preference and a phase is not a view setting: both travel in the file, both
// go on the undo stack, and both mark the report stale the same way moving a
// wall does. That is the whole reason `rates` and `phasing` are save keys
// rather than localStorage.
const costOverlay = $('cost-overlay');

const download = (text, name, type = 'text/csv;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

const ratesNow = () => normalizeRates(state.rates);
const phasingNow = () => phasingOf(state);

function commitRates(next) {
  editor.pushUndo();
  const r = normalizeRates(next);
  if (isEmptyRates(r)) delete state.rates; else state.rates = r;
  autosave(state);
  reportBuild();
  renderCostSheet();
  updateUndoButtons();
}

function commitPhasing(next) {
  editor.pushUndo();
  const p = normalizePhasing(next);
  if (isEmptyPhasing(p)) delete state.phasing; else state.phasing = p;
  autosave(state);
  reportBuild();
  renderCostSheet();
  updateUndoButtons();
}

// How much of each assembly this design contains — the column that says which
// of sixty rows are worth filling in. Read off the report rather than
// recomputed, which is why the sheet asks for a fresh one when it opens.
function assemblyQuantities() {
  const map = new Map();
  const cost = report.data && report.data.cost;
  if (cost) for (const l of cost.lines) map.set(l.key, l.qty);
  return map;
}

function renderRateRows() {
  const rates = ratesNow();
  const byKey = new Map(rates.rows.map((r) => [r.key, r]));
  const qty = assemblyQuantities();
  const host = $('cost-rows');
  let html = '';
  let system = null;
  // In use first inside each system: the rows that matter to *this* design are
  // the ones somebody is going to type into, and making them hunt is how a
  // rate table stays empty.
  const rows = assemblies().slice().sort((a, b) =>
    (qty.get(b.key) ? 1 : 0) - (qty.get(a.key) ? 1 : 0) || a.label.localeCompare(b.label));
  for (const sys of [...new Set(assemblies().map((a) => a.system))]) {
    const mine = rows.filter((a) => a.system === sys);
    if (!mine.length) continue;
    if (sys !== system) { html += `<div class="grp">${esc(systemEntry(sys).label)}</div>`; system = sys; }
    for (const a of mine) {
      const row = byKey.get(a.key);
      const q = qty.get(a.key) || 0;
      html += `<div class="rate-row${q > 0 ? ' used' : ''}" data-key="${esc(a.key)}">` +
        `<span class="name" title="${esc(a.label)}">${esc(a.label)}</span>` +
        `<span class="qty">${q > 0 ? `${ft(q)} ${a.unit}` : '—'}</span>` +
        `<input type="number" min="0" step="0.01" data-field="rate" ` +
        `placeholder="per ${esc(a.unit)}" value="${row ? row.rate : ''}" ` +
        `aria-label="${esc(a.label)} rate" />` +
        `<input type="text" data-field="date" maxlength="10" placeholder="${esc(rates.date || 'YYYY-MM-DD')}" ` +
        `value="${esc(row && row.date ? row.date : '')}" aria-label="${esc(a.label)} date" />` +
        `<input type="text" data-field="source" maxlength="120" placeholder="${esc(rates.source || 'source')}" ` +
        `value="${esc(row && row.source ? row.source : '')}" aria-label="${esc(a.label)} source" />` +
        '</div>';
    }
  }
  host.innerHTML = html;
  const unknown = rates.rows.filter((r) => !assemblies().some((a) => a.key === r.key));
  $('cost-unknown').textContent = unknown.length
    ? `${plural(unknown.length, 'rate')} in this file are for assemblies this build ` +
      'does not measure. They are kept and saved, and they price nothing here.'
    : '';
}

function renderCostReadout() {
  const cost = report.data && report.data.cost;
  const host = $('cost-readout');
  if (!cost || !cost.has) {
    host.innerHTML = '<div class="row"><span>Nothing is priced yet.</span>' +
      '<span>Fill in a rate.</span></div>';
    return;
  }
  const c = cost.summary;
  const row = (a, b) => `<div class="row"><span>${a}</span><span>${b}</span></div>`;
  const parts = [
    row('<b>Estimate</b>', `<b>${c.symbol}${ft(c.total)}</b>`),
    row('Per square foot', `${c.symbol}${c.perSqft.toFixed(2)} over ${ft(c.area)} ft²`),
    ...cost.bySystem.map((sy) =>
      row(esc(sy.label), `${c.symbol}${ft(sy.cost)} · ${Math.round(sy.share * 100)}%`)),
    row('Priced assemblies', `${c.priced} of ${c.assemblies}`),
    row('Unpriced', c.unpriced
      ? `<span class="warn">${c.unpriced} counted as zero</span>` : 'none'),
  ];
  if (cost.worstRooms.length) {
    parts.push(row('<b>Dearest rooms</b>', 'cost · per ft²'));
    for (const r of cost.worstRooms) {
      parts.push(row(esc(r.name || 'unnamed room'),
        `${c.symbol}${ft(r.cost)} · ${c.symbol}${r.perSqft.toFixed(0)}/ft²`));
    }
  }
  host.innerHTML = parts.join('');
}

function renderPhaseList() {
  const plan = report.data && report.data.phasing;
  const phasing = phasingNow();
  const host = $('phase-list');
  if (!phasing.phases.length) {
    host.innerHTML = '<div class="empty">No phasing plan — the whole building at once.</div>';
    $('phase-rooms').innerHTML = '';
    return;
  }
  const costOf = new Map(plan ? plan.rows.map((r) => [r.id, r]) : []);
  host.innerHTML = phasing.phases.map((p, i) => {
    const r = costOf.get(p.id);
    return `<div class="phase-row" data-phase="${esc(p.id)}">` +
      `<input type="text" maxlength="60" value="${esc(p.name)}" data-field="name" aria-label="Phase name" />` +
      `<span class="phase-meta">${r ? `${plural(r.rooms, 'room')} · ${ft(r.area)} ft²` : '—'}</span>` +
      `<span class="phase-meta">${r && plan ? `${plan.symbol}${ft(r.cost)}` : ''}</span>` +
      `<button data-act="shared" class="${p.shared ? 'primary' : ''}" ` +
      `title="This phase carries the roof, the sitework and the lifts">🏗</button>` +
      `<button data-act="up" ${i === 0 ? 'disabled' : ''} title="Earlier">↑</button>` +
      `<button data-act="down" ${i === phasing.phases.length - 1 ? 'disabled' : ''} title="Later">↓</button>` +
      `<button data-act="del" title="Remove this phase">✖</button>` +
      '</div>';
  }).join('');

  // One select per room. Not a selection tool: a phasing plan is edited once
  // and read many times, and a list somebody can tab through beats a mode
  // they have to enter.
  const opts = (sel) => ['<option value="">—</option>',
    ...phasing.phases.map((p) =>
      `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`)].join('');
  const of = new Map();
  for (const p of phasing.phases) for (const id of p.rooms) of.set(id, p.id);
  let html = '';
  state.floors.forEach((floor, i) => {
    const shapes = floor.shapes || [];
    if (!shapes.length) return;
    html += `<div class="grp">${esc(floorLabel(i))}</div>`;
    for (const shape of shapes) {
      const id = roomIdOf(i, shape);
      html += `<div class="room-row" data-room="${esc(id)}">` +
        `<span>${esc(shape.name || '(unnamed)')}</span>` +
        `<select aria-label="Phase for ${esc(shape.name || 'unnamed room')}">${opts(of.get(id) || '')}</select>` +
        '</div>';
    }
  });
  $('phase-rooms').innerHTML = html;
}

function renderCostSheet() {
  if (costOverlay.classList.contains('hidden')) return;
  const rates = ratesNow();
  const summary = ratesSummary(rates);
  const warn = $('cost-warning');
  if (summary.example) {
    warn.textContent = 'These are the shipped worked-example rates. They are ' +
      'order-of-magnitude US figures, they are not a bid, they are not local ' +
      'to you, and every total below inherits that. Type over them.';
    warn.classList.remove('hidden');
  } else if (summary.empty) {
    warn.textContent = 'No rates yet. Nothing below is priced, and that is the ' +
      'honest answer until somebody tells this tool what things cost.';
    warn.classList.remove('hidden');
  } else warn.classList.add('hidden');

  $('cost-currency').value = rates.currency;
  $('cost-date').value = rates.date || '';
  $('cost-source').value = rates.source || '';
  renderRateRows();
  renderCostReadout();
  renderPhaseList();
}

$('cost-currency').innerHTML = CURRENCIES
  .map((c) => `<option value="${c}">${c}</option>`).join('');

$('cost-open').addEventListener('click', () => {
  if (report.stale || !report.data) reportBuild();
  openModal(costOverlay, $('cost-currency'));
  renderCostSheet();
});
$('cost-close').addEventListener('click', () => closeModal(costOverlay));

$('cost-currency').addEventListener('change', (e) => {
  commitRates({ ...ratesNow(), currency: e.target.value });
});
$('cost-date').addEventListener('change', (e) => {
  commitRates({ ...ratesNow(), date: e.target.value });
});
$('cost-source').addEventListener('change', (e) => {
  commitRates({ ...ratesNow(), source: e.target.value });
});

// Typing a rate is an edit; typing a date or a source beside a rate that isn't
// there yet is not, because there is no row to hang it on.
$('cost-rows').addEventListener('change', (e) => {
  const input = e.target.closest('input');
  const host = input && input.closest('.rate-row');
  if (!host) return;
  const key = host.dataset.key;
  const field = input.dataset.field;
  const rates = ratesNow();
  const row = rates.rows.find((r) => r.key === key) || null;
  if (field === 'rate') {
    const raw = input.value.trim();
    commitRates(setRate(rates, key, raw === '' ? null : Number(raw)));
    return;
  }
  if (!row) { input.value = ''; return; }
  commitRates(setRate(rates, key, row.rate, { [field]: input.value }));
});

$('cost-example').addEventListener('click', () => {
  if (!isEmptyRates(ratesNow()) &&
    !confirm('Replace the rate table with the worked example?')) return;
  commitRates(exampleRates());
});
$('cost-clear').addEventListener('click', () => {
  if (isEmptyRates(ratesNow())) return;
  if (!confirm('Empty the rate table? Nothing will be priced.')) return;
  commitRates(emptyRates());
});
$('cost-export').addEventListener('click', () => {
  download(ratesCSV(ratesNow(), { quantities: assemblyQuantities() }), 'school-rates.csv');
});
$('cost-import').addEventListener('click', () => $('cost-file').click());
$('cost-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const res = importRatesCSV(await file.text(), { merge: ratesNow() });
  if (!res.found) { alert('No Key and Rate columns in that file.'); return; }
  commitRates(res.rates);
  // Said out loud rather than swallowed: an import that quietly drops eleven
  // rates is an import that prices a different building.
  alert(`Read ${plural(res.read, 'rate')}.` +
    (res.skipped ? ` ${plural(res.skipped, 'row')} had no usable number.` : '') +
    (res.unknown ? ` ${res.unknown} are for assemblies this build does not measure — kept, unused.` : ''));
});

$('cost-csv').addEventListener('click', () => {
  if (report.stale || !report.data) reportBuild();
  const r = report.data;
  const parts = [];
  if (r.spec) parts.push(specCSV(r.spec));
  if (r.cost) parts.push(costCSV(r.cost));
  if (r.phasing && r.phasing.has) parts.push(phasingCSV(r.phasing));
  download(parts.join('\r\n'), 'school-cost.csv');
});

$('phase-storey').addEventListener('click', () => commitPhasing(phaseByStorey(state)));
$('phase-add').addEventListener('click', () => commitPhasing(addPhase(phasingNow())));
$('phase-clear').addEventListener('click', () => {
  if (isEmptyPhasing(phasingNow())) return;
  if (!confirm('Drop the phasing plan? The building is costed all at once again.')) return;
  commitPhasing(emptyPhasing());
});

$('phase-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const host = btn && btn.closest('.phase-row');
  if (!host) return;
  const id = host.dataset.phase;
  const p = phasingNow();
  if (btn.dataset.act === 'up') commitPhasing(movePhase(p, id, -1));
  else if (btn.dataset.act === 'down') commitPhasing(movePhase(p, id, 1));
  else if (btn.dataset.act === 'shared') commitPhasing(claimShared(p, id));
  else if (btn.dataset.act === 'del') commitPhasing(removePhase(p, id));
});
$('phase-list').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-field="name"]');
  const host = input && input.closest('.phase-row');
  if (!host) return;
  commitPhasing(renamePhase(phasingNow(), host.dataset.phase, input.value));
});

$('phase-rooms').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  const host = sel && sel.closest('.room-row');
  if (!host) return;
  commitPhasing(assignRooms(phasingNow(), sel.value || null, [host.dataset.room]));
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
  // One frame, so the status line paints before a second of arithmetic — and
  // before the generator itself is fetched, which is the other thing that
  // makes this button take a moment the first time.
  requestAnimationFrame(async () => {
    try {
      const { layoutSchool, buildSchool, generationSummary } = await generateModule();
      const plan = layoutSchool(genBrief);
      const next = buildSchool(plan, { furnish });
      adoptState(next);
      // A generated school is a new document with no file behind it, whatever
      // was open before it.
      fileSession = makeFileSession('new');
      syncFileChrome();
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
    openWalkOverlay();
  }
}

// --- Phase 40: the chair ---
//
// One toggle, and everything it changes lives in walkthrough.js and
// clearance.js: the eye, the body, the rules. What this file owes it is the
// ear (audio reads the storey off the same eye height) and the button.
function setSeated(on) {
  walk.setSeated(on);
  audio.setEyeHeight(walk.eyeH);
  const b = $('walk-seated');
  if (b) {
    b.setAttribute('aria-pressed', String(walk.seated));
    b.textContent = walk.seated ? '♿ Seated — stand up' : '♿ Sit in the chair';
  }
}
$('walk-seated').addEventListener('click', () => setSeated(!walk.seated));

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
  // The palette's own key, first and in both modes — Ctrl-K is the one
  // shortcut that must work even while something else has the keyboard.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
    e.preventDefault();
    cmdkIsOpen() ? cmdkClose() : cmdkOpen();
    return;
  }
  if (e.code === 'Escape' && cmdkIsOpen()) { cmdkClose(); return; }
  // Phase 30. First, above every overlay: a demonstration has the pointer,
  // and Escape is what a person presses when something is moving on its own.
  if (e.code === 'Escape' && demoRunning()) {
    demoStop('Stopped. Ctrl+Z takes back whatever it drew.');
    return;
  }
  if (e.code === 'Escape' && !$('welcome-overlay').classList.contains('hidden')) {
    closeModal($('welcome-overlay')); return;
  }
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
    paAnnounce(); return;
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
    // **The last resort, and the one that had been missing.** Walking is armed
    // by one of three things: a pointer lock that arrived, the 400ms probe
    // below `walk-start` that notices when one did not, or a touch. Every one
    // of them can be missed — a lock that resolved after the probe and was
    // then released, a page that was never given the pointer and whose
    // `pointerlockerror` the browser did not fire, an overlay dismissed some
    // other way — and when they all are, walk mode is *input-dead*: WASD does
    // nothing, the mouse does nothing, and there is nothing on screen that
    // says why. A movement key is an unambiguous statement that the person
    // meant to walk, so it arms the drag fallback itself rather than being
    // eaten.
    if (WALK_MOVE_KEYS.has(e.code) && !isTouch && !photoMode
        && !walk.controls.isLocked && !walk.mouseLook) {
      startMouseLookWalk('key');
      // Not returned: the key is also a movement key, and walkthrough.js's own
      // listener has to see it to start moving on this very press.
    }
    // Phase 22's hands, first: while something is carried, R belongs to the
    // thing in your hands rather than to the tour recorder.
    if (e.code === 'KeyQ' && !photoMode && !tourPlay) { handsAction(); return; }
    if (e.code === 'KeyX' && hands) { handsCancel(); return; }
    if (e.code === 'KeyR' && hands) {
      handsRotate(e.shiftKey ? -HANDS_ROT : HANDS_ROT);
      return;
    }
    {
      const dig = /^Digit([1-8])$/.exec(e.code);
      if (dig && !photoMode && !tourPlay) { handsArm(Number(dig[1]) - 1); return; }
      // ...and 9, the whole catalog (Phase 36). Free in walk mode — it is the
      // stair tool's key only while editing.
      if (e.code === 'Digit9' && !photoMode && !tourPlay) { walkPickOpen(); return; }
    }
    if (e.code === 'KeyT') {
      const on = document.body.classList.toggle('tours');
      if (on) renderTourPanel();
      return;
    }
    if (e.code === 'KeyJ') { miniOn = !miniOn; updateMinimapButtons(); return; }
    if (e.code === 'KeyR') { tourMark(); return; }
    // Phase 21's one: how room labels are earned. I as in "what am I looking
    // at" — cycles earned → line-of-sight → all → none.
    if (e.code === 'KeyI') { cycleLabelMode(); return; }
    // Phase 10's one: the findings, on the map in your hand. Bracket keys
    // step through them, which is the same gesture as the report panel's own
    // list read top-down.
    if (e.code === 'KeyO') { setMiniFindings(!miniFindings); return; }
    // Phase 11's one: start (or give up on) the scavenger hunt without going
    // back out to the overlay for it — the overlay costs you the pointer lock,
    // and losing the pointer lock in the middle of a hunt is losing the hunt.
    if (e.code === 'KeyG') { $('walk-hunt').click(); return; }
    // Phase 40: the chair. Z because it was the last free letter, and
    // because sitting down is the one gesture nothing else in a walk makes.
    if (e.code === 'KeyZ') { setSeated(!walk.seated); return; }
    if (e.code === 'BracketLeft') { stepMiniFinding(-1); return; }
    if (e.code === 'BracketRight') { stepMiniFinding(1); return; }
    if (e.code === 'Enter' && document.body.classList.contains('tours')) {
      tourPlay ? tourStop() : tourStart(false);
      return;
    }
    // Escape stops a tour before it stops the walkthrough.
    if (e.code === 'Escape' && tourPlay) { tourStop(); e.preventDefault(); return; }
    // With a locked pointer Escape releases it and the `unlock` listener puts
    // the overlay back. There is nothing to release in the drag fallback, so
    // the same key has to raise the overlay itself.
    if (e.code === 'Escape' && walk.mouseLook && !photoMode) {
      openWalkOverlay();
      e.preventDefault();
      return;
    }
  }
  if (mode !== 'edit' || typing) return;
  // Enter / Escape / Backspace / Delete belong to the polygon tools while one
  // of them is holding an outline or a selection.
  if (!e.ctrlKey && !e.metaKey && editor.handleKey(e)) {
    e.preventDefault();
    autosave(state);
    updateUndoButtons();
    // S, R and the stair tool's keys change settings and selections the tool
    // panels display. The editor owns them; the panels have to catch up.
    syncToolPanels();
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
  // Phase 30. The three keys every program that owns a document has had for
  // thirty years, and the reason they route through here rather than through
  // a tool: Ctrl-combos are main.js's, and a browser that keeps its own Save
  // dialog for Ctrl+S has to be told, every time, that this page has one.
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
    e.preventDefault();
    fileSave({ as: e.shiftKey });
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
    e.preventDefault();
    fileOpen();
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

window.addEventListener('beforeunload', (e) => {
  autosaveNow(state);
  // Only ever when a *file* would lose something: the autosave has covered
  // everything else since v1, and a tool that asks "are you sure" over work it
  // has already kept is a tool crying wolf. See filestore.js.
  if (shouldWarnOnClose(fileSession, fileWorld)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('resize', () => { renderApi.resize(); reserveForFloorPanel(); });

// --- the command palette (Phase 19) ---
//
// Ctrl-K, fuzzy-matched over every tool, verb and toggle this file wires.
// The one rule, from the wishlist's own collision note: the palette routes
// through the same handlers the hotkeys route through — every `run` below is
// the click or the call the key already makes, so there is exactly one
// keymap and the palette is its index. Each result prints its hotkey, which
// is what makes the palette the cheat-sheet tutor rather than a rival to it.

const cmdkOverlay = $('cmdk-overlay');
const cmdkInput = $('cmdk-input');
const cmdkList = $('cmdk-list');

const TOOL_NAMES = {
  floor: 'Floor', wall: 'Wall', door: 'Door', room: 'Room', erase: 'Erase',
  poly: 'Polygon', vertex: 'Shape', prop: 'Furniture', stair: 'Stairs',
  template: 'Layout', site: 'Site', overlay: 'Overlay', section: 'Section',
  anno: 'Annotate',
};
const TOOL_HOTKEY = {
  floor: '1', wall: '2', door: '3', room: '4', erase: '5', poly: '6',
  vertex: '7', prop: '8', stair: '9', template: '0', site: '-', overlay: '=',
  section: '\\', anno: `'`,
};

// Built fresh at each opening: half the labels depend on where you are
// standing (Walk vs Edit, Populate vs Clear), and forty objects is nothing.
function cmdkCommands() {
  const out = [];
  const walkFirst = (fn) => () => { if (mode !== 'walk') setMode('walk'); fn(); };
  for (const [t, key] of Object.entries(TOOL_HOTKEY)) {
    out.push({
      name: `Tool: ${TOOL_NAMES[t]}`, hint: HINTS[t], keys: [key],
      run: () => { if (mode !== 'edit') setMode('edit'); selectTool(t); },
    });
  }
  out.push(
    { name: mode === 'walk' ? 'Back to the editor' : 'Walk through the building',
      hint: 'First person — walls stop you, doors open, stairs climb', keys: ['Tab'],
      run: () => setMode(mode === 'edit' ? 'walk' : 'edit') },
    { name: 'Generate a school…', hint: 'A whole building from a student count and a sentence',
      keys: [], run: () => $('gen-btn').click() },
    { name: 'New empty school', hint: 'A blank sheet — the current design stays in undo',
      keys: [], run: () => $('new-btn').click() },
    { name: 'Walk a finished school…', hint: 'Three of them, embedded — one click to walking',
      keys: [], run: openWelcome },
    { name: 'Save', hint: saveHint(fileSession, fileWorld), keys: ['Ctrl', 'S'],
      run: () => fileSave() },
    { name: 'Save As…', hint: `Write the design to a ${FILE_EXT} file you choose`,
      keys: ['Ctrl', '⇧', 'S'], run: () => fileSave({ as: true }) },
    { name: 'Open a design…', hint: modeNote(fileWorld), keys: ['Ctrl', 'O'],
      run: () => fileOpen() },
    { name: 'Saved designs…', hint: 'Named designs kept in this browser',
      keys: [], run: () => $('designs-btn').click() },
    { name: 'Export plans…', hint: 'Printable sheets — PNG, PDF, or the building as glTF',
      keys: [], run: () => $('export-btn').click() },
    { name: 'Share a link…', hint: 'The whole design in a URL, nothing uploaded',
      keys: [], run: () => $('share-btn').click() },
    { name: 'Session — draw with somebody', hint: 'Two people, one plan',
      keys: [], run: () => $('session-btn').click() },
    { name: 'Costs & phasing…', hint: 'The rate table, the estimate, the build order',
      keys: [], run: () => $('cost-open').click() },
    { name: 'Undo', hint: 'Take the last edit back', keys: ['Ctrl', 'Z'],
      run: () => $('undo-btn').click() },
    { name: 'Redo', hint: 'Put it back again', keys: ['Ctrl', 'Y'],
      run: () => $('redo-btn').click() },
    { name: 'Report panel', hint: 'Occupancy, egress, daylight, acoustics — the verdicts',
      keys: ['M'], run: () => $('report-btn').click() },
    { name: 'Sky panel', hint: 'The sun, the date, the building’s lights',
      keys: ['Y'], run: () => $('env-btn').click() },
    { name: 'Sound panel', hint: 'The mix, and how the room you’re in rings',
      keys: ['U'], run: () => $('audio-btn').click() },
    { name: 'School life panel', hint: 'People in the building, on a bell schedule',
      keys: ['L'], run: () => $('life-btn').click() },
    { name: life.on ? 'Clear the crowd' : 'Populate the building',
      hint: 'Students and staff walking their timetable', keys: [],
      run: () => $('life-toggle').click() },
    { name: life.drill ? 'End the fire drill' : 'Fire drill',
      hint: 'Sound the alarm, route everyone to the nearest exit', keys: ['K'],
      run: () => lifeSetDrill(!life.drill) },
    { name: 'Crowd heatmap', hint: 'Where the crowd has been', keys: ['H'],
      run: () => $('life-heat').click() },
    { name: 'Ring the bell', hint: 'From the bells the design holds, or where you stand',
      keys: ['B'], run: () => $('audio-bell').click() },
    { name: 'PA announcement', hint: 'Play one over the speakers', keys: ['N'],
      run: () => $('audio-pa').click() },
    { name: 'Toggle post-processing', hint: 'Bloom, ambient occlusion, depth of field',
      keys: [], run: () => $('fx-btn').click() },
    { name: 'Floor up', hint: 'Edit the storey above', keys: [']'],
      run: () => goToFloor(state.currentFloor + 1) },
    { name: 'Floor down', hint: 'Edit the storey below', keys: ['['],
      run: () => goToFloor(state.currentFloor - 1) },
    { name: 'Photo mode', hint: 'A lens on the walkthrough — FOV, focus, exposure',
      keys: ['P'], run: walkFirst(() => setPhotoMode(true)) },
    { name: walk.seated ? 'Stand up' : 'Sit in the chair',
      hint: 'Seated walkthrough — eye at 48 in, a half-inch threshold, ramps and the lift, 32 in doors',
      keys: ['Z'], run: walkFirst(() => setSeated(!walk.seated)) },
    { name: 'Minimap', hint: 'The plan in your hand, while walking', keys: ['J'],
      run: walkFirst(() => { miniOn = !miniOn; updateMinimapButtons(); }) },
    { name: `Room labels: ${labelMode}`, hint: 'Earned by sight, strict line-of-sight, all, or none',
      keys: ['I'], run: walkFirst(cycleLabelMode) },
    { name: 'Findings on the minimap', hint: 'The report drawn onto the plan, worst first',
      keys: ['O'], run: walkFirst(() => setMiniFindings(!miniFindings)) },
    { name: 'Scavenger hunt', hint: 'Eight things hidden around the building',
      keys: ['G'], run: walkFirst(() => $('walk-hunt').click()) },
    { name: 'Late for class', hint: 'A timetable row and a tardy bell — beat the clock there',
      keys: [], run: walkFirst(() => $('walk-late').click()) },
    { name: normalizeHaunt(state.haunt).on
        ? 'Lights out: armed — disarm the haunted export'
        : 'Lights out — haunt the walk export…',
      hint: 'The exported walk becomes something else after dark. Off by default.',
      keys: [], run: hauntArmDialog },
    { name: hands ? 'Set down what you are carrying' : 'Pick up furniture',
      hint: 'Walk-mode hands — carry a prop, or a palette piece on 1–8; R turns it, X cancels',
      keys: ['Q'], run: walkFirst(handsAction) },
    { name: 'Browse the catalog in walk mode',
      hint: 'Search every prop there is and take one in hand — 1–8 stay the quick ring',
      keys: ['9'], run: walkFirst(walkPickOpen) },
    { name: 'Guided tours', hint: 'Record a camera path, play it, film it',
      keys: ['T'], run: walkFirst(() => {
        if (document.body.classList.toggle('tours')) renderTourPanel();
      }) },
  );
  // Phase 30. The lesson is the smoke test with the labels back on — see
  // demo.js — so a tool that stops answering the gesture fails CI rather than
  // teaching somebody the wrong thing.
  for (const d of demoCommands()) {
    out.push({ name: d.name, hint: d.hint, keys: [], run: () => demoStart(d.id) });
  }
  if (demoRunning()) {
    out.push({ name: 'Stop the demonstration', hint: 'Give the pointer back', keys: ['Esc'],
      run: () => demoStop('Stopped. Ctrl+Z takes back whatever it drew.') });
  }
  out.push(offline.prompt
    ? { name: INSTALL_LABEL, hint: 'A window of its own, and it opens with the network off',
      keys: [], run: installApp }
    : { name: 'Offline status', hint: offlineStatus(offline), keys: [],
      run: () => { $('status').textContent = offlineStatus(offline); } });
  for (const m of MOODS) {
    out.push({
      name: `Sky: ${m.label.toLowerCase()}`, hint: 'Time and lights in one click',
      keys: [], run: () => setMood(m.key),
    });
  }
  for (const m of WEATHER_MOODS) {
    out.push({
      name: `Weather: ${m.label.toLowerCase()}`,
      hint: 'One click beside the moods — the same click puts the sky back',
      keys: [], run: () => setWeatherMood(m.key),
    });
  }
  return out;
}

// Subsequence fuzzy match: every query character in order, scored toward
// word starts and unbroken runs. Small on purpose — the list is forty rows,
// not a codebase.
function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = String(text || '').toLowerCase();
  if (!q) return 0;
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    streak = at === ti && ti > 0 ? streak + 1 : 1;
    const wordStart = at === 0 || ' :…—-'.includes(t[at - 1]);
    score += streak * 2 + (wordStart ? 3 : 0) - Math.min(3, (at - ti) * 0.1);
    ti = at + 1;
  }
  return score;
}

let cmdkItems = [];
let cmdkSel = 0;

function cmdkRender() {
  const q = cmdkInput.value.trim();
  const all = cmdkCommands();
  cmdkItems = q
    ? all
      .map((c) => ({ c, s: Math.max(fuzzyScore(q, c.name) * 2, fuzzyScore(q, c.hint)) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c)
    : all;
  cmdkItems = cmdkItems.slice(0, 12);
  cmdkSel = Math.min(cmdkSel, Math.max(0, cmdkItems.length - 1));
  cmdkList.innerHTML = cmdkItems.length
    ? cmdkItems.map((c, i) =>
      `<button type="button" class="cmd${i === cmdkSel ? ' sel' : ''}" role="option" ` +
      `aria-selected="${i === cmdkSel}" data-cmd="${i}">` +
      `<span>${esc(c.name)}</span><span class="hint">${esc(c.hint || '')}</span>` +
      `<span class="keys">${(c.keys || []).map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` +
      `</button>`).join('')
    : '<div class="empty">Nothing matches — the twelve tools are all under "Tool:".</div>';
}

function cmdkOpen() {
  cmdkInput.value = '';
  cmdkSel = 0;
  cmdkRender();
  // A locked pointer can't aim at a palette. Released here, and the unlock
  // listener knows not to raise the walk overlay over it — the palette
  // hands the walk overlay back when it closes instead.
  if (mode === 'walk' && walk.controls.isLocked) walk.controls.unlock();
  openModal(cmdkOverlay, cmdkInput);
}
const cmdkIsOpen = () => !cmdkOverlay.classList.contains('hidden');

// After the palette leaves a walkthrough, the way back to the pointer lock
// is the walk overlay's Click to Walk — so it comes back up unless a command
// took us somewhere else (the editor, photo mode, a touch walk).
function cmdkRestoreWalk() {
  if (mode === 'walk' && !photoMode && !isTouch && !walk.controls.isLocked
    && !document.body.classList.contains('touch-walk')) openWalkOverlay();
}

function cmdkClose() {
  closeModal(cmdkOverlay);
  cmdkRestoreWalk();
}

function cmdkRun(i) {
  const c = cmdkItems[i];
  closeModal(cmdkOverlay);
  if (c) c.run();
  cmdkRestoreWalk();
}

cmdkInput.addEventListener('input', () => { cmdkSel = 0; cmdkRender(); });
cmdkInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = cmdkItems.length;
    if (n) cmdkSel = (cmdkSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    cmdkRender();
    const sel = cmdkList.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); cmdkRun(cmdkSel); return; }
  if (e.key === 'Escape') { e.stopPropagation(); cmdkClose(); }
});
cmdkList.addEventListener('click', (e) => {
  const btn = e.target.closest('.cmd');
  if (btn) cmdkRun(Number(btn.dataset.cmd));
});
cmdkOverlay.addEventListener('click', (e) => { if (e.target === cmdkOverlay) cmdkClose(); });

// --- Phase 36: the walk-mode catalog picker ---
//
// 9, in walk mode: the whole catalog, not just the digit ring. This is the
// command palette's pointer-lock dance pointed at props — opening releases
// the lock, closing hands the walk overlay back, and Click to Walk restores
// the lock with the armed ghost already waiting. The search itself is
// carry.js's `searchCatalog`, pure and tested; this is only the box it types
// into.
const walkPickOverlay = $('walkpick-overlay');
const walkPickInput = $('walkpick-input');
const walkPickList = $('walkpick-list');
let walkPickItems = [];
let walkPickSel = 0;

function walkPickRender() {
  walkPickItems = searchCatalog(PROP_CATALOG.concat(registeredRows()), walkPickInput.value, 30);
  walkPickSel = Math.min(walkPickSel, Math.max(0, walkPickItems.length - 1));
  walkPickList.innerHTML = walkPickItems.length
    ? walkPickItems.map((r, i) =>
      `<button type="button" class="cmd${i === walkPickSel ? ' sel' : ''}" role="option" ` +
      `aria-selected="${i === walkPickSel}" data-row="${i}">` +
      `<span>${esc(`${r.icon || '▫'} ${r.name}`)}</span>` +
      `<span class="hint">${esc(`${r.category} · ${r.w}×${r.d} ft · ${r.mount}`)}</span>` +
      `</button>`).join('')
    : '<div class="empty">Nothing in the catalog answers to that.</div>';
}

function walkPickOpen() {
  if (hands && hands.kind === 'move') {
    walkSay('Hands full — Q sets it down, X puts it back.');
    return;
  }
  walkPickInput.value = '';
  walkPickSel = 0;
  walkPickRender();
  if (mode === 'walk' && walk.controls.isLocked) walk.controls.unlock();
  openModal(walkPickOverlay, walkPickInput);
}
const walkPickIsOpen = () => !walkPickOverlay.classList.contains('hidden');

function walkPickClose() {
  closeModal(walkPickOverlay);
  cmdkRestoreWalk();
}

function walkPickTake(i) {
  const r = walkPickItems[i];
  closeModal(walkPickOverlay);
  if (r) handsArmType(r.type);
  cmdkRestoreWalk();
}

walkPickInput.addEventListener('input', () => { walkPickSel = 0; walkPickRender(); });
walkPickInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = walkPickItems.length;
    if (n) walkPickSel = (walkPickSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    walkPickRender();
    const sel = walkPickList.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); walkPickTake(walkPickSel); return; }
  if (e.key === 'Escape') { e.stopPropagation(); walkPickClose(); }
});
walkPickList.addEventListener('click', (e) => {
  const btn = e.target.closest('.cmd');
  if (btn) walkPickTake(Number(btn.dataset.row));
});
walkPickOverlay.addEventListener('click', (e) => { if (e.target === walkPickOverlay) walkPickClose(); });


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

// --- Phase 23: the walk you can hand to somebody ---
//
// The other door out of this dialog: not a link back into the tool but one
// self-contained .html — the design, the walk-only runtime and three.js —
// that opens from file:// with no network and no tool. The runtime template
// is built by tools/export-walk.mjs, committed like a fixture (a staleness
// test keeps it honest), and deployed beside index.html; all this button
// does is fetch it, splice the current design into its slot, and download.
// No node in sight — the bundling already happened, at commit time.
//
// The marker is the one string this file and the bundler have to agree on;
// test/export-walk.test.mjs pins it on that side.
const WALK_DESIGN_MARKER = '<!--SG-DESIGN-->';
// Phase 27: the second slot — a current bake rides along, so the handed
// file opens with the good light and computes nothing. Pinned by
// test/export-walk.test.mjs on the bundler's side.
const WALK_BAKE_MARKER = '<!--SG-BAKE-->';
let walkTemplate = null;   // fetched once per session — it never changes under us

async function downloadWalkExport() {
  const note = $('share-walk-note');
  const btn = $('share-walk');
  btn.disabled = true;
  note.textContent = 'Bundling…';
  note.className = '';
  try {
    if (!walkTemplate) {
      const resp = await fetch('./walk-template.html');
      if (!resp.ok) throw new Error(`the walk template is missing (HTTP ${resp.status})`);
      walkTemplate = await resp.text();
      if (!walkTemplate.includes(WALK_DESIGN_MARKER)) {
        walkTemplate = null;
        throw new Error('the walk template has no design slot');
      }
    }
    // The tracing image never draws in a walk, so it stays home; imported
    // models do draw, so unlike the link they come along — a file has no
    // 60 KB ceiling.
    const payload = await encodeShare(serialize(state, { omitOverlay: true }));
    // Phase 27: the light goes with the building. A bake the walk already
    // wore (or the store still holds) splices straight in; a design that was
    // never walked bakes now, in the worker, while the note says so. A bake
    // that fails is a file that opens on live lighting — never a blocked
    // export.
    let bakeText = '';
    try {
      note.textContent = 'Baking light…';
      const packed = await bakeObtain(bakeKey(state, catalogEntry));
      if (packed) bakeText = await encodeShare(encodeBakeText(packed));
    } catch { /* live light, then */ }
    note.textContent = 'Bundling…';
    const html = walkTemplate.replace(WALK_DESIGN_MARKER, () => payload)
      .replace(WALK_BAKE_MARKER, () => bakeText);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'school-walk.html';
    a.click();
    URL.revokeObjectURL(url);
    // The one visible trace of an armed haunt outside the palette: whoever
    // is about to send this file deserves to know which file it is.
    note.textContent = `${Math.round(html.length / 1024)} KB — opens anywhere, even offline.`
      + (bakeText ? ' · light baked in' : '')
      + (normalizeHaunt(state.haunt).on ? ' · haunted' : '');
  } catch (err) {
    // The likeliest failure is file:// — this page opened from disk cannot
    // fetch a sibling file, which is the one thing the no-server stance
    // cannot paper over here.
    note.textContent = `Could not build the file: ${err.message}. ` +
      '(Opened from file:? Use the deployed tool, or run node tools/export-walk.mjs --design.)';
    note.className = 'bad';
  } finally {
    btn.disabled = false;
  }
}

$('share-walk').addEventListener('click', downloadWalkExport);

// --- Phase 24: arming the night ---
//
// The whole of the tool-side UX, on purpose: one command in the palette, a
// native prompt, and the word "haunted" on the export note. No toolbar
// button, no panel — the WISHLIST's tone clause says off by default and
// invisible until asked for, and the palette is the asking. The record is
// an ordinary optional-record write, the same terms the life panel's are:
// set it, autosave, and the undo snapshots carry it from there. What it
// *does* lives entirely in the exported walk — the tool itself never turns.
function hauntArmDialog() {
  const cur = normalizeHaunt(state.haunt);
  if (cur.on) {
    if (confirm('The walk export is haunted. Disarm it?')) {
      delete state.haunt;
      autosave(state);
      $('status').textContent = 'Lights back on — the walk export is an ordinary walk again.';
    }
    return;
  }
  const a = prompt(
    'Lights out.\n\n'
    + 'The next walk export opens as an ordinary demo and slowly stops being '
    + 'one: a star hunt that turns, an emptying building, a failing sun, and '
    + 'something on the navgraph that prefers the corridor you are not looking '
    + 'down. Hand the file to somebody without further comment.\n\n'
    + 'Intensity, 0 to 1 (Enter for 0.5):', '0.5');
  if (a === null) return;
  const n = parseFloat(a);
  state.haunt = {
    on: true,
    seed: 1 + Math.floor(Math.random() * 0xfffffe),
    intensity: Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5,
  };
  autosave(state);
  $('status').textContent =
    'Lights out — the next walk export carries the night. Share → Download walkable .html, then hand it over. (Run the command again to disarm.)';
}

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
    // A link has no file behind it, and Phase 30's Save has to ask where
    // rather than silently inventing one — which is how somebody loses the
    // school they were sent.
    fileSession = noteOpened(fileSession, { source: 'link' });
    syncFileChrome();
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
      floor: walk.at.floor, mode: 'walk',
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
  if (!hidden) { railUnfold(panel); renderSessionPanel(); }
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
    fileSession = noteOpened(fileSession, { name: found.name || null, source: 'store' });
    syncFileChrome();
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
    instancing: $('export-glb-instancing').checked,
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
        `Wrote ${(bytes / 1048576).toFixed(1)} MB — ${stats.triangles.toLocaleString()} triangles` +
        (stats.instances
          ? ` written once and ${stats.instances.toLocaleString()} copies placed, ` +
            `${stats.drawn.toLocaleString()} drawn`
          : '') +
        `, in metres, one material, colours baked into the vertices.`;
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
    floor: walk.at.floor,
  };
}

function applyStop(at) {
  const cam = renderApi.walkCamera;
  cam.position.set(at.x, at.y, at.z);
  cam.quaternion.setFromEuler(new THREE.Euler(at.pitch, at.yaw, 0, 'YXZ'));
}

// Phase 33: what a stop captures of the sky, the same way `cameraStop`
// captures the camera — the live design's own hour, the mood that put it
// there (if that is how it got there), and any weather standing over it. A
// sunrise flythrough is set up on the sky panel itself, one mood per stop,
// with nothing to fill in afterwards.
function skyStop() {
  return {
    hour: state.env.minutes,
    mood: lastMoodKey,
    weather: state.weather && !isDefaultWeather(state.weather) ? state.weather : null,
  };
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
    const hasClock = k.hour != null || k.mood || k.weather;
    where.title = (i === 0 ? 'The tour starts here' : `${k.sec.toFixed(1)}s to get here${k.hold ? `, then holds ${k.hold.toFixed(1)}s` : ''}`)
      + (hasClock ? ` · sky: ${k.hour != null ? formatClock(k.hour) : 'as before'}${k.mood ? `, ${k.mood}` : ''}${k.weather ? `, ${weatherLabel(k.weather)}` : ''}` : '')
      + (k.narration ? ` · says: "${k.narration}"` : '');
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
    // Phase 33: the clock this stop carries, captured off the sky panel the
    // same way the camera is captured off the walk — one click sets it to
    // whatever the sky panel shows right now, another clears it.
    const sky = document.createElement('button');
    sky.textContent = hasClock ? '☀' : '☾';
    sky.className = hasClock ? 'has-sky' : '';
    sky.title = hasClock
      ? 'This stop sets the sky — click to stop it doing that'
      : 'Set this stop\'s sky to what the sky panel shows now';
    sky.addEventListener('click', () => {
      replaceTour(updateKey(currentTour(), i, hasClock
        ? { hour: null, mood: '', weather: null }
        : skyStop()));
      afterTourEdit();
    });
    // ...and the sentence it optionally says, native-prompted the same way a
    // design is renamed — one field, asked for once.
    const say = document.createElement('button');
    say.textContent = '💬';
    say.className = k.narration ? 'has-sky' : '';
    say.title = k.narration ? `Says: "${k.narration}" — click to change or clear` : 'Say something on arrival';
    say.addEventListener('click', () => {
      const next = prompt('Say this on arrival (blank to clear):', k.narration || '');
      if (next == null) return;
      replaceTour(updateKey(currentTour(), i, { narration: next.slice(0, MAX_NARRATION) }));
      afterTourEdit();
    });
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Remove this stop';
    del.addEventListener('click', () => { replaceTour(removeKey(currentTour(), i)); afterTourEdit(); });
    row.append(n, where, go, up, hold, sky, say, del);
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
  replaceTour(addKey(tour, cameraStop(), $('tour-clock').checked ? skyStop() : {}));
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
  restoreTourClock();
  clearTimeout(tourCaptionTimer);
  tourCaption = '';
  renderTourPanel();
}

$('tour-play').addEventListener('click', () => (tourPlay ? tourStop() : tourStart(false)));
$('tour-record').addEventListener('click', () => { if (!tourPlay) tourStart(true); });

// --- Phase 33: a stop's clock ---
//
// Playing a stop's hour, mood and weather is not an edit — the design's own
// sky is exactly what it was before the tour started, and Ctrl+Z has no
// business walking back through a flythrough. So this never touches
// `state.env` or `state.weather`; it hands the renderer a transient record
// and remembers what to put back. `sampleClock` returns nulls when a tour
// says nothing about the clock, which is the common case (every tour before
// this phase, and most new ones) and costs one object compare a frame.
let tourClockSaved = null;

function applyTourClock(clock) {
  if (clock.hour == null && !clock.mood && !clock.weather) return;
  if (!tourClockSaved) {
    tourClockSaved = { env: { ...normalizeEnv(state.env) }, weather: state.weather ? { ...state.weather } : null };
  }
  let env = normalizeEnv(state.env);
  if (clock.hour != null) env = { ...env, minutes: clock.hour };
  const mood = clock.mood && moodEntry(clock.mood);
  if (mood) env = { ...env, lights: mood.lights };
  renderApi.setEnvironment(env);
  if (clock.weather) renderApi.setWeather(normalizeWeather(clock.weather));
}

function restoreTourClock() {
  if (!tourClockSaved) return;
  renderApi.setEnvironment(normalizeEnv(tourClockSaved.env));
  renderApi.setWeather(tourClockSaved.weather);
  tourClockSaved = null;
}

// --- Phase 33: narration ---
//
// A stop's sentence, read once on arrival through the same PA path the
// morning announcement uses, and shown as a caption for the machine with no
// voices — which, since a recorded clip cannot carry synthesized speech (see
// `startTourRecording`), is every machine watching the film back rather than
// the walk.
let tourCaption = '';
let tourCaptionTimer = null;

function tourNarrate(text) {
  if (!text) return;
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (synth && !audio.muted) {
    try { synth.cancel(); synth.speak(new SpeechSynthesisUtterance(text)); } catch { /* the caption carries it */ }
  }
  tourCaption = text;
  clearTimeout(tourCaptionTimer);
  tourCaptionTimer = setTimeout(() => { tourCaption = ''; }, 6000);
  $('status').textContent = `🎬 ${text}`;
}

// The video, from the canvas the tour is already being drawn on. No new
// dependency: `captureStream` plus `MediaRecorder` is the whole of it, and the
// file that comes out is a WebM anybody can drop into a video editor.
const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}
const canRecordVideo = () => !!videoType() && typeof canvas.captureStream === 'function';

// The film canvas: a plain 2D canvas the same size as the WebGL one, redrawn
// from it every frame while recording and captured instead of it. That one
// extra blit is what lets a caption land *in* the file — `canvas` itself is
// the only thing `captureStream` ever sees, and a DOM caption over it is
// invisible to a stream taken from the canvas underneath. The Web Audio graph
// rides the same recorder without this trick (it is not tied to a canvas at
// all); synthesized speech is the one thing this file genuinely cannot carry,
// which is what makes the burned-in caption the honest answer rather than a
// missing one.
let filmCanvas = null;
let filmCtx = null;

function filmCaptionFont(h) {
  return `600 ${Math.max(14, Math.round(h * 0.032))}px system-ui, sans-serif`;
}

function drawFilmFrame() {
  if (!filmCtx) return;
  filmCtx.drawImage(canvas, 0, 0, filmCanvas.width, filmCanvas.height);
  if (!tourCaption) return;
  const w = filmCanvas.width, h = filmCanvas.height;
  filmCtx.font = filmCaptionFont(h);
  filmCtx.textAlign = 'center';
  filmCtx.textBaseline = 'alphabetic';
  const pad = Math.round(h * 0.02);
  const textW = Math.min(w - pad * 4, filmCtx.measureText(tourCaption).width);
  const boxH = Math.round(h * 0.07);
  const y = h - pad * 3;
  filmCtx.fillStyle = 'rgba(10, 12, 16, 0.72)';
  filmCtx.fillRect((w - textW) / 2 - pad, y - boxH + pad, textW + pad * 2, boxH);
  filmCtx.fillStyle = '#fff';
  filmCtx.fillText(tourCaption, w / 2, y, w - pad * 4);
}

function startTourRecording() {
  const type = videoType();
  if (!type) return;
  try {
    filmCanvas = document.createElement('canvas');
    filmCanvas.width = canvas.width;
    filmCanvas.height = canvas.height;
    filmCtx = filmCanvas.getContext('2d');
    const stream = filmCanvas.captureStream(60);
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
    // One-click film: the whole tool steps out of the way for the length of
    // the shot — every panel, the topbar, the toolbar — because the point of
    // pressing one button is a clip that looks like it was never wearing a
    // drawing program at all. None of this reaches the file either way
    // (a DOM layer is never part of `captureStream`); it is the live view
    // that gets to stop being the editor while the camera is running.
    document.body.classList.add('filming');
  } catch (err) {
    tourRecorder = null;
    filmCanvas = null;
    filmCtx = null;
    alert(`Could not record: ${err.message}`);
  }
}

function stopTourRecording() {
  document.body.classList.remove('filming');
  if (!tourRecorder) return;
  if (tourRecorder.state !== 'inactive') tourRecorder.stop();
  tourRecorder = null;
  filmCanvas = null;
  filmCtx = null;
}

// One frame of a tour. Called from the main loop instead of walk.update, and
// it is the entire runtime cost of the feature: sample, pose, done.
function tourUpdate(dt) {
  if (!tourPlay) return;
  tourPlay = stepPlayback(tourPlay, dt);
  const at = sampleTour(tourPlay.tour, tourPlay.t);
  if (at) applyStop(at);
  applyTourClock(sampleClock(tourPlay.tour, tourPlay.t));
  // The panel follows the playhead, and a stop with something to say, says it
  // — both only on the frame the playhead actually arrives at a new stop, not
  // every frame it sits there.
  if (at && at.index !== tourShown) {
    tourShown = at.index;
    renderTourPanel();
    const key = tourPlay.tour.keys[at.index];
    if (key && key.narration) tourNarrate(key.narration);
  }
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
  if (!here.rooms.length && !here.doors.length && !here.circles.length) return;

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
  // Phase 40: a turning circle that did not fit, drawn in world feet — the
  // circle that does (filled) inside the one that was wanted (dashed), so
  // the shortfall is the ring between them.
  if (here.circles.length) {
    miniCtx.strokeStyle = markLine(mark.level);
    miniCtx.lineWidth = 0.6;
    for (const c of here.circles) {
      miniCtx.setLineDash([0.8, 0.8]);
      miniCtx.beginPath();
      miniCtx.arc(c.x, c.z, Math.max(0.1, c.need), 0, Math.PI * 2);
      miniCtx.stroke();
      miniCtx.setLineDash([]);
      miniCtx.beginPath();
      miniCtx.arc(c.x, c.z, Math.max(0.1, c.r), 0, Math.PI * 2);
      miniCtx.fill();
      miniCtx.stroke();
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
  ctx.fillStyle = INK.miniPaper;
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
    // At minimap scale a section flag is bigger than a room, and so is a
    // dimension string.
    showSections: false,
    showAnnotations: false,
  });
  miniRasters.set(key, c);
  return c;
}

function drawMinimap() {
  const cam = renderApi.walkCamera;
  const floorIndex = Math.max(0, Math.min(state.floors.length - 1,
    walk.at.floor));
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
  miniCtx.fillStyle = INK.miniPaper;
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
        labelGateUpdate();
      },
      onEnd: () => {
        xrSession = null;
        walk.disableXR();
        document.body.classList.remove('xr');
        $('walk-vr').textContent = '🥽 Enter VR';
        if (mode === 'walk') openWalkOverlay();
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
let huntWarmOpts = null;    // Phase 24: the nav rides along, so the warmth is
                            // routed — a hamster one wall away reads cool the
                            // long way round, the way a temperature should

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
  huntWarmOpts = null;
  renderApi.setHunt([]);
  document.body.classList.remove('hunting');
  if (!quiet) $('status').textContent = 'Scavenger hunt ended.';
}

function huntBegin() {
  if (late) lateStop(true);
  const nav = buildNav(state);
  hunt = startHunt(nav, {
    seed: 1 + Math.floor(Math.random() * 0xfffffe),
    count: DEFAULT_COUNT,
    clear: huntClearance(),
  });
  huntWarmOpts = { nav };
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
  const warm = huntWarmth(hunt, at, huntWarmOpts || {});
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

// --- late for class (Phase 33) ---
//
// The scavenger hunt re-aimed: one destination out of the timetable instead
// of a dealt set, a tardy bell instead of a warmth band with nothing riding
// on it. Nothing here is stored either — the same bargain the hunt strikes,
// for the same reason. It borrows the hunt's own glowing marker in the scene
// (`renderApi.setHunt`/`updateHunt` take any list of `{x, z, floor, id}`
// places, and a room the timetable named is exactly that) rather than
// teaching render.js a second one.
let late = null;
let lateElapsed = 0;    // seconds on this round's own clock, since lateBegin
let lateWarmOpts = null;
let lateWarm = '';
const EMPTY_SET = new Set();

const latePanel = $('late-panel');
const lateClockEl = $('late-clock');
const lateTargetEl = $('late-target');
const lateWarmthEl = $('late-warmth');
const lateResultEl = $('late-result');

// The next bell that actually starts a class, skipping over lunch and
// dismissal — nextBell alone answers "what rings next", and what a tardy
// game wants is specifically the one a passing period ends with.
function nextPeriodBell(sched, minutes) {
  let m = minutes;
  for (let i = 0; i < 8; i++) {
    const b = nextBell(sched, m);
    if (!b) return null;
    if (b.kind === 'period') return b;
    m = b.at;
  }
  return null;
}

function lateStop(quiet = false) {
  late = null;
  lateWarmOpts = null;
  lateWarm = '';
  renderApi.setHunt([]);
  document.body.classList.remove('late');
  if (!quiet) $('status').textContent = 'Late for class ended.';
}

function lateBegin() {
  if (hunt) huntStop(true);
  const tt = timetableOf(state);
  if (isEmptyTimetable(tt)) {
    $('status').textContent = 'No timetable to be late for — build one in the Life panel first.';
    return false;
  }
  const sched = normalizeSchedule(lifeSettings().schedule);
  const bell = nextPeriodBell(sched, state.env.minutes);
  if (!bell) {
    $('status').textContent = 'No more periods today — nothing to be late for.';
    return false;
  }
  const passing = blockAt(sched, bell.at);
  const deadline = (bell.in + sched.passingMin) * 60;
  const plan = timetablePlan(tt, sched);
  const { nav } = timetableWorld();
  // A cohort actually changing rooms for the period ahead, preferred over one
  // that would just be staying put — "late for class" with nowhere to walk to
  // is not the game.
  const moving = plan.cohorts.filter((c) => c.rooms[passing.index] && c.rooms[passing.index] !== c.rooms[0]);
  const choices = moving.length ? moving : plan.cohorts.filter((c) => c.rooms[passing.index]);
  if (!choices.length) {
    $('status').textContent = 'Nobody has a room booked next period — nothing to be late for.';
    return false;
  }
  const pick = choices[Math.floor(Math.random() * choices.length)];
  late = startLate(nav, pick.rooms[passing.index], { deadline, now: 0, roomName: pick.name });
  if (!late) {
    $('status').textContent = 'That room is not on the walkable mesh — try again.';
    return false;
  }
  lateElapsed = 0;
  lateWarmOpts = { nav };
  lateWarm = '';
  renderApi.setHunt([late.place]);
  document.body.classList.add('late');
  renderLatePanel();
  return true;
}

function renderLatePanel() {
  if (!late) return;
  lateTargetEl.textContent = `${pickLabel(late)} — ${late.place.hint}.`;
  lateResultEl.className = '';
  lateResultEl.textContent = late.arrivedAt == null ? '' : lateResult(late);
  if (late.arrivedAt != null) {
    lateResultEl.classList.add(lateScore(late) >= 0 ? 'ok' : 'fail');
    lateWarmthEl.textContent = '';
    lateClockEl.textContent = '';
  }
}

// The room name reads off the timetable row rather than the place — a hunt's
// hint already names the room, but "class" is a fact about who is meeting
// there, which `classPlace` never claimed to know.
function pickLabel(l) {
  return l.place.roomName ? `Class in ${l.place.roomName}` : 'Your next class';
}

function lateUpdate(dt) {
  // Once you have arrived there is nothing left to track — the marker is
  // already gone and the score is already final.
  if (!late || late.arrivedAt != null) return;
  lateElapsed += dt;
  const at = walk.at;
  const left = late.deadline - lateElapsed;
  lateClockEl.textContent = left >= 0 ? `${Math.ceil(left)}s` : `${Math.ceil(-left)}s late`;
  lateClockEl.classList.toggle('overdue', left < 0);
  const arrived = checkLate(late, { ...at, now: lateElapsed });
  if (arrived) {
    renderApi.setHunt([]);
    $('walk-hud').textContent = lateResult(late);
    renderLatePanel();
    return;
  }
  const warm = lateWarmth(late, at, lateWarmOpts || {});
  if (warm && warm.key !== lateWarm) {
    lateWarm = warm.key;
    lateWarmthEl.innerHTML =
      `<span class="band ${warm.key}">${warm.label}</span> — <span id="late-dist"></span>ft to go`;
  }
  const d = lateWarmthEl.querySelector('#late-dist');
  if (d && warm) d.textContent = String(Math.round(warm.dist));
  renderApi.updateHunt(at, EMPTY_SET, dt);
}

$('walk-late').addEventListener('click', () => {
  if (late) { lateStop(); return; }
  if (lateBegin()) closeModal(walkOverlay);
});

// --- main loop ---
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  // Two numbers, deliberately. `dt` is the clamped one everything that
  // *animates* wants — a tab that was hidden for a minute should not advance
  // the school day by a minute in one frame. `raw` is the frame's real elapsed
  // time, and the walker gets that one: it does its own clamping and spends
  // what it is given in fixed physics steps, which is the difference between
  // a slow machine walking slowly and a slow machine looking like the keyboard
  // is broken. See FIXED_STEP in walkthrough.js.
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.1);
  // A headset drives its own frames off its own clock (see render.js's
  // enterXR), so the page's loop does nothing at all while one is running —
  // including the render call, which has to happen inside an XR frame.
  if (renderApi.xrPresenting) return;
  if (mode === 'walk') {
    // A tour has the camera; the walker does not get a vote while one plays.
    if (tourPlay) tourUpdate(dt);
    else walk.update(raw);
    audio.update(dt);
    // A tour has the camera too, and a hunt found by a camera flying itself
    // around is not a hunt.
    if (!tourPlay) { huntUpdate(dt); lateUpdate(dt); }
    // Labels earn themselves from wherever the eye is — a tour's camera
    // learns the building the same way a walker's does.
    labelGateUpdate();
    // The thing in your hands, if anything: where it would land, whether it
    // fits, and the ghost that says so.
    handsUpdate();
  }
  // The school runs in both modes. A crowd seen from 200ft up, moving between
  // periods over a plan you are drawing, is half of what this phase is for —
  // and the other half is meeting one of them in a corridor.
  lifeUpdate(dt);
  // The lifts, wherever they are being stepped from. There is one Map per
  // walk — the crowd's when a crowd is running, the walker's own otherwise —
  // and posing is reading it, so posing the same one twice would cost a
  // couple of assignments and change nothing. `walk.lifts` is that Map while
  // walking, and the crowd's is the one that matters while editing.
  renderApi.poseLifts(mode === 'walk' ? walk.lifts : (life.ctx && life.ctx.lifts));
  // Everybody else in the session: their edits, their cameras and this one's,
  // on a timer of its own. Costs nothing at all when there is no session.
  if (collab.wire) sessionTick(performance.now());
  renderApi.render(dt);
  // Drawn after the 3D frame so the map is over it, and only while walking —
  // it is a thing you carry, not a thing on the drawing board.
  if (mode === 'walk' && miniOn && !document.body.classList.contains('photo')) drawMinimap();
  // The film canvas, one blit behind the frame that was just drawn — see
  // `startTourRecording` for why a caption has to land here rather than in
  // the DOM. A no-op (one `if`) on every frame that isn't being recorded.
  drawFilmFrame();
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

// --- the opening moment (Phase 19, rebuilt in Phase 30) ---
//
// First visit, no autosave, no link that already knows where it is going:
// doors instead of a blank stare. Phase 19's three were the sample school,
// the generator and the empty sheet — each something the tool already had,
// the feature being the introduction rather than the thing introduced.
//
// Phase 30 kept that and changed which door is first. Two of the three opened
// onto *work*, and the fastest possible first minute is neither drawing nor
// describing: it is walking a building somebody else already finished. So the
// gallery goes on top, the generator and the blank sheet stay below it, and
// the sample-school door becomes the fallback for a build whose stock file
// never arrived. The first-run flag is still a fact about this browser, so
// localStorage, never the file.
const welcomeOverlay = $('welcome-overlay');
const welcomeClose = () => closeModal(welcomeOverlay);
// Declared before the block that opens the welcome on a first visit: `let` is
// not hoisted the way a function is, and `openWelcome` reaches for this on the
// one code path — the very first load — that no seeded harness ever takes.
let galleryFilled = false;

function openWelcome() {
  fillGallery();
  openModal(welcomeOverlay, $('welcome-generate'));
}

{
  const seen = () => {
    try { return localStorage.getItem('sg-welcome-seen') === '1'; } catch { return true; }
  };
  if (!restoredAutosave && !location.hash && !seen()) {
    // Marked seen at the showing, not at the choosing — a dismissed welcome
    // stays dismissed.
    try { localStorage.setItem('sg-welcome-seen', '1'); } catch { /* fine */ }
    openWelcome();
  }
  $('welcome-walk').addEventListener('click', () => {
    welcomeClose();
    // The sample school is already the state a fresh browser starts with.
    setMode('walk');
  });
  $('welcome-generate').addEventListener('click', () => {
    welcomeClose();
    openGenerator();
  });
  $('welcome-blank').addEventListener('click', () => {
    welcomeClose();
    adoptState(createState());
    fileSession = makeFileSession('new');
    syncFileChrome();
    selectTool('floor');
    $('status').textContent =
      'A blank sheet. Floor lays tiles — Ctrl+K lists every tool with its key, and “Show me” will draw one for you.';
  });
  welcomeOverlay.addEventListener('click', (e) => { if (e.target === welcomeOverlay) welcomeClose(); });
}

// --- Phase 30: a gallery on the welcome ---
//
// Three finished schools, each an embedded share payload, one click from
// walking. The stock is 90 KB and is fetched the first time the welcome opens
// rather than on every load — the cards render from their thumbnails (which
// are geometry, and live in gallery.js's own module) the moment it lands.
//
// A build whose stock file failed to arrive shows no gallery and falls back to
// the Phase 19 door it replaced: the sample school is already on the board,
// and walking it costs nothing at all.

function galleryCardEl(card) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card';
  const { size, paths } = thumbPaths(card.thumb, 100);
  const svg = `<svg class="thumb" viewBox="0 0 ${size} ${size}" aria-hidden="true">`
    + paths.map((p) => `<path d="${p.d}" fill="${p.fill}" fill-rule="evenodd"/>`).join('')
    + '</svg>';
  btn.innerHTML = `${svg}<span class="card-body">`
    + `<b>${esc(card.title)}</b>`
    + `<span class="what">${esc(card.line)}</span>`
    + `<span class="facts">${esc(card.factLine)}</span></span>`;
  btn.addEventListener('click', () => { welcomeClose(); openCard(card); });
  return btn;
}

async function fillGallery() {
  if (galleryFilled) return;
  galleryFilled = true;
  const rail = $('welcome-gallery');
  try {
    const { STOCK } = await galleryStock();
    const cards = galleryCards(STOCK);
    if (!cards.length) throw new Error('no usable cards');
    rail.textContent = '';
    for (const card of cards) rail.appendChild(galleryCardEl(card));
    rail.classList.remove('hidden');
    $('welcome-or').classList.remove('hidden');
    $('welcome-walk').classList.add('hidden');
    // The modal opened before the stock landed, so focus is on the first door
    // below. Move it to the first card — but only if nobody has moved it
    // themselves in the meantime, which is the whole difference between
    // helping and grabbing.
    if (document.activeElement === $('welcome-generate')) rail.firstChild.focus();
  } catch {
    // Not an error worth a sentence: the tool's own sample school is one
    // click away in the door this was meant to replace, so show that instead.
    galleryFilled = false;
    rail.classList.add('hidden');
    $('welcome-or').classList.add('hidden');
    $('welcome-walk').classList.remove('hidden');
  }
}

async function openCard(card) {
  $('status').textContent = `Opening ${card.title}…`;
  try {
    const design = deserialize(await decodeShare(card.payload), { onMigrate });
    // Same door a shared link comes through, and for the same reason: the
    // autosave is left alone until the card is edited, so trying one out
    // does not cost somebody the design they had open.
    adoptState(design, { keepAutosave: true });
    fileSession = noteOpened(fileSession, { name: card.title, source: 'card' });
    syncFileChrome();
    migrationNote = null;
    setMode('walk');
    $('status').textContent =
      `${card.title} — ${card.factLine}. Walk it; Tab goes back to the plan, and Save keeps it.`;
  } catch (err) {
    $('status').textContent = `That school could not be opened: ${err.message}`;
  }
}

// --- Phase 30: installable, and offline ---
//
// The registration is deliberately fire-and-forget and deliberately loud about
// nothing: a browser without module service workers rejects it, the tool is
// exactly what it was, and the one place that says so is the offline row in
// the palette. See offline.js for every decision the worker makes; see sw.js
// for the three listeners that are all it is.

const offline = {
  registered: false, controlling: false, error: '', rev: OFFLINE_REV, prompt: null,
};

{
  const can = registrable({});
  if (!can.ok) {
    offline.error = can.why;
  } else {
    // `updateViaCache: 'none'`: the default is `'imports'`, under which the
    // worker itself is always fetched fresh but the module it imports comes
    // out of the HTTP cache — and this worker keeps *every* decision it makes
    // in that module, so a stale `offline.js` is a stale worker wearing a
    // fresh one's name.
    navigator.serviceWorker.register('./sw.js',
      { type: 'module', scope: './', updateViaCache: 'none' })
      .then(() => {
        offline.registered = true;
        offline.controlling = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener(
          'controllerchange', () => { offline.controlling = true; });
      })
      .catch((err) => {
        offline.error = err && err.message
          ? err.message
          : 'the browser would not register the worker';
      });
  }
}

// Fires on exactly one engine family and never on the rest, which is why the
// palette row it enables is created by the event rather than waiting for it.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  offline.prompt = e;
});
window.addEventListener('appinstalled', () => { offline.prompt = null; });

async function installApp() {
  if (!offline.prompt) { $('status').textContent = offlineStatus(offline); return; }
  const prompt = offline.prompt;
  offline.prompt = null;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    $('status').textContent = outcome === 'accepted'
      ? 'Installed — it opens in a window of its own, with or without a network.'
      : offlineStatus(offline);
  } catch {
    $('status').textContent = offlineStatus(offline);
  }
}

// --- Phase 30: Show me ---
//
// The tools harness drives the twelve tools with scripted pointer events on
// the real page; this is the same machinery aimed at teaching. demo.js
// compiles a lesson into timed events and knows nothing about pixels; what is
// here is the projection (world feet to client pixels, through the live edit
// camera — the same four lines `test/tools/run.mjs` installs), the ghost, and
// the one browser API that can tell a synthetic pointer from a real one.

let demoPlay = null;

const demoRunning = () => !!demoPlay;

function demoPoint(x, z) {
  const v = new THREE.Vector3(x, 0, z).project(renderApi.editCamera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}

function demoPointer(type, pt, buttons) {
  canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    clientX: pt.x, clientY: pt.y,
    button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true,
  }));
}

function demoGhost(pt, down) {
  const el = $('ghost');
  el.classList.remove('hidden');
  el.classList.toggle('down', !!down);
  el.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
}

function demoStop(note = '') {
  if (!demoPlay) return;
  for (const t of demoPlay.timers) clearTimeout(t);
  // A gesture interrupted mid-drag would leave the editor holding a stroke
  // whose pointer has vanished, which is a state a person cannot get out of.
  if (demoPlay.down) demoPointer('pointerup', demoPlay.at || { x: 0, y: 0 }, 0);
  // The capture stub goes back on the shelf: `delete` restores the prototype
  // method rather than leaving an own property shadowing it forever.
  delete canvas.setPointerCapture;
  delete canvas.releasePointerCapture;
  $('ghost').classList.add('hidden');
  document.body.classList.remove('demoing');
  demoPlay = null;
  if (note) $('status').textContent = note;
}

function demoStart(id) {
  const demo = demoById(id);
  if (!demo) return null;
  demoStop();
  if (mode !== 'edit') setMode('edit');

  // Where the lesson goes: clear floor on this storey, and the sheet grown to
  // cover it if there was none. Growing is always safe (footprint.js).
  const spot = demoSpot(state);
  const plan = demoEvents(demo, spot);
  const bounds = demoBounds(plan);
  if (spot.grown && bounds) {
    applySheet(
      () => growToCover(state, { ...bounds, x1: bounds.x1 + 8, z1: bounds.z1 + 8 }),
      (out) => `Plan grown to ${out.w * CELL} × ${out.h * CELL} ft to make room for the lesson.`,
    );
  }
  // The demo draws where it says it draws, so the camera has to be looking at
  // it — a lesson happening off-screen is not one.
  renderApi.fitEditView(state);

  // A synthetic pointer is not a live one, and `setPointerCapture` is the
  // single API that can tell: it throws `NotFoundError` for a pointerId the
  // browser never issued. Stubbed for the length of the playback rather than
  // worked around in editor.js, because a real hand should keep real capture.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  document.body.classList.add('demoing');

  demoPlay = { id: demo.id, plan, timers: [], down: false, at: null };
  for (const e of plan.events) {
    demoPlay.timers.push(setTimeout(() => {
      if (!demoPlay) return;
      if (e.kind === 'say') { $('status').textContent = e.text; return; }
      if (e.kind === 'tool') { selectTool(e.tool); return; }
      const pt = demoPoint(e.x, e.z);
      demoPlay.at = pt;
      if (e.kind === 'move') {
        demoPointer('pointermove', pt, demoPlay.down ? 1 : 0);
        demoGhost(pt, demoPlay.down);
        return;
      }
      if (e.kind === 'down') {
        demoPlay.down = true;
        demoPointer('pointermove', pt, 0);
        demoPointer('pointerdown', pt, 1);
        demoGhost(pt, true);
        return;
      }
      demoPlay.down = false;
      demoPointer('pointerup', pt, 0);
      demoGhost(pt, false);
    }, e.t));
  }
  demoPlay.timers.push(setTimeout(() => {
    demoStop();
    $('status').textContent =
      `${demo.title}: that was the whole gesture. Ctrl+Z takes it back, Ctrl+K has the rest.`;
  }, plan.duration + 400));
  return demoPlay;
}

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
  get tourCaption() { return tourCaption; },
  get xrStatus() { return xrStatus; },
  // --- Phase 11 ---
  huntBegin, huntStop,
  get hunt() { return hunt; },
  // --- Phase 33 ---
  lateBegin, lateStop,
  get late() { return late; },
  // --- Phase 21 ---
  setLabelMode,
  get labelMode() { return labelMode; },
  get labelGate() { return labelGate; },
  // --- Phase 22 ---
  get hands() { return hands; },
  get handsTarget() { return handsTarget; },
  handsAction, handsArm, handsCancel, walkPropsChanged,
  // --- Phase 14 ---
  sessionStart, sessionLeave, sessionFlush, sendSnapshot,
  get collab() { return collab; },
  get peers() { return collab.roster.list(); },
  // --- Phase 30 ---
  openWelcome, fillGallery, openCard,
  demoStart, demoStop,
  get demoing() { return demoRunning(); },
  fileSave, fileOpen,
  get file() { return fileSession; },
  get fileWorld() { return fileWorld; },
  get offline() { return offline; },
};
