// state.js — canonical game state, persistence, career ladder, RNG helpers.
import { DB } from "./data.js";
import { FINANCING, DEFAULT_FINANCING, financingFor } from "./engine/financing.js";
import { clauseOf } from "./engine/escalation.js";
// Relative, not "/assets/js/gvb-save.js": tools/smoke.mjs imports this module
// under plain Node, which cannot resolve a leading slash. The relative form
// resolves identically in the browser.
import { createNamespace } from "../../../assets/js/gvb-save.js";

/**
 * Every key this game writes starts with this. The career's key predates the
 * namespace and is not changing (#36): `closingTime.` + `save.v1` is the same
 * string byte for byte, which is what a namespace prefix is for (#496).
 */
export const SAVE_PREFIX = "closingTime.";
export const SAVE_KEY = "closingTime.save.v1";
/** Bump when the shape changes. 0 means "written before this file used a slot". */
export const SAVE_VERSION = 1;
/** The hall of past careers: a second member under the same prefix. */
export const HALL_KEY = "closingTime.hall";
export const HALL_VERSION = 1;
/** What fresh() hands back when nobody picked. The game always picks — see careerSlot(). */
export const DEFAULT_BROKERAGE = "bk_indep";

/**
 * The ladder. `tiers` is what the MLS board will let you work and what intake
 * will hand you, and it is the only gate the commercial tier has: a building
 * is not a bigger house, and an agent who has never taken a listing does not
 * get handed a rent roll. Broker-Track is where it opens, which is what the
 * rung was always named for.
 */
