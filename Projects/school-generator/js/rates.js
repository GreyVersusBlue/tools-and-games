// rates.js — the price list, and the vocabulary it prices.
//
// Phase 7 refused to put dollars in this tool and gave a good reason: unit
// costs are local, dated and trade-by-trade, and a tool that guessed at them
// would be wrong in a way that *looks authoritative*. That reasoning has not
// changed. What it argues for is a specific design rather than for never doing
// it at all:
//
//   **The tool should not know what a square foot of VCT costs. It should
//   know how to be told.**
//
// So this file contains no prices. It contains two things:
//
//   1. **The assembly vocabulary** — the fixed list of things the takeoff can
//      measure, each with a system, a unit and a label. This is the join
//      between "what is drawn" and "what it costs", and it has to be a closed
//      set, because a rate table keyed on free text is a rate table nobody can
//      fill in twice the same way.
//   2. **The rate table record** — a dated, sourced, editable list of
//      `{ key, rate }` rows that lives *in the design file*, because the rates
//      that priced this building are part of what the price means. A number
//      without the date and the source beside it is a rumour.
//
// It ships empty. `exampleRates()` is a worked example somebody is meant to
// overwrite, and it says so in its own `source` field rather than in a comment
// nobody will read — every reader that prints a cost prints that string.
//
// **On unknown keys.** A row whose assembly this build doesn't recognise is
// *kept*, not dropped. finish.js drops an unknown finish because the fallback
// is a floor that still exists; here the fallback is somebody's typed-in
// number, gone. `costing` ignores what it can't use and the panel says how
// many rows those are.
//
// Pure module: no three.js, no DOM. Exercised by test/rates.test.mjs.

import { FLOOR_FINISHES, FACADE_MATERIALS, facadeEntry, finishEntry } from './finish.js';
import { SITE_SURFACES, SITE_MARKINGS, surfaceEntry, markingEntry } from './site.js';
import { CATEGORIES } from './catalog.js';
import { parseCSV } from './timetable.js';

// ---------- systems ----------
//
// The five buckets a cost gets decomposed into. Deliberately shallow — this is
// a Uniformat elevator pitch, not Uniformat — because the useful question is
// "is the money in the shell or in the fit-out", and three levels of
// classification answer that no better than one.
export const SYSTEMS = [
  { key: 'substructure', label: 'Substructure' },
  { key: 'shell', label: 'Shell' },
  { key: 'interiors', label: 'Interiors' },
  { key: 'vertical', label: 'Vertical circulation' },
  { key: 'furnishings', label: 'Furnishings' },
  { key: 'site', label: 'Sitework' },
];

const SYSTEM_BY_KEY = new Map(SYSTEMS.map((s) => [s.key, s]));
export const SYSTEM_KEYS = SYSTEMS.map((s) => s.key);
export const systemEntry = (key) => SYSTEM_BY_KEY.get(key) || { key: 'other', label: 'Other' };

