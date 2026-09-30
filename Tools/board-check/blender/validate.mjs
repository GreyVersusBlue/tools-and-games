// node blender/validate.mjs [--rendered] [budget.json]
//
// Checks the tavern plates budget.json names against the site's style sheet
// (BACKLOG.md "The site itself: the tavern set"), with no Blender, so the
// board-check job in Site CI runs it. It decodes each image in the harness's
// Chromium (the same one the previews are shot in), because a WebP has no
// pixels a bare Node can read. Exits 1 on any failure (#13):
//
//   - a plate is missing, is not the size budget.json says, or is over its
//     byte cap
//   - the room plate's walk lanes (budget.json `lanes`, room y ranges, sampled
//     across `laneX`) have a median luminance under `luminanceFloor`, which is
//     where a #0c0803 silhouette would stop reading against the floor
//   - a file under assets/tavern/ that budget.json does not name
//   - the camera's distance does not flatten table 0's top to the 0.28 the
//     canvas draws it at (budget.json `calibration.tabletop`)
//
// With --rendered, which `npm run tavern` passes after a render, it also reads
// out/calibrate.png (untracked, so CI cannot), rendered at the room plate's
// size, and holds each of the nine markers to `tolerance` room units of where
// the page will draw that room point, and the tabletop disc to the same 0.28;
// a missing calibration frame fails rather than skips. A render is held to
// this, its size, its lanes and its bytes, not to its hash: Cycles output
// is not byte-stable across runs, and #652's rule is for .glb files.
//
// The optional budget argument points it at another file; paths in it still
// resolve from the repo root. That is how the guard-rails are broken on
// purpose (#34) without touching the real one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, serve, launch, prepPage } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const rendered = argv.includes('--rendered');
const budgetPath = path.resolve(argv.find(a => !a.startsWith('--')) || path.join(HERE, 'budget.json'));
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const PORT = 8168;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};
const rel = p => p.split(path.sep).join('/');

// ---------------------------------------------------------------- in the page

// Runs inside Chromium. Loads a same-origin image, draws it, and returns what
// the checks need as numbers: the image's size, each lane's median luminance,
// and for a calibration frame the centroid of the bright pixels near each
// expected marker. Luminance is Rec. 709 on the 8-bit sRGB values, the same
// figure a designer's picker reads.
async function probe({ url, lanes, markers, window, blobs = [] }) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = (x, y) => {
    const i = (y * w + x) * 4;
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  };
  const laneOut = lanes.map(([x0, x1, y0, y1]) => {
    const v = [];
    for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1); y += 2)
      for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1); x += 4) v.push(lum(x, y));
    v.sort((a, b) => a - b);
    return { n: v.length, median: v.length ? v[v.length >> 1] : 0, min: v.length ? v[0] : 0 };
  });
  const markerOut = markers.map(([ex, ey]) => {
    const mx = Math.round(ex), my = Math.round(ey);    // pixel indices, or px[] reads undefined
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.max(0, my - window); y <= Math.min(h - 1, my + window); y++)
      for (let x = Math.max(0, mx - window); x <= Math.min(w - 1, mx + window); x++)
        if (lum(x, y) > 128) { sx += x + 0.5; sy += y + 0.5; n++; }
    return { n, x: n ? sx / n : NaN, y: n ? sy / n : NaN };
  });
  // the bounding box of the bright pixels inside each [x0, x1, y0, y1] window
  const blobOut = blobs.map(([x0, x1, y0, y1]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1); x++)
        if (lum(x, y) > 128) {
          n++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    return { n, w: n ? maxX - minX + 1 : 0, h: n ? maxY - minY + 1 : 0 };
  });
  return { w, h, lanes: laneOut, markers: markerOut, blobs: blobOut };
}

// ---------------------------------------------------------------- run

