// converter-parse.test.mjs: parse-pf1.js against every PF1e fixture, the
// single-section snippets the converter form re-parses, and the
// formatPf1Section round-trip the form depends on.
//
//   node Pathfinder/tests/converter-parse.test.mjs      (from the repo root)
//
// Exits non-zero on any failure.
//
// WHY. The converter's form lets a user fix one section of a parsed stat block
// and re-parses only that section, so the parser has to work on a lone
// "Melee ..." line as well as a whole paste, and formatPf1Section has to hand
// back text that parses to the same data. The expected values below were read
// off the fixture text by hand (tests/fixtures/pf1/*.txt, copied from Archives
// of Nethys 1e and d20pfsrd), not produced by the parser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'pf1');
const { parsePf1, parseDiceAvg, formatPf1Section, SECTION_LABELS } =
  await import(pathToFileURL(path.join(HERE, '..', 'converter-assets', 'js', 'parse-pf1.js')).href);

let checks = 0, failures = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
const J = (x) => JSON.stringify(x);
const eq = (got, want, label) => ok(J(got) === J(want), label, `got ${J(got)}, want ${J(want)}`);
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const strip = (c) => { const x = structuredClone(c); delete x.raw; return x; };

// ---------------------------------------------------------------- fixtures
// abil: Str Dex Con Int Wis Cha, null for "—". melee0: [count, first bonus,
// damage] of the first melee attack; nMelee: how many attack entries.
// spells: "level:name" samples from the first spellcasting block.
const FIXTURES = {
  'army-ant-swarm.txt': {
    cr: 5, hp: 49, hd: '11d8', ac: [20, 20, 18], saves: [7, 5, 3], abil: [1, 15, 10, null, 10, 2],
    melee0: [1, undefined, '3d6'], nMelee: 1, speed: { land: 30, climb: 30 },
    immune: ['weapon damage'], sa: ['Cling', 'Consume'], cmb: null,
  },
  'balor.txt': {
    cr: 20, hp: 370, hd: '20d10+260', ac: [36, 20, 29], saves: [29, 17, 25], abil: [35, 25, 36, 24, 24, 27],
    melee0: [1, 31, '2d6+13'], nMelee: 3, iter0: [31, 26, 21, 16], groups: [0, 0, 1],
    speed: { land: 40, fly: 90, flyManeuver: 'good' }, dr: [{ amount: 15, bypass: 'cold iron and good' }], sr: 31,
    resist: [['acid', 10], ['cold', 10]], sla: ['constant', 'at will', '3/day', '1/day'], slaSample: 'dominate monster',
    reach: [10, '20 ft. with whip'], summon: 'level 9, any 1 CR 19 or lower demon 100%', aura: ['flaming body', 'unholy aura'],
    sa: ['Death Throes', 'Entangle', 'Flaming Body', 'Vorpal Strike', 'Whip Mastery'], languageSpecial: ['telepathy 100 ft.'],
  },
  'bat-swarm.txt': {
    cr: 2, hp: 13, hd: '3d8', ac: [16, 16, 14], saves: [3, 7, 3], abil: [3, 15, 11, 2, 14, 4],
    melee0: [1, undefined, '1d6'], nMelee: 1, speed: { land: 5, fly: 40, flyManeuver: 'good' },
    space: [10, 0], sa: ['Wounding'],
  },
  'd20pfsrd-owlbear.txt': {
    cr: 4, hp: 47, hd: '5d10+20', ac: [15, 10, 14], saves: [10, 5, 2], abil: [19, 12, 18, 2, 12, 10],
    melee0: [2, 8, '1d6+4'], extra0: 'grab', nMelee: 2, speed: { land: 30 }, space: [10, 5], sa: [],
  },
  'erinyes.txt': {
    cr: 8, hp: 94, hd: '9d10+45', ac: [23, 17, 16], saves: [11, 12, 7], abil: [20, 23, 21, 14, 18, 21],
    melee0: [1, 15, '1d8+8'], crit0: '19-20', nMelee: 1, speed: { land: 30, fly: 50 },
    dr: [{ amount: 5, bypass: 'good' }], sr: 19, sla: ['constant', 'at will', '1/day'], slaSample: 'unholy blight',
    ranged: [['+1 flaming composite longbow', [14, 14, 9], 'x3', false, 0], ['rope', [15], '', true, 1]],
    feats: ['Dodge', 'Mobility'], sa: ['Entangle'],
  },
  'gelatinous-cube.txt': {
    cr: 3, hp: 50, hd: '4d8+32', ac: [4, 4, 4], saves: [9, -4, -4], abil: [10, 1, 26, null, 1, 1],
    melee0: [1, 2, '1d6'], extra0: '1d6 acid', nMelee: 1, speed: { land: 15 }, init: -5,
    sa: ['Acid', 'Engulf', 'Paralysis', 'Transparent'], saDc: { Paralysis: 20, Engulf: 12 },
  },
  'goblin.txt': {
    cr: 1 / 3, hp: 6, hd: '1d10+1', ac: [16, 13, 14], saves: [3, 2, -1], abil: [11, 15, 12, 10, 9, 6],
    melee0: [1, 2, '1d4'], crit0: '19-20', nMelee: 1, speed: { land: 30 }, classLine: 'Goblin warrior 1',
    ranged: [['short bow', [4], 'x3', false, 0]], sa: [],
  },
  'iron-golem.txt': {
    cr: 13, hp: 129, hd: '18d10+30', ac: [28, 8, 28], saves: [6, 5, 6], abil: [32, 9, null, null, 11, 1],
    melee0: [2, 28, '2d10+16'], crit0: '19-20', nMelee: 1, speed: { land: 20 },
    dr: [{ amount: 15, bypass: 'adamantine' }], sa: ['Breath Weapon', 'Immunity to Magic', 'Powerful Blows'],
    saDc: { 'Breath Weapon': 19 },
  },
  'lich.txt': {
    cr: 12, hp: 111, hd: '11d6+55', hpNotes: '15 false life', ac: [23, 14, 21], saves: [6, 7, 11], abil: [10, 14, null, 22, 14, 16],
    melee0: [1, 5, '1d8+5'], nMelee: 1, speed: { land: 30 }, dr: [{ amount: 15, bypass: 'bludgeoning and magic' }],
    caster: ['prepared', '', 11], levels: [6, 5, 4, 3, 2, 1, 0],
    spells: ['6:circle of death', '4:wall of ice', '2:false life', '0:bleed'], counts: { 'wall of ice': 2, 'magic missile': 3 },
    opposition: ['illusion', 'transmutation'], aura: ['fear'], sa: [],
  },
  'npc-battle-mage.txt': {
    cr: 2, hp: 19, hd: '3d6+6', ac: [16, 12, 14], saves: [2, 3, 3], saveNotes: '+2 vs. enchantments', abil: [12, 15, 12, 17, 10, 8],
    melee0: [1, 3, '1d6'], crit0: '18-20', nMelee: 1, speed: { land: 30 },
    caster: ['prepared', 'Wizard', 3], levels: [2, 1, 0], spells: ['2:mirror image', '1:shocking grasp', '0:daze'],
    tactics: /^Before Combat/, gearOther: '113 gp', sa: [],
  },
  'npc-storm-sorcerer.txt': {
    cr: 5, hp: 35, hd: '6d6+12', ac: [18, 14, 15], saves: [4, 5, 7], abil: [8, 15, 12, 12, 12, 16],
    melee0: [1, 2, '1d8-1'], crit0: 'x3', nMelee: 1, speed: { land: 30 }, sla: ['6/day'], slaSample: 'elemental ray',
    caster: ['known', 'Sorcerer', 6], levels: [3, 2, 1, 0], perDay: [4, 6, 7, 'at will'],
    spells: ['3:lightning bolt', '1:burning hands', '0:acid splash'], bloodline: 'elemental (air)',
    resist: [['electricity', 10]], sa: [],
  },
  'npc-war-priest.txt': {
    cr: 1, hp: 21, hd: '2d8+9', ac: [15, 10, 15], acNotes: '+4 dodge vs. giants', saves: [5, 0, 6], abil: [15, 10, 15, 8, 16, 10],
    melee0: [1, 4, '2d6+4'], crit0: '19-20', nMelee: 1, speed: { land: 20 }, sla: ['6/day'], slaSample: 'touch of chaos',
    caster: ['prepared', 'Cleric', 2], levels: [1, 0], spells: ['1:true strike', '0:bleed'], domainSpell: 'true strike',
    domains: ['Chaos', 'Destruction'], cmdNotes: '17 vs. bull rush or trip', gearOther: '94 gp', sa: [],
  },
  'ogre.txt': {
    cr: 3, hp: 30, hd: '4d8+12', ac: [17, 8, 17], saves: [6, 0, 3], abil: [21, 8, 15, 6, 10, 7],
    melee0: [1, 7, '2d8+7'], nMelee: 1, speed: { land: 30, notes: '40 ft. base' }, sa: [],
  },
  'owlbear.txt': {
    cr: 4, hp: 47, hd: '5d10+20', ac: [15, 10, 14], saves: [10, 5, 2], abil: [19, 12, 18, 2, 12, 10],
    melee0: [2, 8, '1d6+4'], extra0: 'grab', nMelee: 2, speed: { land: 30 }, cmbNotes: '+14 grapple', sa: [],
  },
  'succubus.txt': {
    cr: 7, hp: 84, hd: '8d10+40', ac: [20, 13, 17], saves: [7, 9, 10], abil: [13, 17, 20, 18, 14, 27],
    melee0: [2, 11, '1d6+1'], nMelee: 1, speed: { land: 30, fly: 50, flyManeuver: 'average' },
    dr: [{ amount: 10, bypass: 'cold iron or good' }], sr: 18, sla: ['constant', 'at will', '1/day'], slaSample: 'charm monster',
    languageSpecial: ['tongues', 'telepathy 100 ft.'], sa: ['Energy Drain', 'Profane Gift'],
  },
  'troll.txt': {
    cr: 5, hp: 63, hd: '6d8+36', ac: [16, 11, 14], saves: [11, 4, 3], abil: [21, 14, 23, 6, 9, 6],
    melee0: [1, 8, '1d8+5'], nMelee: 2, speed: { land: 30 }, other: ['regeneration 5 (acid or fire)'], sa: [],
  },
  'vampire.txt': {
    cr: 9, hp: 102, hd: '8d6+72', ac: [23, 17, 18], saves: [13, 11, 12], abil: [16, 18, null, 14, 16, 26],
    melee0: [1, 8, '1d4+4'], extra0: 'energy drain', nMelee: 1, speed: { land: 30 },
    dr: [{ amount: 10, bypass: 'magic and silver' }], weaknesses: ['vampire weaknesses'], sla: ['11/day'], slaSample: 'grave touch',
    caster: ['known', 'Sorcerer', 8], levels: [4, 3, 2, 1, 0], perDay: [5, 5, 8, 8, null],
    spells: ['4:greater invisibility', '3:fireball', '0:open/close'], bloodline: 'undead',
    other: ['fast healing 5', 'channel resistance +4'], sa: [],
  },
  'wolf.txt': {
    cr: 1, hp: 13, hd: '2d8+4', ac: [14, 12, 12], saves: [5, 5, 1], abil: [13, 15, 15, 2, 12, 6],
    melee0: [1, 2, '1d6+1'], extra0: 'trip', nMelee: 1, speed: { land: 50 }, skillNote: ['Survival', '+5 scent tracking'], sa: [],
  },
  'young-red-dragon.txt': {
    cr: 10, hp: 115, hd: '11d12+44', ac: [22, 10, 21], saves: [11, 8, 10], abil: [25, 12, 19, 12, 13, 12],
    melee0: [1, 17, '2d6+10'], nMelee: 4, speed: { land: 40, fly: 200, flyManeuver: 'poor' }, ageCategory: 'young',
    reach: [5, '10 ft. with bite'], weaknesses: ['vulnerability to cold'], sla: ['at will'], slaSample: 'detect magic',
    caster: ['known', '', 1], levels: [1, 0], perDay: [3, 'at will'], spells: ['1:true strike', '0:prestidigitation'], sa: [],
  },
};
// The variants the task names: same stat block, different whitespace.
const VARIANTS = { 'balor-collapsed.txt': 'balor.txt', 'npc-war-priest-wrapped.txt': 'npc-war-priest.txt' };

