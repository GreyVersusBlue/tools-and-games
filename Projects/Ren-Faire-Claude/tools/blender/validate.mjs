// node tools/blender/validate.mjs [budget.json]
//
// Checks the marker sheet budget.json names against Faire Weekend's style
// sheet (WISHLIST.md B1 and B2), with no dependency and no Blender, so Site CI
// runs it. Exits 1 on any failure (#13):
//
//   - budget.json's cell is not the largest --cell css/style.css sets, the
//     size a frame is drawn for
//   - the PNG is missing, is not an 8-bit RGBA PNG, is over its bytes, or has
//     a side over the cap
//   - the atlas's sheet size is not the PNG's, or its cell or scale is not
//     the budget's
//   - a marker the plat shows is missing (every kind in js/data.js's
//     STRUCTURE_TYPES, and the gate), or the atlas holds a frame it does not
//   - a frame that is not its footprint x cell x scale on a side, or outside
//     the sheet, or overlapping another, or anchored anywhere but its centre
//   - a frame with less of it covered than minCoverage (empty or half-built)
//     or more than maxCoverage (the token it sits on is gone), or anything
//     drawn on its outermost ring of pixels (a drawing the frame clipped)
//   - a frame with under minInk of its opaque pixels in INK, or under
//     minPalette in INK, a TERRAIN_FILL or PAPER: the plat's ink and colours
//   - two frames that are the same pixels, or a pixel outside every frame
//     that is not transparent
//   - a file in the sheet's folder that budget.json does not name
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
const { INK, TERRAIN_FILL, PAPER } = await import(pathToFileURL(path.join(PROJECT, 'js', 'plat.js')).href);
const { markers } = await import(pathToFileURL(path.join(HERE, 'spec.mjs')).href);

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};

// The cell a frame is drawn for is the largest one the plat is ever laid out
// at, so a marker is never shown bigger than its frame at scale 1.
const css = fs.readFileSync(path.join(PROJECT, 'css', 'style.css'), 'utf8');
const cells = [...css.matchAll(/--cell:\s*(\d+)px/g)].map(m => Number(m[1]));
ok(cells.length > 0 && Math.max(...cells) === budget.cell,
  `budget.json's cell ${budget.cell} is the largest --cell in css/style.css`, `found ${cells.join(', ')}`);

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
const ink = rgb(INK);
const palette = [INK, PAPER, ...Object.values(TERRAIN_FILL)].map(rgb);
const near = (p, c, tol) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;

// ---------------------------------------------------------------- each sheet

const { cell, scale } = budget;
const need = new Map(markers().map(m => [m.name, [m.w * cell * scale, m.h * cell * scale]]));

