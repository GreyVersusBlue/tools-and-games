// autopilot.mjs — scripted players over the Corner & Kettle sim.
//
// Shared by test/balance.mjs (hundreds of seeds, is the shop playable) and
// anything else that wants a whole day played in Node. Three policies:
//
//   patient   serves a cup only when orderIsComplete() says the ticket is done
//   eager     serves the moment the page's Serve button would enable, which
//             is sim.serveReadiness(slot).canServe — the page reads the same
//             call, so this is the button by construction rather than a copy
//             of it: a base and, sometimes, some milk; for food, a plate with
//             anything on it. Until Phase 3 the page's gate was
//             `slot.food ? true : cupMatchesEnough(...)` and an eager player
//             served an empty plate for 40% (#342)
//   shopper   patient hands plus a chalkboard: at every close it spends the
//             till down a stated priority list, so two upgrade paths can be
//             compared on the same seeds
//
// The player has one pair of hands. Every HAND_MS of shift time they take one
// ticket line on the station whose customer has the least patience left, the
// same step the barista's autoAssistStep() takes, and serving is free. HAND_MS
// is a stated assumption, not a measurement: the page's station bars run 350
// to 1100 ms and a click starts each one, so 800 ms is a person who is neither
// asleep nor a script. smoke-sim.mjs's one-line autopilot works every station
// every frame and is a ceiling, not a player; the numbers here are meant to be
// compared with each other, on the same HAND_MS, not with it.
//
// It never reads anything a player cannot see. It does not peek at the rng,
// the event schedule, or a barista's pending fumble roll.

import * as CONTENT from "../js/content.js";
import { STEP_MS, makeRng, createSim, freshState } from "../js/sim.js";

export const HAND_MS = 800;

/**
 * A shop on a seed. `counters.finished` counts the cups a barista handed
 * back and `counters.fumbles` the ones they "rushed", off the toasts, because
 * the sim's notify is fixed at construction and a fumble leaves no other mark
 * on the state a player could read. `mutate`
 * edits the fresh state before the sim sees it (a prestige level, a day).
 */
export function makeShop(seed, mutate) {
  const state = freshState(CONTENT);
  if (mutate) mutate(state);
  const counters = { fumbles: 0, finished: 0 };
  const sim = createSim({
    content: CONTENT, rng: makeRng(seed), state,
    notify: e => {
      if (e.type !== "toast") return;
      if (/rushed the order/.test(e.text)) { counters.fumbles++; counters.finished++; }
      else if (/finished the order/.test(e.text)) counters.finished++;
    },
  });
  return { sim, state, counters };
}

/* ---------- serving policies ---------- */

function readyPatient(sim, slot) { return sim.orderIsComplete(slot); }
function readyEager(sim, slot) { return sim.serveReadiness(slot).canServe; }

export const patient = { name: "patient", ready: readyPatient, shop: null };
export const eager = { name: "eager", ready: readyEager, shop: null };

/**
 * The chalkboard, spent by priority. Each entry is tried in order at every
 * close and bought when it is affordable and not yet owned; the list is
 * walked again from the top after each purchase, so a cheap early item is
 * never starved by an expensive one ahead of it. Entries are `{type, id}` in
 * the sim's purchase() vocabulary.
 */
export const DEFAULT_PRIORITY = [
  { type: "hireBarista" },
  { type: "station", id: 3 },
  { type: "ambiance", id: "music" },
  { type: "equipment", id: "grinder" },
  { type: "equipment", id: "pos2" },
  { type: "trainBarista" },
  { type: "promoteBarista" },
  { type: "ambiance", id: "seating" },
  { type: "hireBarista" },
  { type: "equipment", id: "espresso2" },
  { type: "ambiance", id: "decor" },
  { type: "station", id: 4 },
  { type: "loyalty", id: 1 },
  { type: "equipment", id: "foodprep" },
  { type: "recipe", id: "mocha" },
  { type: "recipe", id: "caramelmac" },
  { type: "syrup", id: "mocha" },
  { type: "hireBarista" },
  { type: "equipment", id: "espresso3" },
  { type: "loyalty", id: 2 },
];

export function shopper(priority = DEFAULT_PRIORITY, name = "shopper") {
  return { name, ready: readyPatient, shop: priority };
}

/**
 * One chalkboard purchase, through the sim's own purchase table (#344) — the
 * same call the page's chalkboard makes, so a purchase the page would refuse
 * is refused here too. Until Phase 4 this was a hand-kept mirror of the page's
 * doUnlock() (#339). The one thing a priority list cannot name is *which*
 * barista to promote or train, so those take the first one eligible.
 */
export function purchase(sim, state, item) {
  let { type, id } = item;
  if (!sim.PURCHASE_TYPES.includes(type)) throw new Error(`purchase: unknown chalkboard type "${type}"`);
  if (type === "promoteBarista" && id == null) id = state.baristas.find(b => b.level < 2)?.id;
  if (type === "trainBarista" && id == null) id = state.baristas.find(b => !b.trained)?.id;
  return sim.purchase(type, id).ok;
}

