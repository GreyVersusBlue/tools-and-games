// converter-abilities.test.mjs: PF1e special abilities rewritten in 2e form.
//
//   node Pathfinder/tests/converter-abilities.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. converter-assets/js/abilities.js rewrites an ability only when a rule
// reads its whole construction, and the promise is in two halves: what a rule
// writes carries the converter's numbers for that creature, and what no rule
// reads is left byte for byte as it was. The second half is the one a careless
// rule breaks without anybody noticing, so it is held three ways: named inputs
// that must not match, a hash of every unrewritten ability in the 57 fixtures
// taken from the converter as it stood before the rules existed (HISTORY
// #894), and a hash of everything else on each creature.
//
// The expected sentences below were read against the PF1e fixtures by hand.
// The DC checks read tables.js for the figure and the fixture's own PF1e DC
// for the tier; they do not call the rule's arithmetic.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PF = path.join(HERE, '..');
const imp = (p) => import(pathToFileURL(path.join(PF, 'converter-assets', 'js', p)).href);
const { parsePf1 } = await imp('parse-pf1.js');
const C = await imp('convert.js');
const S = await imp('spells.js');
const T = await imp('tables.js');
const A = await imp('abilities.js');
const F = await imp('foundry.js');
const M = await import(pathToFileURL(path.join(PF, 'converter-assets', 'measure-abilities.mjs')).href);
const read = (p) => JSON.parse(fs.readFileSync(path.join(PF, p), 'utf8'));
const DIR = path.join(HERE, 'fixtures', 'pf1');
const raw = (n) => fs.readFileSync(path.join(DIR, n + '.txt'), 'utf8');

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

const index = S.buildSpellIndex({
  pf1: read('converter-assets/data/pf1-spells.json'),
  pf2: read('data/spell.json'),
  map: read('converter-assets/data/spell-map.json'),
});
const convertText = (text, opts = {}) => C.convertCreature(parsePf1(text), { spellIndex: index, ...opts });
const convert = (n, opts) => convertText(raw(n), opts);
const all = (o) => [...o.offAbilities, ...o.otherAbilities];
// A missing ability fails the check that looks for it, rather than throwing
// in the next line and taking the suite with it.
const MISSING = Object.freeze({ name: '(no such ability)', text: '', traits: [], numbers: {}, wording: 'missing' });
const find = (o, name) => all(o).find((a) => a.name === name) || MISSING;
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort().map((f) => f.replace(/\.txt$/, ''));
const CREATURES = Object.fromEntries(FILES.map((f) => [f, convert(f)]));

