import * as THREE from 'three';
import { groundHeight, trailBlend, creekInfo, trailInfo, trailPoint } from './field.js';

// The mountainside itself: one big displaced plane with the trail blended in
// at the fragment level, and the undergrowth strung along the corridor the
// walker actually sees. The heightfield lives in field.js, which imports
// nothing, so the smoke test can check the ground without a browser.

/* ----------------------------------------------------------------- textures */

// Forest floor: dark humus, leaf litter, moss blotches. Procedural canvas —
// no bytes shipped, nothing to fail to load, and the site rule is zero
// offsite requests anyway.
function forestFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3f3a2c';
  ctx.fillRect(0, 0, 512, 512);
  // leaf litter speckle
  for (let i = 0; i < 24000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const v = Math.random();
    ctx.fillStyle = v < 0.55
      ? `rgba(${68 + Math.random() * 28 | 0},${58 + Math.random() * 22 | 0},${40 + Math.random() * 16 | 0},0.55)`
      : `rgba(${92 + Math.random() * 32 | 0},${78 + Math.random() * 24 | 0},${52 + Math.random() * 18 | 0},0.4)`;
    ctx.fillRect(x, y, 1.6, 1.1);
  }
  // moss blotches
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${40 + Math.random() * 20 | 0},${58 + Math.random() * 24 | 0},${34 + Math.random() * 14 | 0},${0.05 + Math.random() * 0.09})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 5 + Math.random() * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  // a few pale dead leaves
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${110 + Math.random() * 40 | 0},${92 + Math.random() * 30 | 0},${58 + Math.random() * 20 | 0},0.5)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2.4, 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Packed trail dirt: paler, stonier, boot-worn.
function trailDirtTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6e6150';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    ctx.fillStyle = v < 0.5
      ? `rgba(${122 + Math.random() * 36 | 0},${106 + Math.random() * 28 | 0},${80 + Math.random() * 22 | 0},0.5)`
      : `rgba(${80 + Math.random() * 24 | 0},${68 + Math.random() * 20 | 0},${52 + Math.random() * 14 | 0},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  // embedded pebbles
  for (let i = 0; i < 160; i++) {
    const g = 96 + Math.random() * 70 | 0;
    ctx.fillStyle = `rgba(${g},${g - 8},${g - 18},0.8)`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 0.8 + Math.random() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Low-frequency blotchy grayscale multiplied into the diffuse at its own
 * repeat — locked decision #42's tiling breaker, verbatim from Golden Hour's
 * terrain: neighbouring copies of the floor tile read as differently lit
 * instead of identical, which is what actually kills the wallpaper look.
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

/* ------------------------------------------------------------------- ground */

export function buildTerrain(scene) {
  // Wider than BOUNDS on every side: the walker can stand at the edge of the
  // walkable world and still see fog-swallowed hillside, not the void.
  const W = 420, D = 430, SEG = 280, CZ = 15;
  const geo = new THREE.PlaneGeometry(W, D, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, CZ);

  const pos = geo.attributes.position;
  const aTrail = new Float32Array(pos.count);
  const aCreek = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    aTrail[i] = trailBlend(x, z);
    const ck = creekInfo(x, z);
    aCreek[i] = isFinite(ck.dist) ? 1 - Math.min(1, ck.dist / 6) : 0;
  }
  geo.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 1));
  geo.setAttribute('aCreek', new THREE.BufferAttribute(aCreek, 1));
  geo.computeVertexNormals();

  const floorTex = forestFloorTexture();
  floorTex.repeat.set(70, 72);

  const mat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0.0,
  });

  const trailTex = trailDirtTexture();
  const detailMap = detailTexture();
  mat.onBeforeCompile = shader => {
    shader.uniforms.trailMap = { value: trailTex };
    shader.uniforms.detailMap = { value: detailMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aTrail;\nattribute float aCreek;\nvarying float vTrail;\nvarying float vCreek;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvTrail = aTrail;\nvCreek = aCreek;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform sampler2D trailMap;\nuniform sampler2D detailMap;\nvarying float vTrail;\nvarying float vCreek;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  // Packed dirt where the trail runs, forest floor everywhere else. The blend
  // rides a vertex attribute baked from the same trailBlend the walker's
  // footstep audio reads, so what you hear underfoot is what you see.
  vec3 trailCol = texture2D( trailMap, vMapUv * 1.35 ).rgb;
  float onTrail = smoothstep( 0.18, 0.82, vTrail );
  diffuseColor.rgb = mix( diffuseColor.rgb, trailCol, onTrail );
  // Damp darkening toward the creek.
  diffuseColor.rgb *= mix( 1.0, 0.6, vCreek );
  // Tiling breaker at its own low repeat (locked decision #42).
  float floorDetail = texture2D( detailMap, vMapUv * 0.11 ).r;
  diffuseColor.rgb *= mix( 0.8, 1.18, floorDetail );
#endif`);
  };
  mat.customProgramCacheKey = () => 'blue-hour-ground';

  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  const undergrowth = buildUndergrowth();
  scene.add(undergrowth.mesh);

  return { mesh, update: undergrowth.tick };
}

