// tour.js — a camera path, recorded and played back.
//
// Phase 9's guided tours: stand somewhere in the building, press record, walk
// to the next place worth showing, press it again. What you get is a list of
// stops; what plays back is a curve through them, because a camera that
// snaps from stop to stop in straight lines is a slideshow rather than a
// tour. Everything here is arithmetic on that list — where the camera is at
// time t, how long the whole thing runs, what a leg should cost given how far
// it is — with the same bargain the rest of the codebase strikes: no three.js
// in this file, so the whole of it runs under `node --test`.
//
// Timing is per leg rather than global. A key's `sec` is how long it takes to
// arrive at that key from the one before (the first key's is ignored — you
// are already there), and `hold` is how long the camera sits still once it
// arrives. That is what lets a tour linger in the library for four seconds
// and cross the car park in one, which is the difference between a tour and
// a fly-through.
//
// The curve is a Catmull-Rom spline through the stops, which passes *through*
// every one of them — a Bézier would not, and "the camera didn't actually go
// where I put it" is the one complaint a recorded path must never earn. The
// ends are handled by mirroring the neighbouring key rather than by
// duplicating it, so a tour doesn't slow to a crawl at its first leg.
//
// Angles are the other half. Yaw is interpolated the short way round, so a
// camera turning from 170° to -170° turns twenty degrees rather than three
// hundred and forty; pitch is plain linear and clamped, because a tour that
// rolls past straight up is a bug in every playback engine ever written.
//
// Phase 33 gives a stop three more things to carry, all optional: an `hour`
// (env's own `minutes` field, so nothing downstream has to translate), a
// `mood` key (sky.js's, purely a label plus a `lights` hint — the *hour* is
// what actually moves the sun) and a `weather` record (weather.js's, kind
// plus intensity plus wind). `sampleClock` answers where the tour's clock
// stands at time t the same way `sampleTour` answers where the camera is: the
// hour eased the short way round between the nearest defined stops on either
// side (it is an angle around a 24-hour clock face, so `lerpAngle` is the
// right tool twice in this file), mood and weather held from the last
// defined stop and flipped at the midpoint to the next — the storey
// convention again, because a mood or a weather kind is no more a continuous
// quantity than a floor number is. A stop that sets none of the three leaves
// the tour's clock exactly where the drawing board had it, which is what
// lets an old tour keep meaning what it always meant.
//
// `narration` is a fourth, simpler thing: a sentence a stop carries and the
// caller reads once, on arrival — the PA path already knows how to speak one
// and caption it when nothing can.
//
// Both imports below are pure siblings, the same bargain weather.js struck
// with sound.js and shapes.js: nothing here is a dependency this module
// couldn't afford to keep pure.
import { MOODS } from './sky.js';
import { WEATHER_KINDS, normalizeWeather } from './weather.js';
import { registerRecord } from './records.js';

export const MAX_TOURS = 12;
export const MAX_KEYS = 64;
export const MIN_SEC = 0.2;
export const MAX_SEC = 60;
export const MAX_HOLD = 30;
export const MAX_NARRATION = 200;
export const DAY_MINUTES = 1440;

// Default travel speed when a stop is recorded, in feet per second. A little
// slower than a walk (walkthrough.js walks at 12) because a tour is being
// watched rather than driven.
export const TOUR_SPEED = 9;
// ...and the floor under a leg's length, so two stops in the same doorway
// still take a moment rather than teleporting.
export const MIN_LEG = 0.6;

export const HALF_PI = Math.PI / 2;
// Just short of straight up/down: a camera looking exactly along its own up
// axis has an undefined yaw, and the walkthrough clamps the same way.
export const MAX_PITCH = HALF_PI - 0.01;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

// ---------- angles ----------

