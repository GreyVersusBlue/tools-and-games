// converter-convert.test.mjs: PF1e stat blocks in, PF2e creatures out.
//
//   node Pathfinder/tests/converter-convert.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. The converter's promise is that its output is a creature Paizo could
// have printed. Eleven of the fixtures are monsters Paizo did print in both
// editions, and the Anathema Archive's data/npcs holds the PF2e versions, so
// the first half of this suite converts the PF1e block and measures it
// against the real one. The tolerances are wide per monster (a golem's AC is
// not a troll's) and tight on average; a tier table read one row off, or a
// benchmark anchored to the wrong column, moves the averages past them. The
// second half pins the rules that are not arithmetic: traits, immunities,
// swarm handling, breath weapons, spell ranks.
//
// The npc fields read here (system.details.level.value, attributes.ac.value,
// attributes.hp.max, saves.*.value, perception.mod, melee items'
// system.bonus.value) are asserted as they are read, per data/README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PF = path.join(HERE, '..');
const imp = (p) => import(pathToFileURL(path.join(PF, 'converter-assets', 'js', p)).href);
const { parsePf1 } = await imp('parse-pf1.js');
const C = await imp('convert.js');
const S = await imp('spells.js');
const read = (p) => JSON.parse(fs.readFileSync(path.join(PF, p), 'utf8'));
const fixture = (n) => parsePf1(fs.readFileSync(path.join(HERE, 'fixtures', 'pf1', n + '.txt'), 'utf8'));

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const index = S.buildSpellIndex({
  pf1: read('converter-assets/data/pf1-spells.json'),
  pf2: read('data/spell.json'),
  map: read('converter-assets/data/spell-map.json'),
});
const convert = (n, opts = {}) => C.convertCreature(fixture(n), { spellIndex: index, ...opts });

// ---- against Paizo's own PF2e versions -------------------------------------
console.log('against the printed PF2e creature');
const PAIRS = [
  ['goblin', 'Goblin Warrior', 'minus1'], ['kobold', 'Kobold Warrior', 'minus1'], ['human-skeleton', 'Skeleton Guard', 'minus1'],
  ['dire-rat', 'Giant Rat', 'minus1'], ['giant-centipede', 'Giant Centipede', 'minus1'], ['human-zombie', 'Zombie Shambler', 'minus1'],
  ['wolf', 'Wolf', '1'], ['ogre', 'Ogre Warrior', '3'],
  ['gelatinous-cube', 'Gelatinous Cube', '3'], ['owlbear', 'Owlbear', '4'], ['troll', 'Troll', '5'],
  ['army-ant-swarm', 'Army Ant Swarm', '5'], ['succubus', 'Succubus', '7'], ['lich', 'Lich', '12'],
  ['iron-golem', 'Iron Golem', '13'], ['balor', 'Balor', '20'],
];
const shards = new Map();
function printed(name, shard) {
  if (!shards.has(shard)) shards.set(shard, read(`data/npcs/npc-level-${shard}.json`));
  const list = shards.get(shard);
  const n = (Array.isArray(list) ? list : list.npcs).find((x) => x.name === name);
  if (!n) return null;
  const sy = n.system;
  const strikes = (n.items || []).filter((i) => i.type === 'melee').map((i) => i.system?.bonus?.value).filter(Number.isFinite);
  return {
    level: sy.details?.level?.value, ac: sy.attributes?.ac?.value, hp: sy.attributes?.hp?.max,
    fort: sy.saves?.fortitude?.value, ref: sy.saves?.reflex?.value, will: sy.saves?.will?.value,
    perception: sy.perception?.mod, strike: strikes.length ? Math.max(...strikes) : null,
  };
}
const err = { level: [], ac: [], save: [], hp: [], perception: [], strike: [] };
const lowHp = [], highHp = []; // hp error of the six CR 1/4 to 1/2 pairs (printed at level -1), and the rest
for (const [fx, name, shard] of PAIRS) {
  const p = printed(name, shard);
  ok(p && Object.values(p).every((v) => v === null || Number.isFinite(v)), `data/npcs has ${name} with every field this suite reads`);
  if (!p) continue;
  const o = convert(fx);
  const top = o.strikes.length ? Math.max(...o.strikes.map((s) => s.bonus)) : null;
  const d = {
    level: o.level.value - p.level, ac: o.ac.value - p.ac,
    fort: o.saves.fort.value - p.fort, ref: o.saves.ref.value - p.ref, will: o.saves.will.value - p.will,
    hp: (o.hp.value - p.hp) / p.hp, perception: o.perception.value - p.perception,
    strike: top != null && p.strike != null ? top - p.strike : null,
  };
  err.level.push(d.level); err.ac.push(d.ac); err.save.push(d.fort, d.ref, d.will);
  err.hp.push(d.hp); (shard === 'minus1' ? lowHp : highHp).push(d.hp); err.perception.push(d.perception); if (d.strike != null) err.strike.push(d.strike);
  const detail = `level ${o.level.value}/${p.level}, AC ${o.ac.value}/${p.ac}, HP ${o.hp.value}/${p.hp}, saves ${o.saves.fort.value}/${p.fort} ${o.saves.ref.value}/${p.ref} ${o.saves.will.value}/${p.will}, strike ${top}/${p.strike}`;
  ok(Math.abs(d.level) <= 1 && Math.abs(d.ac) <= 5 && Math.abs(d.hp) <= 0.5
    && [d.fort, d.ref, d.will].every((x) => Math.abs(x) <= 8) && (d.strike == null || Math.abs(d.strike) <= 5),
  `${fx} lands near the printed ${name}`, detail);
}
const mae = (xs) => xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length;
ok(mae(err.level) <= 0.35, 'level: mean error at most 0.35', mae(err.level).toFixed(2));
ok(mae(err.ac) <= 2.0, 'AC: mean error at most 2', mae(err.ac).toFixed(2));
ok(mae(err.save) <= 3.0, 'saves: mean error at most 3', mae(err.save).toFixed(2));
// HP is anchored at low below CR 1 and at 2.5 from CR 1 up (HISTORY #712).
// Measured on these sixteen: the six CR 1/4 to 1/2 pairs at 2.25, #711's
// anchor, ran +26.8% (goblin, kobold and skeleton 43% to 50% over), 12.5%
// error and -2.5% bias at low; the ten from CR 1 up ran 15.9% and -4.5% at
// 2.25, 14.8% and +1.0% at 2.5, +3.0% at 2.6. Each bound below fails one of
// those neighbours: the low-CR bounds fail every anchor tried from 1.25 up,
// the CR >= 1 bias fails 2.25 and 2.6, and the overall error fails 2.25.
const bias = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
ok(lowHp.length === 6 && highHp.length === 10, 'six hp pairs below CR 1 and ten from CR 1 up', `${lowHp.length} ${highHp.length}`);
ok(mae(err.hp) <= 0.145, 'HP: mean error at most 14.5%', (100 * mae(err.hp)).toFixed(1) + '%');
ok(mae(lowHp) <= 0.13 && Math.abs(bias(lowHp)) <= 0.05, 'HP below CR 1: mean error at most 13%, bias within 5%',
  `${(100 * mae(lowHp)).toFixed(1)}%, ${(100 * bias(lowHp)).toFixed(1)}%`);
