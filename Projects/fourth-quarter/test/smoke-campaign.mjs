// smoke-campaign.mjs — node test/smoke-campaign.mjs
// Campaign books + stock/promo wiring into the night engine.

import * as C from "../js/campaign.js";
import * as L from "../js/layout.js";
import * as LG from "../js/league.js";
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
// Physical capacity is the floor plan's, counted off layout.js — the same
// list world.js builds stools from — so the Real Estate card cannot promise a
// seat the room does not have. See campaign.js's VENUES comment.
ok(C.VENUE_ORDER.every(id => C.VENUES[id].seats === L.seatsFor(L.layoutFor(id)).length), "every tier's seats field is its floor plan's stool count");
ok(C.VENUE_ORDER.map(id => C.VENUES[id].seats).join() === "30,44,58,76", `seats climb 30, 44, 58, 76 (got ${C.VENUE_ORDER.map(id => C.VENUES[id].seats).join()})`);
ok(C.VENUE_ORDER.every((id, i) => i === 0 || C.VENUES[id].seats > C.VENUES[C.VENUE_ORDER[i - 1]].seats), "seats are strictly monotonic up the ladder");

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

// ---- upgrades: tier gates (the 2D build's, carried over) ----
ok(Object.values(C.UPGRADES).every(u => Number.isInteger(u.tier) && u.tier >= 0 && u.tier < C.VENUE_ORDER.length), "every upgrade names a tier that exists");
ok(C.UPGRADES.broadcast.tier === 1 && C.UPGRADES.crafttaps.tier === 1, "Premium Screens and the Craft Tap Wall need the Fieldhouse");
ok(C.UPGRADES.pos.tier === 0 && C.UPGRADES.training.tier === 0 && C.UPGRADES.rushexp.tier === 0, "the other three are open from day one");
const cg = C.newCampaign(); cg.cash = 100000;
ok(C.upgradeGate(cg, "broadcast") === C.VENUES.fieldhouse, "at the Corner Tap, Premium Screens is gated on the Fieldhouse");
ok(C.upgradeGate(cg, "pos") === null && C.upgradeGate(cg, "nope") === null, "an open upgrade (or a nonexistent one) has no gate");
const gr = C.buyUpgrade(cg, "broadcast");
ok(!gr.ok && gr.err === "The Fieldhouse or bigger — no room for it here." && !C.owned(cg, "broadcast"), `the gate refuses the sale by name (${gr.err})`);
ok(cg.cash === 100000, "a refused sale costs nothing");
ok(!C.buyUpgrade(cg, "crafttaps").ok, "the Craft Tap Wall is refused at the Corner Tap too");
C.devWarpVenue(cg, "fieldhouse");
ok(C.upgradeGate(cg, "broadcast") === null && C.buyUpgrade(cg, "broadcast").ok && C.owned(cg, "broadcast"), "at the Fieldhouse the same sale goes through");
C.devWarpVenue(cg, "flagship");
ok(C.upgradeGate(cg, "crafttaps") === null, "the gate is 'this tier or bigger', not 'exactly this tier'");
// the gate is on buying, not owning: a Corner Tap save with the Craft Tap Wall
// already in (bought before the gate existed) keeps it and its effect
const cOld = C.newCampaign(); cOld.upgrades.push("crafttaps");
ok(C.owned(cOld, "crafttaps") && C.beerMult(cOld) === 1.2 && C.upgradeGate(cOld, "crafttaps") === C.VENUES.fieldhouse, "an upgrade owned below its tier stays owned and keeps working");

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
C.devWarpVenue(cf, "fieldhouse"); // both of these are gated on the Fieldhouse
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

