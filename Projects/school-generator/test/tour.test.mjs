// Guided tours: the record, the clock and the curve. Most of this suite is
// about the one promise a recorded path has to keep — that the camera
// actually goes through the stops you put it at, at the times the timeline
// says — plus the angle arithmetic, which is where every playback engine
// eventually turns the long way round.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_TOURS, MAX_KEYS, MIN_SEC, MAX_SEC, MAX_HOLD, TOUR_SPEED, MAX_PITCH, EASES,
  wrapAngle, shortestArc, lerpAngle, easeInOut, applyEase,
  makeKey, makeTour, normalizeTour, normalizeTours, toursOf,
  legDistance, defaultSeconds, addKey, removeKey, updateKey, moveKey, retime,
  timeline, tourDuration, tourSummary, sampleTour, samplePath,
  startPlayback, stepPlayback,
} from '../js/tour.js';

const cam = (x, z, opts = {}) => ({ x, y: 5.5, z, yaw: 0, pitch: 0, ...opts });

function walk(stops, opts = {}) {
  let tour = makeTour('Test');
  for (const s of stops) tour = addKey(tour, s, opts);
  return tour;
}

// ---------- angles ----------

test('angles wrap into a half-turn either side of zero', () => {
  assert.equal(wrapAngle(0), 0);
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-Math.PI * 3) + Math.PI) < 1e-9);
  assert.ok(wrapAngle(Math.PI * 2 - 0.1) < 0);
  assert.equal(wrapAngle(NaN), 0);
});

test('the short way round is taken across the seam', () => {
  const a = 170 * Math.PI / 180, b = -170 * Math.PI / 180;
  const arc = shortestArc(a, b);
  assert.ok(Math.abs(arc) < Math.PI, 'twenty degrees, not three hundred and forty');
  assert.ok(Math.abs(Math.abs(arc) - 20 * Math.PI / 180) < 1e-9);
  // ...and halfway across it is on the seam, not back at zero.
  const mid = lerpAngle(a, b, 0.5);
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 1e-6, `got ${mid}`);
});

test('easing starts and ends still, and passes through the middle', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.equal(easeInOut(-3), 0);
  assert.equal(easeInOut(7), 1);
  // The first tenth covers less ground than the middle tenth.
  assert.ok(easeInOut(0.1) < 0.1);
  assert.ok(easeInOut(0.55) - easeInOut(0.45) > 0.1);
  assert.equal(applyEase('linear', 0.25), 0.25);
  assert.equal(applyEase('smooth', 0.5), 0.5);
  for (const e of EASES) assert.ok(Number.isFinite(applyEase(e, 0.3)));
});

// ---------- records ----------

test('a key clamps everything a camera can hand it', () => {
  const k = makeKey({ x: 1, y: 2, z: 3, yaw: 99, pitch: 9, floor: -4 }, { sec: 999, hold: 999, ease: 'nope' });
  assert.ok(Math.abs(k.yaw) <= Math.PI);
  assert.ok(Math.abs(k.pitch) <= MAX_PITCH);
  assert.equal(k.floor, 0);
  assert.equal(k.sec, MAX_SEC);
  assert.equal(k.hold, MAX_HOLD);
  assert.equal(k.ease, 'smooth');
  const bare = makeKey({});
  assert.equal(bare.x, 0);
  assert.equal(bare.sec, 2);
});

test('an unreadable tour is a tour that is not there', () => {
  assert.equal(normalizeTour(null), null);
  assert.equal(normalizeTour({}), null);
  assert.equal(normalizeTour({ keys: [] }), null);
  assert.equal(normalizeTour({ keys: ['nope', null] }), null);
  const t = normalizeTour({ name: 'X', loop: 1, keys: [{ x: 1 }], id: 7 });
  assert.equal(t.name, 'X');
  assert.equal(t.loop, true);
  assert.equal(t.id, 7);
});

