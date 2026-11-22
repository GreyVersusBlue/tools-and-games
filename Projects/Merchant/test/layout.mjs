// node test/layout.mjs
//
// MER-46 (ARCHITECTURE 7.4, DESIGN 5): every screen but the map's own labels, at the frames of
// DESIGN 5 and at Large text on the short phone frame. Port 8193, through the site harness.
//
// Screens: the title (with and without a save), New game, the desk with a letter raised, a question and a report from the road, the desk
// with a full stack, a return paper, the outfitting sheet, the price board on the map table, the ledger,
// the notebook (MER-62), the page
// between acts and the five pages of the ending (MER-84: notice, recall, who came home, score, after 1347). The labels on the map table are MER-44b's check in
// journey.mjs and are not measured here.
//
// Each screen at each frame fails on:
//   overflow   the page scrolls sideways, an element sticks out of the viewport sideways with no
//              clipping box around it, or an element of a raised paper (or dialog) is out of the
//              viewport vertically with no scroll container, or the page itself, to reach it
//   target     an interactive element under 44 px (inline links in running text: under 44 px tall)
//   contrast   text under 4.5:1 against what is actually behind it, measured from pixels: the text
//              is made transparent, the page is photographed, and every pixel under each line of
//              text is compared with the text's own colour (alpha and opacity included), at every
//              scroll position of every scroll container. Disabled controls are exempt (WCAG 1.4.3).
// Screenshots go to ~/.cache/merchant-scratch/shots/ (outside the repository, MERCHANT_SHOTS
// overrides), one per screen and frame, at device scale 2.
//
// MERCHANT_LAYOUT_BREAK=overflow|target|contrast injects one deliberate fault into every page, so
// that each check can be seen to fail (#34). Without it the variable is not read.
// Saves for the later screens are built in Node by the engine on the same seed as journey.mjs
// and written to localStorage, so the page is exactly the one a player would reach.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, eq, ok, done } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, '..', '..', '..', 'Tools', 'board-check', 'harness.mjs');
const { serve, launch, prepPage } = await import(pathToFileURL(HARNESS).href);
const MER = path.join(HERE, '..', 'js');
const eng = await import(pathToFileURL(path.join(MER, 'engine', 'index.js')).href);
const { SAVE_VERSION } = await import(pathToFileURL(path.join(MER, 'engine', 'state.js')).href);
const { loadContent } = await import(pathToFileURL(path.join(MER, 'data.js')).href);
const content = eng.validateContent(await loadContent('cairo', { fs: await import('node:fs/promises') }));