// Into -π..π, which is where the shortest-arc arithmetic below assumes it is.
export function wrapAngle(a) {
  let x = num(a) % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

// The signed turn from a to b, never more than half a circle.
export const shortestArc = (a, b) => wrapAngle(wrapAngle(b) - wrapAngle(a));

export const lerpAngle = (a, b, u) => wrapAngle(wrapAngle(a) + shortestArc(a, b) * u);

// ---------- easing ----------

// Smoothstep: zero velocity at both ends of a leg, so the camera eases out of
// a stop and into the next one instead of jerking.
export const easeInOut = (u) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

export const EASES = ['smooth', 'linear'];
export const applyEase = (kind, u) => (kind === 'linear' ? clamp(u, 0, 1) : easeInOut(u));

// ---------- the records ----------

// An hour is `null` (this stop says nothing about the clock) or a minute of
// the day, 0..1439 — env's own range, so nothing downstream has to translate.
function normHour(v) {
  return Number.isFinite(v) ? Math.round(clamp(v, 0, DAY_MINUTES - 1)) : null;
}

// A mood is '' (no opinion) or one of sky.js's keys — validated here rather
// than trusted, the same as `ease` two lines below it.
function normMood(v) {
  return typeof v === 'string' && MOODS.some((m) => m.key === v) ? v : '';
}

// Weather is `null` (no opinion) or a normalized weather.js record. The kind
// has to be named explicitly — an object with no recognizable `kind` is not
// "clear weather asked for", it is nothing asked for at all, so it stays
// null rather than becoming a silent `{ kind: 'clear', ... }`.
function normWeather(v) {
  if (!v || typeof v !== 'object' || !WEATHER_KINDS.includes(v.kind)) return null;
  return normalizeWeather(v);
}

export function makeKey(cam = {}, opts = {}) {
  return {
    x: num(cam.x),
    y: num(cam.y),
    z: num(cam.z),
    yaw: wrapAngle(cam.yaw),
    pitch: clamp(num(cam.pitch), -MAX_PITCH, MAX_PITCH),
    // Which storey this stop is on. Playback does not use it — the camera is
    // wherever the curve says — but the panel lists it, and the minimap needs
    // to know which plan to draw while a tour is running.
    floor: Math.max(0, Math.floor(num(cam.floor, 0))),
    sec: clamp(num(opts.sec, 2), MIN_SEC, MAX_SEC),
    hold: clamp(num(opts.hold, 0), 0, MAX_HOLD),
    ease: EASES.includes(opts.ease) ? opts.ease : 'smooth',
    label: typeof opts.label === 'string' ? opts.label.slice(0, 40) : '',
    // Phase 33: the clock a stop optionally carries, and the sentence it
    // optionally says on arrival.
    hour: normHour(opts.hour),
    mood: normMood(opts.mood),
    weather: normWeather(opts.weather),
    narration: typeof opts.narration === 'string' ? opts.narration.slice(0, MAX_NARRATION) : '',
  };
}

export function makeTour(name = 'Tour', keys = []) {
  return {
    id: 0, // assigned from state.nextId, like every other object in a design
    name: String(name || 'Tour').slice(0, 40) || 'Tour',
    loop: false,
    keys: keys.slice(0, MAX_KEYS).map((k) => makeKey(k, k)),
  };
}

export function normalizeTour(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const keys = Array.isArray(raw.keys) ? raw.keys.slice(0, MAX_KEYS) : [];
  const tour = makeTour(raw.name, []);
  tour.keys = keys.filter((k) => k && typeof k === 'object').map((k) => makeKey(k, k));
  tour.loop = !!raw.loop;
  if (Number.isFinite(raw.id) && raw.id > 0) tour.id = Math.floor(raw.id);
  // A tour with nothing in it is a tour that isn't there — the same rule the
  // site, the roof and the overlay follow.
  return tour.keys.length ? tour : null;
}

export function normalizeTours(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, MAX_TOURS * 2)) {
    const tour = normalizeTour(item);
    if (tour) out.push(tour);
    if (out.length >= MAX_TOURS) break;
  }
  return out;
}

export const toursOf = (state) => (state && Array.isArray(state.tours) ? state.tours : []);

// ---------- editing ----------

export const legDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

// What a leg should cost, from how far it is: the recording default, so a
// tour timed by walking it plays back at roughly the pace it was walked.
export const defaultSeconds = (a, b, speed = TOUR_SPEED) =>
  clamp(Math.max(MIN_LEG, legDistance(a, b)) / Math.max(0.1, speed), MIN_SEC, MAX_SEC);

// Append a stop, timed against the one before it. Pure, like everything else
// here: a new tour comes back rather than the old one being edited.
export function addKey(tour, cam, opts = {}) {
  const keys = tour.keys.slice(0, MAX_KEYS - 1);
  const prev = keys[keys.length - 1];
  const sec = Number.isFinite(opts.sec)
    ? opts.sec
    : (prev ? defaultSeconds(prev, cam, opts.speed) : MIN_SEC);
  return { ...tour, keys: keys.concat([makeKey(cam, { ...opts, sec })]) };
}

export function removeKey(tour, index) {
  return { ...tour, keys: tour.keys.filter((_, i) => i !== index) };
}

export function updateKey(tour, index, patch) {
  return {
    ...tour,
    keys: tour.keys.map((k, i) => (i === index ? makeKey({ ...k, ...patch }, { ...k, ...patch }) : k)),
  };
}

// Move a stop up or down the list. The timings travel with the stops rather
// than staying put, which is what somebody reordering a tour means by it.
export function moveKey(tour, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= tour.keys.length || to < 0 || to >= tour.keys.length) return tour;
  const keys = tour.keys.slice();
  const [k] = keys.splice(index, 1);
  keys.splice(to, 0, k);
  return { ...tour, keys };
}

