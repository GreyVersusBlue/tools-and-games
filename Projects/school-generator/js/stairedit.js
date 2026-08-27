// stairedit.js — the stairs tool: place a run (or a plain floor opening),
// select it, drag it, rotate it, delete it. Same split as the other two
// interactive tools — the model and every measurement live in stairs.js, this
// file is the pointer stream and the overlay that makes it visible.
//
// What makes it its own tool rather than another prop type: a stair is placed
// on one storey and *changes* another. The overlay therefore draws two
// rectangles — the run's own footprint on the floor you're editing, and the
// hole it opens in the floor above — because the second one is the part you
// can't see while you're standing on the first.

import * as THREE from 'three';
import { floorLabel, floorBaseY } from './grid.js';
import { removeLink, wrapAngle } from './props.js';
import { gridSnap } from './propplace.js';
import {
  STAIR_TYPES, stairMetrics, footprintBox, rectCorners, cutBox,
  linksFrom, linkAt, linkById, addStair, stairWidth, openingSize,
  elevatorSize, elevatorDoorWidth,
} from './stairs.js';

const SELECT_COLOR = 0xffcf5a;
const CUT_COLOR = 0x7cc7ff;
const GHOST_OK = 0x7ce0a0;
const GHOST_BAD = 0xff5f56;
const ROTATE_STEP = Math.PI / 12; // 15°, same step the prop tool turns by

const snapTol = (viewHeight) => Math.min(4, Math.max(0.5, viewHeight * 0.013));
// How far outside a footprint still counts as clicking it. Sized off the zoom
// like every other handle in this editor, and capped so it never swallows the
// ground beside a stair at a working zoom.
const grabTol = (viewHeight) => Math.min(3, Math.max(0.2, viewHeight * 0.006));
const dragThreshold = (viewHeight) => Math.min(1.5, Math.max(0.25, viewHeight * 0.006));

// One line of prose about a link, for the status bar. Stairs are the one thing
// in this editor with real dimensions worth reporting back — a run either fits
// the room it's in or it doesn't, and 21 risers is the number that says so.
function describe(state, link, metrics) {
  const upper = floorLabel(link.to);
  if (link.type === 'opening') {
    const { w, d } = openingSize(link);
    return `Floor opening — ${Math.round(w)} × ${Math.round(d)} ft through ${upper}, railed all round.`;
  }
  // An elevator is the one link with no hole in the floor above — the car
  // stands on the slab at each end (see `cutBox` in stairs.js, which returns
  // null for it). Everything below this line used to read that null's `.x1`,
  // so *selecting* a lift threw before it could be described, moved or
  // deleted. That is what "there is no way to delete an elevator" was.
  if (link.type === 'elevator') {
    const { w, d } = elevatorSize(link);
    return `Elevator — ${w} × ${d} ft car, ${elevatorDoorWidth(link).toFixed(1)}ft doors, ` +
      `serving ${floorLabel(link.from)} and ${upper}. Cuts no hole; you arrive on the slab.`;
  }
  const inches = (metrics.riser * 12).toFixed(1);
  const cut = cutBox(link, metrics);
  const noun = link.type === 'ramp' ? 'Ramp' : 'Stair';
  const rise = link.type === 'ramp'
    ? `${metrics.run.toFixed(1)}ft of run`
    : `${metrics.steps} risers at ${inches}in, ${metrics.run.toFixed(1)}ft of run`;
  const opens = cut
    ? ` Opens ${(cut.x1 - cut.x0).toFixed(1)} × ${(cut.z1 - cut.z0).toFixed(1)}ft of ${upper}.`
    : ` Rises to ${upper}.`;
  return `${noun} — ${rise}, ${stairWidth(link)}ft wide.${opens}`;
}

