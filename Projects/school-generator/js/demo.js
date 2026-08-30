// demo.js — a tool's own gesture, played back on the live canvas.
//
// Phase 30's fourth item, and an old idea with a new reason to be cheap:
// `test/tools/run.mjs` has been driving the twelve tools with scripted pointer
// events since Phase 26 — a press, a path, a release, aimed at world points
// projected through the live edit camera. That machinery is a *tutorial* with
// the labels filed off. This module aims it at teaching instead of testing.
//
// The claim the phase makes about it — "a tutorial that cannot rot, because it
// *is* the smoke test" — is only true if something checks it, so every demo
// here declares `changes`: the delta it should leave in the tools harness's
// own fingerprint. The `show-me` check in run.mjs plays each one on the real
// page and asserts exactly that. A tool that stops answering the gesture fails
// CI in the same run as the tool's own check, which is the whole point: the
// lesson and the test are one artifact.
//
// Three things this module is careful about:
//
//   **It knows nothing about pixels.** Every coordinate is world feet, offset
//   from a spot the design chooses (`demoSpot`) — so a demo draws in clear
//   floor whatever is already on the sheet, and the shell's job is only to
//   project feet to pixels, which it already does for every tool.
//
//   **It is a script, not a player.** `demoEvents` compiles a demo into a flat
//   list of timed events, deterministic to the millisecond. Nothing here waits
//   for anything, holds a timer, or touches a canvas; the shell walks the list
//   and the suite reads it.
//
//   **Each demo is a whole scene.** A demo that needed the *previous* demo's
//   room would be a lesson you can only take in one order. Every one below
//   lays whatever it needs first, and the changes it claims are the changes
//   the whole scene makes.
//
// Pure module: no three.js, no DOM. Exercised by test/demo.test.mjs.

import { shapesOf, shapeBBox } from './shapes.js';
import { CELL } from './grid.js';

// ---------- the timings ----------

// How far the ghost travels between two samples, and how long a sample lasts.
// The harness moves in waypoints at 140ms; a person watching wants something
// nearer a real hand, and the editor rebuilds on every sample, so this is the
// slowest thing that still reads as a gesture rather than a slideshow.
export const STEP_FT = 5;
export const SAMPLE_MS = 55;
// A press and a release are held long enough to be seen as a click rather
// than as a stutter in the path.
export const PRESS_MS = 130;
export const RELEASE_MS = 160;
// After a gesture completes, the pause before the next sentence — the editor
// is baking, and the lesson is what appears when it finishes.
export const SETTLE_MS = 420;
// How long a sentence holds the demo before the next thing happens. A lesson
// is paced by its own words, not by a fixed beat: the sentence that explains
// what just baked is the longest one in the demo and needs the longest look at
// it. Roughly 400 words a minute, floored at a full second and capped at five
// so a long sentence cannot stall a playback somebody is watching.
export const SAY_BASE_MS = 900;
export const SAY_PER_CHAR_MS = 28;
export const SAY_MAX_MS = 5000;
export const sayMs = (text) =>
  Math.min(SAY_MAX_MS, SAY_BASE_MS + String(text || '').length * SAY_PER_CHAR_MS);

// ---------- where a demo draws ----------

// A demo has to land on floor nobody has drawn on, on a sheet that may be
// covered. This walks the storey in cell-sized steps looking for a clear
// `w × d` box (in feet), tested against room bounding boxes rather than their
// outlines — conservative on purpose: a box that merely *might* overlap a room
// is not a box a lesson should draw in.
//
// Falls back to just off the east edge of everything drawn, which is always
// clear and which the sheet grows to cover — growing is always safe, and
// shrinking is the move that clips a room (see footprint.js).
export const DEMO_MARGIN = 8;      // ft of air between the lesson and the building

