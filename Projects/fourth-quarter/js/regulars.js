// regulars.js — the people who come back, and the bar across town. Pure: no
// DOM, no three.js, no campaign.js. campaign.js owns the fields and calls
// these; this file owns the arithmetic.
//
// Ported from the 2D build (`Projects/The-Fourth-Quarter.html`, its "regulars"
// and "the rival bar" sections), not copied: the numbers are the 2D build's,
// the shapes are this build's, and one thing is deliberately different.
//
// **Who is in tonight is not stored.** The 2D build rolls `regularShows()` at
// the top of the night and keeps the answer in the night object. Here the roll
// is a pure function of the regular's id and the campaign's day — the same
// coin, from no stored state, every time it is asked. The forecast on the
// corkboard, the crowd the door opens on, and the loyalty drift at settlement
// therefore cannot disagree about who came in, and no reroll bug is reachable:
// there is nothing to reroll. It is the same reasoning league.js's calendar
// runs on (locked #203), applied to eight people instead of eight teams.

import { FOOD, MENU, mulberry32 } from "./engine.js";
import { TEAMS, MULES } from "./league.js";

export const RIVAL = { name: "The End Zone", owner: "Vic Marlowe" };

export const REP_START = 50;          // see repMult(): 50 is exactly 1.00×
export const LOYALTY_START = 55;
export const BUZZ_START = 45;
export const BUZZ_MIN = 10, BUZZ_MAX = 95;
export const LOST_MEMORY = 6;         // how many names the door remembers
// On top of the -1 a regular takes for staying home: a closed night costs 6 in
// all, so two dark nights in a row take a shaky 20-loyalty regular to 8. The 2D
// build charges the whole move at once (10 + 8 per night); this charges it per
// night, so a one-night move at the Fieldhouse is cheaper than a two-night move
// into the flagship, which is the shape the ladder already has.
export const DARK_NIGHT_LOYALTY = 5;
// The boss put their first round on the house: half a birthday round in the
// 2D build's terms (12 for the whole bench), and more than the +3 a good
// night gives everybody, because it cost the shelf price out of tonight's take.
export const COMP_LOYALTY = 4;

/** The roster cap by venue tier — the 2D build's `regularCap()`: 3, 5, 7, 9. */
export function regularCap(tierOrder) { return 3 + Math.max(0, tierOrder | 0) * 2; }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// ---------- the deterministic coin ----------
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/** One regular's coin for one specific day, in [0, 1). Same answer forever. */
export function dayRoll(id, day) {
  return mulberry32((hashStr(String(id)) ^ Math.imul(day | 0, 0x9E3779B1)) >>> 0).value;
}

// ---------- a regular ----------
/** `name` comes from the campaign, which owns the name pool and knows which
 *  names are already on the payroll. Everything else is drawn here. */
export function mkRegular(name, day, rand = Math.random) {
  const usual = FOOD[Math.floor(rand() * FOOD.length)];
  const away = TEAMS.filter(t => t.id !== MULES);
  const team = rand() < 0.55 ? MULES : away[Math.floor(rand() * away.length)].id;
  return { id: `${hashStr(name).toString(36)}-${day}`, name, usual, team, loyalty: LOYALTY_START, visits: 0, since: day };
}

/** The chance this regular walks in on `day`. Loyalty is most of it; their own
 *  team being on the screens is worth a quarter; your name is worth a fifth of
 *  what loyalty is. Bounded either side so nobody is ever certain or written
 *  off — the 2D build capped the top at 0.95 and never floored the bottom. */
export function showChance(r, rep, theirGame) {
  const p = 0.5 + num(r.loyalty, 0) / 250 + (theirGame ? 0.25 : 0) + clamp(num(rep, 0), 0, 100) / 500;
  return clamp(p, 0.05, 0.95);
}
export function showsTonight(r, day, rep, theirGame) {
  return dayRoll(r.id, day) < showChance(r, rep, theirGame);
}
/** Whoever is in tonight. `teamsPlaying` is a Set of team ids on the screens. */
export function regularsTonight(list, day, rep, teamsPlaying) {
  return list.filter(r => showsTonight(r, day, rep, teamsPlaying.has(r.team)));
}

// ---------- what the crowd multiplier is made of ----------
/** Your name at the door. 50 is 1.00× on purpose: this phase must not move a
 *  day-one campaign's forecast, so the starting reputation is the identity and
 *  the number is a lever in both directions (0.60× at 0, 1.40× at 100). The 2D
 *  build starts at 35 and ships a 0.88× opening night; this build does not. */
