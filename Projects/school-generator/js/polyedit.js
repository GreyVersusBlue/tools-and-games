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
//           more rooms to the selection (Phase 6), and dragging a box catches
//           every room it touches (Phase 32's marquee) — a *set* of rooms
//           rather than one, which is what turns Delete/Ctrl+C/V/D/R/M below
//           into whole-section operations instead of single-room ones. Corner
//           handles only make sense for one room at a time, so they only show
//           when exactly one is selected; a wider selection shows outlines only.
//           Ctrl+V opens a *paste ghost* — the clipboard under the pointer,
//           snapped to the lattice; click places it, press-and-drag stamps a
//           row of copies at the clipboard's own pitch, R turns it a quarter
//           at a time, Escape puts it away. The set logic itself (clipboard,
//           stamp, marquee hit test) is section.js; this file is the gesture.
//
// Snapping (shapes.js `snapPoint`) is what keeps polygon rooms compatible with
// grid-built ones: corners land on the 4ft lattice and on existing walls unless
// you hold Alt, so a polygon wing butts against the grid rather than nearly
// touching it.

import * as THREE from 'three';
import { CELL, activeFloor, floorBaseY } from './grid.js';
import { pointSupported } from './shadow.js';
import { gridOrigin } from './gridref.js';
import { wrapAngle } from './props.js';
import {
  MIN_SEG,
  addShape, addHole, removeShape, enclosingShape, shapeAt, shapeById,
  segEnds, shapeArea, cleanRing,
  rotateShape90, mirrorShapeX, rotatePoint90, mirrorPointX,
  snapPoint, constrainAngle, insertVertex, deleteVertex, moveVertex,
} from './shapes.js';
import {
  sectionBounds, shapesInRect, propsInSection, copySection,
  sectionEmpty, cloneSection, rotateSection, pasteSection, stampRow,
} from './section.js';

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
  let lastP = null;            // last raw pointer position, world feet
  let selectedIds = new Set(); // room ids currently selected (vertex tool)
  let drag = null;             // { ring, idx } while a corner is being dragged
  let handles = [];            // { mesh, kind, ring, idx }
  let sectionClipboard = { shapes: [], props: [] };
  // Phase 32: a paste is no longer an instant drop at a fixed offset — it is
  // a mode. `pasting` holds a private copy of the clipboard (R can rotate it
  // without disturbing what Ctrl+C took), the offset the ghost currently
  // stands at, and — once the pointer goes down — the stamped row being
  // dragged out. `marquee` is the drag-a-box selection the vertex tool never
  // had. Both are tool state, never file state, per the convention.
  let pasting = null;          // { clip, dx, dz, stamp: null | { row } }
  let marquee = null;          // { ax, az, bx, bz, add, active }

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

  // Ghost outlines for the pending paste — one per room per stamped copy,
  // pooled like the selection outlines. Drawn with the rubber material so a
  // ghost reads as "not yet placed" the way the poly tool's rubber edge does.
  const ghostPool = [];
  function takeGhost() {
    const l = ghostPool.find((x) => !x.visible) || (() => {
      const line = new THREE.Line(new THREE.BufferGeometry(), rubberMat);
      line.frustumCulled = false;
      line.renderOrder = 601;
      ghostPool.push(line);
      group.add(line);
      return line;
    })();
    l.visible = true;
    return l;
  }
  // The most ghost outlines one refresh will draw. A stamp is capped at
  // MAX_STAMP copies, but a copy can hold many rooms, and a preview that
  // rebuilds a thousand line geometries per mousemove is a preview that
  // stutters — past this the row's tail goes undrawn, not unplaced.
  const MAX_GHOSTS = 128;

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
    for (const g of ghostPool) g.visible = false;
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

    // The paste ghost: every room on the clipboard, outlined at the offset the
    // pointer implies — and while a stamp is being dragged out, at every
    // offset in the row.
    if (tool === 'vertex' && pasting) {
      const offsets = pasting.stamp
        ? pasting.stamp.row.offsets
        : [{ dx: pasting.dx, dz: pasting.dz }];
      let drawn = 0;
      for (const off of offsets) {
        for (const sh of pasting.clip.shapes) {
          if (drawn >= MAX_GHOSTS) break;
          setLine(takeGhost(),
            sh.rings[0].pts.map((p) => ({ x: p.x + off.dx, z: p.z + off.dz })), true);
          drawn += 1;
        }
      }
    }

    // The marquee, once the press has moved far enough to be a drag rather
    // than a click. The rubber line is free here — only the poly tool's own
    // branch above uses it.
    if (tool === 'vertex' && marquee && marquee.active) {
      setLine(rubberLine, [
        { x: marquee.ax, z: marquee.az }, { x: marquee.bx, z: marquee.az },
        { x: marquee.bx, z: marquee.bz }, { x: marquee.ax, z: marquee.bz },
      ], true);
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
    return snapPoint(floor, pt.x, pt.z, snapTol(renderApi.editView.height),
      { skip, origin: gridOrigin(getState()) });
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
          '“Allow overhangs” in the Layers panel to build there.');
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
      // A pending paste owns the pointer: the press anchors the first copy,
      // and dragging from there stamps a row (see pointerMove/pointerUp).
      if (pasting) {
        const at = { dx: pasting.dx, dz: pasting.dz };
        pasting.stamp = { row: stampRow(pasting.clip, at, at) };
        return true;
      }
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

      // Anywhere else — on a room or off one — starts a *potential* marquee.
      // Whether it was a drag-a-box or a plain click is decided on the way
      // back up (see pointerUp), the same way the rectangle eraser decides:
      // a press that selected immediately would make a marquee that starts
      // on a room impossible, and most marquees do.
      marquee = { ax: p.x, az: p.z, bx: p.x, bz: p.z, add: e.shiftKey, active: false };
      return true;
    }
    return false;
  }

  // Where the ghost stands for a pointer at `p`: the clipboard's own centre
  // under the cursor, with the *offset* snapped to whole cells (Alt for free
  // placement, the same escape every snap in this file has). Snapping the
  // offset rather than the landing point is what keeps a lattice-aligned
  // clipboard lattice-aligned wherever it lands.
  function pasteOffsetAt(p, e) {
    const b = sectionBounds(pasting.clip.shapes);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    let dx = p.x - cx, dz = p.z - cz;
    if (!(e && e.altKey)) {
      dx = Math.round(dx / CELL) * CELL;
      dz = Math.round(dz / CELL) * CELL;
    }
    return { dx, dz };
  }

  function pointerMove(p, e) {
    lastP = { x: p.x, z: p.z };
    if (tool === 'vertex' && pasting) {
      const at = pasteOffsetAt(p, e);
      if (pasting.stamp) {
        // The drag is the row: anchor stays where the press put it, and the
        // pointer says how far the copies run.
        const anchor = pasting.stamp.row.offsets[0];
        pasting.stamp.row = stampRow(pasting.clip, anchor, at);
        const n = pasting.stamp.row.offsets.length;
        host.status(n > 1
          ? `Stamp — ${n} copies, ${pasting.stamp.row.pitch}ft apart. Release to place them.`
          : 'Stamp — drag further to repeat the rooms along the row.');
      } else {
        pasting.dx = at.dx;
        pasting.dz = at.dz;
      }
      refresh();
      return true;
    }
    if (tool === 'vertex' && marquee) {
      marquee.bx = p.x;
      marquee.bz = p.z;
      if (!marquee.active &&
          Math.hypot(marquee.bx - marquee.ax, marquee.bz - marquee.az) >
            snapTol(renderApi.editView.height) * 0.5) {
        marquee.active = true;
      }
      if (marquee.active) {
        const w = Math.abs(marquee.bx - marquee.ax), d = Math.abs(marquee.bz - marquee.az);
        host.status(`Select — ${Math.round(w)} × ${Math.round(d)} ft.`);
        refresh();
      }
      return true;
    }
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
    if (tool === 'vertex' && pasting && pasting.stamp) {
      const offsets = pasting.stamp.row.offsets;
      return commitGhost(offsets);
    }
    if (tool === 'vertex' && marquee) {
      const m = marquee;
      marquee = null;
      const floor = activeFloor(getState());
      if (m.active) {
        // A drag: everything the box touched joins the selection (Shift held
        // at the press adds to what was already selected).
        const caught = shapesInRect(floor, { x: m.ax, z: m.az }, { x: m.bx, z: m.bz });
        const next = m.add ? new Set(selectedIds) : new Set();
        for (const sh of caught) next.add(sh.id);
        selectedIds = next;
        host.status(selectedIds.size
          ? `${selectedIds.size} room${selectedIds.size === 1 ? '' : 's'} selected.`
          : 'Select — the box caught nothing.');
        refresh();
        return true;
      }
      // A click: the old single-room selection, decided here rather than at
      // the press so the marquee could still have happened.
      const shape = shapeAt(floor, m.ax, m.az);
      if (shape) {
        if (m.add) {
          const next = new Set(selectedIds);
          next.has(shape.id) ? next.delete(shape.id) : next.add(shape.id);
          selectedIds = next;
          host.status(`${selectedIds.size} room${selectedIds.size === 1 ? '' : 's'} selected.`);
        } else {
          selectedIds = new Set([shape.id]);
          host.status(`${shape.name || 'Room'} — ${Math.round(shapeArea(shape))} ft², ` +
            `${shape.rings[0].pts.length} corners. Drag a corner, Alt-click removes one, ` +
            'Delete removes the room. Shift-click or drag a box to select several.');
        }
        refresh();
        return true;
      }
      // No room here. Until Phase 12 this was where a *grid* room got promoted
      // to a polygon so its outline could be dragged — the migration path, one
      // room at a time. Every room is a polygon on load now, so there is
      // nothing left to promote and clicking empty ground simply clears the
      // selection.
      if (!m.add) selectedIds = new Set();
      host.status('Edit — click a room to select it and drag its corners. ' +
        'Drag a box to select several.');
      refresh();
      return true;
    }
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

  // Props on the current floor sitting inside any of `shapes`, and the pivot
  // a group turns around — both from section.js since Phase 32, which is
  // where the whole of "a set of records, transformed" now lives.
  function propsInside(shapes) {
    const s = getState();
    return propsInSection(s, s.currentFloor, shapes);
  }

  function sectionCenter(shapes) {
    const b = sectionBounds(shapes);
    return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
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
    const s = getState();
    sectionClipboard = copySection(s, s.currentFloor, shapes);
    host.status(`Copied ${sectionLabel(sectionClipboard.shapes.length, sectionClipboard.props.length)}` +
      ' — Ctrl+V pastes under a ghost.');
    return true;
  }

  // Lay `clip` down once per offset, select what landed, and say what
  // happened. Shared by the ghost's commit, Enter, and Ctrl+D.
  function commitPaste(clip, offsets) {
    const s = getState();
    host.pushUndo();
    const out = pasteSection(s, s.currentFloor, clip, offsets);
    if (!out.shapes) {
      host.dropUndo();
      host.status('Could not paste — this floor is full.');
      refresh();
      return true;
    }
    selectedIds = new Set(out.ids);
    host.changed();
    const stamped = offsets.length > 1 ? `Stamped ${offsets.length} copies — ` : 'Pasted ';
    host.status(`${stamped}${sectionLabel(out.shapes, out.props)}` +
      `${out.refused ? `; ${out.refused} more did not fit` : ''}.`);
    refresh();
    return true;
  }

  function commitGhost(offsets) {
    const clip = pasting.clip;
    pasting = null;
    return commitPaste(clip, offsets);
  }

  // Ctrl+V. Phase 32: enters paste mode — a live ghost of the clipboard under
  // the pointer, snapped to the lattice — rather than dropping copies at a
  // fixed offset. Click places; press-and-drag stamps a row; R rotates the
  // pending copy a quarter turn; Escape cancels.
  function sectionPaste() {
    if (tool !== 'vertex' || sectionEmpty(sectionClipboard)) return false;
    pasting = { clip: cloneSection(sectionClipboard), dx: CELL, dz: CELL, stamp: null };
    drag = null;
    marquee = null;
    if (lastP) {
      const at = pasteOffsetAt(lastP, null);
      pasting.dx = at.dx;
      pasting.dz = at.dz;
    }
    host.status('Paste — click places the rooms under the ghost; drag stamps a row of them. ' +
      'R rotates, Esc cancels.');
    refresh();
    return true;
  }

  // Ctrl+D keeps its old manner: an instant copy beside the original, no
  // mode — the gesture for "another one of these, here".
  function sectionDuplicate() {
    if (tool !== 'vertex' || !selectedIds.size) return false;
    const shapes = selectedShapes();
    if (!shapes.length) return false;
    const s = getState();
    const clip = copySection(s, s.currentFloor, shapes);
    return commitPaste(clip, [{ dx: SECTION_PASTE_OFFSET, dz: SECTION_PASTE_OFFSET }]);
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
      // A pending paste hears the keyboard first: it can be live with nothing
      // selected, and R has to reach the ghost rather than the selection.
      if (pasting) {
        if (e.code === 'Escape') {
          pasting = null;
          host.status('Paste — cancelled.');
          refresh();
          return true;
        }
        if (e.code === 'KeyR' && !pasting.stamp) {
          // The clipboard's own copy turns; the pivot is its centre, so the
          // ghost stays put under the pointer. Props inside counter-rotate by
          // the convention (see rotateSection).
          rotateSection(pasting.clip, !e.shiftKey);
          host.status('Paste — rotated a quarter turn. Click places it; drag stamps a row.');
          refresh();
          return true;
        }
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          return commitGhost([{ dx: pasting.dx, dz: pasting.dz }]);
        }
        return false;
      }
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
    if (t !== tool) { draft = []; drag = null; hover = null; pasting = null; marquee = null; }
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
