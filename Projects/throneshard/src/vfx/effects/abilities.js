import * as THREE from 'three';
import { FRAME } from '../textures.js';
import { GEO, addMat, fresnelMat } from '../meshfx.js';
import { GENERIC_EFFECTS } from './generic.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = (vfx, o, f = 0.6) => (o.position ? o.position.clone() : o.unit ? vfx.unitPoint(o.unit, f) : V(0, 0, 0));
const G = (vfx, o) => vfx.ground(o.position ?? o.unit?.position ?? V(0, 0, 0));
const TP = (vfx, t, f = 0.6) => (t?.position && t.takeDamage ? vfx.unitPoint(t, f) : t?.clone ? t.clone() : null);
const upAt = (p, y) => V(p.x, p.y + y, p.z);

function spinningRing(vfx, center, radius, color, duration = 0.35, spin = 20, tex) {
  const fx = vfx.fx(duration);
  const mat = fx.own(addMat(color, tex ?? vfx.tex.ring, 1));
  const m = fx.add(new THREE.Mesh(GEO.ground, mat));
  m.position.copy(center);
  fx.onUpdate = (dt, t, k) => {
    const r = radius * (0.6 + 0.4 * k);
    m.scale.set(r * 2, 1, r * 2);
    m.rotation.y += spin * dt;
    mat.opacity = 1 - k * k;
  };
  fx.onUpdate(0, 0, 0);
  return fx;
}

function slashArc(vfx, pos, dir, radius, color, duration = 0.22, tilt = 0) {
  const fx = vfx.fx(duration);
  const mat = fx.own(addMat(color, null, 1));
  const m = fx.add(new THREE.Mesh(GEO.arc, mat));
  m.position.copy(pos);
  m.rotation.y = Math.atan2(dir.x, dir.z);
  m.rotation.z = tilt;
  fx.onUpdate = (dt, t, k) => {
    const r = radius * (0.7 + 0.5 * k);
    m.scale.set(r, 1, r);
    mat.opacity = (1 - k) * 0.9;
  };
  fx.onUpdate(0, 0, 0);
  return fx;
}

