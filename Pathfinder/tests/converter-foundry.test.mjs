// converter-foundry.test.mjs: converted creatures out as Foundry VTT pf2e NPCs.
//
//   node Pathfinder/tests/converter-foundry.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. Nobody here can import a file into Foundry, so the suite holds the
// export to the two things it can be held to. One is the converter: every
// number in the actor is read back and compared with the creature it came
// from, and everything the converter said is either in a field or in the
// notes. The other is print: Pathfinder/data/npcs is the pf2e system's own
// NPCs, so every path the export writes under `system` and every slug it puts
// in a field has to be one a printed Remaster NPC carries. Those sets are
// built here from the data, not read from foundry-vocab.js, so the export's
// own word list is not what it is checked against.
//
// The npc fields read here are the ones data/README.md asks a reader to
// assert: the first block fails if the Archive's files lose them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PF = path.join(HERE, '..');
const imp = (p) => import(pathToFileURL(path.join(PF, 'converter-assets', p)).href);
const { parsePf1 } = await imp('js/parse-pf1.js');
const C = await imp('js/convert.js');
const S = await imp('js/spells.js');
const F = await imp('js/foundry.js');
const { VOCAB } = await imp('js/foundry-vocab.js');
const V = await imp('vendor-foundry-vocab.mjs');
const read = (p) => JSON.parse(fs.readFileSync(path.join(PF, p), 'utf8'));

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + String(detail).slice(0, 400) : ''}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pf2Spells = read('data/spell.json');
const index = S.buildSpellIndex({
  pf1: read('converter-assets/data/pf1-spells.json'),
  pf2: pf2Spells,
  map: read('converter-assets/data/spell-map.json'),
});
const FIXTURES = fs.readdirSync(path.join(HERE, 'fixtures', 'pf1')).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();
// One with no Strikes at all. Made up: no fixture is without an attack.
const NO_STRIKES = `Quiet Lantern Wisp CR 2
N Small fey
Init +3; Senses low-light vision; Perception +8
DEFENSE
AC 15, touch 14, flat-footed 12
hp 18 (4d6+4)
Fort +2, Ref +7, Will +5
OFFENSE
Speed 5 ft., fly 40 ft. (perfect)
STATISTICS
Str 3, Dex 16, Con 12, Int 11, Wis 13, Cha 15
Skills Stealth +14, Knowledge (lanterns) +7
Languages Sylvan, Lampwright`;
const convertText = (text, opts = {}) => C.convertCreature(parsePf1(text), { spellIndex: index, ...opts });
const made = new Map();
function pair(name) {
  if (!made.has(name)) {
    const o = name === 'no-strikes' ? convertText(NO_STRIKES) : convertText(fs.readFileSync(path.join(HERE, 'fixtures', 'pf1', name + '.txt'), 'utf8'));
    made.set(name, { o, f: F.toFoundry(o, { spellIndex: index }) });
  }
  return made.get(name);
}
const ALL = [...FIXTURES, 'no-strikes'];
const every = (fn) => ALL.map((n) => [n, fn(pair(n), n)]).filter(([, bad]) => bad).map(([n, bad]) => `${n}: ${bad}`);
const none = (label, fn) => { const bad = every(fn); ok(bad.length === 0, label, bad.slice(0, 4).join(' | ')); };

// ---- what print looks like ---------------------------------------------------
console.log('the printed NPCs this is held against');
const printed = [];
for (const f of fs.readdirSync(path.join(PF, 'data', 'npcs')).sort()) printed.push(...read(`data/npcs/${f}`));
const remaster = printed.filter((a) => a.system?.details?.publication?.remaster === true);
ok(remaster.length > 2000 && remaster.every((a) => a.type === 'npc'), 'data/npcs holds Remaster npc actors', `${remaster.length} of ${printed.length}`);

// Every node under `system`, with the keys that are ids or names wildcarded.
function paths(node, at, out) {
  out.add(at);
  if (Array.isArray(node)) { out.add(at + '[]'); for (const x of node) if (x && typeof x === 'object') paths(x, at + '[]', out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const key = /\.(skills|damageRolls)$/.test(at) ? '*' : /\.slots$/.test(at) ? 'slot*' : k;
      paths(v, `${at}.${key}`, out);
    }
  }
  return out;
}
const printPaths = { npc: new Set(), melee: new Set(), action: new Set(), spellcastingEntry: new Set(), spell: new Set(), lore: new Set() };
const seen = { traits: new Set(), languages: new Set(), senses: new Set(), acuity: new Set(), immunities: new Set(), weaknesses: new Set(), resistances: new Set(),
  exceptions: new Set(), sizes: new Set(), rarity: new Set(), strikeTraits: new Set(), effects: new Set(), damageTypes: new Set(), actionTraits: new Set(),
  actionType: new Set(), category: new Set(), prepared: new Set(), tradition: new Set(), speedTypes: new Set(), skills: new Set(), initiative: new Set(), spellNames: new Set() };
