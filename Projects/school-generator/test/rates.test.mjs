// The rate table: the vocabulary it prices, what survives a normalize, and
// the spreadsheet it goes out and comes back as.
//
// The thing worth testing hardest here is what a *loader* does with a row it
// doesn't understand, because that row is somebody's typed-in number and
// dropping it is the one unrecoverable move.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYSTEMS, SYSTEM_KEYS, assemblies, assemblyKey, assemblyEntry, assemblyLabel,
  assemblyUnit, assemblyMaterial, splitKey, systemEntry,
  emptyRates, isEmptyRates, normalizeRates, setRate, rateIndex, ratesSummary,
  exampleRates, isExampleRates, EXAMPLE_SOURCE, MAX_RATE_ROWS, MAX_RATE,
  ratesCSV, importRatesCSV, currencySymbol, readDay, DEFAULT_CURRENCY,
} from '../js/rates.js';
import { FLOOR_FINISHES } from '../js/finish.js';
import { CATEGORIES } from '../js/catalog.js';

// ---------- the vocabulary ----------

test('every assembly names a system the table declares', () => {
  for (const a of assemblies()) {
    assert.ok(SYSTEM_KEYS.includes(a.system), `${a.key} → ${a.system}`);
    assert.ok(a.unit, `${a.key} has no unit`);
    assert.ok(a.label.length > 0);
  }
});

test('every floor finish gets its own assembly — "which VCT" is the question', () => {
  const keys = assemblies().map((a) => a.key);
  for (const f of FLOOR_FINISHES) assert.ok(keys.includes(`finish:${f.key}`), f.key);
  // ...and no bare `finish` row, which would be the answer that prices carpet
  // like vinyl.
  assert.ok(!keys.includes('finish'));
});

test('furniture is priced by catalog category, one row each', () => {
  const keys = assemblies().map((a) => a.key);
  for (const c of CATEGORIES) assert.ok(keys.includes(`furniture:${c}`), c);
});

test('assembly keys split on the first colon only', () => {
  assert.deepEqual(splitKey('slab'), { family: 'slab', variant: null });
  assert.deepEqual(splitKey('finish:vct'), { family: 'finish', variant: 'vct' });
  assert.deepEqual(splitKey('furniture:A/V: fixed'),
    { family: 'furniture', variant: 'A/V: fixed' });
});

test('an open family resolves a variant this build has never seen', () => {
  const a = assemblyEntry('furniture:Robotics');
  assert.ok(a);
  assert.equal(a.system, 'furnishings');
  assert.equal(a.unit, 'ea');
  // ...but a closed one does not: a finish key nothing recognises is a row
  // that prices nothing.
  assert.equal(assemblyEntry('finish:linoleum'), null);
  assert.equal(assemblyEntry('nonsense'), null);
});

test('a material row comes back for the variants that have one', () => {
  assert.equal(assemblyMaterial('finish:carpet').label, 'Carpet tile');
  assert.equal(assemblyMaterial('facade:brick').label, 'Face brick');
  assert.equal(assemblyMaterial('paving:asphalt').label, 'Asphalt paving');
  assert.equal(assemblyMaterial('slab'), null);
});

test('an unknown key still prints as something', () => {
  assert.equal(assemblyLabel('utterly:unknown'), 'utterly:unknown');
  assert.equal(assemblyUnit('utterly:unknown'), '');
  assert.equal(systemEntry('nope').label, 'Other');
  assert.equal(assemblyKey('finish', 'vct'), 'finish:vct');
  assert.equal(assemblyKey('slab', null), 'slab');
});

// ---------- the record ----------

test('a design ships with no rates at all', () => {
  const r = emptyRates();
  assert.ok(isEmptyRates(r));
  assert.equal(r.rows.length, 0);
  assert.equal(r.currency, DEFAULT_CURRENCY);
});

test('a dated, sourced, emptied table is still worth keeping', () => {
  const r = normalizeRates({ date: '2026-03-01', source: 'A bid', rows: [] });
  assert.ok(!isEmptyRates(r), 'somebody typed that — it travels');
});

