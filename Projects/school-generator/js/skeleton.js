// skeleton.js — the straight skeleton of a simple polygon, and the hipped
// roof that stands on it.
//
// roof.js roofs a footprint as greedy rectangles over a 4ft cell mask, and its
// header names the reason: a true pitched roof over an arbitrary polygon is a
// straight skeleton, "a large amount of code to get subtly wrong". This is
// that code, kept pure and apart so it can be checked by arithmetic before
// anything draws it. A curved wall is a run of short chords (shapes.js
// tessellates arcs at authoring time), so a curve reaches this module as an
// ordinary polygon with a lot of vertices.
//
// The method is the wavefront: every edge walks inward at one foot per unit of
// time, and each vertex rides the bisector of its two edges at whatever speed
// keeps it on both. Two things can happen to the shrinking outline, and the
// earliest of them is processed each step:
//
//   * an edge event: an edge's two vertices meet, the edge is gone, and one
//     vertex carries on between the edges either side of it;
//   * a split event: a reflex vertex runs into an edge across the outline,
//     and the outline splits in two there.
//
// Simultaneous events (a rectangle's two ends, a square's four corners, the
// two sides of a wing meeting along its ridge) are not special cases: after
// each step every pair of vertices that now coincide is merged, and an outline
// with no area left is laid down as ridge and retired. Each vertex's path is
// an arc of the skeleton; the roof's faces are the regions those arcs cut the
// polygon into, one per edge, found by walking the planar graph. A vertex's
// time is its height over the eave divided by the pitch, so every face is a
// plane at the stated pitch through its own eave line — which is the property
// the tests check on every face of every shape.
//
// O(n^3) in the vertex count, with all events recomputed after each one. A
// school's top storey is tens of vertices and a 64-chord arc about seventy,
// which is well under a millisecond's worth of arithmetic each; clarity won
// over a priority queue.
//
// Pure module: no three.js, no DOM. Exercised by test/skeleton.test.mjs.

const P2 = (x, z) => ({ x, z });

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
};

const segsCross = (a, b, c, d, eps) => {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
};

// The polygon as the skeleton wants it: finite, counter-clockwise in (x, z)
// (the winding roof.js's faces already use), no repeated points and no vertex
// that does not turn. Returns null for anything that is not a simple polygon
// with area, rather than a roof that is quietly wrong.
//
// `collinear` is the sine of the smallest turn kept. A chord of a curve turns
// by its own angle, which for a 2ft chord on a 400ft radius is still 0.005, so
// the default only removes vertices that are straight to within rounding.
export function cleanPolygon(input, { collinear = 1e-6 } = {}) {
  if (!Array.isArray(input) || input.length < 3) return null;
  let pts = [];
  for (const p of input) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
    pts.push(P2(p.x, p.z));
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  const scale = Math.hypot(x1 - x0, z1 - z0);
  if (!(scale > 0)) return null;
  const eps = scale * 1e-9;
  // Drop repeats (the closing point included) and vertices that do not turn,
  // until nothing changes: removing one can make its neighbour straight.
  for (let changed = true; changed && pts.length >= 3;) {
    changed = false;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = out.length ? out[out.length - 1] : pts[pts.length - 1];
      const cur = pts[i], next = pts[(i + 1) % pts.length];
      const ax = cur.x - prev.x, az = cur.z - prev.z;
      const bx = next.x - cur.x, bz = next.z - cur.z;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la <= eps || lb <= eps) { changed = true; continue; }
      const sin = (ax * bz - az * bx) / (la * lb);
      const cos = (ax * bx + az * bz) / (la * lb);
      // A vertex that turns back on itself (a zero-width spike) is not
      // straight, but it is not a polygon either; the area test refuses it.
      if (Math.abs(sin) < collinear && cos > 0) { changed = true; continue; }
      out.push(cur);
    }
    pts = out;
  }
  if (pts.length < 3) return null;
  const area = signedArea(pts);
  if (Math.abs(area) <= scale * scale * 1e-9) return null;
  if (area < 0) pts.reverse();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n], eps * scale)) return null;
    }
  }
  // Two edges that touch without crossing (a vertex sitting on another edge,
  // a polygon pinched at a point) are just as fatal to a wavefront.
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    for (let j = 0; j < n; j++) {
      if (j === i || (j + 1) % n === i) continue;
      const a = pts[j], b = pts[(j + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2;
      if (t < 0 || t > 1) continue;
      if (Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) <= eps * 10) return null;
    }
  }
  return pts;
}

