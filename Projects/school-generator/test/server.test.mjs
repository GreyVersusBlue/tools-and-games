// The server, running, driven by the tool's own clients.
//
// This is the suite that matters. `store.js`, `relay.js` and `ws.js` are all
// pure and all tested, and three green suites of arithmetic about a protocol
// is exactly the state Phase 12's retrospective warned about — *"a phase whose
// deliverable is subtraction needs a test that would fail if the subtraction
// were wrong, and 'every existing test still passes' is not that test... find
// the suite that runs the thing rather than calculating about it"*.
//
// So this one runs it. A real server on a real port; `cloud.js`'s own four
// functions against it over `fetch`; `wire.js`'s own `socketWire` against it
// over a real WebSocket. Nothing here re-implements a client, which is the
// point: if the contract in either file and the server drift apart, this goes
// red and the unit suites stay green.
//
// It found one bug the moment it was first run, and it was in the half that
// had the most arithmetic asserted about it: the handshake GUID had a typo,
// every unit test agreed with it, and no client would connect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../server/index.mjs';
import {
  checkStore, getDesign, putDesign, deleteDesign,
  newDesignId, newWriteKey, normalizeBase, impliedRelay, MAX_BYTES,
} from '../js/cloud.js';
import { socketWire, makeRoom, frame, encode, WIRE_V } from '../js/wire.js';
import { buildSampleSchool } from '../js/sample.js';
import { serialize } from '../js/save-load.js';

// One server per test, on a port the OS picks, with its own directory.
async function boot(opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sg-store-'));
  const server = createServer({ dir, log: false, ...opts });
  const port = await server.listen(0, '127.0.0.1');
  return {
    dir,
    port,
    base: `http://127.0.0.1:${port}`,
    relay: `ws://127.0.0.1:${port}/relay`,
    async stop() {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
    rooms: server.rooms,
  };
}

// A wire, opened and waited for. `socketWire` retries on its own, so a wire
// that never opens is a test that times out rather than one that hangs about.
function opened(base, room, site) {
  const wire = socketWire(base, room, site);
  const ready = new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error(`${site} never connected`)), 5000);
    wire.onStatus((state) => {
      if (state === 'open') { clearTimeout(timer); ok(wire); }
    });
  });
  wire.start();
  return ready;
}

// Wait for a wire to receive `n` messages, or give up.
function received(wire, n = 1, ms = 5000) {
  const got = [];
  return new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error(`only ${got.length} of ${n} arrived`)), ms);
    wire.onMessage((msg) => {
      got.push(msg);
      if (got.length >= n) { clearTimeout(timer); ok(got); }
    });
  });
}

const settle = (ms = 120) => new Promise((ok) => { setTimeout(ok, ms); });

// ---------- the store ----------

test('a store answers the health check cloud.js actually sends', async () => {
  const s = await boot({ note: 'the staff room laptop' });
  try {
    const info = await checkStore(s.base, {});
    assert.equal(info.ok, true);
    assert.equal(info.maxBytes, MAX_BYTES);
    assert.equal(info.note, 'the staff room laptop');
    // ...and the relay cloud.js would guess from that address is the one this
    // server is actually serving, which is the whole reason nobody has to
    // type a second address.
    assert.equal(impliedRelay(normalizeBase(s.base)), s.relay);
  } finally { await s.stop(); }
});

test('a real design goes up, comes back byte for byte, and can be deleted', async () => {
  const s = await boot();
  try {
    const design = serialize(buildSampleSchool());
    const id = newDesignId();
    const key = newWriteKey();

    const put = await putDesign(s.base, id, key, design, {});
    assert.equal(put.id, id);
    assert.equal(put.bytes, design.length);

    const back = await getDesign(s.base, id, {});
    assert.equal(back, design, 'the save file is not touched on the way through');
    // And it really is on the disk, under its own id, rather than in a
    // process that will forget it.
    assert.equal(await readFile(join(s.dir, `${id}.json`), 'utf8'), design);

    // Editing it is the same call again with the same key.
    const edited = serialize({ ...buildSampleSchool(), name: 'edited' });
    await putDesign(s.base, id, key, edited, {});
    assert.equal(await getDesign(s.base, id, {}), edited);

    assert.equal(await deleteDesign(s.base, id, key, {}), true);
    await assert.rejects(() => getDesign(s.base, id, {}), /no design at that address/);
  } finally { await s.stop(); }
});

