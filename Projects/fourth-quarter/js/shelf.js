// shelf.js — what is on the shelf, and since when. Pure: no DOM, no three.js,
// no import. Stock as dated lots, each item's shelf life, oldest out first,
// what goes off at the close, and the Commercial Walk-In. campaign.js owns the
// record (`c.shelf`), the count (`c.stock`) and the cash; this file owns the
// arithmetic (#909).
//
// Ported from the 2D build (`Projects/The-Fourth-Quarter.html`, its pantry),
// not copied. The shelf lives in nights (wings 3, burgers 4, nachos 5, fries
// 7, a keg 14, soda for ever), the walk-in's $1,000, $18 a night and two extra
// nights on food, oldest-first use and the inspector's "anything on its last
// night" are the 2D build's. What is different:
//
// - **An undated shelf is the rule this build already had, exactly.** Food
//   rots campaign.js's SPOILAGE_RATE of what is left at every close, drink
//   never does, and nothing here is asked anything. A save from before this
//   file has an undated shelf, and a campaign that never dates it settles to
//   the same bytes it did (`test/smoke-settle.mjs`'s pin, and whole seasons
//   compared tree against tree).
// - **Dating the shelf is the choice, and it is one way**, like the rota. It
//   swaps one rule for the other and a night is closed under exactly one of
//   them: campaign.js's closeNight() calls applySpoilage() or spoil() below,
//   never both, so nothing is charged twice. Dated, food stops rotting 15% a
//   night and keeps whole until its date; then all of what is left of that
//   delivery goes at once. And beer, which the flat rate never touched, gets
//   a date of its own. A careful shelf loses nothing; a stockpile loses all of
//   itself instead of a seventh. If the dates came off again a player would
//   date the shelf for the week and tear the labels off the night a big order
//   was due.
// - **The night it is dated, what is on the shelf is dated that day.** The
//   flat rate took its 15% at every close before and takes nothing after, and
//   nothing is back-dated: there is no record of when an undated serving came
//   in.
// - **`c.stock` stays the count.** The night engine takes a serving off it as
//   a ticket fires and a card adds to it or cuts it, as before, and every
//   read of it in the game is still right. The lots are the same servings
//   with dates on, and reconcile() is what keeps the two agreeing: servings
//   gone since the lots were last read came off the oldest lot first, and
//   servings that turned up are a lot received today. So first in, first out
//   is exact for a night's sales and for a card's cut, and the engine did not
//   change. What it cannot see is order inside one reading: stock given and
//   stock sold between two readings is one difference. An order is read on
//   both sides, so a delivery is never netted against anything; no card gives
//   stock today, and one that did would have its gift counted as sold first.
// - **The walk-in reads the date, it does not rewrite it.** A lot holds the
//   day it came in; how long it keeps is the table's nights plus the
//   walk-in's two, asked at the close. Install it and the food already on the
//   shelf keeps two nights longer. The 2D build stamped the nights on the lot
//   at delivery, so its walk-in only helped the next order.
// - **A delivery is dated the day it is ordered.** supply.js has no delivery
//   days (the truck is out back), so the day an order is placed is the day
//   its lots are received, at all three houses. A bulk break's hundred wings
//   are one lot with three nights on it.

/** Nights an item keeps, counting the day it came in. `cold` is what the
 *  walk-in holds: food, not kegs. An item not in here never goes off. */
export const SHELF = {
  wings:  { nights: 3, cold: true },
  burger: { nights: 4, cold: true },
  nachos: { nights: 5, cold: true },
  fries:  { nights: 7, cold: true },
  beer:   { nights: 14, cold: false },
};
export const WALKIN = { name: "Commercial Walk-In", cost: 1000, fee: 18, nights: 2,
  pro: "Fresh food keeps 2 more nights on the shelf, what is already there included.",
  con: "$18/night in compressor power, open or dark. Does nothing for a keg." };

const cents = n => Math.round(n * 100) / 100;

export function newShelf() { return { dated: false, walkin: false, lots: {} }; }
export function isDated(shelf) { return !!shelf && shelf.dated === true; }
/** The walk-in is in. It can only be on a dated shelf. */
export function hasWalkin(shelf) { return isDated(shelf) && shelf.walkin === true; }
/** What the walk-in costs tonight. */
export function walkinFee(shelf) { return hasWalkin(shelf) ? WALKIN.fee : 0; }

/** Nights `id` keeps on this shelf, or 0 for an item that never goes off. */
export function keeps(shelf, id) {
  const s = SHELF[id];
  if (!s) return 0;
  return s.nights + (s.cold && hasWalkin(shelf) ? WALKIN.nights : 0);
}
/** Nights a lot has left, tonight included: 1 is its last night, and what is
 *  left of it goes at tonight's close. Never under 1 for a lot still here. */
export function nightsLeft(shelf, id, lot, today) {
  return Math.max(1, lot.day + keeps(shelf, id) - today);
}

/** One item's lots as the record should hold them: whole days no later than
 *  `today`, a count above nothing, oldest first, one lot a day. */
