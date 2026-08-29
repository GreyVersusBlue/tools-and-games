// What the sky is doing, and what that costs, as numbers. Run `node --test`
// from Projects/school-generator.
//
// The properties worth holding here are the ones a wrong sign or a shared
// hash lane breaks first: the default weather is byte-free in a save file,
// every consequence is deterministic in (record, seed, hour), rain gets
// quieter by exactly the slab constant the acoustics already own, the
// glazing is the leak around it, and thunder is rare, far, and immovable.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEATHER_KINDS, DEFAULT_WEATHER, WEATHER_MOODS, CLEAR_COVER, OVERCAST_SHADOW,
  RAIN_DB, RAIN_HZ_OPEN, RAIN_HZ_GLASS,
  THUNDER_GAP_MIN, THUNDER_GAP_MAX, THUNDER_DIST_MIN, THUNDER_DIST_MAX, THUNDER_DB,
  normalizeWeather, defaultWeather, isDefaultWeather, applyWeatherMood,
  weatherLabel, weatherHash, weatherState, snowDepth,
  rainSound, glazeSegments, glazeDistance, nextThunder,
} from '../js/weather.js';
import { PATH_SLAB } from '../js/sound.js';
import { SEG_GLASS, OP_WINDOW, addOpening, shapesOf } from '../js/shapes.js';
import { createState } from '../js/grid.js';
import { serialize, deserialize } from '../js/save-load.js';
import { boxRoom } from './build.mjs';

const rain = (over = {}) => normalizeWeather({ kind: 'rain', ...over });

// ---------- the record ----------

test('a weather survives anything a file can hand it', () => {
  const w = normalizeWeather({ kind: 'hail', intensity: 99, wind: -3 });
  assert.equal(w.kind, 'clear');
  assert.equal(w.intensity, 1);
  assert.equal(w.wind, 0);
  // Nothing thrown, nothing null: a design cannot fail to have a weather.
  assert.deepEqual(normalizeWeather(null), DEFAULT_WEATHER);
  assert.deepEqual(normalizeWeather('drizzle'), DEFAULT_WEATHER);
  for (const kind of WEATHER_KINDS) {
    assert.equal(normalizeWeather({ kind }).kind, kind);
  }
});

test('the default weather is recognizable as one, which is what keeps the key out of the file', () => {
  assert.ok(isDefaultWeather(defaultWeather()));
  assert.ok(isDefaultWeather(undefined));
  assert.ok(!isDefaultWeather({ kind: 'rain' }));
  assert.ok(!isDefaultWeather({ wind: 0.9 }));
  // A fresh default is a copy, not the shared constant.
  const a = defaultWeather();
  a.kind = 'snow';
  assert.equal(DEFAULT_WEATHER.kind, 'clear');
});

test('the mood row is three toggles, not three one-way doors', () => {
  assert.equal(WEATHER_MOODS.length, 3);
  const on = applyWeatherMood(defaultWeather(), 'rain');
  assert.equal(on.kind, 'rain');
  // The click never mutates what it was handed.
  const held = { kind: 'clear', intensity: 0.7, wind: 0.35 };
  applyWeatherMood(held, 'snow');
  assert.equal(held.kind, 'clear');
  // Clicking the active kind puts the sky back.
  assert.ok(isDefaultWeather(applyWeatherMood(on, 'rain')));
  // An unknown key changes nothing.
  assert.equal(applyWeatherMood(on, 'sleet').kind, 'rain');
});

test('the label says what the sky is doing', () => {
  assert.equal(weatherLabel(null), 'Clear');
  assert.equal(weatherLabel({ kind: 'overcast' }), 'Overcast');
  assert.match(weatherLabel({ kind: 'rain', intensity: 0.5 }), /^Rain, 50%$/);
  assert.match(weatherLabel({ kind: 'snow' }), /^Snow/);
});

// ---------- the save file ----------

test('a design with no weather writes no key, and one with weather round-trips', () => {
  const plain = createState();
  assert.ok(!('weather' in JSON.parse(serialize(plain))));
  // The default record is the same as no record.
  plain.weather = defaultWeather();
  assert.ok(!('weather' in JSON.parse(serialize(plain))));

  const stormy = createState();
  stormy.weather = { kind: 'snow', intensity: 0.9, wind: 0.6 };
  const back = deserialize(serialize(stormy));
  assert.deepEqual(back.weather, normalizeWeather(stormy.weather));
  // A hostile record loads as a design with no weather, never as one that
  // won't open.
  const loaded = deserialize(JSON.stringify({
    ...JSON.parse(serialize(createState())), weather: { kind: 'locusts', intensity: 'much' },
  }));
  assert.ok(!('weather' in loaded));
});

// ---------- the consequences ----------

test('clear weather is the sky the build has always drawn', () => {
  const s = weatherState(defaultWeather());
  assert.equal(s.cover, CLEAR_COVER);
  assert.equal(s.drift, 1, 'the default deck keeps its Phase 20 drift, wind field or not');
  assert.equal(s.skyDim, 0);
  assert.equal(s.wet, 0);
  assert.equal(s.snow, 0);
  assert.equal(s.fogScale, 1);
  assert.equal(s.fall, null);
  assert.ok(!s.flat);
});

