// market.js — interest rates, seasonal demand, neighborhood drift, valuations.
import { DB } from "../data.js";
import { S, rand, randRange, seasonOf, log } from "../state.js";

export const SEASON_DEMAND = { Winter: 0.85, Spring: 1.15, Summer: 1.1, Fall: 0.95 };

export function marketHeat(nbId) {
  const nb = DB.neighborhoods[nbId];
  const rateDrag = Math.max(0.6, 1 - (S.market.rate - 5.5) * 0.08); // higher rates cool everything
  const buzz = S.activeEffects
    .filter(e => e.kind === "buzz" && e.nbId === nbId && e.untilDay >= S.day)
    .reduce((m, e) => m + e.mult, 0);
  return nb.buyerDemand * SEASON_DEMAND[seasonOf(S.day)] * rateDrag * (1 + buzz);
}

export function weeklyMarketTick() {
  // Rate drift
  const drift = randRange(-0.15, 0.15);
  S.market.rate = Math.max(3.5, Math.min(9.5, S.market.rate + drift));
  // Neighborhood index drift
  for (const id in DB.neighborhoods) {
    const nb = DB.neighborhoods[id];
    const change = nb.priceTrend + randRange(-nb.trendVolatility, nb.trendVolatility);
    S.market.nb[id] = Math.max(0.7, S.market.nb[id] * (1 + change));
  }
  S.activeEffects = S.activeEffects.filter(e => e.untilDay >= S.day);
}

// True underlying value of a content listing (ask price is the seller's opinion; this is the market's).
export function trueValue(listing) {
  const nbMult = S.market.nb[listing.neighborhood] || 1;
  const conditionAdj = 0.9 + listing.condition * 0.14;
  return listing.price * conditionAdj * nbMult;
}

// Value of a player-managed seller listing (baseValue + repairs/staging already folded into condition).
export function playerListingValue(pl) {
  const nbMult = S.market.nb[pl.listing.neighborhood] || 1;
  const conditionAdj = 0.88 + pl.listing.condition * 0.18;
  return pl.listing.baseValue * conditionAdj * nbMult;
}

export function appraisalFor(price, value) {
  // Appraisers anchor between contract price and modeled value, with noise.
  const anchor = value * 0.65 + price * 0.35;
  return anchor * randRange(0.96, 1.05);
}

export function bumpKnowledge(nbId, amt = 0.34) {
  S.knowledge[nbId] = Math.min(5, (S.knowledge[nbId] || 0) + amt);
  const k = S.knowledge[nbId];
  if (Math.floor(k) > Math.floor(k - amt)) {
    const note = DB.neighborhoods[nbId].knowledgeNotes[Math.min(Math.floor(k) - 1, DB.neighborhoods[nbId].knowledgeNotes.length - 1)];
    if (note) log(`Local knowledge (${DB.neighborhoods[nbId].name}): "${note}"`, "know");
  }
}

export function knowledgeEdge(nbId) { return (S.knowledge[nbId] || 0) / 5; } // 0..1
