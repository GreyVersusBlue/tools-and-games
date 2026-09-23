// Signal City: the road network. Pure geometry, no DOM.
//
// Units are metres, y grows downward (canvas convention), the intersection's
// centre is its `origin` (0, 0 for a single box). A leg is a road leaving
// the centre toward a compass point; each carries `lanesPerDir` inbound
// lanes (on the driver's right as they arrive, right-hand traffic) and the
// same number outbound.
//
// A corridor (M6) is two Networks on one street, `spacing` metres apart, and
// nothing else: the road between them is node A's east leg laid end to end
// with node B's west leg, each still its 110 m (#541: the physics stays on
// the geometry it was tuned on). `linkNodes` marks every path leaving A by
// that leg with `link = { node, entry, atS }`, and the world hands a car
// reaching the end of such a path onto a path of B entering by `entry`, in
// the same lane, `atS` metres along it (0 when the legs meet exactly). A
// leg that receives cars this way spawns none of its own.
//
// A Path is one vehicle's whole line through the map: a polyline with
// cumulative arc length, so a car is a single number `s` along it and every
// question the cars ask (how far to the stop line, am I inside the box, where
// is the car ahead) is arithmetic on s. Paths are built once per (entry leg,
// lane, movement) and shared.
//
// Lane index 0 is the curb lane. With two lanes per direction, lefts leave
// from lane 1 (inner), rights from lane 0, throughs from either; with
// `leftLane` the inner lane is a left-turn bay and throughs keep to the
// rest, which is what a protected-left intersection needs (a left waiting
// for its arrow at the head of a shared lane holds every through behind it
// for the whole through phase).

import { LEGS, exitLeg, parseMovement } from './signals.js';

export const LANE_WIDTH = 3.5;
export const CROSSWALK = 3.0;      // depth of the crosswalk band, from the box edge outward
export const STOP_GAP = 0.6;       // stop line sits this far before the crosswalk

// The roundabout (M8, #595): one circulating lane about the centre, driven
// anticlockwise on the screen (right-hand traffic keeps the island on its
// left). RING_R is the lane's centre line, RING_W its width; a car joins
// ENTRY_SKEW radians before its own leg's axis and leaves the same after
// the exit leg's, so the entry and the exit of one leg sit either side of
// the splitter island. The yield line is YIELD_D metres out.
export const RING_R = 12;
export const RING_W = 5;
export const ENTRY_SKEW = 0.62;
export const YIELD_D = 18;
// The splitter island: each lane of a leg is shifted SPLIT metres off the
// centre line by the yield line, over the TAPER_D metres before it, so a
// trailer leaving by a leg clears a car waiting to enter by it.
export const SPLIT = 1.5;
export const SPLIT_TAPER = 22;

const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };   // outward unit vector per leg

// Right-hand perpendicular of a heading (x, y) in screen coordinates.
function rightOf([x, y]) { return [-y, x]; }

export function legDir(leg) { return DIR[leg]; }

export class Network {
  constructor({ legs = LEGS.slice(), lanesPerDir = 1, leftLane = false, legLength = 110, cornerRadius = 5, origin = [0, 0], node = 0, roundabout = false } = {}) {
    if (roundabout && lanesPerDir !== 1) throw new RangeError('a roundabout is built with one lane each way');
    this.legs = legs.slice();
    this.origin = [origin[0], origin[1]];
    this.node = node;
    this.linkedIn = [];                                 // legs fed by another node's exit: no spawns there
    this.lanesPerDir = lanesPerDir;
    this.leftLane = leftLane && lanesPerDir > 1;
    this.legLength = legLength;
    this.halfRoad = lanesPerDir * LANE_WIDTH;          // half the road's width
    this.boxHalf = this.halfRoad + cornerRadius;        // the box edge, where the crosswalk starts
    this.stopDist = this.boxHalf + CROSSWALK + STOP_GAP; // stop line distance from centre
    this.cornerRadius = cornerRadius;
    // a roundabout's "box" is the ring: its edge is where the legs flare
    // into it, and its stop line is the yield line
    this.roundabout = !!roundabout;
    if (this.roundabout) { this.boxHalf = RING_R + RING_W / 2 + 2; this.stopDist = YIELD_D; }
    this.paths = new Map();                             // key -> Path
    this._cross = new Map();
    this.closed = new Set();                            // 'W0': inbound lanes a closure (M7) has coned off
    this._build();
  }

