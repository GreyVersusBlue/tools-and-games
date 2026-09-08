// campaign.js — the books between nights. Pure logic, storage-agnostic:
// pass any localStorage-shaped object (tests pass a plain stub).
// Owns cash, the calendar, stock, the crew, tonight's promo, and settlement.

import { MENU, FOOD } from "./engine.js";
// Relative, not "/assets/js/gvb-save.js": this module is also imported by
// test/smoke-campaign.mjs under plain Node, which cannot resolve a site-absolute
// specifier. The relative path resolves the same in both.
import { LAYOUTS, seatsFor } from "./layout.js";
import { DAYS, MULES, TEAMS as LEAGUE_TEAMS, newLeague, validLeague, syncLeague, settleLeagueNight, tonight as leagueTonight, winProb } from "./league.js";
import * as R from "./regulars.js";
import * as EV from "./events.js";
import { createSaveSlot } from "../../../assets/js/gvb-save.js";

export { DAYS };
export { RIVAL } from "./regulars.js";
export const SAVE_KEY = "fq3d-save";
export const RENT = 110;
export const BASE_CROWD = { Mon: 26, Tue: 20, Wed: 28, Thu: 34, Fri: 44, Sat: 48, Sun: 38 };

// per-serving wholesale cost
export const STOCK_COST = { wings: 3.2, burger: 3.8, nachos: 2.5, fries: 1.2, beer: 1.85, soda: 0.5 };

export const PROMOS = {
  none:      { id: "none",      name: "No Theme",    cost: 0,  crowd: 1,
               desc: "A regular night. The room is what it is." },
  wingnight: { id: "wingnight", name: "Wing Night",  cost: 0,  crowd: 1.25,
               desc: "Wings 40% off. Packs the room, drains the walk-in — volume over margin." },
  happyhour: { id: "happyhour", name: "Happy Hour",  cost: 0,  crowd: 1.12,
               desc: "Drinks 25% off until 7 PM. Front-loads the night, squeezes early margins." },
  watchparty:{ id: "watchparty",name: "Watch Party", cost: 50, crowd: 1.3, needsGame: true,
               desc: "$50 in giveaways. Big draw on a game night — dead money on any other." },
};

// ---------- venue ladder (one-way moves; the 3D room itself lives in world.js) ----------
// Each tier: buzzMult lifts forecast(), rent is the nightly bill (base RENT at the
// Corner Tap, up $50/rung above it — see the note on `rent()` below), darkNights is
// how many closed nights (rent/wages/upkeep still due, no revenue) it takes to move
// in before the doors can reopen.
//
// `seats` is derived from the tier's floor plan in layout.js — the physical
// stools world.js builds, counted before a mesh exists — so the number on the
// Real Estate card and the number the night engine caps arrivals at cannot
// drift apart. (For two rounds it was a literal 30 four times over, on
// purpose: every tier was the Corner Tap's room and a varying number would
// have lied. Phase 2 authored the rooms.)
export const VENUES = {
  cornerTap:  { id: "cornerTap",  name: "The Corner Tap",     order: 0, cost: 0,     seats: seatsFor(LAYOUTS.cornerTap).length, buzzMult: 1.00, darkNights: 0, rent: 110,
                desc: "Where you started. Six tables, six stools, one stove, one tap." },
  fieldhouse: { id: "fieldhouse", name: "The Fieldhouse",     order: 1, cost: 5500,  seats: seatsFor(LAYOUTS.fieldhouse).length, buzzMult: 1.15, darkNights: 1, rent: 160,
                desc: "Room to breathe — a second stove keeps the kitchen from choking on a rush." },
  midtown:    { id: "midtown",    name: "Midtown Draft Hall", order: 2, cost: 15000, seats: seatsFor(LAYOUTS.midtown).length, buzzMult: 1.30, darkNights: 1, rent: 210,
                desc: "A real draft wall — three taps instead of one changes the whole rhythm of the bar." },
  flagship:   { id: "flagship",   name: "The Fourth Quarter", order: 3, cost: 34000, seats: seatsFor(LAYOUTS.flagship).length, buzzMult: 1.50, darkNights: 2, rent: 260,
                desc: "The flagship. Three stoves, a four-tap draft wall, and a room that finally looks the part." },
};
export const VENUE_ORDER = ["cornerTap", "fieldhouse", "midtown", "flagship"];

export function venueDef(c) { return VENUES[c.venue] ?? VENUES.cornerTap; }
/** Tonight's rent: the Corner Tap's flat RENT everywhere before this, now the
 *  current tier's own number — a bigger room costs more to run. This is the
 *  session-3 answer to "day 40 is strictly easier than day 4, and the venue
 *  ladder pays without a downside": rent still doesn't move with the calendar,
 *  but it moves with the tier, so climbing the ladder is a real tradeoff again
 *  instead of a one-way markup on revenue. See the notes file for the numbers. */
export function rent(c) { return venueDef(c).rent; }
export function nextVenue(c) {
  const i = VENUE_ORDER.indexOf(c.venue);
  return (i >= 0 && i < VENUE_ORDER.length - 1) ? VENUES[VENUE_ORDER[i + 1]] : null;
}
export function canMoveVenue(c) {
  const nv = nextVenue(c);
  return !!nv && c.cash >= nv.cost;
}
/** Sign the lease: cash-gated, kicks off the dark-night countdown. Climbing is
 *  still the only *voluntary* direction — the ladder walks back down only
 *  through evictLease(), which is not a thing a player chooses. */
export function moveVenue(c) {
  const nv = nextVenue(c);
  if (!nv) return { ok: false, err: "Already at the flagship — nowhere left to climb." };
  if (c.cash < nv.cost) return { ok: false, err: "Can't cover the move." };
  c.cash -= nv.cost;
  c.venue = nv.id;
  c.darkNightsLeft = nv.darkNights;
  // the high-water mark, not the current room: an evicted run's summary should
  // still say the flagship if the flagship is where it got to
  c.stats.bestTier = Math.max(num(c.stats.bestTier, 0), nv.order);
  return { ok: true, venue: nv };
}

/** The rung below, or null at the Corner Tap — evictLease()'s only question. */
export function prevVenue(c) {
  const i = VENUE_ORDER.indexOf(c.venue);
  return i > 0 ? VENUES[VENUE_ORDER[i - 1]] : null;
}

