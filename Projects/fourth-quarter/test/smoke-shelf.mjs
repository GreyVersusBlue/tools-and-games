// smoke-shelf.mjs — node test/smoke-shelf.mjs
//
// The dated shelf (#909): js/shelf.js's arithmetic, campaign.js's record of
// it, the inspector, the save, and what dates are worth over a seeded season.
// No DOM, no three.js.
//
// The claim that matters most is that a campaign with an undated shelf is the
// game as it was. Three things hold it: smoke-settle.mjs's pin and
// smoke-supply.mjs's SEASON_PIN are both unmoved with the `shelf` and
// `walkin` fields taken out, the lines under "an undated shelf" below ask
// every changed function for its old answer, and 120 seasons (four rooms,
// three houses, five seeds, with a rota and without) were compared tree
// against tree on 2026-10-06, rows and campaigns byte for byte.
//
// The second claim is that no night is charged twice: a close is the flat
// SPOILAGE_RATE or the dates, never both. The lines under "one rule or the
// other" hold that from both sides.

import * as SH from "../js/shelf.js";
import * as C from "../js/campaign.js";
import * as EV from "../js/events.js";
import { NightEngine, seed, mulberry32, MENU, FOOD } from "../js/engine.js";
import { runSeason, totals, seeded } from "./fixtures/season.mjs";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const clone = x => JSON.parse(JSON.stringify(x));
const J = JSON.stringify;
const near = (a, b, eps = 0.011) => Math.abs(a - b) < eps;

const dated = (lots = {}, walkin = false) => ({ dated: true, walkin, lots });
const BARE = { wings: 0, burger: 0, nachos: 0, fries: 0, beer: 0, soda: 0 };
const night = (extra = {}) => ({ total: 500, revenue: 450, tips: 50, served: 40, walkouts: 0, mood: 0.6, serviceRate: 80, ...extra });
/** A campaign on `day` with a known shelf, money in the till and nobody to
 *  be 86'd. Undated unless `dates`. */
function bar(day, stock = {}, dates = false) {
  const c = C.newCampaign();
  c.day = day; c.cash = 50000; c.stock = { ...BARE, ...stock }; c.regulars = [];
  if (dates) C.dateShelf(c);
  return c;
}
const close = (c, n = 1) => C.settleNight(c, night(), seeded(n, mulberry32));

// ---- the table ----
{
  ok(J(Object.keys(SH.SHELF)) === J(["wings", "burger", "nachos", "fries", "beer"]) && !("soda" in SH.SHELF), "five items carry a date and soda does not");
  ok(Object.keys(SH.SHELF).map(id => SH.SHELF[id].nights).join() === "3,4,5,7,14", "wings keep 3 nights, burgers 4, nachos 5, fries 7, a keg 14: the 2D build's table");
  ok(Object.keys(SH.SHELF).every(id => id in MENU) && Object.keys(SH.SHELF).filter(id => SH.SHELF[id].cold).join() === FOOD.join(), "what the walk-in holds is the menu's food, and beer is not");
  ok(SH.WALKIN.cost === 1000 && SH.WALKIN.fee === 18 && SH.WALKIN.nights === 2, "the walk-in is $1,000, $18 a night and two nights");
  ok(J(SH.newShelf()) === '{"dated":false,"walkin":false,"lots":{}}', "a new shelf is undated, with no walk-in and no lots");
  ok(!SH.isDated(SH.newShelf()) && !SH.isDated(null) && !SH.isDated({ dated: "yes" }) && !SH.isDated({ dated: 1 }) && SH.isDated(dated()), "only `true` is dated");
  ok(!SH.hasWalkin({ dated: false, walkin: true, lots: {} }) && !SH.hasWalkin(dated()) && SH.hasWalkin(dated({}, true)), "a walk-in is only on a dated shelf");
  ok(SH.walkinFee(SH.newShelf()) === 0 && SH.walkinFee(dated()) === 0 && SH.walkinFee(dated({}, true)) === 18 && SH.walkinFee({ dated: false, walkin: true }) === 0, "and only then is it billed");
}

// ---- how long a thing keeps ----
{
  ok(SH.keeps(dated(), "wings") === 3 && SH.keeps(dated({}, true), "wings") === 5 && SH.keeps(dated({}, true), "fries") === 9, "the walk-in adds two nights to food");
  ok(SH.keeps(dated(), "beer") === 14 && SH.keeps(dated({}, true), "beer") === 14, "and none to a keg");
  ok(SH.keeps(dated({}, true), "soda") === 0 && SH.keeps(dated(), "napkins") === 0, "soda, and anything the table has not heard of, never goes off");
  const lot = { day: 5, n: 10 };
  ok([5, 6, 7].map(d => SH.nightsLeft(dated(), "wings", lot, d)).join() === "3,2,1", "wings in on day 5 have three nights, the day they came in counted: 3, 2, 1");
  ok(SH.nightsLeft(dated(), "wings", lot, 8) === 1 && SH.nightsLeft(dated(), "wings", lot, 40) === 1, "a lot still here past its date is on its last night, not a negative one");
  ok(SH.nightsLeft(dated({}, true), "wings", lot, 7) === 3 && SH.nightsLeft(dated({}, true), "wings", lot, 9) === 1, "the same lot under a walk-in is on its last night two days later");
}

