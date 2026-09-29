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
import path from 'node:path';
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
