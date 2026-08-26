// Utilisation: what a timetable and a building say about each other. Every
// number here is a reading over two things the tool already had — the occupant
// loads Phase 7 computed and the nav mesh Phase 10 built — and the suite is
// mostly about the joins between them holding.
//
// The one assertion worth reading twice is the passing-period one: a walk
// measured over the mesh, in feet, against the seconds the bell schedule
// allows. That is the number the phase exists to produce, and it is wrong the
// moment somebody optimises the path by cost instead of by distance.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSampleSchool } from '../js/sample.js';
import { buildNav, findPath, pathDistance } from '../js/navgraph.js';
import { buildingOccupancy, occupancyIndex } from '../js/occupancy.js';
import { normalizeSchedule } from '../js/schedule.js';
import { SPEED } from '../js/agents.js';
import { buildReport, reportCSV } from '../js/report.js';
import { roomPool, buildTimetable, normalizeTimetable } from '../js/timetable.js';
import {
  PASSING_SPEED, CROWD_ROOMY, CROWD_CRUSH,
  utilisationAnalysis, travelAnalysis, corridorLoad, crowdSize,
} from '../js/utilisation.js';

const SAMPLE = buildSampleSchool();
const NAV = buildNav(SAMPLE);
const OCC = buildingOccupancy(SAMPLE, { nav: NAV });
const POOL = roomPool(NAV, { occupancy: OCC });
const TT = buildTimetable(POOL, {
  students: 200, classSize: 25, periods: 6, band: 'middle', seed: 3, teachers: 20,
});
const U = utilisationAnalysis(SAMPLE, { nav: NAV, occupancy: OCC, pool: POOL, timetable: TT });

test('the passing-period pace is the one the crowd actually walks at', () => {
  // Quoted rather than imported, so that the day one of them changes the other
  // is a failing test rather than two modules disagreeing in public.
  assert.equal(PASSING_SPEED, SPEED.passing);
});

test('no timetable is no section, not a section full of zeroes', () => {
  const none = utilisationAnalysis(SAMPLE, { nav: NAV, occupancy: OCC, pool: POOL, timetable: null });
  assert.equal(none.has, false);
  assert.deepEqual(none.findings, []);
  assert.equal(none.travel, null);
  // ...and the report leaves the whole section out rather than printing it empty.
  const plain = buildReport(SAMPLE);
  assert.equal(plain.utilisation, null);
  assert.equal(plain.summary.utilisation, null);
  assert.equal(plain.findings.filter((f) => f.section === 'utilisation').length, 0);
});

test('the reading joins to the same rooms the rest of the report does', () => {
  assert.equal(U.has, true);
  const known = new Set(NAV.rooms.map((r) => r.id));
  for (const r of U.rooms) assert.ok(known.has(r.id), `${r.id} is not a room the graph knows`);
  const loads = occupancyIndex(OCC);
  for (const r of U.rooms) assert.equal(r.capacity, loads.get(r.id).occ);
});

test('every section is counted once, in its own period', () => {
  assert.equal(U.summary.sections, TT.sections.length);
  assert.equal(U.periods.length, U.summary.periods);
  const counted = U.periods.reduce((n, p) => n + p.sections, 0);
  assert.equal(counted, TT.sections.length);
  for (const p of U.periods) {
    assert.ok(p.placed <= p.sections);
    assert.ok(p.rooms <= p.placed);
  }
});

test('utilisation is room-periods filled over room-periods available', () => {
  const filled = U.rooms.reduce((n, r) => n + r.used, 0);
  assert.equal(U.summary.utilisation, filled / (U.summary.periods * U.rooms.length));
  assert.ok(U.summary.utilisation > 0 && U.summary.utilisation <= 1);
  for (const r of U.rooms) {
    assert.ok(r.used <= U.summary.periods, `${r.name}: used more periods than the day has`);
    assert.equal(r.share, r.used / U.summary.periods);
  }
});

test('the rooms empty at the busiest period are the ones with nobody in them', () => {
  const peak = U.summary.peak;
  assert.ok(peak, 'a timetable with sections in it has a busiest period');
  const busyIds = new Set(TT.sections.filter((s) => s.period === peak.period && s.room).map((s) => s.room));
  assert.equal(peak.rooms, busyIds.size);
  assert.equal(U.summary.idleAtPeak, U.rooms.length - busyIds.size);
  for (const r of U.idleAtPeak) assert.ok(!busyIds.has(r.id));
});

