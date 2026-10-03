// node blender/dioramas.mjs [--rendered [--preview] [card ...]] [dioramas.json]
//
// Checks the board cards' dioramas (BACKLOG.md "The site itself: Blender
// dioramas") against dioramas.json, the style sheet diorama.py renders from.
// Exits 1 on any failure (#13). With no flags it needs no Blender and no
// browser, so Site CI runs it:
//
//   - the style's size is not 33:20 (promote-previews.mjs crops its 330 by
//     200 preview and 1200 by 630 og card from that shape) or is under 2640
//   - a card is not a preview name index.html asks for, or is Castle
//     Conundrum, whose images stay as they are (#491)
//   - promote-previews.mjs's KNOWN set is not exactly the preview names
//     index.html's cards ask for (School Generator was missing from it until
//     D1, so its card could not be promoted)
//   - a card names a .glb that does not exist, a shape kind diorama.py does
//     not build, or puts anything off the plinth's top: a shape's whole
//     footprint, at its first copy and its last (#850)
//   - a block, prism, ball, dots or ring leaves out a field diorama.py reads
//
// With --rendered (`npm run dioramas` passes it after a render) it also reads
// each card's candidates/<card>-diorama.png, untracked, so CI cannot, and
// holds it to the frame: the style's size, and everything that is not
// backdrop inside `frame.safe` and at least `frame.minWidth` of the frame
// across. A pixel is backdrop when it is within `frame.tolerance` of its
// row's colour at the frame's left edge (the median of pixels 1 to 5; the
// outermost pixel ring is the denoiser's padding and is not read, #853): the
// backdrop is a vertical gradient, so a row is one colour. A missing render fails rather than skips. Named
// cards narrow it to those; --preview reads diorama.py --preview's quarter-
// size frames from out/ instead.
//
// The optional dioramas.json argument points it at another file, which is how
// the guard-rails are broken on purpose (#34) without touching the real one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const rendered = argv.includes('--rendered');
const preview = argv.includes('--preview');
const jsonArg = argv.find(a => a.endsWith('.json'));
const named = argv.filter(a => !a.startsWith('--') && !a.endsWith('.json'));
const spec = JSON.parse(fs.readFileSync(path.resolve(jsonArg || path.join(HERE, 'dioramas.json')), 'utf8'));
const style = spec.style;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};

// ---------------------------------------------------------------- the style

const [W, H] = style.size;
ok(W * 20 === H * 33, 'style.size is 33:20', `${W} by ${H}`);
ok(W >= 2640, 'style.size is at least 2640 wide', `${W}`);
ok(typeof spec.machine === 'string' && spec.machine.length > 0, 'dioramas.json names the machine every render comes from');
const safe = style.frame.safe;
ok(safe[0] >= 0 && safe[1] >= 0 && safe[2] <= 1 && safe[3] <= 1 && safe[0] < safe[2] && safe[1] < safe[3],
  'frame.safe is a window inside the frame', JSON.stringify(safe));
// the og card keeps the top 1386 of 1600 rows (1200:630 from 33:20, anchored
// at 0.42 and clamped to the top), so anything below that is cut off it
ok(safe[3] <= (W / (1200 / 630)) / H, 'frame.safe stays above the og card\'s crop', `y1 ${safe[3]}`);

// ---------------------------------------------------------------- the board

const index = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const previews = new Set([...index.matchAll(/data-preview="assets\/previews\/([a-z0-9-]+)\.jpg"/g)].map(m => m[1]));
const promote = fs.readFileSync(path.join(HERE, '..', 'promote-previews.mjs'), 'utf8');
const knownSrc = promote.match(/const KNOWN = new Set\(\[([\s\S]*?)\]\)/);
const known = new Set(knownSrc ? [...knownSrc[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]) : []);
ok(knownSrc, 'promote-previews.mjs has a KNOWN set');
for (const n of previews) ok(known.has(n), `promote-previews.mjs KNOWN has ${n}`, 'index.html has a card that previews it');
for (const n of known) ok(previews.has(n), `index.html has a card previewing ${n}`, 'promote-previews.mjs KNOWN lists it');

