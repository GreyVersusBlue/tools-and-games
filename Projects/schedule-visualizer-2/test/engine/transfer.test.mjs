// Send to another device (spec 13.5, ARCHITECTURE 15), the engine half: the
// envelope the project file travels in, the receiver that puts it back
// together and refuses what is wrong in a sentence, the reply, and the
// connection codes, carried through a QR code and back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  TRANSFER_FORMAT, TRANSFER_END_FORMAT, TRANSFER_VERSION, CHUNK_BYTES, CHUNK_PREFIX_BYTES, SIGNAL_PREFIX, SIGNAL_MOST, SENTENCES,
  TransferError, packTransfer, createReceiver, chunkFrame, chunkCount, ackMessage, readAck,
  encodeSignal, decodeSignal, toBase64Url, fromBase64Url, compressionAvailable,
} from '../../engine/transfer.js';
import { writeProjectFile, readProjectFile } from '../../engine/project-file.js';
import { encodeQr } from '../../vendor/qr-encode/qr-encode.js';
import { decodeMatrix, decodeLuminance } from '../../vendor/qr-decode/qr-decode.js';
import { seededRandom } from '../../engine/ids.js';
import { school, clock, makeIds } from './helpers.mjs';

const subtle = globalThis.crypto.subtle;

const sampleFile = () => writeProjectFile(school());

// Every frame the sender made, as the data channel would hand it over:
// text as text, binary as an ArrayBuffer of its own.
const delivered = (frame) => (typeof frame === 'string' ? frame : frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));

const nodeSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A file of `length` bytes that is valid project-file-shaped text, for
// chunk arithmetic that does not need a real project.
const textOf = (length) => 'x'.repeat(length);

function refusal(code, pattern) {
  return (error) => {
    assert.ok(error instanceof TransferError, 'a TransferError, not ' + error);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  };
}

// ---------------------------------------------------------------- the envelope

test('the sample school\'s project file goes through the envelope and comes out byte for byte', async () => {
  const project = school();
  const text = writeProjectFile(project);
  const pack = await packTransfer(text, { projectId: project.id, subtle });
  const receiver = createReceiver({ subtle });
  for (const frame of pack.frames) receiver.accept(delivered(frame));
  assert.equal(receiver.progress().complete, true);
  const out = await receiver.finish();
  assert.equal(out.text, text);
  assert.equal(out.projectId, project.id);
  assert.equal(out.sha256, pack.sha256);
  // What arrived reads as the project that was sent.
  const read = readProjectFile(out.text, { ids: makeIds(), clock });
  assert.deepEqual(read.project, readProjectFile(text, { ids: makeIds(), clock }).project);
  assert.equal(read.project.id, project.id);
});

test('the header is exactly the six fields, the hash is the file\'s SHA-256, the chunks 16 KB', async () => {
  const text = sampleFile();
  const bytes = new TextEncoder().encode(text);
  const pack = await packTransfer(text, { projectId: 'pabcdefghi', subtle });
  assert.deepEqual(Object.keys(JSON.parse(pack.frames[0])), ['format', 'version', 'projectId', 'bytes', 'sha256', 'chunks']);
  assert.deepEqual(pack.header, { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, projectId: 'pabcdefghi', bytes: bytes.length, sha256: nodeSha256(bytes), chunks: Math.ceil(bytes.length / 16384) });
  assert.equal(CHUNK_BYTES, 16384);
  assert.equal(pack.frames.length, pack.header.chunks + 2);
  const chunks = pack.frames.slice(1, -1);
  chunks.forEach((frame, index) => {
    assert.deepEqual([...frame.subarray(0, 4)], [0x53, 0x56, 0x32, 0x43], 'SV2C');
    assert.equal(new DataView(frame.buffer, frame.byteOffset).getUint32(4, false), index);
    const expected = index < chunks.length - 1 ? CHUNK_BYTES : bytes.length - CHUNK_BYTES * (chunks.length - 1);
    assert.equal(frame.length, CHUNK_PREFIX_BYTES + expected);
    assert.deepEqual(frame.subarray(CHUNK_PREFIX_BYTES), bytes.subarray(index * CHUNK_BYTES, index * CHUNK_BYTES + expected));
  });
  assert.deepEqual(JSON.parse(pack.frames[pack.frames.length - 1]), { format: TRANSFER_END_FORMAT, version: 1, sha256: nodeSha256(bytes) });
});

