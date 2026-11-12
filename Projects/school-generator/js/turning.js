// turning.js — where a chair has to turn: the 60in circle, the 36in passage and,
// for a door that swings, ADA 404.2.4's manoeuvring rectangle (Phase 40, #1025).
//
// Split out of clearance.js on 2026-11-06 (TG-38). Everything here is read by
// the report alone (egress.js, which is deferred), while clearance.js carries
// the doorway contract the boot path needs; leaving this behind it would have
// put 20 KB of analysis in the boot, whose budget has 4 KB to spare.
//
// Pure module: no three.js, no DOM. Exercised by test/clearance.test.mjs.

import { floorSolidAt } from './shapes.js';
import { floorCuts, inFloorCut, stairsOf, stairMetrics, stairSurfaceAt } from './stairs.js';
import { buildCollider, candidates } from './collide.js';
import { emptyField } from './terrain.js';
import { THRESHOLD, CLEAR_LOSS, MIN_CLEAR_W, doorClear, inches, roomName, finding } from './clearance.js';
import { LEAF_DOUBLE } from './shapes.js';
import { floorLabel } from './grid.js';

// ---------- the turning circle ----------

// ADA 304.3.1: a circle 60in across is the space a chair turns round in. It is
// asked for where a route turns or ends — both sides of every doorway, and
// somewhere in every room a chair can enter.
export const TURN_D = 60 / 12;                      // ft
export const TURN_R = TURN_D / 2;
// ADA 403.5.1: 36in is the narrowest a route may be along its length. Asked
// at every corner the mesh knows about, which is where a corridor pinches.
export const PASSAGE_D = 36 / 12;                   // ft
export const PASSAGE_R = PASSAGE_D / 2;
// How finely a circle is tested against the floor's edge: rings of samples,
// each ring a fraction of the radius. Walls and furniture are exact.
const RINGS = 6;
const SAMPLES = 16;

// Distance from (x, z) to segment a->b.
function segDist(s, x, z) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / len2)) : 0;
  return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
}

// Distance from (x, z) to a rotated box (the prop obstacle shape collide.js
// makes), zero inside it. Same frame as `pushOutOfBox`.
function boxDist(o, x, z) {
  const c = Math.cos(o.rotationY || 0), s = Math.sin(o.rotationY || 0);
  const wx = x - o.x, wz = z - o.z;
  const lx = wx * c - wz * s, lz = wx * s + wz * c;
  const ex = Math.max(Math.abs(lx) - o.hw, 0);
  const ez = Math.max(Math.abs(lz) - o.hd, 0);
  return Math.hypot(ex, ez);
}

// Everything on one storey a circle can be tested against: the collider's
// walls, rails, shaft walls and furniture (door leaves deliberately not — they
// swing, and a clearance is measured with the door out of the way), plus what
// the collider does not carry because a walker never needs it all at once —
// where the slab is, where it is cut, and where a stair run climbs off it.
export function clearanceWorld(state, floorIndex, catalogGet = null) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  return {
    floor: floorIndex,
    record: floor,
    collider: buildCollider(state, floorIndex, catalogGet, { site: emptyField() }),
    cuts: floorCuts(state, floorIndex),
    runs: stairsOf(state).filter((l) => l.from === floorIndex),
    metrics: stairMetrics(state),
  };
}

// Is there level floor to stand on at (x, z) — slab, not a hole, not a stair
// run climbing away under the wheel? Null when there is; otherwise what is
// there instead, which is what a finding names.
function notLevelAt(world, x, z) {
  if (!world.record || !floorSolidAt(world.record, x, z)) return 'edge';
  if (inFloorCut(world.cuts, x, z)) return 'edge';
  for (const run of world.runs) {
    const h = stairSurfaceAt(run, world.metrics, x, z);
    if (h !== null && h > THRESHOLD) return run.type === 'ramp' ? 'ramp' : 'stair';
  }
  return null;
}

