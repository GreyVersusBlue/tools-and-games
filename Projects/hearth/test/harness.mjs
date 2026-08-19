// Hearth soak & determinism harness (sprint 9 rebuild of the lost harness.py, committed this time).
//
// Drives the real game headlessly through window.__hearth. The RAF loop is paused via the
// pause button so every step() call comes from this file — otherwise real-time frames leak
// into the simulation between evaluate() calls and nothing is reproducible.
//
// Usage (from Projects/hearth/test, after `npm install`):
//   node harness.mjs soak         [--days 40] [--seeds 7,42,20260819] [--random 2] [--audit 25]
//   node harness.mjs determinism  [--days 30] [--seed 7]
//   node harness.mjs save         [--seed 7]
//   node harness.mjs nan          [--days 400] [--seeds 7] [--random 4]   (soak with starvation stress windows)
//
// Checks, per sprint-8 lessons: audit EVERY species and people every N steps across MULTIPLE
// seeds including random ones; a single healthy island at a polite interval proves nothing.

import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = pathToFileURL(path.join(HERE, '..', 'index.html')).href;
const DT = 0.05; // the step used by skipToMorning; one sim day = dayLen/DT = 2800 steps

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function openIsland(browser, seed, warns) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', m => {
    const t = m.text();
    if (t.includes('non-finite') || t.startsWith('hearth:')) warns.push(t);
  });
  page.on('pageerror', e => warns.push('PAGEERROR: ' + e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__hearth);
  // pause the RAF loop so this harness owns every step
  await page.evaluate(() => {
    const b = document.getElementById('b-pause');
    if (b.textContent !== '▶') b.click();
  });
  if (seed !== undefined) await page.evaluate(s => window.__hearth.newWorld(s), seed);
  return { ctx, page };
}

