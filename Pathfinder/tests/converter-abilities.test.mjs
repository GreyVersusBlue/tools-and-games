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
  // The second increment's rules (HISTORY #899).
  ["homunculus", "Poison", "affliction", "", "poison", 13, "A creature damaged by the monster's bite Strike is exposed. Saving Throw DC 17 Fortitude; Maximum Duration 60 minutes; Stage 1 unconscious (1 minute)."],
  ["ghoul", "Paralysis", "paralysis", "", "incapacitation", 13, "A creature hit by a Strike that lists paralysis must succeed at a DC 17 Fortitude save or be paralyzed for 1d4+1 rounds. Elves are immune to this effect."],
  ["giant-frog", "Pull", "pull", "1", "", null, "Requirements The monster's last action was a successful tongue Strike. Effect The monster pulls the target 5 feet toward itself."],
  ["griffon", "Rake", "rake", "1", "", null, "Requirements The monster has a creature grabbed. Effect The monster makes two claw Strikes against that creature, each at +13 for 3d4+7 slashing damage."],
  ["choker", "Grab", "grab", "", "", null, "Requirements The monster's last action was a success with a Strike that lists Grab in its damage. Effect The monster automatically Grabs the target until the end of its next turn. The creature is grabbed by whichever body part the monster attacked with, and that body part can't be used to Strike until the grab ends. It can Grab a creature of Large size or smaller."],
  ["darkmantle", "Grab", "grab", "", "", null, "Requirements The monster's last action was a success with a Strike that lists Grab in its damage. Effect The monster automatically Grabs the target until the end of its next turn. The creature is grabbed by whichever body part the monster attacked with, and that body part can't be used to Strike until the grab ends. It can Grab a creature of any size."],
  ["lich", "Grave Touch", "limit", "", "", null, "Frequency 9 times per day."],
  ["lich", "Power Over Undead", "limit", "", "", 18, "Frequency 9 times per day. A save against it is DC 29."],
  ["npc-battle-mage", "Hand Of The Apprentice", "limit", "", "", null, "Frequency 6 times per day."],
  ["npc-war-priest", "Channel Negative Energy", "channel", "2", "void", 11, "Frequency 3 times per day. Effect Each living creature within 30 feet takes 1d6-1 void damage (DC 15 basic Will save). The monster can instead restore that many Hit Points to each undead creature there."],
  ["npc-war-priest-wrapped", "Channel Negative Energy", "channel", "2", "void", 11, "Frequency 3 times per day. Effect Each living creature within 30 feet takes 1d6-1 void damage (DC 15 basic Will save). The monster can instead restore that many Hit Points to each undead creature there."],
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
  // Rake's attack is rescaled like a Strike's: PF1e writes +7 for the griffon's
  // talons and for its rake, so the two must land on the same bonus.
  const g = CREATURES.griffon, rk = find(g, 'Rake'), talon = g.strikes.find((s) => s.name === 'talon');
  ok(talon && rk.numbers?.attack === talon.bonus && rk.numbers.attack !== 7 && rk.text.includes(`each at +${talon.bonus} for `),
    `griffon: Rake attacks at +${talon?.bonus}, what its talon Strike (PF1e +7, like the rake) came to`, `rake +${rk.numbers?.attack}`);
  const avg = (d) => { const m = String(d).match(/(\d+)d(\d+)([+-]\d+)?/); return m ? Number(m[1]) * (Number(m[2]) + 1) / 2 + Number(m[3] || 0) : NaN; };
  const gTop = C.readRow(T.PF2_STRIKE_DAMAGE[g.level.value], T.TIERS.extreme);
  ok(rk.numbers?.damage && rk.text.includes(`for ${rk.numbers.damage} slashing`) && !rk.text.includes('1d4+3') && avg(rk.numbers.damage) > 5.5 && avg(rk.numbers.damage) <= gTop + 0.5,
    'griffon: Rake\'s dice are scaled as Strike damage was, more than PF1e\'s 1d4+3 and no more than extreme', `${rk.numbers?.damage} (avg ${avg(rk.numbers?.damage)}), extreme ${gTop}`);
  // Pull names a Strike, and the frog has it.
  ok(CREATURES['giant-frog'].strikes.some((s) => s.name === 'tongue') && find(CREATURES['giant-frog'], 'Pull').text.includes('a successful tongue Strike'),
    'giant frog: Pull names the tongue, a Strike the frog has', CREATURES['giant-frog'].strikes.map((s) => s.name).join(', '));
  // Channel: the dice are the converter's, the DC moves with the level, and
  // the uses in the name are the Frequency.
  const wp = find(CREATURES['npc-war-priest'], 'Channel Negative Energy'), wp5 = find(convert('npc-war-priest', { level: 5 }), 'Channel Negative Energy');
  ok(wp.numbers?.damage && wp.numbers.damage !== '1d6' && wp.text.includes(`takes ${wp.numbers.damage} void damage`) && wp5.numbers?.dc > wp.numbers.dc && wp5.numbers.damage !== wp.numbers.damage
    && !all(CREATURES['npc-war-priest']).some((a) => /3\/Day/i.test(a.name)),
    'war priest: Channel Negative Energy writes scaled dice, not PF1e\'s 1d6, and both move with the level; "3/day" left the name', `${wp.numbers?.damage} DC ${wp.numbers?.dc}; at 5: ${wp5.numbers?.damage} DC ${wp5.numbers?.dc}`);
  // A limit with no DC writes no figure but the count PF1e gave.
  const gt = find(CREATURES.lich, 'Grave Touch'), pu = find(CREATURES.lich, 'Power Over Undead');
  ok(Object.keys(gt.numbers || { x: 1 }).length === 0 && !/DC/.test(gt.text) && pu.numbers?.dc === tierDc(CREATURES.lich, parsePf1(raw('lich')).cr, 18),
    'lich: Grave Touch (9/day) writes the limit and no DC; Power Over Undead (9/day, DC 18) writes the table\'s', `${gt.text} | ${pu.text}`);
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
  ['iron-golem', 'Breath Weapon', null, 'an inhaled poison written inside a paragraph'],
  ['gorgon', 'Breath Weapon', null, 'a breath weapon that deals no dice'],
  ['gelatinous-cube', 'Paralysis', 'A gelatinous cube secretes an anesthetizing slime. A target hit by a cube\'s melee or engulf attack must succeed on a DC 23 Fortitude or be paralyzed for 3d6 rounds. The cube can automatically engulf a paralyzed opponent. The save DC is Constitution-based.', 'a save in a sentence'],
  ['djinni', 'Whirlwind', 'PF1e: 1/10 minutes, 10-50 ft. tall, 1d8+4 damage, DC 24.', 'a limit that is not per day, with three more figures'],
  ['npc-war-priest', 'Destructive Smite', 'PF1e: +1, 6/day.', 'a per-day limit after a bonus'],
  ['vampire', 'Drain Life', null, 'energy drain (2 levels, DC 22)'],
  ['crocodile', 'Sprint', 'Once per minute a crocodile may sprint, increasing its land speed to 40 feet for 1 round.', 'a limit in a sentence'],
  ['chuul', 'Paralytic Tentacles', null, 'a save or a condition, in the middle of a paragraph'],
  ['gibbering-mouther', 'Gibbering', null, 'the same, with a free action before it'],
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
  ['a poison whose effect is a condition no rule knows', made('Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect dazed for 1 round; cure 1 save.')[0]],
  ['a poison whose sleep has no length a rule can read', made('Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect sleep for a while; cure 1 save.')[0]],
  ['a paralysis with no DC', made('', 'paralysis (1d4 rounds)')[0]],
  ['a paralysis whose first figure is not a duration', made('', 'paralysis (permanent, DC 15)')[0]],
  ['a paralysis whose third clause holds a figure', made('', 'paralysis (1d4 rounds, DC 15, 3 targets)')[0]],
  ['a pull naming a Strike the creature lacks', made('', 'pull (tongue, 5 feet)')[0]],
  ['a pull with no distance', made('', 'pull (claw)')[0]],
  ['a rake with no attack bonus', made('', 'rake (2 claws, 1d4+3)')[0]],
  ['a rake that is not claws or talons', made('', 'rake (2 bites +7, 1d4+3)')[0]],
  ['a grab whose parenthesis is not a size', made('', 'grab (tentacles)')[0]],
  ['a per-day limit with a figure after the DC', made('', 'stunning fist (3/day, DC 15, 1 round)')[0]],
  ['a per-day limit after a bonus', made('', 'smite (+1, 6/day)')[0]],
  ['a per-day limit on a universal ability, which keeps its own text', made('', 'pounce (1/day)')[0]],
  ['a limit that is not per day', made('', 'lay on hands (at will)')[0]],
  // Two lines hold this one: the pattern wants the dice, and a scale of
  // nothing is nothing. It fails only with both gone (broken that way once).
  ['a channel with no dice', made('', 'channel negative energy 3/day (DC 15)')[0]],
  ['a channel with no limit in its name', made('', 'channel positive energy (DC 15, 1d6)')[0]],
  ['a channel whose dice are not d6', made('', 'channel negative energy 1/day (DC 15, 2d8)')[0]],
];
for (const [what, a] of NOT) ok(a && a.wording !== 'rule' && !a.rule && !a.numbers, `not rewritten: ${what}`, a ? `${a.name}: ${a.text.slice(0, 80)}` : 'the block made no ability');
{
  // And the same blocks, one step back, are rewritten: the block above is a
  // stat block the parser reads, not one every rule ignores.
  const yes = [made('Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect 1d2 Str; cure 1 save.')[0],
    made('Gaze (Su) Turn to stone permanently, 30 feet, Fortitude DC 15 negates.')[0], made('', 'rend (2 claws, 1d4+3)')[0],
    made('', 'constrict (1d4+3)')[0], made('', 'trample (1d6+4, DC 15)')[0], made('', 'distraction (DC 14)')[0], made('', 'rock throwing (60 ft.)')[0]];
  ok(yes.every((a) => a && a.wording === 'rule'), 'the made-up block, written whole, is rewritten by all seven rules', yes.map((a) => a?.rule || 'none').join(' '));
  // The second increment's rules on the same block, to the letter. Test Beast
  // is level 4: its claw Strike is +11, and DC 15 at CR 4 comes to DC 21.
  const P = (e) => made(`Poison (Ex) Bite—injury; save Fort DC 15; frequency 1/round for 4 rounds; effect ${e}; cure 1 save.`)[0];
  const stage = (a) => a?.text.match(/Stage 1 (.*)\.$/)?.[1];
  const MADE = [
    ['paralysis (1d4 rounds, DC 15)', 'paralysis', 'A creature hit by a Strike that lists paralysis must succeed at a DC 21 Fortitude save or be paralyzed for 1d4 rounds.'],
    ['paralysis (2 minutes, DC 15, only the living)', 'paralysis', 'A creature hit by a Strike that lists paralysis must succeed at a DC 21 Fortitude save or be paralyzed for 2 minutes. Only the living.'],
    ['pull (claw, 10 ft.)', 'pull', "Requirements The monster's last action was a successful claw Strike. Effect The monster pulls the target 10 feet toward itself."],
    ['push (bite, 10 feet)', 'pull', "Requirements The monster's last action was a successful bite Strike. Effect The monster pushes the target 10 feet away from itself."],
    ['rake (2 claws +5, 1d4+3)', 'rake', 'Requirements The monster has a creature grabbed. Effect The monster makes two claw Strikes against that creature, each at +11 for 3d4+6 slashing damage.'],
    ['rake (4 talons +9, 1d6+2)', 'rake', 'Requirements The monster has a creature grabbed. Effect The monster makes four talon Strikes against that creature, each at +15 for 2d6+6 slashing damage.'],
    ['bardic music (1/day)', 'limit', 'Frequency once per day.'],
    ['wild shape (2/day)', 'limit', 'Frequency twice per day.'],
    ['quivering palm (1/day, DC 16)', 'limit', 'Frequency once per day. A save against it is DC 22.'],
    ['channel positive energy 5/day (DC 15, 3d6)', 'channel', 'Frequency 5 times per day. Effect Each undead creature within 30 feet takes 3d6+8 vitality damage (DC 21 basic Will save). The monster can instead restore that many Hit Points to each living creature there.'],
  ];
  for (const [sa, rule, text] of MADE) {
    const a = made('', sa)[0];
    ok(a && a.rule === rule && a.text === text, `made up: ${sa} reads as written here`, a ? `${a.rule || a.wording}: ${a.text}` : 'no ability');
  }
  // The rake's two claws are the block's own claw Strike: same bonus, same dice.
  // This reads the Strike, not the rule: it holds the row above to the creature.
  const tb = convertText(block('', 'rake (2 claws +5, 1d4+3)')), claw = tb.strikes.find((x) => x.name === 'claw');
  ok(claw && claw.bonus === 11 && claw.damage === '3d4+6 slashing', 'made up: Test Beast\'s own claw Strike is +11 for 3d4+6, the figures the rake row above wrote', claw ? `claw +${claw.bonus} ${claw.damage}` : 'no claw');
  ok(made('', 'grab (Colossal)')[0]?.text.endsWith(' It can Grab a creature of Gargantuan size or smaller.') && made('', 'grab (Huge)')[0]?.text.endsWith(' It can Grab a creature of Huge size or smaller.'),
    'made up: grab (Huge) keeps its size, and Colossal is written Gargantuan');
  // A poison's condition: its own duration is written only when it is not the
  // stage's interval, and conditions join ability damage in either order.
  const STAGES = [['sleep for 1 round', 'unconscious (1 round)'], ['sleep for 1 minute', 'unconscious for 1 minute (1 round)'], ['paralysis for 1d4 rounds', 'paralyzed for 1d4 rounds (1 round)'],
    ['unconsciousness for 1d3 hours', 'unconscious for 1d3 hours (1 round)'], ['1d2 Dex damage and nauseated', 'clumsy 1 and sickened 1 (1 round)'], ['sickened for 1 round and 1d2 Str', 'sickened 1 and enfeebled 1 (1 round)']];
  for (const [e, want] of STAGES) ok(P(e)?.rule === 'affliction' && stage(P(e)) === want, `made up: a poison's "effect ${e}" is Stage 1 ${want}`, P(e)?.text.slice(-70));
  // Grab adds one sentence to the text a bare Grab gets, and changes none of it.
  const bare = find(convertText(block('', 'grab')), 'Grab');
  ok(bare.wording === 'umr' && bare.text.length > 50 && find(CREATURES.choker, 'Grab').text === `${bare.text} It can Grab a creature of Large size or smaller.`,
    'choker: Grab (Large) is the bare Grab text and one sentence more', bare.text.slice(0, 60));
}

