// events.js — data-driven random events. New events are pure JSON reusing these handlers.
import { DB, fmtMoney } from "../data.js";
import { S, log, addRep, rand, randRange, randInt, pick, getClientRec, contentClient, weekOf } from "../state.js";
import { meetClient } from "./clients.js";
import { killDeal } from "./deals.js";

export function eligibleEvents(phase) {
  return Object.values(DB.events).filter(ev => {
    if (ev.phase !== phase && ev.phase !== "any") return false;
    if (ev.minDay && S.day < ev.minDay) return false;
    if (ev.maxDay && S.day > ev.maxDay) return false;
    if (ev.minRep && S.rep < ev.minRep) return false;
    if (ev.minLevel && S.level < ev.minLevel) return false;
    if (S.firedEvents && S.firedEvents[ev.id] && ev.effect.handler === "brokerageRecruit") return false;
    // mode gating: need at least one matching context
    if (ev.mode === "buyer" && !S.deals.some(d => d.mode === "buyer" && ["offerPending", "underContract"].includes(d.stage)) && ["underContract", "offerPending"].includes(ev.phase)) return false;
    if (ev.mode === "seller" && ev.phase === "underContract" && !S.playerListings.some(p => p.status === "underContract")) return false;
    return true;
  });
}

export function maybeFireEvent(phase, chance = 0.35) {
  const pool = eligibleEvents(phase);
  if (!pool.length || rand() > chance) return null;
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let roll = rand() * total;
  let ev = pool[0];
  for (const e of pool) { roll -= e.weight; if (roll <= 0) { ev = e; break; } }
  fireEvent(ev);
  return ev;
}

export function fireEvent(ev) {
  S.firedEvents = S.firedEvents || {};
  S.firedEvents[ev.id] = (S.firedEvents[ev.id] || 0) + 1;
  log(`EVENT — ${ev.name}: ${ev.text}`, "event");
  HANDLERS[ev.effect.handler]?.(ev, ev.effect);
}

const HANDLERS = {
  appraisalGap(ev, fx) {
    const d = pick(S.deals.filter(d => d.stage === "underContract" && !d.waiveAppraisal) || []);
    if (!d) return;
    const gap = Math.round(d.price * randRange(fx.gapPctMin, fx.gapPctMax));
    S.choiceQueue.push({ kind: "appraisalGap", dealId: d.id, gap,
      text: `${ev.text} The gap on ${DB.listings[d.listingId].address}: ${fmtMoney(gap)}.` });
  },
  financingWobble(ev, fx) {
    const d = pick(S.deals.filter(d => d.stage === "underContract"));
    if (!d) return;
    if (rand() < fx.failChance) killDeal(d, "the lender's 'irregularity' was, in fact, regular enough to kill the loan.");
    else {
      d.milestones.filter(m => !m.done).forEach(m => m.day += fx.delayDays);
      log(`The loan survives, but every deadline slides ${fx.delayDays} days.`, "");
    }
  },
  inspectionSurprise(ev, fx) {
    const d = pick(S.deals.filter(d => d.stage === "underContract"));
    if (!d) return;
    const cost = randInt(fx.costMin, fx.costMax);
    S.choiceQueue.push({ kind: "inspectionResult", dealId: d.id, newFinds: [], totalCost: cost,
      severity: cost > 6000 ? "moderate" : "cosmetic",
      text: `${ev.text} An off-list find at ${DB.listings[d.listingId].address}: est. ${fmtMoney(cost)}.` });
  },
  competingOffer(ev, fx) {
    const d = pick(S.deals.filter(d => d.stage === "offerPending"));
    if (!d) return;
    S.choiceQueue.push({ kind: "competingOffer", dealId: d.id, bumpPct: fx.pressurePct,
      text: `${ev.text} (${DB.listings[d.listingId].address}) Raise by ${Math.round(fx.pressurePct * 100)}% to stay in it, stand pat, or walk.` });
  },
  coldFeet(ev, fx) {
    if (ev.mode === "buyer") {
      const d = pick(S.deals.filter(d => d.stage === "underContract"));
      if (!d) return;
      S.choiceQueue.push({ kind: "coldFeet", dealId: d.id, walkChance: fx.walkChance, text: ev.text });
    } else {
      const pl = pick(S.playerListings.filter(p => p.status === "underContract"));
      if (!pl) return;
      S.choiceQueue.push({ kind: "coldFeetSeller", plId: pl.id, walkChance: fx.walkChance, text: ev.text });
    }
  },
  poachAttempt(ev, fx) {
    const rec = pick(S.clients.filter(c => c.status === "active"));
    if (!rec) return;
    S.choiceQueue.push({ kind: "poach", recId: rec.recId, agentId: fx.agentId, resistBase: fx.resistBase,
      text: `${ev.text} The client in question: ${contentClient(rec).name}.` });
  },
  brokerageRecruit(ev, fx) {
    if (S.brokerageId === fx.brokerageId) return;
    S.choiceQueue.push({ kind: "brokerageOffer", brokerageId: fx.brokerageId, text: ev.text });
  },
  rateShift(ev, fx) {
    const d = randRange(fx.deltaMin, fx.deltaMax);
    S.market.rate = Math.max(3.5, Math.min(9.5, S.market.rate + d));
    log(`Mortgage rates now ${S.market.rate.toFixed(2)}%.`, "");
  },
  neighborhoodBuzz(ev, fx) {
    const nbId = pick(Object.keys(DB.neighborhoods));
    S.activeEffects.push({ kind: "buzz", nbId, mult: fx.trendBoost * 40, untilDay: S.day + fx.weeks * 7 });
    log(`The buzz is about ${DB.neighborhoods[nbId].name}. Sellers there are updating their expectations hourly.`, "");
  },
  deadlineSqueeze(ev, fx) {
    S.deals.filter(d => d.stage === "underContract").forEach(d =>
      d.milestones.filter(m => m.type === "inspection" && !m.done).forEach(m => m.day += fx.extraDays));
    log(`Inspection milestones pushed ${fx.extraDays} days. The clock does not care.`, "");
  },
  patienceShift(ev, fx) {
    const rec = pick(S.clients.filter(c => c.status === "active"));
    if (!rec) return;
    const d = randInt(fx.deltaMin, fx.deltaMax);
    rec.patience += d;
    log(`${contentClient(rec).name}'s timeline shifts (${d >= 0 ? "+" : ""}${d} patience).`, "");
  },
  openHouseLowball(ev, fx) { /* consumed live during open house flow via pendingLowball */ 
    S.pendingLowball = { pctMin: fx.pctOfAskMin, pctMax: fx.pctOfAskMax };
  },
  bonusReferral(ev, fx) {
    if (!S.clientQueue.length) return;
    const id = pick(S.clientQueue);
    S.choiceQueue.push({ kind: "referralArrive", clientId: id, referredBy: { name: fx.sourceName, rel: "mentor of sorts" },
      text: `${ev.text} (${DB.clients[id].name}.)` });
  },
};