for (const a of remaster) {
  const sy = a.system;
  paths(sy, 'system', printPaths.npc);
  for (const t of sy.traits.value) seen.traits.add(t);
  seen.sizes.add(sy.traits.size.value); seen.rarity.add(sy.traits.rarity); seen.initiative.add(sy.initiative?.statistic);
  for (const l of sy.details.languages.value) seen.languages.add(l);
  for (const s of sy.perception.senses) { seen.senses.add(s.type); if (s.acuity) seen.acuity.add(s.acuity); }
  for (const i of sy.attributes.immunities || []) seen.immunities.add(i.type);
  for (const w of sy.attributes.weaknesses || []) seen.weaknesses.add(w.type);
  for (const r of sy.attributes.resistances || []) { seen.resistances.add(r.type); for (const e of r.exceptions || []) seen.exceptions.add(e); }
  for (const s of sy.attributes.speed.otherSpeeds) seen.speedTypes.add(s.type);
  for (const k of Object.keys(sy.skills || {})) seen.skills.add(k);
  for (const it of a.items) {
    if (!printPaths[it.type]) continue;
    paths(it.system, 'system', printPaths[it.type]);
    if (it.type === 'melee') {
      for (const t of it.system.traits.value) seen.strikeTraits.add(t);
      for (const e of it.system.attackEffects?.value || []) seen.effects.add(e);
      for (const d of Object.values(it.system.damageRolls)) seen.damageTypes.add(d.damageType);
    } else if (it.type === 'action') {
      for (const t of it.system.traits.value) seen.actionTraits.add(t);
      seen.actionType.add(it.system.actionType.value); seen.category.add(it.system.category);
    } else if (it.type === 'spellcastingEntry') {
      seen.prepared.add(it.system.prepared.value); seen.tradition.add(it.system.tradition.value);
    } else if (it.type === 'spell') seen.spellNames.add(it.name);
  }
}
const troll = printed.find((a) => a.name === 'Troll');
ok(troll?.system.attributes.ac.value === 20 && troll.system.attributes.hp.max === 115 && troll.system.saves.fortitude.value === 17 && troll.system.perception.mod === 11
  && troll.system.abilities.str.mod === 5 && troll.system.skills.athletics.base === 12 && troll.system.details.level.value === 5,
'the printed troll still reads AC 20, HP 115, Fort +17, Perception +11, Str +5, Athletics +12, level 5 at the paths the export writes');
const jaws = troll?.items.find((i) => i.type === 'melee' && i.name === 'Jaws');
ok(jaws?.system.bonus.value === 14 && same(Object.values(jaws.system.damageRolls), [{ damage: '2d10+5', damageType: 'piercing' }]) && jaws.system.traits.value.includes('reach-10'),
  'and its Jaws still read +14, 2d10+5 piercing, reach-10 as a melee item');
ok(['(At Will)', '(Constant)'].every((m) => [...seen.spellNames].some((n) => n.endsWith(m))), 'printed innate spells carry (At Will) and (Constant) in their names');

// ---- the word list is the data's --------------------------------------------
console.log('\nfoundry-vocab.js');
ok(fs.readFileSync(path.join(PF, 'converter-assets', 'js', 'foundry-vocab.js'), 'utf8') === V.vocabSource(V.buildVocab()),
  'foundry-vocab.js matches a fresh run of vendor-foundry-vocab.mjs over data/npcs', 'stale: run node Pathfinder/converter-assets/vendor-foundry-vocab.mjs');
ok(VOCAB.traits.includes('undead') && VOCAB.languages.includes('chthonian') && !VOCAB.languages.includes('abyssal') && VOCAB.senses.includes('low-light-vision'),
  'it holds Remaster slugs (chthonian, not abyssal)');