  // Which lanes a turn may leave from. With a leg named, a lane closed on
  // that leg (M7) is left out: that is the answer a car merging out of the
  // cones wants (may it keep its turn in the lane it is moving to?). The
  // geometry's own answer, with no leg, is what the paths were built from
  // and what the spawner uses, because the cones stand downstream of the
  // map edge and traffic still arrives in every lane.
  lanesForTurn(turn, leg = null) {
    const n = this.lanesPerDir;
    let lanes;
    if (n === 1) lanes = [0];
    else if (turn === 'L') lanes = [n - 1];
    else if (turn === 'R') lanes = [0];
    else lanes = Array.from({ length: this.leftLane ? n - 1 : n }, (_, i) => i);
    return leg === null || !this.closed.size ? lanes : lanes.filter(l => !this.isClosed(leg, l));
  }

  // A lane closure: a car in the inbound `lane` of `leg` merges out before
  // the taper (sim.js). Nothing here moves a car; the paths stay built.
  close(leg, lane) { if (!this.legs.includes(leg) || lane < 0 || lane >= this.lanesPerDir) throw new RangeError(`no lane ${lane} on ${leg}`); this.closed.add(leg + lane); }
  open(leg, lane) { this.closed.delete(leg + lane); }
  isClosed(leg, lane) { return this.closed.has(leg + lane); }

  // The nearest open inbound lane to a closed one on this leg, or -1.
  openLaneNear(leg, lane) {
    for (let d = 1; d < this.lanesPerDir; d++) {
      for (const l of [lane - d, lane + d]) if (l >= 0 && l < this.lanesPerDir && !this.isClosed(leg, l)) return l;
    }
    return -1;
  }

  // Centre point of a lane on a leg at distance d from the intersection
  // centre. inbound: on the driver's right as they arrive. lane 0 = curb.
  lanePoint(leg, lane, inbound, d) {
    const out = DIR[leg];
    const arriveHeading = [-out[0], -out[1]];
    const r = rightOf(arriveHeading);
    const off = (this.lanesPerDir - lane - 0.5) * LANE_WIDTH * (inbound ? 1 : -1);
    return [this.origin[0] + out[0] * d + r[0] * off, this.origin[1] + out[1] * d + r[1] * off];
  }

  // The legs that spawn traffic: every leg not fed by another node.
  get spawnLegs() { return this.legs.filter(l => !this.linkedIn.includes(l)); }

  // A crosswalk's frame on one leg: its band lies `along` metres out from
  // the centre (the middle of the zebra), and a walker crosses it from
  // lateral -halfRoad to +halfRoad (or back) along `perp`, the driver's right
  // as they arrive. `laneLat(lane, inbound)` is a lane's centre in that
  // same lateral coordinate, so a car and a walker can be compared by it.
  crosswalk(leg) {
    const out = DIR[leg];
    const perp = rightOf([-out[0], -out[1]]);
    return {
      leg, along: this.boxHalf + CROSSWALK / 2, dir: out, perp, half: this.halfRoad,
      point: (lat, jitter = 0) => [this.origin[0] + out[0] * (this.boxHalf + CROSSWALK / 2 + jitter) + perp[0] * lat, this.origin[1] + out[1] * (this.boxHalf + CROSSWALK / 2 + jitter) + perp[1] * lat],
      laneLat: (lane, inbound) => (this.lanesPerDir - lane - 0.5) * LANE_WIDTH * (inbound ? 1 : -1),
    };
  }

  pathKey(entry, lane, turn) { return `${entry}${lane}-${turn}`; }

  // Where two paths come closest inside the box: { sA, sB, dist }. A car on
  // B has cleared A's way once its rear is past sB. Cached per pair.
  crossing(a, b) {
    const key = a.key + '|' + b.key;
    let c = this._cross.get(key);
    if (c) return c;
    let best = { sA: a.boxExit, sB: b.boxExit, dist: Infinity };
    const step = 1.0;
    for (let sa = a.boxEnter; sa <= a.boxExit; sa += step) {
      const pa = a.at(sa);
      for (let sb = b.boxEnter; sb <= b.boxExit; sb += step) {
        const pb = b.at(sb);
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (d < best.dist) best = { sA: sa, sB: sb, dist: d };
      }
    }
    // paths that only merge meet at the exit
    if (best.dist > LANE_WIDTH) best = { sA: a.boxExit, sB: b.boxExit, dist: best.dist };
    this._cross.set(key, best);
    return c = best;
  }

