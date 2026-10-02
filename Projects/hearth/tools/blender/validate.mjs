// node tools/blender/validate.mjs [budget.json]
//
// Checks the building sheet budget.json names against Hearth's style sheet
// (HISTORY.md #800 to #802), with no dependency and no Blender, so Hearth CI
// runs it. Exits 1 on any failure (#13):
//
//   - the PNG is missing, is not an 8-bit RGBA PNG, is over its bytes, or has
//     a side over the cap
//   - the atlas (buildings.js, a JSON literal on `const BSHEET=`) does not
//     parse, its sheet size is not the PNG's, or its tile is not js/core.js's T
//   - a frame the map draws is missing (every kind in BLD, the bridge both
//     ways, the house in every roof sim.js picks, a snow frame for each kind
//     budget.json's snow lists), or the atlas holds a frame it does not
//   - a frame whose sides or anchor are not whole tiles, or that is outside
//     the sheet or overlaps another
//   - a frame with nothing drawn, or anything drawn on its outermost ring
//   - a pixel that is neither fully opaque nor fully clear, or an opaque pixel
//     that is not a js/render.js colour at one of the tiers (a snow frame: not
//     the snow colour)
//   - a frame whose drawn box is not render.js's old box (`was`) within the
//     scale tolerance in width and height, or whose foot has moved a row
//   - a snow frame with snow where its building is not drawn
//   - two frames that are the same pixels, a pixel outside every frame that is
//     not clear, or a file in the sheet's folder budget.json does not name
//
// The optional argument points it at another budget file; paths in it still
// resolve from the project folder. That is how the guard-rails were broken on
// purpose (#34) without touching the real one.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..', '..');
const budgetPath = path.resolve(process.argv[2] || path.join(HERE, 'budget.json'));
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const { spec } = await import(pathToFileURL(path.join(HERE, 'spec.mjs')).href);
const { T, BLD, ROOFS, PALETTE } = spec();

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};

// ---------------------------------------------------------------- png

function readPng(buf) {
  const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error('not a PNG (no PNG signature)');
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = body;
    else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const depth = ihdr[8], colour = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || colour !== 6) throw new Error(`bit depth ${depth}, colour type ${colour}: not 8-bit RGBA`);
  if (interlace !== 0) throw new Error('interlaced');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4] : 0;
      let pred;
      if (ft === 0) pred = 0;
      else if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`row ${y}: filter type ${ft}`);
      px[y * stride + i] = (src[i] + pred) & 255;
    }
  }
  return { w, h, px };
}

// ---------------------------------------------------------------- colour

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
// common.py's shade(): each channel times the factor, rounded half up, held to 255.
const shade = (hex, f) => rgb(hex).map(c => Math.min(255, Math.floor(c * f + 0.5)));
const allowed = PALETTE.flatMap(h => Object.values(budget.tiers).map(f => shade(h, f)));
const snowRgb = rgb(budget.snow.colour);
const near = (p, c) => Math.abs(p[0] - c[0]) <= budget.tolerance && Math.abs(p[1] - c[1]) <= budget.tolerance
  && Math.abs(p[2] - c[2]) <= budget.tolerance;
ok(PALETTE.includes(budget.snow.colour), `snow ${budget.snow.colour} is a js/render.js colour`);

// ---------------------------------------------------------------- what the map draws

const need = new Set();
for (const k of Object.keys(BLD)) {
  if (k === 'bridge') { need.add('bridge-h'); need.add('bridge-v'); } else need.add(k);
}
for (const r of ROOFS) need.add('house-' + r.slice(1));
for (const k of budget.snow.kinds) need.add(k + '-snow');
const baseOf = (f) => f.endsWith('-snow') ? (f === 'house-snow' ? 'house-' + ROOFS[0].slice(1) : f.slice(0, -5)) : f;
const wasOf = (f) => budget.was[f.startsWith('house-') ? 'house' : f];
for (const f of need) if (!f.endsWith('-snow')) ok(!!wasOf(f), `budget.json has render.js's old box for ${f}`);

// ---------------------------------------------------------------- the sheet

