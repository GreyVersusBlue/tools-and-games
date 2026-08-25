// minimap.js — where you are, on the plan, while you are walking.
//
// The wishlist asks for "a minimap while walking, from the blueprint renderer
// at thumbnail size", and that is exactly the arrangement: blueprint.js
// already computes a floor plan in world feet with no canvas in sight, and
// already knows how to draw one into a 2D context. Nothing about either needs
// to change. What was missing is the little bit of arithmetic between them —
// which patch of the plan a walker can see, how many pixels to the foot that
// is, and which way is up — and that is all this file is.
//
// Two modes, because the two questions a minimap answers are different ones:
//
//   fit    — the whole storey in the corner, you as a dot on it. "Where am I
//            in the building?"
//   follow — a fixed window of feet around you, at a readable scale. "What is
//            around this corner?"
//
// ...and two orientations. North-up keeps the plan the way the printed sheet
// has it, which is what somebody who has been editing the plan expects.
// Heading-up turns the map instead of the reader, which is what somebody who
// is lost expects. Both are one rotation in `worldToMini`, so nothing
// downstream has to know which is on.
//
// Everything here is pure: bounds in, pixels out, no canvas, no three.js.

export const MODES = ['fit', 'follow'];
export const ORIENTS = ['north', 'heading'];

// The default thumbnail, in CSS pixels, and the window it shows in follow
// mode. 90ft across is about three classrooms — far enough to see the end of
// a corridor, near enough that a door is still a door.
export const MINI_SIZE = 168;
export const MINI_RANGE = 90;
export const MIN_RANGE = 20;
export const MAX_RANGE = 400;

// A little air around a fitted plan, so the outermost wall isn't drawn on the
// bezel.
export const FIT_PAD = 6; // ft

// What the camera can see, drawn as a wedge on the map: the walkthrough's own
// field of view, and how far down it the wedge is worth drawing.
export const CONE_FOV = 60 * Math.PI / 180;
export const CONE_LEN = 34; // ft

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, f = 0) => (Number.isFinite(v) ? v : f);

export const nextMode = (mode) => (mode === 'fit' ? 'follow' : 'fit');
export const nextOrient = (o) => (o === 'north' ? 'heading' : 'north');

// The centre of a follow window, held inside the plan so that walking to a
// corner of the building doesn't leave three quarters of the map empty. When
// the plan is *smaller* than the window in an axis, it is centred on that
// axis instead — clamping there would push the building off-centre for no
// gain.
export function clampCentre(bounds, x, z, halfW, halfH) {
  const planW = bounds.maxX - bounds.minX;
  const planH = bounds.maxZ - bounds.minZ;
  const cx = planW <= halfW * 2
    ? (bounds.minX + bounds.maxX) / 2
    : clamp(x, bounds.minX + halfW, bounds.maxX - halfW);
  const cz = planH <= halfH * 2
    ? (bounds.minZ + bounds.maxZ) / 2
    : clamp(z, bounds.minZ + halfH, bounds.maxZ - halfH);
  return { cx, cz };
}

