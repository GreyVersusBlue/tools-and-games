// Headless engine smoke test (node): runs the loops without a browser and
// asserts what they produced. Exits non-zero on any miss — a check that only
// prints is a check that gets ignored.
//
//   node tools/smoke.mjs      →  SMOKE OK: N passed
//
// This is blind to the wiring by design. `cd Tools/board-check && npm run games`
// is the one that drives the real page.
import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
import { DB } from "../js/data.js";
import { S, newGame, makeCareer, adoptState, careerSlot, save, loadSave, wipeSave,
         validCareer, repairCareer, rand, SAVE_KEY, SAVE_VERSION, DEFAULT_BROKERAGE,
         getClientRec, contentClient, activeClients } from "../js/state.js";
import * as Clients from "../js/engine/clients.js";
import * as Deals from "../js/engine/deals.js";
import * as Seller from "../js/engine/seller.js";
import { endDay, CAREER_LENGTH_DAYS } from "../js/engine/calendar.js";
import { maybeFireEvent } from "../js/engine/events.js";
import { FINANCING, financingFor, financingType, closeDaysFor, DEFAULT_FINANCING } from "../js/engine/financing.js";
import * as Esc from "../js/engine/escalation.js";

/* ------------------------------------------------------------------ harness */
let passed = 0; const failures = [];
function ok(cond, what, detail = "") {
  if (cond) { passed++; return true; }
  failures.push(what + (detail ? `  (${detail})` : ""));
  console.log("  MISS " + what + (detail ? `  (${detail})` : ""));
  return false;
}
const eq = (a, b, what) => ok(a === b, what, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

/** localStorage-shaped stub. Nothing in this project touches the real thing. */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    has: k => m.has(k),
  };
}

/* ------------------------------------------------------------------ content */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
for (const cat of Object.keys(DB)) for (const p of manifest[cat]) {
  const o = JSON.parse(fs.readFileSync(path.join(root, p)));
  DB[cat][o.id] = o;
}
const counts = Object.fromEntries(Object.entries(DB).map(([k, v]) => [k, Object.keys(v).length]));
console.log("content loaded:", counts);
for (const cat in counts) ok(counts[cat] > 0, `content category ${cat} is populated`, `${counts[cat]} files`);

/* --------------------------------------------------------------- buyer loop */
newGame("bk_hearthstone");
eq(S.day, 1, "a new career starts on day one");
ok(Object.keys(S.listingsState).length === counts.listings, "every content listing has a market state",
  `${Object.keys(S.listingsState).length} of ${counts.listings}`);
ok(Object.keys(S.market.nb).length === counts.neighborhoods, "every neighborhood has a price index");

const rec = Clients.meetClient("cl_0001");
const l = DB.listings["ls_0001"];
const fit0 = Clients.fitScore(rec, l);
console.log("fit:", fit0);
ok(Number.isFinite(fit0) && fit0 >= 0 && fit0 <= 100, "fit score is a number in 0..100", String(fit0));
Deals.startViewing(rec, l);
Deals.askQuestion(rec, l, "roof");
Deals.discloseToClient(rec, l);
Clients.schmooze(rec);
eq(rec.schmoozeCount, 1, "schmoozing is counted");
const deal = Deals.writeOffer(rec, l, 160000, { closeDays: 21 });
let resp = Deals.agentRespond(deal, 160000);
console.log("agent:", resp.verdict, resp.counter || "");
ok(["accept", "counter", "reject"].includes(resp.verdict), "the listing agent returned a verdict", resp.verdict);
if (resp.verdict === "counter") { deal.price = resp.counter; }
Deals.acceptDeal(deal);
eq(deal.stage, "underContract", "an accepted offer goes under contract");
ok(deal.milestones.length >= 2, "and schedules its contingencies", `${deal.milestones.length} milestones`);

/* -------------------------------------------------------------- seller loop */
const srec = Clients.meetClient("cl_0101");
const pl = Seller.takeListing(srec);
Seller.discloseIssue(pl, 1);
Seller.goLive(pl, Seller.suggestedPrice(pl), 1);
eq(pl.status, "live", "the listing went live");
Seller.spawnNPCOffer(pl);
const off = pl.offers[0];
console.log("npc offer:", off.price, DB.agents[off.agentId].name);
ok(Number.isFinite(off.price) && off.price > 0, "the NPC offer carries a real price", String(off.price));
const read = Seller.sellerReaction(pl, off);
console.log("seller read:", read.inclination.toFixed(2));
ok(Number.isFinite(read.inclination), "the seller has a readable opinion");
Seller.respondToOffer(pl, off, "accept");
eq(pl.status, "underContract", "accepting an offer puts the listing under contract");

/* ------------------------------------------------------- open house machinery */
const oh = Seller.runOpenHouse(pl);
ok(oh.visitors.length > 0 && oh.visitors.every(v => v && v.text), "the open house produced visitors",
  `${oh.visitors.length} through the door`);
Seller.finishOpenHouse(pl, 2.5, { honest: 1, spin: 0 });
ok(Number.isFinite(pl.interest), "interest is still a number after an open house", String(pl.interest));

