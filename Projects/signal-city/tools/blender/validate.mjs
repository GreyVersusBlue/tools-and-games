// node tools/blender/validate.mjs [budget.json]
//
// Checks every sprite sheet budget.json names against Signal City's style
// sheet (WISHLIST.md B1), with no dependency and no Blender, so Site CI runs
// it. Exits 1 on any failure (#13):
//
//   - the PNG is missing, is not an 8-bit RGBA PNG, is over its bytes, or has
//     a side over the cap
//   - the atlas's sheet size is not the PNG's, or its ppm or pad is not the
//     budget's
//   - a frame js/sprites.js needs is missing (every archetype, every palette,
//     every state budget.json gives it, and the trailer in the cab's palettes),
//     or the atlas holds one it does not need
//   - a frame not ceil(length * ppm) + 2 * pad by ceil(width * ppm) + 2 * pad,
//     the canvas spriteFor() makes, or outside the sheet, or overlapping
//     another, or its anchor anywhere but its centre
//   - a frame with less of it covered than minCoverage (an empty or a
//     half-built car), or a pixel outside every frame that is not transparent
//   - two states of one archetype that are the same pixels (an animation that
//     does not move), or two palettes of one archetype that are
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
const { ARCHETYPES, SPRITES } = await import(
  pathToFileURL(path.join(PROJECT, 'js', 'sprites.js')).href);

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

// ---------------------------------------------------------------- the frames sprites.js needs

const { ppm, pad } = budget;
const size = (length, width) => [Math.ceil(length * ppm) + 2 * pad, Math.ceil(width * ppm) + 2 * pad];

function needed() {
  const out = new Map();
  for (const a of ARCHETYPES) {
    const spec = SPRITES[a];
    const states = budget.states[a] ?? 1;
    spec.palettes.forEach((_, v) => {
      for (let s = 0; s < states; s++) out.set(`${a}/${v}/${s}`, size(spec.length, spec.width));
    });
    if (spec.trailer) {
      spec.palettes.forEach((_, v) =>
        out.set(`trailer/${v}/0`, size(spec.trailer.length, spec.trailer.width)));
    }
  }
  return out;
}

// ---------------------------------------------------------------- each sheet

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
  ok(atlas.sheet.ppm === ppm && atlas.sheet.pad === pad, `${name}: atlas ppm and pad are the budget's`,
    `ppm ${atlas.sheet.ppm}, pad ${atlas.sheet.pad}`);

  const need = needed();
  const frames = atlas.frames;
  for (const f of need.keys()) ok(f in frames, `${name}: frame ${f} is in the atlas`);
  for (const f of Object.keys(frames)) ok(need.has(f), `${name}: frame ${f} is one sprites.js needs`);

  const alpha = (x, y) => img.px[(y * img.w + x) * 4 + 3];
  const covered = new Uint8Array(img.w * img.h);
  const pixelsOf = {};
  for (const [f, r] of Object.entries(frames)) {
    const want = need.get(f);
    if (want) ok(r.w === want[0] && r.h === want[1], `${name}: ${f} is spriteFor's size`,
      `${r.w} x ${r.h}, want ${want[0]} x ${want[1]}`);
    ok(r.ax === r.w / 2 && r.ay === r.h / 2, `${name}: ${f} is anchored at its centre`,
      `(${r.ax}, ${r.ay}) in ${r.w} x ${r.h}`);
    if (!ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= img.w && r.y + r.h <= img.h,
      `${name}: ${f} is inside the sheet`, `${r.x},${r.y} ${r.w} x ${r.h}`)) continue;
    let solid = 0, clash = 0;
    const bytes = Buffer.alloc(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (r.y + y) * img.w + r.x + x;
        if (covered[i]) clash++;
        covered[i] = 1;
        if (img.px[i * 4 + 3] >= 128) solid++;
      }
      img.px.copy(bytes, y * r.w * 4, ((r.y + y) * img.w + r.x) * 4, ((r.y + y) * img.w + r.x + r.w) * 4);
    }
    pixelsOf[f] = bytes;
    ok(clash === 0, `${name}: ${f} overlaps no other frame`, `${clash} pixels shared`);
    const cover = solid / (r.w * r.h);
    ok(cover >= sheet.minCoverage, `${name}: ${f} is covered`,
      `${(cover * 100).toFixed(1)}% opaque, floor ${(sheet.minCoverage * 100).toFixed(0)}%`);
  }
  let stray = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (!covered[y * img.w + x] && alpha(x, y) !== 0) stray++;
  }
  ok(stray === 0, `${name}: nothing drawn outside the frames`, `${stray} pixels`);

  // An animation that does not move, or two palettes that came out the same.
  const byArch = {};
  for (const f of Object.keys(pixelsOf)) {
    const [a, v, s] = f.split('/');
    ((byArch[a] ??= {})[v] ??= {})[s] = pixelsOf[f];
  }
  for (const [a, vs] of Object.entries(byArch)) {
    const firsts = Object.entries(vs).map(([v, ss]) => [v, ss[0]]);
    for (let i = 0; i < firsts.length; i++) for (let j = i + 1; j < firsts.length; j++) {
      ok(!firsts[i][1].equals(firsts[j][1]), `${name}: ${a} palettes ${firsts[i][0]} and ${firsts[j][0]} differ`);
    }
    for (const [v, ss] of Object.entries(vs)) {
      const st = Object.entries(ss);
      for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
        ok(!st[i][1].equals(st[j][1]), `${name}: ${a}/${v} states ${st[i][0]} and ${st[j][0]} differ`);
      }
    }
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