export const ABILITY_EFFECTS = {
  // ---------------------------------------------------------------- Brakka
  taunting_roar(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 8;
    vfx.ring({ position: p, r0: 0.5, r1: r, color: 0xff2a10, duration: 0.55 });
    vfx.ring({ position: p, r0: 0.3, r1: r * 0.7, color: 0xff8040, duration: 0.4 });
    vfx.decal({ position: p, radius: r * 0.55, tex: vfx.tex.crack, color: 0xff3010, duration: 1.2, opacity: 0.9 });
    vfx.emit(40, { position: upAt(p, 0.4), shape: 'ring', radius: 1, speed: [r * 1.5, r * 2.2], life: [0.3, 0.45], size: [0.6, 0.1], color: 0xffaa66, color2: 0xff1100, frame: FRAME.SPARK, drag: 2 });
    vfx.emitAlpha(16, { position: upAt(p, 0.3), shape: 'ring', radius: 1.2, speed: [3, 6], life: [0.5, 0.9], size: [1, 2.5], color: 0x7a5a40, alpha: 0.5, frame: FRAME.SMOKE, drag: 3 });
    if (o.unit) vfx.glow({ position: vfx.unitPoint(o.unit, 0.8), follow: o.unit, yOff: 0.8, size: 3, color: 0xff2200, duration: 0.6, opacity: 0.6 });
    vfx.areaIndicator({ position: p, radius: r, source: o.unit, duration: 0.7, flash: true });
    vfx.flash(p, 0xff4020, 35, 0.4);
    vfx.shake(p, 0.18, 0.25);
  },
  bloodfever_cast(vfx, o) {
    const p = P(vfx, o, 0.8);
    vfx.emit(20, { position: p, spread: 0.5, speed: [1, 3], life: [0.3, 0.6], size: [0.6, 0.1], color: 0xff6040, color2: 0x800000, frame: FRAME.GLOW, drag: 2 });
  },
  whirling_riposte(vfx, o) {
    const u = o.unit;
    const p = G(vfx, o), r = o.radius ?? 7;
    const c = upAt(p, 1.0);
    spinningRing(vfx, c, r * 0.85, 0xff5530, 0.3, 30);
    spinningRing(vfx, upAt(p, 0.15), r, 0xffaa70, 0.35, -25, vfx.tex.shock);
    vfx.emit(36, { position: c, shape: 'ring', radius: r * 0.5, speed: [6, 10], life: [0.15, 0.3], size: [0.5, 0.05], color: 0xffffff, color2: 0xff4020, frame: FRAME.SPARK, drag: 3 });
    if (u) for (let i = 0; i < 3; i++) {
      const a = u.facing + (i * Math.PI * 2) / 3;
      slashArc(vfx, c, V(Math.sin(a), 0, Math.cos(a)), r * 0.6, 0xff7050, 0.25);
    }
  },
  executioners_cleave(vfx, o) {
    const t = o.unit;
    const p = G(vfx, o);
    const c = t ? vfx.unitPoint(t, 0.6) : upAt(p, 1.2);
    const dir = o.source ? V(c.x - o.source.position.x, 0, c.z - o.source.position.z).normalize() : V(0, 0, 1);
    // huge downward slash
    const fx = vfx.fx(0.45);
    const mat = fx.own(addMat(o.kill ? 0xff2010 : 0xffaa66, null, 1));
    const m = fx.add(new THREE.Mesh(GEO.arc, mat));
    m.position.copy(c);
    m.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    m.rotateX(Math.PI / 2);
    fx.onUpdate = (dt, tt, k) => { const s = 4.2 * (0.6 + 0.6 * k); m.scale.set(s, 1, s); m.position.y = c.y + 1.2 - k * 1.4; mat.opacity = 1 - k; };
    fx.onUpdate(0, 0, 0);
    slashArc(vfx, upAt(p, 0.15), dir, 3.2, o.kill ? 0xff3010 : 0xffb070, 0.35);
    vfx.emit(1, { position: c, life: 0.22, size: [3.5, 0.6], color: o.kill ? 0xff4020 : 0xffcc88, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.emit(24, { position: c, speed: [5, 11], life: [0.15, 0.35], size: [0.6, 0.05], color: 0xffffff, color2: 0xff3010, frame: FRAME.SPARK, drag: 3 });
    if (o.kill) {
      GENERIC_EFFECTS.blood(vfx, { position: c, amount: 4 });
      vfx.emitAlpha(40, { position: c, speed: [2, 6], up: [3, 7], life: [0.6, 1.1], size: [0.35, 0.15], color: 0xa00000, color2: 0x400000, frame: FRAME.GLOW, gravity: 14, fadeIn: 0 });
      vfx.ring({ position: p, r0: 0.5, r1: 7, color: 0xff1a00, duration: 0.7 });
      vfx.decal({ position: p, radius: 2.4, tex: vfx.tex.scorch, additive: false, color: 0xaa0000, duration: 6 });
      vfx.emit(1, { position: c, life: 0.35, size: [7, 1], color: 0xff2200, frame: FRAME.FLARE, fadeIn: 0 });
      vfx.flash(p, 0xff1a00, 60, 0.6);
      vfx.shake(p, 0.5, 0.4);
    }
  },
  speed_boost(vfx, o) { if (o.unit) return vfx.attachToUnit(o.unit, 'speed_boost', o); return null; },

  // ---------------------------------------------------------------- Kenshar
  thousand_cuts_slash(vfx, o) {
    const from = o.position ? o.position.clone() : null;
    const to = o.target ? o.target.clone() : null;
    const h = o.source;
    if (h && from) vfx.ghost(h, { position: from, color: 0xff9a30, duration: 0.45 });
    if (from && to) {
      const a = upAt(vfx.ground(from), 1.1), b = upAt(vfx.ground(to), 1.1);
      vfx.beam({ fromFn: () => a, toFn: () => b, color: 0xffb050, width: 0.5, duration: 0.2, noise: 0.2, scroll: 0, core: 1.5 });
    }
    const t = o.unit;
    if (t) {
      const c = vfx.unitPoint(t, 0.55);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        slashArc(vfx, c, V(Math.sin(a), 0, Math.cos(a)), 2.3, i ? 0xffc060 : 0xffffff, 0.22, (Math.random() - 0.5) * 2.4);
      }
      vfx.ring({ position: vfx.ground(t.position), r0: 0.4, r1: 2.6, color: 0xffa040, duration: 0.25 });
      vfx.emit(18, { position: c, speed: [4, 9], life: [0.12, 0.3], size: [0.45, 0.05], color: 0xffffff, color2: 0xffa030, frame: FRAME.SPARK, drag: 3 });
      vfx.emit(1, { position: c, life: 0.15, size: [3, 0.5], color: 0xffcc66, frame: FRAME.FLARE, fadeIn: 0 });
      vfx.flash(c, 0xffaa40, 25, 0.2);
    }
  },

  // ---------------------------------------------------------------- Isolde
  rime_burst(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 10;
    vfx.ring({ position: p, r0: 0.5, r1: r, color: 0x88d4ff, duration: 0.5 });
    vfx.ring({ position: p, r0: 0.2, r1: r * 0.8, color: 0xffffff, duration: 0.35 });
    vfx.shards({ position: p, radius: r * 0.85, count: 18, height: 2.2, width: 0.7, duration: 1.4, ringOnly: false, outward: true });
    vfx.decal({ position: p, radius: r, tex: vfx.tex.disc, color: 0x5ab0ff, duration: 2.5, opacity: 0.6 });
    vfx.areaIndicator({ position: p, radius: r, duration: 0.9, flash: true });
    vfx.emit(70, { position: upAt(p, 0.5), shape: 'disc', radius: r * 0.3, speed: [r * 0.8, r * 1.8], up: [1, 4], life: [0.5, 1], size: [0.45, 0.1], color: 0xffffff, color2: 0x55aaff, frame: FRAME.FLAKE, rotSpeed: 4, drag: 2.5, gravity: 2 });
    vfx.emitAlpha(20, { position: upAt(p, 0.5), shape: 'disc', radius: r * 0.7, up: [0.3, 1], life: [1, 1.8], size: [2, 4], color: 0xdff0ff, alpha: 0.35, frame: FRAME.SMOKE, rotSpeed: 0.5 });
    vfx.flash(p, 0x66bbff, 40, 0.5, r * 2.5);
  },
  ice_shackles_cast(vfx, o) {
    const p = P(vfx, o, 0.5);
    vfx.emit(30, { position: p, spread: 1, speed: [-3, -1], life: [0.3, 0.5], size: [0.45, 0.1], color: 0xffffff, color2: 0x55aaff, frame: FRAME.FLAKE, rotSpeed: 4 });
    vfx.ring({ position: G(vfx, o), r0: 2, r1: 0.4, color: 0x88ccff, duration: 0.35, ease: 1 });
  },
  blizzard_veil_explosion(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 7;
    vfx.ring({ position: p, r0: 0.3, r1: r * 0.8, color: 0x9fdcff, duration: 0.35 });
    vfx.shards({ position: p, radius: r * 0.35, count: 5, height: 1.8, width: 0.55, duration: 0.8, outward: true });
    vfx.emit(18, { position: upAt(p, 0.6), speed: [2, 6], up: [1, 4], life: [0.35, 0.7], size: [0.4, 0.05], color: 0xffffff, color2: 0x4aa0ff, frame: FRAME.FLAKE, rotSpeed: 4, drag: 2, gravity: 3 });
    vfx.emit(2, { position: upAt(p, 0.8), life: 0.25, size: [r * 0.9, 1], color: 0x88ccff, frame: FRAME.GLOW, fadeIn: 0 });
    // falling ice comet
    vfx.emit(1, { position: upAt(p, 9), velocity: V(0, -36, 0), life: 0.24, size: [1, 0.5], color: 0xeaf8ff, frame: FRAME.CORE, fadeIn: 0 });
  },

  // ---------------------------------------------------------------- Pell
  scattershot(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 11;
    const delay = o.delay ?? 1.2, dur = o.duration ?? 11;
    const fx = vfx.fx(dur);
    let zone = null, acc = 0, acc2 = 0;
    const shell = V(p.x, p.y + 22, p.z);
    const ind = vfx.areaIndicator({ position: p, radius: r, source: o.source, delay, duration: dur, fadeOut: 0.05 });
    fx.onUpdate = (dt, t) => {
      if (t < delay) {
        const k = t / delay;
        shell.y = p.y + 22 * (1 - k * k);
        vfx.emit(3, { position: shell, spread: 0.3, life: 0.35, size: [1.6, 0.2], color: 0xffdd88, color2: 0xff5500, frame: FRAME.GLOW });
        return;
      }
      if (!zone) {
        zone = vfx.decal({ position: p, radius: r, tex: vfx.tex.disc, color: 0xff7a30, duration: dur - delay, opacity: 0.28, fadeOut: 0.1 });
        vfx.ring({ position: p, r0: 0.5, r1: r, color: 0xffaa55, duration: 0.5 });
        GENERIC_EFFECTS.explosion(vfx, { position: p, radius: 2.5, color: 0xffa040 });
      }
      acc += dt * 14; acc2 += dt * 4;
      while (acc >= 1) {
        acc -= 1;
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        const q = V(p.x + Math.cos(a) * d, 0, p.z + Math.sin(a) * d);
        q.y = vfx.groundY(q.x, q.z);
        vfx.emit(1, { position: upAt(q, 10), velocity: V(-2, -45, 1), life: 0.21, size: [0.7, 0.5], color: 0xffe0a0, frame: FRAME.SPARK, rotation: Math.PI / 2, fadeIn: 0 });
        vfx.emit(5, { position: upAt(q, 0.3), speed: [1.5, 4], up: [1, 3], life: [0.15, 0.35], size: [0.3, 0.03], color: 0xffffff, color2: 0xff8a20, frame: FRAME.SPARK, gravity: 8 });
        vfx.emit(1, { position: upAt(q, 0.4), life: 0.15, size: [1.2, 0.2], color: 0xffa040, frame: FRAME.GLOW, fadeIn: 0 });
      }
      while (acc2 >= 1) {
        acc2 -= 1;
        vfx.emitAlpha(1, { position: upAt(p, 0.6), shape: 'disc', radius: r * 0.9, up: [0.3, 0.8], life: [1.2, 2], size: [2, 4], color: 0x6a6258, alpha: 0.35, frame: FRAME.SMOKE, rotSpeed: 0.5 });
      }
    };
    fx.onEnd = () => { zone?.remove(); ind?.remove(); };
    return fx;
  },
  deadeye(vfx, o) {
    const p = P(vfx, o, 0.85);
    GENERIC_EFFECTS.blood(vfx, { position: p, amount: 2 });
    vfx.emit(1, { position: p, life: 0.22, size: [3, 0.4], color: 0xff6a30, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.emit(12, { position: p, speed: [3, 7], life: [0.12, 0.3], size: [0.4, 0.05], color: 0xffffff, color2: 0xff7a30, frame: FRAME.SPARK, drag: 3 });
  },
  final_round_fire(vfx, o) {
    const p = P(vfx, o, 0.7);
    vfx.emit(1, { position: p, life: 0.15, size: [4, 0.5], color: 0xffcc66, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.emit(20, { position: p, speed: [2, 6], life: [0.1, 0.25], size: [0.4, 0.05], color: 0xffffff, color2: 0xffaa30, frame: FRAME.SPARK });
    vfx.emitAlpha(12, { position: p, spread: 0.3, speed: [0.5, 2], up: [0.2, 1], life: [0.8, 1.4], size: [0.8, 2.2], color: 0x888078, alpha: 0.5, frame: FRAME.SMOKE, rotSpeed: 1 });
    vfx.ring({ position: G(vfx, o), r1: 3, color: 0xffaa55, duration: 0.3 });
    vfx.flash(p, 0xffaa40, 40, 0.2);
  },
  final_round_hit(vfx, o) {
    const p = P(vfx, o, 0.6);
    GENERIC_EFFECTS.blood(vfx, { position: p, amount: 3 });
    vfx.emit(30, { position: p, speed: [4, 10], life: [0.2, 0.4], size: [0.5, 0.05], color: 0xffffff, color2: 0xff5020, frame: FRAME.SPARK, drag: 3 });
    vfx.emit(1, { position: p, life: 0.3, size: [5, 0.5], color: 0xff6030, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.ring({ position: vfx.ground(p), r1: 4, color: 0xff5020, duration: 0.4 });
    vfx.flash(p, 0xff5020, 45, 0.35);
  },

  // ---------------------------------------------------------------- Sera
  flame_wave_cast(vfx, o) {
    const p = P(vfx, o, 0.6);
    vfx.emit(1, { position: p, life: 0.25, size: [2.8, 0.8], color: 0xff7a20, frame: FRAME.FLARE, fadeIn: 0 });
    const d = o.direction ?? V(0, 0, 1);
    vfx.emit(24, { position: p, dir: d, cone: 0.5, speed: [8, 16], life: [0.2, 0.4], size: [0.9, 0.2], color: 0xffcc66, color2: 0xff3300, frame: FRAME.GLOW, drag: 3 });
    vfx.flash(p, 0xff6a20, 35, 0.45);
  },
  pillar_of_flame_pre(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 6;
    const dur = o.duration ?? 0.5;
    const d = vfx.decal({ position: p, radius: r, tex: vfx.tex.rune, color: 0xffa040, duration: dur + 0.1, spin: 3, opacity: 1, grow: 0.6, fadeOut: 0.05, lift: 0.14 });
    vfx.areaIndicator({ position: p, radius: r, source: o.source, delay: dur, duration: dur + 0.12, fadeOut: 0.05 });
    const fx = vfx.fx(dur);
    fx.onUpdate = (dt, t, k) => {
      vfx.emit(3, { position: upAt(p, 0.2), shape: 'ring', radius: r * (1 - k * 0.6), up: [0.5, 2], life: 0.3, size: [0.5, 0.1], color: 0xffcc66, color2: 0xff4400, frame: FRAME.GLOW });
    };
    return d;
  },
  pillar_of_flame(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 6;
    vfx.pillar({ position: p, radius: r * 0.75, height: 11, color: 0xffd070, color2: 0xff3000, duration: 0.9, speed: 3, rise: 0.08, expand: 0.25, spin: 2, opacity: 0.75 });
    vfx.pillar({ position: p, radius: r * 0.3, height: 13, color: 0xffffff, color2: 0xffa040, duration: 0.6, speed: 4, rise: 0.05, expand: 0.1, spin: -3, opacity: 0.5 });
    vfx.ring({ position: p, r0: 0.5, r1: r * 1.4, color: 0xff7a20, duration: 0.5 });
    vfx.emit(40, { position: upAt(p, 0.5), shape: 'disc', radius: r * 0.7, up: [6, 16], speed: [0, 2], life: [0.4, 0.9], size: [1.3, 0.2], color: 0xffe080, color2: 0xff2200, frame: FRAME.GLOW, drag: 1.5 });
    vfx.emit(40, { position: upAt(p, 0.5), shape: 'disc', radius: r * 0.5, speed: [4, 9], up: [3, 8], life: [0.5, 1], size: [0.3, 0.05], color: 0xffffff, color2: 0xff8a20, frame: FRAME.SPARK, gravity: 12 });
    vfx.emitAlpha(20, { position: upAt(p, 2), shape: 'disc', radius: r * 0.6, up: [2, 5], life: [1.2, 2], size: [2, 5], color: 0x3a2e28, alpha: 0.45, frame: FRAME.SMOKE, rotSpeed: 0.8 });
    vfx.decal({ position: p, radius: r, tex: vfx.tex.scorch, additive: false, color: 0xffffff, duration: 5 });
    vfx.decal({ position: p, radius: r * 0.9, tex: vfx.tex.crack, color: 0xff5a10, duration: 1.6, opacity: 0.9 });
    vfx.flash(p, 0xff7a20, 60, 0.6, 30);
    vfx.shake(p, 0.3, 0.3);
  },
  sunlance(vfx, o) {
    const h = o.unit ?? o.source, t = o.target;
    if (!h || !t) return null;
    const from = () => vfx.unitPoint(h, 0.65);
    const to = () => vfx.unitPoint(t, 0.55);
    // charge-up flash on Sera
    vfx.emit(1, { position: from(), life: 0.3, size: [4, 1], color: 0xffffff, frame: FRAME.FLARE, fadeIn: 0 });
    for (let i = 0; i < 3; i++) vfx.lightning(from(), to(), { color: i === 0 ? 0xffffff : 0xff5a3a, width: i === 0 ? 0.35 : 0.22, duration: 0.55 + i * 0.1, amp: 0.08 + i * 0.03, branches: 3, fromFn: from, toFn: to });
    vfx.beam({ fromFn: from, toFn: to, color: 0xff3a20, width: 1.8, duration: 0.6, noise: 0.8, scroll: 8, core: 1.3 });
    const p = to();
    const fx = vfx.fx(0.3);
    fx.onUpdate = () => {};
    setTimeoutSafe(vfx, 0.25, () => {
      const q = t.alive ? vfx.unitPoint(t, 0.55) : p;
      vfx.emit(40, { position: q, speed: [5, 12], life: [0.2, 0.45], size: [0.6, 0.05], color: 0xffffff, color2: 0xff3a1a, frame: FRAME.SPARK, drag: 2 });
      vfx.emit(20, { position: q, spread: 0.5, speed: [1, 4], life: [0.4, 0.8], size: [1.4, 0.2], color: 0xff8050, color2: 0xaa0a0a, frame: FRAME.GLOW, drag: 2 });
      vfx.emit(1, { position: q, life: 0.35, size: [7, 1], color: 0xff5530, frame: FRAME.FLARE, fadeIn: 0 });
      vfx.ring({ position: vfx.ground(q), r1: 5, color: 0xff4020, duration: 0.5 });
      vfx.decal({ position: vfx.ground(q), radius: 2, tex: vfx.tex.scorch, additive: false, color: 0xffffff, duration: 4 });
      vfx.flash(q, 0xff4020, 70, 0.5, 25);
      vfx.shake(q, 0.55, 0.45);
    });
    vfx.flash(from(), 0xff6040, 50, 0.6, 25);
    return fx;
  },

  // ---------------------------------------------------------------- Gorrow
  gut_hook(vfx, o) {
    const h = o.unit ?? o.source;
    const fx = vfx.fx(Infinity);
    const chainMat = fx.own(new THREE.MeshStandardMaterial({ color: 0xd8d2c8, metalness: 0.6, roughness: 0.3, emissive: 0x5a4a38, emissiveIntensity: 0.9 }));
    const MAX = 90;
    const links = fx.add(new THREE.InstancedMesh(GEO.torus, chainMat, MAX));
    links.frustumCulled = false;
    fx.own(links);
    links.count = 0;
    const hookMat = fx.own(new THREE.MeshStandardMaterial({ color: 0xd0ccc4, metalness: 0.8, roughness: 0.25, emissive: 0x6a2a20, emissiveIntensity: 0.8 }));
    const hook = fx.add(new THREE.Group());
    hook.scale.setScalar(2.1);
    const curve = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 6, 16, Math.PI * 1.35), hookMat);
    fx.own(curve.geometry);
    curve.rotation.set(0, Math.PI / 2, Math.PI * 0.15);
    const barb = new THREE.Mesh(GEO.spike, hookMat); barb.scale.set(0.3, 0.45, 0.3); barb.position.set(0, 0.45, 0.1); barb.rotation.x = -0.6;
    const shank = new THREE.Mesh(GEO.box, hookMat); shank.scale.set(0.12, 0.12, 0.7); shank.position.set(0, -0.35, -0.35);
    hook.add(curve, barb, shank);
    const head = o.position?.clone() ?? V();
    const dir = o.direction?.clone() ?? V(0, 0, 1);
    let hooked = null, phase = 'out';
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(0.42, 0.42, 0.42), tmp = V(), up = V(0, 1, 0);
    const baseQ = new THREE.Quaternion();
    fx.setHead = (p, ph) => { head.copy(p); phase = ph ?? phase; };
    fx.setHooked = (u) => { hooked = u; };
    fx.onUpdate = (dt, t) => {
      if (!h) return;
      const hand = vfx.unitPoint(h, 0.55);
      const side = V(Math.cos(h.facing), 0, -Math.sin(h.facing));
      hand.addScaledVector(side, 0.5);
      // hook head
      hook.position.copy(head);
      const d = tmp.subVectors(head, hand);
      const len = d.length();
      if (len > 0.01) {
        const yaw = Math.atan2(d.x, d.z);
        hook.rotation.set(0, phase === 'out' ? yaw : yaw + Math.PI, 0);
      }
      // chain links
      const spacing = 0.55;
      const n = Math.min(MAX, Math.floor(len / spacing));
      links.count = n;
      if (len > 0.01) {
        d.divideScalar(len);
        baseQ.setFromUnitVectors(V(0, 0, 1), d);
        for (let i = 0; i < n; i++) {
          const pos = V(hand.x + d.x * spacing * (i + 0.5), hand.y + d.y * spacing * (i + 0.5), hand.z + d.z * spacing * (i + 0.5));
          pos.y += Math.sin((i / Math.max(1, n)) * Math.PI) * -0.25 * (phase === 'back' ? 1 : 0.3);
          q.copy(baseQ).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), (i % 2) * Math.PI / 2));
          q.multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2));
          m4.compose(pos, q, s);
          links.setMatrixAt(i, m4);
        }
        links.instanceMatrix.needsUpdate = true;
      }
      if (phase === 'out') vfx.emit(1, { position: head, spread: 0.15, life: 0.25, size: [0.9, 0.1], color: 0xffe0b0, frame: FRAME.GLOW });
      if (hooked && Math.random() < 0.5) vfx.emitAlpha(1, { position: vfx.unitPoint(hooked, 0.5), spread: 0.3, up: [0, 1], life: 0.5, size: [0.25, 0.1], color: 0x8a0000, gravity: 10, frame: FRAME.GLOW });
    };
    fx.onUpdate(0, 0);
    return fx;
  },
  gut_hook_hit(vfx, o) {
    const p = P(vfx, o, 0.55);
    vfx.emit(20, { position: p, speed: [3, 8], life: [0.15, 0.3], size: [0.4, 0.05], color: 0xffffff, color2: 0xffaa66, frame: FRAME.SPARK, drag: 3 });
    vfx.emit(1, { position: p, life: 0.2, size: [3, 0.5], color: 0xff5530, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.flash(p, 0xff5530, 30, 0.25);
  },
  stitched_hide(vfx, o) {
    const p = G(vfx, o);
    vfx.emit(30, { position: upAt(p, 0.2), shape: 'ring', radius: 1.4, up: [2, 4], life: [0.6, 1], size: [0.8, 0.1], color: 0xccff77, color2: 0xaa2200, frame: FRAME.GLOW });
    vfx.ring({ position: p, r0: 3.5, r1: 0.8, color: 0xaaee55, duration: 0.6, ease: 1 });
    if (o.unit) vfx.glow({ position: vfx.unitPoint(o.unit, 0.6), follow: o.unit, size: 3.2, color: 0x99dd44, duration: 0.6, opacity: 0.7 });
  },

  // ---------------------------------------------------------------- Aldric
  cleave(vfx, o) {
    const u = o.unit;
    const dir = o.direction ?? V(0, 0, 1);
    const base = u ? vfx.ground(u.position) : G(vfx, o);
    const r = (o.radius ?? 7.5) + 1.5;
    slashArc(vfx, upAt(base, 1.0), dir, r * 0.85, 0xffd0a0, 0.22);
    slashArc(vfx, upAt(base, 0.2), dir, r, 0x88bbff, 0.3);
    const t = o.position ?? base;
    vfx.emit(8, { position: upAt(vfx.ground(t), 1), dir, cone: 0.9, speed: [5, 10], life: [0.12, 0.25], size: [0.4, 0.05], color: 0xffffff, color2: 0x88bbff, frame: FRAME.SPARK, drag: 3 });
  },
  thunder_gauntlet_impact(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 6;
    vfx.ring({ position: p, r0: 0.3, r1: r * 1.2, color: 0x66bbff, duration: 0.5 });
    vfx.decal({ position: p, radius: r * 0.8, tex: vfx.tex.crack, color: 0x3a8cff, duration: 1.2 });
    vfx.emit(50, { position: upAt(p, 1), speed: [5, 12], life: [0.2, 0.45], size: [0.45, 0.03], color: 0xffffff, color2: 0x3388ff, frame: FRAME.SPARK, drag: 2 });
    vfx.emit(2, { position: upAt(p, 1), life: 0.35, size: [r * 1.5, 1], color: 0x66aaff, frame: FRAME.GLOW, fadeIn: 0 });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      vfx.lightning(upAt(p, 1), V(p.x + Math.cos(a) * r, p.y + 0.2, p.z + Math.sin(a) * r), { color: 0x88ccff, width: 0.12, duration: 0.3, branches: 1 });
    }
    vfx.flash(p, 0x66aaff, 60, 0.5, 25);
  },
  rally_shout(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 17;
    vfx.ring({ position: p, r0: 0.5, r1: r, color: 0xffc040, duration: 0.7 });
    vfx.ring({ position: p, r0: 0.3, r1: r * 0.5, color: 0xffffff, duration: 0.4 });
    vfx.emit(40, { position: upAt(p, 0.5), shape: 'ring', radius: 1, speed: [6, 12], up: [0.5, 2], life: [0.4, 0.7], size: [0.5, 0.05], color: 0xffe0a0, color2: 0xff9a20, frame: FRAME.FLARE, drag: 2 });
    if (o.unit) vfx.pillar({ position: p, radius: 1.2, height: 5, color: 0xfff0a0, color2: 0xffa020, duration: 0.7, speed: 2 });
    vfx.flash(p, 0xffc040, 40, 0.5);
  },
  titans_might_cast(vfx, o) {
    const p = G(vfx, o);
    vfx.pillar({ position: p, radius: 1.6, height: 9, color: 0xff6a4a, color2: 0xaa0000, duration: 1.0, speed: 2.5 });
    vfx.ring({ position: p, r0: 0.3, r1: 6, color: 0xff2a10, duration: 0.6 });
    vfx.emit(50, { position: upAt(p, 1), shape: 'ring', radius: 0.6, speed: [4, 9], up: [1, 4], life: [0.4, 0.8], size: [0.6, 0.05], color: 0xffaa88, color2: 0xcc0000, frame: FRAME.GLOW, drag: 2 });
    vfx.decal({ position: p, radius: 3, tex: vfx.tex.crack, color: 0xff2010, duration: 1.5 });
    vfx.flash(p, 0xff2a10, 60, 0.8);
  },

  // ---------------------------------------------------------------- Morvane
  grave_frost_impact(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 5;
    vfx.ring({ position: p, r0: 0.3, r1: r, color: 0x7fcfff, duration: 0.45 });
    vfx.shards({ position: p, radius: r * 0.7, count: 12, height: 2.2, width: 0.65, duration: 1.0, outward: true });
    vfx.areaIndicator({ position: p, radius: r, duration: 0.8, flash: true });
    vfx.emit(40, { position: upAt(p, 1), speed: [2, 7], up: [0.5, 2], life: [0.4, 0.8], size: [0.45, 0.05], color: 0xffffff, color2: 0x3a9cff, frame: FRAME.FLAKE, rotSpeed: 4, drag: 2 });
    vfx.emit(1, { position: upAt(p, 1), life: 0.3, size: [r * 1.5, 1], color: 0x66bbff, frame: FRAME.GLOW, fadeIn: 0 });
    vfx.flash(p, 0x66bbff, 40, 0.4);
  },
  frost_pulse(vfx, o) {
    const p = G(vfx, o), r = o.radius ?? 15;
    vfx.ring({ position: p, r0: 1, r1: r, color: 0x5ab0ff, duration: 0.6, opacity: 0.6, tex: vfx.tex.ring });
    vfx.emit(16, { position: upAt(p, 0.4), shape: 'ring', radius: 1, speed: [r * 1.2, r * 1.6], life: [0.5, 0.6], size: [0.35, 0.05], color: 0xdff4ff, frame: FRAME.FLAKE, drag: 1 });
  },
  dread_stare_cast(vfx, o) {
    const p = P(vfx, o, 0.8);
    vfx.emit(1, { position: p, life: 0.3, size: [3, 0.5], color: 0x9a5cff, frame: FRAME.FLARE, fadeIn: 0 });
    if (o.source) vfx.emit(1, { position: vfx.unitPoint(o.source, 0.85), life: 0.3, size: [2.5, 0.5], color: 0x9a5cff, frame: FRAME.FLARE, fadeIn: 0 });
  },
  leaping_cold_hit(vfx, o) {
    const p = P(vfx, o, 0.6);
    vfx.emit(30, { position: p, speed: [3, 8], life: [0.3, 0.6], size: [0.45, 0.05], color: 0xffffff, color2: 0x3a8cff, frame: FRAME.FLAKE, rotSpeed: 5, drag: 2 });
    vfx.emit(1, { position: p, life: 0.3, size: [4, 0.8], color: 0x66bbff, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.ring({ position: vfx.ground(p), r1: 3, color: 0x7fcfff, duration: 0.4 });
    vfx.flash(p, 0x55aaff, 40, 0.3);
  },

  // ---------------------------------------------------------------- Sable
  shadow_step(vfx, o) {
    const from = o.position, to = o.target;
    const h = o.source;
    if (h && from) vfx.ghost(h, { position: from, color: 0xb070ff, duration: 0.5 });
    if (from) GENERIC_EFFECTS.blink(vfx, { position: from, color: 0xa060ff });
    if (to) GENERIC_EFFECTS.blink(vfx, { position: to, color: 0xa060ff, arrive: true });
    if (from && to) {
      const a = upAt(vfx.ground(from), 1), b = upAt(vfx.ground(to), 1);
      vfx.beam({ fromFn: () => a, toFn: () => b, color: 0x9050ff, width: 0.9, duration: 0.3, noise: 0.8, scroll: 6 });
    }
  },
  killing_edge(vfx, o) {
    const t = o.unit;
    if (t) t.data._critFxFrame = vfx.game.frame;
    const p = t ? vfx.unitPoint(t, 0.6) : P(vfx, o);
    const dir = o.direction ?? V(0, 0, 1);
    vfx.emitAlpha(50, { position: p, dir: V(dir.x, 0.35, dir.z).normalize(), cone: 0.6, speed: [4, 11], life: [0.4, 0.8], size: [0.4, 0.15], color: 0xb00000, color2: 0x400000, frame: FRAME.GLOW, gravity: 14, fadeIn: 0 });
    vfx.emit(1, { position: p, life: 0.3, size: [6, 0.8], color: 0xff2010, frame: FRAME.FLARE, fadeIn: 0 });
    slashArc(vfx, p, dir, 3.0, 0xff4030, 0.3, 0.8);
    slashArc(vfx, p, dir, 2.2, 0xffffff, 0.18, -0.6);
    vfx.decal({ position: vfx.ground(p).addScaledVector(dir, 1.2), radius: 1.6, tex: vfx.tex.scorch, additive: false, color: 0xaa0000, duration: 5 });
    vfx.flash(p, 0xff2010, 40, 0.3);
    vfx.shake(p, 0.2, 0.2);
  },

  // ---------------------------------------------------------------- Thalor
  forked_spark(vfx, o) {
    const from = o.position?.clone();
    const to = o.target?.clone?.() ?? (o.unit ? vfx.unitPoint(o.unit) : null);
    if (!from || !to) return null;
    const u = o.unit;
    const fx = vfx.lightning(from, to, { color: 0xbfe6ff, width: 0.26, duration: 0.32, branches: 2, toFn: u ? () => vfx.unitPoint(u, 0.6) : null });
    vfx.emit(10, { position: to, speed: [2, 6], life: [0.12, 0.3], size: [0.3, 0.03], color: 0xffffff, color2: 0x66aaff, frame: FRAME.SPARK });
    vfx.emit(1, { position: to, life: 0.15, size: [2, 0.4], color: 0x99ccff, frame: FRAME.FLARE, fadeIn: 0 });
    return fx;
  },
  skybolt(vfx, o) {
    const p = G(vfx, o);
    const top = V(p.x + (Math.random() - 0.5) * 3, p.y + 26, p.z + (Math.random() - 0.5) * 3);
    vfx.lightning(top, upAt(p, 0.1), { color: 0xbfe6ff, width: 0.45, duration: 0.45, amp: 0.07, branches: 4 });
    vfx.lightning(top, upAt(p, 0.1), { color: 0x6aa8ff, width: 0.25, duration: 0.35, amp: 0.1, branches: 2 });
    vfx.ring({ position: p, r0: 0.3, r1: 4, color: 0x88ccff, duration: 0.4 });
    vfx.decal({ position: p, radius: 1.8, tex: vfx.tex.scorch, additive: false, color: 0xffffff, duration: 4 });
    vfx.emit(30, { position: upAt(p, 0.5), speed: [3, 9], up: [1, 4], life: [0.2, 0.45], size: [0.4, 0.03], color: 0xffffff, color2: 0x5599ff, frame: FRAME.SPARK, gravity: 6 });
    vfx.emitAlpha(8, { position: top, spread: 2, life: [0.8, 1.2], size: [4, 6], color: 0x40485a, alpha: 0.5, frame: FRAME.SMOKE });
    vfx.flash(p, 0x99ccff, 80, 0.35, 30);
  },
  storm_leap(vfx, o) {
    const p = G(vfx, o);
    vfx.ring({ position: p, r0: 0.3, r1: 5, color: 0x9fd8ff, duration: 0.45 });
    vfx.emit(40, { position: upAt(p, 0.3), shape: 'ring', radius: 1, speed: [3, 7], up: [0.5, 2], life: [0.3, 0.6], size: [0.35, 0.03], color: 0xffffff, color2: 0x66aaff, frame: FRAME.SPARK, drag: 2 });
    vfx.emitAlpha(12, { position: upAt(p, 0.3), shape: 'ring', radius: 1, speed: [2, 4], life: [0.6, 1], size: [1, 2.5], color: 0xe0eeff, alpha: 0.4, frame: FRAME.SMOKE, drag: 3 });
    const u = o.unit;
    if (u) {
      const fx = vfx.fx(0.55);
      fx.onUpdate = () => vfx.emit(3, { position: vfx.unitPoint(u, 0.5), spread: 0.4, life: [0.2, 0.4], size: [0.6, 0.1], color: 0xbfe6ff, color2: 0x3a7aff, frame: FRAME.GLOW });
    }
  },
  heavens_verdict_cast(vfx, o) {
    const u = o.unit;
    const p = u ? vfx.unitPoint(u, 1.0) : P(vfx, o);
    for (let i = 0; i < 3; i++) vfx.lightning(p, V(p.x + (Math.random() - 0.5) * 6, p.y + 25, p.z + (Math.random() - 0.5) * 6), { color: 0xbfe6ff, width: 0.3, duration: 0.5, branches: 3 });
    vfx.emit(1, { position: p, life: 0.5, size: [6, 1], color: 0xaaddff, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.ring({ position: G(vfx, o), r1: 6, color: 0x88ccff, duration: 0.6 });
    vfx.flash(p, 0x99ccff, 60, 0.6, 30);
  },
  heavens_verdict(vfx, o) {
    const p = G(vfx, o);
    const top = V(p.x, p.y + 32, p.z);
    vfx.lightning(top, upAt(p, 0.1), { color: 0xe8f6ff, width: 0.5, duration: 0.55, amp: 0.05, branches: 4, segments: 24 });
    vfx.lightning(top, upAt(p, 0.1), { color: 0x6aa8ff, width: 0.3, duration: 0.45, amp: 0.09, branches: 2, segments: 20 });
    vfx.pillar({ position: p, radius: 0.8, height: 16, color: 0xffffff, color2: 0x3a7aff, duration: 0.35, speed: 6, rise: 0.05, opacity: 0.55 });
    vfx.ring({ position: p, r0: 0.3, r1: 7, color: 0x9fd8ff, duration: 0.6 });
    vfx.decal({ position: p, radius: 3, tex: vfx.tex.crack, color: 0x5aa0ff, duration: 1.5 });
    vfx.decal({ position: p, radius: 2.5, tex: vfx.tex.scorch, additive: false, color: 0xffffff, duration: 5 });
    vfx.emit(60, { position: upAt(p, 0.5), speed: [4, 12], up: [2, 6], life: [0.3, 0.7], size: [0.5, 0.03], color: 0xffffff, color2: 0x5599ff, frame: FRAME.SPARK, gravity: 8 });
    vfx.flash(p, 0xaaddff, 80, 0.45, 30);
    vfx.shake(p, 0.6, 0.45, 35);
  },

  // ---------------------------------------------------------------- Vashkar
  stone_spines_hit(vfx, o) {
    const p = G(vfx, o);
    vfx.shards({ position: p, radius: 0.6, count: 5, height: 3.2, width: 0.8, duration: 1.2, color: 0x8a7458, emissive: 0x401a08, emissiveIntensity: 0.3 });
    vfx.emitAlpha(14, { position: upAt(p, 0.3), shape: 'disc', radius: 1, speed: [1, 3], up: [1, 4], life: [0.6, 1.1], size: [0.35, 0.2], color: 0x6a5a48, frame: FRAME.CHUNK, gravity: 12, rotSpeed: 5, fadeIn: 0 });
    GENERIC_EFFECTS.dust(vfx, { position: p, radius: 1.2 });
  },
  morph_poof(vfx, o) {
    const p = P(vfx, o, 0.5);
    vfx.emitAlpha(20, { position: p, spread: 0.8, speed: [1, 3], life: [0.5, 1], size: [1, 2.5], color: 0xa0e070, alpha: 0.7, frame: FRAME.SMOKE, rotSpeed: 2, drag: 2 });
    vfx.emit(16, { position: p, spread: 0.5, speed: [2, 4], life: [0.3, 0.6], size: [0.4, 0.05], color: 0xeeffaa, color2: 0x55aa22, frame: FRAME.FLARE });
  },
  death_mark(vfx, o) {
    const h = o.unit ?? o.source, t = o.target;
    if (!h || !t) return null;
    const from = () => vfx.unitPoint(h, 0.7);
    const to = () => vfx.unitPoint(t, 0.55);
    for (let i = 0; i < 4; i++) vfx.lightning(from(), to(), { color: i === 0 ? 0xe0ffd0 : i % 2 ? 0x44ff44 : 0x10a030, width: i === 0 ? 0.3 : 0.18, duration: 0.5 + i * 0.08, amp: 0.1 + i * 0.04, branches: 2, fromFn: from, toFn: to });
    vfx.beam({ fromFn: from, toFn: to, color: 0x22cc44, width: 1.4, duration: 0.55, noise: 0.9, scroll: 10 });
    vfx.emit(1, { position: from(), life: 0.3, size: [3, 0.5], color: 0x88ff66, frame: FRAME.FLARE, fadeIn: 0 });
    setTimeoutSafe(vfx, 0.25, () => {
      const q = t.alive ? vfx.unitPoint(t, 0.55) : to();
      vfx.emit(40, { position: q, speed: [4, 10], life: [0.3, 0.6], size: [0.8, 0.1], color: 0xaaff88, color2: 0x107a20, frame: FRAME.GLOW, drag: 2 });
      vfx.emitAlpha(20, { position: q, speed: [2, 6], up: [1, 3], life: [0.5, 0.9], size: [0.4, 0.15], color: 0x8a0000, frame: FRAME.GLOW, gravity: 12, fadeIn: 0 });
      vfx.ring({ position: vfx.ground(q), r1: 5, color: 0x44ff44, duration: 0.5 });
      vfx.flash(q, 0x44ff44, 60, 0.5, 25);
      vfx.shake(q, 0.5, 0.4);
    });
    return null;
  },
};

// Game-time delayed callback owned by the VFX system (so effects still pause with the game).
function setTimeoutSafe(vfx, sec, fn) {
  const fx = vfx.fx(sec);
  fx.onEnd = () => { try { fn(); } catch (e) { console.warn('[vfx] delayed', e); } };
  return fx;
}