const SEED = 1324;
const PORT = 8193;
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/Projects/Merchant/`;
const GAME = URL_ + `?test=1&seed=${SEED}`;
const SHOTS = process.env.MERCHANT_SHOTS || path.join(os.homedir(), '.cache', 'merchant-scratch', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const BREAK = process.env.MERCHANT_LAYOUT_BREAK || '';
const BREAKS = {
  overflow: 'body::after{content:"";position:absolute;left:0;top:0;width:3000px;height:1px}',
  target: 'button,.button,.bar-btn{min-height:0!important;height:20px!important;width:30px!important;min-width:0!important}',
  contrast: '.sheet,.sheet *,h1,.title-tagline,.title-menu *,.paper *{color:#9a8f7a!important}',
};
if (BREAK && !BREAKS[BREAK]) throw new Error(`MERCHANT_LAYOUT_BREAK=${BREAK}: expected one of ${Object.keys(BREAKS).join(', ')}`);

const FRAMES = [
  { name: 'board', width: 1920, height: 1080 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'laptop-small', width: 1280, height: 800 },
  { name: 'phone-side', width: 844, height: 390, mobile: true },
  { name: 'phone-side-large', width: 844, height: 390, mobile: true, large: true },
  { name: 'phone-upright', width: 390, height: 844, mobile: true },
  { name: 'phone-small', width: 360, height: 740, mobile: true },
];
const MIN_TARGET = 44, MIN_CONTRAST = 4.5;
// MER-87 (finding 7): what a paper asks is in view the moment it opens, with no scrolling by the player, at the two
// frames the milestone play found it cut off at (the board and a small laptop) and the 1366 laptop between them.
// The target is the paper's first choice, or Open the house on the page between the acts.
const OPENS_WITH = { 'desk-letter': '.sheet .choice', 'desk-question': '.sheet .choice', 'desk-report': '.sheet .choice', 'desk-papers': '.sheet .choice',
  'desk-return': '.sheet .choice', 'desk-loss': '.sheet .choice', 'between-acts': '#btn-open-house', 'between-acts-long': '#btn-open-house' };
const OPEN_FRAMES = new Set(['board', 'laptop', 'laptop-small']);
// MER-99: a return paper ends by asking, and its last choice is whole in view, clear of End the season, at the two frames a teacher plays on
const LAST_CHOICE = { 'desk-return': '.sheet .choices .choice:last-of-type' };
const LAST_FRAMES = new Set(['board', 'laptop']);
// MER-122: on a return paper the headline wins where the two cannot both fit. With four papers stacked above it a 1366x768 or 1280x800
// frame has room for the headline or for the choices, not both (the desk used to scroll the headline away, play a062 and b070), so a return's
// choices are asserted whole in view at the board frame only; at the laptops the headline test below holds and the choices are one scroll or Tab away.
const HEADLINE_WINS = new Set(['desk-return']);
// MERCHANT_LAYOUT_ONLY=desk-loss,desk-return runs just those screens (a development shortcut; the suite must run whole to count)
const ONLY = (process.env.MERCHANT_LAYOUT_ONLY || '').split(',').filter(Boolean);
const FITS = new Set(['title', 'title-continue', 'desk-letter', 'desk-question', 'desk-report', 'desk-papers', 'desk-return', 'desk-accounts', 'between-acts']);

// ---- the same game the engine plays in Node (the policy of journey.mjs: first open choice,
// first expedition sent on the engine's plan, every other paper set aside)
const fresh = () => eng.newGame(content, { seed: SEED, length: 'acts', house: 'spice' });
const playPapers = s => {
  for (const p of s.desk) {
    if (p.state !== 'open') continue;
    const c = eng.paperChoices(s, content, p.id).find(x => { try { eng.choose(s, content, p.id, x.id); return true; } catch { return false; } });
    s = eng.choose(s, content, p.id, c.id);
    if (c.ui === 'outfit-first') { const plan = eng.suggestPlan(s, content, 'damascus'); if (plan) s = eng.outfit(s, content, plan); }
  }
  return s;
};
const playSeason = s => eng.endSeason(playPapers(s), content);
const openPapers = s => s.desk.filter(p => p.state === 'open').length;
/** Play on until `want(state)`; returns the state, never past ten acts' worth of seasons. */
const playUntil = want => {
  let s = fresh();
  for (let i = 0; i < 80 && !want(s); i++) {
    if (s.phase === 'interlude') s = eng.openSeason(s, content);
    else s = playSeason(s);
  }
  if (!want(s)) throw new Error('layout.mjs: the engine never reached the state this screen needs');
  return s;
};
const FIRST = { 'opening-letter': 'begin', 'first-expedition': 'wait', 'linen-neighbour': 'keep' };
const states = {
  start: fresh(),
  // the season in the first ten with the most papers on the desk (the desk never holds more than five)
  full: (() => { let best = fresh(), s = best; for (let i = 0; i < 10; i++) { if (s.phase !== 'desk') break; if (openPapers(s) > openPapers(best)) best = s; s = playSeason(s); } return best; })(),
  ret: playUntil(s => s.phase === 'desk' && s.desk.some(p => p.kind === 'return' && p.state === 'open')),
  firstDone: (() => { let s = fresh(); for (const p of s.desk) if (p.state === 'open') s = eng.choose(s, content, p.id, FIRST[p.ref]); return s; })(),
  interlude: playUntil(s => s.phase === 'interlude'),
  recall: playUntil(s => s.phase === 'recall'),
  // the second expedition (MER-93): news has come, so the map's price panel has three best trades and the outfit sheet opens on the
  // engine's proposal with every section open, a bring-back good named and an estimate line under Send
  second: playUntil(x => x.phase === 'desk' && x.t >= 3 && x.log.some(e => e.kind === 'outfit') && eng.view(x, content).bestTrades.length === 3
    && content.agents.filter(a => x.agents[a.id]?.hired && x.agents[a.id].where === 'cairo' && !x.expeditions.some(e => e.agent === a.id)).length >= 2),
  // a house with an expedition out, stock, a loan and several notebook entries, and four closed seasons: the `season` log entries
  // the ledger's money trail reads (ledger.js) are the engine's own (turn.js writes one at each closing), so the shot shows four
  // different seasons, not made-up ones clamped to season 0 (MER-119)
  book: (() => {
    const seasons = x => new Set(x.log.filter(e => e.kind === 'season').map(e => e.at)).size;
    // four closings in, then a party sent out so the ledger has an expedition on the road (the engine's own plan, as withLetter sends one)
    const at = playUntil(x => x.phase === 'desk' && x.notebook.length >= 6 && seasons(x) >= 4 && !x.expeditions.length && !!eng.suggestPlan(x, content, 'damascus'));
    const s = eng.outfit(at, content, eng.suggestPlan(at, content, 'damascus'));
    if (seasons(s) < 4 || !s.expeditions.length) throw new Error('layout.mjs: the book fixture has fewer than four seasons of its own, or no party out');
    s.loans.push({ id: 'nell-1', from: 'nell', principal: 100, due: s.t + 4, rate: 0.1 });
    return s;
  })(),
};
// MER-122 (play a062, b070): a second return, where the desk used to open the account and scroll the stack down to the bonus choice,
// leaving the focused headline above the top (y=-292). The engine's policy here sends one party a game, so the earlier return the desk
// counts is the same entry logged twice: the page reads only how many there are.
states.ret2 = (() => { const s = structuredClone(states.ret); s.log.push(structuredClone(s.log.find(e => e.kind === 'return'))); return s; })();
// A question and a report from the road on the desk (MER-63): the engine's own delivery puts the paper
// there from an entry in `post`; only the draw is placed by hand (every cairo letter has weight 0).
const withLetter = (id, kind, stop, lag, standing) => {
  const sent = eng.outfit(states.firstDone, content, eng.suggestPlan(states.firstDone, content, 'damascus')), x = sent.expeditions[0];
  sent.post.push({ id, kind, expedition: x.id, agent: x.agent, stop, standing, written: sent.t, lag, arrive: sent.t + 1 });
  return eng.endSeason(sent, content);
};
// MER-87 (finding 7): the page between acts as the milestone play found it, two settled trips and three paragraphs of the
// years, long enough that its one button is below any frame's fold. The jump entry is the engine's; the lines are added to it.
states.interludeLong = (() => {
  const s = structuredClone(states.interlude), jump = [...s.log].reverse().find(e => e.kind === 'jump');
  const line = (id, text) => ({ expedition: id, result: 'return', text, cargo: { linen: 3 }, houseNet: -13 });
  jump.settled = [line('x91', 'Yusuf came home from Damascus. The house lost 13 dinars.'), line('x92', 'Samir came home from Damascus. The house lost 8 dinars.')];
  const para = t => ({ id: 'p' + t.length, interlude: t });
  jump.events = ['In April 1326 a young scholar from Tangier landed at Alexandria and went on to Cairo. His name was Ibn Battuta. He would travel for about thirty years, and long afterward he told the story of what he saw.',
    'In the summer of 1326 Ibn Battuta crossed the desert toward Aydhab on the Red Sea. He found the crossing shut. The king of the Beja was at war with the sultan\'s soldiers and had sunk the ships. Ibn Battuta turned back to the Nile.',
    'In the summer of 1332 the sultan, al-Nasir Muhammad, set out for Mecca on the pilgrimage. He took his wife and his son Anuk with him. Every Muslim who can make the journey is asked to go once.'].map(para);
  return s;
})();
states.question = withLetter('first-road-letter', 'question', 'damascus', 2, false);
states.report = withLetter('toll-at-aydhab', 'report', 'aydhab', 1, true);
const plain = s => JSON.parse(JSON.stringify(s));
// MER-80: a loss paper and an Accounts paper laid by hand on the return's season. The loss carries the
// choices of the `loss-sea-gone` entry of returns.json as routes.js would fill them; the Accounts items are
// shaped as `accountItem` writes them (a cause, a choice, the changes).
{
  const base = plain(states.ret), r = base.desk.find(p => p.kind === 'return' && p.state === 'open');
  const entry = content.returns.find(e => e.id === 'loss-sea-gone'), fill = x => x?.replaceAll('{agent}', 'Ali').replaceAll('{to}', 'Damascus');
  states.loss = { ...base, desk: [{ id: 'p80-0', state: 'open', kind: 'lost', ref: 'lost', agent: 'ali', expedition: r.expedition, data: {
    headline: 'Ali\'s galley was lost on the way from Cairo to Damascus. Ali did not come back.', route: 'cairo-damascus', whole: true, survived: false,
    lines: [{ label: 'Lost', text: 'The ship and what it carried.' }, { label: 'The house lost', text: '200 dinars' }], costs: [], trip: {}, entry: entry.id,
    ask: { title: fill(entry.title), body: fill(entry.body) },
    choices: entry.choices.map(c => ({ ...structuredClone(c), label: fill(c.label), ...(c.hint !== undefined ? { hint: fill(c.hint) } : {}) })) } }] };
  states.accounts = { ...base, desk: [{ id: 'p80-1', state: 'open', kind: 'accounts', ref: 'accounts', items: [
    { from: 'lend/yes', card: 'Hasan asks for a loan', choice: 'Lend him 50 dinars', changes: ['+60 dinars'], text: 'a' },
    { from: 'lend/yes', card: 'Hasan asks for a loan', choice: 'Lend him 50 dinars', changes: ["Hasan's trust +1"], text: 'b' },
    { from: 'gift/yes', card: 'A gift for the court', choice: 'Send the gift', changes: ['good name with court +1'], text: 'c' }] }] };
}

// MER-84: the ending's pages after the recall was sent. Every expedition still out is called home, so the
// engine's own rolls decide who lives; the pages read the state this leaves.
// The seeded game reaches the plague with nobody out, so the recall page is also drawn from the last season
// replayed with four expeditions sent on the engine's plans: four rows with their two buttons each.
states.road = (() => {
  let s = fresh();
  for (let i = 0; i < 80 && !(s.phase === 'desk' && s.t === 23); i++) s = s.phase === 'interlude' ? eng.openSeason(s, content) : playSeason(s);
  s = playPapers(s);
  for (const stop of ['damascus', 'aydhab', 'alexandria', 'damascus']) { const plan = eng.suggestPlan(s, content, stop); if (plan) s = eng.outfit(s, content, plan); }
  s = eng.endSeason(s, content);
  if (s.phase !== 'recall' || s.expeditions.length < 3) throw new Error('layout.mjs: the last season did not end with people on the road');
  return s;
})();
states.ended = eng.recall(states.road, content, Object.fromEntries(states.road.expeditions.map((x, i) => [x.id, i % 2 ? 'stay' : 'recall'])));

const server = await serve(PORT);
const browser = await launch();

// ---- one page at one frame
async function open(frame) {
  const page = await prepPage(browser, BASE, { width: frame.width, height: frame.height, dsf: 2, mobile: !!frame.mobile });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource.*404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  if (page.emulateMediaFeatures) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  else await page.emulateMedia({ reducedMotion: 'reduce' });
  return { page, errors };
}
const settle = async page => {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), { timeout: 5000 }).catch(() => {});
  if (BREAK) await page.addStyleTag({ content: BREAKS[BREAK] });
};
const load = async (page, hash, { state = null, large = false } = {}) => {
  await page.goto(GAME, { waitUntil: 'load' });
  await page.evaluate((s, v) => { localStorage.clear(); if (s) localStorage.setItem('merchant-save', JSON.stringify({ ...s, __v: v })); }, state && plain(state), SAVE_VERSION);
  await page.goto(GAME + hash, { waitUntil: 'load' });
  await page.evaluate(v => document.documentElement.classList.toggle('large-text', v), large);
};

/** The bar's own button where the frame shows it; the Menu's item on the phone frames, where the bar holds only Menu. */
const openBook = async (p, name) => {
  await p.waitForSelector('#btn-menu');
  if (await p.$eval(`#btn-${name}`, e => e.checkVisibility())) { await p.click(`#btn-${name}`); return; }
  await p.click('#btn-menu'); await p.waitForSelector(`#menu-${name}`); await p.click(`#menu-${name}`);
};

