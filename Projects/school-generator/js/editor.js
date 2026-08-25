// editor.js — editor shell: tools, pointer handling, pan/zoom, undo/redo.
//
// The grid tools live here. The polygon tools live in polyedit.js and are
// driven through the same pointer stream — this file decides which of the two
// room representations a click is aimed at, which for the shared tools (wall,
// door, room, erase) means "whichever is nearer the cursor".

import * as THREE from 'three';
import {
  CELL, WALL_H, WALL_T, ROOM_COLORS,
  EDGE_NONE, EDGE_WALL, EDGE_DOOR, EDGE_DOOR2, EDGE_GLASS, EDGE_RAIL,
  EDGE_WINDOW, EDGE_OPENING,
  cellIdx, edgeHIdx, edgeVIdx, inGrid, getCell, setTile, floodRegion,
  activeFloor, floorBaseY,
} from './grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL,
  nearestSegment, shapeAt, setSegWall, toggleOpening, removeShape,
  curveSegment, straightenRun, segEnds, segLength,
  OP_DOOR, OP_WINDOW, LEAF_NONE, LEAF_SINGLE, LEAF_DOUBLE, WINDOW_SILL,
} from './shapes.js';
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

// The wall tool builds one of three things, and the two room representations
// spell each of them differently — so the choice is made once, here, and both
// halves of the editor read it out of the same table.
export const WALL_KINDS = [
  { kind: 'wall',  label: 'Solid',   icon: '▬', edge: EDGE_WALL,  seg: SEG_WALL,  color: 0x4da3ff },
  { kind: 'glass', label: 'Glass',   icon: '⬚', edge: EDGE_GLASS, seg: SEG_GLASS, color: 0x67d5e8 },
  { kind: 'rail',  label: 'Railing', icon: '⑊', edge: EDGE_RAIL,  seg: SEG_RAIL,  color: 0x7ce0a0 },
];
const wallKindOf = (k) => WALL_KINDS.find((w) => w.kind === k) || WALL_KINDS[0];

// What the door tool cuts. The same table serves both halves of the room
// model, as WALL_KINDS does: `edge` is the lattice value, `opts` is what a
// polygon opening records. The lattice needs one kind per variant because an
// edge is a value with nowhere to keep options — see EDGE_OPENING in grid.js.
export const DOOR_KINDS = [
  { kind: 'single', label: 'Single door', icon: '🚪', edge: EDGE_DOOR,
    opts: { k: OP_DOOR, leaf: LEAF_SINGLE } },
  { kind: 'double', label: 'Double door', icon: '🚪🚪', edge: EDGE_DOOR2,
    opts: { k: OP_DOOR, leaf: LEAF_DOUBLE, lite: true, bar: true } },
  { kind: 'cased',  label: 'Cased opening', icon: '⌷', edge: EDGE_OPENING,
    opts: { k: OP_DOOR, leaf: LEAF_NONE } },
  { kind: 'window', label: 'Window', icon: '🪟', edge: EDGE_WINDOW,
    opts: { k: OP_WINDOW } },
];
const doorKindOf = (k) => DOOR_KINDS.find((d) => d.kind === k) || DOOR_KINDS[0];