ok(Math.abs(bias(highHp)) <= 0.02, 'HP from CR 1 up: mean bias within 2% either way', (100 * bias(highHp)).toFixed(1) + '%');
ok(mae(err.perception) <= 3.5, 'Perception: mean error at most 3.5', mae(err.perception).toFixed(2));
ok(mae(err.strike) <= 2.5, 'top Strike: mean error at most 2.5', mae(err.strike).toFixed(2));

// ---- rules -------------------------------------------------------------------
console.log('rules');
const dragon = convert('young-red-dragon');
ok(dragon.level.value === 10, 'young red dragon (CR 10) is level 10');
ok(dragon.immunities.includes('fire') && dragon.immunities.includes('paralyzed') && dragon.immunities.includes('sleep'),
  'dragon immunities read fire, paralyzed, sleep', dragon.immunities.join(', '));
ok(dragon.weaknesses.some((w) => w.type === 'cold'), 'vulnerability to cold becomes a cold weakness');
const bw = dragon.offAbilities.find((a) => a.name === 'Breath Weapon');
ok(bw && /40-foot cone/.test(bw.text) && /\d+d10 fire/.test(bw.text) && /basic Reflex/.test(bw.text) && bw.actions === '2',
  'breath weapon keeps its cone, die and element, as a two-action basic Reflex save', bw?.text);
const sorc = dragon.spellcasting.find((sc) => /Spontaneous/.test(sc.name));
ok(sorc && sorc.top === 1 && sorc.ranks.every((r) => r.rank <= 1),
  'a CR 10 dragon casting as a 1st-level sorcerer casts 1st-rank spells, not 5th', JSON.stringify(sorc?.ranks.map((r) => r.rank)));
ok(sorc?.ranks.some((r) => r.spells.some((s) => s.name === 'Sure Strike')), 'true strike comes through as Sure Strike');
ok(dragon.traits.includes('dragon') && dragon.traits.includes('fire'), 'dragon (fire) gives the dragon and fire traits');
const bite = dragon.strikes.find((s) => s.name === 'bite');
const claw = dragon.strikes.find((s) => s.name === 'claw');
ok(bite && claw && claw.traits.includes('agile') && !bite.traits.includes('agile'), 'paired claws are agile and the bite is not');
ok(bite?.traits.includes('reach 10 feet'), '"10 ft. with bite" gives the bite reach 10 feet');