// ---- the lots and the count ----
{
  const none = SH.newShelf();
  ok(SH.reconcile(none, { wings: 50 }, 3) === none, "an undated shelf comes back untouched, the same record");
  const first = SH.date(SH.newShelf(), { wings: 24, burger: 0, nachos: 14, fries: 30, beer: 90, soda: 40 }, 4);
  ok(J(first) === J(dated({ wings: [{ day: 4, n: 24 }], nachos: [{ day: 4, n: 14 }], fries: [{ day: 4, n: 30 }], beer: [{ day: 4, n: 90 }] })),
    "dating a shelf dates what is on it that day: one lot an item, nothing for a bare line, nothing for soda, no walk-in");
  const two = dated({ wings: [{ day: 1, n: 10 }, { day: 2, n: 5 }] });
  const before = J(two);
  ok(J(SH.reconcile(two, { wings: 8 }, 3).lots.wings) === J([{ day: 1, n: 3 }, { day: 2, n: 5 }]), "seven sold come off the oldest lot: first in, first out");
  ok(J(SH.reconcile(two, { wings: 4 }, 3).lots.wings) === J([{ day: 2, n: 4 }]), "eleven sold empty the oldest and start on the next");
  ok(!("wings" in SH.reconcile(two, { wings: 0 }, 3).lots) && !("wings" in SH.reconcile(two, {}, 3).lots), "a line sold out, or missing from the count, keeps no lot");
  ok(J(SH.reconcile(two, { wings: 20 }, 3).lots.wings) === J([{ day: 1, n: 10 }, { day: 2, n: 5 }, { day: 3, n: 5 }]), "five the lots did not know about are a lot received today");
  ok(J(SH.reconcile(two, { wings: 20 }, 2).lots.wings) === J([{ day: 1, n: 10 }, { day: 2, n: 10 }]), "and join today's lot if there is one: one lot a day");
  ok(J(SH.reconcile(two, { wings: 15 }, 3)) === before && J(two) === before && SH.reconcile(two, { wings: 15 }, 3) !== two, "a count that agrees changes nothing, and the record handed in is never written to");
  const junk = dated({ wings: [{ day: 3, n: 4 }, null, { day: 1, n: 0 }, { day: 99, n: 2 }, { day: 2.4, n: 3 }, { day: 3, n: 1 }, { day: "x", n: 1 }, { day: 1, n: -5 }, { day: 1, n: NaN }], soda: [{ day: 1, n: 9 }], burger: "plenty" });
  const tidy = SH.reconcile(junk, { wings: 11, soda: 9, burger: 6 }, 5);
  ok(J(tidy.lots.wings) === J([{ day: 2, n: 3 }, { day: 3, n: 5 }, { day: 5, n: 3 }]), "junk lots: nothing, negatives and non-numbers dropped, a day rounded, the same day merged, a lot from the future or with no day dated today, oldest first");
  ok(!("soda" in tidy.lots) && J(tidy.lots.burger) === J([{ day: 5, n: 6 }]), "a lot for an item with no date is dropped, and a line that is not a list is counted afresh");
  ok(SH.reconcile(dated({}, true), {}, 1).walkin === true && SH.reconcile(dated({}, "yes"), {}, 1).walkin === false, "the walk-in rides through, and only `true` is one");
}

// ---- the close ----
{
  const none = SH.newShelf();
  const u = SH.spoil(none, 9);
  ok(u.shelf === none && J(u.byItem) === "{}", "an undated shelf is not this file's to rot: untouched, nothing lost");
  const sh = dated({ wings: [{ day: 5, n: 7 }, { day: 6, n: 6 }], fries: [{ day: 1, n: 9 }, { day: 2, n: 2 }], beer: [{ day: 1, n: 40 }] });
  const d6 = SH.spoil(sh, 6);
  ok(J(d6.byItem) === "{}" && J(d6.shelf) === J(sh), "the close of day 6: nothing is on its last night, nothing goes");
  const d7 = SH.spoil(sh, 7);
  ok(J(d7.byItem) === J({ wings: 7, fries: 9 }) && J(d7.shelf.lots) === J({ wings: [{ day: 6, n: 6 }], fries: [{ day: 2, n: 2 }], beer: [{ day: 1, n: 40 }] }),
    "the close of day 7: day 5's wings and day 1's fries go whole, and every younger lot stays whole");
  ok(J(SH.spoil(sh, 13).byItem.beer) === undefined && SH.spoil(sh, 14).byItem.beer === 40, "a keg in on day 1 is still good at the close of day 13 and gone at the close of day 14");
  const cold = SH.spoil({ ...sh, walkin: true }, 7);
  ok(J(cold.byItem) === "{}" && SH.spoil({ ...sh, walkin: true }, 9).byItem.wings === 7 && SH.spoil({ ...sh, walkin: true }, 9).byItem.fries === 9, "under a walk-in the same food goes two closes later");
  ok(SH.spoil({ ...sh, walkin: true }, 14).byItem.beer === 40 && cold.shelf.walkin === true, "the keg goes the same night either way, and the walk-in is still there after a close");
  ok(SH.spoil(dated({ wings: [{ day: 5, n: 7 }] }), 7).shelf.lots.wings === undefined, "an item whose last lot went keeps no line");
  ok(SH.spoil(sh, 8).byItem.wings === 13 && SH.spoil(sh, 8).byItem.fries === 11, "two lots of one item past their date at the same close are counted together");
  ok(SH.valueOf({ wings: 7, fries: 9 }, { wings: 3.2, fries: 1.2 }) === 33.2 && SH.valueOf({}, { wings: 3.2 }) === 0 && SH.valueOf({ wings: 3 }, { wings: 0.335 }) === 1.01, "what went is valued at a wholesale price a serving, to the cent");
}

