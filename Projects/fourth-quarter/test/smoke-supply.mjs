// smoke-supply.mjs — node test/smoke-supply.mjs
//
// The supply house (#905): js/supply.js's arithmetic, campaign.js's record of
// it, the two event cards that came with it, the save, and what each house is
// worth over a seeded season. No DOM, no three.js.
//
// The claim that matters most is that a campaign at County Line is the game
// as it was. Three things hold it: every order here is priced against the old
// one-line formula, smoke-settle.mjs's pin is unmoved, and SEASON_PIN below is
// the fingerprint of a whole season the build before this file played to the
// same bytes (20 of 20 seasons across the four rooms, compared tree against
// tree on 2026-10-06).

import { createHash } from "node:crypto";
import * as S from "../js/supply.js";
import * as C from "../js/campaign.js";
import * as EV from "../js/events.js";
import { NightEngine, MENU, FOOD, DRINK, seed, mulberry32 } from "../js/engine.js";
import { runSeason, totals, seeded } from "./fixtures/season.mjs";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;
const cents = n => Math.round(n * 100) / 100;
const ITEMS = Object.fromEntries(Object.keys(MENU).map(id => [id, { cost: C.STOCK_COST[id], kind: MENU[id].kind }]));
const at = (id, spend = 0) => ({ id, spend });
const fresh = (house, spend = 0) => { const c = C.newCampaign(); c.dist = at(house, spend); c.cash = 50000; return c; };

// ---- the table ----
{
  ok(S.HOUSE_ORDER.join() === "county,cask,gold" && S.HOUSE_ORDER.every(id => S.HOUSES[id].id === id), "three houses, each under its own id");
  ok(S.DEFAULT_HOUSE === "county" && JSON.stringify(S.newDist()) === '{"id":"county","spend":0}', "a new account is County Line with nothing spent");
  const k = S.HOUSES.county;
  ok(k.mult === 1 && k.fee === 0 && k.minOrder === 0 && k.dropFee === 0 && !k.account && k.plateMult === 1, "County Line is the identity on every lever");
  ok(S.HOUSES.cask.mult === 0.9 && S.HOUSES.cask.fee === 110 && S.HOUSES.cask.minOrder === 120 && S.HOUSES.cask.dropFee === 25, "Cask & Carton: 10% under, $110 a week, $25 under $120 (the 2D build's numbers)");
  ok(S.HOUSES.gold.mult === 1.12 && S.HOUSES.gold.plateMult === 1.08 && S.HOUSES.gold.fee === 0, "Gold Standard: 12% over, plates 8% dearer, no fee");
  ok(S.HOUSE_ORDER.every(id => S.HOUSES[id].pro && S.HOUSES[id].con), "every house says what it gives and what it takes");
  ok(C.DAYS[0] === S.FEE_DAY && C.weekday({ day: 1 }) === S.FEE_DAY, "the billing day is the calendar's Monday, and day 1 is one");
  ok(S.houseDef(null).id === "county" && S.houseDef({ id: "nobody" }).id === "county", "no record, or a house that does not exist, is County Line");
}

// ---- County Line is the old rule, to the cent ----
{
  const r = seeded(905, mulberry32);
  let same = true, flat = true;
  for (let i = 0; i < 2000; i++) {
    const order = {};
    for (const id in MENU) if (r() < 0.7) order[id] = Math.floor(r() * 400);
    let t = 0;
    for (const id in order) t += (order[id] || 0) * C.STOCK_COST[id];
    const old = Math.round(t * 100) / 100; // placeOrder()'s whole price before #905
    const q = S.quote(at("county", r() * 9000), order, ITEMS);
    if (q.total !== old || q.goods !== old || q.list !== old) same = false;
    if (q.drop !== 0 || Object.values(q.lines).some(l => l.off !== 0)) flat = false;
  }
  ok(same, "2,000 random orders at County Line cost what the one-line formula charged");
  ok(flat, "with no drop charge and no bulk break on any line, whatever the order's size");
  const c = fresh("county");
  const res = C.placeOrder(c, { wings: 100, beer: 300 });
  ok(res.ok && res.cost === C.orderCost({ wings: 100, beer: 300 }) && c.cash === 50000 - res.cost, "placeOrder() at County Line takes list price out of the till");
  ok(c.dist.spend === 0 && S.loyaltyOff(at("county", 9000)) === 0, "and County Line keeps no account: no spend recorded, no loyalty off");
}

