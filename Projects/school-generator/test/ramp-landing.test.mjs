// The level landing at the top of a straight ramp (#904): ADA 2010 405.7.3's
// 60in, where it was the stair's 4ft. One number, read from switchback.js,
// and a finding for a landing with something in its 5ft.
//
// The fixture, by hand: a 12ft storey at 1:6 is 72ft of run. The ramp is 4ft
// wide, turned to climb toward +X along z 22, so with its foot at x the run
// tops out at x + 72, the landing ends at x + 77 (x + 76 before), and the
// walker's way off is asked for a foot past that. Cells are 4ft, so a wall
// drawn after cell 20 stands on x 84.
//
// Run with: node --test test/ramp-landing.test.mjs  (from the project folder)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, addFloor } from '../js/grid.js';
import { sheet } from './build.mjs';
import {
  addStair, stairRun, stairMetrics, cutBox, stairSurfaceAt, openingRails, rampLandingBox,
  topLanding, LANDING, RAMP_LANDING,
} from '../js/stairs.js';
import { LANDING_D } from '../js/switchback.js';
import { runLandings } from '../js/navgraph.js';
import { rampLandingFit } from '../js/clearance.js';
import { accessibleAnalysis } from '../js/egress.js';
import { buildReport } from '../js/report.js';
import { buildSampleSchool } from '../js/sample.js';
import { serialize, deserialize } from '../js/save-load.js';
import { takeoff } from '../js/takeoff.js';

const M = stairRun(12);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const find = (list, code) => list.find((f) => f.code === code);
const link = (type, data = {}) => ({ id: 1, type, from: 0, to: 1, x: 0, z: 0, rotationY: 0, data });

// Two storeys (three with `storeys: 3`), a ground hall, whatever `upper` draws
// on the storey above, and one straight ramp with its foot at (x, 22).
function school(x, upper, opts = {}) {
  const s = createState(60, 20);
  addFloor(s);
  if (opts.storeys === 3) addFloor(s);
  const g = sheet(s, 0);
  g.box(1, 1, 40, 8, { name: 'Ground Hall' }).door(1, 4, false);
  g.bake();
  const u = sheet(s, 1);
  upper(u);
  u.bake();
  if (opts.storeys === 3) sheet(s, 2).box(1, 1, 40, 8, { name: 'Top Hall' }).bake();
  const { link: ramp } = addStair(s, 0, {
    type: opts.type || 'ramp', x, z: 22, rotationY: Math.PI / 2, slope: 6, ...opts.ramp,
  });
  return { s, ramp };
}
const oneHall = (u) => u.box(1, 1, 40, 8, { name: 'Upper Hall' });
const twoRooms = (u) => { u.box(1, 1, 20, 8, { name: 'Upper Hall' }); u.box(21, 1, 40, 8, { name: 'Far Room' }); };
const shortHall = (u) => u.box(1, 1, 20, 8, { name: 'Upper Hall' });

// ---------- the rule ----------

test('a ramp lands on 5ft, the number a folded ramp already used; a stair still lands on 4', () => {
  assert.equal(RAMP_LANDING, 5);
  assert.equal(RAMP_LANDING, LANDING_D, 'one definition');
  assert.equal(LANDING, 4);
  assert.equal(topLanding(link('ramp')), 5);
  assert.equal(topLanding(link('stair')), 4);
});

test('a straight ramp: the hole, the surface, the rails and the way off are all a foot longer', () => {
  const r = link('ramp');            // 1:12, so 144ft of run
  const cut = cutBox(r, M);
  assert.ok(near(cut.z1, 149), `the hole ends at ${cut.z1}`);
  assert.equal(stairSurfaceAt(r, M, 0, 148.5), 12, '4.5ft past the top is landing now');
  assert.equal(stairSurfaceAt(r, M, 0, 149.5), null, '5.5ft past is off it');
  const sides = openingRails(r, M).filter((x) => x.side !== 'near');
  assert.deepEqual(sides.map((x) => Math.max(x.a.z, x.b.z)), [149, 149]);
  assert.ok(near(runLandings(r, M).head.z, 151));
  assert.deepEqual(rampLandingBox(r, M), { x0: -2, x1: 2, z0: 144, z1: 149 });
});

test('what must not move: a stair, and a ramp folded into runs', () => {
  const st = link('stair');
  assert.ok(near(cutBox(st, M).z1, M.run + 4));
  assert.equal(stairSurfaceAt(st, M, 0, M.run + 3.9), 12);
  assert.equal(stairSurfaceAt(st, M, 0, M.run + 4.1), null);
  assert.ok(near(runLandings(st, M).head.z, M.run + 6));
  assert.equal(rampLandingBox(st, M), null);
  // Five runs of 28.8ft with 5ft landings: the box round the hole and the way
  // off, as test/ramp-fold.test.mjs has them.
  const fold = link('ramp', { runs: 5 });
  const c = cutBox(fold, M);
  assert.ok(near(c.x0, 5.75) && near(c.x1, 18.25) && near(c.z0, -5) && near(c.z1, 33.8));
  const head = runLandings(fold, M).head;
  assert.ok(near(head.x, 16) && near(head.z, 35.8));
  assert.equal(rampLandingBox(fold, M), null);
});

