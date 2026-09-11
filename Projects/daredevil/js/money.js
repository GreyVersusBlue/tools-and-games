// money.js — the hub economy: how many evenings a hub hands out, what an
// evening costs, what a stretch of shows pays, and the one integer that holds
// the difference.
//
// WHY THIS FILE EXISTS (Phase 6)
//
// The four free-roam hubs handed out seven evenings and built four cards, and
// the pips were decoration. `hubExhausted()` fired because the cards ran out,
// not because the evenings did — correct behaviour for a broken economy, and
// the reason Milestone 4 was unreachable before round 1. Free Roam 2 was the
// only hub where a budget bound anything.
//
// Meanwhile the prose had an economy in it and the game did not hold it.
// `fr2_debt_01`'s twelve hundred dollars, its four `debtSource` answers, the
// thirty-seven dollars a month to Garrett Pyle, six Saturdays at fifty-five,
// a hundred and ninety-eight dollars on a good Friday and nothing on a wet
// one, and a school district that would rent Duke thirteen buses "against a
// deposit he did not have yet" — all written, none of it a number anything
// could read.
//
// So: one integer, `GS.flags.money`, in whole dollars. It lives in the flag
// bag rather than beside `stats` because that is where this game already keeps
// the run's numbers that are not stats (`hubEvenings`, `perkinsFee`), and
// because `repairState`'s fill-in for a missing default then covers it for
// free. It is seeded in `freshState` and coerced back to a whole number by
// `repair` (decision #286).
//
// WHERE THIS FILE SITS, AND WHY IT IMPORTS NOTHING
//
// This is the lowest leaf in the folder — below cast.js, below save.js. It has
// to be: save.js seeds `money` and Free Roam 1's budget in `freshState`, and
// save.js is what state.js imports to build GS. A module that reached for GS
// itself would close the loop save.js -> money.js -> state.js -> save.js and
// read GS out of the temporal dead zone, the exact trap state.js's own header
// describes. So every function here takes the state it works on as an
// argument. That also makes the whole economy testable without a browser and
// without a run.

/* ================================================================
   EVENINGS PER HUB
   ================================================================ */
// Fewer evenings than cards, in every hub, so that an evening spent is a card
// not read. The card counts these are set against, at their maximum:
//
//   fr1  5  ruthie, cal, practice, bar, contract
//   fr2  7  cal, ruthie, practice, bar, press, + cal_02 and ruthie_02
//   fr3  4  earl, ruthie, cal, tommy
//   fr4  7  night ride, ruthie, cal, tommy, earl, california, + the Wednesday
//
// Free Roam 4 declares seven and no single run sees more than six, because
// Earl's evening and the man from California's are the same evening on the two
// branches. The budget is set against the declared list, which is what
// `smoke-save.mjs` scrapes out of the renderer.
//
// Free Roam 4 after a Milestone 4 failure keeps the discount it always had:
// one fewer evening than the same hub after a triumph. That is why only Free
// Roam 1's budget is a plain `freshState` default — the other three are not
// known until the run gets there. `smoke-save.mjs` checks every one of these
// against the card list scraped out of engine.js, in both directions.
export const HUB_EVENINGS = {
  fr1: 3,
  fr2: 4,
  fr3: 3,
  fr4: 4,
  fr4_failure: 3,
};

/* ================================================================
   WHAT AN EVENING COSTS
   ================================================================ */
// One row per hub evening card. `money` is dollars off the integer; `condition`
// is signed and is a COST, so 1 takes a point of Condition and -1 gives one
// back. Every hub has at least one row that gives a point back, and Free Roam
// 4's is the night ride, which is on the board on every run.
//
// The three scenes that already moved Condition themselves keep doing it and
// carry 0 here — `fr1_eve_ruthie`'s statUpdate (+1), and the bar nights at
// Free Roam 1 and 2, whose own choices take a point. Two writers for one
// evening would be one rule in two places.
export const EVENING_COST = {
  fr1_eve_ruthie:          { money: 0,  condition: 0 },
  fr1_eve_cal:             { money: 8,  condition: 0 },
  fr1_eve_practice:        { money: 14, condition: 0 },
  fr1_eve_bar:             { money: 12, condition: 0 },
  fr1_eve_contract:        { money: 0,  condition: 0 },

  fr2_eve_cal:             { money: 18, condition: 0 },
  fr2_eve_ruthie:          { money: 0,  condition: -1 },
  fr2_eve_practice:        { money: 55, condition: 1 },
  fr2_eve_bar:             { money: 16, condition: 0 },
  fr2_eve_press:           { money: 6,  condition: 0 },
  fr2_eve_cal_02:          { money: 12, condition: 0 },
  fr2_eve_ruthie_02:       { money: 0,  condition: -1 },

  fr3_eve_earl:            { money: 0,  condition: 0 },
  fr3_eve_ruthie:          { money: 0,  condition: -1 },
  fr3_eve_cal:             { money: 40, condition: 0 },
  fr3_eve_tommy:           { money: 14, condition: 1 },

  fr4_night_ride:          { money: 6,  condition: -1 },
  fr4_eve_ruthie:          { money: 0,  condition: -1 },
  fr4_eve_cal:             { money: 35, condition: 0 },
  fr4_eve_tommy:           { money: 14, condition: 1 },
  fr4_eve_earl:            { money: 0,  condition: 0 },
  fr4_eve_california:      { money: 0,  condition: 0 },
  fr4_ruthie_thread_close: { money: 12, condition: -1 },
};