// The largest circle centred at (x, z) that touches nothing, up to `maxR`, and
// what stopped it growing. `clear` is exact against walls and furniture and
// sampled against the floor's edge.
export function clearRadiusAt(world, x, z, maxR = TURN_R) {
  let clear = maxR;
  let blocker = null;
  const here = notLevelAt(world, x, z);
  if (here) return { clear: 0, blocker: here };
  const near = candidates(world.collider, x - maxR, z - maxR, x + maxR, z + maxR);
  for (const s of near.segs) {
    const d = segDist(s, x, z) - (s.pad ?? 0);
    if (d < clear) { clear = Math.max(0, d); blocker = 'wall'; }
  }
  for (const p of near.props) {
    const d = boxDist(p, x, z);
    if (d < clear) { clear = Math.max(0, d); blocker = p.type ? `furniture:${p.type}` : 'furniture'; }
  }
  // The floor's edge, by rings: the largest ring whose every sample stands on
  // level floor is how far the circle reaches before it hangs over a hole, a
  // stair, or the outside of the building. Rings past what a wall or a desk
  // already stopped are not asked — they could only agree.
  let floorR = 0;
  for (let k = 1; k <= RINGS; k++) {
    const r = (maxR * k) / RINGS;
    if (r > clear + 1e-9) break;
    let hit = null;
    for (let i = 0; i < SAMPLES && !hit; i++) {
      const a = (i / SAMPLES) * Math.PI * 2;
      hit = notLevelAt(world, x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    if (hit) { clear = floorR; blocker = hit; break; }
    floorR = r;
  }
  return { clear, blocker };
}

// The same, remembered: a sweep asks about the same foot of corridor from
// several lines, and a clearance does not change between askings. Keyed on
// the foot, which is the pitch a sweep moves at.
function clearCached(world, x, z, maxR) {
  if (!world.cache) world.cache = new Map();
  const key = `${Math.round(x)}|${Math.round(z)}|${maxR}`;
  let hit = world.cache.get(key);
  if (!hit) { hit = clearRadiusAt(world, Math.round(x), Math.round(z), maxR); world.cache.set(key, hit); }
  return hit;
}

// The best of several candidate centres — a door approach may sit anywhere
// beside the door, and a room's turning space anywhere on its floor.
function bestOf(world, points, need) {
  let best = null;
  for (const p of points) {
    const r = clearRadiusAt(world, p.x, p.z, need);
    if (!best || r.clear > best.clear) best = { x: p.x, z: p.z, ...r };
    if (best.clear >= need - 1e-9) break;
  }
  return best;
}

// ---------- a door's manoeuvring clearance (ADA 404.2.4) ----------
//
// A door is not approached by a circle. 404.2.4 asks for a *rectangle* on each
// side of a swinging door: as deep as Table 404.2.4.1 says in front of it, as
// wide as the opening plus a strip beyond the latch jamb, which is the room a
// chair needs to reach the handle and pull the leaf toward itself. Front
// approach, per the table:
//
//                 depth      strip beyond the latch jamb
//   pull side     60 in      18 in
//   push side     48 in      12 in   (the figure for a latch and a closer,
//                                     which every classroom door has)
//
// *Pull side* is the side the leaf swings toward: stand there and the door
// comes at you. The rectangle is laid out from the wall's face, not its centre,
// along the opening and then past the latch jamb. Where the hinge is decides
// which way the strip goes, and where the swing is decides which side is deeper;
// a cased opening has no leaf and no latch, so it keeps the 60 in turning circle
// it was always asked (#1025). The outside of an exterior door and knee and toe
// clearance are not asked here.
export const DOOR_PULL_DEPTH = 60 / 12;     // ft — Table 404.2.4.1, pull side, front approach
export const DOOR_PULL_LATCH = 18 / 12;     // ft — the strip past the latch jamb
export const DOOR_PUSH_DEPTH = 48 / 12;     // ft — push side, front approach
export const DOOR_PUSH_LATCH = 12 / 12;     // ft — push side, latch and closer
const RECT_EPS = 1e-3;                      // ft a rectangle may graze a wall by
const RECT_PITCH = 0.5;                     // ft between floor samples across it

// The rectangle a door asks for on the side of it that `out` points to (a unit
// vector off the door's centre), from a portal that knows how it hangs. Corners
// run around it; `latch` is the unit direction the strip extends in.
export function doorRect(portal, out) {
  const h = portal.hung;
  if (!h) return null;
  const pull = h.swing.x * out.x + h.swing.z * out.z > 0;
  const depth = pull ? DOOR_PULL_DEPTH : DOOR_PUSH_DEPTH;
  const strip = pull ? DOOR_PULL_LATCH : DOOR_PUSH_LATCH;
  return { portal, out, pull, depth, strip, latch: h.latch, half: h.half };
}

// The four corners of a door rectangle cut to `depth` and `strip`, in the
// order around it. Along the opening it runs from the hinge jamb to the latch
// jamb and then `strip` past it; outward it runs from the wall's face to `depth`
// beyond. The hinge end starts a wall's half thickness inside the jamb: a door
// hung at the corner of a room hinges against the face of the wall that
// crosses there, not against its centre line, and a rectangle that began at
// the centre line would be blocked by the wall the door is hung on.
export function doorRectCorners(r, depth = r.depth, strip = r.strip) {
  const p = r.portal, hw = p.w / 2;
  const a0 = -hw + r.half, a1 = hw + strip, v0 = r.half, v1 = r.half + depth;
  const at = (a, v) => ({
    x: p.x + r.latch.x * a + r.out.x * v,
    z: p.z + r.latch.z * a + r.out.z * v,
  });
  return [at(a0, v0), at(a1, v0), at(a1, v1), at(a0, v1)];
}

// Do two convex polygons overlap by more than `eps` — touching along an edge
// is not overlap, which is what a wall flush with the door's jamb needs.
function overlapsBy(a, b, eps = RECT_EPS) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q.z - p.z), az = q.x - p.x;
      const len = Math.hypot(ax, az) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const c of a) { const d = (c.x * ax + c.z * az) / len; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const c of b) { const d = (c.x * ax + c.z * az) / len; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (Math.min(a1, b1) - Math.max(a0, b0) <= eps) return false;
    }
  }
  return true;
}

