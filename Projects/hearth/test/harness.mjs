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
const GAME = pathToFileURL(path.join(HERE, '..', 'hearth.html')).href;
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

// use the environment's Chromium when the pinned playwright version's own download is absent
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
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
      };
    });
    console.log(`seed ${seed} @ day ${s.day}: pop ${s.pop}`);
    console.log(`  crafts field/wood/sea/frame/store: ${s.crafts.join('/')} (uncrafted ${s.none}), masters ${s.masters}, kids shadowing ${s.shad}`);
    console.log(`  works: [${s.works}]  bread-days ${s.breads}  returners ${s.backs}  found-objects ${s.found}  mastery-events ${s.mastEvents}  store ${s.granary}`);
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