// Re-time every leg from its length — the "make this play at a sensible
// speed" button, after somebody has dragged stops around.
export function retime(tour, speed = TOUR_SPEED) {
  return {
    ...tour,
    keys: tour.keys.map((k, i) => (i === 0 ? k : { ...k, sec: defaultSeconds(tour.keys[i - 1], k, speed) })),
  };
}

// ---------- time ----------

// Where each stop sits on the clock: `arrive` is when the camera reaches it,
// `leave` is when it starts moving again. Built once per playback rather than
// per frame, and the one thing `sampleTour` needs.
export function timeline(tour) {
  const keys = tour && Array.isArray(tour.keys) ? tour.keys : [];
  const out = [];
  let t = 0;
  keys.forEach((k, i) => {
    if (i > 0) t += k.sec;
    const arrive = t;
    t += k.hold;
    out.push({ arrive, leave: t, index: i });
  });
  // A looping tour spends one more leg getting home, priced like any other.
  if (tour && tour.loop && keys.length > 1) t += defaultSeconds(keys[keys.length - 1], keys[0]);
  return { stops: out, duration: t };
}

export const tourDuration = (tour) => timeline(tour).duration;

export function tourSummary(tour) {
  const n = tour && tour.keys ? tour.keys.length : 0;
  if (!n) return 'No stops yet';
  const secs = tourDuration(tour);
  const mins = Math.floor(secs / 60);
  const time = mins ? `${mins}m ${Math.round(secs % 60)}s` : `${Math.round(secs * 10) / 10}s`;
  return `${n} stop${n === 1 ? '' : 's'} · ${time}${tour.loop ? ' · loops' : ''}`;
}

// ---------- the curve ----------

// One Catmull-Rom span. `p1`..`p2` is the leg; `p0` and `p3` are its
// neighbours, and the tangent at each end is half the vector between the
// points either side of it.
function catmull(p0, p1, p2, p3, u, axis) {
  const a = p0[axis], b = p1[axis], c = p2[axis], d = p3[axis];
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (
    2 * b +
    (c - a) * u +
    (2 * a - 5 * b + 4 * c - d) * u2 +
    (-a + 3 * b - 3 * c + d) * u3
  );
}

// The neighbour a leg's tangent needs, at the ends of an open tour. Mirroring
// (`p1 + (p1 - p2)`) rather than duplicating keeps the first and last legs at
// the same speed as the middle ones — a duplicated endpoint gives the spline
// a zero tangent there, which reads as the camera being stuck.
function neighbour(keys, i, loop, mirrorFrom, mirrorTo) {
  const n = keys.length;
  if (loop) return keys[((i % n) + n) % n];
  if (i >= 0 && i < n) return keys[i];
  const a = keys[mirrorFrom], b = keys[mirrorTo];
  return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
}

// Where the camera is at time `t`. Returns the stop index it is on or heading
// to, whether it is holding still, and how far through the whole tour it is —
// everything a HUD needs, worked out once.
export function sampleTour(tour, t) {
  const keys = tour && Array.isArray(tour.keys) ? tour.keys : [];
  if (!keys.length) return null;
  if (keys.length === 1) {
    return { ...keys[0], index: 0, holding: true, progress: 1, done: t >= keys[0].hold };
  }
  const { stops, duration } = timeline(tour);
  const loop = !!tour.loop;
  let time = num(t);
  if (loop && duration > 0) time = ((time % duration) + duration) % duration;
  const done = !loop && time >= duration;
  time = clamp(time, 0, duration);

  // Which leg. The stops are in order, so this is a walk rather than a search
  // — a tour has tens of stops, not thousands.
  let i = 0;
  for (let k = 0; k < stops.length; k++) {
    if (time >= stops[k].arrive) i = k;
    else break;
  }
  const stop = stops[i];
  const last = i === keys.length - 1;

  // Holding at a stop: nothing to interpolate.
  if (time <= stop.leave || (last && !loop)) {
    const k = keys[i];
    return {
      x: k.x, y: k.y, z: k.z, yaw: k.yaw, pitch: k.pitch, floor: k.floor,
      index: i, holding: time <= stop.leave, progress: duration ? time / duration : 1, done,
    };
  }

  const nextIndex = last ? 0 : i + 1;
  const from = keys[i], to = keys[nextIndex];
  const legSec = last
    ? defaultSeconds(from, to)
    : Math.max(MIN_SEC, to.sec);
  const raw = (time - stop.leave) / legSec;
  const u = applyEase(to.ease, raw);

  const p0 = neighbour(keys, i - 1, loop, i, i + 1);
  const p3 = neighbour(keys, nextIndex + 1, loop, nextIndex, nextIndex - 1);
  return {
    x: catmull(p0, from, to, p3, u, 'x'),
    y: catmull(p0, from, to, p3, u, 'y'),
    z: catmull(p0, from, to, p3, u, 'z'),
    yaw: lerpAngle(from.yaw, to.yaw, u),
    pitch: clamp(from.pitch + (to.pitch - from.pitch) * u, -MAX_PITCH, MAX_PITCH),
    // The storey flips at the halfway point rather than easing, because a
    // floor number is not a continuous quantity.
    floor: u < 0.5 ? from.floor : to.floor,
    index: i, holding: false, progress: duration ? time / duration : 1, done: false,
  };
}

