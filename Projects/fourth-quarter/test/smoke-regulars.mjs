// smoke-regulars.mjs — node test/smoke-regulars.mjs
// Phase 7's three additive fields: the people who come back, your name, and
// the bar across town. The pure arithmetic in js/regulars.js, and the campaign
// wiring in js/campaign.js that spends it.

import * as R from "../js/regulars.js";
import * as C from "../js/campaign.js";
import { FOOD, MENU, HOME_TEAM } from "../js/engine.js";
import { MULES, TEAMS } from "../js/league.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };

/** A seeded generator, so a failure is the same failure twice. */
function seeded(n) { let s = n >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }
/** A campaign with a fixed roster, no randomness anywhere it matters. */
function withRegulars(count, rand = seeded(7)) {
  const c = C.newCampaign();
  C.devWarpVenue(c, "flagship");     // cap 9, so `count` always fits
  for (let i = 0; i < count; i++) C.devAddRegular(c, rand);
  return c;
}
const nightOf = (o = {}) => ({ total: 400, serviceRate: 95, mood: 0.8, arrivals: 30, served: 40, walkouts: 2, game: { finished: true, win: true }, ...o });

// ---- the coin is a function, not a stored roll ----
{
  const r = { id: "abc", loyalty: 55 };
  const a = R.dayRoll(r.id, 40), b = R.dayRoll(r.id, 40);
  ok(a === b && a >= 0 && a < 1, "dayRoll gives the same number for the same regular on the same day");
  ok(R.dayRoll(r.id, 40) !== R.dayRoll(r.id, 41), "and a different one the next day");
  ok(R.dayRoll("abd", 40) !== R.dayRoll("abc", 40), "and a different one for a different regular");
  const c = withRegulars(4);
  const one = C.regularsIn(c).map(x => x.id).join();
  ok(one === C.regularsIn(c).map(x => x.id).join(), "regularsIn() asked twice on the same day gives the same list");
  const before = JSON.stringify(c);
  C.regularsIn(c); C.forecast(c);
  ok(JSON.stringify(c) === before, "and asking does not write anything to the save");
}

// ---- showChance is bounded either side ----
{
  const floor = R.showChance({ loyalty: 0 }, 0, false);
  const ceil = R.showChance({ loyalty: 100 }, 100, true);
  ok(floor >= 0.05 && ceil <= 0.95, `showChance stays in [0.05, 0.95] (${floor}, ${ceil})`);
  ok(R.showChance({ loyalty: 55 }, 50, true) > R.showChance({ loyalty: 55 }, 50, false), "their team on the screens makes them likelier");
  ok(R.showChance({ loyalty: 90 }, 50, false) > R.showChance({ loyalty: 20 }, 50, false), "and so does loyalty");
  ok(Number.isFinite(R.showChance({ loyalty: "high" }, undefined, false)), "a garbage loyalty and a missing rep still produce a number");
}

// ---- the forecast does not move on a day-one campaign ----
{
  const c = C.newCampaign();
  ok(c.rep === 50 && c.rival.buzz === 45 && c.regulars.length === 0, "a fresh campaign opens at rep 50, buzz 45, no regulars");
  ok(R.repMult(50) === 1, "repMult is exactly 1.00 at the starting reputation");
  ok(R.regularCrowdMult(0) === 1 && R.rivalMult(45, 50) === 1, "and so are the other two multipliers on day one");
  // the pre-phase formula, spelled out, against the wired one
  const base = C.BASE_CROWD[C.weekday(c)] * C.tonight(c).crowd * C.promoDef(c).crowd * C.VENUES[c.venue].buzzMult;
  ok(C.forecast(c) === Math.round(base), `day one forecasts the pre-phase number (${C.forecast(c)} vs ${Math.round(base)})`);
  const old = C.repairCampaign({ day: 40, cash: 900, stock: {}, staff: [] });
  ok(old.rep === 50 && old.rival.buzz === 45 && old.regulars.length === 0 && old.regularsLost.length === 0,
    "a save from before this phase loads with the same three opening numbers");
}

