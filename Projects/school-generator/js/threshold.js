// threshold.js — a doorway admits people at a rate.
//
// Bodies queue at doors already: they follow, they yield, they take turns.
// What they never did was pay for the door itself. A three-foot single leaf
// passes about one person a second however politely the crowd behind it
// behaves, and the morning crush at a school's front door is that number
// made visible — four hundred people through six doors in fifteen minutes
// works on paper and stacks up on the steps in practice. This module is the
// number: a doorway has a flow, the flow accrues as credit, and crossing the
// threshold spends one.
//
// Two bounds carry the honesty, and both are lift.js's lesson — *a queue
// that can hold a door open needs a bound on the holding* — applied to a
// threshold, once in each direction:
//
//   * **Credit is capped low.** A door that stood open all night has not
//     banked four hundred admissions; when the first bus arrives the first
//     person or two walk straight in and everybody after them waits for the
//     door's own rate, which is what a crush stacking honestly means.
//   * **Nobody is held forever.** A person the rate has held past `HOLD_MAX`
//     is admitted anyway and the credit goes negative — the door's *average*
//     rate still holds, spread over the people behind them, but no rule in
//     this codebase is allowed to bring a body to a permanent halt, and this
//     one isn't either.
//
// Pure module: plain records in a Map, no three.js, no DOM, no clock of its
// own. agents.js spends the credit; nothing else needs to know it exists.
// Exercised by test/threshold.test.mjs.

import { clearWidth } from './navgraph.js';

// About one person a second through a 3ft leaf — the low end of the measured
// door-flow range (roughly 1 to 1.3 persons per metre per second), because a
// school morning is bags and held doors rather than a laboratory file.
export const FLOW_PER_FT = 0.35;     // persons per second per clear foot
// The narrowest flow any admitting doorway offers, so a hostile or absurd
// opening width never divides by nothing.
export const MIN_FLOW_W = 1.5;       // ft
// How many admissions a quiet door may bank. One and a half: the first
// arrival walks in, the second mostly does, the third waits.
export const CREDIT_MAX = 1.5;
// The longest the rate may hold any one person out, in seconds. Past this
// they are admitted on borrowed credit — see `admit`.
export const HOLD_MAX = 15;

export const makeThresholds = () => new Map();

// The threshold for one portal, made the first time somebody reaches it. The
// rate comes off the *clear* width — the leaf and its stop eat into the
// opening here exactly as they do in the accessible-route check, and for the
// same reason: the hole in the wall is not the width a body gets.
export function thresholdFor(map, portal, opts = {}) {
  if (!map || !portal) return null;
  let th = map.get(portal.id);
  if (!th) {
    const clear = Math.max(MIN_FLOW_W, clearWidth(portal.w || 0));
    th = {
      id: portal.id,
      rate: (opts.flow ?? FLOW_PER_FT) * clear,
      credit: CREDIT_MAX,
      // Counted rather than derived, the way a lift counts its trips: "the
      // front door admitted two hundred and forty people this morning" is a
      // sentence somebody watching the crush wants a panel to be able to say.
      admitted: 0,
    };
    map.set(th.id, th);
  }
  return th;
}

// The flow, accrued. Called once per frame with everybody's dt, never once
// per person — a door's rate is the door's, and forty people at it do not
// make it forty times faster.
export function stepThresholds(map, dt) {
  if (!map || !(dt > 0)) return;
  for (const th of map.values()) {
    th.credit = Math.min(CREDIT_MAX, th.credit + th.rate * dt);
  }
}

// One person at the threshold: through, or not yet. `waited` is how long the
// rate has held *this* person; past `HOLD_MAX` they go through regardless and
// the credit goes negative, so the door still averages its rate while nobody
// is ever parked at it for good.
export function admit(th, waited = 0) {
  if (!th) return true;
  if (th.credit < 1 && waited <= HOLD_MAX) return false;
  th.credit -= 1;
  th.admitted++;
  return true;
}

// What the morning looked like from the doors, for a panel.
export function thresholdReport(map) {
  const out = { doors: 0, admitted: 0, busiest: null };
  if (!map) return out;
  for (const th of map.values()) {
    out.doors++;
    out.admitted += th.admitted;
    if (!out.busiest || th.admitted > out.busiest.admitted) out.busiest = th;
  }
  return out;
}