// The whole path, at a fixed step — what the minimap draws as a dotted line
// and what a test measures for smoothness. Capped, because a five-minute tour
// at 60fps is eighteen thousand points nobody needs.
export function samplePath(tour, step = 0.25, cap = 2000) {
  const duration = tourDuration(tour);
  const out = [];
  const dt = Math.max(0.02, step);
  for (let t = 0; t <= duration && out.length < cap; t += dt) {
    const at = sampleTour(tour, t);
    if (at) out.push({ x: at.x, y: at.y, z: at.z });
  }
  return out;
}

// ---------- the clock a tour optionally carries ----------

// Every stop that actually says something about hour, mood or weather, in
// timeline order. A tour with none of them (every existing tour, and most
// new ones) is an empty list, which is what makes `sampleClock` a no-op for
// them.
function clockStops(tour) {
  const keys = tour && Array.isArray(tour.keys) ? tour.keys : [];
  const { stops } = timeline(tour);
  const out = [];
  keys.forEach((k, i) => {
    if (k.hour == null && !k.mood && !k.weather) return;
    out.push({ at: stops[i] ? stops[i].arrive : 0, hour: k.hour, mood: k.mood, weather: k.weather });
  });
  return out;
}

// Where the tour's clock stands at time t — `null`/''/`null` in every field
// a tour never mentions, so a caller can tell "say nothing" from "say clear
// at 10am" and leave the live sky alone in the first case. See the file
// header for why hour eases and mood/weather hold-and-flip.
export function sampleClock(tour, t) {
  const stops = clockStops(tour);
  if (!stops.length) return { hour: null, mood: '', weather: null };

  const duration = tourDuration(tour);
  let time = clamp(num(t), 0, duration);
  if (tour && tour.loop && duration > 0) time = ((num(t) % duration) + duration) % duration;

  let prev = stops[0], next = null;
  for (const s of stops) {
    if (s.at <= time) prev = s;
    else { next = s; break; }
  }
  if (!next) return { hour: prev.hour, mood: prev.mood || '', weather: prev.weather };

  const span = Math.max(1e-6, next.at - prev.at);
  const u = clamp((time - prev.at) / span, 0, 1);

  let hour = prev.hour;
  if (prev.hour != null && next.hour != null) {
    const a = (prev.hour / DAY_MINUTES) * Math.PI * 2;
    const b = (next.hour / DAY_MINUTES) * Math.PI * 2;
    const mixed = lerpAngle(a, b, u);
    hour = (((mixed / (Math.PI * 2)) * DAY_MINUTES) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
  } else if (prev.hour == null && next.hour != null) {
    hour = next.hour;
  }

  const mood = u < 0.5 ? (prev.mood || '') : (next.mood || prev.mood || '');

  let weather = prev.weather || null;
  if (prev.weather && next.weather && prev.weather.kind === next.weather.kind) {
    weather = {
      kind: prev.weather.kind,
      intensity: prev.weather.intensity + (next.weather.intensity - prev.weather.intensity) * u,
      wind: prev.weather.wind + (next.weather.wind - prev.weather.wind) * u,
    };
  } else {
    weather = u < 0.5 ? (prev.weather || null) : (next.weather || prev.weather || null);
  }

  return { hour, mood, weather };
}

// ---------- playback ----------

// The clock, as a record rather than as four variables in main.js. `rate` is
// there so a tour can be scrubbed or slowed without playback knowing why.
export function startPlayback(tour, opts = {}) {
  return {
    tour,
    t: num(opts.at, 0),
    rate: clamp(num(opts.rate, 1), 0.1, 8),
    playing: true,
    duration: tourDuration(tour),
  };
}

// Advance and sample in one call, so the caller's frame loop is two lines.
// A non-looping tour that runs out stops itself and holds on its last stop.
export function stepPlayback(play, dt) {
  if (!play || !play.playing) return play;
  const t = play.t + Math.max(0, num(dt)) * play.rate;
  const over = !play.tour.loop && t >= play.duration;
  return { ...play, t: over ? play.duration : t, playing: !over };
}

// Phase 42: the recorded tours are this module's record on the design — see
// records.js. A design with none writes no `tours` key.
registerRecord('tours', { normalize: normalizeTours, isEmpty: (tours) => tours.length === 0 });
