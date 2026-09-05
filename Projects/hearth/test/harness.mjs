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
//   node harness.mjs decade       [--years 25] [--seeds 7,20260819] [--audit 100] [--fastdays 12]
//   node harness.mjs migrate
//   node harness.mjs saga         [--days 400] [--seeds 7]
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
        graves: H.graves.length, visits: H.graves.reduce((a, g) => a + (g.vn || 0), 0),
        songs: H.songs.map(s => `${(H.chron[s.ci] || { label: '?' }).label}${s.lost ? ' (LOST)' : ' kn' + s.kn.filter(n => H.people.some(p => p.name === n)).length}`).join('; '),
        yearNames: (() => { const out = []; for (let y = 1; y < Math.floor((H.dayCount - 1) / 20) + 1; y++) out.push(H.yearName(y)); return out.join(' | '); })(),
        heard: H.people.filter(p => p.heard).length, faces: H.people.filter(p => p.fSk >= 0).length,
        annivs: H.people.filter(p => p.hist.some(x => x.s.includes('a year to the day'))).length,
        toldDead: H.people.filter(p => p.hist.some(x => x.s.includes('who died before'))).length,
      };
    });
    console.log(`seed ${seed} @ day ${s.day}: pop ${s.pop}`);
    console.log(`  crafts field/wood/sea/frame/store: ${s.crafts.join('/')} (uncrafted ${s.none}), masters ${s.masters}, kids shadowing ${s.shad}`);
    console.log(`  works: [${s.works}]  bread-days ${s.breads}  returners ${s.backs}  found-objects ${s.found}  mastery-events ${s.mastEvents}  store ${s.granary}`);
    console.log(`  things: [${s.things}]  handings-down ${s.heirs}  stories-grown ${s.grown}  ways ${s.ways}`);
    console.log(`  named places: [${s.places || 'none yet'}]  bounds-walked ${s.bounds}`);
    console.log(`  hill: ${s.graves} stone${s.graves === 1 ? '' : 's'}, ${s.visits} visit${s.visits === 1 ? '' : 's'} left across them`);
    console.log(`  songs: [${s.songs || 'none yet'}]  news in pockets ${s.heard}  inherited faces ${s.faces}  anniversary-keepers ${s.annivs}  told-of-the-dead ${s.toldDead}`);
    console.log(`  the years, as they are called: ${s.yearNames || '(year 1 not done)'}`);
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
    const settle = async (ms = 250) => { h.audioTick(.05); await peakFor(ms); }; // let tails die between shots
    // The room the one-shots are measured in has to be the same room every time. Phase 2 shifted the R() stream, the island happened
    // to be under rain during this pass, and rain goes straight to the master bus by design — the floor read 0.1616 instead of the
    // 0.0557 every threshold below was written against, and a perfectly audible song failed for being only 1.17 floors loud.
    h.setWx('clear'); h.setSnow(0); h.audioTick(.05); await new Promise(r => setTimeout(r, 400));
    const x = h.cur.x, y = h.cur.y, out = {};
    // phase 1: a tune needs a song, and the song has to be a real one — its degrees come off its chronicle index.
    const sung = { ci: 0, comp: h.people[0].name, kn: h.people.map(p => p.name), lost: 0, d: h.dayCount };
    const shots = [
      ['thock', () => h.thock(x, y)], ['hammer', () => h.hammer(x, y)], ['stoneTap', () => h.stoneTap(x, y)],
      ['splash', () => h.splash(x, y)], ['whoosh', () => h.whoosh(x, y, .9)], ['gullCry', () => h.gullCry(x, y)],
      ['creak', () => h.creak(x, y)], ['bell', () => h.bell(1)], ['plink', () => h.plink(.15)],
      ['chirp', () => h.chirp()], ['thunder', () => h.thunder(.2)], ['lullaby', () => h.lullaby(x, y)],
      ['wayTune', () => h.wayTune()], ['songTune', () => h.songTune(sung, 4)],
    ];
    // a song is two passes of up to ten notes; it needs a longer window to peak in and a longer tail to die in,
    // or it bleeds into the duck measurement below and the storm bed reads hot for no reason.
    const peakWindow = n => n === 'songTune' ? 3000 : (n === 'thunder' || n === 'bell') ? 2200 : 1300;
    for (const [name, fn] of shots) {
      h.audioTick(.05); // resets the per-frame sfx cap so every shot actually fires
      fn(); out[name] = +(await peakFor(peakWindow(name))).toFixed(4);
      await settle(name === 'songTune' ? 7000 : 250);
    }
    // A lost song is silent, measured on the same analyser as everything else: nothing scheduled, nothing heard.
    // Against the room's own floor, not against zero — the wind and the sea are always on this bus's neighbour.
    const lost = { ci: 0, comp: '', kn: [], lost: 1, d: 0 };
    h.audioTick(.05);
    const floor = +(await peakFor(1200)).toFixed(4);
    h.audioTick(.05);
    const lostReturn = h.songTune(lost, 4);
    const lostPeak = +(await peakFor(1500)).toFixed(4);
    // and what a hearing plays is the derived phrase, not something rolled at the fire
    h.audioTick(.05);
    const played = h.songTune(sung, 1);
    await settle(7000);
    out.song = {
      degrees: h.songDegrees(0),
      sameTwice: JSON.stringify(h.songDegrees(3)) === JSON.stringify(h.songDegrees(3)),
      playedIsDerived: JSON.stringify(played) === JSON.stringify(h.songDegrees(0)),
      lostReturn, lostPeak, floor
    };
    // ducking: under a thunderstorm the sfx bus steps back and the rain bed itself keeps headroom.
    // (a peak comparison of the same hammer is confounded — the analyser hears the storm bed under it —
    // so assert on the duck gain the game actually applies, and on the bed's own level)
    // Chromium only advances an AudioParam's automation while the node is actually processing, so a SILENT sfx bus
    // freezes this reading wherever the last audible thing left it — and then the number below is not the gain the
    // game applies, it is a leftover. Keep something cheap flowing through the bus while it settles.
    const settleDuck = async ms => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) { h.audioTick(.05); h.plink(.02); await peakFor(200); }
    };
    h.setWx('thunder'); await settleDuck(2400);
    const sfxStorm = h.buses.sfxG.gain.value;
    await peakFor(400);                       // let the last settling plink die before reading the bed
    const bedStorm = await peakFor(900);
    h.setWx('clear'); await settleDuck(2400);
    const sfxClear = h.buses.sfxG.gain.value;
    out.duck = { sfxStorm: +sfxStorm.toFixed(3), sfxClear: +sfxClear.toFixed(3), bedStorm: +bedStorm.toFixed(4) };
    return out;
  });
  if (audio.skip) { failed = true; console.log(`FAIL: listening pass skipped (${audio.skip})`); }
  else {
    console.log('listening pass, master-bus peaks per one-shot:');
    const names = Object.keys(audio).filter(k => k !== 'duck' && k !== 'song');
    for (const k of names) console.log(`  ${k.padEnd(10)} ${audio[k].toFixed(3)}${audio[k] > .9 ? '  !! CLIPPING RISK' : audio[k] < .004 ? '  !! INAUDIBLE' : ''}`);
    const d = audio.duck;
    console.log(`  duck bus: sfx gain ${d.sfxStorm} in storm vs ${d.sfxClear} clear; storm bed peaks ${d.bedStorm}`);
    for (const k of names) if (audio[k] > .9 || audio[k] < .004) failed = true;
    if (!(d.sfxStorm < d.sfxClear - .1)) { failed = true; console.log('FAIL: the sfx bus does not step back under a storm'); }
    if (d.bedStorm > .5) { failed = true; console.log('FAIL: the storm bed itself is running hot'); }
    // The sfx bus is where the tune lives, so the phase that added it is not allowed to move these two numbers.
    // A band, not an equality: this is a converging exponential read off a live graph, and it lands near .72 / .97.
    if (!(d.sfxStorm >= .70 && d.sfxStorm <= .75) || !(d.sfxClear >= .94 && d.sfxClear <= 1.0)) {
      failed = true;
      console.log(`FAIL: the duck budget moved — sfx gain ${d.sfxStorm}/${d.sfxClear}, want ~0.72 storm / ~0.97 clear`);
    }

    // ---- phase 1: the song, checked rather than admired ----
    const sg = audio.song;
    console.log(`  song: degrees [${sg.degrees.join(' ')}], same twice ${sg.sameTwice}, ` +
      `played-is-derived ${sg.playedIsDerived}, lost returns ${sg.lostReturn} at ${sg.lostPeak.toFixed(4)} ` +
      `against a room floor of ${sg.floor.toFixed(4)} (a sung one peaks ${audio.songTune.toFixed(4)})`);
    if (!(sg.degrees.length >= 6 && sg.degrees.length <= 10)) {
      failed = true; console.log(`FAIL: a phrase is ${sg.degrees.length} degrees, not 6-10`);
    }
    if (!sg.degrees.every(d => Number.isInteger(d) && d >= 0 && d <= 9)) {
      failed = true; console.log('FAIL: a degree fell outside the two octaves of the season\'s five');
    }
    const last = sg.degrees.length - 1;
    if (sg.degrees[last] !== (sg.degrees[last - 1] >= 5 ? 5 : 0)) {
      failed = true; console.log('FAIL: the phrase does not come home to the root');
    }
    if (!sg.sameTwice) { failed = true; console.log('FAIL: one island hummed two different tunes for one story'); }
    if (!sg.playedIsDerived) { failed = true; console.log('FAIL: what was played is not the phrase songDegrees names'); }
    if (sg.lostReturn !== null) { failed = true; console.log('FAIL: a lost song still had a tune to give'); }
    // Against the room's floor times a ratio, not against zero: the wind and the sea wander a few thousandths
    // between windows, and a sung phrase is most of a floor again on top of it (1.8x in practice).
    if (sg.lostPeak > sg.floor * 1.3) {
      failed = true; console.log(`FAIL: a lost song made a sound (${sg.lostPeak} over a floor of ${sg.floor})`);
    }
    if (audio.songTune < sg.floor * 1.5) {
      failed = true; console.log(`FAIL: a song that is not lost is inaudible (${audio.songTune} over ${sg.floor})`);
    }
  }

  // two runs of a seed produce the same degree sequence: the phrase is a function of the island seed and the story's
  // chronicle index, stored nowhere and never drawn from R(). A second island on seed 7 has to hum the same thing.
  {
    const first = await H(() => [0, 1, 2, 3, 4].map(ci => window.__hearth.songDegrees(ci)));
    const other = await openIsland(browser, 7, warns);
    const again = await other.page.evaluate(() => [0, 1, 2, 3, 4].map(ci => window.__hearth.songDegrees(ci)));
    const elsewhere = await other.page.evaluate(() => { window.__hearth.newWorld(8); return window.__hearth.songDegrees(0); });
    await other.ctx.close();
    const same = JSON.stringify(first) === JSON.stringify(again);
    console.log(`songs across two runs of seed 7: ${same ? 'identical' : 'DIFFERENT'} (${first.map(d => d.length).join('/')} degrees)`);
    if (!same) { failed = true; console.log(`FAIL: seed 7 hummed ${JSON.stringify(first[0])} and then ${JSON.stringify(again[0])}`); }
    if (JSON.stringify(elsewhere) === JSON.stringify(first[0])) {
      failed = true; console.log('FAIL: a different island hums the same tune — the seed is not in the phrase');
    }
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
  if (rt.v < 10 || !rt.ln.length || sum(rt.loreN) < 2 || rt.spotKinds.length < 2) { failed = true; console.log('FAIL: walk counts did not survive pack/unpack'); }

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

if (mode === 'fifteen') {
  // sprint 15 observation & force tests: a fresh grave draws natural mourning visits, the visit tiers draw at every
  // threshold, the walking of the bounds now finishes on the hill and touches every stone, and grave visit counts
  // survive pack/unpack (v11); a v10-shaped save (no vn field) still loads clean.
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);
  for (let d = 0; d < 8; d++) await runDay(page, 1e9);

  // kill two islanders with existing relationships, so their deaths draw natural mourning visits from the living
  const died = await H(() => {
    const h = window.__hearth;
    const cand = h.people.filter(p => !p.child && p.rels.length > 0).slice(0, 2);
    const names = cand.map(p => p.name);
    for (const p of cand) h.die(p);
    return names;
  });
  console.log(`killed for graves: ${died.join(', ') || '(none with relationships found)'}`);
  if (died.length < 2) { failed = true; console.log('FAIL: could not find two related islanders to kill'); }

  for (let d = 0; d < 4; d++) await runDay(page, 1e9); // let natural mourning visits happen
  const v0 = await H(() => window.__hearth.graves.map(g => ({ name: g.name, vn: g.vn || 0 })));
  console.log(`grave visits after 4 days of natural mourning: ${JSON.stringify(v0)}`);
  if (!v0.some(g => g.vn > 0)) { failed = true; console.log('FAIL: nobody visited a fresh grave in 4 days'); }

  // the visit marks draw at every tier without throwing
  const tier = await H(() => {
    const h = window.__hearth;
    for (const n of [1, 2, 6, 12]) { h.graves[0].vn = n; try { h.draw(); } catch (e) { return 'threw at vn=' + n + ': ' + e.message; } }
    return 'ok';
  });
  console.log(`grave draw at tiers 1/2/6/12: ${tier}`);
  if (tier !== 'ok') failed = true;

  // grow two named places (same technique as fourteen mode) so the bounds is eligible to walk
  await H(() => {
    const h = window.__hearth;
    h.chron.push({ d: h.dayCount, y: Math.floor((h.dayCount - 1) / 20) + 1, kind: 'rainscame',
      label: 'the day the rain came back', st: 'The drought broke in one great storm, and people stood out in it on purpose.', tl: 3, gr: 1 });
  });
  let named = 0;
  for (let d = 0; d < 16 && named < 2; d++) {
    await H(() => window.__hearth.tellStory());
    await runDay(page, 1e9);
    named = await H(() => window.__hearth.lorePl.length);
  }
  if (named < 2) { failed = true; console.log('FAIL: could not grow two named places to set up the bounds'); }

  // force an elder and a child, clear the graves' counts, and send the walk out — it should finish on the hill
  const led = await H(() => {
    const h = window.__hearth;
    h.skipToMorning();
    const bp = document.getElementById('b-pause'); if (bp.textContent !== '▶') bp.click();
    const adults = h.people.filter(p => !p.child && !p.inBoat && !p.inside && !p.sick && p.task !== 'boat' && p.task !== 'voyage');
    adults[0].age0 = 66; adults[0].born = h.dayCount;
    const k = adults[adults.length - 1]; k.age0 = 8; k.born = h.dayCount;
    for (const g of h.graves) g.vn = 0;
    return h.boundsOut();
  });
  await runDay(page, 1e9);
  const b = await H(() => {
    const h = window.__hearth;
    return {
      shown: h.people.some(p => p.hist.some(x => x.s.includes('who is under every stone'))),
      vn: h.graves.map(g => g.vn || 0),
    };
  });
  // the "names said" line is a forced say() so it always fires, but the log keeps only its last 9 lines and a
  // full day of other activity can push it out before this check runs — the grave touches are the durable signal.
  console.log(`bounds reached the hill: launched ${led}, kid told ${b.shown}, grave touches ${JSON.stringify(b.vn)}`);
  if (!led || !b.shown || b.vn.some(v => v < 1)) { failed = true; console.log('FAIL: the bounds did not finish on the hill'); }

  // grave visit counts survive the save (v11); a v10-shaped save (no vn field) still loads clean, counts fresh
  const rt = await H(() => {
    const h = window.__hearth; const o = h.pack();
    h.unpack(JSON.parse(JSON.stringify(o)));
    return { v: o.v, vn: h.graves.map(g => g.vn || 0) };
  });
  console.log(`round trip: pack v${rt.v}, graves carry vn=${JSON.stringify(rt.vn)}`);
  if (rt.v < 11 || !rt.vn.some(v => v > 0)) { failed = true; console.log('FAIL: grave visit counts did not survive pack/unpack'); }

  const v10ok = await H(() => {
    const h = window.__hearth; const o = h.pack(); o.v = 10;
    o.gv = o.gv.map(a => a.slice(0, 6)); // v10-shaped: no vn field
    try { h.unpack(o); } catch (e) { return 'threw: ' + e.message; }
    return h.graves.length > 0 && h.graves.every(g => (g.vn || 0) === 0) ? 'ok' : 'bad state';
  });
  console.log(`v10 save compat: ${v10ok}`);
  if (v10ok !== 'ok') failed = true;

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: sprint 15 systems behave — the hill remembers too');
}

