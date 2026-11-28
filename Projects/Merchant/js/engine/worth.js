// What the house is worth, and the lines that say why it moved (MER-146, M4e play problem 7: worth rose by 81, 127, 142 and 104 dinars in four
// seasons of one game and by 368 in another, with no paper, Accounts line or ledger line to say why).
//
// `worthOf` is the figure the top bar shows: cash and the warehouse at the last prices known at home, less what is owed, plus what is out
// on the road at the house's share. Worth moves for a reason the engine can name, and every move of NOTE dinars or more that has no paper of
// its own (a return, a loss, a letter's or a later effect's Accounts line, a card's own choice) writes one `worth` entry to the log:
//   { at, kind: 'worth', cause, change, text }
// `at` is the season whose figure the move is in, `cause` is one of CAUSES, `change` the signed dinars, `text` one sentence.
// The ledger reads these (the UI prints `text` under the season it belongs to); nothing here changes money or goods.
import { cityOf } from './state.js';
import { seasonIndex } from './calendar.js';
import { netWealth, poolWorth } from './score.js';

/** A move smaller than this many dinars is rounding and tolls, and gets no line. */
export const NOTE = 10;
export const CAUSES = ['prices', 'trade', 'reset', 'outfit', 'trip', 'answer', 'letter', 'loss', 'later', 'event', 'wages'];

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

/** A step moved worth by more than its own lines say (MER-148, M4f play problem 8: Summer 1325 showed -61 with -20 explained, Autumn 1335 +194 with +99): the
    part of the move since `before` that the worth lines the step wrote (log entries from index `n0`) do not add up to, as one line, if it is NOTE or more.
    A step writes its exact lines first and calls this last, so no move of NOTE or more has none. */
export function rest(s, content, cause, before, n0, text, extra = {}) {
  const said = s.log.slice(n0).filter(e => e.kind === 'worth').reduce((n, e) => n + e.change, 0);
  const change = worthOf(s, content) - before - said;
  if (Math.abs(change) < NOTE) return null;
  const entry = { at: seasonIndex(s, content), kind: 'worth', cause, change, text: text(change), ...extra };
  s.log.push(entry);
  return entry;
}

/** The loads the house holds now, as `priceLines` wants them: the warehouse's, and each expedition's cargo with the house's share of it (a qirad's partners
    own the rest). */
export function heldLoads(s) {
  const road = [];
  for (const x of s.expeditions ?? []) {
    const total = (x.staked?.house ?? 0) + (x.staked?.partners ?? 0);
    const share = (x.staked?.partners ?? 0) > 0 && total > 0 ? x.staked.house / total : 1;
    road.push({ cargo: { ...(x.cargo ?? {}) }, share });
  }
  return { stock: { ...(s.stock ?? {}) }, road };
}

/** What `held` loads are worth on the home market as it stands in `s`: the warehouse's and the road's, each at what selling them would fetch
    (score.js `loadsWorth`: the run and the broker's cut, not one load's price times the loads). */
export function heldWorth(s, content, held) {
  const pooled = poolWorth(s, content, held.stock, held.road.map(x => x.cargo));
  const sum = values => Object.values(values).reduce((n, v) => n + (v ?? 0), 0);
  return { stock: Math.round(sum(pooled.stock)), road: Math.round(held.road.reduce((n, x, i) => n + sum(pooled.road[i]) * x.share, 0)) };
}

/** What the house holds and what it is worth at the home market as it stands now, taken before a step that may move the prices: the argument of `priceLines`. */
export function holdings(s, content) {
  const held = heldLoads(s);
  return { held, ...heldWorth(s, content, held) };
}

/** The home market moved with these loads held (`was`, from `holdings`): the lines for the warehouse and for the road, in the words of the ledger
    ("The goods in the warehouse rose in price: +81"). Each is the loads' worth now less their worth then, both at what selling them fetches. */
export function priceLines(s, content, was) {
  const now = heldWorth(s, content, was.held);
  const out = [];
  const stock = now.stock - was.stock, road = now.road - was.road;
  if (Math.abs(stock) >= NOTE) out.push({ part: 'warehouse', change: stock, text: `The goods in the warehouse ${stock > 0 ? 'rose' : 'fell'} in price: ${signed(stock)}` });
  if (Math.abs(road) >= NOTE) out.push({ part: 'road', change: road, text: `The goods on the road ${road > 0 ? 'rose' : 'fell'} in price at home: ${signed(road)}` });
  // two parts that are each under NOTE can still move worth by NOTE together: one line for what the house holds, so no move of that size goes unsaid
  if (!out.length && Math.abs(stock + road) >= NOTE) out.push({ part: 'goods', change: stock + road, text: `The goods the house holds ${stock + road > 0 ? 'rose' : 'fell'} in price: ${signed(stock + road)}` });
  return out;
}
export { signed };