// ---- the drag is bounded, so a bad streak cannot zero the room ----
{
  ok(R.repMult(0) === 0.6 && Math.abs(R.repMult(100) - 1.4) < 1e-9, "reputation is worth 0.60x at 0 and 1.40x at 100");
  ok(R.rivalMult(R.BUZZ_MAX, 0) === 0.85, "the rival's drag bottoms out at 0.85x");
  ok(R.regularCrowdMult(50) === 1.12, "and a full bench of regulars tops out at 1.12x");
  const c = C.newCampaign();
  C.devSetRep(c, 0); C.devSetBuzz(c, 95);
  const base = C.BASE_CROWD[C.weekday(c)] * C.tonight(c).crowd * C.promoDef(c).crowd * C.VENUES[c.venue].buzzMult;
  const worst = C.forecast(c) / base;
  ok(worst > 0.5 && worst < 0.52, `the worst campaign on the site still draws 51% of its base (${worst.toFixed(3)})`);
  ok(C.forecast(c) > 0, "which is a number of people, not zero");
}

// ---- the wiring, not just the functions ----
{
  const c = C.newCampaign();
  C.devWarpVenue(c, "flagship");
  const alone = C.forecast(c);
  const rand = seeded(77);
  for (let i = 0; i < 9; i++) C.devAddRegular(c, rand);
  const n = C.regularsIn(c).length;
  ok(n > 0, `regulars are in tonight (${n})`);
  const base = C.BASE_CROWD[C.weekday(c)] * C.tonight(c).crowd * C.promoDef(c).crowd * C.VENUES[c.venue].buzzMult;
  ok(C.forecast(c) === Math.round(base * R.repMult(c.rep) * R.regularCrowdMult(n) * R.rivalMult(c.rival.buzz, c.rep)),
    "forecast() is base times all three of them, and nothing else");
  ok(C.forecast(c) > alone, `a bench of regulars in the room lifts the number on the door (${alone} → ${C.forecast(c)})`);
  C.devSetRep(c, 10);
  ok(C.forecast(c) < alone, "and a name in the gutter drops it below where it started");
  C.devSetRep(c, 50); C.devSetBuzz(c, 95);
  ok(C.forecast(c) < Math.round(base * R.regularCrowdMult(n)), "and the End Zone pulling ahead drags it down too");
}

