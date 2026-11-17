// Reading level (ARCHITECTURE 6.3): node tools/reading-level.mjs [city] [--overlay <dir>]
// from Projects/Merchant/. Prints one FAIL line per problem, the ten worst units on failure,
// then one summary line; exits 1 on any failure.
//
// Every player-facing text unit gets a Flesch-Kincaid grade, 0.39 * words per sentence +
// 11.8 * syllables per word - 15.59, from the counter below. A word that is a term (or one of
// its forms), a stop name, a good name or a word of a real person's name counts as two
// syllables whatever its length, and a {template} slot counts as one two-syllable word, so a
// place name does not push a sentence over. A numeral counts as two syllables.
import { pathToFileURL } from 'node:url';
import { loadCity, parseArgs, report, normalize } from './lint-content.mjs';

// The ceilings. Raised only by a recorded decision (ARCHITECTURE 6.3).
export const CEILINGS = {
  body: 7.0,        // each card body, letter body and event notice body
  note: 8.0,        // each note, notebook body, interlude, About, title-screen and ending piece
  fileMean: 6.5,    // the mean grade over all units of one file
  sentence: 22,     // words in one sentence, any unit
};

// ---- syllables
// The usual vowel-group rule with silent-e, -ed and -es corrections, a split for vowel pairs
// that are two sounds, and a short list of words the rule gets wrong.
const EXCEPT = {
  every: 2, everyone: 3, evening: 2, business: 2, idea: 3, area: 3, plea: 1, flea: 1, being: 2,
  poem: 2, poet: 2, quiet: 2, science: 2, society: 4, family: 3, real: 1, really: 2,
  lion: 2, violin: 3, giant: 2, diary: 3, cruel: 2, fuel: 2, create: 2, creature: 2, theatre: 2, theater: 3,
};

export function syllables(word) {
  let w = normalize(word).replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w in EXCEPT) return EXCEPT[w];
  if (w.length <= 3) return 1;
  if (/[^aeiouy]es$/.test(w) && !/(?:[sxz]|ch|sh|[cgs])es$/.test(w)) w = w.slice(0, -2);           // makes, hopes, trades
  else if (/[^td]ed$/.test(w)) w = w.slice(0, -2);                                                     // asked, played, agreed
  else if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) w = w.slice(0, -1);                      // cake, whale
  w = w.replace(/^y/, '');
  let n = (w.match(/[aeiouy]+/g) ?? []).length;
  // two sounds in one vowel pair: radio, India, area, Joel, Samuel; not tion, cial, cious, gion
  n += (w.match(/(?<![tcsg])(?:ia|io)(?!n$|ns$|us$|l)/g) ?? []).length;
  n += (w.match(/ua(?!r|n|g|l)|uo|iu|oe(?!s?$)|eo(?![pr])/g) ?? []).length;
  return Math.max(n, 1);
}

