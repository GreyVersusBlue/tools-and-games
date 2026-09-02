// codes.js — the code editions, as numbers rather than as a label.
//
// Phase 7 offered three editions of the IBC in a menu and Phase 12 put the
// choice in the file, and from then until Phase 41 the choice changed exactly
// one thing: the sentence printed under the title block. Every factor and
// every limit the analyses used was a constant in the module that used it —
// `egress.js` knew 250ft, `occupancy.js` knew 20ft² a head, `daylight.js` knew
// 8% — and the edition was quoted beside numbers it had had no hand in. "The
// code edition is printed, not applied", the backlog said, and it was right.
//
// This file is the fix, and it is *data*: one table per offered edition,
// carrying the occupant load factors, the travel, dead-end and common-path
// limits, the width per occupant, the exit thresholds and the glazing rule,
// each with the section it is quoted from. The readers select a table by the
// edition the design stores and read their numbers off it, so the sentence on
// the sheet — "IBC 2021 applied" — is at last a true one, and an edition that
// differs (or a jurisdiction's amendment) is one row here rather than a hunt
// through five modules.
//
// **Checked against the tree, not against the file** — the convention Phase
// 32 wrote. The phase was scoped as "three editions and not one of them
// changes a number"; carrying the three tables in full is what showed that,
// for a Group E occupancy and the rules this tool applies, the numbers this
// codebase has used since Phase 7 are the same under every edition it
// offers, as far as these tables know them: 250ft sprinklered, 75ft of common
// path, 20ft² a classroom seat. So the rows below are identical, and each
// says in `changes` what it altered from the edition before it — nothing,
// here. A reviewer with the printed editions is the one to correct a row,
// and correcting it is the whole of the work: the value of the tables is not
// that they differ today; it is that the numbers now have a home, a
// provenance, and a place to differ.
//
// Every entry in `cites` is a table or section number stable across the three
// editions. Where an edition renumbers a section, the edition's own row is the
// place to say so — that is the whole point of citing per edition.
//
// Pure module: no three.js, no DOM. A leaf — it imports nothing, so
// occupancy.js, egress.js and daylight.js can all read it without a cycle.
// Exercised by test/codes.test.mjs.

// ---------- the settings a design stores ----------
//
// Two facts about the building, not about this editing session (see
// occupancy.js's header for how they came to live in the file): which edition
// the analysis is read against, and whether the building is sprinklered.

// The factors and limits one edition of the code gives a Group E occupancy.
// Written out in full per edition rather than as deltas so a reader holding
// one table has the whole answer, and so a row that *does* differ is a
// visible number rather than a patch to find.
const GROUP_E_2018 = {
  // IBC Table 1004.5 — occupant load factors, ft² per person, rounded to the
  // values a school actually uses. Keyed on occupancy.js's use keys; `basis`
  // (net or gross) stays on the use row because it is a fact about what is
  // measured rather than about the edition. Circulation and restrooms carry
  // other rooms' people and are not in the table at all.
  factors: {
    'assembly-seats': 7,
    library: 50,
    'assembly-tables': 15,
    gym: 50,
    stage: 15,
    lab: 50,
    kitchen: 200,
    locker: 50,
    office: 150,
    storage: 300,
    classroom: 20,
    // Not a code number: what a room nobody named is counted at, chosen to be
    // obviously provisional. Carried here so an edition's table is complete
    // and the guess is beside the rules it stands in for.
    unassigned: 100,
  },
  // IBC Table 1017.2 — exit access travel distance, Group E, ft.
  travel: { sprinklered: 250, plain: 200 },
  // IBC 1020 — dead-end corridors, ft. Fifty with sprinklers is the Group E
  // allowance; twenty is everybody's.
  deadEnd: { sprinklered: 50, plain: 20 },
  // IBC Table 1006.2.1 — common path of egress travel, Group E, ft. The same
  // number wet or dry, which is the table's own answer for E.
  commonPath: { sprinklered: 75, plain: 75 },
  // IBC 1005.3 — inches of clear width per occupant, on the level and on a
  // stair.
  widthPerOcc: { level: 0.2, stair: 0.3 },
  // IBC Table 1006.2.1 — one way out of a space is enough up to this many.
  singleExitOcc: 49,
  // IBC 1006.3 — how many ways out a storey's occupant load needs, read top
  // down: over the first threshold met.
  exits: [{ over: 1000, need: 4 }, { over: 500, need: 3 }, { over: 49, need: 2 }],
  // IBC 1010.1.1 / 1011.2 — the narrowest thing that counts as a way out, ft.
  minExitClear: 32 / 12,
  minEgressStairW: 44 / 12,
  // IBC 1205.2 — net glazed area over floor area, for a room people occupy.
  glazing: 0.08,
  cites: {
    factors: 'Table 1004.5',
    travel: 'Table 1017.2',
    deadEnd: '§1020 (dead ends)',
    commonPath: 'Table 1006.2.1',
    width: '§1005.3',
    exits: '§1006.3 (number of exits)',
    singleExit: 'Table 1006.2.1',
    exitWidth: '§1010.1.1',
    stairWidth: '§1011.2',
    glazing: '§1205.2',
    // IBC 1028 — exit discharge, which sets no number and is cited for the
    // note that says so.
    discharge: '§1028',
  },
};