/**
 * Tonight's fixed bill: wages, rent and upgrade upkeep, in one place.
 *
 * Both settlements computed these three by hand and the two copies had already
 * drifted once in shape (`settleDarkNight()` summed them into `net` a different
 * way than `settleNight()` did). That was harmless while nothing read the
 * result twice. The lease check reads it on both paths, so a number that can
 * differ between them is a number that can evict on one path and not the other.
 * A theme is not in here on purpose: it is an optional spend on an open night,
 * and a closed night cannot buy one.
 */
export function billsFor(c) {
  const wages = wageBill(c);
  const rentDue = rent(c);
  const upgFees = upgradeFees(c);
  return { wages, rent: rentDue, upgFees, total: wages + rentDue + upgFees };
}
/** A closed "moving in" night: bills still land, no revenue, no patrons. */
export function settleDarkNight(c, rand = Math.random) {
  const { wages, rent: rentDue, upgFees, total } = billsFor(c);
  const net = -total;
  c.cash = Math.round((c.cash - total) * 100) / 100;
  const spoilage = applySpoilage(c);
  // the league plays on whether the doors were open or not
  const games = settleLeagueNight(c.league, c.day, null);
  const final = games.find(x => x.playoff === "final");
  // A dark night is the worst night your regulars can have: nobody showed,
  // because there was nothing to show up to. They all take the stay-home
  // drift, the floor was neither good nor ugly so nothing offsets it, and Vic
  // gets a free night. Move for long enough and you come back to an empty room.
  const social = settleSocial(c, {
    serviceRate: 1, mood: 0.6, arrivals: 0, postWin: false,
    showing: [], champion: final ? final.winner : null, dark: true,
  }, rand);
  c.day++;
  syncLeague(c.league, c.day);
  c.darkNightsLeft = Math.max(0, (c.darkNightsLeft || 0) - 1);
  rollApplicants(c, rand);
  // last, so the countdown it may overwrite is this night's, not the move's
  const lease = applyLease(c);
  return { wages, rent: rentDue, upgFees, net, spoilage, games, social, lease };
}

// ---------- the lease: the night you can lose ----------
//
// The gap this closes, in the README's words and this wishlist's: the cash
// number turns red and then stays red, forever, and you keep playing.
// settleNight() would take the till to negative ten thousand and roll
// tomorrow's applicants. Phases 6-8 built the pressure that makes a bad week
// reachable — a season with stakes, a rival, and cards that can sink a night —
// and this is the consequence they were missing.
//
// Locked #219 answers Questions for Devon Q23, "should there be a way to
// lose?", with the shape the wishlist named and the one the three listed
// options collapse to: **the landlord, not the bank.** A night whose books
// close below zero is a missed night; LEASE_STRIKES of them in a row and the
// lease is gone. One night back in the black clears the count outright — this
// is a landlord counting consecutive misses, not a ledger of every bad night
// you have ever had, so a run that recovers is not carrying a mark from day 6
// into day 40.
//
// The threshold is zero rather than a tier-scaled floor because zero is the
// number the HUD already turns red on. A player who can see the rule being
// applied is the whole point of a loss condition; a hidden −3×rent line would
// be one more number to learn.
export const LEASE_FLOOR = 0;
export const LEASE_STRIKES = 3;
/** What the till holds the morning after an eviction — see evictLease(). */
export const RECOVERY_CASH = 300;

/** Regulars over the current room's cap walk, shakiest first, and the door
 *  remembers them. Called from a demotion and from every load (a save the dev
 *  menu warped down the ladder is the other way to be over cap). */
function pruneToVenueCap(c) {
  const gone = [];
  while (c.regulars.length > regularCap(c)) {
    const shakiest = c.regulars.reduce((a, b) => (b.loyalty < a.loyalty ? b : a));
    c.regulars = c.regulars.filter(r => r !== shakiest);
    c.regularsLost.push({ name: shakiest.name, usual: shakiest.usual, team: shakiest.team });
    gone.push(shakiest.name);
  }
  c.regularsLost = c.regularsLost.slice(-R.LOST_MEMORY);
  return gone;
}

/** Gear the room you just got moved into has no wall for. Comes out with the
 *  fixtures, and its upkeep comes off the nightly bill with it — which is a
 *  real part of what makes the smaller room survivable. */
function stripUpgrades(c) {
  const gone = c.upgrades.filter(id => UPGRADES[id] && UPGRADES[id].tier > venueDef(c).order);
  if (gone.length) c.upgrades = c.upgrades.filter(id => !gone.includes(id));
  return gone;
}

/**
 * Lose the lease. Locked #220: this drops you a rung, it does not end the run.
 *
 * A game over on night 12 of a 40-night campaign throws away the only thing the
 * player has built. A demotion keeps the run and takes the room: the ladder
 * walks backward through the same VENUE_ORDER moveVenue() walks forward, the
 * smaller room's move-in nights come due (at least one, because moving out is a
 * move), the gear that does not fit comes off the wall, the regulars over the
 * smaller cap stop coming, and the debt is written off against the seized
 * deposit — the till floors at RECOVERY_CASH rather than reopening at minus
 * eleven hundred, which would evict again three nights later with nothing the
 * player could have done about it.
 *
 * Only an eviction from the Corner Tap is the end, because there is no rung
 * below it. That is the one place `failed` is ever set.
 */
export function evictLease(c) {
  const from = venueDef(c);
  const to = prevVenue(c);
  c.stats.evictions = num(c.stats.evictions, 0) + 1;
  c.strikes = 0;
  if (!to) {
    c.failed = true;
    return { from: from.id, fromName: from.name, to: null, toName: null, stripped: [], lost: [] };
  }
  c.venue = to.id;
  c.darkNightsLeft = Math.max(1, to.darkNights);
  const stripped = stripUpgrades(c);
  const lost = pruneToVenueCap(c);
  c.cash = Math.max(c.cash, RECOVERY_CASH);
  return { from: from.id, fromName: from.name, to: to.id, toName: to.name, stripped, lost };
}

/**
 * The landlord's count, applied once per settled night — open doors or dark.
 *
 * Returns what the ticker and the box score say, and nothing else moves here:
 * every number this reads was already written by the settlement above it.
 * `warned` and `evicted` are exclusive by construction, which is what lets both
 * lines be printed unconditionally from one record.
 */
