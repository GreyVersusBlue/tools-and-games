// state.js — the foundry's state shape, its validator, its repair pass, and the
// gvb-save slot that ties them together.
//
// Split out of integer-foundry.html for two reasons. One, `repair` and `validate`
// are the parts of a save system worth testing, and a game whose entire engine is
// an IIFE inside one HTML file cannot be tested by anything but a browser. Two,
// the target arithmetic in targets.js has to be reachable from both the loader and
// the simulator, and a shared import is the only way to be sure they agree.
//
// Relative, not "/assets/js/gvb-save.js": test/smoke-state.mjs imports this under
// plain Node, which cannot resolve a site-absolute specifier. The relative form
// resolves identically in the browser.
import { createSaveSlot } from '../../../assets/js/gvb-save.js';
import { rollTarget, boardPlan, isReachable, nearestReachable, MIN_TARGET } from './targets.js';

/** Locked decision #36: this key does not change, ever. */
export const SAVE_KEY = 'integer-foundry-save-v1';

// Still 1. Every field the game has ever written is still written under the same
// name, so there is no drift for `migrate` to undo — saves from before gvb-save
// carry no stamp, `normalize()` reads that as version 0, and `repair` (which runs
// on every load, not just a version change) is what brings them up to date.
export const SAVE_VERSION = 1;

export const BASE_COLS = 8, BASE_ROWS = 6;
export const MAX_DIM = 64;                 // sanity bound on a hand-edited save
export const DIRS = ['N', 'E', 'S', 'W'];
export const TILE_TYPES = ['belt', 'source', 'sink', 'add1', 'sub1', 'mul2', 'div2',
  'merge_add', 'merge_mul', 'split'];
export const UNLOCK_KEYS = ['sub1', 'mul2', 'div2', 'merge_add', 'merge_mul', 'split',
  'sink2', 'sink3', 'grid2', 'grid3', 'fastSource'];

export function emptyCell() {
  return { type: null, dir: 'E', packet: null, mergeBuf: [], sourceTimer: 0, sinkIndex: null };
}

export function makeEmptyGrid(cols, rows) {
  const g = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) row.push(emptyCell());
    g.push(row);
  }
  return g;
}

export function freshState(rand = Math.random) {
  const s = {
    cols: BASE_COLS, rows: BASE_ROWS,
    grid: makeEmptyGrid(BASE_COLS, BASE_ROWS),
    ingots: 0,
    ordersFilled: 0,
    lifetimeIngots: 0,
    prestigeMult: 1,
    prestigeCount: 0,
    unlocked: Object.fromEntries(UNLOCK_KEYS.map(k => [k, false])),
    sourceIntervalTicks: 3,
    sinks: [],
    tool: 'belt',
    lastSave: 0,
    recentIngotsPerSec: 0,
    log: [],
  };
  s.sinks = [{ target: rollTarget(s, rand) }];
  return s;
}

/**
 * Is this plausibly an Integer Foundry save, as opposed to garbage?
 *
 * Deliberately thin. Everything that is merely MISSING is `repair`'s job — the
 * old loader's `Object.assign(freshState(), loaded)` filled top-level gaps and
 * nothing should get stricter than that just because the save now goes through a
 * validator. What this rejects is a blob that was never this game's state at all,
 * which is the case that used to boot the foundry on somebody else's JSON.
 */
export function validState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (!Array.isArray(s.grid)) return false;
  for (const k of ['cols', 'rows', 'ingots', 'lifetimeIngots', 'ordersFilled', 'prestigeMult']) {
    if (s[k] !== undefined && !Number.isFinite(Number(s[k]))) return false;
  }
  return true;
}

