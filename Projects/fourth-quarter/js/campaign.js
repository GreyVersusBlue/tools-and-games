// campaign.js — the books between nights. Pure logic, storage-agnostic:
// pass any localStorage-shaped object (tests pass a plain stub).
// Owns cash, the calendar, stock, the crew, tonight's promo, and settlement.

import { MENU } from "./engine.js";

export const SAVE_KEY = "fq3d-save";
export const RENT = 110;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const BASE_CROWD = { Mon: 26, Tue: 20, Wed: 28, Thu: 34, Fri: 44, Sat: 48, Sun: 38 };
export const GAME_DAYS = ["Thu", "Sun"]; // Mules on the screens

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
// Each tier: seats feeds NightEngine's cap, buzzMult lifts forecast(), darkNights
// is how many closed nights (rent/wages/upkeep still due, no revenue) it takes
// to move in before the doors can reopen.
export const VENUES = {
  cornerTap:  { id: "cornerTap",  name: "The Corner Tap",     order: 0, cost: 0,     seats: 30, buzzMult: 1.00, darkNights: 0,
                desc: "Where you started. Six tables, six stools, one stove, one tap." },
  fieldhouse: { id: "fieldhouse", name: "The Fieldhouse",     order: 1, cost: 5500,  seats: 44, buzzMult: 1.15, darkNights: 1,
                desc: "Room to breathe — a second stove keeps the kitchen from choking on a rush." },
  midtown:    { id: "midtown",    name: "Midtown Draft Hall", order: 2, cost: 15000, seats: 60, buzzMult: 1.30, darkNights: 1,
                desc: "A real draft wall — three taps instead of one changes the whole rhythm of the bar." },
  flagship:   { id: "flagship",   name: "The Fourth Quarter", order: 3, cost: 34000, seats: 80, buzzMult: 1.50, darkNights: 2,
                desc: "The flagship. Three stoves, a four-tap draft wall, and a room that finally looks the part." },
};
export const VENUE_ORDER = ["cornerTap", "fieldhouse", "midtown", "flagship"];

export function venueDef(c) { return VENUES[c.venue] ?? VENUES.cornerTap; }
export function nextVenue(c) {
  const i = VENUE_ORDER.indexOf(c.venue);
  return (i >= 0 && i < VENUE_ORDER.length - 1) ? VENUES[VENUE_ORDER[i + 1]] : null;
}
export function canMoveVenue(c) {
  const nv = nextVenue(c);
  return !!nv && c.cash >= nv.cost;
}
/** Sign the lease: one-way, cash-gated, kicks off the dark-night countdown. */
export function moveVenue(c) {
  const nv = nextVenue(c);
  if (!nv) return { ok: false, err: "Already at the flagship — nowhere left to climb." };
  if (c.cash < nv.cost) return { ok: false, err: "Can't cover the move." };
  c.cash -= nv.cost;
  c.venue = nv.id;
  c.darkNightsLeft = nv.darkNights;
  return { ok: true, venue: nv };
}
/** A closed "moving in" night: bills still land, no revenue, no patrons. */
export function settleDarkNight(c, rand = Math.random) {
  const wages = wageBill(c);
  const upgFees = upgradeFees(c);
  const net = -(wages + RENT + upgFees);
  c.cash = Math.round((c.cash - wages - RENT - upgFees) * 100) / 100;
  c.day++;
  c.darkNightsLeft = Math.max(0, (c.darkNightsLeft || 0) - 1);
  rollApplicants(c, rand);
  return { wages, rent: RENT, upgFees, net };
}

// ---------- dev/debug helpers — a debug menu only, never part of normal play ----------
export function devAddCash(c, amount) { c.cash = Math.round((c.cash + amount) * 100) / 100; }
export function devSetDay(c, day) { c.day = Math.max(1, Math.round(day)); }
/** Instant, free, no dark nights — for testing a tier without grinding to it. */
export function devWarpVenue(c, venueId) {
  if (!(venueId in VENUES)) return false;
  c.venue = venueId; c.darkNightsLeft = 0;
  return true;
}
export function devClearDarkNights(c) { c.darkNightsLeft = 0; }
export function devFillStock(c, amount = 500) { for (const id in c.stock) c.stock[id] = amount; }

