import { CFG } from '../config.js';

// Phase 3 — THE SEMESTER REMEMBERS.
//
// Every meter used to reset at every bell, so nothing you did on Monday
// existed on Tuesday. This is the record that makes Tuesday exist: one entry
// per class, advanced once a day, pure in and pure out. main.js never does
// date arithmetic; it hands this module what the period ended with and asks
// what the next one starts with.
//
// What a class carries:
//   comp      twelve comprehension values, by seat (who they are, never where
//             they sit). Never a mastery scalar — constraint 7 holds across
//             days the same way it holds across a period.
//   base      where each of those twelve walked in on day one, which is what
//             a night pulls them back toward, from either side.
//   rapport, fidelity   carried, and pulled back toward a mean every night.
//   seed      which class this is, for a generated period; a different seed
//             is a different class and the old numbers are dropped.
//
// What the record carries besides classes: which day it is, every finished
// day's numbers (for the Friday Report), and admin's ladder — which rung, if
// any, tomorrow starts on. Versioned from day one. `repair` runs on every
// load; `migrate` is for version drift and there has not been any yet.

export const RECORD_VERSION = 1;
const S = () => CFG.semester;

export function createRecord() {
  return {
    version: RECORD_VERSION,
    week: 1,
    day: 0,                 // 0-based index into data/admin.json's days
    classes: {},            // periodId -> class entry
    today: [],              // this day's finished periods, in order
    days: [],               // every finished day, in order
    admin: { active: null, history: [] }
  };
}

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const clamp100 = v => Math.max(0, Math.min(100, v));
const clamp01 = v => Math.max(0, Math.min(1, v));
const isArr = v => Array.isArray(v);
const compArray = a => (isArr(a) && a.length && a.every(Number.isFinite)) ? a.map(clamp01) : null;

// The between-days sibling of forgetting: for `week` boundaries the weekend
// number, otherwise the overnight one.
export const retentionAfter = dayIndex =>
  (dayIndex >= S().daysPerWeek - 1 ? S().retainWeekend : S().retainOvernight);

// Where a class walks in on day one, by seat. The lesson's own start rule,
// without the spread, so the floor is a fact and not a die roll.
export const baselineOf = roster =>
  roster.map(s => clamp01(CFG.lesson.startComprehension * (s.aptitude ?? 1)));

// The mean Fidelity across every class on the books. Admin does not keep
// separate opinions of your 4th and your 6th; admin has an opinion of you.
export function adminOpinion(record) {
  const vals = Object.values(record.classes).map(c => c.fidelity).filter(Number.isFinite);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ---- migrate and repair --------------------------------------------------

// Version drift only. Nothing older than 1 was ever written; anything without
// a version is not a record, and repair() below starts it over.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version === RECORD_VERSION) return raw;
  return null;
}

// Every load. Whatever comes out of storage becomes a record with every field
// the code below reads, or a fresh one if it cannot be made into one.
export function repair(raw) {
  const r = migrate(raw);
  if (!r) return createRecord();
  const out = createRecord();
  out.week = Math.max(1, Math.floor(num(r.week, 1)));
  out.day = Math.min(S().daysPerWeek - 1, Math.max(0, Math.floor(num(r.day, 0))));
  for (const [id, c] of Object.entries(r.classes || {})) {
    if (!c || typeof c !== 'object') continue;
    const comp = compArray(c.comp), base = compArray(c.base);
    out.classes[id] = {
      seed: Number.isInteger(c.seed) ? c.seed : null,
      comp: comp && base && base.length === comp.length ? comp : null,
      base: comp && base && base.length === comp.length ? base : null,
      rapport: clamp100(num(c.rapport, CFG.start.rapport)),
      fidelity: clamp100(num(c.fidelity, CFG.start.fidelity)),
      days: Math.max(0, Math.floor(num(c.days, 0))),
      observations: Math.max(0, Math.floor(num(c.observations, 0))),
      edges: Math.max(0, Math.floor(num(c.edges, 0))),
      steadies: Math.max(0, Math.floor(num(c.steadies, 0)))
    };
  }
  out.today = (isArr(r.today) ? r.today : []).filter(p => p && typeof p.periodId === 'string');
  out.days = (isArr(r.days) ? r.days : []).filter(d => d && isArr(d.periods));
  out.admin = {
    active: typeof r.admin?.active === 'string' ? r.admin.active : null,
    history: isArr(r.admin?.history) ? r.admin.history.filter(h => h && typeof h.id === 'string') : []
  };
  return out;
}

