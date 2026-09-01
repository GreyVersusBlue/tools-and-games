// editor.js — editor shell: tools, pointer handling, pan/zoom, undo/redo.
//
// The 4ft brush lives here; the free-drawing tools live in polyedit.js and are
// driven through the same pointer stream. Until Phase 12 this file also had to
// decide which of two room representations a click was aimed at, and every
// shared tool — wall, door, room, erase — was written twice. There is one kind
// of room now: the brush paints cells onto it through paint.js, and everything
// else acts on the ring the cursor is nearest.
//
// Phase 25 changes two of those tools from strokes into *targets*:
//
//   wall   two clicks, the way the overlay's measurement is taken. The first
//          sets one end, the second the other, and what gets built is exactly
//          the run between them — see wallrun.js for what "exactly" means when
//          part of the run happens to lie along a room's boundary. Both ends
//          land on the drawing grid, whose pitch follows the zoom (snapgrid.js),
//          and the parallel toggle holds the run square to it.
//
//   floor  a rectangle. The 4ft brush is still here behind a toggle, because
//          a brush is the right tool for an odd shape; a rectangle is the
//          right one for a classroom, and dragging a classroom out cell by
//          cell was the tool asking you to do its arithmetic.

import * as THREE from 'three';
import {
  CELL, WALL_H, WALL_T, ROOM_COLORS, activeFloor, floorBaseY,
} from './grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL,
  nearestSegment, shapeAt, setSegWall, toggleOpening, removeShape,
  moveOpening, openingsOnSeg, defaultOpeningWidth, isWindowOpening,
  curveSegment, straightenRun, segEnds, segLength, shapeArea,
  OP_DOOR, OP_WINDOW, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE, WINDOW_SILL,
} from './shapes.js';
import { paintTiles, frozenAt, frozenAtPoint } from './paint.js';
import { linkAt, stairMetrics, footprintBox } from './stairs.js';
import { removeLink, removeProp } from './props.js';
import { pickPropAt } from './propplace.js';
import { catalogEntry } from './catalog.js';
import {
  gridPitch, targetPoint, runLabel, runLength, snapAlongSeg,
  tileBounds, tileUnder, tileSpan, spanBounds,
} from './snapgrid.js';
import {
  gridOrigin, gridRefOf, gridLocked, describeGridRef, reanchorGridRef,
} from './gridref.js';
import {
  drawWallRun, wallLineAt, eraseWallLineAt, toggleLineOpening,
  moveLineOpening, lineOpenings, lineEnds, lineLength,
} from './wallrun.js';
import { step, apply, clone } from './history.js';
import { applyFinish, DEFAULT_FINISH } from './finish.js';
import { initPolyEdit } from './polyedit.js';
import { initPropEdit } from './propedit.js';
import { initStairEdit } from './stairedit.js';
import { initTemplateEdit } from './templateedit.js';
import { initSiteEdit } from './siteedit.js';
import { initOverlayEdit } from './overlayedit.js';
import { initAnnoEdit } from './annoedit.js';
import { pointSupported } from './shadow.js';
import { pinchZoomHeight } from './touch.js';
import { addSection, removeSection, sectionAt, sectionsOf, sectionLabel } from './elevation.js';

const MAX_UNDO = 100;

// A length in feet for a status line. Every grid pitch is a whole number of
// feet, so a tile's side always is too — but a rectangle read off a grid
// phased onto a traced photograph is not, and "13.0000001 ft" is not a
// measurement anybody wants to read.
const ftLabel = (v) => (Math.abs(v - Math.round(v)) < 0.005
  ? String(Math.round(v))
  : v.toFixed(1));

// How close to a wall counts as clicking it, in feet.
//
// This was a constant 1.6ft for twenty-five phases, and a constant is the
// wrong shape for it: a tolerance in *feet* is a tolerance in pixels that
// shrinks as you zoom out. At the zoom that fits a whole school on the screen
// 1.6ft is about two pixels, so "click the wall to put a door in it" asked for
// an aim nobody has — which is the whole of *"I'd like to be able to place
// doors on existing walls"*. It follows the zoom now, the same way the
// polygon handles, the stair tool's grab box and the drawing grid all do, and
// the floor is the old constant so nothing gets *harder* to hit up close.
const SEG_GRAB = 1.6;

// The wall tool builds one of three things. The table survives Phase 12 with
// its `edge` column dropped: there is one way to spell a wall now.
export const WALL_KINDS = [
  { kind: 'wall',  label: 'Solid',   icon: '▬', seg: SEG_WALL,  color: 0x4da3ff },
  { kind: 'glass', label: 'Glass',   icon: '⬚', seg: SEG_GLASS, color: 0x67d5e8 },
  { kind: 'rail',  label: 'Railing', icon: '⑊', seg: SEG_RAIL,  color: 0x7ce0a0 },
];
const wallKindOf = (k) => WALL_KINDS.find((w) => w.kind === k) || WALL_KINDS[0];

// What the door tool cuts — `opts` is what the opening records.
export const DOOR_KINDS = [
  { kind: 'single', label: 'Single door', icon: '🚪',
    opts: { k: OP_DOOR, leaf: LEAF_SINGLE } },
  { kind: 'double', label: 'Double door', icon: '🚪🚪',
    opts: { k: OP_DOOR, leaf: LEAF_DOUBLE, lite: true, bar: true } },
  { kind: 'cased',  label: 'Cased opening', icon: '⌷',
    opts: { k: OP_DOOR, leaf: LEAF_NONE } },
  { kind: 'window', label: 'Window', icon: '🪟',
    opts: { k: OP_WINDOW } },
];
const doorKindOf = (k) => DOOR_KINDS.find((d) => d.kind === k) || DOOR_KINDS[0];