// ---- each rule, on real stat blocks, to the letter -------------------------
console.log('each rule on real stat blocks');
// [fixture, ability name, rule, actions, traits, PF1e DC or null, exact text]
const EXPECT = [
  ['giant-centipede', 'Poison', 'affliction', '', 'poison', 13, "A creature damaged by the monster's bite Strike is exposed. Saving Throw DC 16 Fortitude; Maximum Duration 6 rounds; Stage 1 clumsy 1 (1 round)."],
  ['giant-ant', 'Poison', 'affliction', '', 'poison', 14, "A creature damaged by the monster's sting Strike is exposed. Saving Throw DC 19 Fortitude; Maximum Duration 4 rounds; Stage 1 enfeebled 1 (1 round)."],
  ['wyvern', 'Poison', 'affliction', '', 'poison', 17, "A creature damaged by the monster's sting Strike is exposed. Saving Throw DC 25 Fortitude; Maximum Duration 6 rounds; Stage 1 drained 1 (1 round)."],
  ['medusa', 'Poison', 'affliction', '', 'poison', 18, "A creature damaged by the monster's bite Strike is exposed. Saving Throw DC 26 Fortitude; Maximum Duration 6 rounds; Stage 1 enfeebled 1 (1 round)."],
  ['dire-rat', 'Filth Fever', 'affliction', '', 'disease', 11, "A creature damaged by the monster's bite Strike is exposed. Saving Throw DC 15 Fortitude; Onset 1d3 days; Stage 1 clumsy 1 and drained 1 (1 day)."],
  ['ghoul', 'Ghoul Fever', 'affliction', '', 'disease', 13, "A creature damaged by the monster's bite Strike is exposed. Saving Throw DC 17 Fortitude; Onset 1 day; Stage 1 drained 1 and clumsy 1 (1 day). A humanoid who dies of ghoul fever rises as a ghoul at the next midnight. A humanoid who becomes a ghoul in this way retains none of the abilities it possessed in life. It is not under the control of any other ghouls, but it hungers for the flesh of the living and behaves like a normal ghoul in all respects. A humanoid of 4 Hit Dice or more rises as a ghast."],
  ['medusa', 'Petrifying Gaze', 'gaze', '', 'visual', 16, 'A creature that starts its turn within 30 feet and can see the monster must attempt a DC 24 Fortitude save. On a failure, it is petrified permanently.'],
  ['basilisk', 'Gaze', 'gaze', '', 'visual', 15, 'A creature that starts its turn within 30 feet and can see the monster must attempt a DC 22 Fortitude save. On a failure, it is petrified permanently. A creature petrified in this matter that is then coated (not just splashed) with fresh basilisk blood (taken from a basilisk no more than 1 hour dead) is instantly restored to flesh. A single basilisk contains enough blood to coat 1d3 Medium creatures in this manner.'],
  ['choker', 'Constrict', 'constrict', '1', '', null, 'The monster deals 2d4+5 bludgeoning damage to each creature it has grabbed or restrained (DC 15 basic Fortitude save).'],
  ['chuul', 'Constrict', 'constrict', '1', '', null, 'The monster deals 3d6+7 bludgeoning damage to each creature it has grabbed or restrained (DC 22 basic Fortitude save).'],
  ['darkmantle', 'Constrict', 'constrict', '1', '', null, 'The monster deals 2d4+3 bludgeoning damage to each creature it has grabbed or restrained (DC 14 basic Fortitude save).'],
  ['mimic', 'Constrict', 'constrict', '1', '', null, 'The monster deals 1d8+5 bludgeoning damage to each creature it has grabbed or restrained (DC 18 basic Fortitude save).'],
  ['gorgon', 'Trample', 'trample', '3', '', 21, 'The monster Strides up to double its Speed and can move through the spaces of creatures its size or smaller. Each creature whose space it enters takes 2d8+12 bludgeoning damage (DC 29 basic Reflex save).'],
  ['troll', 'Rend', 'rend', '1', '', null, 'claw. Requirements The monster hit the same creature with two claw Strikes this turn. Effect That creature takes the damage of one claw Strike again (3d6+8 slashing).'],
  ['glabrezu', 'Rend', 'rend', '1', '', null, 'pincer. Requirements The monster hit the same creature with two pincer Strikes this turn. Effect That creature takes the damage of one pincer Strike again (4d8+18 piercing).'],
  ['hill-giant', 'Throw Rock', 'throw-rock', '1', '', null, 'The monster picks up a rock within reach, or draws one it carries, and throws it as a ranged Strike with a range increment of 120 feet.'],
  ['fire-giant', 'Throw Rock', 'throw-rock', '1', '', null, 'The monster picks up a rock within reach, or draws one it carries, and throws it as a ranged Strike with a range increment of 120 feet.'],
  ['army-ant-swarm', 'Distraction', 'distraction', '', '', 15, 'A creature that takes damage from the swarm must succeed at a DC 22 Fortitude save or be sickened 1.'],
  ['bat-swarm', 'Distraction', 'distraction', '', '', 11, 'A creature that takes damage from the swarm must succeed at a DC 16 Fortitude save or be sickened 1.'],
  ['hell-hound', 'Breath Weapon', 'breath', '2', 'fire,arcane', 14, "The creature breathes a 10-foot cone that deals 4d6 fire damage (DC 20 basic Reflex save). It can't use Breath Weapon again for 1d4 rounds."],
  ['young-red-dragon', 'Breath Weapon', 'breath', '2', 'fire,arcane', 19, "The creature breathes a 40-foot cone that deals 7d10 fire damage (DC 29 basic Reflex save). It can't use Breath Weapon again for 1d4 rounds."],
];
for (const [fx, name, rule, actions, traits, , text] of EXPECT) {
  const a = find(CREATURES[fx], name);
  ok(a.text === text, `${fx}: ${name} reads as written here`, a.text === text ? '' : a.text || a.name);
  ok(a.wording === 'rule' && a.rule === rule && (a.actions || '') === actions && (a.traits || []).join(',') === traits,
    `${fx}: ${name} is the ${rule} rule's, ${actions || 'no'} actions, traits [${traits}]`, `${a.wording}/${a.rule}/${a.actions}/${(a.traits || []).join(',')}`);
}
ok(RegExp('^' + A.RULES.concat('breath').map((r) => `(?=.*\\b${r}\\b)`).join('')).test([...new Set(EXPECT.map((e) => e[2]))].join(' ')),
  'every rule in abilities.js, and the breath rule, has a real input above', [...new Set(EXPECT.map((e) => e[2]))].join(' '));

