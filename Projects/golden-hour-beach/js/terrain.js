import * as THREE from 'three';
import { groundHeight } from './field.js';

// Beach terrain: the sand mesh, the wet strip at the waterline, and the dune
// grass. The heightfield itself moved to field.js, which imports nothing, so
// test/smoke.mjs can check the ground and the prop layout without a browser —
// terrain.js can't be imported under Node at all, because the bare `three`
// specifier only resolves through index.html's import map.

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

export function buildTerrain(scene) {
  const W = 400, D = 220, SEGX = 200, SEGZ = 130;
  const geo = new THREE.PlaneGeometry(W, D, SEGX, SEGZ);
  geo.rotateX(-Math.PI / 2);
  // plane spans x∈[-200,200], z∈[-110,110]; shift so more sea than land? keep centered, sea side z<-6
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    posAttr.setY(i, groundHeight(x, z));
  }
  geo.computeVertexNormals();

  const sandTex = makeProceduralSandTexture();
  sandTex.repeat.set(60, 34);

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
    shader.uniforms.detailRepeat = { value: new THREE.Vector2(11, 6) };
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

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);

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
    tex.repeat.set(60, 34);
    mat.map = tex;
    mat.needsUpdate = true;
    loader.load(`${phBase}_nor_gl_1k.jpg`, nor => {
      nor.wrapS = nor.wrapT = THREE.RepeatWrapping;
      nor.repeat.set(60, 34);
      mat.normalMap = nor;
      mat.normalScale.set(0.6, 0.6);
      mat.needsUpdate = true;
    }, undefined, () => {});
  }, undefined, () => { /* keep procedural */ });

  // Wet sand strip near the waterline: darker, slightly reflective overlay
  const wetGeo = new THREE.PlaneGeometry(W, 14, SEGX, 10);
  wetGeo.rotateX(-Math.PI / 2);
  const wp = wetGeo.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i), z = wp.getZ(i) - 3; // strip centered z≈-3
    wp.setX(i, x); wp.setZ(i, z);
    wp.setY(i, groundHeight(x, z) + 0.015);
  }
  wetGeo.computeVertexNormals();
  // Fade the strip out at both edges. Without this its rectangle is visible: a
  // hard straight seam ran up the beach where the darker wet plane stopped and
  // the dry sand carried on, and on a phone in portrait it cut a diagonal across
  // the bottom third of the frame. The plane's V axis runs seaward-to-inland, so
  // a one-dimensional alpha ramp along V is all it takes.
  const wetMat = new THREE.MeshStandardMaterial({
    color: 0x8a6f4d,
    transparent: true,
    opacity: 0.55,
    alphaMap: edgeFadeTexture(),
    roughness: 0.25,
    metalness: 0.05,
  });
  const wet = new THREE.Mesh(wetGeo, wetMat);
  scene.add(wet);

  // Dune grass tufts
  const grass = buildGrass();
  scene.add(grass);

  return { mesh, wet };
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
  const bladeCount = 2600;
  const positions = [];   // only needs to be roughly right for frustum culling
  const roots = [];
  const corners = [];
  const colors = [];
  const indices = [];
  const cA = new THREE.Color(0x8a9a5b), cB = new THREE.Color(0xb5a642), tmp = new THREE.Color();

  let placed = 0, guard = 0, vi = 0;
  while (placed < bladeCount && guard++ < bladeCount * 10) {
    const x = (Math.random() - 0.5) * 380;
    const z = 26 + Math.random() * 78;
    const h = groundHeight(x, z);
    if (h < 2.2) continue; // only on raised dune ground
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