// ---- words and sentences
const TOKEN = /\{[^}]*\}|\d[\d,.]*|[A-Za-zÀ-ɏ]+(?:['’][A-Za-z]+)*/g;

export function sentences(text) {
  return text.split(/[.!?]+["”')\]]*(?:\s+|$)/).map(s => s.trim()).filter(s => /[A-Za-z0-9{]/.test(s));
}

export function wordsOf(sentence) {
  return (sentence.match(TOKEN) ?? []).flatMap(t => (t.includes('-') ? t.split('-') : [t]));
}

/** Flesch-Kincaid grade of a text, or null when it has no words. `fixed` is a Set of
    normalized words that count as two syllables. */
export function fkGrade(text, fixed = new Set()) {
  const ss = sentences(text);
  let words = 0, syl = 0;
  for (const s of ss) {
    for (const t of wordsOf(s)) {
      words++;
      const k = normalize(t).replace(/['’]s$/, '').replace(/[^a-z0-9]/g, '');
      syl += t[0] === '{' || /^\d/.test(t) || fixed.has(k) ? 2 : syllables(t);
    }
  }
  if (!words || !ss.length) return null;
  return 0.39 * (words / ss.length) + 11.8 * (syl / words) - 15.59;
}

export function longestSentence(text) {
  return Math.max(0, ...sentences(text).map(s => wordsOf(s).length));
}

// ---- the units of a city
/** Every player-facing text of a loaded city: { file, path, kind, text, ceiling }. */
export function unitsOf(content) {
  const out = [];
  const add = (file, path, kind, text, ceiling) => { if (typeof text === 'string' && text.trim()) out.push({ file, path, kind, text, ceiling }); };
  const paper = (file, p, x, bodyKind) => {
    add(file, `${p}.title`, 'title', x.title, null);
    add(file, `${p}.body`, bodyKind, x.body, CEILINGS.body);
    for (const c of x.choices ?? []) {
      add(file, `${p}.choices[${c.id}].label`, 'label', c.label, null);
      add(file, `${p}.choices[${c.id}].hint`, 'hint', c.hint, null);
    }
    add(file, `${p}.note`, 'note', x.note, CEILINGS.note);
  };
  for (const c of content.cards ?? []) paper(`cards/${c.group}.json`, `cards[${c.id}]`, c, 'card body');
  for (const l of content.letters ?? []) paper('letters.json', `letters[${l.id}]`, l, 'letter');
  for (const e of content.events ?? []) {
    add('events.json', `events[${e.id}].notice.title`, 'title', e.notice?.title, null);
    add('events.json', `events[${e.id}].notice.body`, 'notice body', e.notice?.body, CEILINGS.body);
    add('events.json', `events[${e.id}].interlude`, 'interlude', e.interlude, CEILINGS.note);
    add('events.json', `events[${e.id}].note`, 'note', e.note, CEILINGS.note);
  }
  for (const n of content.notebook ?? []) {
    add('notebook.json', `notebook[${n.id}].title`, 'title', n.title, null);
    add('notebook.json', `notebook[${n.id}].body`, 'notebook body', n.body, CEILINGS.note);
  }
  for (const k of ['title', 'about', 'interludes', 'ending']) {
    for (const p of content.text?.[k] ?? []) {
      add('text.json', `text.${k}[${p.id}].title`, 'title', p.title, null);
      add('text.json', `text.${k}[${p.id}].body`, 'text piece', p.body, CEILINGS.note);
    }
  }
  return out;
}

/** Words that count as two syllables: terms and their forms, stop and good names, and the
    words of the names of real people (the notebook's people tab). */
export function fixedWords(content) {
  const set = new Set();
  const addPhrase = s => { for (const t of wordsOf(s ?? '')) set.add(normalize(t).replace(/['’]s$/, '').replace(/[^a-z0-9]/g, '')); };
  for (const t of content.terms ?? []) { addPhrase(t.word); for (const f of t.forms ?? []) addPhrase(f); }
  for (const s of content.stops ?? []) addPhrase(s.name);
  for (const g of content.goods ?? []) addPhrase(g.name);
  for (const n of content.notebook ?? []) if (n.tab === 'people') addPhrase(n.title);
  set.delete('');
  return set;
}

// ---- the term rule
const unlocksOf = x => {
  const found = new Set(x.unlocks ?? []);
  const walk = n => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.unlock === 'string') found.add(n.unlock);
    Object.values(n).forEach(walk);
  };
  walk(x.choices);
  return found;
};
/** Entries a paper's `when` requires to be in the notebook already: a notebook leaf on every path. */
function requiredEntries(when, found = new Set()) {
  if (!when || typeof when !== 'object') return found;
  if (typeof when.notebook === 'string') found.add(when.notebook);
  if (Array.isArray(when.all)) for (const c of when.all) requiredEntries(c, found);
  return found;
}

function termPattern(term) {
  const forms = [term.word, ...(term.forms ?? [])].map(f => normalize(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[^a-z0-9])(?:${forms.join('|')})(?![a-z0-9])`);
}

/** Lint a loaded city. Returns { failures: [{ rule, path, message, grade? }], units, means }. */
export function readingLevel(content) {
  const failures = [];
  const fail = (rule, path, message, extra = {}) => failures.push({ rule, path, message, ...extra });
  const fixed = fixedWords(content);
  const units = unitsOf(content);

  const byFile = new Map();
  for (const u of units) {
    u.grade = fkGrade(u.text, fixed);
    if (u.grade === null) continue;
    if (u.ceiling !== null && u.grade > u.ceiling) fail('grade ceiling', `${u.file}: ${u.path}`, `${u.kind} is grade ${u.grade.toFixed(1)}, ceiling ${u.ceiling.toFixed(1)}`, { grade: u.grade });
    const long = longestSentence(u.text);
    if (long > CEILINGS.sentence) fail('sentence length', `${u.file}: ${u.path}`, `a sentence of ${long} words, ceiling ${CEILINGS.sentence}`, { grade: u.grade });
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file).push(u);
  }
  const means = {};
  for (const [file, list] of byFile) {
    const graded = list.filter(u => u.grade !== null);
    const mean = graded.reduce((a, u) => a + u.grade, 0) / graded.length;
    means[file] = mean;
    if (mean > CEILINGS.fileMean) fail('file mean', file, `mean grade ${mean.toFixed(2)} over ${graded.length} units, ceiling ${CEILINGS.fileMean.toFixed(1)}`, { grade: mean });
  }

  // terms: each needs an entry; a card or letter that uses one must unlock it or require it
  const entries = new Set((content.notebook ?? []).map(n => n.id));
  for (const t of content.terms ?? []) {
    if (!entries.has(t.entry)) { fail('term rule', `terms[${t.word}]`, `has no notebook entry "${t.entry}"`); continue; }
    const pat = termPattern(t);
    const papers = [
      ...(content.cards ?? []).map(c => ({ file: `cards/${c.group}.json`, where: `cards[${c.id}]`, x: c })),
      ...(content.letters ?? []).map(l => ({ file: 'letters.json', where: `letters[${l.id}]`, x: l })),
    ];
    for (const { where, x } of papers) {
      const texts = [x.title, x.body, ...(x.choices ?? []).flatMap(c => [c.label, c.hint])].filter(Boolean);
      if (!texts.some(s => pat.test(normalize(s)))) continue;
      if (unlocksOf(x).has(t.entry) || requiredEntries(x.when).has(t.entry)) continue;
      fail('term rule', where, `uses the term "${t.word}" but neither unlocks entry "${t.entry}" nor requires it in "when"`);
    }
  }
  return { failures, units, means };
}

function worst(units, n = 10) {
  return units.filter(u => u.grade !== null).sort((a, b) => b.grade - a.grade).slice(0, n);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { city, overlay } = parseArgs(process.argv.slice(2));
    const content = await loadCity(city, { overlay });
    const { failures, units, means } = readingLevel(content);
    for (const f of failures) console.log(`FAIL ${f.rule}: ${f.path}: ${f.message}`);
    if (failures.length) {
      console.log('worst ten units:');
      for (const u of worst(units)) console.log(`  grade ${u.grade.toFixed(1).padStart(5)}  ${u.file}: ${u.path} (${u.kind})`);
      console.log(`reading-level: ${city}: ${failures.length} problem${failures.length === 1 ? '' : 's'}`);
      process.exitCode = 1;
    } else {
      const graded = units.filter(u => u.grade !== null);
      const mean = graded.length ? graded.reduce((a, u) => a + u.grade, 0) / graded.length : 0;
      console.log(`reading-level: ${city}: ok (${graded.length} units, mean grade ${mean.toFixed(1)}, ${Object.keys(means).length} files)`);
    }
  } catch (e) {
    console.log(`FAIL reading-level: ${e.message}`);
    process.exitCode = 1;
  }
}
