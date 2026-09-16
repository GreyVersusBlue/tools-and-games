// clients.js — intake, fit scoring, hidden-preference reveals, patience/mood, schmoozing, firing, referrals.
import { DB } from "../data.js";
import { S, uid, log, addRep, addXP, pick, rand, randInt, contentClient, levelInfo } from "../state.js";
import { financingFor, financingType } from "./financing.js";
import { isCommercial, isCommercialClient, capAt, knownCapex } from "./commercial.js";

export const REL_WORDS = ["college roommate", "sister", "coworker", "old neighbor", "cousin", "book-club friend", "brother-in-law", "poker buddy"];

export function nextIntakeCandidate() {
  const tiers = levelInfo().tiers;
  const idx = S.clientQueue.findIndex(id => tiers.includes(DB.clients[id].tier) || DB.clients[id].type === "seller");
  return idx === -1 ? null : { id: S.clientQueue[idx], idx };
}

export function meetClient(clientId, referredBy = null) {
  S.clientQueue = S.clientQueue.filter(id => id !== clientId);
  S.usedClients.push(clientId);
  const c = DB.clients[clientId];
  const rec = {
    recId: uid("cr"), clientId, status: "active",
    patience: c.patience, mood: 60, satisfaction: 60,
    revealed: [],                 // indexes into hiddenPrefs
    budget: c.budget,             // may change via stretchBudget reveals
    viewed: {},                   // listingId -> {revealedIssueIdx:[], askedTopics:[]}
    knownIssues: {},              // listingId -> [issueIdx] the PLAYER knows about
    toldIssues: {},               // listingId -> [issueIdx] disclosed to client
    dealId: null, referredBy, schmoozeCount: 0,
    // What this buyer is buying with. A fact about them, not a roll — see
    // financingFor(). null on a seller, who is not the one borrowing.
    financing: financingFor(c),
  };
  S.clients.push(rec);
  const refText = referredBy ? ` They mention ${referredBy.name} — "${referredBy.rel}, says you did right by them."` : "";
  const finText = rec.financing ? ` Buying ${financingType(rec.financing).label}.` : "";
  log(`New client: ${c.name} (${c.type}). ${c.intro}${refText}${finText}`, "client", undefined, rec.recId);
  return rec;
}

export function revealPref(rec, i, source) {
  if (rec.revealed.includes(i)) return null;
  rec.revealed.push(i);
  const p = contentClient(rec).hiddenPrefs[i];
  if (p.type === "stretchBudget" && p.data.newBudget) rec.budget = p.data.newBudget;
  if (p.type === "realMotive" && p.data.patienceBonus) rec.patience += p.data.patienceBonus;
  log(`${contentClient(rec).name} — revealed (${source}): ${p.desc}`, "reveal", undefined, rec.recId);
  return p;
}

export function checkReveals(rec, ctx) {
  // ctx: {trigger: 'feature'|'missingFeature'|'topic'|'schmooze'|'issueSeverity', value}
  const c = contentClient(rec);
  const out = [];
  c.hiddenPrefs.forEach((p, i) => {
    if (rec.revealed.includes(i)) return;
    const r = p.revealOn;
    if (r.trigger !== ctx.trigger) return;
    if (r.trigger === "schmooze") { if (rec.schmoozeCount >= r.value) out.push(revealPref(rec, i, "over lunch")); }
    else if (r.value === ctx.value) out.push(revealPref(rec, i, ctx.trigger === "topic" ? "asked the right question" : "on the tour"));
  });
  return out.filter(Boolean);
}

// Fit score 0..100 for showing/offering a listing to a buyer rec.
export function fitScore(rec, listing) {
  const c = contentClient(rec);
  // A building is not a big house and a house is not a small building. Scored
  // as a wall rather than as a very bad match, because the residential
  // arithmetic below would happily read `beds` off a rent roll and hand back a
  // number in the forties that looks like an opinion worth arguing with.
  if (isCommercial(listing) !== isCommercialClient(c)) return 5;
  if (isCommercial(listing)) return commercialFit(rec, listing);
  const req = c.statedReqs;
  let fit = 50;
  if (listing.beds >= (req.minBeds || 0)) fit += 10; else fit -= 25;
  if ((req.neighborhoods || []).includes(listing.neighborhood)) fit += 12; else fit -= 10;
  const price = S.listingsState[listing.id].price;
  if (price <= rec.budget) fit += 10;
  else if (price <= rec.budget * 1.08) fit -= 8;
  else fit -= 30;
  for (const f of req.mustFeatures || []) fit += listing.features.includes(f) ? 12 : -12;
  // Revealed hidden prefs
  c.hiddenPrefs.forEach((p, i) => {
    if (!rec.revealed.includes(i)) return;
    if (p.type === "secretMustHave") {
      if (p.data.targetListing && p.data.targetListing === listing.id) fit += p.data.fitBonus || 30;
      else if (p.revealOn.trigger === "feature" && listing.features.includes(p.revealOn.value)) fit += p.data.fitBonus || 20;
      else if (p.data.fitBonus && !p.data.targetListing && p.revealOn.trigger === "schmooze") fit += Math.round((p.data.fitBonus || 15) / 2);
    }
    if (p.type === "secretDealbreaker") {
      const topic = p.data.topic;
      if (listing.hiddenIssues.some(is => is.topic === topic)) fit -= 40;
    }
    if (p.data && p.data.quirkBonus) {
      fit += listing.hiddenIssues.filter(is => is.severity === "cosmetic" && is.repairCost === 0).length * 10;
    }
  });
  return Math.max(0, Math.min(100, Math.round(fit)));
}

