// Effects (ARCHITECTURE 5.6): a closed list, each a one-key object plus its arguments.
// apply(state, content, effect, ctx) changes `state` in place, so call it on a clone.
// ctx: { agent } for "$agent", { expedition } for an order, { later: true } for a card.
// A later effect also carries { at } (its own season, so "now" means the season it fires
// for, MER-07) and { from } (the choice that queued it, kept as the flag "from:<card>");
// { dry: true } is a trial run that checks references and puts no paper on the desk.
// Anything not in the table throws, and so does a good, stop, agent or card that is not
// in the content.
import { seasonIndex } from './calendar.js';
import { find, addPaper, REP_GROUPS } from './state.js';

const ARGS = {
  money: [], stock: ['by'], rep: ['by'], trust: ['by'], memory: ['kind'],
  flag: ['set', 'clear'], price: ['good', 'by'], loan: [], hire: [], dismiss: [],
  card: [], unlock: [], order: [],
};
export const EFFECT_KEYS = Object.keys(ARGS);

/** The season an effect means by "now": its own, when it is a later effect firing. */
const nowOf = (state, content, ctx) => ctx.at ?? seasonIndex(state, content);
const clamp3 = n => Math.max(-3, Math.min(3, n));
const whole = (n, what) => { if (!Number.isInteger(n)) throw new Error(`effect ${what}: ${n} is not a whole number`); return n; };

function agentId(state, ref, ctx) {
  const id = ref === '$agent' ? ctx.agent : ref;
  if (!id) throw new Error('effect: "$agent" used on a paper with no agent');
  if (!state.agents[id]) throw new Error(`unknown agent "${id}"`);
  return id;
}

const nameOf = (content, id) => (content.agents ?? []).find(a => a.id === id)?.name ?? id;

/** The agent a trust or memory effect names. A queued effect (it fires seasons after the choice) that
    names an agent who has since left throws, so `fireDue` drops the item and logs it; a trial run
    of the same effect at the choice does not, since the agent was there when it was chosen. */
function stayedId(state, content, ref, ctx, what) {
  const id = agentId(state, ref, ctx);
  if (ctx.later && !ctx.dry && state.agents[id].where === 'gone') throw new Error(`${nameOf(content, id)} has left the house, so their ${what} cannot change`);
  return id;
}

/** Structure check only: returns the effect's head key or throws. */
export function check(effect) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) throw new Error('effect must be an object');
  const heads = Object.keys(effect).filter(k => k in ARGS);
  if (heads.length !== 1) throw new Error(`effect ${JSON.stringify(effect)}: needs exactly one of ${EFFECT_KEYS.join(', ')}`);
  const head = heads[0];
  for (const k of Object.keys(effect)) {
    if (k !== head && !ARGS[head].includes(k)) throw new Error(`effect ${head}: unknown key "${k}"`);
  }
  return head;
}

export function apply(state, content, effect, ctx = {}) {
  const head = check(effect);
  const v = effect[head];

  switch (head) {
    case 'money':
      state.money += whole(v, 'money');
      return;
    case 'stock': {
      find(content.goods, v, 'good');
      const n = (state.stock[v] ?? 0) + whole(effect.by, 'stock');
      if (n > 0) state.stock[v] = n; else delete state.stock[v];
      return;
    }
    case 'rep':
      if (!REP_GROUPS.includes(v)) throw new Error(`unknown reputation group "${v}"`);
      state.rep[v] = clamp3(state.rep[v] + whole(effect.by, 'rep'));
      return;
    case 'trust': {
      const a = state.agents[stayedId(state, content, v, ctx, 'trust')];
      a.trust = clamp3(a.trust + whole(effect.by, 'trust'));
      return;
    }
    case 'memory':
      if (typeof effect.kind !== 'string') throw new Error('effect memory: needs a kind');
      state.agents[stayedId(state, content, v, ctx, 'memory')].memory.push({ at: nowOf(state, content, ctx), kind: effect.kind });
      return;
    case 'flag':
      if (typeof v !== 'string') throw new Error('effect flag: needs a name');
      if (effect.clear) { delete state.flags[v]; return; }
      if (!('set' in effect)) throw new Error(`effect flag "${v}": needs set or clear`);
      state.flags[v] = effect.set === 'now' ? nowOf(state, content, ctx) : effect.set;
      return;
    case 'price': {
      find(content.stops, v, 'stop');
      const m = state.market[v]?.[effect.good];
      if (!m) throw new Error(`stop "${v}" does not trade "${effect.good}"`);
      if (!(effect.by > 0)) throw new Error('effect price: by must be above 0');
      m.f *= effect.by;
      return;
    }
    case 'loan': {
      const keys = Object.keys(v);
      for (const k of keys) if (!['from', 'principal', 'in', 'rate'].includes(k)) throw new Error(`effect loan: unknown key "${k}"`);
      for (const k of ['from', 'principal', 'in', 'rate']) if (!(k in v)) throw new Error(`effect loan: needs ${k}`);
      const at = nowOf(state, content, ctx);
      const n = state.loans.filter(l => l.from === v.from).length + 1;
      state.loans.push({ id: `${v.from}-${n}`, from: v.from, principal: whole(v.principal, 'loan'), due: at + whole(v.in, 'loan'), rate: v.rate });
      state.money += v.principal;
      return;
    }
    case 'hire': {
      const id = agentId(state, v, ctx);
      if (state.agents[id].where === 'gone') throw new Error(`${nameOf(content, id)} has gone to work for another house and cannot be hired again`);
      state.agents[id].hired = true;
      return;
    }
    case 'dismiss':
      state.agents[agentId(state, v, ctx)].hired = false;
      return;
    case 'card':
      if (!ctx.later) throw new Error('effect card: only inside a later effect');
      find(content.cards, v, 'card');
      if (ctx.dry) return;
      // follow-ups go first, in firing order; the caller numbers them (id null until then)
      if (!addPaper(state, { kind: 'card', ref: v, ...(ctx.agent ? { agent: ctx.agent } : {}), ...(ctx.expedition ? { expedition: ctx.expedition } : {}) }, { first: true })) {
        throw new Error(`effect card: the desk already holds the most papers it can ("${v}" has no room)`);
      }
      if (ctx.from !== undefined) state.flags[`from:${v}`] = ctx.from;
      return;
    case 'unlock':
      if (typeof v !== 'string') throw new Error('effect unlock: needs an entry id');
      if (!state.notebook.includes(v)) state.notebook.push(v);
      return;
    case 'order': {
      const x = ctx.expedition && state.expeditions.find(e => e.id === ctx.expedition);
      if (!x) throw new Error('effect order: only on a letter from an expedition on the road');
      x.orders.push(structuredClone(v));
      return;
    }
  }
}

export function applyAll(state, content, effects, ctx = {}) {
  for (const e of effects ?? []) apply(state, content, e, ctx);
}
