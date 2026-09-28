import * as THREE from 'three';
import { groundHeight, LAYOUT, CAVE } from './field.js';
import { REF, variant, instances, byVariant, pieceMesh } from './pieces.js';

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
// test/smoke.mjs checks. This file only turns those numbers into meshes, each
// a piece from the prop pack (pieces.js, B6).

/* ------------------------------------------------------------------- groyne - */

// Each post is a groyne-post piece (#665), picked by the seed the builder
// roughened it with, stretched from the reference post's r 0.2 and 3.9 m to
// its own, leaning where it leaned. Three variants, three draw calls.
function buildGroyne(pieces) {
  const posts = LAYOUT.groyne.map(p => {
    const len = p.top - p.base;
    return {
      v: variant((p.x * 977 + p.z * 131) | 0, 3),
      x: p.x, y: p.base + len / 2, z: p.z, rz: p.lean,
      sx: p.r / REF.groyne.r, sy: len / REF.groyne.len, sz: p.r / REF.groyne.r,
    };
  });
  return byVariant(pieces, ['groyne-post-1', 'groyne-post-2', 'groyne-post-3'], posts);
}

/* ---------------------------------------------------------------- driftwood - */

// The four logs are four pieces, each LAYOUT.driftwood's own log whole with
// its roll and branches in it (#666). The builder laid the trunk's lowest
// side at the sand less `sink`; the piece's base goes there, yawed.
function buildDriftwood(pieces) {
  return LAYOUT.driftwood.map((d, i) => {
    const mesh = pieceMesh(pieces, `driftwood-${i + 1}`);
    mesh.position.set(d.x, groundHeight(d.x, d.z) - d.sink, d.z);
    mesh.rotation.y = d.yaw;
    return mesh;
  });
}

/* -------------------------------------------------------------------- rocks - */

function buildRocks(pieces) {
  const rocks = LAYOUT.rocks.map(r => {
    const k = r.r / REF.boulder.r;
    return {
      v: variant(r.seed, 3),
      x: r.x, y: groundHeight(r.x, r.z) - r.sink, z: r.z, ry: r.yaw,
      sx: k, sy: k * r.flat, sz: k,
    };
  });
  return byVariant(pieces, ['boulder-1', 'boulder-2', 'boulder-3'], rocks);
}

/* -------------------------------------------------------------------- wrack - */

// 1,300 pieces of debris as three InstancedMeshes, three draw calls for the
// whole tide line, as before: one per kind, each drawing its piece.
function buildWrack(pieces) {
  const byKind = { shell: [], pebble: [], weed: [] };
  for (const w of LAYOUT.wrack) {
    const k = w.s / REF.wrack.s;
    // Half-buried: sitting a shell exactly on the surface makes it read as a
    // sticker. Sinking it by a third of its own size makes it read as sand.
    byKind[w.kind].push({
      x: w.x, y: groundHeight(w.x, w.z) - w.s * 0.33, z: w.z,
      rx: w.tilt * 0.4, ry: w.yaw, rz: w.tilt, sx: k,
    });
  }
  const out = [];
  for (const [kind, list] of Object.entries(byKind)) {
    if (list.length) out.push(instances(pieces, `wrack-${kind}`, list));
  }
  return out;
}

/* -------------------------------------------------------------------- fence - */

// The dune-trail fence: leaning posts pacing the path, each h + 0.5 long
// against the reference post's 1.475.
function buildFence(pieces) {
  const posts = LAYOUT.dunes.fence.map(f => ({
    v: variant((f.x * 331 + f.z * 17) | 0, 3),
    x: f.x, y: groundHeight(f.x, f.z) + f.h / 2 - 0.25, z: f.z, rz: f.lean,
    sy: (f.h + 0.5) / (REF.fence.h + 0.5),
  }));
  return byVariant(pieces, ['fence-post-1', 'fence-post-2', 'fence-post-3'], posts);
}

/* --------------------------------------------------------------- tide pools - */

// Still water in carved basins on the headland shelf, each ringed by low
// rocks. The water is a plain reflective disc, NOT a Water instance — five
// reflection render targets for five puddles would be the definition of not
// measuring first. The discs stay procedural; the rim is pool-stone pieces.
function buildTidePools(pieces) {
  const group = new THREE.Group();
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x14383c, roughness: 0.06, metalness: 0.55,
    transparent: true, opacity: 0.88,
  });
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(20250811);
  const rim = [];
  for (const p of LAYOUT.headland.pools) {
    const rimN = 8 + (rnd() * 4 | 0);
    for (let i = 0; i < rimN; i++) {
      const a = (i / rimN) * Math.PI * 2 + rnd() * 0.4;
      const rx = p.x + Math.cos(a) * p.r * 1.06;
      const rz = p.z + Math.sin(a) * p.r * 0.98;
      const rr = 0.14 + rnd() * 0.16;
      rim.push({
        v: variant((rx * 977 + rz * 131) | 0, 3),
        x: rx, y: groundHeight(rx, rz) + rr * 0.2, z: rz, sx: rr / REF.poolStone.r,
      });
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.9, 22), waterMat);
    disc.name = 'tide-pool-water';
    disc.rotation.x = -Math.PI / 2;
    // Water sits partway up the basin: below the rim, above the bottom.
    disc.position.set(p.x, groundHeight(p.x, p.z) + p.depth * 0.55, p.z);
    group.add(disc);
  }
  for (const inst of byVariant(pieces, ['pool-stone-1', 'pool-stone-2', 'pool-stone-3'], rim)) group.add(inst);
  return group;
}

/* --------------------------------------------------------------------- cave - */

// The cave's mouth: the recess itself is carved by the heightfield; this adds
// the fallen lintel blocks and rubble that make it read as a cave rather than
// a dent. The glowing pool inside belongs to main.js (it needs the night
// palette).
function buildCaveDressing(pieces) {
  const rnd = (s => () => (s = (s * 48271) % 2147483647) / 2147483647)(51966);
  // Big tumbled blocks flanking the entry.
  const blocks = [];
  for (const [dx, dz, r] of [[-4.5, 2.5, 1.6], [4.2, 2.1, 1.9], [-2.8, -1.5, 1.1], [3.4, -2, 0.9]]) {
    const x = CAVE.x + dx, z = CAVE.z + dz;
    blocks.push({
      v: variant(((CAVE.x + dx) * 977) | 0, 2),
      x, y: groundHeight(x, z) + r * 0.25, z, sx: r / REF.caveBlock.r,
    });
  }
  // Rubble across the floor.
  const rubble = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 5;
    const x = CAVE.x + Math.cos(a) * d, z = CAVE.z + Math.sin(a) * d * 0.8;
    const r = 0.12 + rnd() * 0.3;
    rubble.push({
      v: variant((x * 131 + z * 977) | 0, 2),
      x, y: groundHeight(x, z) + r * 0.3, z, sx: r / REF.caveRubble.r,
    });
  }
  return [
    ...byVariant(pieces, ['cave-block-1', 'cave-block-2'], blocks),
    ...byVariant(pieces, ['cave-rubble-1', 'cave-rubble-2'], rubble),
  ];
}

/* -------------------------------------------------------------------- build - */

export function buildProps(scene, pieces) {
  const group = new THREE.Group();
  group.name = 'props';

  for (const o of [
    ...buildGroyne(pieces),
    ...buildDriftwood(pieces),
    ...buildRocks(pieces),
    ...buildFence(pieces),
    buildTidePools(pieces),
    ...buildCaveDressing(pieces),
    ...buildWrack(pieces),
  ]) group.add(o);

  scene.add(group);
  return group;
}
