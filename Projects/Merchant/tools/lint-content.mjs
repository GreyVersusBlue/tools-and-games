// The content lint (ARCHITECTURE 6.2): node tools/lint-content.mjs [city] [--overlay <dir>]
// from Projects/Merchant/. Default city is cairo. Prints one FAIL line per problem, each naming
// its rule, then one summary line; exits 1 on any failure and 0 otherwise.
//   --overlay <dir>  files in <dir> replace the city's file of the same relative path (the
//                    test suite uses it to load testport with one deliberate fault).
//
// 1 validateContent passes (schema, cross-references, every source id in sources.json)
// 2 every card, letter, event with a note, notebook entry and stated fact in text.json has a source
// 3 every card has a later effect somewhere, and every choice has at least one effect
// 4 no choice is at least as good as another on every comparable axis (money, stock, rep, trust),
//   judged on now plus later summed; the failure names the dominating choice
// 5 D5: no banned stem (tools/banned.json) in any game text outside entries marked "context": "d5",
//   and no such entry reachable as an unlock
// 6 ids unique, files parse, no unknown keys
// 7 no em dash or en dash, no web address, no TODO
// 8 the direction of trade: each gradient in city.json lists stops cheapest first, and the base price of
//   its good at a stop is never below that of an earlier stop, in every act (MER-51b)
// 10 no choice's later effect list adds money and removes stock together: a later stock change clamps at
//   zero, so goods already sold would still pay (MER-102b, DECISIONS 2026-11-20 18:4x); and no choice that
//   changes no stock has money only in its later effects when another choice on the card sells a good (removes
//   stock and adds money now): holding would pay as well as selling and the bots read it as free (MER-107)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from '../js/data.js';
import { validateContent } from '../js/engine/content.js';
import { tripLeaf } from '../js/engine/conditions.js';

// Rule 10's second half found four choices already in the data that it refuses (MER-107). Two are Cairo cards
// (cloth-for-the-east/keep pays 40 later for linen it keeps, bales-middling/lesson pays 25 later beside a sale), two
// are testport's. MER-107 may change neither file, so they are listed here and each should be rewritten under the
// same rule as gold-price-falls, then deleted from this list. A card not listed here is refused.
const HOLD_PAYS_LATER_LISTED = ['cloth-for-the-east/keep', 'bales-middling/lesson', 'salt-order/keep-salt', 'wool-due/keep'];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'data');

// The only exceptions (rule 4): each city's opening letter. Its choices are a first handshake,
// not a trade-off. Cairo has two because ARCHITECTURE 5.1 names one for each starting house.
// first-expedition is the scripted card that teaches sending a trip; its go takes no money
// because the trip's costs are charged at Send (MER-72), so it is not a trade-off either.
export const OPENING_LETTERS = {
  cairo: ['opening-letter', 'opening-letter-broker', 'first-expedition'],
  testport: ['welcome-note'],
};

export const RULES = {
  1: 'schema and references',
  2: 'a source on every claim',
  3: 'a later effect',
  4: 'a trade-off',
  5: 'D5 banned words',
  6: 'ids, files and keys',
  7: 'text rules',
  8: 'the direction of trade',
  9: 'a card that tells of a trip is bound to one',
  10: 'no later pay for stock',
};

// Rule 9 (ARCHITECTURE 4.12): a card whose words name an agent and a stop or a road carries a `trip`
// leaf, and takes its places from that trip, so a card with the leaf names no stop but home.
// It fails the run (MER-75). The two exemptions: Cairo's first-expedition is the scripted opening card
// that teaches sending a trip, and there is no trip yet for it to bind to (Yusuf is not hired until it
// is answered); Testport's bridge-toll is a toll card whose "long road round" is a road for carts, not
// a trip an agent made, and the word match cannot tell the two apart.
export const TRIP_EXEMPT = {
  cairo: ['first-expedition'],
  testport: ['bridge-toll'],
};
const ROAD_WORDS = /\b(road|roads|caravan|caravans|dhow|dhows|galley|galleys|voyage|voyages|journey|journeys|trip|trips|expedition|expeditions)\b/i;
const wordIn = (text, word) => new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(text);

