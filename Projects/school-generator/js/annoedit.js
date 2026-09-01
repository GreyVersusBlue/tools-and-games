// annoedit.js — the Annotate tool: dimensions and notes onto the sheet.
//
// Same split as every other tool in this codebase: the arithmetic is in
// annotate.js and headless, this file is the pointer stream and the lines
// that make the records visible while the tool is up. The *printed* face of
// an annotation is blueprint.js's; what is drawn here is the editor's working
// view — geometry without the text, the way the section tool shows its lines
// without their letters, with the number riding the status line instead.
//
// Three modes, because the phase has three gestures:
//
//   dim     three clicks: one anchor, the other anchor, then where the line
//           stands. Anchors snap through snapgrid.js — the same pitch, the
//           same origin (Phase 35's reference point honoured) as every other
//           point-target tool — because a dimension that misses the wall it
//           measures by half a foot prints a number nobody trusts.
//   note    two clicks: the point, then where its sentence sits. The sentence
//           itself comes from the panel — a dialog is not a tool's job.
//   chain   one click on a wall: its piers and openings come out dimensioned
//           end to end, jamb to jamb, standing on the side you clicked from.
//
// In any mode, a click on an existing annotation selects it instead: a note
// drags by its text, a dimension drags its offset, Delete removes either.
// Selection lives here and dies with the tool — the records go in the file.

import * as THREE from 'three';
import { floorBaseY, activeFloor } from './grid.js';
import { gridPitch, targetPoint, runLabel } from './snapgrid.js';
import { gridOrigin } from './gridref.js';
import { nearestSegment, segEnds, openingsOnSeg } from './shapes.js';
import { wallLineAt, lineEnds, lineOpenings } from './wallrun.js';
import {
  addDim, removeDim, addNote, removeNote, dimsOf, notesOf,
  dimGeometry, dimAt, noteAt, setDimOffset, moveNote, setNoteText,
  chainDims, dimLabel, noteText, DIM_OFF, MAX_DIM_OFF,
} from './annotate.js';

