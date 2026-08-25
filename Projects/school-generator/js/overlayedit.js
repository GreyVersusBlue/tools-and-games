// overlayedit.js — the Overlay tool: drag the tracing image into place, turn
// it, and measure something on it to set its scale.
//
// Same split as every other tool in this codebase: the arithmetic is in
// overlay.js and headless, this file is the pointer stream and the handles
// that make it visible. The plane itself is drawn by render.js, because it is
// read off the state and belongs to the drawing rather than to the tool — the
// same arrangement the site regions and the roof have.
//
// Two modes, which is one more than any other tool has and the reason is the
// measurement:
//
//   move     drag the picture, R turns it, and that is all it does.
//   measure  click one end of something you know the length of, click the
//            other, and type what it is. The scale falls out of one division.
//
// The measure gesture is two clicks rather than a drag on purpose. You are
// usually zooming between the clicks — find one end of the wall, zoom out,
// pan, zoom in on the other end — and a drag can't survive that.

import * as THREE from 'three';
import { floorBaseY } from './grid.js';
import {
  imageToWorld, worldToImage, overlayCorners, calibrationOf,
  moveOverlay, rotateOverlay, setOverlay, showsOn,
} from './overlay.js';

const MEASURE_COLOR = 0xf0a44a;
const MOVE_COLOR = 0x4da3ff;
const ROTATE_STEP = Math.PI / 36;    // 5° — an overlay is aligned, not placed
const FINE_STEP = Math.PI / 720;     // 0.25° with Shift, for squaring a scan up

const handleSize = (viewHeight) => Math.min(6, Math.max(0.5, viewHeight * 0.009));