test('chunk counts at the edges: one byte, exactly one chunk, one byte over', async () => {
  for (const [length, chunks] of [[1, 1], [CHUNK_BYTES, 1], [CHUNK_BYTES + 1, 2], [3 * CHUNK_BYTES, 3]]) {
    assert.equal(chunkCount(length), chunks);
    const pack = await packTransfer(textOf(length), { projectId: 'p1', subtle });
    assert.equal(pack.header.chunks, chunks, length + ' bytes');
    const receiver = createReceiver({ subtle });
    for (const frame of pack.frames) receiver.accept(delivered(frame));
    assert.equal((await receiver.finish()).text, textOf(length));
  }
});

test('chunks are taken in any order after the header, the trailer among them, and progress counts them', async () => {
  const text = textOf(5 * CHUNK_BYTES + 77);
  const pack = await packTransfer(text, { projectId: 'p1', subtle });
  const [header, ...rest] = pack.frames;
  const random = seededRandom('order');
  const shuffled = rest.map((frame) => [random(), frame]).sort((a, b) => a[0] - b[0]).map(([, frame]) => frame);
  const receiver = createReceiver({ subtle });
  assert.deepEqual(receiver.progress(), { received: 0, total: null, bytes: 0, totalBytes: null, ended: false, complete: false, projectId: null });
  assert.deepEqual(receiver.accept(header), { received: 0, total: 6, bytes: 0, totalBytes: text.length, ended: false, complete: false, projectId: 'p1' });
  let chunks = 0;
  for (const frame of shuffled) {
    const progress = receiver.accept(delivered(frame));
    if (typeof frame !== 'string') chunks += 1;
    assert.equal(progress.received, chunks);
    assert.equal(progress.complete, chunks === 6 && progress.ended);
  }
  assert.equal(receiver.progress().bytes, text.length);
  assert.equal((await receiver.finish()).text, text);
});

test('a chunk is taken as an ArrayBuffer, a Uint8Array or a view into a larger buffer', async () => {
  const text = textOf(CHUNK_BYTES + 10);
  const pack = await packTransfer(text, { projectId: 'p1', subtle });
  const receiver = createReceiver({ subtle });
  receiver.accept(pack.frames[0]);
  receiver.accept(pack.frames[1]);
  const second = pack.frames[2];
  const wide = new Uint8Array(second.length + 20);
  wide.set(second, 9);
  receiver.accept(new DataView(wide.buffer, 9, second.length));
  receiver.accept(pack.frames[3]);
  assert.equal((await receiver.finish()).text, text);
});

test('names and text in the file arrive exactly as typed', async () => {
  const project = school();
  project.settings.schoolName = 'École "Saint-Ève" <b>&amp;</b> 学校   🙂';
  const text = writeProjectFile(project);
  const pack = await packTransfer(text, { projectId: project.id, subtle });
  const receiver = createReceiver({ subtle });
  for (const frame of pack.frames) receiver.accept(delivered(frame));
  const out = await receiver.finish();
  assert.equal(JSON.parse(out.text).settings.schoolName, project.settings.schoolName);
});

// ---------------------------------------------------------------- refusals

async function receiveAll(frames) {
  const receiver = createReceiver({ subtle });
  for (const frame of frames) receiver.accept(delivered(frame));
  return receiver.finish();
}

test('a wrong hash is refused: a changed byte, or a trailer that disagrees with the header', async () => {
  const pack = await packTransfer(textOf(2 * CHUNK_BYTES + 5), { projectId: 'p1', subtle });
  const changed = pack.frames.slice();
  const chunk = changed[2].slice();
  chunk[CHUNK_PREFIX_BYTES + 3] ^= 1;
  changed[2] = chunk;
  await assert.rejects(receiveAll(changed), refusal('wrongHash', /did not arrive whole/));
  const trailer = pack.frames.slice();
  trailer[trailer.length - 1] = JSON.stringify({ format: TRANSFER_END_FORMAT, version: 1, sha256: '0'.repeat(64) });
  await assert.rejects(receiveAll(trailer), refusal('wrongHash'));
  const header = pack.frames.slice();
  header[0] = JSON.stringify({ ...pack.header, sha256: 'f'.repeat(64) });
  await assert.rejects(receiveAll(header), refusal('wrongHash'));
});