// A wall segment as the polygon its pad sweeps: the segment, widened and
// lengthened by `pad` — the same body `segDist` measures to, squared off at the
// ends, which is exact for the flush walls a door sits in.
function segPolygon(s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len, pad = s.pad ?? 0;
  const nx = -uz * pad, nz = ux * pad;
  const ex = ux * pad, ez = uz * pad;
  return [
    { x: s.ax - ex + nx, z: s.az - ez + nz }, { x: s.bx + ex + nx, z: s.bz + ez + nz },
    { x: s.bx + ex - nx, z: s.bz + ez - nz }, { x: s.ax - ex - nx, z: s.az - ez - nz },
  ];
}

// A prop's box, in the frame `boxDist` reads it in.
function boxPolygon(o) {
  const c = Math.cos(o.rotationY || 0), s = Math.sin(o.rotationY || 0);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const lx = i * o.hw, lz = j * o.hd;
    return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
  });
}

// What stands in a door rectangle cut to `depth` and `strip`: null when it is
// clear, otherwise the first thing found, named the way `clearRadiusAt` names
// one ('wall', 'furniture:desk', 'edge', 'stair', 'ramp').
export function doorRectBlocker(world, r, depth = r.depth, strip = r.strip) {
  const poly = doorRectCorners(r, depth, strip);
  const xs = poly.map((c) => c.x), zs = poly.map((c) => c.z);
  const near = candidates(world.collider, Math.min(...xs) - 1, Math.min(...zs) - 1,
    Math.max(...xs) + 1, Math.max(...zs) + 1);
  for (const s of near.segs) if (overlapsBy(poly, segPolygon(s))) return 'wall';
  for (const p of near.props) {
    if (overlapsBy(poly, boxPolygon(p))) return p.type ? `furniture:${p.type}` : 'furniture';
  }
  // The floor under it, sampled across the rectangle and just inside its edge.
  const [c0, c1, , c3] = poly;
  const alongLen = Math.hypot(c1.x - c0.x, c1.z - c0.z), outLen = Math.hypot(c3.x - c0.x, c3.z - c0.z);
  const na = Math.max(1, Math.ceil(alongLen / RECT_PITCH)), nv = Math.max(1, Math.ceil(outLen / RECT_PITCH));
  for (let i = 0; i <= na; i++) {
    for (let j = 0; j <= nv; j++) {
      const fa = Math.min(1 - 0.01, Math.max(0.01, i / na)), fv = Math.min(1 - 0.01, Math.max(0.01, j / nv));
      const x = c0.x + (c1.x - c0.x) * fa + (c3.x - c0.x) * fv;
      const z = c0.z + (c1.z - c0.z) * fa + (c3.z - c0.z) * fv;
      const hit = notLevelAt(world, x, z);
      if (hit) return hit;
    }
  }
  return null;
}