  // Shortest distance from a point to the part of a path inside the box.
  distanceToBoxPath(path, x, y) {
    let best = Infinity;
    for (let s = path.boxEnter; s <= path.boxExit; s += 1.0) {
      const p = path.at(s);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) best = d;
    }
    return best;
  }

  pathFor(entry, lane, turn) { return this.paths.get(this.pathKey(entry, lane, turn)) || null; }

  // Every path a car arriving on `entry` in `lane` could take.
  choicesFrom(entry, lane) {
    const out = [];
    for (const turn of ['L', 'T', 'R']) {
      const p = this.pathFor(entry, lane, turn);
      if (p) out.push(p);
    }
    return out;
  }

  _build() {
    for (const entry of this.legs) {
      for (const turn of ['L', 'T', 'R']) {
        const exit = exitLeg(entry, turn);
        if (!this.legs.includes(exit)) continue;
        for (const lane of this.lanesForTurn(turn)) {
          const exitLane = turn === 'T' ? lane : turn === 'R' ? 0 : this.lanesPerDir - 1;
          const p = this.roundabout ? this._ringPath(entry, lane, turn, exit, exitLane) : this._makePath(entry, lane, turn, exit, exitLane);
          this.paths.set(p.key, p);
        }
      }
    }
  }

  _makePath(entry, lane, turn, exit, exitLane) {
    const pts = [];
    const L = this.legLength;
    // approach: from the leg's far end to the stop line, straight
    const a0 = this.lanePoint(entry, lane, true, L);
    const a1 = this.lanePoint(entry, lane, true, this.stopDist);
    pts.push(a0, a1);
    // through the crosswalk to the box edge
    const b0 = this.lanePoint(entry, lane, true, this.boxHalf);
    pts.push(b0);
    // the turn: a cubic from the box edge on the entry lane to the box edge
    // on the exit lane, tangents along the roads. A right turn is tight, a
    // left is wide; a through is a straight line.
    const b1 = this.lanePoint(exit, exitLane, false, this.boxHalf);
    const inH = [-DIR[entry][0], -DIR[entry][1]];
    const outH = DIR[exit];
    if (turn === 'T') {
      pts.push(b1);
    } else {
      const dist = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
      const k = turn === 'R' ? 0.42 : 0.3;   // a left hugs its own quadrant: opposing lefts pass 4 m apart
      const c0 = [b0[0] + inH[0] * dist * k, b0[1] + inH[1] * dist * k];
      const c1 = [b1[0] - outH[0] * dist * k, b1[1] - outH[1] * dist * k];
      const n = 16;
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([
          u * u * u * b0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * b1[0],
          u * u * u * b0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * b1[1],
        ]);
      }
    }
    // departure: box edge to the far end of the exit leg
    pts.push(this.lanePoint(exit, exitLane, false, L));
    const path = new Path({ key: this.pathKey(entry, lane, turn), entry, lane, turn, exit, exitLane, movement: `${entry}-${turn}`, points: pts, node: this.node });
    // arc-length marks
    path.stopLine = path.lengthAt(1);
    path.boxEnter = path.lengthAt(2);
    path.boxExit = path.lengthAt(pts.length - 2);
    return path;
  }

  // A path round the ring: the approach, tapering out round the splitter
  // island to the yield line, a curve onto the
  // ring's centre line, the arc anticlockwise on the screen (the angle,
  // atan2 in screen coordinates, falls), a curve off it onto the exit lane,
  // and the departure. The entry curve and the arc are shared by every path
  // from one lane, and the exit curve by every path to one exit lane, which
  // is what leaderOf's approach and exit rules need. `boxEnter` is the
  // join, `boxExit` the leave, and `ring` maps an s between them to an
  // angle (Path.ringAngle).
  _ringPath(entry, lane, turn, exit, exitLane) {
    const O = this.origin, L = this.legLength;
    const ang = leg => Math.atan2(DIR[leg][1], DIR[leg][0]);
    const aIn = ang(entry) - ENTRY_SKEW;
    let aOut = ang(exit) + ENTRY_SKEW;
    while (aOut >= aIn) aOut -= 2 * Math.PI;
    const onRing = a => [O[0] + RING_R * Math.cos(a), O[1] + RING_R * Math.sin(a)];
    const tangent = a => [Math.sin(a), -Math.cos(a)];   // the direction of travel at angle a
    const cubic = (p0, h0, p1, h1, k, n, into) => {
      const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const c0 = [p0[0] + h0[0] * dist * k, p0[1] + h0[1] * dist * k];
      const c1 = [p1[0] - h1[0] * dist * k, p1[1] - h1[1] * dist * k];
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        into.push([
          u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0],
          u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1],
        ]);
      }
    };
    const split = (leg, ln, inbound, d) => {
      const p = this.lanePoint(leg, ln, inbound, d), r = rightOf([-DIR[leg][0], -DIR[leg][1]]), k = SPLIT * (inbound ? 1 : -1);
      return [p[0] + r[0] * k, p[1] + r[1] * k];
    };
    const pts = [this.lanePoint(entry, lane, true, L), this.lanePoint(entry, lane, true, YIELD_D + SPLIT_TAPER), split(entry, lane, true, YIELD_D)];
    cubic(pts[2], [-DIR[entry][0], -DIR[entry][1]], onRing(aIn), tangent(aIn), 0.4, 12, pts);
    const iJoin = pts.length - 1;
    const steps = Math.max(2, Math.ceil((aIn - aOut) * RING_R / 0.75));
    for (let i = 1; i <= steps; i++) pts.push(onRing(aIn - (aIn - aOut) * i / steps));
    const iLeave = pts.length - 1;
    cubic(pts[iLeave], tangent(aOut), split(exit, exitLane, false, YIELD_D), DIR[exit], 0.4, 12, pts);
    pts.push(this.lanePoint(exit, exitLane, false, YIELD_D + SPLIT_TAPER), this.lanePoint(exit, exitLane, false, L));
    const path = new Path({ key: this.pathKey(entry, lane, turn), entry, lane, turn, exit, exitLane, movement: `${entry}-${turn}`, points: pts, node: this.node });
    path.stopLine = path.lengthAt(2);
    path.boxEnter = path.lengthAt(iJoin);
    path.boxExit = path.lengthAt(iLeave);
    path.ring = { aIn, aOut, sIn: path.boxEnter, sOut: path.boxExit };
    return path;
  }
}

