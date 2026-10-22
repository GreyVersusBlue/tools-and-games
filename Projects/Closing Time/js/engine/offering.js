// offering.js — the listing side of the commercial tier: a seller's building
// through prep, the market and a contract (DESIGN-seller-commercial.md 5.2,
// #1010). commercial.js holds the arithmetic and writes nothing; this file is
// the flows, so it is where the state changes, the Ledger lines and the dice
// are. seller.js hands a building here at the top of each function a building
// takes a different road through.
//
// The dice are the ones the house flow already rolls: when an offer arrives and
// from whom, the investor's kind and terms, the counter, and whether a buyer
// walks when a retrade is refused (CT-10). Due diligence and the bank resolve
// with no call to rand() (#511's rule, on this side too).
import { DB, fmtMoney } from "../data.js";
import { S, uid, log, addRep, addXP, addCash, rand, randInt, randRange, pick, scheduleItem, contentClient, getClientRec, isWeekend } from "../state.js";
import { marketHeat, bumpKnowledge } from "./market.js";
import { satisfactionDelta, rollReferral } from "./clients.js";
import { pickHook } from "./deals.js";
import { clauseFor, resolveHighestAndBest } from "./escalation.js";
import { failSellerDeal, INSPECTION_WALK } from "./seller.js";
import {
  PACKET, INVESTORS, SELLER_SIDE, isBuilding, rollVerified, packetNoi, packetIdx, packetValue,
  marketCap, bovWeightNow, sellerExpectation, sellerFloor, sellerNet, investorPrice, dueDiligence, sellerLoanTest,
  goLiveBlockers, canCure, cureDays, offerCeiling, sideRate, sizingPrice, DEBT,
} from "./commercial.js";

/** What the player reads for each kind of investor and each memorandum tier. */
export const INVESTOR_LABEL = { "value-add": "value-add investor", exchange: "1031 exchange buyer", syndicate: "cash syndicate" };
export const OM_LABEL = ["one-page flyer", "memorandum", "memorandum and data room"];

const recOf = pl => getClientRec(pl.clientRecId);
const recIdOf = pl => { const r = recOf(pl); return r && r.recId; };
const addr = pl => pl.listing.address;

/** The fields a building under a listing agreement carries, fresh (4.3, and `cures` for CT-5). */
export function freshBuildingFields(pl) {
  Object.assign(pl, { rollStartedDay: null, rollReadyDay: null, bovWeight: 0, bovDay: null, staleSteps: 0, tourDay: null,
    tourSpins: 0, preInspected: false, cures: [] });
  return pl;
}

// ------------------------------------------------------------------ prep ---

/** The rent roll: begun today, lands in five days. The UI spends the two actions. */
export function startRentRoll(pl) {
  if (!isBuilding(pl) || Number.isFinite(pl.rollStartedDay)) return false;
  pl.rollStartedDay = S.day;
  pl.rollReadyDay = S.day + PACKET.rollDays;
  scheduleItem(pl.rollReadyDay, `Rent roll due — ${addr(pl)}`, "rentRoll", pl.id);
  log(`Rent roll begun at ${addr(pl)}: every lease pulled, every tenant asked to sign what they pay. It lands on day ${pl.rollReadyDay}.`, "", undefined, recIdOf(pl));
  return true;
}

/** The condition report: $1,800, immediate. Shows the agent what an engineer finds. */
export function orderConditionReport(pl) {
  if (!isBuilding(pl) || pl.preInspected) return false;
  addCash(-PACKET.reportCost, `condition report at ${addr(pl)}`, recIdOf(pl));
  pl.preInspected = true;
  const found = pl.listing.issues.filter(is => is.discovery === "inspection");
  log(`Condition report on ${addr(pl)}: ${found.length ? found.map(is => `${is.desc} (${fmtMoney(is.repairCost)})`).join("; ") : "nothing the walk did not show"}.`,
    "", undefined, recIdOf(pl));
  return true;
}

/** The opinion of value. Fixes `w` today; the UI spends the action. */
export function presentOpinion(pl) {
  if (!isBuilding(pl)) return null;
  const before = sellerExpectation(pl);
  pl.bovWeight = bovWeightNow(pl);
  pl.bovDay = S.day;
  const after = sellerExpectation(pl);
  const name = contentClient(recOf(pl)).name;
  log(`Opinion of value on ${addr(pl)}: you walk ${name} through the income and the cap rate. They came in expecting ${fmtMoney(before)} and now expect ${fmtMoney(after)}.`,
    "", undefined, recIdOf(pl));
  return { before, after, w: pl.bovWeight };
}