export const LEVELS = [
  { level: 1, title: "Rookie Agent",   xp: 0,    slots: 2, tiers: ["starter"] },
  { level: 2, title: "Associate",      xp: 100,  slots: 3, tiers: ["starter", "mid"] },
  { level: 3, title: "Senior Agent",   xp: 300,  slots: 4, tiers: ["starter", "mid", "luxury"] },
  { level: 4, title: "Broker-Track",   xp: 700,  slots: 5, tiers: ["starter", "mid", "luxury", "commercial"] },
  { level: 5, title: "Managing Broker",xp: 1300, slots: 6, tiers: ["starter", "mid", "luxury", "commercial"] },
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
    careerId: newCareerId(),       // what the hall files this career under — see enrollFinishedCareer()
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

/**
 * An id the hall can file a career under. Time plus a random tail rather than
 * the RNG seed: rand() rewrites `seed` on every call, so it is the one number
 * in a career that never stays put.
 */
function newCareerId() {
  return "career_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 0xffffff).toString(36);
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
  // A career written before the hall existed has no id. It gets one derived
  // from the bytes it arrived with rather than rolled, because repair runs on
  // every accepted load (#37) and a finished career sitting in an old save
  // may be loaded many times before anything writes it back: a rolled id
  // would enrol the same year in the hall once per visit. On a career that
  // is still being played the fields below move, but the id is written back
  // on the next save and never derived again.
  if (typeof s.careerId !== "string" || !s.careerId) {
    s.careerId = "career_legacy_" + hashOf([s.brokerageId, s.seed, s.day, s.nextId, s.cash, s.xp].join("|"));
  }

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

  // Content removed while something was still live ON it. The three purges
  // above cover save state keyed BY a content id; this covers save state that
  // POINTS AT one, which is the case the earlier round left open ("don't
  // delete a listing a save might be mid-contract on").
  //
  // Deleting a listing under contract is still a bad idea and this does not
  // make it a good one. What it makes it is survivable: deals.js reads
  // DB.listings[deal.listingId] unguarded in five places, calendar.js:95 reads
  // DB.listings[d.listingId].address AND DB.agents[d.agentId].name on an
  // expiring offer, and clients.js:9 reads DB.clients[id].tier over the whole
  // queue. Each of those throws on a day advance rather than on a render, so
  // the career is not merely wrong, it is unplayable and the player cannot see
  // why.
  //
  // A dropped deal is player progress vanishing, so it does not vanish
  // quietly: each one leaves a Ledger line. Pushed onto s.log directly rather
  // than through log(), which writes to the live S this function may not be
  // operating on yet.
  const note = text => {
    s.log.unshift({ day: s.day, text, cls: "bad", kind: undefined, recId: undefined });
    if (s.log.length > 300) s.log.pop();
  };

  // A client record whose content file is gone. contentClient(rec) is
  // DB.clients[rec.clientId] and ui.js reads .name off it on every card.
  const goneRecIds = new Set();
  s.clients = s.clients.filter(rec => {
    if (!rec || typeof rec !== "object") return false;
    if (rec.clientId in DB.clients) return true;
    goneRecIds.add(rec.recId);
    note(`A client whose file is no longer in the game has been removed from your book.`);
    return false;
  });
  s.clientQueue = s.clientQueue.filter(id => id in DB.clients);
  s.usedClients = s.usedClients.filter(id => id in DB.clients);

  // Deals pointing at a listing, an agent, or a client record that is gone.
  const deadDealIds = new Set();
  s.deals = s.deals.filter(d => {
    if (!d || typeof d !== "object") return false;
    const why = !(d.listingId in DB.listings) ? "the listing"
      : !(d.agentId in DB.agents) ? "the other agent"
      : goneRecIds.has(d.clientRecId) ? "the client"
      : null;
    if (!why) return true;
    deadDealIds.add(d.id);
    note(`A deal fell through: ${why} is no longer in the game. The paperwork is void.`);
    return false;
  });

  // A player listing belongs to a client record; its offers name an agent.
  // pl.listing is a deep copy taken at signing, so it survives its own
  // content file being deleted and only the client link can dangle.
  s.playerListings = s.playerListings.filter(pl => {
    if (!pl || typeof pl !== "object") return false;
    if (!goneRecIds.has(pl.clientRecId)) return true;
    deadDealIds.add(pl.id);
    note(`A listing agreement ended: its seller is no longer in the game.`);
    return false;
  });
  for (const pl of s.playerListings) {
    if (Array.isArray(pl.offers)) pl.offers = pl.offers.filter(o => o && o.agentId in DB.agents);
  }

  // Whatever pointed at what just went away. A schedule item's `ref` is a deal
  // or player-listing id (deals.js:140, seller.js:140), and a client record's
  // dealId is the same. A choice left in the queue for a dead deal would open
  // a modal over a deal that is not there.
  s.schedule = s.schedule.filter(it => !(it && deadDealIds.has(it.ref)));
  s.choiceQueue = s.choiceQueue.filter(ch => !(ch && deadDealIds.has(ch.dealId)));
  for (const rec of s.clients) {
    if (rec && deadDealIds.has(rec.dealId)) rec.dealId = null;
  }

  // A listing whose deal just died should not stay flagged under contract, or
  // the MLS shows it as unavailable forever with nothing pointing at it.
  for (const id in s.listingsState) {
    const ls = s.listingsState[id];
    if (ls && ls.status === "underContract" && !s.deals.some(d => d.listingId === id)) {
      ls.status = "onMarket";
    }
  }

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
    // Added with per-client financing. Every career written before that has no
    // `financing` on any record, and a buyer without one would fall through
    // dealFinancing() to conventional forever — which is not wrong, but it is
    // not this buyer either. financingFor() is a pure function of the content
    // file, so recomputing it here gives a legacy save the same answer a fresh
    // career would, and gives it the same answer again on every later load.
    // Deliberately NOT rand()-based for exactly that reason: repair runs on
    // every accepted load (#37), and a seed advanced once per reload would
    // quietly re-roll the rest of the career's events.
    if (!(rec.financing in FINANCING)) rec.financing = financingFor(c);
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
    // A highest-and-best call in flight. dailySellerTick() fires on
    // `S.day >= pl.hbDeadline`, so a junk value here either never fires or
    // fires on the next day advance; neither is wrong, but a save should not
    // carry a deadline it cannot explain.
    if (!Number.isFinite(pl.hbDeadline)) pl.hbDeadline = null;
    if (!Number.isFinite(pl.hbCalledDay)) pl.hbCalledDay = null;
    // Escalation clauses, normalized in place. Offers written before this
    // existed carry `escalation` as a bare cap; clauseOf() reads those at the
    // default increment, and writing the structured form back means the save
    // holds one shape from here on. A cap under the offer's own price is not a
    // clause and is dropped rather than left to look like one in the UI.
    for (const o of pl.offers) {
      if (!o || o.escalation == null) continue;
      o.escalation = clauseOf(o);
    }
    for (const o of pl.offers) if (o && !Number.isFinite(o.hbDeadline)) delete o.hbDeadline;
  }

  for (const d of s.deals) {
    if (!d || typeof d !== "object") continue;
    if (!Array.isArray(d.milestones)) d.milestones = [];
    d.round = Math.max(0, Math.round(num(d.round, 0)));
    d.createdDay = Math.max(1, Math.round(num(d.createdDay, s.day)));
    // A deal already on the table keeps the terms it was written under, so this
    // reads the buyer's record rather than re-deriving. A deal whose client is
    // gone was dropped above, so the lookup is only null on a seller-side row.
    if (!(d.financing in FINANCING)) {
      const buyer = s.clients.find(r => r && r.recId === d.clientRecId);
      d.financing = (buyer && buyer.financing) || DEFAULT_FINANCING;
    }
    // Same normalization as the seller side. agentRespond() counters at the cap
    // when there is one, so a cap that survived as NaN would counter at NaN and
    // every later comparison against it would be false.
    if (d.escalation != null) d.escalation = clauseOf(d);
  }

  // uid() is `p + "_" + (S.nextId++)`. An undefined nextId makes every id
  // "cr_NaN", and getClientRec then matches the wrong record.
  if (!Number.isFinite(s.nextId)) s.nextId = highestIdIn(s) + 1;
  return s;
}

