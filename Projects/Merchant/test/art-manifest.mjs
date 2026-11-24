// Art manifest check (ARCHITECTURE 7.6): node test/art-manifest.mjs
// Reads each WebP's own header (VP8, VP8L, VP8X) rather than trusting the manifest or a decoder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, ok, eq, done } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'assets', 'art');
const manifest = JSON.parse(fs.readFileSync(path.join(ART, 'manifest.json'), 'utf8'));
const KINDS = {
  still: { maxBytes: 409600 }, good: { w: 768, h: 768, maxBytes: 122880 },
  token: { w: 384, h: 384, maxBytes: 61440 }, object: { maxBytes: 153600 },
};

/** { w, h, format, alpha } from the first chunk of a WebP, or throws. */
export function webpInfo(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a RIFF WebP');
  const tag = buf.toString('latin1', 12, 16);
  if (tag === 'VP8 ') { // lossy: frame tag, start code 9d 01 2a, then 14-bit sizes
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new Error('VP8 start code missing');
    return { format: 'VP8', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, alpha: false };
  }
  if (tag === 'VP8L') { // lossless: signature 0x2f, then 14 bits of w-1 and 14 of h-1
    if (buf[20] !== 0x2f) throw new Error('VP8L signature missing');
    const b = buf.readUInt32LE(21);
    return { format: 'VP8L', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, alpha: !!((b >> 28) & 1) };
  }
  if (tag === 'VP8X') { // extended: flags byte (alpha is 0x10), then 24-bit w-1 and h-1
    return { format: 'VP8X', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1, alpha: !!(buf[20] & 0x10) };
  }
  throw new Error(`unknown first chunk "${tag}"`);
}

/** Every problem found, as strings; an empty list is a pass. */
export function check(m, dir) {
  const bad = [];
  const hashes = new Set(m.placeholderHash ?? []);
  const ids = new Set(), files = new Set();
  for (const a of m.assets) {
    const at = a.id ?? a.file ?? '(no id)';
    if (ids.has(a.id)) bad.push(`${at}: duplicate id`);
    ids.add(a.id); files.add(a.file);
    const kind = KINDS[a.kind];
    if (!kind) { bad.push(`${at}: unknown kind "${a.kind}"`); continue; }
    if (kind.w && (a.w !== kind.w || a.h !== kind.h)) bad.push(`${at}: a ${a.kind} is ${kind.w} x ${kind.h}, the entry says ${a.w} x ${a.h}`);
    if (!(a.maxBytes > 0) || a.maxBytes > kind.maxBytes) bad.push(`${at}: byte ceiling ${a.maxBytes} is over the ${a.kind} limit ${kind.maxBytes}`);
    if (typeof a.alt !== 'string' || a.alt.trim().length < 20) bad.push(`${at}: no alt text`);
    else if (/[—–]/.test(a.alt)) bad.push(`${at}: alt text has a dash character`);
    if (!/^A\d\d$/.test(a.art ?? '')) bad.push(`${at}: no art id`);
    if (typeof a.final !== 'boolean') bad.push(`${at}: final is not true or false`);
    if (a.kind === 'still') {
      const s = a.safe;
      if (!Array.isArray(s) || s.length !== 4 || s.some(n => typeof n !== 'number')) bad.push(`${at}: a still needs a safe box [x, y, w, h]`);
      else if (s[0] < 0 || s[1] < 0 || s[2] <= 0 || s[3] <= 0 || s[0] + s[2] > 1.0001 || s[1] + s[3] > 1.0001) bad.push(`${at}: safe box ${JSON.stringify(s)} is outside the picture`);
    }
    let buf;
    try { buf = fs.readFileSync(path.join(dir, a.file)); } catch { bad.push(`${at}: file ${a.file} is missing`); continue; }
    let info;
    try { info = webpInfo(buf); } catch (e) { bad.push(`${at}: ${a.file} is not a readable WebP (${e.message})`); continue; }
    if (info.w !== a.w || info.h !== a.h) bad.push(`${at}: file is ${info.w} x ${info.h}, entry says ${a.w} x ${a.h}`);
    if (buf.length > a.maxBytes) bad.push(`${at}: file is ${buf.length} bytes, over its ceiling ${a.maxBytes}`);
    if (a.kind !== 'still' && !info.alpha) bad.push(`${at}: a cutout needs an alpha channel`);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (a.final && hashes.has(hash)) bad.push(`${at}: marked final but the file is still the placeholder`);
  }
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.webp') && !files.has(f)) bad.push(`${f}: a .webp in the folder with no manifest entry`);
  return bad;
}

