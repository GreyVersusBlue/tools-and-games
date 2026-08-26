// wire.test.mjs — the pipe, and what it refuses to carry.
//
// Everything that arrives on a wire came out of somebody else's memory, so
// most of this suite is about what `decode` throws away: the wrong version,
// the wrong room, a kind this build has never heard of, an "ops" message with
// no ops in it, a snapshot the size of a film. The rest is the three
// transports behaving the same way as each other, which is the property that
// lets main.js not care which one it has.
//
// Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WIRE_V, KINDS, MAX_SNAP, RETRY_MS, RELAY_CONTRACT,
  makeRoom, validRoom, sessionFragment, readSessionFragment, sessionURL,
  encode, decode, frame, makeHub, channelWire, socketWire, relayURL,
} from '../js/wire.js';

// ---------- session ids ----------

test('a session id can be read down a phone line', () => {
  const room = makeRoom(() => 0.5);
  assert.equal(room.length, 8);
  assert.equal(validRoom(room), true);
  assert.ok(!/[01lo]/.test(room), 'no confusable characters');
});

test('a session id from somewhere else is checked before it is used', () => {
  assert.equal(validRoom('abc'), false, 'too short');
  assert.equal(validRoom('ABCDEFGH'), false, 'not lower case');
  assert.equal(validRoom('abc def!'), false);
  assert.equal(validRoom('a'.repeat(40)), false);
  assert.equal(validRoom(null), false);
});

// ---------- links ----------

test('a session link is a fragment, and it comes back the way it went in', () => {
  const f = sessionFragment('abcdefgh');
  assert.equal(f, '#c=abcdefgh');
  assert.deepEqual(readSessionFragment(f), { room: 'abcdefgh', relay: '' });
});

test('a link can carry the relay it was made at', () => {
  const f = sessionFragment('abcdefgh', 'wss://relay.example/ws');
  const back = readSessionFragment(f);
  assert.equal(back.room, 'abcdefgh');
  assert.equal(back.relay, 'wss://relay.example/ws');
});

test('an ordinary hash, a share link, or a damaged one is not a session', () => {
  assert.equal(readSessionFragment(''), null);
  assert.equal(readSessionFragment('#s=z1.abcd'), null);
  assert.equal(readSessionFragment('#c='), null);
  assert.equal(readSessionFragment('#c=NOPE'), null);
});

test('a session link replaces a fragment rather than stacking on one', () => {
  const url = sessionURL('https://example.test/app/#s=z1.abc', 'abcdefgh');
  assert.equal(url, 'https://example.test/app/#c=abcdefgh');
});

// ---------- framing ----------

test('a framed message round-trips', () => {
  const msg = frame('abcdefgh', 'site1', 'ops', { ops: [{ k: 'room', id: 3, t: 1, site: 'site1', v: null }] });
  const back = decode(encode(msg));
  assert.deepEqual(back, msg);
  assert.equal(back.v, WIRE_V);
});

test('every kind this build sends is a kind it accepts', () => {
  for (const k of KINDS) {
    const body = k === 'ops' ? { ops: [] } : k === 'snap' ? { design: '{}' } : {};
    assert.ok(decode(encode(frame('abcdefgh', 'site1', k, body))), k);
  }
});

test('a message from another version, another kind or nobody is dropped', () => {
  const good = frame('abcdefgh', 'site1', 'hello');
  assert.equal(decode(encode({ ...good, v: 99 })), null, 'wrong version');
  assert.equal(decode(encode({ ...good, k: 'destroy' })), null, 'unknown kind');
  assert.equal(decode(encode({ ...good, s: '' })), null, 'no sender');
  assert.equal(decode(encode({ ...good, r: '' })), null, 'no room');
  assert.equal(decode('not json at all'), null);
  assert.equal(decode(null), null);
  assert.equal(decode(42), null);
});

test('an ops message with something other than ops in it is dropped', () => {
  const bad = (ops) => decode(encode(frame('abcdefgh', 'site1', 'ops', { ops })));
  assert.equal(bad('room'), null);
  assert.equal(bad([{ k: 'room' }]), null, 'no stamp');
  assert.equal(bad([{ t: 1 }]), null, 'no kind');
  assert.equal(bad([{ k: 'room', t: Infinity }]), null);
  assert.ok(bad([{ k: 'room', id: 1, t: 1, v: null }]));
});

test('a snapshot bigger than a school is dropped rather than parsed', () => {
  const huge = frame('abcdefgh', 'site1', 'snap', { design: 'x'.repeat(MAX_SNAP + 1) });
  assert.equal(decode(encode(huge)), null);
});

// ---------- loopback ----------

test('two ends of a hub hear each other and not themselves', () => {
  const hub = makeHub();
  const a = hub.join('abcdefgh', 'aaa');
  const b = hub.join('abcdefgh', 'bbb');
  const heardA = [], heardB = [];
  a.onMessage((m) => heardA.push(m));
  b.onMessage((m) => heardB.push(m));
  a.start(); b.start();

  a.send('ops', { ops: [{ k: 'room', id: 1, t: 1, site: 'aaa', v: null }] });
  assert.equal(heardB.length, 1);
  assert.equal(heardA.length, 0, 'a wire never hears itself');
  assert.equal(heardB[0].s, 'aaa');
});

test('a wire in another room hears nothing', () => {
  const hub = makeHub();
  const a = hub.join('abcdefgh', 'aaa');
  const other = hub.join('zzzzzzzz', 'bbb');
  const heard = [];
  other.onMessage((m) => heard.push(m));
  a.start(); other.start();
  a.send('hello', {});
  assert.equal(heard.length, 0);
});

