// state.js — canonical game state, persistence, career ladder, RNG helpers.
import { DB } from "./data.js";
// Relative, not "/assets/js/gvb-save.js": tools/smoke.mjs imports this module
// under plain Node, which cannot resolve a leading slash. The relative form
// resolves identically in the browser.
import { createSaveSlot } from "../../../assets/js/gvb-save.js";

export const SAVE_KEY = "closingTime.save.v1";
/** Bump when the shape changes. 0 means "written before this file used a slot". */
export const SAVE_VERSION = 1;
/** What fresh() hands back when nobody picked. The game always picks — see careerSlot(). */
export const DEFAULT_BROKERAGE = "bk_indep";

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

/**
 * Day one at a given brokerage. Pure: builds and returns a career, touches
 * neither `S` nor storage, so the save slot can call it as its `defaults`
 * factory. `newGame()` is the one that installs it.
 */
export function makeCareer(brokerageId) {
  const c = {
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
    firedEvents: {},               // eventId -> times fired (gates one-shot recruiters)
    pendingLowball: null,          // consumed live by the open-house flow
    stats: { closed: 0, volume: 0, referrals: 0, honesty: 0 },
    seed: Math.floor(Math.random() * 1e9),
    nextId: 1,
    careerEnded: false,            // set by endDay() at day 336 — see engine/calendar.js
    scorecard: null,               // frozen year-end snapshot, built once, when careerEnded flips true
  };
  for (const id in DB.neighborhoods) { c.market.nb[id] = 1.0; c.knowledge[id] = 0; }
  for (const id in DB.listings) {
    c.listingsState[id] = { status: "onMarket", price: DB.listings[id].price, dom: DB.listings[id].daysOnMarket };
  }
  // Intake queue: shuffle content clients, weight starters early.
  const all = Object.values(DB.clients);
  const starters = all.filter(x => x.tier === "starter").map(x => x.id);
  const rest = all.filter(x => x.tier !== "starter").map(x => x.id);
  c.clientQueue = [...shuffle(starters), ...shuffle(rest)];
  const bk = DB.brokerages[brokerageId];
  c.log.unshift({ day: 1, cls: "milestone",
    text: `Day 1. You hang your license at ${bk ? bk.name : "your own shingle"}. The phone is very quiet. For now.` });
  return c;
}

export function newGame(brokerageId) {
  S = makeCareer(brokerageId);
  save();
  return S;
}

/** Install a state the game did not build — an imported file, mainly. */
export function adoptState(next) { S = next; return S; }

// ---- persistence: the shared save system ------------------------------------
//
// Second adopter of assets/js/gvb-save.js, after The Fourth Quarter. What
// replaced the hand-rolled save(): export/import to a file, a memory-backed
// fallback when the browser blocks storage, and a load path that refuses
// garbage instead of JSON.parse-ing a corrupt blob straight into `S` and
// booting on it, which is what this did until now.
//
// The key stays `closingTime.save.v1`, unchanged, so every career saved by an
// older build still loads. Those saves carry no version stamp at all, which
// gvb-save reads as version 0 and sends through `repair`.

/** The gate on garbage: the fields nothing downstream can work around. */
export function validCareer(s) {
  return !!s && typeof s === "object"
    && typeof s.day === "number" && Number.isFinite(s.day)
    && typeof s.cash === "number" && Number.isFinite(s.cash)
    && typeof s.brokerageId === "string"
    && Array.isArray(s.clients);
}

