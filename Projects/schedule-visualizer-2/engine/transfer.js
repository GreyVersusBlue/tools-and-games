// Sending a project to another device (spec 13.5, ARCHITECTURE 15): the
// envelope the project file's bytes travel in over the data channel, the
// receiver that puts them back together, and the codes the two devices
// show each other to connect.
//
//   packTransfer(file, { projectId, subtle })  → { header, frames, sha256 }
//   createReceiver({ subtle })                  → { accept(message), progress(), finish() }
//   ackMessage(sha256, applied) / readAck(message, sha256)
//   encodeSignal(description, { subtle, compress }) → code text
//   decodeSignal(code, { subtle, expect })      → { type, sdp }
//
// The envelope. `file` is the project file exactly as writeProjectFile
// wrote it (text, sent as its UTF-8 bytes, or the bytes themselves); this
// module never serialises a project. The frames, in order:
//   1. the header, JSON text: { format: "sv2-transfer", version: 1,
//      projectId, bytes, sha256, chunks }
//   2. `chunks` binary frames: the four bytes "SV2C", the chunk's index as
//      a 32-bit big-endian number from 0, then the chunk: CHUNK_BYTES of
//      the file, the last one shorter
//   3. the trailer, JSON text: { format: "sv2-transfer-end", version: 1, sha256 }
// sha256 is the file's SHA-256 in lower-case hexadecimal. The receiver
// answers with { format: "sv2-transfer-ack", version: 1, sha256, applied }
// once it has replaced its project (applied true) or chosen not to (false).
// The data channel must hand binary messages over as ArrayBuffer
// (binaryType "arraybuffer").
//
// The connection codes. An offer or an answer is a WebRTC session
// description, { type, sdp }. Its code is "SV2:" and then base64url of:
// one byte for the code's version (1), one for its kind (1 offer, 2
// answer), one for how the description is packed (0 as it is, 1 deflate-raw
// through CompressionStream where the browser has it), the description's
// UTF-8 bytes so packed, and the first four bytes of the SHA-256 of all
// that, so a code typed or copied wrong is refused rather than tried.
//
// Hashing is WebCrypto's SHA-256, never one written here. The engine line
// (ARCHITECTURE 3) keeps the platform's crypto out of every engine module but
// publish-crypto.js, so the page hands its SubtleCrypto in as `subtle`, the
// way a clock or a random source is handed in.
//
// Every refusal is a TransferError whose message is a sentence to show as
// it is, and whose `code` says which refusal it was.

export const TRANSFER_FORMAT = 'sv2-transfer';
export const TRANSFER_END_FORMAT = 'sv2-transfer-end';
export const TRANSFER_ACK_FORMAT = 'sv2-transfer-ack';
export const TRANSFER_VERSION = 1;
export const CHUNK_BYTES = 16 * 1024;
export const CHUNK_MAGIC = [0x53, 0x56, 0x32, 0x43];
export const CHUNK_PREFIX_BYTES = 8;
// A header claiming more is not believed, and the receiver allocates the
// whole file at the header, so this is also the most a phone is asked for.
// The 3.13 sample project is 182 KB of JSON; traced floor plans ride inside
// the project file as base64 images, and even several large ones leave 64 MB
// far off.
export const TRANSFER_MOST_BYTES = 64 * 1024 * 1024;

export const SIGNAL_PREFIX = 'SV2:';
export const SIGNAL_VERSION = 1;
export const SIGNAL_KINDS = { offer: 1, answer: 2 };
export const SIGNAL_CHECK_BYTES = 4;
// The most characters one QR code holds at error correction M (version 40,
// byte mode). A code longer than this is refused when it is made.
export const SIGNAL_MOST = 2331;
// The most a code's description may unpack to. A browser's offer or answer
// for one data channel is under 2 KB; deflate turns 100 KB of one letter
// into a few hundred bytes, so a code that fits the QR limit could otherwise
// unpack to hundreds of megabytes.
export const SIGNAL_INFLATED_MOST = 64 * 1024;