test('a closed wire sends nothing and receives nothing', () => {
  const hub = makeHub();
  const a = hub.join('abcdefgh', 'aaa');
  const b = hub.join('abcdefgh', 'bbb');
  const heard = [];
  b.onMessage((m) => heard.push(m));
  b.close();
  assert.equal(a.send('hello', {}), true, 'the sender is still open');
  assert.equal(heard.length, 0);
  a.close();
  assert.equal(a.send('hello', {}), false);
});

test('the wire reports its state to whoever is watching', () => {
  const hub = makeHub();
  const a = hub.join('abcdefgh', 'aaa');
  const states = [];
  a.onStatus((s) => states.push(s));
  a.start();
  a.close();
  assert.deepEqual(states, ['open', 'closed']);
});

// ---------- BroadcastChannel ----------

// The smallest thing that behaves like one: every channel of a name shares a
// list, and a post goes to the others.
function FakeChannel(name) {
  const all = FakeChannel.named.get(name) || [];
  all.push(this);
  FakeChannel.named.set(name, all);
  this.name = name;
  this.onmessage = null;
  this.closed = false;
  this.postMessage = (data) => {
    for (const other of all) {
      if (other === this || other.closed) continue;
      if (other.onmessage) other.onmessage({ data });
    }
  };
  this.close = () => { this.closed = true; };
}
FakeChannel.named = new Map();

test('two windows of one browser are a session, with no server at all', () => {
  FakeChannel.named.clear();
  const a = channelWire('abcdefgh', 'aaa', { Channel: FakeChannel });
  const b = channelWire('abcdefgh', 'bbb', { Channel: FakeChannel });
  const heard = [];
  b.onMessage((m) => heard.push(m));
  a.start(); b.start();
  a.send('pres', { p: { x: 1, z: 2, yaw: 0, f: 0, m: 'plan' } });
  assert.equal(heard.length, 1);
  assert.equal(heard[0].p.x, 1);
  a.close(); b.close();
});

test('a channel session is scoped to its session id', () => {
  FakeChannel.named.clear();
  const a = channelWire('abcdefgh', 'aaa', { Channel: FakeChannel });
  const b = channelWire('zzzzzzzz', 'bbb', { Channel: FakeChannel });
  const heard = [];
  b.onMessage((m) => heard.push(m));
  a.start(); b.start();
  a.send('hello', {});
  assert.equal(heard.length, 0);
  a.close(); b.close();
});

// ---------- the relay ----------

function FakeSocket(url) {
  FakeSocket.made.push(this);
  this.url = url;
  this.readyState = 0;
  this.sent = [];
  this.send = (raw) => { this.sent.push(raw); };
  this.close = () => { this.readyState = 3; };
  this.open = () => { this.readyState = 1; if (this.onopen) this.onopen(); };
  this.die = () => { this.readyState = 3; if (this.onclose) this.onclose(); };
  this.deliver = (raw) => { if (this.onmessage) this.onmessage({ data: raw }); };
}
FakeSocket.made = [];

function fakeTimers() {
  const queued = [];
  return {
    setTimeout: (fn, ms) => { queued.push({ fn, ms }); return queued.length; },
    clearTimeout: () => {},
    run: () => { const list = queued.splice(0); for (const q of list) q.fn(); return list; },
    get pending() { return queued.length; },
  };
}

test('a relay address carries the room in the query string', () => {
  assert.equal(relayURL('wss://relay.example/ws/', 'abcdefgh'), 'wss://relay.example/ws?room=abcdefgh');
  assert.equal(relayURL('', 'abcdefgh'), '');
});

test('a socket wire connects, sends and receives', () => {
  FakeSocket.made.length = 0;
  const timers = fakeTimers();
  const w = socketWire('wss://relay.example/ws', 'abcdefgh', 'aaa',
    { Socket: FakeSocket, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const heard = [], states = [];
  w.onMessage((m) => heard.push(m));
  w.onStatus((s) => states.push(s));
  w.start();
  const sock = FakeSocket.made[0];
  assert.match(sock.url, /room=abcdefgh/);
  sock.open();
  w.send('hello', {});
  assert.equal(sock.sent.length, 1);
  sock.deliver(encode(frame('abcdefgh', 'bbb', 'hello', {})));
  assert.equal(heard.length, 1);
  assert.deepEqual(states.slice(0, 2), ['connecting', 'open']);
  w.close();
});

test('what was said while the relay was down goes when it comes back', () => {
  FakeSocket.made.length = 0;
  const timers = fakeTimers();
  const w = socketWire('wss://relay.example/ws', 'abcdefgh', 'aaa',
    { Socket: FakeSocket, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  w.start();
  w.send('ops', { ops: [] });          // before the socket opened
  assert.equal(w.queued(), 1);
  FakeSocket.made[0].open();
  assert.equal(w.queued(), 0);
  assert.equal(FakeSocket.made[0].sent.length, 1);
  w.close();
});

test('a dropped relay retries, backing off, and stops when the wire closes', () => {
  FakeSocket.made.length = 0;
  const timers = fakeTimers();
  const w = socketWire('wss://relay.example/ws', 'abcdefgh', 'aaa',
    { Socket: FakeSocket, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  w.start();
  FakeSocket.made[0].open();
  FakeSocket.made[0].die();
  assert.equal(timers.pending, 1);
  const first = timers.run()[0];
  assert.equal(first.ms, RETRY_MS[0]);
  assert.equal(FakeSocket.made.length, 2, 'it tried again');
  FakeSocket.made[1].die();
  assert.equal(timers.run()[0].ms, RETRY_MS[1], 'and waited longer the second time');
  w.close();
  assert.equal(w.open, false);
});

test('the relay contract is four sentences, and none of them is "store it"', () => {
  assert.equal(RELAY_CONTRACT.length, 4);
  assert.ok(!RELAY_CONTRACT.join(' ').toLowerCase().includes('store'));
});
