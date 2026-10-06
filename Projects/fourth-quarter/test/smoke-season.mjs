// smoke-season.mjs — node test/smoke-season.mjs
//
// Season terms (#911): js/season.js's arithmetic, campaign.js's record of it,
// how it meets the rota, the supply house and the dated shelf, the save, and
// what signing is worth over one, two and three seeded seasons. No DOM, no
// three.js.
//
// The claim that matters most is that a month-to-month campaign is the game
// as it was. Three things hold it: smoke-settle.mjs's PIN and
// smoke-supply.mjs's SEASON_PIN are both unmoved with the `terms` field
// taken out, the lines under "month to month" ask every changed function for
// its old answer on every night of five seasons, and 180 seeded seasons (four
// rooms, three houses, five seeds; plain, on a rota and on a dated shelf)
// hashed the same on the tree before this file and the tree after it, at 98
// nights and again at 300, on 2026-10-06.

import * as SN from "../js/season.js";
import * as C from "../js/campaign.js";
import * as L from "../js/league.js";
import { NightEngine, seed, mulberry32, MENU } from "../js/engine.js";
import { runSeason, totals, seeded } from "./fixtures/season.mjs";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const clone = x => JSON.parse(JSON.stringify(x));
const J = JSON.stringify;

const ANN = "Ann Example", BO = "Bo Sample", CY = "Cy Placeholder";
const signed = (since = 1) => ({ signed: true, since });
const MTM = SN.newTerms();
const night = (extra = {}) => ({ total: 500, revenue: 450, tips: 50, served: 40, walkouts: 0, mood: 0.6, serviceRate: 80, ...extra });
/** A campaign on `day` with a known payroll, money in the till and nobody to
 *  be 86'd. Month to month unless `terms`. */
function bar(day, terms = false) {
  const c = C.newCampaign();
  C.devSetDay(c, day);
  c.cash = 50000; c.regulars = [];
  c.staff = [C.mkStaff("cook", 2, 70, ANN), C.mkStaff("server", 2, 60, BO)];
  if (terms) C.signTerms(c);
  return c;
}
const close = (c, n = 1) => C.settleNight(c, night(), seeded(n, mulberry32));
/** Day `d` of season `s`, 1-based: day(2, 1) is the night season 2 opens. */
const day = (s, d) => (s - 1) * 126 + d;
const ROOMS = C.VENUE_ORDER.map(id => C.VENUES[id].rent);

// ---- the table, and the calendar it reads ----
{
  ok(SN.SIGN_BREAK === 10 && SN.RENT_STEP === 10 && SN.RENT_CAP === 60, "rent is 10 points under in the season it is signed, then 10 a season to 60 over: the 2D build's creep behind a break");
  ok(SN.WAGE_STEP === 6 && SN.WAGE_CAP === 40, "wages go 6 points a season to 40 over: the 2D build's");
  ok(SN.OFF_RENT === 75 && SN.NOTICE === 7, "the off-season is three quarters of the season's rent, and a change is a week's notice");
  ok(J(SN.newTerms()) === '{"signed":false,"since":0}', "new terms are month to month");
  ok(!SN.onTerms(MTM) && !SN.onTerms(null) && !SN.onTerms({ signed: "yes", since: 1 }) && !SN.onTerms({ signed: 1, since: 1 }) && SN.onTerms(signed()), "only `true` is signed");
  ok(L.SEASON_DAYS === 126 && L.SEASON_WEEKS * 7 === 112, "a season is the league's 126 nights, 112 of them before the off-season");
  ok(SN.offStart(1) === 113 && SN.offStart(112) === 113 && SN.offStart(126) === 113 && SN.offStart(127) === 239, "the off-season starts on night 113 of its season, asked from any night in it");
  ok(SN.nextOpen(1) === 127 && SN.nextOpen(126) === 127 && SN.nextOpen(127) === 253, "and the next season opens on night 127");
  ok([1, 113, 127, 239].every(d => L.phaseOf(SN.offStart(d)) === "offseason" && L.phaseOf(SN.offStart(d) - 1) === "playoffs" && L.seasonOf(SN.nextOpen(d)) === L.seasonOf(d) + 1 && L.seasonOf(SN.nextOpen(d) - 1) === L.seasonOf(d)),
    "both dates are the league's own: the night before the off-season is a bracket night, and the night before the open is last season");
}

