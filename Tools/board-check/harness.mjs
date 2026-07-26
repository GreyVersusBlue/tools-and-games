// harness.mjs — static server + headless Chromium, with two shims that let the
// site render fully offline:
//
//   fonts.googleapis.com/css2?...  ->  @font-face sheet built from @fontsource
//   cdn.jsdelivr.net/npm/three@X/  ->  the vendored copy in three-<ver>/
//
// Neither shim touches a file in the repo. They exist so a render is the real
// thing rather than a font-substituted, module-less approximation.
//
// See README.md for why the default is @sparticuz/chromium rather than
// Playwright, and the "browser" section below for the Windows/macOS fallback.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(HERE, '..', '..');
const NM = path.join(HERE, 'node_modules');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8',
};

/* ---------------- fonts: "Zilla Slab" -> @fontsource/zilla-slab ------------ */

const slug = f => f.toLowerCase().replace(/\+/g, '-').replace(/\s+/g, '-');

function fontFiles(pkg) {
  const dir = path.join(NM, '@fontsource', pkg, 'files');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.woff2')) : [];
}

function pickFile(pkg, weight, italic) {
  const style = italic ? 'italic' : 'normal';
  const cands = fontFiles(pkg).filter(
    f => f.includes('-latin-') && !f.includes('latin-ext') && f.endsWith(`-${style}.woff2`));
  if (!cands.length) return null;
  const wOf = f => { const m = f.match(/-(\d{3})-/); return m ? +m[1] : 400; };
  return cands.reduce((best, c) =>
    Math.abs(wOf(c) - weight) < Math.abs(wOf(best) - weight) ? c : best, cands[0]);
}

/** Turn a Google Fonts css2 URL into a local @font-face sheet. */
export function fontCssFor(url, base) {
  const out = [];
  for (const raw of [...url.matchAll(/family=([^&]+)/g)].map(m => decodeURIComponent(m[1]))) {
    const [namePart, axisPart] = raw.split(':');
    const family = namePart.replace(/\+/g, ' ');
    const pkg = slug(namePart);
    if (!fontFiles(pkg).length) { out.push(`/* no local package for ${family} */`); continue; }

    const combos = new Set();
    if (axisPart) {
      const axes = (axisPart.split('@')[0] || '').split(',');
      for (const tuple of (axisPart.split('@')[1] || '').split(';')) {
        const vals = tuple.split(',');
        let ital = 0, wght = 400;
        axes.forEach((ax, i) => {
          if (ax === 'ital') ital = +vals[i] || 0;
          if (ax === 'wght') wght = +vals[i] || 400;
        });
        if (axes.length === 1 && axes[0] === 'wght') wght = +vals[0] || 400;
        combos.add(`${ital}|${wght}`);
      }
    }
    if (!combos.size) combos.add('0|400');

    for (const c of combos) {
      const [ital, wght] = c.split('|').map(Number);
      const f = pickFile(pkg, wght, !!ital);
      if (f) out.push(
        `@font-face{font-family:'${family}';font-style:${ital ? 'italic' : 'normal'};` +
        `font-weight:${wght};font-display:block;` +
        `src:url('${base}/__fs/${pkg}/${f}') format('woff2')}`);
    }
  }
  return out.join('\n');
}

/* ---------------- server --------------------------------------------------- */

export function serve(port = 8123) {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400).end(); return; }

    let file;
    if (p.startsWith('/__fs/')) {
      const [, , pkg, name] = p.split('/');
      file = path.join(NM, '@fontsource', pkg, 'files', name);
    } else if (p.startsWith('/__three/')) {
      const rest = p.slice('/__three/'.length);
      const i = rest.indexOf('/');
      file = path.join(HERE, 'three-' + rest.slice(0, i), 'node_modules', 'three', rest.slice(i + 1));
    } else {
      file = path.join(SITE, p);
      if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    }

    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // GitHub Pages serves /404.html for any miss, including deep subpaths.
      // Mirror that, or the 404 page never gets exercised.
      const themed = path.join(SITE, '404.html');
      if (!p.startsWith('/__') && fs.existsSync(themed)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(themed).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 ' + p); return;
    }
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

/* ---------------- browser -------------------------------------------------- */

