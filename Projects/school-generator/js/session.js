// session.js — the design as a log, addressed by record.
//
// Every arc of this project has named collaboration and every arc has been
// right to defer it. Phase 9 made the reason precise: it was never blocked on
// a CRDT library, it was blocked on there being **nothing to name**. A room
// was a set of cells that happened to be connected this frame, so "what
// changed" had no answer smaller than "the floor", and two people editing one
// building could only ever have traded whole buildings.
//
// Phase 12 gave every room, prop, link and tour an id. This file is what that
// unlocked, and it is deliberately the smallest thing that works:
//
//   opsBetween(before, after)   what changed, as a list of records
//   applyOps(design, ops, ver)  those records, onto a design, newest wins
//   createSession({ site })     the clock, the version map and the id block
//
// **A record is the unit.** An op names one record — `room 27`, `prop 41`,
// `design env` — and carries the whole of it. Not a field path, not a
// sub-patch: the entire room, every time. That costs a few hundred bytes per
// edit and buys the conflict rule the wishlist asked for in one sentence:
// *last write wins, per record*. Two people editing one building is the point;
// two people editing the same room in the same second is rare enough that
// losing one of the two edits is a fair price for a rule nobody has to be
// taught. There is no merge UI here and there is not going to be one.
//
// **"Last" is a Lamport clock, not a wall clock.** Two laptops disagree about
// what time it is by whole minutes, and a rule built on `Date.now()` hands the
// building to whichever machine is fast. So every op carries a counter that
// only ever goes up, each side raises its own to whatever it has seen, and a
// tie is broken by site id — which makes the outcome the *same on both sides*
// regardless of what order the messages arrived in. That is the property worth
// having: not that the right person wins, but that both screens agree.
//
// **Ids come in blocks.** `state.nextId` is a single counter, so two peers
// left to themselves both allocate id 27 for different rooms and the log
// quietly merges a chair into a corridor. A site hashes its own id into one of
// 4096 blocks a million ids wide and allocates only from there, so the
// collision moves from "certain within a minute" to "vanishingly unlikely at
// the join", where it is checked for and re-rolled. See `blockOf`.
//
// **Some things are not in the log.** `currentFloor` and `nextId` are on the
// design and are about the *person*, not the building — the storey you are
// looking at and the ids you have left — so they never travel. The tracing
// image and the model library never travel either: they are megabytes and they
// go in a snapshot, once, at the join. And a storey has no id, so adding or
// removing one is not an op at all — it asks for a resync, which is the
// honest answer for the one part of the model Phase 12 did not identify.
//
// Pure module: no DOM, no network, no three.js. The wire is wire.js; what to
// do about a message is main.js. Exercised by test/session.test.mjs.

import { clone, same } from './history.js';

// ---------- what a record is ----------

// The arrays on the design that hold identified records, and what one of their
// members is called in a log line.
export const LISTS = [
  { kind: 'prop', field: 'props' },
  { kind: 'link', field: 'links' },
  { kind: 'tour', field: 'tours' },
];

// The design-wide singletons. Each is one record: change any part of the sun
// and the whole `env` travels, which is a few dozen bytes and means the rule
// above needs no exception.
// Phase 15's timetable joins them as one record rather than one per section:
// a school day is edited wholesale — generated, imported, cleared — and never
// a section at a time, so the record that travels is the whole day. If a
// section ever becomes something a person drags, it becomes a `LISTS` entry
// with ids of its own and this line loses a word.
export const DESIGN_FIELDS = ['env', 'code', 'roof', 'terrain', 'site', 'life', 'timetable'];

// The drawing surface is its own record — the design's w/h and every storey's,
// which Phase 13 made something somebody sets. It is one record rather than
// one per storey because the storeys share a footprint by construction.
export const SHEET = 'sheet';

// Fields that are about the person at the keyboard rather than the building.
export const LOCAL_FIELDS = ['currentFloor', 'nextId', 'version'];

export const recordKey = (kind, id) => `${kind}:${id}`;

// ---------- id blocks ----------

export const BLOCKS = 4096;
export const BLOCK_SIZE = 1000000;