export function demoSpot(state, w = 40, d = 32, floor = null) {
  const idx = floor === null || floor === undefined
    ? (state && Number.isInteger(state.currentFloor) ? state.currentFloor : 0)
    : floor;
  const f = state && Array.isArray(state.floors) ? state.floors[idx] : null;
  const boxes = shapesOf(f).map(shapeBBox);
  const sheetW = f && f.w > 0 ? f.w * CELL : 0;
  const sheetH = f && f.h > 0 ? f.h * CELL : 0;
  const clear = (x, z) => !boxes.some((b) =>
    x < b.x1 + DEMO_MARGIN && x + w > b.x0 - DEMO_MARGIN
    && z < b.z1 + DEMO_MARGIN && z + d > b.z0 - DEMO_MARGIN);

  for (let z = DEMO_MARGIN; z + d <= sheetH - DEMO_MARGIN; z += CELL) {
    for (let x = DEMO_MARGIN; x + w <= sheetW - DEMO_MARGIN; x += CELL) {
      if (clear(x, z)) return { x, z, grown: false };
    }
  }
  // Nowhere on the sheet: east of everything, snapped to the drawing grid so
  // the floor brush lands on cell boundaries rather than a hair off them.
  const east = boxes.length ? Math.max(...boxes.map((b) => b.x1)) : 0;
  const x = Math.ceil((east + DEMO_MARGIN) / CELL) * CELL;
  return { x, z: DEMO_MARGIN, grown: true };
}

// ---------- the demos ----------
//
// Steps are a four-word language, and coordinates are feet from the spot:
//
//   ['say', text]        put a sentence on the status line
//   ['tool', name]       pick a tool, the way the toolbar picks one
//   ['to', dx, dz]       walk the ghost there (a drag, if the button is down)
//   ['down'] ['up']      press and release
//   ['tap', dx, dz]      go there, press, release — one click
//   ['wait', ms]         let the editor finish thinking
//
// `changes` are deltas in the tools harness's fingerprint (`__fp()`), so a
// demo's claim about itself is checkable in the pass that can check it.

export const DEMOS = [
  {
    id: 'floor',
    title: 'the Floor brush',
    blurb: 'Drag a room out in grid tiles — the walls bake themselves',
    changes: { shapes: 1 },
    steps: [
      ['say', 'Floor lays tiles of the drawing grid — 4ft here, finer as you zoom in.'],
      ['tool', 'floor'],
      ['to', 0, 0],
      ['down'],
      ['to', 32, 0],
      ['to', 32, 24],
      ['to', 0, 24],
      ['to', 0, 0],
      ['up'],
      ['wait', SETTLE_MS],
      ['say', 'Let go and it is a room, with walls around it and a number on it. Nothing was placed — it was baked.'],
    ],
  },
  {
    id: 'wall',
    title: 'Wall, then Door',
    blurb: 'Two clicks draw a wall; one more cuts a door through it',
    changes: { walls: 2, lineOpenings: 1 },
    steps: [
      ['say', 'Wall draws point to point. Click a start, click an end.'],
      ['tool', 'wall'],
      ['tap', 0, 8],
      ['tap', 36, 8],
      ['wait', SETTLE_MS],
      ['say', 'Again from there — a wall run is as many clicks as you like.'],
      ['tap', 36, 32],
      ['wait', SETTLE_MS],
      ['say', 'Door cuts an opening into whatever wall you click.'],
      ['tool', 'door'],
      ['tap', 18, 8],
      ['wait', SETTLE_MS],
      ['say', 'The leaf hangs on the jamb the wall run decided. Ctrl+Z takes any of it back.'],
    ],
  },
  {
    id: 'prop',
    title: 'Furniture',
    blurb: 'Lay a room, then put something in it',
    changes: { shapes: 1, props: 1 },
    steps: [
      ['say', 'A room first — Floor, one drag.'],
      ['tool', 'floor'],
      ['to', 0, 0],
      ['down'],
      ['to', 28, 0],
      ['to', 28, 20],
      ['to', 0, 20],
      ['to', 0, 0],
      ['up'],
      ['wait', SETTLE_MS],
      ['say', 'Now Furniture: pick a piece from the palette and click clear floor.'],
      ['tool', 'prop'],
      ['tap', 14, 10],
      ['wait', SETTLE_MS],
      ['say', 'It snaps to the wall it is near, and it is solid the moment you walk in. Ctrl+Z takes it back.'],
    ],
  },
];

export const DEMO_IDS = DEMOS.map((d) => d.id);
export const demoById = (id) => DEMOS.find((d) => d.id === id) || null;

// ---------- compiling one ----------

export const EVENT_KINDS = ['say', 'tool', 'move', 'down', 'up'];

