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
import {
  LEVELS, buildReport, reportCSV, acousticsSection, codePanel, dayPanel,
} from '../js/report.js';
import { roomPool, buildTimetable } from '../js/timetable.js';
import { exampleRates, emptyRates, setRate } from '../js/rates.js';
import { phaseByStorey } from '../js/phasing.js';

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

// ---------- Phase 16: cost, spec and phasing, composed ----------

test('the spec sheet is there whether or not anybody has priced anything', () => {
  assert.ok(REPORT.spec);
  assert.ok(REPORT.spec.lines.length > 0);
  assert.ok(REPORT.cost, 'the cost section exists...');
  assert.ok(!REPORT.cost.has, '...and says nothing is priced');
  assert.equal(REPORT.summary.cost, null, 'a building nobody priced does not cost nothing');
});

test('one pass over the model feeds all three readers', () => {
  const priced = buildReport(SAMPLE, { rates: exampleRates() });
  assert.ok(priced.cost.has);
  assert.equal(priced.summary.cost, priced.cost.summary.total);
  assert.equal(priced.summary.perSqft, priced.cost.summary.perSqft);
  // The spec sheet and the cost lines are two readings of one set of
  // quantities, so every spec line is a cost line and the reverse.
  const costKeys = new Set(priced.cost.lines.map((l) => l.key));
  for (const l of priced.spec.lines) assert.ok(costKeys.has(l.key), l.key);
});

test('a cost finding reaches the finding list under its own section', () => {
  const priced = buildReport(SAMPLE, { rates: exampleRates() });
  const found = priced.findings.filter((f) => f.section === 'cost');
  assert.ok(found.length > 0);
  assert.ok(found.some((f) => f.code === 'example-rates'));
});

test('a design with no phasing plan says so once, in the phasing module', () => {
  assert.ok(!REPORT.findings.some((f) => f.section === 'phasing'),
    'the report does not nag about a plan nobody has made');
  assert.ok(REPORT.phasing);
  assert.ok(!REPORT.phasing.has);
});

test('an out-of-order phasing plan fails the whole report', () => {
  const s = buildSampleSchool();
  const plan = phaseByStorey(s);
  const r = buildReport(s, {
    rates: exampleRates(),
    phasing: { phases: [plan.phases[1], plan.phases[0]] },
  });
  const finding = r.findings.find((f) => f.code === 'phase-order');
  assert.ok(finding);
  assert.equal(finding.section, 'phasing');
  assert.equal(r.summary.verdict, 'fail');
});

test('the report reads the design\'s own rates and plan', () => {
  const s = buildSampleSchool();
  s.rates = setRate(emptyRates(), 'slab', 10);
  s.phasing = phaseByStorey(s);
  const r = buildReport(s);
  assert.ok(r.cost.has);
  assert.ok(r.phasing.has);
  assert.equal(r.phasing.rows.length, 2);
});

// ---------- the title-block code panel ----------

test('the code panel says which code, and what it measured against it', () => {
  const panel = codePanel(REPORT, { floor: 0 });
  assert.equal(panel.edition, REPORT.editionLabel);
  assert.equal(panel.sprinklered, REPORT.sprinklered);
  const rows = new Map(panel.rows);
  assert.equal(rows.get('Occupant load'), String(REPORT.summary.occupants));
  assert.ok(rows.get('Exits').includes(String(REPORT.egress.summary.exits)));
  assert.ok(rows.get('Longest travel').includes(String(REPORT.egress.limits.travel)));
  assert.ok(/Not a code review/.test(panel.caveat));
});

test('the panel counts exits where they are, not building-wide', () => {
  const panel = codePanel(REPORT, { floor: 0 });
  const total = panel.storeys.reduce((n, s) => n + s.exits, 0);
  assert.equal(total, REPORT.egress.summary.exits);
  assert.ok(panel.storeys[0].exits > 0, 'the sample school leaves at the ground');
});

