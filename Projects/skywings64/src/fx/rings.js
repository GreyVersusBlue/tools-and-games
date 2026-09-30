// SkyWings 64 - rings.js : glowing energy rings, holographic landing pad + beacon, target markers.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const addBlend = (m) => {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendEquation = THREE.AddEquation;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
};
const quality = () => (typeof window !== 'undefined' && window.SW_QUALITY) || 'high';

// ---------------------------------------------------------------- shaders
const VS_MESH = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vL;
void main() {
  vUv = uv; vL = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FS_RING = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uActive; uniform float uFlash; uniform float uOpacity; uniform float uShell;
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vL;
void main() {
  vec3 n = normalize(vN); vec3 v = normalize(-vP);
  float ndv = abs(dot(n, v));
  float speed = 1.5 + 4.0 * uActive;
  float bands = 0.5 + 0.5 * sin(vUv.x * ${TAU.toFixed(4)} * 14.0 - uTime * speed * 1.7 + sin(vUv.y * ${TAU.toFixed(4)}) * 1.5);
  float comet = pow(0.5 + 0.5 * sin(vUv.x * ${TAU.toFixed(4)} * 3.0 - uTime * (1.2 + 2.5 * uActive)), 6.0);
  float flow = mix(0.35, 1.0, bands) + comet * 0.9;
  vec3 col; float a;
  if (uShell > 0.5) {                       // soft volumetric halo
    float h = pow(ndv, 2.2);
    a = h * (0.20 + 0.32 * uActive) * (0.7 + 0.5 * bands) * uOpacity;
    col = uColor * 1.4;
  } else {                                  // energy tube
    float core = pow(ndv, 5.0);
    col = uColor * (0.45 + 1.1 * flow * (0.35 + 0.65 * uActive)) + vec3(1.0) * core * (0.35 + 0.5 * uActive);
    a = (0.55 + 0.45 * ndv) * uOpacity;
  }
  col += vec3(1.0) * uFlash;
  gl_FragColor = vec4(col, clamp(a + uFlash * 0.5, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FS_DISC = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uActive; uniform float uFlash; uniform float uOpacity;
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vL;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float swirl = 0.5 + 0.5 * sin(r * 18.0 - uTime * 2.5 + ang * 3.0);
  float rings = 0.5 + 0.5 * sin(r * 40.0 - uTime * 4.0);
  float edge = smoothstep(0.55, 1.0, r);
  float a = (0.03 + 0.05 * swirl * rings + 0.16 * edge * edge) * (0.35 + 0.65 * uActive) * uOpacity;
  a *= smoothstep(1.0, 0.94, r);
  vec3 col = uColor * (0.8 + 0.8 * swirl) + vec3(uFlash);
  gl_FragColor = vec4(col, clamp(a + uFlash * 0.25 * (1.0 - r), 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const VS_MOTE = /* glsl */`
attribute vec4 aM;   // angle0, speed, radial offset, phase
uniform float uTime; uniform float uR; uniform float uScale; uniform float uActive;
varying float vA;
void main() {
  float ang = aM.x + uTime * aM.y * (0.5 + 0.8 * uActive);
  float rr = uR * (1.0 + aM.z);
  vec3 p = vec3(cos(ang) * rr, sin(ang) * rr, sin(uTime * 2.0 + aM.w * 6.28) * uR * 0.05);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uR * 0.10 * uScale / max(0.5, -mv.z), 1.5, 22.0);
  vA = 0.4 + 0.6 * abs(sin(uTime * 3.0 + aM.w * 6.28));
}`;
const FS_MOTE = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c);
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * vA * uOpacity;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.55), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const VS_PATH = /* glsl */`
attribute float aT;
uniform vec3 uTarget; uniform float uTime; uniform float uScale; uniform float uSize;
varying float vA;
void main() {
  float t = fract(aT + uTime * 0.12);
  vec3 p = uTarget * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * sin(t * 3.14159)) * uScale / max(0.5, -mv.z), 1.0, 40.0);
  vA = sin(t * 3.14159) * smoothstep(0.0, 0.08, t);
}`;
const FS_PATH = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // chevron pointing along +y of the sprite is not oriented; draw a soft diamond instead
  float d = abs(c.x) + abs(c.y);
  if (d > 1.0) discard;
  float a = (1.0 - d) * vA * uOpacity;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FS_BEAM = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uCore;
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vL;
void main() {
  vec3 n = normalize(vN); vec3 v = normalize(-vP);
  float ndv = abs(dot(n, v));
  float h = vUv.y;                    // 1 top .. 0 bottom
  float vert = pow(1.0 - h, 0.9);
  float scan = 0.62 + 0.38 * sin((1.0 - h) * 140.0 - uTime * 7.0);
  float stripes = 0.8 + 0.2 * sin(vUv.x * ${TAU.toFixed(4)} * 10.0 + uTime * 0.8);
  float flick = 0.92 + 0.08 * sin(uTime * 23.0) * sin(uTime * 7.3);
  float edge = mix(pow(ndv, 1.2), pow(ndv, 3.0), uCore);
  float a = uOpacity * vert * edge * scan * stripes * flick;
  a += uOpacity * 0.8 * pow(1.0 - h, 14.0) * edge;    // ground glow
  vec3 col = uColor * (1.0 + 0.7 * uCore) + vec3(1.0) * uCore * 0.3;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FS_HOLO = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uOpacity;
varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vL;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p); float ang = atan(p.y, p.x);
  float grid = max(smoothstep(0.93, 1.0, sin(r * 42.0)), smoothstep(0.96, 1.0, sin(ang * 16.0)));
  float sweep = pow(max(0.0, cos(ang - uTime * 1.6)), 6.0) * smoothstep(0.1, 1.0, r);
  float ring = smoothstep(0.03, 0.0, abs(r - fract(uTime * 0.35) * 1.0)) * 0.9;
  float a = (grid * 0.5 + sweep * 0.55 + ring * 0.6 + 0.06) * smoothstep(1.0, 0.9, r) * uOpacity;
  vec3 col = uColor * (0.8 + sweep) + vec3(0.25) * ring;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function shaderMat(fs, uniforms, vs) {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: vs || VS_MESH, fragmentShader: fs, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  addBlend(m);
  return m;
}
const col3 = (c) => new THREE.Vector3(c.r, c.g, c.b);
const _scaleV = new THREE.Vector2();
function pixelScaleUpdater(mat) {
  return (renderer, sc, camera) => {
    if (!camera.isPerspectiveCamera) return;
    renderer.getDrawingBufferSize(_scaleV);
    mat.uniforms.uScale.value = _scaleV.y / (2 * Math.tan(camera.fov * Math.PI / 360));
  };
}

// ---------------------------------------------------------------- Ring
let _serial = 0;
const _tv = new THREE.Vector3();
const _tv2 = new THREE.Vector3();

// Ring lies in the local XY plane (normal +Z); orient the group with lookAt / quaternion.
// userData: update(dt), setActive(bool), collect(), reset(), linkNext(ringGroup|Vector3|null)
export function createRing(radius, colorHex) {
  radius = radius || 10;
  const q = quality();
  const color = new THREE.Color(colorHex !== undefined ? colorHex : 0xffcc00);
  const inactiveColor = new THREE.Color(0x9fb0c8);
  const group = new THREE.Group();
  const shared = {
    uColor: { value: col3(color) }, uTime: { value: Math.random() * 20 }, uActive: { value: 1 }, uFlash: { value: 0 }, uOpacity: { value: 1 },
  };
  const un = (extra) => Object.assign({}, shared, extra);   // share color/time/active objects across the ring's materials

  const coreMat = shaderMat(FS_RING, un({ uShell: { value: 0 } }));
  const core = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.055, q === 'low' ? 8 : 14, q === 'low' ? 40 : 72), coreMat);
  core.renderOrder = 10;
  group.add(core);

  const shellMat = shaderMat(FS_RING, un({ uShell: { value: 1 } }));
  const shell = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.2, 12, q === 'low' ? 32 : 56), shellMat);
  shell.renderOrder = 9;
  group.add(shell);

  const discMat = shaderMat(FS_DISC, un({}));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.97, 48), discMat);
  disc.renderOrder = 8;
  group.add(disc);

  // orbiting motes
  let motes = null, moteMat = null;
  if (q !== 'low') {
    const MN = 40;
    const geo = new THREE.BufferGeometry();
    const aM = new Float32Array(MN * 4);
    for (let i = 0; i < MN; i++) { aM[i * 4] = Math.random() * TAU; aM[i * 4 + 1] = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.8); aM[i * 4 + 2] = (Math.random() - 0.5) * 0.12; aM[i * 4 + 3] = Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MN * 3), 3));
    geo.setAttribute('aM', new THREE.BufferAttribute(aM, 4));
    moteMat = new THREE.ShaderMaterial({
      uniforms: { uColor: shared.uColor, uTime: shared.uTime, uActive: shared.uActive, uOpacity: shared.uOpacity, uR: { value: radius }, uScale: { value: 800 } },
      vertexShader: VS_MOTE, fragmentShader: FS_MOTE, transparent: true, depthWrite: false,
    });
    addBlend(moteMat);
    motes = new THREE.Points(geo, moteMat);
    motes.frustumCulled = false; motes.renderOrder = 11;
    motes.onBeforeRender = pixelScaleUpdater(moteMat);
    group.add(motes);
  }

  // ghost path to the next ring (points flow along the line)
  const PN = 22;
  const pgeo = new THREE.BufferGeometry();
  const aT = new Float32Array(PN);
  for (let i = 0; i < PN; i++) aT[i] = i / PN;
  pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
  pgeo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  const pathMat = new THREE.ShaderMaterial({
    uniforms: { uColor: shared.uColor, uTime: shared.uTime, uOpacity: { value: 0.75 }, uTarget: { value: new THREE.Vector3() }, uScale: { value: 800 }, uSize: { value: radius * 0.22 } },
    vertexShader: VS_PATH, fragmentShader: FS_PATH, transparent: true, depthWrite: false,
  });
  addBlend(pathMat);
  const path = new THREE.Points(pgeo, pathMat);
  path.frustumCulled = false; path.visible = false; path.renderOrder = 11;
  path.onBeforeRender = pixelScaleUpdater(pathMat);
  group.add(path);

  const ud = group.userData;
  ud.isSwRing = true;
  ud.serial = _serial++;
  ud.active = true;
  ud.collected = false;
  ud.radius = radius;
  let collectT = -1;
  let blend = 1;
  let nextRef = null;      // explicit link
  let needLink = true;
  let linkTimer = 0;

  const resolveNext = () => {
    let tgt = nextRef;
    if (!tgt && group.parent) {
      let best = null;
      const ch = group.parent.children;
      for (let i = 0; i < ch.length; i++) {
        const o = ch[i];
        if (o === group || !o.userData || !o.userData.isSwRing || o.userData.collected) continue;
        if (o.userData.serial > ud.serial && (!best || o.userData.serial < best.userData.serial)) best = o;
      }
      tgt = best;
    }
    if (!tgt) { path.visible = false; return; }
    group.updateWorldMatrix(true, false);
    if (tgt.isObject3D) { tgt.updateWorldMatrix(true, false); _tv.setFromMatrixPosition(tgt.matrixWorld); } else _tv.copy(tgt);
    group.worldToLocal(_tv2.copy(_tv));
    const d = _tv2.length();
    if (d > 900 || d < radius * 2) { path.visible = false; return; }
    pathMat.uniforms.uTarget.value.copy(_tv2);
    path.visible = true;
  };

  ud.update = (dt) => {
    if (!(dt > 0)) dt = 0.016;
    shared.uTime.value += dt;
    blend += ((ud.active ? 1 : 0) - blend) * Math.min(1, dt * 6);
    shared.uActive.value = blend;
    if (collectT >= 0) {
      collectT += dt;
      const k = collectT / 0.7;
      if (k >= 1) { group.visible = false; collectT = -1; ud.collected = true; return; }
      const e = 1 - (1 - k) * (1 - k);
      group.scale.setScalar(1 + e * 0.5);
      shell.scale.setScalar(1 + e * 1.6);
      shared.uFlash.value = 0.9 * (1 - k) * (1 - k);
      shared.uOpacity.value = 1 - k * k;
      path.visible = false;
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(shared.uTime.value * (ud.active ? 5 : 1.5));
    core.scale.setScalar(1 + (ud.active ? 0.03 * pulse : 0));
    shared.uColor.value.set(0, 0, 0);
    // colour: blend between ghost tint and real colour
    const cr = inactiveColor.r + (color.r - inactiveColor.r) * blend;
    const cg = inactiveColor.g + (color.g - inactiveColor.g) * blend;
    const cb = inactiveColor.b + (color.b - inactiveColor.b) * blend;
    shared.uColor.value.set(cr, cg, cb);
    shared.uOpacity.value = 0.32 + 0.68 * blend;
    if (motes) motes.visible = blend > 0.25;
    if (ud.active) {
      if (needLink) { resolveNext(); needLink = false; linkTimer = 0; }
      else if ((linkTimer += dt) > 1.0) { linkTimer = 0; resolveNext(); }
    } else if (path.visible) path.visible = false;
  };

  ud.setActive = (a) => {
    ud.active = !!a;
    needLink = true;
    if (collectT < 0 && !ud.collected) group.visible = true;
  };
  // optional: explicitly link the ghost path to another ring group or a world-space Vector3
  ud.linkNext = (t) => { nextRef = t || null; needLink = true; };

  ud.collect = () => {
    if (collectT >= 0 || ud.collected) return;
    collectT = 0;
    group.visible = true;
    path.visible = false;
  };

  ud.reset = () => {
    collectT = -1; ud.collected = false; group.visible = true; group.scale.setScalar(1); shell.scale.setScalar(1);
    shared.uFlash.value = 0; shared.uOpacity.value = 1; blend = ud.active ? 1 : 0; needLink = true;
  };

  ud.dispose = () => {
    for (const m of [core, shell, disc]) m.geometry.dispose();
    for (const m of [coreMat, shellMat, discMat, pathMat, moteMat]) if (m) m.dispose();
    pgeo.dispose(); if (motes) motes.geometry.dispose();
  };

  ud.update(0.016);
  return group;
}