// run exactly one sim day; audit all movers every `auditEvery` steps; return violations + a day summary
async function runDay(page, auditEvery) {
  return page.evaluate(({ auditEvery, DT }) => {
    const H = window.__hearth;
    const out = { viol: [], steps: 0 };
    const day0 = H.dayCount;
    const audit = () => {
      for (const p of H.people) {
        if (!isFinite(p.x) || !isFinite(p.y)) { out.viol.push(`NAN person ${p.name} task=${p.task}`); continue; }
        if (p.inBoat || p.inside) continue;
        if (!H.canWalk(p.x, p.y) && !H.canWade(p.x, p.y))
          out.viol.push(`WATER person ${p.name} task=${p.task} @${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
      for (const w of H.wild) {
        if (w.st === 'leave') continue;
        if (!isFinite(w.x) || !isFinite(w.y)) { out.viol.push(`NAN wild ${w.k}`); continue; }
        if (!H.landAt(w.x, w.y)) out.viol.push(`WATER wild ${w.k} st=${w.st} @${w.x.toFixed(1)},${w.y.toFixed(1)}`);
      }
      for (const b of H.boats) if (!isFinite(b.x) || !isFinite(b.y)) out.viol.push(`NAN boat ${b.kind}`);
    };
    while (H.dayCount === day0 && out.steps < 6000) {
      H.step(DT); out.steps++;
      if (out.steps % auditEvery === 0) audit();
    }
    audit();
    out.day = H.dayCount; out.pop = H.people.length; out.food = H.food; out.granary = H.granary;
    out.houses = H.houses.length; out.bldg = H.bldg.map(b => b.kind).join(',');
    out.hasStream = H.stream.length > 0; out.bridgeUp = H.bridgeUp;
    return out;
  }, { auditEvery, DT });
}

async function packHash(page) {
  return page.evaluate(() => {
    const s = JSON.stringify(window.__hearth.pack());
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16) + ':' + s.length;
  });
}

async function soakSeed(browser, seed, days, auditEvery, opts = {}) {
  const warns = [];
  const { ctx, page } = await openIsland(browser, seed, warns);
  let viol = [], last = null, audits = 0;
  for (let d = 0; d < days; d++) {
    // NaN-stress: reproduce the observed risk profile — periodic starvation windows
    if (opts.starve && d > 20 && d % 30 === 0)
      await page.evaluate(() => { window.__hearth.setFood(0); window.__hearth.setGranary(0); });
    last = await runDay(page, auditEvery);
    viol = viol.concat(last.viol);
    audits += Math.floor(last.steps / auditEvery) + 1;
    if ((d + 1) % 10 === 0 || d === days - 1)
      console.log(`  seed ${seed} day ${last.day}: pop ${last.pop} food ${last.food} store ${last.granary} houses ${last.houses}` +
        ` [${last.bldg}]${last.hasStream ? (last.bridgeUp ? ' bridge✓' : ' stream') : ''}` +
        (viol.length ? `  !! ${viol.length} violations` : ''));
  }
  await ctx.close();
  return { seed, viol, warns, audits, last };
}

// use the environment's Chromium when the pinned playwright version's own download is absent.
// autoplay flag: the 'twelve' listening pass needs a running AudioContext without a user gesture.
const LAUNCH = { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(LAUNCH).catch(() => chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }));
const mode = process.argv[2] || 'soak';
let failed = false;

if (mode === 'soak' || mode === 'nan') {
  const days = parseInt(arg('days', mode === 'nan' ? '400' : '40'));
  const fixed = arg('seeds', mode === 'nan' ? '7' : '7,42,20260819').split(',').filter(Boolean).map(Number);
  const nRandom = parseInt(arg('random', mode === 'nan' ? '4' : '2'));
  const auditEvery = parseInt(arg('audit', '25'));
  const seeds = fixed.concat(Array.from({ length: nRandom }, () => (Math.random() * 1e9) | 0));
  console.log(`${mode}: ${days} days x seeds [${seeds.join(', ')}], audit every ${auditEvery} steps\n`);
  let totalAudits = 0;
  for (const seed of seeds) {
    const r = await soakSeed(browser, seed, days, auditEvery, { starve: mode === 'nan' });
    totalAudits += r.audits;
    if (r.viol.length) { failed = true; console.log(`  FAIL seed ${seed}:`); [...new Set(r.viol)].slice(0, 20).forEach(v => console.log('    ' + v)); }
    if (r.warns.length) { failed = true; console.log(`  WARNINGS seed ${seed}:`); [...new Set(r.warns)].slice(0, 20).forEach(v => console.log('    ' + v)); }
  }
  console.log(`\n${failed ? 'FAIL' : 'PASS'}: ${seeds.length} islands, ${seeds.length * days} sim-days, ~${totalAudits} full-cast audits, ${failed ? 'violations above' : '0 violations, 0 breadcrumbs'}`);
}

if (mode === 'depth') {
  // sprint 10 observation run: do crafts, works, bread, trade, and returners actually happen?
  const days = parseInt(arg('days', '120'));
  const seeds = arg('seeds', '7,20260819').split(',').map(Number);
  for (const seed of seeds) {
    const warns = [];
    const { ctx, page } = await openIsland(browser, seed, warns);
    let viol = [];
    for (let d = 0; d < days; d++) { const r = await runDay(page, 50); viol = viol.concat(r.viol); }
    const s = await page.evaluate(() => {
      const H = window.__hearth;
      const adults = H.people.filter(p => !p.child);
      const crafts = [0, 0, 0, 0, 0]; let none = 0, masters = 0, shad = 0;
      for (const p of adults) { if (p.craft >= 0) crafts[p.craft]++; else none++; if (p.cxp >= 1) masters++; }
      for (const p of H.people) if (p.shadN) shad++;
      const backs = H.chron.filter(e => e.kind === 'back').length;
      const found = H.chron.filter(e => e.kind === 'found').length;
      const breads = H.chron.filter(e => e.kind === 'bread').length;
      const mast = H.chron.filter(e => e.kind === 'mastery').length;
      return {
        day: H.dayCount, pop: H.people.length, crafts, none, masters, shad,
        works: H.works.map(w => w.wk + (w.done ? '' : '(wip)')).join(','),
        breads, backs, found, mastEvents: mast, granary: H.granary, dry: H.dry01,
        things: H.things.map(t => `${t.n}(${t.holder || 'shelf'},${t.hist.length})`).join(', '),
        heirs: H.chron.filter(e => e.kind === 'heir').length,
        grown: H.chron.filter(e => e.gr).length, ways: H.wayN(),
        places: H.spots.filter(s => s.lore).map(s => `${s.l} ×${H.loreN[s.k] || 0}`).join('; '),
        bounds: H.chron.filter(e => e.kind === 'bounds').length,
      };
    });
    console.log(`seed ${seed} @ day ${s.day}: pop ${s.pop}`);
    console.log(`  crafts field/wood/sea/frame/store: ${s.crafts.join('/')} (uncrafted ${s.none}), masters ${s.masters}, kids shadowing ${s.shad}`);
    console.log(`  works: [${s.works}]  bread-days ${s.breads}  returners ${s.backs}  found-objects ${s.found}  mastery-events ${s.mastEvents}  store ${s.granary}`);
    console.log(`  things: [${s.things}]  handings-down ${s.heirs}  stories-grown ${s.grown}  ways ${s.ways}`);
    console.log(`  named places: [${s.places || 'none yet'}]  bounds-walked ${s.bounds}`);
    if (viol.length) { failed = true; console.log('  VIOLATIONS:'); [...new Set(viol)].slice(0, 10).forEach(v => console.log('   ' + v)); }
    if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
    await ctx.close();
  }
  console.log(failed ? '\nFAIL' : '\nPASS: no violations; stats above for eyeballing');
}

if (mode === 'eleven') {
  // sprint 11 observation & force tests: temper, arcs, ways, the noticing (faith -> shrine -> prayer -> answer), zoom math, v6 compat
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);

  // temper is derived from the seed, deterministically
  const temper = await H(() => window.__hearth.temper);
  console.log(`temper (seed 7): ${temper}`);
  if (!temper) { failed = true; console.log('FAIL: no temper set'); }

  // faith -> noticing -> shrine: act daily and watch the stone go up
  let shrineDay = null;
  for (let d = 0; d < 30 && shrineDay === null; d++) {
    await H(() => { const h = window.__hearth; h.noteAct('test', .04); h.noteAct('test', .04); });
    await runDay(page, 1e9);
    if (await H(() => window.__hearth.hasW('shrine'))) shrineDay = await H(() => window.__hearth.dayCount);
  }
  console.log(`quiet stone built: ${shrineDay !== null ? 'day ' + shrineDay : 'NO'} (faith ${await H(() => window.__hearth.faith.toFixed(2))})`);
  if (shrineDay === null) { failed = true; console.log('FAIL: shrine never built under sustained acts'); }

  // prayer -> grant: hold the ground dry across dawns, wait for the rain-prayer, answer it with weather
  let prayed = null;
  for (let d = 0; d < 32 && prayed !== 'rain'; d++) {
    await H(() => { window.__hearth.setDry(.9); if (window.__hearth.prayer && window.__hearth.prayer.k !== 'rain') window.__hearth.setWx('clear'); });
    await runDay(page, 1e9);
    prayed = await H(() => window.__hearth.prayer && window.__hearth.prayer.k) || prayed;
  }
  console.log(`prayer asked: ${prayed || 'NO'}`);
  if (prayed !== 'rain') { failed = true; console.log('FAIL: expected a rain prayer under dry ground'); }
  else {
    const f0 = await H(() => window.__hearth.faith);
    await H(() => window.__hearth.setWx('rain'));
    await runDay(page, 1e9);
    const { f1, cleared, answered } = await H(() => ({
      f1: window.__hearth.faith, cleared: !window.__hearth.prayer,
      answered: window.__hearth.chron.some(e => e.kind === 'answered'),
    }));
    console.log(`prayer answered by weather: cleared ${cleared}, faith ${f0.toFixed(2)} -> ${f1.toFixed(2)}, chronicled ${answered}`);
    if (!cleared || f1 <= f0) { failed = true; console.log('FAIL: rain did not settle the prayer'); }
  }

  // arcs, forced: fever runs its course; drought cranks the dry ground and breaks in a storm
  await H(() => window.__hearth.startArc('fever', 5));
  const sick0 = await H(() => window.__hearth.sickCount);
  for (let d = 0; d < 8; d++) await runDay(page, 1e9);
  const fever = await H(() => ({ sick: window.__hearth.sickCount, arcGone: !window.__hearth.arc, chr: window.__hearth.chron.some(e => e.kind === 'fever') }));
  console.log(`fever: ${sick0} taken, ${fever.sick} still sick after, arc cleared ${fever.arcGone}, chronicled ${fever.chr}`);
  if (sick0 < 1 || fever.sick > 0 || !fever.arcGone || !fever.chr) { failed = true; console.log('FAIL: fever arc misbehaved'); }
  await H(() => { window.__hearth.setDry(.1); window.__hearth.startArc('drought', 3); });
  for (let d = 0; d < 5; d++) await runDay(page, 1e9);
  const dr = await H(() => ({ dry: window.__hearth.dry01, now: window.__hearth.arc ? window.__hearth.arc.k : 'none', broke: window.__hearth.chron.some(e => e.kind === 'rainscame') }));
  console.log(`drought: dry01 ${dr.dry.toFixed(2)} at end, break chronicled ${dr.broke} (current arc: ${dr.now} — a new year may deal a new card)`);
  if (!dr.broke) { failed = true; console.log('FAIL: drought never broke in a storm'); }

  // a way, discovered once a master exists (needs the hut; run until it stands, then force mastery)
  let hutDay = null;
  for (let d = 0; d < 40 && hutDay === null; d++) {
    await runDay(page, 1e9);
    if (await H(() => window.__hearth.bldg.some(b => b.kind === 'hut'))) hutDay = await H(() => window.__hearth.dayCount);
  }
  if (hutDay === null) console.log('  (no hut in 40 days; skipping way test on this seed)');
  else {
    let way = 0;
    for (let d = 0; d < 60 && !way; d++) {
      await H(() => { for (const p of window.__hearth.people.filter(q => !q.child).slice(0, 3)) { p.craft = 2; p.cxp = 1; } });
      await runDay(page, 1e9); way = await H(() => window.__hearth.ways & 1);
    }
    console.log(`the sail: ${way ? 'discovered' : 'NOT discovered in 60 days'}`);
    if (!way) { failed = true; console.log('FAIL: mastery + hut never produced the sail'); }
  }

  // zoom: round-trip a world point through the screen mapping at 3x, and draw without error
  const zerr = await H(() => {
    const h = window.__hearth; h.setZoom(3, 40, 30); h.draw();
    const cvEl = document.getElementById('c'), r = cvEl.getBoundingClientRect(), v = h.view;
    const k = v.fitS * v.zoom * v.dprE, w0 = { x: 40, y: 30 };
    const sx = (w0.x * 8 * k + (cvEl.width / 2 - v.camX * 8 * k)) / v.dprE + r.left;
    const sy = (w0.y * 8 * k + (cvEl.height / 2 - v.camY * 8 * k)) / v.dprE + r.top;
    const w1 = h.toWorld({ clientX: sx, clientY: sy });
    h.setZoom(1);
    return Math.hypot(w1.x - w0.x, w1.y - w0.y);
  });
  console.log(`zoom round-trip error at 3x: ${zerr.toExponential(2)}`);
  if (zerr > .01) { failed = true; console.log('FAIL: toWorld does not invert the view transform'); }

  // a v6-shaped save (26-field people, no sprint-11 keys) still loads
  const v6ok = await H(() => {
    const h = window.__hearth; const o = h.pack(); o.v = 6;
    for (const k of ['fa', 'fs', 'py', 'ay', 'ax', 'az', 'aw', 'ab', 'al', 'am', 'an', 'af']) delete o[k];
    o.pe.forEach(a => a.length = 26); o.wk = o.wk.filter(w => w[0] !== 'shrine');
    try { h.unpack(o); } catch (e) { return 'threw: ' + e.message; }
    return h.people.length > 0 && h.faith === 0 ? 'ok' : 'bad state';
  });
  console.log(`v6 save compat: ${v6ok}`);
  if (v6ok !== 'ok') failed = true;

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: sprint 11 systems behave');
}

if (mode === 'twelve') {
  // sprint 12 observation & force tests: heirlooms made and handed down, stories that grow in the telling,
  // works-in-progress surviving a save, v7 compat, and the audio listening pass — measured, not vibed.
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);
  for (let d = 0; d < 10; d++) await runDay(page, 1e9); // let people, rels and chron entries exist

  // a master makes a thing, once per craft; force masteries until one appears
  const made = await H(() => {
    const h = window.__hearth;
    const adults = h.people.filter(p => !p.child);
    for (let ci = 0; ci < 5 && !h.things.length; ci++) {
      const p = adults[ci % adults.length]; if (!p) break;
      p.craft = ci; p.cxp = .995; h.craftUp(p, ci);
    }
    return h.things.map(t => ({ n: t.n, holder: t.holder, src: t.src }));
  });
  console.log(`made things after forced masteries: ${JSON.stringify(made)}`);
  if (!made.length) { failed = true; console.log('FAIL: five masteries produced no made thing (p=.6 each)'); }

  // the handing down: kill the holder, the thing moves and both histories say so
  const heir = await H(() => {
    const h = window.__hearth;
    const t = h.things[0]; const holder = h.people.find(p => p.name === t.holder);
    const before = t.hist.length;
    h.die(holder);
    return { was: holder.name, now: t.holder, grew: t.hist.length > before,
      last: t.hist[t.hist.length - 1].s, heirEv: h.chron.some(e => e.kind === 'heir'), heirYr: h.heirYr };
  });
  console.log(`handed down: ${heir.was} -> ${heir.now || 'the shelf'} ("${heir.last}"), chronicled ${heir.heirEv}`);
  if (heir.now === heir.was || !heir.grew) { failed = true; console.log('FAIL: the thing did not move when its holder died'); }
  if (heir.now && !heir.heirEv) { failed = true; console.log('FAIL: a first handing down was not chronicled'); }

  // the telling: story nights until some chronicle entry grows
  let grown = 0, tells = 0;
  for (let d = 0; d < 12 && !grown; d++) {
    await H(() => window.__hearth.tellStory());
    tells++;
    await runDay(page, 1e9);
    grown = await H(() => window.__hearth.chron.filter(e => e.gr).length);
  }
  const gs = await H(() => { const e = window.__hearth.chron.find(e => e.gr); return e ? { kind: e.kind, tl: e.tl, st: e.st.slice(-70) } : null; });
  console.log(`stories grown after ${tells} fire nights: ${grown}${gs ? ` (a ${gs.kind}, told ${gs.tl}x: "...${gs.st}")` : ''}`);
  if (!grown) { failed = true; console.log('FAIL: twelve nights of telling grew no story'); }

  // works in progress survive the save now (the shrine used to re-arm from faith; a half-built ring used to vanish)
  const wip = await H(() => {
    const h = window.__hearth;
    h.works.push({ wk: 'ring', x: 40, y: 30, y0: 2, done: false, prog: 7.5, paid: 1, said: 1 });
    const o = h.pack(); h.unpack(o);
    const w = h.works.find(w => w.wk === 'ring');
    return w ? { done: w.done, prog: w.prog, paid: w.paid } : null;
  });
  console.log(`wip work through pack/unpack: ${JSON.stringify(wip)}`);
  if (!wip || wip.done || wip.prog !== 7.5 || !wip.paid) { failed = true; console.log('FAIL: a work in progress did not survive the save'); }

  // a v7-shaped save (4-field works, 5-field chronicle rows, no heirloom keys) still loads
  const v7ok = await H(() => {
    const h = window.__hearth; const o = h.pack(); o.v = 7;
    delete o.hl; delete o.hy;
    o.wk = o.wk.filter(w => w[4]).map(w => w.slice(0, 4));
    o.ch = o.ch.map(a => a.slice(0, 5));
    try { h.unpack(o); } catch (e) { return 'threw: ' + e.message; }
    return h.people.length > 0 && h.things.length === 0 && h.works.every(w => w.done) ? 'ok' : 'bad state';
  });
  console.log(`v7 save compat: ${v7ok}`);
  if (v7ok !== 'ok') failed = true;

  // ---- the listening pass, measured: every one-shot through an analyser on the master bus ----
  const audio = await page.evaluate(async () => {
    const h = window.__hearth;
    h.audioOn = true; // before startAudio: the master gain is stamped from audioOn when the graph is built
    if (!h.AC) h.startAudio();
    const AC = h.AC; await AC.resume();
    if (AC.state !== 'running') return { skip: 'AudioContext ' + AC.state };
    h.buses.master.gain.value = 1;
    const t0c = AC.currentTime; await new Promise(r => setTimeout(r, 300));
    if (AC.currentTime === t0c) return { skip: 'AudioContext clock not advancing (no audio device?)' };
    const an = AC.createAnalyser(); an.fftSize = 2048;
    h.buses.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    const peakFor = ms => new Promise(res => {
      let peak = 0; const t0 = performance.now();
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
        if (performance.now() - t0 > ms) { clearInterval(iv); res(peak); }
      }, 25);
    });
    const settle = async () => { h.audioTick(.05); await peakFor(250); }; // let tails die between shots
    const x = h.cur.x, y = h.cur.y, out = {};
    const shots = [
      ['thock', () => h.thock(x, y)], ['hammer', () => h.hammer(x, y)], ['stoneTap', () => h.stoneTap(x, y)],
      ['splash', () => h.splash(x, y)], ['whoosh', () => h.whoosh(x, y, .9)], ['gullCry', () => h.gullCry(x, y)],
      ['creak', () => h.creak(x, y)], ['bell', () => h.bell(1)], ['plink', () => h.plink(.15)],
      ['chirp', () => h.chirp()], ['thunder', () => h.thunder(.2)], ['lullaby', () => h.lullaby(x, y)],
      ['wayTune', () => h.wayTune()],
    ];
    for (const [name, fn] of shots) {
      h.audioTick(.05); // resets the per-frame sfx cap so every shot actually fires
      fn(); out[name] = +(await peakFor(name === 'thunder' || name === 'bell' ? 2200 : 1300)).toFixed(4);
      await settle();
    }
    // ducking: under a thunderstorm the sfx bus steps back and the rain bed itself keeps headroom.
    // (a peak comparison of the same hammer is confounded — the analyser hears the storm bed under it —
    // so assert on the duck gain the game actually applies, and on the bed's own level)
    h.setWx('thunder'); for (let i = 0; i < 40; i++) h.audioTick(.1); await peakFor(1800);
    const sfxStorm = h.buses.sfxG.gain.value, bedStorm = await peakFor(900);
    h.setWx('clear'); for (let i = 0; i < 40; i++) h.audioTick(.1); await peakFor(1800);
    const sfxClear = h.buses.sfxG.gain.value;
    out.duck = { sfxStorm: +sfxStorm.toFixed(3), sfxClear: +sfxClear.toFixed(3), bedStorm: +bedStorm.toFixed(4) };
    return out;
  });
  if (audio.skip) { failed = true; console.log(`FAIL: listening pass skipped (${audio.skip})`); }
  else {
    console.log('listening pass, master-bus peaks per one-shot:');
    const names = Object.keys(audio).filter(k => k !== 'duck');
    for (const k of names) console.log(`  ${k.padEnd(10)} ${audio[k].toFixed(3)}${audio[k] > .9 ? '  !! CLIPPING RISK' : audio[k] < .004 ? '  !! INAUDIBLE' : ''}`);
    const d = audio.duck;
    console.log(`  duck bus: sfx gain ${d.sfxStorm} in storm vs ${d.sfxClear} clear; storm bed peaks ${d.bedStorm}`);
    for (const k of names) if (audio[k] > .9 || audio[k] < .004) failed = true;
    if (!(d.sfxStorm < d.sfxClear - .1)) { failed = true; console.log('FAIL: the sfx bus does not step back under a storm'); }
    if (d.bedStorm > .5) { failed = true; console.log('FAIL: the storm bed itself is running hot'); }
  }

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: sprint 12 systems behave, and the island has been listened to');
}

if (mode === 'thirteen') {
  // sprint 13 observation & force tests: a grown story names its ground and someone walks it the next morning,
  // the named place survives pack/unpack and re-derives its spot, v8 saves still load (no lore, no error),
  // made things vary by seed, and the hall shelf draws without error.
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);
  for (let d = 0; d < 8; d++) await runDay(page, 1e9); // let people and chron entries exist

  // fire nights until a story grows and the ground gets named (growth at tl>=3; the walk is the next morning)
  let named = 0, nights = 0;
  for (let d = 0; d < 14 && !named; d++) {
    await H(() => window.__hearth.tellStory());
    nights++;
    await runDay(page, 1e9);
    named = await H(() => window.__hearth.chron.filter(e => e.kind === 'place').length);
  }
  const st = await H(() => {
    const h = window.__hearth;
    return { lorePl: h.lorePl.slice(), spots: h.spots.filter(s => s.lore).map(s => s.l),
      placeEv: h.chron.filter(e => e.kind === 'place').map(e => e.label),
      walker: h.people.some(p => p.hist.some(x => x.s.includes('story-name'))) };
  });
  console.log(`ground named after ${nights} fire nights: ${st.placeEv.join(' / ') || 'NO'} (kinds: ${st.lorePl.join(',')})`);
  if (!named) { failed = true; console.log('FAIL: fourteen fire nights grew no named place'); }
  if (named && !st.spots.length) { failed = true; console.log('FAIL: a named place produced no lore spot'); }
  if (named && !st.walker) { failed = true; console.log('FAIL: nobody has the walk in their history'); }

  // the named place survives the save: kinds are packed (v9), the spot re-derives from the rebuilt world
  const rt = await H(() => {
    const h = window.__hearth; const o = h.pack();
    h.unpack(JSON.parse(JSON.stringify(o)));
    return { v: o.v, lp: o.lp, lorePl: h.lorePl.slice(), spot: h.spots.some(s => s.lore) };
  });
  console.log(`round trip: pack v${rt.v} carries lp=[${rt.lp}], after unpack lorePl=[${rt.lorePl}] spot=${rt.spot}`);
  if (rt.v < 9 || !rt.lp.length || !rt.lorePl.length || !rt.spot) { failed = true; console.log('FAIL: named places did not survive pack/unpack'); }

  // a v8-shaped save (no lp key) still loads, with no lore and no error
  const v8ok = await H(() => {
    const h = window.__hearth; const o = h.pack(); o.v = 8; delete o.lp;
    try { h.unpack(o); } catch (e) { return 'threw: ' + e.message; }
    return h.people.length > 0 && h.lorePl.length === 0 && !h.spots.some(s => s.lore) ? 'ok' : 'bad state';
  });
  console.log(`v8 save compat: ${v8ok}`);
  if (v8ok !== 'ok') failed = true;

  // the shelf in the hall draws when something waits on it
  const shelf = await H(() => {
    const h = window.__hearth;
    h.things.push({ n: 'a test comb', full: 'a test comb', holder: 0, src: 'found', hist: [] });
    try { h.draw(); } catch (e) { return 'threw: ' + e.message; }
    h.things.pop();
    return 'ok';
  });
  console.log(`hall shelf draw: ${shelf}`);
  if (shelf !== 'ok') failed = true;

  // made things vary by seed (and are stable within one): compare all five crafts across two islands
  const made7 = await H(() => [0, 1, 2, 3, 4].map(ci => window.__hearth.madeOf(ci)));
  const made7b = await H(() => [0, 1, 2, 3, 4].map(ci => window.__hearth.madeOf(ci)));
  await H(() => window.__hearth.newWorld(20260819));
  const madeB = await H(() => [0, 1, 2, 3, 4].map(ci => window.__hearth.madeOf(ci)));
  const shape = m => m.every(v => Array.isArray(v) && v.length === 2 && v.every(s => typeof s === 'string' && s.length > 3));
  const differs = made7.some((v, i) => v[1] !== madeB[i][1]);
  console.log(`made things, seed 7:        ${made7.map(v => v[1]).join(', ')}`);
  console.log(`made things, seed 20260819: ${madeB.map(v => v[1]).join(', ')}`);
  if (!shape(made7) || !shape(madeB)) { failed = true; console.log('FAIL: a made-thing entry is malformed'); }
  if (JSON.stringify(made7) !== JSON.stringify(made7b)) { failed = true; console.log('FAIL: made things are not stable within a seed'); }
  if (!differs) { failed = true; console.log('FAIL: two islands make identical things (per-seed variation is not varying)'); }

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: sprint 13 systems behave — the stories have somewhere to stand');
}

if (mode === 'fourteen') {
  // sprint 14 observation & force tests: two named places, the walking of the bounds (leader leaves a stone at each),
  // cairns draw at every tier, walk counts survive pack/unpack (v10), and a v9 save (no ln/by) still loads.
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);
  for (let d = 0; d < 8; d++) await runDay(page, 1e9);

  // a pre-grown rainscame entry joins the chronicle, so two kinds of ground can take names
  await H(() => {
    const h = window.__hearth;
    h.chron.push({ d: h.dayCount, y: Math.floor((h.dayCount - 1) / 20) + 1, kind: 'rainscame',
      label: 'the day the rain came back', st: 'The drought broke in one great storm, and people stood out in it on purpose.', tl: 3, gr: 1 });
  });
  let named = 0, nights = 0;
  for (let d = 0; d < 16 && named < 2; d++) {
    await H(() => window.__hearth.tellStory());
    nights++;
    await runDay(page, 1e9);
    named = await H(() => window.__hearth.lorePl.length);
  }
  const n0 = await H(() => ({ ...window.__hearth.loreN }));
  console.log(`named ground after ${nights} fire nights: ${await H(() => window.__hearth.lorePl.join(', '))} (walks so far: ${JSON.stringify(n0)})`);
  if (named < 2) { failed = true; console.log('FAIL: sixteen fire nights produced fewer than two named places'); }

  // the walking of the bounds: force an elder and a child to exist, then send them out and let the day run.
  // runDay ends at midnight, and a bounds launched into the night just walks home — the game only ever
  // launches it after dawn, so the test must get to morning first (and re-pause, since skipToMorning unpauses).
  const led = await H(() => {
    const h = window.__hearth;
    h.skipToMorning();
    const bp = document.getElementById('b-pause'); if (bp.textContent !== '▶') bp.click();
    const adults = h.people.filter(p => !p.child && !p.inBoat && !p.inside && !p.sick && p.task !== 'boat' && p.task !== 'voyage');
    adults[0].age0 = 66; adults[0].born = h.dayCount;                       /* an elder to lead */
    const k = adults[adults.length - 1]; k.age0 = 8; k.born = h.dayCount;   /* a child to be shown */
    return h.boundsOut();
  });
  await runDay(page, 1e9);
  const b = await H(() => {
    const h = window.__hearth;
    return { ev: h.chron.some(e => e.kind === 'bounds'), loreN: { ...h.loreN },
      led: h.people.some(p => p.hist.some(x => x.s.includes('walking of the bounds'))),
      shown: h.people.some(p => p.hist.some(x => x.s.includes('shown where everything happened'))) };
  });
  const sum = o => Object.values(o).reduce((a, v) => a + v, 0);
  console.log(`bounds walked: launched ${led}, chronicled ${b.ev}, stones ${JSON.stringify(n0)} -> ${JSON.stringify(b.loreN)}, leader hist ${b.led}, child hist ${b.shown}`);
  if (!led || !b.ev || !b.led || !b.shown) { failed = true; console.log('FAIL: the bounds did not walk'); }
  if (sum(b.loreN) < sum(n0) + 2) { failed = true; console.log('FAIL: the leader did not leave a stone at each place'); }

  // cairns draw at every tier
  const cairn = await H(() => {
    const h = window.__hearth;
    for (const n of [1, 2, 4, 7, 12]) { h.setLoreN(h.lorePl[0], n); try { h.draw(); } catch (e) { return 'threw at n=' + n + ': ' + e.message; } }
    return 'ok';
  });
  console.log(`cairn draw at tiers 1/2/4/7/12: ${cairn}`);
  if (cairn !== 'ok') failed = true;

  // walk counts and the bounds year survive the save (v10)
  const rt = await H(() => {
    const h = window.__hearth; const o = h.pack();
    h.unpack(JSON.parse(JSON.stringify(o)));
    return { v: o.v, ln: o.ln, by: o.by, loreN: { ...h.loreN }, spotKinds: h.spots.filter(s => s.lore).map(s => s.k) };
  });
  console.log(`round trip: pack v${rt.v} carries ln=${JSON.stringify(rt.ln)} by=${rt.by}; after unpack loreN=${JSON.stringify(rt.loreN)} spot kinds=[${rt.spotKinds}]`);
  if (rt.v !== 10 || !rt.ln.length || sum(rt.loreN) < 2 || rt.spotKinds.length < 2) { failed = true; console.log('FAIL: walk counts did not survive pack/unpack'); }

  // a v9-shaped save (lp but no ln/by) still loads: places named, piles fresh
  const v9ok = await H(() => {
    const h = window.__hearth; const o = h.pack(); o.v = 9; delete o.ln; delete o.by;
    try { h.unpack(o); } catch (e) { return 'threw: ' + e.message; }
    return h.people.length > 0 && h.lorePl.length >= 2 && Object.keys(h.loreN).length === 0 ? 'ok' : 'bad state';
  });
  console.log(`v9 save compat: ${v9ok}`);
  if (v9ok !== 'ok') failed = true;

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: sprint 14 systems behave — the walking has somewhere to lead');
}

if (mode === 'determinism') {
  const days = parseInt(arg('days', '30'));
  const seed = parseInt(arg('seed', '7'));
  console.log(`determinism: seed ${seed}, ${days} days, two fresh runs\n`);
  const hashes = [];
  for (let run = 0; run < 2; run++) {
    const warns = [];
    const { ctx, page } = await openIsland(browser, seed, warns);
    for (let d = 0; d < days; d++) await runDay(page, 1e9); // no audits needed, just steps
    hashes.push(await packHash(page));
    console.log(`  run ${run + 1}: pack hash ${hashes[run]}`);
    if (warns.length) { failed = true; warns.forEach(w => console.log('  WARN ' + w)); }
    await ctx.close();
  }
  if (hashes[0] !== hashes[1]) failed = true;
  console.log(`\n${hashes[0] === hashes[1] ? 'PASS: identical worlds' : 'FAIL: the two runs diverged — an R() call is being skipped somewhere'}`);
}

if (mode === 'save') {
  const seed = parseInt(arg('seed', '7'));
  const warns = [];
  const { ctx, page } = await openIsland(browser, seed, warns);
  for (let d = 0; d < 3; d++) await runDay(page, 1e9);
  const before = await page.evaluate(() => ({
    day: window.__hearth.dayCount,
    names: window.__hearth.people.map(p => p.name).sort().join(','),
    auto: (() => { try { return !!localStorage.getItem('hearth.auto'); } catch (e) { return false; } })(),
  }));
  console.log(`ran to day ${before.day}; autosave present: ${before.auto}`);
  if (!before.auto) { failed = true; console.log('FAIL: no autosave written at dawn'); }
  await page.reload();
  await page.waitForFunction(() => !!window.__hearth);
  const after = await page.evaluate(() => ({
    day: window.__hearth.dayCount,
    names: window.__hearth.people.map(p => p.name).sort().join(','),
    line: document.getElementById('log').textContent.includes('kept itself'),
  }));
  console.log(`after reload: day ${after.day} (expected ${before.day}), quiet line shown: ${after.line}`);
  if (after.day !== before.day || after.names !== before.names || !after.line) failed = true;
  console.log(failed ? 'FAIL: autosave round-trip broken' : 'PASS: the island kept itself');
  await ctx.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
