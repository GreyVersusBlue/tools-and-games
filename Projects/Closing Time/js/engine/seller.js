// seller.js — listing-side flow: intake, prep (repairs/staging/pricing), marketing,
// NPC buyer-agent offers, open houses, seller-side contingencies & closing.
import { DB, fmtMoney } from "../data.js";
import { S, uid, log, addRep, addXP, addCash, rand, randInt, randRange, pick, scheduleItem, unschedule, contentClient, getClientRec, isWeekend } from "../state.js";
import { playerListingValue, marketHeat, bumpKnowledge } from "./market.js";
import { satisfactionDelta, checkReveals, rollReferral } from "./clients.js";
import { pickHook, sevRank } from "./deals.js";

export function takeListing(rec) {
  const c = contentClient(rec);
  const sl = JSON.parse(JSON.stringify(c.sellerListing));
  const pl = {
    id: uid("pl"), clientRecId: rec.recId, listing: sl,
    status: "prep",             // prep -> live -> underContract -> sold
    price: null, marketingTier: 0, staged: 0, repairsDone: [], disclosed: [],
    interest: 0, offers: [], openHouseBoost: 0, liveDay: null, dom: 0,
  };
  S.playerListings.push(pl);
  rec.dealId = pl.id;
  addXP(15, "took a listing: " + sl.address);
  log(`Listing agreement signed: ${sl.address} for ${c.name}. Now make them proud — or at least solvent.`, "milestone");
  bumpKnowledge(sl.neighborhood, 0.5);
  return pl;
}

export function suggestedPrice(pl) { return Math.round(playerListingValue(pl) / 1000) * 1000; }

export function doRepair(pl, issueIdx) {
  const is = pl.listing.issues[issueIdx];
  pl.repairsDone.push(issueIdx);
  pl.listing.condition = Math.min(1, pl.listing.condition + (sevRank(is) * 0.04));
  log(`Repair completed at ${pl.listing.address}: ${is.desc} (${fmtMoney(is.repairCost)}, seller-funded).`, "");
}

export function setStaging(pl, tier) { pl.staged = tier; } // 0,1,2
export function goLive(pl, price, marketingTier) {
  pl.price = price; pl.marketingTier = marketingTier; pl.status = "live"; pl.liveDay = S.day;
  const bk = DB.brokerages[S.brokerageId];
  const freePhoto = (bk.perks || []).some(p => p.includes("photo tier")) ? 1 : 0;
  pl.marketingTier = Math.min(2, marketingTier + freePhoto);
  log(`LIVE: ${pl.listing.address} listed at ${fmtMoney(price)}. Photos: ${["phone-camera", "professional", "twilight-drone"][pl.marketingTier]}.`, "deal");
}

export function priceRatio(pl) { return pl.price / Math.max(1, playerListingValue(pl)); }

// Called each day for live listings: build interest, maybe spawn an NPC offer.
export function dailySellerTick(pl) {
  if (pl.status !== "live") return;
  pl.dom++;
  const heat = marketHeat(pl.listing.neighborhood);
  const ratio = priceRatio(pl);
  // Interest accrues faster when priced at/below value, marketed, staged.
  let gain = 1.2 * heat * (1.25 - ratio) + pl.marketingTier * 0.25 + pl.staged * 0.2 + pl.openHouseBoost;
  pl.openHouseBoost = Math.max(0, pl.openHouseBoost - 0.3);
  pl.interest = Math.max(0, pl.interest + gain);
  const offerChance = Math.min(0.5, Math.max(0, (pl.interest - 3) * 0.06)) * (isWeekend(S.day) ? 0.6 : 1);
  if (rand() < offerChance) spawnNPCOffer(pl);
  // Stale-listing feedback
  if (pl.dom === 21 && !pl.offers.length && ratio > 1.05) {
    log(`${pl.listing.address}: three weeks, no offers. The market has reviewed your price and left no tip.`, "bad");
    const rec = getClientRec(pl.clientRecId);
    satisfactionDelta(rec, -6, "the listing sitting");
  }
}

