// hunt.js — the scavenger hunt.
//
// Phase 11's reason for a kid to walk around the building a parent just
// designed. Eight things are hidden in it; the panel says what they are and
// roughly where, the walk says the rest.
//
// This wanted Phase 10's mesh underneath it and now has one, and the
// difference is the whole design of this file. Against the Phase 6 graph a
// room was a *point* — its centroid — so "hidden in the gym" could only ever
// mean "at the exact middle of the gym", which is neither a hiding place nor a
// sentence worth printing. `navmesh.js` hands over the walkable surface as
// rectangles instead, so a hiding place is a property of a piece of floor:
// `nav.mesh[f].byRoom` says what a room is made of, and a corner of one of
// those rectangles is somewhere a person can actually stand.
//
// What is still unsayable is "behind the bleachers", because furniture is not
// in the mesh. What is sayable — and is what the hints below say — is which
// end of which room on which storey, which turns out to be exactly the amount
// of help a hunt wants: enough to send you to the right room, not enough to
// walk you to the spot.
//
// Pure module: no three.js, no DOM, no clock. The caller owns the frame loop
// and hands positions in; everything here is a function of the design, the
// seed and where you are standing.

import { rng } from './agents.js';
import { route } from './navgraph.js';

// How many things are hidden, and the bounds a caller may ask for.
export const DEFAULT_COUNT = 8;
export const MIN_COUNT = 3;
export const MAX_COUNT = 20;

// Close enough to have found it. Generous on purpose: a hunt whose last foot
// is the hard part is a hunt about walking into corners.
export const FIND_R = 3.5;        // ft
// Where a token starts to fade in. Inside this you can see the thing; outside
// it, the hint and the warmth are all you get.
export const REVEAL_R = 15;       // ft
// How far a hidden thing sits in from the edge of its tile — far enough not to
// be inside the wall the tile stops at, near enough to read as "in the corner"
// rather than "in the room".
export const INSET = 1.8;         // ft
// The smallest tile worth hiding something on. Below this the "corner" of it
// is the middle of it, and two hiding places in one small room would sit on
// top of each other.
export const MIN_TILE_SIDE = 5;   // ft
// ...and what one wants out on the site, where the tiles are eight feet across
// and a sixteen-foot walk between two car parks is a piece of ground with two
// ends and no corners. Twenty feet is somewhere you could lose a kickball.
export const MIN_YARD_SIDE = 20;  // ft
// The largest share of a hunt that may be outdoors — see `hidingPlaces`.
export const OUTDOOR_SHARE = 0.25;
// A storey climbed, in feet of apparent distance, for the straight-line
// fallback only. Warmth as a straight line through a slab is a lie the other
// way — without this the thing directly under your feet reads as burning, and
// you spend a minute looking at the floor. Since Phase 24 a caller with a
// navgraph gets the routed answer instead — see `routedDistance` — and this
// constant only speaks when there is no graph to ask.
export const FLOOR_FEET = 26;     // ft
// How coarsely the routed warmth remembers where you are. Rerouting every
// unfound place is an A* apiece, so the reading refreshes when you have moved
// this far rather than every frame — a band's worth of walking, not a frame's.
export const WARMTH_STEP = 4;     // ft

// What is hidden. Nine rows of school lost-property, cycled in seed order, so
// a hunt is a list of *things* rather than a list of numbered markers — "the
// class hamster is in the north-west corner of the Library" is a sentence a
// seven-year-old will act on and "target 3 of 8" is not.
export const HUNT_ITEMS = [
  { key: 'hamster', name: 'the class hamster', icon: '🐹' },
  { key: 'sneaker', name: 'a lost sneaker', icon: '👟' },
  { key: 'lunchbox', name: 'somebody’s lunchbox', icon: '🍱' },
  { key: 'book', name: 'an overdue library book', icon: '📕' },
  { key: 'ball', name: 'a runaway kickball', icon: '⚽' },
  { key: 'trophy', name: 'the missing trophy', icon: '🏆' },
  { key: 'glasses', name: 'a pair of glasses', icon: '👓' },
  { key: 'umbrella', name: 'a forgotten umbrella', icon: '☂️' },
  { key: 'keys', name: 'the janitor’s keys', icon: '🔑' },
];

