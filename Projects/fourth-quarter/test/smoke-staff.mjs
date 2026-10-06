// smoke-staff.mjs — node test/smoke-staff.mjs
//
// The crew as people (#908): js/staff.js's arithmetic, campaign.js's record
// of it, the save, and what a rota is worth over a seeded season. No DOM, no
// three.js. Every name in here is made up.
//
// The claim that matters most is that a campaign with no rota is the game as
// it was. Three things hold it: smoke-settle.mjs's pin and smoke-supply.mjs's
// SEASON_PIN are both unmoved with the `crew` field taken out, the lines under
// "no rota" below ask every changed function for its old answer, and 60
// seasons (four rooms, three houses, five seeds) were compared tree against
// tree on 2026-10-06, rows and campaigns byte for byte.

import * as ST from "../js/staff.js";
import * as C from "../js/campaign.js";
import * as R from "../js/regulars.js";
import { NightEngine, seed, mulberry32 } from "../js/engine.js";
import { runSeason, totals, seeded } from "./fixtures/season.mjs";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const clone = x => JSON.parse(JSON.stringify(x));
const J = JSON.stringify;

const ANN = "Ann Example", BO = "Bo Sample", CY = "Cy Placeholder", DI = "Di Fixture", ED = "Ed Mock";
const crewOf = (...names) => names.map((n, i) => C.mkStaff(["cook", "server", "bartender"][i % 3], 2, 80, n));
const rota = (book = {}) => ({ rota: true, book });
const line = (o = {}) => ({ off: [], fatigue: 0, xp: 0, morale: ST.MORALE_START, ...o });
/** A rand that counts its draws and returns `v`. */
const counted = v => { const f = () => { f.n++; return v; }; f.n = 0; return f; };
const quiet = { dark: false, good: false, ugly: false, buzz: 0 };
/** A campaign with a posted rota and a known payroll. */
function posted(...names) {
  const c = C.newCampaign();
  c.staff = crewOf(...names); c.cash = 50000;
  C.postRota(c);
  return c;
}
const night = (extra = {}) => ({ total: 500, revenue: 450, tips: 50, served: 40, walkouts: 0, mood: 0.6, serviceRate: 80, ...extra });

// ---- the table ----
{
  ok(ST.ROSTER_OPEN === C.MAX_STAFF && ST.SHIFT_MAX === C.MAX_STAFF && ST.ROSTER_ROTA === 5, "no rota holds the old three; a rota holds five and still works three a night");
  ok(5 * ST.FATIGUE_SHIFT === 2 * ST.FATIGUE_REST, "five on and two off is fatigue in, fatigue out");
  ok(ST.TIRED === 60 && ST.BURNT === 85 && ST.LOOKING === 25 && ST.MORALE_START === 60, "tired at 60, burnt out at 85, looking under 25, hired at 60");
  ok(J(ST.WEEK) === J(C.DAYS), "the week is the calendar's week, Monday first");
  ok(J(ST.newCrew()) === '{"rota":false,"book":{}}' && !ST.hasRota(ST.newCrew()) && !ST.hasRota(null) && !ST.hasRota({ rota: "yes" }), "a new record has no rota, and only `true` is one");
  ok(ST.rosterCap(ST.newCrew()) === 3 && ST.rosterCap(rota()) === 5, "the roster cap follows it");
}

// ---- fatigue, skill and the next level ----
{
  ok([0, 59, 60, 84, 85, 100].map(ST.condition).join() === "fresh,fresh,tired,tired,burnt,burnt", "fresh under 60, tired from 60, burnt out from 85");
  ok([59, 60, 84, 85].map(ST.skillOff).join() === "0,1,1,2", "tired works a level down, burnt out two");
  ok(ST.effSkill(4, 60) === 3 && ST.effSkill(4, 85) === 2 && ST.effSkill(2, 85) === 1 && ST.effSkill(1, 100) === 1, "and never under skill 1");
  ok([1, 2, 3, 4, 5].map(ST.xpToLevel).join() === "6,12,18,24,0", "six shifts per level held to the next one; nothing past skill 5");
  const e = ST.entry(rota(), ANN);
  ok(J(e) === J(line()), "a name the book has no line for reads as hired today: no nights off, no fatigue, no shifts, morale 60");
  ok(J(ST.entry(rota({ [ANN]: { off: ["Tue", "Blursday"], fatigue: 400, xp: -3, morale: "low" } }), ANN)) === J(line({ off: ["Tue"], fatigue: 100 })), "and a line with junk in it reads clamped");
}

