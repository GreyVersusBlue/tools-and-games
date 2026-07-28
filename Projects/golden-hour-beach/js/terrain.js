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

function buildGrass() {
  const group = new THREE.Group();
  const bladeCount = 2600;
  const positions = [];
  const colors = [];
  const cA = new THREE.Color(0x8a9a5b), cB = new THREE.Color(0xb5a642), tmp = new THREE.Color();

  let placed = 0, guard = 0;
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
      positions.push(bx, bh, bz, bx + lean, bh + tall, bz + (Math.random() - 0.5) * 0.2);
      tmp.lerpColors(cA, cB, Math.random());
      colors.push(tmp.r, tmp.g, tmp.b, tmp.r * 0.7, tmp.g * 0.7, tmp.b * 0.55);
    }
    placed++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  const lines = new THREE.LineSegments(geo, mat);
  group.add(lines);
  return group;
}
