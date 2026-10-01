// SkyWings 64 - trails.js : camera-facing ribbon trails (wingtips, rocket exhaust, bombs, contrails).
// Billboarding happens in the vertex shader, so update() needs no camera and allocates nothing.
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 aTan;
attribute vec3 aInfo;   // side (-1/1), age01, u (0 head .. 1 tail)
uniform float uWidth;
uniform float uGrow;
uniform float uTaper;
varying vec3 vInfo;
void main() {
  vInfo = aInfo;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 t = mat3(modelViewMatrix) * aTan;
  float tl = length(t);
  vec3 sd = tl > 1e-5 ? cross(t / tl, normalize(mv.xyz)) : vec3(0.0, 1.0, 0.0);
  float sl = length(sd);
  sd = sl > 1e-5 ? sd / sl : vec3(0.0, 1.0, 0.0);
  float head = smoothstep(0.0, 0.04, aInfo.z);
  float w = uWidth * (1.0 + uGrow * aInfo.y) * (1.0 - uTaper * aInfo.y) * (0.35 + 0.65 * head);
  mv.xyz += sd * aInfo.x * w * 0.5;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform float uAlpha;
uniform float uAdd;
varying vec3 vInfo;
void main() {
  float e = 1.0 - vInfo.x * vInfo.x;
  float core = pow(max(e, 0.0), 1.3);
  float fade = pow(max(1.0 - vInfo.y, 0.0), 1.4) * smoothstep(0.0, 0.05, vInfo.z);
  float a = core * fade * uAlpha;
  if (a < 0.003) discard;
  vec3 c = mix(uColor0, uColor1, vInfo.y);
  if (uAdd > 0.5) c += vec3(0.6) * pow(max(e, 0.0), 4.0) * (1.0 - vInfo.y);
  gl_FragColor = vec4(c * (uAdd > 0.5 ? a : 1.0), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Trail {
  // opts: width, life, maxPoints, spacing, color, colorEnd, alpha, additive, grow (width growth with age), taper
  constructor(scene, opts) {
    const o = opts || {};
    this.scene = scene;
    this.M = Math.max(4, o.maxPoints || 32);
    this.life = o.life || 1.2;
    this.spacing = o.spacing !== undefined ? o.spacing : 0.8;
    this.emitting = true;
    const M = this.M;
    this.px = new Float32Array(M * 3);
    this.age = new Float32Array(M);
    this.h = 0; this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(M * 2 * 3);
    this.tan = new Float32Array(M * 2 * 3);
    this.info = new Float32Array(M * 2 * 3);
    this.posA = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.tanA = new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage);
    this.infoA = new THREE.BufferAttribute(this.info, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posA);
    geo.setAttribute('aTan', this.tanA);
    geo.setAttribute('aInfo', this.infoA);
    const idx = new Uint16Array((M - 1) * 6);
    for (let i = 0; i < M - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const add = !!o.additive;
    const c0 = new THREE.Color(o.color !== undefined ? o.color : 0xffffff);
    const c1 = new THREE.Color(o.colorEnd !== undefined ? o.colorEnd : (o.color !== undefined ? o.color : 0xffffff));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uWidth: { value: o.width || 0.6 }, uGrow: { value: o.grow || 0 }, uTaper: { value: o.taper !== undefined ? o.taper : 0.5 },
        uColor0: { value: new THREE.Vector3(c0.r, c0.g, c0.b) }, uColor1: { value: new THREE.Vector3(c1.r, c1.g, c1.b) },
        uAlpha: { value: o.alpha !== undefined ? o.alpha : 0.8 }, uAdd: { value: add ? 1 : 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: add ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (add) {
      this.material.blendSrc = THREE.OneFactor; this.material.blendDst = THREE.OneFactor; this.material.blendEquation = THREE.AddEquation;
      this.material.blendSrcAlpha = THREE.OneFactor; this.material.blendDstAlpha = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = add ? 12 : 11;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  push(p) {
    const M = this.M, px = this.px;
    if (this.count === 0) {
      this.h = 0; this.count = 1;
      px[0] = p.x; px[1] = p.y; px[2] = p.z; this.age[0] = 0;
      return;
    }
    const h3 = this.h * 3;
    const dx = p.x - px[h3], dy = p.y - px[h3 + 1], dz = p.z - px[h3 + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 2500) { this.clear(); this.push(p); return; } // teleport (reset / respawn)
    if (d2 >= this.spacing * this.spacing) {
      this.h = (this.h + 1) % M;
      if (this.count < M) this.count++;
      const n3 = this.h * 3;
      px[n3] = p.x; px[n3 + 1] = p.y; px[n3 + 2] = p.z; this.age[this.h] = 0;
    } else {
      px[h3] = p.x; px[h3 + 1] = p.y; px[h3 + 2] = p.z; this.age[this.h] = 0;
    }
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); this.mesh.visible = false; }

  update(dt) {
    const M = this.M;
    if (this.count === 0) return;
    const age = this.age, life = this.life, px = this.px;
    for (let k = 0; k < this.count; k++) age[(this.h - k + M) % M] += dt;
    if (!this.emitting) age[this.h] += 0; // head ages with everything else
    while (this.count > 0 && age[(this.h - this.count + 1 + M) % M] >= life) this.count--;
    if (this.count < 2) { this.geo.setDrawRange(0, 0); this.mesh.visible = false; if (this.count === 0) return; return; }
    const n = this.count, pos = this.pos, tan = this.tan, info = this.info;
    for (let k = 0; k < n; k++) {
      const i = (this.h - k + M) % M;
      const iN = k > 0 ? (i + 1) % M : i;           // newer neighbour
      const iO = k < n - 1 ? (i - 1 + M) % M : i;    // older neighbour
      let tx = px[iN * 3] - px[iO * 3], ty = px[iN * 3 + 1] - px[iO * 3 + 1], tz = px[iN * 3 + 2] - px[iO * 3 + 2];
      const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= l; ty /= l; tz /= l;
      const a = Math.min(1, age[i] / life), u = k / (n - 1);
      for (let s = 0; s < 2; s++) {
        const v = (k * 2 + s) * 3;
        pos[v] = px[i * 3]; pos[v + 1] = px[i * 3 + 1]; pos[v + 2] = px[i * 3 + 2];
        tan[v] = tx; tan[v + 1] = ty; tan[v + 2] = tz;
        info[v] = s ? 1 : -1; info[v + 1] = a; info[v + 2] = u;
      }
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
    this.posA.needsUpdate = true; this.tanA.needsUpdate = true; this.infoA.needsUpdate = true;
  }

  dispose() { this.scene.remove(this.mesh); this.geo.dispose(); this.material.dispose(); }
}
