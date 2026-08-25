// brief.js — reading a sentence into a program brief, with a table of phrases
// and no model behind it.
//
// The wishlist called this item "prompt-to-floorplan: natural language →
// parameters", and named the phase "Generation & AI". The AI half is not
// here, and this file is the honest remainder: a pattern table, a number-word
// reader, and a habit of saying exactly which words it understood and which
// it threw away. It cannot infer, generalize, or be surprised — type
// something it has no row for and it will tell you it ignored it rather than
// guess.
//
// That honesty is the whole design. A parser that quietly did its best with
// "a warm, community-facing school" would produce a building nobody asked for
// and no way to tell that had happened. So `parseBrief` returns `matched` —
// every phrase it acted on, and what it set — alongside `ignored`, the words
// left over. The panel prints both, and what you read back is precisely what
// the generator was told.
//
// Pure module: no three.js, no DOM. Exercised by test/brief.test.mjs.

import { normalizeBrief, MIN_STUDENTS, MAX_STUDENTS, DEFAULT_BRIEF } from './program.js';

// ---------- numbers written as words ----------

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

const WORD_NUM = new RegExp(
  `\\b((?:${Object.keys(ONES).join('|')}|${Object.keys(TENS).join('|')})` +
  `(?:[ -](?:${Object.keys(ONES).join('|')}))?)` +
  '(?:\\s+(hundred|thousand))?\\b', 'g');

// "six hundred" → 600, "twelve hundred" → 1200, "thirty two" → 32. Deliberately
// shallow: it handles the ways somebody writes a school's size out loud and
// nothing else. "One thousand four hundred and six" is not a school size
// anybody says, and pretending to parse it would be pretending.
function wordToNumber(words, scale) {
  const parts = words.toLowerCase().split(/[ -]+/);
  let n = 0;
  for (const p of parts) {
    if (p in TENS) n += TENS[p];
    else if (p in ONES) n += ONES[p];
    else return null;
  }
  if (scale === 'hundred') n *= 100;
  else if (scale === 'thousand') n *= 1000;
  return n;
}