const server = await serve(PORT);
const browser = await launch();
let page;
try {
  page = await prepPage(browser, `http://127.0.0.1:${PORT}`, { width: 400, height: 300, dsf: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/Tools/board-check/blender/budget.json`, { waitUntil: 'load' });

  const fx = budget.camera.frame[0], fy = budget.camera.frame[1];

  // ---- the plates
  for (const [name, plate] of Object.entries(budget.plates)) {
    const file = path.join(SITE, plate.file);
    const exists = ok(fs.existsSync(file), `${name}: ${plate.file} is in the repo`);
    if (!exists) continue;
    const bytes = fs.statSync(file).size;
    ok(bytes <= plate.bytes, `${name}: bytes ${bytes.toLocaleString()} within ${plate.bytes.toLocaleString()}`);
    const sx = plate.width / budget.camera.frame[2];        // plate pixels per room unit
    const sy = plate.height / budget.camera.frame[3];
    const lanes = (plate.lanes || []).map(([y0, y1]) => [
      (plate.laneX[0] - fx) * sx, (plate.laneX[1] - fx) * sx, (y0 - fy) * sy, (y1 - fy) * sy]);
    let r;
    try {
      r = await page.evaluate(probe, { url: `/${rel(plate.file)}`, lanes, markers: [], window: 0 });
    } catch (e) {
      ok(false, `${name}: decodes in Chromium`, e.message.split('\n')[0]);
      continue;
    }
    ok(r.w === plate.width && r.h === plate.height,
      `${name}: ${plate.width}x${plate.height}`, `is ${r.w}x${r.h}`);
    r.lanes.forEach((lane, i) => {
      const [y0, y1] = plate.lanes[i];
      ok(lane.median >= plate.luminanceFloor,
        `${name}: walk lane y ${y0}..${y1} median luminance ${lane.median.toFixed(1)} at or above ${plate.luminanceFloor}`,
        `(${lane.n} samples, darkest ${lane.min.toFixed(1)})`);
    });
    console.log(`${name}: ${r.w}x${r.h}, ${bytes.toLocaleString()} bytes` +
      (r.lanes.length ? `, lanes ${r.lanes.map(l => l.median.toFixed(1)).join(' / ')}` : ''));
  }

  // ---- nothing unnamed beside them
  const dir = path.join(SITE, 'assets', 'tavern');
  const named = new Set(Object.values(budget.plates).map(p => rel(p.file)));
  const stray = fs.existsSync(dir)
    ? fs.readdirSync(dir).map(f => `assets/tavern/${f}`).filter(f => !named.has(f)) : [];
  ok(stray.length === 0, 'assets/tavern/ holds only what budget.json names', stray.join(', '));

  // ---- the camera's distance, from the canvas's own tabletop ellipse. A
  // level camera sees a small flat disc whose centre projects dy room units
  // below the horizon flattened to about dy * unit / distance; paintTable()
  // draws table 0's top at 0.28, so the budget's distance has to predict that.
  const top = budget.calibration.tabletop;
  const [tx, ty, tr] = top.table;
  const predicted = (ty - tr * 0.1 - budget.camera.horizon) * budget.unit / budget.camera.distance;
  ok(Math.abs(predicted - top.ratio) <= top.tolerance,
    `camera: distance ${budget.camera.distance} m flattens table 0's top to ${top.ratio} within ${top.tolerance}`,
    `predicts ${predicted.toFixed(3)}`);

  // ---- the calibration frame
  if (rendered) {
    const cal = budget.calibration;
    const file = path.join(SITE, cal.file);
    if (ok(fs.existsSync(file), `calibration: ${cal.file} was rendered`)) {
      // rendered at the size of the plate it stands for, so a marker is held
      // to where the page will draw that room point from the plate's pixels
      const plate = budget.plates[cal.plate];
      const sx = plate.width / budget.camera.frame[2], sy = plate.height / budget.camera.frame[3];
      const expected = cal.markers.map(([x, y]) => [(x - fx) * sx, (y - fy) * sy]);
      // the disc's window: 140 room units either side, 60 above and below,
      // clear of every marker
      const disc = [(tx - 140 - fx) * sx, (tx + 140 - fx) * sx, (ty - tr * 0.1 - 60 - fy) * sy, (ty - tr * 0.1 + 60 - fy) * sy];
      const r = await page.evaluate(probe, { url: `/${rel(cal.file)}?${Date.now()}`, lanes: [], markers: expected, window: 16, blobs: [disc] });
      ok(r.w === plate.width && r.h === plate.height,
        `calibration: frame is ${plate.width}x${plate.height}, the ${cal.plate} plate's size`, `is ${r.w}x${r.h}`);
      r.markers.forEach((m, i) => {
        const [x, y] = cal.markers[i];
        const [ex, ey] = expected[i];
        const off = m.n ? Math.hypot((m.x - ex) / sx, (m.y - ey) / sy) : Infinity;
        ok(m.n > 0 && off <= cal.tolerance,
          `calibration: marker (${x}, ${y}) lands within ${cal.tolerance} room units`,
          m.n ? `at (${(m.x / sx + fx).toFixed(1)}, ${(m.y / sy + fy).toFixed(1)}), ${off.toFixed(2)} off, ${m.n} px` : 'no bright pixels within 16 px');
      });
      const b = r.blobs[0];
      const ratio = b.n ? (b.h / sy) / (b.w / sx) : NaN;
      ok(b.n > 0 && Math.abs(ratio - top.ratio) <= top.tolerance,
        `calibration: the tabletop disc renders ${top.ratio} tall to wide within ${top.tolerance}`,
        b.n ? `is ${ratio.toFixed(3)}, ${(b.w / sx).toFixed(1)} by ${(b.h / sy).toFixed(1)} room units` : 'no bright pixels in its window');
      const worst = Math.max(...r.markers.map((m, i) => m.n ? Math.hypot((m.x - expected[i][0]) / sx, (m.y - expected[i][1]) / sy) : Infinity));
      console.log(`calibration: ${r.w}x${r.h}, worst marker ${worst.toFixed(2)} room units off, tabletop ${ratio.toFixed(3)}`);
    }
  }
} finally {
  if (page) await page.close();
  await browser.close();
  server.close();
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
