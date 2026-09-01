// siteedit.js — the site tool: drawing hardscape and grading the ground.
//
// Two modes on one tool, because they are the same act at two scales — "what
// is this bit of ground" and "what height is it".
//
//   region  click to drop corners, close the loop to lay a surface. The
//           surface and the marking come from the panel, so the same gesture
//           makes a lawn, a car park or a basketball court. Click an existing
//           region to select it; Delete removes it, and the panel's surface
//           and marking apply to it live.
//   grade   drag to raise the ground under the brush, Shift to lower it, Alt
//           to smooth what is already there. The brush is a ring on the
//           overlay so you can see what you are about to move.
//
// The split is the one every tool in this build uses: terrain.js and site.js
// own the geometry and the arithmetic and are headless; this file owns
// pointers, the overlay, and calling back into the editor's single undo stack.
//
// One thing worth knowing. A region's corners snap to the 4ft lattice, the
// same way a polygon room's do, but *not* to walls — a car park does not want
// to grab the corner of a classroom twenty feet away, and a walk that lands
// exactly on the building line is the one thing the renderer already handles
// by clipping. So the snap here is the lattice and nothing else.

import * as THREE from 'three';
import { CELL } from './grid.js';
import {
  addRegion, removeRegion, regionAt, regionById, regionsOf,
  readSurface, readMarking, readKind, markingEntry, surfaceEntry, kindEntry,
  regionArea, curbPointsFor,
  DEFAULT_SURFACE,
} from './site.js';
import {
  ensureTerrain, terrainField, groundAt, gradeAt, terrainRange, padWeight,
  raiseTerrain, smoothTerrain, flattenTerrain,
  MIN_BRUSH, MAX_BRUSH,
} from './terrain.js';

const DRAFT_COLOR = 0x7ce0a0;
const SELECT_COLOR = 0xffcf5a;
const BRUSH_COLOR = 0x4da3ff;
const RING_SEGMENTS = 48;

// How fast a drag moves earth, in feet of rise per second at the middle of the
// brush. Six is a second of dragging for a six-foot berm, which is about the
// pace at which you can still see what you are doing.
export const GRADE_RATE = 6;      // ft/s
export const SMOOTH_RATE = 2.2;   // relaxation per second
export const DEFAULT_BRUSH = 60;  // ft
// A stalled frame should cost you the earth it would have moved, not dump a
// crater — the same guard walkthrough.js puts on a step.
const MAX_DT = 0.05;              // s

const SNAP = CELL;
const snap = (v) => Math.round(v / SNAP) * SNAP;

