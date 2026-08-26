// The spec sheet: which VCT, where it goes, and what this tool is willing to
// claim about it.
//
// The column worth testing is the last one. A rating this tool has not
// measured must not appear as a number, and the absence must be *said* rather
// than left blank — a blank cell on a specification is a cell somebody fills
// in from memory.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../js/grid.js';
import { sheet } from './build.mjs';
import { applyFinish } from '../js/finish.js';
import { shapesOf } from '../js/shapes.js';
import { addStair } from '../js/stairs.js';
import { buildSampleSchool } from '../js/sample.js';
import { specSheet, specCSV, SPEC_DISCLAIMER } from '../js/spec.js';
import { assemblyEntry } from '../js/rates.js';
import { FLOOR_FINISHES } from '../js/finish.js';

function shoebox(extra = null) {
  const s = createState(12, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 4, 4, { name: 'Room 101' });
  if (extra) extra(f);
  f.bake();
  return s;
}

const line = (spec, key) => spec.lines.find((l) => l.key === key) || null;

test('a spec sheet needs no rate table — it is about what a thing is', () => {
  const spec = specSheet(shoebox());
  assert.ok(spec.lines.length > 0);
  assert.ok(line(spec, 'finish:vct'));
  assert.ok(line(spec, 'slab'));
});

test('only assemblies actually in the building get a line', () => {
  const spec = specSheet(shoebox());
  assert.equal(line(spec, 'elevator'), null);
  assert.equal(line(spec, 'finish:terrazzo'), null);
  for (const l of spec.lines) assert.ok(l.qty > 0, `${l.key} has no quantity`);
});

test('every line names what it is and where it is', () => {
  const spec = specSheet(buildSampleSchool());
  for (const l of spec.lines) {
    assert.ok(l.what.length > 0, `${l.key} does not say what it is`);
    assert.ok(l.where.length > 0, `${l.key} does not say where it is`);
    assert.ok(assemblyEntry(l.key), `${l.key} is not an assembly`);
  }
});

test('which VCT: the finish line names the product and its module', () => {
  const s = shoebox();
  applyFinish(shapesOf(s.floors[0])[0], 'wood', null);
  const l = line(specSheet(s), 'finish:wood');
  assert.ok(/Wood \(maple\)/.test(l.what));
  assert.ok(/ft module/.test(l.what));
});

test('the rating column carries the one number this tool actually measures', () => {
  const spec = specSheet(buildSampleSchool());
  const vct = line(spec, 'finish:vct');
  const entry = FLOOR_FINISHES.find((f) => f.key === 'vct');
  assert.ok(vct.rated.includes(entry.absorb.toFixed(2)),
    'the absorption coefficient acoustics.js already sums');
  assert.ok(/500 Hz/.test(vct.rated));
});

test('what it does not know, it says, rather than leaving the cell empty', () => {
  const spec = specSheet(buildSampleSchool());
  for (const key of ['facade:brick', 'wall-int', 'slab', 'paint']) {
    const l = line(spec, key);
    assert.ok(l, key);
    assert.ok(/no .*known/.test(l.rated), `${key}: "${l.rated}"`);
  }
});

test('a ramp says its steepest slope against the accessible maximum', () => {
  const s = createState(14, 12);
  const f = sheet(s, 0);
  f.box(1, 1, 10, 8);
  f.bake();
  const s2 = { ...s, floors: [...s.floors] };
  s2.floors.push(s.floors[0]);
  const made = addStair(s2, 0, { type: 'ramp', x: 20, z: 20, slope: 8 });
  assert.ok(made.link);
  const l = line(specSheet(s2), 'ramp');
  assert.ok(l, 'a ramp in the building is a line on the sheet');
  assert.ok(/1:8/.test(l.rated), l.rated);
  assert.ok(/1:12 is the accessible maximum/.test(l.rated), l.rated);
});

test('the rooms column names the biggest users and counts the rest', () => {
  const spec = specSheet(buildSampleSchool());
  const l = line(spec, 'slab');
  assert.ok(l.rooms.length <= 4);
  assert.ok(l.moreRooms > 0, 'a sixteen-room school has more than four');
  assert.ok(l.roomsLabel.includes('more'));
});

test('what belongs to no room says so rather than naming one at random', () => {
  const spec = specSheet(buildSampleSchool());
  const roof = spec.lines.find((l) => l.key.startsWith('roof:'));
  assert.ok(roof.shared);
  assert.equal(roof.roomsLabel, 'not in a room');
  assert.equal(roof.where, 'Building-wide');
});

test('the sheet is grouped by system, substructure first and sitework last', () => {
  const spec = specSheet(buildSampleSchool());
  const order = ['substructure', 'shell', 'interiors', 'vertical', 'furnishings', 'site'];
  const seen = spec.lines.map((l) => order.indexOf(l.system));
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
});

test('the disclaimer is on the sheet, not in a comment nobody reads', () => {
  const spec = specSheet(shoebox());
  assert.deepEqual(spec.disclaimer, SPEC_DISCLAIMER);
  const csv = specCSV(spec);
  for (const note of SPEC_DISCLAIMER) assert.ok(csv.includes(note.slice(0, 40)));
  assert.ok(/fire-resistance/.test(csv));
});

test('the CSV has one row per line plus a header and the notes', () => {
  const spec = specSheet(buildSampleSchool());
  const rows = specCSV(spec).split('\r\n');
  const head = rows.findIndex((r) => r.startsWith('System,Assembly,'));
  assert.ok(head >= 0);
  const notes = rows.filter((r) => r.startsWith('Note,')).length;
  assert.equal(notes, SPEC_DISCLAIMER.length);
});

test('the summary counts how many lines carry a real measured rating', () => {
  const spec = specSheet(buildSampleSchool());
  assert.equal(spec.summary.assemblies, spec.lines.length);
  assert.ok(spec.summary.rated > 0);
  assert.ok(spec.summary.rated < spec.lines.length,
    'and it is honest that most of them do not');
});
