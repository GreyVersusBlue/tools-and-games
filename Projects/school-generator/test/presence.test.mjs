// presence.test.mjs — who else is here, and how often to say so.
//
// Two things decide whether presence is pleasant or a nuisance: how quickly
// somebody who has gone actually disappears, and how many packets a walking
// camera costs. Both are policies rather than arithmetic, so the suite pins
// them from both sides the way Phase 13 pinned the parallel tolerance.
//
// Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TTL, HEARTBEAT, MOVE_FT, TURN_RAD, PEER_COLORS,
  peerColor, peerLabel, presenceOf, worthSending,
  createRoster, describeRoster, describePeer,
} from '../js/presence.js';

const view = (over = {}) => ({ x: 0, z: 0, yaw: 0, floor: 0, mode: 'plan', ...over });

// ---------- identity ----------

test('a colour belongs to a site, not to a join order', () => {
  const a = peerColor('aaaa'), b = peerColor('aaaa');
  assert.equal(a, b, 'the same site is the same colour every time');
  assert.ok(PEER_COLORS.includes(a));
  // ...and enough of them differ that two people are rarely the same.
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(peerColor(`site-${i}`));
  assert.ok(seen.size >= 5, `${seen.size} distinct colours out of 40 sites`);
});

test('somebody who has not typed a name is still tellable apart', () => {
  assert.equal(peerLabel({ site: 'abcdef123456' }), 'Guest 3456');
  assert.equal(peerLabel({ site: 'abcdef123456', name: '  Sam ' }), 'Sam');
  assert.equal(peerLabel(null), 'Someone');
});

// ---------- what goes on the wire ----------

test('a presence packet is rounded, because a dot does not need seventeen decimals', () => {
  const p = presenceOf(view({ x: 12.34567, z: -3.14159, yaw: 1.2345678, floor: 2, mode: 'walk' }));
  assert.equal(p.x, 12.3);
  assert.equal(p.z, -3.1);
  assert.equal(p.yaw, 1.235);
  assert.equal(p.f, 2);
  assert.equal(p.m, 'walk');
});

test('a mode this build does not know reads as the plan', () => {
  assert.equal(presenceOf(view({ mode: 'xr' })).m, 'plan');
  assert.equal(presenceOf({}).f, 0);
});

// ---------- the sending policy ----------

test('the first packet always goes', () => {
  assert.equal(worthSending(null, presenceOf(view()), 0, 0), true);
});

test('standing still costs one packet a heartbeat and no more', () => {
  const last = presenceOf(view());
  const same = presenceOf(view());
  assert.equal(worthSending(last, same, HEARTBEAT - 1, 0), false);
  assert.equal(worthSending(last, same, HEARTBEAT, 0), true);
});

test('a step, a turn, a storey or a change of mode is worth saying', () => {
  const last = presenceOf(view());
  assert.equal(worthSending(last, presenceOf(view({ x: MOVE_FT })), 0, 0), true);
  assert.equal(worthSending(last, presenceOf(view({ x: MOVE_FT / 4 })), 0, 0), false);
  assert.equal(worthSending(last, presenceOf(view({ yaw: TURN_RAD * 2 })), 0, 0), true);
  assert.equal(worthSending(last, presenceOf(view({ floor: 1 })), 0, 0), true);
  assert.equal(worthSending(last, presenceOf(view({ mode: 'walk' })), 0, 0), true);
});

test('a turn the short way round the circle is still a small turn', () => {
  const last = presenceOf(view({ yaw: 0.001 }));
  const next = presenceOf(view({ yaw: -0.001 }));
  assert.equal(worthSending(last, next, 0, 0), false, 'two thousandths, not two pi');
});

test('the heartbeat is well inside the timeout, so standing still is not leaving', () => {
  assert.ok(HEARTBEAT * 2 < TTL, 'two dropped packets in a row must not evict anybody');
  assert.ok(HEARTBEAT >= 1000, 'and it must not be a packet a second');
});

// ---------- the roster ----------

test('a hello puts somebody on the list, and a name follows later', () => {
  const r = createRoster();
  r.see('aaa', {}, 100);
  assert.equal(r.size, 1);
  assert.equal(peerLabel(r.get('aaa')), 'Guest aaa');
  r.see('aaa', { name: 'Priya' }, 200);
  assert.equal(r.size, 1, 'the same site is one peer');
  assert.equal(r.get('aaa').name, 'Priya');
});

test('a presence packet moves a peer without adding one', () => {
  const r = createRoster();
  r.see('aaa', { p: presenceOf(view({ x: 4, floor: 1, mode: 'walk' })) }, 100);
  const p = r.get('aaa');
  assert.equal(p.x, 4);
  assert.equal(p.f, 1);
  assert.equal(p.m, 'walk');
  assert.equal(r.size, 1);
});

test('somebody who stops talking drops off, and the roster says who', () => {
  const r = createRoster();
  r.see('aaa', {}, 0);
  r.see('bbb', {}, 0);
  r.see('bbb', {}, TTL);
  const gone = r.prune(TTL + 1);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].site, 'aaa');
  assert.equal(r.size, 1);
});

test('a goodbye is immediate, and a goodbye from a stranger is not an error', () => {
  const r = createRoster();
  r.see('aaa', {}, 0);
  assert.equal(r.drop('aaa'), true);
  assert.equal(r.drop('aaa'), false);
  assert.equal(r.size, 0);
});

test('the list is in arrival order, so it does not reshuffle while it is read', () => {
  const r = createRoster();
  r.see('ccc', {}, 1);
  r.see('aaa', {}, 2);
  r.see('bbb', {}, 3);
  r.see('ccc', {}, 9);
  assert.deepEqual(r.list().map((p) => p.site), ['ccc', 'aaa', 'bbb']);
});

test('only the people on this storey are on this storey', () => {
  const r = createRoster();
  r.see('aaa', { p: presenceOf(view({ floor: 0 })) }, 0);
  r.see('bbb', { p: presenceOf(view({ floor: 1 })) }, 0);
  assert.deepEqual(r.onFloor(0).map((p) => p.site), ['aaa']);
  assert.deepEqual(r.onFloor(1).map((p) => p.site), ['bbb']);
  assert.deepEqual(r.onFloor(2), []);
});

test('an empty site id is not a peer', () => {
  const r = createRoster();
  assert.equal(r.see('', {}, 0), null);
  assert.equal(r.see(null, {}, 0), null);
  assert.equal(r.size, 0);
});

// ---------- the sentences ----------

test('the roster counts other people, not everybody', () => {
  assert.equal(describeRoster([]), 'Nobody else is here yet.');
  assert.match(describeRoster([{ site: 'aaa', name: 'Sam' }]), /^Sam is here/);
  assert.match(describeRoster([{ name: 'Sam' }, { name: 'Lee' }]), /Sam and Lee are here/);
  assert.match(describeRoster([{ name: 'Sam' }, { name: 'Lee' }, { name: 'Jo' }]), /Sam and 2 others/);
});

test('a peer is described by what they are doing and where', () => {
  assert.equal(describePeer({ m: 'walk', f: 0 }, 'Level 1'), 'walking Level 1');
  assert.equal(describePeer({ m: 'plan', f: 1 }), 'drawing Level 2');
  assert.equal(describePeer(null), '');
});
