// The doorway's admission rate: flow off the clear width, credit capped low,
// and nobody held forever — lift.js's bounded-holding lesson applied to a
// threshold, which is Phase 39's front door at ten to eight.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeThresholds, thresholdFor, stepThresholds, admit, thresholdReport,
  FLOW_PER_FT, CREDIT_MAX, HOLD_MAX, MIN_FLOW_W,
} from '../js/threshold.js';
import { CLEAR_LOSS } from '../js/navgraph.js';

const portal = (id, w) => ({ id, w });

test('a threshold is made once per portal and rated off the clear width', () => {
  const map = makeThresholds();
  const th = thresholdFor(map, portal('p1', 3));
  assert.equal(th, thresholdFor(map, portal('p1', 3)), 'one record per door');
  assert.ok(Math.abs(th.rate - FLOW_PER_FT * (3 - CLEAR_LOSS)) < 1e-9,
    'the leaf and its stop come off the width here as everywhere');
  // A wider door flows more; an absurd one never divides by nothing.
  const wide = thresholdFor(map, portal('p2', 6));
  assert.ok(wide.rate > th.rate);
  const sliver = thresholdFor(map, portal('p3', 0.2));
  assert.ok(Math.abs(sliver.rate - FLOW_PER_FT * MIN_FLOW_W) < 1e-9);
});

test('credit accrues at the rate, and is capped low', () => {
  const map = makeThresholds();
  const th = thresholdFor(map, portal('p1', 3));
  th.credit = 0;
  stepThresholds(map, 1);
  assert.ok(Math.abs(th.credit - th.rate) < 1e-9);
  // A door that stood open all night has not banked four hundred admissions.
  stepThresholds(map, 3600);
  assert.equal(th.credit, CREDIT_MAX);
});

test('crossing spends one admission; an empty account is a refusal', () => {
  const map = makeThresholds();
  const th = thresholdFor(map, portal('p1', 3));
  th.credit = 1.2;
  assert.ok(admit(th));
  assert.equal(th.admitted, 1);
  assert.ok(!admit(th), 'the second person waits for the rate');
  assert.equal(th.admitted, 1);
});

test('the door averages its rate through a crush', () => {
  const map = makeThresholds();
  const th = thresholdFor(map, portal('p1', 3));
  th.credit = 0;
  let through = 0;
  const seconds = 60;
  const dt = 1 / 30;
  for (let i = 0; i < seconds / dt; i++) {
    stepThresholds(map, dt);
    if (admit(th)) through++;   // somebody is always waiting
  }
  const expected = th.rate * seconds;
  assert.ok(Math.abs(through - expected) <= 2,
    `${through} through a door rated for ${expected.toFixed(0)}`);
});

test('nobody is held past the bound — the credit goes negative instead', () => {
  const map = makeThresholds();
  const th = thresholdFor(map, portal('p1', 3));
  th.credit = 0;
  assert.ok(!admit(th, HOLD_MAX - 1), 'the rate holds within the bound');
  assert.ok(admit(th, HOLD_MAX + 1), 'and never past it');
  assert.ok(th.credit < 0, 'the borrowed admission is paid back by the queue behind');
});

test('the report counts the morning', () => {
  const map = makeThresholds();
  const a = thresholdFor(map, portal('p1', 3));
  const b = thresholdFor(map, portal('p2', 6));
  a.credit = 5; b.credit = 5;
  admit(a);
  admit(b);
  admit(b);
  const r = thresholdReport(map);
  assert.equal(r.doors, 2);
  assert.equal(r.admitted, 3);
  assert.equal(r.busiest, b);
  assert.deepEqual(thresholdReport(null), { doors: 0, admitted: 0, busiest: null });
});

test('a missing threshold admits — off is the instantaneous door, verbatim', () => {
  assert.ok(admit(null));
  assert.equal(thresholdFor(null, portal('p1', 3)), null);
});
