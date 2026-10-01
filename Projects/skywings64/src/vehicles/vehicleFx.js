// Self-contained world-space effects owned by the vehicles: vapour ribbons, dust/steam puffs, layered flames.
// Objects are children of vehicle.mesh but have matrixWorldAutoUpdate=false (identity world matrix), so all
// coordinates stored in them are world coordinates.
import * as THREE from 'three';
import { flameTexture, glowTexture, softPuffTexture, seg } from './materials.js';

const V3 = THREE.Vector3;
const _a = new V3();
const _s = new V3();
const _u = new V3();
const UP = new V3(0, 1, 0);

export class WorldRibbon {
  constructor(maxPts = 36, { width = 0.18, grow = 1.6, color = 0xffffff, opacity = 0.5, life = 1.6, additive = false } = {}) {
    this.max = maxPts;
    this.width = width;
    this.grow = grow;
    this.life = life;
    this.opacity = opacity;
    this.pts = [];
    this.acc = 0;
    this.lastEmit = false;
    const nv = maxPts * 4;
    this.pos = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 4);
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) {
      for (let k = 0; k < 2; k++) {
        const a = i * 4 + k * 2, b = a + 1, c = a + 4, d = a + 5;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.rgb = new THREE.Color(color);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrixWorld = () => {};
    this.mesh.userData.noShadow = true;
    this.mesh.renderOrder = 5;
  }
  reset() {
    this.pts.length = 0;
    this.geo.setDrawRange(0, 0);
  }
  // p: world position, strength 0..1 (0 = stop emitting; ribbon fades out)
  update(dt, p, strength) {
    const pts = this.pts;
    for (const q of pts) q.age += dt;
    while (pts.length && pts[pts.length - 1].age > this.life) pts.pop();
    if (strength > 0.02 && p) {
      this.acc += dt;
      if (this.acc >= 0.025 || !this.lastEmit) {
        this.acc = 0;
        pts.unshift({ x: p.x, y: p.y, z: p.z, age: 0, s: strength });
        if (pts.length > this.max) pts.pop();
      } else if (pts.length) {
        pts[0].x = p.x; pts[0].y = p.y; pts[0].z = p.z;
      }
      this.lastEmit = true;
    } else this.lastEmit = false;
    const n = pts.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < n; i++) {
      const q = pts[i];
      const nx = pts[Math.min(n - 1, i + 1)];
      const pv = pts[Math.max(0, i - 1)];
      _a.set(pv.x - nx.x, pv.y - nx.y, pv.z - nx.z);
      if (_a.lengthSq() < 1e-8) _a.set(0, 0, 1);
      _a.normalize();
      _s.crossVectors(_a, UP);
      if (_s.lengthSq() < 1e-4) _s.set(1, 0, 0);
      _s.normalize();
      _u.crossVectors(_s, _a).normalize();
      const t = q.age / this.life;
      const w = this.width * (1 + this.grow * t) * (0.4 + 0.6 * q.s);
      const alpha = this.opacity * q.s * (1 - t) * (1 - t) * Math.min(1, i / 2 + 0.2);
      const o = i * 4;
      const set = (k, dx, dy, dz) => {
        this.pos[(o + k) * 3] = q.x + dx * w;
        this.pos[(o + k) * 3 + 1] = q.y + dy * w;
        this.pos[(o + k) * 3 + 2] = q.z + dz * w;
        const c = (o + k) * 4;
        this.col[c] = this.rgb.r; this.col[c + 1] = this.rgb.g; this.col[c + 2] = this.rgb.b; this.col[c + 3] = alpha;
      };
      set(0, _s.x, _s.y, _s.z);
      set(1, -_s.x, -_s.y, -_s.z);
      set(2, _u.x, _u.y, _u.z);
      set(3, -_u.x, -_u.y, -_u.z);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 12);
  }
}

