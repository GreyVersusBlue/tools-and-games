// propedit.js — the prop tool: pick a type from the palette, click to place,
// drag to reposition, keyboard to rotate/delete/copy/paste. Same split as
// polyedit.js: the picking and snapping math lives in propplace.js (pure, no
// three.js), this file is the pointer stream and the on-canvas overlay that
// makes it visible.
//
// One tool, two things it does depending on what's under the cursor:
//
//   click empty ground        place a prop of the palette's current type
//   drag empty ground         marquee-select whatever props the box covers
//   click an existing prop    select it (replacing the selection, unless
//                              Shift is held) and start dragging it
//
// A prop is "the current type" from the palette panel (parallel to the
// room-color swatches), not a placed thing, until it's actually clicked down —
// so a drag that turns out to be a marquee never places anything.

import * as THREE from 'three';
import { activeFloor, floorBaseY } from './grid.js';
import { PROP_CATALOG, catalogEntry } from './catalog.js';
import { addProp, removeProp, getProp, wrapAngle, MAX_PROPS } from './props.js';
import { footprintOf, pickPropAt, propsInBox, snapProp } from './propplace.js';

const SELECT_COLOR = 0xffcf5a;
const GHOST_OK = 0x7ce0a0;
const GHOST_BAD = 0xff5f56;
const MARQUEE_COLOR = 0x4da3ff;
const ROTATE_STEP = Math.PI / 12; // 15°
const PASTE_OFFSET = 2; // ft, so a paste doesn't land exactly on the original

// Snap tolerance and the click/marquee threshold both feel the same size
// however far you've zoomed out — same trick polyedit.js uses for handles.
const snapTol = (viewHeight) => Math.min(4, Math.max(0.5, viewHeight * 0.013));
const dragThreshold = (viewHeight) => Math.min(1.5, Math.max(0.25, viewHeight * 0.006));