/* --------------------------------- 40 days, resolving choices bluntly ------- */
const dayBefore = S.day, logBefore = S.log.length;
for (let d = 0; d < 40; d++) {
  endDay();
  while (S.choiceQueue.length) {
    const ch = S.choiceQueue.shift();
    const deal2 = ch.dealId ? S.deals.find(x => x.id === ch.dealId) : null;
    const plx = ch.plId ? S.playerListings.find(p => p.id === ch.plId) : null;
    try {
      if (ch.kind === "inspectionResult" && deal2 && deal2.stage === "underContract") Deals.inspectionDecision(deal2, "credit", ch.totalCost);
      else if (ch.kind === "appraisalGap" && deal2 && deal2.stage === "underContract") Deals.appraisalDecision(deal2, "renegotiate", ch.gap);
      else if (ch.kind === "sellerInspectionHit" && plx) Seller.sellerInspectionDecision(plx, "credit", ch.cost);
      else if (ch.kind === "referralArrive" && activeClients().length < 6) Clients.meetClient(ch.clientId, ch.referredBy);
    } catch (e) { console.error("CHOICE HANDLER FAIL", ch.kind, e); process.exit(1); }
  }
}
console.log("day:", S.day, "cash:", Math.round(S.cash), "rep:", S.rep, "xp:", S.xp, "level:", S.level);
console.log("deal stage:", deal.stage, "| listing status:", pl.status);
console.log("stats:", S.stats);
eq(S.day, dayBefore + 40, "forty days passed");
ok(S.log.length > logBefore, "the ledger recorded them", `${logBefore} -> ${S.log.length}`);
ok(Number.isFinite(S.cash), "cash survived forty days as a number", String(S.cash));
ok(S.market.rate > 3 && S.market.rate < 10, "the rate drifted inside sane bounds", S.market.rate.toFixed(2));
ok(Object.values(S.market.nb).every(Number.isFinite), "every neighborhood index is still finite");
ok(S.playerListings.every(p => Number.isFinite(p.interest)), "every listing's interest is still finite");
console.log("recent log:");
S.log.slice(0, 8).forEach(x => console.log("  D" + x.day, x.text));

/* ================================================================== the save */
// gvb-save.js, adopted this session. The old save() was
// `localStorage.setItem(KEY, JSON.stringify(S))` and the old loadSave() was
// `JSON.parse` straight into S, so none of the below was true before.
console.log("\nsave system:");

const store = memStore();
const slot = careerSlot(store);
eq(slot.key, "closingTime.save.v1", "the storage key is unchanged");
eq(slot.game, "closing-time", "the slot is stamped with the game slug");

// --- a round trip through storage, and the version stamp
ok(save(store), "save() reported that it stuck");
const raw = JSON.parse(store.getItem(SAVE_KEY));
eq(raw.__v, SAVE_VERSION, "the stored blob carries a version stamp");
eq(raw.day, S.day, "and the day the career is actually on");
const midCareer = JSON.parse(JSON.stringify(S));
ok(loadSave(store), "loadSave() came back true");
eq(S.day, midCareer.day, "and resumed on the same day");
eq(S.stats.closed, midCareer.stats.closed, "with the same closed count");

// --- garbage is refused instead of booted on
for (const [name, blob] of [
  ["unparseable JSON", "{ this is not json"],
  ["an empty object", "{}"],
  ["a day that is a string", JSON.stringify({ day: "tuesday", cash: 0, brokerageId: "bk_indep", clients: [] })],
  ["a null", "null"],
  ["an array", "[1,2,3]"],
  ["a career with no client list", JSON.stringify({ day: 4, cash: 10, brokerageId: "bk_indep" })],
]) {
  store.setItem(SAVE_KEY, blob);
  ok(slot.load() === null, `a corrupt save is refused: ${name}`);
}
// The old loader would have taken all six. Prove the gate is the reason.
ok(!validCareer(JSON.parse('{"day":"tuesday","cash":0,"brokerageId":"bk_indep","clients":[]}')),
  "validCareer rejects a non-numeric day");
ok(validCareer(midCareer), "and accepts a real career");

// --- a legacy save: no version stamp, and missing every field added since
const legacy = JSON.parse(JSON.stringify(midCareer));
const legacyListing = Object.keys(DB.listings)[3];
const legacyNb = Object.keys(DB.neighborhoods)[2];
delete legacy.seed;                       // rand() multiplies this
delete legacy.nextId;                     // uid() increments this
delete legacy.firedEvents;                // added with the event system
delete legacy.listingsState[legacyListing];   // a listing added to data/ since
delete legacy.market.nb[legacyNb];            // a neighborhood added since
delete legacy.knowledge[legacyNb];
delete legacy.activeEffects;
delete legacy.careerEnded;             // predates the year-336 ending entirely
delete legacy.scorecard;
legacy.brokerageId = "bk_does_not_exist";
if (legacy.clients[0]) delete legacy.clients[0].schmoozeCount;
if (legacy.playerListings[0]) { delete legacy.playerListings[0].openHouseBoost; delete legacy.playerListings[0].dom; }
store.setItem(SAVE_KEY, JSON.stringify(legacy));   // note: no __v, so version 0