export function applyLease(c) {
  // `strikes` in the record is always the count as it stands *after* this
  // night, so a screen reading it never has to know which branch made it.
  if (c.failed) return { short: true, strikes: c.strikes, left: 0, cleared: false, warned: false, evicted: null, failed: true };
  if (c.cash >= LEASE_FLOOR) {
    const cleared = c.strikes > 0;
    c.strikes = 0;
    return { short: false, strikes: 0, left: LEASE_STRIKES, cleared, warned: false, evicted: null, failed: false };
  }
  c.strikes = Math.min(LEASE_STRIKES, c.strikes + 1);
  if (c.strikes < LEASE_STRIKES) {
    return { short: true, strikes: c.strikes, left: LEASE_STRIKES - c.strikes, cleared: false, warned: true, evicted: null, failed: false };
  }
  const evicted = evictLease(c);
  return { short: true, strikes: c.strikes, left: 0, cleared: false, warned: false, evicted, failed: !!c.failed };
}

/** The run, in the four numbers the ending screen asks for. `bestTier` is the
 *  high-water rung rather than the current one, so a run that climbed to
 *  Midtown and got evicted back to the Fieldhouse still says Midtown. */
export function runSummary(c) {
  const order = Math.max(0, Math.min(VENUE_ORDER.length - 1, Math.round(num(c.stats.bestTier, 0))));
  return {
    nights: c.stats.nights,
    bestNight: c.stats.bestNight,
    lifetimeNet: c.stats.lifetimeNet,
    tier: VENUES[VENUE_ORDER[order]].name,
    evictions: num(c.stats.evictions, 0),
    rep: Math.round(c.rep),
    regulars: c.regulars.length,
  };
}

// ---------- spoilage: this session's answer to "day 40 is as easy as day 4" ----------
// Rent-by-tier (session 3) made the venue ladder a tradeoff again but never touched
// the other half of that gap: nothing read the calendar for cost within a tier. This
// is that half, and it's the one Devon picked over rent-creep-with-the-calendar or a
// losable lease — see the notes file for the other two options on the table.
//
// Food (wings, burger, nachos, fries) rots a fraction of what's left on the shelf
// every closed night, settled night or dark night alike — the walk-in doesn't care
// whether patrons came through the door. Beer and soda don't: kegs and cans don't
// need a walk-in the way raw wings and ground beef do, which is exactly the
// distinction the README's own roadmap already drew ("spoilage ... would unlock a
// Commercial Walk-In-style upgrade" — that upgrade, when it exists, is the lever
// that should cut this rate, not the rate itself changing here).
export const SPOILAGE_RATE = 0.15;

/** Rot whatever's left of the perishable menu after a night closes. Returns what
 *  was lost, by item and in wholesale dollars, so the box score can say so. */
export function applySpoilage(c) {
  const byItem = {};
  let value = 0;
  for (const id of FOOD) {
    const have = c.stock[id] || 0;
    const gone = Math.round(have * SPOILAGE_RATE);
    if (gone > 0) {
      c.stock[id] = have - gone;
      byItem[id] = gone;
      value += gone * STOCK_COST[id];
    }
  }
  return { byItem, value: Math.round(value * 100) / 100 };
}

// ---------- dev/debug helpers — a debug menu only, never part of normal play ----------
export function devAddCash(c, amount) { c.cash = Math.round((c.cash + amount) * 100) / 100; }
export function devSetDay(c, day) { c.day = Math.max(1, Math.round(day)); syncLeague(c.league, c.day); }
/** Instant, free, no dark nights — for testing a tier without grinding to it. */
export function devWarpVenue(c, venueId) {
  if (!(venueId in VENUES)) return false;
  c.venue = venueId; c.darkNightsLeft = 0;
  c.stats.bestTier = Math.max(num(c.stats.bestTier, 0), VENUES[venueId].order);
  return true;
}
export function devClearDarkNights(c) { c.darkNightsLeft = 0; }
export function devFillStock(c, amount = 500) { for (const id in c.stock) c.stock[id] = amount; }
export function devSetRep(c, rep) { c.rep = Math.max(0, Math.min(100, Math.round(rep))); }
export function devSetBuzz(c, buzz) { c.rival.buzz = Math.max(R.BUZZ_MIN, Math.min(R.BUZZ_MAX, Math.round(buzz))); }
/** Mint a regular on the spot, cap and all — the earned path needs a good busy
 *  night, which is a slow way to look at the corkboard's table. */
export function devAddRegular(c, rand = Math.random) {
  if (c.regulars.length >= regularCap(c)) return null;
  const r = R.mkRegular(freshName(c, rand), c.day, rand);
  c.regulars.push(r);
  return r;
}

// ---------- upgrades (both-edged: every one helps AND costs upkeep) ----------
// `tier` is the VENUES `order` a room has to be at before the upgrade can be
// bought — the 2D build's gates, carried over: Premium Screens and the Craft
// Tap Wall need the Fieldhouse or bigger, the other three are open from day
// one. The gate is on buying, not owning: a save that installed one before
// the gate existed keeps it. Effects thread through campaign.js math
// (speedMult, roleMult, beerMult, forecast) and campaign.js/engine.js pass
// them along; nothing here needs new state beyond the S.upgrades id list.
export const UPGRADES = {
  pos:       { id: "pos",       name: "POS System",         cost: 800,  fee: 25, tier: 0,
               pro: "Servers ring in 20% faster on their feet.",
               con: "$25/night service contract, forever." },
  training:  { id: "training",  name: "Staff Training Program", cost: 600, fee: 0, tier: 0,
               pro: "Whole crew works 15% faster — cooks, bartenders, servers alike.",
               con: "Certified staff expect it: effective wages up 15%." },
  crafttaps: { id: "crafttaps", name: "Craft Tap Wall",      cost: 1200, fee: 15, tier: 1,
               pro: "Draft pours command 20% more per pint.",
               con: "Finicky lines: $15/night upkeep." },
  broadcast: { id: "broadcast", name: "Premium Screens",     cost: 900,  fee: 20, tier: 1,
               pro: "Sharper picture pulls a bigger crowd — draw up 15%.",
               con: "$20/night in AV contracts and power." },
  rushexp:   { id: "rushexp",   name: "Rush Expediting",     cost: 1400, fee: 20, tier: 0,
               pro: "A real ticket rail: cooks push 30% more plates an hour.",
               con: "$20/night in gas and hood maintenance." },
};

export function owned(c, id) { return c.upgrades.includes(id); }
export function upgradeFees(c) { return Object.values(UPGRADES).reduce((s, u) => s + (owned(c, u.id) ? u.fee : 0), 0); }

