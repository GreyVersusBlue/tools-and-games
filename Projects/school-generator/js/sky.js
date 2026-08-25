// sky.js — where the sun is, and what colour that makes everything.
//
// Phase 3 wants a building lit by a *time of day* rather than by a fixed
// three-light rig. The obvious way to do that is a slider that swings a
// directional light around; the honest way is to work out where the sun
// actually is on a given date, at a given latitude, at a given hour, and put
// the light there. The second costs about eighty lines of astronomy and buys
// something the first can't fake: the sun tracks *low and south* in January
// and *high and long* in June, sunrise moves through the year, and a window
// facing the wrong way genuinely never sees direct light. Phase 7 will want to
// ask exactly those questions ("does this classroom get morning sun?"), so the
// number underneath it had better be real.
//
// So this module is two halves that never touch each other:
//
//   1. Solar geometry. Spencer's series for declination and the equation of
//      time, the standard hour-angle altitude/azimuth pair, and the sunrise /
//      sunset roots of the same equation. All of it in plain radians, none of
//      it aware that a renderer exists.
//   2. A palette keyed on the sun's *altitude* — not on the clock. Altitude is
//      what the sky actually responds to, which is why one table serves a
//      December afternoon in Oslo and a June morning in Quito without either
//      being a special case. Night, the three twilights, golden hour and full
//      day are keyframes; everything between them is a lerp.
//
// The clock is local standard time at the design's own meridian — there is no
// longitude and no timezone field, because a school doesn't have one until
// somebody says so, and "10am where this building is" is the only reading of
// the number anyone wants. The equation of time is still applied, so solar
// noon lands where it really does (up to ±16 minutes off 12:00, drifting
// through the year) rather than at 12:00 by fiat.
//
// Pure module: no three.js, no imports at all. Exercised by test/sky.test.mjs.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MIN_PER_DAY = 1440;

// ---------- the environment record ----------
//
// One small object on the state, all of it optional, every field defaulting to
// what the pre-Phase-3 scene already drew: a bright mid-morning near the
// equinox at a mid-northern latitude, which is the light the fixed rig was
// eyeballed to imitate. So a v5 design loads into v6 and looks unchanged.

export const DEFAULT_ENV = {
  month: 9,        // 1-12
  day: 21,         // 1-31, clamped to the month's length
  minutes: 600,    // 0-1439, local standard time — 10:00
  lat: 39,         // degrees north, negative south
  north: 0,        // degrees the plan's "up" (-Z) sits east of true north
  lights: 'auto',  // 'auto' | 'on' | 'off' — do the building's own lights burn
};

// How the interior lights behave. 'auto' is the interesting one: the fixtures
// come on as the sun goes down, which is the whole point of having modelled
// where the sun is.
export const LIGHT_MODES = ['auto', 'on', 'off'];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const clampNum = (v, dflt, lo, hi) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};

// Latitude is clamped to the polar circles. Past them the sun stops rising or
// setting for months at a time; `sunTimes` answers that honestly (`polar` is
// 'day' or 'night' and there is no sunrise to report) and the presets fall
// back to even divisions of the clock, but a scrub with no sunrise marker on
// it is a worse tool than one that declines to go there. 66° is the circle
// itself, which is far enough north for any school and close enough to it that
// midsummer *is* already a polar day once refraction is counted — so both
// branches below are reachable from inside the clamp, not only past it.
export const MAX_LAT = 66;

// Any candidate environment out of a save file, a preset or a slider, made
// canonical. Never throws and never returns null: an environment is not
// something a design can fail to have.
export function normalizeEnv(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const month = Math.round(clampNum(src.month, DEFAULT_ENV.month, 1, 12));
  const day = Math.round(clampNum(src.day, DEFAULT_ENV.day, 1, DAYS_IN_MONTH[month - 1]));
  return {
    month,
    day,
    minutes: Math.round(clampNum(src.minutes, DEFAULT_ENV.minutes, 0, MIN_PER_DAY - 1)),
    lat: clampNum(src.lat, DEFAULT_ENV.lat, -MAX_LAT, MAX_LAT),
    // A bearing wraps rather than clamps — 370° is 10°, not 360°.
    north: ((clampNum(src.north, 0, -3600, 3600) % 360) + 360) % 360,
    lights: LIGHT_MODES.includes(src.lights) ? src.lights : DEFAULT_ENV.lights,
  };
}

export const defaultEnv = () => ({ ...DEFAULT_ENV });

// True when this environment is the default one in every field — which is what
// lets the save layer leave `env` out of a file entirely rather than writing a
// block of numbers nobody changed. (Same trick `writeOpening` plays in v5.)
export const isDefaultEnv = (env) => {
  const e = normalizeEnv(env);
  return Object.keys(DEFAULT_ENV).every((k) => e[k] === DEFAULT_ENV[k]);
};