// ---- bulk breaks ----
{
  const food = [[24, 0], [25, 0.04], [49, 0.04], [50, 0.06], [99, 0.06], [100, 0.10], [400, 0.10]];
  const drink = [[74, 0], [75, 0.04], [149, 0.04], [150, 0.06], [299, 0.06], [300, 0.10]];
  ok(food.every(([q, x]) => S.bulkOff(at("cask"), "food", q) === x), "food breaks at 25, 50 and 100 servings on the line: 4, 6 and 10%");
  ok(drink.every(([q, x]) => S.bulkOff(at("cask"), "drink", q) === x), "drink breaks at 75, 150 and 300");
  ok(S.bulkOff(at("cask"), "food", 75) === 0.06 && S.bulkOff(at("cask"), "drink", 50) === 0, "the two kinds do not share a table: 75 wings is 6% off, 50 beers nothing");
  ok(S.bulkOff(at("gold"), "food", 100) === 0.10 && S.bulkOff(at("county"), "food", 100) === 0, "both accounts get the breaks; County Line does not");
  ok(JSON.stringify(S.nextBreak(at("cask"), "food", 30)) === "[50,0.06]" && S.nextBreak(at("cask"), "food", 100) === null && S.nextBreak(at("county"), "food", 0) === null, "the next break is the first one above the line, and there is none past the top or at County Line");
  // a break is by the line, not by the order
  const q = S.quote(at("cask"), { wings: 25, burger: 24 }, ITEMS);
  ok(q.lines.wings.off === 0.04 && q.lines.burger.off === 0, "a break is earned by the line: 25 wings break, 24 burgers beside them do not");
  ok(near(q.goods, cents(25 * 3.2 * 0.9 * 0.96 + 24 * 3.8 * 0.9), 1e-9), `and the order is the sum of its lines (${q.goods})`);
}

// ---- loyalty ----
{
  const steps = [[0, 0], [999.99, 0], [1000, 0.01], [2999, 0.02], [5000, 0.05], [9000, 0.05]];
  ok(steps.every(([sp, x]) => S.loyaltyOff(at("cask", sp)) === x), "every $1,000 of spend is 1% off, to 5% and no further");
  ok(S.loyaltyOff(at("gold", 3000)) === 0.03 && S.loyaltyOff(at("cask", -50)) === 0 && S.loyaltyOff(at("cask", NaN)) === 0, "Gold Standard earns it too; a spend below zero or not a number earns nothing");
  ok(near(S.unitCost(at("cask", 5000), "food", 100, 3.2), 3.2 * 0.9 * 0.9 * 0.95, 1e-12), "the three discounts multiply: house, bulk, loyalty");
  const c = fresh("cask", 960);
  const first = C.placeOrder(c, { beer: 20 }); // 20 × 1.85 × 0.9 = 33.30: under the minimum
  ok(first.ok && first.goods === 33.3 && first.drop === 25 && first.cost === 58.3, `an order under $120 of goods draws the $25 drop charge (${first.cost})`);
  ok(c.dist.spend === 993.3 && S.loyaltyOff(c.dist) === 0, "loyalty builds on the goods and never on the drop charge: $993.30, not $1,018.30");
  C.placeOrder(c, { beer: 10 });
  ok(c.dist.spend === cents(993.3 + 16.65) && S.loyaltyOff(c.dist) === 0.01, "the next order crosses $1,000 and the one after it is 1% cheaper");
  ok(C.unitPrice(c, "beer", 0) === cents(1.85 * 0.9 * 0.99), `the order sheet's price says so (${C.unitPrice(c, "beer", 0)})`);
}

