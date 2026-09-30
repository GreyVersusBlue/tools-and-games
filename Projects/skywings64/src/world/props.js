// SkyWings 64 - living props: seagull/bird flocks (GPU flapping), hot air balloons, sailing boats with wakes,
// wooden docks with moored boats, runway/approach/PAPI lights.  Owner: agent S.
// API: createProps(terrain, { seed, lighthouse, runway }) -> { group, update(dt, elapsed), info }
import * as THREE from 'three';
import { loadModel } from '../core/models.js';
import { GeoBuilder, makeRng, LAYOUT } from './terrain.js';
import { shared } from './atmosphere.js';

const stdMat = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.8, metalness: 0 }, o));

// ---------------------------------------------------------------- birds
function birdGeo(gull) {
  // body + two wings as triangles; attribute aWing = distance from body (0..1) drives flapping
  const P = [], W = [], C = [];
  const body = gull ? [0xf6f6f2] : [0x2b2b33], tip = gull ? 0x25252b : 0x1a1a22;
  const tri = (a, b, c, wa, wb, wc, ca, cb, cc) => { P.push(...a, ...b, ...c); W.push(wa, wb, wc); C.push(ca, cb, cc); };
  const B = new THREE.Color(body[0]), T = new THREE.Color(tip), Bel = B.clone().multiplyScalar(0.8);
  // fuselage (diamond)
  const n = [0, 0, -1.0], t = [0, 0, 0.8], l = [-0.16, 0, -0.1], r = [0.16, 0, -0.1], top = [0, 0.14, -0.2], bot = [0, -0.1, -0.2];
  tri(n, top, l, 0, 0, 0, B, B, B); tri(n, r, top, 0, 0, 0, B, B, B); tri(n, l, bot, 0, 0, 0, Bel, Bel, Bel); tri(n, bot, r, 0, 0, 0, Bel, Bel, Bel);
  tri(t, l, top, 0, 0, 0, B, B, B); tri(t, top, r, 0, 0, 0, B, B, B); tri(t, bot, l, 0, 0, 0, Bel, Bel, Bel); tri(t, r, bot, 0, 0, 0, Bel, Bel, Bel);
  for (const s of [-1, 1]) {
    const root0 = [s * 0.12, 0.02, -0.5], root1 = [s * 0.12, 0.02, 0.25], mid0 = [s * 1.1, 0.06, -0.35], mid1 = [s * 1.0, 0.04, 0.2], tp = [s * 2.1, 0.0, 0.0];
    const wing = (a, b, c, wa, wb, wc, ca, cb, cc) => {
      if (s > 0) tri(a, b, c, wa, wb, wc, ca, cb, cc); else tri(a, c, b, wa, wc, wb, ca, cc, cb);
      // underside
      if (s > 0) tri(a, c, b, wa, wc, wb, ca, cc, cb); else tri(a, b, c, wa, wb, wc, ca, cb, cc);
    };
    wing(root0, root1, mid0, 0, 0, 0.5, B, B, B); wing(root1, mid1, mid0, 0, 0.5, 0.5, B, B, B);
    wing(mid0, mid1, tp, 0.5, 0.5, 1, B, B, T);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  const col = []; for (const c of C) col.push(c.r, c.g, c.b);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function birdMat(uTime) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'attribute float aWing; attribute float aPhase; attribute float aFlap; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float fl = sin(uTime * aFlap + aPhase);
      transformed.y += fl * aWing * 0.9 * (0.4 + 0.6 * aFlap / 12.0);
      transformed.y += -abs(transformed.x) * 0.06 * aWing;`);
  };
  return m;
}

// ---------------------------------------------------------------- hot air balloon
function balloon(rng) {
  const pal = [[0xe8302a, 0xfff2d6], [0x2f6fe8, 0xffd23a], [0x2fa84a, 0xfff2d6, 0xffd23a], [0xff8a1f, 0x7a2bd0], [0xe83a8a, 0xffe14a, 0x2fc0e8]];
  const cols = pal[Math.floor(rng() * pal.length)].map((h) => new THREE.Color(h));
  const prof = [[0.30, 0], [0.42, 0.05], [0.66, 0.14], [0.90, 0.28], [1, 0.46], [0.94, 0.64], [0.74, 0.82], [0.4, 0.94], [0.001, 1]];
  const pts = prof.map((p) => new THREE.Vector2(p[0] * 11, p[1] * 27));
  const geo = new THREE.LatheGeometry(pts, 24);
  const pos = geo.attributes.position, colr = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i)), gore = Math.floor(((a / (Math.PI * 2)) + 1) * 12) % cols.length;
    c.copy(cols[gore]).multiplyScalar(0.7 + 0.35 * (pos.getY(i) / 27));
    colr.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  const g = new THREE.Group();
  const env = new THREE.Mesh(geo, stdMat({ roughness: 0.55, side: THREE.DoubleSide }));
  env.position.y = 7; g.add(env);
  const gb = new GeoBuilder();
  gb.box(0, 0.7, 0, 2.6, 1.4, 2.6, 0x9b6a3c); gb.box(0, 1.5, 0, 2.9, 0.15, 2.9, 0x6b4423);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.beam(sx * 1.3, 1.5, sz * 1.3, sx * 4.4, 8.5, sz * 4.4, 0.1, 0x3a2a1a);
  gb.cyl(0, 3.6, 0, 0.35, 0.35, 0.9, 6, 0x666a70);
  g.add(new THREE.Mesh(gb.build(), stdMat()));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa233, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flame.position.y = 5.7; g.add(flame);
  g.userData.flame = flame;
  return g;
}

// ---------------------------------------------------------------- boats
function boatGeo(kind, hull, sail) {
  const gb = new GeoBuilder();
  if (kind === 'sail') {
    gb.box(0, 0.35, 0, 2.8, 1.5, 8.5, hull); gb.box(0, 0.9, -4.6, 1.7, 1.1, 2.3, hull, 0.0);
    gb.box(0, 1.4, 0.5, 1.9, 1.0, 3.2, 0xe6e0d2); gb.box(0, 1.03, 0, 2.5, 0.15, 8.1, 0xb98552);
    gb.cyl(0, 6.4, -0.6, 0.12, 0.16, 11.5, 6, 0xeeeeee);
    gb.prism(0, 1.6, -0.6, 0.25, 9.2, 5, sail, 0); gb.prism(0, 2.2, 2.8, 0.2, 5.8, 3.4, 0xf1efe6, 0);
  } else if (kind === 'motor') {
    gb.box(0, 0.4, 0, 2.6, 1.3, 7, hull); gb.box(0, 1.1, -0.7, 2.0, 1.0, 3.2, 0xf1efe6); gb.box(0, 1.9, -0.9, 1.7, 0.6, 2.4, 0x3c4a5a);
    gb.box(0, 0.75, 3.5, 1.4, 1.4, 1.4, hull, 0.3);
  } else {
    gb.box(0, 0.25, 0, 1.4, 0.7, 4.0, hull); gb.box(0, 0.62, 0, 1.2, 0.08, 3.6, 0xb98552);
    gb.box(0, 0.65, 0.5, 1.15, 0.1, 0.4, 0x6b4423); gb.box(0, 0.65, -0.8, 1.15, 0.1, 0.4, 0x6b4423);
  }
  return gb.build();
}
function wakeTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(30, 0); g.lineTo(34, 0); g.lineTo(62, 256); g.lineTo(2, 256); g.closePath(); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.6)';
  g.beginPath(); g.moveTo(32, 20); g.lineTo(32, 256); g.lineTo(44, 256); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function dock(gb, x, z, H, ang, len = 26) {
  // ang = seaward direction (radians, atan2(dz,dx))
  const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx, y = 1.0;
  const ry = -ang;
  const seg = (u, v, w) => [x + dx * u + px * v, z + dz * u + pz * v];
  for (let u = 0; u < len; u += 2) {
    const [cx, cz] = seg(u + 1, 0);
    gb.box(cx, y, cz, 2.0, 0.22, 3.0, u % 4 ? 0x9a7346 : 0x8c6a3f, ry);
  }
  for (let u = 1; u < len; u += 5) for (const s of [-1, 1]) {
    const [cx, cz] = seg(u, s * 1.45);
    gb.box(cx, y - 1.6, cz, 0.35, 4.2, 0.35, 0x4c3520, ry);
    if (u % 10 === 1) gb.box(cx, y + 0.7, cz, 0.16, 1.2, 0.16, 0x4c3520, ry);
  }
  const [ex, ez] = seg(len, 0);
  gb.box(ex, y, ez, 2.2, 0.22, 7.5, 0x9a7346, ry);
  for (const s of [-1, 1]) { const [cx, cz] = seg(len, s * 3.2); gb.box(cx, y - 1.6, cz, 0.4, 4.2, 0.4, 0x4c3520, ry); }
  // lantern
  const [lx, lz] = seg(len - 0.3, 3.4); gb.cyl(lx, y + 1.6, lz, 0.08, 0.1, 3, 5, 0x333333); gb.box(lx, y + 3.2, lz, 0.5, 0.5, 0.5, 0xffe08a);
  return { end: new THREE.Vector3(ex, 0, ez), side: seg(len - 3, 3.8), ang };
}

export function createProps(terrain, opts = {}) {
  const seed = opts.seed ?? 1337, H = terrain.heightAt;
  const rng = makeRng(seed * 13 + 5);
  const group = new THREE.Group(); group.name = 'props';
  const info = {};
  const updaters = [];
  const uTime = { value: 0 };

  // ------------- birds
  {
    const flocks = [];
    const mk = (gull, n, cx, cz, alt, rad, spd) => flocks.push({ gull, n, cx, cz, alt, rad, spd, ph: rng() * 6.28, seed: rng() * 100 });
    const lh = LAYOUT.lighthouse;
    mk(true, 9, lh.x, lh.z, 70, 90, 0.22); mk(true, 7, lh.x + 40, lh.z - 30, 45, 55, -0.3);
    mk(true, 8, 0, 1100, 40, 220, 0.12); mk(true, 6, -1300, 1250, 60, 180, 0.15); mk(true, 8, 1400, 250, 50, 260, -0.11);
    mk(true, 6, -400, -1100, 55, 200, 0.13); mk(true, 7, 300, 1600, 65, 160, -0.16);
    mk(false, 14, -100, 100, 85, 320, 0.09); mk(false, 12, 550, -300, 100, 260, -0.1); mk(false, 16, -650, 350, 90, 300, 0.08); mk(false, 10, 250, 700, 75, 240, 0.1);
    const total = flocks.reduce((s, f) => s + f.n, 0);
    const mats = { gull: birdMat(uTime), small: birdMat(uTime) };
    const parts = { gull: flocks.filter((f) => f.gull), small: flocks.filter((f) => !f.gull) };
    const meshes = [];
    for (const key of ['gull', 'small']) {
      const list = parts[key], n = list.reduce((s, f) => s + f.n, 0);
      const g = birdGeo(key === 'gull').clone();
      const ph = new Float32Array(n), fl = new Float32Array(n);
      for (let i = 0; i < n; i++) { ph[i] = rng() * 6.28; fl[i] = key === 'gull' ? 5 + rng() * 2 : 9 + rng() * 3; }
      g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1)); g.setAttribute('aFlap', new THREE.InstancedBufferAttribute(fl, 1));
      const im = new THREE.InstancedMesh(g, mats[key], n);
      im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const sc = key === 'gull' ? 1.6 : 0.85;
      group.add(im); meshes.push({ im, list, sc });
    }
    const d = new THREE.Object3D();
    updaters.push((dt, t) => {
      for (const { im, list, sc } of meshes) {
        let k = 0;
        for (const f of list) {
          const a = f.ph + t * f.spd, sgn = Math.sign(f.spd);
          for (let i = 0; i < f.n; i++, k++) {
            const o = i * 2.399 + f.seed, rr = f.rad * (0.8 + 0.4 * Math.sin(o * 1.7)) + Math.sin(t * 0.3 + o) * 12;
            const aa = a + Math.sin(o) * 0.25 + i * 0.03;
            const x = f.cx + Math.cos(aa) * rr, z = f.cz + Math.sin(aa) * rr;
            const y = Math.max(f.alt + Math.sin(t * 0.4 + o * 2) * 8 + Math.sin(aa * 3 + o) * 6, (H(x, z) > 0 ? H(x, z) : 0) + 15);
            // heading = tangent of circle
            const tx = -Math.sin(aa) * sgn, tz = Math.cos(aa) * sgn;
            d.position.set(x, y, z);
            d.rotation.set(0, Math.atan2(-tx, -tz), 0, 'YXZ');
            d.rotation.z = -sgn * 0.35 + Math.sin(t + o) * 0.08;
            d.scale.setScalar(sc * (0.9 + 0.2 * Math.sin(o * 3)));
            d.updateMatrix(); im.setMatrixAt(k, d.matrix);
          }
        }
        im.instanceMatrix.needsUpdate = true;
      }
    });
    info.birds = total;
  }

  // ------------- hot air balloons
  {
    const spots = [[-100, -120, 210], [420, 300, 260], [-620, 120, 300], [900, -250, 230], [-900, 750, 250], [200, -800, 320]];
    const bs = [];
    spots.forEach((s, i) => {
      const b = balloon(rng); b.position.set(s[0], s[2], s[1]); b.scale.setScalar(1.15);
      group.add(b); bs.push({ b, x: s[0], z: s[1], y: s[2], ph: rng() * 6.28, r: 120 + rng() * 140, sp: (0.006 + rng() * 0.006) * (i % 2 ? -1 : 1) });
    });
    updaters.push((dt, t) => {
      for (const o of bs) {
        const a = o.ph + t * o.sp * 6;
        const x = o.x + Math.cos(a) * o.r, z = o.z + Math.sin(a) * o.r;
        o.b.position.set(x, Math.max(o.y + Math.sin(t * 0.25 + o.ph) * 9, H(x, z) + 70), z);
        o.b.rotation.y = t * 0.03 + o.ph; o.b.rotation.z = Math.sin(t * 0.3 + o.ph) * 0.03;
        const f = o.b.userData.flame; f.scale.set(1 + 0.2 * Math.sin(t * 17 + o.ph), 0.8 + 0.5 * Math.abs(Math.sin(t * 3 + o.ph)) * (Math.sin(t * 11) > 0.2 ? 1 : 0.3), 1);
        f.material.opacity = 0.5 + 0.4 * (Math.sin(t * 11 + o.ph) > 0.2 ? 1 : 0.2);
      }
    });
    info.balloons = spots.length;
    // hero GLB (same local frame as balloon()); the animated burner flame stays procedural
    loadModel('balloon').then((proto) => {
      if (!proto) return;
      bs.forEach((o, i) => {
        for (const c of o.b.children) if (c !== o.b.userData.flame) { c.visible = false; c.userData.swProcedural = true; }
        const m = i === 0 ? proto : proto.clone(true);
        m.name = 'glb:balloon'; o.b.add(m);
      });
    }).catch(() => {});
  }

  // ------------- boats + docks
  {
    const wakeTex = wakeTexture();
    const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0.8, fog: true });
    const wakeGeo = new THREE.PlaneGeometry(7, 26).rotateX(-Math.PI / 2).translate(0, 0.12, 13.5);
    const hulls = [0xf4f4f0, 0xd7362b, 0x2f5fc8, 0xf2c94c, 0x2fa84a], boats = [];
    const boatMat = stdMat({ roughness: 0.55 });
    let n = 0;
    for (let a = 0; a < 4000 && n < 12; a++) {
      const x = (rng() - 0.5) * 3600, z = (rng() - 0.5) * 3600, h = H(x, z);
      if (h > -8 || h < -18) continue;
      const kind = n < 7 ? 'sail' : n < 10 ? 'motor' : 'row';
      const m = new THREE.Mesh(boatGeo(kind, hulls[n % 5], n % 2 ? 0xffffff : 0xffd8a8), boatMat);
      const body = new THREE.Group(); body.add(m);           // rocks; holds procedural hull and (later) the GLB
      const holder = new THREE.Group(); holder.add(body); holder.position.set(x, 0, z); group.add(holder);
      const w = new THREE.Mesh(wakeGeo, wakeMat); if (kind !== 'row') holder.add(w); w.scale.set(kind === 'motor' ? 1.3 : 1, 1, kind === 'motor' ? 1.4 : 1);
      boats.push({ h: holder, m: body, hull: m, ry: rng() * 6.28, sp: kind === 'sail' ? 2.2 + rng() * 1.2 : kind === 'motor' ? 6 + rng() * 3 : 0.4, ph: rng() * 6.28, kind, turn: 0 });
      n++;
    }
    updaters.push((dt, t) => {
      for (const b of boats) {
        const p = b.h.position, fx = Math.sin(b.ry), fz = -Math.cos(b.ry);   // boat forward = -Z
        const nx = p.x + fx * b.sp * dt, nz = p.z + fz * b.sp * dt;
        if (H(nx + fx * 120, nz + fz * 120) > -5 || Math.abs(nx) > 1950 || Math.abs(nz) > 1950) b.ry += dt * 0.5;
        else { p.x = nx; p.z = nz; b.ry += Math.sin(t * 0.1 + b.ph) * dt * 0.02; }
        b.h.rotation.y = -b.ry;
        p.y = Math.sin(t * 1.3 + b.ph) * 0.18;
        b.m.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.045 + (b.kind === 'sail' ? 0.06 : 0);
        b.m.rotation.x = Math.sin(t * 1.1 + b.ph * 2) * 0.02;
      }
    });
    info.boats = boats.length;
    for (const kind of ['sail', 'motor']) {
      loadModel(kind === 'sail' ? 'boat_sail' : 'boat_motor').then((proto) => {
        if (!proto) return;
        let first = true;
        for (const b of boats) {
          if (b.kind !== kind) continue;
          b.hull.visible = false; b.hull.userData.swProcedural = true;
          const m = first ? proto : proto.clone(true); first = false;
          m.name = 'glb:boat_' + kind; b.m.add(m);
        }
      }).catch(() => {});
    }

    // docks on the shoreline
    const gb = new GeoBuilder(), docks = [];
    for (let a = 0; a < 20000 && docks.length < 6; a++) {
      const x = (rng() - 0.5) * 3600, z = (rng() - 0.5) * 3600, h = H(x, z);
      if (Math.abs(h - 0.8) > 0.5) continue;
      const e = 6, gx = (H(x + e, z) - H(x - e, z)) / (2 * e), gz = (H(x, z + e) - H(x, z - e)) / (2 * e), gl = Math.hypot(gx, gz);
      if (gl < 0.02 || gl > 0.25) continue;
      const ang = Math.atan2(-gz, -gx);
      if (H(x + Math.cos(ang) * 30, z + Math.sin(ang) * 30) > -1.0) continue;
      if (terrain.isBlocked && terrain.isBlocked(x, z, 6)) continue;
      if (docks.some((d) => Math.hypot(d.x - x, d.z - z) < 500)) continue;
      const info2 = dock(gb, x - Math.cos(ang) * 4, z - Math.sin(ang) * 4, H, ang);
      docks.push({ x, z, ang });
      const bo = new THREE.Mesh(boatGeo(docks.length % 2 ? 'row' : 'motor', hulls[docks.length % 5], 0xffffff), boatMat);
      bo.position.set(info2.side[0], 0, info2.side[1]); bo.rotation.y = -ang - Math.PI / 2;
      group.add(bo);
      updaters.push((dt, t) => { bo.position.y = Math.sin(t * 1.2 + docks.length) * 0.1; bo.rotation.z = Math.sin(t * 0.9 + docks.length * 2) * 0.03; });
    }
    if (docks.length) group.add(new THREE.Mesh(gb.build(), stdMat()));
    info.docks = docks;
  }

  // ------------- runway lights (edge / threshold / approach strobes / PAPI)
  {
    const R = LAYOUT.runway, Y = (x, z) => Math.max(H(x, z), 0) + 0.35;
    const pts = [], colors = [];
    const P = (x, z, c) => { pts.push([x, Y(x, z), z]); colors.push(new THREE.Color(c)); };
    const hw = R.width / 2 + 0.6;
    for (let x = R.ax; x <= R.bx; x += 20) { P(x, R.az - hw, 0xffffff); P(x, R.az + hw, 0xffffff); }
    for (let z = -hw; z <= hw; z += 2.4) { P(R.ax + 0.6, R.az + z, 0x33ff66); P(R.bx - 0.6, R.az + z, 0xff3322); }
    const appStart = pts.length;
    for (let i = 1; i <= 12; i++) P(R.ax - i * 26, R.az, 0xffffff);
    const nApp = pts.length - appStart;
    for (let i = 0; i < 4; i++) { P(R.ax + 40, R.az + hw + 10 + i * 4.5, i < 2 ? 0xff3322 : 0xffffff); P(R.ax + 40, R.az - hw - 10 - i * 4.5, i < 2 ? 0xff3322 : 0xffffff); }
    const geo = new THREE.SphereGeometry(0.45, 6, 4);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const d = new THREE.Object3D(); const base = colors.map((c) => c.clone());
    pts.forEach((p, i) => { d.position.set(p[0], p[1], p[2]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, colors[i]); });
    im.frustumCulled = false;
    group.add(im);
    const tmp = new THREE.Color();
    updaters.push((dt, t) => {
      const night = shared.night, k = 0.7 + 1.6 * Math.max(night, shared.dusk * 0.7);
      for (let i = 0; i < pts.length; i++) {
        let s = k;
        if (i >= appStart && i < appStart + nApp) { const j = i - appStart, ph = (t * 2.0) % 1.0; s *= (1 - j / 12 - ph + 1) % 1 < 0.12 ? 3 : 0.5; }
        im.setColorAt(i, tmp.copy(base[i]).multiplyScalar(s));
      }
      im.instanceColor.needsUpdate = true;
    });
    info.runwayLights = pts.length;
  }

  return { group, info, update(dt, t) { uTime.value = t; for (let i = 0; i < updaters.length; i++) updaters[i](dt, t); } };
}