export class Path {
  constructor({ key, entry, lane, turn, exit, exitLane, movement, points, node = 0 }) {
    this.key = key; this.entry = entry; this.lane = lane; this.turn = turn;
    this.exit = exit; this.exitLane = exitLane; this.movement = movement;
    this.node = node;
    this.link = null;           // { node, entry, atS } when this path feeds another box
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    this.length = this.cum[this.cum.length - 1];
    this.stopLine = 0; this.boxEnter = 0; this.boxExit = 0;
    this.ring = null;           // { aIn, aOut, sIn, sOut } on a roundabout's path
  }

  // The angle on the ring (screen atan2, falling as the car goes round) of
  // the point s along a roundabout's path, for s from the join to the leave.
  ringAngle(s) {
    const r = this.ring;
    return r.aIn - (r.aIn - r.aOut) * (s - r.sIn) / (r.sOut - r.sIn);
  }

  // The s at which this path's arc reaches the ring angle `a`, or null
  // when its arc does not pass that angle.
  sAtAngle(a) {
    const r = this.ring;
    let w = (r.aIn - a) % (2 * Math.PI);
    if (w < 0) w += 2 * Math.PI;
    if (w > r.aIn - r.aOut + 1e-9) return null;
    return r.sIn + w * (r.sOut - r.sIn) / (r.aIn - r.aOut);
  }

  lengthAt(i) { return this.cum[Math.max(0, Math.min(i, this.cum.length - 1))]; }

  // Position and heading (radians, screen coords) at arc length s. Clamped.
  at(s) {
    const cum = this.cum, pts = this.points;
    if (s <= 0) return this._seg(0, 0);
    if (s >= this.length) return this._seg(pts.length - 2, 1);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const segLen = cum[lo + 1] - cum[lo];
    return this._seg(lo, segLen > 0 ? (s - cum[lo]) / segLen : 0);
  }

