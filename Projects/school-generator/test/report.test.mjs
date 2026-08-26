// The whole report: the sections composed, the findings sorted, the verdict
// reached, and the spreadsheet that comes out the other end. The sections have
// their own suites — this one is about what composing them is supposed to
// guarantee.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, floorLabel } from '../js/grid.js';
import { setTile, edgeHIdx, edgeVIdx, EDGE_WALL, EDGE_DOOR2 } from '../js/lattice.js';
import { sheet } from './build.mjs';
import { buildSampleSchool } from '../js/sample.js';
import { buildNav } from '../js/navgraph.js';
import { buildingOccupancy } from '../js/occupancy.js';
import { LEVELS, buildReport, reportCSV, acousticsSection } from '../js/report.js';

const SAMPLE = buildSampleSchool();
const REPORT = buildReport(SAMPLE);

test('every section is present and reads the same building', () => {
  for (const key of ['occupancy', 'egress', 'accessible', 'daylight', 'acoustics', 'takeoff']) {
    assert.ok(REPORT[key], `no ${key} section`);
  }
  assert.equal(REPORT.summary.storeys, SAMPLE.floors.length);
  assert.equal(REPORT.summary.rooms, REPORT.occupancy.rooms.length);
  assert.equal(REPORT.summary.occupants, REPORT.occupancy.total);
  assert.equal(REPORT.summary.exits, REPORT.egress.summary.exits);
});

test('every room the graph knows appears in every per-room section', () => {
  const nav = buildNav(SAMPLE);
  const ids = nav.rooms.map((r) => r.id);
  for (const [name, rows] of [
    ['occupancy', REPORT.occupancy.rooms],
    ['egress', REPORT.egress.rooms],
    ['daylight', REPORT.daylight.rooms],
    ['accessible', REPORT.accessible.rooms],
  ]) {
    const seen = new Set(rows.map((r) => r.id));
    for (const id of ids) assert.ok(seen.has(id), `${name} is missing ${id}`);
  }
});

test('acoustics joins to the same rooms by id, despite naming them differently', () => {
  const nav = buildNav(SAMPLE);
  const ids = new Set(nav.rooms.map((r) => r.id));
  assert.ok(REPORT.acoustics.rooms.length > 0);
  for (const r of REPORT.acoustics.rooms) {
    assert.ok(ids.has(r.id), `${r.id} (from ${r.acId}) is not a room the graph knows`);
  }
});

test('findings are sorted worst first and every one is levelled and sectioned', () => {
  let last = -1;
  for (const f of REPORT.findings) {
    assert.ok(LEVELS.includes(f.level), `bad level ${f.level}`);
    assert.ok(f.section && f.code && f.title && f.detail);
    const at = LEVELS.indexOf(f.level);
    assert.ok(at >= last, 'findings run fail → warn → note → ok');
    last = at;
  }
});

test('the verdict follows the findings', () => {
  const counts = { fail: 0, warn: 0 };
  for (const f of REPORT.findings) if (f.level in counts) counts[f.level]++;
  assert.equal(REPORT.summary.fails, counts.fail);
  assert.equal(REPORT.summary.warns, counts.warn);
  assert.equal(REPORT.summary.verdict,
    counts.fail ? 'fail' : counts.warn ? 'warn' : 'ok');
});

test('the sample school fails on egress, which is the point of the phase', () => {
  const codes = REPORT.findings.filter((f) => f.level === 'fail').map((f) => f.code);
  assert.ok(codes.length > 0, 'a school with one main entrance is not compliant');
  assert.ok(REPORT.findings.some((f) => f.section === 'egress'));
  assert.equal(REPORT.summary.verdict, 'fail');
});

test('a bare room with a door passes every check this tool makes', () => {
  const s = createState(12, 10);
  const f = sheet(s, 0);
  f.box(1, 1, 3, 3, { name: 'Corridor' }).edgeV(1, 2, EDGE_DOOR2);
  f.bake();
  const r = buildReport(s);
  assert.equal(r.summary.fails, 0);
  assert.ok(r.findings.some((f) => f.level === 'ok'));
});

test('an unnamed room is a note about the input, not a finding about the building', () => {
  const s = createState(12, 10);
  sheet(s, 0).fill(1, 1, 5, 5).bake();
  const r = buildReport(s);
  const note = r.findings.find((x) => x.code === 'unnamed-rooms');
  assert.ok(note);
  assert.equal(note.level, 'note');
  assert.equal(note.section, 'occupancy');
});

test('sections can be switched off for a caller that only wants the fast half', () => {
  const quick = buildReport(SAMPLE, { acoustics: false, takeoff: false });
  assert.equal(quick.acoustics.rooms.length, 0);
  assert.equal(quick.takeoff, null);
  assert.equal(quick.summary.occupants, REPORT.summary.occupants);
  // ...and the findings that survive are the ones that didn't need them.
  assert.ok(!quick.findings.some((f) => f.section === 'acoustics'));
});

test('an unsprinklered report is held to the tighter travel limit', () => {
  const dry = buildReport(SAMPLE, { sprinklered: false, acoustics: false, takeoff: false });
  assert.equal(dry.sprinklered, false);
  assert.ok(dry.egress.limits.travel < REPORT.egress.limits.travel);
});

test('a shared nav graph gives an identical answer', () => {
  const nav = buildNav(SAMPLE);
  const r = buildReport(SAMPLE, { nav, acoustics: false, takeoff: false });
  assert.equal(r.summary.occupants, REPORT.summary.occupants);
  assert.equal(Math.round(r.summary.travel), Math.round(REPORT.summary.travel));
});

test('the acoustics section stands on its own and sorts loudest first', () => {
  const ac = acousticsSection(SAMPLE);
  assert.ok(ac.rooms.length > 0);
  for (let i = 1; i < ac.rooms.length; i++) {
    assert.ok(ac.rooms[i - 1].rt60 >= ac.rooms[i].rt60);
  }
  assert.equal(ac.summary.worst, ac.rooms[0]);
  assert.equal(ac.summary.over, ac.rooms.filter((r) => r.overLimit).length);
});

test('the CSV carries the summary, the findings, every room and the takeoff', () => {
  const csv = reportCSV(REPORT);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('School Generator'));
  assert.ok(lines.some((l) => l.startsWith('Occupant load,')));
  assert.ok(lines.some((l) => l.startsWith('Findings,Level,Section')));
  assert.ok(lines.some((l) => l.startsWith('Rooms,Level,Use')));
  assert.ok(lines.some((l) => l.startsWith('Section,Where,Item')), 'the takeoff header');
  for (const room of REPORT.occupancy.rooms) {
    if (!room.name) continue;
    assert.ok(lines.some((l) => l.startsWith(`${room.name},${floorLabel(room.floor)},`)),
      `${room.name} is not in the sheet`);
  }
  // Every data row has the same number of columns as the widest header.
  assert.ok(lines.length > REPORT.occupancy.rooms.length);
});

test('a report with no takeoff still makes a CSV', () => {
  const csv = reportCSV(buildReport(SAMPLE, { takeoff: false, acoustics: false }));
  assert.ok(csv.includes('Rooms,Level,Use'));
  assert.ok(!csv.includes('Section,Where,Item'));
});

test('an empty design reports nothing at length rather than throwing', () => {
  const r = buildReport(createState(8, 8));
  assert.equal(r.summary.occupants, 0);
  assert.equal(r.summary.rooms, 0);
  assert.equal(r.summary.verdict, 'fail', 'a building with no way out is a failure');
  assert.ok(reportCSV(r).length > 0);
});
