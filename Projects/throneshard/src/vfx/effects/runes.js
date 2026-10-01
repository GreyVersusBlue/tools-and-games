import * as THREE from 'three';
import { FRAME } from '../textures.js';
import { GEO, addMat } from '../meshfx.js';

// Rune pickup bursts (rune_pickup, at the rune's spot), one-shot activation flourishes (rune_activate, on the hero) and
// the lasting auras (RUNE_ATTACH, tied to the rune modifiers' vfxName). Each rune type has its own colour and motif.
// Driven by VFX.hookBus: rune:picked -> rune_pickup, rune:activated -> rune_activate.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const COL = {
  haste: [0xff3a2a, 0xffc080],
  double_damage: [0x3a7aff, 0xcfe0ff],
  regeneration: [0x40e040, 0xeaffee],
  invisibility: [0xb070ff, 0xefe0ff],
  arcane: [0xff60d0, 0xffe0f6],
  illusion: [0xffd040, 0xfff6cc],
  bounty: [0xffc830, 0xfff0a0],
};

const X4 = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];
const D4 = [V(0.7, 0, 0.7), V(-0.7, 0, 0.7), V(0.7, 0, -0.7), V(-0.7, 0, -0.7)];

export const RUNE_EFFECTS = {
  rune_pickup(vfx, o) {
    const type = o.type, [c, c2] = COL[type] ?? COL.bounty;
    const g = vfx.ground(o.position), p = V(g.x, g.y + 1.1, g.z);
    vfx.emit(1, { position: p, life: 0.3, size: [4.5, 0.5], color: c2, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.flash(p, c, 28, 0.35, 16);
    switch (type) {
      case 'haste': // radial speed streaks
        vfx.emit(30, { position: V(g.x, g.y + 0.5, g.z), shape: 'ring', radius: 0.4, speed: [12, 20], life: [0.15, 0.3], size: [0.8, 0.02], color: c2, color2: c, frame: FRAME.SPARK, drag: 2, fadeIn: 0 });
        vfx.ring({ position: g, r0: 0.4, r1: 5, color: c, duration: 0.3, ease: 2 });
        vfx.pillar({ position: g, radius: 0.7, height: 4.5, color: 0xffa060, color2: 0xff1a10, duration: 0.5, speed: 3, cone: true });
        break;
      case 'double_damage': // crossed flares and a hard shock
        for (const d of X4) vfx.emit(5, { position: p, dir: d, cone: 0.08, speed: [10, 16], life: [0.2, 0.35], size: [0.9, 0.05], color: 0xffffff, color2: c, frame: FRAME.FLARE, drag: 3, fadeIn: 0 });
        for (const d of D4) vfx.emit(3, { position: p, dir: d, cone: 0.08, speed: [7, 11], life: [0.15, 0.3], size: [0.6, 0.05], color: c2, color2: c, frame: FRAME.SPARK, drag: 3, fadeIn: 0 });
        vfx.ring({ position: g, r0: 0.3, r1: 4, color: c, duration: 0.35 });
        vfx.ring({ position: g, r0: 0.2, r1: 2.5, color: 0xffffff, duration: 0.25, opacity: 0.7 });
        break;
      case 'regeneration': // rising motes
        vfx.emit(28, { position: V(g.x, g.y + 0.2, g.z), shape: 'disc', radius: 1.1, up: [1.5, 4], life: [0.8, 1.4], size: [0.55, 0.1], color: c, color2: c2, frame: FRAME.FLARE, fadeIn: 0.2 });
        vfx.ring({ position: g, r0: 0.4, r1: 3, color: c, duration: 0.7, tex: vfx.tex.ring });
        vfx.ring({ position: g, r0: 0.2, r1: 2, color: c2, duration: 0.9, tex: vfx.tex.ring, opacity: 0.6 });
        break;
      case 'invisibility': // smoke folds inward and vanishes
        vfx.emitAlpha(16, { position: V(g.x, g.y + 1, g.z), shape: 'ring', radius: 2.4, speed: [-5, -2.5], up: [0.2, 1], life: [0.5, 0.8], size: [1.2, 0.4], color: c, color2: 0x30184a, alpha: 0.6, frame: FRAME.SMOKE, rotSpeed: 2 });
        vfx.ring({ position: g, r0: 3.4, r1: 0.3, color: c, duration: 0.45, ease: 1 });
        vfx.emit(14, { position: p, spread: 0.9, life: [0.4, 0.8], size: [0.4, 0.02], color: c2, color2: c, frame: FRAME.FLAKE, rotSpeed: 4 });
        break;
      case 'arcane': // spinning sigil
        vfx.decal({ position: g, radius: 2.6, tex: vfx.tex.rune, color: c, duration: 1.1, spin: 3, opacity: 1, grow: 0.5, fadeOut: 0.4, lift: 0.1 });
        vfx.emit(22, { position: V(g.x, g.y + 0.2, g.z), shape: 'ring', radius: 2, up: [2, 5], life: [0.6, 1], size: [0.4, 0.05], color: c2, color2: c, frame: FRAME.SPARK, fadeIn: 0.1 });
        vfx.ring({ position: g, r0: 0.5, r1: 4, color: c, duration: 0.5 });
        break;
      case 'illusion': // splits in two
        for (const s of [-1, 1]) {
          vfx.emit(12, { position: p, dir: V(s, 0.2, 0), cone: 0.5, speed: [4, 9], life: [0.3, 0.55], size: [0.6, 0.05], color: c2, color2: c, frame: FRAME.FLARE, drag: 3, fadeIn: 0 });
          vfx.emit(1, { position: V(g.x + s * 1.2, g.y + 1.1, g.z), life: 0.45, size: [2.6, 0.4], color: c, frame: FRAME.GLOW, fadeIn: 0 });
        }
        vfx.ring({ position: g, r0: 0.3, r1: 4, color: c, duration: 0.5 });
        vfx.ring({ position: g, r0: 0.2, r1: 2.6, color: c2, duration: 0.4, tex: vfx.tex.ring });
        break;
      default: // bounty: coin shower
        vfx.emitAlpha(12, { position: p, speed: [1.5, 4], up: [5, 9], life: [0.7, 1.1], size: [0.28, 0.24], color: 0xd8a020, color2: c, frame: FRAME.CHUNK, gravity: 18, rotSpeed: 10, fadeIn: 0 });
        vfx.emit(14, { position: p, spread: 0.3, speed: [2, 5], up: [3, 6], life: [0.5, 0.9], size: [0.45, 0.05], color: c2, color2: c, frame: FRAME.FLARE, gravity: 9 });
        vfx.ring({ position: g, r0: 0.4, r1: 3.5, color: c, duration: 0.5 });
    }
    return null;
  },

  // One-shot flourish on the hero (the lasting aura, where there is one, is the modifier's RUNE_ATTACH entry).
  rune_activate(vfx, o) {
    const u = o.unit, type = o.type, [c, c2] = COL[type] ?? COL.bounty;
    if (!u) return null;
    const g = vfx.ground(u.position), h = vfx.unitHeight(u), mid = vfx.unitPoint(u, 0.55);
    vfx.glow({ position: mid, follow: u, yOff: 0.55, size: h * 2.4, color: c, duration: 0.8, opacity: 0.7 });
    vfx.ring({ position: g, r0: 0.5, r1: 3.2, color: c, duration: 0.55 });
    // helix of motes climbing the hero
    const fx = vfx.fx(o.duration ?? 1.0);
    const po = { position: V(0, 0, 0), life: [0.35, 0.55], size: [0.5, 0.05], color: c2, color2: c, frame: type === 'haste' ? FRAME.SPARK : FRAME.FLARE, fadeIn: 0, up: 0 };
    fx.onUpdate = (dt, t, k) => {
      if (!u.alive) { fx.dead = true; return; }
      const a = t * 9, y = (u.object?.position.y ?? u.position.y) + h * Math.min(1, k * 1.4);
      const r = type === 'invisibility' ? 0.7 * (1 - k) + 0.2 : 0.75;
      for (let s = 0; s < 2; s++) {
        po.position.set(u.position.x + Math.cos(a + s * Math.PI) * r, y, u.position.z + Math.sin(a + s * Math.PI) * r);
        if (type === 'haste') po.up = 0;
        vfx.emit(1, po);
      }
    };
    switch (type) {
      case 'haste':
        vfx.ghost(u, { color: c, duration: 0.5 });
        vfx.emit(16, { position: mid, shape: 'ring', radius: 0.3, speed: [8, 14], life: [0.15, 0.3], size: [0.7, 0.02], color: c2, color2: c, frame: FRAME.SPARK, drag: 2, fadeIn: 0 });
        break;
      case 'double_damage':
        vfx.pillar({ position: u.position, radius: 0.9, height: h * 2.2, color: c2, color2: c, duration: 0.6, speed: 3 });
        for (const d of X4) vfx.emit(3, { position: mid, dir: d, cone: 0.06, speed: [8, 12], life: [0.15, 0.25], size: [0.7, 0.05], color: 0xffffff, color2: c, frame: FRAME.FLARE, drag: 3, fadeIn: 0 });
        break;
      case 'regeneration':
        vfx.ring({ position: g, r0: 0.3, r1: 2, color: c2, duration: 0.8, tex: vfx.tex.ring, opacity: 0.7 });
        vfx.emit(18, { position: V(g.x, g.y + 0.3, g.z), shape: 'disc', radius: 0.9, up: [1.5, 3.5], life: [0.7, 1.2], size: [0.5, 0.1], color: c, color2: c2, frame: FRAME.FLARE, fadeIn: 0.2 });
        break;
      case 'invisibility':
        vfx.emitAlpha(14, { position: mid, spread: 0.5, speed: [1, 3], up: [0.3, 1], life: [0.6, 1], size: [1, 2.2], color: c, color2: 0x30184a, alpha: 0.5, frame: FRAME.SMOKE, rotSpeed: 2, drag: 2 });
        break;
      case 'arcane':
        vfx.decal({ position: g, follow: u, radius: 2, tex: vfx.tex.rune, color: c, duration: 1.4, spin: 4, opacity: 0.9, grow: 0.4, fadeOut: 0.4, lift: 0.1 });
        break;
      case 'illusion':
        for (const s of [-1, 1]) vfx.emit(8, { position: V(u.position.x + s * 1.1, mid.y, u.position.z), spread: 0.4, up: [0.5, 2], life: [0.4, 0.8], size: [0.5, 0.05], color: c2, color2: c, frame: FRAME.FLARE });
        break;
      default:
        vfx.emitAlpha(12, { position: V(u.position.x, g.y + h + 3, u.position.z), shape: 'disc', radius: 1.4, speed: [0, 1.5], up: [-1, 0], life: [0.6, 0.9], size: [0.28, 0.24], color: 0xd8a020, color2: c, frame: FRAME.CHUNK, gravity: 14, rotSpeed: 10, fadeIn: 0 });
        vfx.emit(12, { position: V(u.position.x, g.y + h, u.position.z), spread: 0.5, speed: [1, 3], up: [1, 3], life: [0.5, 0.9], size: [0.45, 0.05], color: c2, color2: c, frame: FRAME.FLARE, gravity: 6 });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Lasting auras. Signature (vfx, fx, unit, opts) like ATTACHMENTS.
// ---------------------------------------------------------------------------------------------
const visible = (u) => u.object?.visible !== false && (u.object?.parent != null);
function rate(dt, fx, perSec, key = '_acc') {
  fx[key] = (fx[key] ?? 0) + dt * perSec;
  const n = Math.floor(fx[key]);
  fx[key] -= n;
  return n;
}
function glowSprite(vfx, fx, color, opacity) {
  const mat = fx.own(new THREE.SpriteMaterial({ map: vfx.tex.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const s = fx.add(new THREE.Sprite(mat));
  s.renderOrder = 21;
  return { s, mat };
}
// Shared shape: a soft body glow plus one particle stream; `emitFn(n, base, y0, h)` supplies the stream.
function aura(type, glowSize, glowOp, perSec, emitFn) {
  return (vfx, fx, u) => {
    const [c] = COL[type];
    const gl = glowSprite(vfx, fx, c, glowOp);
    const base = V(0, 0, 0);
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      gl.s.visible = v;
      const y0 = u.object?.position.y ?? u.position.y, h = vfx.unitHeight(u);
      gl.s.position.set(u.position.x, y0 + h * 0.5, u.position.z);
      const k = h * glowSize * (0.94 + 0.06 * Math.sin(t * 7));
      gl.s.scale.set(k, k, 1);
      if (!v) return;
      const n = rate(dt, fx, perSec);
      if (n) { base.set(u.position.x, y0, u.position.z); emitFn(vfx, n, base, h, t, u); }
    };
    fx.onUpdate(0, 0);
  };
}

export const RUNE_ATTACH = {
  // red speed lines kicked off the heels
  rune_haste: aura('haste', 2, 0.4, 30, (vfx, n, b, h) => {
    vfx.emit(n, { position: b, spread: { x: 0.3, y: 0.2, z: 0.3 }, up: [0.2, 0.8], life: [0.2, 0.4], size: [0.55, 0.02], color: 0xffc080, color2: 0xff2a10, frame: FRAME.SPARK, fadeIn: 0 });
    if (Math.random() < 0.3) vfx.emitAlpha(1, { position: b, spread: 0.3, up: [0.2, 0.6], life: [0.4, 0.7], size: [0.5, 1.2], color: 0x8a5a40, alpha: 0.3, frame: FRAME.SMOKE });
  }),
  // hard blue-white sparks off the shoulders, heavier glow
  rune_double_damage: aura('double_damage', 2.3, 0.6, 30, (vfx, n, b, h, t) => {
    b.y += h * 0.7;
    vfx.emit(n, { position: b, shape: 'ring', radius: 0.5, up: [0.5, 1.6], life: [0.4, 0.7], size: [0.6, 0.03], color: 0xffffff, color2: 0x3a7aff, frame: FRAME.SPARK, fadeIn: 0 });
  }),
  // slow green motes and small crosses of light rising
  rune_regeneration: aura('regeneration', 1.8, 0.35, 18, (vfx, n, b) => {
    vfx.emit(n, { position: b, shape: 'disc', radius: 0.7, up: [1, 2.2], life: [0.7, 1.2], size: [0.5, 0.08], color: 0x80ff80, color2: 0xeaffee, frame: FRAME.FLARE, fadeIn: 0.2 });
  }),
  // a magenta sigil turning under the hero, sparks lifting off it
  rune_arcane(vfx, fx, u) {
    const mat = fx.own(addMat(0xff60d0, vfx.tex.rune, 0.5));
    const ring = fx.add(new THREE.Mesh(GEO.ground, mat));
    ring.renderOrder = 15;
    const base = V(0, 0, 0);
    fx.onUpdate = (dt, t) => {
      const v = visible(u);
      ring.visible = v;
      const y0 = u.object?.position.y ?? u.position.y;
      ring.position.set(u.position.x, y0 + 0.1, u.position.z);
      ring.scale.set(4, 1, 4);
      ring.rotation.y += dt * 1.4;
      mat.opacity = 0.42 + 0.1 * Math.sin(t * 3);
      if (!v) return;
      const n = rate(dt, fx, 9);
      if (n) { base.set(u.position.x, y0 + 0.1, u.position.z); vfx.emit(n, { position: base, shape: 'ring', radius: 1.6, up: [1, 2.5], life: [0.6, 1], size: [0.35, 0.03], color: 0xffe0f6, color2: 0xff60d0, frame: FRAME.SPARK, fadeIn: 0.1 }); }
    };
    fx.onUpdate(0, 0);
  },
};