// A site id: twelve hex characters out of whatever randomness the caller has.
// Takes its generator so a test gets the same session twice.
export function makeSite(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

// Which block of a million ids this site allocates from. FNV-1a over the site
// string: any hash would do, the requirement is only that both sides compute
// the same one and that neighbouring site ids do not land in neighbouring
// blocks.
export function blockOf(site) {
  let h = 0x811c9dc5;
  const text = String(site || '');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % BLOCKS;
}

export const idBase = (site) => blockOf(site) * BLOCK_SIZE + 1;

// Move a design's id counter into this site's block, without ever moving it
// backwards — a design that already has ids past the base keeps counting from
// where it was. Returns the counter it left behind.
export function adoptIds(state, site) {
  const base = idBase(site);
  const at = Math.max(1, Math.floor(state.nextId || 1));
  state.nextId = Math.max(at, base);
  return state.nextId;
}

// Two sites in one block would allocate the same ids for different things.
// One in 4096 at the second peer, and the join is where it is caught: the
// later arrival re-rolls rather than the roster having to negotiate anything.
export const blocksClash = (a, b) => a !== b && blockOf(a) === blockOf(b);

// ---------- reading a design as records ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The sheet record: the design's footprint and each storey's.
function sheetOf(design) {
  return {
    w: design.w, h: design.h,
    floors: (design.floors || []).map((f) => ({ w: f.w, h: f.h })),
  };
}

// Every addressable record of a design, keyed. Rooms carry the storey they are
// on; nothing else needs one.
export function recordsOf(design) {
  const out = new Map();
  if (!isObj(design)) return out;
  const floors = Array.isArray(design.floors) ? design.floors : [];
  for (let f = 0; f < floors.length; f++) {
    const shapes = Array.isArray(floors[f].shapes) ? floors[f].shapes : [];
    for (const sh of shapes) {
      if (!sh || !sh.id) continue;
      out.set(recordKey('room', sh.id), { k: 'room', id: sh.id, f, v: sh });
    }
    // Phase 25's free-standing walls (wallrun.js). Per-storey and id-keyed
    // exactly as a room is, so they travel the same way and take the same
    // newest-wins rule — a wall somebody else drew has to reach you, and a
    // record kind this file did not know about would have been silently
    // dropped from every op batch.
    const lines = Array.isArray(floors[f].walls) ? floors[f].walls : [];
    for (const line of lines) {
      if (!line || !line.id) continue;
      out.set(recordKey('wall', line.id), { k: 'wall', id: line.id, f, v: line });
    }
  }
  for (const { kind, field } of LISTS) {
    const list = Array.isArray(design[field]) ? design[field] : [];
    for (const rec of list) {
      if (!rec || !rec.id) continue;
      out.set(recordKey(kind, rec.id), { k: kind, id: rec.id, v: rec });
    }
  }
  for (const field of DESIGN_FIELDS) {
    if (design[field] === undefined) continue;
    out.set(recordKey('design', field), { k: 'design', id: field, v: design[field] });
  }
  out.set(recordKey('design', SHEET), { k: 'design', id: SHEET, v: sheetOf(design) });
  return out;
}

// ---------- the diff, as records ----------

// Past this many changed records, a log line stops being cheaper than the
// building. A generated school is three thousand records; sending it as ops
// would be slower *and* larger than sending it as a file.
export const RESYNC_OPS = 240;

// What changed between two designs, as ops. `resync` means "do not send these,
// send the whole thing" — either because too much moved, or because the number
// of storeys did, which is the one change this file cannot address.
//
// An op is `{ k, id, f?, v }` with `v: null` meaning the record is gone. It is
// not stamped yet: `createSession().emit` does that, because the clock belongs
// to the session rather than to the arithmetic.
export function opsBetween(before, after) {
  const a = recordsOf(before);
  const b = recordsOf(after);
  const beforeFloors = (before && before.floors && before.floors.length) || 0;
  const afterFloors = (after && after.floors && after.floors.length) || 0;
  if (beforeFloors !== afterFloors) {
    return { ops: [], resync: true, reason: 'the number of storeys changed' };
  }
  const ops = [];
  for (const [key, rec] of b) {
    const was = a.get(key);
    // A room that moved storeys is a changed record even if its outline is
    // identical, which is why the floor is compared as well as the value.
    if (was && was.f === rec.f && same(was.v, rec.v)) continue;
    const op = { k: rec.k, id: rec.id, v: clone(rec.v) };
    if (rec.k === 'room' || rec.k === 'wall') op.f = rec.f;
    ops.push(op);
  }
  for (const [key, rec] of a) {
    if (b.has(key)) continue;
    const op = { k: rec.k, id: rec.id, v: null };
    if (rec.k === 'room' || rec.k === 'wall') op.f = rec.f;
    ops.push(op);
  }
  if (ops.length > RESYNC_OPS) {
    return { ops: [], resync: true, reason: `${ops.length} records changed at once` };
  }
  return { ops, resync: false, reason: '' };
}

// ---------- applying one ----------

// Where a record with this id currently sits, or null.
function findIn(list, id) {
  if (!Array.isArray(list)) return -1;
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return i;
  return -1;
}

// A record that lives on one storey: a room (`shapes`) or a free-standing wall
// (`walls`). One function for both, because "which storey is it on" is the
// only thing either of them needs beyond an id.
function applyOnFloor(design, op, field) {
  const floors = Array.isArray(design.floors) ? design.floors : [];
  let moved = false;
  // Off whatever storey it is on now — which is how a room that has been
  // dragged to another level travels as one record rather than as a delete
  // and an add that can arrive in either order.
  for (let f = 0; f < floors.length; f++) {
    const at = findIn(floors[f][field], op.id);
    if (at < 0) continue;
    if (op.v && f === op.f) {
      floors[f][field][at] = clone(op.v);
      return true;
    }
    floors[f][field].splice(at, 1);
    // A storey with no free-standing walls left carries no key, so it writes
    // none — the promise save-load.js keeps for the same array.
    if (field === 'walls' && !floors[f].walls.length) delete floors[f].walls;
    moved = true;
  }
  if (!op.v) return moved;
  const f = Math.max(0, Math.min(floors.length - 1, Math.floor(op.f || 0)));
  if (!floors[f]) return moved;
  if (!Array.isArray(floors[f][field])) floors[f][field] = [];
  floors[f][field].push(clone(op.v));
  return true;
}

function applyList(design, op, field) {
  if (!Array.isArray(design[field])) design[field] = [];
  const list = design[field];
  const at = findIn(list, op.id);
  if (!op.v) {
    if (at < 0) return false;
    list.splice(at, 1);
    return true;
  }
  if (at < 0) list.push(clone(op.v));
  else list[at] = clone(op.v);
  return true;
}

// The sheet record puts the footprint back on the design and on every storey.
// It never adds or removes a storey: a count that disagrees is a resync's job,
// and quietly growing the floors array here would produce a level with no
// rooms on it and no way to say where it came from.
function applySheet(design, v) {
  if (!isObj(v)) return false;
  let changed = false;
  if (typeof v.w === 'number' && v.w !== design.w) { design.w = v.w; changed = true; }
  if (typeof v.h === 'number' && v.h !== design.h) { design.h = v.h; changed = true; }
  const floors = Array.isArray(design.floors) ? design.floors : [];
  const list = Array.isArray(v.floors) ? v.floors : [];
  for (let i = 0; i < Math.min(floors.length, list.length); i++) {
    const f = list[i];
    if (!isObj(f)) continue;
    if (typeof f.w === 'number' && f.w !== floors[i].w) { floors[i].w = f.w; changed = true; }
    if (typeof f.h === 'number' && f.h !== floors[i].h) { floors[i].h = f.h; changed = true; }
  }
  return changed;
}

function applyDesignField(design, op) {
  if (op.id === SHEET) return applySheet(design, op.v);
  if (!DESIGN_FIELDS.includes(op.id)) return false;
  if (op.v === null || op.v === undefined) {
    if (design[op.id] === undefined) return false;
    delete design[op.id];
    return true;
  }
  if (same(design[op.id], op.v)) return false;
  design[op.id] = clone(op.v);
  return true;
}

// One op onto a design, in place. Returns whether anything moved.
export function applyOp(design, op) {
  if (!isObj(design) || !isObj(op)) return false;
  if (op.k === 'room') return applyOnFloor(design, op, 'shapes');
  if (op.k === 'wall') return applyOnFloor(design, op, 'walls');
  if (op.k === 'design') return applyDesignField(design, op);
  const list = LISTS.find((l) => l.kind === op.k);
  if (!list) return false;
  return applyList(design, op, list.field);
}

// ---------- the conflict rule ----------

// Whether `stamp` is newer than what the version map holds for `key`. The tie
// break on site id is what makes two machines that saw the same two ops in
// opposite orders end up with the same room.
export function beats(versions, key, stamp) {
  const held = versions[key];
  if (!held) return true;
  if (stamp.t !== held.t) return stamp.t > held.t;
  return String(stamp.site) > String(held.site);
}

// A batch of stamped ops onto a design, newest-per-record winning. Mutates
// both the design and the version map, and reports what it did — the counts
// are what the status line says out loud, because an edit arriving from
// somebody else and changing your screen should never be silent.
export function applyOps(design, ops, versions = {}) {
  const out = { applied: 0, dropped: 0, changed: false, kinds: {} };
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!isObj(op) || !op.k) continue;
    const key = recordKey(op.k, op.id);
    const stamp = { t: Math.floor(op.t || 0), site: op.site || '' };
    if (!beats(versions, key, stamp)) { out.dropped++; continue; }
    versions[key] = stamp;
    const moved = applyOp(design, op);
    out.applied++;
    out.kinds[op.k] = (out.kinds[op.k] || 0) + 1;
    if (moved) out.changed = true;
  }
  return out;
}

