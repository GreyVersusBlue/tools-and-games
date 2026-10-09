// Colour helpers. Pure: no DOM, no window, no storage. Runs in the page and in Node.
//
// Subject and group colours are data (a hex the school chose). Interface colours are
// tokens in tokens.css. This module is where the two meet: it answers "can this be
// read on that?" and, when the answer is no, returns the nearest colour that can.
//
// The contrast arithmetic is WCAG 2.1's: relative luminance from linearised sRGB,
// ratio (lighter + 0.05) / (darker + 0.05).

// The group palette of DESIGN.md section 3, in order.
export const GROUP_PRESETS = Object.freeze([
  "#d1495b", "#0072b2", "#e69f00", "#009e73", "#cc79a7",
  "#56b4e9", "#8c6d31", "#7b4ea3", "#f0e442", "#999999",
]);

// Load bands, quiet to busy.
export const LOAD_BANDS = Object.freeze(["#e9eef2", "#bcd7e8", "#7fb3d5", "#d98a3e", "#b3261e"]);

// The second set of group colours is the first with each hue turned this far.
export const PRESET_ROTATION = 30;
// A grey has no hue to turn, so in the second set it moves in lightness instead.
export const PRESET_GREY_SHIFT = -0.2;

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

// How far a subject colour is laid over the surface for a room on the plan, and an
// other space's colour for an other space (tokens.css: --room-strength, --other-strength).
export const ROOM_STRENGTH = 0.7;
export const OTHER_STRENGTH = 0.6;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

// "#rgb", "#rgba", "#rrggbb", "#rrggbbaa", "rgb(r, g, b)", "rgba(r, g, b, a)" or an
// {r, g, b} object -> {r, g, b, a} with r, g, b in 0..255 and a in 0..1.
// Anything else -> null. Nothing here is ever read as markup.
export function parse(colour) {
  if (colour && typeof colour === "object") {
    const { r, g, b, a = 1 } = colour;
    return [r, g, b, a].every(Number.isFinite) ? { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) } : null;
  }
  if (typeof colour !== "string") return null;
  const text = colour.trim();
  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    const n = (i) => parseInt(digits.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = RGB.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    const out = { r: clamp(+rgb[1], 0, 255), g: clamp(+rgb[2], 0, 255), b: clamp(+rgb[3], 0, 255), a: clamp(alpha, 0, 1) };
    return [out.r, out.g, out.b, out.a].every(Number.isFinite) ? out : null;
  }
  return null;
}

// {r, g, b} -> "#rrggbb". Alpha is dropped: every colour this module returns is opaque.
export function toHex(colour) {
  const c = need(colour);
  return "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

// WCAG 2.1 relative luminance, 0 (black) to 1 (white).
export function luminance(colour) {
  const c = need(colour);
  const linear = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

// WCAG 2.1 contrast ratio, 1 to 21. The order of the arguments does not matter.
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// `colour` laid over `surface` at `strength` (0 = all surface, 1 = all colour).
export function mix(colour, surface, strength) {
  const c = need(colour);
  const s = need(surface);
  const t = clamp(strength, 0, 1);
  return toHex({ r: s.r + (c.r - s.r) * t, g: s.g + (c.g - s.g) * t, b: s.b + (c.b - s.b) * t });
}

// The luminance where black and white contrast equally: darker surfaces than this
// take a lightened colour, lighter ones a darkened colour.
const MIDPOINT = Math.sqrt(1.05 * 0.05) - 0.05;
const STEPS = 100;

// The nearest variant of `colour` with at least `min` contrast on `surface`:
// the colour itself when it already has it, otherwise the colour moved towards white
// (on a dark surface) or towards black (on a light one) in steps of 1%, stopping at
// the first step that is enough. Returns "#rrggbb". The far end of the walk is white
// or black, so a result exists for any `min` up to 4.58 on every surface; for a higher
// `min` the result is the best there is, which the caller can measure with `contrast`.
export function readable(colour, surface, min = AA_TEXT) {
  const c = need(colour);
  const s = need(surface);
  if (contrast(c, s) >= min) return toHex(c);
  const end = luminance(s) < MIDPOINT ? "#ffffff" : "#000000";
  for (let step = 1; step < STEPS; step++) {
    const candidate = mix(end, c, step / STEPS);
    if (contrast(candidate, s) >= min) return candidate;
  }
  return end;
}

// The colour for a label drawn on `fill`: whichever of the theme's ink and paper
// contrasts more with it. Pass the current theme's two values; the one chosen is
// returned exactly as given. A tie goes to ink.
export function labelColour(fill, ink, paper) {
  return contrast(fill, paper) > contrast(fill, ink) ? paper : ink;
}

// The label for small text on `fill`, with at least `min` contrast: labelColour's
// choice when that is enough, otherwise that choice strengthened by `readable`.
// Ink or paper alone reaches only about 3.7:1 on a mid-tone fill, so the plan's room
// numbers and anything else written on a data colour come through here.
export function labelOn(fill, ink, paper, min = AA_TEXT) {
  return readable(labelColour(fill, ink, paper), fill, min);
}

// `colour` with its hue turned by `degrees`, lightness and saturation kept.
export function rotateHue(colour, degrees) {
  const [h, s, l] = toHsl(need(colour));
  return toHex(fromHsl((((h + degrees) % 360) + 360) % 360, s, l));
}

// The group colour for the nth new group, counting from 0: the ten presets in order,
// then the ten again with each hue turned 30 degrees, then round again.
export function presetFor(index) {
  const count = GROUP_PRESETS.length;
  const n = Number.isFinite(index) ? Math.floor(index) : 0;
  const i = ((n % (count * 2)) + count * 2) % (count * 2);
  const base = GROUP_PRESETS[i % count];
  if (i < count) return base;
  const [h, s, l] = toHsl(parse(base));
  if (s === 0) return toHex(fromHsl(h, s, clamp(l + PRESET_GREY_SHIFT, 0, 1)));
  return rotateHue(base, PRESET_ROTATION);
}

function need(colour) {
  const c = parse(colour);
  if (!c) throw new TypeError(`Not a colour this tool can read: ${String(colour)}`);
  return c;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function toHsl({ r, g, b }) {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === x) h = ((y - z) / d) % 6;
  else if (max === y) h = (z - x) / d + 2;
  else h = (x - y) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