// How the warmth reads, coldest last. The caller prints `label`; `key` is
// there so a stylesheet can colour it without parsing English.
export const WARMTH_BANDS = [
  { key: 'burning', label: 'Burning', within: 9 },
  { key: 'hot', label: 'Hot', within: 20 },
  { key: 'warm', label: 'Warm', within: 40 },
  { key: 'cool', label: 'Cool', within: 80 },
  { key: 'cold', label: 'Cold', within: 160 },
  { key: 'freezing', label: 'Freezing', within: Infinity },
];

const clampInt = (v, lo, hi, dflt) =>
  (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);

// ---------- where a room is ----------

// The union of a room's tiles. A room is not a rectangle — an L-shaped
// corridor is two of them and a polygon room is a staircase of them — so this
// is the bounding box of the whole set, which is what "the north end of" is
// measured against. A hint that said which end of which *tile* would be
// correct and useless: nobody standing in a room can see where its tiles are.
export function roomBounds(mesh, roomId) {
  const list = (mesh && mesh.byRoom.get(roomId)) || [];
  if (!list.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const t of list) {
    x0 = Math.min(x0, t.x0); z0 = Math.min(z0, t.z0);
    x1 = Math.max(x1, t.x1); z1 = Math.max(z1, t.z1);
  }
  return { x0, z0, x1, z1 };
}

// Which third of the room a point is in, as a phrase. +z is south here, the
// same way round the plan sheet's north arrow has it, so a hint and a printed
// plan never disagree about which end of the gym is which.
export function quadrantOf(bounds, x, z) {
  if (!bounds) return '';
  const w = bounds.x1 - bounds.x0, h = bounds.z1 - bounds.z0;
  const ew = x < bounds.x0 + w / 3 ? 'west' : x > bounds.x1 - w / 3 ? 'east' : '';
  const ns = z < bounds.z0 + h / 3 ? 'north' : z > bounds.z1 - h / 3 ? 'south' : '';
  if (ns && ew) return `${ns}-${ew}`;
  return ns || ew;
}

// The hint itself. Deliberately a place and not a route.
//
// `opts.outdoors` is Phase 17's one change to it: a hiding place on the site
// is on no storey at all, so "on Level 1" would be wrong and a silence would
// send a child indoors to look for it. It says "outside" instead.
export function describePlace(bounds, x, z, roomName, floorIndex, floorCount = 1, opts = {}) {
  const room = roomName || (opts.outdoors ? 'the grounds' : 'an unnamed room');
  const q = quadrantOf(bounds, x, z);
  const where = !q ? `the middle of ${room}`
    : q.includes('-') ? `the ${q} corner of ${room}`
      : `the ${q} end of ${room}`;
  if (opts.outdoors) return `${where}, outside`;
  return floorCount > 1 ? `${where}, on Level ${floorIndex + 1}` : where;
}

// ---------- choosing the places ----------

// The four inset corners of a tile, plus its middle as a last resort. Order is
// fixed; which one gets used comes off the seed, and any of them may be
// refused by `clear` (a corner with a filing cabinet in it is not a hiding
// place, it is a place you cannot reach).
function spotsOn(tile) {
  const ix = Math.min(INSET, (tile.x1 - tile.x0) / 2.5);
  const iz = Math.min(INSET, (tile.z1 - tile.z0) / 2.5);
  return [
    { x: tile.x0 + ix, z: tile.z0 + iz },
    { x: tile.x1 - ix, z: tile.z0 + iz },
    { x: tile.x1 - ix, z: tile.z1 - iz },
    { x: tile.x0 + ix, z: tile.z1 - iz },
    { x: tile.cx, z: tile.cz },
  ];
}

const bigEnough = (t) =>
  t.rect && (t.x1 - t.x0) >= MIN_TILE_SIDE && (t.z1 - t.z0) >= MIN_TILE_SIDE;
