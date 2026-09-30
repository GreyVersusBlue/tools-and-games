import * as THREE from 'three';
import { FRAME } from '../textures.js';
import { GEO, addMat, fresnelMat } from '../meshfx.js';

const P = (vfx, o, f = 0.6) => (o.position ? o.position.clone?.() ?? new THREE.Vector3(o.position.x, o.position.y ?? 0, o.position.z) : o.unit ? vfx.unitPoint(o.unit, f) : new THREE.Vector3());
const G = (vfx, o) => { const p = P(vfx, o); return vfx.ground(p); };

export const GENERIC_EFFECTS = {
  hit(vfx, o) {
    const p = P(vfx, o, 0.55);
    const c = o.color ?? 0xffd9a0;
    const n = o.small ? 5 : 10;
    vfx.emit(n, { position: p, spread: 0.1, speed: [3, 7], life: [0.12, 0.3], size: [0.35, 0.05], color: 0xffffff, color2: c, frame: FRAME.SPARK, gravity: 6, drag: 3, fadeIn: 0 });
    vfx.emit(1, { position: p, life: 0.15, size: [o.small ? 0.9 : 1.6, 0.2], color: c, frame: FRAME.FLARE, fadeIn: 0 });
    return null;
  },
  blood(vfx, o) {
    const p = P(vfx, o, 0.55);
    const n = 10 * (o.amount ?? 1);
    vfx.emitAlpha(n, { position: p, spread: 0.2, speed: [1.5, 4.5], up: [1, 3], life: [0.4, 0.8], size: [0.3, 0.15], color: 0x8a0a0a, color2: 0x3a0000, frame: FRAME.GLOW, gravity: 12, drag: 1, fadeIn: 0 });
    vfx.decal({ position: p, radius: 0.5 + 0.3 * (o.amount ?? 1), tex: vfx.tex.scorch, color: 0x990000, additive: false, duration: 3, opacity: 0.8 });
    return null;
  },
  explosion(vfx, o) {
    const p = G(vfx, o);
    const r = o.radius ?? 2.5;
    const c = o.color ?? 0xff8830;
    const up = p.clone(); up.y += 0.8;
    vfx.emit(28, { position: up, spread: r * 0.3, speed: [r * 1.5, r * 3.5], life: [0.3, 0.7], size: [r * 0.9, r * 0.2], color: 0xffeeaa, color2: c, frame: FRAME.GLOW, drag: 4, gravity: -1 });
    vfx.emit(20, { position: up, speed: [4, 10], up: [2, 6], life: [0.4, 0.9], size: [0.25, 0.05], color: 0xffffff, color2: c, frame: FRAME.SPARK, gravity: 10, drag: 1 });
    vfx.emitAlpha(14, { position: up, spread: r * 0.4, speed: [1, 3], up: [1, 2.5], life: [0.8, 1.6], size: [r * 0.7, r * 1.4], color: 0x444040, color2: 0x222222, alpha: 0.6, frame: FRAME.SMOKE, drag: 2, rotSpeed: 1, fadeIn: 0.15 });
    vfx.ring({ position: p, r0: 0.2, r1: r * 1.3, color: c, duration: 0.45 });
    vfx.decal({ position: p, radius: r * 0.8, tex: vfx.tex.scorch, additive: false, color: 0xffffff, duration: 4, opacity: 0.9 });
    vfx.flash(p, c, 40, 0.35, r * 5);
    return null;
  },
  shockwave(vfx, o) {
    return vfx.ring({ position: G(vfx, o), r0: 0.3, r1: o.radius ?? 3, color: o.color ?? 0xffffff, duration: o.duration ?? 0.4 });
  },
  dust(vfx, o) {
    const p = G(vfx, o); p.y += 0.2;
    vfx.emitAlpha(12, { position: p, shape: 'disc', radius: o.radius ?? 0.8, speed: [0.5, 2], up: [0.3, 1.2], life: [0.6, 1.2], size: [0.8, 2], color: 0x8a7a60, color2: 0x5a5040, alpha: 0.55, frame: FRAME.SMOKE, drag: 2, rotSpeed: 1 });
    return null;
  },
  stun(vfx, o) {
    // Stun stars are normally driven by the stun modifier (VFX listens to modifier:added); only attach explicitly
    // when the unit has no stun modifier yet, and never without a duration.
    if (o.unit && !o.unit.hasState?.('stun')) return vfx.attachToUnit(o.unit, 'stun', { ...o, duration: o.duration ?? 1.5 });
    vfx.emit(8, { position: P(vfx, o, 1.1), shape: 'ring', radius: 0.5, life: 0.5, size: [0.4, 0.1], color: 0xffee66, frame: FRAME.FLARE });
    return null;
  },
  heal(vfx, o) {
    const p = o.unit ? o.unit.position.clone() : G(vfx, o);
    const c = o.color ?? 0x55ff88;
    vfx.emit(22, { position: new THREE.Vector3(p.x, p.y + 0.3, p.z), shape: 'disc', radius: 0.9, speed: 0, up: [1.5, 3.2], life: [0.6, 1.1], size: [0.6, 0.1], color: c, color2: 0xeaffee, frame: FRAME.FLARE, fadeIn: 0.2 });
    vfx.ring({ position: p, r0: 0.4, r1: 2.2, color: c, duration: 0.7, tex: vfx.tex.ring });
    if (o.unit) vfx.glow({ position: vfx.unitPoint(o.unit, 0.5), follow: o.unit, yOff: 0.5, size: vfx.unitHeight(o.unit) * 1.4, color: c, duration: 0.6, opacity: 0.55 });
    return null;
  },
  levelup(vfx, o) {
    const u = o.unit;
    const p = u ? u.position.clone() : G(vfx, o);
    vfx.pillar({ position: p, radius: 1.0, height: 6, color: 0xfff0a0, color2: 0xffb020, duration: 1.2, speed: 2.5, expand: 0.2 });
    vfx.ring({ position: p, r0: 0.2, r1: 3, color: 0xffd060, duration: 0.8 });
    vfx.emit(30, { position: new THREE.Vector3(p.x, p.y + 0.3, p.z), shape: 'ring', radius: 1.1, up: [2, 6], life: [0.8, 1.4], size: [0.35, 0.05], color: 0xffffcc, color2: 0xffaa00, frame: FRAME.FLARE, drag: 0.5 });
    vfx.flash(p, 0xffd070, 25, 0.6);
    return null;
  },
  teleport(vfx, o) {
    // Long-lived swirling column (use duration for channel time); returns handle.
    const p = G(vfx, o);
    const dur = o.duration ?? 3;
    const c = o.color ?? 0x66aaff;
    const fx = vfx.fx(dur);
    const d = vfx.decal({ position: p, radius: 2, tex: vfx.tex.rune, color: c, duration: dur, spin: 1.2, opacity: 0.9, fadeOut: 0.1 });
    let acc = 0;
    fx.onUpdate = (dt, t, k) => {
      acc += dt;
      while (acc > 0.03) {
        acc -= 0.03;
        vfx.emit(2, { position: new THREE.Vector3(p.x, p.y + 0.1, p.z), shape: 'ring', radius: 1.6 * (1 - k * 0.5), up: [2, 5], life: [0.5, 0.9], size: [0.4, 0.1], color: 0xffffff, color2: c, frame: FRAME.GLOW });
      }
      if (k > 0.97 && !fx._burst) { fx._burst = true; vfx.flash(p, c, 40, 0.5); vfx.ring({ position: p, r1: 4, color: c, duration: 0.5 }); }
    };
    fx.onEnd = () => d.remove();
    return fx;
  },
  blink(vfx, o) {
    const p = G(vfx, o);
    const c = o.color ?? 0x88aaff;
    const up = p.clone(); up.y += 1.1;
    vfx.emit(22, { position: up, spread: 0.6, speed: o.arrive ? [-3, -1] : [2, 5], life: [0.25, 0.5], size: [0.5, 0.05], color: 0xffffff, color2: c, frame: FRAME.GLOW, drag: 2 });
    vfx.emit(1, { position: up, life: 0.25, size: [3, 0.5], color: c, frame: FRAME.FLARE, fadeIn: 0 });
    vfx.ring({ position: p, r0: o.arrive ? 1.8 : 0.2, r1: o.arrive ? 0.2 : 1.8, color: c, duration: 0.3, ease: 1 });
    return null;
  },
  death(vfx, o) {
    const u = o.unit;
    const p = G(vfx, o);
    if (u?.kind === 'hero') {
      vfx.emit(24, { position: new THREE.Vector3(p.x, p.y + 1, p.z), spread: 0.7, up: [1, 3], life: [0.8, 1.5], size: [0.6, 0.1], color: 0xffffff, color2: 0x6688aa, frame: FRAME.GLOW, drag: 1 });
      vfx.ring({ position: p, r1: 3, color: 0x8899bb, duration: 0.8 });
      GENERIC_EFFECTS.blood(vfx, { position: vfx.unitPoint(u, 0.5), amount: 2 });
    } else {
      vfx.emitAlpha(6, { position: new THREE.Vector3(p.x, p.y + 0.3, p.z), shape: 'disc', radius: 0.5, up: [0.3, 1], life: [0.6, 1], size: [0.8, 1.6], color: 0x6a5a48, alpha: 0.5, frame: FRAME.SMOKE, drag: 1 });
    }
    return null;
  },
  building_explode(vfx, o) {
    const p = G(vfx, o);
    const r = o.radius ?? 5;
    GENERIC_EFFECTS.explosion(vfx, { position: p, radius: r, color: 0xff7a20 });
    // debris chunks + lingering fire/smoke
    vfx.emitAlpha(40, { position: new THREE.Vector3(p.x, p.y + 3, p.z), spread: 2, speed: [3, 9], up: [4, 10], life: [1, 1.8], size: [0.6, 0.4], color: 0x6b5a4a, color2: 0x2a2520, frame: FRAME.CHUNK, gravity: 18, rotSpeed: 6, fadeIn: 0 });
    const fx = vfx.fx(3.5);
    let acc = 0;
    fx.onUpdate = (dt, t, k) => {
      acc += dt;
      while (acc > 0.05) {
        acc -= 0.05;
        vfx.emit(2, { position: new THREE.Vector3(p.x, p.y + 0.5, p.z), shape: 'disc', radius: r * 0.6, up: [2, 4], life: [0.4, 0.8], size: [1.4, 0.3], color: 0xffcc66, color2: 0xff3300, frame: FRAME.GLOW, alpha: 1 - k });
        vfx.emitAlpha(1, { position: new THREE.Vector3(p.x, p.y + 1.5, p.z), shape: 'disc', radius: r * 0.5, up: [2, 4], life: [1.5, 2.5], size: [2, 5], color: 0x333030, alpha: 0.5 * (1 - k), frame: FRAME.SMOKE, rotSpeed: 0.5 });
      }
      if (t > 0.3 && !fx._b2) { fx._b2 = true; GENERIC_EFFECTS.explosion(vfx, { position: new THREE.Vector3(p.x + 1.5, p.y, p.z - 1), radius: r * 0.7 }); }
    };
    return fx;
  },
  move_marker(vfx, o) {
    const p = G(vfx, o);
    const c = o.color ?? 0x44ff66;
    const fx = vfx.fx(0.55, true);
    const mat = fx.own(addMat(c, vfx.tex.chevron, 1));
    const ms = [];
    for (let i = 0; i < 4; i++) {
      const m = fx.add(new THREE.Mesh(GEO.ground, mat));
      m.rotation.y = (i * Math.PI) / 2;
      m.renderOrder = 30;
      ms.push(m);
    }
    const ringFx = vfx.ring({ position: p, r0: 1.0, r1: 0.2, color: c, duration: 0.45, tex: vfx.tex.ring, ease: 1 });
    ringFx.realtime = true;
    fx.onUpdate = (dt, t, k) => {
      const d = 1.1 * (1 - k) + 0.25;
      ms.forEach((m, i) => {
        const a = (i * Math.PI) / 2;
        m.position.set(p.x + Math.sin(a) * d, p.y + 0.1, p.z + Math.cos(a) * d);
        m.rotation.y = a + Math.PI;
        m.scale.set(0.7, 1, 0.7);
      });
      mat.opacity = 1 - k * k;
    };
    fx.onUpdate(0, 0, 0);
    return fx;
  },
  attack_marker(vfx, o) {
    const r = GENERIC_EFFECTS.move_marker(vfx, { ...o, color: o.color ?? 0xff3322 });
    return r;
  },
  // Persistent until handle.remove() unless duration is given. handle.setPosition(v), handle.setRadius(r), handle.setColor(c)
  aoe_indicator(vfx, o) {
    const dur = o.duration ?? Infinity;
    const fx = vfx.fx(dur, true);
    const c = o.color ?? 0x66ccff;
    const mat = fx.own(addMat(c, vfx.tex.rune, 0.55));
    const fill = fx.own(addMat(c, vfx.tex.disc, 0.25));
    const m = fx.add(new THREE.Mesh(GEO.ground, mat));
    const f = fx.add(new THREE.Mesh(GEO.ground, fill));
    m.renderOrder = 31; f.renderOrder = 30;
    let radius = o.radius ?? 3;
    const pos = G(vfx, o);
    const place = () => {
      const y = vfx.groundY(pos.x, pos.z) + 0.12;
      m.position.set(pos.x, y, pos.z); f.position.set(pos.x, y - 0.01, pos.z);
      m.scale.set(radius * 2, 1, radius * 2); f.scale.set(radius * 2, 1, radius * 2);
    };
    place();
    fx.setPosition = (p) => { pos.set(p.x, 0, p.z); place(); };
    fx.setRadius = (r) => { radius = r; place(); };
    fx.setColor = (col) => { mat.color.set(col); fill.color.set(col); };
    fx.setVisible = (v) => { m.visible = f.visible = v; };
    fx.onUpdate = (dt, t) => { m.rotation.y += dt * 0.4; mat.opacity = 0.5 + 0.1 * Math.sin(t * 5); };
    return fx;
  },
  lightning(vfx, o) {
    const to = o.target ? (o.target.position ? vfx.unitPoint(o.target, 0.6) : o.target.clone()) : P(vfx, o);
    const from = o.from ?? (o.source ? vfx.unitPoint(o.source, 0.8) : to.clone().add(new THREE.Vector3(0, 14, 0)));
    const fx = vfx.lightning(from, to, { color: o.color ?? 0xa8dcff, width: o.width ?? 0.2, duration: o.duration ?? 0.3 });
    vfx.emit(12, { position: to, speed: [2, 6], life: [0.15, 0.35], size: [0.3, 0.05], color: 0xffffff, color2: o.color ?? 0x88ccff, frame: FRAME.SPARK, drag: 3 });
    vfx.flash(to, o.color ?? 0x99ccff, 25, 0.25);
    return fx;
  },
  fire(vfx, o) {
    const p = G(vfx, o);
    const r = o.radius ?? 1;
    const dur = o.duration ?? 1.5;
    const fx = vfx.fx(dur);
    let acc = 0;
    fx.onUpdate = (dt, t, k) => {
      acc += dt;
      while (acc > 0.03) {
        acc -= 0.03;
        vfx.emit(2, { position: new THREE.Vector3(p.x, p.y + 0.2, p.z), shape: 'disc', radius: r, up: [1.5, 3.5], life: [0.35, 0.7], size: [0.9 * r, 0.2], color: 0xffdd77, color2: 0xff3300, frame: FRAME.GLOW, alpha: 1 - k * 0.7 });
        if (Math.random() < 0.3) vfx.emitAlpha(1, { position: new THREE.Vector3(p.x, p.y + 1.2, p.z), shape: 'disc', radius: r * 0.5, up: [1, 2], life: [1, 1.6], size: [0.8, 2], color: 0x302a28, alpha: 0.4, frame: FRAME.SMOKE, rotSpeed: 1 });
      }
    };
    return fx;
  },
  fire_hit(vfx, o) {
    const p = P(vfx, o, 0.5);
    vfx.emit(14, { position: p, spread: 0.3, speed: [1, 4], up: [1, 3], life: [0.3, 0.6], size: [0.8, 0.1], color: 0xffee88, color2: 0xff3300, frame: FRAME.GLOW, drag: 2 });
    return null;
  },
  frost(vfx, o) {
    const p = P(vfx, o, 0.6);
    const r = o.radius ?? 1;
    if (r > 4) {
      // Large radius => expanding arctic wave that matches the gameplay radius over `duration` (Frostguard Mail).
      const g = vfx.ground(p), dur = o.duration ?? 0.9;
      vfx.ring({ position: g, r0: 0.5, r1: r, color: o.color ?? 0x9fdcff, duration: dur, ease: 1, hold: 0.7, tex: vfx.tex.shock, opacity: 0.9 });
      vfx.ring({ position: g, r0: 0.3, r1: r * 0.97, color: 0xffffff, duration: dur, ease: 1, hold: 0.6, tex: vfx.tex.ring, opacity: 0.5 });
      const fx = vfx.fx(dur);
      fx.onUpdate = (dt, t, k) => {
        const rr = 0.5 + (r - 0.5) * k;
        vfx.emit(6, { position: new THREE.Vector3(g.x, g.y + 0.6, g.z), shape: 'ring', radius: rr, spread: { x: 0.3, y: 0.8, z: 0.3 }, up: [0.5, 2], life: [0.4, 0.7], size: [0.5, 0.05], color: 0xffffff, color2: 0x66bbff, frame: FRAME.FLAKE, rotSpeed: 3 });
      };
      vfx.flash(g, 0x88ccff, 30, 0.4);
      return fx;
    }
    vfx.emit(o.small ? 8 : 18, { position: p, spread: 0.3 * r, speed: [1, 3.5 * r], life: [0.4, 0.8], size: [0.35, 0.1], color: 0xffffff, color2: 0x66bbff, frame: FRAME.FLAKE, rotSpeed: 3, drag: 2, gravity: 1 });
    vfx.emit(1, { position: p, life: 0.3, size: [2 * r, 0.5], color: 0x88ccff, frame: FRAME.GLOW, fadeIn: 0 });
    return null;
  },
  poison(vfx, o) {
    const p = P(vfx, o, 0.4);
    vfx.emitAlpha(10, { position: p, spread: 0.5, speed: [0.3, 1], up: [0.3, 0.9], life: [0.8, 1.4], size: [0.8, 1.8], color: 0x7acc30, color2: 0x3a5a10, alpha: 0.5, frame: FRAME.SMOKE, rotSpeed: 1 });
    return null;
  },
  shield(vfx, o) {
    if (o.unit) return vfx.attachToUnit(o.unit, 'shield', { ...o, duration: o.duration ?? 3 });
    const p = G(vfx, o);
    vfx.ring({ position: p, r0: 0.5, r1: o.radius ?? 4, color: o.color ?? 0xffe080, duration: 0.6 });
    return null;
  },
  spawn(vfx, o) {
    const p = G(vfx, o);
    const c = o.color ?? 0xffffff;
    vfx.ring({ position: p, r0: 0.2, r1: 2.2, color: c, duration: 0.6 });
    vfx.emit(20, { position: new THREE.Vector3(p.x, p.y + 0.2, p.z), shape: 'ring', radius: 0.8, up: [2, 5], life: [0.5, 1], size: [0.4, 0.05], color: 0xffffff, color2: c, frame: FRAME.FLARE });
    vfx.glow({ position: new THREE.Vector3(p.x, p.y + 1, p.z), size: 3, color: c, duration: 0.5 });
    return null;
  },
  gold(vfx, o) {
    const p = P(vfx, o, 1.0);
    vfx.emit(10, { position: p, spread: 0.2, speed: [1, 2.5], up: [2, 4], life: [0.5, 0.8], size: [0.3, 0.1], color: 0xffe066, color2: 0xffaa00, frame: FRAME.FLARE, gravity: 8 });
    if (o.amount) vfx.floatingText('+' + Math.round(o.amount), p, { color: '#ffd700', size: 0.8 });
    return null;
  },
  crit(vfx, o) {
    const p = o.unit ? vfx.unitPoint(o.unit, 0.6) : P(vfx, o);
    if (o.unit) o.unit.data._critFxFrame = vfx.game.frame;
    if (o.source?.position) {
      // Slash streak across the target, oriented along the attack direction
      const dir = new THREE.Vector3(p.x - o.source.position.x, 0, p.z - o.source.position.z).normalize();
      const fx = vfx.fx(0.22);
      const mat = fx.own(addMat(o.color ?? 0xff4422, null, 1));
      const m = fx.add(new THREE.Mesh(GEO.arc, mat));
      m.position.copy(p);
      m.rotation.set(0, Math.atan2(dir.x, dir.z), 0.9);
      fx.onUpdate = (dt, t, k) => { const s = 2.2 * (0.7 + 0.5 * k); m.scale.set(s, 1, s); mat.opacity = (1 - k) * 0.95; };
      fx.onUpdate(0, 0, 0);
    }
    const c = o.color ?? 0xff4422;
    vfx.emit(18, { position: p, speed: [4, 9], life: [0.15, 0.35], size: [0.5, 0.05], color: 0xffffff, color2: c, frame: FRAME.SPARK, drag: 4, fadeIn: 0 });
    vfx.emit(1, { position: p, life: 0.2, size: [3, 0.5], color: c, frame: FRAME.FLARE, fadeIn: 0 });
    // (crit numbers are popped by the HUD's damage text; no duplicate floating text here)
    return null;
  },
  smoke(vfx, o) {
    const p = G(vfx, o);
    const r = o.radius ?? 6;
    vfx.emitAlpha(60, { position: new THREE.Vector3(p.x, p.y + 0.8, p.z), shape: 'disc', radius: r * 0.5, speed: [r * 0.5, r * 1.1], up: [0.2, 1], life: [2, 3.5], size: [3, 6], color: 0x6a6a70, color2: 0x3a3a40, alpha: 0.6, frame: FRAME.SMOKE, drag: 1.5, rotSpeed: 0.5, fadeIn: 0.15 });
    vfx.ring({ position: p, r1: r, color: 0x9a9aa0, duration: 0.6, additive: false, opacity: 0.5 });
    return null;
  },
  mana(vfx, o) {
    const p = o.unit ? o.unit.position.clone() : G(vfx, o);
    const c = o.color ?? 0x4a8cff;
    vfx.emit(22, { position: new THREE.Vector3(p.x, p.y + 0.3, p.z), shape: 'disc', radius: 0.9, up: [1.5, 3.2], life: [0.6, 1.1], size: [0.6, 0.1], color: c, color2: 0xe0ecff, frame: FRAME.FLARE, fadeIn: 0.2 });
    vfx.ring({ position: p, r0: 0.4, r1: 2.2, color: c, duration: 0.7, tex: vfx.tex.ring });
    if (o.radius > 4) vfx.ring({ position: p, r0: 1, r1: Math.min(o.radius, 30), color: c, duration: 0.8, opacity: 0.6 });
    if (o.unit) vfx.glow({ position: vfx.unitPoint(o.unit, 0.5), follow: o.unit, yOff: 0.5, size: vfx.unitHeight(o.unit) * 1.4, color: c, duration: 0.6, opacity: 0.55 });
    return null;
  },
  force(vfx, o) {
    const u = o.unit;
    const p = u ? u.position.clone() : G(vfx, o);
    vfx.ring({ position: p, r1: 2, color: 0x9ad0ff, duration: 0.3 });
    if (u) {
      const fx = vfx.fx(o.duration ?? 0.45);
      fx.onUpdate = () => {
        vfx.emit(3, { position: vfx.unitPoint(u, 0.4), spread: 0.5, life: [0.3, 0.5], size: [0.6, 0.1], color: 0xcfe8ff, color2: 0x4a8cff, frame: FRAME.GLOW });
        vfx.emitAlpha(1, { position: vfx.unitPoint(u, 0.2), spread: 0.4, life: 0.6, size: [0.8, 1.6], color: 0xdde8f0, alpha: 0.4, frame: FRAME.SMOKE });
      };
      return fx;
    }
    return null;
  },
  refresh(vfx, o) {
    const p = o.unit ? o.unit.position.clone() : G(vfx, o);
    vfx.pillar({ position: p, radius: 1.2, height: 6, color: 0xbfe8ff, color2: 0x2a7aff, duration: 0.9, speed: 3 });
    vfx.ring({ position: p, r1: 4, color: 0x66bbff, duration: 0.6 });
    vfx.emit(30, { position: new THREE.Vector3(p.x, p.y + 0.3, p.z), shape: 'ring', radius: 1.2, up: [3, 6], life: [0.6, 1], size: [0.35, 0.05], color: 0xffffff, color2: 0x55aaff, frame: FRAME.FLARE });
    vfx.flash(p, 0x66bbff, 40, 0.5);
    return null;
  },
  lifesteal(vfx, o) {
    const p = P(vfx, o, 0.6);
    vfx.emit(8, { position: p, spread: 0.4, up: [0.5, 1.5], life: [0.4, 0.7], size: [0.35, 0.05], color: 0xff5566, color2: 0x880011, frame: FRAME.GLOW });
    return null;
  },
  cyclone(vfx, o) { return o.unit ? vfx.attachToUnit(o.unit, 'cyclone', o) : GENERIC_EFFECTS.smoke(vfx, { ...o, radius: 2 }); },
  unbreakable(vfx, o) {
    if (!o.unit) return null;
    vfx.pillar({ position: o.unit.position.clone(), radius: 1, height: 5, color: 0xfff0a0, color2: 0xffa020, duration: 0.6, speed: 3 });
    return vfx.attachToUnit(o.unit, 'unbreakable', o);
  },
  // Persistent (until handle.remove()) when a unit is given — caller owns the handle.
  pyre_brand(vfx, o) { return o.unit ? vfx.attachToUnit(o.unit, 'pyre_brand', o) : GENERIC_EFFECTS.fire(vfx, o); },
  silence(vfx, o) {
    if (!o.unit) return null;
    vfx.emit(12, { position: vfx.unitPoint(o.unit, 1.0), spread: 0.4, speed: [1, 3], life: 0.4, size: [0.4, 0.05], color: o.color ?? 0xc080ff, frame: FRAME.FLARE });
    // persistent icon comes from the silence modifier; attach only if none exists
    return o.unit.hasState?.('silence') ? null : vfx.attachToUnit(o.unit, 'silence', { ...o, duration: o.duration ?? 2 });
  },
  morph(vfx, o) {
    if (!o.unit) return null;
    vfx.emitAlpha(16, { position: vfx.unitPoint(o.unit, 0.5), spread: 0.6, speed: [0.5, 2], life: [0.5, 0.9], size: [1, 2], color: 0xb0e090, alpha: 0.7, frame: FRAME.SMOKE });
    return o.unit.hasState?.('morph') ? null : vfx.attachToUnit(o.unit, 'morph', { ...o, duration: o.duration ?? 3 });
  },
  energy_orb(vfx, o) {
    const fx = vfx.fx(o.duration ?? 1);
    const mat = fx.own(fresnelMat(vfx, o.color ?? 0x66ccff));
    const m = fx.add(new THREE.Mesh(GEO.sphere, mat));
    m.position.copy(P(vfx, o));
    fx.onUpdate = (dt, t, k) => { m.scale.setScalar((o.radius ?? 1) * (0.5 + k)); mat.uniforms.uOpacity.value = 1 - k; mat.uniforms.uTime.value = t; };
    return fx;
  },
};
