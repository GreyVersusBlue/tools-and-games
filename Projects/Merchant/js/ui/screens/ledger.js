// The ledger (DESIGN 4.9): four sections on one scroll, Money, Warehouse, Out on the road and People.
// The engine owns every rule. This file reads the state and the engine's view() and writes what it
// finds in words; it computes no price and no outcome.
import { h } from '../dom.js';
import { writeSeason } from '../../engine/market.js';
import { leftHow } from '../../engine/agents.js';
import { num, dinars, seal } from './paper.js';
import * as engine from '../../engine/index.js';
import { stopName, traitWords, cap, stepper } from './outfit.js';

export const SECTIONS = ['money', 'warehouse', 'road', 'people'];
const MINUS = '−';
const VESSEL = { caravan: 'caravan', galley: 'galley', dhow: 'dhow', nileboat: 'river boat', mules: 'mule train' };

// Trust and reputation are written in words by the engine (agents.js `standing`, read here as
// view().trust and view().rep); this file keeps no table of its own.
const GROUPS = { partners: 'Partners', agents: 'Agents', court: 'The court', foreign: 'Foreign merchants' };

const signed = n => (n > 0 ? `+${num(n)}` : n < 0 ? `${MINUS}${num(-n)}` : '0');

/** The changes in the house's money over the last four seasons that closed, newest last, from the
    log's `season` entries ({ kind: 'season', at, change }). [] when the log has none. A season that ran the act jump
    carries the jump as `after`, so the years are one line of their own and not folded into that season: { years, change,
    trips, net }, read from the log's own `jump` entry (its `years`, the number the interlude page prints) and its `net` (what the trips made for the house, as the page says) and `trips` (the cash they moved), with `change` (all the jump did to the money) taken out of the season's own figure
    (MER-125). A jump entry from before they were written gives its years alone. */
export function moneyTrail(content, log) {
  const jumps = (log ?? []).filter(e => e.kind === 'jump' && Number.isInteger(e.years));
  const four = (log ?? []).filter(e => e.kind === 'season' && Number.isInteger(e.change)).slice(-4);
  return four.map(e => {
    const j = jumps.find(x => x.from === e.at);
    const known = j && Number.isInteger(j.change) && Number.isInteger(j.trips) && Number.isInteger(j.net);
    return { at: e.at, season: writeSeason(content, e.at), change: known ? e.change - j.change : e.change,
      after: j ? { years: j.years, ...(known ? { change: j.change, trips: j.trips, net: j.net } : {}) } : null };
  });
}

/** The warehouse sales the log holds (`sale` entries: { at, good, loads, got, cut }), grouped by the season they were made in, as
    { at, season, lines: ['Sold 10 loads of copper for 255 dinars.'] }, oldest first (MER-138). The ledger prints each under its season's line,
    and a season still open (no `season` entry yet) gets a line of its own. */