/** The smallest venue an upgrade fits in, or null if the current room is
 *  big enough. The panel prints the name; buyUpgrade() refuses on it. */
export function upgradeGate(c, id) {
  const u = UPGRADES[id];
  if (!u || !(u.tier > 0) || venueDef(c).order >= u.tier) return null;
  return VENUES[VENUE_ORDER[u.tier]];
}

export function buyUpgrade(c, id) {
  const u = UPGRADES[id];
  if (!u) return { ok: false, err: "No such upgrade." };
  if (owned(c, id)) return { ok: false, err: "Already installed." };
  const gate = upgradeGate(c, id);
  if (gate) return { ok: false, err: `${gate.name} or bigger — no room for it here.` };
  if (c.cash < u.cost) return { ok: false, err: "Can't cover the install." };
  c.cash -= u.cost;
  c.upgrades.push(id);
  return { ok: true };
}

/** Wage multiplier from Staff Training — feeds wageBill/settleNight. */
export function effWage(c, s) { return Math.round(s.wage * (owned(c, "training") ? 1.15 : 1)); }
/** Walking-speed multiplier for a floor role — POS (servers only) + Training (everyone). */
export function speedMult(c, role) {
  let m = owned(c, "training") ? 1.15 : 1;
  if (role === "server" && owned(c, "pos")) m *= 1.2;
  return m;
}
/** Shelf-price multiplier for beer from Craft Tap Wall. */
export function beerMult(c) { return owned(c, "crafttaps") ? 1.2 : 1; }

const FIRST = ["Marge", "Tino", "Dee", "Rocco", "Priya", "Sal", "June", "Marcus", "Kat", "Otis", "Lena", "Gus", "Wanda", "Ray", "Bess", "Hank", "Nadia", "Cole", "Iris", "Moe"];
const LAST = ["Kowalski", "Vega", "Trout", "Okafor", "Bright", "Muller", "Santos", "Pike", "Delgado", "Frye", "Hobbs", "Nakamura", "Bell", "Crane", "Ives"];

export const MAX_STAFF = 3;

// Roles: cook and bartender push prep speed for their side of the ticket
// (skill-driven, no walking); server is the floor — a physical NPC who
// fetches whatever's ready and delivers it. Skill 1-5 drives wage and,
// for servers/bartenders, walking speed.
export const ROLES = {
  cook:      { name: "Cook",      does: "Speeds up food prep. None on shift = kitchen's closed." },
  server:    { name: "Server",    does: "Walks the floor — fetches ready tickets, delivers them." },
  bartender: { name: "Bartender", does: "Speeds up drink prep. None on shift = servers cover the taps, badly." },
};
const ROLE_KEYS = Object.keys(ROLES);

function speedForSkill(skill) { return Math.round((1.6 + skill * 0.18) * 100) / 100; } // 1.78–2.5 m/s
/** What a skill level is worth per night. `jitter` is what makes two applicants
 *  of the same skill ask for different money; repairCampaign() fills a missing
 *  wage from the un-jittered figure. One formula so the two can't drift. */
function wageForSkill(skill, jitter = 0) { return Math.round((40 + skill * 22 + jitter) / 5) * 5; }

export function mkStaff(role, skill, wage, name) {
  const s = { name, role, skill, wage };
  if (role !== "cook") s.speed = speedForSkill(skill);
  return s;
}

/** Combined prep-speed multiplier for a role: 0 if the role is unstaffed
 *  and has no fallback (cook only); bartender falls back to 0.55 (servers
 *  "cover the taps, badly") since drinks can never be fully 86'd this way. */
export function roleMult(c, role) {
  const crew = c.staff.filter(s => s.role === role);
  let base;
  if (!crew.length) base = role === "bartender" ? 0.55 : 0;
  else base = crew.reduce((m, s) => m + (0.7 + s.skill * 0.14), 0);
  if (base <= 0) return base; // no cook = kitchen's closed, no upgrade changes that
  let mult = owned(c, "training") ? 1.15 : 1;
  if (role === "cook" && owned(c, "rushexp")) mult *= 1.3;
  return base * mult;
}
export function hasCook(c) { return c.staff.some(s => s.role === "cook"); }
export function hasBartender(c) { return c.staff.some(s => s.role === "bartender"); }

export function newCampaign() {
  const c = {
    day: 1, cash: 900,
    venue: "cornerTap", darkNightsLeft: 0,
    stock: { wings: 24, burger: 16, nachos: 14, fries: 30, beer: 90, soda: 40 }, // servings
    staff: [mkStaff("cook", 2, 70, "Marge Kowalski"), mkStaff("server", 2, 60, "Tino Vega")],
    applicants: [],
    promoTonight: "none",
    upgrades: [],
    stats: { nights: 0, bestNight: 0, lifetimeNet: 0, bestTier: 0, evictions: 0 },
    strikes: 0, failed: false,
    league: newLeague(Math.floor(Math.random() * 4294967296)),
    rep: R.REP_START,
    regulars: R.newRegulars(),
    regularsLost: [],
    rival: R.newRival(),
    eventCd: {},
  };
  rollApplicants(c, Math.random);
  return c;
}

export function weekday(c) { return DAYS[(c.day - 1) % 7]; }

// ---------- the league ----------
// Game night used to be `weekday() in ["Thu", "Sun"]` and the result a coin
// flip nothing remembered. Now league.js holds a MAFA season the calendar
// walks through, and these are the campaign's three questions of it.

/** What is on the screens tonight — see league.js's tonight(). */
export function tonight(c) { return leagueTonight(c.league, c.day); }
/** The Mules play tonight. The engine's game beats, the beer skew and the
 *  Watch Party's crowd all key off this. */
export function isGameNight(c) { return !!tonight(c).mules; }
/** The night engine's odds for the Mules tonight, off the league's form
 *  table, so the room's result and the standings are drawn from the same
 *  number. 0.55 — the old coin — when there is no game. */
export function mulesWinProb(c) {
  const g = tonight(c).mules;
  if (!g) return 0.55;
  const pHome = winProb(c.league, g);
  return g.home === MULES ? pHome : 1 - pHome;
}

// ---------- regulars, your name, and the bar across town ----------
// regulars.js owns the arithmetic; these are the campaign's questions of it.
// Nothing here stores who is in tonight — see that file's header for why.

