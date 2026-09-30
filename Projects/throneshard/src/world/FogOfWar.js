// Per-team visibility grids (1 unit cells). Vision is blocked by trees and by higher elevation levels.
import * as THREE from 'three';

export class FogOfWar {
  constructor(half = 100) {
    this.half = half;
    this.W = half * 2;
    const n = this.W * this.W;
    this.tree = new Uint8Array(n);
    this.level = new Int8Array(n);
    this.vis = { sunward: new Uint8Array(n), duskward: new Uint8Array(n) };
    this.target = new Float32Array(n);
    this.display = new Float32Array(n);
    this.texData = new Uint8Array(n);
    this.texture = new THREE.DataTexture(this.texData, this.W, this.W, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.display.fill(0);
  }

  idx(x, z) {
    const i = Math.floor(x + this.half), j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.W || j >= this.W) return -1;
    return j * this.W + i;
  }

  setTree(x, z, r, delta) {
    const i0 = Math.floor(x - r + this.half), i1 = Math.floor(x + r + this.half);
    const j0 = Math.floor(z - r + this.half), j1 = Math.floor(z + r + this.half);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= this.W || j >= this.W) continue;
      const cx = i - this.half + 0.5, cz = j - this.half + 0.5;
      if ((cx - x) ** 2 + (cz - z) ** 2 > (r + 0.35) ** 2 && !(Math.floor(x + this.half) === i && Math.floor(z + this.half) === j)) continue;
      const k = j * this.W + i;
      this.tree[k] = Math.max(0, Math.min(255, this.tree[k] + delta));
    }
    this._cache?.clear();
  }

  // viewers: [{x, z, r, flying}]
  // Each viewer's visible cell set is ray-cast from its cell centre and cached (LRU) by (cell, radius, flying):
  // static viewers (towers, buildings, wards) and clumped creeps cost one array copy instead of ~20k ray steps.
  // The cache is dropped whenever the tree grid changes (cut / regrow).
  compute(team, viewers) {
    const vis = this.vis[team];
    if (!vis) return;
    vis.fill(0);
    const W = this.W, h = this.half;
    const cache = this._cache ??= new Map();
    const seen = this._seen ??= new Set();
    seen.clear();
    for (const v of viewers) {
      const ci = Math.floor(v.x + h), cj = Math.floor(v.z + h);
      if (ci < -30 || cj < -30 || ci > W + 30 || cj > W + 30) continue;
      const rq = Math.max(0, Math.round(v.r * 4)) / 4;
      const key = ((ci + 40) * 400 + (cj + 40)) * 4096 + Math.min(4095, rq * 16) * 2 + (v.flying ? 1 : 0);
      if (seen.has(key)) continue;
      seen.add(key);
      let list = cache.get(key);
      if (list) { cache.delete(key); cache.set(key, list); } else {
        list = this._cast(ci, cj, rq, !!v.flying);
        cache.set(key, list);
        if (cache.size > 900) cache.delete(cache.keys().next().value);
      }
      for (let q = 0; q < list.length; q++) vis[list[q]] = 1;
    }
    this.version = (this.version ?? 0) + 1;
    this.visVersion ??= {};
    this.visVersion[team] = this.version;
  }

  _cast(ci, cj, r, flying) {
    const W = this.W, lvl = this.level, tree = this.tree;
    const stamp = this._stamp ??= new Uint32Array(W * W);
    this._stampId = (this._stampId ?? 0) + 1;
    if (this._stampId >= 0xffffffff) { stamp.fill(0); this._stampId = 1; }
    const sid = this._stampId;
    const buf = this._buf ??= new Uint16Array(W * W);
    let n = 0;
    const push = (k) => { if (stamp[k] !== sid) { stamp[k] = sid; buf[n++] = k; } };
    const cx = ci + 0.5, cz = cj + 0.5;
    const k0 = ci >= 0 && cj >= 0 && ci < W && cj < W ? cj * W + ci : -1;
    const myLvl = flying ? 9 : k0 >= 0 ? lvl[k0] : 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < W && j < W) push(j * W + i);
    }
    if (r > 0) {
      const rays = Math.max(32, Math.ceil(Math.PI * 2 * r * 1.25));
      const step = 0.5;
      for (let a = 0; a < rays; a++) {
        const ang = (a / rays) * Math.PI * 2;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        let last = -1;
        for (let t = step; t <= r; t += step) {
          const i = Math.floor(cx + dx * t), j = Math.floor(cz + dz * t);
          if (i < 0 || j < 0 || i >= W || j >= W) break;
          const k = j * W + i;
          if (k === last) continue;
          last = k;
          if (!flying && lvl[k] > myLvl) break;
          push(k);
          if (!flying && tree[k] && t > 1.2) break;
        }
      }
    }
    return buf.slice(0, n);
  }

  isVisible(team, x, z) {
    const vis = this.vis[team];
    if (!vis) return true;
    const k = this.idx(x, z);
    if (k < 0) return false;
    return vis[k] === 1;
  }

  // Smoothly blend the displayed fog texture towards the given team's visibility. Incremental: only cells whose
  // 3x3 neighbourhood changed since the last visibility update are re-blurred, and only cells still fading are
  // blended (active list), at most ~30 Hz.
  updateTexture(team, rawDt) {
    const vis = this.vis[team];
    if (!vis) { this.texData.fill(255); this.texture.needsUpdate = true; return; }
    const W = this.W, n = W * W, T = this.target, D = this.display, out = this.texData;
    const ver = this.visVersion?.[team] ?? -1;
    const fresh = ver !== this._blurVer || team !== this._blurTeam;
    if (!fresh && this._settled) return;
    this._acc = (this._acc ?? 0) + rawDt;
    if (!fresh && this._acc < 1 / 30) return;
    rawDt = this._acc; this._acc = 0;
    const prev = this._prev ??= new Uint8Array(n);
    const mark = this._mark ??= new Uint8Array(n);
    const act = this._act ??= new Int32Array(n);
    const blurAt = (k) => {
      const i = k % W, j = (k - i) / W;
      const j0 = j > 0 ? j - 1 : j, j1 = j < W - 1 ? j + 1 : j, i0 = i > 0 ? i - 1 : i, i1 = i < W - 1 ? i + 1 : i;
      T[k] = (vis[j0 * W + i0] + vis[j0 * W + i] + vis[j0 * W + i1] + vis[j * W + i0] + vis[k] * 4 + vis[j * W + i1]
        + vis[j1 * W + i0] + vis[j1 * W + i] + vis[j1 * W + i1]) / 12;
      if (!mark[k] && T[k] !== D[k]) { mark[k] = 1; act[this._nAct++] = k; }
    };
    this._nAct ??= 0;
    if (fresh || !this._blurInit) {
      const full = team !== this._blurTeam || !this._blurInit;
      this._blurVer = ver; this._blurTeam = team; this._blurInit = true;
      if (full) {
        mark.fill(0); this._nAct = 0;
        for (let k = 0; k < n; k++) blurAt(k);
        prev.set(vis);
      } else {
        for (let k = 0; k < n; k++) {
          if (vis[k] === prev[k]) continue;
          prev[k] = vis[k];
          const i = k % W, j = (k - i) / W;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= W) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = i + di;
              if (ii >= 0 && ii < W) blurAt(jj * W + ii);
            }
          }
        }
      }
    }
    const a = Math.min(1, rawDt * 6);
    let m = 0;
    for (let q = 0; q < this._nAct; q++) {
      const k = act[q];
      const diff = T[k] - D[k];
      const ad = diff < 0 ? -diff : diff;
      if (ad < 0.002) { D[k] = T[k]; out[k] = T[k] * 255; mark[k] = 0; continue; }
      const d = D[k] + diff * a;
      D[k] = d;
      out[k] = d * 255;
      act[m++] = k;
    }
    this._nAct = m;
    this._settled = m === 0;
    this.texture.needsUpdate = true;
  }

  fillDisplay(v) {
    this._settled = false;
    this._blurInit = false; // next update re-blurs and re-activates every cell
    this.display.fill(v);
    this.texData.fill(v * 255);
    this.texture.needsUpdate = true;
  }
}