test('somebody else with the link can read it and cannot change it', async () => {
  const s = await boot();
  try {
    const design = serialize(buildSampleSchool());
    const id = newDesignId();
    await putDesign(s.base, id, newWriteKey(), design, {});

    // A second browser: it has the link, so it has the id, and it has no key.
    assert.equal(await getDesign(s.base, id, {}), design);
    await assert.rejects(
      () => putDesign(s.base, id, newWriteKey(), serialize(buildSampleSchool()), {}),
      /belongs to another browser/);
    await assert.rejects(() => deleteDesign(s.base, id, newWriteKey(), {}),
      /belongs to another browser/);
    // ...and the design it could not overwrite is untouched.
    assert.equal(await getDesign(s.base, id, {}), design);
  } finally { await s.stop(); }
});

test('the store refuses a design past its cap, with the error cloud.js prints', async () => {
  const s = await boot({ maxBytes: 2048 });
  try {
    const info = await checkStore(s.base, {});
    assert.equal(info.maxBytes, 2048);
    const big = JSON.stringify({ v: 11, pad: 'x'.repeat(4000) });
    await assert.rejects(
      () => putDesign(s.base, newDesignId(), newWriteKey(), big, {}),
      /too large/);
  } finally { await s.stop(); }
});

test('the browser is allowed to make the request at all', async () => {
  const s = await boot();
  try {
    // The preflight a browser sends before a PUT with a JSON body. Without an
    // answer to this the store works from curl and not from the tool, which
    // is the most likely way for a deployment to look broken.
    const pre = await fetch(`${s.base}/d/${newDesignId()}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.org',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.ok(pre.headers.get('access-control-allow-methods').includes('PUT'));
    assert.ok(pre.headers.get('access-control-allow-headers').includes('content-type'));
    // ...and the answer to the real call carries it too, or the browser
    // discards a response it did ask for.
    const health = await fetch(`${s.base}/health`);
    assert.equal(health.headers.get('access-control-allow-origin'), '*');
  } finally { await s.stop(); }
});

test('a design that is not a save file never reaches the disk', async () => {
  const s = await boot();
  try {
    const id = newDesignId();
    const res = await fetch(`${s.base}/d/${id}?key=${newWriteKey()}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'this is not a design',
    });
    assert.equal(res.status, 400);
    await assert.rejects(() => getDesign(s.base, id, {}), /no design at that address/);
  } finally { await s.stop(); }
});

// ---------- the relay ----------

test('two wires in one room hear each other and nobody else', async () => {
  const s = await boot();
  const room = makeRoom();
  const a = await opened(s.relay, room, 'siteA');
  const b = await opened(s.relay, room, 'siteB');
  const elsewhere = await opened(s.relay, makeRoom(), 'siteC');
  try {
    const heard = received(b, 1);
    const alone = received(elsewhere, 1, 600).then(() => 'heard').catch(() => 'nothing');
    a.send('hello', { name: 'Ms Okafor' });
    const [msg] = await heard;
    assert.equal(msg.k, 'hello');
    assert.equal(msg.s, 'siteA');
    assert.equal(msg.r, room);
    assert.equal(msg.name, 'Ms Okafor');
    // Another room is another session.
    assert.equal(await alone, 'nothing');
  } finally {
    a.close(); b.close(); elsewhere.close();
    await s.stop();
  }
});

test('the sender does not hear itself', async () => {
  const s = await boot();
  const room = makeRoom();
  const a = await opened(s.relay, room, 'siteA');
  const b = await opened(s.relay, room, 'siteB');
  try {
    let echoed = 0;
    a.onMessage(() => { echoed++; });
    const heard = received(b, 1);
    a.send('ops', { ops: [{ k: 'room', t: 1, id: 4 }] });
    await heard;
    await settle();
    // wire.js filters a self-echo on the way in as well, but a relay that
    // echoes would double every op through one client's own undo stack.
    assert.equal(echoed, 0);
  } finally { a.close(); b.close(); await s.stop(); }
});

test('a whole design travels down the wire unparsed', async () => {
  const s = await boot();
  const room = makeRoom();
  const a = await opened(s.relay, room, 'siteA');
  const b = await opened(s.relay, room, 'siteB');
  try {
    const design = serialize(buildSampleSchool());
    assert.ok(design.length > 20000, 'the sample school is a real design');
    const heard = received(b, 1, 8000);
    a.send('snap', { design });
    const [msg] = await heard;
    assert.equal(msg.k, 'snap');
    // Byte for byte. The relay has no idea what it just carried, which is the
    // whole of rule three.
    assert.equal(msg.design, design);
  } finally { a.close(); b.close(); await s.stop(); }
});