// ---- the minimum and its drop charge ----
{
  const q = n => S.quote(at("cask"), { beer: n }, ITEMS);
  ok(q(72).goods === 119.88 && q(72).drop === 25 && q(73).goods === 121.55 && q(73).drop === 0, "the drop charge is for goods under $120 and stops at it");
  ok(S.quote(at("cask"), {}, ITEMS).total === 0 && S.quote(at("cask"), { beer: 0 }, ITEMS).drop === 0, "an empty order is no order: nothing owed, no drop charge");
  const c = fresh("cask");
  ok(C.placeOrder(c, {}).ok === false && c.cash === 50000, "and placeOrder() refuses it");
  c.cash = 50;
  ok(C.placeOrder(c, { beer: 20 }).ok === false && c.cash === 50 && c.stock.beer === 90, "the drop charge counts against the till: $33.30 of beer is refused at $50 because it costs $58.30");
  ok(S.quote(at("county"), { soda: 1 }, ITEMS).drop === 0 && S.quote(at("gold"), { soda: 1 }, ITEMS).drop === 0, "the other two houses have no minimum");
  ok(S.quote(at("cask"), { beer: 10, caviar: 50 }, ITEMS).goods === 16.65, "a line for something not on the menu is not charged");
}

// ---- the weekly fee ----
{
  ok(S.weeklyFee(at("cask"), "Mon") === 110 && C.DAYS.filter(d => S.weeklyFee(at("cask"), d) > 0).join() === "Mon", "Cask & Carton bills $110 on Monday and on no other day");
  ok(C.DAYS.every(d => S.weeklyFee(at("county"), d) === 0 && S.weeklyFee(at("gold"), d) === 0), "the other two never bill");
  const night = { total: 0, revenue: 0, tips: 0, served: 0, walkouts: 0, mood: 0.6, serviceRate: 100 };
  const mon = fresh("cask"), monCounty = fresh("county");
  ok(C.accountFee(mon) === 110 && C.billsFor(mon).account === 110 && C.billsFor(mon).total === C.billsFor(monCounty).total + 110, "on a Monday the fee is in the bill the lease check reads");
  const b = C.settleNight(mon, night, seeded(1, mulberry32)), b0 = C.settleNight(monCounty, night, seeded(1, mulberry32));
  ok(b.account === 110 && b0.account === 0 && b.net === b0.net - 110 && mon.cash === monCounty.cash - 110, "settlement takes it: the same night nets $110 less at Cask & Carton");
  const b2 = C.settleNight(mon, night, seeded(2, mulberry32));
  ok(mon.day === 3 && b2.account === 0, "and Tuesday's settlement takes nothing");
  const dark = fresh("cask"), darkCounty = fresh("county");
  dark.darkNightsLeft = darkCounty.darkNightsLeft = 1;
  const d = C.settleDarkNight(dark, seeded(1, mulberry32)), d0 = C.settleDarkNight(darkCounty, seeded(1, mulberry32));
  ok(d.account === 110 && d.net === d0.net - 110, "a dark Monday is billed too: the house does not care that the doors were shut");
  let fees = 0;
  const wk = fresh("cask");
  for (let i = 0; i < 28; i++) fees += C.settleNight(wk, night, seeded(i, mulberry32)).account;
  ok(fees === 440, `four weeks is four fees (${fees})`);
}

// ---- signing with a house ----
{
  const c = fresh("cask", 3200);
  ok(C.signHouse(c, "cask").ok === false && c.dist.spend === 3200, "signing with the house you have changes nothing");
  ok(C.signHouse(c, "nobody").ok === false && c.dist.id === "cask", "nor does a house that does not exist");
  const r = C.signHouse(c, "gold");
  ok(r.ok && r.forfeited === 0.03 && c.dist.id === "gold" && c.dist.spend === 0 && r.house.name === S.HOUSES.gold.name, "switching forfeits the loyalty: 3% at Cask & Carton is nothing at Gold Standard");
  C.signHouse(c, "cask");
  ok(c.dist.spend === 0 && S.loyaltyOff(c.dist) === 0, "and going back does not bring it back");
  ok(S.switchHouse(at("cask", 10), "cask") === null && S.switchHouse(at("cask", 10), "x") === null, "supply.js's own switch refuses both the same ways");
}

