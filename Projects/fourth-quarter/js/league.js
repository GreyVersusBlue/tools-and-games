// league.js — the MAFA season. Pure: no DOM, no three.js, no campaign.js.
//
// The calendar is the schedule. Which season and week it is, whether the
// league is in its regular season, its bracket or its off-season, and which
// games are on tonight are all functions of the campaign's day number and
// nothing else (SEASON_DAYS is a whole number of weeks, so every season opens
// on a Monday). A save carries only what the calendar cannot derive: the
// results, the seeds those results produced, the champions so far, and the
// generator state that rolled them. Records and standings are recomputed from
// the results every time they are asked for, so a record can never disagree
// with the games that made it.
//
// One invariant, held by syncLeague(): every game dated before today has been
// played and no game dated today or later has. A save from before the league
// existed is caught up to its day by playing what the calendar says is behind
// it; a day the dev menu walked backwards un-plays what is ahead of it.
// settleLeagueNight() plays tonight's games at settlement, taking the Mules'
// result from the night engine so the standings say what the room saw.
//
// Results come off the same mulberry32 the engine uses, stepped over the
// league's own stored state rather than the engine's module-level one, so two
// campaigns seeded the same produce the same season whatever the engine did in
// between.

import { mulberry32 } from "./engine.js";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const MULES = "FVM";
export const TEAMS = [
  { id: "FVM", name: "Fairview Mules",       short: "Mules",    local: true },
  { id: "HCS", name: "Harbor City Sharks",   short: "Sharks",   rival: true },
  { id: "IRB", name: "Iron Ridge Bulldogs",  short: "Bulldogs" },
  { id: "CPK", name: "Capital Kings",        short: "Kings" },
  { id: "PVA", name: "Port Vernon Admirals", short: "Admirals" },
  { id: "RSR", name: "Redstone Rattlers",    short: "Rattlers" },
  { id: "LKL", name: "Lakeshore Loons",      short: "Loons" },
  { id: "SMS", name: "Summit Stags",         short: "Stags" },
];
export const teamDef = id => TEAMS.find(t => t.id === id);

export const REG_WEEKS = (TEAMS.length - 1) * 2;        // 14: a double round-robin
export const PLAYOFF_WEEKS = 2;                          // semifinals, then the final
export const SEASON_WEEKS = REG_WEEKS + PLAYOFF_WEEKS;   // 16
export const OFFSEASON_NIGHTS = 14;                      // two dark weeks, so the next season opens on a Monday
export const SEASON_DAYS = SEASON_WEEKS * 7 + OFFSEASON_NIGHTS; // 126
export const BRACKET = 4;
// The four games of a regular week land on these nights, rotated one slot per
// week, so the Mules (always game 0) play Thursday, Sunday, Sunday, Monday and
// round again. Two games share a Sunday.
export const WEEK_SLOTS = ["Thu", "Sun", "Sun", "Mon"];

// Crowd multipliers by what is on the screens tonight. `mules` is what a game
// night was worth before the league existed (forecast()'s 1.5); the rest are
// spread around it. A dead rubber still beats a quiet night.
export const CROWD = {
  quiet: 1, offseason: 1,
  league: 1.15, leaguePlayoff: 1.3,
  mules: 1.5, dead: 1.25, rivalry: 1.75, semi: 1.9, final: 2.2,
};

// ---------- the calendar ----------
export function seasonOf(day) { return Math.floor((day - 1) / SEASON_DAYS) + 1; }
export function seasonStart(season) { return (season - 1) * SEASON_DAYS + 1; }
/** 0-based week within the season: 0-13 regular, 14 semis, 15 final, 16-17 off. */
export function weekOf(day) { return Math.floor((day - seasonStart(seasonOf(day))) / 7); }
export function phaseOf(day) {
  const w = weekOf(day);
  return w < REG_WEEKS ? "regular" : w < SEASON_WEEKS ? "playoffs" : "offseason";
}
export function weekdayOf(day) { return DAYS[(day - 1) % 7]; }
/** The campaign day a game in `week` of `season` on weekday `wd` is played. */
export function dateOf(season, week, wd) { return seasonStart(season) + week * 7 + DAYS.indexOf(wd); }
export function gameDate(L, week, g) { return dateOf(L.season, week, g.day); }