// ---- what the panel and the inspector ask ----
{
  const sh = dated({ wings: [{ day: 5, n: 7 }, { day: 6, n: 6 }], beer: [{ day: 1, n: 40 }], fries: [{ day: 6, n: 20 }] });
  ok(SH.lastNight(sh, "wings", 7) === 7 && SH.lastNight(sh, "wings", 6) === 0 && SH.lastNight(sh, "wings", 8) === 13 && SH.lastNight(sh, "soda", 7) === 0, "servings on their last night: day 5's seven wings on day 7, both lots on day 8, never soda");
  ok(SH.lastNight({ ...sh, dated: false }, "wings", 7) === 0 && J(SH.lotsOf({ ...sh, dated: false }, "wings", 7)) === "[]", "and nothing on an undated shelf, which has no lots to show");
  ok(J(SH.lotsOf(sh, "wings", 7)) === J([{ day: 5, n: 7, left: 1 }, { day: 6, n: 6, left: 2 }]) && J(SH.lotsOf(sh, "nachos", 7)) === "[]", "the panel's lots: the day, the count and the nights left, oldest first");
  ok(SH.freshAtOpen(SH.newShelf(), 7) === null, "the inspector's sheet is null on an undated shelf");
  ok(J(SH.freshAtOpen(sh, 7)) === J({ wings: 6, burger: 0, nachos: 0, fries: 20 }), "on a dated one it is the food not on its last night, by item, and no line for beer");
  ok(SH.freshAtOpen({ ...sh, walkin: true }, 7).wings === 13, "a walk-in makes day 5's wings fresh again on day 7");
  ok(SH.install(SH.newShelf()) === null && SH.install(dated({}, true)) === null, "a walk-in cannot go on an undated shelf, or in twice");
  const inst = SH.install(sh);
  ok(inst.walkin === true && inst.dated === true && J(inst.lots) === J(sh.lots) && sh.walkin === false, "installed, the lots are the lots they were, and the old record is not written to");
}

// ---- an undated shelf: every changed function gives its old answer ----
{
  const c = bar(3, { wings: 24, burger: 16, nachos: 14, fries: 30, beer: 90, soda: 40 });
  ok(J(C.newCampaign().shelf) === J(SH.newShelf()) && !C.hasDates(c) && !C.hasWalkin(c), "a new campaign's shelf is undated");
  ok(C.walkinFee(c) === 0 && C.billsFor(c).walkin === 0 && C.billsFor(c).total === C.billsFor(c).wages + C.billsFor(c).rent, "nothing for a walk-in is on the bill");
  ok(J(C.lotsOf(c, "wings")) === "[]" && C.lastNight(c, "wings") === 0 && C.eventView(c).fresh === null, "it has no lots, nothing on a last night, and no sheet for the inspector");
  const cash = c.cash;
  const no = C.buyWalkin(c);
  ok(no.ok === false && /Date the shelf first/.test(no.err) && c.cash === cash && J(c.shelf) === J(SH.newShelf()), "a walk-in is refused on it, by name, and the till is not touched");
  C.placeOrder(c, { wings: 10, beer: 30 });
  ok(J(c.shelf) === J(SH.newShelf()) && c.stock.wings === 34 && c.stock.beer === 120, "an order goes on the count and writes no lot");
  const b = close(c);
  ok(J(b.spoilage) === J({ byItem: { wings: 5, burger: 2, nachos: 2, fries: 5 }, value: 34.6 }) && !("dated" in b.spoilage), "the close is the flat rate's: 15% of each food line, rounded, and the record says nothing of dates");
  ok(c.stock.wings === 29 && c.stock.beer === 120 && c.stock.soda === 40 && b.walkin === 0, "food rotted, drink did not, no walk-in was billed");
  for (let i = 0; i < 40; i++) { if (i % 5 === 0) C.placeOrder(c, { wings: 20, beer: 40 }); c.stock.beer = Math.max(0, c.stock.beer - 7); close(c, i + 2); }
  ok(J(c.shelf) === J(SH.newShelf()) && c.stock.beer === 120 + 8 * 40 - 40 * 7, "forty nights on: the shelf record is as it was made, and not a beer went off, 41 nights old or not");
}

