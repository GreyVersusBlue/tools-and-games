import * as THREE from 'three';
import { makeParticleAtlas, makeTextures, makeTextSprite, FRAME } from './textures.js';
import { ParticleSystem } from './Particles.js';
import { Fx, GEO, initGeometries, addMat, normMat, beamMat, fireMat, fresnelMat, Ribbon, jaggedPath } from './meshfx.js';
import { GENERIC_EFFECTS } from './effects/generic.js';
import { ABILITY_EFFECTS } from './effects/abilities.js';
import { ATTACHMENTS } from './effects/attachments.js';
import { ONDUR_LIORA_EFFECTS } from './effects/ondur_liora.js';
import { RUNE_EFFECTS, RUNE_ATTACH } from './effects/runes.js';
import { createProjectileVisual, projectileImpact } from './effects/projectiles.js';

// VFX system — see ARCHITECTURE.md "VFX contract".
//  spawn(name, {position, target, unit, source, radius, color, duration, direction}) -> handle {remove(), ...}
//  createProjectile(kind, {source, isAttack}) -> {object, update(dt), dispose()}
//  projectileImpact(kind, pos), floatingText(text, pos, {color, size}), attachToUnit(unit, name, opts) -> handle
// Everything is pooled into 2 particle draw calls (additive + alpha) plus short-lived meshes that share geometry.
export class VFX {
  constructor(game) {
    this.game = game;
    this.effects = [];
    this.modFx = new Map(); // modifier -> attachment handle
    this.enabled = true;
    this.quality = 1; // 0.5 = fewer particles
    this.lightScale = 0.45; // global multiplier for flash lights (bloom-friendly)
    this.FRAME = FRAME;
    this.GEO = GEO;
    this._ready = false;
    this._lights = [];
    this._hitThrottle = 0;
  }

