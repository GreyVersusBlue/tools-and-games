// Outfitting (DESIGN 4.8): who goes, where, what they carry, the contract, and Send.
// The engine owns every rule. This file builds a plan from the player's presses, asks the engine
// whether the plan would stand (checkPlan) and says its answer in the engine's own words; nothing
// here decides what is allowed. The draft lives in memory: closing the sheet or reloading drops it.
import { h, qs, qsa } from '../dom.js';
import * as engine from '../../engine/index.js';
import { refusesOwn } from '../../engine/agents.js';
import { expectedPrice } from '../../engine/market.js';
import { num, dinars, seal } from './paper.js';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const words = n => NUMBER_WORDS[n] ?? String(n);
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => (n === 1 ? one : many);
const VESSEL = { caravan: 'caravan', galley: 'galley', dhow: 'dhow', nileboat: 'river boat', mules: 'mule train' };
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const FRACTIONS = { '1/2': 'one half', '1/3': 'one third', '2/3': 'two thirds', '1/4': 'one quarter', '3/4': 'three quarters', '1/5': 'one fifth' };

export const stopOf = (content, id) => (content.stops ?? []).find(s => s.id === id);
export const stopName = (content, id) => stopOf(content, id)?.name ?? id;
const goodOf = (content, id) => (content.goods ?? []).find(g => g.id === id);
const goodName = (content, id) => (goodOf(content, id)?.name ?? id).toLowerCase();
const unitOf = (content, id, n) => { const u = goodOf(content, id)?.unit ?? 'load'; return n === 1 ? u : `${u}s`; };

