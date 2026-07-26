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

const SKIP = ['node_modules', '/tools/board-check/three-'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.some(s => p.includes(s))) continue;
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

console.log(`\n${checked} units checked, ${bad} broken`);
process.exit(bad ? 1 : 0);