/**
 * Fit for an investor on a building. The same 0..100 scale and the same
 * hidden-preference vocabulary, over an entirely different opening question:
 * not "could they live here" but "does the yield clear the number they gave
 * you". Everything after the first term is manners.
 *
 * Read at the current ask, like the residential score, which is what makes an
 * overpriced building read badly on the MLS board even when the player could
 * buy it well. That is the flyer's opinion, and the offer screen is where the
 * argument happens.
 */
function commercialFit(rec, listing) {
  const c = contentClient(rec);
  const req = c.statedReqs || {};
  const price = S.listingsState[listing.id].price;
  let fit = 50;
  // A hundred basis points either side of their stated yield is twenty points
  // of fit. Capped both ways: a wonderful cap rate does not make a building
  // they cannot pay for a good idea, and a bad one does not need to reach zero
  // by itself.
  const minCap = Number.isFinite(req.minCap) ? req.minCap : 0.075;
  fit += Math.max(-35, Math.min(25, Math.round((capAt(listing, price) - minCap) * 2000)));
  if ((req.neighborhoods || []).includes(listing.neighborhood)) fit += 8; else fit -= 12;
  for (const f of req.mustFeatures || []) fit += listing.features.includes(f) ? 12 : -12;
  // A rent roll expiring inside the year is the risk an investor says out loud.
  fit -= Math.round((listing.commercial.rollPct || 0) * 12);
  // Money still binds, and it binds late: the yield can be beautiful.
  if (price > rec.budget) fit -= 30;

  let ignoresIssues = false;
  (c.hiddenPrefs || []).forEach((p, i) => {
    if (!rec.revealed.includes(i)) return;
    if (p.data && p.data.ignoresIssues) ignoresIssues = true;
    if (p.type === "secretMustHave") {
      if (p.data.targetListing && p.data.targetListing === listing.id) fit += p.data.fitBonus || 30;
      else if (p.revealOn.trigger === "feature" && listing.features.includes(p.revealOn.value)) fit += p.data.fitBonus || 20;
      else if (p.revealOn.trigger === "issueSeverity"
        && listing.hiddenIssues.some(is => is.severity === p.revealOn.value)) fit += p.data.fitBonus || 15;
    }
    if (p.type === "secretDealbreaker" && listing.hiddenIssues.some(is => is.topic === p.data.topic)) fit -= 40;
  });
  // Discovered capital comes off the yield, so it comes off the fit — unless
  // they have already told you deferred capital is a shopping list. $4,000 a
  // point, capped at twenty, because past that the number is the offer price's
  // problem and not the flyer's.
  if (!ignoresIssues) fit -= Math.min(20, Math.round(knownCapex(rec, listing) / 4000));
  return Math.max(0, Math.min(100, Math.round(fit)));
}

export function patienceTick(rec, amt, why) {
  rec.patience -= amt;
  if (rec.patience <= 0 && rec.status === "active" && !rec.dealId) {
    rec.status = "walked";
    log(`${contentClient(rec).name} has run out of patience and quietly signed with another agent. ${why || ""}`, "bad", undefined, rec.recId);
    addRep(-4, "a client walked", rec.recId);
  }
}

export function schmooze(rec) {
  rec.schmoozeCount++;
  rec.patience += 2; rec.mood = Math.min(100, rec.mood + 10);
  const revealed = checkReveals(rec, { trigger: "schmooze", value: rec.schmoozeCount });
  const c = contentClient(rec);
  if (!revealed.length) log(`Lunch with ${c.name}. Pleasant, mostly small talk. Patience restored.`, "", undefined, rec.recId);
  return revealed;
}

export function fireClient(rec) {
  rec.status = "fired";
  addRep(-5, `you fired ${contentClient(rec).name}`, rec.recId);
  log(`You part ways with ${contentClient(rec).name}. Word gets around, but so does your sanity.`, "", undefined, rec.recId);
}

export function rollReferral(closedRec) {
  if (closedRec.satisfaction < 72) return null;
  if (rand() > 0.55 + (closedRec.satisfaction - 72) / 100) return null;
  const c = contentClient(closedRec);
  // Tier-gated, same as intake and the Monday lead. A referral is still a
  // client walking through the door, and the door is the ladder: a Senior
  // Agent's happy buyer cannot refer them a rent roll they are not allowed to
  // work.
  const tiers = levelInfo().tiers;
  const pool = S.clientQueue.filter(id => {
    const cand = DB.clients[id];
    if (!tiers.includes(cand.tier) && cand.type !== "seller") return false;
    return cand.type === c.type || rand() < 0.4;
  });
  if (!pool.length) return null;
  const newId = pick(pool);
  const rel = pick(REL_WORDS);
  // Queue as a scheduled arrival with referral context.
  S.choiceQueue.push({
    kind: "referralArrive", clientId: newId,
    referredBy: { name: c.name, rel },
    text: `Your phone rings. It's ${DB.clients[newId].name} — ${c.name}'s ${rel}. "${c.name} wouldn't stop talking about you. Do you have room for one more?"`,
  });
  S.stats.referrals++;
  return newId;
}

export function satisfactionDelta(rec, amt, why) {
  rec.satisfaction = Math.max(0, Math.min(100, rec.satisfaction + amt));
  if (Math.abs(amt) >= 5) log(`${contentClient(rec).name} ${amt > 0 ? "appreciates" : "is unhappy about"} ${why}. (${amt > 0 ? "+" : ""}${amt} satisfaction)`, amt > 0 ? "" : "bad", undefined, rec.recId);
}
