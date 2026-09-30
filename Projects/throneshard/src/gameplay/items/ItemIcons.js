// Procedural item icons: gradient background from def.color, subtle pattern, emoji glyph and a tiered border.
// getItemIcon(id) → PNG dataURL (cached). Returns null outside the browser.
import { ITEM_DEFS } from './ItemDefs.js';

const cache = new Map();
const SIZE = 96;

function hexToRgb(colorStr) {
  const h = (colorStr ?? '#666666').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgb = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const shade = ([r, g, b], f) => (f >= 0
  ? [r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f]
  : [r * (1 + f), g * (1 + f), b * (1 + f)]);

// Stable pseudo-random from id so each icon gets its own pattern.
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

function tierOf(def) {
  if (def.category === 'consumables') return { border: ['#9fd08a', '#3f6a35'], glow: 'rgba(160,230,140,0.35)' };
  if (def.shop === 'secret') return { border: ['#d8b0ff', '#5a3a8a'], glow: 'rgba(200,150,255,0.35)' };
  const c = def.cost ?? 0;
  if (c >= 4000) return { border: ['#ffe9a0', '#9a6a10'], glow: 'rgba(255,210,100,0.45)' };
  if (c >= 2000) return { border: ['#f0c8ff', '#7a3a9a'], glow: 'rgba(230,160,255,0.35)' };
  if (def.components) return { border: ['#a8d8ff', '#2a5a8a'], glow: 'rgba(140,200,255,0.3)' };
  return { border: ['#d8d8d8', '#5a5a5a'], glow: 'rgba(255,255,255,0.18)' };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawItemIcon(def, size = SIZE) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const s = size / 96;
  const base = hexToRgb(def.color);
  const rand = rng(hashStr(def.id));

  // background gradient
  roundRect(ctx, 2 * s, 2 * s, 92 * s, 92 * s, 10 * s);
  ctx.save();
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, size * 0.4, size);
  g.addColorStop(0, rgb(shade(base, 0.35)));
  g.addColorStop(0.55, rgb(base));
  g.addColorStop(1, rgb(shade(base, -0.65)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // pattern: soft rays / rings unique per item
  ctx.globalCompositeOperation = 'overlay';
  const cx = size * (0.35 + rand() * 0.3), cy = size * (0.3 + rand() * 0.3);
  const rays = 6 + Math.floor(rand() * 8);
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2 + rand() * 0.3;
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size * 1.2, a0, a0 + 0.12 + rand() * 0.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // radial light behind glyph
  const rg = ctx.createRadialGradient(size / 2, size * 0.46, 2, size / 2, size / 2, size * 0.55);
  rg.addColorStop(0, 'rgba(255,255,255,0.35)');
  rg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  rg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, size, size);

  // glyph
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(54 * s)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 8 * s;
  ctx.shadowOffsetY = 3 * s;
  ctx.fillText(def.icon ?? '?', size / 2, size * 0.53);
  ctx.shadowColor = 'transparent';

  // top gloss
  const gl = ctx.createLinearGradient(0, 0, 0, size * 0.5);
  gl.addColorStop(0, 'rgba(255,255,255,0.28)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, size, size * 0.45);
  ctx.restore();

  // border
  const tier = tierOf(def);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, tier.border[0]);
  bg.addColorStop(0.5, tier.border[1]);
  bg.addColorStop(1, tier.border[0]);
  ctx.lineWidth = 4 * s;
  ctx.strokeStyle = bg;
  roundRect(ctx, 2 * s, 2 * s, 92 * s, 92 * s, 10 * s);
  ctx.stroke();
  ctx.lineWidth = 1.5 * s;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, 5.5 * s, 5.5 * s, 85 * s, 85 * s, 7 * s);
  ctx.stroke();
  ctx.strokeStyle = tier.glow;
  roundRect(ctx, 7 * s, 7 * s, 82 * s, 82 * s, 6 * s);
  ctx.stroke();
  try { return cv.toDataURL('image/png'); } catch { return null; }
}

export function getItemIcon(id) {
  if (cache.has(id)) return cache.get(id);
  const def = ITEM_DEFS[id];
  if (!def) return null;
  let url = null;
  try { url = drawItemIcon(def); } catch { url = null; }
  cache.set(id, url);
  return url;
}