export function initStairEdit({ getState, renderApi, host }) {
  let tool = null;            // 'stair' | null
  let currentType = 'stair';  // 'stair' | 'opening'
  let pendingRotationY = 0;
  let selectedId = null;
  let hover = null;           // { x, z } snapped placement candidate
  let gesture = null;

  const group = new THREE.Group();
  group.renderOrder = 600;
  renderApi.scene.add(group);

  const mkLoop = (color, opacity = 1) => {
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity })
    );
    line.renderOrder = 603;
    line.frustumCulled = false;
    line.visible = false;
    group.add(line);
    return line;
  };
  const selOutline = mkLoop(SELECT_COLOR);
  const cutOutline = mkLoop(CUT_COLOR, 0.8);

  // Placement ghost: the footprint, plus a tick pointing the way up the run.
  const ghostGroup = new THREE.Group();
  const ghostGeo = new THREE.PlaneGeometry(1, 1);
  ghostGeo.rotateX(-Math.PI / 2);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: GHOST_OK, transparent: true, opacity: 0.3, depthTest: false,
  });
  const ghostPlane = new THREE.Mesh(ghostGeo, ghostMat);
  ghostPlane.renderOrder = 601;
  const markerGeo = new THREE.BufferGeometry();
  markerGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.6, 0, 0, 0.6, 0, 0, 0, 0, 1.4], 3));
  markerGeo.setIndex([0, 1, 2]);
  const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({
    color: 0x1c2430, transparent: true, opacity: 0.85, depthTest: false,
  }));
  marker.renderOrder = 602;
  ghostGroup.add(ghostPlane, marker);
  ghostGroup.visible = false;
  group.add(ghostGroup);

  const baseY = () => {
    const s = getState();
    return floorBaseY(s, s.currentFloor) + 0.4;
  };

  const grabPad = () => grabTol(renderApi.editView.height);

  function setLoop(line, pts) {
    if (!pts) { line.visible = false; return; }
    const y = baseY();
    const arr = [];
    for (const p of pts) arr.push(p.x, y, p.z);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    line.visible = true;
  }

  // Re-resolved by id every time, like the other tools' selections: a link can
  // vanish under the tool through undo, a floor switch or a loaded file.
  //
  // "On this storey" is the same rule `linkAt` picks by, and it has to be: an
  // elevator stands on *both* of the levels it serves, so it is selectable
  // from either. Before Phase 25 this asked only about `from`, which meant a
  // lift picked from the upper landing was selected for the drag and invisible
  // to Delete and to R — the tool would move it and then refuse to remove it.
  const servesHere = (link, floorIndex) =>
    link.from === floorIndex || (link.type === 'elevator' && link.to === floorIndex);

  function selected() {
    const s = getState();
    const link = selectedId == null ? null : linkById(s, selectedId);
    if (!link || !servesHere(link, s.currentFloor)) { selectedId = null; return null; }
    return link;
  }

  function refresh() {
    const s = getState();
    const metrics = stairMetrics(s);
    const link = selected();
    if (host.selectionChanged) host.selectionChanged(link);
    if (link) {
      setLoop(selOutline, rectCorners(link, footprintBox(link, metrics)));
      // ...and `cutBox` is null for an elevator, which cuts nothing. `setLoop`
      // already takes null to mean "draw no outline"; what it could not take
      // was `rectCorners` being handed one.
      const cut = cutBox(link, metrics);
      setLoop(cutOutline, cut ? rectCorners(link, cut) : null);
    } else {
      selOutline.visible = false;
      cutOutline.visible = false;
    }

    const showGhost = tool === 'stair' && hover && (!gesture || gesture.mode === 'pending');
    if (showGhost) {
      const probe = { type: currentType, x: hover.x, z: hover.z, rotationY: pendingRotationY, data: {} };
      const box = footprintBox(probe, metrics);
      ghostGroup.visible = true;
      ghostGroup.position.set(hover.x, baseY() - 0.3, hover.z);
      ghostGroup.rotation.y = pendingRotationY;
      ghostPlane.scale.set(box.x1 - box.x0, 1, box.z1 - box.z0);
      // The footprint runs from the bottom of the stair forward, so its centre
      // isn't the placement point — a stair is placed by the step you take first.
      ghostPlane.position.set((box.x0 + box.x1) / 2, 0, (box.z0 + box.z1) / 2);
      marker.position.set(0, 0.02, box.z1 + 0.6);
      ghostMat.color.setHex(s.floors[s.currentFloor + 1] ? GHOST_OK : GHOST_BAD);
    } else {
      ghostGroup.visible = false;
    }
  }

  function snapAt(p, e) {
    if (e && e.altKey) return { x: p.x, z: p.z };
    const g = gridSnap(p.x, p.z, snapTol(renderApi.editView.height));
    return g || { x: p.x, z: p.z };
  }

  function status(link) {
    const s = getState();
    host.status(link ? describe(s, link, stairMetrics(s))
      : 'Vertical — click empty ground to place one. Click one to select it, ' +
        'then drag it, R to rotate, Delete to remove.');
  }

  // --- interaction ---

  function pointerDown(p, e) {
    if (tool !== 'stair') return false;
    const s = getState();
    // A little padding round the footprint, in view feet: a 4ft-wide stair
    // zoomed out to a whole campus is a few pixels of target, and missing it
    // places a *second* stair on top of the first — which is what "there is no
    // way to move this thing" actually felt like.
    const hit = linkAt(s, s.currentFloor, p.x, p.z, grabPad());
    if (hit) {
      selectedId = hit.id;
      pendingRotationY = hit.rotationY || 0;
      host.pushUndo();
      gesture = {
        mode: 'drag', id: hit.id, moved: false,
        startPointer: { x: p.x, z: p.z }, x0: hit.x, z0: hit.z,
      };
      status(hit);
      refresh();
      return true;
    }
    selectedId = null;
    gesture = { mode: 'pending', start: { x: p.x, z: p.z } };
    hover = snapAt(p, e);
    refresh();
    return true;
  }

  function pointerMove(p, e) {
    if (tool !== 'stair') return false;

    if (gesture && gesture.mode === 'drag') {
      const link = linkById(getState(), gesture.id);
      if (!link) { gesture = null; return true; }
      const raw = {
        x: p.x + (gesture.x0 - gesture.startPointer.x),
        z: p.z + (gesture.z0 - gesture.startPointer.z),
      };
      const sp = snapAt(raw, e);
      if (Math.hypot(sp.x - link.x, sp.z - link.z) > 0.01) gesture.moved = true;
      link.x = sp.x;
      link.z = sp.z;
      host.changed({ throttled: true });
      refresh();
      return true;
    }

    if (gesture && gesture.mode === 'pending' &&
        Math.hypot(p.x - gesture.start.x, p.z - gesture.start.z) > dragThreshold(renderApi.editView.height)) {
      // A drag from empty ground isn't a placement — same rule the prop tool
      // follows, so a wobbled click never drops a staircase somewhere odd.
      gesture = { mode: 'cancelled' };
      hover = null;
      refresh();
      return true;
    }

    hover = snapAt(p, e);
    refresh();
    return true;
  }

  function pointerUp() {
    if (!gesture || tool !== 'stair') return false;
    const mode = gesture.mode;
    const g = gesture;
    gesture = null;

    if (mode === 'drag') {
      const link = linkById(getState(), g.id);
      if (!g.moved) { host.dropUndo(); refresh(); return true; }
      host.changed({ commit: true });
      status(link);
      refresh();
      return true;
    }
    if (mode === 'cancelled') { refresh(); return true; }

    const s = getState();
    if (!hover) { refresh(); return true; }
    host.pushUndo();
    const { link, reason } = addStair(s, s.currentFloor, {
      type: currentType, x: hover.x, z: hover.z, rotationY: pendingRotationY,
    });
    if (!link) {
      host.dropUndo();
      host.status(reason);
      refresh();
      return true;
    }
    selectedId = link.id;
    host.changed();
    status(link);
    refresh();
    return true;
  }

  function key(e) {
    if (tool !== 'stair') return false;
    if (e.code === 'KeyR') { rotateSelected(e.shiftKey); return true; }
    if (e.code === 'Delete' || e.code === 'Backspace') return deleteSelected();
    if (e.code === 'Escape') {
      if (selectedId == null) return false;
      selectedId = null;
      refresh();
      return true;
    }
    return false;
  }

  function setType(t) {
    if (!STAIR_TYPES.includes(t)) return;
    currentType = t;
    refresh();
  }

  function setTool(t) {
    if (t !== tool) { gesture = null; hover = null; }
    tool = t === 'stair' ? 'stair' : null;
    if (tool !== 'stair') selectedId = null;
    refresh();
  }

  // --- what the panel drives (Phase 25) ---
  //
  // Everything below is the same three verbs the pointer and the keyboard
  // already had — select, move, remove — reachable from a list instead. The
  // hotkeys were never the problem; not being able to *find* the thing you
  // wanted to delete was, so the panel names them and this lets it act.

  function selectById(id) {
    const s = getState();
    const link = linkById(s, id);
    if (!link || !servesHere(link, s.currentFloor)) return null;
    selectedId = link.id;
    pendingRotationY = link.rotationY || 0;
    status(link);
    refresh();
    return link;
  }

  function deleteSelected() {
    const link = selected();
    if (!link) return false;
    host.pushUndo();
    removeLink(getState(), link.id);
    selectedId = null;
    host.changed();
    host.status(link.type === 'opening' ? 'Floor opening removed.'
      : link.type === 'elevator' ? 'Elevator removed.'
      : link.type === 'ramp' ? 'Ramp removed.' : 'Stair removed.');
    refresh();
    return true;
  }

  function rotateSelected(ccw = false) {
    const link = selected();
    const delta = ccw ? -ROTATE_STEP : ROTATE_STEP;
    if (!link) { pendingRotationY = wrapAngle(pendingRotationY + delta); refresh(); return false; }
    host.pushUndo();
    link.rotationY = wrapAngle(link.rotationY + delta);
    pendingRotationY = link.rotationY;
    host.changed();
    status(link);
    refresh();
    return true;
  }

  // Move the selection by whole cells. The keyboard's answer to "reposition",
  // for the case a drag is awkward — a lift in a shaft the width of itself.
  function nudgeSelected(dx, dz) {
    const link = selected();
    if (!link) return false;
    host.pushUndo();
    link.x += dx;
    link.z += dz;
    host.changed();
    status(link);
    refresh();
    return true;
  }

  // Every vertical link the storey being edited can act on, in the order the
  // panel lists them.
  function listHere() {
    const s = getState();
    return (s.links || [])
      .filter((l) => STAIR_TYPES.includes(l.type) && servesHere(l, s.currentFloor));
  }

  return {
    setTool,
    get tool() { return tool; },
    setType,
    get currentType() { return currentType; },
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    selectById, deleteSelected, rotateSelected, nudgeSelected, listHere,
    get selectedId() { return selected() ? selectedId : null; },
    describeLink(link) { return describe(getState(), link, stairMetrics(getState())); },
    clearHover() { hover = null; refresh(); },
    // How many stairs and openings rise out of the storey being edited — the
    // floor panel reports it alongside the cell and polygon counts.
    countHere() {
      const s = getState();
      return linksFrom(s, s.currentFloor).length;
    },
  };
}