// Every ability no rule wrote, in all 57 fixtures, against the converter as it
// was before abilities.js: [key, name, actions, traits, text], hashed. The
// hash is still the one taken then, over 98 abilities. The second increment's
// rules took the eleven below (HISTORY #899); written back in as they stood,
// in their old places, the list must still come to that hash, so the 87 left
// are held to the same bytes as before and so is the claim about these eleven.
const BEFORE = { count: 98, sha: '881993a460f08cd4618962d2515099240302e4435d97f0348bc781d59bb9e0af' };
const TAKEN = [
  ["choker.txt|off|2", "Grab", "", "", "Requirements The monster's last action was a success with a Strike that lists Grab in its damage. Effect The monster automatically Grabs the target until the end of its next turn. The creature is grabbed by whichever body part the monster attacked with, and that body part can't be used to Strike until the grab ends. PF1e: Large."],
  ["darkmantle.txt|off|1", "Grab", "", "", "Requirements The monster's last action was a success with a Strike that lists Grab in its damage. Effect The monster automatically Grabs the target until the end of its next turn. The creature is grabbed by whichever body part the monster attacked with, and that body part can't be used to Strike until the grab ends. PF1e: any size."],
  ["ghoul.txt|off|0", "Paralysis", "", "", "PF1e: 1d4+1 rounds, DC 17, elves are immune to this effect."],
  ["giant-frog.txt|off|0", "Pull", "", "", "PF1e: tongue, 5 feet."],
  ["griffon.txt|off|1", "Rake", "", "", "PF1e: 2 claws +7, 1d4+3."],
  ["homunculus.txt|oth|0", "Poison", "", "", "Bite—injury; save Fort DC 17; frequency 1/minute for 60 minutes; effect sleep for 1 minute; cure 1 save. The save DC is Constitution-based and includes a +2 racial bonus."],
  ["lich.txt|off|1", "Grave Touch", "", "", "PF1e: 9/day."],
  ["lich.txt|off|3", "Power Over Undead", "", "", "PF1e: 9/day, DC 29."],
  ["npc-battle-mage.txt|off|0", "Hand Of The Apprentice", "", "", "PF1e: 6/day."],
  ["npc-war-priest-wrapped.txt|off|1", "Channel Negative Energy 3/Day", "", "", "PF1e: DC 15, 1d6."],
  ["npc-war-priest.txt|off|1", "Channel Negative Energy 3/Day", "", "", "PF1e: DC 15, 1d6."],
];
const kept = [];
let restSame = true;
for (const f of FILES) {
  const o = CREATURES[f];
  for (const [k, list] of [['def', o.defAbilities], ['off', o.offAbilities], ['oth', o.otherAbilities]]) {
    list.forEach((a, i) => {
      const key = `${f}.txt|${k}|${i}`;
      const was = TAKEN.find((t) => t[0] === key);
      if (a.wording !== 'rule') kept.push([key, a.name, a.actions || '', (a.traits || []).join(','), a.text || '']);
      else if (was) kept.push(was);
    });
  }
  if (all(o).concat(o.defAbilities).some((a) => !['rule', 'umr', 'pf1e', 'name', 'number'].includes(a.wording))) restSame = false;
}
const keep = kept.filter((r) => !TAKEN.includes(r));
ok(kept.length === BEFORE.count && sha(kept) === BEFORE.sha && keep.length === BEFORE.count - TAKEN.length,
  `the ${BEFORE.count - TAKEN.length} abilities no rule wrote are byte for byte what the converter gave before the rules, and the ${TAKEN.length} taken since are the ones named`, `${keep.length} left, ${kept.length} with the taken, ${sha(kept).slice(0, 12)}`);