// The skeleton itself. `nodes` are points with the time (= inset distance) at
// which the wavefront passed them, the polygon's own corners first at time 0;
// `arcs` are pairs of node indices; `faces` are node-index loops, one per
// edge of `poly`, each starting with that edge's two ends. Null when the
// polygon is refused.
export function straightSkeleton(input, opts = {}) {
  const poly = cleanPolygon(input, opts);
  if (!poly) return null;
  const n = poly.length;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  const scale = Math.hypot(x1 - x0, z1 - z0);
  const EPS = scale * 1e-7;        // two points closer than this are one point

  // Each edge's unit direction and inward (left-hand) normal, fixed for good.
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    return { dx, dz, nx: -dz, nz: dx, k: -dz * a.x + dx * a.z };
  });

  const nodes = poly.map((p) => ({ x: p.x, z: p.z, t: 0 }));
  const arcs = [];
  let now = 0;
  const addNode = (x, z) => { nodes.push({ x, z, t: now }); return nodes.length - 1; };

  // A wavefront vertex: where it is now, the node it set out from, and the
  // edges before (eL) and after (eR) it. Its velocity solves v·nL = v·nR = 1.
  const makeVertex = (x, z, node, eL, eR) => {
    const a = edges[eL], b = edges[eR];
    const dot = a.nx * b.nx + a.nz * b.nz;
    const cross = a.dx * b.dz - a.dz * b.dx;
    // Anti-parallel neighbours mean a zero-width spike; the merge pass is
    // supposed to have closed it. Refusing beats an infinite velocity.
    if (1 + dot < 1e-12) throw new Error('skeleton: spike');
    return {
      x, z, node, eL, eR,
      vx: (a.nx + b.nx) / (1 + dot),
      vz: (a.nz + b.nz) / (1 + dot),
      reflex: cross < -1e-12,
    };
  };

  // Edges either side that face each other along one line make a spike of
  // zero width. Its point stands still, and the neighbours either side run
  // into it as an ordinary edge event.
  const vertexOrSpike = (x, z, node, eL, eR) => {
    const a = edges[eL], b = edges[eR];
    if (1 + a.nx * b.nx + a.nz * b.nz < 1e-9) return { x, z, node, eL, eR, vx: 0, vz: 0 };
    return makeVertex(x, z, node, eL, eR);
  };

  let loops = [poly.map((p, i) => makeVertex(p.x, p.z, i, (i - 1 + n) % n, i))];

  // A vertex leaves the wavefront here: its path is an arc of the skeleton.
  const retire = (v) => {
    if (Math.hypot(nodes[v.node].x - v.x, nodes[v.node].z - v.z) <= EPS) return v.node;
    const id = addNode(v.x, v.z);
    arcs.push([v.node, id]);
    return id;
  };

  // Merge every run of coincident neighbours, and lay down any loop that has
  // no area left as ridge. Repeats until nothing changes.
  const settle = () => {
    for (let pass = 0; pass < 4 * n + 8; pass++) {
      let changed = false;
      const next = [];
      for (let loop of loops) {
                for (let i = 0; i < loop.length && loop.length > 1; i++) {
          const a0 = loop[i], b0 = loop[(i + 1) % loop.length];
          if (Math.hypot(a0.x - b0.x, a0.z - b0.z) > EPS) continue;
          // Turn the loop so the pair is at the front; it is a cycle.
          loop = loop.slice(i).concat(loop.slice(0, i));
          const [a, b] = loop;
          const ia = retire(a), ib = retire(b);
          if (ia !== ib) arcs.push([ia, ib]);
          const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
          let v;
          if (loop.length <= 2 || a.eL === b.eR) {
            // Nothing left either side: the loop closes on this point.
            loop = [{ x, z, node: ia, eL: a.eL, eR: b.eR, vx: 0, vz: 0 }];
          } else {
            const dot = edges[a.eL].nx * edges[b.eR].nx + edges[a.eL].nz * edges[b.eR].nz;
            v = vertexOrSpike(x, z, ia, a.eL, b.eR);
            loop.splice(0, 2, v);
          }
          changed = true;
          break;
        }
        if (loop.length >= 3) {
          // No area left: the loop is a line (the ridge of a wing whose two
          // sides have met). Lay it down in order along that line.
          let far = 0, fa = 0, fb = 0;
          for (let i = 0; i < loop.length; i++) {
            for (let j = i + 1; j < loop.length; j++) {
              const d = Math.hypot(loop[i].x - loop[j].x, loop[i].z - loop[j].z);
              if (d > far) { far = d; fa = i; fb = j; }
            }
          }
          const A = loop[fa], B = loop[fb];
          const ux = (B.x - A.x) / far, uz = (B.z - A.z) / far;
          const flat = loop.every((v) => Math.abs((v.x - A.x) * uz - (v.z - A.z) * ux) <= EPS * 10);
          if (flat) {
            const ids = loop.map((v) => ({ s: (v.x - A.x) * ux + (v.z - A.z) * uz, id: retire(v) }))
              .sort((p, q) => p.s - q.s || p.id - q.id);
            for (let i = 1; i < ids.length; i++) if (ids[i - 1].id !== ids[i].id) arcs.push([ids[i - 1].id, ids[i].id]);
            changed = true;
            continue;
          }
          next.push(loop);
          continue;
        }
        if (loop.length === 2) {
          const ia = retire(loop[0]), ib = retire(loop[1]);
          if (ia !== ib) arcs.push([ia, ib]);
          changed = true;
          continue;
        }
        if (loop.length === 1) { retire(loop[0]); changed = true; continue; }
        next.push(loop);
      }
      loops = next;
      if (!changed) return;
    }
    throw new Error('skeleton: settle did not converge');
  };

  const guardMax = 8 * n * n + 64;
  for (let guard = 0; loops.length; guard++) {
    if (guard > guardMax) throw new Error('skeleton: no progress');
    // The earliest event anywhere.
    let best = null;
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li];
      const L = loop.length;
      for (let i = 0; i < L; i++) {
        const a = loop[i], b = loop[(i + 1) % L];
        // Edge event: the edge from a to b shrinks to nothing.
        const e = edges[a.eR];
        const closing = (b.vx - a.vx) * e.dx + (b.vz - a.vz) * e.dz;
        if (closing < -1e-12) {
          const len = (b.x - a.x) * e.dx + (b.z - a.z) * e.dz;
          const dt = Math.max(0, -len / closing);
          if (!best || dt < best.dt - EPS) best = { dt, kind: 'edge', li, i };
        }
        // Split event: reflex vertex a runs into an edge across the loop.
        if (!a.reflex) continue;
        for (let j = 0; j < L; j++) {
          if (j === i || (j + 1) % L === i) continue;
          const p = loop[j], q = loop[(j + 1) % L];
          const f = edges[p.eR];
          if (p.eR === a.eL || p.eR === a.eR) continue;
          const speed = f.nx * a.vx + f.nz * a.vz - 1;
          if (speed >= -1e-12) continue;
          const gap = f.nx * (a.x - p.x) + f.nz * (a.z - p.z);
          if (gap < -EPS) continue;
          const dt = Math.max(0, -gap / speed);
          // Where it lands, and whether that is on the edge as it will be then.
          const hx = a.x + a.vx * dt, hz = a.z + a.vz * dt;
          const px = p.x + p.vx * dt, pz = p.z + p.vz * dt;
          const qx = q.x + q.vx * dt, qz = q.z + q.vz * dt;
          const s = (hx - px) * f.dx + (hz - pz) * f.dz;
          const span = (qx - px) * f.dx + (qz - pz) * f.dz;
          if (s < -EPS || s > span + EPS) continue;
          if (!best || dt < best.dt - EPS) best = { dt, kind: 'split', li, i, j };
        }
      }
    }
    if (!best) throw new Error('skeleton: no event');
    // Move every vertex to the event's time.
    now += best.dt;
    for (const loop of loops) for (const v of loop) { v.x += v.vx * best.dt; v.z += v.vz * best.dt; }

    const loop = loops[best.li];
    const L = loop.length;
    if (best.kind === 'edge') {
      // Pull the two ends together exactly; settle() merges them.
      const a = loop[best.i], b = loop[(best.i + 1) % L];
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      a.x = b.x = x; a.z = b.z = z;
    } else {
      const v = loop[best.i];
      const id = retire(v);
      const p = loop[best.j], q = loop[(best.j + 1) % L];
      const eE = p.eR;
      // loop1: v (eL .. eE), then q round to v's predecessor.
      // loop2: v' (eE .. eR), then v's successor round to p.
      const one = [vertexOrSpike(v.x, v.z, id, v.eL, eE)];
      for (let k = (best.j + 1) % L; k !== best.i; k = (k + 1) % L) one.push(loop[k]);
      const two = [vertexOrSpike(v.x, v.z, id, eE, v.eR)];
      for (let k = (best.i + 1) % L; k !== (best.j + 1) % L; k = (k + 1) % L) two.push(loop[k]);
      loops.splice(best.li, 1, one, two);
    }
    settle();
  }

  // Fold together nodes that landed on the same point, then drop arcs that
  // shrank to nothing or repeat.
  const canon = nodes.map((_, i) => i);
  for (let i = n; i < nodes.length; i++) {
    for (let j = 0; j < i; j++) {
      if (canon[j] !== j) continue;
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z) <= EPS * 10) { canon[i] = j; break; }
    }
  }
  const cut = arcs.map(([a, b]) => [canon[a], canon[b]]);
  const seen = new Set();
  const outArcs = [];
  for (const [a, b] of cut) {
    if (a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outArcs.push(a < b ? [a, b] : [b, a]);
  }
  // Renumber so only used nodes remain, corners first.
  const used = new Map();
  for (let i = 0; i < n; i++) used.set(i, i);
  const outNodes = poly.map((p) => ({ x: p.x, z: p.z, t: 0 }));
  for (const arc of outArcs) {
    for (const k of [0, 1]) {
      if (!used.has(arc[k])) {
        used.set(arc[k], outNodes.length);
        outNodes.push({ ...nodes[arc[k]] });
      }
      arc[k] = used.get(arc[k]);
    }
  }

  // The faces: walk the graph from each eave edge, keeping the face on the
  // left, which means taking the sharpest left turn at every node.
  const adj = outNodes.map(() => []);
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
  for (let i = 0; i < n; i++) link(i, (i + 1) % n);
  for (const [a, b] of outArcs) link(a, b);
  const ang = (a, b) => Math.atan2(outNodes[b].z - outNodes[a].z, outNodes[b].x - outNodes[a].x);
  const TAU = Math.PI * 2;
  const faces = [];
  for (let i = 0; i < n; i++) {
    const face = [i];
    let from = i, at = (i + 1) % n;
    for (let steps = 0; at !== i; steps++) {
      if (steps > outNodes.length + 2) throw new Error('skeleton: open face');
      face.push(at);
      const back = ang(at, from);
      let pick = -1, bestTurn = Infinity;
      for (const w of adj[at]) {
        if (w === from && adj[at].length > 1) continue;
        let d = (back - ang(at, w)) % TAU;
        if (d <= 1e-12) d += TAU;
        if (d < bestTurn) { bestTurn = d; pick = w; }
      }
      from = at; at = pick;
    }
    faces.push({ edge: i, nodes: face });
  }
  return { poly, nodes: outNodes, arcs: outArcs, faces };
}