// ---- the numbers are the converter's ---------------------------------------
console.log('the numbers a rule writes');
const tierDc = (o, cr, dc1) => Math.round(C.readRow(T.PF2_SPELL_DC[o.level.value], Math.min(4, Math.max(1, T.pf1TierOf('dc', dc1, cr)))));
for (const [fx, name, , , , dc1] of EXPECT) {
  if (dc1 == null) continue;
  const o = CREATURES[fx], a = find(o, name), cr = parsePf1(raw(fx)).cr;
  const want = tierDc(o, cr, dc1);
  const got = [...a.text.matchAll(/\bDC (\d+)/g)].map((m) => Number(m[1]));
  ok(got.length === 1 && got[0] === want && want !== dc1, `${fx}: ${name} writes DC ${want}, the spell DC table's figure at level ${o.level.value}, not PF1e's ${dc1}`, `wrote ${got.join(', ')}`);
}
// A rule that carries the PF1e DC across would pass the row above only where
// the two editions agree, so no pair above may agree.
for (const fx of ['choker', 'chuul', 'darkmantle', 'mimic']) {
  const o = CREATURES[fx], a = find(o, 'Constrict');
  const want = T.PF2_SPELL_DC[o.level.value].moderate;
  ok(a.numbers?.dc === want && a.text.includes(`(DC ${want} basic Fortitude save)`), `${fx}: Constrict, which PF1e gives no DC, takes the moderate DC for level ${o.level.value}`, `DC ${a.numbers?.dc}, table ${want}`);
}
// Constrict, Trample and Rend deal a Strike's damage: the dice must be on one
// of the creature's own Strikes, to the letter.
for (const [fx, name] of [['choker', 'Constrict'], ['chuul', 'Constrict'], ['mimic', 'Constrict'], ['troll', 'Rend'], ['glabrezu', 'Rend']]) {
  const o = CREATURES[fx], a = find(o, name);
  const strike = o.strikes.find((s) => s.damage.split(' ')[0] === a.numbers?.damage);
  ok(strike && a.numbers?.damage && a.text.includes(a.numbers?.damage), `${fx}: ${name} deals ${a.numbers?.damage}, its own ${strike?.name} Strike's dice`, o.strikes.map((s) => `${s.name} ${s.damage}`).join('; '));
}
{
  // The gorgon's trample (2d8+10) matches neither of its Strikes' PF1e dice,
  // so it is scaled by the ratio its gore was: more than PF1e's, and no Strike's.
  const o = CREATURES.gorgon, a = find(o, 'Trample');
  ok(a.numbers?.damage === '2d8+12' && !o.strikes.some((s) => s.damage.startsWith('2d8+12 ')) && !a.text.includes('2d8+10'),
    'gorgon: Trample is scaled as its Strike damage was, and PF1e\'s 2d8+10 is gone', o.strikes.map((s) => `${s.name} ${s.damage}`).join('; '));
  // The darkmantle's constrict (1d4+4) is not its slam's dice (1d4) either. Scaled
  // by the slam's ratio it would pass extreme Strike damage for level 1, so it
  // stops there.
  const dm = CREATURES.darkmantle, dc = find(dm, 'Constrict');
  const top = C.readRow(T.PF2_STRIKE_DAMAGE[dm.level.value], T.TIERS.extreme);
  const avgOf = (d) => { const m = String(d).match(/(\d+)d(\d+)([+-]\d+)?/); if (!m) return NaN; return Number(m[1]) * (Number(m[2]) + 1) / 2 + Number(m[3] || 0); };
  ok(Math.abs(avgOf(dc.numbers?.damage) - top) <= 0.5 && !dm.strikes.some((s) => s.damage.startsWith(dc.numbers?.damage + ' ')),
    'darkmantle: Constrict, scaled, stops at extreme Strike damage for its level', `${dc.numbers?.damage} (avg ${avgOf(dc.numbers?.damage)}), extreme ${top}`);
  // Moving the level moves every figure a rule wrote.
  const up = find(convert('gorgon', { level: 12 }), 'Trample'), up2 = find(convert('medusa', { level: 3 }), 'Poison');
  ok(up.numbers?.dc > a.numbers?.dc && up.numbers?.damage !== a.numbers?.damage && up2.numbers?.dc < find(CREATURES.medusa, 'Poison').numbers?.dc,
    'a level set by hand moves the DC and the damage a rule writes', `gorgon at 12: DC ${up.numbers?.dc}, ${up.numbers?.damage}; medusa at 3: DC ${up2.numbers?.dc}`);
}
{
  const hh = find(CREATURES['hell-hound'], 'Breath Weapon');
  const lim = T.PF2_AREA_DAMAGE[CREATURES['hell-hound'].level.value].limited.avg;
  ok(hh.text.includes(`${C.diceOnly(lim, 6)} fire damage`) && !hh.traits.includes('rounds'),
    'hell hound: "once every 2d4 rounds" is the recharge, and the breath deals the level\'s limited area damage in d6 fire', hh.text);
}