// ---- month to month: every changed function gives its old answer ----
{
  const days = Array.from({ length: 630 }, (_, i) => i + 1);
  ok(days.every(d => ROOMS.every(r => SN.rentFor(MTM, r, d) === r)), "month to month the rent is the room's number on every night of five seasons, off-season included");
  ok(days.every(d => SN.wagePct(MTM, d) === 100 && SN.wageMult(MTM, d) === 1 && SN.wageFor(MTM, 73, d) === 73), "and a wage is the staffer's own");
  ok(days.every(d => SN.seasonsIn(MTM, d) === 0 && SN.outlook(MTM, 110, d) === null && SN.notice(MTM, 110, d) === null), "nothing is counted, nothing is coming and nothing is announced");
  ok(SN.rentFor(null, 110, 300) === 110 && SN.rentFor({ signed: "yes", since: 1 }, 110, 300) === 110 && SN.wageMult(undefined, 300) === 1, "a record that is not signed terms is month to month");
  const c = bar(1);
  ok(!C.onTerms(c) && J(c.terms) === J(MTM), "a new campaign is month to month");
  let same = true;
  for (const v of C.VENUE_ORDER) for (const up of [[], ["training"]]) for (const d of [1, 50, 113, 126, 127, 400, 900]) {
    const x = bar(d); C.devWarpVenue(x, v); x.upgrades = up;
    const old = s => Math.round(s.wage * (up.length ? 1.15 : 1));
    same &&= C.rent(x) === C.VENUES[v].rent && x.staff.every(s => C.effWage(x, s) === old(s)) && C.wageBill(x) === x.staff.reduce((a, s) => a + old(s), 0)
      && C.billsFor(x).rent === C.VENUES[v].rent && C.rentAt(x, v) === C.VENUES[v].rent && C.termsWage(x, 73) === 73 && C.termsOutlook(x) === null && C.termsNotice(x) === null;
  }
  ok(same, "rent(), effWage(), wageBill() and billsFor() answer as they did, in every room, with Staff Training and without, in season 1 and in season 8");
  const b = close(bar(113));
  ok(b.rent === 110 && b.wages === 130, "and an off-season night month to month is billed the room's rent and the two wages");
}

// ---- signing ----
{
  ok(J(SN.sign(MTM, 1)) === '{"signed":true,"since":1}' && J(SN.sign(MTM, 126)) === J(signed(1)) && J(SN.sign(MTM, 127)) === J(signed(2)) && J(SN.sign(MTM, 300)) === J(signed(3)), "signing records the season it was signed in");
  ok(SN.sign(signed(1), 300) === null && SN.sign(signed(2), 1) === null, "signed terms cannot be signed again: there is no second break");
  const m = Object.keys(SN).join();
  ok(!/unsign|cancel|leave|tear|end/i.test(m), "and nothing in the module takes them back");
  const c = bar(140);
  const r = C.signTerms(c);
  ok(r.ok && C.onTerms(c) && J(c.terms) === J(signed(2)) && c.cash === 50000, "the campaign signs in its own season, for nothing");
  const again = C.signTerms(c);
  ok(!again.ok && typeof again.err === "string" && J(c.terms) === J(signed(2)), "and is refused the second time, with the record unmoved");
}