const onDisk = fs.readdirSync(FIX).filter((f) => f.endsWith('.txt')).sort();
console.log('\nfixture coverage');
const covered = new Set([...Object.keys(FIXTURES), ...Object.keys(VARIANTS)]);
ok(onDisk.every((f) => covered.has(f)), `every fixture on disk has hand-checked values (${onDisk.length})`,
  `unchecked: ${onDisk.filter((f) => !covered.has(f)).join(', ')}`);

const parsed = {};
for (const [file, x] of Object.entries(FIXTURES)) {
  console.log(`\n${file}`);
  const c = parsed[file] = parsePf1(read(file));
  const n = file.replace(/\.txt$/, '');
  eq(c.cr, x.cr, `${n}: CR`);
  eq([c.hp.total, c.hp.hd], [x.hp, x.hd], `${n}: hp ${x.hp} (${x.hd})`);
  eq([c.ac.total, c.ac.touch, c.ac.flatFooted], x.ac, `${n}: AC ${x.ac.join('/')}`);
  eq([c.saves.fort, c.saves.ref, c.saves.will], x.saves, `${n}: saves ${x.saves.join('/')}`);
  eq(Object.values(c.abilities), x.abil, `${n}: ability scores`);
  const m0 = c.melee[0] || {};
  eq([m0.count, m0.bonus?.[0], m0.damage], x.melee0, `${n}: first melee attack count/bonus/damage`);
  eq(c.melee.length, x.nMelee, `${n}: ${x.nMelee} melee attack entries`);
  if (x.iter0) eq(m0.bonus, x.iter0, `${n}: iterative attacks on the first melee entry`);
  if (x.groups) eq(c.melee.map((a) => a.group), x.groups, `${n}: "or" splits melee into groups`);
  if (x.crit0 !== undefined) eq(m0.crit, x.crit0, `${n}: first melee crit`);
  if (x.extra0 !== undefined) eq(m0.extra, x.extra0, `${n}: first melee rider ("plus" stripped)`);
  for (const [k, v] of Object.entries(x.speed)) eq(c.speed[k], v, `${n}: speed ${k}`);
  eq(c.defensive.dr, x.dr || [], `${n}: DR`);
  eq(c.defensive.sr, x.sr ?? null, `${n}: SR`);
  if (x.resist) eq(c.defensive.resist.map((r) => [r.type, r.amount]), x.resist, `${n}: resistances`);
  if (x.immune) eq(c.defensive.immune, x.immune, `${n}: immunities`);
  if (x.weaknesses) eq(c.defensive.weaknesses, x.weaknesses, `${n}: weaknesses`);
  if (x.other) eq(c.defensive.other, x.other, `${n}: other defenses`);
  eq(c.spellLikeAbilities.flatMap((b) => b.entries.map((e) => e.freq)), x.sla || [], `${n}: SLA frequencies`);
  if (x.summon) eq(c.spellLikeAbilities[0].entries.at(-1).spells.find((s) => s.name === 'summon')?.note, x.summon, `${n}: summon note kept whole, separators and all`);
  if (x.slaSample) ok(c.spellLikeAbilities.some((b) => b.entries.some((e) => e.spells.some((s) => s.name === x.slaSample))),
    `${n}: SLA list includes ${x.slaSample}`);
  eq(c.specialAbilities.map((a) => a.name), x.sa, `${n}: special ability names`);
  for (const [name, dc] of Object.entries(x.saDc || {})) eq(c.specialAbilities.find((a) => a.name === name)?.dc, dc, `${n}: ${name} DC`);
  if (x.caster) {
    const b = c.spellcasting[0] || {};
    eq([b.kind, b.className, b.cl], x.caster, `${n}: spell block kind/class/CL`);
    eq((b.levels || []).map((l) => l.level), x.levels, `${n}: spell levels`);
    if (x.perDay) eq(b.levels.map((l) => l.perDay), x.perDay, `${n}: spells per day`);
    for (const s of x.spells) {
      const [lv, name] = s.split(':');
      ok(b.levels.find((l) => l.level === Number(lv))?.spells.some((sp) => sp.name === name), `${n}: level ${lv} has ${name}`);
    }
    for (const [name, cnt] of Object.entries(x.counts || {})) {
      eq(b.levels.flatMap((l) => l.spells).find((sp) => sp.name === name)?.count, cnt, `${n}: ${name} prepared ${cnt} times`);
    }
    if (x.domainSpell) eq(b.levels.flatMap((l) => l.spells).find((sp) => sp.name === x.domainSpell)?.domain, true, `${n}: ${x.domainSpell} marked as a domain spell`);
    if (x.domains) eq(b.domains, x.domains, `${n}: domains trailer`);
    if (x.opposition) eq(b.opposition, x.opposition, `${n}: opposition schools trailer`);
    if (x.bloodline) eq(b.bloodline, x.bloodline, `${n}: bloodline trailer`);
  } else {
    eq(c.spellcasting.length, 0, `${n}: no spell blocks`);
  }
  if (x.ranged) eq(c.ranged.map((a) => [a.name, a.bonus, a.crit, a.touch, a.group]), x.ranged, `${n}: ranged attacks`);
  if (x.reach) eq([c.reach, c.reachNotes], x.reach, `${n}: reach and its note`);
  if (x.space) eq([c.space, c.reach], x.space, `${n}: space and reach`);
  if (x.aura) eq(c.aura.map((a) => a.name), x.aura, `${n}: auras`);
  if (x.languageSpecial) eq(c.languageSpecial, x.languageSpecial, `${n}: language specials`);
  if (x.feats) ok(x.feats.every((f) => c.feats.includes(f)), `${n}: feats with the bonus-feat marker stripped`, J(c.feats));
  if (x.hpNotes) eq(c.hp.notes, x.hpNotes, `${n}: hp notes`);
  if (x.saveNotes) eq(c.saves.notes, x.saveNotes, `${n}: save notes`);
  if (x.acNotes) eq(c.ac.notes, x.acNotes, `${n}: AC notes`);
  if (x.cmbNotes) eq(c.cmbNotes, x.cmbNotes, `${n}: CMB notes`);
  if (x.cmdNotes) eq(c.cmdNotes, x.cmdNotes, `${n}: CMD notes`);
  if ('cmb' in x) eq(c.cmb, x.cmb, `${n}: CMB`);
  if (x.init !== undefined) eq(c.init, x.init, `${n}: init`);
  if (x.classLine) eq(c.classLine, x.classLine, `${n}: class line`);
  if (x.ageCategory) eq(c.ageCategory, x.ageCategory, `${n}: dragon age category`);
  if (x.skillNote) eq(c.skills.find((s) => s.name === x.skillNote[0])?.note, x.skillNote[1], `${n}: ${x.skillNote[0]} situational note`);
  if (x.tactics) ok(x.tactics.test(c.tactics) && !c.melee.some((a) => /\+3\)/.test(a.damage)), `${n}: TACTICS cut out and kept`);
  // Collapsed, so no blank line separates the gear from the prose after it.
  if (x.gearOther) eq(parsePf1(read(file).replace(/\s+/g, ' ')).gear.other.at(-1), x.gearOther, `${n}: collapsed, the last gear item stops before the prose`);
}

