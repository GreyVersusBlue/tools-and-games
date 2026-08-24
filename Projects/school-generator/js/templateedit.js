// templateedit.js — the templates tool: pick a preset from the palette, see a
// footprint ghost, click to stamp its whole prop list at once. Same split as
// the other tools — the placement math lives in templates.js, this file is
// the pointer stream and the overlay that makes it visible. Modeled closely
// on stairedit.js's pending/cancelled gesture, since a template is a single
// click-to-place object the same way a stair run is, just one that expands
// into many props instead of one link.

import * as THREE from 'three';
import { floorBaseY } from './grid.js';
import { addProp, MAX_PROPS, wrapAngle } from './props.js';
import { gridSnap } from './propplace.js';
import { ROOM_TEMPLATES, templateByKey, templatePlacements } from './templates.js';

const GHOST_OK = 0x7ce0a0;
const GHOST_BAD = 0xff5f56;
const ROTATE_STEP = Math.PI / 12; // 15°, same step the prop and stair tools turn by

const snapTol = (viewHeight) => Math.min(4, Math.max(0.5, viewHeight * 0.013));
const dragThreshold = (viewHeight) => Math.min(1.5, Math.max(0.25, viewHeight * 0.006));

export function initTemplateEdit({ getState, renderApi, host }) {
  let tool = null;                       // 'template' | null
  let currentKey = ROOM_TEMPLATES[0].key;
  let pendingRotationY = 0;
  let hover = null;                      // { x, z } snapped anchor candidate
  let gesture = null;

  const group = new THREE.Group();
  group.renderOrder = 600;
  renderApi.scene.add(group);

  // Footprint rectangle plus a tick marking which way "into the room" faces —
  // same visual language as the stair tool's run-direction marker.
  const ghostGroup = new THREE.Group();
  const ghostGeo = new THREE.PlaneGeometry(1, 1);
  ghostGeo.rotateX(-Math.PI / 2);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: GHOST_OK, transparent: true, opacity: 0.28, depthTest: false,
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
    return floorBaseY(s, s.currentFloor) + 0.05;
  };

  function refresh() {
    const s = getState();
    const tpl = templateByKey(currentKey);
    const showGhost = tool === 'template' && tpl && hover && (!gesture || gesture.mode === 'pending');
    if (showGhost) {
      ghostGroup.visible = true;
      ghostGroup.position.set(hover.x, baseY(), hover.z);
      ghostGroup.rotation.y = pendingRotationY;
      ghostPlane.scale.set(tpl.footprint.w, tpl.footprint.d, 1);
      marker.position.set(0, 0.02, tpl.footprint.d / 2 + 0.6);
      const wouldFit = s.props.length + tpl.stamps.length <= MAX_PROPS;
      ghostMat.color.setHex(wouldFit ? GHOST_OK : GHOST_BAD);
    } else {
      ghostGroup.visible = false;
    }
  }

  function snapAt(p, e) {
    if (e && e.altKey) return { x: p.x, z: p.z };
    const g = gridSnap(p.x, p.z, snapTol(renderApi.editView.height));
    return g || { x: p.x, z: p.z };
  }

  // --- interaction ---

  function pointerDown(p, e) {
    if (tool !== 'template') return false;
    gesture = { mode: 'pending', start: { x: p.x, z: p.z } };
    hover = snapAt(p, e);
    refresh();
    return true;
  }

  function pointerMove(p, e) {
    if (tool !== 'template') return false;
    if (gesture && gesture.mode === 'pending' &&
        Math.hypot(p.x - gesture.start.x, p.z - gesture.start.z) > dragThreshold(renderApi.editView.height)) {
      // A drag from the anchor point isn't a placement — same rule the prop
      // and stair tools follow, so a wobbled click never stamps a room's
      // worth of furniture somewhere odd.
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
    if (!gesture || tool !== 'template') return false;
    const mode = gesture.mode;
    gesture = null;
    if (mode === 'cancelled') { refresh(); return true; }

    const s = getState();
    const tpl = templateByKey(currentKey);
    if (!tpl || !hover) { refresh(); return true; }
    const placements = templatePlacements(tpl, hover.x, hover.z, pendingRotationY);
    if (s.props.length + placements.length > MAX_PROPS) {
      host.status('Prop limit reached — nothing placed.');
      refresh();
      return true;
    }
    host.pushUndo();
    const added = [];
    for (const pl of placements) {
      const prop = addProp(s, pl.type, {
        x: pl.x, z: pl.z, y: pl.y, rotationY: pl.rotationY, mount: pl.mount, scale: 1,
      });
      if (prop) added.push(prop.id);
    }
    if (!added.length) {
      host.dropUndo();
      host.status('Could not place that template.');
      refresh();
      return true;
    }
    host.changed();
    host.status(`${tpl.name} placed — ${added.length} prop${added.length === 1 ? '' : 's'}.`);
    refresh();
    return true;
  }

  // --- keyboard: rotate before placing ---

  function key(e) {
    if (tool !== 'template') return false;
    if (e.code === 'KeyR') {
      const delta = e.shiftKey ? -ROTATE_STEP : ROTATE_STEP;
      pendingRotationY = wrapAngle(pendingRotationY + delta);
      refresh();
      return true;
    }
    return false;
  }

  function setType(key_) {
    if (!templateByKey(key_)) return;
    currentKey = key_;
    refresh();
  }

  function setTool(t) {
    if (t !== tool) { gesture = null; hover = null; }
    tool = t === 'template' ? 'template' : null;
    refresh();
  }

  return {
    setTool,
    get tool() { return tool; },
    setType,
    get currentKey() { return currentKey; },
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    clearHover() { hover = null; refresh(); },
  };
}
