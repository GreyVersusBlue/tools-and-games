// Small deterministic noise / math helpers used by world generation.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Hash-based gradient noise (2D), range roughly [-1, 1]
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h;
}
function grad(ix, iz, seed, fx, fz) {
  const h = hash2(ix, iz, seed) & 7;
  const gx = [1, -1, 1, -1, 1.41, -1.41, 0, 0][h];
  const gz = [1, 1, -1, -1, 0, 0, 1.41, -1.41][h];
  return gx * fx + gz * fz;
}
export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = grad(ix, iz, seed, fx, fz);
  const b = grad(ix + 1, iz, seed, fx - 1, fz);
  const c = grad(ix, iz + 1, seed, fx, fz - 1);
  const d = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 0.9;
}
export function fbm(x, z, oct = 4, seed = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += noise2(x * f, z * f, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}