test('the tour list is capped and filtered', () => {
  const many = [];
  for (let i = 0; i < MAX_TOURS + 6; i++) many.push({ keys: [{ x: i }] });
  assert.equal(normalizeTours(many).length, MAX_TOURS);
  assert.deepEqual(normalizeTours([null, {}, 'x']), []);
  assert.deepEqual(normalizeTours('nope'), []);
  assert.deepEqual(toursOf({}), []);
  assert.deepEqual(toursOf(null), []);
});

test('a tour holds at most MAX_KEYS stops, dropping the oldest to fit', () => {
  let tour = makeTour('Long');
  for (let i = 0; i < MAX_KEYS + 10; i++) tour = addKey(tour, cam(i, 0));
  assert.equal(tour.keys.length, MAX_KEYS);
  assert.equal(tour.keys[tour.keys.length - 1].x, MAX_KEYS + 9);
});

// ---------- editing ----------

test('a recorded leg is timed from how far it is', () => {
  const tour = walk([cam(0, 0), cam(0, 90)]);
  assert.equal(tour.keys[0].sec, MIN_SEC, 'you are already at the first stop');
  assert.ok(Math.abs(tour.keys[1].sec - 90 / TOUR_SPEED) < 1e-9);
  // Two stops in the same doorway still take a moment.
  const still = walk([cam(0, 0), cam(0, 0)]);
  assert.ok(still.keys[1].sec >= MIN_SEC);
  assert.equal(legDistance(cam(0, 0), cam(3, 4)), 5);
  assert.equal(defaultSeconds(cam(0, 0), cam(0, 900)), MAX_SEC);
});

test('stops can be removed, retimed and reordered with their timings', () => {
  const tour = walk([cam(0, 0), cam(0, 20), cam(0, 40)]);
  assert.equal(removeKey(tour, 1).keys.length, 2);
  assert.equal(removeKey(tour, 9).keys.length, 3);

  const moved = moveKey(tour, 2, -1);
  assert.equal(moved.keys[1].z, 40);
  assert.equal(moved.keys[1].sec, tour.keys[2].sec, 'the timing travels with the stop');
  assert.equal(moveKey(tour, 0, -1), tour, 'off the top is a no-op');
  assert.equal(moveKey(tour, 2, 1), tour, 'off the bottom too');

  const slow = retime(tour, 2);
  assert.ok(slow.keys[2].sec > tour.keys[2].sec);
  assert.equal(slow.keys[0].sec, tour.keys[0].sec, 'the first stop has no leg');
});

test('updating a stop revalidates it', () => {
  const tour = walk([cam(0, 0), cam(0, 20)]);
  const next = updateKey(tour, 1, { hold: 999, label: 'Library' });
  assert.equal(next.keys[1].hold, MAX_HOLD);
  assert.equal(next.keys[1].label, 'Library');
  assert.equal(next.keys[0].hold, 0);
});

// ---------- the clock ----------

test('the timeline is legs plus holds, and the first leg is free', () => {
  let tour = makeTour('T');
  tour = addKey(tour, cam(0, 0), { sec: 5, hold: 2 });
  tour = addKey(tour, cam(0, 10), { sec: 3, hold: 1 });
  const { stops, duration } = timeline(tour);
  assert.equal(stops[0].arrive, 0);
  assert.equal(stops[0].leave, 2);
  assert.equal(stops[1].arrive, 5);
  assert.equal(stops[1].leave, 6);
  assert.equal(duration, 6);
  assert.equal(tourDuration(tour), 6);
});

test('a looping tour pays for the leg home', () => {
  let tour = makeTour('T');
  tour = addKey(tour, cam(0, 0), { sec: 1 });
  tour = addKey(tour, cam(0, 45), { sec: 4 });
  const open = tourDuration(tour);
  const closed = tourDuration({ ...tour, loop: true });
  assert.ok(closed > open);
  assert.ok(Math.abs(closed - open - 45 / TOUR_SPEED) < 1e-9);
});

