// converter-convert.test.mjs: PF1e stat blocks in, PF2e creatures out.
//
//   node Pathfinder/tests/converter-convert.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. The converter's promise is that its output is a creature Paizo could
// have printed. Forty-eight of the fixtures are monsters Paizo did print in both
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
  ['wolf', 'Wolf', '1'], ['ghoul', 'Ghoul Stalker', '1'], ['giant-frog', 'Giant Frog', '1'], ['darkmantle', 'Darkmantle', '1'],
  ['homunculus', 'Homunculus', '0'], ['boar', 'Boar', '2'], ['crocodile', 'Crocodile', '2'], ['giant-ant', 'Giant Ant', '2'],
  ['dretch', 'Dretch', '2'], ['choker', 'Choker', '2'], ['hippogriff', 'Hippogriff', '2'], ['ogre', 'Ogre Warrior', '3'],
  ['gelatinous-cube', 'Gelatinous Cube', '3'], ['dire-wolf', 'Dire Wolf', '3'], ['doppelganger', 'Doppelganger', '3'],
  ['rust-monster', 'Rust Monster', '3'], ['hell-hound', 'Hell Hound', '3'], ['owlbear', 'Owlbear', '4'], ['gargoyle', 'Gargoyle', '4'],
  ['griffon', 'Griffon', '4'], ['mimic', 'Mimic', '4'], ['basilisk', 'Basilisk', '5'], ['gibbering-mouther', 'Gibbering Mouther', '5'],
  ['djinni', 'Djinni', '5'], ['ettin', 'Ettin', '6'], ['wyvern', 'Wyvern', '6'], ['troll', 'Troll', '5'],
  ['army-ant-swarm', 'Army Ant Swarm', '5'], ['succubus', 'Succubus', '7'], ['lich', 'Lich', '12'],
  ['iron-golem', 'Iron Golem', '13'], ['balor', 'Balor', '20'], ['chuul', 'Chuul', '7'], ['medusa', 'Medusa', '7'],
  ['hill-giant', 'Hill Giant', '7'], ['gorgon', 'Gorgon', '8'], ['erinyes', 'Erinys', '8'], ['frost-giant', 'Frost Giant', '9'],
  ['fire-giant', 'Fire Giant', '10'], ['stone-golem', 'Stone Golem', '11'], ['glabrezu', 'Glabrezu', '13'],
  ['nalfeshnee', 'Nalfeshnee', '14'],
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
// Paizo prints the gargoyle at 40 hp, under level 4's low row, and gives it
// physical resistance 5 instead; no PF1e number predicts that. It stays in the
// hp averages below (HISTORY #714) but is excused from the per-monster 50%.
const HP_OUTLIERS = new Set(['gargoyle']);
const err = { level: [], ac: [], save: [], hp: [], perception: [], strike: [] };
// hp error of the six CR 1/4 to 1/2 pairs (printed at level -1), the eleven at
// CR 1 and 2, the thirty-one from CR 3 up, and the fourteen of those from CR 7 up.
const lowHp = [], midHp = [], highHp = [], topHp = [];
// Every number that lands on its per-monster bound or one short of it (hp:
// within five points of the 50%), as "fixture stat difference".
const nearBound = [];
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
  const cr = fixture(fx).cr;
  err.hp.push(d.hp); (cr < 1 ? lowHp : cr < 3 ? midHp : highHp).push(d.hp); if (cr >= 7) topHp.push(d.hp); err.perception.push(d.perception); if (d.strike != null) err.strike.push(d.strike);
  for (const [k, bound] of [['level', 1], ['ac', 5], ['fort', 8], ['ref', 8], ['will', 8], ['strike', 5]]) {
    if (d[k] != null && Math.abs(d[k]) >= bound - (k === 'level' ? 0 : 1)) nearBound.push(`${fx} ${k} ${d[k] > 0 ? '+' : ''}${d[k]}`);
  }
  if (Math.abs(d.hp) >= 0.45 && !HP_OUTLIERS.has(fx)) nearBound.push(`${fx} hp ${d.hp > 0 ? '+' : ''}${Math.round(100 * d.hp)}%`);
  const detail = `level ${o.level.value}/${p.level}, AC ${o.ac.value}/${p.ac}, HP ${o.hp.value}/${p.hp}, saves ${o.saves.fort.value}/${p.fort} ${o.saves.ref.value}/${p.ref} ${o.saves.will.value}/${p.will}, strike ${top}/${p.strike}`;
  ok(Math.abs(d.level) <= 1 && Math.abs(d.ac) <= 5 && (Math.abs(d.hp) <= 0.5 || HP_OUTLIERS.has(fx))
    && [d.fort, d.ref, d.will].every((x) => Math.abs(x) <= 8) && (d.strike == null || Math.abs(d.strike) <= 5),
  `${fx} lands near the printed ${name}`, detail);
}
const mae = (xs) => xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length;
ok(mae(err.level) <= 0.35, 'level: mean error at most 0.35', mae(err.level).toFixed(2));
ok(mae(err.ac) <= 2.0, 'AC: mean error at most 2', mae(err.ac).toFixed(2));
ok(mae(err.save) <= 3.0, 'saves: mean error at most 3', mae(err.save).toFixed(2));
// HP is anchored at low below CR 1 (HISTORY #712) and at 2.2 from CR 1 up
// (#714, and #716 for CR 7 up). Measured on these 48: the six CR 1/4 to 1/2
// pairs ran 12.4% error and -2.6% bias at low, 18.1% and +4.7% at 1.25; the
// eleven at CR 1 and 2 ran -2.0% bias at 2.1, +0.2% at 2.2, +3.2% at 2.3; the
// thirty-one from CR 3 up ran -3.4% at 2.0, +1.1% at 2.2, +2.4% at 2.25 and
// +8.3% at #713's 2.5; the fourteen from CR 7 up ran -2.7% at 2.1, -0.3% at
// 2.2 and +2.1% at 2.3. Each bound below fails a neighbour: the low-CR bounds
// fail 1.25, the CR 1 to 2 bias fails 2.1 and 2.3, the CR 3+ bias fails 2.0
// and 2.25, the CR 7+ bias fails 2.1 and 2.3, and the overall error (16.0%
// here) fails 2.25 (16.4%).
const bias = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
ok(lowHp.length === 6 && midHp.length === 11 && highHp.length === 31 && topHp.length === 14,
  'hp pairs: six below CR 1, eleven at CR 1 and 2, thirty-one from CR 3 up, fourteen of them from CR 7 up',
  `${lowHp.length} ${midHp.length} ${highHp.length} ${topHp.length}`);