/** The failures of rule 9 for one card: [{ rule: 9, path, message }]. */
export function tripFailures(content, card) {
  const texts = [card.title, card.body, ...(card.choices ?? []).flatMap(ch => [ch.label, ch.hint])].filter(t => typeof t === 'string');
  const text = texts.join(' ').replace(/\{(agent|to|good|route|seasons)\}/g, ' ');
  const where = `cards[${card.id}]`;
  if ((TRIP_EXEMPT[content.cityId] ?? []).includes(card.id)) return [];
  const home = content.city?.home;
  const stops = (content.stops ?? []).filter(x => x.id !== home);
  const leaf = tripLeaf(card.when);
  if (leaf) {
    const written = stops.find(x => wordIn(text, x.name));
    return written ? [{ rule: 9, path: where, message: `carries a trip leaf but writes the place "${written.name}"; use {to} or {route}` }] : [];
  }
  const agent = (content.agents ?? []).find(a => wordIn(text, a.name.split(' ')[0]));
  const place = stops.find(x => wordIn(text, x.name))?.name ?? text.match(ROAD_WORDS)?.[0];
  return agent && place ? [{ rule: 9, path: where, message: `names ${agent.name} and "${place}" but has no trip leaf` }] : [];
}

/** Load a city the way the tools do. `overlay` is a folder whose files win over the city's. */
export async function loadCity(city, { overlay } = {}) {
  const shim = {
    async readFile(url, enc) {
      if (overlay) {
        let rel = path.relative(DATA, fileURLToPath(url));
        if (rel.startsWith(`${city}${path.sep}`)) rel = rel.slice(city.length + 1);
        try { return await fs.readFile(path.join(overlay, rel), enc); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      return fs.readFile(url, enc);
    },
  };
  return loadContent(city, { fs: shim });
}

export async function loadArtIds() {
  try {
    const m = JSON.parse(await fs.readFile(path.join(ROOT, 'assets/art/manifest.json'), 'utf8'));
    return new Set((m.assets ?? []).map(a => a.id));
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function loadBanned() {
  const list = JSON.parse(await fs.readFile(path.join(HERE, 'banned.json'), 'utf8'));
  if (!Array.isArray(list) || list.some(w => typeof w !== 'string' || w !== w.toLowerCase() || !w.trim())) {
    throw new Error('banned.json must be a list of lowercase words and nothing else');
  }
  return list;
}

// ---- effects as numbers, for rule 4
/** The comparable effects of one choice, now plus later, as { axis: n }. */
export function choiceVector(choice) {
  const v = {};
  const add = (k, n) => { v[k] = (v[k] ?? 0) + n; };
  const one = e => {
    if ('money' in e) add('money', e.money);
    else if ('stock' in e) add(`stock:${e.stock}`, e.by);
    else if ('rep' in e) add(`rep:${e.rep}`, e.by);
    else if ('trust' in e) add(`trust:${e.trust}`, e.by);
    else if ('loan' in e) { add('money', e.loan.principal); add(`debt:${e.loan.from}`, -e.loan.principal); }
  };
  for (const e of choice.now ?? []) one(e);
  for (const l of choice.later ?? []) for (const e of l.do ?? []) one(e);
  return v;
}

/** True when a is at least as good as b on every axis and strictly better on one. */
export function dominates(a, b) {
  let better = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0, y = b[k] ?? 0;
    if (x < y) return false;
    if (x > y) better = true;
  }
  return better;
}

// ---- walking the strings of a city
const label = (arr, i) => (arr[i] && typeof arr[i] === 'object' && typeof arr[i].id === 'string' ? arr[i].id : String(i));

/** Every string in `value` as { path, text }. `skip(node)` true leaves a subtree out. */
export function* strings(value, where = '', skip = () => false) {
  if (typeof value === 'string') { yield { path: where, text: value }; return; }
  if (!value || typeof value !== 'object' || skip(value)) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], `${where}[${label(value, i)}]`, skip);
  } else {
    for (const [k, x] of Object.entries(value)) yield* strings(x, where ? `${where}.${k}` : k, skip);
  }
}

const FILES = ['city', 'calendar', 'houses', 'goods', 'stops', 'routes', 'agents', 'cards', 'letters', 'returns', 'events', 'notebook', 'terms', 'text'];
const isD5 = n => n && typeof n === 'object' && n.context === 'd5';

export function normalize(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}
export function bannedHit(text, banned) {
  const t = normalize(text);
  return banned.find(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t));
}

