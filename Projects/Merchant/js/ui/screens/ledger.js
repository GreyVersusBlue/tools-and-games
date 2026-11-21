// The ledger (DESIGN 4.9): four sections on one scroll, Money, Warehouse, Out on the road and People.
// The engine owns every rule. This file reads the state and the engine's view() and writes what it
// finds in words; it computes no price and no outcome.
import { h } from '../dom.js';
import { writeSeason } from '../../engine/market.js';
import { leftHow } from '../../engine/agents.js';
import { num, dinars, seal } from './paper.js';
import { stopName, traitWords, cap } from './outfit.js';

export const SECTIONS = ['money', 'warehouse', 'road', 'people'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const MINUS = '−';
const VESSEL = { caravan: 'caravan', galley: 'galley', dhow: 'dhow', nileboat: 'river boat', mules: 'mule train' };

// Trust and reputation are written in words by the engine (agents.js `standing`, read here as
// view().trust and view().rep); this file keeps no table of its own.
const GROUPS = { partners: 'Partners', agents: 'Agents', court: 'The court', foreign: 'Foreign merchants' };

const signed = n => (n > 0 ? `+${num(n)}` : n < 0 ? `${MINUS}${num(-n)}` : '0');

/** The changes in the house's money over the last four seasons that closed, newest last, from the
    log's `season` entries ({ kind: 'season', at, change }). [] when the log has none. */
export function moneyTrail(content, log) {
  return (log ?? []).filter(e => e.kind === 'season' && Number.isInteger(e.change)).slice(-4)
    .map(e => ({ at: e.at, season: writeSeason(content, e.at), change: e.change }));
}

/** When an expedition is expected home: the season it is on plus the seasons its legs have left. */
function dueSeason(app, x) {
  const legs = app.content.routes.find(r => r.id === x.route)?.legs ?? [];
  let n = x.status === 'out' ? x.left : (legs[x.leg]?.seasons ?? 0);
  for (let i = x.leg + 1; i < legs.length; i++) n += legs[i].seasons;
  const v = app.view(), at = SEASONS.indexOf(v.season) + n;
  return `${cap(SEASONS[at % 4])} ${v.year + Math.floor(at / 4)}`;
}

function whereIsExpedition(app, x) {
  const { content } = app;
  const route = content.routes.find(r => r.id === x.route);
  const leg = route?.legs[x.leg];
  if (x.status === 'home') return 'Back in Cairo, waiting to be met.';
  if (!leg) return 'Last heard of on the road.';
  const by = VESSEL[leg.by] ?? leg.by;
  if (x.status === 'waiting') return `Last heard of at ${stopName(content, leg.from)}, waiting for the road to ${stopName(content, leg.to)} to open.`;
  return `Last heard of on the ${by} from ${stopName(content, leg.from)} to ${stopName(content, leg.to)}.`;
}

function whereIsAgent(app, a, r) {
  const { content, state } = app;
  const out = state.expeditions.find(x => x.agent === a.id);
  if (r.where === 'dead') return 'Did not come home.';
  if (r.where === 'gone') return leftHow(app.state, a.id) === 'retired' ? 'Has retired.' : 'Has gone to work for another house.';
  if (out) return `On the road to ${stopName(content, content.routes.find(x => x.id === out.route)?.to ?? '')}.`;
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
  const trail = moneyTrail(content, state.log);
  const loans = state.loans ?? [];
  return section('money', 'Money',
    h('p', { class: 'ledger-line', id: 'ledger-have' }, `The house has ${dinars(state.money)}.`),
    loans.length
      ? h('ul', { class: 'ledger-list', id: 'ledger-loans' }, loans.map(l => h('li', null,
        `Owes ${dinars(l.principal)} to ${cap(l.from)}, due ${writeSeason(content, l.due)}.`)))
      : h('p', { class: 'ledger-line', id: 'ledger-loans' }, 'The house owes nothing.'),
    h('h4', null, 'The last four seasons'),
    trail.length
      ? h('ul', { class: 'ledger-list ledger-trail', id: 'ledger-trail' }, trail.map(t => h('li', { dataset: { change: String(t.change) } },
        h('span', null, t.season), ' ', h('strong', null, `${signed(t.change)} ${Math.abs(t.change) === 1 ? 'dinar' : 'dinars'}`))))
      : h('p', { class: 'ledger-line', id: 'ledger-trail' }, 'No season has been closed in the books yet.'));
}

function warehouse(app) {
  const { state, content } = app;
  const home = content.city.home;
  const prices = app.view().prices[home] ?? {};
  const held = Object.entries(state.stock).filter(([, q]) => q > 0);
  const rows = held.map(([id, q]) => {
    const good = content.goods.find(g => g.id === id);
    const p = prices[id];
    const unit = good?.unit ?? 'load';
    const price = p?.p == null ? 'no news of the price'
      : `${stopName(content, home)} price ${dinars(p.p)} a ${unit}, ${p.written}, ${p.ageWords}`;
    return h('li', { dataset: { good: id } }, h('strong', null, `${num(q)} ${q === 1 ? unit : `${unit}s`} of ${good?.name?.toLowerCase() ?? id}`), ' ', h('span', null, price));
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
      h('span', null, x.status === 'home' ? 'Home now.' : `Due home about ${dueSeason(app, x)}.`));
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

/** The body of the ledger panel: the four sections, in order. */
export function ledgerBody(app) {
  return [h('div', { class: 'ledger-scroll' }, money(app), warehouse(app), road(app), people(app))];
}
