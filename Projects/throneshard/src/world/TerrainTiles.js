import * as THREE from 'three';

// The heightfield as ONE mesh / two draw calls. The 16x16 tiles are still culled individually (main camera frustum and
// sun shadow frustum), but instead of one Mesh per tile (16 main + ~17 shadow draws per frame, each with its own
// matrix/uniform/VAO work) the visible tiles' indices are packed into a single dynamic index buffer:
//   [ main-pass tiles | shadow-pass tiles ]
// and geometry.drawRange is switched to the shadow half around the shadow draw (onBeforeShadow/onAfterShadow). The
// index is only re-uploaded when a visible tile set changes (camera crossing a tile border), and only the changed half.
// Main tiles are packed near-to-far (camera looks north) so early-z still rejects hidden terrain fragments.
export class TerrainTiles {
  // geo: indexed PlaneGeometry-layout grid (cells x cells quads); tiles: tiles per side
  constructor(geo, material, cells, tiles, sun) {
    this.sun = sun;
    const src = geo.index.array, pos = geo.attributes.position;
    const per = Math.ceil(cells / tiles);
    this.tiles = [];
    let total = 0, castTotal = 0;
    const v = new THREE.Vector3();
    for (let ty = tiles - 1; ty >= 0; ty--) for (let tx = 0; tx < tiles; tx++) {
      const x0 = tx * per, x1 = Math.min(cells, x0 + per), y0 = ty * per, y1 = Math.min(cells, y0 + per);
      if (x0 >= x1 || y0 >= y1) continue;
      const idx = new Uint32Array((x1 - x0) * (y1 - y0) * 6);
      let k = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * cells + x) * 6;
        for (let q = 0; q < 6; q++) idx[k++] = src[o + q];
      }
      const box = new THREE.Box3();
      for (let q = 0; q < idx.length; q++) box.expandByPoint(v.fromBufferAttribute(pos, idx[q]));
      box.expandByScalar(0.01);
      // only tiles with real relief (cliffs, ramps, river banks) can cast visible shadows
      const cast = box.max.y - box.min.y > 0.9;
      this.tiles.push({ idx, sphere: box.getBoundingSphere(new THREE.Sphere()), cast });
      total += idx.length;
      if (cast) castTotal += idx.length;
    }
    this.mainCap = total;
    const index = new THREE.BufferAttribute(new Uint32Array(total + castTotal), 1);
    index.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.setDrawRange(0, 0);
    this.geometry = g;

    const mesh = (this.mesh = new THREE.Mesh(g, material));
    mesh.name = 'ground-tiles';
    mesh.frustumCulled = false; // culled per tile below
    mesh.receiveShadow = true;
    mesh.castShadow = castTotal > 0;
    this.mainCount = 0;
    this.shadowCount = 0;
    this._mainKey = new Uint8Array(this.tiles.length);
    this._shadowKey = new Uint8Array(this.tiles.length);
    this._mainKey.fill(2); this._shadowKey.fill(2); // force the first build
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    mesh.onBeforeShadow = () => { g.drawRange.start = this.mainCap; g.drawRange.count = this.shadowCount; };
    mesh.onAfterShadow = () => { g.drawRange.start = 0; g.drawRange.count = this.mainCount; };
  }

  // Call right before the scene is rendered with `camera` (matrices up to date). shadowPass: the sun shadow map will be
  // re-rendered in this render call.
  cull(camera, shadowPass) {
    const g = this.geometry;
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    this.mainCount = this._pack(this._frustum, 0, this._mainKey, false);
    if (shadowPass && this.mesh.castShadow && this.sun) {
      const sh = this.sun.shadow;
      sh.updateMatrices(this.sun);
      this.shadowCount = this._pack(sh.getFrustum(), this.mainCap, this._shadowKey, true);
    }
    g.drawRange.start = 0;
    g.drawRange.count = this.mainCount;
  }

  _pack(frustum, base, key, castOnly) {
    const tiles = this.tiles;
    let changed = false;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const vis = (!castOnly || t.cast) && frustum.intersectsSphere(t.sphere) ? 1 : 0;
      if (key[i] !== vis) { key[i] = vis; changed = true; }
    }
    if (!changed) return base === 0 ? this.mainCount : this.shadowCount;
    const index = this.geometry.index, arr = index.array;
    let n = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (!key[i]) continue;
      arr.set(tiles[i].idx, base + n);
      n += tiles[i].idx.length;
    }
    if (n > 0) {
      index.addUpdateRange(base, n);
      index.needsUpdate = true;
    }
    return n;
  }
}
