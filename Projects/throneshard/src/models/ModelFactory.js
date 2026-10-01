import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTERS, HERO_IDS, CLIP_META, COMBOS } from './configs.js';
import { recolorMaterial, illusionPropMaterial, charMaterial, M, mergeStatic } from './materials.js';
import { buildTower, buildBarracks, buildThroneshard, buildFountain, buildShop, buildWard, buildCatapult } from './structures.js';

const ANIMATED = new Set(['spin', 'spinX', 'orbit', 'bob', 'pulse', 'wheel', 'arm', 'crystal', 'sway', 'water', 'flicker', 'aura', 'body']);

// Models subsystem. See ARCHITECTURE.md "Model contract".
//   create(kind, {team, unit, heroModel}) -> { root, height, play(name, {once, speed, duration}), update(dt), dispose(),
//                                             attachPoint(name), flash(color, duration), attackHitFraction }
//   getPortrait(kind) -> dataURL (cached) of a head-shot render.
// Characters: one skinned mesh + one baked (albedo*AO) atlas per character, built by tools/blender/characters from
// Quaternius Universal Base Characters / Outfits / Bestiary / Medieval Weapons (CC0). All share one 23-bone rig; the
// clips come from a single anims.glb (Universal Animation Library 1+2, CC0). Legacy bases (Fox, Horse) stay for
// wolves / courier. Full credits: public/assets/models/CREDITS.txt.

const ASSET_DIR = 'assets/models/';
const CHAR_DIR = 'chars/';
const LEGACY = { Fox: 'Fox.glb', Horse: 'Horse.glb' };

const STRUCTURES = {
  tower: { build: buildTower, height: 9 },
  barracks_melee: { build: (t) => buildBarracks(t, false), height: 6 },
  barracks_ranged: { build: (t) => buildBarracks(t, true), height: 6.5 },
  throneshard: { build: buildThroneshard, height: 12 },
  fountain: { build: buildFountain, height: 6 },
  shop: { build: buildShop, height: 3.8 },
  ward: { build: buildWard, height: 1.6, small: true },
  creep_siege: { build: buildCatapult, height: 1.8, small: true, vehicle: true },
};

const _v = new THREE.Vector3();
let _instance = null;

function teamKey(team) { return team === 'duskward' ? 'duskward' : team === 'neutral' ? 'neutral' : 'sunward'; }

function enableShadows(obj, receive = false) {
  obj.traverse((o) => {
    if (o.isMesh) {
      const add = o.material?.blending === THREE.AdditiveBlending;
      o.castShadow = !add;
      o.receiveShadow = receive && !add;
    }
  });
}

/** Concatenate clips a+b (same track names; missing tracks hold their last/first value). */
function concatClips(name, parts) {
  const byName = new Map();
  let offset = 0;
  const T = new Map();
  for (const c of parts) for (const t of c.tracks) if (!T.has(t.name)) T.set(t.name, t);
  const out = [];
  for (const [tn, proto] of T) {
    const times = [];
    const values = [];
    const size = proto.getValueSize();
    offset = 0;
    for (const c of parts) {
      const t = c.tracks.find((x) => x.name === tn);
      if (t) {
        for (let i = 0; i < t.times.length; i++) {
          const tt = offset + t.times[i];
          if (times.length && tt <= times[times.length - 1] + 1e-5) continue;
          times.push(tt);
          for (let k = 0; k < size; k++) values.push(t.values[i * size + k]);
        }
      }
      offset += c.duration;
    }
    if (!times.length) continue;
    out.push(new proto.constructor(tn, times, values));
    byName.set(tn, true);
  }
  return new THREE.AnimationClip(name, offset, out);
}

export class ModelFactory {
  constructor(game) {
    this.game = game;
    this.gltfs = {};
    this.rigs = {};
    this.anims = null;
    this.templates = new Map();
    this.portraits = new Map();
    this.clipCache = new Map();
    this.ready = false;
    _instance = this;
  }

