// A seeded autopilot that plays a whole career, day 1 to 336, through the
// real endDay() (CT-11, #1011). It answers the question the seller-side
// design could not: the day a career reaches Broker-Track, and with it how
// many buildings a year can hold.
//
//   node tools/autopilot.mjs             20 careers, a line each and the medians
//   node tools/autopilot.mjs --seeds 50
//
// The policy is a competent, unhurried player, written down so it can be
// argued with. Each day, in order:
//   1. Every choice in the queue gets the answer a careful agent gives
//      (take the referral if there is room, a credit for the inspection, cover
//      an appraisal gap only if the buyer can, concede a retrade, come down to
//      what the bank finances, talk a nervous client through it).
//   2. A seller of a house: take the listing, light staging, the inspection,
//      professional photos, asked at the suggested price. A seller of a
//      building: the rent roll and the condition report the day it is taken,
//      everything known put in the packet and an opinion presented the day the
//      roll lands, live on a memorandum at packet value, and an investor tour
//      whenever one can be had.
//   3. An offer on a listing: accept the best one at 95% of the asking price or
//      better, or at 90% once it has been live 30 days.
//   4. A buyer with no deal: a showing of the best-fitting listing they can
//      afford (fit 55 or better), and an offer at 98% of the ask; a counter is
//      taken if it is inside their budget.
//   5. With actions left and room on the roster, meet the next client.
// It uses only what the screens call. No field is set by hand but the seed.
import fs from "fs"; import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { DB } from "../js/data.js";
import { S, newGame, getClientRec, contentClient, activeClients, clientSlotsMax, LEVELS, addCash } from "../js/state.js";
import * as Clients from "../js/engine/clients.js";
import * as Deals from "../js/engine/deals.js";
import * as Seller from "../js/engine/seller.js";
import * as Esc from "../js/engine/escalation.js";
import * as Com from "../js/engine/commercial.js";
import * as Off from "../js/engine/offering.js";
import { endDay, spendSlots } from "../js/engine/calendar.js";

const has = n => S.slotsLeft >= n;

/** 1. The choice queue, answered the way a careful agent answers it. */
function answerChoices() {
  let guard = 0;
  while (S.choiceQueue.length && guard++ < 50) {
    const ch = S.choiceQueue.shift();
    const deal = ch.dealId ? S.deals.find(d => d.id === ch.dealId) : null;
    const pl = ch.plId ? S.playerListings.find(p => p.id === ch.plId) : null;
    switch (ch.kind) {
      case "referralArrive":
        if (!Clients.alreadyMet(ch.clientId) && activeClients().length < clientSlotsMax() && Clients.inReach(ch.clientId)) Clients.meetClient(ch.clientId, ch.referredBy);
        break;
      case "inspectionResult": if (deal) Deals.inspectionDecision(deal, "credit", ch.totalCost); break;
      case "loanShortfall": if (deal) Deals.loanShortfallDecision(deal, "renegotiate", ch.shortfall, ch.sizingPrice); break;
      case "appraisalGap": if (deal) Deals.appraisalDecision(deal, "renegotiate", ch.gap); break;
      case "competingOffer": if (deal) { const r = getClientRec(deal.clientRecId); const rival = Math.round(deal.price * (1 + ch.bumpPct) / 500) * 500; if (r && rival <= r.budget) deal.price = rival; } break;
      case "coldFeet": if (deal) addCash(-120, "emergency reassurance dinner"); break;
      case "coldFeetSeller": if (pl) addCash(-120, "a long talk over coffee"); break;
      case "sellerInspectionHit": if (pl) Seller.sellerInspectionDecision(pl, "credit", ch.cost); break;
      case "sellerRetrade": if (pl) Off.retradeDecision(pl, "concede", ch.retrade, ch.knewRequired); break;
      case "sellerLoanShortfall": if (pl) Off.sellerLoanDecision(pl, "reprice"); break;
      case "poach": addCash(-200, "damage-control dinner"); break;
      default: break; // highestAndBest is only a read; a brokerage offer is declined
    }
  }
}

/** 2 and 3. The listings. */
function workListings() {
  for (const rec of activeClients()) {
    if (contentClient(rec).type !== "seller" || rec.dealId || !has(1)) continue;
    spendSlots(1);
    const pl = Seller.takeListing(rec);
    if (Com.isBuilding(pl)) {
      if (has(Com.PACKET.rollActions)) { spendSlots(Com.PACKET.rollActions); Off.startRentRoll(pl); }
      if (S.cash >= Com.PACKET.reportCost) Off.orderConditionReport(pl);
    } else {
      pl.preInspected = true; Seller.setStaging(pl, 1);
      Seller.goLive(pl, Seller.suggestedPrice(pl), 1);
    }
  }
  for (const pl of S.playerListings) {
    if (!Com.isBuilding(pl) || pl.status !== "prep") continue;
    if (!Number.isFinite(pl.rollStartedDay) && has(Com.PACKET.rollActions)) { spendSlots(Com.PACKET.rollActions); Off.startRentRoll(pl); }
    if (!pl.preInspected && S.cash >= Com.PACKET.reportCost) Off.orderConditionReport(pl);
    if (!Com.rollVerified(pl)) continue;
    pl.listing.issues.forEach((_, i) => { if (Com.agentKnows(pl, i) && !pl.disclosed.includes(i)) Seller.discloseIssue(pl, i); });
    if (!Number.isFinite(pl.bovDay) && has(1)) { spendSlots(1); Off.presentOpinion(pl); }
    const om = S.cash >= Com.PACKET.omCost[1] ? 1 : 0;
    if (Number.isFinite(pl.bovDay)) Seller.goLive(pl, Math.round(Com.packetValue(pl) / 1000) * 1000, om);
  }
  for (const pl of S.playerListings) {
    if (pl.status !== "live") continue;
    if (Com.isBuilding(pl) && !Off.tourBlockers(pl).length && has(Off.TOUR.actions)) { spendSlots(Off.TOUR.actions); Off.investorTour(pl, "straight"); }
    const open = Esc.openOffers(pl).sort((a, b) => b.price - a.price);
    const line = pl.dom >= 30 ? 0.90 : 0.95;
    for (const o of open) {
      if (o.price < pl.price * line || !has(1)) break;
      spendSlots(1);
      const r = Seller.respondToOffer(pl, o, "accept");
      if (!r.refused) break;
    }
  }
}