/** Walk the list from the top after every buy. Returns what was bought, in order. */
export function spend(sim, state, priority) {
  const bought = [];
  for (let guard = 0; guard < 100; guard++) {
    const item = priority.find(it => purchase(sim, state, it));
    if (!item) break;
    bought.push(item.id ? `${item.type}:${item.id}` : item.type);
  }
  return bought;
}

/* ---------- one day ---------- */

/**
 * Play the current day to its close under a policy. Returns the day's row:
 *
 *   offered    customers who joined the queue today
 *   served     cups and plates scored (drinks + food)
 *   unserved   customers still in line or on a station at close — nobody
 *              walks in this game, patience only stops the tip, so this is
 *              the only "walked" there is and it is named for what it is
 *   drinks, food, gross (money credited by scoreServe), wages, net
 *   accuracy   mean scored ratio, 0..1
 *   bestStreak, repDelta (reputation at close minus at open), fumbles
 *   and finished (barista toasts, read off makeShop's counters), tipped
 *   (serves made while the customer still had patience) and patienceSum
 *   (the sum over serves of patience left as a share of patienceMax: the
 *   number the tip is computed from, and the only thing patience changes),
 *   spent and bought (the shopper's)
 */
export function playDay(sim, state, policy = patient, { handMs = HAND_MS, counters = { fumbles: 0 } } = {}) {
  if (!state.shiftRunning) throw new Error("playDay: the shift is not running");
  const idAtOpen = state.nextCustomerId;
  const repAtOpen = state.reputation;
  const moneyAtOpen = state.money;
  const fumblesAtOpen = counters.fumbles, finishedAtOpen = counters.finished || 0;
  let gross = 0, tipped = 0, patienceSum = 0, handAcc = 0, steps = 0;

  while (state.shiftRunning) {
    // Serve everything the policy calls ready, then take waiting customers.
    state.slots.forEach(slot => {
      if (!slot || slot.serving) return;
      if (policy.ready(sim, slot)) {
        const r = sim.scoreServe(slot);
        if (r) {
          gross += r.earned;
          const c = slot.customer;
          if (c.patience > 0) tipped++;
          patienceSum += c.patienceMax ? c.patience / c.patienceMax : 0;
        }
      }
    });
    while (state.queue.length && state.slots.includes(null)) {
      const next = state.queue.reduce((a, c) => (c.patience < a.patience ? c : a));
      sim.acceptCustomer(next.id);
    }
    // One pair of hands: every handMs, one step on the neediest unfinished station.
    handAcc += STEP_MS;
    if (handAcc >= handMs) {
      handAcc -= handMs;
      let pick = null;
      state.slots.forEach(slot => {
        if (!slot || slot.serving || sim.orderIsComplete(slot)) return;
        if (!pick || slot.customer.patience < pick.customer.patience) pick = slot;
      });
      if (pick) sim.autoAssistStep(pick);
    }
    sim.advance(STEP_MS);
    if (++steps > 1e6) throw new Error("playDay: the shift never ended");
  }
  const ds = state.dayStats;
  const served = ds.drinksServed + ds.foodServed;
  const unserved = state.queue.length + state.slots.filter(s => s && !s.serving).length;
  const bought = policy.shop ? spend(sim, state, policy.shop) : [];
  const spent = policy.shop ? (moneyAtOpen + gross - ds.wagesPaid) - state.money : 0;
  return {
    day: state.day, prestige: state.prestigeLevel,
    offered: state.nextCustomerId - idAtOpen, served, unserved,
    drinks: ds.drinksServed, food: ds.foodServed,
    gross, wages: ds.wagesPaid, net: gross - ds.wagesPaid,
    accuracy: ds.accuracyCount ? ds.accuracySum / ds.accuracyCount : 1,
    bestStreak: state.bestCombo,
    repDelta: Math.round((state.reputation - repAtOpen) * 10) / 10,
    fumbles: counters.fumbles - fumblesAtOpen, finished: (counters.finished || 0) - finishedAtOpen,
    tipped, patienceSum, spent, bought, money: state.money,
  };
}

/**
 * A run: `days` days from the state the sim was created on, reopening the
 * shop (prestige) at the close of every day named in `prestigeAfter`. Day
 * numbers restart at 1 on a reopen, so each row carries its prestige level.
 */
export function playRun(sim, state, { days = 10, policy = patient, prestigeAfter = [], handMs = HAND_MS, counters } = {}) {
  const rows = [];
  for (let i = 0; i < days; i++) {
    rows.push(playDay(sim, state, policy, { handMs, counters }));
    if (i === days - 1) break;
    if (prestigeAfter.includes(i + 1)) sim.prestige();
    else sim.startNextDay();
  }
  return rows;
}