/** CT-5: cure item `i` before the sale. The seller pays; it costs days in prep. The UI spends the action. */
export function startCure(pl, i) {
  if (!canCure(pl, i)) return false;
  const is = pl.listing.issues[i];
  const readyDay = S.day + cureDays(is.repairCost);
  pl.cures.push({ idx: i, startedDay: S.day, readyDay });
  scheduleItem(readyDay, `Cure done — ${addr(pl)}`, "cure", pl.id);
  log(`Cure ordered at ${addr(pl)}: ${is.desc}. ${fmtMoney(is.repairCost)} of the seller's money, done on day ${readyDay}; the building does not go live before then.`,
    "", undefined, recIdOf(pl));
  return true;
}

/**
 * Going live. Refused while goLiveBlockers() has a sentence (CT-4: the roll
 * must have landed; CT-5: no cure under way) or the memorandum costs more than
 * the agent has. The memorandum is fronted by the agent (CT-3), and a
 * brokerage's photo-tier perk gives one tier free, as on a house.
 */
export function goLiveBuilding(pl, price, omTier) {
  const why = goLiveBlockers(pl);
  if (why.length) return { refused: true, why };
  const tier = Math.max(0, Math.min(2, Math.round(omTier) || 0));
  const cost = PACKET.omCost[tier];
  if (cost > S.cash) return { refused: true, why: [`The ${OM_LABEL[tier]} costs ${fmtMoney(cost)} and you have ${fmtMoney(S.cash)}.`] };
  if (cost) addCash(-cost, `${OM_LABEL[tier]} for ${addr(pl)}`, recIdOf(pl));
  const bk = DB.brokerages[S.brokerageId];
  const free = (bk.perks || []).some(p => p.includes("photo tier")) ? 1 : 0;
  pl.price = price; pl.status = "live"; pl.liveDay = S.day; pl.staged = 0;
  pl.marketingTier = Math.min(2, tier + free);
  log(`LIVE: ${addr(pl)} offered at ${fmtMoney(price)} on a ${OM_LABEL[pl.marketingTier]}.`, "deal", undefined, recIdOf(pl));
  const exp = sellerExpectation(pl);
  if (price < exp * SELLER_SIDE.underAskPct) satisfactionDelta(recOf(pl), -4, "an asking price under what they expect");
  return { live: true };
}

// ------------------------------------------------------------------ tour ---

/**
 * The investor tour (2.6, CT-6), in place of the open house: a weekday walk of
 * a live building for the buyers who asked for the memorandum. Two actions
 * (the UI spends them), once in any `TOUR.everyDays`. Not on a flyer: nobody
 * who only read a flyer asked to see the boiler room.
 */
export const TOUR = { actions: 2, everyDays: 7, interest: 2.0, perOm: 0.5, xp: 10, knowledge: 0.5, straightRep: 2, spinRep: -3 };

/** Why a tour cannot happen today, in sentences; empty means it can. */
export function tourBlockers(pl, day = S.day) {
  if (!isBuilding(pl)) return ["Only a building gets an investor tour."];
  if (pl.status !== "live") return ["The building is not live."];
  const why = [];
  if (!(pl.marketingTier >= 1)) why.push("A flyer brings nobody to tour: it takes a memorandum.");
  if (isWeekend(day)) why.push("Investors tour on weekdays.");
  if (Number.isFinite(pl.tourDay) && day < pl.tourDay + TOUR.everyDays) why.push(`The last tour was day ${pl.tourDay}; the next can be day ${pl.tourDay + TOUR.everyDays}.`);
  return why;
}

/** The one question from the room, the open house's honesty test on a building. */
export const tourQuestion = pl =>
  `A buyer's analyst stops you on the roof of ${addr(pl)}: "So what is wrong with it? Every building has a number the memorandum leaves out."`;

/**
 * The tour itself. Interest +2.0 and +0.5 a memorandum tier, 10 XP and half a
 * point of neighborhood knowledge, as an open house pays. `answer` is
 * "straight" (+2 reputation) or "spin": the first spin on a listing passes,
 * the second and every one after costs 3 (the open house's rule, where it is
 * the second spin that is noticed). No rand().
 */
