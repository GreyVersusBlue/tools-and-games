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

// ---- venue ladder ----
ok(c.venue === "cornerTap" && c.darkNightsLeft === 0, "fresh campaign starts at the Corner Tap");
ok(!C.canMoveVenue(c), "can't afford the Fieldhouse on day-1 cash");
const fBefore = C.forecast(c);
c.cash = 5500;
let mv = C.moveVenue(c);
ok(mv.ok && c.venue === "fieldhouse" && c.cash === 0, "move to Fieldhouse charges the full cost");
ok(c.darkNightsLeft === 1, "Fieldhouse move sets a 1-night dark countdown");
ok(C.forecast(c) > fBefore, "Fieldhouse's buzz multiplier lifts the forecast over the Corner Tap");
mv = C.moveVenue(c);
ok(!mv.ok, "can't afford Midtown right after paying for the Fieldhouse");
c.cash = 900;
const dn = C.settleDarkNight(c, Math.random);
ok(dn.net < 0 && c.cash < 900 && c.darkNightsLeft === 0, "dark night charges bills with zero revenue and counts down");
ok(dn.rent === C.VENUES.fieldhouse.rent, "dark night bills the Fieldhouse's own rent, not the Corner Tap's flat number");
ok(dn.rent > C.RENT, "and the Fieldhouse's rent is more than the Corner Tap's base rate");
c.cash = 999999;
mv = C.moveVenue(c); mv = C.moveVenue(c);
ok(c.venue === "flagship", "moving twice more reaches the flagship");
mv = C.moveVenue(c);
ok(!mv.ok && c.venue === "flagship", "no further move exists past the flagship");
ok(C.nextVenue(c) === null, "nextVenue is null once you're at the top of the ladder");

// ---- rent scales with tier, seats don't (session-2 audit) ----
// Session 1 shipped the ladder's economics with a flat RENT everywhere, which is
// what let the flagship win a same-night A/B on net alone — bigger crowd, same
// bills. rent() ties the nightly bill to the current venue so the top of the
// ladder costs more to run, not just more to buy.
ok(C.VENUES.cornerTap.rent === C.RENT, "the Corner Tap's own rent is still the base RENT constant");
const rentLadder = C.VENUE_ORDER.map(id => C.VENUES[id].rent);
ok(rentLadder.every((r, i) => i === 0 || r > rentLadder[i - 1]), "rent strictly increases up the ladder");
const rc = C.newCampaign();
ok(C.rent(rc) === C.VENUES.cornerTap.rent, "rent(c) reads off the campaign's current venue");
C.devWarpVenue(rc, "flagship");
ok(C.rent(rc) === C.VENUES.flagship.rent, "and moves with it");
// Physical capacity, on the other hand, does not move — world.js builds one
// 30-seat room regardless of tier (buildWorld() ignores the venue argument), so
// pretending the tiers differ here was cosmetic. See campaign.js's VENUES comment.
ok(C.VENUE_ORDER.every(id => C.VENUES[id].seats === 30), "every tier's seats field is the same physical 30 — no fake variety");

// ---- dev/debug helpers ----
const cashBefore = c.cash;
C.devAddCash(c, 250.5);
ok(c.cash === Math.round((cashBefore + 250.5) * 100) / 100, "devAddCash adds and rounds");
C.devSetDay(c, 42);
ok(c.day === 42, "devSetDay sets an absolute day");
C.devSetDay(c, -5);
ok(c.day === 1, "devSetDay clamps below day 1");
ok(C.devWarpVenue(c, "fieldhouse") && c.venue === "fieldhouse" && c.darkNightsLeft === 0,
  "devWarpVenue jumps for free with no dark nights, even downward from flagship");
ok(!C.devWarpVenue(c, "not-a-venue"), "devWarpVenue rejects a bogus id");
c.darkNightsLeft = 2;
C.devClearDarkNights(c);
ok(c.darkNightsLeft === 0, "devClearDarkNights zeroes the countdown");
C.devFillStock(c, 500);
ok(Object.values(c.stock).every(v => v === 500), "devFillStock tops off every item");

// ---- crew ----
ok(c.applicants.length === 3, "three applicants on day 1");
ok(c.staff.length === 2 && c.staff[0].role === "cook" && c.staff[1].role === "server",
  "campaign starts with a cook and a server");