const PUFF_VS = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale; varying float vA; varying vec3 vC;
void main(){ vA=aAlpha; vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
 gl_PointSize = aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`;
const PUFF_FS = `
uniform sampler2D uMap; varying float vA; varying vec3 vC;
void main(){ vec4 t=texture2D(uMap,gl_PointCoord); gl_FragColor=vec4(vC, t.a*vA); if(gl_FragColor.a<0.003) discard; }`;

export class PuffPool {
  constructor(max = 96) {
    this.max = max;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 2, a: 0.5, buoy: 0, drag: 1, r: 1, g: 1, b: 1 });
    this.head = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uMap: { value: softPuffTexture() }, uScale: { value: 500 } };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false })
    );
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.updateMatrixWorld = () => {};
    this.points.userData.noShadow = true;
    this.points.renderOrder = 6;
    this.points.onBeforeRender = (renderer, scene, camera) => {
      const s = renderer.getDrawingBufferSize(_dbs);
      this.uniforms.uScale.value = s.y * 0.5 * camera.projectionMatrix.elements[5];
    };
  }
  get object() {
    return this.points;
  }
  emit(x, y, z, vx, vy, vz, o = {}) {
    const p = this.p[this.head];
    this.head = (this.head + 1) % this.max;
    p.alive = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.age = 0;
    p.life = o.life ?? 1; p.s0 = o.s0 ?? 0.4; p.s1 = o.s1 ?? 1.6; p.a = o.alpha ?? 0.5; p.buoy = o.buoy ?? 0; p.drag = o.drag ?? 1.5;
    const c = o.color ?? 0xffffff;
    p.r = ((c >> 16) & 255) / 255; p.g = ((c >> 8) & 255) / 255; p.b = (c & 255) / 255;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
        else {
          const k = Math.exp(-p.drag * dt);
          p.vx *= k; p.vz *= k; p.vy = p.vy * k + p.buoy * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          any = true;
        }
      }
      const t = p.alive ? p.age / p.life : 1;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.alive ? p.s0 + (p.s1 - p.s0) * Math.sqrt(t) : 0;
      this.alpha[i] = p.alive ? p.a * (1 - t) * Math.min(1, t * 8 + 0.15) : 0;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
    this.points.visible = any || true;
  }
}
const _dbs = new THREE.Vector2();

// Layered additive flame pointing down (-Y) from the local origin. Length driven by update().
export class Flame {
  constructor(radius = 0.12) {
    this.group = new THREE.Group();
    this.layers = [];
    const specs = [
      { r: 1.5, l: 1.0, color: 0xff5a10, op: 0.55, speed: 1.6 },
      { r: 1.0, l: 0.78, color: 0xffb030, op: 0.75, speed: 2.2 },
      { r: 0.6, l: 0.55, color: 0xfff4c0, op: 0.9, speed: 3.0 },
      { r: 0.32, l: 0.34, color: 0xdff0ff, op: 1.0, speed: 4.0 },
    ];
    for (const sp of specs) {
      const g = new THREE.ConeGeometry(radius * sp.r, 1, seg(16, 10, 6), 1, true);
      g.rotateX(Math.PI);
      g.translate(0, -0.5, 0);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      const map = flameTexture().clone();
      map.needsUpdate = true;
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          map, color: sp.color, transparent: true, opacity: sp.op, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, fog: false,
        })
      );
      m.frustumCulled = false;
      m.userData.noShadow = true;
      m.renderOrder = 7;
      this.group.add(m);
      this.layers.push({ m, ...sp, base: sp.op });
    }
    // heat glow at the nozzle
    const sm = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9a40, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.glow = new THREE.Sprite(sm);
    this.glow.position.y = -0.08;
    this.glow.renderOrder = 8;
    this.group.add(this.glow);
    // shock diamonds
    this.diamonds = [];
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(
        new THREE.OctahedronGeometry(radius * 0.5, 0),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
      );
      d.scale.set(1, 1.6, 1);
      d.userData.noShadow = true;
      d.frustumCulled = false;
      this.group.add(d);
      this.diamonds.push(d);
    }
    this.t = Math.random() * 10;
    this.radius = radius;
  }
  // power 0..1(.4 boost), len metres at full
  update(dt, power, boost = false) {
    this.t += dt;
    const on = power > 0.02;
    this.group.visible = on;
    if (!on) return;
    const f1 = 0.86 + 0.14 * Math.sin(this.t * 70) + (Math.random() - 0.5) * 0.14;
    const len = (0.35 + power * 1.9) * (boost ? 1.4 : 1);
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      const flick = 1 + (Math.random() - 0.5) * 0.18;
      const w = (0.8 + power * 0.5) * (1 + 0.08 * Math.sin(this.t * (40 + i * 9)));
      L.m.scale.set(w, len * L.l * f1 * flick, w);
      L.m.material.map.offset.y = -this.t * L.speed;
      L.m.material.opacity = L.base * Math.min(1, 0.3 + power);
      L.m.rotation.y += dt * 9;
    }
    for (let i = 0; i < this.diamonds.length; i++) {
      const d = this.diamonds[i];
      d.position.y = -(0.2 + i * 0.22) * len * 0.55;
      d.scale.setScalar((1 - i * 0.22) * (0.6 + power * 0.5));
      d.scale.y *= 1.6;
      d.material.opacity = (0.5 - i * 0.12) * power;
    }
    this.glow.scale.setScalar((0.5 + power * 0.9) * this.radius * 9 * (0.9 + Math.random() * 0.2));
    this.glow.material.opacity = 0.5 + power * 0.5;
  }
}

export function attachWorld(root, ...objs) {
  for (const o of objs) root.add(o.object || o.mesh || o);
}
