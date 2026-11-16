// Hearth's public island, part 2 (C3): the clock, the epochs and the files. Reads the environment of DESIGN-arc-three.md 5.4, keeps the
// anchor and the epoch arithmetic of 5.2, and once a second steps the island to the step the wall clock says it should be on. At every
// epoch (the small hours of an island day) it writes the snapshot as an immutable file, then live.json, then unpacks its own snapshot.
// All writes are temp-then-rename. No HTTP, no dependency. The clock is passed in (`now`) so a test can run it fast.
//
//   HEARTH_DATA   private state: anchor.json and the newest two epoch files   (default ./hearth-data)
//   HEARTH_PUBLIC what the web server serves at /hearth-live/                  (default ./hearth-public)
//   HEARTH_SEED   the first island                                             (default 7)
//   HEARTH_DAY_SECONDS real seconds per island day                             (default 1200)
//   HEARTH_ERA_DAYS    read and published, not acted on: eras are C7
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, codeHash, epochStep, EPOCH_STEPS, DT } from './world.mjs';

export const LIVE_V = 1;
const HOUR = 3600e3, DAY = 86400e3;
const CODE_RECHECK_MS = 30e3;   // a changed script is adopted only if two reads this far apart agree
const SMOKE_STEPS = 200;

function put(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, typeof body === 'string' ? body : JSON.stringify(body));
  fs.renameSync(tmp, file);
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const epochName = (era, n) => `${era}-${n}.json`;
const epochNum = f => { const m = /^(\d+)-(\d+)\.json$/.exec(f); return m ? { era: +m[1], n: +m[2] } : null; };

export function envConfig(env = process.env) {
  return {
    data: env.HEARTH_DATA || './hearth-data', pub: env.HEARTH_PUBLIC || './hearth-public',
    seed: +(env.HEARTH_SEED || 7), daySeconds: +(env.HEARTH_DAY_SECONDS || 1200), eraDays: +(env.HEARTH_ERA_DAYS || 90),
  };
}