export function initEditor({ canvas, renderApi, getState, onChange, onStatus, onHoleMode, onMeasure }) {
  let tool = 'floor'; // floor | wall | door | room | erase | poly | vertex | prop | stair | template | site | overlay
  let roomName = 'Room 101';
  let roomColor = ROOM_COLORS[0];
  let roomFinish = DEFAULT_FINISH;
  let roomPaint = null;      // null = whatever the renderer paints by default
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

  const undoStack = [];
  const redoStack = [];
  let strokeActive = false;
  let strokeChanged = false;
  let strokeWallFt = 0;   // grid wall footage built so far this stroke — see applyAt('wall')
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

  // Nearest edge to a world point: {kind:'H'|'V', x, y, dist} (dist in cell fractions)
  // All of these take a *floor* record — the editor only ever touches the
  // storey currently selected in the floor panel.
  function nearestEdge(f, wx, wz) {
    const fx = wx / CELL, fz = wz / CELL;
    let cx = Math.floor(fx), cz = Math.floor(fz);
    cx = Math.min(Math.max(cx, 0), f.w - 1);
    cz = Math.min(Math.max(cz, 0), f.h - 1);
    const dx = fx - cx, dz = fz - cz;
    const cands = [
      { kind: 'V', x: cx,     y: cz, dist: Math.abs(dx) },
      { kind: 'V', x: cx + 1, y: cz, dist: Math.abs(1 - dx) },
      { kind: 'H', x: cx, y: cz,     dist: Math.abs(dz) },
      { kind: 'H', x: cx, y: cz + 1, dist: Math.abs(1 - dz) },
    ];
    cands.sort((a, b) => a.dist - b.dist);
    return cands[0];
  }

  function cellAt(f, wx, wz) {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    return inGrid(f, x, y) ? { x, y } : null;
  }

  function edgeRef(f, e) {
    return e.kind === 'H'
      ? { arr: f.edgesH, i: edgeHIdx(f, e.x, e.y) }
      : { arr: f.edgesV, i: edgeVIdx(f, e.x, e.y) };
  }

  // --- undo/redo ---
  //
  // A snapshot is JSON, which is what makes undo a two-line feature and what
  // the v1 retrospective calls out as O(design). Phase 8 added the one field
  // that breaks that arithmetic: an `overlay` carries an image as a data URL,
  // and stringifying up to three megabytes of base64 on every pointerdown,
  // a hundred deep, is a hundred megabytes of undo history for a picture
  // nobody edits.
  //
  // So the overlay travels beside the JSON rather than inside it, by
  // reference. That is safe for exactly one reason and it is worth stating:
  // **an overlay record is never mutated in place.** Every change to it —
  // move, turn, fade, calibrate — goes through overlay.js's `setOverlay`,
  // which returns a new normalized object, so a reference held here is a
  // snapshot of what the overlay was, not a live view of what it is.
  function snapshot() {
    const s = getState();
    const { overlay, ...rest } = s;
    return { json: JSON.stringify(rest), overlay: overlay || null };
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  function restore(snap) {
    const s = getState();
    const data = JSON.parse(snap.json);
    if (snap.overlay) data.overlay = snap.overlay;
    // Keys the snapshot doesn't have are keys the design didn't have.
    // `Object.assign` only ever adds and overwrites, so without this an undo
    // across the moment something was *first* written — the first site region,
    // the first grading stroke, the first tracing image — leaves that record
    // behind and the undo silently does nothing. Every optional record on the
    // state (terrain, site, roof, life, overlay) is one of these.
    for (const key of Object.keys(s)) if (!(key in data)) delete s[key];
    Object.assign(s, data);
    onChange({ structural: true });
    poly.refresh();
  }

  function undo() {
    if (!undoStack.length) return;
    curveMemo = null;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    curveMemo = null;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  // --- polygon tools ---
  // polyedit owns its own overlay and calls back in here for undo, redraws and
  // the status line, so both halves of the editor share one history.
  const poly = initPolyEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo: () => { undoStack.pop(); },
      changed: (info = {}) => onChange({ structural: true, ...info }),
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
      pushUndo, dropUndo: () => { undoStack.pop(); },
      changed: (info = {}) => onChange({ structural: true, ...info }),
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
      pushUndo, dropUndo: () => { undoStack.pop(); },
      changed: (info = {}) => onChange({ structural: true, ...info }),
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
      pushUndo, dropUndo: () => { undoStack.pop(); },
      changed: (info = {}) => onChange({ structural: true, ...info }),
      status: (text) => onStatus && onStatus(text),
    },
  });

  // siteedit owns the ground and everything laid on it. Same host wiring as
  // the other four — the site has no history of its own either.
  const siteTool = initSiteEdit({
    getState,
    renderApi,
    host: {
      pushUndo, dropUndo: () => { undoStack.pop(); },
      changed: (info = {}) => onChange({ structural: true, ...info }),
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
      pushUndo, dropUndo: () => { undoStack.pop(); },
      changed: (info = {}) => onChange({ structural: false, overlay: true, ...info }),
      status: (text) => onStatus && onStatus(text),
      setOverlay: (o, info = {}) => {
        const st = getState();
        if (o) st.overlay = o;
        onChange({ structural: false, overlay: true, ...info });
      },
      // Both ends of a measurement, in image pixels. The shell puts up the
      // "how many feet is that?" prompt, because a dialog is not a tool's job.
      measured: (a, b) => onMeasure && onMeasure(a, b),
    },
  });

  // --- tool application ---

  // Nearest polygon wall to the cursor, if one is within grabbing distance and
  // closer than the grid edge the cursor is over.
  function nearPolySeg(f, wx, wz, gridDistFt) {
    const seg = nearestSegment(f, wx, wz, SEG_GRAB);
    if (!seg) return null;
    return gridDistFt === undefined || seg.dist < gridDistFt ? seg : null;
  }

  function applyAt(wx, wz, isClick) {
    const s = getState();
    const f = activeFloor(s);
    if (tool === 'floor') {
      const c = cellAt(f, wx, wz);
      if (!c) return;
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
      if (setTile(f, c.x, c.y, true)) {
        strokeChanged = true;
        if (allowOverhang && !cellSupported(s, s.currentFloor, c.x, c.y)) strokeOverhang++;
      }
    } else if (tool === 'wall') {
      const kind = wallKindOf(wallKind);
      const e = nearestEdge(f, wx, wz);
      const seg = nearPolySeg(f, wx, wz, e.dist * CELL);
      if (seg) {
        if (setSegWall(seg.shape, seg.ring, seg.seg, kind.seg)) {
          strokeChanged = true;
          // A polygon wall can be any length, so its own segment length is
          // worth reporting the moment you raise it — the grid case below
          // reports its running total on stroke end instead, since one edge
          // is always exactly one cell wide.
          const [a, b] = segEnds(seg.shape.rings[seg.ring], seg.seg);
          onStatus && onStatus(`Wall — ${kind.label.toLowerCase()}, ${segLength(a, b).toFixed(1)}ft.`);
        }
        return;
      }
      const ref = edgeRef(f, e);
      if (ref.arr[ref.i] !== kind.edge) {
        if (ref.arr[ref.i] === EDGE_NONE) strokeWallFt += CELL;
        ref.arr[ref.i] = kind.edge;
        strokeChanged = true;
      }
    } else if (tool === 'door') {
      if (!isClick) return; // doors place on click, not drag
      const dk = doorKindOf(doorKind);
      const e = nearestEdge(f, wx, wz);
      // On a polygon wall an opening is cut where you clicked along the run,
      // not at the middle of a lattice edge — a 30ft wall can hold several.
      const seg = nearPolySeg(f, wx, wz, e.dist * CELL);
      if (seg) {
        const opts = { ...dk.opts, hand: doorOpts.hand, sw: doorOpts.sw };
        if (dk.kind === 'single') { opts.lite = doorOpts.lite; opts.bar = doorOpts.bar; }
        if (dk.kind === 'window') opts.sill = doorOpts.sill;
        const cut = toggleOpening(seg.shape, seg.ring, seg.seg, seg.t, null, opts);
        strokeChanged = true;
        onStatus && onStatus(cut
          ? `${dk.label} — ${cut.w.toFixed(1)}ft, cut into a ${segLength(...segEnds(seg.shape.rings[seg.ring], seg.seg)).toFixed(1)}ft wall.`
          : `${dk.label} removed.`);
        return;
      }
      const ref = edgeRef(f, e);
      // Clicking the same kind again takes it out and leaves the kind of wall
      // the wall tool would build now — a glazed partition with a door in it is
      // one click away, and one more puts the glass back rather than drywall.
      ref.arr[ref.i] = ref.arr[ref.i] === dk.edge ? wallKindOf(wallKind).edge : dk.edge;
      strokeChanged = true;
    } else if (tool === 'room') {
      if (!isClick) return;
      // Polygon rooms sit on top of the grid, so they answer the click first.
      const shape = shapeAt(f, wx, wz);
      if (shape) {
        shape.name = roomName || 'Room';
        shape.color = roomColor;
        applyFinish(shape, roomFinish, roomPaint);
        strokeChanged = true;
        return;
      }
      const c = cellAt(f, wx, wz);
      if (!c || !getCell(f, c.x, c.y)) return;
      const region = floodRegion(f, c.x, c.y);
      for (const rc of region) {
        const cell = f.cells[cellIdx(f, rc.x, rc.y)];
        cell.room = roomName || 'Room';
        cell.color = roomColor;
        // A grid room is a flood-fill label, not an object, so its finishes
        // are written across every cell in the region — the standing tax the
        // retrospective describes, paid once more.
        applyFinish(cell, roomFinish, roomPaint);
      }
      strokeChanged = true;
      onStatus && onStatus(`${roomName || 'Room'} — ${region.length * CELL * CELL} ft², ${region.length} cell${region.length === 1 ? '' : 's'}.`);
    } else if (tool === 'erase') {
      const e = nearestEdge(f, wx, wz);
      const seg = nearPolySeg(f, wx, wz, e.dist * CELL);
      if (seg) {
        // Erasing a polygon wall takes its doorways with it — they were
        // openings *in* that wall, and there's nothing left to be an opening in.
        if (setSegWall(seg.shape, seg.ring, seg.seg, SEG_NONE)) strokeChanged = true;
        return;
      }
      const ref = edgeRef(f, e);
      if (e.dist < 0.28 && ref.arr[ref.i] !== EDGE_NONE) {
        ref.arr[ref.i] = EDGE_NONE;
        strokeChanged = true;
      } else {
        // A whole room is a lot to lose to a stray drag, so a polygon room only
        // goes on a deliberate click.
        const shape = isClick ? shapeAt(f, wx, wz) : null;
        if (shape) {
          removeShape(f, shape.id);
          strokeChanged = true;
          return;
        }
        const c = cellAt(f, wx, wz);
        if (c && setTile(f, c.x, c.y, false)) strokeChanged = true;
      }
    }
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

    if (tool === 'wall' || tool === 'door' || (isErase && nearestEdge(f, p.x, p.z).dist < 0.28)) {
      const edge = nearestEdge(f, p.x, p.z);
      edgeCursor.visible = true;
      cellCursor.visible = false;
      edgeCursor.material.color.setHex(color);
      if (edge.kind === 'H') {
        edgeCursor.rotation.y = 0;
        edgeCursor.position.set((edge.x + 0.5) * CELL, baseY + WALL_H + 0.5, edge.y * CELL);
      } else {
        edgeCursor.rotation.y = Math.PI / 2;
        edgeCursor.position.set(edge.x * CELL, baseY + WALL_H + 0.5, (edge.y + 0.5) * CELL);
      }
    } else {
      const c = cellAt(f, p.x, p.z);
      edgeCursor.visible = false;
      cellCursor.visible = !!c;
      if (c) {
        cellCursor.material.color.setHex(color);
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
      onChange({ structural: true, commit: true });
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
      dropUndoTop();
      onStatus && onStatus(`Curve — that wall is only ${segLength(a, b).toFixed(1)}ft; there's no room to bend it.`);
      return true;
    }
    curveMemo = { shape: seg.shape, ring: seg.ring, seg: seg.seg, count, bulge: delta };
    onChange({ structural: true, commit: true });
    onStatus && onStatus(had
      ? `Curved wall — ${count} segments. The doorway in it was dropped: a 2ft chord has nowhere to put a 3ft door.`
      : `Curved wall — ${count} segments. , and . adjust, and they re-bend this same wall rather than stacking arcs.`);
    return true;
  }

  function dropUndoTop() { undoStack.pop(); }

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
    strokeWallFt = 0;
    overhangRefused = 0;
    strokeOverhang = 0;
    lastWorld = null;
    applyStroke(p.x, p.z, true);
    if (strokeChanged) onChange({ structural: true });
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
    if (strokeChanged && strokeChanged !== before) onChange({ structural: true });
    else if (strokeChanged) onChange({ structural: true, throttled: true });
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
    if (!strokeChanged) {
      undoStack.pop();
      // A stroke that built nothing because all of it was off the shadow is
      // the one case worth a word — otherwise the tool looks broken.
      if (overhangRefused) reportRefusal();
      return;
    }
    onChange({ structural: true, commit: true });
    // The grid-wall case in applyAt() only knows the length of the one edge
    // it just built; the running total for the whole drag is only known here,
    // once the stroke is done. A single polygon-wall click already reported
    // its own segment length in applyAt() and left strokeWallFt at 0.
    if (tool === 'wall' && strokeWallFt > 0) {
      onStatus && onStatus(`Wall — built ${strokeWallFt.toFixed(0)}ft.`);
    }
    if (overhangRefused) reportRefusal();
    else if (strokeOverhang) {
      const area = strokeOverhang * CELL * CELL;
      onStatus && onStatus(`Overhang — ${area.toLocaleString()} ft² of this storey now ` +
        'stands on nothing below.');
    }
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
    setPropType: (t) => propTool.setType(t),
    get propType() { return propTool.currentType; },
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
    undo, redo, pushUndo,
    // Discard the most recent pushUndo() when the edit it was staged for
    // turned out to be a no-op.
    dropUndo() { undoStack.pop(); },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    clearHistory() { undoStack.length = 0; redoStack.length = 0; },
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
