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

export const RECORD_VERSION = 2;
const S = () => CFG.semester;

// `seed` is the semester's own integer, drawn once by main.js the same way a
// generated class's is and kept forever after. It is what makes AP Reyes's
// calendar a function rather than a list: systems/observation.js's visitFor
// takes (seed, dayIndex, periodId) and hands back the same answer today and
// on Thursday, so an announced visit can be read days early without anything
// about it being written down. Nothing in this module draws a die.
export function createRecord(seed = 0) {
  return {
    version: RECORD_VERSION,
    seed: Number.isInteger(seed) ? seed : 0,
    week: 1,
    day: 0,                 // 0-based index into data/admin.json's days
    classes: {},            // periodId -> class entry
    today: [],              // this day's finished periods, in order
    days: [],               // every finished day, in order
    admin: { active: null, history: [] },
    // Phase 4: what you promised AP Reyes in a post-conference and have not
    // done yet. One entry per open promise; kept ones are dropped at the next
    // night, forgotten ones are charged once and then dropped.
    owed: []
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

// Version drift. A version 1 record is a real semester written before AP
// Reyes had a calendar or a follow-up existed: it comes forward as itself with
// a seed of 0 and nothing owed, which is a semester where she visits on a
// calendar rather than none at all. Anything without a version is not a
// record, and repair() below starts it over.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version === RECORD_VERSION) return raw;
  if (raw.version === 1) return { ...raw, version: RECORD_VERSION, seed: 0, owed: [] };
  return null;
}

// Every load. Whatever comes out of storage becomes a record with every field
// the code below reads, or a fresh one if it cannot be made into one.
export function repair(raw, seed = 0) {
  const r = migrate(raw);
  if (!r) return createRecord(seed);
  const out = createRecord(Number.isInteger(r.seed) ? r.seed : seed);
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
  out.owed = (isArr(r.owed) ? r.owed : []).filter(o =>
    o && typeof o.id === 'string' && typeof o.periodId === 'string' &&
    typeof o.lookFor === 'string' && Number.isFinite(o.dueDay)
  ).map(o => ({
    id: o.id, periodId: o.periodId, lookFor: o.lookFor,
    fromDay: Math.max(0, Math.floor(num(o.fromDay, 0))),
    dueDay: Math.max(0, Math.floor(o.dueDay)),
    kept: !!o.kept, broken: !!o.broken
  }));
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
export function entering(record, periodId, { roster, seed = null, admin, observation = null }) {
  const c = record.classes[periodId];
  const sameClass = c && c.seed === (seed ?? null);
  const fits = sameClass && c.comp && c.comp.length === roster.length;
  const rung = record.admin.active
    ? (admin?.escalation?.ladder || []).find(s => s.id === record.admin.active) || null
    : null;

  // Phase 4: a follow-up you promised her and did not do. advanceDay marked it
  // broken last night; this is the morning it costs something. One charge, on
  // the period it was promised in, and then it is gone.
  const broken = record.owed.filter(o => o.broken && o.periodId === periodId);
  const brokenCopy = broken.length ? observation?.followUp?.broken : null;

  const effects = (rung?.effects || brokenCopy?.effects)
    ? { ...(rung?.effects || {}) } : null;
  if (effects && brokenCopy?.effects) {
    for (const [k, v] of Object.entries(brokenCopy.effects)) effects[k] = (effects[k] || 0) + v * broken.length;
  }

  const events = rung?.event ? [{ id: `admin-${rung.id}`, ...rung.event }] : [];
  if (brokenCopy?.event) events.push({ id: `owed-${broken[0].id}`, ...brokenCopy.event });

  return {
    firstDay: !sameClass || !c.comp,
    startComp: fits ? c.comp.slice() : null,
    rapport: sameClass ? c.rapport : CFG.start.rapport,
    fidelity: sameClass ? c.fidelity : CFG.start.fidelity,
    rung,
    effects,
    obsWindowScale: rung?.obsWindowScale ?? 1,
    events,
    // Phase 4: what this period still owes, and what it forgot. `owed` is what
    // the start screen names; `broken` is what this morning is charging for.
    owed: openFollowUps(record, periodId),
    broken,
    week: record.week,
    day: record.day,
    dayIndex: dayIndexOf(record)
  };
}

// ---- follow-ups ----------------------------------------------------------
//
// Phase 4. The affirming answer in the post-conference used to say it cost you
// a follow-up and then cost you nothing. Now it books one: a look-for, a
// period, and a day by which you have to have done it in that room. She is not
// there when you do it. Forgetting it is a Fidelity hit the morning after it
// comes due, once.

// A promise, on the books. Promising the same thing again replaces the old one
// rather than stacking a second copy of it.
export function oweFollowUp(record, { periodId, id, lookFor, days }, dayIndex = dayIndexOf(record)) {
  const out = structuredClone(record);
  out.owed = out.owed.filter(o => !(o.id === id && o.periodId === periodId));
  out.owed.push({
    id, periodId, lookFor,
    fromDay: dayIndex,
    dueDay: dayIndex + Math.max(1, Math.floor(days)),
    kept: false, broken: false
  });
  return out;
}

// Everything this period still owes and has not been charged for.
export const openFollowUps = (record, periodId) =>
  record.owed.filter(o => !o.broken && !o.kept && (periodId == null || o.periodId === periodId));

// What the period actually did in the room today. A promise is kept by doing
// the thing on a later day than the one you made it on — you cannot keep it in
// the same breath you promise it.
export function settleFollowUps(record, { periodId, dayIndex, used = [] }) {
  const out = structuredClone(record);
  const kept = [];
  for (const o of out.owed) {
    if (o.periodId !== periodId || o.kept || o.broken) continue;
    if (dayIndex > o.fromDay && used.includes(o.lookFor)) { o.kept = true; kept.push(o); }
  }
  return { record: out, kept };
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

  // Phase 4: the night the promises turn over. A promise you kept is done
  // with; one that was charged yesterday morning is done with too; one whose
  // day has now gone past without you doing it is marked broken, which is what
  // tomorrow's entering() charges for, once.
  const today = dayIndexOf(out);
  out.owed = out.owed.filter(o => !o.kept && !o.broken);
  for (const o of out.owed) if (o.dueDay <= today) o.broken = true;

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
