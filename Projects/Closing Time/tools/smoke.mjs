// Headless engine smoke test (node). Not shipped logic — verifies loops run without exceptions.
import fs from "fs"; import path from "path";
import { DB } from "../js/data.js";
import { S, newGame, getClientRec, contentClient, activeClients } from "../js/state.js";
import * as Clients from "../js/engine/clients.js";
import * as Deals from "../js/engine/deals.js";
import * as Seller from "../js/engine/seller.js";
import { endDay } from "../js/engine/calendar.js";
import { maybeFireEvent } from "../js/engine/events.js";

const root = path.resolve("data");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
for (const cat of Object.keys(DB)) for (const p of manifest[cat]) {
  const o = JSON.parse(fs.readFileSync(path.join(root, p)));
  DB[cat][o.id] = o;
}
console.log("content loaded:", Object.fromEntries(Object.entries(DB).map(([k, v]) => [k, Object.keys(v).length])));

newGame("bk_hearthstone");

// --- Buyer loop ---
const rec = Clients.meetClient("cl_0001");
const l = DB.listings["ls_0001"];
console.log("fit:", Clients.fitScore(rec, l));
Deals.startViewing(rec, l);
Deals.askQuestion(rec, l, "roof");
Deals.discloseToClient(rec, l);
Clients.schmooze(rec);
const deal = Deals.writeOffer(rec, l, 160000, { closeDays: 21 });
let resp = Deals.agentRespond(deal, 160000);
console.log("agent:", resp.verdict, resp.counter || "");
if (resp.verdict === "counter") { deal.price = resp.counter; }
Deals.acceptDeal(deal);

// --- Seller loop ---
const srec = Clients.meetClient("cl_0101");
const pl = Seller.takeListing(srec);
Seller.discloseIssue(pl, 1);
Seller.goLive(pl, Seller.suggestedPrice(pl), 1);
Seller.spawnNPCOffer(pl);
const off = pl.offers[0];
console.log("npc offer:", off.price, DB.agents[off.agentId].name);
console.log("seller read:", Seller.sellerReaction(pl, off).inclination.toFixed(2));
Seller.respondToOffer(pl, off, "accept");

// --- Open house machinery ---
const pl2meta = Seller.runOpenHouse(pl);
Seller.finishOpenHouse(pl, 2.5, { honest: 1, spin: 0 });

// --- Advance 40 days, resolving choices bluntly ---
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
console.log("recent log:");
S.log.slice(0, 12).forEach(x => console.log("  D" + x.day, x.text));
console.log("SMOKE OK");