/** Every team on a screen tonight, the Mules' game included. */
function teamsPlaying(c) {
  const s = new Set();
  for (const g of tonight(c).games) { s.add(g.home); s.add(g.away); }
  return s;
}
/** How many regulars this room can hold: 3, 5, 7, 9 up the ladder. */
export function regularCap(c) { return R.regularCap(venueDef(c).order); }
/** Who walks in tonight. A pure function of the day, so the corkboard's
 *  forecast, the door and the settlement all get the same list. */
export function regularsIn(c) { return R.regularsTonight(c.regulars, c.day, c.rep, teamsPlaying(c)); }
/** The rival's own line for the day ticker. `d` is last night's drift when the
 *  settlement is still in hand; a reload has no drift to report and gets the
 *  standing line, so the morning always says something about across town. */
export function rivalWord(c) { return R.rivalWord(c.rival.buzz); }
export function rivalLine(c, d = 0) { return R.rivalLine(c.rival.buzz, d, c.rep); }

// ---------- the night's moments ----------
// events.js owns the table and the picker; the engine runs them; these are
// the campaign's two jobs: say what the books know at the top of the night,
// and settle what the floor reports at the end of it.

/** The books' half of a card's view (events.js's header lists the fields):
 *  the calendar, the season, your name, the End Zone, the crew, the roster
 *  and who is in tonight. The engine merges in the floor's half — hour,
 *  crowd, mood, stock, the night's flags. Read only. */
export function eventView(c) {
  const tn = tonight(c);
  const g = tn.mules;
  return {
    day: c.day,
    playoff: g && g.playoff ? g.playoff : null,
    phase: tn.phase,
    rivalGame: !!g && !!RIVAL_TEAM && (g.home === RIVAL_TEAM || g.away === RIVAL_TEAM),
    tier: venueDef(c).order,
    rep: c.rep, buzz: c.rival.buzz,
    upgrades: c.upgrades.slice(),
    staff: c.staff.map(s => ({ name: s.name, role: s.role, skill: s.skill, wage: s.wage })),
    regulars: c.regulars.map(r => ({ id: r.id, name: r.name, usual: r.usual, team: r.team, loyalty: r.loyalty })),
    regularsIn: regularsIn(c).map(r => r.id),
  };
}
/** What the engine needs to run tonight's moments — the three things its
 *  `moments` option takes, built here so main.js and a test hand it the same
 *  picker over the same save record. `rand` draws the budget and every roll. */
export function nightMoments(c, rand = Math.random) {
  return {
    budget: EV.nightBudget(rand),
    view: () => eventView(c),
    roll: view => EV.rollMoment(EV.EVENTS, view, c.eventCd, rand),
  };
}
/**
 * The books' half of settling the night's moments: what the floor could
 * only report, applied to the numbers campaign.js owns. Reputation, the
 * End Zone's buzz and a regular's loyalty move here, before the night's own
 * drift reads them (the 2D build's order: the card wrote the number during
 * the night, the close drifted it). A raise takes from tomorrow; a staffer
 * who walked mid-shift is off the payroll — after tonight's wages, which
 * they worked most of. Every card that fired goes on cooldown from today.
 * Returns what moved, for the box score.
 */
function settleMoments(c, mo) {
  const out = { net: 0, rep: 0, buzz: 0, loyalty: {}, raised: [], quit: [], resolved: [], auto: [] };
  if (!mo || typeof mo !== "object") return out;
  out.net = Math.round(num(mo.net, 0));
  out.rep = Math.round(num(mo.rep, 0));
  c.rep = Math.max(0, Math.min(100, c.rep + out.rep));
  out.buzz = Math.round(num(mo.buzz, 0));
  c.rival.buzz = Math.max(R.BUZZ_MIN, Math.min(R.BUZZ_MAX, c.rival.buzz + out.buzz));
  const loy = mo.loyalty && typeof mo.loyalty === "object" ? mo.loyalty : {};
  for (const r of c.regulars) {
    const d = num(loy[r.id], 0);
    if (!d) continue;
    r.loyalty = Math.max(0, Math.min(100, r.loyalty + d));
    out.loyalty[r.id] = d;
  }
  for (const ch of Array.isArray(mo.staff) ? mo.staff : []) {
    if (!ch || typeof ch.name !== "string") continue;
    const s = c.staff.find(x => x.name === ch.name);
    if (!s) continue;
    if (ch.quit) { c.staff = c.staff.filter(x => x !== s); out.quit.push(s.name); }
    else if (Number.isFinite(ch.wage)) { s.wage = Math.max(0, Math.round(ch.wage)); out.raised.push(s.name); }
  }
  const fired = (Array.isArray(mo.resolved) ? mo.resolved : []).filter(m => m && typeof m.id === "string");
  out.resolved = fired.map(m => m.id);
  out.auto = fired.filter(m => m.auto).map(m => m.id);
  c.eventCd = EV.cooldownsAfter(c.eventCd, out.resolved, c.day);
  return out;
}

export function promoDef(c) {
  const p = PROMOS[c.promoTonight] || PROMOS.none;
  return (p.needsGame && !isGameNight(c)) ? { ...p, crowd: 1 } : p;
}

/**
 * Tonight's expected bodies.
 *
 * Phase 7 hung three more multipliers off this, and all three are 1.00 on a
 * day-one campaign on purpose: `repMult` is the identity at the starting
 * reputation of 50, nobody has any regulars yet, and the End Zone's opening
 * buzz of 45 sits under that 50 so it drags nothing. A save from before this
 * phase forecasts exactly the number it forecast before it.
 *
 * The floor is real and worth knowing: reputation bottoms out at 0.60x and the
 * rival's drag at 0.85x, so the worst campaign on the site still draws 51% of
 * its base. A bad streak costs you the room, not the game.
 */
export function forecast(c) {
  const base = BASE_CROWD[weekday(c)];
  const game = tonight(c).crowd; // a rivalry, a bracket game and a dead rubber are not the same crowd
  const upgMult = owned(c, "broadcast") ? 1.15 : 1;
  const social = R.repMult(c.rep) * R.regularCrowdMult(regularsIn(c).length) * R.rivalMult(c.rival.buzz, c.rep);
  return Math.round(base * game * promoDef(c).crowd * upgMult * venueDef(c).buzzMult * social);
}

