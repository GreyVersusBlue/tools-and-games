// polyedit.js — the polygon tools: drawing an outline, and editing one after
// the fact. The model and all the geometry live in shapes.js; this file is the
// interaction and the on-canvas overlay that makes it visible.
//
// Two tools, sharing one overlay:
//
//   poly    click to drop vertices, close the loop to make a room. With
//           "cut hole" on, the loop is carved out of the room it lands in
//           instead — alcoves, courtyards, a room inside a room.
//   vertex  click a room to select it, then drag its corners. Midpoint handles
//           insert a vertex; Alt-click a corner removes it.
//
// Snapping (shapes.js `snapPoint`) is what keeps polygon rooms compatible with
// grid-built ones: corners land on the 4ft lattice and on existing walls unless
// you hold Alt, so a polygon wing butts against the grid rather than nearly
// touching it.

import * as THREE from 'three';
import { CELL, inGrid, activeFloor, floorBaseY } from './grid.js';
import {
  MIN_SEG,
  addShape, addHole, removeShape, enclosingShape, shapeAt, shapeById,
  segEnds, shapeArea, cleanRing, convertRegion,
  snapPoint, constrainAngle, insertVertex, deleteVertex, moveVertex,
} from './shapes.js';

const DRAFT_COLOR = 0x4da3ff;
const SELECT_COLOR = 0xffcf5a;
const HANDLE_SEGMENTS = 14;

// Handles and snap tolerances are in world feet, but they should feel the same
// size however far you've zoomed out — so they're derived from the view height.
const handleSize = (viewHeight) => Math.min(6, Math.max(0.6, viewHeight * 0.011));
const snapTol = (viewHeight) => Math.min(4, Math.max(0.5, viewHeight * 0.013));