export const SENTENCES = {
  foreign: 'This did not come from Send to another device in Schedule Visualizer 2, so nothing was changed.',
  newer: 'The other device has a newer Schedule Visualizer 2. Reload greyversusblue.com on this device and try again, or send the project file instead.',
  badHeader: 'The project\'s start did not add up, so nothing was changed. Try sending it again.',
  noHeader: 'Part of the project arrived before its start, so nothing was changed. Try sending it again.',
  secondHeader: 'A second start arrived in the middle of the project, so nothing was changed. Try sending it again.',
  afterEnd: 'A second start or end arrived after the end of the project, so nothing was changed. Try sending it again.',
  notEnded: 'The project has not finished arriving yet.',
  wrongHash: 'The project did not arrive whole: its check does not match what was sent, so nothing was changed. Try sending it again, or send the project file instead.',
  noRoom: 'This device does not have the memory free to take the project, so nothing was changed. Close other tabs and try again, or send the project file instead.',
  notText: 'What arrived is not a project file, so nothing was changed. Try sending it again, or send the project file instead.',
  ackForeign: 'The other device\'s reply could not be read, so it is not known whether it took the project.',
  ackOther: 'The other device\'s reply is about a different sending, so it is not known whether it took this project.',
  notCode: 'This is not a Send to another device code. Copy the whole code from the other device, or scan its QR code.',
  mistyped: 'This code has a mistake in it: it may have been typed or copied wrong. Copy it again, or scan the QR code.',
  newerCode: 'This code comes from a newer Schedule Visualizer 2. Reload greyversusblue.com on this device and try again, or send the project file instead.',
  wantedOffer: 'This is a reply code. Paste the code from the device that is sending the project.',
  wantedAnswer: 'This is a sending device\'s code. Paste the reply code from the device that is receiving the project.',
  noInflate: 'This browser cannot open that code. Send the project file instead.',
  tooBig: 'This code unpacks to more than 64 KB, which no connection code does, so it was not opened. Copy the code from the other device again, or send the project file instead.',
};

export class TransferError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new TransferError(message || SENTENCES[code], code);
}

function needSubtle(options) {
  const subtle = options && options.subtle;
  if (!subtle || typeof subtle.digest !== 'function') throw new TypeError('pass the page\'s SubtleCrypto as options.subtle');
  return subtle;
}

