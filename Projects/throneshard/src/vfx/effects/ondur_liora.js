import * as THREE from 'three';
import { FRAME } from '../textures.js';
import { GEO } from '../meshfx.js';

// Ondur (Rift Wall, Deep Quake) and Liora (Tether Shot, Piercing Gale). Gameplay code calls these through fx(g, name, opts).
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const easeBack = (u) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const at = (vfx, u, f) => vfx.unitPoint(u, f);
// Allocation-free unitPoint for per-frame endpoint getters.
const pt = (vfx, u, f, out) => out.set(u.position.x, (u.object?.position.y ?? u.position.y) + vfx.unitHeight(u) * f, u.position.z);
const STONE = 0x5a5046, STONE_LIGHT = 0x7d7060, DUST = 0x8a7a60, DUST2 = 0x5a5040;

export const ONDUR_LIORA_EFFECTS = {
  // ---------------------------------------------------------------- Ondur
  // Slabs and spikes climb out of the ground along the line at the same pace the damage sweeps (delayPerUnit s per world
  // unit), stand for `hold` seconds, then sink back with dust and falling chunks. Two meshes per slab, two shared materials.
  rift_wall(vfx, o) {
    const dir = o.direction.clone().setY(0).normalize();
    const from = o.position, len = o.length ?? 30, per = 2.2, dpu = o.delayPerUnit ?? 1 / 60;
    const hold = o.hold ?? 2.6, rise = 0.28, sink = 0.6;
    const n = Math.floor(len / per) + 1;
    const fx = vfx.fx(n * per * dpu + rise + hold + sink + 0.6);
    const slabMat = fx.own(new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.95, flatShading: true }));
    const spikeMat = fx.own(new THREE.MeshStandardMaterial({ color: STONE_LIGHT, emissive: 0x3a2410, emissiveIntensity: 0.5, roughness: 0.9, flatShading: true }));
    const yaw = Math.atan2(dir.x, dir.z);
    const slabs = [];
    const dust = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      const d = i * per, x = from.x + dir.x * d, z = from.z + dir.z * d;
      const s = { x, z, gy: vfx.groundY(x, z), t0: i * per * dpu, h: 2.4 + Math.random() * 1.1, sp: 1.5 + Math.random() * 1.2, up: false, down: false, lean: (Math.random() - 0.5) * 0.9 };
      s.slab = fx.add(new THREE.Mesh(GEO.box, slabMat));
      s.spike = fx.add(new THREE.Mesh(GEO.spike, spikeMat));
      s.slab.rotation.set((Math.random() - 0.5) * 0.14, yaw, (Math.random() - 0.5) * 0.2);
      s.spike.rotation.set(0, yaw + Math.random() * 3, s.lean);
      s.slab.castShadow = s.spike.castShadow = false;
      s.slab.visible = s.spike.visible = false;
      slabs.push(s);
    }
    const burst = (s, big) => {
      dust.x = s.x; dust.y = s.gy + 0.3; dust.z = s.z;
      vfx.emitAlpha(big ? 5 : 4, { position: dust, shape: 'disc', radius: 1, speed: [0.8, 2.6], up: [0.6, 2], life: [0.6, 1.1], size: [0.8, 2.2], color: DUST, color2: DUST2, alpha: 0.55, frame: FRAME.SMOKE, drag: 2, rotSpeed: 1 });
      vfx.emitAlpha(big ? 4 : 3, { position: dust, shape: 'disc', radius: 0.8, speed: [1, 3], up: [3, 7], life: [0.5, 0.8], size: [0.3, 0.2], color: STONE_LIGHT, frame: FRAME.CHUNK, gravity: 18, rotSpeed: 6, fadeIn: 0 });
    };
    const crackAt = (s, life) => vfx.decal({ position: s, radius: 2.6, tex: vfx.tex.crack, color: 0x120a04, additive: false, duration: life, opacity: 0.85, fadeIn: 0.05, fadeOut: 0.3 });
    // strike at the head of the line
    vfx.ring({ position: vfx.ground(from), r0: 0.5, r1: 4.5, color: 0xd8a860, duration: 0.4 });
    vfx.flash(from, 0xd8a860, 30, 0.3, 20);
    vfx.shake(from, 0.3, 0.45);
    let puff = 0;
    fx.onUpdate = (dt, t) => {
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        const u = (t - s.t0) / rise;
        if (u < 0) continue;
        if (!s.up) {
          s.up = true; s.slab.visible = s.spike.visible = true;
          burst(s, i % 4 === 0);
          if (i % 3 === 0) crackAt(s, hold + sink + 0.4);
        }
        const tc = s.t0 + rise + hold + i * 0.025; // crumble start
        const c = Math.max(0, (t - tc) / sink);
        if (c > 0 && !s.down) { s.down = true; burst(s, true); }
        const e = c > 0 ? 1 : easeBack(Math.min(1, u));
        const h = s.h * e * (1 - c);
        const jit = c > 0 && c < 1 ? Math.sin(t * 60 + i) * 0.07 : 0;
        s.slab.scale.set(1.1, Math.max(0.001, h), per * 1.05);
        s.slab.position.set(s.x + jit, s.gy + h * 0.5 - 0.3 - c * 0.6, s.z + jit);
        const sp = s.sp * Math.min(1, e) * (1 - c);
        s.spike.scale.set(0.7, Math.max(0.001, sp), 0.7);
        s.spike.position.set(s.x + jit + Math.cos(yaw) * s.lean * 1.2, s.gy + h * 0.85 - 0.3 - c * 0.6, s.z + jit - Math.sin(yaw) * s.lean * 1.2);
        s.slab.visible = s.spike.visible = c < 1;
      }
      // dust wisps off the standing wall
      puff -= dt;
      if (puff <= 0 && t > 0.5 && t < hold) {
        puff = 0.18;
        const s = slabs[(Math.random() * slabs.length) | 0];
        dust.x = s.x; dust.y = s.gy + s.h * 0.8; dust.z = s.z;
        vfx.emitAlpha(1, { position: dust, spread: 0.5, up: [0.2, 0.7], life: [0.8, 1.3], size: [0.6, 1.5], color: DUST, alpha: 0.3, frame: FRAME.SMOKE, rotSpeed: 0.5 });
      }
    };
    fx.onUpdate(0, 0);
    return fx;
  },

  // Ground ring races out to the radius; dust and thrown rocks ride the ring front; cracks glow amber underneath.
  deep_quake(vfx, o) {
    const p = vfx.ground(o.position), R = o.radius ?? 15, dur = 0.75;
    const c = o.color ?? 0xffa040;
    vfx.ring({ position: p, r0: 1, r1: R, color: c, duration: dur, ease: 2 });
    vfx.ring({ position: p, r0: 0.5, r1: R * 0.7, color: 0xfff0c0, duration: 0.5, opacity: 0.7, tex: vfx.tex.ring });
    vfx.decal({ position: p, radius: R * 0.95, tex: vfx.tex.crack, color: 0x120a04, additive: false, duration: 3.6, opacity: 0.9, grow: 0.25, fadeIn: 0.1, fadeOut: 0.4, lift: 0.07 });
    vfx.decal({ position: p, radius: R * 0.8, tex: vfx.tex.crack, color: 0xff7a20, duration: 3, opacity: 0.8, grow: 0.25, fadeIn: 0.1, fadeOut: 0.6, pulse: 6, lift: 0.09 });
    vfx.decal({ position: p, radius: 3.4, tex: vfx.tex.scorch, additive: false, color: 0x2a1a0c, duration: 4, opacity: 0.8, lift: 0.06 });
    vfx.emit(24, { position: V(p.x, p.y + 0.6, p.z), shape: 'ring', radius: 1.2, speed: [6, 12], life: [0.3, 0.5], size: [0.9, 0.1], color: 0xffe0a0, color2: c, frame: FRAME.GLOW, drag: 3 });
    vfx.emitAlpha(20, { position: V(p.x, p.y + 0.6, p.z), shape: 'disc', radius: 1.5, speed: [3, 8], up: [3, 8], life: [0.8, 1.4], size: [1.5, 4], color: DUST, color2: DUST2, alpha: 0.6, frame: FRAME.SMOKE, drag: 2, rotSpeed: 1 });
    vfx.flash(p, c, 50, 0.5, 30);
    vfx.shake(p, 0.9, 0.9, 60);
    const fx = vfx.fx(dur + 0.4);
    const ringO = { position: V(p.x, p.y + 0.3, p.z), shape: 'ring', radius: 1, speed: [0.5, 2], up: [0.8, 2.2], life: [0.7, 1.2], size: [1.2, 3], color: DUST, color2: DUST2, alpha: 0.5, frame: FRAME.SMOKE, drag: 2, rotSpeed: 1 };
    const rockO = { position: ringO.position, shape: 'ring', radius: 1, speed: [0, 1.5], up: [6, 11], life: [0.7, 1.1], size: [0.4, 0.3], color: 0x7a6a58, frame: FRAME.CHUNK, gravity: 22, rotSpeed: 8, fadeIn: 0 };
    const sparkO = { position: ringO.position, shape: 'ring', radius: 1, speed: 0, up: [2, 6], life: [0.3, 0.6], size: [0.35, 0.05], color: 0xffd090, color2: 0xff5a10, frame: FRAME.SPARK, gravity: 8, fadeIn: 0 };
    fx.onUpdate = (dt, t) => {
      const k = Math.min(1, t / dur), r = 1 + (R - 1) * (1 - Math.pow(1 - k, 2));
      if (k >= 1) return;
      ringO.radius = rockO.radius = sparkO.radius = r;
      ringO.position.y = p.y + 0.3;
      vfx.emitAlpha(2 + Math.round(r * 0.35), ringO);
      if (Math.random() < 0.5 + r / R * 0.5) vfx.emitAlpha(2, rockO);
      vfx.emit(2, sparkO);
    };
    return null;
  },

  // Small tremor under one enemy hit by Deep Quake (echo:true = the 0.3 s follow-up, sparks only).
  quake_echo(vfx, o) {
    const u = o.unit, p = vfx.ground(u ? u.position : o.position), r = o.radius ?? 2.6;
    vfx.ring({ position: p, r0: 0.3, r1: o.echo ? r * 0.7 : r, color: 0xffa040, duration: o.echo ? 0.25 : 0.35, opacity: 0.9 });
    vfx.emit(o.echo ? 6 : 10, { position: V(p.x, p.y + 0.2, p.z), shape: 'disc', radius: 0.6, up: [3, 6], speed: [0.5, 2], life: [0.25, 0.5], size: [0.35, 0.05], color: 0xffd090, color2: 0xff5a10, frame: FRAME.SPARK, gravity: 10, fadeIn: 0 });
    if (o.echo) return null;
    vfx.decal({ position: p, radius: r * 0.9, tex: vfx.tex.crack, color: 0x120a04, additive: false, duration: 1.8, opacity: 0.8, fadeOut: 0.5 });
    vfx.emitAlpha(5, { position: V(p.x, p.y + 0.2, p.z), shape: 'disc', radius: 0.8, speed: [0.8, 2.2], up: [0.6, 2], life: [0.6, 1], size: [0.7, 1.7], color: DUST, alpha: 0.5, frame: FRAME.SMOKE, drag: 2 });
    return null;
  },

  // ---------------------------------------------------------------- Liora
  // Rope between two stunned units (or a unit and a fixed anchor point) that stays for the stun.
  tether_link(vfx, o) {
    const a = o.unit, b = o.target, anchor = o.point;
    const dur = o.duration ?? 2;
    const A = V(0, 0, 0), B = V(0, 0, 0);
    const fromFn = () => (a.alive ? pt(vfx, a, 0.55, A) : null);
    const toFn = () => (b ? (b.alive ? pt(vfx, b, 0.55, B) : null) : anchor);
    const rope = vfx.beam({ fromFn, toFn, color: 0xe8a440, width: 0.55, duration: Infinity, noise: 0.6, scroll: 0, repeat: 8, core: 0.25, sag: 0.35, points: 14, opacity: 1.6 });
    const braid = vfx.beam({ fromFn, toFn, color: 0xffc060, width: 0.24, duration: Infinity, noise: 0.3, scroll: 1.5, repeat: 5, core: 0.3, sag: 0.35, wave: 0.14, opacity: 1.4, points: 14 });
    const binds = [];
    for (const u of [a, b]) if (u) binds.push(vfx.decal({ position: u.position, follow: u, radius: 1.3, tex: vfx.tex.rune, color: 0xd9a95c, duration: dur, spin: 1.6, opacity: 0.7, fadeOut: 0.15 }));
    const fx = vfx.fx(dur);
    let acc = 0;
    fx.onUpdate = (dt, t) => {
      const alive = a.alive && (!b || b.alive);
      if (!alive || (t > 0.4 && !a.hasState?.('stun') && !(b?.hasState?.('stun')))) { fx.dead = true; return; }
      acc -= dt;
      if (acc > 0) return;
      acc = 0.14;
      if (!fromFn() || !toFn()) return;
      const m = A.lerp(B, Math.random());
      vfx.emit(1, { position: m, spread: 0.1, speed: [0.3, 1], up: [0.2, 0.8], life: [0.25, 0.45], size: [0.3, 0.05], color: 0xffe0a0, color2: 0xa06020, frame: FRAME.SPARK, fadeIn: 0 });
      vfx.emit(1, { position: at(vfx, a, 0.55), spread: 0.15, life: 0.3, size: [0.9, 0.2], color: 0xd9a95c, frame: FRAME.GLOW });
    };
    fx.onEnd = () => { rope.remove(); braid.remove(); for (const d of binds) d.remove(); };
    return fx;
  },

  // Snap of a tether with nothing to bind to.
  tether_lone(vfx, o) {
    const p = at(vfx, o.unit, 0.55), g = vfx.ground(o.unit.position);
    vfx.ring({ position: g, r0: 0.4, r1: 1.7, color: 0xd9a95c, duration: 0.35, opacity: 0.8, tex: vfx.tex.ring });
    vfx.emit(6, { position: p, speed: [1.5, 4], up: [1, 3], life: [0.5, 0.8], size: [0.32, 0.25], color: 0xd9a95c, color2: 0x6a4420, frame: FRAME.RING, gravity: 14, rotSpeed: 6, fadeIn: 0 });
    vfx.emitAlpha(4, { position: V(g.x, g.y + 0.2, g.z), shape: 'disc', radius: 0.5, speed: [0.5, 1.6], up: [0.3, 1], life: [0.5, 0.9], size: [0.6, 1.3], color: DUST, alpha: 0.4, frame: FRAME.SMOKE });
    return null;
  },

  // Wind lane: a pale streak that travels with Piercing Gale's arrow (head at the arrow, tail trailing ~ tail units behind).
  gale_line(vfx, o) {
    const dir = o.direction.clone().setY(0).normalize(), from = o.position.clone();
    const len = o.length ?? 65, speed = o.speed ?? 75, tail = 24;
    const head = from.clone(), back = from.clone();
    const fx = vfx.fx(len / speed + 0.5);
    const beamA = vfx.beam({ fromFn: () => back, toFn: () => head, color: 0xf6e8b0, width: 0.8, duration: Infinity, noise: 0.7, scroll: 6, repeat: 5, core: 0.9, taper: 0.9, points: 12 });
    const beamB = vfx.beam({ fromFn: () => back, toFn: () => head, color: 0xffffff, width: 0.2, duration: Infinity, noise: 0.2, scroll: 0, core: 0.5, taper: 0.9, points: 8, wave: 0.25 });
    const wisp = { position: head, spread: { x: 0.9, y: 0.7, z: 0.9 }, velocity: V(dir.x * 8, 0, dir.z * 8), life: [0.35, 0.6], size: [1.3, 0.3], color: 0xf4ecd0, alpha: 0.25, frame: FRAME.SMOKE, drag: 2, rotSpeed: 2 };
    let trav = 0;
    fx.onUpdate = (dt, t) => {
      trav = Math.min(len, speed * t);
      head.copy(from).addScaledVector(dir, trav);
      back.copy(from).addScaledVector(dir, Math.max(0, trav - tail));
      if (trav < len) vfx.emitAlpha(3, wisp);
    };
    fx.onEnd = () => { beamA.remove(); beamB.remove(); };
    return fx;
  },

  // Impact on each unit pierced: a forward-thrown fan of streaks and a wind puff.
  gale_hit(vfx, o) {
    const u = o.unit, p = o.position ?? at(vfx, u, 0.55);
    const d = o.direction ?? V(0, 0, 1);
    vfx.emit(10, { position: p, dir: d, cone: 0.5, speed: [8, 16], life: [0.12, 0.28], size: [0.6, 0.02], color: 0xffffff, color2: 0xf0c860, frame: FRAME.SPARK, drag: 3, fadeIn: 0 });
    vfx.emit(1, { position: p, life: 0.18, size: [2.2, 0.4], color: 0xfff0b8, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.emitAlpha(4, { position: p, spread: 0.2, velocity: V(d.x * 4, 0, d.z * 4), speed: [0.5, 2], life: [0.3, 0.5], size: [0.7, 1.6], color: 0xf4ecd0, alpha: 0.35, frame: FRAME.SMOKE, drag: 3 });
    vfx.ring({ position: vfx.ground(u ? u.position : p), r0: 0.3, r1: 1.9, color: 0xf6e8b0, duration: 0.3, opacity: 0.8 });
    return null;
  },
};