// The transform, worked out once a frame. `bounds` is a plan's own bounds
// from blueprint.js; `eye` is where the camera is and which way it faces.
export function minimapView(bounds, eye = {}, opts = {}) {
  const size = Math.max(48, num(opts.size, MINI_SIZE));
  const mode = MODES.includes(opts.mode) ? opts.mode : 'follow';
  const orient = ORIENTS.includes(opts.orient) ? opts.orient : 'heading';
  const b = bounds && Number.isFinite(bounds.minX)
    ? bounds
    : { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  const yaw = num(eye.yaw);
  // Heading-up turns the *map*: rotating mini-space by the camera's own yaw
  // is what sends the direction it is looking to straight up the thumbnail.
  // (Worth the one line of derivation: forward is (-sin y, -cos y) in plan
  // coordinates, and rotating that by y gives (0, -1), which is up.)
  const rotation = orient === 'heading' ? yaw : 0;

  if (mode === 'fit') {
    const w = Math.max(1e-6, b.maxX - b.minX + FIT_PAD * 2);
    const h = Math.max(1e-6, b.maxZ - b.minZ + FIT_PAD * 2);
    // A rotated plan needs the diagonal to fit, or a heading-up fit clips its
    // own corners every time you turn 45 degrees.
    const span = orient === 'heading' ? Math.hypot(w, h) : Math.max(w, h);
    return {
      size, mode, orient, rotation,
      scale: size / span,
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      range: span,
      bounds: b,
    };
  }

  const range = clamp(num(opts.range, MINI_RANGE), MIN_RANGE, MAX_RANGE);
  const scale = size / range;
  const half = range / 2;
  // A turning map has no fixed edges to clamp against, so it doesn't clamp —
  // it stays centred on the walker, which is the whole point of heading-up.
  const c = orient === 'heading'
    ? { cx: num(eye.x), cz: num(eye.z) }
    : clampCentre(b, num(eye.x), num(eye.z), half, half);
  return { size, mode, orient, rotation, scale, cx: c.cx, cz: c.cz, range, bounds: b };
}

// World feet to thumbnail pixels. The plan's z axis runs down the map, the
// same way blueprint.js draws it, so a room north of you is above you.
export function worldToMini(view, x, z) {
  const dx = num(x) - view.cx;
  const dz = num(z) - view.cz;
  const c = Math.cos(view.rotation), s = Math.sin(view.rotation);
  return {
    x: view.size / 2 + (dx * c - dz * s) * view.scale,
    y: view.size / 2 + (dx * s + dz * c) * view.scale,
  };
}

// ...and back, for a click on the map.
export function miniToWorld(view, px, py) {
  const dx = (num(px) - view.size / 2) / view.scale;
  const dy = (num(py) - view.size / 2) / view.scale;
  const c = Math.cos(-view.rotation), s = Math.sin(-view.rotation);
  return {
    x: view.cx + (dx * c - dy * s),
    z: view.cz + (dx * s + dy * c),
  };
}

// Is this worth drawing? Cheap enough to ask per prop, which is what it is
// for — a thousand desks on a storey, twenty of them near the walker.
export function inView(view, x, z, pad = 0) {
  const p = worldToMini(view, x, z);
  const r = num(pad) * view.scale;
  return p.x >= -r && p.y >= -r && p.x <= view.size + r && p.y <= view.size + r;
}

// The patch of world the thumbnail is showing, as an axis-aligned box. Under
// rotation this is the *bounding* box of what's visible — which is what a
// caller culling plan geometry wants, since drawing a little extra is free
// and missing a wall is not.
export function visibleWindow(view) {
  const corners = [
    miniToWorld(view, 0, 0),
    miniToWorld(view, view.size, 0),
    miniToWorld(view, view.size, view.size),
    miniToWorld(view, 0, view.size),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)),
    maxZ: Math.max(...corners.map((p) => p.z)),
  };
}

// Which way the marker points, in thumbnail radians measured from up. Under
// heading-up this is always zero — the map turned instead — which is exactly
// the property that makes one marker serve both orientations.
export const markerAngle = (view, yaw) => num(yaw) - view.rotation;

// The view cone, as three points in thumbnail pixels: the eye, and the two
// far corners of what the camera can see. Drawn as a translucent wedge, it is
// the one thing that makes a dot on a map read as a person facing somewhere.
export function viewCone(view, eye, opts = {}) {
  const yaw = num(eye.yaw);
  const fov = num(opts.fov, CONE_FOV);
  const len = num(opts.length, CONE_LEN);
  const at = worldToMini(view, num(eye.x), num(eye.z));
  const arm = (a) => {
    // Forward is (-sin, -cos); the two arms are that heading plus and minus
    // half the field of view. Turning *up* in yaw swings the heading toward
    // -x, which is the camera's own left — so the names below are the
    // camera's left and right, not the signs' order.
    const dx = -Math.sin(a) * len, dz = -Math.cos(a) * len;
    return worldToMini(view, num(eye.x) + dx, num(eye.z) + dz);
  };
  return { at, left: arm(yaw + fov / 2), right: arm(yaw - fov / 2), len, fov };
}

// The scale bar's own arithmetic: the roundest number of feet that fits in
// about a third of the thumbnail, and how many pixels that is. Without one, a
// minimap in follow mode is a picture with no idea how big anything is.
export function scaleBar(view, fraction = 0.34) {
  const want = (view.size * clamp(num(fraction, 0.34), 0.1, 0.9)) / view.scale;
  const steps = [5, 10, 20, 25, 50, 100, 200, 500, 1000];
  let ft = steps[0];
  for (const s of steps) if (s <= want) ft = s;
  return { ft, px: ft * view.scale, label: `${ft} ft` };
}

