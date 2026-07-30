// browser.mjs — Integer Foundry's own end-to-end suite.
//
//   node Projects/integer-foundry/test/browser.mjs
//
// Exits non-zero on any missed beat (locked decision #13). Screenshots in
// ./shots/.
//
// This does NOT overlap `npm run games`, which owns "the factory line works":
// packets spawn, move, get operated on and get judged. What is here is everything
// that changed in session 8 and that a suite driving the line would not notice —
// the vendored fonts, the save going through gvb-save, how far behind the screen
// the save is allowed to be, an order that no board can fill being caught on load,
// and the grid fitting on a phone.
//
// Borrows Tools/board-check's harness rather than copying it (locked decision #38
// is about game openings, and `enter()` is imported here for the same reason).
// Bare specifiers inside those files resolve from THEIR folder, so nothing needs
// installing under Projects/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { GAMES, enter, savedState, wait } from '../../../Tools/board-check/games.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
const PORT = 8127; // 8123 checks, 8124 play-castle, 8125 previews, 8126 games
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'integer-foundry-save-v1';
const PAGE = path.join(HERE, '..', '..', 'integer-foundry.html');
const FONTS = path.join(HERE, '..', 'fonts');

fs.mkdirSync(OUT, { recursive: true });

let checks = 0, failures = 0, shotN = 0;
const t = {
  ok(cond, label, detail = '') {
    checks++;
    if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
    else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
  },
};
const group = s => console.log('\n' + s);

