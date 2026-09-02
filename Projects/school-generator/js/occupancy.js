// occupancy.js — how many people a room is allowed to hold, and why.
//
// Phase 7's first module and the one the rest of the phase does arithmetic
// with. Egress width is occupant load times a number; the number of exits a
// storey needs is occupant load against a table; whether a fire drill's
// ninety students are a plausible ninety is occupant load again. So the count
// comes first, and everything else reads it.
//
// It is, like every reader in this codebase, derived: a room's occupant load
// is its area divided by a factor chosen from what the room is called. There
// is no `occ` field on a room, nothing to keep in step with an edit, and
// renaming "Room 104" to "Art Studio" re-prices the room on the next rebuild.
//
// **Phase 12 gives the derivation somewhere to be overruled.** A room record
// now carries `group` — the occupancy group a person decided this space is,
// when the label guessed wrong — and `load`, a design occupant load somebody
// typed because they know something the area does not. Both default to null,
// which means "derive it", so nothing changes for a design that answers
// neither question. That is the whole of the difference identity makes here:
// there was previously nowhere to write the answer down.
//
// The design as a whole grows `code` for the same reason — which edition the
// analysis is read against, and whether the building is sprinklered. Phase 7
// asked both as *session* settings, because nothing about the analysis was
// saved; they are facts about the building and they belong in the file.
//
// **The classification is a guess made out loud.** A building code assigns a
// use to a space because a person decided what the space is for; all this file
// has is a label somebody typed and a floor area. So every row says which rule
// it used and which factor came out of it, the panel prints that alongside the
// number, and a room nobody named is counted at a deliberately vague factor
// and *listed* as unnamed rather than quietly folded into the total.
//
// The factors are IBC Table 1004.5 (occupant load factors, ft² per person)
// rounded to the values a school actually uses — and since Phase 41 they are
// read off `codes.js`'s table for the edition the design stores rather than
// off this file, so the sheet's "IBC 2021 applied" is a sentence about these
// numbers. `USES` below carries the use's *identity* (its key, its label, the
// names that read as it, what it is measured over); the number comes from the
// edition. The `factor` on each row is the default edition's, for a menu or a
// test that has no edition in hand — a reader pricing a room asks the edition.
//
// **Phase 41's other change: an unnamed room answers with a range.** Its
// factor is a placeholder, so its occupant load is a guess dressed as a
// number; the row now carries `low` and `high` as well — the room counted as
// the sparsest and the densest thing it could be — and the building's total
// carries the sum. Naming the room collapses the range to a point, and the
// report says which room to name first.
//
// Net vs gross is carried as a label rather than as arithmetic: this model's room area is already the area
// inside the room's own walls, which is what "net" means and near enough what
// "gross" means at one room's scale. Where the two genuinely differ — a whole
// storey measured to the outside face — the difference is walls, and the
// takeoff knows their thickness.
//
// Pure module: no three.js, no DOM. Exercised by test/occupancy.test.mjs.

import { floorLabel } from './grid.js';
import { floorRooms } from './navgraph.js';
import { editionOf, factorOf, factorSpan, DEFAULT_EDITION, editionEntry } from './codes.js';
import { range, addRanges } from './range.js';

