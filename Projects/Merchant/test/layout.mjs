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
  // MER-138: each deliberate fault is one of the bugs its case guards (#34); `layout.mjs` without the variable never reads these
  tabs: '.stack-papers{overflow-y:auto!important}.sheet-box{overflow:visible!important;flex:none!important}.edges{position:sticky!important;top:0;z-index:1;flex-wrap:nowrap!important}.edge{flex:0 1 auto!important}.edge>span:not(.seal){display:block!important;white-space:nowrap!important;text-overflow:ellipsis!important}',
  glyph: '.step-btn{display:block!important;text-align:left!important;padding:0 0 0 3px!important}',
  homelink: '#lnk-all-games{display:none!important}',
  picture: '.title-still{object-position:0 0!important}',
  blurb: '.title-what{display:block!important}',
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
// the plain sky of A18, from its manifest row: [x, y, w, h] as fractions of the picture
const titleSafe = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'assets', 'art', 'manifest.json'), 'utf8')).assets.find(a => a.id === 'title').safe;
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
  // the engine's own shape for a trip that came home (routes.js settle): what it carried out, what came back and the seasons it was away (MER-125)
  const line = (id, text) => ({ expedition: id, result: 'home', text, cargo: { linen: 3 }, back: { goods: { silk: 2 }, money: 40 }, seasons: 3, houseNet: -13 });
  jump.settled = [line('x91', 'Yusuf came home from Damascus. The house lost 13 dinars.'), line('x92', 'Samir came home from Damascus. The house lost 8 dinars.')];
  const para = t => ({ id: 'p' + t.length, interlude: t });
  jump.events = ['In April 1326 a young scholar from Tangier landed at Alexandria and went on to Cairo. His name was Ibn Battuta. He would travel for about thirty years, and long afterward he told the story of what he saw.',
    'In the summer of 1326 Ibn Battuta crossed the desert toward Aydhab on the Red Sea. He found the crossing shut. The king of the Beja was at war with the sultan\'s soldiers and had sunk the ships. Ibn Battuta turned back to the Nile.',
    'In the summer of 1332 the sultan, al-Nasir Muhammad, set out for Mecca on the pilgrimage. He took his wife and his son Anuk with him. Every Muslim who can make the journey is asked to go once.'].map(para);
  return s;
})();
// MER-124: two parties out of Cairo on the engine's own plans, both on the first leg of their roads (a token on its stop's dot, where its
// caption lay across the stop's label), and the same two on their second legs (a token on Damascus and one on Qus). Played in Node.
states.two = (() => {
  // Two parties on their first legs. The seeded play's stock no longer lets the engine plan a second party from this desk (MER-139's selling
  // leaves it empty), so both are laid on their roads by hand from the expedition the ledger fixture was sent with on the engine's own plan.
  const g = structuredClone(states.second), model = structuredClone(states.book.expeditions[0]);
  g.expeditions = [['yusuf', 'cairo-damascus'], ['ali', 'cairo-aydhab']].map(([agent, route], i) => ({ ...structuredClone(model), id: `x-two-${i}`, agent, route, leg: 0, left: 1, status: 'out' }));
  return g;
})();
states.twoBack = (() => {
  const s = structuredClone(states.two);
  for (const x of s.expeditions) { x.leg = 1; x.left = 1; }
  return s;
})();
// MER-137: trips laid on the roads by hand (a leg, and the seasons left on it) from the engine's own sent expedition, so a party can stand
// on any stop. A party at the start of a leg stands on that stop; parties on one stop are one token with a count.
const tripsOn = list => {
  const g = structuredClone(states.two), model = structuredClone(g.expeditions[0]);
  g.expeditions = list.map(([agent, route, leg, left], i) => ({ ...structuredClone(model), id: `x${i + 1}`, agent, route, leg, left, status: 'out' }));
  return g;
};
// what each map screen must show: how many tokens, and the stops whose labels a trip stands on
const MAP137 = {
  'map-one': { state: tripsOn([['yusuf', 'cairo-damascus', 0, 1]]), tokens: 1 },
  'map-three': { state: tripsOn([['yusuf', 'cairo-damascus', 0, 1], ['ali', 'cairo-quseir', 1, 1], ['samir', 'cairo-aydhab', 2, 1]]), tokens: 3 },
  'map-stack': { state: tripsOn([['yusuf', 'cairo-quseir', 1, 1], ['ali', 'cairo-aydhab', 1, 1], ['samir', 'cairo-jeddah', 1, 1]]), tokens: 1, stack: 3 },
  // Damascus, Aleppo, Famagusta, Qus, Quseir and Alexandria, the six stops the M4d play saw lose their names while a trip stood on them
  'map-names': { state: tripsOn([['yusuf', 'cairo-damascus', 1, 1], ['ali', 'cairo-aleppo', 2, 1], ['samir', 'cairo-famagusta', 2, 1], ['mariam', 'cairo-aydhab', 1, 1], ['yusuf', 'cairo-quseir', 2, 1], ['ali', 'cairo-alexandria', 1, 1]]),
    tokens: 6, names: ['damascus', 'aleppo', 'famagusta', 'qus', 'quseir', 'alexandria'] },
};
// MER-145: two parties a piece's width apart on different roads (a stack), and a careful agent a season out on a leg that takes him one season longer
// than the leg's own length (his token was drawn at Cairo, a038)
const { legSeasons } = await import(pathToFileURL(path.join(MER, 'engine', 'agents.js')).href);
const CAREFUL = (() => {
  const yusuf = content.agents.find(a => a.id === 'yusuf');
  for (const r of content.routes) if (legSeasons(yusuf, r.legs[0]) > r.legs[0].seasons && r.legs[0].seasons >= 2) return { route: r.id, left: legSeasons(yusuf, r.legs[0]) - 1, total: legSeasons(yusuf, r.legs[0]) };
  throw new Error('layout.mjs: no road where a careful agent rides a longer first leg');
})();
const MAP145 = {
  'map-close': { state: tripsOn([['yusuf', 'cairo-damascus', 0, 1], ['ali', 'cairo-quseir', 0, 2]]), tokens: 1, stack: 2 },
  // Qus and Quseir are 28 px apart at 1920 wide: a party standing on each is two groups (two stops) and one stack (a piece is wider than the gap)
  'map-near': { state: tripsOn([['yusuf', 'cairo-quseir', 1, 1], ['ali', 'cairo-quseir', 2, 1]]), tokens: 1, stack: 2 },
  'map-careful': { state: tripsOn([['yusuf', CAREFUL.route, 0, CAREFUL.left]]), tokens: 1, careful: true },
};
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
    lines: [{ label: 'Lost', text: 'The ship and what it carried.' },
      // routes.js lossLine, as the engine words it (MER-125): what the loss came to in dinars, then what the sheet had hoped
      { label: 'In dinars', text: 'The house lost about 200 dinars: the goods at Cairo\'s price and the money that was aboard. It had hoped to make 120 dinars.' }, { label: 'The house lost', text: '200 dinars' }], costs: [], trip: {}, entry: entry.id,
    ask: { title: fill(entry.title), body: fill(entry.body) },
    choices: entry.choices.map(c => ({ ...structuredClone(c), label: fill(c.label), ...(c.hint !== undefined ? { hint: fill(c.hint) } : {}) })) } }] };
  states.accounts = { ...base, desk: [{ id: 'p80-1', state: 'open', kind: 'accounts', ref: 'accounts', items: [
    { from: 'lend/yes', card: 'Hasan asks for a loan', choice: 'Lend him 50 dinars', changes: ['+60 dinars'], text: 'a' },
    { from: 'lend/yes', card: 'Hasan asks for a loan', choice: 'Lend him 50 dinars', changes: ["Hasan's trust +1"], text: 'b' },
    { from: 'gift/yes', card: 'A gift for the court', choice: 'Send the gift', changes: ['good name with court +1'], text: 'c' }] }] };
}

