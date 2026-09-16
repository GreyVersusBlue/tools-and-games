// commercial.js — the commercial tier: what a building is worth, what an
// investor will pay for it, and what a bank will lend against it.
//
// This is the last of the README's "next layers" list, and it unlocks at
// Broker-Track (level 4). Everything in here exists because a commercial
// listing does not answer any of the three questions a house answers.
//
// ---------------------------------------------------------------------------
// 1. A building is priced by its income, not by its comps.
//
//    market.js:trueValue() prices a house as `ask × condition × neighborhood
//    drift`: the ask is the seller's opinion and the model nudges it. That is
//    the wrong shape for a building, where the ask is a number somebody
//    divided out of a rent roll and every buyer can do the same division. So
//    value here is NOI ÷ cap rate, and the ask is not an input to it at all.
//    A commercial listing can be 30% overpriced and the model will say so
//    flatly, which is the whole point of the tier: the arithmetic is public
//    and the argument is about the inputs.
//
// 2. The problems are a line item, not a haircut.
//
//    A house's issues move value through `condition`, in aggregate, as a
//    percentage. A buyer of a building underwrites capex line by line, so
//    deferred capital comes straight off the value in dollars. The market
//    knows all of it; the player knows what they have discovered, which is
//    what makes a $46,000 roof worth asking a question about.
//
// 3. Rates move a building more than they move a house.
//
//    A house's ask barely notices the headline rate — `marketHeat` drags
//    demand a little and that is all. A cap rate tracks the cost of debt, so
//    a point of rate is 50 bp of cap, and 50 bp on an 8% cap is a 6% swing in
//    value. This is the axis the tier adds to the weekly market tick, and a
//    career that sits on a listing for two months of rate drift will feel it.
//
// The decision the tier is actually built around is in dscrAt()/sizingPrice():
// **a commercial financing milestone is a calculation, not a roll.** See there.

import { DB } from "../data.js";
import { S } from "../state.js";

/** The rate a career starts at. Cap-rate adjustments are measured from here. */
export const RATE_ANCHOR = 6.4;

/** How the market cap rate moves off a listing's own `marketCap`. */
export const CAP_PER_RATE_POINT = 0.005; // a point of headline rate is 50 bp of cap
export const CAP_PER_NB_POINT = 0.02;    // a 10% hotter neighborhood compresses the cap 20 bp
export const CAP_PER_ROLL = 0.01;        // a rent roll entirely expiring this year is worth 100 bp
export const CAP_FLOOR = 0.045;
export const CAP_CEIL = 0.14;

/**
 * The bank. Not a per-listing dial and not authored in content: every
 * commercial loan in Alder Falls is the same loan, so the player can learn it
 * once and then do the arithmetic in their head on the next building.
 *
 * `spread` is over the headline residential rate the rest of the game already
 * tracks, so one number in S.market.rate moves both sides of the tier: it
 * widens cap rates (down goes value) and it raises debt service (down goes
 * what sizes). Those two are not the same squeeze and they do not arrive on
 * the same day.
 */
export const DEBT = {
  ltv: 0.70,
  spread: 0.75,
  amortYears: 25,
  minDscr: 1.20,
};

/** Commercial side commission. Lower rate, much larger numbers. */
export const SIDE_COMMISSION = { residential: 0.03, commercial: 0.02 };

/** Question topics that mean something on a building. See deals.js:askTopics. */
export const COMMERCIAL_TOPICS = ["roof", "zoning", "environmental", "parking", "leases", "hvac"];

export const isCommercial = l => !!(l && l.tier === "commercial" && l.commercial);
export const isCommercialClient = c => !!(c && c.tier === "commercial");
/** The side commission rate for whatever kind of listing this is. */
export const sideRate = l => isCommercial(l) ? SIDE_COMMISSION.commercial : SIDE_COMMISSION.residential;

/**
 * Net operating income, annual. Gross rent less physical vacancy less the
 * landlord's operating expenses. No debt in it — that is the point of the
 * number, and it is why the same building has one NOI and a different DSCR
 * for every buyer.
 */
export function noi(listing) {
  const c = listing.commercial;
  return Math.round(c.grossRent * (1 - c.vacancy) - c.opex);
}

/** Every dollar of deferred capital in the building. The market knows all of it. */
export function deferredCapex(listing) {
  return (listing.hiddenIssues || []).reduce((s, is) => s + (is.repairCost || 0), 0);
}

/** The dollars of that the player has actually turned up for this client. */
export function knownCapex(rec, listing) {
  const known = (rec && rec.knownIssues[listing.id]) || [];
  return known.reduce((s, i) => s + ((listing.hiddenIssues[i] || {}).repairCost || 0), 0);
}

/**
 * The cap rate this building trades at today: its own asset-class rate, plus
 * what the headline rate has done since day one, less what the neighborhood
 * has done, plus a premium for a rent roll that expires inside the year.
 *
 * Rising cap rate means falling value. Both of the first two terms are signed
 * that way on purpose: rates up is value down, neighborhood up is value up.
 */
