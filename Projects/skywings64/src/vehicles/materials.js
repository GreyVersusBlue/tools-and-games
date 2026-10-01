// PBR material library + procedural canvas textures for the vehicles. No external assets.
import * as THREE from 'three';

export const QUALITY = () => (typeof window !== 'undefined' && window.SW_QUALITY) || 'high';
export const seg = (hi, med, lo) => {
  const q = QUALITY();
  return q === 'low' ? (lo ?? med ?? hi) : q === 'medium' ? (med ?? hi) : hi;
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// ---------------------------------------------------------------- textures
const _tc = {};
const cached = (k, f) => _tc[k] || (_tc[k] = f());

// woven ripstop bump (grayscale)
export function weaveBump() {
  return cached('weave', () => {
    const [c, g] = makeCanvas(128, 128);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 4)
      for (let x = 0; x < 128; x += 4) {
        const odd = ((x + y) / 4) & 1;
        const gr = g.createLinearGradient(x, y, odd ? x + 4 : x, odd ? y : y + 4);
        gr.addColorStop(0, '#606060');
        gr.addColorStop(0.5, '#c8c8c8');
        gr.addColorStop(1, '#606060');
        g.fillStyle = gr;
        g.fillRect(x, y, 4, 4);
      }
    g.strokeStyle = '#303030';
    g.lineWidth = 1.2;
    for (let i = 0; i <= 128; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 128);
      g.moveTo(0, i);
      g.lineTo(128, i);
      g.stroke();
    }
    return toTex(c, { srgb: false, repeat: [24, 24] });
  });
}

// Hang-glider sail. u (x) = span root->tip, v (y) = chord LE->TE. Symmetric so mirrored wings match.
export function sailTexture(theme = 0) {
  return cached('sail' + theme, () => {
    const W = 1024;
    const [c, g] = makeCanvas(W, W);
    const themes = [
      { cols: ['#ff3b30', '#fff4d6', '#ff9500', '#fff4d6', '#e2231a', '#ffd60a'], tip: '#12245c', le: '#101830', star: '#12245c' },
      { cols: ['#1fa0ff', '#ffffff', '#0a5bd8', '#ffffff', '#ff3b6b', '#ffd60a'], tip: '#ff3b6b', le: '#0b1a3a', star: '#0a5bd8' },
    ];
    const T = themes[theme % themes.length];
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const pal = T.cols.map(hex);
    const tipC = hex(T.tip), leC = hex(T.le), cream = hex('#fff4d6');
    const img = g.createImageData(W, W);
    const NR = 14;
    for (let py = 0; py < W; py++) {
      const c = py / (W - 1);
      for (let px = 0; px < W; px++) {
        const sp = px / (W - 1);
        const zle = -2.75 + sp * 4.55;
        const zte = 1.15 + sp * 0.7 - 0.3 * Math.sin(Math.PI * sp) * (1 - sp * 0.3);
        const z = zle + (zte - zle) * c;
        const ang = Math.atan2(sp * 4.7, z + 2.75); // 0 (keel) .. pi/2
        const band = (ang / (Math.PI * 0.5)) * NR;
        const bi = Math.floor(band);
        const fr = band - bi;
        let col = pal[bi % pal.length];
        // cream trailing zone
        if (c > 0.74) {
          const k = Math.min(1, (c - 0.74) / 0.16);
          col = col.map((v, i) => v + (cream[i] - v) * k);
        }
        if (sp > 0.9) col = tipC;
        if (sp > 0.895 && sp < 0.905) col = [255, 255, 255];
        if (c < 0.04) col = leC;
        else if (c < 0.05) col = [255, 214, 10];
        if (c > 0.985) col = leC;
        const seam = (fr < 0.025 || fr > 0.975) && sp < 0.9;
        const o = (py * W + px) * 4;
        const dk = seam ? 0.55 : 1;
        img.data[o] = col[0] * dk; img.data[o + 1] = col[1] * dk; img.data[o + 2] = col[2] * dk; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // star emblem, drawn in (approximately) physical metres around (x=1.7, z=-0.35)
    {
      const sp0 = 1.7 / 4.7;
      const zl = -2.75 + sp0 * 4.55, zt = 1.15 + sp0 * 0.7 - 0.3 * Math.sin(Math.PI * sp0) * (1 - sp0 * 0.3);
      const c0 = (-0.35 - zl) / (zt - zl);
      g.save();
      g.translate(sp0 * W, c0 * W);
      g.scale(W / 4.7, W / (zt - zl));
      const star = (R, r, col) => {
        g.fillStyle = col;
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r : R;
          const a = Math.PI / 2 + (i * Math.PI) / 5; // point toward the trailing edge
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
      };
      star(0.62, 0.26, '#ffffff');
      star(0.46, 0.19, T.star);
      g.restore();
    }
    // subtle dirt / sun-fade noise
    const id = g.getImageData(0, 0, W, W);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      id.data[i] += n;
      id.data[i + 1] += n;
      id.data[i + 2] += n;
    }
    g.putImageData(id, 0, 0);
    return toTex(c);
  });
}

// Gyrocopter paint: u around the lathe axis, v along it. Racing stripe + roundels on both flanks.
export function paintTexture(base = '#ffc400', stripe = '#e8322a', accent = '#ffffff') {
  return cached('paint' + base + stripe, () => {
    const [c, g] = makeCanvas(512, 512);
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    // v bands along body length
    g.fillStyle = stripe;
    g.fillRect(0, 150, 512, 34);
    g.fillStyle = accent;
    g.fillRect(0, 190, 512, 8);
    g.fillStyle = stripe;
    g.fillRect(0, 400, 512, 60);
    // checker band near the nose
    for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) & 1 ? '#111' : '#fff';
      g.fillRect(i * 16, 60 + j * 16, 16, 16);
    }
    // roundels at both sides (u=.25 & .75)
    for (const cx of [0, 256, 512]) {
      g.save();
      g.translate(cx, 290);
      g.scale(1, 1.4);
      g.fillStyle = accent;
      g.beginPath(); g.arc(0, 0, 50, 0, 7); g.fill();
      g.fillStyle = stripe;
      g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill();
      g.fillStyle = accent;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 12 : 30;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath(); g.fill();
      g.restore();
    }
    // scuffs
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 30, 1 + Math.random() * 2);
    }
    return toTex(c);
  });
}

