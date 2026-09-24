// desktop-input.mjs: Aphelion is played with a keyboard and a mouse, and
// reads no touch, no gamepad and no coarse pointer.
//
//   node test/desktop-input.mjs      (from Projects/aphelion)
//
// Exits non-zero on any failure.
//
// WHY. A touch/gamepad scheme was ranked for four rounds "only if Aphelion
// ever needs to run on a tablet or phone". That is Q40 in BACKLOG.md's
// "Questions for Devon", and only Devon can answer it (#629, after #628).
// Round 1's arrow-key look already covers a desktop player whose browser
// denies pointer lock. No test can see a decision, so this one watches for
// the first line of code that would build the scheme anyway: a touch or
// pointer-down handler, a gamepad poll, a coarse-pointer query, a virtual
// stick library, a phone-shaped viewport. If Devon has answered Q40 yes,
// record it in HISTORY.md, strike Q40, and delete the rule the feature needs
// in the same edit. Do not add an exception to pass it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WHY = "Touch and gamepad input is Q40, Devon's call (#629)";

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// Every file the game is made of, except this folder and the vendored
// Three.js (whose comments say "touches"; the libs rule pins that folder).
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
});
const all = walk(ROOT).map((p) => path.relative(ROOT, p).split(path.sep).join('/'));
const code = all.filter((f) => /\.(html?|m?js|css)$/i.test(f)
  && !f.startsWith('test/') && f !== 'libs/three.module.js');

// A stripped comment keeps its newlines, so a failure's line number is the file's.
const blank = (s) => s.replace(/[^\n]/g, '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const live = (file, src) => /\.html?$/i.test(file)
  ? src.replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, o, b, c) => o + b.replace(/\/\*[\s\S]*?\*\//g, blank) + c)
      .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, o, b, c) => o + stripJs(b) + c)
  : /\.css$/i.test(file) ? src.replace(/\/\*[\s\S]*?\*\//g, blank) : stripJs(src);
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const sources = code.map((f) => [f, live(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))]);

console.log(`\nscanning ${code.length} files: ${code.join(', ')}`);
ok(code.includes('index.html') && code.includes('src/controls.js') && code.includes('src/main.js'),
  'the scan reaches index.html and the input code',
  'the walk lost a file it has to read; fix the walk before trusting any rule below');

// Each rule is the first line of a touch or gamepad scheme, in every spelling
// this code could write it: addEventListener('x'), onx =, an event field, a
// constructor, a CSS property or media feature. pointerlockchange,
// requestPointerLock, pointer-events and cursor: pointer are desktop, and pass.
const RULES = [
  ['reads no touch event',
    /\b(on)?touch(start|move|end|cancel)\b|\bTouch(Event|List)?\b|\b(changed|target)?[Tt]ouches\b|\b(ms)?[Mm]axTouchPoints\b|\bcreateTouch\b/g],
  ['reads no pointer event but the lock',
    /\b(on)?pointer(down|up|move|cancel|over|out|enter|leave|rawupdate)\b|\bpointerType\b|\b(set|release|has)PointerCapture\b|\bgetCoalescedEvents\b|\bPointerEvent\b/gi],
  ['reads no gamepad',
    /gamepad|\bjoystick|\bjoypad|\bnipple/gi],
  ['asks no coarse-pointer or hover question',
    /\b(any-)?(pointer|hover)\s*:\s*(coarse|fine|none|hover)\b|touch-action|-webkit-touch-callout|-webkit-tap-highlight/gi],
  ['listens for no device orientation',
    /deviceorientation|devicemotion|screen\.orientation|orientationchange/gi],
];

for (const [label, re] of RULES) {
  const hits = sources.flatMap(([f, src]) =>
    [...src.matchAll(re)].map((m) => `${f}:${lineOf(src, m.index)} ${m[0].trim()}`));
  ok(hits.length === 0, `Aphelion ${label}`, `${hits.join('; ')}\n        ${WHY}. Answered otherwise? Record it in HISTORY.md, then change this file.`);
}

// A scheme can arrive as a file before it arrives as a line: a vendored stick
// library, a src/touch.js. The libs folder is Three.js and nothing else.
const libs = all.filter((f) => f.startsWith('libs/'));
ok(libs.length === 1 && libs[0] === 'libs/three.module.js', 'libs/ holds Three.js and nothing else',
  `it holds ${libs.join(', ')}. ${WHY}.`);
const named = all.filter((f) => !f.startsWith('test/') && /touch|gamepad|joystick|joypad|mobile|virtual.?stick/i.test(f));
ok(named.length === 0, 'no file is named for a touch or gamepad scheme', `${named.join(', ')}. ${WHY}.`);

// The viewport is the page's one line that already speaks to a phone. It stays
// the plain responsive default; a scheme would pin zoom or reach under a notch.
const html = (sources.find(([f]) => f === 'index.html') || ['', ''])[1];
const vps = [...html.matchAll(/<meta\b[^>]*\bname\s*=\s*["']?viewport\b[^>]*>/gi)].map((m) => m[0]);
ok(vps.length === 1 && /content\s*=\s*["']width=device-width, initial-scale=1\.0["']/.test(vps[0]),
  'the viewport is still width=device-width, initial-scale=1.0',
  `found ${vps.length ? vps.join(' ') : 'none'}. ${WHY}.`);

console.log(`\n${checks} checks${failures ? `, ${failures} FAILED` : ', all passed'}`);
process.exit(failures ? 1 : 0);
