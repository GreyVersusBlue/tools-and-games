// smoke-league.mjs — node test/smoke-league.mjs
// The MAFA season as a pure model: the calendar, the fixtures, the bracket,
// the off-season, the generator, and the one invariant syncLeague() holds.

import * as LG from "../js/league.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const played = L => LG.allGames(L).filter(x => x.g.played);
const invariantHolds = (L, day) => LG.allGames(L).every(({ g, date }) => g.played === (date < day));

// ---- the calendar is the schedule ----
ok(LG.SEASON_DAYS % 7 === 0, "a season is a whole number of weeks, so every season opens on a Monday");
ok(LG.weekdayOf(LG.seasonStart(2)) === "Mon" && LG.weekdayOf(LG.seasonStart(5)) === "Mon", "seasons 2 and 5 open on Mondays");
ok(LG.seasonOf(1) === 1 && LG.seasonOf(LG.SEASON_DAYS) === 1 && LG.seasonOf(LG.SEASON_DAYS + 1) === 2, "seasonOf: the last day of season 1 is season 1, the next is season 2");
ok(LG.weekOf(1) === 0 && LG.weekOf(7) === 0 && LG.weekOf(8) === 1, "weekOf: days 1-7 are week 0, day 8 is week 1");
ok(LG.phaseOf(98) === "regular" && LG.phaseOf(99) === "playoffs" && LG.phaseOf(112) === "playoffs" && LG.phaseOf(113) === "offseason" && LG.phaseOf(126) === "offseason" && LG.phaseOf(127) === "regular",
  "phase: 14 regular weeks, 2 bracket weeks, 14 dark nights, then the next season");
ok(LG.dateOf(1, 0, "Thu") === 4 && LG.dateOf(1, 13, "Sun") === 98 && LG.dateOf(2, 0, "Mon") === 127, "dateOf agrees with the day numbers");

// ---- fixtures ----
const L = LG.newLeague(5);
ok(L.season === 1 && L.weeks.length === LG.REG_WEEKS && L.seeds === null && L.champion === null && L.history.length === 0 && L.seed === 5, "a fresh league is week 0 of season 1 with no bracket");
ok(L.weeks.every(w => w.length === 4), "every regular week has four games");
{
  const seen = {};
  for (const w of L.weeks) for (const g of w) {
    seen[g.home] = (seen[g.home] || 0) + 1; seen[g.away] = (seen[g.away] || 0) + 1;
  }
  ok(Object.keys(seen).length === 8 && Object.values(seen).every(n => n === 14), "every team is scheduled exactly 14 games");
  const pairs = {};
  for (const w of L.weeks) for (const g of w) { const k = [g.home, g.away].sort().join("-"); pairs[k] = (pairs[k] || 0) + 1; }
  ok(Object.keys(pairs).length === 28 && Object.values(pairs).every(n => n === 2), "every pairing appears twice (a double round-robin)");
  const homes = {};
  for (const w of L.weeks) for (const g of w) homes[g.home] = (homes[g.home] || 0) + 1;
  ok(Object.values(homes).every(n => n === 7), "every team hosts 7 of its 14");
  const perWeek = L.weeks.every(w => new Set(w.flatMap(g => [g.home, g.away])).size === 8);
  ok(perWeek, "no team plays twice in a week");
  const mulesDays = L.weeks.map(w => w.find(g => g.home === LG.MULES || g.away === LG.MULES).day);
  ok(mulesDays.join() === "Thu,Sun,Sun,Mon,Thu,Sun,Sun,Mon,Thu,Sun,Sun,Mon,Thu,Sun", `the Mules' night rotates Thu, Sun, Sun, Mon (${mulesDays.join()})`);
  ok(L.weeks.every(w => w.every(g => LG.WEEK_SLOTS.includes(g.day))), "every game is on one of the week's slot nights");
}

