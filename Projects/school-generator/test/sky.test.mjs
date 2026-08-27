// Where the sun is, and what colour that makes everything. Run `node --test`
// from Projects/school-generator.
//
// The solar half is checked against facts that don't depend on the algorithm:
// the sun is due south at noon in the northern hemisphere and due north at
// noon in the southern one, declination is ~0 at the equinoxes and ±23.4° at
// the solstices, day length at the equator is twelve hours all year and swings
// hard at 60°, and the whole thing is symmetric about solar noon. Those are
// the properties a wrong sign or a swapped argument breaks first.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ENV, LIGHT_MODES, MAX_LAT, HORIZON_DIP, LIGHTS_ON_ALT,
  normalizeEnv, defaultEnv, isDefaultEnv, dayOfYear, daysInMonth,
  declination, equationOfTime, solarPosition, sunVector, starVisibility, moonState, sunTimes,
  skyPalette, skyPhase, skyState, mixHex, formatClock, formatDate, formatLat,
  presetMinutes, SUN_PRESETS, lightsBurn, lightLevel,
} from '../js/sky.js';

const at = (over) => ({ ...DEFAULT_ENV, ...over });
const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// ---------- the record ----------

test('an environment survives anything a file can hand it', () => {
  const e = normalizeEnv({ month: 99, day: -4, minutes: 1e9, lat: 800, north: 'x', lights: 'strobe' });
  assert.equal(e.month, 12);
  assert.equal(e.day, 1);
  assert.equal(e.minutes, 1439);
  assert.equal(e.lat, MAX_LAT);
  assert.equal(e.north, 0);
  assert.equal(e.lights, 'auto');
  // Nothing thrown, nothing null: a design cannot fail to have a sky.
  assert.deepEqual(normalizeEnv(null), DEFAULT_ENV);
  assert.deepEqual(normalizeEnv('nonsense'), DEFAULT_ENV);
});

test('a day is clamped to the month it is in', () => {
  assert.equal(normalizeEnv({ month: 2, day: 31 }).day, 29);
  assert.equal(normalizeEnv({ month: 4, day: 31 }).day, 30);
  assert.equal(normalizeEnv({ month: 1, day: 31 }).day, 31);
});

test('a compass bearing wraps rather than clamping', () => {
  assert.equal(normalizeEnv({ north: 370 }).north, 10);
  assert.equal(normalizeEnv({ north: -90 }).north, 270);
  assert.equal(normalizeEnv({ north: 360 }).north, 0);
});

test('the default environment is recognizable as one, which is what keeps v5 files byte-identical', () => {
  assert.ok(isDefaultEnv(defaultEnv()));
  assert.ok(isDefaultEnv(undefined));
  assert.ok(!isDefaultEnv(at({ minutes: 601 })));
  assert.ok(!isDefaultEnv(at({ lights: 'on' })));
  // A fresh default is a copy, not the shared constant — a design editing its
  // own clock must not move every other design's.
  const a = defaultEnv();
  a.minutes = 0;
  assert.equal(DEFAULT_ENV.minutes, 600);
});

test('every light mode is spelled the same way in the list and in the default', () => {
  assert.ok(LIGHT_MODES.includes(DEFAULT_ENV.lights));
  assert.equal(new Set(LIGHT_MODES).size, LIGHT_MODES.length);
});

// ---------- calendar ----------

test('the day of the year runs 1..366 and lands on the known dates', () => {
  assert.equal(dayOfYear(1, 1), 1);
  assert.equal(dayOfYear(12, 31), 366);   // leap-year table, deliberately
  assert.equal(dayOfYear(3, 1), 61);
  assert.equal(daysInMonth(2), 29);
  assert.equal(daysInMonth(11), 30);
});

test('clocks, dates and latitudes read the way a person says them', () => {
  assert.equal(formatClock(0), '12:00 am');
  assert.equal(formatClock(600), '10:00 am');
  assert.equal(formatClock(720), '12:00 pm');
  assert.equal(formatClock(1439), '11:59 pm');
  assert.equal(formatDate(9, 21), 'September 21');
  assert.equal(formatLat(39), '39° N');
  assert.equal(formatLat(-33.9), '34° S');
});

// ---------- solar geometry ----------

test('declination is flat at the equinoxes and extreme at the solstices', () => {
  const deg = (m, d) => declination(dayOfYear(m, d)) * 180 / Math.PI;
  near(deg(3, 21), 0, 1.0, 'March equinox');
  near(deg(9, 21), 0, 1.5, 'September equinox');
  near(deg(6, 21), 23.44, 0.5, 'June solstice');
  near(deg(12, 21), -23.44, 0.5, 'December solstice');
});

