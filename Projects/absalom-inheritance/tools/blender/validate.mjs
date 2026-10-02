// node tools/blender/validate.mjs [budget.json]
//
// Checks every sprite sheet budget.json names against Absalom's style sheet
// (WISHLIST.md B1), with no dependency and no Blender, so absalom-ci.yml runs
// it. Exits 1 on any failure (#13):
//
//   - the PNG is missing, is not an 8-bit RGBA PNG, is over its bytes, or has
//     a side over the cap
//   - the atlas's sheet size is not the PNG's, or its tw or pad is not the
//     pipeline's
//   - a frame budget.json names is missing from the atlas, or the atlas holds
//     one it does not name, or budget.json and render.js's FRAMES disagree
//   - a frame not the size frame_box() gives it (112 + 2 * pad across, tall
//     enough for its box), or its anchor not where the square's centre goes,
//     or outside the sheet, or overlapping another
//   - a frame with less of it covered than its minCoverage (an empty or a
//     half-built frame), or a pixel outside every frame that is not
//     transparent
//   - a frame's drawing standing off the box it replaces (render.js's SOLIDS
//     entry, or its own ht and fp) by more than boxSlack: its top too high or
//     too low, or its sides wider than the box (style sheet item 1)
//   - a face whose centre is not the PALETTE colour budget.json names for it,
//     within faceTolerance levels (the three-face light, #794); a mask frame
//     where red, green or blue never leads, or with pixels no tint would
//     light (#796); a figure whose median colour is not the hue of the
//     PALETTE colour it names first
//   - a SOLIDS entry a frame names that render.js does not have, or a PALETTE
//     name it does not have
//   - a file in a sheet's folder that budget.json does not name
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
const { PALETTE, SOLIDS, FRAMES } = await import(pathToFileURL(path.join(PROJECT, 'js', 'render.js')).href);

const TW = 112;   // common.py's TW: frame pixels across one square

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

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ---------------------------------------------------------------- the box a frame gets

const { pad } = budget;

/** common.py's box_of: a SOLIDS entry by name, or the frame's own ht and fp. */
function boxOf(item) {
  if ('solid' in item) return SOLIDS[item.solid] ? [SOLIDS[item.solid].ht, SOLIDS[item.solid].fp] : null;
  return [item.ht ?? 0, item.fp ?? 1];
}

/** common.py's frame_box: size and anchor in frame pixels. */
function frameBox(item) {
  const [ht] = boxOf(item);
  const rise = 2 * (ht + (item.headroom ?? 0));
  const w = TW + 2 * pad, h = TW / 2 + rise + 2 * pad;
  return { w, h, ax: w / 2, ay: pad + rise + TW / 4 };
}

// ---------------------------------------------------------------- each sheet

const named = new Set(Object.values(budget.sheets).flatMap(s => [s.png, s.atlas])
  .map(p => path.resolve(PROJECT, p)));

