// season.mjs — one seeded season, played by a bot, for the suites that ask
// what a rule costs over ninety-eight nights rather than over one.
//
// The modules are handed in rather than imported so the same bot can play a
// build that is not this one: the supply house (#905) was measured by running
// this against the tree before it and the tree after it, on the same seeds.
// Not a suite: CI runs test/*.mjs and this is one folder down.

/** mulberry32 over its own state, so a run owns its draws. */
export function seeded(seed, step) {
  let s = seed >>> 0;
  return () => { const r = step(s); s = r.state; return r.value; };
}

/** Servings wanted on the shelf at open, per body the forecast expects. */
export const PAR_PER_HEAD = { wings: 0.25, burger: 0.25, nachos: 0.25, fries: 0.25, beer: 1.3, soda: 0.4 };
const FOOD_IDS = ["wings", "burger", "nachos", "fries"];

/** One night under instant service: every ticket is carried the moment it is
 *  ready, two rounds a head, nobody walks unless the shelf is bare. */
function playNight(e) {
  const live = new Map();
  let pid = 0;
  const place = id => {
    const item = e.chooseOrder(live.get(id).round);
    const tk = item ? e.placeTicket(id, item) : null;
    if (!tk) { live.delete(id); e.walkout(id); e.depart(); }
  };
  for (let t = 0; t < 45 * 8 + 5 && !e.done; t += 0.5) {
    for (const ev of e.update(0.5)) {
      if (ev.type === "spawn") { live.set(++pid, { round: 0 }); place(pid); }
      if (ev.type === "ready") {
        const tk = ev.ticket;
        e.claim(tk.id, "server"); e.deliver(tk.id, false);
        const p = live.get(tk.patronId);
        if (p && p.round === 0) { p.round = 1; place(tk.patronId); }
        else { live.delete(tk.patronId); e.depart(); }
      }
    }
  }
  return e.summary();
}

/**
 * Play `nights` nights. `mods` is { C, NightEngine, seed, mulberry32 } from
 * the build under test. `opts.house` signs with a supply house on day one if
 * the build has them; `opts.venue` starts on that rung; `opts.cash` is the
 * opening till. `opts.rota` posts the rota on day one if the build has one
 * (#908) and is then called every morning with the campaign and the build's
 * campaign.js, to hire or to set nights off. Returns the campaign and one row
 * a night; a night under a rota also carries `wages` and `crew`, which a row
 * from a build or a campaign without one does not, so the rows the pins were
 * taken over are unchanged. `opts.dates` dates the shelf on day one if the
 * build can (#909), and `opts.walkin` installs the walk-in with it; `opts.par`
 * multiplies the bot's par for food, for a bot that overbuys. A night on a
 * dated shelf carries `lost`, the servings that went by item.
 */
export function runSeason(mods, { seed = 1, nights = 98, house = null, venue = null, cash = null, rota = null, dates = false, walkin = false, par = 1 } = {}) {
  const { C, NightEngine, seed: seedEngine, mulberry32 } = mods;
  const real = Math.random;
  Math.random = seeded(seed ^ 0x9e3779b9, mulberry32);
  const rows = [];
  let c;
  try {
    c = C.newCampaign();
    if (venue) C.devWarpVenue(c, venue);
    if (cash !== null) c.cash = cash;
    if (house && C.signHouse) C.signHouse(c, house);
    if (rota && C.postRota) C.postRota(c);
    if (dates && C.dateShelf) { C.dateShelf(c); if (walkin) C.buyWalkin(c); }
    for (let n = 0; n < nights && !c.failed; n++) {
      const rand = seeded((seed * 7919 + n) >>> 0, mulberry32);
      const day = c.day;
      if (rota && C.postRota) rota(c, C);
      if (c.darkNightsLeft > 0) { const b = C.settleDarkNight(c, rand); rows.push({ day, dark: true, net: b.net, account: b.account || 0, cash: c.cash }); continue; }
      const heads = C.forecast(c);
      const order = {};
      for (const id in PAR_PER_HEAD) order[id] = Math.max(0, Math.ceil(heads * PAR_PER_HEAD[id] * (par !== 1 && FOOD_IDS.includes(id) ? par : 1)) - (c.stock[id] || 0));
      const list = C.orderCost(order);
      const before = c.cash;
      const placed = C.placeOrder(c, order);
      const paid = Math.round((before - c.cash) * 100) / 100;
      seedEngine((seed * 104729 + n) >>> 0);
      const e = new NightEngine({
        crowdTarget: heads, gameNight: C.isGameNight(c), winProb: C.mulesWinProb(c), hourLenSec: 45,
        seats: C.venueDef(c).seats, stock: c.stock, promo: C.promoDef(c).id,
        foodMult: C.roleMult(c, "cook"), drinkMult: C.roleMult(c, "bartender"), beerMult: C.beerMult(c),
        plateMult: C.plateMult ? C.plateMult(c) : 1, regulars: C.regularsIn(c),
      });
      const s = playNight(e);
      const b = C.settleNight(c, s, rand);
      rows.push({ day, dark: false, order, ordered: !!placed.ok, list: placed.ok ? list : 0, paid, drop: placed.drop || 0,
        take: b.take, revenue: s.revenue, tips: s.tips, served: s.served, net: b.net, account: b.account || 0,
        spoiled: b.spoilage.value, cash: c.cash, evicted: !!b.lease.evicted,
        ...(b.crew && b.crew.rota ? { wages: b.wages, crew: b.crew } : {}),
        ...(b.spoilage.dated ? { lost: b.spoilage.byItem } : {}) });
    }
  } finally { Math.random = real; seedEngine(0); }
  return { c, rows };
}

/** A season in a handful of totals. */
export function totals(run) {
  const sum = k => Math.round(run.rows.reduce((a, r) => a + (r[k] || 0), 0) * 100) / 100;
  return { nights: run.rows.length, cash: run.c.cash, list: sum("list"), paid: sum("paid"), drop: sum("drop"), account: sum("account"),
    take: sum("take"), revenue: sum("revenue"), tips: sum("tips"), served: sum("served"), spoiled: sum("spoiled"),
    evictions: run.rows.filter(r => r.evicted).length, failed: !!run.c.failed, venue: run.c.venue };
}
