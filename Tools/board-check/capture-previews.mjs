// capture-previews.mjs — UNFINISHED. Read the caveats before trusting output.
//
// Goal: the seven hover-preview JPEGs listed in assets/previews/README.md.
// Status: the plumbing works, the driving does not. Nothing here has produced
// an image anyone has looked at. Do not copy output into assets/previews/
// without opening it first.
//
// What works
//   - all seven pages load offline (fonts shimmed, three.js vendored)
//   - screenshots come out at the right aspect (33:20 -> 330x200)
//
// What does not
//   - the `drive` steps below are guesses at each game's UI. For Integer
//     Foundry and Faire Weekend every captured frame came out byte-identical
//     across nine seconds, which means nothing advanced and we are looking at
//     an idle opening state, exactly the "title screen" the spec warns against.
//   - the 3D projects (aphelion, castle-conundrum, fourth-quarter, golden-hour)
//     run on software WebGL here and are slow enough that key events time out
//     mid-scene. They likely need a machine with real GPU access.
//   - castle-conundrum cannot be captured at all until src/npc.js is repaired;
//     it hangs on its loading screen.
//   - golden-hour hotlinks a sand texture from dl.polyhaven.org, so it will
//     look wrong anywhere that host is unreachable.
//
// To finish this: fix the drive steps per game (real selectors, real play),
// run, then LOOK at candidates/ before promoting anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'candidates');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function hold(page, key, ms) {
  await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key);
}

// 990x600 and 1320x800 are both 33:20, so a plain downscale lands on 330x200
// with no cropping. UI-heavy games get the smaller frame so text survives.
const RECIPES = {
  'integer-foundry': { url: '/Projects/integer-foundry.html', vw: 990, vh: 600, shots: [0, 3000, 6000],
    drive: async () => { await wait(2500); } },

  'closing-time': { url: '/Projects/Closing Time/', vw: 990, vh: 600, shots: [0, 2500],
    drive: async p => { await wait(2200); const b = await p.$('#newGameBtn'); if (b) { await b.click(); await wait(2000); } } },

  'faire-weekend': { url: '/Projects/Ren-Faire-Claude/', vw: 990, vh: 600, shots: [0, 2500],
    drive: async () => { await wait(2500); } },

  'golden-hour': { url: '/Projects/golden-hour-beach/', vw: 1320, vh: 800, shots: [0, 2500, 5000],
    drive: async p => { await wait(4000); await p.mouse.click(660, 400); await wait(3500); await hold(p, 'KeyW', 2600); await wait(1500); } },

  'aphelion': { url: '/Projects/aphelion/', vw: 1320, vh: 800, shots: [0, 2500, 5000],
    drive: async p => { await wait(4500); await p.mouse.click(660, 400); await wait(3500); await hold(p, 'KeyW', 2200); await wait(1500); } },

  'castle-conundrum': { url: '/Projects/Castle Conundrum/', vw: 1320, vh: 800, shots: [0, 2500],
    drive: async p => { await wait(4500); const b = await p.$('#start-button'); if (b) await b.click(); await wait(4000); } },

  'fourth-quarter': { url: '/Projects/fourth-quarter/', vw: 1320, vh: 800, shots: [0, 2500, 5000],
    drive: async p => { await wait(4500); const b = await p.$('#startBtn'); if (b) await b.click(); await wait(4000); await hold(p, 'KeyW', 2200); await wait(1500); } },
};

const server = await serve(PORT);
const browser = await launch();
const only = process.argv[2];
const report = {};

for (const [name, rec] of Object.entries(RECIPES)) {
  if (only && only !== name) continue;
  process.stdout.write(`${name.padEnd(18)}`);
  const page = await prepPage(browser, BASE, { width: rec.vw, height: rec.vh, dsf: 2 });
  page.setDefaultTimeout(60000);
  const files = [];
  try {
    await page.goto(BASE + rec.url, { waitUntil: 'load', timeout: 45000 });
    await rec.drive(page);
    let i = 0;
    for (const d of rec.shots) {
      if (d) await wait(d);
      const f = path.join(OUT, `${name}-${i++}.png`);
      await page.screenshot({ path: f });
      files.push(f); process.stdout.write('.');
    }
    // identical frames across the whole window means nothing is animating
    const hashes = new Set(files.map(f => fs.statSync(f).size + ':' + fs.readFileSync(f).length));
    const stale = hashes.size === 1 && files.length > 1;
    const dom = await page.evaluate(() => {
      const hidden = el => !el || !el.getClientRects().length || getComputedStyle(el).opacity === '0';
      const intro = {};
      for (const id of ['title', 'overlay', 'start-overlay', 'startOverlay', 'loading-screen'])
        if (document.getElementById(id)) intro[id] = hidden(document.getElementById(id)) ? 'gone' : 'STILL UP';
      return { intro, canvases: [...document.querySelectorAll('canvas')].map(c => `${c.width}x${c.height}`) };
    });
    report[name] = { ok: true, files: files.map(f => path.basename(f)), stale, dom, errs: page.__errs.slice(0, 4), blocked: [...new Set(page.__blocked)] };
    process.stdout.write(` ok  intro=${JSON.stringify(dom.intro)}${stale ? '  STATIC FRAMES' : ''}\n`);
  } catch (e) {
    report[name] = { ok: false, error: String(e).slice(0, 160), errs: page.__errs.slice(0, 6), blocked: [...new Set(page.__blocked)] };
    process.stdout.write(` FAILED ${String(e).slice(0, 90)}\n`);
  }
  await page.close();
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('\nreport written to candidates/report.json');
console.log('NOTHING here is ready for assets/previews/ until a human has looked at it.');
await browser.close();
server.close();