ok(TAKEN.every(([key]) => { const [f, k, i] = key.split('|'); const o = CREATURES[f.replace(/\.txt$/, '')]; return ({ def: o.defAbilities, off: o.offAbilities, oth: o.otherAbilities })[k][Number(i)]?.wording === 'rule'; }),
  'each of the eleven taken is a rule\'s now, in the place it had');
ok(restSame, 'every ability says how it is worded: rule, umr, pf1e, name, or number for regeneration and fast healing');
const ruled = FILES.flatMap((f) => all(CREATURES[f]).filter((a) => a.wording === 'rule').map((a) => [f, a]));
ok(ruled.length === 33 && ruled.length === EXPECT.length + 1, 'rules wrote 33 abilities in the fixtures, and all but the third giant\'s Throw Rock are spelled out above', `${ruled.length} written, ${EXPECT.length} above`);

// ---- running a rule on its own output ----------------------------------------
console.log('twice changes nothing more');
const stub = { dc: () => 99, plainDc: 99, strike: () => ({ name: 'claw', dice: '9d9', damage: '9d9 slashing' }), strikeFor: () => null, scale: () => '9d9', attack: () => 99, umr: (n) => (n === 'grab' ? 'Grab.' : ''), tail: (t) => t };
ok(ruled.every(([, a]) => A.rewriteBlock(a.name, a.text, stub) === null && A.rewriteLine(a.name, a.text, stub) === null
  && A.rewriteBlock(a.rule, a.text, stub) === null && A.rewriteLine(a.rule === 'throw-rock' ? 'rock throwing' : a.rule, a.text, stub) === null
  && A.rewriteLine('push', a.text, stub) === null && A.rewriteLine('channel negative energy 3/day', a.text, stub) === null && A.rewriteLine('grave touch', a.text, stub) === null),
  'no rule reads any rule\'s output: all 33 come back null, under their own name, their rule\'s, and the names the limit and channel rules answer to');