const fixed = slot.load();
ok(!!fixed, "a legacy save loads at all");
if (fixed) {
  ok(Number.isFinite(fixed.seed), "repair gave it an RNG seed", String(fixed.seed));
  ok(Number.isFinite(fixed.nextId) && fixed.nextId > 0, "and a usable nextId", String(fixed.nextId));
  ok(!!fixed.firedEvents, "and a firedEvents map");
  ok(Array.isArray(fixed.activeEffects), "and an activeEffects list");
  ok(!!fixed.listingsState[legacyListing], `and a market state for ${legacyListing}, added to data/ since`);
  ok(Number.isFinite(fixed.market.nb[legacyNb]), `and a price index for ${legacyNb}`);
  ok(Number.isFinite(fixed.knowledge[legacyNb]), "and a knowledge level for it");
  ok(fixed.brokerageId in DB.brokerages, "and a brokerage that exists", fixed.brokerageId);
  eq(fixed.careerEnded, false, "and a save from before the ending existed defaults to not-ended");
  eq(fixed.scorecard, null, "with no scorecard");
  if (fixed.clients[0]) eq(fixed.clients[0].schmoozeCount, 0, "and a schmooze count that can be incremented");
  if (fixed.playerListings[0]) {
    ok(Number.isFinite(fixed.playerListings[0].openHouseBoost), "and an open-house boost that is a number");
    ok(Number.isFinite(fixed.playerListings[0].dom), "and a days-on-market count");
  }
  // The nextId scan has to clear every id already in the save, or uid() hands
  // back one that getClientRec() will match to the wrong record.
  const usedIds = fixed.clients.map(r => Number(String(r.recId).split("_").pop())).filter(Number.isFinite);
  ok(usedIds.every(n => n < fixed.nextId), "nextId is past every id already issued",
    `nextId ${fixed.nextId}, highest issued ${Math.max(0, ...usedIds)}`);

  // The reason seed matters: rand() is S.seed * 1664525 + ..., so a missing
  // seed makes every random branch in the game NaN and pick() return undefined.
  adoptState(fixed);
  const rolls = [rand(), rand(), rand()];
  ok(rolls.every(r => Number.isFinite(r) && r >= 0 && r < 1), "and rand() works on the repaired career",
    rolls.map(r => r.toFixed(3)).join(" "));

  // The MLS board reads S.listingsState[l.id].status for every listing in DB
  // and throws on the first one a legacy save has never heard of.
  let mlsThrew = null;
  try { Object.values(DB.listings).filter(x => fixed.listingsState[x.id].status === "onMarket"); }
  catch (e) { mlsThrew = e.message; }
  ok(mlsThrew === null, "and the MLS board's filter runs over every listing", mlsThrew || "");

  // A repaired career keeps playing.
  endDay();
  ok(Number.isFinite(S.cash) && Number.isFinite(S.market.rate), "and a day advances on it cleanly");
}
ok(repairCareer(repairCareer(JSON.parse(JSON.stringify(midCareer)))).day === midCareer.day,
  "repair is idempotent");

// --- the reverse direction: content removed from data/ while a save still
// references it. Same family as the legacy-save gaps above, opposite way.
console.log("\ncontent removed from data/:");
const removed = JSON.parse(JSON.stringify(midCareer));
removed.listingsState["ls_ghost_removed"] = { status: "onMarket", price: 250000, dom: 50 };
removed.market.nb["nb_ghost_removed"] = 1.05;
removed.knowledge["nb_ghost_removed"] = 2;
const cleaned = repairCareer(removed);
ok(!("ls_ghost_removed" in cleaned.listingsState), "repair drops a listingsState entry for a listing no longer in data/");
ok(!("nb_ghost_removed" in cleaned.market.nb), "and a market index for a neighborhood no longer in data/");
ok(!("nb_ghost_removed" in cleaned.knowledge), "and a knowledge level for it");

// Locked decision #34: reintroduce the bug the purge guards and watch it fail
// before trusting the fix. calendar.js's daily aging loop is
// `for (const id in S.listingsState) { ... DB.listings[id].address ... }`
// (a price cut and an off-market roll both read it, each gated by a daily
// dice roll) — exercise that exact shape directly instead of waiting on the
// random branches to fire, which would make the test itself flaky.
adoptState(JSON.parse(JSON.stringify(cleaned)));
S.listingsState["ls_ghost_removed"] = { status: "onMarket", price: 250000, dom: 46 };
let removalThrew = null;
try { for (const id in S.listingsState) { void DB.listings[id].address; } }
catch (e) { removalThrew = e.message; }
ok(removalThrew !== null, "confirms the bug: reading DB.listings[id] over an unpurged orphan id throws — exactly what calendar.js does every day",
  removalThrew || "");

// Now prove the actual load path — not a hand-edited S — purges it first.
adoptState(JSON.parse(JSON.stringify(midCareer)));
S.listingsState["ls_ghost_removed"] = { status: "onMarket", price: 250000, dom: 46 };
ok(save(store), "a save with an orphaned listing (content deleted after it was written) saves fine");
ok(loadSave(store), "and loads fine");
ok(!("ls_ghost_removed" in S.listingsState), "with the orphan purged by repair before the game ever sees it");
let reloadedThrew = null;
try { for (const id in S.listingsState) { void DB.listings[id].address; } }
catch (e) { reloadedThrew = e.message; }
ok(reloadedThrew === null, "so the same loop calendar.js runs every day no longer throws");
const dayBeforeReload = S.day;
endDay();
eq(S.day, dayBeforeReload + 1, "and a real day advances cleanly on the repaired career");