// ---- who works tonight ----
{
  const staff = crewOf(ANN, BO, CY, DI, ED);
  ok(J(ST.tonight(ST.newCrew(), staff, "Mon", 1)) === J({ on: [ANN, BO, CY, DI, ED], off: [], out: [], call: [] }), "no rota: everyone on the payroll is on, however many");
  const t = ST.tonight(rota({ [BO]: line({ off: ["Mon"] }) }), staff, "Mon", 1);
  ok(J(t.off) === J([BO]) && J(t.on) === J([ANN, CY, DI]) && J(t.call) === J([ED]), "a rota: the night off is off, the first three scheduled work, the fourth is on call");
  ok(J(ST.tonight(rota({ [BO]: line({ off: ["Mon"] }) }), staff, "Tue", 2).on) === J([ANN, BO, CY]), "and Tuesday is not Monday");
  // a call-out: burnt out, and the day's coin
  const days = Array.from({ length: 4000 }, (_, i) => i + 1);
  const outs = days.filter(d => ST.callsOut(ANN, d, 90)).length;
  ok(outs > 4000 * 0.31 && outs < 4000 * 0.39, `a burnt-out staffer calls out about ${ST.CALLOUT_CHANCE * 100}% of nights (${outs} of 4,000)`);
  ok(days.every(d => !ST.callsOut(ANN, d, 84)) && days.some(d => ST.callsOut(ANN, d, 85)), "and only a burnt-out one: never at 84, sometimes at 85");
  ok(days.every(d => ST.callsOut(ANN, d, 90) === ST.callsOut(ANN, d, 90)) && days.some(d => ST.callsOut(ANN, d, 90) !== ST.callsOut(BO, d, 90)), "it is a function of the name and the day: the same answer twice, and two names do not share a coin");
  const day = days.find(d => ST.callsOut(ANN, d, 90));
  const sick = ST.tonight(rota({ [ANN]: line({ fatigue: 90 }) }), staff, C.DAYS[(day - 1) % 7], day);
  ok(J(sick.out) === J([ANN]) && J(sick.on) === J([BO, CY, DI]) && J(sick.call) === J([ED]), "a call-out is not on shift, and the first one on call is in");
  const offAnyway = ST.tonight(rota({ [ANN]: line({ fatigue: 90, off: C.DAYS.slice() }) }), staff, C.DAYS[(day - 1) % 7], day);
  ok(J(offAnyway.off) === J([ANN]) && offAnyway.out.length === 0, "nobody calls out of a night off");
}

// ---- the rota's own moves ----
{
  let cr = ST.postRota(ST.newCrew());
  ok(cr.rota === true && J(cr.book) === "{}", "posting a rota schedules everyone for seven nights: the book is empty");
  cr = ST.toggleOff(cr, ANN, "Wed"); cr = ST.toggleOff(cr, ANN, "Mon");
  ok(J(cr.book[ANN].off) === J(["Mon", "Wed"]), "nights off are kept in the week's order whatever order they were given in");
  ok(J(ST.toggleOff(cr, ANN, "Wed").book[ANN].off) === J(["Mon"]), "the same click gives the night back");
  ok(ST.toggleOff(cr, ANN, "Blursday") === cr && ST.toggleOff(ST.newCrew(), ANN, "Mon").rota === false, "a day that is not one changes nothing, and neither does a night off with no rota");
  ok(!(ANN in ST.without(cr, ANN).book) && ST.without(cr, ANN).rota === true && ST.without(ST.newCrew(), ANN).rota === false, "a staffer who goes takes their line with them, and the rota stays as it was");
  ok(ST.afterRaise(rota({ [ANN]: line({ morale: 30 }) }), ANN).book[ANN].morale === 30 + ST.MORALE.raise && ST.afterRaise(rota({ [ANN]: line({ morale: 95 }) }), ANN).book[ANN].morale === 100, "a raise is 15 of morale, to 100");
  const none = ST.newCrew();
  ok(ST.afterRaise(none, ANN) === none, "and nothing with no rota, where nobody has a morale");
}

