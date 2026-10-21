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
export function marketCap(listing, market = S.market) {
  const c = listing.commercial;
  const nbMult = market.nb[listing.neighborhood] || 1;
  const cap = c.marketCap
    + (market.rate - RATE_ANCHOR) * CAP_PER_RATE_POINT
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

// ---------------------------------------------------------------------------
// The listing side: a seller's building (DESIGN-seller-commercial.md, #1009).
//
// Offers are written on the packet, and closings happen on the building. The
// packet is what the agent has put on paper: the income and the capital items
// in it. Everything below is arithmetic on a player listing `pl` whose
// `listing` is a seller's building, read off the save and the content and
// nothing else: no rand(), no log, no state written. The flows that move a
// listing through prep, the market and a contract call these (session 2).
//
// Two of Devon's answers of 2026-10-21 (#1008) changed the design, and both
// are carried here rather than in the design's body text:
//
// - CT-4. The rent roll is required before a building goes live. There is no
//   unverified income and no 6% haircut: an offer is only ever written on a
//   live listing, so every offer reads the whole net income. The roll's other
//   two effects stand: it shows the agent the lease items, and it makes an
//   opinion of value count for more.
// - CT-5. Curing a defect before the sale is a trade that costs days. In
//   dollars it is a wash: the seller pays the cost, the item comes off the
//   building, and the seller's expectation and net read as if the item had
//   gone in the packet. What it costs is time in prep (cureDays()), because a
//   building does not go live with a cure under way.

/** Prep. `rollActions` are spent the day the rent roll is begun; it lands `rollDays` later. */
export const PACKET = { rollActions: 2, rollDays: 5,
  reportCost: 1800, omCost: [0, 900, 2800], omGain: 0.25, verifiedGain: 0.2, pace: 0.5 };

/**
 * The three kinds of investor on the other side of the table. `spread` is the
 * yield they need over the market cap rate, `equity` what they hold spare as a
 * share of the price, `surprise` what an item the packet left out costs them
 * in due diligence per dollar, `minOm` the memorandum tier that reaches them.
 */
export const INVESTORS = {
  "value-add": { spread: [0.006, 0.014],  financing: "commercial", equity: [0.02, 0.06], surprise: 1.0,  minOm: 0, weight: 3 },
  exchange:    { spread: [-0.002, 0.004], financing: "commercial", equity: [0.10, 0.18], surprise: 1.25, minOm: 1, weight: 2 },
  syndicate:   { spread: [-0.006, 0.0],   financing: "cash",       equity: [0, 0],       surprise: 1.5,  minOm: 2, weight: 1 },
};

export const SELLER_SIDE = { floorPct: 0.90, underAskPct: 0.97, staleDays: 21, staleKeep: 0.75,
  bovBase: 0.5, bovPerKnowledge: 0.1, bovVerified: 0.2, ddDay: 10, bankDay: 20,
  closeDays: { commercial: [45, 60], cash: [21, 30] }, refuseWalkBonus: 0.15,
  satisfaction: [-25, 12], fastDom: 45, xp: 215 };

/**
 * CT-5. A cure takes `minDays` or a day for every `perDay` dollars of the
 * item's cost, whichever is longer: the $3,200 signs five days, the $46,000
 * roof on 212 Ferry St twelve. The seller pays; the agent fronts nothing.
 */
export const CURE = { minDays: 5, perDay: 4000 };

// Who is a seller of a building, and what their building must carry. In
// data.js, which the loader's content pass needs them in, and read from here.
export { sellsBuilding, validCommercialBlock } from "../data.js";

export const isBuilding = pl => !!(pl && isCommercial(pl.listing));

const issuesOf = pl => Array.isArray(pl.listing.issues) ? pl.listing.issues : [];
const today = day => (Number.isFinite(day) ? day : S.day);

/** Day by day: false through day `rollReadyDay - 1`, true from it. */
export const rollVerified = (pl, day = undefined) =>
  Number.isFinite(pl.rollReadyDay) && today(day) >= pl.rollReadyDay;

/** CT-5: days a cure of this many dollars takes. */
export const cureDays = cost => Math.max(CURE.minDays, Math.ceil((cost || 0) / CURE.perDay));

const cureList = pl => Array.isArray(pl.cures) ? pl.cures : [];
/** Indexes into `issues` whose cure has finished by `day`. Gone from the building. */
export const curedIdx = (pl, day = undefined) =>
  cureList(pl).filter(c => today(day) >= c.readyDay).map(c => c.idx);
/** Dollars the seller has paid for cures that have finished by `day`. */
export const curedCost = (pl, day = undefined) =>
  curedIdx(pl, day).reduce((s, i) => s + ((issuesOf(pl)[i] || {}).repairCost || 0), 0);
/** A cure started and not finished by `day`. */
export const cureUnderWay = (pl, day = undefined) => cureList(pl).some(c => today(day) < c.readyDay);

/**
 * `pl.listing` as the shipped buying-side functions read a building: the same
 * object with `hiddenIssues` naming every item still on it. A cured item is off
 * the building, so commercialValue() of this is the true value.
 */
export function buildingOf(pl, day = undefined) {
  const cured = new Set(curedIdx(pl, day));
  return { ...pl.listing, hiddenIssues: issuesOf(pl).filter((_, i) => !cured.has(i)) };
}

/**
 * Whether the agent knows about item `i`. Visible items always; a question
 * item from the walk, except a lease item, which waits for the rent roll; an
 * inspection item once the condition report is in. A lease item is known once
 * the roll lands whatever its discovery says.
 */
export function agentKnows(pl, i, day = undefined) {
  const is = issuesOf(pl)[i];
  if (!is) return false;
  if (is.topic === "leases") return is.discovery === "visible" || rollVerified(pl, day);
  if (is.discovery === "visible" || is.discovery === "question") return true;
  if (is.discovery === "inspection") return !!pl.preInspected;
  return false;
}

/** In the packet: visible, or put there by the agent, and not cured off the building. */
export function inPacket(pl, i, day = undefined) {
  const is = issuesOf(pl)[i];
  if (!is || curedIdx(pl, day).includes(i)) return false;
  return is.discovery === "visible" || (Array.isArray(pl.disclosed) && pl.disclosed.includes(i));
}

/** CT-4: the whole net income. There is no unverified figure to write an offer on. */
export const packetNoi = pl => noi(pl.listing);
export const packetIdx = (pl, day = undefined) => issuesOf(pl).map((_, i) => i).filter(i => inPacket(pl, i, day));
export const packetCapex = (pl, day = undefined) =>
  packetIdx(pl, day).reduce((s, i) => s + (issuesOf(pl)[i].repairCost || 0), 0);
/** What the paper supports: packet income over today's cap rate, less the capital in the packet. */
export const packetValue = (pl, day = undefined) =>
  Math.round(packetNoi(pl) / marketCap(pl.listing) - packetCapex(pl, day));
export const buildingTrueValue = (pl, day = undefined) => commercialValue(buildingOf(pl, day));

/**
 * CT-4: why this building cannot go live today, as sentences; empty when it
 * can. The rent roll must have landed, and no cure may be under way (CT-5).
 */
export function goLiveBlockers(pl, day = undefined) {
  const out = [];
  if (!Number.isFinite(pl.rollStartedDay)) out.push("The rent roll has not been started.");
  else if (!rollVerified(pl, day)) out.push(`The rent roll lands on day ${pl.rollReadyDay}.`);
  const open = cureList(pl).filter(c => today(day) < c.readyDay);
  if (open.length) out.push(`A cure is under way until day ${Math.max(...open.map(c => c.readyDay))}.`);
  return out;
}

/**
 * CT-5: whether item `i` can be cured from here. In prep only, on an item the
 * agent knows, not already cured or curing, with a cost to pay.
 */
export function canCure(pl, i, day = undefined) {
  const is = issuesOf(pl)[i];
  return !!is && pl.status === "prep" && agentKnows(pl, i, day) && (is.repairCost || 0) > 0
    && !cureList(pl).some(c => c.idx === i);
}

/**
 * The `w` an opinion of value presented today would carry: half, a tenth more
 * a whole level of the neighborhood known, a fifth more once the roll is in.
 */
export function bovWeightNow(pl, day = undefined) {
  const k = Math.floor(Math.max(0, Math.min(5, (S.knowledge && S.knowledge[pl.listing.neighborhood]) || 0)));
  // To the hundredth: 0.5 + 0.2 + 0.2 is 0.8999999999999999 in floating point,
  // and w is stored on the listing and printed.
  return Math.min(1, Math.round(100 * (SELLER_SIDE.bovBase + SELLER_SIDE.bovPerKnowledge * k
    + (rollVerified(pl, day) ? SELLER_SIDE.bovVerified : 0))) / 100);
}

/**
 * The value the seller measures against. The packet value, less what the
 * seller has paid for cures (CT-5), so a cured item reads to them as one put in
 * the packet: the same expectation, and the same net, a few days later.
 */
export const sellerBasis = (pl, day = undefined) => packetValue(pl, day) - curedCost(pl, day);

/**
 * What the seller expects: the owner's number, brought toward the basis by an
 * opinion of value and by each 21 days sat. Computed, never stored, so it
 * follows the packet the day an item goes in.
 */
export function sellerExpectation(pl, day = undefined) {
  const basis = sellerBasis(pl, day);
  const owner = Number.isFinite(pl.listing.price) ? pl.listing.price : basis;
  const w = Math.max(0, Math.min(1, Number.isFinite(pl.bovWeight) ? pl.bovWeight : 0));
  const stale = Math.max(0, Math.round(Number.isFinite(pl.staleSteps) ? pl.staleSteps : 0));
  return Math.round(basis + (owner - basis) * (1 - w) * Math.pow(SELLER_SIDE.staleKeep, stale));
}

/** CT-5: what a sale at `price` leaves the seller, after the cures they paid for. */
export const sellerNet = (pl, price, day = undefined) => price - curedCost(pl, day);

/** The seller's own floor, from a hidden preference whether revealed or not, else 90%. */
export function sellerFloorPct(pl, rec = undefined) {
  const r = rec || (S.clients || []).find(x => x && x.recId === pl.clientRecId);
  const c = r && DB.clients[r.clientId];
  for (const p of (c && c.hiddenPrefs) || []) {
    const f = p && p.data && p.data.floorPct;
    if (Number.isFinite(f)) return f;
  }
  return SELLER_SIDE.floorPct;
}
/** Under this net the seller signs nothing. */
export const sellerFloor = (pl, rec = undefined, day = undefined) =>
  Math.round(sellerExpectation(pl, day) * sellerFloorPct(pl, rec));

/**
 * What an investor who needs `reqCap` writes: packet income over that yield,
 * less the packet's capital, no more than 3% over the asking price, to $1,000.
 */
export function investorPrice(pl, reqCap, day = undefined) {
  const yieldPrice = Math.round(packetNoi(pl) / reqCap - packetCapex(pl, day));
  const cap = Number.isFinite(pl.price) && pl.price > 0 ? pl.price * 1.03 : Infinity;
  return { yieldPrice, price: Math.max(0, Math.round(Math.min(yieldPrice, cap) / 1000) * 1000) };
}

/**
 * How far a counter or a highest-and-best call can move an investor: the
 * price their yield wrote, plus half their agent's tolerance. Named apart from
 * the buying side's investorCeiling(), which is a buyer client's wall.
 */
export const offerCeiling = (offer, agent) =>
  Math.round(((offer && offer.uw && offer.uw.yieldPrice) || 0) * (1 + ((agent && agent.tolerance) || 0) / 2));

/**
 * Due diligence: the buyer's people find every item still on the building
 * that the offer was not written with (`offer.uw.capexIdx`, fixed the day it
 * was written). It costs the investor's surprise factor per dollar, to $500.
 * `knewRequired` is the −6 reputation case: a required item the agent knew.
 */
export function dueDiligence(pl, offer, day = undefined) {
  const written = new Set((offer && offer.uw && offer.uw.capexIdx) || []);
  const cured = new Set(curedIdx(pl, day));
  const surprises = issuesOf(pl).map((_, i) => i).filter(i => !cured.has(i) && !written.has(i));
  const cost = surprises.reduce((s, i) => s + (issuesOf(pl)[i].repairCost || 0), 0);
  const kind = INVESTORS[offer && offer.investor] || INVESTORS["value-add"];
  return {
    surprises, cost,
    retrade: Math.round(cost * kind.surprise / 500) * 500,
    knewRequired: surprises.some(i => issuesOf(pl)[i].disclosureRequired && agentKnows(pl, i, day)),
  };
}

/**
 * The bank on a building under contract, at the offer's price. The loan is
 * sized on the building's real income. `financeablePrice` is the most the
 * buyer can pay keeping the 30% they planned and adding what they hold spare.
 */
export function sellerLoanTest(pl, offer) {
  const b = buildingOf(pl);
  const price = offer.price;
  if (offer.financing === "cash") {
    return { dscr: Infinity, sizes: true, shortfall: 0, spare: 0, covered: true, financeablePrice: price };
  }
  const spare = Math.max(0, Number.isFinite(offer.spareEquity) ? offer.spareEquity : 0);
  const shortfall = loanShortfall(b, price);
  const sized = noi(b) / DEBT.minDscr / loanConstant();
  return {
    dscr: dscrAt(b, price), sizes: shortfall === 0, shortfall, spare,
    covered: shortfall <= spare,
    financeablePrice: Math.min(price, Math.round(sized + (1 - DEBT.ltv) * price + spare)),
  };
}
