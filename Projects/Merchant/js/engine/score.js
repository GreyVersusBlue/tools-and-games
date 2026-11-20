// The score (ARCHITECTURE 4.10): pure, reads the state and the content, changes nothing.
// Four parts, each with its points and one line of reason in words, then the house's
// multiplier on their sum, then a rank word from the city's `ranks`. The wealth scale and
// the ranks are the city's (city.json `score`); the other rates are the game's, below.
import { REP_GROUPS, cityOf, find } from './state.js';

export const REP_POINTS = 0.5;       // points per step of reputation, summed over the four groups (floor 0)
export const HOME_POINTS = 10;      // per agent who made a trip for the house and is alive and home
export const HOME_TRUST_BONUS = 3;  // more for one whose trust is 2 or 3
export const TRUST_BONUS_AT = 2;
export const NOTEBOOK_POINTS = 1.05; // per entry found

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Points for `net` along a scale of [value, points] pairs: straight between two steps, the
    first step's points at or under its value, the last step's at or over it. */
export function scaled(scale, net) {
  if (!scale.length || net <= scale[0][0]) return scale.length ? scale[0][1] : 0;
  for (let i = 1; i < scale.length; i++) {
    const [x0, y0] = scale[i - 1], [x1, y1] = scale[i];
    if (net <= x1) return y0 + (y1 - y0) * (net - x0) / (x1 - x0);
  }
  return scale[scale.length - 1][1];
}

const fmt = n => Math.round(n).toLocaleString('en-US');   // 2453 -> "2,453"; fixed locale, so no machine's settings change a page

/** What the house holds at the end, in the city's money, with its pieces: cash, plus stock at the last
    known price at home (a good with no known price counts for nothing, and `unpriced` counts its loads),
    less what is owed. `brought` is the part of the cash that recall returns put in at the end (the
    recall log's `brought`), for the page to say. `money`, `stock` (its value), `owed` and `net` stay as
    they were for the bots. */
export function netWealth(state, content) {
  const home = cityOf(content, 'score').home;
  let stock = 0, loads = 0, unpriced = 0;
  const goods = [];
  for (const [g, n] of Object.entries(state.stock ?? {})) {
    if (!(n > 0)) continue;
    const price = state.known?.[home]?.[g]?.p;
    goods.push({ good: g, loads: n, price: price ?? null });
    loads += n;
    if (price === undefined) unpriced += n; else stock += n * price;
  }
  const owed = (state.loans ?? []).reduce((a, l) => a + l.principal, 0);
  const brought = (state.log ?? []).filter(e => e.kind === 'recall')
    .reduce((a, e) => a + (e.results ?? []).reduce((b, r) => b + (r.brought ?? 0), 0), 0);
  return { money: state.money, cash: state.money, stock, stockLoads: loads, unpriced, goods, owed, loans: owed, brought, net: state.money + stock - owed };
}

/** The wealth line in words, every sum with its thousands separator: "The house holds 2,453 dinars:
    1,200 in cash (300 of it a recall brought home), 1,400 in 12 loads of stock at the last prices
    known at home, less 147 owed." Nothing is left out that moves the figure. */
export function wealthReason(w, money) {
  const bits = [`${fmt(w.cash)} in cash${w.brought ? ` (${fmt(w.brought)} of it brought home by a recall)` : ''}`];
  bits.push(w.stockLoads ? `${fmt(w.stock)} in ${plural(w.stockLoads, 'load', 'loads')} of stock at the last prices known at home${w.unpriced ? `, ${plural(w.unpriced, 'load', 'loads')} of it with no known price and counted for nothing` : ''}` : 'no stock');
  return `The house holds ${fmt(w.net)} ${money}: ${bits.join(', ')}, ${w.owed ? `less ${fmt(w.owed)} owed` : 'and owes nothing'}.`;
}

export function score(state, content) {
  const city = cityOf(content, 'score');
  const cfg = city.score ?? {};
  const money = city.currency ?? 'coins';
  const parts = [];

  const w = netWealth(state, content);
  parts.push({
    id: 'wealth', points: Math.round(scaled(cfg.wealthScale ?? [], w.net)),
    reason: wealthReason(w, money),
    data: { cash: w.cash, stock: { value: w.stock, loads: w.stockLoads, goods: w.goods, unpriced: w.unpriced }, loans: w.loans, brought: w.brought, net: w.net },
  });

  const repSum = REP_GROUPS.reduce((a, g) => a + (state.rep?.[g] ?? 0), 0);
  parts.push({
    id: 'reputation', points: Math.max(0, repSum * REP_POINTS),
    reason: repSum > 0 ? `Standing with partners, agents, the court and foreign merchants adds up to ${repSum}.`
      : 'Standing with partners, agents, the court and foreign merchants adds up to nothing.',
  });

  const home = cityOf(content, 'score').home;
  // Only a person who made a trip for the house counts (MER-86): a hire who never left home, whether
  // from the last season or the first, is alive but has done nothing for the house to be glad of.
  const alive = (content.agents ?? []).map(a => state.agents?.[a.id]).filter(r => r?.hired && r.where === home);
  const here = alive.filter(r => (r.trips ?? 0) > 0);
  const stayed = alive.length - here.length;
  const trusted = here.filter(r => r.trust >= TRUST_BONUS_AT).length;
  parts.push({
    id: 'people', points: here.length * HOME_POINTS + trusted * HOME_TRUST_BONUS,
    reason: (here.length
      ? `${plural(here.length, 'agent', 'agents')} made a trip for the house and ${here.length === 1 ? 'is' : 'are'} alive and home${trusted ? `, ${trusted} of them trusted` : ''}.`
      : 'No agent who made a trip for the house is alive and at home.')
      + (stayed ? ` ${plural(stayed, 'other', 'others')} never left ${(content.stops ?? []).find(x => x.id === home)?.name ?? 'home'} and ${stayed === 1 ? 'counts' : 'count'} for nothing.` : ''),
  });

  const pages = (state.notebook ?? []).length;
  parts.push({
    id: 'notebook', points: pages * NOTEBOOK_POINTS,
    reason: pages ? `${plural(pages, 'page', 'pages')} in the notebook.` : 'The notebook is empty.',
  });

  const sum = parts.reduce((a, p) => a + p.points, 0);
  const multiplier = find(content.houses, state.house, 'house').multiplier ?? 1;
  const total = Math.round(sum * multiplier);
  const ranks = [...(cfg.ranks ?? [])].sort((a, b) => a.from - b.from);
  const rank = ranks.reduce((r, k) => (total >= k.from ? k.name : r), ranks[0]?.name ?? '');
  return { parts, sum, multiplier, total, rank };
}
