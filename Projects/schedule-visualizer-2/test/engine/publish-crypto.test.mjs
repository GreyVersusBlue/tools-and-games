// The lock on a published file (ARCHITECTURE 6.7): base64, the key, the
// round trip with an injected salt and IV, a wrong passcode, a key kept from
// an old passcode, and a file that was changed.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCKED_FORMAT, LOCKED_VERSION, KDF_ITERATIONS, SALT_BYTES, IV_BYTES, KEY_BYTES,
  toBase64, fromBase64, randomBytes, schoolSalt, deriveKey, isLocked, lockedProblem,
  lockPublished, unlockWithKey, unlockPublished,
} from '../../engine/publish-crypto.js';
import { publishedModel } from '../../engine/publish-data.js';
import { seededRandom } from '../../engine/ids.js';
import { school, clock, clone } from './helpers.mjs';

// Fast rounds for every case but the one that checks the real number.
const FAST = 1000;
const model = () => publishedModel(school(), { clock });
const lock = (passcode, extra) => lockPublished(model(), passcode, { random: seededRandom('sv2-test'), iterations: FAST, ...extra });

test('base64 agrees with the platform for every length from 0 to 70 bytes', () => {
  const random = seededRandom(3);
  for (let length = 0; length <= 70; length += 1) {
    const bytes = randomBytes(random, length);
    const text = toBase64(bytes);
    assert.equal(text, Buffer.from(bytes).toString('base64'), 'length ' + length);
    assert.deepEqual(fromBase64(text), bytes, 'length ' + length);
  }
});

test('text that is not base64 reads as null, never as some bytes', () => {
  for (const bad of ['abc', 'ab=c', '====', 'a b c d', 'abc-', 'abcd\n', '=abc', 7, null, undefined]) assert.equal(fromBase64(bad), null, String(bad));
  assert.deepEqual(fromBase64(''), new Uint8Array(0));
});

test('randomBytes takes its bytes from the source it is given, and refuses to do without one', () => {
  assert.deepEqual(randomBytes(() => 0, 3), new Uint8Array([0, 0, 0]));
  assert.deepEqual(randomBytes(() => 0.999999, 2), new Uint8Array([255, 255]));
  assert.deepEqual(randomBytes(seededRandom('a'), 12), randomBytes(seededRandom('a'), 12));
  assert.notDeepEqual(randomBytes(seededRandom('a'), 12), randomBytes(seededRandom('b'), 12));
  assert.throws(() => randomBytes(undefined, 4), /needs a random function/);
});

test('a locked file has exactly the envelope of ARCHITECTURE 6.7', async () => {
  const envelope = await lock('bulldogs2015');
  assert.deepEqual(Object.keys(envelope), ['format', 'version', 'schoolId', 'publishedAt', 'kdf', 'cipher', 'data']);
  assert.equal(envelope.format, 'sv2-published-locked');
  assert.equal(LOCKED_FORMAT, 'sv2-published-locked');
  assert.equal(envelope.version, 1);
  assert.equal(LOCKED_VERSION, 1);
  assert.equal(envelope.schoolId, 'psample001');
  assert.equal(envelope.publishedAt, '2026-09-01T12:00:00.000Z');
  assert.deepEqual(Object.keys(envelope.kdf), ['name', 'hash', 'iterations', 'salt']);
  assert.equal(envelope.kdf.name, 'PBKDF2');
  assert.equal(envelope.kdf.hash, 'SHA-256');
  assert.deepEqual(Object.keys(envelope.cipher), ['name', 'iv']);
  assert.equal(envelope.cipher.name, 'AES-GCM');
  assert.equal(fromBase64(envelope.kdf.salt).length, SALT_BYTES);
  assert.equal(fromBase64(envelope.cipher.iv).length, IV_BYTES);
  assert.equal(isLocked(envelope), true);
  assert.equal(isLocked(model()), false);
  assert.equal(lockedProblem(envelope), null);
});