// --- the same removal, one level up: state that POINTS AT content, not state
// keyed by it. A deal mid-contract on a listing whose file was deleted.
console.log("\ncontent removed out from under a live deal:");
{
  // Confirm the bug first, the same way the listingsState purge above does.
  // This is the exact read deals.js does in five places and calendar.js:95
  // does on every expiring offer.
  adoptState(JSON.parse(JSON.stringify(midCareer)));
  const ghostDeal = {
    id: "deal_ghost", mode: "buyer", clientRecId: "cr_ghost",
    listingId: "ls_ghost_removed", agentId: "ag_ghost_removed",
    price: 400000, ask: 415000, stage: "underContract", round: 1,
    createdDay: 3, closeDays: 28, milestones: [],
  };
  S.deals.push(ghostDeal);
  let dealThrew = null;
  try { for (const d of S.deals) { void DB.listings[d.listingId].address; } }
  catch (e) { dealThrew = e.message; }
  ok(dealThrew !== null,
    "confirms the bug: a deal on a deleted listing throws where deals.js reads DB.listings[deal.listingId]",
    dealThrew || "");

  let agentThrew = null;
  try { for (const d of S.deals) { void DB.agents[d.agentId].name; } }
  catch (e) { agentThrew = e.message; }
  ok(agentThrew !== null,
    "and again on DB.agents[d.agentId].name, which calendar.js:95 reads on an offer that expires",
    agentThrew || "");

  // Now the load path, not a hand-edited S.
  adoptState(JSON.parse(JSON.stringify(midCareer)));
  const beforeCount = S.deals.length;
  S.deals.push(JSON.parse(JSON.stringify(ghostDeal)));
  S.listingsState["ls_ghost_removed"] = { status: "underContract", price: 400000, dom: 12 };
  S.schedule.push({ day: S.day + 3, label: "Inspection — ghost", type: "inspection", ref: "deal_ghost" });
  S.choiceQueue.push({ dealId: "deal_ghost", text: "a choice about a deal that is gone" });
  const logBefore = S.log.length;
  ok(save(store), "a save holding a deal on deleted content saves fine");
  ok(loadSave(store), "and loads fine");
  eq(S.deals.length, beforeCount, "with the orphaned deal dropped by repair");
  ok(!S.schedule.some(it => it.ref === "deal_ghost"), "and its schedule item dropped with it");
  ok(!S.choiceQueue.some(ch => ch.dealId === "deal_ghost"), "and its pending choice dropped too");
  ok(S.log.length > logBefore, "and a Ledger line saying a deal fell through, rather than it vanishing quietly");
  ok(!("ls_ghost_removed" in S.listingsState),
    "the listing's own state goes with it, since that listing is gone from data/ as well");

  let liveThrew = null;
  try {
    for (const d of S.deals) { void DB.listings[d.listingId].address; void DB.agents[d.agentId].name; }
    for (const id of S.clientQueue) { void DB.clients[id].tier; }
  } catch (e) { liveThrew = e.message; }
  ok(liveThrew === null, "so the reads that threw above run clean on the repaired career", liveThrew || "");

  const dayBefore = S.day;
  endDay();
  eq(S.day, dayBefore + 1, "and a real day advances on it");
}

// --- a listing left flagged under contract with nothing pointing at it.
{
  adoptState(JSON.parse(JSON.stringify(midCareer)));
  // A listing no deal in this save references — midCareer carries a dead deal,
  // and the reset is deliberately conservative: it only fires when nothing at
  // all points at the listing, so a deal in any stage keeps its flag.
  const realId = Object.keys(DB.listings).find(id => !S.deals.some(d => d.listingId === id));
  ok(!!realId, "the fixture has a listing no deal references, to test the reset against");
  S.listingsState[realId].status = "underContract";
  ok(save(store) && loadSave(store), "a save flagging a real listing under contract with no deal behind it round-trips");
  eq(S.listingsState[realId].status, "onMarket",
    "and repair puts it back on the market, rather than leaving it unbuyable forever");
}

// --- a client whose content file was deleted mid-career.
{
  adoptState(JSON.parse(JSON.stringify(midCareer)));
  const before = S.clients.length;
  S.clients.push({
    recId: "cr_ghost_client", clientId: "cl_ghost_removed", status: "active",
    patience: 5, mood: 60, satisfaction: 60, schmoozeCount: 0,
    revealed: [], viewed: {}, knownIssues: {}, toldIssues: {}, dealId: null,
  });
  S.clientQueue.push("cl_ghost_removed");
  S.usedClients.push("cl_ghost_removed");
  ok(save(store) && loadSave(store), "a save holding a client whose file was deleted round-trips");
  eq(S.clients.length, before, "with the record dropped by repair");
  ok(!S.clientQueue.includes("cl_ghost_removed"), "and the id out of the incoming queue");
  ok(!S.usedClients.includes("cl_ghost_removed"), "and out of the used list");

  let queueThrew = null;
  try { for (const id of S.clientQueue) { void DB.clients[id].tier; } }
  catch (e) { queueThrew = e.message; }
  ok(queueThrew === null, "so clients.js:9's tier scan over the queue runs clean", queueThrew || "");
}

// --- repair still does nothing to a career whose content is all present.
{
  const untouched = repairCareer(JSON.parse(JSON.stringify(midCareer)));
  eq(untouched.deals.length, midCareer.deals.length, "repair drops no deal from a career whose content is all present");
  eq(untouched.clients.length, midCareer.clients.length, "and no client");
  eq(untouched.clientQueue.length, midCareer.clientQueue.length, "and nothing from the queue");
}

// --- give the career an ending: day 336, a one-year career (task: headline)
console.log("\ncareer ending at day 336:");
{
  const c = makeCareer("bk_indep");
  eq(CAREER_LENGTH_DAYS, 336, "the career length matches seasonOf's own wrap point");
  c.day = CAREER_LENGTH_DAYS;
  adoptState(c);
  ok(!S.careerEnded, "day 336 itself is not yet the end — the player still gets to play it");
  endDay();
  ok(S.careerEnded, "ending the day from 336 closes the career instead of starting a 337th day");
  eq(S.day, CAREER_LENGTH_DAYS, "day stays put at 336, the last day actually played");
  ok(!!S.scorecard, "and freezes a scorecard");
  if (S.scorecard) {
    eq(S.scorecard.day, CAREER_LENGTH_DAYS, "the scorecard remembers day 336");
    eq(S.scorecard.closings, S.stats.closed, "carrying the deals-closed count");
    eq(S.scorecard.volume, S.stats.volume, "and the volume");
    eq(S.scorecard.referrals, S.stats.referrals, "and referrals earned");
    eq(S.scorecard.finalRep, S.rep, "and final reputation");
  }
  endDay();
  eq(S.day, CAREER_LENGTH_DAYS, "clicking End Day again after the career ends is a no-op, not a second day 337");

  // A save written under the old, endless rules can already be past day 336.
  const veteran = makeCareer("bk_hearthstone");
  veteran.day = 500;
  adoptState(veteran);
  ok(!S.careerEnded, "a save from before the ending existed can sit past day 336 unended");
  endDay();
  ok(S.careerEnded, "and ends on its very next End Day click rather than sailing on to day 501");
}