/** Answer the file picker before it opens — Playwright and Puppeteer differ. */
async function setFiles(page, file, trigger) {
  if (page.__engine === 'puppeteer') {
    const [chooser] = await Promise.all([page.waitForFileChooser(), trigger()]);
    await chooser.accept([file]);
    return;
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(file);
}

const shot = async (page, label) =>
  page.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.png`) });

const place = (p, tool, x, y) =>
  p.click(`[data-tool="${tool}"]`).then(() => p.click(`#grid .cell[data-x="${x}"][data-y="${y}"]`));

/* ------------------------------------------------------------------ static -- */

group('The file on disk');
{
  const src = fs.readFileSync(PAGE, 'utf8');
  const hits = (src.match(/fonts\.googleapis\.com|fonts\.gstatic\.com/g) || []).length;
  t.ok(hits === 0, 'no Google Fonts hotlink left in the page', `${hits} hits`);
  // page.__blocked is NOT the check for this: prepPage() fulfils Google Fonts
  // requests locally from @fontsource before the blocked list is written, so a
  // hotlink never reaches it. v7 §5's "zero offsite requests" was wrong for this
  // page for exactly that reason. Grep the source instead.
  t.ok(/integer-foundry\/fonts\/inter-400\.woff2/.test(src), 'and a local @font-face in its place');
  const woff2 = fs.readdirSync(FONTS).filter(f => f.endsWith('.woff2'));
  const bytes = woff2.reduce((s, f) => s + fs.statSync(path.join(FONTS, f)).size, 0);
  t.ok(woff2.length === 6, 'six weights vendored, no more', woff2.join(' '));
  t.ok(bytes === 116508, 'measuring 114 KB in total', `${bytes} bytes`);
  for (const f of ['LICENSE-Inter.txt', 'LICENSE-JetBrainsMono.txt', 'LICENSE-Oswald.txt', 'README.md'])
    t.ok(fs.existsSync(path.join(FONTS, f)), `${f} alongside them`);
  t.ok(!/node_modules/.test(src), 'nothing at runtime points at node_modules');
}

/* ---------------------------------------------------------------- browser -- */

const server = await serve(PORT);
const browser = await launch({ headed: false });
const g = GAMES['integer-foundry'];
const p = await prepPage(browser, BASE, { width: g.vw, height: g.vh, dsf: 1 });

try {
  await enter(p, 'integer-foundry', { base: BASE });

  group('Fonts, in the page');
  {
    await p.evaluate(() => document.fonts.ready);
    const faces = await p.evaluate(() =>
      [...document.fonts].map(f => ({ family: f.family, weight: f.weight, status: f.status }))
        .sort((a, b) => (a.family + a.weight).localeCompare(b.family + b.weight)));
    t.ok(faces.length === 6, 'six faces registered', faces.map(f => `${f.family} ${f.weight}`).join(' | '));
    t.ok(!faces.some(f => f.status === 'error'), 'none of the six failed to fetch',
      faces.map(f => `${f.family} ${f.weight} ${f.status}`).join(' | '));
    // `font-display:swap` fetches lazily, so a face nothing on screen uses yet is
    // legitimately 'unloaded'. Only assert the ones the first paint actually needs.
    // (Careful with status strings: "unloaded".endsWith("loaded") is true.)
    const needed = await p.evaluate(() => document.fonts.check("700 19px 'Inter'")
      && document.fonts.check("400 12px 'JetBrains Mono'")
      && document.fonts.check("700 22px Oswald") && document.fonts.check("600 13px Oswald"));
    t.ok(needed, 'and every weight the first paint needs is loaded');
    const fam = await p.evaluate(() => getComputedStyle(document.getElementById('stat-ingots')).fontFamily);
    t.ok(/Inter/.test(fam), 'and the stats really are set in Inter', fam);
    // The × and ÷ in the palette come out of targets.js, which is a separate file
    // served with its own charset header. A mojibake there would be silent.
    const labels = await p.$$eval('#tools .tool-btn', els => els.map(e => e.textContent.trim()));
    t.ok(labels.some(l => l.includes('×2')) && labels.some(l => l.includes('÷2')),
      'the ×2 and ÷2 labels survived the trip through the module', labels.join(' '));
  }

  group('The save bar');
  {
    const bar = await p.$$eval('#save-bar button', els =>
      els.map(e => ({ kind: e.dataset.gvb, label: e.textContent.trim() })));
    t.ok(bar.map(b => b.kind).join(',') === 'export,import,reset',
      'three buttons, export first', bar.map(b => b.label).join(' / '));
    // v7 §9: the Fourth Quarter's bar is only on the start screen and exporting
    // means reloading to get it back. This one is in the sidebar during play.
    const visible = await p.$eval('#save-bar', el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !!el.offsetParent;
    });
    t.ok(visible, 'reachable while the factory is running, not behind a reload');
    const eraserCount = await p.$$eval('button, [id*="reset"], [id*="wipe"]', els =>
      els.filter(e => /wipe|start over|erase/i.test(e.textContent || '')).length);
    t.ok(eraserCount === 1, 'exactly one control on the page erases a factory', `${eraserCount}`);
  }

  group('Autosave latency');
  {
    // The number locked decision #39 was written about. The old build wrote on an
    // 8-second interval, so anything that had just happened was missing from the
    // save; #39 exists because reading it anyway reported a working game broken.
    await place(p, 'source', 0, 2);
    for (const x of [1, 2]) await place(p, 'belt', x, 2);
    await place(p, 'add1', 3, 2);
    await place(p, 'sink', 4, 2);
    await wait(1500);
    const s = await savedState(p, 'integer-foundry');
    const placed = s ? s.grid.flat().filter(c => c.type).length : 0;
    t.ok(placed === 5, 'five tiles are on disk 1.5 s after the last click', `${placed} in the save`);
    t.ok(s.__v === 1, 'and the stored blob carries the schema version', `__v ${s.__v}`);

    const before = JSON.stringify(await savedState(p, 'integer-foundry'));
    await place(p, 'belt', 5, 4);
    await wait(1500);
    const after = JSON.stringify(await savedState(p, 'integer-foundry'));
    t.ok(before !== after, 'a sixth tile reaches the save inside 1.5 s too');
  }

  group('Play, reload, same state');
  {
    await wait(6000); // let the line run and some orders resolve
    const live = await p.evaluate(() => ({
      ingots: document.getElementById('stat-ingots').textContent.trim(),
      cells: [...document.querySelectorAll('#grid .cell:not(.empty)')].map(c => c.className).length,
      needs: [...document.querySelectorAll('.sink-target')].map(e => e.textContent.trim()),
    }));
    await shot(p, 'running');
    await p.reload({ waitUntil: 'load' });
    await GAMES['integer-foundry'].open(p);
    const back = await p.evaluate(() => ({
      cells: [...document.querySelectorAll('#grid .cell:not(.empty)')].length,
      needs: [...document.querySelectorAll('.sink-target')].map(e => e.textContent.trim()),
      log: [...document.querySelectorAll('#log div')].length,
    }));
    t.ok(back.cells === live.cells, 'the floor came back after a reload', `${back.cells} tiles`);
    t.ok(back.needs.join() === live.needs.join(), 'and the sink still wants the same number',
      back.needs.join(' '));
    // The old build never called renderLog() on load: the panel sat empty until
    // something new happened, with a full log sitting in the save.
    t.ok(back.log > 0, 'and the foundry log is on screen, not just in the save', `${back.log} lines`);

    // .packet is the only JetBrains Mono 700 on the page, and it only exists while
    // something is travelling. By now the line has run, so the lazy face has been
    // asked for — which is the half of the vendoring the first paint cannot prove.
    const bold = await p.evaluate(() => document.fonts.check("700 12px 'JetBrains Mono'"));
    t.ok(bold, 'the packet weight loaded once packets appeared');
  }

  group('Export, wipe, import');
  {
    await p.evaluate(() => {
      window.__exports = [];
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { blob.text().then(x => window.__exports.push(x)); return create(blob); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (!this.download) return click.call(this); };
    });
    await p.click('#save-bar [data-gvb="export"]');
    await p.waitForFunction(() => window.__exports.length > 0, null, { timeout: 5000 });
    const text = await p.evaluate(() => window.__exports[0]);
    let env = null; try { env = JSON.parse(text); } catch (e) { /* asserted next */ }
    t.ok(env && env.format === 'gvb-save', 'Export save wrote a gvb-save envelope');
    t.ok(env?.game === 'integer-foundry' && env?.version === 1, 'stamped with the game and version',
      `${env?.game} v${env?.version}`);
    const exportedTiles = env?.state?.grid?.flat().filter(c => c.type).length;
    t.ok(exportedTiles >= 5, 'holding the factory as it stands', `${exportedTiles} tiles`);
    const said = await p.$eval('#save-note', el => el.textContent);
    t.ok(/integer-foundry-save-\d{4}-\d{2}-\d{2}\.json/.test(said), 'and named the file it wrote', said);

    const file = path.join(OUT, 'export.json');
    fs.writeFileSync(file, text);

    // Wipe through the bar's own button, which is the only eraser left.
    await p.evaluate(() => { window.confirm = () => true; });
    await p.click('#save-bar [data-gvb="reset"]');
    await wait(1200);
    const wiped = await p.evaluate(() => [...document.querySelectorAll('#grid .cell:not(.empty)')].length);
    t.ok(wiped === 0, 'Start over cleared the floor', `${wiped} tiles`);

    await setFiles(p, file, () => p.click('#save-bar [data-gvb="import"]'));
    await wait(1200);
    const restored = await p.evaluate(() => ({
      cells: [...document.querySelectorAll('#grid .cell:not(.empty)')].length,
      needs: [...document.querySelectorAll('.sink-target')].map(e => e.textContent.trim()),
    }));
    t.ok(restored.cells === exportedTiles, 'importing the file rebuilt the factory over a wiped save',
      `${restored.cells} tiles`);
    t.ok(restored.needs.length > 0, 'with its order back', restored.needs.join(' '));
    await shot(p, 'imported');

    // A file that is not a save has to be refused, not booted on.
    const junk = path.join(OUT, 'junk.json');
    fs.writeFileSync(junk, '{"format":"gvb-save","game":"integer-foundry","version":1,"state":{"nope":1}}');
    await setFiles(p, junk, () => p.click('#save-bar [data-gvb="import"]'));
    await wait(900);
    const note = await p.$eval('#save-note', el => el.textContent);
    const survived = await p.evaluate(() => [...document.querySelectorAll('#grid .cell:not(.empty)')].length);
    t.ok(/not a valid/i.test(note), 'a corrupt save file is refused with a message', note);
    t.ok(survived === restored.cells, 'and the factory on screen is untouched', `${survived} tiles`);
  }

  group('An order no board can fill (locked decision #34)');
  {
    // Put the bug back on purpose. 260 is what the old generator could roll after
    // ~85 orders; the opening floor tops out at 47. Before this change the sink
    // displayed it and no line could ever satisfy it.
    // Disarm the outgoing page's autosave BEFORE writing, holding onto the real
    // setItem to do the write with. This is not a leftover from the old 8-second
    // timer — it got worse, not better: the autosave is now under a second behind,
    // so anything writing to this key from outside the page loses the race unless
    // it stops the page writing first. Any suite that seeds this save needs these
    // two lines, whatever the seeding is for.
    await p.evaluate(k => {
      const set = localStorage.setItem.bind(localStorage);
      const raw = JSON.parse(localStorage.getItem(k));
      raw.sinks[0].target = 260;
      raw.ordersFilled = 85;
      localStorage.setItem = () => {};
      set(k, JSON.stringify(raw));
    }, KEY);
    await p.reload({ waitUntil: 'load' });
    await GAMES['integer-foundry'].open(p);
    const needs = await p.$eval('.sink-target', el => el.textContent.trim());
    t.ok(needs === 'NEEDS 47', 'an impossible order is pulled down to the board\'s ceiling on load', needs);
    const hint = await p.$eval('#grid .cell.sink', el => el.title);
    t.ok(/46 fabricators/.test(hint), 'and the sink says what it would take', hint);

    // And no fresh roll produces one either — the same module the page runs,
    // loaded by the same browser, 2000 rolls at 400 orders filled.
    const rolls = await p.evaluate(async () => {
      const m = await import('./integer-foundry/js/targets.js');
      const grid = Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => ({ type: null })));
      const s = { cols: 8, rows: 6, unlocked: {}, ordersFilled: 400, grid };
      const plan = m.boardPlan(s);
      let bad = 0, max = 0;
      for (let i = 0; i < 2000; i++) {
        const t = m.rollTarget(s);
        if (!m.isReachable(t, plan)) bad++;
        if (t > max) max = t;
      }
      return { bad, max, ceiling: m.reachableMax(plan) };
    });
    t.ok(rolls.bad === 0, '2000 rolls at 400 orders filled, none unfillable', `${rolls.bad} bad`);
    t.ok(rolls.max === 47 && rolls.ceiling === 47,
      'and none above what the opening floor can build', `max ${rolls.max}, ceiling ${rolls.ceiling}`);
  }

  group('Filling whatever the sink asks for, without seeding the save');
  {
    // This is the beat that lets play-games.mjs stop writing sinks[0].target into
    // localStorage. Locked decision #40 says a guard-rail satisfiable by luck gets
    // seeded rather than retried; the better answer is to take the luck out. Every
    // order is now guaranteed buildable on this floor, so the suite can read what
    // the sink wants and build a line that delivers exactly that.
    //
    // Proven here before being handed over as a shared-file request.
    await p.evaluate(() => { window.confirm = () => true; });
    await p.click('#save-bar [data-gvb="reset"]');
    // Wait for the empty floor rather than for a fixed delay: reset goes through
    // adoptState(), which rebuilds the palette, so a click fired mid-rebuild lands
    // on a detached button.
    await p.waitForFunction(
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      null, { timeout: 10000 });

    // A sink has to be on the floor before its order is on screen. Park one, read
    // it, clear it. state.sinks[0] survives the erase, so the number holds.
    await place(p, 'sink', 0, 0);
    await p.waitForSelector('#grid .cell[data-x="0"][data-y="0"].sink .sink-target');
    const want = Number((await p.$eval('.sink-target', el => el.textContent)).replace(/\D/g, ''));
    t.ok(Number.isInteger(want) && want >= 2 && want <= 12,
      'the opening order is between 2 and 12', `wants ${want}`);
    await p.click('[data-tool="erase"]');
    await p.click('#grid .cell[data-x="0"][data-y="0"]');
    await p.waitForFunction(
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      null, { timeout: 10000 });

    // A source emits 1 and every +1 adds one, so `want` needs want-1 of them.
    // Row 2 west to east, turn down at column 7, row 3 east to west: 14 operator
    // cells, and the opening ramp never asks for more than 12.
    const chain = [];
    for (let x = 1; x <= 7 && chain.length < want - 1; x++) chain.push({ x, y: 2, dir: 'E' });
    if (chain.length < want - 1) {
      chain[chain.length - 1].dir = 'S';
      for (let x = 7; x >= 1 && chain.length < want - 1; x--) chain.push({ x, y: 3, dir: 'W' });
    }
    const last = chain[chain.length - 1];
    const sinkAt = !last ? { x: 1, y: 2 }
      : last.dir === 'E' ? { x: last.x + 1, y: last.y }
      : last.dir === 'S' ? { x: last.x, y: last.y + 1 }
      : { x: last.x - 1, y: last.y };

    await place(p, 'source', 0, 2);
    await p.click('[data-tool="add1"]');
    for (const c of chain) await p.click(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    // Rotate: clicking a placed tile with the same tool selected steps E>S>W>N.
    for (const c of chain) {
      const turns = c.dir === 'E' ? 0 : c.dir === 'S' ? 1 : 2;
      for (let i = 0; i < turns; i++) await p.click(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    }
    await place(p, 'sink', sinkAt.x, sinkAt.y);

    const built = await p.$$eval('#grid .cell:not(.empty)', els => els.length);
    t.ok(built === want + 1, 'built a line of exactly the right length',
      `${built} tiles for an order of ${want}`);

    // TICK_MS 550, source every 3 ticks, then one tile per tick down the line.
    const filled = await p.waitForFunction(
      () => /[1-9]/.test(document.getElementById('stat-orders').textContent),
      null, { timeout: 30000 }).then(() => true, () => false);
    const live = await p.evaluate(() => ({
      orders: document.getElementById('stat-orders').textContent.trim(),
      ingots: document.getElementById('stat-ingots').textContent.trim(),
      log: [...document.querySelectorAll('#log div')].map(e => e.textContent.trim()),
    }));
    t.ok(filled, 'and it filled the order the game asked for, with nothing seeded',
      live.log.find(l => /order filled/i.test(l)) || live.log[0] || '');
    t.ok(new RegExp(`Order filled: ${want} `).test(live.log.join(' | ')),
      `the sink took a ${want}`, live.log.find(l => /order filled/i.test(l)) || '');
    t.ok(/[1-9]/.test(live.ingots), 'and paid out', `${live.ingots} ingots`);
    await shot(p, 'built-to-order');
  }

  group('A save written by the pre-gvb-save build');
  {
    // The real thing, captured off the old build by capture-legacy-save.mjs before
    // any of this landed: hand-rolled localStorage, no __v, no validation.
    const legacy = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'legacy-save-v0.json'), 'utf8'));
    await p.evaluate(([k, blob]) => {
      const set = localStorage.setItem.bind(localStorage);
      localStorage.setItem = () => {};
      set(k, blob);
    }, [KEY, JSON.stringify(legacy)]);
    await p.reload({ waitUntil: 'load' });
    await GAMES['integer-foundry'].open(p);
    const seen = await p.evaluate(() => ({
      cells: [...document.querySelectorAll('#grid .cell:not(.empty)')].length,
      cols: document.querySelectorAll('#grid .cell[data-y="0"]').length,
      source: !!document.querySelector('#grid .cell[data-x="0"][data-y="2"].source'),
      sink: !!document.querySelector('#grid .cell[data-x="7"][data-y="2"].sink'),
      needs: document.querySelector('.sink-target')?.textContent.trim(),
    }));
    t.ok(seen.cells === 9, 'an unstamped save from the old build still loads its nine tiles',
      `${seen.cells} tiles across ${seen.cols} columns`);
    t.ok(seen.source && seen.sink, 'with the source and sink where they were left');
    t.ok(/^NEEDS \d+$/.test(seen.needs || ''), 'and a real order on the sink', seen.needs);
    await shot(p, 'legacy-save');

    // Repair happened in memory on load; the stamp only lands when the game next
    // writes, which the autosave does within AUTOSAVE_MS of the first tick.
    await wait(1500);
    const onDisk = await savedState(p, 'integer-foundry');
    t.ok(onDisk.__v === 1, 'and it is stamped once the game saves over it', `__v ${onDisk.__v}`);
    t.ok(onDisk.unlocked && onDisk.unlocked.fastSource === false,
      'every unlock key present after the repair pass');
  }

  group('Mobile, 375x812');
  {
    const m = await prepPage(browser, BASE, { width: 375, height: 812, dsf: 2, mobile: true });
    await enter(m, 'integer-foundry', { base: BASE });
    await m.evaluate(() => document.fonts.ready);
    const geom = await m.evaluate(() => {
      const grid = document.getElementById('grid');
      const cell = document.querySelector('#grid .cell[data-x="7"]');
      const r = cell.getBoundingClientRect();
      return {
        gridW: Math.round(grid.getBoundingClientRect().width),
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        lastRight: Math.round(r.right),
        cellW: Math.round(r.width),
      };
    });
    // The old flat 58 px put the 8th column's right edge at ~501 px on a 375 px
    // screen, and body sets overflow-x:hidden, so it could not be scrolled to.
    t.ok(geom.lastRight <= geom.winW, 'the rightmost column is inside the viewport',
      `col 7 ends at ${geom.lastRight} of ${geom.winW}`);
    t.ok(geom.docW <= geom.winW + 1, 'and the page does not scroll sideways',
      `${geom.docW} vs ${geom.winW}`);
    t.ok(geom.cellW >= 24, 'cells are still big enough to tap', `${geom.cellW} px`);
    await place(m, 'sink', 7, 3);
    const tapped = await m.$eval('#grid .cell[data-x="7"][data-y="3"]', el => el.className);
    t.ok(/sink/.test(tapped), 'and the far column takes a tap', tapped);

    // At 36 px the word "NEEDS" crowds the number out of the label. The number is
    // the part a player needs, so at small cell sizes it goes on its own.
    const label = await m.$eval('.sink-target', el => ({
      text: el.textContent.trim(), clipped: el.scrollWidth > el.clientWidth + 1,
    }));
    t.ok(/^\d+$/.test(label.text), 'the order reads as a bare number on a narrow cell', label.text);
    t.ok(!label.clipped, 'and it is not clipped');
    await shot(m, 'mobile');
    t.ok(m.__errs.length === 0, 'no errors on the phone layout', m.__errs.slice(0, 2).join(' | '));
    await m.close();
  }

  group('Clean');
  {
    t.ok(p.__errs.length === 0, 'no page or console errors', p.__errs.slice(0, 3).join(' | '));
    const offsite = [...new Set(p.__blocked)];
    t.ok(offsite.length === 0, 'no offsite requests', offsite.slice(0, 3).join(' | '));
  }
} catch (err) {
  failures++;
  console.log(`\n  ABORTED  ${String(err.message || err).slice(0, 300)}`);
  await shot(p, 'aborted').catch(() => {});
  if (p.__errs.length) console.log(`           errs: ${p.__errs.slice(0, 3).join(' | ')}`);
}

await p.close().catch(() => {});
await browser.close();
server.close();

console.log(`\n${checks} checks, ${failures} failed — shots in ${path.relative(process.cwd(), OUT)}`);
process.exit(failures ? 1 : 0);
