import * as THREE from 'three';

// Shared procedural textures + material cache for the models module.
// Everything here is created lazily once and reused by every instance (perf: ~150 animated units).

const _tex = {};
const _mats = new Map();

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(key, size, draw, repeat = 1) {
  if (_tex[key]) return _tex[key];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _tex[key] = t;
  return t;
}

function noise(g, size, count, alpha, r) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * size, r() * size, s, s);
  }
}

// Stone bricks: light grey base (tinted by material color). Rows of offset blocks with mortar + grain.
export function stoneTexture() {
  return canvasTex('stone', 512, (g, S) => {
    const r = rng(7);
    g.fillStyle = '#6d6a66';
    g.fillRect(0, 0, S, S);
    const rows = 8, rh = S / rows;
    for (let y = 0; y < rows; y++) {
      const cols = 4;
      const cw = S / cols;
      const off = (y % 2) * cw * 0.5;
      for (let x = -1; x < cols + 1; x++) {
        const l = 150 + Math.floor(r() * 60);
        g.fillStyle = `rgb(${l},${l - 4},${l - 10})`;
        const bx = x * cw + off + 3, by = y * rh + 3;
        g.fillRect(bx, by, cw - 6, rh - 6);
        // bevel highlights
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(bx, by, cw - 6, 3);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(bx, by + rh - 9, cw - 6, 3);
      }
    }
    noise(g, S, 9000, 0.12, r);
    // cracks
    g.strokeStyle = 'rgba(40,35,30,0.35)';
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = r() * S, y = r() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

// Rough rock / cliff texture (volcanic, golem)
export function rockTexture() {
  return canvasTex('rock', 256, (g, S) => {
    const r = rng(19);
    g.fillStyle = '#8a8580';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const l = 90 + Math.floor(r() * 110);
      g.fillStyle = `rgba(${l},${l - 3},${l - 8},0.5)`;
      g.beginPath();
      g.arc(r() * S, r() * S, 4 + r() * 18, 0, Math.PI * 2);
      g.fill();
    }
    noise(g, S, 6000, 0.15, r);
  });
}

export function barkTexture() {
  return canvasTex('bark', 256, (g, S) => {
    const r = rng(3);
    g.fillStyle = '#a07a58';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 120; i++) {
      const x = r() * S;
      g.strokeStyle = `rgba(${30 + r() * 40},${20 + r() * 25},${10},0.6)`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 20, S * 0.33, x + (r() - 0.5) * 20, S * 0.66, x + (r() - 0.5) * 10, S);
      g.stroke();
    }
    noise(g, S, 3000, 0.15, r);
  });
}

export function woodTexture() {
  return canvasTex('wood', 256, (g, S) => {
    const r = rng(11);
    g.fillStyle = '#9a6b3f';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) {
      g.fillStyle = `rgba(60,35,15,${0.1 + 0.15 * Math.abs(Math.sin(y * 0.15 + r() * 0.5))})`;
      g.fillRect(0, y, S, 1);
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(30,15,5,0.9)'; g.fillRect(0, (i * S) / 6, S, 2); }
    noise(g, S, 2000, 0.1, r);
  });
}