// The eave line: the polygon pushed `d` feet outward, every edge parallel to
// its own wall and every corner mitred, which is how a fascia board runs round
// a building and also exactly where the straight skeleton's wavefront would be
// at time -d, so the roof stood on it is the same roof carried out over the
// overhang. Corners come back one for one with `poly` after `cleanPolygon`.
//
// The stated limit: an outward offset closes up a concave run (a curve bowed
// into the building, a notch), and once `d` is more than such a run can give,
// an edge turns end for end or the line crosses itself. Both are refused, as
// null, and the caller keeps the rectangles (#967); nothing is trimmed or
// patched into a roof that is quietly not what was drawn.
export function eavePolygon(input, d) {
  const poly = cleanPolygon(input);
  if (!poly || !(d >= 0)) return null;
  const n = poly.length;
  const normal = (i) => {
    const a = poly[i], b = poly[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (b.z - a.z) / L, z: -(b.x - a.x) / L };
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const n1 = normal((i - 1 + n) % n), n2 = normal(i);
    const k = 1 + n1.x * n2.x + n1.z * n2.z;
    out.push(P2(poly[i].x + (d * (n1.x + n2.x)) / k, poly[i].z + (d * (n1.z + n2.z)) / k));
  }
  // A run turned end for end always crosses its neighbours, so one test for a
  // simple polygon catches both (a corner that turns straight back has k of 0,
  // and the infinite point it gives fails the same test).
  const clean = cleanPolygon(out);
  return clean ? out : null;
}

