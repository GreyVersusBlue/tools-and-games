// The store's policy: the four calls, and the one sentence that is its whole
// security model — anybody with the link can read it, only the browser that
// made it can change it.
//
// Asserted against `decide()` rather than against a running server, so every
// rule is one call with no disk under it. The server that actually holds the
// files is exercised end to end in server.test.mjs, through cloud.js's own
// four functions.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decide, route, validId, validKey, looksLikeJSON, safeEqual, corsHeaders, MAX_BYTES,
} from '../server/store.js';
import { newDesignId, newWriteKey, validId as clientValidId } from '../js/cloud.js';

const DESIGN = JSON.stringify({ v: 11, floors: [] });
const KEY = 'aaaaaaaabbbbbbbbcccccccc';
const held = (key = KEY) => ({ key, bytes: 10, at: 0 });
const put = (id, key, body = DESIGN) => ({
  method: 'PUT', url: `/d/${id}?key=${key}`, bytes: Buffer.byteLength(body), body,
});

test('the store and the client agree about what an id is', () => {
  for (let i = 0; i < 50; i++) {
    const id = newDesignId();
    assert.equal(validId(id), true, id);
    assert.equal(clientValidId(id), validId(id), id);
    assert.equal(validKey(newWriteKey()), true);
  }
  for (const bad of ['', 'abc', 'x'.repeat(41), 'ABCDEF', 'ab-cdef', null]) {
    assert.equal(validId(bad), false, String(bad));
  }
  assert.equal(validKey(''), false, 'an empty key is a client bug, not a key');
  assert.equal(validKey('short'), false);
});

test('routing is two paths and nothing else', () => {
  assert.equal(route('GET', '/health').kind, 'health');
  assert.equal(route('GET', '/health?x=1').kind, 'health');
  assert.equal(route('GET', '/d/abcdef123456').id, 'abcdef123456');
  assert.equal(route('PUT', '/d/abcdef123456?key=zzz').key, 'zzz');
  assert.equal(route('GET', '/').kind, 'none');
  assert.equal(route('GET', '/d/a/b').kind, 'none');
  // A trailing slash is the same address, because somebody will type one.
  assert.equal(route('GET', '/d/abcdef123456/').id, 'abcdef123456');
});

test('health says what the store takes, which is what cloud.js reads', () => {
  const a = decide({ method: 'GET', url: '/health' }, null, { note: 'a school district' });
  assert.equal(a.status, 200);
  assert.equal(a.json.ok, true);
  assert.equal(a.json.maxBytes, MAX_BYTES);
  assert.equal(a.json.note, 'a school district');
  // The note is what a person running a store gets to say, and cloud.js only
  // prints 120 characters of it.
  const long = decide({ method: 'GET', url: '/health' }, null, { note: 'x'.repeat(500) });
  assert.equal(long.json.note.length, 120);
  assert.equal(decide({ method: 'POST', url: '/health' }).status, 405);
});

test('the browser is allowed to ask, which is the difference between working and not', () => {
  // A PUT with a JSON content-type is not a simple request, so the browser
  // sends this first. A store that does not answer it works from curl and not
  // at all from the tool.
  const pre = decide({ method: 'OPTIONS', url: '/d/abcdef123456' });
  assert.equal(pre.status, 204);
  assert.equal(pre.preflight, true);
  const h = corsHeaders();
  assert.equal(h['access-control-allow-origin'], '*');
  for (const m of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.ok(h['access-control-allow-methods'].includes(m), m);
  }
  assert.ok(h['access-control-allow-headers'].includes('content-type'));
});

test('the first PUT claims the id and the next one has to prove it', () => {
  const id = 'abcdef123456';
  const first = decide(put(id, KEY), null);
  assert.equal(first.action, 'write');
  assert.equal(first.claimed, true);
  assert.equal(first.status, 201);

  const again = decide(put(id, KEY), held());
  assert.equal(again.action, 'write');
  assert.equal(again.claimed, false);
  assert.equal(again.status, 200);

  // Somebody else's browser, with its own key, gets the one answer cloud.js
  // can turn into a sentence a person can act on.
  const other = decide(put(id, 'zzzzzzzzyyyyyyyyxxxxxxxx'), held());
  assert.equal(other.status, 403);
  assert.equal(other.action, 'none');
});

