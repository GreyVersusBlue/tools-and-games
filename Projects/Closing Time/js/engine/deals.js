// deals.js — buyer-side flow: viewings, offers, NPC listing-agent negotiation, contingencies, closing.
import { DB, fmtMoney } from "../data.js";
import { S, uid, log, addRep, addXP, addCash, rand, randInt, randRange, scheduleItem, unschedule, contentClient, isWeekend, getClientRec } from "../state.js";
import { trueValue, appraisalFor, marketHeat, bumpKnowledge, knowledgeEdge } from "./market.js";
import { checkReveals, fitScore, satisfactionDelta, patienceTick, rollReferral } from "./clients.js";

// ---------- VIEWINGS ----------
export function startViewing(rec, listing) {
  if (!rec.viewed[listing.id]) rec.viewed[listing.id] = { revealedIssues: [], askedTopics: [] };
  const v = rec.viewed[listing.id];
  const reveals = [];
  listing.hiddenIssues.forEach((is, i) => {
    if (is.discovery === "visible" && !v.revealedIssues.includes(i)) { v.revealedIssues.push(i); reveals.push(i); }
  });
  markKnown(rec, listing.id, reveals);
  bumpKnowledge(listing.neighborhood);
  // Feature-triggered hidden pref reveals
  const prefHits = [];
  for (const f of listing.features) prefHits.push(...checkReveals(rec, { trigger: "feature", value: f }));
  reveals.forEach(i => prefHits.push(...checkReveals(rec, { trigger: "issueSeverity", value: listing.hiddenIssues[i].severity })));
  return { visibleIssues: reveals, prefHits, weekendBonus: isWeekend(S.day) };
}

export function askTopics(listing) {
  // Topics the player can ask the listing agent about during a viewing.
  const topics = new Set(listing.hiddenIssues.filter(is => is.discovery.startsWith("question")).map(is => is.topic));
  ["roof", "water", "hvac", "permits", "neighbors"].forEach(t => topics.add(t)); // red herrings allowed
  return [...topics];
}

export function askQuestion(rec, listing, topic) {
  const v = rec.viewed[listing.id];
  v.askedTopics.push(topic);
  const found = [];
  listing.hiddenIssues.forEach((is, i) => {
    if (is.discovery === "question" && is.topic === topic && !v.revealedIssues.includes(i)) {
      v.revealedIssues.push(i); found.push(i);
    }
  });
  markKnown(rec, listing.id, found);
  const prefHits = checkReveals(rec, { trigger: "topic", value: topic });
  found.forEach(i => prefHits.push(...checkReveals(rec, { trigger: "issueSeverity", value: listing.hiddenIssues[i].severity })));
  return { found, prefHits };
}

export function orderPreInspection(rec, listing) {
  addCash(-450, "pre-offer inspection at " + listing.address);
  const v = rec.viewed[listing.id] || (rec.viewed[listing.id] = { revealedIssues: [], askedTopics: [] });
  const found = [];
  listing.hiddenIssues.forEach((is, i) => {
    if (!v.revealedIssues.includes(i)) { v.revealedIssues.push(i); found.push(i); }
  });
  markKnown(rec, listing.id, found);
  return found;
}

function markKnown(rec, listingId, idxs) {
  if (!rec.knownIssues[listingId]) rec.knownIssues[listingId] = [];
  idxs.forEach(i => { if (!rec.knownIssues[listingId].includes(i)) rec.knownIssues[listingId].push(i); });
}

export function discloseToClient(rec, listing) {
  // Player tells the client everything they currently know. Honesty pays (usually).
  const known = rec.knownIssues[listing.id] || [];
  if (!rec.toldIssues[listing.id]) rec.toldIssues[listing.id] = [];
  const fresh = known.filter(i => !rec.toldIssues[listing.id].includes(i));
  fresh.forEach(i => rec.toldIssues[listing.id].push(i));
  if (fresh.length) {
    const c = contentClient(rec);
    const honestyW = revealedHonestyWeight(rec);
    satisfactionDelta(rec, Math.round(3 * fresh.length * honestyW), "your straight talk about the house's problems");
    S.stats.honesty += fresh.length;
    // Dealbreaker topics may kill interest — better now than later.
    fresh.forEach(i => checkReveals(rec, { trigger: "topic", value: listing.hiddenIssues[i].topic || "" }));
  }
  return fresh;
}

