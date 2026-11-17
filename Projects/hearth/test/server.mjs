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
function folder(daySeconds = 1200, eraDays = 90) {
  const d = path.join(SCRATCH, 'r' + nf++);
  return envConfig({ HEARTH_DATA: path.join(d, 'data'), HEARTH_PUBLIC: path.join(d, 'pub'), HEARTH_SEED: '7', HEARTH_DAY_SECONDS: String(daySeconds), HEARTH_ERA_DAYS: String(eraDays) });
}
// the same folders at another pace, the way a restart with a changed HEARTH_DAY_SECONDS reads them
const repace = (cfg, daySeconds) => ({ ...cfg, daySeconds });
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

// (8) an era of four island days: the island is filed, its far island is founded by people who sailed from it (C7, #1079)
const ERA4 = 4 * DAYMS / 86400e3;                // HEARTH_ERA_DAYS for four island days at the default pace; the era ends at epoch 5, the first one past it
const eraFile = (cfg, era, f) => JSON.parse(fs.readFileSync(path.join(cfg.pub, 'eras', String(era), f), 'utf8'));
const epochOf = (cfg, era, n) => JSON.parse(fs.readFileSync(path.join(cfg.pub, 'epoch', `${era}-${n}.json`), 'utf8'));
let E4;
{
  const { H, ev } = loadHearth({ globals: { btoa, atob } });
  const cfg = folder(1200, ERA4), c = clock(T0), live = createLive(cfg, { now: c.now });
  run(live, c, T0 + 7 * DAYMS);
  E4 = cfg;
  const eras = readPub(cfg, 'eras.json').eras, fin = eraFile(cfg, 0, 'final.json');
  check('(8) crossing the era leaves one row in eras.json, for era 0', eras.length === 1 && eras[0].era === 0 && eras[0].seed === 7 && eras[0].years >= 1 && eras[0].people > 0 && eras[0].graves >= 0 && /^2026-01-01T00:00/.test(eras[0].founded) && eras[0].ended > eras[0].founded, JSON.stringify(eras));
  check('(8) island 7 ended before it named its village, so its row carries the name its seed gives (farNameOf), not "island 7"', eras[0].name === ev('farNameOf(7)') && /^[A-Z][a-z]+[a-z]+$/.test(eras[0].name), JSON.stringify(eras[0].name));
  check('(8) the old island is filed: final.json is a save that loads, at the era\'s last epoch, and saga.html is there', (() => { const j = H.lzDec(fin.save); return H.canLoad(JSON.parse(j)) && fnv(j) === fin.hash && fin.step === epochStep(5) && fin.n === 5; })() && /<html/i.test(fs.readFileSync(path.join(cfg.pub, 'eras', '0', 'saga.html'), 'utf8')), JSON.stringify({ n: fin.n, step: fin.step }));
  H.unpack(JSON.parse(H.lzDec(fin.save)));
  const oldNames = new Set([...ev('people.map(p=>p.name)'), ...ev('gone.map(g=>g.name)')]), oldSeed = H.farSeed(7);
  const first = epochOf(cfg, 1, 0), lj = readPub(cfg, 'live.json');
  const json = H.lzDec(first.save);
  H.unpack(JSON.parse(json));
  const newSeed = ev('seed'), names = ev('people.map(p=>p.name)'), hist = ev('people.map(p=>p.hist.map(h=>h.s).join("|"))');
  check('(8) the new island is at farSeed of the old, and farSeed of the new is the old (#64)', newSeed === oldSeed && H.farSeed(newSeed) === 7, `${newSeed} ${oldSeed}`);
  const came = names.filter((n, i) => /came over the water from/.test(hist[i]));
  check('(8) up to four founders came over: each one\'s name is in the new island and was in the old', came.length >= 1 && came.length <= 4 && came.every(n => oldNames.has(n)), `${came} from ${[...oldNames]}`);
  check('(8) the names are unique and every relation, partner and parent names somebody on the island', new Set(names).size === names.length && ev('people.every(p=>p.rels.every(r=>names.has(r.who))&&p.parents.every(n=>names.has(n))&&(!p.partner||names.has(p.partner))&&p.seed===(hash(p.name)^seed))'));
  check('(8) the new island\'s pack, unpack, pack is byte-identical, and that is the hash the epoch file says', JSON.stringify(H.pack()) === json && fnv(json) === first.hash, `${fnv(json)} vs ${first.hash}`);
  const far = ev('({n:farRec.n,kn:farRec.kn,lit:farIsle.lit,link:farRec.s})');
  check('(8) its far record names the old village (island 7 had none yet), the name is known and the lamp is lit', far.n === eras[0].name && far.n === ev('farNameOf(7)') && !/^island /.test(eras[0].name) && far.kn === 1 && far.lit === true && far.link === 7, JSON.stringify(far));
  check('(8) it has one founding entry in its chronicle', ev('chron.filter(e=>e.kind==="era").length') === 1 && /came over the water/.test(ev('chron.find(e=>e.kind==="era").label')));
  check('(8) live.json names era 1, its seed and its own clock, and the epoch files are the new era\'s only', lj.era === 1 && lj.seed === oldSeed && lj.clock.era === 1 && lj.clock.step === 0 && lj.clock.at === Math.round(T0 + epochStep(5) * (1200e3 / 2800)) && fs.readdirSync(path.join(cfg.pub, 'epoch')).every(f => /^1-/.test(f)) && fs.readdirSync(path.join(cfg.data, 'epoch')).every(f => /^1-/.test(f)), JSON.stringify(lj));
  check('(8) the new epochs are at the founding steps again (0, 2240, 5040)', [0, 1, 2].every(n => epochOf(cfg, 1, n).step === epochStep(n) && epochOf(cfg, 1, n).n === n), '');
  // the same era reached in one tick, and by a kill and a restart
  const B = folder(1200, ERA4), cb = clock(T0), lb = createLive(B, { now: cb.now });
  cb.t = T0 + 7 * DAYMS; lb.tick();
  check('(8) the era crossed in one catch-up tick is the era crossed a second at a time: same final island, same new island', eraFile(B, 0, 'final.json').hash === fin.hash && epochOf(B, 1, 1).hash === epochOf(cfg, 1, 1).hash, `${eraFile(B, 0, 'final.json').hash} ${fin.hash}`);
  const K = folder(1200, ERA4), ck = clock(T0);
  let lk = createLive(K, { now: ck.now });
  run(lk, ck, T0 + 4 * DAYMS);
  lk = null; lk = createLive(K, { now: ck.now });
  run(lk, ck, T0 + 7 * DAYMS);
  check('(8) a restart before the era ends changes nothing about it', eraFile(K, 0, 'final.json').hash === fin.hash && epochOf(K, 1, 1).hash === epochOf(cfg, 1, 1).hash);
  // killed during the change: the old anchor and the old era's files are still there, the new island's epoch 0 is written. It is done again, to the same bytes.
  const X = folder(1200, ERA4), cx = clock(T0), lx = createLive(X, { now: cx.now });
  run(lx, cx, T0 + 6 * DAYMS);
  const before = fs.readFileSync(path.join(X.pub, 'epoch', '1-1.json'), 'utf8');
  fs.writeFileSync(path.join(X.data, 'anchor.json'), JSON.stringify({ at: T0, step: 0, stepMs: 1200e3 / 2800, daySeconds: 1200, era: 0 }));
  fs.copyFileSync(path.join(X.pub, 'eras', '0', 'final.json'), path.join(X.data, 'epoch', '0-5.json'));
  for (const f of fs.readdirSync(path.join(X.data, 'epoch'))) if (/^1-/.test(f)) fs.rmSync(path.join(X.data, 'epoch', f));
  const lx2 = createLive(X, { now: cx.now });
  run(lx2, cx, T0 + 6 * DAYMS);
  check('(8) killed between the new epoch and the new anchor, the restart ends the era again and reaches the same island', lx2.era === 1 && readPub(X, 'eras.json').eras.length === 1 && fs.readFileSync(path.join(X.pub, 'epoch', '1-1.json'), 'utf8') === before);
}

