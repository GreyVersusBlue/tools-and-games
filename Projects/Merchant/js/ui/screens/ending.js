// The ending (DESIGN 4.12, ARCHITECTURE 4.9): the plague notice, the recall, who came home,
// the score and the page after 1347. The engine owns every rule. This file asks it (view, recall,
// score) and draws the answer. Pages while the game is in phase "recall": notice, recall.
// Pages once it is "ended": home, score, after. The page is the hash (#ending/home), so a reload
// resumes it. What the player has chosen on the recall page, and has not yet sent, lives in
// app.recallPlan and is forgotten by a reload (nothing was decided yet).
import { h, qs } from '../dom.js';
import * as engine from '../../engine/index.js';
import { recallChances } from '../../engine/routes.js';
import { seasonsLeft } from '../../engine/letters.js';
import { leftHow } from '../../engine/agents.js';
import { seal, sourceLine, num, dinars } from './paper.js';

/** The pages open in each phase of the game, the first being where a player lands. */
export const ENDING_PAGES = { recall: ['notice', 'recall'], ended: ['home', 'score', 'after'] };

const PART_NAMES = { wealth: 'Wealth', reputation: 'Reputation', people: 'People who came home', notebook: 'Notebook pages' };
const TITLES = { recall: 'Send word to your people', home: 'Who came home', score: 'The score', after: 'After 1347' };
const stopName = (content, id) => (content.stops ?? []).find(x => x.id === id)?.name ?? id;
/** Points: a whole number as it is, a half (the notebook's pages are worth a half) with its decimal. */
export const pts = n => (Number.isInteger(n) ? num(n) : n.toFixed(1));
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

/** In words: how likely word is to reach an expedition in time (the engine's chance, never shown as a number). */
export function wordLine(chance, name) {
  if (chance >= 0.8) return `Word will almost certainly reach ${name} in time.`;
  if (chance >= 0.5) return `Word will probably reach ${name} in time.`;
  if (chance >= 0.25) return `Word may not reach ${name} in time.`;
  return `Word is unlikely to reach ${name} in time.`;
}

/** What each expedition still out is, for the recall page. Reads the engine's own numbers (the recall chances
    in city.json over routes.js's defaults, the seasons left of the road from letters.js) and words them. */
export function outList(state, content) {
  const cfg = recallChances(content);
  return state.expeditions.map(x => {
    const agent = (content.agents ?? []).find(a => a.id === x.agent);
    const route = (content.routes ?? []).find(r => r.id === x.route);
    const lag = x.status === 'home' ? 0 : seasonsLeft(content, x);
    const chance = Math.max(cfg.reach.floor, Math.min(1, cfg.reach.start - cfg.reach.perSeason * lag));
    const leg = route.legs[Math.min(x.leg, route.legs.length - 1)];
    const place = x.status === 'out' ? leg.to : leg.from;
    const cargo = Object.entries(x.cargo ?? {}).filter(([, n]) => n > 0).map(([g, n]) => {
      const good = (content.goods ?? []).find(y => y.id === g), unit = good?.unit ?? 'load';
      return `${n} ${n === 1 ? unit : `${unit}s`} of ${(good?.name ?? g).toLowerCase()}`;
    });
    return { id: x.id, agent: agent?.id ?? x.agent, name: agent?.name ?? x.agent, seal: agent?.seal ?? null, place: stopName(content, place),
      home: x.status === 'home', cargo, chance, word: wordLine(chance, agent?.name ?? x.agent) };
  });
}

/** Every agent the house ever employed, in the book's order, with how it ended for them. `fate` is
    home, dead or gone. The line is the recall's own when it wrote one, else a plain one from where they are. */
export function whoCameHome(state, content) {
  const lines = new Map();
  for (const e of state.log) if (e.kind === 'recall') for (const r of e.results ?? []) lines.set(r.agent, r.text);
  const out = [];
  for (const a of content.agents ?? []) {
    const r = state.agents?.[a.id];
    if (!r || !(r.hired || r.where === 'gone')) continue;
    const home = content.city.home;
    let fate, line = lines.get(a.id);
    if (r.where === 'dead') { fate = 'dead'; line ??= `${a.name} died on the road earlier in the game.`; }
    else if (r.where === 'gone') { fate = 'gone'; line = leftHow(state, a.id) === 'retired' ? `${a.name} retired from the house before the plague.` : `${a.name} went to work for another house before the plague.`; }
    else if (r.where === home) { fate = 'home'; line ??= `${a.name} was in ${stopName(content, home)} when the plague came.`; }
    else { fate = 'away'; line ??= `${a.name} did not come home.`; }
    out.push({ id: a.id, name: a.name, seal: a.seal, fate, line, trust: r.trust });
  }
  return out;
}

