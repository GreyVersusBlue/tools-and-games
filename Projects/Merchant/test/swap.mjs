// City swap (ARCHITECTURE 7.5): node test/swap.mjs, from Projects/Merchant/. Plain Node, no clock.
// The engine knows no city. data/testport/ is played to the end with the same engine files that
// play Cairo, and no file under js/engine/ may name a Cairo place, house, agent or good. The
// names to look for are read from data/cairo/, never typed here, so a new Cairo stop is
// covered the day it lands.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, eq, ok, done } from './lib.mjs';
import { loadContent } from '../js/data.js';
import { newGame, openSeason, endSeason, recall, view, choose, paperChoices } from '../js/engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'js/engine');
const testport = await loadContent('testport', { fs });
const cairo = await loadContent('cairo', { fs });

// ---- the grep over js/engine/

const KINDS = ['stops', 'goods', 'agents', 'houses'];
const tokens = (c, own = new Set()) => {
  const out = new Set(['cairo']);
  for (const k of KINDS) for (const e of c[k] ?? []) for (const t of [e.id, e.name]) if (typeof t === 'string' && t) out.add(t.toLowerCase());
  for (const t of own) out.delete(t);
  return out;
};
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Every (file, line, word) where `files` ({ name: text }) names one of `words`, whole words, any case. */
function naming(files, words) {
  const found = [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_-])(${[...words].map(escape).join('|')})(?![\\p{L}\\p{N}_-])`, 'giu');
  for (const [name, text] of Object.entries(files)) {
    text.split('\n').forEach((line, i) => { for (const m of line.matchAll(re)) found.push(`${name}:${i + 1} "${m[1]}"`); });
  }
  return found;
}
const engineFiles = async () => {
  const out = {};
  for (const f of (await fs.readdir(ENGINE, { recursive: true })).filter(f => /\.(js|mjs|json)$/.test(f))) out[f] = await fs.readFile(path.join(ENGINE, f), 'utf8');
  return out;
};
// a word testport also uses (a shared good such as salt) is not evidence the engine knows Cairo
const own = new Set([...tokens(testport)].filter(t => t !== 'cairo'));
const words = tokens(cairo, own);

test('swap: the Cairo names come from data/cairo/ and there are some', () => {
  const stops = (cairo.stops ?? []).map(s => s.id);
  ok(stops.length >= 3 && stops.includes('cairo'), `data/cairo/stops.json gave ${stops.length} stops`);
  for (const id of stops) ok(words.has(id) || own.has(id), `${id} is not among the names searched for`);
  ok(testport.cityId === 'testport' && cairo.cityId === 'cairo');
});
test('swap: no file under js/engine/ names a Cairo stop, house, agent or good', async () => {
  const files = await engineFiles();
  ok(Object.keys(files).length >= 6, `only ${Object.keys(files).length} engine files were read`);
  eq(naming(files, words), []);
});
test('swap: the grep finds a Cairo stop, in any case, and not a word that only contains one', () => {
  const stop = cairo.stops.find(s => s.id !== 'cairo' && words.has(s.id)).id;
  eq(naming({ a: `const x = '${stop.toUpperCase()}';` }, words), [`a:1 "${stop.toUpperCase()}"`]);
  eq(naming({ a: `// Cairo was large\nconst y = 1;` }, words), ['a:1 "Cairo"']);
  eq(naming({ a: `const ${stop}Count = 1; // ${stop}s` }, words), []);
});

// ---- testport, played to the end

const answer = (s, c, i = 0) => { for (const p of s.desk) if (p.state === 'open') s = choose(s, c, p.id, (paperChoices(s, c, p.id)[i] ?? paperChoices(s, c, p.id)[0]).id); return s; };
const play = (opts, pick = 0) => {
  let s = newGame(testport, opts), seasons = 0;
  while (s.phase !== 'recall') {
    s = s.phase === 'interlude' ? openSeason(s, testport) : endSeason(answer(s, testport, pick), testport);
    if (++seasons > 100) throw new Error('the game did not reach recall in 100 steps');
  }
  return recall(s, testport, {});
};

test('swap: testport is played to the end by the engine with no code change', () => {
  const s = play({ seed: 7, length: 'acts', house: 'plain' });
  eq(s.phase, 'ended');
  eq(s.city, 'testport');
  ok(s.log.length > 0 && Number.isInteger(s.money));
});
test('swap: both houses, both choices, three seeds all reach the end with whole-number money', () => {
  for (const house of testport.houses.map(h => h.id)) for (const pick of [0, 1]) for (const seed of [1, 7, 1324]) {
    const s = play({ seed, length: 'acts', house }, pick);
    eq(s.phase, 'ended', `${house} ${pick} ${seed}`);
    ok(Number.isInteger(s.money), `${house} ${pick} ${seed}: money ${s.money}`);
  }
});
test('swap: the same seed plays the same game and a different seed does not', () => {
  const a = JSON.stringify(play({ seed: 7, length: 'acts', house: 'plain' })), b = JSON.stringify(play({ seed: 7, length: 'acts', house: 'plain' }));
  eq(a, b);
  ok(JSON.stringify(play({ seed: 8, length: 'acts', house: 'plain' })) !== a, 'seeds 7 and 8 played the same game');
});
test('swap: the view of testport names no Cairo word and the notebook entries its cards unlock exist', () => {
  const s = newGame(testport, { seed: 7, length: 'acts', house: 'plain' });
  eq(naming({ view: JSON.stringify(view(s, testport)) }, words), []);
  const book = new Set(testport.notebook.map(e => e.id));
  ok(book.size >= 2);
  for (const id of s.notebook) ok(book.has(id), `the desk unlocked "${id}", which notebook.json lacks`);
});

done();
