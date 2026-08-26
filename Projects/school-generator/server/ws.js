// ws.js — RFC 6455, the small half of it.
//
// `wire.js` says what a relay has to do in four lines and calls it "one page
// of anybody's favourite server". It is, once there is a WebSocket to relay
// over — and getting one without a dependency is this file. Nothing here
// knows what a school is or what a room is; it turns an HTTP upgrade into a
// socket and a stream of bytes into a list of messages.
//
// **What is implemented, deliberately:** the handshake, text and binary
// frames, fragmentation (a browser is entitled to split a two-megabyte
// snapshot and some do), close, ping and pong. **What is not:** extensions.
// `permessage-deflate` is not negotiated, which is allowed — a server that
// offers no extensions gets none — and it costs a snapshot its compression.
// A relay that held one open connection per teacher and compressed nothing is
// the right trade for a file this size; a relay with a thousand of them is a
// different program.
//
// Pure module: no sockets in it. `index.mjs` owns those, this owns the bytes.
// Exercised by test/server-ws.test.mjs.

import { createHash, randomBytes } from 'node:crypto';

// The magic string from the RFC. It is not a secret and it is not a
// parameter; it exists so that a proxy which has cached an ordinary GET
// cannot be made to look like a WebSocket server.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODES = {
  CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa,
};

// Close codes this file ever sends. 1009 is the one that matters — it is what
// a relay says to a client that has tried to push a design through it that is
// bigger than the relay is willing to carry.
export const CLOSE = {
  NORMAL: 1000, GOING_AWAY: 1001, PROTOCOL: 1002, UNSUPPORTED: 1003,
  TOO_BIG: 1009, INTERNAL: 1011,
};

export const acceptKey = (key) =>
  createHash('sha1').update(String(key) + GUID).digest('base64');

export const clientKey = () => randomBytes(16).toString('base64');

// Is this request an upgrade to a WebSocket, and is it one we can answer?
// Header names arrive lower-cased from node's parser; the *values* are the
// client's, so `connection` is matched loosely (it is a comma list, and
// "keep-alive, Upgrade" is a real thing browsers send through proxies).
export function checkUpgrade(headers = {}) {
  const get = (k) => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    return typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : '';
  };
  if (get('upgrade').toLowerCase() !== 'websocket') {
    return { ok: false, status: 400, reason: 'not a websocket upgrade' };
  }
  if (!/(^|,)\s*upgrade\s*(,|$)/i.test(get('connection'))) {
    return { ok: false, status: 400, reason: 'no upgrade in connection' };
  }
  const key = get('sec-websocket-key');
  if (!key) return { ok: false, status: 400, reason: 'no key' };
  // Version 13 is the only one any browser has spoken for a decade. The RFC's
  // answer to any other is to say which one you do speak, so that is what the
  // caller is handed back rather than a flat refusal.
  const version = get('sec-websocket-version');
  if (version && version !== '13') {
    return { ok: false, status: 426, reason: 'unsupported version', version: '13' };
  }
  return { ok: true, key, accept: acceptKey(key) };
}

// The bytes that answer a good upgrade. No `Sec-WebSocket-Protocol` back,
// because none was asked for by anything this relay talks to, and echoing a
// subprotocol you have not implemented is how a client ends up waiting for a
// framing you are not using.
export const handshakeResponse = (accept) => [
  'HTTP/1.1 101 Switching Protocols',
  'Upgrade: websocket',
  'Connection: Upgrade',
  `Sec-WebSocket-Accept: ${accept}`,
  '', '',
].join('\r\n');

export const refuseResponse = (status, reason, extra = '') =>
  [`HTTP/1.1 ${status} ${reason}`, extra, 'Connection: close', '', '']
    .filter((line, i) => line !== '' || i >= 3).join('\r\n');

// ---------- frames out ----------

// One frame, server to client, unmasked — a server never masks, and a client
// that receives a masked frame is required to hang up on it.
export function encodeFrame(payload, opcode = OPCODES.TEXT) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // 64-bit length. A payload past 2^53 is not a thing this process could
    // have in memory, so the high word is written as zero rather than as a
    // BigInt dance.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | (opcode & 0x0f);   // FIN, one frame
  return Buffer.concat([header, body]);
}