  async init(onProgress = () => {}) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const base = ASSET_DIR;
    const jobs = [];
    const rigNames = [...new Set(Object.values(CHARACTERS).map((c) => c.rig).filter(Boolean))];
    jobs.push(['anims', CHAR_DIR + 'anims.glb', (g) => { this.anims = g; }]);
    for (const r of rigNames) jobs.push([r, CHAR_DIR + r + '.glb', (g) => { this.rigs[r] = g; }]);
    const legacyNeeded = new Set(Object.values(CHARACTERS).map((c) => c.base).filter(Boolean));
    for (const n of Object.keys(LEGACY)) if (legacyNeeded.has(n)) jobs.push([n, LEGACY[n], (g) => { this.gltfs[n] = g; }]);
    const prog = new Map(jobs.map((j) => [j[0], 0]));
    const report = () => onProgress(0.9 * ([...prog.values()].reduce((a, b) => a + b, 0) / jobs.length));
    await Promise.all(jobs.map(([n, file, done]) => new Promise((resolve) => {
      loader.load(base + file, (g) => { done(g); prog.set(n, 1); report(); resolve(); },
        (e) => { if (e.total) { prog.set(n, e.loaded / e.total); report(); } },
        (err) => { console.warn('[models] failed to load', n, err?.message ?? err); prog.set(n, 1); report(); resolve(); });
    })));
    this._prepAnims();
    // Pre-build every character + structure template so first spawn doesn't hitch.
    const keys = Object.keys(CHARACTERS);
    keys.forEach((k, i) => {
      try { this._charTemplate(k); } catch (e) { console.warn('[models] template failed', k, e); }
      onProgress(0.9 + 0.08 * ((i + 1) / keys.length));
    });
    for (const k of Object.keys(STRUCTURES)) for (const t of ['sunward', 'duskward']) {
      try { this._structTemplate(k, t); } catch (e) { console.warn('[models] structure failed', k, e); }
    }
    this.ready = true;
    onProgress(1);
  }

  update() {}

  // ------------------------------------------------------------------ public API
  create(kind, opts = {}) {
    try {
      return this._create(kind, opts);
    } catch (e) {
      console.warn('[models] create failed for', kind, e);
      return this._primitive(opts.team);
    }
  }

  getPortrait(kind, opts = {}) {
    kind = this._heroOwn(kind, opts?.heroId ?? opts?.def?.id);
    if (this.portraits.has(kind)) return this.portraits.get(kind);
    try {
      const url = this._renderPortrait(kind);
      if (url) this.portraits.set(kind, url);
      return url;
    } catch (e) {
      console.warn('[models] portrait failed', kind, e);
      return null;
    }
  }

  resolveKind(kind, opts = {}) {
    const u = opts.unit;
    const team = teamKey(opts.team ?? u?.team);
    const sub = u?.subtype;
    let k = kind ?? u?.modelKind ?? 'fallback';
    // Generic unit kinds (Unit.modelKind defaults to unit.kind) → refine by subtype.
    if (k === 'creep') k = 'creep_' + (['melee', 'ranged', 'siege'].includes(sub) ? sub : 'melee');
    else if (k === 'neutral') k = 'neutral_' + (['small', 'medium', 'large', 'elder'].includes(sub) ? sub : 'small');
    else if (k === 'building') k = typeof sub === 'string' ? (sub.startsWith('barracks') || STRUCTURES[sub] ? sub : 'barracks_' + sub) : 'barracks_melee';
    else if (k === 'barracks') k = 'barracks_' + (sub === 'ranged' ? 'ranged' : 'melee');
    else if (k === 'summon') k = typeof sub === 'string' && CHARACTERS['summon_' + sub] ? 'summon_' + sub : 'summon_wolf';
    else if (k === 'hero') k = u?.def?.model ?? u?.heroId ?? 'fallback';
    else if (/ward/.test(k)) k = 'ward';
    else if (/^tower/.test(k)) k = 'tower';
    if (k === 'creep_melee' || k === 'creep_ranged') k = `${k}_${team === 'duskward' ? 'duskward' : 'sunward'}`;
    return k;
  }

  // ------------------------------------------------------------------ internals
  /** A hero whose def still points at a stand-in model (e.g. ondur → 'aldric') gets its own model if we have it. */
  _heroOwn(k, id) {
    return id && id !== k && this._hasRig(id) ? id : k;
  }

  _hasRig(k) { const c = CHARACTERS[k]; return !!(c && ((c.rig && this.rigs[c.rig]) || (c.base && this.gltfs[c.base]))); }

  _create(kind, opts) {
    const team = teamKey(opts.team ?? opts.unit?.team);
    let k = this.resolveKind(kind, opts);
    const u = opts.unit;
    if (u?.kind === 'hero') {
      // def isn't attached yet while Unit's constructor builds the model → derive the id from the hero name too
      const byName = typeof u.name === 'string' ? u.name.toLowerCase().replace(/[^a-z]+/g, '_') : null;
      k = this._heroOwn(k, u.def?.id ?? u.heroId ?? byName);
    }
    if (STRUCTURES[k]) return new StructureModel(this, k, team, opts);
    if (k === 'illusion') {
      const u = opts.unit;
      let hero = opts.heroModel ?? u?.data?.heroModel ?? u?.data?.illusionOf?.def?.model ?? u?.owner?.def?.model ?? u?.def?.model;
      hero = this._heroOwn(hero, u?.data?.heroId ?? u?.data?.illusionOf?.def?.id ?? u?.owner?.def?.id);
      if (!CHARACTERS[hero]) hero = 'fallback';
      return this._character(hero, 'illusion', opts);
    }
    if (CHARACTERS[k]) return this._character(k, 'normal', opts);
    // Unknown hero id → fallback tinted with the hero's colour so it's still distinct.
    const color = opts.unit?.def?.color;
    return this._character('fallback', 'normal', opts, typeof color === 'string' || typeof color === 'number' ? color : null);
  }

  _character(key, variant, opts, color = null) {
    let tpl = this._charTemplate(key, variant, color);
    if (!tpl && key !== 'fallback') tpl = this._charTemplate('fallback', variant, color);
    if (!tpl) return this._primitive(opts.team);
    return new CharacterModel(this, tpl, opts);
  }

  _primitive(team) {
    const root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 4, 8), M.flat(team === 'duskward' ? 0xa03030 : 0x40a050));
    m.position.y = 1.0;
    m.castShadow = true;
    root.add(m);
    return { root, height: 2.1, attackHitFraction: 0.4, play() {}, update() {}, dispose() {}, flash() {}, attachPoint: () => root };
  }

  _structTemplate(kind, team) {
    const key = `S:${kind}:${team}`;
    if (this.templates.has(key)) return this.templates.get(key);
    const g = STRUCTURES[kind].build(team);
    enableShadows(g, !STRUCTURES[kind].small);
    g.traverse((o) => { if (o.isMesh && o.material?.blending !== THREE.AdditiveBlending) o.receiveShadow = true; });
    mergeStatic(g, ANIMATED, mergeGeometries);
    // merge inside animated sub-groups too (their children move together)
    const subs = [];
    g.traverse((o) => { if (o !== g && ANIMATED.has(o.name) && !o.isMesh) subs.push(o); });
    for (const sub of subs) mergeStatic(sub, ANIMATED, mergeGeometries);
    this.templates.set(key, g);
    return g;
  }

  // ------------------------------------------------------------------ animation library
  _prepAnims() {
    this.clipLib = new Map();
    this.animPelvis = 1;
    if (!this.anims) return;
    const pel = this.anims.scene.getObjectByName('pelvis');
    if (pel) this.animPelvis = pel.position.length() || 1;
    for (const c of this.anims.animations) {
      // drop scale tracks (constant 1) and position tracks of anything but pelvis/root → cheaper mixer
      c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || /^(pelvis|root)\./.test(t.name)));
      this.clipLib.set(c.name, c);
    }
    for (const [name, parts] of Object.entries(COMBOS)) {
      const list = parts.map((p) => this.clipLib.get(p)).filter(Boolean);
      if (list.length === parts.length) this.clipLib.set(name, concatClips(name, list));
    }
  }

  /** Clips retargeted to a rig with a given pelvis height (pelvis translation scaled). Cached per ratio. */
  _clipsFor(ratio) {
    const key = ratio.toFixed(3);
    if (this.clipCache.has(key)) return this.clipCache.get(key);
    const map = new Map();
    for (const [name, c] of this.clipLib ?? []) {
      if (Math.abs(ratio - 1) < 0.01) { map.set(name, c); continue; }
      const tracks = c.tracks.map((t) => {
        if (!t.name.startsWith('pelvis.position')) return t;
        const nt = t.clone();
        for (let i = 0; i < nt.values.length; i++) nt.values[i] *= ratio;
        return nt;
      });
      map.set(name, new THREE.AnimationClip(name, c.duration, tracks));
    }
    this.clipCache.set(key, map);
    return map;
  }

  _charTemplate(key, variant = 'normal', color = null) {
    const tkey = `C:${key}:${variant}:${color ?? ''}`;
    if (this.templates.has(tkey)) return this.templates.get(tkey);
    const cfg = CHARACTERS[key];
    let tpl = null;
    if (cfg?.rig && this.rigs[cfg.rig]) tpl = this._rigTemplate(key, cfg, variant, color);
    else if (cfg?.base && this.gltfs[cfg.base]) tpl = this._legacyTemplate(key, cfg, variant, color);
    this.templates.set(tkey, tpl);
    return tpl;
  }

  _rigTemplate(key, cfg, variant, color) {
    const gltf = this.rigs[cfg.rig];
    const illusion = variant === 'illusion';
    const scene = SkeletonUtils.clone(gltf.scene);
    scene.updateMatrixWorld(true);
    const skinned = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const o of skinned) {
      const src = o.material;
      // Blender writes the emissive mask as COLOR_0; the shader reads it as 'glow' (not a diffuse multiplier).
      let geo = o.geometry;
      if (geo.attributes.color && !geo.attributes.glow) {
        geo = geo.clone();
        geo.setAttribute('glow', geo.attributes.color);
        geo.deleteAttribute('color');
        gltf.scene.traverse((x) => { if (x.isSkinnedMesh && x.name === o.name) x.geometry = geo; });
      }
      o.geometry = geo;
      o.material = charMaterial(src.map, {
        glow: !!geo.attributes.glow, variant: illusion ? 'illusion' : 'normal',
        tint: color != null ? new THREE.Color(color).getHex() : cfg.tint ?? null, glowColor: cfg.glowColor ?? null,
      });
      o.frustumCulled = true;
    }
    // size: feet at 0, total height = cfg.height (rest pose bounds incl. hair/helmets)
    const box = new THREE.Box3();
    for (const o of skinned) { o.skeleton.update(); o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    const size = box.getSize(new THREE.Vector3());
    const s = (cfg.height ?? 2.2) / Math.max(1e-6, size.y);
    const content = new THREE.Group();
    content.name = 'content';
    const widen = cfg.widen ?? 1;
    content.scale.set(s * widen, s, s * widen);
    content.position.y = -box.min.y * s;
    content.add(scene);
    content.updateMatrixWorld(true);
    for (const o of skinned) {
      o.geometry.computeBoundingSphere();
      o.boundingSphere = o.geometry.boundingSphere.clone();
      o.boundingSphere.radius *= 1.5;
    }
    // procedural extras (auras) attached at the root
    const rootProps = [];
    for (const p of cfg.props ?? []) {
      const obj = mergeStatic(p.build(), ANIMATED, mergeGeometries);
      if (p.pos) obj.position.set(...p.pos);
      if (illusion) obj.traverse((m) => { if (m.isMesh && m.material?.blending !== THREE.AdditiveBlending) m.material = illusionPropMaterial(); });
      rootProps.push(obj);
    }
    enableShadows(content);
    if (illusion) content.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const pel = scene.getObjectByName('pelvis');
    const ratio = pel ? pel.position.length() / this.animPelvis : 1;
    const clips = this._clipsFor(ratio);
    return { key, cfg, content, clips, height: cfg.height, illusion, rootProps, rig: true };
  }

  // Legacy (KayKit-style) templates: only Fox (wolves) and Horse (courier) still use this path.
  _legacyTemplate(key, cfg, variant, color) {
    const gltf = this.gltfs[cfg.base];
    const illusion = variant === 'illusion';
    const scene = SkeletonUtils.clone(gltf.scene);
    scene.updateMatrixWorld(true);
    const tintRules = color != null ? [['*', new THREE.Color(color).getHex(), 0.7]] : (cfg.tint ?? []);
    const matchRule = (label) => tintRules.find(([m]) => m === '*' || label.includes(m));
    const meshes = [];
    scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const srcMat = Array.isArray(o.material) ? o.material[0] : o.material;
      const rule = matchRule(`${o.name}|${srcMat?.name ?? ''}`);
      const c = new THREE.Color(rule ? rule[1] : 0xffffff);
      const strength = rule ? rule[2] : 0;
      const geo = o.geometry.clone();
      const n = geo.attributes.position.count;
      const arr = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { arr[i * 4] = c.r; arr[i * 4 + 1] = c.g; arr[i * 4 + 2] = c.b; arr[i * 4 + 3] = strength; }
      geo.setAttribute('tint', new THREE.BufferAttribute(arr, 4));
      o.geometry = geo;
      o.material = recolorMaterial(srcMat, illusion ? 'illusion' : 'normal');
    }
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    });
    const size = box.getSize(new THREE.Vector3());
    const s = cfg.height / Math.max(1e-6, size.y);
    const content = new THREE.Group();
    content.name = 'content';
    const widen = cfg.widen ?? 1;
    content.scale.set(s * widen, s, s * widen * (cfg.lengthScale ?? 1));
    content.position.y = -box.min.y * s;
    content.add(scene);
    content.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.geometry.computeBoundingSphere();
        o.boundingSphere = o.geometry.boundingSphere.clone();
        o.boundingSphere.radius *= 1.6;
      }
    });
    const rootProps = [];
    for (const p of cfg.props ?? []) {
      const obj = mergeStatic(p.build(), ANIMATED, mergeGeometries);
      if (p.pos) obj.position.set(...p.pos);
      if (illusion) obj.traverse((m) => { if (m.isMesh && m.material?.blending !== THREE.AdditiveBlending) m.material = illusionPropMaterial(); });
      rootProps.push(obj);
    }
    enableShadows(content);
    if (illusion) content.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const clips = new Map();
    for (const c of gltf.animations) clips.set(c.name, c);
    return { key, cfg, content, clips, height: cfg.height, illusion, rootProps, rig: false };
  }

  // ------------------------------------------------------------------ portraits
  _renderPortrait(kind) {
    if (!this.ready) return null;
    if (!this._pr) {
      const canvas = document.createElement('canvas');
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(256, 256, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.1;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdde8ff, 0x302820, 1.5));
      const key = new THREE.DirectionalLight(0xfff0dd, 2.8); key.position.set(2, 3, 5); scene.add(key);
      const rim = new THREE.DirectionalLight(0x9ab8ff, 3.0); rim.position.set(-3, 2.5, -4); scene.add(rim);
      const bgc = document.createElement('canvas'); bgc.width = bgc.height = 256;
      const g = bgc.getContext('2d');
      const grd = g.createRadialGradient(128, 100, 10, 128, 128, 190);
      grd.addColorStop(0, '#46566e'); grd.addColorStop(1, '#0c1018');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      const bg = new THREE.CanvasTexture(bgc); bg.colorSpace = THREE.SRGBColorSpace;
      scene.background = bg;
      this._pr = { r, scene, cam: new THREE.PerspectiveCamera(30, 1, 0.05, 100) };
    }
    const { r, scene, cam } = this._pr;
    const model = this.create(kind, { team: 'sunward' });
    scene.add(model.root);
    model.play('idle');
    model.update(0.6);
    model.root.updateMatrixWorld(true);
    const head = model.attachPoint?.('head');
    const h = model.height;
    const target = new THREE.Vector3();
    let dist;
    if (head && head !== model.root && !(model instanceof StructureModel)) {
      head.getWorldPosition(target);
      const hs = model.tpl?.cfg?.portraitScale ?? 1;
      dist = h * 0.85 * hs;
      target.y -= h * 0.04 * hs;
    } else {
      target.set(0, h * 0.5, 0);
      dist = h * 2.0;
    }
    cam.position.set(target.x + dist * 0.35, target.y + dist * 0.12, target.z + dist);
    cam.lookAt(target);
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');
    scene.remove(model.root);
    model.dispose();
    return url;
  }
}

