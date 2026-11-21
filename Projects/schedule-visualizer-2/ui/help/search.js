// Help's search (spec 14; DESIGN 16.10 and 16.12 item 7; ARCHITECTURE 22.12):
// the index and the matcher, in plain functions with no DOM, so a Node test
// (test/engine/help-search.test.mjs) holds them. ./index.js draws the field,
// the results and the announcements.
//
//   buildIndex(model) -> entries     from helpModel(), the same data the dialog draws
//   search(entries, query) -> { query, tokens, short, results }
//   announcement(count, query) -> the sentence the live region says
//
// An entry is one part of Help a reader can be taken to:
//   { id, part, key, title, section, text, paragraph?, lead? }
// `part` is the body part it sits in (sections, keys, gestures, words, numbers),
// `key` which thing in that part (a section's id, a shortcut's id, a device, a
// word, a numbers block), `title` what a result is called, `section` the part's
// own title, and `text` the sentences. A section's entries are its paragraphs,
// one each: `paragraph` names which (purpose, first, more, part-0, …) and `lead`
// is its first words, the second line of a result whose title others share. ./index.js puts data-find="part:key" on
// the heading a result opens, so an entry names a place by those two strings.
//
// What matches: every word of the query, in any order, ignoring case and
// accents. A query word matches a word of the entry that begins with it ("stair"
// finds stairwell; "end" finds ends but not "bend"). Words are runs of letters
// and digits, so "dead-end" and "dead end" are the same query. The title counts
// too, and a match in it ranks first. Nothing with fewer than MIN_CHARS letters
// and digits is searched.

export const MIN_CHARS = 2;
// A shown sentence is cut to about this many characters, around its first match.
export const SNIPPET_CHARS = 240;

// The titles of the body's parts, read by ./index.js for the headings so a
// result's section is the heading it opens under.
export function partTitles(model) {
  return {
    sections: 'The ' + model.sections.length + ' sections',
    keys: 'Keyboard shortcuts',
    gestures: 'Mouse, touch, pen and keyboard on a map',
    words: 'The words the planner uses',
    numbers: 'How the numbers are worked out',
  };
}

// Lower case, accents off, as a string and where each of its characters came
// from in the original (so a match can be shown in the text as it was written).
export function fold(text) {
  const source = String(text === undefined || text === null ? '' : text);
  let folded = '';
  const from = [];
  const to = [];
  let at = 0;
  for (const character of source) {
    const plain = character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    // a mark that folds to nothing belongs to the letter before it
    if (plain === '' && to.length > 0) to[to.length - 1] = at + character.length;
    for (let i = 0; i < plain.length; i += 1) {
      from.push(at);
      to.push(at + character.length);
    }
    folded += plain;
    at += character.length;
  }
  return { folded, from, to };
}

// The words of a folded string: [{ word, start, end }] in folded positions.
function wordsOf(folded) {
  const found = [];
  for (const match of folded.matchAll(/[\p{L}\p{N}]+/gu)) found.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  return found;
}

// The query's words, each once, in the order typed.
export function queryTokens(query) {
  const seen = [];
  for (const { word } of wordsOf(fold(query).folded)) if (!seen.includes(word)) seen.push(word);
  return seen;
}

// Sentences, for choosing the one a result shows. A full stop inside a number
// (6.1) or a name (Ctrl+F.) does not end one: the next must start after a space.
function sentencesOf(text) {
  const pieces = String(text).split(/(?<=[.!?])\s+/u).filter((piece) => piece.trim() !== '');
  return pieces.length > 0 ? pieces : [String(text)];
}