// ---- after a night ----
{
  const staff = crewOf(ANN, BO);
  const all = { on: [ANN, BO], off: [], out: [], call: [] };
  // no rota: the identity, and not one draw
  const r0 = counted(0);
  const open = ST.newCrew();
  const a0 = ST.after(open, staff, all, { ...quiet, ugly: true, buzz: 90 }, r0);
  ok(a0.crew === open && r0.n === 0 && a0.leveled.length + a0.quit.length + a0.poached.length === 0, "no rota: the record comes back untouched and `rand` is never drawn");

  const one = ST.after(rota(), staff, { on: [ANN], off: [BO], out: [], call: [] }, quiet, counted(0.99));
  ok(one.crew.book[ANN].fatigue === ST.FATIGUE_SHIFT && one.crew.book[ANN].xp === 1 && one.crew.book[ANN].morale === 61, "a shift worked fresh: 12 of fatigue, one shift toward the level, a point of morale");
  ok(one.crew.book[BO].fatigue === 0 && one.crew.book[BO].xp === 0 && one.crew.book[BO].morale === 62, "a night off: no shift counted, two of morale, fatigue floored at nothing");
  ok(ST.after(rota({ [BO]: line({ fatigue: 50 }) }), staff, { on: [ANN], off: [BO], out: [], call: [] }, quiet, counted(0.99)).crew.book[BO].fatigue === 20, "and it takes 30 of fatigue back");
  const moods = (ctx, f = 0) => ST.after(rota({ [ANN]: line({ fatigue: f }) }), staff, all, { ...quiet, ...ctx }, counted(0.99)).crew.book[ANN].morale - 60;
  ok(moods({ good: true }) === 3 && moods({ ugly: true }) === -2, "a good floor is two more, an ugly one three less");
  ok(moods({}, 60) === -4 && moods({}, 85) === -8, "working tired costs four of morale and working burnt out eight");
  const tired = ST.after(rota({ [ANN]: line({ fatigue: 60, xp: 5 }) }), staff, all, quiet, counted(0.99)).crew.book[ANN];
  ok(tired.xp === 5 && tired.fatigue === 72, "a tired shift earns nothing toward the level and tires all the same");
  ok(ST.after(rota({ [ANN]: line({ fatigue: 95 }) }), staff, all, quiet, counted(0.99)).crew.book[ANN].fatigue === 100, "fatigue stops at 100");

  // a level
  const up = ST.after(rota({ [ANN]: line({ xp: 11 }) }), staff, all, quiet, counted(0.99));
  ok(J(up.leveled) === J([ANN]) && up.crew.book[ANN].xp === 0 && up.crew.book[ANN].morale === 60 + 1 + ST.MORALE.level, "the twelfth fresh shift at skill 2 is a level: named, the count back to nothing, ten of morale");
  ok(ST.after(rota({ [ANN]: line({ xp: 10 }) }), staff, all, quiet, counted(0.99)).leveled.length === 0, "the eleventh is not");
  const top = ST.after(rota({ [ANN]: line({ xp: 40 }) }), [C.mkStaff("cook", 5, 150, ANN)], { on: [ANN], off: [], out: [], call: [] }, quiet, counted(0.99));
  ok(top.leveled.length === 0 && top.crew.book[ANN].xp === 40, "nobody levels past skill 5, and their count stops");

  // a dark night
  const dark = ST.after(rota({ [ANN]: line({ fatigue: 70, morale: 10, xp: 3 }) }), staff, all, { ...quiet, dark: true }, counted(0));
  const da = dark.crew.book[ANN] || {};
  ok(dark.quit.length === 0 && da.fatigue === 40 && da.morale === 10 && da.xp === 3, "a dark night rests everybody, scheduled or not, and moves nothing else: no shift, no morale, nobody walks");

  // looking for the door
  const low = () => rota({ [ANN]: line({ morale: 20, off: C.DAYS.slice() }), [BO]: line({ morale: 80 }) });
  const offDuty = { on: [BO], off: [ANN], out: [], call: [] };
  const rq = counted(ST.QUIT_CHANCE - 0.001);
  const q = ST.after(low(), staff, offDuty, quiet, rq);
  ok(J(q.quit) === J([ANN]) && q.poached.length === 0 && !(ANN in q.crew.book) && rq.n === 1, "morale under 25 rolls once, and under the quit chance they walk: off the book, one draw, nobody else rolled");
  ok(ST.after(low(), staff, offDuty, quiet, counted(ST.QUIT_CHANCE)).quit.length === 0, "at the quit chance exactly they stay");
  const p = ST.after(low(), staff, offDuty, { ...quiet, buzz: ST.POACH_BUZZ }, counted(ST.POACH_CHANCE - 0.001));
  ok(J(p.quit) === J([ANN]) && J(p.poached) === J([ANN]), "with the End Zone at 50 the roll is its 30%, and the one who goes was poached");
  ok(ST.after(low(), staff, offDuty, { ...quiet, buzz: ST.POACH_BUZZ - 1 }, counted(ST.QUIT_CHANCE + 0.01)).quit.length === 0 && ST.after(low(), staff, offDuty, { ...quiet, buzz: ST.POACH_BUZZ }, counted(ST.QUIT_CHANCE + 0.01)).quit.length === 1, "the same roll keeps them at a buzz of 49 and loses them at 50");
  const edge = rota({ [ANN]: line({ morale: 23, off: C.DAYS.slice() }) }); // 23 + 2 for the night off = 25
  const re = counted(0);
  ok(ST.after(edge, staff, offDuty, quiet, re).quit.length === 0 && re.n === 0, "morale is read after the night moved it: a night off that lifts them to 25 is no roll at all");

  // the two weeks the header promises
  const week = offDays => {
    let cr = rota({ [ANN]: line({ off: offDays }) });
    const opens = [];
    for (let d = 1; d <= 70; d++) {
      const wd = C.DAYS[(d - 1) % 7];
      const f = ST.entry(cr, ANN).fatigue;
      const duty = ST.tonight(cr, [staff[0]], wd, d);
      if (duty.on.length) opens.push(f);
      cr = ST.after(cr, [staff[0]], duty, quiet, counted(0.99)).crew;
    }
    return opens;
  };
  const held = week(["Mon", "Tue"]);
  ok(held.length === 50 && Math.max(...held) === 48, `five on, two off, for ten weeks: never opens a shift over ${Math.max(...held)} of fatigue`);
  const six = week(["Mon"]);
  ok(six.findIndex(f => f >= ST.TIRED) === 5 && six.findIndex(f => f >= ST.BURNT) === 10, `six on, one off: the sixth shift in a row opens tired in the first week, and the eleventh shift opens burnt out (${six.slice(0, 12).join(", ")})`);
}