export function initPolyEdit({ getState, renderApi, host }) {
  let tool = null;             // 'poly' | 'vertex' | null
  let holeMode = false;
  let draft = [];              // vertices placed so far, world feet
  let hover = null;            // { x, z, kind } — snapped cursor
  let selectedId = null;
  let drag = null;             // { ring, idx } while a corner is being dragged
  let handles = [];            // { mesh, kind, ring, idx }

  const group = new THREE.Group();
  group.renderOrder = 600;
  renderApi.scene.add(group);

  // --- overlay pieces ---
  const lineMat = new THREE.LineBasicMaterial({ color: DRAFT_COLOR, depthTest: false, transparent: true });
  const rubberMat = new THREE.LineBasicMaterial({
    color: DRAFT_COLOR, depthTest: false, transparent: true, opacity: 0.55,
  });
  const outlineMat = new THREE.LineBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true });
  const draftLine = new THREE.Line(new THREE.BufferGeometry(), lineMat);
  const rubberLine = new THREE.Line(new THREE.BufferGeometry(), rubberMat);
  const outline = new THREE.Line(new THREE.BufferGeometry(), outlineMat);
  for (const l of [draftLine, rubberLine, outline]) {
    l.frustumCulled = false;
    l.renderOrder = 601;
    group.add(l);
  }

  const handleGeo = new THREE.CircleGeometry(1, HANDLE_SEGMENTS);
  handleGeo.rotateX(-Math.PI / 2);
  const vertexMat = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true });
  const midMat = new THREE.MeshBasicMaterial({
    color: SELECT_COLOR, depthTest: false, transparent: true, opacity: 0.45,
  });
  const snapMat = new THREE.MeshBasicMaterial({ color: 0x7ce0a0, depthTest: false, transparent: true });
  const snapDot = new THREE.Mesh(handleGeo, snapMat);
  snapDot.renderOrder = 604;
  snapDot.visible = false;
  group.add(snapDot);

  const handlePool = [];
  function takeHandle(mat) {
    const mesh = handlePool.find((m) => !m.visible) ||
      (() => { const m = new THREE.Mesh(handleGeo, mat); m.renderOrder = 603; handlePool.push(m); group.add(m); return m; })();
    mesh.material = mat;
    mesh.visible = true;
    return mesh;
  }

  const baseY = () => {
    const s = getState();
    return floorBaseY(s, s.currentFloor) + 0.35;
  };

  function setLine(line, pts, closed) {
    if (!pts || pts.length < 2) { line.visible = false; return; }
    const y = baseY();
    const arr = [];
    for (const p of pts) arr.push(p.x, y, p.z);
    if (closed) arr.push(pts[0].x, y, pts[0].z);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    line.visible = true;
  }

  // --- overlay refresh ---

  function selected() {
    const shape = selectedId == null ? null : shapeById(activeFloor(getState()), selectedId);
    if (!shape) selectedId = null;
    return shape;
  }

  function refresh() {
    for (const h of handlePool) h.visible = false;
    handles = [];
    const size = handleSize(renderApi.editView.height);
    const y = baseY();

    if (tool === 'poly' && draft.length) {
      setLine(draftLine, draft, false);
      setLine(rubberLine, hover ? [draft[draft.length - 1], hover, ...(draft.length > 1 ? [draft[0]] : [])] : null, false);
      for (const p of draft) {
        const m = takeHandle(vertexMat);
        m.position.set(p.x, y, p.z);
        m.scale.setScalar(size * 0.5);
      }
    } else {
      draftLine.visible = false;
      rubberLine.visible = false;
    }

    const shape = tool === 'vertex' ? selected() : null;
    if (shape) {
      setLine(outline, shape.rings[0].pts, true);
      shape.rings.forEach((ring, ri) => {
        ring.pts.forEach((p, i) => {
          const m = takeHandle(vertexMat);
          m.position.set(p.x, y, p.z);
          m.scale.setScalar(size * 0.6);
          handles.push({ mesh: m, kind: 'vertex', ring: ri, idx: i, x: p.x, z: p.z, r: size * 0.6 });
        });
        // Midpoint handles: click one to add a corner there.
        ring.pts.forEach((p, i) => {
          const [a, b] = segEnds(ring, i);
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          const m = takeHandle(midMat);
          m.position.set(mx, y, mz);
          m.scale.setScalar(size * 0.38);
          handles.push({ mesh: m, kind: 'mid', ring: ri, idx: i, x: mx, z: mz, r: size * 0.45 });
        });
      });
    } else {
      outline.visible = false;
    }

    if (hover && hover.kind !== 'free' && (tool === 'poly' || drag)) {
      snapDot.visible = true;
      snapDot.position.set(hover.x, y, hover.z);
      snapDot.scale.setScalar(size * 0.32);
    } else {
      snapDot.visible = false;
    }
  }

  // --- snapping ---

  function snap(p, e, skip) {
    const floor = activeFloor(getState());
    if (e && e.altKey) return { x: p.x, z: p.z, kind: 'free' };
    let pt = p;
    // While drawing, Shift locks the new run to 15° steps off the last corner.
    if (e && e.shiftKey && tool === 'poly' && draft.length) {
      pt = constrainAngle(draft[draft.length - 1], p, 15);
    }
    return snapPoint(floor, pt.x, pt.z, snapTol(renderApi.editView.height), { skip });
  }

  function handleAt(x, z) {
    let best = null;
    for (const h of handles) {
      const d = Math.hypot(h.x - x, h.z - z);
      // Vertices win ties with the midpoint handles that flank them.
      if (d <= h.r && (!best || d - (h.kind === 'vertex' ? 0.001 : 0) < best.d)) best = { ...h, d };
    }
    return best;
  }

  // --- drawing ---

  function commitDraft() {
    const pts = cleanRing(draft);
    draft = [];
    if (!pts) { host.status('Need at least three corners — nothing placed.'); refresh(); return; }
    const s = getState();
    const floor = activeFloor(s);

    host.pushUndo();
    if (holeMode) {
      const target = enclosingShape(floor, pts);
      if (!target) {
        host.dropUndo();
        host.status('Cut hole — draw the opening inside an existing polygon room.');
        refresh();
        return;
      }
      if (!addHole(target, pts)) {
        host.dropUndo();
        host.status('That opening is too small, or the room already has too many.');
        refresh();
        return;
      }
      selectedId = target.id;
      host.status(`Cut an opening in ${target.name || 'the room'} — ${Math.round(shapeArea(target))} ft².`);
    } else {
      const shape = addShape(s, s.currentFloor, pts, { name: host.roomName(), color: host.roomColor() });
      if (!shape) {
        host.dropUndo();
        host.status('Could not place that room — too small, or this floor is full.');
        refresh();
        return;
      }
      selectedId = shape.id;
      host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft², ${shape.rings[0].pts.length} corners.`);
    }
    host.changed();
    refresh();
  }

  function cancelDraft() {
    if (!draft.length) return false;
    draft = [];
    refresh();
    host.status('Polygon — cancelled.');
    return true;
  }

  // --- public interaction ---

  function pointerDown(p, e) {
    if (tool === 'poly') {
      const sp = snap(p, e);
      // Clicking the first corner again closes the loop.
      if (draft.length >= 3 && Math.hypot(sp.x - draft[0].x, sp.z - draft[0].z) <= snapTol(renderApi.editView.height)) {
        commitDraft();
        return true;
      }
      const last = draft[draft.length - 1];
      if (last && Math.hypot(sp.x - last.x, sp.z - last.z) < MIN_SEG) return true;
      draft.push({ x: sp.x, z: sp.z });
      hover = sp;
      host.status(draft.length < 3
        ? `Polygon — ${draft.length} corner${draft.length === 1 ? '' : 's'}; click to keep going.`
        : `Polygon — ${draft.length} corners; click the first corner or press Enter to close.`);
      refresh();
      return true;
    }

    if (tool === 'vertex') {
      const floor = activeFloor(getState());
      const hit = selected() ? handleAt(p.x, p.z) : null;
      if (hit && hit.kind === 'vertex') {
        const shape = selected();
        if (e.altKey) {
          host.pushUndo();
          if (deleteVertex(shape, hit.ring, hit.idx)) {
            host.changed();
            host.status(`Removed a corner — ${Math.round(shapeArea(shape))} ft².`);
          } else {
            host.dropUndo();
            host.status('A ring needs at least three corners.');
          }
          refresh();
          return true;
        }
        host.pushUndo();
        drag = { ring: hit.ring, idx: hit.idx, moved: false };
        return true;
      }
      if (hit && hit.kind === 'mid') {
        const shape = selected();
        host.pushUndo();
        const at = insertVertex(shape, hit.ring, hit.idx, hit.x, hit.z);
        if (at < 0) { host.dropUndo(); refresh(); return true; }
        drag = { ring: hit.ring, idx: at, moved: false };
        host.changed();
        refresh();
        return true;
      }

      const shape = shapeAt(floor, p.x, p.z);
      if (shape) {
        selectedId = shape.id;
        host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft², ${shape.rings[0].pts.length} corners. Drag a corner, Alt-click removes one, Delete removes the room.`);
        refresh();
        return true;
      }
      // Nothing polygonal here, but clicking a *grid* room with the shape
      // editor means the same thing: let me edit this room's outline. So the
      // region is promoted to a polygon in place, keeping its name, colour,
      // walls and doors. This is the migration path — one room at a time, when
      // the grid stops being enough for it, rather than a flag day.
      const gx = Math.floor(p.x / CELL), gy = Math.floor(p.z / CELL);
      if (inGrid(floor, gx, gy)) {
        host.pushUndo();
        const made = convertRegion(getState(), getState().currentFloor, gx, gy);
        if (made) {
          selectedId = made.id;
          host.changed();
          host.status(`${made.name || 'Grid room'} is a polygon room now — ${made.rings[0].pts.length} corners, ${Math.round(shapeArea(made))} ft². Drag them.`);
          refresh();
          return true;
        }
        host.dropUndo();
      }
      selectedId = null;
      host.status('Edit — click a room to select it. A grid room becomes a polygon when you do.');
      refresh();
      return true;
    }
    return false;
  }

  function pointerMove(p, e) {
    if (drag) {
      const shape = selected();
      if (!shape) { drag = null; return false; }
      const sp = snap(p, e, { shape: shape.id, ring: drag.ring, idx: drag.idx });
      hover = sp;
      moveVertex(shape, drag.ring, drag.idx, sp.x, sp.z);
      drag.moved = true;
      host.changed({ throttled: true });
      refresh();
      return true;
    }
    if (tool === 'poly') {
      hover = snap(p, e);
      refresh();
      return true;
    }
    if (tool === 'vertex') {
      hover = null;
      const hit = selected() ? handleAt(p.x, p.z) : null;
      host.cursorStyle(hit ? 'pointer' : '');
      return true;
    }
    return false;
  }

  function pointerUp() {
    if (!drag) return false;
    const shape = selected();
    const moved = drag.moved;
    drag = null;
    if (!moved) { host.dropUndo(); return true; }
    host.changed({ commit: true });
    if (shape) host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft².`);
    refresh();
    return true;
  }

  // Keys the polygon tools own. Everything else falls through to the editor.
  function key(e) {
    if (tool === 'poly') {
      if (e.code === 'Escape') return cancelDraft();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (draft.length < 3) return false;
        commitDraft();
        return true;
      }
      if (e.code === 'Backspace' && draft.length) {
        draft.pop();
        refresh();
        return true;
      }
      if (e.code === 'KeyH') { setHoleMode(!holeMode); return true; }
      return false;
    }
    if (tool === 'vertex') {
      const shape = selected();
      if (!shape) return false;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        host.pushUndo();
        removeShape(activeFloor(getState()), shape.id);
        selectedId = null;
        host.changed();
        host.status('Room deleted.');
        refresh();
        return true;
      }
      if (e.code === 'Escape') { selectedId = null; refresh(); return true; }
    }
    return false;
  }

  function setHoleMode(v) {
    holeMode = !!v;
    host.holeModeChanged(holeMode);
    host.status(holeMode
      ? 'Cut hole — draw a loop inside a polygon room to carve an opening out of it.'
      : 'Polygon — click to place corners, click the first one (or Enter) to close.');
  }

  function setTool(t) {
    if (t !== tool) { draft = []; drag = null; hover = null; }
    tool = t === 'poly' || t === 'vertex' ? t : null;
    if (tool !== 'vertex') selectedId = null;
    refresh();
  }

  return {
    setTool,
    get tool() { return tool; },
    get holeMode() { return holeMode; },
    setHoleMode,
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    clearHover() { hover = null; refresh(); },
    // A shape can vanish under the tool (undo, floor switch, a loaded file), so
    // the selection is re-resolved by id rather than held as an object.
    selectedShape: selected,
  };
}