export function repMult(rep) { return 0.6 + clamp(num(rep, REP_START), 0, 100) / 125; }
/** A room with its own people in it draws more. Caps at +12% (2D's number),
 *  and counts who actually came in rather than who is on the roster. */
export function regularCrowdMult(nShowing) { return 1 + Math.min(0.12, Math.max(0, nShowing) * 0.012); }
/** Crowd drag when the End Zone's buzz outruns your name. Zero when you are
 *  ahead of them, 0.15 at the worst. */
export function rivalPressure(buzz, rep) {
  return clamp((clamp(num(buzz, BUZZ_START), 0, 100) - clamp(num(rep, REP_START), 0, 100)) * 0.003, 0, 0.15);
}
export function rivalMult(buzz, rep) { return 1 - rivalPressure(buzz, rep); }
export function rivalWord(buzz) {
  const b = num(buzz, BUZZ_START);
  return b >= 70 ? "packed nightly" : b >= 55 ? "drawing crowds" : b >= 40 ? "holding steady" : "struggling";
}
/** The best skill an applicant can roll. Your name is what walks in the door
 *  looking for work: 2 at rep 0, 4 at the starting 50, 5 from 75 up. */
export function applicantSkillCap(rep) { return Math.min(5, 2 + Math.floor(clamp(num(rep, REP_START), 0, 100) / 25)); }

// ---------- the night's verdict ----------
/** Two words for how the floor ran, read by loyalty, minting and the rival. */
export function nightVerdict(serviceRate, mood) {
  const sr = num(serviceRate, 1), m = num(mood, 0.7);
  return { good: sr >= 0.8 && m >= 0.5, ugly: sr < 0.6 || m < 0.35 };
}

/** How far your name moves on one night. Service rate is most of it, the room's
 *  mood the rest; a Mules win is worth a point. A high reputation is hard to
 *  push higher, and a bench of regulars cushions a bad night. Clamped to ±5 so
 *  no single night can swing your name across the board. */
export function repDrift(rep, serviceRate, mood, nRegulars, postWin) {
  const sr = num(serviceRate, 1), m = num(mood, 0.7), r = clamp(num(rep, REP_START), 0, 100);
  let d = Math.round((sr - 0.75) * 14 + (m - 0.6) * 6);
  if (postWin) d += 1;
  if (d > 0) d = Math.round(d * Math.max(0.15, 1 - r / 110));
  if (d < 0) d = Math.round(d * (1 - Math.min(0.4, Math.max(0, nRegulars) * 0.05)));
  return clamp(d, -5, 5);
}

/**
 * Move every regular's loyalty for one closed night, in place.
 *
 * `showing` is the id set of who came in; `stockedOut` the id set of who came
 * in and found their usual gone. A stocked-out usual costs 8 and it costs it
 * once — the set is a set, and this function is the only place loyalty moves
 * for a night. Somebody who stayed home drifts down 1: a regular you never see
 * stops being one.
 *
 * The 8 is charged outside the `showing` branch on purpose. It read better
 * nested inside it, and that was two lines guarding one absence: the caller
 * builds `stockedOut` out of the people who showed, so nesting the penalty
 * under the same condition meant deleting either one changed nothing any test
 * could see (#34). The caller's filter is the single guard now; `stockedOut`
 * is documented as a subset of `showing` and this function trusts it.
 */
export function driftLoyalty(list, { showing, stockedOut, comped = new Set(), good, ugly }) {
  for (const r of list) {
    if (stockedOut.has(r.id)) r.loyalty -= 8;
    else if (showing.has(r.id) && good) r.loyalty += 3;
    // the floor's word: the engine's `comped` set is ids the boss actually
    // comped tonight, a subset of who was seated, and this trusts it the way
    // it trusts `stockedOut`
    if (comped.has(r.id)) r.loyalty += COMP_LOYALTY;
    if (showing.has(r.id)) {
      r.visits = Math.max(0, Math.round(num(r.visits, 0))) + 1;
      if (ugly) r.loyalty -= 5;
    } else r.loyalty -= 1;
    r.loyalty = clamp(num(r.loyalty, 0), 0, 100);
  }
}

/** Drop anyone at zero and remember them. Returns the names that left, and
 *  pushes each onto `lost` (newest last, capped) so they can be re-earned as
 *  themselves rather than replaced by a stranger. */
export function pruneRegulars(list, lost) {
  const gone = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].loyalty > 0) continue;
    const r = list.splice(i, 1)[0];
    gone.unshift(r.name);
    lost.push({ name: r.name, usual: r.usual, team: r.team });
  }
  while (lost.length > LOST_MEMORY) lost.shift();
  return gone;
}

