// The score (ARCHITECTURE 4.10): pure, reads the state and the content, changes nothing.
// Four parts, each with its points and one line of reason in words, then the house's
// multiplier on their sum, then a rank word from the city's `ranks`. The wealth scale and
// the ranks are the city's (city.json `score`); the other rates are the game's, below.
import { REP_GROUPS, cityOf, find } from './state.js';
import * as M from './market.js';

export const REP_GROUP_POINTS = 2;   // most a group of reputation earns; counted from the middle (DESIGN 2.2 rule 6)
export const HOME_POINTS = 10;      // per agent who made a trip for the house and is alive and home
export const HOME_TRUST_BONUS = 3;  // more for one whose trust is 2 or 3
export const TRUST_BONUS_AT = 2;
export const NOTEBOOK_POINTS = 1.05; // per entry opened and read, not per entry found

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

/** What `loads` loads of `good` are worth to the house at home now: what selling them in the warehouse would fetch, the broker's cut off every load and each
    load priced after the one before it (market.js `houseSale`, the run the Sell button makes), not the price of one load times the loads (MER-148, M4f play
    problem 1: 43 loads of copper counted 375 and fetched 580 less than that). A good the home market does not trade has no such price: the last known
    price at home is the old flat count, and a good with neither is null. */
export function loadsWorth(state, content, good, loads, ahead = 0) {
  const home = cityOf(content, 'score').home;
  if (state.market?.[home]?.[good]) return M.houseSale(state, content, home, good, loads, ahead).got;
  const price = state.known?.[home]?.[good]?.p;
  return price === undefined ? null : loads * price;
}

/** What every load the house holds is worth, the warehouse's and each expedition's cargo (`cargos`, a list of { good: loads }), with the loads of one good
    sold one after another in a single run: the warehouse's first, then each cargo in the list's order, each behind the loads before it. { stock: { good: value }, road: [
    { good: value } ] }, a value null where the good has no price at home. One run, not one for each place the loads sit, so that moving three loads from
    the warehouse onto the road, or a trip's goods into the warehouse, moves nothing: the sum is the same run cut in other places (MER-148). */
export function poolWorth(state, content, stock, cargos) {
  const out = { stock: {}, road: cargos.map(() => ({})) };
  for (const g of new Set([...Object.keys(stock), ...cargos.flatMap(c => Object.keys(c))])) {
    let ahead = 0;
    const take = n => { const v = loadsWorth(state, content, g, n, ahead); ahead += n; return v; };
    if (stock[g] > 0) out.stock[g] = take(stock[g]);
    cargos.forEach((c, i) => { if (c[g] > 0) out.road[i][g] = take(c[g]); });
  }
  return out;
}

/** What the house holds at the end, in the city's money, with its pieces: cash, plus stock at what selling it
    at home would fetch now (`loadsWorth`; a good with no price counts for nothing, and `unpriced` counts its loads),
    less what is owed. `brought` is the part of the cash that recall returns put in at the end (the
    recall log's `brought`), for the page to say. `money`, `stock` (its value), `owed` and `net` stay as
    they were for the bots. */
export function netWealth(state, content) {
  const home = cityOf(content, 'score').home;
  let stock = 0, loads = 0, unpriced = 0;
  const goods = [];
  const exps = state.expeditions ?? [];
  const pooled = poolWorth(state, content, state.stock ?? {}, exps.map(x => x.cargo ?? {}));
  for (const [g, n] of Object.entries(state.stock ?? {})) {
    if (!(n > 0)) continue;
    const price = state.known?.[home]?.[g]?.p;
    const value = pooled.stock[g];
    goods.push({ good: g, loads: n, price: price ?? null, value });
    loads += n;
    if (value === null) unpriced += n; else stock += value;
  }
  // On the road (MER-113, MER-113b): what every expedition still out carries, valued the same way, and the money sent
  // with it, counted at the house's share only. A qirad's partners put in part of the purse and of the goods, and the house
  // paid only the rest (routes.js: purse - partners), so each sum is scaled by house / (house + partners); with no partners
  // the share is the whole. `loads` and `unpriced` stay whole counts of what is aboard. The bar adds this to `net`; `net`
  // and the score do not, so a venture sent costs nothing on the bar.
  const road = { loads: 0, value: 0, unpriced: 0, money: 0, goods: [] };
  for (const [k, x] of exps.entries()) {
    const house = x.staked?.house ?? 0, partners = x.staked?.partners ?? 0;
    const share = partners > 0 && house + partners > 0 ? house / (house + partners) : 1;
    road.money += (x.purse ?? 0) * share;
    for (const [g, n] of Object.entries(x.cargo ?? {})) {
      if (!(n > 0)) continue;
      const price = state.known?.[home]?.[g]?.p;
      const value = pooled.road[k][g];
      const row = road.goods.find(r => r.good === g);
      if (row) row.loads += n; else road.goods.push({ good: g, loads: n, price: price ?? null });
      road.loads += n;
      if (value === null) road.unpriced += n; else road.value += value * share;
    }
  }
  road.money = Math.round(road.money); road.value = Math.round(road.value);
  const onRoad = { ...road, total: road.value + road.money };
  const owed = (state.loans ?? []).reduce((a, l) => a + l.principal, 0);
  const brought = (state.log ?? []).filter(e => e.kind === 'recall')
    .reduce((a, e) => a + (e.results ?? []).reduce((b, r) => b + (r.brought ?? 0), 0), 0);
  return { money: state.money, cash: state.money, stock, stockLoads: loads, unpriced, goods, owed, loans: owed, brought, onRoad, net: state.money + stock - owed };
}

