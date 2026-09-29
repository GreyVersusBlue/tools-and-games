// convert.js — a parsed PF1e creature (pf1-schema.js) in, a PF2e Remaster
// creature out.
//
// Every number is converted by where it sits, not what it is: a PF1e AC two
// points over the CR benchmark is a "high" AC, so the PF2e creature gets the
// GM Core's high AC for its level. tables.js holds both editions' benchmark
// tables and the tier arithmetic. Each output value carries `why`, the
// sentence the page shows when you hover it.

import * as T from './tables.js';
import { convertSpell, maxRankForLevel, rankFor, cleanSpellName, findPf1, metamagicOf } from './spells.js';
import { parseDiceAvg } from './parse-pf1.js';

const TIER_NAMES = ['terrible', 'low', 'moderate', 'high', 'extreme'];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const cap = (s) => String(s || '').replace(/^\w/, (c) => c.toUpperCase());
const titleCase = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

// A continuous tier (0 terrible .. 4 extreme) as words: "high", "between
// moderate and high".
export function tierWord(t) {
  if (t == null || Number.isNaN(t)) return 'unknown';
  if (t > 4.25) return 'beyond extreme';
  if (t < -0.25) return 'below terrible';
  const r = Math.round(t);
  if (Math.abs(t - r) <= 0.2 || t >= 4 || t <= 0) return TIER_NAMES[clamp(r, 0, 4)];
  const lo = TIER_NAMES[clamp(Math.floor(t), 0, 4)], hi = TIER_NAMES[clamp(Math.ceil(t), 0, 4)];
  return `between ${lo} and ${hi}`;
}

// ---- reading a PF2e table row at a continuous tier -------------------------
// A row is { extreme, high, moderate, low, terrible } with any subset present;
// each cell is a number, a [min, max] range (read as its midpoint) or
// { avg, dice } (read as avg). Between two tiers the value interpolates;
// beyond the ends it extrapolates by the last step, at most one tier.
const cellNum = (c) => (Array.isArray(c) ? (c[0] + c[1]) / 2 : c && typeof c === 'object' ? c.avg : c);