export function investorTour(pl, answer) {
  if (tourBlockers(pl).length) return null;
  const rec = recOf(pl), recId = rec && rec.recId;
  const gain = TOUR.interest + TOUR.perOm * pl.marketingTier;
  pl.interest += gain;
  pl.tourDay = S.day;
  addXP(TOUR.xp, `walked investors through ${addr(pl)}`, recId);
  bumpKnowledge(pl.listing.neighborhood, TOUR.knowledge);
  if (answer === "spin") {
    pl.tourSpins = (pl.tourSpins || 0) + 1;
    if (pl.tourSpins >= 2) addRep(TOUR.spinRep, `a second tour of ${addr(pl)} answered with spin, and the analysts compare notes`, recId);
  } else addRep(TOUR.straightRep, `straight answers on the roof of ${addr(pl)}`, recId);
  log(`Investor tour at ${addr(pl)}: interest +${gain.toFixed(1)}.`, "deal", undefined, recId);
  return { gain };
}

// ----------------------------------------------------------------- daily ---

/**
 * Every day for a building. In prep: the day the roll lands, one line naming
 * any lease item it turned up; the day a cure finishes, one line. Live: the
 * highest-and-best deadline, days on market, interest, the offer roll and the
 * 21-day step (2.3).
 */
export function dailyBuildingTick(pl) {
  if (pl.status === "prep") {
    if (pl.rollReadyDay === S.day) {
      const leases = pl.listing.issues.filter(is => is.topic === "leases" && is.discovery !== "visible");
      log(`Rent roll in on ${addr(pl)}: the income is verified against the leases.${leases.length ? ` It turned up ${leases.map(is => `${is.desc} (${fmtMoney(is.repairCost)})`).join("; ")}.` : ""}`,
        leases.length ? "bad" : "", undefined, recIdOf(pl));
    }
    for (const c of pl.cures || []) {
      if (c.readyDay === S.day) log(`Cure done at ${addr(pl)}: ${pl.listing.issues[c.idx].desc}. It is off the building.`, "", undefined, recIdOf(pl));
    }
    return;
  }
  if (pl.status !== "live") return;
  if (Number.isFinite(pl.hbDeadline) && S.day >= pl.hbDeadline) resolveHighestAndBest(pl);
  pl.dom++;
  const heat = marketHeat(pl.listing.neighborhood);
  const ratio = pl.price / Math.max(1, packetValue(pl));
  const gain = PACKET.pace * (1.2 * heat * (1.25 - ratio) + PACKET.omGain * pl.marketingTier + (rollVerified(pl) ? PACKET.verifiedGain : 0));
  pl.interest = Math.max(0, pl.interest + gain);
  const offerChance = Math.min(0.5, Math.max(0, (pl.interest - 3) * 0.06)) * (isWeekend(S.day) ? 0.6 : 1);
  if (rand() < offerChance) spawnInvestorOffer(pl);
  if (pl.dom % SELLER_SIDE.staleDays === 0) {
    pl.staleSteps = (pl.staleSteps || 0) + 1;
    log(`${addr(pl)}: ${pl.dom} days live and nothing signed. ${contentClient(recOf(pl)).name} comes down to ${fmtMoney(sellerExpectation(pl))} on their own, and does not enjoy it.`,
      "bad", undefined, recIdOf(pl));
    satisfactionDelta(recOf(pl), -6, "the building sitting");
  }
}

/** The kinds of investor this memorandum tier reaches. */
export const reachedKinds = tier => Object.keys(INVESTORS).filter(k => INVESTORS[k].minOm <= tier);

/**
 * An investor's offer. A kind by weight among those the memorandum reaches, a
 * rival agent as on a house, the yield they need drawn in their band, spare
 * equity drawn as a share of the price. `uw` fixes what it was written on.
 */
export function spawnInvestorOffer(pl) {
  const kinds = reachedKinds(pl.marketingTier);
  let r = rand() * kinds.reduce((s, k) => s + INVESTORS[k].weight, 0);
  const kind = kinds.find(k => (r -= INVESTORS[k].weight) < 0) || kinds[kinds.length - 1];
  const inv = INVESTORS[kind];
  const agents = Object.values(DB.agents).filter(a => a.id !== "ag_ruth_okafor" || rand() < 0.5);
  const agent = pick(agents);
  const reqCap = marketCap(pl.listing) + randRange(inv.spread[0], inv.spread[1]);
  const { yieldPrice, price } = investorPrice(pl, reqCap);
  const spareEquity = Math.round(price * randRange(inv.equity[0], inv.equity[1]) / 1000) * 1000;
  const days = SELLER_SIDE.closeDays[inv.financing];
  const offer = {
    id: uid("off"), agentId: agent.id, price, investor: kind, financing: inv.financing, spareEquity,
    inspection: false, closeDays: randInt(days[0], days[1]), day: S.day, status: "open",
    uw: { noi: packetNoi(pl), reqCap, capexIdx: packetIdx(pl), yieldPrice },
    escalation: null,
  };
  // A clause on a building stops where a counter would: at the investor's ceiling.
  if (rand() < 0.4) offer.escalation = clauseFor(agent, price, offerCeiling(offer, agent) / 1.07);
  pl.offers.push(offer);
  log(`Offer in on ${addr(pl)}: ${fmtMoney(price)} from ${agent.name} for a ${INVESTOR_LABEL[kind]} (${inv.financing === "cash" ? "cash" : "commercial loan"}). "${pickHook(agent, "greeting")}"`,
    "deal", undefined, recIdOf(pl));
  scheduleItem(S.day + 2, `Offer deadline — ${addr(pl)} (${agent.name})`, "offerDeadline", offer.id);
  return offer;
}