// Module-level helpers for the UI.
export function getPortrait(kind) { return _instance?.getPortrait(kind) ?? null; }
export { HERO_IDS };

// ====================================================================== per-instance hit flash
// Materials are shared between instances, so a flash swaps in a lazily-created private clone of each material
// (same shader program → no recompile) for the flash duration, then swaps the shared one back.
class Flasher {
  constructor(root) { this.root = root; this.meshes = null; this.t = 0; this.dur = 0; this.color = new THREE.Color(); }

  start(color, duration) {
    if (!this.meshes) {
      this.meshes = [];
      this.root.traverse((o) => {
        if (!o.isMesh || Array.isArray(o.material) || !o.material?.emissive || o.material.blending === THREE.AdditiveBlending) return;
        const src = o.material;
        const fm = src.clone();
        fm.onBeforeCompile = src.onBeforeCompile;
        fm.customProgramCacheKey = src.customProgramCacheKey;
        fm.userData = { ...src.userData };
        this.meshes.push({ o, src, fm, e0: src.emissive.clone(), i0: src.emissiveIntensity });
      });
    }
    this.color.set(color);
    this.t = 0;
    this.dur = Math.max(0.02, duration);
    for (const m of this.meshes) {
      if (m.o.material === m.src) { m.src = m.o.material; m.o.material = m.fm; }
    }
    this._apply(1);
  }