// ---- loyalty and buzz never leave their bands, over a long campaign ----
{
  const c = withRegulars(6);
  const rand = seeded(99);
  let minL = 100, maxL = 0, minB = 100, maxB = 0;
  for (let n = 0; n < 120; n++) {
    // deliberately swing the floor from perfect to catastrophic and back
    const bad = n % 3 === 0;
    C.settleNight(c, nightOf({ serviceRate: bad ? 20 : 99, mood: bad ? 0.1 : 0.95, arrivals: bad ? 4 : 40 }), rand);
    for (const r of c.regulars) { minL = Math.min(minL, r.loyalty); maxL = Math.max(maxL, r.loyalty); }
    minB = Math.min(minB, c.rival.buzz); maxB = Math.max(maxB, c.rival.buzz);
    if (!c.regulars.length) C.devAddRegular(c, rand);
  }
  ok(minL >= 0 && maxL <= 100, `loyalty stayed inside 0-100 over 120 nights (${minL}-${maxL})`);
  // The campaign loop above cannot see either edge of driftLoyalty's own clamp:
  // pruneRegulars() removes anyone at or under zero on the same tick, and a
  // roster that swings never sits at 100 on a good night. Both edges are one
  // call away, so assert them there rather than claiming a run that cannot show
  // them proves anything (#147).
  {
    const top = [{ id: "t", loyalty: 100 }], bottom = [{ id: "b", loyalty: 2 }];
    R.driftLoyalty(top, { showing: new Set(["t"]), stockedOut: new Set(), good: true, ugly: false });
    ok(top[0].loyalty === 100, `a regular already at 100 does not go past it on a good night (${top[0].loyalty})`);
    R.driftLoyalty(bottom, { showing: new Set(["b"]), stockedOut: new Set(["b"]), good: false, ugly: true });
    ok(bottom[0].loyalty === 0, `and one at 2 who is 86'd on an ugly night stops at 0, not -11 (${bottom[0].loyalty})`);
  }
  ok(minB >= R.BUZZ_MIN && maxB <= R.BUZZ_MAX, `buzz stayed inside ${R.BUZZ_MIN}-${R.BUZZ_MAX} over 120 nights (${minB}-${maxB})`);
  // Same reason: driftBuzz() clamps what it is handed as well as what it
  // returns, so a campaign loop re-clamps every night and never shows the
  // output clamp doing anything. One call at each edge does.
  ok(R.driftBuzz(R.BUZZ_MAX, { good: false, ugly: true, arrivals: 0 }, () => 0.99).buzz === R.BUZZ_MAX,
    "the worst night you can hand Vic does not push his buzz past 95");
  ok(R.driftBuzz(R.BUZZ_MIN, { good: true, ugly: false, arrivals: 40 }, () => 0).buzz === R.BUZZ_MIN,
    "and the best one you can run does not push it under 10");
  ok(minB >= 0 && maxB <= 100, "which is inside 0-100");
  ok(c.rep >= 0 && c.rep <= 100, `and reputation stayed inside 0-100 (${c.rep})`);
  ok(c.regulars.every(r => Number.isFinite(r.loyalty)) && Number.isFinite(c.rep) && Number.isFinite(c.rival.buzz),
    "nothing went NaN on the way");
}

// ---- a stocked-out usual costs loyalty exactly once per night ----
{
  const c = withRegulars(3);
  const inTonight = C.regularsIn(c);
  ok(inTonight.length >= 2, "the fixture has at least two regulars in tonight");
  const victim = inTonight[0], safe = inTonight[1];
  // bare the victim's shelf, keep everything else stocked; an ugly-free,
  // good-free night so the only thing moving loyalty is the 86
  for (const id of FOOD) c.stock[id] = 40;
  c.stock[victim.usual] = 0;
  const before = new Map(c.regulars.map(r => [r.id, r.loyalty]));
  const books = C.settleNight(c, nightOf({ serviceRate: 70, mood: 0.45 }), seeded(3));
  const v = c.regulars.find(r => r.id === victim.id);
  ok(before.get(victim.id) - v.loyalty === 8, `the 86'd regular lost exactly 8 (${before.get(victim.id)} → ${v.loyalty})`);
  ok(books.social.snubbed.includes(victim.name), "and the box score names them");
  if (safe.usual !== victim.usual) {
    const s2 = c.regulars.find(r => r.id === safe.id);
    ok(before.get(safe.id) === s2.loyalty, "a regular whose usual was on the shelf lost nothing on a flat night");
  } else ok(true, "(both regulars in tonight order the same thing — nothing to compare)");
  ok(new Set(books.social.snubbed).size === books.social.snubbed.length, "and nobody is named twice");
}
{
  // the one that matters: a regular who stayed home cannot be 86'd.
  // The coin is a function of the day, so walk the calendar to a day one of
  // them sits out rather than rerolling until one does.
  const c = withRegulars(5);
  let away = null;
  for (let d = 1; d <= 60 && !away; d++) {
    C.devSetDay(c, d);
    const inTonight = new Set(C.regularsIn(c).map(r => r.id));
    away = c.regulars.find(r => !inTonight.has(r.id)) || null;
  }
  ok(!!away, "the calendar has a day one of the five sits out");
  for (const id of FOOD) c.stock[id] = 0;
  const before = away.loyalty;
  const books = C.settleNight(c, nightOf({ serviceRate: 99, mood: 0.9 }), seeded(4));
  const a = c.regulars.find(r => r.id === away.id);
  ok(before - a.loyalty === 1, `they took the stay-home drift of 1 and nothing else (${before} → ${a.loyalty})`);
  ok(!books.social.snubbed.includes(away.name), "and the shelf being bare is not their problem");
}