// The version map a design starts a session with: everything it already has,
// stamped at zero by nobody, so the first op about any record wins.
export function baseVersions(design) {
  const out = {};
  for (const key of recordsOf(design).keys()) out[key] = { t: 0, site: '' };
  return out;
}

// ---------- what somebody did, in a sentence ----------

const KIND_WORDS = {
  room: ['room', 'rooms'],
  prop: ['object', 'objects'],
  link: ['stair', 'stairs'],
  tour: ['tour', 'tours'],
  design: ['setting', 'settings'],
};

export function describeOps(ops) {
  const counts = {};
  for (const op of Array.isArray(ops) ? ops : []) {
    counts[op.k] = (counts[op.k] || 0) + 1;
  }
  const parts = [];
  for (const k of Object.keys(counts)) {
    const words = KIND_WORDS[k] || [k, `${k}s`];
    const n = counts[k];
    parts.push(`${n} ${n === 1 ? words[0] : words[1]}`);
  }
  if (!parts.length) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ---------- the session ----------

export const MAX_LOG = 500;

// The per-tab half of a session: who this is, what it has seen, and the two
// verbs the shell drives it with.
//
//   emit(before, after)  a local edit, out
//   receive(design, ops) somebody else's edit, in
//
// Neither one knows about a socket. The session is the rule; wire.js is the
// pipe; main.js is what to do when something arrives.
export function createSession({ site, name = '', room = '' } = {}) {
  const id = site || makeSite();
  const versions = {};
  const log = [];
  let clock = 0;
  let sent = 0;
  let got = 0;

  // Stamp an op with this site's next tick. Every op in one edit shares a
  // tick: they happened together, and giving them one number is what makes a
  // whole gesture win or lose as a unit.
  function stamp(ops, t) {
    return ops.map((op) => ({ ...op, site: id, t }));
  }

  function remember(entry) {
    log.push(entry);
    if (log.length > MAX_LOG) log.shift();
  }

  return {
    site: id,
    name,
    room,
    get clock() { return clock; },
    get versions() { return versions; },
    get log() { return log.slice(); },
    get sentOps() { return sent; },
    get gotOps() { return got; },
    idBase: idBase(id),

    // A local edit. Returns what to put on the wire — `resync` means the
    // caller should send a snapshot instead, and the session has recorded
    // nothing, because a snapshot is not a set of records anybody can win.
    emit(before, after) {
      const { ops, resync, reason } = opsBetween(before, after);
      if (resync) return { ops: [], resync: true, reason };
      if (!ops.length) return { ops: [], resync: false, reason: '' };
      const t = ++clock;
      const stamped = stamp(ops, t);
      for (const op of stamped) versions[recordKey(op.k, op.id)] = { t, site: id };
      sent += stamped.length;
      remember({ dir: 'out', t, site: id, n: stamped.length, what: describeOps(stamped) });
      return { ops: stamped, resync: false, reason: '' };
    },

    // Somebody else's edit, onto a design. The clock moves up to whatever the
    // sender had seen first, so the next thing done here is unambiguously
    // after it.
    receive(design, ops) {
      const list = Array.isArray(ops) ? ops : [];
      for (const op of list) clock = Math.max(clock, Math.floor(op.t || 0));
      const res = applyOps(design, list, versions);
      got += res.applied;
      if (res.applied) {
        remember({
          dir: 'in', t: clock, site: list[0] ? list[0].site : '',
          n: res.applied, what: describeOps(list),
        });
      }
      return res;
    },

    // What a joiner is handed: the design is the caller's business (it is a
    // save file), this is the bookkeeping that goes with it.
    snapshotMeta() {
      return { clock, versions: clone(versions) };
    },

    // ...and what a joiner does with it. Taking the sender's clock and version
    // map wholesale is right: the joiner has no history of its own worth
    // keeping, and starting from zero would let a stale op win.
    adoptMeta(meta) {
      if (!isObj(meta)) return;
      clock = Math.max(clock, Math.floor(meta.clock || 0));
      if (isObj(meta.versions)) {
        for (const key of Object.keys(meta.versions)) {
          const v = meta.versions[key];
          if (!isObj(v)) continue;
          const stampV = { t: Math.floor(v.t || 0), site: v.site || '' };
          if (beats(versions, key, stampV)) versions[key] = stampV;
        }
      }
    },

    // Everything this design already has, stamped at zero, so the first thing
    // anybody says about a record wins. Called when a session opens around a
    // design that was drawn before it.
    baseline(design) {
      const base = baseVersions(design);
      for (const key of Object.keys(base)) if (!versions[key]) versions[key] = base[key];
    },
  };
}
