// staff.js — the crew as people rather than three numbers. Pure: no DOM, no
// three.js, no import. Who works tonight, what a shift does to them, who gets
// better, who calls out and who walks. campaign.js owns the record (`c.crew`),
// the payroll (`c.staff`) and the cash; this file owns the arithmetic (#908).
//
// Not a port. The 2D build (`Projects/The-Fourth-Quarter.html`) has a staffer
// as a role, a skill and a wage, the same as this build had, and nothing else:
// no schedule, no fatigue, no growth. What is here was designed for this
// build, on the shape the supply house (#905) used:
//
// - **No rota is the rule this build already had, exactly.** Everyone on the
//   payroll works every night at the skill they were hired at, draws the wage
//   every night, never tires, never improves and never leaves unless a card
//   says so. A save from before this file has no rota, and a campaign that
//   never posts one settles to the same bytes it did (`test/smoke-settle.mjs`'s
//   pin, and whole seasons compared tree against tree).
// - **Posting the rota is the choice, and it is one way**, like an upgrade.
//   It buys three things: a night off is a night's wage not paid, a roster of
//   ROSTER_ROTA rather than ROSTER_OPEN so there is somebody to cover, and
//   skill that grows with shifts worked. It costs three: a shift is
//   FATIGUE_SHIFT of fatigue and only a night off takes it back, a tired
//   staffer works a skill level down (two when burnt out) and may not show,
//   and one whose morale has gone looks for the door, faster when the bar
//   across town is doing well. If it came down again, a player would post it
//   for the slow Monday and tear it down for the weekend.
// - **Five on, two off holds.** 5 x FATIGUE_SHIFT = 2 x FATIGUE_REST. A sixth
//   shift in a row opens tired, from the first week.
// - **At most SHIFT_MAX work a night**, which is the old payroll cap, so the
//   night engine and the floor never see a bigger crew than they did. Anyone
//   scheduled past that is on call: unpaid, resting, and in if somebody ahead
//   of them calls out.
// - **A call-out is a function of the name and the day**, like who is in
//   among the regulars, so the Crew panel, the door and the settlement all
//   agree about who showed without anything being stored.

export const ROSTER_OPEN = 3;
export const ROSTER_ROTA = 5;
export const SHIFT_MAX = 3;

export const FATIGUE_SHIFT = 12;
export const FATIGUE_REST = 30;
export const TIRED = 60;
export const BURNT = 85;

export const SKILL_MAX = 5;
/** Shifts to the next level, per level already held: 2 to 3 is 12 shifts. */
export const XP_PER_SKILL = 6;
/** What a level is worth a night, on top of the wage they were hired at. */
export const LEVEL_RAISE = 20;

export const MORALE_START = 60;
/** Below this a staffer is looking, and every night is a roll. */
export const LOOKING = 25;
export const MORALE = { fresh: 1, tired: -4, burnt: -8, rest: 2, good: 2, ugly: -3, level: 10, raise: 15 };

export const CALLOUT_CHANCE = 0.35;
export const QUIT_CHANCE = 0.15;
/** The End Zone at POACH_BUZZ or over is hiring, and says so. */
export const POACH_BUZZ = 50;
export const POACH_CHANCE = 0.30;
export const POACH_BUZZ_GAIN = 3;

/** The week, as league.js's DAYS; spelled here because this file imports nothing. */
export const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fin = (v, d) => (Number.isFinite(v) ? v : d);

export function newCrew() { return { rota: false, book: {} }; }
export function hasRota(crew) { return !!crew && crew.rota === true; }
/** How many the payroll holds. */
export function rosterCap(crew) { return hasRota(crew) ? ROSTER_ROTA : ROSTER_OPEN; }

/** One staffer's line in the book, with the opening numbers for whatever the
 *  book does not hold. Read only: the book gets a line when something moves. */
export function entry(crew, name) {
  const e = (crew && crew.book && crew.book[name]) || {};
  return {
    off: Array.isArray(e.off) ? e.off.filter(d => WEEK.includes(d)) : [],
    fatigue: clamp(fin(e.fatigue, 0), 0, 100),
    xp: Math.max(0, fin(e.xp, 0)),
    morale: clamp(fin(e.morale, MORALE_START), 0, 100),
  };
}

/** "fresh", "tired" or "burnt", read at the top of the night. */
export function condition(fatigue) { return fatigue >= BURNT ? "burnt" : fatigue >= TIRED ? "tired" : "fresh"; }
/** Skill levels a staffer works under their own. */
export function skillOff(fatigue) { return fatigue >= BURNT ? 2 : fatigue >= TIRED ? 1 : 0; }
/** The skill they work at tonight; never under 1. */
export function effSkill(skill, fatigue) { return Math.max(1, skill - skillOff(fatigue)); }
/** Shifts a staffer of this skill works to earn the next level; 0 at the top. */
export function xpToLevel(skill) { return skill >= SKILL_MAX ? 0 : XP_PER_SKILL * skill; }

