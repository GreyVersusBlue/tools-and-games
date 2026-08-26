// index.mjs — the thing that was missing.
//
// The wishlist has said the same sentence since Phase 14 and it was the last
// one on either of the first two lists: **no server ships.** `cloud.js` and
// `wire.js` are both client halves plus a written contract, and until there
// is an address to type into the Server box a session reaches the other
// windows of one browser and a design stays in this browser and its files.
//
// This is the other half of both contracts, in one process, with no
// dependencies — the store over HTTP and the relay over a WebSocket, because
// `cloud.js` guesses the relay is the same host with `ws://` and `/relay` on
// the end, and somebody who has typed one address should not have to type a
// second.
//
// **It is deliberately small and it is deliberately dull.** The relay does
// not parse what it carries, the store does not know what a school is, and
// neither of them has an account in it. Everything either of them decides is
// in `store.js` and `relay.js`, which are pure and tested; what is here is
// sockets, disk and the order things happen in.
//
//   node server/index.mjs --port 8787 --dir ./data
//
// ...and then, in the tool's Cloud panel: `http://localhost:8787` as the
// store and `ws://localhost:8787/relay` as the relay, which is the address it
// will offer you anyway.
//
// **What running one means, said plainly, because the panel says it too:**
// whoever runs a relay sees the designs that pass through it, and anybody
// with a store link can read that design. Making either private needs
// accounts, which is a different project.
//
// Exercised end to end by test/server.test.mjs — which boots this, drives it
// through cloud.js's own four calls and wire.js's own socket transport, and
// asserts against the clients rather than against a curl.

import { createServer as createHTTP } from 'node:http';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { decide, corsHeaders, MAX_BYTES } from './store.js';
import { makeRooms, roomOf, MAX_FRAME } from './relay.js';
import {
  OPCODES, CLOSE, checkUpgrade, handshakeResponse, refuseResponse,
  encodeFrame, closeFrame, makeReader, readFrames, closeCodeOf,
} from './ws.js';

// Where the relay lives, when it lives beside the store. Any path works —
// `wire.js` says "accept a WebSocket at any path" — but this is the one
// `impliedRelay()` guesses, so it is the one that works with nothing typed.
const RELAY_PATH = '/relay';

// How long a socket may go quiet before it is checked on, and how long it has
// to answer. A relay whose clients are laptops learns quickly that a laptop
// that has been shut does not send a close frame.
const PING_MS = 30000;
const PONG_GRACE_MS = 15000;