test('the panel knows which sheet it is printed on', () => {
  const ground = codePanel(REPORT, { floor: 0 });
  const upper = codePanel(REPORT, { floor: 1 });
  assert.deepEqual(ground.storeys.map((s) => s.current), [true, false]);
  assert.deepEqual(upper.storeys.map((s) => s.current), [false, true]);
  // ...and on a sheet that is not a storey at all — the site plan — nothing is
  // marked rather than the ground floor being marked by accident.
  assert.deepEqual(codePanel(REPORT).storeys.map((s) => s.current), [false, false]);
});

test('the panel carries the verdict, because a set that hides its own analysis is worse', () => {
  const panel = codePanel(REPORT, { floor: 0 });
  assert.equal(panel.verdict, REPORT.summary.verdict);
  assert.equal(panel.fails, REPORT.summary.fails);
  assert.equal(panel.warns, REPORT.summary.warns);
});

test('the area per storey adds up to the building area', () => {
  const panel = codePanel(REPORT, { floor: 0 });
  const area = panel.storeys.reduce((n, s) => n + s.area, 0);
  assert.ok(Math.abs(area - REPORT.summary.area) < 1e-6);
  const occ = panel.storeys.reduce((n, s) => n + s.occ, 0);
  assert.equal(occ, REPORT.summary.occupants);
});

// ---------- the title-block school-day panel ----------

// The one section the sheet used to leave out. Built over the same sample
// school with a timetable put on it, because a school day is the one reading
// in the report that cannot be taken from a building on its own.
const DAY_SAMPLE = (() => {
  const s = buildSampleSchool();
  const nav = buildNav(s);
  s.timetable = buildTimetable(
    roomPool(nav, { occupancy: buildingOccupancy(s, { nav }) }),
    { students: 200, classSize: 25, periods: 6, band: 'middle', seed: 3, teachers: 20 });
  return s;
})();
const DAY_REPORT = buildReport(DAY_SAMPLE);

test('a design with no timetable gets no school-day panel at all', () => {
  // Not an empty panel, and not a panel of zeroes: the sheet draws nothing,
  // the same call `reportCSV` makes when it leaves its own block out.
  assert.equal(REPORT.utilisation, null);
  assert.equal(dayPanel(REPORT, { floor: 0 }), null);
  assert.equal(dayPanel(null), null);
  assert.equal(dayPanel({ utilisation: { has: false } }), null);
});

test('the school-day panel prints the timetable the report actually read', () => {
  const panel = dayPanel(DAY_REPORT, { floor: 0 });
  const u = DAY_REPORT.utilisation;
  assert.ok(u && u.has, 'the fixture has a timetable');
  const rows = new Map(panel.rows);
  assert.equal(rows.get('Groups'), `${u.summary.cohorts} · ${u.summary.students} students`);
  assert.equal(rows.get('Sections'), `${u.summary.placed} of ${u.summary.sections} in a room`);
  assert.ok(rows.get('Room use').includes(String(Math.round(u.summary.utilisation * 100))));
  assert.equal(panel.edition, `${u.summary.periods} periods`);
  // The passing time is minutes on the sheet and seconds in the analysis.
  assert.equal(panel.passing, Math.round(u.travel.allowed / 60));
});

test('the panel says how far a student walks, in both units it was asked in', () => {
  const rows = new Map(dayPanel(DAY_REPORT, { floor: 0 }).rows);
  const t = DAY_REPORT.utilisation.travel.summary;
  assert.equal(rows.get('Walk per student'), `${Math.round(t.perDay)} ft a day`);
  assert.equal(rows.get('Over a school year'), `${Math.round(t.milesPerYear)} miles`);
});

test('"none late" is printed as a result rather than left off', () => {
  const rows = new Map(dayPanel(DAY_REPORT, { floor: 0 }).rows);
  const t = DAY_REPORT.utilisation.travel.summary;
  const line = rows.get('Late for the bell');
  assert.ok(line, 'the row is always there');
  assert.equal(line, t.late ? `${t.late} of ${t.moves} moves` : `none of ${t.moves} moves`);
});

