// node tools/blender/validate.mjs [budget.json]
//
// Checks Orbital's body sheet against its style sheet (BACKLOG.md "Orbital:
// Blender assets" B1), with no dependency and no Blender, so Site CI's Orbital
// entry runs it. Exits 1 on any failure (#13):
//
//   - the sheet or the atlas is missing, the sheet is not an 8-bit RGBA PNG, or
//     it is over its bytes
//   - the sheet's size is not the grid budget.json describes (cols x frame wide,
//     rows x frame tall) for the frames the atlas holds
//   - the atlas's keys are not exactly COLOR's keys in js/render.js, or an item
//     of budget.json has no frame or a frame no item
//   - a frame is not frame x frame, lies outside the sheet, or overlaps another
//   - an anchor is outside its frame, or r is not the item's r
//   - an empty frame (no pixel with any alpha)
//   - a pixel with alpha over 8 inside the frame's margin: the drawing has bled
//     to where a neighbour's edge would show once the frame is turned
//   - the drawing's reach: the farthest pixel with alpha over 64 from the
//     anchor, more than 10% off the item's extent
//   - core: the anchor pixel's alpha under 128 where the item says the body
//     covers its centre
//   - hue: the mean of every pixel with alpha over 200, more than 30 degrees of
//     hue off COLOR[type], where the item says the frame wears its colour
//   - a .png under assets/sprites/ that budget.json does not name
//
// COLOR is read from js/render.js as text, with the same pattern common.py's
// palette() uses. The PNG is decoded here (zlib is Node's; the five filters
// are thirty lines), since a check that only reads the header cannot tell an
// empty frame from a full one.
//
// The optional argument points it at another budget file; paths in it still
// resolve from the project folder. That is how the guard-rails were broken on
// purpose (#34) without touching the real one.
//
// Orbital's own validator (#643): the first for a sprite sheet in this repo,
// its shape from Aphelion's tools/blender/validate.mjs at commit db06e5f.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..', '..');
const budgetPath = path.resolve(process.argv[2] || path.join(HERE, 'budget.json'));
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

// COLOR, as common.py's palette() reads it.
function readColor(src) {
  const table = src.match(/^const COLOR = \{([\s\S]*?)\};/m);
  const out = {};
  if (!table) return out;
  for (const m of table[1].matchAll(/(\w+):\s*"#([0-9a-fA-F]{6})"/g)) out[m[1]] = parseInt(m[2], 16);
  return out;
}
const COLOR = readColor(fs.readFileSync(path.join(PROJECT, budget.palette), 'utf8'));

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};

console.log(`COLOR: ${Object.keys(COLOR).length} keys in ${budget.palette}`);
ok(Object.keys(COLOR).length > 0, 'COLOR was read from the game');

// ---------------------------------------------------------------- png

function readPng(buf) {
  if (buf.length < 8 || buf.toString('latin1', 1, 4) !== 'PNG' || buf[0] !== 0x89) throw new Error('not a PNG (no signature)');
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: body.readUInt32BE(0), h: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    } else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.depth !== 8 || ihdr.color !== 6) throw new Error(`bit depth ${ihdr.depth}, colour type ${ihdr.color}; the sheet has to be 8-bit RGBA`);
  if (ihdr.interlace !== 0) throw new Error('interlaced; the sheet has to be written plain');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = ihdr.w * bpp;
  const px = Buffer.alloc(ihdr.h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = line[i]; break;
        case 1: v = line[i] + a; break;
        case 2: v = line[i] + b; break;
        case 3: v = line[i] + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error(`filter ${f} on row ${y}`);
      }
      out[i] = v & 255;
    }
    prev = out;
  }
  return { ...ihdr, px, at: (x, y) => px.subarray((y * ihdr.w + x) * 4, (y * ihdr.w + x) * 4 + 4) };
}

// ---------------------------------------------------------------- colour

const hueOf = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: max ? d / max : 0 };
};
const rgbOf = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const hex = rgb => rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- the sheet

const S = budget.sheet;
const sheetFile = path.resolve(PROJECT, S.file), atlasFile = path.resolve(PROJECT, S.atlas);
console.log(`\nsheet ${S.file}, atlas ${S.atlas}`);
let png = null, atlas = null;
if (ok(fs.existsSync(sheetFile), 'the sheet exists', S.file)) {
  const buf = fs.readFileSync(sheetFile);
  ok(buf.length <= S.bytes, 'bytes', `${buf.length} of ${S.bytes}`);
  try { png = readPng(buf); } catch (e) { ok(false, 'reads as an 8-bit RGBA PNG', e.message); }
}
if (ok(fs.existsSync(atlasFile), 'the atlas exists', S.atlas)) {
  try { atlas = JSON.parse(fs.readFileSync(atlasFile, 'utf8')); } catch (e) { ok(false, 'the atlas parses', e.message); }
}

