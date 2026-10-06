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
//   tail(text)       -> trailing prose, converted the way unmatched text is
// }

export const RULES = Object.freeze(['affliction', 'gaze', 'constrict', 'trample', 'rend', 'throw-rock', 'distraction']);

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

// "1d3 Dex damage and 1d3 Con damage", "1d2 Str", "1d4 Constitution damage".
function afflictionEffect(effect) {
  const parts = String(effect).trim().split(/\s+and\s+/);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^(?:\d+d\d+|\d+)\s+([A-Za-z]+)(?:\s+(?:damage|drain))?$/);
    const cond = m && ABILITY_CONDITION[m[1].toLowerCase()];
    if (!cond) return null;
    if (!out.includes(cond)) out.push(cond);
  }
  return out.length ? out.join(' and ') : null;
}

const AFFLICTION = /^(?:([A-Z][A-Za-z' -]*?):\s*)?([A-Za-z ]+?)\s*[—–-]+\s*injury;\s*save\s+(?:(Fort|Fortitude|Ref|Reflex|Will)\s+)?DC\s+(\d+);\s*(?:onset\s+([^;]+);\s*)?frequency\s+1\/(round|minute|hour|day)(?:\s+for\s+(\d+\s+(?:rounds|minutes|hours|days)))?;\s*effect\s+([^;]+);\s*cure\s+\d+\s+(?:consecutive\s+)?saves?\.?\s*([\s\S]*)$/;

function affliction(name, text, ctx) {
  const kind = /poison|venom/i.test(name) ? 'poison' : /disease|fever|plague|rot\b/i.test(name) ? 'disease' : null;
  if (!kind) return null;
  const m = String(text).match(AFFLICTION);
  if (!m) return null;
  const [, title, source, save, dc1, onset, interval, max, effect, rest] = m;
  const stage = afflictionEffect(effect);
  if (!stage) return null;
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
    why: `PF1e ${kind} stat line: save DC ${dc1} rescaled for the level; ${effect.trim()} became ${stage}, the condition PF2e uses where PF1e damaged an ability score; the cure count is dropped, since a PF2e affliction ends by its stages.`,
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

const LINE_RULES = { constrict, trample, rend, 'rock throwing': throwRock, distraction };

// A special attack with no text of its own: "rend (2 claws, 1d6+7)".
export function rewriteLine(name, params, ctx) {
  const fn = LINE_RULES[String(name).toLowerCase().trim()];
  return (fn && params != null && fn(String(params).trim(), ctx)) || null;
}

// A special ability with a block of text under SPECIAL ABILITIES.
export function rewriteBlock(name, text, ctx) {
  return affliction(name, text, ctx) || gaze(name, text, ctx) || null;
}
