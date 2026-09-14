// escalation.js — what happens when more than one buyer wants the same house.
//
// Until now a multi-offer situation was a list. `spawnNPCOffer()` could stamp a
// flat `escalation` number onto an offer if the agent had `dirtyTricks`, and
// that number did exactly one thing: it raised the ceiling `respondToOffer()`
// would accept a counter under. The player saw a line of fine print and had no
// move to make about it. `flowOfferReview()` said "Multiple offers. You may
// leverage them against each other — carefully" and then offered no lever.
//
// This is the lever. Two halves, one arithmetic:
//
//   The clause.  An escalation clause is "I will beat any bona fide competing
//                offer by <increment>, up to <cap>." It is a structured thing
//                now — {cap, increment} — not a single number, because the
//                increment is half the mechanic and a lone cap cannot express
//                it. resolveField() is the only place a clause turns into a
//                price.
//   The call.    "Highest and best": the listing agent tells every open offer
//                that the field is closing on a date, and each buyer's agent
//                raises, stands pat, or walks. It costs two days and it can
//                empty the field. It is the only way to make a warm field bid
//                against itself, and the only way to lose one.
//
// -------------------------------------------------------------------------
// The rule that matters, and it is a decision rather than a derivation:
//
//   AN ESCALATION CLAUSE RESOLVES AGAINST THE HIGHEST *SUBMITTED* PRICE IN THE
//   FIELD. NEVER AGAINST ANOTHER CLAUSE'S ESCALATED RESULT.
//
// The alternative is a mutual recursion — A escalates over B's escalated
// number, which escalated over A's — and it has no honest fixed point. It
// terminates at both caps, which is a pair of numbers neither buyer ever agreed
// to face, arrived at by a machine rather than by anybody's judgement. Real
// clauses say "bona fide written offer" for the same reason: an escalated
// number is derived, not written. So `base` is the paper and `final` is what
// the paper is worth once the field is known, and only paper escalates.
//
// Three consequences fall straight out of it, and all three are playable:
//
//   * A clause never pays more than one increment over the runner-up's paper.
//     That is the whole reason a buyer writes one.
//   * A straight number above a cap beats the clause outright. That is the
//     whole reason a listing agent asks for highest and best WITHOUT clauses —
//     which is exactly what `by-the-book` does when you call for it.
//   * Two clauses in one field do not pump each other. They each land one
//     increment over the best non-escalated paper, and then the tiebreak
//     decides — on terms, because that is all that is left to decide on.
//
// Nothing in here reads or writes `S` except the four functions at the bottom
// that run the call itself. resolveField() is pure and takes plain offers, so
// the seller side and the buyer side get one implementation at one budget.
import { DB, fmtMoney } from "../data.js";
import { S, log, addRep, rand, randRange, scheduleItem, unschedule, getClientRec, isWeekend } from "../state.js";
import { financingType } from "./financing.js";
import { playerListingValue, marketHeat } from "./market.js";
import { satisfactionDelta } from "./clients.js";
import { pickHook } from "./deals.js";

/** What a clause steps by when its offer file does not say. */
export const DEFAULT_INCREMENT = 1000;
/** Days a highest-and-best call holds the field open. */
export const HB_DEADLINE_DAYS = 2;

/**
 * The clause on an offer, in one shape, or null.
 *
 * Offers written before this file carry `escalation` as a bare number — the cap
 * and nothing else. Those still read, at the default increment, which is what
 * `respondToOffer()` was effectively already doing with them. A cap at or below
 * the offer's own price is not a clause, it is a typo, and reads as null.
 */
export function clauseOf(offer) {
  if (!offer || offer.escalation == null) return null;
  const e = offer.escalation;
  const cap = typeof e === "number" ? e : Number(e.cap);
  const increment = typeof e === "number" ? DEFAULT_INCREMENT : Number(e.increment);
  if (!Number.isFinite(cap) || !Number.isFinite(increment)) return null;
  if (cap <= offer.price) return null;
  return { cap: Math.round(cap), increment: Math.max(1, Math.round(increment)) };
}

/**
 * How strong an offer's TERMS are, price set aside. The tiebreak, and the same
 * 0.015-per-waiver scale agentRespond() already negotiates on, so a seller
 * breaking a tie and a listing agent weighing an offer are reading one number.
 */
