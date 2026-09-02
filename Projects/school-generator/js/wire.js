// wire.js — the pipe a session runs down, and the three things it can be.
//
// session.js decides what an edit *is*; this decides how it gets to the other
// person. The split is the point of the phase: no geometry module changes, and
// the transport is swappable because nothing above it knows which one is
// underneath.
//
// There are three, and they are in the order somebody meets them.
//
// **Loopback** — an in-memory hub. Two ends in one process, which is what the
// suites use and what "a session with yourself" is when there is nobody else.
//
// **Channel** — `BroadcastChannel`, which is platform rather than a
// dependency, and which carries messages between *windows of one browser*.
// That is not a toy: the wishlist's own use case is two teachers round one
// laptop, and two windows side by side on one screen is exactly that, with no
// server, no account, and nothing to take down.
//
// **Socket** — a WebSocket relay, for two teachers in two buildings. This is
// the first thing in the project that needs something running somewhere, and
// what it needs is *very* small — the contract is at the bottom of this file
// and it is one page of anybody's favourite server. Unconfigured, the tool
// says so and behaves exactly as it always has.
//
// The message set is five kinds and no state machine:
//
//   hello   I am here, this is my name and my id block
//   bye     I am going
//   ops     these records changed          (session.js's stamped ops)
//   pres    I am standing here             (presence.js's rounded view)
//   want    I have just arrived, send me the building
//   snap    here is the building           (a save file, plus version map)
//
// Nothing is acknowledged and nothing is retried, which is a decision rather
// than an omission: an op that goes missing is a record that is stale until
// somebody touches it again, and the alternative — sequence numbers, gap
// detection, replay — is the beginning of writing a real protocol. When it
// matters, a joiner asks for a snapshot, and that is the repair mechanism.
//
// No DOM beyond the two platform classes, both injectable. Exercised by
// test/wire.test.mjs.

import { FRAGMENT_KEYS, fragmentValue } from './fragment.js';

export const WIRE_V = 1;
export const KINDS = ['hello', 'bye', 'ops', 'pres', 'want', 'snap'];

// A message with more ops in it than this is not a message, it is a design —
// see session.js's RESYNC_OPS, which is well under it.
const MAX_OPS = 2000;
// A snapshot is a whole save file. Two megabytes carries a school with a
// tracing image in it; past that the sender should be saying so, not trying.
export const MAX_SNAP = 2 * 1024 * 1024;

// ---------- session ids ----------

// A session id is meant to be read down a phone line, so it is lower-case
// letters and digits with the confusable pairs (0/o, 1/l) left out.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function makeRoom(rand = Math.random, len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

export const validRoom = (room) =>
  typeof room === 'string' && /^[a-z0-9]{4,32}$/.test(room);

// ---------- links ----------
//
// A session link is a fragment, for the same reason share.js's is: the part
// of a URL a browser never sends anywhere. `#c=room` for a channel session,
// `#c=room~relay` when there is a relay to point at, url-encoded.

export const SESSION_KEY = FRAGMENT_KEYS.session;

export function sessionFragment(room, relay = '') {
  const body = relay ? `${room}~${encodeURIComponent(relay)}` : String(room);
  return `#${SESSION_KEY}=${body}`;
}

export function readSessionFragment(hash) {
  const value = fragmentValue(hash, SESSION_KEY);
  if (!value) return null;
  const tilde = value.indexOf('~');
  const room = tilde < 0 ? value : value.slice(0, tilde);
  if (!validRoom(room)) return null;
  let relay = '';
  if (tilde >= 0) {
    try { relay = decodeURIComponent(value.slice(tilde + 1)); } catch { relay = ''; }
  }
  return { room, relay };
}

export function sessionURL(href, room, relay = '') {
  const base = String(href || '');
  const cut = base.indexOf('#');
  return `${cut < 0 ? base : base.slice(0, cut)}${sessionFragment(room, relay)}`;
}