test('a locked file holds nothing readable: no school name, no teacher, no room, no passcode', async () => {
  const plain = model();
  const text = JSON.stringify(await lock('bulldogs2015'));
  assert.ok(JSON.stringify(plain).includes('Marrowby'), 'the plain model does name the school');
  for (const word of ['Marrowby', 'Halloran', 'Gym', 'rsample101', 'tsample001', 'bulldogs2015', 'A Day']) assert.ok(!text.includes(word), word + ' can be read in the locked file');
  assert.ok(text.length > JSON.stringify(plain).length, 'the encrypted bytes are all there');
});

test('the passcode opens it, with the salt and the IV that were passed in', async () => {
  const salt = randomBytes(seededRandom('salt'), SALT_BYTES);
  const envelope = await lock('bulldogs2015', { salt, random: seededRandom('iv') });
  assert.equal(envelope.kdf.salt, toBase64(salt));
  assert.equal(envelope.cipher.iv, toBase64(randomBytes(seededRandom('iv'), IV_BYTES)));
  const opened = await unlockPublished(envelope, 'bulldogs2015');
  assert.deepEqual(opened.model, model());
  assert.equal(opened.key.length, KEY_BYTES);
  assert.deepEqual(opened.key, await deriveKey('bulldogs2015', salt, FAST));
});

test('the same inputs give the same file, and another IV gives other bytes', async () => {
  const one = await lock('bulldogs2015');
  const two = await lock('bulldogs2015');
  assert.deepEqual(two, one);
  const three = await lock('bulldogs2015', { random: seededRandom('another') });
  assert.notEqual(three.cipher.iv, one.cipher.iv);
  assert.notEqual(three.data, one.data);
  assert.equal(three.kdf.salt, one.kdf.salt, 'the salt is the school\'s, whatever the IV');
});

test('locking needs a passcode and a random source', async () => {
  await assert.rejects(lockPublished(model(), '', { random: seededRandom(1), iterations: FAST }), /needs a passcode/);
  await assert.rejects(lockPublished(model(), 'x', { iterations: FAST }), /needs a random function/);
  await assert.rejects(lockPublished(model(), 'x'), /needs a random function/);
});

test('with nothing passed in, the key is made with 310,000 rounds and the school\'s own salt', async () => {
  const envelope = await lockPublished(model(), 'bulldogs2015', { random: seededRandom('sv2-test') });
  assert.equal(KDF_ITERATIONS, 310000);
  assert.equal(envelope.kdf.iterations, 310000);
  assert.equal(envelope.kdf.salt, toBase64(await schoolSalt('psample001')));
  assert.notEqual(toBase64(await schoolSalt('psample002')), envelope.kdf.salt, 'another school has another salt');
  const opened = await unlockPublished(envelope, 'bulldogs2015');
  assert.equal(opened.model.settings.schoolName, 'Marrowby Middle School (sample)');
});

test('a wrong passcode opens nothing and says so by returning null', async () => {
  const envelope = await lock('bulldogs2015');
  assert.equal(await unlockPublished(envelope, 'bulldogs2016'), null);
  assert.equal(await unlockPublished(envelope, ''), null);
  assert.equal(await unlockPublished(envelope, 'Bulldogs2015'), null, 'a passcode is compared exactly, capitals included');
  assert.equal(await unlockPublished(envelope, ' bulldogs2015'), null);
});

test('a key kept on a device opens a newer file published with the same passcode', async () => {
  const first = await lock('bulldogs2015');
  const kept = (await unlockPublished(first, 'bulldogs2015')).key;
  const later = publishedModel(school(), { clock: () => new Date('2026-09-20T07:30:00Z') });
  later.groups[0].name = '6A (new)';
  const newer = await lockPublished(later, 'bulldogs2015', { random: seededRandom('next week'), iterations: FAST });
  assert.notEqual(newer.data, first.data);
  const opened = await unlockWithKey(newer, kept);
  assert.equal(opened.groups[0].name, '6A (new)');
  assert.equal(opened.publishedAt, '2026-09-20T07:30:00.000Z');
});