// ---------- does the landing have its room ----------

test('a landing with open floor round it and past it is not flagged', () => {
  const { s, ramp } = school(8, oneHall);
  assert.equal(rampLandingFit(s, ramp), null);
  const a = accessibleAnalysis(s);
  assert.equal(a.summary.tightLandings, 0);
  assert.equal(find(a.findings, 'ramp-landing'), undefined);
});

test('a wall half a foot past the old 4ft landing is in the new one', () => {
  // Foot at 7.5: the run tops out at 79.5, 4ft ended at 83.5, 5ft ends at 84.5,
  // and the wall between the two rooms stands on 84.
  const { s, ramp } = school(7.5, twoRooms);
  const fit = rampLandingFit(s, ramp);
  assert.deepEqual(fit.why, ['wall']);
  assert.deepEqual([fit.id, fit.floor], [ramp.id, 1], 'marked on the storey it arrives on');
  assert.ok(near(fit.x, 82) && near(fit.z, 22), 'at the middle of the landing');
});

test('a wall across the far end is in the way; a doorway there is the way off', () => {
  // Foot at 7: the landing ends on 84, where the wall is.
  const shut = school(7, twoRooms);
  assert.deepEqual(rampLandingFit(shut.s, shut.ramp).why, ['wall']);
  const door = (u) => { twoRooms(u); u.door(21, 5, false); };
  const open = school(7, door);
  assert.equal(rampLandingFit(open.s, open.ramp), null, 'ADA 405.7.5: a doorway may adjoin a landing');
  // The same doorway half a foot inside the landing is a door across it.
  const through = school(7.5, door);
  assert.deepEqual(rampLandingFit(through.s, through.ramp).why, ['wall']);
  // That one is caught by the jambs, which stand 0.2ft inside a 4ft ramp's
  // sides. A 3ft ramp passes between them, and the doorway itself is what is
  // across its landing.
  const narrow = school(7.5, door, { ramp: { width: 3 } });
  assert.deepEqual(rampLandingFit(narrow.s, narrow.ramp).why, ['wall']);
});

test('a landing that runs off the floor above, or has no floor past its end', () => {
  // The upper hall stops at 84. Foot at 4.5: landing to 81.5, floor asked at 82.5.
  const fits = school(4.5, shortHall);
  assert.equal(rampLandingFit(fits.s, fits.ramp), null);
  // Foot at 6.5: landing to 83.5, short of the wall, and 84.5 is off the floor.
  const lip = school(6.5, shortHall);
  assert.deepEqual(rampLandingFit(lip.s, lip.ramp).why, ['edge']);
  // Foot at 10: the landing itself is over the edge, through the outside wall.
  const over = school(10, shortHall);
  assert.deepEqual(rampLandingFit(over.s, over.ramp).why, ['wall', 'edge']);
  // Off the side: the hall's long wall is on z 36, and a ramp along z 35 has
  // one side of its landing a foot outside it, with floor still ahead.
  const side = school(8, oneHall);
  side.ramp.z = 35;
  assert.deepEqual(rampLandingFit(side.s, side.ramp).why, ['wall', 'edge']);
});

test('another link in the landing: a floor opening, a stair standing on it; not a ramp beside it', () => {
  const hole = school(8, oneHall);
  addStair(hole.s, 0, { type: 'opening', x: 82.5, z: 22, w: 3, d: 3 });
  assert.deepEqual(rampLandingFit(hole.s, hole.ramp).why, ['link']);
  const stair = school(8, oneHall, { storeys: 3 });
  addStair(stair.s, 1, { type: 'stair', x: 82.5, z: 22, rotationY: Math.PI / 2 });
  assert.deepEqual(rampLandingFit(stair.s, stair.ramp).why, ['link']);
  // A lift from the ground stands on the storey above without cutting it.
  const lift = school(8, oneHall);
  addStair(lift.s, 0, { type: 'elevator', x: 82.5, z: 22 });
  assert.deepEqual(rampLandingFit(lift.s, lift.ramp).why, ['link']);
  // A slot 3ft by 12ft across the landing: no corner of either is inside the
  // other, and the edges cross.
  const slot = school(8, oneHall);
  addStair(slot.s, 0, { type: 'opening', x: 82.5, z: 22, w: 3, d: 12 });
  assert.deepEqual(rampLandingFit(slot.s, slot.ramp).why, ['link']);
  // A second ramp in the next lane: the two holes share a line, 4ft apart
  // centre to centre, and neither landing is in the other's hole.
  const pair = school(8, oneHall);
  const { link: beside } = addStair(pair.s, 0, { type: 'ramp', x: 8, z: 26, rotationY: Math.PI / 2, slope: 6 });
  assert.equal(rampLandingFit(pair.s, pair.ramp), null);
  assert.equal(rampLandingFit(pair.s, beside), null);
});