// ---- dating it, and the lots in the books ----
{
  const c = bar(10, { wings: 4, fries: 12, beer: 30, soda: 40 });
  const stock = J(c.stock), cash = c.cash;
  ok(C.dateShelf(c).ok === true && C.hasDates(c) && J(c.stock) === stock && c.cash === cash, "dating the shelf is free and moves no stock");
  ok(C.dateShelf(c).ok === false && C.hasDates(c), "it is dated once; the second time is refused and the dates stay on");
  ok(J(c.shelf.lots) === J({ wings: [{ day: 10, n: 4 }], fries: [{ day: 10, n: 12 }], beer: [{ day: 10, n: 30 }] }), "what was on it is dated the day the labels went on");
  ok(C.keeps(c, "wings") === 3 && C.keeps(c, "beer") === 14 && C.keeps(c, "soda") === 0, "the campaign's word for how long a thing keeps is the table's");
  C.placeOrder(c, { wings: 6, burger: 8 });
  ok(J(c.shelf.lots.wings) === J([{ day: 10, n: 10 }]) && J(c.shelf.lots.burger) === J([{ day: 10, n: 8 }]) && c.stock.wings === 10, "an order the same day joins today's lot");
  c.stock.wings -= 3; // the engine's doing: three tickets fired
  ok(J(C.lotsOf(c, "wings")) === J([{ day: 10, n: 7, left: 3 }]) && J(c.shelf.lots.wings) === J([{ day: 10, n: 10 }]), "the panel reads the lots against the count without writing the record");
  const b10 = close(c);
  ok(J(b10.spoilage) === J({ byItem: {}, value: 0, dated: true }) && c.stock.wings === 7 && c.stock.fries === 12 && c.stock.burger === 8, "the night it is dated closes on the dates alone: nothing was on its last night, so nothing went, where the flat rate would have taken a wing, a burger and two fries");
  ok(J(c.shelf.lots.wings) === J([{ day: 10, n: 7 }]), "and the close wrote the night's sales into the lots");
  // day 11: a second delivery, then sales out of the oldest
  C.placeOrder(c, { wings: 6 });
  ok(J(c.shelf.lots.wings) === J([{ day: 10, n: 7 }, { day: 11, n: 6 }]), "a delivery on another day is another lot");
  ok(C.dateShelf(c).ok === false && J(c.shelf.lots.wings) === J([{ day: 10, n: 7 }, { day: 11, n: 6 }]), "asking to date a dated shelf again does not re-date what is on it");
  // a count that fell outside a night (the dev menu, a hand-edited save)
  const o = bar(10, { wings: 10 }, true); close(o);
  o.stock.wings -= 4; C.placeOrder(o, { wings: 6 });
  ok(J(o.shelf.lots.wings) === J([{ day: 10, n: 6 }, { day: 11, n: 6 }]), "an order reads the count before the delivery as well as after: four that went missing came off the old lot, and all six delivered are today's");
  c.stock.wings -= 2;
  ok(C.lastNight(c, "wings") === 0, "nothing is on its last night on day 11");
  close(c);
  ok(J(c.shelf.lots.wings) === J([{ day: 10, n: 5 }, { day: 11, n: 6 }]) && c.stock.wings === 11, "two sold on day 11 came off day 10's lot, and nothing went at the close");
  // day 12: the old lot's last night
  ok(c.day === 12 && C.lastNight(c, "wings") === 5 && J(C.lotsOf(c, "wings").map(l => l.left)) === "[1,2]", "on day 12 the five left from day 10 are on their last night");
  c.stock.wings -= 1;
  const b12 = close(c);
  ok(J(b12.spoilage) === J({ byItem: { wings: 4 }, value: 12.8, dated: true }), "the close of day 12 takes what is left of day 10's wings, four, at $3.20: all of that lot and none of day 11's");
  ok(c.stock.wings === 6 && J(c.shelf.lots.wings) === J([{ day: 11, n: 6 }]) && c.stock.burger === 8 && c.stock.fries === 12, "the count is down by what went, and the burgers and fries, with nights left, are whole");
  const b13 = close(c);
  ok(J(b13.spoilage.byItem) === J({ wings: 6, burger: 8 }) && b13.spoilage.value === 6 * 3.2 + 8 * 3.8 && c.stock.wings === 0 && !("wings" in c.shelf.lots), "the close of day 13 takes day 11's wings and day 10's burgers, on their third and fourth nights");
  for (let d = 14; d <= 15; d++) close(c);
  ok(c.stock.fries === 12, "fries in on day 10 are whole after the close of day 15");
  ok(close(c).spoilage.byItem.fries === 12 && c.stock.fries === 0, "and gone at the close of day 16, their seventh night");
  for (let d = 17; d <= 22; d++) close(c);
  ok(c.stock.beer === 30 && c.day === 23, "a keg in on day 10 is whole on the morning of day 23");
  const keg = close(c);
  ok(J(keg.spoilage) === J({ byItem: { beer: 30 }, value: 55.5, dated: true }) && c.stock.beer === 0 && c.stock.soda === 40, "and flat at the close of day 23, its fourteenth night: a dated shelf dates the beer, which the flat rate never touched; the soda is 14 nights old and all there");
}