/**
 * A name nobody in this campaign already answers to.
 *
 * The crew, the pile of applicants and the regulars all draw from the same
 * twenty first names and fifteen last, and two people with one name break
 * `hire()`, `fire()` and a regular's ticket alike.
 *
 * This picks out of the open combinations rather than drawing and retrying on
 * purpose. Draw-and-retry needs a second guard for the case where the retries
 * run out, and two lines guarding the same absence both stay green when either
 * one is deleted (#34) — the first draft of this function had exactly that, a
 * retry loop and a " Jr." fallback, and deleting the loop changed nothing any
 * test could see. Three hundred combinations against at most fifteen people is
 * a 300-entry array built three times a night; that is cheaper than the second
 * guard was.
 */
function freshName(c, rand, extra = []) {
  const used = new Set([...c.staff, ...c.applicants, ...(c.regulars || [])].map(p => p.name).concat(extra));
  const open = [];
  for (const f of FIRST) for (const l of LAST) { const n = `${f} ${l}`; if (!used.has(n)) open.push(n); }
  return open[Math.floor(rand() * open.length)];
}

/**
 * Three people looking for work.
 *
 * Phase 7 put your name on the top of that pile: `applicantSkillCap()` is 2 at
 * a reputation of 0, 4 at the starting 50 and 5 from 75 up, so the pre-phase
 * flat 1-5 is now what a well-run bar sees rather than what everyone sees. It
 * is the one place this phase makes a day-one campaign harder than it was, and
 * it is deliberate: reputation has to buy something, and "who applies" is what
 * the 2D build sells it for.
 */
export function rollApplicants(c, rand = Math.random) {
  c.applicants = [];
  const taken = [];
  for (let i = 0; i < 3; i++) {
    const name = freshName(c, rand, taken);
    taken.push(name);
    const role = ROLE_KEYS[Math.floor(rand() * ROLE_KEYS.length)];
    const skill = 1 + Math.floor(rand() * R.applicantSkillCap(c.rep));
    const wage = wageForSkill(skill, Math.floor(rand() * 16) - 6);
    c.applicants.push(mkStaff(role, skill, wage, name));
  }
}

export function hire(c, name) {
  const a = c.applicants.find(x => x.name === name);
  if (!a || c.staff.length >= MAX_STAFF) return false;
  c.applicants = c.applicants.filter(x => x !== a);
  c.staff.push(a);
  return true;
}

export function fire(c, name) {
  const s = c.staff.find(x => x.name === name);
  if (!s) return false;
  c.staff = c.staff.filter(x => x !== s);
  return true;
}

/** Buy stock: order is {itemId: servings}. Deducts cash, adds servings. */
export function placeOrder(c, order) {
  const cost = orderCost(order);
  if (cost <= 0) return { ok: false, err: "Nothing on the order sheet." };
  if (cost > c.cash) return { ok: false, err: "The distributor wants cash you don't have." };
  c.cash -= cost;
  for (const id in order) if (order[id] > 0) c.stock[id] = (c.stock[id] || 0) + order[id];
  return { ok: true, cost };
}
export function orderCost(order) {
  let t = 0;
  for (const id in order) t += (order[id] || 0) * STOCK_COST[id];
  return Math.round(t * 100) / 100;
}

export function wageBill(c) { return c.staff.reduce((s, x) => s + effWage(c, x), 0); }

/**
 * The half of settlement that is people rather than money.
 *
 * Runs on a played night and a dark one alike, before the day advances, and it
 * is the only place `rep`, `loyalty` and `buzz` move for a night — which is
 * what makes "a stocked-out usual costs loyalty exactly once per night" true
 * by construction rather than by care.
 *
 * `showing` is the list `regularsIn()` gave the door; a dark night passes an
 * empty one, so every regular takes the stay-home drift. Returns what moved,
 * for the box score, the ticker and the tests.
 */
function settleSocial(c, { serviceRate, mood, arrivals, postWin, showing, champion, comped = new Set(), dark = false }, rand) {
  // A dark night is not a night anyone saw, so it is not a night that can be
  // good or ugly: no reputation moves either way, nothing is minted, and the
  // only marks it leaves are the ones below — every regular takes the
  // stay-home drift plus the closed-doors penalty, and Vic gets a free night.
  const { good, ugly } = dark ? { good: false, ugly: false } : R.nightVerdict(serviceRate, mood);
  const showingIds = new Set(showing.map(r => r.id));
  // 86'd before the shelves rot: a regular who came in for the usual and found
  // the walk-in bare. This filter is the only thing that keeps a regular who
  // stayed home from being 86'd by a shelf they never looked at —
  // driftLoyalty() charges the 8 to whatever is in this set (see its note).
  const stockedOut = new Set(showing.filter(r => (c.stock[r.usual] || 0) <= 0).map(r => r.id));
  const snubbed = showing.filter(r => stockedOut.has(r.id)).map(r => r.name);
  // the floor's word, not the books': the engine's `comped` set is who the
  // boss actually walked up to tonight, so it is read off the summary and
  // never derived here
  const onTheHouse = showing.filter(r => comped.has(r.id)).map(r => r.name);

  const dRep = dark ? 0 : R.repDrift(c.rep, serviceRate, mood, c.regulars.length, postWin);
  c.rep = Math.max(0, Math.min(100, c.rep + dRep));

  R.driftLoyalty(c.regulars, { showing: showingIds, stockedOut, comped, good, ugly });
  if (dark) for (const r of c.regulars) r.loyalty = Math.max(0, r.loyalty - R.DARK_NIGHT_LOYALTY);
  const lost = R.pruneRegulars(c.regulars, c.regularsLost);
  // a name walking out is a name walking out — the street hears about it
  if (lost.length) c.rep = Math.max(0, c.rep - lost.length);

  const gained = R.mintRegular(c.regulars, c.regularsLost, {
    cap: regularCap(c), good, arrivals, day: c.day,
    nameFor: () => freshName(c, rand), rand,
  });

  // the league moves both needles: a Mules banner is your parade too, and a
  // Sharks title makes the End Zone the Sharks bar
  if (champion === MULES) c.rep = Math.min(100, c.rep + 4);
  if (champion && champion === RIVAL_TEAM) c.rival.buzz = Math.min(R.BUZZ_MAX, c.rival.buzz + 6);

  const drift = R.driftBuzz(dark ? Math.min(R.BUZZ_MAX, c.rival.buzz + 1) : c.rival.buzz, { good, ugly, arrivals }, rand);
  const dBuzz = drift.buzz - c.rival.buzz;
  c.rival.buzz = drift.buzz;
  const buzz = drift.buzz;

  return {
    dRep, rep: c.rep, showing: showing.map(r => r.name), snubbed, comped: onTheHouse, lost,
    gained: gained ? { name: gained.name, returning: !!gained.returning } : null,
    dBuzz, buzz, rivalLine: R.rivalLine(buzz, dBuzz, c.rep), good, ugly,
  };
}