export function readRow(row, tier) {
  const pts = TIER_NAMES.map((n, i) => [i, cellNum(row?.[n])]).filter(([, v]) => typeof v === 'number');
  if (!pts.length) return null;
  if (pts.length === 1) return pts[0][1];
  const t = clamp(tier, pts[0][0] - 1, pts[pts.length - 1][0] + 1);
  let a = pts[0], b = pts[1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (t >= pts[i][0]) { a = pts[i]; b = pts[i + 1]; }
  }
  if (t > pts[pts.length - 1][0]) { a = pts[pts.length - 2]; b = pts[pts.length - 1]; }
  return a[1] + ((t - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
}
const rowAt = (table, level) => table[clamp(level, -1, 24)];
const pf2At = (table, level, tier) => Math.round(readRow(rowAt(table, level), tier));

// PF1e skills have no benchmark table. This line is fitted to Bestiary 1
// Perception: goblin CR 1/3 -1, ogre CR 3 +5, troll CR 5 +11, young red
// dragon CR 10 +17, balor CR 20 +34. "High" is 1.5 x CR + 4, "low" CR + 1.
function pf1SkillTier(bonus, cr) {
  const hi = 1.5 * cr + 4, lo = cr + 1;
  return 1 + (2 * (bonus - lo)) / Math.max(1, hi - lo);
}
// PF1e ability modifiers: the strongest score in a Bestiary stat block runs
// about +4 at CR 1 and +11 at CR 20 (balor Str 36).
const pf1TopMod = (cr) => 4 + cr / 3;

// ---- small dictionaries -----------------------------------------------------
export const SKILL_MAP = {
  acrobatics: 'Acrobatics', climb: 'Athletics', swim: 'Athletics', 'escape artist': 'Acrobatics',
  fly: 'Acrobatics', bluff: 'Deception', disguise: 'Deception', diplomacy: 'Diplomacy',
  intimidate: 'Intimidation', heal: 'Medicine', perform: 'Performance', 'sleight of hand': 'Thievery',
  'disable device': 'Thievery', stealth: 'Stealth', survival: 'Survival', 'use magic device': 'Arcana',
  spellcraft: 'Arcana', 'handle animal': 'Nature', ride: null, linguistics: 'Society',
  appraise: 'Society', craft: 'Crafting', 'knowledge (arcana)': 'Arcana', 'knowledge (nature)': 'Nature',
  'knowledge (religion)': 'Religion', 'knowledge (planes)': 'Religion', 'knowledge (dungeoneering)': 'Nature',
  'knowledge (engineering)': 'Crafting', 'knowledge (geography)': 'Society', 'knowledge (history)': 'Society',
  'knowledge (local)': 'Society', 'knowledge (nobility)': 'Society', 'sense motive': null, perception: null,
};
export function mapSkill(name) {
  const n = String(name).toLowerCase().trim();
  if (n in SKILL_MAP) return SKILL_MAP[n];
  if (n.startsWith('knowledge')) {
    const inner = n.match(/\((.*)\)/)?.[1];
    if (inner && inner.includes(',')) return mapSkill(`knowledge (${inner.split(',')[0].trim()})`);
    return inner ? `${titleCase(inner)} Lore` : 'Society';
  }
  if (n.startsWith('perform')) return 'Performance';
  if (n.startsWith('craft')) return 'Crafting';
  if (n.startsWith('profession')) {
    const inner = n.match(/\((.*)\)/)?.[1];
    return inner ? `${titleCase(inner)} Lore` : 'Lore';
  }
  return null;
}

const TYPE_TRAITS = {
  aberration: ['aberration'], animal: ['animal'], construct: ['construct'], dragon: ['dragon'],
  fey: ['fey'], humanoid: ['humanoid'], 'magical beast': ['beast'], 'monstrous humanoid': ['humanoid'],
  ooze: ['ooze'], outsider: [], plant: ['plant'], undead: ['undead'], vermin: ['animal'],
};
const SUBTYPE_TRAITS = {
  air: ['air'], earth: ['earth'], fire: ['fire'], water: ['water'], cold: ['cold'], aquatic: ['aquatic'],
  amphibious: ['amphibious'], incorporeal: ['incorporeal'], swarm: ['swarm'], troop: ['troop'],
  demon: ['fiend', 'demon'], devil: ['fiend', 'devil'], daemon: ['fiend', 'daemon'], qlippoth: ['fiend', 'qlippoth'],
  angel: ['celestial', 'angel'], archon: ['celestial', 'archon'], azata: ['celestial', 'azata'],
  agathion: ['celestial'], protean: ['monitor', 'protean'], inevitable: ['monitor', 'aeon'], aeon: ['monitor', 'aeon'],
  psychopomp: ['monitor', 'psychopomp'], elemental: ['elemental'], giant: ['giant'], goblinoid: ['goblin'],
  orc: ['orc'], elf: ['elf'], dwarf: ['dwarf'], gnome: ['gnome'], halfling: ['halfling'], human: ['human'],
  reptilian: [], shapechanger: [], native: [], extraplanar: [], augmented: [], kami: ['kami', 'spirit'],
  kyton: ['fiend', 'velstrac'], div: ['fiend', 'div'], oni: ['fiend', 'oni'], rakshasa: ['fiend', 'rakshasa'],
  'great old one': ['unique'], mythic: ['mythic'], evil: [], good: [], lawful: [], chaotic: [],
};
const FIEND = /\b(demon|devil|daemon|qlippoth|kyton|div|oni|rakshasa)\b/;
const CELESTIAL = /\b(angel|archon|azata|agathion)\b/;

const TYPE_IMMUNITIES = {
  undead: ['death effects', 'disease', 'paralyzed', 'poison', 'sleep'],
  construct: ['bleed', 'death effects', 'disease', 'doomed', 'drained', 'fatigued', 'healing', 'nonlethal attacks', 'paralyzed', 'poison', 'sickened', 'unconscious'],
  ooze: ['critical hits', 'mental', 'precision', 'unconscious', 'visual'],
  elemental: ['bleed', 'paralyzed', 'poison', 'sleep'],
};
const IMMUNE_MAP = [
  [/mind[- ]affecting/, 'mental'], [/^sleep/, 'sleep'], [/paralysis/, 'paralyzed'], [/stun/, 'stunned'],
  [/poison/, 'poison'], [/disease/, 'disease'], [/death/, 'death effects'], [/critical/, 'critical hits'],
  [/precision|sneak attack/, 'precision'], [/bleed/, 'bleed'], [/polymorph/, 'polymorph'],
  [/petrif/, 'petrified'], [/fatigue|exhaust/, 'fatigued'], [/ability (damage|drain)|energy drain/, 'drained'],
  [/negative energy/, 'void'], [/positive energy/, 'vitality'], [/electricity/, 'electricity'],
  [/^fire/, 'fire'], [/^cold/, 'cold'], [/^acid/, 'acid'], [/sonic/, 'sonic'], [/charm/, 'charm'],
  [/fear/, 'fear effects'], [/compulsion/, 'mental'], [/magic/, 'magic'], [/confusion/, 'confused'],
  [/nausea/, 'sickened'], [/blind/, 'blinded'], [/deaf/, 'deafened'], [/gaze/, 'visual'],
];
const DR_BYPASS = {
  '-': null, magic: null, epic: null, silver: 'silver', 'cold iron': 'cold iron', adamantine: 'adamantine',
  good: 'holy', evil: 'unholy', lawful: null, chaotic: null, bludgeoning: 'bludgeoning', piercing: 'piercing',
  slashing: 'slashing', 'mithral': 'silver', wood: 'wood',
};
const ENERGY_2E = { electricity: 'electricity', fire: 'fire', cold: 'cold', acid: 'acid', sonic: 'sonic',
  'negative energy': 'void', negative: 'void', 'positive energy': 'vitality', positive: 'vitality', force: 'force' };

const DAMAGE_TYPE = [
  [/bite|gore|sting|horn|spear|lance|rapier|dagger|arrow|bow|bolt|crossbow|javelin|trident|pick|dart|spine|quill|tusk|pincer|short ?sword|stinger|beak/, 'piercing'],
  [/claw|talon|sword|axe|scimitar|scythe|sickle|kukri|glaive|halberd|whip|wing blade|rake|falchion|katana/, 'slashing'],
  [/slam|tail|tentacle|hoof|wing|club|mace|hammer|flail|staff|sling|fist|unarmed|rock|boulder|morningstar|sap|quarterstaff|butt|head/, 'bludgeoning'],
];
function damageTypeOf(name) {
  const n = String(name).toLowerCase();
  for (const [re, t] of DAMAGE_TYPE) if (re.test(n)) return t;
  return 'bludgeoning';
}
const NATURAL = /bite|claw|gore|slam|sting|tail|tentacle|talon|hoof|wing|pincer|horn|tusk|rake|beak|touch|swarm/;

// Universal monster rules with a named PF2e counterpart.
const UMR = {
  grab: 'Grab', 'improved grab': 'Grab', constrict: 'Constrict', trip: 'Knockdown', 'swallow whole': 'Swallow Whole',
  trample: 'Trample', rend: 'Rend', ferocity: 'Ferocity', pounce: 'Pounce', rake: 'Rake', push: 'Push', pull: 'Pull',
  'blood drain': 'Drink Blood', 'frightful presence': 'Frightful Presence', web: 'Web Trap', 'energy drain': 'Drain Life',
  'fast healing': 'Fast Healing', regeneration: 'Regeneration', stench: 'Stench', 'breath weapon': 'Breath Weapon',
  'powerful charge': 'Powerful Charge', 'attach': 'Attach', 'distraction': 'Distraction', 'poison': 'Poison',
  'disease': 'Disease', 'paralysis': 'Paralysis', 'change shape': 'Change Shape', 'summon': 'Summon',
  'rock throwing': 'Throw Rock', 'rock catching': 'Catch Rock', 'petrifying gaze': 'Petrifying Gaze',
};

// Class to tradition, for "Cleric Spells Prepared" and friends.
const CLASS_TRADITION = {
  wizard: 'arcane', sorcerer: 'arcane', magus: 'arcane', arcanist: 'arcane', bloodrager: 'arcane', alchemist: 'arcane',
  summoner: 'arcane', witch: 'occult', bard: 'occult', skald: 'occult', psychic: 'occult', mesmerist: 'occult',
  occultist: 'occult', spiritualist: 'occult', medium: 'occult', cleric: 'divine', oracle: 'divine', paladin: 'divine',
  inquisitor: 'divine', warpriest: 'divine', antipaladin: 'divine', shaman: 'divine', druid: 'primal', ranger: 'primal',
  hunter: 'primal',
};

// ---- dice --------------------------------------------------------------------
const DIE_AVG = { 4: 2.5, 6: 3.5, 8: 4.5, 10: 5.5, 12: 6.5 };
// Dice for a target average, keeping the PF1e die size where there is one.
// About half the average comes from dice and half is flat, which is how the
// GM Core's Strike damage column reads (level 5 high: 2d8+7).
export function diceFor(avg, die = 8, share = 0.5) {
  if (!(avg > 0)) return '0';
  if (!DIE_AVG[die]) die = 8;
  const n = Math.max(1, Math.round((avg * share) / DIE_AVG[die]));
  const flat = Math.round(avg - n * DIE_AVG[die]);
  return `${n}d${die}${flat > 0 ? '+' + flat : flat < 0 ? flat : ''}`;
}
// Area and rider damage is all dice.
export function diceOnly(avg, die = 6) {
  if (!DIE_AVG[die]) die = 6;
  return `${Math.max(1, Math.round(avg / DIE_AVG[die]))}d${die}`;
}
const firstDie = (dmg) => Number(String(dmg || '').match(/\d*d(\d+)/)?.[1]) || null;

// ---- the conversion ----------------------------------------------------------
function explain(value, why) { return { value, why }; }

export function convertCreature(c, opts = {}) {
  const notes = [];
  const warn = (text) => notes.push({ warn: true, text });
  const note = (text) => notes.push({ text });

  const cr = c.cr ?? null;
  if (cr == null) warn('No CR given; assuming CR 1. Set a CR or a level for a real conversion.');
  const crN = cr ?? 1;
  const autoLevel = T.crToLevel(crN);
  const level = Number.isFinite(opts.level) ? clamp(Math.round(opts.level), -1, 24) : autoLevel;
  const levelWhy = Number.isFinite(opts.level)
    ? `Set by hand (CR ${fmtCr(crN)} would give ${autoLevel}).`
    : `CR ${fmtCr(crN)}: ${T.CR_TO_LEVEL_RULE || 'converted by crToLevel'}`;

  // One stat against its PF1e benchmark, landed at the same tier in PF2e.
  // floor: the lowest tier the GM Core prints for this table. Strikes have no
  // terrible column, so a PF1e caster's feeble touch attack (the lich's +7 at
  // CR 12) lands on low rather than off the bottom of the table.
  function bench(stat, v1, table, label, fallbackTier = 2, floor = 0) {
    if (v1 == null || Number.isNaN(v1)) {
      const v = pf2At(table, level, fallbackTier);
      return { ...explain(v, `No PF1e ${label} given; ${tierWord(fallbackTier)} for level ${level}.`), tier: fallbackTier };
    }
    const t = T.pf1TierOf(stat, v1, crN);
    const tier = clamp(t, floor, 4.5);
    const v = pf2At(table, level, tier);
    return { ...explain(v, `PF1e ${label} ${stat === 'hp' || stat === 'damage' ? v1 : signed(v1)} is ${tierWord(t)} for CR ${fmtCr(crN)}; ${tierWord(tier)} ${label} at level ${level} is ${v}.`), tier };
  }

  // ---- traits ----
  const traits = [];
  const typ = String(c.type || '').toLowerCase().trim();
  traits.push(...(TYPE_TRAITS[typ] || (typ ? [typ] : [])));
  const subs = (c.subtypes || []).map((s) => String(s).toLowerCase().trim());
  for (const s of subs) {
    if (s.startsWith('augmented')) continue;
    if (s in SUBTYPE_TRAITS) traits.push(...SUBTYPE_TRAITS[s]);
    else if (s) traits.push(s);
  }
  const isFiend = subs.some((s) => FIEND.test(s)) || (typ === 'outsider' && subs.includes('evil'));
  const isCelestial = subs.some((s) => CELESTIAL.test(s)) || (typ === 'outsider' && subs.includes('good'));
  if (isFiend) traits.push('unholy');
  if (isCelestial) traits.push('holy');
  if (typ === 'undead' && /E/.test(c.alignment || '')) traits.push('unholy');
  if (c.defensive?.immune?.some((i) => /mind-affecting/i.test(i)) && ['construct', 'ooze', 'vermin'].includes(typ)) traits.push('mindless');
  const uniq = [...new Set(traits.filter(Boolean))];
  if (c.alignment) note(`Alignment ${c.alignment} dropped: the Remaster has no alignment.${isFiend || isCelestial ? ' Fiends and celestials carry unholy or holy instead.' : ''}`);

  // ---- defenses ----
  const ac = bench('ac', c.ac?.total, T.PF2_AC, 'AC');
  const saves = {
    fort: bench('save', c.saves?.fort, T.PF2_SAVES, 'Fortitude'),
    ref: bench('save', c.saves?.ref, T.PF2_SAVES, 'Reflex'),
    will: bench('save', c.saves?.will, T.PF2_SAVES, 'Will'),
  };
  let saveNote = '';
  if (c.saves?.notes) {
    saveNote = c.saves.notes.replace(/\+(\d+)\s+(racial|morale|resistance|insight|luck|sacred|profane)?\s*(bonus\s+)?(on\s+(all\s+)?saves?\s+)?vs\.?/gi, '+1 status to all saves vs.');
  }
  if (c.defensive?.sr) saveNote = [saveNote, '+1 status to all saves vs. magic'].filter(Boolean).join('; ');

  let hp;
  if (opts.hp && opts.hp !== 'auto') {
    const t = { high: 3, moderate: 2, low: 1 }[opts.hp];
    const v = pf2At(T.PF2_HP, level, t);
    hp = { ...explain(v, `Set to ${opts.hp} Hit Points for level ${level}.`), tier: t };
  } else {
    hp = bench('hp', c.hp?.total, T.PF2_HP, 'Hit Points');
  }

  const [rMin, rMax] = rowAt(T.PF2_RESIST, level);
  const resistAt = (frac) => Math.max(1, Math.round(rMin + (rMax - rMin) * clamp(frac, 0, 1.25)));

  const immunities = new Set(TYPE_IMMUNITIES[typ] || []);
  if (TYPE_IMMUNITIES[typ]) note(`${cap(typ)} immunities filled in from the PF2e ${typ} trait's usual list.`);
  for (const raw of c.defensive?.immune || []) {
    const s = String(raw).toLowerCase().trim();
    const hit = IMMUNE_MAP.find(([re]) => re.test(s));
    if (hit) immunities.add(hit[1]);
    else if (/traits?$/.test(s)) { /* "undead traits", covered above */ }
    else immunities.add(s);
  }
  if (immunities.has('magic')) warn('Immune to magic: PF2e golems have Golem Antimagic instead. Write the specific spells that harm or heal it.');

  const resistances = [];
  const weaknesses = [];
  // PF2e swarms trade PF1e's weapon immunity for resistance to physical
  // damage and weakness to area and splash damage.
  if (subs.includes('swarm') || c.defensive?.immune?.some((i) => /weapon damage/i.test(i))) {
    immunities.delete('weapon damage');
    resistances.push({ type: 'physical', value: resistAt(0.5), except: '', why: 'PF1e swarm immune to weapon damage; PF2e swarms resist physical damage instead.' });
    weaknesses.push({ type: 'area damage', value: resistAt(0.5), why: 'PF1e swarms take extra from area effects; PF2e swarms are weak to area damage.' });
    weaknesses.push({ type: 'splash damage', value: resistAt(0.5), why: 'As area damage.' });
    note('Swarm: weapon immunity became physical resistance with weaknesses to area and splash damage, as PF2e swarms work. Swarm attacks become a Swarming action (automatic damage, basic Reflex save) rather than a Strike.');
  }
  for (const dr of c.defensive?.dr || []) {
    const bys = String(dr.bypass || '-').toLowerCase().split(/\s+(and|or)\s+/).filter((x) => x !== 'and' && x !== 'or');
    const except = bys.map((b) => DR_BYPASS[b.trim()]).filter(Boolean);
    const v = resistAt((dr.amount - 5) / 10);
    resistances.push({
      type: 'physical', value: v, except: except.join(' or '),
      why: `PF1e DR ${dr.amount}/${dr.bypass}; resistances at level ${level} run ${rMin} to ${rMax}.`,
    });
    if (bys.some((b) => /magic|epic|lawful|chaotic/.test(b))) note(`DR ${dr.amount}/${dr.bypass}: PF2e has no ${bys.filter((b) => /magic|epic|lawful|chaotic/.test(b)).join('/')} bypass, so the resistance applies to everything physical${except.length ? ' but ' + except.join(' or ') : ''}.`);
  }
  for (const r of c.defensive?.resist || []) {
    const type = ENERGY_2E[String(r.type).toLowerCase()] || String(r.type).toLowerCase();
    if (immunities.has(type)) continue;
    const v = resistAt((r.amount - 5) / 15);
    resistances.push({ type, value: v, except: '', why: `PF1e resist ${r.type} ${r.amount}; resistances at level ${level} run ${rMin} to ${rMax}.` });
  }

  for (const w of c.defensive?.weaknesses || []) {
    const m = String(w).toLowerCase().match(/vulnerab\w*\s+to\s+([a-z ]+)/);
    if (m) {
      const type = ENERGY_2E[m[1].trim()] || m[1].trim();
      weaknesses.push({ type, value: resistAt(0.6), why: `PF1e vulnerability (+50% damage); a mid-range weakness for level ${level}.` });
    }
  }
  const drSilver = (c.defensive?.dr || []).some((d) => /silver/.test(d.bypass));
  const drColdIron = (c.defensive?.dr || []).some((d) => /cold iron/.test(d.bypass));
  if (isFiend && !weaknesses.some((w) => w.type === 'holy')) weaknesses.push({ type: 'holy', value: resistAt(0.5), why: 'PF2e fiends are weak to holy.' });
  if (isCelestial && !weaknesses.some((w) => w.type === 'unholy')) weaknesses.push({ type: 'unholy', value: resistAt(0.5), why: 'PF2e celestials are weak to unholy.' });
  if (drSilver && subs.includes('shapechanger')) weaknesses.push({ type: 'silver', value: resistAt(0.4), why: 'PF1e DR/silver on a shapechanger; PF2e werecreatures take a silver weakness.' });
  if (drColdIron && typ === 'fey') weaknesses.push({ type: 'cold iron', value: resistAt(0.4), why: 'PF1e DR/cold iron on a fey; PF2e fey take a cold iron weakness.' });

  if (c.defensive?.sr) note(`SR ${c.defensive.sr}: PF2e has no spell resistance. It became "+1 status to all saves vs. magic" above; drop that if it makes the creature too sturdy.`);

  // Scale a PF1e per-round HP figure (fast healing, regeneration) by the HP ratio.
  const hpRatio = c.hp?.total ? hp.value / c.hp.total : 1;
  const defAbilities = [];
  for (const raw of c.defensive?.other || []) {
    const s = String(raw);
    const m = s.match(/^(regeneration|fast healing)\s+(\d+)\s*(?:\(([^)]*)\))?/i);
    if (m) {
      // PF2e regeneration heals about twice the share of its HP that PF1e's
      // did: troll 5 of 63 in PF1e, 20 of 115 in Monster Core.
      const v = Math.max(5, Math.round((Number(m[2]) * hpRatio * 2) / 5) * 5);
      defAbilities.push({
        name: titleCase(m[1]) + ` ${v}`, text: m[3] ? `(deactivated by ${m[3].replace(/\bor\b/, 'or')})` : '',
        why: `PF1e ${m[1]} ${m[2]}, scaled by the Hit Point ratio (${c.hp?.total} to ${hp.value}) and doubled, as PF2e regeneration runs.`,
      });
    } else if (/traits$/i.test(s.trim())) {
      // "swarm traits", "undead traits": covered by the traits and immunities.
    } else if (/channel resistance/i.test(s)) {
      note(`${s}: PF2e has no channel resistance; heal and harm target Fortitude or Will like anything else.`);
    } else {
      defAbilities.push({ name: titleCase(s), text: umrText(s) });
    }
  }

  // ---- perception, senses, languages, skills, attributes ----
  const perc = c.perception != null
    ? (() => {
      const t = pf1SkillTier(c.perception, crN);
      const v = pf2At(T.PF2_PERCEPTION, level, clamp(t, 0, 4));
      return { ...explain(v, `PF1e Perception ${signed(c.perception)} is ${tierWord(t)} for CR ${fmtCr(crN)}; level ${level} ${tierWord(clamp(t, 0, 4))} Perception is ${signed(v)}.`), tier: t };
    })()
    : { ...explain(pf2At(T.PF2_PERCEPTION, level, 2), `No PF1e Perception given; moderate for level ${level}.`) };
  const senses = (c.senses || []).map(convertSense).filter(Boolean);
  const languages = [...(c.languages || []).map(titleCase), ...(c.languageSpecial || [])].filter(Boolean);

  const skills = new Map();
  for (const sk of c.skills || []) {
    const to = mapSkill(sk.name);
    if (!to) continue;
    const t = pf1SkillTier(sk.bonus, crN);
    const tier = clamp(t, 0.5, 4);
    const v = pf2At(T.PF2_SKILL, level, tier);
    const prev = skills.get(to);
    if (!prev || prev.value < v) {
      skills.set(to, { name: to, value: v, why: `PF1e ${sk.name} ${signed(sk.bonus)} is ${tierWord(t)} for CR ${fmtCr(crN)}.`, note: sk.note || '' });
    }
  }
  // PF1e Climb and Swim often aren't listed; CMB is the creature's Athletics.
  if (!skills.has('Athletics') && c.cmb != null) {
    const t = clamp(T.pf1TierOf('attack', c.cmb, crN), 0.5, 4);
    const v = pf2At(T.PF2_SKILL, level, t);
    skills.set('Athletics', { name: 'Athletics', value: v, why: `From PF1e CMB ${signed(c.cmb)}, ${tierWord(t)} against the attack benchmark for CR ${fmtCr(crN)}.` });
  }
  const skillList = [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));

  const attrs = {};
  const topMod = pf1TopMod(crN);
  const pf2High = readRow(rowAt(T.PF2_ABILITY, level), 3);
  const pf2Ext = rowAt(T.PF2_ABILITY, level).extreme ?? pf2High + 1;
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const s = c.abilities?.[k];
    if (s == null) {
      attrs[k] = { value: k === 'con' && ['undead', 'construct'].includes(typ) ? 0 : k === 'int' && ['construct', 'ooze', 'vermin'].includes(typ) ? -5 : 0, why: 'PF1e score "—".' };
      continue;
    }
    const m1 = Math.floor((s - 10) / 2);
    const v = clamp(Math.round((m1 * pf2High) / topMod), -5, Math.round(pf2Ext));
    attrs[k] = { value: v, why: `PF1e ${k.toUpperCase()} ${s} (${signed(m1)}), scaled so +${Math.round(topMod)} at CR ${fmtCr(crN)} lands on high (+${Math.round(pf2High)}) at level ${level}.` };
  }

  // ---- speed ----
  const sp = c.speed || {};
  const speeds = [];
  if (sp.land != null) speeds.push(`${sp.land} feet`);
  for (const k of ['burrow', 'climb', 'fly', 'swim']) if (sp[k]) speeds.push(`${k} ${sp[k]} feet`);
  for (const o of sp.other || []) speeds.push(o);
  if (sp.flyManeuver) note(`Fly maneuverability (${sp.flyManeuver}) has no PF2e equivalent and was dropped.`);

  // ---- strikes ----
  const strikes = [];
  const groups = (list) => {
    const g = new Map();
    for (const a of list || []) {
      const k = a.group ?? 0;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(a);
    }
    return [...g.values()];
  };
  const meleeGroups = groups(c.melee);
  // The PF1e table's damage column is a full round's damage, so it's
  // compared against the best full attack the creature has.
  const roundDamage = (grp) => grp.reduce((sum, a) => sum + (a.count || 1) * (a.damageAvg ?? parseDiceAvg(a.damage) ?? 0) * Math.max(1, (a.bonus || []).length), 0);
  const allGroups = [...meleeGroups, ...groups(c.ranged)];
  const bestRound = Math.max(0, ...allGroups.map(roundDamage));
  const dmgTier = bestRound > 0 ? clamp(T.pf1TierOf('damage', bestRound, crN), 0.5, 4) : 2;
  if (bestRound > 0) note(`Strike damage: PF1e full attack averages ${Math.round(bestRound)} a round, ${tierWord(T.pf1TierOf('damage', bestRound, crN))} for CR ${fmtCr(crN)}, so Strikes use ${tierWord(dmgTier)} damage.`);

  const reach = c.reach && c.reach > 5 ? c.reach : null;
  const bigReach = (name) => {
    const m = String(c.reachNotes || '').match(new RegExp(`(\\d+)\\s*ft\\.?\\s*with\\s+${String(name).replace(/s$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
    return m ? Number(m[1]) : null;
  };
  const seen = new Set();
  const addStrikes = (list, kind) => {
    // Primary: the attack with the highest bonus in its group.
    const top = Math.max(-99, ...list.map((a) => (a.bonus || [])[0] ?? -99));
    for (let a of list) {
      const nm = String(a.name || 'attack').replace(/^\d+\s+/, '').replace(/s$/, (m) => (/(claw|slam|hoof|wing|talon|tentacle|horn|pincer|gore|sting)s$/i.test(a.name) ? '' : m));
      const key = kind + nm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const b1 = (a.bonus || [])[0];
      const secondary = b1 != null && b1 < top - 2;
      const at = bench('attack', b1, T.PF2_STRIKE_ATTACK, 'attack', 2, 1);
      const avg1 = a.damageAvg ?? parseDiceAvg(a.damage);
      // A secondary attack drops a tier; one of a pair (2 claws) drops half.
      const tier = secondary ? Math.max(0.5, dmgTier - 1) : (a.count || 1) > 1 ? Math.max(0.5, dmgTier - 0.5) : dmgTier;
      const avg2 = readRow(rowAt(T.PF2_STRIKE_DAMAGE, level), tier);
      const die = firstDie(a.damage) || 8;
      const dice = diceFor(avg2, die);
      // "1d8+5 negative energy plus paralysis": a type word leading the rider
      // is the Strike's own damage type.
      const lead = String(a.extra || '').match(/^(negative energy|positive energy|electricity|fire|cold|acid|sonic|force)\b\s*(?:plus\s+|and\s+)?/i);
      if (lead) a = { ...a, extra: a.extra.slice(lead[0].length) };
      const dtype = lead ? ENERGY_2E[lead[1].toLowerCase()] : a.touch ? 'void' : damageTypeOf(nm);
      const strikeTraits = [];
      if (NATURAL.test(nm.toLowerCase()) && (secondary || (a.count || 1) > 1)) strikeTraits.push('agile');
      if (kind === 'melee') {
        const r = bigReach(nm) || reach;
        if (r) strikeTraits.push(`reach ${r} feet`);
      } else if (a.range) strikeTraits.push(`range increment ${a.range} feet`);
      if (/magic|\+\d/.test(nm) && kind === 'melee') strikeTraits.push('magical');
      const riders = [];
      let extra = String(a.extra || '').trim();
      if (extra) {
        // Rider dice ("1d6 fire") scale with the main damage.
        const ratio = avg1 ? avg2 / avg1 : 1;
        extra = extra.replace(/(\d+)d(\d+)(?:\+(\d+))?\s+([a-z]+)/gi, (_, n, d, p, t) => {
          const v = (Number(n) * DIE_AVG[d] + Number(p || 0)) * ratio;
          return `${diceOnly(v, Number(d))} ${ENERGY_2E[t.toLowerCase()] || t}`;
        });
        for (const part of extra.split(/\s*(?:,|\band\b)\s*/)) {
          const p = part.trim();
          if (!p) continue;
          const u = UMR[p.toLowerCase()];
          riders.push(u || p);
        }
      }
      strikes.push({
        kind, name: nm.replace(/^mwk\s+|^masterwork\s+/i, '').replace(/\+\d+\s*/, '').trim(), bonus: at.value,
        bonusWhy: at.why, traits: strikeTraits,
        damage: `${dice} ${dtype}`, riders,
        damageWhy: `PF1e ${a.damage || '?'} (avg ${avg1 ?? '?'}); ${tierWord(tier)}${secondary ? ' (one step down for a secondary attack)' : (a.count || 1) > 1 ? ' (half a step down, one of several)' : ''} Strike damage at level ${level} averages ${Math.round(avg2)}.`,
        crit: a.crit || '',
      });
      if (a.crit && /19|18|x3|x4|×3|×4/.test(a.crit)) note(`${titleCase(nm)}: PF1e crit ${a.crit}. PF2e crits come from beating AC by 10; consider the deadly or fatal trait for a big-crit weapon.`);
      if ((a.bonus || []).length > 1) note(`${titleCase(nm)}: iterative attacks (${a.bonus.map(signed).join('/')}) become one Strike used with the multiple attack penalty.`);
    }
  };
  for (const g of meleeGroups) addStrikes(g, 'melee');
  for (const g of groups(c.ranged)) addStrikes(g, 'ranged');

  // ---- DCs in text: special attacks and abilities ----
  const dcFor = (dc1) => {
    const t = clamp(T.pf1TierOf('dc', dc1, crN), 1, 4);
    return { value: pf2At(T.PF2_SPELL_DC, level, t), tier: t };
  };
  const convertText = (text) => String(text || '')
    .replace(/\bDC\s*(\d+)/g, (_, d) => `DC ${dcFor(Number(d)).value}`)
    .replace(/Fortitude save/gi, 'Fortitude').replace(/Reflex save/gi, 'Reflex').replace(/Will save/gi, 'Will')
    .replace(/\ban? standard action\b/gi, '2 actions').replace(/\ban? swift action\b/gi, '1 action')
    .replace(/\ban? move action\b/gi, '1 action').replace(/\ban? full-round action\b/gi, '3 actions')
    .replace(/\ban? immediate action\b/gi, 'a reaction')
    .replace(/\bstandard action\b/gi, '2-action').replace(/\bfull-round action\b/gi, '3-action')
    .replace(/\bnegative levels?\b/gi, (m) => (/s$/i.test(m) ? 'drained values' : 'drained 1'))
    .replace(/\b(Heal|Bluff|Climb|Swim|Escape Artist|Sense Motive|Spellcraft|Disable Device|Sleight of Hand|Knowledge \([a-z ]+\)) (check|DC)/g, (m, sk, w) => `${mapSkill(sk) || 'Perception'} ${w}`)
    .replace(/\bflat-footed\b/gi, 'off-guard').replace(/\bnegative energy\b/gi, 'void').replace(/\bpositive energy\b/gi, 'vitality');

  const offAbilities = [];
  const specialByName = new Map((c.specialAbilities || []).map((s) => [String(s.name).toLowerCase(), s]));
  const usedSpecial = new Set();
  for (const raw of c.specialAttacks || []) {
    const s = String(raw).trim();
    const nameOnly = s.replace(/\s*\(.*$/, '').trim();
    const lower = nameOnly.toLowerCase();
    const detail = specialByName.get(lower) || [...specialByName.values()].find((x) => lower.startsWith(String(x.name).toLowerCase()));
    if (detail) usedSpecial.add(detail.name.toLowerCase());
    if (/^breath weapon/i.test(s)) {
      const m = s.match(/\((.*)\)/)?.[1] || '';
      const shape = m.match(/(\d+)-?ft\.?\s*(cone|line)/i);
      const dice = m.match(/(\d+)d(\d+)\s+([a-z]+)/i);
      const dc = m.match(/DC\s*(\d+)/i);
      const lim = rowAt(T.PF2_AREA_DAMAGE, level).limited.avg;
      const die = dice ? Number(dice[2]) : 6;
      const type = dice ? (ENERGY_2E[dice[3].toLowerCase()] || dice[3].toLowerCase()) : '';
      const d2 = dc ? dcFor(Number(dc[1])) : { value: pf2At(T.PF2_SPELL_DC, level, 3) };
      const save = /line/i.test(shape?.[2] || '') || /reflex/i.test(m) || !/fort|will/i.test(m) ? 'Reflex' : /fort/i.test(m) ? 'Fortitude' : 'Will';
      offAbilities.push({
        name: 'Breath Weapon', actions: '2', traits: [type, 'arcane'].filter(Boolean),
        text: `The creature breathes a ${shape ? `${shape[1]}-foot ${shape[2].toLowerCase()}` : 'cone'} that deals ${diceOnly(lim, die)} ${type} damage (DC ${d2.value} basic ${save} save). It can't use Breath Weapon again for 1d4 rounds.`,
        why: `PF1e ${m}; PF2e limited-use area damage at level ${level} averages ${Math.round(lim)}.`,
      });
      continue;
    }
    const u = UMR[lower] || UMR[lower.replace(/\s+\d.*$/, '')];
    offAbilities.push({
      name: u || titleCase(nameOnly), actions: '', traits: [],
      text: detail ? convertText(detail.text) : [umrText(lower), s.includes('(') ? `PF1e: ${convertText(s.match(/\((.*)\)/)[1])}.` : ''].filter(Boolean).join(' '),
      why: /DC\s*\d+/.test(s + (detail?.text || '')) ? 'DCs rescaled against the PF1e ability DC benchmark for this CR.' : '',
    });
  }
  const otherAbilities = [];
  for (const sa of c.specialAbilities || []) {
    if (usedSpecial.has(String(sa.name).toLowerCase())) continue;
    otherAbilities.push({ name: titleCase(sa.name), kind: sa.kind, text: convertText(sa.text), why: /DC\s*\d+/.test(sa.text) ? 'DCs rescaled against the PF1e ability DC benchmark for this CR.' : '' });
  }
  for (const a of c.aura || []) {
    const extra = convertText(a.text || '').replace(/\([^)]*\)/g, '').trim();
    offAbilities.unshift({ name: titleCase(a.name), actions: '', traits: ['aura'],
      text: [`${a.range ? a.range + ' feet' : ''}${a.dc ? `, DC ${dcFor(a.dc).value}` : ''}`.replace(/^, /, ''), extra.toLowerCase() === String(a.name).toLowerCase() ? '' : extra, umrText(a.name)].filter(Boolean).join('. '),
      why: a.dc ? `PF1e DC ${a.dc} rescaled.` : '' });
  }
  if ((c.feats || []).some((f) => /combat reflexes/i.test(f))) defAbilities.push({ name: 'Reactive Strike', text: '', why: 'PF1e Combat Reflexes. Most PF2e creatures lack attacks of opportunity.' });
  if ((c.feats || []).length) note(`Feats don't carry over: ${c.feats.join(', ')}. Anything that defined how it fights (Power Attack, Vital Strike, Flyby Attack) is worth a one- or two-action ability.`);

  // ---- spellcasting ----
  const pf2Top = maxRankForLevel(level);
  // A block's top rank follows its caster level as well as the creature's
  // level: a CR 10 dragon casting as a 1st-level sorcerer casts 1st-rank spells.
  const topFor = (cl) => Math.min(pf2Top, cl ? maxRankForLevel(cl) : pf2Top);
  const spellcasting = [];
  const spellNotes = [];
  const blockDc = (spells) => Math.max(0, ...spells.map((s) => s.dc || 0));
  const castTier = (dc1) => (dc1 ? clamp(T.pf1TierOf('dc', dc1, crN), 2, 4) : 3);

  function convertList(entries, pf1Top, blockTop) {
    // entries: [{ group, pf1Level, perDay, spells: [{name, dc, count}] }]
    const out = new Map(); // rank -> [{name, pf1, fit, note, count, freq}]
    const trad = {};
    for (const e of entries) {
      for (const s of e.spells) {
        const nm = cleanSpellName(s.name);
        const meta = metamagicOf(s.name);
        if (meta) spellNotes.push({ pf1: s.name, fit: 'close', note: `PF2e creatures don't use metamagic; cast as plain ${nm}. If the ${meta} version defined the fight, heighten it a rank or make it an innate spell with its own action cost.` });
        const r = opts.spellIndex ? convertSpell(opts.spellIndex, nm) : { fit: 'unmapped', targets: [], note: '' };
        const lvl = e.pf1Level ?? r.pf1?.level ?? findPf1(opts.spellIndex, nm)?.level ?? 1;
        if (!r.targets.length) {
          spellNotes.push({ pf1: nm, fit: r.fit, note: r.note || (r.fit === 'unmapped' ? 'Not in the spell map; unknown to PF1e data.' : 'No PF2e equivalent.') });
          continue;
        }
        const t = r.targets[0];
        for (const x of t.traditions) trad[x] = (trad[x] || 0) + 1;
        const rank = rankFor({ pf1Level: lvl, pf1Top, pf2Top: blockTop, baseRank: t.rank });
        if (!out.has(rank)) out.set(rank, []);
        const list = out.get(rank);
        if (list.some((x) => x.name === t.name && x.freq === e.freq)) continue;
        list.push({ name: t.name, pf1: nm, fit: r.fit, note: r.note, count: s.count || 1, freq: e.freq || '', why: `PF1e ${nm} (level ${lvl}) ${r.fit === 'exact' ? 'is' : r.fit === 'close' ? 'is close to' : 'is partly'} ${t.name}${t.rank ? ` (rank ${t.rank})` : ' (cantrip)'}${r.note ? '. ' + r.note : ''}` });
        if (rank > blockTop && rank > 0) spellNotes.push({ pf1: nm, fit: 'partial', note: `${t.name} is rank ${rank}, above the rank ${blockTop} this caster otherwise tops out at.` });
      }
    }
    const tradition = Object.entries(trad).sort((a, b) => b[1] - a[1])[0]?.[0] || 'arcane';
    const ranks = [...out.entries()].sort((a, b) => b[0] - a[0]).map(([rank, spells]) => ({ rank, spells }));
    return { tradition, ranks };
  }

  for (const sla of c.spellLikeAbilities || []) {
    const entries = (sla.entries || []).map((e) => ({ freq: e.freq, spells: e.spells || [] }));
    const all = entries.flatMap((e) => e.spells);
    const pf1Top = Math.max(1, ...all.map((s) => findPf1(opts.spellIndex, cleanSpellName(s.name))?.level ?? 1));
    const { tradition, ranks } = convertList(entries, pf1Top, topFor(sla.cl));
    const dc1 = blockDc(all);
    const t = castTier(dc1);
    if (!ranks.length) continue;
    spellcasting.push({
      name: `${cap(opts.tradition || tradition)} Innate Spells`, dc: pf2At(T.PF2_SPELL_DC, level, t), attack: pf2At(T.PF2_SPELL_ATTACK, level, t),
      why: dc1 ? `Highest PF1e spell-like DC ${dc1} is ${tierWord(T.pf1TierOf('dc', dc1, crN))} for CR ${fmtCr(crN)}.` : 'No DC in the PF1e block; high for the level.',
      ranks, innate: true, top: topFor(sla.cl),
    });
  }
  for (const blk of c.spellcasting || []) {
    const cls = String(blk.className || '').toLowerCase();
    const levels = blk.levels || [];
    const pf1Top = Math.max(0, ...levels.map((l) => l.level ?? 0));
    const entries = levels.map((l) => ({ pf1Level: l.level, perDay: l.perDay, spells: l.spells || [] }));
    const blockTop = topFor(blk.cl);
    const { tradition, ranks } = convertList(entries, pf1Top || 1, blockTop);
    const dc1 = blockDc(levels.flatMap((l) => l.spells || []));
    const t = castTier(dc1);
    const trad = opts.tradition || CLASS_TRADITION[cls.split(/\s+/)[0]] || tradition;
    const kindWord = blk.kind === 'known' ? 'Spontaneous' : 'Prepared';
    if (!ranks.length) continue;
    if (blk.kind === 'known') {
      for (const r of ranks) {
        const src = levels.find((l) => rankFor({ pf1Level: l.level, pf1Top: pf1Top || 1, pf2Top: blockTop, baseRank: 1 }) === r.rank);
        r.slots = r.rank === 0 ? null : clamp(Number(src?.perDay) || 3, 2, 4);
      }
    }
    spellcasting.push({
      name: `${cap(trad)} ${kindWord} Spells`, dc: pf2At(T.PF2_SPELL_DC, level, t), attack: pf2At(T.PF2_SPELL_ATTACK, level, t),
      why: dc1 ? `Highest PF1e spell DC ${dc1} is ${tierWord(T.pf1TierOf('dc', dc1, crN))} for CR ${fmtCr(crN)}.` : 'No DC in the PF1e block; high for the level.',
      ranks, innate: false, top: blockTop,
    });
  }
  if ((c.spellcasting || []).some((b) => b.domains?.length)) note(`Domains (${c.spellcasting.flatMap((b) => b.domains || []).join(', ')}) could become domain focus spells for a cleric.`);

  // ---- items ----
  if (c.gear && (c.gear.combat?.length || c.gear.other?.length)) {
    note(`Gear listed but not converted: ${[...(c.gear.combat || []), ...(c.gear.other || [])].join(', ')}. PF2e items are worth putting on the Items line by hand.`);
  }

  return {
    name: c.name || 'Unnamed Creature',
    level: { value: level, why: levelWhy },
    rarity: opts.rarity || 'common',
    size: c.size || 'Medium',
    traits: uniq,
    perception: perc, senses, languages, skills: skillList, attrs,
    ac, saves, saveNote, hp, immunities: [...immunities], resistances, weaknesses, defAbilities,
    speeds, strikes, spellcasting, offAbilities, otherAbilities,
    spellNotes, notes,
  };
}