if (mode === 'sixteen') {
  // sprint 16 observation & force tests: named years derive from the chronicle, conversations carry news to the fire,
  // the children's games run (tag, snowman + melt, stone-skipping behind the watcher's example), the sky layers draw,
  // songs compose / teach / lose, faces inherit (stream discipline holds), anniversaries reach the hill, kin terms resolve,
  // and save v12 round-trips while a forged v11 loads clean.
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);
  for (let d = 0; d < 8; d++) await runDay(page, 1e9);

  // ---- A-1: two idle adults fall into talk and the news walks with them ----
  const chat = await H(() => {
    const h = window.__hearth;
    h.skipToMorning(); const bp = document.getElementById('b-pause'); if (bp.textContent !== '▶') bp.click();
    h.events.push({ d: h.dayCount, y: 1, kind: 'arrival', label: 'the day the news test landed' });
    const far = h.spots[0]; // the far shore: away from the village, so they talk to each other
    const ad = h.people.filter(p => !p.child && !p.inBoat && !p.sick).slice(0, 2);
    if (ad.length < 2) return { fail: 'not enough adults' };
    let chatSeen = false;
    for (let i = 0; i < 4000 && !(ad[0].heard && ad[1].heard); i++) {
      for (const p of ad) {
        if (p.task === 'chat') { chatSeen = true; continue; }
        p.task = 'idle'; p.t = 0; p.chatD = 0; p.inside = false;
        p.x = far.x + (p === ad[0] ? -0.6 : 0.6); p.y = far.y; p.tx = p.x; p.ty = p.y;
        if (p.tgt && p.tgt.claimed) p.tgt.claimed = false; p.tgt = null;
      }
      h.step(0.05);
      if (ad[0].task === 'chat' || ad[1].task === 'chat') chatSeen = true;
    }
    /* a whole chat can start, arrive, and exchange inside one step (the pair spawn adjacent), so the heard fields —
       not a glimpse of the task — are the durable signal */
    return { chatSeen, h0: ad[0].heard ? ad[0].heard.l : null, h1: ad[1].heard ? ad[1].heard.l : null,
      f0: ad[0].heard ? ad[0].heard.f : null, f1: ad[1].heard ? ad[1].heard.f : null };
  });
  console.log(`chat: task glimpsed ${chat.chatSeen}, heard "${chat.h0}" / "${chat.h1}" (had it from: ${chat.f0 || 'was there'} / ${chat.f1 || 'was there'})`);
  if (chat.fail || !chat.h0 || !chat.h1 || !(chat.f0 || chat.f1)) { failed = true; console.log('FAIL: conversations did not carry the news'); }
  const fire = await H(() => {
    const h = window.__hearth;
    const ok = h.tellStory();
    const line = document.getElementById('log').textContent.includes('adds the news of');
    return { ok, line, cleared: h.people.every(p => !p.heard || p.heard.d < h.dayCount - 4) };
  });
  console.log(`fire night: told ${fire.ok}, news line ${fire.line}, heard cleared ${fire.cleared}`);
  if (!fire.ok || !fire.line || !fire.cleared) { failed = true; console.log('FAIL: the fire did not collect the news'); }

  // ---- B-2: a grown, much-told story gets a tune, the tune teaches, and dies with its last knower ----
  await runDay(page, 1e9);
  const song = await H(() => {
    const h = window.__hearth;
    const e = h.chron[0]; e.gr = 1; e.tl = 6; if (!e.st) e.st = e.label; // the landing: always in the fire's spread
    const ad = h.people.filter(p => !p.child);
    if (!ad.some(p => h.musical(p)) && !ad.some(p => p.tr.includes('dreamy') || p.tr.includes('funny'))) ad[0].tr[0] = 'dreamy';
    h.tellStory();
    const sg = h.songs[0];
    return { n: h.songs.length, ev: h.chron.some(x => x.kind === 'song'), kn: sg ? sg.kn.length : 0, ci: sg ? sg.ci : -1, comp: sg ? sg.comp : null };
  });
  console.log(`song composed: ${song.n} (of chron[${song.ci}], by ${song.comp}, ${song.kn} knowers), chronicled ${song.ev}`);
  if (song.n < 1 || !song.ev || song.kn < 1 || song.ci !== 0) { failed = true; console.log('FAIL: a grown story told six times produced no song'); }
  let taught = false, nights = 0;
  if (song.n) {
    // One carrier forgets, so the fire can teach them back. Phase 2 changed who the fire teaches: a song goes to the children with
    // the ear, and an adult who has let one go has let it go — which is the only thing that ever let a song be lost at all, because
    // topping the carriers back up with every musical adult present outran any rate of forgetting. So the one pulled out is a child,
    // made musical if the island has not got one to hand.
    const pulled = await H(() => {
      const h = window.__hearth, age = p => p.age0 + (h.dayCount - p.born) / 20;
      let k = h.people.find(p => p.child && age(p) >= 5) ||
        h.people.filter(p => !p.partner).sort((a, b) => age(a) - age(b))[0];   // six days in there may be no child of five; make one
      if (!k) return null;
      k.child = true; k.age0 = 8; k.born = h.dayCount;
      while (!h.musical(k)) k.seed = (k.seed + 1) >>> 0;
      const sg = h.songs[0]; sg.kn = sg.kn.filter(n => n !== k.name);
      window.__hearth.__pulled = k.name; return k.name;
    });
    if (!pulled) { failed = true; console.log('FAIL: no child of five to teach the song to'); }
    for (let d = 0; d < 6 && !taught; d++) {
      await runDay(page, 1e9); nights++;
      await H(() => window.__hearth.tellStory());
      taught = await H(() => { const h = window.__hearth; return h.people.some(p => p.name === h.__pulled) ? h.songs[0].kn.includes(h.__pulled) : true; });
    }
    console.log(`song taught back after ${nights} fire nights: ${taught}`);
    if (!taught) { failed = true; console.log('FAIL: six fire nights taught the song to nobody'); }
  }

  // ---- C: a partner dies; the song they alone carried dies with them; a year later, the anniversary walk ----
  const loss = await H(() => {
    const h = window.__hearth;
    const ad = h.people.filter(p => !p.child && !p.inBoat).sort((a, b) => (a.age0 + (h.dayCount - a.born) / 20) - (b.age0 + (h.dayCount - b.born) / 20));
    const a = ad[ad.length - 1], b = ad[0]; // the eldest free adult dies; the youngest carries the year
    if (!a || !b || a === b) return { fail: 'not enough adults' };
    a.rels = a.rels.filter(r => r.who !== b.name); b.rels = b.rels.filter(r => r.who !== a.name);
    a.rels.push({ who: b.name, k: 'partner' }); b.rels.push({ who: a.name, k: 'partner' }); a.partner = b.name; b.partner = a.name;
    h.songs.push({ ci: 0, comp: a.name, kn: [a.name], lost: 0, d: h.dayCount });
    const sg = h.songs[h.songs.length - 1];
    h.die(a);
    window.__widow = b.name; window.__grave = a.name;
    return { lost: !!sg.lost, ev: h.chron.some(x => x.kind === 'songlost'), other: !!h.songs[0].lost, day: h.dayCount };
  });
  console.log(`song loss: sentinel lost ${loss.lost}, chronicled ${loss.ev}, shared song untouched ${!loss.other}`);
  if (loss.fail || !loss.lost || !loss.ev || loss.other) { failed = true; console.log('FAIL: the last knower died and the song did not die with them'); }
  for (let d = 0; d < 22; d++) await runDay(page, 1e9);
  const anniv = await H(() => {
    const h = window.__hearth;
    const b = h.people.find(p => p.name === window.__widow);
    const gr = h.graves.find(g => g.name === window.__grave);
    return { alive: !!b, hist: b ? b.hist.some(x => x.s.includes('a year to the day')) : false, vn: gr ? gr.vn || 0 : -1 };
  });
  console.log(`anniversary: widow alive ${anniv.alive}, hist line ${anniv.hist}, grave visits ${anniv.vn}`);
  if (anniv.alive && (!anniv.hist || anniv.vn < 1)) { failed = true; console.log('FAIL: the anniversary did not reach the hill'); }

  // ---- B-1: named years are pure derivation, first match wins (year 1 is long finished by now) ----
  const yn = await H(() => {
    const h = window.__hearth;
    h.chron.push({ d: 3, y: 1, kind: 'fever', label: 'a forged fever', st: 'x', tl: 0, gr: 0 });
    const a = h.yearName(1); h.chron.pop();
    const b = h.yearName(1);
    const c = h.yearName(Math.floor((h.dayCount - 1) / 20) + 1); // the running year has no name yet
    h.renderChron();
    const hdr = document.getElementById('chron-roll').innerHTML.includes('year 1 — ');
    return { a, b, c: c === null ? 'null' : c, hdr };
  });
  console.log(`year names: forged fever "${yn.a}", plain year 1 "${yn.b}", unfinished ${yn.c}, header carries name ${yn.hdr}`);
  if (yn.a !== 'the year of the fever' || !yn.b || yn.b === 'a quiet year' || yn.c !== 'null' || !yn.hdr) { failed = true; console.log('FAIL: yearName derivation is wrong'); }

  // ---- kin terms resolve one generation up, through the living and the dead ----
  const kin = await H(() => {
    const h = window.__hearth;
    const ad = h.people.filter(p => !p.child).slice(0, 3);
    if (ad.length < 3) return { fail: 'not enough adults' };
    ad[0].parents = [ad[1].name]; ad[1].parents = [ad[2].name];
    const viaLiving = h.kinOf(ad[0]).includes(ad[2].name);
    h.dead.push({ name: 'Testgran', rels: [{ who: ad[1].name, k: 'child' }], dead: true, hist: [], tr: [] });
    ad[1].parents = []; ad[1].rels.push({ who: 'Testgran', k: 'parent' });
    const viaDead = h.kinOf(ad[0]).includes('Testgran');
    ad[0].parents = []; ad[1].parents = []; ad[1].rels = ad[1].rels.filter(r => r.who !== 'Testgran'); h.dead.pop();
    return { viaLiving, viaDead };
  });
  console.log(`kin: grandparent via living ${kin.viaLiving}, via the dead list ${kin.viaDead}`);
  if (kin.fail || !kin.viaLiving || !kin.viaDead) { failed = true; console.log('FAIL: kinOf does not climb one generation'); }

  // ---- faces: the substitution path is pixel-identical for the derived skin, and actually substitutes for another ----
  const face = await H(() => {
    const h = window.__hearth;
    const p = h.people.find(q => !q.child);
    const cv2 = document.createElement('canvas'); cv2.width = cv2.height = 16; const c2 = cv2.getContext('2d');
    const snap = () => { h.drawFace(c2, p); return cv2.toDataURL(); };
    const base = snap(); const der = h.skinOf(p);
    p.fSk = der; const same = snap() === base;
    p.fSk = (der + 1) % 5; const diff = snap() !== base;
    delete p.fSk;
    return { der, same, diff };
  });
  console.log(`faces: derived skin ${face.der}; fSk=derived is pixel-identical ${face.same}; fSk=other differs ${face.diff}`);
  if (!face.same || !face.diff) { failed = true; console.log('FAIL: the drawFace stream discipline broke'); }

  // ---- A-2: the children's games, forced in daylight ----
  const kids = await H(() => {
    const h = window.__hearth;
    h.skipToMorning(); const bp = document.getElementById('b-pause'); if (bp.textContent !== '▶') bp.click();
    const free = h.people.filter(p => !p.child && !p.inBoat && !p.inside && !p.sick && p.task !== 'boat' && p.task !== 'voyage');
    if (free.length < 2) return { fail: 'not enough free adults to make kids of' };
    const k1 = free[0], k2 = free[free.length - 1];
    for (const k of [k1, k2]) { k.age0 = 8; k.born = h.dayCount; k.child = true; k.partner = null; }
    const fireSpot = h.spots.find(s => s.l === 'the fire');
    let tagSeen = false;
    for (let i = 0; i < 1500 && !tagSeen; i++) {
      for (const k of [k1, k2]) if (k.task !== 'tag') { k.task = 'play'; k.t = 0; k.x = fireSpot.x + (k === k1 ? -1 : 1); k.y = fireSpot.y + 2; k.tx = k.x; k.ty = k.y; if (k.tgt && k.tgt.claimed) k.tgt.claimed = false; k.tgt = null; }
      h.step(0.05);
      if (k1.task === 'tag' || k2.task === 'tag') tagSeen = true;
    }
    h.setSnow(0.9);
    let snowman = 0;
    for (let i = 0; i < 3000 && !snowman; i++) {
      for (const k of [k1, k2]) if (k.task !== 'snowman') { k.task = 'play'; k.t = 0; k.x = fireSpot.x + (k === k1 ? -2 : 2); k.y = fireSpot.y + 2; k.tx = k.x; k.ty = k.y; }
      h.step(0.05);
      snowman = h.snowmen.length;
    }
    const builtAt = h.snowmen.length;
    h.setSnow(0); h.step(0.05);
    const melted = h.snowmen.length === 0;
    h.setSkipN(1);
    const beach = h.spots.find(s => s.l === 'the near beach');
    let skipSeen = false;
    for (let i = 0; i < 2500 && !skipSeen; i++) {
      for (const k of [k1, k2]) if (k.task !== 'kidskip') { k.task = 'play'; k.t = 0; k.x = beach.x; k.y = beach.y; k.tx = k.x; k.ty = k.y; }
      h.step(0.05);
      if (h.skips.length) skipSeen = true;
    }
    return { tagSeen, builtAt, melted, skipSeen };
  });
  console.log(`kids: tag ${kids.tagSeen}, snowman built ${kids.builtAt > 0}, melted when the snow went ${kids.melted}, stone skipped ${kids.skipSeen}`);
  if (kids.fail || !kids.tagSeen || !kids.builtAt || !kids.melted || !kids.skipSeen) { failed = true; console.log('FAIL: the children did not play'); }

  // ---- A-3: every sky layer draws without error; the aurora predicate is pure ----
  const sky = await H(() => {
    const h = window.__hearth;
    try {
      h.rbSet(h.time + 30); h.draw();
      h.shoots.push({ x: 40, y: 10, vx: 18, vy: 6, l: 0.7 }); h.draw();
      h.snowmen.push({ x: 41, y: 31, s: 1, d: 1 });
      for (const s of [1, 0.6, 0.2]) { h.snowmen[0].s = s; h.draw(); }
      h.snowmen.pop(); h.shoots.pop(); h.rbSet(0);
      h.setSnow(0.9); h.draw(); h.step(0.05); h.draw(); h.setSnow(0); // footprints path
    } catch (e) { return 'threw: ' + e.message; }
    const a1 = h.auroraNight(), a2 = h.auroraNight();
    return a1 === a2 ? 'ok' : 'aurora not pure';
  });
  console.log(`sky layers draw: ${sky}`);
  if (sky !== 'ok') failed = true;

  // ---- save: v12 round-trips the new state; a forged v11 loads clean ----
  const rt = await H(() => {
    const h = window.__hearth;
    h.setSkipN(3); h.snowmen.push({ x: 40, y: 30, s: 0.8, d: h.dayCount });
    const p0 = h.people.find(p => !p.child) || h.people[0];
    p0.heard = { l: 'a carried thing', d: h.dayCount, f: 0 }; p0.fSk = 2;
    const o = h.pack(); h.unpack(JSON.parse(JSON.stringify(o)));
    const q0 = h.people.find(p => p.name === p0.name);
    return { v: o.v, songs: h.songs.length, lost: h.songs.filter(s => s.lost).length, snowmen: h.snowmen.length,
      skipN: h.skipN, heard: q0 && q0.heard ? q0.heard.l : null, fSk: q0 ? q0.fSk : -9 };
  });
  console.log(`round trip: pack v${rt.v} — songs ${rt.songs} (${rt.lost} lost), snowmen ${rt.snowmen}, skipN ${rt.skipN}, heard "${rt.heard}", fSk ${rt.fSk}`);
  if (rt.v < 12 || rt.songs < 2 || rt.lost < 1 || rt.snowmen < 1 || rt.skipN !== 3 || rt.heard !== 'a carried thing' || rt.fSk !== 2) { failed = true; console.log('FAIL: v12 state did not survive pack/unpack'); }
  const v11ok = await H(() => {
    const h = window.__hearth; const o = h.pack(); o.v = 11;
    delete o.sg; delete o.sm; delete o.ss;
    o.pe.forEach(a => a.length = 27);
    try { h.unpack(o); } catch (e) { return 'threw: ' + e.message; }
    return h.people.length > 0 && h.songs.length === 0 && h.snowmen.length === 0 && h.skipN === 0 &&
      h.people.every(p => p.fSk === undefined && !p.heard) ? 'ok' : 'bad state';
  });
  console.log(`v11 save compat: ${v11ok}`);
  if (v11ok !== 'ok') failed = true;

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: sprint 16 systems behave — the island talks to itself');
}