const bigEnoughOutside = (t) =>
  t.rect && (t.x1 - t.x0) >= MIN_YARD_SIDE && (t.z1 - t.z0) >= MIN_YARD_SIDE;

// Every room that has somewhere to hide something, biggest tile first within
// each. Rooms rather than tiles is the unit on purpose: eight things in eight
// different rooms is a hunt around a building, and eight things on eight tiles
// of one corridor is a hunt around a corridor.
export function huntCandidates(nav) {
  const out = [];
  const meshes = (nav && nav.mesh) || [];
  for (let f = 0; f < meshes.length; f++) {
    const mesh = meshes[f];
    if (!mesh || !mesh.byRoom) continue;
    for (const [roomId, tiles] of mesh.byRoom) {
      const usable = tiles.filter(bigEnough).sort((a, b) => b.area - a.area);
      if (!usable.length) continue;
      const node = nav.nodes ? nav.nodes.get(roomId) : null;
      out.push({
        floor: f,
        room: roomId,
        name: (node && node.name) || '',
        area: usable.reduce((a, t) => a + t.area, 0),
        tiles: usable,
        bounds: roomBounds(mesh, roomId),
      });
    }
  }
  return [...out, ...yardCandidates(nav)];
}

// ...and the same question asked of the site. Phase 11 could not ask it: the
// mesh covered rooms and the outdoors was one node, so "hidden on the playing
// field" had no place in it to be and no name to be called. `sitemesh.js` cuts
// the ground into tiles the same way, and a *named site region* is exactly the
// unit a hint wants — "the north-east corner of the Playing Field" is a
// sentence a seven-year-old will act on for the same reason "the north-west
// corner of the Library" is.
//
// Unnamed ground is left out on purpose. A hunt that sends somebody to "the
// south end of the lawn" on a nine-acre site is a hunt about wandering.
export function yardCandidates(nav) {
  const yard = nav && nav.yard;
  if (!yard || !yard.tiles.length) return [];
  const byRegion = new Map();
  for (const t of yard.tiles) {
    if (!t.name || !bigEnoughOutside(t)) continue;
    if (!byRegion.has(t.name)) byRegion.set(t.name, []);
    byRegion.get(t.name).push(t);
  }
  const out = [];
  for (const [name, tiles] of byRegion) {
    const usable = tiles.slice().sort((a, b) => b.area - a.area);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const t of usable) {
      x0 = Math.min(x0, t.x0); z0 = Math.min(z0, t.z0);
      x1 = Math.max(x1, t.x1); z1 = Math.max(z1, t.z1);
    }
    out.push({
      floor: 0,
      outdoors: true,
      room: `y:${usable[0].region}`,
      name,
      area: usable.reduce((a, t) => a + t.area, 0),
      tiles: usable,
      bounds: { x0, z0, x1, z1 },
    });
  }
  return out;
}

