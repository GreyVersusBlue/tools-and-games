// make-placeholders.mjs: writes one flat WebP per manifest entry at its exact pixel size
// (ARCHITECTURE 9.3) and map-cairo-geo.json (9.2). Usage: node tools/make-placeholders.mjs
// `--geo` writes map-cairo-geo.json alone, with no browser.
//
// The encoder is the harness's Chromium (canvas.toBlob('image/webp')), so this needs the
// install in Tools/board-check and nothing else. Under a display-less shell use xvfb-run -a
// only if the launch asks for a display; the launch here is headless.
// It rewrites assets/art/manifest.json's placeholderHash list and nothing else in it, and
// it never overwrites a file whose entry is final.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ART = path.join(ROOT, 'assets', 'art');
const HARNESS = path.resolve(ROOT, '..', '..', 'Tools', 'board-check', 'harness.mjs');

// Fill colours by kind, from the palette in css/tokens.css (paper, brass, lapis, nile, madder).
const FILL = { still: '#284c78', good: '#a8792c', token: '#4f6b3a', object: '#efe6d2' };
const TEXT = { still: '#efe6d2', good: '#14110d', token: '#efe6d2', object: '#2a2118' };
const QUALITY = 0.8;

// ---- the map: equirectangular, longitude -10 to 80, latitude 5 to 48, scaled for latitude 27
export const EXTENT = { lonMin: -10, lonMax: 80, latMin: 5, latMax: 48, scaleLat: 27 };
export const MAP = { w: 1920, h: 1080 };
const KX = Math.cos(EXTENT.scaleLat * Math.PI / 180); // pixels per degree of longitude, relative to latitude
const PAD = 48;                                         // table border, left and right
const SCALE = (MAP.w - 2 * PAD) / ((EXTENT.lonMax - EXTENT.lonMin) * KX); // pixels per degree of latitude
const PAD_Y = (MAP.h - (EXTENT.latMax - EXTENT.latMin) * SCALE) / 2;
const r1 = n => Math.round(n * 10) / 10;
export const project = (lat, lon) => [
  r1(PAD + (lon - EXTENT.lonMin) * KX * SCALE),
  r1(PAD_Y + (EXTENT.latMax - lat) * SCALE),
];

// ART.md A03's table, minus Caffa, plus Quseir, Walata and Genoa (DECISIONS 2026-11-16).
// The 20 stops of ART.md A03's table (version 2), which are stops.json's.
export const STOPS = [
  ['cairo', 'Cairo', 30.04, 31.24], ['aden', 'Aden', 12.79, 45.03],
  ['alexandria', 'Alexandria', 31.20, 29.92], ['calicut', 'Calicut', 11.25, 75.78],
  ['famagusta', 'Famagusta', 35.12, 33.95], ['hormuz', 'Hormuz', 27.07, 56.46],
  ['venice', 'Venice', 45.44, 12.33], ['damascus', 'Damascus', 33.51, 36.29],
  ['constantinople', 'Constantinople', 41.01, 28.98], ['aleppo', 'Aleppo', 36.20, 37.16],
  ['tunis', 'Tunis', 36.80, 10.18], ['tabriz', 'Tabriz', 38.08, 46.29],
  ['qus', 'Qus', 25.92, 32.76], ['samarkand', 'Samarkand', 39.65, 66.96],
  ['quseir', 'Quseir', 26.10, 34.28], ['tuat', 'Tuat', 27.87, -0.29],
  ['aydhab', 'Aydhab', 22.33, 36.49], ['walata', 'Walata', 17.30, -7.03],
  ['jeddah', 'Jeddah', 21.49, 39.19], ['gao', 'Gao', 16.27, -0.04],
];