/* ================================================================
   WHAT A STRETCH OF SHOWS PAYS
   ================================================================ */
// Credited once, on the first render of each hub, as what the weeks since the
// last milestone put in Duke's hand. `months` is how long that stretch is, for
// the paper he signed: `monthlyOutgo` times `months` comes off the take.
//
// The numbers are the prose's. Free Roam 1 is the fair — "He'd made ninety
// dollars at the fair" (m2_solo_entry) — and it is the same on both branches
// because the branch has not happened yet. After that the backer arm is Earl's
// calendar and the solo arm is Dot Kessler's Friday card plus whatever Duke
// booked himself, which is the gap `fr2_debt_01` is about: "He'd made eighteen
// hundred at the last three shows combined" against "six hundred and forty at
// the last five".
export const HUB_TAKE = {
  fr1: { backer: 90,   solo: 90,   months: 0 },
  fr2: { backer: 540,  solo: 330,  months: 3 },
  fr3: { backer: 1240, solo: 860,  months: 4 },
  fr4: { backer: 1600, solo: 1100, months: 4 },
};

/* ================================================================
   THE NUMBERS THE PROSE ALREADY NAMED
   ================================================================ */

/** The twelve hundred `fr2_debt_01` is about. One name, four answers. */
export const CAR_MONEY = 1200;
/** The four hundred and ten the solo Milestone 2 needs, against the bike or a
 *  second name. "Four hundred and ten dollars he did not have, needed by a
 *  Saturday he already had booked." */
export const SOLO_LOAN = 410;
/** What Duke gets back selling the cars after the show. "He got nine hundred
 *  back", in `fr2_debt_self`. */
export const CAR_RESALE = 900;
/** The one extra show the self-funder does. "A small one, the kind he'd have
 *  passed on before — and made enough." */
export const SMALL_SHOW = 160;
/**
 * What self-funding the cars actually costs: the resale gap, less the show.
 *
 * Self-funding is the only one of the four answers that comes out of Duke's
 * own pocket. The other three source the twelve hundred somewhere else — an
 * advance, a note, a friend — and what they cost him is not money.
 */
export const SELF_FUND_NET = SMALL_SHOW - (CAR_MONEY - CAR_RESALE);

/**
 * A month on a note, the way this game has always done the arithmetic.
 *
 * `m2_solo_round2_collateral` has printed "The monthly number was thirty-seven
 * dollars" against "Four hundred and ten dollars, twelve months, eight
 * percent" since Phase 1, which is the whole principal plus the whole eight
 * percent, divided by twelve, rounded. This function reproduces that number
 * rather than a second one, so the twelve hundred for the cars is priced the
 * same way the four hundred and ten was.
 */
export const monthlyOn = principal => Math.round(principal * 1.08 / 12);

/**
 * What the school district wants before it hands over thirteen buses.
 *
 * `m4_stunt_select` has said "a school district that would rent him the buses
 * against a deposit he did not have yet" on the solo branch since Phase 1, and
 * nothing read it. On the backer branch Earl has the stadium booked and the
 * deposit is his problem, which is what the same paragraph says there.
 */
export const BUS_DEPOSIT = 900;

/** The backer-less branch. Same test as scenes.js's `solo()`, spelled out here
 *  rather than imported, because this file imports nothing. */
export const isSolo = GS => GS.rels.earl === 'absent';

/* ================================================================
   THE INTEGER
   ================================================================ */