export function initPropEdit({ getState, renderApi, host }) {
  let tool = null;              // 'prop' | null
  let currentType = PROP_CATALOG[0].type;
  let pendingRotationY = 0;     // heading for the next placement, until something snaps it
  let selected = new Set();     // prop ids
  let hover = null;             // last snapped placement candidate: {x,z,rotationY,mount,kind}
  let gesture = null;           // pointer-down state, see pointerDown
  let clipboard = [];           // copied prop fragments (no id/floor)
  let pasteCount = 0;

  const group = new THREE.Group();
  group.renderOrder = 600;
  renderApi.scene.add(group);

  // --- overlay: placement ghost (footprint + a small tick marking "front") ---
  const ghostGroup = new THREE.Group();
  const ghostPlaneGeo = new THREE.PlaneGeometry(1, 1);
  ghostPlaneGeo.rotateX(-Math.PI / 2);
  const ghostMat = new THREE.MeshBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.35, depthTest: false });
  const ghostPlane = new THREE.Mesh(ghostPlaneGeo, ghostMat);
  ghostPlane.renderOrder = 601;
  const markerGeo = new THREE.BufferGeometry();
  markerGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.35, 0, 0, 0.35, 0, 0, 0, 0, 0.7], 3));
  markerGeo.setIndex([0, 1, 2]);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x1c2430, transparent: true, opacity: 0.85, depthTest: false });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.renderOrder = 602;
  ghostGroup.add(ghostPlane, marker);
  ghostGroup.visible = false;
  group.add(ghostGroup);

  // --- overlay: selection outlines, pooled like polyedit's handles ---
  const selMat = new THREE.LineBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true });
  const selPool = [];
  function takeOutline() {
    const l = selPool.find((x) => !x.visible) || (() => {
      const line = new THREE.LineLoop(new THREE.BufferGeometry(), selMat);
      line.renderOrder = 603;
      line.frustumCulled = false;
      selPool.push(line);
      group.add(line);
      return line;
    })();
    l.visible = true;
    return l;
  }

  // --- overlay: marquee rectangle ---
  const marqueeMat = new THREE.LineBasicMaterial({ color: MARQUEE_COLOR, depthTest: false, transparent: true, opacity: 0.85 });
  const marquee = new THREE.LineLoop(new THREE.BufferGeometry(), marqueeMat);
  marquee.renderOrder = 603;
  marquee.frustumCulled = false;
  marquee.visible = false;
  group.add(marquee);

  const baseY = () => {
    const s = getState();
    return floorBaseY(s, s.currentFloor) + 0.06;
  };

  function setOutline(line, hw, hd, cx, cz, rotationY) {
    const y = baseY() + 0.3;
    const c = Math.cos(rotationY), s = Math.sin(rotationY);
    const arr = [];
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      arr.push(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  }

  // Props referenced by `selected` that actually live on the floor being
  // edited right now — switching floors with a selection doesn't carry it
  // along to whatever prop now has that id's neighbour showing.
  function liveSelected(s) {
    const out = [];
    for (const id of selected) {
      const p = getProp(s, id);
      if (p && p.floor === s.currentFloor) out.push(p);
    }
    return out;
  }

  function refresh() {
    for (const l of selPool) l.visible = false;
    const s = getState();

    for (const p of liveSelected(s)) {
      const entry = catalogEntry(p.type);
      if (!entry) continue;
      const { hw, hd } = footprintOf(entry, p);
      setOutline(takeOutline(), hw, hd, p.x, p.z, p.rotationY);
    }

    const showGhost = tool === 'prop' && hover && (!gesture || gesture.mode === 'pending');
    if (showGhost) {
      const entry = catalogEntry(currentType);
      const { hw, hd } = footprintOf(entry, { scale: 1 });
      ghostGroup.visible = true;
      ghostGroup.position.set(hover.x, baseY(), hover.z);
      ghostGroup.rotation.y = hover.rotationY;
      // The geometry was rotated flat with `rotateX(-π/2)`, which bakes the
      // rotation into the vertices: the plane's two extents are then local X
      // and local *Z*, and local Y is zero everywhere. Scaling (w, d, 1)
      // therefore stretches nothing and leaves a one-foot sliver, which is
      // what this drew from Phase 3 of the first arc until Phase 8 of the
      // second one put a fourth plane on the same rake.
      ghostPlane.scale.set(hw * 2, 1, hd * 2);
      marker.position.set(0, 0.02, hd);
      ghostMat.color.setHex(s.props.length >= MAX_PROPS ? GHOST_BAD : GHOST_OK);
    } else {
      ghostGroup.visible = false;
    }

    if (gesture && gesture.mode === 'marquee') {
      const y = baseY() + 0.3;
      const { x0, z0, x1, z1 } = gesture;
      marquee.geometry.dispose();
      marquee.geometry = new THREE.BufferGeometry();
      marquee.geometry.setAttribute('position', new THREE.Float32BufferAttribute(
        [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3));
      marquee.visible = true;
    } else {
      marquee.visible = false;
    }
  }

  // --- hover / placement preview ---

  function updateHover(p, e) {
    const s = getState();
    const floor = activeFloor(s);
    const entry = catalogEntry(currentType);
    if (!entry) { hover = null; return; }
    hover = snapProp(floor, s.props, s.currentFloor, entry, null, p.x, p.z, pendingRotationY, {
      tol: snapTol(renderApi.editView.height),
      catalogGet: catalogEntry,
      free: !!(e && e.altKey),
    });
  }

  // --- public interaction ---

  function pointerDown(p, e) {
    if (tool !== 'prop') return false;
    const s = getState();
    const hit = pickPropAt(s.props, s.currentFloor, catalogEntry, p.x, p.z);

    if (hit) {
      if (e.shiftKey) {
        const next = new Set(selected);
        next.has(hit.id) ? next.delete(hit.id) : next.add(hit.id);
        selected = next;
        gesture = null;
        host.status(`${selected.size} prop${selected.size === 1 ? '' : 's'} selected.`);
        refresh();
        return true;
      }
      if (!selected.has(hit.id)) selected = new Set([hit.id]);
      host.pushUndo();
      gesture = {
        mode: 'drag',
        anchorId: hit.id,
        startPointer: { x: p.x, z: p.z },
        items: liveSelected(s).map((pr) => ({ id: pr.id, x0: pr.x, z0: pr.z })),
        moved: false,
      };
      refresh();
      return true;
    }

    if (!e.shiftKey) selected = new Set();
    gesture = { mode: 'pending', start: { x: p.x, z: p.z }, shift: e.shiftKey, x0: p.x, z0: p.z, x1: p.x, z1: p.z };
    updateHover(p, e);
    refresh();
    return true;
  }

  function pointerMove(p, e) {
    if (tool !== 'prop') return false;

    if (gesture && gesture.mode === 'drag') {
      const s = getState();
      const anchorItem = gesture.items.find((it) => it.id === gesture.anchorId);
      const anchorProp = getProp(s, gesture.anchorId);
      if (!anchorItem || !anchorProp) { gesture = null; return true; }
      const entry = catalogEntry(anchorProp.type);
      const rawX = p.x + (anchorItem.x0 - gesture.startPointer.x);
      const rawZ = p.z + (anchorItem.z0 - gesture.startPointer.z);
      const snapped = snapProp(activeFloor(s), s.props, s.currentFloor, entry, anchorProp, rawX, rawZ, anchorProp.rotationY, {
        tol: snapTol(renderApi.editView.height),
        excludeId: anchorProp.id,
        catalogGet: catalogEntry,
        free: e.altKey,
      });
      const deltaX = snapped.x - anchorItem.x0, deltaZ = snapped.z - anchorItem.z0;
      for (const it of gesture.items) {
        const pr = getProp(s, it.id);
        if (!pr) continue;
        pr.x = it.x0 + deltaX;
        pr.z = it.z0 + deltaZ;
        if (it.id === gesture.anchorId) pr.mount = snapped.mount;
      }
      if (Math.hypot(deltaX, deltaZ) > 0.01) gesture.moved = true;
      host.changed({ throttled: true });
      refresh();
      return true;
    }

    if (gesture && gesture.mode === 'pending') {
      const dist = Math.hypot(p.x - gesture.start.x, p.z - gesture.start.z);
      if (dist > dragThreshold(renderApi.editView.height)) {
        gesture = { mode: 'marquee', x0: gesture.start.x, z0: gesture.start.z, x1: p.x, z1: p.z, shift: gesture.shift };
        refresh();
        return true;
      }
      updateHover(p, e);
      refresh();
      return true;
    }

    if (gesture && gesture.mode === 'marquee') {
      gesture.x1 = p.x; gesture.z1 = p.z;
      refresh();
      return true;
    }

    updateHover(p, e);
    refresh();
    return true;
  }

  function pointerUp() {
    if (!gesture || tool !== 'prop') return false;

    if (gesture.mode === 'drag') {
      const moved = gesture.moved;
      gesture = null;
      if (!moved) { host.dropUndo(); refresh(); return true; }
      const s = getState();
      const p = getProp(s, [...selected][0]);
      host.changed({ commit: true });
      host.status(p ? `Moved ${selected.size} prop${selected.size === 1 ? '' : 's'}.` : 'Moved.');
      refresh();
      return true;
    }

    if (gesture.mode === 'marquee') {
      const s = getState();
      const hits = propsInBox(s.props, s.currentFloor, catalogEntry, gesture.x0, gesture.z0, gesture.x1, gesture.z1);
      if (gesture.shift) {
        const next = new Set(selected);
        for (const p of hits) next.add(p.id);
        selected = next;
      } else {
        selected = new Set(hits.map((p) => p.id));
      }
      gesture = null;
      host.status(`${selected.size} prop${selected.size === 1 ? '' : 's'} selected.`);
      refresh();
      return true;
    }

    if (gesture.mode === 'pending') {
      gesture = null;
      const s = getState();
      const entry = catalogEntry(currentType);
      if (!entry || !hover) { refresh(); return true; }
      if (s.props.length >= MAX_PROPS) { host.status('Prop limit reached — nothing placed.'); refresh(); return true; }
      host.pushUndo();
      const added = addProp(s, currentType, {
        x: hover.x, z: hover.z, y: entry.y || 0, rotationY: hover.rotationY, mount: hover.mount, scale: 1,
      });
      if (!added) { host.dropUndo(); host.status('Could not place that.'); refresh(); return true; }
      selected = new Set([added.id]);
      host.changed();
      host.status(`${entry.name} placed${hover.kind !== 'free' ? ` — snapped to ${hover.kind}` : ''}.`);
      refresh();
      return true;
    }
    return false;
  }

  // --- keyboard: rotate, delete, escape ---

  function key(e) {
    if (tool !== 'prop') return false;
    const s = getState();

    if (e.code === 'KeyR') {
      const delta = e.shiftKey ? -ROTATE_STEP : ROTATE_STEP;
      const items = liveSelected(s);
      if (items.length) {
        host.pushUndo();
        for (const p of items) p.rotationY = wrapAngle(p.rotationY + delta);
        host.changed();
        host.status(`Rotated ${items.length} prop${items.length === 1 ? '' : 's'}.`);
      } else {
        pendingRotationY = wrapAngle(pendingRotationY + delta);
        if (hover) hover = { ...hover, rotationY: pendingRotationY };
      }
      refresh();
      return true;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      const items = liveSelected(s);
      if (!items.length) return false;
      host.pushUndo();
      for (const p of items) removeProp(s, p.id);
      selected = new Set();
      host.changed();
      host.status(`Deleted ${items.length} prop${items.length === 1 ? '' : 's'}.`);
      refresh();
      return true;
    }
    if (e.code === 'Escape') {
      if (!selected.size) return false;
      selected = new Set();
      refresh();
      return true;
    }
    return false;
  }

  // --- copy / paste / duplicate — driven separately since these are Ctrl
  // combos, which the editor's generic key() routing never forwards here.

  function copySelection() {
    if (tool !== 'prop') return false;
    const items = liveSelected(getState());
    if (!items.length) return false;
    clipboard = items.map((p) => ({
      type: p.type, x: p.x, z: p.z, y: p.y, rotationY: p.rotationY, scale: p.scale, mount: p.mount, data: { ...p.data },
    }));
    pasteCount = 0;
    host.status(`Copied ${clipboard.length} prop${clipboard.length === 1 ? '' : 's'}.`);
    return true;
  }

  function pasteClipboard() {
    if (tool !== 'prop' || !clipboard.length) return false;
    const s = getState();
    if (s.props.length >= MAX_PROPS) { host.status('Prop limit reached — nothing pasted.'); return true; }
    pasteCount += 1;
    const off = PASTE_OFFSET * pasteCount;
    host.pushUndo();
    const added = [];
    for (const c of clipboard) {
      const p = addProp(s, c.type, {
        x: c.x + off, z: c.z + off, y: c.y, rotationY: c.rotationY, scale: c.scale, mount: c.mount, data: c.data,
      });
      if (p) added.push(p.id);
    }
    if (!added.length) { host.dropUndo(); return true; }
    selected = new Set(added);
    host.changed();
    host.status(`Pasted ${added.length} prop${added.length === 1 ? '' : 's'}.`);
    refresh();
    return true;
  }

  function duplicateSelection() {
    if (tool !== 'prop' || !selected.size) return false;
    copySelection();
    return pasteClipboard();
  }

  function setType(t) {
    if (!catalogEntry(t)) return;
    currentType = t;
    refresh();
  }

  function setTool(t) {
    if (t !== tool) { gesture = null; hover = null; }
    tool = t === 'prop' ? 'prop' : null;
    if (tool !== 'prop') selected = new Set();
    refresh();
  }

  return {
    setTool,
    get tool() { return tool; },
    setType,
    get currentType() { return currentType; },
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    clearHover() { hover = null; refresh(); },
    copySelection, pasteClipboard, duplicateSelection,
    get selectionCount() { return selected.size; },
  };
}