// ---------- the generator ----------
function roll(L) { const r = mulberry32(L.rng); L.rng = r.state; return r.value; }

// ---------- fixtures ----------
/** Circle method over the eight ids, the Mules fixed at the top of the wheel
 *  and the other seven dealt by the generator, so two seeds give two
 *  schedules. Rounds r and r+7 pair the same teams with home and away
 *  swapped, which is what the parity flip does. */
function mkWeeks(L) {
  const others = TEAMS.filter(t => t.id !== MULES).map(t => t.id);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(roll(L) * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const n = TEAMS.length, weeks = [];
  for (let r = 0; r < REG_WEEKS; r++) {
    const rot = r % (n - 1);
    const lineup = [MULES, ...others.slice(rot), ...others.slice(0, rot)];
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = lineup[i], b = lineup[n - 1 - i];
      const [home, away] = r % 2 === 0 ? [a, b] : [b, a];
      games.push({ home, away, day: WEEK_SLOTS[(i + r) % WEEK_SLOTS.length], played: false, winner: null });
    }
    weeks.push(games);
  }
  return weeks;
}

export function newLeague(seed = 0) {
  const L = { seed: seed >>> 0, rng: seed >>> 0, season: 1, weeks: [], seeds: null, champion: null, history: [] };
  L.weeks = mkWeeks(L);
  return L;
}
function startSeason(L, season) {
  L.season = season; L.seeds = null; L.champion = null;
  L.weeks = mkWeeks(L);
}

/** A save's league record is usable if it has the four things nothing here
 *  can rebuild from the calendar. Anything less is rebuilt whole. */
export function validLeague(L) {
  return !!L && typeof L === "object"
    && Number.isInteger(L.season) && L.season >= 1
    && Number.isFinite(L.rng) && Array.isArray(L.weeks) && L.weeks.length >= REG_WEEKS
    && L.weeks.every(w => Array.isArray(w) && w.every(g => g && typeof g === "object" && teamDef(g.home) && teamDef(g.away) && DAYS.includes(g.day)))
    && Array.isArray(L.history);
}

// ---------- reading the season ----------
/** Every game of the stored season in date order, each with its week index. */
export function allGames(L) {
  const out = [];
  L.weeks.forEach((games, week) => {
    const sorted = games.map((g, i) => ({ g, i })).sort((a, b) => DAYS.indexOf(a.g.day) - DAYS.indexOf(b.g.day) || a.i - b.i);
    for (const { g } of sorted) out.push({ g, week, date: gameDate(L, week, g) });
  });
  return out;
}

/** Every team's record from the games actually played: regular-season wins
 *  and losses, games played, and the current streak (+n or -n) counting
 *  bracket games too. Derived, never stored. */
export function records(L) {
  const rec = {};
  for (const t of TEAMS) rec[t.id] = { id: t.id, w: 0, l: 0, gp: 0, streak: 0 };
  for (const { g } of allGames(L)) {
    if (!g.played) continue;
    const w = rec[g.winner], l = rec[g.winner === g.home ? g.away : g.home];
    if (!g.playoff) { w.w++; w.gp++; l.l++; l.gp++; }
    w.streak = w.streak > 0 ? w.streak + 1 : 1;
    l.streak = l.streak < 0 ? l.streak - 1 : -1;
  }
  return rec;
}

/** Wins, then fewer losses, then id — one deterministic order, used for the
 *  corkboard table and for seeding the bracket alike. */
export function standings(L) {
  const rec = records(L);
  return TEAMS.map(t => rec[t.id]).sort((a, b) => b.w - a.w || a.l - b.l || (a.id < b.id ? -1 : 1));
}