// The first words of a paragraph, as the second line that tells apart results
// with one title (Building's parts): up to LEAD_WORDS words, ending at the
// sentence's end when that comes first.
export const LEAD_WORDS = 6;
export function leadOf(text) {
  const first = sentencesOf(String(text).trim())[0].trim();
  const words = first.split(/\s+/u);
  if (words.length <= LEAD_WORDS) return first;
  return words.slice(0, LEAD_WORDS).join(' ').replace(/[,;:(]+$/u, '') + '…';
}

function entry(part, key, title, section, text, paragraph) {
  const body = String(text === undefined || text === null ? '' : text).trim();
  const made = { id: part + ':' + key + ':' + title + (paragraph ? ':' + paragraph : ''), part, key: String(key), title: String(title), section, text: body };
  if (paragraph) {
    made.paragraph = paragraph;
    made.lead = (paragraph === 'first' ? 'First: ' : '') + leadOf(body);
  }
  return made;
}

// The index of everything Help says, from the model the dialog draws.
export function buildIndex(model) {
  const titles = partTitles(model);
  const entries = [];
  const add = (...args) => {
    const made = entry(...args);
    if (made.text !== '') entries.push(made);
  };
  for (const section of model.sections) {
    // each paragraph its own entry, named as ./index.js marks it (data-paragraph)
    add('sections', section.id, section.name, titles.sections, section.purpose, 'purpose');
    add('sections', section.id, section.name, titles.sections, section.first, 'first');
    add('sections', section.id, section.name, titles.sections, section.more, 'more');
    section.parts.forEach((text, at) => add('sections', section.id, section.name, titles.sections, text, 'part-' + at));
  }
  add('keys', '', titles.keys, titles.keys, model.keys.guard);
  for (const row of model.keys.rows) add('keys', 'key:' + row.id, row.keys, titles.keys, row.does + ' (' + row.group + ')');
  for (const group of model.keys.groups) add('keys', 'group:' + group.group, group.group, titles.keys, group.says);
  for (const device of model.gestures) for (const item of device.items) add('gestures', device.id, device.device, titles.gestures, item);
  for (const word of model.words) add('words', word.term, word.term, titles.words, word.meaning);
  for (const block of model.numbers) for (const sentence of block.sentences) add('numbers', block.id, block.title, titles.numbers, sentence);
  return entries.map((each, order) => {
    const title = fold(each.title);
    const body = fold(each.text);
    return { ...each, order, titleWords: wordsOf(title.folded).map((w) => w.word), words: wordsOf(body.folded).map((w) => w.word) };
  });
}

const starts = (words, token) => words.some((word) => word.startsWith(token));

// Where a result is taken to in the open body: the data-find value.
export function findKey(each) {
  return each.part + ':' + each.key;
}

// The sentence of an entry that has the most of the query's words, cut to
// SNIPPET_CHARS around its first match, as segments: [{ text, mark }].
function snippetOf(each, tokens) {
  const sentences = sentencesOf(each.text);
  let best = sentences[0];
  let bestCount = -1;
  for (const sentence of sentences) {
    const words = wordsOf(fold(sentence).folded).map((w) => w.word);
    const count = tokens.filter((token) => starts(words, token)).length;
    if (count > bestCount) {
      best = sentence;
      bestCount = count;
    }
  }
  const { folded, from, to } = fold(best);
  const marks = [];
  for (const { word, start, end } of wordsOf(folded)) {
    if (tokens.some((token) => word.startsWith(token))) marks.push([from[start], to[end - 1]]);
  }
  let begin = 0;
  let finish = best.length;
  let before = '';
  let after = '';
  if (best.length > SNIPPET_CHARS) {
    const first = marks.length > 0 ? marks[0][0] : 0;
    begin = Math.max(0, first - Math.floor(SNIPPET_CHARS / 3));
    if (begin > 0) {
      const space = best.indexOf(' ', begin);
      begin = space === -1 || space > first ? begin : space + 1;
      before = '… ';
    }
    finish = Math.min(best.length, begin + SNIPPET_CHARS);
    if (finish < best.length) {
      const space = best.lastIndexOf(' ', finish);
      finish = space > begin && space > (marks.length > 0 ? marks[0][1] : 0) ? space : finish;
      after = ' …';
    }
  }
  const segments = [];
  if (before) segments.push({ text: before, mark: false });
  let cursor = begin;
  for (const [a, b] of marks) {
    if (b <= begin || a >= finish) continue;
    const lo = Math.max(a, begin);
    const hi = Math.min(b, finish);
    if (lo > cursor) segments.push({ text: best.slice(cursor, lo), mark: false });
    segments.push({ text: best.slice(lo, hi), mark: true });
    cursor = hi;
  }
  if (cursor < finish) segments.push({ text: best.slice(cursor, finish), mark: false });
  if (after) segments.push({ text: after, mark: false });
  return segments;
}

// The results for what was typed, best first: a word in the title before one
// only in the text, a whole word before a start of one, then Help's own order.
export function search(entries, query) {
  const typed = String(query === undefined || query === null ? '' : query).trim();
  // only letters and digits count toward the minimum: "a." is one character
  if (wordsOf(fold(typed).folded).reduce((sum, w) => sum + [...w.word].length, 0) < MIN_CHARS) return { query: typed, tokens: [], short: true, results: [] };
  const tokens = queryTokens(typed);
  const results = [];
  for (const each of entries) {
    const all = [...each.titleWords, ...each.words];
    if (!tokens.every((token) => starts(all, token))) continue;
    let score = 0;
    for (const token of tokens) {
      if (starts(each.titleWords, token)) score += 4;
      if (each.titleWords.includes(token)) score += 2;
      if (each.words.includes(token)) score += 1;
    }
    results.push({ entry: each, score });
  }
  results.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
  return { query: typed, tokens, short: false, results: results.map(({ entry: each, score }) => ({ entry: each, score, segments: snippetOf(each, tokens) })) };
}

// What the live region says, and what the list says when it is empty.
export function announcement(count, query) {
  if (count === 0) return 'No results for ‘' + String(query).trim() + '’. Try fewer or different words.';
  return count === 1 ? '1 result' : count + ' results';
}
