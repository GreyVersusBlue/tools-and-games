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
// Three runs, deliberately different: one clean, one that crashes at the fair
// and takes the other side of every fork it can reach, and one that turns Earl
// down. Between them they cover both stunt outcomes, both Milestone 1
// aftermaths, the two ends of the Ruthie thread — which is the branch that used
// to decide whether the game soft-locked — and both Milestone 2s.

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
  let lastScene = null, lastText = null, fingerprint = '', stalled = 0;
  const stunts = [];
  const visits = {};
  // The first sight of each hub, as rendered: which cards were up and which
  // were locked. Assert against this for anything about what a hub offered,
  // not against the save (#39).
  const hubs = {};
  // Everything the run was shown, in order, tagged with the scene it was on:
  // prose and choice labels off the panel, stat-update titles and reasons,
  // chapter cards, hub cards. A branch that quietly reads the other branch's
  // line throws nothing; the only way to catch it is to read what the player
  // read and grep it (#39, and the wishlist's "grep a transcript for a name").
  const texts = [];
  const shown = (where, text) => { if (text) texts.push({ scene: lastScene, where, text }); };

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

    if (s.screen === 'end') {
      const summary = await page.evaluate(() =>
        document.getElementById('end-summary').innerText.replace(/\s+/g, ' ').trim());
      return { seen, stunts, hubs, texts, summary, stats: s.stats, rels: s.rels, flags: s.flags };
    }
    if (s.screen === 'reporter') { stunts.push({ verdict: s.verdict, score: Number(s.score) }); await pick(page, 'Accept Result'); await wait(280); continue; }
    if (s.screen === 'minigame') { await autopilot(page, plan.stunt); continue; }
    if (s.screen === 'chapter') { shown('chapter', s.chapter + ' — ' + s.chapterDesc); await pick(page, s.buttons[0].label); await wait(650); continue; }
    if (s.screen === 'stats') {
      // The rel rows go in the log with the headline. They are the only place
      // the game announces a relationship move, and the Earl sweep below reads
      // them: a solo run that quietly set rels.earl would say so here.
      shown('stats', s.update + ' — ' + s.reason
        + s.relRows.map(r => ` [${r.who}: ${r.state}]`).join(''));
      await pick(page, 'Continue'); await wait(180); continue;
    }

    if (s.screen === 'panel') {
      const play = s.buttons.filter(b => !b.save);
      const choices = play.filter(b => !/^— Continue —$|^Continue ›$/.test(b.label));
      if (s.text !== lastText) { lastText = s.text; shown('panel', s.speaker + ': ' + s.text); }
      if (!choices.length) { await pick(page, 'Continue'); continue; }
      shown('choices', choices.map(c => c.label).join(' | '));
      const rule = plan.rules.find(r => choices.some(c => !c.locked && c.label.toLowerCase().includes(r.toLowerCase())));
      const target = rule
        ? choices.find(c => !c.locked && c.label.toLowerCase().includes(rule.toLowerCase()))
        : choices.find(c => !c.locked);
      await pick(page, target.label);
      await wait(180);
      continue;
    }

    if (s.screen === 'hub') {
      if (!hubs[s.hub]) { hubs[s.hub] = s.buttons.filter(b => !b.save).map(b => ({ label: b.label, locked: b.locked })); shown('hub', s.buttons.filter(b => !b.save).map(b => b.label).join(' | ')); }
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

  /* ---------------------------------------------------- Phase 4 drive helpers */

  // Two small drivers for things no full run reaches. Both start a real run,
  // patch the relationship bag and the flags, and then let the game do the
  // rest: goToScene, buildLines, the hub renderers, afterScene and
  // triggerStatUpdate are all the game's own. Nothing here re-implements a
  // rule it is checking (#34) — the pair only reads what the page drew.
  const fromScene = async (patch, scene) => {
    await open(t.page, t.base, { name: 'Jo Reyes', town: 'Marfa' });
    const first = await snapshot(t.page);
    if (first.screen === 'chapter') { await pick(t.page, first.buttons[0].label); await wait(650); }
    await t.page.evaluate(([p, sc]) => {
      Object.assign(window.__dd.GS.flags, p.flags || {});
      Object.assign(window.__dd.GS.rels, p.rels || {});
      window.__dd.goToScene(sc);
    }, [patch, scene]);
    await wait(220);
    const texts = [];
    for (let i = 0; i < 60; i++) {
      const s = await snapshot(t.page);
      if (s.screen !== 'panel')
        return { texts, screen: s.screen, relRows: s.relRows || [], cards: s.buttons.filter(b => !b.save).map(b => b.label), choices: [] };
      if (s.text && s.text !== texts[texts.length - 1]) texts.push(s.text);
      const choices = s.buttons.filter(b => !b.save && !/^— Continue —$|^Continue ›$/.test(b.label));
      if (choices.length) return { texts, screen: 'panel', relRows: [], cards: [], choices: choices.map(c => c.label) };
      await pick(t.page, 'Continue');
      await wait(110);
    }
    throw new Error(`${scene} never settled`);
  };
  // What a hub put on the board for a given relationship bag.
  const hubCards = async (patch, route) => (await fromScene(patch, route)).cards;

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

  // Phase 2. Both Free Roam closes were written with an arm for each branch,
  // and on the backer branch nothing named either: `fr2_close`'s phone call
  // from Earl about the car show and `fr4_close`'s "tell the man from
  // California yes" had been in the file, finished, unread by any run.
  ok(clean.seen.includes('fr2_close'), 'the backer branch closes Free Roam 2 through fr2_close');
  ok(clean.seen.includes('fr4_close'), 'and Free Roam 4 through fr4_close');
  {
    const closes = clean.texts.filter(x => x.scene === 'fr2_close' || x.scene === 'fr4_close');
    ok(closes.some(x => /\bEarl\b/.test(x.text)),
       `and reads the arm of each with Earl in it (${closes.length} lines across the two)`);
  }
  ok(clean.stunts.every(s => s.verdict === 'SUCCESS' || s.verdict === 'PARTIAL'),
     'the autopilot landed every stunt it was asked to land');

  // Phase 4. `rels.tommy` was 'hanger_on' at the first line and 'hanger_on' at
  // the ending screen on every run this suite had ever played, while
  // `fr4_eve_tommy` carried a paragraph behind `=== 'ally'`. The clean run
  // takes the first answer at every fork, which is now the whole track: ask
  // him what he does (Free Roam 1), hand him the car show's warm-up slot
  // (Free Roam 2), let the twelve people be a good thing to want (Free Roam 3).
  eq(clean.rels && clean.rels.tommy, 'ally', 'the clean run ends with Tommy an ally, not a hanger-on');
  ok(clean.seen.includes('fr1_eve_bar_him'), 'it asked him what he had been doing');
  ok(clean.seen.includes('fr2_eve_bar_hinkle'), 'and gave him the forty minutes before the gate');
  ok(clean.seen.includes('fr3_eve_tommy_true'), 'and let the twelve people stand');
  ok(/Tommy: Ally/.test(clean.summary), 'and the ending screen says Ally');
  {
    const bar4 = clean.texts.filter(x => x.scene === 'fr4_eve_tommy');
    ok(bar4.some(x => /there he is is probably the most accurate thing/.test(x.text)),
       `the Free Roam 4 ally paragraph is read by a real run (${bar4.length} lines at fr4_eve_tommy)`);
    ok(bar4.some(x => /nineteen Tommy was expecting next time/.test(x.text)),
       'and the line that reads tommyKnowsWhatHeWants');
  }

  // Phase 4, Danny. Every run goes through `m1_rival_rumor`; the clean run
  // takes the first answer there, which schemes, which is what puts the Free
  // Roam 2 card on the board and `danny: 'nemesis'` in the bag. Free Roam 3's
  // new card is the rest of it.
  ok(clean.seen.includes('fr3_danny'), 'the clean run is told somebody signed Danny');
  ok(clean.seen.includes('fr3_danny_call'), 'and calls him');
  eq(clean.rels && clean.rels.danny, 'poached', 'which leaves him poached rather than a rival');
  ok(/Danny: Poached/.test(clean.summary), 'and the ending screen says Poached');

  // Found by this phase's own transcripts, and the same bug Phase 1 fixed one
  // panel over: the clean run retires to a retrospective that read "He made
  // the call. Earl first, then Cal, then Ruthie" — on a run where Ruthie was
  // never established and has no row in the Relationships block six lines
  // below it. The line is built from who is actually in the run now.
  ok(!/Ruthie:/.test(clean.summary), 'the clean run never established Ruthie');
  ok(!/then Ruthie/.test(clean.summary),
     `so the retirement retrospective does not call her either (${(clean.summary.match(/He made the call\..{0,70}/) || ['no retrospective line'])[0]})`);
  ok(/He made the call\. Earl first, then Cal, then Tommy\./.test(clean.summary),
     'and it names the three people who are there, in the order the line has always implied');
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

  // Phase 2, and the reason transcript.mjs now writes the rel rows down. This
  // is the run that answers Cal's tell at Milestone 2 instead of shaking on
  // the spot, and until now that one fork was the only thing that set
  // `rels.earl` and `m2Complete`. Take the other and Duke signed Earl's
  // contract, shook his hand, took his percentage and reached the ending with
  // Earl 'unknown': no Earl row, none of the `backer` epilogue, and
  // currentHubRoute() unable to tell Free Roam 2 from Free Roam 1.
  ok(rough.seen.includes('m2_use_tell'), 'the crash run signs by way of Cal\'s tell, not the straight handshake');
  {
    const signing = rough.texts.find(x => x.scene === 'm2_sign' && x.where === 'stats');
    ok(signing && /\[Earl Maddox: Business Partner\]/.test(signing.text),
       `the signing screen says what the signing did (${signing ? signing.text : 'no stat screen at m2_sign'})`);
  }
  ok(/Earl Maddox: Business Partner/.test(rough.summary),
     'and the ending screen lists him');
  ok(/return on investment/.test(rough.summary),
     "and reads the backer paragraph, not \"still being decided\"");
  eq(rough.flags && rough.flags.m2Complete, true,
     'm2Complete is set by the signing, which is what currentHubRoute reads');
  // Phase 4, the other end of the same track. The crash run takes the last
  // answer it can find at every fork: it never asks Tommy about Tommy, so the
  // car-show answer is not on the Free Roam 2 board at all, and it measures
  // twelve people against a career in Free Roam 3. `TOMMY_NOT_GONE` and
  // `TOMMY_PRESENT` gate two hub cards on a state nothing could write until
  // now; this is the run where the second one closes.
  eq(rough.rels && rough.rels.tommy, 'absent', 'the crash run loses Tommy');
  ok(rough.seen.includes('fr1_eve_bar_fair'), 'it let him finish the flatbed story instead');
  ok(!rough.seen.includes('fr2_eve_bar_hinkle'), 'so the car-show answer was never offered');
  ok(rough.seen.includes('fr3_eve_tommy_measured'), 'and it measured the twelve people against a career');
  ok(!rough.seen.includes('fr4_eve_tommy'), "so his Free Roam 4 evening is off the board");
  ok(/Tommy: Absent/.test(rough.summary), 'and the ending screen says Absent');
  // The same run declines Danny at the fair, so he is never in the story and
  // the roster leaves him off rather than printing him at '—'.
  eq(rough.rels && rough.rels.danny, 'unknown', 'the crash run never meets Danny');
  ok(!rough.seen.includes('fr3_danny'), 'so the Free Roam 3 card is never on its board');
  ok(!/Danny:/.test(rough.summary), 'and he has no row on its ending screen');
  {
    // The `no_danny` transcript's real finding. Two scenes carried a history
    // with Danny in it unconditionally: `fr2_eve_bar`'s walk home remembering
    // "Danny's setup at the fair. The fire trick" — on a run that never went
    // and looked at his ramp — and `fr2_close`'s "still doing the thing where
    // he said the accurate thing in the wrong way", which is a two-year
    // acquaintance the run does not have.
    const assumed = rough.texts.filter(x =>
      /Danny's setup|still doing the thing where he said the accurate thing|thought about Danny more than he wanted to/.test(x.text));
    eq(assumed.length, 0,
       `nothing the crash run is shown claims a history with Danny (${assumed.map(x => x.scene + ': ' + x.text.slice(0, 45)).join(' | ') || 'none'})`);
    const cleanAssumed = clean.texts.filter(x =>
      /Danny's setup|still doing the thing where he said the accurate thing/.test(x.text));
    ok(cleanAssumed.length >= 2,
       `and a run that did meet him still reads both lines (${cleanAssumed.length})`);
  }
  eq(t.page.__errs.length, 0, `no page errors across the crash run (${t.page.__errs.slice(0, 3).join('; ')})`);

  /* ================= a third run: "Not interested", and the game notices */

  // Phase 1. Before it, five of six answers to Earl and the sixth all led to
  // `m2_entry*`, where Earl negotiated anyway and `m2_sign` set rels.earl back
  // to 'backer'. Answering "Not interested" now has to land in the solo
  // chapter, keep Earl absent to the ending, and put the twelve hundred
  // dollars in front of the player before Free Roam 2 offers anything else.
  const solo = await playToEnd(t.page, t.base, {
    name: 'Ray Dockery', town: 'Split Oak', stunt: 'good',
    rules: ['Not interested'],
  });

  ok(solo.seen.includes('m1_r6'), 'the run answered "Not interested" at the fair');
  ok(solo.seen.includes('m2_solo_entry'), 'a rejected Earl routes Milestone 2 to the solo chapter');
  ok(solo.seen.includes('m2_solo_close'), 'and the solo chapter plays through to its close');
  ok(!solo.seen.some(s => s === 'm2_entry' || s === 'm2_entry_waited' || s === 'm2_entry_recovery'),
     "it never enters Earl's office");
  ok(!solo.seen.includes('m2_sign'), 'and never signs with him');
  ok(solo.seen.includes('fr2_hub_open'), 'the solo close still opens Free Roam 2 on the same scene');
  {
    const debtAt = solo.seen.indexOf('fr2_debt_01');
    const firstFr2Other = solo.seen.findIndex(s => /^fr2_/.test(s) && s !== 'fr2_hub_open' && !/^fr2_debt/.test(s));
    ok(debtAt > -1, 'the twelve hundred dollars comes up on the solo branch');
    ok(debtAt > -1 && (firstFr2Other === -1 || debtAt < firstFr2Other),
       `and it comes before any other Free Roam 2 card (debt at ${debtAt}, first other at ${firstFr2Other})`);
    ok(!solo.seen.includes('fr2_debt_earl'), 'the "Borrow from Earl" answer is not offered');
    // The hub as first rendered, not the path the driver took through it: the
    // driver drains cards before it takes a milestone button, so a Milestone 3
    // button offered over the unpaid cars would never show in `seen` (#266).
    const fr2 = solo.hubs['Free Roam — Building the Act'] || [];
    const open2 = fr2.filter(b => !b.locked).map(b => b.label);
    eq(open2.length, 1, `the first Free Roam 2 board has exactly one unlocked card (${open2.map(l => l.slice(0, 30)).join(' | ')})`);
    ok(/^The Cost/.test(open2[0] || ''), 'and it is The Cost');
    ok(!fr2.some(b => /^Milestone 3/.test(b.label)), 'no Milestone 3 button is offered while the cars are unpaid');
    ok(fr2.some(b => b.locked && /The cars first/.test(b.label)), 'the locked evenings say why they are locked');
  }
  eq(solo.rels && solo.rels.earl, 'absent', 'Earl is still absent on the ending screen');
  eq(solo.flags && solo.flags.soloM2, true, 'the save records that the solo chapter was taken');
  ok(solo.seen.includes('m5_decision'), 'the solo run reaches the Milestone 5 decision');

  // Phase 1, increment 2: Milestones 3 and 4, Free Roam 3 and 4 and the
  // endings on a run with no backer. Before it, the solo run read a sponsor's
  // logo on the ramp, Earl at the bottom of it, Earl's folder of proposals,
  // Earl told first at the retirement — thirty-one lines of a deal it never
  // signed. The rule now: from Milestone 3's first scene to the ending
  // screen, nothing the player is shown names Earl. (The solo Milestone 2 and
  // Free Roam 2 name him on purpose — the card he left on the ramp, the rider
  // who said no — so the sweep starts where increment 2's work starts.) The
  // ending screen's own line about walking away from him is not in the log.
  {
    const start = solo.texts.findIndex(t => t.scene === 'm3_entry');
    ok(start > -1, 'the text log has Milestone 3 in it');
    const earl = solo.texts.slice(start).filter(t => /\bEarl\b/.test(t.text));
    eq(earl.length, 0, `nothing shown from Milestone 3 on names Earl (${earl.slice(0, 4).map(t => `${t.scene}/${t.where}: ${t.text.slice(0, 50)}`).join(' | ') || 'none'})`);
    ok(solo.texts.slice(start).some(t => /Kessler/.test(t.text)), 'and the Speedway promoter is who is there instead');
  }
  ok(!solo.seen.includes('m4_prestunt_earl_m4'), 'the Milestone 4 eve is never spent with Earl');
  ok(solo.seen.includes('fr4_eve_california'), 'the man from California calls for himself in Free Roam 4');
  ok(!solo.seen.includes('fr4_eve_earl'), "and Earl's Free Roam 4 evening is never played");
  ok(solo.seen.includes('fr4_close'), 'the solo branch reads fr4_close on the way to Milestone 5');
  ok(solo.seen.includes('fr2_close'), 'and fr2_close on the way to Milestone 3');
  {
    const fr4 = solo.hubs['Free Roam — Aftermath'] || [];
    ok(fr4.some(b => /^The Man from California/.test(b.label)), 'the first Free Roam 4 board offers the man from California');
    ok(!fr4.some(b => /^Earl Maddox/.test(b.label)), 'and no Earl Maddox card');
  }
  eq(t.page.__errs.length, 0, `no page errors across the solo run (${t.page.__errs.slice(0, 3).join('; ')})`);

  /* ============== Milestone 5's last stunt carries the decision (Phase 2) */

  // Two ways into the last stunt — Duke picked it (`m5_last_stunt_setup`) or
  // Earl did (`m5_last_stunt_earl`) — and one pair of outcome scenes between
  // them. Both scenes named `last_stunt_win`/`last_stunt_loss` flatly, so
  // `m5Outcome === 'last_stunt_earl'` — a headline, a nerve verdict and a
  // three-line retrospective, all written — was true on no run ever played.
  //
  // Driven, not replayed: the decision is set and the real outcome scene is
  // entered, and everything after it is the game's own — the scene's own
  // statUpdate, afterScene(), triggerStatUpdate(), showGameEnd(). Nothing here
  // knows the mapping it is checking. A fourth full playthrough would cost
  // eight minutes to reach the same two scenes.
  const endFromScene = async (patch, scene) => {
    await open(t.page, t.base, { name: 'Hal Mercer', town: 'Kestrel' });
    const first = await snapshot(t.page);
    if (first.screen === 'chapter') { await pick(t.page, first.buttons[0].label); await wait(650); }
    await t.page.evaluate(([p, sc]) => {
      Object.assign(window.__dd.GS.flags, p.flags || {});
      Object.assign(window.__dd.GS.rels, p.rels || {});
      window.__dd.goToScene(sc);
    }, [patch, scene]);
    for (let i = 0; i < 60; i++) {
      const s = await snapshot(t.page);
      if (s.screen === 'end') break;
      await pick(t.page, 'Continue');
      await wait(150);
    }
    const s = await snapshot(t.page);
    if (s.screen !== 'end') throw new Error(`${scene} never reached an ending (stuck on ${s.screen})`);
    return {
      outcome: s.flags.m5Outcome,
      summary: await t.page.evaluate(() =>
        document.getElementById('end-summary').innerText.replace(/\s+/g, ' ').trim()),
    };
  };

  {
    const planned = await endFromScene({ flags: { m5Decision: 'last_stunt_planned' } }, 'm5_stunt_win');
    eq(planned.outcome, 'last_stunt_win', 'a last stunt Duke picked and cleared is still last_stunt_win');

    const earlWin = await endFromScene({ flags: { m5Decision: 'last_stunt_earl' } }, 'm5_stunt_win');
    eq(earlWin.outcome, 'last_stunt_earl', 'a last stunt Earl picked is last_stunt_earl');
    ok(/Greatest Act Was a Man Named Duke/.test(earlWin.summary), 'and it gets its own headline');
    ok(/trusted Earl with the last call/.test(earlWin.summary), 'and its own nerve verdict');
    ok(/Earl picked the canyon/.test(earlWin.summary), 'and its own retrospective');
    ok(/cleared it\. He thought: alright\. That was somebody else's number, and I found it anyway/.test(earlWin.summary),
       'whose third line says he cleared it when he did');

    const earlLoss = await endFromScene({ flags: { m5Decision: 'last_stunt_earl' } }, 'm5_stunt_loss');
    eq(earlLoss.outcome, 'last_stunt_earl', 'whether or not he cleared it');
    ok(/didn't clear it\. He got up\. He thought: alright\. That was somebody else's number\./.test(earlLoss.summary),
       'and says he did not when he did not');
  }

  /* ================================ Danny gets a way out of it (Phase 4) */

  // Diamondback Danny could only ever be 'frenemy' or 'nemesis', both written
  // by the same Free Roam 2 card, and the cast table carried labels for
  // 'poached' and 'absent' that no run could reach. The clean run above plays
  // the 'poached' half for real — every run passes through `m1_rival_rumor`,
  // and the clean run schemes there — so what is driven here is the rest: the
  // card's gate in both directions, the answer that loses him, and the two
  // branches of the signing, which no run in this suite can reach at once.
  {
    const met = { rels: { danny: 'nemesis' }, flags: { fr3Started: true } };
    const board = await hubCards(met, '_hub_fr3');
    ok(board.some(l => /^Diamondback Danny/.test(l)),
       `Free Roam 3 offers the Danny card to a run that met him (${board.map(l => l.split('\n')[0]).join(' | ')})`);
    const cold = await hubCards({ flags: { fr3Started: true } }, '_hub_fr3');
    ok(!cold.some(l => /^Diamondback Danny/.test(l)),
       'and does not offer it to a run that never did');
    const already = await hubCards({ ...met, flags: { fr3Started: true, fr3DannySigned: true } }, '_hub_fr3');
    ok(!already.some(l => /^Diamondback Danny/.test(l)), 'and offers it once');

    const called = await fromScene(met, 'fr3_danny_call');
    eq(called.screen, 'stats', 'calling him lands on a stat update');
    ok(called.relRows.some(r => r.who === 'Danny' && r.state === 'Poached'),
       `and the update says Poached (${called.relRows.map(r => r.who + ': ' + r.state).join(', ') || 'no rows'})`);
    const quiet = await fromScene(met, 'fr3_danny_quiet');
    ok(quiet.relRows.some(r => r.who === 'Danny' && r.state === 'Absent'),
       `saying nothing loses him (${quiet.relRows.map(r => r.who + ': ' + r.state).join(', ') || 'no rows'})`);

    // The solo branch may not name Earl from Milestone 3 on (#265), and this
    // card is a Free Roam 3 card. The sweep over the solo run cannot see it,
    // because that run never meets Danny.
    const soloDanny = await fromScene({ rels: { danny: 'frenemy', earl: 'absent' } }, 'fr3_danny');
    ok(soloDanny.texts.length > 3, `the solo arm of the Danny card reads (${soloDanny.texts.length} lines)`);
    ok(!soloDanny.texts.some(x => /\bEarl\b/.test(x)),
       `and names nobody who is not there (${soloDanny.texts.filter(x => /\bEarl\b/.test(x)).join(' | ') || 'none'})`);
    ok(soloDanny.texts.some(x => /Fort Worth/.test(x)), 'it is a syndicate out of Fort Worth instead');
    const backerDanny = await fromScene({ rels: { danny: 'frenemy', earl: 'backer' } }, 'fr3_danny');
    ok(backerDanny.texts.some(x => /Earl Maddox had signed/.test(x)),
       'and on the backer branch it is Earl who signed him');
  }

  /* ================ the ending screen names the right people (Phase 2) */

  {
    // The mentor ending is Pete Garland's: `m5_mentor` is Duke calling Pete,
    // the choice is gated on rels.pete, and the retrospective is three lines
    // about Pete. The headline and the coda both credited Danny Reeves, who is
    // the rival and has nothing to do with it.
    const mentor = await endFromScene(
      { flags: { m5Decision: 'mentor' }, rels: { pete: 'ally', earl: 'backer' } }, 'm5_mentor');
    eq(mentor.outcome, 'mentor', 'the mentor ending sets its outcome');
    ok(/Pete Garland Remembers Duke/.test(mentor.summary), 'the mentor headline credits Pete');
    ok(/Pete Garland remembers Duke/.test(mentor.summary), 'and so does the coda');
    ok(!/Reeves [Rr]emembers Duke/.test(mentor.summary), 'and neither credits Danny');

    // One relationship label table, not two (Phase 2). The ending screen and
    // the stat-update panel read the same one now. The stat panel's copy
    // called Earl "Earl", called `backer` "Business Deal", and had never heard
    // of Pete or `hanger_on` — the rough run's signing row above is the other
    // end of this, and says "Earl Maddox: Business Partner" in the same words.
    ok(/Earl Maddox: Business Partner/.test(mentor.summary),
       'the ending screen labels off the shared table');
    ok(/Pete: Ally/.test(mentor.summary), 'and the shared table knows Pete');

    // Phase 4. The roster is the cast table's, in the table's order, minus
    // anyone the run never met. Danny is never met on this drive and has no
    // row; Ruthie is not either.
    ok(!/Danny:/.test(mentor.summary), 'a character the run never met has no row at all');
    ok(!/Ruthie:/.test(mentor.summary), 'and neither does Ruthie');
    const order = ['Cal:', 'Pete:', 'Earl Maddox:', 'Tommy:'].map(n => mentor.summary.indexOf(n));
    ok(order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])),
       `and the rows print in the cast table's order (${order.join(', ')})`);

    // The other side of the retirement retrospective: a run with everybody in
    // it still reads the full line.
    const full = await endFromScene(
      { flags: { m5Decision: 'retire_clean' },
        rels: { earl: 'backer', cal: 'loyal', ruthie: 'solid', tommy: 'ally' } }, 'm5_retire_clean');
    ok(/He made the call\. Earl first, then Cal, then Ruthie, then Tommy\./.test(full.summary),
       `a run with all four calls all four (${(full.summary.match(/He made the call\..{0,70}/) || ['none'])[0]})`);
    const alone = await endFromScene(
      { flags: { m5Decision: 'retire_clean' },
        rels: { earl: 'absent', cal: 'loyal', tommy: 'absent' } }, 'm5_retire_clean');
    ok(/There was nobody in front of Cal\./.test(alone.summary),
       'and a run with only Cal in it says there was nobody in front of Cal');

    const rival = await endFromScene(
      { flags: { m5Decision: 'mentor' },
        rels: { pete: 'ally', earl: 'backer', danny: 'poached', ruthie: 'absent' } }, 'm5_mentor');
    ok(/Danny: Poached/.test(rival.summary), 'a poached rival is a row on the ending screen');
    ok(/Ruthie: Absent/.test(rival.summary), 'and somebody who left is a row, not a gap');
    ok(rival.summary.indexOf('Ruthie:') < rival.summary.indexOf('Danny:'),
       'still in table order with five of the six on the board');
  }

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
