// Seeded sweeps of the listing side of the commercial tier on the BUILT code
// (DESIGN-seller-commercial.md section 6, group H of section 7, #1011). The
// design's figures came from a scratch reimplementation of the daily tick;
// these run the shipped one: takeListing(), the prep functions in
// offering.js, goLive() and dailySellerTick(), with weeklyMarketTick() on a
// Monday as endDay() calls it. Nothing else of endDay() runs, so no event,
// no client door and no save moves the dice between two listings.
//
//   node tools/sweep.mjs            the table, the design's targets beside it
//   node tools/sweep.mjs --seeds 20 fewer seeds a row (default 50)
//
// tools/smoke.mjs imports the functions and holds group H's bands.
import fs from "fs"; import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { DB } from "../js/data.js";
import { S, newGame, getClientRec } from "../js/state.js";
import * as Clients from "../js/engine/clients.js";
import * as Seller from "../js/engine/seller.js";
import * as Com from "../js/engine/commercial.js";
import * as Off from "../js/engine/offering.js";
import { weeklyMarketTick } from "../js/engine/market.js";

/** The four seasons' first days. A listing begun on day 253 runs past 336 here: the market tick does not care. */
export const START_DAYS = [1, 85, 169, 253];
export const HORIZON = 250;
/** "An offer worth taking": at 95% of the asking price or better (the design's 2.2). */
export const WORTH = 0.95;

/**
 * The five buildings of the design's table: the three sellers in data/, and
 * 212 Ferry St and 9 Ironworks Way from the MLS board, put in a seller's file
 * for the length of a sweep (the same doctoring the suite does for Ferry St).
 */
export function sweepSellers() {
  const out = ["cl_0301", "cl_0302", "cl_0303"];
  const base = DB.clients.cl_0302;
  for (const [id, lsId, owner] of [["sw_ferry", "ls_0101", 1095000], ["sw_ironworks", "ls_0102", 1160000]]) {
    const l = DB.listings[lsId];
    if (!l) continue;
    const { hiddenIssues, listingAgentId, id: _, ...rest } = JSON.parse(JSON.stringify(l));
    DB.clients[id] = { ...JSON.parse(JSON.stringify(base)), id, hiddenPrefs: [],
      sellerListing: { ...rest, issues: hiddenIssues, price: owner } };
    out.push(id);
  }
  return out;
}
export function dropSweepSellers() { delete DB.clients.sw_ferry; delete DB.clients.sw_ironworks; }

/** One career, one seller, one seed, at one day. Broker-Track, enough cash for any prep. */
function fresh(clientId, startDay, seed) {
  newGame("bk_indep");
  S.level = 4; S.cash = 50000; S.rep = 50;
  S.seed = ((seed + 1) * 2654435761 + startDay * 97) % 4294967296;
  for (let d = 1; d < startDay; d++) { S.day = d + 1; if ((S.day - 1) % 7 === 0) weeklyMarketTick(); }
  S.day = startDay;
  const rec = Clients.meetClient(clientId);
  return Seller.takeListing(rec);
}

/** A day of the shipped tick. */
function tick(pl) {
  S.day++;
  if ((S.day - 1) % 7 === 0) weeklyMarketTick();
  Seller.dailySellerTick(pl);
}

/**
 * One listing. `prep` is "full" (roll, report, every known item in the packet,
 * an opinion) or "roll" (the roll and nothing else, CT-4's least); `om` the
 * memorandum tier; `over` the asking price against packet value; `tours` an
 * investor tour on every day one can be had. Returns days live to the first
 * offer worth taking (null if none in the horizon), that offer, and the
 * days from signing to going live.
 */
export function runListing(clientId, { prep = "full", om = 1, over = 1, tours = false } = {}, startDay = 1, seed = 0) {
  const pl = fresh(clientId, startDay, seed);
  const signed = S.day;
  Off.startRentRoll(pl);
  if (prep === "full") Off.orderConditionReport(pl);
  while (!Com.rollVerified(pl)) tick(pl);
  if (prep === "full") {
    pl.listing.issues.forEach((_, i) => { if (Com.agentKnows(pl, i)) Seller.discloseIssue(pl, i); });
    Off.presentOpinion(pl);
  }
  const ask = Math.round(Com.packetValue(pl) * over / 1000) * 1000;
  const live = Seller.goLive(pl, ask, om);
  if (!live || live.refused) throw new Error(`${clientId} would not go live: ${(live && live.why || []).join(" ")}`);
  const prepDays = S.day - signed;
  for (let d = 1; d <= HORIZON; d++) {
    if (tours && !Off.tourBlockers(pl).length) Off.investorTour(pl, "straight");
    tick(pl);
    const good = pl.offers.find(o => o.status === "open" && o.price >= ask * WORTH);
    if (good) return { days: d, offer: good, prepDays, ask, pl };
    // An offer under the line is let go, as the design's runs did: the seller
    // is not in the room, and an open offer is not an offer worth taking.
    pl.offers.forEach(o => { if (o.status === "open") o.status = "expired"; });
  }
  return { days: null, offer: null, prepDays, ask, pl };
}