// --- the Ledger's per-client filter is recId-exact now, not a name substring
// Task: a name-substring filter (it.text.includes(name)) has a real false
// positive already live in the game, not a hypothetical future one — a
// referral's own intro line names the referrer verbatim ("They mention
// <referrer>..."), so filtering by the referrer's name used to also surface
// every client THEY referred. recId fixes it by tagging the log line with
// the client it's actually about.
console.log("\nledger filter is recId-exact, not name-substring:");
{
  const recX = Clients.meetClient("cl_0005");
  const nameX = contentClient(recX).name;
  const recY = Clients.meetClient("cl_0006", { name: nameX, rel: "cousin" });
  const referralLine = S.log[0];
  ok(referralLine.text.includes(nameX), "the referral intro line names the referrer verbatim", referralLine.text);
  eq(referralLine.recId, recY.recId, "but the line is tagged with the new client's own recId, not the referrer's");
  const filterFor = recId => S.log.filter(it => it.recId === recId);
  ok(!filterFor(recX.recId).includes(referralLine), "so filtering by the referrer's recId correctly excludes it");
  ok(filterFor(recY.recId).includes(referralLine), "and filtering by the new client's recId includes it");
  // Locked decision #34: reintroduce the bug being guarded against, in
  // isolation, and confirm it actually would have failed.
  const oldSubstringFilter = S.log.filter(it => it.text.includes(nameX));
  ok(oldSubstringFilter.includes(referralLine),
    "confirms the bug: the old text.includes(name) approach wrongly matches the referral line under the referrer's filter");
}

// --- export to a file and import it back
const text = slot.serialize(midCareer);
const env = JSON.parse(text);
eq(env.format, "gvb-save", "an export is wrapped in the gvb-save envelope");
eq(env.game, "closing-time", "stamped with this game");
eq(env.version, SAVE_VERSION, "and this version");
const reimported = slot.deserialize(text);
ok(!!reimported, "and it imports back");
if (reimported) {
  eq(reimported.day, midCareer.day, "on the same day");
  eq(reimported.cash, midCareer.cash, "with the same cash");
  eq(reimported.clients.length, midCareer.clients.length, "and the same roster");
}
ok(slot.deserialize(JSON.stringify({ ...env, game: "fourth-quarter" })) === null,
  "a save file from another game is refused");
ok(slot.deserialize("not a save file at all") === null, "and so is a file that is not a save");
// An export from before the versioning still comes back, through repair.
const old = JSON.parse(JSON.stringify(midCareer));
delete old.seed;
const oldBack = slot.deserialize(JSON.stringify({ ...env, version: 0, state: old }));
ok(!!oldBack && Number.isFinite(oldBack.seed), "a version-0 export imports and gets repaired");

// --- fresh() and reset()
const brandNew = slot.fresh();
ok(!!brandNew && brandNew.day === 1, "fresh() builds a day-one career");
eq(brandNew.brokerageId, DEFAULT_BROKERAGE, "at the default brokerage");
ok(Object.keys(brandNew.listingsState).length === counts.listings, "with the whole MLS on the board");
save(store);
wipeSave(store);
ok(store.getItem(SAVE_KEY) === null, "wipeSave() clears the key");
ok(loadSave(store) === false, "and loadSave() then reports nothing to resume");

// --- makeCareer stays pure: the slot calls it as a defaults factory
adoptState(midCareer);
const sideEffect = makeCareer("bk_indep");
eq(S.day, midCareer.day, "makeCareer() does not touch the live career");
eq(sideEffect.day, 1, "and hands back a separate day-one one");

/* ---------------------------------------------- buyer-side financing types */
console.log("\nfinancing:");

// --- the derivation. It has to be a fact about a client, not a roll: the same
// client buys the same way on every career, and repairCareer() can recompute it
// on any load without asking the RNG for anything.
{
  const theo = DB.clients["cl_0004"];           // statedReqs.notes literally reads "Cash."
  eq(financingFor(theo), "cash", "a client file that names its financing gets it");
  const kofi = DB.clients["cl_0008"];           // names none — derived from tier
  const first = financingFor(kofi);
  ok(first in FINANCING, "a client file that names none still gets a real type", String(first));
  eq(financingFor(kofi), first, "and the same one every time it is asked");
  ok(financingFor(DB.clients["cl_0101"]) === null, "a seller gets none — they are not the one borrowing");

  const spread = new Set(Object.values(DB.clients).filter(c => c.type === "buyer").map(financingFor));
  ok(spread.size >= 3, "the buyer pool is not all one type", [...spread].sort().join(", "));
}