// ---------- framing ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function encode(msg) { return JSON.stringify(msg); }

// A message off the wire, or null. Everything that arrives here came from
// somewhere else's memory, so this is the one place that gets to be
// suspicious: kind, room, sender and payload shape are all checked, and a
// message that fails any of them is dropped rather than repaired.
export function decode(raw) {
  let msg = raw;
  if (typeof raw === 'string') {
    try { msg = JSON.parse(raw); } catch { return null; }
  }
  if (!isObj(msg)) return null;
  if (msg.v !== WIRE_V) return null;
  if (!KINDS.includes(msg.k)) return null;
  if (typeof msg.s !== 'string' || !msg.s) return null;
  if (typeof msg.r !== 'string' || !msg.r) return null;
  if (msg.k === 'ops') {
    if (!Array.isArray(msg.ops) || msg.ops.length > MAX_OPS) return null;
    for (const op of msg.ops) {
      if (!isObj(op) || typeof op.k !== 'string') return null;
      if (typeof op.t !== 'number' || !Number.isFinite(op.t)) return null;
    }
  }
  if (msg.k === 'snap') {
    if (typeof msg.design !== 'string' || msg.design.length > MAX_SNAP) return null;
  }
  return msg;
}

export const frame = (room, site, kind, body = {}) =>
  ({ v: WIRE_V, r: room, s: site, k: kind, ...body });

// ---------- the shared half of a transport ----------
//
// Every wire below is "some way of moving a string" plus this: encode on the
// way out, decode and filter on the way in, and never hand back a message
// this tab sent itself. The self-echo filter is not belt-and-braces —
// BroadcastChannel does not echo to the sender but a relay usually does, and
// a session that applies its own ops back onto itself would fight its own
// undo stack.

function makeWire({ kind, room, site, sendRaw, close, isOpen }) {
  let onMessage = () => {};
  let onStatus = () => {};
  const api = {
    kind, room, site,
    get open() { return isOpen(); },
    send(kindName, body) {
      if (!isOpen()) return false;
      try { sendRaw(encode(frame(room, site, kindName, body))); return true; }
      catch { return false; }
    },
    // What a transport calls when a string arrives.
    accept(raw) {
      const msg = decode(raw);
      if (!msg || msg.r !== room || msg.s === site) return null;
      onMessage(msg);
      return msg;
    },
    status(state, note = '') { onStatus(state, note); },
    onMessage(fn) { onMessage = typeof fn === 'function' ? fn : () => {}; },
    onStatus(fn) { onStatus = typeof fn === 'function' ? fn : () => {}; },
    close,
  };
  return api;
}

// ---------- loopback ----------

// An in-memory relay. `hub.join(room, site)` hands back a wire; anything one
// end sends, every other end in the same room receives.
export function makeHub() {
  const ends = new Set();
  return {
    get size() { return ends.size; },
    join(room, site) {
      let open = true;
      const wire = makeWire({
        kind: 'loop', room, site,
        isOpen: () => open,
        sendRaw: (raw) => {
          for (const other of ends) {
            if (other === wire || !other.open) continue;
            other.accept(raw);
          }
        },
        close: () => { open = false; ends.delete(wire); wire.status('closed'); },
      });
      ends.add(wire);
      // Deferred to nobody: the caller wires its handlers up after this
      // returns, so an "open" fired here would be shouted at an empty room.
      // Every transport reports open the same way — when the caller asks it
      // to start.
      wire.start = () => wire.status('open');
      return wire;
    },
  };
}

// ---------- BroadcastChannel ----------

export const canChannel = () => typeof BroadcastChannel === 'function';

export function channelWire(room, site, { Channel } = {}) {
  const Ctor = Channel || (canChannel() ? BroadcastChannel : null);
  if (!Ctor) throw new Error('This browser cannot share between windows');
  const ch = new Ctor(`school-generator:${room}`);
  let open = true;
  const wire = makeWire({
    kind: 'channel', room, site,
    isOpen: () => open,
    sendRaw: (raw) => ch.postMessage(raw),
    close: () => { open = false; try { ch.close(); } catch { /* already gone */ } wire.status('closed'); },
  });
  ch.onmessage = (e) => wire.accept(e && e.data);
  wire.start = () => wire.status('open', 'other windows of this browser');
  return wire;
}

