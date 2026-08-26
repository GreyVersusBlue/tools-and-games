// editor.js — editor shell: tools, pointer handling, pan/zoom, undo/redo.
//
// The 4ft brush lives here; the free-drawing tools live in polyedit.js and are
// driven through the same pointer stream. Until Phase 12 this file also had to
// decide which of two room representations a click was aimed at, and every
// shared tool — wall, door, room, erase — was written twice. There is one kind
// of room now: the brush paints cells onto it through paint.js, and everything
// else acts on the ring the cursor is nearest.

import * as THREE from 'three';
import {
  CELL, WALL_H, WALL_T, ROOM_COLORS, inGrid, activeFloor, floorBaseY,
} from './grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL,
  nearestSegment, shapeAt, setSegWall, toggleOpening, removeShape,
  curveSegment, straightenRun, segEnds, segLength, shapeArea,
  OP_DOOR, OP_WINDOW, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE, WINDOW_SILL,
} from './shapes.js';
import { paintCell, frozenAt } from './paint.js';
import { step, apply, clone } from './history.js';
import { applyFinish, DEFAULT_FINISH } from './finish.js';
import { initPolyEdit } from './polyedit.js';
import { initPropEdit } from './propedit.js';
import { initStairEdit } from './stairedit.js';
import { initTemplateEdit } from './templateedit.js';
import { initSiteEdit } from './siteedit.js';
import { initOverlayEdit } from './overlayedit.js';
import { cellSupported } from './shadow.js';
import { pinchZoomHeight } from './touch.js';

const MAX_UNDO = 100;

// How close to a polygon wall counts as clicking it, in feet.
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

