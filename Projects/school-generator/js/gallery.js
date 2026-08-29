// gallery.js — three finished schools on the front door.
//
// Phase 30's first item. Phase 19 gave the first visit three doors, and two of
// them opened onto *work*: draw something, or describe something. The fastest
// possible first minute is neither — it is walking a building somebody else
// already finished — and the tool has been able to hand that over since Phase
// 9 without a server. A share link is a whole design in a string; a string can
// live in a file as easily as in an address bar. So the gallery is three of
// them, embedded.
//
// What is in this module and what is not:
//
//   - **The recipes.** Each card names the brief it was built from — the
//     student count, the band, the storeys, the scheme, the seed. That is the
//     card's provenance and its regeneration instructions at once: the suite
//     rebuilds every card from its recipe and checks the stock still matches,
//     so a card cannot quietly drift away from the generator that made it.
//   - **The thumbnail, as geometry.** `planThumb` reduces a design's ground
//     floor to normalized rings; `thumbPaths` scales those into a box as SVG
//     path data. Generated at stock time, drawn as vectors — no image is
//     shipped, which is the same house rule the textures live under.
//   - **The facts.** How many rooms, how many storeys, how much floor. Counted
//     off the design rather than typed into the card, so the second line of a
//     card cannot be wrong.
//
// What is *not* here is the payloads. They are bytes — 60-odd kilobytes of
// them — and they live in `gallerystock.js`, which `tools/make-gallery.mjs`
// writes and which main.js fetches lazily the first time the welcome opens.
// Nothing pays for the gallery on a load that never shows it.
//
// Pure module: no three.js, no DOM. Exercised by test/gallery.test.mjs.

import { shapesOf, shapeArea } from './shapes.js';
import { paScript } from './murmur.js';

// ---------- the cards ----------
//
// A card is metadata plus a recipe. The title is *not* written here: it comes
// out of `paScript` on the same seed the design carries, so the name on the
// card is the name the PA reads out at nine o'clock inside it. One seed, one
// school, one name — see `cardTitle`.

export const CARDS = [
  {
    id: 'elementary',
    line: 'A one-storey elementary school under one long roof — every classroom '
      + 'on the corridor, the hall at the end of it, and a playground outside.',
    brief: { students: 300, band: 'elementary', storeys: 1, scheme: 'bar', seed: 3, site: true },
  },
  {
    id: 'middle',
    line: 'A middle school wrapped around a courtyard, two storeys of it, with '
      + 'the light coming in from both sides of every teaching wing.',
    brief: { students: 600, band: 'middle', storeys: 2, scheme: 'courtyard', seed: 9, site: true },
  },
  {
    id: 'high',
    line: 'A high school spread over a campus — separate blocks, a quad between '
      + 'them, and enough of it that the walk to third period is a real walk.',
    brief: { students: 900, band: 'high', storeys: 2, scheme: 'campus', seed: 12, site: true },
  },
];

export const CARD_IDS = CARDS.map((c) => c.id);

export const cardById = (id) => CARDS.find((c) => c.id === id) || null;

// The name on the card, and the name the PA says. Both are `paScript`'s, off
// the seed the brief carries — which is the seed `buildSchool` writes onto
// `state.life`, which is the seed main.js hands the announcement. The chain is
// four links long and the suite pins every one of them.
export const cardTitle = (card) => paScript(card && card.brief ? card.brief.seed : 1).school;

// ---------- the thumbnail, as geometry ----------

// The unit box the rings are normalized into. An integer grid rather than a
// 0..1 float: "412,088" is seven characters and "0.412,0.088" is eleven, and
// the stock file holds a few thousand of them.
export const THUMB_SPAN = 1000;

// A ring point that sits on the straight line between its neighbours tells a
// thumbnail nothing and costs it eight bytes. Generated schools are almost all
// rectilinear, so this drops a third of the vertices on a good day. In grid
// units — a hair either side of the line still counts as on it.
const FLAT = 1.5;

function dropCollinear(pts) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    // Twice the triangle area — zero when b is on ac — measured against the
    // longer leg so the tolerance is a distance rather than an area.
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const legs = Math.max(
      Math.hypot(c[0] - a[0], c[1] - a[1]),
      1e-6);
    if (cross / legs > FLAT) out.push(b);
  }
  // Never reduce a ring to nothing: a room whose corners are all "flat" is a
  // degenerate one, and a degenerate room should be dropped by the caller
  // rather than smuggled through as an empty path.
  return out.length >= 3 ? out : pts.slice();
}

// A room too small to read at thumbnail size, in grid units squared. A closet
// at 220px across is three pixels of grey; a hundred of them are mud.
const MIN_THUMB_AREA = 90;

