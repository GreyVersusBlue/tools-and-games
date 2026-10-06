// converter-spells.test.mjs: the Conversion Codex's spell data and lookup.
//
//   node Pathfinder/tests/converter-spells.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. The spell tab reads three files it does not all own: its own
// pf1-spells.json and spell-map.json, and the Anathema Archive's
// data/spell.json under data/README.md's contract, which asks every reader to
// assert each field it relies on. A map entry naming a PF2e spell the Archive
// does not have would show "not on file" on the live page; a regenerated
// spell.json that renamed system.traits.traditions would blank every
// tradition. Both fail here instead.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PF = path.join(HERE, '..');
const S = await import(pathToFileURL(path.join(PF, 'converter-assets', 'js', 'spells.js')).href);
const read = (p) => JSON.parse(fs.readFileSync(path.join(PF, p), 'utf8'));

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const pf1 = read('converter-assets/data/pf1-spells.json');
const pf2 = read('data/spell.json');
const map = read('converter-assets/data/spell-map.json');
const actions = read('data/action.json');
const embeds = read('converter-assets/data/embeds.json');

// ---- data/spell.json: every field pf2Summary reads -------------------------
console.log('data/spell.json fields');
const has = (s, get) => { try { return get(s) !== undefined; } catch { return false; } };
const FIELDS = {
  'name': (s) => s.name,
  'system.level.value': (s) => s.system.level.value,
  'system.traits.value': (s) => s.system.traits.value,
  'system.traits.traditions': (s) => s.system.traits.traditions,
  'system.traits.rarity': (s) => s.system.traits.rarity,
  'system.publication.remaster': (s) => s.system.publication.remaster,
  'system.publication.title': (s) => s.system.publication.title,
  'system.description.value': (s) => s.system.description.value,
  'system.time.value': (s) => s.system.time.value,
  'system.range.value': (s) => s.system.range.value,
  'system.duration.value': (s) => s.system.duration.value,
  // flag-partials.mjs compares these four as well. defense and area are null
  // on a spell that has neither, so the key is what is asserted.
  'system.duration.sustained': (s) => s.system.duration.sustained,
  'system.defense (the key)': (s) => ('defense' in s.system ? true : undefined),
  'system.area (the key)': (s) => ('area' in s.system ? true : undefined),
  'system.damage': (s) => s.system.damage,
};
for (const [f, get] of Object.entries(FIELDS)) {
  const missing = pf2.filter((s) => !has(s, get));
  ok(missing.length === 0, `every PF2e spell has ${f}`, `${missing.length} lack it, e.g. ${missing[0]?.name}`);
}
const fb = S.pf2Summary(pf2.find((s) => s.name === 'Fireball'));
ok(fb.rank === 3 && fb.traditions.includes('arcane') && fb.traits.includes('fire') && /6d6 fire damage/.test(fb.text),
  'pf2Summary(Fireball) reads rank 3, arcane, fire, and its text', JSON.stringify({ rank: fb.rank, traditions: fb.traditions }));
const cantrip = S.pf2Summary(pf2.find((s) => s.name === 'Detect Magic'));
ok(cantrip.cantrip && cantrip.rank === 0 && !cantrip.traits.includes('cantrip'), 'a cantrip reads as rank 0 and drops the trait from its list');