function fmtCr(cr) {
  if (cr >= 1 || cr <= 0) return String(cr);
  const d = Math.round(1 / cr);
  return `1/${d}`;
}

function convertSense(s) {
  const n = String(s.name || '').toLowerCase().trim();
  const r = s.range ? ` ${s.range} feet` : '';
  if (n === 'darkvision') return 'darkvision';
  if (n === 'low-light vision') return 'low-light vision';
  if (n === 'see in darkness') return 'greater darkvision';
  if (n === 'scent') return `scent (imprecise) ${s.range || 30} feet`;
  if (n === 'blindsense') return `blindsense (imprecise)${r}`;
  if (n === 'blindsight') return `blindsight (precise)${r}`;
  if (n === 'tremorsense') return `tremorsense (imprecise)${r}`;
  if (n === 'lifesense') return `lifesense${r}`;
  if (n === 'see invisibility') return 'see invisibility';
  if (n === 'true seeing') return 'truesight';
  if (n === 'all-around vision') return 'all-around vision';
  return `${n}${r}`;
}

// Monster Core's wording for the universal abilities a PF1e block names.
const UMR_TEXT = {
  grab: 'Requirements The monster\'s last action was a success with a Strike that lists Grab in its damage. Effect The monster automatically Grabs the target until the end of its next turn. The creature is grabbed by whichever body part the monster attacked with, and that body part can\'t be used to Strike until the grab ends.',
  'improved grab': 'As Grab, but the monster can Grab as a free action.',
  constrict: 'The monster deals the listed damage to any number of creatures grabbed or restrained by it. Each of those creatures can attempt a basic Fortitude save.',
  rend: 'A Rend entry lists a Strike. Requirements The monster hit the same enemy with two consecutive Strikes of the listed type in the same round. Effect The monster automatically deals that Strike\'s damage again to the enemy.',
  trip: 'Knockdown: Requirements The monster\'s last action was a success with a Strike that lists Knockdown in its damage. Effect The monster knocks the target prone.',
  knockdown: 'Requirements The monster\'s last action was a success with a Strike that lists Knockdown in its damage. Effect The monster knocks the target prone.',
  ferocity: 'Trigger The monster is reduced to 0 HP. Effect The monster avoids being knocked out and remains at 1 HP, but its wounded value increases by 1. When it is wounded 3, it can no longer use this ability.',
  pounce: 'The monster Strides and makes a Strike at the end of that movement. If the monster began this action hidden, it remains hidden until after the Strike.',
  trample: 'The monster Strides up to double its Speed and can move through the spaces of creatures its size or smaller, trampling each creature whose space it enters. A trampled creature takes the listed Strike damage (basic Reflex save).',
  'swallow whole': 'The monster attempts to swallow a creature of the listed size or smaller that it has grabbed in its mouth. The swallowed creature is off-guard, restrained, has no line of effect outside, and takes the listed damage when first swallowed and at the end of each of its turns. It can Escape, or cut its way out by dealing the listed damage to the monster\'s interior.',
  push: 'Requirements The monster\'s last action was a success with a Strike that lists Push in its damage. Effect The monster automatically knocks the target 5 feet away (10 on a critical hit).',
  'frightful presence': 'A creature that first enters the area must attempt a Will save. Critical Success unaffected and temporarily immune for 1 minute; Success frightened 1; Failure frightened 2; Critical Failure frightened 4.',
  'blood drain': 'Drink Blood: Requirements A grabbed, restrained, paralyzed or unconscious creature is adjacent. Effect The monster drinks the creature\'s blood, dealing damage and making it drained 1.',
  'energy drain': 'On a hit, the target becomes drained 1 (drained 2 on a critical hit), and the monster gains temporary Hit Points equal to its level.',
  stench: 'A creature entering the aura or starting its turn there must succeed at a Fortitude save or be sickened 1 (sickened 2 on a critical failure). A creature that succeeds is temporarily immune for 1 minute.',
  'powerful charge': 'The monster Strides twice, then makes a Strike. If it moved at least 20 feet, the Strike deals extra damage.',
  'rock catching': 'Catch Rock: Trigger The monster is targeted by a thrown rock Strike. Effect The monster gains a +4 circumstance bonus to AC against the triggering attack. If the attack misses, the monster catches the rock.',
  'rock throwing': 'Throw Rock: the monster picks up a rock within reach or retrieves a stowed rock and throws it, making a ranged Strike.',
};
function umrText(name) {
  return UMR_TEXT[String(name).toLowerCase().replace(/\s*\(.*$/, '').trim()] || '';
}

// ---- plain text, for the Copy button ----------------------------------------
export function toText(o) {
  const L = [];
  const spells = (sc) => `${sc.name} DC ${sc.dc}, attack ${signed(sc.attack)}; ` + sc.ranks.map((r) => {
    const head = r.rank === 0 ? `Cantrips (${ordinal(sc.top)})` : `${ordinal(r.rank)}${r.slots ? ` (${r.slots} slots)` : ''}`;
    return `${head} ${r.spells.map((s) => s.name.toLowerCase() + (s.freq && s.freq !== 'at will' ? ` (${s.freq})` : s.freq === 'at will' ? ' (at will)' : '') + (s.count > 1 ? ` (x${s.count})` : '')).join(', ')}`;
  }).join('; ');
  L.push(`${o.name.toUpperCase()}    CREATURE ${o.level.value}`);
  L.push([o.rarity !== 'common' ? o.rarity : null, o.size, ...o.traits].filter(Boolean).map((t) => t.toUpperCase()).join(' '));
  L.push(`Perception ${signed(o.perception.value)}${o.senses.length ? '; ' + o.senses.join(', ') : ''}`);
  if (o.languages.length) L.push(`Languages ${o.languages.join(', ')}`);
  if (o.skills.length) L.push(`Skills ${o.skills.map((s) => `${s.name} ${signed(s.value)}`).join(', ')}`);
  L.push(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => `${cap(k)} ${signed(o.attrs[k].value)}`).join(', '));
  L.push('');
  L.push(`AC ${o.ac.value}; Fort ${signed(o.saves.fort.value)}, Ref ${signed(o.saves.ref.value)}, Will ${signed(o.saves.will.value)}${o.saveNote ? '; ' + o.saveNote : ''}`);
  const hpBits = [`HP ${o.hp.value}`];
  const regen = o.defAbilities.filter((d) => /^(Regeneration|Fast Healing)/.test(d.name));
  for (const r of regen) hpBits.push(`${r.name.toLowerCase()}${r.text ? ' ' + r.text : ''}`);
  if (o.immunities.length) hpBits.push(`Immunities ${o.immunities.join(', ')}`);
  if (o.weaknesses.length) hpBits.push(`Weaknesses ${o.weaknesses.map((w) => `${w.type} ${w.value}`).join(', ')}`);
  if (o.resistances.length) hpBits.push(`Resistances ${o.resistances.map((r) => `${r.type} ${r.value}${r.except ? ` (except ${r.except})` : ''}`).join(', ')}`);
  L.push(hpBits.join('; '));
  for (const d of o.defAbilities) if (!regen.includes(d)) L.push(`${d.name}${d.text ? ' ' + d.text : ''}`);
  L.push('');
  L.push(`Speed ${o.speeds.join(', ') || '—'}`);
  for (const s of o.strikes) {
    L.push(`${cap(s.kind)} [one-action] ${s.name} ${signed(s.bonus)}${s.traits.length ? ` (${s.traits.join(', ')})` : ''}, Damage ${s.damage}${s.riders.length ? ' plus ' + s.riders.join(' and ') : ''}`);
  }
  for (const sc of o.spellcasting) L.push(spells(sc));
  for (const a of [...o.offAbilities, ...o.otherAbilities]) {
    const act = a.actions === '2' ? ' [two-actions]' : a.actions === '1' ? ' [one-action]' : '';
    L.push(`${a.name}${act}${a.traits?.length ? ` (${a.traits.join(', ')})` : ''} ${a.text}`.trim());
  }
  return L.join('\n');
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