export function spawnNPCOffer(pl) {
  const agents = Object.values(DB.agents).filter(a => a.id !== "ag_ruth_okafor" || rand() < 0.5);
  const agent = pick(agents);
  const value = playerListingValue(pl);
  const styleMult = { lowballer: randRange(0.86, 0.93), "by-the-book": randRange(0.94, 0.99), charmer: randRange(0.92, 0.98),
    stonewall: randRange(0.95, 1.0), shark: randRange(0.88, 0.96), mentor: randRange(0.95, 1.0) }[agent.negotiationStyle] || 0.95;
  const price = Math.round(Math.min(pl.price * 1.03, value * styleMult * randRange(0.98, 1.04)) / 500) * 500;
  const offer = {
    id: uid("off"), agentId: agent.id, price,
    financing: pick(["conventional", "conventional", "FHA", "cash"]),
    inspection: rand() < 0.85, closeDays: pick([21, 28, 35, 45]),
    day: S.day, status: "open",
    escalation: agent.dirtyTricks && rand() < 0.4 ? Math.round(price * 1.02 / 500) * 500 : null,
  };
  pl.offers.push(offer);
  log(`Offer in on ${pl.listing.address}: ${fmtMoney(price)} from ${agent.name} (${offer.financing}${offer.inspection ? "" : ", inspection waived"}). "${pickHook(agent, "greeting")}"`, "deal");
  scheduleItem(S.day + 2, `Offer deadline — ${pl.listing.address} (${agent.name})`, "offerDeadline", offer.id);
}

export function sellerReaction(pl, offer) {
  // What the seller thinks, given hidden prefs.
  const rec = getClientRec(pl.clientRecId);
  const c = contentClient(rec);
  const notes = [];
  let inclination = (offer.price / pl.price - 0.94) * 10; // >0 leaning yes
  c.hiddenPrefs.forEach((p, i) => {
    if (!rec.revealed.includes(i) || !p.data) return;
    if (p.data.floorPct && offer.price >= pl.price * p.data.floorPct) { inclination += 1; notes.push("Above their true floor — they'd take this if pushed."); }
    if (p.data.familyFloor) { if (offer.price >= p.data.familyFloor) { inclination += 1.5; notes.push("Clears the family-peace number."); } else { inclination -= 1.5; notes.push("Below the number that keeps the siblings quiet."); } }
    if (p.data.sentimentDiscount && DB.agents[offer.agentId].negotiationStyle === "mentor") { inclination += 1; notes.push("They like the sound of this buyer."); }
    if (p.data.teardownAversion && offer.financing === "cash" && offer.price > pl.price) { inclination -= 2; notes.push("Smells like a teardown buyer. Ray's jaw is tight."); }
    if (p.data.carryingCostPerWeek) { inclination += pl.dom / 14; notes.push("Every week costs them real money — speed matters."); }
  });
  return { inclination, notes };
}

export function respondToOffer(pl, offer, action, counterPrice) {
  const agent = DB.agents[offer.agentId];
  const rec = getClientRec(pl.clientRecId);
  unschedule(it => it.ref === offer.id);
  if (action === "reject") { offer.status = "rejected"; log(`Rejected ${agent.name}'s offer on ${pl.listing.address}. "${pickHook(agent, "reject")}"`, ""); return { done: true }; }
  if (action === "accept") { offer.status = "accepted"; return acceptSellerOffer(pl, offer); }
  // Counter
  offer.status = "countered";
  const value = playerListingValue(pl);
  const ceiling = offer.escalation || Math.min(pl.price * 1.02, value * (1 + agent.tolerance) * 1.02);
  if (counterPrice <= ceiling * randRange(0.985, 1.02)) {
    offer.price = counterPrice; offer.status = "accepted";
    log(`${agent.name} takes your counter at ${fmtMoney(counterPrice)}. "${pickHook(agent, "accept")}"`, "deal");
    return acceptSellerOffer(pl, offer);
  }
  if (rand() < 0.45) {
    const mid = Math.round((counterPrice + offer.price) / 2 / 500) * 500;
    offer.price = mid; offer.status = "open";
    log(`${agent.name} counters back at ${fmtMoney(mid)}. "${pickHook(agent, "counter")}"`, "deal");
    return { recounter: mid };
  }
  offer.status = "walked";
  log(`${agent.name}'s buyers walk. "${pickHook(agent, "reject")}"`, "bad");
  return { done: true };
}