// ---- no rota: every changed function gives its old answer ----
{
  const c = C.newCampaign();
  ok(!C.hasRota(c) && C.staffCap(c) === C.MAX_STAFF && C.shiftCrew(c) === c.staff, "a new campaign has no rota, and its shift is the payroll itself, the same array");
  c.staff = crewOf(ANN, BO, CY);
  ok(C.wageBill(c) === 240 && C.billsFor(c).wages === 240, "everyone draws the wage");
  ok(C.roleMult(c, "cook") === 0.7 + 2 * 0.14 && C.hasCook(c) && C.hasBartender(c), "and works at the skill on the payroll");
  ok(J(C.eventView(c).staff.map(s => s.name)) === J([ANN, BO, CY]), "the cards see the whole payroll");
  ok(C.toggleDayOff(c, ANN, "Mon") === false && J(c.crew) === J(ST.newCrew()), "a night off cannot be given with no rota");
  c.applicants = crewOf(DI);
  ok(C.hire(c, DI) === false && c.staff.length === 3, "and the fourth hire is refused, as it was");
  // 60 nights worked flat out, good and ugly, with the End Zone hiring: nothing moves
  const before = clone(c.staff);
  c.rival.buzz = 90;
  const r = seeded(908, mulberry32);
  for (let i = 0; i < 60; i++) C.settleNight(c, night({ mood: i % 2 ? 0.1 : 0.9, serviceRate: i % 2 ? 20 : 100 }), r);
  ok(J(c.staff) === J(before) && J(c.crew) === J(ST.newCrew()), "60 nights with no rota: nobody tired, improved or left, and the record is as it was made");
}

// ---- the rota in the books ----
{
  const c = posted(ANN, BO, CY);
  ok(C.postRota(c).ok === false && C.hasRota(c), "a rota is posted once; the second time is refused and it stays up");
  ok(C.staffCap(c) === 5, "the payroll holds five now");
  c.applicants = crewOf(DI, ED, "Flo Stand-In");
  ok(C.hire(c, DI) && C.hire(c, ED) && !C.hire(c, "Flo Stand-In") && c.staff.length === 5, "the fourth and fifth are hired and the sixth refused");
  c.day = 1; // a Monday
  ok(J(C.duty(c)) === J({ on: [ANN, BO, CY], off: [], out: [], call: [DI, ED] }) && C.wageBill(c) === 240, "three work and draw the wage; the two on call draw nothing");
  ok(C.toggleDayOff(c, ANN, "Mon") && J(C.duty(c).on) === J([BO, CY, DI]) && C.wageBill(c) === 240, "give the cook Monday off and the first on call covers: three wages still");
  ok(!C.toggleDayOff(c, "Nobody Atall", "Mon") && !C.toggleDayOff(c, ANN, "Blursday"), "a night off is for somebody on the payroll, on a day of the week");
  // DI is index 3: a cook. Take both cooks off and the kitchen is shut.
  ok(C.hasCook(c) && C.roleMult(c, "cook") > 0, "the cover is a cook, so the kitchen is open");
  C.toggleDayOff(c, DI, "Mon");
  ok(!C.hasCook(c) && C.roleMult(c, "cook") === 0 && J(C.duty(c).on) === J([BO, CY, ED]), "both cooks off on Monday: no cook on shift, the kitchen is closed, whoever is on the payroll");
  c.day = 2;
  ok(C.hasCook(c) && J(C.duty(c).on) === J([ANN, BO, CY]), "and open again on Tuesday");
  ok(J(C.eventView(c).staff.map(s => s.name)) === J([ANN, BO, CY]), "a card sees who is on the floor tonight, not the bench");

  // tired: a level down on the ticket and on their feet
  c.crew.book[BO] = line({ fatigue: 60 }); c.crew.book[CY] = line({ fatigue: 85 });
  c.staff[2].skill = 4; c.staff[2].speed = 2.32; // CY, bartender, skill 4
  const sc = C.shiftCrew(c);
  ok(sc[0] === c.staff[0], "a fresh staffer on shift is their own record");
  ok(sc[1].skill === 1 && c.staff[1].skill === 2 && sc[1] !== c.staff[1], "a tired one is a copy a level down; the payroll's own record is not touched");
  ok(sc[1].speed === Math.round((c.staff[1].speed - 0.18) * 100) / 100, `and walks a level slower (${sc[1].speed} m/s for ${c.staff[1].speed})`);
  ok(sc[2].skill === 2 && C.roleMult(c, "bartender") === 0.7 + 2 * 0.14, "burnt out is two down, and the taps run at that skill");
  ok(C.wageBill(c) === 240, "tired or not, a shift is a full wage");
  const l = C.crewLine(c, CY);
  ok(l.condition === "burnt" && l.skill === 2 && l.toLevel === 24 && !l.looking, "the Crew panel's line says so: burnt out, skill 2 tonight, 24 shifts to the next level");
}

