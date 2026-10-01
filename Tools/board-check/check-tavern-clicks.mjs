// check-tavern-clicks.mjs: the tavern's five click targets take a real click.
//
// TavernScene.poke() raises a `tavern-egg` for the dog, the fire, the cat, the
// door and the barkeep, and it listens on the scene's own canvas. The page
// (#page, z-index 2) sits over the room (z-index 0), so a click only gets there
// where #page lets it through. Dispatching pointerdown on the canvas passes
// either way, which is how HISTORY #759 found the boxes held and the page did
// not: this one moves a real mouse to each target's screen point, asks
// elementFromPoint who is there, clicks, and waits for the event.
//
// A target behind the hanging sign (on a phone, where the band is 268px) is
// noted and not failed; a target under anything else is the bug.
//
// Exit code 1 on any failure (#13).

import { serve, launch, prepPage, settle } from './harness.mjs';

const VIEWPORTS = [[1600, 900], [1024, 768], [390, 844]];
const PORT = 8173;
const BASE = `http://127.0.0.1:${PORT}`;
const WANT = ['dog', 'fire', 'cat', 'door', 'barkeep'];

const server = await serve(PORT);
const browser = await launch();
let checks = 0, failures = 0;
const ok = (cond, what, detail = '') => {
  checks++;
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`);
};

try {
  for (const [width, height] of VIEWPORTS) {
    console.log(`\n${width} x ${height}`);
    const page = await prepPage(browser, BASE, { width, height, dsf: 1 });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await settle(page, 1200);
    await page.evaluate(() => {
      window.__eggs = [];
      document.addEventListener('tavern-egg', e => window.__eggs.push(e.detail.what));
    });

    let hidden = 0;
    for (const what of WANT) {
      // The point is the middle of the target's box in room units, mapped to
      // the screen with the scene's own transform. The dog and the cat walk, so
      // the point is taken now and clicked at once.
      const pt = await page.evaluate(w => {
        const s = document.querySelector('tavern-scene');
        const r = s.cv.getBoundingClientRect();
        const room = { dog: [s.dog.x, s.dog.y], fire: [330, 480], cat: [s.cat.x, s.cat.y], door: [955, 480], barkeep: [1150, 480] }[w];
        const x = r.left + room[0] * s.scale + s.ox, y = r.top + room[1] * s.scale + s.oy;
        const on = document.elementFromPoint(x, y);
        return { x, y, tag: on ? on.tagName.toLowerCase() + (on.id ? '#' + on.id : '') : 'nothing',
          inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight, scene: !!(on && on.closest('tavern-scene')),
          sign: !!(on && on.closest('header.sign')) };
      }, what);
      if (!pt.inside) { ok(false, `${what}: its point is on screen`, `${pt.x.toFixed(0)},${pt.y.toFixed(0)}`); continue; }
      if (pt.sign) {
        // The hanging sign is a solid object in front of the room. On a phone
        // the band is 268px and the sign takes its top 165, so the fire, the
        // door and the barkeep sit behind it: a layout fact, not the bug.
        console.log(`  note  ${what}: behind the hanging sign at ${pt.x.toFixed(0)},${pt.y.toFixed(0)}, not clickable by design`);
        hidden++;
        continue;
      }
      ok(pt.scene, `${what}: the click lands on the scene`, `elementFromPoint is ${pt.tag}`);
      await page.evaluate(() => { window.__eggs.length = 0; });
      await page.mouse.click(pt.x, pt.y);
      await new Promise(r => setTimeout(r, 120));
      const eggs = await page.evaluate(() => window.__eggs.slice());
      ok(eggs[0] === what, `${what}: a real click raises tavern-egg ${what}`, `got [${eggs.join(', ')}]`);
    }
    // A desktop band shows the room whole: the sign hangs over its top and the
    // five targets sit below it. Hiding more than none there is a layout change.
    if (width >= 1024) ok(hidden === 0, 'no target is behind the sign on a desktop band', `${hidden} hidden`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