  _apply(k) {
    for (const m of this.meshes) {
      m.fm.emissive.copy(m.e0).lerp(this.color, k);
      m.fm.emissiveIntensity = m.i0 + (1.6 - m.i0) * k;
    }
  }

  update(dt) {
    if (!this.dur) return;
    this.t += dt;
    const k = 1 - this.t / this.dur;
    if (k <= 0) {
      this.dur = 0;
      for (const m of this.meshes) if (m.o.material === m.fm) m.o.material = m.src;
      return;
    }
    this._apply(k * k);
  }
}

// ====================================================================== Character (skinned/animated)
const ONCE = new Set(['attack', 'cast', 'death']);

class CharacterModel {
  constructor(factory, tpl, opts) {
    this.tpl = tpl;
    this.cfg = tpl.cfg;
    this.unit = opts.unit ?? null;
    this.height = tpl.height;
    this.root = new THREE.Group();
    this.root.name = 'model:' + tpl.key;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.inst = SkeletonUtils.clone(tpl.content);
    this.body.add(this.inst);
    for (const p of tpl.rootProps) this.body.add(p.clone());
    this.mixer = new THREE.AnimationMixer(this.inst);
    this.actions = new Map();
    this.current = null; // looping action
    this.loopName = null;
    this.oneShot = null; // { name, action?, t, dur, done }
    this.pending = null;
    this.dead = false;
    this.deathT = 0;
    this.t = Math.random() * 10;
    this.fx = { flicker: [], spin: [], orbit: [], pulse: [], aura: [] };
    this.body.traverse((o) => { if (this.fx[o.name]) this.fx[o.name].push(o); });
    this.bones = {};
    this.flasher = new Flasher(this.inst);
    this._nextAttack = null;
    this._pickAttack();
    this.play('idle');
    if (this.current) this.current.time = Math.random() * this.current.getClip().duration;
  }

