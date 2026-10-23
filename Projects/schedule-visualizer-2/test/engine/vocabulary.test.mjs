// Spec 2's words in what a user reads (SV2-32f). A floor's grid is made of
// cells, so "square" is never the planner's word for one; the schedule grid's
// boxes are slots, so "cell" never names one of those.
//
// The scan reads every string literal and every template literal's text in
// the planner's modules (ui/), the staff browser's (staff/) and the engine's
// (engine/), with comments left out, plus the text of the HTML pages. Each
// string that says "square" outside ALLOWED_SQUARE fails, and each string in
// ui/schedule/ that says "cell" outside ALLOWED_CELL fails, and so does each
// help sentence that names the schedule grid and says "cell", and each string
// in engine/csv.js (whose notes call a field of the file an "entry", SV2-32n).
// An allowed string
// is named by its file and a piece of its text, with the reason it is allowed:
// "square" as a shape (the exit's mark, a colour swatch) or a value handed to
// the canvas or CSS, never one a reader takes for a distance.
//
//   node test/engine/vocabulary.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SQUARE = /\bsquares?\b/i;
// "cell" as a word of its own: not a class name such as grd-cell or a
// property such as cellCount.
const CELL = /(?<![\w-])cells?(?![\w-])/i;

// [file, a piece of the string, why it may say "square"]
export const ALLOWED_SQUARE = [
  ['ui/safety/index.js', 'Square mark: the exit', 'the exit is drawn as a square mark (a shape), the door as a round one'],
  ['ui/prints/door-cards.js', 'the square mark at the exit', 'the door card\'s key names the exit\'s square mark (a shape)'],
  ['ui/movement/hotspots.js', 'The number in the square is the colour band', 'the hotspot table\'s band swatch is a square of the band\'s colour (a shape)'],
  ['ui/building/search.js', 'square', 'canvas lineCap value, never shown'],
  ['ui/surface/overlays/evacuation.js', 'square', 'canvas lineCap value, never shown'],
  ['ui/surface/renderer.js', 'square', 'canvas lineCap value, never shown'],
  ['ui/movement/hotspots.js', 'square', 'canvas lineCap value, never shown'],
  ['staff/map.js', 'square', 'canvas lineCap value, never shown'],
  ['staff/page.js', 'square', 'the list-style-type a picture of the page copies, never shown'],
  ['ui/prints/plan-svg.js', 'stroke-linecap: square', 'an SVG stroke style in the plan\'s stylesheet, never shown'],
];

// [file, a piece of the string, why it may say "cell"]
export const ALLOWED_CELL = [
  ['ui/schedule/groups.js', 'cell', 'the ARIA role of a table cell, read by a screen reader as "cell" of a table, never as a word of the tool'],
  ['engine/csv.js', 'write needs rows as an array of arrays of cells.', 'a TypeError for a caller that passes the wrong shape (a programmer\'s mistake), never a note an import shows'],
];