const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Fill in what a save can be missing and clamp what it can get wrong.
 *
 * Handed to the slot as `repair`, so it runs on every accepted load through
 * every door — localStorage, an imported file, a pasted blob — and not only
 * when the version number moved (locked decision #37).
 *
 * Two families of gap live here, and the second one is specific to this game:
 *
 * 1. Fields added to `S` since a save was written. `seed` is the dangerous one:
 *    rand() is `S.seed * 1664525 ...`, so an undefined seed makes rand() return
 *    NaN forever, every `rand() < chance` false, and `pick(arr)` hand back
 *    undefined the first time something reads a property off it.
 * 2. Content added to `data/` since a save was written. Adding a JSON file and
 *    listing it in the manifest is the documented way to extend this game, and
 *    a career started before that file existed has no `listingsState` entry for
 *    it — which threw outright in renderMLS, and left new neighborhoods out of
 *    the weekly market drift.
 * 3. The reverse of #2: content *removed* from `data/` while a save still
 *    references it. `calendar.js` ages every id in `S.listingsState` and reads
 *    `DB.listings[id].address` on a price cut or an off-market roll — an id
 *    with no matching content file throws there, not in a screen render.
 *    Orphaned entries are pruned below for the same reason stale ones are
 *    backfilled: the save shouldn't hold state for content that no longer
 *    exists to have state about.
 *
 * Idempotent and cheap. It must never throw: a throw here is a `null` load,
 * which is a wiped career.
 */
export function repairCareer(s) {
  s.day = Math.max(1, Math.round(num(s.day, 1)));
  s.slotsLeft = Math.max(0, Math.round(num(s.slotsLeft, 4)));
  s.cash = num(s.cash, 0);
  s.xp = Math.max(0, num(s.xp, 0));
  s.rep = Math.max(0, Math.min(100, num(s.rep, 5)));
  s.level = Math.max(1, Math.min(LEVELS.length, Math.round(num(s.level, 1))));
  // rand() multiplies this. An undefined or NaN seed poisons every random
  // branch in the game and then crashes the first pick().
  if (!Number.isFinite(s.seed)) s.seed = Math.floor(Math.random() * 1e9);

  if (!s.market || typeof s.market !== "object") s.market = { rate: 6.4, nb: {} };
  s.market.rate = Math.max(3.5, Math.min(9.5, num(s.market.rate, 6.4)));
  if (!s.market.nb || typeof s.market.nb !== "object") s.market.nb = {};
  if (!s.knowledge || typeof s.knowledge !== "object") s.knowledge = {};
  if (!s.listingsState || typeof s.listingsState !== "object") s.listingsState = {};
  if (!s.firedEvents || typeof s.firedEvents !== "object") s.firedEvents = {};
  if (!s.stats || typeof s.stats !== "object") s.stats = {};
  for (const k of ["closed", "volume", "referrals", "honesty"]) s.stats[k] = num(s.stats[k], 0);
  for (const k of ["clients", "clientQueue", "usedClients", "playerListings", "deals", "schedule", "activeEffects", "log", "choiceQueue"]) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!(s.brokerageId in DB.brokerages)) {
    const first = Object.keys(DB.brokerages)[0];
    if (first) s.brokerageId = first;
  }
  s.careerEnded = !!s.careerEnded;
  if (!s.scorecard || typeof s.scorecard !== "object") s.scorecard = null;

  // Content that did not exist when this career started.
  for (const id in DB.neighborhoods) {
    if (!Number.isFinite(s.market.nb[id])) s.market.nb[id] = 1.0;   // NaN here stops the weekly drift dead
    if (!Number.isFinite(s.knowledge[id])) s.knowledge[id] = 0;
  }
  for (const id in DB.listings) {
    const ls = s.listingsState[id];
    if (!ls || typeof ls !== "object") {
      s.listingsState[id] = { status: "onMarket", price: DB.listings[id].price, dom: DB.listings[id].daysOnMarket };
      continue;
    }
    if (typeof ls.status !== "string") ls.status = "onMarket";
    ls.price = num(ls.price, DB.listings[id].price);
    ls.dom = Math.max(0, Math.round(num(ls.dom, DB.listings[id].daysOnMarket)));
  }
  // Content removed since this career started. calendar.js iterates
  // S.listingsState and S.market.nb by key and reads DB.listings[id] /
  // DB.neighborhoods[id] unguarded, so an id with no content file left in a
  // save throws on the next day it ages — not on a screen render, which is
  // exactly why it went unnoticed for the forward direction above.
  for (const id of Object.keys(s.listingsState)) if (!(id in DB.listings)) delete s.listingsState[id];
  for (const id of Object.keys(s.market.nb)) if (!(id in DB.neighborhoods)) delete s.market.nb[id];
  for (const id of Object.keys(s.knowledge)) if (!(id in DB.neighborhoods)) delete s.knowledge[id];

  for (const rec of s.clients) {
    if (!rec || typeof rec !== "object") continue;
    rec.patience = num(rec.patience, 5);
    rec.mood = num(rec.mood, 60);
    rec.satisfaction = num(rec.satisfaction, 60);
    // schmoozeCount++ on an undefined is NaN, and every schmooze reveal after
    // that compares NaN >= n and never fires again.
    rec.schmoozeCount = Math.max(0, Math.round(num(rec.schmoozeCount, 0)));
    if (!Array.isArray(rec.revealed)) rec.revealed = [];
    for (const k of ["viewed", "knownIssues", "toldIssues"]) {
      if (!rec[k] || typeof rec[k] !== "object") rec[k] = {};
    }
    if (typeof rec.status !== "string") rec.status = "active";
    const c = DB.clients[rec.clientId];
    if (!Number.isFinite(rec.budget) && c) rec.budget = c.budget;
  }

  for (const pl of s.playerListings) {
    if (!pl || typeof pl !== "object") continue;
    // dailySellerTick adds all four of these together every day a listing is
    // live. One undefined makes pl.interest NaN, and it never recovers.
    pl.dom = Math.max(0, Math.round(num(pl.dom, 0)));
    pl.interest = num(pl.interest, 0);
    pl.openHouseBoost = num(pl.openHouseBoost, 0);
    pl.marketingTier = Math.max(0, Math.min(2, Math.round(num(pl.marketingTier, 0))));
    pl.staged = Math.max(0, Math.min(2, Math.round(num(pl.staged, 0))));
    if (!Array.isArray(pl.offers)) pl.offers = [];
    if (!Array.isArray(pl.repairsDone)) pl.repairsDone = [];
    if (!Array.isArray(pl.disclosed)) pl.disclosed = [];
    if (!Array.isArray(pl.milestones)) pl.milestones = [];
  }

  for (const d of s.deals) {
    if (!d || typeof d !== "object") continue;
    if (!Array.isArray(d.milestones)) d.milestones = [];
    d.round = Math.max(0, Math.round(num(d.round, 0)));
    d.createdDay = Math.max(1, Math.round(num(d.createdDay, s.day)));
  }

  // uid() is `p + "_" + (S.nextId++)`. An undefined nextId makes every id
  // "cr_NaN", and getClientRec then matches the wrong record.
  if (!Number.isFinite(s.nextId)) s.nextId = highestIdIn(s) + 1;
  return s;
}

