// cloud.test.mjs — the client half of a design that outlives the tab.
//
// There is no server in this repository, which is the point of the contract
// being narrow: every call this file makes is four lines of anybody's HTTP
// framework, and the suite holds this side of it to exactly those four. The
// stub below *is* the specification — if a real store passes this, the tool
// works against it.
//
// Run `node --test` from Projects/school-generator.

import test from 'node:test';
import assert from 'node:assert/strict';

function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
  return store;
}
installFakeLocalStorage();

const {
  MAX_BYTES, STORE_CONTRACT,
  newDesignId, newWriteKey, validId,
  normalizeBase, normalizeRelay, impliedRelay,
  readConfig, writeConfig, cloudReady,
  readKeys, rememberKey, keyFor, forgetKey,
  cloudFragment, readCloudFragment, cloudURL,
  checkStore, getDesign, putDesign, deleteDesign, describeCloud,
} = await import('../js/cloud.js');

// ---------- the stub store ----------
//
// Four endpoints, the claim-on-first-write rule, and nothing else.
function fakeStore() {
  const held = new Map();
  const calls = [];
  const res = (status, body = '') => ({
    status,
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
  });
  const fetch = async (url, opts = {}) => {
    const at = new URL(url);
    const method = opts.method || 'GET';
    calls.push({ method, path: at.pathname, key: at.searchParams.get('key') });
    if (at.pathname.endsWith('/health')) return res(200, JSON.stringify({ ok: true, maxBytes: 1024 * 1024 }));
    const id = at.pathname.split('/').pop();
    const key = at.searchParams.get('key') || '';
    const rec = held.get(id);
    if (method === 'GET') return rec ? res(200, rec.body) : res(404);
    if (rec && rec.key !== key) return res(403);
    if (method === 'PUT') {
      if (String(opts.body || '').length > 1024 * 1024) return res(413);
      held.set(id, { key, body: String(opts.body || '') });
      return res(200, JSON.stringify({ id }));
    }
    if (method === 'DELETE') { held.delete(id); return res(200); }
    return res(405);
  };
  return { fetch, held, calls };
}

// ---------- addresses ----------