/** FNV-1a over a string, as eight hex digits. Stable across loads, which is all it is for. */
function hashOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
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

// ---- the namespace: the career and the hall, under one prefix ---------------
//
// One namespace per storage, cached: main.js holds onto the career slot for
// the save bar, and two slots over one key would work but would not be the
// same object. Both members are registered on the first call, because a
// member's options go on its first `slot()` and a later call with options
// throws (#496); registering them in one place means nothing can disagree.
const namespaces = new WeakMap();
let browserNs = null;

function buildNamespace(storage) {
  const ns = createNamespace({ game: "closing-time", prefix: SAVE_PREFIX, storage });
  ns.slot("save.v1", {
    version: SAVE_VERSION,
    validate: validCareer,
    repair: repairCareer,
    // makeCareer shuffles the intake queue and rolls an RNG seed, so day one
    // cannot be a literal. The brokerage is baked in here because `defaults`
    // takes no arguments — see the Shared-file request in the session notes;
    // nothing in the game reaches fresh() with a real choice pending.
    defaults: () => makeCareer(DEFAULT_BROKERAGE),
  });
  ns.slot("hall", {
    version: HALL_VERSION,
    validate: validHall,
    repair: repairHall,
    defaults: () => ({ careers: [] }),
  });
  return ns;
}

/**
 * The namespace. Pass a storage stub in tests; pass nothing in the game.
 *
 * Nothing in this project touches `localStorage` itself any more. Reading that
 * property throws outright in a browser configured to block storage, which is
 * the case gvb-save's memory fallback exists to survive — so let it probe, and
 * let `slot.memoryOnly` be how the game finds out.
 */
export function saveNamespace(storage) {
  if (!storage) return (browserNs ||= buildNamespace(undefined));
  if (!namespaces.has(storage)) namespaces.set(storage, buildNamespace(storage));
  return namespaces.get(storage);
}

/** The career's slot: key `closingTime.save.v1`, as it has always been. */
export function careerSlot(storage) { return saveNamespace(storage).slot("save.v1"); }
/** The hall's slot: key `closingTime.hall`. */
export function hallSlot(storage) { return saveNamespace(storage).slot("hall"); }

export function save(storage) { return careerSlot(storage).save(S); }
export function loadSave(storage) {
  const loaded = careerSlot(storage).load();
  if (!loaded) return false;
  S = loaded;
  // A career that finished before the hall existed is still a finished
  // career. Enrolling on load rather than in repair keeps repair pure: it
  // runs on imports and on deserialize too, and must never write anywhere.
  enrollFinishedCareer(storage);
  return true;
}
/** Erase the career. The hall is not the career and stays. The caller reloads. */
export function wipeSave(storage) { careerSlot(storage).reset(); }