for (const [name, sheet] of Object.entries(budget.sheets)) {
  console.log(`sheet ${name}: ${sheet.png}`);
  const pngPath = path.join(PROJECT, sheet.png);
  const atlasPath = path.join(PROJECT, sheet.atlas);
  if (!ok(fs.existsSync(pngPath), `${name}: ${sheet.png} exists`)) continue;
  if (!ok(fs.existsSync(atlasPath), `${name}: ${sheet.atlas} exists`)) continue;
  const buf = fs.readFileSync(pngPath);
  ok(buf.length <= sheet.maxKiB * 1024, `${name}: bytes`, `${buf.length} of ${sheet.maxKiB * 1024}`);
  let img;
  try { img = readPng(buf); } catch (e) { ok(false, `${name}: reads as a PNG`, e.message); continue; }
  ok(img.w <= sheet.maxSide && img.h <= sheet.maxSide, `${name}: sides`, `${img.w} x ${img.h}, cap ${sheet.maxSide}`);

  const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
  ok(atlas.sheet.w === img.w && atlas.sheet.h === img.h, `${name}: atlas sheet size is the PNG's`,
    `${atlas.sheet.w} x ${atlas.sheet.h} against ${img.w} x ${img.h}`);
  ok(atlas.sheet.cell === cell && atlas.sheet.scale === scale, `${name}: atlas cell and scale are the budget's`,
    `cell ${atlas.sheet.cell}, scale ${atlas.sheet.scale}`);

  const frames = atlas.frames;
  for (const f of need.keys()) ok(f in frames, `${name}: frame ${f} is in the atlas`);
  for (const f of Object.keys(frames)) ok(need.has(f), `${name}: frame ${f} is a marker the plat shows`);

  const covered = new Uint8Array(img.w * img.h);
  const pixelsOf = {};
  for (const [f, r] of Object.entries(frames)) {
    const want = need.get(f);
    if (want) ok(r.w === want[0] && r.h === want[1], `${name}: ${f} is its footprint x cell x scale`,
      `${r.w} x ${r.h}, want ${want[0]} x ${want[1]}`);
    ok(r.ax === r.w / 2 && r.ay === r.h / 2, `${name}: ${f} is anchored at its centre`,
      `(${r.ax}, ${r.ay}) in ${r.w} x ${r.h}`);
    if (!ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= img.w && r.y + r.h <= img.h,
      `${name}: ${f} is inside the sheet`, `${r.x},${r.y} ${r.w} x ${r.h}`)) continue;
    let solid = 0, clash = 0, rim = 0, opaque = 0, inked = 0, ours = 0;
    const bytes = Buffer.alloc(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (r.y + y) * img.w + r.x + x;
        if (covered[i]) clash++;
        covered[i] = 1;
        const a = img.px[i * 4 + 3];
        if (a >= 128) solid++;
        if (a !== 0 && (x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1)) rim++;
        if (a === 255) {
          const p = [img.px[i * 4], img.px[i * 4 + 1], img.px[i * 4 + 2]];
          opaque++;
          if (near(p, ink, budget.inkTolerance)) inked++;
          if (palette.some(c => near(p, c, budget.paletteTolerance))) ours++;
        }
      }
      img.px.copy(bytes, y * r.w * 4, ((r.y + y) * img.w + r.x) * 4, ((r.y + y) * img.w + r.x + r.w) * 4);
    }
    pixelsOf[f] = bytes;
    ok(clash === 0, `${name}: ${f} overlaps no other frame`, `${clash} pixels shared`);
    const cover = solid / (r.w * r.h);
    ok(cover >= sheet.minCoverage, `${name}: ${f} is drawn`,
      `${(cover * 100).toFixed(1)}% opaque, floor ${(sheet.minCoverage * 100).toFixed(0)}%`);
    ok(cover <= sheet.maxCoverage, `${name}: ${f} leaves the token showing`,
      `${(cover * 100).toFixed(1)}% opaque, ceiling ${(sheet.maxCoverage * 100).toFixed(0)}%`);
    ok(rim === 0, `${name}: ${f} is not clipped by its frame`, `${rim} pixels drawn on the outer ring`);
    const inkShare = opaque ? inked / opaque : 0, ourShare = opaque ? ours / opaque : 0;
    ok(inkShare >= budget.minInk, `${name}: ${f} is drawn in INK ${INK}`,
      `${(inkShare * 100).toFixed(1)}% of opaque pixels, floor ${(budget.minInk * 100).toFixed(0)}%`);
    ok(ourShare >= budget.minPalette, `${name}: ${f} is in the plat's colours`,
      `${(ourShare * 100).toFixed(1)}% of opaque pixels, floor ${(budget.minPalette * 100).toFixed(0)}%`);
  }
  let stray = 0;
  for (let i = 0; i < img.w * img.h; i++) if (!covered[i] && img.px[i * 4 + 3] !== 0) stray++;
  ok(stray === 0, `${name}: nothing drawn outside the frames`, `${stray} pixels`);

  const names = Object.keys(pixelsOf);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    ok(!pixelsOf[names[i]].equals(pixelsOf[names[j]]), `${name}: ${names[i]} and ${names[j]} are different drawings`);
  }

  // The folder holds this sheet and nothing else budget.json does not name.
  const dir = path.dirname(pngPath);
  const named = new Set(Object.values(budget.sheets).flatMap(s => [s.png, s.atlas])
    .map(p => path.resolve(PROJECT, p)));
  for (const f of fs.readdirSync(dir)) {
    ok(named.has(path.resolve(dir, f)), `${name}: ${path.join(path.relative(PROJECT, dir), f)} is named in budget.json`);
  }
  console.log(`  ${Object.keys(frames).length} frames, ${img.w} x ${img.h}, ${buf.length} bytes`);
}

console.log(`\nvalidate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