// ---- one rule or the other, never both ----
{
  const stock = { wings: 40, burger: 40, nachos: 40, fries: 40, beer: 40, soda: 40 };
  const flat = bar(20, stock), dates = bar(20, stock, true);
  const bf = close(flat), bd = close(dates);
  ok(J(bf.spoilage.byItem) === J({ wings: 6, burger: 6, nachos: 6, fries: 6 }) && J(bd.spoilage.byItem) === "{}", "the same shelf, the same night: undated loses 15% of each food line, dated loses nothing on its first night");
  ok(J(flat.stock) === J({ wings: 34, burger: 34, nachos: 34, fries: 34, beer: 40, soda: 40 }) && J(dates.stock) === J(stock), "and the dated count is untouched: the flat rate did not also run");
  close(flat); close(dates);
  const f3 = close(flat), d3 = close(dates);
  ok(J(d3.spoilage.byItem) === J({ wings: 40 }) && dates.stock.wings === 0 && dates.stock.burger === 40, "the third close takes every dated wing and not one burger: all of a lot or none of it, never a seventh");
  ok(J(f3.spoilage.byItem) === J({ wings: 4, burger: 4, nachos: 4, fries: 4 }) && flat.stock.wings === 25 && J(flat.shelf) === J(SH.newShelf()), "while the undated shelf goes on losing a seventh of everything and never loses a lot");
  // nothing but the shelf differs between the two campaigns
  const strip = x => { const { stock: s, shelf, cash, ...rest } = clone(x); return rest; };
  const a = bar(30, stock), b = bar(30, stock);
  b.league = clone(a.league); b.applicants = clone(a.applicants); b.staff = clone(a.staff);
  C.dateShelf(b);
  const ra = C.settleNight(a, night(), seeded(77, mulberry32)), rb = C.settleNight(b, night(), seeded(77, mulberry32));
  ok(J(strip(a)) === J(strip(b)) && J(a.applicants) === J(b.applicants) && ra.net === rb.net, "dating the shelf moves nothing else at a close: the same applicants off the same draws, the same people, the same net");
  // a dark night ages a lot like any other
  const dk = bar(20, { wings: 10 }, true); dk.darkNightsLeft = 3;
  const d1 = C.settleDarkNight(dk, seeded(1, mulberry32)), d2 = C.settleDarkNight(dk, seeded(1, mulberry32)), d3k = C.settleDarkNight(dk, seeded(1, mulberry32));
  ok(J(d1.spoilage.byItem) === "{}" && J(d2.spoilage.byItem) === "{}" && d3k.spoilage.byItem.wings === 10 && d3k.spoilage.dated === true, "a dark night is a night on the date: wings in before a three-night move are gone at its third close");
  // a count the lots never saw: a card's gift, a dev fill
  const g = bar(40, { wings: 5 }, true);
  close(g); g.stock.wings += 9; g.stock.beer += 50;
  ok(J(C.lotsOf(g, "wings")) === J([{ day: 40, n: 5, left: 2 }, { day: 41, n: 9, left: 3 }]) && J(C.lotsOf(g, "beer")) === J([{ day: 41, n: 50, left: 14 }]), "servings that turn up outside an order are a lot dated the day they are first seen");
  // and a cut: the Truck Breaks Down card takes 30% of a line
  // The lots are read against the count, so between two readings they see
  // only the difference: nine in and five out is four in. No card gives stock
  // today; one that did, on a night that also sold, would have its gift
  // counted as sold first.
  g.stock.wings -= 5;
  ok(J(C.lotsOf(g, "wings")) === J([{ day: 40, n: 5, left: 2 }, { day: 41, n: 4, left: 3 }]), "nine turning up and five going between two readings is four turning up: the lots see the difference, not the order");
  // and a cut on its own: the Truck Breaks Down card takes 30% of a line
  const t = bar(40, { wings: 10 }, true);
  close(t); C.placeOrder(t, { wings: 10 }); t.stock.wings -= 6;
  ok(J(C.lotsOf(t, "wings")) === J([{ day: 40, n: 4, left: 2 }, { day: 41, n: 10, left: 3 }]), "a card's cut comes off the oldest lot, as a sale does");
  // the lots are the count, whatever a season does to it
  const r = seeded(909, mulberry32);
  const w = bar(1, { wings: 10, beer: 20 }, true);
  let agree = true, went = 0;
  for (let i = 0; i < 300; i++) {
    if (r() < 0.6) C.placeOrder(w, { wings: Math.floor(r() * 30), burger: Math.floor(r() * 20), fries: Math.floor(r() * 40), beer: Math.floor(r() * 80), soda: Math.floor(r() * 20) });
    for (const id in w.stock) w.stock[id] = Math.max(0, w.stock[id] - Math.floor(r() * 25));
    if (r() < 0.1) w.stock.nachos += Math.floor(r() * 12);
    const bk = r() < 0.15 ? C.settleDarkNight(w, r) : C.settleNight(w, night(), r);
    went += Object.values(bk.spoilage.byItem).reduce((x, y) => x + y, 0);
    for (const id in SH.SHELF) {
      const sum = (w.shelf.lots[id] || []).reduce((x, l) => x + l.n, 0);
      if (sum !== w.stock[id] || (w.shelf.lots[id] || []).some(l => l.day >= w.day || l.day + SH.keeps(w.shelf, id) <= w.day || !(l.n > 0))) agree = false;
    }
  }
  ok(agree && went > 500, `300 nights of orders, sales, gifts and dark nights: after every close the lots add up to the count, and no lot is from the future, past its date or empty (${went} servings went)`);
}