function tidy(lots, today) {
  const byDay = new Map();
  for (const l of Array.isArray(lots) ? lots : []) {
    if (!l || typeof l !== "object" || !Number.isFinite(l.n) || !(l.n > 0)) continue;
    const day = Math.max(1, Math.min(today, Math.round(Number.isFinite(l.day) ? l.day : today)));
    byDay.set(day, (byDay.get(day) || 0) + l.n);
  }
  return [...byDay.keys()].sort((a, b) => a - b).map(day => ({ day, n: byDay.get(day) }));
}

/**
 * The lots, made to agree with the count. `stock` is {itemId: servings} as
 * the game holds it now. For every item with a date: servings missing since
 * the lots were last read come off the oldest lot first (a night's sales, a
 * card's cut), and servings the lots do not know about are one lot received
 * `today` (a delivery, a card's gift, a dev fill). Returns a new record; the
 * identity on an undated shelf.
 */
export function reconcile(shelf, stock, today) {
  if (!isDated(shelf)) return shelf;
  const lots = {};
  for (const id in SHELF) {
    const have = Math.max(0, Number.isFinite(stock && stock[id]) ? stock[id] : 0);
    const mine = tidy(shelf.lots && shelf.lots[id], today);
    let over = mine.reduce((a, l) => a + l.n, 0) - have;
    while (over > 0 && mine.length) {
      const take = Math.min(mine[0].n, over);
      mine[0].n -= take; over -= take;
      if (!(mine[0].n > 0)) mine.shift();
    }
    if (over < 0) {
      const last = mine[mine.length - 1];
      if (last && last.day === today) last.n -= over; else mine.push({ day: today, n: -over });
    }
    if (mine.length) lots[id] = mine;
  }
  return { dated: true, walkin: shelf.walkin === true, lots };
}

/** Date the shelf. One way: see the header. What is on it is dated `today`. */
export function date(shelf, stock, today) {
  return reconcile({ dated: true, walkin: false, lots: {} }, stock, today);
}
/** Install the walk-in. Null on an undated shelf or one that has it. */
export function install(shelf) {
  if (!isDated(shelf) || hasWalkin(shelf)) return null;
  return { dated: true, walkin: true, lots: shelf.lots };
}

/**
 * The close: every lot on its last night goes, whole. Call it on a reconciled
 * shelf. Returns the new record and `byItem`, servings lost by item; the
 * identity and nothing lost on an undated shelf, which is not this file's to
 * rot.
 */
export function spoil(shelf, today) {
  const out = { shelf, byItem: {} };
  if (!isDated(shelf)) return out;
  const lots = {};
  for (const id in shelf.lots) {
    const keep = [];
    for (const l of shelf.lots[id]) {
      if (nightsLeft(shelf, id, l, today) <= 1) out.byItem[id] = (out.byItem[id] || 0) + l.n;
      else keep.push(l);
    }
    if (keep.length) lots[id] = keep;
  }
  out.shelf = { dated: true, walkin: shelf.walkin === true, lots };
  return out;
}
/** What `byItem` cost wholesale, at `costs` a serving, to the cent. */
export function valueOf(byItem, costs) {
  let v = 0;
  for (const id in byItem) v += byItem[id] * (costs[id] || 0);
  return cents(v);
}

/** Servings of `id` that go at tonight's close if nobody buys them. */
export function lastNight(shelf, id, today) {
  if (!isDated(shelf)) return 0;
  return ((shelf.lots && shelf.lots[id]) || []).reduce((a, l) => a + (nightsLeft(shelf, id, l, today) <= 1 ? l.n : 0), 0);
}
/** One item's lots for the Stock panel: [{ day, n, left }], oldest first. */
export function lotsOf(shelf, id, today) {
  if (!isDated(shelf)) return [];
  return ((shelf.lots && shelf.lots[id]) || []).map(l => ({ day: l.day, n: l.n, left: nightsLeft(shelf, id, l, today) }));
}
/**
 * What the inspector is shown: for each cold item, the servings that are not
 * on their last night at the open. The oldest sells first, so later in the
 * night whatever the shelf holds over this number is last-night food still
 * unsold. Null on an undated shelf, where there is no date to read.
 */
export function freshAtOpen(shelf, today) {
  if (!isDated(shelf)) return null;
  const out = {};
  for (const id in SHELF) {
    if (!SHELF[id].cold) continue;
    out[id] = ((shelf.lots && shelf.lots[id]) || []).reduce((a, l) => a + (nightsLeft(shelf, id, l, today) > 1 ? l.n : 0), 0);
  }
  return out;
}

// ---------- the save ----------
/** `shelf` is additive. Anything that is not a dated record is an undated
 *  shelf with no walk-in and no lots; a dated one has its lots tidied and
 *  made to agree with the count. Idempotent. */
export function repairShelf(shelf, stock, today) {
  if (!isDated(shelf)) return newShelf();
  const src = shelf.lots && typeof shelf.lots === "object" ? shelf.lots : {};
  return reconcile({ dated: true, walkin: shelf.walkin === true, lots: src }, stock, today);
}