ok(c.applicants.every(a => a.role in C.ROLES && a.skill >= 1 && a.skill <= 5),
  "applicants roll a valid role and a 1-5 skill");
const appName = c.applicants[0].name;
ok(C.hire(c, appName) && c.staff.length === 3, "hire moves an applicant to payroll, hits the cap");
ok(!C.hire(c, c.applicants[0].name) && c.staff.length === 3, "roster caps at 3");
ok(C.fire(c, appName) && c.staff.length === 2, "fire removes from payroll");
ok(!C.fire(c, "Nobody Real"), "can't fire a ghost");
ok(new Set([...c.staff, ...c.applicants].map(x => x.name)).size === c.staff.length + c.applicants.length,
  "no duplicate names between payroll and applicants");

// ---- roles: prep-speed multipliers ----
ok(C.hasCook(c) && !C.hasBartender(c), "fresh roster has a cook, no bartender");
ok(C.roleMult(c, "cook") > 0, "a staffed cook gives a positive food-speed multiplier");
ok(C.roleMult(c, "bartender") === 0.55, "no bartender falls back to servers covering the taps, badly");
const cNoCook = C.newCampaign();
cNoCook.staff = cNoCook.staff.filter(s => s.role !== "cook");
ok(C.roleMult(cNoCook, "cook") === 0 && !C.hasCook(cNoCook), "pulling the only cook zeroes out food speed");

// ---- upgrades ----
const cu = C.newCampaign();
cu.cash = 100000;
ok(Object.keys(C.UPGRADES).length === 5, "five upgrades in the registry");
let ur = C.buyUpgrade(cu, "pos");
ok(ur.ok && C.owned(cu, "pos"), "buying an upgrade installs it");
ok(!C.buyUpgrade(cu, "pos").ok, "can't buy the same upgrade twice");
ok(!C.buyUpgrade({ ...cu, upgrades: [], cash: 0 }, "training").ok, "can't afford it, can't buy it");
ok(C.speedMult(cu, "server") > 1, "POS speeds up server walking");
ok(C.speedMult(cu, "cook") === 1, "POS doesn't touch cooks (no speed stat)");
C.buyUpgrade(cu, "training");
const cook = cu.staff.find(s => s.role === "cook");
ok(C.effWage(cu, cook) === Math.round(cook.wage * 1.15), "training raises effective wage 15%");
ok(C.roleMult(cu, "cook") > C.roleMult(c, "cook") * 0.9, "training also speeds up prep"); // sanity, not exact (different rosters)
const cNoCookUpg = C.newCampaign();
cNoCookUpg.cash = 100000;
cNoCookUpg.staff = cNoCookUpg.staff.filter(s => s.role !== "cook");
C.buyUpgrade(cNoCookUpg, "training"); C.buyUpgrade(cNoCookUpg, "rushexp");
ok(C.roleMult(cNoCookUpg, "cook") === 0, "no upgrade can fake a kitchen open with no cook on shift");
ok(C.upgradeFees(cu) === C.UPGRADES.pos.fee + C.UPGRADES.training.fee, "upkeep sums only owned upgrades' fees");

// ---- settlement ----
const cash0 = c.cash, day0 = c.day;
const books = C.settleNight(c, { total: 500, revenue: 450, tips: 50 });
ok(books.net === 500 - books.wages - C.rent(c), "net = take − wages − rent (no theme)");
ok(books.rent === C.VENUES.fieldhouse.rent, "and it's the Fieldhouse's rent, since that's where c is by now");
ok(Math.round(c.cash) === Math.round(cash0 + books.net), "cash moves by net");
ok(c.day === day0 + 1 && c.promoTonight === "none" && c.applicants.length === 3,
  "settle advances the day, clears the theme, rerolls applicants");

// ---- spoilage: the day-based cost session 3 decided on (Devon's call, not rent-creep or a losable lease) ----
const sp = C.newCampaign();
sp.stock = { wings: 20, burger: 20, nachos: 20, fries: 20, beer: 20, soda: 20 };
const before = { ...sp.stock };
const spBooks = C.settleNight(sp, { total: 0, revenue: 0, tips: 0 });
ok(sp.stock.beer === before.beer && sp.stock.soda === before.soda, "beer and soda never spoil");
ok(["wings", "burger", "nachos", "fries"].every(id => sp.stock[id] < before[id]),
  "every food item loses stock overnight when nothing sold");