// ---- Gold Standard's plate ----
{
  const c = fresh("gold");
  ok(C.plateMult(c) === 1.08 && C.plateMult(fresh("cask")) === 1 && C.plateMult(fresh("county")) === 1, "only Gold Standard moves the plate");
  const plain = new NightEngine({ crowdTarget: 10 }), gold = new NightEngine({ crowdTarget: 10, plateMult: C.plateMult(c) });
  ok(FOOD.every(id => gold.price(id) === cents(MENU[id].price * 1.08) && plain.price(id) === MENU[id].price), "food sells for 8% more with the option, and for the menu's price without it");
  ok(DRINK.every(id => gold.price(id) === plain.price(id)), "beer and soda do not");
  ok(C.unitPrice(c, "beer", 0) === cents(1.85 * 1.12) && C.unitPrice(c, "wings", 0) === cents(3.2 * 1.12), "and everything costs 12% more to stock, the beer included");
  ok(new NightEngine({ plateMult: NaN }).price("wings") === 9 && new NightEngine({ plateMult: -3 }).price("wings") === 0, "a plateMult that is not a number is 1, and one below zero is floored like the other multipliers");
  const wing = new NightEngine({ plateMult: 1.08, promo: "wingnight" });
  ok(wing.price("wings") === cents(9 * 0.6 * 1.08), "it stacks with Wing Night's price rather than replacing it");
}

// ---- the par sheet ----
{
  const fill = S.parFill({ wings: 40, beer: 120, soda: 10 }, { wings: 12, beer: 130, soda: 4 }, { wings: 5, beer: 0, soda: 0, fries: 3 });
  ok(fill.cart.wings === 28 && fill.cart.beer === 0 && fill.cart.soda === 6 && fill.cart.fries === 3 && fill.added === 29, "Fill to Par tops each line up to its par, counting the shelf and the cart, and leaves the rest alone");
  ok(S.parFill({ wings: 40 }, { wings: 12 }, fill.cart).added === 0, "a second fill adds nothing");
  ok(S.parFill({ wings: 0, beer: -5 }, {}, {}).added === 0, "a par of nothing asks for nothing");
  const c = fresh("county");
  ok(C.setPar(c, "wings", "40") && c.pars.wings === 40 && C.setPar(c, "wings", 12.6) && c.pars.wings === 13, "a par is a whole number of servings, typed or not");
  ok(C.setPar(c, "wings", "") && !("wings" in c.pars) && C.setPar(c, "beer", -3) && !("beer" in c.pars) && C.setPar(c, "beer", "lots") && !("beer" in c.pars), "blank, negative or junk clears the line");
  ok(C.setPar(c, "caviar", 5) === false && !("caviar" in c.pars), "there is no par for something not on the menu");
  ok(S.parValue(5000) === S.PAR_MAX, "a par is capped where the input is");
  c.pars = { beer: 150 }; c.stock.beer = 90;
  const f = C.fillToPar(c, { beer: 0 });
  ok(f.cart.beer === 60 && f.added === 60, "the campaign's fill reads its own shelf and sheet");
}

