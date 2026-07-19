// calendar.js — the day-by-day spine: advancing time, resolving milestones, deadlines, weekly ticks.
import { DB, fmtMoney } from "../data.js";
import { S, log, save, rand, pick, isWeekend, dayName, weekOf, contentClient, getClientRec, addRep } from "../state.js";
import { weeklyMarketTick } from "./market.js";
import { maybeFireEvent } from "./events.js";
import { resolveMilestone } from "./deals.js";
import { dailySellerTick, resolveSellerMilestone } from "./seller.js";
import { patienceTick } from "./clients.js";

export const SLOTS_PER_DAY = 4;

export function spendSlots(n = 1) {
  if (S.slotsLeft < n) return false;
  S.slotsLeft -= n;
  return true;
}

export function endDay() {
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
    if (o.status === "open" && S.day > o.day + 2) {
      o.status = "expired";
      log(`Offer expired unanswered on ${pl.listing.address} — ${DB.agents[o.agentId].name} pulls it. Deadlines have consequences.`, "bad");
      addRep(-3, "you let an offer deadline lapse");
    }
  }));

  // Stale offerPending buyer deals (agent never got an answer to a counter)
  S.deals.filter(d => d.stage === "offerPending" && S.day > d.createdDay + 3).forEach(d => {
    d.stage = "dead";
    const rec = getClientRec(d.clientRecId); if (rec) rec.dealId = null;
    log(`Your offer on ${DB.listings[d.listingId].address} withered on the vine. ${DB.agents[d.agentId].name} moved on.`, "bad");
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
  if ((bk.perks || []).some(p => p.includes("free lead")) && S.clientQueue.length) {
    const id = pick(S.clientQueue);
    S.choiceQueue.push({ kind: "referralArrive", clientId: id, referredBy: { name: "Deb at the front desk", rel: "office lead" },
      text: `Deb at the front desk waves you over Monday morning: "Got a live one for you, hon." (${DB.clients[id].name}.)` });
  }
  if ((bk.perks || []).some(p => p.includes("reputation floor")) && S.rep < 10) S.rep = 10;
}