// ---- the generator ----
{
  const a = LG.newLeague(5), b = LG.newLeague(5), c = LG.newLeague(6);
  ok(JSON.stringify(a.weeks) === JSON.stringify(b.weeks), "the same seed deals the same fixtures");
  ok(JSON.stringify(a.weeks) !== JSON.stringify(c.weeks), "a different seed deals different ones");
  LG.syncLeague(a, 200); LG.syncLeague(b, 200); LG.syncLeague(c, 200);
  ok(JSON.stringify(a) === JSON.stringify(b), "two campaigns seeded the same produce the same season, results and all");
  ok(JSON.stringify(a) !== JSON.stringify(c), "and different seeds do not");
}

// ---- syncLeague holds the invariant ----
ok(invariantHolds(L, 1), "day 1: nothing is played");
LG.syncLeague(L, 40);
ok(invariantHolds(L, 40), "synced to day 40: everything dated before 40 is played, nothing on or after");
ok(played(L).length === 22, `day 40 has 22 results behind it (${played(L).length})`);
ok(L.weeks.length === LG.REG_WEEKS && L.seeds === null, "no bracket yet at week 5");
{
  const rec = LG.records(L);
  const gps = Object.values(rec).map(r => r.gp);
  ok(Math.max(...gps) - Math.min(...gps) <= 1, "mid-week, no team is more than one game ahead of another");
  ok(Object.values(rec).every(r => r.w + r.l === r.gp), "wins plus losses is games played, for every team");
  ok(Object.values(rec).reduce((s, r) => s + r.w, 0) === 22, "one win per game played");
}
ok(LG.syncLeague(L, 40) && played(L).length === 22 && invariantHolds(L, 40), "syncing the same day again changes nothing (idempotent)");

// ---- tonight ----
{
  const t4 = LG.tonight(L, 4);
  ok(t4.mules && t4.kind === "mules" && t4.crowd === LG.CROWD.mules && t4.phase === "regular", "day 4 (Thu, week 0) is a Mules game at the old 1.5");
  ok(t4.opp && t4.opp.id !== LG.MULES && / Mules (vs|at) /.test(t4.label), `tonight names the opponent (${t4.label})`);
  const t2 = LG.tonight(L, 2);
  ok(!t2.mules && t2.games.length === 0 && t2.kind === "quiet" && t2.crowd === 1, "a Tuesday is nobody's game night");
  const t1 = LG.tonight(L, 1);
  ok(!t1.mules && t1.games.length === 1 && t1.kind === "league" && t1.crowd === LG.CROWD.league && / on the screens$/.test(t1.label), "day 1 (Mon) has another league game on the screens");
  const t7 = LG.tonight(L, 7);
  ok(t7.games.length === 2, "two games share a Sunday");
  // the rival: find the Mules-Sharks week and check the label and the crowd
  const rivalWeek = L.weeks.findIndex(w => w.some(g => (g.home === LG.MULES && g.away === "HCS") || (g.away === LG.MULES && g.home === "HCS")));
  const rg = L.weeks[rivalWeek].find(g => g.home === "HCS" || g.away === "HCS");
  const tr = LG.tonight(L, LG.dateOf(1, rivalWeek, rg.day));
  ok(tr.kind === "rivalry" && tr.crowd === LG.CROWD.rivalry && /^Rivalry night/.test(tr.label), "a Mules-Sharks night is a rivalry night, 1.75");
  ok(LG.CROWD.rivalry > LG.CROWD.mules && LG.CROWD.semi > LG.CROWD.rivalry && LG.CROWD.final > LG.CROWD.semi && LG.CROWD.dead < LG.CROWD.mules && LG.CROWD.dead > LG.CROWD.league,
    "the crowd table orders final > semi > rivalry > game > dead rubber > another team's game");
  ok(LG.tonight(L, 120).kind === "offseason" && LG.tonight(L, 120).crowd === 1, "an off-season night is 1× with the off-season label");
  ok(LG.tonight(L, 127).games.length === 0, "a day the save's season has not reached has no games until syncLeague() runs");
}