const shapeSrc = fs.readFileSync(path.join(HERE, 'diorama.py'), 'utf8').match(/SHAPES = \{([^}]*)\}/);
const kinds = new Set(shapeSrc ? [...shapeSrc[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]) : []);
const [tw, td] = style.plinth.top;
const onTop = ([x, y]) => Math.abs(x) <= tw / 2 + 1e-9 && Math.abs(y) <= td / 2 + 1e-9;

// The fields each of the five plain solids reads (#850): one missing is a
// KeyError on Devon's machine, so it fails here, where CI sees it.
const NEEDS = {
  block: ['at', 'size', 'colour'], prism: ['at', 'size', 'colour'], ball: ['at', 'r', 'colour'],
  dots: ['r', 'colour'], ring: ['at', 'r', 'w', 'h', 'colour'],
};

// Copy k of a shape with `count` and `step`, as diorama.py's repeat() moves it.
const copy = (s, k) => {
  const [dx, dy] = (s.step || [0, 0]).map(v => v * k);
  const t = { ...s };
  for (const key of ['at', 'from', 'to']) if (s[key]) t[key] = [s[key][0] + dx, s[key][1] + dy];
  if (s.poly) t.poly = s.poly.map(([x, y]) => [x + dx, y + dy]);
  if (s.path) t.path = s.path.map(([x, y, ...z]) => [x + dx, y + dy, ...z]);
  return t;
};

// Every point of the plinth top a shape covers: its polygon, its ends, its
// path, the corners of a `size` turned `rot`, a ball's radius and a ring's
// outer edge or tick ends. A `scatter` keeps itself inside the top.
const footprint = s => {
  const pts = [...(s.poly || []), ...[s.at, s.from, s.to].filter(Boolean), ...(s.path || []).map(([x, y]) => [x, y])];
  const around = (hw, hd, rot = 0) => {
    const a = rot * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) pts.push([s.at[0] + u * c - v * n, s.at[1] + u * n + v * c]);
  };
  if (s.at && s.size) around(s.size[0] / 2, s.size[1] / 2, s.rot);
  if (s.at && s.kind === 'ball') { const r = [].concat(s.r); around(r[0], r[1 % r.length], s.rot); }
  if (s.at && s.kind === 'ring') { const e = s.ticks ? s.r + s.w + s.tick : s.r + s.w / 2; around(e, e); }
  return pts;
};

for (const [card, c] of Object.entries(spec.cards)) {
  ok(previews.has(card), `${card} is a preview name index.html asks for`);
  ok(card !== 'castle-conundrum', 'Castle Conundrum has no diorama (#491)');
  ok(fs.existsSync(path.join(SITE, c.project)), `${card}: project ${c.project} exists`);
  for (const [i, s] of (c.shapes || []).entries()) {
    ok(kinds.has(s.kind), `${card}: shape ${i} is a kind diorama.py builds`, s.kind);
    if (NEEDS[s.kind]) {
      const want = [...NEEDS[s.kind], ...(s.kind === 'dots' ? [s.path ? 'gap' : 'scatter'] : []), ...(s.ticks ? ['tick'] : [])];
      if (s.kind === 'dots' && !s.path) want.push('seed');
      const missing = want.filter(f => !(f in s));
      ok(!missing.length, `${card}: shape ${i} (${s.kind}) has the fields diorama.py reads`, `missing ${missing.join(', ')}`);
    }
    const n = s.count || 1;
    const pts = [...footprint(copy(s, 0)), ...footprint(copy(s, n - 1))];
    ok(pts.every(onTop), `${card}: shape ${i} (${s.kind}) is on the plinth top`, JSON.stringify(pts.filter(p => !onTop(p))));
  }
  for (const p of c.place || []) {
    const file = path.join(SITE, c.project, p.glb);
    ok(fs.existsSync(file), `${card}: ${p.glb} exists`);
    const step = p.step || [0, 0], n = p.count || 1;
    const last = [p.at[0] + step[0] * (n - 1), p.at[1] + step[1] * (n - 1)];
    ok(onTop(p.at) && onTop(last), `${card}: ${p.glb} stands on the plinth top`, JSON.stringify([p.at, last]));
  }
  // a 2D game's own sprite builders (#848): the script and its common.py,
  // and every call a function it defines or a frame of its BUILDERS
  for (const b of c.build || []) {
    const file = path.join(SITE, c.project, b.build);
    if (ok(fs.existsSync(file), `${card}: ${b.build} exists`)) {
      ok(fs.existsSync(path.join(path.dirname(file), 'common.py')), `${card}: ${b.build} has a common.py beside it`);
      const src = fs.readFileSync(file, 'utf8');
      const frames = src.match(/^BUILDERS = \{([\s\S]*?)^\}/m);
      for (const [fn] of b.calls) {
        ok(new RegExp(`^def ${fn}\\(`, 'm').test(src) || (frames && frames[1].includes(`'${fn}':`)),
          `${card}: ${b.build} builds ${fn}`);
      }
    }
    const step = b.step || [0, 0], n = b.count || 1;
    const last = [b.at[0] + step[0] * (n - 1), b.at[1] + step[1] * (n - 1)];
    ok(onTop(b.at) && onTop(last), `${card}: ${b.calls.map(x => x[0]).join('+')} stands on the plinth top`, JSON.stringify([b.at, last]));
  }
}