const sheet = budget.sheet;
console.log(`sheet: ${sheet.png}`);
const pngPath = path.join(PROJECT, sheet.png);
const atlasPath = path.join(PROJECT, sheet.atlas);
if (!ok(fs.existsSync(pngPath), `${sheet.png} exists`) | !ok(fs.existsSync(atlasPath), `${sheet.atlas} exists`)) {
  console.log(`\nvalidate: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
const buf = fs.readFileSync(pngPath);
ok(buf.length <= sheet.maxKiB * 1024, 'bytes', `${buf.length} of ${sheet.maxKiB * 1024}`);
let img;
try { img = readPng(buf); } catch (e) {
  ok(false, 'reads as a PNG', e.message);
  console.log(`\nvalidate: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
ok(img.w <= sheet.maxSide && img.h <= sheet.maxSide, 'sides', `${img.w} x ${img.h}, cap ${sheet.maxSide}`);

let atlas = null;
{
  const src = fs.readFileSync(atlasPath, 'utf8');
  const m = src.match(/^const BSHEET=([\s\S]*);\s*$/m);
  try { atlas = m && JSON.parse(src.slice(src.indexOf('const BSHEET=') + 13).trim().replace(/;$/, '')); } catch { atlas = null; }
  ok(!!atlas, `${sheet.atlas} is one JSON literal on const BSHEET=`);
}
if (!atlas) { console.log(`\nvalidate: ${passed} passed, ${failed} failed`); process.exit(1); }
ok(atlas.sheet.w === img.w && atlas.sheet.h === img.h, 'atlas sheet size is the PNG\'s',
  `${atlas.sheet.w} x ${atlas.sheet.h} against ${img.w} x ${img.h}`);
ok(atlas.sheet.tile === T, `atlas tile is js/core.js's T`, `${atlas.sheet.tile} against ${T}`);

const frames = atlas.frames;
for (const f of need) ok(f in frames, `frame ${f} is in the atlas`);
for (const f of Object.keys(frames)) ok(need.has(f), `frame ${f} is one the map draws`);

const covered = new Uint8Array(img.w * img.h);
const pixelsOf = {}, solidOf = {};
for (const [f, r] of Object.entries(frames)) {
  const whole = (v) => Number.isInteger(v) && v % T === 0;
  ok(whole(r.w) && whole(r.h) && r.w > 0 && r.h > 0, `${f}: sides are whole tiles`, `${r.w} x ${r.h}`);
  ok(whole(r.ax) && whole(r.ay), `${f}: anchor is a whole tile`, `(${r.ax}, ${r.ay})`);
  if (!ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= img.w && r.y + r.h <= img.h, `${f}: inside the sheet`,
    `${r.x},${r.y} ${r.w} x ${r.h}`)) continue;
  const snow = f.endsWith('-snow');
  let clash = 0, rim = 0, half = 0, off = 0, drawn = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const bytes = Buffer.alloc(r.w * r.h * 4), solid = new Uint8Array(r.w * r.h);
  let firstOff = '';
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = (r.y + y) * img.w + r.x + x;
      if (covered[i]) clash++;
      covered[i] = 1;
      const a = img.px[i * 4 + 3];
      if (a === 0) continue;
      if (a !== 255) { half++; continue; }
      drawn++; solid[y * r.w + x] = 1;
      if (x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1) rim++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
      const p = [img.px[i * 4], img.px[i * 4 + 1], img.px[i * 4 + 2]];
      if (snow ? !near(p, snowRgb) : !allowed.some(c => near(p, c))) { off++; firstOff ||= `${p} at ${x},${y}`; }
    }
    img.px.copy(bytes, y * r.w * 4, ((r.y + y) * img.w + r.x) * 4, ((r.y + y) * img.w + r.x + r.w) * 4);
  }
  pixelsOf[f] = bytes; solidOf[f] = solid;
  ok(clash === 0, `${f}: overlaps no other frame`, `${clash} pixels shared`);
  ok(drawn > 0, `${f}: is drawn`);
  ok(rim === 0, `${f}: is not clipped by its frame`, `${rim} pixels on the outer ring`);
  ok(half === 0, `${f}: every pixel is whole, opaque or clear`, `${half} part-transparent`);
  ok(off === 0, snow ? `${f}: is snow ${budget.snow.colour} and nothing else` : `${f}: is js/render.js's colours at the tiers`,
    `${off} pixels off, first ${firstOff}`);
  const was = !snow && wasOf(f);
  if (was && drawn) {
    // the drawn box, in map pixels from the tile corner
    const bx0 = x0 - r.ax, by0 = y0 - r.ay, bx1 = x1 - r.ax, by1 = y1 - r.ay;
    const ww = was[2] - was[0], wh = was[3] - was[1], tol = budget.scaleTolerance;
    ok(Math.abs((bx1 - bx0) - ww) <= ww * tol, `${f}: width is render.js's within ${tol * 100}%`,
      `${bx1 - bx0} px against ${ww}`);
    ok(Math.abs((by1 - by0) - wh) <= wh * tol, `${f}: height is render.js's within ${tol * 100}%`,
      `${by1 - by0} px against ${wh}`);
    ok(by1 === was[3], `${f}: its foot is on render.js's row`, `row ${by1} against ${was[3]}`);
  }
}
for (const f of Object.keys(frames)) {
  if (!f.endsWith('-snow') || !solidOf[f]) continue;
  const b = baseOf(f), r = frames[f], rb = frames[b];
  if (!ok(!!solidOf[b] && rb.w === r.w && rb.h === r.h && rb.ax === r.ax && rb.ay === r.ay,
    `${f}: shares ${b}'s frame box`)) continue;
  let bare = 0;
  for (let i = 0; i < solidOf[f].length; i++) if (solidOf[f][i] && !solidOf[b][i]) bare++;
  ok(bare === 0, `${f}: snow only where ${b} is drawn`, `${bare} pixels of snow on nothing`);
}
let stray = 0;
for (let i = 0; i < img.w * img.h; i++) if (!covered[i] && img.px[i * 4 + 3] !== 0) stray++;
ok(stray === 0, 'nothing drawn outside the frames', `${stray} pixels`);

const names = Object.keys(pixelsOf);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  ok(!pixelsOf[names[i]].equals(pixelsOf[names[j]]), `${names[i]} and ${names[j]} are different drawings`);
}

const dir = path.dirname(pngPath);
const named = new Set([sheet.png, sheet.atlas].map(p => path.resolve(PROJECT, p)));
for (const f of fs.readdirSync(dir)) {
  ok(named.has(path.resolve(dir, f)), `${path.join(path.relative(PROJECT, dir), f)} is named in budget.json`);
}
console.log(`  ${Object.keys(frames).length} frames, ${img.w} x ${img.h}, ${buf.length} bytes`);
console.log(`\nvalidate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