/** A number in [0, 1) off a name and a day: FNV-1a, the same on every machine. */
function coin(name, day) {
  let h = 2166136261;
  const s = `${name}#${day}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
/** Burnt out and not coming in tonight. Only a burnt-out staffer ever does it. */
export function callsOut(name, day, fatigue) {
  return fatigue >= BURNT && coin(name, day) < CALLOUT_CHANCE;
}

/**
 * Who is where tonight, by name, in payroll order. With no rota everyone is
 * `on`. With one: `off` is their night off, `out` called out, `on` is the
 * first SHIFT_MAX of the rest and `call` whoever was scheduled past that.
 */
export function tonight(crew, staff, weekday, day) {
  const t = { on: [], off: [], out: [], call: [] };
  for (const s of staff) {
    if (!hasRota(crew)) { t.on.push(s.name); continue; }
    const e = entry(crew, s.name);
    if (e.off.includes(weekday)) t.off.push(s.name);
    else if (callsOut(s.name, day, e.fatigue)) t.out.push(s.name);
    else if (t.on.length < SHIFT_MAX) t.on.push(s.name);
    else t.call.push(s.name);
  }
  return t;
}

/** Flip one weekday on a staffer's line: off if they worked it, on if not. */
export function toggleOff(crew, name, weekday) {
  if (!hasRota(crew) || !WEEK.includes(weekday)) return crew;
  const e = entry(crew, name);
  const off = e.off.includes(weekday) ? e.off.filter(d => d !== weekday) : WEEK.filter(d => d === weekday || e.off.includes(d));
  return { rota: true, book: { ...crew.book, [name]: { ...e, off } } };
}
/** Post the rota. One way: see the header. */
export function postRota(crew) { return { rota: true, book: { ...((crew && crew.book) || {}) } }; }
/** The book without somebody: let go, walked, or poached. */
export function without(crew, name) {
  const book = { ...((crew && crew.book) || {}) };
  delete book[name];
  return { rota: hasRota(crew), book };
}
/** A raise is noticed. Nothing without a rota, where nobody has a morale. */
export function afterRaise(crew, name) {
  if (!hasRota(crew)) return crew;
  const e = entry(crew, name);
  return { rota: true, book: { ...crew.book, [name]: { ...e, morale: clamp(e.morale + MORALE.raise, 0, 100) } } };
}

/**
 * The book after a night. `staff` is the payroll as it stands at the close,
 * `duty` what tonight() said at the open, `ctx` is { dark, good, ugly, buzz }.
 *
 * Without a rota this is the identity and draws nothing from `rand`, which is
 * what keeps a campaign that never posted one on the draws it always made.
 * With one, in payroll order: a shift worked is fatigue, a shift worked fresh
 * is a shift toward the next level, a night off is rest; then anyone whose
 * morale is under LOOKING rolls once to leave. A dark night rests everybody
 * and moves nothing else. Returns the new record and what happened:
 * `leveled` and `quit` are names, `poached` the quitters the End Zone took.
 */
export function after(crew, staff, duty, ctx, rand) {
  const out = { crew, leveled: [], quit: [], poached: [] };
  if (!hasRota(crew)) return out;
  const book = {};
  const on = new Set(duty.on);
  for (const s of staff) {
    const e = entry(crew, s.name);
    if (ctx.dark || !on.has(s.name)) {
      e.fatigue = clamp(e.fatigue - FATIGUE_REST, 0, 100);
      if (!ctx.dark) e.morale = clamp(e.morale + MORALE.rest, 0, 100);
      book[s.name] = e;
      continue;
    }
    const cond = condition(e.fatigue);
    e.morale = clamp(e.morale + MORALE[cond] + (ctx.good ? MORALE.good : 0) + (ctx.ugly ? MORALE.ugly : 0), 0, 100);
    if (cond === "fresh" && s.skill < SKILL_MAX) {
      e.xp += 1;
      if (e.xp >= xpToLevel(s.skill)) { e.xp = 0; e.morale = clamp(e.morale + MORALE.level, 0, 100); out.leveled.push(s.name); }
    }
    e.fatigue = clamp(e.fatigue + FATIGUE_SHIFT, 0, 100);
    book[s.name] = e;
  }
  if (!ctx.dark) {
    const hiring = fin(ctx.buzz, 0) >= POACH_BUZZ;
    for (const s of staff) {
      if (book[s.name].morale >= LOOKING) continue;
      if (rand() < (hiring ? POACH_CHANCE : QUIT_CHANCE)) {
        out.quit.push(s.name);
        if (hiring) out.poached.push(s.name);
        delete book[s.name];
      }
    }
  }
  out.crew = { rota: true, book };
  return out;
}

// ---------- the save ----------
/** `crew` is additive. Anything that is not a record is no rota; the book
 *  keeps a clamped line for each name on the payroll and nothing else, and a
 *  record with no rota keeps no book. Idempotent. */
export function repairCrew(crew, names) {
  if (!hasRota(crew)) return newCrew();
  const book = {};
  const src = crew.book && typeof crew.book === "object" ? crew.book : {};
  for (const n of names) if (Object.prototype.hasOwnProperty.call(src, n) && src[n] && typeof src[n] === "object") {
    const e = entry({ book: src }, n);
    book[n] = { off: WEEK.filter(d => e.off.includes(d)), fatigue: Math.round(e.fatigue), xp: Math.round(e.xp), morale: Math.round(e.morale) };
  }
  return { rota: true, book };
}
