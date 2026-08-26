// collab.test.mjs — two people, one plan, end to end.
//
// Phase 12's retrospective is the reason this file exists: *"a refactor whose
// acceptance criterion is 'the tests still pass' is one that will ship a
// silent regression… what caught it was the one suite that simulates rather
// than calculates. Keep one of those per arc."*
//
// So this is that suite for arc three. It stands up two shells over the
// loopback hub — the same modules main.js drives, wired the same way — and
// puts them through the whole sequence: hello, snapshot, edits both ways, a
// conflict on one room, a resync, presence, and somebody leaving. What it is
// checking, at every step, is one thing: **both buildings are the same
// building.**
//
// Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, adoptIds, describeOps } from '../js/session.js';
import { createRoster, presenceOf, peerLabel } from '../js/presence.js';
import { makeHub } from '../js/wire.js';
import { serialize, deserialize } from '../js/save-load.js';
import { createState, addFloor } from '../js/grid.js';
import { addProp } from '../js/props.js';
import { clone } from '../js/history.js';
import { sheet } from './build.mjs';

// ---------- a shell, in forty lines ----------
//
// Everything main.js does about a session, minus the DOM: what to send, what
// to do with what arrives, and the mirror in between.

function shell(hub, room, site, design) {
  const me = {
    site,
    state: design,
    session: createSession({ site, room }),
    roster: createRoster(),
    mirror: null,
    said: [],
    waiting: false,
  };
  adoptIds(me.state, site);
  me.session.baseline(me.state);
  me.mirror = clone(me.state);

  const wire = hub.join(room, site);
  me.wire = wire;

  wire.onMessage((msg) => {
    if (msg.k === 'hello') {
      me.roster.see(msg.s, { name: msg.name }, 0);
      if (!msg.re) wire.send('hello', { name: site, re: 1 });
      if (msg.want) me.snapshot(msg.s);
      return;
    }
    if (msg.k === 'bye') { me.roster.drop(msg.s); return; }
    if (msg.k === 'pres') { me.roster.see(msg.s, { p: msg.p }, 0); return; }
    if (msg.k === 'snap') {
      if (msg.to && msg.to !== site) return;
      if (msg.to && !me.waiting) return;
      me.waiting = false;
      me.state = deserialize(msg.design);
      me.session.adoptMeta(msg.meta);
      adoptIds(me.state, site);
      me.mirror = clone(me.state);
      me.said.push('took a snapshot');
      return;
    }
    if (msg.k === 'ops') {
      me.flush();                                  // mine first, then theirs
      const res = me.session.receive(me.state, msg.ops);
      me.mirror = clone(me.state);
      me.said.push(`${msg.s} changed ${describeOps(msg.ops)}`);
      me.applied = res;
    }
  });

  me.flush = () => {
    const out = me.session.emit(me.mirror, me.state);
    if (out.resync) { me.snapshot(null); return out; }
    // The mirror moves before the send, because this hub delivers
    // synchronously: the other end's reply lands inside this call.
    me.mirror = clone(me.state);
    if (out.ops.length) wire.send('ops', { ops: out.ops });
    return out;
  };
  me.snapshot = (to) => {
    me.mirror = clone(me.state);
    wire.send('snap', { to, design: serialize(me.state), meta: me.session.snapshotMeta() });
  };
  me.join = () => { me.waiting = true; wire.start(); wire.send('hello', { name: site, want: 1 }); };
  me.open = () => { wire.start(); wire.send('hello', { name: site }); };
  me.leave = () => { wire.send('bye', {}); wire.close(); };
  return me;
}

// The building both of them start from.
function school() {
  const s = createState(20, 16);
  sheet(s, 0)
    .box(1, 1, 5, 5, { name: 'Art' })
    .box(7, 1, 11, 5, { name: 'Music' })
    .bake();
  addProp(s, 'desk', { x: 8, z: 20 });
  return s;
}

// The two designs, compared the way a person would: as save files — minus the
// two fields session.js keeps out of the log on purpose, because they are
// about the person rather than the building. `nextId` differing is not a
// disagreement, it is the id blocks working.
function building(s) {
  const d = JSON.parse(serialize(s.state));
  delete d.nextId;
  delete d.currentFloor;
  return JSON.stringify(d);
}
const agree = (a, b, msg) => assert.equal(building(a), building(b), msg);
const roomNamed = (s, name) => {
  for (const f of s.floors) for (const sh of f.shapes) if (sh.name === name) return sh;
  return null;
};

// ---------- the whole sequence ----------

