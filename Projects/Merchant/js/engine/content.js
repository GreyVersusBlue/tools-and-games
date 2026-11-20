// Content validation (ARCHITECTURE 5). validateContent(raw, { art }) checks every file of a
// loaded city (the object loadContent returns) against its schema and the cross-references
// between files, rejects unknown keys, and throws ONE Error listing every problem. The error
// carries `.problems`, a list of { kind, path, message }; kind is "unknown-key", "duplicate-id"
// or "schema" so the lint can file each under its rule (ARCHITECTURE 6.2 rules 1 and 6).
//
// A reference to a kind whose file is still an empty list is not checked: a city may be a
// skeleton (a new city until its files are written) and a unit may load a city before every file exists. Once the
// list has one entry, every reference to that kind is checked. Art, seal and still ids are
// checked only when the caller passes `art`, the set of ids in assets/art/manifest.json.
import { check as checkEffect } from './effects.js';
import { REP_GROUPS } from './state.js';
import { CARD_GROUPS } from '../data.js';
import { SEASONS } from './calendar.js';
import { TRIP_STATES, tripLeaf, hasSlots } from './conditions.js';

export const TABS = ['terms', 'places', 'people', 'goods'];
export const TRAITS = ['careful', 'bold', 'honest', 'sharp'];
export const TRAIT_FAMILIES = ['knows-', 'speaks-'];
export const BY = ['caravan', 'dhow', 'galley', 'nileboat', 'mules'];
export const SOURCE_KINDS = ['primary', 'scholarship'];
// What a card is for (DESIGN 2.1 rule 2): `favour` pays or gives for goodwill, `trade` offers goods, a buyer or a
// tip, `people` is hiring, an agent's request or a dispute with your own, `world` is news, the court and faith.
export const CARD_KINDS = ['favour', 'trade', 'people', 'world'];
// returns.json (DESIGN 2.1 rules 3 and 4): entries for a return paper (`paper: 'return'`) or a loss paper
// (`paper: 'loss'`). `facts` says which trips an entry fits: every key it names must match. The values of
// each key are a list the trip's fact must be in, except `seasons` (a { gte, lte } range) and the
// true-or-false keys. routes.js `pickEntry` takes the entry that names the most facts.
export const RETURN_FACTS = {
  return: ['outcome', 'agent', 'to', 'good', 'seasons', 'orders', 'contract', 'lost'],
  loss: ['by', 'cause', 'whole', 'survived', 'agent', 'to', 'good', 'seasons', 'contract'],
};
export const OUTCOMES = ['profit', 'loss', 'even'];
export const CAUSES = ['sea', 'river', 'desert', 'robbers'];

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// The condition leaves of conditions.js, with the keys each takes besides its own. The suite
// pins that this table and the engine's agree (test/content.mjs).
export const CONDITION_LEAVES = {
  season: [], year: [], act: [], length: [], notebook: [], out: [], money: [], stock: ['gte'],
  flag: ['not', 'gte'], rep: ['gte', 'lte'], agent: ['hired', 'where'], trip: [],
};
// Leaves only a letter's `when` may use (ARCHITECTURE 5.7); letters.js reads them off the expedition.
export const LETTER_LEAVES = { leg: [], at: [], trait: [] };

