// The save (ARCHITECTURE 8). The only file in the game that spells a storage key.
//
//   merchant-save      the game, version 1   (locked decision #36: never changes)
//   merchant-settings  the settings, version 1 (same)
//
// `validate` and `migrate` are pure and know no content. `repair` needs the content, so the
// slots are built by makeSlots(content) once the content has loaded.
import { createSaveSlot } from '../../../assets/js/gvb-save.js';
import { playedSeasons } from './engine/calendar.js';
import { freshState, REP_GROUPS, SAVE_VERSION, MAX_PAPERS } from './engine/state.js';

export const SAVE_KEY = 'merchant-save';
export const SETTINGS_KEY = 'merchant-settings';
export const SETTINGS_VERSION = 1;
export const PHASES = ['desk', 'interlude', 'recall', 'ended'];
export const REDUCE_MOTION = ['on', 'off', 'device'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = v => typeof v === 'string' && v !== '';

/** A whole number in lo..hi, or `fallback` when v is not a number at all. */
function int(v, lo, hi, fallback) {
  if (!isNum(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
const count = (v, fallback = 0) => int(v, 0, Number.MAX_SAFE_INTEGER, fallback);
const idSet = list => new Set((Array.isArray(list) ? list : []).filter(isObject).map(x => x.id));

// ---- validate and migrate (ARCHITECTURE 8.2)

/** A plain object with a numeric `t` and a string `city`. Anything else is refused and the
    player starts fresh. `phase` is not checked here: a stray phase should not cost a player
    the game, so `repair` turns an unknown one into "desk" (DECISIONS 2026-11-17 01:28). */
export function validate(s) {
  return isObject(s) && isNum(s.t) && typeof s.city === 'string';
}

/** Version drift only (#37), one step per version. A version-0 blob is one written before the
    schema carried a `v` field; the only change in the step to 1 is the field itself.
    A save from a newer build throws, which the slot reads as "refused". */
export function migrate(state, from) {
  if (!isObject(state)) throw new Error('migrate: a save is an object');
  if (from > SAVE_VERSION) throw new Error(`migrate: save version ${from} is newer than this build (${SAVE_VERSION})`);
  const s = structuredClone(state);
  if (from < 1) s.v = 1;
  return s;
}

// ---- repair (ARCHITECTURE 8.3)

function repairMarket(m, fresh, stops, goods) {
  const out = {};
  for (const stop of stops) {
    out[stop] = {};
    const have = isObject(m?.[stop]) ? m[stop] : {};
    for (const g of Object.keys(fresh[stop] ?? {})) {
      const e = isObject(have[g]) ? have[g] : {};
      out[stop][g] = { ...e, f: isNum(e.f) && e.f > 0 ? e.f : fresh[stop][g].f, glut: isNum(e.glut) ? Math.max(-0.3, e.glut) : 0 };
    }
    // goods a stop sells in the save but not in the fresh state stay only if the content has the good
    for (const g of Object.keys(have)) {
      if (!out[stop][g] && goods.has(g) && isObject(have[g])) {
        out[stop][g] = { ...have[g], f: isNum(have[g].f) && have[g].f > 0 ? have[g].f : 1, glut: isNum(have[g].glut) ? Math.max(-0.3, have[g].glut) : 0 };
      }
    }
  }
  return out;
}

function repairKnown(k, stops, goods) {
  const out = {};
  if (!isObject(k)) return out;
  for (const [stop, byGood] of Object.entries(k)) {
    if (!stops.has(stop) || !isObject(byGood)) continue;
    for (const [g, e] of Object.entries(byGood)) {
      if (!goods.has(g) || !isObject(e) || !isNum(e.p) || !isNum(e.at)) continue;
      (out[stop] ??= {})[g] = { ...e, p: count(e.p), at: count(e.at) };
    }
  }
  return out;
}

/** Whole-number loads of known goods, zero and negative loads dropped. */
function loads(obj, goods) {
  const out = {};
  if (!isObject(obj)) return out;
  for (const [g, n] of Object.entries(obj)) if (goods.has(g) && isNum(n) && Math.round(n) > 0) out[g] = Math.round(n);
  return out;
}

const effectCards = q => [...(q.card ? [q.card] : []), ...(q.do ?? []).filter(e => isObject(e) && 'card' in e).map(e => e.card)];

/** Returns a repaired copy of `state` for `content`; never touches its input. Runs on every
    load. Throws when the save belongs to another city or a length the calendar lacks, which
    the slot reads as "refused": nothing here can make that state playable. */
export function repair(state, content) {
  if (!isObject(state)) throw new Error('repair: a save is an object');
  const s = structuredClone(state);
  const city = content?.city;
  if (!isObject(city) || !city.id) throw new Error('repair: content.city is missing');
  if (s.city !== undefined && s.city !== city.id) throw new Error(`repair: this save is for "${s.city}", the content is "${city.id}"`);
  const length = s.length ?? 'acts';
  const played = playedSeasons(content.calendar, length).length; // throws on a length the calendar lacks
  const houses = content.houses ?? [];
  if (!houses.length) throw new Error('repair: the content has no houses');
  const house = houses.some(h => h.id === s.house) ? s.house : houses[0].id;
  const seed = Number.isInteger(s.seed) ? s.seed : 0;
  const base = freshState(content, { seed, length, house });

  const goods = idSet(content.goods), stops = idSet(content.stops), agents = idSet(content.agents);
  const cards = idSet(content.cards), events = idSet(content.events), letters = idSet(content.letters);
  const routes = new Map((content.routes ?? []).map(r => [r.id, r]));
  const home = city.home;

  const out = {
    v: SAVE_VERSION,
    city: city.id,
    length,
    house: s.house ?? house,
    seed,
    rng: isNum(s.rng) ? Math.trunc(s.rng) >>> 0 : seed >>> 0,
    t: int(s.t, 0, played - 1, 0),
    phase: PHASES.includes(s.phase) ? s.phase : 'desk',
    money: isNum(s.money) ? Math.round(s.money) : base.money,
  };

  out.loans = (Array.isArray(s.loans) ? s.loans : []).filter(l => isObject(l) && isStr(l.id) && isNum(l.principal) && isNum(l.due))
    .map(l => ({ ...l, principal: count(l.principal), due: count(l.due), rate: isNum(l.rate) ? l.rate : 0 }));
  out.stock = isObject(s.stock) ? loads(s.stock, goods) : { ...base.stock };
  out.market = repairMarket(s.market, base.market, [...stops], goods);
  out.known = repairKnown(s.known, stops, goods);

  // agents: every agent of the content has a record; unknown ones are gone
  out.agents = {};
  for (const id of agents) {
    const a = isObject(s.agents?.[id]) ? s.agents[id] : {};
    const fallback = base.agents[id];
    out.agents[id] = {
      ...a,
      hired: typeof a.hired === 'boolean' ? a.hired : fallback.hired,
      where: [home, 'road', 'gone', 'dead'].includes(a.where) ? a.where : fallback.where,
      trust: int(a.trust, -3, 3, 0),
      memory: (Array.isArray(a.memory) ? a.memory : []).filter(m => isObject(m) && isNum(m.at) && typeof m.kind === 'string'),
    };
  }

  // expeditions: one whose route or agent is gone comes home now, with its cargo and purse
  out.expeditions = [];
  for (const x of Array.isArray(s.expeditions) ? s.expeditions : []) {
    if (!isObject(x) || !isStr(x.id)) continue;
    const route = routes.get(x.route);
    const cargo = loads(x.cargo, goods), purse = count(x.purse);
    if (!route || !agents.has(x.agent)) {
      for (const [g, n] of Object.entries(cargo)) out.stock[g] = (out.stock[g] ?? 0) + n;
      out.money += purse;
      continue;
    }
    out.expeditions.push({
      ...x,
      leg: int(x.leg, 0, Math.max(0, (route.legs ?? []).length - 1), 0),
      left: count(x.left), waiting: count(x.waiting), cargo, purse,
      contract: isObject(x.contract) ? x.contract : { kind: 'own' },
      staked: isObject(x.staked) ? x.staked : { house: 0, partners: 0 },
      orders: Array.isArray(x.orders) ? x.orders : [],
      sent: count(x.sent),
    });
  }
  // an agent shown on the road with no expedition under them is at home
  const onRoad = new Set(out.expeditions.map(x => x.agent));
  for (const id of agents) if (out.agents[id].where === 'road' && !onRoad.has(id)) out.agents[id].where = base.agents[id].where;

  out.rep = Object.fromEntries(REP_GROUPS.map(g => [g, int(s.rep?.[g], -3, 3, base.rep[g])]));

  // the desk: papers whose card, event or letter is gone are dropped; never over the cap
  const known = { card: cards, notice: events, letter: letters };
  out.desk = (Array.isArray(s.desk) ? s.desk : [])
    .filter(p => isObject(p) && (!(p.kind in known) || known[p.kind].has(p.ref)))
    .map(p => {
      const q = { ...p, id: typeof p.id === 'string' ? p.id : null, state: p.state === 'done' ? 'done' : 'open' };
      if (q.agent !== undefined && !agents.has(q.agent)) delete q.agent;
      return q;
    })
    .slice(0, MAX_PAPERS);
  out.done = (Array.isArray(s.done) ? s.done : []).filter(isObject);

  out.queue = (Array.isArray(s.queue) ? s.queue : [])
    .filter(q => isObject(q) && isNum(q.at) && effectCards({ ...q, do: Array.isArray(q.do) ? q.do : [] }).every(c => cards.has(c)))
    .map(q => {
      const r = { ...q, at: count(q.at), do: Array.isArray(q.do) ? q.do : [] };
      if (r.agent !== undefined && !agents.has(r.agent)) delete r.agent;
      return r;
    });

  out.flags = Object.fromEntries(Object.entries(isObject(s.flags) ? s.flags : {})
    .filter(([, v]) => isNum(v) || typeof v === 'string' || typeof v === 'boolean'));
  out.seen = Object.fromEntries(Object.entries(isObject(s.seen) ? s.seen : {}).filter(([, n]) => isNum(n)).map(([k, n]) => [k, count(n)]));
  const book = idSet(content.notebook);
  out.notebook = [...new Set((Array.isArray(s.notebook) ? s.notebook : []).filter(id => book.has(id)))];

  // the log is a record; entries stay even when the thing they name is gone. choose logs a string.
  out.log = (Array.isArray(s.log) ? s.log : []).filter(e => isObject(e) && isNum(e.at) && typeof e.kind === 'string')
    .map(e => ({ ...e, at: count(e.at), ...(e.choice !== undefined ? { choice: String(e.choice) } : {}) }));
  out.score = isObject(s.score) ? s.score : null;
  return out;
}

// ---- settings (ARCHITECTURE 8.1)

export const settingsDefaults = () => ({ sound: false, largeText: false, reduceMotion: 'device', shortcuts: true });

export const validateSettings = s => isObject(s);

export function repairSettings(s) {
  const d = settingsDefaults();
  return {
    sound: typeof s.sound === 'boolean' ? s.sound : d.sound,
    largeText: typeof s.largeText === 'boolean' ? s.largeText : d.largeText,
    reduceMotion: REDUCE_MOTION.includes(s.reduceMotion) ? s.reduceMotion : d.reduceMotion,
    shortcuts: typeof s.shortcuts === 'boolean' ? s.shortcuts : d.shortcuts,
  };
}

/** The two slots for one loaded content. `storage` is for tests (memoryStorage()); in the
    browser leave it out and the slots use localStorage. `game.fresh({ seed, length, house })`
    gives a new state without its first papers; the engine's newGame puts those on the desk. */
export function makeSlots(content, storage) {
  const game = createSaveSlot({
    game: 'merchant', key: SAVE_KEY, version: SAVE_VERSION, storage,
    validate, migrate, repair: s => repair(s, content),
    defaults: args => freshState(content, args),
  });
  const settings = createSaveSlot({
    game: 'merchant-settings', key: SETTINGS_KEY, version: SETTINGS_VERSION, storage,
    validate: validateSettings, repair: repairSettings, defaults: settingsDefaults,
  });
  return { game, settings };
}
