// records.js — the optional records on a design, and who owns each.
//
// A design carries a handful of records that belong to a module the loader
// never needed for anything else: `life` is agents.js's, `tours` is tour.js's,
// `timetable`, `rates`, `phasing`, `haunt` and `models` likewise. Until Phase
// 42, save-load.js imported all seven to normalize them on the way in and to
// leave them out on the way out when they were empty — which is how the
// loader came to pin eighty-six kilobytes of crowd simulation and a rate
// table to the first frame of a tool that was only opening its autosave.
//
// This is the registry that replaces those imports. **An owner registers
// itself when it loads**, and from then on the loader normalizes that record
// through it. Before it loads, the record is *carried*: read off the file as
// it came, written back as it came, and never looked inside — the same
// bargain the format has always kept with content it does not understand.
// When the owner does arrive, `adoptRecords` normalizes what was carried,
// and does it once: a value an owner has already read is remembered here and
// not read again, so an adoption is idempotent and cheap enough to run on
// every panel that opens.
//
// What an owner promises: `normalize(raw)` accepts anything (a hostile file,
// `undefined`, last year's shape) and answers a well-formed record, and
// `isEmpty(record)` says whether that record is the default one — the one a
// file does not write, so that a design nobody has touched round-trips as the
// bytes it came in as.
//
// Pure module: no DOM, no imports. Exercised by test/records.test.mjs.

const owners = new Map();
// Records an owner has produced. A WeakSet rather than a flag on the record,
// because a record is the file's data and this is bookkeeping about it.
const settled = new WeakSet();

const isRecord = (v) => v !== null && typeof v === 'object';

// Claim a key. Re-registering the same key replaces the owner — a module
// evaluated twice (two harnesses in one page) is not an error, and the last
// one is the one that is loaded.
export function registerRecord(key, owner) {
  if (typeof key !== 'string' || !key) throw new Error('a record needs a key');
  if (!owner || typeof owner.normalize !== 'function' || typeof owner.isEmpty !== 'function') {
    throw new Error(`the owner of "${key}" needs normalize() and isEmpty()`);
  }
  owners.set(key, { normalize: owner.normalize, isEmpty: owner.isEmpty });
}

export const recordOwner = (key) => owners.get(key) || null;

export const registeredRecords = () => [...owners.keys()];

// One record, read the way the loader reads it. Answers what should go on the
// state — `{ keep: false }` for a record that is absent, unreadable, or the
// default one, `{ keep: true, value }` otherwise — and says whether the
// value was normalized by its owner or carried as it came.
export function readRecord(key, raw) {
  const owner = owners.get(key);
  if (!owner) {
    // Nobody home. Something that could be a record is carried; something
    // that could not (a number, a string, null) is dropped, since carrying
    // it would only hand the owner a value it will discard anyway.
    return isRecord(raw) ? { keep: true, value: raw, carried: true } : { keep: false, carried: true };
  }
  const value = owner.normalize(raw);
  if (owner.isEmpty(value)) return { keep: false, carried: false };
  if (isRecord(value)) settled.add(value);
  return { keep: true, value, carried: false };
}

// Whether a value on a state is one its owner has read. Exposed for the
// suite and for anything that wants to know whether an adoption would do
// anything.
export const isSettled = (value) => isRecord(value) && settled.has(value);

// Every carried record on a state whose owner has since arrived, normalized
// in place — set, or deleted when the owner calls it empty. Answers the keys
// it touched. Records the owner has already read are left alone, which is
// what makes this safe to call as often as a panel opens.
export function adoptRecords(state) {
  const touched = [];
  if (!isRecord(state)) return touched;
  for (const [key] of owners) {
    if (!(key in state)) continue;
    const current = state[key];
    if (isSettled(current)) continue;
    const read = readRecord(key, current);
    if (read.keep) state[key] = read.value; else delete state[key];
    touched.push(key);
  }
  return touched;
}