// ---- stakes: a dead rubber ----
{
  // week 13, and the Mules have lost everything: eliminated, so their last game is a dead rubber
  const D = LG.newLeague(9);
  LG.syncLeague(D, LG.dateOf(1, 12, "Mon"));
  for (const w of D.weeks) for (const g of w) if (g.played && (g.home === LG.MULES || g.away === LG.MULES)) g.winner = g.home === LG.MULES ? g.away : g.home;
  ok(LG.stakes(D) === "eliminated", "0-12 with two to play is eliminated");
  const g13 = D.weeks[13].find(g => g.home === LG.MULES || g.away === LG.MULES);
  const t = LG.tonight(D, LG.dateOf(1, 13, g13.day));
  ok(t.kind === (t.opp.rival ? "rivalry" : "dead") && t.crowd === (t.opp.rival ? LG.CROWD.rivalry : LG.CROWD.dead), "an eliminated Mules' game is a dead rubber (unless it is the Sharks)");
  // and the mirror: every game won is clinched
  for (const w of D.weeks) for (const g of w) if (g.played && (g.home === LG.MULES || g.away === LG.MULES)) g.winner = LG.MULES;
  ok(LG.stakes(D) === "clinched", "12-0 with two to play has clinched");
  const E = LG.newLeague(9); LG.syncLeague(E, 8);
  ok(LG.stakes(E) === "alive", "1-0 in week 1 is alive");
  // the boundaries, rigged: `strong` teams beat everyone else, otherwise the home side wins
  const rig = strong => {
    const R = LG.newLeague(9); LG.syncLeague(R, LG.dateOf(1, 12, "Mon"));
    for (const w of R.weeks) for (const g of w) if (g.played) {
      const hs = strong.includes(g.home), as = strong.includes(g.away);
      g.winner = hs === as ? g.home : hs ? g.home : g.away;
    }
    return R;
  };
  const rec4 = rig(["HCS", "IRB", "CPK", "PVA"]);
  const above = Object.values(LG.records(rec4)).filter(r => r.id !== LG.MULES && r.w > LG.records(rec4)[LG.MULES].w + 2).length;
  ok(above === 4 && LG.stakes(rec4) === "eliminated", `exactly four teams out of reach is eliminated (${above} above)`);
  const rec3 = rig(["HCS", "IRB", "CPK"]);
  ok(LG.stakes(rec3) !== "eliminated", "three out of reach is not");
  const top4 = rig([LG.MULES, "HCS", "IRB", "CPK"]);
  const reach = Object.values(LG.records(top4)).filter(r => r.id !== LG.MULES && r.w + 2 >= LG.records(top4)[LG.MULES].w).length;
  ok(reach === 3 && LG.stakes(top4) === "clinched", `three teams able to catch the Mules is clinched (${reach} can)`);
  const top5 = rig([LG.MULES, "HCS", "IRB", "CPK", "PVA"]);
  const reach5 = Object.values(LG.records(top5)).filter(r => r.id !== LG.MULES && r.w + 2 >= LG.records(top5)[LG.MULES].w).length;
  ok(reach5 === 4 && LG.stakes(top5) === "alive", `four able to catch them is still alive (${reach5} can)`);
}