function acceptSellerOffer(pl, offer) {
  pl.status = "underContract"; pl.acceptedOffer = offer;
  pl.offers.filter(o => o !== offer && o.status === "open").forEach(o => { o.status = "rejected"; });
  const base = S.day;
  const wk = d => { while (isWeekend(d)) d++; return d; };
  pl.milestones = [];
  if (offer.inspection) pl.milestones.push({ day: base + 3, type: "sellerInspection", done: false });
  if (offer.financing !== "cash") pl.milestones.push({ day: wk(base + 10), type: "sellerFinancing", done: false });
  pl.milestones.push({ day: base + offer.closeDays, type: "sellerClosing", done: false });
  pl.milestones.forEach(m => scheduleItem(m.day, `${m.type.replace("seller", "")} — ${pl.listing.address}`, m.type, pl.id));
  const rec = getClientRec(pl.clientRecId);
  satisfactionDelta(rec, 8, "accepting a solid offer");
  log(`${pl.listing.address} under contract at ${fmtMoney(offer.price)} with ${DB.agents[offer.agentId].name}'s buyers.`, "milestone");
  return { accepted: true };
}

export function resolveSellerMilestone(pl, m) {
  const rec = getClientRec(pl.clientRecId);
  m.done = true;
  if (m.type === "sellerInspection") {
    const undisclosed = pl.listing.issues
      .map((is, i) => ({ is, i }))
      .filter(({ is, i }) => !pl.repairsDone.includes(i) && !pl.disclosed.includes(i) && is.discovery !== "visible");
    if (!undisclosed.length) { log(`Buyer's inspection at ${pl.listing.address}: no surprises. Disclosure pays.`, ""); return; }
    const worst = undisclosed.sort((a, b) => sevRank(b.is) - sevRank(a.is))[0];
    const cost = undisclosed.reduce((s, x) => s + x.is.repairCost, 0);
    S.choiceQueue.push({
      kind: "sellerInspectionHit", plId: pl.id, cost, severity: worst.is.severity,
      undisclosedRequired: undisclosed.some(x => x.is.disclosureRequired),
      text: `The buyer's inspector at ${pl.listing.address} finds: ${undisclosed.map(x => x.is.desc).join("; ")} (est. ${fmtMoney(cost)}). Their agent is on the phone.`,
    });
    return;
  }
  if (m.type === "sellerFinancing") {
    const fail = pl.acceptedOffer.financing === "FHA" ? 0.12 : 0.05;
    if (rand() < fail + Math.max(0, S.market.rate - 6.5) * 0.03) {
      failSellerDeal(pl, "the buyer's financing collapsed");
    } else log(`Buyer financing clear on ${pl.listing.address}.`, "");
    return;
  }
  if (m.type === "sellerClosing") {
    pl.status = "sold";
    const price = pl.acceptedOffer.price;
    const gross = price * 0.03, net = gross * DB.brokerages[S.brokerageId].commissionSplit;
    addCash(net, `listing commission — ${pl.listing.address} closed at ${fmtMoney(price)}`);
    S.stats.closed++; S.stats.volume += price;
    addXP({ starter: 45, mid: 75, luxury: 130 }[pl.listing.tier] || 45, "closed a listing");
    const ratio = price / suggestedPrice(pl);
    satisfactionDelta(rec, Math.round((ratio - 0.95) * 100), "the final price vs what the house was worth");
    if (pl.dom <= 14) satisfactionDelta(rec, 6, "how fast you moved it");
    rec.status = "closedSeller"; rec.dealId = null;
    addRep(Math.max(1, Math.round((rec.satisfaction - 50) / 8)), `${contentClient(rec).name}'s home sold (satisfaction ${rec.satisfaction})`);
    log(`SOLD: ${pl.listing.address} at ${fmtMoney(price)}. Sign comes down; your name stays in the neighborhood.`, "milestone");
    rollReferral(rec);
  }
}