/** The wealth line in words, every sum with its thousands separator: "The house holds 2,453 dinars:
    1,200 in cash (300 of it a recall brought home), 1,400 in 12 loads of stock at the last prices
    known at home, less 147 owed." Nothing is left out that moves the figure. */
export function wealthReason(w, money) {
  const bits = [`${fmt(w.cash)} in cash${w.brought ? ` (${fmt(w.brought)} of it brought home by a recall)` : ''}`];
  bits.push(w.stockLoads ? `${fmt(w.stock)} in ${plural(w.stockLoads, 'load', 'loads')} of stock at what selling it at home would fetch now${w.unpriced ? `, ${plural(w.unpriced, 'load', 'loads')} of it with no known price and counted for nothing` : ''}` : 'no stock');
  // What is out with the agents: loads (priced and not) and money, said wherever there is any, so a money-only trip and
  // an unpriced load are named too (MER-113b). The bar shows this figure, so the line says what the figure holds.
  const out = w.onRoad ?? {};
  const outBits = [];
  if (out.loads) outBits.push(`${plural(out.loads, 'load', 'loads')} of goods${out.value ? ` worth ${fmt(out.value)} at what selling them at home would fetch` : ''}${out.unpriced ? `${out.value ? ', with ' : ', '}${plural(out.unpriced, 'load', 'loads')} of it with no known price and counted for nothing` : ''}`);
  if (out.money) outBits.push(`${fmt(out.money)} in money sent to buy with`);
  const road = outBits.length ? ` On the road, and counted on the top bar but not here: ${outBits.join(' and ')}, the house's share only.` : '';
  return `The house holds ${fmt(w.net)} ${money}: ${bits.join(', ')}, ${w.owed ? `less ${fmt(w.owed)} owed` : 'and owes nothing'}.${road}`;
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

  // Reputation counts from the middle: a group at 0 earns half of REP_GROUP_POINTS, at -3 none, at +3 all,
  // so a house that annoyed its partners scores under one that never met them (DESIGN 2.2 rule 6).
  const repOf = g => Math.min(3, Math.max(-3, state.rep?.[g] ?? 0));
  const repSum = REP_GROUPS.reduce((a, g) => a + repOf(g), 0);
  const repPoints = REP_GROUPS.reduce((a, g) => a + REP_GROUP_POINTS * (repOf(g) + 3) / 6, 0);
  parts.push({
    id: 'reputation', points: repPoints,
    reason: repSum > 0 ? `Standing with partners, agents, the court and foreign merchants adds up to ${repSum} above the middle.`
      : repSum < 0 ? `Standing with partners, agents, the court and foreign merchants adds up to ${-repSum} below the middle.`
      : 'Standing with partners, agents, the court and foreign merchants sits at the middle.',
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

  // Only a page that was found and then opened counts; an old save has no read list and reads as none.
  const found = new Set(state.notebook ?? []);
  const pages = new Set((state.notebookRead ?? []).filter(id => found.has(id))).size;
  parts.push({
    id: 'notebook', points: pages * NOTEBOOK_POINTS,
    reason: pages ? `${plural(pages, 'page', 'pages')} in the notebook opened and read.` : 'No page of the notebook was opened and read.',
  });

  const sum = parts.reduce((a, p) => a + p.points, 0);
  const multiplier = find(content.houses, state.house, 'house').multiplier ?? 1;
  const total = Math.round(sum * multiplier);
  const ranks = [...(cfg.ranks ?? [])].sort((a, b) => a.from - b.from);
  const rank = ranks.reduce((r, k) => (total >= k.from ? k.name : r), ranks[0]?.name ?? '');
  return { parts, sum, multiplier, total, rank };
}