// ---- Foundry inline markup, read as print --------------------------------------
// data/spell.json's text is Foundry's: links, damage formulas, checks and area
// templates as @UUID[...], @Damage[...], @Check[...], @Template[...] and
// [[/r ...]]. Both the Spells tab and the inline card print pf2Summary's text,
// so none of that syntax may survive it anywhere in the file.
console.log('Foundry markup');
const summaries = pf2.map((s) => S.pf2Summary(s, embeds));
const RAW = {
  'a Compendium path': /Compendium\./,
  'an @ reference or @item formula': /@\w/,
  'a [[/roll]]': /\[\[|\]\]/,
  'a {label} brace': /[{}]/,
  'an unfolded rank formula': /[(,]rank[-+*\/,)]|ternary\(|ceil\(|floor\(/,
};
for (const [what, re] of Object.entries(RAW)) {
  const bad = summaries.filter((s) => re.test(s.text));
  const at = bad[0] ? bad[0].text.slice(Math.max(0, bad[0].text.search(re) - 30), bad[0].text.search(re) + 50) : '';
  ok(bad.length === 0, `no PF2e spell's text keeps ${what}`, `${bad.length} do, e.g. ${bad[0]?.name}: ...${at}...`);
}
const textOf = (n) => summaries.find((s) => s.name === n).text;
const READS = [
  ['Angelic Halo', /healing from the Heal spell/, 'an unlabelled link reads as its last segment'],
  ['Adapt Self', /lasts 10 minutes\.$/, "a trailing \"Spell Effect:\" button is dropped, not printed"],
  ['Acid Splash', /takes 1 persistent acid damage/, '@Damage folds ceil(@item.level/2) at rank 1 to "1 persistent acid"'],
  ['Bramble Bush', /takes 1d4 piercing damage/, '@Damage folds "1d4 + ceil(rank/2) - 1" to "1d4"'],
  ['Acid Arrow', /deal 3d8 acid damage plus 1d6 persistent acid damage/, "@Damage reads @item.rank as the spell's own rank (2 here, not 1)"],
  ['Drain Planar Connection', /4d12 \+ 26 force/, '@Damage keeps a constant beside its dice'],
  ['Vital Beacon', /It restores 4d10 Hit Points to the first/, 'a healing @Damage prints its amount alone; the prose says "Hit Points"'],
  ['Blazing Blade', /takes 1d6 persistent spirit damage/, '@Damage reads ternary(gte(rank,N),a,b) at the base rank'],
  ['Glass Sand', /takes full damage and 1 persistent bleed damage/, 'a {label} after a reference wins over the formula'],
  ['Alarm', /attempt a DC 15 Perception check to wake up/, '@Check reads "DC 15 Perception" without doubling "check"'],
  ['Read Fate', /rolls a secret DC 6 flat check\./, '@Check adds "check" when the prose does not'],
  ['Heal', /disperse vital energy in a 30-foot emanation/, '@Template reads "30-foot emanation"'],
  ['Agile Feet', /Stride, Step, or Tumble Through;/, '[[/act tumble-through]] reads "Tumble Through"'],
  ['Angelic Messenger', /within 10d10 miles/, '[[/r 10d10 #Miles Off]] reads "10d10"'],
  ['Adapt Self', /Speed\.\n• If you are in water, you become able to breathe water\.\n• /, 'list items read one bullet a line, with no blank line between'],
  ['Imprisonment', /Haste spell\.\n• Object \(9th or 10th rank\)/, 'a list that follows prose starts on its own line'],
  ['Divine Dragon\'s Watch', /\(concentrate, sanctified, spirit\)\n\nTrigger An enemy you can see would reduce this spell's target to 0 Hit Points\n\nEffect The dragon intercepts[^\n]*dealing 5d4 spirit damage to it with a basic Reflex save\.\n\nHeightened \(\+1\)/,
    "@Embed prints the embedded action's trigger and effect in place, its own markup read as print"],
  ['Elysian Whimsy', /\n1d4 \| Effect\n1 \| The target feels a powerful urge to dance/, 'table cells read "a | b", a row a line'],
];
for (const [n, re, what] of READS) {
  const t = textOf(n);
  ok(re.test(t), `${n}: ${what}`, t.replace(/\n/g, ' ').slice(0, 400));
}

// ---- embeds.json: the slice of data/action.json the spells embed ------------
// data/README.md asks a reader to assert every field it relies on. embedSlice
// reads _id, name and system.description.value from data/action.json, and
// the page reads the vendored slice rather than the 1.3 MB file.
console.log('embeds.json and data/action.json');
const ACTION_FIELDS = {
  '_id': (a) => a._id,
  'name': (a) => a.name,
  'system.description.value': (a) => a.system.description.value,
};
for (const [f, get] of Object.entries(ACTION_FIELDS)) {
  const missing = actions.filter((a) => typeof get(a) !== 'string');
  ok(missing.length === 0, `every PF2e action has ${f}`, `${missing.length} lack it, e.g. ${missing[0]?._id}`);
}
const fresh = S.embedSlice(pf2, actions);
ok(JSON.stringify(fresh) === JSON.stringify(embeds), 'embeds.json matches what data/action.json holds now',
  'run node Pathfinder/converter-assets/vendor-embeds.mjs and commit the result');
const embedIds = [...new Set(pf2.flatMap((s) => [...s.system.description.value.matchAll(/@Embed\[Compendium\.pf2e\.\w+\.Item\.(\w+)/g)].map((m) => m[1])))];
const unresolved = embedIds.filter((id) => !embeds[id]);
ok(embedIds.length > 0 && unresolved.length === 0, `every action a PF2e spell embeds is in embeds.json (${embedIds.length})`,
  `${unresolved.length} missing: ${unresolved.join(', ')}`);

// ---- pf1-spells.json --------------------------------------------------------
console.log('pf1-spells.json');
ok(pf1.length > 2900, `holds every PF1e spell (${pf1.length})`);
ok(pf1.every((s) => s.name && Number.isInteger(s.level) && s.level >= 0 && s.level <= 9 && s.levels && s.description),
  'every PF1e spell has a name, a level 0 to 9, a class list and a description');
const names = pf1.map((s) => s.name);
ok(new Set(names).size === names.length, 'no PF1e spell appears twice');
const fireball1 = pf1.find((s) => s.name === 'Fireball');
ok(fireball1?.level === 3 && fireball1.levels.wizard === 3 && fireball1.school === 'evocation', 'Fireball is a 3rd-level wizard evocation');

// ---- spell-map.json ---------------------------------------------------------
console.log('spell-map.json');
const entries = Object.entries(map.map);
const pf1Names = new Set(names);
const pf2Names = new Set(pf2.map((s) => s.name));
const orphan = entries.filter(([k]) => !pf1Names.has(k));
ok(orphan.length === 0, 'every map key is a PF1e spell', orphan.slice(0, 5).map(([k]) => k).join(', '));
const unmapped = names.filter((n) => !(n in map.map));
ok(unmapped.length === 0, 'every PF1e spell has a map entry', `${unmapped.length} missing, e.g. ${unmapped.slice(0, 5).join(', ')}`);
const badTo = entries.flatMap(([k, v]) => v.to.filter((t) => !pf2Names.has(t)).map((t) => `${k} -> ${t}`));
ok(badTo.length === 0, 'every PF2e name the map gives exists in data/spell.json', badTo.slice(0, 5).join('; '));
const FITS = new Set(['exact', 'close', 'partial', 'none']);
ok(entries.every(([, v]) => FITS.has(v.fit)), 'every fit is exact, close, partial or none');
ok(entries.every(([, v]) => (v.fit === 'none') === (v.to.length === 0)), 'an entry has targets exactly when its fit is not none',
  entries.filter(([, v]) => (v.fit === 'none') !== (v.to.length === 0)).slice(0, 5).map(([k]) => k).join(', '));

// Renames every GM will try first. A wrong answer here is the map at its worst.
const index = S.buildSpellIndex({ pf1, pf2, map });
const EXPECT = {
  'Magic Missile': 'Force Barrage', 'Cure Light Wounds': 'Heal', 'Fireball': 'Fireball', 'Haste': 'Haste',
  'Mage Armor': 'Mystic Armor', 'True Strike': 'Sure Strike', 'Dimension Door': 'Translocate',
  'Hold Person': 'Paralyze', 'Dominate Person': 'Dominate', 'Mage Hand': 'Telekinetic Hand',
  'Detect Magic': 'Detect Magic', 'Inflict Light Wounds': 'Harm', 'Lightning Bolt': 'Lightning Bolt',
};
for (const [from, to] of Object.entries(EXPECT)) {
  const r = S.convertSpell(index, from);
  ok(r.targets.some((t) => t.name === to), `${from} -> ${to}`, `got ${r.fit}: ${r.targets.map((t) => t.name).join(', ') || '(none)'}`);
}

// ---- flag-partials.mjs: the review list of the weakest partial entries (#886) ----
// The pass scores every partial entry and prints the weakest for Devon. It
// must never write the map: the bytes are compared across a real run of it.
console.log('flag-partials.mjs');
const FLAG = path.join(PF, 'converter-assets', 'flag-partials.mjs');
const F = await import(pathToFileURL(FLAG).href);
const mapBytes = () => fs.readFileSync(F.MAP_PATH);
const before = mapBytes();
const tmpOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flag-partials-')), 'review.md');
execFileSync(process.execPath, [FLAG, tmpOut]);
ok(before.equals(mapBytes()), 'a run of flag-partials.mjs leaves spell-map.json byte for byte as it was');
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
let scored = [];
try { scored = F.scorePartials({ pf1, pf2, map: deepFreeze(read('converter-assets/data/spell-map.json')) }); } catch (e) { scored = e; }
ok(Array.isArray(scored), 'scorePartials scores a frozen map without writing to it', String(scored));
if (!Array.isArray(scored)) scored = [];
const partialCount = entries.filter(([, v]) => v.fit === 'partial').length;
ok(partialCount === 1087 && scored.length === 1087, 'the map has 1,087 partial entries and every one is scored',
  `${partialCount} in the map, ${scored.length} scored`);
ok(scored.every((e, i) => i === 0 || scored[i - 1].score > e.score || (scored[i - 1].score === e.score && scored[i - 1].name < e.name)),
  'the list runs weakest first, and by name inside a score');
ok(scored.every((e) => e.score === e.reasons.reduce((n, r) => n + F.REASONS[r.key].weight, 0)), "an entry's score is the sum of its reasons' weights");
// Five entries scored by hand from the two data files, at both ends and in
// the middle. Reasons are in the order scorePartials tests them.
const HAND = {
  'Psychic Surgery': [10, 'text,two,rank,cast,name'],        // level 5, 10 minutes, onto two rank 2 spells of 2 actions
  'Sea of Dust': [9, 'rank,cast,save,damage,targets,duration,name'], // level 9, 1 hour, permanent area, onto rank 5 Control Water
  "Abadar's Truthtelling": [5, 'text,targets,name'],          // one creature touched, onto Ring of Truth's burst
  'Web Bolt': [0, ''],                                         // level 1 Reflex onto rank 2 Reflex Web, and the note names it
  'Wave Shield': [0, ''],
};
for (const [n, [score, why]] of Object.entries(HAND)) {
  const e = scored.find((x) => x.name === n);
  ok(e?.score === score && e.reasons.map((r) => r.key).join(',') === why, `${n} scores ${score}${why ? ` for ${why}` : ''}`,
    `got ${e?.score} for ${e?.reasons.map((r) => r.key).join(',')}`);
}
ok(scored[0]?.name === 'Psychic Surgery' && scored.filter((e) => e.score >= F.CUT).length === 47,
  `the cut of ${F.CUT} lets 47 entries through, Psychic Surgery first`, `${scored.filter((e) => e.score >= F.CUT).length}, ${scored[0]?.name} first`);
const review = fs.readFileSync(F.REVIEW_PATH, 'utf8');
ok(review === F.renderReview(scored) && review === fs.readFileSync(tmpOut, 'utf8'), 'spell-map-review.md is what flag-partials.mjs prints now',
  'run node Pathfinder/converter-assets/flag-partials.mjs and commit the result');
fs.rmSync(path.dirname(tmpOut), { recursive: true });
// No rule text in the list: no run of eight words from either spell's
// description may appear in it (the map's own notes aside, which it quotes).
// Read from a fresh render, so this fails by itself and not behind the check above.
const eight = (text) => { const w = text.toLowerCase().match(/[a-z']+/g) || []; const out = new Set(); for (let i = 0; i + 8 <= w.length; i++) out.add(w.slice(i, i + 8).join(' ')); return out; };
const reviewRuns = eight(F.renderReview(scored).split('\n').filter((l) => !l.startsWith('- Note on file:')).join('\n'));
const cutNames = new Set(scored.filter((e) => e.score >= F.CUT).flatMap((e) => [e.name, ...e.to]));
const copied = [...pf1.filter((s) => cutNames.has(s.name)).map((s) => [s.name, s.description]),
  ...pf2.filter((s) => cutNames.has(s.name)).map((s) => [s.name, s.system.description.value.replace(/<[^>]+>/g, ' ')])]
  .filter(([, text]) => [...eight(text)].some((run) => reviewRuns.has(run)));
ok(copied.length === 0, 'the review list copies no run of eight words from a spell it names', copied.map(([n]) => n).slice(0, 5).join(', '));

// Each comparison, on made-up spells: Ember Lattice differs from Cinder Net
// in everything the pass measures but text and the count of targets, and
// Ember Net differs from it in nothing.
const mk1 = (name, o = {}) => ({ name, level: 2, school: 'evocation', levels: { wizard: 2 }, castingTime: '1 standard action',
  target: 'one creature', duration: '1 round/level', save: 'Reflex negates', description: 'A net of embers settles on one creature.', ...o });
const mk2 = (name, o = {}) => ({ name, system: { level: { value: 2 }, time: { value: '2' }, duration: { value: '1 minute', sustained: false },
  defense: { save: { statistic: 'reflex', basic: false } }, area: null, damage: {}, description: { value: '<p>A net of cinders.</p>' },
  publication: { remaster: true, title: 'Made-Up Core' }, traits: { value: ['fire'], traditions: ['arcane'], rarity: 'common' }, ...o } });
const fake = F.scorePartials({
  pf1: [mk1('Ember Net', { descriptors: ['fire'] }),
    mk1('Ember Lattice', { level: 1, descriptors: ['fire'], area: '20-ft.-radius burst', target: undefined, duration: 'instantaneous' })],
  pf2: [mk2('Cinder Net'), mk2('Ash Pall', { level: { value: 5 }, time: { value: '10 minutes' }, duration: { value: '1 hour', sustained: false },
    defense: { save: { statistic: 'will', basic: false } }, damage: { a: { type: 'cold', kinds: ['damage'] } },
    publication: { remaster: false, title: 'Made-Up Legacy' }, traits: { value: ['focus'], traditions: ['primal'], rarity: 'common' } })],
  map: { map: {
    'Ember Net': { to: ['Cinder Net'], fit: 'partial', note: 'Cinder Net holds one creature the same way.' },
    'Ember Lattice': { to: ['Ash Pall'], fit: 'partial', note: 'No lattice in PF2e.' },
  } },
});
const reasonsOf = (n) => fake.find((e) => e.name === n)?.reasons.map((r) => r.key).join(',');
ok(reasonsOf('Ember Net') === '', 'a made-up pair alike in every field compared is flagged for nothing', reasonsOf('Ember Net'));
ok(reasonsOf('Ember Lattice') === 'rank,cast,focus,save,tradition,damage,targets,duration,legacy,name,silent',
  'a made-up pair that differs in rank, casting time, save, tradition, damage, area, duration, book and name is flagged for each',
  reasonsOf('Ember Lattice'));

// ---- lookup helpers -----------------------------------------------------------
console.log('lookup');
ok(S.spellKey('Cure Light Wounds, Mass') === S.spellKey('mass cure light wounds'), '"X, Mass" and "mass X" key the same');
ok(S.spellKey('Dispel Magic, Greater') === S.spellKey('greater dispel magic'), '"X, Greater" and "greater X" key the same');
ok(S.cleanSpellName('fireball (DC 17)') === 'fireball', 'cleanSpellName strips a DC');
ok(S.cleanSpellName('cure light wounds (2)') === 'cure light wounds', 'cleanSpellName strips a count');
ok(S.cleanSpellName('blessD') === 'bless', 'cleanSpellName strips a domain marker');
ok(S.cleanSpellName('quickened magic missile') === 'magic missile' && S.metamagicOf('quickened magic missile') === 'quickened',
  'cleanSpellName strips metamagic, and metamagicOf reports it');
ok(S.findPf1(index, 'mass cure light wounds')?.name === 'Cure Light Wounds, Mass', 'findPf1 reads a stat block spelling');
const sug = S.suggest(index, 'fire', 20);
ok(sug[0].toLowerCase().startsWith('fire') && sug.includes('Fireball'), 'suggest puts names starting with the query first', sug.slice(0, 4).join(', '));
ok(S.suggest(index, 'missile', 20).includes('Magic Missile'), 'suggest finds a word inside a name');
ok(S.suggest(index, '').length === 0, 'suggest with no query suggests nothing');

// ---- ranks -----------------------------------------------------------------
console.log('ranks');
ok(S.maxRankForLevel(1) === 1 && S.maxRankForLevel(10) === 5 && S.maxRankForLevel(20) === 10 && S.maxRankForLevel(-1) === 1,
  'a level L creature casts up to rank ceil(L/2), 1 to 10');
ok(S.rankFor({ pf1Level: 6, pf1Top: 6, pf2Top: 6, baseRank: 3 }) === 6, "a caster's top PF1e level lands on its top PF2e rank");
ok(S.rankFor({ pf1Level: 3, pf1Top: 6, pf2Top: 6, baseRank: 3 }) === 3, 'lower levels scale with it');
ok(S.rankFor({ pf1Level: 1, pf1Top: 6, pf2Top: 6, baseRank: 4 }) === 4, "never below the PF2e spell's own rank");
ok(S.rankFor({ pf1Level: 2, pf1Top: 2, pf2Top: 2, baseRank: 0 }) === 0, 'a PF2e cantrip stays a cantrip');

console.log(`\n${checks} checks, ${failures} FAILED`.replace(', 0 FAILED', ', all passed'));
process.exit(failures ? 1 : 0);