/** A house listing as the design measured one: light staging, professional photos, the inspection, asked at the suggested price. */
export function runHouse(clientId, startDay = 1, seed = 0) {
  const pl = fresh(clientId, startDay, seed);
  pl.preInspected = true;
  Seller.setStaging(pl, 1);
  const ask = Seller.suggestedPrice(pl);
  Seller.goLive(pl, ask, 1);
  for (let d = 1; d <= HORIZON; d++) {
    tick(pl);
    const good = pl.offers.find(o => o.status === "open" && o.price >= ask * WORTH);
    if (good) return { days: d, offer: good, prepDays: 0, ask };
    pl.offers.forEach(o => { if (o.status === "open") o.status = "expired"; });
  }
  return { days: null, offer: null, prepDays: 0, ask };
}

const quart = xs => {
  const s = [...xs].sort((a, b) => a - b), at = q => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
  return { q1: at(0.25), med: at(0.5), q3: at(0.75) };
};

/** A row: every building, every start day, `seeds` seeds. Days with no offer count as HORIZON, as the design's table did. */
export function sweepRow(opts, seeds = 50, sellers = sweepSellers()) {
  const days = [], gross = [];
  let none = 0;
  for (const id of sellers) for (const day of START_DAYS) for (let s = 0; s < seeds; s++) {
    const r = runListing(id, opts, day, s);
    if (r.days === null) { none++; days.push(HORIZON); continue; }
    days.push(r.days);
    const held = r.prepDays + r.days + r.offer.closeDays;
    gross.push({ gross: r.offer.price * Com.SIDE_COMMISSION.commercial, held, price: r.offer.price });
  }
  return { n: days.length, none, ...quart(days), gross };
}

/** The six house sellers, the same way. */
export function houseRow(seeds = 50) {
  const ids = Object.keys(DB.clients).filter(id => DB.clients[id].type === "seller" && !Com.sellsBuilding(DB.clients[id]));
  const days = [], gross = [];
  for (const id of ids) for (const day of START_DAYS) for (let s = 0; s < seeds; s++) {
    const r = runHouse(id, day, s);
    if (r.days === null) { days.push(HORIZON); continue; }
    days.push(r.days);
    gross.push({ gross: r.offer.price * Com.SIDE_COMMISSION.residential, held: r.days + r.offer.closeDays, price: r.offer.price });
  }
  return { n: days.length, ...quart(days), gross };
}

/** Median gross a day a client slot is held. */
export const grossPerDay = g => quart(g.map(x => x.gross / x.held)).med;

/** The content from disk, the way the suite reads it, when this file is run on its own. */
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
  const seeds = i > 0 ? parseInt(process.argv[i + 1], 10) : 50;
  loadData();
  const sellers = sweepSellers();
  const rows = [
    ["flyer, roll only, at packet value", { prep: "roll", om: 0 }, "192 / 250 / 250, 553 of 1,000 none (no roll then)"],
    ["memorandum, full prep, at packet value", { om: 1 }, "18 / 23 / 29, 0 none"],
    ["data room, full prep, at packet value", { om: 2 }, "14 / 17 / 21, 0 none"],
    ["data room, full prep, 5% under", { om: 2, over: 0.95 }, "13 / 15 / 18, 0 none"],
    ["memorandum, full prep, 8% over", { om: 1, over: 1.08 }, "38 / 57 / 97, 45 none"],
    ["data room, full prep, 15% over", { om: 2, over: 1.15 }, "66 / 106 / 152, 89 none"],
    ["memorandum, full prep, a tour a week", { om: 1, tours: true }, "(not simulated)"],
  ];
  const house = houseRow(seeds);
  console.log(`house listings: ${house.q1} / ${house.med} / ${house.q3} days (design 9 / 12 / 16), gross a day $${grossPerDay(house.gross).toFixed(0)} (design $275)`);
  for (const [name, opts, target] of rows) {
    const r = sweepRow(opts, seeds, sellers);
    const g = r.gross.length ? grossPerDay(r.gross) : 0;
    console.log(`${name}: ${r.q1} / ${r.med} / ${r.q3}, ${r.none} of ${r.n} none · gross a day $${g.toFixed(0)} (${(g / grossPerDay(house.gross)).toFixed(2)} of a house) · design ${target}`);
  }
  dropSweepSellers();
}
