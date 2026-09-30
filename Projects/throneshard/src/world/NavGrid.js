// Grid navigation: fine occupancy grid (0.5u) for walkability, coarse grid (1u) for A* + line-of-sight smoothing.
import * as THREE from 'three';

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class NavGrid {
  constructor(half = 100, cell = 0.5) {
    this.half = half;
    this.cell = cell;
    this.W = Math.round((half * 2) / cell);
    const n = this.W * this.W;
    this.stat = new Uint8Array(n); // static blockers (cliffs, bounds, props)
    this.tree = new Uint8Array(n); // tree occupancy counters
    this.dyn = new Uint16Array(n); // dynamic blockers (structures, abilities)
    this.ratio = 2; // fine cells per coarse cell
    this.CW = this.W / this.ratio;
    this.ccell = cell * this.ratio;
    const cn = this.CW * this.CW;
    this.cblock = new Uint8Array(cn);
    this.comp = new Int32Array(cn);
    this.compDirty = true;
    // A* buffers
    this.g = new Float32Array(cn);
    this.parent = new Int32Array(cn);
    this.openStamp = new Uint32Array(cn);
    this.closedStamp = new Uint32Array(cn);
    this.stamp = 0;
    this.heap = new Int32Array(cn + 8);
    this.heapF = new Float32Array(cn + 8);
    this.heapPos = new Int32Array(cn);
    this.heapN = 0;
    this.stack = new Int32Array(cn);
    this.maxExpand = 40000;
    this.heightFn = () => 0;
    this.stats = { calls: 0, totalMs: 0, lastMs: 0, maxMs: 0 };
  }

  // ---- fine grid ----
  fi(x) { return Math.floor((x + this.half) / this.cell); }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.W && j < this.W; }
  fineFree(k) { return !this.stat[k] && !this.tree[k] && !this.dyn[k]; }
  isWalkable(x, z) {
    const i = this.fi(x), j = this.fi(z);
    if (!this.inBounds(i, j)) return false;
    return this.fineFree(j * this.W + i);
  }

  rebuildCoarse(i0 = 0, j0 = 0, i1 = this.CW - 1, j1 = this.CW - 1) {
    const r = this.ratio, W = this.W;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(this.CW - 1, i1); j1 = Math.min(this.CW - 1, j1);
    for (let cj = j0; cj <= j1; cj++) for (let ci = i0; ci <= i1; ci++) {
      let blocked = 0;
      for (let dj = 0; dj < r && !blocked; dj++) for (let di = 0; di < r; di++) {
        const k = (cj * r + dj) * W + ci * r + di;
        if (!this.fineFree(k)) { blocked = 1; break; }
      }
      const ck = cj * this.CW + ci;
      if (this.cblock[ck] !== blocked) { this.cblock[ck] = blocked; this.compDirty = true; }
    }
  }

  // apply fn(k) to fine cells whose centre lies within circle
  _circle(x, z, r, fn) {
    const c = this.cell;
    const i0 = Math.max(0, this.fi(x - r)), i1 = Math.min(this.W - 1, this.fi(x + r));
    const j0 = Math.max(0, this.fi(z - r)), j1 = Math.min(this.W - 1, this.fi(z + r));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const cz = -this.half + (j + 0.5) * c - z;
      for (let i = i0; i <= i1; i++) {
        const cx = -this.half + (i + 0.5) * c - x;
        if (cx * cx + cz * cz <= r2) fn(j * this.W + i);
      }
    }
    const R = this.ratio;
    this.rebuildCoarse(Math.floor(i0 / R), Math.floor(j0 / R), Math.floor(i1 / R), Math.floor(j1 / R));
  }
  blockCircle(x, z, r) { this._circle(x, z, r, (k) => { if (this.dyn[k] < 65535) this.dyn[k]++; }); }
  unblockCircle(x, z, r) { this._circle(x, z, r, (k) => { if (this.dyn[k] > 0) this.dyn[k]--; }); }
  addTree(x, z, r) { this._circle(x, z, r, (k) => { if (this.tree[k] < 255) this.tree[k]++; }); }
  removeTree(x, z, r) { this._circle(x, z, r, (k) => { if (this.tree[k] > 0) this.tree[k]--; }); }
  staticCircle(x, z, r) { this._circle(x, z, r, (k) => { this.stat[k] = 1; }); }

  // nearest fine-walkable point (spiral search), returns {x,z} or null
  nearestWalkable(x, z, maxR = 12) {
    if (this.isWalkable(x, z)) return { x, z };
    const ci = this.fi(x), cj = this.fi(z), c = this.cell;
    const maxRing = Math.ceil(maxR / c);
    for (let ring = 1; ring <= maxRing; ring++) {
      let best = null, bd = Infinity;
      for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const i = ci + di, j = cj + dj;
        if (!this.inBounds(i, j) || !this.fineFree(j * this.W + i)) continue;
        const px = -this.half + (i + 0.5) * c, pz = -this.half + (j + 0.5) * c;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) { bd = d; best = { x: px, z: pz }; }
      }
      if (best) return best;
    }
    return null;
  }

  // ---- coarse grid ----
  ci(x) { return Math.floor((x + this.half) / this.ccell); }
  cCenter(i) { return -this.half + (i + 0.5) * this.ccell; }
  coarseFree(i, j) { return i >= 0 && j >= 0 && i < this.CW && j < this.CW && !this.cblock[j * this.CW + i]; }

  labelComponents() {
    const CW = this.CW, n = CW * CW, comp = this.comp, st = this.stack;
    comp.fill(-1);
    let label = 0;
    for (let s = 0; s < n; s++) {
      if (this.cblock[s] || comp[s] >= 0) continue;
      let sp = 0; st[sp++] = s; comp[s] = label;
      while (sp) {
        const k = st[--sp];
        const i = k % CW, j = (k / CW) | 0;
        for (let d = 0; d < 4; d++) {
          const ni = i + DX[d], nj = j + DZ[d];
          if (ni < 0 || nj < 0 || ni >= CW || nj >= CW) continue;
          const nk = nj * CW + ni;
          if (this.cblock[nk] || comp[nk] >= 0) continue;
          comp[nk] = label; st[sp++] = nk;
        }
      }
      label++;
    }
    this.compDirty = false;
  }

  // nearest free coarse cell to (i,j) (optionally in component c)
  nearestCoarse(i, j, maxRing = 40, comp = -1) {
    const ok = (a, b) => this.coarseFree(a, b) && (comp < 0 || this.comp[b * this.CW + a] === comp);
    if (ok(i, j)) return j * this.CW + i;
    for (let ring = 1; ring <= maxRing; ring++) {
      let best = -1, bd = Infinity;
      for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        if (!ok(i + di, j + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = (j + dj) * this.CW + i + di; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // Amanatides-Woo traversal over coarse cells; false if any blocked
  los(x0, z0, x1, z1) {
    const cs = this.ccell, h = this.half;
    let fx0 = (x0 + h) / cs, fz0 = (z0 + h) / cs, fx1 = (x1 + h) / cs, fz1 = (z1 + h) / cs;
    let i = Math.floor(fx0), j = Math.floor(fz0);
    const ie = Math.floor(fx1), je = Math.floor(fz1);
    const dx = fx1 - fx0, dz = fz1 - fz0;
    const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = si ? Math.abs(1 / dx) : Infinity, tdz = sj ? Math.abs(1 / dz) : Infinity;
    let tmx = si > 0 ? (i + 1 - fx0) * tdx : si < 0 ? (fx0 - i) * tdx : Infinity;
    let tmz = sj > 0 ? (j + 1 - fz0) * tdz : sj < 0 ? (fz0 - j) * tdz : Infinity;
    let steps = Math.abs(ie - i) + Math.abs(je - j) + 2;
    if (!this.coarseFree(i, j)) return false;
    while (steps-- > 0) {
      if (i === ie && j === je) return true;
      if (Math.abs(tmx - tmz) < 1e-9) {
        // passing exactly through a corner: require both side cells free
        if (!this.coarseFree(i + si, j) || !this.coarseFree(i, j + sj)) return false;
        i += si; j += sj; tmx += tdx; tmz += tdz;
      } else if (tmx < tmz) { i += si; tmx += tdx; } else { j += sj; tmz += tdz; }
      if (!this.coarseFree(i, j)) return false;
    }
    return true;
  }

  // ---- heap ----
  _push(k, f) {
    let p = this.heapN++;
    const H = this.heap, F = this.heapF, P = this.heapPos;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (F[q] <= f) break;
      H[p] = H[q]; F[p] = F[q]; P[H[p]] = p; p = q;
    }
    H[p] = k; F[p] = f; P[k] = p;
  }
  _decrease(k, f) {
    const H = this.heap, F = this.heapF, P = this.heapPos;
    let p = P[k];
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (F[q] <= f) break;
      H[p] = H[q]; F[p] = F[q]; P[H[p]] = p; p = q;
    }
    H[p] = k; F[p] = f; P[k] = p;
  }
  _pop() {
    const H = this.heap, F = this.heapF, P = this.heapPos;
    const top = H[0];
    const n = --this.heapN;
    if (n > 0) {
      const k = H[n], f = F[n];
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= f) break;
        H[p] = H[c]; F[p] = F[c]; P[H[p]] = p; p = c;
      }
      H[p] = k; F[p] = f; P[k] = p;
    }
    return top;
  }

  // Returns array of Vector3 waypoints (excluding start) or null.
  findPath(from, to) {
    const t0 = performance.now();
    const res = this._findPath(from, to);
    const ms = performance.now() - t0;
    const s = this.stats;
    s.calls++; s.totalMs += ms; s.lastMs = ms; if (ms > s.maxMs) s.maxMs = ms;
    return res;
  }

  _findPath(from, to) {
    const CW = this.CW;
    let gx = to.x, gz = to.z;
    // goal on blocked fine cell -> nearest walkable
    if (!this.isWalkable(gx, gz)) {
      const nw = this.nearestWalkable(gx, gz, 8);
      if (!nw) return null;
      gx = nw.x; gz = nw.z;
    }
    const mk = (x, z) => new THREE.Vector3(x, this.heightFn(x, z), z);
    // trivial: direct line of sight
    if (this.los(from.x, from.z, gx, gz)) return [mk(gx, gz)];

    if (this.compDirty) this.labelComponents();
    const s = this.nearestCoarse(this.ci(from.x), this.ci(from.z), 8);
    if (s < 0) return null;
    const sc = this.comp[s];
    let g = this.nearestCoarse(this.ci(gx), this.ci(gz), 6, sc);
    let goalReplaced = false;
    if (g < 0 || this.comp[g] !== sc) {
      g = this.nearestCoarse(this.ci(gx), this.ci(gz), 60, sc);
      if (g < 0) return null;
      goalReplaced = true;
    } else if (!this.coarseFree(this.ci(gx), this.ci(gz))) {
      // goal fine-walkable but inside a partially blocked coarse cell -> still aim at exact point at the end
    }
    const gi = g % CW, gj = (g / CW) | 0;

    // A*
    const stamp = ++this.stamp;
    const G = this.g, PAR = this.parent, OS = this.openStamp, CS = this.closedStamp;
    this.heapN = 0;
    const hw = 1.08;
    const hfn = (i, j) => {
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return (dx > dz ? dx + (SQRT2 - 1) * dz : dz + (SQRT2 - 1) * dx) * hw;
    };
    G[s] = 0; PAR[s] = -1; OS[s] = stamp;
    this._push(s, hfn(s % CW, (s / CW) | 0));
    let found = false, expanded = 0, bestK = s, bestH = Infinity;
    while (this.heapN > 0) {
      const k = this._pop();
      if (k === g) { found = true; break; }
      CS[k] = stamp;
      const i = k % CW, j = (k / CW) | 0;
      const gk = G[k];
      if (++expanded > this.maxExpand) break;
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DZ[d];
        if (ni < 0 || nj < 0 || ni >= CW || nj >= CW) continue;
        const nk = nj * CW + ni;
        if (this.cblock[nk] || CS[nk] === stamp) continue;
        let cost = 1;
        if (d >= 4) {
          if (this.cblock[j * CW + ni] || this.cblock[nj * CW + i]) continue;
          cost = SQRT2;
        }
        const ng = gk + cost;
        if (OS[nk] !== stamp) {
          OS[nk] = stamp; G[nk] = ng; PAR[nk] = k;
          const hh = hfn(ni, nj);
          if (hh < bestH) { bestH = hh; bestK = nk; }
          this._push(nk, ng + hh);
        } else if (ng < G[nk]) {
          G[nk] = ng; PAR[nk] = k;
          this._decrease(nk, ng + hfn(ni, nj));
        }
      }
    }
    let end = found ? g : bestK;
    if (!found) goalReplaced = true;
    // reconstruct
    const cells = [];
    for (let k = end; k >= 0; k = PAR[k]) { cells.push(k); if (k === s) break; }
    cells.reverse();
    const pts = [{ x: from.x, z: from.z }];
    for (let q = 1; q < cells.length; q++) {
      const k = cells[q];
      pts.push({ x: this.cCenter(k % CW), z: this.cCenter((k / CW) | 0) });
    }
    if (!goalReplaced) pts.push({ x: gx, z: gz });
    if (pts.length === 1) {
      // start cell == goal cell region
      if (cells.length) { const k = cells[0]; pts.push({ x: this.cCenter(k % CW), z: this.cCenter((k / CW) | 0) }); }
      else return null;
    }
    // string pulling
    const out = [];
    let ax = pts[0].x, az = pts[0].z;
    let i = 1;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.los(ax, az, pts[j + 1].x, pts[j + 1].z)) j++;
      out.push(mk(pts[j].x, pts[j].z));
      ax = pts[j].x; az = pts[j].z;
      i = j + 1;
    }
    return out;
  }
}