// ---- a regular at zero stops showing, and can be re-earned as themselves ----
{
  const c = withRegulars(1);
  const r = c.regulars[0];
  r.loyalty = 3;
  for (const id of FOOD) c.stock[id] = 40;
  c.stock[r.usual] = 0;
  // drive them under with 86'd usuals until they are gone
  for (let n = 0; n < 8 && c.regulars.length; n++) {
    c.stock[r.usual] = 0;
    C.settleNight(c, nightOf({ serviceRate: 40, mood: 0.2, arrivals: 5 }), seeded(11 + n));
  }
  ok(c.regulars.length === 0, "a regular driven to zero loyalty is off the roster");
  ok(C.regularsIn(c).length === 0, "and stops showing");
  ok(c.regularsLost.some(l => l.name === r.name), "the door remembers their name, their usual and their team");
  const back = c.regularsLost.find(l => l.name === r.name);
  ok(back.usual === r.usual && back.team === r.team, "unchanged");
  // a run of great, busy nights wins somebody back
  let regained = null;
  for (let n = 0; n < 200 && !regained; n++) {
    for (const id of FOOD) c.stock[id] = 200;
    const books = C.settleNight(c, nightOf({ serviceRate: 99, mood: 0.95, arrivals: 40 }), seeded(500 + n));
    if (books.social.gained) regained = books.social.gained;
    c.regulars.length = 0; // clear the bench so the next night can mint again
  }
  ok(!!regained, "a great, busy night mints a regular");
  let returner = null;
  const c2 = C.newCampaign();
  c2.regularsLost = [{ name: r.name, usual: r.usual, team: r.team }];
  for (let n = 0; n < 200 && !returner; n++) {
    for (const id of FOOD) c2.stock[id] = 200;
    const books = C.settleNight(c2, nightOf({ serviceRate: 99, mood: 0.95, arrivals: 40 }), seeded(900 + n));
    if (books.social.gained && books.social.gained.returning) returner = books.social.gained;
    c2.regulars.length = 0;
    c2.regularsLost = [{ name: r.name, usual: r.usual, team: r.team }];
  }
  ok(returner && returner.name === r.name, "and one of those is the same person walking back in, not a stranger");
  ok(R.LOST_MEMORY === 6, "the door remembers six names");
  {
    const lost = [];
    for (let i = 0; i < 10; i++) { const list = [{ name: `P${i}`, usual: "wings", team: MULES, loyalty: 0 }]; R.pruneRegulars(list, lost); }
    ok(lost.length === 6 && lost[0].name === "P4" && lost[5].name === "P9", "and forgets the oldest past six");
  }
}

// ---- how far a night can move your name ----
{
  ok(R.repDrift(0, 1, 1, 0, true) === 5, "a perfect night is worth 5, and no more");
  ok(R.repDrift(50, 0, 0, 0, false) === -5, "and a catastrophic one costs 5, and no more");
  ok(R.repDrift(50, 1, 1, 0, true) === 4, "the same perfect night at reputation 50 is only worth 4 — the climb steepens");
  ok(R.repDrift(95, 1, 1, 0, true) < R.repDrift(50, 1, 1, 0, true), "and steepens further the higher it goes");
  // -2 rather than -14: the cushion is a percentage, so it is invisible at the
  // clamp and only shows on a night the clamp is not already eating
  ok(R.repDrift(50, 0.65, 0.5, 0, false) === -2 && R.repDrift(50, 0.65, 0.5, 8, false) === -1,
    "a bench of regulars cushions a middling bad night from 2 to 1");
  ok(R.repDrift(50, 0.75, 0.6, 0, false) === 0, "an average night moves nothing");
  ok(R.repDrift(50, 0.75, 0.6, 0, true) === 1, "a Mules win is worth a point on its own");
}