test('anybody with the link can read it, and that is on purpose', () => {
  const id = 'abcdef123456';
  // No key anywhere in this request.
  const get = decide({ method: 'GET', url: `/d/${id}` }, held());
  assert.equal(get.status, 200);
  assert.equal(get.action, 'read');
  // ...and a design nobody has stored is a 404, which cloud.js turns into
  // "there is no design at that address any more".
  assert.equal(decide({ method: 'GET', url: `/d/${id}` }, null).status, 404);
  // An id that is not an id is the same 404, not a 400: there is no design
  // there either way, and it is the sentence that is true.
  assert.equal(decide({ method: 'GET', url: '/d/NOPE' }, null).status, 404);
});

test('a write without a key is refused before anything is looked at', () => {
  const id = 'abcdef123456';
  assert.equal(decide({ method: 'PUT', url: `/d/${id}`, bytes: 5, body: DESIGN }, null).status, 403);
  assert.equal(decide({ method: 'PUT', url: `/d/${id}?key=`, bytes: 5, body: DESIGN }, null).status, 403);
  assert.equal(decide({ method: 'DELETE', url: `/d/${id}` }, held()).status, 403);
});

test('the size cap is the store\'s own and it says so', () => {
  const id = 'abcdef123456';
  const big = { method: 'PUT', url: `/d/${id}?key=${KEY}`, bytes: 200, body: DESIGN };
  assert.equal(decide(big, null, { maxBytes: 100 }).status, 413);
  assert.equal(decide(big, null, { maxBytes: 1000 }).status, 201);
  // An empty body is a client bug rather than a design.
  assert.equal(decide({ method: 'PUT', url: `/d/${id}?key=${KEY}`, bytes: 0, body: '' }, null).status, 400);
});

test('a store that will hold anything is a file host; this one holds save files', () => {
  const id = 'abcdef123456';
  assert.equal(decide(put(id, KEY, 'not json at all'), null).status, 400);
  // A truncated upload is the shape this actually catches: refused at the
  // door rather than served back to somebody as a broken design later.
  assert.equal(decide(put(id, KEY, '{"v":11,"floors":[{'), null).status, 400);
  assert.equal(looksLikeJSON('{}'), true);
  assert.equal(looksLikeJSON('[]'), true);
  assert.equal(looksLikeJSON('42'), false, 'a number is not a save file');
  assert.equal(looksLikeJSON('"a design"'), false);
  assert.equal(looksLikeJSON(''), false);
  assert.equal(looksLikeJSON(null), false);
});

test('deleting needs the key, and deleting nothing is a 404 either way', () => {
  const id = 'abcdef123456';
  const del = (key) => decide({ method: 'DELETE', url: `/d/${id}?key=${key}` }, held());
  assert.equal(del(KEY).action, 'delete');
  assert.equal(del('zzzzzzzzyyyyyyyyxxxxxxxx').status, 403);
  assert.equal(decide({ method: 'DELETE', url: `/d/${id}?key=${KEY}` }, null).status, 404);
});

test('a method the contract does not have is a 405, not a surprise', () => {
  assert.equal(decide({ method: 'PATCH', url: '/d/abcdef123456' }, null).status, 405);
  assert.equal(decide({ method: 'GET', url: '/somewhere-else' }, null).status, 404);
});

test('keys are compared without leaking how much of one was right', () => {
  assert.equal(safeEqual(KEY, KEY), true);
  assert.equal(safeEqual(KEY, `${KEY}x`), false);
  assert.equal(safeEqual(KEY, KEY.slice(0, -1) + 'z'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual(null, undefined), true, 'both are nothing');
});
