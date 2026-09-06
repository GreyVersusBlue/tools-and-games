// inspect.js — everything authoring.html knows about a pack that is not the
// validator, kept out of the page so `test/smoke.mjs` can drive all of it.
//
// The tool's whole promise is "paste a pack, find out what is wrong with it
// before a player does", and three of the four things it says come from here:
// where in the pasted text an error lives, which keys the engine will silently
// ignore, and what the pack actually contains. The fourth is `Validator`, which
// this file does not wrap or reimplement — the page calls it directly, because
// a second opinion about the contract is exactly the drift Phase 8 exists to
// stop.
//
// Nothing here touches the DOM and nothing imports the page, so every function
// below is a plain-Node assertion in smoke.mjs.

import { SCHEMA } from "./schema.js";
import { dryRun, encountersStarted } from "./registry.js";

/* ---------- 1. where a message points ---------- */

/**
 * Every double-quoted string in the raw text, with the line it first appears on
 * and how many times it appears in all.
 *
 * The count is the whole trick. A validator message quotes several names —
 * `Adventure "thornwake": scene "start" needs "text" as an array` — and the one
 * worth jumping to is the rarest, because an id occurs once or twice and a
 * field name like `text` occurs sixty times. Picking the first quoted token
 * would land an author on line 4 of a 900-line file every time.
 */
export function lineIndex(text) {
  const idx = new Map();
  const lines = String(text).split("\n");
  lines.forEach((line, i) => {
    // Deliberately not a JSON parse: the point of this index is to work on text
    // that does not parse yet.
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(line))) {
      let raw;
      try { raw = JSON.parse(`"${m[1]}"`); } catch (e) { raw = m[1]; }
      const seen = idx.get(raw);
      if (seen) seen.count++;
      else idx.set(raw, { line: i + 1, count: 1 });
    }
  });
  return idx;
}

/** The quoted tokens in a validator message, in the order they appear. */
export function quotedIn(message) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(String(message)))) out.push(m[1]);
  return out;
}

/**
 * The line one validator message is about, or null when nothing in it names
 * anything in the text. Rarest quoted token wins; a tie goes to the last one,
 * because the messages read outer-to-inner and the inner name is the specific
 * one.
 */
export function lineFor(message, idx) {
  let best = null;
  quotedIn(message).forEach(tok => {
    const hit = idx.get(tok);
    if (!hit) return;
    if (!best || hit.count <= best.count) best = hit;
  });
  return best ? best.line : null;
}

/* ---------- 2. JSON that does not parse yet ---------- */

/**
 * Parse pasted text, and on failure say which line rather than which byte.
 *
 * Node and Chrome both put a line and column in the message now, and older
 * engines put a character offset; both forms are read, and a message with
 * neither still gets a line by counting the offset ourselves when there is one.
 */
export function parsePack(text) {
  try { return { ok: true, pack: JSON.parse(text) }; }
  catch (e) {
    const msg = String(e.message);
    const lc = msg.match(/line (\d+) column (\d+)/);
    if (lc) return { ok: false, message: msg, line: Number(lc[1]), column: Number(lc[2]) };
    const pos = msg.match(/position (\d+)/);
    if (pos) {
      const at = Math.min(Number(pos[1]), String(text).length);
      const before = String(text).slice(0, at).split("\n");
      return { ok: false, message: msg, line: before.length, column: before[before.length - 1].length + 1 };
    }
    return { ok: false, message: msg, line: null, column: null };
  }
}

/* ---------- 3. keys the engine will ignore ---------- */

const deref = node => (node && node.$ref ? SCHEMA.$defs[node.$ref.split("/").pop()] : node);

/**
 * Every key in the pack that no `$defs` entry lists, with the path it sits at.
 *
 * These are **not** errors. Guide §1 makes unknown fields harmless on purpose —
 * that is what lets a pack carry notes, and what lets the engine grow a field
 * without rejecting older packs. They are the single most common way a pack
 * looks finished and does nothing: `"tratis"` for `"traits"`, `"dmg"` for
 * `"damage"`, a `"heal"` written on the monster instead of on the ability. The
 * validator cannot report them without breaking the promise; a tool the author
 * runs on purpose can.
 *
 * A key starting with `_` is a deliberate comment and is never reported —
 * `packs/index.json` has used `_comment` since the shelf shipped.
 */
export function unknownFields(pack) {
  const out = [];
  const walk = (value, node, path) => {
    const def = deref(node);
    if (!def || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (def.type === "array" && def.items) value.forEach((v, i) => walk(v, def.items, `${path}[${i}]`));
      return;
    }
    const props = def.properties || null;
    const extra = def.additionalProperties;
    Object.keys(value).forEach(k => {
      if (k.startsWith("_")) return;
      const child = props && Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null;
      if (child) { walk(value[k], child, path ? `${path}.${k}` : k); return; }
      if (extra && typeof extra === "object") { walk(value[k], extra, path ? `${path}.${k}` : k); return; }
      if (props) out.push({ path: path ? `${path}.${k}` : k, key: k, near: nearestField(k, Object.keys(props)) });
    });
  };
  walk(pack, SCHEMA, "");
  return out;
}

/**
 * The field this one is probably a typo of, or null.
 *
 * One insertion, one deletion, one substitution or one swap of neighbours —
 * the validator's opener rule plus the transposition, because `tratis` for
 * `traits` is the single most common way a hand-typed key goes wrong and a rule
 * without it misses exactly that. Two characters out is a different word, and a
 * tool that guesses further starts suggesting `hp` for `hex`.
 */
export function nearestField(wrote, fields) {
  const a = String(wrote).toLowerCase();
  return fields.find(f => oneSlipApart(a, f.toLowerCase())) || null;
}

function oneSlipApart(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  // The swap: one pair of neighbours out of order, everything else identical.
  if (a.length === b.length) {
    const at = [];
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) at.push(k);
    if (at.length === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]]) return true;
  }
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/* ---------- 4. what the pack contains, and where it goes ---------- */

/** One row per non-empty collection: the count, and the names in it. */
export function summarize(pack) {
  const rows = [];
  Object.keys(SCHEMA.properties).forEach(key => {
    if (key === "pack") return;
    const list = pack && pack[key];
    if (!Array.isArray(list) || !list.length) return;
    rows.push({ collection: key, count: list.length, names: list.map(o => (o && (o.name || o.id)) || "?") });
  });
  return rows;
}

/**
 * The dry run: every adventure in the pack walked from its start scene, with
 * the pack's own encounter usage folded in so a fight one adventure defines and
 * another starts does not read as dead content.
 */
export function dryRunPack(pack) {
  const started = [];
  ((pack && pack.adventures) || []).forEach(a => encountersStarted(a).forEach(id => { if (!started.includes(id)) started.push(id); }));
  return ((pack && pack.adventures) || []).map(a => ({ id: a.id, name: a.name, ...dryRun(a, started) }));
}
