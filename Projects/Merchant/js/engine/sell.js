// Selling the warehouse at home (MER-139, M4d play problem 1: 100 loads of copper worth 3,000 sat in the warehouse beside 33 dinars,
// and the only way goods ever left it was a broker's card).
//
// `sellHomeQuote(state, content, good, loads)` is the price line the UI's Sell button reads; `sellHome` does it. The house sells at
// the home stop's price less a broker's cut, load by load, each load priced after the one before it as market.js prices any sale
// (so selling 100 at once fetches less a load than selling 10), and the home market is marked by it (noteSale).
//
// The cut is 15 in every hundred, taken off each load's price and rounded per load. The broker cards in the game ask 5 to 30 in
// every hundred less than the usual price (letters.js BROKER_MIN and BROKER_MAX) for a quick sale of one good; a house that sells
// when it chooses, in the open market, should pay less than the hurried middle of that band and more than nothing, so 15 sits in
// the lower half: goods are worth keeping for a trip, and money from the warehouse is still never a free coin.
import { seasonIndex } from './calendar.js';
import { cityOf, addPaper } from './state.js';
import * as M from './market.js';

export const BROKER_CUT = 0.15;

const MINUS = '−';
const commas = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const goodOf = (content, id) => (content.goods ?? []).find(g => g.id === id);
const nameOf = (content, id) => (goodOf(content, id)?.name ?? id).toLowerCase();
const coins = (content, n) => {
  const cur = cityOf(content, 'selling').currency ?? 'coins';
  return `${commas(n)} ${Math.abs(n) === 1 && cur.endsWith('s') ? cur.slice(0, -1) : cur}`;
};
const loadsOf = (content, good, n) => {
  const unit = goodOf(content, good)?.unit ?? 'load';
  return `${n} ${n === 1 ? unit : `${unit}s`} of ${nameOf(content, good)}`;
};

/** What selling `loads` of `good` at home would do, on the state as it is now: { ok, reason, good, loads, gross, cut, got, average,
    first, last, after } where `gross` is what the market would pay, `cut` the broker's part, `got` what the house keeps, `average`
    the dinars a load that fetches, `first` and `last` the first and last load's price to the house, and `after` the market price
    once they are sold. When it cannot be done, `ok` is false and `reason` says why in a sentence; nothing else is promised. */
export function sellHomeQuote(state, content, good, loads) {
  const no = reason => ({ ok: false, reason, good, loads });
  const home = cityOf(content, 'selling').home;
  if (!['desk', 'interlude'].includes(state.phase)) return no('The house cannot sell from the warehouse now.');
  if (!Number.isInteger(loads) || loads < 1) return no('Say how many loads to sell, at least one.');
  const held = state.stock?.[good] ?? 0;
  if (!goodOf(content, good)) return no(`The house does not deal in "${good}".`);
  if (held < 1) return no(`The house has no ${nameOf(content, good)} in the warehouse.`);
  if (!state.market?.[home]?.[good]) return no(`${home[0].toUpperCase()}${home.slice(1)} does not buy ${nameOf(content, good)}.`);
  if (loads > held) return no(`The house has only ${loadsOf(content, good, held)} in the warehouse.`);
  const m = structuredClone(state);   // priced on a copy, load by load: the price falls as the house sells
  let gross = 0, got = 0, first = null, last = null;
  for (let i = 0; i < loads; i++) {
    const price = M.sellPrice(m, content, home, good);
    const net = Math.max(1, Math.round(price * (1 - BROKER_CUT)));
    gross += price; got += net;
    if (first === null) first = net;
    last = net;
    M.noteSale(m, content, home, good, 1);
  }
  return { ok: true, reason: null, good, loads, gross, cut: gross - got, got, average: Math.round((got / loads) * 10) / 10, first, last, after: M.sellPrice(m, content, home, good) };
}

/** The house sells `loads` of `good` from the warehouse at home. Returns a new state, as every engine action does; throws the
    quote's reason when it cannot be done. Money in, stock out, the home market marked by the sale, a `sale` entry in the log (the
    ledger reads it) and a line on the Accounts paper: on the paper already on the desk, else on a new one with room for it. */
export function sellHome(state, content, good, loads) {
  const q = sellHomeQuote(state, content, good, loads);
  if (!q.ok) throw new Error(`sellHome: ${q.reason}`);
  const s = structuredClone(state);
  const home = cityOf(content, 'selling').home, idx = seasonIndex(s, content);
  for (let i = 0; i < loads; i++) M.noteSale(s, content, home, good, 1);
  s.money += q.got;
  const left = s.stock[good] - loads;
  if (left > 0) s.stock[good] = left; else delete s.stock[good];
  const text = `Sold ${loadsOf(content, good, loads)} in the warehouse for ${coins(content, q.got)}, after the broker's cut of ${coins(content, q.cut)}.`;
  s.log.push({ at: idx, kind: 'sale', good, loads, got: q.got, cut: q.cut });
  const item = {
    from: 'warehouse/sell', card: 'The warehouse', choice: `Sell ${loadsOf(content, good, loads)}`,
    changes: [`+${commas(q.got)} ${cityOf(content, 'selling').currency ?? 'coins'}`, `${MINUS}${loads} ${nameOf(content, good)}`], text,
  };
  const open = s.desk.find(p => p.kind === 'accounts');
  if (open) open.items.push(item);
  else if (s.phase === 'desk' && addPaper(s, { kind: 'accounts', ref: 'accounts', items: [item], state: 'done' })) {
    const k = s.desk.length - 1;
    s.desk[k].id = `p${s.t}-${k}`;
  }
  return s;
}