  /** Fraction (0..1) of the next attack swing at which the weapon visually connects. */
  get attackHitFraction() { return this._nextAttack?.hit ?? this.cfg.hitFrac ?? 0.4; }

  flash(color = 0xffffff, duration = 0.12) {
    try { this.flasher.start(color, duration); } catch (e) { /* never throw from combat code */ }
  }

  _spec(spec) {
    if (!spec) return null;
    const clipName = typeof spec === 'string' ? spec : spec.clip;
    const clip = this.tpl.clips.get(clipName);
    if (!clip) return null;
    const meta = CLIP_META[clipName] ?? {};
    return {
      clip, speed: typeof spec === 'object' ? spec.speed ?? 1 : 1,
      hit: (typeof spec === 'object' ? spec.hit : undefined) ?? meta.hit ?? this.cfg.hitFrac ?? 0.4,
    };
  }

  _pickAttack() {
    let spec = this.cfg.anims?.attack;
    if (Array.isArray(spec)) spec = spec[Math.floor(Math.random() * spec.length)];
    this._nextAttack = this._spec(spec);
  }

  _resolve(name) {
    if (name === 'attack') return this._nextAttack;
    let spec = this.cfg.anims?.[name];
    if (spec === undefined && name === 'walk') spec = this.cfg.anims?.run;
    if (Array.isArray(spec)) spec = spec[Math.floor(Math.random() * spec.length)];
    return this._spec(spec);
  }