// ---- what a period starts with ------------------------------------------

// The rung of the ladder tomorrow starts on: the highest one whose line
// admin's opinion has been under for `days` finished days running.
export function ladderRung(record, ladder) {
  let rung = null;
  for (const step of ladder) {
    const need = step.when.days;
    const recent = record.days.slice(-need);
    if (recent.length < need) continue;
    if (recent.every(d => Number.isFinite(d.opinion) && d.opinion < step.when.fidelityBelow)) rung = step;
  }
  return rung;
}

// Everything main.js needs to open a period. `roster` decides whether the
// carried comprehension still fits (same length, same class); `seed` is the
// generated class's seed or null for an authored one.
export function entering(record, periodId, { roster, seed = null, admin }) {
  const c = record.classes[periodId];
  const sameClass = c && c.seed === (seed ?? null);
  const fits = sameClass && c.comp && c.comp.length === roster.length;
  const rung = record.admin.active
    ? (admin?.escalation?.ladder || []).find(s => s.id === record.admin.active) || null
    : null;
  return {
    firstDay: !sameClass || !c.comp,
    startComp: fits ? c.comp.slice() : null,
    rapport: sameClass ? c.rapport : CFG.start.rapport,
    fidelity: sameClass ? c.fidelity : CFG.start.fidelity,
    rung,
    effects: rung?.effects || null,
    obsWindowScale: rung?.obsWindowScale ?? 1,
    events: rung?.event ? [{ id: `admin-${rung.id}`, ...rung.event }] : [],
    week: record.week,
    day: record.day,
    dayIndex: dayIndexOf(record)
  };
}

// ---- what a period ends with -------------------------------------------

// `result` is what endPeriod() knows: { periodId, seed, roster, students
// (with .seat and .comp), rapport, fidelity, mastery, missed, caught,
// sawCurveball, obsResult, known }. Returns a new record; the old one is
// untouched.
export function recordPeriod(record, result) {
  const out = structuredClone(record);
  const prev = out.classes[result.periodId];
  const seed = result.seed ?? null;
  const sameClass = prev && prev.seed === seed;
  const comp = new Array(result.roster.length).fill(null);
  for (const s of result.students) if (Number.isInteger(s.seat) && s.seat < comp.length) comp[s.seat] = clamp01(s.comp);
  const complete = comp.every(Number.isFinite);
  out.classes[result.periodId] = {
    seed,
    comp: complete ? comp : null,
    base: complete ? (sameClass && prev.base?.length === comp.length ? prev.base : baselineOf(result.roster)) : null,
    rapport: clamp100(num(result.rapport, CFG.start.rapport)),
    fidelity: clamp100(num(result.fidelity, CFG.start.fidelity)),
    days: (sameClass ? prev.days : 0) + 1,
    observations: (sameClass ? prev.observations : 0) + (result.obsResult ? 1 : 0),
    edges: result.known?.edges?.length ?? (sameClass ? prev.edges : 0),
    steadies: result.known?.steadies?.length ?? (sameClass ? prev.steadies : 0)
  };
  out.today = out.today.filter(p => p.periodId !== result.periodId);
  out.today.push({
    periodId: result.periodId,
    mastery: clamp100(num(result.mastery, 0)),
    fidelity: clamp100(num(result.fidelity, CFG.start.fidelity)),
    rapport: clamp100(num(result.rapport, CFG.start.rapport)),
    bandwidth: clamp100(num(result.bandwidth, CFG.start.bandwidth)),
    missed: Math.max(0, Math.floor(num(result.missed, 0))),
    caught: Math.max(0, Math.floor(num(result.caught, 0))),
    curveball: !!result.sawCurveball,
    obs: result.obsResult ? `${result.obsResult.satisfied.length}/${result.obsResult.total}` : null
  });
  return out;
}

