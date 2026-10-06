// supply.js — who the truck out back belongs to. Pure: no DOM, no three.js,
// no import. Three supply houses, what an order costs at each, what an
// account costs a week, and the par sheet. campaign.js owns the record
// (`c.dist`, `c.pars`) and the cash; this file owns the arithmetic (#905).
//
// Ported from the 2D build (`Projects/The-Fourth-Quarter.html`, its sprint 9),
// not copied. The three houses, their multipliers, the weekly fee, the minimum
// and its drop charge, the loyalty step and both event cards' numbers are the
// 2D build's. What is different:
//
// - **County Line is the rule this build already had, exactly.** List price,
//   no fee, no minimum, no bulk break and no loyalty. A save from before this
//   file is signed with County Line and pays for an order what it paid before,
//   to the cent, and `test/smoke-settle.mjs` holds its settlement to the old
//   pin. In the 2D build bulk breaks and loyalty were every house's; here they
//   are what an account buys, so the default cannot get cheaper by standing
//   still.
// - **Stock is counted in servings, not units.** The 2D build broke food at
//   10, 25 and 100 units and kegs at 3, 6 and 12 (25 or more servings each).
//   Here a line is servings, so food breaks at 25, 50 and 100 and drink at 75,
//   150 and 300. Food rots SPOILAGE_RATE of the shelf a night and drink does
//   not, so the top food break is a bet against the walk-in and the top drink
//   break is only cash tied up.
// - **Gold Standard's edge is the plate's price.** The 2D build lifted food
//   "appeal" eight points, which let a player raise prices without losing
//   plates. This build has no price sheet, so the eight points are the price:
//   food sells for 8% more (the engine's `plateMult`, beside the Craft Tap
//   Wall's `beerMult`).
// - **No delivery days and no reliability number.** The truck is out back and
//   an order lands when it is placed, as before. The 2D build has neither, the
//   "Truck Breaks Down" card is already how a delivery fails, and inventing a
//   lead time would change every stock read in the game for the session after
//   this one (per-lot shelf life) to change again.

export const DEFAULT_HOUSE = "county";

/** Bulk breaks, [servings on the line, fraction off]. */
export const BULK_FOOD = [[25, 0.04], [50, 0.06], [100, 0.10]];
export const BULK_DRINK = [[75, 0.04], [150, 0.06], [300, 0.10]];

export const HOUSES = {
  county: { id: "county", name: "County Line Provisions", mult: 1, fee: 0, minOrder: 0, dropFee: 0, account: false, plateMult: 1,
            pro: "No fees, no minimums. The truck that always comes.",
            con: "List price is list price: no bulk breaks, no loyalty." },
  cask:   { id: "cask", name: "Cask & Carton Wholesale", mult: 0.90, fee: 110, minOrder: 120, dropFee: 25, account: true, plateMult: 1,
            pro: "Everything 10% under list, with bulk breaks and loyalty on top.",
            con: "$110 a week for the account (billed Mondays), and an order under $120 draws a $25 drop charge." },
  gold:   { id: "gold", name: "Gold Standard Provisions", mult: 1.12, fee: 0, minOrder: 0, dropFee: 0, account: true, plateMult: 1.08,
            pro: "Premium sourcing: every plate of food sells for 8% more. Bulk breaks and loyalty too.",
            con: "Everything costs 12% over list, the beer and the soda included." },
};
export const HOUSE_ORDER = ["county", "cask", "gold"];

/** The weekday an account is billed. DAYS[0] in league.js; spelled here
 *  because this file imports nothing. */
export const FEE_DAY = "Mon";
/** Every LOYALTY_STEP dollars of goods bought from one house is another
 *  LOYALTY_PER off, to LOYALTY_MAX. Switching houses starts it at nothing. */
export const LOYALTY_STEP = 1000;
export const LOYALTY_PER = 0.01;
export const LOYALTY_MAX = 0.05;
/** What "Warehouse Walkout" costs an account that rides it out: one step. */
export const STRIKE_SPEND = 1000;

const cents = n => Math.round(n * 100) / 100;

export function newDist() { return { id: DEFAULT_HOUSE, spend: 0 }; }
export function houseDef(dist) { return HOUSES[dist && dist.id] || HOUSES[DEFAULT_HOUSE]; }

/** The fraction off a line of `qty` servings. Nothing at a house with no account. */
export function bulkOff(dist, kind, qty) {
  if (!houseDef(dist).account) return 0;
  let off = 0;
  for (const [min, x] of (kind === "drink" ? BULK_DRINK : BULK_FOOD)) if (qty >= min) off = x;
  return off;
}
/** The next break above `qty`, as [servings, fraction], or null: the panel's hint. */
export function nextBreak(dist, kind, qty) {
  if (!houseDef(dist).account) return null;
  return (kind === "drink" ? BULK_DRINK : BULK_FOOD).find(([min]) => qty < min) || null;
}