// ---------- the use table ----------
//
// Order matters: the first row whose `match` fires wins, so the specific
// names sit above the general ones. "Science Lab" must reach `lab` before
// `classroom` sees the word room in "Storeroom", which is why `classroom`
// matches a *room number* rather than the bare word.
//
// `factor` is ft² per person. `basis` is what a code would measure it over.
// `circulation` marks the spaces that carry an occupant load rather than
// generating one — a corridor's people are the classrooms' people, counted
// once, and counting them again at both ends is the classic way to double a
// building's occupant load on paper.
export const USES = [
  {
    key: 'assembly-seats', label: 'Assembly (fixed seating)', basis: 'net',
    match: /auditorium|theat|assembly|lecture hall|chapel|sanctuar/,
  },
  {
    key: 'library', label: 'Library / media', basis: 'net',
    // Above the assembly row on purpose: a *learning* commons is a library
    // with sofas in it, and a dining commons is the one that seats a crowd.
    match: /librar|media cent|learning commons|reading room|book/,
  },
  {
    key: 'assembly-tables', label: 'Assembly (tables & chairs)', basis: 'net',
    match: /cafeteria|cafetorium|dining|lunch|commons|multipurpose|multi-purpose|cafe\b/,
  },
  {
    key: 'gym', label: 'Gymnasium / exercise', basis: 'gross',
    match: /gym|fitness|weight room|wrestling|dance studio|natatorium|pool/,
  },
  {
    key: 'stage', label: 'Stage', basis: 'net',
    match: /stage|band room|choir|orchestra|music room/,
  },
  {
    key: 'lab', label: 'Laboratory / shop', basis: 'net',
    match: /\blab\b|laborator|science|chem|physics|biolog|shop|wood ?shop|metal ?shop|makerspace|maker space|art room|art studio|studio|computer lab|tech ed|vocational|culinary/,
  },
  {
    key: 'kitchen', label: 'Kitchen', basis: 'gross',
    match: /kitchen|servery|serving|pantry|scullery/,
  },
  {
    key: 'locker', label: 'Locker room', basis: 'gross',
    match: /locker|changing|change room/,
  },
  {
    key: 'office', label: 'Office / administration', basis: 'gross',
    match: /office|admin|reception|conference|meeting|staff|faculty|teacher work|counsel|principal|nurse|clinic|health|work ?room|copy/,
  },
  {
    key: 'storage', label: 'Storage / service', basis: 'gross',
    match: /storage|storeroom|store ?room|stock|mech|electric|boiler|server|\bit\b|data|custodi|janitor|maint|utility|closet|receiving|loading/,
  },
  {
    key: 'circulation', label: 'Circulation', basis: 'gross', circulation: true,
    match: /corridor|hall(?!ow)|hallway|lobby|vestibul|foyer|atrium|stair|landing|elevator|lift|walkway|breezeway|entry|entrance/,
  },
  {
    key: 'restroom', label: 'Restroom', basis: 'gross', circulation: true,
    match: /restroom|rest room|toilet|bathroom|washroom|\bwc\b|lavator|shower/,
  },
  {
    key: 'classroom', label: 'Classroom', basis: 'net',
    // A room *number* is a classroom in every school ever built, and so is
    // anything that says so. `room` on its own is not enough — "Storeroom"
    // and "Workroom" are above this row for exactly that reason.
    match: /classroom|class ?rm|home ?room|seminar|tutor|resource|\broom\s*\d|\brm\.?\s*\d|^\d{1,4}[a-z]?$|kindergarten|\bpre-?k\b|grade \d/,
  },
];

// The default edition's number on every row, for readers with no edition in
// hand. Assigned rather than typed so there is one table of factors, not two.
const DEFAULT_TABLE = editionEntry(DEFAULT_EDITION);
for (const u of USES) u.factor = u.circulation ? 0 : factorOf(DEFAULT_TABLE, u.key);

const BY_KEY = new Map(USES.map((u) => [u.key, u]));

// The groups a person can pick from when the label guessed wrong. Same keys
// the table above uses, so `group` is "which of these rows applies" rather
// than a second vocabulary to keep in step.
export const GROUP_KEYS = USES.map((u) => u.key);
export const isGroup = (k) => BY_KEY.has(k);

// ---------- what the analysis is read against ----------
//
// Which edition the numbers are read against, and whether the building is
// sprinklered: two facts about the building that live in the file (v11). They
// lived here until Phase 41; they live in `codes.js` now, beside the tables
// they select, and every importer moved with them — a re-export would be a
// second name for the same rule, and the walk bundler refuses one anyway.

// The use a room falls into when its name says nothing — or when it has no
// name at all. Deliberately not `classroom`: guessing "classroom" fills a
// building with occupants nobody put there, and this number is meant to be
// obviously provisional. Every row that lands here is reported as unnamed.
export const UNASSIGNED = {
  key: 'unassigned', label: 'Unassigned', basis: 'gross', guess: true,
};

export const useEntry = (key) => BY_KEY.get(key) || UNASSIGNED;

// Anything smaller than this with no name is a cupboard, a wall pocket or a
// mis-click, and giving it an occupant is worse than saying nothing.
export const MIN_OCCUPIABLE = 40;   // ft²

// Which use a name reads as, or null when nothing matches. Exported because
// "why did it say that?" is a question the panel has to be able to answer.
export function classify(name) {
  const s = (name || '').toLowerCase().trim();
  if (!s) return null;
  for (const u of USES) if (u.match.test(s)) return u.key;
  return null;
}