// How much of a door rectangle fits: the deepest cut of it that is clear when
// it is full width, and the widest latch strip that is clear when it is full
// depth. Feasibility only ever shrinks as a rectangle grows, so each is a
// bisection, to the half inch.
export function doorRectFit(world, r) {
  const bisect = (hi, clear) => {
    if (clear(hi)) return hi;
    let lo = 0;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      if (clear(mid)) lo = mid; else hi = mid;
    }
    return lo;
  };
  const strip = bisect(r.strip, (t) => !doorRectBlocker(world, r, r.depth, t));
  const depth = bisect(r.depth, (d) => !doorRectBlocker(world, r, d, r.strip));
  return { depth, strip };
}

// Points spread over a tile at a pitch, centre first, for a search that stops
// at the first one that passes. A tile is convex and inside its room, so
// every one of them is somewhere a chair could actually be.
const TILE_PITCH = 4;   // ft
const MAX_TILE_POINTS = 64;
function tilePoints(t) {
  const out = [{ x: t.cx, z: t.cz }];
  const nx = Math.max(1, Math.min(8, Math.floor((t.x1 - t.x0) / TILE_PITCH)));
  const nz = Math.max(1, Math.min(8, Math.floor((t.z1 - t.z0) / TILE_PITCH)));
  if (nx * nz <= 1) return out;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      out.push({
        x: t.x0 + ((i + 0.5) / nx) * (t.x1 - t.x0),
        z: t.z0 + ((j + 0.5) / nz) * (t.z1 - t.z0),
      });
      if (out.length >= MAX_TILE_POINTS) return out;
    }
  }
  return out;
}
const blockerName = (b) => {
  if (!b) return 'nothing';
  if (b === 'wall') return 'a wall';
  if (b === 'edge') return 'the edge of the floor';
  if (b === 'stair') return 'a stair';
  if (b === 'ramp') return 'a ramp';
  if (b.startsWith('furniture:')) return `the ${b.slice('furniture:'.length).replace(/-/g, ' ')}`;
  return 'furniture';
};

