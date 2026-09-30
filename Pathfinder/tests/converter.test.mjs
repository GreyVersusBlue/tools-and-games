// converter.test.mjs: the Conversion Codex page in a real browser.
//
//   node Pathfinder/tests/converter.test.mjs      (from the repo root; needs
//   Tools/board-check's npm install for the browser)
//
// Drives Pathfinder/converter.html through Tools/board-check/harness.mjs's
// serve()/launch()/prepPage(), against the real data files. The Node suites
// (converter-parse, -tables, -spells, -convert) cover the arithmetic; this one
// covers what only the page does: loading three JSON files, the form feeding
// the conversion, spell cards opening from the stat block, the spell
// combobox, hash routes, and a 375-pixel phone.
// Exits non-zero on any failure.

import { serve, launch, prepPage } from '../../Tools/board-check/harness.mjs';

const PORT = 8171; // see Tools/board-check/README for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/Pathfinder/converter.html`;

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
};

async function waitFor(page, fn, { timeout = 15000, label = 'condition', arg } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function freshPage(browser, hash = '', viewport = { width: 1280, height: 900 }) {
  const page = await prepPage(browser, BASE, viewport);
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const offsite = [];
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) offsite.push(r.url()); });
  await page.goto(URL + hash, { waitUntil: 'load' });
  await waitFor(page, () => document.body.dataset.ready, { label: 'data loaded' });
  return { page, errors, offsite };
}

const text = (page, sel) => page.$eval(sel, (el) => el.textContent);

async function testLoad(browser) {
  console.log('\nloading');
  const { page, errors, offsite } = await freshPage(browser);
  ok(await page.evaluate(() => document.body.dataset.ready) === 'true', 'all four data files load (embeds.json with them)');
  ok(/PF1e spells/.test(await text(page, '#spell-status')), 'the spell tab reports its counts', await text(page, '#spell-status'));
  ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
  ok(offsite.length === 0, 'no offsite requests', offsite.slice(0, 3).join(' '));
  await page.close();
}

