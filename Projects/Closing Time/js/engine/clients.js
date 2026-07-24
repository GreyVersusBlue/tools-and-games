// clients.js — intake, fit scoring, hidden-preference reveals, patience/mood, schmoozing, firing, referrals.
import { DB } from "../data.js";
import { S, uid, log, addRep, addXP, pick, rand, randInt, contentClient, levelInfo } from "../state.js";

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
  };
  S.clients.push(rec);
  const refText = referredBy ? ` They mention ${referredBy.name} — "${referredBy.rel}, says you did right by them."` : "";
  log(`New client: ${c.name} (${c.type}). ${c.intro}${refText}`, "client");
  return rec;
}

export function revealPref(rec, i, source) {
  if (rec.revealed.includes(i)) return null;
  rec.revealed.push(i);
  const p = contentClient(rec).hiddenPrefs[i];
  if (p.type === "stretchBudget" && p.data.newBudget) rec.budget = p.data.newBudget;
  if (p.type === "realMotive" && p.data.patienceBonus) rec.patience += p.data.patienceBonus;
  log(`${contentClient(rec).name} — revealed (${source}): ${p.desc}`, "reveal");
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

export function patienceTick(rec, amt, why) {
  rec.patience -= amt;
  if (rec.patience <= 0 && rec.status === "active" && !rec.dealId) {
    rec.status = "walked";
    log(`${contentClient(rec).name} has run out of patience and quietly signed with another agent. ${why || ""}`, "bad");
    addRep(-4, "a client walked");
  }
}

export function schmooze(rec) {
  rec.schmoozeCount++;
  rec.patience += 2; rec.mood = Math.min(100, rec.mood + 10);
  const revealed = checkReveals(rec, { trigger: "schmooze", value: rec.schmoozeCount });
  const c = contentClient(rec);
  if (!revealed.length) log(`Lunch with ${c.name}. Pleasant, mostly small talk. Patience restored.`, "");
  return revealed;
}

export function fireClient(rec) {
  rec.status = "fired";
  addRep(-5, `you fired ${contentClient(rec).name}`);
  log(`You part ways with ${contentClient(rec).name}. Word gets around, but so does your sanity.`, "");
}

export function rollReferral(closedRec) {
  if (closedRec.satisfaction < 72) return null;
  if (rand() > 0.55 + (closedRec.satisfaction - 72) / 100) return null;
  const c = contentClient(closedRec);
  const pool = S.clientQueue.filter(id => {
    const cand = DB.clients[id];
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
  if (Math.abs(amt) >= 5) log(`${contentClient(rec).name} ${amt > 0 ? "appreciates" : "is unhappy about"} ${why}. (${amt > 0 ? "+" : ""}${amt} satisfaction)`, amt > 0 ? "" : "bad");
}