// Where a chair has to be able to turn, tested. `opts.nav` is the accessible
// graph (the doorways it kept are the ones a chair reaches); `opts.reachable`
// says which rooms are on the route at all, so a wing only stairs reach does
// not pile clearance findings on top of the finding that already says so;
// `opts.circulation` says which rooms are corridors, whose routes are swept
// for pinches.
export function turningAnalysis(state, opts = {}) {
  const nav = opts.nav;
  const reachable = opts.reachable || (() => true);
  const circulation = opts.circulation || (() => false);
  const catalogGet = opts.catalogGet || null;
  const spots = [];
  if (!nav || !state || !state.floors) return { spots, fails: [], tested: 0, findings: [] };
  const worlds = new Map();
  const worldFor = (i) => {
    let w = worlds.get(i);
    if (!w) { w = clearanceWorld(state, i, catalogGet); worlds.set(i, w); }
    return w;
  };
  const rooms = new Map(nav.rooms.map((r) => [r.id, r]));
  const spot = (kind, need, best, extra) => {
    spots.push({
      kind, need, x: best.x, z: best.z, clear: best.clear, blocker: best.blocker,
      ok: best.clear >= need - 1e-9,
      ...extra,
    });
  };

  // Both sides of every doorway on the route. A door that swings is asked for
  // ADA 404.2.4's rectangle, fixed to the door by its hinge and its swing; a
  // cased opening has no leaf to reach round and is asked the turning circle,
  // allowed to slide a little along the wall and in or out.
  for (const p of nav.portals) {
    const along = { x: -p.nz, z: p.nx };
    for (const [roomId, at] of [[p.a, p.pa], [p.b, p.pb]]) {
      if (!roomId || !at || !reachable(roomId)) continue;
      const room = rooms.get(roomId);
      const world = worldFor(p.floor);
      const out = { x: at.x - p.x, z: at.z - p.z };
      const len = Math.hypot(out.x, out.z) || 1;
      const ux = out.x / len, uz = out.z / len;
      const extra = {
        id: p.id, floor: p.floor, room: roomId, roomName: room ? room.name || null : null,
      };
      const rect = doorRect(p, { x: ux, z: uz });
      if (rect) {
        const blocker = doorRectBlocker(world, rect);
        const fit = blocker ? doorRectFit(world, rect) : { depth: rect.depth, strip: rect.strip };
        spots.push({
          kind: 'door', need: rect.depth, x: p.x, z: p.z, clear: fit.depth, blocker,
          ok: !blocker, rect: true, pull: rect.pull,
          depth: fit.depth, strip: fit.strip, needDepth: rect.depth, needStrip: rect.strip,
          w: p.w, corners: doorRectCorners(rect), ...extra,
        });
        continue;
      }
      // Three feet off the door and then further out, a foot at a time, and
      // a step either way along the wall at each: the lockers flanking a
      // corridor door are beside it, not in front of it, and a chair turns
      // in front of it.
      const points = [];
      for (const o of [0, 1, 2, 0.5, 1.5]) {
        for (const a of [0, 1.5, -1.5]) {
          points.push({
            x: at.x + ux * o + along.x * a,
            z: at.z + uz * o + along.z * a,
          });
        }
      }
      spot('door', TURN_R, bestOf(world, points, TURN_R), extra);
    }
  }

  // The corridors, swept. A route through a corridor is the straight line
  // between two things standing on one convex tile of it — a door to a door,
  // a door to the bend — which is exactly how navgraph.js wired the graph.
  // The passage circle is slid along each such line, and at every station it
  // may step sideways across the corridor looking for room, because a chair
  // goes round a fountain rather than through it: what is measured is the
  // narrowest *cross-section* the route has to get through, and a pinch is a
  // station where no point across the corridor clears 36in — a bench and a
  // locker bank facing each other, a jog in the wall, a void's guardrail. Only
  // circulation is swept: a classroom's route is its door, and the room test
  // below is what asks about its floor. The room's own node is not an anchor
  // here — nobody's route goes to the middle of a corridor.
  const SWEEP = 2;        // ft between stations along a line
  // Either side a station may look for room. Twelve feet is a wide corridor,
  // and half the length of the open stair a route through a stair hall has
  // to go round the end of — the answer the cache makes cheap.
  const ASIDE = 12;       // ft
  for (const m of nav.mesh || []) {
    for (const t of m.tiles) {
      if (!reachable(t.room) || !circulation(t.room)) continue;
      const room = rooms.get(t.room);
      const world = worldFor(t.floor);
      const as = t.anchors.filter((a) => a.id !== t.room);
      let worst = null;
      for (let i = 0; i < as.length; i++) {
        for (let j = i + 1; j < as.length; j++) {
          if (as[i].id === as[j].id) continue;
          const dx = as[j].x - as[i].x, dz = as[j].z - as[i].z;
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          const px = -dz / len, pz = dx / len;
          const n = Math.max(1, Math.ceil(len / SWEEP));
          for (let k = 0; k <= n; k++) {
            const x = as[i].x + (dx * k) / n, z = as[i].z + (dz * k) / n;
            let best = null;
            for (let o = 0; o <= ASIDE && !(best && best.clear >= PASSAGE_R - 1e-9); o++) {
              for (const side of (o ? [1, -1] : [1])) {
                const sx = x + px * o * side, sz = z + pz * o * side;
                const r = clearCached(world, sx, sz, PASSAGE_R);
                if (!best || r.clear > best.clear) best = { x: sx, z: sz, ...r };
                if (best.clear >= PASSAGE_R - 1e-9) break;
              }
            }
            if (!worst || best.clear < worst.clear) worst = best;
          }
        }
      }
      if (!worst || worst.clear >= PASSAGE_R - 1e-9) continue;
      spot('pinch', PASSAGE_R, worst, {
        id: t.id, floor: t.floor, room: t.room, roomName: room ? room.name || null : null,
      });
    }
  }

  // Somewhere in every room the route reaches. The candidates are the room's
  // own point and a spread of points over each convex tile the mesh cut it
  // into — a room passes if a chair can turn round anywhere in it, and the
  // search stops at the first place it can.
  for (const r of nav.rooms) {
    if (!reachable(r.id)) continue;
    const mesh = nav.mesh && nav.mesh[r.floor];
    const tiles = (mesh && mesh.byRoom.get(r.id)) || [];
    let points = [{ x: r.x, z: r.z }];
    for (const t of tiles) if (t.rect) points = points.concat(tilePoints(t));
    spot('room', TURN_R, bestOf(worldFor(r.floor), points, TURN_R), {
      id: r.id, floor: r.floor, room: r.id, roomName: r.name || null,
    });
  }

  const fails = spots.filter((s) => !s.ok);
  return { spots, fails, tested: spots.length, findings: turningFindings(spots, fails) };
}