// ---- the screens: each leaves the page ready to measure and names the part of it that is "raised"
const SCREENS = [
  { name: 'title', ready: '#screen-title',
    go: async (p, f) => { await load(p, '#title', { large: f.large }); await p.waitForSelector('#screen-title'); } },
  { name: 'title-continue', ready: '#btn-continue',
    go: async (p, f) => { await load(p, '#title', { state: states.start, large: f.large }); await p.waitForSelector('#btn-continue'); } },
  { name: 'title-ended', ready: '#title-last',
    go: async (p, f) => { await load(p, '#title', { state: states.ended, large: f.large }); await p.waitForSelector('#title-last'); } },
  { name: 'new-game', modal: 'dialog[open]',
    go: async (p, f) => { await load(p, '#title', { large: f.large }); await p.waitForSelector('#btn-new'); await p.click('#btn-new'); await p.waitForFunction(() => document.getElementById('panel-newgame')?.open); } },
  { name: 'desk-letter',
    go: async (p, f) => { await load(p, '#desk', { state: states.start, large: f.large }); await p.waitForSelector('#screen-desk .sheet-title'); } },
  { name: 'desk-question',
    go: async (p, f) => { await load(p, '#desk', { state: states.question, large: f.large }); await p.waitForSelector('#screen-desk .letter-answer'); } },
  { name: 'desk-report',
    go: async (p, f) => { await load(p, '#desk', { state: states.report, large: f.large }); await p.waitForSelector('#screen-desk .letter-line'); } },
  { name: 'desk-papers',
    go: async (p, f) => { await load(p, '#desk', { state: states.full, large: f.large }); await p.waitForSelector('#screen-desk .sheet-title'); } },
  { name: 'desk-return',
    go: async (p, f) => {
      await load(p, '#desk', { state: states.ret, large: f.large });
      await p.waitForSelector('#screen-desk .sheet-title');
      const id = states.ret.desk.find(x => x.kind === 'return' && x.state === 'open').id;
      if (await p.$eval('.sheet', (e, i) => e.dataset.paper !== i, id)) { await p.$eval(`.edge[data-paper="${id}"]`, e => e.scrollIntoView({ block: 'center' })); await p.click(`.edge[data-paper="${id}"]`); }
      await p.waitForFunction(i => document.querySelector('.sheet')?.dataset.paper === i, {}, id);
    } },
  { name: 'desk-return2',
    go: async (p, f) => {
      await load(p, '#desk', { state: states.ret2, large: f.large });
      await p.waitForSelector('#screen-desk .sheet-title');
      const id = states.ret2.desk.find(x => x.kind === 'return' && x.state === 'open').id;
      if (await p.$eval('.sheet', (e, i) => e.dataset.paper !== i, id)) { await p.$eval(`.edge[data-paper="${id}"]`, e => e.scrollIntoView({ block: 'center' })); await p.click(`.edge[data-paper="${id}"]`); }
      await p.waitForFunction(i => document.querySelector('.sheet')?.dataset.paper === i, {}, id);
    } },
  { name: 'desk-loss',
    go: async (p, f) => { await load(p, '#desk', { state: states.loss, large: f.large }); await p.waitForSelector('#screen-desk .picture-slot'); } },
  { name: 'desk-accounts',
    go: async (p, f) => { await load(p, '#desk', { state: states.accounts, large: f.large }); await p.waitForSelector('#screen-desk .account-group'); } },
  { name: 'outfit', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#map', { state: states.firstDone, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      await p.click('#btn-outfit');
      await p.waitForFunction(() => document.getElementById('panel-outfit')?.open);
    } },
  { name: 'price-board',
    go: async (p, f) => {
      await load(p, '#map', { state: states.firstDone, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      // phone upright and the narrower frames: the board is a dialog opened by its button
      if (await p.$eval('#prices-box', e => getComputedStyle(e).display === 'none')) { await p.click('#btn-prices'); }
    },
    modalOf: p => p.evaluate(() => { const b = document.getElementById('prices-box'); return b?.getAttribute('aria-modal') === 'true' ? '#prices-box' : null; }) },
  { name: 'outfit-second', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#map', { state: states.second, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      await p.click('#btn-outfit');
      await p.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await p.waitForSelector('#outfit-estimate');
    } },
  // MER-99: every sheet opens as the summary (outfit-second above); this is the same sheet with every section opened by its Change link,
  // so the steppers, the agent cards and the contract cards are still measured
  { name: 'outfit-second-open', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#map', { state: states.second, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      await p.click('#btn-outfit');
      await p.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      // the phone's Send bar sticks over the foot of the sheet, and a press at a covered point lands on the bar: bring each link to the middle first
      for (const id of ['who', 'carry', 'back', 'contract']) { await p.$eval(`#change-${id}`, e => e.scrollIntoView({ block: 'center' })); await p.click(`#change-${id}`); }
      await p.waitForSelector('#step-purse');
      await p.waitForSelector('#contract-own');
    } },
  // MER-117: the same sheet with only the carry list opened. The bring-back summary and its Change link sit below it, where the sticky Send bar
  // used to cover the link at some frames, so a pointer press on it landed on the bar.
  { name: 'outfit-second-carry', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#map', { state: states.second, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      await p.click('#btn-outfit');
      await p.waitForFunction(() => document.getElementById('panel-outfit')?.open);
      await p.$eval('#change-carry', e => e.scrollIntoView({ block: 'center' }));
      await p.click('#change-carry');
      await p.waitForSelector('#step-purse');
      await p.waitForSelector('#change-back');
    } },
  { name: 'price-board-news',
    go: async (p, f) => {
      await load(p, '#map', { state: states.second, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      if (await p.$eval('#prices-box', e => getComputedStyle(e).display === 'none')) { await p.click('#btn-prices'); }
      await p.waitForSelector('#best-trades li');
    },
    modalOf: p => p.evaluate(() => { const b = document.getElementById('prices-box'); return b?.getAttribute('aria-modal') === 'true' ? '#prices-box' : null; }) },
  { name: 'ledger', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#desk', { state: states.book, large: f.large });
      await openBook(p, 'ledger');
      await p.waitForFunction(() => document.getElementById('panel-ledger')?.open);
      // the shot's money trail is four different seasons, the engine's own (MER-119), not one season four times
      const seasons = await p.$$eval('#ledger-trail li[data-change] span', n => n.map(e => e.textContent));
      if (seasons.length !== 4 || new Set(seasons).size !== 4) throw new Error(`layout.mjs: the ledger shot shows ${JSON.stringify(seasons)}, not four different seasons`);
    } },
  { name: 'notebook', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#desk', { state: states.book, large: f.large });
      await openBook(p, 'notebook');
      await p.waitForFunction(() => document.getElementById('panel-notebook')?.open);
    } },
  { name: 'between-acts',
    go: async (p, f) => { await load(p, '#desk', { state: states.interlude, large: f.large }); await p.waitForSelector('#btn-open-house'); } },
  { name: 'between-acts-long',
    go: async (p, f) => { await load(p, '#desk', { state: states.interludeLong, large: f.large }); await p.waitForSelector('#btn-open-house'); } },
  ...[['notice', 'road', 'ending-next'], ['recall', 'road', 'ending-send'], ['recall-empty', 'recall', 'ending-send'], ['home', 'ended', 'ending-next'], ['score', 'ended', 'ending-next'], ['after', 'ended', 'ending-again']].map(([page, st, ready]) => ({
    name: `ending-${page}`,
    go: async (p, f) => { const at = page.replace('-empty', ''); await load(p, `#ending/${at}`, { state: states[st], large: f.large }); await p.waitForSelector(`#${ready}`); await p.waitForSelector(`[data-page="${at}"]`); } })),
];