// ---- the league (Phase 6): the calendar asks league.js, not the weekday ----
{
  const c = C.newCampaign();
  ok(LG.validLeague(c.league) && c.league.season === 1, "a fresh campaign carries a season-1 league");
  // week 0 the Mules play Thursday; week 1 they play Sunday. The old rule said
  // both Thursdays and both Sundays; the fixture list says one each.
  c.day = 4;  ok(C.isGameNight(c), "day 4 (Thu, week 0) is a Mules game");
  c.day = 7;  ok(!C.isGameNight(c), "day 7 (Sun, week 0) is not — the Mules played Thursday");
  c.day = 11; ok(!C.isGameNight(c), "day 11 (Thu, week 1) is not — the Mules play Sunday this week");
  c.day = 14; ok(C.isGameNight(c), "day 14 (Sun, week 1) is");
  ok(C.tonight(c).mules && C.tonight(c).opp && C.tonight(c).label.includes(C.tonight(c).opp.short), "tonight() names the opponent");
  // the forecast accounts for the opponent: a rivalry night draws more than a plain game
  const rivalWeek = c.league.weeks.findIndex(w => w.some(g => [g.home, g.away].includes(LG.MULES) && [g.home, g.away].includes("HCS")));
  const rg = c.league.weeks[rivalWeek].find(g => [g.home, g.away].includes("HCS"));
  const plainWeek = c.league.weeks.findIndex((w, i) => i !== rivalWeek && i < 6);
  const pg = c.league.weeks[plainWeek].find(g => [g.home, g.away].includes(LG.MULES));
  // a fresh Corner Tap with no theme and no screens: the forecast is base × the league's multiplier, rounded
  c.day = LG.dateOf(1, plainWeek, pg.day);
  ok(C.forecast(c) === Math.round(C.BASE_CROWD[C.weekday(c)] * LG.CROWD.mules), `a plain Mules game is base × ${LG.CROWD.mules}`);
  c.day = LG.dateOf(1, rivalWeek, rg.day);
  ok(C.forecast(c) === Math.round(C.BASE_CROWD[C.weekday(c)] * LG.CROWD.rivalry), `a rivalry night is base × ${LG.CROWD.rivalry}`);
  c.day = 2; ok(C.forecast(c) === C.BASE_CROWD.Tue, "a Tuesday with nothing on is 1×");
  // odds: the engine's winProb is the league's, from the Mules' side
  c.day = 4; const g4 = C.tonight(c).mules;
  const pHome = LG.winProb(c.league, g4);
  ok(Math.abs(C.mulesWinProb(c) - (g4.home === LG.MULES ? pHome : 1 - pHome)) < 1e-9, "mulesWinProb is winProb from the Mules' side of the fixture");
  c.day = 2; ok(C.mulesWinProb(c) === 0.55, "and the old coin when there is no game");
}

// ---- the league in the save: additive, defaulted, played forward ----
{
  // a save from before the league existed, forty nights in
  const old = C.newCampaign(); delete old.league; old.day = 40;
  C.repairCampaign(old);
  ok(LG.validLeague(old.league) && old.league.season === 1 && LG.weekOf(old.day) === 5, "a day-40 save with no league loads into week 5 of season 1");
  const played = LG.allGames(old.league).filter(x => x.g.played);
  ok(played.length === 22 && played.every(x => x.date < 40), "with the 22 games dated before day 40 played and nothing on or after");
  const again = C.newCampaign(); delete again.league; again.day = 40; C.repairCampaign(again);
  ok(JSON.stringify(again.league) === JSON.stringify(old.league), "two loads of the same old save agree: the seed is the day");
  // a corrupt record is rebuilt whole, not patched
  const bad = C.newCampaign(); bad.league.weeks = "nope"; bad.day = 9;
  C.repairCampaign(bad);
  ok(LG.validLeague(bad.league) && LG.allGames(bad.league).filter(x => x.g.played).length === 5, "a corrupt league record is rebuilt and played to day 9 (week 0's four and Monday's)");
  // a league behind the day is caught up on load (the day moved without settlement)
  const lag = C.newCampaign(); lag.day = 30;
  C.repairCampaign(lag);
  ok(LG.allGames(lag.league).every(({ g, date }) => g.played === (date < 30)), "repair holds the league to the day");
  // the slot round-trips it
  const storage = {}; const stub = { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; }, removeItem: k => { delete storage[k]; } };
  const c = C.newCampaign(); c.day = 20; C.repairCampaign(c);
  C.saveCampaign(c, stub);
  const back = C.loadCampaign(stub);
  ok(back && JSON.stringify(back.league) === JSON.stringify(c.league), "a saved league loads back identical");
  ok(C.SAVE_KEY === "fq3d-save" && C.SAVE_VERSION === 1, "no key change, no version bump: the field is additive and repair fills it");
}