// ---------- calendar ----------

export function dayOfYear(month, day) {
  const m = Math.min(12, Math.max(1, Math.round(month || 1)));
  const d = Math.min(DAYS_IN_MONTH[m - 1], Math.max(1, Math.round(day || 1)));
  let n = d;
  for (let i = 0; i < m - 1; i++) n += DAYS_IN_MONTH[i];
  return n;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const daysInMonth = (month) =>
  DAYS_IN_MONTH[Math.min(12, Math.max(1, Math.round(month || 1))) - 1];

// 0-1439 as a wall clock. Rounds to the minute — the scrub is minute-grained
// and a readout that says 10:00:37 is noise.
export function formatClock(minutes) {
  const m = ((Math.round(minutes) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

export const formatDate = (month, day) =>
  `${MONTH_NAMES[Math.min(12, Math.max(1, Math.round(month))) - 1]} ${Math.round(day)}`;

// A latitude as a person would say it. The sign is a hemisphere, not a minus.
export const formatLat = (lat) =>
  `${Math.abs(lat).toFixed(0)}° ${lat < 0 ? 'S' : 'N'}`;

// ---------- solar geometry ----------
//
// Spencer (1971), "Fourier series representation of the position of the sun".
// Both series take the same fractional-year angle and are good to a hundredth
// of a degree / a fraction of a minute — far past anything a sun study on a
// school needs, and cheap enough to call every frame of a scrub.

const yearAngle = (n) => (2 * Math.PI * (n - 1)) / 365;

// Solar declination in radians: how far north or south of the equator the sun
// stands at noon. ±23.44° at the solstices, ~0 at the equinoxes.
export function declination(dayNum) {
  const b = yearAngle(dayNum);
  return 0.006918
    - 0.399912 * Math.cos(b) + 0.070257 * Math.sin(b)
    - 0.006758 * Math.cos(2 * b) + 0.000907 * Math.sin(2 * b)
    - 0.002697 * Math.cos(3 * b) + 0.001480 * Math.sin(3 * b);
}

// Minutes by which real solar time runs ahead of clock time. This is the wobble
// that puts solar noon at 11:44 in February and 12:14 in November, and it is
// the reason the sunrise marker on the scrub drifts through the year instead of
// sitting still.
export function equationOfTime(dayNum) {
  const b = yearAngle(dayNum);
  return 229.18 * (0.000075
    + 0.001868 * Math.cos(b) - 0.032077 * Math.sin(b)
    - 0.014615 * Math.cos(2 * b) - 0.040849 * Math.sin(2 * b));
}

// The hour angle: 0 at solar noon, negative all morning, +15° per hour after.
export const hourAngle = (minutes, eot) =>
  ((minutes + eot) / 60 - 12) * 15 * RAD;

// Where the sun is, seen from here. `altitude` is degrees above the horizon —
// negative when it has set. `azimuth` is a compass bearing in degrees: 0 north,
// 90 east, 180 south, 270 west.
export function solarPosition(env) {
  const e = normalizeEnv(env);
  const n = dayOfYear(e.month, e.day);
  const dec = declination(n);
  const lat = e.lat * RAD;
  const h = hourAngle(e.minutes, equationOfTime(n));

  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const alt = Math.asin(Math.min(1, Math.max(-1, sinAlt)));
  // atan2 form, so the answer is continuous through noon and through north
  // instead of needing a morning/afternoon branch.
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(h),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(h),
  );
  return {
    altitude: alt * DEG,
    azimuth: ((az * DEG) % 360 + 360) % 360,
    declination: dec * DEG,
  };
}

// The direction *toward* the sun, in world feet, as a unit vector.
//
// The plan's own north is -Z (the top of the sheet, the way every floor plan
// is drawn) and its east is +X. `north` turns the whole building against true
// north, so it is subtracted from the compass bearing rather than added to the
// scene: rotating the building 90° puts the morning sun through the wall that
// used to face south, which is the entire point of the control.
export function sunVector(altitudeDeg, azimuthDeg, north = 0) {
  const a = altitudeDeg * RAD;
  const b = (azimuthDeg - north) * RAD;
  const c = Math.cos(a);
  return { x: c * Math.sin(b), y: Math.sin(a), z: -c * Math.cos(b) };
}

// Sunrise and sunset as minutes past local midnight, or null where the sun
// doesn't cross the horizon that day (a polar summer or winter — rare inside
// MAX_LAT, but December above 60° gets close enough to matter).
//
// -0.833° rather than 0 is the standard correction: half a degree of solar
// disc plus about a third of a degree of atmospheric refraction, which is why
// the sun is already visible when it is geometrically still below the horizon.
export const HORIZON_DIP = -0.833;

export function sunTimes(env) {
  const e = normalizeEnv(env);
  const n = dayOfYear(e.month, e.day);
  const dec = declination(n);
  const lat = e.lat * RAD;
  const eot = equationOfTime(n);
  const noon = 720 - eot;   // clock minutes at which the sun crosses the meridian

  const cosH = (Math.cos((90 - HORIZON_DIP) * RAD) - Math.sin(lat) * Math.sin(dec)) /
    (Math.cos(lat) * Math.cos(dec));
  if (cosH > 1) return { sunrise: null, sunset: null, noon, polar: 'night' };
  if (cosH < -1) return { sunrise: null, sunset: null, noon, polar: 'day' };
  const half = Math.acos(cosH) * DEG * 4;   // 4 clock minutes per degree of hour angle
  return { sunrise: noon - half, sunset: noon + half, noon, polar: null };
}

// ---------- times of day worth jumping to ----------
//
// A preset can't be a fixed clock time: 6pm is golden hour in one place and the
// middle of the night in another. So each one is defined against the day's own
// sun events and resolved per date and latitude, which is what makes "Dusk"
// mean dusk in Reykjavik in June as well as in Atlanta in March.
export const SUN_PRESETS = [
  { key: 'dawn', label: 'Dawn', icon: '🌅' },
  { key: 'morning', label: 'Morning', icon: '🏫' },
  { key: 'noon', label: 'Midday', icon: '☀️' },
  { key: 'afternoon', label: 'Afternoon', icon: '🌤' },
  { key: 'golden', label: 'Golden hour', icon: '🌇' },
  { key: 'dusk', label: 'Dusk', icon: '🌆' },
  { key: 'night', label: 'Night', icon: '🌙' },
];

export function presetMinutes(key, env) {
  const t = sunTimes(env);
  const wrap = (m) => ((Math.round(m) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  // Polar day or night has no sunrise to hang these off, so they fall back to
  // even divisions of the clock around solar noon — still ordered, still
  // distinct, just no longer claiming to be dawn.
  if (t.sunrise === null || t.sunset === null) {
    const off = { dawn: -6, morning: -3, noon: 0, afternoon: 3, golden: 5, dusk: 6, night: 10 };
    return wrap(t.noon + (off[key] ?? 0) * 60);
  }
  const dayLen = t.sunset - t.sunrise;
  switch (key) {
    case 'dawn': return wrap(t.sunrise + 8);
    case 'morning': return wrap(t.sunrise + dayLen * 0.25);
    case 'noon': return wrap(t.noon);
    case 'afternoon': return wrap(t.sunset - dayLen * 0.25);
    case 'golden': return wrap(t.sunset - 35);
    case 'dusk': return wrap(t.sunset + 12);
    case 'night': return wrap(t.sunset + 150);
    default: return wrap(t.noon);
  }
}

// ---------- the palette ----------
//
// Keyed on altitude, because that is what the sky answers to. The `day`
// keyframe is deliberately the exact fixed rig this scene shipped with through
// Phase 2 — same sky blue, same hemisphere and ambient levels, same warm sun —
// so a design opened at its default mid-morning looks like it always did, and
// everything below the top of the table is new territory rather than a
// re-tuning of old ground.
//
//   sun*      the directional light: colour and intensity
//   hemi*     the sky/ground hemisphere fill
//   amb*      the flat ambient floor, which is all an interior has at night
//   zenith    the top of the sky dome
//   horizon   its bottom, and the fog colour with it
//   fogNear/Far   how far you can see; night closes in
//   exposure  tone mapping, nudged up after dark so interiors stay readable

const KEYS = [
  {
    alt: -90,
    zenith: '#04060d', horizon: '#0a1018',
    sun: '#7f8db4', sunI: 0.06,
    hemiSky: '#101a30', hemiGround: '#08090c', hemiI: 0.20,
    amb: '#18202f', ambI: 0.16,
    fogNear: 60, fogFar: 320, exposure: 1.34,
  },
  {
    alt: -12,
    zenith: '#101c36', horizon: '#3a3550',
    sun: '#8f7fa8', sunI: 0.10,
    hemiSky: '#22304f', hemiGround: '#12141c', hemiI: 0.38,
    amb: '#232c40', ambI: 0.22,
    fogNear: 90, fogFar: 420, exposure: 1.30,
  },
  {
    alt: -4,
    zenith: '#2b4a7a', horizon: '#c07a58',
    sun: '#ff9a5e', sunI: 0.30,
    hemiSky: '#3f5a86', hemiGround: '#2a2620', hemiI: 0.62,
    amb: '#39445c', ambI: 0.28,
    fogNear: 140, fogFar: 520, exposure: 1.22,
  },
  {
    alt: 3,
    zenith: '#4d7cb4', horizon: '#f0b184',
    sun: '#ffc186', sunI: 1.30,
    hemiSky: '#7da0c8', hemiGround: '#6b5f4c', hemiI: 0.88,
    amb: '#8496ac', ambI: 0.30,
    fogNear: 180, fogFar: 600, exposure: 1.12,
  },
  {
    alt: 12,
    zenith: '#79aad9', horizon: '#c9d9ea',
    sun: '#ffe6c2', sunI: 1.62,
    hemiSky: '#a9c8ee', hemiGround: '#8a8474', hemiI: 1.05,
    amb: '#b0c2d4', ambI: 0.33,
    fogNear: 205, fogFar: 660, exposure: 1.08,
  },
  {
    // Full day: the fixed rig this scene has always used, to the digit.
    alt: 35,
    zenith: '#7fb0e0', horizon: '#9fc4e0',
    sun: '#fff3dd', sunI: 1.80,
    hemiSky: '#bedcf5', hemiGround: '#8a8474', hemiI: 1.15,
    amb: '#bfd0e0', ambI: 0.35,
    fogNear: 220, fogFar: 700, exposure: 1.05,
  },
  {
    alt: 90,
    zenith: '#6ea6df', horizon: '#a8cbe6',
    sun: '#fffaf0', sunI: 1.95,
    hemiSky: '#c6e2f8', hemiGround: '#918b7a', hemiI: 1.20,
    amb: '#c6d6e4', ambI: 0.36,
    fogNear: 230, fogFar: 740, exposure: 1.02,
  },
];

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v)))
    .toString(16).padStart(2, '0')).join('');

export function mixHex(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

const lerp = (a, b, t) => a + (b - a) * t;

// The sky, the sun and the fill light at a given solar altitude.
export function skyPalette(altitudeDeg) {
  const alt = Math.min(90, Math.max(-90, Number.isFinite(altitudeDeg) ? altitudeDeg : 0));
  let i = 0;
  while (i < KEYS.length - 2 && alt > KEYS[i + 1].alt) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = b.alt === a.alt ? 0 : Math.min(1, Math.max(0, (alt - a.alt) / (b.alt - a.alt)));
  return {
    zenith: mixHex(a.zenith, b.zenith, t),
    horizon: mixHex(a.horizon, b.horizon, t),
    sun: mixHex(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunI, b.sunI, t),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, t),
    hemiGround: mixHex(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiI, b.hemiI, t),
    ambient: mixHex(a.amb, b.amb, t),
    ambientIntensity: lerp(a.ambI, b.ambI, t),
    fogNear: lerp(a.fogNear, b.fogNear, t),
    fogFar: lerp(a.fogFar, b.fogFar, t),
    exposure: lerp(a.exposure, b.exposure, t),
  };
}

// ---------- what the building does about it ----------

// Below this the sun is no longer doing the lighting and a real school has its
// fixtures on. It is above the horizon on purpose: the lights go on at dusk,
// not once it's dark.
export const LIGHTS_ON_ALT = 8;

export const lightsBurn = (altitudeDeg, mode = 'auto') => {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return altitudeDeg < LIGHTS_ON_ALT;
};

// How much of the fixtures' full output is showing. Ramped rather than
// switched, so scrubbing through dusk fades the building up instead of
// snapping it on a frame.
export function lightLevel(altitudeDeg, mode = 'auto') {
  if (mode === 'on') return 1;
  if (mode === 'off') return 0;
  const a = Number.isFinite(altitudeDeg) ? altitudeDeg : 0;
  if (a <= -2) return 1;
  if (a >= LIGHTS_ON_ALT) return 0;
  return (LIGHTS_ON_ALT - a) / (LIGHTS_ON_ALT + 2);
}

// A one-line description of the sky, for the HUD and the atmosphere panel.
export function skyPhase(altitudeDeg) {
  const a = altitudeDeg;
  if (a < -18) return 'Night';
  if (a < -6) return 'Astronomical twilight';
  if (a < -0.833) return 'Civil twilight';
  if (a < 6) return 'Golden hour';
  if (a < 25) return 'Daylight';
  return 'High sun';
}

// Everything a renderer needs for one environment, in one call — so nothing
// downstream has to remember the order the pieces go together in.
export function skyState(env) {
  const e = normalizeEnv(env);
  const sun = solarPosition(e);
  const palette = skyPalette(sun.altitude);
  return {
    env: e,
    sun,
    dir: sunVector(sun.altitude, sun.azimuth, e.north),
    palette,
    times: sunTimes(e),
    phase: skyPhase(sun.altitude),
    lightLevel: lightLevel(sun.altitude, e.lights),
    daylight: sun.altitude > HORIZON_DIP,
  };
}
