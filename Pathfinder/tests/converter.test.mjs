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

  // An ability a rule rewrote reads in 2e form with its glyph; one no rule
  // reads keeps its text and wears the mark (converter-abilities.test.mjs
  // holds the wording).
  await page.$eval('#pf1-paste', (el) => { el.value = 'Test Beast CR 4\nAC 17, touch 11, flat-footed 16\nhp 42 (5d10+15)\nFort +7, Ref +5, Will +2\nMelee 2 claws +8 (1d6+4)\nSpecial Attacks rend (2 claws, 1d6+4)\nSPECIAL ABILITIES\nPoison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d2 Str; cure 1 save.\nLurk (Ex) A test beast gains a +4 bonus on Stealth checks in tall grass.'; });
  await page.click('#parse-btn');
  await waitFor(page, () => /Creature 4/.test(document.getElementById('pf2-block').textContent), { label: 'pasted test beast' });
  const lines = await page.$$eval('#pf2-block .sb-line', (els) => els.map((el) => ({ name: el.querySelector('b')?.textContent, mark: el.querySelector('.sb-pf1')?.textContent || '', title: el.querySelector('.sb-pf1')?.title || '', act: el.querySelector('.act')?.textContent || '', text: el.textContent })));
  const by = (n) => lines.find((l) => l.name === n);
  ok(by('Rend')?.act === '◆' && !by('Rend').mark && /Stage 1 enfeebled 1 \(1 round\)/.test(by('Poison')?.text) && !by('Poison').mark,
    'abilities a rule rewrote show in 2e form, unmarked', `${by('Rend')?.text.slice(0, 40)} | ${by('Poison')?.text.slice(0, 60)}`);
  ok(by('Lurk')?.mark === 'PF1e wording' && /not rewritten/.test(by('Lurk').title) && /gains a \+4 bonus on Stealth checks in tall grass\./.test(by('Lurk').text) && lines.filter((l) => l.mark).length === 1,
    'the one ability no rule reads keeps its text and is marked PF1e wording', by('Lurk')?.text);
  // The third set of rules (HISTORY #937) on the page: a whirlwind, an energy
  // drain and a burst on death show in 2e form with no mark, and the one line
  // beside them no rule reads still wears it.
  await page.$eval('#pf1-paste', (el) => { el.value = 'Gale Beast CR 6\nAC 19, touch 12, flat-footed 17\nhp 76 (8d10+32)\nFort +10, Ref +7, Will +4\nMelee slam +11 (1d8+6 plus energy drain)\nSpecial Attacks energy drain (1 level, DC 16), whirlwind (1/10 minutes, 10-40 ft. tall, 1d8+6 damage, DC 17)\nSPECIAL ABILITIES\nDeath Throes (Su) When killed, a gale beast explodes in a burst of sparks that deals 8d6 points of electricity damage to anything within 30 feet (Reflex DC 17 halves).\nLurk (Ex) A gale beast gains a +4 bonus on Stealth checks in tall grass.'; });
  await page.click('#parse-btn');
  await waitFor(page, () => /Creature 6/.test(document.getElementById('pf2-block').textContent), { label: 'pasted gale beast' });
  const lines3 = await page.$$eval('#pf2-block .sb-line', (els) => els.map((el) => ({ name: el.querySelector('b')?.textContent, mark: el.querySelector('.sb-pf1')?.textContent || '', act: el.querySelector('.act')?.textContent || '', text: el.textContent })));
  const by3 = (n) => lines3.find((l) => l.name === n);
  ok(by3('Whirlwind')?.act === '◆◆' && /for 4 rounds or until it Dismisses/.test(by3('Whirlwind').text) && /gains 6 temporary Hit Points .* or become drained 1\./.test(by3('Drain Life')?.text)
    && /When the monster dies, it explodes, dealing \d+d6 electricity damage .* 30-foot emanation/.test(by3('Death Throes')?.text) && lines3.filter((l) => l.mark).map((l) => l.name).join() === 'Lurk',
    'a whirlwind, an energy drain and a burst on death show in 2e form, unmarked, and only Lurk wears the mark', `${by3('Whirlwind')?.text.slice(0, 50)} | ${by3('Drain Life')?.text.slice(0, 50)} | ${by3('Death Throes')?.text.slice(0, 50)} | marked: ${lines3.filter((l) => l.mark).map((l) => l.name).join()}`);
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

// The Foundry JSON button saves a file: an <a download> clicked on a JSON
// blob. The click and the blob are caught in the page, so nothing lands on
// disk and the check is the same under either browser engine.
async function testFoundry(browser) {
  console.log('\nFoundry export');
  const { page, errors } = await freshPage(browser);
  await page.evaluate(() => {
    window.__saved = [];
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__blob = blob; return make(blob); };
    HTMLAnchorElement.prototype.click = function () { window.__saved.push({ name: this.download, href: this.href }); };
  });
  const row = await page.$$eval('#panel-creature .output-col .btn-row button', (bs) => bs.map((b) => b.id));
  ok(row.join(' ') === 'copy-btn print-btn foundry-btn', 'the Foundry JSON button sits beside Copy and Print', row.join(' '));
  await page.click('#foundry-btn');
  ok(await page.evaluate(() => window.__saved.length) === 0, 'with nothing converted it saves nothing');
  await page.click('#example-btn');
  await waitFor(page, () => /Creature 10/.test(document.getElementById('pf2-block').textContent), { label: 'dragon converted' });
  await page.click('#foundry-btn');
  const saved = await page.evaluate(async () => ({ files: window.__saved, type: window.__blob?.type, text: await window.__blob?.text() }));
  ok(saved.files.length === 1 && saved.files[0].name === 'young-red-dragon.foundry-npc.json' && saved.files[0].href.startsWith('blob:') && saved.type === 'application/json',
    'on the example it saves young-red-dragon.foundry-npc.json, a JSON blob', JSON.stringify(saved.files));
  let actor = null;
  try { actor = JSON.parse(saved.text); } catch { /* reported below */ }
  const shown = await page.$eval('#pf2-block', (el) => ({ ac: Number(el.textContent.match(/AC (\d+)/)[1]), hp: Number(el.textContent.match(/HP (\d+)/)[1]) }));
  ok(actor?.type === 'npc' && actor.name === 'Young Red Dragon' && actor.system.details.level.value === 10 && actor.system.attributes.ac.value === shown.ac && actor.system.attributes.hp.max === shown.hp,
    'the file is an npc with the AC and HP the page shows', actor ? `AC ${actor.system.attributes.ac.value} HP ${actor.system.attributes.hp.max} against ${JSON.stringify(shown)}` : 'not JSON');
  const spells = (actor?.items || []).filter((i) => i.type === 'spell');
  ok(spells.length > 1 && spells.every((s) => s.system.description?.value && s.system.time), 'its spells carry the Archive\'s spell data, so the page passed its spell index in', `${spells.length} spells`);
  ok(/Saved young-red-dragon/.test(await text(page, '#copy-status')), 'and the status line says what was saved', await text(page, '#copy-status'));
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
for (const t of [testLoad, testCreature, testSpellCard, testFoundry, testSpells, testPhone]) {
  try { await t(browser); }
  catch (err) { failures++; checks++; console.log(`  ABORTED  ${t.name}: ${String(err.message || err).slice(0, 300)}`); }
}
await browser.close();
server.close();
console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