ok(mae(err.hp) <= 0.162, 'HP: mean error at most 16.2%', (100 * mae(err.hp)).toFixed(2) + '%');
ok(mae(lowHp) <= 0.13 && Math.abs(bias(lowHp)) <= 0.05, 'HP below CR 1: mean error at most 13%, bias within 5%',
  `${(100 * mae(lowHp)).toFixed(1)}%, ${(100 * bias(lowHp)).toFixed(1)}%`);
ok(Math.abs(bias(midHp)) <= 0.02, 'HP at CR 1 and 2: mean bias within 2% either way', (100 * bias(midHp)).toFixed(1) + '%');
ok(Math.abs(bias(highHp)) <= 0.02, 'HP from CR 3 up: mean bias within 2% either way', (100 * bias(highHp)).toFixed(1) + '%');
ok(Math.abs(bias(topHp)) <= 0.02, 'HP from CR 7 up: mean bias within 2% either way', (100 * bias(topHp)).toFixed(1) + '%');
ok(mae(err.perception) <= 3.5, 'Perception: mean error at most 3.5', mae(err.perception).toFixed(2));
ok(mae(err.strike) <= 2.5, 'top Strike: mean error at most 2.5', mae(err.strike).toFixed(2));

// ---- the pairs on a bound ------------------------------------------------------
// Eleven numbers sit on a per-monster bound or one short of it. They are named
// here so that a change to a tier table, an anchor or a clamp shows which of
// them moved, in this line's detail, before the pair's own line goes red.
// Moving one is not wrong; moving one without looking is. Two were on the bound
// itself and neither is a table entry read wrong (HISTORY #829). The medusa
// still is; the save cap took the nalfeshnee one point off (HISTORY #831):
//   medusa AC 20 against 25. PF1e prints AC 15 at CR 7 (Dex +2, natural +3),
//     five under Table 1-1's 20, where Paizo's PF2e medusa is on high. The
//     source is the outlier. 20 is also the lowest AC the converter writes at
//     level 7 (low less one step), so no AC anchor from 1.5 to 3 moves it.
//   nalfeshnee Will 30 against 23. PF1e prints Will +21 at CR 14, four over
//     the good save (Wis 22 and Iron Will); Paizo printed Will as its worst
//     save bar Reflex, a third of the way from low to moderate. The PF2e side
//     is the outlier. 30 is the highest save the converter writes at level 14
//     (bench stops a save at extreme), so no save anchor from 2.5 up moves it.
//     It was 31, on the bound, while bench stopped saves at 4.5.
console.log('the pairs on a bound');
{
  const want = ['kobold strike +4', 'giant-centipede level +1', 'human-zombie level +1', 'homunculus level +1',
    'ogre ac +4', 'gelatinous-cube ac +4', 'doppelganger strike +4', 'gibbering-mouther hp -45%', 'lich strike -4',
    'medusa ac -5', 'nalfeshnee will +7'];
  ok(JSON.stringify(nearBound) === JSON.stringify(want), 'the numbers on a bound or one short of it are the eleven named here',
    `now: ${nearBound.join(', ')}${want.filter((w) => !nearBound.includes(w)).length ? '\n        gone: ' + want.filter((w) => !nearBound.includes(w)).join(', ') : ''}`);

  const T = await imp('tables.js');
  const convertWith = (n, edit) => { const c = fixture(n); edit(c); return C.convertCreature(c, { spellIndex: index }); };
  const med = fixture('medusa'), row7 = T.PF2_AC[7];
  ok(med.ac.total - T.pf1Anchors(7).ac === -5 && T.pf1TierOf('ac', med.ac.total, 7) === -0.25 && T.tierOf(printed('Medusa', '7').ac, row7) === T.TIERS.high,
    'medusa: PF1e AC 15 is five under CR 7\'s 20 and reads a quarter tier under the bottom of the AC table; the printed 25 is high',
    `tier ${T.pf1TierOf('ac', med.ac.total, 7)}`);
  // The AC table has no terrible column, and readRow goes one step past the
  // last column a row has and stops. bench's own floor of 0 is the same place
  // on this table, so the end-to-end half of this line is held by readRow alone.
  ok(C.readRow(row7, -3) === row7.low - 2 && convert('medusa').ac.value === row7.low - 2 && convertWith('medusa', (c) => { c.ac.total = 8; }).ac.value === row7.low - 2,
    'medusa: AC 20 is the lowest the converter writes at level 7, and a PF1e AC of 8 reads the same',
    `${convert('medusa').ac.value}, ${convertWith('medusa', (c) => { c.ac.total = 8; }).ac.value}`);
  const nal = fixture('nalfeshnee'), row14 = T.PF2_SAVES[14], pn = printed('Nalfeshnee', '14');
  ok(nal.saves.will - T.pf1Anchors(14).save === 4 && T.pf1TierOf('save', nal.saves.will, 14) === 5 && pn.will < row14.moderate && pn.will > row14.low,
    'nalfeshnee: PF1e Will +21 is four over CR 14\'s good save and reads a tier past extreme; the printed 23 is under moderate',
    `tier ${T.pf1TierOf('save', nal.saves.will, 14)}, printed ${pn.will} against moderate ${row14.moderate}`);
  // bench stops a save's tier at extreme (#831). Every other stat stops at
  // 4.5, half a step past it, and readRow would go on to 5.
  ok(convert('nalfeshnee').saves.will.value === row14.extreme && convertWith('nalfeshnee', (c) => { c.saves.will = 30; }).saves.will.value === row14.extreme,
    'nalfeshnee: Will 30 is the highest save the converter writes at level 14, and a PF1e Will of +30 reads the same',
    `${convert('nalfeshnee').saves.will.value}, ${convertWith('nalfeshnee', (c) => { c.saves.will = 30; }).saves.will.value}`);
  // The rule itself (#831): no converted save is over the extreme column the
  // GM Core prints for the creature's level. Read on every fixture as it
  // stands, and again with all three PF1e saves set to +60, which is past
  // extreme at every CR and so lands each one on the cap. The second half is
  // what fails at CRs the 48 pairs do not reach.
  const over = [];
  let capped = 0, atCap = 0;
  const names = fs.readdirSync(path.join(HERE, 'fixtures', 'pf1')).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4));
  for (const n of names) {
    for (const [how, o] of [['as printed', convert(n)], ['saves at +60', convertWith(n, (c) => { c.saves = { ...c.saves, fort: 60, ref: 60, will: 60 }; })]]) {
      const extreme = T.PF2_SAVES[o.level.value].extreme;
      for (const k of ['fort', 'ref', 'will']) {
        const v = o.saves[k].value;
        if (v > extreme) over.push(`${n} ${k} ${v} over ${extreme} (${how})`);
        if (how === 'saves at +60') { capped++; if (v === extreme) atCap++; }
      }
    }
  }
  ok(names.length >= 48 && over.length === 0 && atCap === capped,
    'no converted save is over the extreme column for its level, and a PF1e save of +60 lands on it',
    `${names.length} fixtures, ${atCap} of ${capped} forced saves on extreme${over.length ? '\n        ' + over.slice(0, 8).join('; ') + (over.length > 8 ? `; and ${over.length - 8} more` : '') : ''}`);
}