test('only an http address is an address', () => {
  assert.equal(normalizeBase('https://store.example/api/'), 'https://store.example/api');
  assert.equal(normalizeBase('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(normalizeBase('store.example'), '', 'no scheme, no store');
  assert.equal(normalizeBase('javascript:alert(1)'), '', 'and never that one');
  assert.equal(normalizeBase(''), '');
});

test('a relay address is a socket address', () => {
  assert.equal(normalizeRelay('wss://relay.example/ws'), 'wss://relay.example/ws');
  assert.equal(normalizeRelay('https://relay.example'), '');
  assert.equal(impliedRelay('https://store.example/api'), 'wss://store.example/api/relay');
  assert.equal(impliedRelay('http://localhost:8080'), 'ws://localhost:8080/relay');
  assert.equal(impliedRelay(''), '');
});

// ---------- ids and keys ----------

test('a design id is readable and a write key is long', () => {
  const id = newDesignId(() => 0.5);
  const key = newWriteKey(() => 0.5);
  assert.equal(validId(id), true);
  assert.equal(id.length, 12);
  assert.equal(key.length, 24);
  assert.equal(validId('nope!'), false);
  assert.equal(validId(''), false);
});

test('the write key stays in this browser and the link does not carry it', () => {
  localStorage.clear();
  const id = newDesignId(() => 0.3);
  const key = newWriteKey(() => 0.7);
  rememberKey(id, key, 'My School');
  assert.equal(keyFor(id), key);
  const link = cloudURL('https://example.test/app/', id, 'https://store.example');
  assert.equal(link.includes(key), false, 'a link with the key in it is not a read link');
  forgetKey(id);
  assert.equal(keyFor(id), '');
  assert.deepEqual(readKeys(), {});
});

// ---------- config ----------

test('a store address survives the tab, and a corrupt one is no store', () => {
  localStorage.clear();
  assert.equal(cloudReady(readConfig()), false);
  writeConfig({ base: 'https://store.example/', relay: 'wss://store.example/relay', name: 'Sam' });
  const cfg = readConfig();
  assert.equal(cfg.base, 'https://store.example');
  assert.equal(cfg.relay, 'wss://store.example/relay');
  assert.equal(cfg.name, 'Sam');
  assert.equal(cloudReady(cfg), true);

  localStorage.setItem('sg.cloud', '{not json');
  assert.equal(cloudReady(readConfig()), false);
});

test('unconfigured, the tool says what it does instead of failing', () => {
  const note = describeCloud({ base: '' });
  assert.match(note, /No store is set/);
  assert.match(note, /files you save/);
  assert.match(describeCloud({ base: 'https://store.example' }), /Anybody with the link can open one/);
});

// ---------- links ----------

test('a cloud link is a fragment and carries the store it came from', () => {
  const id = 'abcdefghjkmn';
  const f = cloudFragment(id, 'https://store.example');
  assert.deepEqual(readCloudFragment(f), { id, base: 'https://store.example' });
  assert.deepEqual(readCloudFragment(cloudFragment(id)), { id, base: '' });
  assert.equal(readCloudFragment('#s=z1.abc'), null);
  assert.equal(readCloudFragment('#d=NOPE'), null);
});

// ---------- the four calls ----------

test('health says whether there is anything there', async () => {
  const store = fakeStore();
  const info = await checkStore('https://store.example', store);
  assert.equal(info.ok, true);
  assert.equal(info.maxBytes, 1024 * 1024);
  assert.equal(store.calls[0].path, '/health');
});

test('a design goes up and comes back down byte for byte', async () => {
  const store = fakeStore();
  const id = newDesignId(() => 0.1);
  const key = newWriteKey(() => 0.2);
  const json = JSON.stringify({ version: 11, w: 40, h: 30 });
  const out = await putDesign('https://store.example', id, key, json, store);
  assert.equal(out.bytes, json.length);
  assert.equal(await getDesign('https://store.example', id, store), json);
});

test('the first write claims the id, and another browser cannot take it', async () => {
  const store = fakeStore();
  const id = newDesignId(() => 0.1);
  await putDesign('https://store.example', id, 'mine-mine-mine-mine-mine', '{"a":1}', store);
  await assert.rejects(
    () => putDesign('https://store.example', id, 'theirs', '{"a":2}', store),
    /belongs to another browser/
  );
  // ...and the design is untouched.
  assert.equal(await getDesign('https://store.example', id, store), '{"a":1}');
});

test('a design that is not there says so, in a sentence', async () => {
  const store = fakeStore();
  await assert.rejects(() => getDesign('https://store.example', 'abcdefghjkmn', store), /no design at that address/);
});

test('a store that cannot be reached is a different problem from one that refused', async () => {
  const dead = { fetch: async () => { throw new Error('network'); } };
  await assert.rejects(() => getDesign('https://store.example', 'abcdefghjkmn', dead), /Could not reach the store/);
  const angry = { fetch: async () => ({ status: 500, text: async () => '', json: async () => ({}) }) };
  await assert.rejects(() => getDesign('https://store.example', 'abcdefghjkmn', angry), /refused the request \(500\)/);
});

test('a design too big for the store is refused here, with the size in the sentence', async () => {
  const store = fakeStore();
  const id = newDesignId(() => 0.1);
  await assert.rejects(
    () => putDesign('https://store.example', id, 'k', 'x'.repeat(MAX_BYTES + 1), store),
    /past the 10 MB/
  );
  // ...and one the local cap allows but the store does not is the store's word.
  await assert.rejects(
    () => putDesign('https://store.example', id, 'k', 'x'.repeat(1024 * 1024 + 1), store),
    /too large/
  );
});

test('with no store set, every call refuses before it reaches the network', async () => {
  const store = fakeStore();
  await assert.rejects(() => getDesign('', 'abcdefghjkmn', store), /No store address is set/);
  await assert.rejects(() => putDesign('', 'abcdefghjkmn', 'k', '{}', store), /No store address is set/);
  await assert.rejects(() => checkStore('not-a-url', store), /not an http address/);
  assert.equal(store.calls.length, 0, 'nothing was sent anywhere');
});

test('deleting takes the key, and the design is gone afterwards', async () => {
  const store = fakeStore();
  const id = newDesignId(() => 0.4);
  await putDesign('https://store.example', id, 'key-key-key', '{"a":1}', store);
  assert.equal(await deleteDesign('https://store.example', id, 'key-key-key', store), true);
  await assert.rejects(() => getDesign('https://store.example', id, store), /no design at that address/);
});

test('the contract is four endpoints, which is the whole server', () => {
  assert.equal(STORE_CONTRACT.length, 4);
  assert.ok(STORE_CONTRACT.some((line) => line.startsWith('PUT')));
});