// `Number(null)`, `Number('')` and `Number([])` are all 0, so a plain
// `Number.isFinite(Number(v))` quietly turns a missing field into a zero. That is
// the difference between `prestigeMult: null` falling back to 1 and every order
// from then on paying out nothing.
const num = (v, dflt, lo = -Infinity, hi = Infinity) => {
  const n = (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const int = (v, dflt, lo = -Infinity, hi = Infinity) => Math.round(num(v, dflt, lo, hi));

function repairCell(c) {
  const out = emptyCell();
  if (!c || typeof c !== 'object') return out;
  out.type = TILE_TYPES.includes(c.type) ? c.type : null;
  out.dir = DIRS.includes(c.dir) ? c.dir : 'E';
  out.sourceTimer = int(c.sourceTimer, 0, 0, 1e6);
  if (c.packet && Number.isFinite(Number(c.packet.value))) {
    out.packet = { value: int(c.packet.value, 0, 0, Number.MAX_SAFE_INTEGER) };
  }
  if (Array.isArray(c.mergeBuf)) {
    out.mergeBuf = c.mergeBuf.filter(v => Number.isFinite(Number(v))).slice(0, 2).map(Number);
  }
  if (out.type === 'sink') out.sinkIndex = Number.isFinite(Number(c.sinkIndex)) ? int(c.sinkIndex, 0, 0, 999) : null;
  return out;
}

/**
 * Fill in what a save can be missing, and reconcile what it can contradict.
 *
 * Runs on every accepted load through every door — localStorage, an imported
 * file, a save this build wrote thirty seconds ago (locked decision #37).
 *
 * The one that matters is the grid. `cols`/`rows` and the shape of `grid` are two
 * separate records of the same fact, and the old loader checked only that `grid`
 * was non-empty. A save whose `grid` is narrower than `cols` makes `renderGrid`
 * read `state.grid[y][x].type` off `undefined` and the page dies before the first
 * frame; a save whose `grid` is WIDER silently drops the right-hand columns of the
 * player's factory. Growing to whichever is larger and padding to fit loses
 * nothing in either direction, and it matches the only shape change the game makes
 * on its own, which is `growGrid` going one way.
 */
export function repairState(s, rand = Math.random) {
  s.cols = int(s.cols, BASE_COLS, 1, MAX_DIM);
  s.rows = int(s.rows, BASE_ROWS, 1, MAX_DIM);
  s.ingots = num(s.ingots, 0, 0);
  s.lifetimeIngots = num(s.lifetimeIngots, 0, 0);
  s.ordersFilled = int(s.ordersFilled, 0, 0);
  s.prestigeCount = int(s.prestigeCount, 0, 0);
  s.prestigeMult = num(s.prestigeMult, 1, 0);
  s.sourceIntervalTicks = int(s.sourceIntervalTicks, 3, 1, 60);
  s.recentIngotsPerSec = num(s.recentIngotsPerSec, 0, 0);
  s.lastSave = num(s.lastSave, 0, 0);
  if (!Array.isArray(s.log)) s.log = [];
  s.log = s.log.filter(e => e && typeof e.msg === 'string').slice(0, 40);

  // `unlocked` is nested, so the old shallow Object.assign never touched inside
  // it: a save from before an upgrade existed came back with that key undefined.
  const un = (s.unlocked && typeof s.unlocked === 'object') ? s.unlocked : {};
  s.unlocked = Object.fromEntries(UNLOCK_KEYS.map(k => [k, !!un[k]]));

  // ---- grid and its dimensions, reconciled ----
  const rows = Array.isArray(s.grid) ? s.grid.filter(Array.isArray) : [];
  s.rows = Math.min(MAX_DIM, Math.max(s.rows, rows.length, 1));
  s.cols = Math.min(MAX_DIM, Math.max(s.cols, rows.reduce((m, r) => Math.max(m, r.length), 0), 1));
  const grid = [];
  for (let y = 0; y < s.rows; y++) {
    const src = rows[y] || [];
    const row = [];
    for (let x = 0; x < s.cols; x++) row.push(repairCell(src[x]));
    grid.push(row);
  }
  s.grid = grid;

  // ---- sinks ----
  // Every sink tile needs an entry of its own. A missing one shows "NEEDS -" and
  // makes the sink swallow packets in silence (`if(!sink) return`); a shared index
  // gives two sinks one order between them.
  if (!Array.isArray(s.sinks)) s.sinks = [];
  s.sinks = s.sinks.map(k => (k && typeof k === 'object' ? { target: k.target } : { target: undefined }));
  const taken = new Set();
  for (const row of s.grid) {
    for (const c of row) {
      if (c.type !== 'sink') { c.sinkIndex = null; continue; }
      let i = Number.isInteger(c.sinkIndex) && c.sinkIndex >= 0 && !taken.has(c.sinkIndex) ? c.sinkIndex : 0;
      while (taken.has(i)) i++;
      c.sinkIndex = i;
      taken.add(i);
      if (!s.sinks[i]) s.sinks[i] = { target: undefined };
    }
  }
  if (!s.sinks.length) s.sinks = [{ target: undefined }];
  // Assigning past the end above leaves holes, and a hole is not an object.
  for (let i = 0; i < s.sinks.length; i++) {
    if (!s.sinks[i] || typeof s.sinks[i] !== 'object') s.sinks[i] = { target: undefined };
  }

  // Clamp every order into what this board can actually build. A save written
  // before the target generator knew about the board can be carrying an order no
  // layout can fill, and that is the bug this whole change exists to remove — it
  // has to be fixed on load as well as on roll, or an affected save stays stuck.
  const plan = boardPlan(s);
  for (const sink of s.sinks) {
    const t = Math.round(Number(sink.target));
    if (Number.isFinite(t) && isReachable(t, plan)) { sink.target = t; continue; }
    sink.target = Number.isFinite(t) && t >= MIN_TARGET ? nearestReachable(t, plan) : rollTarget(s, rand);
  }

  if (typeof s.tool !== 'string' || !(TILE_TYPES.includes(s.tool) || s.tool === 'erase')) s.tool = 'belt';
  return s;
}

/**
 * The save slot. Pass a storage stub in tests; pass nothing in the game.
 *
 * Nothing else in this project touches `localStorage` directly. Reading the
 * property throws outright in a browser configured to block storage, which is the
 * case gvb-save's memory fallback exists to survive, so let it do the probing and
 * let `slot.memoryOnly` be how the game finds out.
 */
const slots = new WeakMap();
let browserSlot = null;

function buildSlot(storage) {
  return createSaveSlot({
    game: 'integer-foundry',
    key: SAVE_KEY,
    version: SAVE_VERSION,
    storage,
    validate: validState,
    repair: repairState,
    // freshState rolls the first order, so day one cannot be a literal — without
    // a factory here `slot.reset()` hands back null.
    defaults: freshState,
  });
}

export function foundrySlot(storage) {
  if (!storage) return (browserSlot ||= buildSlot(undefined));
  if (!slots.has(storage)) slots.set(storage, buildSlot(storage));
  return slots.get(storage);
}