// A failing spot, as the mark a plan draws: the circle that *does* fit, and
// the one that was wanted.
const circleOf = (s) => ({
  id: s.id, floor: s.floor, x: s.x, z: s.z, r: s.clear, need: s.need, kind: s.kind,
});

function turningFindings(spots, fails) {
  const out = [];
  if (!spots.length) return out;
  const doors = fails.filter((s) => s.kind === 'door');
  const pinches = fails.filter((s) => s.kind === 'pinch');
  const rooms = fails.filter((s) => s.kind === 'room');
  if (doors.length) {
    const rects = doors.filter((d) => d.rect);
    const circ = doors.filter((d) => !d.rect);
    // The worst of each kind: the rectangle that falls shortest of what it was
    // asked for (inches missing, depth and strip together), the circle that
    // is smallest.
    const short = (d) => (d.needDepth - d.depth) + (d.needStrip - d.strip);
    const wr = rects.length ? rects.reduce((a, b) => (short(b) > short(a) ? b : a)) : null;
    const wc = circ.length ? circ.reduce((a, b) => (b.clear < a.clear ? b : a)) : null;
    const parts = [];
    if (wr) {
      parts.push(
        `In front of the door into ${roomName(wr)}, on its ${wr.pull ? 'pull' : 'push'} side, ` +
        `the clear rectangle is ${inches(wr.depth)} deep against the ${inches(wr.needDepth)} ` +
        `404.2.4.1 asks for, and ${inches(wr.strip)} of the ${inches(wr.needStrip)} latch-side ` +
        `strip past the jamb; ${blockerName(wr.blocker)} is what is in the way.`);
    }
    if (wc) {
      parts.push(
        `Beside the door into ${roomName(wc)} the clear circle is ${inches(wc.clear * 2)} across ` +
        `against the 60 in a chair turns in, and ${blockerName(wc.blocker)} is what is in the way.`);
    }
    parts.push('Moving what stands by the door is usually the answer; a wider corridor is the other one.');
    const f = finding('warn', 'door-approach',
      `${doors.length} door approach${doors.length === 1 ? '' : 'es'} with no room to manoeuvre a chair`,
      parts.join(' '),
      { cite: 'ADA 2010 · §404.2.4' });
    if (rects.length) {
      f.doors = rects.slice(0, 12).map((d) => ({ id: d.id, floor: d.floor, x: d.x, z: d.z, w: d.w }));
      f.rects = rects.slice(0, 12).map((d) => ({
        id: d.id, floor: d.floor, pull: d.pull, corners: d.corners,
        depth: d.depth, strip: d.strip, needDepth: d.needDepth, needStrip: d.needStrip,
      }));
    }
    if (circ.length) f.circles = circ.slice(0, 12).map(circleOf);
    out.push(f);
  }
  if (pinches.length) {
    const w = pinches.reduce((a, b) => (b.clear < a.clear ? b : a));
    out.push(finding('warn', 'route-pinch',
      `${pinches.length} pinch${pinches.length === 1 ? '' : 'es'} on the accessible route under 36 in`,
      `In ${roomName(w)} the route narrows to ${inches(w.clear * 2)}, ` +
      `where ${blockerName(w.blocker)} closes it in. A route is 36 in at its narrowest, ` +
      'and 60 in wherever two chairs have to pass.',
      { circles: pinches.slice(0, 12).map(circleOf), cite: 'ADA 2010 · §403.5' }));
  }
  if (rooms.length) {
    out.push(finding('warn', 'turning-space',
      `${rooms.length} room${rooms.length === 1 ? '' : 's'} a chair can enter and not turn round in`,
      `${rooms.slice(0, 4).map(roomName).join(', ')}` +
      `${rooms.length > 4 ? `, and ${rooms.length - 4} more` : ''} — nowhere on the floor ` +
      'holds a 60 in circle once the walls and the furniture are counted.',
      {
        rooms: rooms.slice(0, 8).map((s) => ({ id: s.room, floor: s.floor, name: s.roomName })),
        circles: rooms.slice(0, 12).map(circleOf),
        cite: 'ADA 2010 · §304.3',
      }));
  }
  if (!fails.length) {
    out.push(finding('ok', 'clearance', 'A chair turns everywhere it was tried',
      `${spots.length} places tested: both sides of every doorway on the route, every ` +
      'bend, and the open floor of every room a chair can reach.',
      { cite: 'ADA 2010 · §304.3' }));
  }
  return out;
}

