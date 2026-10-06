// flag-partials.mjs: rank the spell map's "partial" entries, weakest first.
//
//   node Pathfinder/converter-assets/flag-partials.mjs           writes data/spell-map-review.md
//   node Pathfinder/converter-assets/flag-partials.mjs out.md    writes the list somewhere else
//   node Pathfinder/converter-assets/flag-partials.mjs --check   exits 1 if that file is stale
//   node Pathfinder/converter-assets/flag-partials.mjs --all     prints every scored entry as TSV
//
// WHY. spell-map.json's "partial" entries came from a second pass that fixed
// the first pass's misses, and no person has read them (#886). This scores each
// one on what the two data files can show about it and prints the weakest for
// Devon to read. It READS spell-map.json and never writes it: no entry is
// changed, removed or re-mapped here. The only file it writes is the review
// list, and that holds names, the fields compared and the map's own notes, no
// rule text.
//
// A reason is a measured difference between the PF1e spell and the PF2e spell
// it maps to, or a property of the entry itself. "Partial" already means the
// two spells differ, so no single reason says an entry is wrong; the score is
// how many of them pile up on one entry, weighted by how much each one costs a
// GM who trusts the map. Pure Node, no install, same output on every run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MAP_PATH = path.join(HERE, 'data', 'spell-map.json');
export const PF1_PATH = path.join(HERE, 'data', 'pf1-spells.json');
export const PF2_PATH = path.join(HERE, '..', 'data', 'spell.json');
export const REVIEW_PATH = path.join(HERE, 'data', 'spell-map-review.md');

// ---- the reasons ------------------------------------------------------------
// weight: 3 says the mapping itself may point at the wrong spell, 2 says a
// converted stat block will play differently at the table, 1 is a smaller
// difference or a property of the note. `decide` is the question a reviewer
// answers; it is printed once in the review list's legend.
export const REASONS = {
  text: { weight: 3, label: 'text far apart',
    decide: 'Is this the nearest PF2e spell at all, or should the entry be re-mapped or marked `none`?' },
  two: { weight: 2, label: 'two spells named',
    decide: 'Which of the two does a stat block get? The page prints both; say in the note when to use which, or drop one.' },
  rank: { weight: 2, label: 'rank gap',
    decide: 'Is a spell this many ranks away a fair stand-in at the creature\'s level, or does the note need to say so?' },
  cast: { weight: 2, label: 'casting time',
    decide: 'One of the pair is cast in a fight and the other is not. Can the creature still use it, or is this `none` for a stat block?' },
  focus: { weight: 2, label: 'focus spell',
    decide: 'A focus spell belongs to one class or domain. Is there a slot spell that does the job instead?' },
  save: { weight: 1, label: 'save or defence',
    decide: 'The target resists with a different save, or one side has none. Does the note need to say so?' },
  tradition: { weight: 1, label: 'tradition',
    decide: 'No PF1e class list that casts this lines up with a tradition that casts the PF2e spell. Is that acceptable for the creatures that have it?' },
  damage: { weight: 1, label: 'damage',
    decide: 'The damage type differs, or one spell deals damage and the other does not. Is the mapped spell still the same job?' },
  targets: { weight: 1, label: 'area against target',
    decide: 'One covers an area and the other picks targets. Does the note need to say so?' },
  duration: { weight: 1, label: 'duration',
    decide: 'The durations are two or more steps apart. Does the mapped spell last long enough (or end soon enough) to do the PF1e spell\'s job?' },
  legacy: { weight: 1, label: 'legacy spell',
    decide: 'The mapped spell is pre-Remaster. Is there a Remaster spell to name instead, or is legacy the best there is?' },
  name: { weight: 1, label: 'no shared name word',
    decide: 'Nothing in the names ties the pair together; the note is the only evidence. Does it hold up?' },
  shared: { weight: 1, label: 'note reused',
    decide: 'The same note sits on three or more entries. Is it true of this one?' },
  silent: { weight: 1, label: 'note names no mapped spell',
    decide: 'The note does not say which mapped spell it is talking about. Rewrite it to say what the PF2e spell does and does not cover.' },
};