function revealedHonestyWeight(rec) {
  const c = contentClient(rec);
  let w = 1;
  c.hiddenPrefs.forEach((p, i) => { if (rec.revealed.includes(i) && p.data && p.data.honestyWeight) w = p.data.honestyWeight; });
  return w;
}

// ---------- OFFERS & NEGOTIATION ----------
export function writeOffer(rec, listing, price, opts) {
  // opts: {waiveInspection, waiveAppraisal, closeDays}
  const deal = {
    id: uid("deal"), mode: "buyer", clientRecId: rec.recId, listingId: listing.id,
    price, ask: S.listingsState[listing.id].price,
    waiveInspection: !!opts.waiveInspection, waiveAppraisal: !!opts.waiveAppraisal,
    closeDays: opts.closeDays || 28, stage: "offerPending", round: 0, agentId: listing.listingAgentId,
    milestones: [], createdDay: S.day,
  };
  S.deals.push(deal);
  rec.dealId = deal.id;
  log(`Offer written: ${fmtMoney(price)} on ${listing.address} (ask ${fmtMoney(deal.ask)}). Sent to ${DB.agents[deal.agentId].name}.`, "deal");
  return deal;
}

export function agentRespond(deal, priceOffered) {
  // NPC listing agent decides: accept / counter / reject.
  const agent = DB.agents[deal.agentId];
  const listing = DB.listings[deal.listingId];
  const ls = S.listingsState[deal.listingId];
  deal.round++;
  const heat = marketHeat(listing.neighborhood);
  const domFlex = Math.min(0.08, ls.dom / 1000);            // stale listings bend
  const strengthBonus = (deal.waiveInspection ? 0.015 : 0) + (deal.waiveAppraisal ? 0.015 : 0) + (deal.closeDays <= 21 ? 0.01 : 0);
  const floor = deal.ask * (1 - agent.tolerance - domFlex + (heat - 1) * 0.05 - strengthBonus);
  const r = priceOffered / deal.ask;
  if (priceOffered >= floor) {
    return { verdict: "accept", say: pickHook(agent, "accept") };
  }
  if (deal.round >= 3 || priceOffered < deal.ask * 0.82) {
    return { verdict: "reject", say: pickHook(agent, "reject") };
  }
  // Counter between offer and ask, weighted by counterAggression.
  const counter = Math.round((priceOffered + (deal.ask - priceOffered) * (0.45 + agent.counterAggression * 0.45)) / 500) * 500;
  return { verdict: "counter", counter, say: pickHook(agent, "counter") };
}

export function pickHook(agent, key) {
  const arr = agent.dialogueHooks[key] || [""];
  return arr[Math.floor(Math.random() * arr.length)];
}

export function acceptDeal(deal) {
  const rec = getClientRec(deal.clientRecId);
  const listing = DB.listings[deal.listingId];
  deal.stage = "underContract";
  S.listingsState[deal.listingId].status = "underContract";
  const base = S.day;
  const wk = d => { while (isWeekend(d)) d++; return d; }; // bank-side milestones land on weekdays
  if (!deal.waiveInspection) deal.milestones.push({ day: base + 3, type: "inspection", done: false });
  if (!deal.waiveAppraisal) deal.milestones.push({ day: wk(base + 7), type: "appraisal", done: false });
  deal.milestones.push({ day: wk(base + 12), type: "financing", done: false });
  deal.milestones.push({ day: base + deal.closeDays, type: "closing", done: false });
  deal.milestones.forEach(m => scheduleItem(m.day, `${cap(m.type)} — ${listing.address}`, m.type, deal.id));
  satisfactionDelta(rec, 8, "going under contract");
  log(`Under contract at ${fmtMoney(deal.price)} — ${listing.address}. Closing in ${deal.closeDays} days.`, "milestone");
}