test('a newer version is refused, saying to reload or send the file', () => {
  const receiver = createReceiver({ subtle });
  assert.throws(() => receiver.accept(JSON.stringify({ format: TRANSFER_FORMAT, version: 2, projectId: 'p1', bytes: 5, sha256: 'a'.repeat(64), chunks: 1 })), refusal('newer', /newer Schedule Visualizer 2.*project file/));
  const late = createReceiver({ subtle });
  late.accept(JSON.stringify({ format: TRANSFER_FORMAT, version: 1, projectId: 'p1', bytes: 5, sha256: 'a'.repeat(64), chunks: 1 }));
  assert.throws(() => late.accept(JSON.stringify({ format: TRANSFER_END_FORMAT, version: 3, sha256: 'a'.repeat(64) })), refusal('newer'));
});

test('a foreign format is refused: another JSON format, text that is not JSON, binary without the mark', () => {
  for (const message of [JSON.stringify({ format: 'sv2-project', version: 1 }), JSON.stringify({ format: TRANSFER_FORMAT }), JSON.stringify({ format: TRANSFER_FORMAT, version: 0 }), 'hello', '[1,2]', JSON.stringify(null), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), new Uint8Array(3), 42, null, {}]) {
    const receiver = createReceiver({ subtle });
    assert.throws(() => receiver.accept(message), refusal('foreign', /did not come from Send to another device/), String(message));
  }
});

test('a duplicate chunk is refused, naming the part as a person counts', async () => {
  const pack = await packTransfer(textOf(3 * CHUNK_BYTES), { projectId: 'p1', subtle });
  const receiver = createReceiver({ subtle });
  receiver.accept(pack.frames[0]);
  receiver.accept(delivered(pack.frames[2]));
  assert.throws(() => receiver.accept(delivered(pack.frames[2])), refusal('duplicate', /^Part 2 of the project arrived twice/));
});

test('a missing chunk is refused when the project is finished, saying how many of how many', async () => {
  const pack = await packTransfer(textOf(3 * CHUNK_BYTES + 1), { projectId: 'p1', subtle });
  const frames = pack.frames.filter((_, i) => i !== 2);
  const receiver = createReceiver({ subtle });
  for (const frame of frames) receiver.accept(delivered(frame));
  const progress = receiver.progress();
  assert.equal(progress.ended, true);
  assert.equal(progress.complete, false);
  await assert.rejects(receiver.finish(), refusal('missing', /^The project arrived without 1 of its 4 parts/));
  const one = await packTransfer(textOf(10), { projectId: 'p1', subtle });
  await assert.rejects(receiveAll([one.frames[0], one.frames[2]]), refusal('missing', /without 1 of its 1 part,/));
});

test('a chunk out of range, a chunk of the wrong size, a chunk before the header are refused', async () => {
  const pack = await packTransfer(textOf(2 * CHUNK_BYTES + 9), { projectId: 'p1', subtle });
  const start = () => {
    const receiver = createReceiver({ subtle });
    receiver.accept(pack.frames[0]);
    return receiver;
  };
  assert.throws(() => start().accept(chunkFrame(3, new Uint8Array(9))), refusal('range', /^Part 4 arrived, but the project has only 3 parts/));
  assert.throws(() => start().accept(chunkFrame(0, new Uint8Array(CHUNK_BYTES - 1))), refusal('size', /^Part 1 of the project is the wrong size/));
  assert.throws(() => start().accept(chunkFrame(2, new Uint8Array(10))), refusal('size', /^Part 3/));
  assert.throws(() => createReceiver({ subtle }).accept(delivered(pack.frames[1])), refusal('noHeader'));
  assert.throws(() => createReceiver({ subtle }).accept(pack.frames[pack.frames.length - 1]), refusal('noHeader'));
});