test('a walk between bells is the distance over the mesh, not the cost of the route', () => {
  assert.ok(U.travel.moves.length > 0, 'a school where nobody changes room is not a school');
  for (const m of U.travel.moves) {
    const path = findPath(NAV, m.from, m.room);
    assert.ok(path, `no route from ${m.from} to ${m.room}, but a move was measured`);
    const measured = pathDistance(NAV, path);
    assert.equal(m.dist, measured.dist);
    // The distinction the whole phase turns on: `cost` has the stair penalty
    // and the lift's wait folded into it, and printing that as feet would make
    // this number a lie.
    if (m.links) assert.notEqual(measured.cost, measured.dist);
    assert.equal(m.seconds, m.dist / PASSING_SPEED);
  }
});

test('a move is only a move when the room changes', () => {
  const slots = new Map();
  for (const s of TT.sections) slots.set(`${s.cohort}|${s.period}`, s);
  for (const m of U.travel.moves) {
    const a = slots.get(`${m.cohort}|${m.period}`);
    const b = slots.get(`${m.cohort}|${m.to}`);
    assert.notEqual(a.room, b.room, 'staying put was counted as a walk');
    assert.equal(a.room, m.from);
    assert.equal(b.room, m.room);
  }
});

test('the passing-time verdict follows the bell schedule it was given', () => {
  const generous = travelAnalysis(NAV, TT, { schedule: normalizeSchedule({ passingMin: 30 }), periods: 6 });
  const mean = travelAnalysis(NAV, TT, { schedule: normalizeSchedule({ passingMin: 0 }), periods: 6 });
  assert.equal(generous.summary.late, 0, 'half an hour is enough to cross any school');
  assert.equal(generous.allowed, 30 * 60);
  // No passing time at all is a day with no walking in it, and the reading
  // refuses to call every move late over a limit of zero seconds.
  assert.equal(mean.allowed, 0);
  assert.equal(mean.summary.late, 0);

  const tight = travelAnalysis(NAV, TT, { schedule: normalizeSchedule({ passingMin: 1 }), periods: 6 });
  const longest = tight.summary.worst;
  assert.equal(tight.summary.late, tight.moves.filter((m) => m.seconds > 60).length);
  assert.equal(longest, tight.moves[0], 'the worst move is the longest one');
});

test('per student per day is the walk one group makes, and the year follows from it', () => {
  const walked = U.travel.moves.reduce((n, m) => n + m.dist, 0);
  assert.equal(U.travel.summary.perDay, walked / U.travel.cohorts.length);
  assert.ok(Math.abs(U.travel.summary.milesPerYear - (U.travel.summary.perDay * 180) / 5280) < 1e-9);
  assert.equal(U.travel.summary.mean, walked / U.travel.moves.length);
});

test('a corridor carries the people whose routes cross it, and only circulation counts', () => {
  const loads = occupancyIndex(OCC);
  for (const row of U.corridors.rows) {
    assert.ok(loads.get(row.id).circulation, `${row.name} is not a circulation space`);
    assert.equal(row.perHead, row.area / row.people);
    assert.equal(row.people, row.cohorts.length ? row.people : 0);
  }
  // Every crossing of a circulation space is somebody's size, added once.
  const by = new Map();
  for (const m of U.travel.moves) {
    for (const id of m.crosses) {
      if (!loads.get(id) || !loads.get(id).circulation) continue;
      const key = `${m.period}|${id}`;
      by.set(key, (by.get(key) || 0) + m.size);
    }
  }
  assert.equal(U.corridors.rows.length, by.size);
  for (const row of U.corridors.rows) assert.equal(row.people, by.get(`${row.period}|${row.id}`));
  assert.ok(CROWD_CRUSH < CROWD_ROOMY);
  assert.equal(U.corridors.rows[0], U.corridors.worst, 'the worst corridor is the tightest one');
});

test('every finding is levelled, coded and explains its own rule', () => {
  assert.ok(U.findings.length > 0);
  for (const f of U.findings) {
    assert.ok(['fail', 'warn', 'note', 'ok'].includes(f.level), `bad level ${f.level}`);
    assert.ok(f.code && f.title && f.detail, 'a finding with nothing to read');
    assert.ok(f.detail.length > 40, `${f.code}: a detail too short to have said why`);
    for (const r of f.rooms || []) assert.ok(r && r.id, `${f.code}: a room mark with no id`);
  }
});