// ---------- a pair of doors ----------
//
// ADA 404.2.3 (and its advisory 404.2.2) measures a pair at its active leaf:
// the other leaf may be bolted, so the opening has to offer 32 in clear through
// one leaf alone. `doorClear` (clearance.js) is the other reading, both leaves
// open, which is what the walk does and what the accessible graph keeps, so a
// pair that passes it stays on the route. This is the plan checker's reading,
// reported beside it and moving nothing (TG-44, #1034).
//
// Each leaf is half the opening, and the leaf parked at 90 degrees and its stop
// take CLEAR_LOSS (4 in) off its own half, the same loss a single door pays.
// The data has no astragal or mullion for a pair (the two leaves meet on a
// LEAF_GAP of 0.06 ft, openings.js), so none is counted. By hand: a 4 ft pair
// is 24 - 4 = 20 in through one leaf, 5 ft is 30 - 4 = 26 in, and 6 ft is
// 36 - 4 = 32 in, which is exactly the 32 in 404.2.3 asks: 6 ft is the
// narrowest pair that passes.
export const pairActiveClear = (w) => Math.max(0, w / 2 - CLEAR_LOSS);
export const pairActiveRolls = (w) => pairActiveClear(w) >= MIN_CLEAR_W - 1e-9;

// The pairs whose active leaf is short of 32 in, but which roll with both
// leaves open: a pair too narrow even then is `narrow-doors` already (egress.js)
// and is not counted twice. Single doors and cased openings are not asked.
export function pairLeafFindings(nav) {
  if (!nav || !nav.portals) return [];
  const rooms = new Map((nav.rooms || []).map((r) => [r.id, r]));
  const pairs = nav.portals.filter((p) =>
    p.leaf === LEAF_DOUBLE && doorClear(p.w, p.leaf) >= MIN_CLEAR_W - 1e-9
    && !pairActiveRolls(p.w));
  if (!pairs.length) return [];
  const label = (p) => {
    const names = [p.a, p.b].map((id) => (rooms.get(id) || {}).name).filter(Boolean);
    const who = names.length > 1 && names[0] !== names[1] ? ` between ${names.join(' and ')}`
      : names.length ? ` at ${names[0]}` : '';
    return `the ${Math.round(p.w * 12) / 12} ft pair${who}` +
      ` on ${floorLabel(p.floor)}`;
  };
  const worst = pairs.reduce((a, b) => (b.w < a.w ? b : a));
  const names = [...new Set(pairs.map(label))];
  const shown = names.slice(0, 4).join('; ');
  return [finding('note', 'pair-active-leaf',
    `${pairs.length} pair${pairs.length === 1 ? '' : 's'} of doors short of 32 in through one leaf`,
    `${shown}${names.length > 4 ? `; and ${names.length - 4} more places` : ''}. Both leaves open they ` +
    `clear ${inches(doorClear(worst.w, worst.leaf))} at the narrowest (${Math.round(worst.w * 12) / 12} ft) ` +
    `and the chair route here keeps them, but a plan check measures a pair at its active leaf ` +
    `alone, which is ${inches(pairActiveClear(worst.w))} there against the 32 in 404.2.3 asks. ` +
    'A pair wants 6 ft before one leaf alone gives 32 in. Nothing was moved or widened.',
    {
      doors: pairs.slice(0, 8).map((p) => ({ id: p.id, floor: p.floor, x: p.x, z: p.z, w: p.w })),
      cite: 'ADA 2010 · §404.2.3',
    })];
}
