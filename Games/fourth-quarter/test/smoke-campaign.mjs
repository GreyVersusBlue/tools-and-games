// smoke-campaign.mjs — node test/smoke-campaign.mjs
// Campaign books + stock/promo wiring into the night engine.

import * as C from "../js/campaign.js";
import { NightEngine, MENU, seed } from "../js/engine.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };

// ---- calendar & forecast ----
const c = C.newCampaign();
ok(c.cash === 900 && c.day === 1, "fresh books: $900, day 1");
ok(C.weekday(c) === "Mon" && !C.isGameNight(c), "day 1 is a quiet Monday");
c.day = 4;
ok(C.weekday(c) === "Thu" && C.isGameNight(c), "Thursday is a game night");
const fPlain = C.forecast(c);
c.promoTonight = "wingnight";
ok(C.forecast(c) > fPlain, "wing night lifts the forecast");
c.promoTonight = "watchparty";
const fParty = C.forecast(c);
c.day = 2; // Tuesday — no game
ok(C.forecast(c) < fParty && C.promoDef(c).crowd === 1, "watch party is dead money without a game");
c.day = 1; c.promoTonight = "none";

// ---- stock ordering ----
const beer0 = c.stock.beer;
let r = C.placeOrder(c, { beer: 10, wings: 5 });
ok(r.ok && Math.abs(r.cost - (10 * 1.85 + 5 * 3.2)) < 1e-9, "order cost sums per-serving prices");
ok(c.stock.beer === beer0 + 10 && c.cash === 900 - r.cost, "order lands in stock and out of cash");
r = C.placeOrder(c, { beer: 100000 });
ok(!r.ok && c.stock.beer === beer0 + 10, "can't order past the till");
r = C.placeOrder(c, {});
ok(!r.ok, "empty order rejected");

// ---- crew ----
ok(c.applicants.length === 3, "three applicants on day 1");
const appName = c.applicants[0].name;
ok(C.hire(c, appName) && c.staff.length === 2, "hire moves an applicant to payroll");
C.hire(c, c.applicants[0].name);
ok(!C.hire(c, c.applicants[0].name) && c.staff.length === 3, "roster caps at 3");
ok(C.fire(c, appName) && c.staff.length === 2, "fire removes from payroll");
ok(!C.fire(c, "Nobody Real"), "can't fire a ghost");
ok(new Set([...c.staff, ...c.applicants].map(x => x.name)).size === c.staff.length + c.applicants.length,
  "no duplicate names between payroll and applicants");

// ---- settlement ----
const cash0 = c.cash, day0 = c.day;
const books = C.settleNight(c, { total: 500, revenue: 450, tips: 50 });
ok(books.net === 500 - books.wages - C.RENT, "net = take − wages − rent (no theme)");
ok(Math.round(c.cash) === Math.round(cash0 + books.net), "cash moves by net");
ok(c.day === day0 + 1 && c.promoTonight === "none" && c.applicants.length === 3,
  "settle advances the day, clears the theme, rerolls applicants");

// ---- persistence (stub storage) ----
const store = { d: {}, setItem(k, v) { this.d[k] = v; }, getItem(k) { return this.d[k] ?? null; }, removeItem(k) { delete this.d[k]; } };
C.saveCampaign(c, store);
const c2 = C.loadCampaign(store);
ok(c2 && c2.day === c.day && c2.cash === c.cash && c2.staff.length === c.staff.length, "save/load round-trips");
ok(C.loadCampaign({ getItem: () => "garbage{{" }) === null, "corrupt save loads as null");
const c3 = C.resetCampaign(store);
ok(c3.day === 1 && store.getItem(C.SAVE_KEY) === null, "reset wipes the key and starts fresh");

// ---- engine: stock consumption ----
seed(5);
const stock = { wings: 2, burger: 0, nachos: 0, fries: 0, beer: 3, soda: 0 };
const e = new NightEngine({ stock, promo: "none", gameNight: false });
ok(e.placeTicket(1, "wings") && stock.wings === 1, "ticket eats a serving");
ok(e.placeTicket(2, "burger") === null, "86'd item refuses a ticket");
e.placeTicket(3, "wings");
ok(e.placeTicket(4, "wings") === null && stock.wings === 0, "shelves run dry");
for (let i = 0; i < 40; i++) {
  const pickId = e.chooseOrder(0);
  ok(pickId === null || stock[pickId] > 0, "chooseOrder only offers what's in stock");
  if (pickId === null) break;
}
stock.beer = 0; stock.wings = 0;
ok(e.chooseOrder(0) === null, "bare shelves choose nothing");

// ---- engine: promo pricing ----
seed(9);
const e2 = new NightEngine({ promo: "wingnight" });
ok(Math.abs(e2.price("wings") - MENU.wings.price * 0.6) < 1e-9, "wing night cuts wings 40%");
ok(e2.price("beer") === MENU.beer.price, "wing night leaves beer alone");
const tw = e2.placeTicket(1, "wings");
e2.update(30); e2.claim(tw.id, "boss");
const res = e2.deliver(tw.id, false);
ok(Math.abs(e2.revenue - MENU.wings.price * 0.6) < 1e-9, "revenue books the discounted price");
ok(res.price === tw.price, "delivery honors the price locked at order time");

const e3 = new NightEngine({ promo: "happyhour" });
ok(e3.price("beer") < MENU.beer.price, "happy hour discounts early drinks");
const th = e3.placeTicket(1, "beer"); // price locked now, in hour 0
while (e3.hour < 3 && !e3.done) e3.update(5);
ok(e3.price("beer") === MENU.beer.price, "happy hour ends after 7 PM");
ok(th.price < MENU.beer.price, "early ticket keeps its happy-hour price");

// ---- full night against a finite pantry ----
seed(21);
const c4 = C.newCampaign();
c4.day = 4; // game Thursday
const e4 = new NightEngine({
  crowdTarget: C.forecast(c4), gameNight: true, hourLenSec: 45, seats: 30,
  stock: c4.stock, promo: "none",
});
let placed = 0, servedTk = 0;
const rounds = new Map(); let pid = 0;
for (let t = 0; t < 45 * 8 + 5 && !e4.done; t += 0.5) {
  for (const ev of e4.update(0.5)) {
    if (ev.type === "spawn") {
      const id = ++pid;
      const item = e4.chooseOrder(0);
      if (item && e4.placeTicket(id, item)) { placed++; rounds.set(id, 1); }
    }
    if (ev.type === "ready") {
      e4.claim(ev.ticket.id, "srv");
      if (e4.deliver(ev.ticket.id, false)) servedTk++;
      e4.depart();
    }
  }
}
ok(e4.done && servedTk > 0, "campaign-fed night runs to close");
ok(Object.values(c4.stock).every(v => v >= 0), "stock never goes negative");
const eaten = 24 + 16 + 14 + 30 + 90 + 40 - Object.values(c4.stock).reduce((a, b) => a + b, 0);
ok(eaten === placed, `every ticket ate exactly one serving (${eaten}/${placed})`);
const s4 = e4.summary();
const b4 = C.settleNight(c4, s4);
ok(typeof b4.net === "number" && c4.day === 5, "night settles into the books");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