test('a second header, or a second start or end after the end, is refused', async () => {
  const pack = await packTransfer(textOf(20), { projectId: 'p1', subtle });
  const receiver = createReceiver({ subtle });
  receiver.accept(pack.frames[0]);
  assert.throws(() => receiver.accept(pack.frames[0]), refusal('secondHeader'));
  const ended = createReceiver({ subtle });
  for (const frame of pack.frames) ended.accept(delivered(frame));
  assert.throws(() => ended.accept(pack.frames[2]), refusal('afterEnd'));
});

test('a header that does not add up is refused', () => {
  const good = { format: TRANSFER_FORMAT, version: 1, projectId: 'p1', bytes: CHUNK_BYTES + 1, sha256: 'a'.repeat(64), chunks: 2 };
  for (const change of [{ chunks: 1 }, { chunks: 3 }, { bytes: 0, chunks: 0 }, { bytes: -1 }, { bytes: 1.5 }, { bytes: '17' }, { sha256: 'A'.repeat(64) }, { sha256: 'a'.repeat(63) }, { projectId: '' }, { projectId: 7 }, { projectId: 'p'.repeat(65) }, { bytes: 2 ** 31, chunks: chunkCount(2 ** 31) }]) {
    assert.throws(() => createReceiver({ subtle }).accept(JSON.stringify({ ...good, ...change })), refusal('badHeader'), JSON.stringify(change));
  }
  assert.doesNotThrow(() => createReceiver({ subtle }).accept(JSON.stringify(good)));
});

test('bytes that are not UTF-8 text are refused, though their hash is right', async () => {
  const pack = await packTransfer(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), { projectId: 'p1', subtle });
  await assert.rejects(receiveAll(pack.frames), refusal('notText'));
});

test('finish before the end says so; a refusal stays: every later message and finish throw it again', async () => {
  const pack = await packTransfer(textOf(CHUNK_BYTES + 1), { projectId: 'p1', subtle });
  const receiver = createReceiver({ subtle });
  receiver.accept(pack.frames[0]);
  await assert.rejects(receiver.finish(), refusal('not-ended'));
  let first;
  try {
    receiver.accept('not a frame');
  } catch (error) {
    first = error;
  }
  assert.equal(first.code, 'foreign');
  assert.throws(() => receiver.accept(delivered(pack.frames[1])), (error) => error === first);
  await assert.rejects(receiver.finish(), (error) => error === first);
});

test('the sender needs the page\'s SubtleCrypto, a project id and a file with something in it', async () => {
  await assert.rejects(packTransfer('x', { projectId: 'p1' }), TypeError);
  await assert.rejects(packTransfer('x', { subtle }), TypeError);
  await assert.rejects(packTransfer('', { projectId: 'p1', subtle }), TypeError);
  await assert.rejects(packTransfer({ not: 'a file' }, { projectId: 'p1', subtle }), TypeError);
  assert.throws(() => createReceiver({}), TypeError);
});

test('every refusal is a whole sentence in the tool\'s words', () => {
  for (const [key, sentence] of Object.entries(SENTENCES)) {
    assert.match(sentence, /^[A-Z].*\.$/, key);
    assert.doesNotMatch(sentence, /\b(error|issue|conflict|invalid|fatal|failed)\b/i, key);
  }
});

// ---------------------------------------------------------------- the reply

test('the reply says whether the project was applied, for this sending only', async () => {
  const pack = await packTransfer(textOf(30), { projectId: 'p1', subtle });
  assert.deepEqual(readAck(ackMessage(pack.sha256, true), pack.sha256), { applied: true });
  assert.deepEqual(readAck(ackMessage(pack.sha256, false), pack.sha256), { applied: false });
  assert.deepEqual(JSON.parse(ackMessage(pack.sha256, true)), { format: 'sv2-transfer-ack', version: 1, sha256: pack.sha256, applied: true });
  assert.throws(() => readAck(ackMessage('b'.repeat(64), true), pack.sha256), refusal('ackOther'));
  assert.throws(() => readAck('{"format":"sv2-transfer-ack","version":1}', pack.sha256), refusal('ackForeign'));
  assert.throws(() => readAck(new Uint8Array(4), pack.sha256), refusal('ackForeign'));
  assert.throws(() => readAck(JSON.stringify({ format: 'sv2-transfer-ack', version: 2, sha256: pack.sha256, applied: true }), pack.sha256), refusal('newer'));
});