// ---- the rota at the close ----
{
  // a level: the skill, the raise, the walk
  const c = posted(ANN, BO);
  c.crew.book[BO] = line({ xp: 11 });
  c.day = 3;
  const b = C.settleNight(c, night(), seeded(1, mulberry32));
  const bo = c.staff.find(s => s.name === BO);
  ok(J(b.crew.leveled) === J([BO]) && bo.skill === 3 && bo.wage === 80 + ST.LEVEL_RAISE && bo.speed === 2.14, "a level at the close: skill 3, $20 a night more, and the walk that goes with it");
  ok(b.wages === 160 && C.wageBill(c) === 180, "tonight was paid at the old wage; tomorrow is the new one");
  ok(b.crew.rota === true && J(b.crew.on) === J([ANN, BO]) && c.crew.book[ANN].fatigue === 12, "the record says who worked, and they are 12 more tired");
  const cook = posted(ANN); cook.crew.book[ANN] = line({ xp: 11 }); cook.day = 3;
  C.settleNight(cook, night(), seeded(1, mulberry32));
  ok(cook.staff[0].skill === 3 && !("speed" in cook.staff[0]), "a cook levels without growing a walking speed");

  // wages follow the schedule, on an open night and a dark one
  const w = posted(ANN, BO, CY); w.day = 1;
  C.toggleDayOff(w, CY, "Mon");
  const cash = w.cash;
  const wb = C.settleNight(w, night({ total: 0, revenue: 0, tips: 0 }), seeded(2, mulberry32));
  ok(wb.wages === 160 && w.cash === cash - 160 - C.rent(w) && J(wb.crew.off) === J([CY]), "a night off is a wage not paid: two of three drew it, and the till shows it");
  const d = posted(ANN, BO, CY); d.day = 1; d.darkNightsLeft = 1;
  C.toggleDayOff(d, CY, "Mon");
  d.crew.book[ANN] = line({ fatigue: 50, morale: 10 });
  const db = C.settleDarkNight(d, seeded(2, mulberry32));
  ok(db.wages === 160 && d.crew.book[ANN].fatigue === 20 && d.staff.length === 3 && db.crew.quit.length === 0, "a dark night pays the schedule, rests everyone, and nobody walks out of a closed bar");

  // quitting: off the payroll after tonight's wage, and the End Zone's gain
  const q = posted(ANN, BO); q.day = 3; q.rival.buzz = 20;
  q.crew.book[BO] = line({ morale: 5 });
  const qb = C.settleNight(q, night(), () => 0);
  ok(J(qb.crew.quit) === J([BO]) && qb.crew.poached.length === 0 && qb.wages === 160 && q.staff.length === 1 && !(BO in q.crew.book) && C.wageBill(q) === 80, "a quitter worked tonight and was paid for it; tomorrow they are off the payroll and the book");
  const p = posted(ANN, BO); p.day = 3; p.rival.buzz = 70; p.rep = 50;
  p.crew.book[BO] = line({ morale: 5 });
  const twin = clone(p); twin.crew.book[BO].morale = 60;
  const pb = C.settleNight(p, night(), () => 0);
  C.settleNight(twin, night(), () => 0);
  ok(J(pb.crew.poached) === J([BO]) && p.rival.buzz === twin.rival.buzz + ST.POACH_BUZZ_GAIN, `poached: the End Zone is ${ST.POACH_BUZZ_GAIN} busier than the same night with a happy crew (${twin.rival.buzz} to ${p.rival.buzz})`);
  // at the cap: find a night the End Zone closes within the gain of its ceiling
  const ends = [];
  for (const happy of [true, false]) {
    const cap = posted(ANN, BO); cap.day = 3; cap.rival.buzz = R.BUZZ_MAX; cap.rep = 0;
    cap.crew.book[BO] = line({ morale: happy ? 60 : 5 });
    const cb = C.settleNight(cap, night({ mood: 0.05, serviceRate: 10 }), () => 0);
    ends.push(cap.rival.buzz, cb.crew.poached.length);
  }
  if (process.argv.includes("--numbers")) console.log("cap", ends);
  ok(ends[1] === 0 && ends[3] === 1 && ends[0] > R.BUZZ_MAX - ST.POACH_BUZZ_GAIN && ends[2] === R.BUZZ_MAX, `and its buzz still stops at its cap: ${ends[0]} without the poaching, ${ends[2]} with it, not ${ends[0] + ST.POACH_BUZZ_GAIN}`);

  // the two places the books already moved a staffer
  const f = posted(ANN, BO); C.toggleDayOff(f, BO, "Fri");
  ok(C.fire(f, BO) && !(BO in f.crew.book) && f.crew.rota, "letting someone go takes their line off the book");
  const m = posted(ANN, BO); m.day = 3;
  m.crew.book[ANN] = line({ morale: 30 }); m.crew.book[BO] = line({ off: ["Sun"] });
  const mb = C.settleNight(m, night({ moments: { net: 0, rep: 0, buzz: 0, account: 0, loyalty: {}, staff: [{ name: ANN, wage: 95 }, { name: BO, quit: true }], resolved: [] } }), () => 0.99);
  ok(m.staff.length === 1 && m.staff[0].wage === 95 && !(BO in m.crew.book), "the Poaching Call's walkout is off the payroll, and the close drops their line with them");
  ok(mb.social.good && !mb.social.ugly && m.crew.book[ANN].morale === 30 + ST.MORALE.raise + ST.MORALE.fresh + ST.MORALE.good && J(mb.crew.on) === J([ANN, BO]), `and its raise is felt on top of a good night's shift: morale 30 to ${m.crew.book[ANN].morale}; the record still says both opened the night`);
}