// One room's occupant load. `room` is a `floorRooms` row — a name, an area, a
// group somebody picked, a load somebody typed.
//
// The order of precedence is the order of how much a person said: the room's
// own `load` beats everything, its own `group` beats the label, and the label
// is what is left. `opts.use` sits above all three because it is a caller
// asking a hypothetical ("what would this be as a lab?"). `opts.edition` is
// the table the factor comes off — the design's own unless a caller says.
export function roomOccupancy(room, opts = {}) {
  const edition = editionOf(opts.edition, opts.state);
  const forced = opts.use && BY_KEY.has(opts.use) ? opts.use : null;
  const chosen = isGroup(room.group) ? room.group : null;
  const key = forced || chosen || classify(room.name);
  const use = key ? BY_KEY.get(key) : UNASSIGNED;
  const factor = use.circulation ? 0 : factorOf(edition, use.key);
  const area = Math.max(0, room.area || 0);
  const tiny = !key && area < MIN_OCCUPIABLE;
  // Round *up*: a code's occupant load is the number of people the space is
  // designed to hold, and half a person leaving the building is a whole one.
  const stated = Number.isFinite(room.load) && room.load > 0 ? Math.round(room.load) : null;
  const occ = stated === null ? (factor > 0 && !tiny ? Math.ceil(area / factor) : 0) : stated;
  // The range. A point for anything a person or a label decided; for a room
  // nobody named, the room counted as the emptiest and the fullest kind of
  // space the edition prices — because it is *some* kind of space.
  let span = range(occ, occ);
  if (!key && !tiny && stated === null) {
    const f = factorSpan(edition);
    span = range(f.max > 0 ? Math.ceil(area / f.max) : 0, f.min > 0 ? Math.ceil(area / f.min) : 0);
  }
  return {
    id: room.id,
    floor: room.floor,
    name: room.name || null,
    rep: room.rep,
    x: room.x, z: room.z,
    area,
    use: use.key,
    useLabel: use.label,
    factor,
    basis: use.basis,
    // True when nothing about the room said what it was — the number below is
    // a placeholder, and a reader should say so rather than print it plain.
    guess: !key,
    // ...and the other way round: true when a person answered rather than the
    // label, which is the one case a reader should *stop* hedging about.
    chosen: !!chosen,
    // The load somebody typed, or null when this is the area's own answer. A
    // reader that prints "34 occupants" wants to be able to say which.
    stated,
    // True when the room carries other rooms' people rather than its own.
    circulation: use.circulation === true,
    tiny,
    occ,
    // Phase 41: what the number could be. `low === high === occ` for every
    // room somebody or something named; wider for a guess, and `spread` is
    // how much wider — the number naming this room would take off the total.
    low: span.low,
    high: span.high,
    spread: span.high - span.low,
    edition: edition.key,
  };
}

// Every room on one storey, priced. The rooms come from the nav graph's own
// reader, so a room here is a room there — the same id, the same hub, and the
// same answer to "which room is this point in".
export function floorOccupancy(state, floorIndex, opts = {}) {
  const nav = opts.nav || null;
  const edition = editionOf(opts.edition, state);
  const rooms = nav && nav.perFloor && nav.perFloor[floorIndex]
    ? nav.perFloor[floorIndex].rooms
    : floorRooms(state, floorIndex).rooms;
  const out = rooms.map((r) => roomOccupancy(r, { ...opts, edition }));
  const span = addRanges(out);
  return {
    floor: floorIndex,
    label: floorLabel(floorIndex),
    rooms: out,
    occ: out.reduce((n, r) => n + r.occ, 0),
    low: span.low,
    high: span.high,
    area: out.reduce((n, r) => n + r.area, 0),
  };
}

function tallyByUse(rows) {
  const by = new Map();
  for (const r of rows) {
    let t = by.get(r.use);
    if (!t) {
      t = { use: r.use, label: r.useLabel, factor: r.factor, rooms: 0, area: 0, occ: 0 };
      by.set(r.use, t);
    }
    t.rooms++; t.area += r.area; t.occ += r.occ;
  }
  return [...by.values()].sort((a, b) => b.occ - a.occ || b.area - a.area);
}

// The whole building: every storey, every room, and the roll-ups a panel or a
// title block wants. `upper` is the load above the ground floor, which is the
// number stair width is sized against and the one a single-storey building
// gets to ignore.
export function buildingOccupancy(state, opts = {}) {
  const edition = editionOf(opts.edition, state);
  const floors = [];
  const count = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < count; i++) floors.push(floorOccupancy(state, i, { ...opts, edition }));
  const rooms = floors.flatMap((f) => f.rooms);
  const span = addRanges(rooms);
  // Which single input would narrow the total most: the unnamed room with
  // the widest range. Naming it is worth `spread` people off the high end —
  // the sentence the report prints beside the range.
  const narrows = rooms
    .filter((r) => r.spread > 0)
    .sort((a, b) => b.spread - a.spread || b.area - a.area)[0] || null;
  return {
    edition: edition.key,
    editionLabel: edition.label,
    floors,
    rooms,
    byUse: tallyByUse(rooms),
    total: rooms.reduce((n, r) => n + r.occ, 0),
    // Phase 41: the total as a range. Equal to `total` at both ends when every
    // room is named; wider by exactly the unnamed rooms' spread when not.
    low: span.low,
    high: span.high,
    narrows: narrows
      ? { id: narrows.id, floor: narrows.floor, name: narrows.name, area: narrows.area, spread: narrows.spread }
      : null,
    upper: floors.slice(1).reduce((n, f) => n + f.occ, 0),
    area: rooms.reduce((n, r) => n + r.area, 0),
    unnamed: rooms.filter((r) => r.guess && !r.tiny).length,
    named: rooms.filter((r) => !r.guess).length,
  };
}

// A lookup from room id to its row, for the readers that have a room and want
// its load — egress, mainly, which asks once per doorway.
export const occupancyIndex = (occ) => new Map(occ.rooms.map((r) => [r.id, r]));
