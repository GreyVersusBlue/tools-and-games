import * as THREE from 'three';
import { FRAME } from '../textures.js';
import { GEO, addMat, fresnelMat, fireMat } from '../meshfx.js';

// Persistent effects that follow a unit. Signature: (vfx, fx, unit, opts) — set fx.onUpdate; objects via fx.add.
// Attachments are removed by handle.remove(), modifier removal (VFX tracks modifier.vfxName), unit death, or duration.

const visible = (u) => u.object?.visible !== false && (u.object?.parent != null);
const at = (vfx, u, f = 0) => { const p = u.position; return new THREE.Vector3(p.x, (u.object?.position.y ?? p.y) + vfx.unitHeight(u) * f, p.z); };

function rate(dt, fx, perSec, key = '_acc') {
  fx[key] = (fx[key] ?? 0) + dt * perSec;
  const n = Math.floor(fx[key]);
  fx[key] -= n;
  return n;
}

// Gameplay radius of a hero ability (so persistent area visuals match the real damage area).
function abilityRadius(u, id, fallback) {
  try { return u.abilities?.find((a) => a?.def?.id === id)?.getRadius?.() || fallback; } catch { return fallback; }
}

function spriteMat(vfx, fx, tex, color, opacity = 1, additive = true) {
  return fx.own(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
}

export const ATTACHMENTS = {
  stun(vfx, fx, u) {
    const g = fx.add(new THREE.Group());
    const mat = spriteMat(vfx, fx, vfx.tex.star, 0xffe070);
    const stars = [];
    for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(mat); s.scale.set(0.45, 0.45, 1); g.add(s); stars.push(s); }
    fx.onUpdate = (dt, t) => {
      g.visible = visible(u);
      g.position.copy(at(vfx, u, 1.05));
      stars.forEach((s, i) => {
        const a = t * 4 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.55, Math.sin(a * 2) * 0.06 + 0.15, Math.sin(a) * 0.55);
      });
    };
    fx.onUpdate(0, 0);
  },
  silence(vfx, fx, u) {
    const mat = spriteMat(vfx, fx, vfx.tex.silence, 0xc080ff);
    const s = fx.add(new THREE.Sprite(mat));
    s.scale.set(0.8, 0.8, 1);
    fx.onUpdate = (dt, t) => { s.visible = visible(u); s.position.copy(at(vfx, u, 1.1)).setY(s.position.y + 0.35 + Math.sin(t * 3) * 0.08); mat.opacity = 0.8 + 0.2 * Math.sin(t * 6); };
    fx.onUpdate(0, 0);
  },
  morph(vfx, fx, u) {
    // Hide the real model and show a hopping frog.
    const root = u.model?.root;
    const g = fx.add(new THREE.Group());
    const skin = fx.own(new THREE.MeshStandardMaterial({ color: 0x4fa83a, roughness: 0.6 }));
    const belly = fx.own(new THREE.MeshStandardMaterial({ color: 0xc8e070, roughness: 0.7 }));
    const eyeW = fx.own(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
    const eyeB = fx.own(new THREE.MeshBasicMaterial({ color: 0x111111 }));
    const body = new THREE.Mesh(GEO.sphere, skin); body.scale.set(0.55, 0.38, 0.65); body.position.y = 0.4; g.add(body);
    const b2 = new THREE.Mesh(GEO.sphere, belly); b2.scale.set(0.45, 0.28, 0.5); b2.position.set(0, 0.3, 0.15); g.add(b2);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(GEO.sphereLow, eyeW); e.scale.setScalar(0.14); e.position.set(0.22 * sx, 0.72, 0.35); g.add(e);
      const pu = new THREE.Mesh(GEO.sphereLow, eyeB); pu.scale.setScalar(0.07); pu.position.set(0.24 * sx, 0.74, 0.47); g.add(pu);
      const leg = new THREE.Mesh(GEO.sphereLow, skin); leg.scale.set(0.16, 0.12, 0.35); leg.position.set(0.42 * sx, 0.18, -0.2); g.add(leg);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    u.data._morphVfx = (u.data._morphVfx ?? 0) + 1; // refcount so overlapping morphs restore the model correctly
    if (root) root.visible = false;
    vfx.emitAlpha(12, { position: at(vfx, u, 0.5), spread: 0.6, speed: [0.5, 2], life: [0.5, 0.9], size: [1, 2], color: 0xb0e090, alpha: 0.7, frame: FRAME.SMOKE });
    fx.onUpdate = (dt, t) => {
      g.visible = visible(u);
      if (root) root.visible = false;
      const hop = Math.abs(Math.sin(t * 6)) * (u.state === 'moving' ? 0.35 : 0.08);
      g.position.set(u.position.x, (u.object?.position.y ?? 0) + hop, u.position.z);
      g.rotation.y = u.facing;
    };
    fx.onEnd = () => {
      u.data._morphVfx = Math.max(0, (u.data._morphVfx ?? 1) - 1);
      if (root && u.data._morphVfx === 0) root.visible = true;
      if (u.alive) vfx.emitAlpha(12, { position: at(vfx, u, 0.5), spread: 0.6, speed: [0.5, 2], life: [0.5, 0.9], size: [1, 2], color: 0xb0e090, alpha: 0.7, frame: FRAME.SMOKE });
    };
    fx.onUpdate(0, 0);
  },
  taunt(vfx, fx, u) {
    const mat = spriteMat(vfx, fx, vfx.tex.glow, 0xff2010, 0.9);
    const s = fx.add(new THREE.Sprite(mat));
    fx.onUpdate = (dt, t) => {
      s.visible = visible(u);
      s.position.copy(at(vfx, u, 1.1)).setY(s.position.y + 0.2);
      const k = 0.9 + 0.3 * Math.sin(t * 10);
      s.scale.set(k, k, 1);
      if (s.visible && rate(dt, fx, 12)) vfx.emit(1, { position: at(vfx, u, 0.9), spread: 0.3, up: [0.5, 1.5], life: 0.5, size: [0.3, 0.05], color: 0xff4020, frame: FRAME.FLARE });
    };
  },
  bloodfever(vfx, fx, u) {
    const mat = spriteMat(vfx, fx, vfx.tex.glow, 0xff2a10, 0.8);
    const s = fx.add(new THREE.Sprite(mat));
    fx.onUpdate = (dt, t) => {
      s.visible = visible(u);
      s.position.copy(at(vfx, u, 0.6));
      const k = vfx.unitHeight(u) * (0.8 + 0.12 * Math.sin(t * 7));
      s.scale.set(k, k, 1);
      if (!s.visible) return;
      const n = rate(dt, fx, 18);
      if (n) vfx.emit(n, { position: at(vfx, u, 0.85), spread: 0.4, up: [0.8, 2], life: [0.4, 0.8], size: [0.7, 0.05], color: 0xff5530, color2: 0x801010, frame: FRAME.GLOW });
      if (rate(dt, fx, 4, '_b')) vfx.emitAlpha(1, { position: at(vfx, u, 0.7), spread: 0.3, up: [-0.5, 0], life: 0.6, size: [0.2, 0.1], color: 0x880000, gravity: 6, frame: FRAME.GLOW });
    };
  },
  steel_cyclone(vfx, fx, u, o) {
    const r = 2.2;
    const R = abilityRadius(u, 'kenshar_steel_cyclone', 6.25);
    const edgeMat = fx.own(addMat(0xffb050, vfx.tex.shock, 0.55));
    const edge = fx.add(new THREE.Mesh(GEO.ground, edgeMat));
    edge.scale.set(R * 2, 1, R * 2);
    const ind = vfx.areaIndicator({ follow: u, radius: R, team: u.team, duration: Infinity, opacity: 0.8 });
    const prevEnd = fx.onEnd;
    fx.onEnd = () => { ind?.remove(); prevEnd?.(); };
    const g = fx.add(new THREE.Group());
    const swirl = fx.own(fireMat(vfx, 0xffe0a0, 0xff6a00, 3));
    const m1 = new THREE.Mesh(GEO.cone, swirl); m1.scale.set(r, 2.2, r); g.add(m1);
    const inner = fx.own(fireMat(vfx, 0xffffff, 0xffaa40, 4));
    const m2 = new THREE.Mesh(GEO.cone, inner); m2.scale.set(r * 0.6, 1.8, r * 0.6); g.add(m2);
    const disc = fx.own(addMat(0xff9030, vfx.tex.ring, 0.9));
    const d = new THREE.Mesh(GEO.ground, disc); d.scale.set(r * 2.3, 1, r * 2.3); d.position.y = 0.1; g.add(d);
    fx.onUpdate = (dt, t) => {
      g.visible = visible(u);
      g.position.set(u.position.x, u.object?.position.y ?? 0, u.position.z);
      edge.visible = g.visible;
      edge.position.set(u.position.x, vfx.groundY(u.position.x, u.position.z) + 0.12, u.position.z);
      edge.rotation.y -= dt * 6;
      edgeMat.opacity = 0.4 + 0.15 * Math.sin(t * 12);
      m1.rotation.y += dt * 14; m2.rotation.y -= dt * 18; d.rotation.y += dt * 10;
      swirl.uniforms.uTime.value = t; inner.uniforms.uTime.value = t * 1.3;
      if (!g.visible) return;
      const n = rate(dt, fx, 60);
      if (n) vfx.emit(n, { position: at(vfx, u, 0.4), shape: 'ring', radius: r * 0.9, spread: { x: 0.2, y: 1.2, z: 0.2 }, speed: [4, 8], life: [0.15, 0.35], size: [0.35, 0.05], color: 0xffffff, color2: 0xff8a20, frame: FRAME.SPARK, drag: 3 });
      const n2 = rate(dt, fx, 24, '_e');
      if (n2) vfx.emit(n2, { position: at(vfx, u, 0.15), shape: 'ring', radius: R * 0.92, spread: { x: 0.3, y: 0.4, z: 0.3 }, up: [0.5, 1.5], life: [0.2, 0.35], size: [0.5, 0.05], color: 0xffe0a0, color2: 0xff7a20, frame: FRAME.SPARK });
    };
  },
  mending_totem(vfx, fx, u) {
    const g = fx.add(new THREE.Group());
    const orbM = fx.own(fresnelMat(vfx, 0x66ff99, { power: 1.5, noise: 0.6 }));
    const orb = new THREE.Mesh(GEO.sphere, orbM); orb.scale.setScalar(0.35); g.add(orb);
    const glowM = spriteMat(vfx, fx, vfx.tex.glow, 0x55ff88, 0.9);
    const gl = new THREE.Sprite(glowM); gl.scale.set(2.2, 2.2, 1); g.add(gl);
    const rMat = fx.own(addMat(0x44ff77, vfx.tex.rune, 0.35));
    const ring = fx.add(new THREE.Mesh(GEO.ground, rMat));
    const R = u.modifiers?.find((m) => m.id === 'mending_totem_aura')?.radius ?? 12.5;
    ring.scale.set(R * 2, 1, R * 2);
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      g.visible = ring.visible = v;
      const y = u.object?.position.y ?? 0;
      g.position.set(u.position.x, y + 1.6 + Math.sin(t * 2.5) * 0.15, u.position.z);
      ring.position.set(u.position.x, y + 0.1, u.position.z);
      ring.rotation.y += dt * 0.3;
      orbM.uniforms.uTime.value = t;
      if (v && rate(dt, fx, 25)) vfx.emit(1, { position: g.position, spread: 0.2, speed: [1, 2], up: [1, 2], life: [0.6, 1], size: [0.3, 0.05], color: 0xaaffcc, color2: 0x22dd66, frame: FRAME.FLARE, gravity: 2 });
      if (v && rate(dt, fx, 10, '_r')) vfx.emit(1, { position: new THREE.Vector3(u.position.x, y + 0.2, u.position.z), shape: 'disc', radius: R * 0.9, up: [1, 2.5], life: [0.8, 1.4], size: [0.35, 0.05], color: 0x88ffaa, frame: FRAME.GLOW });
    };
    fx.onUpdate(0, 0);
  },
  thousand_cuts(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (rate(dt, fx, 30)) vfx.emit(2, { position: at(vfx, u, 0.5), spread: 0.4, life: [0.2, 0.4], size: [0.8, 0.1], color: 0xffcc66, color2: 0xff5500, frame: FRAME.GLOW });
    };
  },
  ice_shackles(vfx, fx, u) {
    const mat = fx.own(new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: 0x3a90e0, emissiveIntensity: 1.1, roughness: 0.1, transparent: true, opacity: 0.8, flatShading: true }));
    const g = fx.add(new THREE.Group());
    const h = vfx.unitHeight(u);
    const gm = spriteMat(vfx, fx, vfx.tex.glow, 0x66bbff, 0.55);
    const gs = new THREE.Sprite(gm); gs.scale.set(h * 1.6, h * 1.6, 1); gs.position.y = h * 0.5; g.add(gs);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(GEO.shard, mat);
      const a = (i / 9) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.45, h * (0.2 + Math.random() * 0.5), Math.sin(a) * 0.45);
      m.scale.set(0.3 + Math.random() * 0.2, h * (0.3 + Math.random() * 0.25), 0.3 + Math.random() * 0.2);
      m.rotation.set((Math.random() - 0.5) * 0.6, a, (Math.random() - 0.5) * 0.6);
      g.add(m);
    }
    const big = new THREE.Mesh(GEO.shard, mat); big.scale.set(0.8, h * 0.6, 0.8); big.position.y = h * 0.45; g.add(big);
    let grow = 0;
    fx.onUpdate = (dt, t) => {
      g.visible = visible(u);
      grow = Math.min(1, grow + dt * 8);
      g.position.set(u.position.x, u.object?.position.y ?? 0, u.position.z);
      g.scale.setScalar(grow);
      if (g.visible && rate(dt, fx, 8)) vfx.emit(1, { position: at(vfx, u, 0.5), spread: 0.7, up: [0.2, 0.6], life: 0.8, size: [0.25, 0.05], color: 0xddf4ff, frame: FRAME.FLAKE, rotSpeed: 2 });
    };
    fx.onEnd = () => { if (u.alive) vfx.spawn('frost', { position: at(vfx, u, 0.5), radius: 1.2 }); };
    fx.onUpdate(0, 0);
  },
  frost_slow(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (!visible(u)) return;
      const n = rate(dt, fx, 12);
      if (n) vfx.emit(n, { position: at(vfx, u, 0.45), spread: 0.6, up: [0.3, 0.8], life: [0.5, 0.9], size: [0.45, 0.05], color: 0xd8f0ff, color2: 0x4a9cff, frame: FRAME.FLAKE, rotSpeed: 2 });
      if (rate(dt, fx, 3, '_r')) vfx.emit(1, { position: at(vfx, u, 0.05), life: 0.6, size: [1.6, 1.2], color: 0x3a8cff, frame: FRAME.GLOW });
    };
  },
  blizzard_veil(vfx, fx, u, o) {
    const R = o.radius ?? 20;
    const rMat = fx.own(addMat(0x7fc8ff, vfx.tex.rune, 0.5));
    const ring = fx.add(new THREE.Mesh(GEO.ground, rMat));
    const fMat = fx.own(addMat(0x3a78c0, vfx.tex.disc, 0.25));
    const fill = fx.add(new THREE.Mesh(GEO.ground, fMat));
    ring.renderOrder = 15; fill.renderOrder = 14;
    const ind = vfx.areaIndicator({ follow: u, radius: R, team: u.team, duration: Infinity, opacity: 0.7 });
    fx.onEnd = () => ind?.remove();
    let grow = 0;
    fx.onUpdate = (dt, t) => {
      grow = Math.min(1, grow + dt * 3);
      const y = (u.object?.position.y ?? 0) + 0.12;
      ring.position.set(u.position.x, y, u.position.z); fill.position.set(u.position.x, y - 0.02, u.position.z);
      ring.scale.set(R * 2 * grow, 1, R * 2 * grow); fill.scale.set(R * 2 * grow, 1, R * 2 * grow);
      ring.rotation.y += dt * 0.25;
      rMat.opacity = 0.45 + 0.1 * Math.sin(t * 3);
      // blizzard snow
      const n = rate(dt, fx, 140);
      if (n) vfx.emit(n, { position: new THREE.Vector3(u.position.x, y + 7, u.position.z), shape: 'disc', radius: R, spread: { x: 0, y: 2, z: 0 }, velocity: new THREE.Vector3(1.5, -6, 0.5), life: [1, 1.4], size: [0.3, 0.2], color: 0xeaf6ff, alpha: 0.9, frame: FRAME.FLAKE, rotSpeed: 3 });
      if (rate(dt, fx, 6, '_m')) vfx.emitAlpha(1, { position: new THREE.Vector3(u.position.x, y + 0.5, u.position.z), shape: 'disc', radius: R * 0.8, speed: 0, velocity: new THREE.Vector3(1, 0, 0.4), life: [2, 3], size: [4, 7], color: 0xd8eeff, alpha: 0.25, frame: FRAME.SMOKE, rotSpeed: 0.3 });
      // icy aura around CM
      if (rate(dt, fx, 20, '_c')) vfx.emit(1, { position: at(vfx, u, 0.5), shape: 'ring', radius: 1, spread: { x: 0.2, y: 1.5, z: 0.2 }, up: [0.5, 1.5], life: [0.5, 0.9], size: [0.5, 0.1], color: 0xaaddff, frame: FRAME.GLOW });
    };
    fx.onUpdate(0, 0);
  },
  final_round_aim(vfx, fx, u, o) {
    const mat = spriteMat(vfx, fx, vfx.tex.crosshair, 0xff2a2a, 0.95);
    const s = fx.add(new THREE.Sprite(mat));
    s.renderOrder = 40; mat.depthTest = false;
    const src = o.source;
    let laser = null;
    if (src) {
      laser = vfx.beam({ fromFn: () => vfx.unitPoint(src, 0.75), toFn: () => (u.alive ? vfx.unitPoint(u, 0.6) : null), color: 0xff2020, width: 0.08, duration: Infinity, noise: 0.1, core: 0.6, scroll: 0 });
    }
    fx.onUpdate = (dt, t) => {
      s.position.copy(at(vfx, u, 0.6));
      const k = Math.max(1.2, 3.2 - t * 1.2);
      s.scale.set(k, k, 1);
      mat.rotation = t * 2;
      mat.opacity = 0.7 + 0.3 * Math.sin(t * 14);
    };
    fx.onEnd = () => laser?.remove();
    fx.onUpdate(0, 0);
  },
  kindled_heart(vfx, fx, u, o) {
    const m = o.modifier;
    const gm = spriteMat(vfx, fx, vfx.tex.glow, 0xff6a10, 0.5);
    const gs = fx.add(new THREE.Sprite(gm));
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      gs.visible = v;
      const stacks = m?.stacks ?? 1;
      gs.position.copy(at(vfx, u, 0.5));
      const k = vfx.unitHeight(u) * (0.9 + stacks * 0.18) * (0.92 + 0.08 * Math.sin(t * 9));
      gs.scale.set(k, k, 1);
      gm.opacity = 0.3 + stacks * 0.1;
      if (!v) return;
      const n = rate(dt, fx, 10 + stacks * 10);
      if (n) {
        const side = new THREE.Vector3(Math.cos(u.facing), 0, -Math.sin(u.facing));
        for (let i = 0; i < n; i++) {
          const p = at(vfx, u, 0.55).addScaledVector(side, (i % 2 ? 1 : -1) * 0.45);
          vfx.emit(1, { position: p, spread: 0.15, up: [1, 2.5], life: [0.25, 0.5], size: [0.8, 0.05], color: 0xffdd66, color2: 0xff3300, frame: FRAME.GLOW });
        }
      }
    };
  },
  blight_cloud(vfx, fx, u, o) {
    const R = o.radius ?? abilityRadius(u, 'gorrow_blight_cloud', 6.25);
    const dMat = fx.own(addMat(0xb8ff30, vfx.tex.disc, 0.3));
    const d = fx.add(new THREE.Mesh(GEO.ground, dMat));
    d.scale.set(R * 2, 1, R * 2);
    const ind = vfx.areaIndicator({ follow: u, radius: R, team: u.team, duration: Infinity, opacity: 0.75 });
    fx.onEnd = () => ind?.remove();
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      d.visible = v;
      d.position.set(u.position.x, vfx.groundY(u.position.x, u.position.z) + 0.1, u.position.z);
      dMat.opacity = 0.26 + 0.08 * Math.sin(t * 4);
      if (!v) return;
      const n = rate(dt, fx, 30);
      if (n) vfx.emitAlpha(n, { position: new THREE.Vector3(u.position.x, (u.object?.position.y ?? 0) + 0.6, u.position.z), shape: 'disc', radius: R * 0.85, spread: { x: 0, y: 0.8, z: 0 }, speed: 0, up: [0.2, 0.8], life: [1, 1.8], size: [1.5, 3.5], color: 0xa8b820, color2: 0x4a3a10, alpha: 0.45, frame: FRAME.SMOKE, rotSpeed: 0.8, fadeIn: 0.3 });
      const ng = rate(dt, fx, 22, '_g');
      if (ng) vfx.emit(ng, { position: new THREE.Vector3(u.position.x, (u.object?.position.y ?? 0) + 0.3, u.position.z), shape: 'disc', radius: R * 0.85, up: [0.5, 1.5], life: [0.6, 1], size: [0.6, 0.05], color: 0xd8ff50, color2: 0x6a8a10, frame: FRAME.GLOW });
    };
    fx.onUpdate(0, 0);
  },
  devour(vfx, fx, u, o) {
    const src = o.source;
    const b = src ? vfx.beam({ fromFn: () => (src.alive ? vfx.unitPoint(src, 0.55) : null), toFn: () => vfx.unitPoint(u, 0.5), color: 0xd01818, width: 0.9, duration: Infinity, noise: 0.9, scroll: -3, core: 0.5, wave: 0.25 }) : null;
    fx.onUpdate = (dt) => {
      if (!visible(u)) return;
      if (rate(dt, fx, 20)) vfx.emitAlpha(1, { position: at(vfx, u, 0.5), spread: 0.4, speed: [1, 3], up: [0.5, 2], life: [0.4, 0.7], size: [0.25, 0.1], color: 0x9a0a0a, gravity: 10, frame: FRAME.GLOW });
      if (rate(dt, fx, 8, '_g')) vfx.emit(1, { position: at(vfx, u, 0.5), spread: 0.5, life: 0.4, size: [2.2, 0.4], color: 0xaa1010, frame: FRAME.GLOW });
    };
    fx.onEnd = () => b?.remove();
  },
  hunters_eye(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (!visible(u)) return;
      if (rate(dt, fx, 5)) vfx.emit(1, { position: at(vfx, u, 0.1), shape: 'ring', radius: 0.7, up: [0.8, 1.6], life: [0.6, 1], size: [0.25, 0.05], color: 0xcfeaff, frame: FRAME.FLARE });
    };
  },
  rally_shout_buff(vfx, fx, u) {
    const mat = fx.own(addMat(0xffc040, vfx.tex.ring, 0.6));
    const m = fx.add(new THREE.Mesh(GEO.ground, mat));
    m.scale.set(2.2, 1, 2.2);
    fx.onUpdate = (dt, t) => {
      m.visible = visible(u);
      m.position.set(u.position.x, (u.object?.position.y ?? 0) + 0.1, u.position.z);
      mat.opacity = 0.45 + 0.2 * Math.sin(t * 5);
      if (m.visible && rate(dt, fx, 6)) vfx.emit(1, { position: at(vfx, u, 0.2), shape: 'ring', radius: 0.9, up: [1, 2], life: 0.7, size: [0.3, 0.05], color: 0xffd070, frame: FRAME.FLARE });
    };
  },
  titans_might(vfx, fx, u) {
    const glowM = spriteMat(vfx, fx, vfx.tex.glow, 0xff2010, 0.6);
    const s = fx.add(new THREE.Sprite(glowM));
    const rm = fx.own(addMat(0xff2a10, vfx.tex.ring, 0.7));
    const ring = fx.add(new THREE.Mesh(GEO.ground, rm));
    ring.scale.set(3, 1, 3);
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      s.visible = ring.visible = v;
      s.position.copy(at(vfx, u, 0.55));
      const k = 3.2 + Math.sin(t * 8) * 0.3;
      s.scale.set(k, k * 1.2, 1);
      ring.position.set(u.position.x, (u.object?.position.y ?? 0) + 0.1, u.position.z);
      ring.rotation.y += dt;
      if (!v) return;
      const n = rate(dt, fx, 40);
      if (n) vfx.emit(n, { position: at(vfx, u, 0.4), spread: { x: 0.5, y: 0.9, z: 0.5 }, up: [1.5, 3.5], life: [0.4, 0.8], size: [0.5, 0.05], color: 0xff6040, color2: 0xaa0000, frame: FRAME.GLOW });
    };
  },
  rime_armor(vfx, fx, u) {
    const mat = fx.own(fresnelMat(vfx, 0x7fd0ff, { power: 2.0, noise: 0.6 }));
    const m = fx.add(new THREE.Mesh(GEO.sphere, mat));
    const h = vfx.unitHeight(u);
    m.scale.set(h * 0.55, h * 0.62, h * 0.55);
    let grow = 0;
    fx.onUpdate = (dt, t) => {
      m.visible = visible(u);
      grow = Math.min(1, grow + dt * 5);
      m.position.copy(at(vfx, u, 0.5));
      m.scale.set(h * 0.55 * grow, h * 0.62 * grow, h * 0.55 * grow);
      m.rotation.y += dt * 0.6;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpacity.value = 0.9 + 0.2 * Math.sin(t * 4);
      if (m.visible && rate(dt, fx, 8)) vfx.emit(1, { position: at(vfx, u, 0.5), spread: h * 0.5, life: 0.8, size: [0.3, 0.05], color: 0xddf4ff, frame: FRAME.FLAKE, rotSpeed: 2 });
    };
  },
  shield(vfx, fx, u, o) {
    const mat = fx.own(fresnelMat(vfx, o.color ?? 0xffe080, { power: 2.2, noise: 0.4 }));
    const m = fx.add(new THREE.Mesh(GEO.sphere, mat));
    const h = vfx.unitHeight(u);
    fx.onUpdate = (dt, t) => {
      m.visible = visible(u);
      m.position.copy(at(vfx, u, 0.5));
      m.scale.set(h * 0.55, h * 0.62, h * 0.55);
      mat.uniforms.uTime.value = t;
    };
  },
  dread_stare(vfx, fx, u, o) {
    const src = o.source;
    const b = src ? vfx.beam({ fromFn: () => (src.alive ? vfx.unitPoint(src, 0.85) : null), toFn: () => vfx.unitPoint(u, 0.85), color: 0x7a3cff, width: 0.35, duration: Infinity, noise: 0.8, scroll: 4, wave: 0.15 }) : null;
    const mat = spriteMat(vfx, fx, vfx.tex.rune, 0x9a5cff, 0.8);
    const s = fx.add(new THREE.Sprite(mat));
    s.scale.set(1.2, 1.2, 1);
    fx.onUpdate = (dt, t) => {
      s.visible = visible(u);
      s.position.copy(at(vfx, u, 1.15));
      mat.rotation = t * 3;
      if (s.visible && rate(dt, fx, 15)) vfx.emit(1, { position: at(vfx, u, 0.6), spread: 0.5, up: [0.3, 1], life: 0.6, size: [0.35, 0.05], color: 0xb088ff, frame: FRAME.GLOW });
    };
    fx.onEnd = () => b?.remove();
  },
  haze(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (!visible(u) || u.state !== 'moving') return;
      if (rate(dt, fx, 12)) vfx.emitAlpha(1, { position: at(vfx, u, 0.4), spread: 0.4, life: [0.4, 0.7], size: [0.8, 1.4], color: 0x7a5aa0, alpha: 0.35, frame: FRAME.SMOKE, rotSpeed: 1 });
    };
  },
  shadow_step_buff(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (!visible(u)) return;
      if (rate(dt, fx, 20)) vfx.emit(1, { position: at(vfx, u, 0.5), spread: 0.5, up: [0.5, 1.5], life: 0.4, size: [0.3, 0.05], color: 0xcc88ff, frame: FRAME.SPARK });
    };
  },
  speed_boost(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (!visible(u) || u.state !== 'moving') return;
      if (rate(dt, fx, 14)) vfx.emit(1, { position: at(vfx, u, 0.15), spread: 0.4, life: 0.35, size: [0.4, 0.05], color: 0xffaa60, frame: FRAME.SPARK });
    };
  },
  poison(vfx, fx, u) {
    fx.onUpdate = (dt) => {
      if (!visible(u)) return;
      if (rate(dt, fx, 6)) vfx.emit(1, { position: at(vfx, u, 0.7), spread: 0.4, up: [0.3, 0.8], life: 0.7, size: [0.25, 0.05], color: 0x99ee33, frame: FRAME.GLOW });
    };
  },
  unbreakable(vfx, fx, u) {
    const mat = fx.own(fresnelMat(vfx, 0xffc84a, { power: 1.8, noise: 0.5 }));
    const m = fx.add(new THREE.Mesh(GEO.sphere, mat));
    const h = vfx.unitHeight(u);
    fx.onUpdate = (dt, t) => {
      m.visible = visible(u);
      m.position.copy(at(vfx, u, 0.5));
      m.scale.set(h * 0.5, h * 0.6, h * 0.5);
      mat.uniforms.uTime.value = t;
      if (m.visible && rate(dt, fx, 10)) vfx.emit(1, { position: at(vfx, u, 0.5), spread: h * 0.45, up: [0.5, 1], life: 0.6, size: [0.3, 0.05], color: 0xffe08a, frame: FRAME.FLARE });
    };
  },
  pyre_brand(vfx, fx, u, o) {
    const R = o.radius ?? 17.5;
    const dm = fx.own(addMat(0xffa030, vfx.tex.disc, 0.12));
    const d = fx.add(new THREE.Mesh(GEO.ground, dm));
    d.scale.set(R * 2, 1, R * 2);
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      d.visible = v;
      d.position.set(u.position.x, (u.object?.position.y ?? 0) + 0.08, u.position.z);
      dm.opacity = 0.1 + 0.04 * Math.sin(t * 3);
      if (!v) return;
      const n = rate(dt, fx, 18);
      if (n) vfx.emit(n, { position: new THREE.Vector3(u.position.x, (u.object?.position.y ?? 0) + 0.3, u.position.z), shape: 'disc', radius: R * 0.8, up: [1, 2.5], life: [0.4, 0.8], size: [0.5, 0.05], color: 0xffcc55, color2: 0xff5500, frame: FRAME.GLOW });
      if (rate(dt, fx, 12, '_b')) vfx.emit(1, { position: at(vfx, u, 0.6), spread: 0.5, life: 0.4, size: [1, 0.2], color: 0xffaa40, frame: FRAME.GLOW });
    };
  },
  cyclone(vfx, fx, u) {
    const g = fx.add(new THREE.Group());
    const mat = fx.own(fireMat(vfx, 0xf0f8ff, 0x8aa0b0, 3));
    const m = new THREE.Mesh(GEO.cone, mat); m.scale.set(1.3, 4.5, 1.3); g.add(m);
    fx.onUpdate = (dt, t) => {
      g.visible = visible(u);
      g.position.set(u.position.x, u.object?.position.y ?? 0, u.position.z);
      m.rotation.y += dt * 12;
      mat.uniforms.uTime.value = t;
      u.data.airHeight = 2 + Math.sin(t * 3) * 0.3;
      if (g.visible && rate(dt, fx, 20)) vfx.emitAlpha(1, { position: at(vfx, u, 0), shape: 'ring', radius: 1.2, up: [2, 5], life: 0.6, size: [0.8, 1.6], color: 0xdde8f0, alpha: 0.4, frame: FRAME.SMOKE, rotSpeed: 3 });
    };
    fx.onEnd = () => { u.data.airHeight = 0; };
  },
  siphon_will(vfx, fx, u, o) {
    const t = o.target;
    const b = t ? vfx.beam({ fromFn: () => vfx.unitPoint(u, 0.7), toFn: () => (t.alive ? vfx.unitPoint(t, 0.6) : null), color: 0x3a7cff, width: 0.45, duration: Infinity, noise: 0.8, scroll: -5, wave: 0.3, repeat: 3 }) : null;
    fx.onUpdate = (dt) => {
      if (!t?.alive) { fx.dead = true; return; }
      const n = rate(dt, fx, 30);
      if (n) {
        const a = vfx.unitPoint(t, 0.6), bb = vfx.unitPoint(u, 0.7);
        const vel = bb.clone().sub(a).multiplyScalar(1 / 0.5);
        vfx.emit(n, { position: a, spread: 0.3, velocity: vel, life: [0.45, 0.5], size: [0.35, 0.1], color: 0x99ccff, color2: 0x2244ff, frame: FRAME.GLOW, fadeIn: 0.2 });
      }
    };
    fx.onEnd = () => b?.remove();
  },
};