test('the summary says what the panel shows', () => {
  assert.equal(tourSummary(makeTour('Empty')), 'No stops yet');
  const short = walk([cam(0, 0), cam(0, 18)]);
  assert.match(tourSummary(short), /2 stops · [\d.]+s/);
  assert.match(tourSummary({ ...short, loop: true }), /loops/);
  let long = makeTour('Long');
  for (let i = 0; i < 5; i++) long = addKey(long, cam(0, i * 300));
  assert.match(tourSummary(long), /\dm \d+s/);
  assert.match(tourSummary(walk([cam(0, 0)])), /1 stop ·/);
});

// ---------- the curve ----------

test('the camera passes through every stop, at the time the timeline says', () => {
  const tour = walk([cam(0, 0), cam(30, 0), cam(30, 40), cam(0, 40)]);
  const { stops } = timeline(tour);
  stops.forEach((s, i) => {
    const at = sampleTour(tour, s.arrive);
    assert.ok(Math.abs(at.x - tour.keys[i].x) < 1e-6, `stop ${i} x`);
    assert.ok(Math.abs(at.z - tour.keys[i].z) < 1e-6, `stop ${i} z`);
    assert.equal(at.index, i);
  });
});

test('a hold really holds', () => {
  let tour = makeTour('T');
  tour = addKey(tour, cam(0, 0), { hold: 3 });
  tour = addKey(tour, cam(0, 40), { sec: 4 });
  const a = sampleTour(tour, 0.5), b = sampleTour(tour, 2.9);
  assert.deepEqual([a.x, a.z], [b.x, b.z]);
  assert.ok(a.holding && b.holding);
  assert.ok(!sampleTour(tour, 4).holding);
});

test('the path is continuous — no jump bigger than the step allows', () => {
  const tour = walk([cam(0, 0), cam(30, 0), cam(30, 40), cam(-10, 40), cam(-10, 0)]);
  const duration = tourDuration(tour);
  let prev = sampleTour(tour, 0);
  for (let t = 0.05; t <= duration; t += 0.05) {
    const at = sampleTour(tour, t);
    const step = Math.hypot(at.x - prev.x, at.y - prev.y, at.z - prev.z);
    assert.ok(step < 4, `jumped ${step.toFixed(2)} ft at t=${t.toFixed(2)}`);
    prev = at;
  }
});

test('a straight line of stops stays roughly straight — no spline overshoot', () => {
  const tour = walk([cam(0, 0), cam(20, 0), cam(40, 0), cam(60, 0)]);
  for (let t = 0; t <= tourDuration(tour); t += 0.1) {
    const at = sampleTour(tour, t);
    assert.ok(Math.abs(at.z) < 1e-6, `drifted to z=${at.z}`);
    assert.ok(at.x >= -1e-6 && at.x <= 60 + 1e-6, `ran to x=${at.x}`);
  }
});