  _action(clip) {
    let a = this.actions.get(clip.name);
    if (!a) { a = this.mixer.clipAction(clip); this.actions.set(clip.name, a); }
    return a;
  }

  _fadeTo(action, fade) {
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    for (const a of this.actions.values()) {
      if (a !== action && a.isRunning() && a.getEffectiveWeight() > 0) a.fadeOut(fade);
    }
    action.fadeIn(fade);
  }

  play(name, opts = {}) {
    if (name === 'walk') name = 'run';
    if (this.dead && name !== 'death') this._revive();
    if (name === 'death' && this.dead) return;
    const once = opts.once ?? ONCE.has(name);
    if (!once) return this._loop(name);

    const r = this._resolve(name);
    if (name === 'attack') this._pickAttack();
    this.pending = this.loopName ?? 'idle';
    if (name === 'death') { this.dead = true; this.deathT = 0; }
    if (!r) {
      // Procedural one-shot (lunge / hop / fall)
      this.oneShot = { name, t: 0, dur: name === 'death' ? 0.8 : Math.min(opts.duration ?? 0.7, 0.8), done: false, proc: true };
      return;
    }
    const a = this._action(r.clip);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    const len = r.clip.duration;
    let ts = (opts.speed ?? 1) * r.speed;
    if (name === 'attack' || name === 'cast') {
      // Contract: with `duration`, the whole clip plays in exactly `duration` seconds (hit at attackHitFraction).
      if (opts.duration > 0) ts = len / opts.duration;
      else if (name === 'cast') ts = Math.max(ts, len / 0.9);
      ts = THREE.MathUtils.clamp(ts, 0.1, 8);
    }
    a.timeScale = ts;
    this._fadeTo(a, name === 'death' ? 0.12 : Math.min(0.08, (len / ts) * 0.12));
    this.oneShot = { name, action: a, t: 0, dur: len / ts, done: false };
  }

  _loop(name) {
    if (this.oneShot && !this.oneShot.done && name === 'idle' && this.oneShot.name !== 'death') { this.pending = 'idle'; return; }
    if (this.loopName === name && !this.oneShot && this.current) return;
    this.oneShot = null;
    this.pending = null;
    this.loopName = name;
    const r = this._resolve(name) ?? (name !== 'idle' ? this._resolve('idle') : null);
    if (!r) { this.current = null; return; }
    const a = this._action(r.clip);
    if (a !== this.current || !a.isRunning()) {
      a.reset();
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = false;
    }
    a.timeScale = r.speed;
    a.userData = { baseSpeed: r.speed };
    this.current = a;
    this._fadeTo(a, 0.18);
    if (r.speed === 0) a.time = 0.1;
  }

  _revive() {
    this.dead = false;
    this.oneShot = null;
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.visible = true;
    this.mixer.stopAllAction();
    this.current = null;
    this.loopName = null;
  }

