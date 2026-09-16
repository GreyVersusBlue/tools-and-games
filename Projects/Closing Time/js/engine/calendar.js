// calendar.js — the day-by-day spine: advancing time, resolving milestones, deadlines, weekly ticks.
import { DB, fmtMoney } from "../data.js";
import { S, log, save, rand, pick, isWeekend, dayName, weekOf, contentClient, getClientRec, addRep, levelInfo, enrollFinishedCareer } from "../state.js";
import { weeklyMarketTick } from "./market.js";
import { maybeFireEvent } from "./events.js";
import { resolveMilestone } from "./deals.js";
import { dailySellerTick, resolveSellerMilestone } from "./seller.js";
import { offerDeadlineDay } from "./escalation.js";
import { patienceTick } from "./clients.js";

export const SLOTS_PER_DAY = 4;

/** A one-year career, in days. `seasonOf` in state.js already wraps here. */
export const CAREER_LENGTH_DAYS = 336;

export function spendSlots(n = 1) {
  if (S.slotsLeft < n) return false;
  S.slotsLeft -= n;
  return true;
}

/**
 * Closes the career out at day 336 instead of advancing to a 337th day.
 * `seasonOf` already wraps a four-season year there; nothing else built the
 * ending to match it. Freezes a scorecard rather than computing one on demand
 * so a finished career reads the same numbers on every later visit, even
 * after more log entries or (if the player somehow keeps clicking) more days
 * would otherwise have changed them. The same snapshot is filed in the hall
 * of past careers, so it outlives the "New career" wipe.
 */
function finishCareer() {
  const lv = levelInfo();
  S.scorecard = {
    day: S.day,
    volume: S.stats.volume,
    closings: S.stats.closed,
    referrals: S.stats.referrals,
    finalRep: S.rep,
    level: S.level,
    title: lv.title,
    cash: S.cash,
  };
  S.careerEnded = true;
  log(`Day ${S.day}. The year closes: ${S.stats.closed} closings, ${fmtMoney(S.stats.volume)} in volume, ${S.rep} reputation, ${lv.title}.`, "milestone");
  const entry = enrollFinishedCareer();
  if (entry) log(`The year is filed in your hall as career #${entry.seq}. It survives "New career".`, "milestone");
  save();
}

export function endDay() {
  if (S.careerEnded) return;
  if (S.day >= CAREER_LENGTH_DAYS) { finishCareer(); return; }
  S.day++;
  S.slotsLeft = SLOTS_PER_DAY;
  const monday = (S.day - 1) % 7 === 0;

  if (monday) {
    weeklyMarketTick();
    log(`Week ${weekOf(S.day)} begins. Rates at ${S.market.rate.toFixed(2)}%.`, "");
    maybeFireEvent("weekly", 0.5);
    brokerageMondayPerks();
  }

  // Content listings age; some get bought out from under everyone.
  for (const id in S.listingsState) {
    const ls = S.listingsState[id];
    if (ls.status !== "onMarket") continue;
    ls.dom++;
    if (ls.dom > 45 && rand() < 0.01) { ls.price = Math.round(ls.price * 0.97 / 500) * 500; log(`Price cut: ${DB.listings[id].address} now ${fmtMoney(ls.price)}.`, ""); }
    if (rand() < 0.006) { ls.status = "sold"; log(`Off market: ${DB.listings[id].address} sold to someone else's client. It happens. It stings.`, ""); }
  }

  // Player seller listings tick
  S.playerListings.forEach(dailySellerTick);

  // Due milestones — buyer deals
  S.deals.filter(d => d.stage === "underContract").forEach(d => {
    d.milestones.filter(m => !m.done && m.day <= S.day).forEach(m => resolveMilestone(d, m));
  });
  // Due milestones — seller listings
  S.playerListings.filter(p => p.status === "underContract").forEach(pl => {
    (pl.milestones || []).filter(m => !m.done && m.day <= S.day).forEach(m => resolveSellerMilestone(pl, m));
  });

  // Expired NPC offers on player listings
  S.playerListings.forEach(pl => pl.offers.forEach(o => {
    // Not `o.day + 2` any more: a highest-and-best call moves the deadline out,
    // and expiring the field the call just gathered would take a reputation hit
    // per offer for a deadline the player deliberately set (escalation.js).
    if (o.status === "open" && S.day > offerDeadlineDay(o)) {
      o.status = "expired";
      const sellerRec = getClientRec(pl.clientRecId);
      log(`Offer expired unanswered on ${pl.listing.address} — ${DB.agents[o.agentId].name} pulls it. Deadlines have consequences.`, "bad", undefined, sellerRec && sellerRec.recId);
      addRep(-3, "you let an offer deadline lapse", sellerRec && sellerRec.recId);
    }
  }));

  // Stale offerPending buyer deals (agent never got an answer to a counter)
  S.deals.filter(d => d.stage === "offerPending" && S.day > d.createdDay + 3).forEach(d => {
    d.stage = "dead";
    const rec = getClientRec(d.clientRecId); if (rec) rec.dealId = null;
    log(`Your offer on ${DB.listings[d.listingId].address} withered on the vine. ${DB.agents[d.agentId].name} moved on.`, "bad", undefined, rec && rec.recId);
  });

  // Patience decay every other day for idle buyers
  if (S.day % 2 === 0) {
    S.clients.filter(c => c.status === "active" && !c.dealId).forEach(rec => patienceTick(rec, 1));
  }

  // Daily event roll
  maybeFireEvent("any", 0.3);
  maybeFireEvent("underContract", 0.25);
  maybeFireEvent("offerPending", 0.25);

  S.schedule = S.schedule.filter(it => it.day >= S.day - 1);
  save();
}

function brokerageMondayPerks() {
  const bk = DB.brokerages[S.brokerageId];
  // The lead has to be one this agent could actually take. Before the
  // commercial tier every client in the queue was inside somebody's reach
  // eventually, so a Monday lead could ignore the ladder and nothing showed;
  // now a Rookie Agent handed a 1031 buyer would walk into a modal offering a
  // client the MLS board will not let them work.
  const tiers = levelInfo().tiers;
  const eligible = S.clientQueue.filter(id =>
    tiers.includes(DB.clients[id].tier) || DB.clients[id].type === "seller");
  if ((bk.perks || []).some(p => p.includes("free lead")) && eligible.length) {
    const id = pick(eligible);
    S.choiceQueue.push({ kind: "referralArrive", clientId: id, referredBy: { name: "Deb at the front desk", rel: "office lead" },
      text: `Deb at the front desk waves you over Monday morning: "Got a live one for you, hon." (${DB.clients[id].name}.)` });
  }
  if ((bk.perks || []).some(p => p.includes("reputation floor")) && S.rep < 10) S.rep = 10;
}