test('only a straight ramp is asked: a stair and a folded ramp against the same wall are not', () => {
  const st = school(7.5, twoRooms, { type: 'stair' });
  assert.equal(rampLandingFit(st.s, st.ramp), null);
  const fold = school(7.5, twoRooms, { ramp: { runs: 5 } });
  assert.equal(rampLandingFit(fold.s, fold.ramp), null);
});

// ---------- the flag ----------

test('the finding says what is in the way, moves nothing, and the ramp still counts', () => {
  const { s, ramp } = school(7.5, twoRooms);
  const before = JSON.stringify(s.links);
  const a = accessibleAnalysis(s);
  assert.equal(JSON.stringify(s.links), before, 'asking changes no link');
  assert.equal(a.summary.tightLandings, 1);
  assert.equal(a.summary.ramps, 0, 'at 1:6 it is a steep ramp, counted as before');
  assert.deepEqual(a.tightLandings.map((l) => l.id), [ramp.id]);
  const f = find(a.findings, 'ramp-landing');
  assert.equal(f.level, 'warn');
  assert.equal(f.title, '1 ramp with no room for the top landing');
  assert.match(f.detail, /5 ft long \(ADA 405\.7\)/);
  assert.match(f.detail, /Here a wall or a doorway stands in it \(1\)\./);
  assert.match(f.detail, /Nothing was moved/);
  assert.equal(f.cite, 'ADA 2010 · §405.7');
  assert.deepEqual(f.doors.map((d) => [d.id, d.floor]), [[ramp.id, 1]]);
  // At 1:12 it rolls, and a tight landing does not take it off the route.
  const gentle = school(7.5, (u) => u.box(1, 1, 22, 8, { name: 'Upper Hall' }), { ramp: { slope: 12 } });
  gentle.s.floorHt = 6;      // 72ft of run again, landing 79.5 to 84.5, the hall ends at 92
  assert.equal(rampLandingFit(gentle.s, gentle.ramp), null);
  const tight = school(7.5, twoRooms, { ramp: { slope: 12 } });
  tight.s.floorHt = 6;
  const t = accessibleAnalysis(tight.s);
  assert.equal(t.summary.tightLandings, 1);
  assert.equal(t.summary.ramps, 1, 'still a way up (#833 for the long run, the same here)');
});

test('each reason is counted, and two ramps make the title plural', () => {
  const { s } = school(7.5, twoRooms);
  addStair(s, 0, { type: 'ramp', x: 90, z: 22, rotationY: Math.PI / 2, slope: 6 });   // lands past 164
  const f = find(accessibleAnalysis(s).findings, 'ramp-landing');
  assert.equal(f.title, '2 ramps with no room for the top landing');
  assert.match(f.detail, /a wall or a doorway stands in it \(2\); it runs off the floor it arrives on \(1\)\./);
});

test('the report carries it, and the sample school, which has no ramp, never sees it', () => {
  const { s } = school(7.5, twoRooms);
  assert.equal(buildReport(s).findings.filter((f) => f.code === 'ramp-landing').length, 1);
  const sample = buildSampleSchool();
  assert.deepEqual(sample.links.map((l) => l.type), ['stair', 'elevator', 'opening']);
  assert.equal(find(buildReport(sample).findings, 'ramp-landing'), undefined);
});

// ---------- a ramp saved under the 4ft rule ----------

test('an old save loads with the 5ft landing: same record, same place, flagged, saved back the same', () => {
  // A file stores a ramp's place, turn, width and slope and no landing, so the
  // text below is what the 4ft code wrote for this school.
  const { s, ramp } = school(7.5, twoRooms);
  const text = serialize(s);
  assert.ok(!/landing/i.test(text), 'no landing is stored');
  const back = deserialize(text);
  assert.equal(back.links.length, 1, 'not deleted');
  const l = back.links[0];
  assert.deepEqual(
    [l.type, l.from, l.to, l.x, l.z, l.rotationY, l.data],
    [ramp.type, 0, 1, 7.5, 22, Math.PI / 2, { width: 4, slope: 6 }], 'not moved');
  const m = stairMetrics(back);
  assert.ok(near(cutBox(l, m).z1, 77), 'the landing it loads with is 5ft');
  assert.deepEqual(rampLandingFit(back, l).why, ['wall']);
  assert.ok(find(buildReport(back).findings, 'ramp-landing'));
  assert.equal(serialize(back), text, 'and the file is written back byte for byte');
});

test('nothing is built on a straight ramp\'s landing, so the takeoff does not move', () => {
  const { s } = school(8, oneHall);
  const row = takeoff(s).links.find((l) => l.type === 'ramp');
  assert.ok(near(row.area, 4 * 72), 'the sloped deck only');
});