// --- the headline: the same house at the same price, offered two ways.
//
// Measured rather than recomputed. Walking the price down until the listing
// agent says "accept" reads the floor off agentRespond()'s own answers; writing
// the floor formula out again here would be a check that re-implements the thing
// it checks (#34), and would have passed against a strengthBonus that never read
// `financing` at all.
{
  newGame("bk_hearthstone");
  const listing = DB.listings["ls_0001"];
  const ask = S.listingsState[listing.id].price;
  const lowestAcceptedAs = (financing, closeDays) => {
    const deal = {
      id: "probe", mode: "buyer", clientRecId: null, listingId: listing.id,
      price: ask, ask, waiveInspection: false, waiveAppraisal: false,
      financing, closeDays, stage: "offerPending", round: 0,
      agentId: listing.listingAgentId, milestones: [], createdDay: 1,
    };
    // Down in $250 steps from the ask; the first price that stops being accepted
    // is one step below the floor. Stay above the 0.82×ask hard reject.
    let last = null;
    for (let price = ask; price > ask * 0.84; price -= 250) {
      deal.round = 0;
      if (Deals.agentRespond(deal, price).verdict !== "accept") break;
      last = price;
    }
    return last;
  };
  const cashFloor = lowestAcceptedAs("cash", 21);
  const convFloor = lowestAcceptedAs("conventional", 21);
  const fhaFloor = lowestAcceptedAs("fha", FINANCING.fha.minCloseDays);
  console.log(`  floors on ${listing.address} (ask ${ask}): cash ${cashFloor}, conventional ${convFloor}, FHA ${fhaFloor}`);
  ok(cashFloor !== null && convFloor !== null && fhaFloor !== null,
    "all three types clear the ask, so the walk measured a floor and not a wall");
  ok(cashFloor < convFloor, "a cash buyer is taken lower than a conventional one",
    `${cashFloor} vs ${convFloor}`);
  ok(convFloor < fhaFloor, "and a conventional buyer lower than an FHA one",
    `${convFloor} vs ${fhaFloor}`);
  // The gap has to be worth a decision, not a rounding error: 0.03 + 0.01 of
  // strength for cash against -0.02 for FHA is 6% of the ask.
  ok(fhaFloor - cashFloor > ask * 0.05,
    "and the spread between them is real money, not a rounding error",
    `${fhaFloor - cashFloor} on an ask of ${ask}`);
}

// --- what each type actually signs up for once it is under contract
{
  newGame("bk_hearthstone");
  const listing = DB.listings["ls_0001"];
  const types = {};
  for (const [id, clientId] of [["cash", "cl_0004"], ["fha", "cl_0001"]]) {
    const r = Clients.meetClient(clientId);
    r.financing = id;                              // pin it; the point here is the milestones
    const d = Deals.writeOffer(r, listing, S.listingsState[listing.id].price, { closeDays: 21 });
    Deals.acceptDeal(d);
    types[id] = d.milestones.map(m => m.type);
  }
  ok(!types.cash.includes("appraisal") && !types.cash.includes("financing"),
    "a cash deal schedules neither an appraisal nor a financing milestone",
    types.cash.join(", "));
  ok(types.cash.includes("closing"), "it still has to close", types.cash.join(", "));
  ok(types.fha.includes("appraisal") && types.fha.includes("financing"),
    "an FHA deal schedules both", types.fha.join(", "));
}

// --- close dates a loan can actually hit
{
  eq(closeDaysFor("cash")[0], 14, "cash can close in two weeks");
  ok(!closeDaysFor("fha").includes(21), "FHA cannot close in three", closeDaysFor("fha").join("/"));
  ok(closeDaysFor("fha").every(d => d >= FINANCING.fha.minCloseDays), "nor in anything under its floor");
  newGame("bk_hearthstone");
  const r = Clients.meetClient("cl_0001"); r.financing = "fha";
  const d = Deals.writeOffer(r, DB.listings["ls_0001"], 150000, { closeDays: 21 });
  ok(d.closeDays >= FINANCING.fha.minCloseDays,
    "and an offer written for 21 days anyway is clamped up to the floor", `${d.closeDays} days`);
  eq(d.waiveAppraisal, false, "an FHA offer that waives nothing waives nothing");
  const r2 = Clients.meetClient("cl_0004"); r2.financing = "cash";
  const d2 = Deals.writeOffer(r2, DB.listings["ls_0002"], 150000, { closeDays: 21, waiveAppraisal: true });
  eq(d2.waiveAppraisal, false,
    "and a cash offer cannot 'waive' an appraisal contingency it never had");
}

// --- a career written before any of this existed
{
  newGame("bk_hearthstone");
  const r = Clients.meetClient("cl_0004");
  const d = Deals.writeOffer(r, DB.listings["ls_0001"], 150000, { closeDays: 21 });
  const legacy = JSON.parse(JSON.stringify(S));
  legacy.clients.forEach(rec => delete rec.financing);
  legacy.deals.forEach(deal => delete deal.financing);
  const seedBefore = legacy.seed;
  const fixed = repairCareer(legacy);
  eq(fixed.clients[0].financing, "cash",
    "repair gives a legacy buyer the financing a fresh career would have given them");
  eq(fixed.deals[0].financing, "cash", "and the deal on the table the same one");
  eq(fixed.seed, seedBefore,
    "and spends no RNG doing it — repair runs on every load, so a rand() here would re-roll the career");
  const twice = repairCareer(JSON.parse(JSON.stringify(fixed)));
  eq(twice.clients[0].financing, "cash", "repair is idempotent on the field it just filled");
  ok(financingType(undefined).id === DEFAULT_FINANCING,
    "and a deal that still somehow has no type reads as conventional rather than undefined");
}

/* ------------------------------------- multi-offer escalation wars -------- */
console.log("\nescalation:");

// A plain offer, as the field sees it. Only the fields resolveField() reads.
const paper = (id, price, extra = {}) => ({
  id, agentId: "ag_priya_natesan", price, status: "open", day: 1,
  financing: "conventional", inspection: true, closeDays: 28, escalation: null, ...extra,
});

// --- the rule: a clause beats PAPER, by one increment, and stops at its cap.
{
  const straight = paper("a", 150000);
  const clause = paper("b", 140000, { escalation: { cap: 160000, increment: 1000 } });
  const field = Esc.resolveField([straight, clause]);
  eq(field[0].offer.id, "b", "a clause below a straight offer still wins the field");
  eq(field[0].final, 151000, "and lands exactly one increment over the paper it beat");
  eq(field[0].base, 140000, "without changing what the buyer actually wrote");
  eq(field[1].final, 150000, "the straight offer is worth what it says");
  ok(!field[0].capped, "and it was not at its cap");
}