/** "spring, summer or autumn", or "any season" when all four. */
export function opensWords(leg) {
  const l = SEASONS.filter(s => leg.opens.includes(s));
  if (l.length === 4) return 'any season';
  return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} or ${l[l.length - 1]}`;
}

/** Agents the house could send now: hired, at home, not on the road. */
export function freeAgents(app) {
  const { content, state } = app, home = content.city.home;
  return (content.agents ?? []).filter(a => {
    const r = state.agents[a.id];
    return r?.hired && r.where === home && !state.expeditions.some(x => x.agent === a.id);
  });
}

/** The first leg of some open road to `stopId` can start this season: { open, next } where `next`
    is the season it opens in when it is closed now, or null when there is no road at all. */
export function firstLegState(app, stopId) {
  const { content } = app, season = app.view().season;
  const roads = (content.routes ?? []).filter(r => r.to === stopId);
  if (!roads.length) return null;
  if (roads.some(r => r.legs[0].opens.includes(season))) return { open: true };
  const at = SEASONS.indexOf(season);
  for (let k = 1; k <= 4; k++) {
    const name = SEASONS[(at + k) % 4];
    if (roads.some(r => r.legs[0].opens.includes(name))) return { open: false, next: name };
  }
  return { open: false, next: null };
}

export function traitWords(app, agent) {
  return (agent.traits ?? []).map(t => {
    if (t.startsWith('knows-')) return `knows ${stopName(app.content, t.slice(6))}`;
    if (t.startsWith('speaks-')) return `speaks ${cap(t.slice(7))}`;
    return t;
  }).join(', ');
}

/** "one third": the engine writes a share as [part, of]. */
const shareWords = ([a, b]) => FRACTIONS[`${a}/${b}`] ?? `${words(a)} of every ${words(b)}`;

/** A group that is one tab stop, with minus and plus beside a number that is text. */
function stepper({ key, label, value, min, max, step = 1, fine = step, big = 10, text, onChange }) {
  const clamp = n => Math.max(min, Math.min(max, n));
  const set = n => { n = clamp(n); if (n !== value) onChange(n); };
  // Shift narrows a press to `fine` (money moves by 50, and by 10 with Shift)
  const by = (e, sign) => sign * (e.shiftKey ? fine : step);
  const btn = (id, sign, name, delta) => h('button', { class: 'step-btn', type: 'button', tabindex: '-1', id, 'aria-label': name,
    'aria-disabled': (delta < 0 ? value <= min : value >= max) ? 'true' : null, onclick: e => set(value + by(e, Math.sign(delta))) }, sign);
  return h('div', {
    class: 'stepper', role: 'spinbutton', tabindex: '0', id: `step-${key}`, dataset: { key: `step-${key}` }, 'aria-label': label,
    'aria-valuenow': String(value), 'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuetext': text ?? String(value),
    onkeydown: e => {
      const k = e.key;
      const d = { ArrowUp: by(e, 1), ArrowRight: by(e, 1), ArrowDown: by(e, -1), ArrowLeft: by(e, -1), PageUp: big, PageDown: -big }[k];
      if (d !== undefined) { e.preventDefault(); set(value + d); }
      else if (k === 'Home') { e.preventDefault(); set(min); }
      else if (k === 'End') { e.preventDefault(); set(max); }
    },
  }, btn(`${'step-' + key}-minus`, '−', `Fewer, ${label}`, -step),
  h('span', { class: 'step-val', 'aria-hidden': 'true' }, text ?? String(value)),
  btn(`${'step-' + key}-plus`, '+', `More, ${label}`, step));
}

/** An amount typed in: digits, commas and spaces allowed ("1,250"). Returns a whole number or null. */
export function typedAmount(text) {
  const t = String(text).replace(/[,\s]/g, '');
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

/** A box beside a stepper where a whole amount can be typed (Enter or leaving the box takes it). */
function typedBox({ key, label, value, onChange, say }) {
  let done = false;
  const take = e => {
    if (done) return;
    const n = typedAmount(e.target.value);
    if (n === null) { e.target.value = String(value); say?.(`${e.target.value === '' ? 'That' : 'What you typed'} is not an amount. Use digits, like 250.`); return; }
    done = true;
    if (n !== value) onChange(n);
  };
  return h('label', { class: 'none typed' }, 'Or type an amount ',
    h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: `typed-${key}`, dataset: { key: `typed-${key}` }, 'aria-label': label, value: String(value),
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); take(e); } },
      onchange: take }));
}

/** Build the outfitting sheet for `stopId`. app: the page's app object. Calls
    onSent({ agent, stop }) after a send, onCancel() when the player leaves, onDesk() for the
    link to the hiring card. Returns { dialog, destroy }. */
export function createOutfit(app, { stopId, onSent, onCancel, onDesk }) {
  const { content } = app;
  const home = content.city.home;
  const stop = stopOf(content, stopId);
  const homeStop = stopOf(content, home);
  const first = !app.state.log.some(e => e.kind === 'outfit');
  const open = new Set();          // sections the player has pressed Change on, in the one-press sheet
  const draft = { agent: null, cargo: {}, purse: 0, contract: 'own', partners: 0, partnersSet: false };
  let sending = false;

  // the one-press first expedition starts filled in from the engine's own suggestion
  const hit0 = engine.routeFor(app.state, content, stopId);
  const suggestion = first ? engine.suggestPlan(app.state, content, stopId) : null;
  if (suggestion) { draft.agent = suggestion.agent; draft.cargo = { ...suggestion.cargo }; draft.purse = suggestion.purse ?? 0; }
  else { draft.agent = freeAgents(app)[0]?.id ?? null; }
  // a card's `outfit` effect names the agent and the contract (the desk leaves them on app.outfitWith, once, for this stop)
  const asked = app.outfitWith?.stop === stopId ? app.outfitWith : null;
  app.outfitWith = null;
  if (asked) {
    if (freeAgents(app).some(a => a.id === asked.agent)) draft.agent = asked.agent;
    // the one-press sheet offers no contract choice; it is always the house's own
    if (!first && ['own', 'qirad'].includes(asked.contract)) draft.contract = asked.contract;
  }
  const onePress = !!suggestion;
  const expanded = k => !onePress || open.has(k);

  const titleId = 'panel-outfit-title';
  const dialog = h('dialog', { class: 'paper outfit', id: 'panel-outfit', 'aria-labelledby': titleId });
  dialog.addEventListener('cancel', e => { e.preventDefault(); onCancel(); });
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const stops = qsa('button:not([disabled]):not([tabindex="-1"]), [tabindex="0"], a[href]', dialog).filter(x => x.offsetParent !== null);
    if (!stops.length) return;
    const here = document.activeElement, title = qs('h2', dialog);
    if (!e.shiftKey && here === stops[stops.length - 1]) { e.preventDefault(); stops[0].focus(); }
    else if (e.shiftKey && (here === stops[0] || here === title)) { e.preventDefault(); stops[stops.length - 1].focus(); }
  });

  // ---- what the draft means
  const prices = () => app.view().prices;
  const stock = g => app.state.stock[g] ?? 0;
  const homePrice = g => prices()[home]?.[g]?.p ?? null;
  const carriable = () => Object.keys(stop.sells ?? {}).filter(g => stock(g) > 0 || homeStop?.sells?.[g]);
  const cargoTotal = () => Object.values(draft.cargo).reduce((n, x) => n + x, 0);
  // the sheet never prices a trip itself: checkPlan's cost is the one function `outfit` charges by (MER-72)
  const quote = () => engine.checkPlan(app.state, content, plan()).cost;
  const buyNow = () => quote()?.bought ?? 0;
  const outgoing = () => buyNow() + draft.purse;
  const agent = () => (content.agents ?? []).find(a => a.id === draft.agent);
  const qirad = content.city.contracts?.qirad;
  // the way back (ARCH 4.11): an agent who will not go for a wage again, where no qirad can be offered, goes if the house pays the wage first
  const prepayOffered = () => { const a = agent(); return !!a && !qirad?.agentShare && !!refusesOwn(app.state, a, false); };
  const prepayWage = () => engine.prepayCost(app.state, content, engine.routeFor(app.state, content, stopId, agent())?.route.id, draft.agent);
  function plan() {
    const hit = engine.routeFor(app.state, content, stopId);
    const cargo = Object.fromEntries(Object.entries(draft.cargo).filter(([, n]) => n > 0));
    const p = { agent: draft.agent ?? undefined, route: hit?.route.id, cargo, purse: draft.purse, contract: draft.contract === 'prepay' ? 'own' : draft.contract };
    if (draft.contract === 'qirad') p.partners = draft.partners;
    if (draft.contract === 'prepay' && prepayOffered()) p.prepay = true;
    return p;
  }
  function sendState() {
    const leg = firstLegState(app, stopId);
    if (!freeAgents(app).length) return { ok: false, reasons: ['Nobody is free to go.'] };
    if (!leg) return { ok: false, reasons: [`No road leads to ${stop.name} yet.`] };
    if (!leg.open) return { ok: false, reasons: [`The road to ${stop.name} is closed until ${leg.next ?? 'later'}.`] };
    const c = engine.checkPlan(app.state, content, plan());
    return { ok: c.ok, reasons: c.reasons };
  }

  // ---- sections
  const section = (id, title, ...body) => h('section', { class: 'step', id: `outfit-${id}`, 'aria-labelledby': `outfit-${id}-h` },
    h('h3', { id: `outfit-${id}-h`, tabindex: '-1' }, title), ...body);
  const changeLink = (id, onclick, what) => h('button', { class: 'change', type: 'button', id: `change-${id}`, 'aria-label': `Change: ${what}`, onclick }, 'Change');
  const summary = (id, text, onclick, what) => h('p', { class: 'summary' }, h('span', { id: `summary-${id}` }, text), ' ', changeLink(id, onclick, what));

  function whoSection() {
    const free = freeAgents(app);
    if (!free.length) {
      const card = (content.agents ?? []).map(a => a.hireCard).filter(Boolean).find(id => app.state.desk.some(p => p.state === 'open' && p.ref === id));
      return section('who', '1. Who goes',
        h('p', { class: 'none', id: 'outfit-nobody' }, card ? 'Hire someone first. ' : 'Agents ask for work at the start of a season.',
          card ? h('a', { href: '#desk', id: 'outfit-hire-link', onclick: e => { e.preventDefault(); onDesk(); } }, 'A card on your desk offers someone.') : null));
    }
    const a = agent();
    if (!expanded('who') && a) return section('who', '1. Who goes', summary('who', `${a.name} (${traitWords(app, a)}).`, () => { open.add('who'); render('outfit-who-h'); }, 'who goes'));
    return section('who', '1. Who goes', h('div', { class: 'agents', role: 'radiogroup', 'aria-labelledby': 'outfit-who-h' },
      free.map(ag => {
        const on = ag.id === draft.agent, trust = app.view().trust[ag.id];
        return h('button', { class: 'agent', type: 'button', role: 'radio', id: `agent-${ag.id}`, dataset: { key: `agent-${ag.id}` }, 'aria-checked': on ? 'true' : 'false',
          tabindex: on || (!draft.agent && ag === free[0]) ? '0' : '-1',
          onclick: () => { draft.agent = ag.id; render(`agent-${ag.id}`); },
          onkeydown: e => {
            const i = free.indexOf(ag), d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (d === undefined) return;
            e.preventDefault();
            const to = free[(i + d + free.length) % free.length];
            draft.agent = to.id; render(`agent-${to.id}`);
          } },
        seal(app, ag.seal),
        h('span', { class: 'agent-text' }, h('strong', null, ag.name), h('span', { class: 'traits' }, traitWords(app, ag)),
          h('span', { class: 'trust' }, `${ag.name} ${trust?.words ?? ''}.`)));
      })));
  }

  function whereSection() {
    const hit = engine.routeFor(app.state, content, stopId);
    const v = app.view();
    if (!hit) {
      const f = firstLegState(app, stopId);
      return section('where', `2. Where: ${stop.name}`, h('p', { class: 'none', id: 'outfit-noroad' },
        f ? `The road to ${stop.name} is closed until ${f.next ?? 'later'}.` : `No road leads to ${stop.name} yet.`));
    }
    const total = `About ${words(hit.seasons)} ${plural(hit.seasons, 'season', 'seasons')} out and back.`;
    if (!expanded('where')) {
      return section('where', `2. Where: ${stop.name}`, summary('where', `${homeStop.name} to ${stop.name}. ${total}`, () => onCancel(), 'where'));
    }
    return section('where', `2. Where: ${stop.name}`,
      h('ol', { class: 'legs' }, hit.route.legs.map((leg, i) => h('li', null,
        `${stopName(content, leg.from)} to ${stopName(content, leg.to)} by ${VESSEL[leg.by] ?? leg.by}, ${words(leg.seasons)} ${plural(leg.seasons, 'season', 'seasons')}. Starts in ${opensWords(leg)}.`,
        i === 0 ? h('span', { class: leg.opens.includes(v.season) ? 'now open' : 'now closed' }, leg.opens.includes(v.season) ? ' Open this season.' : ' Closed this season.') : null))),
      h('p', { class: 'total', id: 'outfit-time' }, total),
      ...hit.warnings.map(w => h('p', { class: 'warn' }, w)));
  }

  function carrySection() {
    const goods = carriable();
    const there = prices()[stopId] ?? {};
    const parts = Object.entries(draft.cargo).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${unitOf(content, g, n)} of ${goodName(content, g)}`);
    const line = parts.length ? parts.join(' and ') : 'no goods';
    if (!expanded('carry')) {
      return section('carry', '3. What they carry', summary('carry', `${cap(line)}${draft.purse ? `, and ${dinars(draft.purse)} to buy with` : ''}.`, () => { open.add('carry'); render('outfit-carry-h'); }, 'what they carry'), costSheet(quote()));
    }
    const rows = goods.map(g => {
      const have = stock(g), p = homePrice(g), n = draft.cargo[g] ?? 0;
      const max = have + (p ? Math.max(0, Math.floor(app.state.money / p)) : 0);
      const far = there[g], guess = expectedPrice(app.state, content, stopId, g);
      const farText = far?.p == null ? `No news of what ${goodName(content, g)} fetches in ${stop.name}.`
        : `${stop.name} paid ${num(far.p)} (${far.written}, ${far.ageWords}).`;
      const mightText = far?.p == null || !guess ? null : `${cap(goodName(content, g))} might sell for about ${num(guess.p)} there.`;
      return h('li', { class: 'good' },
        h('div', { class: 'good-text' }, h('strong', null, cap(goodName(content, g))),
          h('span', null, `${have} in the warehouse${homeStop?.sells?.[g] && p ? `. More at ${num(p)} ${plural(p, 'dinar', 'dinars')} each in ${homeStop.name}` : ''}.`),
          h('span', { class: 'far' }, farText),
          mightText ? h('span', { class: 'might' }, mightText) : null),
        stepper({ key: `cargo-${g}`, label: `${cap(goodName(content, g))}, ${unitOf(content, g, 2)} to send`, value: Math.min(n, max), min: 0, max: Math.max(max, n),
          text: `${n} ${unitOf(content, g, n)}`, onChange: v2 => { draft.cargo[g] = v2; render(`step-cargo-${g}`); } }));
    });
    const cost = quote();
    return section('carry', '3. What they carry',
      goods.length ? h('ul', { class: 'goods' }, rows) : h('p', { class: 'none' }, `${stop.name} trades in nothing the house holds or ${homeStop.name} sells.`),
      h('div', { class: 'good purse' },
        h('div', { class: 'good-text' }, h('strong', null, 'Money to buy with on the way'), h('span', null, `The house has ${dinars(app.state.money)}.`)),
        stepper({ key: 'purse', label: 'Money to buy with on the way', value: draft.purse, min: 0, max: Math.max(app.state.money, draft.purse), step: 50, fine: 10, big: 250,
          text: dinars(draft.purse), onChange: v2 => { draft.purse = v2; render('step-purse'); } }),
        typedBox({ key: 'purse', label: 'Money to buy with on the way, typed in dinars', value: draft.purse, say: app.say, onChange: v2 => { draft.purse = v2; render('typed-purse'); } })),
      h('p', { class: 'total', id: 'outfit-total' }, `In all: ${line}${draft.purse ? ` and ${dinars(draft.purse)}` : ''}.`),
      costSheet(cost));
  }

  /** What the trip takes, line by line, from the engine's own pricing: the sum at the foot is what Send takes. */
  function costSheet(cost) {
    if (!cost) return null;
    const rows = [];
    for (const g of cost.goods) {
      const nm = goodName(content, g.good);
      rows.push([`${g.loads} ${unitOf(content, g.good, g.loads)} of ${nm}: ${g.fromWarehouse} from the warehouse${g.bought ? `, ${g.bought} bought in ${homeStop.name}` : ''}`, g.cost]);
    }
    if (draft.purse) rows.push(['Money to buy with on the way', cost.purse]);
    if (cost.partners) rows.push([`Put in by the partners`, -cost.partners]);
    if (cost.wagePaid) rows.push([`${agent()?.name ?? 'The agent'}'s wage, paid first`, cost.wagePaid]);
    const later = [];
    if (cost.later?.wage) later.push(`${agent()?.name ?? 'The agent'}'s wage, about ${dinars(cost.later.wage)} (${dinars(cost.later.wagePerSeason)} a season out), is paid when the trip comes home.`);
    if (cost.later?.tolls) later.push(`Tolls along the road come to about ${dinars(cost.later.tolls)}, paid from the money and goods sent.`);
    return h('div', { class: 'costs', id: 'outfit-costs' },
      h('p', { class: 'total', id: 'outfit-costs-h' }, h('strong', null, 'What Send takes from the house')),
      h('ul', { class: 'goods', 'aria-labelledby': 'outfit-costs-h' },
        rows.map(([text, n]) => h('li', { class: 'good' }, h('div', { class: 'good-text' }, h('span', null, text)), h('strong', { class: 'amount' }, n < 0 ? `−${dinars(-n)}` : dinars(n))))),
      h('p', { class: 'total', id: 'outfit-cost-total' }, `Send takes ${dinars(cost.total)}. The house has ${dinars(app.state.money)}.`),
      ...later.map(t => h('p', { class: 'total cost-later' }, t)));
  }

  function contractSection() {
    const a = agent(), who = a?.name ?? 'The agent';
    const share = qirad?.agentShare;
    const out = outgoing();
    const ids = ['own', ...(share ? ['qirad'] : []), ...(prepayOffered() ? ['prepay'] : [])];
    const choice = (id, label, text) => h('button', { class: 'contract', type: 'button', role: 'radio', id: `contract-${id}`, dataset: { key: `contract-${id}` },
      'aria-checked': draft.contract === id ? 'true' : 'false', tabindex: draft.contract === id ? '0' : '-1',
      onclick: () => { draft.contract = id; render(`contract-${id}`); },
      onkeydown: e => {
        const fwd = ['ArrowDown', 'ArrowRight'].includes(e.key), back = ['ArrowUp', 'ArrowLeft'].includes(e.key);
        if ((fwd || back) && ids.length > 1) { e.preventDefault(); const to = ids[(ids.indexOf(id) + (fwd ? 1 : ids.length - 1)) % ids.length]; draft.contract = to; render(`contract-${to}`); }
      } },
    h('strong', null, label), h('span', null, text));
    const own = choice('own', 'Your own money', 'The house keeps all the profit and carries all the loss.');
    const kids = [own];
    if (share) {
      kids.push(choice('qirad', 'A qirad with partners',
        `A qirad: partners share the cost, and ${who} keeps a share of the profit. ${who} keeps ${shareWords(share)} of the profit. If the cargo is lost, the partners lose their part.`));
    }
    if (ids.includes('prepay')) {
      const wage = prepayWage();
      kids.push(choice('prepay', 'Pay the wage first',
        `${who} will not go for a wage again, because the house did not pay what it promised before. If the house pays the whole trip's wage now${wage ? `, ${dinars(wage)}` : ''}, ${who} will go. A full return, with nothing owed, wins back some of ${who}'s trust.`));
    }
    const body = [h('div', { class: 'contracts', role: 'radiogroup', 'aria-labelledby': 'outfit-contract-h' }, kids)];
    if (draft.contract === 'qirad') {
      if (!draft.partnersSet) draft.partners = Math.floor(out / 2);
      body.push(h('div', { class: 'good partners' },
        h('div', { class: 'good-text' }, h('strong', null, 'What the partners put in'), h('span', null, `Out of the ${dinars(out)} that goes in money and bought goods.`)),
        stepper({ key: 'partners', label: 'What the partners put in', value: Math.min(draft.partners, out), min: 0, max: out, step: 50, fine: 10, big: 250, text: dinars(Math.min(draft.partners, out)),
          onChange: v2 => { draft.partners = v2; draft.partnersSet = true; render('step-partners'); } }),
        typedBox({ key: 'partners', label: 'What the partners put in, typed in dinars', value: Math.min(draft.partners, out), say: app.say,
          onChange: v2 => { draft.partners = Math.min(v2, out); draft.partnersSet = true; render('typed-partners'); } })));
    }
    return section('contract', '4. The contract', ...body);
  }

  // ---- drawing
  function render(focusKey) {
    if (draft.contract === 'prepay' && !prepayOffered()) draft.contract = 'own';
    if (draft.contract === 'qirad' && draft.partnersSet) draft.partners = Math.min(draft.partners, outgoing());
    const a = agent(), s = sendState();
    const label = a ? `Send ${a.name} to ${stop.name}` : `Send someone to ${stop.name}`;
    const send = h('button', { class: 'button primary send', type: 'button', id: 'outfit-send', dataset: { key: 'outfit-send' }, 'aria-disabled': s.ok ? 'false' : 'true',
      'aria-describedby': 'outfit-reasons', onclick: () => doSend() }, label);
    const reasons = h('div', { class: 'reasons', id: 'outfit-reasons' }, s.ok ? null : s.reasons.map(r => h('p', null, r)));
    // the sheet tells the one-press player what is on it, once
    const lead = onePress ? h('p', { class: 'lead', id: 'outfit-lead' }, `Everything is filled in. Press Send, or change a line.`) : null;
    dialog.replaceChildren(
      h('h2', { id: titleId, tabindex: '-1' }, `Outfit an expedition to ${stop.name}`),
      ...[lead, whoSection(), whereSection(), carrySection(), first ? null : contractSection()].filter(Boolean),
      h('div', { class: 'send-row' }, reasons, h('div', { class: 'panel-actions' },
        h('button', { class: 'button', type: 'button', id: 'outfit-cancel', onclick: () => onCancel() }, 'Back to the map'), send)));
    if (focusKey) {
      const el = document.getElementById(focusKey) ?? qs(`[data-key="${focusKey}"]`, dialog);
      el?.focus();
    }
  }

  function doSend() {
    if (sending) return;
    const s = sendState();
    if (!s.ok) { app.say(s.reasons.join(' ')); return; }
    const a = agent();
    sending = true;
    try { app.act(st => engine.outfit(st, content, plan())); }
    catch (e) { sending = false; qs('#outfit-reasons', dialog).replaceChildren(...(e.reasons ?? [e.message]).map(r => h('p', null, r))); return; }
    onSent({ agent: a, stop });
  }

  render(null);
  return { dialog, render, destroy() { dialog.remove(); } };
}