// Every number in the text, digits and words alike, with where it was found —
// so a rule can ask "was there a number just before the word 'students'?"
// without re-scanning the string itself.
export function numbersIn(text) {
  const out = [];
  const s = String(text || '');
  for (const m of s.matchAll(/\b(\d[\d,]*)\b/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push({ n, at: m.index, len: m[0].length, text: m[0] });
  }
  for (const m of s.matchAll(WORD_NUM)) {
    const n = wordToNumber(m[1], m[2]);
    if (n !== null) out.push({ n, at: m.index, len: m[0].length, text: m[0] });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------- the phrase table ----------
//
// Order matters the way it does in occupancy.js's use table: the first row
// whose pattern fires wins the field, so the specific phrasings sit above the
// general ones. "junior high" must reach `middle` before "high" does.
//
// A row is `{ field, value, match }` for a flag, or `{ field, near }` for a
// number that has to sit beside a word — `near` is the pattern the number is
// looked for around.
export const BAND_RULES = [
  { value: 'middle', match: /junior high|middle school|middle-school|\bmiddle\b|\bjr\.? ?high\b|intermediate school|grades? 6|6-?8\b/ },
  { value: 'high', match: /high school|high-school|secondary school|\bsenior high\b|\bhigh\b|grades? 9|9-?12\b/ },
  { value: 'elementary', match: /elementary|primary school|grade school|\bprimary\b|infant school|\bk-?5\b|\bk-?6\b|kindergarten|grades? k/ },
];

const FLAG_RULES = [
  { field: 'gym', value: false, match: /\bno gym|without a gym|no gymnasium|\bno pe\b/ },
  { field: 'gym', value: true, match: /\bwith a gym|\bgymnasium\b|\bgym\b|sports hall/ },
  { field: 'cafeteria', value: false, match: /no cafeteria|without a cafeteria|no dining|no lunch ?room/ },
  { field: 'cafeteria', value: true, match: /cafeteria|dining hall|lunch ?room|canteen/ },
  { field: 'library', value: false, match: /no library|without a library|no media cent/ },
  { field: 'library', value: true, match: /librar|media cent|learning commons/ },
  { field: 'site', value: false, match: /no site|building only|no grounds|no car ?park|no parking/ },
  { field: 'site', value: true, match: /\bsite\b|grounds|playing field|car ?park|parking lot|playground/ },
];

// Storeys said as words rather than as a number beside "storeys": "a
// single-storey school", "two-storey", "on three levels".
const STOREY_WORDS = [
  { value: 1, match: /single[- ]stor(?:e?y|ies)|one[- ]stor(?:e?y|ies)|\bsingle[- ]level\b|all on one floor|one floor\b/ },
  { value: 2, match: /two[- ]stor(?:e?y|ies)|double[- ]stor(?:e?y|ies)|two floors|two levels/ },
  { value: 3, match: /three[- ]stor(?:e?y|ies)|three floors|three levels/ },
  { value: 4, match: /four[- ]stor(?:e?y|ies)|four floors|four levels/ },
];

// Words a number can be sitting next to, and the field it then means. A
// number only counts what is *touching* it: "600 students" and "enrollment of
// 600" both read, and "600 students on two storeys" does not read the two as
// another enrollment, because "students" is four words away from it by then.
// That adjacency rule is the whole of the disambiguation here, and it is why
// there is no scoring and nothing to tune.
const NEAR = [
  { field: 'students', pattern: /students?|pupils?|kids|children|enroll?ments?|enrolled|capacity|places/ },
  { field: 'storeys', pattern: /stor(?:e?y|ies)|floors?|levels?/ },
  { field: 'seed', pattern: /seeds?|variants?|versions?|schemes?/ },
];
const NEAR_WINDOW = 18;
// What may sit between a number and the word it counts and still count as
// touching it: whitespace, punctuation, and the handful of words English puts
// there ("enrollment *of* 600", "capacity *is about* 900").
const JOINER = /^[\s:=,–—-]*(?:of|is|are|at|for|about|around|approx\.?|approximately|roughly|near|nearly|up to|under|over)?[\s:=,–—-]*$/;

const clean = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------- the parse ----------

export function parseBrief(text, base = DEFAULT_BRIEF) {
  const raw = String(text || '');
  const s = clean(raw);
  const out = { ...normalizeBrief(base) };
  const matched = [];
  // Character spans this parse consumed, so what's left over can be reported
  // truthfully rather than estimated.
  const used = [];
  const claim = (at, len) => { if (at >= 0) used.push([at, at + len]); };

  const say = (field, value, phrase, at, len) => {
    matched.push({ field, value, phrase });
    claim(at, len);
    out[field] = value;
  };

  // 1. Numbers that sit next to a word naming what they count. `touching`
  // returns the span of that word so the phrase reported back — and the text
  // marked as understood — is "600 students" rather than a bare 600.
  const touching = (num, pattern) => {
    const end = num.at + num.len;
    const after = s.slice(end, end + NEAR_WINDOW);
    let m = after.match(pattern);
    if (m && JOINER.test(after.slice(0, m.index))) {
      return { at: num.at, len: end - num.at + m.index + m[0].length };
    }
    const from = Math.max(0, num.at - NEAR_WINDOW);
    const before = s.slice(from, num.at);
    // The *last* occurrence in the window is the near one, so scan for it.
    let last = null;
    for (const b of before.matchAll(new RegExp(pattern.source, 'g'))) last = b;
    m = last;
    if (m && JOINER.test(before.slice(m.index + m[0].length))) {
      return { at: from + m.index, len: end - (from + m.index) };
    }
    return null;
  };

  for (const num of numbersIn(s)) {
    for (const rule of NEAR) {
      const span = touching(num, rule.pattern);
      if (!span) continue;
      const phrase = s.slice(span.at, span.at + span.len);
      if (rule.field === 'students') {
        say('students', Math.min(MAX_STUDENTS, Math.max(MIN_STUDENTS, num.n)),
          phrase, span.at, span.len);
      } else if (rule.field === 'storeys') {
        say('storeys', Math.min(4, Math.max(1, num.n)), phrase, span.at, span.len);
      } else {
        say('seed', Math.min(0x7fffffff, Math.max(1, num.n)), phrase, span.at, span.len);
      }
      break;
    }
  }

  // 2. A bare number with nothing beside it is the enrollment, since that is
  // the only quantity anybody puts in a sentence like "a middle school for
  // 600". Only when nothing else claimed a student count.
  if (!matched.some((m) => m.field === 'students')) {
    const spare = numbersIn(s).filter((n) => !used.some(([a, b]) => n.at >= a && n.at < b));
    const plausible = spare.find((n) => n.n >= MIN_STUDENTS && n.n <= MAX_STUDENTS);
    if (plausible) {
      say('students', plausible.n, `${plausible.text} (read as enrollment)`, plausible.at, plausible.len);
    }
  }

  // 3. The grade band.
  for (const rule of BAND_RULES) {
    const m = s.match(rule.match);
    if (!m) continue;
    say('band', rule.value, m[0], m.index, m[0].length);
    break;
  }

  // 4. Storeys written as words.
  if (!matched.some((m) => m.field === 'storeys')) {
    for (const rule of STOREY_WORDS) {
      const m = s.match(rule.match);
      if (!m) continue;
      say('storeys', rule.value, m[0], m.index, m[0].length);
      break;
    }
  }

  // 5. The flags. First row per field wins, so a "no gym" ahead of the plain
  // "gym" row is what makes the negative readable at all.
  const claimed = new Set();
  for (const rule of FLAG_RULES) {
    if (claimed.has(rule.field)) continue;
    const m = s.match(rule.match);
    if (!m) continue;
    claimed.add(rule.field);
    say(rule.field, rule.value, m[0], m.index, m[0].length);
  }

  return {
    brief: normalizeBrief(out),
    matched,
    ignored: leftover(s, used),
    // The sentence the panel prints back. Not a paraphrase — a list of the
    // fields that actually moved.
    echo: matched.length
      ? matched.map((m) => describe(m)).join(', ')
      : 'nothing recognised',
  };
}

function describe(m) {
  if (m.field === 'students') return `${m.value} students`;
  if (m.field === 'band') return `${m.value} school`;
  if (m.field === 'storeys') return `${m.value} storey${m.value === 1 ? '' : 's'}`;
  if (m.field === 'seed') return `seed ${m.value}`;
  return `${m.value ? 'with' : 'without'} a ${m.field === 'site' ? 'site' : m.field}`;
}

// Words nothing matched, minus the connective tissue nobody means anything by.
// This is the half of the output that keeps the tool honest: if you wrote a
// paragraph and five words come back matched, the other forty are listed.
const FILLER = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'with',
  'is', 'be', 'it', 'that', 'this', 'we', 'i', 'want', 'need', 'please',
  'make', 'build', 'generate', 'create', 'design', 'school', 'building',
  'about', 'around', 'roughly', 'some', 'my', 'our', 'new', 'me', 'give',
]);

function leftover(s, used) {
  const words = [];
  for (const m of s.matchAll(/[a-z][a-z'-]*|\d[\d,]*/g)) {
    const at = m.index;
    if (used.some(([a, b]) => at >= a && at < b)) continue;
    const w = m[0];
    if (FILLER.has(w)) continue;
    words.push(w);
  }
  return [...new Set(words)];
}