// ---------------------------------------------------------------- the renders

async function frame({ b64, tol }) {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  // The denoiser pads the frame's outermost pixels (Torchbearer's top-left
  // corner came out 32,24,15 among 39,25,12), so that ring is not scanned and
  // a row's backdrop is the median of its next five pixels, not one (#853).
  const med = (r, c) => [1, 2, 3, 4, 5].map(x => px[r + x * 4 + c]).sort((a, b) => a - b)[2];
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 1; y < h - 1; y++) {
    const r = y * w * 4;
    const br = med(r, 0), bg = med(r, 1), bb = med(r, 2);
    for (let x = 1; x < w - 1; x++) {
      const i = r + x * 4;
      if (Math.abs(px[i] - br) > tol || Math.abs(px[i + 1] - bg) > tol || Math.abs(px[i + 2] - bb) > tol) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { w, h, box: x1 < 0 ? null : [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h] };
}

if (rendered) {
  const { launch } = await import('../harness.mjs');
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  const dir = preview ? path.join(HERE, 'out') : path.join(HERE, '..', 'candidates');
  const scale = preview ? 0.25 : 1;
  const cards = named.length ? named : Object.keys(spec.cards);
  for (const card of cards) {
    if (!ok(card in spec.cards, `${card} is in dioramas.json`)) continue;
    const file = path.join(dir, `${card}-diorama.png`);
    if (!ok(fs.existsSync(file), `${card}: ${path.relative(SITE, file).split(path.sep).join('/')} exists`, 'render it first')) continue;
    const f = await page.evaluate(frame, { b64: fs.readFileSync(file).toString("base64"), tol: style.frame.tolerance });
    ok(f.w === Math.round(W * scale) && f.h === Math.round(H * scale), `${card}: render is ${W * scale} by ${H * scale}`, `${f.w} by ${f.h}`);
    if (!ok(f.box, `${card}: render has something in it besides the backdrop`)) continue;
    const [bx0, by0, bx1, by1] = f.box;
    const fmt = f.box.map(v => v.toFixed(3)).join(', ');
    ok(bx0 >= safe[0] && by0 >= safe[1] && bx1 <= safe[2] && by1 <= safe[3],
      `${card}: the diorama sits inside frame.safe`, `[${fmt}] against [${safe.join(', ')}]`);
    ok(bx1 - bx0 >= style.frame.minWidth, `${card}: the diorama spans at least ${style.frame.minWidth} of the frame`,
      `${(bx1 - bx0).toFixed(3)}`);
    console.log(`  ${card.padEnd(16)} ${f.w}x${f.h}  subject [${fmt}]`);
  }
  await browser.close();
}

console.log(`\ndioramas.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