/** Is the element wholly on screen, inside every box that clips it, and not under anything (the top bar, End the season)? */
const wholeInView = sel => {
  const el = document.querySelector(sel);
  if (!el) return `${sel} is not on the page`;
  const r = el.getBoundingClientRect();
  let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    if (getComputedStyle(a).overflowY !== 'visible') { const b = a.getBoundingClientRect(); top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
  }
  if (r.top < top - 0.5 || r.bottom > bottom + 0.5) return `${sel} spans ${Math.round(r.top)} to ${Math.round(r.bottom)} and only ${Math.round(top)} to ${Math.round(bottom)} is on screen`;
  const bar = document.querySelector('.topbar')?.getBoundingClientRect();
  if (bar && r.top < bar.bottom - 0.5) return `${sel} is under the top bar`;
  for (const [x, y] of [[r.left + 4, r.top + 2], [r.left + 4, r.bottom - 2], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]]) {
    const on = document.elementFromPoint(x, y);
    if (on && !(el.contains(on) || on.contains(el))) return `${sel} is covered by ${on.id ? '#' + on.id : on.className || on.tagName}`;
  }
  return null;
};

// ---- the measuring, in the page. `scopeSel` is what is measured (a dialog when one is open).
const measureGeometry = (scopeSel, minTarget) => {
  const scope = (scopeSel && document.querySelector(scopeSel)) || document.body;
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const nameOf = el => (el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''))
    + ((el.textContent || '').trim() ? ` "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)}"` : '');
  const shown = el => el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false }) && !el.closest('[inert]:not(dialog)');
  const all = [...scope.querySelectorAll('*')].filter(e => shown(e));
  const overflow = [], target = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth) overflow.push(`the page scrolls sideways: scrollWidth ${de.scrollWidth} against ${de.clientWidth}`);
  if (document.body.scrollWidth > document.body.clientWidth) overflow.push(`the body scrolls sideways: ${document.body.scrollWidth} against ${document.body.clientWidth}`);
  // the nearest ancestor that clips or scrolls on an axis, other than the page
  const clipper = (el, axis) => {
    for (let a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      const o = getComputedStyle(a)['overflow' + axis];
      if (o !== 'visible') return { el: a, scrolls: (o === 'auto' || o === 'scroll') && (axis === 'X' ? a.scrollWidth > a.clientWidth + 1 : a.scrollHeight > a.clientHeight + 1) };
    }
    return null;
  };
  const fixedAncestor = el => { for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false; };
  const raised = e => e.closest('.sheet, dialog[open], #prices-box, .phase, .kind-phase');
  const pageScrolls = de.scrollHeight > de.clientHeight + 1;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;               // visually hidden text
    if (getComputedStyle(el).position === 'fixed' && getComputedStyle(el).pointerEvents === 'none') continue;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue; // the map's own drawing is MER-44b's
    if (r.left < -0.5 || r.right > vw + 0.5) {
      const c = clipper(el, 'X');
      if (!c) overflow.push(`${nameOf(el)} is ${r.left < 0 ? `${Math.round(-r.left)} px past the left edge` : `${Math.round(r.right - vw)} px past the right edge`}`);
    }
    if (raised(el) && (r.top < -0.5 || r.bottom > vh + 0.5)) {
      const c = clipper(el, 'Y');
      const reachable = (c && c.scrolls) || (!fixedAncestor(el) && pageScrolls);
      if (!reachable) overflow.push(`${nameOf(el)} is ${r.top < 0 ? `${Math.round(-r.top)} px above` : `${Math.round(r.bottom - vh)} px below`} the viewport with nothing to scroll`);
    }
  }
  const hits = [...scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=option], [role=tab], [role=switch], [role=checkbox], [tabindex]:not([tabindex="-1"])')].filter(shown);
  const seen = new Set();
  for (const el0 of hits) {
    if (el0.closest('svg')) continue;
    // a radio or checkbox is pressed through its label, which may be a sibling or a parent
    const lab = el0.matches('input') ? [...(el0.labels ?? [])].filter(shown).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] : null;
    const el = lab ?? el0;
    if (seen.has(el) || el.disabled) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    const inline = el.matches('a') && getComputedStyle(el).display === 'inline';
    const w = Math.round(r.width * 10) / 10, h = Math.round(r.height * 10) / 10;
    if (h < minTarget - 0.5 || (!inline && w < minTarget - 0.5)) target.push(`${nameOf(el)} is ${w} x ${h}`);
  }
  return { overflow, target };
};