async function sha256(subtle, bytes) {
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

function hex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

const parts = (count) => (count === 1 ? '1 part' : count + ' parts');

// ---------------------------------------------------------------- the envelope

function fileBytes(file) {
  if (typeof file === 'string') return new TextEncoder().encode(file);
  if (file instanceof Uint8Array) return file;
  throw new TypeError('the project file is its text or its bytes');
}

// The sender and the receiver hold a project id to the same rule.
export const PROJECT_ID_MOST = 64;
const soundProjectId = (id) => typeof id === 'string' && id !== '' && id.length <= PROJECT_ID_MOST;

export function chunkCount(bytes) {
  return Math.ceil(bytes / CHUNK_BYTES);
}

export function chunkFrame(index, data) {
  const frame = new Uint8Array(CHUNK_PREFIX_BYTES + data.length);
  frame.set(CHUNK_MAGIC, 0);
  new DataView(frame.buffer).setUint32(4, index, false);
  frame.set(data, CHUNK_PREFIX_BYTES);
  return frame;
}

export async function packTransfer(file, options) {
  const subtle = needSubtle(options);
  const projectId = options.projectId;
  if (!soundProjectId(projectId)) throw new TypeError('options.projectId names the project being sent, in 1 to ' + PROJECT_ID_MOST + ' characters');
  const bytes = fileBytes(file);
  if (bytes.length === 0) throw new TypeError('the project file is empty');
  const digest = hex(await sha256(subtle, bytes));
  const chunks = chunkCount(bytes.length);
  const header = { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, projectId, bytes: bytes.length, sha256: digest, chunks };
  const frames = [JSON.stringify(header)];
  for (let i = 0; i < chunks; i += 1) frames.push(chunkFrame(i, bytes.subarray(i * CHUNK_BYTES, Math.min(bytes.length, (i + 1) * CHUNK_BYTES))));
  frames.push(JSON.stringify({ format: TRANSFER_END_FORMAT, version: TRANSFER_VERSION, sha256: digest }));
  return { header, frames, sha256: digest };
}

function asBytes(message) {
  if (message instanceof Uint8Array) return message;
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A JSON frame of ours: its format is one of the three, its version a whole
// number from 1. Anything else is foreign; a later version is newer.
function readFrame(text, formats) {
  const value = parseJson(text);
  if (!isObject(value) || !formats.includes(value.format)) refuse('foreign');
  if (!Number.isInteger(value.version) || value.version < 1) refuse('foreign');
  if (value.version > TRANSFER_VERSION) refuse('newer');
  return value;
}

function checkHeader(value) {
  const sound = soundProjectId(value.projectId)
    && Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= TRANSFER_MOST_BYTES
    && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)
    && value.chunks === chunkCount(value.bytes);
  if (!sound) refuse('badHeader');
  return { format: value.format, version: value.version, projectId: value.projectId, bytes: value.bytes, sha256: value.sha256, chunks: value.chunks };
}

// Takes the chunks in any order after the header, the trailer among them;
// a chunk is placed by its index. accept() returns the progress:
// { received, total, bytes, totalBytes, ended, complete, projectId }, where
// `ended` says the trailer is in and `complete` that every chunk is too, so
// finish() can be asked. Once a refusal is thrown the receiver is spent: every later
// message, and finish(), throws that same refusal.
export function createReceiver(options) {
  const subtle = needSubtle(options);
  let header = null;
  let buffer = null;
  let seen = null;
  let received = 0;
  let receivedBytes = 0;
  let trailer = null;
  let failed = null;

  const fail = (error) => {
    failed = error;
    throw error;
  };

  const progress = () => ({
    received,
    total: header ? header.chunks : null,
    bytes: receivedBytes,
    totalBytes: header ? header.bytes : null,
    ended: trailer !== null,
    complete: trailer !== null && header !== null && received === header.chunks,
    projectId: header ? header.projectId : null,
  });

  function take(message) {
    if (typeof message === 'string') {
      const value = readFrame(message, [TRANSFER_FORMAT, TRANSFER_END_FORMAT]);
      if (trailer) refuse('afterEnd');
      if (value.format === TRANSFER_FORMAT) {
        if (header) refuse('secondHeader');
        const checked = checkHeader(value);
        try {
          buffer = new Uint8Array(checked.bytes);
          seen = new Uint8Array(checked.chunks);
        } catch {
          refuse('noRoom');
        }
        header = checked;
        return;
      }
      if (!header) refuse('noHeader');
      if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) refuse('foreign');
      trailer = value;
      return;
    }
    const frame = asBytes(message);
    if (!frame || frame.length < CHUNK_PREFIX_BYTES || CHUNK_MAGIC.some((byte, i) => frame[i] !== byte)) refuse('foreign');
    if (!header) refuse('noHeader');
    const index = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(4, false);
    if (index >= header.chunks) refuse('range', 'Part ' + (index + 1) + ' arrived, but the project has only ' + parts(header.chunks) + ', so nothing was changed. Try sending it again.');
    if (seen[index]) refuse('duplicate', 'Part ' + (index + 1) + ' of the project arrived twice, so nothing was changed. Try sending it again.');
    const length = index === header.chunks - 1 ? header.bytes - index * CHUNK_BYTES : CHUNK_BYTES;
    if (frame.length - CHUNK_PREFIX_BYTES !== length) refuse('size', 'Part ' + (index + 1) + ' of the project is the wrong size, so nothing was changed. Try sending it again.');
    buffer.set(frame.subarray(CHUNK_PREFIX_BYTES), index * CHUNK_BYTES);
    seen[index] = 1;
    received += 1;
    receivedBytes += length;
  }

  return {
    // One frame as the data channel delivered it: a string or an ArrayBuffer.
    accept(message) {
      if (failed) throw failed;
      try {
        take(message);
      } catch (error) {
        fail(error);
      }
      return progress();
    },
    progress,
    // Once the trailer is in: every part there, the hash right, the bytes a
    // UTF-8 text. → { text, bytes, projectId, sha256 }
    async finish() {
      if (failed) throw failed;
      if (!trailer) throw new TransferError(SENTENCES.notEnded, 'not-ended');
      try {
        const missing = header.chunks - received;
        if (missing > 0) refuse('missing', 'The project arrived without ' + missing + ' of its ' + parts(header.chunks) + ', so nothing was changed. Try sending it again.');
        const digest = hex(await sha256(subtle, buffer));
        if (digest !== header.sha256 || trailer.sha256 !== header.sha256) refuse('wrongHash');
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
        } catch {
          refuse('notText');
        }
        return { text, bytes: buffer, projectId: header.projectId, sha256: digest };
      } catch (error) {
        return fail(error);
      }
    },
  };
}

