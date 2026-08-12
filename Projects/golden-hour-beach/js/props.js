import * as THREE from 'three';
import { groundHeight, LAYOUT } from './field.js';

// Everything standing on the sand. Before this the beach was 280 m by 106 m of
// empty ground: you could walk west for seventy seconds and arrive at a view
// identical to the one you left, with nothing marking that you had got anywhere.
// `Explore` has to reward walking, and the cheapest way to reward it is to give
// the eye somewhere to aim.
//
// Four things, each doing a different job:
//   groyne      a destination at the west end, and a silhouette from the start
//   rocks       a destination at the east end, half in the water
//   driftwood   mid-beach punctuation, so the walk between them isn't blank
//   wrack line  a reason to look down, running the full width
//
// Where each one sits is in field.js, which has no three.js import and is what
// test/smoke.mjs checks. This file only turns those numbers into meshes.

/**
 * Turn a primitive into something weathered: displace every vertex radially by a
 * smooth function of where it already is.
 *
 * A function of position, not a per-vertex random number. The random version
 * looked equivalent and wasn't: a sphere's pole is a fan of coincident vertices
 * with the same position and different indices, so independent jitter pulled them
 * apart into a crown of spikes. Every boulder in the cluster had one, and up
 * close they read as shards of glass rather than rock. Any two vertices at the
 * same point get the same displacement here, so seams and poles stay shut.
 */
