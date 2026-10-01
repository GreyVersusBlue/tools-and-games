// SkyWings 64 - landmarks: lighthouse (rotating beam), castle (towers, waving flags), windmills, carved-head mountain,
// suspension bridge (traffic, lamps), log cabins (smoke), runway/airfield, launch pads, plus vegetation/props (see vegetation.js, props.js).
// Owner: agent S.  Public API unchanged: createLandmarks(terrain, seed) -> { group, info, update(dt, elapsed) }
import * as THREE from 'three';
import { GeoBuilder, makeRng, LAYOUT, canyonX, clamp } from './terrain.js';
import { createVegetation } from './vegetation.js';
import { createProps } from './props.js';
import { shared, quality } from './atmosphere.js';
import { loadModel, fitModel } from '../core/models.js';

const heading = (ax, az, bx, bz) => Math.atan2(bx - ax, -(bz - az));

// ------------------------------------------------------------------ textures
function finishTex(c, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
function padTexture(color, letter) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fillStyle = '#b9bdc4'; g.fill();
  const r = makeRng(letter.charCodeAt(0));
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.05)`; g.fillRect(r() * 256, r() * 256, 3, 3); }
  g.lineWidth = 14; g.strokeStyle = color; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color; g.font = 'bold 130px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  g.fillStyle = '#ffffff'; for (let i = 0; i < 4; i++) { g.save(); g.translate(128, 128); g.rotate(i * Math.PI / 2); g.fillRect(-6, -124, 12, 14); g.restore(); }
  return finishTex(c);
}
function targetTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const cols = ['#e8302a', '#ffffff', '#e8302a', '#ffffff', '#2a6fe8', '#ffe14a'];
  for (let i = 0; i < cols.length; i++) { g.beginPath(); g.arc(128, 128, 126 - i * 21, 0, Math.PI * 2); g.fillStyle = cols[i]; g.fill(); }
  g.strokeStyle = '#ffffff'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(128, 10); g.lineTo(128, 246); g.moveTo(10, 128); g.lineTo(246, 128); g.stroke();
  g.beginPath(); g.arc(128, 128, 18, 0, Math.PI * 2); g.fillStyle = '#ffe14a'; g.fill();
  return finishTex(c);
}
function runwayTexture(len, width) {
  const W = 2048, Hh = Math.round(W * width / len) + 8;
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  g.fillStyle = '#383b41'; g.fillRect(0, 0, W, Hh);
  const r = makeRng(99);
  for (let i = 0; i < 9000; i++) { const v = 40 + r() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(r() * W, r() * Hh, 1 + r() * 3, 1 + r() * 3); }
  // rubber marks at both touchdown zones
  g.fillStyle = 'rgba(15,15,18,0.28)';
  for (const x0 of [W * 0.06, W * 0.86]) for (let i = 0; i < 2; i++) g.fillRect(x0 + r() * 30, Hh * (0.35 + i * 0.3), 150 + r() * 90, 7);
  const px = W / len;  // px per metre
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 6, W, 5); g.fillRect(0, Hh - 11, W, 5);                      // edge lines
  for (let x = 90 * px / 1.0; x < W - 90 * px; x += 30 * px) g.fillRect(x, Hh / 2 - 2.5, 16 * px, 5);   // centre dashes
  for (const end of [0, 1]) {                                                      // threshold piano keys
    for (let i = 0; i < 8; i++) { const y = 18 + i * ((Hh - 36) / 8) * 1.0; g.fillRect(end ? W - 34 * px : 6 * px, y, 22 * px, (Hh - 36) / 16); }
  }
  for (const [f, dir] of [[0.15, 1], [0.85, -1]]) {                              // aiming point + TDZ marks
    g.fillRect(W * f - 20 * px, Hh * 0.2, 30 * px, 14); g.fillRect(W * f - 20 * px, Hh * 0.8 - 14, 30 * px, 14);
    for (let k = 1; k <= 2; k++) { const xx = W * f + dir * (k * 22) * px; g.fillRect(xx - 6 * px, Hh * 0.28, 12 * px, 8); g.fillRect(xx - 6 * px, Hh * 0.72 - 8, 12 * px, 8); }
  }
  g.fillStyle = '#f2f2ee'; g.font = `bold ${Hh * 0.42}px Impact, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.translate(46 * px + 20, Hh / 2); g.rotate(Math.PI / 2); g.fillText('09', 0, 0); g.restore();
  g.save(); g.translate(W - 46 * px - 20, Hh / 2); g.rotate(-Math.PI / 2); g.fillText('27', 0, 0); g.restore();
  return finishTex(c, 16);
}
function smokeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(230,230,235,0.4)'); gr.addColorStop(1, 'rgba(230,230,235,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function decalMat(map, opaque) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, transparent: !opaque, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

// ------------------------------------------------------------------ materials
function structureMaterial(pattern) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = `varying vec3 vWP;
float lh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lvn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(lh(i),lh(i+vec2(1,0)),f.x), mix(lh(i+vec2(0,1)),lh(i+vec2(1,1)),f.x), f.y); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 n = normalize(cross(dFdx(vWP), dFdy(vWP)));
  float wall = 1.0 - smoothstep(0.55, 0.8, abs(n.y));
  vec2 uv = mix(vWP.xz * 0.7, vec2(dot(vWP.xz, vec2(-n.z, n.x)), vWP.y), wall);
  float g = lvn(uv * 2.3) * 0.55 + lvn(uv * 7.1) * 0.3 + lvn(uv * 19.0) * 0.15;
  float shade = 0.82 + g * 0.36;
  ${pattern === 'brick' ? `
  float row = floor(vWP.y / 0.85);
  float u = dot(vWP.xz, vec2(-n.z, n.x)) / 1.7 + row * 0.5;
  float mort = max(step(fract(vWP.y / 0.85), 0.07), step(fract(u), 0.05));
  shade *= mix(1.0, 0.68, mort * wall);
  shade *= 0.93 + 0.14 * lh(vec2(floor(u), row));` : `
  shade *= 0.95 + 0.1 * lvn(vec2(vWP.y * 3.0, dot(vWP.xz, vec2(-n.z, n.x)) * 0.5));`}
  diffuseColor.rgb *= shade;
}`);
  };
  m.customProgramCacheKey = () => 'swstruct-' + pattern;
  return m;
}