// Glowing rune strip texture (emissive map)
export function runeTexture() {
  return canvasTex('runes', 256, (g, S) => {
    const r = rng(5);
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.lineCap = 'round';
    const n = 6, w = S / n;
    for (let i = 0; i < n; i++) {
      const cx = i * w + w / 2, cy = S / 2;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = r() * Math.PI * 2, b = r() * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * w * 0.3, cy + Math.sin(a) * S * 0.3);
        g.lineTo(cx + Math.cos(b) * w * 0.3, cy + Math.sin(b) * S * 0.3);
      }
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, w * 0.12, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

// Lava cracks for Duskward structures (emissive map, black = no glow)
export function lavaCrackTexture() {
  return canvasTex('lavacrack', 256, (g, S) => {
    const r = rng(23);
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#ffffff';
    g.shadowColor = '#fff';
    g.shadowBlur = 6;
    for (let i = 0; i < 22; i++) {
      g.lineWidth = 1 + r() * 2.5;
      g.beginPath();
      let x = r() * S, y = r() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 50; y += (r() - 0.3) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

// Soft radial glow sprite
export function glowTexture() {
  if (_tex.glow) return _tex.glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _tex.glow = t;
  return t;
}

export function waterTexture() {
  return canvasTex('water', 256, (g, S) => {
    const r = rng(31);
    g.fillStyle = '#2a7fb0';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 80; i++) {
      g.strokeStyle = `rgba(200,240,255,${0.1 + r() * 0.25})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      const x = r() * S, y = r() * S;
      g.ellipse(x, y, 8 + r() * 20, 3 + r() * 5, 0, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

export function clothTexture() {
  return canvasTex('cloth', 128, (g, S) => {
    const r = rng(41);
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 2) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 0, 1, S); }
    noise(g, S, 800, 0.08, r);
  });
}

/**
 * Cached material. `key` must uniquely describe the params.
 * kind: 'std' (MeshStandardMaterial), 'basic', 'additive' (glow), 'phys'.
 */
export function mat(key, params = {}, kind = 'std') {
  let m = _mats.get(key);
  if (m) return m;
  if (kind === 'basic') m = new THREE.MeshBasicMaterial(params);
  else if (kind === 'additive') m = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...params });
  else if (kind === 'sprite') m = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...params });
  else m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...params });
  m.name = key;
  _mats.set(key, m);
  return m;
}

// Common shorthand materials
export const M = {
  stone: (col = 0xb8b0a0, k = '') => mat('stone' + col + k, { color: col, map: stoneTexture(), roughness: 0.9 }),
  rock: (col = 0x807870) => mat('rock' + col, { color: col, map: rockTexture(), roughness: 0.95 }),
  wood: (col = 0xffffff) => mat('wood' + col, { color: col, map: woodTexture(), roughness: 0.85 }),
  bark: (col = 0xffffff) => mat('bark' + col, { color: col, map: barkTexture(), roughness: 0.95 }),
  metal: (col = 0xb0b4b8, rough = 0.35) => mat('metal' + col + rough, { color: col, metalness: 0.85, roughness: rough }),
  cloth: (col) => mat('cloth' + col, { color: col, map: clothTexture(), roughness: 0.9, side: THREE.DoubleSide }),
  flat: (col, rough = 0.7) => mat('flat' + col + rough, { color: col, roughness: rough }),
  glow: (col, intensity = 2.5) => mat('glow' + col + intensity, { color: col, emissive: col, emissiveIntensity: intensity, roughness: 0.4 }),
  add: (col, opacity = 0.6) => mat('add' + col + opacity, { color: col, opacity, side: THREE.DoubleSide }, 'additive'),
  sprite: (col, opacity = 0.9) => mat('spr' + col + opacity, { color: col, opacity }, 'sprite'),
  lavaStone: (col, glowHex) => mat('lava' + col + glowHex, { color: col, map: rockTexture(), emissive: glowHex, emissiveMap: lavaCrackTexture(), emissiveIntensity: 2.2, roughness: 0.95 }),
  runeStone: (col, glowHex) => mat('runest' + col + glowHex, { color: col, map: stoneTexture(), emissive: glowHex, emissiveMap: runeTexture(), emissiveIntensity: 2.0, roughness: 0.85 }),
  water: () => mat('water', { color: 0x66c8ff, map: waterTexture(), transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.2, emissive: 0x114466, emissiveIntensity: 0.6 }),
};

/**
 * Recolor material: wraps a GLTF material so a per-vertex `tint` attribute (rgb = colour, a = strength)
 * recolours the texture while preserving its shading detail (luminance * tint). Shared per source material.
 */
export function recolorMaterial(src, variant = 'normal') {
  const key = 'recolor:' + src.uuid + ':' + variant;
  let m = _mats.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: src.map ?? null,
    color: src.color?.clone?.() ?? new THREE.Color(1, 1, 1),
    roughness: 0.72,
    metalness: 0.05,
    emissive: src.emissive?.clone?.() ?? new THREE.Color(0, 0, 0),
    emissiveMap: src.emissiveMap ?? null,
    emissiveIntensity: src.emissiveIntensity ?? 1,
  });
  if (variant === 'illusion') {
    m.transparent = true;
    m.opacity = 0.55;
    m.depthWrite = false;
    m.emissive = new THREE.Color(0x2a6cff);
    m.emissiveIntensity = 0.9;
  }
  const illusion = variant === 'illusion';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 tint;\nvarying vec4 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = tint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vTint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 rec = vTint.rgb * clamp(0.12 + 1.5 * pow(lum, 0.6), 0.0, 1.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, rec, vTint.a);
          ${illusion ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.35, 0.6, 1.4), 0.75);' : ''}
        }`);
  };
  m.customProgramCacheKey = () => 'recolor' + variant;
  m.name = key;
  _mats.set(key, m);
  return m;
}

export function illusionPropMaterial() {
  return mat('illusionProp', { color: 0x6fa8ff, emissive: 0x2a6cff, emissiveIntensity: 0.8, transparent: true, opacity: 0.5, depthWrite: false });
}

/**
 * Draw-call reduction: merge all static meshes under `group` (whose ancestors up to `group` aren't named animated
 * nodes) into one mesh per material. Returns the group (mutated).
 */
export function mergeStatic(group, animatedNames, mergeGeometries) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const isAnimated = (o) => { for (let p = o; p && p !== group; p = p.parent) if (animatedNames.has(p.name)) return true; return false; };
  group.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || isAnimated(o)) return;
    const k = o.material.uuid;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = [];
    for (const m of list) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.morphAttributes = {};
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list.some((m) => m.castShadow);
    mesh.receiveShadow = list.some((m) => m.receiveShadow);
    group.add(mesh);
    for (const m of list) m.parent.remove(m);
  }
  return group;
}

/**
 * Character material (baked albedo*AO atlas). Options:
 *   glow: geometry has a 'glow' vec4 attribute (r = emissive mask baked in Blender) → emissive = albedo * mask.
 *   variant: 'normal' | 'illusion' (translucent blue ghost). tint: optional colour multiplied into the albedo
 *   (used for unknown heroes / recolours). glowColor: optional colour that replaces albedo as the glow colour.
 * Shared per (texture, options); the per-instance hit flash clones it (see ModelFactory Flasher).
 */
export function charMaterial(map, { glow = false, variant = 'normal', tint = null, glowColor = null } = {}) {
  const key = `char:${map?.uuid}:${glow}:${variant}:${tint}:${glowColor}`;
  let m = _mats.get(key);
  if (m) return m;
  const illusion = variant === 'illusion';
  m = new THREE.MeshStandardMaterial({ map: map ?? null, roughness: 0.78, metalness: 0.0 });
  if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
  if (tint != null) m.color = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.25);
  if (illusion) {
    m.transparent = true;
    m.opacity = 0.6;
    m.depthWrite = false;
    m.emissive = new THREE.Color(0x2a6cff);
    m.emissiveIntensity = 0.7;
  }
  const gc = glowColor != null ? new THREE.Color(glowColor) : null;
  m.onBeforeCompile = (shader) => {
    if (glow) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow.r;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += ${gc ? `vec3(${gc.r.toFixed(3)}, ${gc.g.toFixed(3)}, ${gc.b.toFixed(3)})` : 'diffuseColor.rgb'} * vGlow * 2.2;`);
    }
    if (illusion) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.4, 0.65, 1.5), 0.8); }`);
    }
  };
  m.customProgramCacheKey = () => `char:${glow}:${illusion}:${glowColor}`;
  m.name = key;
  _mats.set(key, m);
  return m;
}
