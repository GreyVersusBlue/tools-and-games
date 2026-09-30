// Geometry helpers + detailed pilot figure for the high-fidelity vehicles.
import * as THREE from 'three';
import { seg, pbr, paint, alu, chrome, rubber, cloth, leather, glass, visor, steel, decalTexture } from './materials.js';

const V3 = THREE.Vector3;
const _up = new V3(0, 1, 0);
const _d = new V3();
const _q = new THREE.Quaternion();

export function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export function sph(r, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = mesh(new THREE.SphereGeometry(r, seg(24, 16, 10), seg(16, 12, 8)), material, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
export function cylm(rt, rb, h, material, x, y, z, s = seg(20, 14, 8)) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, s), material, x, y, z);
}
export function boxm(w, h, d, material, x, y, z) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
}
export function capsule(r, len, material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.CapsuleGeometry(r, len, seg(8, 6, 4), seg(16, 12, 8)), material, x, y, z);
}
export function torusm(R, r, material, x, y, z, arc = Math.PI * 2) {
  return mesh(new THREE.TorusGeometry(R, r, seg(12, 8, 6), seg(32, 20, 12), arc), material, x, y, z);
}

// Unit-height cylinder from a to b (scale.y = length). Reusable/updatable "cable" or tube.
const _unitCyl = {};
export function tube(a, b, r, material, radial = seg(12, 8, 6)) {
  if (!_unitCyl[radial]) {
    const g = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
    _unitCyl[radial] = g;
  }
  const m = new THREE.Mesh(_unitCyl[radial], material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.r = r;
  setTube(m, a, b, r);
  return m;
}
export function setTube(m, a, b, r) {
  if (r === undefined) r = m.userData.r;
  m.userData.r = r;
  _d.subVectors(b, a);
  const len = Math.max(1e-4, _d.length());
  m.position.addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  m.quaternion.copy(_q);
  m.scale.set(r, len, r);
}

// Superellipse loft along an axis. secs: [{t, a, b, cx=0, cy=0, n}]; a/b half sizes in the two perpendicular axes.
// axis 'z': (x=cx+a.., y=cy+b.., z=t)   axis 'x': (x=t, y=cy+b.., z=cx+a..)   axis 'y': (x=cx+a.., y=t, z=cy+b..)
export function loft(secs, { axis = 'z', radial = seg(24, 16, 10), n = 2 } = {}) {
  const rows = secs.length;
  const cols = radial + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const idx = [];
  const e = (v, nn) => Math.sign(v) * Math.pow(Math.abs(v), 2 / nn);
  for (let i = 0; i < rows; i++) {
    const s = secs[i];
    const nn = s.n ?? n;
    for (let j = 0; j < cols; j++) {
      const th = (j / radial) * Math.PI * 2;
      const a = s.a * e(Math.cos(th), nn) + (s.cx || 0);
      const b = s.b * e(Math.sin(th), nn) + (s.cy || 0);
      const k = (i * cols + j) * 3;
      if (axis === 'z') { pos[k] = a; pos[k + 1] = b; pos[k + 2] = s.t; }
      else if (axis === 'x') { pos[k] = s.t; pos[k + 1] = b; pos[k + 2] = a; }
      else { pos[k] = a; pos[k + 1] = s.t; pos[k + 2] = b; }
      uv[(i * cols + j) * 2] = j / radial;
      uv[(i * cols + j) * 2 + 1] = i / (rows - 1);
    }
  }
  const flip = axis !== 'z';
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < radial; j++) {
      const A = i * cols + j, B = i * cols + j + 1, C = (i + 1) * cols + j, D = (i + 1) * cols + j + 1;
      if (!flip) idx.push(A, B, C, B, D, C);
      else idx.push(A, C, B, B, C, D);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Small helper: cross-section profile sampler for smooth bodies. pts: [[t, a, b, cx, cy], ...] with Catmull-style resample
export function smoothSecs(pts, count = 24) {
  const ts = pts.map((p) => p[0]);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = ts[0] + ((ts[ts.length - 1] - ts[0]) * i) / (count - 1);
    let k = 0;
    while (k < pts.length - 2 && t > pts[k + 1][0]) k++;
    const u = (t - pts[k][0]) / Math.max(1e-6, pts[k + 1][0] - pts[k][0]);
    const s = u * u * (3 - 2 * u);
    const L = (idx, d = 0) => (pts[k][idx] ?? d) * (1 - s) + (pts[k + 1][idx] ?? d) * s;
    out.push({ t, a: L(1), b: L(2), cx: L(3, 0), cy: L(4, 0) });
  }
  return out;
}

const put = (p, c) => { p.add(c); return c; };

export function finalize(root, shadows = true) {
  root.traverse((o) => {
    if (o.isMesh) {
      const tr = o.material && o.material.transparent;
      o.castShadow = shadows && !tr && !o.userData.noShadow;
      o.receiveShadow = shadows && !o.userData.noShadow;
    }
  });
}

// ---------------------------------------------------------------- pilot
// Standing pilot, feet at y=0, ~1.75 m, facing -Z. Limbs are 2-segment with elbow/knee pivots.
// Returns { group, torso, head, legL, legR, armL, armR, kneeL, kneeR, elbowL, elbowR }
export function createPilot(o = {}) {
  const suitC = o.suit ?? 0x2b6fff;
  const helmC = o.helmet ?? 0xffffff;
  const stripe = o.stripe ?? 0xff3b30;
  const style = o.style || 'goggles'; // 'goggles' | 'full'
  const suitM = cloth(suitC);
  const trimM = cloth(o.trim ?? 0xf4f4f4);
  const skinM = pbr(0xe0a67e, { roughness: 0.6 });
  const gloveM = leather(o.glove ?? 0x1b1b1e);
  const bootM = leather(0x222226);
  const helmM = paint(helmC, { roughness: 0.22 });
  const stripeM = paint(stripe, { roughness: 0.3 });
  const strapM = cloth(0x1a1a1c);
  const group = new THREE.Group();

  // torso (chest + abdomen) and pelvis
  const torso = new THREE.Group();
  torso.position.set(0, 0.92, 0);
  group.add(torso);
  put(torso, capsule(0.17, 0.3, suitM, 0, 0.27, 0)).scale.set(1.28, 1, 0.82);
  torso.add(sph(0.16, suitM, 0, 0.0, 0, 1.15, 0.8, 0.85));
  // chest panel + badge
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), new THREE.MeshStandardMaterial({ map: decalTexture('badge'), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  badge.position.set(0.11, 0.42, -0.135);
  badge.rotation.y = 0.15;
  badge.userData.noShadow = true;
  torso.add(badge);
  // collar/neck
  torso.add(cylm(0.06, 0.07, 0.1, trimM, 0, 0.6, 0, 12));
  // belt + buckle
  const belt = cylm(0.2, 0.2, 0.06, strapM, 0, 0.02, 0, seg(24, 16, 10));
  belt.scale.set(1.25, 1, 0.82);
  torso.add(belt);
  torso.add(boxm(0.06, 0.05, 0.02, chrome(), 0, 0.02, -0.17));
  // shoulder straps (harness)
  for (const s of [-1, 1]) {
    const st = boxm(0.045, 0.5, 0.02, strapM, s * 0.1, 0.32, -0.14);
    st.rotation.z = s * 0.1;
    torso.add(st);
    const back = boxm(0.045, 0.5, 0.02, strapM, s * 0.1, 0.32, 0.14);
    torso.add(back);
  }
  // pelvis thighs cover
  group.add(sph(0.17, suitM, 0, 0.92, 0, 1.2, 0.8, 0.9));

  // head
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  group.add(head);
  head.add(sph(0.09, skinM, 0, -0.02, 0, 0.95, 1.05, 1));
  const shell = sph(0.158, helmM, 0, 0.03, 0.005, 1, 1.03, 1.1);
  head.add(shell);
  // visor / goggles
  if (style === 'full') {
    const vis = mesh(new THREE.SphereGeometry(0.163, 24, 16, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.26, Math.PI * 0.32), visor(0xf0b040), 0, 0.03, 0.005);
    vis.scale.set(1, 1.03, 1.1);
    vis.rotation.y = Math.PI; // faces -Z
    head.add(vis);
  } else {
    // open-face: brow line, goggles with strap
    const strap = torusm(0.156, 0.012, strapM, 0, 0.045, 0.0);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 1.1, 1.05);
    head.add(strap);
    for (const s of [-1, 1]) {
      const rim = torusm(0.036, 0.009, pbr(0x111111, { roughness: 0.4 }), s * 0.052, 0.04, -0.163);
      const lens = mesh(new THREE.CircleGeometry(0.034, 20), visor(0xffa020), s * 0.052, 0.04, -0.165);
      lens.rotation.y = Math.PI;
      lens.material = visor(0xffa020);
      head.add(rim, lens);
    }
    head.add(boxm(0.04, 0.02, 0.018, strapM, 0, 0.04, -0.168));
    // nose + chin
    head.add(sph(0.017, skinM, 0, -0.005, -0.12, 1, 1, 1.3));
    head.add(sph(0.06, skinM, 0, -0.085, -0.075, 1.1, 0.8, 1));
    // chin strap
    const cs = torusm(0.09, 0.006, strapM, 0, -0.06, -0.02);
    cs.rotation.x = Math.PI / 2;
    cs.scale.set(1, 1.2, 1);
    head.add(cs);
  }
  // ear pieces + helmet stripe
  for (const s of [-1, 1]) head.add(sph(0.045, pbr(0x222226, { roughness: 0.5 }), s * 0.147, 0.0, 0.01, 0.55, 1, 1));
  const stripeArc = torusm(0.161, 0.014, stripeM, 0, 0.03, 0.01, Math.PI);
  stripeArc.rotation.set(0, Math.PI / 2, 0);
  stripeArc.scale.set(1.1, 1.03, 1);
  head.add(stripeArc);
  const stripeArc2 = torusm(0.161, 0.008, trimM, 0, 0.03, 0.01, Math.PI);
  stripeArc2.rotation.set(0, Math.PI / 2, 0);
  stripeArc2.position.x = 0.02;
  stripeArc2.scale.set(1.1, 1.03, 1);
  head.add(stripeArc2);

  // limbs
  const mkLeg = (x) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.92, 0);
    hip.add(capsule(0.088, 0.24, suitM, 0, -0.22, 0));
    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    knee.add(sph(0.078, suitM, 0, 0, 0));
    knee.add(capsule(0.072, 0.24, suitM, 0, -0.22, 0));
    put(knee, sph(0.05, trimM, 0, 0.0, -0.06, 1.3, 0.8, 0.5)).position.z = -0.06;
    // boot
    const boot = new THREE.Group();
    boot.position.set(0, -0.44, 0);
    boot.add(capsule(0.066, 0.06, bootM, 0, -0.02, 0));
    const toe = capsule(0.062, 0.1, bootM, 0, -0.07, -0.06);
    toe.rotation.x = Math.PI / 2;
    boot.add(toe);
    boot.add(boxm(0.13, 0.03, 0.27, rubber(0x101012), 0, -0.115, -0.04));
    knee.add(boot);
    hip.add(knee);
    group.add(hip);
    hip.userData.knee = knee;
    return hip;
  };
  const mkArm = (x) => {
    const sh = new THREE.Group();
    sh.position.set(x, 1.46, 0);
    sh.add(sph(0.075, suitM, 0, 0, 0, 1, 1, 1));
    sh.add(capsule(0.06, 0.15, suitM, 0, -0.17, 0));
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    elbow.add(sph(0.055, suitM, 0, 0, 0));
    elbow.add(capsule(0.05, 0.14, suitM, 0, -0.15, 0));
    const cuff = cylm(0.05, 0.055, 0.03, trimM, 0, -0.29, 0, 12);
    elbow.add(cuff);
    const hand = new THREE.Group();
    hand.position.set(0, -0.34, 0);
    hand.add(sph(0.05, gloveM, 0, -0.03, 0, 1, 1.2, 0.9));
    hand.add(sph(0.022, gloveM, 0.03 * Math.sign(x), -0.03, -0.035, 1, 1.5, 1));
    elbow.add(hand);
    sh.add(elbow);
    group.add(sh);
    sh.userData.elbow = elbow;
    sh.userData.hand = hand;
    return sh;
  };
  const legL = mkLeg(-0.1);
  const legR = mkLeg(0.1);
  const armL = mkArm(-0.27);
  const armR = mkArm(0.27);
  finalize(group);
  return {
    group, torso, head, legL, legR, armL, armR,
    kneeL: legL.userData.knee, kneeR: legR.userData.knee, elbowL: armL.userData.elbow, elbowR: armR.userData.elbow,
    handL: armL.userData.hand, handR: armR.userData.hand,
  };
}