// A face cut into triangles by ear clipping, as index triples into `pts`
// (anything with x and z), each wound in (x, z) the way the face is. A
// skeleton face is not convex in general (an L's long slope runs past its
// valley), and a fan from the first point, which is how render.js has always
// drawn a roof face, puts a triangle outside it there. Null if no ear can be
// found, which a simple polygon always has.
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let idx = [...Array(n).keys()];
  const backward = signedArea(pts) < 0;
  if (backward) idx.reverse();
  const cross = (a, b, c) => (pts[b].x - pts[a].x) * (pts[c].z - pts[a].z) - (pts[b].z - pts[a].z) * (pts[c].x - pts[a].x);
  const tris = [];
  while (idx.length > 3) {
    const m = idx.length;
    let cut = -1;
    for (let k = 0; k < m && cut < 0; k++) {
      const a = idx[(k - 1 + m) % m], b = idx[k], c = idx[(k + 1) % m];
      const turn = cross(a, b, c);
      // A corner that does not turn is never an ear (its triangle is flat);
      // it becomes an ordinary corner once a neighbour is clipped.
      if (turn <= 1e-12 * (1 + Math.abs(pts[a].x) + Math.abs(pts[a].z)) ** 2) continue;
      let clear = true;
      for (const j of idx) {
        if (j === a || j === b || j === c) continue;
        if (cross(a, b, j) >= 0 && cross(b, c, j) >= 0 && cross(c, a, j) >= 0) { clear = false; break; }
      }
      if (!clear) continue;
      tris.push([a, b, c]);
      cut = k;
    }
    if (cut < 0) return null;
    idx.splice(cut, 1);
  }
  if (cross(idx[0], idx[1], idx[2]) > 0) tris.push([idx[0], idx[1], idx[2]]);
  return backward ? tris.map(([a, b, c]) => [c, b, a]) : tris;
}

