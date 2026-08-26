// The WebSocket half of the relay: the handshake, and the bytes.
//
// This is the one module in this project written against somebody else's
// document rather than against a drawing, so the assertions lean on the RFC's
// own worked example — a handshake whose accept value is printed in the spec
// — and then on the shapes a real browser actually sends: a fragmented
// message, a masked frame, a close with no body in it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPCODES, CLOSE, acceptKey, checkUpgrade, handshakeResponse,
  encodeFrame, closeFrame, makeReader, readFrames, closeCodeOf,
} from '../server/ws.js';

// A client frame: masked, because every frame from a client must be.
function clientFrame(payload, opcode = OPCODES.TEXT, fin = true) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
  else if (len < 65536) {
    header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
  }
  header[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.from(body);
  for (let i = 0; i < len; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

const textOf = (m) => m.payload.toString('utf8');

test('the accept key is the one the RFC prints', () => {
  // RFC 6455 §1.3, worked example.
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('a good upgrade is accepted and a bad one is refused with a reason', () => {
  const good = checkUpgrade({
    upgrade: 'websocket',
    connection: 'Upgrade',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-websocket-version': '13',
  });
  assert.equal(good.ok, true);
  assert.equal(good.accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.ok(handshakeResponse(good.accept).startsWith('HTTP/1.1 101 '));
  assert.ok(handshakeResponse(good.accept).endsWith('\r\n\r\n'), 'headers are terminated');

  // A proxy that rewrote Connection into a list is still an upgrade — this
  // is the header real browsers send through real proxies.
  assert.equal(checkUpgrade({
    upgrade: 'WebSocket', connection: 'keep-alive, Upgrade',
    'sec-websocket-key': 'x',
  }).ok, true);

  assert.equal(checkUpgrade({}).ok, false);
  assert.equal(checkUpgrade({ upgrade: 'websocket', connection: 'keep-alive', 'sec-websocket-key': 'x' }).ok, false);
  assert.equal(checkUpgrade({ upgrade: 'websocket', connection: 'Upgrade' }).ok, false);
  const old = checkUpgrade({
    upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'x',
    'sec-websocket-version': '8',
  });
  assert.equal(old.ok, false);
  assert.equal(old.status, 426, 'the RFC says say which version you speak');
  assert.equal(old.version, '13');
});

test('a frame goes out unmasked, and comes back through a reader unchanged', () => {
  const reader = makeReader();
  const out = readFrames(reader, clientFrame('hello'));
  assert.equal(out.error, null);
  assert.equal(out.messages.length, 1);
  assert.equal(textOf(out.messages[0]), 'hello');
  // A server never masks, and the mask bit is where a client checks.
  const server = encodeFrame('hello');
  assert.equal((server[1] & 0x80) !== 0, false);
});

test('the three payload-length encodings all survive a round trip', () => {
  for (const len of [0, 5, 125, 126, 400, 65535, 65536, 70000]) {
    const text = 'x'.repeat(len);
    const reader = makeReader();
    const out = readFrames(reader, clientFrame(text));
    assert.equal(out.error, null, `len ${len}`);
    assert.equal(out.messages.length, 1, `len ${len}`);
    assert.equal(textOf(out.messages[0]).length, len);
    // ...and the server's own encoder picks the same three widths.
    const enc = encodeFrame(text);
    assert.equal(enc.length, len + (len < 126 ? 2 : len < 65536 ? 4 : 10));
  }
});

test('a message split across TCP reads is one message', () => {
  const frame = clientFrame('a design that arrived in pieces');
  const reader = makeReader();
  // Byte at a time — which is not paranoia: a two-megabyte snapshot arrives
  // in whatever chunks the kernel felt like, and never once whole.
  let messages = [];
  for (const byte of frame) {
    const out = readFrames(reader, Buffer.from([byte]));
    assert.equal(out.error, null);
    messages = messages.concat(out.messages);
  }
  assert.equal(messages.length, 1);
  assert.equal(textOf(messages[0]), 'a design that arrived in pieces');
});

test('two frames in one read are two messages', () => {
  const reader = makeReader();
  const out = readFrames(reader, Buffer.concat([clientFrame('one'), clientFrame('two')]));
  assert.deepEqual(out.messages.map(textOf), ['one', 'two']);
});

test('a fragmented message is assembled, because browsers fragment', () => {
  const reader = makeReader();
  const first = readFrames(reader, clientFrame('half a ', OPCODES.TEXT, false));
  assert.equal(first.messages.length, 0, 'nothing is delivered until FIN');
  const rest = readFrames(reader, clientFrame('snapshot', OPCODES.CONT, true));
  assert.equal(rest.messages.length, 1);
  assert.equal(textOf(rest.messages[0]), 'half a snapshot');
  assert.equal(rest.messages[0].opcode, OPCODES.TEXT, 'it keeps the first frame\'s kind');
});

test('control frames come out separately and are answerable', () => {
  const reader = makeReader();
  const out = readFrames(reader, Buffer.concat([
    clientFrame('data'),
    clientFrame('', OPCODES.PING),
    clientFrame(Buffer.from([0x03, 0xe8]), OPCODES.CLOSE),
  ]));
  assert.equal(out.messages.length, 1);
  assert.deepEqual(out.control.map((c) => c.opcode), [OPCODES.PING, OPCODES.CLOSE]);
  assert.equal(closeCodeOf(out.control[1].payload), 1000);
  // A close with no body at all is legal, and is what a browser sends on a
  // plain reload.
  assert.equal(closeCodeOf(Buffer.alloc(0)), CLOSE.NORMAL);
  assert.equal(closeCodeOf(null), CLOSE.NORMAL);
});

test('a close frame carries its code and a trimmed reason', () => {
  const reader = makeReader();
  // The server's own close frame is unmasked, so read it back by hand.
  const frame = closeFrame(CLOSE.TOO_BIG, 'x'.repeat(400));
  assert.equal(frame[0] & 0x0f, OPCODES.CLOSE);
  const body = frame.subarray(frame[1] < 126 ? 2 : 4);
  assert.equal(body.readUInt16BE(0), CLOSE.TOO_BIG);
  assert.ok(body.length - 2 <= 120, 'the reason is trimmed to fit a control frame');
  assert.ok(reader);
});

test('an unmasked frame from a client is a protocol error', () => {
  const reader = makeReader();
  const out = readFrames(reader, encodeFrame('a server pretending to be a client'));
  assert.equal(out.error, CLOSE.PROTOCOL);
});

test('a reserved bit means an extension nobody negotiated', () => {
  const frame = clientFrame('compressed?');
  frame[0] |= 0x40;   // RSV1, which permessage-deflate would use
  const out = readFrames(makeReader(), frame);
  assert.equal(out.error, CLOSE.PROTOCOL);
});

test('a frame bigger than the cap is refused before it is buffered', () => {
  const reader = makeReader({ max: 64 });
  const out = readFrames(reader, clientFrame('x'.repeat(200)));
  assert.equal(out.error, CLOSE.TOO_BIG);
  // ...and the same for a message fragmented past the cap, which is the way
  // round somebody would get past a per-frame check.
  const r2 = makeReader({ max: 64 });
  readFrames(r2, clientFrame('x'.repeat(50), OPCODES.TEXT, false));
  const out2 = readFrames(r2, clientFrame('x'.repeat(50), OPCODES.CONT, true));
  assert.equal(out2.error, CLOSE.TOO_BIG);
});

test('a control frame that is fragmented or oversized is a protocol error', () => {
  assert.equal(readFrames(makeReader(), clientFrame('', OPCODES.PING, false)).error, CLOSE.PROTOCOL);
  assert.equal(readFrames(makeReader(), clientFrame('x'.repeat(200), OPCODES.PING)).error,
    CLOSE.PROTOCOL);
});

test('a continuation with nothing to continue, and a data frame interrupting one', () => {
  assert.equal(readFrames(makeReader(), clientFrame('orphan', OPCODES.CONT)).error, CLOSE.PROTOCOL);
  const reader = makeReader();
  readFrames(reader, clientFrame('start', OPCODES.TEXT, false));
  assert.equal(readFrames(reader, clientFrame('interrupt')).error, CLOSE.PROTOCOL);
});

test('an opcode nobody defined is refused rather than relayed', () => {
  assert.equal(readFrames(makeReader(), clientFrame('?', 0x3)).error, CLOSE.PROTOCOL);
});
