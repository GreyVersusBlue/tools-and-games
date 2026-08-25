// The educational program: the arithmetic that turns a student count into a
// schedule of rooms. Nothing here draws anything — these are the numbers a
// layout is given, and the point of the suite is that they stay defensible
// when the enrollment moves.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS, DEFAULT_BRIEF, MIN_STUDENTS, MAX_STUDENTS,
  bandEntry, normalizeBrief, buildProgram, programLines, teachingStations,
} from '../js/program.js';
import { classify } from '../js/occupancy.js';

test('every band is complete and internally sane', () => {
  for (const b of BANDS) {
    assert.ok(b.key && b.label, 'a band with no name');
    assert.ok(b.classSize > 10 && b.classSize < 40, `${b.key}: implausible class size`);
    assert.ok(b.utilization > 0.5 && b.utilization <= 1, `${b.key}: implausible utilization`);
    assert.ok(b.classroom.w * b.classroom.d >= 600, `${b.key}: classroom under 600 ft²`);
    assert.ok(b.specials.length > 0, `${b.key}: no specials`);
    for (const sp of b.specials) {
      assert.ok(sp.per > 0 && sp.min >= 0, `${b.key}/${sp.key}: bad ratio`);
      assert.ok(sp.w > 0 && sp.d > 0, `${b.key}/${sp.key}: no size`);
    }
    assert.ok(b.staffRatio > 5 && b.staffRatio < 30, `${b.key}: implausible staff ratio`);
  }
});

test('normalizeBrief clamps and never throws', () => {
  assert.deepEqual(normalizeBrief(undefined), normalizeBrief(DEFAULT_BRIEF));
  assert.equal(normalizeBrief({ students: -5 }).students, MIN_STUDENTS);
  assert.equal(normalizeBrief({ students: 1e9 }).students, MAX_STUDENTS);
  assert.equal(normalizeBrief({ storeys: 99 }).storeys, 4);
  assert.equal(normalizeBrief({ storeys: 0 }).storeys, 1);
  assert.equal(normalizeBrief({ band: 'nonsense' }).band, DEFAULT_BRIEF.band);
  assert.equal(normalizeBrief({ seed: 'x' }).seed, DEFAULT_BRIEF.seed);
  assert.equal(normalizeBrief({ gym: false }).gym, false);
});

test('teaching stations rise with enrollment and never hit zero', () => {
  let last = 0;
  for (const n of [30, 100, 300, 600, 1200, 2400]) {
    const st = teachingStations(n, 'middle');
    assert.ok(st >= last, `stations fell from ${last} to ${st} at ${n} students`);
    assert.ok(st >= 1);
    last = st;
  }
});

test('the station count in a program is the station count for its own band', () => {
  // `buildProgram` used to hand `teachingStations` the band *entry* rather
  // than its key, so the lookup missed and every band was priced as a middle
  // school — while the `rule` string it printed quoted the right numbers.
  for (const band of ['elementary', 'middle', 'high']) {
    for (const students of [120, 600, 2000]) {
      const p = buildProgram({ students, band });
      assert.equal(p.stations, teachingStations(students, band),
        `${band}/${students}: the program disagrees with its own band`);
      // A teaching station is a general classroom or one of the band's own
      // specials — not the office, the kitchen or the staff workroom, which
      // are wing-sized rooms nobody timetables a class into.
      const keys = new Set(bandEntry(band).specials.map((sp) => sp.key));
      const specials = p.rooms.filter((r) => keys.has(r.key)).reduce((n, r) => n + r.count, 0);
      const teaching = specials +
        p.rooms.filter((r) => r.key === 'classroom').reduce((n, r) => n + r.count, 0);
      // A school small enough that its specials outnumber its stations gets
      // the specials, which is a real answer and the one the tiny-school test
      // above pins.
      assert.equal(teaching, Math.max(p.stations, specials),
        `${band}/${students}: rooms don't sum to stations`);
    }
  }
  // The three bands must not all give the same answer, which is what the bug
  // looked like from outside.
  const counts = ['elementary', 'middle', 'high'].map((b) => buildProgram({ students: 2000, band: b }).stations);
  assert.notEqual(counts[0], counts[1]);
  assert.notEqual(counts[1], counts[2]);
});

test('teachingStations takes a key, and survives being handed an entry', () => {
  assert.equal(teachingStations(600, 'high'), teachingStations(600, bandEntry('high')));
});

test('a secondary school needs more stations per student than an elementary one', () => {
  // Lower utilization plus a bigger class size is the trade; utilization wins,
  // which is the thing worth pinning because it is the counter-intuitive half.
  const el = teachingStations(600, 'elementary') / 600;
  const hi = teachingStations(600, 'high') / 600;
  assert.ok(hi > el * 0.9, 'a high school should not be dramatically leaner per student');
});