ok(["wings", "burger", "nachos", "fries"].every(id => before[id] - sp.stock[id] === Math.round(before[id] * C.SPOILAGE_RATE)),
  "the amount lost matches SPOILAGE_RATE of what was on the shelf");
ok(spBooks.spoilage.value > 0 && Object.keys(spBooks.spoilage.byItem).length === 4,
  "settleNight reports what spoiled and its wholesale value");
const spDark = C.newCampaign();
spDark.cash = 5500; C.moveVenue(spDark);
spDark.stock.wings = 20;
const darkBooks = C.settleDarkNight(spDark);
ok(darkBooks.spoilage.byItem.wings === 3, "a dark night (no patrons) still rots the shelf — 15% of 20 rounds to 3");
const empty = C.newCampaign();
empty.stock = { wings: 0, burger: 0, nachos: 0, fries: 0, beer: 0, soda: 0 };
const emptyBooks = C.settleNight(empty, { total: 0, revenue: 0, tips: 0 });
ok(Object.keys(emptyBooks.spoilage.byItem).length === 0 && emptyBooks.spoilage.value === 0,
  "nothing on the shelf means nothing spoils");
ok(Object.values(sp.stock).every(v => v >= 0), "spoilage never takes stock negative");

// ---- persistence: the shared save slot (assets/js/gvb-save.js) ----
const mkStore = (seed = {}) => ({
  d: { ...seed },
  setItem(k, v) { this.d[k] = String(v); },
  getItem(k) { return this.d[k] ?? null; },
  removeItem(k) { delete this.d[k]; },
});
const store = mkStore();
C.saveCampaign(c, store);
const c2 = C.loadCampaign(store);
ok(c2 && c2.day === c.day && c2.cash === c.cash && c2.staff.length === c.staff.length, "save/load round-trips");
ok(JSON.parse(store.getItem(C.SAVE_KEY)).__v === C.SAVE_VERSION, "a stored save carries the schema version");
ok(!("__v" in c2), "the version marker is stripped before the game sees it");
ok(C.loadCampaign({ getItem: () => "garbage{{" }) === null, "corrupt save loads as null");
ok(C.loadCampaign(mkStore({ [C.SAVE_KEY]: '{"day":"soon"}' })) === null, "a save missing the basics is refused");
ok(C.campaignSlot(store) === C.campaignSlot(store), "one slot per storage object");

// A save written before this project used a slot: no version stamp, and none of
// the fields added since the first release. gvb-save reads the missing stamp as
// version 0; repairCampaign fills the rest.
const legacyRaw = JSON.stringify({
  day: 9, cash: 1200,
  stock: { wings: 5, beer: 12 },
  staff: [{ name: "Old Timer", wage: 60 }],
});
const cl = C.loadCampaign(mkStore({ [C.SAVE_KEY]: legacyRaw }));
ok(cl && cl.day === 9 && cl.cash === 1200, "an unversioned pre-slot save still loads");
ok(Array.isArray(cl.upgrades) && Array.isArray(cl.applicants) && cl.stats.nights === 0,
  "repair fills in the collections added since");
ok(cl.venue === "cornerTap" && cl.darkNightsLeft === 0 && cl.promoTonight === "none",
  "repair supplies the venue ladder fields");
ok(cl.staff[0].role === "server" && cl.staff[0].skill === 2, "a staffer with no role reads as a middling server");
ok(typeof cl.staff[0].speed === "number" && cl.staff[0].speed > 0,
  "and gets a walking speed — beginNight multiplies that into m/s, so undefined means a NaN server");
ok(Object.keys(C.STOCK_COST).every(id => typeof cl.stock[id] === "number"),
  "every menu item ends up with a stock number");
ok(typeof cl.staff[0].wage === "number" && cl.staff[0].wage > 0,
  "and a wage — that one was already in this save, but see the audit block below");