// cfg: envConfig(). opts.now: () => wall-clock ms. opts.world: world options (root, after). opts.log: line logger.
export function createLive(cfg, opts = {}) {
  const now = opts.now || Date.now, log = opts.log || (() => {});
  const stepMs = cfg.daySeconds * 1000 / EPOCH_STEPS;
  const era = 0;
  const dataEpoch = n => path.join(cfg.data, 'epoch', epochName(era, n));
  const pubEpoch = n => path.join(cfg.pub, 'epoch', epochName(era, n));
  let world = createWorld(opts.world);
  let anchor = null, epoch = 0, good = null;         // good: the newest snapshot, the one a failure falls back to
  let lastEpochAt = 0, lastHealth = -Infinity, errors = 0, lastError = null, retryAt = 0;
  let adopted = world.code, rejected = null, pending = null, codeRejected = 0;

  const wallOf = step => anchor.at + (step - anchor.step) * stepMs;
  const targetStep = t => anchor.step + Math.max(0, Math.floor((t - anchor.at) / stepMs));

  function liveJson(snap, sum) {
    return {
      v: LIVE_V, era, epoch, clock: anchor, epochSteps: EPOCH_STEPS, dt: DT, saveV: sum.saveV, seed: cfg.seed,
      name: sum.village, day: sum.day, people: sum.people, code: world.code,
    };
  }

  // the code swap of 5.4: only at an epoch, only when two reads 30 s apart saw the same new hash, and only after 200 steps of it ran
  function considerCode(snap, t) {
    const h = codeHash(opts.world && opts.world.root);
    if (h === world.code || h === rejected) { pending = null; return false; }
    if (!pending || pending.h !== h) { pending = { h, at: t }; return false; }
    if (t - pending.at < CODE_RECHECK_MS) return false;
    pending = null;
    try {
      const probe = createWorld(opts.world);          // the new scripts, in a context of their own
      probe.load(snap.save, snap.step);
      probe.stepTo(snap.step + SMOKE_STEPS);
      return true;
    } catch (e) {
      rejected = h; codeRejected++; lastError = `code ${h} rejected: ${e.message}`; log(lastError);
      return false;
    }
  }

  function epochDone(n) {
    const snap = world.snapshot();
    const body = { era, n, step: snap.step, hash: snap.hash, save: snap.save, events: [] };
    put(dataEpoch(n), body); put(pubEpoch(n), body);
    const swap = considerCode(snap, now());
    const sum = world.summary();
    epoch = n; good = snap; lastEpochAt = now();
    put(path.join(cfg.pub, 'live.json'), liveJson(snap, sum));
    const saga = world.saga();
    put(path.join(cfg.pub, 'saga.html'), saga.html); put(path.join(cfg.pub, 'chronicle.txt'), saga.text);
    world.reload(snap, swap);
    if (swap) { adopted = world.code; log(`adopted code ${adopted}`); }
    retention();
  }

  // 5.3: every epoch file for the last 48 hours, then the first of each UTC day. The private folder keeps the newest two.
  function retention() {
    const dir = path.join(cfg.pub, 'epoch'), t = now(), seen = new Set();
    const files = fs.readdirSync(dir).map(f => ({ f, ...epochNum(f) })).filter(x => x.n !== undefined && x.era === era).sort((a, b) => a.n - b.n);
    for (const { f, n } of files) {
      const w = wallOf(epochStep(n)), day = Math.floor(w / DAY);
      if (t - w <= 48 * HOUR || n === epoch) continue;
      if (!seen.has(day)) { seen.add(day); continue; }
      fs.rmSync(path.join(dir, f), { force: true });
    }
    for (const f of fs.readdirSync(path.join(cfg.data, 'epoch'))) {
      const x = epochNum(f);
      if (x && x.era === era && x.n < epoch - 1) fs.rmSync(path.join(cfg.data, 'epoch', f), { force: true });
    }
  }

  function health(t, target) {
    put(path.join(cfg.pub, 'health.json'), { now: t, step: world.step, behind: Math.max(0, target - world.step), lastEpochAt, rssMB: Math.round(process.memoryUsage().rss / 1048576), codeRejected, ok: !lastError, error: lastError });
    lastHealth = t;
  }

  // start: found the island on an empty data folder, or resume from the newest epoch file
  function start() {
    fs.mkdirSync(path.join(cfg.data, 'epoch'), { recursive: true });
    const af = path.join(cfg.data, 'anchor.json');
    const nums = fs.readdirSync(path.join(cfg.data, 'epoch')).map(epochNum).filter(x => x && x.era === era).map(x => x.n).sort((a, b) => a - b);
    if (fs.existsSync(af) && nums.length) {
      anchor = readJson(af);
      const n = nums[nums.length - 1], body = readJson(dataEpoch(n));
      world.load(body.save, body.step); epoch = n; good = { step: body.step, hash: body.hash, save: body.save };
      lastEpochAt = now();
      log(`resumed at epoch ${n}`);
    } else {
      anchor = { at: now(), step: 0, stepMs };
      put(af, anchor);
      world.found(cfg.seed);
      epochDone(0);
      log('founded');
    }
  }

  // one tick: step to the present, handling each epoch crossed on the way
  function tick() {
    const t = now();
    if (t < retryAt) return;
    const target = targetStep(t);
    try {
      while (world.step < target) {
        const next = epochStep(epoch + 1);
        world.stepTo(Math.min(next, target));
        if (world.step === next) epochDone(epoch + 1);
      }
      lastError = null; errors = 0;
    } catch (e) {
      // keep the last good epoch, back off, say so; the island goes back to what the newest epoch file holds
      errors++; lastError = e.message; retryAt = t + Math.min(60e3, 1000 * 2 ** errors);
      log(`step failed: ${e.message}`);
      try { world.reload(good); } catch (e2) { lastError += ' / reload: ' + e2.message; }
    }
    if (t - lastHealth >= 60e3) health(t, target);
  }

  start();
  return { tick, health: () => health(now(), targetStep(now())), get epoch() { return epoch; }, get world() { return world; }, get anchor() { return anchor; }, stepMs };
}

// run as a program: one tick a second
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = envConfig();
  const live = createLive(cfg, { log: s => console.log(new Date().toISOString(), s) });
  setInterval(() => { try { live.tick(); } catch (e) { console.error('tick', e); } }, 1000);
}