// ---- the hall of past careers -----------------------------------------------
//
// A finished career leaves a record. The scorecard endDay() freezes at day
// 336 was the whole record until now, and "New career" wiped it: the button
// answered "how do I start the next one" and not "does this year go
// anywhere". The hall is one array of those scorecards under its own key,
// written once per career, kept across every wipe.
//
// Finished careers only. A career abandoned on day 200 has no scorecard and
// gets no row: the hall is a hall of years, not of attempts, and a row for
// every "New career" click would bury the years under the false starts.

/** The gate on garbage: a hall is an object with a `careers` array. */
export function validHall(h) {
  return !!h && typeof h === "object" && Array.isArray(h.careers);
}

/** A hall entry the game can render. Anything else is dropped by repairHall. */
function validEntry(e) {
  return !!e && typeof e === "object" && typeof e.id === "string" && !!e.id
    && typeof e.closings === "number" && Number.isFinite(e.closings)
    && typeof e.volume === "number" && Number.isFinite(e.volume);
}

/**
 * Drop what cannot be rendered, coerce what can, and keep one row per career
 * id. Runs on every load (#37) and on every import, so the hall never holds
 * two rows for one year however it got there. Never throws: a throw is a null
 * load, and a null hall would look like an empty one.
 */
export function repairHall(h) {
  const seen = new Set();
  h.careers = h.careers.filter(e => {
    if (!validEntry(e) || seen.has(e.id)) return false;
    seen.add(e.id);
    e.seq = Math.max(1, Math.round(num(e.seq, 1)));
    e.day = Math.max(1, Math.round(num(e.day, 1)));
    e.referrals = Math.max(0, num(e.referrals, 0));
    e.honesty = Math.max(0, num(e.honesty, 0));
    e.finalRep = Math.max(0, Math.min(100, num(e.finalRep, 0)));
    e.level = Math.max(1, Math.min(LEVELS.length, Math.round(num(e.level, 1))));
    e.cash = num(e.cash, 0);
    if (typeof e.title !== "string") e.title = LEVELS[e.level - 1].title;
    if (typeof e.brokerageId !== "string") e.brokerageId = DEFAULT_BROKERAGE;
    if (typeof e.brokerage !== "string") e.brokerage = (DB.brokerages[e.brokerageId] || {}).name || e.brokerageId;
    if (typeof e.recordedAt !== "string") e.recordedAt = "";
    return true;
  });
  h.careers.sort((a, b) => a.seq - b.seq || a.recordedAt.localeCompare(b.recordedAt));
  h.careers.forEach((e, i) => { e.seq = i + 1; });
  return h;
}

/** The hall as stored, or an empty one. Never null: a hall that will not load reads as empty. */
export function loadHall(storage) {
  const slot = hallSlot(storage);
  return slot.load() || slot.fresh();
}
export function saveHall(hall, storage) { return hallSlot(storage).save(hall); }

/** What one finished career leaves behind. Pure: reads the state, writes nothing. */
export function hallEntryFor(s) {
  const sc = s.scorecard || {};
  const bk = DB.brokerages[s.brokerageId];
  return {
    id: s.careerId,
    seq: 0,                                     // assigned by enrollFinishedCareer
    brokerageId: s.brokerageId,
    brokerage: bk ? bk.name : s.brokerageId,
    day: num(sc.day, s.day),
    closings: num(sc.closings, s.stats.closed),
    volume: num(sc.volume, s.stats.volume),
    referrals: num(sc.referrals, s.stats.referrals),
    honesty: num(s.stats.honesty, 0),
    finalRep: num(sc.finalRep, s.rep),
    level: num(sc.level, s.level),
    title: typeof sc.title === "string" ? sc.title : LEVELS[num(sc.level, s.level) - 1].title,
    cash: num(sc.cash, s.cash),
    recordedAt: new Date().toISOString(),
  };
}

