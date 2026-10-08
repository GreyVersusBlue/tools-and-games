// Token contrast, in Node, no browser: node test/a11y/contrast.mjs
//
// Reads ui/tokens.css as text. The pairs it checks are the ones tokens.css lists in
// its own comment table, so the table a designer reads is the list that is enforced.
// Every failure prints the theme, the pair and the ratio, and the process exits
// non-zero.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AA_LARGE, AA_TEXT, GROUP_PRESETS, LOAD_BANDS, OTHER_STRENGTH, ROOM_STRENGTH,
  contrast, labelColour, labelOn, luminance, mix, parse, presetFor, readable, rotateHue, toHex,
} from "../../ui/colour.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const css = readFileSync(join(root, "ui", "tokens.css"), "utf8");

// ---------------------------------------------------------------- reading the file

const firstComment = /\/\*([\s\S]*?)\*\//.exec(css)?.[1] ?? "";
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

// A small block reader: [{ prelude, body, children }] for `prelude { body }`, one
// level of nesting for @media.
function blocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    assert.equal(depth, 0, "tokens.css has an unclosed block");
    const prelude = text.slice(i, open).trim().replace(/\s+/g, " ");
    const body = text.slice(open + 1, j - 1);
    out.push({ prelude, body, children: prelude.startsWith("@media") ? blocks(body) : [] });
    i = j;
  }
  return out;
}

function declarations(body) {
  const map = new Map();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    map.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, " "));
  }
  return map;
}

const selectors = (block) => block.prelude.split(",").map((s) => s.trim()).sort().join(", ");
const top = blocks(bare);
const media = (query) => top.filter((b) => b.prelude.startsWith("@media") && b.prelude.includes(query)).flatMap((b) => b.children);
const one = (list, wanted, what) => {
  const found = list.filter((b) => selectors(b) === wanted);
  assert.equal(found.length, 1, `tokens.css should have exactly one ${what} block (${wanted}), found ${found.length}`);
  return declarations(found[0].body);
};

const shared = one(top, ":root", "shared");
const light = one(top, ':root, [data-theme="auto"], [data-theme="light"]', "light");
const dark = one(top, '[data-theme="dark"]', "chosen dark");
const darkAuto = one(media("prefers-color-scheme: dark"), ':root:not([data-theme]), [data-theme="auto"]', "device dark");
const reduced = one(media("prefers-reduced-motion: reduce"), ":root", "reduced motion");
const fontFaces = top.filter((b) => b.prelude === "@font-face").map((b) => declarations(b.body));

const themes = { light: new Map([...shared, ...light]), dark: new Map([...shared, ...dark]) };

// A token's value with every var() followed to its end.
function resolve(theme, name, seen = []) {
  assert.ok(themes[theme].has(name), `${theme}: ${name} is not defined in tokens.css`);
  assert.ok(!seen.includes(name), `${theme}: ${name} refers to itself`);
  return themes[theme].get(name).replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, inner) => resolve(theme, inner, [...seen, name]));
}

function colourOf(theme, name) {
  const value = resolve(theme, name);
  assert.ok(parse(value), `${theme}: ${name} is "${value}", which is not a colour`);
  return value;
}

// The comment table: rows whose first cell is a token.
function tablePairs() {
  const pairs = [];
  for (const line of firstComment.split("\n")) {
    const cells = line.trim().split("|").map((c) => c.trim());
    if (cells.length < 5 || !/^--[a-z][\w-]*$/.test(cells[1])) continue;
    const min = Number(cells[3]);
    assert.ok(min === AA_TEXT || min === AA_LARGE, `the table row for ${cells[1]} has the ratio "${cells[3]}"; it must be 4.5 or 3`);
    const surfaces = cells[2].split(/\s+/);
    for (const surface of surfaces) {
      assert.match(surface, /^--[a-z][\w-]*$/, `the table row for ${cells[1]} names the surface "${surface}"`);
      pairs.push({ text: cells[1], surface, min, where: cells[4] });
    }
  }
  return pairs;
}

const ratio = (n) => `${(Math.floor(n * 100) / 100).toFixed(2)}:1`;
const report = (failures) => assert.equal(failures.length, 0, `\n  ${failures.join("\n  ")}\n`);

// ---------------------------------------------------------------- ui/colour.js

