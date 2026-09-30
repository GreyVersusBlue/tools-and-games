import { LANES, TEAM } from '../core/constants.js';

// Polyline helper for lane waypoints: projection (arc-length progress) + sampling.
export class LanePath {
  constructor(points) {
    this.points = points.map(([x, z]) => ({ x, z }));
    this.cum = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  // -> { s (arc length), dist (lateral distance), seg (segment index) }
  project(x, z) {
    let best = { s: 0, dist: Infinity, seg: 0 };
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i], b = this.points[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + abx * t, pz = a.z + abz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.dist) best = { s: this.cum[i] + Math.sqrt(len2) * t, dist: d, seg: i };
    }
    return best;
  }

  pointAt(s) {
    s = Math.max(0, Math.min(this.length, s));
    for (let i = 0; i < this.points.length - 1; i++) {
      if (s <= this.cum[i + 1] || i === this.points.length - 2) {
        const a = this.points[i], b = this.points[i + 1];
        const segLen = this.cum[i + 1] - this.cum[i] || 1;
        const t = Math.max(0, Math.min(1, (s - this.cum[i]) / segLen));
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
    }
    return { ...this.points[this.points.length - 1] };
  }

  // Unit direction of travel at arc length s
  dirAt(s) {
    const a = this.pointAt(s - 1), b = this.pointAt(s + 1);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }
}

// Paths ordered from each team's base toward the enemy base.
export const LANE_PATHS = {};
for (const team of [TEAM.SUNWARD, TEAM.DUSKWARD]) {
  LANE_PATHS[team] = {};
  for (const lane of Object.keys(LANES)) {
    const pts = team === TEAM.SUNWARD ? LANES[lane] : [...LANES[lane]].reverse();
    LANE_PATHS[team][lane] = new LanePath(pts);
  }
}

export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