// ---- rent, by the season and the phase ----
{
  const pct = n => SN.rentFor(signed(1), 100, day(n + 1, 1));
  ok([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(pct).join() === "90,100,110,120,130,140,150,160,160,160", "on a $100 room: $90 the season it is signed, the room's own number the next, then $10 a season to $160 and no further");
  ok(ROOMS.map(r => SN.rentFor(signed(1), r, 1)).join() === "99,144,189,234", "the four rooms in the signing season: $99, $144, $189, $234 against $110, $160, $210, $260");
  ok(ROOMS.map(r => SN.rentFor(signed(1), r, day(3, 1))).join() === "121,176,231,286", "and two seasons on: $121, $176, $231, $286");
  ok(SN.rentFor(signed(1), 110, 98) === 99 && SN.rentFor(signed(1), 110, 99) === 99 && SN.rentFor(signed(1), 110, 112) === 99, "the bracket's rent is the regular season's");
  ok(SN.rentFor(signed(1), 110, 113) === 74 && SN.rentFor(signed(1), 110, 126) === 74 && SN.rentFor(signed(1), 110, 127) === 110, "the off-season fortnight is three quarters of it ($74 for $99), and the next season opens at the room's own $110");
  ok(SN.rentFor(signed(1), 110, day(2, 113)) === 83 && SN.rentFor(signed(1), 260, day(9, 113)) === 312, "the off-season break is on the season's rent, whatever that has crept to: $83 in season 2, $312 for a flagship at the cap");
  ok(SN.rentFor(signed(3), 110, day(3, 1)) === 99 && SN.rentFor(signed(3), 110, day(4, 1)) === 110 && SN.seasonsIn(signed(3), day(3, 60)) === 0 && SN.seasonsIn(signed(3), day(5, 1)) === 2, "seasons are counted from the one the terms were signed in: signed in season 3, the break is season 3's");
  ok(SN.seasonsIn(signed(3), 1) === 0 && SN.rentFor(signed(3), 110, 1) === 99, "a calendar walked back before the signing reads as the signing season, never a negative one");
  const c = bar(1, true);
  ok(C.rent(c) === 99 && C.billsFor(c).rent === 99 && C.rentAt(c, "fieldhouse") === 144 && C.rentAt(c, "cornerTap") === 99, "the campaign's rent is the room's on the terms, and so is the next room's on the Real Estate card");
  C.devWarpVenue(c, "midtown");
  ok(C.rent(c) === 189 && J(c.terms) === J(signed(1)), "the terms follow the bar up the ladder: Midtown's $210 is $189");
  const e = bar(day(3, 5), false); C.devWarpVenue(e, "fieldhouse"); e.terms = signed(1);
  C.evictLease(e);
  ok(e.venue === "cornerTap" && J(e.terms) === J(signed(1)) && C.rent(e) === 121, "and down it: an eviction keeps the season count, so the smaller room is $121 in the third season");
}

// ---- wages, and the rota ----
{
  const pct = n => SN.wagePct(signed(1), day(n + 1, 1));
  ok([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(pct).join() === "100,106,112,118,124,130,136,140,140,140", "a wage is the staffer's own the season it is signed, then 6 points a season to 140 and no further");
  ok(SN.wagePct(signed(1), 113) === 100 && SN.wagePct(signed(1), day(2, 113)) === 106 && SN.wagePct(signed(1), day(2, 126)) === 106, "the off-season does not touch a wage: only the rent has a break");
  ok(SN.wageFor(signed(1), 70, 127) === 74 && SN.wageFor(signed(1), 60, 127) === 64 && SN.wageFor(signed(1), 75, 127) === 80 && SN.wageMult(signed(1), 127) === 1.06, "to the dollar: $70 is $74 and $60 is $64 in the second season");
  const c = bar(127, true); c.terms = signed(1);
  ok(C.effWage(c, c.staff[0]) === 74 && C.effWage(c, c.staff[1]) === 64 && C.wageBill(c) === 138 && C.billsFor(c).wages === 138, "the payroll's two wages are $138 a night for $130");
  c.upgrades = ["training"];
  ok(C.effWage(c, c.staff[0]) === 85 && C.effWage(c, c.staff[1]) === 73 && Math.round(Math.round(60 * 1.06) * 1.15) === 74, "Staff Training's 15% and the season's 6% are both in the one rounding: $70 is $85 and $60 is $73, where rounding twice would say $74");
  c.upgrades = [];
  ok(C.termsWage(c, 85) === 90 && c.staff[0].wage === 70 && c.staff[1].wage === 60, "an applicant's asking wage reads on the terms, and the payroll's own numbers are not rewritten");
  // the rota: a night off is the raised wage not paid
  C.postRota(c);
  C.toggleDayOff(c, BO, C.weekday(c));
  ok(C.wageBill(c) === 74 && C.duty(c).off.includes(BO), "under a rota, a night off is the raised wage not paid: $74 with the server off, not $138");
  C.toggleDayOff(c, BO, C.weekday(c));
  // a level's raise is raised with the rest
  const lv = bar(127); lv.terms = signed(1);
  lv.staff[0].wage += 20;
  ok(C.effWage(lv, lv.staff[0]) === 95 && Math.round(90 * 1.06) === 95, "a level's $20 goes on the staffer's own wage, so the season raises it with the rest: $90 is $95");
}

// ---- the close, on terms ----
{
  const c = bar(1, true);
  const b = close(c);
  ok(b.rent === 99 && b.wages === 130 && b.net === 500 - 99 - 130 && c.cash === 50000 + 500 - 99 - 130, "a night in the signing season is billed $99 and the wages as they were, and the till moves by exactly that");
  ok(Object.keys(b).join() === "wages,rent,promoCost,upgFees,account,walkin,take,net,spoilage,games,social,moments,crew,lease", "the record has the fourteen fields it had: the terms are in `rent` and `wages`, not beside them");
  const d = bar(40, true); d.darkNightsLeft = 1;
  const db = C.settleDarkNight(d, seeded(2, mulberry32));
  ok(db.rent === 99 && db.wages === 130 && db.net === -229, "a dark night is billed on the terms too");
  // the night the year turns
  const y = bar(126); y.terms = signed(1);
  const last = close(y);
  ok(last.rent === 74 && last.wages === 130 && y.day === 127, "the last night of the off-season is billed the off-season's $74 and the old wages");
  ok(C.rent(y) === 110 && C.wageBill(y) === 138, "and the morning after, the bill is the new season's: $110 and $138");
  const first = close(y, 3);
  ok(first.rent === 110 && first.wages === 138 && first.net === 500 - 248, "which is what the first night of season 2 pays");
  const o = bar(112); o.terms = signed(1);
  ok(close(o).rent === 99 && C.rent(o) === 74, "the final's night pays the season's rent; the break starts the morning after");
  // the landlord counts the same cash
  const p = bar(1, true); p.cash = 100; p.staff = [];
  const pb = C.settleNight(p, night({ total: 0, revenue: 0, tips: 0, served: 0 }), seeded(4, mulberry32));
  ok(pb.rent === 99 && p.cash === 1 && pb.lease.short === false, "a till of $100 covers a $99 rent with a dollar over: the lease check reads the terms' rent, not the room's $110");
}

// ---- what does not move: the supply house, the par sheet, the dated shelf ----
{
  let same = true, bills = true;
  for (const d of [1, 60, 113, 127, 128, 300, 133, 900]) for (const house of ["county", "cask", "gold"]) {
    const a = bar(d), b = bar(d);
    b.league = clone(a.league); b.terms = signed(1);
    for (const x of [a, b]) { C.signHouse(x, house); C.dateShelf(x); C.buyWalkin(x); C.setPar(x, "wings", 40); C.setPar(x, "beer", 120); }
    const order = { wings: 60, beer: 150, soda: 20 };
    same &&= C.forecast(a) === C.forecast(b) && J(C.orderQuote(a, order)) === J(C.orderQuote(b, order)) && C.plateMult(a) === C.plateMult(b)
      && J(C.fillToPar(a, {})) === J(C.fillToPar(b, {})) && C.keeps(a, "wings") === C.keeps(b, "wings") && C.unitPrice(a, "beer", 150) === C.unitPrice(b, "beer", 150);
    bills &&= C.accountFee(a) === C.accountFee(b) && C.walkinFee(a) === C.walkinFee(b) && C.upgradeFees(a) === C.upgradeFees(b) && C.billsFor(b).walkin === 18
      && C.billsFor(a).total - C.billsFor(b).total === (C.rent(a) - C.rent(b)) + (C.wageBill(a) - C.wageBill(b));
  }
  ok(same, "the forecast, an order's quote at all three houses, the plate's price, Fill to Par and a lot's nights read the same on terms and off them");
  ok(bills, "the supply account and the walk-in's power are not on the terms: the two bills differ by the rent and the wages and nothing else");
  const a = bar(127), b = bar(127); b.league = clone(a.league); b.regulars = []; b.terms = signed(1);
  for (const x of [a, b]) { x.applicants = []; C.dateShelf(x); C.placeOrder(x, { wings: 30 }); }
  const ra = close(a, 9), rb = close(b, 9);
  ok(J(ra.spoilage) === J(rb.spoilage) && J(a.shelf) === J(b.shelf) && J(a.stock) === J(b.stock) && J(a.dist) === J(b.dist) && ra.take === rb.take, "and a night closed on a dated shelf leaves the same lots, the same stock and the same account either way");
  ok(Math.round((a.cash - b.cash) * 100) / 100 === (rb.rent - ra.rent) + (rb.wages - ra.wages) && rb.rent - ra.rent === 0 && rb.wages - ra.wages === 8, "the two tills differ by the night's raise alone: $8 of wages on the first night of season 2");
}

// ---- seeing it coming ----
{
  const o = SN.outlook(signed(1), 110, 1);
  ok(o.season === 1 && o.phase === "regular" && o.seasonsIn === 0 && o.rent === 99 && o.wagePct === 100, "the outlook on day 1: season 1, the regular season, $99 and wages as they are");
  ok(o.off.in === 112 && o.off.rent === 74 && o.next.in === 126 && o.next.season === 2 && o.next.rent === 110 && o.next.wagePct === 106, "with the two dates: $74 from the off-season in 112 nights, then $110 and wages 6% up when season 2 opens in 126");
  const mid = SN.outlook(signed(1), 110, 120);
  ok(mid.phase === "offseason" && mid.rent === 74 && mid.off.in === 0 && mid.off.rent === 74 && mid.next.in === 7 && mid.next.rent === 110, "inside the off-season the break is tonight's rent and is not announced as coming");
  const cap = SN.outlook(signed(1), 110, day(8, 1));
  ok(cap.rent === 176 && cap.wagePct === 140 && cap.next.rent === 176 && cap.next.wagePct === 140, "at the cap, next season is this season: $176 and 140%");
  ok(J(SN.offer(110, 1)) === J(o) && SN.offer(110, 300).rent === 99 && SN.offer(110, 300).next.rent === 110 && SN.offer(160, 300).seasonsIn === 0, "the offer is the outlook of terms signed today, whatever season today is in");
  const c = bar(300);
  ok(C.termsOutlook(c) === null && C.termsOffer(c).rent === 99 && C.termsOffer(c).next.in === SN.nextOpen(300) - 300 && !C.onTerms(c), "the campaign can read the offer without signing");
  C.signTerms(c); C.devWarpVenue(c, "fieldhouse");
  ok(C.termsOutlook(c).rent === 144 && C.termsOutlook(c).next.rent === 160, "and once signed, the outlook is the room it is in");
  // the notice: a week ahead of either date, and not before
  const n = d => SN.notice(signed(1), 110, d);
  ok(n(1) === null && n(105) === null, "no notice eight nights ahead of the off-season, or any time before");
  ok(J(n(106)) === J({ in: 7, what: "offseason", rent: 74, was: 99, wagePct: 100, wageWas: 100 }) && n(112).in === 1 && n(112).what === "offseason", "from seven nights out the off-season's rent is announced, down to the night before");
  ok(n(113) === null && n(119) === null, "the first week of the off-season announces nothing: the break has started and the open is over a week off");
  ok(J(n(120)) === J({ in: 7, what: "season", season: 2, rent: 110, was: 74, wagePct: 106, wageWas: 100 }) && n(126).in === 1 && n(126).season === 2, "the second week announces the new season: $110 from $74 and wages to 106%, down to the night before");
  ok(n(127) === null && J(C.termsNotice(bar(127, false))) === "null", "and the morning it arrives there is nothing left to announce");
  ok(SN.noticeLine(null) === "" && C.termsNoticeLine(bar(120)) === "", "no notice is no line");
  ok(SN.noticeLine(n(112)) === "Season terms: the off-season starts tomorrow. Rent drops to $74 a night from $99 for the dark fortnight.", "the off-season's line names both rents and says tomorrow for one night");
  ok(SN.noticeLine(n(120)) === "Season terms: season 2 opens in 7 nights. Rent goes to $110 a night from $74 and every wage goes to 106% of the staffer's own, from 100%.", "the new season's line names the rent and the wages");
  ok(SN.noticeLine(SN.notice(signed(1), 110, day(9, 124))) === "Season terms: season 10 opens in 3 nights. Rent goes to $176 a night from $132 and wages hold.", "and at the cap it says the wages hold");
  const w = bar(122); w.terms = signed(1);
  const wn = C.termsNotice(w) || {};
  ok(wn.in === 5 && wn.rent === 110 && wn.season === 2, "the campaign's notice is the module's, on its own room and day");
  ok(C.termsNoticeLine(w) === SN.noticeLine(SN.notice(signed(1), 110, 122)) && /season 2 opens in 5 nights/.test(C.termsNoticeLine(w)), "and its sentence is the module's sentence for that notice");
}

// ---- the save ----
{
  const mkStore = (seedData = {}) => ({ d: { ...seedData }, setItem(k, v) { this.d[k] = String(v); }, getItem(k) { return this.d[k] ?? null; }, removeItem(k) { delete this.d[k]; } });
  const raw = (c, v, extra = {}) => { const o = { ...clone(c), ...extra }; if (v === null) delete o.__v; else o.__v = v; return J(o); };
  ok(C.SAVE_KEY === "fq3d-save" && C.SAVE_VERSION === 5, "the key is the key it always was (#36); the version is 5");
  const base = bar(200);
  for (const v of [null, 1, 4]) {
    const old = clone(base); delete old.terms;
    const got = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(old, v) }));
    ok(J(got.terms) === J(MTM) && C.rent(got) === 110 && C.wageBill(got) === 130, `a save from ${v === null ? "before versions" : "version " + v} with no terms loads month to month, paying what it paid`);
  }
  const forged = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(base, 4, { terms: signed(1) }) }));
  ok(J(forged.terms) === J(MTM), "a version-4 save that claims signed terms loads without them: no build before 5 wrote the field (migrate)");
  const kept = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(base, 5, { terms: signed(1) }) }));
  ok(J(kept.terms) === J(signed(1)) && C.rent(kept) === 110, "a version-5 save keeps its terms");
  const rep = t => J(SN.repairTerms(t, 200));
  ok([undefined, null, 7, "signed", [], {}, { signed: false, since: 4 }, { signed: "true", since: 1 }].every(t => rep(t) === J(MTM)), "repair: anything that is not signed terms is month to month, with the season count cleared");
  ok(rep({ signed: true, since: 9 }) === J(signed(2)) && rep({ signed: true, since: 0 }) === J(signed(1)) && rep({ signed: true, since: -3 }) === J(signed(1)), "signed in a season that has not happened is signed this season; signed before season 1 is season 1");
  ok(rep({ signed: true }) === J(signed(2)) && rep({ signed: true, since: NaN }) === J(signed(2)) && rep({ signed: true, since: "1" }) === J(signed(2)) && rep({ signed: true, since: 1.4 }) === J(signed(1)), "a season that is not a number is this one, and a fraction is rounded");
  ok(rep({ signed: true, since: 1, extra: "x" }) === J(signed(1)), "and nothing else rides along in the record");
  const once = C.repairCampaign({ ...clone(base), terms: { signed: true, since: 40 } });
  ok(J(once.terms) === J(signed(2)) && J(C.repairCampaign(clone(once)).terms) === J(once.terms), "the campaign's repair holds it, and is idempotent over it");
  const store = mkStore();
  const live = bar(130, true);
  C.saveCampaign(live, store);
  const back = C.loadCampaign(store);
  ok(JSON.parse(store.getItem(C.SAVE_KEY)).__v === C.SAVE_VERSION && J(back.terms) === J(signed(2)) && C.rent(back) === 99, "a save written now round-trips the terms");
  const slot = C.campaignSlot(store);
  const env = JSON.parse(slot.serialize(back));
  ok(env.version === C.SAVE_VERSION && env.state.terms.signed === true && slot.deserialize(J({ ...env, version: 4 })).terms.signed === false, "the export file carries them at the build's version, and a version-4 file that claims them imports without");
}