// generic soft radial glow sprite
export function glowTexture() {
  return cached('glow', () => {
    const [c, g] = makeCanvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,220,150,0.65)');
    gr.addColorStop(0.6, 'rgba(255,120,30,0.18)');
    gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return toTex(c);
  });
}
export function softPuffTexture() {
  return cached('puff', () => {
    const [c, g] = makeCanvas(64, 64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return toTex(c);
  });
}
// vertical flame gradient with streaks; v=0 nozzle, v=1 tip
export function flameTexture() {
  return cached('flame', () => {
    const [c, g] = makeCanvas(64, 256);
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,240,180,0.95)');
    gr.addColorStop(0.45, 'rgba(255,150,40,0.6)');
    gr.addColorStop(0.8, 'rgba(255,70,10,0.2)');
    gr.addColorStop(1, 'rgba(255,40,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.3})`;
      g.fillRect(Math.random() * 64, Math.random() * 200, 2 + Math.random() * 5, 30 + Math.random() * 90);
    }
    const t = toTex(c, { srgb: true });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}
// rotor disc blur: faint rings + streaks
export function rotorBlurTexture() {
  return cached('rblur', () => {
    const [c, g] = makeCanvas(256, 256);
    g.translate(128, 128);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 20 + Math.random() * 80;
      g.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.1})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.arc(0, 0, r0, a, a + 0.4 + Math.random() * 1.6);
      g.stroke();
    }
    const gr = g.createRadialGradient(0, 0, 8, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.22)');
    gr.addColorStop(0.95, 'rgba(255,255,255,0.4)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, 128, 0, 7); g.fill();
    return toTex(c);
  });
}
export function decalTexture(kind = 'badge') {
  return cached('decal' + kind, () => {
    const [c, g] = makeCanvas(128, 128);
    g.translate(64, 64);
    if (kind === 'badge') {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(0, 0, 58, 0, 7); g.fill();
      g.fillStyle = '#e8322a';
      g.beginPath(); g.arc(0, 0, 48, 0, 7); g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 16 : 38;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath(); g.fill();
    } else {
      g.fillStyle = '#ffd60a';
      g.fillRect(-60, -14, 120, 28);
      g.fillStyle = '#111';
      for (let i = -60; i < 60; i += 24) {
        g.beginPath(); g.moveTo(i, -14); g.lineTo(i + 12, -14); g.lineTo(i + 24, 14); g.lineTo(i + 12, 14); g.fill();
      }
    }
    return toTex(c);
  });
}