async function testCreature(browser) {
  console.log('\ncreature');
  const { page, errors } = await freshPage(browser);
  await page.click('#example-btn');
  await waitFor(page, () => /Creature 10/.test(document.getElementById('pf2-block').textContent), { label: 'dragon converted' });
  ok(await page.$eval('#f-name', (el) => el.value) === 'Young Red Dragon', 'the example fills the form');
  ok(await page.$eval('#f-melee', (el) => /bite \+17/.test(el.value)), 'the melee section holds 1e text', await page.$eval('#f-melee', (el) => el.value.slice(0, 60)));
  const block = await text(page, '#pf2-block');
  ok(/Breath Weapon/.test(block) && /Sure Strike|sure strike/i.test(block), 'the stat block shows the breath weapon and converted spells');
  ok(await page.$$eval('#pf2-block .why', (els) => els.length) > 15, 'numbers carry their explanations');

  const acBefore = await page.$eval('#pf2-block', (el) => el.textContent.match(/AC (\d+)/)[1]);
  await page.$eval('#f-ac-total', (el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitFor(page, (a) => document.getElementById('pf2-block').textContent.match(/AC (\d+)/)[1] !== a, { label: 'AC re-converted', arg: acBefore });
  const acAfter = await page.$eval('#pf2-block', (el) => el.textContent.match(/AC (\d+)/)[1]);
  ok(Number(acAfter) > Number(acBefore), 'raising 1e AC in the form raises the 2e AC', `${acBefore} -> ${acAfter}`);

  await page.$eval('#f-melee', (el) => { el.value = 'bite +17 (2d6+10), 2 claws +17 (1d8+7), gore +15 (1d10+5)'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitFor(page, () => /gore/.test(document.getElementById('pf2-block').textContent), { label: 'gore strike' });
  ok(true, 'a new attack typed into the melee section appears as a Strike');

  await page.$eval('#opt-level', (el) => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitFor(page, () => /Creature 12/.test(document.getElementById('pf2-block').textContent), { label: 'level override' });
  ok(true, 'the level override re-converts at the new level');

  ok(/Conversion notes/.test(await text(page, '#pf2-notes')), 'conversion notes are listed');

  await page.click('#clear-btn');
  await waitFor(page, () => /Nothing to convert/.test(document.getElementById('pf2-block').textContent), { label: 'cleared' });
  ok(true, 'Clear empties the form and the block');

  await page.$eval('#pf1-paste', (el) => { el.value = 'Ogre CR 3\nAC 17, touch 8, flat-footed 17\nhp 30 (4d8+12)\nFort +6, Ref +0, Will +3\nMelee greatclub +7 (2d8+7)'; });
  await page.click('#parse-btn');
  await waitFor(page, () => /Creature 3/.test(document.getElementById('pf2-block').textContent), { label: 'pasted ogre' });
  ok(/greatclub/.test(await text(page, '#pf2-block')), 'a partial pasted block converts');
  ok(errors.length === 0, 'no console errors while editing', errors.slice(0, 3).join(' | '));
  await page.close();
}

async function testSpells(browser) {
  console.log('\nspells');
  const { page, errors } = await freshPage(browser);
  await page.click('#tab-spells');
  ok(await page.$eval('#panel-spells', (el) => !el.hidden) && await page.$eval('#panel-creature', (el) => el.hidden), 'the Spells tab swaps the panels');
  await page.type('#spell-q', 'magic mis');
  await waitFor(page, () => !document.getElementById('spell-suggest').hidden, { label: 'suggestions' });
  const opts = await page.$$eval('#spell-suggest li', (els) => els.map((e) => e.dataset.name));
  ok(opts[0] === 'Magic Missile', 'typing suggests Magic Missile first', opts.slice(0, 3).join(', '));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitFor(page, () => /Force Barrage/.test(document.getElementById('pf2-spell').textContent), { label: 'Force Barrage' });
  ok(/Magic Missile/.test(await text(page, '#pf1-spell')), 'the PF1e card shows the spell');
  ok(/Force Barrage/.test(await text(page, '#pf2-spell')), 'the PF2e side shows Force Barrage');
  ok(await page.evaluate(() => location.hash) === '#spell/Magic%20Missile', 'the hash records the spell');
  ok(await page.$$eval('#spell-recent button', (b) => b.length) === 1, 'the spell joins the recent list');
  ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
  await page.close();

  const deep = await freshPage(browser, '#spell/Cure%20Light%20Wounds');
  await waitFor(deep.page, () => /Heal/.test(document.getElementById('pf2-spell').textContent), { label: 'deep link' });
  ok(await deep.page.$eval('#panel-spells', (el) => !el.hidden), 'a #spell/ link opens the Spells tab on that spell');
  await deep.page.close();
}

// Each spell in the converted block is a button that opens its PF2e card
// (ui-spells.js's pf2Card) in a row under the spell line.
async function testSpellCard(browser) {
  console.log('\nspell cards in the stat block');
  const { page, errors } = await freshPage(browser);
  await page.click('#example-btn');
  await waitFor(page, () => document.querySelectorAll('#pf2-block .spell-ref').length > 1, { label: 'spells in the block' });
  let reached = null;
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 250 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => (document.activeElement?.matches('#pf2-block .spell-ref') ? document.activeElement.textContent : null));
  }
  ok(!!reached, 'Tab reaches a spell in the stat block', reached || 'never reached');
  await page.keyboard.press('Enter');
  const open = await page.evaluate(() => {
    const pop = document.getElementById('spell-pop'), btn = document.activeElement.closest('#spell-pop') && document.querySelector('#pf2-block .spell-ref[aria-expanded="true"]');
    return pop && btn && { name: pop.querySelector('.spell-card h3 span')?.textContent, ref: btn.textContent, card: pop.textContent, afterLine: pop.previousElementSibling?.contains(btn) };
  });
  ok(open && open.name.toLowerCase() === open.ref.toLowerCase(), 'Enter opens that spell\'s PF2e card, with focus in it', open ? `${open.ref} -> ${open.name}` : 'no card');
  ok(open && /Traditions/.test(open.card) && /PF1e/.test(open.card), 'the card is the Spells tab\'s card plus the fit and the PF1e name', open?.card.slice(0, 80));
  ok(open?.afterLine, 'the card opens as a row under the spell line');
  await page.keyboard.press('Escape');
  const shut = await page.evaluate(() => ({
    gone: !document.getElementById('spell-pop'),
    back: document.activeElement?.matches('.spell-ref[aria-expanded="false"]') && document.activeElement.textContent,
  }));
  ok(shut.gone && shut.back === reached, 'Escape closes it and puts focus back on the spell', JSON.stringify(shut));

  const refs = await page.$$('#pf2-block .spell-ref');
  await refs[0].click();
  await refs[1].click();
  const one = await page.evaluate(() => ({ pops: document.querySelectorAll('.spell-pop').length, expanded: document.querySelectorAll('.spell-ref[aria-expanded="true"]').length }));
  ok(one.pops === 1 && one.expanded === 1, 'a second spell replaces the first card', JSON.stringify(one));
  await page.click('.spell-pop-close');
  ok(await page.evaluate(() => !document.getElementById('spell-pop')), 'the close button shuts it');
  await refs[1].click();
  await refs[1].click();
  ok(await page.evaluate(() => !document.getElementById('spell-pop')), 'clicking the open spell again shuts it');
  ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
  await page.close();
}

async function testPhone(browser) {
  console.log('\nphone width');
  const { page } = await freshPage(browser, '', { width: 375, height: 800 });
  await page.click('#example-btn');
  await waitFor(page, () => /Creature 10/.test(document.getElementById('pf2-block').textContent), { label: 'converted' });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 0, 'nothing scrolls sideways at 375 pixels', `${over}px over`);
  await page.click('#pf2-block .spell-ref');
  const overCard = await page.evaluate(() => document.getElementById('spell-pop') && document.documentElement.scrollWidth - window.innerWidth);
  ok(overCard !== null && overCard <= 0, 'nor with a spell card open', `${overCard}px over`);
  await page.close();
}

const server = await serve(PORT);
const browser = await launch({ headed: false });
for (const t of [testLoad, testCreature, testSpellCard, testSpells, testPhone]) {
  try { await t(browser); }
  catch (err) { failures++; checks++; console.log(`  ABORTED  ${t.name}: ${String(err.message || err).slice(0, 300)}`); }
}
await browser.close();
server.close();
console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