// ---- settlement: the standings say what the room saw ----
{
  const c = C.newCampaign(); c.day = 4; C.repairCampaign(c);
  const g = C.tonight(c).mules;
  const win = { total: 500, revenue: 450, tips: 50, game: { started: true, finished: true, win: true } };
  const books = C.settleNight(c, win, Math.random);
  ok(g.played && g.winner === LG.MULES && books.games.includes(g), "a night the Mules won puts a Mules win in the standings");
  ok(c.day === 5 && LG.allGames(c.league).every(({ g, date }) => g.played === (date < 5)), "and the next morning holds the invariant");
  const c2 = C.newCampaign(); c2.day = 4; C.repairCampaign(c2);
  const g2 = C.tonight(c2).mules;
  C.settleNight(c2, { total: 0, revenue: 0, tips: 0, game: { started: true, finished: true, win: false } }, Math.random);
  ok(g2.played && g2.winner !== LG.MULES, "a loss is a loss");
  const c3 = C.newCampaign(); c3.day = 4; C.repairCampaign(c3);
  const g3 = C.tonight(c3).mules;
  C.settleNight(c3, { total: 0, revenue: 0, tips: 0, game: { started: false, finished: false, win: null } }, Math.random);
  ok(g3.played && [g3.home, g3.away].includes(g3.winner), "a night whose game never finished: the league rolls it");
  // a dark night moves the league too
  const c4 = C.newCampaign(); c4.day = 4; C.repairCampaign(c4); c4.cash = 5500; C.moveVenue(c4);
  const g4 = C.tonight(c4).mules;
  const dn = C.settleDarkNight(c4, Math.random);
  ok(g4.played && dn.games.includes(g4) && c4.day === 5, "the Mules play whether the doors were open or not");
  // the dev menu's day jump syncs
  const c5 = C.newCampaign(); C.devSetDay(c5, 60);
  ok(LG.allGames(c5.league).every(({ g, date }) => g.played === (date < 60)), "devSetDay() catches the league up");
  C.devSetDay(c5, 3);
  ok(LG.allGames(c5.league).every(({ g, date }) => g.played === (date < 3)), "and walks it back, leaving Monday's game behind it");
}