  update(dt) {
    if (!dt) dt = 0;
    this.t += dt;
    // Run speed follows unit move speed a bit so feet don't slide too much.
    if (this.current && this.loopName === 'run' && this.unit?.getStat) {
      const base = this.current.userData?.baseSpeed ?? 1;
      const ref = this.cfg.runRef ?? 7.5;
      if (base > 0) this.current.timeScale = base * THREE.MathUtils.clamp(this.unit.getStat('moveSpeed') / ref, 0.7, 1.5);
    }
    // Off-screen / fogged units: advance the mixer at a low rate with accumulated time (big CPU saving).
    const g = this.unit?.game;
    const onScreen = !g?.isOnScreen || (this.unit.object.visible && g.isOnScreen(this.unit.position, 3));
    this._skipDt = (this._skipDt ?? 0) + dt;
    if (onScreen || this._skipDt > 5) { this.mixer.update(Math.min(this._skipDt, 5)); this._skipDt = 0; } // catch up when back in view
    this.flasher.update(dt);
    const os = this.oneShot;
    if (os && !os.done) {
      os.t += dt;
      if (os.proc) this._procedural(os);
      if (os.t >= os.dur) {
        os.done = true;
        if (os.name !== 'death') {
          const next = this.pending ?? 'idle';
          this.oneShot = null;
          this.body.position.set(0, 0, 0);
          this.body.rotation.set(0, 0, 0);
          this.loopName = null;
          this._loop(next);
        }
      }
    }
    if (this.dead) {
      this.deathT += dt;
      // After lying down for a while, sink into the ground (units get removed by core later).
      if (this.deathT > 2.5) this.body.position.y = -Math.min(1, (this.deathT - 2.5) / 2.5) * this.height * 0.5;
    }
    // prop effects
    const t = this.t;
    for (const o of this.fx.flicker) o.scale.set(1, 0.85 + 0.2 * Math.abs(Math.sin(t * 13 + Math.sin(t * 7))), 1);
    for (const o of this.fx.spin) o.rotation.y += dt * 1.5;
    for (const o of this.fx.orbit) { o.rotation.y += dt * 1.2; o.position.y = Math.sin(t * 1.5) * 0.08; }
    for (const o of this.fx.pulse) o.scale.setScalar(1 + 0.15 * Math.sin(t * 5));
    for (const o of this.fx.aura) { o.rotation.y += dt * 0.5; o.visible = !this.dead; }
  }

  _procedural(os) {
    const k = Math.min(1, os.t / os.dur);
    const b = this.body;
    if (os.name === 'death') {
      const e = 1 - Math.pow(1 - k, 3);
      b.rotation.z = e * Math.PI / 2;
      b.position.y = e * this.height * 0.08;
      return;
    }
    if (os.name === 'attack') {
      const s = Math.sin(Math.PI * Math.min(1, k * 1.4));
      b.position.z = s * this.height * 0.25;
      b.rotation.x = s * 0.35;
      b.position.y = s * this.height * 0.06;
    } else {
      const s = Math.sin(Math.PI * k);
      b.position.y = s * this.height * 0.12;
      b.rotation.x = -s * 0.2;
    }
  }

  attachPoint(name) {
    if (this.bones[name] !== undefined) return this.bones[name];
    const find = (...names) => { for (const n of names) { const o = this.inst.getObjectByName(n); if (o) return o; } return null; };
    let o = null;
    switch (name) {
      case 'head': o = find('Head', 'head', 'b_Head_05', 'Neck'); break;
      case 'chest': case 'body': o = find('spine_03', 'chest', 'Torso', 'b_Spine02_03'); break;
      case 'weapon': case 'hand': case 'hand_r': case 'attack': case 'projectile': o = find('hand_r', 'handslotr', 'LowerArmR', 'b_Head_05'); break;
      case 'hand_l': o = find('hand_l', 'handslotl', 'LowerArmL'); break;
      case 'feet': case 'origin': o = this.root; break;
      case 'overhead': {
        o = new THREE.Object3D();
        o.position.y = this.height + 0.3;
        this.root.add(o);
        break;
      }
      default: o = this.root;
    }
    this.bones[name] = o ?? this.root;
    return this.bones[name];
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.inst);
    this.root.parent?.remove(this.root);
    // Geometry / shared materials are templates; private flash clones are freed here.
    for (const m of this.flasher.meshes ?? []) m.fm.dispose();
  }
}

// ====================================================================== Structures / vehicles (procedural)
class StructureModel {
  constructor(factory, kind, team, opts) {
    const def = STRUCTURES[kind];
    this.kind = kind;
    this.height = def.height;
    this.vehicle = !!def.vehicle;
    this.unit = opts.unit ?? null;
    this.attackHitFraction = 0.45;
    this.root = new THREE.Group();
    this.root.name = 'model:' + kind;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.inst = factory._structTemplate(kind, team).clone(true);
    this.body.add(this.inst);
    this.flasher = new Flasher(this.inst);
    this.t = Math.random() * 10;
    this.fx = { spin: [], orbit: [], bob: [], pulse: [], wheel: [], arm: [], crystal: [], sway: [], water: [] };
    this.inst.traverse((o) => { if (this.fx[o.name]) this.fx[o.name].push(o); });
    for (const o of [...this.fx.bob, ...this.fx.crystal]) o.userData.baseY = o.position.y;
    this.moving = false;
    this.dead = false;
    this.deathT = 0;
    this.attackT = -1;
    this.attackDur = 0.6;
  }

