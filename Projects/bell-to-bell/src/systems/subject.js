import { applyEffects } from '../state.js';

// Phase 5 — SUBJECT IS THE WEATHER.
//
// Treatment §4: subject choice does not change the systems. It changes the
// hazard profile, the grading burden shape, and the flavor of every event.
// Three of those four are shapes this project already had, so almost all of
// this file is merging: a subject's JSON is folded over the day's JSON and the
// systems downstream never learn that a subject exists.
//
// The one rule a subject may add is Hazard, and it is one number. It rises on
// lab days with how loud the room is and with anything left unhandled in it, it
// reads off a band table in data/events.json, and at the cap it generates an
// incident report. It does not cross the bell: it is a fact about this period
// in this room, the way Restlessness is, so CLAUDE.md constraint 13 still has
// exactly one within-day carried meter and it is still Bandwidth.
//
// Nothing in src/ may name a subject id — not in code and not in a comment.
// tests/smoke.mjs asserts that over every file under src/, because the moment
// a branch on one appears the seam has moved to the wrong place.

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Content merge: the subject's value wins, objects merge, arrays replace.
export function merge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  if (!isObj(base)) return structuredClone(over);
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

// The subject a period row names, or the manifest's default. Throws loudly on
// a row that names one nobody shipped, because a silent fallback to Social
// Studies is a period quietly teaching the wrong thing.
export function subjectFor(data, row) {
  const manifest = data.subjects;
  const id = row?.subject || manifest.default;
  const file = data[subjectKey(id)];
  if (!file) throw new Error(`Period "${row?.id}" names subject "${id}", which data/subjects.json does not list`);
  return {
    meters: {}, tellWeights: {}, events: [], flavor: {}, hazard: null, stack: null,
    ...file
  };
}

// Where loadData parks data/subjects/<id>.json in the bundle. Namespaced so a
// subject called "lesson" cannot shadow the lesson file.
export const subjectKey = id => `subject:${id}`;

// ---- what a subject does to a period -------------------------------------

// One number on the meters, applied at the bell like admin's rung.
export const applySubject = (state, subject) => applyEffects(state, subject.meters || {});

// Which tells are common. The generator's mix weights, scaled; a subject that
// names no weight for a type leaves it alone, and a weight of 0 means that
// type does not happen in this room. Minimums are left alone on purpose — a
// subject makes a type common or rare, it does not delete a promise the
// schedule made.
export function weightedMix(mix, subject) {
  const w = subject.tellWeights || {};
  const out = {};
  for (const [type, m] of Object.entries(mix)) {
    out[type] = w[type] == null ? m : { ...m, weight: m.weight * w[type] };
  }
  return out;
}

// The events file the period actually runs: the day's, plus whatever the
// subject schedules, with the subject's overrides folded over any row that
// shares an id.
export function subjectEvents(events, subject) {
  const extra = subject.events || [];
  const byId = new Map(extra.map(e => [e.id, e]));
  const scheduled = events.scheduled.map(e => (byId.has(e.id) ? merge(e, byId.get(e.id)) : e));
  for (const e of extra) if (!scheduled.some(s => s.id === e.id)) scheduled.push(e);
  return merge(events, { ...(subject.flavor?.events || {}), scheduled });
}

export const subjectTells = (tells, subject) =>
  (subject.flavor?.missedCopy
    ? merge(tells, { missedCopy: subject.flavor.missedCopy })
    : tells);

export function subjectInterventions(interventions, subject) {
  const over = subject.flavor?.interventions;
  return over ? merge(interventions, { options: over }) : interventions;
}

// ---- Hazard ---------------------------------------------------------------

// Lab days are weekdays, so this is the only thing in the file that cares what
// day it is, and it is a lookup rather than arithmetic.
export const isLabDay = (subject, day) => !!subject.hazard?.labDays?.includes(day);

// One number, per tick. Returns the incident the moment it tops out, once.
export function tickHazard(state, dt, subject, { day = 0, restless = 0, liveTells = 0 } = {}) {
  const H = subject.hazard;
  if (!H) return null;
  if (isLabDay(subject, day)) {
    state.hazard += (H.risePerSec + restless * H.restlessPerSec + liveTells * H.perLiveTellPerSec) * dt;
  } else {
    state.hazard -= H.settlePerSec * dt;
  }
  state.hazard = Math.max(0, Math.min(H.cap, state.hazard));
  if (state.hazard >= H.cap && !state.incident) {
    state.incident = true;
    applyEffects(state, H.incident.effects);
    return H.incident;
  }
  return null;
}

// What the number reads as. The band table lives in data/events.json next to
// Room Temp's, because it is the same kind of thing.
export function hazardBand(events, value) {
  for (const b of events.hazard || []) if (value < b.below) return b;
  return null;
}

// ---- THE STACK ------------------------------------------------------------

// How many essays are in the room, and where each one sits. Pure: hand it a
// count and it hands back prop rows and occluder rows in exactly the shape
// data/room.json uses, so world/room.js never learns that a stack exists.
export function stackFixtures(subject, count) {
  const S = subject.stack;
  const props = [], occluders = [];
  if (!S || !(count > 0)) return { props, occluders };
  const D = S.desk;
  const onDesk = Math.min(count, S.floorAt);
  for (let i = 0; i < onDesk; i++) {
    const col = Math.floor(i / D.perColumn), row = i % D.perColumn;
    props.push({
      id: `stack${i}`, asset: D.asset, footprint: D.footprint,
      pos: [D.origin[0] + col * D.columnStep, D.origin[1]],
      y: D.y + row * D.step,
      rotY: ((i * 37) % 11 - 5) * 0.012      // nobody squares a stack
    });
  }
  if (count > S.floorAt) occluders.push({ ...S.floor });
  return { props, occluders };
}

// data/room.json, plus whatever the subject puts in the room. A new object
// every time; the day's room data is never touched.
export function subjectRoom(room, subject, stackCount = 0) {
  const { props, occluders } = stackFixtures(subject, stackCount);
  const extra = subject.room || {};
  return {
    ...room,
    props: [...(room.props || []), ...(extra.props || []), ...props],
    occluders: [...(room.occluders || []), ...(extra.occluders || []), ...occluders]
  };
}

export function stackBand(subject, count) {
  for (const b of subject.stack?.bands || []) if (count < b.below) return b;
  return null;
}