/** Every text line in scope with its colour and where it is, for the contrast pass. */
const collectText = scopeSel => {
  const scope = (scopeSel && document.querySelector(scopeSel)) || document.body;
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const out = [];
  // fixed bars and fades that paint over the page without taking pointer events (elementFromPoint cannot see them)
  const overlays = [...document.querySelectorAll('body *')].filter(e => {
    const c = getComputedStyle(e);
    return c.position === 'fixed' && c.pointerEvents === 'none' && e.checkVisibility() && (c.backgroundImage !== 'none' || !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c.backgroundColor));
  });
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || el.closest('script, style, noscript, svg, [inert]:not(dialog)')) continue;
    if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })) continue;
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;     // inactive controls are exempt
    // the map's own labels are MER-44b's (journey.mjs); text clipped to nothing is not seen
    if (el.closest('.stop-label, .token-label, .visually-hidden, .sr-only')) continue;
    const cs = getComputedStyle(el);
    let opacity = 1;
    for (let a = el; a; a = a.parentElement) opacity *= parseFloat(getComputedStyle(a).opacity);
    const range = document.createRange(); range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      // keep what is on screen and inside every clipping ancestor
      let x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, vw), y1 = Math.min(r.bottom, vh);
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ca = getComputedStyle(a);
        if (ca.overflow !== 'visible') { const b = a.getBoundingClientRect(); x0 = Math.max(x0, b.left); y0 = Math.max(y0, b.top); x1 = Math.min(x1, b.right); y1 = Math.min(y1, b.bottom); }
        // a fixed box is placed against the viewport: what scrolls or clips its ancestors does not clip it (the price board's phone dialog
        // sits inside the board, which scrolls; with a short panel every line was above the board's own top edge and none was measured)
        if (ca.position === 'fixed') break;
      }
      // a line cut by its scroll box is half a line: it is measured when it scrolls fully into view
      if ((y1 - y0) < (r.height - 1) || (x1 - x0) < (r.width - 1)) continue;
      // a line box is a little taller than the glyphs: a chip's 1 px border or an underline sits inside
      // it, so sample the middle of the line and not its edges
      const ih = (y1 - y0) * 0.2; x0 += 1; x1 -= 1; y0 += ih; y1 -= ih;
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      // text under something else (a fixed bar, another paper) is not on screen: ask what is on top
      // at the middle, each end, and half a pixel outside the sampled box above and below (a bar whose layout edge is 0.15 px short of the pixel row it paints
      // tinted one sampled row and read as a 1.5:1 label, MER-84); a line partly covered waits until it scrolls clear
      const covered = [[(x0 + x1) / 2, (y0 + y1) / 2], [x0 + 1, (y0 + y1) / 2], [x1 - 1, (y0 + y1) / 2], [(x0 + x1) / 2, y0 - 0.5], [(x0 + x1) / 2, y1 + 0.5]].some(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return top && !(el.contains(top) || top.contains(el));
      });
      if (covered) continue;
      const under = overlays.some(o => !o.contains(el) && !el.contains(o) && (b => b.left < x1 && b.right > x0 && b.top < y1 && b.bottom > y0)(o.getBoundingClientRect()));
      if (under) continue;
      out.push({ text: text.slice(0, 30), tag: el.id ? `#${el.id}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
        color: cs.color, opacity, x0, y0, x1, y1 });
    }
  }
  return out;
};

const HIDE_TEXT = '*,*::before,*::after{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important;caret-color:transparent!important;text-decoration-color:transparent!important}svg text{fill:transparent!important;stroke:none!important}';
/** The worst contrast of each collected line against the pixels behind it, from a screenshot of the page without its text. */
const sampleContrast = (lines, b64, dsf) => new Promise(resolve => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (r, g2, b) => 0.2126 * lin(r) + 0.7152 * lin(g2) + 0.0722 * lin(b);
    const parse = s => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const res = [];
    for (const l of lines) {
      const fg = parse(l.color), a = fg.a * l.opacity;
      const sx = Math.round(l.x0 * dsf), sy = Math.round(l.y0 * dsf), sw = Math.max(1, Math.round((l.x1 - l.x0) * dsf)), sh = Math.max(1, Math.round((l.y1 - l.y0) * dsf));
      if (sx < 0 || sy < 0 || sx + sw > img.width || sy + sh > img.height) continue;
      const d = g.getImageData(sx, sy, sw, sh).data;
      let worst = Infinity, at = null;
      const stepPx = Math.max(1, Math.floor((sw * sh) / 1500));
      for (let i = 0; i < sw * sh; i += stepPx) {
        const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
        const L2 = lum(a * fg.r + (1 - a) * R, a * fg.g + (1 - a) * G, a * fg.b + (1 - a) * B), L1 = lum(R, G, B);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < worst) { worst = ratio; at = [R, G, B]; }
      }
      res.push({ text: l.text, tag: l.tag, ratio: worst, color: l.color, bg: at });
    }
    resolve(res);
  };
  img.src = 'data:image/png;base64,' + b64;
});

/** The scroll containers in scope that have something below the fold, marked so they can be found again. */
const markScrollers = scopeSel => {
  const scope = (scopeSel && document.querySelector(scopeSel)) || document.body;
  let n = 0;
  for (const el of [scope, ...scope.querySelectorAll('*')]) {
    if (el === document.body) continue;
    const o = getComputedStyle(el).overflowY;
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 1 && el.checkVisibility()) el.dataset.layoutScroller = String(n++);
  }
  return n + (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 ? 1 : 0);
};

async function contrastOf(page, scopeSel, dsf) {
  const worst = new Map();   // one entry per line of text: the lowest ratio seen at any scroll position
  const pass = async () => {
    const lines = await page.evaluate(collectText, scopeSel);
    await page.addStyleTag({ content: HIDE_TEXT }).then(h => page.evaluate(() => { window.__hideStyle = document.head.lastElementChild; }));
    const buf = await page.screenshot({ type: 'png' });
    await page.evaluate(() => window.__hideStyle?.remove());
    const got = await page.evaluate(sampleContrast, lines, Buffer.from(buf).toString('base64'), dsf);
    for (const g of got) { const k = `${g.tag}|${g.text}`; if (!worst.has(k) || g.ratio < worst.get(k).ratio) worst.set(k, g); }
  };
  await pass();
  const scrollers = await page.evaluate(markScrollers, scopeSel);
  // each scroller in turn: page by page down to its end, then back to the top
  const ids = await page.$$eval('[data-layout-scroller]', els => els.map(e => e.dataset.layoutScroller));
  for (const id of ids) {
    const steps = await page.$eval(`[data-layout-scroller="${id}"]`, e => Math.ceil((e.scrollHeight - e.clientHeight) / (e.clientHeight * 0.8)));
    for (let k = 1; k <= Math.min(steps, 12); k++) {
      await page.$eval(`[data-layout-scroller="${id}"]`, (e, k) => { e.scrollTop = k * e.clientHeight * 0.8; }, k);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      await pass();
    }
    await page.$eval(`[data-layout-scroller="${id}"]`, e => { e.scrollTop = 0; });
  }
  if (await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1)) {
    const steps = await page.evaluate(() => Math.ceil((document.documentElement.scrollHeight - innerHeight) / (innerHeight * 0.8)));
    for (let k = 1; k <= Math.min(steps, 12); k++) { await page.evaluate(k => scrollTo(0, k * innerHeight * 0.8), k); await page.evaluate(() => new Promise(r => requestAnimationFrame(r))); await pass(); }
    await page.evaluate(() => scrollTo(0, 0));
  }
  await page.evaluate(() => document.querySelectorAll('[data-layout-scroller]').forEach(e => delete e.dataset.layoutScroller));
  return { lines: [...worst.values()], scrollers };
}

// Findings in screens another unit owns, found by this suite on 2026-11-17 and reported rather than
// fixed. Each is matched by screen, check and text; a finding that matches is not a failure, and an
// entry that matches nothing in a full run is one (delete it when the screen is fixed).
const KNOWN = [
];
const knownHits = KNOWN.map(() => 0);
const unknown = (screen, check, list) => BREAK ? list : list.filter(f => {
  const i = KNOWN.findIndex(k => k.screen === screen && k.check === check && k.match.test(f));
  if (i >= 0) knownHits[i]++;
  return i < 0;
});
const brief = list => list.length ? `${list.length}: ${list.slice(0, 6).join('; ')}${list.length > 6 ? '; ...' : ''}` : '';

try {
  for (const screen of SCREENS) {
    if (ONLY.length && !ONLY.includes(screen.name)) continue;
    for (const frame of FRAMES) {
      const tag = `${screen.name} at ${frame.name} ${frame.width}x${frame.height}`;
      const { page, errors } = await open(frame);
      let ready = false, scopeSel = screen.modal || null;
      await test(`${tag}: the screen comes up`, async () => {
        await screen.go(page, frame);
        await settle(page);
        if (screen.modalOf) scopeSel = await screen.modalOf(page);
        ready = true;
      });
      if (ready) {
        await page.screenshot({ path: path.join(SHOTS, `${screen.name}-${frame.name}.png`) });
        // measured first: the contrast pass below scrolls every scroller and puts it back at the top
        if (OPENS_WITH[screen.name] && OPEN_FRAMES.has(frame.name) && !frame.large && !(HEADLINE_WINS.has(screen.name) && frame.name !== 'board')) {
          await test(`${tag}: what the paper asks is in view when it opens, no scrolling`, async () => {
            const bad = await page.evaluate(wholeInView, OPENS_WITH[screen.name]);
            ok(!bad, bad ?? '');
          });
        }
        if (LAST_CHOICE[screen.name] && LAST_FRAMES.has(frame.name) && !frame.large && !(HEADLINE_WINS.has(screen.name) && frame.name !== 'board')) {
          await test(`${tag}: the last choice is in view above End the season, no scrolling`, async () => {
            const bad = await page.evaluate(wholeInView, LAST_CHOICE[screen.name]);
            ok(!bad, bad ?? '');
          });
        }
        if (screen.name === 'desk-return') {
          // MER-105: the top bar and the raised paper never share a pixel, and the bar never sits on the papers-left tag or the sender line
          // (boxes, not pixels: the suite once passed 985 cases with Map and Menu on top of "Yusuf Home from the road")
          // measured with the page at its top, where the desk opens: the harness scrolled an edge to the middle to press it, and any fixed bar
          // is over whatever has scrolled up under it
          await test(`${tag}: the top bar clears the paper, the papers-left tag and the sender line`, async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            const got = await page.evaluate(() => {
              // the part of the element a player can see: its box cut down by every ancestor that clips or scrolls (a tall paper scrolls inside the stack on a laptop)
              const box = sel => { const e = document.querySelector(sel); if (!e || !e.checkVisibility()) return null; const r = e.getBoundingClientRect(); const v = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
                for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowY !== 'visible') { const b = a.getBoundingClientRect(); v.top = Math.max(v.top, b.top); v.bottom = Math.min(v.bottom, b.bottom); } }
                return v; };
              const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
              const bar = box('.topbar'), out = {};
              for (const sel of ['.sheet', '.sheet-head .sender', '.stack-count']) { const b = box(sel); out[sel] = b === null ? 'missing' : hit(bar, b) ? `${Math.round(b.top)} to ${Math.round(b.bottom)} against the bar's ${Math.round(bar.top)} to ${Math.round(bar.bottom)}` : null; }
              return out;
            });
            ok(got['.sheet'] !== 'missing' && got['.sheet-head .sender'] !== 'missing' && got['.stack-count'] !== 'missing', `the desk is missing a part: ${JSON.stringify(got)}`);
            ok(!got['.sheet'], `the bar overlaps the paper: ${got['.sheet']}`);
            ok(!got['.sheet-head .sender'], `the bar overlaps the sender line: ${got['.sheet-head .sender']}`);
            ok(!got['.stack-count'], `the bar overlaps the papers-left tag: ${got['.stack-count']}`);
          });
          // MER-108: where the page scrolls under the fixed bar (the upright phones), nothing of a paper shows through it. Measured with the page
          // scrolled down half a screen; on a frame that never scrolls no .sheet reaches the bar and the bar keeps the board's translucent look.
          await test(`${tag}: scrolled down, the top bar is opaque over any paper under it and stacks above it`, async () => {
            await page.evaluate(() => window.scrollTo(0, Math.round(innerHeight / 2)));
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            const got = await page.evaluate(() => {
              const bar = document.querySelector('.topbar');
              if (!bar || !bar.checkVisibility()) return { missing: true };
              const r = bar.getBoundingClientRect();
              // the part of a paper a player can see: its box cut down by every ancestor that clips or scrolls
              const seen = e => { const q = e.getBoundingClientRect(); const v = { top: q.top, bottom: q.bottom, left: q.left, right: q.right };
                for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { if (getComputedStyle(x).overflowY !== 'visible') { const c = x.getBoundingClientRect(); v.top = Math.max(v.top, c.top); v.bottom = Math.min(v.bottom, c.bottom); } }
                return v; };
              const under = [...document.querySelectorAll('.sheet')].filter(e => { const b = seen(e); return b.right - b.left > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom - 0.5 && b.bottom > r.top + 0.5; }).length;
              const bg = getComputedStyle(bar).backgroundColor.match(/[\d.]+/g).map(Number);
              const tops = [0.2, 0.5, 0.8].map(f => { const e = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2); return !!e && (e === bar || bar.contains(e)); });
              return { under, alpha: bg.length > 3 ? bg[3] : 1, tops, scrollY: Math.round(scrollY) };
            });
            await page.evaluate(() => window.scrollTo(0, 0));
            ok(!got.missing, 'the top bar is not on the desk');
            ok(!got.under || got.alpha === 1, `${got.under} paper box(es) lie under the bar at scrollY ${got.scrollY} and the bar is ${got.alpha} opaque, so their text shows through`);
            ok(!got.under || got.tops.every(Boolean), `a paper is above the bar at one of three points inside it: ${got.tops}`);
          });
          // the End the season bar is opaque wherever it covers other papers, and the last choice clears it when the page is scrolled to its foot
          await test(`${tag}: End the season shows nothing from under it and never covers the last choice`, async () => {
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            const got = await page.evaluate(() => {
              const row = document.querySelector('.end-row'), last = document.querySelector('.sheet .choices .choice:last-of-type');
              if (!row || !row.checkVisibility() || !last) return { missing: true };
              const rr = row.getBoundingClientRect(), lr = last.getBoundingClientRect();
              const bg = getComputedStyle(row).backgroundColor.match(/[\d.]+/g).map(Number);
              const covers = getComputedStyle(row).position === 'sticky' || getComputedStyle(row).position === 'fixed';
              return { covers, alpha: bg.length > 3 ? bg[3] : 1, overlap: lr.left < rr.right && lr.right > rr.left && lr.top < rr.bottom - 0.5 && lr.bottom > rr.top + 0.5, last: [Math.round(lr.top), Math.round(lr.bottom)], row: [Math.round(rr.top), Math.round(rr.bottom)] };
            });
            await page.evaluate(() => window.scrollTo(0, 0));
            ok(!got.missing, 'End the season or the last choice is not on the desk');
            ok(!got.covers || got.alpha === 1, `the bar that sticks over the papers is ${got.alpha} opaque, so the papers under it show through`);
            ok(!got.overlap, `the bar (${got.row}) covers the last choice (${got.last})`);
          });
        }
        if (screen.name === 'outfit-second-carry') {
          // elementFromPoint at the link's centre is the link, wherever the scroll puts it by a press, a focus or a scroll-into-view; then a real pointer press opens the section
          await test(`${tag}: #change-back is clear of the Send bar and a pointer press on it opens the bring-back section`, async () => {
            const got = await page.evaluate(() => {
              const dlg = document.querySelector('dialog[open]'), link = document.getElementById('change-back');
              if (!link || !dlg.querySelector('.send-row')) return { missing: true };
              const probe = how => {
                const r = link.getBoundingClientRect(), d = dlg.getBoundingClientRect(), y = r.top + r.height / 2;
                if (y < d.top || y > d.bottom) return null;   // scrolled out of the dialog: nothing covers it, nothing can press it
                const e = document.elementFromPoint(r.left + r.width / 2, y);
                return e && link.contains(e) ? null : `${how}: the point at ${Math.round(y)} is ${e ? (e.id || e.className || e.tagName) : 'nothing'}, the bar is ${Math.round(dlg.querySelector('.send-row').getBoundingClientRect().top)} down`;
              };
              const bad = [];
              const run = (how, f) => { f(); const m = probe(how); if (m) bad.push(m); };
              run('as the carry press left it', () => {});
              run('at the top', () => { dlg.scrollTop = 0; });
              run('scrolled into view from the top', () => { dlg.scrollTop = 0; link.scrollIntoView({ block: 'nearest' }); });
              run('scrolled into view from the foot', () => { dlg.scrollTop = dlg.scrollHeight; link.scrollIntoView({ block: 'nearest' }); });
              run('focused from the top', () => { dlg.scrollTop = 0; link.focus(); });
              return { bad };
            });
            ok(!got.missing, 'the link or the Send bar is not on the sheet');
            ok(!got.bad.length, got.bad.join('; '));
            await page.evaluate(() => { document.querySelector('dialog[open]').scrollTop = 0; });
            await page.click('#change-back');
            await page.waitForSelector('#back-nothing', { timeout: 3000 });
          });
        }
        if (screen.name === 'desk-return2' || screen.name === 'desk-return') {
          // MER-122 (finding 7): a return opens on its headline, in view and focused, at every frame, whatever the account below it holds
          await test(`${tag}: the return's headline is in view and has the focus when the paper opens`, async () => {
            const got = await page.evaluate(wholeInView, '.sheet-title');
            ok(!got, got ?? '');
            eq(await page.evaluate(() => document.activeElement.className), 'sheet-title');
          });
        }
        if (screen.name === 'desk-return' && frame.name === 'board') {
          // MER-104: the headline is who came home and what the house made, at most three lines; the rest sits under it in body type
          await test(`${tag}: the return's headline is at most three lines and the hope, the reason and the unsold goods sit under it`, async () => {
            const got = await page.evaluate(() => {
              const t = document.querySelector('.sheet-title'), lead = document.querySelector('.sheet-title + .return-lead');
              const lh = parseFloat(getComputedStyle(t).lineHeight) || parseFloat(getComputedStyle(t).fontSize) * 1.2;
              return { lines: Math.round(t.getBoundingClientRect().height / lh), title: t.textContent, lead: lead?.textContent ?? null,
                titleSize: parseFloat(getComputedStyle(t).fontSize), leadSize: lead ? parseFloat(getComputedStyle(lead).fontSize) : null };
            });
            ok(got.lines <= 3, `the headline sets ${got.lines} lines: ${got.title}`);
            ok(!/We (hoped|expected)/.test(got.title), `the hope is not in the headline: ${got.title}`);
            ok(got.lead && /We (hoped|expected)/.test(got.lead), `the lead holds the hope: ${got.lead}`);
            ok(got.leadSize < got.titleSize, `the lead is in body type: ${got.leadSize} against ${got.titleSize}`);
          });
        }
        const geo = await page.evaluate(measureGeometry, scopeSel, MIN_TARGET);
        await test(`${tag}: no overflow, nothing outside the viewport without a way to scroll to it`, async () => { ok(!geo.overflow.length, brief(geo.overflow)); });
        await test(`${tag}: every hit target is ${MIN_TARGET} px`, async () => { { const t = unknown(screen.name, 'target', geo.target); ok(!t.length, brief(t)); }; });
        await test(`${tag}: text contrast is ${MIN_CONTRAST}:1 against what is behind it`, async () => {
          const { lines } = await contrastOf(page, scopeSel, 2);
          ok(lines.length > 0, 'no text was measured');
          const bad = lines.filter(l => l.ratio < MIN_CONTRAST).sort((a, b) => a.ratio - b.ratio)
            .map(l => `${l.tag} "${l.text}" ${l.ratio.toFixed(2)}:1 (${l.color} on rgb(${l.bg?.join(', ')}))`);
          const b = unknown(screen.name, 'contrast', bad); ok(!b.length, brief(b));
        });
        // MER-71 (finding 14): the title and the desk are no taller than the frame. The upright phone's desk is a page
        // that scrolls by design (one column under the band), and Large text may outgrow a short frame by its size.
        if (FITS.has(screen.name) && !frame.large && !(screen.name !== 'title' && screen.name !== 'title-continue' && frame.height > frame.width)) {
          await test(`${tag}: the page is no taller than the frame`, async () => {
            const m = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, body: document.body.scrollHeight, ih: innerHeight }));
            ok(m.doc <= m.ih && m.body <= m.ih, `the page is ${m.doc} px (body ${m.body}) in a frame ${m.ih} px tall`);
          });
        }
        // MER-71 (finding 14): between the acts and at the end there is no End the season, and no empty bar where it was
        if (screen.name === 'between-acts') {
          await test(`${tag}: no stray bar where End the season was`, async () => {
            const m = await page.evaluate(() => ({ row: document.querySelector('.end-row')?.checkVisibility() ?? false, reason: document.querySelector('.end-reason')?.checkVisibility() ?? false }));
            eq(m, { row: false, reason: false });
          });
        }
        await test(`${tag}: no console error, nothing offsite`, async () => { eq(errors, []); eq(page.__blocked, []); });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (!BREAK && !ONLY.length) await test('every known finding still reproduces (a fixed screen has its entry deleted)', async () => {
  const stale = KNOWN.filter((k, i) => !knownHits[i]).map(k => `${k.screen} ${k.check} ${k.match}`);
  ok(!stale.length, stale.join('; '));
});
await done();