test('a socket that leaves is forgotten, and its room with it', async () => {
  const s = await boot();
  const room = makeRoom();
  const a = await opened(s.relay, room, 'siteA');
  const b = await opened(s.relay, room, 'siteB');
  await settle();
  assert.equal(s.rooms.count(room), 2);
  b.close();
  await settle(300);
  assert.equal(s.rooms.count(room), 1);
  a.close();
  await settle(300);
  assert.equal(s.rooms.rooms, 0, 'the relay holds nothing after the last of them leaves');
  await s.stop();
});

test('a room that is full says so rather than dropping the socket in silence', async () => {
  const s = await boot({ maxPerRoom: 2 });
  const room = makeRoom();
  const a = await opened(s.relay, room, 'siteA');
  const b = await opened(s.relay, room, 'siteB');
  try {
    // The third one gets a handshake and then a close with a reason in it —
    // a raw hang-up is indistinguishable from the relay being down, and
    // wire.js would reconnect into it every second for the rest of the
    // afternoon.
    const third = socketWire(s.relay, room, 'siteC');
    const states = [];
    third.onStatus((state) => states.push(state));
    third.start();
    await settle(500);
    assert.ok(states.includes('open'), 'the handshake succeeded');
    assert.ok(states.includes('waiting') || states.includes('connecting'),
      'and then it was told to go away');
    assert.equal(s.rooms.count(room), 2);
    third.close();
  } finally { a.close(); b.close(); await s.stop(); }
});

test('a socket with no room on the query string is refused the upgrade', async () => {
  const s = await boot();
  try {
    const ws = new WebSocket(`${s.relay}`);
    const how = await new Promise((ok) => {
      ws.onopen = () => ok('open');
      ws.onerror = () => ok('refused');
      setTimeout(() => ok('nothing'), 2000);
    });
    assert.equal(how, 'refused');
    assert.equal(s.rooms.rooms, 0);
  } finally { await s.stop(); }
});

test('a frame past the relay\'s cap is dropped and costs only its own socket', async () => {
  const s = await boot({ maxFrame: 4096 });
  const room = makeRoom();
  const a = await opened(s.relay, room, 'siteA');
  const b = await opened(s.relay, room, 'siteB');
  try {
    const heard = received(b, 1, 800).then(() => 'heard').catch(() => 'nothing');
    a.send('snap', { design: 'x'.repeat(8000) });
    assert.equal(await heard, 'nothing', 'it was not passed on');
    // The sender's socket was closed for it — which `socketWire` treats as
    // the relay having gone away and quietly reconnects into, exactly as it
    // would a restart. That is the right outcome and it is why this asserts
    // on the room rather than on the socket: the *other* end of it was never
    // touched, and the session carries on.
    const stillWorks = received(b, 1, 3000).then(() => 'heard').catch(() => 'nothing');
    const c = await opened(s.relay, room, 'siteD');
    c.send('pres', { at: 1 });
    assert.equal(await stillWorks, 'heard');
    c.close();
  } finally { a.close(); b.close(); await s.stop(); }
});

test('the relay does not care what it is carrying, and wire.js does', async () => {
  const s = await boot();
  const room = makeRoom();
  const b = await opened(s.relay, room, 'siteB');
  try {
    let delivered = 0;
    b.onMessage(() => { delivered++; });
    // A raw socket in the same room, saying three things: a message from a
    // wire version that does not exist, a message addressed to another room,
    // and one good one. The relay repeats all three unparsed — that is rule
    // three — and `wire.js`'s own `decode` is what drops the first two.
    const raw = new WebSocket(`${s.relay}?room=${room}`);
    await new Promise((ok, no) => {
      raw.onopen = ok;
      raw.onerror = () => no(new Error('the raw socket never opened'));
      setTimeout(() => no(new Error('timeout')), 3000);
    });
    raw.send(encode({ ...frame(room, 'siteZ', 'ops', { ops: [{ k: 'room', t: 1 }] }), v: WIRE_V + 9 }));
    raw.send(encode(frame('someotherroom', 'siteZ', 'pres', { at: 1 })));
    raw.send(encode(frame(room, 'siteZ', 'pres', { at: 1 })));
    await settle(400);
    assert.equal(delivered, 1, 'one of the three was a message this session could use');
    raw.close();
    await settle(150);
  } finally { b.close(); await s.stop(); }
});
