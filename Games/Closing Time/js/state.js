// state.js — canonical game state, persistence, career ladder, RNG helpers.
import { DB } from "./data.js";

export const SAVE_KEY = "closingTime.save.v1";

export const LEVELS = [
  { level: 1, title: "Rookie Agent",   xp: 0,    slots: 2, tiers: ["starter"] },
  { level: 2, title: "Associate",      xp: 100,  slots: 3, tiers: ["starter", "mid"] },
  { level: 3, title: "Senior Agent",   xp: 300,  slots: 4, tiers: ["starter", "mid", "luxury"] },
  { level: 4, title: "Broker-Track",   xp: 700,  slots: 5, tiers: ["starter", "mid", "luxury"] },
  { level: 5, title: "Managing Broker",xp: 1300, slots: 6, tiers: ["starter", "mid", "luxury"] },
];

export const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export const dayName = d => DAY_NAMES[(d - 1) % 7];
export const isWeekend = d => ((d - 1) % 7) >= 5;
export const weekOf = d => Math.floor((d - 1) / 7) + 1;
export const seasonOf = d => ["Winter","Spring","Summer","Fall"][Math.floor(((d - 1) % 336) / 84)];

export let S = null;

export function newGame(brokerageId) {
  S = {
    day: 1, slotsLeft: 4, cash: 2500, xp: 0, level: 1, rep: 5,
    brokerageId,
    market: { rate: 6.4, nb: {} },
    knowledge: {},                 // neighborhoodId -> 0..5 local-market knowledge
    clients: [],                   // active/finished client records
    clientQueue: [],               // content client ids not yet met
    usedClients: [],
    listingsState: {},             // listingId -> {status, price, dom}
    playerListings: [],            // seller-side listings the player represents
    deals: [],
    schedule: [],                  // {day, label, type, ref}
    activeEffects: [],             // {kind, nbId?, mult?, untilDay}
    log: [],
    choiceQueue: [],               // pending modal choices (events etc.)
    stats: { closed: 0, volume: 0, referrals: 0, honesty: 0 },
    seed: Math.floor(Math.random() * 1e9),
    nextId: 1,
  };
  for (const id in DB.neighborhoods) { S.market.nb[id] = 1.0; S.knowledge[id] = 0; }
  for (const id in DB.listings) {
    S.listingsState[id] = { status: "onMarket", price: DB.listings[id].price, dom: DB.listings[id].daysOnMarket };
  }
  // Intake queue: shuffle content clients, weight starters early.
  const all = Object.values(DB.clients);
  const starters = all.filter(c => c.tier === "starter").map(c => c.id);
  const rest = all.filter(c => c.tier !== "starter").map(c => c.id);
  S.clientQueue = [...shuffle(starters), ...shuffle(rest)];
  log(`Day 1. You hang your license at ${DB.brokerages[brokerageId].name}. The phone is very quiet. For now.`, "milestone");
  save();
  return S;
}

export function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* best effort */ } }
export function loadSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { S = JSON.parse(raw); return true; } } catch (e) {}
  return false;
}
export function wipeSave() { localStorage.removeItem(SAVE_KEY); }

export const uid = p => p + "_" + (S.nextId++);

// --- RNG (seeded-ish, but state-mutating simple LCG for determinism-lite) ---
export function rand() {
  S.seed = (S.seed * 1664525 + 1013904223) % 4294967296;
  return S.seed / 4294967296;
}
export const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
export const randRange = (a, b) => a + rand() * (b - a);
export const pick = arr => arr[Math.floor(rand() * arr.length)];
export function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// --- Progression ---
export function levelInfo() { return LEVELS[S.level - 1]; }
export function addXP(n, why) {
  S.xp += n;
  log(`+${n} XP — ${why}`, "xp");
  const next = LEVELS[S.level];
  if (next && S.xp >= next.xp) {
    S.level = next.level;
    log(`Promotion: you are now a ${next.title}. Client slots: ${next.slots}. Tiers unlocked: ${next.tiers.join(", ")}.`, "milestone");
  }
}
export function addRep(n, why) {
  S.rep = Math.max(0, Math.min(100, S.rep + n));
  log(`${n >= 0 ? "+" : ""}${n} reputation — ${why}`, n >= 0 ? "rep" : "bad");
}
export function addCash(n, why) {
  S.cash += n;
  log(`${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString()} — ${why}`, n >= 0 ? "money" : "bad");
}

export function clientSlotsMax() { return levelInfo().slots; }
export function activeClients() { return S.clients.filter(c => c.status === "active"); }
export function getClientRec(recId) { return S.clients.find(c => c.recId === recId); }
export function contentClient(rec) { return DB.clients[rec.clientId]; }

export function log(text, cls = "") {
  S.log.unshift({ day: S.day, text, cls });
  if (S.log.length > 300) S.log.pop();
}

export function scheduleItem(day, label, type, ref) {
  S.schedule.push({ day, label, type, ref });
  S.schedule.sort((a, b) => a.day - b.day);
}
export function unschedule(pred) { S.schedule = S.schedule.filter(it => !pred(it)); }
