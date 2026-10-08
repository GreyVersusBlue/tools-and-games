// The lock on a published file: a key made from the staff passcode
// (PBKDF2, SHA-256, 310,000 rounds) and the schedule encrypted with it
// (AES-GCM, 256 bits). It is real encryption of the data: a locked file holds
// the school's id, the publish time and bytes nobody can read without the
// passcode.
//
// This is the one engine module allowed crypto.subtle. It works in Node 22 and
// in a browser, on a served page and on a file opened from disk. It takes no
// randomness of its own: the IV comes from the `random` passed in (numbers
// from 0 up to 1, the same shape engine/ids.js takes), so a publish with a
// seeded source gives the same bytes every time.
//
// The salt is made from the school's id unless one is passed in. A reader's
// device keeps the key it made, not the passcode, so the passcode is asked
// once per device; a key is only good for the salt it was made with, and a
// salt that changed with every publish would ask again for every new file.
// The school's id is random and travels in the locked file beside the salt,
// so nothing is given away by deriving one from the other.
//
// The school id and the publish time are bound into the encryption (the
// additional data), so a file whose date was edited does not open.
//
// A published file carries this module, so it keeps to the linker rule:
// one-line named imports, `export` only directly before a declaration.

export const LOCKED_FORMAT = 'sv2-published-locked';
export const LOCKED_VERSION = 1;
export const KDF_ITERATIONS = 310000;
export const KDF_ITERATIONS_MOST = 5000000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const KEY_BYTES = 32;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Bytes to base64 text, and back. fromBase64 returns null for text that is
// not base64.
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    text += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    text += i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    text += i + 2 < bytes.length ? ALPHABET[c & 63] : '=';
  }
  return text;
}

export function fromBase64(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = (ALPHABET.indexOf(text[i]) << 18)
      | (ALPHABET.indexOf(text[i + 1]) << 12)
      | ((text[i + 2] === '=' ? 0 : ALPHABET.indexOf(text[i + 2])) << 6)
      | (text[i + 3] === '=' ? 0 : ALPHABET.indexOf(text[i + 3]));
    if (at < bytes.length) bytes[at] = (n >> 16) & 255;
    if (at + 1 < bytes.length) bytes[at + 1] = (n >> 8) & 255;
    if (at + 2 < bytes.length) bytes[at + 2] = n & 255;
    at += 3;
  }
  return bytes;
}

// `count` bytes from a source of numbers from 0 up to 1.
export function randomBytes(random, count) {
  if (typeof random !== 'function') throw new TypeError('Locking a published file needs a random function returning numbers from 0 up to 1.');
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) bytes[i] = Math.min(255, Math.max(0, Math.floor(random() * 256)));
  return bytes;
}

function subtle() {
  const found = globalThis.crypto && globalThis.crypto.subtle;
  if (!found) throw new Error('This browser cannot open a locked file here: it has no encryption for pages opened this way. Open the file in Safari, Chrome, Edge or Firefox.');
  return found;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

// The salt for a school: the first 16 bytes of SHA-256 over its id.
export async function schoolSalt(schoolId) {
  const digest = await subtle().digest('SHA-256', utf8('sv2-published-salt:' + String(schoolId)));
  return new Uint8Array(digest).slice(0, SALT_BYTES);
}

// The key a passcode makes: 32 raw bytes. This is the slow step, on purpose.
export async function deriveKey(passcode, salt, iterations) {
  const material = await subtle().importKey('raw', utf8(String(passcode)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iterations || KDF_ITERATIONS }, material, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

function bound(schoolId, publishedAt) {
  return utf8(LOCKED_FORMAT + '\n' + LOCKED_VERSION + '\n' + schoolId + '\n' + publishedAt);
}

async function aesKey(rawKey, use) {
  return subtle().importKey('raw', rawKey, 'AES-GCM', false, [use]);
}

// Is this the locked form? Says nothing about whether it is well made.
export function isLocked(value) {
  return Boolean(value) && typeof value === 'object' && value.format === LOCKED_FORMAT;
}

// What is wrong with a locked file's envelope, as a sentence, or null when it
// can be tried.
export function lockedProblem(envelope) {
  const cut = 'This file is damaged: part of it is missing or was changed. Ask the office for a new copy.';
  if (!isLocked(envelope)) return cut;
  if (envelope.version !== LOCKED_VERSION) return cut;
  if (typeof envelope.schoolId !== 'string' || typeof envelope.publishedAt !== 'string') return cut;
  const kdf = envelope.kdf;
  const cipher = envelope.cipher;
  if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') return cut;
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > KDF_ITERATIONS_MOST) return cut;
  if (!cipher || cipher.name !== 'AES-GCM') return cut;
  const salt = fromBase64(kdf.salt);
  const iv = fromBase64(cipher.iv);
  const data = fromBase64(envelope.data);
  if (!salt || salt.length < 8 || !iv || iv.length !== IV_BYTES || !data || data.length < 16) return cut;
  return null;
}

// Lock a published model. `options.random` gives the IV; `options.salt`
// (bytes) replaces the school's own salt; `options.iterations` is for tests
// that cannot wait. The result is the object a locked file carries.
export async function lockPublished(model, passcode, options) {
  const opts = options || {};
  if (typeof passcode !== 'string' || passcode === '') throw new TypeError('Locking a published file needs a passcode.');
  const schoolId = String(model.id);
  const publishedAt = String(model.publishedAt);
  const salt = opts.salt || (await schoolSalt(schoolId));
  const iv = randomBytes(opts.random, IV_BYTES);
  const iterations = opts.iterations || KDF_ITERATIONS;
  const rawKey = await deriveKey(passcode, salt, iterations);
  const key = await aesKey(rawKey, 'encrypt');
  const sealed = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: bound(schoolId, publishedAt) }, key, utf8(JSON.stringify(model)));
  return {
    format: LOCKED_FORMAT,
    version: LOCKED_VERSION,
    schoolId,
    publishedAt,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(new Uint8Array(sealed)),
  };
}

// Open a locked file with a key made earlier (32 raw bytes). Gives the
// published model, or null when the key does not open it: a key from an old
// passcode, or a file that was changed. Throws only for an envelope that
// lockedProblem() names.
export async function unlockWithKey(envelope, rawKey) {
  const problem = lockedProblem(envelope);
  if (problem) throw new Error(problem);
  if (!rawKey || rawKey.length !== KEY_BYTES) return null;
  let opened;
  try {
    const key = await aesKey(rawKey, 'decrypt');
    opened = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.cipher.iv), additionalData: bound(envelope.schoolId, envelope.publishedAt) },
      key,
      fromBase64(envelope.data),
    );
  } catch (error) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(opened));
  } catch (error) {
    return null;
  }
}

// Open a locked file with the passcode. Gives { model, key }, the key being
// what a device keeps so it need not ask again, or null for a passcode that
// does not open it.
export async function unlockPublished(envelope, passcode) {
  const problem = lockedProblem(envelope);
  if (problem) throw new Error(problem);
  const key = await deriveKey(String(passcode), fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
  const model = await unlockWithKey(envelope, key);
  return model === null ? null : { model, key };
}