test('normalize drops rows with no usable number and keeps the rest', () => {
  const r = normalizeRates({
    rows: [
      { key: 'slab', rate: 12.345 },
      { key: 'paint', rate: -1 },
      { key: 'glazing', rate: 'lots' },
      { key: '', rate: 4 },
      { key: 'slab', rate: 99 },          // a duplicate key, second one loses
    ],
  });
  assert.deepEqual(r.rows.map((x) => x.key), ['slab']);
  assert.equal(r.rows[0].rate, 12.35, 'a unit price is two places');
});

test('a rate row for an assembly this build cannot measure is kept, not dropped', () => {
  const r = normalizeRates({ rows: [{ key: 'antigravity:field', rate: 400 }] });
  assert.equal(r.rows.length, 1);
  assert.equal(ratesSummary(r).unknown, 1, 'counted, so a panel can say so');
});

test('the row cap and the rate ceiling both hold', () => {
  const rows = [];
  for (let i = 0; i < MAX_RATE_ROWS + 50; i++) rows.push({ key: `k${i}`, rate: 1 });
  assert.equal(normalizeRates({ rows }).rows.length, MAX_RATE_ROWS);
  assert.equal(normalizeRates({ rows: [{ key: 'slab', rate: 1e12 }] }).rows[0].rate, MAX_RATE);
});

test('only a real ISO day counts as a date', () => {
  assert.equal(readDay('2026-08-26'), '2026-08-26');
  assert.equal(readDay('last spring'), null);
  assert.equal(readDay('26/08/2026'), null);
  assert.equal(normalizeRates({ date: 'soon' }).date, null);
});

test('zero is a price and null is a silence', () => {
  let r = setRate(emptyRates(), 'paint', 0);
  assert.equal(rateIndex(r).get('paint').rate, 0);
  r = setRate(r, 'paint', null);
  assert.equal(rateIndex(r).get('paint'), undefined);
});

test('setting a rate twice keeps the metadata unless it is replaced', () => {
  let r = setRate(emptyRates(), 'slab', 14, { date: '2026-01-02', source: 'A bid' });
  r = setRate(r, 'slab', 15);
  const row = rateIndex(r).get('slab');
  assert.equal(row.rate, 15);
  assert.equal(row.source, 'A bid');
  r = setRate(r, 'slab', 15, { source: 'A different bid' });
  assert.equal(rateIndex(r).get('slab').source, 'A different bid');
});

test('a row remembers the unit it was typed against', () => {
  const r = setRate(emptyRates(), 'wall-int', 9);
  assert.equal(rateIndex(r).get('wall-int').unit, 'ft²');
});

// ---------- the worked example ----------

test('the worked example says in its own source that it is not a quote', () => {
  const ex = exampleRates();
  assert.equal(ex.source, EXAMPLE_SOURCE);
  assert.ok(/not a quote/i.test(ex.source));
  for (const row of ex.rows) assert.equal(row.source, EXAMPLE_SOURCE);
});

test('the example knows when somebody has finally touched it', () => {
  const ex = exampleRates();
  assert.ok(isExampleRates(ex));
  assert.ok(!isExampleRates(setRate(ex, 'slab', 21)));
  assert.ok(!isExampleRates(setRate(ex, 'slab', null)));
  assert.ok(!isExampleRates({ ...ex, source: 'Our own tender returns' }));
  assert.ok(!isExampleRates(emptyRates()));
});

test('every example rate is for an assembly this build measures', () => {
  for (const row of exampleRates().rows) {
    assert.ok(assemblyEntry(row.key), `${row.key} is not an assembly`);
  }
});

test('the summary is the health check a printed sheet leads with', () => {
  const s = ratesSummary(exampleRates());
  assert.ok(s.example);
  assert.equal(s.unknown, 0);
  assert.equal(s.dated, s.rows, 'every example row carries the example date');
  assert.equal(s.symbol, currencySymbol('USD'));
  assert.ok(!ratesSummary(emptyRates()).example);
  assert.ok(ratesSummary(emptyRates()).empty);
});

// ---------- the spreadsheet ----------

test('the rate table round-trips through its own CSV, byte for byte', () => {
  const ex = exampleRates();
  const back = importRatesCSV(ratesCSV(ex));
  assert.ok(back.found);
  assert.equal(back.read, ex.rows.length);
  assert.equal(back.skipped, 0);
  assert.deepEqual(back.rates, ex);
});

