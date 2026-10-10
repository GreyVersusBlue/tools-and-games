// abilities.js: PF1e special-ability text rewritten in 2e form, by rule.
//
// Each rule reads ONE construction a PF1e stat block writes the same way every
// time (a poison's stat line, "constrict (1d4+3)") and writes the 2e form of
// it. A rule that does not match the whole construction returns null, and the
// caller keeps the text it had, marked as PF1e wording. Nothing here guesses:
// a poison whose effect is not ability damage is left alone.
//
// Every DC and damage figure a rule writes comes from `ctx`, which is the
// converter's own arithmetic for this creature at its new level. The PF1e
// number is read only to find its tier. A distance, a duration or an onset is
// carried over as written, because the converter has no value of its own for
// one. The wording is this file's, not a book's (HISTORY #894).
//
// ctx = {
//   dc(pf1Dc)        -> the PF2e DC at the same tier, for this creature's level
//   plainDc          -> the DC used when the PF1e block gives none
//   strike(name)     -> { name, damage, dice } of the converted Strike, or null
//   strikeFor(pf1)   -> the same, for the Strike whose PF1e damage was `pf1`
//   scale(pf1)       -> PF1e damage dice scaled the way Strike damage was, or null
//   attack(pf1Bonus) -> the PF2e attack bonus at the same tier, for this level
//   umr(name)        -> the converter's text for a universal ability, or ''
//   area(die)        -> limited-use area damage for the level, in dice of that size
//   energy(word)     -> the PF2e damage type for a PF1e energy word, or null
//   level            -> the creature's PF2e level
//   hitDice          -> the PF1e block's Hit Dice, or null
//   tail(text)       -> trailing prose, converted the way unmatched text is
// }

export const RULES = Object.freeze(['affliction', 'gaze', 'constrict', 'trample', 'rend', 'throw-rock', 'distraction', 'paralysis', 'pull', 'rake', 'grab', 'limit', 'channel', 'death-burst', 'whirlwind', 'energy-drain']);

const ABILITY_CONDITION = {
  str: 'enfeebled 1', strength: 'enfeebled 1', dex: 'clumsy 1', dexterity: 'clumsy 1',
  con: 'drained 1', constitution: 'drained 1', int: 'stupefied 1', intelligence: 'stupefied 1',
  wis: 'stupefied 1', wisdom: 'stupefied 1', cha: 'stupefied 1', charisma: 'stupefied 1',
};
const SAVE = { fort: 'Fortitude', fortitude: 'Fortitude', ref: 'Reflex', reflex: 'Reflex', will: 'Will' };
const titleCase = (s) => String(s).replace(/\b[a-z]/g, (m) => m.toUpperCase());
const singular = (s) => String(s).trim().toLowerCase().replace(/^\d+\s+/, '').replace(/(ves)$/, 'f').replace(/s$/, '');

// "The save DC is Constitution-based and includes a +2 racial bonus." says how
// PF1e reached a number the converter has replaced, so it goes.
const DC_BASIS = /\s*The save DC is [A-Z][a-z]+-based(?: and includes a \+\d+ racial bonus)?\./g;
const keepTail = (rest, ctx) => {
  const t = String(rest || '').replace(DC_BASIS, '').trim();
  return t ? ' ' + ctx.tail(t) : '';
};

// A PF1e effect that is already a condition, and the PF2e condition for it.
// Nauseated is sickened 1, as it is under Distraction (HISTORY #894).
const EFFECT_CONDITION = {
  sleep: 'unconscious', unconsciousness: 'unconscious', paralysis: 'paralyzed',
  sickened: 'sickened 1', nauseated: 'sickened 1',
};
const SPAN = '\\d+(?:d\\d+(?:\\s*[+-]\\s*\\d+)?)?\\s+(?:rounds?|minutes?|hours?|days?)';
const EFFECT_FOR = new RegExp(`^([a-z]+)(?:\\s+for\\s+(${SPAN}))?$`, 'i');