// ---- the save ----
{
  const mkStore = (seedData = {}) => ({ d: { ...seedData }, setItem(k, v) { this.d[k] = String(v); }, getItem(k) { return this.d[k] ?? null; }, removeItem(k) { delete this.d[k]; } });
  const raw = (c, v, extra = {}) => { const o = { ...clone(c), ...extra }; if (v === null) delete o.__v; else o.__v = v; return J(o); };
  ok(C.SAVE_KEY === "fq3d-save" && C.SAVE_VERSION === 5, "the key is the key it always was (#36); the version is 5 (the rota was 3)");
  const base = C.newCampaign(); base.day = 23; base.cash = 4321.5; base.staff = crewOf(ANN, BO);
  const bare = clone(base); delete bare.crew;
  const stray = { rota: true, book: { [ANN]: line({ off: ["Mon"], fatigue: 90 }) } };

  for (const [v, word] of [[2, "version 2"], [1, "version 1"], [null, "no version at all"]]) {
    const c = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, v) }));
    ok(c && J(c.crew) === J(ST.newCrew()) && c.day === 23 && c.cash === 4321.5 && J(c.staff) === J(base.staff), `a save with ${word} loads with no rota and the payroll it had`);
    ok(c && C.wageBill(c) === 160 && C.shiftCrew(c) === c.staff && C.staffCap(c) === 3, "and it pays, works and hires as it did");
    // migrate, not repair: a rota in a file from before there were rotas is nobody's decision
    const s = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, v, { crew: stray }) }));
    ok(s && J(s.crew) === J(ST.newCrew()), `migrate: a file with ${word} carrying a posted rota still has none (no build before version 3 wrote one)`);
  }
  const kept = C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 3, { crew: stray }) }));
  ok(kept && kept.crew.rota === true && J(kept.crew.book[ANN]) === J(line({ off: ["Mon"], fatigue: 90 })), "the same record in a version-3 file is kept: that one this build wrote");
  ok(C.migrateCampaign({ crew: clone(stray), dist: { id: "cask", spend: 5 }, pars: {} }, 3).crew.rota === true && C.migrateCampaign({ crew: clone(stray) }, 2).crew.rota === false, "the step is for files from before version 3 only");
  ok(C.migrateCampaign({ dist: { id: "cask", spend: 5 }, pars: { beer: 9 }, crew: clone(stray) }, 2).dist.id === "cask", "and a version-2 file keeps the house it signed with: the older step does not run again");

  const rep = crew => C.loadCampaign(mkStore({ [C.SAVE_KEY]: raw(bare, 3, crew === undefined ? {} : { crew }) })).crew;
  ok([undefined, null, 7, "posted", [], { rota: "yes" }, { rota: 1, book: {} }, { book: stray.book }].every(x => J(rep(x)) === J(ST.newCrew())), "repair: no record, or one whose rota is not `true`, is no rota and an empty book");
  ok(J(rep({ rota: false, book: stray.book })) === J(ST.newCrew()), "a record with no rota keeps no book");
  ok(J(rep({ rota: true })) === '{"rota":true,"book":{}}' && J(rep({ rota: true, book: "all of it" })) === '{"rota":true,"book":{}}', "a posted rota with no book, or a book that is not one, is everyone on for seven nights");
  const messy = rep({ rota: true, book: { [ANN]: { off: ["Sun", "Mon", "Mon", "Blursday"], fatigue: 250.6, xp: -4, morale: null }, [BO]: "tired", "Gone Already": line({ fatigue: 50 }), __proto__: null } });
  ok(J(messy.book[ANN]) === J({ off: ["Mon", "Sun"], fatigue: 100, xp: 0, morale: 60 }), "a line is clamped: real days once each in the week's order, fatigue to 100, shifts to nothing, a missing morale to 60");
  ok(!(BO in messy.book) && !("Gone Already" in messy.book), "a line that is not a record, or for a name not on the payroll, is dropped");
  const once = C.repairCampaign({ ...clone(bare), crew: { rota: true, book: { [ANN]: { off: ["Tue"], fatigue: 33.4, xp: 2.6, morale: 71.5 } } } });
  const twice = C.repairCampaign(clone(once));
  ok(J(once.crew) === J(twice.crew) && J(once.crew.book[ANN]) === J({ off: ["Tue"], fatigue: 33, xp: 3, morale: 72 }), "repair is idempotent over it");

  const store = mkStore();
  const live = posted(ANN, BO); C.toggleDayOff(live, BO, "Wed"); live.crew.book[ANN] = line({ fatigue: 36, xp: 3, morale: 64 });
  C.saveCampaign(live, store);
  const back = C.loadCampaign(store);
  ok(JSON.parse(store.getItem(C.SAVE_KEY)).__v === C.SAVE_VERSION && back.crew.rota === true && J(back.crew.book[ANN]) === J(live.crew.book[ANN]) && J(back.crew.book[BO]) === J(line({ off: ["Wed"] })) && J(C.duty(back)) === J(C.duty(live)), "a save written now round-trips the rota, the book and tonight's shift");
  const slot = C.campaignSlot(store);
  const env = JSON.parse(slot.serialize(back));
  const old = { ...env, version: 2 };
  ok(env.version === C.SAVE_VERSION && env.state.crew.rota === true && slot.deserialize(J(old)).crew.rota === false, "the export file carries it at the build's version, and a version-2 file that claims a rota imports without one");
}

