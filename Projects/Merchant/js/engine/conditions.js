// Conditions (ARCHITECTURE 5.6): { all }, { any } and the leaves below. A card's `when`
// and a choice's `requires` use the same ones. An unknown key throws, so a typo in
// content is an error and not a condition that quietly never holds.
//
// A letter's `when` (ARCHITECTURE 5.7) also reads the expedition the letter would come from:
// `leg` ({ by }: it is riding a leg of that vessel), `at` (a stop: it is standing there, waiting
// or about to leave) and `trait` (its agent has it). They take the expedition as a fourth
// argument to `holds`; used with none they throw, so a card cannot use one by mistake.
import { seasonIndex, seasonName, year, actOf, SEASONS } from './calendar.js';
import { REP_GROUPS } from './state.js';
import { legSeasons, refusesAny } from './agents.js';
import { destinations } from './routes.js';

const LEAVES = {
  season: [], year: [], act: [], length: [], notebook: [], out: [], money: [],
  stock: ['gte'],
  flag: ['not', 'gte'],
  rep: ['gte', 'lte'],
  agent: ['hired', 'where'],
  leg: [], at: [], trait: [],
  trip: [],
};

const routeOf = (content, id) => (content.routes ?? []).find(r => r.id === id);

/** Where an expedition is for a letter: { leg, stop, standing } or null when it is home, done,
    or on a road the content does not have. `standing` is true when it is at a stop (waiting
    there, or leaving it this season and not yet a season down the road); the letter is then
    written at the leg's `from`. Riding, it is written at the stop it is riding to. */
export function placeOf(content, x) {
  const route = routeOf(content, x?.route);
  const leg = route?.legs?.[x.leg];
  if (!leg || x.status === 'home') return null;
  const agent = (content.agents ?? []).find(a => a.id === x.agent);
  const standing = x.status === 'waiting' || x.left >= legSeasons(agent, leg);
  return { leg: x.leg, by: leg.by, stop: standing ? leg.from : leg.to, standing };
}

// ---------------------------------------------------------------------------------------------
// The `trip` leaf (ARCHITECTURE 4.12): `{ trip: { agent, is } }` holds when that agent has a trip in the
// state `is` names. A card that tells of a trip carries it, and its words are filled from the trip.