// The help's sentences that name the schedule's grid: Schedule › Grid, or
// "the schedule grid" / "the schedule's grid".
const SCHEDULE_GRID = /Schedule\s*(?:›|>)\s*Grid|\bschedule(?:'s|’s)? grid\b/i;

function filesUnder(folder) {
  const out = [];
  for (const entry of readdirSync(path.join(TOOL, folder), { withFileTypes: true })) {
    const rel = folder + '/' + entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(js|html)$/.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

// Whether a `/` at this point starts a regular expression rather than
// dividing: after an operator, an opening bracket, a comma or a keyword.
function slashStartsRegex(source, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;
  const ch = source[i];
  if (/[(,=:[!&|?{};+\-*%<>~^]/.test(ch)) return true;
  if (/[\w$]/.test(ch)) {
    let start = i;
    while (start > 0 && /[\w$]/.test(source[start - 1])) start -= 1;
    return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(source.slice(start, i + 1));
  }
  return false;
}

// Every string a module's code holds, with its line: quoted strings, and the
// text parts of template literals (the code inside ${…} is read as code, so
// a string inside it is found too). Comments and regular expressions are
// skipped.
export function stringsOf(source) {
  const found = [];
  const lineAt = (at) => source.slice(0, at).split('\n').length;
  let i = 0;
  // a stack of template depths: each entry counts the braces open inside one ${…}
  const braces = [];
  const readTemplate = () => {
    // at the character after a ` or after the } that closes a ${…}
    let text = '';
    const start = i;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { text += source.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { i += 1; found.push({ text, line: lineAt(start) }); return; }
      if (ch === '$' && source[i + 1] === '{') { i += 2; found.push({ text, line: lineAt(start) }); braces.push(0); return; }
      text += ch;
      i += 1;
    }
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    if (ch === '\'' || ch === '"') {
      const start = i;
      let text = '';
      i += 1;
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') { text += source.slice(i, i + 2); i += 2; continue; }
        text += source[i];
        i += 1;
      }
      i += 1;
      found.push({ text, line: lineAt(start) });
      continue;
    }
    if (ch === '`') { i += 1; readTemplate(); continue; }
    if (ch === '{' && braces.length > 0) { braces[braces.length - 1] += 1; i += 1; continue; }
    if (ch === '}' && braces.length > 0) {
      if (braces[braces.length - 1] === 0) { braces.pop(); i += 1; readTemplate(); continue; }
      braces[braces.length - 1] -= 1;
      i += 1;
      continue;
    }
    if (ch === '/' && slashStartsRegex(source, i)) {
      i += 1;
      let inClass = false;
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) break;
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return found;
}

// The text a reader of an HTML page sees: no script, style, comment or tag.
export function htmlText(source) {
  const lines = [];
  const bare = source
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/<!--[\s\S]*?-->/g, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/<[^>]*>/g, ' ');
  bare.split('\n').forEach((text, at) => { if (text.trim() !== '') lines.push({ text, line: at + 1 }); });
  return lines;
}

function scan(folders, word, allowed, only = () => true) {
  const hits = [];
  const used = new Set();
  for (const folder of folders) {
    for (const file of filesUnder(folder).filter(only)) {
      const source = readFileSync(path.join(TOOL, file), 'utf8');
      const strings = file.endsWith('.html') ? htmlText(source) : stringsOf(source);
      for (const { text, line } of strings) {
        if (!word.test(text)) continue;
        const allow = allowed.findIndex(([where, piece]) => where === file && (piece === text || (piece.length > 6 && text.includes(piece))));
        if (allow >= 0) { used.add(allow); continue; }
        hits.push(file + ':' + line + '  ' + JSON.stringify(text.length > 120 ? text.slice(0, 117) + '...' : text));
      }
    }
  }
  return { hits, unused: allowed.filter((_, at) => !used.has(at)).map(([file, piece]) => file + ' ' + JSON.stringify(piece)) };
}

test('the string reader finds quoted and template text, and skips comments and regular expressions', () => {
  const source = [
    '// a comment with "squares" in it',
    '/* and "cells" here */',
    'const a = \'Walk 4 cells\';',
    'const b = "it\\"s one";',
    'const c = `the ${floor.name + \' floor\'} is ${n} wide`;',
    'const d = text.replace(/\'"/g, \'\');',
    'const e = x / 2 / 3;',
  ].join('\n');
  assert.deepEqual(stringsOf(source).map((s) => s.text), ['Walk 4 cells', 'it\\"s one', 'the ', ' floor', ' is ', ' wide', '']);
  assert.deepEqual(stringsOf(source).map((s) => s.line), [3, 4, 5, 5, 5, 5, 6]);
  assert.deepEqual(htmlText('<p>One <b>square</b></p>\n<script>const s = "cell";</script>\n<!-- squares -->').map((s) => s.text.trim()), ['One  square']);
});

test('ui/, staff/ and engine/ say "cell" for a square of a floor\'s grid: "square" only as a shape (spec 2)', () => {
  const { hits, unused } = scan(['ui', 'staff', 'engine'], SQUARE, ALLOWED_SQUARE);
  assert.deepEqual(hits, [], 'a user-visible string says "square" where spec 2 says "cell" (or add it to ALLOWED_SQUARE with why it is a shape):\n' + hits.join('\n'));
  assert.deepEqual(unused, [], 'an allowed "square" no longer exists: take its line out of ALLOWED_SQUARE');
});

test('the schedule (ui/schedule/) says "slot" for a box of its grid, never "cell" (spec 2: a cell is a floor\'s)', () => {
  const { hits, unused } = scan(['ui/schedule'], CELL, ALLOWED_CELL.filter(([file]) => file.startsWith('ui/schedule/')));
  assert.deepEqual(hits, [], 'a user-visible string in ui/schedule/ says "cell" (or add it to ALLOWED_CELL with why):\n' + hits.join('\n'));
  assert.deepEqual(unused, [], 'an allowed "cell" no longer exists: take its line out of ALLOWED_CELL');
});

test('the help says "slot" for a box of the schedule grid, never "cell" (spec 2: a cell is a floor\'s)', () => {
  const file = 'ui/help/content.js';
  const grid = stringsOf(readFileSync(path.join(TOOL, file), 'utf8')).filter(({ text }) => SCHEDULE_GRID.test(text));
  assert.ok(grid.length > 0, 'no help string names the schedule grid any more: SCHEDULE_GRID matches nothing, so this check checks nothing');
  const hits = grid.filter(({ text }) => CELL.test(text)).map(({ text, line }) => file + ':' + line + '  ' + JSON.stringify(text));
  assert.deepEqual(hits, [], 'a help sentence about the schedule grid says "cell" where spec 2 says "slot":\n' + hits.join('\n'));
});

test('engine/csv.js\'s notes say "entry" for a field of the imported file, never "cell" (spec 2: a cell is a floor\'s)', () => {
  const { hits, unused } = scan(['engine'], CELL, ALLOWED_CELL.filter(([file]) => file.startsWith('engine/')), (file) => file === 'engine/csv.js');
  assert.deepEqual(hits, [], 'a note engine/csv.js shows says "cell" where SV2-32f\'s import rules say "entry" (or add it to ALLOWED_CELL with why):\n' + hits.join('\n'));
  assert.deepEqual(unused, [], 'an allowed "cell" in engine/csv.js no longer exists: take its line out of ALLOWED_CELL');
});