// ---------------------------------------------------------------- Landing pad
function padTexture() {
  const s = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, '#4a5364'); gr.addColorStop(1, '#2e3543');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  // panel seams + subtle noise
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
  for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(i * s / 8, 0); g.lineTo(i * s / 8, s); g.moveTo(0, i * s / 8); g.lineTo(s, i * s / 8); g.stroke(); }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`; g.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
  g.translate(s / 2, s / 2);
  g.strokeStyle = '#ffd21f'; g.lineWidth = 18;
  g.beginPath(); g.arc(0, 0, s * 0.46, 0, TAU); g.stroke();
  g.strokeStyle = '#ffffff'; g.lineWidth = 8;
  g.beginPath(); g.arc(0, 0, s * 0.36, 0, TAU); g.stroke();
  g.fillStyle = '#e8ecf4';
  g.fillRect(-72, -100, 32, 200); g.fillRect(40, -100, 32, 200); g.fillRect(-72, -16, 144, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeBeamMesh(radius, height, color, opacity, core) {
  const mat = shaderMat(FS_BEAM, {
    uColor: { value: col3(new THREE.Color(color)) }, uTime: { value: 0 }, uOpacity: { value: opacity }, uCore: { value: core ? 1 : 0 },
  });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, height, 28, 1, true), mat);
  m.position.y = height / 2;
  m.renderOrder = 9;
  return m;
}

const ringGeoCache = {};
export function createLandingPadMesh(radius) {
  radius = radius || 8;
  const group = new THREE.Group();
  const h = 0.4;
  const side = new THREE.MeshLambertMaterial({ color: 0x555d6b });
  const top = new THREE.MeshLambertMaterial({ map: padTexture(), emissive: 0x151a24 });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, h, 48), [side, top, side]);
  cyl.position.y = h / 2;
  group.add(cyl);

  const nLights = Math.max(10, Math.round(radius * 1.8));
  const lightGeo = new THREE.CylinderGeometry(radius * 0.03 + 0.1, radius * 0.03 + 0.1, 0.25, 8);
  const matR = new THREE.MeshBasicMaterial({ color: 0xff3344, fog: false });
  const matW = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  // rim lights: two InstancedMeshes (red / white) instead of ~65 separate draw calls
  const nHalf = [Math.ceil(nLights / 2), Math.floor(nLights / 2)];
  const rimW = new THREE.InstancedMesh(lightGeo, matW, nHalf[0]), rimR = new THREE.InstancedMesh(lightGeo, matR, nHalf[1]);
  const _d = new THREE.Object3D(), idx = [0, 0];
  for (let i = 0; i < nLights; i++) {
    const a = (i / nLights) * TAU;
    _d.position.set(Math.cos(a) * radius * 0.97, h + 0.1, Math.sin(a) * radius * 0.97); _d.updateMatrix();
    (i % 2 ? rimR : rimW).setMatrixAt(idx[i % 2]++, _d.matrix);
  }
  rimW.computeBoundingSphere(); rimR.computeBoundingSphere();
  group.add(rimW, rimR);

  const beaconH = Math.max(60, radius * 9);
  const active = new THREE.Group();
  group.add(active);
  const outer = makeBeamMesh(radius * 0.42, beaconH, 0x40ffb0, 0.34, false);
  const inner = makeBeamMesh(radius * 0.14, beaconH, 0xb8fff0, 0.5, true);
  outer.position.y = inner.position.y = h + beaconH / 2;
  active.add(outer, inner);

  // holographic disc hovering just above the pad
  const holoMat = shaderMat(FS_HOLO, { uColor: { value: col3(new THREE.Color(0x40ffc0)) }, uTime: { value: 0 }, uOpacity: { value: 0.9 } });
  const holoGeo = new THREE.CircleGeometry(radius * 0.94, 64); holoGeo.rotateX(-Math.PI / 2);
  const holo = new THREE.Mesh(holoGeo, holoMat);
  holo.position.y = h + 0.12; holo.renderOrder = 8;
  active.add(holo);

  // rising ring pulses along the beam
  const RN = 4;
  const rg = ringGeoCache.r || (ringGeoCache.r = new THREE.TorusGeometry(1, 0.03, 6, 48));
  const rise = [];
  for (let i = 0; i < RN; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x88ffdd, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    addBlend(m);
    const mesh = new THREE.Mesh(rg, m);
    mesh.rotation.x = Math.PI / 2; mesh.renderOrder = 10;
    active.add(mesh); rise.push(mesh);
  }

  let time = 0;
  const ud = group.userData;
  ud.radius = radius;
  ud.update = (dt) => {
    time += dt > 0 ? dt : 0.016;
    outer.material.uniforms.uTime.value = time; inner.material.uniforms.uTime.value = time; holoMat.uniforms.uTime.value = time;
    for (let i = 0; i < RN; i++) {
      const k = (time * 0.22 + i / RN) % 1;
      const m = rise[i];
      m.position.y = h + 0.3 + k * Math.min(beaconH * 0.8, radius * 6);
      m.scale.setScalar(radius * (0.5 - 0.1 * k));
      m.material.opacity = 0.55 * Math.sin(k * Math.PI);
    }
    const ph = Math.floor(time * 3) & 1;
    matR.color.setHex(ph ? 0xff3344 : 0x661018);
    matW.color.setHex(ph ? 0x667080 : 0xffffff);
  };
  ud.setActive = (a) => { active.visible = !!a; };
  ud.dispose = () => { cyl.geometry.dispose(); lightGeo.dispose(); holoGeo.dispose(); };
  ud.update(0.016);
  return group;
}

export function createTargetMarker(radius) {
  radius = radius || 5;
  const group = new THREE.Group();
  const cols = [0xff2233, 0xffffff, 0xff2233, 0xffffff];
  for (let i = 0; i < 4; i++) {
    const r1 = radius * (1 - i * 0.22), r0 = radius * (1 - (i + 1) * 0.22);
    const geo = new THREE.RingGeometry(Math.max(0, r0), r1, 40);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols[i], side: THREE.DoubleSide, fog: false }));
    m.position.y = 0.08 + i * 0.01;
    group.add(m);
  }
  const bh = Math.max(30, radius * 6);
  const beam = makeBeamMesh(radius * 0.22, bh, 0xff4455, 0.4, false);
  const beam2 = makeBeamMesh(radius * 0.07, bh, 0xffb0b0, 0.55, true);
  group.add(beam, beam2);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.25, radius * 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xffdd33, fog: false }));
  arrow.rotation.x = Math.PI;
  group.add(arrow);
  let time = Math.random() * 6;
  group.userData.radius = radius;
  group.userData.update = (dt) => {
    dt = dt > 0 ? dt : 0.016;
    time += dt;
    arrow.position.y = radius * 1.4 + Math.sin(time * 3) * radius * 0.15;
    arrow.rotation.y += dt * 2;
    beam.material.uniforms.uTime.value = time; beam2.material.uniforms.uTime.value = time;
  };
  group.userData.update(0.016);
  return group;
}
