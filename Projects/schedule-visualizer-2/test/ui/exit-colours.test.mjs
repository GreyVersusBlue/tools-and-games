// The exits' colours (SV2-72c, the M5 walk-through's W2): the --exit-1 to
// --exit-8 tokens of ui/safety/safety.css, read as text with the surfaces
// they lie on from ui/tokens.css, in both themes. A categorical set: no hue
// near --problem's or --warning's, each 3:1 on the corridor, the floor and
// the stairs, every pair apart; and what the section does with them
// (exitPalette, exitColours) past eight exits and with a token missing.
//
//   node test/ui/exit-colours.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contrast } from '../../ui/colour.js';
import { exitPalette, exitColours, oklab, apart, EXIT_COUNT, EXIT_APART, EXIT_HUE_CLEAR, EXIT_GREY } from '../../ui/surface/overlays/evacuation.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bare = (file) => readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// [{ prelude, body, children }] for `prelude { body }`, one level of @media
function blocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const prelude = text.slice(i, open).trim().replace(/\s+/g, ' ');
    const body = text.slice(open + 1, j - 1);
    out.push({ prelude, body, children: prelude.startsWith('@media') ? blocks(body) : [] });
    i = j;
  }
  return out;
}

function declarations(body) {
  const map = new Map();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon !== -1) map.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return map;
}

const LIGHT = ':root, [data-theme="auto"], [data-theme="light"]';
const DARK = '[data-theme="dark"]';
const DEVICE = ':root:not([data-theme]), [data-theme="auto"]';
const selectors = (block) => block.prelude.split(',').map((s) => s.trim()).sort().join(', ');

// the blocks of a file that set any of `names`, by theme
function themed(file, names) {
  const top = blocks(bare(file));
  const device = top.filter((b) => b.prelude.startsWith('@media') && b.prelude.includes('prefers-color-scheme: dark')).flatMap((b) => b.children);
  const pick = (list, wanted) => list.filter((b) => selectors(b) === wanted).map((b) => declarations(b.body)).filter((d) => names.some((name) => d.has(name)));
  return { light: pick(top, LIGHT), dark: pick(top, DARK), device: pick(device, DEVICE) };
}

const EXIT_NAMES = Array.from({ length: EXIT_COUNT }, (_, i) => '--exit-' + (i + 1));
const exits = themed('ui/safety/safety.css', EXIT_NAMES);
const tokens = themed('ui/tokens.css', ['--corridor']);
// a token as its theme has it, var(--x) followed within the block
function resolved(theme, name) {
  let value = tokens[theme][0].get(name);
  for (let hops = 0; value && /^var\(--[\w-]+\)$/.test(value) && hops < 4; hops += 1) value = tokens[theme][0].get(value.slice(4, -1));
  return value;
}

function palette(theme) {
  assert.equal(exits[theme].length, 1, 'ui/safety/safety.css should set the exits in one ' + theme + ' block');
  return EXIT_NAMES.map((name) => exits[theme][0].get(name));
}

const SURFACES = ['--corridor', '--grid', '--stairs'];
const SEVERITIES = ['--problem', '--warning'];
const THEMES = ['light', 'dark'];
const surface = (theme, name) => tokens[theme][0].get(name);