/** Largest numeric suffix on any generated id in a save, so nextId can't collide. */
function highestIdIn(s) {
  let max = 0;
  const scan = id => {
    const n = typeof id === "string" ? parseInt(id.slice(id.lastIndexOf("_") + 1), 10) : NaN;
    if (Number.isFinite(n) && n > max) max = n;
  };
  s.clients.forEach(r => r && scan(r.recId));
  s.deals.forEach(d => d && scan(d.id));
  s.playerListings.forEach(pl => { if (!pl) return; scan(pl.id); (pl.offers || []).forEach(o => o && scan(o.id)); });
  return max;
}

// One slot per storage, cached: main.js holds onto its slot for the save bar,
// and two slots over one key would work but would not be the same object.
const slots = new WeakMap();
let browserSlot = null;

function buildSlot(storage) {
  return createSaveSlot({
    game: "closing-time",
    key: SAVE_KEY,
    version: SAVE_VERSION,
    storage,
    validate: validCareer,
    repair: repairCareer,
    // makeCareer shuffles the intake queue and rolls an RNG seed, so day one
    // cannot be a literal. The brokerage is baked in here because `defaults`
    // takes no arguments — see the Shared-file request in the session notes;
    // nothing in the game reaches fresh() with a real choice pending.
    defaults: () => makeCareer(DEFAULT_BROKERAGE),
  });
}

/**
 * The save slot. Pass a storage stub in tests; pass nothing in the game.
 *
 * Nothing in this project touches `localStorage` itself any more. Reading that
 * property throws outright in a browser configured to block storage, which is
 * the case gvb-save's memory fallback exists to survive — so let it probe, and
 * let `slot.memoryOnly` be how the game finds out.
 */
export function careerSlot(storage) {
  if (!storage) return (browserSlot ||= buildSlot(undefined));
  if (!slots.has(storage)) slots.set(storage, buildSlot(storage));
  return slots.get(storage);
}

export function save(storage) { return careerSlot(storage).save(S); }
export function loadSave(storage) {
  const loaded = careerSlot(storage).load();
  if (!loaded) return false;
  S = loaded;
  return true;
}
/** Erase the career. The caller reloads; nothing reads the returned state. */
export function wipeSave(storage) { careerSlot(storage).reset(); }

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
  log(`${n >= 0 ? "+" : ""}${n} reputation — ${why}`, n >= 0 ? "rep" : "bad", "rep");
}
export function addCash(n, why) {
  S.cash += n;
  log(`${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString()} — ${why}`, n >= 0 ? "money" : "bad", "money");
}

export function clientSlotsMax() { return levelInfo().slots; }
export function activeClients() { return S.clients.filter(c => c.status === "active"); }
export function getClientRec(recId) { return S.clients.find(c => c.recId === recId); }
export function contentClient(rec) { return DB.clients[rec.clientId]; }

// `kind` is a filter category, separate from `cls` (which only drives color).
// addRep/addCash tag "rep"/"money"; everything else leaves it undefined, which
// the Ledger's "Everything" filter still shows — see ui.js's renderLog.
export function log(text, cls = "", kind = undefined) {
  S.log.unshift({ day: S.day, text, cls, kind });
  if (S.log.length > 300) S.log.pop();
}

export function scheduleItem(day, label, type, ref) {
  S.schedule.push({ day, label, type, ref });
  S.schedule.sort((a, b) => a.day - b.day);
}
export function unschedule(pred) { S.schedule = S.schedule.filter(it => !pred(it)); }