/** Where the Mules stand against the bracket line: "alive", "clinched" (fewer
 *  than four other teams can still finish level with them) or "eliminated"
 *  (four other teams already have more wins than the Mules can reach). */
export function stakes(L) {
  const rec = records(L), m = rec[MULES];
  const max = r => r.w + (REG_WEEKS - r.gp);
  const others = TEAMS.filter(t => t.id !== MULES).map(t => rec[t.id]);
  if (others.filter(r => r.w > max(m)).length >= BRACKET) return "eliminated";
  if (others.filter(r => max(r) >= m.w).length < BRACKET) return "clinched";
  return "alive";
}

/** Chance the home side wins: 0.53 for the house, four points a game of
 *  streak either way, never past 0.2 or 0.8. */
export function winProb(L, g) {
  const rec = records(L);
  const p = 0.53 + (rec[g.home].streak - rec[g.away].streak) * 0.04;
  return Math.max(0.2, Math.min(0.8, p));
}

/** The games the stored season has on this day, played or not. Empty when
 *  the save's season is not the calendar's — syncLeague() fixes that. */
export function gamesOn(L, day) {
  if (L.season !== seasonOf(day)) return [];
  const week = L.weeks[weekOf(day)];
  if (!week) return [];
  const wd = weekdayOf(day);
  return week.filter(g => g.day === wd);
}

/** What is on the screens tonight, and what it is worth at the door. */
export function tonight(L, day) {
  const games = gamesOn(L, day), phase = phaseOf(day), week = weekOf(day);
  const mules = games.find(g => g.home === MULES || g.away === MULES) || null;
  const t = { phase, week, season: seasonOf(day), games, mules, opp: null, home: false, kind: "quiet", crowd: CROWD.quiet, label: "No game tonight" };
  if (mules) {
    t.home = mules.home === MULES;
    t.opp = teamDef(t.home ? mules.away : mules.home);
    const vs = `Mules ${t.home ? "vs" : "at"} ${t.opp.short}`;
    if (mules.playoff === "final") { t.kind = "final"; t.label = `Championship night — ${vs}`; }
    else if (mules.playoff === "semi") { t.kind = "semi"; t.label = `Playoff night — ${vs}`; }
    else if (t.opp.rival) { t.kind = "rivalry"; t.label = `Rivalry night — ${vs}`; }
    else if (stakes(L) === "eliminated") { t.kind = "dead"; t.label = `${vs} — nothing on the line`; }
    else { t.kind = "mules"; t.label = `Mules game — ${vs}`; }
  } else if (games.length) {
    const g = games.find(x => x.playoff) || games[0];
    t.kind = g.playoff ? "leaguePlayoff" : "league";
    t.label = `${teamDef(g.away).short} at ${teamDef(g.home).short}${g.playoff === "final" ? " for the title" : g.playoff ? ", playoffs" : ""} on the screens`;
  } else if (phase === "offseason") {
    t.kind = "offseason"; t.label = "Off-season — highlights on the screens";
  }
  t.crowd = CROWD[t.kind];
  return t;
}

// ---------- playing ----------
function playGame(L, g, winner) {
  // odds first: winProb() reads records(), which counts played games
  const w = winner ?? (roll(L) < winProb(L, g) ? g.home : g.away);
  g.played = true; g.winner = w;
}
function regularDone(L) { return L.weeks.slice(0, REG_WEEKS).every(w => w.every(g => g.played)); }
function semisDone(L) { return L.weeks.length > REG_WEEKS && L.weeks[REG_WEEKS].every(g => g.played); }

/** Seed the bracket when the calendar reaches week 14: 2 v 3 on the Thursday,
 *  1 v 4 on the Sunday, the higher seed at home; the final the Sunday after,
 *  the higher seed hosting. Bracket games do not touch the standings. */