test('every consequence is deterministic in (record, seed, hour)', () => {
  const w = { kind: 'snow', intensity: 0.8, wind: 0.5 };
  assert.deepEqual(weatherState(w, { seed: 7, minutes: 900 }),
    weatherState(w, { seed: 7, minutes: 900 }));
  assert.deepEqual(nextThunder(11, 300), nextThunder(11, 300));
});

test('intensity turns everything up monotonically', () => {
  const lo = weatherState(rain({ intensity: 0.2 }));
  const hi = weatherState(rain({ intensity: 0.9 }));
  assert.ok(hi.cover > lo.cover);
  assert.ok(hi.skyDim > lo.skyDim);
  assert.ok(hi.wet > lo.wet);
  assert.ok(hi.fall.amount > lo.fall.amount);
  assert.ok(hi.fall.speed > lo.fall.speed);
});

test('the wind is visible: drift and slant follow it', () => {
  const calm = weatherState(rain({ wind: 0 }));
  const gale = weatherState(rain({ wind: 1 }));
  assert.ok(gale.drift > calm.drift);
  assert.ok(gale.fall.slant > calm.fall.slant);
});

test('rain falls and snow floats', () => {
  const r = weatherState(rain()).fall;
  const s = weatherState({ kind: 'snow' }).fall;
  assert.ok(r.speed > s.speed * 4, `rain ${r.speed} vs snow ${s.speed}`);
  assert.ok(s.sway > 0 && r.sway === 0);
  assert.equal(r.kind, 'rain');
  assert.equal(s.kind, 'snow');
});

test('a full overcast goes shadowless at the one stated threshold', () => {
  assert.ok(weatherState({ kind: 'overcast', intensity: 1 }).flat);
  assert.ok(weatherState(rain()).skyDim >= OVERCAST_SHADOW);
  assert.ok(!weatherState(defaultWeather()).flat);
});

test('snow deepens with the clock and differs by seed, deterministically', () => {
  const morning = snowDepth(5, 8 * 60);
  const evening = snowDepth(5, 20 * 60);
  assert.ok(evening > morning, 'scrubbing the hour forward deepens the snow');
  assert.equal(snowDepth(5, 600), snowDepth(5, 600));
  // Two seeds are two storms — somewhere in the seed space they differ.
  const depths = new Set();
  for (let seed = 1; seed <= 8; seed++) depths.add(snowDepth(seed, 600).toFixed(4));
  assert.ok(depths.size > 1);
  // ...and both live in the blend's range whatever the inputs.
  for (const d of [snowDepth(1, 0, 0.05), snowDepth(99, 1439, 1), snowDepth(3, NaN)]) {
    assert.ok(d >= 0 && d <= 1);
  }
});

test('the hash lanes are independent and bounded', () => {
  for (let lane = 0; lane < 50; lane++) {
    const v = weatherHash(42, lane);
    assert.ok(v >= 0 && v < 1);
  }
  assert.notEqual(weatherHash(42, 1), weatherHash(42, 2));
  assert.notEqual(weatherHash(42, 1), weatherHash(43, 1));
});

// ---------- what the rain sounds like ----------

test('only rain makes rain noise', () => {
  assert.equal(rainSound({ kind: 'clear' }, { outside: true }), null);
  assert.equal(rainSound({ kind: 'snow' }, { outside: true }), null);
  assert.ok(rainSound(rain(), { outside: true }));
});

test('rain is loudest in the open, then the top storey, then each storey down', () => {
  const w = rain({ intensity: 1 });
  const open = rainSound(w, { outside: true });
  const top = rainSound(w, { slabsAbove: 1 });
  const mid = rainSound(w, { slabsAbove: 2 });
  const low = rainSound(w, { slabsAbove: 3 });
  assert.equal(open.db, RAIN_DB);
  assert.equal(open.hz, RAIN_HZ_OPEN);
  assert.ok(open.db > top.db && top.db > mid.db && mid.db > low.db);
  // The first slab is the cross-slab constant the acoustics already own...
  assert.equal(open.db - top.db, PATH_SLAB.db);
  // ...and each further slab costs less than the one before — the flanking
  // paths that let sound around one slab let it around three of them too.
  assert.ok(mid.db - low.db <= top.db - mid.db);
  // A slab keeps the thump and eats the hiss.
  assert.equal(top.hz, PATH_SLAB.hz);
});

test('the glazing is the leak around the slab', () => {
  const w = rain({ intensity: 1 });
  const deep = rainSound(w, { slabsAbove: 3, glazeDist: Infinity });
  const seat = rainSound(w, { slabsAbove: 3, glazeDist: 4 });
  const aisle = rainSound(w, { slabsAbove: 3, glazeDist: 40 });
  assert.ok(seat.db > deep.db, 'a window seat hears the weather');
  assert.ok(seat.db > aisle.db, 'walking away from the glass loses it');
  // Glass keeps the patter's brightness; the slab does not.
  assert.equal(seat.hz, RAIN_HZ_GLASS);
  assert.ok(RAIN_HZ_GLASS > PATH_SLAB.hz);
  // On the top storey the roof wins over distant glazing — rain loudest on
  // the top storey is the phase's own promise.
  const roof = rainSound(w, { slabsAbove: 1, glazeDist: 40 });
  assert.equal(roof.hz, PATH_SLAB.hz);
});