// ---- the walk-in in the books ----
{
  const poor = bar(5, { wings: 10 }, true); poor.cash = 999;
  ok(C.buyWalkin(poor).ok === false && poor.cash === 999 && !C.hasWalkin(poor), "a walk-in with $999 in the till is refused");
  const c = bar(5, { wings: 10, fries: 10, beer: 10 }, true); c.cash = 1000;
  const lots = J(c.shelf.lots);
  ok(C.buyWalkin(c).ok === true && c.cash === 0 && C.hasWalkin(c) && J(c.shelf.lots) === lots, "with $1,000 it goes in, the till is empty, and the lots are the lots they were");
  c.cash = 5000;
  ok(C.buyWalkin(c).ok === false && c.cash === 5000 && C.hasWalkin(c), "it goes in once, however much is in the till");
  c.cash = 0;
  ok(Object.keys(C.UPGRADES).length === 5 && !("walkin" in C.UPGRADES) && C.upgradeFees(c) === 0 && !c.upgrades.includes("walkin"), "it is not one of the five upgrades and their upkeep does not count it");
  const bill = C.billsFor(c);
  ok(C.walkinFee(c) === 18 && bill.walkin === 18 && bill.total === bill.wages + bill.rent + 18, "its $18 is on tonight's bill, on a line of its own");
  ok(C.keeps(c, "wings") === 5 && C.keeps(c, "beer") === 14 && J(C.lotsOf(c, "wings")) === J([{ day: 5, n: 10, left: 5 }]), "the wings already on the shelf keep five nights now");
  c.cash = 5000;
  const b = close(c);
  ok(b.walkin === 18 && b.net === 500 - bill.total && c.cash === 5000 + 500 - bill.total, "an open night pays it");
  c.darkNightsLeft = 1;
  const cash = c.cash, db = C.settleDarkNight(c, seeded(3, mulberry32));
  ok(db.walkin === 18 && c.cash === cash - C.billsFor({ ...c, day: c.day - 1 }).total && db.net === -(db.wages + db.rent + 18), "and so does a dark one: the compressor runs with the doors shut");
  close(c);
  ok(c.day === 8 && c.stock.wings === 10, "wings in on day 5 are whole on the morning of day 8, where a shelf without it lost them at the close of day 7");
  close(c);
  ok(close(c).spoilage.byItem.wings === 10 && c.day === 10, "they go at the close of day 9, their fifth night");
  // it stays through an eviction: tier 0 gear, like the three upgrades that are
  const e = bar(5, {}, true); C.devWarpVenue(e, "fieldhouse"); C.buyWalkin(e); e.upgrades = ["crafttaps", "pos"];
  const ev = C.evictLease(e);
  ok(e.venue === "cornerTap" && J(ev.stripped) === J(["crafttaps"]) && C.hasWalkin(e) && C.walkinFee(e) === 18, "an eviction takes the gear the smaller room has no wall for, and the walk-in is not that");
}

// ---- the inspector ----
{
  const view = (stock, fresh, crowdTarget = 40) => ({ stock, fresh, crowdTarget });
  const lots = { wings: 30, burger: 30, nachos: 30, fries: 30 };
  ok(EV.inspectorRisky(view(lots, null)) === true && EV.inspectorRisky(view(lots, undefined)) === true && EV.inspectorRisky(view({ wings: 25, burger: 25, nachos: 25, fries: 25 }, null)) === false, "undated, the inspector still counts the shelf against the crowd: 120 servings for 40 heads fails and 100 passes");
  ok(EV.inspectorRisky(view(lots, { wings: 30, burger: 30, nachos: 30, fries: 30 })) === false, "dated, the same 120 servings pass: every one has nights left, and the overstock rule is not also applied");
  ok(EV.inspectorRisky(view({ ...BARE, wings: 6 }, { wings: 5, burger: 0, nachos: 0, fries: 0 })) === true, "dated, one wing on its last night fails a shelf that is nearly bare");
  ok(EV.inspectorRisky(view({ ...BARE, wings: 5 }, { wings: 5, burger: 0, nachos: 0, fries: 0 })) === false, "and the same shelf passes once that wing is sold: the oldest goes first");
  ok(EV.inspectorRisky(view({ ...BARE, beer: 90 }, { wings: 0, burger: 0, nachos: 0, fries: 0 })) === false, "a keg on its last night is not the inspector's business");
  const c = bar(10, { wings: 5 }, true);
  close(c); close(c); C.placeOrder(c, { wings: 10, fries: 20 });
  ok(c.day === 12 && J(C.eventView(c).fresh) === J({ wings: 10, burger: 0, nachos: 0, fries: 20 }), "the books hand the cards the sheet: on day 12, day 10's five wings are not on it");
  const card = EV.EVENTS.find(e => e.id === "inspect").choices[0];
  const at = stock => card.resolve({ ...C.eventView(c), stock, crowdTarget: 40 }, () => 0).line;
  ok(/flags aging stock/.test(at(c.stock)) && /Spotless/.test(at({ ...c.stock, wings: 10 })), "and the card reads it: fined with the five still on the shelf, spotless once they are sold");
}

