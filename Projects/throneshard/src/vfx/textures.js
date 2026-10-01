import * as THREE from 'three';

// Procedurally generated particle/effect textures (no external assets needed).
// Particle atlas: 4x2 frames of 128px.
export const FRAME = { GLOW: 0, CORE: 1, FLARE: 2, SMOKE: 3, SPARK: 4, RING: 5, FLAKE: 6, CHUNK: 7 };
export const ATLAS_COLS = 4, ATLAS_ROWS = 2;
const F = 128;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function drawGlow(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function drawCore(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function drawFlare(ctx, cx, cy, r) {
  drawGlow(ctx, cx, cy, r * 0.5);
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 4 * (i % 2 === 0 ? 1 : 1));
    const len = i % 2 === 0 ? r : r * 0.55;
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-len, 0); ctx.quadraticCurveTo(0, -r * 0.05, len, 0); ctx.quadraticCurveTo(0, r * 0.05, -len, 0);
    ctx.fill();
  }
  ctx.restore();
}

function drawSmoke(ctx, cx, cy, r, seed) {
  const rand = rng(seed);
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2, d = rand() * r * 0.42;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const rr = r * (0.25 + rand() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    const al = 0.12 + rand() * 0.12;
    g.addColorStop(0, `rgba(255,255,255,${al})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}

function drawSpark(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.14);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawRing(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}

function drawFlake(ctx, cx, cy, r) {
  drawGlow(ctx, cx, cy, r * 0.35);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = r * 0.07;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r * 0.45); ctx.lineTo(-r * 0.18, -r * 0.62); ctx.moveTo(0, -r * 0.45); ctx.lineTo(r * 0.18, -r * 0.62); ctx.stroke();
  }
  ctx.restore();
}

function drawChunk(ctx, cx, cy, r, seed) {
  const rand = rng(seed);
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = r * (0.45 + rand() * 0.35);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(120,120,120,1)');
  ctx.fillStyle = g;
  ctx.fill();
}

export function makeParticleAtlas() {
  const c = document.createElement('canvas');
  c.width = F * ATLAS_COLS; c.height = F * ATLAS_ROWS;
  const ctx = c.getContext('2d');
  const at = (i) => [(i % ATLAS_COLS) * F + F / 2, Math.floor(i / ATLAS_COLS) * F + F / 2];
  const r = F / 2 - 2;
  drawGlow(ctx, ...at(0), r);
  drawCore(ctx, ...at(1), r);
  drawFlare(ctx, ...at(2), r);
  drawSmoke(ctx, ...at(3), r, 7);
  drawSpark(ctx, ...at(4), r);
  drawRing(ctx, ...at(5), r);
  drawFlake(ctx, ...at(6), r);
  drawChunk(ctx, ...at(7), r * 0.8, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function canvasTex(size, draw, { repeat = false, srgb = true, w, h } = {}) {
  const c = document.createElement('canvas');
  c.width = w ?? size; c.height = h ?? size;
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// Separate textures for mesh effects.
export function makeTextures() {
  const T = {};
  T.glow = canvasTex(128, (ctx, w) => drawGlow(ctx, w / 2, w / 2, w / 2));
  T.ring = canvasTex(256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.93, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
  T.shock = canvasTex(256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.38, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
  T.disc = canvasTex(256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.95, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
  // Spell-area indicator: crisp outer rim + faint fill + subtle inner tick ring (team-tinted by VFX.areaIndicator).
  T.area = canvasTex(256, (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.38)');
    g.addColorStop(0.935, 'rgba(255,255,255,1)');
    g.addColorStop(0.975, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(c, c, c * 0.84, a0, a0 + Math.PI / 30); ctx.stroke();
    }
  });
  // Runic magic circle (AOE indicators, LSA, Blizzard Veil)
  T.rune = canvasTex(512, (ctx, w) => {
    const c = w / 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.shadowColor = 'white'; ctx.shadowBlur = 8;
    ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(c, c, c - 8, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c, c, c - 34, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c, c, c * 0.45, 0, Math.PI * 2); ctx.stroke();
    // star polygon
    ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i <= 7; i++) {
      const a = (i * 3 * Math.PI * 2) / 7 - Math.PI / 2;
      const x = c + Math.cos(a) * (c - 36), y = c + Math.sin(a) * (c - 36);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    // glyph ticks
    ctx.lineWidth = 4;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r0 = c - 30, r1 = c - 12;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a + 0.05) * r1, c + Math.sin(a + 0.05) * r1);
      ctx.stroke();
    }
  });
  // Noise for fire/cloud shaders (tiling)
  T.noise = canvasTex(128, (ctx, w) => {
    const img = ctx.createImageData(w, w);
    const rand = rng(11);
    const grid = 8; const vals = [];
    for (let i = 0; i < grid * grid; i++) vals.push(rand());
    const at = (x, y) => vals[((y % grid) + grid) % grid * grid + ((x % grid) + grid) % grid];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      let v = 0, amp = 0.5, f = 1;
      for (let o = 0; o < 4; o++) {
        const gx = (x / w) * grid * f, gy = (y / w) * grid * f;
        const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const n = at(x0, y0) * (1 - sx) * (1 - sy) + at(x0 + 1, y0) * sx * (1 - sy) + at(x0, y0 + 1) * (1 - sx) * sy + at(x0 + 1, y0 + 1) * sx * sy;
        v += n * amp; amp *= 0.5; f *= 2;
      }
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v * 270); img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: true, srgb: false });
  T.scorch = canvasTex(256, (ctx, w) => {
    const rand = rng(5);
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2, d = rand() * w * 0.3;
      const x = w / 2 + Math.cos(a) * d, y = w / 2 + Math.sin(a) * d, r = w * (0.08 + rand() * 0.15);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(20,12,8,0.35)'); g.addColorStop(1, 'rgba(20,12,8,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    }
    ctx.strokeStyle = 'rgba(10,6,4,0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      let x = w / 2, y = w / 2; const a0 = rand() * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { const a = a0 + (rand() - 0.5) * 0.9; x += Math.cos(a) * w * 0.07; y += Math.sin(a) * w * 0.07; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
  T.crack = canvasTex(256, (ctx, w) => {
    const rand = rng(21);
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.shadowColor = 'white'; ctx.shadowBlur = 6;
    for (let i = 0; i < 12; i++) {
      let x = w / 2, y = w / 2; const a0 = (i / 12) * Math.PI * 2;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) { const a = a0 + (rand() - 0.5) * 0.8; x += Math.cos(a) * w * 0.06; y += Math.sin(a) * w * 0.06; ctx.lineTo(x, y); ctx.lineWidth = Math.max(1, 3 - k * 0.4); }
      ctx.stroke();
    }
  });
  // Arrow chevrons for move marker
  T.chevron = canvasTex(128, (ctx, w) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(w * 0.2, w * 0.3); ctx.lineTo(w * 0.5, w * 0.7); ctx.lineTo(w * 0.8, w * 0.3); ctx.stroke();
  });
  T.crosshair = canvasTex(256, (ctx, w) => {
    const c = w / 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(c, c, c * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(c, c, c * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 8;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * c * 0.4, c + Math.sin(a) * c * 0.4); ctx.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95); ctx.stroke();
    }
  });
  T.star = canvasTex(128, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.shadowColor = 'white'; ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? c * 0.38 : c * 0.85, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      i ? ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  });
  T.silence = canvasTex(128, (ctx, w) => {
    const c = w / 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(c, c, c * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c - c * 0.5, c - c * 0.5); ctx.lineTo(c + c * 0.5, c + c * 0.5); ctx.stroke();
    ctx.fillStyle = 'white'; ctx.font = `bold ${w * 0.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9; ctx.fillText('?', c, c + 2);
  });
  // Soft vertical gradient for beams / pillars (u = along, v = across)
  T.beam = canvasTex(64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { w: 8, h: 64 });
  return T;
}

export function makeTextSprite(text, { color = '#ffffff', size = 48, stroke = '#000000', bold = true, font = 'sans-serif' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const f = `${bold ? '900 ' : ''}${size}px ${font}`;
  ctx.font = f;
  const w = Math.ceil(ctx.measureText(text).width + size * 0.6);
  const h = Math.ceil(size * 1.4);
  c.width = w; c.height = h;
  ctx.font = f;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size * 0.14);
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, aspect: w / h };
}