export function initEditor({ canvas, renderApi, getState, onChange, onStatus, onHoleMode, onMeasure }) {
  let tool = 'floor'; // floor | wall | door | room | erase | poly | vertex | prop | stair | template | site | overlay
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
  // Per-door options the panel sets and every new opening inherits. `hand` is
  // which jamb the leaf hangs on, `sw` which side it swings toward; both are
  // toggles rather than validated values, since neither can be wrong.
  const doorOpts = { hand: 1, sw: 1, lite: false, bar: false, sill: WINDOW_SILL };

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
  let overhangRefused = 0;   // cells this stroke declined to build
  let strokeOverhang = 0;    // ...and cells it built outside the shadow anyway
  // ...and cells that were off the drawing surface altogether. Phase 13: the
  // sheet is a size somebody sets now, so "nothing happened when I painted
  // there" has an answer — and it is the same answer whether the plan needs
  // growing or the cursor simply wandered off the edge of it.
  let strokeOffSheet = 0;

  // The line the wall tool is drawing along, for as long as one stroke lasts.
  //
  // A drag used to take whichever segment was nearest the cursor, which is
  // right for a click and wrong for a drag: run the cursor along a wall,
  // wander a foot past its corner, and the nearest segment is the one at right
  // angles — so tracing the top of a room laid a stub down its side. A stroke
  // now takes its direction from the run it is on and will only move to
  // another run along the same line, which is what "drag along a wall" has
  // always meant.
  //
  // It rolls rather than anchoring on the first run, and the reason is curves:
  // a curved wall is tessellated into chords (see shapes.js), so a drag round
  // an arc is a sequence of runs each a few degrees off the last. Rolling
  // follows that and still stops dead at a corner, because a corner is one
  // step of ninety degrees rather than ten of nine. Tool state, never saved
  // state, and forgotten the moment the pointer lifts.
  let strokeDir = null;
  // Which walls the stroke passed over for turning a corner — as a set of
  // ids, not a count, because a drag samples the path several times a foot
  // (see `applyStroke`) and counting samples would report one corner as
  // seventeen walls.
  const strokeSkewed = new Set();

  const undoStack = [];
  const redoStack = [];
  let strokeActive = false;
  let strokeChanged = false;
  let strokeFrozen = 0;   // cells this stroke declined because a free-drawn
                          // room was under them — see paint.js
  let enabled = true;

  // --- hover cursors ---
  const cellCursor = new THREE.Mesh(
    new THREE.PlaneGeometry(CELL, CELL),
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
  renderApi.scene.add(cellCursor, edgeCursor);

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

  // Which 4ft cell of the drawing surface a world point is over. The editor
  // only ever touches the storey currently selected in the floor panel.
  function cellAt(f, wx, wz) {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    return inGrid(f, x, y) ? { x, y } : null;
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
  // (terrain, site, roof, code, life, timetable, overlay, tours, models) is
  // one of these.
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
      status: (text) => onStatus && onStatus(text),
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
      status: (text) => onStatus && onStatus(text),
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
      status: (text) => onStatus && onStatus(text),
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
      status: (text) => onStatus && onStatus(text),
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
      status: (text) => onStatus && onStatus(text),
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
      status: (text) => onStatus && onStatus(text),
      setOverlay: (o, info = {}) => {
        const st = getState();
        if (o) st.overlay = o;
        fire({ structural: false, overlay: true, ...info });
      },
      // Both ends of a measurement, in image pixels. The shell puts up the
      // "how many feet is that?" prompt, because a dialog is not a tool's job.
      measured: (a, b) => onMeasure && onMeasure(a, b),
    },
  });

  // --- tool application ---

  function applyAt(wx, wz, isClick) {
    const s = getState();
    const f = activeFloor(s);
    if (tool === 'floor') {
      const c = cellAt(f, wx, wz);
      if (!c) { strokeOffSheet++; return; }
      // Phase 8's structural shadow. An upper storey is limited to the
      // footprint of the one below it by default — you cannot lay slab over
      // thin air by accident — and overhangs are switched on rather than
      // switched off, because a cantilever is something somebody decides to
      // draw. The refusal is a status line and nothing else: no dialog, no
      // beep, no red flash. See the note on `allowOverhang` below.
      if (!allowOverhang && !cellSupported(s, s.currentFloor, c.x, c.y)) {
        overhangRefused++;
        return;
      }
      // The brush paints a room's ring, not a cell in a file — see paint.js.
      // A cell joins whichever room it can walk to, or starts one.
      const out = paintCell(s, s.currentFloor, c.x, c.y, true, {
        name: roomName || 'Room', color: roomColor, fin: roomFinish, paint: roomPaint,
      });
      if (out.refused) { strokeFrozen++; return; }
      if (out.changed) {
        strokeChanged = true;
        if (allowOverhang && !cellSupported(s, s.currentFloor, c.x, c.y)) strokeOverhang++;
      }
    } else if (tool === 'wall') {
      const kind = wallKindOf(wallKind);
      // Held to the stroke's own line — see `strokeDir`. A click has no line
      // yet and takes whatever is under it, which is how the line gets set.
      const seg = nearestSegment(f, wx, wz, SEG_GRAB, { parallelTo: strokeDir });
      if (!seg) {
        // Something *is* under the cursor, it just turns a corner. Noted so
        // the stroke can say so rather than looking like it missed.
        const off = strokeDir && nearestSegment(f, wx, wz, SEG_GRAB);
        if (off) strokeSkewed.add(`${off.shape.id}:${off.ring}:${off.seg}`);
        return;
      }
      strokeDir = seg.dir || strokeDir;
      if (setSegWall(seg.shape, seg.ring, seg.seg, kind.seg)) {
        strokeChanged = true;
        const [a, b] = segEnds(seg.shape.rings[seg.ring], seg.seg);
        onStatus && onStatus(`Wall — ${kind.label.toLowerCase()}, ${segLength(a, b).toFixed(1)}ft.`);
      }
    } else if (tool === 'door') {
      if (!isClick) return; // doors place on click, not drag
      const dk = doorKindOf(doorKind);
      // An opening is cut where you clicked along the run rather than at the
      // middle of anything — a 30ft wall can hold several.
      const seg = nearestSegment(f, wx, wz, SEG_GRAB);
      if (!seg) return;
      const opts = { ...dk.opts, hand: doorOpts.hand, sw: doorOpts.sw };
      if (dk.kind === 'single') { opts.lite = doorOpts.lite; opts.bar = doorOpts.bar; }
      if (dk.kind === 'window') opts.sill = doorOpts.sill;
      const cut = toggleOpening(seg.shape, seg.ring, seg.seg, seg.t, null, opts);
      strokeChanged = true;
      onStatus && onStatus(cut
        ? `${dk.label} — ${cut.w.toFixed(1)}ft, cut into a ${segLength(...segEnds(seg.shape.rings[seg.ring], seg.seg)).toFixed(1)}ft wall.`
        : `${dk.label} removed.`);
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
      onStatus && onStatus(`${shape.name} — ${said.join(', ')}.`);
    } else if (tool === 'erase') {
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
      const frozen = isClick ? frozenAt(s, s.currentFloor, ...cellXY(f, wx, wz)) : null;
      if (frozen) {
        removeShape(f, frozen.id);
        strokeChanged = true;
        return;
      }
      const c = cellAt(f, wx, wz);
      if (!c) { strokeOffSheet++; return; }
      const out = paintCell(s, s.currentFloor, c.x, c.y, false);
      if (out.changed) strokeChanged = true;
    }
  }

  // The cell a world point is over, as the two arguments `frozenAt` wants.
  function cellXY(f, wx, wz) {
    return [Math.floor(wx / CELL), Math.floor(wz / CELL)];
  }

  // Sample along the drag path so fast strokes don't skip cells/edges
  let lastWorld = null;
  function applyStroke(wx, wz, isClick) {
    if (lastWorld && !isClick) {
      const dx = wx - lastWorld.x, dz = wz - lastWorld.z;
      const dist = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(dist / (CELL * 0.4)));
      for (let i = 1; i <= steps; i++) {
        applyAt(lastWorld.x + (dx * i) / steps, lastWorld.z + (dz * i) / steps, false);
      }
    } else {
      applyAt(wx, wz, isClick);
    }
    lastWorld = { x: wx, z: wz };
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
        tool === 'stair' || tool === 'template' || tool === 'site') {
      cellCursor.visible = edgeCursor.visible = false;
      return;
    }
    const isErase = tool === 'erase';
    // The wall cursor takes the colour of the thing it would build, so glass
    // and railing are distinguishable before you commit to one.
    const color = isErase ? 0xff5f56
      : tool === 'door' ? 0xd9a05b
      : tool === 'wall' ? wallKindOf(wallKind).color
      : 0x4da3ff;

    // The wall, door and erase tools all act on a room's own boundary now, so
    // the cursor follows the segment they would act on rather than a lattice
    // edge — which is also the only honest preview, since a wall can run at
    // any angle and be any length. Mid-drag the wall cursor is held to the
    // stroke's line as well, so what is highlighted is what the next sample
    // will actually build rather than what is merely nearest.
    const seg = (tool === 'wall' || tool === 'door' || isErase)
      ? nearestSegment(f, p.x, p.z, SEG_GRAB,
        tool === 'wall' && strokeActive ? { parallelTo: strokeDir } : {})
      : null;
    if (seg) {
      const [a, b] = segEnds(seg.shape.rings[seg.ring], seg.seg);
      const len = segLength(a, b);
      edgeCursor.visible = true;
      cellCursor.visible = false;
      edgeCursor.material.color.setHex(color);
      edgeCursor.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      edgeCursor.scale.set(Math.max(0.2, len / (CELL + WALL_T)), 1, 1);
      edgeCursor.position.set((a.x + b.x) / 2, baseY + WALL_H + 0.5, (a.z + b.z) / 2);
    } else if (tool === 'wall' || tool === 'door') {
      // Nothing within reach: say so by showing nothing rather than by
      // offering a lattice edge there is no longer any such thing as.
      edgeCursor.visible = cellCursor.visible = false;
    } else {
      const c = cellAt(f, p.x, p.z);
      edgeCursor.visible = false;
      cellCursor.visible = !!c;
      if (c) {
        // Red over a room the brush will not touch, so the refusal is visible
        // before the click rather than only in the status line after it.
        const frozen = (tool === 'floor' || isErase) && frozenAt(s, s.currentFloor, c.x, c.y);
        cellCursor.material.color.setHex(frozen ? 0x8a94a6 : color);
        cellCursor.position.set((c.x + 0.5) * CELL, baseY + 0.08, (c.y + 0.5) * CELL);
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
      onStatus && onStatus(Math.abs(next) < 0.01
        ? 'Wall straightened.'
        : `Curved wall — ${count} segments, rise ${(next * 100).toFixed(0)}% of the chord. , and . adjust.`);
      return true;
    }

    const seg = nearestSegment(f, hoverWorld.x, hoverWorld.z, SEG_GRAB);
    if (!seg) {
      onStatus && onStatus('Curve — point at a polygon wall first. The lattice only builds straight edges.');
      return true;
    }
    pushUndo();
    const [a, b] = segEnds(seg.shape.rings[seg.ring], seg.seg);
    const had = seg.shape.rings[seg.ring].openings.some((o) => o.seg === seg.seg);
    const count = curveSegment(seg.shape, seg.ring, seg.seg, delta);
    if (count <= 1) {
      dropUndo();
      onStatus && onStatus(`Curve — that wall is only ${segLength(a, b).toFixed(1)}ft; there's no room to bend it.`);
      return true;
    }
    curveMemo = { shape: seg.shape, ring: seg.ring, seg: seg.seg, count, bulge: delta };
    fire({ structural: true, commit: true });
    onStatus && onStatus(had
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
    if (tool !== 'wall') return false;
    if (e.code === 'Period') return curveUnderCursor(CURVE_STEP);
    if (e.code === 'Comma') return curveUnderCursor(-CURVE_STEP);
    return false;
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
    pushUndo();
    // Any ordinary edit ends the run of curve adjustments — the memo points at
    // a segment index the edit may well have moved.
    curveMemo = null;
    strokeActive = true;
    strokeChanged = false;
    strokeFrozen = 0;
    overhangRefused = 0;
    strokeOverhang = 0;
    strokeDir = null;
    strokeSkewed.clear();
    strokeOffSheet = 0;
    lastWorld = null;
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
    if (!strokeActive || !p) return;
    const before = strokeChanged;
    applyStroke(p.x, p.z, false);
    if (strokeChanged && strokeChanged !== before) fire({ structural: true });
    else if (strokeChanged) fire({ structural: true, throttled: true });
  }

  function dispatchPointerUp() {
    if (panning) { panning = false; panLast = null; }
    if (poly.pointerUp()) return;
    if (propTool.pointerUp()) return;
    if (stairTool.pointerUp()) return;
    if (templateTool.pointerUp()) return;
    if (siteTool.pointerUp()) return;
    if (overlayTool.pointerUp()) return;
    if (!strokeActive) return;
    strokeActive = false;
    lastWorld = null;
    strokeDir = null;
    if (!strokeChanged) {
      // A stroke that built nothing is the one case worth a word — otherwise
      // the tool looks broken.
      if (overhangRefused) reportRefusal();
      else if (strokeFrozen) reportFrozen();
      else if (strokeSkewed.size) reportSkewed();
      else if (strokeOffSheet) reportOffSheet();
      return;
    }
    fire({ structural: true, commit: true });
    if (overhangRefused) reportRefusal();
    else if (strokeFrozen) reportFrozen();
    else if (strokeSkewed.size) reportSkewed();
    else if (strokeOffSheet) reportOffSheet();
    else if (strokeOverhang) {
      const area = strokeOverhang * CELL * CELL;
      onStatus && onStatus(`Overhang — ${area.toLocaleString()} ft² of this storey now ` +
        'stands on nothing below.');
    }
  }

  // The brush and a free-drawn room don't mix: rasterizing an angled or curved
  // outline would straighten it, so paint.js refuses and this says which tool
  // does want that room. Same register as the overhang note below — a line in
  // the status bar, no interruption.
  function reportFrozen() {
    onStatus && onStatus(`${strokeFrozen} cell${strokeFrozen === 1 ? '' : 's'} skipped — ` +
      'a free-drawn room is there. Use the vertex tool (V) to reshape it.');
  }

  // The corner the drag declined to turn. Worth one line, because "I dragged
  // over it and nothing happened" is otherwise indistinguishable from a tool
  // that has stopped working — and because the way to build that wall is a
  // second stroke rather than a setting.
  function reportSkewed() {
    const n = strokeSkewed.size;
    strokeSkewed.clear();
    onStatus && onStatus(`${n === 1 ? 'A wall' : `${n} walls`} at an angle to this one ` +
      'left alone — a drag follows one wall round a curve, but not round a corner. ' +
      'Draw across them separately.');
  }

  // The edge of the sheet, named along with the way past it. Until Phase 13
  // there was no way past it and the brush simply did nothing out here, which
  // is exactly how a 160 x 120ft plan under a 300ft tracing image reads as a
  // broken tool.
  function reportOffSheet() {
    const cells = strokeOffSheet;
    strokeOffSheet = 0;
    onStatus && onStatus(
      `${cells === 1 ? 'That cell is' : `${cells} cells are`} off the plan — ` +
      'the drawing surface ends there. Make it bigger with Plan in the Floors panel.');
  }

  // Unobtrusive on purpose: one line in the status bar naming the switch that
  // turns the limit off, and no interruption. The rule is a default, not a
  // verdict, and a tool that argued with you about a canopy would be worse
  // than one that let you draw a classroom in mid-air.
  function reportRefusal() {
    const cells = overhangRefused;
    overhangRefused = 0;
    onStatus && onStatus(
      `${cells === 1 ? 'That cell is' : `${cells} cells are`} outside the storey below — ` +
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
      dispatchPointerMove(e, pointerToWorld(e));
    }
  }

  function endTouch(id) {
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
    dispatchPointerMove(e, pointerToWorld(e));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') { endTouch(e.pointerId); return; }
    dispatchPointerUp();
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') { endTouch(e.pointerId); return; }
    dispatchPointerUp();
  });
  canvas.addEventListener('pointerleave', () => {
    cellCursor.visible = edgeCursor.visible = false;
    poly.clearHover();
    propTool.clearHover();
    stairTool.clearHover();
    templateTool.clearHover();
    siteTool.clearHover();
    overlayTool.clearHover();
  });

  canvas.addEventListener('wheel', (e) => {
    if (!enabled) return;
    e.preventDefault();
    const view = renderApi.editView;
    view.height = Math.min(1000, Math.max(30, view.height * Math.exp(e.deltaY * 0.001)));
    poly.refresh(); // handles and snap radius are sized off the zoom level
    propTool.refresh();
    stairTool.refresh();
    templateTool.refresh();
    siteTool.refresh();
    overlayTool.refresh();
  }, { passive: false });

  return {
    get tool() { return tool; },
    setTool(t) {
      tool = t;
      curveMemo = null;
      poly.setTool(t);
      propTool.setTool(t);
      stairTool.setTool(t);
      templateTool.setTool(t);
      siteTool.setTool(t);
      overlayTool.setTool(t);
      updateCursor(null);
      if (t !== 'vertex') canvas.style.cursor = '';
    },
    // Keys the polygon and prop tools claim (close/cancel/backtrack/delete,
    // rotate/delete/escape/mirror). Returns true when one was used, so the
    // caller knows to stop handling it.
    handleKey: (e) => editorKey(e) || poly.key(e) || propTool.key(e) ||
      stairTool.key(e) || templateTool.key(e) || siteTool.key(e) || overlayTool.key(e),
    get holeMode() { return poly.holeMode; },
    setHoleMode: (v) => poly.setHoleMode(v),
    refreshOverlay: () => {
      poly.refresh(); propTool.refresh(); stairTool.refresh();
      templateTool.refresh(); siteTool.refresh(); overlayTool.refresh();
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
    setWallKind(k) { wallKind = wallKindOf(k).kind; updateCursor(null); },
    get wallKind() { return wallKind; },
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
      // Walkthrough hides the overlay entirely; an unfinished outline doesn't
      // survive the round trip, which is the same deal the stroke tools get.
      poly.setTool(v ? tool : null);
      propTool.setTool(v ? tool : null);
      stairTool.setTool(v ? tool : null);
      templateTool.setTool(v ? tool : null);
      siteTool.setTool(v ? tool : null);
      overlayTool.setTool(v ? tool : null);
      if (!v) { cellCursor.visible = edgeCursor.visible = false; strokeActive = false; resetTouchState(); }
    },
  };
}