export function initOverlayEdit({ getState, renderApi, host }) {
  let tool = null;              // 'overlay' | null
  let mode = 'move';            // 'move' | 'measure'
  let drag = null;              // { from: {x,z}, start: {x,z} }
  // The measurement in progress: the first click, in *image* pixels, so it
  // stays on the same spot of the picture if the picture moves underneath it.
  let pending = null;           // { u, v }
  let hover = null;             // { x, z }

  const group = new THREE.Group();
  group.renderOrder = 610;
  renderApi.scene.add(group);

  const lineMat = new THREE.LineBasicMaterial({
    color: MOVE_COLOR, depthTest: false, transparent: true, opacity: 0.9,
  });
  const measureMat = new THREE.LineBasicMaterial({
    color: MEASURE_COLOR, depthTest: false, transparent: true, opacity: 0.95,
  });
  const dotMat = new THREE.MeshBasicMaterial({
    color: MEASURE_COLOR, depthTest: false, transparent: true, opacity: 0.95,
  });

  // The picture's outline, so you can see where it is even where it is nearly
  // transparent or entirely white.
  const outline = new THREE.LineLoop(new THREE.BufferGeometry(), lineMat);
  outline.renderOrder = 611;
  outline.visible = false;
  group.add(outline);

  // The measurement: the line, and a dot at each end of it.
  const measureLine = new THREE.Line(new THREE.BufferGeometry(), measureMat);
  measureLine.renderOrder = 613;
  measureLine.visible = false;
  group.add(measureLine);

  const dots = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 18), dotMat);
    m.geometry.rotateX(-Math.PI / 2);
    m.renderOrder = 614;
    m.visible = false;
    group.add(m);
    return m;
  });

  const overlayOf = () => {
    const s = getState();
    return s && s.overlay ? s.overlay : null;
  };

  const baseY = () => {
    const s = getState();
    return floorBaseY(s, s.currentFloor) + 0.09;
  };

  function setPositions(geo, pts) {
    const y = baseY();
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = p.z; });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeBoundingSphere();
  }

  function refresh() {
    const s = getState();
    const o = overlayOf();
    const on = tool === 'overlay' && o && showsOn(o, s.currentFloor);
    group.visible = !!on;
    if (!on) {
      outline.visible = measureLine.visible = false;
      dots.forEach((d) => { d.visible = false; });
      return;
    }

    setPositions(outline.geometry, overlayCorners(o));
    outline.visible = true;
    lineMat.color.setHex(o.locked ? 0x7a8390 : MOVE_COLOR);

    // What to draw for the measurement: the one being taken, or the one that
    // is already set. Both are two dots and a line, which is the point — the
    // measurement you took stays visible so you can see what the scale rests
    // on and re-take it if it was wrong.
    let a = null, b = null;
    if (pending) {
      a = imageToWorld(o, pending.u, pending.v);
      b = hover || a;
    } else {
      const cal = calibrationOf(o);
      if (cal) { a = cal.a; b = cal.b; }
    }
    if (a) {
      setPositions(measureLine.geometry, [a, b]);
      measureLine.visible = true;
      const r = handleSize(renderApi.editView.height) * 0.4;
      const y = baseY() + 0.01;
      [a, b].forEach((p, i) => {
        dots[i].position.set(p.x, y, p.z);
        dots[i].scale.set(r, 1, r);
        dots[i].visible = true;
      });
    } else {
      measureLine.visible = false;
      dots.forEach((d) => { d.visible = false; });
    }
  }

  // --- interaction ---

  function pointerDown(p, e) {
    if (tool !== 'overlay') return false;
    const o = overlayOf();
    if (!o) { host.status('Load an image first — the Overlay panel has the button.'); return true; }
    if (mode === 'measure') {
      const pt = worldToImage(o, p.x, p.z);
      if (!pending) {
        pending = pt;
        hover = { x: p.x, z: p.z };
        host.status('Now click the other end of what you are measuring.');
        refresh();
        return true;
      }
      // Second click: hand both ends to the panel, which asks how long it is.
      const first = pending;
      pending = null;
      refresh();
      host.measured(first, pt);
      return true;
    }
    if (o.locked) { host.status('The overlay is locked — unlock it to move it.'); return true; }
    host.pushUndo();
    drag = { from: { x: p.x, z: p.z }, start: { x: o.x, z: o.z }, moved: false };
    return true;
  }

  function pointerMove(p, e) {
    if (tool !== 'overlay') return false;
    if (mode === 'measure') {
      if (pending) { hover = { x: p.x, z: p.z }; refresh(); }
      return true;
    }
    if (!drag) return true;
    const o = overlayOf();
    if (!o) return true;
    const dx = p.x - drag.from.x, dz = p.z - drag.from.z;
    if (!drag.moved && Math.hypot(dx, dz) < 0.4) return true;
    drag.moved = true;
    host.setOverlay(setOverlay(o, { x: drag.start.x + dx, z: drag.start.z + dz }), { live: true });
    refresh();
    return true;
  }

  function pointerUp() {
    if (tool !== 'overlay' || !drag) return false;
    const moved = drag.moved;
    drag = null;
    if (!moved) { host.dropUndo(); return true; }
    host.changed();
    const o = overlayOf();
    if (o) host.status(`Overlay moved to ${Math.round(o.x)}, ${Math.round(o.z)} ft.`);
    refresh();
    return true;
  }

  function key(e) {
    if (tool !== 'overlay') return false;
    if (e.code === 'Escape' && pending) { pending = null; hover = null; refresh(); return true; }
    const o = overlayOf();
    if (!o) return false;
    if (e.code === 'KeyR') {
      if (o.locked) { host.status('The overlay is locked — unlock it to turn it.'); return true; }
      const step = e.shiftKey ? FINE_STEP : ROTATE_STEP;
      host.pushUndo();
      host.setOverlay(rotateOverlay(o, e.altKey ? -step : step));
      host.changed();
      const deg = (o.rot * 180 / Math.PI + (e.altKey ? -1 : 1) * step * 180 / Math.PI + 360) % 360;
      host.status(`Overlay turned to ${deg.toFixed(step === FINE_STEP ? 2 : 0)}°.`);
      refresh();
      return true;
    }
    // Nudge by a foot, which is what squaring a scan up against a grid line
    // actually takes.
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
    if (nudge && !o.locked) {
      const step = e.shiftKey ? 0.25 : 1;
      host.pushUndo();
      host.setOverlay(moveOverlay(o, nudge[0] * step, nudge[1] * step));
      host.changed();
      refresh();
      return true;
    }
    return false;
  }

  function setTool(t) {
    if (t !== tool) { drag = null; pending = null; hover = null; }
    tool = t === 'overlay' ? 'overlay' : null;
    refresh();
  }

  return {
    setTool,
    get tool() { return tool; },
    get mode() { return mode; },
    setMode(m) {
      mode = m === 'measure' ? 'measure' : 'move';
      pending = null;
      hover = null;
      refresh();
    },
    get measuring() { return !!pending; },
    cancelMeasure() { pending = null; hover = null; refresh(); },
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    clearHover() { if (!pending) hover = null; refresh(); },
  };
}
