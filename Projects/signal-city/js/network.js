// Signal City: the road network. Pure geometry, no DOM.
//
// Units are metres, y grows downward (canvas convention), the intersection's
// centre is the origin. A leg is a road leaving the centre toward a compass
// point; each carries `lanesPerDir` inbound lanes (on the driver's right as
// they arrive, right-hand traffic) and the same number outbound.
//
// A Path is one vehicle's whole line through the map: a polyline with
// cumulative arc length, so a car is a single number `s` along it and every
// question the cars ask (how far to the stop line, am I inside the box, where
// is the car ahead) is arithmetic on s. Paths are built once per (entry leg,
// lane, movement) and shared.
//
// Lane index 0 is the curb lane. With two lanes per direction, lefts leave
// from lane 1 (inner), rights from lane 0, throughs from either.

import { LEGS, exitLeg, parseMovement } from './signals.js';

export const LANE_WIDTH = 3.5;
export const CROSSWALK = 3.0;      // depth of the crosswalk band, from the box edge outward
export const STOP_GAP = 0.6;       // stop line sits this far before the crosswalk

const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };   // outward unit vector per leg

// Right-hand perpendicular of a heading (x, y) in screen coordinates.
function rightOf([x, y]) { return [-y, x]; }

export function legDir(leg) { return DIR[leg]; }

export class Network {
  constructor({ legs = LEGS.slice(), lanesPerDir = 1, legLength = 110, cornerRadius = 5 } = {}) {
    this.legs = legs.slice();
    this.lanesPerDir = lanesPerDir;
    this.legLength = legLength;
    this.halfRoad = lanesPerDir * LANE_WIDTH;          // half the road's width
    this.boxHalf = this.halfRoad + cornerRadius;        // the box edge, where the crosswalk starts
    this.stopDist = this.boxHalf + CROSSWALK + STOP_GAP; // stop line distance from centre
    this.cornerRadius = cornerRadius;
    this.paths = new Map();                             // key -> Path
    this._cross = new Map();
    this._build();
  }

  // Which lanes a turn may leave from.
  lanesForTurn(turn) {
    const n = this.lanesPerDir;
    if (n === 1) return [0];
    if (turn === 'L') return [n - 1];
    if (turn === 'R') return [0];
    return Array.from({ length: n }, (_, i) => i);
  }

  // Centre point of a lane on a leg at distance d from the intersection
  // centre. inbound: on the driver's right as they arrive. lane 0 = curb.
  lanePoint(leg, lane, inbound, d) {
    const out = DIR[leg];
    const arriveHeading = [-out[0], -out[1]];
    const r = rightOf(arriveHeading);
    const off = (this.lanesPerDir - lane - 0.5) * LANE_WIDTH * (inbound ? 1 : -1);
    return [out[0] * d + r[0] * off, out[1] * d + r[1] * off];
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
          const p = this._makePath(entry, lane, turn, exit, exitLane);
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
    const path = new Path({ key: this.pathKey(entry, lane, turn), entry, lane, turn, exit, exitLane, movement: `${entry}-${turn}`, points: pts });
    // arc-length marks
    path.stopLine = path.lengthAt(1);
    path.boxEnter = path.lengthAt(2);
    path.boxExit = path.lengthAt(pts.length - 2);
    return path;
  }
}

export class Path {
  constructor({ key, entry, lane, turn, exit, exitLane, movement, points }) {
    this.key = key; this.entry = entry; this.lane = lane; this.turn = turn;
    this.exit = exit; this.exitLane = exitLane; this.movement = movement;
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    this.length = this.cum[this.cum.length - 1];
    this.stopLine = 0; this.boxEnter = 0; this.boxExit = 0;
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