// ---- the file ----------------------------------------------------------------
console.log('\nthe file');
none('the JSON parses back to the same object, for all fixtures and the made-up one', ({ o, f }) => {
  const text = F.toFoundryJson(o, { spellIndex: index });
  try { return same(JSON.parse(text), f) ? '' : 'parsed JSON differs from the object'; }
  catch (err) { return `not JSON: ${err.message}`; }
});
// JSON.stringify drops undefined and writes NaN as null, so the object is
// walked, not the text.
function badValue(node, at = '') {
  if (node === undefined) return `${at} undefined`;
  if (typeof node === 'number' && !Number.isFinite(node)) return `${at} ${node}`;
  if (typeof node === 'function') return `${at} function`;
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { const b = badValue(v, `${at}.${k}`); if (b) return b; }
  return '';
}
none('no undefined, NaN or Infinity anywhere in it', ({ f }) => badValue(f));
none('name, type, level, AC, HP, saves, Perception, six modifiers, size and rarity are all filled', ({ f }) => {
  const sy = f.system, int = Number.isInteger;
  if (!f.name || typeof f.name !== 'string') return 'name';
  if (f.type !== 'npc') return 'type';
  if (f.prototypeToken?.name !== f.name) return 'token name';
  if (!int(sy.details.level.value) || sy.details.level.value < -1 || sy.details.level.value > 25) return 'level';
  if (!int(sy.attributes.ac.value) || !int(sy.attributes.hp.max) || sy.attributes.hp.max < 1 || sy.attributes.hp.value !== sy.attributes.hp.max) return 'ac/hp';
  for (const k of ['fortitude', 'reflex', 'will']) if (!int(sy.saves[k].value)) return k;
  if (!int(sy.perception.mod)) return 'perception';
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) if (!int(sy.abilities[k].mod)) return k;
  if (Object.keys(sy.abilities).length !== 6) return 'abilities';
  if (!seen.sizes.has(sy.traits.size.value) || !seen.rarity.has(sy.traits.rarity)) return 'size/rarity';
  if (!seen.initiative.has(sy.initiative.statistic)) return 'initiative';
  return '';
});
none('every item has a name, a type and a 16-character id, unique in its actor, and a sort in order', ({ f }) => {
  const ids = new Set();
  let last = 0;
  for (const it of f.items) {
    if (!it.name || !printPaths[it.type]) return `${it.name || 'unnamed'} ${it.type}`;
    if (!/^[A-Za-z0-9]{16}$/.test(it._id) || ids.has(it._id)) return `id ${it._id}`;
    ids.add(it._id);
    if (!(it.sort > last)) return `sort ${it.sort}`;
    last = it.sort;
  }
  return '';
});
{
  const a = F.toFoundryJson(pair('lich').o, { spellIndex: index }), b = F.toFoundryJson(convertText(fs.readFileSync(path.join(HERE, 'fixtures', 'pf1', 'lich.txt'), 'utf8')), { spellIndex: index });
  ok(a === b && a.length > 20000, 'the same stat block converted twice gives the same bytes', `${a.length} against ${b.length}`);
  const owner = new Map();
  const shared = ALL.flatMap((n) => pair(n).f.items.map((i) => {
    const was = owner.get(i._id) ?? pair(n).o.name;
    owner.set(i._id, was);
    return was === pair(n).o.name ? null : `${i._id} ${was} and ${pair(n).o.name}`;
  })).filter(Boolean);
  ok(shared.length === 0 && owner.size > 300 && F.idFor('a') !== F.idFor('b') && F.idFor('a') === F.idFor('a'), 'ids are hashed from the creature and the item: no two creatures share one', `${owner.size} ids, shared: ${shared.slice(0, 3).join('; ')}`);
  ok(F.foundryFileName({ name: 'Young Red Dragon' }) === 'young-red-dragon.foundry-npc.json' && F.foundryFileName({ name: '???' }) === 'creature.foundry-npc.json', 'the file is named for the creature');
}

// ---- held against print ------------------------------------------------------
console.log('\nagainst the printed NPCs');
none('every path under the actor\'s system is one a printed Remaster NPC has', ({ f }) => [...paths(f.system, 'system', new Set())].filter((p) => !printPaths.npc.has(p)).join(', '));
none('every path under a Strike, ability, spellcasting entry or Lore is one print has', ({ f }) => f.items.filter((i) => i.type !== 'spell')
  .flatMap((i) => [...paths(i.system, 'system', new Set())].filter((p) => !printPaths[i.type].has(p)).map((p) => `${i.type} ${p}`)).join(', '));
none('a spell\'s location holds only value, heightenedLevel and uses, as print\'s does', ({ f }) => f.items.filter((i) => i.type === 'spell')
  .flatMap((i) => [...paths(i.system.location, 'system.location', new Set())].filter((p) => !printPaths.spell.has(p))).join(', '));
const slugCheck = (label, pick, set) => none(label, ({ f }) => pick(f).filter((x) => !set.has(x)).join(', '));
const of = (f, type) => f.items.filter((i) => i.type === type);
slugCheck('every creature trait written is one print uses', (f) => f.system.traits.value, seen.traits);
slugCheck('every language', (f) => f.system.details.languages.value, seen.languages);
slugCheck('every sense, and its acuity', (f) => f.system.perception.senses.flatMap((s) => [s.type]), seen.senses);
none('a sense\'s acuity and range are print\'s kind', ({ f }) => f.system.perception.senses.filter((s) => (s.acuity && !seen.acuity.has(s.acuity)) || (s.range !== undefined && !(s.range > 0))).map((s) => s.type).join(', '));
slugCheck('every immunity', (f) => f.system.attributes.immunities.map((i) => i.type), seen.immunities);
slugCheck('every weakness', (f) => f.system.attributes.weaknesses.map((i) => i.type), seen.weaknesses);
slugCheck('every resistance', (f) => f.system.attributes.resistances.map((i) => i.type), seen.resistances);
slugCheck('every resistance exception', (f) => f.system.attributes.resistances.flatMap((i) => i.exceptions || []), seen.exceptions);
slugCheck('every other speed\'s type', (f) => f.system.attributes.speed.otherSpeeds.map((s) => s.type), seen.speedTypes);
slugCheck('every skill key', (f) => Object.keys(f.system.skills), seen.skills);
slugCheck('every Strike trait', (f) => of(f, 'melee').flatMap((i) => i.system.traits.value), seen.strikeTraits);
slugCheck('every attack effect', (f) => of(f, 'melee').flatMap((i) => i.system.attackEffects.value), seen.effects);
slugCheck('every damage type', (f) => of(f, 'melee').flatMap((i) => Object.values(i.system.damageRolls).map((d) => d.damageType)), seen.damageTypes);
slugCheck('every ability trait', (f) => of(f, 'action').flatMap((i) => i.system.traits.value), seen.actionTraits);
slugCheck('every ability\'s action type and category', (f) => of(f, 'action').flatMap((i) => [i.system.actionType.value, i.system.category]), new Set([...seen.actionType, ...seen.category]));
slugCheck('every spellcasting entry\'s kind and tradition', (f) => of(f, 'spellcastingEntry').flatMap((i) => [i.system.prepared.value, i.system.tradition.value]), new Set([...seen.prepared, ...seen.tradition]));
none('an activated ability has 1 to 3 actions and a passive or reaction has none', ({ f }) => of(f, 'action')
  .filter((i) => (i.system.actionType.value === 'action') !== [1, 2, 3].includes(i.system.actions.value) || (i.system.actionType.value !== 'action' && i.system.actions.value !== null)).map((i) => i.name).join(', '));