export function ackMessage(digest, applied) {
  return JSON.stringify({ format: TRANSFER_ACK_FORMAT, version: TRANSFER_VERSION, sha256: digest, applied: applied === true });
}

// The receiver's reply, for the sending this side made → { applied }.
export function readAck(message, digest) {
  const value = typeof message === 'string' ? parseJson(message) : undefined;
  if (!isObject(value) || value.format !== TRANSFER_ACK_FORMAT || !Number.isInteger(value.version) || value.version < 1 || typeof value.applied !== 'boolean') refuse('ackForeign');
  if (value.version > TRANSFER_VERSION) refuse('newer');
  if (value.sha256 !== digest) refuse('ackOther');
  return { applied: value.applied };
}

// ---------------------------------------------------------------- the connection codes

// Both streams, with deflate-raw: Chrome 80 to 102 have the constructors
// but only gzip and deflate, and throw a TypeError on any other format, so
// the format is tried rather than the names looked for.
export function compressionAvailable() {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return false;
  try {
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

// The bytes through a compression stream; null, the stream cancelled, once
// the output passes `most` bytes.
async function through(bytes, stream, most = Infinity) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const pieces = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
    length += value.length;
    if (length > most) {
      reader.cancel().catch(() => {});
      return null;
    }
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// RFC 4648 section 5, with no padding.
export function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    const left = bytes.length - i;
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
    if (left > 1) out += BASE64URL[(n >> 6) & 63];
    if (left > 2) out += BASE64URL[n & 63];
  }
  return out;
}

// The bytes, or null for text that is not unpadded base64url. The unused
// low bits of the last character must be zero, so each text has one reading.
export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const piece = text.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j += 1) n = (n << 6) | (j < piece.length ? BASE64URL.indexOf(piece[j]) : 0);
    if (piece.length === 2 && (n & 0xffff) !== 0) return null;
    if (piece.length === 3 && (n & 0xff) !== 0) return null;
    out[at++] = (n >> 16) & 255;
    if (piece.length > 2) out[at++] = (n >> 8) & 255;
    if (piece.length > 3) out[at++] = n & 255;
  }
  return out;
}

// A code's first byte, its version, from its first two characters; 0 when
// they are not there or not base64url.
function versionOf(encoded) {
  if (encoded.length < 2) return 0;
  const high = BASE64URL.indexOf(encoded[0]);
  const low = BASE64URL.indexOf(encoded[1]);
  return high < 0 || low < 0 ? 0 : (high << 2) | (low >> 4);
}

