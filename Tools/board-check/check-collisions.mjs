// check-collisions.mjs — regression guard for the card top band.
//
// The pin, the genre ribbon and the NEW POSTING flag all live in the top ~22px
// of a quest card, and the eyebrow is centred text that grows toward both
// corners as the string gets longer. In version 2 they overlapped: 10 real
// collisions across nine viewport widths, worst 4x5px on Integer Foundry at a
// 1024px viewport. Version 3 reserves a band with
// `#quest-board .notice { padding-top: 2.15rem }`.
//
// This measures TRUE 2D rectangle intersection against the eyebrow's actual
// glyph run (a Range box, not the block box). Horizontal proximity alone is
// not a collision, which is easy to get wrong and did mislead us once.
//
// Exit code 1 if anything overlaps, so it works as a pre-commit check.

import { serve, launch, prepPage, settle } from './harness.mjs';

const WIDTHS = [360, 390, 480, 700, 820, 1024, 1180, 1280, 1600];
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

const server = await serve(PORT);
const browser = await launch();
let collisions = 0;
let tightest = Infinity;

console.log('checking card corner ornaments against the eyebrow\n');

for (const w of WIDTHS) {
  const page = await prepPage(browser, BASE, { width: w, height: 1000, dsf: 1 });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await settle(page, 500);

  const r = await page.evaluate(() => {
    const glyphBox = el => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
    const overlap = (a, b) => ({
      ox: +(Math.min(a.right, b.right) - Math.max(a.left, b.left)).toFixed(1),
      oy: +(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)).toFixed(1),
    });
    const board = document.getElementById('quest-board');
    const out = { cols: getComputedStyle(board).gridTemplateColumns.split(' ').length, cardW: null, hits: [], gaps: [] };
    board.querySelectorAll('.notice').forEach(n => {
      const eb = n.querySelector('.eyebrow');
      if (!eb) return;
      const tb = glyphBox(eb);
      out.cardW ??= Math.round(n.getBoundingClientRect().width);
      for (const [k, sel] of [['flag', '.new-flag'], ['ribbon', '.tag-ribbon'], ['pin', '.pin']]) {
        const el = n.querySelector(sel);
        if (!el) continue;
        const o = overlap(tb, el.getBoundingClientRect());
        if (o.ox > 0 && o.oy > 0) out.hits.push(`${n.querySelector('h3').textContent.trim()} / ${k} ${o.ox}x${o.oy}px`);
        else if (k !== 'pin') out.gaps.push(-o.oy);
      }
    });
    return out;
  });

  const minGap = Math.min(...r.gaps);
  tightest = Math.min(tightest, minGap);
  collisions += r.hits.length;
  const status = r.hits.length ? `FAIL ${r.hits.length}` : 'ok';
  console.log(`  ${String(w).padEnd(5)} ${r.cols} col  card ${r.cardW}px  vert gap ${minGap.toFixed(1).padStart(6)}px  ${status}`);
  for (const h of r.hits) console.log('        ' + h);
  await page.close();
}

console.log(`\n${collisions} collisions, tightest vertical gap ${tightest.toFixed(1)}px`);
await browser.close();
server.close();
process.exit(collisions ? 1 : 0);
