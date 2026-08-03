// Line of sight, in plan view.
//
// The 3D game does this with a raycast against the actual furniture meshes
// (systems/tells.js). This is the same question asked on paper, so the seating
// chart can answer it for twelve desks at once without a renderer — and so it
// can be tested headlessly. The occluders are floor-to-above-eye-height boxes,
// so the horizontal problem is the whole problem: if the segment crosses the
// rectangle, the raycast would have hit it too.

// Segment (ax,az)->(bx,bz) against an axis-aligned rectangle. Slab method.
export function segmentHitsRect(ax, az, bx, bz, rect) {
  const dx = bx - ax, dz = bz - az;
  const minX = rect.x - rect.halfW, maxX = rect.x + rect.halfW;
  const minZ = rect.z - rect.halfD, maxZ = rect.z + rect.halfD;

  let t0 = 0, t1 = 1;
  for (const [p, lo, hi, d] of [[ax, minX, maxX, dx], [az, minZ, maxZ, dz]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;      // parallel and outside the slab
      continue;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

export function hasLineOfSight(from, to, rects) {
  for (const r of rects) if (segmentHitsRect(from.x, from.z, to.x, to.z, r)) return false;
  return true;
}

// How many of the places you actually stand can see this point.
export function classifySight(point, viewpoints, rects) {
  const from = viewpoints.filter(v => hasLineOfSight(v, point, rects));
  const kind = from.length === viewpoints.length ? 'clear' : from.length ? 'partial' : 'blind';
  return { kind, from: from.map(v => v.id), count: from.length, of: viewpoints.length };
}

// Occluder records in room.json carry size + a plan position; the chart and the
// world both want them as rectangles.
export function occluderRects(occluders) {
  return occluders.map(o => ({
    id: o.id, label: o.label,
    x: o.pos[0], z: o.pos[1],
    halfW: o.size[0] / 2, halfD: o.size[2] / 2
  }));
}