// ---- the two cards ----
const view = (o = {}) => ({
  day: 30, hour: 3, gameNight: false, gameDone: false, playoff: null, phase: "regular", rivalGame: false, crowd: 0, crowdTarget: 30,
  mood: 0.7, stock: { wings: 0, burger: 0, nachos: 0, fries: 0, beer: 0, soda: 0 }, tier: 0, rep: 50, buzz: 10, upgrades: [],
  staff: [], regulars: [], regularsIn: [], flags: { tapBroken: true, tvBroken: true, soundBroken: true, goldLapsed: false }, wager: 0, fired: [], budget: 3, ...o,
});
{
  const strike = EV.eventDef("caskstrike"), gone = EV.eventDef("goldshortage");
  const ids = v => EV.eligible(EV.EVENTS, v).map(e => e.id);
  ok(strike.cd === 9 && strike.weight === 1 && gone.cd === 7 && gone.weight === 1, "both cards carry the 2D build's cooldown and weight");
  ok(ids(view({ dist: "cask" })).includes("caskstrike") && !ids(view({ dist: "cask" })).includes("goldshortage"), "Warehouse Walkout fires for Cask & Carton and The Good Stuff Ran Out does not");
  ok(ids(view({ dist: "gold" })).includes("goldshortage") && !ids(view({ dist: "gold" })).includes("caskstrike"), "and the other way round at Gold Standard");
  ok(!ids(view({ dist: "county" })).some(id => id === "caskstrike" || id === "goldshortage") && !ids(view()).some(id => id === "caskstrike" || id === "goldshortage"), "neither fires at County Line, or on a view with no house in it");
  ok(!ids(view({ dist: "gold", flags: { goldLapsed: true } })).includes("goldshortage"), "the good stuff cannot run out twice in a night");
  ok(JSON.stringify(EV.effectsOf(strike, 0, view())) === '[{"cash":-150}]' && JSON.stringify(EV.effectsOf(strike, 1, view())) === `[{"account":${-S.STRIKE_SPEND}}]`, "the strike: $150 now, or one step of standing (supply.js's STRIKE_SPEND)");
  ok(JSON.stringify(EV.effectsOf(gone, 0, view())) === '[{"cash":-120}]' && JSON.stringify(EV.effectsOf(gone, 1, view())) === '[{"flag":"goldLapsed"},{"mood":-0.04}]', "the shortage: $120 now, or the premium gone for the night and 0.04 off the mood");
  ok(EV.FLAGS.includes("goldLapsed") && "account" in EV.EFFECT_KINDS, "the flag and the effect are kinds the table names");

  // through the engine: the floor's half
  const e = new NightEngine({ crowdTarget: 10, plateMult: 1.08 });
  ok(e.flags.goldLapsed === false && e.price("burger") === cents(11 * 1.08), "the night opens with the premium on");
  e.openMoment(gone);
  const mood = e.mood;
  e.resolveMoment(1);
  ok(e.flags.goldLapsed === true && e.price("burger") === 11 && near(e.mood, mood - 0.04, 1e-9), "cooked around: a burger is $11 again for the rest of the night, and the room is 0.04 flatter");
  ok(e.price("beer") === 6 && e.summary().moments.flags.goldLapsed === true, "the beer never moved, and the summary carries the flag");
  const e2 = new NightEngine({ crowdTarget: 10, plateMult: 1.08 });
  e2.openMoment(gone); e2.resolveMoment(0);
  ok(e2.eventNet === -120 && e2.flags.goldLapsed === false && e2.price("burger") === cents(11 * 1.08), "overnighted in: $120 off the night and the premium stays");
  const e3 = new NightEngine({ crowdTarget: 10 });
  e3.openMoment(strike); e3.resolveMoment(1);
  ok(e3.eventNet === 0 && e3.eventAccount === -1000 && e3.summary().moments.account === -1000, "the strike ridden out costs the till nothing tonight and is carried to the books");
  const e4 = new NightEngine({ crowdTarget: 10 });
  e4.openMoment(strike); e4.resolveMoment(0);
  ok(e4.eventNet === -150 && e4.summary().moments.account === 0, "paid off: $150 and the standing untouched");

  // through settlement: the books' half
  const night = account => ({ total: 0, revenue: 0, tips: 0, served: 0, walkouts: 0, mood: 0.6, serviceRate: 100,
    moments: { net: 0, rep: 0, buzz: 0, account, loyalty: {}, staff: [], resolved: [{ id: "caskstrike", choice: 1, auto: false, hour: 3 }] } });
  const c = fresh("cask", 2400); c.day = 2;
  const b = C.settleNight(c, night(-1000), seeded(1, mulberry32));
  ok(c.dist.spend === 1400 && b.moments.account === -1000 && S.loyaltyOff(c.dist) === 0.01, "settlement takes the step off the account: $2,400 to $1,400, 2% to 1%");
  ok(c.eventCd.caskstrike === 2 + 9, "and the card is on its nine-night cooldown");
  const low = fresh("cask", 300); low.day = 2;
  const bl = C.settleNight(low, night(-1000), seeded(1, mulberry32));
  ok(low.dist.spend === 0 && bl.moments.account === -300, "an account with $300 on it loses $300: the standing floors at nothing and the record says what came off");
  const k = fresh("county"); k.day = 2;
  ok(C.settleNight(k, night(-1000), seeded(1, mulberry32)).moments.account === 0 && k.dist.spend === 0, "County Line has no standing to lose");
  ok(C.eventView(fresh("gold")).dist === "gold" && C.eventView(fresh("county")).dist === "county", "the books' half of the card view names the house");
  // the campaign's own picker: the card is reachable from a save, not only from a hand-built view
  const g = fresh("gold");
  const v = { ...C.eventView(g), ...view({ dist: undefined }), dist: C.eventView(g).dist };
  ok(EV.eligible(EV.EVENTS, v, g.eventCd).some(x => x.id === "goldshortage"), "a campaign signed with Gold Standard has the shortage in tonight's pool");
}