if (mode === 'decade') {
  // Phase 2. Four of the island's systems pay out on a scale nothing had ever been run at: heirlooms passing, the walking of the
  // bounds, elders telling children of the dead, a song being lost. Every sprint from 12 to 16 wrote a version of "this pays out on
  // decade-old islands, nothing to fix" instead of finding out. Two fixed seeds, twenty-five game-years each, and every one of the
  // four has to happen on its own — no forcing, no setting a flag first. Thirty-five game-years and not the twenty the plan asked for
  // because the first natural handing-down was measured at day 459, 469, 503 and 637 across four runs of these two seeds: a thing is
  // made by whoever first masters a craft, and that person then has to live out the rest of a life before it can pass to anyone. The
  // island's first heirloom is a year-23-to-32 event, and no amount of wanting it at year 20 makes it one.
  const years = parseInt(arg('years', '35'));
  const days = years * 20;
  const seeds = arg('seeds', '7,20260819').split(',').filter(Boolean).map(Number);
  const auditEvery = parseInt(arg('audit', '100'));
  console.log(`decade: ${years} game-years (${days} days) x seeds [${seeds.join(', ')}], audit every ${auditEvery} steps\n`);
  for (const seed of seeds) {
    const warns = [];
    const { ctx, page } = await openIsland(browser, seed, warns);
    let viol = [], audits = 0;
    const t0 = Date.now();
    for (let d = 0; d < days; d++) {
      const r = await runDay(page, auditEvery);
      viol = viol.concat(r.viol); audits += Math.floor(r.steps / auditEvery) + 1;
    }
    const s = await page.evaluate(() => {
      const H = window.__hearth, firstOf = k => { const e = H.chron.find(e => e.kind === k); return e ? e.d : 0 };
      return {
        day: H.dayCount, pop: H.people.length, graves: H.graves.length, chron: H.chron.length,
        bounds: H.chron.filter(e => e.kind === 'bounds').length, boundsD: firstOf('bounds'),
        heir: H.chron.filter(e => e.kind === 'heir').length, heirD: firstOf('heir'),
        lost: H.songs.filter(s => s.lost).length, lostD: firstOf('songlost'), songs: H.songs.length,
        told: H.people.filter(p => p.hist.some(x => x.s.includes('who died before'))).length,
        grown: H.chron.filter(e => e.gr).length, places: H.lorePl.length,
        carriers: H.songs.filter(s => !s.lost).map(s => s.kn.filter(n => H.people.some(p => p.name === n)).length).join('/'),
        stumps: JSON.stringify(H.pack().su).length, hist: Math.max(...H.people.map(p => p.hist.length)),
        packLen: JSON.stringify(H.pack()).length,
      };
    });
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`seed ${seed} @ day ${s.day} (year ${Math.floor((s.day - 1) / 20) + 1}), ${mins} min: pop ${s.pop}, ${s.graves} stones, ${s.chron} things remembered`);
    console.log(`  stories grown ${s.grown}, named places ${s.places}, songs ${s.songs} (carried by ${s.carriers || 'nobody'})`);
    console.log(`  the four: bounds walked ${s.bounds} (first day ${s.boundsD || '—'}), heirlooms passed ${s.heir} (first day ${s.heirD || '—'}),` +
      ` songs lost ${s.lost} (first day ${s.lostD || '—'}), children told of the dead ${s.told}`);
    console.log(`  bounds: stumps ${s.stumps} bytes, longest life-story ${s.hist} lines, save ${s.packLen} bytes`);
    const missing = [];
    if (!s.bounds) missing.push('the bounds were never walked');
    if (!s.heir) missing.push('nothing was ever handed down');
    if (!s.lost) missing.push('no song was ever lost');
    if (!s.told) missing.push('no child was ever told about somebody under a stone');
    // and the two lists that used to grow for as long as the island did stay where phase 2 put them. A 500-day island carried 1,102
    // stumps in 17,677 bytes before the cap; 240 of them pack into about 2,900.
    if (s.stumps > 3600) missing.push(`the stumps are unbounded again (${s.stumps} bytes)`);
    if (s.hist > 60) missing.push(`a life story ran past the cap (${s.hist} lines)`);
    if (missing.length) { failed = true; console.log(`  FAIL: ${missing.join('; ')}`); }
    if (viol.length) { failed = true; console.log(`  FAIL: ${viol.length} audit violations:`); [...new Set(viol)].slice(0, 10).forEach(v => console.log('    ' + v)); }
    if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
    console.log(`  ~${audits} full-cast audits, ${viol.length} violations`);
    await ctx.close();
  }

  // ---- and the generational speed is the same island ----
  // Two fresh copies of one seed driven through real frames — the same step() calls at the same dt in both, one frame at a time and
  // FAST frames at a time — and the pack hashes have to match. If they do not, something the fast path skips is not presentation.
  const fdays = parseInt(arg('fastdays', '12'));
  const hashes = [], counts = [];
  for (const mult of [1, 'FAST']) {
    const warns = [];
    const { ctx, page } = await openIsland(browser, 7, warns);
    const n = await page.evaluate(({ DT, fdays, mult }) => {
      const H = window.__hearth;
      H.speed = mult === 'FAST' ? H.FAST : 1;
      // dayLen 140, and rounded up to a whole number of FAST frames so both runs make exactly the same number of step() calls —
      // a step count that is not a multiple of FAST leaves the fast run one part-frame ahead and reports a divergence that is arithmetic.
      const steps = Math.ceil(fdays * 140 / DT / H.FAST) * H.FAST;
      let frames = 0;
      for (let i = 0; i < steps; i += H.speed) { H.frame(DT, true); frames++ }
      const speed = H.speed; H.speed = 1;   // pack() carries `sp`, the speed the watcher left it at: the one thing legitimately different
      return { frames, speed, day: H.dayCount };
    }, { DT, fdays, mult });
    hashes.push(await packHash(page));
    counts.push(n);
    console.log(`  ${n.speed}x: ${n.frames} frames to day ${n.day}, pack hash ${hashes[hashes.length - 1]}`);
    if (warns.length) { failed = true; [...new Set(warns)].slice(0, 6).forEach(v => console.log('  WARN ' + v)); }
    await ctx.close();
  }
  const same = hashes[0] === hashes[1];
  console.log(`\nthe generational speed, ${counts[0].frames} frames against ${counts[1].frames}: ${same ? 'the same island' : 'A DIFFERENT ISLAND'}`);
  if (!same || counts[0].day !== counts[1].day) { failed = true; console.log('FAIL: the fast path is not the same simulation'); }

  console.log(failed ? '\nFAIL' : '\nPASS: a decade happens on its own, and happens the same at both speeds');
}