test('the ends of an open tour move at the same sort of speed as the middle', () => {
  const tour = walk([cam(0, 0), cam(40, 0), cam(80, 0), cam(120, 0)]);
  const { stops } = timeline(tour);
  // Distance covered in the half-second after leaving the first stop, against
  // the same after leaving the second: a duplicated endpoint would make the
  // first leg crawl.
  const legSpeed = (i) => {
    const a = sampleTour(tour, stops[i].leave + 0.4);
    const b = sampleTour(tour, stops[i].leave + 0.9);
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  const first = legSpeed(0), second = legSpeed(1);
  assert.ok(first > second * 0.4, `first leg ${first} vs middle ${second}`);
});

test('a tour turning across the seam turns the short way', () => {
  let tour = makeTour('T');
  tour = addKey(tour, cam(0, 0, { yaw: 3.0 }), { sec: 1 });
  tour = addKey(tour, cam(0, 10, { yaw: -3.0 }), { sec: 2 });
  const { stops } = timeline(tour);
  const mid = sampleTour(tour, stops[1].arrive - 1);
  assert.ok(Math.abs(mid.yaw) > 3.0, `yaw went round the houses: ${mid.yaw}`);
});

test('pitch is clamped even if two stops disagree wildly', () => {
  let tour = makeTour('T');
  tour = addKey(tour, cam(0, 0, { pitch: MAX_PITCH }), { sec: 1 });
  tour = addKey(tour, cam(0, 10, { pitch: -MAX_PITCH }), { sec: 2 });
  for (let t = 0; t <= tourDuration(tour); t += 0.1) {
    assert.ok(Math.abs(sampleTour(tour, t).pitch) <= MAX_PITCH + 1e-9);
  }
});

test('the storey flips at the halfway point rather than easing through 1.5', () => {
  let tour = makeTour('T');
  tour = addKey(tour, cam(0, 0, { floor: 0 }), { sec: 1 });
  tour = addKey(tour, cam(0, 10, { floor: 2 }), { sec: 4 });
  const { stops } = timeline(tour);
  assert.equal(sampleTour(tour, stops[1].arrive - 3).floor, 0);
  assert.equal(sampleTour(tour, stops[1].arrive - 1).floor, 2);
});

test('a one-stop tour is a still photograph', () => {
  const tour = walk([cam(7, 9)]);
  const at = sampleTour(tour, 3);
  assert.equal(at.x, 7);
  assert.ok(at.holding);
  assert.equal(sampleTour(makeTour('none'), 1), null);
});

test('time outside the tour is clamped, and a loop wraps instead', () => {
  const tour = walk([cam(0, 0), cam(0, 40)]);
  const end = sampleTour(tour, 9999);
  assert.ok(end.done);
  assert.ok(Math.abs(end.z - 40) < 1e-6);
  assert.ok(Math.abs(sampleTour(tour, -50).z) < 1e-6);

  const looped = { ...tour, loop: true };
  const d = tourDuration(looped);
  const a = sampleTour(looped, 0.5), b = sampleTour(looped, d + 0.5);
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6);
  assert.ok(!b.done, 'a loop is never done');
});

test('a sampled path is a bounded list of points along the way', () => {
  const tour = walk([cam(0, 0), cam(40, 0), cam(40, 40)]);
  const path = samplePath(tour, 0.25);
  assert.ok(path.length > 4);
  assert.ok(path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
  let long = makeTour('Long');
  for (let i = 0; i < 20; i++) long = addKey(long, cam(0, i * 400));
  assert.ok(samplePath(long, 0.02, 100).length <= 100);
});

// ---------- playback ----------

test('playback advances at its rate and stops itself at the end', () => {
  const tour = walk([cam(0, 0), cam(0, 90)]);
  let play = startPlayback(tour);
  assert.ok(play.playing);
  play = stepPlayback(play, 1);
  assert.ok(Math.abs(play.t - 1) < 1e-9);

  let fast = startPlayback(tour, { rate: 4 });
  fast = stepPlayback(fast, 1);
  assert.ok(Math.abs(fast.t - 4) < 1e-9);

  let run = startPlayback(tour);
  for (let i = 0; i < 200 && run.playing; i++) run = stepPlayback(run, 0.5);
  assert.ok(!run.playing);
  assert.equal(run.t, run.duration);
  assert.equal(stepPlayback(run, 1).t, run.duration, 'a stopped clock stays stopped');
  assert.equal(stepPlayback(null, 1), null);
});

test('a looping playback never stops', () => {
  const tour = { ...walk([cam(0, 0), cam(0, 40)]), loop: true };
  let play = startPlayback(tour);
  for (let i = 0; i < 100; i++) play = stepPlayback(play, 0.5);
  assert.ok(play.playing);
  assert.ok(sampleTour(tour, play.t));
});

test('a playback rate is clamped to something watchable', () => {
  const tour = walk([cam(0, 0), cam(0, 40)]);
  assert.equal(startPlayback(tour, { rate: 99 }).rate, 8);
  assert.equal(startPlayback(tour, { rate: 0 }).rate, 0.1);
});