/** The one team whose title is the End Zone's win: league.js's rival flag,
 *  read once rather than spelled "HCS" here. */
const RIVAL_TEAM = (LEAGUE_TEAMS.find(t => t.rival) || {}).id || null;

/** Close the books on a finished night. Mutates cash/day/stats; reroll happens here. */
export function settleNight(c, summary, rand = Math.random) {
  const { wages, rent: rentDue, upgFees, total: bill } = billsFor(c);
  const promoCost = promoDef(c).cost;
  const take = summary.total;
  const net = Math.round(take - bill - promoCost);
  c.cash = Math.round((c.cash + take - bill - promoCost) * 100) / 100;
  c.stats.nights++;
  c.stats.bestNight = Math.max(c.stats.bestNight, take);
  c.stats.lifetimeNet += net;
  // the moments first: a card moved your name, the End Zone or a regular
  // during the night, and the night's own drift reads the moved number
  const moments = settleMoments(c, summary.moments);
  // people before spoilage: a regular's usual is 86'd if the shelf was bare
  // when they wanted it, not if the walk-in rotted it overnight
  const showing = regularsIn(c);
  // the Mules' result is the engine's, so the standings say what the room saw;
  // the other games tonight are the league's own rolls
  const g = summary.game;
  const games = settleLeagueNight(c.league, c.day, g && g.finished && typeof g.win === "boolean" ? g.win : null);
  const final = games.find(x => x.playoff === "final");
  const social = settleSocial(c, {
    serviceRate: (summary.serviceRate ?? 100) / 100,
    mood: summary.mood,
    arrivals: summary.arrivals ?? (summary.served + summary.walkouts),
    postWin: !!(g && g.finished && g.win === true),
    showing,
    champion: final ? final.winner : null,
    // ids the boss comped on the floor; a summary without the field (the Node
    // suites' synthetic nights) comped nobody
    comped: new Set(Array.isArray(summary.comped) ? summary.comped : []),
  }, rand);
  const spoilage = applySpoilage(c);
  c.day++;
  syncLeague(c.league, c.day);
  c.promoTonight = "none";
  rollApplicants(c, rand);
  // the landlord counts last, on the cash the whole night left behind
  const lease = applyLease(c);
  return { wages, rent: rentDue, promoCost, upgFees, take, net, spoilage, games, social, moments, lease };
}

// ---- persistence: the shared save system ------------------------------------
//
// This is the site's first adopter of assets/js/gvb-save.js, so it is also the
// worked example. What the slot buys over the hand-rolled save it replaces:
// export/import to a file (a campaign survives a cleared browser), a memory
// fallback when the browser blocks storage, and one implementation of "refuse to
// load garbage" instead of one per project.
//
// The storage key stays `fq3d-save`, unchanged, so a campaign saved by any
// previous build still loads. Those saves carry no version stamp at all, which
// gvb-save reads as version 0.

/** Bump when the shape changes. 0 means "written before this file used a slot". */
export const SAVE_VERSION = 1;

/** The gate on garbage: the three fields nothing downstream can work without. */
function validCampaign(c) {
  return !!c && typeof c.day === "number" && !!c.stock && Array.isArray(c.staff);
}

/**
 * A finite number, or the fallback.
 *
 * One helper for undefined, null, a string, NaN and Infinity, because every one of
 * those reaches this file. `null` in particular is not a hypothetical:
 * `JSON.stringify` writes NaN and Infinity as `null`, so any number that went bad
 * in memory before a save comes back through this door looking like an absent
 * field. And `typeof NaN === "number"`, so a plain typeof check waves it through.
 */
function num(v, fallback) { return Number.isFinite(v) ? v : fallback; }

/**
 * Fill in what a save can be missing and clamp what it can get wrong.
 *
 * This is the old loadCampaign()'s body, handed to the slot as `repair` so it
 * runs on every accepted load — a stored save, an imported file — rather than
 * only when the version number moved. Every field it touches has been added to
 * the campaign at some point since the first release, which is why a save with
 * no `upgrades` array or no `venue` is a normal thing to meet and not a
 * corrupt file.
 *
 * Session 8 went through the shape field by field instead of waiting for the next
 * one to be found by accident, the way `speed` was. The rule that came out of it:
 * **every field this game does arithmetic on gets a finite fallback here, and
 * every field it calls a method on gets a type check.** `validate` only guards
 * `day`, `stock` and `staff`, so everything else arrives unexamined. What that
 * audit turned up, each of which is asserted in `test/smoke-campaign.mjs`:
 *
 * - **`cash` missing was two bugs, not one.** `placeOrder()` gates on
 *   `cost > c.cash`, and any comparison against `undefined` is false — so the
 *   distributor would hand over 100,000 beers for free. Then the till went NaN
 *   and stayed NaN.
 * - **`day` below 1, or not a whole number, emptied the room in silence.**
 *   `weekday()` indexes `DAYS[(day - 1) % 7]`; day 0 gives `DAYS[-1]` and day 2.5
 *   gives `DAYS[1.5]`, both `undefined`. `BASE_CROWD[undefined]` is `undefined`,
 *   `forecast()` is NaN, and `NightEngine`'s `crowdTarget ?? 46` keeps the NaN
 *   because `??` only catches null and undefined. The result is a full eight-hour
 *   night, six real minutes, in which not one patron ever walks in and nothing is
 *   logged. This is the worst shape of this bug in the file.
 * - **A `stats` object could exist without its numbers.** The old check was
 *   `if (!c.stats)`, so `{ nights: 3 }` — a save from before `bestNight` and
 *   `lifetimeNet` were added — passed through, and `settleNight()` turned both
 *   into NaN on the first close, permanently.
 * - **A staffer with no `wage` poisoned the books.** `wageBill()` sums
 *   `effWage()`, `settleNight()` subtracts that from the take, and the NaN lands
 *   in `cash` and `stats.lifetimeNet` for good. Applicants need it too: a hire
 *   moves one onto the payroll unchanged.
 * - **A staffer with no `name` crashed the night outright.** `beginNight()` does
 *   `s.name.split(" ")[0]` for every floor role. Not a silent one, but the only
 *   hard throw in the audit, and a nameless staffer can't be fired either since
 *   `fire()` matches on name.
 * - **`skill` was only checked for falsiness,** so `"high"` survived and made
 *   `roleMult()` NaN — which is prep speed for that whole side of the ticket.
 * - **`upgrades` was only checked for falsiness,** so an object there made
 *   `owned()` throw on `.includes` from the first frame.
 *
 * **The league is additive** (Phase 6). A save from before it existed has no
 * `league`, and one that was hand-edited or truncated can have a broken one;
 * either gets a fresh record seeded off the day, and `syncLeague()` then plays
 * it forward to the campaign's day, so a day-40 save loads into week 5 of
 * season 1 with 22 results behind it rather than being refused or dropped on
 * day 1 of a season. The seed is the day rather than a random draw so two
 * loads of the same old save agree. `syncLeague()` also runs on a league that
 * is fine, because it is the one place the invariant "everything before today
 * is played, nothing from today on is" is held, and a load is the one time
 * nobody else has held it.
 *
 * Keep this idempotent: the slot runs it on every load, including saves it wrote
 * itself.
 */