// ---------------------------------------------------------------- fallback environment (for chrome/metal/glass)
let _env = null;
function fallbackEnv() {
  if (_env) return _env;
  const [c, g] = makeCanvas(256, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#3f86e8');
  gr.addColorStop(0.42, '#bfe0ff');
  gr.addColorStop(0.5, '#ffffff');
  gr.addColorStop(0.52, '#8a7a5a');
  gr.addColorStop(1, '#3a3428');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  const sun = g.createRadialGradient(170, 30, 0, 170, 30, 26);
  sun.addColorStop(0, 'rgba(255,255,240,1)');
  sun.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 256, 128);
  _env = new THREE.CanvasTexture(c);
  _env.mapping = THREE.EquirectangularReflectionMapping;
  _env.colorSpace = THREE.SRGBColorSpace;
  return _env;
}

// ---------------------------------------------------------------- material factories
const _mats = new Map();
const _envUsers = [];
function reg(m, envIntensity) {
  if (envIntensity !== undefined) m.envMapIntensity = envIntensity;
  if (m.metalness > 0.3 || m.clearcoat > 0 || m.transparent) {
    m.envMap = fallbackEnv();
    _envUsers.push(m);
  }
  return m;
}
// When the render agent supplies scene.environment, drop our per-material fallback so the real env is used.
let _envSynced = null;
export function syncEnvironment(scene) {
  if (!scene || _envSynced === scene.environment) return;
  _envSynced = scene.environment;
  for (const m of _envUsers) {
    m.envMap = scene.environment ? null : fallbackEnv();
    m.needsUpdate = true;
  }
}

export function pbr(color, o = {}) {
  const key = JSON.stringify([color, o]);
  let m = _mats.get(key);
  if (!m) {
    const p = {
      color,
      metalness: o.metalness ?? 0.0,
      roughness: o.roughness ?? 0.55,
      side: o.dbl ? THREE.DoubleSide : THREE.FrontSide,
    };
    if (o.emissive) { p.emissive = o.emissive; p.emissiveIntensity = o.emissiveIntensity ?? 1; }
    if (o.map) p.map = o.map;
    if (o.bumpMap) { p.bumpMap = o.bumpMap; p.bumpScale = o.bumpScale ?? 1; }
    if (o.transparent) { p.transparent = true; p.opacity = o.opacity ?? 0.5; p.depthWrite = false; }
    if (o.vc) p.vertexColors = true;
    const phys = o.clearcoat || o.sheen || o.physical;
    if (phys) {
      if (o.clearcoat) { p.clearcoat = o.clearcoat; p.clearcoatRoughness = o.clearcoatRoughness ?? 0.08; }
      if (o.sheen) { p.sheen = o.sheen; p.sheenRoughness = 0.5; p.sheenColor = new THREE.Color(o.sheenColor ?? 0xffffff); }
      m = new THREE.MeshPhysicalMaterial(p);
    } else m = new THREE.MeshStandardMaterial(p);
    reg(m, o.env);
    _mats.set(key, m);
  }
  return m;
}
export const paint = (c, o = {}) => pbr(c, { metalness: 0.2, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12, ...o });
export const alu = (c = 0xd6dbe0) => pbr(c, { metalness: 0.92, roughness: 0.3 });
export const anodized = (c) => pbr(c, { metalness: 0.85, roughness: 0.38 });
export const chrome = () => pbr(0xffffff, { metalness: 1, roughness: 0.06, env: 1.6 });
export const steel = () => pbr(0x8b9096, { metalness: 0.9, roughness: 0.42 });
export const rubber = (c = 0x18181a) => pbr(c, { metalness: 0, roughness: 0.92 });
export const cloth = (c) => pbr(c, { metalness: 0, roughness: 0.82, bumpMap: weaveBump(), bumpScale: 0.25 });
export const leather = (c = 0x4a2e1c) => pbr(c, { metalness: 0, roughness: 0.6 });
export const glass = (c = 0xa8dcff, op = 0.32) =>
  pbr(c, { metalness: 0.0, roughness: 0.03, transparent: true, opacity: op, clearcoat: 1, dbl: true, env: 1.8 });
export const visor = (c = 0xe8a53a) => pbr(c, { metalness: 0.95, roughness: 0.05, env: 2, dbl: true });
export function sailMaterial(theme = 0) {
  return new THREE.MeshPhysicalMaterial({
    map: sailTexture(theme),
    bumpMap: weaveBump(),
    bumpScale: 0.35,
    roughness: 0.78,
    metalness: 0,
    sheen: 0.25,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xffffff),
    side: THREE.DoubleSide,
  });
}
