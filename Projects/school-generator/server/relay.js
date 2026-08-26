// relay.js — the rooms, and who a frame goes to.
//
// `wire.js` writes the whole contract down in four lines, and this is three
// of them:
//
//   2. Keep the sockets for one room together.
//   3. When a socket sends a text frame, send those exact bytes to every
//      *other* socket in the same room. Do not parse it. Do not store it.
//   4. When a socket closes, forget it.
//
// The first line — accept a WebSocket with `?room=<id>` — is `index.mjs`'s,
// because it needs a socket. What is here is ids and sets, so it is testable
// and so a relay's whole behaviour can be asserted without opening a port.
//
// **It does not parse.** A relay that understood an op would be a relay with
// an opinion about what a design is, and the moment it has one there are two
// codebases that have to agree about the save format instead of one. The two
// caps below are the only judgements it makes, and both of them are about the
// shapes an accident takes rather than about content.
//
// Pure module. Exercised by test/server-relay.test.mjs.

// The same room grammar wire.js validates on the client. Stated here rather
// than imported because a relay must not depend on the tool it relays for —
// somebody should be able to run this next to a copy of the page they have
// never looked inside.
export const validRoom = (room) =>
  typeof room === 'string' && /^[a-z0-9]{4,32}$/.test(room);

// A snapshot is a whole save file (wire.js caps one at 2MB), so the frame cap
// is that plus room for the JSON around it. Past this a sender is not a
// teacher with a big design.
export const MAX_FRAME = 3 * 1024 * 1024;
// Two teachers round one plan is the use case; a class of them is a lecture.
// The cap exists so that a room somebody has posted the link to on the
// internet stops growing rather than becoming a broadcast tower.
export const MAX_PER_ROOM = 16;
// ...and the same rule for the relay as a whole.
export const MAX_ROOMS = 200;

// The room off a request URL. Query string rather than path, because
// `relayURL` puts it there so that "the simplest possible server — one that
// reads `req.url`" can route on it, and this is that server.
export function roomOf(url) {
  const text = String(url || '');
  const q = text.indexOf('?');
  if (q < 0) return '';
  for (const part of text.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== 'room') continue;
    let value = part.slice(eq + 1);
    try { value = decodeURIComponent(value); } catch { return ''; }
    return validRoom(value) ? value : '';
  }
  return '';
}

// The rooms, as ids. Sockets live in `index.mjs`; what is in here is who is
// with whom, which is the only thing a relay actually decides.
export function makeRooms(opts = {}) {
  const maxPerRoom = opts.maxPerRoom ?? MAX_PER_ROOM;
  const maxRooms = opts.maxRooms ?? MAX_ROOMS;
  const rooms = new Map();     // room → Set of member ids
  const where = new Map();     // member id → room

  const api = {
    get rooms() { return rooms.size; },
    get members() { return where.size; },
    count: (room) => (rooms.get(room) ? rooms.get(room).size : 0),
    roomOf: (id) => where.get(id) || '',

    // Let somebody in, or say why not. Three refusals and each of them is a
    // sentence the caller can put in a close frame: a room that is not a
    // room, a room that is full, and a relay that is full.
    join(room, id) {
      if (!validRoom(room)) return { ok: false, why: 'that is not a room id' };
      if (where.has(id)) return { ok: false, why: 'already in a room' };
      let set = rooms.get(room);
      if (!set) {
        if (rooms.size >= maxRooms) return { ok: false, why: 'this relay is full' };
        set = new Set();
        rooms.set(room, set);
      }
      if (set.size >= maxPerRoom) return { ok: false, why: `that session already has ${maxPerRoom} people in it` };
      set.add(id);
      where.set(id, room);
      return { ok: true, room, size: set.size };
    },

    // ...and forget them. A room with nobody in it is deleted rather than
    // kept: the relay "holds nothing after the last of them leaves", and an
    // empty Set left lying about is something held.
    leave(id) {
      const room = where.get(id);
      if (!room) return false;
      where.delete(id);
      const set = rooms.get(room);
      if (!set) return true;
      set.delete(id);
      if (!set.size) rooms.delete(room);
      return true;
    },

    // Everybody in this member's room except this member. The *except* is
    // load-bearing: wire.js filters a self-echo on the way in too, but a
    // relay that echoes is a relay that doubles every op on the way through
    // one client's own undo stack.
    peers(id) {
      const room = where.get(id);
      if (!room) return [];
      const set = rooms.get(room);
      if (!set) return [];
      const out = [];
      for (const other of set) if (other !== id) out.push(other);
      return out;
    },

    // What the relay has to say about itself, for a health check and for a
    // log line. Ids are never in it: whoever runs a relay can see the designs
    // that pass through it — wire.js's panel says so — and there is no reason
    // to make that easier than it already is.
    stats() {
      return { rooms: rooms.size, members: where.size, maxPerRoom, maxRooms };
    },
  };
  return api;
}