export const TRIP_STATES = ['home', 'out', 'ready'];
const agentOf = (content, id) => (content.agents ?? []).find(a => a.id === id);
const stopName = (content, id) => (content.stops ?? []).find(x => x.id === id)?.name ?? id;
const goodName = (content, id) => ((content.goods ?? []).find(g => g.id === id)?.name ?? id).toLowerCase();
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** The good a cargo is mostly made of: the most loads, the first listed on a tie. */
const mainGood = cargo => Object.entries(cargo ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/** What a trip is, in the four words a card may use. `to` and `good` are ids (or null), `seasons` a number. */
const trip = (content, agent, route, to, good, seasons, x) => ({
  agent, expedition: x ?? null, route: route.id, to, good, seasons,
  from: stopName(content, route.legs?.[0]?.from ?? content.city?.home), });

/** The trip `agent` has in state `is`, or null. `home`: a return paper for the agent is on the desk
    (the opening brought them home this season). `out`: an expedition of theirs is on the road.
    `ready`: hired, at home, on no expedition, and the nearest stop the house holds something to sell to
    gives the plan. { agent, expedition, route, to, good, seasons, from } */
export function tripOf(state, content, agent, is) {
  const a = agentOf(content, agent), idx = seasonIndex(state, content);
  if (!a || !state.agents[agent]) return null;
  if (is === 'home') {
    const p = state.desk.find(q => q.kind === 'return' && q.agent === agent && q.expedition);
    const sent = p && state.log.find(e => e.kind === 'outfit' && e.ref === p.expedition);
    const route = sent && routeOf(content, sent.choice);
    if (!route) return null;
    // the return paper writes where the agent turned back and what was sent, in words; read them back by name
    const head = p.data?.headline ?? '', sentOut = (p.data?.account ?? []).find(r => r.label === 'Sent out')?.text ?? '';
    const turned = (content.stops ?? []).find(s => head.startsWith(`${a.name} came home from ${s.name}.`))?.id ?? route.to;
    const good = (content.goods ?? []).map(g => ({ id: g.id, at: sentOut.indexOf(` of ${g.name.toLowerCase()}`) })).filter(g => g.at >= 0).sort((u, v) => u.at - v.at)[0]?.id ?? null;
    return trip(content, agent, route, turned, good, idx - sent.at, p.expedition);
  }
  if (is === 'out') {
    const x = state.expeditions.find(e => e.agent === agent && e.status !== 'home');
    const route = x && routeOf(content, x.route);
    if (!route) return null;
    return trip(content, agent, route, x.book?.turned ?? route.to, mainGood(x.book?.cargo ?? x.cargo), idx - x.sent, x.id);
  }
  if (is === 'ready') {
    const rec = state.agents[agent];
    if (!rec.hired || rec.where !== content.city?.home || state.expeditions.some(e => e.agent === agent) || refusesAny(state, a)) return null;
    for (const d of destinations(state, content, a).sort((u, v) => u.seasons - v.seasons)) {
      const stop = (content.stops ?? []).find(s => s.id === d.stop);
      const goods = Object.keys(state.stock).filter(g => stop.sells?.[g] && state.stock[g] > 0).sort((u, v) => state.stock[v] - state.stock[u] || (u < v ? -1 : 1));
      if (goods.length) return trip(content, agent, routeOf(content, d.route), d.stop, goods[0], d.seasons, null);
    }
  }
  return null;
}

/** The `trip` leaf of a card's `when`, at the top or inside a top-level `all`; null when it has none. */
export function tripLeaf(when) {
  if (!when || typeof when !== 'object') return null;
  if ('trip' in when) return when.trip;
  if (Array.isArray(when.all)) for (const c of when.all) if (c && typeof c === 'object' && 'trip' in c) return c.trip;
  return null;
}

const SLOTS = /\{(agent|to|good|route|seasons)\}/g;
export const hasSlots = text => typeof text === 'string' && /\{(agent|to|good|route|seasons)\}/.test(text);

/** The text with its slots filled from trip `t` ({ agent, ... } from `tripOf`). */
export function fillTrip(content, text, t) {
  const words = {
    agent: agentOf(content, t.agent)?.name ?? t.agent,
    to: t.to ? stopName(content, t.to) : 'the road',
    good: t.good ? goodName(content, t.good) : 'goods',
    route: t.to ? `${t.from} to ${stopName(content, t.to)}` : 'the road',
    seasons: t.seasons === undefined || t.seasons === null ? 'some seasons' : `${NUMBER_WORDS[t.seasons] ?? t.seasons} ${t.seasons === 1 ? 'season' : 'seasons'}`,
  };
  return typeof text === 'string' ? text.replace(SLOTS, (_, k) => words[k]) : text;
}

/** For view(): the filled words of every card on the desk that tells of a trip, by paper id:
    { title, body, choices: { id: { label, hint } }, trip }. A paper whose trip has since changed state (the
    player sent the agent out while the card lay on the desk) is filled from the state the agent is in now. */
export function describeTrips(state, content) {
  const out = {};
  for (const p of state.desk) {
    if (p.kind !== 'card' || p.id === null) continue;
    const card = (content.cards ?? []).find(c => c.id === p.ref);
    const leaf = tripLeaf(card?.when);
    if (!leaf) continue;
    const t = [leaf.is, ...TRIP_STATES].map(is => tripOf(state, content, leaf.agent, is)).find(Boolean) ?? { agent: leaf.agent };
    out[p.id] = {
      title: fillTrip(content, card.title, t), body: fillTrip(content, card.body, t), trip: t,
      choices: Object.fromEntries((card.choices ?? []).map(c => [c.id, { label: fillTrip(content, c.label, t), hint: fillTrip(content, c.hint, t) }])),
    };
  }
  return out;
}

function only(cond, allowed, where) {
  for (const k of Object.keys(cond)) if (!allowed.includes(k)) throw new Error(`condition ${where}: unknown key "${k}"`);
}

function bounds(v, spec, where) {
  if (v === undefined || v === null || typeof v !== 'object') throw new Error(`condition ${where}: needs { gte } or { lte }`);
  only(v, ['gte', 'lte'], where);
  for (const k of ['gte', 'lte']) if (v[k] !== undefined && !isNum(v[k])) bad(`${where} ${k}`, 'a number', v[k]);
  return (v.gte === undefined || spec >= v.gte) && (v.lte === undefined || spec <= v.lte);
}

const isNum = n => typeof n === 'number' && Number.isFinite(n);
const isStr = s => typeof s === 'string' && s !== '';
const bad = (head, want, v) => { throw new Error(`condition ${head}: needs ${want}, got ${JSON.stringify(v)}`); };

/** Throws when a leaf's value has the wrong type, so a typo in content is an error and not a
    condition that quietly never (or always) holds. */
function typed(cond, head) {
  const v = cond[head];
  switch (head) {
    case 'season': if (!Array.isArray(v) || !v.length || !v.every(x => SEASONS.includes(x))) bad(head, `a list of season names (${SEASONS.join(', ')})`, v); break;
    case 'year': if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) bad(head, 'a [from, to] pair of numbers', v); break;
    case 'act': if (!Number.isInteger(v)) bad(head, 'a whole number', v); break;
    case 'length': case 'notebook': case 'stock': case 'flag': case 'rep': case 'agent': case 'at': case 'trait': if (!isStr(v)) bad(head, 'a name', v); break;
    case 'trip': if (!v || typeof v !== 'object' || Array.isArray(v)) bad(head, '{ agent, is }', v); only(v, ['agent', 'is'], 'trip'); if (!isStr(v.agent)) bad('trip agent', 'an agent id', v.agent); if (!TRIP_STATES.includes(v.is)) bad('trip is', `one of ${TRIP_STATES.join(', ')}`, v.is); break;
    case 'leg': if (!v || typeof v !== 'object' || Array.isArray(v)) bad(head, '{ by: vessel }', v); only(v, ['by'], 'leg'); if (!isStr(v.by)) bad('leg by', 'a vessel name', v.by); break;
  }
  for (const k of ['gte', 'lte']) if (head !== 'money' && head !== 'out' && cond[k] !== undefined && !isNum(cond[k])) bad(`${head} ${k}`, 'a number', cond[k]);
  if (cond.not !== undefined && typeof cond.not !== 'boolean') bad(`${head} not`, 'true or false', cond.not);
  if (cond.hired !== undefined && typeof cond.hired !== 'boolean') bad(`${head} hired`, 'true or false', cond.hired);
  if (cond.where !== undefined && !isStr(cond.where)) bad(`${head} where`, 'a name', cond.where);
}