  async init() {
    const g = this.game;
    initGeometries();
    this.atlas = makeParticleAtlas();
    this.tex = makeTextures();
    this.root = new THREE.Group();
    this.root.name = 'vfx';
    g.scene.add(this.root);
    this.add = new ParticleSystem(this.root, this.atlas, { max: 9000, additive: true, renderOrder: 20 });
    this.alpha = new ParticleSystem(this.root, this.atlas, { max: 3500, additive: false, renderOrder: 19 });
    // Fixed pool of flash lights (constant light count => no shader recompiles)
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.castShadow = false;
      l.userData.t = 0; l.userData.dur = 0; l.userData.i0 = 0;
      this.root.add(l);
      this._lights.push(l);
    }
    this.sharedMats = {};
    this.registry = { ...GENERIC_EFFECTS, ...ABILITY_EFFECTS, ...ONDUR_LIORA_EFFECTS, ...RUNE_EFFECTS };
    this.attachments = { ...ATTACHMENTS, ...RUNE_ATTACH };
    this.hookBus();
    this._ready = true;
  }

  onMatchStart() {}

  // ------------------------------------------------------------------------------------------
  // Public contract
  // ------------------------------------------------------------------------------------------
  spawn(name, opts = {}) {
    if (!this._ready || !this.enabled) return null;
    try {
      const fn = this.registry[name];
      if (fn) return fn(this, opts) ?? null;
      if (this.attachments[name] && opts.unit) return this.attachToUnit(opts.unit, name, opts);
      // Unknown: generic colored burst so callers still get feedback
      return this.registry.hit(this, { ...opts, color: opts.color ?? 0xffffff });
    } catch (e) {
      console.warn('[vfx] spawn failed', name, e);
      return null;
    }
  }

  attachToUnit(unit, name, opts = {}) {
    if (!this._ready || !unit) return null;
    const make = this.attachments[name];
    if (!make) return null;
    try {
      const fx = this.fx(opts.duration ?? Infinity);
      fx.unit = unit;
      make(this, fx, unit, opts);
      const inner = fx.onUpdate;
      fx.onUpdate = (dt, t, k) => {
        if (!unit.alive && !opts.keepOnDeath) { fx.dead = true; return; }
        if (unit.object && !unit.object.parent) { fx.dead = true; return; }
        inner?.(dt, t, k);
      };
      return fx;
    } catch (e) {
      console.warn('[vfx] attach failed', name, e);
      return null;
    }
  }

  createProjectile(kind, opts = {}) {
    if (!this._ready) return null;
    try { return createProjectileVisual(this, kind, opts); } catch (e) { console.warn('[vfx] projectile', kind, e); return null; }
  }

  projectileImpact(kind, pos, p) {
    if (!this._ready || !pos) return;
    try { projectileImpact(this, kind, pos, p); } catch (e) { console.warn('[vfx] impact', kind, e); }
  }

  floatingText(text, position, { color = '#ffffff', size = 1, duration = 1.1, rise = 2.2 } = {}) {
    if (!this._ready || !position) return null;
    const { texture, aspect } = makeTextSprite(String(text), { color: typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color, size: 64 });
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.renderOrder = 50;
    const h = 0.9 * size;
    s.scale.set(h * aspect, h, 1);
    s.position.copy(position);
    const fx = this.fx(duration, true);
    fx.add(s);
    fx.own(mat, texture);
    const y0 = position.y;
    const drift = (Math.random() - 0.5) * 0.8;
    fx.onUpdate = (dt, t, k) => {
      s.position.y = y0 + rise * (1 - (1 - k) * (1 - k));
      s.position.x += drift * dt;
      const pop = k < 0.12 ? 1 + (0.12 - k) * 5 : 1;
      s.scale.set(h * aspect * pop, h * pop, 1);
      mat.opacity = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
    };
    return fx;
  }

  update(dt, rawDt) {
    if (!this._ready) return;
    const g = this.game;
    const r = g.renderer;
    const vh = r ? r.domElement.height / (r.getPixelRatio?.() ?? 1) * (r.getPixelRatio?.() ?? 1) : 720;
    const edt = dt;
    const rdt = rawDt ?? dt;
    // effects
    if (this.effects.length) {
      let w = 0;
      for (let i = 0; i < this.effects.length; i++) {
        const fx = this.effects[i];
        const alive = fx.tick(fx.realtime ? rdt : edt);
        if (alive) this.effects[w++] = fx;
        else fx.dispose();
      }
      this.effects.length = w;
    }
    this.add.update(edt, g.camera, vh);
    this.alpha.update(edt, g.camera, vh);
    for (const l of this._lights) {
      if (l.userData.dur <= 0) continue;
      l.userData.t += edt;
      const k = l.userData.t / l.userData.dur;
      if (k >= 1) { l.intensity = 0; l.userData.dur = 0; } else l.intensity = l.userData.i0 * (1 - k) * (1 - k);
    }
    this._hitThrottle = Math.max(0, this._hitThrottle - edt * 60);
    // hit-stop recovery runs on real (unscaled) time
    if (this._hsCooldown > 0) this._hsCooldown -= rdt;
    if (this._hs) {
      this._hs.t -= rdt;
      if (this._hs.t <= 0 || g.fixedDt) {
        if (g.timeScale === this._hs.set) g.timeScale = this._hs.prev;
        this._hs = null;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Helpers used by effect modules
  // ------------------------------------------------------------------------------------------
  fx(duration = 1, realtime = false) {
    const f = new Fx(this, duration);
    f.realtime = realtime;
    this.effects.push(f);
    return f;
  }
  // Surface height for ground effects: terrain, or the river surface where that is higher (decals stay visible in water).
  groundY(x, z) {
    try {
      const w = this.game.world;
      const h = w?.getHeight?.(x, z) ?? 0;
      const wl = w?.waterLevel;
      return typeof wl === 'number' && h < wl ? wl : h;
    } catch { return 0; }
  }
  unitHeight(u) { return u?.model?.height ?? (u?.kind === 'hero' ? 2.2 : u?.isStructure ? 6 : 1.6); }
  unitPoint(u, f = 0.6) { const p = u.position.clone(); p.y = (u.object?.position.y ?? u.position.y) + this.unitHeight(u) * f; return p; }
  ground(p) { return new THREE.Vector3(p.x, this.groundY(p.x, p.z), p.z); }
  q(n) { return Math.max(1, Math.round(n * this.quality)); }

  // Additive particles
  emit(count, o) { this.add.emit(this.q(count), o); }
  // Alpha-blended particles (smoke, dust, blood)
  emitAlpha(count, o) { this.alpha.emit(this.q(count), o); }

  flash(pos, color = 0xffffff, intensity = 30, duration = 0.3, distance = 14) {
    let best = this._lights[0];
    for (const l of this._lights) if (l.userData.dur <= 0 || l.userData.t / l.userData.dur > best.userData.t / (best.userData.dur || 1)) { best = l; if (l.userData.dur <= 0) break; }
    best.position.set(pos.x, pos.y + 1.5, pos.z);
    best.color.set(color);
    best.distance = distance;
    intensity *= this.lightScale;
    best.userData.i0 = intensity; best.userData.t = 0; best.userData.dur = duration;
    best.intensity = intensity;
  }

  // Expanding / fading ground ring. o: {position, r0, r1, color, duration, tex, opacity, y, ease}
  ring(o) {
    const fx = this.fx(o.duration ?? 0.6);
    const mat = fx.own(o.additive === false ? normMat(o.color ?? 0xffffff, o.tex ?? this.tex.shock, o.opacity ?? 1) : addMat(o.color ?? 0xffffff, o.tex ?? this.tex.shock, o.opacity ?? 1));
    const m = fx.add(new THREE.Mesh(GEO.ground, mat));
    const p = o.position;
    m.position.set(p.x, (o.y ?? this.groundY(p.x, p.z)) + (o.lift ?? 0.08), p.z);
    m.renderOrder = 15;
    const r0 = o.r0 ?? 0.2, r1 = o.r1 ?? 3, op = o.opacity ?? 1;
    const spinRate = o.spin ?? 0;
    fx.onUpdate = (dt, t, k) => {
      const e = 1 - Math.pow(1 - k, o.ease ?? 3);
      const r = r0 + (r1 - r0) * e;
      m.scale.set(r * 2, 1, r * 2);
      m.rotation.y += spinRate * dt;
      mat.opacity = op * (o.hold ? (k < o.hold ? 1 : 1 - (k - o.hold) / (1 - o.hold)) : 1 - k);
    };
    fx.onUpdate(0, 0, 0);
    return fx;
  }

  // Static ground decal that fades out. o: {position, radius, tex, color, duration, additive, fadeIn, rotation, spin}
  decal(o) {
    const fx = this.fx(o.duration ?? 2);
    const mat = fx.own(o.additive === false ? normMat(o.color ?? 0xffffff, o.tex ?? this.tex.scorch, o.opacity ?? 1) : addMat(o.color ?? 0xffffff, o.tex ?? this.tex.disc, o.opacity ?? 1));
    const m = fx.add(new THREE.Mesh(GEO.ground, mat));
    const p = o.position;
    m.position.set(p.x, this.groundY(p.x, p.z) + (o.lift ?? 0.06), p.z);
    m.rotation.y = o.rotation ?? Math.random() * Math.PI * 2;
    m.scale.set(o.radius * 2, 1, o.radius * 2);
    m.renderOrder = o.additive === false ? 5 : 14;
    const op = o.opacity ?? 1, fi = o.fadeIn ?? 0.05, fo = o.fadeOut ?? 0.4;
    fx.onUpdate = (dt, t, k) => {
      m.rotation.y += (o.spin ?? 0) * dt;
      if (o.follow) { m.position.x = o.follow.position.x; m.position.z = o.follow.position.z; m.position.y = this.groundY(m.position.x, m.position.z) + (o.lift ?? 0.06); }
      mat.opacity = op * (k < fi ? k / fi : k > 1 - fo ? (1 - k) / fo : 1);
      if (o.pulse) mat.opacity *= 0.75 + 0.25 * Math.sin(t * o.pulse);
      if (o.grow) { const s = o.radius * 2 * (0.3 + 0.7 * Math.min(1, k / o.grow)); m.scale.set(s, 1, s); }
    };
    fx.mesh = m; fx.mat = mat;
    fx.onUpdate(0, 0, 0);
    return fx;
  }

  // Billboard glow sprite. o: {position, size, color, duration, follow (unit), yOff, pulse, fadeIn}
  glow(o) {
    const fx = this.fx(o.duration ?? 0.4);
    const mat = fx.own(new THREE.SpriteMaterial({ map: this.tex.glow, color: o.color ?? 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: o.opacity ?? 1 }));
    const s = fx.add(new THREE.Sprite(mat));
    s.renderOrder = 21;
    s.position.copy(o.position);
    const size = o.size ?? 2, grow = o.grow ?? 0.3;
    fx.onUpdate = (dt, t, k) => {
      if (o.follow) s.position.copy(this.unitPoint(o.follow, o.yOff ?? 0.6));
      const sc = size * (1 + grow * k);
      s.scale.set(sc, sc, 1);
      const fi = o.fadeIn ?? 0.1;
      mat.opacity = (o.opacity ?? 1) * (k < fi ? k / fi : 1 - (k - fi) / (1 - fi));
    };
    fx.onUpdate(0, 0, 0);
    return fx;
  }

  // Lightning arc between two points, flickering. o: {color, width, duration, segments, amp, branches, from/to getters}
  lightning(a, b, o = {}) {
    const fx = this.fx(o.duration ?? 0.35);
    const color = o.color ?? 0x9fd8ff;
    const mat = fx.own(beamMat(this, color, { noise: 0.2, scroll: 0, core: 1.2 }));
    const glowMat = fx.own(beamMat(this, color, { noise: 0.4, scroll: 0, core: 0 }));
    const seg = o.segments ?? Math.max(6, Math.min(24, Math.round(a.distanceTo(b) * 1.2)));
    const main = new Ribbon(seg + 1, mat), halo = new Ribbon(seg + 1, glowMat);
    fx.own(main, halo);
    fx.add(halo.mesh); fx.add(main.mesh);
    const branches = [];
    const nb = o.branches ?? 2;
    for (let i = 0; i < nb; i++) { const r = new Ribbon(7, mat); fx.own(r); fx.add(r.mesh); branches.push(r); }
    const pts = [], bpts = [];
    let reroll = 0;
    const w = o.width ?? 0.18;
    const amp = o.amp ?? 0.1;
    const cam = this.game.camera;
    const build = () => {
      const A = o.fromFn ? o.fromFn() : a, B = o.toFn ? o.toFn() : b;
      jaggedPath(A, B, seg, amp, pts);
      main.setPoints(pts, (i, u) => w * (1 - u * 0.4), cam);
      halo.setPoints(pts, w * 5, cam);
      for (const br of branches) {
        const si = 1 + Math.floor(Math.random() * (pts.length - 3));
        const start = pts[si];
        const dir = new THREE.Vector3().subVectors(B, A).normalize();
        const end = start.clone().addScaledVector(dir, A.distanceTo(B) * (0.1 + Math.random() * 0.2));
        end.x += (Math.random() - 0.5) * 2; end.y += (Math.random() - 0.5) * 1.5; end.z += (Math.random() - 0.5) * 2;
        jaggedPath(start, end, 6, 0.2, bpts);
        br.setPoints(bpts, (i, u) => w * 0.6 * (1 - u), cam);
      }
    };
    build();
    fx.onUpdate = (dt, t, k) => {
      reroll -= dt;
      if (reroll <= 0) { reroll = o.flicker ?? 0.05; build(); }
      const op = (1 - k) * (0.75 + Math.random() * 0.25);
      mat.uniforms.uOpacity.value = op * 1.2;
      glowMat.uniforms.uOpacity.value = op * 0.35;
    };
    return fx;
  }

  // Beam between two (possibly moving) endpoints. o: {fromFn, toFn, color, width, duration, noise, scroll}
  beam(o) {
    const fx = this.fx(o.duration ?? 0.5);
    const mat = fx.own(beamMat(this, o.color ?? 0xffffff, { noise: o.noise ?? 0.6, scroll: o.scroll ?? 3, repeat: o.repeat ?? 2, core: o.core ?? 1 }));
    const n = o.points ?? 16;
    const rb = new Ribbon(n, mat);
    fx.own(rb); fx.add(rb.mesh);
    const pts = Array.from({ length: n }, () => new THREE.Vector3());
    const cam = this.game.camera;
    const wave = o.wave ?? 0;
    fx.onUpdate = (dt, t, k) => {
      const A = o.fromFn(), B = o.toFn();
      if (!A || !B) { fx.dead = true; return; }
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        pts[i].lerpVectors(A, B, u);
        if (wave) { pts[i].y += Math.sin(u * Math.PI * 3 - t * 12) * wave * Math.sin(u * Math.PI); }
        if (o.sag) pts[i].y -= Math.sin(u * Math.PI) * o.sag;
      }
      const fi = o.fadeIn ?? 0.1;
      const env = Number.isFinite(fx.dur) ? (k < fi ? k / fi : k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1) : 1;
      rb.setPoints(pts, (i, u) => (o.width ?? 0.5) * (o.taper ? 1 - u * o.taper : 1) * (0.6 + 0.4 * env), cam);
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpacity.value = env * (o.opacity ?? 1);
    };
    fx.onUpdate(0, 0, 0);
    fx.ribbon = rb; fx.mat = mat;
    return fx;
  }

  // Fire/energy column. o: {position, radius, height, color, color2, duration, speed, rise}
  pillar(o) {
    const fx = this.fx(o.duration ?? 0.8);
    const mat = fx.own(fireMat(this, o.color ?? 0xffaa33, o.color2 ?? 0xff3300, o.speed ?? 1.5));
    const m = fx.add(new THREE.Mesh(o.cone ? GEO.cone : GEO.cyl, mat));
    const p = o.position;
    m.position.set(p.x, this.groundY(p.x, p.z), p.z);
    m.renderOrder = 16;
    const R = o.radius ?? 1.5, H = o.height ?? 8;
    fx.onUpdate = (dt, t, k) => {
      const up = Math.min(1, k / (o.rise ?? 0.2));
      m.scale.set(R * (1 + k * (o.expand ?? 0.3)), H * (0.2 + 0.8 * up), R * (1 + k * (o.expand ?? 0.3)));
      m.rotation.y += dt * (o.spin ?? 1);
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpacity.value = (o.opacity ?? 1) * (k > 0.55 ? (1 - k) / 0.45 : 1);
    };
    fx.onUpdate(0, 0, 0);
    return fx;
  }

  // Ice/rock shards bursting out of the ground. o: {position, radius, count, color, height, duration, geo, emissive}
  shards(o) {
    const fx = this.fx(o.duration ?? 1.2);
    const mat = fx.own(new THREE.MeshStandardMaterial({
      color: o.color ?? 0xbfe8ff, emissive: o.emissive ?? 0x3a8fd0, emissiveIntensity: o.emissiveIntensity ?? 0.9,
      roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92, flatShading: true,
    }));
    const n = o.count ?? 10;
    const list = [];
    const p = o.position;
    for (let i = 0; i < n; i++) {
      const m = fx.add(new THREE.Mesh(o.geo ?? GEO.spike, mat));
      const a = Math.random() * Math.PI * 2, d = (o.ringOnly ? 0.75 + Math.random() * 0.25 : Math.sqrt(Math.random())) * (o.radius ?? 2);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      m.position.set(x, this.groundY(x, z) - 0.1, z);
      const h = (o.height ?? 1.6) * (0.5 + Math.random() * 0.7);
      const w = (o.width ?? 0.5) * (0.6 + Math.random() * 0.6);
      m.userData.s = new THREE.Vector3(w, h, w);
      m.rotation.set((Math.random() - 0.5) * 0.7 + (o.outward ? Math.cos(a) * 0.4 : 0), Math.random() * 6, (Math.random() - 0.5) * 0.7 + (o.outward ? -Math.sin(a) * 0.4 : 0));
      m.scale.set(0.01, 0.01, 0.01);
      m.castShadow = false;
      list.push(m);
    }
    fx.onUpdate = (dt, t, k) => {
      const up = Math.min(1, k / 0.12);
      const down = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const e = 1 - Math.pow(1 - up, 3);
      for (const m of list) { const s = m.userData.s; m.scale.set(s.x * e * down + 0.001, s.y * e * down + 0.001, s.z * e * down + 0.001); }
      mat.opacity = 0.92 * down;
    };
    fx.onUpdate(0, 0, 0);
    return fx;
  }

  // Afterimage/ghost of a unit's model (tinted, fading). Clones model meshes with a shared additive material.
  ghost(unit, { color = 0xffaa33, duration = 0.5, position, facing } = {}) {
    const src = unit.model?.root ?? unit.object;
    if (!src) return null;
    const fx = this.fx(duration);
    const mat = fx.own(addMat(color, null, 0.6, { side: THREE.FrontSide }));
    const g = new THREE.Group();
    src.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(unit.object.matrixWorld).invert();
    let count = 0;
    src.traverse((o) => {
      if (count > 40) return;
      if (o.isMesh && o.geometry && !o.isSkinnedMesh) {
        const m = new THREE.Mesh(o.geometry, mat);
        m.matrixAutoUpdate = false;
        m.matrix.multiplyMatrices(inv, o.matrixWorld);
        g.add(m);
        count++;
      } else if (o.isSkinnedMesh) {
        // Skinned meshes can't be cheaply frozen; use a glow capsule instead.
        count++;
      }
    });
    if (!g.children.length) {
      const m = new THREE.Mesh(GEO.sphereLow, mat);
      m.scale.set(0.5, this.unitHeight(unit) * 0.5, 0.5);
      m.position.y = this.unitHeight(unit) * 0.5;
      g.add(m);
    }
    const pos = position ?? unit.position;
    g.position.set(pos.x, this.groundY(pos.x, pos.z), pos.z);
    g.rotation.y = facing ?? unit.facing;
    fx.add(g);
    fx.onUpdate = (dt, t, k) => { mat.opacity = 0.6 * (1 - k); };
    return fx;
  }

  mesh(fx, geo, mat, parent) { const m = new THREE.Mesh(geo, mat); fx.add(m, parent); return m; }

  // Caster of the effect being spawned: explicit source, else the hero whose ability:cast fired this very frame
  // (ability effects are spawned synchronously from cast()).
  casterOf(o = {}) {
    if (o.source?.team) return o.source;
    if (o.caster?.team) return o.caster;
    if (this._castHero && this._castFrame === this.game.frame) return this._castHero;
    return null;
  }
  isHostileToPlayer(team) { const pt = this.game.player?.team; return !!(team && pt && team !== pt); }

  // Terrain-draped quad (subdivided, vertices follow the heightfield). Returns mesh; call mesh.userData.redrape(x,z).
  drape(fx, mat, x, z, radius, { lift = 0.08, seg = 14 } = {}) {
    const geo = fx.own(new THREE.PlaneGeometry(2, 2, seg, seg).rotateX(-Math.PI / 2));
    const pos = geo.attributes.position;
    const m = fx.add(new THREE.Mesh(geo, mat));
    m.frustumCulled = false;
    const redrape = (cx, cz) => {
      const y0 = this.groundY(cx, cz);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i), lz = pos.getZ(i);
        pos.setY(i, this.groundY(cx + lx * radius, cz + lz * radius) - y0 + lift);
      }
      pos.needsUpdate = true;
      m.position.set(cx, y0, cz);
      m.userData.cx = cx; m.userData.cz = cz;
    };
    m.scale.set(radius, 1, radius);
    m.userData.redrape = redrape;
    m.userData.uv0 = Float32Array.from(geo.attributes.uv.array);
    redrape(x, z);
    return m;
  }
  // Scale a draped mesh's texture about its centre (s in 0..1 => texture shrunk to s of the radius).
  drapeUvScale(m, s) {
    const uv = m.geometry.attributes.uv, u0 = m.userData.uv0, inv = 1 / Math.max(0.001, s);
    for (let i = 0; i < u0.length; i++) uv.array[i] = 0.5 + (u0[i] - 0.5) * inv;
    uv.needsUpdate = true;
  }

  // Readable spell-area indicator that follows the terrain. Red when the area belongs to an enemy of the player's team,
  // green for allies. o: {position, radius, team | source | caster, duration, delay (countdown fill that closes in on
  // the rim, e.g. Pillar of Flame), follow (unit), flash (short instant-AoE read), opacity}
  areaIndicator(o = {}) {
    const caster = this.casterOf(o);
    const team = o.team ?? caster?.team;
    const hostile = this.isHostileToPlayer(team);
    const color = o.color ?? (!team ? 0xffa040 : hostile ? 0xff2a1a : 0x3cff78);
    const dur = o.duration ?? 1;
    const fx = this.fx(dur);
    const p = o.follow?.position ?? o.position;
    if (!p) return null;
    const R = o.radius ?? 3;
    const lasting = !!o.follow || dur > 2.5;
    const base = (o.opacity ?? 1) * (hostile ? 0.85 : 0.32) * (lasting ? 0.75 : 1);
    const rimMat = fx.own(normMat(color, this.tex.area, base, { depthTest: true }));
    const rim = this.drape(fx, rimMat, p.x, p.z, R);
    rim.renderOrder = 6;
    let fill = null, fillMat = null;
    if (o.delay) {
      fillMat = fx.own(addMat(color, this.tex.disc, hostile ? 0.35 : 0.18));
      fill = this.drape(fx, fillMat, p.x, p.z, R, { lift: 0.1 });
      fill.renderOrder = 7;
    }
    let redrapeT = 0;
    const fi = o.fadeIn ?? 0.08, fo = o.fadeOut ?? (o.flash ? 0.6 : 0.2);
    fx.onUpdate = (dt, t, k) => {
      if (o.follow) {
        const u = o.follow;
        if (!u.alive) { fx.dead = true; return; }
        redrapeT -= dt;
        const dx = u.position.x - rim.userData.cx, dz = u.position.z - rim.userData.cz;
        if (dx * dx + dz * dz > 0.02) {
          if (redrapeT <= 0) { redrapeT = 0.12; rim.userData.redrape(u.position.x, u.position.z); if (fill) fill.userData.redrape(u.position.x, u.position.z); }
          else { rim.position.x = u.position.x; rim.position.z = u.position.z; }
        }
      }
      const env = Number.isFinite(dur) ? (k < fi ? k / fi : k > 1 - fo ? (1 - k) / fo : 1) : Math.min(1, t / 0.15);
      rimMat.opacity = base * env * (o.pulse ? 0.8 + 0.2 * Math.sin(t * o.pulse) : 1);
      if (fill) {
        const c = Math.min(1, t / o.delay);
        if (c < 1 || !fill.userData.full) { this.drapeUvScale(fill, 0.05 + 0.95 * c); fill.userData.full = c >= 1; }
        const after = Math.max(0, t - o.delay);
        fillMat.opacity = (0.2 + 0.35 * c) * env * (hostile ? 1 : 0.5) * Math.max(0, 1 - after / 0.25);
        fill.visible = fillMat.opacity > 0.001;
      }
    };
    fx.onUpdate(0, 0, 0);
    return fx;
  }

  // Distance-scaled camera shake (big ultimates / impacts). Uses CameraController.shake when present.
  shake(pos, intensity = 0.4, duration = 0.4, range = 45) {
    const c = this.game.cameraCtl;
    if (!c?.shake) return;
    const d = pos && c.distanceFromView ? c.distanceFromView(pos) : 0;
    const f = Math.max(0, 1 - d / range);
    if (f > 0.02) c.shake(intensity * f, duration);
  }

  // Short global hit-stop (game.timeScale dip). Skipped under deterministic test stepping (game.fixedDt).
  hitStop(duration = 0.06, scale = 0.08) {
    const g = this.game;
    if (g.fixedDt || this._hsCooldown > 0 || this._hs || g.paused) return;
    const prev = g.timeScale ?? 1;
    g.timeScale = prev * scale;
    this._hs = { t: duration, prev, set: g.timeScale };
    this._hsCooldown = 0.4;
  }

  // Hit feedback on the damaged model: model.flash(color, duration) (Models agent) or an additive hit sprite fallback.
  hitFlash(unit, color = 0xffffff, duration = 0.12) {
    if (!unit?.alive || unit.isStructure || unit.kind === 'ward') return;
    const now = this.game.realTime ?? 0;
    if (now - (unit.data._vfxFlashAt ?? -9) < 0.09) return;
    if (this.game.isOnScreen && !this.game.isOnScreen(unit.position, 3)) return;
    if (!this.game.canSee?.(this.game.player?.team ?? unit.team, unit)) return;
    unit.data._vfxFlashAt = now;
    if (typeof unit.model?.flash === 'function') { try { unit.model.flash(color, duration); return; } catch { /* fall through */ } }
    const h = this.unitHeight(unit);
    this.add.emit(1, { position: this.unitPoint(unit, 0.5), life: duration * 1.3, size: [h * 0.75, h * 0.45], color, frame: FRAME.GLOW, fadeIn: 0 });
  }

  // ------------------------------------------------------------------------------------------
  // Automatic effects from game events
  // ------------------------------------------------------------------------------------------
  hookBus() {
    const bus = this.game.bus;
    this.hookHitFeedback(bus);
    bus.on('modifier:added', ({ unit, modifier: m }) => this.onModifierAdded(unit, m));
    bus.on('modifier:removed', ({ modifier: m }) => {
      const h = this.modFx.get(m);
      if (h) { h.remove(); this.modFx.delete(m); }
    });
    bus.on('unit:died', ({ unit }) => {
      for (const m of unit.modifiers ?? []) { const h = this.modFx.get(m); if (h) { h.remove(); this.modFx.delete(m); } }
      if (unit.isStructure) this.spawn('building_explode', { position: unit.position.clone(), unit });
      else this.spawn('death', { position: unit.position.clone(), unit });
    });
    bus.on('hero:levelUp', ({ hero }) => {
      if (!hero?.alive) return;
      const now = this.game.realTime ?? 0;
      if (now - (hero.data._lvlFxAt ?? -9) < 0.8) return; // multi-level gains show one effect
      hero.data._lvlFxAt = now;
      this.spawn('levelup', { unit: hero, position: hero.position.clone() });
    });
    bus.on('hero:respawn', ({ hero }) => this.spawn('spawn', { unit: hero, position: hero.position.clone(), color: 0xffe9a0 }));
    bus.on('unit:attackLanded', ({ unit, target, crit }) => {
      if (!unit || !target || !unit.isMelee || unit.isStructure) return;
      if (this._hitThrottle > 40) return; // cap melee hit sparks per second under heavy load
      this._hitThrottle += 1;
      const p = this.unitPoint(target, 0.55);
      this.spawn('hit', { position: p, color: crit ? 0xff4422 : unit.kind === 'hero' ? 0xffd9a0 : 0xffcc88, small: unit.kind !== 'hero', source: unit });
    });
    bus.on('rune:picked', ({ type, rune }) => { if (rune?.pos) this.spawn('rune_pickup', { position: rune.pos.clone(), type }); });
    bus.on('rune:activated', ({ hero, type }) => {
      if (!hero?.alive || (this.game.isOnScreen && !this.game.isOnScreen(hero.position, 30))) return;
      this.spawn('rune_activate', { unit: hero, type });
    });
    bus.on('ability:cast', ({ hero, ability }) => {
      this._castHero = hero; this._castFrame = this.game.frame;
      if (!hero?.alive || ability?.isItem || ability?.def?.targetType === 'toggle') return;
      const c = new THREE.Color(hero.def?.color ?? '#ffffff');
      this.emit(10, { position: this.unitPoint(hero, 0.75), spread: 0.35, speed: [0.5, 2], up: [0.5, 1.5], life: [0.3, 0.6], size: [0.6, 0.1], color: c.getHex(), color2: 0xffffff, frame: FRAME.GLOW, drag: 2 });
    });
  }

  hookHitFeedback(bus) {
    const g = this.game;
    // Model flash on every visible hit (white, red on crits / big spell hits).
    bus.on('unit:damaged', ({ unit, source, amount, crit, isAttack, ability }) => {
      if (!unit || !(amount > 0)) return;
      if (!isAttack && !ability) return;
      const big = crit || amount > unit.getStat?.('maxHp') * 0.12;
      this.hitFlash(unit, big ? 0xff3a2a : isAttack ? 0xffffff : 0xffe0d0, big ? 0.16 : 0.1);
    });
    const involved = (a, b) => {
      const ph = g.player?.hero;
      if (a === ph || b === ph) return true;
      return a?.kind === 'hero' && (!g.isOnScreen || g.isOnScreen(a.position, 2));
    };
    bus.on('unit:attackLanded', ({ unit, target, crit }) => {
      if (!crit || !target) return;
      if (target.data?._critFxFrame !== g.frame && (!g.isOnScreen || g.isOnScreen(target.position, 3))) this.spawn('crit', { unit: target, source: unit });
      if (involved(unit, target)) this.hitStop(0.06, 0.08);
    });
    bus.on('item:used', ({ hero, item, target }) => { try { this.itemExtra(hero, item, target); } catch (e) { console.warn('[vfx] item', e); } });
    bus.on('item:bash', ({ unit, target }) => { if (involved(unit, target)) this.hitStop(0.07, 0.06); });
  }

  // Extra feedback for item actives whose gameplay code has no (or too little) visual of its own.
  itemExtra(hero, item, target) {
    if (!hero?.alive || !item?.def) return;
    if (this.game.isOnScreen && !this.game.isOnScreen(hero.position, 30)) return;
    const id = item.def.id, R = item.def.active?.radius ?? item.def.radius;
    const tu = target?.takeDamage ? target : null;
    const chest = (u, f = 0.6) => this.unitPoint(u, f);
    switch (id) {
      case 'bark_ration':
        this.emit(14, { position: chest(hero, 0.4), spread: 0.5, up: [0.5, 1.5], life: [0.6, 1], size: [0.45, 0.05], color: 0x9aff5a, color2: 0x2a8a10, frame: FRAME.FLARE });
        this.spawn('heal', { unit: hero, color: 0x7adf40 });
        break;
      case 'clarity': case 'honeyed_plum':
        this.spawn('mana', { unit: hero, color: id === 'clarity' ? 0x5aa0ff : 0x6ab0ff });
        break;
      case 'bottle':
        this.spawn('heal', { unit: hero, color: 0x60ffc0 });
        this.spawn('mana', { unit: hero, color: 0x5aa0ff });
        break;
      case 'tidecall_boots':
        this.ring({ position: this.ground(hero.position), r0: 1, r1: Math.min(R ?? 30, 30), color: 0x4a8cff, duration: 0.8, opacity: 0.7 });
        break;
      case 'clockwork_mender': case 'keepers_greaves':
        this.ring({ position: this.ground(hero.position), r0: 1, r1: Math.min(R ?? 30, 30), color: 0x66ff88, duration: 0.8, opacity: 0.7 });
        this.pillar({ position: hero.position, radius: 1.2, height: 5, color: 0xbfffc8, color2: 0x20c040, duration: 0.7, speed: 2.5 });
        break;
      case 'surge_boots': case 'frenzy_mask': {
        const c = id === 'surge_boots' ? 0x66ffaa : 0xff3a20;
        this.glow({ position: chest(hero, 0.5), follow: hero, yOff: 0.5, size: this.unitHeight(hero) * 1.6, color: c, duration: 0.6, opacity: 0.6 });
        this.ring({ position: this.ground(hero.position), r0: 0.4, r1: 2.4, color: c, duration: 0.45 });
        this.ghost(hero, { color: c, duration: 0.45 });
        break;
      }
      case 'mirror_mantle':
        this.emit(24, { position: chest(hero, 0.5), speed: [3, 7], life: [0.3, 0.6], size: [0.6, 0.05], color: 0xbfe0ff, color2: 0x3a7aff, frame: FRAME.GLOW, drag: 3 });
        this.ring({ position: this.ground(hero.position), r0: 0.5, r1: 4, color: 0x7ab0ff, duration: 0.5 });
        this.flash(hero.position, 0x7ab0ff, 25, 0.35);
        break;
      case 'hungering_blade':
        this.glow({ position: chest(hero, 0.5), follow: hero, yOff: 0.5, size: this.unitHeight(hero) * 1.8, color: 0xff1a20, duration: 0.8, opacity: 0.7 });
        this.ring({ position: this.ground(hero.position), r0: 3, r1: 0.5, color: 0xff2030, duration: 0.5, ease: 1 });
        break;
      case 'unbroken_standard':
        this.pillar({ position: hero.position, radius: 1.3, height: 6, color: 0xffe080, color2: 0xffa010, duration: 0.7, speed: 2.5 });
        this.ring({ position: this.ground(hero.position), r0: 0.5, r1: 3.5, color: 0xffd040, duration: 0.5 });
        break;
      case 'shimmer_cloak': {
        const u = tu ?? hero;
        this.emit(20, { position: chest(u, 0.5), spread: 0.8, up: [0.3, 1.2], life: [0.6, 1.1], size: [0.45, 0.05], color: 0xe0c8ff, color2: 0x6a40ff, frame: FRAME.FLARE });
        break;
      }
      case 'silencing_bloom': case 'thornbloom': case 'morphing_scythe': case 'whirlwind_scepter': case 'chasm_blade': case 'gilded_gauntlet': {
        if (!tu) break;
        const col = { silencing_bloom: 0xc040c0, thornbloom: 0xff3050, morphing_scythe: 0x9a6aff, whirlwind_scepter: 0xc0f0ff, chasm_blade: 0xff5020, gilded_gauntlet: 0xffd040 }[id];
        const from = () => chest(hero, 0.7), to = () => (tu.alive ? chest(tu, 0.55) : null);
        if (id !== 'chasm_blade') this.beam({ fromFn: from, toFn: to, color: col, width: 0.35, duration: 0.3, noise: 0.5, scroll: 6 });
        const q = chest(tu, 0.55);
        this.emit(1, { position: q, life: 0.25, size: [3, 0.5], color: col, frame: FRAME.FLARE, fadeIn: 0 });
        this.emit(16, { position: q, speed: [3, 7], life: [0.2, 0.45], size: [0.5, 0.05], color: 0xffffff, color2: col, frame: FRAME.SPARK, drag: 3 });
        this.ring({ position: this.ground(tu.position), r0: 0.4, r1: 2.6, color: col, duration: 0.4 });
        if (id === 'chasm_blade') this.shake(tu.position, 0.25, 0.25);
        break;
      }
      case 'thrust_staff':
        this.ring({ position: this.ground((tu ?? hero).position), r0: 0.5, r1: 3, color: 0x9ad0ff, duration: 0.4 });
        break;
    }
  }

  onModifierAdded(unit, m) {
    if (!unit?.alive || !m) return;
    let name = m.vfxName;
    if (name === undefined || name === null) {
      if (m.vfxName === null && 'vfxName' in m) name = null;
      else if (m.stun && !m.noStunVfx) name = 'stun';
      else if (m.silence) name = 'silence';
      else if (m.morph) name = 'morph';
    }
    if (m.stun && name === 'stun' && (m.remaining ?? m.duration ?? 1) < 0.25) return;
    if (!name || !this.attachments[name]) return;
    const h = this.attachToUnit(unit, name, { modifier: m, source: m.source, radius: m.radius });
    if (h) this.modFx.set(m, h);
  }
}

export { THREE, GEO, FRAME, Fx, addMat, normMat, beamMat, fireMat, fresnelMat, Ribbon, jaggedPath };
