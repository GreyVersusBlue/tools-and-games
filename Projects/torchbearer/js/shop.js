// shop.js — coin, price, the treasure a level is worth, and the arithmetic of
// buying and selling.
//
// Before this, an adventure could hand the hero an item and the hero could not
// hold it. `gotoScene` did `if(it.startsWith("healing-potion")) push` and
// otherwise printed "Gained: Vane Family Saber" into the Chronicle and threw
// the saber away — the item existed for exactly one line of prose. There was no
// money at all: no `price` on an item, no purse in the save, nothing to spend
// and nowhere to spend it.
//
// Nothing here touches the DOM, the Registry or a save, for the same reason
// js/campaign.js does not: `test/smoke.mjs` drives a whole shop visit under
// plain Node. registry.js imports it (the validator has to read a price to
// reject a bad one), so this file imports nothing at all — registry.js is the
// bottom of the dependency stack and rules.js is above it.
//
// **Money is counted in copper pieces, everywhere.** A purse is an integer of
// copper, a price is an integer of copper, and `coinText` is the only place
// that turns 1250 back into "12 gp, 5 sp". Gold as a fractional number would
// have been the obvious choice and is the wrong one: 0.2 + 0.1 is
// 0.30000000000000004, and a purse that drifts by a hundredth of a gold piece
// every transaction is a bug nobody can reproduce. Authors never type copper —
// they write `"price": "12 gp"` the way the Player Core prints it, and
// `parseCoins` converts once.

/** PF2e's coins, in copper. `pp` is accepted on input; `coinText` never prints it. */
export const COIN = { pp: 1000, gp: 100, sp: 10, cp: 1 };

/**
 * `"12 gp"` → 1200. `"1 gp, 5 sp"` → 150. `"5 cp"` → 5.
 *
 * Returns null for anything it cannot read, which is what the validator
 * reports and what `priceOf` turns into "this cannot be bought or sold".
 * A bare number is deliberately unreadable: `"price": 12` could mean twelve
 * gold or twelve copper, the two differ by a factor of a hundred, and guessing
 * silently is exactly the failure this whole file is written against.
 */
export function parseCoins(text) {
  if (typeof text !== "string") return null;
  const parts = text.trim().split(",");
  let total = 0;
  for (const part of parts) {
    const m = /^\s*(\d+)\s*(pp|gp|sp|cp)\s*$/i.exec(part);
    if (!m) return null;
    total += Number(m[1]) * COIN[m[2].toLowerCase()];
  }
  return parts.length ? total : null;
}

/**
 * 1250 → "12 gp, 5 sp". The inverse of `parseCoins` for every value it can
 * produce, which `smoke.mjs` checks by round-tripping the shipped prices.
 * Platinum is not printed: the Player Core lists item prices in gp however
 * large they get, and a shop card reading "2 pp" would send an author looking
 * for a conversion table.
 */
export function coinText(cp) {
  const n = Math.max(0, Math.floor(Number(cp) || 0));
  if (n === 0) return "0 cp";
  const out = [];
  const gp = Math.floor(n / COIN.gp);
  const sp = Math.floor((n % COIN.gp) / COIN.sp);
  const c = n % COIN.sp;
  if (gp) out.push(`${gp} gp`);
  if (sp) out.push(`${sp} sp`);
  if (c) out.push(`${c} cp`);
  return out.join(", ");
}

/** An item's price in copper, or null when it has none and so cannot be traded. */
export function priceOf(item) {
  return item && item.price !== undefined ? parseCoins(item.price) : null;
}

/**
 * Half, rounded down, and never zero for something that had a price — a shop
 * that pays nothing for a real item reads as a broken button, not as a bad
 * deal. Selling at half is the Player Core's own rule for used goods.
 */
export function sellPrice(item) {
  const p = priceOf(item);
  if (p === null) return null;
  return p > 0 ? Math.max(1, Math.floor(p / 2)) : 0;
}

/**
 * A potion is a consumable that heals, not an id that starts with
 * "healing-potion". The page tested the id prefix, so a pack whose potion was
 * called `elixir-of-life` handed the hero a Chronicle line and no potion.
 */