const balor = convert('balor');
ok(balor.traits.includes('fiend') && balor.traits.includes('demon') && balor.traits.includes('unholy'), 'a demon is a fiend, a demon, and unholy');
ok(balor.weaknesses.some((w) => w.type === 'holy'), 'a fiend takes a holy weakness');
ok(balor.resistances.some((r) => r.type === 'physical' && /cold iron/.test(r.except) && /holy/.test(r.except)),
  'DR 15/cold iron and good becomes physical resistance except cold iron or holy', JSON.stringify(balor.resistances[0]));
ok(balor.saveNote.includes('saves vs. magic'), 'spell resistance becomes a status bonus to saves vs. magic');
ok(balor.spellcasting.some((sc) => sc.innate), 'spell-like abilities become innate spells');

const swarm = convert('bat-swarm');
ok(!swarm.immunities.includes('weapon damage') && swarm.weaknesses.some((w) => w.type === 'area damage')
  && swarm.resistances.some((r) => r.type === 'physical'), 'a swarm trades weapon immunity for physical resistance and an area weakness');

const lich = convert('lich');
ok(lich.traits.includes('undead') && lich.immunities.includes('death effects') && lich.immunities.includes('poison'),
  'undead get the undead immunities');
ok(!lich.traits.some((t) => /augmented/.test(t)), 'the "augmented humanoid" subtype does not leak into the traits');
ok(lich.strikes.some((s) => /void/.test(s.damage)), 'a negative energy touch deals void damage');
ok(lich.spellNotes.some((n) => /metamagic/.test(n.note)), 'a metamagic spell in the block is noted');

const troll = convert('troll');
const regen = troll.defAbilities.find((d) => /^Regeneration/.test(d.name));
ok(regen && /acid or fire/.test(regen.text), 'regeneration keeps what deactivates it', regen?.name + ' ' + regen?.text);
ok(troll.offAbilities.some((a) => a.name === 'Rend' && /two consecutive Strikes/.test(a.text)), 'rend becomes Rend with its Monster Core text');
ok(troll.skills.some((s) => s.name === 'Athletics'), 'Athletics comes from CMB when Climb and Swim are missing');

// ---- options and output -------------------------------------------------------
console.log('options and output');
const t8 = convert('troll', { level: 8 });
ok(t8.level.value === 8 && t8.ac.value > troll.ac.value && t8.hp.value > troll.hp.value, 'a level override rebuilds every number for the new level');
const tHigh = convert('troll', { hp: 'high' }), tLow = convert('troll', { hp: 'low' });
ok(tHigh.hp.value > tLow.hp.value, 'the HP option picks the high or low row');
ok([...Object.values(troll.saves), troll.ac, troll.hp, troll.perception].every((v) => typeof v.why === 'string' && v.why.length > 10),
  'every headline number says where it came from');
const text = C.toText(dragon);
ok(/^YOUNG RED DRAGON\s+CREATURE 10$/m.test(text) && /^AC \d+; Fort \+\d+, Ref \+\d+, Will \+\d+/m.test(text) && /^Melee \[one-action\] bite/m.test(text),
  'toText writes a PF2e stat block', text.split('\n').slice(0, 2).join(' | '));
const blank = C.convertCreature(parsePf1(''), {});
ok(blank.level.value === 1 && blank.notes.some((n) => n.warn), 'an empty creature converts at CR 1 with a warning instead of throwing');

// ---- helpers ------------------------------------------------------------------
console.log('helpers');
ok(C.readRow({ high: 10, moderate: 8 }, 2.5) === 9, 'readRow interpolates between tiers');
ok(C.readRow({ high: [90, 100], moderate: [70, 80] }, 3) === 95, 'readRow reads a range as its midpoint');
ok(C.readRow({ high: { avg: 16 }, moderate: { avg: 13 } }, 2) === 13, 'readRow reads {avg} cells');
const avgOf = (d) => { const m = d.match(/(\d+)d(\d+)([+-]\d+)?/); return +m[1] * (+m[2] + 1) / 2 + (+m[3] || 0); };
ok([8, 13, 20, 33, 44].every((a) => Math.abs(avgOf(C.diceFor(a, 8)) - a) <= 1), 'diceFor hits its target average within 1');
ok(C.mapSkill('Knowledge (arcana)') === 'Arcana' && C.mapSkill('Climb') === 'Athletics' && C.mapSkill('Profession (sailor)') === 'Sailor Lore' && C.mapSkill('Sense Motive') === null,
  'mapSkill folds PF1e skills into PF2e ones');
ok(C.tierWord(3) === 'high' && C.tierWord(2.5) === 'between moderate and high' && C.tierWord(4.1) === 'extreme', 'tierWord names a tier');

console.log(`\n${checks} checks, ${failures} FAILED`.replace(', 0 FAILED', ', all passed'));
process.exit(failures ? 1 : 0);