// ---------- the assembly vocabulary ----------
//
// A *family* is a kind of thing the takeoff measures. Most families have one
// assembly; some have one per material, because "which VCT" is exactly the
// question the spec sheet exists to answer and "carpet at the price of VCT" is
// exactly the answer a single `finish` row would give.
//
// A family with `variants` gets a key per variant: `finish:vct`, `door:double`,
// `paving:asphalt`. A family without gets its own name: `slab`, `paint`.
//
// `unit` is what the takeoff counts it in, and it is not negotiable per row: a
// person who wants to price partitions by the linear foot is a person whose
// numbers will silently disagree with the drawing. The rate table stores the
// unit it was typed against anyway, so a table written under one build and
// read under another can say "this row was priced per lf and this build
// measures ft²" rather than quietly multiplying the wrong two numbers.
const FAMILIES = [
  { key: 'slab', system: 'substructure', unit: 'ft²', label: 'Floor slab' },
  // The exterior wall *and* its cladding as one assembly, priced per square
  // foot of face. Splitting backup from veneer is what an estimator does and
  // it would double the area on every reader that doesn't know the trick.
  {
    key: 'facade', system: 'shell', unit: 'ft²', label: 'Exterior wall',
    variants: () => FACADE_MATERIALS.map((m) => ({ key: m.key, label: m.label })),
  },
  { key: 'glazing', system: 'shell', unit: 'ft²', label: 'Exterior glazing' },
  { key: 'window', system: 'shell', unit: 'ea', label: 'Window' },
  {
    key: 'roof', system: 'shell', unit: 'ft²', label: 'Roof',
    variants: () => [
      { key: 'membrane', label: 'Membrane, flat' },
      { key: 'shingle', label: 'Shingles, pitched' },
    ],
  },
  { key: 'wall-int', system: 'interiors', unit: 'ft²', label: 'Interior partition' },
  { key: 'wall-glass', system: 'interiors', unit: 'ft²', label: 'Interior glazed partition' },
  { key: 'wall-rail', system: 'interiors', unit: 'lf', label: 'Guardrail' },
  { key: 'paint', system: 'interiors', unit: 'ft²', label: 'Wall paint' },
  {
    key: 'finish', system: 'interiors', unit: 'ft²', label: 'Floor finish',
    variants: () => FLOOR_FINISHES.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    key: 'door', system: 'interiors', unit: 'ea', label: 'Door',
    variants: () => [
      { key: 'single', label: 'Single leaf' },
      { key: 'double', label: 'Pair' },
      { key: 'cased', label: 'Cased opening' },
    ],
  },
  { key: 'stair', system: 'vertical', unit: 'ea', label: 'Stair' },
  { key: 'ramp', system: 'vertical', unit: 'ft²', label: 'Ramp' },
  { key: 'elevator', system: 'vertical', unit: 'ea', label: 'Elevator' },
  // Furniture is priced by catalog *category* rather than by type. Four
  // hundred rows of "one stacking chair" is not a rate table anybody fills in,
  // and the categories are already the shape of a purchasing schedule.
  //
  // `open` as well as `variants`: the shipped categories get a row each, and a
  // row imported under a category this build has never heard of still resolves
  // to an assembly rather than to nothing.
  {
    key: 'furniture', system: 'furnishings', unit: 'ea', label: 'Furniture', open: true,
    variants: () => CATEGORIES.map((c) => ({ key: c, label: c })),
  },
  {
    key: 'paving', system: 'site', unit: 'ft²', label: 'Site surface',
    variants: () => SITE_SURFACES.map((s) => ({ key: s.key, label: s.label })),
  },
  {
    key: 'marking', system: 'site', unit: 'ea', label: 'Site marking',
    variants: () => SITE_MARKINGS.map((m) => ({ key: m.key, label: m.label })),
  },
];

const FAMILY_BY_KEY = new Map(FAMILIES.map((f) => [f.key, f]));

export const FAMILY_KEYS = FAMILIES.map((f) => f.key);

// The full assembly key: `family` or `family:variant`.
export const assemblyKey = (family, variant) => (variant ? `${family}:${variant}` : family);

// ...and back apart again. A key with more than one colon in it is somebody
// else's, and splitting on the first one keeps a category called "A/V, fixed"
// working as a variant name.
export function splitKey(key) {
  const s = String(key ?? '');
  const i = s.indexOf(':');
  return i < 0 ? { family: s, variant: null } : { family: s.slice(0, i), variant: s.slice(i + 1) };
}

// Every assembly this build knows how to measure, flattened — the rows a rate
// table can be filled in against, and the order a panel prints them in.
export function assemblies() {
  const out = [];
  for (const fam of FAMILIES) {
    if (!fam.variants) {
      out.push({
        key: fam.key, family: fam.key, variant: null,
        label: fam.label, system: fam.system, unit: fam.unit,
      });
      continue;
    }
    for (const v of fam.variants()) {
      out.push({
        key: assemblyKey(fam.key, v.key), family: fam.key, variant: v.key,
        label: `${fam.label} — ${v.label}`, system: fam.system, unit: fam.unit,
      });
    }
  }
  return out;
}