// The cut: every partial entry scoring this much or more goes in the review
// list. Chosen so the list is short enough to read in one sitting; the suite
// pins how many entries it lets through.
export const CUT = 8;

// ---- text distance: match-spells.py's vectors, in Node -------------------------
const STOP = new Set(`a an the of to and or in on for with by is are be as at it its this that
you your each any all can if not no from into than then their them they one two
creature creatures target targets spell spells level round rounds minute minutes
hour hours day days feet foot ft save saving throw dc per caster check bonus
penalty may must also has have would will which who when while within up
other such only more less additional additionally`.split(/\s+/));
const words = (text) => (String(text || '').toLowerCase().match(/[a-z]+/g) || [])
  .filter((w) => w.length > 2 && !STOP.has(w));
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/@\w+\[[^\]]*\]/g, ' ');
// Modifiers and numerals say which version of a spell, not which spell.
const NAME_NOISE = new Set(['greater', 'lesser', 'mass', 'communal', 'improved', 'iii', 'vii', 'viii']);
const nameWords = (name) => new Set(words(name).filter((w) => !NAME_NOISE.has(w)).map((w) => w.replace(/s$/, '')));

function tfidf(docs) {
  const df = new Map();
  const tfs = docs.map((text) => {
    const tf = new Map();
    for (const w of words(text)) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    return tf;
  });
  const n = docs.length;
  const idf = (w) => Math.log((n + 1) / ((df.get(w) || 0) + 1)) + 1;
  const vec = (tf) => {
    const v = new Map();
    let sum = 0;
    for (const [w, c] of tf) { const x = c * idf(w); v.set(w, x); sum += x * x; }
    const norm = Math.sqrt(sum) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  };
  return { vectors: tfs.map(vec), vec: (text) => { const tf = new Map(); for (const w of words(text)) tf.set(w, (tf.get(w) || 0) + 1); return vec(tf); } };
}
const dot = (a, b) => { let s = 0; for (const [w, x] of a) { const y = b.get(w); if (y) s += x * y; } return s; };

// ---- the fields compared -------------------------------------------------------
const TRADITION_OF = {
  wizard: 'arcane', sorcerer: 'arcane', arcanist: 'arcane', magus: 'arcane', witch: 'arcane',
  bloodrager: 'arcane', summoner: 'arcane', 'summoner (unchained)': 'arcane',
  cleric: 'divine', oracle: 'divine', warpriest: 'divine', inquisitor: 'divine', paladin: 'divine', antipaladin: 'divine',
  druid: 'primal', ranger: 'primal', hunter: 'primal', shaman: 'primal',
  bard: 'occult', skald: 'occult', psychic: 'occult', mesmerist: 'occult', occultist: 'occult',
  spiritualist: 'occult', medium: 'occult',
};
export const pf1Traditions = (s) => [...new Set(Object.keys(s.levels || {}).map((c) => TRADITION_OF[c]).filter(Boolean))].sort();

// 'fight' is anything cast inside a round or three; 'slow' is a minute or more.
export function castClass(text) {
  const t = String(text || '').toLowerCase();
  if (!t || /see (text|below)/.test(t) && !/\d/.test(t)) return null;
  if (/minute|hour|day|week/.test(t)) return 'slow';
  if (/action|actino|round|reaction|free|^\d( (to|or) \d)?$/.test(t)) return 'fight';
  return null;
}

// 0 instantaneous, 1 rounds (up to a minute), 2 minutes, 3 hours, 4 days or
// longer, 5 permanent. null when the line does not say.
export function durationStep(text, sustained = false) {
  const t = String(text || '').toLowerCase();
  if (sustained) return 1;
  if (t === '') return 0;
  if (/instantaneous/.test(t)) return 0;
  if (/permanent|unlimited/.test(t)) return 5;
  if (/day|daily|week|month|year|24 hours/.test(t)) return 4;
  if (/hour/.test(t)) return 3;
  if (/^(up to )?1 minute$/.test(t)) return 1;
  if (/min/.test(t)) return 2;
  if (/round|turn|concentration|sustained/.test(t)) return 1;
  return null;
}
const STEP_NAME = ['instantaneous', 'rounds', 'minutes', 'hours', 'days or longer', 'permanent'];