for (const [name, sheet] of Object.entries(budget.sheets)) {
  console.log(`sheet ${name}: ${sheet.png}`);
  const items = sheet.frames;
  // The frames render.js draws are the frames this sheet holds, both ways.
  for (const f of FRAMES[name] ?? []) ok(f in items, `${name}: render.js's frame ${f} is in budget.json`);
  for (const f of Object.keys(items)) ok((FRAMES[name] ?? []).includes(f), `${name}: ${f} is a frame render.js draws`);
  for (const [f, item] of Object.entries(items)) {
    if ('solid' in item) ok(item.solid in SOLIDS, `${name}: ${f}'s solid "${item.solid}" is in render.js's SOLIDS`);
    for (const [face, pal] of Object.entries(item.faces ?? {})) {
      ok(pal in PALETTE, `${name}: ${f}'s ${face} face "${pal}" is in render.js's PALETTE`);
    }
    for (const pal of item.colours ?? []) ok(pal in PALETTE, `${name}: ${f}'s colour "${pal}" is in render.js's PALETTE`);
  }
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
  ok(atlas.sheet.tw === TW && atlas.sheet.pad === pad, `${name}: atlas tw and pad are the pipeline's`,
    `tw ${atlas.sheet.tw}, pad ${atlas.sheet.pad}`);

  const frames = atlas.frames;
  for (const f of Object.keys(items)) ok(f in frames, `${name}: frame ${f} is in the atlas`);
  for (const f of Object.keys(frames)) ok(f in items, `${name}: frame ${f} is one budget.json names`);

  const at = (x, y) => (y * img.w + x) * 4;
  const covered = new Uint8Array(img.w * img.h);
  for (const [f, r] of Object.entries(frames)) {
    const item = items[f];
    if (!item || !boxOf(item)) continue;
    const want = frameBox(item);
    ok(r.w === want.w && r.h === want.h, `${name}: ${f} is its box's size`,
      `${r.w} x ${r.h}, want ${want.w} x ${want.h}`);
    ok(r.ax === want.ax && r.ay === want.ay, `${name}: ${f} is anchored on the square's centre`,
      `(${r.ax}, ${r.ay}), want (${want.ax}, ${want.ay})`);
    if (!ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= img.w && r.y + r.h <= img.h,
      `${name}: ${f} is inside the sheet`, `${r.x},${r.y} ${r.w} x ${r.h}`)) continue;

    let solid = 0, clash = 0, top = Infinity, left = Infinity, right = -Infinity;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (r.y + y) * img.w + r.x + x;
        if (covered[i]) clash++;
        covered[i] = 1;
        if (img.px[i * 4 + 3] >= 128) {
          solid++;
          top = Math.min(top, y); left = Math.min(left, x); right = Math.max(right, x + 1);
        }
      }
    }
    ok(clash === 0, `${name}: ${f} overlaps no other frame`, `${clash} pixels shared`);
    const cover = solid / (r.w * r.h);
    ok(cover >= item.minCoverage, `${name}: ${f} is covered`,
      `${(cover * 100).toFixed(1)}% opaque, floor ${(item.minCoverage * 100).toFixed(0)}%`);

    // The box it replaces (style sheet item 1): render.js's prism at this
    // height and footprint, in frame pixels. A block's top is the top
    // diamond's far corner. A figure stands in the box rather than filling
    // it, so its top may come down as far as the top diamond's centre, the
    // prism's height over the square. Its sides are the diamond's left and
    // right corners.
    const [ht, fp] = boxOf(item);
    const boxTop = r.ay - 2 * ht - (TW / 4) * fp;
    const boxH = 2 * ht + (TW / 2) * fp;
    const slack = budget.boxSlack * boxH;
    const lowest = item.figure ? r.ay - 2 * ht : boxTop;
    ok(top >= boxTop - slack && top <= lowest + slack, `${name}: ${f} stands as tall as its box`,
      `top at ${top}, box top ${boxTop.toFixed(1)}${item.figure ? ` to ${lowest.toFixed(1)}` : ''}, slack ${slack.toFixed(1)}`);
    const half = (TW / 2) * fp, sideSlack = budget.boxSlack * 2 * half;
    ok(left >= r.ax - half - sideSlack && right <= r.ax + half + sideSlack,
      `${name}: ${f} is no wider than its box`,
      `${left} to ${right}, box ${(r.ax - half).toFixed(1)} to ${(r.ax + half).toFixed(1)}, slack ${sideSlack.toFixed(1)}`);

    // Each face's centre, as a median of the 5 x 5 pixels round it so a joint
    // line does not decide it.
    const faceAt = {
      top: [r.ax, r.ay - 2 * ht],
      left: [r.ax - (TW / 4) * fp, r.ay + (TW / 8) * fp - ht],
      right: [r.ax + (TW / 4) * fp, r.ay + (TW / 8) * fp - ht],
    };
    const median = (cx, cy) => [0, 1, 2, 3].map(c => {
      const vals = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        vals.push(img.px[at(r.x + Math.round(cx) + dx, r.y + Math.round(cy) + dy) + c]);
      }
      return vals.sort((a, b) => a - b)[12];
    });
    for (const [face, pal] of Object.entries(item.faces ?? {})) {
      if (!(pal in PALETTE)) continue;
      const got = median(...faceAt[face]), want = hex(PALETTE[pal]);
      const off = Math.max(...want.map((v, c) => Math.abs(v - got[c])));
      ok(got[3] === 255 && off <= budget.faceTolerance, `${name}: ${f}'s ${face} face is ${pal}`,
        `rgba(${got.join(',')}) against ${PALETTE[pal]}, ${off} off`);
    }
    // A mask (#796): red, green and blue are how much of the build's top,
    // left and right colour a pixel takes, so each has to lead somewhere, and
    // a pixel any palette's render would show has some of at least one.
    if (item.mask) {
      const lead = [0, 0, 0];
      let opaque = 0, black = 0;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = at(r.x + x, r.y + y);
        if (img.px[i + 3] < 128) continue;
        opaque++;
        const c = [img.px[i], img.px[i + 1], img.px[i + 2]];
        if (Math.max(...c) < 8) black++;
        for (let k = 0; k < 3; k++) {
          if (c[k] > 32 + Math.max(...c.filter((_, j) => j !== k))) lead[k]++;
        }
      }
      for (let k = 0; k < 3; k++) {
        ok(lead[k] >= 0.05 * opaque, `${name}: ${f}'s ${['top', 'left', 'right'][k]} channel ${'RGB'[k]} leads somewhere`,
          `${lead[k]} of ${opaque} opaque pixels`);
      }
      ok(black <= 0.02 * opaque, `${name}: ${f} has no mask pixel that no palette would light`,
        `${black} of ${opaque}`);
    }
    // A figure in fixed colours: its median opaque pixel has the hue of the
    // first PALETTE colour it names, as the share each channel takes of the
    // pixel's sum, within 0.06. The light scales a colour without turning it,
    // so a frame rendered in another figure's colours fails, and a bound on
    // brightness alone did not (the foe in the boss's colours passed one).
    if (item.colours) {
      const vals = [[], [], []];
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = at(r.x + x, r.y + y);
        if (img.px[i + 3] < 255) continue;
        for (let k = 0; k < 3; k++) vals[k].push(img.px[i + k]);
      }
      const med = vals.map(v => v.sort((a, b) => a - b)[v.length >> 1]);
      const want = hex(PALETTE[item.colours[0]] ?? '#000000');
      const share = c => { const t = c[0] + c[1] + c[2] || 1; return c.map(v => v / t); };
      const got = share(med), aim = share(want);
      const off = Math.max(...got.map((v, k) => Math.abs(v - aim[k])));
      ok(off <= 0.06, `${name}: ${f} is drawn in ${item.colours[0]}'s hue`,
        `median rgb(${med.join(',')}) against ${PALETTE[item.colours[0]]}, ${off.toFixed(3)} off`);
    }
  }
  let stray = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (!covered[y * img.w + x] && img.px[at(x, y) + 3] !== 0) stray++;
  }
  ok(stray === 0, `${name}: nothing drawn outside the frames`, `${stray} pixels`);

  // The folder holds the sheets and nothing budget.json does not name.
  const dir = path.dirname(pngPath);
  for (const f of fs.readdirSync(dir)) {
    ok(named.has(path.resolve(dir, f)), `${name}: ${path.join(path.relative(PROJECT, dir), f)} is named in budget.json`);
  }
  console.log(`  ${Object.keys(frames).length} frames, ${img.w} x ${img.h}, ${buf.length} bytes`);
}

console.log(`\nvalidate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