function hue(colour) {
  const [, a, b] = oklab(colour);
  return { chroma: Math.hypot(a, b), angle: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}
const between = (x, y) => {
  const d = Math.abs(x - y) % 360;
  return Math.min(d, 360 - d);
};

test('safety.css sets --exit-1 to --exit-' + EXIT_COUNT + ' in tokens.css\'s three theme blocks, every one a colour, the two dark blocks the same', () => {
  for (const theme of ['light', 'dark', 'device']) {
    assert.equal(exits[theme].length, 1, theme + ': one block');
    for (const name of EXIT_NAMES) assert.match(exits[theme][0].get(name) || '', /^#[0-9a-f]{6}$/, theme + ' ' + name);
  }
  assert.deepEqual(EXIT_NAMES.map((name) => exits.device[0].get(name)), palette('dark'), 'the device\'s dark block differs from the chosen dark block');
});

for (const theme of THEMES) {
  test('the ' + theme + ' exits are 3:1 on ' + SURFACES.join(', ') + ' (a route lies on corridors and stairs, a frame and a badge on a room over the floor)', () => {
    const short = [];
    for (const [i, colour] of palette(theme).entries()) {
      for (const name of SURFACES) {
        const ratio = contrast(colour, surface(theme, name));
        if (ratio < 3) short.push('exit ' + (i + 1) + ' ' + colour + ' is ' + ratio.toFixed(2) + ':1 on ' + name + ' ' + surface(theme, name));
      }
    }
    assert.deepEqual(short, []);
  });

  test('the ' + theme + ' exits keep ' + EXIT_HUE_CLEAR + ' degrees of hue from --problem and --warning of both themes (the grey has none)', () => {
    const severities = THEMES.flatMap((each) => SEVERITIES.map((name) => ({ name: each + ' ' + name, colour: surface(each, name) })));
    const near = [];
    for (const [i, colour] of palette(theme).entries()) {
      const mine = hue(colour);
      if (mine.chroma < EXIT_GREY) continue;
      for (const severity of severities) {
        const angle = between(mine.angle, hue(severity.colour).angle);
        if (angle < EXIT_HUE_CLEAR) near.push('exit ' + (i + 1) + ' ' + colour + ' is ' + angle.toFixed(0) + ' degrees from ' + severity.name + ' ' + severity.colour);
      }
    }
    assert.deepEqual(near, []);
  });

  test('the ' + theme + ' exits are every pair at least ' + EXIT_APART + ' apart in OKLab', () => {
    const colours = palette(theme);
    const close = [];
    for (let i = 0; i < colours.length; i += 1) {
      for (let j = i + 1; j < colours.length; j += 1) {
        const d = apart(colours[i], colours[j]);
        if (d < EXIT_APART) close.push('exits ' + (i + 1) + ' and ' + (j + 1) + ' (' + colours[i] + ', ' + colours[j] + ') are ' + d.toFixed(3) + ' apart');
      }
    }
    assert.deepEqual(close, []);
  });
}

// what an exit lies beside on the map: the cursor's ring and a hovered
// room (--accent, --focus) and the text of every label (--ink)
const BESIDE = ['--accent', '--focus', '--ink'];

for (const theme of THEMES) {
  test('the ' + theme + ' exits are each at least ' + EXIT_APART + ' in OKLab from ' + BESIDE.join(', '), () => {
    const close = [];
    for (const name of BESIDE) assert.match(resolved(theme, name) || '', /^#[0-9a-f]{6}$/, theme + ' ' + name + ' did not resolve to a colour');
    for (const [i, colour] of palette(theme).entries()) {
      for (const name of BESIDE) {
        const d = apart(colour, resolved(theme, name));
        if (d < EXIT_APART) close.push('exit ' + (i + 1) + ' ' + colour + ' is ' + d.toFixed(3) + ' from ' + name + ' ' + resolved(theme, name));
      }
    }
    assert.deepEqual(close, []);
  });

  test('no ' + theme + ' exit is the colour an unread token falls back to', () => {
    const [fallback] = exitColours(1, [null]);
    assert.match(fallback, /^#[0-9a-f]{6}$/);
    assert.deepEqual(palette(theme).filter((colour) => colour.toLowerCase() === fallback.toLowerCase()), [], 'an exit drawn in the fallback reads the same as a token that could not be read');
  });
}

test('the threshold of hue is one the old first exit fails: SV2-67b\'s red, in the light theme, was 4 degrees from --problem', () => {
  // EXIT_PRESETS[0] of SV2-67b made 3:1 on the white corridor: '#d1495b'
  const angle = between(hue('#d1495b').angle, hue(surface('light', '--problem')).angle);
  assert.ok(angle < EXIT_HUE_CLEAR, 'the old red is ' + angle.toFixed(1) + ' degrees off: the rule would not have caught it');
});

test('exitPalette reads the tokens from a style, and a token that is not a colour is null', () => {
  const values = new Map([['--exit-1', ' #255ebc '], ['--exit-2', 'red'], ['--exit-3', '']]);
  const read = exitPalette({ getPropertyValue: (name) => values.get(name) || '' });
  assert.equal(read.length, EXIT_COUNT);
  assert.equal(read[0], '#255ebc');
  assert.equal(read[2], null);
  assert.equal(read[EXIT_COUNT - 1], null);
  assert.deepEqual(exitPalette(null), Array(EXIT_COUNT).fill(null));
});

test('past eight exits the colours repeat in key order; an unread token is the fallback, never a hole', () => {
  const light = palette('light');
  const colours = exitColours(EXIT_COUNT + 3, light);
  assert.equal(colours.length, EXIT_COUNT + 3);
  assert.equal(colours[EXIT_COUNT], colours[0]);
  assert.equal(colours[EXIT_COUNT + 2], colours[2]);
  assert.equal(new Set(colours.slice(0, EXIT_COUNT)).size, EXIT_COUNT);
  assert.deepEqual(exitColours(2, [null, '#005700'], '#1f2328'), ['#1f2328', '#005700']);
  assert.deepEqual(exitColours(2, null), ['#808080', '#808080']);
});