// PF1e's save line: { stat, harmless } with stat null for "none" or no line.
export function pf1Save(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(/\b(will|fortitude|reflex)\b/);
  if (m) return { stat: m[1], harmless: /harmless/.test(t), known: true };
  if (t === '' || /^(none|no)\b/.test(t)) return { stat: null, harmless: false, known: true };
  return { stat: null, harmless: false, known: false };
}
// PF2e's: the save, or 'attack' when the spell rolls against AC or a DC.
export function pf2Defence(s) {
  const d = s.system.defense;
  if (d?.save?.statistic) return d.save.statistic;
  if (d?.passive?.statistic) return 'attack';
  if (s.system.traits.value.includes('attack')) return 'attack';
  return null;
}

const ENERGY = ['acid', 'cold', 'electricity', 'fire', 'force', 'sonic'];
const pf2DamageTypes = (s) => Object.values(s.system.damage || {})
  .filter((d) => (d.kinds || ['damage']).includes('damage')).map((d) => d.type).filter(Boolean);
const pf1DealsDamage = (s) => /\d+d\d+ (points? of )?([a-z]+ )?damage|damage per (caster )?level|\bd\d+ points of/.test(s.description || '');
const pf1MentionsDamage = (s) => /\bdamage\b/i.test(s.description || '');

const isCantrip = (s) => s.system.traits.value.includes('cantrip');
const pf2Rank = (s) => (isCantrip(s) ? 0 : s.system.level.value);
const isRitual = (s) => Boolean(s.system.ritual);

// One line a reviewer can read: the few fields compared, nothing else.
export function pf1Line(s) {
  const bits = [`level ${s.level}`, s.school];
  const tr = pf1Traditions(s);
  if (tr.length) bits.push(tr.join('/'));
  if (s.castingTime) bits.push(`cast ${s.castingTime}`);
  bits.push(`save ${s.save || 'none'}`);
  if (s.area) bits.push('area'); else if (s.target) bits.push('targets');
  if (s.duration) bits.push(`lasts ${s.duration}`);
  return bits.join('; ');
}
export function pf2Line(s) {
  const t = s.system;
  const bits = [isCantrip(s) ? 'cantrip' : `rank ${t.level.value}`];
  if (t.traits.value.includes('focus')) bits.push('focus');
  if (isRitual(s)) bits.push('ritual');
  if (t.traits.traditions.length) bits.push([...t.traits.traditions].sort().join('/'));
  bits.push(`cast ${/^\d/.test(t.time.value) && !/[a-z]/.test(t.time.value) ? t.time.value + ' actions' : t.time.value}`);
  bits.push(`save ${pf2Defence(s) || 'none'}`);
  bits.push(t.area ? 'area' : 'targets');
  bits.push(`lasts ${t.duration.value || (t.duration.sustained ? 'sustained' : 'instantaneous')}`);
  if (!t.publication.remaster) bits.push('legacy');
  return bits.join('; ');
}

