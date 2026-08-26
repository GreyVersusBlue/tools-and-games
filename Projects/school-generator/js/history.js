// history.js — an undo step as a list of changes, not a copy of the design.
//
// Undo has been a JSON clone since arc one, and the v1 retrospective named it
// as the arithmetic that would bend first: a hundred deep, on a design with a
// few thousand props in it, the history is a hundred copies of the building.
// It survived this long because there was nothing to name. A grid room was a
// set of cells that happened to be connected this frame, so "what changed" had
// no answer smaller than "the floor". Phase 12 gave every room an id, and with
// that the question has one.
//
// So this module is the smallest honest thing that answers it: a **structural
// diff of two JSON values**, and the patch that turns one into the other.
//
//   diff(a, b)          what would have to change to make `a` into `b`,
//                       or undefined if nothing would
//   apply(a, patch)     `a` with those changes made — a new value, sharing
//                       nothing with either input
//   patchSize(patch)    how many leaves it touches, for anything that wants
//                       to say how big the history is
//
// Three notes on the shape of it.
//
// **A patch is data, not code.** It is plain JSON: an editor can keep a
// hundred of them, and Phase 13's session log can put one on a wire without
// this file knowing that is what happened to it.
//
// **`apply` copies.** Sharing an untouched subtree with the value it came from
// would be faster and would be a bug here: the editor hands what comes back to
// the live state and the tools then mutate it in place, which would rewrite the
// history that produced it. One deep copy per undo is a price paid once per
// keystroke, not once per edit.
//
// **Arrays diff by index.** A room list where one room changed is one changed
// index; a props array with one prop spliced out of the middle re-states
// everything after it. That is the right trade for this model — rooms, props
// and links are appended far more often than they are inserted — and it is
// where to look first if a delta ever comes out surprisingly large.
//
// Pure module: no three.js, no DOM. Exercised by test/history.test.mjs.

// A key that says "this was deleted" without colliding with a value.
const DEL = { del: true };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out;
  }
  return v;
}

// Deep equality over JSON values. Cheaper than stringifying both sides,
// because it stops at the first difference — which for an undo step is
// usually the first room it looks at.
export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k) || !same(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

// ---------- the diff ----------

// What would have to change to turn `a` into `b`, or undefined if nothing
// would. A patch is one of:
//
//   { set: v }                 replace outright
//   { obj: { key: node|DEL } } an object, key by key
//   { arr: { len, at: {...} } } an array, index by index, with its new length
export function diff(a, b) {
  if (same(a, b)) return undefined;

  if (Array.isArray(a) && Array.isArray(b)) {
    const at = {};
    let touched = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const node = diff(a[i], b[i]);
      if (node !== undefined) { at[i] = node; touched++; }
    }
    for (let i = n; i < b.length; i++) { at[i] = { set: clone(b[i]) }; touched++; }
    // An array rewritten end to end is smaller said outright than said
    // index by index, and much easier to read in a log.
    if (touched > b.length * 0.6 && b.length > 4) return { set: clone(b) };
    return { arr: { len: b.length, at } };
  }

  if (isObj(a) && isObj(b)) {
    const obj = {};
    for (const k of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) { obj[k] = { set: clone(b[k]) }; continue; }
      const node = diff(a[k], b[k]);
      if (node !== undefined) obj[k] = node;
    }
    for (const k of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) obj[k] = DEL;
    }
    return Object.keys(obj).length ? { obj } : undefined;
  }

  return { set: clone(b) };
}

// ---------- applying one ----------

export function apply(a, patch) {
  if (patch === undefined) return clone(a);
  if (patch.set !== undefined) return clone(patch.set);

  if (patch.arr) {
    const src = Array.isArray(a) ? a : [];
    const out = [];
    for (let i = 0; i < patch.arr.len; i++) {
      const node = patch.arr.at[i];
      out.push(node === undefined ? clone(src[i]) : apply(src[i], node));
    }
    return out;
  }

  if (patch.obj) {
    const src = isObj(a) ? a : {};
    const out = {};
    for (const k of Object.keys(src)) {
      const node = patch.obj[k];
      if (node === DEL) continue;
      out[k] = node === undefined ? clone(src[k]) : apply(src[k], node);
    }
    for (const k of Object.keys(patch.obj)) {
      const node = patch.obj[k];
      if (node === DEL || Object.prototype.hasOwnProperty.call(out, k)) continue;
      out[k] = apply(undefined, node);
    }
    return out;
  }

  return clone(a);
}

// How many leaves a patch touches — what an undo step actually costs, as
// opposed to what the design costs.
export function patchSize(patch) {
  if (patch === undefined) return 0;
  if (patch.set !== undefined) return 1;
  let n = 0;
  if (patch.arr) for (const k of Object.keys(patch.arr.at)) n += patchSize(patch.arr.at[k]);
  if (patch.obj) {
    for (const k of Object.keys(patch.obj)) {
      n += patch.obj[k] === DEL ? 1 : patchSize(patch.obj[k]);
    }
  }
  return n || 1;
}

// Both directions of one edit, which is what an undo stack actually wants:
// `back` returns the design to how it was, `fwd` puts the edit back. Null when
// nothing changed at all, so a gesture that did nothing costs no history.
export function step(before, after) {
  const fwd = diff(before, after);
  if (fwd === undefined) return null;
  return { fwd, back: diff(after, before), size: patchSize(fwd) };
}