// ---- Phase 9: the lease, and the night you can lose ----------------------
// The gap: settleNight() took cash to negative ten thousand and rolled
// tomorrow's applicants. Locked #219 (the landlord counts consecutive nights in
// the red), #220 (eviction is a demotion, not a game over) and #221 (billsFor()
// is the one place the nightly bill is computed).
{
  // one bill, two settlements. The drift this guards is not hypothetical: the
  // lease check reads the same number on both paths, so a wages/rent/upkeep
  // sum that differs between them evicts on one path and not the other.
  const c = C.newCampaign();
  const b = C.billsFor(c);
  ok(b.wages === C.wageBill(c) && b.rent === C.rent(c) && b.upgFees === C.upgradeFees(c), "billsFor() reports the three lines it sums");
  ok(b.total === b.wages + b.rent + b.upgFees, "and its total is exactly those three");
  const cashBefore = c.cash;
  const night = C.settleNight(c, { total: 0, revenue: 0, tips: 0 }, Math.random);
  ok(night.wages === b.wages && night.rent === b.rent && night.upgFees === b.upgFees, "a played night bills the same three numbers");
  ok(Math.abs((cashBefore - c.cash) - b.total) < 1e-9, "and a $0 take costs exactly the bill");
  // the threshold is $0 and nothing else: a fresh campaign that takes nothing
  // all night still has $660 in the till, so it is not a night in the red
  ok(c.cash > 0 && c.strikes === 0 && !night.lease.warned && !night.lease.short, `a fresh campaign's worst night is still in the black ($${c.cash})`);
  const d = C.newCampaign();
  const dBefore = d.cash;
  const dark = C.settleDarkNight(d, Math.random);
  ok(dark.wages === b.wages && dark.rent === b.rent && dark.upgFees === b.upgFees && Math.abs((dBefore - d.cash) - b.total) < 1e-9,
    "and a dark night costs exactly the same bill");
  ok(night.net === -b.total && dark.net === -b.total, "both nets are the negative of the one bill");
  // an upgrade's upkeep moves both by the same amount, which is the property
  // two hand-written copies of this arithmetic could not promise
  const u = C.newCampaign(); u.cash = 5000; C.buyUpgrade(u, "pos");
  ok(C.billsFor(u).total === b.total + C.UPGRADES.pos.fee, "installing the POS adds its fee to the one bill");
  // and both settlements spend that number rather than their own: with no
  // upgrade installed a dropped upkeep line is invisible, which is exactly how
  // two hand-written copies of this arithmetic stay wrong for a phase
  const ub = C.billsFor(u);
  const uCash = u.cash;
  const uNight = C.settleNight(u, { total: 0, revenue: 0, tips: 0 }, Math.random);
  ok(uNight.upgFees === C.UPGRADES.pos.fee && Math.abs((uCash - u.cash) - ub.total) < 1e-9 && uNight.net === -ub.total,
    `a played night with gear on the wall spends the upkeep too ($${uCash - u.cash} vs $${ub.total})`);
  const v = C.newCampaign(); v.cash = 5000; C.buyUpgrade(v, "pos");
  const vCash = v.cash;
  const vDark = C.settleDarkNight(v, Math.random);
  ok(vDark.upgFees === C.UPGRADES.pos.fee && Math.abs((vCash - v.cash) - ub.total) < 1e-9 && vDark.net === -ub.total,
    `and so does a closed one ($${vCash - v.cash} vs $${ub.total})`);
}

{
  // the count itself: below $0 at settlement is a missed night, three in a row
  // takes the lease, one night in the black clears it outright
  const c = C.newCampaign(); c.cash = 100;
  const zero = { total: 0, revenue: 0, tips: 0 };
  const n1 = C.settleNight(c, zero, Math.random);
  ok(c.cash < 0 && c.strikes === 1 && n1.lease.warned && n1.lease.left === 2 && !n1.lease.evicted, `first night in the red is a warning, not an eviction (${c.strikes})`);
  const n2 = C.settleNight(c, zero, Math.random);
  ok(c.strikes === 2 && n2.lease.warned && n2.lease.left === 1 && !n2.lease.evicted, "second is the last warning");
  const n3 = C.settleNight(c, zero, Math.random);
  ok(!!n3.lease.evicted && c.strikes === 0, "third takes the lease and resets the count");
  ok(C.LEASE_STRIKES === 3 && C.LEASE_FLOOR === 0, "three strikes, and the floor is the zero the HUD already turns red on");

  // a clean night clears the count rather than banking it
  const c2 = C.newCampaign(); c2.cash = 100;
  const bad = C.settleNight(c2, zero, Math.random);
  ok(c2.strikes === 1 && bad.lease.warned, "a strike is on the board");
  const good = C.settleNight(c2, { total: 5000, revenue: 5000, tips: 0 }, Math.random);
  ok(c2.cash > 0 && c2.strikes === 0 && good.lease.cleared && !good.lease.warned, "one night in the black wipes it");
  const quiet = C.settleNight(c2, { total: 5000, revenue: 5000, tips: 0 }, Math.random);
  ok(quiet.lease.cleared === false && quiet.lease.strikes === 0, "and a second good night has nothing to report");
}