export function validateContent(raw, { art } = {}) {
  const problems = [];
  const bad = (kind, path, message) => problems.push({ kind, path, message });
  const schema = (path, message) => bad('schema', path, message);

  // ---- id tables, for the cross-references
  const list = k => (Array.isArray(raw[k]) ? raw[k] : []);
  const ids = {};
  for (const k of ['houses', 'goods', 'stops', 'routes', 'agents', 'events', 'notebook', 'sources']) {
    ids[k] = new Set(list(k).filter(isObj).map(x => x.id));
  }
  ids.cards = new Set([...list('cards'), ...list('letters')].filter(isObj).map(x => x.id));
  ids.letters = new Set(list('letters').filter(isObj).map(x => x.id));
  const known = kind => ids[kind].size > 0;

  function ref(kind, id, path) {
    if (typeof id !== 'string') return;
    if (known(kind) && !ids[kind].has(id)) schema(path, `no ${kind.replace(/s$/, '')} "${id}"`);
  }
  function artRef(id, path) {
    if (art && typeof id === 'string' && !art.has(id)) schema(path, `no picture "${id}" in the art manifest`);
  }

  // ---- small validators: each takes (value, path) and reports problems
  const str = (v, p) => { if (typeof v !== 'string' || v === '') schema(p, 'needs a non-empty string'); };
  const idv = (v, p) => { if (typeof v !== 'string' || !ID.test(v)) schema(p, `needs an id in lowercase with hyphens, got ${JSON.stringify(v)}`); };
  const int = (v, p, min = -Infinity, max = Infinity) => {
    if (!Number.isInteger(v) || v < min || v > max) schema(p, `needs a whole number${min > -Infinity ? ` from ${min}` : ''}${max < Infinity ? ` to ${max}` : ''}, got ${JSON.stringify(v)}`);
  };
  const num = (v, p, min = -Infinity, max = Infinity) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) schema(p, `needs a number${min > -Infinity ? ` from ${min}` : ''}${max < Infinity ? ` to ${max}` : ''}, got ${JSON.stringify(v)}`);
  };
  const bool = (v, p) => { if (typeof v !== 'boolean') schema(p, 'needs true or false'); };
  const oneOf = (list2, v, p) => { if (!list2.includes(v)) schema(p, `needs one of ${list2.join(', ')}, got ${JSON.stringify(v)}`); };
  const arr = (v, p, each, min = 0) => {
    if (!Array.isArray(v)) { schema(p, 'needs a list'); return; }
    if (v.length < min) schema(p, `needs at least ${min} item${min === 1 ? '' : 's'}`);
    v.forEach((x, i) => each(x, `${p}[${i}]`));
  };
  /** An object with these keys. spec: key -> validator; req: keys that must be there. */
  function obj(v, p, spec, req = []) {
    if (!isObj(v)) { schema(p, 'needs an object'); return false; }
    for (const k of Object.keys(v)) if (!(k in spec)) bad('unknown-key', `${p}.${k}`, `unknown key "${k}"`);
    for (const k of req) if (!(k in v)) schema(p, `missing "${k}"`);
    for (const k of Object.keys(spec)) if (k in v) spec[k](v[k], `${p}.${k}`);
    return true;
  }
  const dict = (v, p, key, val) => {
    if (!isObj(v)) { schema(p, 'needs an object'); return; }
    for (const [k, x] of Object.entries(v)) { key(k, `${p}.${k}`); val(x, `${p}.${k}`); }
  };
  const optional = f => (v, p) => { if (v !== null && v !== undefined) f(v, p); };
  const refOf = kind => (v, p) => { str(v, p); ref(kind, v, p); };
  const idList = kind => (v, p) => arr(v, p, refOf(kind));

  function unique(items, path, what, keyOf = x => x?.id) {
    const seen = new Map();
    items.forEach((x, i) => {
      const k = keyOf(x);
      if (typeof k !== 'string') return;
      if (seen.has(k)) bad('duplicate-id', `${path}[${i}]`, `${what} "${k}" is used twice (first at ${path}[${seen.get(k)}])`);
      else seen.set(k, i);
    });
  }

  // ---- shared shapes
  const sourceRef = (v, p) => obj(v, p, {
    src: (s, q) => { str(s, q); if (typeof s === 'string' && !ids.sources.has(s)) schema(q, `no source "${s}" in sources.json`); },
    at: str,
  }, ['src']);
  const sources = (v, p) => arr(v, p, sourceRef);
  const seal = (v, p) => {
    if (v === null) return;
    if (typeof v !== 'string' || !/^seal-\d+$/.test(v)) schema(p, `needs null or a seal id like "seal-1", got ${JSON.stringify(v)}`);
    else artRef(v, p);
  };
  const textBlock = (v, p) => obj(v, p, { title: str, body: str }, ['title', 'body']);

  // ---- effects and conditions
  function effect(e, p, where) { // where: "now" | "later" | "letter-now" | "do"
    let head;
    try { head = checkEffect(e); }
    catch (err) { bad(/unknown key/.test(err.message) ? 'unknown-key' : 'schema', p, err.message); return; }
    const v = e[head];
    switch (head) {
      case 'money': int(v, `${p}.money`); break;
      case 'stock': refOf('goods')(v, `${p}.stock`); int(e.by, `${p}.by`); break;
      case 'rep': oneOf(REP_GROUPS, v, `${p}.rep`); int(e.by, `${p}.by`); break;
      case 'trust': agentRef(v, `${p}.trust`); int(e.by, `${p}.by`); break;
      case 'memory': agentRef(v, `${p}.memory`); str(e.kind, `${p}.kind`); break;
      case 'flag':
        str(v, `${p}.flag`);
        if (e.clear !== undefined) { if (e.clear !== true) schema(`${p}.clear`, 'needs true'); if ('set' in e) schema(p, 'flag takes set or clear, not both'); }
        else if (!('set' in e)) schema(p, 'flag needs set or clear');
        else if (!['string', 'number', 'boolean'].includes(typeof e.set)) schema(`${p}.set`, 'needs a string, number or true/false');
        break;
      case 'price': refOf('stops')(v, `${p}.price`); refOf('goods')(e.good, `${p}.good`); num(e.by, `${p}.by`, 0.0001); break;
      case 'loan':
        obj(v, `${p}.loan`, { from: str, principal: (x, q) => int(x, q, 1), in: (x, q) => int(x, q, 1), rate: (x, q) => num(x, q, 0) }, ['from', 'principal', 'in', 'rate']);
        break;
      case 'hire': case 'dismiss': agentRef(v, `${p}.${head}`); break;
      case 'card':
        refOf('cards')(v, `${p}.card`);
        if (where !== 'later' && where !== 'do') schema(p, 'a card effect goes only inside a later entry');
        break;
      case 'unlock': refOf('notebook')(v, `${p}.unlock`); break;
      case 'outfit':
        agentRef(v, `${p}.outfit`);
        oneOf(['own', 'qirad'], e.contract, `${p}.contract`);
        if (where !== 'now') schema(p, 'an outfit effect goes only in a card choice\'s now list: the sheet opens when the choice is made');
        break;
      case 'order':
        obj(v, `${p}.order`, { go: (x, q) => oneOf(['wait', 'on', 'home'], x, q) }, ['go']);
        if (where !== 'letter-now') schema(p, 'an order goes only in a letter choice\'s now list');
        break;
    }
  }
  function agentRef(v, p) { if (v === '$agent') return; refOf('agents')(v, p); }
  const effects = where => (v, p) => arr(v, p, (e, q) => effect(e, q, where));
  const later = (v, p) => arr(v, p, (l, q) => {
    obj(l, q, { in: (x, r) => int(x, r, 1), do: effects('do'), card: refOf('cards') }, ['in']);
    if (isObj(l) && !('do' in l) && !('card' in l)) schema(q, 'a later entry needs do or card');
  });

  function condition(c, p, letter = false) {
    if (!isObj(c)) { schema(p, 'needs an object'); return; }
    if ('all' in c || 'any' in c) {
      const head = 'all' in c ? 'all' : 'any';
      obj(c, p, { [head]: (v, q) => arr(v, q, (x, r) => condition(x, r, letter), 1) }, [head]);
      return;
    }
    const table = letter ? { ...CONDITION_LEAVES, ...LETTER_LEAVES } : CONDITION_LEAVES;
    const heads = Object.keys(c).filter(k => k in table);
    if (heads.length !== 1) { schema(p, `needs exactly one of all, any, ${Object.keys(table).join(', ')}`); return; }
    const head = heads[0];
    obj(c, p, Object.fromEntries([head, ...table[head]].map(k => [k, () => {}])));
    const v = c[head], q = `${p}.${head}`;
    switch (head) {
      case 'season': arr(v, q, (s, r) => oneOf(SEASONS, s, r), 1); break;
      case 'year': arr(v, q, (y, r) => int(y, r)); if (Array.isArray(v) && v.length !== 2) schema(q, 'needs [from, to]'); break;
      case 'act': int(v, q, 1); break;
      case 'length': oneOf(['acts', 'full'], v, q); break;
      case 'notebook': refOf('notebook')(v, q); break;
      case 'out': case 'money': obj(v, q, { gte: (x, r) => int(x, r), lte: (x, r) => int(x, r) }); if (isObj(v) && !Object.keys(v).length) schema(q, 'needs gte or lte'); break;
      case 'stock': refOf('goods')(v, q); if (!('gte' in c)) schema(p, 'stock needs gte'); else int(c.gte, `${p}.gte`, 1); break;
      case 'flag': str(v, q); if ('not' in c) bool(c.not, `${p}.not`); if ('gte' in c) int(c.gte, `${p}.gte`); break;
      case 'rep': oneOf(REP_GROUPS, v, q); if ('gte' in c) int(c.gte, `${p}.gte`); if ('lte' in c) int(c.lte, `${p}.lte`); if (!('gte' in c) && !('lte' in c)) schema(p, 'rep needs gte or lte'); break;
      case 'agent': refOf('agents')(v, q); if ('hired' in c) bool(c.hired, `${p}.hired`); if ('where' in c) str(c.where, `${p}.where`); break;
      case 'leg': obj(v, q, { by: (x, r) => oneOf(BY, x, r) }, ['by']); break;
      case 'at': refOf('stops')(v, q); break;
      case 'trait': trait(v, q); break;
      case 'trip':
        obj(v, q, { agent: refOf('agents'), is: (x, r) => oneOf(TRIP_STATES, x, r) }, ['agent', 'is']);
        if (letter) schema(p, 'a letter reads its own expedition, so it takes no trip leaf');
        break;
    }
  }
  function trait(t, p) {
    if (TRAITS.includes(t)) return;
    const fam = TRAIT_FAMILIES.find(f => typeof t === 'string' && t.startsWith(f));
    if (!fam || !ID.test(t.slice(fam.length))) { schema(p, `needs one of ${TRAITS.join(', ')}, knows-<stop> or speaks-<language>, got ${JSON.stringify(t)}`); return; }
    if (fam === 'knows-') ref('stops', t.slice(fam.length), p);
  }

  // ---- cards and letters
  const choice = (isLetter) => (c, p) => obj(c, p, {
    id: idv, label: str, hint: str, requires: (x, q) => condition(x, q, isLetter),
    now: effects(isLetter ? 'letter-now' : 'now'), later,
    ui: (x, q) => oneOf(['outfit-first'], x, q),
  }, ['id', 'label']);
  const choices = isLetter => (v, p) => {
    arr(v, p, choice(isLetter), 1);
    if (Array.isArray(v)) unique(v, p, 'choice id');
  };
  const from = (v, p) => obj(v, p, { name: str, role: str, seal }, ['name', 'role']);
  const common = (isLetter) => ({
    id: idv, title: str, body: str, when: (x, q) => condition(x, q, isLetter), weight: (x, q) => num(x, q, 0),
    repeat: bool, from, choices: choices(isLetter), note: str, unlocks: idList('notebook'), sources,
  });
  function cards(items) {
    items.forEach((c, i) => {
      const p = `cards[${i}]${isObj(c) && typeof c.id === 'string' ? ` (${c.id})` : ''}`;
      obj(c, p, { ...common(false), group: (x, q) => oneOf(CARD_GROUPS, x, q), kind: (x, q) => oneOf(CARD_KINDS, x, q) }, ['id', 'group', 'kind', 'from', 'title', 'body', 'choices', 'note']);
      // `kind` is required of every card (DESIGN 2.1 rule 2); test/mix.mjs also fails a card of either city without one.
      if (isObj(c)) tripRules(c, p);
    });
  }
  // A card's trip leaf must be where `view()` can find it, and its slots need one to fill them (ARCHITECTURE 4.12).
  function tripRules(c, p) {
    const w = c.when, inAny = JSON.stringify(w ?? {}).includes('"trip"');
    const leaf = isObj(w) ? tripLeaf(w) : null;
    if (inAny && !leaf) schema(`${p}.when`, 'the trip leaf must stand alone in "when" or directly inside its top-level "all", so the card is bound to one trip');
    const texts = [c.title, c.body, ...(Array.isArray(c.choices) ? c.choices.flatMap(ch => (isObj(ch) ? [ch.label, ch.hint] : [])) : [])];
    if (!leaf && texts.some(hasSlots)) schema(p, 'uses {agent}, {to}, {good}, {route} or {seasons} but has no trip leaf to fill them from');
  }
  function letters(items) {
    items.forEach((c, i) => {
      const p = `letters[${i}]${isObj(c) && typeof c.id === 'string' ? ` (${c.id})` : ''}`;
      obj(c, p, { ...common(true), kind: (x, q) => oneOf(['question', 'report'], x, q), happened: effects('do'), default: str }, ['id', 'kind', 'title', 'body', 'choices', 'note']);
      if (isObj(c) && c.kind === 'question' && 'happened' in c) schema(p, 'only a report has "happened"');
      if (isObj(c) && 'default' in c) {
        if (c.kind !== 'question') schema(p, 'only a question has a "default"');
        else if (Array.isArray(c.choices) && !c.choices.some(ch => isObj(ch) && ch.id === c.default)) schema(`${p}.default`, `no choice "${c.default}" to act as the default`);
      }
      if (isObj(c) && c.kind === 'report' && Array.isArray(c.choices)) {
        c.choices.forEach((ch, j) => { if (isObj(ch) && (ch.now ?? []).some?.(e => isObj(e) && 'order' in e)) schema(`${p}.choices[${j}]`, 'a report\'s choices are the house\'s response, not orders'); });
      }
    });
  }

  // returns.json: what a return or a loss paper asks (DESIGN 2.1 rules 3 and 4)
  function returnEntries(items) {
    const numbers = (v, p) => obj(v, p, { gte: (x, q) => num(x, q), lte: (x, q) => num(x, q) });
    const facts = paper => (v, p) => {
      const allowed = RETURN_FACTS[paper] ?? [];
      const spec = {
        outcome: (x, q) => arr(x, q, (o, r) => oneOf(OUTCOMES, o, r), 1),
        agent: (x, q) => arr(x, q, refOf('agents'), 1), to: (x, q) => arr(x, q, refOf('stops'), 1), good: (x, q) => arr(x, q, refOf('goods'), 1),
        by: (x, q) => arr(x, q, (o, r) => oneOf(BY, o, r), 1), cause: (x, q) => arr(x, q, (o, r) => oneOf(CAUSES, o, r), 1), contract: (x, q) => arr(x, q, (o, r) => oneOf(['own', 'qirad'], o, r), 1),
        seasons: numbers, orders: bool, lost: bool, whole: bool, survived: bool,
      };
      if (!isObj(v)) { schema(p, 'needs an object'); return; }
      for (const k of Object.keys(v)) if (!allowed.includes(k)) bad('unknown-key', `${p}.${k}`, `a ${paper} entry has no fact "${k}" (it has ${allowed.join(', ')})`);
      for (const k of Object.keys(v)) if (allowed.includes(k)) spec[k](v[k], `${p}.${k}`);
    };
    items.forEach((e, i) => {
      const p = `returns[${i}]${isObj(e) && typeof e.id === 'string' ? ` (${e.id})` : ''}`;
      obj(e, p, {
        id: idv, paper: (x, q) => oneOf(['return', 'loss'], x, q), facts: (x, q) => facts(isObj(e) ? e.paper : null)(x, q),
        when: (x, q) => condition(x, q, false), weight: (x, q) => num(x, q, 0), title: str, body: str,
        choices: choices(false), note: str, sources,
      }, ['id', 'paper', 'choices', 'note']);
    });
    unique(items, 'returns.json', 'return entry id');
  }

  // ---- the files
  const file =(name, v, empty) => { if (v === undefined || v === null) return empty; return v; };

  // city.json
  const city = raw.city;
  if (isObj(city) && Object.keys(city).length) {
    obj(city, 'city.json', {
      id: idv, name: str, home: (v, p) => { str(v, p); ref('stops', v, p); }, currency: str, title: str, tagline: str,
      opening: (v, p) => dict(v, p, (k, q) => { if (known('houses') && !ids.houses.has(k)) schema(q, `no house "${k}"`); }, idList('cards')),
      secondSeason: (v, p) => obj(v, p, { letter: (x, q) => { str(x, q); if (ids.letters.size && !ids.letters.has(x)) schema(q, `no letter "${x}"`); }, cards: (x, q) => int(x, q, 0) }),
      contracts: (v, p) => dict(v, p, idv, (x, q) => obj(x, q, { agentShare: (y, r) => { arr(y, r, (n, s) => int(n, s, 1)); if (Array.isArray(y) && y.length !== 2) schema(r, 'needs [numerator, denominator]'); } })),
      score: (v, p) => obj(v, p, { wealthScale: (x, q) => arr(x, q, () => {}), ranks: (x, q) => arr(x, q, () => {}) }),
      stills: (v, p) => dict(v, p, str, (x, q) => { str(x, q); artRef(x, q); }),
      priceNews: bool,
      // the recorded direction of trade (DECISIONS 2026-11-17 10:25): `from` lists stops cheapest first, an inner list is a tier that ties among itself; the lint checks base prices against it
      gradients: (v, p) => arr(v, p, (g, q) => obj(g, q, { good: refOf('goods'), from: (x, r) => arr(x, r, (t, u) => (Array.isArray(t) ? arr(t, u, refOf('stops'), 1) : refOf('stops')(t, u)), 2), note: str, sources }, ['good', 'from', 'note', 'sources'])),
      // what the map calls each group of close stops (stops.json's `cluster`), in words a twelve-year-old reads; an id with no name here is shown as the id
      clusters: (v, p) => dict(v, p, idv, str),
      // what a loss takes and who retires at the act jump (ARCHITECTURE 4.7); every key is optional and routes.js has a default for each
      jump: (v, p) => obj(v, p, {
        retires: (x, q) => num(x, q, 0, 1), wholeLoss: (x, q) => num(x, q, 0, 1), survivesWhole: (x, q) => num(x, q, 0, 1),
        partial: (x, q) => {
          arr(x, q, (n, r) => num(n, r, 0, 1));
          if (Array.isArray(x) && (x.length !== 2 || x[0] > x[1])) schema(q, 'needs [least, most], the least no more than the most');
        },
      }),
      // the chances of the ending (ARCHITECTURE 4.9); every key is optional and routes.js has a default for each
      recall: (v, p) => {
        const unit = (x, q) => num(x, q, 0, 1);
        obj(v, p, {
          reach: (x, q) => obj(x, q, { start: unit, perSeason: unit, floor: unit }),
          recalledKeeps: unit, recalledSurvives: unit, stayedSurvives: unit, homeSurvives: unit,
          byStop: (x, q) => dict(x, q, (k, r) => ref('stops', k, r), unit),
        });
      },
    }, ['id', 'name', 'home', 'currency', 'title', 'tagline', 'opening']);
    if (typeof city.id === 'string' && typeof raw.cityId === 'string' && city.id !== raw.cityId) schema('city.json.id', `says "${city.id}" but the folder is "${raw.cityId}"`);
  } else schema('city.json', 'is missing or empty');

  // calendar.json
  const cal = raw.calendar;
  if (isObj(cal) && Object.keys(cal).length) {
    const lengthShape = (v, p) => obj(v, p, { acts: (a, q) => {
      arr(a, q, (x, r) => obj(x, r, { from: (n, s) => int(n, s, 0), to: (n, s) => int(n, s, 0) }, ['from', 'to']), 1);
      if (Array.isArray(a)) {
        let last = -1;
        a.forEach((x, i) => {
          if (!isObj(x) || !Number.isInteger(x.from) || !Number.isInteger(x.to)) return;
          if (x.to < x.from) schema(`${q}[${i}]`, `act ${x.from}..${x.to} runs backwards`);
          if (x.from <= last) schema(`${q}[${i}]`, 'acts overlap or are out of order');
          last = Math.max(last, x.to);
        });
      }
    } }, ['acts']);
    obj(cal, 'calendar.json', {
      base: (v, p) => int(v, p, 1),
      lengths: (v, p) => obj(v, p, { acts: lengthShape, full: lengthShape }, ['acts', 'full']),
      end: (v, p) => obj(v, p, { season: (x, q) => int(x, q, 0), event: refOf('events') }, ['season', 'event']),
    }, ['base', 'lengths', 'end']);
    if (isObj(cal.lengths) && isObj(cal.end)) {
      for (const len of ['acts', 'full']) {
        const acts = cal.lengths[len]?.acts;
        if (Array.isArray(acts) && acts.every(a => isObj(a) && Number.isInteger(a.to)) && Number.isInteger(cal.end.season)
            && acts[acts.length - 1].to !== cal.end.season) schema('calendar.json.end.season', `${cal.end.season} is not the last season of length "${len}" (${acts[acts.length - 1].to})`);
      }
    }
  } else schema('calendar.json', 'is missing or empty');

  // houses.json
  const houses = file('houses', raw.houses, []);
  arr(houses, 'houses.json', (h, p) => obj(h, p, {
    id: idv, name: str, blurb: str, difficulty: (v, q) => int(v, q, 1), money: (v, q) => int(v, q, 0),
    stock: (v, q) => dict(v, q, (k, r) => { ref('goods', k, r); }, (n, r) => int(n, r, 0)),
    agents: idList('agents'),
    rep: (v, q) => dict(v, q, (k, r) => oneOf(REP_GROUPS, k, r), (n, r) => int(n, r, -3, 3)),
    multiplier: (v, q) => num(v, q, 0.1),
  }, ['id', 'name', 'blurb', 'difficulty', 'money', 'agents', 'multiplier']));
  if (Array.isArray(houses)) unique(houses, 'houses.json', 'house id');

  // goods.json
  const goods = file('goods', raw.goods, []);
  arr(goods, 'goods.json', (g, p) => obj(g, p, {
    id: idv, name: str, unit: (v, q) => oneOf(['load', 'chest'], v, q), sigma: (v, q) => num(v, q, 0), revert: (v, q) => num(v, q, 0, 1),
    notebook: refOf('notebook'), art: (v, q) => { str(v, q); artRef(v, q); }, sources,
  }, ['id', 'name', 'unit', 'sigma', 'revert']));
  if (Array.isArray(goods)) unique(goods, 'goods.json', 'good id');

  // stops.json
  const stops = file('stops', raw.stops, []);
  arr(stops, 'stops.json', (s, p) => obj(s, p, {
    id: idv, name: str, lat: (v, q) => num(v, q, -90, 90), lon: (v, q) => num(v, q, -180, 180), region: str, cluster: str,
    label: (v, q) => obj(v, q, { dx: num, dy: num, anchor: (x, r) => oneOf(['start', 'middle', 'end'], x, r) }, ['dx', 'dy', 'anchor']),
    sells: (v, q) => dict(v, q, (k, r) => ref('goods', k, r), (x, r) => obj(x, r, {
      base: (n, t) => num(n, t, 0), baseByAct: (n, t) => { arr(n, t, (y, u) => num(y, u, 0)); if (Array.isArray(n) && n.length !== 3) schema(t, 'needs three numbers, one per act'); },
      depth: (n, t) => num(n, t, 0),
    }, ['base', 'depth'])),
    buys: idList('goods'), notebook: refOf('notebook'), art: (v, q) => { str(v, q); artRef(v, q); }, sources,
  }, ['id', 'name', 'lat', 'lon', 'region', 'sells', 'buys']));
  if (Array.isArray(stops)) unique(stops, 'stops.json', 'stop id');

  // routes.json
  const routes = file('routes', raw.routes, []);
  arr(routes, 'routes.json', (r, p) => obj(r, p, {
    id: idv, to: refOf('stops'),
    legs: (v, q) => arr(v, q, (l, t) => obj(l, t, {
      from: refOf('stops'), to: refOf('stops'), by: (x, u) => oneOf(BY, x, u), seasons: (x, u) => int(x, u, 1),
      opens: (x, u) => arr(x, u, (y, w) => oneOf(SEASONS, y, w), 1), risk: (x, u) => num(x, u, 0, 1), toll: (x, u) => int(x, u, 0), sources,
      when: (x, u) => condition(x, u), note: str,
    }, ['from', 'to', 'by', 'seasons', 'opens', 'risk', 'toll']), 2),
  }, ['id', 'to', 'legs']));
  if (Array.isArray(routes)) unique(routes, 'routes.json', 'route id');

  // agents.json
  const agents = file('agents', raw.agents, []);
  arr(agents, 'agents.json', (a, p) => obj(a, p, {
    id: idv, name: str, community: str, seal, traits: (v, q) => arr(v, q, trait), wage: (v, q) => int(v, q, 0),
    home: refOf('stops'), hireCard: refOf('cards'), notebook: refOf('notebook'), sources,
  }, ['id', 'name', 'community', 'seal', 'traits', 'wage', 'home']));
  if (Array.isArray(agents)) unique(agents, 'agents.json', 'agent id');

  // cards and letters
  const cardList = file('cards', raw.cards, []);
  if (Array.isArray(cardList)) { cards(cardList); }
  else schema('cards', 'needs a list');
  const letterList = file('letters', raw.letters, []);
  if (Array.isArray(letterList)) letters(letterList); else schema('letters.json', 'needs a list');
  const returnList = file('returns', raw.returns, []);
  if (Array.isArray(returnList)) returnEntries(returnList); else schema('returns.json', 'needs a list');
  if (Array.isArray(cardList) && Array.isArray(letterList)) unique([...cardList, ...letterList], 'cards and letters', 'card id');

  // events.json
  const events = file('events', raw.events, []);
  arr(events, 'events.json', (e, p) => obj(e, p, {
    id: idv, at: (v, q) => int(v, q, 0), between: (v, q) => { arr(v, q, (n, r) => int(n, r, 1)); if (Array.isArray(v) && v.length !== 2) schema(q, 'needs [actA, actB]'); },
    weight: (v, q) => num(v, q, 0), when: (v, q) => condition(v, q), do: effects('do'), notice: textBlock, interlude: str, note: str, sources,
  }, ['id']));
  if (Array.isArray(events)) unique(events, 'events.json', 'event id');

  // notebook.json
  const notebook = file('notebook', raw.notebook, []);
  arr(notebook, 'notebook.json', (n, p) => obj(n, p, {
    id: idv, tab: (v, q) => oneOf(TABS, v, q), title: str, body: str, art: (v, q) => { str(v, q); artRef(v, q); },
    context: (v, q) => oneOf(['d5'], v, q), sources,
  }, ['id', 'tab', 'title', 'body']));
  if (Array.isArray(notebook)) unique(notebook, 'notebook.json', 'notebook id');

  // terms.json
  const terms = file('terms', raw.terms, []);
  arr(terms, 'terms.json', (t, p) => obj(t, p, { word: str, forms: (v, q) => arr(v, q, str), entry: refOf('notebook') }, ['word', 'entry']));
  if (Array.isArray(terms)) unique(terms, 'terms.json', 'term', t => (typeof t?.word === 'string' ? t.word.toLowerCase() : undefined));

  // text.json: lists of pieces. A piece with no "fact": false needs a source (lint rule 2).
  const piece = (v, p) => obj(v, p, { id: idv, title: str, body: str, context: (x, q) => oneOf(['d5'], x, q), fact: bool, sources }, ['id', 'body']);
  const text = isObj(raw.text) ? raw.text : {};
  obj(text, 'text.json', Object.fromEntries(['title', 'about', 'interludes', 'ending'].map(k => [k, (v, p) => {
    arr(v, p, piece);
    if (Array.isArray(v)) unique(v, p, 'text id');
  }])));

  // sources.json
  const srcs = file('sources', raw.sources, []);
  arr(srcs, 'sources.json', (s, p) => obj(s, p, {
    id: idv, author: str, title: str, year: (v, q) => int(v, q, 1), publisher: optional(str), kind: (v, q) => oneOf(SOURCE_KINDS, v, q),
    volume: optional(str), translator: optional(str), contested: bool, period: str, note: str,
  }, ['id', 'author', 'title', 'year', 'publisher', 'kind', 'contested', 'period']));
  if (Array.isArray(srcs)) {
    unique(srcs, 'sources.json', 'source id');
    srcs.forEach((s, i) => {
      if (isObj(s) && s.kind === 'primary' && !('translator' in s)) schema(`sources.json[${i}]`, 'a primary source needs "translator" (a name, or null for an edition in the original language)');
    });
  }

  if (problems.length) {
    const err = new Error(`content has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n` + problems.map(x => `  ${x.path}: ${x.message}`).join('\n'));
    err.problems = problems;
    throw err;
  }
  return raw;
}