const _v = new THREE.Vector3();
function roughen(geo, amount, seed) {
  const s = (seed >>> 0) % 1000 * 0.017;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const n = Math.sin(_v.x * 1.7 + s)
            * Math.sin(_v.y * 2.3 - s * 1.6)
            * Math.sin(_v.z * 1.9 + s * 2.4);
    _v.multiplyScalar(1 + n * amount);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------- groyne - */

function buildGroyne(mat) {
  // One merged buffer instead of 16 meshes: same picture, one draw call. The
  // posts never move relative to each other, so there is nothing to gain from
  // keeping them separate.
  const parts = [];
  for (const p of LAYOUT.groyne) {
    const len = p.top - p.base;
    const g = new THREE.CylinderGeometry(p.r * 0.88, p.r, len, 7, 1);
    roughen(g, 0.10, (p.x * 977 + p.z * 131) | 0);
    g.rotateZ(p.lean);
    g.translate(p.x, p.base + len / 2, p.z);
    parts.push(g);
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}

/* ---------------------------------------------------------------- driftwood - */

function buildDriftwood(mat) {
  const parts = [];
  for (const d of LAYOUT.driftwood) {
    const g = groundHeight(d.x, d.z);
    const trunk = new THREE.CylinderGeometry(d.r * 0.7, d.r, d.len, 8, 1);
    roughen(trunk, 0.14, d.seed);
    trunk.rotateZ(Math.PI / 2);                 // lay it down
    trunk.rotateX(d.roll);
    trunk.rotateY(d.yaw);
    trunk.translate(d.x, g + d.r - d.sink, d.z);
    parts.push(trunk);

    for (let b = 0; b < d.branches; b++) {
      const t = (b + 1) / (d.branches + 1) - 0.5;
      const bl = d.len * (0.22 + 0.16 * b);
      const br = new THREE.CylinderGeometry(d.r * 0.16, d.r * 0.3, bl, 5, 1);
      roughen(br, 0.2, d.seed + b * 7919);
      br.rotateZ(Math.PI / 2.6 + b * 0.5);
      br.rotateY(d.yaw + (b % 2 ? 1.1 : -1.3));
      br.translate(
        d.x + Math.cos(d.yaw) * t * d.len,
        g + d.r * 1.1,
        d.z - Math.sin(d.yaw) * t * d.len);
      parts.push(br);
    }
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}

/* -------------------------------------------------------------------- rocks - */

function buildRocks(mat) {
  const parts = [];
  for (const r of LAYOUT.rocks) {
    // 9×7 segments jittered by 0.34 made shards, not boulders — up close the
    // cluster read as a pile of broken glass. Rounder sphere, smooth displacement.
    const g = new THREE.SphereGeometry(r.r, 14, 10);
    roughen(g, 0.22, r.seed);
    g.scale(1, r.flat, 1);
    g.rotateY(r.yaw);
    g.translate(r.x, groundHeight(r.x, r.z) - r.sink, r.z);
    parts.push(g);
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}

/* -------------------------------------------------------------------- wrack - */

// 460 pieces of debris as three InstancedMeshes — three draw calls for the whole
// tide line. One mesh each, so the shells can be pale and the weed dark without
// a per-instance colour attribute.
function buildWrack() {
  const kinds = {
    shell: {
      geo: (() => { const g = new THREE.SphereGeometry(1, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(1, 0.5, 1.25); return g; })(),
      mat: new THREE.MeshStandardMaterial({ color: 0xe8d8c2, roughness: 0.7, side: THREE.DoubleSide }),
    },
    pebble: {
      geo: roughen(new THREE.SphereGeometry(1, 6, 5), 0.4, 0x51ab).scale(1, 0.55, 0.9),
      mat: new THREE.MeshStandardMaterial({ color: 0x7d6a58, roughness: 0.9 }),
    },
    weed: {
      geo: (() => { const g = new THREE.BoxGeometry(2.6, 0.18, 0.7); return roughen(g, 0.5, 0x9c2d); })(),
      mat: new THREE.MeshStandardMaterial({ color: 0x4a4630, roughness: 1.0 }),
    },
  };

  const byKind = { shell: [], pebble: [], weed: [] };
  for (const w of LAYOUT.wrack) byKind[w.kind].push(w);

  const out = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (const [name, list] of Object.entries(byKind)) {
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(kinds[name].geo, kinds[name].mat, list.length);
    list.forEach((w, i) => {
      e.set(w.tilt * 0.4, w.yaw, w.tilt);
      q.setFromEuler(e);
      // Half-buried: sitting a shell exactly on the surface makes it read as a
      // sticker. Sinking it by a third of its own size makes it read as sand.
      pos.set(w.x, groundHeight(w.x, w.z) - w.s * 0.33, w.z);
      scl.setScalar(w.s);
      inst.setMatrixAt(i, m.compose(pos, q, scl));
    });
    inst.instanceMatrix.needsUpdate = true;
    out.push(inst);
  }
  return out;
}

/* -------------------------------------------------------------------- fence - */

// The dune-trail fence: one merged mesh of leaning posts pacing the path.
function buildFence(mat) {
  const parts = [];
  for (const f of LAYOUT.dunes.fence) {
    const g = groundHeight(f.x, f.z);
    const post = new THREE.CylinderGeometry(0.055, 0.07, f.h + 0.5, 6, 1);
    roughen(post, 0.12, (f.x * 331 + f.z * 17) | 0);
    post.rotateZ(f.lean);
    post.translate(f.x, g + f.h / 2 - 0.25, f.z);
    parts.push(post);
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}

/* --------------------------------------------------------------- tide pools - */

// Still water in carved basins on the headland shelf, each ringed by low
// rocks. The water is a plain reflective disc, NOT a Water instance — five
// reflection render targets for five puddles would be the definition of not
// measuring first.
function buildTidePools(stoneMat) {
  const group = new THREE.Group();
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x14383c, roughness: 0.06, metalness: 0.55,
    transparent: true, opacity: 0.88,
  });
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(20250811);
  const rimParts = [];
  for (const p of LAYOUT.headland.pools) {
    const rimN = 8 + (rnd() * 4 | 0);
    for (let i = 0; i < rimN; i++) {
      const a = (i / rimN) * Math.PI * 2 + rnd() * 0.4;
      const rx = p.x + Math.cos(a) * p.r * 1.06;
      const rz = p.z + Math.sin(a) * p.r * 0.98;
      const rr = 0.14 + rnd() * 0.16;
      const rock = new THREE.SphereGeometry(rr, 8, 6);
      roughen(rock, 0.3, (rx * 977 + rz * 131) | 0);
      rock.scale(1, 0.65, 1);
      rock.translate(rx, groundHeight(rx, rz) + rr * 0.2, rz);
      rimParts.push(rock);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.9, 22), waterMat);
    disc.rotation.x = -Math.PI / 2;
    // Water sits partway up the basin: below the rim, above the bottom.
    disc.position.set(p.x, groundHeight(p.x, p.z) + p.depth * 0.55, p.z);
    group.add(disc);
  }
  group.add(new THREE.Mesh(mergeGeometries(rimParts), stoneMat));
  return group;
}

/* ------------------------------------------------------------------- merge --- */

/**
 * Concatenate non-indexed BufferGeometries sharing an attribute set.
 *
 * three ships `BufferGeometryUtils.mergeGeometries`, but pulling it in means
 * vendoring another addon for forty lines of array copying, and locked decision
 * #18 says a new addon has to mirror three's own `examples/jsm/` folder layout
 * rather than being flattened next to Sky.js. Not worth a folder. Everything
 * here comes out of the primitive constructors with the same three attributes.
 */
function mergeGeometries(geos) {
  const names = ['position', 'normal', 'uv'];
  const nonIndexed = geos.map(g => (g.index ? g.toNonIndexed() : g));
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const size = nonIndexed[0].attributes[name].itemSize;
    let total = 0;
    for (const g of nonIndexed) total += g.attributes[name].count * size;
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of nonIndexed) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].count * size;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of nonIndexed) g.dispose();
  return merged;
}

/* -------------------------------------------------------------------- build - */

export function buildProps(scene) {
  const group = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({ color: 0x6a5747, roughness: 0.95 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x4b4550, roughness: 0.82 });

  group.add(buildGroyne(wood));
  group.add(buildDriftwood(wood));
  group.add(buildRocks(stone));
  group.add(buildFence(wood));
  group.add(buildTidePools(stone));
  for (const inst of buildWrack()) group.add(inst);

  scene.add(group);
  return group;
}