// Deal `count` hiding places out of those candidates. One per room until the
// rooms run out, then a second pass — a small school with four rooms in it
// still gets a hunt, it is just a hunt with two things in some of the rooms.
//
// `opts.clear(x, z, floor)` is the caller's chance to refuse a spot: pass
// collide.js's resolver and a hiding place will never land inside a bookcase.
// Optional, because a test has no colliders and a small design has no
// furniture.
export function hidingPlaces(nav, opts = {}) {
  const count = clampInt(opts.count, MIN_COUNT, MAX_COUNT, DEFAULT_COUNT);
  const rand = rng(clampInt(opts.seed, 1, 0xffffffff, 1));
  const clear = typeof opts.clear === 'function' ? opts.clear : null;
  // What the hunt deals. The lost-property rows unless the caller brings its
  // own — a single-row list hides `count` of the same thing, which is what a
  // hunt for "the hidden stars" is.
  const items = Array.isArray(opts.items) && opts.items.length ? opts.items : HUNT_ITEMS;
  // `opts.indoors` keeps the whole hunt inside the building — for the caller
  // whose game does not go outside.
  const indoors = opts.indoors === true;
  const floorCount = (nav && nav.mesh && nav.mesh.length) || 1;
  const rooms = huntCandidates(nav);
  if (!rooms.length) return [];
  // Shuffled, but weighted toward the bigger rooms: sort by area and then swap
  // each entry with one a short way ahead of it. Every room still appears
  // exactly once — a hunt that could silently drop a wing would be a hunt you
  // could not finish — but a gym is far likelier to come out near the front
  // than a broom cupboard is, and a hunt around eight broom cupboards is a
  // chore rather than a game.
  const pool = rooms.slice().sort((a, b) => b.area - a.area);
  for (let i = 0; i < pool.length; i++) {
    const j = i + Math.floor(rand() * Math.min(4, pool.length - i));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }

  // How much of a hunt may be outdoors. A playing field is a hundred times the
  // area of a gym, so the area-weighted pool above puts the whole site at the
  // front of it and a hunt sorted honestly is a hunt around a car park. The
  // grounds are *part* of the school rather than most of it, so they get a
  // share of the hunt rather than a place in the queue.
  const outsideCap = Math.max(1, Math.round(count * OUTDOOR_SHARE));
  let outside = 0;

  const places = [];
  const used = new Set();          // "room|x|z", so a second pass can't repeat
  for (let pass = 0; pass < 2 && places.length < count; pass++) {
    for (const r of pool) {
      if (places.length >= count) break;
      if (r.outdoors && (indoors || outside >= outsideCap)) continue;
      const tile = r.tiles[Math.min(pass, r.tiles.length - 1)];
      const spots = spotsOn(tile);
      const start = Math.floor(rand() * spots.length);
      let spot = null;
      for (let k = 0; k < spots.length; k++) {
        const s = spots[(start + k) % spots.length];
        const key = `${r.room}|${s.x.toFixed(2)}|${s.z.toFixed(2)}`;
        if (used.has(key)) continue;
        if (clear && !clear(s.x, s.z, r.floor)) continue;
        used.add(key);
        spot = s;
        break;
      }
      if (!spot) continue;
      if (r.outdoors) outside++;
      const item = items[places.length % items.length];
      places.push({
        id: `h${places.length}`,
        item: item.key,
        name: item.name,
        icon: item.icon,
        floor: r.floor,
        room: r.room,
        roomName: r.name,
        outdoors: !!r.outdoors,
        tile: tile.id,
        x: spot.x,
        z: spot.z,
        hint: describePlace(r.bounds, spot.x, spot.z, r.name, r.floor, floorCount,
          { outdoors: r.outdoors }),
      });
    }
  }
  return places;
}

// ---------- the hunt itself ----------

// Runtime state and nothing else: a seed, the places it dealt, and which of
// them have been found. Never written to a save file — a hunt is something you
// do in a building, not something the building is.
export function startHunt(nav, opts = {}) {
  const seed = clampInt(opts.seed, 1, 0xffffffff, 1);
  return {
    seed,
    places: hidingPlaces(nav, { ...opts, seed }),
    found: new Set(),
    startedAt: opts.now ?? 0,
    endedAt: 0,
  };
}

export const unfound = (hunt) =>
  (hunt ? hunt.places : []).filter((p) => !hunt.found.has(p.id));

// Apparent distance from a point to a place: the plan distance, plus a fixed
// charge per storey between the two. See FLOOR_FEET. This is the answer when
// nobody hands in a graph, and the answer of last resort when a route fails —
// a place the graph cannot reach still deserves a temperature.
export function apparentDistance(place, at) {
  const df = Math.abs((place.floor || 0) - (at.floor || 0));
  return Math.hypot(place.x - at.x, place.z - at.z) + df * FLOOR_FEET;
}