// ---- rules -------------------------------------------------------------------
console.log('rules');
{
  // A paste cut off mid-field leaves an unclosed parenthesis; the special
  // attack still converts, with what text there is, rather than throwing.
  let o = null;
  try { o = C.convertCreature(parsePf1('Ogre CR 3\nhp 30 (4d8+12)\nSpecial Attacks rend (2 claws, 1d6'), {}); } catch { /* o stays null */ }
  ok(o?.offAbilities.some((a) => a.name === 'Rend' && /PF1e: 2 claws, 1d6\./.test(a.text)), 'a special attack cut off mid-parenthesis converts instead of throwing',
    JSON.stringify(o?.offAbilities));
}
const dragon = convert('young-red-dragon');
ok(dragon.level.value === 10, 'young red dragon (CR 10) is level 10');
ok(dragon.immunities.includes('fire') && dragon.immunities.includes('paralyzed') && dragon.immunities.includes('sleep'),
  'dragon immunities read fire, paralyzed, sleep', dragon.immunities.join(', '));
ok(dragon.weaknesses.some((w) => w.type === 'cold'), 'vulnerability to cold becomes a cold weakness');
const bw = dragon.offAbilities.find((a) => a.name === 'Breath Weapon');
ok(bw && /40-foot cone/.test(bw.text) && /\d+d10 fire/.test(bw.text) && /basic Reflex/.test(bw.text) && bw.actions === '2',
  'breath weapon keeps its cone, die and element, as a two-action basic Reflex save', bw?.text);
{
  // A PF1e construct's Fort is a base save with no Con behind it (stone golem
  // +4 at CR 11, terrible); it reads no lower than moderate (HISTORY #715).
  const g = convert('stone-golem'), h = convert('homunculus');
  ok(g.saves.fort.value === 21 && g.saves.ref.value === 15, 'a construct\'s Fort reads no lower than moderate; its Reflex is left alone',
    `Fort ${g.saves.fort.value}, Ref ${g.saves.ref.value}`);
  ok(h.traits.includes('construct'), 'the homunculus ("Any alignment (same as creator) Tiny construct") is a construct', h.traits.join(', '));
}
{
  // The gorgon's breath turns to stone and rolls no dice: it keeps its own
  // text rather than becoming an untyped damage cone, and is written once.
  const g = convert('gorgon');
  const b = g.offAbilities.filter((a) => a.name === 'Breath Weapon');
  ok(b.length === 1 && /petrified/.test(b[0].text) && !/damage \(DC/.test(b[0].text) && /additional Fortitude saves/.test(b[0].text) && !g.otherAbilities.some((a) => a.name === 'Breath Weapon'),
    'a breath weapon with no damage dice keeps its petrifying text, once, and "saves" stays plural', JSON.stringify(b));
}
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