export const EDITIONS = [
  {
    key: 'ibc2018', label: 'IBC 2018', year: 2018,
    ...GROUP_E_2018,
    changes: [],
  },
  {
    key: 'ibc2021', label: 'IBC 2021', year: 2021,
    ...GROUP_E_2018,
    // What the edition altered in the rules this tool applies to a Group E
    // occupancy, as a list of sentences a panel could print. Empty as far
    // as this table knows: the numbers above are the ones the codebase has
    // carried for a school under every edition it offers.
    changes: [],
  },
  {
    key: 'ibc2024', label: 'IBC 2024', year: 2024,
    ...GROUP_E_2018,
    changes: [],
  },
];

const BY_KEY = new Map(EDITIONS.map((e) => [e.key, e]));

// The menu: what a person picks from. Kept in the order the tool has offered
// them since Phase 7 — current edition first — so the select's default and
// the table's default are the same row for the same reason.
export const CODE_EDITIONS = [
  { key: 'ibc2021', label: 'IBC 2021' },
  { key: 'ibc2018', label: 'IBC 2018' },
  { key: 'ibc2024', label: 'IBC 2024' },
];
export const DEFAULT_EDITION = 'ibc2021';

// The full table for an edition key, defaulting rather than throwing: a file
// naming an edition this build has never heard of is read against the
// default, and `normalizeCode` below is where that gets written back.
export const editionEntry = (k) => BY_KEY.get(k) || BY_KEY.get(DEFAULT_EDITION);

// A school is a sprinklered building unless somebody says otherwise, which is
// the assumption every reader made before there was anywhere to record it.
export const defaultCode = () => ({ edition: DEFAULT_EDITION, sprinklered: true });

export function normalizeCode(raw) {
  const d = defaultCode();
  if (!raw || typeof raw !== 'object') return d;
  return {
    edition: BY_KEY.has(raw.edition) ? raw.edition : d.edition,
    sprinklered: raw.sprinklered === false ? false : true,
  };
}

export const isDefaultCode = (c) => {
  const n = normalizeCode(c);
  const d = defaultCode();
  return n.edition === d.edition && n.sprinklered === d.sprinklered;
};

// What a reader should use, whether or not the design has ever said.
export const codeOf = (state) => normalizeCode(state && state.code);

// The edition a reader applies, from whatever it was handed: an edition
// table, an edition key, a `{ edition }` code record, or a design. Every
// analysis module takes `opts.edition` in any of those forms and falls back
// to the design's own — so a reader called on its own still applies the
// file's edition, and a caller asking a hypothetical can hand it another.
export function editionOf(what, state = null) {
  if (what && typeof what === 'object') {
    if (what.factors && what.key) return what;             // a table
    if (typeof what.edition === 'string') return editionEntry(what.edition);
  }
  if (typeof what === 'string') return editionEntry(what);
  return editionEntry(codeOf(state).edition);
}

// ---------- reading a table ----------

// ft² per person for a use, under an edition. A use the table does not price
// (circulation, a restroom) is zero: it carries other rooms' people.
export const factorOf = (edition, useKey) => {
  const f = edition && edition.factors ? edition.factors[useKey] : undefined;
  return Number.isFinite(f) ? f : 0;
};

// The widest and narrowest factor a room could be counted at, which is the
// spread of an unnamed room's occupant load: it is *some* kind of space, and
// nothing said which. Circulation and the placeholder itself are left out —
// the first carries nobody, the second is the guess being bounded.
export function factorSpan(edition) {
  let lo = Infinity, hi = 0;
  for (const [k, f] of Object.entries(edition.factors)) {
    if (k === 'unassigned' || !(f > 0)) continue;
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  return { min: lo === Infinity ? 0 : lo, max: hi };
}

// The limits a building is held to, wet or dry, in feet.
export const limitsOf = (edition, sprinklered) => ({
  travel: sprinklered ? edition.travel.sprinklered : edition.travel.plain,
  deadEnd: sprinklered ? edition.deadEnd.sprinklered : edition.deadEnd.plain,
  commonPath: sprinklered ? edition.commonPath.sprinklered : edition.commonPath.plain,
});

// How many ways out a given occupant load needs.
export function exitsRequired(edition, occ) {
  for (const row of edition.exits) if (occ > row.over) return row.need;
  return 1;
}

// The clear width that many people need, in feet.
export function widthRequired(edition, occ, opts = {}) {
  const per = opts.stair ? edition.widthPerOcc.stair : edition.widthPerOcc.level;
  return (occ * per) / 12;
}

// A finding's provenance: "IBC 2021 · Table 1017.2". Every number a reader
// prints against a limit carries one of these beside it, the way a cost has
// carried its rate table's name since Phase 16 — never a number without its
// source. `rule` is a key of `cites`; an unknown rule cites the edition alone
// rather than inventing a section.
export function citeFor(edition, rule) {
  const e = edition && edition.label ? edition : editionEntry(edition);
  const ref = rule && e.cites ? e.cites[rule] : null;
  return ref ? `${e.label} · ${ref}` : e.label;
}
