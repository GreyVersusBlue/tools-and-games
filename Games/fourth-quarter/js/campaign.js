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

const FIRST = ["Marge", "Tino", "Dee", "Rocco", "Priya", "Sal", "June", "Marcus", "Kat", "Otis", "Lena", "Gus", "Wanda", "Ray", "Bess", "Hank", "Nadia", "Cole", "Iris", "Moe"];
const LAST = ["Kowalski", "Vega", "Trout", "Okafor", "Bright", "Muller", "Santos", "Pike", "Delgado", "Frye", "Hobbs", "Nakamura", "Bell", "Crane", "Ives"];

export const MAX_STAFF = 3;

export function newCampaign() {
  const c = {
    day: 1, cash: 900,
    stock: { wings: 24, burger: 16, nachos: 14, fries: 30, beer: 90, soda: 40 }, // servings
    staff: [{ name: "Tino Vega", wage: 60, speed: 2.0 }],
    applicants: [],
    promoTonight: "none",
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
  return Math.round(base * game * promoDef(c).crowd);
}

export function rollApplicants(c, rand = Math.random) {
  c.applicants = [];
  const used = new Set(c.staff.map(s => s.name));
  for (let i = 0; i < 3; i++) {
    let name;
    do { name = FIRST[Math.floor(rand() * FIRST.length)] + " " + LAST[Math.floor(rand() * LAST.length)]; }
    while (used.has(name));
    used.add(name);
    const speed = Math.round((1.7 + rand() * 0.8) * 100) / 100;
    const wage = Math.round((45 + (speed - 1.7) * 110 + rand() * 10) / 5) * 5;
    c.applicants.push({ name, wage, speed });
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

export function wageBill(c) { return c.staff.reduce((s, x) => s + x.wage, 0); }

/** Close the books on a finished night. Mutates cash/day/stats; reroll happens here. */
export function settleNight(c, summary, rand = Math.random) {
  const wages = wageBill(c);
  const promoCost = promoDef(c).cost;
  const take = summary.total;
  const net = Math.round(take - wages - RENT - promoCost);
  c.cash = Math.round((c.cash + take - wages - RENT - promoCost) * 100) / 100;
  c.stats.nights++;
  c.stats.bestNight = Math.max(c.stats.bestNight, take);
  c.stats.lifetimeNet += net;
  c.day++;
  c.promoTonight = "none";
  rollApplicants(c, rand);
  return { wages, rent: RENT, promoCost, take, net };
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
    if (!c.stats) c.stats = { nights: 0, bestNight: 0, lifetimeNet: 0 };
    if (!(c.promoTonight in PROMOS)) c.promoTonight = "none";
    for (const id in MENU) if (typeof c.stock[id] !== "number") c.stock[id] = 0;
    return c;
  } catch (e) { return null; }
}
export function resetCampaign(storage) {
  try { storage.removeItem(SAVE_KEY); } catch (e) {}
  return newCampaign();
}
