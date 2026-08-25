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
//           insert a vertex; Alt-click a corner removes it. Shift-click adds
//           more rooms to the selection (Phase 6) — a *set* of rooms rather
//           than one, which is what turns Delete/Ctrl+C/V/D/R/M below into
//           whole-section operations instead of single-room ones. Corner
//           handles only make sense for one room at a time, so they only show
//           when exactly one is selected; a wider selection shows outlines only.
//
// Snapping (shapes.js `snapPoint`) is what keeps polygon rooms compatible with
// grid-built ones: corners land on the 4ft lattice and on existing walls unless
// you hold Alt, so a polygon wing butts against the grid rather than nearly
// touching it.

import * as THREE from 'three';
import { CELL, inGrid, activeFloor, floorBaseY } from './grid.js';
import { pointSupported } from './shadow.js';
import { wrapAngle, addProp } from './props.js';
import {
  MIN_SEG,
  addShape, addHole, removeShape, enclosingShape, shapeAt, shapeById,
  segEnds, shapeArea, shapeBBox, cleanRing, convertRegion, cloneShape,
  pointInShape, rotateShape90, mirrorShapeX, rotatePoint90, mirrorPointX, addShapeCopy,
  snapPoint, constrainAngle, insertVertex, deleteVertex, moveVertex,
} from './shapes.js';

const DRAFT_COLOR = 0x4da3ff;
const SELECT_COLOR = 0xffcf5a;
const HANDLE_SEGMENTS = 14;
const SECTION_PASTE_OFFSET = 3; // ft, so a section paste doesn't land exactly on the original

// Handles and snap tolerances are in world feet, but they should feel the same
// size however far you've zoomed out — so they're derived from the view height.
const handleSize = (viewHeight) => Math.min(6, Math.max(0.6, viewHeight * 0.011));
const snapTol = (viewHeight) => Math.min(4, Math.max(0.5, viewHeight * 0.013));