// ---- the save ----
{
  const mkStore = (seedData = {}) => ({ d: { ...seedData }, setItem(k, v) { this.d[k] = String(v); }, getItem(k) { return this.d[k] ?? null; }, removeItem(k) { delete this.d[k]; } });
  const raw = (c, v, extra = {}) => { const o = { ...clone(c), ...extra }; if (v === null) delete o.__v; else o.__v = v; return J(o); };
  ok(C.SAVE_KEY === "fq3d-save" && C.SAVE_VERSION === 4, "the key is the key it always was (#36); the version is 4");
  const base = C.newCampaign(); base.day = 23; base.cash = 4321.5;
  const bare = clone(base); delete bare.shelf;
  const stray = { dated: true, walkin: true, lots: { wings: [{ day: 20, n: 24 }] } };

  for (const [v, word] of [[3, "version 3"], [2, "version 2"], [1, "version 1"], [null, "no version at all"]]) {
    const c = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, v) }));
    ok(c && J(c.shelf) === J(SH.newShelf()) && c.day === 23 && c.cash === 4321.5 && J(c.stock) === J(base.stock), `a save with ${word} loads with an undated shelf and the stock it had`);
    ok(c && C.billsFor(c).walkin === 0 && J(clone(c).stock) && J(C.applySpoilage(clone(c)).byItem) === J({ wings: 4, burger: 2, nachos: 2, fries: 5 }), "and it rots as it did");
    // migrate, not repair: dates in a file from before there were dates are nobody's decision
    const s = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, v, { shelf: stray }) }));
    ok(s && J(s.shelf) === J(SH.newShelf()), `migrate: a file with ${word} carrying a dated shelf and a walk-in has neither (no build before version 4 wrote one)`);
  }
  const kept = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 4, { shelf: stray }) }));
  ok(kept && kept.shelf.dated === true && kept.shelf.walkin === true && J(kept.shelf.lots.wings) === J([{ day: 20, n: 24 }]), "the same record in a version-4 file is kept: that one this build wrote");
  ok(C.migrateCampaign({ shelf: clone(stray) }, 4).shelf.dated === true && C.migrateCampaign({ shelf: clone(stray) }, 3).shelf.dated === false, "the step is for files from before version 4 only");
  ok(C.migrateCampaign({ shelf: clone(stray), crew: { rota: true, book: {} }, dist: { id: "cask", spend: 5 } }, 3).crew.rota === true, "and a version-3 file keeps the rota it posted: the older steps do not run again");

  const rep = shelf => C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 4, shelf === undefined ? {} : { shelf }) })).shelf;
  ok([undefined, null, 7, "dated", [], { dated: "yes" }, { dated: 1, lots: {} }, { walkin: true, lots: stray.lots }, { dated: false, walkin: true, lots: stray.lots }].every(x => J(rep(x)) === J(SH.newShelf())),
    "repair: no record, or one whose `dated` is not `true`, is an undated shelf with no walk-in and no lots");
  const today = { wings: [{ day: 23, n: 24 }], burger: [{ day: 23, n: 16 }], nachos: [{ day: 23, n: 14 }], fries: [{ day: 23, n: 30 }], beer: [{ day: 23, n: 90 }] };
  ok(J(rep({ dated: true })) === J(dated(today)) && J(rep({ dated: true, lots: "all of it", walkin: "yes" })) === J(dated(today)), "a dated shelf with no lots, or lots that are not a record, has everything on the count dated today");
  const messy = rep({ dated: true, walkin: true, lots: { wings: [{ day: 20, n: 30 }, { day: 22, n: 10 }], burger: [{ day: 21, n: 6 }, { day: 99, n: 4 }], soda: [{ day: 1, n: 40 }], fries: [null, { day: 22.4, n: "x" }] } });
  ok(J(messy.lots.wings) === J([{ day: 20, n: 14 }, { day: 22, n: 10 }]), "lots that add up to more than the count lose the difference oldest first: 40 wings on paper, 24 on the shelf");
  ok(J(messy.lots.burger) === J([{ day: 21, n: 6 }, { day: 23, n: 10 }]) && J(messy.lots.fries) === J([{ day: 23, n: 30 }]) && !("soda" in messy.lots) && messy.walkin === true, "lots that add up to less are topped up with a lot dated today; a lot from the future is today's; soda keeps none; the walk-in stays");
  const once = C.repairCampaign({ ...clone(bare), shelf: { dated: true, lots: { wings: [{ day: 30, n: 3.5 }, { day: 2, n: 9 }] } } });
  const twice = C.repairCampaign(clone(once));
  ok(J(once.shelf) === J(twice.shelf) && J(once.shelf.lots.wings) === J([{ day: 2, n: 9 }, { day: 23, n: 15 }]), "repair is idempotent over it");

  const store = mkStore();
  const live = bar(9, { wings: 8, beer: 60 }, true); C.buyWalkin(live); close(live); C.placeOrder(live, { wings: 12 });
  C.saveCampaign(live, store);
  const back = C.loadCampaign(store);
  ok(JSON.parse(store.getItem(C.SAVE_KEY)).__v === 4 && J(back.shelf) === J(live.shelf) && J(back.shelf.lots.wings) === J([{ day: 9, n: 8 }, { day: 10, n: 12 }]) && back.shelf.walkin === true && J(C.lotsOf(back, "wings")) === J(C.lotsOf(live, "wings")), "a save written now round-trips the dates, the walk-in and every lot");
  const slot = C.campaignSlot(store);
  const env = JSON.parse(slot.serialize(back));
  ok(env.version === 4 && env.state.shelf.dated === true && slot.deserialize(J({ ...env, version: 3 })).shelf.dated === false, "the export file carries it at version 4, and a version-3 file that claims a dated shelf imports without one");
}