{
  // a dark night counts too — bills land on a closed night and no revenue does,
  // which is the one way a venue move can bankrupt you mid-move
  const c = C.newCampaign(); c.cash = 5500; C.moveVenue(c);
  ok(c.venue === "fieldhouse" && c.darkNightsLeft === 1 && c.cash === 0, "moved in with nothing left");
  const dn = C.settleDarkNight(c, Math.random);
  ok(c.cash < 0 && c.strikes === 1 && dn.lease.warned, "the closed night's bill puts you in the red and on the board");
}

{
  // eviction is a demotion: locked #220
  const c = C.newCampaign(); c.cash = 999999;
  C.moveVenue(c); C.moveVenue(c); C.moveVenue(c);
  ok(c.venue === "flagship" && c.stats.bestTier === 3, "up the ladder to the flagship, and the high-water mark says so");
  C.buyUpgrade(c, "crafttaps"); C.buyUpgrade(c, "pos");
  c.darkNightsLeft = 0;
  const feesBefore = C.billsFor(c).upgFees;
  // three regulars over Midtown's cap of 7, so the demotion has somebody to lose
  while (c.regulars.length < C.regularCap(c)) if (!C.devAddRegular(c, Math.random)) break;
  const roster = c.regulars.length;
  const capBelow = 3 + 2 * 2;
  c.cash = -1;
  const ev = C.evictLease(c);
  ok(c.venue === "midtown" && ev.from === "flagship" && ev.to === "midtown", `the ladder walks one rung back (${c.venue})`);
  ok(c.darkNightsLeft >= 1, "with the smaller room's move-in nights to push through");
  ok(c.cash === C.RECOVERY_CASH, `the debt is written off against the deposit ($${c.cash})`);
  ok(c.strikes === 0 && c.stats.evictions === 1 && !c.failed, "the count resets, the eviction is on the record, and the run continues");
  // Midtown is a tier-2 room and the biggest gate on any upgrade is tier 1, so
  // nothing comes off the wall on this rung. The rung that does strip is below.
  ok(ev.stripped.length === 0 && C.billsFor(c).upgFees === feesBefore, "nothing comes off a wall Midtown still has");
  ok(c.stats.bestTier === 3 && C.runSummary(c).tier === "The Fourth Quarter", "the run still says how far it got, not where it ended up");
  ok(roster === 3 + 3 * 2 && roster > capBelow, `a full flagship roster to demote (${roster})`);
  ok(c.regulars.length === capBelow && ev.lost.length === roster - capBelow, `the regulars over Midtown's cap walk (${roster} → ${c.regulars.length})`);
  ok(ev.lost.every(n => c.regularsLost.some(x => x.name === n)), "and the door remembers every one of them");
}

{
  // the rung that strips: the Corner Tap is a tier-0 room, and the tap wall and
  // the premium screens are both gated at tier 1
  const c = C.newCampaign(); c.cash = 999999; C.moveVenue(c); c.darkNightsLeft = 0;
  C.buyUpgrade(c, "crafttaps"); C.buyUpgrade(c, "pos");
  const feesBefore = C.billsFor(c).upgFees;
  ok(feesBefore === C.UPGRADES.crafttaps.fee + C.UPGRADES.pos.fee, "the Fieldhouse carries both upkeeps");
  c.cash = -1;
  const ev = C.evictLease(c);
  ok(c.venue === "cornerTap" && !c.failed, "evicted out of the Fieldhouse and down to the Corner Tap, still playing");
  // the Corner Tap's own move-in count is 0, because nobody moves *into* the
  // room they started in. Being moved out of a bigger one is still a move.
  ok(C.VENUES.cornerTap.darkNights === 0 && c.darkNightsLeft === 1, `a move out costs a closed night even into the room with none of its own (${c.darkNightsLeft})`);
  ok(ev.stripped.includes("crafttaps") && !C.owned(c, "crafttaps"), "the tap wall comes off a wall that isn't there any more");
  ok(!ev.stripped.includes("pos") && C.owned(c, "pos"), "and the POS, which fits any room, stays installed");
  ok(C.billsFor(c).upgFees === C.UPGRADES.pos.fee && C.billsFor(c).upgFees < feesBefore, "so the nightly upkeep drops to what's left, which is half of what makes the smaller room survivable");
  ok(C.upgradeGate(c, "crafttaps") !== null, "and it is gated behind the Fieldhouse again, to be bought back with the room");
}