const ASSEMBLY_BY_KEY = new Map(assemblies().map((a) => [a.key, a]));

// One assembly, by key — including the open families, whose variant labels are
// whatever the catalog called the category. Returns null for a key from a
// build this one has never met, which is the signal every reader downstream
// uses to say "kept, not used".
export function assemblyEntry(key) {
  const known = ASSEMBLY_BY_KEY.get(key);
  if (known) return known;
  const { family, variant } = splitKey(key);
  const fam = FAMILY_BY_KEY.get(family);
  if (!fam || !fam.open || !variant) return null;
  return {
    key, family, variant,
    label: `${fam.label} — ${variant}`, system: fam.system, unit: fam.unit,
  };
}

// A label for a key nobody recognises, so a panel can still print the row it
// is refusing to use.
export const assemblyLabel = (key) => {
  const a = assemblyEntry(key);
  return a ? a.label : String(key ?? '');
};

export const assemblyUnit = (key) => {
  const a = assemblyEntry(key);
  return a ? a.unit : '';
};

// ---------- the rate table ----------

export const MAX_RATE_ROWS = 400;
export const MAX_RATE = 1e7;         // $ per unit — a number past this is a typo
const MAX_TEXT = 120;

export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'];
export const DEFAULT_CURRENCY = 'USD';
// What a currency prints as. Not a formatting library: three symbols and a
// fallback to the code itself, which is what a spreadsheet header wants.
const SYMBOLS = { USD: '$', CAD: '$', AUD: '$', NZD: '$', GBP: '£', EUR: '€' };
export const currencySymbol = (c) => SYMBOLS[c] || '';

const text = (v, max = MAX_TEXT) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};

// A date, as the ISO day it was written. Anything that isn't `YYYY-MM-DD` is
// no date at all — a rate dated "last spring" is a rate with no date, and
// saying so is the whole point of the column.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const readDay = (v) => (typeof v === 'string' && ISO_DAY.test(v.trim()) ? v.trim() : null);

const money = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  // Two places, because that is what a unit price is, and because a rate
  // stored at fifteen significant figures makes every total below it look
  // like it was measured rather than typed.
  return Math.min(MAX_RATE, Math.round(v * 100) / 100);
};

export const emptyRates = () => ({
  currency: DEFAULT_CURRENCY, date: null, source: null, note: null, rows: [],
});

// True when a design has never been told a price. Written as "nothing anybody
// typed" rather than "no rows", so a table somebody dated and sourced and then
// emptied still travels with the file — they meant to keep it.
export const isEmptyRates = (r) => !r || (
  (!Array.isArray(r.rows) || r.rows.length === 0) &&
  !r.date && !r.source && !r.note &&
  (!r.currency || r.currency === DEFAULT_CURRENCY)
);

