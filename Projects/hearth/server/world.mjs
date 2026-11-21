// Hearth's public island, part 1 (C3): the real game as a program. This wraps the same loader the tests use (test/load.mjs, #816) and
// offers what a server needs and nothing else: found, load, stepTo, snapshot, reload, saga, summary. There is no second implementation
// of anything; the island in here is the island a visitor's browser would grow, and its state is the real save (pack through lzEnc).
// Node 22, no dependency, no HTTP.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHearth, ORDER } from '../test/load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAME_ROOT = path.join(HERE, '..');
export const DT = 0.05;
export const BATCH = 2800;            // one island day of steps: the most one runInContext call is asked to do
export const BATCH_MS = 20000;        // and the most it may take before the vm gives up on it
export const EPOCH_STEPS = 2800;
export const FIRST_EPOCH_STEP = 2240; // newWorld starts the clock at dayLen*.22; the small hours of day 2 are 112 s on, at .05 a step
export const epochStep = n => n === 0 ? 0 : FIRST_EPOCH_STEP + EPOCH_STEPS * (n - 1);

// FNV-1a over the JSON, written the way the harness writes it: hex of the hash, a colon, the length.
export function fnv(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16) + ':' + s.length;
}

// FNV of the game's own script text, in load order: what the server compares to know the checkout has changed.
export function codeHash(root = GAME_ROOT) {
  let h = 2166136261 >>> 0;
  for (const f of ORDER) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 255; h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

// opts.root: the game's folder (default this checkout). opts.after: source run in every fresh context after the scripts load; the
// tests use it to make a step throw.
export function createWorld(opts = {}) {
  const root = opts.root || GAME_ROOT;
  let g = null, gstep = 0, loadedCode = null;
  const run = code => vm.runInContext(code, g.ctx, { timeout: BATCH_MS });
  const fresh = () => {
    loadedCode = codeHash(root);
    g = loadHearth({ root, globals: { btoa, atob }, after: opts.after });
  };
  fresh();
  const world = {
    get step() { return gstep; },
    // run source in the game's context and hand back what it evaluates to (era.mjs reads and edits the island this way)
    run,
    get code() { return loadedCode; },
    // a new island at this seed; global step 0
    found(seed) { g.H.newWorld(seed >>> 0); gstep = 0; },
    // the island in a save string, standing at global step `step`
    load(save, step = 0) {
      const o = JSON.parse(g.H.lzDec(save));
      if (!g.H.canLoad(o)) throw new Error('canLoad refused the save');
      g.H.unpack(o); gstep = step;
    },
    // step() at the fixed dt to this global step, at most one island day per call into the vm. A throw leaves the island part-stepped
    // and gstep behind what happened, so the caller must reload a good snapshot rather than go on.
    stepTo(target) {
      while (gstep < target) {
        const n = Math.min(BATCH, target - gstep);
        run(`for(let i=0;i<${n};i++)step(${DT})`);
        gstep += n;
      }
    },
    // the island as a record: the JSON (hash is of this), the compressed string a share link carries, and where it stands
    snapshot() {
      const json = JSON.stringify(g.H.pack());
      return { step: gstep, hash: fnv(json), save: g.H.lzEnc(json), raw: json.length };
    },
    // unpack the island's own snapshot, so the server's island is at every epoch the island anybody gets by loading that file. With
    // `newCode` it builds a new context from the scripts on disk first (the snapshot goes through migrate there); without it the
    // scripts already loaded stay, even when the files on disk have moved on: adopting new code is the caller's decision (live.mjs).
    reload(snap, newCode) {
      if (newCode) fresh();
      world.load(snap.save, snap.step);
    },
    // true when the scripts on disk are not the ones loaded
    codeChanged() { return codeHash(root) !== loadedCode; },
    saga() {
      return {
        html: g.H.sagaHTML(),
        // exportChron hands its text to dlFile (a download); this catches the text instead, inside the context only
        text: run(`(()=>{let out='';const d=dlFile;dlFile=b=>{out=b};try{exportChron()}finally{dlFile=d}return out})()`),
      };
    },
    summary() {
      return run(`({seed,village:village||null,day:dayCount,year:yearOf(dayCount),yearName:yearName(yearOf(dayCount)),people:people.length,saveV:SAVE_V})`);
    },
  };
  return world;
}