// A design's ground floor as normalized rings. Holes are kept — a courtyard
// scheme with its court filled in is the wrong building — and ride in the
// same path with the even-odd fill rule the caller sets.
//
// Returns `{ w, h, rooms: [{ p: [ring, ...], c }] }` where every coordinate is
// an integer in [0, THUMB_SPAN], `w`/`h` are the box those coordinates fill,
// and `c` is the room's own colour. Both axes take the *same* scale, so the
// thumbnail is the plan rather than a squashed one.
export function planThumb(state, floor = 0) {
  const shapes = shapesOf(state && state.floors ? state.floors[floor] : null);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const sh of shapes) {
    for (const p of sh.rings[0].pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
  }
  if (!Number.isFinite(x0)) return { w: 0, h: 0, rooms: [] };
  const span = Math.max(x1 - x0, z1 - z0, 1e-6);
  const k = THUMB_SPAN / span;
  const put = (p) => [Math.round((p.x - x0) * k), Math.round((p.z - z0) * k)];

  const rooms = [];
  for (const sh of shapes) {
    const rings = [];
    for (const r of sh.rings) {
      const pts = dropCollinear(r.pts.map(put));
      if (pts.length >= 3) rings.push(pts);
    }
    if (!rings.length) continue;
    if (ringArea(rings[0]) < MIN_THUMB_AREA) continue;
    rooms.push({ p: rings, c: normalizeTone(sh.color) });
  }
  return {
    w: Math.round((x1 - x0) * k),
    h: Math.round((z1 - z0) * k),
    rooms,
  };
}

// The shoelace, unsigned — a ring in this module may be wound either way and
// only ever gets compared against a threshold.
function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) / 2;
}

// A colour a card can hand to `fill` without an SVG parser shrugging. Rooms
// carry `'#rrggbb'`; anything else in that field is somebody else's bug and
// gets the neutral rather than an exception.
export const THUMB_FALLBACK = '#8d9aa8';
export function normalizeTone(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : THUMB_FALLBACK;
}

// The thumbnail as SVG path data, fitted into a `size` box and centred in it.
// Returns `[{ d, fill }]` plus the viewBox the caller should set — everything
// the DOM side needs and not one thing it has to work out for itself.
export function thumbPaths(thumb, size = 220) {
  const t = thumb && Array.isArray(thumb.rooms) ? thumb : { w: 0, h: 0, rooms: [] };
  const span = Math.max(t.w || 0, t.h || 0, 1);
  const k = size / span;
  const dx = (size - (t.w || 0) * k) / 2;
  const dy = (size - (t.h || 0) * k) / 2;
  const at = (p) => `${round2(p[0] * k + dx)} ${round2(p[1] * k + dy)}`;
  const paths = t.rooms.map((room) => ({
    fill: normalizeTone(room.c),
    d: room.p.map((ring) => `M${ring.map(at).join('L')}Z`).join(''),
  }));
  return { size, paths };
}

const round2 = (v) => Math.round(v * 100) / 100;

// ---------- the facts under the sentence ----------

// Counted off the design, never typed. `area` is usable floor area over every
// storey, in ft², which is the number the takeoff and the report both mean by
// it — the same question, answered once here for a card rather than twice.
export function cardFacts(state) {
  const floors = state && Array.isArray(state.floors) ? state.floors : [];
  let rooms = 0, area = 0;
  for (const f of floors) {
    for (const sh of shapesOf(f)) { rooms++; area += shapeArea(sh); }
  }
  return { storeys: floors.length, rooms, area: Math.round(area) };
}

const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const spell = (n) => (n >= 0 && n < COUNTS.length ? COUNTS[n] : String(n));

export function factLine(facts) {
  const f = facts || {};
  const rooms = Math.max(0, Math.round(f.rooms || 0));
  const storeys = Math.max(0, Math.round(f.storeys || 0));
  const sqft = Math.max(0, Math.round(f.area || 0));
  return `${rooms} rooms on ${spell(storeys)} ${storeys === 1 ? 'storey' : 'storeys'}`
    + ` · ${sqft.toLocaleString('en-US')} sq ft`;
}

// ---------- the stock ----------

// What `tools/make-gallery.mjs` writes for one card, minus the payload it
// encodes separately. Here rather than in the tool so the suite can build the
// same record from the same design and compare it byte for byte.
export function stockEntry(state) {
  return { thumb: planThumb(state, 0), facts: cardFacts(state) };
}

// A stock entry out of a file, believed only as far as it can be checked. The
// gallery is embedded data rather than user input, but it is *generated* data,
// and a card that renders as an exception on the front door is the worst
// possible place to find that out.
export function validStock(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.payload !== 'string' || entry.payload.length < 8) return false;
  const t = entry.thumb;
  if (!t || !Array.isArray(t.rooms) || !t.rooms.length) return false;
  if (!(t.w > 0) || !(t.h > 0)) return false;
  const f = entry.facts;
  if (!f || !(f.rooms > 0) || !(f.storeys > 0) || !(f.area > 0)) return false;
  return true;
}

// The cards a build can actually show: metadata joined to stock, in the order
// `CARDS` declares, with anything unusable left out rather than rendered
// broken. A build whose stock file is missing shows no gallery and keeps its
// doors, which is exactly what the welcome did before this phase.
export function galleryCards(stock) {
  const src = stock && typeof stock === 'object' ? stock : {};
  const out = [];
  for (const card of CARDS) {
    const entry = src[card.id];
    if (!validStock(entry)) continue;
    out.push({
      id: card.id,
      title: cardTitle(card),
      line: card.line,
      facts: entry.facts,
      factLine: factLine(entry.facts),
      thumb: entry.thumb,
      payload: entry.payload,
    });
  }
  return out;
}