// ---- the save ----
{
  const mkStore = (seedData = {}) => ({ d: { ...seedData }, setItem(k, v) { this.d[k] = String(v); }, getItem(k) { return this.d[k] ?? null; }, removeItem(k) { delete this.d[k]; } });
  const raw = (c, v, extra = {}) => { const o = { ...JSON.parse(JSON.stringify(c)), ...extra }; if (v === null) delete o.__v; else o.__v = v; return JSON.stringify(o); };
  ok(C.SAVE_KEY === "fq3d-save" && C.SAVE_VERSION === 2, "the key is the key it always was (#36); the version is 2");
  const base = C.newCampaign(); base.day = 23; base.cash = 4321.5; base.stock.wings = 37;
  const bare = JSON.parse(JSON.stringify(base)); delete bare.dist; delete bare.pars;

  for (const [v, word] of [[1, "version 1"], [null, "no version at all"]]) {
    const c = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, v) }));
    ok(c && JSON.stringify(c.dist) === '{"id":"county","spend":0}' && JSON.stringify(c.pars) === "{}", `a save with ${word} and no house loads signed with County Line and an empty par sheet`);
    ok(c && c.day === 23 && c.cash === 4321.5 && c.stock.wings === 37 && c.staff.length === base.staff.length && c.league.seed === base.league.seed, "and nothing it had is lost");
    ok(c && C.orderQuote(c, { wings: 100 }).total === C.orderCost({ wings: 100 }) && C.accountFee(c) === 0, "and it pays what it paid");
  }
  // migrate, not repair: a house in a file from before there were houses is not this system's record
  const stray = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 1, { dist: { id: "cask", spend: 5000 }, pars: { beer: 200 } }) }));
  ok(stray && stray.dist.id === "county" && stray.dist.spend === 0 && JSON.stringify(stray.pars) === "{}", "migrate: a version-1 file carrying a house and a par sheet is still signed with County Line (no version-1 build wrote either)");
  const kept = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 2, { dist: { id: "cask", spend: 5000 }, pars: { beer: 200 } }) }));
  ok(kept && kept.dist.id === "cask" && kept.dist.spend === 5000 && kept.pars.beer === 200, "the same record in a version-2 file is kept: that one this build wrote");
  // the slot only calls migrate when the version differs, so the step's own guard is asked directly
  const v2 = C.migrateCampaign({ dist: { id: "cask", spend: 5000 }, pars: { beer: 200 } }, 2);
  ok(v2.dist.id === "cask" && v2.pars.beer === 200 && C.migrateCampaign({ dist: { id: "cask", spend: 5 } }, 0).dist.id === "county", "the step is for files from before version 2 only: a later migration will not sign anyone back to County Line");
  // repair, on every load
  const rep = extra => C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 2, extra) }));
  ok(rep({}).dist.id === "county", "repair: a version-2 save with no house at all is County Line");
  ok(["cash-and-carry", 7, null, { id: "sysco", spend: 900 }, []].every(d => JSON.stringify(rep({ dist: d }).dist) === '{"id":"county","spend":0}'), "a house that is not one of the three, or not a record, is County Line with nothing spent");
  ok(rep({ dist: { id: "gold", spend: "lots" } }).dist.spend === 0 && rep({ dist: { id: "gold", spend: -40 } }).dist.spend === 0 && rep({ dist: { id: "gold" } }).dist.spend === 0, "a spend that is not a number at or above zero is nothing, and the house is kept");
  ok(rep({ dist: { id: "county", spend: 4000 } }).dist.spend === 0, "County Line carries no spend whatever the file says");
  ok(JSON.stringify(rep({ pars: { wings: 30.4, beer: -2, soda: "x", caviar: 9, fries: 1e9 } }).pars) === `{"wings":30,"fries":${S.PAR_MAX}}`, "the par sheet keeps whole positive numbers under menu ids, capped, and drops the rest");
  ok(JSON.stringify(rep({ pars: "all of it" }).pars) === "{}", "a par sheet that is not a record is an empty one");
  const once = C.repairCampaign(JSON.parse(JSON.stringify({ ...bare, dist: { id: "cask", spend: 1234.567 }, pars: { beer: 99 } })));
  const twice = C.repairCampaign(JSON.parse(JSON.stringify(once)));
  ok(JSON.stringify(once.dist) === JSON.stringify(twice.dist) && JSON.stringify(once.pars) === JSON.stringify(twice.pars) && once.dist.spend === 1234.57, "repair is idempotent over both fields");
  // round trip, and through an export
  const store = mkStore();
  const live = fresh("cask", 2750); live.pars = { wings: 40, beer: 150 };
  C.saveCampaign(live, store);
  const back = C.loadCampaign(store);
  ok(JSON.parse(store.getItem(C.SAVE_KEY)).__v === 2 && back.dist.id === "cask" && back.dist.spend === 2750 && back.pars.beer === 150, "a save written now round-trips the house, its standing and the par sheet");
  const slot = C.campaignSlot(store);
  const env = JSON.parse(slot.serialize(back));
  ok(env.version === 2 && env.state.dist.id === "cask", "and the export file carries them at version 2");
  const old = { ...env, version: 1, state: { ...env.state } };
  delete old.state.dist; delete old.state.pars;
  old.state.dist = { id: "gold", spend: 4000 }; // not a thing a version-1 export could hold
  const got = slot.deserialize(JSON.stringify(old));
  ok(got && got.dist.id === "county" && got.dist.spend === 0 && got.day === back.day, "an export file from version 1 imports as County Line, whatever it claims");
}

