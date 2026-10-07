// season.js — what a season does to the bills. Pure: no DOM, no three.js.
// What rent and wages are multiplied by tonight, what they will be when the
// league's calendar turns, and how many nights away that is. campaign.js owns
// the record (`c.terms`) and the cash; league.js owns the calendar; this file
// owns the arithmetic (#911).
//
// Ported from the 2D build (`Projects/The-Fourth-Quarter.html`, its season
// creep), not copied. Rent up 10 points a season to 60 over and wages up 6
// points a season to 40 over are the 2D build's. What is different:
//
// - **Month to month is the rule this build already had, exactly.** Rent is
//   the room's number and a wage is the staffer's, on day 4 and on day 400. A
//   save from before this file is month to month, and a campaign that never
//   signs settles to the same bytes it did (`test/smoke-settle.mjs`'s pin,
//   and whole seasons compared tree against tree). In the 2D build the creep
//   was every campaign's.
// - **Season terms are the choice, and they are one way**, like the rota and
//   the dated shelf. Signing buys two things: rent SIGN_BREAK points under
//   the room's number for the season it is signed in, and OFF_RENT of the
//   season's rent for the off-season's dark fortnight, every year. It costs
//   the creep: every season after the first puts RENT_STEP points on the rent
//   and WAGE_STEP on every wage. So the second season is the room's own rent
//   again with wages 6% up, and from the third the terms cost more than they
//   ever saved. It is cash now against cash later, and if it could be torn up
//   a player would sign every opening week and walk every second season.
// - **A season is the league's**: SEASON_DAYS nights, a regular season, a
//   bracket and an off-season, read off league.js so the two cannot disagree
//   about which night the year turns. The terms count seasons from the one
//   they were signed in, not from season 1: a bar that signs in season 3 gets
//   the break in season 3.
// - **The terms follow the bar, not the room.** Rent is the room's number
//   times the terms, so a move up the ladder and an eviction down it both keep
//   the season count. It is the same landlord all the way up.
// - **Nothing else moves.** No price, no footfall, no supply account and no
//   compressor: the forecast, an order's cost, a par sheet and a lot's date
//   read the same on terms and off them, and `test/smoke-season.mjs` holds
//   that. The wage is where the terms meet the rota (a night off is the
//   raised wage not paid, and a level's raise is raised with the rest).

import { seasonOf, seasonStart, phaseOf, SEASON_WEEKS, SEASON_DAYS } from "./league.js";

/** Points off the room's rent in the season the terms are signed. */
export const SIGN_BREAK = 10;
/** Points on the rent for every season after that, to RENT_CAP over the room's. */
export const RENT_STEP = 10;
export const RENT_CAP = 60;
/** Points on every wage for every season after the first, to WAGE_CAP over. */
export const WAGE_STEP = 6;
export const WAGE_CAP = 40;
/** Percent of the season's rent due on an off-season night. */
export const OFF_RENT = 75;
/** Nights ahead of a change that the ticker and the door start saying so. */
export const NOTICE = 7;

export function newTerms() { return { signed: false, since: 0 }; }
export function onTerms(terms) { return !!terms && terms.signed === true; }
/** Sign, on `day`. Null if already signed: the terms are one way. */
export function sign(terms, day) {
  if (onTerms(terms)) return null;
  return { signed: true, since: seasonOf(day) };
}

/** Whole seasons on the terms as of `day`: 0 in the season they were signed. */
export function seasonsIn(terms, day) {
  if (!onTerms(terms)) return 0;
  return Math.max(0, seasonOf(day) - terms.since);
}

/** The season's rent as a percent of the room's, before the off-season break. */
function yearRentPct(n) { return Math.min(100 + RENT_CAP, 100 - SIGN_BREAK + RENT_STEP * n); }
function yearWagePct(n) { return Math.min(100 + WAGE_CAP, 100 + WAGE_STEP * n); }

/** Tonight's wage as a percent of the staffer's own. 100 month to month,
 *  where seasonsIn() is 0: that function is the one guard. */