test('the CSV lists every assembly, so a blank table is fillable', () => {
  const lines = ratesCSV(emptyRates()).split('\r\n');
  const head = lines.findIndex((l) => l.startsWith('Key,'));
  assert.ok(head > 0);
  assert.equal(lines.length - head - 1, assemblies().length);
});

test('the quantity column says which of sixty rows matter', () => {
  const csv = ratesCSV(emptyRates(), { quantities: new Map([['slab', 1234.5]]) });
  assert.ok(csv.includes('In this design'));
  assert.ok(csv.split('\r\n').some((l) => l.startsWith('slab,') && l.includes('1234.5')));
});

test('an import says what it could not read rather than swallowing it', () => {
  const csv = ['Key,Rate', 'slab,14', 'paint,', 'glazing,not a number',
    'antigravity:field,400'].join('\r\n');
  const res = importRatesCSV(csv);
  assert.equal(res.read, 2);
  assert.equal(res.skipped, 2);
  assert.equal(res.unknown, 1, 'kept, and counted');
  assert.equal(rateIndex(res.rates).get('antigravity:field').rate, 400);
});

test('an import reads a currency symbol off a pasted number', () => {
  const res = importRatesCSV('Key,Rate\r\nslab,"$1,250.50"');
  assert.equal(rateIndex(res.rates).get('slab').rate, 1250.5);
});

test('a file with no Key and Rate columns is refused rather than half-read', () => {
  const res = importRatesCSV('Room,Area\r\nRoom 101,600');
  assert.ok(!res.found);
  assert.ok(isEmptyRates(res.rates));
});

test('an import can merge into a table rather than replacing it', () => {
  const base = setRate(emptyRates(), 'paint', 3);
  const res = importRatesCSV('Key,Rate\r\nslab,14', { merge: base });
  assert.equal(rateIndex(res.rates).get('paint').rate, 3);
  assert.equal(rateIndex(res.rates).get('slab').rate, 14);
});

test('the systems table is the order a cost is decomposed in', () => {
  assert.deepEqual(SYSTEMS.map((s) => s.key), [
    'substructure', 'shell', 'interiors', 'vertical', 'furnishings', 'site',
  ]);
});

// ---------- the file ----------

test('a rate table is an append to v11: a design without one writes no key', async () => {
  const { serialize, deserialize, SAVE_VERSION } = await import('../js/save-load.js');
  const { buildSampleSchool } = await import('../js/sample.js');
  const state = buildSampleSchool();
  assert.doesNotMatch(serialize(state), /"rates"/,
    'the same bytes out as a build that predates this phase');

  state.rates = exampleRates();
  const text = serialize(state);
  assert.match(text, /"rates"/);
  assert.equal(JSON.parse(text).version, SAVE_VERSION, 'a rate table is not a version bump');
  assert.deepEqual(deserialize(text).rates, exampleRates());
});

test('a rate table full of nonsense is a design with no prices, not one that will not open', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const { buildSampleSchool } = await import('../js/sample.js');
  const state = buildSampleSchool();
  state.rates = exampleRates();
  const hostile = JSON.parse(serialize(state));
  hostile.rates = { rows: 'not a list', currency: 42 };
  assert.equal(deserialize(JSON.stringify(hostile)).rates, undefined);
});

test('a rate for an assembly a newer build measures survives the round trip', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const { buildSampleSchool } = await import('../js/sample.js');
  const state = buildSampleSchool();
  state.rates = setRate(emptyRates(), 'geothermal:loop', 88,
    { date: '2027-06-01', source: 'A build from the future' });
  const back = deserialize(serialize(state));
  const row = rateIndex(back.rates).get('geothermal:loop');
  assert.ok(row, 'somebody typed that number and it is not ours to throw away');
  assert.equal(row.rate, 88);
  assert.equal(row.source, 'A build from the future');
});

test('an emptied table with a date and a source on it still travels', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const { buildSampleSchool } = await import('../js/sample.js');
  const state = buildSampleSchool();
  state.rates = normalizeRates({ date: '2026-05-05', source: 'Tender returns', rows: [] });
  const back = deserialize(serialize(state));
  assert.equal(back.rates.source, 'Tender returns');
});
