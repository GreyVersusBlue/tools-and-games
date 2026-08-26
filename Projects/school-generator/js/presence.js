// presence.js — where everybody else is standing.
//
// The cheapest half of collaboration and most of what makes it *feel* like it
// is working. The wishlist called it nearly free and it very nearly is: the
// crowd already draws bodies, the minimap already draws a cone of view, and a
// peer is a body with a name on it. What this file owns is the bookkeeping
// nobody enjoys writing twice — who is here, when they were last heard from,
// what colour they are, and whether the thing they just did is worth a packet.
//
// Three decisions worth stating.
//
// **Presence is not in the log.** A camera is not an edit: it has no undo, it
// is not saved with the design, and a peer that goes away should leave nothing
// behind. So it travels on its own message kind, out of band, and every peer
// record in here dies of old age (`TTL`) rather than waiting to be told. A
// laptop that closed its lid mid-session drops off the list in three seconds
// without anybody having sent a goodbye.
//
// **A colour belongs to a site, not to a join order.** Hash the site id into
// the palette so somebody who reconnects is the same colour they were, on
// every screen, without a server assigning anything.
//
// **Sending is rate-limited by movement, not by clock alone.** A walkthrough
// camera moves every frame; sixty packets a second per person is absurd for a
// dot on a map. `worthSending` is the whole policy: a foot of travel, three
// degrees of turn, a change of storey or mode, or a heartbeat if none of those
// have happened — and the heartbeat exists only so the TTL above does not
// quietly evict somebody standing still.
//
// Pure module: no DOM, no three.js, no clock of its own — every function that
// needs the time is handed it. Exercised by test/presence.test.mjs.

// How long since we last heard from somebody before they stop being here.
// Three heartbeats, so one dropped packet is not a disappearing teacher.
export const TTL = 9000;         // ms
export const HEARTBEAT = 3000;   // ms

// What counts as having moved, for the purposes of telling anybody.
export const MOVE_FT = 1;
export const TURN_RAD = 3 * Math.PI / 180;

// Eight, distinguishable at the size of a dot on a minimap, and none of them
// the blue the tool already uses for the cursor or the amber it uses for a
// warning.
export const PEER_COLORS = [
  '#e2574c', '#3fa66b', '#8f6ad8', '#d98d1f',
  '#2f8fb3', '#c65fa0', '#6f9c2f', '#b06a3a',
];

export function peerColor(site) {
  let h = 0;
  const text = String(site || '');
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

// A name somebody can be told apart by when they have not typed one. Not
// "Anonymous": a session of three has to be able to say which one moved the
// wall, and the last four of a site id is both stable and short.
export function peerLabel(peer) {
  if (!peer) return 'Someone';
  const name = typeof peer.name === 'string' ? peer.name.trim() : '';
  if (name) return name.slice(0, 24);
  return `Guest ${String(peer.site || '????').slice(-4)}`;
}

const num = (v, dflt = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

// What goes on the wire: a position in world feet, a heading, the storey and
// which of the two modes they are in. Rounded, because a dot on a plan does
// not need seventeen decimal places and the rounding halves the packet.
export function presenceOf(view = {}) {
  return {
    x: Math.round(num(view.x) * 10) / 10,
    z: Math.round(num(view.z) * 10) / 10,
    yaw: Math.round(num(view.yaw) * 1000) / 1000,
    f: Math.max(0, Math.floor(num(view.floor))),
    m: view.mode === 'walk' ? 'walk' : 'plan',
  };
}

// Whether `next` is different enough from the last thing sent to be worth a
// packet. `last` is what was sent, or null if nothing ever was.
export function worthSending(last, next, now, lastAt = 0) {
  if (!last) return true;
  if (last.m !== next.m || last.f !== next.f) return true;
  const dx = next.x - last.x, dz = next.z - last.z;
  if (dx * dx + dz * dz >= MOVE_FT * MOVE_FT) return true;
  let dy = Math.abs(next.yaw - last.yaw) % (Math.PI * 2);
  if (dy > Math.PI) dy = Math.PI * 2 - dy;
  if (dy >= TURN_RAD) return true;
  return now - lastAt >= HEARTBEAT;
}

// ---------- the roster ----------

// Everybody currently in the session, including nobody. The roster is a plain
// object rather than a class because it is read on every frame by the minimap
// and once a second by the panel, and both want a list.
export function createRoster({ ttl = TTL } = {}) {
  const peers = new Map();

  // Somebody said something. `info` is any of name / presence / block; all of
  // them are optional, because a bare hello is enough to appear in the list.
  function see(site, info = {}, now = 0) {
    const key = String(site || '');
    if (!key) return null;
    const peer = peers.get(key) || {
      site: key, name: '', color: peerColor(key), block: null,
      x: 0, z: 0, yaw: 0, f: 0, m: 'plan', seen: now, since: now, moved: false,
    };
    if (typeof info.name === 'string') peer.name = info.name.slice(0, 24);
    if (typeof info.block === 'number') peer.block = info.block;
    if (info.p && typeof info.p === 'object') {
      peer.x = num(info.p.x, peer.x);
      peer.z = num(info.p.z, peer.z);
      peer.yaw = num(info.p.yaw, peer.yaw);
      peer.f = Math.max(0, Math.floor(num(info.p.f, peer.f)));
      peer.m = info.p.m === 'walk' ? 'walk' : 'plan';
      peer.moved = true;
    }
    peer.seen = now;
    peers.set(key, peer);
    return peer;
  }

  function drop(site) { return peers.delete(String(site || '')); }

  // Anybody not heard from inside the TTL. Returns who went, so the shell can
  // say "Sam left" rather than silently shortening a list.
  function prune(now) {
    const gone = [];
    for (const [key, peer] of peers) {
      if (now - peer.seen > ttl) { gone.push(peer); peers.delete(key); }
    }
    return gone;
  }

  return {
    see, drop, prune,
    get size() { return peers.size; },
    has: (site) => peers.has(String(site || '')),
    get: (site) => peers.get(String(site || '')) || null,
    // Oldest first, so the list does not reorder itself while somebody reads
    // it — arrival order is the one ordering nobody finds surprising.
    list: () => [...peers.values()].sort((a, b) => a.since - b.since || (a.site < b.site ? -1 : 1)),
    // Who is on this storey, in the mode that draws them. A peer walking the
    // ground floor is not on the plan of the second, and drawing them there
    // is worse than not drawing them at all.
    onFloor: (f) => [...peers.values()].filter((p) => p.f === f),
    clear: () => peers.clear(),
  };
}

// ---------- what to say about them ----------

// The sentence under the peer list. Deliberately counts *other* people: "3
// others" is what somebody wants to know, "4 people" makes them count
// themselves.
export function describeRoster(list) {
  const n = Array.isArray(list) ? list.length : 0;
  if (!n) return 'Nobody else is here yet.';
  if (n === 1) return `${peerLabel(list[0])} is here.`;
  if (n === 2) return `${peerLabel(list[0])} and ${peerLabel(list[1])} are here.`;
  return `${peerLabel(list[0])} and ${n - 1} others are here.`;
}

// Where a peer is, in words — for the peer list, which has room for one line.
export function describePeer(peer, floorName) {
  if (!peer) return '';
  const where = floorName || `Level ${peer.f + 1}`;
  if (peer.m === 'walk') return `walking ${where}`;
  return `drawing ${where}`;
}