/** app: { content, state, art, view(), act(fn), say(text), recallPlan }. nav: { go(page), toTitle(), playAgain(opener) }. */
export function createEnding(app, nav) {
  const { content } = app;
  const still = h('div', { class: 'desk-stills ending-stills' });
  const holder = h('div', { class: 'ending-holder' });
  const el = h('main', { class: 'ending-screen', id: 'screen-ending' }, still, holder);
  let page = null;
  let sending = false;

  const asset = app.art.get('harbour-empty');
  if (asset) still.append(h('img', { class: 'desk-still', src: `assets/art/${asset.file}`, alt: asset.alt ?? '', decoding: 'async', fetchpriority: 'high' }));

  const button = (id, label, onclick, primary = true) => h('button', { class: `button${primary ? ' primary' : ''}`, type: 'button', id, onclick: e => onclick(e.currentTarget) }, label);
  const sheet = (name, title, ...rest) => h('article', { class: 'paper ending-sheet', dataset: { page: name }, 'aria-labelledby': 'ending-title' },
    h('h2', { class: 'ending-title', id: 'ending-title', tabindex: '-1' }, title), ...rest);

  // ---- 1. the notice, over the empty harbour: the event's own words, from events.json
  function notice() {
    const ev = (content.events ?? []).find(e => e.id === 'plague-reaches-egypt');
    const n = ev?.notice ?? { title: 'Sickness at Alexandria', body: 'A ship has come into Alexandria with most of its crew dead. Your agents are far from home.' };
    return sheet('notice', n.title,
      h('p', { class: 'ending-body' }, n.body),
      h('p', { class: 'ending-body' }, 'This is the last season of the house. Before the sickness reaches Cairo, you can send word to the people still on the road.'),
      sourceLine(content, ev?.sources),
      h('div', { class: 'ending-actions' }, button('ending-next', 'Go on', () => nav.go('recall'))));
  }

  // ---- 2. the recall: one row per expedition still out, recall or stay for each
  const planOf = id => (app.recallPlan ??= {})[id] ?? 'stay';
  function recallPage() {
    const rows = outList(app.state, content);
    const body = [
      h('p', { class: 'ending-body' }, rows.length
        ? 'Each of your people still out is listed below, with where they are and whether word can reach them in time. A person called home comes with part of the cargo and will most likely live. A person who stays may finish the trip with all of it, or may not come back.'
        : 'Nobody from the house is on the road. Your people are all in Cairo, and the plague will come to them there.'),
    ];
    if (rows.length) {
      body.push(h('ul', { class: 'ending-out' }, rows.map(r => {
        const group = h('div', { class: 'recall-choice', role: 'group', 'aria-labelledby': `recall-${r.id}-name`, dataset: { expedition: r.id } });
        const press = which => () => {
          app.recallPlan[r.id] = which;
          for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.choice === which));
        };
        const opt = (which, label) => h('button', { class: 'choice', type: 'button', id: `recall-${r.id}-${which}`, dataset: { choice: which },
          'aria-pressed': String(planOf(r.id) === which), onclick: press(which) }, label);
        group.append(opt('recall', 'Call them home'), opt('stay', 'Let them finish'));
        return h('li', { class: 'ending-row', dataset: { agent: r.agent } },
          h('div', { class: 'ending-who' }, seal(app, r.seal),
            h('div', null, h('strong', { id: `recall-${r.id}-name` }, r.name),
              h('p', { class: 'ending-line', id: `recall-${r.id}-where` }, `${r.home ? 'Waiting in' : 'On the road to'} ${r.place}.${r.cargo.length ? ` Carrying ${r.cargo.join(' and ')}.` : ''}`),
              h('p', { class: 'ending-line', id: `recall-${r.id}-word`, dataset: { word: r.chance >= 0.8 ? 'sure' : r.chance >= 0.5 ? 'likely' : r.chance >= 0.25 ? 'maybe' : 'unlikely' } }, r.word))),
          group);
      })));
    }
    body.push(h('div', { class: 'ending-actions' },
      button('ending-send', rows.length ? 'Send word and wait' : 'Wait for the plague', () => send(), true)));
    return sheet('recall', TITLES.recall, ...body);
  }

  function send() {
    if (sending || app.state.phase !== 'recall') return;
    sending = true;
    const plan = { ...(app.recallPlan ?? {}) };
    app.recallPlan = {};
    try { app.act(s => engine.recall(s, content, plan)); } catch (e) { sending = false; app.say(e.message); return; }
    sending = false;
    nav.go('home');
  }

  // ---- 3. who came home
  function homePage() {
    const people = whoCameHome(app.state, content);
    const home = people.filter(p => p.fate === 'home').length;
    return sheet('home', TITLES.home,
      h('p', { class: 'ending-body', id: 'home-count' }, people.length
        ? `${home} of the ${people.length} ${people.length === 1 ? 'person' : 'people'} who worked for the house came home.`
        : 'The house never hired anyone.'),
      people.length ? h('ul', { class: 'ending-people' }, people.map(p => h('li', { class: 'ending-row person', dataset: { agent: p.id, fate: p.fate } },
        h('div', { class: 'ending-who' }, seal(app, p.seal), h('div', null, h('strong', null, p.name), h('p', { class: 'ending-line' }, p.line)))))) : null,
      h('div', { class: 'ending-actions' }, button('ending-next', 'See the score', () => nav.go('score'))));
  }

  // ---- 4. the score
  function scorePage() {
    const sc = app.state.score ?? engine.score(app.state, content);
    const house = (content.houses ?? []).find(x => x.id === app.state.house);
    return sheet('score', TITLES.score,
      h('ul', { class: 'ending-parts' }, sc.parts.map(p => h('li', { class: 'ending-part', dataset: { part: p.id } },
        h('div', { class: 'part-head' }, h('strong', null, PART_NAMES[p.id] ?? p.id), h('span', { class: 'points' }, `${pts(p.points)} points`)),
        h('p', { class: 'ending-line' }, p.reason)))),
      h('p', { class: 'ending-sum', id: 'score-sum' }, `Together: ${pts(sc.sum)} points.`),
      h('p', { class: 'ending-sum', id: 'score-multiplier' }, `${house?.name ? `${house.name}, ` : ''}multiplied by ${sc.multiplier}.`),
      h('p', { class: 'ending-total', id: 'score-total' }, `Total: ${num(sc.total)} points`),
      h('p', { class: 'ending-rank', id: 'score-rank' }, sc.rank),
      h('div', { class: 'ending-actions' }, button('ending-next', 'After 1347', () => nav.go('after'))));
  }

  // ---- 5 and 6. after 1347, from text.json, then the two buttons
  function afterPage() {
    const sc = app.state.score ?? engine.score(app.state, content);
    const people = whoCameHome(app.state, content);
    const home = people.filter(p => p.fate === 'home').length;
    const entries = content.text?.ending ?? [];
    return sheet('after', TITLES.after,
      h('p', { class: 'ending-body', id: 'after-house' }, `The house closes its books as ${lower(sc.rank)}. ${home} of its ${people.length === 1 ? 'person' : `${people.length} people`} came home.`),
      entries.map(e => h('section', { class: 'ending-entry', dataset: { entry: e.id } },
        h('h3', null, e.title), h('p', { class: 'ending-body' }, e.body), sourceLine(content, e.sources))),
      h('div', { class: 'ending-actions' },
        button('ending-again', 'Play again', b => nav.playAgain(b)),
        button('ending-title-btn', 'Back to the title', () => nav.toTitle(), false)));
  }

  const PAGES = { notice, recall: recallPage, home: homePage, score: scorePage, after: afterPage };

  /** Draw a page and put focus on its title. */
  function show(name) {
    const first = page === null;
    page = name;
    holder.replaceChildren(PAGES[name]());
    const title = qs('#ending-title', holder);
    title?.focus();
    window.scrollTo(0, 0);
    if (!first) app.say(title?.textContent ?? '');
    document.documentElement.dataset.season = 'autumn';
  }

  return { el, show, get page() { return page; }, key: () => false, destroy() {} };
}