// ---------- WebSocket relay ----------

// How long to wait before trying again, doubling, capped. A relay that is
// down is not an error state the tool has to do anything about — the design
// is on the disk in front of you and every edit still works.
export const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

// The relay URL a room is at. Room in the query string rather than the path so
// the simplest possible server — one that reads `req.url` — can route on it.
export function relayURL(base, room) {
  const url = String(base || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  return `${url}?room=${encodeURIComponent(room)}`;
}

export function socketWire(base, room, site, opts = {}) {
  const Socket = opts.Socket || (typeof WebSocket === 'function' ? WebSocket : null);
  if (!Socket) throw new Error('This browser has no WebSocket');
  const url = relayURL(base, room);
  if (!url) throw new Error('No relay address');
  const timer = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const untimer = opts.clearTimeout || ((h) => clearTimeout(h));

  let sock = null;
  let closed = false;
  let tries = 0;
  let retry = null;
  // Anything said while the socket was down. Bounded, and the bound is the
  // honest one: past a hundred queued messages the other side is better
  // served by a snapshot than by a backlog.
  const queue = [];

  const wire = makeWire({
    kind: 'socket', room, site,
    isOpen: () => !closed,
    sendRaw: (raw) => {
      if (sock && sock.readyState === 1) { sock.send(raw); return; }
      if (queue.length < 100) queue.push(raw);
    },
    close: () => {
      closed = true;
      if (retry !== null) untimer(retry);
      retry = null;
      try { if (sock) sock.close(); } catch { /* already gone */ }
      sock = null;
      wire.status('closed');
    },
  });

  function connect() {
    if (closed) return;
    wire.status('connecting', url);
    try { sock = new Socket(url); } catch { schedule(); return; }
    sock.onopen = () => {
      tries = 0;
      wire.status('open', url);
      while (queue.length) sock.send(queue.shift());
    };
    sock.onmessage = (e) => wire.accept(e && e.data);
    sock.onerror = () => { /* onclose does the work; this only silences it */ };
    sock.onclose = () => { sock = null; schedule(); };
  }

  function schedule() {
    if (closed) return;
    const wait = RETRY_MS[Math.min(tries, RETRY_MS.length - 1)];
    tries++;
    wire.status('waiting', `${Math.round(wait / 1000)}s`);
    retry = timer(connect, wait);
  }

  wire.start = connect;
  // What is waiting for the socket to come back, for the panel to say.
  wire.queued = () => queue.length;
  return wire;
}

// ---------- what a relay has to do ----------
//
// Written down here rather than in a README because the code that talks to it
// is on this page, and because "we will document the protocol later" is how a
// protocol ends up being whatever one client happens to send.
//
//   1. Accept a WebSocket at any path, with `?room=<id>` on the query string.
//   2. Keep the sockets for one room together.
//   3. When a socket sends a text frame, send those exact bytes to every
//      *other* socket in the same room. Do not parse it. Do not store it.
//   4. When a socket closes, forget it.
//
// That is the whole server. It has no idea what a school is, it never sees a
// design unless two people are in a room together, and it holds nothing after
// the last of them leaves. Anything more — history, accounts, presence — is
// this file's job, not its.
//
// The one thing worth adding on the day somebody deploys one: a cap on frame
// size (MAX_SNAP above, plus slack) and a cap on sockets per room, because
// both are the shapes an accident takes.

export const RELAY_CONTRACT = [
  'Accept a WebSocket with ?room=<id>.',
  'Group the sockets in a room.',
  'Repeat each text frame to the other sockets in that room, unparsed.',
  'Forget a socket when it closes.',
];