// ---- a season, three ways ----
// One seed, the Corner Tap, 98 nights (the 14-week regular season), the bot in
// fixtures/season.mjs stocking to the same par off the same forecast every
// morning. It serves instantly and never walks anyone, so its nights are far
// richer than a played one; what is read off it is the difference between
// houses, which is the supply house's doing and nothing else's.
const SEASON_PIN = "3a3b783b56e06d942d18b66612b858c10f2ec0b7132978937093c24c2988691a";
{
  const mods = { C, NightEngine, seed, mulberry32 };
  const county = runSeason(mods, { seed: 1 }), cask = runSeason(mods, { seed: 1, house: "cask" }), gold = runSeason(mods, { seed: 1, house: "gold" });
  const tk = totals(county), tc = totals(cask), tg = totals(gold);
  // the season as the build before #905 would have written it
  const asOld = JSON.stringify({ rows: county.rows.map(({ drop, account, ...r }) => r), c: (({ dist, pars, ...c }) => c)(county.c) });
  const digest = createHash("sha256").update(asOld).digest("hex");
  if (process.argv.includes("--digest")) { console.log(digest); process.exit(0); }
  ok(digest === SEASON_PIN, `feature off: a County Line season is the season the build before the supply house played (sha256 ${digest.slice(0, 12)}, pinned ${SEASON_PIN.slice(0, 12)})`);
  ok(tk.nights === 98 && tc.nights === 98 && tg.nights === 98 && tk.evictions + tc.evictions + tg.evictions === 0, "all three ran the whole season and nobody was evicted, so the three are comparable");
  ok(county.rows.every(r => r.paid === r.list && r.drop === 0 && r.account === 0) && tk.list > 15000, `County Line paid list for every order and nothing else ($${tk.list} over the season)`);

  // Cask & Carton: the same nights, a cheaper truck, a weekly bill
  ok(cask.rows.every((r, i) => r.take === county.rows[i].take && r.served === county.rows[i].served && JSON.stringify(r.order) === JSON.stringify(county.rows[i].order)), "Cask & Carton changes nothing about a night: the same orders, the same plates, the same take, 98 times");
  ok(tc.account === 14 * 110, `it billed 14 Mondays ($${tc.account})`);
  ok(tc.drop === 25 * cask.rows.filter(r => r.drop).length && cask.rows.filter(r => r.drop).every(r => r.paid - r.drop < 120), `and charged a drop on every order under $120 (${tc.drop / 25} of them)`);
  ok(near(tc.cash - tk.cash, (tk.paid - tc.paid) - tc.account), `the season's difference is exactly what the truck saved less what the account cost: $${cents(tk.paid - tc.paid)} − $${tc.account} = $${cents(tc.cash - tk.cash)}`);
  ok(tc.paid - tc.drop < tk.list * 0.9 && tc.paid - tc.drop > tk.list * 0.9 * 0.9 * 0.95, "the goods cost less than 10% under list (bulk and loyalty bit) and more than the three discounts at full");
  ok(cask.c.dist.spend === cents(tc.paid - tc.drop) && S.loyaltyOff(cask.c.dist) === 0.05, "the account's standing is the goods it bought, and a season of it is at the 5% cap");
  ok(tc.cash > tk.cash, `at this bot's volume ($${Math.round(tk.list / 14)} a week at list) the account pays for itself: +$${Math.round(tc.cash - tk.cash)}`);

  // Gold Standard: the same plates, dearer both ways
  ok(gold.rows.every((r, i) => r.served === county.rows[i].served && JSON.stringify(r.order) === JSON.stringify(county.rows[i].order)), "Gold Standard serves the same plates off the same orders");
  ok(gold.rows.every((r, i) => r.revenue >= county.rows[i].revenue) && tg.revenue > tk.revenue * 1.02 && tg.revenue < tk.revenue * 1.08, `and takes more for them: revenue up ${cents((tg.revenue / tk.revenue - 1) * 100)}%, under the 8% because the drinks did not move`);
  ok(tg.paid > tk.list && tg.paid < tk.list * 1.12 && tg.account === 0 && tg.drop === 0, `its truck cost ${cents((tg.paid / tk.list - 1) * 100)}% over list: 12% less its own bulk breaks and loyalty, no fee, no drop`);
  ok(near(tg.cash - tk.cash, (tg.take - tk.take) - (tg.paid - tk.paid), 0.02), `the season's difference is exactly the dearer plates less the dearer truck: $${cents(tg.take - tk.take)} − $${cents(tg.paid - tk.paid)} = $${cents(tg.cash - tk.cash)}`);

  // where Cask & Carton stops paying: the arithmetic the panel's copy rests on
  const week = list => list * 0.1 - 110;
  ok(week(1100) === 0 && week(700) < 0, "before bulk and loyalty, the account breaks even at $1,100 a week at list; a quiet bar loses money on it");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