// ---- a season, on the dates and off them ----
// One seed, 98 nights, the bot in fixtures/season.mjs. It stocks to a par off
// the forecast every morning and sells nearly all of it, so it is the careful
// shelf; `par: 3` is the same bot buying three times the food it needs, which
// is the stockpile. What is read off it is the difference between the two
// rules, which is shelf.js's doing and nothing else's.
{
  const mods = { C, NightEngine, seed, mulberry32 };
  const lost = run => run.rows.reduce((m, x) => { for (const k in x.lost || {}) m[k] = (m[k] || 0) + x.lost[k]; return m; }, {});
  const flat = runSeason(mods, { seed: 1 }), dates = runSeason(mods, { seed: 1, dates: true });
  const tf = totals(flat), td = totals(dates);
  if (process.argv.includes("--numbers")) console.log(J({ tf, td, lost: lost(dates), paid: [tf.paid, td.paid], take: [tf.take, td.take] }));
  ok(tf.nights === 98 && td.nights === 98 && tf.evictions + td.evictions === 0 && flat.rows.every(r => !("lost" in r)) && dates.rows.every(r => "lost" in r), "both ran the whole season, one on the flat rate and one on the dates every night");
  ok(dates.rows.every((r, i) => r.served === flat.rows[i].served && r.take === flat.rows[i].take), "the dates change nothing about a night: the same plates and the same take, 98 times");
  ok(tf.spoiled === 722.7 && td.spoiled === 32 && J(lost(dates)) === J({ wings: 10 }), `a careful shelf: the flat rate rotted $${tf.spoiled} of food over the season, the dates took ten wings ($${td.spoiled})`);
  ok(td.cash === 35987.95 && tf.cash === 35314.25 && near(td.cash - tf.cash, tf.paid - td.paid), `and the season's difference is exactly the stock it did not have to buy again: $${Math.round((td.cash - tf.cash) * 100) / 100}`);
  ok(dates.c.stock.beer > 0 && dates.rows.every(r => !r.lost.beer), "not a keg went flat: the bot's beer turns over in a night");

  // the stockpile
  const flat3 = totals(runSeason(mods, { seed: 1, par: 3 })), run3 = runSeason(mods, { seed: 1, par: 3, dates: true }), dates3 = totals(run3);
  if (process.argv.includes("--numbers")) console.log(J({ flat3: [flat3.cash, flat3.spoiled], dates3: [dates3.cash, dates3.spoiled], lost: lost(run3) }));
  ok(flat3.spoiled === 5032.3 && dates3.spoiled === 3439.7 && J(lost(run3)) === J({ wings: 612, burger: 278, nachos: 169, fries: 2 }), `buying three times the food: the flat rate rots $${flat3.spoiled}, the dates $${dates3.spoiled}, and it is the short-dated wings that go (612 of them) and hardly a fry`);
  ok(dates3.cash < td.cash - 3000 && dates3.cash > flat3.cash, `dated, the stockpile costs $${Math.round(td.cash - dates3.cash)} a season against the careful shelf, and still beats the flat rate by $${Math.round(dates3.cash - flat3.cash)}`);

  // the walk-in, at the flagship where the bot can afford it on day one
  const big = { seed: 1, venue: "flagship", cash: 4000 };
  const fd = totals(runSeason(mods, { ...big, dates: true })), fw = runSeason(mods, { ...big, dates: true, walkin: true }), tw = totals(fw);
  ok(fw.c.shelf.walkin === true && fd.spoiled === 0 && tw.spoiled === 0 && near(fd.cash - tw.cash, 1000 + 98 * 18), `on a shelf that turns over the walk-in buys nothing: nothing went either way, and it cost its $1,000 and 98 nights at $18 ($${Math.round(fd.cash - tw.cash)})`);
  const fd3 = totals(runSeason(mods, { ...big, par: 3, dates: true })), tw3 = totals(runSeason(mods, { ...big, par: 3, dates: true, walkin: true }));
  if (process.argv.includes("--numbers")) console.log(J({ fd: fd.cash, fw: tw.cash, fd3: [fd3.cash, fd3.spoiled], fw3: [tw3.cash, tw3.spoiled] }));
  ok(fd3.spoiled === 4971 && tw3.spoiled === 977.6 && tw3.cash > fd3.cash, `under a stockpile it pays: $${fd3.spoiled} of food gone without it, $${tw3.spoiled} with, and $${Math.round(tw3.cash - fd3.cash)} ahead after its install and its power`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