export function geoJson() {
  const lats = [], lons = [];
  for (let la = EXTENT.latMax; la >= EXTENT.latMin; la--) lats.push(la);
  for (let lo = EXTENT.lonMin; lo <= EXTENT.lonMax; lo++) lons.push(lo);
  return {
    version: 1, placeholder: true, w: MAP.w, h: MAP.h, extent: EXTENT,
    // xy[i][j] is the [x, y] pixel of latitude lats[i], longitude lons[j]
    grid: { lats, lons, xy: lats.map(la => lons.map(lo => project(la, lo))) },
    stops: STOPS.map(([id, name, lat, lon]) => { const [x, y] = project(lat, lon); return { id, name, lat, lon, x, y }; }),
  };
}

function geoText(g) {
  const rows = g.grid.xy.map(r => '   ' + JSON.stringify(r)).join(',\n');
  const stops = g.stops.map(s => '  ' + JSON.stringify(s)).join(',\n');
  return `{\n "version": ${g.version}, "placeholder": true, "w": ${g.w}, "h": ${g.h},\n "extent": ${JSON.stringify(g.extent)},\n` +
    ` "grid": { "lats": ${JSON.stringify(g.grid.lats)}, "lons": ${JSON.stringify(g.grid.lons)},\n  "xy": [\n${rows}\n  ] },\n "stops": [\n${stops}\n ]\n}\n`;
}

export function manifestText(m) {
  const head = `{ "version": ${m.version},\n "assets": [\n`;
  const body = m.assets.map(a => '  ' + JSON.stringify(a)).join(',\n');
  const hashes = m.placeholderHash.map(h => '  ' + JSON.stringify(h)).join(',\n');
  return `${head}${body}\n ],\n "placeholderHash": [${hashes ? '\n' + hashes + '\n ' : ''}]\n}\n`;
}

// Runs inside the page: draws one placeholder and returns its WebP bytes as base64.
function draw({ w, h, kind, id, fill, ink, q }) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (kind === 'still') { g.fillStyle = fill; g.fillRect(0, 0, w, h); }
  else if (kind === 'object') {
    // a paper shape with a transparent margin, as a cutout has
    const m = Math.round(Math.min(w, h) * 0.04);
    g.fillStyle = fill; g.fillRect(m, m, w - 2 * m, h - 2 * m);
  } else {
    g.fillStyle = fill; g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.46, h * 0.46, 0, 0, Math.PI * 2); g.fill();
  }
  const px = Math.max(12, Math.round(Math.min(w, h) / 22));
  g.font = `${px}px sans-serif`; g.textBaseline = 'top'; g.fillStyle = ink;
  const pad = Math.round(Math.min(w, h) * (kind === 'still' ? 0.02 : 0.1));
  g.fillText(id, pad, pad);
  return new Promise(res => c.toBlob(b => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.readAsDataURL(b);
  }, 'image/webp', q));
}

async function main() {
  if (process.argv.includes('--geo')) {
    fs.writeFileSync(path.join(ART, 'map-cairo-geo.json'), geoText(geoJson()));
    console.log('wrote map-cairo-geo.json');
    return;
  }
  const manifestPath = path.join(ART, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { launch } = await import(pathToFileURL(HARNESS).href);
  const browser = await launch();
  const hashes = [];
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    for (const a of m.assets) {
      const file = path.join(ART, a.file);
      if (a.final) { console.log('skip (final)', a.file); continue; }
      const b64 = await page.evaluate(draw, { w: a.w, h: a.h, kind: a.kind, id: a.id, fill: FILL[a.kind], ink: TEXT[a.kind], q: QUALITY });
      const buf = Buffer.from(b64, 'base64');
      if (buf.length >= 20 * 1024) throw new Error(`${a.file} is ${buf.length} bytes, over the 20 KB placeholder limit`);
      fs.writeFileSync(file, buf);
      hashes.push(crypto.createHash('sha256').update(buf).digest('hex'));
    }
  } finally {
    await browser.close();
  }
  m.placeholderHash = hashes.sort();
  fs.writeFileSync(manifestPath, manifestText(m));
  fs.writeFileSync(path.join(ART, 'map-cairo-geo.json'), geoText(geoJson()));
  console.log(`wrote ${hashes.length} placeholders and map-cairo-geo.json`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}