function refuseTooLong(length) {
  refuse('too-long', 'This connection code is too long for one QR code (' + length + ' characters; one holds ' + SIGNAL_MOST + '). Send the project file instead.');
}

// options: { subtle, compress } — compress false packs the description as
// it is; left out, it is deflated wherever the browser can.
export async function encodeSignal(description, options) {
  const subtle = needSubtle(options);
  if (!isObject(description) || !Object.hasOwn(SIGNAL_KINDS, description.type) || typeof description.sdp !== 'string') throw new TypeError('a session description is { type: "offer" or "answer", sdp }');
  const wantCompress = !(options && options.compress === false) && compressionAvailable();
  let body = new TextEncoder().encode(description.sdp);
  if (wantCompress) body = await through(body, new CompressionStream('deflate-raw'));
  const payload = new Uint8Array(3 + body.length + SIGNAL_CHECK_BYTES);
  payload[0] = SIGNAL_VERSION;
  payload[1] = SIGNAL_KINDS[description.type];
  payload[2] = wantCompress ? 1 : 0;
  payload.set(body, 3);
  const check = await sha256(subtle, payload.subarray(0, 3 + body.length));
  payload.set(check.subarray(0, SIGNAL_CHECK_BYTES), 3 + body.length);
  const code = SIGNAL_PREFIX + toBase64Url(payload);
  if (code.length > SIGNAL_MOST) refuseTooLong(code.length);
  return code;
}

// options: { subtle, expect } — expect 'offer' on the receiving device,
// 'answer' on the sending one. Spaces and line breaks in a pasted code are
// ignored; nothing else is.
export async function decodeSignal(code, options) {
  const subtle = needSubtle(options);
  const expect = options.expect;
  if (!Object.hasOwn(SIGNAL_KINDS, expect)) throw new TypeError('options.expect is "offer" or "answer"');
  const text = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
  if (text.slice(0, SIGNAL_PREFIX.length).toUpperCase() !== SIGNAL_PREFIX) refuse('notCode');
  // No code this side makes is longer, so a longer one is not read at all.
  if (text.length > SIGNAL_MOST) refuseTooLong(text.length);
  const encoded = text.slice(SIGNAL_PREFIX.length);
  // The version byte is read first, from the first two characters, since a
  // later version may lay out the rest differently (another check length,
  // say) and would otherwise read as mistyped. A typo in those two
  // characters of one of ours can read as newer too; the sentence then says
  // to reload, which costs a reload, and the code is refused either way.
  const mistaken = () => refuse(versionOf(encoded) > SIGNAL_VERSION ? 'newerCode' : 'mistyped');
  const payload = fromBase64Url(encoded);
  if (!payload) mistaken();
  if (payload.length < 3 + SIGNAL_CHECK_BYTES) mistaken();
  const end = payload.length - SIGNAL_CHECK_BYTES;
  const check = await sha256(subtle, payload.subarray(0, end));
  for (let i = 0; i < SIGNAL_CHECK_BYTES; i += 1) if (check[i] !== payload[end + i]) mistaken();
  if (payload[0] > SIGNAL_VERSION) refuse('newerCode');
  if (payload[0] < 1) refuse('notCode');
  const type = Object.keys(SIGNAL_KINDS).find((kind) => SIGNAL_KINDS[kind] === payload[1]);
  if (!type || payload[2] > 1) refuse('notCode');
  if (type !== expect) refuse(expect === 'offer' ? 'wantedOffer' : 'wantedAnswer');
  let body = payload.slice(3, end);
  if (payload[2] === 1) {
    if (!compressionAvailable()) refuse('noInflate');
    let inflated;
    try {
      inflated = await through(body, new DecompressionStream('deflate-raw'), SIGNAL_INFLATED_MOST);
    } catch {
      refuse('mistyped');
    }
    if (inflated === null) refuse('too-long', SENTENCES.tooBig);
    body = inflated;
  }
  let sdp;
  try {
    sdp = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    refuse('mistyped');
  }
  return { type, sdp };
}