none('a damage roll is dice or a number, never a sentence', ({ f }) => of(f, 'melee').flatMap((i) => Object.values(i.system.damageRolls)).filter((d) => !/^\d+(d\d+)?([+-]\d+)?$/.test(d.damage)).map((d) => d.damage).join(', '));

// ---- the converter's own numbers ----------------------------------------------
console.log('\nthe converter\'s numbers');
none('level, AC, HP, the three saves and Perception equal the converter\'s', ({ o, f }) => {
  const sy = f.system;
  const got = [sy.details.level.value, sy.attributes.ac.value, sy.attributes.hp.max, sy.saves.fortitude.value, sy.saves.reflex.value, sy.saves.will.value, sy.perception.mod];
  const want = [o.level.value, o.ac.value, o.hp.value, o.saves.fort.value, o.saves.ref.value, o.saves.will.value, o.perception.value];
  return same(got, want) ? '' : `${got} against ${want}`;
});
none('the six attribute modifiers equal the converter\'s', ({ o, f }) => (['str', 'dex', 'con', 'int', 'wis', 'cha'].every((k) => f.system.abilities[k].mod === o.attrs[k].value) ? '' : 'differs'));
none('every skill is there once with the converter\'s bonus, a Lore as a lore item', ({ o, f }) => {
  for (const sk of o.skills) {
    const lore = of(f, 'lore').filter((i) => i.name === sk.name);
    const got = /Lore$/.test(sk.name) ? (lore.length === 1 ? lore[0].system.mod.value : `${lore.length} items`) : f.system.skills[sk.name.toLowerCase()]?.base;
    if (got !== sk.value) return `${sk.name} ${got} against ${sk.value}`;
  }
  return Object.keys(f.system.skills).length + of(f, 'lore').length === o.skills.length ? '' : 'count';
});
none('every Strike is there in order with the converter\'s bonus and damage', ({ o, f }) => {
  const m = of(f, 'melee');
  if (m.length !== o.strikes.length) return `${m.length} items for ${o.strikes.length} Strikes`;
  for (const [i, s] of o.strikes.entries()) {
    const first = Object.values(m[i].system.damageRolls)[0];
    if (m[i].name.toLowerCase() !== s.name.toLowerCase() || m[i].system.bonus.value !== s.bonus) return `${s.name} ${m[i].system.bonus.value} against ${s.bonus}`;
    if (!first || `${first.damage} ${first.damageType}` !== s.damage) return `${s.name} damage ${JSON.stringify(first)} against ${s.damage}`;
    if (new Set(Object.keys(m[i].system.damageRolls)).size !== Object.keys(m[i].system.damageRolls).length) return 'roll ids';
  }
  return '';
});
none('a Strike\'s reach, agile and range come through, and every rider is a roll, an effect or the Strike\'s text', ({ o, f }) => {
  const m = of(f, 'melee');
  for (const [i, s] of o.strikes.entries()) {
    const sy = m[i].system;
    for (const t of s.traits) {
      const r = t.match(/^reach (\d+) feet$/), inc = t.match(/^range increment (\d+) feet$/);
      if (r && !sy.traits.value.includes(`reach-${r[1]}`)) return `${s.name} ${t}`;
      if (inc && sy.range?.increment !== Number(inc[1])) return `${s.name} ${t}`;
      if (!r && !inc && !sy.traits.value.includes(t)) return `${s.name} ${t}`;
    }
    const extra = Object.values(sy.damageRolls).slice(1).map((d) => `${d.damage} ${d.damageType}`);
    for (const r of s.riders) {
      if (!extra.includes(r) && !sy.attackEffects.value.includes(r.toLowerCase()) && !sy.description.value.includes(esc(r))) return `${s.name} rider ${r}`;
    }
    if (extra.length + sy.attackEffects.value.length > s.riders.length) return `${s.name} has more than its riders`;
  }
  return '';
});
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
none('weakness and resistance values equal the converter\'s, and none is lost without a note', ({ o, f }) => {
  const at = f.system.attributes, notes = f.system.details.privateNotes;
  for (const [list, out] of [[o.weaknesses, at.weaknesses], [o.resistances, at.resistances]]) {
    for (const w of list) {
      const slug = w.type.replace(/ /g, '-');
      if (!out.some((x) => x.type === slug && x.value === w.value) && !notes.includes(esc(`${w.type} ${w.value}`))) return `${w.type} ${w.value}`;
    }
    if (out.length > list.length) return 'more than the converter gave';
  }
  for (const r of o.resistances) {
    if (!r.except) continue;
    const want = r.except.split(' or ').map((e) => e.replace(/ /g, '-'));
    if (!at.resistances.some((x) => x.type === r.type && same(x.exceptions, want)) && !notes.includes(esc(`(except ${r.except})`))) return `except ${r.except}`;
  }
  return '';
});
none('every trait, immunity, sense, language and speed is in its field or in the notes by name', ({ o, f }) => {
  const sy = f.system, notes = sy.details.privateNotes, slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const t of o.traits) if (!sy.traits.value.includes(slug(t)) && !notes.includes(esc(`"${t}"`))) return `trait ${t}`;
  for (const t of o.immunities) if (!sy.attributes.immunities.some((i) => i.type === slug(t)) && !notes.includes(esc(`"${t}"`))) return `immunity ${t}`;
  if (sy.traits.value.length + sy.attributes.immunities.length > o.traits.length + o.immunities.length) return 'more traits or immunities than the converter gave';
  const senseTypes = sy.perception.senses.map((s) => s.type);
  for (const s of o.senses) if (!senseTypes.includes(slug(s.replace(/\s*\(.*$/, '').replace(/ \d+ feet$/, ''))) && !sy.perception.details.includes(s)) return `sense ${s}`;
  for (const l of o.languages) if (!sy.details.languages.details.includes(l) && !/^[A-Za-z' -]+$/.test(l.replace(/\s*\(.*\)$/, ''))) return `language ${l}`;
  if (sy.details.languages.value.length + sy.details.languages.details.split(', ').filter(Boolean).length < o.languages.length) return 'a language is missing';
  const speeds = [sy.attributes.speed.value != null ? `${sy.attributes.speed.value} feet` : null, ...sy.attributes.speed.otherSpeeds.map((s) => `${s.type} ${s.value} feet`), ...sy.attributes.speed.details.split(', ')].filter(Boolean);
  return same(speeds.sort(), [...o.speeds].sort()) ? '' : `speeds ${speeds} against ${o.speeds}`;
});
none('every ability is an action item with the converter\'s text and no other', ({ o, f }) => {
  const want = [...o.defAbilities, ...o.offAbilities, ...o.otherAbilities], got = of(f, 'action');
  if (got.length !== want.length) return `${got.length} items for ${want.length} abilities`;
  for (const [i, a] of want.entries()) {
    if (got[i].name !== a.name) return `${got[i].name} against ${a.name}`;
    if (got[i].system.description.value !== (a.text ? `<p>${esc(a.text)}</p>` : '')) return `${a.name} text`;
    if (got[i].system.category !== (i < o.defAbilities.length ? 'defensive' : 'offensive')) return `${a.name} category`;
  }
  return '';
});
none('the conversion notes and spell notes are all in the private notes', ({ o, f }) => {
  const notes = f.system.details.privateNotes;
  const miss = [...o.notes.map((n) => n.text), ...o.spellNotes.map((s) => `${s.pf1}: ${s.note}`)].find((t) => !notes.includes(esc(t)));
  return miss ? miss.slice(0, 60) : (f.system.details.publicNotes === '' ? '' : 'public notes are not empty');
});
{
  const t = pair('troll');
  ok(t.f.system.attributes.hp.details === 'regeneration 15 (deactivated by acid or fire)' && of(t.f, 'action').some((i) => i.name === 'Regeneration 15'),
    'the troll\'s regeneration is on the Hit Points line and is an ability', t.f.system.attributes.hp.details);
  const s = pair('succubus').f;
  ok(of(s, 'action').find((i) => i.name === 'Reactive Strike')?.system.actionType.value === 'reaction', 'Reactive Strike is a reaction');
  const d = pair('young-red-dragon').f, breath = of(d, 'action').find((i) => i.name === 'Breath Weapon');
  ok(breath?.system.actionType.value === 'action' && breath.system.actions.value === 2 && breath.system.traits.value.includes('fire'), 'the dragon\'s Breath Weapon is a two-action fire ability', JSON.stringify(breath?.system).slice(0, 200));
}

// ---- spellcasting --------------------------------------------------------------
console.log('\nspellcasting');
none('every spellcasting entry has the converter\'s DC and attack, and every spell is an item in it', ({ o, f }) => {
  const entries = of(f, 'spellcastingEntry');
  if (entries.length !== o.spellcasting.length) return `${entries.length} entries for ${o.spellcasting.length}`;
  let spells = 0;
  for (const [i, sc] of o.spellcasting.entries()) {
    const e = entries[i];
    if (e.name !== sc.name || e.system.spelldc.dc !== sc.dc || e.system.spelldc.value !== sc.attack) return `${sc.name} DC ${e.system.spelldc.dc} attack ${e.system.spelldc.value}`;
    const mine = of(f, 'spell').filter((s) => s.system.location.value === e._id);
    const want = sc.ranks.flatMap((r) => r.spells.map((s) => ({ ...s, rank: r.rank })));
    if (mine.length !== want.length) return `${sc.name} holds ${mine.length} of ${want.length} spells`;
    for (const [j, w] of want.entries()) if (!mine[j].name.startsWith(w.name)) return `${mine[j].name} against ${w.name}`;
    spells += mine.length;
  }
  return spells === of(f, 'spell').length ? '' : 'a spell belongs to no entry';
});
none('a spell cast above its own rank says so, and a cantrip or a spell at its rank does not', ({ o, f }) => {
  const items = of(f, 'spell');
  let k = 0;
  for (const sc of o.spellcasting) for (const r of sc.ranks) for (const s of r.spells) {
    const it = items[k++];
    if (!it) return `no item for ${s.name}`;
    const h = it.system.location.heightenedLevel;
    if (r.rank > 0 && r.rank !== it.system.level.value ? h !== r.rank : h !== undefined) return `${it.name} rank ${r.rank}, base ${it.system.level.value}, heightened ${h}`;
    if (r.rank === 0 && !it.system.traits.value.includes('cantrip')) return `${it.name} is not a cantrip`;
  }
  return '';
});
none('a prepared caster\'s slots hold each spell as often as it is prepared; a spontaneous one\'s hold the slot count; an innate one has none', ({ o, f }) => {
  const entries = of(f, 'spellcastingEntry'), items = of(f, 'spell');
  let k = 0;
  for (const [i, sc] of o.spellcasting.entries()) {
    const sy = entries[i].system, kind = sy.prepared.value;
    if (kind !== (sc.innate ? 'innate' : /Spontaneous/.test(sc.name) ? 'spontaneous' : 'prepared')) return `${sc.name} is ${kind}`;
    for (const r of sc.ranks) {
      const slot = sy.slots[`slot${r.rank}`], ids = r.spells.flatMap((s) => { const id = items[k++]?._id; return Array(Math.max(1, s.count || 1)).fill(id); });
      if (kind === 'prepared' && !(same(slot?.prepared.map((p) => p.id), ids) && slot.max === ids.length)) return `${sc.name} rank ${r.rank}`;
      if (kind === 'spontaneous' && (r.slots ? !(slot?.max === r.slots && slot.value === r.slots) : slot !== undefined)) return `${sc.name} rank ${r.rank} slots`;
      if (kind === 'innate' && slot !== undefined) return `${sc.name} has slots`;
    }
  }
  return '';
});
none('at will and constant are in the spell\'s name as print writes them, and N/day is its uses', ({ o, f }) => {
  const items = of(f, 'spell');
  let k = 0;
  for (const sc of o.spellcasting) for (const r of sc.ranks) for (const s of r.spells) {
    const it = items[k++], n = String(s.freq).match(/^(\d+)\/day$/);
    if (!it) return `no item for ${s.name}`;
    if ((s.freq === 'at will') !== it.name.includes(' (At Will)') || (s.freq === 'constant') !== it.name.includes(' (Constant)')) return `${it.name} for "${s.freq}"`;
    if (n ? !same(it.system.location.uses, { value: Number(n[1]), max: Number(n[1]) }) : it.system.location.uses !== undefined) return `${it.name} uses for "${s.freq}"`;
    if (s.freq && s.freq !== 'at will' && s.freq !== 'constant' && !n && !f.system.details.privateNotes.includes(esc(`"${s.freq}"`))) return `${it.name}: "${s.freq}" dropped`;
  }
  return '';
});
// Partial spell-map entries: marked where the GM will see them, three times.
const partials = [];
none('a partial match is marked in the spell\'s name, at the top of its text and in the notes; nothing else is', ({ o, f }, n) => {
  const items = of(f, 'spell'), notes = f.system.details.privateNotes;
  let k = 0;
  for (const sc of o.spellcasting) for (const r of sc.ranks) for (const s of r.spells) {
    const it = items[k++];
    if (!it) return `no item for ${s.name}`;
    const named = it.name.endsWith(' [partial match]'), top = it.system.description.value.startsWith(`<p><strong>Partial match for PF1e ${esc(s.pf1)}`);
    if (s.fit === 'partial') partials.push(`${n}: ${it.name}`);
    if (named !== (s.fit === 'partial') || top !== (s.fit === 'partial')) return `${it.name} (${s.fit}) name ${named} text ${top}`;
    if (s.fit === 'partial' && !(notes.includes('<h3>Partial spell matches</h3>') && notes.includes(esc(`${s.name} (${sc.name}, for PF1e ${s.pf1})`)))) return `${it.name} not in the notes`;
    if (s.fit === 'partial' && s.note && !it.system.description.value.includes(esc(s.note))) return `${it.name} lost the map's note`;
  }
  return '';
});
ok(partials.length === 10 && partials.some((p) => p === 'lich: Massacre [partial match]'), 'ten partial matches across the fixtures, the lich\'s Massacre among them', `${partials.length}: ${partials.join('; ')}`);
none('a spell\'s data is the Archive\'s own, with only its location and the partial mark added', ({ f }) => {
  for (const it of of(f, 'spell')) {
    const base = it.name.replace(/ \[partial match\]$/, '').replace(/ \((At Will|Constant)\)$/, '');
    const src = index.pf2ByName.get(base.toLowerCase());
    if (!src) return `${base} is not in data/spell.json`;
    const { location, ...rest } = it.system;
    const text = rest.description.value.replace(/^<p><strong>Partial match for PF1e [^]*?<\/strong><\/p>(\n<hr \/>\n)?/, '');
    if (!same({ ...rest, description: { ...rest.description, value: text } }, src.system)) return `${base} differs from the Archive`;
  }
  return '';
});
ok(pf2Spells.every((s) => s.system.location === undefined && !/Partial match/.test(s.system.description?.value || '')), 'and the Archive\'s spells in memory are untouched by the export');
{
  // Without the spell index the export still stands: a name and a rank, and a note saying so.
  const o = pair('succubus').o, bare = F.toFoundry(o);
  const sp = of(bare, 'spell');
  ok(sp.length === of(pair('succubus').f, 'spell').length && sp.every((s) => Number.isInteger(s.system.level.value) && s.system.description?.value === '' && s.system.location.value === of(bare, 'spellcastingEntry')[0]._id)
    && sp.every((s) => bare.system.details.privateNotes.includes(esc(`${s.name.replace(/ \(.*$/, '')}: no spell data to copy`))),
  'with no spell index a spell is a name and a rank, and the notes say so for each');
  ok(!badValue(bare) && same(JSON.parse(JSON.stringify(bare)), bare), 'and that file is whole too');
}

// ---- the kinds the task names ---------------------------------------------------
console.log('\nby kind');
{
  const lich = pair('lich'), cube = pair('gelatinous-cube'), swarm = pair('army-ant-swarm'), troll2 = pair('troll'), sorc = pair('npc-storm-sorcerer'), wisp = pair('no-strikes');
  ok(of(lich.f, 'spellcastingEntry')[0]?.system.prepared.value === 'prepared' && of(lich.f, 'spell').length >= 25 && lich.f.system.details.level.value === 12
    && same(lich.f.system.attributes.resistances, [{ type: 'physical', value: lich.o.resistances[0].value, exceptions: ['bludgeoning'] }]),
  'a caster: the lich, level 12, a prepared entry of 25 or more spells, physical resistance except bludgeoning');
  ok(lich.f.system.details.languages.value.includes('chthonian') && !lich.f.system.details.languages.value.includes('abyssal') && lich.f.system.details.privateNotes.includes('Language Abyssal is chthonian.'),
    'its Abyssal is written chthonian, and the notes say so');
  ok(of(troll2.f, 'melee').length === 2 && of(troll2.f, 'spellcastingEntry').length === 0 && troll2.f.system.traits.size.value === 'lg' && of(troll2.f, 'melee').every((m) => m.system.traits.value.includes('reach-10')),
    'a brute: the troll, Large, two Strikes with reach-10, no spells', JSON.stringify(of(troll2.f, 'melee').map((m) => [m.name, m.system.traits.value])));
  ok(cube.f.system.traits.value.includes('ooze') && cube.f.system.attributes.immunities.some((i) => i.type === 'critical-hits') && cube.f.system.perception.details === 'blindsight (precise) 60 feet' && cube.f.system.perception.senses.length === 0
    && same(Object.values(of(cube.f, 'melee')[0].system.damageRolls).map((d) => d.damageType), ['bludgeoning', 'acid']),
  'an ooze: the gelatinous cube, immune to critical hits, its slam two damage rolls, and blindsight (not a PF2e sense) kept as text');
  ok(swarm.f.system.traits.value.includes('swarm') && same(swarm.f.system.attributes.weaknesses.map((w) => w.type), ['area-damage', 'splash-damage']) && swarm.f.system.attributes.resistances[0]?.type === 'physical'
    && swarm.f.system.traits.size.value === 'tiny' && swarm.f.system.details.privateNotes.includes('Size Fine is Tiny'),
  'a swarm: the army ants, weak to area and splash damage, Fine written as Tiny with a note (no fixture is a troop)');
  ok(of(sorc.f, 'spellcastingEntry')[0]?.system.prepared.value === 'spontaneous' && of(sorc.f, 'spellcastingEntry')[0].system.slots.slot1?.max >= 2
    && sorc.f.system.details.privateNotes.includes('longbow: a ranged Strike with no range increment'),
  'a spontaneous caster: the storm sorcerer, slots by rank, and its longbow with no range increment is flagged');
  ok(of(wisp.f, 'melee').length === 0 && wisp.o.strikes.length === 0 && wisp.f.items.length === 1 && wisp.f.items[0].type === 'lore' && wisp.f.items[0].name === 'Lanterns Lore'
    && same(wisp.f.system.attributes.speed, { value: 5, otherSpeeds: [{ type: 'fly', value: 40 }], details: '' })
    && same(wisp.f.system.details.languages, { value: ['fey'], details: 'Lampwright' }) && wisp.f.system.skills.stealth?.base === wisp.o.skills.find((s) => s.name === 'Stealth').value,
  'one with no Strikes: a made-up wisp, no melee item, a Lore item, a fly Speed, Sylvan as fey and an unknown language as text', JSON.stringify(wisp.f.items.map((i) => i.name)) + JSON.stringify(wisp.f.system.details.languages));
  const succ = pair('succubus');
  ok(same(succ.f.system.attributes.resistances[0], { type: 'physical', value: succ.o.resistances[0].value, exceptions: ['cold-iron', 'holy'] }) && succ.o.resistances[0].except === 'cold iron or holy'
    && same(of(succ.f, 'melee')[0].system.traits.value, ['agile']) && succ.o.strikes[0].traits.join() === 'agile',
  'a fiend: the succubus, physical resistance except cold-iron and holy as two slugs, and her claw agile', JSON.stringify(succ.f.system.attributes.resistances[0]) + JSON.stringify(of(succ.f, 'melee')[0]?.system.traits));
  const levels = ['goblin', 'troll', 'lich', 'balor'].map((n) => pair(n).f.system.details.level.value);
  ok(same(levels, [-1, 5, 12, 20]), 'across levels: goblin -1, troll 5, lich 12, balor 20', String(levels));
  const dragon = C.convertCreature(parsePf1(fs.readFileSync(path.join(HERE, 'fixtures', 'pf1', 'young-red-dragon.txt'), 'utf8')), { spellIndex: index, level: 12, rarity: 'rare', hp: 'high' });
  const df = F.toFoundry(dragon, { spellIndex: index });
  ok(df.system.details.level.value === 12 && df.system.traits.rarity === 'rare' && df.system.attributes.hp.max === dragon.hp.value && df.system.attributes.hp.max !== pair('young-red-dragon').f.system.attributes.hp.max,
    'the page\'s level, rarity and Hit Points settings come through');
  // A word the data does not have goes to the notes, not into the field.
  const odd = structuredClone(pair('troll').o);
  odd.traits.push('Gloamwight'); odd.immunities.push('lantern light'); odd.weaknesses.push({ type: 'moonlight', value: 5 }); odd.resistances.push({ type: 'physical', value: 5, except: 'glass' });
  odd.senses.push('lampsense 30 feet'); odd.speeds.push('sprint'); odd.rarity = 'legendary'; odd.strikes[0].damage = '2d8+7 gloom';
  const of2 = F.toFoundry(odd, { spellIndex: index }), n2 = of2.system.details.privateNotes;
  ok(!of2.system.traits.value.includes('gloamwight') && n2.includes('Trait &quot;Gloamwight&quot;') && !of2.system.attributes.immunities.some((i) => i.type === 'lantern-light') && n2.includes('Immunity &quot;lantern light&quot;')
    && !of2.system.attributes.weaknesses.some((w) => w.type === 'moonlight') && n2.includes('Weakness moonlight 5'),
  'an unknown trait, immunity or weakness is left out of its field and named in the notes');
  ok(same(of2.system.attributes.resistances.at(-1), { type: 'physical', value: 5 }) && n2.includes('(except glass): the exception was not written') && of2.system.perception.details === 'lampsense 30 feet'
    && of2.system.attributes.speed.details === 'sprint' && of2.system.traits.rarity === 'common' && same(of(of2, 'melee')[0].system.damageRolls, {}) && n2.includes('damage &quot;2d8+7 gloom&quot;: not written as a damage roll'),
  'so is an unknown exception, sense, speed, rarity or damage type');
  // No fixture's ranged attack parses with a range increment, so one is given by hand.
  const bow = structuredClone(pair('npc-storm-sorcerer').o);
  bow.strikes.find((x) => x.kind === 'ranged').traits.push('range increment 100 feet');
  const bf = F.toFoundry(bow, { spellIndex: index }), longbow = of(bf, 'melee').find((i) => i.name === 'Longbow');
  ok(same(longbow?.system.range, { increment: 100, max: null }) && !bf.system.details.privateNotes.includes('a ranged Strike with no range increment') && of(bf, 'melee').find((i) => i.name === 'Spear').system.range === null,
    'a ranged Strike with a range increment carries it as its range, and a melee Strike has none', JSON.stringify(longbow?.system.range));
  const html = structuredClone(pair('troll').o);
  html.otherAbilities.push({ name: 'Glare', text: 'a <b>cold</b> look & "more"' });
  ok(of(F.toFoundry(html), 'action').at(-1).system.description.value === '<p>a &lt;b&gt;cold&lt;/b&gt; look &amp; &quot;more&quot;</p>', 'ability text is escaped, not read as HTML');
}

// ---- the README says what this is ------------------------------------------------
console.log('\nthe README');
{
  const readme = fs.readFileSync(path.join(PF, 'converter-assets', 'README.md'), 'utf8');
  ok(readme.includes('2026-09-09') && F.FOUNDRY_TARGET.includes('2026-09-09') && /has not been imported into a real Foundry/.test(readme), 'it names the same target date as the export and says no import has been done');
  const how = readme.split('## How to check it in Foundry')[1]?.split('\n## ')[0].trim().split('\n').filter((l) => /^\d\. /.test(l)) || [];
  ok(how.length === 5, 'and its Foundry check is five numbered lines', `${how.length} lines`);
}

console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'}`);
process.exit(failures ? 1 : 0);