// (9) the pace is the anchor's, not the environment's (C6's open question, closed by C7): a restart with another HEARTH_DAY_SECONDS leaves the
// island's history alone, and the new value applies from the next era
{
  const A = E4, hA = eraFile(A, 0, 'final.json').hash;
  const B = folder(1200, ERA4), cb = clock(T0), logs = [];
  let lb = createLive(B, { now: cb.now });
  run(lb, cb, T0 + 2 * DAYMS);
  lb = null;
  lb = createLive(repace(B, 600), { now: cb.now, log: l => logs.push(l) });
  run(lb, cb, T0 + 3 * DAYMS);
  check('(9) a restart at another pace says the new value applies from the next era', logs.some(l => /600/.test(l) && /1200/.test(l) && /next era/.test(l)), logs.join(' | '));
  check('(9) and the clock live.json publishes is still the founding pace', readPub(B, 'live.json').clock.stepMs === 1200e3 / 2800 && readPub(B, 'live.json').clock.daySeconds === 1200, JSON.stringify(readPub(B, 'live.json').clock));
  run(lb, cb, T0 + 7 * DAYMS);
  check('(9) the epoch hash sequence is unchanged: era 0 ends on the same final island as a run that never restarted', eraFile(B, 0, 'final.json').hash === hA, `${eraFile(B, 0, 'final.json').hash} vs ${hA}`);
  const lj = readPub(B, 'live.json'), an = JSON.parse(fs.readFileSync(path.join(B.data, 'anchor.json'), 'utf8'));
  check('(9) the next era runs at the new pace, in its anchor and in live.json', lj.era === 1 && lj.clock.daySeconds === 600 && lj.clock.stepMs === 600e3 / 2800 && an.daySeconds === 600 && an.era === 1, JSON.stringify(lj.clock));
  // an anchor from before C7 (stepMs, no daySeconds, no era) keeps its own pace and gets it written down
  const O = folder(1200), co = clock(T0);
  run(createLive(O, { now: co.now }), co, T0 + 2 * DAYMS);
  fs.writeFileSync(path.join(O.data, 'anchor.json'), JSON.stringify({ at: T0, step: 0, stepMs: 1200e3 / 2800 }));
  const lo = createLive(repace(O, 300), { now: co.now });
  const oa = JSON.parse(fs.readFileSync(path.join(O.data, 'anchor.json'), 'utf8'));
  check('(9) an old anchor with no pace keeps the pace its stepMs says, and the pace is written into it', lo.stepMs === 1200e3 / 2800 && oa.daySeconds === 1200 && oa.era === 0, JSON.stringify(oa));
}

console.log(fails ? `\nFAIL: ${fails} check(s)` : '\nPASS: the island is a function of the clock');
process.exit(fails ? 1 : 0);