export function killDeal(deal, why, repHit = 0) {
  deal.stage = "dead";
  const rec = getClientRec(deal.clientRecId);
  if (rec) { rec.dealId = null; satisfactionDelta(rec, -12, "the deal collapsing"); }
  if (deal.listingId && S.listingsState[deal.listingId]) S.listingsState[deal.listingId].status = "onMarket";
  unschedule(it => it.ref === deal.id);
  if (repHit) addRep(-repHit, why);
  log(`Deal dead: ${why}`, "bad");
}

// ---------- MILESTONE RESOLUTION (called by calendar on the day) ----------
export function resolveMilestone(deal, m) {
  const rec = getClientRec(deal.clientRecId);
  const listing = DB.listings[deal.listingId];
  m.done = true;
  if (m.type === "inspection") return resolveInspection(deal, rec, listing);
  if (m.type === "appraisal") return resolveAppraisal(deal, rec, listing);
  if (m.type === "financing") return resolveFinancing(deal, rec);
  if (m.type === "closing") return resolveClosing(deal, rec, listing);
}

function resolveInspection(deal, rec, listing) {
  const v = rec.viewed[listing.id] || { revealedIssues: [] };
  const newFinds = [];
  listing.hiddenIssues.forEach((is, i) => { if (!v.revealedIssues.includes(i)) { v.revealedIssues.push(i); newFinds.push(i); } });
  markKnown(rec, listing.id, newFinds);
  // Anything the player knew (disclosureRequired) and never told the client now detonates.
  const told = rec.toldIssues[listing.id] || [];
  const hidden = (rec.knownIssues[listing.id] || []).filter(i =>
    listing.hiddenIssues[i].disclosureRequired && !told.includes(i) && !newFinds.includes(i));
  if (hidden.length) {
    satisfactionDelta(rec, -20, "finding out you sat on known problems");
    addRep(-10, "a client learned you withheld a required disclosure");
  }
  if (!newFinds.length) {
    log(`Inspection at ${listing.address}: clean enough. The inspector seems almost disappointed.`, "");
    return { ok: true };
  }
  const worst = newFinds.map(i => listing.hiddenIssues[i]).sort((a, b) => sevRank(b) - sevRank(a))[0];
  const totalCost = newFinds.reduce((s, i) => s + listing.hiddenIssues[i].repairCost, 0);
  // Queue a player choice.
  S.choiceQueue.push({
    kind: "inspectionResult", dealId: deal.id, newFinds, totalCost,
    text: `Inspection at ${listing.address} turns up: ${newFinds.map(i => listing.hiddenIssues[i].desc).join("; ")}. Estimated cost: ${fmtMoney(totalCost)}.`,
    severity: worst.severity,
  });
  return { ok: false, pending: true };
}

export function inspectionDecision(deal, decision, totalCost) {
  const rec = getClientRec(deal.clientRecId);
  const listing = DB.listings[deal.listingId];
  const agent = DB.agents[deal.agentId];
  if (decision === "walk") {
    killDeal(deal, `${contentClient(rec).name} walked over inspection findings at ${listing.address}.`);
    satisfactionDelta(rec, 10, "you backing their decision to walk");
    return;
  }
  if (decision === "credit") {
    const askCredit = Math.round(totalCost * 0.8);
    const odds = 0.35 + (1 - agent.counterAggression) * 0.4 + knowledgeEdge(listing.neighborhood) * 0.15;
    if (rand() < odds) {
      deal.price -= askCredit;
      log(`${agent.name} grumbles but concedes a ${fmtMoney(askCredit)} repair credit. "${pickHook(agent, "accept")}"`, "deal");
      satisfactionDelta(rec, 10, "you fighting for a repair credit");
    } else {
      log(`${agent.name} refuses any credit. "${pickHook(agent, "reject")}"`, "bad");
      const c = contentClient(rec);
      if (rand() < 0.35) { killDeal(deal, `${c.name} wouldn't proceed without a credit.`); return; }
      satisfactionDelta(rec, -6, "eating the repair costs");
    }
    return;
  }
  satisfactionDelta(rec, -3, "proceeding as-is past the inspection");
}