export function sellerInspectionDecision(pl, decision, cost) {
  const rec = getClientRec(pl.clientRecId);
  const offer = pl.acceptedOffer;
  const agent = DB.agents[offer.agentId];
  if (decision === "credit") {
    offer.price -= Math.round(cost * 0.7);
    log(`You concede a ${fmtMoney(Math.round(cost * 0.7))} credit. ${agent.name}: "${pickHook(agent, "accept")}"`, "deal");
    satisfactionDelta(rec, -4, "the credit off their proceeds");
    return;
  }
  if (decision === "refuse") {
    const walkOdds = { lowballer: 0.55, shark: 0.5, stonewall: 0.35, charmer: 0.4, "by-the-book": 0.45, mentor: 0.3 }[agent.negotiationStyle] || 0.45;
    if (rand() < walkOdds) failSellerDeal(pl, `the buyers walked over inspection findings — ${agent.name}: "${pickHook(agent, "reject")}"`);
    else { log(`${agent.name}'s buyers grumble and proceed. "${pickHook(agent, "counter")}"`, ""); satisfactionDelta(rec, 5, "you holding the line"); }
    return;
  }
}

export function failSellerDeal(pl, why) {
  pl.status = "live"; pl.acceptedOffer = null; pl.interest = Math.max(0, pl.interest - 2);
  unschedule(it => it.ref === pl.id);
  const rec = getClientRec(pl.clientRecId);
  satisfactionDelta(rec, -10, "the deal falling through");
  log(`Back on market: ${pl.listing.address} — ${why}.`, "bad");
}

export function discloseIssue(pl, issueIdx) {
  if (!pl.disclosed.includes(issueIdx)) {
    pl.disclosed.push(issueIdx);
    S.stats.honesty++;
    log(`Disclosure filed: "${pl.listing.issues[issueIdx].desc}" now in the listing packet.`, "");
  }
}

// ---------- OPEN HOUSE ----------
export const OH_VISITORS = [
  { kind: "tirekicker", text: "A couple who are 'just looking' and have been 'just looking' since 2019. They ask about the neighbors.", interest: 0.3 },
  { kind: "serious", text: "A pre-approved buyer who measures the hallway with a laser and nods slowly.", interest: 1.4 },
  { kind: "agentless", text: "An unrepresented buyer who loves it. Loves it. Asks what 'escrow' means.", interest: 1.0 },
  { kind: "nosy", text: "A neighbor 'checking comps.' Leaves fingerprints on everything and one useful rumor.", interest: 0.2, knowledge: true },
  { kind: "rivalScout", text: "Denny Kessler strolls through, hands in pockets, memorizing your price strategy.", interest: 0.4, rival: true },
  { kind: "sweetFamily", text: "A family whose kid claims a bedroom on sight. The parents exchange The Look.", interest: 1.6 },
  { kind: "skeptic", text: "A buyer's agent leads with: 'So what's WRONG with it?' — the honest-answer test, live.", interest: 0.8, honestyTest: true },
];

export function runOpenHouse(pl) {
  const heat = marketHeat(pl.listing.neighborhood);
  const traffic = Math.max(3, Math.round(3 + heat * 2 + pl.marketingTier + pl.staged));
  const visitors = [];
  for (let i = 0; i < Math.min(7, traffic); i++) visitors.push(pick(OH_VISITORS));
  return { traffic, visitors };
}

export function finishOpenHouse(pl, capturedInterest, honestyChoices) {
  pl.openHouseBoost += capturedInterest * 0.6;
  pl.interest += capturedInterest;
  addXP(10, "hosted an open house at " + pl.listing.address);
  bumpKnowledge(pl.listing.neighborhood, 0.5);
  if (honestyChoices.honest > 0 && honestyChoices.spin === 0) addRep(2, "straight answers at the open house — agents talk");
  if (honestyChoices.spin > 1) addRep(-3, "your open-house spin was noticed. Agents talk about that too");
  log(`Open house wrapped at ${pl.listing.address}: interest +${capturedInterest.toFixed(1)}.`, "deal");
}
