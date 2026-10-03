// node tools/blender/validate.mjs [budget.json]
//
// Checks the cup and food sheet budget.json names against Corner & Kettle's
// style sheet (WISHLIST.md B1 and B2), with no dependency and no Blender, so
// Corner & Kettle CI runs it. Exits 1 on any failure (#13):
//
//   - the PNG is missing, is not an 8-bit RGBA PNG, is over its bytes, or has
//     a side over the cap
//   - the atlas (assets/sprites/cups.js, imported the way draw.js imports it)
//     does not give the PNG's size, the budget's scale and food size, or the
//     old viewBox; or its low level is not a drop down the image
//   - a layer spec.mjs names, or a FOODS entry, is missing a frame, or the
//     atlas holds a frame neither names; a topping in TOPPINGS has no frame
//   - a layer that is not the viewBox x scale, a food that is not food x
//     scale on a side, a frame outside the sheet or overlapping another, or
//     anchored anywhere but its centre
//   - a frame with less of it covered than its class's minCoverage or more
//     than its maxCoverage, or anything drawn on its outermost ring of pixels
//   - the cup's body (cup_back and cup_front together) with an edge more than
//     boxTolerance of the old SVG's box away from that box's edge
//   - a frame its class draws in INK with under minInk of its pixels in INK;
//     a tinted frame with any pixel that is not a grey
//   - two frames that are the same pixels, or a pixel outside every frame
//     that is not transparent, or a clear pixel with a colour under it
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
const { INK, VIEW, CUP_BOX, LAYERS, TOPPING_FRAMES, frames: specFrames } =
  await import(pathToFileURL(path.join(HERE, 'spec.mjs')).href);
const { TOPPINGS } = await import(pathToFileURL(path.join(PROJECT, 'js', 'content.js')).href);

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

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ink = rgb(INK);
const near = (p, c, tol) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;

// ---------------------------------------------------------------- the sheet

const { scale, food } = budget;
const sheet = budget.sheet;
const classOf = new Map();
for (const [cls, c] of Object.entries(budget.classes)) for (const f of c.frames) classOf.set(f, cls);
const tinted = new Set(LAYERS.filter(l => l.tint).map(l => l.name));
const need = new Map(specFrames().map(f => [f.name,
  f.kind === 'layer' ? [VIEW.w * scale, VIEW.h * scale] : [food * scale, food * scale]]));

console.log(`sheet: ${sheet.png}`);
const pngPath = path.join(PROJECT, sheet.png);
const atlasPath = path.join(PROJECT, sheet.atlas);
if (!ok(fs.existsSync(pngPath), `${sheet.png} exists`) | !ok(fs.existsSync(atlasPath), `${sheet.atlas} exists`)) finish();
const buf = fs.readFileSync(pngPath);
ok(buf.length <= sheet.maxKiB * 1024, 'bytes', `${buf.length} of ${sheet.maxKiB * 1024}`);
let img;
try { img = readPng(buf); } catch (e) { ok(false, 'reads as a PNG', e.message); finish(); }
ok(img.w <= sheet.maxSide && img.h <= sheet.maxSide, 'sides', `${img.w} x ${img.h}, cap ${sheet.maxSide}`);

const { CUP_SHEET: atlas } = await import(pathToFileURL(atlasPath).href);
ok(atlas.sheet.w === img.w && atlas.sheet.h === img.h, 'atlas sheet size is the PNG\'s',
  `${atlas.sheet.w} x ${atlas.sheet.h} against ${img.w} x ${img.h}`);
ok(atlas.sheet.scale === scale && atlas.sheet.food === food, 'atlas scale and food size are the budget\'s',
  `scale ${atlas.sheet.scale}, food ${atlas.sheet.food}`);
ok(atlas.sheet.view?.w === VIEW.w && atlas.sheet.view?.h === VIEW.h, 'atlas view is the old cup\'s viewBox',
  JSON.stringify(atlas.sheet.view));
ok(atlas.sheet.levels?.full === 0 && atlas.sheet.levels?.low > 0 && atlas.sheet.levels.low < VIEW.h / 2,
  'the low level is a drop down the image, under half of it', JSON.stringify(atlas.sheet.levels));

const frames = atlas.frames;
for (const f of need.keys()) ok(f in frames, `frame ${f} is in the atlas`);
for (const f of Object.keys(frames)) ok(need.has(f), `frame ${f} is a layer or a food spec.mjs names`);
for (const f of need.keys()) ok(classOf.has(f), `frame ${f} has a class in budget.json`);
for (const t of TOPPINGS) {
  const tf = TOPPING_FRAMES[t.id];
  ok(tf && need.has(tf.frame), `topping ${t.id} is drawn by a frame`, tf ? tf.frame : 'none');
  if (tf) ok(!!tf.tint === tinted.has(tf.frame), `topping ${t.id} gives a tint exactly when its frame takes one`);
}