export function isPotion(item) {
  return !!(item && item.category === "consumable" && item.heal);
}

/**
 * PF2e's Treasure by Level, total value for a party of four, in gold.
 *
 * Torchbearer runs one hero — companions are fixed NPC stat blocks that buy
 * nothing — so the budget an adventure of that level may hand out is a quarter
 * of the row, in copper. Level 3 is 500 gp for four, so 125 gp for one, which
 * is ten Lesser Healing Potions or most of a breastplate: enough that the shop
 * is a decision and not enough that a level-3 hero walks out in half plate.
 */
export const TREASURE_BY_LEVEL = {
  1: 175, 2: 300, 3: 500, 4: 850, 5: 1350,
  6: 2000, 7: 2900, 8: 4000, 9: 5700, 10: 8000
};

/** One hero's share of an adventure of this level, in copper. */
export function treasureBudget(level) {
  const l = Math.max(1, Math.min(10, Math.floor(Number(level) || 1)));
  return Math.round(TREASURE_BY_LEVEL[l] / 4) * COIN.gp;
}

/**
 * Everything one adventure can hand out, in copper: every scene's
 * `onEnter.gold` plus the price of every `onEnter.items` entry.
 *
 * Summed across every scene, not along one path. A scene graph branches, so no
 * single playthrough can collect all of it; the sum is therefore the ceiling,
 * and an adventure whose ceiling is inside the budget cannot break the curve
 * however it is played. `find` is how the caller resolves an item id, because
 * an adventure may hand out an item its own pack defines or one already loaded.
 */
export function treasureIn(adv, find) {
  let total = 0;
  Object.values((adv && adv.scenes) || {}).forEach(sc => {
    const oe = sc && sc.onEnter;
    if (!oe) return;
    if (oe.gold !== undefined) total += parseCoins(oe.gold) || 0;
    // Array-or-nothing rather than `oe.items || []`. The validator calls this
    // on packs it is in the middle of rejecting, and its job is to report a
    // malformed one, never to throw on it — `"items": "a-string"` is already
    // its own error and must not also be a TypeError that swallows the report.
    (Array.isArray(oe.items) ? oe.items : []).forEach(id => { total += priceOf(find(id)) || 0; });
  });
  return total;
}

/**
 * What a hero is carrying that money touches: the purse in copper, the loose
 * items, and the potion stack (which lives on the combatant, not in this
 * object's own storage — the page passes it in and puts it back).
 *
 * `buy` and `sell` return a new holdings object or null. Null is "the card is
 * disabled", never a purse that went negative: the one arithmetic error a shop
 * can make that a player would notice and could not undo.
 */
export function buy(holdings, item) {
  const price = priceOf(item);
  const h = normalize(holdings);
  if (price === null || price > h.gold) return null;
  const out = { gold: h.gold - price, inventory: [...h.inventory], potions: [...h.potions] };
  if (isPotion(item)) out.potions.push(item.id); else out.inventory.push(item.id);
  return out;
}

/** Sell the inventory entry at `index`, whose item is `item`. */
export function sell(holdings, index, item) {
  const h = normalize(holdings);
  const price = sellPrice(item);
  if (price === null || !Number.isInteger(index) || index < 0 || index >= h.inventory.length) return null;
  const inventory = [...h.inventory];
  inventory.splice(index, 1);
  return { gold: h.gold + price, inventory, potions: [...h.potions] };
}

/** Add found coin. Kept here so the page has one place that touches the purse. */
export function addCoins(holdings, cp) {
  const h = normalize(holdings);
  return { gold: h.gold + Math.max(0, Math.floor(Number(cp) || 0)), inventory: [...h.inventory], potions: [...h.potions] };
}

function normalize(h) {
  return {
    gold: Math.max(0, Math.floor(Number(h && h.gold) || 0)),
    inventory: Array.isArray(h && h.inventory) ? h.inventory : [],
    potions: Array.isArray(h && h.potions) ? h.potions : []
  };
}
