// A design in a link. The suite is round trips and refusals — the two things
// that decide whether a link somebody pasted into a chat opens the school
// that was in it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMFORT_CHARS, MAX_CHARS, SHARE_KEY,
  bytesToBase64url, base64urlToBytes, canCompress, deflate, inflate,
  encodeShare, decodeShare, shareFragment, readShareFragment, shareURL,
  shareStatus, shareOmissions, omissionNote,
} from '../js/share.js';
import { serialize, deserialize } from '../js/save-load.js';
import { createState } from '../js/grid.js';
import { buildSampleSchool } from '../js/sample.js';

// ---------- base64url ----------

test('base64url survives a round trip and has no url-hostile characters', () => {
  const bytes = new Uint8Array(1000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 251) & 0xff;
  const text = bytesToBase64url(bytes);
  assert.ok(!/[+/=]/.test(text), 'no +, / or = to be escaped by anything');
  assert.deepEqual(base64urlToBytes(text), bytes);
});

test('base64url handles every padding remainder', () => {
  for (let n = 0; n < 8; n++) {
    const bytes = new Uint8Array(n).fill(200);
    assert.deepEqual(base64urlToBytes(bytesToBase64url(bytes)), bytes, `${n} bytes`);
  }
});

// ---------- compression ----------

test('this build can compress, and deflate/inflate are inverses', async () => {
  assert.ok(canCompress(), 'node and every current browser have CompressionStream');
  const bytes = new TextEncoder().encode('a school '.repeat(500));
  const packed = await deflate(bytes);
  assert.ok(packed.length < bytes.length / 4, 'repeated text compresses hard');
  assert.deepEqual(await inflate(packed), bytes);
});

// ---------- the payload ----------

test('text round-trips through a payload', async () => {
  const text = JSON.stringify({ hello: 'world', list: [1, 2, 3] });
  const payload = await encodeShare(text);
  assert.equal(await decodeShare(payload), text);
});

test('a payload is tagged, and the tag decides how it is read', async () => {
  const payload = await encodeShare('x'.repeat(4000));
  assert.match(payload, /^z1\./);
  // Something incompressible goes out plain rather than longer.
  const noise = [];
  let seed = 7;
  for (let i = 0; i < 400; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise.push(seed % 256); }
  const plain = await encodeShare(String.fromCharCode(...noise));
  assert.ok(plain.startsWith('u1.') || plain.startsWith('z1.'));
});

test('unicode survives — a room name is not ascii', async () => {
  const text = JSON.stringify({ name: 'Sala de Música · 教室 · 🎺' });
  assert.equal(await decodeShare(await encodeShare(text)), text);
});

test('a whole school round-trips through a link and deserializes', async () => {
  const state = buildSampleSchool(createState(30, 24));
  const json = serialize(state);
  const payload = await encodeShare(json);
  const back = deserialize(await decodeShare(payload));
  assert.equal(back.floors.length, state.floors.length);
  assert.equal(back.props.length, state.props.length);
  assert.ok(shareStatus(payload).ok);
});

test('a school compresses to a fraction of its json', async () => {
  const state = buildSampleSchool(createState(30, 24));
  const json = serialize(state);
  const payload = await encodeShare(json);
  assert.ok(payload.length < json.length / 2, `${payload.length} vs ${json.length}`);
});

test('a damaged or foreign payload says so rather than throwing at the parser', async () => {
  await assert.rejects(() => decodeShare(''), /not a shared design/);
  await assert.rejects(() => decodeShare('nodot'), /not a shared design/);
  await assert.rejects(() => decodeShare('z1.'), /not a shared design/);
  await assert.rejects(() => decodeShare('z9.AAAA'), /newer version/);
  await assert.rejects(() => decodeShare('z1.AAAAAAAA'), /damaged/);
});

test('a truncated link — the failure a chat client actually causes — is caught', async () => {
  const payload = await encodeShare(JSON.stringify({ a: 'b'.repeat(4000) }));
  await assert.rejects(() => decodeShare(payload.slice(0, payload.length - 40)), /damaged/);
});

// ---------- fragments ----------

test('a fragment is written and read back', () => {
  assert.equal(shareFragment('z1.AAA'), '#s=z1.AAA');
  assert.equal(readShareFragment('#s=z1.AAA'), 'z1.AAA');
  assert.equal(readShareFragment('s=z1.AAA'), 'z1.AAA');
  assert.equal(SHARE_KEY, 's');
});

test('an ordinary hash is not mistaken for a design', () => {
  assert.equal(readShareFragment(''), null);
  assert.equal(readShareFragment('#'), null);
  assert.equal(readShareFragment('#about'), null);
  assert.equal(readShareFragment('#s='), null);
  assert.equal(readShareFragment(null), null);
});

test('a fragment with other keys beside it still yields the design', () => {
  assert.equal(readShareFragment('#tab=plan&s=z1.AAA'), 'z1.AAA');
  assert.equal(readShareFragment('#s=z1.AAA&tab=plan'), 'z1.AAA');
});

test('a share link replaces a share link rather than stacking on one', () => {
  assert.equal(shareURL('https://x.test/gen/', 'z1.A'), 'https://x.test/gen/#s=z1.A');
  assert.equal(shareURL('https://x.test/gen/#s=z1.OLD', 'z1.NEW'), 'https://x.test/gen/#s=z1.NEW');
  assert.equal(shareURL('https://x.test/gen/?v=2#x', 'z1.A'), 'https://x.test/gen/?v=2#s=z1.A');
});

// ---------- what to say about it ----------

test('the three size verdicts', () => {
  const small = shareStatus('z1.' + 'A'.repeat(500));
  assert.ok(small.ok && small.comfortable);
  assert.match(small.note, /paste anywhere/);

  const long = shareStatus('A'.repeat(COMFORT_CHARS + 100));
  assert.ok(long.ok && !long.comfortable);
  assert.match(long.note, /chat apps/);

  const huge = shareStatus('A'.repeat(MAX_CHARS + 1));
  assert.ok(!huge.ok);
  assert.match(huge.note, /save a file/);
});

test('the size counts the link, not just the payload', () => {
  const bare = shareStatus('A'.repeat(100));
  const withHref = shareStatus('A'.repeat(100), 'https://example.test/school-generator/');
  assert.ok(withHref.chars > bare.chars);
});

test('what a link cannot carry is said before the link is made', () => {
  assert.deepEqual(shareOmissions({}), []);
  assert.equal(omissionNote({}), '');
  assert.deepEqual(shareOmissions({ overlay: {} }), ['the tracing image']);
  assert.match(omissionNote({ overlay: {} }), /cannot carry the tracing image/);
  assert.match(omissionNote({ models: [1] }), /one imported model/);
  assert.match(omissionNote({ models: [1, 2] }), /2 imported models/);
  assert.match(omissionNote({ overlay: {}, models: [1] }), /tracing image and one imported model/);
  assert.equal(omissionNote(null), '');
});