/**
 * A great, busy night can mint a regular — or win one back.
 *
 * Half the time, when somebody who used to drink here is remembered, it is
 * them walking back in with their old usual and their old team rather than a
 * new face. That is what "a regular at zero loyalty can be re-earned" means
 * here: the same person, not a replacement.
 *
 * Returns the regular, or null. `nameFor` is the campaign's namer, called only
 * when a genuinely new person is minted.
 */
export function mintRegular(list, lost, { cap, good, arrivals, day, nameFor, rand = Math.random }) {
  if (list.length >= cap || !good || arrivals < 18 || rand() >= 0.35) return null;
  if (lost.length && rand() < 0.5) {
    const back = lost.shift();
    const r = { ...mkRegular(back.name, day, rand), usual: back.usual, team: back.team, returning: true };
    list.push(r);
    return r;
  }
  const r = mkRegular(nameFor(), day, rand);
  list.push(r);
  return r;
}

/** Vic's needle after one of your nights. A good busy night bleeds it, an ugly
 *  one feeds it; he scraps back off the floor and hype that hot always cools. */
export function driftBuzz(buzz, { good, ugly, arrivals }, rand = Math.random) {
  const b = clamp(num(buzz, BUZZ_START), BUZZ_MIN, BUZZ_MAX);
  let d = Math.floor(rand() * 3) - 1;
  if (good && arrivals >= 18) d -= 2;
  if (ugly) d += 2;
  if (b < 35) d += 1;
  if (b > 80) d -= 1;
  return { buzz: clamp(b + d, BUZZ_MIN, BUZZ_MAX), d };
}

/** The one line the day ticker gets about what they did last night. No panel:
 *  the rival is a pressure, not a screen. */
export function rivalLine(buzz, d, rep) {
  const where = rivalWord(buzz);
  if (d <= -2) return `Word from across town: ${RIVAL.name} had a slow one. ${RIVAL.owner}'s place is ${where}.`;
  if (d >= 2) return `${RIVAL.name} was three deep at the rail last night. ${RIVAL.owner}'s place is ${where}.`;
  return rivalPressure(buzz, rep) > 0
    ? `${RIVAL.name} is ${where}, and it is pulling on your door.`
    : `${RIVAL.name} is ${where}. Nothing you can't handle.`;
}

// ---------- the save ----------
export function newRegulars() { return []; }
export function newRival() { return { buzz: BUZZ_START }; }

const FOOD_SET = new Set(FOOD);
const TEAM_SET = new Set(TEAMS.map(t => t.id));

/** Additive, so a save from before this phase has none of it. Every field the
 *  game does arithmetic on gets a finite fallback and every id gets checked
 *  against the table it indexes — campaign.js's rule (#37 repair), applied to
 *  three fields it does not own. Idempotent. */
export function repairRegulars(list, day) {
  if (!Array.isArray(list)) return [];
  const out = [], ids = new Set();
  let n = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.name !== "string" || !r.name.trim()) r.name = `Regular ${++n}`;
    if (typeof r.id !== "string" || !r.id || ids.has(r.id)) r.id = `${hashStr(r.name).toString(36)}-${out.length}`;
    ids.add(r.id);
    if (!FOOD_SET.has(r.usual)) r.usual = FOOD[0];
    if (!TEAM_SET.has(r.team)) r.team = MULES;
    r.loyalty = clamp(num(r.loyalty, LOYALTY_START), 0, 100);
    r.visits = Math.max(0, Math.round(num(r.visits, 0)));
    r.since = Math.max(1, Math.round(num(r.since, day)));
    // Zero loyalty is the "they are gone" state, and pruneRegulars() runs at
    // settlement — a save edited to zero would otherwise sit on the roster
    // forever never showing, so the load prunes it too.
    if (r.loyalty > 0) out.push(r);
  }
  return out;
}
export function repairLost(lost) {
  if (!Array.isArray(lost)) return [];
  const out = [];
  for (const l of lost) {
    if (!l || typeof l !== "object" || typeof l.name !== "string" || !l.name.trim()) continue;
    out.push({ name: l.name, usual: FOOD_SET.has(l.usual) ? l.usual : FOOD[0], team: TEAM_SET.has(l.team) ? l.team : MULES });
  }
  return out.slice(-LOST_MEMORY);
}
export function repairRival(rv) {
  const buzz = clamp(num(rv && rv.buzz, BUZZ_START), BUZZ_MIN, BUZZ_MAX);
  return { buzz };
}

/** What a regular orders, spelled out — the ticket and the corkboard both. */
export function usualName(r) { return MENU[r.usual] ? MENU[r.usual].name : r.usual; }