export function initSiteEdit({ getState, renderApi, host }) {
  let tool = null;              // 'site' | null
  let mode = 'region';          // 'region' | 'grade'
  let surf = DEFAULT_SURFACE;
  let mark = null;
  let kind = null;              // Phase 39: what the ground is for
  let brush = DEFAULT_BRUSH;
  let draft = [];               // corners placed so far, world feet
  let hover = null;             // { x, z } — snapped cursor
  let selectedId = 0;
  let grading = null;           // { last, kind } while a grade drag is live
  // The graded ground, for the overlay's own height sampling. Rebuilt whenever
  // the design changes, which is what `refresh()` is for.
  let field = terrainField({ floors: [] });

  const group = new THREE.Group();
  group.renderOrder = 600;
  renderApi.scene.add(group);

  const lineMat = new THREE.LineBasicMaterial({ color: DRAFT_COLOR, depthTest: false, transparent: true });
  const rubberMat = new THREE.LineBasicMaterial({
    color: DRAFT_COLOR, depthTest: false, transparent: true, opacity: 0.55,
  });
  const outlineMat = new THREE.LineBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true });
  const brushMat = new THREE.LineBasicMaterial({
    color: BRUSH_COLOR, depthTest: false, transparent: true, opacity: 0.8,
  });

  const draftLine = new THREE.Line(new THREE.BufferGeometry(), lineMat);
  const rubberLine = new THREE.Line(new THREE.BufferGeometry(), rubberMat);
  const outline = new THREE.Line(new THREE.BufferGeometry(), outlineMat);
  const brushRing = new THREE.Line(new THREE.BufferGeometry(), brushMat);
  for (const l of [draftLine, rubberLine, outline, brushRing]) {
    l.frustumCulled = false;
    l.renderOrder = 601;
    l.visible = false;
    group.add(l);
  }

  // Everything on the overlay floats a little above the ground it describes,
  // so an outline drawn across a berm follows the berm.
  const LIFT = 0.9;
  const yAt = (x, z) => groundAt(field, x, z) + LIFT;

  function setLine(line, pts, closed) {
    if (!pts || pts.length < 2) { line.visible = false; return; }
    const arr = [];
    for (const p of pts) arr.push(p.x, yAt(p.x, p.z), p.z);
    if (closed) arr.push(pts[0].x, yAt(pts[0].x, pts[0].z), pts[0].z);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    line.visible = true;
  }

  function setRing(line, cx, cz, r) {
    const arr = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      arr.push(x, yAt(x, z), z);
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    line.visible = true;
  }

  // ---------- overlay ----------

  function refresh() {
    field = terrainField(getState());
    if (!tool) {
      for (const l of [draftLine, rubberLine, outline, brushRing]) l.visible = false;
      return;
    }
    if (mode === 'region') {
      brushRing.visible = false;
      setLine(draftLine, draft, false);
      if (draft.length && hover) setLine(rubberLine, [draft[draft.length - 1], hover], false);
      else rubberLine.visible = false;
      const sel = selectedId ? regionById(getState(), selectedId) : null;
      if (sel && !draft.length) setLine(outline, sel.pts, true);
      else outline.visible = false;
    } else {
      draftLine.visible = rubberLine.visible = outline.visible = false;
      if (hover) setRing(brushRing, hover.x, hover.z, brush);
      else brushRing.visible = false;
    }
  }

  // ---------- region drawing ----------

  const near = (a, b, tol) => Math.hypot(a.x - b.x, a.z - b.z) <= tol;

  function commitDraft() {
    if (draft.length < 3) { draft = []; refresh(); return; }
    host.pushUndo();
    const region = addRegion(getState(), draft, { surf, mark, kind });
    draft = [];
    if (!region) {
      host.dropUndo();
      host.status('That region is too small, or the site is full — nothing added.');
      refresh();
      return;
    }
    selectedId = region.id;
    host.changed();
    const entry = surfaceEntry(region.surf);
    const m = region.mark ? markingEntry(region.mark) : null;
    const k = region.kind ? kindEntry(region.kind) : null;
    const curbs = k ? curbPointsFor(region).length : 0;
    host.status(`${entry.label}${m ? ` · ${m.label}` : ''}` +
      `${k ? ` · ${k.label}, ${curbs} curb point${curbs === 1 ? '' : 's'}` : ''}` +
      ` — ${Math.round(regionArea(region)).toLocaleString()} ft².`);
    refresh();
  }

  function cancelDraft() {
    if (!draft.length) return false;
    draft = [];
    refresh();
    return true;
  }

  function regionPointerDown(p, e) {
    const pt = e && e.altKey ? { x: p.x, z: p.z } : { x: snap(p.x), z: snap(p.z) };
    if (draft.length >= 3 && near(pt, draft[0], SNAP)) { commitDraft(); return; }
    if (!draft.length) {
      // An empty draft means a click is a selection, not the first corner —
      // unless there is nothing under it, in which case it's the first corner.
      const hit = regionAt(getState(), p.x, p.z);
      if (hit && hit.id !== selectedId) {
        selectedId = hit.id;
        const entry = surfaceEntry(hit.surf);
        host.status(`${hit.name || entry.label} — ${Math.round(regionArea(hit)).toLocaleString()} ft². ` +
          'Delete removes it; the panel restyles it.');
        refresh();
        return;
      }
      selectedId = 0;
    }
    draft.push(pt);
    refresh();
  }

  // ---------- grading ----------

  function gradeStep(p, e, dt) {
    const s = getState();
    const t = ensureTerrain(s);
    let changed = false;
    if (e && e.altKey) changed = smoothTerrain(t, p.x, p.z, brush, SMOOTH_RATE * dt);
    else changed = raiseTerrain(t, p.x, p.z, brush, GRADE_RATE * dt * (e && e.shiftKey ? -1 : 1));
    if (!changed) return false;
    field = terrainField(s);
    return true;
  }

  // The pad is derived from the footprint, so grading under the building moves
  // the heightfield and changes nothing you can see. Saying so once, when the
  // drag starts, is the difference between a rule and a bug.
  function padded(p) {
    return padWeight(terrainField(getState()), p.x, p.z) < 0.02;
  }

  function gradeReadout(p) {
    const r = terrainRange(field);
    const g = gradeAt(field, p.x, p.z);
    const h = groundAt(field, p.x, p.z);
    return `Grade — ${h >= 0 ? '+' : ''}${h.toFixed(1)}ft here, ${g.pct.toFixed(0)}% slope · ` +
      `site relief ${r.relief.toFixed(1)}ft. Shift lowers, Alt smooths.`;
  }

  // ---------- pointer ----------

  function pointerDown(p, e) {
    if (!tool) return;
    if (mode === 'region') { regionPointerDown(p, e); return; }
    if (padded(p)) {
      host.status('The building holds its own pad — the ground under a slab stays at datum. ' +
        'Grade outside the walls.');
      return;
    }
    host.pushUndo();
    grading = { last: performance.now(), moved: false };
    if (gradeStep(p, e, 0.06)) { grading.moved = true; host.changed({ throttled: true }); }
    hover = { x: p.x, z: p.z };
    refresh();
  }

  function pointerMove(p, e) {
    if (!tool) return;
    hover = mode === 'region' && !(e && e.altKey)
      ? { x: snap(p.x), z: snap(p.z) }
      : { x: p.x, z: p.z };
    if (grading) {
      const now = performance.now();
      const dt = Math.min(MAX_DT, Math.max(0, (now - grading.last) / 1000));
      grading.last = now;
      if (dt > 0 && gradeStep(p, e, dt)) {
        grading.moved = true;
        host.changed({ throttled: true });
        host.status(gradeReadout(p));
      }
    } else if (mode === 'grade') {
      host.status(gradeReadout(p));
    }
    refresh();
  }

  function pointerUp() {
    if (!grading) return false;
    const moved = grading.moved;
    grading = null;
    if (!moved) { host.dropUndo(); return true; }
    host.changed({ commit: true });
    refresh();
    return true;
  }

  function key(e) {
    if (!tool) return false;
    if (mode === 'region') {
      if (e.code === 'Escape') { if (cancelDraft()) return true; selectedId = 0; refresh(); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (draft.length < 3) return false;
        commitDraft();
        return true;
      }
      if (e.code === 'Backspace' && draft.length) { draft.pop(); refresh(); return true; }
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedId && !draft.length) {
        host.pushUndo();
        if (!removeRegion(getState(), selectedId)) { host.dropUndo(); return false; }
        selectedId = 0;
        host.changed();
        host.status('Region deleted.');
        refresh();
        return true;
      }
    }
    // Level the ground under the brush — the one grading operation that isn't
    // a drag, because "make this flat" has a target rather than a rate.
    if (mode === 'grade' && e.code === 'KeyL' && hover) {
      host.pushUndo();
      if (!flattenTerrain(ensureTerrain(getState()), hover.x, hover.z, brush, null, 0.8)) {
        host.dropUndo();
        return false;
      }
      host.changed({ commit: true });
      host.status('Levelled to the mean under the brush.');
      refresh();
      return true;
    }
    return false;
  }

  // ---------- panel plumbing ----------

  // Restyling a selected region is the same act as choosing what the next one
  // will be, which is why one panel does both and why this returns whether it
  // actually changed anything.
  function applyStyle() {
    const region = selectedId ? regionById(getState(), selectedId) : null;
    if (!region) return false;
    if (region.surf === surf && (region.mark || null) === mark
      && (region.kind || null) === kind) return false;
    host.pushUndo();
    region.surf = surf;
    region.mark = mark;
    // The kind is a key only while it says something — see `makeRegion`, and
    // the save promise both are keeping.
    if (kind) region.kind = kind;
    else delete region.kind;
    host.changed();
    refresh();
    return true;
  }

  function setTool(t) {
    const next = t === 'site' ? 'site' : null;
    if (next !== tool) { draft = []; hover = null; grading = null; selectedId = 0; }
    tool = next;
    refresh();
  }

  return {
    setTool,
    get tool() { return tool; },
    get mode() { return mode; },
    setMode(m) {
      const next = m === 'grade' ? 'grade' : 'region';
      if (next === mode) return;
      mode = next;
      draft = [];
      grading = null;
      refresh();
    },
    get surface() { return surf; },
    get marking() { return mark; },
    get kind() { return kind; },
    setStyle(nextSurf, nextMark, nextKind) {
      if (nextSurf !== undefined) surf = readSurface(nextSurf) || DEFAULT_SURFACE;
      if (nextMark !== undefined) mark = readMarking(nextMark);
      if (nextKind !== undefined) kind = readKind(nextKind);
      return applyStyle();
    },
    get brush() { return brush; },
    setBrush(v) {
      brush = Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, Math.round(Number(v) || DEFAULT_BRUSH)));
      refresh();
    },
    // The selection is held by id and re-resolved per use — a region can
    // vanish under the tool (undo, a loaded file), the same rule every other
    // selection in this build follows.
    get selected() { return selectedId ? regionById(getState(), selectedId) : null; },
    get regionCount() { return regionsOf(getState()).length; },
    get relief() { return terrainRange(terrainField(getState())).relief; },
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    clearHover() { hover = null; refresh(); },
  };
}
