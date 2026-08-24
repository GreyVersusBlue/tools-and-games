// editor.js — editor shell: tools, pointer handling, pan/zoom, undo/redo.
//
// The grid tools live here. The polygon tools live in polyedit.js and are
// driven through the same pointer stream — this file decides which of the two
// room representations a click is aimed at, which for the shared tools (wall,
// door, room, erase) means "whichever is nearer the cursor".

import * as THREE from 'three';
import {
  CELL, WALL_H, WALL_T, ROOM_COLORS,
  EDGE_NONE, EDGE_WALL, EDGE_DOOR, EDGE_GLASS, EDGE_RAIL,
  cellIdx, edgeHIdx, edgeVIdx, inGrid, getCell, setTile, floodRegion,
  activeFloor, floorBaseY,
} from './grid.js';
import {
  SEG_NONE, SEG_WALL, SEG_GLASS, SEG_RAIL,
  nearestSegment, shapeAt, setSegWall, toggleOpening, removeShape,
} from './shapes.js';
import { initPolyEdit } from './polyedit.js';
import { initPropEdit } from './propedit.js';
import { initStairEdit } from './stairedit.js';

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

export function initEditor({ canvas, renderApi, getState, onChange, onStatus, onHoleMode }) {
  let tool = 'floor'; // floor | wall | door | room | erase | poly | vertex | prop | stair
  let roomName = 'Room 101';
  let roomColor = ROOM_COLORS[0];
  let wallKind = 'wall';

  const undoStack = [];
  const redoStack = [];
  let strokeActive = false;
  let strokeChanged = false;
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

  function pointerToWorld(e) {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, renderApi.editCamera);
    return raycaster.ray.intersectPlane(groundPlane, _v3) ? { x: _v3.x, z: _v3.z } : null;
  }

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
  function snapshot() { return JSON.stringify(getState()); }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  function restore(json) {
    const s = getState();
    const data = JSON.parse(json);
    Object.assign(s, data);
    onChange({ structural: true });
    poly.refresh();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
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

  // --- tool application ---

  // Nearest polygon wall to the cursor, if one is within grabbing distance and
  // closer than the grid edge the cursor is over.
  function nearPolySeg(f, wx, wz, gridDistFt) {
    const seg = nearestSegment(f, wx, wz, SEG_GRAB);
    if (!seg) return null;
    return gridDistFt === undefined || seg.dist < gridDistFt ? seg : null;
  }

  function applyAt(wx, wz, isClick) {
    const f = activeFloor(getState());
    if (tool === 'floor') {
      const c = cellAt(f, wx, wz);
      if (c && setTile(f, c.x, c.y, true)) strokeChanged = true;
    } else if (tool === 'wall') {
      const kind = wallKindOf(wallKind);
      const e = nearestEdge(f, wx, wz);
      const seg = nearPolySeg(f, wx, wz, e.dist * CELL);
      if (seg) {
        if (setSegWall(seg.shape, seg.ring, seg.seg, kind.seg)) strokeChanged = true;
        return;
      }
      const ref = edgeRef(f, e);
      if (ref.arr[ref.i] !== kind.edge) { ref.arr[ref.i] = kind.edge; strokeChanged = true; }
    } else if (tool === 'door') {
      if (!isClick) return; // doors place on click, not drag
      const e = nearestEdge(f, wx, wz);
      // On a polygon wall a doorway is cut where you clicked along the run,
      // not at the middle of a lattice edge — a 30ft wall can hold several.
      const seg = nearPolySeg(f, wx, wz, e.dist * CELL);
      if (seg) {
        toggleOpening(seg.shape, seg.ring, seg.seg, seg.t);
        strokeChanged = true;
        return;
      }
      const ref = edgeRef(f, e);
      // Toggling a door off leaves the kind of wall the tool would build now —
      // a glazed partition with a door in it is a door tool click away, and one
      // more puts the glass back rather than a stretch of drywall.
      ref.arr[ref.i] = ref.arr[ref.i] === EDGE_DOOR ? wallKindOf(wallKind).edge : EDGE_DOOR;
      strokeChanged = true;
    } else if (tool === 'room') {
      if (!isClick) return;
      // Polygon rooms sit on top of the grid, so they answer the click first.
      const shape = shapeAt(f, wx, wz);
      if (shape) {
        shape.name = roomName || 'Room';
        shape.color = roomColor;
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
      }
      strokeChanged = true;
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
  function updateCursor(e) {
    const s = getState();
    const f = activeFloor(s);
    const baseY = floorBaseY(s, s.currentFloor);
    const p = e && pointerToWorld(e);
    if (!enabled || !p || tool === 'poly' || tool === 'vertex' || tool === 'prop' || tool === 'stair') {
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

  // --- pointer events ---
  let panning = false;
  let panLast = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    if (e.button === 1 || e.button === 2) {
      panning = true;
      panLast = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = pointerToWorld(e);
    if (!p) return;
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
    pushUndo();
    strokeActive = true;
    strokeChanged = false;
    lastWorld = null;
    applyStroke(p.x, p.z, true);
    if (strokeChanged) onChange({ structural: true });
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!enabled) return;
    if (panning && panLast) {
      const view = renderApi.editView;
      const ftPerPx = view.height / canvas.clientHeight;
      view.x -= (e.clientX - panLast.x) * ftPerPx;
      view.z -= (e.clientY - panLast.y) * ftPerPx;
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    updateCursor(e);
    if (tool === 'poly' || tool === 'vertex') {
      const pp = pointerToWorld(e);
      if (pp) poly.pointerMove(pp, e);
      return;
    }
    if (tool === 'prop') {
      const pp = pointerToWorld(e);
      if (pp) propTool.pointerMove(pp, e);
      return;
    }
    if (tool === 'stair') {
      const pp = pointerToWorld(e);
      if (pp) stairTool.pointerMove(pp, e);
      return;
    }
    if (!strokeActive) return;
    const p = pointerToWorld(e);
    if (!p) return;
    const before = strokeChanged;
    applyStroke(p.x, p.z, false);
    if (strokeChanged && strokeChanged !== before) onChange({ structural: true });
    else if (strokeChanged) onChange({ structural: true, throttled: true });
  });

  function endStroke(e) {
    if (panning) { panning = false; panLast = null; }
    if (poly.pointerUp()) return;
    if (propTool.pointerUp()) return;
    if (stairTool.pointerUp()) return;
    if (!strokeActive) return;
    strokeActive = false;
    lastWorld = null;
    if (!strokeChanged) undoStack.pop(); // nothing happened; drop the snapshot
    else onChange({ structural: true, commit: true });
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => {
    cellCursor.visible = edgeCursor.visible = false;
    poly.clearHover();
    propTool.clearHover();
    stairTool.clearHover();
  });

  canvas.addEventListener('wheel', (e) => {
    if (!enabled) return;
    e.preventDefault();
    const view = renderApi.editView;
    view.height = Math.min(1000, Math.max(30, view.height * Math.exp(e.deltaY * 0.001)));
    poly.refresh(); // handles and snap radius are sized off the zoom level
    propTool.refresh();
    stairTool.refresh();
  }, { passive: false });

  return {
    get tool() { return tool; },
    setTool(t) {
      tool = t;
      poly.setTool(t);
      propTool.setTool(t);
      stairTool.setTool(t);
      updateCursor(null);
      if (t !== 'vertex') canvas.style.cursor = '';
    },
    // Keys the polygon and prop tools claim (close/cancel/backtrack/delete,
    // rotate/delete/escape). Returns true when one was used, so the caller
    // knows to stop handling it.
    handleKey: (e) => poly.key(e) || propTool.key(e) || stairTool.key(e),
    get holeMode() { return poly.holeMode; },
    setHoleMode: (v) => poly.setHoleMode(v),
    refreshOverlay: () => { poly.refresh(); propTool.refresh(); stairTool.refresh(); },
    setRoom(name, color) { roomName = name; roomColor = color; },
    get roomName() { return roomName; },
    get roomColor() { return roomColor; },
    setPropType: (t) => propTool.setType(t),
    get propType() { return propTool.currentType; },
    // What the wall tool builds — shared by the grid and the polygon rooms, so
    // it lives on the editor rather than inside either half.
    setWallKind(k) { wallKind = wallKindOf(k).kind; updateCursor(null); },
    get wallKind() { return wallKind; },
    setStairType: (t) => stairTool.setType(t),
    get stairType() { return stairTool.currentType; },
    get stairCount() { return stairTool.countHere(); },
    // Ctrl combos never reach handleKey (see main.js), so copy/paste/duplicate
    // are called directly.
    propCopy: () => propTool.copySelection(),
    propPaste: () => propTool.pasteClipboard(),
    propDuplicate: () => propTool.duplicateSelection(),
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
      if (!v) { cellCursor.visible = edgeCursor.visible = false; strokeActive = false; }
    },
  };
}