// The height of a skeleton roof over one point of the plan, for the section:
// the plane of the face the point lies in (or on the edge of), read off the
// face itself (its eave and the point of it furthest from the eave), so it
// needs no pitch passed in. Null outside every face.
export function roofHeightOver(faces, x, z) {
  let best = null, bestD = Infinity;
  for (const f of faces) {
    const pts = f.pts;
    let inside = false, d = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const s = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
      d = Math.min(d, Math.hypot(a.x + dx * s - x, a.z + dz * s - z));
    }
    if (inside) d = 0;
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best || bestD > 1e-6) return null;
  const [a, b] = best.pts;
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const inward = (p) => ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / L;
  // Any corner off the eave gives the face's slope; the furthest gives it with
  // the least rounding.
  let far = a, farD = 0;
  for (const p of best.pts) if (inward(p) > farD) { farD = inward(p); far = p; }
  return a.y + ((far.y - a.y) / farD) * inward({ x, z });
}

// The hipped roof over a polygon: every edge an eave at `eaveY`, every face a
// plane rising at `pitch` in 12. Faces come back in blockRoof's shape
// ({ kind: 'slope', pts: [{ x, y, z }] }, counter-clockwise in (x, z), the
// eave's two ends first), so a renderer that draws one draws the other.
export function skeletonRoof(polygon, eaveY, pitch) {
  const sk = straightSkeleton(polygon);
  if (!sk) return null;
  const slope = pitch / 12;
  const pts = sk.nodes.map((p) => ({ x: p.x, y: eaveY + p.t * slope, z: p.z }));
  // A face can pass straight through a node where another face's ridge
  // meets it (a T's stem joining the bar); that point is not a corner of
  // this face, so it is left out.
  const faces = sk.faces.map((f) => {
    const ids = f.nodes.filter((id, k, a) => {
      if (k < 2) return true;               // the eave's two ends always stay
      const p = sk.nodes[a[k - 1]], q = sk.nodes[id], r = sk.nodes[a[(k + 1) % a.length]];
      const cross = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
      return Math.abs(cross) > 1e-9 * Math.hypot(r.x - p.x, r.z - p.z);
    });
    return { kind: 'slope', edge: f.edge, pts: ids.map((i) => pts[i]) };
  });
  const rise = Math.max(0, ...sk.nodes.map((p) => p.t)) * slope;
  return { faces, gables: [], rise, topY: eaveY + rise, poly: sk.poly };
}