const DASH = /[\u2014\u2013]/;
const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*\.(com|org|net|edu|gov|io|uk|dev|app|info|co)\b/i;
const TODO = /\bTODO\b/i;

/** Lint one loaded city. Returns [{ rule, path, message }]. */
export function lintContent(content, { artIds, banned = [], city = content.cityId } = {}) {
  const out = [];
  const fail = (rule, where, message) => out.push({ rule, path: where, message });

  // rules 1 and 6: the schema
  try { validateContent(content, { art: artIds }); }
  catch (e) {
    if (!e.problems) throw e;
    for (const p of e.problems) fail(p.kind === 'schema' ? 1 : 6, p.path, p.message);
  }

  const cards = content.cards ?? [];
  const letters = content.letters ?? [];

  // rule 2
  const needSource = (what, x, where) => { if (!Array.isArray(x.sources) || !x.sources.length) fail(2, where, `${what} has no source`); };
  for (const c of cards) needSource('card', c, `cards[${c.id}]`);
  for (const l of letters) needSource('letter', l, `letters[${l.id}]`);
  for (const e of content.events ?? []) if (e.note !== undefined) needSource('event', e, `events[${e.id}]`);
  for (const n of content.notebook ?? []) needSource('notebook entry', n, `notebook[${n.id}]`);
  for (const k of ['title', 'about', 'interludes', 'ending']) {
    for (const p of content.text?.[k] ?? []) if (p.fact !== false) needSource('text piece (set "fact": false if it states none)', p, `text.${k}[${p.id}]`);
  }

  // rule 3 and 4
  const exempt = OPENING_LETTERS[city] ?? [];
  for (const c of cards) {
    const where = `cards[${c.id}]`;
    const ch = c.choices ?? [];
    if (!ch.some(x => (x.later ?? []).length)) fail(3, where, 'no choice has a later effect');
    for (const x of ch) {
      if (!(x.now ?? []).length && !(x.later ?? []).length) fail(3, `${where}.choices[${x.id}]`, 'choice has no effect');
    }
    for (const x of ch) for (const l of x.later ?? []) {
      const list = l.do ?? [];
      if (list.some(e => typeof e.money === 'number' && e.money > 0) && list.some(e => 'stock' in e && e.by < 0)) {
        fail(10, `${where}.choices[${x.id}]`, 'a later effect adds money and removes stock together; the stock may be gone by then and the money would still come');
      }
    }
    const sells = ch.some(y => (y.now ?? []).some(e => typeof e.money === 'number' && e.money > 0) && (y.now ?? []).some(e => 'stock' in e && e.by < 0));
    if (sells) for (const x of ch) {
      const effects = [...(x.now ?? []), ...(x.later ?? []).flatMap(l => l.do ?? [])];
      const laterMoney = (x.later ?? []).some(l => (l.do ?? []).some(e => typeof e.money === 'number' && e.money > 0));
      const nowMoney = (x.now ?? []).some(e => typeof e.money === 'number' && e.money !== 0);
      if (laterMoney && !nowMoney && !effects.some(e => 'stock' in e) && !HOLD_PAYS_LATER_LISTED.includes(`${c.id}/${x.id}`)) {
        fail(10, `${where}.choices[${x.id}]`, 'this choice keeps the stock and pays only later, while another choice on the card sells it: holding would pay as well as selling');
      }
    }
    if (exempt.includes(c.id)) continue;
    if (ch.length < 2) { fail(4, where, 'a card with one choice has no trade-off'); continue; }
    const vec = ch.map(choiceVector);
    for (let i = 0; i < ch.length; i++) for (let j = 0; j < ch.length; j++) {
      if (i !== j && dominates(vec[i], vec[j])) {
        fail(4, `${where}.choices[${ch[j].id}]`, `choice "${ch[i].id}" is at least as good on every axis and better on one, so "${ch[j].id}" is never worth taking`);
      }
    }
  }

  // rule 5
  const d5Entries = new Set((content.notebook ?? []).filter(isD5).map(n => n.id));
  for (const k of FILES) {
    for (const s of strings(content[k], k, isD5)) {
      const hit = bannedHit(s.text, banned);
      if (hit) fail(5, s.path, `banned stem "${hit}" in game text: "${s.text.slice(0, 60)}"`);
    }
  }
  const reachable = (node, where) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((x, i) => reachable(x, `${where}[${label(node, i)}]`)); return; }
    if (typeof node.unlock === 'string' && d5Entries.has(node.unlock)) fail(5, where, `unlocks the d5 entry "${node.unlock}"`);
    if (Array.isArray(node.unlocks)) for (const u of node.unlocks) if (d5Entries.has(u)) fail(5, where, `unlocks the d5 entry "${u}"`);
    for (const [k, x] of Object.entries(node)) reachable(x, `${where}.${k}`);
  };
  for (const k of ['cards', 'letters', 'events', 'agents', 'goods', 'stops']) reachable(content[k], k);

  // rule 7
  for (const k of [...FILES, 'sources']) {
    for (const s of strings(content[k], k)) {
      if (DASH.test(s.text)) fail(7, s.path, 'em or en dash');
      if (URL_RE.test(s.text)) fail(7, s.path, 'web address');
      if (TODO.test(s.text)) fail(7, s.path, 'TODO');
    }
  }

  // rule 9
  for (const c of cards) out.push(...tripFailures(content, c));

  // rule 8
  for (const [i, g] of (content.city?.gradients ?? []).entries()) {
    out.push(...gradientFailures(g, content.stops ?? [], `city.json.gradients[${i}] (${g.good})`));
  }
  return out;
}