// ---------------------------------------------------------------- variants
console.log('\nwhitespace variants');
const wrap = (t, w) => t.split('\n').map((line) => {
  const out = []; let cur = '';
  for (const word of line.split(' ')) {
    if (cur && (cur + ' ' + word).length > w) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  out.push(cur); return out.join('\n');
}).join('\n');
for (const [variant, original] of Object.entries(VARIANTS)) {
  eq(strip(parsePf1(read(variant))), strip(parsed[original]), `${variant} parses the same as ${original}`);
}
for (const file of Object.keys(FIXTURES)) {
  const t = read(file), base = J(strip(parsed[file]));
  const tries = {
    'every line joined into one': t.replace(/\s+/g, ' '),
    'wrapped at 30 columns': wrap(t, 30),
    'section headers removed': t.replace(/^\s*(?:DEFENSE|OFFENSE|STATISTICS|ECOLOGY|TACTICS)\s*$/gm, ''),
    'CRLF line ends': t.replace(/\n/g, '\r\n'),
  };
  const bad = Object.entries(tries).filter(([, v]) => J(strip(parsePf1(v))) !== base).map(([k]) => k);
  ok(bad.length === 0, `${file}: same result collapsed, wrapped, headerless and CRLF`, `differs when: ${bad.join('; ')}`);
}

// ---------------------------------------------------------------- snippets
console.log('\nsingle-section snippets');
{
  const c = parsePf1('Melee bite +9 (1d8+4 plus grab), 2 claws +8 (1d6+4)');
  eq(c.melee.map((a) => [a.name, a.count, a.bonus, a.damage, a.extra]),
    [['bite', 1, [9], '1d8+4', 'grab'], ['claw', 2, [8], '1d6+4', '']], 'a lone Melee line');
  eq(c.name, '', 'a lone Melee line does not become the name');
}
eq(parsePf1('AC 18, touch 12, flat-footed 15').ac, { total: 18, touch: 12, flatFooted: 15, components: {}, notes: '' }, 'a lone AC line');
eq(parsePf1('AC 18, touch 12, flat-footed 15 (+3 Dex, +3 natural)').ac.components, { dex: 3, natural: 3 }, 'AC breakdown');
{
  const b = parsePf1('Spells Known (CL 6th; concentration +9) 3rd (5/day)—fireball (DC 16), haste 1st—cure light wounds (2), blessD 0 (at will)—light').spellcasting[0];
  eq([b?.kind, b?.cl, b?.concentration], ['known', 6, 9], 'a lone Spells Known block: kind, CL, concentration');
  eq(b?.levels.map((l) => [l.level, l.perDay, l.spells.map((s) => s.name)]),
    [[3, 5, ['fireball', 'haste']], [1, null, ['cure light wounds', 'bless']], [0, 'at will', ['light']]], 'per-level lists on one line');
  eq(b?.levels[1].spells.map((s) => [s.count, !!s.domain]), [[2, false], [1, true]], 'count "(2)" and domain marker "blessD"');
  eq(b?.levels[0].spells[0].dc, 16, 'spell DC');
}
eq(parsePf1('Spell-Like Abilities (CL 5th) At will—mage hand 3/day—darkness, 1/week—commune').spellLikeAbilities[0]?.entries.map((e) => e.freq),
  ['at will', '3/day', '1/week'], 'a lone SLA block with frequencies');
{
  const c = parsePf1('Spell-Like Abilities (CL 20th) 1/day—blasphemy (DC 25), summon (level 9, any 1 CR 19 or lower demon 100%)');
  eq([c.cr, c.spellLikeAbilities[0]?.entries[0].spells[1]?.note], [null, 'level 9, any 1 CR 19 or lower demon 100%'],
    'a CR inside an SLA note is not a title CR, and does not cut the note');
}
eq(parsePf1('hp 45 each (6d8+18)').hp, { total: 45, hd: '6d8+18', hitDice: 6, each: true, notes: '' }, '"hp 45 each"');
eq(parsePf1('Speed 20 ft., burrow 10 ft., climb 20 ft., swim 40 ft., fly 60 ft. (perfect); earth glide').speed,
  { land: 20, fly: 60, flyManeuver: 'perfect', swim: 40, climb: 20, burrow: 10, other: ['earth glide'], notes: '' }, 'every speed type');
eq(parsePf1('Speed fly 30 ft. (good)').speed.fly, 30, 'a Speed with no land speed');
eq([parsePf1('Kobold CR 1/2\nXP 200').cr, parsePf1('Kobold CR 1/4').name], [0.5, 'Kobold'], 'CR 1/2 and a title-only paste');
{
  const c = parsePf1('Mythic Minotaur CR 6/MR 2');
  eq([c.name, c.cr, c.mr], ['Mythic Minotaur', 6, 2], 'CR 6/MR 2');
}
eq([parsePf1('Space 2-1/2 ft.; Reach 0 ft.').space, parsePf1('Space 2 1/2 ft., Reach 0 ft.').reach], [2.5, 0], 'Space 2-1/2 ft.');
eq(parsePf1('Ranged javelin +5 (1d6+3), range 30 ft.').ranged.map((a) => [a.name, a.range]), [['javelin', 30]], 'a trailing ", range 30 ft." joins its attack');
eq(parsePf1('Melee longsword +10/+5 (1d8+3/19−20) or bite +4 (1d4)').melee.map((a) => [a.bonus, a.crit, a.group]),
  [[[10, 5], '19-20', 0], [[4], '', 1]], 'iteratives, unicode minus in a crit range, "or" groups');
eq(parsePf1('Melee mwk longsword +8 (1d8+2/19-20/x3)').melee[0].crit, '19-20/x3', 'crit range with multiplier');
eq(parsePf1('Melee incorporeal touch +5 touch (1d6 cold)').melee[0].touch, true, 'touch attack');
eq(parsePf1('Init −2; Senses darkvision 60 ft.; Perception –1').init, -2, 'unicode minus and en dash as minus');
eq(parsePf1('Str 18, Dex —, Con 14, Int —, Wis 10, Cha 1').abilities, { str: 18, dex: null, con: 14, int: null, wis: 10, cha: 1 }, '"—" ability scores');
eq(parsePf1('DR 5/—; SR 15').defensive.dr, [{ amount: 5, bypass: '-' }], 'DR 5/—');
eq(parsePf1('Fort +5, Ref +3, Will +2; +4 vs. poison').saves, { fort: 5, ref: 3, will: 2, notes: '+4 vs. poison' }, 'save rider');
eq(parsePf1('Skills Stealth +10 (+14 in forests); Racial Modifiers +4 Stealth').skills, [{ name: 'Stealth', bonus: 10, note: '+14 in forests' }], 'skill with a situational note');
eq(parsePf1('Languages Common; telepathy 100 ft.').languageSpecial, ['telepathy 100 ft.'], 'language specials');
eq(parsePf1('Wizard Spells Prepared (CL 5th)\n3rd—fireball\nOpposition Schools enchantment, necromancy').spellcasting[0]?.opposition,
  ['enchantment', 'necromancy'], 'opposition schools trailer on a lone block');
{
  const sa = parsePf1('Stench (Ex) Creatures within 30 ft. must make a DC 14 Fortitude save.\nBreath weapon (Su): 30-ft. cone, save Ref 17.').specialAbilities;
  eq(sa.map((a) => [a.name, a.kind, a.dc]), [['Stench', 'Ex', 14], ['Breath weapon', 'Su', 17]], 'headerless special abilities, lowercase name, "save Ref 17"');
}
eq(parseDiceAvg('2d6+4'), 11, 'parseDiceAvg("2d6+4") is 11');
eq([parseDiceAvg('1d8'), parseDiceAvg('2d6–1'), parseDiceAvg('1d6+1d4'), parseDiceAvg('grab')], [4.5, 6, 6, null], 'parseDiceAvg edge cases');

// ---------------------------------------------------------------- round-trip
// A section's text back through the parser gives the same data. Fields a
// section's text also carries are held to it too (Perception rides on Senses).
console.log('\nformatPf1Section round-trip');
const ALSO = { senses: ['perception'], skills: ['racialMods'], languages: ['languageSpecial'] };
const EXPECTED_KEYS = ['melee', 'ranged', 'speed', 'defensive', 'senses', 'skills', 'feats', 'languages',
  'spellLikeAbilities', 'spellcasting', 'specialAttacks', 'specialAbilities', 'aura', 'sq'];
eq(Object.keys(SECTION_LABELS).sort(), [...EXPECTED_KEYS].sort(), 'SECTION_LABELS covers every section the form edits');
eq(`${SECTION_LABELS.melee} ${formatPf1Section(parsed['owlbear.txt'], 'melee')}`, 'Melee 2 claws +8 (1d6+4 plus grab), bite +8 (1d6+4)',
  'owlbear melee formats back to its own line');
for (const key of Object.keys(SECTION_LABELS)) {
  const bad = [];
  for (const [file, c] of Object.entries(parsed)) {
    const r = parsePf1(`${SECTION_LABELS[key]} ${formatPf1Section(c, key)}`);
    for (const k of [key, ...(ALSO[key] || [])]) if (J(r[k]) !== J(c[k])) bad.push(`${file} ${k}: ${J(r[k]).slice(0, 120)} vs ${J(c[k]).slice(0, 120)}`);
  }
  ok(bad.length === 0, `${key} round-trips on all ${Object.keys(parsed).length} fixtures`, bad.join('\n        '));
}

console.log(`\n${checks} checks, ${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