// ---- what no rule may touch ---------------------------------------------------
console.log('what stays as it was');
const KEEP = [
  ['homunculus', 'Poison', 'Bite—injury; save Fort DC 17; frequency 1/minute for 60 minutes; effect sleep for 1 minute; cure 1 save. The save DC is Constitution-based and includes a +2 racial bonus.', 'a poison whose effect is not ability damage'],
  ['iron-golem', 'Breath Weapon', null, 'an inhaled poison written inside a paragraph'],
  ['gorgon', 'Breath Weapon', null, 'a breath weapon that deals no dice'],
  ['gelatinous-cube', 'Paralysis', 'A gelatinous cube secretes an anesthetizing slime. A target hit by a cube\'s melee or engulf attack must succeed on a DC 23 Fortitude or be paralyzed for 3d6 rounds. The cube can automatically engulf a paralyzed opponent. The save DC is Constitution-based.', 'a save in a sentence'],
  ['choker', 'Grab', null, 'grab (Large)'],
  ['griffon', 'Rake', 'PF1e: 2 claws +7, 1d4+3.', 'rake, which no rule reads'],
  ['giant-frog', 'Swallow Whole', null, 'swallow whole'],
  ['lich', 'Paralyzing Touch', 'PF1e: DC 29.', 'a name and a DC'],
];
for (const [fx, name, text, what] of KEEP) {
  const a = find(CREATURES[fx], name);
  ok(a.wording === 'pf1e' && !a.rule && (text == null || a.text === text), `${fx}: ${name} is left in PF1e wording (${what})`, `${a.wording}: ${a.text.slice(0, 90)}`);
}
// Made-up blocks: each is one step away from a construction a rule reads.
const block = (special, sa = '', melee = 'bite +5 (1d6+3), 2 claws +5 (1d4+3)') => `Test Beast CR 4
N Medium magical beast
Init +1; Perception +8
DEFENSE
AC 17, touch 11, flat-footed 16
hp 42 (5d10+15)
Fort +7, Ref +5, Will +2
OFFENSE
Speed 30 ft.
Melee ${melee}
${sa ? `Special Attacks ${sa}\n` : ''}STATISTICS
Str 16, Dex 13, Con 16, Int 2, Wis 12, Cha 6
Base Atk +5; CMB +8; CMD 19
${special ? `SPECIAL ABILITIES\n${special}\n` : ''}`;
const made = (special, sa, melee) => all(convertText(block(special, sa, melee)));
const NOT = [
  ['a contact poison', made('Poison (Ex) Slime—contact; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d2 Str; cure 1 save.')[0]],
  ['a poison that deals hit point damage', made('Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d6 fire damage; cure 1 save.')[0]],
  ['a poison with a second effect', made('Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d2 Str and staggered; cure 1 save.')[0]],
  ['a stat line under a name that is neither poison nor disease', made('Curse (Su) Bite—injury; save Fort DC 15; frequency 1/day; effect 1d2 Str; cure 1 save.')[0]],
  ['a gaze with an effect no rule knows', made('Gaze (Su) Turn to dust permanently, 30 feet, Fortitude DC 15 negates.')[0]],
  ['a poison stat line after a sentence of its own', made('Poison (Ex) The venom burns. Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d2 Str; cure 1 save.')[0]],
  ['a rend naming a Strike the creature lacks', made('', 'rend (2 slams, 1d6+4)')[0]],
  ['a rend cut off mid-parenthesis', made('', 'rend (2 claws, 1d4+3')[0]],
  ['a constrict that names a size, not damage', made('', 'constrict (Large)')[0]],
  ['a trample with no DC', made('', 'trample (1d6+4)')[0]],
  ['a distraction with more than a DC', made('', 'distraction (DC 14, 1 round)')[0]],
  ['rock throwing with no range in its parenthesis', made('', 'rock throwing (two-handed)')[0]],
];
for (const [what, a] of NOT) ok(a && a.wording !== 'rule' && !a.rule && !a.numbers, `not rewritten: ${what}`, a ? `${a.name}: ${a.text.slice(0, 80)}` : 'the block made no ability');
{
  // And the same blocks, one step back, are rewritten: the block above is a
  // stat block the parser reads, not one every rule ignores.
  const yes = [made('Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d2 Str; cure 1 save.')[0],
    made('Gaze (Su) Turn to stone permanently, 30 feet, Fortitude DC 15 negates.')[0], made('', 'rend (2 claws, 1d4+3)')[0],
    made('', 'constrict (1d4+3)')[0], made('', 'trample (1d6+4, DC 15)')[0], made('', 'distraction (DC 14)')[0], made('', 'rock throwing (60 ft.)')[0]];
  ok(yes.every((a) => a && a.wording === 'rule'), 'the made-up block, written whole, is rewritten by all seven rules', yes.map((a) => a?.rule || 'none').join(' '));
}