export function termScore(offer) {
  if (!offer) return 0;
  return (offer.inspection === false ? 0.015 : 0)
    + financingType(offer.financing).strength
    + (Number(offer.closeDays) <= 21 ? 0.01 : 0);
}

/**
 * The field, resolved and ranked best first.
 *
 * Every row carries what it is and how it got there, because the modal prints
 * the reasoning rather than the number alone — a player who cannot see why the
 * $161,000 lost to the $158,500 has learned nothing about clauses.
 *
 *   base       what the buyer actually wrote.
 *   final      what it is worth against this field.
 *   beat       the submitted price the clause escalated over, or null.
 *   capped     true when the clause ran out of room: it wanted more and the cap
 *              stopped it. A capped clause is a clause about to lose.
 *
 * Pure. Takes plain offers, touches no state, no rand().
 */
export function resolveField(offers) {
  const live = (offers || []).filter(o => o && Number.isFinite(o.price));
  const rows = live.map(offer => {
    const clause = clauseOf(offer);
    const rivals = live.filter(o => o !== offer);
    const top = rivals.reduce((m, o) => Math.max(m, o.price), 0);
    if (!clause || !rivals.length) {
      return { offer, base: offer.price, final: offer.price, clause, beat: null, capped: false };
    }
    const wanted = top + clause.increment;
    const final = Math.max(offer.price, Math.min(clause.cap, wanted));
    return { offer, base: offer.price, final, clause, beat: top, capped: wanted > clause.cap };
  });
  // Price, then terms, then who got there first, then id. Total and stable:
  // two identical offers must not reorder between one render and the next.
  return rows.sort((a, b) =>
    b.final - a.final
    || termScore(b.offer) - termScore(a.offer)
    || (a.offer.day || 0) - (b.offer.day || 0)
    || String(a.offer.id).localeCompare(String(b.offer.id)));
}

/** The winning row of a field, or null for an empty one. */
export const bestOf = offers => resolveField(offers)[0] || null;

/**
 * One offer's price against a field it is not in — the buyer side's use.
 *
 * The player's own deal is not in `pl.offers`; it is a `deal` with a clause and
 * a single competing number on the other side of a phone call. Same arithmetic,
 * fed by hand.
 */
export function escalateAgainst(offerLike, competingPrice) {
  const clause = clauseOf(offerLike);
  if (!clause || !Number.isFinite(competingPrice)) return { final: offerLike.price, clause, capped: false };
  const wanted = competingPrice + clause.increment;
  return {
    final: Math.max(offerLike.price, Math.min(clause.cap, wanted)),
    clause,
    capped: wanted > clause.cap,
  };
}

/**
 * The clause an NPC buyer's agent attaches, or null.
 *
 * Gated on `dirtyTricks`, which is what the README has always said that flag is
 * for and what spawnNPCOffer() was already doing with it. Chuck and Denny write
 * clauses; nobody else does. The cap is a fraction over the house's value, not
 * over the offer, so a lowball with a clause still has a real ceiling.
 */
export function clauseFor(agent, price, value) {
  if (!agent || !agent.dirtyTricks) return null;
  const cap = Math.round(Math.max(price * 1.01, value * randRange(1.01, 1.07)) / 500) * 500;
  if (cap <= price) return null;
  return { cap, increment: Math.round(randRange(0.003, 0.01) * price / 500) * 500 || DEFAULT_INCREMENT };
}

// ---------------------------------------------------------------- the call --

/**
 * When an offer stops being answerable.
 *
 * calendar.js expired offers at `day + 2` flat. A highest-and-best call has to
 * be able to hold a field past that or the call destroys the thing it was
 * called to sell — the player asks four buyers for their best number and the
 * calendar pulls two of them off the table the same night, with a reputation
 * hit each for "you let an offer deadline lapse." See the smoke test.
 */
export const offerDeadlineDay = o => (Number.isFinite(o && o.hbDeadline) ? o.hbDeadline : (o.day + 2));

export const openOffers = pl => (pl.offers || []).filter(o => o.status === "open");