// ---- a full season: 14 weeks, a bracket, a champion, an off-season, a new season ----
{
  const S = LG.newLeague(5);
  LG.syncLeague(S, LG.dateOf(1, LG.REG_WEEKS, "Mon")); // first day of the bracket
  ok(Object.values(LG.records(S)).every(r => r.gp === 14), "at week 14, every team has played exactly 14");
  ok(S.weeks.length === LG.REG_WEEKS + 1 && Array.isArray(S.seeds) && S.seeds.length === 4, "the semis are seeded the Monday of week 14");
  const st = LG.standings(S);
  ok(S.seeds.join() === st.slice(0, 4).map(r => r.id).join(), "the seeds are the top four of the standings");
  const semis = S.weeks[LG.REG_WEEKS];
  ok(semis[0].home === S.seeds[1] && semis[0].away === S.seeds[2] && semis[0].day === "Thu" && semis[0].playoff === "semi", "Thursday: 2 hosts 3");
  ok(semis[1].home === S.seeds[0] && semis[1].away === S.seeds[3] && semis[1].day === "Sun" && semis[1].playoff === "semi", "Sunday: 1 hosts 4");
  ok(semis.every(g => !g.played), "and neither is played yet");
  ok(S.weeks.length === LG.REG_WEEKS + 1, "the final is not set before the semis are played");
  LG.syncLeague(S, LG.dateOf(1, LG.REG_WEEKS + 1, "Mon"));
  ok(semis.every(g => g.played) && S.weeks.length === LG.SEASON_WEEKS, "the Monday after: both semis played, the final set");
  const fin = S.weeks[LG.REG_WEEKS + 1][0];
  ok(fin.playoff === "final" && fin.day === "Sun" && S.seeds.indexOf(fin.home) < S.seeds.indexOf(fin.away), "the final is Sunday, the higher seed hosting");
  ok(semis.map(g => g.winner).sort().join() === [fin.home, fin.away].sort().join(), "the final is between the two semi winners");
  ok(S.champion === null, "no champion before the final is played");
  const wl = LG.records(S);
  ok(Object.values(wl).every(r => r.gp === 14), "bracket games do not touch the standings");
  LG.syncLeague(S, LG.dateOf(1, LG.SEASON_WEEKS, "Mon")); // first off-season morning
  ok(fin.played && S.champion === fin.winner, "the final's winner is the champion");
  ok(S.history.length === 1 && S.history[0].season === 1 && S.history[0].champion === S.champion, "and is written into history once");
  LG.syncLeague(S, LG.dateOf(1, LG.SEASON_WEEKS, "Mon") + 5);
  ok(S.history.length === 1 && S.champion === fin.winner && S.weeks.length === LG.SEASON_WEEKS, "five off-season nights later nothing has changed");
  ok(LG.tonight(S, LG.dateOf(1, LG.SEASON_WEEKS, "Mon") + 5).kind === "offseason", "the off-season is on the screens");
  // the off-season is finite
  const s2 = LG.seasonStart(2);
  LG.syncLeague(S, s2);
  ok(S.season === 2 && S.weeks.length === LG.REG_WEEKS && S.champion === null && S.seeds === null, "season 2 opens with fresh fixtures and no bracket");
  ok(S.history.length === 1, "season 1's champion is still in history");
  ok(played(S).length === 0 && invariantHolds(S, s2), "nothing in season 2 is played on its first morning");
  ok(LG.tonight(S, s2 + 3).mules !== null, "the Mules play the first Thursday of season 2");
  // ...and it can be jumped
  const J = LG.newLeague(5);
  LG.syncLeague(J, LG.seasonStart(4) + 10);
  ok(J.season === 4 && J.history.length === 3 && J.history.map(h => h.season).join() === "1,2,3", "a jump to season 4 writes three champions on the way");
  ok(invariantHolds(J, LG.seasonStart(4) + 10), "and holds the invariant on landing");
}

// ---- walking the day back (the dev menu) ----
{
  const B = LG.newLeague(5);
  LG.syncLeague(B, 120);
  ok(B.champion !== null, "day 120 has a champion");
  LG.syncLeague(B, 50);
  ok(invariantHolds(B, 50) && B.weeks.length === LG.REG_WEEKS && B.seeds === null && B.champion === null && B.history.length === 0,
    "back to day 50: bracket gone, champion gone, history empty, invariant holds");
  LG.syncLeague(B, LG.seasonStart(3) + 2);
  LG.syncLeague(B, LG.seasonStart(2) + 2);
  ok(B.season === 2 && B.history.length === 1 && invariantHolds(B, LG.seasonStart(2) + 2), "back a whole season: season 3 never happened, season 1's champion stays");
}