if (png && atlas) {
  const names = Object.keys(atlas);
  const rows = Math.max(1, Math.ceil(names.length / S.cols));
  ok(png.w === S.cols * S.frame && png.h === rows * S.frame, 'the sheet is the grid',
     `${png.w}x${png.h}, ${names.length} frames on ${S.cols} columns want ${S.cols * S.frame}x${rows * S.frame}`);

  const colorKeys = Object.keys(COLOR), itemKeys = Object.keys(budget.items);
  ok(names.length === colorKeys.length && colorKeys.every(k => atlas[k]), 'the atlas has exactly COLOR\'s keys',
     `atlas [${names.join(', ')}], COLOR [${colorKeys.join(', ')}]`);
  ok(names.every(k => budget.items[k]) && itemKeys.every(k => atlas[k]), 'budget.json\'s items are the atlas\'s frames',
     `items [${itemKeys.join(', ')}]`);

  const boxes = [];
  for (const name of names) {
    const f = atlas[name], item = budget.items[name] || {};
    console.log(`\n${name}  (${f.x},${f.y} ${f.w}x${f.h}, anchor ${f.ax},${f.ay}, r ${f.r})`);
    ok(f.w === S.frame && f.h === S.frame, `${name}: frame is ${S.frame} square`, `${f.w}x${f.h}`);
    ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= png.w && f.y + f.h <= png.h, `${name}: frame inside the sheet`);
    ok(f.ax >= 0 && f.ay >= 0 && f.ax < f.w && f.ay < f.h, `${name}: anchor inside its frame`);
    ok(f.r === item.r, `${name}: r is budget.json's`, `${f.r}, budget.json says ${item.r}`);
    for (const [other, b] of boxes) {
      ok(f.x >= b.x + b.w || b.x >= f.x + f.w || f.y >= b.y + b.h || b.y >= f.y + f.h,
         `${name}: frame does not overlap ${other}`);
    }
    boxes.push([name, f]);
    if (f.x < 0 || f.y < 0 || f.x + f.w > png.w || f.y + f.h > png.h) continue;

    // The pixels.
    let any = false, bled = 0, reach = 0;
    const sum = [0, 0, 0]; let n = 0;
    const m = S.margin;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const p = png.at(f.x + x, f.y + y), a = p[3];
      if (a === 0) continue;
      any = true;
      if (a > 8 && (x < m || y < m || x >= f.w - m || y >= f.h - m)) bled++;
      // Over 64, not 128: the black hole's outer accretion ring is drawn at
      // alpha .5 and is the farthest thing in its frame.
      if (a > 64) reach = Math.max(reach, Math.hypot(x + 0.5 - f.ax, y + 0.5 - f.ay));
      if (a > 200) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++; }
    }
    ok(any, `${name}: the frame is not empty`);
    ok(bled === 0, `${name}: nothing in the ${m} px margin`, `${bled} pixels with alpha over 8`);
    const fx = v => v.toFixed(1);
    if (ok(typeof item.extent === 'number', `${name}: budget.json gives its extent`)) {
      const off = reach / item.extent - 1;
      ok(Math.abs(off) <= 0.10, `${name}: reach within 10% of ${item.extent} px`, `${fx(reach)} px, ${(off * 100).toFixed(1)}%`);
      ok(reach <= S.frame / 2 - m, `${name}: reach under the frame's half side less the margin`, `${fx(reach)} of ${S.frame / 2 - m}`);
    }
    if (item.core) ok(png.at(f.x + f.ax, f.y + f.ay)[3] >= 128, `${name}: the anchor pixel is covered`,
                      `alpha ${png.at(f.x + f.ax, f.y + f.ay)[3]}`);
    if (item.hue && COLOR[name] !== undefined) {
      const mean = sum.map(c => c / Math.max(n, 1));
      const want = hueOf(rgbOf(COLOR[name])), have = hueOf(mean);
      ok(n > 0 && hueGap(have.h, want.h) <= 30, `${name}: mean opaque colour has COLOR's hue`,
         `#${hex(mean)} (hue ${fx(have.h)}) against #${hex(rgbOf(COLOR[name]))} (hue ${fx(want.h)})`);
    }
    console.log(`  reach ${fx(reach)} px, ${n} pixels over alpha 200, mean #${hex(sum.map(c => c / Math.max(n, 1)))}`);
  }
}

console.log('\nevery sheet is named');
const named = new Set([path.normalize(S.file)]);
const dir = path.join(PROJECT, budget.sprites);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.png$/i.test(f)) : [];
for (const f of files) {
  const rel = path.normalize(path.join(budget.sprites, f));
  ok(named.has(rel), `budget.json names every .png under ${budget.sprites}/`, rel.split(path.sep).join('/'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