/** Dollars on hand. Never negative, always whole. */
export function money(GS){
  const v = Number(GS.flags.money);
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

/** Add dollars. A negative amount floors at zero rather than going under. */
export function earn(GS, n){
  GS.flags.money = Math.max(0, money(GS) + Math.round(Number(n) || 0));
  return GS.flags.money;
}

/** Can the run put this many dollars on the table right now? */
export function canAfford(GS, n){ return money(GS) >= Math.max(0, Math.round(Number(n) || 0)); }

/**
 * Take dollars off. Returns false and spends nothing if they are not there, so
 * a caller that has not checked cannot drive the integer negative.
 */
export function spend(GS, n){
  const amt = Math.max(0, Math.round(Number(n) || 0));
  if(!canAfford(GS, amt)) return false;
  GS.flags.money = money(GS) - amt;
  return true;
}

/** Dollars a month that arrive whether Duke rides or not. Paper, not choice. */
export function owePerMonth(GS, n){
  const v = Math.max(0, Math.round(Number(GS.flags.monthlyOutgo) || 0));
  GS.flags.monthlyOutgo = v + Math.max(0, Math.round(Number(n) || 0));
  return GS.flags.monthlyOutgo;
}

/**
 * Credit a hub's take, once per hub per run. Returns what was credited.
 *
 * Once, because `showHubFRn()` runs again every time an evening or a day scene
 * returns to the hub — that is what the `||` seeding in those functions is for
 * — so a take credited there without a guard would be credited eight times.
 * `hubTakePaid` is a list flag, repaired like the other eight.
 */
export function payHubTake(GS, hub){
  const row = HUB_TAKE[hub];
  if(!row) return 0;
  if(!Array.isArray(GS.flags.hubTakePaid)) GS.flags.hubTakePaid = [];
  if(GS.flags.hubTakePaid.includes(hub)) return 0;
  GS.flags.hubTakePaid.push(hub);
  const gross = isSolo(GS) ? row.solo : row.backer;
  const paper = Math.max(0, Math.round(Number(GS.flags.monthlyOutgo) || 0)) * row.months;
  const net = gross - paper;
  earn(GS, net);
  return net;
}

/**
 * Spend an evening's declared cost.
 *
 * Condition is floored at 1 on purpose (decision #287): an evening out is not
 * what puts a man in the hospital, and a hub that could take the last point of
 * Condition would hand the next stunt a drift constant nothing can ride —
 * `createStuntRun`'s DRIFT_A is 52 + (1 - condition/5)*150, so zero Condition
 * is 202 against 112 at three. The stunts and the crashes still go all the way
 * to zero; the evenings stop one short.
 */
export function spendEveningCost(GS, id){
  const cost = EVENING_COST[id];
  if(!cost) return;
  if(cost.money) spend(GS, cost.money);
  if(cost.condition > 0) GS.stats.condition = Math.max(1, GS.stats.condition - cost.condition);
  else if(cost.condition < 0) GS.stats.condition = Math.min(5, GS.stats.condition - cost.condition);
}

/** Is this evening affordable? Condition is never a reason to refuse one. */
export function eveningAffordable(GS, id){
  const cost = EVENING_COST[id];
  return !cost || !cost.money || canAfford(GS, cost.money);
}

/**
 * What the card's tag slot says. The trade, not just that there is one.
 *
 * "1 Evening · $55 · Condition −1", or "1 Evening" for the ones that cost only
 * the evening. An evening the run cannot pay for names the shortfall, because
 * "unavailable" with no number is the thing this phase set out to fix.
 */
export function costTag(GS, id){
  const cost = EVENING_COST[id];
  if(!cost) return 'Costs 1 Evening';
  const bits = ['1 Evening'];
  if(cost.money) bits.push(`$${cost.money}`);
  if(cost.condition > 0) bits.push(`Condition −${cost.condition}`);
  if(cost.condition < 0) bits.push(`Condition +${-cost.condition}`);
  const tag = bits.join(' · ');
  return eveningAffordable(GS, id) ? tag : `${tag} — short $${cost.money - money(GS)}`;
}

/** Thirteen buses, on the branch where the deposit is Duke's to find. */
export function canAffordBuses(GS){ return !isSolo(GS) || canAfford(GS, BUS_DEPOSIT); }

export default {
  HUB_EVENINGS, EVENING_COST, HUB_TAKE, CAR_MONEY, BUS_DEPOSIT, isSolo,
  money, earn, spend, canAfford, owePerMonth, payHubTake, spendEveningCost,
  eveningAffordable, costTag, canAffordBuses,
};
