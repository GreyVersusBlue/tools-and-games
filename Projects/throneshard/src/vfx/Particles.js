import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from './textures.js';

// One GPU draw call per ParticleSystem: a THREE.Points with a texture atlas, per-particle size/color/alpha/rotation.
// Simulation runs on the CPU with struct-of-arrays typed buffers (no per-particle allocations).

const VERT = /* glsl */`
attribute vec4 aColor;
attribute vec3 aParams; // size, frame, rotation
uniform float uScale;
varying vec4 vColor;
varying float vFrame;
varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aParams.x * uScale / max(0.1, -mv.z), 0.0, 512.0);
  vColor = aColor;
  vFrame = aParams.y;
  vRot = aParams.z;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uGain;
varying vec4 vColor;
varying float vFrame;
varying float vRot;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) * 0.98 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  float fx = mod(vFrame, ${ATLAS_COLS}.0);
  float fy = floor(vFrame / ${ATLAS_COLS}.0);
  vec2 auv = vec2((fx + uv.x) / ${ATLAS_COLS}.0, 1.0 - (fy + uv.y) / ${ATLAS_ROWS}.0);
  vec4 t = texture2D(uMap, auv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb * uGain, a);
}`;

const tmpColor = new THREE.Color();

export class ParticleSystem {
  constructor(parent, atlas, { max = 6000, additive = true, renderOrder = 10 } = {}) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.gPos = new Float32Array(max * 3);
    this.gCol = new Float32Array(max * 4);
    this.gPar = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.gCol, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aParams', new THREE.BufferAttribute(this.gPar, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlas }, uScale: { value: 600 }, uGain: { value: additive ? 0.7 : 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    this.geo = geo;
    parent.add(this.points);
    // simulation state (SoA)
    const n = max;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.r0 = new Float32Array(n); this.g0 = new Float32Array(n); this.b0 = new Float32Array(n);
    this.r1 = new Float32Array(n); this.g1 = new Float32Array(n); this.b1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.angle = new Float32Array(n); this.rotV = new Float32Array(n);
    this.frame = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.fadeIn = new Float32Array(n);
  }

  // Spawn `count` particles. o: { position (Vector3|{x,y,z}), spread (number | {x,y,z}), shape: 'sphere'|'disc'|'ring'|'point'
  //   velocity: Vector3 base, speed [min,max] (radial along shape dir), up [min,max] (added +Y), dir: Vector3 (cone), cone (radians)
  //   life [min,max], size [start,end] (world units; each may be [min,max] via sizeVar), color, color2, alpha,
  //   frame, rotSpeed, gravity, drag, fadeIn (fraction), radius (for ring/disc) }
  emit(count, o) {
    const p = o.position ?? { x: 0, y: 0, z: 0 };
    const spread = o.spread ?? 0;
    const sx = typeof spread === 'number' ? spread : spread.x ?? 0;
    const sy = typeof spread === 'number' ? spread : spread.y ?? 0;
    const sz = typeof spread === 'number' ? spread : spread.z ?? 0;
    const shape = o.shape ?? 'sphere';
    const [lmin, lmax] = Array.isArray(o.life) ? o.life : [o.life ?? 1, o.life ?? 1];
    const [spmin, spmax] = Array.isArray(o.speed) ? o.speed : [o.speed ?? 0, o.speed ?? 0];
    const [upmin, upmax] = Array.isArray(o.up) ? o.up : [o.up ?? 0, o.up ?? 0];
    const size = o.size ?? [1, 0];
    const sStart = Array.isArray(size) ? size[0] : size, sEnd = Array.isArray(size) ? size[1] : size;
    const sizeVar = o.sizeVar ?? 0.3;
    tmpColor.set(o.color ?? 0xffffff);
    const cr = tmpColor.r, cg = tmpColor.g, cb = tmpColor.b;
    tmpColor.set(o.color2 ?? o.color ?? 0xffffff);
    const cr2 = tmpColor.r, cg2 = tmpColor.g, cb2 = tmpColor.b;
    const intensity = o.intensity ?? 1;
    const vel = o.velocity;
    const dir = o.dir;
    const cone = o.cone ?? 0.4;
    const radius = o.radius ?? 1;
    const frames = o.frames;
    for (let k = 0; k < count; k++) {
      if (this.count >= this.max) return;
      const i = this.count++;
      let dx = 0, dy = 0, dz = 0;
      let x = p.x, y = p.y, z = p.z;
      if (shape === 'sphere') {
        // random direction
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
        dx = rr * Math.cos(th); dy = u; dz = rr * Math.sin(th);
        const m = Math.cbrt(Math.random());
        x += dx * sx * m; y += dy * sy * m; z += dz * sz * m;
      } else if (shape === 'ring' || shape === 'disc') {
        const th = Math.random() * Math.PI * 2;
        const m = shape === 'ring' ? 1 : Math.sqrt(Math.random());
        dx = Math.cos(th); dz = Math.sin(th);
        x += dx * radius * m + (Math.random() - 0.5) * sx; z += dz * radius * m + (Math.random() - 0.5) * sz; y += (Math.random() - 0.5) * sy;
      } else if (shape === 'box') {
        x += (Math.random() - 0.5) * 2 * sx; y += (Math.random() - 0.5) * 2 * sy; z += (Math.random() - 0.5) * 2 * sz;
        dy = 1;
      }
      if (dir) {
        // cone around dir
        const a = Math.random() * Math.PI * 2, c = Math.random() * cone;
        const ux = dir.x, uy = dir.y, uz = dir.z;
        // build orthonormal basis
        let ax = Math.abs(uy) < 0.9 ? 0 : 1, ay = Math.abs(uy) < 0.9 ? 1 : 0, az = 0;
        let bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
        const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
        const cx = uy * bz - uz * by, cy = uz * bx - ux * bz, cz = ux * by - uy * bx;
        const sc = Math.sin(c), cc = Math.cos(c), ca = Math.cos(a), sa = Math.sin(a);
        dx = ux * cc + (bx * ca + cx * sa) * sc; dy = uy * cc + (by * ca + cy * sa) * sc; dz = uz * cc + (bz * ca + cz * sa) * sc;
      }
      const sp = spmin + Math.random() * (spmax - spmin);
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = dx * sp + (vel ? vel.x : 0);
      this.vy[i] = dy * sp + (vel ? vel.y : 0) + upmin + Math.random() * (upmax - upmin);
      this.vz[i] = dz * sp + (vel ? vel.z : 0);
      const l = lmin + Math.random() * (lmax - lmin);
      this.life[i] = l; this.maxLife[i] = l;
      const sv = 1 + (Math.random() * 2 - 1) * sizeVar;
      this.s0[i] = sStart * sv; this.s1[i] = sEnd * sv;
      this.r0[i] = cr * intensity; this.g0[i] = cg * intensity; this.b0[i] = cb * intensity;
      this.r1[i] = cr2 * intensity; this.g1[i] = cg2 * intensity; this.b1[i] = cb2 * intensity;
      this.a0[i] = o.alpha ?? 1;
      this.angle[i] = o.rotation ?? Math.random() * Math.PI * 2;
      this.rotV[i] = (o.rotSpeed ?? 0) * (Math.random() * 2 - 1);
      this.frame[i] = frames ? frames[(Math.random() * frames.length) | 0] : (o.frame ?? 0);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.fadeIn[i] = o.fadeIn ?? 0.1;
    }
  }

  update(dt, camera, viewportHeight) {
    if (camera?.isPerspectiveCamera) this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    let n = this.count;
    const P = this.gPos, C = this.gCol, Q = this.gPar;
    for (let i = 0; i < n; i++) {
      let l = this.life[i] - dt;
      if (l <= 0) {
        // swap-remove with last
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      this.life[i] = l;
      const d = this.drag[i];
      if (d > 0) { const f = Math.max(0, 1 - d * dt); this.vx[i] *= f; this.vy[i] *= f; this.vz[i] *= f; }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.angle[i] += this.rotV[i] * dt;
      const k = 1 - l / this.maxLife[i]; // 0 -> 1
      const fi = this.fadeIn[i];
      const alpha = this.a0[i] * (k < fi ? k / fi : 1 - (k - fi) / (1 - fi));
      const j3 = i * 3, j4 = i * 4;
      P[j3] = this.px[i]; P[j3 + 1] = this.py[i]; P[j3 + 2] = this.pz[i];
      C[j4] = this.r0[i] + (this.r1[i] - this.r0[i]) * k;
      C[j4 + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * k;
      C[j4 + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * k;
      C[j4 + 3] = Math.max(0, alpha);
      Q[j3] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      Q[j3 + 1] = this.frame[i];
      Q[j3 + 2] = this.angle[i];
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    const a = this.geo.attributes;
    if (n > 0) {
      for (const [attr, sz] of [[a.position, 3], [a.aColor, 4], [a.aParams, 3]]) {
        attr.clearUpdateRanges?.();
        attr.addUpdateRange?.(0, n * sz);
        attr.needsUpdate = true;
      }
    }
  }

  copy(from, to) {
    const arrs = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.s0, this.s1, this.r0, this.g0, this.b0,
      this.r1, this.g1, this.b1, this.a0, this.angle, this.rotV, this.frame, this.grav, this.drag, this.fadeIn];
    for (const a of arrs) a[to] = a[from];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}