// A demo plus a spot, as a flat list of `{ t, kind, ... }` in ascending `t`.
// Deterministic to the millisecond: the same demo at the same spot compiles to
// the same list every time, which is what lets a suite read it instead of
// watching it.
//
// Moves are sampled along each leg at `STEP_FT`, because the editor's tools
// read a drag as the path it was given — a brush handed two endpoints paints
// two tiles, not the line between them. Same reason the harness walks its
// waypoints.
export function demoEvents(demo, spot = { x: 0, z: 0 }) {
  const d = typeof demo === 'string' ? demoById(demo) : demo;
  if (!d || !Array.isArray(d.steps)) return { id: null, duration: 0, events: [] };
  const ox = spot && Number.isFinite(spot.x) ? spot.x : 0;
  const oz = spot && Number.isFinite(spot.z) ? spot.z : 0;

  const events = [];
  let t = 0;
  let at = null;               // where the ghost is, in world feet

  const moveTo = (x, z) => {
    if (!at) {
      // The first position is a jump, not a journey: the ghost has to appear
      // somewhere, and sliding it in from the origin would draw a line
      // through whatever it crossed.
      at = { x, z };
      events.push({ t, kind: 'move', x, z });
      t += SAMPLE_MS;
      return;
    }
    const dist = Math.hypot(x - at.x, z - at.z);
    const steps = Math.max(1, Math.ceil(dist / STEP_FT));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      events.push({ t, kind: 'move', x: at.x + (x - at.x) * k, z: at.z + (z - at.z) * k });
      t += SAMPLE_MS;
    }
    at = { x, z };
  };

  for (const step of d.steps) {
    const [verb, a, b] = step;
    if (verb === 'say') {
      events.push({ t, kind: 'say', text: String(a) });
      t += sayMs(a);
      continue;
    }
    if (verb === 'tool') { events.push({ t, kind: 'tool', tool: String(a) }); t += SAMPLE_MS; continue; }
    if (verb === 'wait') { t += Math.max(0, Number(a) || 0); continue; }
    if (verb === 'to') { moveTo(ox + a, oz + b); continue; }
    if (verb === 'down') { events.push({ t, kind: 'down', x: at.x, z: at.z }); t += PRESS_MS; continue; }
    if (verb === 'up') { events.push({ t, kind: 'up', x: at.x, z: at.z }); t += RELEASE_MS; continue; }
    if (verb === 'tap') {
      moveTo(ox + a, oz + b);
      events.push({ t, kind: 'down', x: at.x, z: at.z });
      t += PRESS_MS;
      events.push({ t, kind: 'up', x: at.x, z: at.z });
      t += RELEASE_MS;
      continue;
    }
    throw new Error(`demo ${d.id}: no such step "${verb}"`);
  }
  return { id: d.id, duration: t, events };
}

// The last sentence a demo says at or before `t` — what the status line should
// be showing at any moment of a playback, including one somebody scrubbed or
// interrupted.
export function sayAt(plan, t) {
  let said = '';
  for (const e of plan.events) {
    if (e.t > t) break;
    if (e.kind === 'say') said = e.text;
  }
  return said;
}

// Where the ghost is at `t`, and whether the button is down. The shell drives
// off the event list rather than this, but a suite that wants to ask "is the
// pointer inside the room it just drew" needs an answer that does not depend
// on having watched.
export function ghostAt(plan, t) {
  let pos = null, down = false;
  for (const e of plan.events) {
    if (e.t > t) break;
    if (e.kind === 'move' || e.kind === 'down' || e.kind === 'up') {
      if (Number.isFinite(e.x)) pos = { x: e.x, z: e.z };
    }
    if (e.kind === 'down') down = true;
    if (e.kind === 'up') down = false;
  }
  return { pos, down, done: t >= plan.duration };
}

// The box a demo will draw in, so the shell can grow the sheet to cover it
// before the first tile lands. Read off the compiled events rather than off
// the steps, which means it cannot disagree with what actually happens.
export function demoBounds(plan) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const e of plan.events) {
    if (!Number.isFinite(e.x)) continue;
    x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x);
    z0 = Math.min(z0, e.z); z1 = Math.max(z1, e.z);
  }
  return Number.isFinite(x0) ? { x0, z0, x1, z1 } : null;
}

// The palette rows, in one place so the command palette and any future menu
// name them the same way.
export const demoCommands = () => DEMOS.map((d) => ({
  id: d.id,
  name: `Show me: ${d.title}`,
  hint: d.blurb,
}));