// A close frame carries a two-byte code and an optional reason, and both are
// optional in the RFC — an empty close is a legal close.
export function closeFrame(code = CLOSE.NORMAL, reason = '') {
  if (!code) return encodeFrame(Buffer.alloc(0), OPCODES.CLOSE);
  const text = Buffer.from(String(reason).slice(0, 120), 'utf8');
  const body = Buffer.alloc(2 + text.length);
  body.writeUInt16BE(code, 0);
  text.copy(body, 2);
  return encodeFrame(body, OPCODES.CLOSE);
}

// ---------- frames in ----------

// A reader is one socket's worth of state: the bytes that have arrived and
// not yet made a whole frame, and the fragments of a message that is still
// being delivered in pieces.
export function makeReader(opts = {}) {
  return {
    // The cap is the honest one to enforce here rather than upstream: a
    // sender that is thirty megabytes into a frame header claiming ninety is
    // not a peer with a big design, it is an accident or worse, and the point
    // of the cap is to stop buffering it rather than to reject it at the end.
    max: opts.max ?? 4 * 1024 * 1024,
    buf: Buffer.alloc(0),
    frag: null,   // { opcode, parts, len } while a fragmented message is arriving
  };
}

// Feed bytes in, get whole messages out. Returns
// `{ messages, control, error }` — `messages` are complete text/binary
// payloads, `control` are close/ping/pong the caller has to answer, and
// `error` is a close code when the stream stopped making sense, after which
// the caller should hang up rather than read any more.
export function readFrames(reader, chunk) {
  const messages = [];
  const control = [];
  reader.buf = reader.buf.length ? Buffer.concat([reader.buf, chunk]) : Buffer.from(chunk);

  for (;;) {
    const buf = reader.buf;
    if (buf.length < 2) break;
    const fin = (buf[0] & 0x80) !== 0;
    const rsv = buf[0] & 0x70;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;

    // No extensions were negotiated, so a reserved bit set is a peer using a
    // framing this file does not implement — which is a protocol error rather
    // than something to guess at.
    if (rsv) return { messages, control, error: CLOSE.PROTOCOL };
    // Every frame from a client must be masked. An unmasked one is either a
    // server talking to a server or something that is not a WebSocket at all.
    if (!masked) return { messages, control, error: CLOSE.PROTOCOL };

    if (len === 126) {
      if (buf.length < off + 2) break;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (buf.length < off + 8) break;
      const hi = buf.readUInt32BE(off);
      const lo = buf.readUInt32BE(off + 4);
      // 2^32 bytes is four gigabytes. Nothing this relay carries is in that
      // conversation, and a length that says so is refused before a single
      // byte of it is kept.
      if (hi !== 0) return { messages, control, error: CLOSE.TOO_BIG };
      len = lo;
      off += 8;
    }
    if (len > reader.max) return { messages, control, error: CLOSE.TOO_BIG };

    const isControl = (opcode & 0x8) !== 0;
    // Control frames are never fragmented and never longer than 125 bytes.
    if (isControl && (!fin || len > 125)) {
      return { messages, control, error: CLOSE.PROTOCOL };
    }

    if (buf.length < off + 4 + len) break;   // the mask plus the payload
    const mask = buf.subarray(off, off + 4);
    const payload = Buffer.allocUnsafe(len);
    buf.copy(payload, 0, off + 4, off + 4 + len);
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    reader.buf = buf.subarray(off + 4 + len);

    if (isControl) {
      control.push({ opcode, payload });
      continue;
    }

    if (opcode === OPCODES.CONT) {
      if (!reader.frag) return { messages, control, error: CLOSE.PROTOCOL };
      reader.frag.len += len;
      if (reader.frag.len > reader.max) return { messages, control, error: CLOSE.TOO_BIG };
      reader.frag.parts.push(payload);
      if (fin) {
        messages.push({ opcode: reader.frag.opcode, payload: Buffer.concat(reader.frag.parts) });
        reader.frag = null;
      }
      continue;
    }

    if (opcode !== OPCODES.TEXT && opcode !== OPCODES.BINARY) {
      return { messages, control, error: CLOSE.PROTOCOL };
    }
    // A new data frame while one is still being assembled is a peer that has
    // lost track of its own message boundaries.
    if (reader.frag) return { messages, control, error: CLOSE.PROTOCOL };
    if (fin) { messages.push({ opcode, payload }); continue; }
    reader.frag = { opcode, parts: [payload], len };
  }

  return { messages, control, error: null };
}

// The code inside a close frame, or a plain normal close when it carried
// nothing — which is legal and which a browser does on an ordinary reload.
export const closeCodeOf = (payload) =>
  (payload && payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE.NORMAL);