/** Two real offers, a live listing, and no call already running. Once per listing. */
export function canCallHighestAndBest(pl) {
  return !!pl && pl.status === "live" && !pl.hbDeadline && !pl.hbCalledDay && openOffers(pl).length >= 2;
}

/** What the player is told before they spend the slot. */
export function highestAndBestPreview(pl) {
  const field = resolveField(openOffers(pl));
  return {
    count: field.length,
    top: field.length ? field[0].final : 0,
    clauses: field.filter(r => r.clause).length,
    heat: marketHeat(pl.listing.neighborhood),
  };
}

export function callHighestAndBest(pl) {
  const deadline = S.day + HB_DEADLINE_DAYS;
  pl.hbCalledDay = S.day;
  pl.hbDeadline = deadline;
  // The whole point of the call: the field stays on the table until the date.
  openOffers(pl).forEach(o => { o.hbDeadline = deadline; });
  const rec = getClientRec(pl.clientRecId);
  log(`Highest and best called on ${pl.listing.address}: ${openOffers(pl).length} offers, answers due day ${deadline}. Every buyer's agent now knows they are not alone.`,
    "deal", undefined, rec && rec.recId);
  scheduleItem(deadline, `Highest and best due — ${pl.listing.address}`, "highestAndBest", pl.id);
  return { deadline, offers: openOffers(pl).length };
}

/**
 * How each style answers a highest-and-best call.
 *
 * `raise` is a fraction of the offer's own price. `walk` is the base odds of
 * pulling out entirely — a cold market pushes it up, a hot one down. `clause`
 * is the chance of attaching or keeping one, and it is zero for `by-the-book`
 * on purpose: asked for a best number, Priya writes the number. That is the
 * behaviour that makes calling highest and best a real answer to somebody
 * else's clause, rather than a way to collect more of them.
 */
export const HB_STYLE = {
  shark:          { raise: [0.02, 0.055], walk: 0.06, clause: 0.75, hook: "counter" },
  charmer:        { raise: [0.01, 0.035], walk: 0.10, clause: 0.60, hook: "greeting" },
  "by-the-book":  { raise: [0.015, 0.03], walk: 0.10, clause: 0,    hook: "counter" },
  stonewall:      { raise: [0, 0],        walk: 0.16, clause: 0,    hook: "reject" },
  lowballer:      { raise: [0, 0.012],    walk: 0.45, clause: 0,    hook: "reject" },
  mentor:         { raise: [0.008, 0.022],walk: 0.08, clause: 0,    hook: "accept" },
};

/**
 * One agent's answer. Mutates the offer; returns what happened, for the modal.
 *
 * The raise is bounded by the same ceiling respondToOffer() has always used for
 * a counter — a buyer's agent will not chase a house past what they think it is
 * worth plus their own tolerance, and an agent who would has no tolerance field
 * to read. So a highest-and-best call in a cold market on an overpriced listing
 * collects a row of "stands pat" and costs you two days.
 */
export function agentHighestAndBest(pl, offer) {
  const agent = DB.agents[offer.agentId];
  const style = HB_STYLE[agent.negotiationStyle] || HB_STYLE["by-the-book"];
  const heat = marketHeat(pl.listing.neighborhood);
  const value = playerListingValue(pl);
  const ceiling = value * (1 + agent.tolerance) * 1.05;

  const walkOdds = Math.max(0.02, Math.min(0.8, style.walk * (2 - heat)));
  if (rand() < walkOdds) {
    offer.status = "walked";
    return { offer, action: "walked", say: pickHook(agent, "reject"), from: offer.price, to: offer.price };
  }

  const from = offer.price;
  const want = Math.round(from * (1 + randRange(style.raise[0], style.raise[1])) / 500) * 500;
  const to = Math.max(from, Math.min(want, Math.round(ceiling / 500) * 500));
  offer.price = to;
  offer.hbAnswered = true;
  // An offer that answered the call is a fresh offer, and dated as one. Without
  // this the field survives the call and then expires the same night: the
  // deadline comes off in resolveHighestAndBest() and every survivor drops back
  // to a two-day window that ran out while it was answering.
  offer.day = S.day;

  // A clause is re-decided at the call, not carried over. by-the-book strips
  // one it arrived with; a shark who did not have one may bring one now.
  const had = !!clauseOf(offer);
  offer.escalation = (style.clause && rand() < style.clause) ? clauseFor(agent, to, value) : null;
  const clause = clauseOf(offer);

  return {
    offer, action: to > from ? "raised" : "stood", from, to,
    say: pickHook(agent, to > from ? style.hook : "reject"),
    clauseAdded: !!clause && !had, clauseDropped: had && !clause, clause,
  };
}