if (mode === 'migrate') {
  // Phase 3: every save shape the ladder still accepts, forged out of one live island and walked back up, in one place.
  // The six forgeries this consolidates lived inline in `eleven` through `sixteen`, one per mode, each written by hand against the
  // ladder that existed on the day of its sprint — which is how the v7 one came to leave the sprint-10 keys in and nobody noticed.
  // These are forged with save.js's own `forge()`, the LADDER walked backwards, so a hop cannot be added without its inverse.
  const warns = [];
  const { ctx, page } = await openIsland(browser, 7, warns);
  const H = fn => page.evaluate(fn);
  for (let d = 0; d < 6; d++) await runDay(page, 1e9);

  // Force the state every older shape is documented to read as empty. Shape is what is under test here, not plausibility.
  await H(() => {
    const h = window.__hearth;
    h.chron.push({ d: h.dayCount, y: 1, kind: 'landing', label: 'a forced entry', st: 'A forced entry.', tl: 6, gr: 1 });
    h.songs.push({ ci: h.chron.length - 1, comp: h.people[0].name, kn: h.people.map(p => p.name), lost: 0, d: h.dayCount });
    h.snowmen.push({ x: 40, y: 30, s: .8, d: h.dayCount });
    h.setSkipN(3);
    h.people[0].heard = { l: 'a carried thing', d: h.dayCount, f: 0 }; h.people[0].fSk = 2;
    h.things.push({ n: 'a test comb', full: 'a test comb', holder: 0, src: 'found', hist: [{ d: 1, s: 'found' }] });
    h.works.push({ wk: 'racks', x: 38, y: 30, y0: 1, done: true, prog: 99, paid: 1, said: 1 });
    h.works.push({ wk: 'bench', x: 40, y: 30, y0: 1, done: false, prog: 7.5, paid: 1, said: 0 });
    h.graves.push({ x: 50, y: 20, name: 'A Forced Name', d: 2, y2: 1, age: 70, vn: 4 });
    for (const k of ['landing', 'rainscame']) if (!h.lorePl.includes(k)) { h.lorePl.push(k); h.setLoreN(k, 3); }
    h.setFaith(.5);
  });

  // A current island packs, unpacks and re-packs byte-identical: the ladder must not touch a save already at SAVE_V.
  const same = await H(() => {
    const h = window.__hearth, a = JSON.stringify(h.pack());
    h.unpack(JSON.parse(a));
    return { v: h.SAVE_V, min: h.SAVE_MIN, ok: a === JSON.stringify(h.pack()), len: a.length };
  });
  console.log(`ladder v${same.min}..v${same.v}; a v${same.v} island round-trips byte-identical: ${same.ok} (${same.len} bytes)`);
  if (!same.ok) { failed = true; console.log('FAIL: pack -> unpack -> pack is not byte-identical at the current version'); }

  const cur = await H(() => JSON.stringify(window.__hearth.pack()));

  // Every shape the gate accepts, derived from the gate rather than listed beside it — a SAVE_MIN the ladder has no hop for is the
  // bug this catches, and a hard-coded list of fixtures cannot see it. Two things are asserted per shape: the migrated object is the
  // *current* shape, slot for slot, and the island it unpacks into reads empty where the version says it should. The first of those
  // is not decoration: an `up` made a no-op leaves 6-field graves, `unpack` reads `a[6]` as undefined, and every count downstream
  // treats undefined as zero — so the empty-reads alone pass a ladder that is doing nothing at all.
  const FIXTURES = [];
  for (let v = same.v - 1; v >= same.min; v--) FIXTURES.push(v);
  for (const v of FIXTURES) {
    const r = await page.evaluate(({ cur, v }) => {
      const h = window.__hearth, o = h.forge(JSON.parse(cur), v);
      if (o.v !== v) return { err: `forge landed on v${o.v}, not v${v} — the ladder has no hop that low` };
      if (!h.canLoad(o)) return { err: 'canLoad refused a shape the ladder claims to accept' };
      h.migrate(o);
      const wide = (rows, dflt) => rows && rows.length ? Math.min(...rows.map(a => a.length)) : dflt;
      const shape = { v: o.v, pe: wide(o.pe, 29), vo: o.vo && o.vo[5] ? o.vo[5].length : 29, gv: wide(o.gv, 7),
        wk: wide(o.wk, 8), ch: wide(o.ch, 7),
        gone: ['lp', 'ln', 'by', 'sg', 'sm', 'ss', 'hl', 'hy', 'fa', 'fs', 'ay', 'ax'].filter(k => o[k] === undefined) };
      try { h.unpack(o); } catch (e) { return { err: 'threw: ' + e.message } }
      try { h.pack(); } catch (e) { return { err: 'packs no more: ' + e.message } }
      return { shape,
        pop: h.people.length, songs: h.songs.length, snowmen: h.snowmen.length, skipN: h.skipN,
        heard: h.people.some(p => p.heard), fSk: h.people.some(p => p.fSk !== undefined),
        vn: h.graves.reduce((a, g) => a + (g.vn || 0), 0), graves: h.graves.length,
        loreN: Object.keys(h.loreN).length, lorePl: h.lorePl.length, spots: h.spots.filter(s => s.lore).length,
        things: h.things.length, wip: h.works.filter(w => !w.done).length, works: h.works.length, faith: h.faith,
        prog: h.works.map(w => w.prog).join('/'),
      };
    }, { cur, v });
    if (r.err) { failed = true; console.log(`  v${v}: FAIL — ${r.err}`); continue; }
    const bad = [], sh = r.shape;
    if (sh.v !== same.v) bad.push(`the ladder stopped at v${sh.v}`);
    if (sh.pe !== 29 || sh.vo !== 29) bad.push(`people came up ${sh.pe}/${sh.vo} slots wide, not 29`);
    if (sh.gv !== 7 || sh.wk !== 8 || sh.ch !== 7) bad.push(`rows came up gv ${sh.gv}/7, wk ${sh.wk}/8, ch ${sh.ch}/7`);
    if (sh.gone.length) bad.push(`the ladder left ${sh.gone.join(', ')} missing`);
    if (!r.pop) bad.push('nobody loaded');
    if (v <= 11 && (r.songs || r.snowmen || r.skipN || r.heard || r.fSk)) bad.push('v12 state came through a v11 save');
    if (v <= 10 && r.vn) bad.push(`graves came back with ${r.vn} visits`);
    if (v <= 10 && !r.graves) bad.push('the hill went with them');
    if (v <= 9 && r.loreN) bad.push('walk counts came through a v9 save');
    if (v <= 9 && v > 8 && !r.lorePl) bad.push('a v9 save lost its named places');
    if (v <= 8 && (r.lorePl || r.spots)) bad.push('named places came through a v8 save');
    if (v <= 7 && (r.things || r.wip)) bad.push('heirlooms or a work in progress came through a v7 save');
    if (v <= 7 && r.works !== 1) bad.push(`a v7 save should keep its one finished work, kept ${r.works}`);
    if (v <= 7 && r.prog !== '99') bad.push(`a v7 work should come back at prog 99, came back at ${r.prog}`);
    if (v <= 9 && v > 8 && r.loreN) bad.push('walk counts came through a v9 save');
    if (v <= 6 && r.faith) bad.push('faith came through a v6 save');
    console.log(`  v${v}: pop ${r.pop}, songs ${r.songs}, snowmen ${r.snowmen}, skipN ${r.skipN}, grave-visits ${r.vn}, ` +
      `loreN ${r.loreN}, places ${r.lorePl}, things ${r.things}, works ${r.works} (${r.wip} wip, prog ${r.prog || '-'}), faith ${r.faith}` +
      `, shape ${r.shape.pe}/${r.shape.gv}/${r.shape.wk}/${r.shape.ch}` +
      (bad.length ? `  !! ${bad.join('; ')}` : '  ok'));
    if (bad.length) failed = true;
  }

  // and the range itself, by the one gate both readers now share. Not SAVE_MIN-1 and SAVE_V+1 — those are computed from the very
  // constants under test, so moving one moves the assertion with it and the check says nothing. Literals, and the ladder above is
  // what proves the range is one the ladder can actually walk.
  const gate = await H(() => {
    const h = window.__hearth, o = JSON.parse(JSON.stringify(h.pack()));
    return { low: h.canLoad({ ...o, v: 4 }), high: h.canLoad({ ...o, v: 13 }), nope: h.canLoad({ ...o, pe: undefined }) };
  });
  console.log(`the gate: v4 ${gate.low}, v13 ${gate.high}, no people ${gate.nope} — all three must be false`);
  if (gate.low || gate.high || gate.nope) { failed = true; console.log('FAIL: canLoad accepts something it should not'); }

  if (warns.length) { failed = true; [...new Set(warns)].slice(0, 10).forEach(v => console.log('  WARN ' + v)); }
  await ctx.close();
  console.log(failed ? '\nFAIL' : '\nPASS: every shape v5 through v12 comes up the ladder and reads empty where it should');
}