  flash(color = 0xffffff, duration = 0.12) {
    try { this.flasher.start(color, duration); } catch (e) { /* ignore */ }
  }

  play(name, opts = {}) {
    if (name === 'death') { if (!this.dead) { this.dead = true; this.deathT = 0; } return; }
    if (this.dead) { this.dead = false; this.body.position.set(0, 0, 0); this.body.rotation.set(0, 0, 0); this.body.scale.setScalar(1); }
    if (name === 'run' || name === 'walk') this.moving = true;
    else if (name === 'idle') this.moving = false;
    else if (name === 'attack' || name === 'cast') { this.attackT = 0; this.attackDur = Math.min(opts.duration ?? 0.8, 1.2); }
  }

  update(dt) {
    dt = dt || 0;
    this.t += dt;
    this.flasher.update(dt);
    const t = this.t;
    for (const o of this.fx.spin) o.rotation.y += dt * 0.9;
    for (const o of this.fx.orbit) o.rotation.y += dt * 0.35;
    for (const o of this.fx.sway) { o.rotation.z = Math.sin(t * 0.7) * 0.015; o.rotation.x = Math.sin(t * 0.5) * 0.012; }
    for (const o of this.fx.bob) o.position.y = o.userData.baseY + Math.sin(t * 2.2) * (o.userData.bob ?? 0.08);
    for (const o of this.fx.pulse) o.scale.setScalar(1 + 0.08 * Math.sin(t * 2.5));
    let flash = 0;
    if (this.attackT >= 0) {
      this.attackT += dt;
      const k = this.attackT / this.attackDur;
      flash = Math.max(0, Math.sin(Math.PI * Math.min(1, k)));
      for (const a of this.fx.arm) {
        // catapult throw: snap forward fast then return
        const rest = a.userData.rest ?? -0.35;
        a.rotation.x = k < 0.25 ? rest - (k / 0.25) * 0.5 : k < 0.45 ? rest - 0.5 + ((k - 0.25) / 0.2) * 2.3 : rest + 1.8 * Math.max(0, 1 - (k - 0.45) / 0.55);
      }
      if (k >= 1) { this.attackT = -1; for (const a of this.fx.arm) a.rotation.x = a.userData.rest ?? -0.35; }
    }
    for (const o of this.fx.crystal) {
      o.position.y = o.userData.baseY + Math.sin(t * 1.6) * (o.userData.bob ?? 0.1);
      o.scale.setScalar(1 + flash * 0.35 + 0.04 * Math.sin(t * 3));
    }
    if (this.vehicle) {
      const sp = this.moving && !this.dead ? 5 : 0;
      for (const w of this.fx.wheel) w.rotation.x += dt * sp;
      if (!this.dead) this.body.position.y = this.moving ? Math.abs(Math.sin(t * 9)) * 0.04 : 0;
    }
    if (this.dead) this._death(dt);
  }

  _death(dt) {
    this.deathT += dt;
    const T = this.vehicle || this.kind === 'ward' ? 1.2 : 3.2;
    const k = Math.min(1, this.deathT / T);
    const e = k * k * (3 - 2 * k);
    const b = this.body;
    if (this.vehicle) {
      b.rotation.z = e * 0.9;
      b.position.y = -e * 0.8;
      return;
    }
    if (this.kind === 'ward') { b.scale.setScalar(Math.max(0.01, 1 - e)); return; }
    // big structures: shake, tilt and sink into the ground; crystals drop and dim
    const shake = (1 - k) * 0.08 * this.height * 0.05;
    b.position.x = Math.sin(this.deathT * 40) * shake;
    b.position.z = Math.cos(this.deathT * 33) * shake;
    b.position.y = -e * this.height * 0.75;
    b.rotation.z = e * 0.12;
    b.rotation.x = e * 0.06;
    for (const o of this.fx.crystal) o.scale.setScalar(Math.max(0.01, 1 - e * 1.5));
    for (const o of this.fx.pulse) o.scale.setScalar(Math.max(0.01, 1 - e * 1.5));
  }

  attachPoint(name) {
    if (name === 'crystal' || name === 'attack' || name === 'projectile' || name === 'weapon' || name === 'head') {
      const c = this.fx.crystal[0] ?? this.fx.pulse[0] ?? this.fx.arm[0];
      if (c) return c;
      if (!this._top) { this._top = new THREE.Object3D(); this._top.position.y = this.height * 0.85; this.body.add(this._top); }
      return this._top;
    }
    if (name === 'overhead') {
      if (!this._over) { this._over = new THREE.Object3D(); this._over.position.y = this.height + 0.5; this.root.add(this._over); }
      return this._over;
    }
    return this.root;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const m of this.flasher.meshes ?? []) m.fm.dispose();
  }
}