/**
 * The deadline arrives. Every open offer answers, then the field resolves.
 *
 * Called from dailySellerTick() rather than from a milestone: a listing running
 * a highest-and-best call is still `live`, and milestones only run on
 * `underContract`.
 */
export function resolveHighestAndBest(pl) {
  const rec = getClientRec(pl.clientRecId);
  const before = bestOf(openOffers(pl));
  const answers = openOffers(pl).map(o => agentHighestAndBest(pl, o));
  pl.hbDeadline = null;
  (pl.offers || []).forEach(o => { o.hbDeadline = null; });
  unschedule(it => it.type === "highestAndBest" && it.ref === pl.id);

  const field = resolveField(openOffers(pl));
  const after = field[0] || null;
  const walked = answers.filter(a => a.action === "walked").length;

  if (!field.length) {
    // Every buyer read the call as a bluff and left. This is the cost of the
    // move, and it is a real one: the listing is live again with nothing on it.
    satisfactionDelta(rec, -12, "calling for best offers and emptying the room");
    addRep(-2, `the field walked on ${pl.listing.address} after you called for highest and best`, rec && rec.recId);
    log(`Highest and best on ${pl.listing.address}: nobody answered. ${walked} offer${walked === 1 ? "" : "s"} withdrawn. The room is empty and the sign is still up.`,
      "bad", undefined, rec && rec.recId);
    return { answers, field, gained: 0, walked };
  }

  const gained = after.final - (before ? before.final : 0);
  if (gained > 0) satisfactionDelta(rec, Math.min(10, Math.round(gained / 2000) + 2), "the call that moved the number up");
  else satisfactionDelta(rec, -4, "two days of waiting that bought nothing");
  log(`Highest and best in on ${pl.listing.address}: ${field.length} still standing, top ${fmtMoney(after.final)}${gained > 0 ? ` (up ${fmtMoney(gained)})` : " — no better than before"}${walked ? `, ${walked} walked` : ""}.`,
    gained > 0 ? "deal" : "", undefined, rec && rec.recId);
  // No live count in this text. The modal renders on the next render(), and the
  // rest of dailySellerTick() runs AFTER this line — the same day's interest
  // roll can spawn a fresh offer that joins the table before anybody reads it,
  // so a count written here is wrong by the time it is on screen. It said "2
  // offers" over a list of three the first time this ran in a browser. The
  // modal counts the field itself; this says what the call did.
  S.choiceQueue.push({
    kind: "highestAndBest", plId: pl.id, walked, gained,
    text: `The deadline on ${pl.listing.address} passed.${walked ? ` ${walked} buyer${walked === 1 ? "" : "s"} withdrew rather than answer.` : " Everybody answered."}${gained > 0 ? ` The top of the table moved up ${fmtMoney(gained)}.` : " Nobody moved."}`,
  });
  return { answers, field, gained, walked };
}

/** One line per row, for the modal and for the ledger. */
export function describeRow(row) {
  const a = DB.agents[row.offer.agentId];
  const terms = `${financingType(row.offer.financing).label}${row.offer.inspection === false ? ", inspection waived" : ""}, ${row.offer.closeDays}d`;
  if (!row.clause) return `${fmtMoney(row.final)} — ${a.name} (${terms}).`;
  if (row.capped) return `${fmtMoney(row.final)} — ${a.name} (${terms}). Clause capped at ${fmtMoney(row.clause.cap)}: it wanted to beat ${fmtMoney(row.beat)} and ran out of room.`;
  return `${fmtMoney(row.final)} — ${a.name} (${terms}). Wrote ${fmtMoney(row.base)}, escalated ${fmtMoney(row.clause.increment)} over ${fmtMoney(row.beat)}.`;
}