export function marketCap(listing) {
  const c = listing.commercial;
  const nbMult = S.market.nb[listing.neighborhood] || 1;
  const cap = c.marketCap
    + (S.market.rate - RATE_ANCHOR) * CAP_PER_RATE_POINT
    - (nbMult - 1) * CAP_PER_NB_POINT
    + (c.rollPct || 0) * CAP_PER_ROLL;
  return Math.min(CAP_CEIL, Math.max(CAP_FLOOR, cap));
}

/** What the building is worth. NOI over the cap rate, less the deferred capital. */
export function commercialValue(listing) {
  return Math.round(noi(listing) / marketCap(listing) - deferredCapex(listing));
}

/** The yield a buyer gets at a given price. The number an investor argues about. */
export const capAt = (listing, price) => price > 0 ? noi(listing) / price : 0;

/**
 * The annual constant on a fully-amortizing loan: what one dollar of debt
 * costs per year in principal and interest. 25 years, monthly, at the
 * headline rate plus the commercial spread.
 */
export function loanConstant(ratePct = S.market.rate + DEBT.spread, years = DEBT.amortYears) {
  const i = ratePct / 100 / 12;
  const n = years * 12;
  if (i <= 0) return 12 / n;
  return 12 * i / (1 - Math.pow(1 + i, -n));
}

/** Annual principal and interest on a 70% loan at this price. */
export const debtService = price => price * DEBT.ltv * loanConstant();

/**
 * Debt service coverage: NOI over what the loan costs per year. The bank's
 * entire question, and the one number a commercial buyer's agent is supposed
 * to be able to produce in the car.
 *
 * **A commercial financing milestone is a calculation, not a roll** — this is
 * the decision the tier is built around. Every other way a deal dies in this
 * game is a die: `resolveFinancing` rolls a fall-through chance, the appraisal
 * rolls noise around a modeled value, an inspection surfaces authored issues.
 * A commercial loan does not fall through for a reason the player could not
 * have seen. It sizes at 1.20x or it does not, off numbers that are on the
 * listing flyer from the first day, and if it does not size the shortfall is
 * the exact dollar gap rather than a bad Tuesday. The player who does the
 * arithmetic before writing the offer never meets this milestone at all,
 * which is the intended lesson of the tier.
 */
export const dscrAt = (listing, price) => {
  const ds = debtService(price);
  return ds > 0 ? noi(listing) / ds : Infinity;
};

/**
 * The highest price this building finances at today's rate: the price whose
 * debt service is exactly NOI ÷ 1.20. Above it the bank cuts the loan and the
 * buyer covers the difference in cash or the deal renegotiates down to here.
 */
export function sizingPrice(listing) {
  const k = loanConstant();
  if (k <= 0) return Infinity;
  return Math.round(noi(listing) / DEBT.minDscr / k / DEBT.ltv);
}

/**
 * The shortfall at a price the loan does not cover: what the bank will not
 * lend that the buyer expected it to. Zero when the deal sizes.
 */
export function loanShortfall(listing, price) {
  if (dscrAt(listing, price) >= DEBT.minDscr) return 0;
  const expected = price * DEBT.ltv;
  const sized = (noi(listing) / DEBT.minDscr) / loanConstant();
  return Math.max(0, Math.round(expected - sized));
}

/**
 * What this investor will pay for this building. Two walls, and the lower one
 * binds:
 *
 *   their required yield — NOI ÷ minCap, less the capital the player has
 *   turned up, because an investor prices repairs into the offer rather than
 *   asking for a credit afterwards; and
 *
 *   their money — `rec.budget`, the same wall every buyer in the game has.
 *
 * The interesting case is the first one binding well under the second, which
 * is most of them: a commercial buyer walking away from a building they could
 * easily afford is the tier working, not a bug.
 */
export function requiredCap(rec) {
  const c = DB.clients[rec.clientId];
  const v = c && c.statedReqs ? c.statedReqs.minCap : null;
  return Number.isFinite(v) ? v : 0.075;
}

export function investorCeiling(rec, listing) {
  const minCap = requiredCap(rec);
  const byYield = noi(listing) / minCap - knownCapex(rec, listing);
  return Math.max(0, Math.round(Math.min(rec.budget, byYield)));
}

/**
 * Everything the offer screen needs about a price, in one call, so the UI does
 * no arithmetic of its own and the smoke test checks the same numbers the
 * player reads.
 */
export function underwrite(rec, listing, price) {
  const ceiling = rec ? investorCeiling(rec, listing) : null;
  return {
    noi: noi(listing),
    cap: marketCap(listing),
    value: commercialValue(listing),
    capAtPrice: capAt(listing, price),
    dscr: dscrAt(listing, price),
    sizes: dscrAt(listing, price) >= DEBT.minDscr,
    sizingPrice: sizingPrice(listing),
    shortfall: loanShortfall(listing, price),
    debtService: Math.round(debtService(price)),
    ceiling,
    overCeiling: ceiling !== null && price > ceiling,
    capex: deferredCapex(listing),
    knownCapex: rec ? knownCapex(rec, listing) : 0,
  };
}

/** Percent, one decimal, for anything printing a cap rate or a DSCR. */
export const pct = x => (x * 100).toFixed(2) + "%";
export const dscrText = d => Number.isFinite(d) ? d.toFixed(2) + "x" : "—";
