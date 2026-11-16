// Hearth's public island, the server (C3): server/world.mjs and server/live.mjs run on a fake clock and a scratch folder. Node only.
//
//   node server.mjs          (from Projects/hearth/test; about two minutes)
//
// The question is whether the island on the server is a function of the clock and nothing else: a restart changes nothing, a long
// absence is caught up to the same island a second-by-second run reaches, a failing step costs nothing already written, and what is
// published is the real save format. Real time never enters: `now` is a number the test owns.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLive, envConfig } from '../server/live.mjs';
import { fnv, epochStep, codeHash, GAME_ROOT } from '../server/world.mjs';
import { loadHearth } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${!ok && detail !== undefined ? '  -> ' + detail : ''}`); };

// scratch folders go under ~/.cache, not /tmp (RAM on the build machine);
// a fresh CI runner has no ~/.cache yet, so make it first
fs.mkdirSync(path.join(os.homedir(), '.cache'), { recursive: true });
const SCRATCH = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'hearth-server-test-'));
process.on('exit', () => fs.rmSync(SCRATCH, { recursive: true, force: true }));
let nf = 0;
function folder(daySeconds = 1200) {
  const d = path.join(SCRATCH, 'r' + nf++);
  return envConfig({ HEARTH_DATA: path.join(d, 'data'), HEARTH_PUBLIC: path.join(d, 'pub'), HEARTH_SEED: '7', HEARTH_DAY_SECONDS: String(daySeconds) });
}
const DAYMS = 1200e3;
const T0 = Date.UTC(2026, 0, 1);
const clock = t0 => { const c = { t: t0, now: () => c.t }; return c; };
const epochs = cfg => fs.readdirSync(path.join(cfg.pub, 'epoch')).map(f => +/^0-(\d+)\.json$/.exec(f)[1]).sort((a, b) => a - b);
const readEpoch = (cfg, n) => JSON.parse(fs.readFileSync(path.join(cfg.pub, 'epoch', `0-${n}.json`), 'utf8'));
const readPub = (cfg, f) => JSON.parse(fs.readFileSync(path.join(cfg.pub, f), 'utf8'));
// advance the clock to `to` in steps of `by` ms, ticking at each
function run(live, c, to, by = 1000) { while (c.t < to) { c.t = Math.min(to, c.t + by); live.tick(); } }

console.log('server.mjs: the island as a program');

// (1) the founding and three island days
{
  const cfg = folder(), c = clock(T0), live = createLive(cfg, { now: c.now });
  run(live, c, T0 + 3 * DAYMS);
  const e = epochs(cfg), steps = e.map(n => readEpoch(cfg, n).step);
  check('(1) epochs 0 to 3 are on disk', JSON.stringify(e) === '[0,1,2,3]', JSON.stringify(e));
  check('(1) their steps are 0, 2240, 5040, 7840', JSON.stringify(steps) === '[0,2240,5040,7840]', JSON.stringify(steps));
  const lj = readPub(cfg, 'live.json');
  check('(1) live.json names epoch 3 and the clock', lj.epoch === 3 && lj.clock.at === T0 && lj.epochSteps === 2800 && lj.dt === 0.05 && lj.seed === 7 && lj.saveV >= 17, JSON.stringify(lj));
  check('(1) saga.html, chronicle.txt and health.json are there', ['saga.html', 'chronicle.txt', 'health.json'].every(f => fs.existsSync(path.join(cfg.pub, f))));
  check('(1) no temp file is left behind', ![cfg.pub, path.join(cfg.pub, 'epoch'), cfg.data, path.join(cfg.data, 'epoch')].some(d => fs.readdirSync(d).some(f => f.includes('.tmp-'))));
}

// (2) restart is invisible: kill after two days, start again on the same folders
{
  const A = folder(), ca = clock(T0), la = createLive(A, { now: ca.now });
  run(la, ca, T0 + 5 * DAYMS);
  const B = folder(), cb = clock(T0);
  let lb = createLive(B, { now: cb.now });
  run(lb, cb, T0 + 2 * DAYMS);
  lb = null;                                   // dropped: nothing of it survives but the files
  lb = createLive(B, { now: cb.now });
  run(lb, cb, T0 + 5 * DAYMS);
  const ha = readEpoch(A, 5).hash, hb = readEpoch(B, 5).hash;
  check('(2) restart is invisible: epoch 5 is the same island straight through or killed after two days', ha === hb, `${ha} vs ${hb}`);
}

// (3) catch-up: thirty days in one tick against thirty days a second at a time
let C30;
{
  const A = folder(), ca = clock(T0), la = createLive(A, { now: ca.now });
  ca.t = T0 + 30 * DAYMS; la.tick();
  const B = folder(), cb = clock(T0), lb = createLive(B, { now: cb.now });
  run(lb, cb, T0 + 30 * DAYMS);
  const want = Array.from({ length: 31 }, (_, i) => i);
  check('(3) catch-up wrote every epoch file, 0 to 30', JSON.stringify(epochs(A)) === JSON.stringify(want) || epochs(A).length >= 31 && epochs(A).slice(0, 31).join() === want.join(), epochs(A).join());
  const ha = readEpoch(A, 30).hash, hb = readEpoch(B, 30).hash;
  check('(3) the catch-up epoch 30 is the second-by-second epoch 30', ha === hb, `${ha} vs ${hb}`);
  C30 = B;
}

// (4) a step that throws leaves the last good epoch, says so, and the process lives
{
  const cfg = folder(), c = clock(T0);
  const after = 'const _s=step;step=function(dt){if(dayCount>=3)throw new Error("boom on day 3");return _s(dt)}';
  const live = createLive(cfg, { now: c.now, world: { after } });
  let threw = null;
  try { run(live, c, T0 + 3 * DAYMS, 30e3); } catch (e) { threw = e; }
  const h = readPub(cfg, 'health.json');
  check('(4) the failing step does not escape the tick', threw === null, threw && threw.message);
  check('(4) epoch 1 is the newest file, public and private', Math.max(...epochs(cfg)) === 1 && fs.existsSync(path.join(cfg.data, 'epoch', '0-1.json')) && !fs.existsSync(path.join(cfg.data, 'epoch', '0-2.json')), epochs(cfg).join());
  check('(4) health.json reports it', h.ok === false && /boom/.test(h.error) && h.behind > 0, JSON.stringify(h));
  check('(4) live.json still names epoch 1', readPub(cfg, 'live.json').epoch === 1);
}

// (5) retention, after sixty fake hours at one island day an hour: every epoch of the last 48 hours, then the first of each UTC day
{
  const cfg = folder(3600), start = Date.UTC(2026, 0, 1, 20), c = clock(start), live = createLive(cfg, { now: c.now });
  run(live, c, start + 60 * 3600e3, 3600e3);
  // epoch n falls (n - 0.2) hours after the start, so the cut is at 12 h in: epochs 13 to 60 are inside 48 hours. Older ones are
  // 20:00 to 23:48 on Jan 1 (epochs 0 to 4, keep 0) and 00:48 to 07:48 on Jan 2 (epochs 5 to 12, keep 5)
  const want = [0, 5, ...Array.from({ length: 48 }, (_, i) => 13 + i)];
  check('(5) the public folder keeps the last 48 hours and the first epoch of each older UTC day', epochs(cfg).join() === want.join(), epochs(cfg).join());
  const priv = fs.readdirSync(path.join(cfg.data, 'epoch')).sort().join();
  check('(5) the private folder keeps the newest two', priv === '0-59.json,0-60.json', priv);
}

// (6) every published epoch is the real save: lzDec, JSON.parse, canLoad, and the hash is the hash of what was packed
{
  const { H } = loadHearth({ globals: { btoa, atob } });
  let bad = null, n = 0;
  for (const k of epochs(C30)) {
    const e = readEpoch(C30, k);
    try {
      const json = H.lzDec(e.save), o = JSON.parse(json);
      if (!H.canLoad(o)) bad = `epoch ${k}: canLoad refused it`;
      else if (fnv(json) !== e.hash) bad = `epoch ${k}: hash ${e.hash} is not the hash of its save (${fnv(json)})`;
      else if (e.step !== epochStep(k) || e.n !== k) bad = `epoch ${k}: step ${e.step}`;
    } catch (err) { bad = `epoch ${k}: ${err.message}`; }
    n++;
    if (bad) break;
  }
  check(`(6) all ${n} published epoch files are saves that load and hash as written`, !bad && n >= 31, bad);
}

// (7) new game code: adopted only after two reads agree and a smoke test, rejected when the smoke test throws
{
  const root = path.join(SCRATCH, 'game');
  for (const f of ['js/core.js', 'js/flavor.js', 'js/life.js', 'js/watcher.js', 'js/sim.js', 'assets/sprites/buildings.js', 'js/render.js', 'js/look.js', 'js/folk.js', 'js/goods.js', 'js/audio.js', 'js/save.js', 'js/main.js']) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.copyFileSync(path.join(GAME_ROOT, f), path.join(root, f));
  }
  const cfg = folder(), c = clock(T0), live = createLive(cfg, { now: c.now, world: { root } });
  const h0 = codeHash(root);
  run(live, c, T0 + 1 * DAYMS);
  fs.appendFileSync(path.join(root, 'js/folk.js'), '\n/* a harmless merge */\n');
  const h1 = codeHash(root);
  run(live, c, T0 + 2 * DAYMS);
  check('(7) one read of a changed script is not enough: still the old code at the next epoch', live.world.code === h0 && readPub(cfg, 'live.json').code === h0);
  run(live, c, T0 + 4 * DAYMS);
  check('(7) a changed script that stays changed is adopted at an epoch after 30 s', live.world.code === h1 && readPub(cfg, 'live.json').code === h1, `${live.world.code} ${h0} ${h1}`);
  fs.appendFileSync(path.join(root, 'js/main.js'), '\nstep=function(){throw new Error("bad merge")};\n');
  const h2 = codeHash(root);
  run(live, c, T0 + 8 * DAYMS);
  live.health();
  const h = readPub(cfg, 'health.json');
  check('(7) code whose smoke test throws is rejected and the island carries on with the old code', live.world.code === h1 && h.codeRejected === 1 && readPub(cfg, 'live.json').epoch >= 7, `${live.world.code} ${h1} ${h2} ${JSON.stringify(h)}`);
}

console.log(fails ? `\nFAIL: ${fails} check(s)` : '\nPASS: the island is a function of the clock');
process.exit(fails ? 1 : 0);