// ---- seasons, on the terms and off them ----
// One seed at the Corner Tap, the bot in fixtures/season.mjs, played to the
// end of season 1, of season 2 and of season 3. The bot never reads the till,
// so the two campaigns play the same nights and differ by the bills alone.
{
  const mods = { C, NightEngine, seed, mulberry32 };
  const run = (nights, terms) => runSeason(mods, { seed: 1, nights, terms });
  const sum = (r, k) => r.rows.reduce((a, x) => a + (x[k] || 0), 0);
  const cents = n => Math.round(n * 100) / 100;
  const m1 = run(126, false), t1 = run(126, true);
  ok(totals(m1).evictions + totals(t1).evictions === 0 && m1.rows.every((r, i) => r.take === t1.rows[i].take && r.paid === t1.rows[i].paid && r.served === t1.rows[i].served), "one season, the same nights either way: the same take, the same orders, the same plates");
  ok(m1.rows.every(r => !("rent" in r)) && t1.rows.every(r => "rent" in r) && sum(t1, "rent") === 112 * 99 + 14 * 74, "on the terms the season's rent is 112 nights at $99 and 14 at $74");
  ok(cents(t1.c.cash - m1.c.cash) === 1736 && 1736 === 112 * 11 + 14 * 36, `signing on day one is worth $${cents(t1.c.cash - m1.c.cash)} by the end of season 1 at the Corner Tap, all of it rent`);
  ok(sum(t1, "wages") === 126 * 130, "and the wages were the wages");
  const m3 = run(378, false), t3 = run(378, true);
  ok(totals(m3).evictions + totals(t3).evictions === 0 && m3.rows.every((r, i) => r.take === t3.rows[i].take), "three seasons, still the same nights");
  const upTo = (r, n) => r.rows.filter(x => x.day <= n);
  const cashAt = (r, n) => upTo(r, n).at(-1).cash;
  ok(cents(cashAt(t3, 126) - cashAt(m3, 126)) === 1736 && cents(cashAt(t3, 252) - cashAt(m3, 252)) === 1106 && cents(t3.c.cash - m3.c.cash) === -1750,
    `the terms are $1,736 ahead after one season, $${cents(cashAt(t3, 252) - cashAt(m3, 252))} after two and $${cents(m3.c.cash - t3.c.cash)} behind after three`);
  const s2 = t3.rows.filter(x => x.day > 126 && x.day <= 252), s3 = t3.rows.filter(x => x.day > 252);
  ok(s2.slice(0, 112).every(x => x.rent === 110) && s2.slice(112).every(x => x.rent === 83) && s3.slice(0, 112).every(x => x.rent === 121) && s3.slice(112).every(x => x.rent === 91), "season 2 is the room's own $110 ($83 off-season) and season 3 is $121 ($91)");
  ok(s2.every(x => x.wages === 138) && s3.every(x => x.wages === 78 + 67), "with the two wages at $138 a night in season 2 and $145 in season 3");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