{
  // the bottom rung is the only dead end
  const c = C.newCampaign();
  ok(C.prevVenue(c) === null, "there is nothing below the Corner Tap");
  c.cash = -1;
  const ev = C.evictLease(c);
  ok(c.failed === true && ev.to === null && c.venue === "cornerTap", "an eviction from the Corner Tap ends the run and moves nobody");
  // and a failed run does not keep getting evicted
  const again = C.applyLease(c);
  ok(again.failed === true && !again.evicted && c.stats.evictions === 1, "a failed campaign is not evicted a second time");
}

{
  // the save append: additive, no key change, no version bump
  const old = C.newCampaign();
  old.cash = 5500; C.moveVenue(old); old.darkNightsLeft = 0;
  delete old.strikes; delete old.failed;
  delete old.stats.bestTier; delete old.stats.evictions;
  C.repairCampaign(old);
  ok(old.strikes === 0 && old.failed === false, "a save from before the lease loads at zero strikes and not failed");
  ok(old.stats.bestTier === 1 && old.stats.evictions === 0, "and its high-water tier is floored at the room it is actually in");
  ok(C.runSummary(old).tier === "The Fieldhouse", "so its run summary names that room rather than the Corner Tap");
  const junk = C.newCampaign();
  junk.strikes = "lots"; junk.failed = "yes"; junk.stats.evictions = NaN; junk.stats.bestTier = 99;
  C.repairCampaign(junk);
  ok(junk.strikes === 0, "a non-numeric strike count repairs to zero");
  ok(junk.failed === false, "and only a literal true is a failed run");
  ok(junk.stats.evictions === 0 && junk.stats.bestTier === 3, "NaN evictions repair to zero and a tier past the flagship clamps to it");
  const over = C.newCampaign(); over.strikes = 9; C.repairCampaign(over);
  ok(over.strikes === C.LEASE_STRIKES, "a strike count past the limit clamps to it rather than evicting on load");
  ok(C.SAVE_KEY === "fq3d-save" && C.SAVE_VERSION === 1, "no key change, no version bump: the two fields are additive and repair fills them");
  // and they survive a round trip through the slot
  const storage = {}; const stub = { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; }, removeItem: k => { delete storage[k]; } };
  const c = C.newCampaign(); c.cash = -1; C.settleNight(c, { total: 0, revenue: 0, tips: 0 }, Math.random);
  C.saveCampaign(c, stub);
  const back = C.loadCampaign(stub);
  ok(back.strikes === c.strikes && back.strikes > 0, "a strike count reloads at the number the night left it");
}

{
  // the run summary: the four numbers the ending screen asks for
  const c = C.newCampaign();
  C.settleNight(c, { total: 900, revenue: 800, tips: 100 }, Math.random);
  C.settleNight(c, { total: 400, revenue: 400, tips: 0 }, Math.random);
  const r = C.runSummary(c);
  ok(r.nights === 2 && r.nights === c.stats.nights, "nights survived is the campaign's own count");
  ok(r.bestNight === 900, "best night is the biggest take, not the last one");
  ok(r.lifetimeNet === c.stats.lifetimeNet, "lifetime net is the campaign's own running total");
  ok(r.tier === "The Corner Tap" && r.evictions === 0, "and a run that never moved says so");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
