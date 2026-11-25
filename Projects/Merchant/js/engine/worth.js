// What the house is worth, and the lines that say why it moved (MER-146, M4e play problem 7: worth rose by 81, 127, 142 and 104 dinars in four
// seasons of one game and by 368 in another, with no paper, Accounts line or ledger line to say why).
//
// `worthOf` is the figure the top bar shows: cash and the warehouse at the last prices known at home, less what is owed, plus what is out
// on the road at the house's share. Worth moves for a reason the engine can name, and every move of NOTE dinars or more that has no paper of
// its own (a return, a loss, a letter's or a later effect's Accounts line, a card's own choice) writes one `worth` entry to the log:
//   { at, kind: 'worth', cause, change, text }
// `at` is the season whose desk first shows the new figure, `cause` is one of CAUSES, `change` the signed dinars, `text` one sentence.
// The ledger reads these (the UI prints `text` under the season it belongs to); nothing here changes money or goods.
import { cityOf } from './state.js';
import { seasonIndex } from './calendar.js';
import { netWealth } from './score.js';

/** A move smaller than this many dinars is rounding and tolls, and gets no line. */
export const NOTE = 10;
export const CAUSES = ['prices', 'trade', 'reset', 'outfit'];

const MINUS = '−';
const signed = n => (n < 0 ? `${MINUS}${-n}` : `+${n}`);

/** The house's worth now, in whole dinars. */
export function worthOf(state, content) {
  const w = netWealth(state, content);
  return Math.round(w.net + (w.onRoad?.total ?? 0));
}

/** Writes the line for a move of worth from `before` to now, if it is NOTE or more. Returns the entry or null. */
export function note(s, content, cause, before, text, { at = seasonIndex(s, content), ...extra } = {}) {
  const change = worthOf(s, content) - before;
  if (Math.abs(change) < NOTE) return null;
  const entry = { at, kind: 'worth', cause, change, text: text(change), ...extra };
  s.log.push(entry);
  return entry;
}

/** The price of each good at home as the house knows it (the figure worth uses), by good. */
export function homePrices(s, content) {
  const home = cityOf(content, 'market').home;
  return Object.fromEntries(Object.entries(s.known?.[home] ?? {}).map(([g, k]) => [g, k.p]));
}

/** The cash-free parts of worth that a change in home prices moves: loads held in the warehouse and loads on the road (the house's share). */
export function heldLoads(s) {
  const road = {};
  for (const x of s.expeditions ?? []) {
    const total = (x.staked?.house ?? 0) + (x.staked?.partners ?? 0);
    const share = (x.staked?.partners ?? 0) > 0 && total > 0 ? x.staked.house / total : 1;
    for (const [g, n] of Object.entries(x.cargo ?? {})) road[g] = (road[g] ?? 0) + n * share;
  }
  return { stock: { ...(s.stock ?? {}) }, road };
}

/** The prices at home moved from `was` to now with these loads held: the lines for the warehouse and for the road, in the words of the
    ledger ("The goods in the warehouse rose in price: +81"). */
export function priceLines(s, content, was, held) {
  const now = homePrices(s, content);
  const sum = loads => Math.round(Object.entries(loads).reduce((n, [g, q]) => n + q * ((now[g] ?? was[g] ?? 0) - (was[g] ?? now[g] ?? 0)), 0));
  const out = [];
  const stock = sum(held.stock), road = sum(held.road);
  if (Math.abs(stock) >= NOTE) out.push({ part: 'warehouse', change: stock, text: `The goods in the warehouse ${stock > 0 ? 'rose' : 'fell'} in price: ${signed(stock)}` });
  if (Math.abs(road) >= NOTE) out.push({ part: 'road', change: road, text: `The goods on the road ${road > 0 ? 'rose' : 'fell'} in price at home: ${signed(road)}` });
  // two parts that are each under NOTE can still move worth by NOTE together: one line for what the house holds, so no move of that size goes unsaid
  if (!out.length && Math.abs(stock + road) >= NOTE) out.push({ part: 'goods', change: stock + road, text: `The goods the house holds ${stock + road > 0 ? 'rose' : 'fell'} in price: ${signed(stock + road)}` });
  return out;
}
export { signed };
