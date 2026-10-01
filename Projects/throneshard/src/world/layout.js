// Analytic map layout: height function, lane/river/base masks, reserved zones. Pure functions (no three.js).
import {
  LANES, TOWERS, BARRACKS, NEUTRAL_CAMPS, SHOPS, FOUNTAIN, THRONESHARD, GRIMMAW_LAIR,
} from '../core/constants.js';
import { fbm, noise2, smoothstep, clamp } from './noise.js';

export const EXT = 120; // terrain mesh half extent (map is +-100, rest is scenic border)
export const HG = 2.4; // high ground plateau height
export const WATER_Y = -0.4; // river surface height
export const RIVER_BED = -1.05;

const SQ2 = Math.SQRT2;

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return x * x + z * z;
}

// ---- lanes ----
export const laneSegs = [];
for (const key of Object.keys(LANES)) {
  const pts = LANES[key];
  for (let i = 0; i < pts.length - 1; i++) laneSegs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
}
// Lanes start inside the base next to the throneshard: connect lane starts to the throneshards so base floors look joined.
for (const t of ['sunward', 'duskward']) {
  const [ax, az] = THRONESHARD[t];
  for (const key of Object.keys(LANES)) {
    const p = t === 'sunward' ? LANES[key][0] : LANES[key][LANES[key].length - 1];
    laneSegs.push([ax, az, p[0], p[1]]);
  }
  const [fx, fz] = FOUNTAIN[t];
  laneSegs.push([ax, az, fx, fz]);
}
export function laneDist(x, z) {
  let m = Infinity;
  for (let i = 0; i < laneSegs.length; i++) {
    const s = laneSegs[i];
    const d = segDist2(x, z, s[0], s[1], s[2], s[3]);
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}
export const riverDist = (x, z) => Math.abs(x - z) / SQ2;

// ---- base plateaus ----
function roundBoxSDF(px, pz, cx, cz, hx, hz, r) {
  const qx = Math.abs(px - cx) - hx + r, qz = Math.abs(pz - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
// negative inside either base plateau
export function plateauSDF(x, z) {
  const a = roundBoxSDF(x, z, -93, 93, 47, 47, 16);
  const b = roundBoxSDF(-x, -z, -93, 93, 47, 47, 16);
  return Math.min(a, b);
}

// Find where each lane crosses the plateau boundary -> ramps.
export const ramps = [];
(function findRamps() {
  for (const key of Object.keys(LANES)) {
    const pts = LANES[key];
    const walk = (list) => {
      for (let i = 0; i < list.length - 1; i++) {
        const [ax, az] = list[i], [bx, bz] = list[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s <= len; s += 0.25) {
          const x = ax + ((bx - ax) * s) / len, z = az + ((bz - az) * s) / len;
          if (plateauSDF(x, z) > 0) {
            ramps.push({ x, z, dx: (bx - ax) / len, dz: (bz - az) / len, lane: key });
            return;
          }
        }
      }
    };
    walk(pts);
    walk([...pts].reverse());
  }
})();
export function rampFactor(x, z) {
  let f = 0;
  for (const r of ramps) {
    const px = x - r.x, pz = z - r.z;
    const along = px * r.dx + pz * r.dz;
    const lat = Math.abs(-px * r.dz + pz * r.dx);
    const v = (1 - smoothstep(5.5, 8.5, lat)) * (1 - smoothstep(9, 12, Math.abs(along)));
    if (v > f) f = v;
  }
  return f;
}

// ---- reserved zones (no trees / cliffs / props) ----
export const reserved = [];
for (const team of ['sunward', 'duskward']) {
  for (const t of TOWERS[team]) reserved.push({ x: t.pos[0], z: t.pos[1], r: 6.5, kind: 'tower', team });
  for (const b of BARRACKS[team]) reserved.push({ x: b.pos[0], z: b.pos[1], r: 7, kind: 'rax', team });
  reserved.push({ x: THRONESHARD[team][0], z: THRONESHARD[team][1], r: 13, kind: 'throneshard', team });
  reserved.push({ x: FOUNTAIN[team][0], z: FOUNTAIN[team][1], r: 14, kind: 'fountain', team });
  reserved.push({ x: SHOPS[team][0], z: SHOPS[team][1], r: 7, kind: 'shop', team });
}
for (const s of SHOPS.secret) reserved.push({ x: s[0], z: s[1], r: 8, kind: 'secret' });
for (const c of NEUTRAL_CAMPS) reserved.push({ x: c.pos[0], z: c.pos[1], r: 8, kind: 'camp' });
reserved.push({ x: GRIMMAW_LAIR[0], z: GRIMMAW_LAIR[1], r: 11, kind: 'grimmaw' });

export function reservedDist(x, z) {
  let m = Infinity;
  for (const r of reserved) {
    const d = Math.hypot(x - r.x, z - r.z) - r.r;
    if (d < m) m = d;
  }
  return m;
}

// ---- jungle paths: connect camps/hidden bazaars to lanes & river ----
export const pathSegs = [];
(function buildPaths() {
  const nearestLanePoint = (x, z) => {
    let best = null, bd = Infinity;
    for (const s of laneSegs) {
      const dx = s[2] - s[0], dz = s[3] - s[1];
      const l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - s[0]) * dx + (z - s[1]) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const px = s[0] + dx * t, pz = s[1] + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < bd && plateauSDF(px, pz) > 4) { bd = d; best = [px, pz]; }
    }
    return best;
  };
  const pois = [...NEUTRAL_CAMPS.map((c) => c.pos), ...SHOPS.secret];
  for (const [x, z] of pois) {
    const lp = nearestLanePoint(x, z);
    if (lp) pathSegs.push([x, z, lp[0], lp[1]]);
    const m = (x + z) / 2; // river projection
    pathSegs.push([x, z, m, m]);
  }
  // camp-to-camp links for jungle routes (nearest neighbour per camp)
  for (let i = 0; i < pois.length; i++) {
    let bj = -1, bd = Infinity;
    for (let j = 0; j < pois.length; j++) {
      if (i === j) continue;
      if (Math.sign(pois[i][0] - pois[i][1]) !== Math.sign(pois[j][0] - pois[j][1])) continue; // same side
      const d = Math.hypot(pois[i][0] - pois[j][0], pois[i][1] - pois[j][1]);
      if (d < bd) { bd = d; bj = j; }
    }
    if (bj >= 0 && bd < 45) pathSegs.push([pois[i][0], pois[i][1], pois[bj][0], pois[bj][1]]);
  }
  // Grimmaw's lair entrance from the river & from nearby lane
  pathSegs.push([GRIMMAW_LAIR[0], GRIMMAW_LAIR[1], GRIMMAW_LAIR[0] - 22, GRIMMAW_LAIR[1] + 22]);
  pathSegs.push([GRIMMAW_LAIR[0], GRIMMAW_LAIR[1], GRIMMAW_LAIR[0] + 22, GRIMMAW_LAIR[1] - 22]);
})();
export function pathDist(x, z) {
  let m = Infinity;
  for (const s of pathSegs) {
    const d = segDist2(x, z, s[0], s[1], s[2], s[3]);
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

// 0 = Sunward, 1 = Duskward corruption
export function corruption(x, z) {
  const n = fbm(x * 0.03, z * 0.03, 3, 7) * 10;
  return smoothstep(-6, 12, (x - z) / SQ2 + n);
}
export function distToDuskwardBase(x, z) { return Math.hypot(x - THRONESHARD.duskward[0], z - THRONESHARD.duskward[1]); }

// ---- height ----
export function plateauFactor(x, z) {
  const ramp = rampFactor(x, z);
  const warp = fbm(x * 0.06, z * 0.06, 3, 3) * 2.2 * (1 - ramp);
  const sdf = plateauSDF(x, z) + warp;
  const w = 1.5 + ramp * 16;
  return { t: smoothstep(w / 2, -w / 2, sdf), ramp };
}

export function computeHeight(x, z, lane = laneDist(x, z), resD = reservedDist(x, z), pathD = pathDist(x, z), t = plateauFactor(x, z).t) {
  const rd = riverDist(x, z) + fbm(x * 0.05, z * 0.05, 3, 11) * 1.8;
  const grim = Math.hypot(x - GRIMMAW_LAIR[0], z - GRIMMAW_LAIR[1]);
  let bed = RIVER_BED * (1 - smoothstep(3, 9, rd)) * smoothstep(9, 13, grim);
  // jungle hills
  const jm = smoothstep(7, 15, lane) * smoothstep(11, 18, riverDist(x, z)) * smoothstep(0, 7, resD)
    * smoothstep(1.5, 5, pathD);
  let hills = Math.max(0, fbm(x * 0.03 + 5, z * 0.03, 4, 21) + 0.15) * 2.0 * jm;
  hills = Math.min(hills, 1.15);
  // tiny surface undulation everywhere
  const micro = noise2(x * 0.25, z * 0.25, 5) * 0.06;
  const low = bed + hills + micro;
  const high = HG + micro + Math.max(0, fbm(x * 0.05, z * 0.05, 3, 31)) * 0.4 * smoothstep(4, 10, lane) * smoothstep(0, 8, resD);
  let h = low + (high - low) * t;
  // scenic mountain rim outside the playable map
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = smoothstep(98, 110, edge) * Math.max(4.2, 5 + fbm(x * 0.04, z * 0.04, 4, 41) * 6);
  h += Math.max(0, rim);
  return h;
}

export function elevationLevel(h) {
  return h > 1.5 ? 1 : h < -0.55 ? -1 : 0;
}