export function salesBySeason(content, log) {
  const by = new Map();
  for (const e of log ?? []) {
    if (e.kind !== 'sale' || !Number.isInteger(e.at)) continue;
    const good = (content.goods ?? []).find(g => g.id === e.good), unit = good?.unit ?? 'load';
    const line = `Sold ${num(e.loads)} ${e.loads === 1 ? unit : `${unit}s`} of ${(good?.name ?? e.good).toLowerCase()} for ${dinars(e.got)}.`;
    if (!by.has(e.at)) by.set(e.at, { at: e.at, season: writeSeason(content, e.at), lines: [] });
    by.get(e.at).lines.push(line);
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
}

/** The line for the years of a jump: "10 years passed. The trips made 235 dinars for the house." The money's own figure follows when
    goods that came home make it differ, so the books and the page between the acts say the same thing. */
export function jumpWords(a) {
  const n = a.years === 1 ? 'A year passed.' : `${a.years} years passed.`;
  if (!Number.isInteger(a.net)) return n;
  const made = a.net > 0 ? `The trips made ${dinars(a.net)} for the house.` : a.net < 0 ? `The trips cost the house ${dinars(-a.net)}.` : 'The trips came out even.';
  // MER-160 (M4g play problem 8): the clause that said the rest of a gap between the money and the trips' net "being goods in the warehouse" is gone. The
  // gap is mostly the money the trips took with them, paid out when they left, and the warehouse was empty on the page that said it.
  const other = a.change - a.trips;
  return `${n} ${made}${other ? ` Loans and other news moved the money by ${signed(other)}.` : ''}`;
}

/** MER-145 (MER-146's `worth` log entries, M4e play problem 7: worth moved by +81 and +368 with no paper): the lines the log holds for what moved the house's
    worth without a paper ({ at, kind: 'worth', cause, change, text }: "The goods in the warehouse rose in price: +81."), grouped by the season index they
    were written in, in the order they were written. The ledger prints each under its season's line, as it does a sale. */
export function worthBySeason(log) {
  const by = new Map();
  for (const e of log ?? []) {
    if (e.kind !== 'worth' || !Number.isInteger(e.at) || !e.text) continue;
    if (e.cause === 'reset') continue;   // the years' own move belongs to the jump line, and no season's change holds it (turn.js trail)
    if (!by.has(e.at)) by.set(e.at, []);
    by.get(e.at).push(e.text);
  }
  return by;
}

/** MER-160 (M4g play problem 10: Summer 1324 showed +217 and its lines listed +219): the lines the ledger prints for one closed season of the trail, as
    { text, change }, so that they add up to the season's `change` exactly. The log's `worth` lines come first, in the order they were written; what the
    moves too small to have a line of their own come to (the trail's `rest`: a card's few dinars, a toll) is one last line. */
export function seasonLines(row, log) {
  const lines = (log ?? []).filter(e => e.kind === 'worth' && e.at === row.at && e.cause !== 'reset' && e.text && Number.isInteger(e.change)).map(e => ({ text: e.text, change: e.change }));
  if (Number.isInteger(row.rest) && row.rest !== 0) lines.push({ text: `${signed(row.rest)} from small moves with no line of their own, such as card money and tolls.`, change: row.rest, small: true });
  return lines;
}

/** The line for the years of a jump as the engine's trail gives them (`after`: { years, change, trips, net }, `change` being the jump's change in worth):
    jumpWords without the clause about loans, which was worth's difference from cash and is now a number of its own. */
export function trailJumpWords(a) {
  const n = a.years === 1 ? 'A year passed.' : `${a.years} years passed.`;
  if (!Number.isInteger(a.net)) return n;
  const made = a.net > 0 ? `The trips made ${dinars(a.net)} for the house.` : a.net < 0 ? `The trips cost the house ${dinars(-a.net)}.` : 'The trips came out even.';
  return `${n} ${made}`;
}

/** MER-160 (M4g play problem 10: the road line said "from Damascus to Cairo" while People said "On the road to Damascus"): where an expedition is, read once from its
    leg, so the road section and the People list say the same thing. { at: 'home' } | { at: 'stop', stop, to } | { at: 'road', from, to, by, out }, `out` true on the way
    to the far end of the road and false on the way back. */
export function wherePlace(content, x) {
  const route = content.routes.find(r => r.id === x.route);
  const leg = route?.legs[x.leg];
  if (x.status === 'home') return { at: 'home' };
  if (!leg) return { at: 'unknown' };
  const farEnd = route.legs.findIndex(l => l.to === route.to);
  if (x.status === 'waiting') return { at: 'stop', stop: leg.from, to: leg.to };
  return { at: 'road', from: leg.from, to: leg.to, by: VESSEL[leg.by] ?? leg.by, out: x.leg <= farEnd };
}

export function whereIsExpedition(app, x) {
  const { content } = app;
  const p = wherePlace(content, x);
  if (p.at === 'home') return 'Back in Cairo, waiting to be met.';
  if (p.at === 'unknown') return 'Last heard of on the road.';
  if (p.at === 'stop') return `Last heard of at ${stopName(content, p.stop)}, waiting for the road to ${stopName(content, p.to)} to open.`;
  return `Last heard of on the ${p.by} from ${stopName(content, p.from)} to ${stopName(content, p.to)}.`;
}

export function whereIsAgent(app, a, r) {
  const { content, state } = app;
  const out = state.expeditions.find(x => x.agent === a.id);
  if (r.where === 'dead') return 'Did not come home.';
  if (r.where === 'gone') return leftHow(app.state, a.id) === 'retired' ? 'Has retired.' : 'Has gone to work for another house.';
  if (out) {
    const p = wherePlace(content, out);
    if (p.at === 'stop') return `Waiting at ${stopName(content, p.stop)} for the road to ${stopName(content, p.to)} to open.`;
    if (p.at === 'road') return p.out ? `On the road to ${stopName(content, p.to)}, on the ${p.by} from ${stopName(content, p.from)}.` : `On the way home, on the ${p.by} from ${stopName(content, p.from)} to ${stopName(content, p.to)}.`;
    if (p.at === 'home') return `Back in ${stopName(content, content.city.home)}, waiting to be met.`;
  }
  return `At home in ${stopName(content, content.city.home)}.`;
}

/** A person is in the People list when the house has hired them, or lost them. */
const knownAgents = app => (app.content.agents ?? []).filter(a => {
  const r = app.state.agents[a.id];
  return r && (r.hired || r.where === 'gone' || r.where === 'dead');
});

const section = (key, title, ...body) => h('section', { class: 'ledger-sec', id: `ledger-${key}`, 'aria-labelledby': `ledger-${key}-h` },
  h('h3', { id: `ledger-${key}-h`, tabindex: '-1' }, title), ...body);

function money(app) {
  const { state, content } = app;
  // MER-145 (MER-146's view().trail): each season's true change in worth, with the money's own change when it differs, and the jump as a line of its own
  const trail = app.view().trail ?? moneyTrail(content, state.log);
  const sales = salesBySeason(content, state.log), worth = worthBySeason(state.log);
  const closed = Math.max(-1, ...state.log.filter(e => e.kind === 'season' && Number.isInteger(e.at)).map(e => e.at));
  const saleLines = at => (sales.find(x => x.at === at)?.lines ?? []).map(l => h('li', { class: 'ledger-sale', dataset: { saleAt: String(at) } }, l));
  const worthLines = at => (worth.get(at) ?? []).map(l => h('li', { class: 'ledger-worth', dataset: { worthAt: String(at) } }, l));
  // a closed season prints every line its change is made of, the small moves' one included (MER-160); an open season prints what has moved so far
  const closedLines = row => seasonLines(row, state.log).map(l => h('li', { class: l.small ? 'ledger-worth ledger-small' : 'ledger-worth', dataset: { worthAt: String(row.at), lineChange: String(l.change) } }, l.text));
  const openAts = [...new Set([...sales.map(x => x.at), ...worth.keys()])].filter(at => at > closed).sort((a, b) => a - b);
  const loans = state.loans ?? [];
  return section('money', 'Money',
    h('p', { class: 'ledger-line', id: 'ledger-have' }, `The house has ${dinars(state.money)}.`),
    loans.length
      ? h('ul', { class: 'ledger-list', id: 'ledger-loans' }, loans.map(l => h('li', null,
        `Owes ${dinars(l.principal)} to ${cap(l.from)}, due ${writeSeason(content, l.due)}.`)))
      : h('p', { class: 'ledger-line', id: 'ledger-loans' }, 'The house owes nothing.'),
    h('h4', null, 'The last four seasons'),
    trail.length || openAts.length
      ? h('ul', { class: 'ledger-list ledger-trail', id: 'ledger-trail' }, [...trail.flatMap(t => [
        h('li', { dataset: { change: String(t.change), ...(Number.isInteger(t.cash) ? { cash: String(t.cash) } : {}) } },
          h('span', null, t.season), ' ', h('strong', null, `${signed(t.change)} ${Math.abs(t.change) === 1 ? 'dinar' : 'dinars'}`),
          Number.isInteger(t.cash) && t.cash !== t.change ? h('small', { class: 'ledger-cash' }, ` in worth, ${signed(t.cash)} in the money`) : null),
        ...saleLines(t.at), ...closedLines(t),
        ...(t.after ? [h('li', { class: 'ledger-jump', dataset: { gap: String(t.after.years) } }, trailJumpWords(t.after))] : [])]),
      // a season not yet closed has no change to show, only what the house sold in it so far and what moved its worth
      ...openAts.flatMap(at => [h('li', { class: 'ledger-open', dataset: { open: String(at) } }, h('span', null, `${writeSeason(content, at)}, not yet closed`)), ...saleLines(at), ...worthLines(at)])])
      : h('p', { class: 'ledger-line', id: 'ledger-trail' }, 'No season has been closed in the books yet.'));
}

/** What a sale quote says in one line: what the loads fetch after the broker's cut and the average a load, or the engine's own reason. */
function quoteWords(app, q) {
  if (!q.ok) return q.reason;
  const home = stopName(app.content, app.content.city.home);
  return `${q.loads === 1 ? 'This load fetches' : `These ${num(q.loads)} loads fetch`} ${dinars(q.got)} in ${home} after the broker's cut of ${dinars(q.cut)}${q.loads === 1 ? '' : `, ${String(q.average).replace(/\.0$/, '')} ${q.average === 1 ? 'dinar' : 'dinars'} a load on average`}.`;
}

/** MER-138 (M4d play problem 1, the Sell button over MER-139's sellHome): the warehouse sells in Cairo, a stepper of loads and the quote line for
    each good the house holds. `loads` keeps each good's number across a redraw. A sale the engine would refuse says its reason under the button
    before the button is pressed (the quote's own), and a press on it says that reason again, in the live region. */
function warehouse(app, ui) {
  const { state, content } = app;
  const home = content.city.home;
  const prices = app.view().prices[home] ?? {};
  const held = Object.entries(state.stock).filter(([, q]) => q > 0);
  const selling = ['desk', 'interlude'].includes(state.phase);
  const rows = held.map(([id, q]) => {
    const good = content.goods.find(g => g.id === id);
    const p = prices[id];
    const unit = good?.unit ?? 'load';
    const n = Math.max(1, Math.min(q, ui.loads[id] ?? Math.min(q, 10)));
    ui.loads[id] = n;
    const quote = engine.sellHomeQuote(state, content, id, n);
    const name = good?.name?.toLowerCase() ?? id;
    // MER-145 (M4e play problem 14, a099): the price line is the quote for the loads now chosen, drawn again after every sale and every step. The news
    // price it replaced stayed at "71 dinars a load" while the next two loads fetched 55 each.
    const price = quote.ok
      ? `${stopName(content, home)} pays ${dinars(quote.first)} a ${unit} now${quote.first === quote.last ? '' : `, falling to ${dinars(quote.last)} by the last`}, after the broker's cut`
      : p?.p == null ? 'no news of the price' : `${stopName(content, home)} price ${dinars(p.p)} a ${unit}, ${p.written}, ${p.ageWords}`;
    const note = quoteWords(app, quote);
    return h('li', { dataset: { good: id } },
      h('strong', null, `${num(q)} ${q === 1 ? unit : `${unit}s`} of ${name}`), ' ', h('span', null, price),
      selling ? h('div', { class: 'sell-row' },
        stepper({ key: `sell-${id}`, label: `Loads of ${name} to sell`, value: n, min: 1, max: q, big: 10, text: `${n} ${n === 1 ? unit : `${unit}s`}`,
          onChange: v => { ui.loads[id] = v; ui.redraw(`step-sell-${id}`); } }),
        h('button', { class: 'button sell-btn', type: 'button', id: `sell-${id}`, 'aria-describedby': `sell-note-${id}`, 'aria-disabled': quote.ok ? null : 'true',
          onclick: () => ui.sell(id, n) }, `Sell in ${stopName(content, home)}`),
        h('p', { class: `sell-note${quote.ok ? '' : ' refused'}`, id: `sell-note-${id}` }, note)) : null);
  });
  return section('warehouse', 'Warehouse',
    rows.length ? h('ul', { class: 'ledger-list', id: 'ledger-stock' }, rows) : h('p', { class: 'ledger-line', id: 'ledger-stock' }, 'The warehouse is empty.'));
}

function road(app) {
  const { state, content } = app;
  const rows = state.expeditions.map(x => {
    const agent = content.agents.find(a => a.id === x.agent);
    const route = content.routes.find(r => r.id === x.route);
    const to = route ? stopName(content, route.to) : '';
    return h('li', { class: 'ledger-trip', dataset: { expedition: x.id } },
      h('strong', null, `${agent?.name ?? 'An agent'} to ${to}`), ' ',
      h('span', null, whereIsExpedition(app, x)), ' ',
      h('span', null, x.status === 'home' ? 'Home now.' : `Due home about ${app.view().homeBy?.[x.id]?.season ?? 'a season not yet known'}.`));
  });
  return section('road', 'Out on the road',
    rows.length ? h('ul', { class: 'ledger-list', id: 'ledger-trips' }, rows) : h('p', { class: 'ledger-line', id: 'ledger-trips' }, 'No expedition is out.'));
}

function people(app) {
  const { state } = app;
  const { trust, rep } = app.view();
  const list = knownAgents(app);
  const rows = list.map(a => {
    const r = state.agents[a.id];
    return h('li', { class: 'ledger-person', dataset: { agent: a.id } },
      seal(app, a.seal),
      h('div', null,
        h('strong', null, a.name), ' ',
        h('span', null, `${traitWords(app, a)}`), ' ',
        h('span', null, `${a.name} ${trust[a.id]?.words ?? ''}.`), ' ',
        h('span', null, whereIsAgent(app, a, r))));
  });
  const reps = Object.keys(GROUPS).map(g => h('li', { dataset: { rep: g } },
    h('strong', null, GROUPS[g]), ' ', h('span', null, rep[g]?.words ?? ''), ' ', h('span', { class: 'num' }, signed(state.rep[g] ?? 0))));
  return section('people', 'People',
    rows.length ? h('ul', { class: 'ledger-list ledger-people', id: 'ledger-agents' }, rows) : h('p', { class: 'ledger-line', id: 'ledger-agents' }, 'No one is in the house\'s service yet.'),
    h('h4', null, 'How the world speaks of the house'),
    h('ul', { class: 'ledger-list ledger-reps', id: 'ledger-reps' }, reps));
}

/** The body of the ledger panel: the four sections, in order. A sale (the Sell button of the warehouse) is made through the engine, saved, and the
    ledger and the desk's bar are drawn again; the engine's reason for a sale it refuses is printed under that good's button and read out. */
export function ledgerBody(app) {
  const scroll = h('div', { class: 'ledger-scroll' });
  const ui = { loads: {},
    redraw(focusId = null) {
      const keep = scroll.scrollTop;
      scroll.replaceChildren(money(app), warehouse(app, ui), road(app), people(app));
      scroll.scrollTop = keep;
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    },
    sell(good, loads) {
      try { app.act(s => engine.sellHome(s, app.content, good, loads)); } catch (e) {
        app.say(String(e.message).replace(/^sellHome: /, ''));   // the engine's own reason, which is the line already under the button
        return;
      }
      app.say(`Sold ${loads} ${loads === 1 ? 'load' : 'loads'}. The house has ${dinars(app.state.money)}.`);
      app.refreshDesk?.();
      // the focus stays on the button just pressed. A good sold out has no button left: the focus goes to the section's heading and never to the next
      // good's Sell, where a second Enter would sell that too (MER-145, play b032).
      ui.redraw();
      (document.getElementById(`sell-${good}`) ?? document.getElementById('ledger-warehouse-h'))?.focus({ preventScroll: true });
    } };
  ui.redraw();
  return [scroll];
}
