// smoke-page.mjs — Daredevil's regression suite. Real browser, real clicks.
//
//   node Projects/daredevil/test/smoke-page.mjs [--headed]
//
// Exits non-zero on any failure (locked decision #13).
//
// This game had no test of any kind and shipped three routing bugs that between
// them made it impossible to finish: every hub gated its milestone button on a
// counter that could not reach zero, `_minigame_stunt_m3` was named by four
// choices and answered by nothing, and Milestones 3, 4 and 5 all read
// `res.outcome` off a result object whose field is `res.result`. None of them
// throws. None of them logs anything a player would see. The only thing that
// catches this class of bug is playing the game to the end and checking where
// you landed, so that is what this does.
//
// Two runs, deliberately different: one clean, one that crashes at the fair and
// takes the other side of every fork it can reach. Between them they cover both
// stunt outcomes, both Milestone 1 aftermaths, and the two ends of the Ruthie
// thread — which is the branch that used to decide whether the game soft-locked.

import { boot, open, snapshot, pick, autopilot, wait, SAVE_KEY } from './drive-daredevil.mjs';

let pass = 0, fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.error('  FAIL ' + what); }
};
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const headed = process.argv.includes('--headed');
const MAX_STEPS = 2000;
const STALL_LIMIT = 6;

/**
 * Play to the end screen, following `rules`, and return what happened.
 *
 * Throws on a dead end rather than running out the step budget: a click that
 * changes nothing is precisely the shape every bug in this file had, so the
 * driver has to be able to name it.
 */
async function playToEnd(page, base, plan) {
  const seen = [];
  let lastScene = null, fingerprint = '', stalled = 0;
  const stunts = [];
  const visits = {};

  await open(page, base, { name: plan.name, town: plan.town });

  for (let step = 0; step < MAX_STEPS; step++) {
    const s = await snapshot(page);

    const fp = [s.screen, s.scene, s.text, s.hub,
                s.buttons.map(b => b.label + (b.locked ? '!' : '')).join('|')].join('§');
    stalled = fp === fingerprint ? stalled + 1 : 0;
    fingerprint = fp;
    if (stalled >= STALL_LIMIT)
      throw new Error(`dead end: ${STALL_LIMIT} clicks on "${s.screen}" (scene ${s.scene}) changed nothing`);

    if (s.scene && s.scene !== lastScene && s.screen === 'panel') {
      lastScene = s.scene;
      seen.push(s.scene);
      // A cycle, as distinct from a frozen screen: the display keeps changing so
      // the stall fingerprint never fires, but the story is going round. A hub
      // card whose scene does not set the flag the card is gated on does this,
      // and `fr1_wannabe_intro` did exactly that on two of its three answers.
      const n = (visits[s.scene] = (visits[s.scene] || 0) + 1);
      if (n > 3) throw new Error(
        `loop: entered "${s.scene}" ${n} times. Last 10: ${seen.slice(-10).join(' → ')}`);
    }

    if (s.screen === 'end') return { seen, stunts, stats: s.stats, rels: s.rels, flags: s.flags };
    if (s.screen === 'reporter') { stunts.push({ verdict: s.verdict, score: Number(s.score) }); await pick(page, 'Accept Result'); await wait(280); continue; }
    if (s.screen === 'minigame') { await autopilot(page, plan.stunt); continue; }
    if (s.screen === 'chapter') { await pick(page, s.buttons[0].label); await wait(650); continue; }
    if (s.screen === 'stats') { await pick(page, 'Continue'); await wait(180); continue; }

    if (s.screen === 'panel') {
      const play = s.buttons.filter(b => !b.save);
      const choices = play.filter(b => !/^— Continue —$|^Continue ›$/.test(b.label));
      if (!choices.length) { await pick(page, 'Continue'); continue; }
      const rule = plan.rules.find(r => choices.some(c => !c.locked && c.label.toLowerCase().includes(r.toLowerCase())));
      const target = rule
        ? choices.find(c => !c.locked && c.label.toLowerCase().includes(rule.toLowerCase()))
        : choices.find(c => !c.locked);
      await pick(page, target.label);
      await wait(180);
      continue;
    }

    if (s.screen === 'hub') {
      const cards = s.buttons.filter(b => !b.save && !b.locked);
      if (!cards.length) throw new Error(`hub "${s.hub}" has nothing clickable and no way forward`);
      const advance = cards.find(c => /^Milestone \d/.test(c.label));
      await pick(page, (cards.filter(c => c !== advance)[0] || advance).label);
      await wait(220);
      continue;
    }

    throw new Error(`stuck on screen "${s.screen}"`);
  }
  throw new Error(`ran ${MAX_STEPS} steps without reaching an ending`);
}

const t = await boot({ headed });