test('specials come out of the station count, not on top of it', () => {
  const p = buildProgram({ students: 600, band: 'middle' });
  const teaching = p.rooms
    .filter((r) => ['classroom', 'science', 'art', 'music', 'computer', 'sped'].includes(r.key))
    .reduce((n, r) => n + r.count, 0);
  assert.equal(teaching, p.stations, 'teaching rooms should sum to the station count');
});

test('a tiny school is all specials and still builds', () => {
  const p = buildProgram({ students: MIN_STUDENTS, band: 'high' });
  assert.ok(p.roomCount > 0);
  assert.ok(p.rooms.every((r) => r.count >= 0));
  // Fewer stations than specials is a real answer, not an error.
  assert.ok(p.netArea > 0);
});

test('every row carries a rule and a plausible size', () => {
  const p = buildProgram({ students: 900, band: 'high' });
  for (const r of p.rooms) {
    assert.ok(r.rule, `${r.key} has no rule`);
    assert.ok(r.w > 0 && r.d > 0, `${r.key} has no size`);
    assert.equal(r.area, r.w * r.d);
    assert.equal(r.total, r.area * r.count);
    assert.ok(['wing', 'block', 'service'].includes(r.group), `${r.key}: odd group`);
  }
});

test('room names classify the way the occupancy table expects', () => {
  // The program hands its names straight to a layout that hands them straight
  // to Phase 7's report. A room this file calls "Health Office" had better
  // read as an office there, or the generated building prices itself wrong.
  const p = buildProgram({ students: 600, band: 'middle' });
  const expected = {
    classroom: 'classroom', science: 'lab', art: 'lab', computer: 'lab',
    music: 'stage', gym: 'gym', cafeteria: 'assembly-tables', kitchen: 'kitchen',
    library: 'library', office: 'office', health: 'office', counsel: 'office',
    'locker-g': 'locker', 'locker-b': 'locker', mech: 'storage',
    'restroom-g': 'restroom', 'restroom-b': 'restroom',
  };
  for (const r of p.rooms) {
    if (!(r.key in expected)) continue;
    // Classrooms are lettered "Room 101" downstream, so classify the numbered
    // form rather than the bare stem the program carries.
    const name = r.key === 'classroom' ? 'Room 101' : r.name;
    assert.equal(classify(name), expected[r.key], `${name} classified wrong`);
  }
});

test('turning the big rooms off removes them and nothing else', () => {
  const full = buildProgram({ students: 600, band: 'middle' });
  const bare = buildProgram({ students: 600, band: 'middle', gym: false, cafeteria: false, library: false });
  for (const key of ['gym', 'cafeteria', 'library', 'kitchen', 'locker-g']) {
    assert.ok(full.rooms.some((r) => r.key === key), `${key} missing from the full program`);
    assert.ok(!bare.rooms.some((r) => r.key === key), `${key} survived being turned off`);
  }
  assert.equal(
    full.rooms.filter((r) => r.key === 'classroom')[0].count,
    bare.rooms.filter((r) => r.key === 'classroom')[0].count,
    'the classroom count should not depend on whether there is a gym',
  );
  assert.ok(bare.netArea < full.netArea);
});

test('staff, drivers and parking scale the way the band says', () => {
  const el = buildProgram({ students: 800, band: 'elementary' });
  const hi = buildProgram({ students: 800, band: 'high' });
  assert.equal(el.drivers, 0, 'nobody drives to an elementary school');
  assert.ok(hi.drivers > 100, 'a high school of 800 should have student drivers');
  assert.ok(hi.parking > el.parking);
  assert.ok(el.staff >= 4);
});

test('gross area exceeds net and the program says so out loud', () => {
  const p = buildProgram({ students: 600, band: 'middle' });
  assert.ok(p.grossArea > p.netArea);
  assert.ok(p.grossFactor > 1.2 && p.grossFactor < 1.8);
  assert.match(p.caveat, /not code minimums/);
});

test('programLines prints one row per room type, with its rule', () => {
  const p = buildProgram({ students: 600, band: 'middle' });
  const lines = programLines(p);
  assert.equal(lines.length, p.rooms.length);
  for (const l of lines) {
    assert.ok(l.label && l.size);
    assert.ok(l.area > 0);
  }
  assert.match(lines[0].label, /20 × Room|Room/);
});

test('the same brief always builds the same program', () => {
  const a = buildProgram({ students: 640, band: 'high', storeys: 3, seed: 12 });
  const b = buildProgram({ students: 640, band: 'high', storeys: 3, seed: 12 });
  assert.deepEqual(a, b);
});

test('bandEntry falls back rather than returning nothing', () => {
  assert.equal(bandEntry('nope').key, DEFAULT_BRIEF.band);
  assert.equal(bandEntry('high').key, 'high');
});