// ---- scoring -------------------------------------------------------------------
// Returns every partial entry, weakest first: score descending, then name by
// code point so the order never depends on a locale.
export function scorePartials({ pf1, pf2, map }) {
  const pf1ByName = new Map(pf1.map((s) => [s.name, s]));
  const pf2ByName = new Map(pf2.map((s) => [s.name, s]));
  const pf2Index = new Map(pf2.map((s, i) => [s.name, i]));
  const model = tfidf(pf2.map((s) => stripTags(s.system.description.value)));

  const partial = Object.entries(map.map).filter(([, e]) => e.fit === 'partial');
  const noteUses = new Map();
  for (const [, e] of partial) noteUses.set(e.note, (noteUses.get(e.note) || 0) + 1);

  const out = [];
  for (const [name, entry] of partial) {
    const one = pf1ByName.get(name);
    const twos = entry.to.map((n) => pf2ByName.get(n));
    if (!one || twos.some((s) => !s)) throw new Error(`${name}: not in pf1-spells.json, or maps to a spell data/spell.json lacks`);
    const reasons = [];
    const add = (key, detail) => reasons.push({ key, detail });

    // text: where the mapped spell's text ranks among every PF2e spell's, by
    // cosine against the PF1e text. The better of two mapped spells counts.
    const v = model.vec(one.description);
    const sims = model.vectors.map((d) => dot(v, d));
    const place = (s) => { const mine = sims[pf2Index.get(s.name)]; let better = 0; for (const x of sims) if (x > mine) better++; return better + 1; };
    const textRank = Math.min(...twos.map(place));
    if (textRank > TEXT_RANK) add('text', `the mapped spell's text is the ${ordinal(textRank)} nearest of ${pf2.length} PF2e spells`);

    if (twos.length > 1) add('two', `maps to ${twos.map((s) => s.name).join(' and ')}`);

    // Every other comparison is against the mapped spell that comes closest,
    // so a second, looser spell in `to` does not flag the entry by itself.
    const gap = Math.min(...twos.map((s) => Math.abs(one.level - pf2Rank(s))));
    if (gap >= 3) add('rank', `PF1e level ${one.level} against ${twos.map((s) => (isCantrip(s) ? 'a cantrip' : `rank ${s.system.level.value}`)).join(' and ')}`);

    const c1 = castClass(one.castingTime);
    const c2 = twos.map((s) => castClass(s.system.time.value));
    if (c1 && c2.every((c) => c && c !== c1)) {
      add('cast', `PF1e ${one.castingTime} against ${twos.map((s) => (isRitual(s) ? 'a ritual of ' : '') + castWords(s.system.time.value)).join(' and ')}`);
    }

    if (twos.every((s) => s.system.traits.value.includes('focus'))) add('focus', `${twos.map((s) => s.name).join(' and ')}: focus`);

    const s1 = pf1Save(one.save);
    if (s1.known) {
      const differs = (s) => {
        const d = pf2Defence(s);
        if (s1.stat && !s1.harmless) return d !== s1.stat;
        return !s1.stat && d !== null && d !== 'attack';
      };
      if (twos.every(differs)) add('save', `PF1e ${s1.stat ? one.save : 'no save'} against ${twos.map((s) => pf2Defence(s) || 'no save').join(' and ')}`);
    }

    const t1 = pf1Traditions(one);
    const casters = twos.filter((s) => s.system.traits.traditions.length);
    if (t1.length && casters.length === twos.length && casters.every((s) => !s.system.traits.traditions.some((t) => t1.includes(t)))) {
      add('tradition', `PF1e lists read ${t1.join('/')} against ${casters.map((s) => [...s.system.traits.traditions].sort().join('/')).join(' and ')}`);
    }

    const e1 = (one.descriptors || []).filter((d) => ENERGY.includes(d));
    const dmg = (s) => {
      const types = pf2DamageTypes(s);
      if (e1.length && !e1.some((d) => types.includes(d) || s.system.traits.value.includes(d))) return `PF1e [${e1.join(', ')}] against ${types.length ? types.join(', ') + ' damage' : 'no such trait'}`;
      if (types.length && !pf1MentionsDamage(one)) return `${s.name} deals ${[...new Set(types)].join(', ')} damage; the PF1e text has no damage`;
      if (!types.length && pf1DealsDamage(one) && !/\bdamage\b/i.test(stripTags(s.system.description.value))) return `the PF1e spell rolls damage; ${s.name} deals none`;
      return '';
    };
    if (twos.every(dmg)) add('damage', dmg(twos[0]));

    const shape1 = one.area ? 'area' : one.target ? 'targets' : null;
    if (shape1 && twos.every((s) => (s.system.area ? 'area' : 'targets') !== shape1)) {
      add('targets', shape1 === 'area' ? 'PF1e covers an area; the mapped spell picks targets' : 'PF1e picks targets; the mapped spell covers an area');
    }

    const d1 = durationStep(one.duration || 'x');
    const d2 = twos.map((s) => durationStep(s.system.duration.value, s.system.duration.sustained));
    if (d1 !== null && d2.every((d) => d !== null && Math.abs(d - d1) >= 2)) {
      add('duration', `PF1e ${one.duration} (${STEP_NAME[d1]}) against ${twos.map((s, i) => `${s.system.duration.value || (s.system.duration.sustained ? 'sustained' : 'instantaneous')} (${STEP_NAME[d2[i]]})`).join(' and ')}`);
    }

    if (twos.every((s) => !s.system.publication.remaster)) add('legacy', `${twos.map((s) => `${s.name} (${s.system.publication.title})`).join(' and ')}`);

    const n1 = nameWords(name);
    if (!twos.some((s) => [...nameWords(s.name)].some((w) => n1.has(w)))) add('name', 'no word in common between the two names');

    if (noteUses.get(entry.note) >= 3) add('shared', `the same note is on ${noteUses.get(entry.note)} partial entries`);
    const note = entry.note.toLowerCase();
    if (!twos.some((s) => note.includes(s.name.toLowerCase()))) add('silent', 'the note does not name the mapped spell');

    out.push({
      name, to: entry.to.slice(), note: entry.note,
      score: reasons.reduce((n, r) => n + REASONS[r.key].weight, 0),
      reasons, textRank,
      pf1: pf1Line(one), pf2: twos.map((s) => `${s.name}: ${pf2Line(s)}`),
    });
  }
  out.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
// A mapped spell whose text ranks past this many nearer PF2e spells is "far".
export const TEXT_RANK = 100;
const ordinal = (n) => { const t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };
const castWords = (t) => (/^\d( (to|or) \d)?$/.test(t) ? `${t} actions` : t);

// The heaviest reason on an entry, the first in REASONS' order on a tie.
const top = (e) => Object.keys(REASONS).map((key) => e.reasons.find((r) => r.key === key)).filter(Boolean)
  .reduce((a, b) => (REASONS[b.key].weight > REASONS[a.key].weight ? b : a));

export function tally(list) {
  const by = Object.fromEntries(Object.keys(REASONS).map((k) => [k, 0]));
  for (const e of list) for (const r of e.reasons) by[r.key]++;
  return by;
}

// ---- the review list -----------------------------------------------------------
export function renderReview(all) {
  const cut = all.filter((e) => e.score >= CUT);
  const every = tally(all), inCut = tally(cut);
  const hist = new Map();
  for (const e of all) hist.set(e.score, (hist.get(e.score) || 0) + 1);
  const L = [];
  L.push('# Spell map review: the weakest "partial" entries');
  L.push('');
  L.push('Written by `node Pathfinder/converter-assets/flag-partials.mjs`. Do not edit it by hand:');
  L.push('`Pathfinder/tests/converter-spells.test.mjs` fails when this file is not what the script prints.');
  L.push('');
  L.push(`\`spell-map.json\` has ${all.length} entries with \`fit: "partial"\`. A second pass wrote them and no`);
  L.push('person has read them. This list scores every one on what the data can show and prints the');
  L.push(`${cut.length} that score ${CUT} or more, weakest first. **Nothing in the map was changed.** Each entry below`);
  L.push('is a question for Devon; the answer goes into `spell-map.json` by hand.');
  L.push('');
  L.push('"Partial" already means the two spells differ, so no single reason says an entry is wrong. The');
  L.push('score is how many pile up on one entry. Names, the fields compared and the map\'s own note are');
  L.push('all that is printed; open the Spells tab of the Conversion Codex for either spell\'s text.');
  L.push('');
  L.push('## What each reason measures, and what to decide');
  L.push('');
  L.push(`| Reason | Weight | Of ${all.length} | Of the ${cut.length} below | Decide |`);
  L.push('| --- | --- | --- | --- | --- |');
  for (const [k, r] of Object.entries(REASONS)) L.push(`| ${r.label} | ${r.weight} | ${every[k]} | ${inCut[k]} | ${r.decide} |`);
  L.push('');
  L.push('How each is measured:');
  L.push('');
  L.push(`- **text far apart**: both descriptions as word vectors (the weighting \`match-spells.py\` uses). Flagged when more than ${TEXT_RANK} of the PF2e spells on file read nearer to the PF1e text than the mapped one does.`);
  L.push('- **two spells named**: `to` holds two names.');
  L.push('- **rank gap**: PF1e level (the lowest on any class list) and PF2e rank are three or more apart; a cantrip counts as 0.');
  L.push('- **casting time**: one is cast in actions or rounds, the other takes a minute or more (every ritual does).');
  L.push('- **focus spell**: the mapped spell has the focus trait.');
  L.push('- **save or defence**: the PF1e save line names one save and the mapped spell uses another, an attack roll or none; or PF1e has no save and the mapped spell has one. A harmless PF1e save is not compared.');
  L.push('- **tradition**: PF1e class lists read as traditions (wizard, sorcerer, arcanist, magus, witch, bloodrager, summoner: arcane; cleric, oracle, warpriest, inquisitor, paladin, antipaladin: divine; druid, ranger, hunter, shaman: primal; bard, skald, psychic, mesmerist, occultist, spiritualist, medium: occult), and none of them casts the mapped spell. Rituals and focus spells have no tradition and are not compared.');
  L.push('- **damage**: a PF1e acid, cold, electricity, fire, force or sonic descriptor the mapped spell lacks; or one spell rolls damage and the other\'s text never says "damage".');
  L.push('- **area against target**: the PF1e spell has an Area line and the mapped spell has no area, or the reverse.');
  L.push('- **duration**: on the steps instantaneous, rounds (up to a minute), minutes, hours, days or longer, permanent, the pair is two or more apart.');
  L.push('- **legacy spell**: the mapped spell is from a pre-Remaster book.');
  L.push('- **no shared name word**: the two names share no word (greater, lesser, mass and numerals aside).');
  L.push('- **note reused**: the same note, word for word, is on three or more partial entries.');
  L.push('- **note names no mapped spell**: the note never names the spell in `to`.');
  L.push('');
  L.push('Where a `to` holds two spells, every comparison but the first two is made against whichever comes');
  L.push('closer, so a looser second spell does not flag an entry by itself.');
  L.push('');
  L.push('## Scores');
  L.push('');
  L.push('| Score | Entries |');
  L.push('| --- | --- |');
  for (const s of [...hist.keys()].sort((a, b) => b - a)) L.push(`| ${s}${s === CUT ? ' (the cut)' : ''} | ${hist.get(s)} |`);
  L.push('');
  L.push(`\`node Pathfinder/converter-assets/flag-partials.mjs --all\` prints all ${all.length} with their reasons.`);
  L.push('');
  L.push(`## The ${cut.length} weakest`);
  L.push('');
  cut.forEach((e, i) => {
    L.push(`### ${i + 1}. ${e.name} → ${e.to.join(' + ')} (score ${e.score})`);
    L.push('');
    L.push(`- PF1e: ${e.pf1}`);
    for (const p of e.pf2) L.push(`- PF2e ${p}`);
    L.push(`- Note on file: ${e.note ? `"${e.note}"` : 'none'}`);
    L.push('- Flagged for:');
    for (const r of e.reasons) L.push(`  - ${REASONS[r.key].label}: ${r.detail}`);
    L.push(`- Decide: keep as partial, re-map, or mark \`none\`. Start with: ${REASONS[top(e).key].decide}`);
    L.push('');
  });
  return L.join('\n');
}

export function load() {
  const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  return { pf1: read(PF1_PATH), pf2: read(PF2_PATH), map: read(MAP_PATH) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = scorePartials(load());
  const text = renderReview(all);
  if (process.argv.includes('--all')) {
    console.log(['score', 'pf1', 'to', 'reasons'].join('\t'));
    for (const e of all) console.log([e.score, e.name, e.to.join(' + '), e.reasons.map((r) => r.key).join(',')].join('\t'));
  } else if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(REVIEW_PATH) ? fs.readFileSync(REVIEW_PATH, 'utf8') : '';
    if (onDisk !== text) { console.error('spell-map-review.md is stale: run flag-partials.mjs'); process.exit(1); }
    console.log(`spell-map-review.md is current: ${all.length} partial entries scored`);
  } else {
    const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || REVIEW_PATH;
    fs.writeFileSync(out, text);
    console.log(`${all.length} partial entries scored, ${all.filter((e) => e.score >= CUT).length} at ${CUT} or more -> ${path.relative(process.cwd(), out)}`);
  }
}