try {
  /* ============================================================ the page */

  await t.page.goto(t.base + '/Projects/daredevil/index.html', { waitUntil: 'load' });
  await t.page.evaluate(() => document.fonts.ready);
  await wait(300);

  // `page.__blocked` is NOT the check for a font hotlink coming back:
  // prepPage() fulfills fonts.googleapis.com locally before the blocked list is
  // written, so the request never reaches it. Grep the served HTML instead.
  {
    const html = await (await fetch(t.base + '/Projects/daredevil/index.html')).text();
    // Match a real reference — an attribute value or a CSS url() — not a
    // comment that happens to name the host. The comment above the @font-face
    // block explains what these replaced, and a bare hostname grep flags it.
    const hotlink = /(?:href|src)\s*=\s*["'][^"']*fonts\.(?:googleapis|gstatic)\.com/i.test(html)
                 || /url\(\s*["']?https?:\/\/fonts\./i.test(html);
    eq(hotlink, false, 'no Google Fonts hotlink in the HTML');
    ok(/@font-face/.test(html), 'the page declares its own @font-face rules');
  }

  // Read the ending screen's rendered text rather than grepping source, for
  // the same reason: the markup carries a comment naming the old placeholder.
  {
    const endText = await t.page.evaluate(() =>
      document.getElementById('screen-end').innerText.replace(/\s+/g, ' '));
    eq(/END OF BUILD|Implementation Complete|Round 2/.test(endText), false,
       'no dev placeholder text on the ending screen');
  }
  eq(t.page.__blocked.length, 0, 'no offsite requests at all');
  eq(t.page.__errs.length, 0, `no console or page errors on load (${t.page.__errs.join('; ')})`);

  // The vendored files actually resolve. A 404 here reads as a working page
  // with the wrong typeface, which nothing else would catch.
  for (const f of ['alfa-slab-one-latin-400-normal', 'oswald-latin-400-normal', 'space-mono-latin-700-normal']) {
    const r = await fetch(`${t.base}/Projects/daredevil/fonts/${f}.woff2`);
    eq(r.status, 200, `${f}.woff2 is served`);
  }

  ok(await t.page.evaluate(() => !!window.__dd), 'the module booted and published its handle');
  eq(await t.page.evaluate(() => window.__dd.slot.key), 'daredevil-save-v1', 'the storage key is the locked one');

  /* ========================================= every route target is answered */

  // The bug that ended every run: an id named by a choice with nothing behind
  // it. Walk every `goto`/`next` in SCENES and confirm goToScene can serve it.
  {
    const missing = await t.page.evaluate(() => {
      const { SCENES } = window.__dd;
      const targets = new Set();
      for (const sc of Object.values(SCENES)) {
        if (sc.next) targets.add(sc.next);
        for (const ch of sc.choices || []) if (ch.goto) targets.add(ch.goto);
      }
      // A leading underscore means goToScene handles it procedurally. There is
      // no list of those to check against, so probe the source of goToScene.
      const src = window.__dd.goToScene.toString();
      return [...targets].filter(id =>
        !SCENES[id] && !(id.startsWith('_') && src.includes(`'${id}'`)));
    });
    eq(missing.length, 0, `every goto/next target is routable (unrouted: ${missing.join(', ') || 'none'})`);
  }

  /* ================================================ a full run, clean stunts */

  const clean = await playToEnd(t.page, t.base, {
    name: 'Duke Harlan', town: 'Buford County', stunt: 'good',
    rules: ['The irrigation ditch', 'Option A'],
  });

  ok(clean.seen.length > 70, `the clean run reaches an ending (${clean.seen.length} scenes)`);
  ok(clean.seen.includes('m3_entry'), 'it reaches Milestone 3');
  ok(clean.seen.includes('m3_triumph_clean') || clean.seen.includes('m3_triumph_messy'),
     'a well-ridden Milestone 3 routes to a triumph, not a failure');
  ok(clean.seen.includes('fr3_hub_open'), 'it reaches Free Roam 3');
  ok(clean.seen.includes('m4_stunt_select'), 'it reaches the Milestone 4 stunt choice');
  ok(clean.seen.some(s => s.startsWith('m4_triumph')), 'a well-ridden Milestone 4 routes to a triumph');
  ok(clean.seen.includes('fr4_hub_open') || clean.seen.includes('fr4_hub_open_failure'), 'it reaches Free Roam 4');
  ok(clean.seen.includes('m5_decision'), 'it reaches the Milestone 5 decision');
  ok(clean.seen.some(s => s.startsWith('m5_')), 'it takes one of the eight endings');
  ok(clean.stunts.length >= 2, `it played at least two stunt runs (${clean.stunts.map(s => s.verdict + '/' + s.score).join(', ')})`);
  ok(clean.stunts.every(s => s.verdict === 'SUCCESS' || s.verdict === 'PARTIAL'),
     'the autopilot landed every stunt it was asked to land');
  eq(t.page.__errs.length, 0, `no page errors across the whole clean run (${t.page.__errs.slice(0, 3).join('; ')})`);

  /* ================================== the save round trip, mid-run, for real */

  {
    // Start a second run and stop at a hub, which is where a player pauses.
    await open(t.page, t.base, { name: 'Ada Vance', town: 'Ridgemont' });
    let guard = 0;
    while (await t.page.evaluate(() => window.__dd && document.getElementById('screen-hub').classList.contains('active')) === false) {
      if (++guard > 400) throw new Error('never reached a hub');
      const s = await snapshot(t.page);
      if (s.screen === 'minigame') { await autopilot(t.page, 'good'); continue; }
      if (s.screen === 'reporter') { await pick(t.page, 'Accept Result'); await wait(280); continue; }
      if (s.screen === 'chapter') { await pick(t.page, s.buttons[0].label); await wait(650); continue; }
      const play = s.buttons.filter(b => !b.save && !b.locked);
      await pick(t.page, play[0].label);
      await wait(150);
    }

    const before = await t.page.evaluate(() => {
      const g = window.__dd.GS;
      return { name: g.name, town: g.town, stats: { ...g.stats }, flags: { ...g.flags } };
    });
    const stored = await t.page.evaluate(k => localStorage.getItem(k), SAVE_KEY);
    ok(!!stored, 'reaching a hub wrote a save');
    eq(JSON.parse(stored).screen, 'hub', 'the save says to resume at a hub');

    // Reload. The title screen should offer Continue, and taking it should put
    // the same run back on screen.
    await t.page.reload({ waitUntil: 'load' });
    await wait(400);
    const title = await snapshot(t.page);
    ok(title.buttons.some(b => b.label === 'Continue'), 'a stored save puts Continue on the title screen');
    ok(title.buttons.some(b => b.label === 'New Game'), 'and renames Begin to New Game');
    await pick(t.page, 'Continue');
    await wait(400);

    const after = await t.page.evaluate(() => {
      const g = window.__dd.GS;
      return { name: g.name, town: g.town, stats: { ...g.stats }, flags: { ...g.flags } };
    });
    eq(after.name, before.name, 'the name survives a reload');
    eq(after.town, before.town, 'the town survives a reload');
    eq(JSON.stringify(after.stats), JSON.stringify(before.stats), 'the stats survive a reload');
    eq(after.flags.hubEveningsUsed, before.flags.hubEveningsUsed, 'spent evenings survive a reload');
    eq(JSON.stringify(after.flags.hubEveningsDone), JSON.stringify(before.flags.hubEveningsDone),
       'which evenings were spent survives a reload');
    eq(await snapshot(t.page).then(s => s.screen), 'hub', 'Continue lands back on the hub');

    // Break it on purpose (locked decision #34): a corrupt blob must be refused,
    // not parsed into game state.
    await t.page.evaluate(k => localStorage.setItem(k, '{"name":"x","stats":'), SAVE_KEY);
    await t.page.reload({ waitUntil: 'load' });
    await wait(400);
    const corrupt = await snapshot(t.page);
    eq(corrupt.screen, 'title', 'a corrupt save still boots to the title screen');
    ok(!corrupt.buttons.some(b => b.label === 'Continue'), 'and offers no Continue');

    await t.page.evaluate(k => localStorage.setItem(k, JSON.stringify(
      { format: 'gvb-save', game: 'fourth-quarter', version: 2, state: { day: 4, staff: [] } })), SAVE_KEY);
    await t.page.reload({ waitUntil: 'load' });
    await wait(400);
    ok(!(await snapshot(t.page)).buttons.some(b => b.label === 'Continue'),
       "another game's save is not offered as a Daredevil save");
  }

  /* ============================== a second run: crash at the fair, other forks */

  const rough = await playToEnd(t.page, t.base, {
    name: 'Mack Teller', town: 'Cold Spring', stunt: 'crash',
    rules: ['The water tower', 'Option D', 'Option C', 'Option B'],
  });

  ok(rough.seen.length > 60, `the crash run also reaches an ending (${rough.seen.length} scenes)`);
  ok(rough.stunts.some(s => s.verdict === 'FAIL'), 'holding the throttle open does crash the bike');
  ok(rough.seen.some(s => s.startsWith('m1_stunt_crash') || s === 'm1_stunt_clipped'),
     'a crashed Milestone 1 routes to a crash aftermath');
  ok(rough.seen.includes('m5_decision'), 'a run that started badly still reaches the Milestone 5 decision');
  ok(rough.seen.join() !== clean.seen.join(), 'the two runs take genuinely different paths');
  eq(t.page.__errs.length, 0, `no page errors across the crash run (${t.page.__errs.slice(0, 3).join('; ')})`);

  /* ================================================================ mobile */

  {
    const m = await (await import('../../../Tools/board-check/harness.mjs'))
      .prepPage(t.browser, t.base, { width: 375, height: 812, dsf: 2, mobile: true });
    await m.goto(t.base + '/Projects/daredevil/index.html', { waitUntil: 'load' });
    await m.evaluate(() => document.fonts.ready);
    await wait(300);
    const overflow = await m.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 0, `no horizontal overflow at 375x812 (${overflow}px)`);
    eq(m.__errs.length, 0, `no errors on mobile (${m.__errs.join('; ')})`);
    await m.close();
  }

} catch (e) {
  fail++;
  console.error('\n  FAIL (threw) ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
} finally {
  await t.done();
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