if (mode === 'saga') {
  // Phase 4. The saga export is a rendering of state that already exists, so the only way it can be wrong is by disagreeing with
  // that state — a year called by the wrong name, a grown story that reads as ungrown, a song listing somebody who is dead. So:
  // run an island long enough to have all four, generate the page, load it back into a blank tab as a reader would, and read every
  // claim off the DOM to compare against chron, songs, graves, loreN, things and yearName(). Nothing here reuses the export's own
  // helpers to build its expectation; a test that calls songLine() to check songLine() checks nothing.
  const days = parseInt(arg('days', '400'));
  const seeds = arg('seeds', '7').split(',').filter(Boolean).map(Number);
  console.log(`saga: ${days} days x seeds [${seeds.join(', ')}]\n`);
  for (const seed of seeds) {
    const warns = [];
    const { ctx, page } = await openIsland(browser, seed, warns);
    let viol = [];
    for (let d = 0; d < days; d++) { const r = await runDay(page, 100); viol = viol.concat(r.viol); }

    // what the island actually holds, in its own terms
    const want = await page.evaluate(() => {
      const H = window.__hearth, live = n => H.people.some(p => p.name === n);
      const years = [];
      for (const e of H.chron) if (!years.some(y => y.n === e.y)) years.push({ n: e.y, name: H.yearName(e.y) });
      return {
        village: H.village, seed36: H.seed.toString(36), day: H.dayCount,
        title: `The chronicle of ${H.village || 'an island with no name'}`,
        years, entries: H.chron.length,
        days: H.chron.map(e => e.d), ys: H.chron.map(e => e.y),
        grownDays: H.chron.filter(e => e.gr).map(e => e.d),
        // songs are pushed in the order they were made and the saga renders them where their story sits, which is not the same order
        songs: H.songs.filter(s => s.ci < H.chron.length).sort((a, b) => a.ci - b.ci)
          .map(s => ({ day: H.chron[s.ci].d, comp: s.comp, lost: !!s.lost, kn: s.kn.filter(live), knAll: s.kn.length })),
        people: H.people.map(p => p.name).sort(),
        gone: H.gone.map(p => p.name),
        graves: H.graves.slice().sort((a, b) => a.d - b.d).map(g => ({ name: g.name, y2: g.y2, age: g.age, vn: g.vn || 0 })),
        ground: H.spots.filter(s => s.lore).map(s => ({ l: s.l, n: H.loreN[s.k] || 0 })),
        things: H.things.map(t => ({ full: t.full, holder: t.holder || '', hist: t.hist.length })),
      };
    });
    const html = await page.evaluate(() => window.__hearth.sagaHTML());

    // read it back the way a reader would: a blank tab, the file, and nothing else
    const rd = await ctx.newPage();
    await rd.setContent(html);
    const got = await rd.evaluate(() => {
      const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const all = s => [...document.querySelectorAll(s)];
      const link = document.querySelector('header .link a');
      return {
        title: txt(document.querySelector('h1')),
        docTitle: document.title,
        sub: txt(document.querySelector('header .sub')),
        href: link ? link.getAttribute('href') : null,
        years: all('main section.yr').map(s => ({
          head: txt(s.querySelector('h2')),
          days: [...s.querySelectorAll('p.e')].map(p => txt(p.querySelector('.d'))),
        })),
        entries: all('main p.e').length,
        grown: all('main p.e.gr').map(p => ({ day: txt(p.querySelector('.d')), tl: txt(p.querySelector('em.tl')) })),
        songs: all('main p.e.sg').map(p => ({ day: txt(p.querySelector('.d')), lost: p.classList.contains('lost'), line: txt(p.querySelector('em.s')) })),
        people: all('#app-people li b').map(b => txt(b)).sort(),
        away: txt(document.querySelector('#app-people .sub')),
        hill: all('#app-hill li').map(li => ({ name: txt(li.querySelector('b')), i: txt(li.querySelector('i')) })),
        ground: all('#app-ground li').map(li => ({ l: txt(li.querySelector('b')), i: txt(li.querySelector('i')) })),
        things: all('#app-things li').map(li => ({ full: txt(li.querySelector('b')), i: txt(li.querySelector('i')), hist: li.querySelectorAll('.h').length })),
        scripts: document.querySelectorAll('script').length,
        offsite: all('link[href],img[src],iframe[src]').length,
      };
    });
    await rd.close();

    const bad = [];
    const eq = (what, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${what}: saga says ${JSON.stringify(a)}, island says ${JSON.stringify(b)}`) };

    // the run has to have produced the things the export is being tested on, or the comparisons below are all vacuously true
    const thin = [];
    if (!want.grownDays.length) thin.push('no story ever grew');
    if (!want.songs.length) thin.push('no song was ever made');
    if (!want.graves.length) thin.push('nobody is under the hill');
    if (!want.ground.length) thin.push('no ground was ever named');
    if (!want.things.length) thin.push('nothing was ever made or found');
    if (want.years.length < 4) thin.push(`only ${want.years.length} years happened`);
    // the carriers line is the one claim that can be wrong while looking right: kn keeps the name of everybody who ever had the tune,
    // living or not. At 170 days nobody who had ever learned a song had died yet, and dropping the living-only filter altogether
    // still passed. The run is only long enough when at least one song has outlived one of its carriers.
    if (!want.songs.some(s => s.knAll > s.kn.length))
      thin.push('no song has outlived a carrier, so the living-only filter is untested');
    if (thin.length) bad.push(`the run is too thin to prove anything (${thin.join('; ')}) — raise --days`);

    eq('the title', got.title, want.title);
    eq('the browser-tab title', got.docTitle, want.title);
    eq('the entry count', got.entries, want.entries);
    if (!got.sub || !got.sub.includes(`island ${want.seed36}`) || !got.sub.includes(`day ${want.day}`))
      bad.push(`the subtitle does not name island ${want.seed36} on day ${want.day}: ${got.sub}`);

    // the years, and their names, straight off the headings
    eq('the year headings', got.years.map(y => y.head),
      want.years.map(y => `year ${y.n}${y.name ? ' ' + y.name : ''}`));
    eq('the entries under each year', got.years.map(y => y.days),
      want.years.map(y => want.days.filter((d, i) => want.ys[i] === y.n).map(d => `day ${d}`)));

    // grown stories, and the mark that says so
    eq('the grown stories', got.grown.map(g => g.day), want.grownDays.map(d => `day ${d}`));
    for (const g of got.grown) if (g.tl !== 'as it is told now') bad.push(`a grown story on ${g.day} is not marked: ${g.tl}`);

    // songs: every carrier named, and nobody named who is not carrying it
    eq('the songs', got.songs.map(s => s.day), want.songs.map(s => `day ${s.day}`));
    got.songs.forEach((s, i) => {
      const w = want.songs[i]; if (!w) return;
      if (s.lost !== w.lost) bad.push(`the song on ${s.day} is ${s.lost ? '' : 'not '}marked lost, and the island says ${w.lost ? '' : 'not '}lost`);
      if (w.lost) { if (!/^the song of it is lost/.test(s.line)) bad.push(`a lost song on ${s.day} reads: ${s.line}`); return }
      const m = s.line.match(/^made into a song by (.+?) · carried by (.+)$/);
      if (!m) { bad.push(`a song on ${s.day} does not say who made or carries it: ${s.line}`); return }
      if (m[1] !== w.comp) bad.push(`the song on ${s.day} credits ${m[1]}, and the island says ${w.comp}`);
      const named = m[2] === 'nobody now' ? [] : m[2].split(', ');
      if (JSON.stringify(named) !== JSON.stringify(w.kn))
        bad.push(`the song on ${s.day} is carried by [${named}], and the island says [${w.kn}]`);
    });

    // the four appendices
    eq('the people', got.people, want.people);
    if (want.gone.length && (!got.away || !want.gone.every(n => got.away.includes(n))))
      bad.push(`the ones away over the water are missing: ${want.gone.join(', ')} vs ${got.away}`);
    eq('the hill', got.hill.map(h => h.name), want.graves.map(g => g.name));
    got.hill.forEach((h, i) => {
      const g = want.graves[i]; if (!g) return;
      const wantI = `year ${g.y2}, aged ${g.age} · ${g.vn ? `${g.vn} visit${g.vn === 1 ? '' : 's'}` : 'not visited yet'}`;
      if (h.i !== wantI) bad.push(`the stone for ${h.name} reads "${h.i}", and the island says "${wantI}"`);
    });
    eq('the named ground', got.ground.map(g => g.l), want.ground.map(g => g.l));
    got.ground.forEach((g, i) => {
      const w = want.ground[i]; if (!w) return;
      const wantI = w.n ? `${w.n} stone${w.n === 1 ? '' : 's'} on the cairn` : 'no cairn yet';
      if (g.i !== wantI) bad.push(`${g.l} reads "${g.i}", and the island says "${wantI}"`);
    });
    eq('the things', got.things.map(t => t.full), want.things.map(t => t.full));
    got.things.forEach((t, i) => {
      const w = want.things[i]; if (!w) return;
      if (t.hist !== w.hist) bad.push(`${t.full} shows ${t.hist} hands and the island says ${w.hist}`);
      const wantI = w.holder ? `held by ${w.holder}` : 'on the shelf in the hall';
      if (t.i !== wantI) bad.push(`${t.full} reads "${t.i}", and the island says "${wantI}"`);
    });

    // zero dependencies, and a way back to the island it came out of
    if (got.scripts || got.offsite) bad.push(`the saga is not self-contained: ${got.scripts} scripts, ${got.offsite} external references`);
    if (!got.href) bad.push('the saga carries no link back to the island');
    else {
      const back = await page.evaluate(h => {
        const H = window.__hearth, i = h.indexOf('#');
        if (i < 0) return { ok: false, why: 'no hash' };
        try { const o = JSON.parse(H.lzDec(h.slice(i + 1))); return { ok: H.canLoad(o), day: o.d, seed: o.s } }
        catch (e) { return { ok: false, why: e.message } }
      }, got.href);
      if (!back.ok) bad.push(`the link does not carry a loadable island: ${back.why || 'canLoad said no'}`);
      else if (back.day !== want.day || back.seed !== seed) bad.push(`the link carries island ${back.seed} day ${back.day}, not ${seed} day ${want.day}`);
    }

    console.log(`seed ${seed} @ day ${want.day}: ${want.entries} entries over ${want.years.length} years, ${want.grownDays.length} grown, ` +
      `${want.songs.length} song${want.songs.length === 1 ? '' : 's'} (${want.songs.filter(s => s.lost).length} lost)`);
    console.log(`  appendices: ${want.people.length} people, ${want.graves.length} stones, ${want.ground.length} named places, ${want.things.length} things`);
    console.log(`  the page: ${(html.length / 1024).toFixed(1)} KB, ${got.scripts} scripts, ${got.offsite} external references, link back ${got.href ? 'present' : 'MISSING'}`);
    if (viol.length) { failed = true; console.log(`  FAIL: ${viol.length} audit violations:`); [...new Set(viol)].slice(0, 6).forEach(v => console.log('    ' + v)) }
    if (warns.length) { failed = true; [...new Set(warns)].slice(0, 6).forEach(v => console.log('  WARN ' + v)) }
    if (bad.length) { failed = true; bad.forEach(b => console.log('  FAIL ' + b)) }
    await ctx.close();
  }
  console.log(failed ? '\nFAIL' : '\nPASS: the saga says exactly what the island says');
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