const ANNO_COLOR = 0x4da3ff;
const PICK_COLOR = 0xffffff;
const SEG_GRAB = 1.6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function initAnnoEdit({ getState, renderApi, host }) {
  let tool = null;          // 'anno' | null
  let mode = 'dim';         // 'dim' | 'note' | 'chain'
  // The gesture in progress. A dimension holds up to two anchors before the
  // third click writes the record; a note holds its one point. Tool state,
  // never saved state — dropped by Escape, a tool change or a storey change.
  let anchorA = null;
  let anchorB = null;
  let notePoint = null;
  let hover = null;
  // What the panel's text field will stamp on the next note.
  let draft = 'Note';
  // The selected annotation, and the drag adjusting it. Selection stays in
  // the tool; the record it names is in the file.
  let picked = null;        // { kind: 'dim' | 'note', id }
  let drag = null;          // { kind, moved }

  const group = new THREE.Group();
  group.renderOrder = 610;
  group.visible = false;
  renderApi.scene.add(group);

  const lineMat = new THREE.LineBasicMaterial({
    color: ANNO_COLOR, depthTest: false, transparent: true, opacity: 0.9,
  });
  const pickMat = new THREE.LineBasicMaterial({
    color: PICK_COLOR, depthTest: false, transparent: true, opacity: 0.95,
  });
  const draftMat = new THREE.LineBasicMaterial({
    color: 0xd9a05b, depthTest: false, transparent: true, opacity: 0.95,
  });
  const dotMat = new THREE.MeshBasicMaterial({
    color: ANNO_COLOR, depthTest: false, transparent: true, opacity: 0.9,
  });

  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  const pickedLines = new THREE.LineSegments(new THREE.BufferGeometry(), pickMat);
  const draftLines = new THREE.LineSegments(new THREE.BufferGeometry(), draftMat);
  for (const l of [lines, pickedLines, draftLines]) {
    l.frustumCulled = false;
    l.renderOrder = 611;
    l.visible = false;
    group.add(l);
  }
  const dotGeo = new THREE.CircleGeometry(1, 14);
  dotGeo.rotateX(-Math.PI / 2);
  // Two dots per note (anchor and text spot), and notes cap at 120 a storey.
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, 240);
  dots.renderOrder = 612;
  dots.count = 0;
  group.add(dots);

  const state = () => getState();
  const floor = () => activeFloor(state());
  const baseY = () => floorBaseY(state(), state().currentFloor) + 0.55;
  const pitch = () => gridPitch(renderApi.editView.height);
  const origin = () => gridOrigin(state());
  const grab = () => Math.min(6, Math.max(SEG_GRAB, renderApi.editView.height * 0.012));
  const dotR = () => Math.min(2.4, Math.max(0.25, renderApi.editView.height * 0.006));

  const targetAt = (p, e) => targetPoint(p.x, p.z, {
    pitch: pitch(),
    origin: origin(),
    snap: !(e && e.altKey),
    from: anchorA && !anchorB ? anchorA : null,
    ortho: !!anchorA && !anchorB && !(e && e.shiftKey),
  });

  // The signed perpendicular offset of a cursor from the run a→b — which side
  // the dimension line stands on, and how far.
  function offsetOf(a, b, p) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return DIM_OFF;
    const nx = -dz / len, nz = dx / len;
    return clamp((p.x - a.x) * nx + (p.z - a.z) * nz, -MAX_DIM_OFF, MAX_DIM_OFF);
  }

  // ---------- the overlay ----------

  function setSegs(mesh, pts) {
    const y = baseY();
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = p.z; });
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    mesh.visible = pts.length > 0;
  }

  const pushDimSegs = (out, g) => {
    out.push(g.ext[0][0], g.ext[0][1], g.ext[1][0], g.ext[1][1]);
    out.push(g.la, g.lb);
    out.push(g.ticks[0][0], g.ticks[0][1], g.ticks[1][0], g.ticks[1][1]);
  };

  function refresh() {
    const on = tool === 'anno';
    group.visible = on;
    if (!on) return;
    const f = floor();
    const plain = [];
    const hot = [];
    const dotPts = [];
    for (const dim of dimsOf(f)) {
      const g = dimGeometry(dim);
      if (!g) continue;
      pushDimSegs(picked && picked.kind === 'dim' && picked.id === dim.id ? hot : plain, g);
    }
    for (const note of notesOf(f)) {
      const sel = picked && picked.kind === 'note' && picked.id === note.id;
      (sel ? hot : plain).push({ x: note.x, z: note.z }, { x: note.tx, z: note.tz });
      dotPts.push(note, { x: note.tx, z: note.tz });
    }
    // The gesture in progress rides its own colour: the anchors so far, and
    // the rubber band to the cursor.
    const dr = [];
    if (anchorA && hover) {
      if (!anchorB) dr.push(anchorA, hover);
      else {
        const g = dimGeometry({
          ax: anchorA.x, az: anchorA.z, bx: anchorB.x, bz: anchorB.z,
          off: offsetOf(anchorA, anchorB, hover),
        });
        if (g) pushDimSegs(dr, g);
      }
    }
    if (notePoint && hover) dr.push(notePoint, hover);
    setSegs(lines, plain);
    setSegs(pickedLines, hot);
    setSegs(draftLines, dr);
    const y = baseY();
    const r = dotR() * 0.5;
    const m = new THREE.Matrix4();
    const n = Math.min(dots.instanceMatrix.count, dotPts.length);
    for (let i = 0; i < n; i++) {
      m.makeScale(r, 1, r);
      m.setPosition(dotPts[i].x, y + 0.01, dotPts[i].z);
      dots.setMatrixAt(i, m);
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
  }

  // ---------- gestures ----------

  const HINTS = {
    dim: 'Dimension — click one anchor, the other, then where the line stands. ' +
      'The number is measured off the anchors, never typed. Esc backs out.',
    note: 'Note — click the point, then where its sentence sits. ' +
      'Type the sentence in the panel; it stays with the selected note.',
    chain: 'Chain — click a wall to dimension its openings and piers end to end, ' +
      'on the side you click from.',
  };

  function select(kind, id, sentence) {
    picked = { kind, id };
    refresh();
    if (host.selectionChanged) host.selectionChanged(selection());
    host.status(sentence);
  }

  function deselect() {
    if (!picked) return false;
    picked = null;
    refresh();
    if (host.selectionChanged) host.selectionChanged(null);
    return true;
  }

  // A click on an existing annotation, in any mode, so the tool that places a
  // thing is also where you take hold of it. Returns true when it claimed the
  // press.
  function pickAt(p) {
    const f = floor();
    const note = noteAt(f, p.x, p.z, grab());
    if (note) {
      host.pushUndo();
      drag = { kind: 'note', moved: false };
      select('note', note.id, `Note — “${note.text}”. Drag moves the sentence, Delete removes it.`);
      return true;
    }
    const dim = dimAt(f, p.x, p.z, grab());
    if (dim) {
      host.pushUndo();
      drag = { kind: 'dim', moved: false };
      select('dim', dim.id,
        `Dimension — ${dimLabel(Math.hypot(dim.bx - dim.ax, dim.bz - dim.az))}. ` +
        'Drag slides the line, Delete removes it.');
      return true;
    }
    return false;
  }

  function placeDim(p) {
    if (!anchorB) return;
    const s = state();
    host.pushUndo();
    const dim = addDim(s, s.currentFloor, anchorA, anchorB, offsetOf(anchorA, anchorB, p));
    anchorA = null;
    anchorB = null;
    if (!dim) {
      host.dropUndo();
      host.status('Those two anchors are on top of each other — nothing to measure.');
      refresh();
      return;
    }
    host.changed({ structural: false, commit: true });
    select('dim', dim.id, `Dimension — ${dimLabel(Math.hypot(dim.bx - dim.ax, dim.bz - dim.az))}, ` +
      'measured off its anchors. It prints with the sheet.');
  }

  function placeNote(p) {
    const s = state();
    host.pushUndo();
    const note = addNote(s, s.currentFloor, notePoint, p.x, p.z, draft);
    notePoint = null;
    if (!note) {
      host.dropUndo();
      host.status('That storey has all the notes it can hold.');
      refresh();
      return;
    }
    host.changed({ structural: false, commit: true });
    select('note', note.id, `Note — “${note.text}”. Edit the sentence in the panel.`);
  }

  // One click on a wall, one chain. The wall is picked the way the door tool
  // picks one — a room's boundary first, then a free-standing line — and the
  // chain stands on the side of the run the click came from.
  function placeChain(p) {
    const s = state();
    const f = floor();
    let a = null, b = null, openings = [];
    const seg = nearestSegment(f, p.x, p.z, grab());
    if (seg) {
      const ring = seg.shape.rings[seg.ring];
      [a, b] = segEnds(ring, seg.seg);
      openings = openingsOnSeg(ring, seg.seg);
    } else {
      const line = wallLineAt(f, p.x, p.z, grab());
      if (line) {
        [a, b] = lineEnds(line.line);
        openings = lineOpenings(line.line);
      }
    }
    if (!a) {
      host.status('Chain — no wall there. Click along a wall you have drawn.');
      return;
    }
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const side = Math.sign((p.x - a.x) * (-dz / len) + (p.z - a.z) * (dx / len)) || 1;
    host.pushUndo();
    const dims = chainDims(s, s.currentFloor, a, b, openings, side * DIM_OFF);
    if (!dims.length) {
      host.dropUndo();
      host.status('Chain — that wall is too short to dimension.');
      return;
    }
    host.changed({ structural: false, commit: true });
    refresh();
    host.status(`Chain — ${dims.length} dimension${dims.length === 1 ? '' : 's'} along a ` +
      `${dimLabel(len)} wall, jamb to jamb. Click one to adjust it, Delete removes it.`);
  }

  function pointerDown(p, e) {
    if (tool !== 'anno') return false;
    hover = { x: p.x, z: p.z };
    // Mid-gesture clicks belong to the gesture; otherwise an existing
    // annotation is first claim on the press.
    if (!anchorA && !notePoint && pickAt(p)) return true;
    if (drag) return true;
    deselect();
    if (mode === 'chain') { placeChain(p); return true; }
    if (mode === 'note') {
      if (!notePoint) {
        notePoint = targetAt(p, e);
        refresh();
        host.status('Note — now click where the sentence should sit.');
        return true;
      }
      placeNote(p);
      return true;
    }
    // mode === 'dim'
    const t = targetAt(p, e);
    if (!anchorA) {
      anchorA = t;
      refresh();
      host.status('Dimension — now click the other anchor.');
      return true;
    }
    if (!anchorB) {
      if (Math.hypot(t.x - anchorA.x, t.z - anchorA.z) < 0.01) { cancel(); return true; }
      anchorB = t;
      refresh();
      host.status(`Dimension — ${runLabel(anchorA, anchorB)}. ` +
        'Now click where the line stands; the side and standoff are yours.');
      return true;
    }
    placeDim(p);
    return true;
  }

  function pointerMove(p, e) {
    if (tool !== 'anno') return false;
    hover = anchorA && !anchorB ? targetAt(p, e) : { x: p.x, z: p.z };
    if (drag && picked) {
      drag.moved = true;
      const f = floor();
      if (picked.kind === 'note') {
        const note = notesOf(f).find((n) => n.id === picked.id);
        if (note) moveNote(note, p.x, p.z);
      } else {
        const dim = dimsOf(f).find((d) => d.id === picked.id);
        if (dim) setDimOffset(dim, offsetOf({ x: dim.ax, z: dim.az }, { x: dim.bx, z: dim.bz }, p));
      }
      host.changed({ structural: false, throttled: true });
      refresh();
      return true;
    }
    refresh();
    if (anchorA && !anchorB && hover) {
      host.status(`Dimension — ${runLabel(anchorA, hover)}. Click to set the other anchor.`);
    }
    return true;
  }

  function pointerUp() {
    if (tool !== 'anno' || !drag) return tool === 'anno';
    const moved = drag.moved;
    drag = null;
    if (moved) host.changed({ structural: false, commit: true });
    else host.dropUndo();
    return true;
  }

  function cancel() {
    const had = anchorA || anchorB || notePoint;
    anchorA = null;
    anchorB = null;
    notePoint = null;
    refresh();
    if (had) host.status(HINTS[mode]);
    return !!had;
  }

  function deleteSelected() {
    if (!picked) return false;
    const s = state();
    host.pushUndo();
    const gone = picked.kind === 'note'
      ? removeNote(s, s.currentFloor, picked.id)
      : removeDim(s, s.currentFloor, picked.id);
    if (!gone) { host.dropUndo(); return false; }
    const what = picked.kind === 'note' ? 'Note' : 'Dimension';
    deselect();
    host.changed({ structural: false, commit: true });
    host.status(`${what} removed.`);
    return true;
  }

  function key(e) {
    if (tool !== 'anno') return false;
    if (e.code === 'Escape') return cancel() || deselect();
    if (e.code === 'Delete' || e.code === 'Backspace') return deleteSelected();
    return false;
  }

  // ---------- what the shell reads and sets ----------

  function selection() {
    if (!picked) return null;
    const f = floor();
    if (picked.kind === 'note') {
      const note = notesOf(f).find((n) => n.id === picked.id);
      return note ? { kind: 'note', id: note.id, text: note.text } : null;
    }
    const dim = dimsOf(f).find((d) => d.id === picked.id);
    return dim
      ? { kind: 'dim', id: dim.id, label: dimLabel(Math.hypot(dim.bx - dim.ax, dim.bz - dim.az)) }
      : null;
  }

  return {
    setTool(t) {
      if (t !== tool) { anchorA = null; anchorB = null; notePoint = null; drag = null; picked = null; }
      tool = t === 'anno' ? 'anno' : null;
      refresh();
    },
    get tool() { return tool; },
    setMode(m) {
      mode = m === 'note' || m === 'chain' ? m : 'dim';
      cancel();
      host.status(HINTS[mode]);
    },
    get mode() { return mode; },
    hint: () => HINTS[mode],
    // The panel's sentence. Applied to the selected note when there is one,
    // and stamped on the next one either way.
    setText(text) {
      draft = noteText(text);
      if (picked && picked.kind === 'note') {
        const note = notesOf(floor()).find((n) => n.id === picked.id);
        if (note && note.text !== draft) {
          host.pushUndo();
          setNoteText(note, draft);
          host.changed({ structural: false, commit: true });
          refresh();
        }
      }
    },
    get text() { return draft; },
    get selection() { return selection(); },
    deleteSelected,
    pointerDown, pointerMove, pointerUp, key,
    refresh,
    clearHover() { hover = null; refresh(); },
  };
}