export function repairCampaign(c) {
  // Collections first: the loops below iterate them.
  if (!Array.isArray(c.applicants)) c.applicants = [];
  if (!Array.isArray(c.upgrades)) c.upgrades = [];
  if (!c.stock || typeof c.stock !== "object") c.stock = {};

  c.day = Math.max(1, Math.round(num(c.day, 1)));
  c.cash = num(c.cash, 0);

  // Spread first so a stat added later survives a load written by an older build.
  const st = (c.stats && typeof c.stats === "object") ? c.stats : {};
  c.stats = {
    ...st,
    nights: Math.max(0, Math.round(num(st.nights, 0))),
    bestNight: Math.max(0, num(st.bestNight, 0)),
    lifetimeNet: num(st.lifetimeNet, 0),
    evictions: Math.max(0, Math.round(num(st.evictions, 0))),
    bestTier: Math.max(0, Math.min(VENUE_ORDER.length - 1, Math.round(num(st.bestTier, 0)))),
  };

  if (!(c.venue in VENUES)) c.venue = "cornerTap";
  // Phase 9's fields, all additive: a save from before the lease existed has no
  // strike count and has not failed, which is the only reading that does not
  // judge forty nights played under different rules. `bestTier` is floored at
  // the room the save is actually in, so an old save at the flagship does not
  // report a Corner Tap run.
  c.stats.bestTier = Math.max(c.stats.bestTier, venueDef(c).order);
  c.strikes = Math.max(0, Math.min(LEASE_STRIKES, Math.round(num(c.strikes, 0))));
  c.failed = c.failed === true;
  c.darkNightsLeft = Math.max(0, Math.round(num(c.darkNightsLeft, 0)));
  if (!(c.promoTonight in PROMOS)) c.promoTonight = "none";

  let unnamed = 0;
  for (const p of [...c.staff, ...c.applicants]) {
    // Numbered rather than invented: two nameless staffers would otherwise share
    // a name, and hire()/fire() match on it. It also reads as what it is in the
    // crew panel, which is what you want when someone reports it.
    if (typeof p.name !== "string" || !p.name.trim()) p.name = `Staffer ${++unnamed}`;
    if (!(p.role in ROLES)) p.role = "server";
    p.skill = Math.min(5, Math.max(1, Math.round(num(p.skill, 2))));
    p.wage = Math.max(0, Math.round(num(p.wage, wageForSkill(p.skill))));
    // A save from before roles existed has no walking speed either, and
    // beginNight() multiplies that straight into a Server's metres per second —
    // an undefined there makes a floor NPC with a NaN speed that never arrives
    // anywhere. The old loader filled in role and skill but not this.
    if (p.role !== "cook") p.speed = num(p.speed, speedForSkill(p.skill));
  }
  for (const id in MENU) c.stock[id] = Math.max(0, num(c.stock[id], 0));

  if (!validLeague(c.league)) c.league = newLeague(c.day);
  syncLeague(c.league, c.day);

  // Phase 7's three fields, all additive: a save from before this phase has no
  // `rep`, no `regulars` and no `rival`, and gets the opening numbers — which
  // are the numbers that leave its forecast exactly where it was. Every one of
  // them is arithmetic in forecast(), so every one gets a finite fallback.
  c.rep = Math.max(0, Math.min(100, num(c.rep, R.REP_START)));
  c.regulars = R.repairRegulars(c.regulars, c.day);
  c.regularsLost = R.repairLost(c.regularsLost);
  c.rival = R.repairRival(c.rival);
  // A save moved down the ladder — by an eviction or by the dev menu — can be
  // over the smaller room's cap; the shakiest go rather than the newest, and
  // the door remembers them. Same helper the demotion calls, so the two paths
  // cannot disagree about who walks.
  pruneToVenueCap(c);
  // Phase 8's one field, additive: a save from before it has no cooldowns,
  // which is the same as every card being ready to fire.
  c.eventCd = EV.repairEventCd(c.eventCd);
  return c;
}

// One slot per storage, cached: main.js holds onto its slot for the save bar, and
// two slots over one key would work but would not be the same object.
const slots = new WeakMap();
let browserSlot = null;

function buildSlot(storage) {
  return createSaveSlot({
    game: "fourth-quarter",
    key: SAVE_KEY,
    version: SAVE_VERSION,
    storage,
    validate: validCampaign,
    repair: repairCampaign,
    // newCampaign rolls three random applicants, so day one cannot be a literal.
    defaults: newCampaign,
  });
}

/**
 * The save slot. Pass a storage stub in tests; pass nothing in the game.
 *
 * Nothing in this project should touch `localStorage` itself. Reading the
 * property throws outright in a browser configured to block storage, which is
 * the case gvb-save's memory-backed fallback exists to survive — so let it do
 * the probing, and let `slot.memoryOnly` be how the game finds out.
 */
export function campaignSlot(storage) {
  if (!storage) return (browserSlot ||= buildSlot(undefined));
  if (!slots.has(storage)) slots.set(storage, buildSlot(storage));
  return slots.get(storage);
}

// Thin wrappers, kept because main.js, dev.js and the smoke test all read better
// in the campaign's own vocabulary than in the slot's.
export function saveCampaign(c, storage) { return campaignSlot(storage).save(c); }
export function loadCampaign(storage) { return campaignSlot(storage).load(); }
export function resetCampaign(storage) { return campaignSlot(storage).reset(); }