test('quieter rain is quieter everywhere', () => {
  const soft = rainSound(rain({ intensity: 0.2 }), { slabsAbove: 1 });
  const hard = rainSound(rain({ intensity: 1 }), { slabsAbove: 1 });
  assert.ok(hard.db > soft.db);
});

// ---------- the glazing, read off a storey ----------

test('exterior glass is found and interior glass is not', () => {
  const state = createState();
  // Two rooms sharing a wall: a window onto the weather counts, a window in
  // the partition is borrowed light and does not.
  boxRoom(state, 0, 2, 2, 7, 7);
  boxRoom(state, 0, 8, 2, 13, 7);
  assert.equal(glazeSegments(state, 0).length, 0, 'no glass yet');

  // A window in every wall of both rooms. The two rooms were baked
  // separately, so each of them built the shared boundary and each side of
  // it takes a window — and both of those are interior: glass onto another
  // room is borrowed light however the boundary is written down.
  let placed = 0;
  for (const shape of shapesOf(state.floors[0])) {
    for (let seg = 0; seg < shape.rings[0].pts.length; seg++) {
      if (addOpening(shape, 0, seg, 0.5, 6, { k: OP_WINDOW })) placed++;
    }
  }
  assert.equal(placed, 8, 'every wall of both rooms holds one');
  const segs = glazeSegments(state, 0);
  assert.equal(segs.length, 6, 'the partition windows are borrowed light');
  for (const s of segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    assert.ok(Math.abs(len - 6) < 0.1, `a window's span is the window's width, got ${len}`);
  }

  // A curtain wall counts for its whole length.
  const state2 = createState();
  boxRoom(state2, 0, 2, 2, 7, 7);
  const [room2] = shapesOf(state2.floors[0]);
  room2.rings[0].walls[0] = SEG_GLASS;
  const walls = glazeSegments(state2, 0);
  assert.equal(walls.length, 1);
  const len = Math.hypot(walls[0].bx - walls[0].ax, walls[0].bz - walls[0].az);
  assert.ok(len > 15, `a curtain wall glazes its whole run, got ${len}`);

  // No storey, no glass, no throw.
  assert.deepEqual(glazeSegments(null, 0), []);
  assert.deepEqual(glazeSegments(state, 9), []);
});

test('glaze distance is a point-to-segment distance with an honest Infinity', () => {
  const segs = [{ ax: 0, az: 0, bx: 10, bz: 0 }];
  assert.equal(glazeDistance(segs, 5, 3), 3);
  assert.equal(glazeDistance(segs, -4, 0), 4);
  assert.equal(glazeDistance([], 5, 5), Infinity);
  assert.equal(glazeDistance(null, 5, 5), Infinity);
});

// ---------- thunder ----------

test('thunder is rare, far, and immovable', () => {
  // Immovable: the schedule is a fact about the seed, however you ask it.
  const first = nextThunder(9, 0);
  assert.deepEqual(nextThunder(9, first.at - 1), first);
  // Rare: count the strikes in ten minutes.
  let t = 0, strikes = 0;
  while (t < 600) {
    const s = nextThunder(9, t);
    t = s.at;
    if (t < 600) strikes++;
    // Far: every strike is beyond the stated minimum, so what arrives is a
    // rumble, never a crack.
    assert.ok(s.dist >= THUNDER_DIST_MIN && s.dist <= THUNDER_DIST_MAX);
    assert.ok(s.db < THUNDER_DB - 50, 'distance has taken its toll');
    assert.ok(s.pan >= -1 && s.pan <= 1);
  }
  assert.ok(strikes >= 1 && strikes <= 12, `${strikes} strikes in ten minutes`);
  // Strictly later, always — a schedule that can answer "now" twice loops.
  const a = nextThunder(9, 100);
  assert.ok(nextThunder(9, a.at).at > a.at);
  // A gentler storm spreads its strikes further apart on average.
  const count = (intensity) => {
    let tt = 0, n = 0;
    while (tt < 3600) { tt = nextThunder(21, tt, intensity).at; n++; }
    return n;
  };
  assert.ok(count(1) >= count(0.1));
  // The gap constants hold for every consecutive pair at full intensity.
  let prev = nextThunder(5, 0, 1);
  for (let k = 0; k < 10; k++) {
    const next = nextThunder(5, prev.at, 1);
    const gap = next.at - prev.at;
    assert.ok(gap >= THUNDER_GAP_MIN * 0.79 && gap <= THUNDER_GAP_MAX * 1.01,
      `gap ${gap}s`);
    prev = next;
  }
});