/* -------------------------------------------------------------- undergrowth */

// 4×2 atlas of 128² cells: fern, leafy shrub, bracken, thistle across the
// top; dead grass, sapling, deadfall sprout, mossy rock tuft along the
// bottom. alphaTest cuts the silhouettes out — no blending, no sorting, one
// draw call. Every stroke stays ≥3 px inside its cell so the mips don't
// bleed neighbours into each other.
function plantAtlas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);

  // fern (top row, first cell): arcs of leaflets from a central stem
  ctx.save();
  ctx.translate(64, 126);
  ctx.strokeStyle = '#33422c';
  ctx.lineWidth = 3;
  for (let f = 0; f < 7; f++) {
    const a = -Math.PI / 2 + (f - 3) * 0.38;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const ex = Math.cos(a) * 58, ey = Math.sin(a) * 58;
    ctx.quadraticCurveTo(ex * 0.5, ey * 0.5 - 8, ex, ey);
    ctx.stroke();
    for (let l = 1; l < 8; l++) {
      const t = l / 8;
      const px = ex * t * 0.94, py = (ey * t) - 8 * Math.sin(Math.PI * t) * 0.5;
      ctx.fillStyle = `rgba(${52 + l * 3},${76 + l * 3},${44 + l * 2},0.95)`;
      ctx.beginPath();
      ctx.ellipse(px, py, 9 * (1 - t * 0.6), 3.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // leafy shrub (top row, second cell): overlapping leaf blobs
  ctx.save();
  ctx.translate(192, 122);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 46;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.7 - 12;
    ctx.fillStyle = `rgba(${38 + Math.random() * 26 | 0},${54 + Math.random() * 30 | 0},${34 + Math.random() * 18 | 0},0.95)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 7 + Math.random() * 8, 5 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // dead grass (bottom row, first cell): thin pale strokes
  ctx.save();
  ctx.translate(64, 252);
  for (let i = 0; i < 30; i++) {
    const lean = (Math.random() - 0.5) * 40;
    ctx.strokeStyle = `rgba(${120 + Math.random() * 40 | 0},${104 + Math.random() * 30 | 0},${66 + Math.random() * 18 | 0},0.9)`;
    ctx.lineWidth = 1.6 + Math.random();
    ctx.beginPath();
    ctx.moveTo((Math.random() - 0.5) * 30, 0);
    ctx.quadraticCurveTo(lean * 0.4, -50, lean, -86 - Math.random() * 28);
    ctx.stroke();
  }
  ctx.restore();

  // sapling (bottom row, second cell): stem and sparse leaves
  ctx.save();
  ctx.translate(192, 252);
  ctx.strokeStyle = '#4a4032';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(4, -60, -2, -110);
  ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const t = 0.3 + Math.random() * 0.7;
    ctx.fillStyle = `rgba(${44 + Math.random() * 22 | 0},${62 + Math.random() * 26 | 0},${38 + Math.random() * 16 | 0},0.95)`;
    ctx.beginPath();
    ctx.ellipse((Math.random() - 0.5) * 34, -t * 108, 8 + Math.random() * 5, 4.5 + Math.random() * 3, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // bracken (top row, third cell): last summer's fern, rusted and drooping
  ctx.save();
  ctx.translate(320, 126);
  ctx.lineWidth = 2.5;
  for (let f = 0; f < 6; f++) {
    const a = -Math.PI / 2 + (f - 2.5) * 0.44;
    const tipX = Math.cos(a) * 56, tipY = Math.sin(a) * 56 * 0.35 - 3;
    const cX = Math.cos(a) * 30, cY = Math.sin(a) * 56 * 0.9;
    ctx.strokeStyle = '#5a4226';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(cX, cY, tipX, tipY);
    ctx.stroke();
    for (let l = 1; l < 7; l++) {
      const t = l / 7, mt = 1 - t;
      const px = 2 * mt * t * cX + t * t * tipX;
      const py = 2 * mt * t * cY + t * t * tipY;
      ctx.fillStyle = `rgba(${112 + l * 5},${78 + l * 3},${40 + l * 2},0.92)`;
      ctx.beginPath();
      ctx.ellipse(px, py, 7.5 * (1 - t * 0.5), 2.8, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // thistle (top row, fourth cell): one dark stalk, spiky paired leaves, and
  // a dull mauve head that never quite reads as a flower in this light
  ctx.save();
  ctx.translate(448, 126);
  ctx.strokeStyle = '#3c3a2e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(5, -58, 1, -104);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const y = -14 - i * 16;
    for (const s of [-1, 1]) {
      ctx.strokeStyle = '#464433';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s * 2, y);
      ctx.quadraticCurveTo(s * 16, y - 4, s * (22 - i * 2), y - 12 + i);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#54474a';
  ctx.beginPath(); ctx.ellipse(1, -106, 5.5, 7, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    ctx.strokeStyle = `rgba(${140 + Math.random() * 30 | 0},${110 + Math.random() * 20 | 0},${135 + Math.random() * 25 | 0},0.85)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(1, -110);
    ctx.lineTo(1 + Math.cos(a) * 10, -110 + Math.sin(a) * 10);
    ctx.stroke();
  }
  ctx.restore();

  // deadfall sprout (bottom row, third cell): a mossed-over log with a few
  // shoots that took their chance
  ctx.save();
  ctx.translate(320, 252);
  ctx.fillStyle = '#3c3428';
  ctx.beginPath();
  ctx.ellipse(0, -10, 52, 9, 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(70,88,52,0.5)';
  ctx.beginPath();
  ctx.ellipse(-10, -15, 34, 5, 0.06, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const x = -34 + i * 22 + Math.random() * 8;
    const h = 34 + Math.random() * 28;
    ctx.strokeStyle = '#4a4434';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, -12);
    ctx.quadraticCurveTo(x + 4, -12 - h * 0.6, x + (Math.random() - 0.5) * 10, -12 - h);
    ctx.stroke();
    for (let l = 0; l < 4; l++) {
      ctx.fillStyle = `rgba(${48 + Math.random() * 20 | 0},${66 + Math.random() * 22 | 0},${40 + Math.random() * 14 | 0},0.9)`;
      ctx.beginPath();
      ctx.ellipse(x + (Math.random() - 0.5) * 14, -16 - Math.random() * h, 5.5, 3, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // mossy rock tuft (bottom row, fourth cell): a half-buried stone wearing
  // its green coat, dead grass leaning out from behind it
  ctx.save();
  ctx.translate(448, 252);
  for (let i = 0; i < 12; i++) {
    const x0 = (Math.random() - 0.5) * 44;
    ctx.strokeStyle = `rgba(${96 + Math.random() * 30 | 0},${96 + Math.random() * 26 | 0},${60 + Math.random() * 16 | 0},0.85)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, -14);
    ctx.quadraticCurveTo(x0 + (Math.random() - 0.5) * 10, -34, x0 + (Math.random() - 0.5) * 24, -40 - Math.random() * 16);
    ctx.stroke();
  }
  ctx.fillStyle = '#545850';
  ctx.beginPath(); ctx.ellipse(0, -16, 28, 16, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random();
    ctx.fillStyle = `rgba(${52 + Math.random() * 18 | 0},${72 + Math.random() * 22 | 0},${42 + Math.random() * 14 | 0},${0.35 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 22 * r, -18 + Math.sin(a) * 12 * r, 4 + Math.random() * 5, 3 + Math.random() * 3, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Ferns, shrubs, dead grass and saplings strung along the trail corridor —
 * one merged mesh of camera-billboarded quads, Golden Hour's dune-grass
 * technique with a texture atlas instead of vertex-coloured blades. Each quad
 * billboards around its own root in the vertex shader (Y-axis only — a fern
 * that tipped over to follow camera pitch would look like it was falling
 * down every time someone checks their feet). Zero per-frame JS, one draw call.
 */
function buildUndergrowth() {
  const CLUMPS = 2200;
  // Cell indices into the 4×2 atlas. The staples — fern, shrub, dead grass —
  // get double weight; the character pieces stay occasional finds.
  const PICKS = [0, 0, 1, 1, 4, 4, 5, 2, 3, 6, 7];
  const CELL_H = [
    [0.55, 0.6],    // fern
    [0.55, 0.6],    // leafy shrub
    [0.5, 0.5],     // bracken
    [0.85, 0.45],   // thistle stands tall
    [0.45, 0.6],    // dead grass
    [0.55, 0.9],    // sapling reaches
    [0.4, 0.45],    // deadfall sprout
    [0.3, 0.18],    // a rock is rock-sized
  ];
  const positions = [], roots = [], corners = [], uvs = [], colors = [], indices = [];
  const tint = new THREE.Color();
  let vi = 0;

  for (let i = 0; i < CLUMPS; i++) {
    const p = trailPoint(0.01 + Math.random() * 0.98);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = 2.2 + Math.pow(Math.random(), 1.4) * 23;
    const cx = p.x + -p.dz * off * side + (Math.random() - 0.5) * 4;
    const cz = p.z + p.dx * off * side + (Math.random() - 0.5) * 4;
    if (trailInfo(cx, cz).dist < 2.0) continue;
    const ck = creekInfo(cx, cz);
    if (isFinite(ck.dist) && ck.dist < 2.6) continue;

    const quads = 2 + (Math.random() * 3 | 0);
    for (let q = 0; q < quads; q++) {
      const bx = cx + (Math.random() - 0.5) * 1.4;
      const bz = cz + (Math.random() - 0.5) * 1.4;
      const by = groundHeight(bx, bz) - 0.04;
      const cell = PICKS[Math.random() * PICKS.length | 0];
      const u0 = (cell % 4) * 0.25, v0 = cell < 4 ? 0.5 : 0.0;
      const h = CELL_H[cell][0] + Math.random() * CELL_H[cell][1];
      const half = h * (0.55 + Math.random() * 0.25);
      // Vertex colour multiplies the atlas, which is already mid-green, so
      // this is a light level rather than a paint colour: mostly-bright with
      // a green cast, dipping darker per quad for variety.
      tint.setHSL(0.26 + Math.random() * 0.08, 0.18 + Math.random() * 0.14, 0.5 + Math.random() * 0.28);

      for (let cnr = 0; cnr < 4; cnr++) {
        roots.push(bx, by, bz);
        positions.push(bx, by + (cnr >= 2 ? h : 0), bz);
        colors.push(tint.r, tint.g, tint.b);
      }
      corners.push(-half, 0, half, 0, -half, h, half, h);
      uvs.push(u0, v0, u0 + 0.25, v0, u0, v0 + 0.5, u0 + 0.25, v0 + 0.5);
      indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(roots, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const uTime = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({
    map: plantAtlas(),
    vertexColors: true,
    alphaTest: 0.45,          // cutout, not blending: no sorting, ever
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute vec3 aRoot;\nattribute vec2 aCorner;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `
        vec3 toCam = cameraPosition - aRoot;
        toCam.y = 0.0;
        float toCamLen = length(toCam);
        vec3 camDir = toCamLen > 0.0001 ? toCam / toCamLen : vec3(0.0, 0.0, 1.0);
        vec3 bladeRight = vec3(-camDir.z, 0.0, camDir.x);
        vec3 transformed = aRoot + bladeRight * aCorner.x + vec3(0.0, aCorner.y, 0.0);
        // The same wind the conifers answer, scaled down to stems. aCorner.y
        // is zero at the root, so the tops lean and nothing slides on the
        // ground.
        transformed.xz += vec2(
          sin(uTime * 1.2 + aRoot.x * 0.7 + aRoot.z * 0.5),
          sin(uTime * 0.9 + aRoot.z * 0.8 + aRoot.x * 0.4)) * (aCorner.y * 0.055);`);
  };
  mat.customProgramCacheKey = () => 'blue-hour-undergrowth';

  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, tick: dt => { uTime.value += dt; } };
}
