// check-integrity.mjs — parse every bit of code and data on the site.
//
// This exists because Castle Conundrum shipped for an unknown length of time
// with a src/npc.js that contained JSON instead of JavaScript. The module
// failed to parse, main.js could not import { NPC }, and the game hung on its
// loading screen forever. Nothing caught it, because the previous checker only
// verified that files *resolved*, not that they *parsed*.
//
// Checks:
//   - every .js / .mjs parses as an ES module
//   - every inline <script> in every .html parses (module or classic)
//   - every .json parses (package-lock excluded, it is huge and generated)
//
// Exit code 1 on any failure.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SITE } from './harness.mjs';

const SKIP = ['node_modules', '/tools/board-check/three-', '/libs/'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // `SKIP`'s patterns are lowercase forward-slash paths, but path.join on
    // Windows returns backslashes and this repo's own paths are mixed-case
    // (Tools/ is capitalized on purpose, locked decision #14) — so this
    // check silently matched nothing at all on this dev machine until now.
    // Normalizing both sides fixes the three-package skip that was already
    // here, not just the new /libs/ entry.
    const norm = p.replace(/\\/g, '/').toLowerCase();
    if (SKIP.some(s => norm.includes(s))) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function parses(source, mode) {
  try {
    execFileSync(process.execPath, ['--input-type=' + mode, '--check'],
                 { input: source, stdio: ['pipe', 'pipe', 'pipe'] });
    return null;
  } catch (e) {
    const line = String(e.stderr || '').split('\n').find(l => /Error/.test(l));
    return (line || 'parse failed').trim();
  }
}

const files = walk(SITE);
const rel = p => path.relative(SITE, p);
let checked = 0, bad = 0;
const fail = (p, msg) => { bad++; console.log(`  FAIL ${rel(p)}\n       ${msg}`); };

console.log('integrity sweep\n');

// --- standalone modules -----------------------------------------------------
for (const p of files.filter(f => /\.(js|mjs)$/.test(f))) {
  checked++;
  const err = parses(fs.readFileSync(p, 'utf8'), 'module');
  if (err) fail(p, err);
}

// --- inline scripts ---------------------------------------------------------
for (const p of files.filter(f => f.endsWith('.html'))) {
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attrs, body] = m;
    // skip importmaps, JSON-LD, x-template and friends
    if (/type\s*=\s*["'](?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
    if (!body.trim()) continue;
    checked++;
    const err = parses(body, /module/.test(attrs) ? 'module' : 'commonjs');
    if (err) fail(p, `inline script at line ${src.slice(0, m.index).split('\n').length}: ${err}`);
  }
}

// --- json -------------------------------------------------------------------
for (const p of files.filter(f => f.endsWith('.json') && !f.includes('package-lock'))) {
  checked++;
  try { JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail(p, String(e.message).slice(0, 120)); }
}

// --- offsite hosts referenced in source --------------------------------------
// A static sweep, not a browser one. It covers every .html in the repo,
// including pages no suite ever opens (the Bestiary Gallery lived here
// unmeasured for the site's whole history), and it needs no browser to run.
//
// harness.mjs's prepPage() fulfils fonts.googleapis.com / fonts.gstatic.com
// requests locally, from bundled @fontsource packages, before its blocked-list
// check runs — so a font hotlink never reaches page.__blocked, and a browser
// suite that only asserts page.__blocked will call a hotlinking page clean.
// (page.__shimmed records what got fulfilled, if you want that from a browser
// run instead — see harness.mjs.) This check only reads source, so it is not
// fooled either way, and it is the one that scales to pages nothing else opens.
//
// Only actual resource-loading contexts count — <a href> is a navigation link,
// not a request the page makes on its own, so it is deliberately not one of
// the tags scanned here.
const RESOURCE_TAGS = /<(?:link|script|img|iframe|source|audio|video|embed)\b[^>]*>/gi;
const HREF_OR_SRC = /\b(?:href|src)\s*=\s*["']https?:\/\/([^"'/]+)/i;
const CSS_URL = /\burl\(\s*['"]?https?:\/\/([^"')\s]+)/gi;
// The .js equivalent of an HTML resource tag: a plain `.src =` / `.href =`
// assignment, or a `fetch()`/`import()` call — actual code that makes a
// request, not just a URL-shaped string sitting in a comment or a data value.
const JS_RESOURCE_CALL = /\.(?:src|href)\s*=\s*["']https?:\/\/([^"'/]+)|\b(?:fetch|import)\(\s*["']https?:\/\/([^"'/]+)/gi;
const OWN_HOST = /^(www\.)?greyversusblue\.com$/i;

for (const p of files.filter(f => f.endsWith('.html'))) {
  checked++;
  const src = fs.readFileSync(p, 'utf8');
  const hosts = new Set();
  for (const tag of src.matchAll(RESOURCE_TAGS)) {
    const m = tag[0].match(HREF_OR_SRC);
    if (m) hosts.add(m[1].split('/')[0].split(':')[0]);
  }
  for (const m of src.matchAll(CSS_URL)) hosts.add(m[1].split('/')[0].split(':')[0]);
  for (const h of [...hosts]) if (OWN_HOST.test(h)) hosts.delete(h);
  if (hosts.size) fail(p, `references offsite host(s): ${[...hosts].join(', ')}`);
}

// Same sweep, one level deeper: an import map's URLs.
//
// The sweep above reads `href`/`src` attributes on resource tags. An import
// map's URLs are not attributes — they are JSON in the script body — so a page
// could point `three` at a CDN and this check would call it clean, which is
// exactly what Bell to Bell did for its whole history. The inline-script parse
// loop above skips importmaps too (they are not JavaScript), so nothing looked
// inside them at all until now.
//
// A bare specifier's target is a real request the page makes the moment a
// module imports it, so an offsite one is the same failure as an offsite
// <script src>. A malformed map is also a failure: the browser ignores an
// import map it cannot parse and every bare specifier on the page then throws.
const IMPORTMAP = /<script[^>]*\btype\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;

for (const p of files.filter(f => f.endsWith('.html'))) {
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(IMPORTMAP)) {
    checked++;
    let map;
    try { map = JSON.parse(m[1]); }
    catch (e) { fail(p, `import map is not JSON: ${String(e.message).slice(0, 100)}`); continue; }
    const urls = [
      ...Object.values(map.imports || {}),
      ...Object.values(map.scopes || {}).flatMap(s => Object.values(s || {}))
    ].filter(v => typeof v === 'string');
    const hosts = new Set();
    for (const u of urls) {
      const h = u.match(/^https?:\/\/([^/]+)/i);
      if (h) hosts.add(h[1].split(':')[0]);
    }
    for (const h of [...hosts]) if (OWN_HOST.test(h)) hosts.delete(h);
    if (hosts.size) fail(p, `import map points offsite: ${[...hosts].join(', ')}`);

    // A local target that does not exist is the other way an import map goes
    // wrong silently: the map parses, the page loads, and the first bare
    // import 404s. Only same-directory-relative targets are resolvable from
    // here; a trailing slash is a prefix mapping, so check the directory.
    for (const u of urls) {
      if (/^(https?:|data:|\/)/i.test(u)) continue;
      const target = path.resolve(path.dirname(p), u);
      const ok = u.endsWith('/')
        ? fs.existsSync(target) && fs.statSync(target).isDirectory()
        : fs.existsSync(target);
      if (!ok) fail(p, `import map target does not exist: ${u}`);
    }
  }
}

// Same sweep, extended to .js/.css — this repo's own code, not just markup.
// Schedule Visualizer's round-3 finding: this check only ever walked .html,
// so a tool that splits its logic into .js/.css (590 KB / 156 KB under
// Tools/schedule/app/ as of this round) got zero coverage from it. `/libs/`
// joined the SKIP list above so a vendored bundle (e.g.
// Tools/schedule/libs/jspdf/jspdf.umd.min.js) doesn't false-positive on its
// own embedded license header or a stray URL in a minified string.
for (const p of files.filter(f => /\.(js|mjs|css)$/.test(f))) {
  checked++;
  const src = fs.readFileSync(p, 'utf8');
  const hosts = new Set();
  for (const m of src.matchAll(CSS_URL)) hosts.add(m[1].split('/')[0].split(':')[0]);
  for (const m of src.matchAll(JS_RESOURCE_CALL)) {
    const host = m[1] || m[2];
    hosts.add(host.split('/')[0].split(':')[0]);
  }
  for (const h of [...hosts]) if (OWN_HOST.test(h)) hosts.delete(h);
  if (hosts.size) fail(p, `references offsite host(s): ${[...hosts].join(', ')}`);
}

console.log(`\n${checked} units checked, ${bad} broken`);
process.exit(bad ? 1 : 0);