// ---- the legacy-save audit, done on purpose ---------------------------------
//
// `speed` (above) was found by accident. This block is the rest of the shape,
// gone through field by field: load a save missing one field, then run the
// arithmetic that reads it. The failure mode being hunted is not a crash — it is
// a number that quietly becomes NaN, or a night that quietly has nobody in it.
// See the note above repairCampaign() in js/campaign.js for the write-up.
const legacy = extra => C.loadCampaign(mkStore({
  [C.SAVE_KEY]: JSON.stringify({
    day: 5, cash: 1200,
    stock: { wings: 5, beer: 9 },
    staff: [{ name: "Old Timer", role: "server", skill: 3, wage: 60, speed: 2.1 }],
    ...extra,
  }),
}));
const finite = v => typeof v === "number" && Number.isFinite(v);

// cash: two bugs in one missing field. placeOrder() gates on `cost > c.cash`, and
// every comparison against undefined is false, so the order goes through for free.
const noCash = legacy({ cash: undefined });
ok(finite(noCash.cash), "a save with no cash loads with a finite till, not undefined");
ok(!C.placeOrder(noCash, { beer: 100000 }).ok,
  "so the distributor still refuses an order past the till (undefined made every order affordable)");
const noCashBooks = C.settleNight(noCash, { total: 500, revenue: 450, tips: 50 });
ok(finite(noCashBooks.net) && finite(noCash.cash), "and settling the night doesn't NaN the books");
ok(finite(legacy({ cash: null }).cash),
  "cash null reads as missing too — JSON.stringify writes NaN and Infinity as null");

// day: the quietest one in the file. weekday() indexes DAYS[(day-1) % 7], so day 0
// is DAYS[-1] and day 2.5 is DAYS[1.5] — both undefined, both making forecast() NaN,
// and a NaN crowdTarget spawns nobody for the whole eight hours.
for (const [bad, label] of [[0, "day 0"], [2.5, "a fractional day"], [-40, "a negative day"]]) {
  const c5 = legacy({ day: bad });
  ok(c5.day >= 1 && Number.isInteger(c5.day), `${label} is repaired onto the calendar`);
  ok(C.DAYS.includes(C.weekday(c5)), `${label} names a real weekday after repair`);
  ok(finite(C.forecast(c5)) && C.forecast(c5) > 0,
    `${label} forecasts a real crowd (NaN here is an empty night with nothing logged)`);
}

// stats: the old check was `if (!c.stats)`, so an object missing its numbers — a
// save from before bestNight and lifetimeNet existed — went straight through.
for (const [stats, label] of [[{}, "an empty stats object"], [{ nights: 3 }, "stats with only nights"]]) {
  const c6 = legacy({ stats });
  ok(finite(c6.stats.nights) && finite(c6.stats.bestNight) && finite(c6.stats.lifetimeNet),
    `${label} gets all three numbers filled`);
  const b6 = C.settleNight(c6, { total: 400, revenue: 380, tips: 20 });
  ok(finite(b6.net) && finite(c6.stats.bestNight) && finite(c6.stats.lifetimeNet),
    `and a night settles into ${label} without NaN`);
}
ok(legacy({ stats: { nights: 3 } }).stats.nights === 3, "a stat that is there is left alone");
ok(legacy({ stats: { nights: 2, streak: 9 } }).stats.streak === 9,
  "and an unknown stat survives the repair, so a field added later isn't dropped");

// staff/applicant wage: wageBill() feeds settleNight(), so one missing wage lands
// NaN in cash and stats.lifetimeNet for good.
const noWage = legacy({ staff: [{ name: "Old Timer", role: "server", skill: 3 }] });
ok(finite(noWage.staff[0].wage) && noWage.staff[0].wage > 0, "a staffer with no wage gets one from skill");
ok(finite(C.wageBill(noWage)) && finite(C.effWage(noWage, noWage.staff[0])),
  "so the wage bill is a number");
ok(finite(C.settleNight(noWage, { total: 500, revenue: 450, tips: 50 }).net),
  "and the night's net is a number");
const appNoWage = legacy({ applicants: [{ name: "Kat Frye", role: "cook", skill: 4 }] });
ok(finite(appNoWage.applicants[0].wage),
  "an applicant is repaired too — hire() moves it onto the payroll unchanged");