// One line for the HUD, so the walk readout can say what the map is doing
// without main.js assembling the sentence.
export function describeMinimap(view) {
  if (!view) return '';
  const how = view.mode === 'fit' ? 'whole floor' : `${Math.round(view.range)} ft across`;
  return `${how} · ${view.orient === 'heading' ? 'heading up' : 'north up'}`;
}

// ---------- the findings, on the map ----------
//
// Phase 10's smallest item and its most visible. The report has sorted its
// findings worst-first since Phase 7 and every one of them that is about
// somewhere carries the room ids it is about; this map has drawn a floor plan
// at thumbnail size since Phase 9. They had never met. A finding carrying a
// room id is a highlight on the plan in your hand — *this* corridor is the one
// over the travel limit, *that* door is the one too narrow — and the whole of
// the arithmetic is deciding which of its rooms are on the storey you are
// standing on.
//
// Nothing here draws: it turns a report into marks, and main.js fills the
// rectangles `navmesh.js` already cut the rooms into. Which is the second
// reason this item goes here rather than last — a highlight is the fastest way
// to see whether the mesh actually fixed the numbers.

// A wash over the plan, and a line round it. Alpha low enough that the walls
// underneath stay legible: this is an annotation on a drawing, not a heatmap.
export const MARK_FILL = {
  fail: 'rgba(211, 74, 65, 0.30)',
  warn: 'rgba(226, 150, 55, 0.28)',
  note: 'rgba(70, 130, 210, 0.24)',
  ok: 'rgba(74, 160, 110, 0.20)',
};
export const MARK_LINE = {
  fail: 'rgba(176, 44, 36, 0.95)',
  warn: 'rgba(186, 112, 22, 0.95)',
  note: 'rgba(40, 96, 170, 0.9)',
  ok: 'rgba(44, 120, 78, 0.9)',
};
export const markFill = (level) => MARK_FILL[level] || MARK_FILL.note;
export const markLine = (level) => MARK_LINE[level] || MARK_LINE.note;

// Every finding that points at somewhere on the plan, in the order the report
// sorted them — worst first. A finding with nothing to point at (three exits
// where four are needed; a building with no way out at all) is not a mark: it
// is about the design rather than about a place in it, and drawing it
// somewhere would be inventing a location the report never claimed.
export function findingMarks(report) {
  const out = [];
  for (const f of (report && report.findings) || []) {
    const rooms = (f.rooms || [])
      .filter((r) => r && r.id)
      .map((r) => ({ id: r.id, floor: r.floor ?? 0, name: r.name || null }));
    const doors = [...(f.doors || []), ...(f.exits || [])]
      .filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.z))
      .map((d) => ({ id: d.id, floor: d.floor ?? 0, x: d.x, z: d.z, w: d.w }));
    if (!rooms.length && !doors.length) continue;
    out.push({
      code: f.code,
      section: f.section || null,
      level: f.level,
      title: f.title,
      detail: f.detail,
      rooms,
      doors,
      floors: [...new Set([...rooms, ...doors].map((t) => t.floor))].sort((a, b) => a - b),
    });
  }
  return out;
}

// The mark at an index, wrapping in both directions — so a next button at the
// end of the list goes back to the worst finding rather than stopping.
export function markAt(marks, i) {
  if (!marks || !marks.length) return null;
  const n = marks.length;
  return marks[((i % n) + n) % n];
}

// What of a mark is on the storey being drawn.
export function markOnFloor(mark, floorIndex) {
  if (!mark) return { rooms: [], doors: [] };
  return {
    rooms: mark.rooms.filter((r) => r.floor === floorIndex),
    doors: mark.doors.filter((d) => d.floor === floorIndex),
  };
}

// The caption under the thumbnail: which finding, out of how many, and — when
// none of it is on this storey — where to go to see it.
export function describeMark(marks, index, floorIndex) {
  const mark = markAt(marks, index);
  if (!mark) return '';
  const n = marks.length;
  const here = markOnFloor(mark, floorIndex);
  const at = here.rooms.length + here.doors.length;
  const where = at
    ? `${at} here`
    : (mark.floors.length
      ? `none on this level — try Level ${mark.floors[0] + 1}`
      : 'nowhere on the plan');
  const i = ((index % n) + n) % n;
  return `${i + 1}/${n} · ${mark.title} (${where})`;
}