test('the school-day panel knows which sheet it is printed on', () => {
  const ground = dayPanel(DAY_REPORT, { floor: 0 });
  const upper = dayPanel(DAY_REPORT, { floor: 1 });
  assert.deepEqual(ground.storeys.map((s) => s.current), [true, false]);
  assert.deepEqual(upper.storeys.map((s) => s.current), [false, true]);
  assert.deepEqual(dayPanel(DAY_REPORT).storeys.map((s) => s.current), [false, false]);
});

test('the rooms per storey add up to the rooms the day was measured over', () => {
  const panel = dayPanel(DAY_REPORT, { floor: 0 });
  const u = DAY_REPORT.utilisation;
  const rooms = panel.storeys.reduce((n, s) => n + s.rooms, 0);
  assert.equal(rooms, u.summary.rooms);
  const used = panel.storeys.reduce((n, s) => n + s.used, 0);
  assert.equal(used, u.summary.used);
  const idle = panel.storeys.reduce((n, s) => n + s.idle, 0);
  assert.equal(idle, u.summary.idleAtPeak);
  // Every storey the panel names is a storey the building has.
  for (const st of panel.storeys) assert.equal(st.label, floorLabel(st.floor));
});

test('the panel carries the school day\'s own verdict, not the code verdict', () => {
  const panel = dayPanel(DAY_REPORT, { floor: 0 });
  const f = DAY_REPORT.utilisation.findings;
  assert.equal(panel.fails, f.filter((x) => x.level === 'fail').length);
  assert.equal(panel.warns, f.filter((x) => x.level === 'warn').length);
  assert.equal(panel.verdict, panel.fails ? 'fail' : panel.warns ? 'warn' : 'ok');
  assert.ok(/timetable is not part of the building/.test(panel.caveat));
});

// ---------- the spreadsheet grew three sections ----------

test('the CSV carries the specification, the cost and the phasing', () => {
  const s = buildSampleSchool();
  s.rates = exampleRates();
  s.phasing = phaseByStorey(s);
  const csv = reportCSV(buildReport(s));
  assert.ok(csv.includes('System,Assembly,What it is'), 'the spec sheet');
  assert.ok(csv.includes('Cost estimate'), 'the cost');
  assert.ok(csv.includes('Phase,Rooms,Area ft²'), 'the phasing');
});

test('an unpriced design writes the spec but no cost table', () => {
  const csv = reportCSV(REPORT);
  assert.ok(csv.includes('System,Assembly,What it is'));
  assert.ok(!csv.includes('Cost estimate'));
});

// ---------- findings on the panels (Phase 19) ----------

import { panelFindings } from '../js/report.js';

test('a panel carries its worst findings in words, capped, with the remainder counted', () => {
  const findings = [
    { level: 'fail', title: 'No way out' },
    { level: 'warn', title: 'Too dark' },
    { level: 'note', title: 'Unnamed rooms' },
    { level: 'warn', title: 'Rings too long' },
    { level: 'warn', title: 'Corridor tight' },
    { level: 'ok', title: 'Fine' },
  ];
  const p = panelFindings(findings);
  assert.equal(p.lines.length, 3, 'three lines, not the whole report');
  assert.deepEqual(p.lines.map((l) => l.title), ['No way out', 'Too dark', 'Rings too long'],
    'notes and oks are not sheet material');
  assert.equal(p.more, 1, 'and the rest are counted rather than dropped');
  assert.deepEqual(panelFindings([]), { lines: [], more: 0 });
  assert.deepEqual(panelFindings(null), { lines: [], more: 0 });
});

test('the code panel says what its badge counts', () => {
  const panel = codePanel(REPORT, { floor: 0 });
  assert.ok(panel.findings, 'the panel carries findings now');
  assert.ok(Array.isArray(panel.findings.lines));
  for (const l of panel.findings.lines) {
    assert.ok(l.level === 'fail' || l.level === 'warn');
    assert.ok(typeof l.title === 'string' && l.title.length);
  }
  // The lines are the report's own worst-first order, so the first line on
  // the sheet is the first finding in the panel.
  const worth = REPORT.findings.filter((f) => f.level === 'fail' || f.level === 'warn');
  assert.deepEqual(panel.findings.lines.map((l) => l.title),
    worth.slice(0, 3).map((f) => f.title));
});
