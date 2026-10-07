// tools/postcard-check.mjs — the postcard, as the PNG a browser actually
// hands over.
//
// tests/mapview.mjs paints js/postcard.js into a recorder and
// tests/smoke.mjs follows the button through a stubbed canvas; neither has
// a pixel. This boots the real page in real Chromium on a seeded save,
// presses Save a postcard, takes the download, and reads it: the PNG's own
// header for its size, the bytes against a second press and against a
// press after a reload, and known pixels (the paper, the card's rule, a
// clearing and a path cell at the place mapview.js says they are, ink
// where the name is set). It also watches every request the page makes and
// the save before and after.
//
// Exits non-zero on any failure (#13). Run it from this folder:
//   node tools/postcard-check.mjs
//   CHROME=/path/to/chrome node tools/postcard-check.mjs
//   OUT=/somewhere node tools/postcard-check.mjs   (keeps the PNG there)
//
// Lives under tools/ beside the camera and the touch check for the same
// reason they do: it needs playwright-core and a Chromium on disk. The
// bytes are not pinned to a hash, because text is rasterised by the
// machine's own font stack; the hash is printed.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SITE = path.resolve(HERE, '../../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SAVE_KEY = 'renn-faire-sim-save-v1';
const mod = p => pathToFileURL(path.join(ROOT, p)).href;

const State = await import(mod('js/state.js'));
const P = await import(mod('js/postcard.js'));
const M = await import(mod('js/mapview.js'));
const { TERRAIN_FILL, INK, PAPER } = await import(mod('js/plat.js'));
const { terrainAt } = await import(mod('js/engine.js'));

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PAGE = `${ORIGIN}/Projects/Ren-Faire-Claude/index.html`;

// The seeded faire: three plots, Friday played with a fixed seed.
let seeded = State.createInitialState();
seeded = State.buildPlot(seeded, 'stage', 8, 5).state;
seeded = State.buildPlot(seeded, 'food', 6, 3).state;
seeded = State.buildPlot(seeded, 'vendor', 4, 3).state;
seeded = State.nextDay(State.runDay(seeded, 4101).state).state;
const empty = State.createInitialState();

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-lcd-text'] });
const hex = ([r, g, b]) => '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

async function open(save) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [SAVE_KEY, JSON.stringify({ ...save, __v: 2 })]);
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => requests.push(r.url()));
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('.grounds-map');
  return { ctx, page, errors, requests };
}
async function pressAndTake(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#grounds [data-action="savePostcard"]'),
  ]);
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(file) };
}
// Pixels of a PNG, read by the browser that made it.
const pixelsOf = (page, bytes, points) => page.evaluate(async ([b64, pts]) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const at = (x, y) => { const i = (Math.round(y) * c.width + Math.round(x)) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  const count = (box, rgb) => { let n = 0; for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const p = at(x, y); if (p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]) n++; } return n; };
  return { w: c.width, h: c.height, opaque, points: pts.map(p => at(p.x, p.y)), title: count({ x: 816, y: 56, w: 344, h: 70 }, [0x3B, 0x2A, 0x1A]), spill: count({ x: 1161, y: 40, w: 39, h: 720 }, [0x3B, 0x2A, 0x1A]) };
}, [bytes.toString('base64'), points]);