// name: the one hard throw in the audit. beginNight() does s.name.split(" ")[0]
// for every floor role, and fire() matches on name, so a nameless staffer is
// also unfireable.
const noName = legacy({ staff: [{ role: "server", skill: 2, wage: 55 }, { role: "server", skill: 3, wage: 70 }] });
ok(noName.staff.every(s => typeof s.name === "string" && s.name.trim()),
  "a staffer with no name gets one (beginNight() calls .split on it)");
ok(new Set(noName.staff.map(s => s.name)).size === 2,
  "and two nameless staffers get different names, because fire() matches on name");
ok(C.fire(noName, noName.staff[0].name) && noName.staff.length === 1, "so it can be fired");

// skill: `if (!p.skill)` only caught falsy, so a string sailed through into
// roleMult() — prep speed for that whole side of the ticket.
for (const [skill, label] of [["high", "a non-numeric skill"], [99, "an out-of-range skill"], [0, "skill 0"]]) {
  const c7 = legacy({ staff: [{ name: "Old Timer", role: "cook", skill, wage: 60 }] });
  ok(c7.staff[0].skill >= 1 && c7.staff[0].skill <= 5, `${label} is clamped to 1-5`);
  ok(finite(C.roleMult(c7, "cook")) && C.roleMult(c7, "cook") > 0, `and ${label} still multiplies prep speed`);
}

// upgrades: `if (!c.upgrades)` let an object through, and owned() calls .includes
// on it from the first frame.
const badUpg = legacy({ upgrades: { pos: true } });
ok(Array.isArray(badUpg.upgrades), "a non-array upgrades list is replaced with an array");
// Caught rather than called bare: if this regresses, .includes throws, and an
// uncaught throw here kills the file instead of failing one line of it.
ok((() => {
  try { return finite(C.upgradeFees(badUpg)) && C.owned(badUpg, "pos") === false; }
  catch (e) { return false; }
})(), "so owned() and upgradeFees() work instead of throwing on .includes");
const badApps = legacy({ applicants: {} });
ok(badApps && Array.isArray(badApps.applicants),
  "a non-array applicants list loads as empty rather than refusing the whole save");

// speed, the one from last session, still covered.
for (const [speed, label] of [[undefined, "no speed"], [null, "speed null"], ["fast", "a string speed"]]) {
  const c8 = legacy({ staff: [{ name: "Old Timer", role: "server", skill: 3, wage: 60, speed }] });
  ok(finite(c8.staff[0].speed) && c8.staff[0].speed > 0, `${label} is repaired to a real m/s`);
  ok(finite(c8.staff[0].speed * C.speedMult(c8, "server")),
    `and ${label} survives the multiply beginNight() does`);
}
// The three above all pass on a plain `typeof p.speed !== "number"` too, because
// JSON has no way to carry a NaN — it writes one as null. The gap only opens when
// repair runs on a live object rather than a parsed one, which it does: the slot
// calls it on the campaign the game already holds. `typeof NaN` is "number", so
// only a finite check catches this. Same for the countdown below.
const liveNaN = C.repairCampaign({
  day: 4, cash: 900, stock: {}, upgrades: [], applicants: [], stats: { nights: 1 },
  venue: "cornerTap", darkNightsLeft: NaN, promoTonight: "none",
  staff: [{ name: "Old Timer", role: "server", skill: 3, wage: 60, speed: NaN }],
});
ok(finite(liveNaN.staff[0].speed) && liveNaN.staff[0].speed > 0,
  "a literal NaN speed is repaired — typeof NaN is 'number', so a typeof check waves it through");
ok(liveNaN.darkNightsLeft === 0, "and so is a NaN dark-night countdown");
const oddDark = legacy({ darkNightsLeft: -3 });
ok(oddDark.darkNightsLeft === 0,
  "a negative countdown reads as zero — main.js only announces the reopening on === 0");
ok(legacy({ darkNightsLeft: 2.7 }).darkNightsLeft === 3, "and a fractional one is rounded to whole nights");

// stock, darkNightsLeft, venue, promo: same treatment, less drama.
const oddStock = legacy({ stock: { wings: null, beer: "9", nachos: -5 }, darkNightsLeft: "soon" });
ok(Object.keys(C.STOCK_COST).every(id => finite(oddStock.stock[id]) && oddStock.stock[id] >= 0),
  "every stock number lands finite and non-negative");