export function createServer(opts = {}) {
  const dir = resolve(opts.dir || './data');
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const note = opts.note || '';
  const log = opts.log === false ? () => {} : (opts.log || ((...a) => console.log(...a)));
  const rooms = makeRooms(opts);
  const maxFrame = opts.maxFrame ?? MAX_FRAME;

  // Every live socket, by the id `relay.js` knows it as. The relay holds ids;
  // this holds the things ids point at, which is the whole of the split.
  const sockets = new Map();
  // ...and every socket this process has taken off the HTTP server, whether
  // or not it got a room. An upgraded socket is no longer the http server's
  // to close — including one that was refused and is being politely told so —
  // so shutting down means closing these by hand or not at all.
  const raw = new Set();

  // ---------- the store, on disk ----------
  //
  // One design is two files: the save file itself, served back byte for byte,
  // and the write key beside it. Two files rather than one wrapper object so
  // that a GET is a read and not a parse — a ten-megabyte design should not
  // have to be understood in order to be handed over.
  const designPath = (id) => join(dir, `${id}.json`);
  const keyPath = (id) => join(dir, `${id}.key`);

  async function known(id) {
    try {
      const [key, info] = await Promise.all([readFile(keyPath(id), 'utf8'), stat(designPath(id))]);
      return { key: key.trim(), bytes: info.size, at: info.mtimeMs };
    } catch { return null; }
  }

  // Written to a temporary name and renamed into place, so that a PUT which
  // dies halfway leaves the previous design where it was rather than half of
  // a new one. The key goes down first: a design with no key beside it would
  // be claimable by the next person to PUT it.
  async function put(id, key, body) {
    const tmp = join(dir, `.${id}.${randomUUID()}.tmp`);
    await writeFile(keyPath(id), key, 'utf8');
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, designPath(id));
  }

  async function drop(id) {
    await Promise.allSettled([unlink(designPath(id)), unlink(keyPath(id))]);
  }

  // ---------- the store, over HTTP ----------

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...corsHeaders(), ...headers });
    res.end(body);
  };
  const sendJSON = (res, status, obj) =>
    send(res, status, JSON.stringify(obj), { 'content-type': 'application/json' });

  async function readBody(req, limit) {
    return new Promise((ok, no) => {
      let bytes = 0;
      const parts = [];
      req.on('data', (chunk) => {
        bytes += chunk.length;
        // Stop reading rather than read it all and then refuse it: the cap is
        // there to protect the process, and a process that buffers a hundred
        // megabytes before saying no is not protected.
        if (bytes > limit) { no(Object.assign(new Error('too large'), { tooLarge: true })); return; }
        parts.push(chunk);
      });
      req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
      req.on('error', no);
    });
  }

  const http = createHTTP(async (req, res) => {
    try {
      // The body first, because `decide` needs its size and its shape to
      // answer a PUT — and only for the methods that have one.
      let body = '';
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          body = await readBody(req, maxBytes + 1024);
        } catch (err) {
          if (err && err.tooLarge) {
            sendJSON(res, 413, { error: `past the ${maxBytes} bytes this store takes` });
            return;
          }
          throw err;
        }
      }
      const bytes = Buffer.byteLength(body, 'utf8');
      const id = /^\/d\/([a-z0-9]{6,40})$/.exec(String(req.url).split('?')[0] || '');
      const record = id ? await known(id[1]) : null;
      const answer = decide({ method: req.method, url: req.url, bytes, body }, record,
        { maxBytes, note });

      if (answer.preflight) { send(res, 204, ''); return; }
      if (answer.json) { sendJSON(res, answer.status, answer.json); return; }

      if (answer.action === 'read') {
        const text = await readFile(designPath(answer.id), 'utf8');
        send(res, 200, req.method === 'HEAD' ? '' : text, {
          'content-type': 'application/json',
          // A design at an id is not the same design tomorrow — the whole
          // point is that somebody edits it — so it is never cached.
          'cache-control': 'no-store',
        });
        return;
      }
      if (answer.action === 'write') {
        await put(answer.id, answer.key, body);
        log(`${answer.claimed ? 'claimed' : 'stored'} ${answer.id} (${bytes} bytes)`);
        sendJSON(res, answer.status, { ok: true, id: answer.id, bytes });
        return;
      }
      if (answer.action === 'delete') {
        await drop(answer.id);
        log(`forgot ${answer.id}`);
        sendJSON(res, 200, { ok: true, id: answer.id });
        return;
      }
      sendJSON(res, answer.status, { error: answer.error || 'no' });
    } catch (err) {
      log('store error', err && err.message);
      // The message is not sent on. A store that reports its own stack traces
      // to the internet is telling somebody where its files are.
      sendJSON(res, 500, { error: 'the store failed to answer' });
    }
  });

  // ---------- the relay, over a WebSocket ----------

  http.on('upgrade', (req, socket) => {
    raw.add(socket);
    socket.once('close', () => raw.delete(socket));
    const path = String(req.url || '').split('?')[0];
    // Any path is allowed by the contract; this one refuses everything but
    // the relay's, so that a stray upgrade to `/d/xyz` is a mistake somebody
    // is told about rather than a session in a room called nothing.
    if (path !== RELAY_PATH && path !== '/') {
      socket.end(refuseResponse(404, 'Not Found'));
      return;
    }
    const up = checkUpgrade(req.headers);
    if (!up.ok) {
      socket.end(refuseResponse(up.status, up.reason,
        up.version ? `Sec-WebSocket-Version: ${up.version}` : ''));
      return;
    }
    const room = roomOf(req.url);
    if (!room) { socket.end(refuseResponse(400, 'Bad Request')); return; }

    const id = randomUUID();
    const joined = rooms.join(room, id);
    socket.write(handshakeResponse(up.accept));
    // Refused *after* the handshake rather than instead of it, so the client
    // is told why in a close frame it can read. A raw TCP hang-up at this
    // point is indistinguishable from the relay being down, and wire.js would
    // reconnect into it every second for the rest of the afternoon.
    if (!joined.ok) {
      socket.end(closeFrame(CLOSE.GOING_AWAY, joined.why));
      return;
    }

    const reader = makeReader({ max: maxFrame });
    const peer = { id, socket, alive: true, waitingSince: 0 };
    sockets.set(id, peer);
    socket.setNoDelay(true);
    log(`joined ${room} (${rooms.count(room)} in it)`);

    const shut = (code, why = '') => {
      if (!sockets.has(id)) return;
      sockets.delete(id);
      rooms.leave(id);
      try { socket.end(closeFrame(code, why)); } catch { /* already gone */ }
      try { socket.destroy(); } catch { /* already gone */ }
    };

    socket.on('data', (chunk) => {
      const out = readFrames(reader, chunk);
      for (const c of out.control) {
        if (c.opcode === OPCODES.CLOSE) { shut(closeCodeOf(c.payload)); return; }
        if (c.opcode === OPCODES.PING) {
          try { socket.write(encodeFrame(c.payload, OPCODES.PONG)); } catch { /* gone */ }
        }
        if (c.opcode === OPCODES.PONG) { peer.alive = true; peer.waitingSince = 0; }
      }
      // **Repeat, unparsed.** The bytes that arrived are the bytes that go
      // out. This is the line the whole relay is, and the temptation to look
      // inside one is the temptation to have an opinion about a save format
      // in a second codebase.
      for (const msg of out.messages) {
        const frame = encodeFrame(msg.payload, msg.opcode);
        for (const other of rooms.peers(id)) {
          const to = sockets.get(other);
          if (!to) continue;
          try { to.socket.write(frame); } catch { /* it will close itself */ }
        }
      }
      if (out.error) shut(out.error, 'bad frame');
    });

    socket.on('error', () => shut(CLOSE.INTERNAL));
    socket.on('close', () => {
      if (!sockets.has(id)) return;
      sockets.delete(id);
      rooms.leave(id);
      log(`left ${room} (${rooms.count(room)} left)`);
    });
  });

  // A laptop that has been shut does not send a close frame, so a room can
  // fill up with people who left hours ago — and the cap on a room is what
  // stops the people who are actually there from getting in.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const peer of [...sockets.values()]) {
      if (peer.waitingSince && now - peer.waitingSince > PONG_GRACE_MS) {
        sockets.delete(peer.id);
        rooms.leave(peer.id);
        try { peer.socket.destroy(); } catch { /* gone */ }
        continue;
      }
      if (peer.waitingSince) continue;
      peer.waitingSince = now;
      try { peer.socket.write(encodeFrame(Buffer.alloc(0), OPCODES.PING)); }
      catch { /* the close handler will do the rest */ }
    }
  }, PING_MS);
  // Nothing should be kept alive by a heartbeat, least of all a test process.
  if (heartbeat.unref) heartbeat.unref();

  return {
    http,
    rooms,
    dir,
    async listen(port = 8787, host = '0.0.0.0') {
      await mkdir(dir, { recursive: true });
      await new Promise((ok) => http.listen(port, host, ok));
      const at = http.address();
      log(`school-generator store on http://${host}:${at.port}`);
      log(`school-generator relay on ws://${host}:${at.port}${RELAY_PATH}`);
      log(`designs in ${dir}`);
      return at.port;
    },
    async close() {
      clearInterval(heartbeat);
      for (const peer of sockets.values()) {
        try { peer.socket.end(closeFrame(CLOSE.GOING_AWAY, 'the relay is stopping')); }
        catch { /* gone */ }
      }
      sockets.clear();
      // Then every socket, told or not. A socket waits for the other end to
      // hang up too and the other end is somebody's laptop, so a shutdown
      // that waits politely does not finish.
      for (const socket of raw) {
        try { socket.destroy(); } catch { /* gone */ }
      }
      raw.clear();
      if (http.closeAllConnections) http.closeAllConnections();
      await new Promise((ok) => http.close(ok));
    },
  };
}

// ---------- run it ----------

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Only when this file is what was run, so importing it in a test starts
// nothing.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  const server = createServer({
    dir: argOf('dir', './data'),
    note: argOf('note', ''),
    maxBytes: Number(argOf('max-bytes', MAX_BYTES)) || MAX_BYTES,
  });
  await server.listen(Number(argOf('port', 8787)), argOf('host', '0.0.0.0'));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { server.close().then(() => process.exit(0)); });
  }
}