/**
 * File the live career in the hall, once. Returns the hall entry, or null
 * when there is nothing to file: a career still being played, or one with no
 * scorecard. Idempotent on the career id, so calendar.js can call it the day
 * the year closes and loadSave() can call it on every later visit, and the
 * hall holds one row either way.
 */
export function enrollFinishedCareer(storage) {
  if (!S || !S.careerEnded || !S.scorecard || typeof S.careerId !== "string") return null;
  const hall = loadHall(storage);
  const already = hall.careers.find(e => e.id === S.careerId);
  if (already) return already;
  const entry = hallEntryFor(S);
  entry.seq = hall.careers.length + 1;
  hall.careers.push(entry);
  saveHall(hall, storage);
  return entry;
}

/**
 * Fold another hall into this one: rows this hall has not seen are appended
 * in the order they were recorded, rows it has are kept as they are. The
 * import path — a hall file from another machine — so it merges rather than
 * replaces, and it reports how many rows it added. Writes only when it
 * changed something.
 */
export function mergeHall(incoming, storage) {
  const hall = loadHall(storage);
  const have = new Set(hall.careers.map(e => e.id));
  const fresh = (incoming && Array.isArray(incoming.careers) ? incoming.careers : [])
    .filter(e => validEntry(e) && !have.has(e.id))
    .sort((a, b) => String(a.recordedAt || "").localeCompare(String(b.recordedAt || "")));
  for (const e of fresh) {
    have.add(e.id);
    hall.careers.push({ ...e, seq: hall.careers.length + 1 });
  }
  if (fresh.length) saveHall(repairHall(hall), storage);
  return { hall, added: fresh.length };
}

/**
 * The best year on each count. `{ volume: id, closings: id, finalRep: id,
 * cash: id }`, or an empty object for an empty hall; ties go to the earlier
 * year, which held the record first.
 */
export function hallBests(hall) {
  const bests = {};
  for (const k of ["volume", "closings", "finalRep", "cash"]) {
    let top = null;
    for (const e of hall.careers) if (!top || e[k] > top[k]) top = e;
    if (top) bests[k] = top.id;
  }
  return bests;
}

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
export function addXP(n, why, recId = undefined) {
  S.xp += n;
  log(`+${n} XP — ${why}`, "xp", undefined, recId);
  const next = LEVELS[S.level];
  if (next && S.xp >= next.xp) {
    S.level = next.level;
    log(`Promotion: you are now a ${next.title}. Client slots: ${next.slots}. Tiers unlocked: ${next.tiers.join(", ")}.`, "milestone");
  }
}
export function addRep(n, why, recId = undefined) {
  S.rep = Math.max(0, Math.min(100, S.rep + n));
  log(`${n >= 0 ? "+" : ""}${n} reputation — ${why}`, n >= 0 ? "rep" : "bad", "rep", recId);
}
export function addCash(n, why, recId = undefined) {
  S.cash += n;
  log(`${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString()} — ${why}`, n >= 0 ? "money" : "bad", "money", recId);
}

export function clientSlotsMax() { return levelInfo().slots; }
export function activeClients() { return S.clients.filter(c => c.status === "active"); }
export function getClientRec(recId) { return S.clients.find(c => c.recId === recId); }
export function contentClient(rec) { return DB.clients[rec.clientId]; }

// `kind` is a filter category, separate from `cls` (which only drives color).
// addRep/addCash tag "rep"/"money"; everything else leaves it undefined, which
// the Ledger's "Everything" filter still shows — see ui.js's renderLog.
// `recId` stamps a log line as belonging to one client's history, for the
// Ledger's per-client filter — see ui.js's logPanel. Left undefined for a line
// that isn't about one specific client (market rates, weekly announcements,
// brokerage recruitment).
export function log(text, cls = "", kind = undefined, recId = undefined) {
  S.log.unshift({ day: S.day, text, cls, kind, recId });
  if (S.log.length > 300) S.log.pop();
}

export function scheduleItem(day, label, type, ref) {
  S.schedule.push({ day, label, type, ref });
  S.schedule.sort((a, b) => a.day - b.day);
}
export function unschedule(pred) { S.schedule = S.schedule.filter(it => !pred(it)); }