try {
  const { ctx, page, errors, requests } = await open(seeded);
  const saveBefore = await page.evaluate(k => localStorage.getItem(k), SAVE_KEY);
  const first = await pressAndTake(page);

  // The button rides the zoom buttons' row; a row of its own made the
  // sticky plat taller than a 1280 x 800 window and put the top of the map
  // under the header (Tools/board-check/play-games.mjs could not click it).
  const row = () => page.evaluate(() => {
    const top = sel => Math.round(document.querySelector(sel).getBoundingClientRect().top);
    return { postcard: top('#grounds [data-action="savePostcard"]'), fit: top('#grounds [data-action="mapFit"]'), overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  const wide = await row();
  assert(wide.postcard === wide.fit && !wide.overflow, `at 1280 the postcard button is on the zoom buttons' row (${wide.postcard} against ${wide.fit})`);
  await page.setViewportSize({ width: 375, height: 812 });
  const narrow = await row();
  assert(narrow.postcard === narrow.fit && !narrow.overflow, `and at 375, with nothing running off the side (${narrow.postcard} against ${narrow.fit})`);
  await page.setViewportSize({ width: 1280, height: 900 });

  // The file.
  assert(first.name === 'faire-weekend-season-1-weekend-1-saturday.png', `the download is named for the day (${first.name})`);
  assert(first.bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'it is a PNG');
  const w = first.bytes.readUInt32BE(16), h = first.bytes.readUInt32BE(20);
  assert(w === P.POSTCARD.w && h === P.POSTCARD.h, `its header says 1200 x 800 (${w} x ${h})`);
  await page.waitForFunction(() => /^Saved /.test(document.querySelector('#grounds .plat-readout').textContent), null, { timeout: 5000 });
  assert(await page.evaluate(() => document.querySelector('#grounds .plat-readout').textContent) === `Saved ${first.name}.`, 'the readout under the plat names the file');

  // The same state is the same bytes: pressed again, and after a reload.
  const second = await pressAndTake(page);
  assert(sha(second.bytes) === sha(first.bytes), 'a second press saves the same bytes');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.grounds-map');
  const third = await pressAndTake(page);
  assert(sha(third.bytes) === sha(first.bytes), 'and so does a press after a reload, before the page has used all three typefaces');
  assert(await page.evaluate(k => localStorage.getItem(k), SAVE_KEY) === saveBefore, 'the save is byte for byte what it was before the first press');
  assert(await page.evaluate(() => document.querySelectorAll('canvas').length === 1 && !document.querySelector('a[download]')), 'nothing is left on the page: one canvas, the plat’s, and no link');

  // Known pixels, at the places mapview.js puts them.
  const model = P.postcardModel(seeded);
  const view = P.postcardView(model);
  const inCell = (x, y, dx, dy) => { const r = M.cellToRect(view, x, y); return { x: r.x + dx * view.scale, y: r.y + dy * view.scale }; };
  assert(terrainAt(0, 0) === 'clearing' && terrainAt(5, 2) === 'path' && terrainAt(8, 0) === 'woods', 'sanity: the three cells sampled are the terrain the check expects');
  const points = [
    { x: 5, y: 5 },                 // paper, outside the card's rule
    { x: 10, y: 400 },              // the rule's heavy line
    { x: 790, y: 400 },             // paper, between the plat and the column
    inCell(0, 0, 1.5, 1.5),         // a clearing cell, clear of its dot lattice
    inCell(5, 2, 3, 3),             // a path cell, between two ticks
    { x: 816 + 100, y: 213 },       // the rule under the name
  ];
  const px = await pixelsOf(page, first.bytes, points);
  assert(px.w === 1200 && px.h === 800 && px.opaque, 'decoded, it is 1200 x 800 and opaque edge to edge');
  assert(hex(px.points[0]) === PAPER && hex(px.points[2]) === PAPER, `the card is paper where nothing is drawn (${hex(px.points[0])}, ${hex(px.points[2])})`);
  assert(hex(px.points[1]) === INK && hex(px.points[5]) === INK, `its rule and the rule under the name are ink (${hex(px.points[1])}, ${hex(px.points[5])})`);
  assert(hex(px.points[3]) === TERRAIN_FILL.clearing.toUpperCase(), `cell (0,0) is clearing green where the view says it is (${hex(px.points[3])})`);
  assert(hex(px.points[4]) === TERRAIN_FILL.path.toUpperCase(), `cell (5,2) is path brown where the view says it is (${hex(px.points[4])})`);
  assert(px.title > 400, `the name is set in ink in the column (${px.title} ink pixels)`);
  assert(px.spill === 0, `and nothing set in the column runs past its right edge (${px.spill} ink pixels east of it)`);
  assert(await page.evaluate(() => document.fonts.check("600 60px 'Grenze Gotisch'") && document.fonts.check("italic 400 30px 'Fraunces'")), 'with the page’s own faces loaded');

  // A different faire is a different card: the plots are on it.
  const other = await open(empty);
  const bare = await pressAndTake(other.page);
  assert(bare.name === 'faire-weekend-season-1-weekend-1-friday.png' && sha(bare.bytes) !== sha(first.bytes), 'an empty Friday saves a different file with different bytes');
  const stage = M.cellToRect(view, 8, 5, 2, 2);
  const mid = [{ x: stage.x + stage.w / 2, y: stage.y + 6 * view.scale }];
  const withPlot = await pixelsOf(page, first.bytes, mid), without = await pixelsOf(page, bare.bytes, mid);
  assert(hex(withPlot.points[0]) !== hex(without.points[0]), `where the stage stands the two cards differ (${hex(withPlot.points[0])} against ${hex(without.points[0])})`);
  await other.ctx.close();

  // Entirely offline: every request went to the page's own server.
  const offsite = requests.filter(u => !u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:'));
  assert(offsite.length === 0, `no request left the site (${offsite.join(', ') || 'none'})`);
  assert(requests.some(u => u.endsWith('/assets/sprites/markers.png')), 'the marker sheet came from the project’s own assets');
  assert(errors.length === 0, `no page error (${errors.join(' | ') || 'none'})`);

  if (process.env.OUT) {
    fs.mkdirSync(process.env.OUT, { recursive: true });
    fs.writeFileSync(path.join(process.env.OUT, first.name), first.bytes);
    fs.writeFileSync(path.join(process.env.OUT, bare.name), bare.bytes);
  }
  console.log(`sha256 ${sha(first.bytes)} (${first.bytes.length} bytes, this machine's fonts)`);
  await ctx.close();
} catch (e) {
  fail++;
  console.error(`FAIL: the check did not finish: ${e && e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