  _seg(i, t) {
    const [ax, ay] = this.points[i], [bx, by] = this.points[i + 1];
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, heading: Math.atan2(by - ay, bx - ax) };
  }

  inBox(s) { return s > this.boxEnter && s < this.boxExit; }

  // Does a vehicle of `len` metres centred at s overlap the box at all?
  touchesBox(s, len) { return s + len / 2 > this.boxEnter && s - len / 2 < this.boxExit; }
}

// Join two nodes: every path of `a` leaving by `legA` continues onto `b`'s
// paths entering by `legB`, in the same lane. The legs must meet or overlap
// (a gap between them would be road nobody built): with 110 m legs that is
// a spacing of 220 m or less, and `atS` is how far along b's approach a's
// leg ends.
export function linkNodes(a, legA, b, legB) {
  const da = DIR[legA];
  const endA = [a.origin[0] + da[0] * a.legLength, a.origin[1] + da[1] * a.legLength];
  const db = DIR[legB];
  const startB = [b.origin[0] + db[0] * b.legLength, b.origin[1] + db[1] * b.legLength];
  // distance from b's leg start to a's leg end, measured toward b's centre
  const atS = -((endA[0] - startB[0]) * db[0] + (endA[1] - startB[1]) * db[1]);
  if (atS < -1e-6) throw new Error(`nodes ${a.node} and ${b.node} leave a ${(-atS).toFixed(1)} m gap between ${legA} and ${legB}`);
  if (atS > b.legLength - b.stopDist - 20) throw new Error(`nodes ${a.node} and ${b.node} overlap too far: ${atS.toFixed(1)} m into the approach`);
  const lateral = Math.abs((endA[0] - startB[0]) * db[1] - (endA[1] - startB[1]) * db[0]);
  if (lateral > 1e-6) throw new Error(`legs ${legA} of node ${a.node} and ${legB} of node ${b.node} are not on one line`);
  for (const p of a.paths.values()) if (p.exit === legA) p.link = { node: b.node, entry: legB, atS: Math.max(0, atS) };
  if (!b.linkedIn.includes(legB)) b.linkedIn.push(legB);
}

// Build a level's nodes: one, or `nodes` of them along an east-west main
// street `spacing` metres apart, joined end to end.
export function buildNodes(spec = {}) {
  const { nodes = 1, spacing = 220, ...rest } = spec;
  if (nodes <= 1) return [new Network({ ...rest, origin: [0, 0], node: 0 })];
  const out = [];
  const x0 = -spacing * (nodes - 1) / 2;
  for (let i = 0; i < nodes; i++) out.push(new Network({ ...rest, origin: [x0 + i * spacing, 0], node: i }));
  for (let i = 0; i + 1 < out.length; i++) {
    linkNodes(out[i], 'E', out[i + 1], 'W');
    linkNodes(out[i + 1], 'W', out[i], 'E');
  }
  return out;
}

// Is a point inside an oriented rectangle?
export function pointInRect(x, y, r) {
  const c = Math.cos(r.heading), s = Math.sin(r.heading);
  const dx = x - r.x, dy = y - r.y;
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  return Math.abs(u) <= r.length / 2 && Math.abs(v) <= r.width / 2;
}

// Oriented rectangle overlap by separating axes: the collision test.
export function rectsOverlap(a, b) {
  const axes = [];
  for (const r of [a, b]) {
    const c = Math.cos(r.heading), s = Math.sin(r.heading);
    axes.push([c, s], [-s, c]);
  }
  const corners = r => {
    const c = Math.cos(r.heading), s = Math.sin(r.heading);
    const hx = r.length / 2, hy = r.width / 2;
    return [[hx, hy], [hx, -hy], [-hx, -hy], [-hx, hy]].map(([px, py]) => [r.x + px * c - py * s, r.y + px * s + py * c]);
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, ay] of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, y] of ca) { const p = x * ax + y * ay; if (p < minA) minA = p; if (p > maxA) maxA = p; }
    for (const [x, y] of cb) { const p = x * ax + y * ay; if (p < minB) minB = p; if (p > maxB) maxB = p; }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

export { parseMovement };