// ---------------------------------------------------------------- the connection codes

// An invented offer of the shape a browser makes for one data channel with
// no ICE servers, every candidate gathered: two host candidates, each under
// an mDNS name, the fingerprint, the SCTP port.
const OFFER = [
  'v=0',
  'o=- 4827315510391846102 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3021455823 1 udp 2113937151 6f1c2b7e-8a4d-4c1e-9b2f-3d5a7c9e1b4f.local 54012 typ host generation 0 network-cost 999',
  'a=candidate:1179812307 1 udp 2113939711 2a91d0c4-5e7b-4f3a-8c6d-1e9b0a7f2c58.local 61177 typ host generation 0 network-cost 999',
  'a=ice-ufrag:Qx7p',
  'a=ice-pwd:Zr4mT8kVb2NcW6yHq1LsJd9e',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 4B:9E:21:C7:5A:08:D3:6F:E2:91:3C:B4:7D:0A:58:F6:19:AE:83:2C:D5:6B:E0:47:9F:13:C8:72:A5:3E:0D:B9',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');
const ANSWER = OFFER.replace('a=setup:actpass', 'a=setup:active').replace(/Qx7p/, 'mK2d').replace('4827315510391846102', '7710023984561092837');

test('an offer and an answer go through their codes and come back exactly', async () => {
  for (const [type, sdp] of [['offer', OFFER], ['answer', ANSWER]]) {
    for (const compress of [true, false]) {
      const code = await encodeSignal({ type, sdp }, { subtle, compress });
      assert.ok(code.startsWith(SIGNAL_PREFIX));
      assert.match(code.slice(SIGNAL_PREFIX.length), /^[A-Za-z0-9_-]+$/);
      assert.deepEqual(await decodeSignal(code, { subtle, expect: type }), { type, sdp });
    }
  }
});

test('the code is shorter compressed, and fits one QR code at level M at a size a camera reads', async () => {
  assert.equal(compressionAvailable(), true, 'Node 22 has CompressionStream');
  const packed = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  const plain = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle, compress: false });
  assert.ok(packed.length < plain.length * 0.8, packed.length + ' against ' + plain.length);
  assert.equal(SIGNAL_MOST, 2331);
  const symbol = encodeQr(packed, { level: 'M' });
  // Measured 2026-10-20: 648 characters, version 20 (97 modules a side).
  assert.ok(symbol.version <= 22, 'version ' + symbol.version + ' for ' + packed.length + ' characters');
});

test('a pasted code may carry spaces, line breaks and a lower-case mark', async () => {
  const code = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  const wrapped = code.replace(/(.{60})/g, '$1\n  ').replace(SIGNAL_PREFIX, 'sv2:');
  assert.equal((await decodeSignal(' ' + wrapped + '\r\n', { subtle, expect: 'offer' })).sdp, OFFER);
});

test('a code typed or copied wrong is refused: one character changed, cut short, or not base64url', async () => {
  const code = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  const random = seededRandom('typo');
  for (let trial = 0; trial < 40; trial += 1) {
    const at = SIGNAL_PREFIX.length + Math.floor(random() * (code.length - SIGNAL_PREFIX.length));
    const swap = code[at] === 'A' ? 'B' : 'A';
    const typo = code.slice(0, at) + swap + code.slice(at + 1);
    await assert.rejects(decodeSignal(typo, { subtle, expect: 'offer' }), refusal('mistyped'), 'at ' + at);
  }
  await assert.rejects(decodeSignal(code.slice(0, -5), { subtle, expect: 'offer' }), refusal('mistyped'));
  await assert.rejects(decodeSignal(code.slice(0, 9), { subtle, expect: 'offer' }), refusal('mistyped'));
  await assert.rejects(decodeSignal(code + '!', { subtle, expect: 'offer' }), refusal('mistyped'));
  await assert.rejects(decodeSignal(SIGNAL_PREFIX + '+' + code.slice(SIGNAL_PREFIX.length + 1), { subtle, expect: 'offer' }), refusal('mistyped'));
});