// Give hero-GLB materials the same world-space masonry / grain detail as the procedural structures
// (the Blender exports are flat-coloured + baked AO). Chooses the pattern from the material name.
const _detailProto = { brick: structureMaterial('brick'), plain: structureMaterial('plain') };
function detailGLB(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || m.userData.swDetail || !/stone|wall|rock|chimney|log|wood|porch|face|hair|cap\d|door/i.test(m.name || '')) continue;
      m.userData.swDetail = true;
      const pattern = /stone|wall|chimney/i.test(m.name) ? 'brick' : 'plain';
      m.onBeforeCompile = _detailProto[pattern].onBeforeCompile;
      m.customProgramCacheKey = () => 'swglb-' + pattern;
      m.needsUpdate = true;
    }
  });
  return model;
}
function flagMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = FLAG_TIME;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float wv = uv.x;
      transformed.z += sin(position.x * 1.7 - uTime * 6.0 + position.y * 0.6) * 0.32 * wv + sin(position.x * 3.1 - uTime * 9.0) * 0.08 * wv;
      transformed.y += sin(position.x * 2.3 - uTime * 5.0) * 0.1 * wv;`);
  };
  return m;
}
const FLAG_TIME = { value: 0 };
function makeFlag(w, h, colors, mat, vertical = false) {
  const g = new THREE.PlaneGeometry(w, h, 10, 4);
  g.translate(w / 2, 0, 0);
  const pos = g.attributes.position, col = [];
  const cs = colors.map((c) => new THREE.Color(c));
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w, v = pos.getY(i) / h + 0.5;
    const idx = Math.max(0, Math.min(cs.length - 1, Math.floor((vertical ? u : 1 - v) * cs.length * 0.9999)));
    col.push(cs[idx].r, cs[idx].g, cs[idx].b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, mat);
}

// ------------------------------------------------------------------ main
export function createLandmarks(terrain, seed = 1337) {
  const Q = quality();
  const group = new THREE.Group();
  group.name = 'landmarks';
  const H = terrain.heightAt;
  shared.heightAt = H;
  const rng = makeRng(seed * 31 + 7);
  const brickMat = structureMaterial('brick'), plainMat = structureMaterial('plain');
  const sb = new GeoBuilder();     // masonry / wood structures (brick pattern)
  const pb = new GeoBuilder();     // plain surfaces: metal, paint, roofs, misc
  const rb = new GeoBuilder();     // natural rock
  const wb = new GeoBuilder();     // glass windows (emissive at night)
  const updaters = [];
  const info = { windmills: [], cabins: [], headings: {} };
  // Loads a hero GLB for a landmark whose procedural fallback uses absolute world-space vertices
  // (so the fallback `host` group itself stays at the origin). On success the GLB is fitted and
  // placed inside its own wrapper positioned at (x,y,z), and the fallback's children are hidden.
  const glbHosts = [];
  function swapInAt(host, name, x, y, z, opts = {}) {
    return loadModel(name).then((model) => {
      if (!model) return null;
      if (opts.fitHeight || opts.fitSize) fitModel(model, opts);
      detailGLB(model);
      for (const c of host.children) { c.visible = false; c.userData.swProcedural = true; }
      const wrap = new THREE.Group(); wrap.name = 'glb:' + name;
      wrap.position.set(x, y, z);
      if (opts.ry) wrap.rotation.y = opts.ry;
      wrap.add(model);
      group.add(wrap);
      glbHosts.push({ name, wrap, model });
      if (opts.onLoad) opts.onLoad(model, wrap);
      return model;
    }).catch((e) => { console.warn('[landmarks] swap failed for ' + name, e); return null; });
  }
  const W = LAYOUT.wind;
  const windRy = Math.atan2(-W.x, -W.z);       // windmill front faces into the wind
  const downRy = Math.atan2(-W.z, W.x);        // flags/windsocks point downwind
  const flagMat = flagMaterial();
  const blockers = [];
  const flatBase = (b, x, z, w, d, color, ry = 0) => {   // plinth from lowest ground up to highest corner
    const hs = [H(x - w / 2, z - d / 2), H(x + w / 2, z - d / 2), H(x - w / 2, z + d / 2), H(x + w / 2, z + d / 2), H(x, z)];
    const lo = Math.min(...hs) - 3, hi = Math.max(...hs) + 0.2;
    b.box(x, (lo + hi) / 2, z, w, hi - lo, d, color, ry);
    return hi;
  };
  const addFlag = (x, y, z, w, h, colors, vertical) => {
    const f = makeFlag(w, h, colors, flagMat, vertical);
    f.position.set(x, y, z); f.rotation.y = downRy; group.add(f);
    return f;
  };

  // ============================================================== lighthouse
  const lighthouseHost = new THREE.Group(); lighthouseHost.name = 'lighthouseHost';
  {
    const lx = LAYOUT.lighthouse.x, lz = LAYOUT.lighthouse.z, y0 = H(lx, lz);
    const sbL = new GeoBuilder(), pbL = new GeoBuilder(), wbL = new GeoBuilder();
    for (let i = 0; i < 14; i++) {
      const a = i * 0.9 + rng(), r = 11 + rng() * 9;
      rb.ico(lx + Math.cos(a) * r, y0 - 1.5 + rng() * 2.5, lz + Math.sin(a) * r, 3.5 + rng() * 5, 1, (x, y, z, o) => o.setHex(0x7f7c78).multiplyScalar(0.7 + 0.3 * clamp((y - y0 + 4) / 8, 0, 1)), 1, 0.7, 1);
    }
    sbL.cyl(lx, y0 + 2, lz, 9.2, 10.8, 6, 16, 0x9b9690);
    sbL.cyl(lx, y0 + 5.5, lz, 9.8, 9.8, 0.8, 16, 0x777);
    const BANDS = 6, BH = 8;
    for (let k = 0; k < BANDS; k++) {
      sbL.cyl(lx, y0 + 8 + k * BH + BH / 2, lz, 7.5 - (k + 1) * 0.55, 7.5 - k * 0.55, BH, 18, k % 2 === 0 ? 0xd7362b : 0xf6f4ee);
      // small windows spiralling up
      const a = k * 1.3 + 0.4, rr = 7.5 - (k + 0.5) * 0.55 + 0.05;
      wbL.box(lx + Math.cos(a) * rr, y0 + 8 + k * BH + BH * 0.55, lz + Math.sin(a) * rr, 1.0, 2.0, 1.0, 0x9fc6e8, -a + Math.PI / 2);
    }
    const top = y0 + 8 + BANDS * BH;
    pbL.cyl(lx, top + 0.6, lz, 6.9, 6.2, 1.2, 18, 0x2f3540);           // gallery deck
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; pbL.box(lx + Math.cos(a) * 6.7, top + 2.0, lz + Math.sin(a) * 6.7, 0.18, 2.0, 0.18, 0x2f3540); }
    pbL.cyl(lx, top + 3.05, lz, 6.8, 6.8, 0.2, 18, 0x2f3540);
    pbL.cyl(lx, top + 1.9, lz, 3.9, 4.4, 1.6, 14, 0xf6f4ee);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 + 0.26; pbL.box(lx + Math.cos(a) * 3.7, top + 4.9, lz + Math.sin(a) * 3.7, 0.4, 4.6, 0.4, 0x2f3540); }
    pbL.cyl(lx, top + 7.6, lz, 4.3, 4.3, 0.8, 14, 0x2f3540);
    pbL.cone(lx, top + 11.2, lz, 4.5, 6.4, 14, 0xd7362b);
    pbL.ico(lx, top + 14.8, lz, 0.9, 1, 0xffd54a);
    pbL.cyl(lx, top + 16.5, lz, 0.08, 0.08, 3, 5, 0x333333); pbL.box(lx + 0.8, top + 17.4, lz, 1.4, 0.15, 0.15, 0x333333);
    // door + keeper's house
    sbL.box(lx + 7.3, y0 + 9.5, lz, 0.8, 3.4, 1.9, 0x3d2416);
    sbL.box(lx - 17, y0 + 3, lz + 3, 9, 5.5, 7, 0xf1e8d4); pbL.prism(lx - 17, y0 + 5.6, lz + 3, 10.5, 3.4, 8, 0xb5472e, Math.PI / 2);
    wbL.box(lx - 12.4, y0 + 3.5, lz + 3, 0.3, 1.6, 1.7, 0x9fc6e8); wbL.box(lx - 17, y0 + 3.5, lz + 6.6, 1.7, 1.6, 0.3, 0x9fc6e8);
    sbL.cyl(lx - 20, y0 + 8.5, lz + 1, 0.6, 0.7, 3.4, 6, 0x8a3b2b);
    sbL.box(lx - 9.3, y0 + 1.4, lz + 3, 3, 0.4, 1.6, 0x8c877f); // step
    for (const [b, m, n] of [[sbL, brickMat, 'lh-masonry'], [pbL, plainMat, 'lh-plain'], [wbL, brickMat, 'lh-win']]) {
      if (!b.pos.length) continue; const mesh = new THREE.Mesh(b.build(), m); mesh.name = n; lighthouseHost.add(mesh);
    }
    group.add(lighthouseHost);
    swapInAt(lighthouseHost, 'lighthouse', lx, y0, lz, { fitHeight: top + 17.4 - y0 });
    // lamp (glowing) + rotating beams
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 4.2, 14), lampMat);
    lamp.position.set(lx, top + 5.0, lz);
    group.add(lamp);
    const beam = new THREE.Group(); beam.position.set(lx, top + 5.0, lz);
    const LEN = 420;
    const bg = new THREE.CylinderGeometry(16, 0.9, LEN, 20, 1, true).rotateZ(-Math.PI / 2).translate(LEN / 2, 0, 0);
    const bu = { uInt: { value: 0.2 }, uCol: { value: new THREE.Color(1, 0.95, 0.65) } };
    const bm = new THREE.ShaderMaterial({
      uniforms: bu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vT; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalMatrix * normal; vV = -mv.xyz; vT = position.x / ${LEN.toFixed(1)}; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uInt; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying float vT;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float a = pow(f, 1.6) * (1.0 - vT) * (1.0 - vT) * uInt; gl_FragColor = vec4(uCol * a, a); }`,
    });
    for (const s of [0, 1]) { const m = new THREE.Mesh(bg, bm); m.rotation.y = s * Math.PI; m.frustumCulled = false; m.renderOrder = 5; beam.add(m); }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color: 0xfff0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(30, 30, 1); glow.position.copy(beam.position); glow.renderOrder = 6;
    group.add(beam, glow);
    updaters.push((dt, t) => {
      beam.rotation.y += dt * 0.7;
      const night = shared.night;
      bu.uInt.value = 0.16 + 0.75 * night + 0.15 * shared.dusk;
      glow.material.opacity = 0.25 + 0.75 * night;
      lampMat.color.setRGB(1, 0.94, 0.6).multiplyScalar(1 + night);
    });
    info.lighthouse = { position: new THREE.Vector3(lx, y0, lz), height: top + 14 - y0, top: new THREE.Vector3(lx, top + 5, lz) };
    blockers.push({ x: lx, z: lz, r: 34 });
  }

  // ============================================================== windmills
  const hubB = new GeoBuilder();
  hubB.cyl(0, 0, 0.9, 1.1, 1.1, 2.6, 8, 0x4a2c1a, 0, 0);
  hubB.box(0, 0, 0.8, 2.2, 2.2, 2.4, 0x6b4423);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, dx = -Math.sin(a), dy = Math.cos(a), px = Math.cos(a), py = Math.sin(a);
    hubB.box(dx * 11.5, dy * 11.5, 1.3, 0.75, 23, 0.7, 0x6b4423, 0, 0, a);            // main spar
    hubB.box(dx * 15.2 + px * 3.6, dy * 15.2 + py * 3.6, 1.05, 0.35, 15.6, 0.3, 0x5a3a20, 0, 0, a);   // frame outer rail
    hubB.box(dx * 15.2 + px * 0.6, dy * 15.2 + py * 0.6, 1.05, 0.35, 15.6, 0.3, 0x5a3a20, 0, 0, a);   // frame inner rail
    for (let r = 0; r < 8; r++) {                                                      // lattice cross bars + cloth
      const d = 8 + r * 1.95;
      hubB.box(dx * d + px * 2.1, dy * d + py * 2.1, 1.05, 3.4, 0.22, 0.24, 0x5a3a20, 0, 0, a + Math.PI / 2 * 0);
      if (r % 2 === 0) hubB.box(dx * (d + 0.95) + px * 2.1, dy * (d + 0.95) + py * 2.1, 1.0, 3.3, 1.7, 0.08, 0xf2ecda, 0, 0, a + Math.PI / 2 * 0);
    }
  }
  const hubGeo = hubB.build();
  const hubMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const bales = [];
  // tower bodies + sails go into their own host so the hero GLB (assets/models/windmill.glb) can replace them
  const windmillHost = new THREE.Group(); windmillHost.name = 'windmillHost';
  const wmS = new GeoBuilder(), wmP = new GeoBuilder(), wmW = new GeoBuilder();
  const mills = [];
  for (const w of LAYOUT.windmills) {
    const x = w[0], z = w[1], y0 = H(x, z), s = Math.sin(windRy), c = Math.cos(windRy);
    wmS.cyl(x, y0 + 1, z, 7.4, 7.9, 3, 12, 0x8c877f);
    wmS.cyl(x, y0 + 12, z, 3.7, 6.2, 22, 14, 0xf1e5c6);
    wmP.cyl(x, y0 + 8, z, 5.2, 5.25, 0.5, 14, 0x8a5a34);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; wmP.box(x + Math.cos(a) * 5.25, y0 + 8.9, z + Math.sin(a) * 5.25, 0.15, 1.3, 0.15, 0x6b4423); }
    wmP.cyl(x, y0 + 9.4, z, 5.5, 5.5, 0.25, 14, 0x6b4423);
    wmP.cone(x, y0 + 25.5, z, 5.4, 7, 14, 0xb5472e);
    wmP.ico(x, y0 + 29.3, z, 0.7, 0, 0x333);
    wmP.box(x + s * 6.0, y0 + 3.4, z + c * 6.0, 2.3, 4.6, 0.5, 0x4a2c1a, windRy);
    wmW.box(x - s * 3.5 + c * 4.0 * 0.0, y0 + 16, z - c * 3.5, 1.1, 1.6, 0.4, 0x9fc6e8, windRy + 1.57);
    wmW.box(x + s * 4.9, y0 + 14, z + c * 4.9, 1.1, 1.6, 0.4, 0x9fc6e8, windRy);
    const hub = new THREE.Group();
    hub.position.set(x + s * 4.3, y0 + 20.5, z + c * 4.3); hub.rotation.y = windRy;
    const rot = new THREE.Mesh(hubGeo, hubMat);
    rot.rotation.z = rng() * 6;
    hub.add(rot); windmillHost.add(hub);
    const sp = 0.55 + rng() * 0.45;
    const mill = { x, y0, z, rot, blades: null };
    mills.push(mill);
    updaters.push((dt, t) => {
      rot.rotation.z += dt * sp * (0.85 + 0.15 * Math.sin(t * 0.3));
      if (mill.blades) mill.blades.rotation.z = rot.rotation.z;
    });
    // ground details: fence ring, hay bales, sacks, cart
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, fx = x + Math.cos(a) * 14, fz = z + Math.sin(a) * 14, fy = H(fx, fz);
      if (i === 4 || i === 5) continue;
      pb.box(fx, fy + 0.6, fz, 0.2, 1.2, 0.2, 0x7a5a36);
      const a2 = a + Math.PI / 16, nx = x + Math.cos(a2) * 14, nz = z + Math.sin(a2) * 14;
      pb.beam(fx, fy + 1.0, fz, x + Math.cos(a + Math.PI / 8) * 14, H(x + Math.cos(a + Math.PI / 8) * 14, z + Math.sin(a + Math.PI / 8) * 14) + 1.0, z + Math.sin(a + Math.PI / 8) * 14, 0.1, 0x8a6a40);
    }
    for (let i = 0; i < 4; i++) { const bx = x + 9 + (i % 2) * 2.3 - i * 0.3, bz = z - 9 + Math.floor(i / 2) * 2.2; pb.cyl(bx, H(bx, bz) + 0.7, bz, 0.9, 0.9, 1.6, 10, 0xd8b45c, 0); bales.push(1); }
    blockers.push({ x, z, r: 18 });
    info.windmills.push(new THREE.Vector3(x, y0, z));
  }

  for (const [b, m, n] of [[wmS, brickMat, 'wm-masonry'], [wmP, plainMat, 'wm-plain'], [wmW, brickMat, 'wm-win']]) {
    if (!b.pos.length) continue; const mesh = new THREE.Mesh(b.build(), m); mesh.name = n; windmillHost.add(mesh);
  }
  group.add(windmillHost);
  loadModel('windmill').then((proto) => {
    if (!proto) return;
    detailGLB(proto);
    for (const c of windmillHost.children) { c.visible = false; c.userData.swProcedural = true; }
    mills.forEach((ml, i) => {
      const model = i === 0 ? proto : proto.clone(true);
      const wrap = new THREE.Group(); wrap.name = 'glb:windmill';
      wrap.position.set(ml.x, ml.y0, ml.z); wrap.rotation.y = windRy;   // GLB authored in the same local frame (front +Z)
      wrap.add(model); group.add(wrap);
      // spin a pivot at the hub: the blades node carries its own export rotation, which must be kept
      const bl = model.getObjectByName('blades');
      if (bl) {
        const pivot = new THREE.Group(); pivot.position.copy(bl.position);
        bl.parent.add(pivot); bl.position.set(0, 0, 0); pivot.add(bl);
        ml.blades = pivot;
      }
      glbHosts.push({ name: 'windmill', wrap, model });
    });
  }).catch((e) => console.warn('[landmarks] windmill swap failed', e));

  // ============================================================== castle
  const castleHost = new THREE.Group(); castleHost.name = 'castleHost';
  {
    const csb = new GeoBuilder(), cpb = new GeoBuilder(), cwb = new GeoBuilder();
    const cx = LAYOUT.castle.x, cz = LAYOUT.castle.z, S = 0xe2d8c0, S2 = 0xcfc4aa, S3 = 0xbfb49a;
    const y0 = flatBase(csb, cx, cz, 92, 92, 0xa39b88) - 0.2;
    // curtain walls with walkway
    const wall = (x, z, w, d) => { csb.box(x, y0 + 6, z, w, 12, d, S); csb.box(x, y0 + 12.3, z, w + (w > d ? 0 : 1.6), 0.6, d + (w > d ? 1.6 : 0), S3); };
    wall(cx, cz - 40, 84, 4); wall(cx, cz + 40, 84, 4); wall(cx - 40, cz, 4, 84); wall(cx + 40, cz, 4, 84);
    for (let t = -38; t <= 38; t += 4.2) {
      for (const [ax, az, horiz] of [[cx + t, cz - 40, 1], [cx + t, cz + 40, 1], [cx - 40, cz + t, 0], [cx + 40, cz + t, 0]]) {
        if (horiz && az > cz && Math.abs(t) < 8) continue;
        csb.box(ax, y0 + 13.6, az, horiz ? 2.2 : 1.6, 2.2, horiz ? 1.6 : 2.2, S2);
      }
    }
    // arrow slits
    for (let t = -30; t <= 30; t += 10) { cwb.box(cx + t, y0 + 7, cz - 37.9, 0.5, 2.2, 0.3, 0x1c1a22); cwb.box(cx - 37.9, y0 + 7, cz + t, 0.3, 2.2, 0.5, 0x1c1a22); cwb.box(cx + 37.9, y0 + 7, cz + t, 0.3, 2.2, 0.5, 0x1c1a22); }
    // gatehouse with arch, drawbridge
    csb.box(cx - 8, y0 + 9, cz + 40, 7, 18, 8, S); csb.box(cx + 8, y0 + 9, cz + 40, 7, 18, 8, S); csb.box(cx, y0 + 15, cz + 40, 10, 6, 8, S);
    cpb.box(cx - 8, y0 + 20.5, cz + 40, 8.4, 2.4, 9.2, S2); cpb.box(cx + 8, y0 + 20.5, cz + 40, 8.4, 2.4, 9.2, S2);
    cpb.cone(cx - 8, y0 + 24.4, cz + 40, 5.2, 6.6, 8, 0x2f5fc8); cpb.cone(cx + 8, y0 + 24.4, cz + 40, 5.2, 6.6, 8, 0x2f5fc8);
    cwb.box(cx, y0 + 5, cz + 44.2, 9.2, 10, 0.4, 0x14110e);
    for (let i = -4; i <= 4; i++) cpb.box(cx + i * 1.05, y0 + 9, cz + 44.5, 0.14, 4.6, 0.2, 0x3a3a3f);  // portcullis
    cpb.box(cx, y0 + 0.5, cz + 50.5, 8, 0.5, 12, 0x6b4423, 0, 0.42 * 0);
    for (let i = 0; i < 4; i++) cpb.beam(cx - 3.6, y0 + 0.5, cz + 56, cx - 3.6, y0 + 12, cz + 44.5, 0.1, 0x222);
    // corner towers
    const roofCols = [0x2f5fc8, 0xc8342b, 0x2f5fc8, 0xc8342b]; let ti = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = cx + sx * 40, tz = cz + sz * 40;
      csb.cyl(tx, y0 + 13, tz, 6.2, 7.0, 28, 14, S);
      csb.cyl(tx, y0 + 27.5, tz, 7.6, 7.2, 1.8, 14, S2);
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; csb.box(tx + Math.cos(a) * 7.4, y0 + 29.3, tz + Math.sin(a) * 7.4, 1.6, 1.6, 1.6, S2, -a); }
      cpb.cone(tx, y0 + 36.5, tz, 6.8, 12.5, 14, roofCols[ti++]);
      cpb.cyl(tx, y0 + 44.5, tz, 0.12, 0.12, 5, 5, 0x555);
      cwb.box(tx + sx * 5.3, y0 + 18, tz, 0.4, 2.6, 1.2, 0x15121c); cwb.box(tx, y0 + 18, tz + sz * 5.3, 1.2, 2.6, 0.4, 0x15121c);
      addFlag(tx, y0 + 46, tz, 5, 3, ti % 2 ? [0xffd23a, 0xc8342b] : [0x2f5fc8, 0xffffff]);
    }
    // mid-wall towers
    for (const [tx, tz] of [[cx, cz - 40], [cx - 40, cz], [cx + 40, cz]]) {
      csb.cyl(tx, y0 + 10, tz, 4.2, 4.8, 21, 12, S); cpb.cone(tx, y0 + 26, tz, 5.0, 8.5, 12, 0xc8342b);
    }
    // keep
    csb.box(cx, y0 + 14, cz - 8, 32, 28, 28, S); csb.box(cx, y0 + 28.4, cz - 8, 34, 1, 30, S3);
    for (let t = -14; t <= 14; t += 4.7) for (const sgn of [-1, 1]) { csb.box(cx + t, y0 + 30, cz - 8 + sgn * 15.2, 2.6, 2.4, 1.6, S2); csb.box(cx + sgn * 16.2, y0 + 30, cz - 8 + t, 1.6, 2.4, 2.6, S2); }
    for (const [dx, dz] of [[-16, -22], [16, -22], [-16, 6], [16, 6]]) { csb.cyl(cx + dx, y0 + 17, cz + dz, 3.5, 3.8, 34, 10, S); cpb.cone(cx + dx, y0 + 38.5, cz + dz, 4.2, 7, 10, 0xc8342b); }
    csb.cyl(cx, y0 + 42, cz - 8, 9, 10, 26, 16, S); csb.cyl(cx, y0 + 55.5, cz - 8, 11, 10, 2, 16, S2);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; csb.box(cx + Math.cos(a) * 10.6, y0 + 57.4, cz - 8 + Math.sin(a) * 10.6, 2.2, 2.2, 2.2, S2, -a); }
    cpb.cone(cx, y0 + 68, cz - 8, 11.5, 22, 16, 0xc8342b);
    cpb.cyl(cx, y0 + 82, cz - 8, 0.3, 0.3, 14, 5, 0x555);
    addFlag(cx, y0 + 86, cz - 8, 8, 4.6, [0xffd23a, 0xc8342b, 0x2f5fc8]);
    for (const wx of [-9, 0, 9]) { cwb.box(cx + wx, y0 + 18, cz + 6.3, 2.2, 4.2, 0.5, 0xffd08a); cpb.box(cx + wx, y0 + 21.3, cz + 6.3, 3, 0.4, 0.8, S3); }
    for (const wx of [-9, 9]) cwb.box(cx + wx, y0 + 8, cz + 6.3, 1.6, 3, 0.5, 0xffd08a);
    cwb.box(cx, y0 + 26, cz + 6.3, 3.2, 3.2, 0.5, 0xffd08a);
    cwb.box(cx, y0 + 45, cz - 8 + 9.6, 1.6, 3, 0.4, 0xffd08a); cwb.box(cx + 9.6, y0 + 45, cz - 8, 0.4, 3, 1.6, 0xffd08a);
    // courtyard: houses, well, stalls
    const houses = [[-28, 16], [-24, 30], [26, 20], [28, 33], [-30, -14], [30, -12]];
    houses.forEach((h, i) => {
      const hx = cx + h[0], hz = cz + h[1];
      csb.box(hx, y0 + 2.4, hz, 8, 4.8, 6.4, i % 2 ? 0xe8d8b0 : 0xd8c39a); cpb.prism(hx, y0 + 4.8, hz, 9.4, 3.4, 7.6, [0xb5472e, 0x2f5fc8, 0x8a3b2b][i % 3], Math.PI / 2);
      cwb.box(hx, y0 + 2.8, hz + 3.25, 1.2, 1.4, 0.2, 0xffd08a); cwb.box(hx - 2.4, y0 + 2.8, hz + 3.25, 1.2, 1.4, 0.2, 0xffd08a);
    });
    csb.cyl(cx + 6, y0 + 0.7, cz + 26, 1.6, 1.8, 1.4, 10, 0x9b9690); cpb.box(cx + 4.6, y0 + 2.8, cz + 26, 0.2, 2.4, 0.2, 0x5a3a20); cpb.box(cx + 7.4, y0 + 2.8, cz + 26, 0.2, 2.4, 0.2, 0x5a3a20);
    cpb.prism(cx + 6, y0 + 4, cz + 26, 4, 1.4, 2.2, 0xb5472e, Math.PI / 2);
    for (let i = 0; i < 3; i++) { const sx = cx - 8 + i * 8, sz = cz + 18; cpb.box(sx, y0 + 1.1, sz, 3.2, 0.2, 2, 0x8a5a34); cpb.box(sx, y0 + 3.6, sz, 3.6, 0.15, 2.4, [0xc8342b, 0xf2c94c, 0x2f5fc8][i]); cpb.box(sx - 1.6, y0 + 2, sz - 1, 0.15, 3.8, 0.15, 0x5a3a20); cpb.box(sx + 1.6, y0 + 2, sz - 1, 0.15, 3.8, 0.15, 0x5a3a20); }
    // banners on gate
    addFlag(cx - 4.5, y0 + 21, cz + 45, 2.4, 6, [0xc8342b, 0xffd23a], true);
    info.castle = { position: new THREE.Vector3(cx, y0, cz), top: new THREE.Vector3(cx, y0 + 86, cz - 8) };
    blockers.push({ x: cx, z: cz, r: 75 });
    for (const [b, m, n] of [[csb, brickMat, 'castle-masonry'], [cpb, plainMat, 'castle-plain'], [cwb, brickMat, 'castle-win']]) {
      if (!b.pos.length) continue; const mesh = new THREE.Mesh(b.build(), m); mesh.name = n; castleHost.add(mesh);
    }
    group.add(castleHost);
    swapInAt(castleHost, 'castle', cx, y0, cz, { fitSize: 92 });
  }

  // ============================================================== carved heads mountain
  const headsHost = new THREE.Group(); headsHost.name = 'headsHost';
  {
    const hb = new GeoBuilder();
    const sx = LAYOUT.statue.x, sz = LAYOUT.statue.z, y0 = H(sx, sz), yB = y0 + 5;
    const strata = (base) => (x, y, z, o) => o.setHex(base).multiplyScalar(0.86 + 0.14 * Math.sin(y * 0.55 + x * 0.02) + 0.05 * Math.sin(y * 2.3));
    hb.box(sx, y0 + 1, sz + 2, 250, 8, 62, strata(0x9b9488));
    hb.box(sx, yB + 62, sz - 40, 270, 134, 38, strata(0x8f877a));
    for (let i = 0; i < 9; i++) hb.box(sx - 120 + i * 30 + rng() * 6, yB + 40 + rng() * 60, sz - 22 + rng() * 4, 30 + rng() * 10, 60 + rng() * 60, 16, strata(0x8a8276));
    hb.box(sx - 85, yB + 140, sz - 40, 90, 24, 34, strata(0x847c70));
    hb.box(sx + 60, yB + 132, sz - 40, 110, 20, 34, strata(0x9a9184));
    hb.box(sx - 20, yB + 150, sz - 40, 40, 20, 30, strata(0x7d766b));
    for (let i = 0; i < 12; i++) hb.ico(sx - 130 + i * 24, yB + 6, sz + 24 + rng() * 6, 8 + rng() * 6, 1, strata(0x8b8377), 1.4, 0.8, 1);
    hb.box(sx, yB + 8, sz - 15, 250, 16, 20, strata(0x8b8377));
    const stone = [0xcfc8ba, 0xc2bbad, 0xd6cfc1, 0xbab3a5];
    info.statue = { position: new THREE.Vector3(sx, y0, sz), heads: [] };
    for (let i = 0; i < 4; i++) {
      const hx = sx + (i - 1.5) * 56, hz = sz + 2, cl = stone[i], dark = 0x2f2924;
      const col = (base) => (x, y, z, o) => o.setHex(base).multiplyScalar(0.8 + 0.2 * clamp((y - yB) / 60, 0, 1) + 0.06 * Math.sin(y * 1.9 + x * 0.7));
      const C = col(cl);
      hb.box(hx, yB + 11, hz, 44, 22, 28, C);                        // shoulders
      hb.ico(hx, yB + 20, hz, 12, 1, C, 1.3, 0.7, 1.0);              // collar
      hb.cyl(hx, yB + 27, hz, 8, 10, 10, 10, C);                      // neck
      hb.ico(hx, yB + 42, hz, 15, 2, C, 0.98, 1.14, 1.0);            // skull
      hb.ico(hx, yB + 32, hz + 5, 11.5, 1, C, 0.95, 0.85, 1.0);      // jaw
      hb.ico(hx, yB + 26, hz + 11, 5.4, 1, C, 1.1, 0.8, 0.9);        // chin
      hb.box(hx, yB + 46.8, hz + 12.6, 27, 3.4, 5, C);                // brow ridge
      hb.box(hx, yB + 39, hz + 15.2, 4.6, 11.4, 5.4, C);              // nose bridge
      hb.ico(hx, yB + 33.6, hz + 16.6, 3.3, 1, C, 1.2, 0.8, 1.0);     // nose tip
      hb.ico(hx - 2.6, yB + 33.5, hz + 15, 1.7, 0, C); hb.ico(hx + 2.6, yB + 33.5, hz + 15, 1.7, 0, C);
      for (const s of [-1, 1]) {
        hb.ico(hx + s * 9.5, yB + 38, hz + 11.5, 5.2, 1, C, 1, 0.8, 0.9);          // cheek
        hb.ico(hx + s * 14.6, yB + 40.5, hz - 0.5, 3.6, 1, C, 0.55, 1.3, 0.9);      // ear
        hb.box(hx + s * 6.6, yB + 44, hz + 13.6, 5.6, 2.5, 1.6, dark);              // eye socket
        hb.ico(hx + s * 6.6, yB + 43.8, hz + 14.4, 1.1, 0, 0xe8e2d6);                // eye
      }
      hb.box(hx, yB + 30.4, hz + 14.6, 10, 1.3, 1.5, dark);                          // mouth
      hb.box(hx, yB + 31.9, hz + 14.6, 9, 1.4, 1.6, C);                              // upper lip
      // individual hair/headgear
      if (i === 0) { hb.ico(hx, yB + 53, hz - 1, 14, 1, 0x8f887b, 1.05, 0.5, 1.0); hb.box(hx, yB + 52, hz + 8, 26, 2.5, 4, 0x8a8377); }
      else if (i === 1) { hb.cyl(hx, yB + 56, hz, 13, 14, 5, 8, 0xd8b13a); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; hb.cone(hx + Math.cos(a) * 12.5, yB + 62, hz + Math.sin(a) * 12.5, 2.4, 6, 4, 0xe6c04a); } }
      else if (i === 2) { hb.ico(hx, yB + 27, hz + 8, 9.5, 1, 0xb5aea0, 1.15, 1.1, 0.9); hb.box(hx, yB + 32.3, hz + 15.5, 10, 2, 2.2, 0xa8a194); hb.ico(hx, yB + 51.5, hz - 1, 15, 1, 0x9a9386, 1.05, 0.45, 1.0); }
      else { hb.cone(hx, yB + 61, hz, 15.5, 20, 4, 0x6c7a8a, Math.PI / 4); hb.cyl(hx, yB + 53, hz, 15.5, 15.5, 2.5, 4, 0x55606e, Math.PI / 4); }
      info.statue.heads.push(new THREE.Vector3(hx, yB + 40, hz + 14));
    }
    blockers.push({ x: sx, z: sz + 10, r: 150 });
    if (hb.pos.length) { const mesh = new THREE.Mesh(hb.build(), plainMat); mesh.name = 'heads-rock'; headsHost.add(mesh); }
    group.add(headsHost);
    swapInAt(headsHost, 'heads', sx, y0, sz, {});
  }

  // ============================================================== cabins
  const smoke = [];
  {
    const smokeTex = smokeTexture();
    const logs = [0xa87444, 0xb98552, 0x8f6338, 0xc9a06a], roofs = [0xb5472e, 0x2f5fc8, 0x3a8a4a, 0x8a3b2b];
    // house bodies go into cabinHost (replaced by assets/models/cabin.glb when it loads); fences/smoke stay shared
    const cabinHost = new THREE.Group(); cabinHost.name = 'cabinHost';
    const sb = new GeoBuilder(), cpb = new GeoBuilder(), wb = new GeoBuilder();
    const spots = [];
    LAYOUT.cabins.forEach((c, ci) => {
      const x = c[0], z = c[1], y0 = H(x, z), ry = rng() * Math.PI * 2, cs = Math.cos(ry), sn = Math.sin(ry), k = Math.floor(rng() * 4);
      spots.push({ x, y0, z, ry });
      const loc = (ox, oz) => [x + ox * cs + oz * sn, z - ox * sn + oz * cs];
      sb.box(x, y0 - 3, z, 8.4, 6, 6.9, 0x6d6660, ry);
      for (let r = 0; r < 6; r++) sb.box(x, y0 + 0.5 + r * 0.85, z, 7.2, 0.8, 5.7, r % 2 ? logs[k] : logs[(k + 1) % 4], ry);   // stacked logs
      cpb.prism(x, y0 + 5.3, z, 9.4, 3.6, 7.8, roofs[k], ry + Math.PI / 2);
      let p = loc(0, 2.9); sb.box(p[0], y0 + 1.7, p[1], 1.4, 3.3, 0.3, 0x4a2c1a, ry);
      p = loc(-2.3, 2.9); wb.box(p[0], y0 + 3.1, p[1], 1.3, 1.3, 0.3, 0xffd9a0, ry);
      p = loc(2.3, 2.9); wb.box(p[0], y0 + 3.1, p[1], 1.3, 1.3, 0.3, 0xffd9a0, ry);
      p = loc(2.2, -1.2); sb.box(p[0], y0 + 7.4, p[1], 1.2, 3.2, 1.2, 0x8a3b2b, ry);
      // porch
      p = loc(0, 4.6); cpb.box(p[0], y0 + 0.4, p[1], 5.2, 0.3, 2.6, 0x8a6a40, ry);
      for (const sx of [-2.3, 2.3]) { p = loc(sx, 5.7); cpb.box(p[0], y0 + 1.6, p[1], 0.2, 2.4, 0.2, 0x6b4423, ry); }
      // woodpile
      p = loc(-5.2, 0.5); for (let l = 0; l < 3; l++) cpb.box(p[0], y0 + 0.4 + l * 0.5, p[1], 0.5, 0.45, 2.2, 0x9a7346, ry);
      // fence
      for (let f = -3; f <= 3; f++) { p = loc(f * 1.6, 8.5); const fy = H(p[0], p[1]); pb.box(p[0], fy + 0.6, p[1], 0.2, 1.2, 0.2, 0x8a6a40); }
      const a1 = loc(-4.8, 8.5), a2 = loc(4.8, 8.5); pb.beam(a1[0], H(a1[0], a1[1]) + 0.95, a1[1], a2[0], H(a2[0], a2[1]) + 0.95, a2[1], 0.12, 0x9a7a4a);
      // chimney smoke
      const cp = loc(2.2, -1.2);
      for (let s = 0; s < 4; s++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdddddd, transparent: true, depthWrite: false, opacity: 0 }));
        sp.position.set(cp[0], y0 + 9, cp[1]); group.add(sp);
        smoke.push({ sp, x: cp[0], y: y0 + 9, z: cp[1], off: s / 4 + ci * 0.13 });
      }
      info.cabins.push(new THREE.Vector3(x, y0, z));
    });
    for (const [b, m, n] of [[sb, brickMat, 'cabin-logs'], [cpb, plainMat, 'cabin-plain'], [wb, brickMat, 'cabin-win']]) {
      if (!b.pos.length) continue; const mesh = new THREE.Mesh(b.build(), m); mesh.name = n; cabinHost.add(mesh);
    }
    group.add(cabinHost);
    loadModel('cabin').then((proto) => {
      if (!proto) return;
      detailGLB(proto);
      // one InstancedMesh per GLB primitive: 11 cabins become a handful of draw calls
      proto.updateMatrixWorld(true);
      const parts = [];
      proto.traverse((o) => { if (o.isMesh) parts.push(o); });
      if (!parts.length) return;
      for (const c of cabinHost.children) { c.visible = false; c.userData.swProcedural = true; }
      const d = new THREE.Object3D(), m4 = new THREE.Matrix4();
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
        im.name = 'glb:cabin:' + part.name; im.castShadow = true; im.receiveShadow = true;
        spots.forEach((sp, i) => {
          d.position.set(sp.x, sp.y0, sp.z); d.rotation.set(0, sp.ry, 0); d.updateMatrix();
          im.setMatrixAt(i, m4.multiplyMatrices(d.matrix, part.matrixWorld));
        });
        im.computeBoundingSphere();
        group.add(im);
      }
    }).catch((e) => console.warn('[landmarks] cabin swap failed', e));
    updaters.push((dt, t) => {
      for (const s of smoke) {
        const u = (t * 0.12 + s.off) % 1;
        s.sp.position.set(s.x + shared.wind.x * u * 9, s.y + u * 14, s.z + shared.wind.z * u * 9);
        const sc = 1.5 + u * 6; s.sp.scale.set(sc, sc, 1);
        s.sp.material.opacity = Math.sin(Math.PI * Math.min(1, u * 1.3)) * 0.35 * clamp(shared.daylight * 1.3, 0.2, 1);
      }
    });
  }

  // ============================================================== suspension bridge
  {
    const z0 = LAYOUT.bridge.z, cx = canyonX(z0), xl = cx - 100, xr = cx + 100;
    const yl = H(xl, z0), yr = H(xr, z0), dy = Math.max(yl, yr) + 2, yT = dy + 36;
    pb.box(cx, dy, z0, 200, 1.2, 10, 0x8f8f99);
    pb.box(cx, dy + 0.62, z0, 200, 0.06, 9, 0x35383e);
    pb.box(cx, dy + 0.66, z0, 200, 0.06, 0.4, 0xf2c94c);
    for (const s of [-1, 1]) { pb.box(cx, dy + 1.4, z0 + s * 4.8, 200, 1.2, 0.3, 0xe6e6e6); pb.box(cx, dy - 1.3, z0 + s * 3, 200, 1.6, 0.3, 0x777782); }
    for (let x = cx - 96; x <= cx + 96; x += 8) pb.beam(x, dy - 0.5, z0 - 3, x + 4, dy - 2.1, z0 + 3, 0.16, 0x666670);
    for (const [ex, ey] of [[xl, yl], [xr, yr]]) { const hgt = dy - ey + 5; sb.box(ex, dy - hgt / 2 - 0.5, z0, 9, hgt, 12, 0x8c877f); }
    for (const tx of [cx - 60, cx + 60]) {
      const base = Math.min(H(tx, z0 - 6), H(tx, z0 + 6), dy - 4) - 8, hgt = yT + 2 - base;
      for (const s of [-1, 1]) pb.box(tx, base + hgt / 2, z0 + s * 6, 3.2, hgt, 3.2, 0xd9472b);
      pb.box(tx, yT, z0, 3.6, 3, 15, 0xd9472b); pb.box(tx, dy + 20, z0, 3, 2.5, 15, 0xd9472b);
      pb.beam(tx, dy + 3, z0 - 6, tx, dy + 20, z0 + 6, 0.6, 0xc8402a); pb.beam(tx, dy + 3, z0 + 6, tx, dy + 20, z0 - 6, 0.6, 0xc8402a);
      pb.beam(tx, dy + 21, z0 - 6, tx, yT - 1, z0 + 6, 0.6, 0xc8402a); pb.beam(tx, dy + 21, z0 + 6, tx, yT - 1, z0 - 6, 0.6, 0xc8402a);
      wb.box(tx, yT + 2.2, z0, 1.2, 1.2, 1.2, 0xff2a1a);
    }
    for (const s of [-1, 1]) {
      const zc = z0 + s * 5.3, cabCol = 0xb03020, low = dy + 8;
      pb.beam(xl, dy + 1.4, zc, cx - 60, yT, zc, 0.55, cabCol); pb.beam(cx + 60, yT, zc, xr, dy + 1.4, zc, 0.55, cabCol);
      let px = cx - 60, py = yT;
      for (let i = 1; i <= 12; i++) { const nx = cx - 60 + i * 10, u = (nx - cx) / 60, ny = low + (yT - low) * u * u; pb.beam(px, py, zc, nx, ny, zc, 0.55, cabCol); px = nx; py = ny; }
      for (let x = cx - 56; x <= cx + 56; x += 8) { const u = (x - cx) / 60; pb.beam(x, dy + 1.4, zc, x, low + (yT - low) * u * u, zc, 0.2, 0xd8d0c0); }
    }
    // lamp posts
    for (let x = cx - 90; x <= cx + 90; x += 30) for (const s of [-1, 1]) { pb.cyl(x, dy + 3.4, z0 + s * 4.8, 0.09, 0.12, 4.6, 5, 0x333a40); wb.box(x, dy + 5.9, z0 + s * 4.8, 0.7, 0.4, 0.7, 0xffe9a0); }
    // traffic
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 });
    const cars = [];
    for (let i = 0; i < 7; i++) {
      const cb = new GeoBuilder(), cc = [0xd7362b, 0x2f5fc8, 0xf2c94c, 0xf4f4f0, 0x2fa84a, 0x333a48, 0xff8a1f][i];
      cb.box(0, 0.7, 0, 4.4, 1.0, 1.9, cc); cb.box(-0.2, 1.4, 0, 2.4, 0.8, 1.7, 0x9fc6e8); cb.box(2.1, 0.75, 0, 0.2, 0.3, 1.5, 0xfff2b0);
      for (const wx of [-1.5, 1.5]) for (const wz of [-0.95, 0.95]) cb.cyl(wx, 0.35, wz, 0.35, 0.35, 0.3, 8, 0x111111, 0);
      const m = new THREE.Mesh(cb.build(), carMat); group.add(m);
      cars.push({ m, dir: i % 2 ? 1 : -1, x: cx - 100 + (i * 29) % 200, sp: 8 + (i * 3) % 6, lane: (i % 2 ? 1 : -1) * 2.1 });
    }
    updaters.push((dt) => {
      for (const c of cars) {
        c.x += c.dir * c.sp * dt; if (c.x > cx + 98) c.x = cx - 98; if (c.x < cx - 98) c.x = cx + 98;
        c.m.position.set(c.x, dy + 0.7, z0 + c.lane); c.m.rotation.y = c.dir > 0 ? 0 : Math.PI;
      }
    });
    info.bridge = { position: new THREE.Vector3(cx, dy, z0), length: 200, towerTop: yT };
  }

  // ============================================================== pads, runway, airfield, landing zones
  {
    const P = LAYOUT.pads, Lz = LAYOUT.landing, R = LAYOUT.runway;
    info.headings.hangGlider = heading(P.hangGlider.x, P.hangGlider.z, Lz.hangGlider.x, Lz.hangGlider.z);
    info.headings.gyrocopter = heading(R.ax, R.az, R.bx, R.bz);
    info.headings.rocketBelt = heading(P.rocketBelt.x, P.rocketBelt.z, Lz.rocketBelt.x, Lz.rocketBelt.z);
    const defs = { hangGlider: ['#ff8a1f', 'G'], gyrocopter: ['#1fa0ff', 'H'], rocketBelt: ['#ff3b6b', 'R'] };
    info.padY = {};
    for (const k in P) {
      const p = P[k], y = H(p.x, p.z) + (k === 'gyrocopter' ? 0.22 : 0.12);
      info.padY[k] = H(p.x, p.z);
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r, 64).rotateX(-Math.PI / 2), decalMat(padTexture(defs[k][0], defs[k][1])));
      m.position.set(p.x, y, p.z); m.rotation.y = -info.headings[k];
      m.renderOrder = 2;
      group.add(m);
      // windsock
      const wx = p.x + 20 * Math.cos(info.headings[k] + 2.2), wz = p.z + 20 * Math.sin(info.headings[k] + 2.2), wy = H(wx, wz);
      pb.cyl(wx, wy + 4, wz, 0.2, 0.28, 8, 6, 0xeeeeee);
      const sock = makeFlag(3.4, 1.1, [0xff7a22, 0xffffff, 0xff7a22, 0xffffff], flagMat, true);
      sock.position.set(wx, wy + 7.6, wz); sock.rotation.y = downRy; group.add(sock);
    }
    // runway
    const len = Math.hypot(R.bx - R.ax, R.bz - R.az);
    const rm = new THREE.Mesh(new THREE.PlaneGeometry(len, R.width).rotateX(-Math.PI / 2), decalMat(runwayTexture(len, R.width), true));
    rm.position.set((R.ax + R.bx) / 2, H((R.ax + R.bx) / 2, R.az) + 0.12, (R.az + R.bz) / 2);
    rm.rotation.y = Math.atan2(-(R.bz - R.az), R.bx - R.ax);
    rm.receiveShadow = true;
    group.add(rm);
    // airfield buildings: hangar, control tower, fuel tanks, apron
    const ax = (R.ax + R.bx) / 2 + 30, az = R.az + 34;
    const hy = flatBase(sb, ax, az, 46, 22, 0x8a8c92);
    sb.box(ax, hy + 6.5, az, 42, 13, 18, 0xd9dde3);
    pb.box(ax, hy + 13.5, az, 43, 1.0, 19, 0x4a5563);
    pb.prism(ax, hy + 13.8, az, 20, 3.4, 43, 0x4a5563, Math.PI / 2);
    wb.box(ax, hy + 4.2, az + 9.1, 26, 8.4, 0.3, 0x3d4756);
    for (let i = -12; i <= 12; i += 6) wb.box(ax + i, hy + 4.2, az + 9.25, 0.25, 8.4, 0.1, 0x1a1e26);
    for (let i = 0; i < 6; i++) wb.box(ax - 18 + i * 7.2, hy + 10, az + 9.1, 3.4, 1.2, 0.2, 0x9fc6e8);
    const tx = (R.ax + R.bx) / 2 - 42, tz = R.az + 32, ty = flatBase(sb, tx, tz, 12, 12, 0x8a8c92);
    sb.cyl(tx, ty + 8, tz, 2.6, 3.0, 16, 10, 0xe8e6de);
    pb.cyl(tx, ty + 17.3, tz, 5.2, 4.2, 2.2, 12, 0x444c58);
    wb.cyl(tx, ty + 19.4, tz, 5.4, 5.4, 2.8, 12, 0x88b8d8);
    pb.cyl(tx, ty + 21.3, tz, 6.2, 6.2, 0.5, 12, 0xd7362b);
    pb.cyl(tx, ty + 22.5, tz, 0.1, 0.1, 4, 5, 0x333);
    const dish = new THREE.Mesh((() => { const b = new GeoBuilder(); b.box(0, 0, 0, 4.4, 0.3, 0.3, 0x888c94); b.box(0, 0.7, 0, 4.2, 1.4, 0.15, 0xc8ccd2); b.box(0, 0, 0, 0.3, 1.2, 0.3, 0x888c94); return b.build(); })(), plainMat);
    dish.position.set(tx, ty + 25, tz); group.add(dish);
    updaters.push((dt) => { dish.rotation.y += dt * 1.6; });
    for (let i = 0; i < 3; i++) { const fx = ax + 34 + i * 7, fz = az - 4; const fy = H(fx, fz); pb.cyl(fx, fy + 3, fz, 3, 3, 6, 12, [0xe8e6de, 0xd7362b, 0xe8e6de][i]); }
    // apron
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(64, 26).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4b4e55, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    apron.position.set(ax + 6, H(ax, R.az + 18) + 0.1, R.az + 20); group.add(apron);
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(10, 26).rotateX(-Math.PI / 2), apron.material);
    taxi.position.set(ax - 14, H(ax, R.az + 15) + 0.11, R.az + 20); group.add(taxi);
    blockers.push({ x: ax, z: az, r: 40 }, { x: tx, z: tz, r: 14 });
    // parked planes/crates
    for (let i = 0; i < 5; i++) { const cx2 = ax - 24 + i * 3, cz2 = az + 16; pb.box(cx2, H(cx2, cz2) + 0.6, cz2, 1.5, 1.2, 1.5, [0xb98552, 0xd7362b, 0x2f5fc8][i % 3]); }

    // landing zones
    const tex = targetTexture();
    for (const k in Lz) {
      const l = Lz[k], y = H(l.x, l.z);
      const m = new THREE.Mesh(new THREE.CircleGeometry(l.r, 64).rotateX(-Math.PI / 2), decalMat(tex));
      m.position.set(l.x, y + 0.14, l.z); m.renderOrder = 2;
      group.add(m);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4, fx = l.x + Math.cos(a) * (l.r + 3), fz = l.z + Math.sin(a) * (l.r + 3), fy = H(fx, fz);
        pb.cyl(fx, fy + 3, fz, 0.2, 0.25, 6, 5, 0xeeeeee);
        addFlag(fx, fy + 5.4, fz, 2.8, 1.7, i % 2 ? [0xe8302a, 0xffffff] : [0xffffff, 0xe8302a], true);
      }
    }
    // hang glider launch ramp with railing
    const hp = P.hangGlider, hh = info.headings.hangGlider, hy2 = H(hp.x, hp.z);
    const fx = Math.sin(hh), fz = -Math.cos(hh);
    pb.box(hp.x + fx * 20, hy2 + 0.5, hp.z + fz * 20, 10, 1, 24, 0x8a5a34, -hh);
    for (let i = 0; i < 24; i += 2) pb.box(hp.x + fx * (8 + i), hy2 + 1.02, hp.z + fz * (8 + i), 9.6, 0.05, 0.2, 0x6b4423, -hh);
    for (const s of [-1, 1]) sb.box(hp.x + fx * 20 - fz * s * 5, hy2 + 1.2, hp.z + fz * 20 + fx * s * 5, 0.4, 0.8, 24, 0x5a3a20, -hh);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) pb.box(hp.x + fx * (10 + i * 4.4) - fz * s * 5, hy2 + 0.4, hp.z + fz * (10 + i * 4.4) + fx * s * 5, 0.3, 2.2, 0.3, 0x4a2c1a);
  }

  // ============================================================== vegetation + living props
  let vegUpdate = null;
  {
    const veg = createVegetation(terrain, { seed, blockers });
    group.add(veg.group);
    updaters.push((dt, t) => veg.update(dt, t, shared.camPos));
    info.treeCount = veg.info.treeCount; info.vegetation = veg.info;
    const props = createProps(terrain, { seed });
    group.add(props.group);
    updaters.push((dt, t) => props.update(dt, t));
    info.props = props.info;
  }

  // ============================================================== finish
  const meshes = [
    [sb, brickMat, 'landmarks-masonry'], [pb, plainMat, 'landmarks-plain'], [rb, plainMat, 'landmarks-rock'],
  ];
  for (const [b, m, name] of meshes) { if (!b.pos.length) continue; const mesh = new THREE.Mesh(b.build(), m); mesh.name = name; group.add(mesh); }
  const winMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.3, emissive: new THREE.Color(1.0, 0.72, 0.35), emissiveIntensity: 0 });
  if (wb.pos.length) { const wm = new THREE.Mesh(wb.build(), winMat); wm.name = 'landmarks-windows'; group.add(wm); }

  return {
    group, info,
    update(dt, elapsed) {
      FLAG_TIME.value = elapsed;
      winMat.emissiveIntensity = clamp((shared.night * 1.4 + shared.dusk * 0.6), 0, 1.4);
      for (let i = 0; i < updaters.length; i++) updaters[i](dt, elapsed);
    },
  };
}