// ---- settleLeagueNight: tonight's games, the Mules' result from outside ----
{
  const N = LG.newLeague(5);
  LG.syncLeague(N, 4);
  const g = LG.tonight(N, 4).mules;
  ok(g && !g.played, "day 4's Mules game is unplayed before settlement");
  const out = LG.settleLeagueNight(N, 4, false);
  ok(out.length === 1 && out[0] === g && g.played && g.winner !== LG.MULES, "settling with a loss: the game is played and the other side won");
  ok(LG.records(N)[LG.MULES].l === 1 && LG.records(N)[LG.MULES].streak === -1, "the loss is in the records");
  LG.syncLeague(N, 5);
  ok(invariantHolds(N, 5) && g.played && g.winner !== LG.MULES, "the next morning's sync keeps the result");
  const N2 = LG.newLeague(5); LG.syncLeague(N2, 4);
  LG.settleLeagueNight(N2, 4, true);
  ok(LG.tonight(N2, 4).mules.winner === LG.MULES, "settling with a win: the Mules won");
  const N3 = LG.newLeague(5); LG.syncLeague(N3, 7);
  const out7 = LG.settleLeagueNight(N3, 7, null);
  ok(out7.length === 2 && out7.every(x => x.played), "a Sunday with no Mules game settles both games off the league's own rolls");
  ok(LG.settleLeagueNight(N3, 7, null).length === 0, "settling the same night twice plays nothing new");
  // the Mules' result with no engine (a dark night): the league rolls it
  const N4 = LG.newLeague(5); LG.syncLeague(N4, 4);
  const out4 = LG.settleLeagueNight(N4, 4, null);
  ok(out4.length === 1 && out4[0].played && [out4[0].home, out4[0].away].includes(out4[0].winner), "a dark night on a game night: the league rolls the Mules' game itself");
  // a championship final settled from the engine crowns the champion the same night
  const N5 = LG.newLeague(5); const finDay = LG.dateOf(1, LG.REG_WEEKS + 1, "Sun"); LG.syncLeague(N5, finDay);
  const f = N5.weeks[LG.REG_WEEKS + 1][0];
  const mulesInFinal = f.home === LG.MULES || f.away === LG.MULES;
  LG.settleLeagueNight(N5, finDay, mulesInFinal ? true : null);
  ok(f.played && N5.champion === f.winner && N5.history.length === 1, "settling the final crowns the champion that night");
  if (mulesInFinal) ok(N5.champion === LG.MULES, "and a Mules win in the final is a Mules title");
}

// ---- winProb ----
{
  const W = LG.newLeague(5);
  const g = W.weeks[0][0];
  ok(Math.abs(LG.winProb(W, g) - 0.53) < 1e-9, "with no form, the home side is 0.53");
  LG.syncLeague(W, 60);
  ok(LG.allGames(W).every(({ g }) => LG.winProb(W, g) >= 0.2 && LG.winProb(W, g) <= 0.8), "every game's odds sit in [0.2, 0.8]");
}

// ---- validLeague ----
{
  ok(LG.validLeague(LG.newLeague(1)), "a fresh league is valid");
  ok(!LG.validLeague(null) && !LG.validLeague({}) && !LG.validLeague({ season: 1, rng: 1, weeks: [], history: [] }), "null, empty, and no weeks are not");
  const bad = LG.newLeague(1); bad.weeks[3][1].home = "XXX";
  ok(!LG.validLeague(bad), "a game with a team that does not exist is not");
  const rt = JSON.parse(JSON.stringify(LG.newLeague(2)));
  ok(LG.validLeague(rt), "and a JSON round trip is");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