test('what is not a code at all is refused, saying where to find one', async () => {
  for (const text of ['', 'hello', 'https://greyversusblue.com', 'SV2', 'SV3:abcd', null, 12]) {
    await assert.rejects(decodeSignal(text, { subtle, expect: 'offer' }), refusal('notCode', /Copy the whole code/), String(text));
  }
});

test('a reply pasted where the offer belongs, and the other way round, is refused by name', async () => {
  const offer = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  const answer = await encodeSignal({ type: 'answer', sdp: ANSWER }, { subtle });
  await assert.rejects(decodeSignal(answer, { subtle, expect: 'offer' }), refusal('wantedOffer', /This is a reply code/));
  await assert.rejects(decodeSignal(offer, { subtle, expect: 'answer' }), refusal('wantedAnswer', /sending device's code/));
  await assert.rejects(decodeSignal(offer, { subtle, expect: 'pranswer' }), TypeError);
  await assert.rejects(encodeSignal({ type: 'rollback', sdp: '' }, { subtle }), TypeError);
});

// A code with the given first three bytes and a right check, built by hand.
async function codeWith(head, body) {
  const payload = new Uint8Array(3 + body.length + 4);
  payload.set(head, 0);
  payload.set(body, 3);
  const check = new Uint8Array(await subtle.digest('SHA-256', payload.subarray(0, 3 + body.length)));
  payload.set(check.subarray(0, 4), 3 + body.length);
  return SIGNAL_PREFIX + toBase64Url(payload);
}

test('a code from a newer version is refused, saying to reload; an unknown kind or packing is not a code', async () => {
  const body = new TextEncoder().encode('v=0');
  await assert.rejects(decodeSignal(await codeWith([2, 1, 0], body), { subtle, expect: 'offer' }), refusal('newerCode', /newer Schedule Visualizer 2/));
  await assert.rejects(decodeSignal(await codeWith([0, 1, 0], body), { subtle, expect: 'offer' }), refusal('notCode'));
  await assert.rejects(decodeSignal(await codeWith([1, 3, 0], body), { subtle, expect: 'offer' }), refusal('notCode'));
  await assert.rejects(decodeSignal(await codeWith([1, 1, 2], body), { subtle, expect: 'offer' }), refusal('notCode'));
  assert.deepEqual(await decodeSignal(await codeWith([1, 1, 0], body), { subtle, expect: 'offer' }), { type: 'offer', sdp: 'v=0' });
  // Right check, but the packed bytes do not inflate, or are not UTF-8.
  await assert.rejects(decodeSignal(await codeWith([1, 1, 1], new Uint8Array([0xff, 0xff, 0xff])), { subtle, expect: 'offer' }), refusal('mistyped'));
  await assert.rejects(decodeSignal(await codeWith([1, 1, 0], new Uint8Array([0xc3, 0x28])), { subtle, expect: 'offer' }), refusal('mistyped'));
});

test('without CompressionStream the code is made unpacked, and a packed code cannot be opened', async () => {
  const packed = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  const unpacked = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle, compress: false });
  const saved = [globalThis.CompressionStream, globalThis.DecompressionStream];
  try {
    globalThis.CompressionStream = undefined;
    globalThis.DecompressionStream = undefined;
    assert.equal(compressionAvailable(), false);
    const plain = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
    assert.equal(plain, unpacked);
    assert.equal((await decodeSignal(plain, { subtle, expect: 'offer' })).sdp, OFFER);
    await assert.rejects(decodeSignal(packed, { subtle, expect: 'offer' }), refusal('noInflate', /project file instead/));
  } finally {
    [globalThis.CompressionStream, globalThis.DecompressionStream] = saved;
  }
});

test('a description too long for one QR code is refused when its code is made', async () => {
  // Random text barely compresses: 2,400 characters of it come to more than 2,331 of base64url.
  const random = seededRandom('long');
  const sdp = Array.from({ length: 2400 }, () => String.fromCharCode(33 + Math.floor(random() * 90))).join('');
  await assert.rejects(encodeSignal({ type: 'offer', sdp }, { subtle }), refusal('too-long', /too long for one QR code \(\d+ characters; one holds 2331\)/));
});

