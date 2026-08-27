#!/usr/bin/env node
// test/visual/run.mjs — screenshot regression for the printed sheets and the
// editor chrome. The WISHLIST called the blueprint canvas "the largest
// untested surface in the codebase"; this is the day's work it asked for.
//
//   node test/visual/run.mjs             compare against baselines/
//   node test/visual/run.mjs --update    rewrite baselines/ from this run
//   node test/visual/run.mjs --only floor-plan
//
// Needs a Playwright installation with its Chromium — but is *optional*
// tooling: the pure suite (`node --test test/*.test.mjs`) neither knows nor
// cares about this directory, and a machine without Playwright gets a
// message, not a failure. No package.json appears; the runtime stays
// build-free. See README.md here for what is covered and what is not.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));      // .../test/visual
const PROJECT = dirname(dirname(HERE));                     // .../school-generator
const REPO = dirname(dirname(PROJECT));                     // the site root (serves /assets)
const BASELINES = join(HERE, 'baselines');
const FAILURES = join(HERE, 'failures');

const UPDATE = process.argv.includes('--update');
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1] : null;

// A candidate is judged different if more than this fraction of its pixels
// moved by more than TOLERANCE on any channel — room for antialiasing
// wobble between Chromium builds, none for a real change.
const MAX_BAD_FRACTION = 0.001;
const TOLERANCE = 8;

// ---------- find playwright without owning a package.json ----------

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* keep looking */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(root, 'x'))('playwright');
  } catch { /* keep looking */ }
  return null;
}

// ---------- a static server for the tool, plus /assets from the site root ----------

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

// The sheet harness page: no app, no WebGL — just the pure modules the
// printable sheets are made of, plus the same faces index.html declares so
// the canvas text renders with the fonts a browser would actually use.
const SHEET_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Public Sans'; font-weight: 400; font-display: block;
  src: url('/assets/fonts/public-sans-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'Public Sans'; font-weight: 700; font-display: block;
  src: url('/assets/fonts/public-sans-latin-700-normal.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Mono'; font-weight: 400; font-display: block;
  src: url('/assets/fonts/ibm-plex-mono-latin-400-normal.woff2') format('woff2'); }
</style></head><body><script type="module">
window.renderSheet = async (which) => {
  await Promise.all([
    document.fonts.load('400 11px "Public Sans"'),
    document.fonts.load('700 11px "Public Sans"'),
    document.fonts.load('600 11px "Public Sans"'),
    document.fonts.load('400 10px "IBM Plex Mono"'),
  ]);
  const { buildSampleSchool } = await import('/js/sample.js');
  const bp = await import('/js/blueprint.js');
  const state = buildSampleSchool();
  // The title block prints today's date by default — pinned here, or the
  // baselines would expire at midnight.
  const DATE = '1/1/2026';
  const canvas = which === 'site'
    ? bp.renderSitePlanCanvas(state, { date: DATE })
    : bp.renderFloorPlanCanvas(state, Number(which), { showFurniture: true, showDimensions: true, date: DATE });
  return canvas.toDataURL('image/png');
};
window.__sheetReady = true;
</script></body></html>`;

function startServer() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p === '/__sheets.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(SHEET_PAGE);
      return;
    }
    const file = p.startsWith('/assets/') ? join(REPO, p) : join(PROJECT, p);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- the captures ----------

// Chrome captures hide the WebGL canvas first: the 3D view under the panels
// is a software rasterizer in CI and a GPU on a desk, and this harness is
// about the chrome, not the render. What remains is panels on the page's own
// background — fully deterministic.
const hideView = `document.getElementById('view').style.visibility = 'hidden';`;

const CAPTURES = [
  { name: 'sheet-floor-plan', sheet: '0' },
  { name: 'sheet-site-plan', sheet: 'site' },
  {
    name: 'chrome-edit', width: 1600, height: 950,
    prep: `${hideView}`,
  },
  {
    // Phase 19's opening moment: the one capture that *keeps* the first-run
    // state every other chrome capture pre-seeds away.
    name: 'chrome-welcome', width: 1600, height: 950, firstRun: true,
    prep: `${hideView}`,
  },
  {
    // ...and the command palette, opened by its own key so the capture
    // exercises the binding as well as the box.
    name: 'chrome-cmdk', width: 1600, height: 950,
    prep: `
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, bubbles: true }));
      ${hideView}`,
    settle: 600,
  },
  {
    name: 'chrome-rail', width: 1600, height: 950,
    // All five rail panels open, then the sky panel folded — exercises the
    // reorder, the folds and the aria state in one picture.
    prep: `
      for (const id of ['audio-btn','life-btn','report-btn','session-btn']) document.getElementById(id).click();
      document.querySelector('#env-panel .rail-fold').click();
      ${hideView}`,
    settle: 900,
  },
  {
    name: 'chrome-walk-overlay', width: 1600, height: 950,
    prep: `document.getElementById('mode-btn').click(); ${hideView}`,
    settle: 900,
  },
  {
    name: 'chrome-narrow', width: 900, height: 850,
    prep: `${hideView}`,
  },
];

async function captureSheet(context, port, which) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/__sheets.html`);
  await page.waitForFunction('window.__sheetReady === true');
  const dataUrl = await page.evaluate((w) => window.renderSheet(w), which);
  await page.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function capturePage(context, port, cap) {
  const page = await context.newPage();
  await page.setViewportSize({ width: cap.width, height: cap.height });
  // A fresh context is a first visit, and since Phase 19 a first visit gets
  // the opening moment. Every chrome capture pre-seeds the first-run flag so
  // it photographs the chrome it is named for — except the capture whose
  // whole subject *is* the first run.
  if (!cap.firstRun) {
    await page.addInitScript(
      `try { localStorage.setItem('sg-welcome-seen', '1'); } catch {}`);
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  if (cap.prep) await page.evaluate(cap.prep);
  await page.waitForTimeout(cap.settle || 400);
  if (errors.length) throw new Error(`${cap.name}: page errors — ${errors.join(' | ')}`);
  // CDP rather than page.screenshot(): under a software renderer the
  // screenshot helper can stall waiting on fonts while rAF is starved.
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await page.close();
  return Buffer.from(data, 'base64');
}

// ---------- the diff, run inside the browser (no image deps in node) ----------

async function diffImages(page, baseline, candidate) {
  return page.evaluate(async ([a, b, tol]) => {
    const load = (buf) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('bad png'));
      img.src = 'data:image/png;base64,' + buf;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    }
    const w = ia.width, h = ia.height;
    const read = (img) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, w, h);
    };
    const da = read(ia), db = read(ib);
    const out = new ImageData(w, h);
    let bad = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(
        Math.abs(da.data[i] - db.data[i]),
        Math.abs(da.data[i + 1] - db.data[i + 1]),
        Math.abs(da.data[i + 2] - db.data[i + 2]));
      if (d > tol) {
        bad++;
        out.data[i] = 255; out.data[i + 3] = 255;      // the change, in red
      } else {
        const g = Math.round((da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3);
        out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
        out.data[i + 3] = 60;                           // the context, faint
      }
    }
    let diffPng = null;
    if (bad) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').putImageData(out, 0, 0);
      diffPng = c.toDataURL('image/png').split(',')[1];
    }
    return { bad, total: w * h, diffPng };
  }, [baseline.toString('base64'), candidate.toString('base64'), TOLERANCE]);
}