// ---- a season, four ways ----
// One seed, 98 nights, the bot in fixtures/season.mjs. It serves a ticket the
// moment it is ready, so what a slower kitchen costs it is only the plates
// that were not ready by last call, and a played night would lose more. What
// is read off it is the difference between rotas, which is staff.js's doing.
{
  const mods = { C, NightEngine, seed, mulberry32 };
  const play = rota => runSeason(mods, { seed: 1, rota });
  const none = runSeason(mods, { seed: 1 });
  // kept, not covered: the cook off Monday and Tuesday, the server Tuesday and Wednesday, nobody hired
  const bare = play((c, K) => { if (c.day === 1) { const [a, b] = c.staff; K.toggleDayOff(c, a.name, "Mon"); K.toggleDayOff(c, a.name, "Tue"); K.toggleDayOff(c, b.name, "Tue"); K.toggleDayOff(c, b.name, "Wed"); } });
  // kept and covered: a second cook hired for exactly the first one's two nights off
  const covered = play((c, K) => {
    if (c.day !== 1) return;
    const [a, b] = c.staff;
    c.applicants = [K.mkStaff("cook", 2, 70, "Cover Cook")]; K.hire(c, "Cover Cook");
    K.toggleDayOff(c, a.name, "Mon"); K.toggleDayOff(c, a.name, "Tue");
    for (const d of ["Wed", "Thu", "Fri", "Sat", "Sun"]) K.toggleDayOff(c, "Cover Cook", d);
    K.toggleDayOff(c, b.name, "Tue"); K.toggleDayOff(c, b.name, "Wed");
  });
  // posted and never looked at again: everyone on, seven nights
  const run = play(() => {});
  const tn = totals(none), tb = totals(bare), tc = totals(covered), tr = totals(run);
  const sum = (x, k) => x.rows.reduce((a, r) => a + k(r), 0);
  const names = (x, k) => x.rows.flatMap(r => (r.crew ? r.crew[k] : []));
  if (process.argv.includes("--numbers")) console.log(J({ none: tn.cash, bare: tb.cash, covered: tc.cash, run: tr.cash, served: [tn.served, tb.served, tc.served, tr.served], wages: [sum(bare, r => r.wages), sum(covered, r => r.wages), sum(run, r => r.wages)], staff: [bare, covered, run].map(x => x.c.staff.map(s => `${s.role}${s.skill}$${s.wage}`)), out: names(run, "out").length, quit: names(run, "quit") }));
  ok(none.rows.every(r => !("crew" in r)) && [bare, covered, run].every(x => x.rows.length === 98 && x.rows.every(r => r.crew.rota)) && tb.evictions + tc.evictions + tr.evictions === 0, "all four ran the whole season, three under a rota, nobody evicted");

  // kept: nobody ever tired, both at the top of the trade
  ok(names(bare, "out").length + names(bare, "quit").length === 0 && names(bare, "leveled").length === 6, "five on, two off, kept for a season: nobody called out, nobody left, six levels earned");
  ok(bare.c.staff.every(s => s.skill === 5) && bare.c.staff.map(s => s.wage).join() === "130,120", "both of day one's crew end at skill 5, on $60 a night more than they started");
  ok(sum(bare, r => r.wages) === 13660 && sum(bare, r => r.wages) > 98 * 130 * 5 / 7, `it paid $${sum(bare, r => r.wages)} in wages against the $12,740 no rota pays the same two: the nights off saved less than the levels cost`);
  const shut = bare.rows.filter(r => r.crew.on.length < 2 && !bare.c.staff.filter(s => s.role === "cook").some(s => r.crew.on.includes(s.name))).length;
  ok(shut === 28 && tb.served < tn.served, `and the kitchen was shut the 28 nights its one cook was off: ${tn.served - tb.served} fewer orders served than with no rota`);
  ok(tb.cash < tn.cash, `not covered, the rota loses to no rota for this bot: $${Math.round(tn.cash - tb.cash)} over the season`);

  // covered: the kitchen never shut
  ok(covered.rows.every(r => covered.c.staff.filter(s => s.role === "cook").some(s => r.crew.on.includes(s.name))), "with a cover cook on the first one's nights off there is a cook on all 98 nights");
  ok(tc.served > tb.served && tc.cash > tb.cash, `and it beats the same rota without one: ${tc.served - tb.served} more orders, +$${Math.round(tc.cash - tb.cash)}`);
  ok(names(covered, "call").length === 0 && covered.c.staff.length === 3, "nobody was on call: three on the payroll is never more than a shift");
  // The bot carries a ticket the moment it is ready, so a faster cook buys it
  // nothing and a level is only its raise. That is the bot, not a played
  // night, and it is why this line is here: LEVEL_RAISE is the number to turn.
  ok(tc.cash < tn.cash && sum(covered, r => r.wages) === 15940, `for a bot that skill does nothing for, even the covered rota trails no rota: $${Math.round(tn.cash - tc.cash)} over the season, having paid $${sum(covered, r => r.wages) - 98 * 130} more in wages`);

  // neglected: everyone on, every night
  const firstOut = run.rows.findIndex(r => r.crew.out.length);
  ok(firstOut >= 8 && firstOut <= 12, `posted and left alone: the first call-out is night ${firstOut + 1}, once somebody has opened burnt out`);
  ok(names(run, "leveled").length === 0, "nobody earned a level: at skill 2 that is twelve fresh shifts, and they had five");
  ok(names(run, "quit").length === 2 && run.c.staff.length === 0, `and both walked (${names(run, "quit").map(n => n.split(" ")[0]).join(", ")}): the bar ends the season with nobody on the payroll`);
  ok(tr.served < tb.served && tr.cash < tb.cash, `it is the worst of the four: ${tn.served - tr.served} fewer orders than no rota, $${Math.round(tn.cash - tr.cash)} poorer`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