test('the equation of time stays inside its known ±16 minute envelope', () => {
  let lo = Infinity, hi = -Infinity;
  for (let n = 1; n <= 366; n++) {
    const e = equationOfTime(n);
    lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  assert.ok(hi > 14 && hi < 17, `max EoT ${hi}`);
  assert.ok(lo < -13 && lo > -16, `min EoT ${lo}`);
});

test('at solar noon the sun is due south up north and due north down south', () => {
  const north = solarPosition(at({ month: 6, day: 21, lat: 45, minutes: Math.round(sunTimes(at({ month: 6, day: 21, lat: 45 })).noon) }));
  near(north.azimuth, 180, 1.5, 'northern noon bears south');
  const south = solarPosition(at({ month: 12, day: 21, lat: -33, minutes: Math.round(sunTimes(at({ month: 12, day: 21, lat: -33 })).noon) }));
  near(south.azimuth, 0, 2.0, 'southern summer noon bears north');
});

test('noon altitude matches the 90 - |lat - declination| identity', () => {
  for (const [m, d, lat] of [[6, 21, 45], [12, 21, 45], [3, 21, 0], [9, 21, -20]]) {
    const env = at({ month: m, day: d, lat });
    const t = sunTimes(env);
    const p = solarPosition({ ...env, minutes: Math.round(t.noon) });
    const dec = declination(dayOfYear(m, d)) * 180 / Math.PI;
    near(p.altitude, 90 - Math.abs(lat - dec), 0.6, `noon altitude at ${lat}° on ${m}/${d}`);
  }
});

test('the morning and the afternoon are mirror images about solar noon', () => {
  const env = at({ month: 5, day: 5, lat: 42 });
  const noon = sunTimes(env).noon;
  for (const off of [30, 90, 180]) {
    const a = solarPosition({ ...env, minutes: Math.round(noon - off) });
    const b = solarPosition({ ...env, minutes: Math.round(noon + off) });
    near(a.altitude, b.altitude, 0.35, `altitude ${off}min either side of noon`);
    near(a.azimuth, 360 - b.azimuth, 1.0, `azimuth ${off}min either side of noon`);
  }
});

test('day length is twelve hours at the equator and swings wildly at 60 degrees', () => {
  const len = (env) => { const t = sunTimes(env); return (t.sunset - t.sunrise) / 60; };
  for (const [m, d] of [[1, 15], [4, 15], [7, 15], [10, 15]]) {
    near(len(at({ month: m, day: d, lat: 0 })), 12.1, 0.25, `equatorial day length ${m}/${d}`);
  }
  assert.ok(len(at({ month: 6, day: 21, lat: 60 })) > 18, 'a midsummer day at 60N is long');
  assert.ok(len(at({ month: 12, day: 21, lat: 60 })) < 6.5, 'a midwinter day at 60N is short');
});

test('sunrise and sunset really are when the sun crosses the horizon', () => {
  const env = at({ month: 8, day: 2, lat: 47 });
  const t = sunTimes(env);
  for (const key of ['sunrise', 'sunset']) {
    near(solarPosition({ ...env, minutes: Math.round(t[key]) }).altitude, HORIZON_DIP, 0.4, key);
  }
  // And the sun is up between them and down outside them.
  assert.ok(solarPosition({ ...env, minutes: Math.round(t.noon) }).altitude > 0);
  assert.ok(solarPosition({ ...env, minutes: Math.round(t.sunrise - 30) }).altitude < 0);
  assert.ok(solarPosition({ ...env, minutes: Math.round(t.sunset + 30) }).altitude < 0);
});

test('every day at every ordinary latitude has a sunrise in it', () => {
  for (const [m, d] of [[6, 21], [12, 21], [3, 21], [9, 21]]) {
    for (const lat of [60, 45, 0, -45, -60]) {
      const t = sunTimes(at({ month: m, day: d, lat }));
      assert.equal(t.polar, null, `${m}/${d} at ${lat}° should not be polar`);
      assert.ok(t.sunrise !== null && t.sunset !== null);
      assert.ok(t.sunset > t.sunrise);
    }
  }
});

test('at the circle itself the answer is "never", not a wrong number', () => {
  // MAX_LAT is the arctic circle, where midsummer already is a polar day once
  // refraction is counted — so both branches are reachable from inside the
  // clamp rather than only past it.
  const summer = sunTimes(at({ month: 6, day: 21, lat: MAX_LAT }));
  assert.equal(summer.polar, 'day');
  assert.equal(summer.sunrise, null);
  assert.equal(summer.sunset, null);
  assert.ok(Number.isFinite(summer.noon), 'solar noon still happens');

  const winter = sunTimes(at({ month: 12, day: 21, lat: -MAX_LAT }));
  assert.equal(winter.polar, 'day', 'the southern midsummer, same thing upside down');

  // And the presets still hand back real, ordered, distinct minutes there —
  // the scrub has to keep working even when there is nothing to mark on it.
  const mins = SUN_PRESETS.map((p) => presetMinutes(p.key, at({ month: 6, day: 21, lat: MAX_LAT })));
  assert.equal(new Set(mins).size, mins.length);
  for (const m of mins) assert.ok(Number.isInteger(m) && m >= 0 && m < 1440);
});

// ---------- the world vector ----------

test('the sun vector points where the compass bearing says it does', () => {
  // Plan north is -Z and plan east is +X, so a bearing of 180 (due south) is
  // +Z and a bearing of 90 (due east) is +X.
  const south = sunVector(30, 180, 0);
  assert.ok(south.z > 0 && Math.abs(south.x) < 1e-9, 'due south is +Z');
  const east = sunVector(0, 90, 0);
  near(east.x, 1, 1e-9, 'due east is +X');
  near(east.z, 0, 1e-9, 'due east has no Z');
  // Always a unit vector, whatever the inputs.
  for (const [alt, az] of [[0, 0], [45, 137], [-20, 300], [89, 12]]) {
    const v = sunVector(alt, az, 40);
    near(Math.hypot(v.x, v.y, v.z), 1, 1e-9, `unit length at ${alt}/${az}`);
  }
});

test('turning the building turns the light on it, not the sky', () => {
  const straight = sunVector(20, 180, 0);
  const turned = sunVector(20, 180, 90);
  // Turning the plan 90 degrees east of north means plan-north now points true
  // east, so plan +X points true south — and the southern sun, which used to
  // be straight down +Z, is now straight down +X.
  assert.ok(turned.x > 0.9 && Math.abs(turned.z) < 1e-9, 'due south lands on +X');
  near(turned.x, straight.z, 1e-9, 'x picks up the old z');
  near(turned.z, -straight.x, 1e-9, 'z picks up the old -x');
  near(turned.y, straight.y, 1e-12, 'altitude is untouched by a compass turn');
});

// ---------- the palette ----------

test('the palette is continuous and always well formed', () => {
  let prev = null;
  for (let alt = -90; alt <= 90; alt += 0.5) {
    const p = skyPalette(alt);
    for (const k of ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'ambient']) {
      assert.ok(/^#[0-9a-f]{6}$/.test(p[k]), `${k} at ${alt}° is not a hex colour: ${p[k]}`);
    }
    for (const k of ['sunIntensity', 'hemiIntensity', 'ambientIntensity', 'fogNear', 'fogFar', 'exposure']) {
      assert.ok(Number.isFinite(p[k]) && p[k] >= 0, `${k} at ${alt}° is ${p[k]}`);
    }
    assert.ok(p.fogFar > p.fogNear, `fog is inside out at ${alt}°`);
    // No step in the ramp: the biggest jump between half-degree samples has to
    // stay small, or a sun-study scrub strobes.
    if (prev) assert.ok(Math.abs(p.sunIntensity - prev.sunIntensity) < 0.12, `sun jumps at ${alt}°`);
    prev = p;
  }
});

test('brightness rises with the sun and night is genuinely dark', () => {
  const day = skyPalette(60), dusk = skyPalette(-3), night = skyPalette(-40);
  assert.ok(day.sunIntensity > dusk.sunIntensity);
  assert.ok(dusk.sunIntensity > night.sunIntensity);
  assert.ok(night.ambientIntensity < day.ambientIntensity);
  assert.ok(night.fogFar < day.fogFar, 'night closes the view in');
  assert.ok(night.exposure > day.exposure, 'and opens the shutter to compensate');
});

test('the day keyframe is the fixed rig this scene shipped with', () => {
  // Phase 2's hard-coded values, to the digit — the guarantee that a default
  // design looks exactly as it did before there was a sun in the model.
  const p = skyPalette(35);
  assert.equal(p.horizon, '#9fc4e0');
  assert.equal(p.sun, '#fff3dd');
  assert.equal(p.sunIntensity, 1.8);
  assert.equal(p.hemiSky, '#bedcf5');
  assert.equal(p.hemiGround, '#8a8474');
  assert.equal(p.hemiIntensity, 1.15);
  assert.equal(p.ambient, '#bfd0e0');
  near(p.ambientIntensity, 0.35, 1e-9, 'ambient');
  assert.equal(p.fogNear, 220);
  assert.equal(p.fogFar, 700);
});

test('mixing two colours stays inside them', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('the phase names line up with the twilight definitions', () => {
  assert.equal(skyPhase(-30), 'Night');
  assert.equal(skyPhase(-10), 'Astronomical twilight');
  assert.equal(skyPhase(-3), 'Civil twilight');
  assert.equal(skyPhase(2), 'Golden hour');
  assert.equal(skyPhase(15), 'Daylight');
  assert.equal(skyPhase(50), 'High sun');
});

// ---------- the building's response ----------

test('the lights come on at dusk and go off in the morning', () => {
  assert.ok(!lightsBurn(40));
  assert.ok(lightsBurn(2));
  assert.ok(lightsBurn(-30));
  // The manual overrides ignore the sun entirely, which is the point of them.
  assert.ok(lightsBurn(80, 'on'));
  assert.ok(!lightsBurn(-80, 'off'));
});

test('the light level is a ramp, not a switch', () => {
  assert.equal(lightLevel(LIGHTS_ON_ALT + 1), 0);
  assert.equal(lightLevel(-20), 1);
  assert.equal(lightLevel(50, 'on'), 1);
  assert.equal(lightLevel(-50, 'off'), 0);
  let prev = 0;
  for (let a = 12; a >= -6; a -= 0.5) {
    const v = lightLevel(a);
    assert.ok(v >= prev - 1e-9, `level should not fall as the sun does (${a}°)`);
    assert.ok(v >= 0 && v <= 1);
    prev = v;
  }
});

// ---------- presets ----------

test('every preset resolves to a distinct minute, in order, at any latitude', () => {
  for (const env of [at({}), at({ lat: -33, month: 1, day: 10 }), at({ lat: 61, month: 11, day: 3 })]) {
    const mins = SUN_PRESETS.map((p) => presetMinutes(p.key, env));
    for (const m of mins) {
      assert.ok(Number.isInteger(m) && m >= 0 && m < 1440, `preset minute out of range: ${m}`);
    }
    // Dawn through dusk is monotonic; night is deliberately allowed to wrap
    // past midnight, so it is checked separately.
    const ordered = mins.slice(0, 6);
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(ordered[i] > ordered[i - 1],
        `presets out of order at lat ${env.lat}: ${JSON.stringify(mins)}`);
    }
  }
});

test('dawn is at dawn and midday is at solar noon', () => {
  const env = at({ month: 4, day: 12, lat: 51 });
  const t = sunTimes(env);
  near(presetMinutes('dawn', env), t.sunrise + 8, 1, 'dawn');
  near(presetMinutes('noon', env), t.noon, 1, 'midday');
  assert.ok(solarPosition({ ...env, minutes: presetMinutes('golden', env) }).altitude < 8);
  assert.ok(solarPosition({ ...env, minutes: presetMinutes('dusk', env) }).altitude < 0);
  assert.ok(solarPosition({ ...env, minutes: presetMinutes('night', env) }).altitude < -6);
});

// ---------- the whole answer ----------

test('skyState hands back one consistent picture', () => {
  const s = skyState(at({ month: 6, day: 21, lat: 45, minutes: 780 }));
  assert.equal(s.env.month, 6);
  assert.ok(s.sun.altitude > 60, 'midsummer lunchtime at 45N is high');
  assert.ok(s.daylight);
  assert.equal(s.lightLevel, 0, 'nothing burns in the middle of a June day');
  near(Math.hypot(s.dir.x, s.dir.y, s.dir.z), 1, 1e-9, 'direction is a unit vector');
  assert.equal(s.phase, 'High sun');

  const night = skyState(at({ month: 12, day: 21, lat: 45, minutes: 60 }));
  assert.ok(!night.daylight);
  assert.equal(night.lightLevel, 1);
  assert.ok(night.dir.y < 0, 'the sun is under the building at 1am');
});

test('the default design is lit exactly the way the fixed rig used to light it', () => {
  const s = skyState(defaultEnv());
  assert.ok(s.daylight);
  assert.equal(s.lightLevel, 0);
  near(s.palette.sunIntensity, 1.8, 0.05, 'sun');
  near(s.palette.hemiIntensity, 1.15, 0.02, 'hemisphere');
  near(s.palette.ambientIntensity, 0.35, 0.01, 'ambient');
});

// ---------- the night sky ----------

test('stars fade in through twilight and are gone by day', () => {
  assert.equal(starVisibility(10), 0);
  assert.equal(starVisibility(0), 0);
  assert.equal(starVisibility(-4), 0);
  assert.ok(starVisibility(-8) > 0 && starVisibility(-8) < 1);
  assert.equal(starVisibility(-12), 1);
  assert.equal(starVisibility(-40), 1);
  // monotonic on the way down
  let prev = -1;
  for (let a = 10; a >= -30; a -= 1) {
    const v = starVisibility(a);
    assert.ok(v >= prev, `star visibility dipped at ${a} deg`);
    prev = v;
  }
});

test('the moon stands opposite the sun and keeps its hours', () => {
  const midnight = { minutes: 0, month: 6, day: 21, lat: 39, north: 0 };
  const sunAt = solarPosition(normalizeEnv(midnight));
  const moon = moonState(midnight);
  assert.ok(Math.abs(moon.altitude + sunAt.altitude) < 1e-9);
  assert.ok(Math.abs(((moon.azimuth - sunAt.azimuth) % 360 + 360) % 360 - 180) < 1e-9);
  // up at midnight, down at noon
  assert.ok(moon.altitude > 0);
  assert.ok(moon.visible);
  const noonMoon = moonState({ ...midnight, minutes: 720 });
  assert.ok(noonMoon.altitude < 0);
  // the direction vector is the anti-solar one
  const sv = sunVector(sunAt.altitude, sunAt.azimuth, 0);
  assert.ok(Math.abs(moon.dir.x + sv.x) < 1e-9);
  assert.ok(Math.abs(moon.dir.y + sv.y) < 1e-9);
  assert.ok(Math.abs(moon.dir.z + sv.z) < 1e-9);
});

test('plan north turns the moon with the rest of the sky', () => {
  const env = { minutes: 0, month: 6, day: 21, lat: 39, north: 90 };
  const m0 = moonState({ ...env, north: 0 });
  const m90 = moonState(env);
  // same altitude, rotated bearing
  assert.ok(Math.abs(m0.altitude - m90.altitude) < 1e-9);
  assert.ok(Math.abs(m0.dir.y - m90.dir.y) < 1e-9);
});

// ---------- moods (Phase 20) ----------

import { MOODS, moodEntry, applyMood } from '../js/sky.js';

test('five moods, each a preset the clock already knows how to reach', () => {
  assert.equal(MOODS.length, 5);
  assert.deepEqual(MOODS.map((m) => m.key), ['morning', 'noon', 'golden', 'dusk', 'night']);
  for (const m of MOODS) {
    assert.ok(SUN_PRESETS.some((p) => p.key === m.preset), `${m.key} hangs off a real preset`);
    assert.ok(LIGHT_MODES.includes(m.lights), `${m.key} settles the lights to a real mode`);
  }
});

test('a mood writes the time and settles the lights, in one click', () => {
  const e = at({ minutes: 300, lights: 'off' });
  const noon = applyMood(e, 'noon');
  assert.equal(noon.minutes, presetMinutes('noon', e));
  assert.equal(noon.lights, 'auto', 'a daylight mood hands the lights back to the sun');
  const night = applyMood(e, 'night');
  assert.equal(night.minutes, presetMinutes('night', e));
  assert.equal(night.lights, 'on', 'night is a lit school, whatever the toggle said');
});

test('a mood never mutates the env it was handed, and survives nonsense', () => {
  const e = at({ minutes: 300 });
  const out = applyMood(e, 'dusk');
  assert.equal(e.minutes, 300, 'the original is untouched');
  assert.notEqual(out.minutes, 300);
  // An unknown mood is the env back, normalized — not a throw, not a null.
  assert.deepEqual(applyMood(e, 'apocalypse'), e);
  assert.deepEqual(applyMood(null, 'noon').month, DEFAULT_ENV.month);
  assert.equal(moodEntry('nope'), null);
});

test('the golden mood lands in golden hour, which is the screenshot the phase is for', () => {
  const g = applyMood(defaultEnv(), 'golden');
  const alt = solarPosition(g).altitude;
  assert.ok(alt > -6 && alt < 10, `golden hour sun sits low: ${alt}°`);
});
