// What an agent's traits do (ARCHITECTURE 5.5). Tables only: a number multiplies the thing it
// names, and an absent number is 1. Letters from the road come in a later unit and will live
// in this file beside the tables.
//
//   risk    the chance a leg's season goes wrong (routes.js rolls it)
//   sell    what the agent gets for a load sold at a stop (1.05 is five percent more)
//   buy     what a load costs the agent at a stop (0.95 is five percent less)
//
// `knows-<stop>` helps only at that stop and on legs that start or end there.
// `speaks-<language>` does nothing to the numbers yet; letters will read it.

export const TRAIT_TABLE = {
  careful: { risk: 0.5 },
  bold: { risk: 1.25 },
  honest: {},
  sharp: { sell: 1.05, buy: 0.95 },
};
export const KNOWS = { risk: 0.85, sell: 1.03, buy: 0.97 };

const num = (t, k) => t?.[k] ?? 1;

/** The traits of an agent record from agents.json (a list of strings), or none. */
const traitsOf = agent => agent?.traits ?? [];

/** Multiplier on a leg's risk for this agent. */
export function riskFactor(agent, leg) {
  let f = 1;
  for (const t of traitsOf(agent)) {
    if (t.startsWith('knows-')) { const stop = t.slice(6); if (leg.from === stop || leg.to === stop) f *= KNOWS.risk; }
    else f *= num(TRAIT_TABLE[t], 'risk');
  }
  return f;
}

/** Multiplier on a price this agent gets at `stopId`; side is "sell" or "buy". */
export function bargain(agent, stopId, side) {
  let f = 1;
  for (const t of traitsOf(agent)) {
    if (t.startsWith('knows-')) { if (t.slice(6) === stopId) f *= KNOWS[side]; }
    else f *= num(TRAIT_TABLE[t], side);
  }
  return f;
}