// ---- your name is what applies for work ----
{
  ok(R.applicantSkillCap(0) === 2 && R.applicantSkillCap(50) === 4 && R.applicantSkillCap(75) === 5 && R.applicantSkillCap(100) === 5,
    "applicant skill caps at 2, 4 and 5 as reputation climbs");
  const c = C.newCampaign();
  C.devSetRep(c, 0);
  const rand = seeded(21);
  let best = 0;
  for (let i = 0; i < 200; i++) { C.rollApplicants(c, rand); best = Math.max(best, ...c.applicants.map(a => a.skill)); }
  ok(best === 2, `at reputation 0, 600 applicants never got past skill 2 (best ${best})`);
  C.devSetRep(c, 100);
  best = 0;
  for (let i = 0; i < 200; i++) { C.rollApplicants(c, rand); best = Math.max(best, ...c.applicants.map(a => a.skill)); }
  ok(best === 5, `at 100 they reach 5 (best ${best})`);
  // 400 rolls, not one: the pool is 20 first names by 15 last, so a namer that
  // never retries collides maybe once in a hundred draws and a single roll
  // would sit green for months.
  C.devWarpVenue(c, "flagship");
  const nameRand = seeded(23);
  for (let i = 0; i < 9; i++) C.devAddRegular(c, nameRand);
  let clash = null;
  for (let i = 0; i < 400 && !clash; i++) {
    C.rollApplicants(c, nameRand);
    const names = [...c.staff, ...c.applicants, ...c.regulars].map(p => p.name);
    if (new Set(names).size !== names.length) clash = names.join(", ");
  }
  ok(!clash, `over 400 rolls no applicant ever shared a name with the crew, another applicant or a regular (${clash || "none"})`);
}

// ---- a dark night is not a night anyone saw ----
{
  const c = withRegulars(4, seeded(31));
  C.devSetRep(c, 50);
  const before = c.regulars.map(r => r.loyalty);
  const buzzBefore = c.rival.buzz;
  const books = C.settleDarkNight(c, seeded(41));
  ok(books.social.dRep === 0, "a dark night moves your reputation neither way");
  ok(c.rep === 50, "so the number is where it was");
  ok(c.regulars.every((r, i) => before[i] - r.loyalty === 6), "every regular loses 6: the stay-home drift plus the closed doors");
  ok(books.social.showing.length === 0 && books.social.gained === null, "nobody showed, and nothing was minted");
  ok(c.rival.buzz >= buzzBefore, `and Vic got a free night (${buzzBefore} → ${c.rival.buzz})`);
}

// ---- the roster cap follows the room ----
{
  ok(R.regularCap(0) === 3 && R.regularCap(1) === 5 && R.regularCap(2) === 7 && R.regularCap(3) === 9, "the cap is 3, 5, 7, 9 up the ladder");
  const c = C.newCampaign();
  const rand = seeded(51);
  for (let i = 0; i < 10; i++) C.devAddRegular(c, rand);
  ok(c.regulars.length === 3, "the Corner Tap holds three and refuses a fourth");
  C.devWarpVenue(c, "flagship");
  for (let i = 0; i < 10; i++) C.devAddRegular(c, rand);
  ok(c.regulars.length === 9, "the flagship holds nine");
  // walked back down the ladder by the dev menu: the shakiest go, and are remembered
  c.regulars[4].loyalty = 2;
  const shakiest = c.regulars[4].name;
  C.devWarpVenue(c, "cornerTap");
  C.repairCampaign(c);
  ok(c.regulars.length === 3, "a save moved down to a smaller room is trimmed to its cap on load");
  ok(!c.regulars.some(r => r.name === shakiest) && c.regularsLost.some(l => l.name === shakiest), "the shakiest went first, and is remembered");
}