function resolveAppraisal(deal, rec, listing) {
  const appr = appraisalFor(deal.price, trueValue(listing));
  if (appr >= deal.price) { log(`Appraisal on ${listing.address}: at value. The lender exhales.`, ""); return { ok: true }; }
  const gap = Math.round(deal.price - appr);
  S.choiceQueue.push({
    kind: "appraisalGap", dealId: deal.id, gap,
    text: `Appraisal on ${listing.address} comes in ${fmtMoney(gap)} under contract price.`,
  });
  return { ok: false, pending: true };
}

export function appraisalDecision(deal, decision, gap) {
  const rec = getClientRec(deal.clientRecId);
  const listing = DB.listings[deal.listingId];
  const agent = DB.agents[deal.agentId];
  if (decision === "cover") {
    if (deal.price <= rec.budget) { // client can find the cash if still within stretch
      log(`${contentClient(rec).name} covers the ${fmtMoney(gap)} gap in cash. Nobody enjoys this.`, "deal");
      satisfactionDelta(rec, -5, "covering an appraisal gap");
    } else { killDeal(deal, "the appraisal gap was more cash than the buyer could raise."); }
    return;
  }
  if (decision === "renegotiate") {
    const odds = 0.3 + (1 - agent.tolerance * 10) * 0 + (S.listingsState[listing.id].dom > 40 ? 0.25 : 0.05) + (1 - agent.counterAggression) * 0.3;
    if (rand() < odds) {
      deal.price -= gap;
      log(`${agent.name} drops the price to appraisal. "${pickHook(agent, "accept")}"`, "deal");
      satisfactionDelta(rec, 12, "you saving the deal at the appraised price");
    } else {
      killDeal(deal, `${agent.name} wouldn't budge to appraisal. "${pickHook(agent, "reject")}"`);
    }
    return;
  }
  killDeal(deal, "the appraisal gap killed it.");
}

function resolveFinancing(deal, rec) {
  const rate = S.market.rate;
  let failChance = 0.04 + Math.max(0, rate - 6.5) * 0.03;
  if (deal.price > rec.budget) failChance += 0.15;
  if (rand() < failChance) {
    killDeal(deal, `${contentClient(rec).name}'s financing fell through at the eleventh hour.`);
    return { ok: false };
  }
  log(`Financing clear for ${contentClient(rec).name}. The underwriter found no further feelings to have.`, "");
  return { ok: true };
}

function resolveClosing(deal, rec, listing) {
  deal.stage = "closed";
  S.listingsState[deal.listingId].status = "sold";
  const gross = deal.price * 0.03;
  const split = DB.brokerages[S.brokerageId].commissionSplit;
  const net = gross * split;
  addCash(net, `commission — ${listing.address} closed at ${fmtMoney(deal.price)}`);
  S.stats.closed++; S.stats.volume += deal.price;
  const xp = { starter: 40, mid: 70, luxury: 120 }[listing.tier] || 40;
  addXP(xp, "closed a " + listing.tier + " purchase");
  // Final satisfaction: fit + budget respect
  const fit = fitScore(rec, listing);
  satisfactionDelta(rec, Math.round((fit - 55) / 3), "how well the house actually fits");
  if (deal.price <= rec.budget * 0.97) satisfactionDelta(rec, 5, "coming in under budget");
  rec.status = "closedBuyer"; rec.dealId = null;
  const c = contentClient(rec);
  addRep(Math.max(1, Math.round((rec.satisfaction - 50) / 8)), `${c.name} closed on a home (satisfaction ${rec.satisfaction})`);
  log(`CLOSED: ${c.name} — ${listing.address}, ${fmtMoney(deal.price)}. Keys, tears, a fruit basket.`, "milestone");
  rollReferral(rec);
  return { ok: true, closed: true };
}

export const sevRank = is => ({ cosmetic: 1, moderate: 2, dealbreaker: 3 })[is.severity] || 0;
const cap = s => s[0].toUpperCase() + s.slice(1);