test('the manifest lists every Cairo picture of ART.md section 4, A01 to A18', () => {
  const arts = new Set(manifest.assets.map(a => a.art));
  for (let n = 1; n <= 18; n++) ok(arts.has('A' + String(n).padStart(2, '0')), `A${n} has no entry`);
  ok(!arts.has('A00') && !arts.has('A19'), 'A00 and A19 are not in the manifest');
  eq(manifest.assets.length, 53);
});
test('every entry: file, size, ceiling, alt, safe box, final flag', () => {
  const bad = check(manifest, ART);
  ok(bad.length === 0, bad.join('\n  '));
});
test('the safe boxes of A01 and A02 are centred, 0.56 by 0.62; the map keeps the whole picture', () => {
  for (const id of ['desk-day', 'desk-dusk', 'desk-night']) {
    const [x, y, w, h] = manifest.assets.find(a => a.id === id).safe;
    eq([w, h], [0.56, 0.62]);
    ok(Math.abs(x + w / 2 - 0.5) < 1e-9 && Math.abs(y + h / 2 - 0.5) < 1e-9, `${id} is not centred`);
  }
  eq(manifest.assets.find(a => a.id === 'map-cairo').safe, [0, 0, 1, 1]);
});
test('map-cairo-geo.json has the picture size, every whole-degree crossing, and every stop', () => {
  const g = JSON.parse(fs.readFileSync(path.join(ART, 'map-cairo-geo.json'), 'utf8'));
  const map = manifest.assets.find(a => a.id === 'map-cairo');
  eq([g.w, g.h], [map.w, map.h]);
  eq(g.grid.lats.length, 44); eq(g.grid.lons.length, 91);
  eq(g.grid.xy.length, 44); ok(g.grid.xy.every(r => r.length === 91), 'a grid row is short');
  const inside = ([x, y]) => x >= 0 && x <= g.w && y >= 0 && y <= g.h;
  ok(g.grid.xy.flat().every(inside), 'a crossing falls outside the picture');
  // the geo file's stops are exactly the game's (data/cairo/stops.json), with the same places
  const game = JSON.parse(fs.readFileSync(path.join(ART, '..', '..', 'data', 'cairo', 'stops.json'), 'utf8'));
  eq(g.stops.map(s => s.id).sort(), game.map(s => s.id).sort());
  for (const s of game) {
    const q = g.stops.find(x => x.id === s.id);
    ok(Math.abs(q.lat - s.lat) <= 0.05 && Math.abs(q.lon - s.lon) <= 0.05, `${s.id} is at ${q.lat}, ${q.lon} in the geo file and ${s.lat}, ${s.lon} in stops.json`);
  }
  ok(g.stops.every(s => inside([s.x, s.y])), 'a stop falls outside the picture');
  const at = n => g.stops.find(s => s.id === n);
  ok(at('venice').y < at('cairo').y && at('aden').y > at('cairo').y, 'north is not up');
  ok(at('calicut').x > at('cairo').x && at('walata').x < at('cairo').x, 'east is not right');
});
test('check() catches the faults it names', () => {
  const m = JSON.parse(JSON.stringify(manifest));
  const flaw = fn => { const c = JSON.parse(JSON.stringify(m)); fn(c); return check(c, ART).join('|'); };
  ok(/missing/.test(flaw(c => { c.assets[0].file = 'nope.webp'; })));
  ok(/entry says/.test(flaw(c => { c.assets[0].w = 1919; })));
  ok(/over its ceiling/.test(flaw(c => { c.assets[0].maxBytes = 100; })));
  ok(/no alt/.test(flaw(c => { c.assets[0].alt = ''; })));
  ok(/safe box/.test(flaw(c => { delete c.assets[0].safe; })));
  // the file's own hash is listed as a placeholder, so the case holds whichever pictures are final
  const ownHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ART, m.assets[0].file))).digest('hex');
  ok(/still the placeholder/.test(flaw(c => { c.placeholderHash = [...(c.placeholderHash ?? []), ownHash]; c.assets[0].final = true; })));
});

if (!process.argv[1] || path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) done();