// ---- the league moves both needles ----
{
  // Deterministic route to a final: warp to the last Sunday of the bracket and
  // settle it. The winner is whatever the league rolls; assert on that.
  const c = C.newCampaign();
  C.devSetRep(c, 50);
  const finalDay = (await import("../js/league.js")).dateOf(c.league.season, 15, "Sun");
  C.devSetDay(c, finalDay);
  const repBefore = c.rep, buzzBefore = c.rival.buzz;
  const books = C.settleNight(c, nightOf({ serviceRate: 75, mood: 0.6, game: { finished: false, win: null } }), seeded(61));
  const played = books.games.find(g => g.playoff === "final");
  ok(!!played, "the season's final is settled on its own night");
  const rival = TEAMS.find(t => t.rival).id;
  if (played.winner === MULES) ok(c.rep >= repBefore + 4, "a Mules title is worth 4 on your name");
  else if (played.winner === rival) ok(c.rival.buzz >= buzzBefore + 6 - 3, "a Sharks title makes the End Zone the Sharks bar");
  else ok(c.rep === repBefore + books.social.dRep, "any other champion leaves both alone");
}

// ---- the rival's line, and the absence of a rival panel ----
{
  ok(R.rivalWord(75) === "packed nightly" && R.rivalWord(60) === "drawing crowds" && R.rivalWord(45) === "holding steady" && R.rivalWord(20) === "struggling",
    "rivalWord reads the four bands");
  ok(R.rivalLine(70, 3, 40).includes(R.RIVAL.name) && R.rivalLine(70, -3, 40).includes(R.RIVAL.owner), "the line names the bar or its owner");
  ok(R.rivalPressure(40, 50) === 0, "a rival behind your name drags nothing");
  ok(R.rivalPressure(95, 0) === 0.15, "and one 95 points ahead drags the maximum");
}

// ---- repair: the three fields are additive and the load is idempotent ----
{
  const c = C.repairCampaign({
    day: 12, cash: 500, stock: {}, staff: [],
    rep: "excellent", rival: { buzz: NaN }, regulars: "no", regularsLost: { nope: 1 },
  });
  ok(c.rep === 50 && c.rival.buzz === 45 && Array.isArray(c.regulars) && Array.isArray(c.regularsLost), "garbage in every one of them is replaced with the opening numbers");

  // repairRegulars() directly rather than through repairCampaign(): the Corner
  // Tap's cap of three would trim the fourth entry anyway, and a check the cap
  // can satisfy on its own is not checking the repair.
  const junk = { regulars: R.repairRegulars([
      { name: "", usual: "caviar", team: "XXX", loyalty: 900, visits: "lots" },
      { name: "Real Person", usual: "wings", team: MULES, loyalty: 0 },
      null, 7,
      { name: "Twin", id: "dup", usual: "fries", team: MULES, loyalty: 40 },
      { name: "Other", id: "dup", usual: "fries", team: MULES, loyalty: 40 },
    ], 12) };
  ok(junk.regulars.length === 3, "a null, a number and a zero-loyalty regular are all dropped");
  const first = junk.regulars[0];
  ok(first.name.startsWith("Regular ") && MENU[first.usual] && first.team === MULES && first.loyalty === 100 && first.visits === 0,
    "a nameless regular is numbered, an item off the menu is replaced, a team off the table becomes the Mules, and 900 loyalty clamps to 100");
  ok(new Set(junk.regulars.map(r => r.id)).size === junk.regulars.length, "and two regulars cannot share an id");
  ok(!junk.regulars.some(r => r.name === "Real Person"), "the zero-loyalty one is the one that went");

  const twice = R.repairRegulars(JSON.parse(JSON.stringify(junk.regulars)), 12);
  ok(JSON.stringify(R.repairRegulars(twice, 12)) === JSON.stringify(twice), "repairing a repaired roster changes nothing");
  const whole = C.repairCampaign({ day: 12, cash: 500, stock: {}, staff: [], regulars: junk.regulars, rep: 61, rival: { buzz: 70 } });
  ok(JSON.stringify(C.repairCampaign(JSON.parse(JSON.stringify(whole)))) === JSON.stringify(whole), "and repairCampaign is idempotent over all three fields");

  ok(R.repairRival({ buzz: 500 }).buzz === R.BUZZ_MAX && R.repairRival({ buzz: -5 }).buzz === R.BUZZ_MIN && R.repairRival(null).buzz === R.BUZZ_START,
    "buzz clamps to its band from either side, and a missing rival opens at 45");
  ok(R.repairLost([{ name: "A" }, null, { nope: 1 }, "x"]).length === 1, "a remembered name needs a name");
}

