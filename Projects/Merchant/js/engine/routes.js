// Expeditions, contracts, returns, the act jump and the ending's recall
// (ARCHITECTURE 4.2 returns, 4.3, 4.5, 4.7, 4.9). Every function that takes `s` works on a
// state its caller has already cloned. The public ones (outfit, suggestPlan, checkPlan,
// routeFor, destinations) take a state and return a new one or a plain answer.
//
// Timeline of one expedition, in seasons (a state has `t`, the season being played):
//   sent in season n      it does not move; its first leg starts in n+1 (n+2 if that leg is closed)
//   a leg of L seasons    travels for L seasons, then arrives at the end of the last one
//   arrival               toll paid; at the far end it trades; the next leg starts the season after
//                         if it is open (`opens` names the seasons, `when` a condition), else it waits
//   last leg arrives      status "home"; the next season opens with its return paper
// The closing steps run in this order (turn.js): move (a season passes, waiting costs upkeep),
// risk (each season ridden is rolled), tolls (arrivals: toll, trade, start the next leg).
// Trade is after risk, so a vessel lost on the way does not first sell its cargo.
import { seasonIndex, seasonName, playedSeasons, actOfSeason, year } from './calendar.js';
import { holds } from './conditions.js';
import { applyAll } from './effects.js';
import { cityOf, addPaper, deskFull } from './state.js';
import { next, chance } from './rng.js';
import * as M from './market.js';
import { riskFactor, bargain, legSeasons } from './agents.js';

export const WINTER_GALLEY = 1.5;   // risk times this on a galley leg started in winter (Duggan 2015: risky, not closed)
export const UPKEEP = 4;            // coins a season for an expedition waiting at a stop (an estimate; the bots tune it)
// What happens to an expedition that is lost, and to an agent at home across the act jump: the
// defaults for city.json's `jump` block (ARCHITECTURE 5.1). A loss is rolled the same way on the
// road and at the jump, so the loss shares are one set of numbers, read in both places.
export const DEFAULT_JUMP = {
  retires: 0.1,          // an agent at home retires during the years of the jump
  wholeLoss: 0.4,        // of the losses, the share that take the whole vessel
  survivesWhole: 0.75,   // an agent whose vessel was lost gets home
  partial: [0.25, 0.75], // a partial loss takes this share of each good
};
export const MAX_WAIT = 4;          // seasons a plan may wait at one stop before it is refused
export const DEFAULT_RECALL = {
  reach: { start: 0.95, perSeason: 0.15, floor: 0.1 }, // chance word reaches an agent in time, by seasons from home
  recalledKeeps: 0.6, recalledSurvives: 0.9,
  stayedSurvives: 0.5, byStop: {},                      // an agent who stays; byStop overrides for a stop
  homeSurvives: 0.6,                                     // an agent at home in the home city
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const stopOf = (content, id) => (content.stops ?? []).find(x => x.id === id);
const goodOf = (content, id) => (content.goods ?? []).find(g => g.id === id);
const agentOf = (content, id) => (content.agents ?? []).find(a => a.id === id);
const routeOf = (content, id) => (content.routes ?? []).find(r => r.id === id);
const homeOf = content => cityOf(content, 'expeditions').home;
const cap = w => `${w[0].toUpperCase()}${w.slice(1)}`;
const goodName = (content, id) => (goodOf(content, id)?.name ?? id).toLowerCase();
const stopName = (content, id) => stopOf(content, id)?.name ?? id;
const SEASON_WORDS = { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' };
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const words = n => NUMBER_WORDS[n] ?? String(n);
const plural = (n, one, many) => (n === 1 ? one : many);
const VESSEL = { caravan: 'caravan', galley: 'galley', dhow: 'dhow', nileboat: 'boat', mules: 'mule train' };

/** "20 loads of <good>", "1 chest of <good>". */
function qty(content, good, n) {
  const unit = goodOf(content, good)?.unit ?? 'load';
  return `${n} ${plural(n, unit, `${unit}s`)} of ${goodName(content, good)}`;
}
const cargoText = (content, cargo) => {
  const parts = Object.entries(cargo).filter(([, n]) => n > 0).map(([g, n]) => qty(content, g, n));
  return parts.length ? parts.join(', ') : 'no goods';
};
function coins(content, n) {
  const cur = cityOf(content, 'expeditions').currency ?? 'coins';
  return `${n} ${Math.abs(n) === 1 && cur.endsWith('s') ? cur.slice(0, -1) : cur}`;
}
const addStock = (s, good, n) => { const v = (s.stock[good] ?? 0) + n; if (v > 0) s.stock[good] = v; else delete s.stock[good]; };

// ---------------------------------------------------------------------------------------------
// Routes: the legs, which seasons they are open in, and the timeline of a plan

/** Index of the last leg out: the first leg that reaches the route's far stop. */
export const outEnd = route => route.legs.findIndex(l => l.to === route.to);

/** The season `k` places ahead of the one being played, as { idx, st } where `st` reads like the
    state would in that season; null past the calendar's last season. */
function ahead(s, content, k) {
  const played = playedSeasons(content.calendar, s.length);
  if (s.t + k >= played.length) return null;
  return { idx: played[s.t + k], st: k === 0 ? s : { ...s, t: s.t + k } };
}

/** Can `leg` be started in the season `k` places ahead? `why` is "season", "when" or "end". */
function legOpen(s, content, leg, k) {
  const a = ahead(s, content, k);
  if (!a) return { open: true, idx: undefined };   // past the last season nothing is known, and the ending settles it
  if (!leg.opens.includes(seasonName(a.idx))) return { open: false, why: 'season', idx: a.idx };
  if (leg.when && !holds(leg.when, a.st, content)) return { open: false, why: 'when', idx: a.idx };
  return { open: true, idx: a.idx };
}

const listWords = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);
const legName = (content, leg) => `${stopName(content, leg.from)} to ${stopName(content, leg.to)}`;

/** Where a plan along `route` would be, season by season, if sent now. Legs start at the first
    season they are open; the first may wait one season, a later one up to MAX_WAIT.
    { ok, legs: [{ i, startK, startIdx, waits }], seasons, waits, warnings, why } */
export function project(s, content, route, agent) {
  const warnings = [];
  let k = 1, waits = 0;
  const legs = [];
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const limit = i === 0 ? 1 : MAX_WAIT;
    let w = 0, o = legOpen(s, content, leg, k);
    while (!o.open && w < limit) { w++; k++; o = legOpen(s, content, leg, k); }
    if (!o.open) {
      const how = o.why === 'when' ? 'is not open in these years'
        : `can only start in ${listWords(leg.opens.map(x => SEASON_WORDS[x]))}`;
      return { ok: false, legs, why: `${i === 0 ? 'The first leg' : 'A later leg'}, ${legName(content, leg)}, ${how}.` };
    }
    if (w > 0 && i > 0) {
      warnings.push(`${cap(by(leg))} from ${stopName(content, leg.from)} to ${stopName(content, leg.to)} can only leave in ${listWords(leg.opens.map(x => SEASON_WORDS[x]))}. The expedition will wait in ${stopName(content, leg.from)} for ${words(w)} ${plural(w, 'season', 'seasons')}.`);
    }
    waits += w;
    legs.push({ i, startK: k, startIdx: o.idx, waits: w });
    k += legSeasons(agent, leg);
  }
  // k - 1 seasons from the season after sending to the last arrival, so the return opens k seasons ahead
  return { ok: true, legs, seasons: k, waits, warnings };
}
const by = leg => ({ caravan: 'the caravan', galley: 'the galley', dhow: 'the dhow', nileboat: 'the boat', mules: 'the mules' }[leg.by] ?? 'the boat');