ok(A.rewriteLine('rake', '2 claws +7, 1d4+3', stub)?.text.includes('+99 for 9d9') && A.rewriteLine('grave touch', '9/day, DC 18', stub)?.text.includes('DC 99') && A.rewriteLine('grab', 'Large', stub)?.text.startsWith('Grab. ')
  && A.rewriteLine('paralysis', '1d4 rounds, DC 13', stub)?.text.includes('DC 99') && A.rewriteLine('pull', 'claw, 5 feet', stub)?.text.includes('claw Strike') && A.rewriteLine('channel negative energy 3/day', 'DC 11, 1d6', stub)?.text.includes('9d9 void'),
  'and that stub makes each of the six new rules fire on PF1e text');
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
  const lich = C.toText(CREATURES.lich);
  ok(lich.includes('Grave Touch Frequency 9 times per day.') && !lich.includes('Grave Touch [PF1e wording]') && lich.includes('Paralyzing Touch [PF1e wording] PF1e: DC 29.'),
    'the copied lich carries Grave Touch\'s Frequency unmarked, and still marks Paralyzing Touch', lich.split('\n').filter((l) => /Touch/.test(l)).join(' / ').slice(0, 160));
}
for (const [fx, name, actions] of [['medusa', 'Poison', null], ['medusa', 'Petrifying Gaze', null], ['gorgon', 'Trample', 3], ['troll', 'Rend', 1], ['chuul', 'Constrict', 1], ['dire-rat', 'Filth Fever', null],
  ['griffon', 'Rake', 1], ['ghoul', 'Paralysis', null], ['giant-frog', 'Pull', 1], ['npc-war-priest', 'Channel Negative Energy', 2], ['lich', 'Grave Touch', null], ['choker', 'Grab', null], ['homunculus', 'Poison', null]]) {
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
  const item = (fx, name) => F.toFoundry(CREATURES[fx], { spellIndex: index }).items.find((i) => i.name === name);
  ok(item('ghoul', 'Paralysis')?.system.traits.value.includes('incapacitation') && item('npc-war-priest', 'Channel Negative Energy')?.system.traits.value.includes('void'),
    'Foundry: the incapacitation and void traits the new rules add are written as traits');
  const lichKept = F.toFoundry(CREATURES.lich, { spellIndex: index }).system.details.privateNotes.match(/<h3>Kept in First Edition wording<\/h3>.*?<ul>(.*?)<\/ul>/s)?.[1] || '';
  ok(lichKept.includes('<li>Paralyzing Touch</li>') && !lichKept.includes('Grave Touch') && !lichKept.includes('Power Over Undead'),
    'Foundry: the lich\'s notes still name Paralyzing Touch as PF1e wording, and no longer its two limits', lichKept);
  ok(!/Kept in First Edition wording/.test(F.toFoundry(CREATURES.wolf, { spellIndex: index }).system.details.privateNotes), 'Foundry: a creature with nothing in PF1e wording has no such note');
}

// ---- the measurement -----------------------------------------------------------
console.log('the table');
{
  const m = await M.measure();
  const have = fs.readFileSync(path.join(PF, 'converter-assets', 'data', 'ability-patterns.md'), 'utf8');
  ok(M.render(m) === have, 'data/ability-patterns.md is what measure-abilities.mjs writes today');
  const n = (w) => m.rows.filter((r) => r.wording === w).length;
  ok(m.rows.length === 111 && n('rule') === 33 && n('umr') === 6 && n('pf1e') === 65 && n('name') === 7,
    '111 abilities: 33 by rule, 6 universal, 65 in PF1e wording, 7 bare names', `${m.rows.length}: ${n('rule')}/${n('umr')}/${n('pf1e')}/${n('name')}`);
}

console.log(`\n${checks} checks, ${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