// ---------- main ----------

const pw = await loadPlaywright();
if (!pw) {
  console.log('playwright is not installed — the visual harness needs it.');
  console.log('It is optional tooling: `npm i -g playwright && npx playwright install chromium`,');
  console.log('or run in an environment that already has it. The pure suite does not need it.');
  process.exit(2);
}

const server = await startServer();
const port = server.address().port;
const browser = await pw.chromium.launch();
const results = [];

try {
  for (const cap of CAPTURES) {
    if (only && cap.name !== only) continue;
    const context = await browser.newContext();     // fresh localStorage per capture
    const png = cap.sheet
      ? await captureSheet(context, port, cap.sheet)
      : await capturePage(context, port, cap);
    await context.close();

    const baselinePath = join(BASELINES, `${cap.name}.png`);
    if (UPDATE || !existsSync(baselinePath)) {
      const status = existsSync(baselinePath) ? 'updated' : 'created';
      await mkdir(BASELINES, { recursive: true });
      await writeFile(baselinePath, png);
      results.push({ name: cap.name, status, detail: `${png.length} bytes` });
      continue;
    }

    const baseline = await readFile(baselinePath);
    const diffPage = await browser.newPage();
    const diff = await diffImages(diffPage, baseline, png);
    await diffPage.close();

    if (diff.sizeMismatch) {
      results.push({ name: cap.name, status: 'FAIL', detail: `size ${diff.sizeMismatch}` });
    } else if (diff.bad / diff.total > MAX_BAD_FRACTION) {
      await mkdir(FAILURES, { recursive: true });
      await writeFile(join(FAILURES, `${cap.name}.png`), png);
      if (diff.diffPng) {
        await writeFile(join(FAILURES, `${cap.name}-diff.png`), Buffer.from(diff.diffPng, 'base64'));
      }
      results.push({
        name: cap.name, status: 'FAIL',
        detail: `${diff.bad} of ${diff.total} px (${(100 * diff.bad / diff.total).toFixed(3)}%) — see failures/`,
      });
    } else {
      results.push({ name: cap.name, status: 'ok', detail: `${diff.bad} px moved` });
    }
  }
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  if (r.status === 'FAIL') failed++;
  console.log(`${r.status === 'FAIL' ? '✗' : '✓'} ${r.name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
}
if (!results.length) console.log(only ? `no capture named "${only}"` : 'nothing captured');
process.exit(failed ? 1 : 0);
