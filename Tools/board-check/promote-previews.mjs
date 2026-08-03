// promote-previews.mjs — turn chosen candidate PNGs into the two images the site
// wants for each quest.
//
//   npm run promote            # write both sizes for everything in chosen.json
//   npm run promote -- --dry   # encode and report sizes, write nothing
//
// Reads `candidates/chosen.json`: { "<preview-name>": "<candidate filename>" }.
// Writes, per entry:
//
//   assets/previews/<name>.jpg   330x200,  under 60 KB — the board's hover unfurl
//                                (spec: assets/previews/README.md)
//   assets/og/<name>.jpg         1200x630, under 300 KB — the share card that
//                                sync-social-tags.mjs points og:image at
//
// TWO SIZES FROM ONE FRAME, on purpose. The hover preview renders 165 px wide, so
// 330x200 is already 2x and anything bigger is wasted bytes on every board view.
// A share card at 330 px wide gets rejected or badly upscaled by crawlers, which
// want ~1200x630. Same chosen moment, two crops — so the thing someone sees on a
// shared link is the thing they'll see when they hover the notice.
//
// The captures are 33:20 (1.65:1) and og wants 1.905:1, so the card is
// centre-cropped vertically with the window pulled slightly ABOVE centre: in all
// seven frames the bottom of the shot is floor, flagstone or empty desk, and the
// subject sits at or above the midline.
//
// WHY NO IMAGE LIBRARY: sharp and jimp both mean a new dependency (and for sharp,
// a native build) in a folder whose whole premise is that `npm install` works in
// a sandbox with no CDN. Chrome is already here and already driving these
// captures, so the crop, resize and JPEG encode happen in a canvas. Downscaling
// 2640 px to 330 px in one drawImage step aliases badly — bilinear filtering
// samples a handful of every 64 source pixels — so this halves repeatedly and only
// does the final non-integer step at the end.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, SITE } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAND = path.join(HERE, 'candidates');

// Exactly the filenames index.html's data-preview attributes point at.
const KNOWN = new Set([
  'castle-conundrum', 'aphelion', 'golden-hour', 'fourth-quarter',
  'faire-weekend', 'closing-time', 'integer-foundry',
  'absalom-inheritance', 'daredevil', 'fracture-cycle', 'corner-and-kettle',
  'torchbearer', 'orbital',
]);

const OUTPUTS = [
  { dir: path.join(SITE, 'assets', 'previews'), w: 330, h: 200, maxKB: 60, label: 'preview' },
  { dir: path.join(SITE, 'assets', 'og'), w: 1200, h: 630, maxKB: 300, label: 'og card' },
];
const V_ANCHOR = 0.42; // crop window centre, as a fraction of source height

const dry = process.argv.includes('--dry');

const chosenPath = path.join(CAND, 'chosen.json');
if (!fs.existsSync(chosenPath)) {
  console.error(`no ${path.relative(HERE, chosenPath)}.\n` +
    'Run `npm run previews`, LOOK at candidates/, then write chosen.json as\n' +
    '  { "aphelion": "aphelion-00-aboard.png", ... }');
  process.exit(2);
}
const chosen = JSON.parse(fs.readFileSync(chosenPath, 'utf8'));

const bad = Object.keys(chosen).filter(k => !KNOWN.has(k));
if (bad.length) {
  console.error(`not preview names the board asks for: ${bad.join(', ')}\n` +
    `known: ${[...KNOWN].join(', ')}`);
  process.exit(2);
}

const browser = await launch();
const page = await browser.newPage();
await page.goto('about:blank');

let failures = 0;
for (const o of OUTPUTS) fs.mkdirSync(o.dir, { recursive: true });

/** Crop to the target aspect, downscale by halving, encode JPEG. Returns a Buffer. */
async function encode(b64, w, h, q) {
  const dataUrl = await page.evaluate(async ({ b64, w, h, q, anchor }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();

    // Crop to the output aspect first, so the halving loop never has to think
    // about two different ratios at once.
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const want = w / h;
    let cw = sw, ch = Math.round(sw / want), cx = 0, cy = 0;
    if (ch > sh) { ch = sh; cw = Math.round(sh * want); cx = Math.round((sw - cw) / 2); }
    if (ch < sh) cy = Math.max(0, Math.min(sh - ch, Math.round(sh * anchor - ch / 2)));

    let cur = document.createElement('canvas');
    cur.width = cw; cur.height = ch;
    let ctx = cur.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

    while (cur.width > w * 2 && cur.height > h * 2) {
      const next = document.createElement('canvas');
      next.width = Math.max(w, Math.floor(cur.width / 2));
      next.height = Math.max(h, Math.floor(cur.height / 2));
      const nctx = next.getContext('2d');
      nctx.imageSmoothingEnabled = true; nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
    }

    const final = document.createElement('canvas');
    final.width = w; final.height = h;
    const fctx = final.getContext('2d');
    fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(cur, 0, 0, w, h);
    return final.toDataURL('image/jpeg', q);
  }, { b64, w, h, q, anchor: V_ANCHOR });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

for (const [name, file] of Object.entries(chosen)) {
  const src = path.join(CAND, file);
  if (!fs.existsSync(src)) {
    failures++; console.log(`  FAIL  ${name.padEnd(17)} no such candidate: ${file}`);
    continue;
  }
  const b64 = fs.readFileSync(src).toString('base64');

  for (const o of OUTPUTS) {
    // Quality is the only knob worth turning; the dimensions are fixed by the
    // board's layout and by what crawlers accept.
    let out = null, usedQ = null;
    for (const q of [0.82, 0.76, 0.7, 0.62, 0.55]) {
      out = await encode(b64, o.w, o.h, q);
      usedQ = q;
      if (out.length <= o.maxKB * 1024) break;
    }
    const kb = (out.length / 1024).toFixed(1);
    const fits = out.length <= o.maxKB * 1024;
    if (!dry) fs.writeFileSync(path.join(o.dir, `${name}.jpg`), out);
    if (!fits) failures++;
    console.log(`  ${fits ? 'ok  ' : 'FAIL'}  ${name.padEnd(17)} ${o.label.padEnd(8)} ` +
      `${o.w}x${o.h}  q${usedQ}  ${kb} KB` +
      `${fits ? '' : `  OVER the ${o.maxKB} KB budget even at lowest quality`}`);
  }
}

await browser.close();
console.log(dry
  ? '\ndry run — rerun without --dry to write assets/'
  : `\nwrote assets/previews/*.jpg and assets/og/*.jpg`);
process.exit(failures ? 1 : 0);
