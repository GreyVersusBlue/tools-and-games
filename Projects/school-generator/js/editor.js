// editor.js — grid editor: tools, pointer handling, pan/zoom, undo/redo.

import * as THREE from 'three';
import {
  CELL, WALL_H, WALL_T, ROOM_COLORS,
  cellIdx, edgeHIdx, edgeVIdx, inGrid, getCell, setFloor, floodRegion,
} from './grid.js';

const MAX_UNDO = 100;

export function initEditor({ canvas, renderApi, getState, onChange }) {
  let tool = 'floor'; // floor | wall | door | room | erase
  let roomName = 'Room 101';
  let roomColor = ROOM_COLORS[0];

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
  function nearestEdge(s, wx, wz) {
    const fx = wx / CELL, fz = wz / CELL;
    let cx = Math.floor(fx), cz = Math.floor(fz);
    cx = Math.min(Math.max(cx, 0), s.w - 1);
    cz = Math.min(Math.max(cz, 0), s.h - 1);
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

  function cellAt(s, wx, wz) {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    return inGrid(s, x, y) ? { x, y } : null;
  }

  function edgeRef(s, e) {
    return e.kind === 'H'
      ? { arr: s.edgesH, i: edgeHIdx(s, e.x, e.y) }
      : { arr: s.edgesV, i: edgeVIdx(s, e.x, e.y) };
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

  // --- tool application ---
  function applyAt(wx, wz, isClick) {
    const s = getState();
    if (tool === 'floor') {
      const c = cellAt(s, wx, wz);
      if (c && setFloor(s, c.x, c.y, true)) strokeChanged = true;
    } else if (tool === 'wall') {
      const e = nearestEdge(s, wx, wz);
      const ref = edgeRef(s, e);
      if (ref.arr[ref.i] !== 1) { ref.arr[ref.i] = 1; strokeChanged = true; }
    } else if (tool === 'door') {
      if (!isClick) return; // doors place on click, not drag
      const e = nearestEdge(s, wx, wz);
      const ref = edgeRef(s, e);
      ref.arr[ref.i] = ref.arr[ref.i] === 2 ? 1 : 2; // toggle door <-> wall
      strokeChanged = true;
    } else if (tool === 'room') {
      if (!isClick) return;
      const c = cellAt(s, wx, wz);
      if (!c || !getCell(s, c.x, c.y)) return;
      const region = floodRegion(s, c.x, c.y);
      for (const rc of region) {
        const cell = s.cells[cellIdx(s, rc.x, rc.y)];
        cell.room = roomName || 'Room';
        cell.color = roomColor;
      }
      strokeChanged = true;
    } else if (tool === 'erase') {
      const e = nearestEdge(s, wx, wz);
      const ref = edgeRef(s, e);
      if (e.dist < 0.28 && ref.arr[ref.i] !== 0) {
        ref.arr[ref.i] = 0;
        strokeChanged = true;
      } else {
        const c = cellAt(s, wx, wz);
        if (c && setFloor(s, c.x, c.y, false)) strokeChanged = true;
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
    const p = e && pointerToWorld(e);
    if (!enabled || !p) { cellCursor.visible = edgeCursor.visible = false; return; }
    const isErase = tool === 'erase';
    const color = isErase ? 0xff5f56 : tool === 'door' ? 0xd9a05b : 0x4da3ff;

    if (tool === 'wall' || tool === 'door' || (isErase && nearestEdge(s, p.x, p.z).dist < 0.28)) {
      const edge = nearestEdge(s, p.x, p.z);
      edgeCursor.visible = true;
      cellCursor.visible = false;
      edgeCursor.material.color.setHex(color);
      if (edge.kind === 'H') {
        edgeCursor.rotation.y = 0;
        edgeCursor.position.set((edge.x + 0.5) * CELL, WALL_H + 0.5, edge.y * CELL);
      } else {
        edgeCursor.rotation.y = Math.PI / 2;
        edgeCursor.position.set(edge.x * CELL, WALL_H + 0.5, (edge.y + 0.5) * CELL);
      }
    } else {
      const c = cellAt(s, p.x, p.z);
      edgeCursor.visible = false;
      cellCursor.visible = !!c;
      if (c) {
        cellCursor.material.color.setHex(color);
        cellCursor.position.set((c.x + 0.5) * CELL, 0.08, (c.y + 0.5) * CELL);
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
    if (!strokeActive) return;
    strokeActive = false;
    lastWorld = null;
    if (!strokeChanged) undoStack.pop(); // nothing happened; drop the snapshot
    else onChange({ structural: true, commit: true });
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => { cellCursor.visible = edgeCursor.visible = false; });

  canvas.addEventListener('wheel', (e) => {
    if (!enabled) return;
    e.preventDefault();
    const view = renderApi.editView;
    view.height = Math.min(1000, Math.max(30, view.height * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  return {
    get tool() { return tool; },
    setTool(t) { tool = t; updateCursor(null); },
    setRoom(name, color) { roomName = name; roomColor = color; },
    get roomName() { return roomName; },
    get roomColor() { return roomColor; },
    undo, redo, pushUndo,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    clearHistory() { undoStack.length = 0; redoStack.length = 0; },
    setEnabled(v) {
      enabled = v;
      if (!v) { cellCursor.visible = edgeCursor.visible = false; strokeActive = false; }
    },
  };
}
