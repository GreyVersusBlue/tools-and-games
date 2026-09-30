// Static decorations: gate obelisks, torches (with pooled flickering lights), banners, ruins, crystals,
// obsidian spikes, lava pools, Grimmaw's lair ring, fireflies & embers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { THRONESHARD, FOUNTAIN, SHOPS, GRIMMAW_LAIR, TEAM_COLORS } from '../core/constants.js';
import { ramps, laneDist, reservedDist, riverDist, laneSegs, plateauSDF } from './layout.js';
import { mulberry32, smoothstep } from './noise.js';
import { injectFow, patchMaterial, worldUniforms } from './shaderUtils.js';
import { loadTexture, makeGlowSprite } from './Textures.js';
import { rockGeo } from './Foliage.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

function norm(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}

export class Props {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.parts = new Map(); // matKey -> geometries
    this.torches = []; // {pos: Vector3, color, sprite, phase}
    this.lights = [];
    this.animated = [];
    this.rnd = mulberry32(4242);
  }

  add(key, geo, pos, rotY = 0, scale = 1, tilt = null) {
    const g = norm(geo.clone());
    _e.set(tilt?.x ?? 0, rotY, tilt?.z ?? 0);
    _q.setFromEuler(_e);
    _m.compose(_p.copy(pos), _q, typeof scale === 'number' ? _s.setScalar(scale) : _s.copy(scale));
    g.applyMatrix4(_m);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
  }

  ground(x, z) { return this.world.getHeight(x, z); }
  free(x, z, r = 1, laneClear = 4.5) {
    return reservedDist(x, z) > r && laneDist(x, z) > laneClear + r && riverDist(x, z) > 8 && Math.max(Math.abs(x), Math.abs(z)) < 97;
  }

  build() {
    const rock = loadTexture('tex/Rock030_c.jpg');
    const rockN = loadTexture('tex/Rock030_n.jpg', { srgb: false });
    const pave = loadTexture('tex/PavingStones070_c.jpg');
    const mk = (key, params) => {
      const m = new THREE.MeshStandardMaterial(params);
      patchMaterial(m, 'prop-' + key, (sh) => injectFow(sh));
      return m;
    };
    this.mats = {
      stoneLight: mk('stoneLight', { map: rock, normalMap: rockN, color: 0xe6ddcc, roughness: 0.8 }),
      stoneDark: mk('stoneDark', { map: rock, normalMap: rockN, color: 0x5a4846, roughness: 0.75 }),
      marble: mk('marble', { map: pave, color: 0xf2ece0, roughness: 0.55 }),
      wood: mk('wood', { color: 0x5a3b22, roughness: 0.85 }),
      iron: mk('iron', { color: 0x2c2a2a, roughness: 0.45, metalness: 0.8 }),
      gold: mk('gold', { color: 0xd4a840, roughness: 0.3, metalness: 1.0 }),
      crystalRad: mk('crystalRad', { color: 0x9ffff0, emissive: 0x20e0b0, emissiveIntensity: 1.3, roughness: 0.15, metalness: 0.1 }),
      crystalDuskward: mk('crystalDuskward', { color: 0xff6040, emissive: 0xff2208, emissiveIntensity: 1.6, roughness: 0.2 }),
      obsidian: mk('obsidian', { color: 0x16100f, roughness: 0.25, metalness: 0.3 }),
      rockMat: mk('rock', { map: rock, normalMap: rockN, color: 0xb0a8a0, roughness: 0.9 }),
      bone: mk('bone', { color: 0xd8ccb0, roughness: 0.7 }),
    };
    this.glowTex = makeGlowSprite();

    this.buildGates();
    this.buildBaseTorches();
    this.buildBanners();
    this.buildCrystals();
    this.buildRuins();
    this.buildGrimmawLair();
    this.buildLavaPools();

    for (const [key, list] of this.parts) {
      const geo = mergeGeometries(list);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.mats[key]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'props-' + key;
      this.group.add(mesh);
    }
    this.buildFlames();
    this.buildParticles();
  }

  // ---------- pieces ----------
  obelisk(team, x, z, rotY) {
    const y = this.ground(x, z);
    const duskward = team === 'duskward';
    const mat = duskward ? 'stoneDark' : 'stoneLight';
    const base = new THREE.BoxGeometry(2.0, 0.8, 2.0); base.translate(0, 0.4, 0);
    this.add(mat, base, new THREE.Vector3(x, y, z), rotY);
    const shaft = new THREE.CylinderGeometry(0.55, 0.8, 5.5, 4, 1); shaft.rotateY(Math.PI / 4); shaft.translate(0, 3.55, 0);
    this.add(mat, shaft, new THREE.Vector3(x, y, z), rotY);
    const bowl = new THREE.CylinderGeometry(0.95, 0.45, 0.6, 8, 1); bowl.translate(0, 6.6, 0);
    this.add(duskward ? 'iron' : 'gold', bowl, new THREE.Vector3(x, y, z), rotY);
    if (duskward) {
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.ConeGeometry(0.18, 1.4, 5); sp.translate(0, 0.7, 0);
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        this.add('obsidian', sp, new THREE.Vector3(x + Math.cos(a) * 0.9, y + 6.4, z + Math.sin(a) * 0.9), 0, 1, { x: Math.sin(a) * 0.5, z: -Math.cos(a) * 0.5 });
      }
    } else {
      const ring = new THREE.TorusGeometry(0.62, 0.08, 6, 12); ring.rotateX(Math.PI / 2); ring.translate(0, 6.0, 0);
      this.add('gold', ring, new THREE.Vector3(x, y, z), rotY);
    }
    this.world.nav.staticCircle(x, z, 1.25);
    this.torches.push({ pos: new THREE.Vector3(x, y + 7.2, z), team, size: 2.4, phase: this.rnd() * 10 });
  }

  torch(team, x, z) {
    const y = this.ground(x, z);
    const pole = new THREE.CylinderGeometry(0.09, 0.13, 2.3, 6); pole.translate(0, 1.15, 0);
    this.add(team === 'duskward' ? 'iron' : 'wood', pole, new THREE.Vector3(x, y, z));
    const bowl = new THREE.CylinderGeometry(0.34, 0.14, 0.32, 8); bowl.translate(0, 2.4, 0);
    this.add('iron', bowl, new THREE.Vector3(x, y, z));
    this.world.nav.staticCircle(x, z, 0.4);
    this.torches.push({ pos: new THREE.Vector3(x, y + 2.75, z), team, size: 1.3, phase: this.rnd() * 10 });
  }

  buildGates() {
    for (const r of ramps) {
      const team = plateauSDF(r.x - r.dx * 10, r.z - r.dz * 10) < 0 && r.x < r.z ? 'sunward' : r.x > r.z ? 'duskward' : 'sunward';
      const lx = -r.dz, lz = r.dx;
      for (const side of [-1, 1]) {
        const x = r.x - r.dx * 4 + lx * 8.6 * side, z = r.z - r.dz * 4 + lz * 8.6 * side;
        if (reservedDist(x, z) < 1) continue;
        this.obelisk(team, x, z, Math.atan2(r.dx, r.dz));
      }
    }
  }

  buildBaseTorches() {
    for (const team of ['sunward', 'duskward']) {
      const [ax, az] = THRONESHARD[team];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const x = ax + Math.cos(a) * 14.5, z = az + Math.sin(a) * 14.5;
        if (laneDist(x, z) < 4 || Math.max(Math.abs(x), Math.abs(z)) > 97) continue;
        this.torch(team, x, z);
      }
      const [fx, fz] = FOUNTAIN[team];
      const s = team === 'sunward' ? 1 : -1;
      for (const [ox, oz] of [[12, -3], [3, -12]]) this.torch(team, fx + ox * s, fz + oz * s);
    }
    // lane-side torches inside the bases
    let k = 0;
    for (const seg of laneSegs) {
      const [ax, az, bx, bz] = seg;
      const len = Math.hypot(bx - ax, bz - az);
      const lx = -(bz - az) / len, lz = (bx - ax) / len;
      for (let s = 6; s < len - 4; s += 13) {
        const cx = ax + ((bx - ax) * s) / len, cz = az + ((bz - az) * s) / len;
        if (plateauSDF(cx, cz) > -5) continue;
        const side = k++ % 2 ? 1 : -1;
        const x = cx + lx * 5.2 * side, z = cz + lz * 5.2 * side;
        if (reservedDist(x, z) < 0.5 || laneDist(x, z) < 4.5) continue;
        if (this.torches.some((t) => (t.pos.x - x) ** 2 + (t.pos.z - z) ** 2 < 36)) continue;
        this.torch(x < z ? 'sunward' : 'duskward', x, z);
      }
    }
  }

  buildBanners() {
    const makeClothTex = (team) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const g = c.getContext('2d');
      const col = team === 'sunward' ? ['#2e7d32', '#a5d6a7', '#e8d27a'] : ['#7f1010', '#ff7043', '#1a1010'];
      g.fillStyle = col[0]; g.fillRect(0, 0, 64, 128);
      g.fillStyle = col[2]; g.fillRect(0, 0, 64, 8); g.fillRect(0, 118, 64, 10);
      g.strokeStyle = col[1]; g.lineWidth = 4;
      g.beginPath();
      if (team === 'sunward') { g.arc(32, 52, 16, 0, Math.PI * 2); g.moveTo(32, 26); g.lineTo(32, 78); g.moveTo(6, 52); g.lineTo(58, 52); }
      else { g.moveTo(14, 30); g.lineTo(32, 78); g.lineTo(50, 30); g.moveTo(20, 50); g.lineTo(44, 50); }
      g.stroke();
      // swallow-tail cut
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(20, 128); g.lineTo(32, 104); g.lineTo(44, 128); g.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const clothGeos = { sunward: [], duskward: [] };
    const place = (team, x, z, rotY) => {
      const y = this.ground(x, z);
      const pole = new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6); pole.translate(0, 2.6, 0);
      this.add(team === 'duskward' ? 'iron' : 'wood', pole, new THREE.Vector3(x, y, z));
      const bar = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 5); bar.rotateZ(Math.PI / 2); bar.translate(0.65, 4.9, 0);
      this.add(team === 'duskward' ? 'iron' : 'gold', bar, new THREE.Vector3(x, y, z), rotY);
      const cloth = new THREE.PlaneGeometry(1.3, 2.6, 4, 8);
      const flex = new Float32Array(cloth.attributes.position.count);
      for (let i = 0; i < flex.length; i++) flex[i] = (2.6 / 2 - cloth.attributes.position.getY(i)) / 2.6;
      cloth.setAttribute('aFlex', new THREE.BufferAttribute(flex, 1));
      cloth.translate(0.68, 4.9 - 1.3, 0.02);
      _q.setFromEuler(_e.set(0, rotY, 0));
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(1));
      cloth.applyMatrix4(_m);
      clothGeos[team].push(cloth);
      this.world.nav.staticCircle(x, z, 0.35);
    };
    for (const r of ramps) {
      const team = r.x > r.z ? 'duskward' : 'sunward';
      const lx = -r.dz, lz = r.dx;
      for (const side of [-1, 1]) {
        const x = r.x - r.dx * 9 + lx * 6.2 * side, z = r.z - r.dz * 9 + lz * 6.2 * side;
        if (reservedDist(x, z) < 0.5) continue;
        place(team, x, z, Math.atan2(r.dx, r.dz) + Math.PI / 2);
      }
    }
    for (const team of ['sunward', 'duskward']) {
      const [fx, fz] = FOUNTAIN[team];
      const s = team === 'sunward' ? 1 : -1;
      place(team, fx + 9 * s, fz - 9 * s, Math.PI / 4);
    }
    for (const team of ['sunward', 'duskward']) {
      if (!clothGeos[team].length) continue;
      const geo = mergeGeometries(clothGeos[team]);
      const mat = new THREE.MeshStandardMaterial({ map: makeClothTex(team), side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.5 });
      patchMaterial(mat, 'banner', (sh) => {
        sh.uniforms.uTime = worldUniforms.uTime;
        sh.vertexShader = 'uniform float uTime;\nattribute float aFlex;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = position.x * 0.3 + position.z * 0.3;
          transformed.x += sin(uTime * 3.0 + ph + aFlex * 3.0) * 0.18 * aFlex;
          transformed.z += cos(uTime * 2.3 + ph + aFlex * 2.0) * 0.18 * aFlex;`);
        injectFow(sh);
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  crystalCluster(team, x, z, big = 1) {
    const y = this.ground(x, z);
    const key = team === 'duskward' ? 'crystalDuskward' : 'crystalRad';
    const n = 3 + Math.floor(this.rnd() * 4);
    for (let i = 0; i < n; i++) {
      const h = (0.8 + this.rnd() * 1.6) * big * (i === 0 ? 1.5 : 1);
      const g = new THREE.OctahedronGeometry(0.4, 0); g.scale(1, h * 2.2, 1); g.translate(0, h * 0.6, 0);
      const a = this.rnd() * 6.28, d = i === 0 ? 0 : 0.4 + this.rnd() * 0.6 * big;
      this.add(key, g, new THREE.Vector3(x + Math.cos(a) * d, y - 0.2, z + Math.sin(a) * d), this.rnd() * 6, big, { x: (this.rnd() - 0.5) * 0.7, z: (this.rnd() - 0.5) * 0.7 });
    }
    if (team === 'duskward') {
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.ConeGeometry(0.35 * big, 2.6 * big, 5); sp.translate(0, 1.2 * big, 0);
        const a = this.rnd() * 6.28, d = 1 + this.rnd() * big;
        this.add('obsidian', sp, new THREE.Vector3(x + Math.cos(a) * d, y - 0.2, z + Math.sin(a) * d), 0, 1, { x: (this.rnd() - 0.5) * 0.6, z: (this.rnd() - 0.5) * 0.6 });
      }
    }
    this.world.nav.staticCircle(x, z, 0.9 * big);
    this.crystals = this.crystals ?? [];
    this.crystals.push({ x, y: y + 1.5 * big, z, team });
  }

  buildCrystals() {
    let placed = { sunward: 0, duskward: 0 }, jungle = { sunward: 0, duskward: 0 };
    for (let i = 0; i < 3000; i++) {
      const x = (this.rnd() - 0.5) * 194, z = (this.rnd() - 0.5) * 194;
      const team = x < z ? 'sunward' : 'duskward';
      const inBase = plateauSDF(x, z) < -3;
      if (!this.free(x, z, 2.5, 5)) continue;
      if (this.world.td.sample(this.world.td.slope, x, z) > 0.3) continue;
      if (inBase && placed[team] < 9) { this.crystalCluster(team, x, z, 1.2); placed[team]++; }
      else if (!inBase && jungle[team] < 7 && riverDist(x, z) > 14 && this.world.foliage.treesInRadius(x, z, 2.5).length === 0) {
        this.crystalCluster(team, x, z, 0.8); jungle[team]++;
      }
    }
  }

  brokenPillar(x, z, dark) {
    const y = this.ground(x, z);
    const key = dark ? 'stoneDark' : 'stoneLight';
    const h = 1.5 + this.rnd() * 3;
    const base = new THREE.BoxGeometry(1.6, 0.5, 1.6); base.translate(0, 0.25, 0);
    this.add(key, base, new THREE.Vector3(x, y, z), this.rnd() * 6);
    const col = new THREE.CylinderGeometry(0.5, 0.56, h, 10, 1); col.translate(0, 0.5 + h / 2, 0);
    this.add(key, col, new THREE.Vector3(x, y, z), this.rnd() * 6, 1, { x: (this.rnd() - 0.5) * 0.15, z: (this.rnd() - 0.5) * 0.15 });
    if (this.rnd() < 0.6) {
      // fallen drum
      const d = new THREE.CylinderGeometry(0.5, 0.5, 1.2 + this.rnd(), 10); d.rotateZ(Math.PI / 2);
      const a = this.rnd() * 6.28;
      this.add(key, d, new THREE.Vector3(x + Math.cos(a) * 1.8, y + 0.4, z + Math.sin(a) * 1.8), a);
    }
    this.world.nav.staticCircle(x, z, 0.9);
  }

  buildRuins() {
    // around hidden bazaars
    for (const [sx, sz] of SHOPS.secret) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const x = sx + Math.cos(a) * 9, z = sz + Math.sin(a) * 9;
        if (laneDist(x, z) < 5 || this.world.foliage.treesInRadius(x, z, 1.2).length) continue;
        this.brokenPillar(x, z, sx > sz);
      }
    }
    // scattered jungle ruins
    let n = 0;
    for (let i = 0; i < 2000 && n < 16; i++) {
      const x = (this.rnd() - 0.5) * 180, z = (this.rnd() - 0.5) * 180;
      if (!this.free(x, z, 2, 4)) continue;
      if (plateauSDF(x, z) < 2) continue;
      if (this.world.td.sample(this.world.td.slope, x, z) > 0.3) continue;
      if (this.world.foliage.treesInRadius(x, z, 2.5).length) continue;
      this.brokenPillar(x, z, x > z); n++;
    }
  }

  buildGrimmawLair() {
    const [rx, rz] = GRIMMAW_LAIR;
    const geos = [rockGeo(101), rockGeo(202), rockGeo(303)];
    const gaps = [Math.atan2(22, -22), Math.atan2(-22, 22)];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      if (gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.42)) continue;
      const r = 12 + this.rnd() * 1.2;
      const x = rx + Math.cos(a) * r, z = rz + Math.sin(a) * r;
      const s = 1.4 + this.rnd() * 1.1;
      const g = geos[i % 3].clone();
      this.add('rockMat', g, new THREE.Vector3(x, this.ground(x, z) - 0.3, z), this.rnd() * 6, new THREE.Vector3(s, s * 1.3, s));
      this.world.nav.staticCircle(x, z, s * 0.85);
    }
    // gate pillars at the entrances
    for (const g of gaps) {
      for (const side of [-1, 1]) {
        const a = g + side * 0.5;
        const x = rx + Math.cos(a) * 12.5, z = rz + Math.sin(a) * 12.5;
        this.brokenPillar(x, z, true);
      }
    }
    // bone pile inside
    for (let i = 0; i < 7; i++) {
      const b = new THREE.CylinderGeometry(0.08, 0.1, 1.2 + this.rnd(), 5); b.rotateZ(Math.PI / 2);
      const a = this.rnd() * 6.28, d = 6 + this.rnd() * 3;
      const x = rx + Math.cos(a) * d, z = rz + Math.sin(a) * d;
      this.add('bone', b, new THREE.Vector3(x, this.ground(x, z) + 0.08, z), this.rnd() * 6);
    }
  }

  buildLavaPools() {
    const pools = [];
    for (let i = 0; i < 4000 && pools.length < 6; i++) {
      const x = 40 + this.rnd() * 58, z = -98 + this.rnd() * 58;
      if (plateauSDF(x, z) > -3 && riverDist(x, z) < 20) continue;
      if (!this.free(x, z, 3.5, 6)) continue;
      if (this.world.td.sample(this.world.td.slope, x, z) > 0.25) continue;
      if (this.world.foliage.treesInRadius(x, z, 3.2).length) continue;
      if (pools.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) continue;
      pools.push({ x, z, r: 1.8 + this.rnd() * 1.4 });
    }
    if (!pools.length) return;
    const geos = [];
    for (const p of pools) {
      const g = new THREE.CircleGeometry(p.r, 24);
      const pos = g.attributes.position;
      for (let i = 1; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const a = Math.atan2(y, x);
        const k = 1 + Math.sin(a * 3 + p.x) * 0.15 + Math.sin(a * 5 + p.z) * 0.08;
        pos.setXY(i, x * k, y * k);
      }
      g.rotateX(-Math.PI / 2);
      g.translate(p.x, this.ground(p.x, p.z) + 0.06, p.z);
      geos.push(norm(g));
      this.world.nav.staticCircle(p.x, p.z, p.r * 0.9);
      // rim rocks
      for (let i = 0; i < 6; i++) {
        const a = this.rnd() * 6.28;
        const x = p.x + Math.cos(a) * p.r * 1.1, z = p.z + Math.sin(a) * p.r * 1.1;
        this.add('obsidian', rockGeo(500 + i, 0), new THREE.Vector3(x, this.ground(x, z) - 0.1, z), this.rnd() * 6, 0.4 + this.rnd() * 0.4);
      }
      this.torches.push({ pos: new THREE.Vector3(p.x, this.ground(p.x, p.z) + 1.0, p.z), team: 'lava', size: 0, phase: this.rnd() * 10, lightOnly: true });
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a0a05, emissive: 0xffffff, roughness: 0.6 });
    patchMaterial(mat, 'lava-pool', (sh) => {
      sh.uniforms.uTime = worldUniforms.uTime;
      sh.vertexShader = 'varying vec3 vLP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLP = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vLP;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `
        vec2 lp = vLP.xz * 0.9;
        float fl = sin(lp.x * 2.1 + uTime * 0.7) * sin(lp.y * 1.7 - uTime * 0.5) + sin((lp.x + lp.y) * 3.3 + uTime * 1.1) * 0.5;
        float crust = smoothstep(0.35, 0.9, fl);
        vec3 hot = mix(vec3(6.0, 1.6, 0.25), vec3(3.0, 0.5, 0.08), crust);
        totalEmissiveRadiance = hot * (1.0 - crust * 0.85) * (0.85 + 0.15 * sin(uTime * 2.0 + lp.x));
        diffuseColor.rgb *= crust;`);
      injectFow(sh);
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // ---------- fire sprites + pooled lights ----------
  buildFlames() {
    const list = this.torches.filter((t) => !t.lightOnly);
    const n = list.length;
    if (!n) return;
    // instanced camera-facing flame quads (shader billboards)
    const quad = new THREE.PlaneGeometry(1, 1.6);
    quad.translate(0, 0.45, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const offs = new Float32Array(n * 4), cols = new Float32Array(n * 3);
    list.forEach((t, i) => {
      offs.set([t.pos.x, t.pos.y - 0.3, t.pos.z, t.size], i * 4);
      const c = t.team === 'duskward' ? [1.0, 0.35, 0.12] : [1.0, 0.62, 0.22];
      cols.set(c, i * 3);
    });
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 4));
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(cols, 3));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: worldUniforms.uTime, uGlow: { value: this.glowTex }, uFowTex: worldUniforms.uFowTex, uFowOn: worldUniforms.uFowOn, uMapHalf: worldUniforms.uMapHalf },
      vertexShader: /* glsl */`
        attribute vec4 aOff; attribute vec3 aCol;
        uniform float uTime;
        varying vec2 vUv; varying vec3 vCol; varying float vSeed; varying vec3 vW;
        void main() {
          vUv = uv; vCol = aCol; vSeed = aOff.x * 1.3 + aOff.z * 0.7;
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(0.0, 1.0, 0.0);
          float s = aOff.w * (0.9 + 0.12 * sin(uTime * 9.0 + vSeed));
          vec3 wp = aOff.xyz + camR * position.x * s + up * position.y * s;
          vW = aOff.xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform sampler2D uGlow; uniform sampler2D uFowTex; uniform float uFowOn; uniform float uMapHalf;
        varying vec2 vUv; varying vec3 vCol; varying float vSeed; varying vec3 vW;
        void main() {
          vec2 p = vUv - vec2(0.5, 0.25);
          float wob = sin(p.y * 9.0 - uTime * 11.0 + vSeed) * 0.06 * vUv.y;
          p.x += wob;
          float w = mix(0.36, 0.05, smoothstep(0.0, 0.75, vUv.y));
          float body = 1.0 - smoothstep(w * 0.4, w, abs(p.x));
          body *= smoothstep(-0.25, 0.0, p.y) * (1.0 - smoothstep(0.3, 0.72, vUv.y + 0.08 * sin(uTime * 7.0 + vSeed)));
          float core = (1.0 - smoothstep(0.0, w * 0.5, abs(p.x))) * (1.0 - smoothstep(0.1, 0.45, vUv.y));
          float halo = texture2D(uGlow, vec2(vUv.x, vUv.y * 0.9 + 0.1)).r * 0.25;
          vec3 c = vCol * body * 3.0 + vec3(1.0, 0.9, 0.6) * core * 3.0 + vCol * halo;
          float fv = mix(1.0, texture2D(uFowTex, (vW.xz + uMapHalf) / (2.0 * uMapHalf)).r, uFowOn);
          gl_FragColor = vec4(c * mix(0.25, 1.0, fv), 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.group.add(mesh);
    // light pool
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 16, 1.6);
      l.castShadow = false;
      this.group.add(l);
      this.lights.push(l);
    }
  }

  updateLights(target, time, quality, resort = true) {
    if (!this.lights.length) return;
    const active = this.lightCount ?? (quality === 'low' ? 2 : this.lights.length);
    if (resort || !this._sorted) {
      this._sorted = this.torches
        .map((t) => ({ t, d: (t.pos.x - target.x) ** 2 + (t.pos.z - target.z) ** 2 }))
        .sort((a, b) => a.d - b.d);
    }
    const sorted = this._sorted;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const e = sorted[i];
      if (!e || i >= active || e.d > 70 * 70) { l.intensity = 0; continue; }
      const t = e.t;
      l.position.copy(t.pos);
      const flick = 0.8 + 0.12 * Math.sin(time * 13 + t.phase) + 0.08 * Math.sin(time * 23.7 + t.phase * 2);
      const base = t.team === 'lava' ? 26 : t.size > 2 ? 40 : 18;
      l.color.setHex(t.team === 'duskward' || t.team === 'lava' ? 0xff5a20 : 0xffa048);
      l.intensity = base * flick * (1 + this.world.night * 0.6);
    }
  }

  buildParticles() {
    // Fireflies (Sunward jungle) and embers (Duskward base)
    const mk = (count, gen, color, rise) => {
      const pos = new Float32Array(count * 3), seed = new Float32Array(count);
      for (let i = 0; i < count; i++) { const p = gen(); pos.set(p, i * 3); seed[i] = this.rnd() * 100; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: worldUniforms.uTime, uNight: worldUniforms.uNight, uCol: { value: new THREE.Color(...color) }, uRise: { value: rise }, uFowTex: worldUniforms.uFowTex, uFowOn: worldUniforms.uFowOn, uMapHalf: worldUniforms.uMapHalf, uScale: { value: 1 } },
        vertexShader: /* glsl */`
          attribute float aSeed; uniform float uTime; uniform float uRise; uniform float uScale;
          varying float vA; varying vec3 vW;
          void main() {
            vec3 p = position;
            float t = uTime * 0.6 + aSeed;
            if (uRise > 0.0) {
              float life = fract(t * 0.15);
              p.y += life * uRise; p.x += sin(t * 1.3) * 0.8; p.z += cos(t * 1.1) * 0.8;
              vA = sin(life * 3.14159);
            } else {
              p += vec3(sin(t * 0.7) * 1.5, sin(t * 1.3) * 0.4, cos(t * 0.5) * 1.5);
              vA = pow(max(0.0, sin(t * 2.3 + aSeed)), 3.0);
            }
            vW = p;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = uScale * 90.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uCol; uniform float uNight; uniform float uRise; uniform sampler2D uFowTex; uniform float uFowOn; uniform float uMapHalf;
          varying float vA; varying vec3 vW;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            float vis = uRise > 0.0 ? 1.0 : mix(0.25, 1.0, uNight);
            float fv = mix(1.0, texture2D(uFowTex, (vW.xz + uMapHalf) / (2.0 * uMapHalf)).r, uFowOn);
            gl_FragColor = vec4(uCol * a * vA * vis * fv * 2.5, 1.0);
          }`,
      });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      this.group.add(pts);
      return m;
    };
    const td = this.world.td;
    const ff = () => {
      for (let k = 0; k < 50; k++) {
        const x = -95 + this.rnd() * 110, z = -15 + this.rnd() * 110;
        if (x > z - 10) continue;
        if (td.sample(td.lane, x, z) < 6) continue;
        return [x, this.ground(x, z) + 0.8 + this.rnd() * 1.5, z];
      }
      return [-50, 1, 50];
    };
    const em = () => {
      const a = this.rnd() * 6.28, d = 4 + this.rnd() * 40;
      const x = THRONESHARD.duskward[0] + Math.cos(a) * d, z = THRONESHARD.duskward[1] + Math.sin(a) * d;
      return [x, this.ground(x, z) + this.rnd() * 1.5, z];
    };
    this.pointMats = [mk(500, ff, [0.7, 1.0, 0.35], 0), mk(450, em, [1.0, 0.4, 0.1], 7)];
  }

  // Number of pooled torch lights that exist in the shaders (changing it recompiles lit materials once).
  setLightCount(n) {
    this.lightCount = n;
    this.lights.forEach((l, i) => { l.visible = i < n; });
  }

  setPointScale(s) { for (const m of this.pointMats ?? []) m.uniforms.uScale.value = s; }
}