/** The open route to `stopId` that gets there and back soonest, or null. Ties go to the one
    with fewer legs, then the one listed first. */
export function routeFor(state, content, stopId, agent) {
  let best = null;
  for (const r of content.routes ?? []) {
    if (r.to !== stopId) continue;
    const p = project(state, content, r, agent);
    if (!p.ok) continue;
    if (!best || p.seasons < best.seasons || (p.seasons === best.seasons && r.legs.length < best.route.legs.length)) {
      best = { route: r, seasons: p.seasons, waits: p.waits, warnings: p.warnings };
    }
  }
  return best;
}

/** One line per stop the house can send someone to now, each with its best open route. With an
    `agent` the seasons and the waits are that agent's timing (a careful agent is slower on a long leg). */
export function destinations(state, content, agent) {
  const home = homeOf(content);
  const out = [];
  for (const stop of content.stops ?? []) {
    if (stop.id === home) continue;
    const hit = routeFor(state, content, stop.id, agent);
    if (hit) out.push({ stop: stop.id, name: stop.name, route: hit.route.id, seasons: hit.seasons, waits: hit.waits, warnings: hit.warnings });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Money

/** The house pays `amount`. It sells loads from its warehouse at the home price when its money
    falls short, and stops at 0: returns what could not be paid. */
function pay(s, content, amount) {
  if (amount <= 0) return 0;
  s.money -= amount;
  if (s.money >= 0) return 0;
  const home = homeOf(content);
  const price = g => M.sellPrice(s, content, home, g);
  const goods = Object.keys(s.stock).filter(g => s.market[home]?.[g]).sort((a, b) => price(b) - price(a) || (a < b ? -1 : 1));
  for (const g of goods) {
    while (s.stock[g] > 0 && s.money < 0) { s.money += price(g); M.noteSale(s, content, home, g, 1); addStock(s, g, -1); }
  }
  if (s.money >= 0) return 0;
  const short = -s.money;
  s.money = 0;
  return short;
}

/** An expedition pays `amount` from its purse, then in goods (cheapest at home first, each load
    worth its home price). Whatever is still owed when it has nothing left is waived. Returns the
    part paid in goods as { good: loads }. */
function payFromExpedition(s, content, x, amount) {
  const fromPurse = Math.min(x.purse, amount);
  x.purse -= fromPurse;
  let owed = amount - fromPurse;
  const given = {};
  if (owed > 0) {
    const home = homeOf(content);
    const worth = g => M.truePrice(s, content, home, g) ?? stopOf(content, home)?.sells?.[g]?.base ?? 1;
    const goods = Object.keys(x.cargo).sort((a, b) => worth(a) - worth(b) || (a < b ? -1 : 1));
    for (const g of goods) {
      while (x.cargo[g] > 0 && owed > 0) { x.cargo[g]--; given[g] = (given[g] ?? 0) + 1; owed -= worth(g); }
      if (!x.cargo[g]) delete x.cargo[g];
    }
    if (owed < 0) x.purse += -owed;   // the toll-keeper gives change for a load
  }
  return given;
}

// ---------------------------------------------------------------------------------------------
// Risk

/** A leg's chance of going wrong in one season, for this agent, starting in `startIdx`. */
export function legRisk(content, agent, leg, startIdx) {
  const winter = leg.by === 'galley' && startIdx !== undefined && seasonName(startIdx) === 'winter';
  return clamp(leg.risk * riskFactor(agent, leg) * (winter ? WINTER_GALLEY : 1), 0, 0.95);
}

/** The chances of loss and retirement: city.json's `jump` over the defaults. */
export function jumpChances(content) {
  return { ...DEFAULT_JUMP, ...(content.city?.jump ?? {}) };
}

/** A loss happened to `x`. Draws: whole or partial; a whole loss then draws whether the agent
    lives, a partial loss how much goes. Returns what was lost; changes `x` on a partial loss. */
function loseSome(s, content, x) {
  const J = jumpChances(content);
  if (next(s) < J.wholeLoss) {
    const survived = next(s) < J.survivesWhole;
    const cargo = { ...x.cargo }, purse = x.purse;
    x.cargo = {}; x.purse = 0;
    return { whole: true, survived, cargo, purse };
  }
  const f = J.partial[0] + next(s) * (J.partial[1] - J.partial[0]);
  const cargo = {};
  for (const [g, n] of Object.entries(x.cargo)) {
    const lose = Math.min(n, Math.max(1, Math.round(n * f)));
    cargo[g] = lose;
    x.cargo[g] -= lose;
    if (!x.cargo[g]) delete x.cargo[g];
  }
  return { whole: false, survived: true, cargo, purse: 0 };
}

// ---------------------------------------------------------------------------------------------
// Papers

const bumpKnown = (s, stop, good, p, at) => {
  const k = (s.known[stop] ??= {});
  if (!k[good] || k[good].at <= at) k[good] = { p, at };
};

function lostPaper(s, content, x, loss, leg) {
  const agent = agentOf(content, x.agent), route = routeOf(content, x.route);
  const goods = cargoText(content, loss.cargo);
  const parts = [];
  if (Object.keys(loss.cargo).length) parts.push(goods);
  if (loss.purse) parts.push(coins(content, loss.purse));
  const lost = parts.length ? parts.join(' and ') : 'nothing of value';
  const way = `the ${VESSEL[leg.by] ?? 'party'} from ${stopName(content, leg.from)} to ${stopName(content, leg.to)}`;
  const costs = lossCosts(x, loss, content, s);
  const headline = loss.whole
    ? `${agent.name}'s ${VESSEL[leg.by] ?? 'party'} was lost on the way from ${stopName(content, leg.from)} to ${stopName(content, leg.to)}. ${loss.survived ? `${agent.name} survived and is home.` : `${agent.name} did not come back.`}`
    : `Part of ${agent.name}'s cargo was lost on ${way}. ${agent.name} goes on.`;
  const lines = [{ label: 'Lost', text: lost }];
  if (x.contract.kind === 'qirad') {
    lines.push({ label: 'The house', text: `${coins(content, costs.house)} of its money` });
    lines.push({ label: 'The partners', text: `${coins(content, costs.partners)} of theirs` });
  }
  return { kind: 'lost', ref: 'lost', agent: x.agent, expedition: x.id, data: { headline, route: route.id, whole: loss.whole, survived: loss.survived, lines, costs } };
}

/** What a loss costs each party under the contract: the capital bears it in proportion to stake. */
function lossCosts(x, loss, content, s) {
  if (loss.whole) return { house: x.staked.house, partners: x.staked.partners };   // all the capital went
  const home = homeOf(content);
  let value = loss.purse;
  for (const [g, n] of Object.entries(loss.cargo)) value += n * (M.truePrice(s, content, home, g) ?? 0);
  const total = x.staked.house + x.staked.partners;
  const partners = x.contract.kind === 'qirad' && total > 0 ? Math.floor(value * x.staked.partners / total) : 0;
  return { house: value - partners, partners };
}

function put(s, paper) {
  // A return, loss or accounts paper goes on the desk at once; when the desk is full it is not shown
  // and the log says so, because the money and goods have already moved.
  const shown = addPaper(s, paper);
  if (!shown) s.log.push({ at: s.t, kind: 'dropped', ref: paper.kind, reason: 'the desk was full' });
  return shown;
}

// ---------------------------------------------------------------------------------------------
// Outfitting (ARCHITECTURE 4.5)

const isCount = n => Number.isInteger(n) && n >= 0;

/** Checks `plan` against `s` and, when it holds, applies it to `s` (a clone). Returns
    { problems, warnings }; `s` is changed only when there are no problems. */
function build(s, content, plan) {
  const problems = [], warnings = [];
  const city = cityOf(content, 'outfit');
  const home = homeOf(content);
  const homeName = stopName(content, home);
  const no = msg => { problems.push(msg); };

  if (s.phase !== 'desk') no('You can send people out only while the desk is open.');
  if (!plan || typeof plan !== 'object') return { problems: ['There is no plan to send.'], warnings };

  // who goes
  const agent = plan.agent ? agentOf(content, plan.agent) : null;
  const rec = agent && s.agents[agent.id];
  if (!plan.agent) no('Choose who goes.');
  else if (!agent) no(`There is no one called "${plan.agent}" in the house's books.`);
  else if (!rec.hired) no(`${agent.name} does not work for the house.`);
  else if (rec.where === 'road' || s.expeditions.some(x => x.agent === agent.id)) no(`${agent.name} is already on the road.`);
  else if (rec.where !== home) no(`${agent.name} is not in ${homeName}.`);

  // where
  const route = plan.route ? routeOf(content, plan.route) : null;
  let proj = null;
  if (!plan.route) no('Choose where the expedition goes.');
  else if (!route) no(`There is no road called "${plan.route}".`);
  else {
    proj = project(s, content, route, agent);
    if (!proj.ok) no(proj.why);
    else warnings.push(...proj.warnings);
  }
  const dest = route ? stopOf(content, route.to) : null;

  // what they carry
  const cargo = {}, purse = plan.purse ?? 0;
  if (!isCount(purse)) no(`${purse} is not an amount of money to send.`);
  for (const [g, n] of Object.entries(plan.cargo ?? {})) {
    if (!goodOf(content, g)) { no(`There is no good called "${g}".`); continue; }
    if (!isCount(n)) { no(`${n} is not a number of ${goodOf(content, g).unit}s.`); continue; }
    if (n > 0) cargo[g] = n;
  }
  if (!problems.length && !Object.keys(cargo).length && !purse) no(`Send some goods or some ${city.currency ?? 'money'}, or the journey is for nothing.`);

  // the part bought now, at the home price, and what it costs
  const sim = { ...s, market: structuredClone(s.market) };
  let buyCost = 0, stockValue = 0;
  const taken = {};
  for (const [g, n] of Object.entries(cargo)) {
    const have = s.stock[g] ?? 0;
    const fromStock = Math.min(have, n);
    const need = n - fromStock;
    taken[g] = fromStock;
    stockValue += fromStock * (M.truePrice(s, content, home, g) ?? 0);
    if (need > 0) {
      if (!s.market[home]?.[g]) { no(`The house has ${have ? `only ${have}` : 'none'} in the warehouse and ${homeName} does not sell ${goodName(content, g)}.`); continue; }
      for (let i = 0; i < need; i++) { buyCost += M.buyPrice(sim, content, home, g); M.notePurchase(sim, content, home, g, 1); }
    }
  }

  // the contract
  let kind = plan.contract ?? 'own', partners = 0, share = null;
  if (typeof kind === 'object') { partners = kind.partners ?? 0; kind = kind.kind; }
  partners = plan.partners ?? partners;
  if (kind !== 'own' && kind !== 'qirad') no(`There is no contract called "${kind}".`);
  if (kind === 'qirad') {
    share = city.contracts?.qirad?.agentShare;
    if (!share) no(`A qirad is not an option in ${city.name ?? 'this city'}.`);
    else if (!isCount(partners) || partners < 1) no('A qirad needs partners who put in some money. Say how much.');
    else if (partners > purse + buyCost) no(`The partners cannot put in more than the ${coins(content, purse + buyCost)} that goes out in money and bought goods.`);
  } else partners = 0;

  // selling and buying at the far end
  const carried = new Set(Object.keys(cargo));
  const sell = plan.sell ?? (dest ? Object.keys(cargo).filter(g => dest.sells?.[g]) : []);
  const buy = plan.buy ?? [];
  if (dest) {
    for (const g of sell) {
      if (!goodOf(content, g)) no(`There is no good called "${g}".`);
      else if (!carried.has(g)) no(`${agent?.name ?? 'The agent'} is not carrying any ${goodName(content, g)} to sell.`);
      else if (!dest.sells?.[g]) no(`${dest.name} does not trade in ${goodName(content, g)}.`);
    }
    for (const g of buy) {
      if (!goodOf(content, g)) no(`There is no good called "${g}".`);
      else if (!dest.sells?.[g]) no(`${dest.name} has no ${goodName(content, g)} to buy.`);
    }
  }

  // money
  const houseMoney = buyCost + purse - partners;
  if (!problems.length && s.money < houseMoney) no(`The house has ${coins(content, s.money)} and this costs ${coins(content, houseMoney)}.`);
  if (problems.length) return { problems, warnings };

  // apply
  for (const [g, n] of Object.entries(taken)) addStock(s, g, -n);
  s.market = sim.market;
  s.money -= houseMoney;
  const n = (s.seen['#x'] = (s.seen['#x'] ?? 0) + 1);
  const first = proj.legs[0];
  const idx = seasonIndex(s, content);
  const x = {
    id: `x${n}`, agent: agent.id, route: route.id, leg: 0, left: legSeasons(agent, route.legs[0]), waiting: 0, status: first.waits ? 'waiting' : 'out',
    cargo, purse,
    contract: kind === 'qirad' ? { kind, agentShare: share[0], of: share[1] } : { kind },
    staked: { house: stockValue + buyCost + purse - partners, partners },
    orders: [], sent: idx, out: 0, start: first.startIdx,
    plan: { sell: [...sell], buy: [...buy] },
    quote: Object.fromEntries(Object.keys(dest.sells ?? {}).map(g => [g, M.truePrice(s, content, route.to, g)])),
    book: { cargo: { ...cargo }, purse, capital: stockValue + buyCost + purse, sold: [], bought: [], tolls: 0, upkeep: 0, paidInGoods: {}, seen: [] },
  };
  s.expeditions.push(x);
  rec.where = 'road';
  s.log.push({ at: idx, kind: 'outfit', ref: x.id, choice: route.id });
  return { problems, warnings };
}

/** The same check `outfit` makes, without sending: { ok, reasons, warnings }. */
export function checkPlan(state, content, plan) {
  const { problems, warnings } = build(structuredClone(state), content, plan);
  return { ok: problems.length === 0, reasons: problems, warnings };
}

/** Sends an expedition, or throws with every reason the plan was refused, in words. */
export function outfit(state, content, plan) {
  const s = structuredClone(state);
  const { problems } = build(s, content, plan);
  if (problems.length) {
    const err = new Error(`outfit: ${problems.join(' ')}`);
    err.reasons = problems;
    throw err;
  }
  return s;
}

/** A complete, valid plan for the one-press first expedition (DESIGN 4.8): the first free agent
    (one who knows the stop first), the best open route, half of a good the house holds that the
    stop trades, no money sent, the house's own contract. Null when nothing fits. */
export function suggestPlan(state, content, stopId) {
  const home = homeOf(content);
  const stop = stopOf(content, stopId);
  if (!stop || stopId === home) return null;
  const free = (content.agents ?? []).filter(a => {
    const r = state.agents[a.id];
    return r?.hired && r.where === home && !state.expeditions.some(x => x.agent === a.id);
  });
  if (!free.length) return null;
  const agent = free.find(a => a.traits.includes(`knows-${stopId}`)) ?? free[0];
  const hit = routeFor(state, content, stopId, agent);
  if (!hit) return null;
  const homePrice = g => state.known[home]?.[g]?.p ?? M.truePrice(state, content, home, g) ?? 0;
  const there = g => state.known[stopId]?.[g]?.p ?? null;
  const goods = Object.keys(state.stock).filter(g => stop.sells?.[g] && state.stock[g] > 0)
    .sort((a, b) => ((there(b) ?? 0) - homePrice(b)) - ((there(a) ?? 0) - homePrice(a)) || state.stock[b] - state.stock[a] || (a < b ? -1 : 1));
  if (!goods.length) return null;
  const g = goods[0];
  const load = Math.max(1, Math.floor(state.stock[g] / 2));
  // buy back the good that is cheaper there than at home by what the house knows
  const back = Object.keys(stop.sells).filter(b => b !== g && there(b) !== null && state.known[home]?.[b] && there(b) < homePrice(b))
    .sort((a, b) => (homePrice(b) - there(b)) - (homePrice(a) - there(a)) || (a < b ? -1 : 1));
  const plan = { agent: agent.id, route: hit.route.id, cargo: { [g]: load }, purse: 0, contract: 'own', sell: [g], buy: back.slice(0, 1) };
  return build(structuredClone(state), content, plan).problems.length ? null : plan;
}

// ---------------------------------------------------------------------------------------------
// The closing steps

const seasonsHome = (content, x) => {
  const legs = routeOf(content, x.route).legs;
  const agent = agentOf(content, x.agent);
  let n = x.status === 'out' ? x.left : legSeasons(agent, legs[x.leg]);
  for (let i = x.leg + 1; i < legs.length; i++) n += legSeasons(agent, legs[i]);
  return n;
};

/** Fills in what an expedition written before these fields existed (or by hand, in a test) lacks. */
function norm(x) {
  x.status ??= 'out';
  x.out ??= 0;
  x.plan ??= { sell: [], buy: [] };
  x.quote ??= {};
  x.book ??= { cargo: { ...x.cargo }, purse: x.purse ?? 0, capital: (x.staked?.house ?? 0) + (x.staked?.partners ?? 0), sold: [], bought: [], tolls: 0, upkeep: 0, paidInGoods: {}, seen: [] };
  x.contract ??= { kind: 'own' };
  x.staked ??= { house: 0, partners: 0 };
  return x;
}

/** Closing step "move": a season passes for every expedition that was already on its way. A
    leg's seasons count down; one that is waiting pays upkeep and starts when its leg opens. */
export function move(s, content) {
  const idx = seasonIndex(s, content);
  for (const x of s.expeditions) {
    norm(x);
    delete x.rode;
    if (!routeOf(content, x.route) || x.status === 'home' || x.sent === idx) continue;
    x.out += 1;
    if (x.status === 'out') {
      x.left -= 1;
      x.rode = { leg: x.leg, start: x.start };
      continue;
    }
    // waiting
    x.waiting += 1;
    x.book.upkeep += UPKEEP;
    const given = payFromExpedition(s, content, x, UPKEEP);
    for (const [g, q] of Object.entries(given)) x.book.paidInGoods[g] = (x.book.paidInGoods[g] ?? 0) + q;
    startLeg(s, content, x, 1);
  }
}

/** Starts leg x.leg if it is open `k` seasons ahead (the season after this one: k = 1). */
function startLeg(s, content, x, k) {
  const leg = routeOf(content, x.route).legs[x.leg];
  const o = legOpen(s, content, leg, k);
  if (o.open) { x.status = 'out'; x.left = legSeasons(agentOf(content, x.agent), leg); x.start = o.idx; }
  else x.status = 'waiting';
}

/** Closing step "risk": every expedition that rode this season is rolled once. */
export function risk(s, content) {
  const lost = [];
  for (const x of s.expeditions) {
    if (!x.rode || !routeOf(content, x.route)) continue;
    norm(x);
    const leg = routeOf(content, x.route).legs[x.rode.leg];
    const p = legRisk(content, agentOf(content, x.agent), leg, x.rode.start);
    if (next(s) >= p) continue;
    const loss = loseSome(s, content, x);
    x.book.lost = x.book.lost ?? {};
    for (const [g, n] of Object.entries(loss.cargo)) x.book.lost[g] = (x.book.lost[g] ?? 0) + n;
    put(s, lostPaper(s, content, x, loss, leg));
    if (!loss.whole) continue;
    // the vessel is gone: the agent is home or dead, the expedition is over
    const a = s.agents[x.agent];
    a.where = loss.survived ? homeOf(content) : 'dead';
    if (loss.survived && x.contract.kind === 'own') pay(s, content, x.out * (agentOf(content, x.agent).wage ?? 0));
    lost.push(x.id);
    s.log.push({ at: seasonIndex(s, content), kind: 'lost', ref: x.id, choice: loss.survived ? 'survived' : 'died' });
  }
  s.expeditions = s.expeditions.filter(x => !lost.includes(x.id));
}

/** Sells the goods the plan names and buys the ones it names with the money there, at the far
    end, through market.js with glut: each load is priced after the one before it. */
function tradeAtFar(s, content, x, route, idx) {
  const stop = route.to;
  const agent = agentOf(content, x.agent);
  for (const g of x.plan.sell) {
    const q = x.cargo[g] ?? 0;
    if (!q || !s.market[stop]?.[g]) continue;
    bumpSeen(x, stop, g, M.sellPrice(s, content, stop, g), idx);
    let got = 0;
    for (let i = 0; i < q; i++) {
      got += Math.round(M.sellPrice(s, content, stop, g) * bargain(agent, stop, 'sell'));
      M.noteSale(s, content, stop, g, 1);
    }
    delete x.cargo[g];
    x.purse += got;
    x.book.sold.push({ good: g, q, got, stop });
  }
  const goods = x.plan.buy.filter(g => s.market[stop]?.[g]);
  goods.forEach((g, k) => {
    const budget = Math.floor(x.purse / (goods.length - k));
    bumpSeen(x, stop, g, M.buyPrice(s, content, stop, g), idx);
    let spent = 0, q = 0;
    for (;;) {
      const p = Math.max(1, Math.round(M.buyPrice(s, content, stop, g) * bargain(agent, stop, 'buy')));
      if (spent + p > budget) break;
      spent += p; q++;
      M.notePurchase(s, content, stop, g, 1);
    }
    if (q) {
      x.cargo[g] = (x.cargo[g] ?? 0) + q;
      x.purse -= spent;
      x.book.bought.push({ good: g, q, cost: spent, stop });
    }
  });
}
const bumpSeen = (x, stop, good, p, at) => x.book.seen.push({ stop, good, p, at });

/** Closing step "tolls": an expedition that finished a leg pays that leg's toll (from the purse,
    then from the cargo), trades if this is the far end, and starts the next leg or comes home. */
export function tolls(s, content) {
  const idx = seasonIndex(s, content);
  for (const x of s.expeditions) {
    if (!x.rode || !routeOf(content, x.route)) continue;
    norm(x);
    const rode = x.rode;
    delete x.rode;
    if (x.left > 0) continue;
    const route = routeOf(content, x.route);
    const leg = route.legs[rode.leg];
    // at the far end the goods are sold first, so the toll comes out of what they fetched
    if (rode.leg === outEnd(route)) tradeAtFar(s, content, x, route, idx);
    x.book.tolls += leg.toll;
    const given = payFromExpedition(s, content, x, leg.toll);
    for (const [g, q] of Object.entries(given)) x.book.paidInGoods[g] = (x.book.paidInGoods[g] ?? 0) + q;
    if (rode.leg === route.legs.length - 1) { x.status = 'home'; x.leg = route.legs.length; continue; }
    x.leg = rode.leg + 1;
    startLeg(s, content, x, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Coming home, and the contract's split

/** The split of `value` (what came home, in coins) under a contract, in whole numbers that add
    up to `value`: { agent, partners, house }. An own contract gives all of it to the house (the
    agent's wage is a cost the house pays besides). A qirad gives the agent its share of a profit
    and nothing of a loss; what is left is split by stake, and the remainder goes to the house. */
export function split(contract, staked, value) {
  const capital = staked.house + staked.partners;
  if (contract.kind !== 'qirad' || capital <= 0) return { agent: 0, partners: 0, house: value };
  const profit = value - capital;
  const agent = profit > 0 ? Math.floor(profit * contract.agentShare / contract.of) : 0;
  const rest = value - agent;
  // the partners' share of what is left: their stake over the capital (a loss falls on them in proportion)
  const partners = Math.floor(rest * staked.partners / capital);
  return { agent, partners, house: rest - partners };
}

/** An expedition is home: its goods go to the warehouse, its money to the house, the shares are
    paid, the agent is at home. Returns the report the return paper and the interlude both use. */
function bringHome(s, content, x, { elapsed }) {
  const home = homeOf(content);
  const agentRec = s.agents[x.agent], agent = agentOf(content, x.agent), route = routeOf(content, x.route);
  const cargoValue = Object.entries(x.cargo).reduce((v, [g, n]) => v + n * (M.truePrice(s, content, home, g) ?? 0), 0);
  const value = x.purse + cargoValue;
  const shares = split(x.contract, x.staked, value);
  for (const [g, n] of Object.entries(x.cargo)) addStock(s, g, n);
  s.money += x.purse;
  const short = pay(s, content, shares.partners) + pay(s, content, shares.agent);
  const wage = x.contract.kind === 'own' ? x.out * (agent.wage ?? 0) : 0;
  const wageShort = pay(s, content, wage);
  if (short || wageShort) s.rep.partners = clamp(s.rep.partners - 1, -3, 3);
  agentRec.where = home;
  for (const k of x.book.seen) bumpKnown(s, k.stop, k.good, k.p, k.at);
  const houseNet = shares.house - x.staked.house - wage;
  return { x, route, shares, value, cargoValue, wage, houseNet, short: short + wageShort, elapsed, goodsBack: { ...x.cargo }, moneyBack: x.purse };
}

/** The return paper: the headline sentence first (DESIGN 4.6), then the account. */
function returnPaper(s, content, r) {
  const { x, route } = r;
  const agent = agentOf(content, x.agent), dest = stopName(content, route.to), homeName = stopName(content, homeOf(content));
  const n = r.houseNet;
  const headline = `${agent.name} came home from ${dest}. ${n > 0 ? `The house made ${coins(content, n)}.` : n < 0 ? `The house lost ${coins(content, -n)}.` : 'The house came out even.'}`;
  const book = x.book;
  const rows = [];
  rows.push({ label: 'Sent out', text: `${cargoText(content, book.cargo)}${book.purse ? `, ${coins(content, book.purse)} to spend` : ''}`, amount: -book.capital });
  for (const e of book.sold) rows.push({ label: 'Sold', text: `${qty(content, e.good, e.q)} in ${stopName(content, e.stop)}`, amount: e.got });
  for (const e of book.bought) rows.push({ label: 'Bought', text: `${qty(content, e.good, e.q)} in ${stopName(content, e.stop)}`, amount: -e.cost });
  if (book.tolls) rows.push({ label: 'Tolls', text: 'paid on the road', amount: -book.tolls });
  if (book.upkeep) rows.push({ label: 'Waiting', text: `${words(x.waiting)} ${plural(x.waiting, 'season', 'seasons')} at a stop, kept at ${coins(content, UPKEEP)} a season`, amount: -book.upkeep });
  if (book.lost && Object.keys(book.lost).length) rows.push({ label: 'Lost', text: cargoText(content, book.lost) });
  const back = [];
  if (Object.keys(r.goodsBack).length) back.push(`${cargoText(content, r.goodsBack)} (worth ${coins(content, r.cargoValue)} in ${homeName} now)`);
  if (r.moneyBack) back.push(coins(content, r.moneyBack));
  rows.push({ label: 'Back home', text: back.length ? back.join(' and ') : 'nothing' });
  const profit = r.value - book.capital;
  rows.push({ label: 'Profit', text: `${profit >= 0 ? 'about' : 'a loss of about'} ${coins(content, Math.abs(profit))}`, amount: profit });
  if (x.contract.kind === 'qirad') {
    const word = { 1: 'one third', 2: 'two thirds' }[x.contract.agentShare] ?? `${x.contract.agentShare} of ${x.contract.of}`;
    rows.push({ label: `${agent.name}'s share`, text: `a qirad: ${agent.name} keeps ${x.contract.of === 3 ? word : `${x.contract.agentShare} in ${x.contract.of}`} of a profit and bears none of a loss`, amount: -r.shares.agent });
    rows.push({ label: "The partners' share", text: r.shares.partners ? `${coins(content, r.shares.partners)} of the ${coins(content, x.staked.partners)} they put in, with their part of the profit` : 'nothing', amount: -r.shares.partners });
  } else if (r.wage) {
    rows.push({ label: `${agent.name}'s wage`, text: `${coins(content, agent.wage)} a season for ${words(x.out)} ${plural(x.out, 'season', 'seasons')}`, amount: -r.wage });
  }
  if (r.short) rows.push({ label: 'Not paid', text: `the house could not pay ${coins(content, r.short)} of what it owed, and its good name suffers` });
  const seasons = r.elapsed;
  return {
    kind: 'return', ref: 'return', agent: x.agent, expedition: x.id,
    data: {
      headline,
      route: `${homeName} to ${dest} and back, ${words(seasons)} ${plural(seasons, 'season', 'seasons')}`,
      account: rows, houseNet: n, outcome: n > 0 ? 'profit' : n < 0 ? 'loss' : 'even',
      shares: { agent: r.shares.agent, partners: r.shares.partners, house: r.shares.house },
      agentLine: `${agent.name} is home and wants to rest a season.`,
    },
  };
}

/** Opening step "returns": every expedition whose last leg finished comes home and puts a return
    paper on the desk. One the desk has no room for waits at home for the next season. */
export function returns(s, content) {
  const idx = seasonIndex(s, content);
  const back = [];
  for (const x of s.expeditions) {
    if (x.status !== 'home') continue;
    if (deskFull(s)) break;
    const r = bringHome(s, content, x, { elapsed: idx - x.sent });
    put(s, returnPaper(s, content, r));
    back.push(x.id);
    s.log.push({ at: idx, kind: 'return', ref: x.id, choice: r.houseNet >= 0 ? 'profit' : 'loss' });
  }
  s.expeditions = s.expeditions.filter(x => !back.includes(x.id));
}

// ---------------------------------------------------------------------------------------------
// Settling an expedition without playing it out: the act jump and the ending

/** What the expedition would have done from where it is: trade at the far end at the prices of
    that stop when it left (no glut), one roll of each leg's risk left, each toll. Returns "home"
    with the expedition changed, or "lost" (the agent's fate is in `fate`). */
function settle(s, content, x) {
  const route = routeOf(content, x.route), legs = route.legs, agent = agentOf(content, x.agent);
  const far = outEnd(route);
  if (x.leg <= far) {
    for (const g of x.plan.sell) {
      const q = x.cargo[g] ?? 0, p = x.quote[g];
      if (!q || p === undefined || p === null) continue;
      const got = q * Math.round(p * bargain(agent, route.to, 'sell'));
      delete x.cargo[g]; x.purse += got;
      x.book.sold.push({ good: g, q, got, stop: route.to });
    }
    const goods = x.plan.buy.filter(g => x.quote[g]);
    goods.forEach((g, k) => {
      const p = Math.max(1, Math.round(x.quote[g] * bargain(agent, route.to, 'buy')));
      const q = Math.floor(Math.floor(x.purse / (goods.length - k)) / p);
      if (!q) return;
      x.cargo[g] = (x.cargo[g] ?? 0) + q; x.purse -= q * p;
      x.book.bought.push({ good: g, q, cost: q * p, stop: route.to });
    });
  }
  for (let i = x.leg; i < legs.length; i++) {
    const leg = legs[i];
    if (next(s) < legRisk(content, agent, leg, undefined)) {
      const loss = loseSome(s, content, x);
      x.book.lost = x.book.lost ?? {};
      for (const [g, n] of Object.entries(loss.cargo)) x.book.lost[g] = (x.book.lost[g] ?? 0) + n;
      if (loss.whole) return { result: 'lost', loss, leg };
    }
    x.book.tolls += leg.toll;
    payFromExpedition(s, content, x, leg.toll);
  }
  x.status = 'home'; x.leg = legs.length;
  return { result: 'home' };
}

/** One line for an expedition settled off stage (the interlude page, the ending). */
function settledLine(s, content, x, out, r) {
  const agent = agentOf(content, x.agent), dest = stopName(content, routeOf(content, x.route).to);
  if (out.result === 'lost') {
    const surv = out.fate === 'died' ? `${agent.name} did not come back.` : `${agent.name} got home.`;
    return { expedition: x.id, agent: x.agent, result: 'lost', text: `${agent.name}'s expedition to ${dest} was lost on the way. ${surv}`, houseNet: -x.staked.house };
  }
  const n = r.houseNet;
  return { expedition: x.id, agent: x.agent, result: 'home', text: `${agent.name} came home from ${dest}. ${n > 0 ? `The house made ${coins(content, n)}.` : n < 0 ? `The house lost ${coins(content, -n)}.` : 'The house came out even.'}`, houseNet: n };
}

/** Settles `x` (settle, then bring it home or write it off). Returns its line. */
function settleAndClose(s, content, x, elapsed) {
  const out = settle(s, content, x);
  if (out.result === 'lost') {
    out.fate = out.loss.survived ? 'survived' : 'died';
    s.agents[x.agent].where = out.loss.survived ? homeOf(content) : 'dead';
    if (out.loss.survived && x.contract.kind === 'own') pay(s, content, x.out * (agentOf(content, x.agent).wage ?? 0));
    return settledLine(s, content, x, out);
  }
  const r = bringHome(s, content, x, { elapsed });
  return settledLine(s, content, x, out, r);
}

// ---------------------------------------------------------------------------------------------
// The act jump (ARCHITECTURE 4.7)

/** Closing step "jump": the years between acts. Called after `t` has advanced to the first
    season of the next act. Writes one log entry, kind "jump", which the interlude page reads
    (view().interlude). */
export function jump(s, content) {
  const played = playedSeasons(content.calendar, s.length);
  const to = played[s.t], from = played[s.t - 1];
  const years = Math.max(1, Math.round((to - from) / 4));
  const entry = { at: to, kind: 'jump', from, to, years, settled: [], loans: [], agents: [], events: [] };

  // 1. every expedition on the road is settled
  for (const x of s.expeditions) entry.settled.push(norm(x) && settleAndClose(s, content, x, Math.max(1, x.out)));
  s.expeditions = [];

  // 2. loans fall due, with interest for the years passed
  const due = s.loans.filter(l => l.due <= to);
  for (const l of due) {
    const owed = Math.round(l.principal * (1 + (l.rate ?? 0) * years));
    const short = pay(s, content, owed);
    if (short) s.rep.partners = clamp(s.rep.partners - 1, -3, 3);
    entry.loans.push({ id: l.id, from: l.from, owed, short });
  }
  s.loans = s.loans.filter(l => l.due > to);

  // 3. agents: trust halves toward 0; one at -2 or lower leaves; some retire
  for (const a of content.agents ?? []) {
    const r = s.agents[a.id];
    if (!r || !r.hired || r.where === 'dead' || r.where === 'gone') continue;
    if (r.trust <= -2) { r.hired = false; r.where = 'gone'; entry.agents.push({ id: a.id, left: 'trust' }); continue; }
    r.trust = Math.trunc(r.trust / 2);
    if (chance(s, jumpChances(content).retires)) { r.hired = false; r.where = 'gone'; entry.agents.push({ id: a.id, left: 'retired' }); }
  }

  // 4. markets reset to the new act's base prices, with no glut
  for (const [stop, byGood] of Object.entries(s.market)) for (const g of Object.keys(byGood)) byGood[g] = { f: 1.0, glut: 0 };

  // 5. the events of this gap, in the order of their seasons
  const a = actOfSeason(content.calendar, s.length, from), b = actOfSeason(content.calendar, s.length, to);
  const evs = (content.events ?? []).filter(e => e.between && e.between[0] === a && e.between[1] === b).sort((p, q) => p.at - q.at);
  for (const ev of evs) {
    if (s.seen[`event:${ev.id}`]) continue;
    s.seen[`event:${ev.id}`] = 1;
    applyAll(s, content, ev.do, { at: ev.at });
    entry.events.push({ id: ev.id, at: ev.at, ...(ev.interlude ? { interlude: ev.interlude } : {}) });
  }
  s.log.push(entry);
  s.phase = 'interlude';
}

/** What the page between acts shows, read from the last jump: the span, each settled expedition,
    the loans repaid, the agents who left and the paragraphs of the events. Null if none. */
export function interludeOf(state, content) {
  const e = [...state.log].reverse().find(x => x.kind === 'jump');
  if (!e) return null;
  return {
    from: year(content.calendar, e.from), to: year(content.calendar, e.to), years: e.years,
    settled: e.settled, loans: e.loans, agents: e.agents,
    paragraphs: e.events.filter(x => x.interlude).map(x => ({ id: x.id, text: x.interlude })),
  };
}

// ---------------------------------------------------------------------------------------------
// The accounts paper (DECISIONS 2026-11-17 on MER-35)

const sign = n => (n > 0 ? `+${n}` : `${n}`);

/** What a fired later effect did that the player can see, as short phrases; [] if nothing. */
function changesOf(content, q, s) {
  const out = [];
  const nameOf = id => agentOf(content, id === '$agent' ? q.agent : id)?.name ?? id;
  for (const e of q.do ?? []) {
    if ('money' in e) out.push(`${sign(e.money)} ${cityOf(content, 'accounts').currency ?? 'coins'}`);
    else if ('stock' in e) out.push(`${sign(e.by)} ${goodName(content, e.stock)}`);
    else if ('rep' in e) out.push(`good name with ${e.rep} ${sign(e.by)}`);
    else if ('trust' in e) out.push(`${nameOf(e.trust)}'s trust ${sign(e.by)}`);
    else if ('loan' in e) out.push(`a loan of ${e.loan.principal} from ${e.loan.from}`);
    else if ('hire' in e) out.push(`${nameOf(e.hire)} joins the house`);
    else if ('dismiss' in e) out.push(`${nameOf(e.dismiss)} leaves the house`);
  }
  return out;
}

/** One item for the accounts paper from a later effect that fired with no follow-up card. */
export function accountItem(s, content, q) {
  const [cardId, choiceId] = String(q.from ?? '').split('/');
  const card = (content.cards ?? []).find(c => c.id === cardId);
  const choice = card?.choices?.find(c => c.id === choiceId);
  const changes = changesOf(content, q, s);
  if (!changes.length) return null;
  const from = card ? `${card.title}${choice ? `, "${choice.label}"` : ''}` : (q.from ?? 'an earlier choice');
  return { from: q.from ?? null, card: card?.title ?? null, choice: choice?.label ?? null, changes, text: `From ${from}: ${changes.join(', ')}` };
}

/** Puts one folded Accounts paper on the desk naming every item (a count, not a paper each). */
export function foldAccounts(s, content, items) {
  if (!items.length) return;
  const idx = seasonIndex(s, content);
  s.log.push({ at: idx, kind: 'accounts', items: items.map(i => i.text) });
  put(s, { kind: 'accounts', ref: 'accounts', items });
}

// ---------------------------------------------------------------------------------------------
// The ending (ARCHITECTURE 4.9)

/** The chances of the ending: city.json's `recall` over the defaults. */
export function recallChances(content) {
  const r = content.city?.recall ?? {};
  return { ...DEFAULT_RECALL, ...r, reach: { ...DEFAULT_RECALL.reach, ...(r.reach ?? {}) }, byStop: { ...DEFAULT_RECALL.byStop, ...(r.byStop ?? {}) } };
}

/** The ending's last choice. `decisions` maps an expedition id to "recall" or "stay" (missing means
    stay). Each expedition is rolled in turn, then each agent at home. One line each in the log. */
export function recall(s, content, decisions = {}) {
  const cfg = recallChances(content);
  const idx = seasonIndex(s, content);
  const home = homeOf(content);
  const results = [];
  const settled = new Set();
  for (const x of s.expeditions) {
    settled.add(x.agent);
    const agent = agentOf(content, x.agent), route = routeOf(content, x.route);
    const lag = x.status === 'home' ? 0 : seasonsHome(content, x);
    const reach = clamp(cfg.reach.start - cfg.reach.perSeason * lag, cfg.reach.floor, 1);
    const word = next(s) < reach;                // one draw whatever was decided, so draws do not shift
    const leg = route.legs[Math.min(x.leg, route.legs.length - 1)];
    const place = x.status === 'out' ? leg.to : leg.from;
    const called = decisions[x.id] === 'recall' && word;
    let line;
    if (called) {
      const lives = next(s) < cfg.recalledSurvives;
      for (const g of Object.keys(x.cargo)) { x.cargo[g] = Math.floor(x.cargo[g] * cfg.recalledKeeps); if (!x.cargo[g]) delete x.cargo[g]; }
      if (lives) {
        const r = bringHome(s, content, x, { elapsed: idx - x.sent });
        line = { expedition: x.id, agent: x.agent, how: 'recalled', survived: true, text: `${agent.name} got word and came home with part of the cargo.`, houseNet: r.houseNet };
      } else {
        s.agents[x.agent].where = 'dead';
        line = { expedition: x.id, agent: x.agent, how: 'recalled', survived: false, text: `${agent.name} set out for home and did not arrive.`, houseNet: -x.staked.house };
      }
    } else {
      const lives = next(s) < (cfg.byStop[place] ?? cfg.stayedSurvives);
      const how = decisions[x.id] === 'recall' ? 'no word' : 'stayed';
      if (lives) {
        const out = settleAndClose(s, content, x, idx - x.sent);
        line = { expedition: x.id, agent: x.agent, how, survived: out.result === 'home' || out.fate === 'survived', text: out.text, houseNet: out.houseNet };
      } else {
        s.agents[x.agent].where = 'dead';
        line = { expedition: x.id, agent: x.agent, how, survived: false, text: `${agent.name} stayed in ${stopName(content, place)} and did not come back.`, houseNet: -x.staked.house };
      }
    }
    results.push(line);
  }
  s.expeditions = [];
  for (const a of content.agents ?? []) {
    const r = s.agents[a.id];
    if (!r?.hired || r.where !== home || settled.has(a.id)) continue;   // one who came home from the road above has had their roll
    const lives = next(s) < cfg.homeSurvives;
    if (!lives) r.where = 'dead';
    results.push({ agent: a.id, how: 'home', survived: lives, text: lives ? `${a.name} was in ${stopName(content, home)} and lived.` : `${a.name} was in ${stopName(content, home)} and died of the plague.` });
  }
  s.log.push({ at: idx, kind: 'recall', results });
  s.phase = 'ended';
}