/** True or false for one condition. `cond` may be undefined (no condition: true). */
export function holds(cond, state, content, x) {
  if (cond === undefined || cond === null) return true;
  if (typeof cond !== 'object' || Array.isArray(cond)) throw new Error('condition must be an object');
  if ('all' in cond) { only(cond, ['all'], 'all'); return cond.all.every(c => holds(c, state, content, x)); }
  if ('any' in cond) { only(cond, ['any'], 'any'); return cond.any.some(c => holds(c, state, content, x)); }

  const heads = Object.keys(cond).filter(k => k in LEAVES);
  if (heads.length !== 1) throw new Error(`condition ${JSON.stringify(cond)}: needs exactly one of ${Object.keys(LEAVES).join(', ')}`);
  const head = heads[0];
  only(cond, [head, ...LEAVES[head]], head);
  typed(cond, head);
  const v = cond[head];
  const idx = seasonIndex(state, content);
  if ((head === 'leg' || head === 'at' || head === 'trait') && !x) throw new Error(`condition ${head}: only a letter's "when" has an expedition to read`);

  switch (head) {
    case 'season': return v.includes(seasonName(idx));
    case 'year': { const y = year(content.calendar, idx); return y >= v[0] && y <= v[1]; }
    case 'act': return actOf(state, content) === v;
    case 'length': return state.length === v;
    case 'notebook': return state.notebook.includes(v);
    case 'out': return bounds(v, state.expeditions.length, 'out');
    case 'money': return bounds(v, state.money, 'money');
    case 'stock': {
      if (cond.gte === undefined) throw new Error('condition stock: needs gte');
      return (state.stock[v] ?? 0) >= cond.gte;
    }
    case 'flag': {
      let r = v in state.flags;
      if (cond.gte !== undefined) r = typeof state.flags[v] === 'number' && state.flags[v] >= cond.gte;
      return cond.not ? !r : r;
    }
    case 'rep': {
      if (!REP_GROUPS.includes(v)) throw new Error(`condition rep: unknown group "${v}"`);
      const n = state.rep[v];
      return (cond.gte === undefined || n >= cond.gte) && (cond.lte === undefined || n <= cond.lte);
    }
    case 'leg': { const p = placeOf(content, x); return !!p && !p.standing && p.by === v.by; }
    case 'at': { const p = placeOf(content, x); return !!p && p.standing && p.stop === v; }
    case 'trip': return !!tripOf(state, content, v.agent, v.is);
    case 'trait': return ((content.agents ?? []).find(a => a.id === x.agent)?.traits ?? []).includes(v);
    case 'agent': {
      const a = state.agents[v];
      if (!a) throw new Error(`condition agent: unknown agent "${v}"`);
      if (a.where === 'gone') return false;   // a person who has left answers no card, whatever it asks of them (MER-61c)
      return (cond.hired === undefined || a.hired === cond.hired) && (cond.where === undefined || a.where === cond.where);
    }
  }
}