// @sparticuz/chromium ships a Chromium binary built for AWS Lambda's Linux
// runtime only — there's no Windows or macOS executable in the package at
// all, so `chromium.executablePath()` resolves to a path that doesn't exist
// there. Everywhere but Linux, drive whatever Chrome/Edge is already
// installed via Playwright instead. No browser download needed for that:
// `channel: 'chrome'` / `'msedge'` reuses the system install.
//
// `headed: true` opens a real visible window. Only play-castle.mjs wants that, and
// it wants it for a specific reason: the Pointer Lock API and real GPU rendering
// both need a browser that is actually compositing frames to a screen. Everything
// else stays headless.
export async function launch({ headed = false } = {}) {
  if (process.platform === 'linux') {
    const puppeteer = (await import('puppeteer-core')).default;
    const chromium = (await import('@sparticuz/chromium')).default;
    const browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(),
      headless: !headed,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--font-render-hinting=none', '--force-color-profile=srgb',
             '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
             '--hide-scrollbars', '--disable-lcd-text', '--mute-audio'],
    });
    browser.__engine = 'puppeteer';
    return browser;
  }

  const { chromium: pwChromium } = await import('playwright-core');
  let lastErr;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      const browser = await pwChromium.launch({
        channel,
        headless: !headed,
        args: ['--font-render-hinting=none', '--force-color-profile=srgb',
               '--hide-scrollbars', '--disable-lcd-text', '--mute-audio'],
      });
      browser.__engine = 'playwright';
      return browser;
    } catch (e) { lastErr = e; }
  }
  throw new Error(
    'No local Chrome or Edge found for Playwright to drive, and no bundled ' +
    'Chromium is installed. Install Google Chrome or Microsoft Edge, or run ' +
    '`npx playwright install chromium` inside Tools/board-check.\n' +
    `(last launch error: ${lastErr?.message})`);
}

/**
 * A page with both shims wired and error collection attached.
 * page.__errs    page errors, console errors, failed requests
 * page.__blocked offsite URLs that were refused (i.e. real external deps)
 */
/**
 * `allow` is a list of host substrings that are let through to the real network
 * instead of being refused and recorded. It exists for `capture-previews.mjs`:
 * Golden Hour hotlinks its sand texture from `dl.polyhaven.org` and falls back
 * to a procedural canvas texture when that's unreachable, so a blocked capture
 * shows a beach no visitor actually sees. Every other script leaves this empty —
 * the default of refusing everything offsite is what makes `page.__blocked` a
 * useful inventory of the site's real external dependencies.
 */
export async function prepPage(browser, base, { width = 1280, height = 1000, dsf = 2, mobile = false, jsEnabled = true, allow = [] } = {}) {
  const playwright = browser.__engine === 'playwright';
  let page, context;

  if (playwright) {
    context = await browser.newContext({
      viewport: { width, height }, deviceScaleFactor: dsf,
      hasTouch: mobile, isMobile: mobile, javaScriptEnabled: jsEnabled,
    });
    page = await context.newPage();
    const closePage = page.close.bind(page);
    page.close = async opts => { await closePage(opts); await context.close(); };
  } else {
    page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: dsf, hasTouch: mobile, isMobile: mobile });
    if (!jsEnabled) await page.setJavaScriptEnabled(false);
  }

  const blocked = [];
  const allowed = [];
  const handleUrl = u => {
    const m = u.match(/cdn\.jsdelivr\.net\/npm\/three@([\d.]+)\/(.*)$/);
    if (m) return `${base}/__three/${m[1]}/${m[2]}`;
    return null;
  };
  const isAllowed = u => {
    if (!allow.some(h => u.includes(h))) return false;
    allowed.push(u.split('?')[0]);
    return true;
  };

  if (playwright) {
    await page.route('**/*', route => {
      const u = route.request().url();
      if (/fonts\.googleapis\.com\/css/.test(u))
        return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: fontCssFor(u, base) });
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u))
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      const rewritten = handleUrl(u);
      if (rewritten) return route.continue({ url: rewritten });
      if (isAllowed(u)) return route.continue();
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) { blocked.push(u.split('?')[0]); return route.abort(); }
      route.continue();
    });
  } else {
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (/fonts\.googleapis\.com\/css/.test(u))
        return r.respond({ status: 200, contentType: 'text/css; charset=utf-8', body: fontCssFor(u, base) });
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u))
        return r.respond({ status: 200, contentType: 'text/css', body: '' });
      const rewritten = handleUrl(u);
      if (rewritten) return r.continue({ url: rewritten });
      if (isAllowed(u)) return r.continue();
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) { blocked.push(u.split('?')[0]); return r.abort(); }
      r.continue();
    });
  }

  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errs.push('reqfail: ' + r.url().slice(0, 120)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  page.__errs = errs;
  page.__blocked = blocked;
  page.__allowed = allowed;
  return page;
}

export const settle = async (page, ms = 700) => {
  await new Promise(r => setTimeout(r, ms));
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 300));
};