// MER-138: the book house with goods in the warehouse: copper Cairo buys, linen, and salt, which it does not (the refusal's case)
states.stocked = (() => { const s = structuredClone(states.book); s.stock = { copper: 100, linen: 4, salt: 2 }; return s; })();

// MER-84: the ending's pages after the recall was sent. Every expedition still out is called home, so the
// engine's own rolls decide who lives; the pages read the state this leaves.
// The seeded game reaches the plague with nobody out, so the recall page is also drawn from the last season
// replayed with four expeditions sent on the engine's plans: four rows with their two buttons each.
states.road = (() => {
  let s = fresh();
  for (let i = 0; i < 80 && !(s.phase === 'desk' && s.t === 23); i++) s = s.phase === 'interlude' ? eng.openSeason(s, content) : playSeason(s);
  s = playPapers(s);
  for (const stop of ['damascus', 'aydhab', 'alexandria', 'damascus']) { const plan = eng.suggestPlan(s, content, stop); if (plan) s = eng.outfit(s, content, plan); }
  // the seeded stock no longer lets the engine plan every party (MER-139's selling leaves it empty), so the rest are laid on their roads by hand
  const model = structuredClone(states.book.expeditions[0]);
  for (const [agent, route] of [['yusuf', 'cairo-damascus'], ['ali', 'cairo-aydhab'], ['samir', 'cairo-alexandria'], ['mariam', 'cairo-qus']]) {
    if (s.expeditions.length >= 4 || s.expeditions.some(x => x.agent === agent)) continue;
    s = structuredClone(s); s.agents[agent].hired = true;
    s.expeditions.push({ ...structuredClone(model), id: `x-road-${agent}`, agent, route, leg: 0, left: 1, status: 'out' });
  }
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
  // MER-132: the same two returns with the account unfolded, the paper at its tallest
  ...[['desk-return-open', 'ret'], ['desk-return2-open', 'ret2']].map(([name, st]) => ({ name,
    go: async (p, f) => {
      await load(p, '#desk', { state: states[st], large: f.large });
      await p.waitForSelector('#screen-desk .sheet-title');
      const id = states[st].desk.find(x => x.kind === 'return' && x.state === 'open').id;
      if (await p.$eval('.sheet', (e, i) => e.dataset.paper !== i, id)) { await p.$eval(`.edge[data-paper="${id}"]`, e => e.scrollIntoView({ block: 'center' })); await p.click(`.edge[data-paper="${id}"]`); }
      await p.waitForFunction(i => document.querySelector('.sheet')?.dataset.paper === i, {}, id);
      await p.$eval('.account summary', e => e.scrollIntoView({ block: 'center' }));
      await p.click('.account summary');
      await p.waitForSelector('.account[open] .accounts-table');
    } })),
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
  // MER-124: two parties on the map at once, at the start of their first legs and of their second
  ...[['map-two', 'two'], ['map-two-back', 'twoBack']].map(([name, st]) => ({ name,
    go: async (p, f) => {
      await load(p, '#map', { state: states[st], large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      // MER-137: two parties leaving Cairo at once are one token with a count; on their second legs they are two
      await p.waitForFunction(() => document.querySelectorAll('.token').length >= 1);
      await p.waitForFunction(() => document.querySelector('.stop-label'));
    } })),
  ...Object.entries(MAP137).map(([name, m]) => ({ name,
    go: async (p, f) => {
      await load(p, '#map', { state: m.state, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      await p.waitForFunction(() => document.querySelectorAll('.token').length >= 1);
      await p.waitForFunction(() => document.querySelector('.stop-label'));
    } })),
  ...Object.entries(MAP145).map(([name, m]) => ({ name,
    go: async (p, f) => {
      await load(p, '#map', { state: m.state, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
      await p.waitForFunction(n => document.querySelectorAll('.token').length >= n, {}, m.tokens);
      await p.waitForFunction(() => document.querySelector('.stop-label'));
    } })),
  // MER-145: the notebook, opened (its top is measured on every tab below)
  { name: 'notebook-tabs', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#desk', { state: states.book, large: f.large });
      await p.waitForSelector('#btn-menu');
      await openBook(p, 'notebook');
      await p.waitForFunction(() => document.getElementById('panel-notebook')?.open);
    } },
  // MER-137: the board with nothing opened, where the buttons under it once lay over the prices
  { name: 'map-board',
    go: async (p, f) => {
      await load(p, '#map', { state: states.second, large: f.large });
      await p.waitForSelector('#screen-map[data-ready]');
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
  { name: 'ledger-sell', modal: 'dialog[open]',
    go: async (p, f) => {
      await load(p, '#desk', { state: states.stocked, large: f.large });
      await p.waitForSelector('#btn-menu');
      if (await p.$eval('#btn-warehouse', e => e.checkVisibility())) await p.click('#btn-warehouse'); else await openBook(p, 'ledger');
      await p.waitForFunction(() => document.getElementById('panel-ledger')?.open);
      await p.waitForSelector('#sell-copper');
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
      // the element's own box clips its own text too (MER-132: a tab's title cut at the tab's width with an ellipsis was measured whole, over the picture beside it)
      for (let a = el; a && a !== document.body; a = a.parentElement) {
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
              // MER-132: the part of the choice a player can see, cut by every box that clips or scrolls (a choice scrolled out of the stack's box lies under the
              // bar's rectangle on paper and under nothing on screen)
              const rr = row.getBoundingClientRect(), lr = (e => { const q = e.getBoundingClientRect(), v = { left: q.left, right: q.right, top: q.top, bottom: q.bottom };
                for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) if (getComputedStyle(x).overflowY !== 'visible') { const c = x.getBoundingClientRect(); v.top = Math.max(v.top, c.top); v.bottom = Math.min(v.bottom, c.bottom); }
                if (v.bottom < v.top) v.bottom = v.top; return v; })(last);
              const bg = getComputedStyle(row).backgroundColor.match(/[\d.]+/g).map(Number);
              const covers = getComputedStyle(row).position === 'sticky' || getComputedStyle(row).position === 'fixed';
              return { covers, alpha: bg.length > 3 ? bg[3] : 1, overlap: lr.bottom - lr.top > 1 && lr.left < rr.right && lr.right > rr.left && lr.top < rr.bottom - 0.5 && lr.bottom > rr.top + 0.5, last: [Math.round(lr.top), Math.round(lr.bottom)], row: [Math.round(rr.top), Math.round(rr.bottom)] };
            });
            await page.evaluate(() => window.scrollTo(0, 0));
            ok(!got.missing, 'End the season or the last choice is not on the desk');
            ok(!got.covers || got.alpha === 1, `the bar that sticks over the papers is ${got.alpha} opaque, so the papers under it show through`);
            ok(!got.overlap, `the bar (${got.row}) covers the last choice (${got.last})`);
          });
        }
        // MER-132 (DESIGN 4.2): A18 (title.webp, never title-wide, which is for sharing) lies behind the panel over the whole frame at every frame, laid
        // from the top left so the plain sky the manifest names (`safe`, the upper left 34 percent each way) is the part that always shows, and the
        // title sits in it: the headline's box starts inside that corner and its top and left edges are the screen's own
        if (/^title/.test(screen.name)) {
          await test(`${tag}: A18 lies behind the panel over the whole frame, with the title in its plain upper left`, async () => {
            const got = await page.evaluate(async safe => {
              const img = document.querySelector('.title-still'), h1 = document.querySelector('.title-name'), menu = document.querySelector('.title-menu');
              if (!img) return { missing: true };
              await img.decode().catch(() => {});
              const r = img.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = innerHeight, cs = getComputedStyle(img), t = h1.getBoundingClientRect();
              const k = Math.max(vw / 1920, vh / 1080);   // cover, from the top left corner
              const zOf = e => { const z = getComputedStyle(e).zIndex; return z === 'auto' ? 0 : Number(z); };
              return { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth === 1920, fit: cs.objectFit, pos: cs.objectPosition, z: zOf(img), menuZ: zOf(menu),
                covers: r.left <= 0.5 && r.top <= 0.5 && r.right >= vw - 0.5 && r.bottom >= vh - 0.5, shown: img.checkVisibility(),
                box: { w: Math.round(safe[2] * 1920 * k), h: Math.round(safe[3] * 1080 * k) }, title: { left: Math.round(t.left), top: Math.round(t.top), right: Math.round(t.right), bottom: Math.round(t.bottom) } };
            }, titleSafe);
            ok(!got.missing, 'the title screen has no .title-still');
            ok(/assets\/art\/title\.webp$/.test(got.src), `the picture is ${got.src}, not title.webp`);
            ok(got.loaded && got.shown, `the picture loaded ${got.loaded}, shown ${got.shown}`);
            ok(got.covers, 'the picture does not cover the frame');
            // MER-138: laid from the top left everywhere but an upright phone, where the left edge is the blurred foreground (the sharpness case below)
            const upright = frame.height > frame.width && frame.mobile;
            ok(got.fit === 'cover' && (upright ? /^38% 0(px|%)$/ : /^0(px|%) 0(px|%)$/).test(got.pos), `laid from ${upright ? '38 percent across' : 'the top left'}, covering: ${got.fit} ${got.pos}`);
            ok(got.z < got.menuZ || got.z < 0, `the picture (z ${got.z}) is not behind the panel (z ${got.menuZ})`);
            ok(got.title.left >= 0 && got.title.top >= 0 && got.title.left < got.box.w && got.title.top < got.box.h, `the headline starts at ${got.title.left},${got.title.top}, outside the plain corner of ${got.box.w} x ${got.box.h}`);
            ok(got.title.right <= got.box.w + 1 && got.title.bottom <= got.box.h + 1, `the headline (${JSON.stringify(got.title)}) runs out of the plain corner of ${got.box.w} x ${got.box.h}`);
          });
        }
        // MER-132 (play a033, a082, a029, c011): on a return paper the last choice is never behind End the season ("Hold the pepper" at y=1055 under
        // the bar at 991 to 1058), the other papers' tabs stay in view while "N papers left" shows, and the End bar never cuts a choice, with the
        // account folded and unfolded, at every frame. A box is measured by what a player can see of it: cut by every ancestor that clips or scrolls.
        if (/^desk-return2?(-open)?$/.test(screen.name)) {
          await test(`${tag}: no choice of the return is behind End the season, as it opens or when scrolled to`, async () => {
            // "as it opens" is the page as the desk leaves it when the return is the paper raised on arrival: on the upright phone the desk scrolls the
            // page until the last choice is clear of End (desk.js revealOnPage, MER-142). The harness raised it by pressing its tab after scrolling to
            // it, which puts the headline under the bar by another rule, so the two plain screens are loaded again with the return first on the desk
            // (the account-open screens keep the page they have, taken to its top as before).
            const own = { 'desk-return': states.ret, 'desk-return2': states.ret2 }[screen.name];
            if (own) {
              const lead = own.desk.find(x => x.kind === 'return' && x.state === 'open'), first = structuredClone(own);
              first.desk = [lead, ...own.desk.filter(x => x.id !== lead.id)].map(x => structuredClone(x));
              await load(page, '#desk', { state: first, large: frame.large });
              await page.waitForSelector('#screen-desk .sheet-title');
              await settle(page);
              eq(await page.$eval('.sheet', e => e.dataset.paper), lead.id, 'setup: the return is the paper raised on arrival');
            } else await page.evaluate(() => window.scrollTo(0, 0));
            const bad = await page.evaluate(() => {
              const saved = [document.scrollingElement, ...document.querySelectorAll('.sheet-box, .stack-papers, .edges, .sheet')].map(e => [e, e.scrollTop]);
              const seen = e => { const q = e.getBoundingClientRect(); const v = { top: q.top, bottom: q.bottom, left: q.left, right: q.right };
                for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { if (getComputedStyle(x).overflowY !== 'visible') { const c = x.getBoundingClientRect(); v.top = Math.max(v.top, c.top); v.bottom = Math.min(v.bottom, c.bottom); } }
                return v; };
              // boxes that only touch, or overlap by a hair, are not cut
              const hit = (a, b) => a.left < b.right - 1.5 && a.right > b.left + 1.5 && a.top < b.bottom - 1.5 && a.bottom > b.top + 1.5;
              const row = document.querySelector('.end-row'), choices = [...document.querySelectorAll('.sheet .choices .choice')], title = document.querySelector('.sheet-title');
              if (!row || !row.checkVisibility() || choices.length < 2) return ['the return has no End the season bar or fewer than two choices'];
              const tabs = document.querySelector('.edges'), stuck = tabs && getComputedStyle(tabs).position === 'sticky' && tabs.checkVisibility() ? tabs : null, out = [];
              // where the headline and the last choice cannot both be on screen above the bar, the headline wins (MER-122) and a choice below the fold is not cut, only below it
              const topBar = document.querySelector('.topbar').getBoundingClientRect().bottom, bar = row.getBoundingClientRect();
              const fits = choices.at(-1).getBoundingClientRect().bottom - title.getBoundingClientRect().top <= bar.top - topBar - 8 && getComputedStyle(row).position !== 'absolute';
              const where = (how, i, c) => {
                const v = seen(c), r = c.getBoundingClientRect(), e = row.getBoundingClientRect();
                const name = `${how}: choice ${i + 1} (${c.textContent.trim().slice(0, 18)}) at ${Math.round(r.top)} to ${Math.round(r.bottom)}`;
                if (v.bottom - v.top > 1 && hit(v, e) && (how !== 'as it opens' || fits)) out.push(`${name} is behind End the season at ${Math.round(e.top)} to ${Math.round(e.bottom)}`);
                if (how !== 'as it opens' && (v.bottom - v.top < r.height - 1 || hit(r, e))) out.push(`${name} is cut off or covered once scrolled to (End at ${Math.round(e.top)} to ${Math.round(e.bottom)}, box shows ${Math.round(v.top)} to ${Math.round(v.bottom)})`);
                if (how !== 'as it opens' && stuck && hit(r, stuck.getBoundingClientRect())) out.push(`${name} lies under the tabs`);
              };
              choices.forEach((c, i) => where('as it opens', i, c));
              choices.forEach((c, i) => { c.scrollIntoView({ block: 'nearest' }); where('scrolled to', i, c); });
              for (const [e, t] of saved) e.scrollTop = t;
              return out;
            });
            await page.evaluate(() => window.scrollTo(0, 0));
            ok(!bad.length, brief(bad));
          });
          // where the paper has its own scroll box (a laptop or the board) the tabs lie above it, in the stack: each is whole in it, under nothing, and a press
          // at its centre lands on it. The phones lay the tabs in the page's flow under the paper (upright) or in a column of their own (on its side).
          await test(`${tag}: the other papers' tabs stay in view while the papers-left tag shows`, async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            const got = await page.evaluate(() => {
              const tabs = [...document.querySelectorAll('.edge')], tag = document.querySelector('.stack-count'), box = document.querySelector('.stack-papers'), strip = document.querySelector('.edges');
              if (!tag || !/papers? left/.test(tag.textContent) || !tabs.length) return { missing: true };
              if (getComputedStyle(document.querySelector('.sheet-box')).overflowY !== 'auto') return { flow: true };   // the phones: the page or a column scrolls, and the tabs lie in its flow (MER-138: the paper scrolls in .sheet-box, and the tabs lie above it, in the stack)
              const bar = document.querySelector('.topbar').getBoundingClientRect(), b = box.getBoundingClientRect(), out = [];
              for (const t of tabs) {
                const r = t.getBoundingClientRect(), name = `tab "${t.textContent.trim().slice(0, 20)}" at ${Math.round(r.top)} to ${Math.round(r.bottom)}`;
                if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push(`${name} is out of the stack, which shows ${Math.round(b.top)} to ${Math.round(b.bottom)}`);
                if (r.top < bar.bottom - 0.5) out.push(`${name} is under the top bar`);
                const on = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                if (!on || !(t === on || t.contains(on))) out.push(`${name} is covered by ${on ? on.id || on.className || on.tagName : 'nothing'}`);
              }
              return { out };
            });
            ok(!got.missing, 'the return has no papers-left tag or no other paper to tab');
            if (!got.flow) ok(!got.out.length, brief(got.out));
          });
        }
        if (screen.name === 'outfit-second-carry') {
          // elementFromPoint at the link's centre is the link, wherever the scroll puts it by a press, a focus or a scroll-into-view; then a real pointer press opens the section
          await test(`${tag}: #change-back is clear of the Send bar and a pointer press on it opens the bring-back section`, async () => {
            const got = await page.evaluate(() => {
              const dlg = document.querySelector('dialog[open]'), link = document.getElementById('change-back'), sc = dlg.querySelector('.outfit-body');   // MER-132: the sheet scrolls in .outfit-body, the bar is under it
              if (!link || !dlg.querySelector('.send-row') || !sc) return { missing: true };
              const probe = how => {
                const r = link.getBoundingClientRect(), d = dlg.getBoundingClientRect(), y = r.top + r.height / 2;
                if (y < d.top || y > d.bottom) return null;   // scrolled out of the dialog: nothing covers it, nothing can press it
                const e = document.elementFromPoint(r.left + r.width / 2, y);
                return e && link.contains(e) ? null : `${how}: the point at ${Math.round(y)} is ${e ? (e.id || e.className || e.tagName) : 'nothing'}, the bar is ${Math.round(dlg.querySelector('.send-row').getBoundingClientRect().top)} down`;
              };
              const bad = [];
              const run = (how, f) => { f(); const m = probe(how); if (m) bad.push(m); };
              run('as the carry press left it', () => {});
              run('at the top', () => { sc.scrollTop = 0; });
              run('scrolled into view from the top', () => { sc.scrollTop = 0; link.scrollIntoView({ block: 'nearest' }); });
              run('scrolled into view from the foot', () => { sc.scrollTop = sc.scrollHeight; link.scrollIntoView({ block: 'nearest' }); });
              run('focused from the top', () => { sc.scrollTop = 0; link.focus(); });
              return { bad };
            });
            ok(!got.missing, 'the link or the Send bar is not on the sheet');
            ok(!got.bad.length, got.bad.join('; '));
            await page.evaluate(() => { document.querySelector('dialog[open] .outfit-body').scrollTop = 0; });
            await page.click('#change-back');
            await page.waitForSelector('#back-nothing', { timeout: 3000 });
          });
        }
        // MER-124 (play c014, c041, c003, c005): what the phone's bars did to the controls under them
        if (screen.name === 'outfit-second-open') {
          // every control on the sheet, scrolled into view the two ways a player gets there (a scroll to it, a Tab or a tap that focuses it),
          // is clear of the Send bar: it sat on a stepper at y=560 and a tap there landed on Send (c014). MER-132: the bar is under the scrolling
          // part, not over it (the sheet scrolls in .outfit-body), so no control can be scrolled to a place the bar covers: the scroller ends at
          // the bar's top, and a point inside the scroller is never the bar
          await test(`${tag}: no stepper, button or link sits under the Send bar once scrolled into view, and the scrolling part ends where the bar begins`, async () => {
            const bad = await page.evaluate(() => {
              const dlg = document.querySelector('dialog[open]'), bar = dlg.querySelector('.send-row'), sc = dlg.querySelector('.outfit-body');
              const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
              const out = [];
              if (!sc) return ['the sheet has no .outfit-body: it still scrolls under its own Send bar'];
              if (sc.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 0.5) out.push(`the scrolling part ends at ${Math.round(sc.getBoundingClientRect().bottom)}, under the bar at ${Math.round(bar.getBoundingClientRect().top)}`);
              if (bar.closest('.outfit-body')) out.push('the Send bar is inside the scrolling part');
              const els = [...dlg.querySelectorAll('.stepper, .step-btn, button, input, summary, a[href], [role=checkbox], [role=radio]')].filter(e => !bar.contains(e) && e.checkVisibility());
              for (const el of els) {
                for (const how of ['scrollIntoView', 'focus']) {
                  sc.scrollTop = how === 'focus' ? sc.scrollHeight : 0;
                  if (how === 'scrollIntoView') el.scrollIntoView({ block: 'nearest' }); else el.focus();
                  const r = el.getBoundingClientRect(), b = bar.getBoundingClientRect();
                  if (r.height < sc.clientHeight && hit(r, b)) out.push(`${how} leaves ${el.id || el.className || el.tagName} at ${Math.round(r.top)} to ${Math.round(r.bottom)} under the bar at ${Math.round(b.top)}`);
                  const e = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, sc.getBoundingClientRect().bottom - 1));
                  if (r.top < sc.getBoundingClientRect().bottom - 1 && r.bottom > sc.getBoundingClientRect().top + 1 && e && bar.contains(e)) out.push(`${how}: a press at ${el.id || el.className} lands on the Send bar (${e.id || e.className})`);
                }
              }
              sc.scrollTop = 0;
              return out;
            });
            ok(!bad.length, brief(bad));
          });
          // the upright phones: the bar is at most 18 percent of the frame (it was 23 and 29, play c014 saw 29)
          if (frame.mobile && frame.height > frame.width && !frame.large) {
            await test(`${tag}: the Send bar is at most 18 percent of the frame`, async () => {
              const got = await page.evaluate(() => ({ bar: Math.round(document.querySelector('dialog[open] .send-row').getBoundingClientRect().height), ih: innerHeight }));
              ok(got.bar <= got.ih * 0.18, `the Send bar is ${got.bar} px of ${got.ih}: ${Math.round(got.bar / got.ih * 1000) / 10} percent`);
            });
          }
        }
        // an account table never breaks a number or a two-word label across two lines at a phone's width, and a sentence only between words
        if (screen.name === 'desk-return2' || screen.name === 'desk-loss') {
          await test(`${tag}: no account cell wraps a number, its unit or a short label onto two lines`, async () => {
            const bad = await page.evaluate(async () => {
              const out = [];
              // a return's account is folded (MER-122: the desk never opens it by itself); the player opens it, and so does this case
              const folds = [...document.querySelectorAll('details')].filter(d => !d.open);
              for (const d of folds) d.open = true;
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const cells = [...document.querySelectorAll('.accounts-table th, .accounts-table td')].filter(c => c.checkVisibility());
              if (!cells.length) return [`no account table is visible on the paper (${document.querySelectorAll('.accounts-table').length} in the page; details open: ${[...document.querySelectorAll('details')].map(d => d.open)})`];
              for (const c of cells) {
                const text = c.textContent.trim().replace(/\s+/g, ' '), words = text.split(' ');
                // the line each word lies on: a Range over the word, read by its top
                const tn = [...c.childNodes].flatMap(n => (n.nodeType === 3 ? [n] : [...n.childNodes].filter(x => x.nodeType === 3)));
                const tops = [];
                for (const n of tn) for (const m of n.textContent.matchAll(/\S+/g)) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const b = r.getClientRects()[0]; if (b) tops.push({ w: m[0], top: Math.round(b.top) }); }
                const lines = new Set(tops.map(t => t.top)).size;
                const short = c.matches('th') ? words.length <= 2 : /^[+−-]?\d[\d,]*( \S+)?$/.test(text);
                if (short && lines > 1) out.push(`"${text.slice(0, 30)}" is on ${lines} lines`);
                // a unit never starts a line: "dinars" under its number
                for (let i = 1; i < tops.length; i++) if (/^(dinars?|loads?)[.,]?$/.test(tops[i].w) && /\d/.test(tops[i - 1].w) && tops[i].top !== tops[i - 1].top) out.push(`"${tops[i - 1].w} ${tops[i].w}" is split over two lines`);
              }
              for (const d of folds) d.open = false;
              return out;
            });
            ok(!bad.length, brief(bad));
          });
        }
        if (screen.name === 'desk-loss') {
          // MER-125: the lost paper's own line in dinars, under its label, in the engine's words
          await test(`${tag}: the lost paper has its 'In dinars' row`, async () => {
            const row = await page.evaluate(() => { const th = [...document.querySelectorAll('.accounts-table th')].find(t => t.textContent.trim() === 'In dinars'); return th ? th.nextElementSibling?.textContent.replace(/\s+/g, ' ').trim() ?? '' : null; });
            ok(row !== null && /^The house lost about \d+ dinars/.test(row), `the 'In dinars' row says: ${row}`);
          });
        }
        if (screen.name === 'desk-papers' || screen.name === 'desk-return') {
          // End the season never covers the last choice, nor the second stacked paper's tab, once either is scrolled into view (c003, c005)
          await test(`${tag}: the last choice and the second paper's tab clear End the season once scrolled into view`, async () => {
            const bad = await page.evaluate(() => {
              const row = document.querySelector('.end-row');
              if (!row || !row.checkVisibility()) return ['End the season is not on the desk'];
              const out = [];
              const saved = [...document.querySelectorAll('.sheet-box, .stack-papers, .edges, .sheet')].map(e => [e, e.scrollTop]);
              const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
              const targets = { 'the last choice': document.querySelector('.sheet .choices .choice:last-of-type'), "the second paper's tab": document.querySelectorAll('.edges .edge')[1] };
              for (const [name, el] of Object.entries(targets)) {
                if (!el) { out.push(`${name} is not on the desk`); continue; }
                el.scrollIntoView({ block: 'nearest' });
                const r = el.getBoundingClientRect(), b = row.getBoundingClientRect();
                if (hit(r, b)) out.push(`${name} lies at ${Math.round(r.top)} to ${Math.round(r.bottom)} under End the season at ${Math.round(b.top)} to ${Math.round(b.bottom)}`);
              }
              for (const [e, t] of saved) e.scrollTop = t;
              scrollTo(0, 0);
              return out;
            });
            ok(!bad.length, brief(bad));
          });
        }
        // MER-124 (play c003): no ~100 px of bare ground between the money line and "papers left" on the upright phones. A placeholder
        // still hides its band, so the stack starts at the measured bar; a final picture shows its band, which is used, not empty. The
        // class is put on the still here, so the case holds whichever pictures the manifest calls final.
        if ((screen.name === 'desk-letter' || screen.name === 'desk-papers') && frame.mobile && frame.height > frame.width && !frame.large) {
          await test(`${tag}: nothing but a few pixels lies between the top bar and "papers left" with a placeholder still`, async () => {
            const got = await page.evaluate(async () => {
              const still = document.querySelector('.desk-still');
              const had = still.classList.contains('placeholder');
              still.classList.add('placeholder');
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const bar = document.querySelector('.topbar').getBoundingClientRect(), count = document.querySelector('.stack-count').getBoundingClientRect();
              const gap = Math.round(count.top - bar.bottom);
              if (!had) still.classList.remove('placeholder');
              return { gap, bar: Math.round(bar.bottom), count: Math.round(count.top) };
            });
            ok(got.gap >= 0 && got.gap <= 24, `the bar ends at ${got.bar} and "papers left" starts at ${got.count}: ${got.gap} px between`);
          });
        }
        // MER-125: the page between the acts; its one button sticks at the foot of the paper, and scrolled to the end no line of the
        // history lies under it (it sat over the text, a090)
        if (screen.name === 'between-acts-long') {
          await test(`${tag}: scrolled to the end, no line of the history lies under Open the house`, async () => {
            const bad = await page.evaluate(async () => {
              const btn = document.querySelector('#btn-open-house'), out = [], saved = [];
              // every box that scrolls round the button, then the page, each to its end
              for (let a = btn.parentElement; a && a !== document.body; a = a.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight + 1) { saved.push([a, a.scrollTop]); a.scrollTop = a.scrollHeight; }
              scrollTo(0, document.documentElement.scrollHeight);
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              const b = btn.getBoundingClientRect();
              for (const el of document.querySelectorAll('.kind-phase p, .kind-phase li, .kind-phase h2, .kind-phase h3')) {
                if (btn.contains(el) || el.contains(btn) || !el.checkVisibility()) continue;
                const r = el.getBoundingClientRect();
                if (r.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5) out.push(`"${el.textContent.trim().slice(0, 30)}" at ${Math.round(r.top)} to ${Math.round(r.bottom)} against the button at ${Math.round(b.top)} to ${Math.round(b.bottom)}`);
              }
              for (const [a, t] of saved) a.scrollTop = t;
              scrollTo(0, 0);
              return out;
            });
            ok(!bad.length, brief(bad));
          });
        }
        // MER-124 (play A and B, 15): on the map table no two tokens, and no token and a stop's label, ever overlap; every token is
        // whole inside the picture; Cairo's label (or the cluster label that holds it) is still on the map
        if (screen.name === 'map-two' || screen.name === 'map-two-back') {
          await test(`${tag}: two tokens and the stop labels never overlap, and every token is whole inside the picture`, async () => {
            await page.evaluate(() => new Promise(r => setTimeout(r, 300)));   // a token slides to its place over the token-move time
            const got = await page.evaluate(() => {
              const box = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
              // MER-131: a token's anchor is the centre of its piece and the element itself has no size, so the piece and its caption are measured
              const tok = e => e.closest('.token');
              const named = e => (tok(e) ? 'token ' : 'label ') + (e.textContent.trim().slice(0, 26) || e.className);
              const items = [...document.querySelectorAll('.stop-label:not([hidden]), .token-piece, .token-label')].filter(e => e.checkVisibility()).map(e => ({ n: named(e), r: box(e), token: !!tok(e), own: tok(e), piece: e.classList.contains('token-piece'), home: !!e.dataset.keep }));
              const hits = [];
              for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
                const a = items[i].r, b = items[j].r;
                if (items[i].own && items[i].own === items[j].own) continue;   // a token's piece and its own caption
                // MER-137: a token's place is the trip's, so a label beside a crowded stop may still brush the edge of a piece; it is drawn above it and
                // its name reads. A label over a caption, or two tokens over each other, still fail.
                if ((items[i].piece && !items[j].token) || (items[j].piece && !items[i].token)) continue;
                if (items[i].home || items[j].home) continue;   // MER-131: Cairo's label is drawn over a token's edge when two parties leave it on roads too short to clear it
                // two pieces on roads too short to part them may share edges (MER-131: a token never leaves its road), never their middles
                const core = (r, p) => { const k = p ? (r.right - r.left) / 4 : 0; return { left: r.left + k, right: r.right - k, top: r.top + k, bottom: r.bottom - k }; };
                const pp = items[i].piece && items[j].piece;
                const [a2, b2] = [core(a, pp), core(b, pp)];
                if ((items[i].token || items[j].token) && a2.left < b2.right - 0.5 && a2.right > b2.left + 0.5 && a2.top < b2.bottom - 0.5 && a2.bottom > b2.top + 0.5) hits.push(`${items[i].n} over ${items[j].n}`);
              }
              const fr = box(document.querySelector('.map-frame')), board = document.querySelector('#board').getBoundingClientRect();
              const out = items.filter(x => x.token && (x.r.left < fr.left - 0.5 || x.r.right > fr.right + 0.5 || x.r.top < fr.top - 0.5 || x.r.bottom > fr.bottom + 0.5)).map(x => x.n);
              const homeLabel = [...document.querySelectorAll('.stop-label')].find(l => l.dataset.stop === 'cairo' || (l.dataset.cluster && /delta/i.test(l.dataset.cluster)));
              return { tokens: new Set(items.filter(x => x.token).map(x => x.own)).size, hits, out, home: !!homeLabel && !homeLabel.hidden, board: board.width > 0 };
            });
            ok(got.tokens >= 1, `${got.tokens} tokens are drawn`);
            ok(!got.hits.length, brief(got.hits));
            ok(!got.out.length, `a token is not whole inside the picture: ${got.out}`);
            ok(got.home, "Cairo's label (or the Delta cluster's) is hidden");
          });
        }
        // ---- MER-137: the map tells who is where. Every expedition is told apart by name at the frames that show captions, no stop loses its
        // name to a token, and on a phone Cairo has a label and each label sits by its own dot.
        const m137 = MAP137[screen.name], captioned = ['board', 'laptop', 'laptop-small'].includes(frame.name), phone = frame.mobile;
        if (m137 && captioned) {
          await test(`${tag}: every token has its caption on screen, naming each agent and the season, clear of the board`, async () => {
            await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
            const got = await page.evaluate(() => {
              const box = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
              const fr = box(document.querySelector('.map-frame')), board = box(document.querySelector('#board'));
              return [...document.querySelectorAll('.token')].map(t => {
                const l = t.querySelector('.token-label'), r = box(l);
                return { ids: t.dataset.expedition, count: Number(t.dataset.count), shown: l.checkVisibility(), text: l.textContent, spoken: t.getAttribute('aria-label'),
                  whole: r.left >= fr.left - 0.5 && r.right <= fr.right + 0.5 && r.top >= fr.top - 0.5 && r.bottom <= fr.bottom + 0.5,
                  onBoard: r.left < board.right && r.right > board.left && r.top < board.bottom && r.bottom > board.top };
              });
            });
            // MER-145: parties a piece's width apart are one token, and that distance is in px, so how many tokens a frame draws depends on the frame: at most one
            // for each place a party stands, at least one, and every party in exactly one of them
            ok(got.length >= 1 && got.length <= m137.tokens, `${got.length} tokens for ${m137.tokens} places`);
            eq(got.reduce((n, t) => n + t.count, 0), m137.state.expeditions.length, 'every party is in one token');
            for (const t of got) {
              ok(t.shown, `the caption of ${t.ids} is not shown: ${t.text}`);
              ok(t.whole, `the caption of ${t.ids} is not whole inside the picture`);
              ok(!t.onBoard, `the caption of ${t.ids} lies under the price board`);
              const names = t.spoken.match(/[A-Z][a-z]+, home about [A-Z][a-z]+ \d+/g) ?? [];
              eq(names.length, t.count, `${t.ids} is named once for each agent in "${t.spoken}"`);
              for (const n of names) ok(t.text.includes(n), `the caption "${t.text}" lacks "${n}"`);
            }
            if (m137.stack) ok(got.some(t => t.count === m137.stack), `no token stacks ${m137.stack} parties`);
          });
        }
        if (m137?.names && captioned) {
          await test(`${tag}: no stop a trip stands on loses its name, and no token lies over it`, async () => {
            await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
            const got = await page.evaluate(names => {
              // pointer events on, so elementFromPoint answers with what is drawn on top at a point
              const st = document.createElement('style'); st.textContent = '.stop-label,.token,.token *{pointer-events:auto!important}'; document.head.append(st);
              const out = names.map(id => {
                const l = document.querySelector(`.stop-label[data-stop="${id}"]`);
                if (!l || l.hidden || !l.checkVisibility()) return { id, hidden: true };
                const r = l.getBoundingClientRect(), under = [];
                for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.3, 0.7]) {
                  const e = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
                  if (e && e !== l && !l.contains(e)) under.push(e.className || e.tagName);
                }
                return { id, hidden: false, under };
              });
              st.remove();
              return out;
            }, m137.names);
            eq(got.filter(g => g.hidden).map(g => g.id), [], 'a stop with a trip on it has no label');
            eq(got.filter(g => g.under?.length).map(g => `${g.id}: ${g.under}`), [], 'something is drawn over a stop label');
          });
        }
        if (m137 && phone) {
          await test(`${tag}: Cairo has a label, and every label stands by its own dot`, async () => {
            const got = await page.evaluate(() => {
              const visible = [...document.querySelectorAll('.stop-label')].filter(l => !l.hidden && l.checkVisibility());
              const away = visible.map(l => {
                const d = document.querySelector(l.dataset.stop ? `.dot[data-stop="${l.dataset.stop}"]` : `.dot[data-cluster="${l.dataset.cluster}"]`);
                const a = l.getBoundingClientRect(), b = d.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
                return [l.textContent, Math.hypot(Math.max(a.left - cx, 0, cx - a.right), Math.max(a.top - cy, 0, cy - a.bottom))];
              });
              return { cairo: visible.some(l => /Cairo/.test(l.textContent)), far: away.filter(([, d]) => d > 44).map(([t, d]) => `${t} ${Math.round(d)} px`) };
            });
            ok(got.cairo, "no label says Cairo (on the house's own stop, or on the group that holds it)");
            eq(got.far, [], 'a label stands more than 44 px from its dot');
          });
        }
        if (screen.name === 'map-board') {
          // b008 and c006b: "Every price in ..." on a laptop and "Prices and best trades" on a phone lay half under the buttons at the foot of the
          // board, and a focus left the control's foot cut. The buttons are outside the scroll now: the control is clear of them at rest, and
          // once focused it is whole inside the part of the board that scrolls.
          await test(`${tag}: the price controls are never under the buttons at the foot of the board, at rest or focused`, async () => {
            const got = await page.evaluate(() => {
              const body = document.querySelector('#board-body'), bar = document.querySelector('.board-actions');
              const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
              const read = id => {
                const e = document.getElementById(id);
                if (!e.checkVisibility()) return null;
                const at = e.getBoundingClientRect(), v = body.getBoundingClientRect();
                // what lies on top at the middle of the part of the control that shows (the scroll box clips the rest)
                const seen = { left: at.left, right: at.right, top: Math.max(at.top, v.top), bottom: Math.min(at.bottom, v.bottom) };
                const top = seen.bottom > seen.top ? document.elementFromPoint((seen.left + seen.right) / 2, (seen.top + seen.bottom) / 2) : null;
                return { id, covered: !!top && !(top === e || e.contains(top)), scrolls: body.scrollHeight > body.clientHeight + 1, cut: at.bottom > v.bottom + 0.5 || at.top < v.top - 0.5 };
              };
              const ids = ['btn-prices', 'btn-all-prices'].filter(id => document.getElementById(id)?.checkVisibility());
              const rest = ids.map(read);
              const focused = ids.map(id => { document.getElementById(id).focus(); return read(id); });
              return { ids, rest, focused, barBelow: bar.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 0.5 };
            });
            ok(got.ids.length, 'neither price control is on the board');
            ok(got.barBelow, 'the buttons lie over the scrolling part of the board');
            for (const r of got.rest) { ok(!r.covered, `${r.id} lies under the buttons at rest`); ok(!r.cut || r.scrolls, `${r.id} is cut at the foot of a board that does not scroll`); }
            for (const r of got.focused) { ok(!r.covered, `${r.id} lies under the buttons once focused`); ok(!r.cut, `${r.id} is cut at the edge of the board once focused`); }
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
        // ---- MER-138
        const TAB_SCREENS = new Set(['desk-papers', 'desk-return', 'desk-return2', 'desk-return-open', 'desk-return2-open', 'desk-loss', 'desk-accounts']);
        if (TAB_SCREENS.has(screen.name) && !frame.large) {
          // a052, b011, b017: the row of the other papers' tabs covered the headline of a scrolled paper, and the headline a focus had just
          // brought up. Wherever the paper scrolls (its own box on a laptop or the board, the page on a phone) no part of the headline, the
          // sender line or the head lies under a tab, at rest and at the top, the middle and the foot of the scroll.
          await test(`${tag}: no tab covers the headline, the sender line or the head, at any scroll`, async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            const got = await page.evaluate(() => {
              const strip = document.querySelector('.edges');
              if (!strip || !strip.checkVisibility()) return { none: true };
              const box = ['.sheet-box', '.stack-papers'].map(q => document.querySelector(q)).find(e => e && getComputedStyle(e).overflowY === 'auto') ?? null;
              const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
              const seen = e => { const r = e.getBoundingClientRect(); const v = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowY !== 'visible') { const c = a.getBoundingClientRect(); v.top = Math.max(v.top, c.top); v.bottom = Math.min(v.bottom, c.bottom); } }
                return v; };
              const saved = box?.scrollTop ?? 0, out = [], span = box ? box.scrollHeight - box.clientHeight : 0;
              for (const f of box ? [0, 0.5, 1] : [0]) {
                if (box) box.scrollTop = Math.round(span * f);
                for (const q of ['.sheet-title', '.sheet-head .sender', '.sheet-head']) {
                  const e = document.querySelector(q); if (!e) continue;
                  const v = seen(e);
                  if (v.bottom - v.top > 1 && hit(v, strip.getBoundingClientRect())) out.push(`${q} shows ${Math.round(v.top)} to ${Math.round(v.bottom)} under the tabs at ${Math.round(strip.getBoundingClientRect().top)} to ${Math.round(strip.getBoundingClientRect().bottom)} (scrolled to ${Math.round(f * 100)} percent)`);
                }
              }
              if (box) box.scrollTop = saved;
              return { out };
            });
            if (!got.none) ok(!got.out.length, brief(got.out));
          });
          // the headline a raised paper's focus lands on is whole in view when the paper opens, in the box it scrolls in, under the top bar and the tabs
          if (!/-open$/.test(screen.name)) await test(`${tag}: the focused headline is whole in view when the paper opens`, async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            const got = await page.evaluate(wholeInView, '.sheet-title');
            ok(!got, got ?? '');
          });
        }
        if (screen.name === 'desk-papers' && !frame.large) {
          // b011, b017: with four tabs each shrank to "A..." or "Acc...". Each tab shows its first twelve characters at least (all of a shorter title).
          await test(`${tag}: with four or more tabs, each shows enough of its title to tell the papers apart`, async () => {
            const got = await page.evaluate(() => {
              const tabs = [...document.querySelectorAll('.edge')];
              const tilted = tabs.map(t => [t, t.style.transform]); tabs.forEach(t => { t.style.transform = 'none'; });   // a tab is tilted a degree or two: its characters' boxes are measured upright
              const visibleChars = span => {
                const box = span.getBoundingClientRect(), walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
                let n = 0, total = 0;
                for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.length; i++) {
                  const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1);
                  const q = r.getBoundingClientRect(); total++;
                  const cx = (q.left + q.right) / 2, cy = (q.top + q.bottom) / 2;   // a character is shown when its middle is inside the box: its own box is taller than the line
                  if (q.width > 0 && cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) n++;
                }
                return { n, total, text: span.textContent };
              };
              const shown = tabs.map(t => visibleChars(t.querySelector(':scope > span:not(.seal)')));
              for (const [t, v] of tilted) t.style.transform = v;
              return { count: tabs.length, shown };
            });
            ok(got.count >= 4, `the setup has ${got.count} tabs, not four`);
            const bad = got.shown.filter(t => t.n < Math.min(t.total, 12)).map(t => `"${t.text}" shows ${t.n} of ${t.total} characters`);
            ok(!bad.length, brief(bad));
          });
        }
        if (screen.name === 'outfit-second-open') {
          // c005: the minus and plus glyphs hugged the left edge of their 44 px cells
          await test(`${tag}: the minus and plus glyphs sit in the middle of their cells`, async () => {
            const got = await page.evaluate(() => [...document.querySelectorAll('.step-btn')].filter(b => b.checkVisibility()).map(b => {
              const r = b.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(b);
              const g = range.getBoundingClientRect();
              return { id: b.id, off: Math.round((((g.left + g.right) / 2) - ((r.left + r.right) / 2)) * 10) / 10, v: Math.round((((g.top + g.bottom) / 2) - ((r.top + r.bottom) / 2)) * 10) / 10 };
            }));
            ok(got.length >= 2, 'the sheet shows no stepper');
            const bad = got.filter(b => Math.abs(b.off) > 1.5 || Math.abs(b.v) > 3).map(b => `${b.id}: ${b.off} px across, ${b.v} px down`);
            ok(!bad.length, brief(bad));
          });
        }
        // ---- MER-145
        const m145 = MAP145[screen.name], tokenScreen = m137 || m145;
        if (tokenScreen && !frame.large) {
          await test(`${tag}: no two token pieces are closer than a piece is wide, and a caption is within about 90 px of its own piece (120 where a nearer place would lie over a label)`, async () => {
            await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
            const got = await page.evaluate(() => {
              const box = e => e.getBoundingClientRect();
              const ts = [...document.querySelectorAll('.token')].map(t => ({ t, p: box(t.querySelector('.token-piece')), c: t.querySelector('.token-label') }));
              const near = [], far = [];
              for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                const a = ts[i].p, b = ts[j].p, d = Math.hypot((a.left + a.right - b.left - b.right) / 2, (a.top + a.bottom - b.top - b.bottom) / 2);
                if (d < a.width - 0.5) near.push(`${ts[i].t.dataset.expedition} and ${ts[j].t.dataset.expedition} ${Math.round(d)} px apart, a piece is ${Math.round(a.width)}`);
              }
              for (const { t, p, c } of ts) {
                if (!c.checkVisibility()) continue;
                const r = box(c), d = Math.hypot(Math.max(r.left - p.right, 0, p.left - r.right), Math.max(r.top - p.bottom, 0, p.top - r.bottom));
                if (d > 125) far.push(`${t.dataset.expedition}: ${Math.round(d)} px`);
              }
              return { near, far, n: ts.length };
            });
            ok(!got.near.length, got.near.join('; '));
            ok(!got.far.length, `a caption lies far from its piece: ${got.far}`);
          });
        }
        if (m145?.stack) {
          await test(`${tag}: parties a piece's width apart are one token with a count`, async () => {
            const got = await page.evaluate(() => [...document.querySelectorAll('.token')].map(t => [t.dataset.count, t.dataset.expedition]));
            eq(got.length, 1, `${got.length} tokens: ${JSON.stringify(got)}`);
            eq(got[0][0], String(m145.stack));
          });
        }
        if (m145?.careful) {
          await test(`${tag}: a careful agent a season out is drawn along his road, not at the stop he left`, async () => {
            const got = await page.evaluate(() => { const t = document.querySelector('.token'), d = document.querySelector('.dot.home, .dot[data-stop="cairo"], .dot.cluster'); return { start: t.dataset.start ?? null, from: t.dataset.from }; });
            eq(got.start, null, `the token stands on ${got.from}: a leg of ${CAREFUL.total} seasons with ${CAREFUL.left} left is ${Math.round((1 - CAREFUL.left / CAREFUL.total) * 100)} percent done`);
          });
        }
        if (screen.name === 'map-board' && frame.name === 'board') {
          await test(`${tag}: the picture fills the pane's width and every stop lies inside the pane`, async () => {
            const got = await page.evaluate(() => {
              const st = document.querySelector('.map-stage').getBoundingClientRect(), fr = document.querySelector('.map-frame').getBoundingClientRect();
              const out = [...document.querySelectorAll('.dot')].filter(d => { const r = d.getBoundingClientRect(); return r.left < st.left || r.right > st.right || r.top < st.top || r.bottom > st.bottom; }).map(d => d.dataset.stop ?? d.dataset.cluster);
              return { stageW: st.width, stageH: st.height, frameW: fr.width, frameH: fr.height, out };
            });
            ok(got.frameW >= got.stageW * 1.1, `the picture is ${Math.round(got.frameW)} px wide in a pane ${Math.round(got.stageW)} px wide`);
            ok(got.frameH >= got.stageH * 0.8, `the picture is ${Math.round(got.frameH)} px tall in a pane ${Math.round(got.stageH)} px tall (the bands above and below were 33 percent)`);
            eq(got.out, [], 'a stop is outside the pane');
          });
        }
        if (screen.name === 'map-board' && frame.mobile && frame.height > frame.width) {
          await test(`${tag}: the map's top bar is one line: the date and the money each on a line of their own`, async () => {
            const got = await page.evaluate(() => ['#map-date', '#map-money'].map(s => { const e = document.querySelector(s), lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3; return [s, Math.round(e.getBoundingClientRect().height / lh)]; }));
            for (const [s, n] of got) eq(n, 1, `${s} sets ${n} lines`);
          });
        }
        if (screen.name === 'notebook-tabs') {
          await test(`${tag}: the notebook keeps its top in one place on every tab`, async () => {
            const tops = [];
            for (const tab of ['terms', 'places', 'people', 'goods']) {
              await page.click(`#nb-tab-${tab}`);
              await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
              tops.push([tab, await page.$eval('#panel-notebook', e => Math.round(e.getBoundingClientRect().top * 10) / 10)]);
            }
            ok(tops.every(([, t]) => t === tops[0][1]), `the top moves between tabs: ${JSON.stringify(tops)}`);
          });
        }
        if (screen.name === 'outfit-second-open' && frame.mobile && frame.height > frame.width && !frame.large) {
          await test(`${tag}: no stepper's plus column reaches Send's left edge`, async () => {
            const got = await page.evaluate(() => {
              const send = document.querySelector('#outfit-send').getBoundingClientRect();
              const pluses = [...document.querySelectorAll('.stepper .step-btn')].filter(b => b.id.endsWith('-plus') && b.checkVisibility()).map(b => [b.id, b.getBoundingClientRect().right]);
              return { send: send.left, pluses };
            });
            ok(got.pluses.length >= 2, 'the sheet shows no stepper');
            const bad = got.pluses.filter(([, r]) => r > got.send - 8).map(([id, r]) => `${id} ends at ${Math.round(r)}, Send begins at ${Math.round(got.send)}`);
            ok(!bad.length, bad.join('; '));
          });
        }
        if (screen.name === 'desk-papers' && frame.mobile && frame.height > frame.width && !frame.large) {
          await test(`${tag}: the tabs of the other papers are reachable above the End bar with the page scrolled to its foot`, async () => {
            await page.evaluate(() => new Promise(r => setTimeout(r, 450)));
            const got = await page.evaluate(() => {
              window.scrollTo(0, document.documentElement.scrollHeight);
              const end = document.querySelector('.end-row').getBoundingClientRect(), tabs = [...document.querySelectorAll('.edge')].map(e => e.getBoundingClientRect());
              return { under: tabs.filter(t => t.bottom > end.top + 0.5 && t.top < end.bottom - 0.5).length, n: tabs.length };
            });
            ok(got.n >= 1, 'no paper tabs');
            eq(got.under, 0, 'a tab lies under the End bar with the page scrolled to its foot');
          });
        }
        if ((screen.name === 'desk-question' || screen.name === 'desk-report') && frame.height > frame.width && !frame.large) {
          // MER-142 fixed a return and a loss; a letter or a card with two choices still had the second behind End the season on an upright phone
          await test(`${tag}: the second choice is not behind End the season`, async () => {
            // as the desk left the page when the paper opened: it measures once the sheet has risen (220 ms) and scrolls the page itself, so no scroll is reset here
            await page.evaluate(() => new Promise(r => setTimeout(r, 450)));
            const got = await page.evaluate(() => {
              const row = document.querySelector('.end-row'), choices = [...document.querySelectorAll('.sheet .choices .choice')];
              if (!row || !row.checkVisibility() || choices.length < 2) return { missing: `End row ${!!row}, choices ${choices.length}` };
              const e = row.getBoundingClientRect(), title = document.querySelector('.sheet-title').getBoundingClientRect(), top = document.querySelector('.topbar').getBoundingClientRect().bottom;
              // where the headline and the last choice cannot both show above the bar, the headline wins (MER-122)
              const fits = choices.at(-1).getBoundingClientRect().bottom - title.top <= e.top - top - 8;
              return { fits, behind: choices.map((c, i) => [i + 1, c.getBoundingClientRect()]).filter(([, r]) => r.bottom > e.top + 0.5 && r.top < e.bottom - 0.5).map(([i, r]) => `choice ${i} at ${Math.round(r.top)} to ${Math.round(r.bottom)} under End at ${Math.round(e.top)}`) };
            });
            ok(!got.missing, got.missing ?? '');
            if (got.fits) ok(!got.behind.length, brief(got.behind));
          });
        }
        if (screen.name === 'title' || screen.name === 'title-continue') {
          // the site sweep: the title had no visible way back to the board on a phone. The pattern is the other games' (TG-97): an "All games" link to the site's root
          await test(`${tag}: the All games link to the board is on screen, covered by nothing, and reachable by Tab`, async () => {
            const got = await page.evaluate(() => {
              const a = document.getElementById('lnk-all-games');
              if (!a) return { missing: true };
              const r = a.getBoundingClientRect(), on = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
              a.focus();
              return { href: a.getAttribute('href'), text: a.textContent, resolves: new URL(a.href).pathname, shown: a.checkVisibility() && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
                covered: !(on === a || a.contains(on)), focused: document.activeElement === a, tab: a.tabIndex };
            });
            ok(!got.missing, 'the title has no #lnk-all-games');
            eq([got.text, got.resolves], ['All games', '/'], 'the link');
            ok(got.shown, 'the link is not wholly on screen');
            ok(!got.covered, 'something lies over the link');
            ok(got.focused && got.tab >= 0, 'Tab cannot reach the link');
          });
        }
        if (screen.name === 'title' && frame.height > frame.width && frame.mobile && !frame.large) {
          // c000: on an upright phone the head and the menu card cover the picture but for a strip between them, and that strip was 60 px of roofs with the
          // picture's blurred foreground in the gutters at the card's sides. The strip is at least 120 px of the picture, it starts where the city starts (the
          // plain sky above it is under the title, DESIGN 4.2's safe box), and the picture is cut from further along than its soft left edge.
          await test(`${tag}: between the title and the menu the picture shows a strip of the city, at least 120 px, from the city's first rows`, async () => {
            const got = await page.evaluate(() => {
              const vw = document.documentElement.clientWidth, vh = innerHeight, k = Math.max(vw / 1920, vh / 1080);
              const head = document.querySelector('.title-head').getBoundingClientRect(), home = document.getElementById('lnk-all-games').getBoundingClientRect(), menu = document.querySelector('.title-menu').getBoundingClientRect();
              const top = Math.max(head.bottom, home.bottom), pos = parseFloat(getComputedStyle(document.querySelector('.title-still')).objectPosition) / 100;
              return { strip: Math.round(menu.top - top), firstRow: Math.round((top / (1080 * k)) * 100) / 100, left: Math.round((1 - vw / (1920 * k)) * pos * 100) };
            });
            ok(got.strip >= 120, `the strip between the title and the menu is ${got.strip} px tall`);
            ok(got.firstRow >= 0.2 && got.firstRow <= 0.42, `the strip starts at ${got.firstRow} of the picture's height, not at its city (0.2 to 0.42, under the plain sky)`);
            ok(got.left >= 15, `the picture is cut from ${got.left} percent of its width, its soft left edge`);
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