// The same question, walked rather than flown: the length of the route the
// navgraph would take from `at` to the place, in feet of actual corridor and
// stair, plus the last leg across the room the place hides in. This is the
// Phase 24 answer — a thing one wall away reads *warm* through the doorway
// and *cool* around the long way, which is what a temperature is for — and
// the creature's "how close is it really" shares it, so the warmth and the
// dread never disagree about the building.
//
// Distances, not costs. `route`'s waypoints already paid the stair penalties
// and the lift's wait in *cost*; summing the legs in feet is the same route
// measured honestly, per the pathDistance convention.
export function routedDistance(nav, at, place) {
  if (!nav || !place) return apparentDistance(place, at);
  // The graph's outdoors is one node, so a place in the yard has nothing to
  // route *with* — and a yard has no walls for the straight line to lie
  // through. The flight stays the answer out there.
  const toId = place.outdoors ? null : place.room;
  if (!toId) return apparentDistance(place, at);
  const wp = route(nav, at, toId);
  if (!wp) return apparentDistance(place, at);
  // The route ends at the room's own node — the middle of the room — and the
  // place is in a corner of it. Walking to the middle first would charge a
  // detour nobody takes, so the last leg runs from the doorway straight to
  // the place; a route wholly inside one room is just the straight line.
  if (wp.length && wp[wp.length - 1].node === toId) wp.pop();
  let d = 0, px = at.x, pz = at.z;
  for (const w of wp) {
    d += Math.hypot(w.x - px, w.z - pz);
    px = w.x; pz = w.z;
  }
  return d + Math.hypot(place.x - px, place.z - pz);
}