test('a class in a room too small to hold it fails, and says which room', () => {
  const tiny = [{ id: 'r0:s1', name: 'Seminar', floor: 0, area: 200, use: 'classroom', capacity: 8, x: 0, z: 0 }];
  const tt = normalizeTimetable({
    cohorts: [{ id: 'c1', name: '9-1', size: 30 }],
    sections: [{ id: 's1', period: 1, cohort: 'c1', room: 'r0:s1', subject: 'math' }],
  });
  const u = utilisationAnalysis(SAMPLE, { nav: NAV, occupancy: OCC, pool: tiny, timetable: tt });
  const f = u.findings.find((x) => x.code === 'over-load');
  assert.ok(f, 'no finding about a class of thirty in a room for eight');
  assert.equal(f.level, 'fail');
  assert.match(f.detail, /Seminar/);
  assert.match(f.detail, /8/);
});

test('a double-booked room is a finding a generated timetable can never produce', () => {
  const pool = [
    { id: 'r0:s1', name: 'Room 101', floor: 0, area: 900, use: 'classroom', capacity: 30, x: 0, z: 0 },
  ];
  const tt = normalizeTimetable({
    cohorts: [{ id: 'c1', name: '9-1', size: 20 }, { id: 'c2', name: '9-2', size: 20 }],
    sections: [
      { id: 's1', period: 1, cohort: 'c1', room: 'r0:s1' },
      { id: 's2', period: 1, cohort: 'c2', room: 'r0:s1' },
    ],
  });
  const u = utilisationAnalysis(SAMPLE, { nav: NAV, occupancy: OCC, pool, timetable: tt });
  const f = u.findings.find((x) => x.code === 'double-booked');
  assert.ok(f);
  assert.equal(f.level, 'fail');
  assert.equal(u.issues.roomClash.length, 1);
});

test('the report grows the section, sorts its findings in and keeps its own verdict rule', () => {
  const withDay = { ...SAMPLE, timetable: TT };
  const r = buildReport(withDay);
  assert.ok(r.utilisation && r.utilisation.has);
  assert.equal(r.summary.utilisation, r.utilisation.summary.utilisation);
  const mine = r.findings.filter((f) => f.section === 'utilisation');
  assert.equal(mine.length, r.utilisation.findings.length);
  // Still worst-first across the whole list, section or no section.
  const order = ['fail', 'warn', 'note', 'ok'];
  let last = -1;
  for (const f of r.findings) {
    const at = order.indexOf(f.level);
    assert.ok(at >= last, 'the new section broke the worst-first ordering');
    last = at;
  }
  assert.equal(r.summary.fails, r.findings.filter((f) => f.level === 'fail').length);
});

test('the spreadsheet carries the school day, and leaves it out when there is none', () => {
  const withDay = reportCSV(buildReport({ ...SAMPLE, timetable: TT }));
  assert.match(withDay, /School day/);
  assert.match(withDay, /Walk per student per day/);
  assert.match(withDay, /Fits the bell/);
  const without = reportCSV(buildReport(SAMPLE));
  assert.doesNotMatch(without, /School day/);
});

// ---------- the crowd at the occupant load ----------

test('the roll comes off the teaching spaces, not off every room in the building', () => {
  const at = crowdSize(OCC);
  assert.equal(at.from, 'occupancy');
  assert.ok(at.students > 0);
  // Not the whole occupant load: a gym, a cafeteria and an auditorium each
  // hold the *same* crowd the classrooms hold, and counting all three counts
  // the school four times.
  assert.ok(at.students < OCC.total, 'the roll is the whole building, which is the mistake');
  const byHand = OCC.rooms
    .filter((r) => !r.circulation && !r.tiny && ['classroom', 'lab', 'stage'].includes(r.use))
    .reduce((n, r) => n + r.occ, 0);
  assert.equal(at.students, byHand);
});

test('a timetable is a better answer than an occupant load, and says so', () => {
  const at = crowdSize(OCC, { timetable: TT });
  assert.equal(at.from, 'timetable');
  assert.equal(at.students, TT.cohorts.reduce((n, c) => n + c.size, 0));
  assert.equal(crowdSize(null).from, 'none');
  assert.equal(crowdSize(null).students, 0);
});