test("parse reads hex and rgb() and returns null for anything else", () => {
  assert.deepEqual(parse("#1f2328"), { r: 31, g: 35, b: 40, a: 1 });
  assert.deepEqual(parse("#FFF"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parse(" #0f6e6680 "), { r: 15, g: 110, b: 102, a: 128 / 255 });
  assert.deepEqual(parse("rgb(15, 110, 102)"), { r: 15, g: 110, b: 102, a: 1 });
  assert.deepEqual(parse("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parse({ r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3, a: 1 });
  for (const junk of ["", "red", "#12", "#12345", "#gggggg", "<b>#fff</b>", "#fff;x", "rgb(1,2)", null, undefined, 7, {}, { r: 1, g: 2, b: NaN }]) {
    assert.equal(parse(junk), null, `parse(${JSON.stringify(junk)})`);
  }
  assert.equal(toHex({ r: 255, g: 253.6, b: 0 }), "#fffe00");
});

test("luminance and contrast are WCAG 2.1's, to the published figures", () => {
  assert.equal(luminance("#000000"), 0);
  assert.equal(luminance("#ffffff"), 1);
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#0f6e66", "#0f6e66"), 1);
  // The two greys either side of AA on white: #767676 passes, #777777 does not.
  assert.equal(ratio(contrast("#767676", "#ffffff")), "4.54:1");
  assert.equal(ratio(contrast("#777777", "#ffffff")), "4.47:1");
  assert.throws(() => luminance("teal"), TypeError);
  assert.throws(() => contrast("#fff", "nope"), /Not a colour this tool can read: nope/);
});

test("mix lays one colour over another", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#ffffff");
  assert.equal(mix("#000000", "#ffffff", 1), "#000000");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(ROOM_STRENGTH, Number(shared.get("--room-strength")), "ROOM_STRENGTH and --room-strength");
  assert.equal(OTHER_STRENGTH, Number(shared.get("--other-strength")), "OTHER_STRENGTH and --other-strength");
});

test("readable returns the colour itself when it passes, and otherwise the nearest step that does", () => {
  assert.equal(readable("#1f2328", "#f6f3ec"), "#1f2328");
  assert.equal(readable("#E8E6E1", "#15181c"), "#e8e6e1");
  // The yellow preset on light paper has to go a long way down; on dark paper it is fine.
  assert.equal(readable("#f0e442", "#f6f3ec"), "#767020");
  assert.equal(readable("#f0e442", "#15181c"), "#f0e442");
  // The blue preset is the other way about.
  assert.equal(readable("#0072b2", "#f6f3ec"), "#0072b2");
  assert.equal(readable("#0072b2", "#15181c"), "#2989be");
  // A lower bar moves it less.
  assert.equal(readable("#f0e442", "#f6f3ec", AA_LARGE), "#958d29");

  const failures = [];
  for (const [theme, names] of [["light", ["--paper", "--card", "--accent-soft"]], ["dark", ["--paper", "--card", "--accent-soft"]]]) {
    for (const name of names) {
      const surface = colourOf(theme, name);
      for (const colour of [...allPresets(), ...LOAD_BANDS]) {
        const got = readable(colour, surface);
        const c = contrast(got, surface);
        if (c < AA_TEXT) failures.push(`${theme}: readable(${colour}) on ${name} gave ${got} at ${ratio(c)}, needs 4.5:1`);
        const darker = luminance(got) <= luminance(colour);
        const lighter = luminance(got) >= luminance(colour);
        if (theme === "light" ? !darker : !lighter) failures.push(`${theme}: readable(${colour}) on ${name} gave ${got}, which went the wrong way`);
      }
    }
  }
  report(failures);
});

test("labelColour returns ink or paper, whichever contrasts more, exactly as passed", () => {
  const ink = "#1F2328";
  const paper = "#F6F3EC";
  assert.equal(labelColour("#f0e442", ink, paper), ink);
  assert.equal(labelColour("#0019b2", ink, paper), paper);
  assert.equal(labelColour("#ffffff", ink, paper), ink);
  assert.equal(labelColour("#000000", ink, paper), paper);
  // Dark theme: ink is the light one.
  assert.equal(labelColour("#f0e442", "#e8e6e1", "#15181c"), "#15181c");
  assert.equal(labelColour("#0019b2", "#e8e6e1", "#15181c"), "#e8e6e1");
  // labelOn leaves a passing choice alone and strengthens a short one.
  assert.equal(labelOn("#f0e442", "#1f2328", "#f6f3ec"), "#1f2328");
  assert.ok(contrast("#d1495b", labelColour("#d1495b", "#1f2328", "#f6f3ec")) < AA_TEXT, "the first preset is the case labelOn exists for");
  assert.ok(contrast("#d1495b", labelOn("#d1495b", "#1f2328", "#f6f3ec")) >= AA_TEXT);
});

function allPresets() {
  return Array.from({ length: GROUP_PRESETS.length * 2 }, (_, i) => presetFor(i));
}

test("presetFor gives the ten presets in order, then the turned set, then round again", () => {
  const design = ["#d1495b", "#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#8c6d31", "#7b4ea3", "#f0e442", "#999999"];
  assert.deepEqual(design.map((_, i) => presetFor(i)), design);
  assert.deepEqual(design.slice(0, 9).map((hex, i) => [presetFor(i + 10), rotateHue(hex, 30)]).filter(([a, b]) => a !== b), []);
  assert.equal(presetFor(10), "#d17b49", "the first preset turned 30 degrees");
  assert.equal(presetFor(19), "#666666", "the grey has no hue, so the second one is darker");
  assert.equal(new Set(allPresets()).size, 20, "twenty different colours");
  assert.equal(presetFor(20), presetFor(0));
  assert.equal(presetFor(45), presetFor(5));
  assert.equal(presetFor(-1), presetFor(19));
  assert.equal(presetFor(2.9), presetFor(2));
  assert.equal(presetFor(undefined), presetFor(0));
});

// ---------------------------------------------------------------- ui/tokens.css

const COLOUR_TOKENS = [
  "--paper", "--card", "--ink", "--ink-2", "--line", "--line-strong", "--accent", "--accent-ink", "--accent-soft", "--focus",
  "--problem", "--warning", "--note", "--grid", "--corridor", "--corridor-edge", "--stairs", "--room-default",
];

test("every colour token of DESIGN 3 is defined in the light theme and in both dark blocks", () => {
  for (const [name, block] of [["light", light], ["chosen dark", dark], ["device dark", darkAuto]]) {
    const missing = [...COLOUR_TOKENS, "--shadow", "color-scheme"].filter((t) => !block.has(t));
    assert.deepEqual(missing, [], `${name} is missing ${missing.join(", ")}`);
    assert.deepEqual([...block.keys()].sort(), [...light.keys()].sort(), `${name} and light define different tokens`);
  }
  assert.equal(light.get("color-scheme"), "light");
  assert.equal(dark.get("color-scheme"), "dark");
  for (const theme of ["light", "dark"]) for (const t of COLOUR_TOKENS) colourOf(theme, t);
});

test("the dark theme is the same whether it was chosen or followed from the device", () => {
  const different = [...dark.keys()].filter((k) => dark.get(k) !== darkAuto.get(k)).map((k) => `${k}: chosen ${dark.get(k)}, device ${darkAuto.get(k)}`);
  assert.deepEqual(different, []);
});

test("the dark theme has DESIGN 3's values", () => {
  const design = {
    "--paper": "#15181c", "--card": "#1d2126", "--ink": "#e8e6e1", "--ink-2": "#a9adb4", "--line": "#343a42",
    "--accent": "#5fc2b8", "--accent-ink": "#0b1a18", "--accent-soft": "#163a37", "--problem": "#ff8a80",
    "--warning": "#ffc86b", "--note": "#8fb4ea", "--grid": "#1a1e23", "--corridor": "#2a2f36", "--stairs": "#163a37",
    "--room-default": "#2f343b",
  };
  for (const [name, value] of Object.entries(design)) assert.equal(dark.get(name), value, name);
});

test("the light theme has DESIGN 3's values, but for --warning", () => {
  const design = {
    "--paper": "#f6f3ec", "--card": "#fffdf8", "--ink": "#1f2328", "--ink-2": "#515761", "--line": "#d8d3c8",
    "--accent": "#0f6e66", "--accent-ink": "#ffffff", "--accent-soft": "#d9ece9", "--problem": "#b3261e",
    "--note": "#3b5b8a", "--grid": "#e8e3d8", "--corridor": "#ffffff", "--stairs": "#d9ece9", "--room-default": "#e9e4d9",
  };
  for (const [name, value] of Object.entries(design)) assert.equal(light.get(name), value, name);
  // DESIGN 3 gives #9a6200, which is 4.16:1 on --accent-soft (a warning in a selected
  // row). The value here is the nearest that reaches 4.5:1 there.
  assert.equal(light.get("--warning"), "#925d00");
});

test("type scale, spacing, radii, border and motion are DESIGN 3's", () => {
  const design = {
    "--t-xs": "0.75rem", "--lh-xs": "1.2", "--t-sm": "0.875rem", "--lh-sm": "1.35", "--t-md": "1rem", "--lh-md": "1.5",
    "--t-lg": "1.25rem", "--lh-lg": "1.3", "--t-xl": "1.75rem", "--lh-xl": "1.15", "--t-fig": "2.5rem", "--lh-fig": "1",
    "--base": "16px", "--base-phone": "17px",
    "--s-1": "4px", "--s-2": "8px", "--s-3": "12px", "--s-4": "16px", "--s-5": "24px", "--s-6": "32px", "--s-7": "48px",
    "--r-1": "3px", "--r-2": "6px", "--border-width": "1px", "--focus-width": "2px", "--focus-offset": "2px",
    "--dur-1": "120ms", "--dur-2": "200ms", "--numeric": "tabular-nums",
  };
  for (const [name, value] of Object.entries(design)) assert.equal(shared.get(name), value, name);
  assert.match(shared.get("--font-ui"), /^"Public Sans", /);
  assert.match(shared.get("--font-plan"), /^"Barlow Semi Condensed", /);
  assert.match(shared.get("--border"), /var\(--line\)/);
});

test("reduced motion zeroes every duration", () => {
  const durations = [...shared.keys()].filter((k) => k.startsWith("--dur-"));
  assert.ok(durations.length >= 2);
  for (const name of durations) assert.equal(reduced.get(name), "0ms", `${name} under prefers-reduced-motion`);
});

test("the group palette and the load bands in tokens.css are the ones ui/colour.js hands out", () => {
  const groups = [...shared.keys()].filter((k) => k.startsWith("--group-"));
  assert.equal(groups.length, 20);
  allPresets().forEach((hex, i) => assert.equal(shared.get(`--group-${i + 1}`), hex, `--group-${i + 1} and presetFor(${i})`));
  const loads = [...shared.keys()].filter((k) => k.startsWith("--load-"));
  assert.equal(loads.length, 5);
  LOAD_BANDS.forEach((hex, i) => assert.equal(shared.get(`--load-${i + 1}`), hex, `--load-${i + 1}`));
  assert.deepEqual([...LOAD_BANDS], ["#e9eef2", "#bcd7e8", "#7fb3d5", "#d98a3e", "#b3261e"]);
});

test("the typefaces are six files, each loaded by a relative url from ../fonts, and nothing is offsite", () => {
  const got = fontFaces.map((f) => `${f.get("font-family")} ${f.get("font-weight")} ${f.get("font-style")}`).sort();
  assert.deepEqual(got, [
    '"Barlow Semi Condensed" 500 normal', '"Barlow Semi Condensed" 600 normal',
    '"Public Sans" 400 normal', '"Public Sans" 500 normal', '"Public Sans" 600 normal', '"Public Sans" 700 normal',
  ]);
  const urls = [...bare.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 6, "one url() per @font-face and none anywhere else");
  for (const url of urls) {
    assert.match(url, /^\.\.\/fonts\/[a-z0-9-]+\.woff2$/, `${url} is not a relative ../fonts/ woff2`);
    assert.ok(existsSync(join(root, "ui", ...url.split("/"))), `${url} is not in fonts/`);
  }
  for (const face of fontFaces) {
    const family = face.get("font-family").replaceAll('"', "").toLowerCase().replaceAll(" ", "-");
    assert.ok(face.get("src").includes(`../fonts/${family}-latin-${face.get("font-weight")}-normal.woff2`), `${family} ${face.get("font-weight")} loads another weight's file`);
    assert.equal(face.get("font-display"), "swap");
  }
  assert.doesNotMatch(bare, /@import|https?:|\/\//, "tokens.css must not reach outside the tool");
  const files = readdirSync(join(root, "fonts")).sort();
  assert.deepEqual(files, [
    "LICENSE-barlow-semi-condensed.txt", "LICENSE-public-sans.txt", "README.md",
    "barlow-semi-condensed-latin-500-normal.woff2", "barlow-semi-condensed-latin-600-normal.woff2",
    "public-sans-latin-400-normal.woff2", "public-sans-latin-500-normal.woff2",
    "public-sans-latin-600-normal.woff2", "public-sans-latin-700-normal.woff2",
  ]);
  for (const file of files.filter((f) => f.endsWith(".woff2"))) {
    assert.equal(readFileSync(join(root, "fonts", file)).subarray(0, 4).toString("latin1"), "wOF2", `${file} is not a woff2 file`);
  }
});

test("axe-core is vendored with its licence and the version its README names", () => {
  const dir = join(root, "test", "vendor", "axe-core");
  const version = /axe-core (\d+\.\d+\.\d+)/.exec(readFileSync(join(dir, "README.md"), "utf8"))?.[1];
  assert.ok(version, "the README names a version");
  assert.ok(readFileSync(join(dir, "axe.min.js"), "utf8").startsWith(`/*! axe v${version}\n`), `axe.min.js is not ${version}`);
  assert.match(readFileSync(join(dir, "LICENSE"), "utf8"), /Mozilla Public License,? [Vv]ersion 2\.0/);
});

// ---------------------------------------------------------------- the contrast checks

// Colour tokens that carry no text and edge no control, so have no row in the table.
const NOT_IN_TABLE = ["--line", "--corridor-edge", "--shadow"];

test("every colour token is in the comment table, or is one of the three that carry nothing", () => {
  const pairs = tablePairs();
  const named = new Set(pairs.flatMap((p) => [p.text, p.surface]));
  const unlisted = COLOUR_TOKENS.filter((t) => !named.has(t) && !NOT_IN_TABLE.includes(t));
  assert.deepEqual(unlisted, [], `not in the table at the top of tokens.css: ${unlisted.join(", ")}`);
  const known = [...COLOUR_TOKENS, ...NOT_IN_TABLE];
  const defined = [...light.keys()].filter((k) => k.startsWith("--"));
  assert.deepEqual(defined.filter((t) => !known.includes(t)), [], "a colour token in tokens.css that this test does not know");
});

test("every text and surface pair in the comment table meets its ratio in both themes", () => {
  const pairs = tablePairs();
  assert.ok(pairs.length >= 30, `the comment table lists ${pairs.length} pairs; the parser has lost some`);
  const failures = [];
  for (const theme of ["light", "dark"]) {
    for (const { text, surface, min, where } of pairs) {
      const c = contrast(colourOf(theme, text), colourOf(theme, surface));
      if (c < min) failures.push(`${theme}: ${text} on ${surface} is ${ratio(c)}, needs ${min}:1 (${where})`);
    }
  }
  report(failures);
});

test("a label on any group colour or load band can be read, at full strength and at the plan's strength, in both themes", () => {
  const fills = [
    ...allPresets().map((hex, i) => [`--group-${i + 1}`, hex]),
    ...LOAD_BANDS.map((hex, i) => [`--load-${i + 1}`, hex]),
  ];
  const failures = [];
  for (const theme of ["light", "dark"]) {
    const ink = colourOf(theme, "--ink");
    const paper = colourOf(theme, "--paper");
    for (const [name, token] of fills) {
      const hex = shared.get(name);
      assert.equal(hex, token, name);
      const cases = [[`${name} ${hex}`, hex]];
      for (const surface of ["--paper", "--card", "--grid"]) {
        cases.push([`${name} ${hex} at ${ROOM_STRENGTH} over ${surface}`, mix(hex, colourOf(theme, surface), ROOM_STRENGTH)]);
      }
      for (const [what, fill] of cases) {
        const plain = labelColour(fill, ink, paper);
        assert.ok(plain === ink || plain === paper, "labelColour returns one of the two it was given");
        const c = contrast(fill, plain);
        if (c < AA_LARGE) failures.push(`${theme}: labelColour on ${what} is ${ratio(c)}, needs 3:1`);
        const strong = contrast(fill, labelOn(fill, ink, paper));
        if (strong < AA_TEXT) failures.push(`${theme}: labelOn on ${what} is ${ratio(strong)}, needs 4.5:1`);
      }
    }
  }
  report(failures);
});