export function initEditor({
  canvas, renderApi, getState, onChange, onStatus, onHoleMode, onMeasure,
  onLiveMeasure, onStairSelect, onAnnoSelect,
}) {
  // The status line teaches; the measurement rides the cursor. Everything a
  // tool says goes to the status line as it always has, and while a stroke
  // is live the same line is offered to `onLiveMeasure` with the pointer it
  // belongs to, so the chrome can put the number where the eye already is.
  let lastClient = null;
  let strokeLive = false;
  const say = (text) => {
    if (onStatus) onStatus(text);
    if (strokeLive && lastClient && onLiveMeasure) onLiveMeasure(text, lastClient.x, lastClient.y);
  };
  let tool = 'floor'; // floor | wall | door | room | erase | poly | vertex | prop | stair | template | site | overlay | section | anno
  let roomName = 'Room 101';
  let roomColor = ROOM_COLORS[0];
  let roomFinish = DEFAULT_FINISH;
  let roomPaint = null;      // null = whatever the renderer paints by default
  // v11's two room-record fields, on the same terms as the finishes: the room
  // tool carries them and writes them where you click. Null means "work it
  // out" — from the name for the group, from the area for the load — which is
  // what every version before this one did with no way to say otherwise.
  let roomGroup = null;
  let roomLoad = null;
  let wallKind = 'wall';
  let doorKind = 'single';
  // The point-target wall (Phase 25). `wallAnchor` is the first click of a run,
  // in world feet, held until the second click builds it — tool state, never
  // saved state, and dropped by Escape, a tool change or a storey change.
  //
  // A committed run leaves its far end as the next anchor, so a chain of walls
  // is a chain of clicks. That is the polygon tool's gesture rather than the
  // measurement's, and it is right here for the same reason it is right there:
  // walls come in runs.
  let wallAnchor = null;
  // Hold the run square to the grid. On by default because most walls in a
  // school are, and off is one click away — a wing at an angle to the rest of
  // the building is a thing somebody draws on purpose.
  let wallOrtho = true;
  // Phase 37: the section tool borrows the wall tool's whole gesture — two
  // clicks, the same snap, the same rubber band — but not its anchor: a
  // section is one line, never a chain, so the second click ends the gesture.
  // Tool state, never saved state; what the second click *writes* is saved.
  let sectAnchor = null;
  let sectHover = null;
  // The floor tool draws rectangles rather than painting cell by cell. Also
  // the eraser's, since it rubs out the same cells.
  let floorRect = true;
  // Where an eraser press landed, held until the pointer comes up so that a
  // press can be told from a drag. Tool state, never saved state.
  let eraseDown = null;
  // Per-door options the panel sets and every new opening inherits. `hand` is
  // which jamb the leaf hangs on, `sw` which side it swings toward; both are
  // toggles rather than validated values, since neither can be wrong.
  const doorOpts = { hand: 1, sw: 1, lite: false, bar: false, sill: WINDOW_SILL };
  // Openings slide along their wall and land on the drawing grid, the same
  // grid the wall's own endpoints were placed on. Off is one key away for the
  // door that has to line up with something the grid doesn't know about.
  // Tool state, never saved state — the same rule wallOrtho follows.
  let doorSnap = true;
  // A press on an existing opening, held until the pointer decides whether it
  // was a click (toggle, as ever) or a drag (slide it along the wall).
  let doorDrag = null;   // { where, shape, ring, seg, line, opening, len, moved, downX, downY }

  // The arc the wall tool laid down last, so pressing the curve key again
  // re-curves the same chord instead of curving one of its own chords. Tool
  // state, never saved state — the same rule selections follow. See the
  // "curved walls" note in shapes.js for why curvature isn't a stored field.
  let curveMemo = null;   // { shape, ring, seg, count, bulge }

  // Whether an upper storey may be built outside the footprint below it.
  // Off by default — the shadow is the rule — and when it is on, the cells
  // that land outside get counted so the stroke can say how much of the
  // building is now standing on nothing. Tool state, never saved state: an
  // overhang is a fact about the design that shadow.js reads back off the
  // geometry, not a flag the file carries.
  let allowOverhang = false;
  let overhangRefused = 0;   // tiles this stroke declined to build
  // ...and how much floor it laid outside the shadow anyway, in ft². Kept as
  // an area rather than a tile count because a tile is no longer one size: the
  // brush lays whatever square the drawing grid is showing.
  let overhangArea = 0;
  // ...and tiles that were off the drawing surface altogether. Phase 13: the
  // sheet is a size somebody sets now, so "nothing happened when I painted
  // there" has an answer — and it is the same answer whether the plan needs
  // growing or the cursor simply wandered off the edge of it.
  let strokeOffSheet = 0;

  // Phase 13's `strokeDir`/`strokeSkewed` are gone with the wall drag they
  // existed for. They held a stroke to the line it started on so that running
  // the cursor past a corner didn't lay a stub down the side of the room —
  // a real fix for a gesture that had to guess which wall you meant. The
  // point target does not guess: you say where the wall starts and where it
  // ends, and `nearestSegment`'s `parallelTo` filter (shapes.js) is now used
  // only by the tests that pin its behaviour. See wallrun.js.

  const undoStack = [];
  const redoStack = [];
  let strokeActive = false;
  let strokeChanged = false;
  let strokeFrozen = 0;   // tiles this stroke declined because a free-drawn
                          // room was under them — see paint.js
  let enabled = true;

  // --- hover cursors ---
  // A unit square, scaled to the grid's pitch every time it is shown — the
  // tile the floor tool would lay is whatever square the zoom is drawing.
  const cellCursor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.35, depthTest: false })
  );
  cellCursor.rotation.x = -Math.PI / 2;
  cellCursor.renderOrder = 500;
  cellCursor.visible = false;

  const edgeCursor = new THREE.Mesh(
    new THREE.BoxGeometry(CELL + WALL_T, 0.6, WALL_T + 0.5),
    new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.55, depthTest: false })
  );
  edgeCursor.renderOrder = 501;
  edgeCursor.visible = false;

  // The door tool's own ghost: the opening itself, at the spot on the wall a
  // click would cut it, riding the snapped point while the whole-segment
  // highlight above fades back to context. A preview that snaps differently
  // from the commit is worse than no preview, so both read `doorTargetAt`.
  const openCursor = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.7, WALL_T + 0.9),
    new THREE.MeshBasicMaterial({ color: 0xd9a05b, transparent: true, opacity: 0.9, depthTest: false })
  );
  openCursor.renderOrder = 502;
  openCursor.visible = false;

  // The point-target overlay: the run being drawn, a dot on each end of it,
  // and the block the rectangle brush would lay. All four are sized off the
  // view height so they read the same however far you have zoomed — the same
  // rule polyedit.js's handles follow.
  const draftLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x4da3ff, depthTest: false, transparent: true, opacity: 0.95 })
  );
  draftLine.frustumCulled = false;
  draftLine.renderOrder = 502;
  draftLine.visible = false;

  const dotGeo = new THREE.CircleGeometry(1, 16);
  dotGeo.rotateX(-Math.PI / 2);
  const anchorDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
    color: 0x4da3ff, depthTest: false, transparent: true, opacity: 0.95,
  }));
  const targetDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
    color: 0x7ce0a0, depthTest: false, transparent: true, opacity: 0.9,
  }));
  for (const d of [anchorDot, targetDot]) { d.renderOrder = 503; d.visible = false; }

  const rectCursor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.3, depthTest: false })
  );
  rectCursor.rotation.x = -Math.PI / 2;
  rectCursor.renderOrder = 500;
  rectCursor.visible = false;

  // The drawn section lines, shown while the section tool is active — the
  // records live on the design (elevation.js), this is only their editor
  // face. Rebuilt whole on every change; a dozen two-point lines cost nothing.
  const sectionGroup = new THREE.Group();
  sectionGroup.visible = false;
  sectionGroup.renderOrder = 502;

  renderApi.scene.add(cellCursor, edgeCursor, openCursor, draftLine, anchorDot, targetDot,
    rectCursor, sectionGroup);

  const handleSize = () => Math.min(2.4, Math.max(0.25, renderApi.editView.height * 0.006));
  // ...and the wall-grab tolerance, off the same number. See SEG_GRAB above.
  const segGrab = () => Math.min(6, Math.max(SEG_GRAB, renderApi.editView.height * 0.012));
  // The grid the tools land on, right now: how fine it is, and where it
  // starts. The pitch is one number off the zoom (snapgrid.js); the origin is
  // the reference point somebody set on the tracing image, or the corner of
  // the sheet if nobody has (gridref.js). Both are read fresh at every use —
  // the zoom changes on a wheel scroll, between one pointer event and the next.
  const pitch = () => gridPitch(renderApi.editView.height);
  const origin = () => gridOrigin(getState());

  // --- picking ---
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _v3 = new THREE.Vector3();
  const _ndc = new THREE.Vector2();

  function pointerToWorldXY(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, renderApi.editCamera);
    return raycaster.ray.intersectPlane(groundPlane, _v3) ? { x: _v3.x, z: _v3.z } : null;
  }
  function pointerToWorld(e) { return pointerToWorldXY(e.clientX, e.clientY); }

  // Which square of the drawing grid a world point is over, in world feet,
  // with its centre — the one thing the floor tool and the eraser both aim at.
  //
  // The tile is the grid's, not the lattice's: it is `gridPitch` feet across
  // and starts where `gridOrigin` says, so what the sheet draws and what the
  // brush lays are the same square. A tile counts as on the plan when its
  // *centre* is, which is the only test that stays stable as the grid's phase
  // slides under the sheet's corner.
  function tileAtCursor(f, wx, wz) {
    const t = tileUnder(wx, wz, pitch(), origin());
    const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    if (cx < 0 || cz < 0 || cx > f.w * CELL || cz > f.h * CELL) return null;
    return { ...t, cx, cz };
  }

  // --- undo/redo ---
  //
  // An undo step used to be a JSON clone of the whole design, which is what
  // made undo a two-line feature and what the v1 retrospective named as the
  // arithmetic that would bend first. Phase 12 gave every room an id, and with
  // that a step can say *what changed* instead: `history.js` diffs the design
  // against the one this file has been holding since the last commit, and the
  // stack keeps the two patches rather than two buildings.
  //
  // **The commit is lazy, and that is what keeps every tool's calling
  // convention.** Fifteen call sites do `pushUndo()` and then mutate; a
  // handful then decide the edit was a no-op. So `pushUndo()` does not push
  // anything — it *closes* whatever edit was open and clears the redo stack.
  // A gesture that changed nothing produces an empty diff and costs no
  // history, which is what `dropUndo()` used to be for and is why it is now a
  // no-op that nobody has to remember to call.
  //
  // The overlay and the model library still travel beside the diff, by
  // reference, for the reason Phase 8 and Phase 9 gave: each carries megabytes
  // of data URL that no edit here touches, and neither record is ever mutated
  // in place — every change to one goes through a function that returns a new
  // object — so a reference held here is what it was, not a view of what it is.
  const design = () => {
    const { overlay, models, ...rest } = getState();
    return rest;
  };
  const carried = () => {
    const s = getState();
    return { overlay: s.overlay || null, models: s.models || null };
  };

  // The design as of the last commit, and what was hanging off it.
  let baseline = clone(design());
  let baseCarried = carried();
  // Whether anything has happened since. Tracked rather than measured, because
  // `canUndo` is read on every frame of a drag and diffing the whole design to
  // answer it would cost more than the edit does. A false positive is
  // harmless — `commit()` finds no change and pushes nothing — and a false
  // negative would grey out a button that works, which is why every path that
  // touches the design goes through `fire()`.
  let dirty = false;

  // Tell the shell something changed, and remember that something did.
  const fire = (info) => { dirty = true; onChange(info); };

  // Close the open edit, if it changed anything. Returns true if it did.
  function commit() {
    const now = design();
    const st = step(baseline, now);
    const held = carried();
    const carriedMoved = held.overlay !== baseCarried.overlay || held.models !== baseCarried.models;
    dirty = false;
    if (!st && !carriedMoved) return false;
    undoStack.push({
      back: st ? st.back : undefined,
      fwd: st ? st.fwd : undefined,
      before: baseCarried,
      after: held,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    baseline = clone(now);
    baseCarried = held;
    return true;
  }

  function pushUndo() {
    commit();
    redoStack.length = 0;
  }

  // Put the design back to `data`, which is a whole plain-JSON design rather
  // than a patch — the patches have already been applied to produce it.
  //
  // Keys it doesn't have are keys the design didn't have. `Object.assign` only
  // ever adds and overwrites, so without the delete pass an undo across the
  // moment something was *first* written — the first site region, the first
  // grading stroke, the first tracing image — leaves that record behind and
  // the undo silently does nothing. Every optional record on the state
  // (terrain, site, roof, code, life, timetable, overlay, tours, models,
  // haunt, weather, sections) is one of these.
  function restore(data, held) {
    const s = getState();
    const next = { ...data };
    if (held.overlay) next.overlay = held.overlay;
    if (held.models) next.models = held.models;
    for (const key of Object.keys(s)) if (!(key in next)) delete s[key];
    Object.assign(s, next);
    baseline = clone(data);
    baseCarried = held;
    dirty = false;
    onChange({ structural: true });
    poly.refresh();
    // An undo can put a section line back or take the last one away, and the
    // record's editor face has to follow the record. Same for an annotation.
    refreshSectionOverlay();
    annoTool.refresh();
  }

  function undo() {
    commit();
    if (!undoStack.length) return;
    curveMemo = null;
    const entry = undoStack.pop();
    redoStack.push(entry);
    restore(apply(baseline, entry.back), entry.before);
  }

  function redo() {
    if (!redoStack.length) return;
    curveMemo = null;
    const entry = redoStack.pop();
    undoStack.push(entry);
    restore(apply(baseline, entry.fwd), entry.after);
  }

  // Forget the open edit without recording it.
  function markClean() {
    baseline = clone(design());
    baseCarried = carried();
  }


  // --- polygon tools ---
  // polyedit owns its own overlay and calls back in here for undo, redraws and
  // the status line, so both halves of the editor share one history.
  const poly = initPolyEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: true, ...info }),
      status: (text) => say(text),
      holeModeChanged: (v) => onHoleMode && onHoleMode(v),
      cursorStyle: (v) => { canvas.style.cursor = v; },
      roomName: () => roomName || 'Room',
      roomColor: () => roomColor,
      // Phase 8's structural shadow, shared with the floor tool: the same
      // switch governs both halves of the room model, which is the whole
      // reason it lives on the editor rather than inside either of them.
      allowOverhang: () => allowOverhang,
    },
  });

  // propedit owns the prop palette's current type and selection, and calls
  // back in here the same way polyedit does — one undo history for all three.
  const propTool = initPropEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: true, ...info }),
      status: (text) => say(text),
    },
  });

  // stairedit owns the links table the same way propedit owns props — and, like
  // both of the others, hands its undo/redo to this file rather than keeping a
  // history of its own.
  const stairTool = initStairEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: true, ...info }),
      status: (text) => say(text),
      // Phase 25: the panel lists what is on the storey and highlights what is
      // selected, so it has to hear about a selection made on the plan.
      selectionChanged: (link) => onStairSelect && onStairSelect(link),
    },
  });

  // templateedit stamps a whole preset's worth of props at once — same host
  // wiring as propedit, since a placement is just several addProp() calls
  // sharing one undo entry.
  const templateTool = initTemplateEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: true, ...info }),
      status: (text) => say(text),
    },
  });

  // siteedit owns the ground and everything laid on it. Same host wiring as
  // the other four — the site has no history of its own either.
  const siteTool = initSiteEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: true, ...info }),
      status: (text) => say(text),
    },
  });

  // The overlay tool writes one field on the state and asks the shell to ask a
  // question — "how long is that?" — which no other tool here needs, so it is
  // the one host with two extra hooks on it.
  const overlayTool = initOverlayEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: false, overlay: true, ...info }),
      status: (text) => say(text),
      setOverlay: (o, info = {}) => {
        const st = getState();
        if (o) st.overlay = o;
        // A reference point picked on the picture rides with it. Refused once
        // anything is drawn, which is what stops aligning a scan late in a
        // design from dragging the grid off the building — see gridref.js.
        const moved = reanchorGridRef(st);
        fire({ structural: moved, overlay: true, ...info });
      },
      // Both ends of a measurement, in image pixels. The shell puts up the
      // "how many feet is that?" prompt, because a dialog is not a tool's job.
      measured: (a, b) => onMeasure && onMeasure(a, b),
    },
  });

  // annoedit writes the per-storey `dims` and `notes` records (Phase 38) —
  // drawing annotation, not building, so nothing baked, walked or hunted
  // changes with it: the same `structural: false` a section line commits with.
  const annoTool = initAnnoEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo,
      changed: (info = {}) => fire({ structural: false, ...info }),
      status: (text) => say(text),
      selectionChanged: (sel) => onAnnoSelect && onAnnoSelect(sel),
    },
  });

  // --- tool application ---

  function applyAt(wx, wz, isClick) {
    const s = getState();
    const f = activeFloor(s);
    if (tool === 'floor') {
      const t = tileAtCursor(f, wx, wz);
      if (!t) { strokeOffSheet++; return; }
      // Phase 8's structural shadow. An upper storey is limited to the
      // footprint of the one below it by default — you cannot lay slab over
      // thin air by accident — and overhangs are switched on rather than
      // switched off, because a cantilever is something somebody decides to
      // draw. The refusal is a status line and nothing else: no dialog, no
      // beep, no red flash. See the note on `allowOverhang` below.
      if (!allowOverhang && !pointSupported(s, s.currentFloor, t.cx, t.cz)) {
        overhangRefused++;
        return;
      }
      // The brush paints a room's ring, not a cell in a file — see paint.js.
      // A tile joins whichever room it can walk to, or starts one. It is
      // *queued* rather than laid: see `flushTiles`.
      // Counted here rather than after the fact, and only for a tile that is
      // not already floor: the flush cannot say *which* squares were new, and
      // "you have just built 400 ft² over nothing" is a lie if 390 of it was
      // already there.
      if (allowOverhang && !shapeAt(f, t.cx, t.cz) &&
          !pointSupported(s, s.currentFloor, t.cx, t.cz)) {
        overhangArea += (t.x1 - t.x0) * (t.z1 - t.z0);
      }
      queueTile(t);
    } else if (tool === 'room') {
      if (!isClick) return;
      const shape = shapeAt(f, wx, wz);
      if (!shape) return;
      shape.name = roomName || 'Room';
      shape.color = roomColor;
      shape.group = roomGroup;
      shape.load = roomLoad;
      applyFinish(shape, roomFinish, roomPaint);
      strokeChanged = true;
      const said = [`${Math.round(shapeArea(shape)).toLocaleString()} ft²`];
      if (roomGroup) said.push(`read as ${roomGroup}`);
      if (roomLoad) said.push(`${roomLoad} occupants`);
      say(`${shape.name} — ${said.join(', ')}.`);
    } else if (tool === 'erase') {
      // This is the *stroke* half of the eraser — a brush sample, or one cell
      // centre of a rubbed-out rectangle. A deliberate click is handled before
      // a stroke ever starts; see `eraseObjectAt`.
      //
      // Hence the tight constant rather than the zoom-scaled grab: `applyRect`
      // walks its cell centres through here, and a tolerance that grew with
      // the zoom would take walls several feet outside the rectangle with it.
      //
      // A free-standing wall goes whole — a wall line *is* one wall, so there
      // is no half of it to rub out.
      if (eraseWallLineAt(f, wx, wz, SEG_GRAB)) { strokeChanged = true; return; }
      const seg = nearestSegment(f, wx, wz, SEG_GRAB);
      if (seg) {
        // Erasing a wall takes its doorways with it — they were openings *in*
        // that wall, and there's nothing left to be an opening in.
        if (setSegWall(seg.shape, seg.ring, seg.seg, SEG_NONE)) strokeChanged = true;
        return;
      }
      // A whole free-drawn room is a lot to lose to a stray drag, so one only
      // goes on a deliberate click. A painted one rubs out a cell at a time,
      // which is how it was drawn.
      const frozen = isClick ? frozenAtPoint(s, s.currentFloor, wx, wz) : null;
      if (frozen) {
        removeShape(f, frozen.id);
        strokeChanged = true;
        return;
      }
      const t = tileAtCursor(f, wx, wz);
      if (!t) { strokeOffSheet++; return; }
      queueTile(t);
    }
  }

  // --- the tile queue ---
  //
  // Floor and eraser gestures collect the squares they touched and lay them in
  // one call. That is not a micro-optimisation: `paintTiles` rasterizes the
  // whole storey, re-traces every region on it and puts every doorway back
  // (see paint.js), so a stroke that repainted per sample was doing all of
  // that forty times a second, and a rectangle was doing it once per square.
  // One gesture is one repaint.
  let strokeTiles = null;    // Map of "x0,z0" -> tile, so a stroke that
                             // crosses its own path costs one entry

  function queueTile(t) {
    if (!strokeTiles) strokeTiles = new Map();
    strokeTiles.set(`${t.x0.toFixed(4)},${t.z0.toFixed(4)}`, t);
  }

  // Lay (or rub out) everything queued. Returns what the brush did, or null if
  // the gesture never touched a square it was allowed to touch.
  function flushTiles(on) {
    if (!strokeTiles || !strokeTiles.size) { strokeTiles = null; return null; }
    const tiles = [...strokeTiles.values()];
    strokeTiles = null;
    const s = getState();
    const out = paintTiles(s, s.currentFloor, tiles, on, on
      ? { name: roomName || 'Room', color: roomColor, fin: roomFinish, paint: roomPaint }
      : {});
    strokeFrozen += out.frozenTiles;
    strokeOffSheet += out.offSheetTiles;
    if (out.changed) strokeChanged = true;
    return out;
  }

  // Sample along the drag path so fast strokes don't skip tiles or edges. The
  // step follows the grid: at a fine pitch a fast drag has more squares to
  // cross, and a step sized off the 4ft cell would jump over them.
  let lastWorld = null;
  function applyStroke(wx, wz, isClick) {
    if (lastWorld && !isClick) {
      const dx = wx - lastWorld.x, dz = wz - lastWorld.z;
      const dist = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(dist / (pitch() * 0.4)));
      for (let i = 1; i <= steps; i++) {
        applyAt(lastWorld.x + (dx * i) / steps, lastWorld.z + (dz * i) / steps, false);
      }
    } else {
      applyAt(wx, wz, isClick);
    }
    lastWorld = { x: wx, z: wz };
    flushTiles(tool !== 'erase');
  }

  // --- the point target (Phase 25) ---
  //
  // One function turns a raw cursor into the point the tool will actually use,
  // and every part of the gesture reads it: the hover dot, the rubber band and
  // the click that commits. That is deliberate — a preview that snaps
  // differently from the commit is worse than no preview.
  //
  // Alt is the same escape hatch it is in polyedit.js and stairedit.js: hold
  // it and the cursor is taken as it is, off the grid, for the one wall that
  // has to meet something that isn't on it.
  function targetAt(p, e) {
    return targetPoint(p.x, p.z, {
      pitch: pitch(),
      origin: origin(),
      snap: !(e && e.altKey),
      from: wallAnchor,
      ortho: wallOrtho && !(e && e.shiftKey),
    });
  }

  let wallHover = null;     // the snapped point under the cursor, for the overlay

  function refreshDraft() {
    const s = getState();
    const y = floorBaseY(s, s.currentFloor) + 0.5;
    const r = handleSize();
    const on = enabled && tool === 'wall';
    if (!on || !wallHover) {
      draftLine.visible = anchorDot.visible = targetDot.visible = false;
      if (!on) wallAnchor = null;
      return;
    }
    targetDot.position.set(wallHover.x, y, wallHover.z);
    targetDot.scale.set(r, 1, r);
    targetDot.visible = true;
    if (!wallAnchor) {
      draftLine.visible = anchorDot.visible = false;
      return;
    }
    anchorDot.position.set(wallAnchor.x, y, wallAnchor.z);
    anchorDot.scale.set(r * 1.15, 1, r * 1.15);
    anchorDot.visible = true;
    const arr = new Float32Array([
      wallAnchor.x, y, wallAnchor.z, wallHover.x, y, wallHover.z,
    ]);
    draftLine.geometry.dispose();
    draftLine.geometry = new THREE.BufferGeometry();
    draftLine.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    draftLine.material.color.setHex(wallKindOf(wallKind).color);
    draftLine.visible = true;
  }

  // What the second click will build, in words, while it is still the first.
  //
  // The length goes to two places on purpose. The status line gets the whole
  // sentence, because that is where a tool teaches; the chip that rides the
  // cursor gets the number alone, because that is where the eye already is
  // and a sentence there is in the way of the thing being drawn. Phase 19
  // built the chip for stroke tools; a two-click gesture has no stroke to be
  // live during, so `runChip` drives it directly.
  const runChip = (text) => {
    if (onLiveMeasure && lastClient) onLiveMeasure(text, lastClient.x, lastClient.y);
  };

  function sayRun() {
    if (!wallAnchor || !wallHover) return;
    const kind = wallKindOf(wallKind);
    if (onStatus) {
      onStatus(`${kind.label} wall — ${runLabel(wallAnchor, wallHover)}. ` +
        'Click to build it, Esc to stop.');
    }
    runChip(runLabel(wallAnchor, wallHover));
  }

  function cancelWallRun(quiet = false) {
    if (!wallAnchor) return false;
    wallAnchor = null;
    refreshDraft();
    if (onLiveMeasure) onLiveMeasure(null);
    if (!quiet) say(HINT_WALL);
    return true;
  }

  const HINT_WALL = 'Wall — click one end, then the other. ' +
    'S squares it to the grid, Alt draws off it, Esc stops the run.';

  function wallPointerDown(p, e) {
    const target = targetAt(p, e);
    wallHover = target;
    if (!wallAnchor) {
      wallAnchor = target;
      refreshDraft();
      say('Wall — now click the other end of it.');
      return;
    }
    if (runLength(wallAnchor, target) < 0.01) {
      // The same point clicked twice ends the run rather than building nothing.
      cancelWallRun();
      return;
    }
    const s = getState();
    pushUndo();
    curveMemo = null;
    const kind = wallKindOf(wallKind);
    const out = drawWallRun(s, s.currentFloor, wallAnchor, target, kind.seg);
    if (!out.ok) {
      dropUndo();
      say(out.reason);
      return;
    }
    fire({ structural: true, commit: true });
    // The far end becomes the next anchor: a corridor is four clicks, not eight.
    wallAnchor = target;
    refreshDraft();
    const built = [];
    if (out.onRings) built.push(`${out.onRings} room ${out.onRings === 1 ? 'side' : 'sides'}`);
    if (out.lines.length) built.push(`${out.lines.length} free-standing`);
    const len = `${out.length.toFixed(out.length < 10 ? 1 : 0)} ft`;
    if (onStatus) {
      onStatus(`${kind.label} wall — ${len}` +
        `${built.length ? ` (${built.join(', ')})` : ''}. ` +
        'Click on to continue the run, Esc to stop.');
    }
    runChip(len);
  }

  function wallPointerMove(p, e) {
    wallHover = targetAt(p, e);
    refreshDraft();
    if (wallAnchor) sayRun();
  }

  // --- the section tool (Phase 37) ---
  //
  // The wall tool's gesture, drawing a different fact: two clicks lay a named
  // section line on the design, a click on an existing line removes it, and
  // the second click ends the gesture — a section is one line, not a chain.

  const HINT_SECTION = 'Section — click one end of the cut, then the other. ' +
    'The cut looks left along the line you draw; click a drawn line to remove it. ' +
    'Sections print with the drawing set.';

  function sectTargetAt(p, e) {
    return targetPoint(p.x, p.z, {
      pitch: pitch(),
      origin: origin(),
      snap: !(e && e.altKey),
      from: sectAnchor,
      ortho: wallOrtho && !(e && e.shiftKey),
    });
  }

  function refreshSectionOverlay() {
    const s = getState();
    const on = enabled && tool === 'section';
    sectionGroup.visible = on;
    if (!on) return;
    for (const child of sectionGroup.children) {
      child.geometry.dispose();
      child.material.dispose();
    }
    sectionGroup.clear();
    const y = floorBaseY(s, s.currentFloor) + 0.6;
    for (const sec of sectionsOf(s)) {
      const arr = new Float32Array([sec.ax, y, sec.az, sec.bx, y, sec.bz]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xd9a05b, depthTest: false, transparent: true, opacity: 0.9,
      }));
      line.frustumCulled = false;
      line.renderOrder = 502;
      sectionGroup.add(line);
    }
  }

  function refreshSectDraft() {
    const s = getState();
    const y = floorBaseY(s, s.currentFloor) + 0.5;
    const r = handleSize();
    const on = enabled && tool === 'section';
    if (!on || !sectHover) {
      if (tool !== 'wall') draftLine.visible = anchorDot.visible = targetDot.visible = false;
      if (!on) sectAnchor = null;
      return;
    }
    targetDot.position.set(sectHover.x, y, sectHover.z);
    targetDot.scale.set(r, 1, r);
    targetDot.visible = true;
    if (!sectAnchor) {
      draftLine.visible = anchorDot.visible = false;
      return;
    }
    anchorDot.position.set(sectAnchor.x, y, sectAnchor.z);
    anchorDot.scale.set(r * 1.15, 1, r * 1.15);
    anchorDot.visible = true;
    const arr = new Float32Array([
      sectAnchor.x, y, sectAnchor.z, sectHover.x, y, sectHover.z,
    ]);
    draftLine.geometry.dispose();
    draftLine.geometry = new THREE.BufferGeometry();
    draftLine.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    draftLine.material.color.setHex(0xd9a05b);
    draftLine.visible = true;
  }

  function cancelSection(quiet = false) {
    if (!sectAnchor) return false;
    sectAnchor = null;
    refreshSectDraft();
    if (onLiveMeasure) onLiveMeasure(null);
    if (!quiet) say(HINT_SECTION);
    return true;
  }

  function sectPointerDown(p, e) {
    const s = getState();
    const target = sectTargetAt(p, e);
    sectHover = target;
    if (!sectAnchor) {
      // A click on a drawn line removes it — the door tool's toggle, for the
      // same reason: the tool that places a thing is where you look to take
      // it away.
      const hit = sectionAt(s, p.x, p.z, segGrab());
      if (hit) {
        pushUndo();
        removeSection(s, hit.id);
        // A section line is drawing annotation, not building: nothing baked,
        // walked or hunted changes with it.
        fire({ structural: false, commit: true });
        refreshSectionOverlay();
        say(`Section ${sectionLabel(hit)} removed.`);
        return;
      }
      sectAnchor = target;
      refreshSectDraft();
      say('Section — now click the other end of the cut.');
      return;
    }
    if (runLength(sectAnchor, target) < 0.01) {
      cancelSection();
      return;
    }
    pushUndo();
    const sec = addSection(s, sectAnchor, target);
    sectAnchor = null;
    if (!sec) {
      dropUndo();
      say('That cut is too short to slice anything — drag it across the building.');
      refreshSectDraft();
      return;
    }
    fire({ structural: false, commit: true });
    refreshSectionOverlay();
    refreshSectDraft();
    say(`Section ${sectionLabel(sec)} drawn — it cuts every storey and prints with the set. ` +
      'Click it to remove it.');
  }

  function sectPointerMove(p, e) {
    sectHover = sectTargetAt(p, e);
    refreshSectDraft();
    if (sectAnchor && onStatus) {
      onStatus(`Section — ${runLabel(sectAnchor, sectHover)}. Click to place the cut, Esc to stop.`);
    }
  }

  // --- the rectangle brush (Phase 25) ---
  //
  // The floor tool's drag lays a block rather than a trail. Kept as a gesture
  // on this file rather than a mode inside paint.js, because what it is doing
  // is calling the brush once per cell — the model has not learned about
  // rectangles and does not need to.
  let rectGesture = null;    // { a: {x,z}, b: {x,z} }

  // The block a drag covers, in whole grid tiles — snapped the same way one
  // click is, so a rectangle laid at this zoom sits on the same lines as a
  // tile laid at it.
  const rectSpan = (a, b) => tileSpan(a, b, pitch(), origin());

  // ...and what that is in feet, which is what the cursor is drawn from, what
  // the status line reads out, and what the brush is handed.
  const rectBounds = (span) => spanBounds(span, pitch(), origin());

  const rectSize = (span) => {
    const b = rectBounds(span);
    return { w: b.x1 - b.x0, d: b.z1 - b.z0, area: (b.x1 - b.x0) * (b.z1 - b.z0) };
  };

  function refreshRect() {
    const s = getState();
    if (!rectGesture || !(tool === 'floor' || tool === 'erase')) {
      rectCursor.visible = false;
      return;
    }
    const b = rectBounds(rectSpan(rectGesture.a, rectGesture.b));
    rectCursor.visible = true;
    rectCursor.material.color.setHex(tool === 'erase' ? 0xff5f56 : 0x4da3ff);
    rectCursor.scale.set(b.x1 - b.x0, b.z1 - b.z0, 1);
    rectCursor.position.set(
      (b.x0 + b.x1) / 2,
      floorBaseY(s, s.currentFloor) + 0.09,
      (b.z0 + b.z1) / 2,
    );
  }

  // Walk the block's tile centres through `applyAt` — which queues the floor
  // part and, for the eraser, takes the walls inside the block as it goes —
  // and then lay the whole thing in one call.
  function applyRect(a, b) {
    const span = rectSpan(a, b);
    const p = pitch(), o = origin();
    for (let j = span.iz0; j <= span.iz1; j++) {
      for (let i = span.ix0; i <= span.ix1; i++) {
        const t = tileBounds(i, j, p, o);
        applyAt((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, false);
      }
    }
    flushTiles(tool !== 'erase');
    return span;
  }

  // --- the eraser as a delete key ---
  //
  // For twenty-five phases the eraser rubbed out *floor*: cells, and the walls
  // that happened to bound them. Everything else you could place — a stair, a
  // lift, a ramp, a floor opening, a chair, a whole laid-out classroom — was
  // deleted from inside the tool that placed it, by selecting it and pressing
  // Delete. That is a fine second way to do it and a poor only way: the tool
  // labelled *Erase* is the first place anybody looks for "get rid of that",
  // and it answered "not my department" by doing nothing at all.
  //
  // It answers now. One click with the eraser removes whatever is under the
  // cursor, whichever tool put it there. Dragging still rubs out floor, which
  // is the gesture that was already right for the one thing you erase by the
  // square foot.
  //
  // The order is tightest-hit first: a wall is a line and a stair is a box, so
  // testing the line first is what lets you take a wall off the edge of a
  // staircase without taking the staircase.
  const LINK_NOUN = {
    stair: 'Staircase', ramp: 'Ramp', elevator: 'Elevator', opening: 'Floor opening',
  };

  // What is under (wx, wz), as the noun the status line will use and the
  // function that removes it. Null when the cursor is over nothing removable.
  function objectUnder(s, f, wx, wz) {
    const grab = segGrab();
    const onLine = wallLineAt(f, wx, wz, grab);
    if (onLine) {
      const kind = onLine.line.kind;
      const noun = (kind === 'glass' && 'Glass wall') || (kind === 'rail' && 'Railing') || 'Wall';
      return {
        what: `${noun} — ${lineLength(onLine.line).toFixed(1)}ft`,
        remove: () => eraseWallLineAt(f, wx, wz, grab),
      };
    }
    const seg = nearestSegment(f, wx, wz, grab);
    if (seg) {
      const len = segLength(...segEnds(seg.shape.rings[seg.ring], seg.seg));
      return {
        what: `Wall — ${len.toFixed(1)}ft of ${seg.shape.name || 'a room'}'s boundary`,
        // A doorway is an opening *in* this wall; with the wall gone there is
        // nothing left for it to be an opening in, so it goes too. That is
        // what `setSegWall(..., SEG_NONE)` has always done.
        remove: () => setSegWall(seg.shape, seg.ring, seg.seg, SEG_NONE),
      };
    }
    // A vertical link. `linkAt` already knows that an elevator stands on both
    // of the storeys it serves and so can be picked from either.
    const link = linkAt(s, s.currentFloor, wx, wz);
    if (link) {
      const box = footprintBox(link, stairMetrics(s));
      return {
        what: `${LINK_NOUN[link.type] || 'Link'} — ` +
          `${Math.round(box.x1 - box.x0)} × ${Math.round(box.z1 - box.z0)} ft`,
        remove: () => removeLink(s, link.id),
      };
    }
    const prop = pickPropAt(s.props, s.currentFloor, catalogEntry, wx, wz);
    if (prop) {
      const entry = catalogEntry(prop.type);
      return {
        what: (entry && entry.name) || 'Furniture',
        remove: () => removeProp(s, prop.id),
      };
    }
    // A whole free-drawn room, on a deliberate click only — which this is.
    const frozen = frozenAtPoint(s, s.currentFloor, wx, wz);
    if (frozen) {
      return {
        what: `${frozen.name || 'Room'} — ${Math.round(shapeArea(frozen)).toLocaleString()} ft²`,
        remove: () => removeShape(f, frozen.id),
      };
    }
    return null;
  }

  // The click half of the eraser. Returns true when it removed something, in
  // which case the caller does *not* start a floor-rubbing stroke: a click on
  // a staircase means the staircase, not the slab it stands on.
  function eraseObjectAt(wx, wz) {
    const s = getState();
    const f = activeFloor(s);
    const hit = objectUnder(s, f, wx, wz);
    if (!hit) return false;
    pushUndo();
    if (!hit.remove()) { dropUndo(); return false; }
    fire({ structural: true, commit: true });
    say(`Deleted — ${hit.what}.`);
    return true;
  }

  // --- hover feedback ---
  let hoverWorld = null;   // last cursor position in world feet, for the curve keys

  function updateCursor(e) {
    const s = getState();
    const f = activeFloor(s);
    const baseY = floorBaseY(s, s.currentFloor);
    const p = e && pointerToWorld(e);
    if (p) hoverWorld = p;
    if (!enabled || !p || tool === 'poly' || tool === 'vertex' || tool === 'prop' ||
        tool === 'stair' || tool === 'template' || tool === 'site' || tool === 'anno') {
      cellCursor.visible = edgeCursor.visible = openCursor.visible = rectCursor.visible = false;
      if (tool !== 'wall') { wallHover = null; refreshDraft(); }
      return;
    }
    const isErase = tool === 'erase';
    if (isErase) canvas.style.cursor = '';
    // The wall cursor takes the colour of the thing it would build, so glass
    // and railing are distinguishable before you commit to one.
    const color = isErase ? 0xff5f56
      : tool === 'door' ? 0xd9a05b
      : tool === 'wall' ? wallKindOf(wallKind).color
      : 0x4da3ff;

    // The section tool rides the same overlay the wall tool draws — a dot on
    // the grid and the run to it — and wants none of the highlight below.
    if (tool === 'section') {
      cellCursor.visible = edgeCursor.visible = openCursor.visible = false;
      sectHover = sectTargetAt(p, e);
      refreshSectDraft();
      return;
    }
    // The wall tool draws its own overlay now — a dot on the grid and the run
    // to it — so it wants none of the segment highlight below.
    if (tool === 'wall') {
      cellCursor.visible = edgeCursor.visible = openCursor.visible = false;
      wallHover = targetAt(p, e);
      refreshDraft();
      return;
    }
    // A rectangle in progress owns the cursor; the cell block *is* the preview.
    if (rectGesture) {
      cellCursor.visible = edgeCursor.visible = openCursor.visible = false;
      refreshRect();
      return;
    }

    // The door tool previews the opening itself, not just the wall it would
    // cut into (Phase 36): the whole segment fades back to context and the
    // ghost rides the snapped point the click would use — one target for
    // hover and commit, the same rule the wall tool's point target follows.
    if (tool === 'door') {
      const target = doorTargetAt(f, p, e);
      cellCursor.visible = false;
      if (!target) {
        // Nothing within reach: say so by showing nothing rather than by
        // offering a lattice edge there is no longer any such thing as.
        edgeCursor.visible = openCursor.visible = false;
        canvas.style.cursor = '';
        return;
      }
      const { a, b, len } = target;
      const yaw = -Math.atan2(b.z - a.z, b.x - a.x);
      edgeCursor.visible = true;
      edgeCursor.material.color.setHex(color);
      edgeCursor.material.opacity = 0.22;
      edgeCursor.rotation.y = yaw;
      edgeCursor.scale.set(Math.max(0.2, len / (CELL + WALL_T)), 1, 1);
      edgeCursor.position.set((a.x + b.x) / 2, baseY + WALL_H + 0.5, (a.z + b.z) / 2);
      // Over an existing opening the ghost sits on *it* and reads white — a
      // click removes it, a drag slides it, and the hand cursor says so.
      const o = target.opening;
      const w = o ? o.w : defaultOpeningWidth(doorKindOf(doorKind).opts);
      const gx = o ? a.x + (b.x - a.x) * o.t : target.x;
      const gz = o ? a.z + (b.z - a.z) * o.t : target.z;
      openCursor.visible = true;
      openCursor.material.color.setHex(o ? 0xffffff : color);
      openCursor.rotation.y = yaw;
      openCursor.scale.set(w, 1, 1);
      openCursor.position.set(gx, baseY + WALL_H + 0.55, gz);
      canvas.style.cursor = doorDrag && doorDrag.moved ? 'grabbing' : o ? 'grab' : '';
      return;
    }
    // The eraser acts on a room's own boundary, so the cursor follows the
    // segment it would act on rather than a lattice edge — which is also the
    // only honest preview, since a wall can run at any angle and be any length.
    const seg = isErase ? nearestSegment(f, p.x, p.z, segGrab()) : null;
    // ...and a free-standing wall is a boundary too, so the eraser reaches one.
    const line = !seg && isErase ? wallLineAt(f, p.x, p.z, segGrab()) : null;
    if (line) {
      const [la, lb] = lineEnds(line.line);
      const len = lineLength(line.line);
      edgeCursor.visible = true;
      cellCursor.visible = false;
      edgeCursor.material.color.setHex(color);
      edgeCursor.material.opacity = 0.55;
      edgeCursor.rotation.y = -Math.atan2(lb.z - la.z, lb.x - la.x);
      edgeCursor.scale.set(Math.max(0.2, len / (CELL + WALL_T)), 1, 1);
      edgeCursor.position.set((la.x + lb.x) / 2, baseY + WALL_H + 0.5, (la.z + lb.z) / 2);
      return;
    }
    if (seg) {
      const [a, b] = segEnds(seg.shape.rings[seg.ring], seg.seg);
      const len = segLength(a, b);
      edgeCursor.visible = true;
      cellCursor.visible = false;
      edgeCursor.material.color.setHex(color);
      edgeCursor.material.opacity = 0.55;
      edgeCursor.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      edgeCursor.scale.set(Math.max(0.2, len / (CELL + WALL_T)), 1, 1);
      edgeCursor.position.set((a.x + b.x) / 2, baseY + WALL_H + 0.5, (a.z + b.z) / 2);
    } else if (isErase && objectUnder(s, f, p.x, p.z)) {
      // Over something a click would delete whole — a stair, a lift, a chair,
      // a free-drawn room. Show no cell: the cell cursor promises "this 4ft
      // square", and this click is not going to take a 4ft square.
      edgeCursor.visible = cellCursor.visible = false;
      canvas.style.cursor = 'pointer';
      return;
    } else {
      const t = tileAtCursor(f, p.x, p.z);
      edgeCursor.visible = false;
      cellCursor.visible = !!t;
      if (t) {
        // Red over a room the brush will not touch, so the refusal is visible
        // before the click rather than only in the status line after it.
        const frozen = (tool === 'floor' || isErase) &&
          frozenAtPoint(s, s.currentFloor, t.cx, t.cz);
        cellCursor.material.color.setHex(frozen ? 0x8a94a6 : color);
        // The square the click would lay, at whatever the zoom's pitch is.
        cellCursor.scale.set(t.x1 - t.x0, t.z1 - t.z0, 1);
        cellCursor.position.set(t.cx, baseY + 0.08, t.cz);
      }
    }
  }

  // --- curving a wall ---
  //
  // `,` and `.` bend the polygon wall under the cursor — not `[` and `]`,
  // which have switched storeys since Phase 1 and are worth more there.
  // shapes.js tessellates
  // the arc into real vertices (see its "curved walls" note), so there is no
  // stored curvature to nudge — which is exactly why the memo below exists:
  // pressing the key again straightens what it laid down last time and re-lays
  // it at the new radius, instead of curving one chord of the previous arc.
  const CURVE_STEP = 0.08;
  const CURVE_MAX = 0.9;

  function curveUnderCursor(delta) {
    if (!hoverWorld) return false;
    const s = getState();
    const f = activeFloor(s);

    // Re-bending the arc we just made: put the chord back first.
    if (curveMemo && f.shapes.includes(curveMemo.shape)) {
      const next = Math.max(-CURVE_MAX, Math.min(CURVE_MAX, curveMemo.bulge + delta));
      pushUndo();
      straightenRun(curveMemo.shape, curveMemo.ring, curveMemo.seg, curveMemo.count);
      const count = curveSegment(curveMemo.shape, curveMemo.ring, curveMemo.seg, next);
      curveMemo = Math.abs(next) < 0.01
        ? null
        : { ...curveMemo, bulge: next, count };
      fire({ structural: true, commit: true });
      say(Math.abs(next) < 0.01
        ? 'Wall straightened.'
        : `Curved wall — ${count} segments, rise ${(next * 100).toFixed(0)}% of the chord. , and . adjust.`);
      return true;
    }

    const seg = nearestSegment(f, hoverWorld.x, hoverWorld.z, segGrab());
    if (!seg) {
      say('Curve — point at a polygon wall first. The lattice only builds straight edges.');
      return true;
    }
    pushUndo();
    const [a, b] = segEnds(seg.shape.rings[seg.ring], seg.seg);
    const had = seg.shape.rings[seg.ring].openings.some((o) => o.seg === seg.seg);
    const count = curveSegment(seg.shape, seg.ring, seg.seg, delta);
    if (count <= 1) {
      dropUndo();
      say(`Curve — that wall is only ${segLength(a, b).toFixed(1)}ft; there's no room to bend it.`);
      return true;
    }
    curveMemo = { shape: seg.shape, ring: seg.ring, seg: seg.seg, count, bulge: delta };
    fire({ structural: true, commit: true });
    say(had
      ? `Curved wall — ${count} segments. The doorway in it was dropped: a 2ft chord has nowhere to put a 3ft door.`
      : `Curved wall — ${count} segments. , and . adjust, and they re-bend this same wall rather than stacking arcs.`);
    return true;
  }

  // Nothing to drop: an edit that changed nothing diffs to nothing, so a
  // gesture that gave up costs no history without having to say so. Kept as a
  // hook because six tools call it, and because the day one of them wants to
  // *actually* discard a change it will want somewhere to say that.
  function dropUndo() {}

  // Keys this file claims for itself, before the sub-tools get a look in.
  function editorKey(e) {
    if (tool === 'floor' || tool === 'erase') {
      // R is unclaimed while the brush is the active tool — every other tool
      // that wants it (prop, template, vertex) checks its own `tool` first.
      if (e.code === 'KeyR') { setFloorRect(!floorRect); return true; }
      return false;
    }
    if (tool === 'door') {
      if (e.code === 'KeyS') { setDoorSnap(!doorSnap); return true; }
      if (e.code === 'Escape' && doorDrag) {
        // The opening stays where the last legal move put it; Ctrl-Z is the
        // way back. Dropping the mid-drag state is what Escape promises.
        doorDrag = null;
        canvas.style.cursor = '';
        return true;
      }
      return false;
    }
    if (tool === 'section') {
      if (e.code === 'KeyS') { setWallOrtho(!wallOrtho); return true; }
      if (e.code === 'Escape') return cancelSection();
      return false;
    }
    if (tool !== 'wall') return false;
    if (e.code === 'KeyS') { setWallOrtho(!wallOrtho); return true; }
    if (e.code === 'Escape') return cancelWallRun();
    if (e.code === 'Period') return curveUnderCursor(CURVE_STEP);
    if (e.code === 'Comma') return curveUnderCursor(-CURVE_STEP);
    return false;
  }

  function setDoorSnap(v) {
    doorSnap = !!v;
    updateCursor(null);
    say(doorSnap
      ? `Openings snap to the grid along the wall — ${pitch()} ft marks right now, ` +
        'finer as you zoom in. S sets them free; hold Alt for one free placement.'
      : 'Openings slide freely along the wall. S snaps them back to the grid.');
  }

  function setWallOrtho(v) {
    wallOrtho = !!v;
    refreshDraft();
    say(wallOrtho
      ? 'Walls square to the grid. S turns it off; hold Shift for one free run.'
      : 'Walls draw freely at any angle. S squares them back to the grid.');
  }

  function setFloorRect(v) {
    floorRect = !!v;
    const p = pitch();
    say(floorRect
      ? `Floor — drag a rectangle in ${p}ft tiles. R goes back to the brush.`
      : `Floor — the brush, one ${p}ft tile at a time. R draws rectangles instead.`);
  }

  // --- the door tool's target and gesture (Phase 36) ---
  //
  // One function turns the cursor into the spot on a wall the tool will act
  // on, and the hover ghost, the click and the drag all read it — the same
  // rule the wall tool's point target follows, and for the same reason: a
  // preview that snaps differently from the commit is worse than no preview.
  //
  // The snapped position and the *raw* one travel together. The snap decides
  // where a new opening lands; the raw projection decides which existing
  // opening is under the cursor, so a door placed off-grid stays clickable
  // and grabbable while snapping is on.
  function doorTargetAt(f, p, e) {
    const snapOn = doorSnap && !(e && e.altKey);
    const near = (list, len, ...ts) => {
      for (const t of ts) {
        const hit = list.find((o) => Math.abs(o.t - t) * len <= o.w / 2 + 0.5);
        if (hit) return hit;
      }
      return null;
    };
    const seg = nearestSegment(f, p.x, p.z, segGrab());
    if (seg) {
      const ring = seg.shape.rings[seg.ring];
      const [a, b] = segEnds(ring, seg.seg);
      const len = segLength(a, b);
      const hit = snapAlongSeg(a, b, p.x, p.z, pitch(), { snap: snapOn, origin: origin() });
      return {
        where: 'ring', shape: seg.shape, ring: seg.ring, seg: seg.seg,
        a, b, len, rawT: seg.t, t: hit.t, x: hit.x, z: hit.z,
        opening: near(openingsOnSeg(ring, seg.seg), len, seg.t, hit.t),
      };
    }
    // Not on a room's boundary — but a free-standing wall (wallrun.js) is
    // still a wall, and a wall you cannot put a door in is half a wall.
    const line = wallLineAt(f, p.x, p.z, segGrab());
    if (line) {
      const [a, b] = lineEnds(line.line);
      const len = lineLength(line.line);
      const hit = snapAlongSeg(a, b, p.x, p.z, pitch(), { snap: snapOn, origin: origin() });
      return {
        where: 'line', line: line.line,
        a, b, len, rawT: line.t, t: hit.t, x: hit.x, z: hit.z,
        opening: near(lineOpenings(line.line), len, line.t, hit.t),
      };
    }
    return null;
  }

  // What the current door kind records — the panel's options folded in.
  function doorCutOpts() {
    const dk = doorKindOf(doorKind);
    const opts = { ...dk.opts, hand: doorOpts.hand, sw: doorOpts.sw };
    if (dk.kind === 'single') { opts.lite = doorOpts.lite; opts.bar = doorOpts.bar; }
    if (dk.kind === 'window') opts.sill = doorOpts.sill;
    return opts;
  }

  // A press has to travel this many screen pixels before it stops being a
  // click — the same discrimination the rectangle eraser makes on the way up.
  const DOOR_DRAG_PX = 4;

  function doorPointerDown(p, e) {
    const s = getState();
    const f = activeFloor(s);
    const dk = doorKindOf(doorKind);
    const target = doorTargetAt(f, p, e);
    if (!target) {
      // Nothing under the cursor at all. A tool that does nothing and says
      // nothing reads as a broken tool — and "I clicked my wall and no door
      // appeared" is exactly what a silent miss looks like from outside.
      say(`${dk.label} — no wall there. ` +
        'Doors and windows cut into a wall you have already drawn: ' +
        'click along the wall itself.');
      return;
    }
    pushUndo();
    curveMemo = null;
    if (target.opening) {
      // Click or drag — the pointer decides on the way out. Held rather than
      // acted on, so a plain click still toggles the way it always has.
      doorDrag = {
        where: target.where, shape: target.shape, ring: target.ring, seg: target.seg,
        line: target.line, opening: target.opening, len: target.len,
        moved: false, downX: e.clientX, downY: e.clientY,
      };
      return;
    }
    const made = target.where === 'ring'
      ? toggleOpening(target.shape, target.ring, target.seg, target.t, null, doorCutOpts())
      : toggleLineOpening(target.line, target.t, null, doorCutOpts());
    fire({ structural: true, commit: true });
    say(made
      ? `${dk.label} — ${made.w.toFixed(1)}ft, cut into a ${target.len.toFixed(1)}ft wall.`
      : `${dk.label} — no room for it there.`);
  }

  function doorPointerMove(p, e) {
    if (!doorDrag || !p) return;
    const d = doorDrag;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.downX, e.clientY - d.downY) < DOOR_DRAG_PX) return;
      d.moved = true;
      canvas.style.cursor = 'grabbing';
    }
    // The drag is one-dimensional by design: an opening slides along the wall
    // it is cut into and never migrates to another one mid-gesture.
    const [a, b] = d.where === 'ring'
      ? segEnds(d.shape.rings[d.ring], d.seg)
      : lineEnds(d.line);
    const snapOn = doorSnap && !e.altKey;
    const hit = snapAlongSeg(a, b, p.x, p.z, pitch(), { snap: snapOn, origin: origin() });
    const before = d.opening.t;
    const at = d.where === 'ring'
      ? moveOpening(d.shape, d.ring, d.opening, hit.t)
      : moveLineOpening(d.line, d.opening, hit.t);
    if (at === null || at === before) return;
    fire({ structural: true, throttled: true });
    say(`${isWindowOpening(d.opening) ? 'Window' : 'Door'} — ` +
      `${(at * d.len).toFixed(1)} ft along its ${d.len.toFixed(1)} ft wall` +
      (snapOn ? ` (${pitch()} ft grid).` : ' (free).'));
  }

  function doorPointerUp() {
    if (!doorDrag) return false;
    const d = doorDrag;
    doorDrag = null;
    canvas.style.cursor = '';
    if (!d.moved) {
      // It was a click after all: the toggle it has always been — remove the
      // one you clicked, or re-cut it as the kind the panel has picked.
      const dk = doorKindOf(doorKind);
      const res = d.where === 'ring'
        ? toggleOpening(d.shape, d.ring, d.seg, d.opening.t, null, doorCutOpts())
        : toggleLineOpening(d.line, d.opening.t, null, doorCutOpts());
      fire({ structural: true, commit: true });
      say(res
        ? `${dk.label} — ${res.w.toFixed(1)}ft, cut into a ${d.len.toFixed(1)}ft wall.`
        : `${dk.label} removed.`);
      return true;
    }
    // A drag whose every move was refused diffs to nothing and costs no
    // history — the pushUndo-then-no-op convention.
    fire({ structural: true, commit: true });
    say(`${isWindowOpening(d.opening) ? 'Window' : 'Door'} — ` +
      `slid to ${(d.opening.t * d.len).toFixed(1)} ft along its wall.`);
    return true;
  }

  // --- pointer events ---
  let panning = false;
  let panLast = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // The actual tool dispatch, shared by the mouse/pen path (called straight
  // from pointerdown) and the touch path (called once a touch is confirmed
  // not to be the first finger of a pinch — see the touch section below).
  function dispatchPointerDown(e, p) {
    if (tool === 'poly' || tool === 'vertex') {
      canvas.setPointerCapture(e.pointerId);
      poly.pointerDown(p, e);
      return;
    }
    if (tool === 'prop') {
      canvas.setPointerCapture(e.pointerId);
      propTool.pointerDown(p, e);
      return;
    }
    if (tool === 'stair') {
      canvas.setPointerCapture(e.pointerId);
      stairTool.pointerDown(p, e);
      return;
    }
    if (tool === 'template') {
      canvas.setPointerCapture(e.pointerId);
      templateTool.pointerDown(p, e);
      return;
    }
    if (tool === 'site') {
      canvas.setPointerCapture(e.pointerId);
      siteTool.pointerDown(p, e);
      return;
    }
    if (tool === 'overlay') {
      canvas.setPointerCapture(e.pointerId);
      overlayTool.pointerDown(p, e);
      return;
    }
    // The wall tool is two clicks rather than a stroke — the same gesture the
    // overlay's measurement is taken with, and for the same reason: you often
    // zoom between the two ends, and a drag cannot survive that.
    if (tool === 'wall') {
      canvas.setPointerCapture(e.pointerId);
      wallPointerDown(p, e);
      return;
    }
    // The section tool shares the wall tool's two-click shape (Phase 37).
    if (tool === 'section') {
      canvas.setPointerCapture(e.pointerId);
      sectPointerDown(p, e);
      return;
    }
    // The annotation tool (Phase 38) owns its own gestures the way the
    // polygon and prop tools do.
    if (tool === 'anno') {
      canvas.setPointerCapture(e.pointerId);
      annoTool.pointerDown(p, e);
      return;
    }
    // The door tool is a target too (Phase 36): a press on bare wall cuts at
    // the snapped spot, a press on an existing opening waits to learn whether
    // it was a click (toggle) or a drag (slide).
    if (tool === 'door') {
      canvas.setPointerCapture(e.pointerId);
      doorPointerDown(p, e);
      return;
    }
    // The eraser answers for everything on the storey, not just the floor:
    // a *click* that lands on a wall, a stair, a lift, a ramp, a floor
    // opening, a piece of furniture or a free-drawn room removes that and
    // stops there.
    //
    // A click, though, and not a drag — which is why the rectangle eraser
    // decides on the way back up rather than here. Rubbing out a block of
    // floor that happens to *start* on a wall is a thing people do constantly,
    // and a press that deleted the wall instead would make the rectangle
    // eraser unusable along any edge of a room. The brush has no such
    // ambiguity (its stroke is cells all the way down), so it decides now.
    if (tool === 'erase' && p) {
      if (!floorRect) {
        if (eraseObjectAt(p.x, p.z)) { canvas.setPointerCapture(e.pointerId); return; }
      } else {
        eraseDown = { x: p.x, z: p.z };
      }
    }
    pushUndo();
    // Any ordinary edit ends the run of curve adjustments — the memo points at
    // a segment index the edit may well have moved.
    curveMemo = null;
    strokeActive = true;
    strokeChanged = false;
    strokeFrozen = 0;
    overhangRefused = 0;
    overhangArea = 0;
    strokeOffSheet = 0;
    lastWorld = null;
    // A rectangle waits for the pointer to come up before it lays anything
    // down: what it builds is a block, and a block has no meaning until the
    // second corner is known.
    if (floorRect && (tool === 'floor' || tool === 'erase')) {
      rectGesture = { a: { x: p.x, z: p.z }, b: { x: p.x, z: p.z } };
      refreshRect();
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    applyStroke(p.x, p.z, true);
    if (strokeChanged) fire({ structural: true });
    canvas.setPointerCapture(e.pointerId);
  }

  function dispatchPointerMove(e, p) {
    if (tool === 'poly' || tool === 'vertex') { if (p) poly.pointerMove(p, e); return; }
    if (tool === 'prop') { if (p) propTool.pointerMove(p, e); return; }
    if (tool === 'stair') { if (p) stairTool.pointerMove(p, e); return; }
    if (tool === 'template') { if (p) templateTool.pointerMove(p, e); return; }
    if (tool === 'site') { if (p) siteTool.pointerMove(p, e); return; }
    if (tool === 'overlay') { if (p) overlayTool.pointerMove(p, e); return; }
    if (tool === 'wall') { if (p) wallPointerMove(p, e); return; }
    if (tool === 'section') { if (p) sectPointerMove(p, e); return; }
    if (tool === 'anno') { if (p) annoTool.pointerMove(p, e); return; }
    if (tool === 'door') { doorPointerMove(p, e); return; }
    if (rectGesture) {
      if (!p) return;
      rectGesture.b = { x: p.x, z: p.z };
      refreshRect();
      const r = rectSize(rectSpan(rectGesture.a, rectGesture.b));
      say(`${tool === 'erase' ? 'Erase' : 'Floor'} — ` +
        `${ftLabel(r.w)} × ${ftLabel(r.d)} ft (${Math.round(r.area).toLocaleString()} ft²).`);
      return;
    }
    if (!strokeActive || !p) return;
    const before = strokeChanged;
    applyStroke(p.x, p.z, false);
    if (strokeChanged && strokeChanged !== before) fire({ structural: true });
    else if (strokeChanged) fire({ structural: true, throttled: true });
  }

  function dispatchPointerUp() {
    if (panning) { panning = false; panLast = null; }
    if (doorPointerUp()) return;
    if (poly.pointerUp()) return;
    if (propTool.pointerUp()) return;
    if (stairTool.pointerUp()) return;
    if (templateTool.pointerUp()) return;
    if (siteTool.pointerUp()) return;
    if (overlayTool.pointerUp()) return;
    if (tool === 'anno' && annoTool.pointerUp()) return;
    if (rectGesture) {
      const g = rectGesture;
      rectGesture = null;
      rectCursor.visible = false;
      // A rectangle one cell across is not a rectangle, it is a click — and a
      // click with something under it is a delete. See the note in
      // `dispatchPointerDown`.
      const down = eraseDown;
      eraseDown = null;
      if (tool === 'erase' && down) {
        const one = rectSpan(g.a, g.b);
        if (one.w === 1 && one.h === 1 && eraseObjectAt(down.x, down.z)) {
          strokeActive = false;
          lastWorld = null;
          return;
        }
      }
      const size = rectSize(applyRect(g.a, g.b));
      strokeActive = false;
      lastWorld = null;
      if (strokeChanged) {
        fire({ structural: true, commit: true });
        say(`${tool === 'erase' ? 'Erased' : 'Floor'} — ${ftLabel(size.w)} × ${ftLabel(size.d)} ft, ` +
          `${Math.round(size.area).toLocaleString()} ft².`);
      }
      if (overhangRefused) reportRefusal();
      else if (strokeFrozen) reportFrozen();
      else if (strokeOffSheet) reportOffSheet();
      else if (!strokeChanged) say('Nothing to change there.');
      return;
    }
    if (!strokeActive) return;
    strokeActive = false;
    lastWorld = null;
    if (!strokeChanged) {
      // A stroke that built nothing is the one case worth a word — otherwise
      // the tool looks broken.
      if (overhangRefused) reportRefusal();
      else if (strokeFrozen) reportFrozen();
      else if (strokeOffSheet) reportOffSheet();
      return;
    }
    fire({ structural: true, commit: true });
    if (overhangRefused) reportRefusal();
    else if (strokeFrozen) reportFrozen();
    else if (strokeOffSheet) reportOffSheet();
    else if (overhangArea) {
      say(`Overhang — ${Math.round(overhangArea).toLocaleString()} ft² of this storey now ` +
        'stands on nothing below.');
    }
  }

  // The brush and a free-drawn room don't mix: rasterizing an angled or curved
  // outline would straighten it, so paint.js refuses and this says which tool
  // does want that room. Same register as the overhang note below — a line in
  // the status bar, no interruption.
  function reportFrozen() {
    say(`${strokeFrozen} tile${strokeFrozen === 1 ? '' : 's'} skipped — ` +
      'a free-drawn room is there. Use the vertex tool (V) to reshape it.');
  }

  // The edge of the sheet, named along with the way past it. Until Phase 13
  // there was no way past it and the brush simply did nothing out here, which
  // is exactly how a 160 x 120ft plan under a 300ft tracing image reads as a
  // broken tool.
  function reportOffSheet() {
    const n = strokeOffSheet;
    strokeOffSheet = 0;
    say(
      `${n === 1 ? 'That tile is' : `${n} tiles are`} off the plan — ` +
      'the drawing surface ends there. Make it bigger with Plan in the Floors panel.');
  }

  // Unobtrusive on purpose: one line in the status bar naming the switch that
  // turns the limit off, and no interruption. The rule is a default, not a
  // verdict, and a tool that argued with you about a canopy would be worse
  // than one that let you draw a classroom in mid-air.
  function reportRefusal() {
    const n = overhangRefused;
    overhangRefused = 0;
    say(
      `${n === 1 ? 'That tile is' : `${n} tiles are`} outside the storey below — ` +
      'turn on “Allow overhangs” in the Layers panel to build there anyway.');
  }

  // --- touch: a single finger drives the current tool exactly like a mouse
  // click/drag would; a second finger pinch-zooms and pans the view instead.
  // Both fingers of a pinch typically land within a few tens of ms of each
  // other, so the first finger's action is held back briefly rather than
  // applied immediately — long enough to catch the second finger, short
  // enough (and cut short by the first sign of movement) that a real
  // single-finger tap or drag never feels delayed.
  const touchPts = new Map();      // pointerId -> {x, y}, every live touch
  let pendingTouch = null;         // { id, e, startX, startY, timer } — undecided yet
  let committedTouchId = null;     // the touch currently driving dispatchPointer*
  let touchGesture = null;         // { ids: [a, b], dist0, height0 } — pinch/pan

  const TOUCH_HOLDOFF_MS = 90;
  const TOUCH_MOVE_COMMIT_PX = 6;

  function touchDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // applyEditCamera() alone repositions the camera and refreshes its
  // projection matrix, but a camera's *world* matrix — what
  // raycaster.setFromCamera() actually reads — is normally only refreshed
  // once per animation frame, by the renderer, right before it draws. The
  // pinch/pan math below raycasts again immediately after moving the camera,
  // several times a gesture, so it has to force that refresh itself or every
  // "after" reading would still see the pre-move camera.
  function applyCameraNow() {
    renderApi.applyEditCamera();
    renderApi.editCamera.updateMatrixWorld(true);
  }

  function beginTouchGesture() {
    const ids = [...touchPts.keys()].slice(0, 2);
    const [a, b] = ids.map((id) => touchPts.get(id));
    touchGesture = { ids, dist0: touchDist(a, b), height0: renderApi.editView.height };
  }

  // Zoom by the pinch-distance ratio, then re-center so the world point under
  // the pinch's midpoint stays under it — which, for two fingers translating
  // together at a constant distance, is exactly a two-finger pan for free.
  function updateTouchGesture() {
    if (!touchGesture) return;
    const [a, b] = touchGesture.ids.map((id) => touchPts.get(id));
    if (!a || !b) return;
    const view = renderApi.editView;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const before = pointerToWorldXY(mid.x, mid.y);
    view.height = pinchZoomHeight(touchGesture.height0, touchGesture.dist0, touchDist(a, b));
    applyCameraNow();
    const after = pointerToWorldXY(mid.x, mid.y);
    if (before && after) {
      view.x += before.x - after.x;
      view.z += before.z - after.z;
      applyCameraNow();
    }
    poly.refresh(); propTool.refresh(); stairTool.refresh(); templateTool.refresh();
  }

  function commitPendingTouch() {
    strokeLive = true;
    if (!pendingTouch) return;
    clearTimeout(pendingTouch.timer);
    const { id, e } = pendingTouch;
    pendingTouch = null;
    const pt = touchPts.get(id);
    if (!pt) return;
    const p = pointerToWorldXY(pt.x, pt.y);
    if (!p) return;
    committedTouchId = id;
    dispatchPointerDown(e, p);
  }

  function armPendingTouch(id, e) {
    const pt = touchPts.get(id);
    pendingTouch = {
      id, e, startX: pt.x, startY: pt.y,
      timer: setTimeout(commitPendingTouch, TOUCH_HOLDOFF_MS),
    };
  }

  function resetTouchState() {
    touchPts.clear();
    if (pendingTouch) clearTimeout(pendingTouch.timer);
    pendingTouch = null;
    committedTouchId = null;
    touchGesture = null;
  }

  function touchPointerDown(e) {
    if (!enabled) return;
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastClient = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    // A tool interaction (or a gesture) is already under way — an extra
    // finger (a resting palm, a stray touch) is simply tracked and ignored,
    // rather than interrupting whichever one is running.
    if (touchGesture || committedTouchId !== null) return;
    if (touchPts.size >= 2) {
      if (pendingTouch) { clearTimeout(pendingTouch.timer); pendingTouch = null; }
      beginTouchGesture();
      return;
    }
    armPendingTouch(e.pointerId, e);
  }

  function touchPointerMove(e) {
    if (!enabled || !touchPts.has(e.pointerId)) return;
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchGesture) { updateTouchGesture(); return; }
    if (pendingTouch && pendingTouch.id === e.pointerId) {
      const dist = Math.hypot(e.clientX - pendingTouch.startX, e.clientY - pendingTouch.startY);
      if (dist > TOUCH_MOVE_COMMIT_PX) commitPendingTouch();
      return;
    }
    if (committedTouchId === e.pointerId) {
      updateCursor(e);
      lastClient = { x: e.clientX, y: e.clientY };
      dispatchPointerMove(e, pointerToWorld(e));
    }
  }

  function endTouch(id) {
    try { endTouchInner(id); } finally {
      strokeLive = false;
      if (onLiveMeasure) onLiveMeasure(null);
    }
  }

  function endTouchInner(id) {
    // commitPendingTouch() reads this touch's last position out of touchPts,
    // so the entry has to survive until after it runs — delete it last.
    if (pendingTouch && pendingTouch.id === id) {
      // Lifted before the hold-off decided anything — a plain tap.
      commitPendingTouch();
      dispatchPointerUp();
      committedTouchId = null;
      touchPts.delete(id);
      return;
    }
    if (committedTouchId === id) {
      dispatchPointerUp();
      committedTouchId = null;
      touchPts.delete(id);
      return;
    }
    if (touchGesture && touchGesture.ids.includes(id)) touchGesture = null;
    touchPts.delete(id);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    if (e.pointerType === 'touch') { touchPointerDown(e); return; }
    if (e.button === 1 || e.button === 2) {
      panning = true;
      panLast = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = pointerToWorld(e);
    if (!p) return;
    lastClient = { x: e.clientX, y: e.clientY };
    strokeLive = true;
    dispatchPointerDown(e, p);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!enabled) return;
    if (e.pointerType === 'touch') { touchPointerMove(e); return; }
    if (panning && panLast) {
      const view = renderApi.editView;
      const ftPerPx = view.height / canvas.clientHeight;
      view.x -= (e.clientX - panLast.x) * ftPerPx;
      view.z -= (e.clientY - panLast.y) * ftPerPx;
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    updateCursor(e);
    lastClient = { x: e.clientX, y: e.clientY };
    dispatchPointerMove(e, pointerToWorld(e));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') { endTouch(e.pointerId); return; }
    // The dispatch runs first: a click's action (a door cut, a room named)
    // says its line on the way up, and the chip should still catch it.
    dispatchPointerUp();
    strokeLive = false;
    if (onLiveMeasure) onLiveMeasure(null);
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') { endTouch(e.pointerId); return; }
    dispatchPointerUp();
    strokeLive = false;
    if (onLiveMeasure) onLiveMeasure(null);
  });
  canvas.addEventListener('pointerleave', () => {
    cellCursor.visible = edgeCursor.visible = openCursor.visible = false;
    wallHover = null;
    refreshDraft();
    poly.clearHover();
    propTool.clearHover();
    stairTool.clearHover();
    templateTool.clearHover();
    siteTool.clearHover();
    overlayTool.clearHover();
    annoTool.clearHover();
  });

  canvas.addEventListener('wheel', (e) => {
    if (!enabled) return;
    e.preventDefault();
    const view = renderApi.editView;
    view.height = Math.min(1000, Math.max(30, view.height * Math.exp(e.deltaY * 0.001)));
    // The drawing grid's pitch follows the zoom (snapgrid.js), so the point the
    // wall tool is aiming at moves under a stationary cursor. Re-target it from
    // the last known cursor position rather than leaving a dot on a line that
    // is no longer there.
    if (tool === 'wall' && hoverWorld) {
      wallHover = targetAt(hoverWorld, e);
      refreshDraft();
    }
    poly.refresh(); // handles and snap radius are sized off the zoom level
    propTool.refresh();
    stairTool.refresh();
    templateTool.refresh();
    siteTool.refresh();
    overlayTool.refresh();
    annoTool.refresh();
  }, { passive: false });

  return {
    get tool() { return tool; },
    setTool(t) {
      tool = t;
      curveMemo = null;
      // An unfinished run doesn't survive a tool change, the same way an
      // unfinished polygon outline doesn't.
      wallAnchor = null;
      wallHover = null;
      sectAnchor = null;
      sectHover = null;
      rectGesture = null;
      eraseDown = null;
      doorDrag = null;
      rectCursor.visible = false;
      refreshDraft();
      refreshSectDraft();
      refreshSectionOverlay();
      if (onLiveMeasure) onLiveMeasure(null);
      poly.setTool(t);
      propTool.setTool(t);
      stairTool.setTool(t);
      templateTool.setTool(t);
      siteTool.setTool(t);
      overlayTool.setTool(t);
      annoTool.setTool(t);
      updateCursor(null);
      if (t !== 'vertex') canvas.style.cursor = '';
    },
    // Keys the polygon and prop tools claim (close/cancel/backtrack/delete,
    // rotate/delete/escape/mirror). Returns true when one was used, so the
    // caller knows to stop handling it.
    handleKey: (e) => editorKey(e) || poly.key(e) || propTool.key(e) ||
      stairTool.key(e) || templateTool.key(e) || siteTool.key(e) || overlayTool.key(e) ||
      annoTool.key(e),
    get holeMode() { return poly.holeMode; },
    setHoleMode: (v) => poly.setHoleMode(v),
    refreshOverlay: () => {
      poly.refresh(); propTool.refresh(); stairTool.refresh();
      templateTool.refresh(); siteTool.refresh(); overlayTool.refresh();
      annoTool.refresh();
    },
    setRoom(name, color) { roomName = name; roomColor = color; },
    get roomName() { return roomName; },
    get roomColor() { return roomColor; },
    // Floor finish and wall paint travel with the room tool, alongside the
    // name and the label tint — one panel decides everything about a room.
    setRoomFinish(fin, paint) {
      if (fin !== undefined) roomFinish = fin;
      if (paint !== undefined) roomPaint = paint;
    },
    get roomFinish() { return roomFinish; },
    get roomPaint() { return roomPaint; },
    // ...and v11's two, which the room tool writes onto the record rather
    // than onto the geometry.
    setRoomUse(group, load) {
      if (group !== undefined) roomGroup = group || null;
      if (load !== undefined) roomLoad = Number.isFinite(load) && load > 0 ? Math.round(load) : null;
    },
    get roomGroup() { return roomGroup; },
    get roomLoad() { return roomLoad; },
    // The vertical-link tool's verbs, for the panel that lists them. The
    // pointer and the keyboard call the same four.
    stairSelect: (id) => stairTool.selectById(id),
    stairDelete: () => stairTool.deleteSelected(),
    stairRotate: (ccw) => stairTool.rotateSelected(ccw),
    stairNudge: (dx, dz) => stairTool.nudgeSelected(dx, dz),
    stairList: () => stairTool.listHere(),
    get stairSelectedId() { return stairTool.selectedId; },
    setPropType: (t) => propTool.setType(t),
    get propType() { return propTool.currentType; },
    // The prop tool's second knob (Phase 11): the paint. Same shape as the
    // type — set it for the next placement, read back what the panel should
    // highlight, which is the selected prop's own colour when there is one.
    setPropColor: (c) => propTool.setColor(c),
    get propColor() { return propTool.shownColor(); },
    get propPreviewColor() { return propTool.previewColor(); },
    // What the wall tool builds — shared by the grid and the polygon rooms, so
    // it lives on the editor rather than inside either half.
    setWallKind(k) { wallKind = wallKindOf(k).kind; refreshDraft(); updateCursor(null); },
    get wallKind() { return wallKind; },
    // Phase 25's two tool settings. Both are decisions about the editing
    // session rather than about the building, so both live here and neither is
    // ever written to a file — the same rule selections follow.
    setWallOrtho,
    get wallOrtho() { return wallOrtho; },
    setFloorRect,
    get floorRect() { return floorRect; },
    // The grid the tools are landing on right now: how fine, and where it
    // starts — what the chrome reports beside the toggle so neither number is
    // ever a mystery.
    get gridPitch() { return pitch(); },
    get gridOrigin() { return origin(); },
    get gridRef() { return gridRefOf(getState()); },
    get gridLocked() { return gridLocked(getState()); },
    get gridRefText() { return describeGridRef(getState()); },
    cancelWallRun,
    // Phase 36: whether openings snap to the grid along their wall. Session
    // state on the same terms as wallOrtho — never written to a file.
    setDoorSnap,
    get doorSnap() { return doorSnap; },
    // What the door tool cuts, and how the leaf in it hangs.
    setDoorKind(k) { doorKind = doorKindOf(k).kind; curveMemo = null; updateCursor(null); },
    get doorKind() { return doorKind; },
    setDoorOpts(patch) { Object.assign(doorOpts, patch); },
    get doorOpts() { return { ...doorOpts }; },
    setStairType: (t) => stairTool.setType(t),
    get stairType() { return stairTool.currentType; },
    get stairCount() { return stairTool.countHere(); },
    setTemplateKey: (k) => templateTool.setType(k),
    get templateKey() { return templateTool.currentKey; },
    // The site tool's own knobs. `setSiteStyle` doubles as "restyle the
    // selected region", which is why it reports whether it changed anything.
    setSiteMode: (m) => siteTool.setMode(m),
    get siteMode() { return siteTool.mode; },
    setSiteStyle: (surf, mark) => siteTool.setStyle(surf, mark),
    get siteSurface() { return siteTool.surface; },
    get siteMarking() { return siteTool.marking; },
    setSiteBrush: (v) => siteTool.setBrush(v),
    get siteBrush() { return siteTool.brush; },
    get siteSelection() { return siteTool.selected; },
    get siteRegionCount() { return siteTool.regionCount; },
    get siteRelief() { return siteTool.relief; },
    // The overlay tool's two knobs, and the structural-shadow switch the floor
    // tool reads. `allowOverhang` lives here rather than in saved state because
    // it is a decision about *this editing session*, not about the design —
    // shadow.js reads the overhangs back off the geometry whenever anybody asks.
    setOverlayMode: (m) => overlayTool.setMode(m),
    get overlayMode() { return overlayTool.mode; },
    get overlayMeasuring() { return overlayTool.measuring; },
    cancelMeasure: () => overlayTool.cancelMeasure(),
    // The annotation tool's knobs (Phase 38): which of its three gestures is
    // live, the sentence the next note gets, what is selected, and the
    // panel's own delete button.
    setAnnoMode: (m) => annoTool.setMode(m),
    get annoMode() { return annoTool.mode; },
    get annoHint() { return annoTool.hint(); },
    setAnnoText: (text) => annoTool.setText(text),
    get annoText() { return annoTool.text; },
    get annoSelection() { return annoTool.selection; },
    annoDelete: () => annoTool.deleteSelected(),
    setAllowOverhang(v) { allowOverhang = !!v; },
    get allowOverhang() { return allowOverhang; },
    // Ctrl combos never reach handleKey (see main.js), so copy/paste/duplicate
    // are called directly — for whichever of the prop or vertex tool is
    // active; each checks its own `tool` and no-ops otherwise.
    propCopy: () => propTool.copySelection(),
    propPaste: () => propTool.pasteClipboard(),
    propDuplicate: () => propTool.duplicateSelection(),
    shapeCopy: () => poly.sectionCopy(),
    shapePaste: () => poly.sectionPaste(),
    shapeDuplicate: () => poly.sectionDuplicate(),
    undo, redo, pushUndo, dropUndo,
    // The last gesture is still pending until something commits it, so
    // `canUndo` is "there is a step, or there is one waiting to be made".
    get canUndo() { return undoStack.length > 0 || dirty; },
    get canRedo() { return redoStack.length > 0; },
    clearHistory() {
      undoStack.length = 0;
      redoStack.length = 0;
      markClean();
    },
    // Forget the open edit without recording it — what a design that arrived
    // from somewhere else (a shared link, a fresh start) wants, so that the
    // next thing somebody draws is the first thing they can undo.
    markClean,
    setEnabled(v) {
      enabled = v;
      if (!v) {
        wallAnchor = null; wallHover = null; sectAnchor = null; sectHover = null;
        rectGesture = null; rectCursor.visible = false;
      }
      refreshDraft();
      refreshSectDraft();
      refreshSectionOverlay();
      // Walkthrough hides the overlay entirely; an unfinished outline doesn't
      // survive the round trip, which is the same deal the stroke tools get.
      poly.setTool(v ? tool : null);
      propTool.setTool(v ? tool : null);
      stairTool.setTool(v ? tool : null);
      templateTool.setTool(v ? tool : null);
      siteTool.setTool(v ? tool : null);
      overlayTool.setTool(v ? tool : null);
      annoTool.setTool(v ? tool : null);
      if (!v) { cellCursor.visible = edgeCursor.visible = false; strokeActive = false; resetTouchState(); }
    },
  };
}