function growBracket(L, day) {
  // relative to the stored season, not the calendar's: playThrough() runs a
  // season out with a day that is already the next season's first Monday
  const week = Math.floor((day - seasonStart(L.season)) / 7);
  if (week >= REG_WEEKS && L.weeks.length === REG_WEEKS && regularDone(L)) {
    L.seeds = standings(L).slice(0, BRACKET).map(r => r.id);
    L.weeks.push([
      { home: L.seeds[1], away: L.seeds[2], day: "Thu", played: false, winner: null, playoff: "semi" },
      { home: L.seeds[0], away: L.seeds[3], day: "Sun", played: false, winner: null, playoff: "semi" },
    ]);
  }
  if (week >= REG_WEEKS + 1 && L.weeks.length === REG_WEEKS + 1 && semisDone(L)) {
    const w = L.weeks[REG_WEEKS].map(g => g.winner).sort((a, b) => L.seeds.indexOf(a) - L.seeds.indexOf(b));
    L.weeks.push([{ home: w[0], away: w[1], day: "Sun", played: false, winner: null, playoff: "final" }]);
  }
  if (week >= SEASON_WEEKS && L.weeks.length === SEASON_WEEKS && !L.champion) {
    const final = L.weeks[REG_WEEKS + 1][0];
    if (final.played) {
      L.champion = final.winner;
      if (!L.history.some(h => h.season === L.season)) L.history.push({ season: L.season, champion: final.winner });
    }
  }
}

/** Play every unplayed game dated before `day`, growing the bracket as the
 *  calendar allows. Games and bracket rounds interleave: the semis cannot be
 *  seeded until the regular season is played, so the loop runs until nothing
 *  changes. */
function playThrough(L, day) {
  for (;;) {
    let moved = false;
    for (const { g, date } of allGames(L)) {
      if (!g.played && date < day) { playGame(L, g); moved = true; }
    }
    const before = L.weeks.length, champ = L.champion;
    growBracket(L, day);
    if (!moved && L.weeks.length === before && L.champion === champ) return;
  }
}

/**
 * Hold the invariant: the stored season is the calendar's; every game dated
 * before `day` is played and none dated `day` or later is. Idempotent, and the
 * only writer besides settleLeagueNight(). Called on every load (repair) and
 * after every day change. `settling` is settleLeagueNight()'s flag: tonight's
 * games are being played right now, so a result dated `day` stands.
 */
export function syncLeague(L, day, settling = false) {
  const season = seasonOf(day);
  // behind the calendar: finish each season out and open the next
  while (L.season < season) {
    playThrough(L, seasonStart(L.season + 1));
    startSeason(L, L.season + 1);
  }
  // ahead of it (the dev menu walked the day back): that season never happened
  if (L.season > season) {
    L.history = L.history.filter(h => h.season < season);
    startSeason(L, season);
  }
  // un-play what is dated today or later, and drop a bracket the calendar has not reached
  const week = weekOf(day);
  if (week < REG_WEEKS) { L.weeks.length = REG_WEEKS; L.seeds = null; }
  else if (week < REG_WEEKS + 1) L.weeks.length = Math.min(L.weeks.length, REG_WEEKS + 1);
  if (week < SEASON_WEEKS) {
    L.champion = null;
    L.history = L.history.filter(h => h.season < L.season);
  }
  for (const { g, date } of allGames(L)) if (g.played && (settling ? date > day : date >= day)) { g.played = false; g.winner = null; }
  playThrough(L, day);
  return L;
}

/**
 * Settle tonight's games. `mulesWin` is the night engine's result for the
 * Mules' game — true, false, or null when the engine never finished one (a
 * dark night, a save caught up from before the league existed), in which case
 * the league rolls it. Call before the campaign's day advances, then
 * syncLeague() with the new day.
 */
export function settleLeagueNight(L, day, mulesWin = null) {
  syncLeague(L, day, true);
  const out = [];
  for (const g of gamesOn(L, day)) {
    if (g.played) continue;
    const isMules = g.home === MULES || g.away === MULES;
    const forced = isMules && typeof mulesWin === "boolean"
      ? (mulesWin ? MULES : (g.home === MULES ? g.away : g.home))
      : null;
    playGame(L, g, forced);
    out.push(g);
  }
  growBracket(L, day + 1);
  return out;
}