/** 4. The buyers. */
function workBuyers() {
  const tiers = LEVELS[S.level - 1].tiers;
  for (const rec of activeClients()) {
    if (contentClient(rec).type !== "buyer" || rec.dealId || !has(2)) continue;
    const taken = new Set(S.deals.filter(d => ["offerPending", "underContract"].includes(d.stage)).map(d => d.listingId));
    const options = Object.values(DB.listings)
      .filter(l => S.listingsState[l.id].status === "onMarket" && tiers.includes(l.tier) && !taken.has(l.id))
      .map(l => ({ l, fit: Clients.fitScore(rec, l), ask: S.listingsState[l.id].price }))
      .filter(o => o.fit >= 55 && o.ask * 0.98 <= rec.budget)
      .sort((a, b) => b.fit - a.fit);
    if (!options.length) continue;
    const { l, ask } = options[0];
    spendSlots(1);
    Deals.startViewing(rec, l);
    let price = Math.round(ask * 0.98 / 500) * 500;
    if (Com.isCommercial(l)) price = Math.min(price, Com.investorCeiling(rec, l));
    spendSlots(1);
    const deal = Deals.writeOffer(rec, l, price, { closeDays: 35 });
    const resp = Deals.agentRespond(deal, price);
    if (resp.verdict === "accept") { deal.price = price; Deals.acceptDeal(deal); }
    else if (resp.verdict === "counter" && resp.counter <= rec.budget) { deal.price = resp.counter; Deals.acceptDeal(deal); }
    else { deal.stage = "dead"; rec.dealId = null; }
  }
}

/** 5. Intake. */
function intake() {
  while (has(1) && activeClients().length < clientSlotsMax()) {
    const cand = Clients.nextIntakeCandidate();
    if (!cand) return;
    spendSlots(1);
    Clients.meetClient(cand.id);
  }
}

/** One career. Returns what the hall would file and what the tier asks about. */
export function playCareer(seed) {
  newGame("bk_indep");
  S.seed = ((seed + 1) * 2654435761) % 4294967296;
  const reached = {};
  let guard = 0;
  while (!S.careerEnded && guard++ < 400) {
    answerChoices();
    workListings();
    workBuyers();
    intake();
    for (const L of LEVELS) if (S.level >= L.level && !(L.level in reached)) reached[L.level] = S.day;
    endDay();
    answerChoices();
  }
  const buildings = S.playerListings.filter(Com.isBuilding);
  return {
    seed, day: S.day, level: S.level, xp: S.xp, closed: S.stats.closed, cash: Math.round(S.cash), rep: S.rep, reached,
    buildingsTaken: buildings.length, buildingsSold: buildings.filter(p => p.status === "sold").length,
    buildingSoldDays: buildings.filter(p => p.status === "sold").map(p => p.acceptedOffer && p.liveDay),
  };
}

const med = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** Many careers, and the medians the design's section 6 asks for. */
export function playCareers(seeds) {
  const runs = [];
  for (let s = 0; s < seeds; s++) runs.push(playCareer(s));
  return {
    runs,
    brokerTrackDay: med(runs.map(r => r.reached[4])),
    reachedBrokerTrack: runs.filter(r => 4 in r.reached).length,
    buildingsSold: med(runs.map(r => r.buildingsSold)),
    anyBuildingSold: runs.filter(r => r.buildingsSold > 0).length,
    closed: med(runs.map(r => r.closed)),
  };
}

export function loadData() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const cat of Object.keys(DB)) for (const p of manifest[cat]) {
    const o = JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
    DB[cat][o.id] = o;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--seeds");
  const seeds = i > 0 ? parseInt(process.argv[i + 1], 10) : 20;
  loadData();
  const out = playCareers(seeds);
  for (const r of out.runs) console.log(`seed ${r.seed}: level ${r.level}, ${r.xp} XP, ${r.closed} closed, cash $${r.cash}, rep ${r.rep}; Associate day ${r.reached[2] ?? "-"}, Senior ${r.reached[3] ?? "-"}, Broker-Track ${r.reached[4] ?? "-"}; buildings taken ${r.buildingsTaken}, sold ${r.buildingsSold}`);
  console.log(`median: Broker-Track on day ${out.brokerTrackDay} (${out.reachedBrokerTrack} of ${seeds} reach it), ${out.closed} closings, ${out.buildingsSold} buildings sold (${out.anyBuildingSold} of ${seeds} careers sell one)`);
}