export function normalizeRates(raw) {
  if (!raw || typeof raw !== 'object') return emptyRates();
  const currency = typeof raw.currency === 'string' && CURRENCIES.includes(raw.currency)
    ? raw.currency : DEFAULT_CURRENCY;
  const rows = [];
  const seen = new Set();
  for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
    if (rows.length >= MAX_RATE_ROWS) break;
    if (!r || typeof r !== 'object') continue;
    const key = typeof r.key === 'string' ? r.key.trim().slice(0, 80) : '';
    if (!key || seen.has(key)) continue;
    const rate = money(r.rate);
    if (rate === null) continue;
    seen.add(key);
    const a = assemblyEntry(key);
    rows.push({
      key,
      rate,
      // The unit the number was typed against, remembered rather than
      // re-derived: see the note on `unit` in the family table above.
      unit: text(r.unit, 12) || (a ? a.unit : null),
      date: readDay(r.date),
      source: text(r.source),
      note: text(r.note),
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return {
    currency,
    date: readDay(raw.date),
    source: text(raw.source),
    note: text(raw.note, 400),
    rows,
  };
}

export const ratesOf = (state) => normalizeRates(state && state.rates);

export const rateIndex = (rates) => new Map((rates.rows || []).map((r) => [r.key, r]));

// ---------- editing ----------

// Set (or clear) one rate. `rate` of null removes the row — which is different
// from a rate of zero, and the difference matters: zero is "this costs
// nothing", null is "nobody has said". Every reader treats them differently.
export function setRate(rates, key, rate, meta = {}) {
  const out = normalizeRates(rates);
  const k = String(key ?? '').trim().slice(0, 80);
  if (!k) return out;
  const i = out.rows.findIndex((r) => r.key === k);
  if (rate === null || rate === undefined) {
    if (i >= 0) out.rows.splice(i, 1);
    return out;
  }
  const v = money(rate);
  if (v === null) return out;
  const a = assemblyEntry(k);
  const row = {
    key: k,
    rate: v,
    unit: text(meta.unit, 12) || (i >= 0 ? out.rows[i].unit : null) || (a ? a.unit : null),
    date: meta.date === undefined ? (i >= 0 ? out.rows[i].date : null) : readDay(meta.date),
    source: meta.source === undefined ? (i >= 0 ? out.rows[i].source : null) : text(meta.source),
    note: meta.note === undefined ? (i >= 0 ? out.rows[i].note : null) : text(meta.note),
  };
  if (i >= 0) out.rows[i] = row;
  else if (out.rows.length < MAX_RATE_ROWS) {
    out.rows.push(row);
    out.rows.sort((a2, b2) => a2.key.localeCompare(b2.key));
  }
  return out;
}

// ---------- the worked example ----------

// Order-of-magnitude US school construction rates, and that is *all* they are.
// They exist so somebody opening the panel for the first time sees a filled-in
// table rather than a blank one and understands what a row is for — and every
// one of them is meant to be typed over. The `source` string below is printed
// by the panel, by the CSV and by the spec sheet, which is the only reason it
// is safe to ship numbers at all.
export const EXAMPLE_SOURCE = 'WORKED EXAMPLE — not a quote. Replace with your own numbers.';
export const EXAMPLE_DATE = '2026-01-01';

const EXAMPLE = [
  ['slab', 14],
  ['facade:brick', 42], ['facade:brick-buff', 42], ['facade:block', 31],
  ['facade:panel', 38], ['facade:stucco', 27], ['facade:precast', 46],
  ['facade:wood', 34],
  ['glazing', 88], ['window', 1150],
  ['roof:membrane', 17], ['roof:shingle', 12],
  ['wall-int', 16], ['wall-glass', 62], ['wall-rail', 95], ['paint', 2.2],
  ['finish:vct', 5.5], ['finish:carpet', 7.25], ['finish:tile', 16],
  ['finish:wood', 19], ['finish:rubber', 11], ['finish:concrete', 3.4],
  ['finish:terrazzo', 34],
  ['door:single', 1650], ['door:double', 3100], ['door:cased', 420],
  ['stair', 34000], ['ramp', 78], ['elevator', 145000],
  ['paving:asphalt', 6.5], ['paving:concrete', 9.5], ['paving:court', 8],
  ['paving:track', 14], ['paving:turf', 1.4], ['paving:field', 2.2],
  ['paving:mulch', 2.6], ['paving:gravel', 3.1], ['paving:sand', 3.4],
  ['paving:garden', 4.8],
  ['marking:stalls', 24], ['marking:lane', 190], ['marking:crosswalk', 340],
  ['marking:basketball', 1400], ['marking:foursquare', 180],
  ['marking:hopscotch', 160], ['marking:soccer', 2600],
  ['marking:baseball', 3100], ['marking:track', 9800],
  ['furniture:Tables & Desks', 340], ['furniture:Seating', 95],
  ['furniture:Storage', 480], ['furniture:Fixtures', 620],
  ['furniture:Lighting', 210], ['furniture:Subject Rooms', 1400],
  ['furniture:Cafeteria', 1900], ['furniture:Gym & Stage', 2600],
  ['furniture:Library & Office', 540], ['furniture:Restroom', 780],
  ['furniture:Decor', 150], ['furniture:Outdoor', 900],
  ['furniture:Landscape', 260], ['furniture:Imported', 0],
];

export function exampleRates() {
  return normalizeRates({
    currency: DEFAULT_CURRENCY,
    date: EXAMPLE_DATE,
    source: EXAMPLE_SOURCE,
    note: 'Order-of-magnitude US figures for a mid-size school, entered so the ' +
      'table has a shape. They are not a bid, they are not local to you, and ' +
      'they are not current. Overwrite every row you care about.',
    rows: EXAMPLE.map(([key, rate]) => ({
      key, rate, unit: assemblyUnit(key), date: EXAMPLE_DATE, source: EXAMPLE_SOURCE,
    })),
  });
}

// True when the table is still the shipped example, row for row. The panel and
// every printed sheet lead with a warning while this is true, and stop the
// moment somebody has changed one number — which is the honest test of
// "has a person looked at this".
export function isExampleRates(rates) {
  const r = normalizeRates(rates);
  if (r.source !== EXAMPLE_SOURCE) return false;
  const ex = exampleRates();
  if (r.rows.length !== ex.rows.length) return false;
  return r.rows.every((row, i) => row.key === ex.rows[i].key && row.rate === ex.rows[i].rate);
}

// ---------- what the table has to say about itself ----------

// The one-line health check every printed cost carries: how much of what is
// drawn has a price on it, how old the oldest quoted rate is, and whether
// anybody has touched the example. Not findings — `cost.js` raises those,
// because it is the module that knows what was left unpriced.
export function ratesSummary(rates) {
  const r = normalizeRates(rates);
  const dated = r.rows.map((row) => row.date || r.date).filter(Boolean).sort();
  const sourced = r.rows.filter((row) => row.source || r.source).length;
  return {
    currency: r.currency,
    symbol: currencySymbol(r.currency),
    rows: r.rows.length,
    // A row this build can't measure. Kept in the file, ignored by every
    // number, counted here so nobody wonders where it went.
    unknown: r.rows.filter((row) => !assemblyEntry(row.key)).length,
    dated: dated.length,
    sourced,
    oldest: dated[0] || null,
    newest: dated[dated.length - 1] || null,
    example: isExampleRates(r),
    empty: isEmptyRates(r),
    source: r.source,
    note: r.note,
  };
}

// ---------- describing an assembly ----------

// What a material *is*, for the spec sheet: the catalog row behind the variant,
// if there is one. Kept here rather than in spec.js because this file already
// owns the mapping from a variant key to the table it came out of.
export function assemblyMaterial(key) {
  const a = assemblyEntry(key);
  if (!a || !a.variant) return null;
  if (a.family === 'finish') return finishEntry(a.variant);
  if (a.family === 'facade') return facadeEntry(a.variant);
  if (a.family === 'paving') return surfaceEntry(a.variant);
  if (a.family === 'marking') return markingEntry(a.variant);
  return null;
}

// ---------- the interchange format ----------
//
// A rate table is the one thing in this design somebody already keeps in a
// spreadsheet, so it goes out as one and comes back as one. The key column is
// what the round trip is keyed on; the label beside it is for the human, and
// the importer ignores it — a person who renames "Floor finish — Carpet tile"
// to "Carpet, broadloom" should not lose their number for it.

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export const RATE_HEADERS = ['Key', 'Assembly', 'Unit', 'Rate', 'Dated', 'Source', 'Note'];

// Every assembly this build knows, priced or not — because a table that only
// lists the rows somebody has already filled in is a table nobody can finish
// filling in. `opts.quantities` adds a column saying how much of each is in
// this design, which is the column that tells you which rows matter.
export function ratesCSV(rates, opts = {}) {
  const r = normalizeRates(rates);
  const idx = rateIndex(r);
  const qty = opts.quantities || null;
  const head = [...RATE_HEADERS];
  if (qty) head.push('In this design', 'Unit');
  const rows = [['Rate table', r.currency, r.date || '', r.source || '', '', '', '']];
  if (r.note) rows.push(['Note', r.note, '', '', '', '', '']);
  rows.push([]);
  rows.push(head);
  const keys = assemblies().map((a) => a.key);
  for (const key of r.rows.map((row) => row.key)) if (!keys.includes(key)) keys.push(key);
  for (const key of keys) {
    const row = idx.get(key) || null;
    const line = [key, assemblyLabel(key), assemblyUnit(key),
      row ? row.rate : '', row ? row.date || '' : '', row ? row.source || '' : '',
      row ? row.note || '' : ''];
    if (qty) line.push(qty.get(key) ? Math.round(qty.get(key) * 10) / 10 : 0, assemblyUnit(key));
    rows.push(line);
  }
  return csvRows(rows);
}

const headerIndex = (row) => {
  const map = new Map();
  row.forEach((cell, i) => map.set(String(cell || '').trim().toLowerCase(), i));
  return map;
};

// Rates back out of a spreadsheet. Finds its own header row rather than
// demanding one on line 1, because the file this reads is the file `ratesCSV`
// wrote and that one leads with three lines about the table itself.
//
// What it could not read comes back beside the table rather than being
// dropped, which is the same promise `importTimetableCSV` makes: an import
// that silently loses eleven rates is an import that answers a question about
// a building priced differently from the one you meant.
export function importRatesCSV(csv, opts = {}) {
  const rows = parseCSV(csv);
  const base = opts.merge ? normalizeRates(opts.merge) : emptyRates();
  let head = -1;
  for (let i = 0; i < rows.length && head < 0; i++) {
    const idx = headerIndex(rows[i]);
    if (idx.has('key') && idx.has('rate')) head = i;
  }
  if (head < 0) return { rates: base, read: 0, skipped: 0, unknown: 0, found: false };
  const idx = headerIndex(rows[head]);
  const col = (name) => (idx.has(name) ? idx.get(name) : -1);
  const cKey = col('key'), cRate = col('rate');
  const cUnit = col('unit'), cDate = col('dated'), cSrc = col('source'), cNote = col('note');
  let out = base;
  let read = 0, skipped = 0, unknown = 0;
  for (let i = head + 1; i < rows.length; i++) {
    const row = rows[i];
    const key = String(row[cKey] ?? '').trim();
    if (!key) continue;
    const raw = String(row[cRate] ?? '').trim().replace(/[$£€,\s]/g, '');
    if (!raw) { skipped++; continue; }
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0) { skipped++; continue; }
    if (!assemblyEntry(key)) unknown++;
    out = setRate(out, key, rate, {
      unit: cUnit >= 0 ? row[cUnit] : undefined,
      date: cDate >= 0 ? row[cDate] : undefined,
      source: cSrc >= 0 ? row[cSrc] : undefined,
      note: cNote >= 0 ? row[cNote] : undefined,
    });
    read++;
  }
  // The table's own metadata, if the sheet still carries the header
  // `ratesCSV` writes.
  for (const row of rows.slice(0, head)) {
    const first = String(row[0] || '').trim().toLowerCase();
    if (first === 'note') {
      const note = typeof row[1] === 'string' && row[1].trim() ? row[1].trim().slice(0, 400) : null;
      if (note) out = { ...out, note };
      continue;
    }
    if (first !== 'rate table') continue;
    out = { ...out, currency: CURRENCIES.includes(String(row[1] || '').trim()) ? String(row[1]).trim() : out.currency };
    const day = readDay(String(row[2] || '').trim());
    if (day) out = { ...out, date: day };
    const src = typeof row[3] === 'string' && row[3].trim() ? row[3].trim().slice(0, MAX_TEXT) : null;
    if (src) out = { ...out, source: src };
  }
  return { rates: normalizeRates(out), read, skipped, unknown, found: true };
}
