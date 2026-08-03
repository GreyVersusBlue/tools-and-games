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

/* ------------------------------------------------------------------- report */
console.log("");
if (failures.length) {
  console.log(`SMOKE FAILED: ${failures.length} of ${passed + failures.length}`);
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
}
console.log(`SMOKE OK: ${passed} passed`);