/** Everything the offer row prints about one offer on a building, so the UI does no arithmetic. */
export function offerRowFacts(pl, offer, atPrice = offer.price) {
  const t = sellerLoanTest(pl, { ...offer, price: atPrice });
  const exp = sellerExpectation(pl), floor = sellerFloor(pl), net = sellerNet(pl, atPrice);
  return {
    kind: INVESTOR_LABEL[offer.investor] || offer.investor,
    yieldAt: atPrice > 0 ? packetNoi(pl) / atPrice : 0,
    cash: offer.financing === "cash", dscr: t.dscr, minDscr: DEBT.minDscr, sizes: t.sizes, shortfall: t.shortfall, covered: t.covered,
    room: offer.financing === "cash" ? 0 : sizingPrice(pl.listing) - atPrice,
    spare: offer.spareEquity || 0,
    capexItems: ((offer.uw && offer.uw.capexIdx) || []).length,
    expectation: exp, floor, net,
    read: net >= exp ? "At or over what they expect." : net >= floor ? "Under what they expect, over what they will sign." : "Under what they will sign: they will refuse it.",
  };
}

// --------------------------------------------------------- under contract ---

/** The milestones a building's accepted offer puts on the calendar. */
export function buildingMilestones(pl, offer) {
  const base = S.day;
  const wk = d => { while (isWeekend(d)) d++; return d; };
  const ms = [{ day: base + SELLER_SIDE.ddDay, type: "sellerDueDiligence", done: false }];
  if (offer.financing !== "cash") ms.push({ day: wk(base + SELLER_SIDE.bankDay), type: "sellerFinancing", done: false });
  ms.push({ day: base + offer.closeDays, type: "sellerClosing", done: false });
  return ms;
}

/** Due diligence: a line when the packet was the building, otherwise a retrade. No rand(). */
export function resolveDueDiligence(pl, m) {
  const dd = dueDiligence(pl, pl.acceptedOffer);
  if (!dd.cost) {
    log(`Due diligence closes on ${addr(pl)} with no change. The packet was the building.`, "", undefined, recIdOf(pl));
    return null;
  }
  const items = dd.surprises.map(i => `${pl.listing.issues[i].desc} (${fmtMoney(pl.listing.issues[i].repairCost)})`).join("; ");
  const kind = INVESTORS[pl.acceptedOffer.investor] || INVESTORS["value-add"];
  const premium = kind.surprise > 1 ? `the cost, and ${kind.surprise === 1.25 ? "a quarter" : "a half"} again for finding it themselves` : "the cost, to the dollar";
  const ch = {
    kind: "sellerRetrade", plId: pl.id, retrade: dd.retrade, cost: dd.cost, knewRequired: dd.knewRequired,
    text: `The buyer's people at ${addr(pl)} found what the packet did not list: ${items}. They want ${fmtMoney(dd.retrade)} off: ${premium}.`,
  };
  S.choiceQueue.push(ch);
  return ch;
}

/**
 * The retrade. Concede: the price comes down and the seller minds it by the
 * size of the cut. Refuse: the house flow's walk odds by style, plus 0.15
 * (CT-10). Either way the agent loses 6 reputation if they knew a required
 * item and left it out (5.5).
 */
export function retradeDecision(pl, decision, amount, knewRequired) {
  const rec = recOf(pl);
  const offer = pl.acceptedOffer;
  const agent = DB.agents[offer.agentId];
  if (knewRequired) addRep(-6, `you knew what was wrong with ${addr(pl)} and left it out of the packet`, rec && rec.recId);
  if (decision === "concede") {
    const cutPct = Math.round(100 * amount / offer.price);
    offer.price -= amount;
    log(`You advise conceding ${fmtMoney(amount)} on ${addr(pl)}; it closes at ${fmtMoney(offer.price)} if it closes. ${agent.name}: "${pickHook(agent, "accept")}"`,
      "deal", undefined, rec && rec.recId);
    satisfactionDelta(rec, -Math.min(15, 3 + cutPct), "the retrade off their price");
    return { conceded: true };
  }
  const odds = (INSPECTION_WALK[agent.negotiationStyle] || 0.45) + SELLER_SIDE.refuseWalkBonus;
  if (rand() < odds) {
    failSellerDeal(pl, `the buyer walked when the retrade was refused — ${agent.name}: "${pickHook(agent, "reject")}"`);
    return { walked: true };
  }
  log(`${agent.name}'s buyer grumbles and stays at ${fmtMoney(offer.price)}. "${pickHook(agent, "counter")}"`, "", undefined, rec && rec.recId);
  satisfactionDelta(rec, 5, "you holding the line");
  return { stayed: true };
}