export function wagePct(terms, day) { return yearWagePct(seasonsIn(terms, day)); }
/** The same as a multiplier; exactly 1 month to month. */
export function wageMult(terms, day) { return wagePct(terms, day) / 100; }
/** One wage on tonight's terms, to the dollar: the same product campaign.js's
 *  effWage() rounds, so the Crew panel's two columns cannot disagree. */
export function wageFor(terms, wage, day) { return Math.round(wage * wageMult(terms, day)); }

/** Tonight's rent on a room whose own number is `base`, to the dollar. The
 *  room's number itself month to month. */
export function rentFor(terms, base, day) {
  if (!onTerms(terms)) return base;
  const off = phaseOf(day) === "offseason" ? OFF_RENT : 100;
  return Math.round(base * yearRentPct(seasonsIn(terms, day)) * off / 10000);
}

/** First night of the off-season in the season `day` is in. */
export function offStart(day) { return seasonStart(seasonOf(day)) + SEASON_WEEKS * 7; }
/** First night of the season after the one `day` is in. */
export function nextOpen(day) { return seasonStart(seasonOf(day)) + SEASON_DAYS; }

/**
 * Where the terms stand on `day` and the two dates they move on: the night
 * the off-season's rent starts (`off.in` is 0 once it has) and the night the
 * next season opens. `rent` and `next.rent` and `off.rent` are dollars on a
 * room whose own rent is `base`; the `Pct`s are of the staffer's own wage.
 * Month to month there is nothing to move: null.
 */
export function outlook(terms, base, day) {
  if (!onTerms(terms)) return null;
  const n = seasonsIn(terms, day);
  const open = nextOpen(day), off = offStart(day);
  return {
    season: seasonOf(day), phase: phaseOf(day), seasonsIn: n,
    rent: rentFor(terms, base, day), wagePct: wagePct(terms, day),
    off: { in: Math.max(0, off - day), rent: rentFor(terms, base, off) },
    next: { in: open - day, season: seasonOf(open), rent: rentFor(terms, base, open), wagePct: wagePct(terms, open) },
  };
}
/** What signing today would be: outlook() of terms signed on `day`. */
export function offer(base, day) { return outlook(sign(newTerms(), day), base, day); }

/**
 * The change the bar should be hearing about: the nearest date within NOTICE
 * nights on which the rent or a wage moves, as { in, what, rent, was, wagePct,
 * wageWas }. `what` is "offseason" or "season". Null month to month, and null
 * when nothing moves inside the week.
 */
export function notice(terms, base, day) {
  const o = outlook(terms, base, day);
  if (!o) return null;
  if (o.off.in > 0 && o.off.in <= NOTICE) return { in: o.off.in, what: "offseason", rent: o.off.rent, was: o.rent, wagePct: o.wagePct, wageWas: o.wagePct };
  if (o.next.in <= NOTICE) return { in: o.next.in, what: "season", season: o.next.season, rent: o.next.rent, was: o.rent, wagePct: o.next.wagePct, wageWas: o.wagePct };
  return null;
}

/** The notice as the ticker and the door say it, or "" for none. `n` is
 *  notice()'s record. */
export function noticeLine(n) {
  if (!n) return "";
  const when = n.in === 1 ? "tomorrow" : `in ${n.in} nights`;
  if (n.what === "offseason") return `Season terms: the off-season starts ${when}. Rent drops to $${n.rent} a night from $${n.was} for the dark fortnight.`;
  const wages = n.wagePct > n.wageWas ? ` and every wage goes to ${n.wagePct}% of the staffer's own, from ${n.wageWas}%` : " and wages hold";
  return `Season terms: season ${n.season} opens ${when}. Rent goes to $${n.rent} a night from $${n.was}${wages}.`;
}

// ---------- the save ----------
/** `terms` is additive. Anything that is not signed terms is month to month;
 *  signed, the season it was signed in is a whole number no later than the
 *  season `day` is in (a bar cannot have signed next year). Idempotent. */
export function repairTerms(terms, day) {
  if (!onTerms(terms)) return newTerms();
  const now = seasonOf(day);
  const since = Number.isFinite(terms.since) ? Math.round(terms.since) : now;
  return { signed: true, since: Math.max(1, Math.min(now, since)) };
}