/**
 * Rule 8 for one gradient. A tier is a stop id or a list of ids that tie among themselves; a tier's
 * stops must each cost at least as much as every stop of every earlier tier. A stop that does not
 * sell the good is skipped (a gradient may name a whole road and the good be sold on part of it).
 * Checked for the base and for each act's base. Returns [{ rule: 8, path, message }].
 */
export function gradientFailures(g, stops, where) {
  const byId = new Map(stops.map(s => [s.id, s]));
  const price = (id, act) => {
    const c = byId.get(id)?.sells?.[g.good];
    if (!c) return undefined;
    return act === undefined ? c.base : (c.baseByAct?.[act] ?? c.base);
  };
  const tiers = (g.from ?? []).map(t => (Array.isArray(t) ? t : [t]));
  const out = [];
  // the base, then each act's base when any listed stop gives one
  const acts = [undefined, ...[0, 1, 2].filter(a => tiers.flat().some(id => byId.get(id)?.sells?.[g.good]?.baseByAct))];
  for (const act of acts) {
    let floor, floorAt;
    for (const tier of tiers) {
      let top, topAt;
      for (const id of tier) {
        const p = price(id, act);
        if (p === undefined) continue;
        if (floor !== undefined && p < floor) {
          out.push({ rule: 8, path: where, message: `${g.good} at ${id} costs ${p}${act === undefined ? '' : ` in act ${act + 1}`}, under ${floor} at ${floorAt}, which the gradient puts before it` });
        }
        if (top === undefined || p > top) { top = p; topAt = id; }
      }
      if (top !== undefined && (floor === undefined || top > floor)) { floor = top; floorAt = topAt; }
    }
  }
  const seen = new Set();
  return out.filter(f => !seen.has(f.message) && seen.add(f.message));
}

export function report(tool, city, failures, summary) {
  for (const f of failures) console.log(`FAIL rule ${f.rule} (${RULES[f.rule] ?? f.rule}): ${f.path}: ${f.message}`);
  if (failures.length) {
    console.log(`${tool}: ${city}: ${failures.length} problem${failures.length === 1 ? '' : 's'}`);
    process.exitCode = 1;
  } else console.log(`${tool}: ${city}: ok${summary ? ` (${summary})` : ''}`);
}

export function parseArgs(argv) {
  const a = { city: 'cairo', overlay: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--overlay') a.overlay = path.resolve(argv[++i]);
    else if (!argv[i].startsWith('-')) a.city = argv[i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { city, overlay } = parseArgs(process.argv.slice(2));
    const content = await loadCity(city, { overlay });
    const artIds = await loadArtIds();
    const failures = lintContent(content, { artIds, banned: await loadBanned() });
    const n = (content.cards?.length ?? 0), l = (content.letters?.length ?? 0);
    report('lint-content', city, failures, `${n} cards, ${l} letters, ${content.sources.length} sources${artIds ? '' : ', art manifest not present so picture ids unchecked'}`);
  } catch (e) {
    console.log(`FAIL rule 6 (${RULES[6]}): ${e.message}`);
    console.log('lint-content: could not load the city');
    process.exitCode = 1;
  }
}