test('two people open one plan, edit it, and end up with the same building', () => {
  const hub = makeHub();
  const a = shell(hub, 'roomone1', 'aaaaaaaaaaaa', school());
  a.open();

  // B arrives with a different design of its own and asks for the building.
  const b = shell(hub, 'roomone1', 'bbbbbbbbbbbb', createState(8, 8));
  b.join();

  assert.equal(a.roster.size, 1, 'A can see B');
  assert.equal(b.roster.size, 1, 'B can see A');
  assert.deepEqual(b.said, ['took a snapshot']);
  agree(a, b, 'the joiner is looking at the host building');
  assert.notEqual(a.state.nextId, b.state.nextId, 'and counting ids from its own block');

  // A renames a room.
  roomNamed(a.state, 'Art').name = 'Ceramics';
  a.flush();
  assert.equal(roomNamed(b.state, 'Ceramics') !== null, true);
  agree(a, b);

  // B puts a chair in it, out of its own block of ids.
  const chair = addProp(b.state, 'chair', { x: 6, z: 6 });
  assert.ok(chair.id > 1000000, 'a joiner mints ids in its own block');
  b.flush();
  assert.equal(a.state.props.some((p) => p.id === chair.id), true);
  agree(a, b);

  // Both of them recolour the same room in the same second. One of the two
  // edits is lost — deliberately — and both screens agree about which.
  roomNamed(a.state, 'Music').color = '#111111';
  roomNamed(b.state, 'Music').color = '#222222';
  a.flush();
  b.flush();
  agree(a, b, 'a conflict leaves one building, not two');
  assert.equal(roomNamed(a.state, 'Music').color, '#222222', 'the higher site id wins the tie');

  // A adds a storey, which no record-addressed log can say, so the whole
  // building goes across instead.
  addFloor(a.state);
  const out = a.flush();
  assert.equal(out.resync, true);
  assert.equal(b.state.floors.length, a.state.floors.length);
  agree(a, b, 'after a resync');

  // ...and editing still works afterwards, on both sides of it.
  roomNamed(b.state, 'Ceramics').name = 'Kiln Room';
  b.flush();
  assert.equal(roomNamed(a.state, 'Kiln Room') !== null, true);
  agree(a, b);

  // Presence is out of band: it moves nobody's building.
  const before = building(a);
  b.wire.send('pres', { p: presenceOf({ x: 30, z: 12, yaw: 1, floor: 1, mode: 'walk' }) });
  assert.equal(building(a), before, 'a camera is not an edit');
  const peer = a.roster.get(b.site);
  assert.equal(peer.m, 'walk');
  assert.equal(peer.f, 1);
  assert.equal(peerLabel(peer), b.site, 'named by the name in their hello');

  // B leaves. A keeps the building and forgets the person.
  b.leave();
  assert.equal(a.roster.size, 0);
  const kept = building(a);
  roomNamed(a.state, 'Kiln Room').name = 'Alone';
  a.flush();
  assert.notEqual(building(a), kept, 'and can still edit it');
});

test('an edit made while somebody else edit arrives is not swallowed', () => {
  const hub = makeHub();
  const a = shell(hub, 'roomtwo2', 'aaaaaaaaaaaa', school());
  a.open();
  const b = shell(hub, 'roomtwo2', 'bbbbbbbbbbbb', createState(8, 8));
  b.join();

  // A draws something and has not sent it yet...
  roomNamed(a.state, 'Art').name = 'Mine';
  // ...when B's edit to a different room arrives.
  roomNamed(b.state, 'Music').name = 'Theirs';
  b.flush();

  assert.equal(roomNamed(a.state, 'Mine') !== null, true, 'the local edit survived');
  assert.equal(roomNamed(a.state, 'Theirs') !== null, true, 'and so did theirs');
  a.flush();
  agree(a, b);
});

test('a third person joins a conversation already in progress', () => {
  const hub = makeHub();
  const a = shell(hub, 'roomthree', 'aaaaaaaaaaaa', school());
  a.open();
  const b = shell(hub, 'roomthree', 'bbbbbbbbbbbb', createState(8, 8));
  b.join();
  roomNamed(a.state, 'Art').name = 'Ceramics';
  a.flush();

  const c = shell(hub, 'roomthree', 'cccccccccccc', createState(8, 8));
  c.join();
  // Two people answered; the first snapshot is the one taken.
  assert.deepEqual(c.said, ['took a snapshot']);
  agree(a, c);
  assert.equal(a.roster.size, 2);
  assert.equal(c.roster.size, 2);

  // ...and an edit from the newcomer reaches both of the others.
  roomNamed(c.state, 'Music').fin = 'carpet';
  c.flush();
  agree(a, c);
  agree(b, c);
});

test('a session with nobody in it is a session that changes nothing', () => {
  const hub = makeHub();
  const a = shell(hub, 'roomfour4', 'aaaaaaaaaaaa', school());
  a.open();
  const before = building(a);
  roomNamed(a.state, 'Art').name = 'Still Mine';
  const out = a.flush();
  assert.equal(out.ops.length, 1, 'it still says what changed');
  assert.notEqual(building(a), before);
  assert.equal(a.roster.size, 0, 'to nobody at all');
});