export function initPolyEdit({ getState, renderApi, host }) {
  let tool = null;             // 'poly' | 'vertex' | null
  let holeMode = false;
  let draft = [];              // vertices placed so far, world feet
  let hover = null;            // { x, z, kind } — snapped cursor
  let selectedIds = new Set(); // room ids currently selected (vertex tool)
  let drag = null;             // { ring, idx } while a corner is being dragged
  let handles = [];            // { mesh, kind, ring, idx }
  let sectionClipboard = { shapes: [], props: [] };
  let sectionPasteCount = 0;

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
  for (const l of [draftLine, rubberLine]) {
    l.frustumCulled = false;
    l.renderOrder = 601;
    group.add(l);
  }

  // One outline per selected room — pooled the way propedit.js pools its
  // selection outlines, since the vertex tool can now hold more than one.
  const outlinePool = [];
  function takeOutline() {
    const l = outlinePool.find((x) => !x.visible) || (() => {
      const line = new THREE.Line(new THREE.BufferGeometry(), outlineMat);
      line.frustumCulled = false;
      line.renderOrder = 601;
      outlinePool.push(line);
      group.add(line);
      return line;
    })();
    l.visible = true;
    return l;
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

  // The rooms actually selected right now, re-resolved by id — a room can
  // vanish out from under the tool (undo, a floor switch, a loaded file), the
  // same way every other tool's selection re-resolves rather than holding a
  // stale object. Prunes `selectedIds` of anything that no longer exists.
  function selectedShapes() {
    const floor = activeFloor(getState());
    const list = [];
    for (const id of selectedIds) {
      const shape = shapeById(floor, id);
      if (shape) list.push(shape); else selectedIds.delete(id);
    }
    return list;
  }

  // The one room corner-handles apply to — only meaningful when exactly one
  // room is selected, since dragging a single corner of a five-room selection
  // has no sensible target.
  function primarySelected() {
    const list = selectedShapes();
    return list.length === 1 ? list[0] : null;
  }

  function refresh() {
    for (const h of handlePool) h.visible = false;
    for (const o of outlinePool) o.visible = false;
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

    const selShapes = tool === 'vertex' ? selectedShapes() : [];
    for (const shape of selShapes) {
      setLine(takeOutline(), shape.rings[0].pts, true);
    }
    // Corner and midpoint handles only make sense for one room at a time —
    // a wider selection shows outlines only, and moves/rotates/mirrors as a
    // section instead (see rotateSelection/mirrorSelection below).
    if (selShapes.length === 1) {
      const shape = selShapes[0];
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

  // How much of a ring stands on the storey below: its corners and its
  // midpoints, which is a coarse probe and exactly as coarse as shadow.js's
  // own 4ft rasterization. The ground floor stands on the ground, so this is
  // always "all of it" there.
  function supportOf(s, pts) {
    let inside = 0, total = 0;
    const probe = (x, z) => {
      total++;
      if (pointSupported(s, s.currentFloor, x, z)) inside++;
    };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      probe(a.x, a.z);
      probe((a.x + b.x) / 2, (a.z + b.z) / 2);
    }
    return { inside, outside: total - inside, total };
  }

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
      selectedIds = new Set([target.id]);
      host.status(`Cut an opening in ${target.name || 'the room'} — ${Math.round(shapeArea(target))} ft².`);
    } else {
      // Phase 8's structural shadow, the polygon half. The lattice can refuse
      // one cell at a time as you paint; a polygon arrives all at once, so the
      // rule is applied to the room rather than to a cell: a room drawn
      // entirely off the storey below is refused, and one that only overhangs
      // in part is placed and *reported*. Clipping a ring to a footprint mask
      // would be a different tool, and a room silently trimmed to a staircase
      // of 4ft steps is not what anybody drew.
      const support = supportOf(s, pts);
      if (!host.allowOverhang() && support.outside === support.total) {
        host.dropUndo();
        host.status('That room is entirely off the storey below — turn on ' +
          '“Allow overhangs” in the Floor panel to build there.');
        refresh();
        return;
      }
      const shape = addShape(s, s.currentFloor, pts, { name: host.roomName(), color: host.roomColor() });
      if (!shape) {
        host.dropUndo();
        host.status('Could not place that room — too small, or this floor is full.');
        refresh();
        return;
      }
      selectedIds = new Set([shape.id]);
      if (support.outside) {
        host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft², and it ` +
          'overhangs the storey below. Nothing carries the part that hangs over.');
      } else {
        host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft², ${shape.rings[0].pts.length} corners.`);
      }
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
      const hit = primarySelected() ? handleAt(p.x, p.z) : null;
      if (hit && hit.kind === 'vertex') {
        const shape = primarySelected();
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
        const shape = primarySelected();
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
        if (e.shiftKey) {
          const next = new Set(selectedIds);
          next.has(shape.id) ? next.delete(shape.id) : next.add(shape.id);
          selectedIds = next;
          host.status(`${selectedIds.size} room${selectedIds.size === 1 ? '' : 's'} selected.`);
          refresh();
          return true;
        }
        selectedIds = new Set([shape.id]);
        host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft², ${shape.rings[0].pts.length} corners. ` +
          'Drag a corner, Alt-click removes one, Delete removes the room. Shift-click adds more rooms to the selection.');
        refresh();
        return true;
      }
      // Nothing polygonal here, but clicking a *grid* room with the shape
      // editor means the same thing: let me edit this room's outline. So the
      // region is promoted to a polygon in place, keeping its name, colour,
      // walls and doors. This is the migration path — one room at a time, when
      // the grid stops being enough for it, rather than a flag day. A
      // shift-click on empty ground has nothing to add to the selection, so
      // it's left alone rather than tried against the grid.
      const gx = Math.floor(p.x / CELL), gy = Math.floor(p.z / CELL);
      if (!e.shiftKey && inGrid(floor, gx, gy)) {
        host.pushUndo();
        const made = convertRegion(getState(), getState().currentFloor, gx, gy);
        if (made) {
          selectedIds = new Set([made.id]);
          host.changed();
          host.status(`${made.name || 'Grid room'} is a polygon room now — ${made.rings[0].pts.length} corners, ${Math.round(shapeArea(made))} ft². Drag them.`);
          refresh();
          return true;
        }
        host.dropUndo();
      }
      if (!e.shiftKey) selectedIds = new Set();
      host.status('Edit — click a room to select it. A grid room becomes a polygon when you do. Shift-click to select several.');
      refresh();
      return true;
    }
    return false;
  }

  function pointerMove(p, e) {
    if (drag) {
      const shape = primarySelected();
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
      const hit = primarySelected() ? handleAt(p.x, p.z) : null;
      host.cursorStyle(hit ? 'pointer' : '');
      return true;
    }
    return false;
  }

  function pointerUp() {
    if (!drag) return false;
    const shape = primarySelected();
    const moved = drag.moved;
    drag = null;
    if (!moved) { host.dropUndo(); return true; }
    host.changed({ commit: true });
    if (shape) host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft².`);
    refresh();
    return true;
  }

  // --- whole-section operations: rotate/mirror/copy/paste/duplicate a
  // selection of one or more rooms together with whatever props sit inside
  // them (Phase 6). The pure transforms live in shapes.js; this is just
  // finding what's in the selection, pushing undo once for the whole group,
  // and reporting what happened.

  // Props on the current floor sitting inside any of `shapes` — deduplicated,
  // since two selected rooms overlapping is rare but not impossible.
  function propsInside(shapes) {
    const s = getState();
    const seen = new Set();
    const out = [];
    for (const p of s.props) {
      if (p.floor !== s.currentFloor || seen.has(p.id)) continue;
      if (shapes.some((sh) => pointInShape(sh, p.x, p.z))) { seen.add(p.id); out.push(p); }
    }
    return out;
  }

  // The pivot for a group rotate/mirror: the centre of the selection's
  // combined bounding box, so several rooms turn together around one point
  // rather than each spinning in place.
  function sectionCenter(shapes) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const sh of shapes) {
      const bb = shapeBBox(sh);
      x0 = Math.min(x0, bb.x0); z0 = Math.min(z0, bb.z0);
      x1 = Math.max(x1, bb.x1); z1 = Math.max(z1, bb.z1);
    }
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  }

  function sectionLabel(n, m) {
    return `${n} room${n === 1 ? '' : 's'}` + (m ? ` and ${m} prop${m === 1 ? '' : 's'}` : '');
  }

  // rotationY's own convention (propplace.js) rotates a prop the opposite way
  // a plain (x, z) point rotates under the same angle — see shapes.js's
  // rotateShape90 for the point half of this; `phi` is +90° for ccw, -90° else.
  function rotateSelection(ccw) {
    if (tool !== 'vertex' || !selectedIds.size) return false;
    const shapes = selectedShapes();
    if (!shapes.length) return false;
    const c = sectionCenter(shapes);
    const props = propsInside(shapes);
    const phi = ccw ? Math.PI / 2 : -Math.PI / 2;
    host.pushUndo();
    for (const sh of shapes) rotateShape90(sh, c.x, c.z, ccw);
    for (const p of props) {
      const r = rotatePoint90(p, c.x, c.z, ccw);
      p.x = r.x; p.z = r.z;
      p.rotationY = wrapAngle(p.rotationY - phi);
    }
    host.changed();
    host.status(`Rotated ${sectionLabel(shapes.length, props.length)}.`);
    refresh();
    return true;
  }

  function mirrorSelection() {
    if (tool !== 'vertex' || !selectedIds.size) return false;
    const shapes = selectedShapes();
    if (!shapes.length) return false;
    const c = sectionCenter(shapes);
    const props = propsInside(shapes);
    host.pushUndo();
    for (const sh of shapes) mirrorShapeX(sh, c.x);
    for (const p of props) {
      p.x = mirrorPointX(p, c.x).x;
      p.rotationY = wrapAngle(-p.rotationY);
    }
    host.changed();
    host.status(`Mirrored ${sectionLabel(shapes.length, props.length)}.`);
    refresh();
    return true;
  }

  function sectionCopy() {
    if (tool !== 'vertex' || !selectedIds.size) return false;
    const shapes = selectedShapes();
    if (!shapes.length) return false;
    const props = propsInside(shapes);
    sectionClipboard = {
      shapes: shapes.map(cloneShape),
      props: props.map((p) => ({
        type: p.type, x: p.x, z: p.z, y: p.y, rotationY: p.rotationY, scale: p.scale, mount: p.mount, data: { ...p.data },
      })),
    };
    sectionPasteCount = 0;
    host.status(`Copied ${sectionLabel(shapes.length, props.length)}.`);
    return true;
  }

  function sectionPaste() {
    if (tool !== 'vertex' || !sectionClipboard.shapes.length) return false;
    const s = getState();
    sectionPasteCount += 1;
    const off = SECTION_PASTE_OFFSET * sectionPasteCount;
    host.pushUndo();
    const newIds = new Set();
    for (const sh of sectionClipboard.shapes) {
      const added = addShapeCopy(s, s.currentFloor, sh, off, off);
      if (added) newIds.add(added.id);
    }
    let propCount = 0;
    for (const p of sectionClipboard.props) {
      const added = addProp(s, p.type, {
        x: p.x + off, z: p.z + off, y: p.y, rotationY: p.rotationY, scale: p.scale, mount: p.mount, data: p.data,
      });
      if (added) propCount += 1;
    }
    if (!newIds.size) { host.dropUndo(); host.status('Could not paste — this floor is full.'); return true; }
    selectedIds = newIds;
    host.changed();
    host.status(`Pasted ${sectionLabel(newIds.size, propCount)}.`);
    refresh();
    return true;
  }

  function sectionDuplicate() {
    if (tool !== 'vertex' || !selectedIds.size) return false;
    if (!sectionCopy()) return false;
    return sectionPaste();
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
      if (!selectedIds.size) return false;
      if (drag) return false; // a corner drag owns the keyboard until it lets go
      if (e.code === 'Delete' || e.code === 'Backspace') {
        const floor = activeFloor(getState());
        const ids = [...selectedIds];
        host.pushUndo();
        let n = 0;
        for (const id of ids) if (removeShape(floor, id)) n += 1;
        selectedIds = new Set();
        if (!n) { host.dropUndo(); return false; }
        host.changed();
        host.status(`Deleted ${n} room${n === 1 ? '' : 's'}.`);
        refresh();
        return true;
      }
      if (e.code === 'Escape') { selectedIds = new Set(); refresh(); return true; }
      if (e.code === 'KeyR') return rotateSelection(!e.shiftKey);
      if (e.code === 'KeyM') return mirrorSelection();
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
    if (tool !== 'vertex') selectedIds = new Set();
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
    selectedShape: primarySelected,
    get selectionCount() { return selectedIds.size; },
    // Ctrl combos never reach key() (see main.js/editor.js), so these are
    // called directly — the same split propedit.js uses for prop selections.
    sectionCopy, sectionPaste, sectionDuplicate,
  };
}