// The night. Folds any results not yet recorded, closes the day into
// `days`, forgets what the night forgets, pulls admin's opinion back toward
// the mean, decides tomorrow's rung, and turns the page — Friday into the
// next week's Monday.
export function advanceDay(record, periodResults = [], { admin } = {}) {
  let out = record;
  for (const r of periodResults) out = recordPeriod(out, r);
  out = structuredClone(out);

  const opinion = adminOpinion(out);
  const mean = key => {
    const v = out.today.map(p => p[key]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  out.days.push({
    week: out.week, day: out.day,
    periods: out.today,
    mastery: mean('mastery'), fidelity: mean('fidelity'), rapport: mean('rapport'),
    // What was left at the last bell of the day, which is what the day cost.
    bandwidth: out.today.length ? out.today[out.today.length - 1].bandwidth : null,
    missed: out.today.reduce((a, p) => a + p.missed, 0),
    caught: out.today.reduce((a, p) => a + p.caught, 0),
    curveballs: out.today.filter(p => p.curveball).length,
    opinion,
    admin: out.admin.active
  });
  out.today = [];

  // Forgetting, and reversion. Every class on the books relaxes toward its
  // baseline overnight, from whichever side it ended the day on.
  const retain = retentionAfter(out.day);
  const sem = S();
  for (const c of Object.values(out.classes)) {
    if (c.comp && c.base) {
      c.comp = c.comp.map((v, i) => clamp01(c.base[i] + (v - c.base[i]) * retain));
    }
    c.fidelity = clamp100(sem.districtFidelity + (c.fidelity - sem.districtFidelity) * (1 - sem.fidelityRevert));
    c.rapport = clamp100(CFG.start.rapport + (c.rapport - CFG.start.rapport) * (1 - sem.rapportRevert));
  }

  // Tomorrow's rung, off the days that are now on the books.
  const rung = admin ? ladderRung(out, admin.escalation.ladder) : null;
  const id = rung ? rung.id : null;
  if (id && id !== out.admin.active) out.admin.history.push({ week: out.week, day: out.day, id });
  out.admin.active = id;

  out.day += 1;
  if (out.day >= sem.daysPerWeek) { out.day = 0; out.week += 1; }
  return out;
}

export const isLastDayOfWeek = record => record.day === S().daysPerWeek - 1;

// Days since the semester started, for the tell scheduler: the same class
// does something different on Tuesday, and on the Tuesday after that.
export const dayIndexOf = record => (record.week - 1) * S().daysPerWeek + record.day;

// ---- the Friday Report ----------------------------------------------------

// One finished week, as rows and three lines' worth of numbers. `week`
// defaults to the one that just closed.
export function weekSummary(record, week = record.week - 1) {
  const days = record.days.filter(d => d.week === week);
  const first = days[0], last = days[days.length - 1];
  const meanOf = key => {
    const v = days.map(d => d[key]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const learned = Object.values(record.classes).reduce(
    (a, c) => ({ edges: a.edges + c.edges, steadies: a.steadies + c.steadies }), { edges: 0, steadies: 0 });
  return {
    week,
    days,
    periods: days.reduce((a, d) => a + d.periods.length, 0),
    means: { mastery: meanOf('mastery'), fidelity: meanOf('fidelity'), rapport: meanOf('rapport'),
      bandwidth: meanOf('bandwidth') },
    from: first ? { mastery: first.mastery, fidelity: first.fidelity, rapport: first.rapport } : null,
    to: last ? { mastery: last.mastery, fidelity: last.fidelity, rapport: last.rapport } : null,
    missed: days.reduce((a, d) => a + d.missed, 0),
    caught: days.reduce((a, d) => a + d.caught, 0),
    curveballs: days.reduce((a, d) => a + (d.curveballs || 0), 0),
    rungs: [...new Set(days.map(d => d.admin).filter(Boolean))],
    learned
  };
}