// The nearest thing still hidden, and how near. Null once everything is found.
//
// `opts.nav` routes the answer; without it the straight line stands. The
// caller passes the *same* opts object every frame — the cache lives on it,
// keyed on a WARMTH_STEP-quantised position, so standing still costs nothing
// and walking costs one round of routes per few feet rather than per frame.
export function nearestHidden(hunt, at, opts = {}) {
  const nav = opts.nav || null;
  let dists = null;
  if (nav) {
    const key = `${Math.round(at.x / WARMTH_STEP)},${Math.round(at.z / WARMTH_STEP)},${at.floor || 0}`;
    let c = opts._routed;
    if (!c || c.key !== key) { c = { key, d: new Map() }; opts._routed = c; }
    dists = c.d;
  }
  let best = null, bestD = Infinity;
  for (const p of unfound(hunt)) {
    let d;
    if (dists) {
      d = dists.get(p.id);
      if (d === undefined) { d = routedDistance(nav, at, p); dists.set(p.id, d); }
    } else {
      d = apparentDistance(p, at);
    }
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? { place: best, dist: bestD } : null;
}

export function bandFor(dist) {
  for (const b of WARMTH_BANDS) if (dist <= b.within) return b;
  return WARMTH_BANDS[WARMTH_BANDS.length - 1];
}

// What the panel says while you walk: how close the nearest one is, in words.
export function huntWarmth(hunt, at, opts = {}) {
  const near = nearestHidden(hunt, at, opts);
  if (!near) return null;
  return { ...bandFor(near.dist), dist: near.dist, place: near.place };
}

// Did standing here find anything? Only on the storey the thing is on and only
// within FIND_R of it — being directly above the hamster is not finding the
// hamster. Returns the place found, and marks it, or null.
export function checkFind(hunt, at) {
  if (!hunt) return null;
  for (const p of unfound(hunt)) {
    if (p.floor !== (at.floor || 0)) continue;
    if (Math.hypot(p.x - at.x, p.z - at.z) > FIND_R) continue;
    hunt.found.add(p.id);
    if (hunt.found.size >= hunt.places.length) hunt.endedAt = at.now ?? 0;
    return p;
  }
  return null;
}

// How close a token is to visible, 0 (nothing there) to 1 (right on top of
// it). The renderer fades one in over the last REVEAL_R feet, which is the
// "warmer... warmer..." made visible — and it is per storey for the same
// reason `checkFind` is.
export function revealAt(place, at, radius = REVEAL_R) {
  if (place.floor !== (at.floor || 0)) return 0;
  const d = Math.hypot(place.x - at.x, place.z - at.z);
  if (d >= radius) return 0;
  return Math.min(1, (radius - d) / Math.max(1e-6, radius - FIND_R));
}

export function huntSummary(hunt) {
  const total = hunt ? hunt.places.length : 0;
  const found = hunt ? hunt.found.size : 0;
  return { found, total, done: total > 0 && found >= total };
}

// ---------- late for class (Phase 33) ----------
//
// The scavenger hunt re-aimed the way the haunt already re-aimed it: one
// destination instead of a dealt set, a clock against it instead of a warmth
// band with no stakes. A timetable row hands over a room; the tardy bell
// hands over a deadline; everything that finds it — `routedDistance`,
// `bandFor`, `describePlace`, `roomBounds` — is the same machinery a
// scavenger hunt already trusted, because "how close is the thing I'm
// looking for, and which way" doesn't care whether the thing is hidden or
// merely late.

// A single hiding place, dealt from a *known* room instead of the shuffle —
// the room a timetable row already named, at its biggest walkable tile so
// the door of it is somewhere a person can actually stand rather than a
// centroid nobody drew.
export function classPlace(nav, roomId, opts = {}) {
  const meshes = (nav && nav.mesh) || [];
  for (let f = 0; f < meshes.length; f++) {
    const mesh = meshes[f];
    if (!mesh || !mesh.byRoom || !mesh.byRoom.has(roomId)) continue;
    const tiles = (mesh.byRoom.get(roomId) || []).filter((t) => t.rect);
    if (!tiles.length) return null;
    const tile = tiles.slice().sort((a, b) => b.area - a.area)[0];
    const bounds = roomBounds(mesh, roomId);
    const node = nav.nodes ? nav.nodes.get(roomId) : null;
    const name = (node && node.name) || opts.roomName || '';
    return {
      id: 'late', room: roomId, roomName: name, floor: f, outdoors: false,
      x: tile.cx, z: tile.cz,
      hint: describePlace(bounds, tile.cx, tile.cz, name, f, meshes.length),
    };
  }
  return null;
}

// Runtime state, never saved — the same rule the scavenger hunt follows: this
// is something you do in a building, not something the building is.
// `opts.deadline` is a clock reading in seconds on the walk's own clock (the
// caller's, not this module's — it never starts one), the moment the tardy
// bell rings; `opts.now` is where that clock stands when the row is handed
// over.
export function startLate(nav, roomId, opts = {}) {
  const place = classPlace(nav, roomId, opts);
  if (!place) return null;
  return {
    place,
    roomId,
    deadline: Number.isFinite(opts.deadline) ? opts.deadline : 0,
    startedAt: Number.isFinite(opts.now) ? opts.now : 0,
    arrivedAt: null,
  };
}

// Did standing here get you to class? Only on the room's own storey and only
// within FIND_R of it, same as `checkFind` — and only once, the same way a
// found scavenger item stays found.
export function checkLate(late, at) {
  if (!late || late.arrivedAt != null) return false;
  if (late.place.floor !== (at.floor || 0)) return false;
  if (Math.hypot(late.place.x - at.x, late.place.z - at.z) > FIND_R) return false;
  late.arrivedAt = at.now ?? 0;
  return true;
}

// How close, and how warm — `huntWarmth`'s own shape, for a single place
// instead of the nearest of several. `null` once you have arrived: a warmth
// reading for a bell you already made is not a reading anybody wants.
export function lateWarmth(late, at, opts = {}) {
  if (!late || late.arrivedAt != null) return null;
  const dist = routedDistance(opts.nav || null, at, late.place);
  return { ...bandFor(dist), dist, place: late.place };
}

// Seconds to spare: positive is early, negative is how late you were. `null`
// until you arrive — a score is not a score before the bell has been beaten
// or missed.
export function lateScore(late) {
  if (!late || late.arrivedAt == null) return null;
  return late.deadline - late.arrivedAt;
}

// The line the panel prints once a score exists.
export function lateResult(late) {
  const score = lateScore(late);
  if (score == null) return '';
  if (score >= 0) return `Made it with ${Math.round(score)}s to spare.`;
  return `Late by ${Math.round(-score)}s.`;
}