export function loyaltyOff(dist) {
  if (!houseDef(dist).account) return 0;
  const steps = Math.floor(Math.max(0, (dist && dist.spend) || 0) / LOYALTY_STEP);
  // capped in whole steps, so the answer is one of six literals' worth of
  // arithmetic and never 0.05 plus a rounding tail
  return Math.min(Math.round(LOYALTY_MAX / LOYALTY_PER), steps) * LOYALTY_PER;
}

/** One serving on a line of `qty`, at this house, off `list`. Unrounded. */
export function unitCost(dist, kind, qty, list) {
  return list * houseDef(dist).mult * (1 - bulkOff(dist, kind, qty)) * (1 - loyaltyOff(dist));
}

/**
 * What an order costs. `order` is {itemId: servings}; `items` is
 * {itemId: {cost, kind}}, campaign.js's STOCK_COST and engine.js's MENU.
 *
 * `goods` is what the house is paid for the stock, `list` what County Line
 * would have charged, `drop` the charge for an order under the house's
 * minimum, `total` what leaves the till. Loyalty builds on `goods`, never on
 * a fee. An empty order is all zeroes and draws no drop charge.
 */
export function quote(dist, order, items) {
  const h = houseDef(dist);
  const lines = {};
  let goods = 0, list = 0;
  for (const id in order) {
    const qty = order[id] || 0;
    if (!(qty > 0) || !items[id]) continue;
    const unit = unitCost(dist, items[id].kind, qty, items[id].cost);
    lines[id] = { qty, unit, off: bulkOff(dist, items[id].kind, qty) };
    goods += qty * unit;
    list += qty * items[id].cost;
  }
  goods = cents(goods); list = cents(list);
  const drop = goods > 0 && goods < h.minOrder ? h.dropFee : 0;
  return { house: h.id, lines, goods, list, drop, total: cents(goods + drop) };
}

/** An account's fee if today is the day it is billed, or 0. */
export function weeklyFee(dist, weekday) {
  return weekday === FEE_DAY ? houseDef(dist).fee : 0;
}
/** What a plate of food sells for at this house's sourcing, as a multiplier. */
export function plateMult(dist) { return houseDef(dist).plateMult; }

/** The record after `goods` dollars of stock were bought. Returns a new one. */
export function afterOrder(dist, goods) {
  const h = houseDef(dist);
  return { id: h.id, spend: h.account ? cents(Math.max(0, (dist && dist.spend) || 0) + Math.max(0, goods)) : 0 };
}
/** The record after a card moved the account's standing by `d` dollars of
 *  spend (negative: "Warehouse Walkout" ridden out). Floored at nothing. */
export function afterStanding(dist, d) {
  const h = houseDef(dist);
  return { id: h.id, spend: h.account ? cents(Math.max(0, ((dist && dist.spend) || 0) + d)) : 0 };
}
/** Sign with another house: a fresh account, the old one's loyalty gone.
 *  Null for a house that does not exist or the one already signed. */
export function switchHouse(dist, id) {
  if (!HOUSES[id] || houseDef(dist).id === id) return null;
  return { id, spend: 0 };
}

// ---------- the par sheet ----------
/** The cart after topping every line up to its par: what is on the shelf plus
 *  what is already in the cart counts, and a line at or over par is left
 *  alone. Returns a new cart; `added` is how many servings went in. */
export function parFill(pars, stock, cart) {
  const out = { ...cart };
  let added = 0;
  for (const id in pars) {
    const par = pars[id];
    if (!(par > 0)) continue;
    const short = par - ((stock && stock[id]) || 0) - (out[id] || 0);
    if (short > 0) { out[id] = (out[id] || 0) + short; added += short; }
  }
  return { cart: out, added };
}
export const PAR_MAX = 999;
/** One par, as the sheet stores it: a whole number of servings, 0 for none. */
export function parValue(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(PAR_MAX, n) : 0;
}

// ---------- the save ----------
/** `dist` is additive. Anything that is not a house this table has is County
 *  Line with nothing spent; a spend that is not a finite number of dollars at
 *  or above zero is nothing; a house with no account carries none. Idempotent. */
export function repairDist(d) {
  if (!d || typeof d !== "object" || !HOUSES[d.id]) return newDist();
  const spend = Number.isFinite(d.spend) && d.spend > 0 && HOUSES[d.id].account ? cents(d.spend) : 0;
  return { id: d.id, spend };
}
/** `pars` keeps a whole positive number under every id in `ids`, and nothing else. */
export function repairPars(p, ids) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  for (const id of ids) { const v = parValue(p[id]); if (v > 0) out[id] = v; }
  return out;
}