// Every ability no rule wrote, in all 57 fixtures, against the converter as it
// was before abilities.js: [key, name, actions, traits, text], hashed.
const BEFORE = { count: 98, sha: '881993a460f08cd4618962d2515099240302e4435d97f0348bc781d59bb9e0af' };
const keep = [];
let restSame = true;
for (const f of FILES) {
  const o = CREATURES[f];
  for (const [k, list] of [['def', o.defAbilities], ['off', o.offAbilities], ['oth', o.otherAbilities]]) {
    list.forEach((a, i) => { if (a.wording !== 'rule') keep.push([`${f}.txt|${k}|${i}`, a.name, a.actions || '', (a.traits || []).join(','), a.text || '']); });
  }
  if (all(o).concat(o.defAbilities).some((a) => !['rule', 'umr', 'pf1e', 'name', 'number'].includes(a.wording))) restSame = false;
}
ok(keep.length === BEFORE.count && sha(keep) === BEFORE.sha, `the ${BEFORE.count} abilities no rule wrote are byte for byte what the converter gave before the rules`, `${keep.length} abilities, ${sha(keep).slice(0, 12)}`);
ok(restSame, 'every ability says how it is worded: rule, umr, pf1e, name, or number for regeneration and fast healing');
const ruled = FILES.flatMap((f) => all(CREATURES[f]).filter((a) => a.wording === 'rule').map((a) => [f, a]));
ok(ruled.length === 22 && ruled.length === EXPECT.length + 1, 'rules wrote 22 abilities in the fixtures, and all but the third giant\'s Throw Rock are spelled out above', `${ruled.length} written, ${EXPECT.length} above`);