// --- the cap is a wall, and a straight number above it wins outright. This is
// the reason to call for highest and best rather than collect clauses.
{
  const straight = paper("a", 165000);
  const clause = paper("b", 140000, { escalation: { cap: 160000, increment: 1000 } });
  const field = Esc.resolveField([straight, clause]);
  eq(field[0].offer.id, "a", "a straight number above the cap beats the clause");
  eq(field[1].final, 160000, "which is stopped at its cap");
  ok(field[1].capped, "and knows it");
}

// --- the decision this file locks: clauses resolve against PAPER, never
// against each other's escalated result. Two clauses that escalated over each
// other's results would both terminate at their caps — 175000 and 180000, a
// pair of numbers neither buyer ever agreed to face.
{
  const x = paper("x", 140000, { escalation: { cap: 175000, increment: 1000 } });
  const y = paper("y", 142000, { escalation: { cap: 180000, increment: 2000 } });
  const field = Esc.resolveField([x, y]);
  const byId = Object.fromEntries(field.map(r => [r.offer.id, r]));
  eq(byId.x.final, 143000, "clause x escalates over y's PAPER, not over y's result");
  eq(byId.y.final, 142000, "and y over x's paper, which is below y's own price, so y holds");
  ok(byId.x.final < x.escalation.cap && byId.y.final < y.escalation.cap,
    "neither clause is pumped to its cap by the other",
    `${byId.x.final} of ${x.escalation.cap}, ${byId.y.final} of ${y.escalation.cap}`);
  eq(field[0].offer.id, "x", "and the higher escalated number leads");
}

// --- a lone clause has nothing to beat.
{
  const only = paper("a", 140000, { escalation: { cap: 200000, increment: 5000 } });
  const field = Esc.resolveField([only]);
  eq(field[0].final, 140000, "a clause with no competition pays its paper price and nothing more");
}

// --- the tiebreak is terms, and it is the same 0.015 scale agentRespond() uses.
{
  const weak = paper("a", 150000, { financing: "fha" });
  const strong = paper("b", 150000, { financing: "cash" });
  const field = Esc.resolveField([weak, strong]);
  eq(field[0].offer.id, "b", "two identical numbers are split on terms, not on order");
  ok(Esc.termScore(strong) > Esc.termScore(weak), "and cash scores above FHA on that scale",
    `${Esc.termScore(strong).toFixed(3)} vs ${Esc.termScore(weak).toFixed(3)}`);
  // Stable: the same input must not reorder between two renders.
  eq(Esc.resolveField([strong, weak])[0].offer.id, "b", "and the order of the input does not change the answer");
}

// --- a legacy offer, carrying `escalation` as the bare cap it used to be.
{
  const old = paper("a", 140000, { escalation: 152000 });
  const c = Esc.clauseOf(old);
  eq(c.cap, 152000, "an offer written before clauses were structured still reads as one");
  eq(c.increment, Esc.DEFAULT_INCREMENT, "at the default increment");
  eq(Esc.clauseOf(paper("b", 140000, { escalation: 139000 })), null,
    "a cap under the offer's own price is a typo, not a clause");
  eq(Esc.clauseOf(paper("c", 140000, { escalation: { cap: NaN, increment: 500 } })), null,
    "and a NaN cap is not a clause either");
}

// --- the call: a highest-and-best call must not expire the field it gathered.
//
// calendar.js expired every open offer at `day + 2` flat. The call holds the
// field for HB_DEADLINE_DAYS, which is exactly that long — so the bug this
// guards is off by one day and only shows up on the deadline day itself, with a
// reputation hit per offer for a deadline the player set on purpose.
{
  newGame("bk_hearthstone");
  const rec2 = Clients.meetClient("cl_0101");
  const pl2 = Seller.takeListing(rec2);
  Seller.goLive(pl2, Seller.suggestedPrice(pl2), 1);
  pl2.offers.push(
    { id: "off_a", agentId: "ag_priya_natesan", price: Math.round(pl2.price * 0.97), status: "open", day: S.day,
      financing: "conventional", inspection: true, closeDays: 28, escalation: null },
    { id: "off_b", agentId: "ag_denny_kessler", price: Math.round(pl2.price * 0.96), status: "open", day: S.day,
      financing: "cash", inspection: false, closeDays: 21, escalation: null });
  // Age the field. An offer written today expires in two days and a call holds
  // it for two days, so a same-day field cannot tell the two rules apart — the
  // first version of this check passed against a calendar that ignored the call
  // entirely. Two days old is a field whose own window closes first.
  pl2.offers.forEach(o => { o.day = S.day - 2; });
  ok(Esc.canCallHighestAndBest(pl2), "two open offers on a live listing is a field you can call");
  const call = Esc.callHighestAndBest(pl2);
  eq(call.offers, 2, "the call goes out to both");
  ok(!Esc.canCallHighestAndBest(pl2), "and you only get one call per listing");

  const repBefore = S.rep;
  // Advance to the deadline. endDay() runs the expiry sweep and dailySellerTick.
  while (S.day < call.deadline) endDay();
  const expired = pl2.offers.filter(o => o.status === "expired");
  eq(expired.length, 0, "no offer expired while the call it was answering was still open",
    expired.map(o => o.id).join(","));
  ok(S.rep >= repBefore, "and no reputation was lost to a deadline the player set", `${repBefore} -> ${S.rep}`);
  eq(pl2.hbDeadline, null, "the call resolved on its deadline rather than hanging");
  ok(pl2.offers.every(o => o.status !== "open" || o.hbAnswered),
    "and every offer still standing actually answered");
}