ok(oddStock.darkNightsLeft === 0, "a non-numeric dark-night countdown reads as zero too");
ok(legacy({ venue: "not-a-venue" }).venue === "cornerTap", "an unknown venue falls back to the Corner Tap");
ok(legacy({ promoTonight: "freebeer" }).promoTonight === "none", "an unknown promo falls back to no theme");

// Idempotent: the slot runs repair on every load, including saves it just wrote.
const once = C.repairCampaign(C.newCampaign());
const twice = C.repairCampaign(JSON.parse(JSON.stringify(once)));
ok(JSON.stringify(once) === JSON.stringify(twice), "repair is idempotent — a repaired save repairs to itself");
const roundTrip = legacy({ cash: undefined, day: 0, stats: {}, staff: [{ role: "server" }] });
ok(JSON.stringify(C.repairCampaign(JSON.parse(JSON.stringify(roundTrip)))) === JSON.stringify(roundTrip),
  "and a save it had to fix comes out stable the second time too");

// Export / import: the piece the hand-rolled save never had.
const slot = C.campaignSlot(store);
const file = slot.serialize(c);
const env = JSON.parse(file);
ok(env.format === "gvb-save" && env.game === "fourth-quarter" && env.version === C.SAVE_VERSION,
  "an export file names the format, the game and the version");
const imported = slot.deserialize(file);
ok(imported && imported.day === c.day && imported.venue === c.venue, "an export file imports back");
ok(slot.deserialize(JSON.stringify({
  format: "gvb-save", game: "closing-time", version: 1, state: { day: 3, stock: {}, staff: [] },
})) === null, "another game's save file is refused");
ok(slot.deserialize('{"format":"gvb-save","game":"fourth-quarter","version":1,"state":{"day":"soon"}}') === null,
  "an envelope carrying junk is refused");

const c3 = C.resetCampaign(store);
ok(c3.day === 1 && store.getItem(C.SAVE_KEY) === null, "reset wipes the key and starts fresh");
ok(c3.applicants.length === 3, "reset rolls a fresh board of applicants (defaults is newCampaign, not a literal)");

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

// ---- upgrades: crowd + pricing effects ----
const cf = C.newCampaign(); cf.cash = 100000;
const fBase = C.forecast(cf);
C.buyUpgrade(cf, "broadcast");
ok(C.forecast(cf) > fBase, "Premium Screens lifts the forecast");
ok(C.beerMult(cf) === 1, "no Craft Tap Wall, no beer bump");
C.buyUpgrade(cf, "crafttaps");
ok(C.beerMult(cf) === 1.2, "Craft Tap Wall bumps beer 20%");
const eBeer = new NightEngine({ beerMult: C.beerMult(cf) });
ok(Math.abs(eBeer.price("beer") - MENU.beer.price * 1.2) < 1e-9, "beerMult threads into engine pricing");

// ---- engine: player stove/tap hooks (oldestPrep / workTicket) ----
seed(13);
const e5 = new NightEngine({ foodMult: 1, drinkMult: 1 });
ok(e5.oldestPrep("food") === null, "nothing cooking yet");
const tkA = e5.placeTicket(1, "wings");
e5.placeTicket(2, "burger");
ok(e5.oldestPrep("food").id === tkA.id, "oldestPrep returns the earliest-placed ticket of that kind");
const shaved = tkA.readyAt;
ok(e5.workTicket(tkA.id, false) && tkA.readyAt < shaved, "a miss still shaves prep time");
ok(e5.workTicket(tkA.id, true) && tkA.readyAt === e5.t && tkA.playerCrafted, "a hit finishes it instantly and flags it");
ok(e5.workTicket(9999, true) === null, "working a nonexistent ticket is a no-op");
const readyEvts = e5.update(0.1); // readyAt is now <= t, so it flips on the next tick
ok(readyEvts.some(ev => ev.type === "ready" && ev.ticket.id === tkA.id), "a perfect hit's ticket goes ready on the next tick");
ok(e5.claim(tkA.id, "boss"), "the player-worked ticket can be claimed like any other");
const rCraft = e5.deliver(tkA.id, false);
ok(rCraft && e5.crafted === 1, "delivering a player-crafted ticket counts toward crafted");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