// ---- running a rule on its own output ----------------------------------------
console.log('twice changes nothing more');
const stub = { dc: () => 99, plainDc: 99, strike: () => ({ name: 'claw', dice: '9d9', damage: '9d9 slashing' }), strikeFor: () => null, scale: () => '9d9', tail: (t) => t };
ok(ruled.every(([, a]) => A.rewriteBlock(a.name, a.text, stub) === null && A.rewriteLine(a.name, a.text, stub) === null
  && A.rewriteBlock(a.rule, a.text, stub) === null && A.rewriteLine(a.rule === 'throw-rock' ? 'rock throwing' : a.rule, a.text, stub) === null),
  'no rule reads any rule\'s output: all 22 come back null, under their own name and under their rule\'s');
ok(A.rewriteLine('constrict', '1d4+3', stub)?.text.includes('9d9') && A.rewriteBlock('Poison', 'Bite—injury; save Fort DC 13; frequency 1/round for 6 rounds; effect 1d3 Dex damage; cure 1 save.', stub)?.text.includes('DC 99'),
  'and the stub those calls used does make a rule fire on PF1e text');
ok(FILES.every((f) => sha(convert(f)) === sha(CREATURES[f])), 'converting a stat block twice gives the same creature, all 57');

// ---- the page's copy text and the Foundry export -------------------------------
console.log('copy text and Foundry');
{
  const text = C.toText(CREATURES.medusa);
  ok(text.includes("Poison (poison) A creature damaged by the monster's bite Strike is exposed.") && text.includes('All-Around Vision [PF1e wording] A medusa'),
    'the copied stat block carries the rewritten poison, and marks the ability left in PF1e wording');
  ok(C.toText(CREATURES.gorgon).includes('Trample [three-actions] The monster Strides'), 'a three-action ability copies with its cost');
}
for (const [fx, name, actions] of [['medusa', 'Poison', null], ['medusa', 'Petrifying Gaze', null], ['gorgon', 'Trample', 3], ['troll', 'Rend', 1], ['chuul', 'Constrict', 1], ['dire-rat', 'Filth Fever', null]]) {
  const o = CREATURES[fx], a = find(o, name);
  const item = F.toFoundry(o, { spellIndex: index }).items.find((i) => i.type === 'action' && i.name === name);
  const plain = String(item?.system.description.value || '').replace(/<\/?p>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  ok(item && plain === a.text && item.system.actions.value === actions && item.system.actionType.value === (actions ? 'action' : 'passive'),
    `Foundry: ${fx}'s ${name} carries the rewritten text${actions ? ` and ${actions} action${actions > 1 ? 's' : ''}` : ', passive'}`, item ? plain.slice(0, 70) : 'no such item');
}
{
  const f = F.toFoundry(CREATURES.medusa, { spellIndex: index });
  const notes = f.system.details.privateNotes;
  const kept = notes.match(/<h3>Kept in First Edition wording<\/h3>.*?<ul>(.*?)<\/ul>/s)?.[1] || '';
  ok(kept === '<li>All-Around Vision</li>', 'Foundry: the private notes name the medusa\'s one ability left in PF1e wording, and neither rewritten one', kept);
  ok(f.items.find((i) => i.name === 'Poison')?.system.traits.value.includes('poison') && f.items.find((i) => i.name === 'Petrifying Gaze')?.system.traits.value.includes('visual'),
    'Foundry: the poison and visual traits a rule adds are written as traits');
  ok(!/Kept in First Edition wording/.test(F.toFoundry(CREATURES.wolf, { spellIndex: index }).system.details.privateNotes), 'Foundry: a creature with nothing in PF1e wording has no such note');
}

// ---- the measurement -----------------------------------------------------------
console.log('the table');
{
  const m = await M.measure();
  const have = fs.readFileSync(path.join(PF, 'converter-assets', 'data', 'ability-patterns.md'), 'utf8');
  ok(M.render(m) === have, 'data/ability-patterns.md is what measure-abilities.mjs writes today');
  const n = (w) => m.rows.filter((r) => r.wording === w).length;
  ok(m.rows.length === 111 && n('rule') === 22 && n('umr') === 6 && n('pf1e') === 76 && n('name') === 7,
    '111 abilities: 22 by rule, 6 universal, 76 in PF1e wording, 7 bare names', `${m.rows.length}: ${n('rule')}/${n('umr')}/${n('pf1e')}/${n('name')}`);
}

console.log(`\n${checks} checks, ${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