// --- the payoff: accepting resolves the clause BEFORE the field it beats is
// cleared off the table. Getting this backwards pays the paper price and makes
// the whole mechanic decorative, and nothing on screen would say so.
{
  newGame("bk_hearthstone");
  const rec3 = Clients.meetClient("cl_0101");
  const pl3 = Seller.takeListing(rec3);
  Seller.goLive(pl3, Seller.suggestedPrice(pl3), 1);
  const rival = Math.round(pl3.price * 0.97);
  pl3.offers.push(
    { id: "off_r", agentId: "ag_priya_natesan", price: rival, status: "open", day: S.day,
      financing: "conventional", inspection: true, closeDays: 28, escalation: null },
    { id: "off_e", agentId: "ag_denny_kessler", price: rival - 8000, status: "open", day: S.day,
      financing: "conventional", inspection: true, closeDays: 28,
      escalation: { cap: rival + 20000, increment: 2500 } });
  const winner = pl3.offers[1];
  Seller.respondToOffer(pl3, winner, "accept");
  eq(pl3.status, "underContract", "the escalating offer went under contract");
  eq(pl3.acceptedOffer.price, rival + 2500,
    "at one increment over the offer it beat, not at the paper it was written on");
  eq(pl3.acceptedOffer.escalatedFrom, rival - 8000, "and the save records what was written");
  eq(pl3.offers.find(o => o.id === "off_r").status, "rejected", "the offer it beat is off the table");
}

// --- the buyer side, same arithmetic pointed the other way.
{
  newGame("bk_hearthstone");
  const brec = Clients.meetClient("cl_0008");
  const listing = DB.listings["ls_0001"];
  const ask = S.listingsState[listing.id].price;
  const deal = Deals.writeOffer(brec, listing, Math.round(ask * 0.95), {
    closeDays: 28, escalation: { cap: Math.round(ask * 1.02), increment: 1500 } });
  ok(!!Esc.clauseOf(deal), "a player's offer can carry a clause too");
  const competing = Math.round(ask * 0.97);
  const fired = Deals.fireBuyerClause(deal, competing);
  eq(deal.price, competing + 1500, "and it fires on the same rule the NPC clauses obey");
  ok(!fired.capped, "with room left under the cap");
  // Past the cap, the clause is a wall on this side too.
  const over = Math.round(ask * 1.1);
  Deals.fireBuyerClause(deal, over);
  eq(deal.price, Math.round(ask * 1.02), "a competing number past the cap leaves it at the cap");

  // What the clause costs: the listing agent counters at the cap once they can
  // read it. Measured against the same deal with the clause taken off, so this
  // reads agentRespond()'s own answer rather than re-deriving the counter.
  const probeAt = (escalation) => {
    const d = { id: "probe", mode: "buyer", clientRecId: null, listingId: listing.id,
      price: Math.round(ask * 0.86), ask, waiveInspection: false, waiveAppraisal: false,
      financing: "conventional", closeDays: 28, stage: "offerPending", round: 0,
      agentId: listing.listingAgentId, milestones: [], createdDay: 1, escalation };
    return Deals.agentRespond(d, Math.round(ask * 0.86));
  };
  const bare = probeAt(null);
  const withClause = probeAt({ cap: Math.round(ask * 0.99), increment: 1000 });
  eq(bare.verdict, "counter", "the probe offer draws a counter with no clause on it");
  eq(withClause.verdict, "counter", "and a counter with one");
  ok(withClause.counter > bare.counter,
    "a listing agent who can see your cap counters higher than one who cannot",
    `${bare.counter} -> ${withClause.counter}`);
  ok(withClause.readTheClause, "and says so, so the modal can print it");
}

// --- a career written before any of this existed.
{
  const store = memStore();
  const legacy = makeCareer("bk_indep");
  const lrec = { recId: "cr_1", clientId: "cl_0101", status: "active", satisfaction: 60, mood: 60,
    patience: 5, schmoozeCount: 0, revealed: [], viewed: {}, knownIssues: {}, toldIssues: {}, dealId: null };
  legacy.clients = [lrec];
  legacy.playerListings = [{
    id: "pl_1", clientRecId: "cr_1", listing: JSON.parse(JSON.stringify(DB.clients["cl_0101"].sellerListing)),
    status: "live", price: 200000, marketingTier: 1, staged: 0, repairsDone: [], disclosed: [],
    interest: 2, offers: [{ id: "off_1", agentId: "ag_chuck_brandt", price: 190000, status: "open",
      day: 1, financing: "conventional", inspection: true, closeDays: 28, escalation: 195000 }],
    openHouseBoost: 0, liveDay: 1, dom: 3,
  }];
  store.setItem(SAVE_KEY, JSON.stringify(legacy));
  const loaded = careerSlot(store).load();
  const o = loaded.playerListings[0].offers[0];
  ok(o.escalation && typeof o.escalation === "object",
    "repair rewrites a legacy bare-number clause into the structured shape", JSON.stringify(o.escalation));
  eq(o.escalation.cap, 195000, "keeping the cap it was written with");
  eq(loaded.playerListings[0].hbDeadline, null, "and a listing with no call in flight has a null deadline");
  ok(!Esc.canCallHighestAndBest(loaded.playerListings[0]),
    "one open offer is not a field");
}

/* ------------------------------------------------------------------- report */
console.log("");
if (failures.length) {
  console.log(`SMOKE FAILED: ${failures.length} of ${passed + failures.length}`);
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
}
console.log(`SMOKE OK: ${passed} passed`);