// ---------- upgrades (both-edged: every one helps AND costs upkeep) ----------
// No venue ladder yet in the 3D port, so nothing's tier-gated — all five are
// buyable from day one. Effects thread through campaign.js math (speedMult,
// roleMult, beerMult, forecast) and campaign.js/engine.js pass them along;
// nothing here needs new state beyond the S.upgrades id list.
export const UPGRADES = {
  pos:       { id: "pos",       name: "POS System",         cost: 800,  fee: 25,
               pro: "Servers ring in 20% faster on their feet.",
               con: "$25/night service contract, forever." },
  training:  { id: "training",  name: "Staff Training Program", cost: 600, fee: 0,
               pro: "Whole crew works 15% faster — cooks, bartenders, servers alike.",
               con: "Certified staff expect it: effective wages up 15%." },
  crafttaps: { id: "crafttaps", name: "Craft Tap Wall",      cost: 1200, fee: 15,
               pro: "Draft pours command 20% more per pint.",
               con: "Finicky lines: $15/night upkeep." },
  broadcast: { id: "broadcast", name: "Premium Screens",     cost: 900,  fee: 20,
               pro: "Sharper picture pulls a bigger crowd — draw up 15%.",
               con: "$20/night in AV contracts and power." },
  rushexp:   { id: "rushexp",   name: "Rush Expediting",     cost: 1400, fee: 20,
               pro: "A real ticket rail: cooks push 30% more plates an hour.",
               con: "$20/night in gas and hood maintenance." },
};

export function owned(c, id) { return c.upgrades.includes(id); }
export function upgradeFees(c) { return Object.values(UPGRADES).reduce((s, u) => s + (owned(c, u.id) ? u.fee : 0), 0); }

export function buyUpgrade(c, id) {
  const u = UPGRADES[id];
  if (!u) return { ok: false, err: "No such upgrade." };
  if (owned(c, id)) return { ok: false, err: "Already installed." };
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
    stats: { nights: 0, bestNight: 0, lifetimeNet: 0 },
  };
  rollApplicants(c, Math.random);
  return c;
}

export function weekday(c) { return DAYS[(c.day - 1) % 7]; }
export function isGameNight(c) { return GAME_DAYS.includes(weekday(c)); }

export function promoDef(c) {
  const p = PROMOS[c.promoTonight] || PROMOS.none;
  return (p.needsGame && !isGameNight(c)) ? { ...p, crowd: 1 } : p;
}

export function forecast(c) {
  const base = BASE_CROWD[weekday(c)];
  const game = isGameNight(c) ? 1.5 : 1;
  const upgMult = owned(c, "broadcast") ? 1.15 : 1;
  return Math.round(base * game * promoDef(c).crowd * upgMult * venueDef(c).buzzMult);
}

export function rollApplicants(c, rand = Math.random) {
  c.applicants = [];
  const used = new Set(c.staff.map(s => s.name));
  for (let i = 0; i < 3; i++) {
    let name;
    do { name = FIRST[Math.floor(rand() * FIRST.length)] + " " + LAST[Math.floor(rand() * LAST.length)]; }
    while (used.has(name));
    used.add(name);
    const role = ROLE_KEYS[Math.floor(rand() * ROLE_KEYS.length)];
    const skill = 1 + Math.floor(rand() * 5); // 1-5
    const wage = Math.round((40 + skill * 22 + Math.floor(rand() * 16) - 6) / 5) * 5;
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

/** Close the books on a finished night. Mutates cash/day/stats; reroll happens here. */
export function settleNight(c, summary, rand = Math.random) {
  const wages = wageBill(c);
  const promoCost = promoDef(c).cost;
  const upgFees = upgradeFees(c);
  const take = summary.total;
  const net = Math.round(take - wages - RENT - promoCost - upgFees);
  c.cash = Math.round((c.cash + take - wages - RENT - promoCost - upgFees) * 100) / 100;
  c.stats.nights++;
  c.stats.bestNight = Math.max(c.stats.bestNight, take);
  c.stats.lifetimeNet += net;
  c.day++;
  c.promoTonight = "none";
  rollApplicants(c, rand);
  return { wages, rent: RENT, promoCost, upgFees, take, net };
}

// ---- persistence (storage-agnostic) ----
export function saveCampaign(c, storage) {
  try { storage.setItem(SAVE_KEY, JSON.stringify(c)); } catch (e) {}
}
export function loadCampaign(storage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || typeof c.day !== "number" || !c.stock || !Array.isArray(c.staff)) return null;
    if (!c.applicants) c.applicants = [];
    if (!c.upgrades) c.upgrades = [];
    if (!c.stats) c.stats = { nights: 0, bestNight: 0, lifetimeNet: 0 };
    if (!(c.venue in VENUES)) c.venue = "cornerTap";
    if (typeof c.darkNightsLeft !== "number") c.darkNightsLeft = 0;
    if (!(c.promoTonight in PROMOS)) c.promoTonight = "none";
    for (const s of c.staff) if (!s.role) { s.role = "server"; if (!s.skill) s.skill = 2; }
    for (const a of c.applicants) if (!a.role) { a.role = "server"; if (!a.skill) a.skill = 2; }
    for (const id in MENU) if (typeof c.stock[id] !== "number") c.stock[id] = 0;
    return c;
  } catch (e) { return null; }
}
export function resetCampaign(storage) {
  try { storage.removeItem(SAVE_KEY); } catch (e) {}
  return newCampaign();
}
