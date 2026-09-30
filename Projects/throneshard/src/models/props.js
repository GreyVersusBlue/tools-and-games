import * as THREE from 'three';
import { M, mat, glowTexture } from './materials.js';

// Procedural props attached to character bones. All built in FINAL world units; the factory compensates for the
// bone's world scale. Weapons extend along local +Y (KayKit handslot convention), grip at the origin.

const G = {}; // shared geometry cache
const geo = (key, make) => (G[key] ??= make());

export function part(geometry, material, pos = [0, 0, 0], euler = [0, 0, 0], scale) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  m.rotation.set(...euler);
  if (scale !== undefined) Array.isArray(scale) ? m.scale.set(...scale) : m.scale.setScalar(scale);
  m.castShadow = true;
  return m;
}
const group = (...kids) => { const g = new THREE.Group(); kids.forEach((k) => k && g.add(k)); return g; };

const cyl = (rt, rb, h, seg = 8) => geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (x, y, z) => geo(`box${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
const sph = (r, w = 12, h = 8) => geo(`sph${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const cone = (r, h, seg = 8) => geo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const oct = (r, d = 0) => geo(`oct${r},${d}`, () => new THREE.OctahedronGeometry(r, d));
const ico = (r, d = 0) => geo(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
const torus = (r, t, arc = Math.PI * 2, rs = 6, ts = 16) => geo(`tor${r},${t},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));

// Extruded flat blade shape (hatchet heads, cleavers)
function extruded(key, pts, depth, bevel = 0.01) {
  return geo(key, () => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

// ---------------- weapons ----------------
export function bigHatchet() {
  const handle = part(cyl(0.035, 0.04, 1.7), M.wood(0x7a4a2a), [0, 0.45, 0]);
  const wrap = part(cyl(0.045, 0.045, 0.3), M.cloth(0x3a1a10), [0, -0.1, 0]);
  const bladeGeo = extruded('hatchetBlade', [[0, -0.18], [0.12, -0.2], [0.5, -0.42], [0.62, -0.1], [0.62, 0.1], [0.5, 0.42], [0.12, 0.2], [0, 0.18]], 0.05, 0.015);
  const b1 = part(bladeGeo, M.metal(0xa02020, 0.4), [0.03, 1.1, 0]);
  const b2 = part(bladeGeo, M.metal(0xa02020, 0.4), [-0.03, 1.1, 0], [0, Math.PI, 0], [0.75, 0.8, 1]);
  const edge = part(box(0.03, 0.8, 0.07), M.glow(0xff3a1a, 1.5), [0.64, 1.1, 0]);
  const spike = part(cone(0.05, 0.3), M.metal(0x333333), [0, 1.43, 0]);
  return group(handle, wrap, b1, b2, edge, spike);
}

export function katana() {
  const blade = part(box(0.05, 1.05, 0.012), M.metal(0xe8eef5, 0.15), [0, 0.72, 0]);
  const edge = part(box(0.012, 1.05, 0.014), M.glow(0xffc070, 0.6), [0.028, 0.72, 0]);
  const tip = part(cone(0.035, 0.12, 4), M.metal(0xe8eef5, 0.15), [0, 1.3, 0], [0, Math.PI / 4, 0], [1, 1, 0.3]);
  const guard = part(cyl(0.08, 0.08, 0.025, 10), M.metal(0xc9a040, 0.3), [0, 0.18, 0]);
  const hilt = part(cyl(0.028, 0.028, 0.3), M.cloth(0x2a2a60), [0, 0.02, 0]);
  return group(blade, edge, tip, guard, hilt);
}

export function greatsword() {
  const blade = part(box(0.2, 1.6, 0.04), M.metal(0xc8d0dc, 0.2), [0, 1.05, 0]);
  const fuller = part(box(0.05, 1.3, 0.05), M.metal(0x6a7a90, 0.3), [0, 1.0, 0]);
  const tip = part(cone(0.14, 0.3, 4), M.metal(0xc8d0dc, 0.2), [0, 2.0, 0], [0, Math.PI / 4, 0], [1, 1, 0.2]);
  const guard = part(box(0.62, 0.08, 0.1), M.metal(0x8a6a30, 0.3), [0, 0.24, 0]);
  const gem = part(oct(0.06), M.glow(0x4aa0ff, 2), [0, 0.24, 0.06]);
  const hilt = part(cyl(0.035, 0.035, 0.45), M.cloth(0x222244), [0, 0.0, 0]);
  const pommel = part(sph(0.06), M.metal(0x8a6a30), [0, -0.24, 0]);
  return group(blade, fuller, tip, guard, gem, hilt, pommel);
}

export function rifle() {
  // Long barrel along +Y; stock behind the grip.
  const barrel = part(cyl(0.025, 0.03, 1.5, 8), M.metal(0x303030, 0.4), [0, 0.8, 0.05]);
  const muzzle = part(cyl(0.045, 0.04, 0.12, 8), M.metal(0x8a6a30, 0.3), [0, 1.55, 0.05]);
  const body = part(box(0.08, 0.6, 0.12), M.wood(0x8a5a30), [0, 0.2, 0]);
  const stock = part(box(0.07, 0.35, 0.18), M.wood(0x6a4020), [0, -0.2, -0.03], [0.2, 0, 0]);
  const scope = part(cyl(0.035, 0.035, 0.35, 8), M.metal(0x222222, 0.3), [0, 0.45, 0.14]);
  const lens = part(cyl(0.03, 0.03, 0.01, 8), M.glow(0x66ccff, 2), [0, 0.63, 0.14]);
  return group(barrel, muzzle, body, stock, scope, lens);
}

export function hook() {
  const g = new THREE.Group();
  // chain links
  for (let i = 0; i < 6; i++) g.add(part(torus(0.04, 0.012, Math.PI * 2, 4, 8), M.metal(0x777777), [0, 0.05 + i * 0.07, 0], [0, i % 2 ? Math.PI / 2 : 0, 0]));
  g.add(part(cyl(0.03, 0.03, 0.3), M.metal(0x555555), [0, 0.55, 0]));
  g.add(part(torus(0.18, 0.035, Math.PI * 1.3, 6, 14), M.metal(0x9a9a9a, 0.3), [0.18, 0.75, 0], [0, 0, -Math.PI * 0.35]));
  g.add(part(cone(0.05, 0.16, 6), M.metal(0xbbbbbb, 0.3), [0.33, 0.95, 0], [0, 0, -0.5]));
  g.add(part(box(0.06, 0.1, 0.06), M.flat(0x6a0a0a), [0.34, 0.82, 0])); // gore
  return g;
}

export function cleaver() {
  const blade = part(extruded('cleaver', [[0, 0], [0.28, 0], [0.3, 0.45], [0, 0.5]], 0.03, 0.01), M.metal(0x8a8a86, 0.45), [-0.02, 0.18, 0]);
  const blood = part(box(0.2, 0.15, 0.045), M.flat(0x5a0808, 0.4), [0.12, 0.45, 0]);
  const handle = part(cyl(0.03, 0.03, 0.28), M.wood(0x4a2a15), [0, 0.02, 0]);
  return group(blade, blood, handle);
}

export function bow() {
  const g = new THREE.Group();
  const limb = part(torus(0.62, 0.028, Math.PI * 0.8, 6, 18), M.wood(0x5a4a6a), [-0.35, 0, 0], [0, 0, -Math.PI * 0.4]);
  g.add(limb);
  const tipTop = new THREE.Vector3(-0.35 + 0.62 * Math.cos(Math.PI * 0.4), 0.62 * Math.sin(Math.PI * 0.4), 0);
  g.add(part(box(0.005, tipTop.y * 2, 0.005), M.glow(0xbfe8ff, 1.5), [tipTop.x, 0, 0]));
  g.add(part(cyl(0.035, 0.035, 0.2), M.cloth(0x333355), [0.27, 0, 0]));
  g.add(part(oct(0.05), M.glow(0x9fdcff, 2), [0.3, 0.18, 0]));
  return g;
}

export function quiver() {
  const g = group(part(cyl(0.1, 0.08, 0.6, 8), M.cloth(0x3a3050), [0, 0, 0]));
  for (let i = 0; i < 5; i++) g.add(part(cyl(0.008, 0.008, 0.3, 4), M.flat(0xdddddd), [(i - 2) * 0.03, 0.4, (i % 2) * 0.03]));
  for (let i = 0; i < 5; i++) g.add(part(box(0.04, 0.08, 0.005), M.glow(0x9fdcff, 1.2), [(i - 2) * 0.03, 0.55, (i % 2) * 0.03]));
  return g;
}

export function iceStaff() {
  const shaft = part(cyl(0.025, 0.03, 1.7), M.wood(0xd8e8ff), [0, 0.4, 0]);
  const crystal = part(oct(0.14, 0), M.glow(0x7fd4ff, 2.2), [0, 1.35, 0], [0, 0, 0], [0.8, 1.6, 0.8]);
  crystal.name = 'spin';
  const prongs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    prongs.add(part(cone(0.03, 0.35, 4), M.metal(0xbfe0ff, 0.2), [Math.cos(a) * 0.12, 1.25, Math.sin(a) * 0.12], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]));
  }
  const halo = new THREE.Sprite(M.sprite(0x66ccff, 0.8)); halo.position.set(0, 1.35, 0); halo.scale.setScalar(0.7);
  return group(shaft, crystal, prongs, halo);
}

export function fireWand() {
  const shaft = part(cyl(0.02, 0.025, 0.7), M.wood(0x5a2a10), [0, 0.2, 0]);
  const orb = part(sph(0.08), M.glow(0xffa020, 3), [0, 0.6, 0]);
  const halo = new THREE.Sprite(M.sprite(0xff6010, 0.9)); halo.position.set(0, 0.6, 0); halo.scale.setScalar(0.6);
  return group(shaft, orb, halo);
}

export function dagger() {
  const blade = part(cone(0.05, 0.55, 4), M.metal(0xcfd6e0, 0.15), [0, 0.38, 0], [0, Math.PI / 4, 0], [1, 1, 0.25]);
  const glow = part(box(0.01, 0.4, 0.02), M.glow(0xb070ff, 1.6), [0, 0.35, 0]);
  const guard = part(box(0.18, 0.03, 0.05), M.metal(0x4a2a6a), [0, 0.1, 0]);
  const hilt = part(cyl(0.022, 0.022, 0.18), M.cloth(0x201030), [0, 0.0, 0]);
  return group(blade, glow, guard, hilt);
}

export function vashkarStaff() {
  const shaft = part(cyl(0.025, 0.03, 1.6), M.bark(0x4a2020), [0, 0.35, 0]);
  const g = group(shaft);
  // claw hand on top
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(part(cone(0.03, 0.3, 5), M.flat(0x2a0a0a), [Math.cos(a) * 0.08, 1.3, Math.sin(a) * 0.08], [Math.sin(a) * -0.5, 0, Math.cos(a) * 0.5]));
  }
  const orb = part(ico(0.09, 1), M.glow(0xff2a1a, 2.5), [0, 1.3, 0]);
  orb.name = 'pulse';
  const halo = new THREE.Sprite(M.sprite(0xff2010, 0.8)); halo.position.set(0, 1.3, 0); halo.scale.setScalar(0.55);
  g.add(orb, halo);
  return g;
}

export function lightningOrb() {
  const orb = part(ico(0.1, 1), M.glow(0x9fd8ff, 3.5), [0, 0.12, 0]);
  orb.name = 'pulse';
  const halo = new THREE.Sprite(M.sprite(0x66b8ff, 1)); halo.position.set(0, 0.12, 0); halo.scale.setScalar(0.7);
  return group(orb, halo);
}

export function spear() {
  const shaft = part(cyl(0.02, 0.02, 1.2), M.wood(0x6a4a2a), [0, 0.3, 0]);
  const tip = part(cone(0.05, 0.22, 4), M.metal(0x9a9a9a), [0, 1.0, 0]);
  return group(shaft, tip);
}

export function club() {
  const g = group(part(cyl(0.12, 0.05, 1.0, 7), M.bark(0x8a6040), [0, 0.45, 0]));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    g.add(part(cone(0.035, 0.12, 4), M.metal(0x777777), [Math.cos(a) * 0.1, 0.65 + i * 0.06, Math.sin(a) * 0.1], [Math.sin(a) * 1.5, 0, -Math.cos(a) * 1.5]));
  }
  return g;
}

// ---------------- head / body dressings ----------------
export function juggMask() {
  const g = new THREE.Group();
  g.add(part(sph(0.26, 14, 10), M.flat(0xf0e6d0, 0.5), [0, 0.02, 0.08], [0, 0, 0], [1, 1.15, 0.8]));
  // eye slits + painted stripes
  g.add(part(box(0.14, 0.03, 0.05), M.flat(0x111111), [0.08, 0.06, 0.28], [0, 0, 0.15]));
  g.add(part(box(0.14, 0.03, 0.05), M.flat(0x111111), [-0.08, 0.06, 0.28], [0, 0, -0.15]));
  g.add(part(box(0.04, 0.3, 0.04), M.flat(0xd04010), [0, 0.0, 0.29]));
  g.add(part(box(0.3, 0.035, 0.04), M.flat(0xd04010), [0, -0.12, 0.27]));
  // tall plume / mohawk
  for (let i = 0; i < 6; i++) g.add(part(cone(0.06, 0.34, 5), M.flat(0xe07a20), [0, 0.3 + i * 0.01, 0.1 - i * 0.07], [-0.4 - i * 0.12, 0, 0]));
  return g;
}

export function fireHair() {
  const g = new THREE.Group();
  g.name = 'flicker';
  const cols = [0xff5a10, 0xff8a20, 0xffc040];
  // flames sprouting from the upper/back hemisphere of the head (radius ~0.42), pointing outward and up
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 * 3.1;
    const el = 0.25 + (i / 22) * 1.1; // elevation from horizontal
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    if (dir.z > 0.35) dir.z = 0.35 - dir.z; // keep the face clear
    dir.normalize();
    const h = 0.28 + ((i * 7) % 5) * 0.06;
    const c = part(cone(0.1, h, 6), M.glow(cols[i % 3], 2.2));
    c.quaternion.setFromUnitVectors(up, dir.clone().add(new THREE.Vector3(0, 0.8, -0.4)).normalize());
    c.position.copy(dir).multiplyScalar(0.36).add(new THREE.Vector3(0, 0, -0.03));
    c.position.addScaledVector(dir, h * 0.35);
    g.add(c);
  }
  const halo = new THREE.Sprite(M.sprite(0xff6010, 0.7)); halo.position.set(0, 0.4, 0); halo.scale.setScalar(0.9);
  g.add(halo);
  return g;
}

export function horns(color = 0x2a0a0a, size = 1) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const h = new THREE.Group();
    h.add(part(cone(0.07 * size, 0.28 * size, 6), M.flat(color, 0.5), [0, 0.12 * size, 0]));
    h.add(part(cone(0.045 * size, 0.24 * size, 6), M.flat(color, 0.5), [0.04 * size * s, 0.34 * size, -0.05 * size], [-0.5, 0, -0.5 * s]));
    h.position.set(0.17 * s * size, 0.2 * size, 0);
    h.rotation.set(-0.3, 0, -0.6 * s);
    g.add(h);
  }
  return g;
}

export function beard() {
  const g = new THREE.Group();
  g.add(part(cone(0.2, 0.5, 8), M.flat(0xf4f4f4, 0.9), [0, -0.2, 0.18], [Math.PI - 0.25, 0, 0]));
  g.add(part(sph(0.17, 10, 8), M.flat(0xf4f4f4, 0.9), [0, 0.02, 0.2], [0, 0, 0], [1.2, 0.6, 0.6]));
  return g;
}

export function lightningCrown() {
  const g = new THREE.Group();
  g.name = 'flicker';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(part(cone(0.03, 0.2, 4), M.glow(0x9fdcff, 3), [Math.cos(a) * 0.24, 0.32, Math.sin(a) * 0.24], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]));
  }
  g.add(part(torus(0.24, 0.015, Math.PI * 2, 4, 20), M.glow(0x9fdcff, 3), [0, 0.25, 0], [Math.PI / 2, 0, 0]));
  return g;
}

export function iceCrown() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(part(oct(0.06), M.glow(0x80d8ff, 1.8), [Math.cos(a) * 0.2, 0.36, Math.sin(a) * 0.2], [0, a, 0], [0.6, 2.2, 0.6]));
  }
  return g;
}

export function veil() {
  const g = new THREE.Group();
  g.add(part(cone(0.34, 0.6, 10, 1), mat('paveil', { color: 0x5a3a8a, roughness: 0.8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), [0, 0.02, 0.02]));
  g.add(part(box(0.3, 0.05, 0.02), M.glow(0xc080ff, 1.2), [0, 0.07, 0.31]));
  return g;
}

export function shoulderCrystals(color = 0x80d8ff) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.add(part(oct(0.05), M.glow(color, 1.4), [0.28 * s + i * 0.03 * s, 0.1 + i * 0.05, -0.02], [0.2 * i, 0, 0.4 * s], [0.6, 2, 0.6]));
  return g;
}

export function leafCrown() {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(part(ico(0.13, 0), M.flat(i % 2 ? 0x4a8a2a : 0x2e6a1c, 0.9), [Math.cos(a) * 0.2, 0.3 + (i % 3) * 0.05, Math.sin(a) * 0.2]));
  }
  g.add(part(cone(0.04, 0.4, 5), M.bark(0x7a5a3a), [0.12, 0.45, 0], [0, 0, -0.4]));
  g.add(part(cone(0.04, 0.4, 5), M.bark(0x7a5a3a), [-0.12, 0.45, 0], [0, 0, 0.4]));
  return g;
}

export function rockPauldrons(color = 0x6a6a60, glow = 0x40ffd0) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(part(ico(0.3, 0), M.rock(color), [0.55 * s, 0.2, 0], [s, 0.5, 0]));
    g.add(part(ico(0.18, 0), M.rock(color), [0.35 * s, 0.4, -0.1], [0, s, 0.3]));
  }
  g.add(part(oct(0.12), M.glow(glow, 2), [0, 0.1, 0.35], [0, 0, 0], [1, 1.4, 0.5]));
  return g;
}

export function backSpikes(color = 0x3a2a2a, n = 5, size = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) g.add(part(cone(0.1 * size, 0.5 * size, 5), M.flat(color, 0.6), [0, 0.1 + i * 0.12 * size, -0.25 * size], [-1.2, 0, 0]));
  return g;
}

export function orbitingOrbs(color = 0x80d8ff, n = 3, radius = 0.8, y = 1.6) {
  const g = new THREE.Group();
  g.name = 'orbit';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const o = part(ico(0.1, 1), M.glow(color, 2.5), [Math.cos(a) * radius, y, Math.sin(a) * radius]);
    const s = new THREE.Sprite(M.sprite(color, 0.7)); s.scale.setScalar(0.5); s.position.copy(o.position);
    g.add(o, s);
  }
  return g;
}

export function footAura(color, radius = 0.9, opacity = 0.35) {
  const g = new THREE.Group();
  g.name = 'aura';
  const m = new THREE.Mesh(geo('auraDisc', () => new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2)), mat('aura' + color + opacity, { map: glowTexture(), color, opacity, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }, 'additive'));
  m.scale.setScalar(radius);
  m.position.y = 0.04;
  m.renderOrder = 2;
  const spr = new THREE.Sprite(M.sprite(color, opacity * 1.2));
  spr.scale.set(radius * 2.2, radius * 2.2, 1);
  spr.position.y = 0.6;
  g.add(m, spr);
  return g;
}

export function belly() {
  const g = new THREE.Group();
  g.add(part(sph(0.5, 16, 12), M.flat(0x8a9a78, 0.8), [0, -0.15, 0.22], [0, 0, 0], [1.05, 0.9, 0.85]));
  // stitches
  for (let i = 0; i < 5; i++) g.add(part(box(0.18, 0.025, 0.03), M.flat(0x2a1a14), [0, -0.4 + i * 0.12, 0.66 - Math.abs(i - 2) * 0.03], [0.2, 0, 0.3]));
  g.add(part(box(0.03, 0.55, 0.03), M.flat(0x3a1a14), [0, -0.15, 0.66]));
  return g;
}

export function shortSword() {
  const blade = part(box(0.08, 0.6, 0.02), M.metal(0x8a7a70, 0.5), [0, 0.42, 0]);
  const tip = part(cone(0.057, 0.12, 4), M.metal(0x8a7a70, 0.5), [0, 0.78, 0], [0, Math.PI / 4, 0], [1, 1, 0.3]);
  const guard = part(box(0.22, 0.04, 0.05), M.metal(0x3a2020), [0, 0.11, 0]);
  const hilt = part(cyl(0.022, 0.022, 0.2), M.cloth(0x2a1010), [0, 0.0, 0]);
  return group(blade, tip, guard, hilt);
}

export function courierBags() {
  const g = new THREE.Group();
  g.add(part(box(0.36, 0.06, 0.5), M.cloth(0xb0302a), [0, 0.98, -0.1]));
  for (const s of [-1, 1]) g.add(part(box(0.1, 0.22, 0.26), M.wood(0xa07040), [0.2 * s, 0.86, -0.1]));
  g.add(part(sph(0.06), M.glow(0xffd040, 2), [0, 1.06, -0.1]));
  return g;
}

// Beast / golem heads replacing the robot's visor head (Grimmaw, golems). Faces +Z, built around the neck at origin.
export function beastHead({ skin = 0x5a3a2a, bone = 0xe8dcc0, eye = 0xffa020, size = 1, hornSize = 1.6, rocky = false } = {}) {
  const g = new THREE.Group();
  const skinM = rocky ? M.rock(skin) : M.flat(skin, 0.75);
  const boneM = M.flat(bone, 0.5);
  const s = size;
  g.add(part(rocky ? ico(0.5 * s, 0) : sph(0.5 * s, 14, 10), skinM, [0, 0.35 * s, 0], [0, 0, 0], [1.1, 0.85, 1.05]));
  // brow ridge
  g.add(part(box(0.8 * s, 0.14 * s, 0.25 * s), skinM, [0, 0.52 * s, 0.38 * s], [0.3, 0, 0]));
  // snout
  g.add(part(rocky ? ico(0.3 * s, 0) : box(0.55 * s, 0.32 * s, 0.45 * s), skinM, [0, 0.25 * s, 0.55 * s], [0.1, 0, 0]));
  // lower jaw
  g.add(part(box(0.6 * s, 0.14 * s, 0.5 * s), skinM, [0, 0.05 * s, 0.45 * s], [0.15, 0, 0]));
  // tusks + teeth
  for (const sx of [-1, 1]) {
    g.add(part(cone(0.06 * s, 0.34 * s, 6), boneM, [0.24 * sx * s, 0.2 * s, 0.68 * s], [-0.3, 0, -0.25 * sx]));
    g.add(part(sph(0.07 * s, 8, 6), M.glow(eye, 3), [0.2 * sx * s, 0.44 * s, 0.52 * s]));
  }
  for (let i = 0; i < 4; i++) g.add(part(cone(0.03 * s, 0.08 * s, 4), boneM, [(-0.15 + i * 0.1) * s, 0.13 * s, 0.76 * s], [Math.PI, 0, 0]));
  const eyeGlow = new THREE.Sprite(M.sprite(eye, 0.5)); eyeGlow.scale.setScalar(0.7 * s); eyeGlow.position.set(0, 0.44 * s, 0.6 * s);
  g.add(eyeGlow);
  if (hornSize) {
    const h = horns(bone, hornSize * s);
    h.position.set(0, 0.35 * s, -0.05 * s);
    g.add(h);
  }
  return g;
}