// ---- the first round on the house reaches the books (increment 2) ----
{
  ok(HOME_TEAM === MULES, "engine.js's HOME_TEAM is league.js's MULES");
  const list = [{ id: "a", loyalty: 50 }, { id: "b", loyalty: 50 }, { id: "c", loyalty: 50 }];
  R.driftLoyalty(list, { showing: new Set(["a", "b"]), stockedOut: new Set(["b"]), comped: new Set(["a", "b"]), good: true, ugly: false });
  ok(list[0].loyalty === 50 + 3 + R.COMP_LOYALTY, `a comped regular on a good night gets the 3 and the ${R.COMP_LOYALTY} (${list[0].loyalty})`);
  ok(list[1].loyalty === 50 - 8 + R.COMP_LOYALTY, "a comped regular whose usual was 86'd still loses the 8, and gets the round back");
  ok(list[2].loyalty === 49, "and somebody who stayed home is untouched by it");
  const none = [{ id: "a", loyalty: 50 }];
  R.driftLoyalty(none, { showing: new Set(["a"]), stockedOut: new Set(), good: true, ugly: false });
  ok(none[0].loyalty === 53, "no comped set at all is nobody comped");

  // the wiring: settleNight reads the summary's ids and the box score gets names
  const c = withRegulars(3, seeded(31));
  const inTonight = C.regularsIn(c);
  ok(inTonight.length >= 1, `somebody is in tonight (${inTonight.length})`);
  const who = inTonight[0];
  for (const id of FOOD) c.stock[id] = 40;
  const before = who.loyalty;
  const books = C.settleNight(c, nightOf({ comped: [who.id, "not-a-regular"] }), seeded(3));
  ok(who.loyalty === before + 3 + R.COMP_LOYALTY, `settleNight reads summary.comped and the regular is up ${3 + R.COMP_LOYALTY} (${before} → ${who.loyalty})`);
  ok(books.social.comped.join() === who.name, `and the books name them (${books.social.comped.join()})`);
  const c2 = withRegulars(3, seeded(31));
  for (const id of FOOD) c2.stock[id] = 40;
  const who2 = C.regularsIn(c2)[0], l0 = who2.loyalty;
  const plain = C.settleNight(c2, nightOf({ comped: "garbage" }), seeded(3));
  ok(who2.loyalty === l0 + 3 && plain.social.comped.length === 0, "a summary with no usable comped field comps nobody");
}

// ---- the save carries it ----
{
  const store = {};
  const storage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const c = withRegulars(3, seeded(71));
  C.devSetRep(c, 71); C.devSetBuzz(c, 88);
  c.regulars[0].loyalty = 42;
  C.saveCampaign(c, storage);
  const back = C.loadCampaign(storage);
  ok(back.rep === 71 && back.rival.buzz === 88, "reputation and the rival's buzz survive a save and a load");
  ok(back.regulars.length === 3 && back.regulars[0].loyalty === 42, "and so does the roster with its loyalties");
  ok(back.regulars.map(r => r.id).join() === c.regulars.map(r => r.id).join(), "ids and all, so tonight's list is the same list after a reload");
  ok(C.regularsIn(back).map(r => r.id).join() === C.regularsIn(c).map(r => r.id).join(), "which is what makes a reload mid-day show the same people");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