test('base64url agrees with the platform for every length from 0 to 70 bytes, and reads only its own form', () => {
  const random = seededRandom('b64');
  for (let length = 0; length <= 70; length += 1) {
    const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
    const text = toBase64Url(bytes);
    assert.equal(text, Buffer.from(bytes).toString('base64url'), 'length ' + length);
    assert.deepEqual(fromBase64Url(text), bytes, 'length ' + length);
  }
  for (const bad of ['a', 'ab=', 'a+b/', 'ab c', 'AB', 'AAB', 7, null]) assert.equal(fromBase64Url(bad), null, String(bad));
  assert.deepEqual(fromBase64Url('AA'), new Uint8Array([0]));
});

// ---------------------------------------------------------------- through a QR code

test('an offer goes into a QR code and is read back from its modules and from a camera-like frame', async () => {
  const code = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  const symbol = encodeQr(code, { level: 'M' });
  const fromModules = decodeMatrix(symbol);
  assert.equal(fromModules.text, code);
  assert.equal((await decodeSignal(fromModules.text, { subtle, expect: 'offer' })).sdp, OFFER);

  // A frame of the symbol at 4 px a module, turned 8°, with light noise.
  const scale = 4;
  const width = Math.ceil(symbol.size * scale * 1.6) + 40;
  const height = width;
  const random = seededRandom('offer-frame');
  const turn = (8 * Math.PI) / 180;
  const luminance = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - width / 2;
      const dy = y + 0.5 - height / 2;
      const mx = Math.floor((dx * Math.cos(turn) + dy * Math.sin(turn)) / scale + symbol.size / 2);
      const my = Math.floor((-dx * Math.sin(turn) + dy * Math.cos(turn)) / scale + symbol.size / 2);
      const dark = mx >= 0 && my >= 0 && mx < symbol.size && my < symbol.size && symbol.modules[my * symbol.size + mx];
      luminance[y * width + x] = Math.max(0, Math.min(255, (dark ? 40 : 210) + Math.round((random() - 0.5) * 30)));
    }
  }
  const fromFrame = decodeLuminance(luminance, width, height);
  assert.equal(fromFrame && fromFrame.text, code);
  assert.equal((await decodeSignal(fromFrame.text, { subtle, expect: 'offer' })).sdp, OFFER);
});

// ---------------------------------------------------------------- SV2-29c

// Bytes through deflate-raw, for codes built by hand.
async function deflated(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

test('a code longer than one QR code holds is refused before it is read, its check right or not', async () => {
  const random = seededRandom('over');
  const body = Uint8Array.from({ length: 1800 }, () => 97 + Math.floor(random() * 26));
  const code = await codeWith([1, 1, 0], body);
  assert.ok(code.length > SIGNAL_MOST, code.length + ' characters');
  await assert.rejects(decodeSignal(code, { subtle, expect: 'offer' }), refusal('too-long', /too long for one QR code \(\d+ characters; one holds 2331\)/));
  // Spaces do not count toward the length: the same code wrapped is still too long, and a short one wrapped wide is not.
  const fits = await encodeSignal({ type: 'offer', sdp: OFFER }, { subtle });
  assert.equal((await decodeSignal(fits.replace(/(.)/g, '$1 '), { subtle, expect: 'offer' })).sdp, OFFER);
});

test('a code whose check is right but which unpacks past 64 KB is refused, not opened', async () => {
  const body = await deflated(new TextEncoder().encode('v'.repeat(200 * 1024)));
  const code = await codeWith([1, 1, 1], body);
  assert.ok(code.length <= SIGNAL_MOST, code.length + ' characters');
  await assert.rejects(decodeSignal(code, { subtle, expect: 'offer' }), refusal('too-long', /more than 64 KB/));
  // Exactly 64 KB opens.
  const edge = await codeWith([1, 1, 1], await deflated(new TextEncoder().encode('v'.repeat(64 * 1024))));
  assert.equal((await decodeSignal(edge, { subtle, expect: 'offer' })).sdp.length, 64 * 1024);
});