test('a key kept from an old passcode does not open a file published with a new one', async () => {
  const kept = (await unlockPublished(await lock('bulldogs2015'), 'bulldogs2015')).key;
  const changed = await lock('wolverines1987');
  assert.equal(await unlockWithKey(changed, kept), null);
  assert.equal((await unlockPublished(changed, 'wolverines1987')).model.id, 'psample001');
});

test('a key of the wrong size, or none, opens nothing', async () => {
  const envelope = await lock('bulldogs2015');
  assert.equal(await unlockWithKey(envelope, new Uint8Array(16)), null);
  assert.equal(await unlockWithKey(envelope, null), null);
  assert.equal(await unlockWithKey(envelope, new Uint8Array(KEY_BYTES)), null);
});

test('a file whose date, school or bytes were changed does not open', async () => {
  const envelope = await lock('bulldogs2015');
  const redated = { ...envelope, publishedAt: '2027-01-01T00:00:00.000Z' };
  assert.equal(await unlockPublished(redated, 'bulldogs2015'), null, 'the publish time is bound into the lock');
  const moved = { ...envelope, schoolId: 'psample002' };
  assert.equal(await unlockPublished(moved, 'bulldogs2015'), null, 'the school id is bound into the lock');
  const bytes = fromBase64(envelope.data);
  bytes[20] ^= 1;
  assert.equal(await unlockPublished({ ...envelope, data: toBase64(bytes) }, 'bulldogs2015'), null);
});

test('a damaged envelope is refused in a sentence before any key is made', async () => {
  const envelope = await lock('bulldogs2015');
  const breaks = [
    (e) => { e.version = 2; },
    (e) => { delete e.kdf; },
    (e) => { e.kdf.name = 'scrypt'; },
    (e) => { e.kdf.hash = 'SHA-1'; },
    (e) => { e.kdf.iterations = 0; },
    (e) => { e.kdf.iterations = 1e9; },
    (e) => { e.kdf.iterations = '310000'; },
    (e) => { e.kdf.salt = 'not base64!'; },
    (e) => { e.kdf.salt = ''; },
    (e) => { e.cipher.name = 'AES-CBC'; },
    (e) => { e.cipher.iv = toBase64(new Uint8Array(16)); },
    (e) => { e.data = e.data.slice(0, 8); },
    (e) => { e.data = 42; },
    (e) => { delete e.schoolId; },
    (e) => { e.publishedAt = 5; },
  ];
  for (const [index, change] of breaks.entries()) {
    const broken = clone(envelope);
    change(broken);
    assert.match(String(lockedProblem(broken)), /^This file is damaged/, 'break ' + index);
    await assert.rejects(unlockPublished(broken, 'bulldogs2015'), /This file is damaged/, 'break ' + index);
    await assert.rejects(unlockWithKey(broken, new Uint8Array(KEY_BYTES)), /This file is damaged/, 'break ' + index);
  }
  assert.match(lockedProblem(model()), /damaged/);
  assert.match(lockedProblem(null), /damaged/);
});

test('any passcode a person can type works, and every name comes back as typed', async () => {
  const plain = model();
  plain.settings.schoolName = '</script> "Ünïcödé" 東京  ';
  for (const passcode of ['p', 'пароль 2015', '密码', '<b>"\'&', ' spaces kept ', '🔑🔑']) {
    const envelope = await lockPublished(plain, passcode, { random: seededRandom(passcode), iterations: FAST });
    assert.deepEqual((await unlockPublished(envelope, passcode)).model, plain, passcode);
    assert.equal(await unlockPublished(envelope, passcode + ' '), null, passcode);
  }
});