/** The bank on a building: arithmetic, no rand(). A line, or a choice when spare equity does not cover it. */
export function resolveSellerLoan(pl, m) {
  const offer = pl.acceptedOffer;
  const t = sellerLoanTest(pl, offer);
  if (t.sizes) {
    log(`The bank sizes the buyer's loan on ${addr(pl)} at ${t.dscr.toFixed(2)}x. Funded.`, "", undefined, recIdOf(pl));
    return null;
  }
  if (t.covered) {
    log(`The bank cuts the buyer's loan on ${addr(pl)} by ${fmtMoney(t.shortfall)}; they put in that much more of their own ${fmtMoney(t.spare)} spare. Funded.`,
      "", undefined, recIdOf(pl));
    return null;
  }
  const ch = {
    kind: "sellerLoanShortfall", plId: pl.id, shortfall: t.shortfall, spare: t.spare, financeablePrice: t.financeablePrice,
    text: `The bank sizes the loan on ${addr(pl)} at ${t.dscr.toFixed(2)}x against a ${DEBT.minDscr.toFixed(2)}x test and cuts it by ${fmtMoney(t.shortfall)}. The buyer has ${fmtMoney(t.spare)} spare. At ${fmtMoney(t.financeablePrice)} the deal finances; at ${fmtMoney(offer.price)} it does not.`,
  };
  S.choiceQueue.push(ch);
  return ch;
}

/** Reprice to what finances (satisfaction as a conceded retrade), or hold and the deal ends with no roll. */
export function sellerLoanDecision(pl, decision) {
  const rec = recOf(pl);
  const offer = pl.acceptedOffer;
  const t = sellerLoanTest(pl, offer);
  if (decision === "reprice") {
    const cut = offer.price - t.financeablePrice;
    const cutPct = Math.round(100 * cut / offer.price);
    offer.price = t.financeablePrice;
    log(`You advise coming down to ${fmtMoney(offer.price)} on ${addr(pl)}, the price the bank will finance.`, "deal", undefined, rec && rec.recId);
    satisfactionDelta(rec, -Math.min(15, 3 + cutPct), "the price the bank set");
    return { repriced: offer.price };
  }
  failSellerDeal(pl, `the seller held ${fmtMoney(offer.price)} and the buyer's bank would not lend against it`);
  return { ended: true };
}

/**
 * Closing on a building: 2% a side before the brokerage's split, 215 XP (CT-8),
 * and the seller scored on what the sale leaves them against what they expect.
 */
export function closeBuilding(pl) {
  const rec = recOf(pl);
  pl.status = "sold";
  const price = pl.acceptedOffer.price;
  const gross = price * sideRate(pl.listing), net = gross * DB.brokerages[S.brokerageId].commissionSplit;
  addCash(net, `listing commission — ${addr(pl)} closed at ${fmtMoney(price)}`, rec.recId);
  S.stats.closed++; S.stats.volume += price;
  addXP(SELLER_SIDE.xp, "closed a building's listing", rec.recId);
  const score = Math.round((sellerNet(pl, price) / Math.max(1, sellerExpectation(pl)) - 0.95) * 100);
  satisfactionDelta(rec, Math.max(SELLER_SIDE.satisfaction[0], Math.min(SELLER_SIDE.satisfaction[1], score)), "the price against what they expected");
  if (pl.dom <= SELLER_SIDE.fastDom) satisfactionDelta(rec, 6, "how fast you moved it");
  rec.status = "closedSeller"; rec.dealId = null;
  addRep(Math.max(1, Math.round((rec.satisfaction - 50) / 8)), `${contentClient(rec).name}'s building sold (satisfaction ${rec.satisfaction})`, rec.recId);
  log(`SOLD: ${addr(pl)} at ${fmtMoney(price)}. The sign comes down; your name stays on the deal sheet.`, "milestone", undefined, rec.recId);
  rollReferral(rec);
}