const covered = new Uint8Array(img.w * img.h);
const pixelsOf = {};
const body = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
for (const [f, r] of Object.entries(frames)) {
  const want = need.get(f);
  const cls = budget.classes[classOf.get(f)];
  if (want) ok(r.w === want[0] && r.h === want[1], `${f} is its size`, `${r.w} x ${r.h}, want ${want[0]} x ${want[1]}`);
  ok(r.ax === r.w / 2 && r.ay === r.h / 2, `${f} is anchored at its centre`, `(${r.ax}, ${r.ay}) in ${r.w} x ${r.h}`);
  if (!ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= img.w && r.y + r.h <= img.h,
    `${f} is inside the sheet`, `${r.x},${r.y} ${r.w} x ${r.h}`)) continue;
  let solid = 0, clash = 0, rim = 0, inked = 0, grey = 0, seen = 0;
  const bytes = Buffer.alloc(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = (r.y + y) * img.w + r.x + x;
      if (covered[i]) clash++;
      covered[i] = 1;
      const p = [img.px[i * 4], img.px[i * 4 + 1], img.px[i * 4 + 2]];
      const a = img.px[i * 4 + 3];
      if (a !== 0 && (x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1)) rim++;
      if (a !== 0) {
        seen++;
        if (Math.max(...p) - Math.min(...p) > budget.neutralTolerance) grey++;
      }
      if (a >= 128) {
        solid++;
        if (near(p, ink, budget.inkTolerance)) inked++;
        if (f === 'cup_back' || f === 'cup_front') {
          const vx = x / scale, vy = y / scale;
          body.x0 = Math.min(body.x0, vx); body.y0 = Math.min(body.y0, vy);
          body.x1 = Math.max(body.x1, vx + 1 / scale); body.y1 = Math.max(body.y1, vy + 1 / scale);
        }
      }
    }
    img.px.copy(bytes, y * r.w * 4, ((r.y + y) * img.w + r.x) * 4, ((r.y + y) * img.w + r.x + r.w) * 4);
  }
  pixelsOf[f] = bytes;
  ok(clash === 0, `${f} overlaps no other frame`, `${clash} pixels shared`);
  ok(rim === 0, `${f} is not clipped by its frame`, `${rim} pixels drawn on the outer ring`);
  if (!cls) continue;
  const cover = solid / (r.w * r.h);
  ok(cover >= cls.minCoverage, `${f} is drawn`,
    `${(cover * 100).toFixed(2)}% at alpha 128 or more, floor ${(cls.minCoverage * 100).toFixed(1)}%`);
  ok(cover <= cls.maxCoverage, `${f} is no bigger than its class`,
    `${(cover * 100).toFixed(2)}% at alpha 128 or more, ceiling ${(cls.maxCoverage * 100).toFixed(1)}%`);
  if (cls.minInk !== undefined) {
    const share = solid ? inked / solid : 0;
    ok(share >= cls.minInk, `${f} is drawn in INK ${INK}`,
      `${(share * 100).toFixed(1)}% of its pixels, floor ${(cls.minInk * 100).toFixed(0)}%`);
  }
  if (tinted.has(f)) ok(grey === 0, `${f} is greys only, so its tint is its only colour`,
    `${grey} of ${seen} pixels are not grey`);
}

// The cup body against the old SVG's box, edge by edge (style sheet item 1).
const tolX = (CUP_BOX.x1 - CUP_BOX.x0) * budget.boxTolerance, tolY = (CUP_BOX.y1 - CUP_BOX.y0) * budget.boxTolerance;
const fmt = b => `${b.x0.toFixed(1)},${b.y0.toFixed(1)} to ${b.x1.toFixed(1)},${b.y1.toFixed(1)}`;
for (const [edge, tol] of [['x0', tolX], ['x1', tolX], ['y0', tolY], ['y1', tolY]]) {
  ok(Math.abs(body[edge] - CUP_BOX[edge]) <= tol, `the cup body's ${edge} is the old cup's within ${budget.boxTolerance * 100}%`,
    `body ${fmt(body)}, old ${fmt(CUP_BOX)}`);
}

let stray = 0, dirty = 0;
for (let i = 0; i < img.w * img.h; i++) {
  if (!covered[i] && img.px[i * 4 + 3] !== 0) stray++;
  if (img.px[i * 4 + 3] === 0 && (img.px[i * 4] | img.px[i * 4 + 1] | img.px[i * 4 + 2])) dirty++;
}
ok(stray === 0, 'nothing drawn outside the frames', `${stray} pixels`);
ok(dirty === 0, 'every clear pixel is 0, 0, 0, 0', `${dirty} carry a colour`);

const names = Object.keys(pixelsOf);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  ok(!pixelsOf[names[i]].equals(pixelsOf[names[j]]), `${names[i]} and ${names[j]} are different drawings`);
}

// The folder holds this sheet and nothing else.
const dir = path.dirname(pngPath);
const named = new Set([sheet.png, sheet.atlas].map(p => path.resolve(PROJECT, p)));
for (const f of fs.readdirSync(dir)) {
  ok(named.has(path.resolve(dir, f)), `${path.join(path.relative(PROJECT, dir), f)} is named in budget.json`);
}
console.log(`  ${Object.keys(frames).length} frames, ${img.w} x ${img.h}, ${buf.length} bytes, cup body ${fmt(body)}`);
finish();

function finish() {
  console.log(`\nvalidate: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