// "1d3 Dex damage and 1d3 Con damage", "1d2 Str", "1d4 Constitution damage",
// "sleep for 1 minute". A condition's own duration is written only when it is
// not the stage's interval, which the stage line gives already.
function afflictionEffect(effect, interval) {
  const parts = String(effect).trim().split(/\s+and\s+/);
  const out = [];
  let conditionOnly = true;
  for (const p of parts) {
    const m = p.match(/^(?:\d+d\d+|\d+)\s+([A-Za-z]+)(?:\s+(?:damage|drain))?$/);
    let cond = m && ABILITY_CONDITION[m[1].toLowerCase()];
    if (cond) conditionOnly = false;
    else {
      const e = p.match(EFFECT_FOR);
      cond = e && EFFECT_CONDITION[e[1].toLowerCase()];
      if (cond && e[2] && e[2].replace(/\s+/g, ' ') !== `1 ${interval}`) cond += ` for ${e[2].replace(/\s+/g, ' ')}`;
    }
    if (!cond) return null;
    if (!out.includes(cond)) out.push(cond);
  }
  return out.length ? { stage: out.join(' and '), conditionOnly } : null;
}

const AFFLICTION = /^(?:([A-Z][A-Za-z' -]*?):\s*)?([A-Za-z ]+?)\s*[—–-]+\s*injury;\s*save\s+(?:(Fort|Fortitude|Ref|Reflex|Will)\s+)?DC\s+(\d+);\s*(?:onset\s+([^;]+);\s*)?frequency\s+1\/(round|minute|hour|day)(?:\s+for\s+(\d+\s+(?:rounds|minutes|hours|days)))?;\s*effect\s+([^;]+);\s*cure\s+\d+\s+(?:consecutive\s+)?saves?\.?\s*([\s\S]*)$/;

function affliction(name, text, ctx) {
  const kind = /poison|venom/i.test(name) ? 'poison' : /disease|fever|plague|rot\b/i.test(name) ? 'disease' : null;
  if (!kind) return null;
  const m = String(text).match(AFFLICTION);
  if (!m) return null;
  const [, title, source, save, dc1, onset, interval, max, effect, rest] = m;
  const read = afflictionEffect(effect, interval);
  if (!read) return null;
  const { stage, conditionOnly } = read;
  const dc = ctx.dc(Number(dc1));
  const line = [
    `Saving Throw DC ${dc} ${SAVE[(save || 'fort').toLowerCase()]}`,
    onset ? `Onset ${onset.trim()}` : '',
    max ? `Maximum Duration ${max}` : '',
    `Stage 1 ${stage} (1 ${interval})`,
  ].filter(Boolean).join('; ');
  return {
    rule: 'affliction', name: title ? titleCase(title.trim()) : null, actions: '', traits: [kind],
    text: `A creature damaged by the monster's ${singular(source)} Strike is exposed. ${line}.${keepTail(rest, ctx)}`,
    why: `PF1e ${kind} stat line: save DC ${dc1} rescaled for the level; ${effect.trim()} became ${stage}, ${conditionOnly ? 'the PF2e condition of that name' : 'the condition PF2e uses where PF1e damaged an ability score'}; the cure count is dropped, since a PF2e affliction ends by its stages.`,
    numbers: { dc },
  };
}

const GAZE_EFFECT = { 'turn to stone permanently': 'petrified permanently' };
const GAZE = /^([A-Za-z ]+?)(?:\s*\(as [a-z ]+\))?,\s*(?:range\s+)?(\d+)\s+feet,\s*(Fortitude|Reflex|Will)\s+DC\s+(\d+)\s+negates\.\s*([\s\S]*)$/;

function gaze(name, text, ctx) {
  if (!/gaze/i.test(name)) return null;
  const m = String(text).match(GAZE);
  const effect = m && GAZE_EFFECT[m[1].trim().toLowerCase()];
  if (!effect) return null;
  const dc = ctx.dc(Number(m[4]));
  return {
    rule: 'gaze', name: null, actions: '', traits: ['visual'],
    text: `A creature that starts its turn within ${m[2]} feet and can see the monster must attempt a DC ${dc} ${m[3]} save. On a failure, it is ${effect}.${keepTail(m[5], ctx)}`,
    why: `PF1e gaze stat line: DC ${m[4]} rescaled for the level, the range kept.`,
    numbers: { dc },
  };
}

// "When killed, a balor explodes in a blinding flash of fire that deals 100
// points of damage (half fire, half unholy damage) to anything within 100 feet
// (Reflex DC 33 halves)." The amount is not carried: a burst that happens once
// takes the level's limited-use area damage, as the breath weapon does. Holy
// and unholy are traits in PF2e and not damage types, so a half written as one
// goes to the trait and the damage is all of the other half's type.
const SANCTIFIED = ['holy', 'unholy'];
const DEATH_BURST = /^When killed, (?:an?|the) [A-Za-z' -]+? explodes(?: in [^.()]+?)? that deals (?:\d+d(\d+)(?:\s*[+-]\s*\d+)?|\d+) points of (?:([a-z]+) )?damage(?: \(half ([a-z]+), half ([a-z]+) damage\))? to anything within (\d+) feet \((Reflex|Fortitude|Will) DC (\d+) halves\)\.\s*([\s\S]*)$/;

function deathBurst(name, text, ctx) {
  const m = String(text).match(DEATH_BURST);
  if (!m) return null;
  const [, die, one, half1, half2, feet, save, dc1, rest] = m;
  if (Boolean(one) === Boolean(half1)) return null; // a type once, not twice and not never
  const trait = half1 && SANCTIFIED.includes(half2) ? half2 : null;
  if (half1 && !trait) return null;
  const type = ctx.energy(one || half1);
  const dice = type && ctx.area(Number(die) || 6);
  if (!dice) return null;
  const dc = ctx.dc(Number(dc1));
  return {
    rule: 'death-burst', name: null, actions: '', traits: [type, trait].filter(Boolean),
    text: `When the monster dies, it explodes, dealing ${dice} ${type} damage to each creature and object in a ${feet}-foot emanation (DC ${dc} basic ${save} save).${keepTail(rest, ctx)}`,
    why: `PF1e burst on death: DC ${dc1} rescaled for the level; the damage is the level's limited-use area damage, as a breath weapon's is, and PF1e's own amount is not carried${trait ? `; ${trait} is a trait in PF2e and not a damage type, so all of it is ${type}` : ''}; the radius is kept.`,
    numbers: { dc, damage: dice },
  };
}

// ---- special attacks written as a name and a parenthesis ----

// "1d4+3", "slam, 1d8+6", "2d6+7": the damage, and the Strike it names if any.
function constrict(params, ctx) {
  const m = String(params).match(/^(?:([a-z ]+),\s*)?(\d+d\d+(?:\s*[+-]\s*\d+)?)$/i);
  if (!m) return null;
  const pf1 = m[2].replace(/\s+/g, '');
  const from = (m[1] && ctx.strike(singular(m[1]))) || ctx.strikeFor(pf1);
  const dice = from ? from.dice : ctx.scale(pf1);
  if (!dice) return null;
  const dc = ctx.plainDc;
  return {
    rule: 'constrict', name: 'Constrict', actions: '1', traits: [],
    text: `The monster deals ${dice} bludgeoning damage to each creature it has grabbed or restrained (DC ${dc} basic Fortitude save).`,
    why: `PF1e constrict (${params}): ${from ? `the damage of the converted ${from.name} Strike, which PF1e wrote the same dice for` : 'the dice scaled as Strike damage was'}; PF1e gives no DC, so the moderate DC for the level.`,
    numbers: { dc, damage: dice },
  };
}

function trample(params, ctx) {
  const m = String(params).match(/^(\d+d\d+(?:\s*[+-]\s*\d+)?),\s*DC\s+(\d+)$/i);
  if (!m) return null;
  const pf1 = m[1].replace(/\s+/g, '');
  const from = ctx.strikeFor(pf1);
  const dice = from ? from.dice : ctx.scale(pf1);
  if (!dice) return null;
  const dc = ctx.dc(Number(m[2]));
  return {
    rule: 'trample', name: 'Trample', actions: '3', traits: [],
    text: `The monster Strides up to double its Speed and can move through the spaces of creatures its size or smaller. Each creature whose space it enters takes ${dice} bludgeoning damage (DC ${dc} basic Reflex save).`,
    why: `PF1e trample (${params}): DC ${m[2]} rescaled for the level; ${from ? `the damage of the converted ${from.name} Strike` : 'the dice scaled as Strike damage was'}.`,
    numbers: { dc, damage: dice },
  };
}

// "2 claws, 1d6+7": Rend names a Strike; its damage is that Strike's.
function rend(params, ctx) {
  const m = String(params).match(/^2\s+([a-z ]+?),\s*\d+d\d+(?:\s*[+-]\s*\d+)?$/i);
  const s = m && ctx.strike(singular(m[1]));
  if (!s) return null;
  return {
    rule: 'rend', name: 'Rend', actions: '1', traits: [],
    text: `${s.name}. Requirements The monster hit the same creature with two ${s.name} Strikes this turn. Effect That creature takes the damage of one ${s.name} Strike again (${s.damage}).`,
    why: `PF1e rend (${params}): PF2e Rend repeats the named Strike's damage, so the figure is the converted ${s.name} Strike's.`,
    numbers: { damage: s.dice },
  };
}

function throwRock(params) {
  const m = String(params).match(/^(\d+)\s*(?:ft\.?|feet)$/i);
  if (!m) return null;
  return {
    rule: 'throw-rock', name: 'Throw Rock', actions: '1', traits: [],
    text: `The monster picks up a rock within reach, or draws one it carries, and throws it as a ranged Strike with a range increment of ${m[1]} feet.`,
    why: `PF1e rock throwing (${params}): the range increment is kept.`,
    numbers: {},
  };
}

function distraction(params, ctx) {
  const m = String(params).match(/^DC\s+(\d+)$/i);
  if (!m) return null;
  const dc = ctx.dc(Number(m[1]));
  return {
    rule: 'distraction', name: 'Distraction', actions: '', traits: [],
    text: `A creature that takes damage from the swarm must succeed at a DC ${dc} Fortitude save or be sickened 1.`,
    why: `PF1e distraction (${params}): DC rescaled for the level; PF1e's nauseated for 1 round is sickened 1.`,
    numbers: { dc },
  };
}

const sentence = (s) => { const t = String(s).trim().replace(/\.$/, ''); return t ? ` ${t[0].toUpperCase()}${t.slice(1)}.` : ''; };
const DURATION = new RegExp(`^${SPAN}$`, 'i');

// "1d4+1 rounds, DC 13" and, on the ghoul, "elves are immune to this effect".
// A third clause is carried as a sentence unless it holds a figure, which no
// rule here could vouch for.
function paralysis(params, ctx) {
  const m = String(params).match(/^([^,]+),\s*DC\s+(\d+)(?:,\s*([^,\d]+))?$/i);
  if (!m || !DURATION.test(m[1].trim())) return null;
  const dc = ctx.dc(Number(m[2]));
  return {
    rule: 'paralysis', name: 'Paralysis', actions: '', traits: ['incapacitation'],
    text: `A creature hit by a Strike that lists paralysis must succeed at a DC ${dc} Fortitude save or be paralyzed for ${m[1].trim().replace(/\s+/g, ' ')}.${m[3] ? sentence(ctx.tail(m[3])) : ''}`,
    why: `PF1e paralysis (${params}): DC ${m[2]} rescaled for the level; the duration is kept, and the incapacitation trait is what PF2e puts on an effect that takes a creature out of the fight.`,
    numbers: { dc },
  };
}

// "tongue, 5 feet": Pull and Push name a Strike, and the creature must have it.
const drag = (verb) => (params, ctx) => {
  const m = String(params).match(/^([a-z ]+?),\s*(\d+)\s*(?:ft\.?|feet)$/i);
  const s = m && ctx.strike(singular(m[1]));
  if (!s) return null;
  return {
    rule: 'pull', name: titleCase(verb), actions: '1', traits: [],
    text: `Requirements The monster's last action was a successful ${s.name} Strike. Effect The monster ${verb === 'pull' ? `pulls the target ${m[2]} feet toward itself` : `pushes the target ${m[2]} feet away from itself`}.`,
    why: `PF1e ${verb} (${params}): the distance is kept; the Strike is the creature's own ${s.name}.`,
    numbers: {},
  };
};

// "2 claws +7, 1d4+3": extra claw attacks on a creature the monster holds.
const COUNT = { 2: 'two', 3: 'three', 4: 'four' };
function rake(params, ctx) {
  const m = String(params).match(/^([234])\s+(claws|talons)\s+\+(\d+),\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)$/i);
  if (!m) return null;
  const pf1 = m[4].replace(/\s+/g, '');
  const from = ctx.strike(singular(m[2])) || ctx.strikeFor(pf1);
  const dice = from ? from.dice : ctx.scale(pf1);
  const bonus = ctx.attack(Number(m[3]));
  if (!dice || bonus == null) return null;
  const part = singular(m[2]);
  return {
    rule: 'rake', name: 'Rake', actions: '1', traits: [],
    text: `Requirements The monster has a creature grabbed. Effect The monster makes ${COUNT[m[1]]} ${part} Strikes against that creature, each at +${bonus} for ${dice} slashing damage.`,
    why: `PF1e rake (${params}): attack +${m[3]} rescaled for the level; ${from ? `the damage of the converted ${from.name} Strike` : 'the dice scaled as Strike damage was'}.`,
    numbers: { attack: bonus, damage: dice },
  };
}

// "Large", "any size": the biggest creature the monster can Grab.
const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal'];
function grab(params, ctx) {
  const p = String(params).toLowerCase();
  const base = ctx.umr('grab');
  if (!base || !(p === 'any size' || SIZES.includes(p))) return null;
  const size = p === 'colossal' ? 'Gargantuan' : titleCase(p);
  return {
    rule: 'grab', name: 'Grab', actions: '', traits: [],
    text: `${base} It can Grab a creature of ${p === 'any size' ? 'any size' : `${size} size or smaller`}.`,
    why: `PF1e grab (${params}): the size limit is kept${p === 'colossal' ? ', and Colossal is Gargantuan in PF2e' : ''}.`,
    numbers: {},
  };
}

const TIMES = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

// "channel negative energy 3/day (DC 11, 1d6)": the limit is in the name.
function channel(name, params, ctx) {
  const n = String(name).match(/^channel (negative|positive) energy (\d+)\/day$/);
  const m = n && String(params).match(/^DC\s+(\d+),\s*(\d+d6)$/i);
  if (!m) return null;
  const dice = ctx.scale(m[2]);
  if (!dice) return null;
  const dc = ctx.dc(Number(m[1]));
  const neg = n[1] === 'negative';
  const [hurt, mend, type] = neg ? ['living', 'undead', 'void'] : ['undead', 'living', 'vitality'];
  return {
    rule: 'channel', name: `Channel ${titleCase(n[1])} Energy`, actions: '2', traits: [type],
    text: `Frequency ${TIMES(Number(n[2]))} per day. Effect Each ${hurt} creature within 30 feet takes ${dice} ${type} damage (DC ${dc} basic Will save). The monster can instead restore that many Hit Points to each ${mend} creature there.`,
    why: `PF1e channel energy (${params}): DC ${m[1]} rescaled for the level; the dice scaled as Strike damage was; 30 feet is the burst every PF1e channel has.`,
    numbers: { dc, damage: dice },
  };
}

// "9/day", "9/day, DC 18": a class feature the stat block names and gives no
// text for. The limit is all there is to write, so that is what is written.
function limit(name, params, ctx) {
  const m = String(params).match(/^(\d+)\/day(?:,\s*DC\s+(\d+))?$/i);
  if (!m || ctx.umr(name)) return null;
  const dc = m[2] ? ctx.dc(Number(m[2])) : null;
  return {
    rule: 'limit', name: null, actions: '', traits: [],
    text: `Frequency ${TIMES(Number(m[1]))} per day.${dc ? ` A save against it is DC ${dc}.` : ''}`,
    why: `PF1e stat line (${params}): the use limit as a Frequency entry${dc ? `, DC ${m[2]} rescaled for the level` : ''}. The stat block names this ability and gives no text for it, so its effect is not here.`,
    numbers: dc ? { dc } : {},
  };
}

// "1/10 minutes, 10-50 ft. tall, 1d8+4 damage, DC 17". The stat line gives no
// duration and no size: PF1e's whirlwind rule gives every creature 1 round for
// each 2 Hit Dice and catches creatures smaller than the whirlwind, so both
// are read from the block. PF1e's two Reflex saves, one against the damage and
// one against being picked up, are one basic save here.
function whirlwind(params, ctx) {
  const m = String(params).match(/^1\/(\d+ (?:rounds|minutes|hours)|round|minute|hour|day),\s*(\d+)-(\d+)\s*(?:ft\.?|feet)\s*tall,\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+damage,\s*DC\s+(\d+)$/i);
  const rounds = Math.floor((Number(ctx.hitDice) || 0) / 2);
  if (!m || rounds < 1) return null;
  const pf1 = m[4].replace(/\s+/g, '');
  const from = ctx.strikeFor(pf1);
  const dice = from ? from.dice : ctx.scale(pf1);
  if (!dice) return null;
  const dc = ctx.dc(Number(m[5]));
  return {
    rule: 'whirlwind', name: 'Whirlwind', actions: '2', traits: ['air'],
    text: `Frequency once per ${m[1].toLowerCase()}. Effect The monster becomes a whirlwind ${m[2]} to ${m[3]} feet tall for ${rounds} round${rounds > 1 ? 's' : ''} or until it Dismisses the effect. In this form it can't make Strikes and can move through other creatures' spaces. Each creature whose space it enters takes ${dice} bludgeoning damage (DC ${dc} basic Reflex save); a creature takes this damage only once per round. A creature smaller than the monster that fails the save is also picked up and moves with the whirlwind, and it can spend an action to attempt the save again and get free.`,
    why: `PF1e whirlwind (${params}): DC ${m[5]} rescaled for the level; ${from ? `the damage of the converted ${from.name} Strike, which PF1e wrote the same dice for` : 'the dice scaled as Strike damage was'}; the limit and the height are kept; ${rounds} round${rounds > 1 ? 's' : ''} is PF1e's 1 round for each 2 Hit Dice; PF1e's two Reflex saves are one basic save.`,
    numbers: { dc, damage: dice },
  };
}

// "2 levels, DC 22": negative levels a Strike bestows. PF1e's DC is the save a
// day later to shed the level; PF2e's Drain Life asks for the save when the
// Strike lands, so that is where the DC goes. A negative level is drained 1.
function energyDrain(params, ctx) {
  const m = String(params).match(/^([12]) levels?,\s*DC\s+(\d+)$/i);
  if (!m || !(ctx.level >= 1)) return null;
  const n = Number(m[1]);
  const dc = ctx.dc(Number(m[2]));
  return {
    rule: 'energy-drain', name: 'Drain Life', actions: '', traits: [],
    text: `When the monster damages a living creature with a Strike that lists Drain Life, the monster gains ${ctx.level} temporary Hit Points and the creature must succeed at a DC ${dc} Fortitude save or become drained ${n}. Further damage from such a Strike increases the drained value by ${n} on a failed save, to a maximum of drained 4.`,
    why: `PF1e energy drain (${params}): DC ${m[2]} rescaled for the level and moved from the save a day later to the hit, where PF2e's Drain Life has it; ${n === 1 ? 'a negative level is' : `${n} negative levels are`} drained ${n}; the temporary Hit Points are the creature's level.`,
    numbers: { dc },
  };
}

const LINE_RULES = { constrict, trample, rend, 'rock throwing': throwRock, distraction, paralysis, pull: drag('pull'), push: drag('push'), rake, grab, whirlwind, 'energy drain': energyDrain };

// A special attack with no text of its own: "rend (2 claws, 1d6+7)".
export function rewriteLine(name, params, ctx) {
  if (params == null) return null;
  const n = String(name).toLowerCase().trim(), p = String(params).trim();
  const fn = LINE_RULES[n];
  if (fn) return fn(p, ctx) || null;
  return channel(n, p, ctx) || limit(n, p, ctx) || null;
}

// A special ability with a block of text under SPECIAL ABILITIES.
export function rewriteBlock(name, text, ctx) {
  return affliction(name, text, ctx) || gaze(name, text, ctx) || deathBurst(name, text, ctx) || null;
}
