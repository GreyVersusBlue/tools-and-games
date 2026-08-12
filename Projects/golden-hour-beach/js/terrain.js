import * as THREE from 'three';
import { groundHeight, shorelineZ, trailX, riverX } from './field.js';

// Beach terrain: the sand, the wet strips at the waterline, and the grass.
// The heightfield itself lives in field.js, which imports nothing, so
// test/smoke.mjs can check the ground and the prop layout without a browser —
// terrain.js can't be imported under Node at all, because the bare `three`
// specifier only resolves through index.html's import map.
//
// The coast is 1.8 km wide now, so the single displaced plane became a grid of
// 100 m chunks built once at load — three fixed densities by row (sea floor
// coarse, shoreline band fine, dunes middling), every chunk a static mesh
// sharing one material, culled by the frustum like anything else. No
// streaming, no rebuilds: ~110k vertices of attributes total, which is
// nothing, and measuring came first (locked decision #42).

function makeProceduralSandTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c7a878';
  ctx.fillRect(0, 0, 512, 512);
  // speckle
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const v = Math.random();
    ctx.fillStyle = v < 0.5
      ? `rgba(${170 + Math.random() * 40 | 0},${140 + Math.random() * 30 | 0},${95 + Math.random() * 25 | 0},0.5)`
      : `rgba(${215 + Math.random() * 30 | 0},${190 + Math.random() * 25 | 0},${150 + Math.random() * 20 | 0},0.35)`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  // faint larger blotches
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(160,130,90,${0.03 + Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Low-frequency blotchy grayscale, tiled at a different repeat than the sand map
 * so multiplying it in breaks up the sand's tiling without adding a single byte
 * of asset (locked decision #42, and this is the project that rule came from).
 *
 * At a 60×34 repeat over the 400×220 terrain plane each sand tile is ~6.6 m,
 * which stretches the photographed ripples into a visible diagonal moiré —
 * every copy of the tile looks identical, so the eye locks onto the repeat.
 * Raising the repeat only trades that for a smaller, more frequent version of
 * the same problem. Modulating the diffuse by a second texture at a much lower,
 * non-matching repeat makes neighbouring copies of the sand tile read as
 * differently lit instead of identical, which is what actually breaks the
 * "wallpaper" look — the underlying ripple pattern is still tiled, but nothing
 * is asking you to notice that anymore.
 */
function detailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.filter = 'blur(18px)';
  for (let i = 0; i < 22; i++) {
    const v = 60 + Math.random() * 140 | 0;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 128, 22 + Math.random() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 1×64 alpha ramp: transparent at both ends of V, solid through the middle. */
function edgeFadeTexture() {
  const c = document.createElement('canvas');
  c.width = 1; c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.00, '#000');
  grad.addColorStop(0.22, '#fff');
  grad.addColorStop(0.70, '#fff');
  grad.addColorStop(1.00, '#000');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 1, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * A chunk's displaced grid. Normals come from the heightfield's own gradient
 * (central differences) rather than computeVertexNormals — per-chunk local
 * normals disagree at shared borders and draw a visible lighting seam down
 * every chunk edge; the analytic gradient is identical from both sides.
 */
function chunkGeometry(x0, z0, size, depth, step) {
  const nx = Math.round(size / step), nz = Math.round(depth / step);
  const geo = new THREE.PlaneGeometry(size, depth, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + size / 2, 0, z0 + depth / 2);
  const pos = geo.attributes.position;
  const normals = new Float32Array(pos.count * 3);
  const EPS = 0.6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const dhx = (groundHeight(x + EPS, z) - groundHeight(x - EPS, z)) / (2 * EPS);
    const dhz = (groundHeight(x, z + EPS) - groundHeight(x, z - EPS)) / (2 * EPS);
    const inv = 1 / Math.hypot(dhx, 1, dhz);
    normals[i * 3] = -dhx * inv; normals[i * 3 + 1] = inv; normals[i * 3 + 2] = -dhz * inv;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

export function buildTerrain(scene) {
  const CHUNK = 100;
  const X0 = -900, X1 = 900;
  // Rows front to back: sea floor (coarse — it's under the Water plane),
  // the shoreline band every coastline crosses (fine), the dunes (middling).
  const ROWS = [
    { z0: -140, depth: 100, step: 8 },
    { z0: -40, depth: 100, step: 2, wet: true },
    { z0: 60, depth: 100, step: 4 },
  ];

  const sandTex = makeProceduralSandTexture();
  // Integer repeat per 100 m chunk: each chunk's UVs run 0..1, so an integer
  // count keeps the tile phase continuous across every seam. 15 per 100 m is
  // the same ~6.7 m tile the single plane had.
  sandTex.repeat.set(15, 15);

  const mat = new THREE.MeshStandardMaterial({
    map: sandTex,
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0.0,
  });

  // Second sampler at its own repeat, multiplied into the diffuse in the
  // fragment shader. MeshStandardMaterial has no second-repeat diffuse input of
  // its own (aoMap modulates only indirect light, off a separate UV set), so
  // this is the plain way to get one without a custom ShaderMaterial.
  const detailMap = detailTexture();
  mat.onBeforeCompile = shader => {
    shader.uniforms.detailMap = { value: detailMap };
    // Integer for the same seam-phase reason as the sand repeat.
    shader.uniforms.detailRepeat = { value: new THREE.Vector2(3, 3) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform sampler2D detailMap;\nuniform vec2 detailRepeat;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  float sandDetail = texture2D( detailMap, vMapUv * detailRepeat ).r;
  diffuseColor.rgb *= mix( 0.82, 1.16, sandDetail );
#endif`);
  };
  mat.customProgramCacheKey = () => 'golden-hour-sand-detail';

  const chunkGroup = new THREE.Group();
  for (const row of ROWS) {
    for (let x0 = X0; x0 < X1; x0 += CHUNK) {
      const mesh = new THREE.Mesh(chunkGeometry(x0, row.z0, CHUNK, row.depth, row.step), mat);
      mesh.receiveShadow = true;
      chunkGroup.add(mesh);
    }
  }
  scene.add(chunkGroup);

  // Upgrade to the real photographed sand once it has decoded. The procedural
  // canvas above is what's on screen until then, and what stays there if these
  // files ever go missing.
  //
  // These used to be hotlinked from dl.polyhaven.org, which made this the one
  // page on the site that still reached offsite at runtime. Vendored in session 7:
  // 370 KB of CC0 JPEG is nothing against this repo, it stops handing a third
  // party the IP address of everyone who opens the beach, and it means every
  // visitor sees the same shoreline instead of whichever one the CDN felt like
  // serving. Same call v4 made for three.js. Source and licence: assets/textures/README.md.
  const loader = new THREE.TextureLoader();
  const phBase = 'assets/textures/aerial_beach_01';
  loader.load(`${phBase}_diff_1k.jpg`, tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(15, 15);
    mat.map = tex;
    mat.needsUpdate = true;
    loader.load(`${phBase}_nor_gl_1k.jpg`, nor => {
      nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
      nor.repeat.set(15, 15);
      mat.normalMap = nor;
      mat.normalScale.set(0.6, 0.6);
      mat.needsUpdate = true;
    }, undefined, () => {});
  }, undefined, () => { /* keep procedural */ });

  // Wet sand near the waterline: darker, slightly reflective overlay, one
  // strip per shoreline chunk, each strip's vertices placed at
  // shorelineZ(x) + offset so the dark band bends around the headland with
  // the water instead of running straight past it. The alpha ramp along V
  // fades both edges — without it the strip's rectangle reads as tape.
  const wetMat = new THREE.MeshStandardMaterial({
    color: 0x8a6f4d,
    transparent: true,
    opacity: 0.55,
    alphaMap: edgeFadeTexture(),
    roughness: 0.25,
    metalness: 0.05,
  });
  const wetGroup = new THREE.Group();
  for (let x0 = X0; x0 < X1; x0 += CHUNK) {
    const wetGeo = new THREE.PlaneGeometry(CHUNK, 14, 50, 10);
    wetGeo.rotateX(-Math.PI / 2);
    const wp = wetGeo.attributes.position;
    for (let i = 0; i < wp.count; i++) {
      const x = wp.getX(i) + x0 + CHUNK / 2;
      const z = shorelineZ(x) + 3 + wp.getZ(i);
      wp.setX(i, x); wp.setZ(i, z);
      wp.setY(i, groundHeight(x, z) + 0.015);
    }
    wetGeo.computeVertexNormals();
    wetGroup.add(new THREE.Mesh(wetGeo, wetMat));
  }
  scene.add(wetGroup);

  // Grass tufts — dunes, trailsides, and the headland top.
  const grass = buildGrass();
  scene.add(grass);

  // The river: a still ribbon following the channel down to the mouth, its
  // surface a fixed height above the carved bed so it slopes with the land.
  // The big Water plane takes over where the sea reaches in.
  scene.add(buildRiver());

  // Reed beds along the banks.
  scene.add(buildReeds());

  return { chunks: chunkGroup, wet: wetGroup };
}

function buildRiver() {
  const Z0 = -12, Z1 = 106, STEP = 2, HALF = 4.2;
  const positions = [], indices = [];
  let row = 0;
  for (let z = Z0; z <= Z1; z += STEP, row++) {
    const cx = riverX(z);
    const y = groundHeight(cx, z) + 0.26;
    positions.push(cx - HALF, y, z, cx + HALF, y, z);
    if (row > 0) {
      const a = (row - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a4a44, roughness: 0.12, metalness: 0.35,
    transparent: true, opacity: 0.88,
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * Reeds: the grass-billboard technique grown up — taller, darker, straighter,
 * crowding the river banks. Same vertex-shader billboarding, its own mesh.
 */
function buildReeds() {
  const positions = [], roots = [], corners = [], colors = [], indices = [];
  const cA = new THREE.Color(0x4a5c38), cB = new THREE.Color(0x6a6b42), tmp = new THREE.Color();
  let vi = 0, placed = 0, guard = 0;
  while (placed < 900 && guard++ < 9000) {
    const z = 4 + Math.random() * 100;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = riverX(z) + side * (5 + Math.random() * 9);
    if (groundHeight(x, z) < 0.2) continue;
    const blades = 2 + (Math.random() * 3 | 0);
    for (let b = 0; b < blades; b++) {
      const bx = x + (Math.random() - 0.5) * 0.4;
      const bz = z + (Math.random() - 0.5) * 0.4;
      const bh = groundHeight(bx, bz);
      const tall = 1.2 + Math.random() * 1.0;
      const lean = (Math.random() - 0.5) * 0.12;
      const half = 0.03 + Math.random() * 0.015;
      tmp.lerpColors(cA, cB, Math.random());
      const rootCol = [tmp.r * 0.8, tmp.g * 0.8, tmp.b * 0.8];
      const tipCol = [tmp.r, tmp.g, tmp.b * 0.7];
      const tip = half * 0.3;
      for (let c = 0; c < 4; c++) {
        roots.push(bx, bh, bz);
        positions.push(bx, bh + (c >= 2 ? tall : 0), bz);
        colors.push(...(c >= 2 ? tipCol : rootCol));
      }
      corners.push(-half, 0, half, 0, -tip + lean, tall, tip + lean, tall);
      indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
    placed++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(roots, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec3 aRoot;\nattribute vec2 aCorner;')
      .replace('#include <begin_vertex>', `
        vec3 toCam = cameraPosition - aRoot;
        toCam.y = 0.0;
        float toCamLen = length(toCam);
        vec3 camDir = toCamLen > 0.0001 ? toCam / toCamLen : vec3(0.0, 0.0, 1.0);
        vec3 bladeRight = vec3(-camDir.z, 0.0, camDir.x);
        vec3 transformed = aRoot + bladeRight * aCorner.x + vec3(0.0, aCorner.y, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'golden-hour-grass-billboard';
  return new THREE.Mesh(geo, mat);
}

/**
 * Camera-facing quads instead of a LineSegments blade per tuft. A line has zero
 * width from a grazing angle (which is most of the time, since the dunes sit at
 * the far edge of a beach nobody is meant to walk toward) and reads as a yellow
 * scratch rather than grass at any distance. Each blade billboards around its
 * own root in the vertex shader — `cameraPosition` is one of three.js's
 * automatic `<common>` uniforms, so this needs no per-frame JS, just like the
 * line version it replaces: one draw call either way.
 *
 * Billboarding is Y-axis only (the blade stays upright and rotates to face the
 * camera's horizontal bearing), not a full sprite-style billboard — a grass
 * blade that also tipped to follow camera pitch would look like it was falling
 * over every time someone looked down at their feet.
 */
function buildGrass() {
  const group = new THREE.Group();
  const bladeCount = 6000;
  const positions = [];   // only needs to be roughly right for frustum culling
  const roots = [];
  const corners = [];
  const colors = [];
  const indices = [];
  const cA = new THREE.Color(0x8a9a5b), cB = new THREE.Color(0xb5a642), tmp = new THREE.Color();

  let placed = 0, guard = 0, vi = 0;
  while (placed < bladeCount && guard++ < bladeCount * 10) {
    const x = (Math.random() - 0.5) * 1560;
    const z = 26 + Math.random() * 128;
    const h = groundHeight(x, z);
    if (h < 2.2) continue; // only on raised ground (dunes, headland top)
    if (z > 48 && Math.abs(x - trailX(z)) < 4.5) continue; // keep the trail bare — it's a path
    // clump of blades
    const blades = 3 + (Math.random() * 4 | 0);
    for (let b = 0; b < blades; b++) {
      const bx = x + (Math.random() - 0.5) * 0.5;
      const bz = z + (Math.random() - 0.5) * 0.5;
      const bh = groundHeight(bx, bz);
      const tall = 0.5 + Math.random() * 0.8;
      const lean = (Math.random() - 0.5) * 0.35;
      const half = 0.035 + Math.random() * 0.02;
      tmp.lerpColors(cA, cB, Math.random());
      const rootCol = [tmp.r, tmp.g, tmp.b];
      const tipCol = [tmp.r * 0.7, tmp.g * 0.7, tmp.b * 0.55];

      // Four corners of one blade's quad: base-left, base-right, tip-left,
      // tip-right. `aRoot` is the same world position for all four (the
      // billboard pivot); `aCorner` is the local offset the vertex shader
      // applies after computing that root's own billboard axis. `lean`
      // shifts the tip corners along the billboard's local right axis,
      // same windswept effect the line version got from shifting the tip
      // vertex in world X/Z, just expressed in the new local frame. The tip
      // corners are also pulled in to a fifth of the base width — a blade
      // that stays full width to its tip reads as a plank, not a grass leaf.
      const tip = half * 0.2;
      for (let c = 0; c < 4; c++) {
        roots.push(bx, bh, bz);
        positions.push(bx, bh + (c >= 2 ? tall : 0), bz);
        colors.push(...(c >= 2 ? tipCol : rootCol));
      }
      corners.push(-half, 0, half, 0, -tip + lean, tall, tip + lean, tall);
      indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
    placed++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(roots, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec3 aRoot;\nattribute vec2 aCorner;')
      .replace('#include <begin_vertex>', `
        vec3 toCam = cameraPosition - aRoot;
        toCam.y = 0.0;
        float toCamLen = length(toCam);
        vec3 camDir = toCamLen > 0.0001 ? toCam / toCamLen : vec3(0.0, 0.0, 1.0);
        vec3 bladeRight = vec3(-camDir.z, 0.0, camDir.x);
        vec3 transformed = aRoot + bladeRight * aCorner.x + vec3(0.0, aCorner.y, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'golden-hour-grass-billboard';

  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  return group;
}
