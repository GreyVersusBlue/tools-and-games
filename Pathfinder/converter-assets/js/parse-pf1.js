// parse-pf1.js: turns a pasted Pathfinder 1e stat block into the shape in
// pf1-schema.js.
//
// Pasted text arrives from three places that disagree about whitespace: Archives
// of Nethys (one field per line), d20pfsrd (the same, with stray leading
// spaces) and PDFs (lines collapsed, or broken mid-field). So nothing here
// trusts a line break. The text is scanned for field labels ("AC 16", "Melee",
// "Spell-Like Abilities", ...) and each field's value runs to the next label.
// The only whitespace that means anything is a blank line, which ends a value
// (it is how AoN and the NPC Codex separate the stat block from the prose
// after it).
//
// Two regions are cut out before the label scan because they repeat labels in
// prose: TACTICS ("Base Statistics ... Melee mwk greatsword +4") and
// SPECIAL ABILITIES (free text, parsed on its own).

import { emptyCreature } from './pf1-schema.js';

// ---------------------------------------------------------------- helpers

/** Average of a dice expression: "2d6+4" -> 11, "1d8" -> 4.5, "1d6+1d4-1" -> 5. null if unreadable. */
export function parseDiceAvg(expr) {
  if (expr == null) return null;
  const s = normalizeDashes(String(expr)).replace(/\s+/g, '');
  if (!/^[+-]?(\d+d\d+|\d+)([+-](\d+d\d+|\d+))*$/i.test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(/([+-]?)(\d+)(?:d(\d+))?/gi)) {
    const sign = m[1] === '-' ? -1 : 1;
    const n = Number(m[2]);
    total += sign * (m[3] ? n * (Number(m[3]) + 1) / 2 : n);
  }
  return total;
}

function normalizeDashes(s) {
  // en dash, minus sign, figure dash, hyphen, non-breaking hyphen -> "-".
  // The em dash stays: it is the "none" of "Con —" and the separator of
  // "At will—detect magic". The horizontal bar is an em dash that lost its way.
  return s.replace(/[–−‒‐‑]/g, '-').replace(/―/g, '—');
}

function normalize(text) {
  let s = String(text ?? '');
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[   ]/g, ' ').replace(/[­​‌‍﻿]/g, '');
  s = normalizeDashes(s);
  s = s.replace(/×/g, 'x');                    // "×3"
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  return s.trim();
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, '')));
const signed = (s) => {
  if (s == null) return null;
  const m = /([+-]?)\s*(\d+)/.exec(s);
  return m ? (m[1] === '-' ? -Number(m[2]) : Number(m[2])) : null;
};

/** Split on `sep` characters that are not inside (), [] or {}. */
export function splitTop(s, seps = ',;') {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Split on the word " or " outside parentheses. */
function splitOr(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && s.startsWith(' or ', i)) { out.push(s.slice(start, i)); start = i + 4; i += 3; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

const feet = (s) => {
  const m = /(\d+)(?:\s*-\s*1\/2|\s+1\/2|\s*½)?\s*(?:ft|feet|')/.exec(s);
  if (!m) { if (/^\s*1\/2\s*(ft|feet)/.test(s)) return 0.5; return null; }
  return Number(m[1]) + (/(-\s*1\/2|\s1\/2|½)/.test(m[0]) ? 0.5 : 0);
};

const CLASS_NAMES = [
  'Adept', 'Alchemist', 'Antipaladin', 'Arcanist', 'Bard', 'Bloodrager', 'Cleric', 'Druid',
  'Hunter', 'Inquisitor', 'Investigator', 'Magus', 'Medium', 'Mesmerist', 'Occultist',
  'Oracle', 'Paladin', 'Psychic', 'Ranger', 'Shaman', 'Skald', 'Sorcerer', 'Spiritualist',
  'Summoner', 'Warpriest', 'Witch', 'Wizard',
];

const TYPES = [
  'aberration', 'animal', 'construct', 'dragon', 'fey', 'humanoid', 'magical beast',
  'monstrous humanoid', 'ooze', 'outsider', 'plant', 'undead', 'vermin',
];
// Longest first, so "young adult" wins over "young" and "great wyrm" over "wyrm".
const DRAGON_AGES = ['great wyrm', 'mature adult', 'young adult', 'very young', 'very old', 'wyrmling',
  'juvenile', 'ancient', 'adult', 'young', 'wyrm', 'old'];

const SIZES = ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];

// ---------------------------------------------------------------- labels

// Case-sensitive on purpose: "Will" the save vs "will" in "at will", "Aura"
// the field vs "unholy aura", "Resist" vs "resist energy". Each regex must
// match the label only; the value starts where the match ends.
const B = '(?<=^|[\\s;,.)])';          // a label starts after whitespace or punctuation
const LABELS = [
  ['cr', `${B}CR(?=\\s+\\d)`],
  ['source', `${B}Source(?=\\s)`],
  ['xp', `${B}XP(?=\\s+\\d)`],
  ['init', `${B}Init(?=\\s*[+-]?\\d)`],
  ['senses', `${B}Senses(?=\\s)`],
  ['aura', `${B}Aura(?=\\s)`],
  ['ac', `${B}AC(?=\\s+\\d)`],
  ['hp', `${B}hp(?=\\s+\\d)`],
  ['fort', `${B}Fort(?=\\s*[+-]?\\d)`],
  ['ref', `${B}Ref(?=\\s*[+-]?\\d)`],
  ['will', `${B}Will(?=\\s*[+-]?\\d)`],
  ['defensiveAbilities', `${B}Defensive Abilities(?=\\s)`],
  ['dr', `${B}DR(?=\\s+\\d)`],
  ['immune', `${B}Immune(?=\\s)`],
  ['resist', `${B}Resist(?=\\s+[a-z])`],
  ['sr', `${B}SR(?=\\s+\\d)`],
  ['weaknesses', `${B}Weakness(?:es)?(?=\\s)`],
  ['speed', `${B}Speed(?=\\s+(?:\\d|(?:fly|swim|climb|burrow)\\b))`],
  ['melee', `${B}Melee(?=\\s)`],
  ['ranged', `${B}Ranged(?=\\s)`],
  ['space', `${B}Space(?=\\s+\\d)`],
  ['reach', `${B}Reach(?=\\s+\\d)`],
  ['specialAttacks', `${B}Special Attacks(?=\\s)`],
  ['sla', `${B}(?:[A-Z][a-z]+ )?Spell-Like Abilities`],
  ['spells', `${B}(?:(?:${CLASS_NAMES.join('|')}|[A-Z][a-z]+) )?(?:Spells|Extracts) (?:Known|Prepared)`],
  ['domainNote', `${B}D Domain spell`],
  ['domains', `${B}Domains?(?=\\s+[A-Z])`],
  ['opposition', `${B}Opposition Schools?(?=\\s)`],
  ['bloodline', `${B}Bloodline(?=\\s+[a-z])`],
  ['mystery', `${B}Mystery(?=\\s+[a-z])`],
  ['patron', `${B}Patron(?=\\s+[a-z])`],
  ['abilities', `${B}Str(?=\\s+(?:\\d+|—|-)\\s*,?\\s*Dex)`],
  ['bab', `${B}Base Atk(?=\\s)`],
  ['cmb', `${B}CMB(?=\\s)`],
  ['cmd', `${B}CMD(?=\\s)`],
  ['feats', `${B}Feats(?=\\s)`],
  ['skills', `${B}Skills(?=\\s)`],
  ['racialMods', `${B}Racial Modifiers?(?=\\s)`],
  ['languages', `${B}Languages?(?=\\s)`],
  ['sq', `${B}(?:SQ|Special Qualities)(?=\\s)`],
  ['combatGear', `${B}Combat Gear(?=\\s)`],
  ['otherGear', `${B}Other Gear(?=\\s)`],
  ['gear', `${B}Gear(?=\\s)`],
  ['environment', `${B}Environment(?=\\s)`],
  ['organization', `${B}Organization(?=\\s)`],
  ['treasure', `${B}Treasure(?=\\s)`],
  // Section headers only terminate the field before them.
  ['header', `${B}(?:DEFENSE|OFFENSE|STATISTICS|ECOLOGY)\\b`],
  ['header', `(?<=^|\\n)(?:Defense|Offense|Statistics|Ecology)(?=\\n)`],
];
// A PDF can break a line between the two words of "Other Gear", so a space in a
// label means any run of whitespace.
const LABEL_RES = LABELS.map(([key, src]) => [key, new RegExp(src.replace(/ /g, '\\s+'), 'g')]);

const TRAILS_INTO_PROSE = new Set(['combatGear', 'otherGear', 'gear', 'languages', 'sq', 'feats', 'skills',
  'racialMods', 'environment', 'organization', 'treasure']);
const PROSE_START = /\s(?=(?:The|These|This|Those|A|An|In|When|While|Although|Its|His|Her|Their|Some|Many|Most|Once|Unlike|Few|Such|Legends)\s+[a-z]+\s+[a-z])/;

function scanLabels(text) {
  const hits = [];
  for (const [key, re] of LABEL_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push({ key, start: m.index, end: m.index + m[0].length, label: m[0] });
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start < lastEnd) continue;           // "Gear" inside "Combat Gear"
    kept.push(h);
    lastEnd = h.end;
  }
  // Only a "CR" ahead of every other label is the title's; the rest are prose
  // ("summon (level 9, any 1 CR 19 or lower demon)"), and a pasted SLA line
  // on its own has no title at all.
  const out = kept.filter((h, i) => h.key !== 'cr' || i === 0);
  for (let i = 0; i < out.length; i++) {
    const next = i + 1 < out.length ? out[i + 1].start : text.length;
    let v = text.slice(out[i].end, next);
    const para = v.search(/\n\s*\n/);
    if (para >= 0) v = v.slice(0, para);
    v = squash(v);
    // With no blank line left (a collapsed paste), the prose after the stat
    // block runs on into the last field: "94 gp The dwarven war priest serves".
    if (i === out.length - 1 && para < 0 && TRAILS_INTO_PROSE.has(out[i].key)) {
      const p = PROSE_START.exec(v);
      if (p) v = v.slice(0, p.index);
    }
    out[i].value = v.replace(/^[:;,]\s*/, '').replace(/[;,]\s*$/, '').trim();
  }
  return out;
}

// ---------------------------------------------------------------- regions

function findRegion(text, startRe, endRes) {
  const m = startRe.exec(text);
  if (!m) return null;
  let end = text.length;
  for (const re of endRes) {
    re.lastIndex = 0;
    const tail = text.slice(m.index + m[0].length);
    const e = re.exec(tail);
    if (e) end = Math.min(end, m.index + m[0].length + e.index);
  }
  return { start: m.index, bodyStart: m.index + m[0].length, end };
}

// ---------------------------------------------------------------- field parsers

function parseAttacks(value, isRanged) {
  const out = [];
  splitOr(value).forEach((alt, group) => {
    for (const part of splitTop(alt, ',')) {
      const rm = /^range\s+(\d+)\s*(?:ft|feet)\.?$/i.exec(part);
      const prev = out[out.length - 1];
      if (rm && isRanged && prev && prev.group === group) { prev.range = Number(rm[1]); continue; }
      const a = parseAttack(part, isRanged);
      if (a) { a.group = group; out.push(a); }
    }
  });
  return out;
}

function singular(name) {
  if (/hooves$/.test(name)) return name.replace(/hooves$/, 'hoof');
  if (/[^s]s$/.test(name) && !/(?:ss|us|is)$/.test(name)) return name.slice(0, -1);
  return name;
}

function parseAttack(part, isRanged) {
  let s = part.trim();
  if (!s) return null;
  let count = 1;
  const cm = /^(\d+)\s+(?=[a-z])/i.exec(s);
  if (cm && !/^\d+\s*d\d/.test(s)) { count = Number(cm[1]); s = s.slice(cm[0].length); }
  const m = /^(.*?)\s+([+-]\d+(?:\s*\/\s*[+-]\d+)*)\s*(touch)?\s*(?:\((.*)\))?$/.exec(s)
    || /^(.*?)()\s*(touch)?\s*\((.*)\)$/.exec(s);
  if (!m) return { name: s, count, bonus: [], damage: '', damageAvg: null, crit: '', extra: '', touch: false, ...(isRanged ? { range: null } : {}) };
  let name = m[1].trim();
  if (count > 1) name = singular(name);
  const bonus = m[2] ? m[2].split('/').map((b) => signed(b)) : [];
  const inner = (m[4] || '').trim();
  let damage = '', crit = '', extra = inner;
  const dm = /^(\d+d\d+(?:\s*[+-]\s*\d+(?!d))?|\d+(?![\d/d]))/.exec(inner);
  if (dm) {
    damage = dm[1].replace(/\s+/g, '');
    extra = inner.slice(dm[0].length);
    const crm = /^\s*\/\s*(\d+-\d+(?:\s*\/\s*x\d)?|x\d)/.exec(extra);
    if (crm && crm[1]) { crit = crm[1].replace(/\s+/g, ''); extra = extra.slice(crm[0].length); }
    extra = extra.trim().replace(/^plus\s+/, '');
  }
  const a = { name, count, bonus, damage, damageAvg: parseDiceAvg(damage), crit, extra, touch: !!m[3] || /(?:^|\s)touch$/.test(name) };
  if (isRanged) {
    const rm = /range\s+(\d+)\s*ft/.exec(inner) || /(\d+)[- ]ft\.? range/.exec(inner);
    a.range = rm ? Number(rm[1]) : null;
  }
  return a;
}

/** Drop the ;/,-separated parts of `s` that fail `keep`, leaving the rest joined as they were. */
function keepParts(s, keep) {
  let out = '';
  let sep = '';
  for (const tok of s.split(/\s*([;,])\s*/)) {
    if (tok === ';' || tok === ',') { sep = tok; continue; }
    const t = tok.trim();
    if (t && keep(t)) out += (out ? `${sep} ` : '') + t;
  }
  return out;
}

function parseSpellItem(raw) {
  let s = raw.trim();
  const spell = { name: '', dc: null, count: 1, note: '' };
  const pm = /^(.*?)\s*\((.*)\)\s*([A-Z])?$/.exec(s);
  let marker = '';
  if (pm) {
    s = pm[1];
    marker = pm[3] || '';
    const inner = pm[2];
    const dc = /DC\s*(\d+)/.exec(inner);
    if (dc) spell.dc = Number(dc[1]);
    const cnt = /^(\d+)(?=\s*(?:,|;|$))/.exec(inner.trim());
    if (cnt) spell.count = Number(cnt[1]);
    spell.note = keepParts(inner, (x) => !/^DC\s*\d+$/.test(x) && !/^\d+$/.test(x));
  }
  // Superscript markers survive a copy as a trailing capital: "true strikeD".
  const mk = /^(.*[a-z)])\s?([DSB])$/.exec(s);
  if (mk) { s = mk[1]; marker = marker || mk[2]; }
  spell.name = s.trim();
  if (marker === 'D') spell.domain = true;
  if (marker === 'S') spell.school = true;
  if (marker === 'B') spell.bloodline = true;
  return spell;
}

function parseCasterHeader(value) {
  const hm = /^\(([^)]*)\)/.exec(value);
  const head = hm ? hm[1] : '';
  const cl = /CL\s*(\d+)/.exec(head);
  const conc = /concentration\s*([+-]\d+)/.exec(head);
  // Whatever else the header says: "+7 touch" in "(CL 8th, +7 touch)".
  const notes = keepParts(head, (x) => !/^CL\s*\d/.test(x) && !/^concentration\b/.test(x));
  return { cl: cl ? Number(cl[1]) : null, concentration: conc ? signed(conc[1]) : null, notes, rest: hm ? value.slice(hm[0].length) : value };
}

const FREQ_RE = /(?<=^|\s)(Constant|At[- ]will|\d+\s*\/\s*(?:day|week|month|year|hour|round|minute)|\d+\s+(?:rounds|minutes|hours)\s*\/\s*day)(?:\s*\(([^)]*)\))?\s*[—-]\s*/gi;

function parseSla(value) {
  const { cl, concentration, notes, rest } = parseCasterHeader(value);
  const entries = [];
  const marks = [...rest.matchAll(FREQ_RE)];
  marks.forEach((m, i) => {
    const body = rest.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : rest.length);
    const freq = m[1].toLowerCase().replace(/\s+/g, '').replace('atwill', 'at will').replace('at-will', 'at will');
    entries.push({ freq, spells: splitTop(body, ',').map(parseSpellItem) });
  });
  return { cl, concentration, ...(notes ? { notes } : {}), entries };
}

const LEVEL_RE = /(?<=^|\s)([0-9])(?:st|nd|rd|th)?\s*(?:\(([^)]*)\))?\s*[—-]\s*(?=\S)/g;

function parseSpellBlock(label, value) {
  const { cl, concentration, notes, rest } = parseCasterHeader(value);
  const kind = /Known/.test(label) ? 'known' : 'prepared';
  const cn = /^(.*?)\s*(?:Spells|Extracts)/.exec(label);
  const block = { kind, className: cn ? cn[1].trim() : '', cl, concentration, ...(notes ? { notes } : {}), levels: [] };
  const marks = [...rest.matchAll(LEVEL_RE)];
  marks.forEach((m, i) => {
    const body = rest.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : rest.length);
    let perDay = null;
    if (m[2]) {
      const pd = /(\d+)\s*\/\s*day/.exec(m[2]);
      perDay = pd ? Number(pd[1]) : (/at will/i.test(m[2]) ? 'at will' : m[2].trim());
    } else if (m[1] === '0' && kind === 'prepared') perDay = null;
    block.levels.push({ level: Number(m[1]), perDay, spells: splitTop(body, ',').map(parseSpellItem) });
  });
  return block;
}

// A Title Case run ending right before the marker: "Immunity to Magic", "Breath Weapon".
const SA_TITLE = /(?:^|[\s.])([A-Z][\w'-]*(?:\s+(?:[A-Z][\w'-]*|of|the|and|or|a|an|in|to|with|from|on|vs\.|\d+|\([^)]*\)))*)\s*$/;

function parseSpecialAbilities(region) {
  const out = [];
  if (!region) return out;
  const flat = region.replace(/\s+/g, ' ');
  // Each "(Ex)" marker; its name is what sits between it and the end of the
  // sentence before. A short run is taken whole, so d20pfsrd's "Breath weapon
  // (Su)" keeps its lowercase word; a long one ("... uses its grab (Ex)") is a
  // reference inside prose unless a Title Case name ends it.
  const marks = [];
  for (const m of flat.matchAll(/\s*\((Ex|Su|Sp)\)\s*:?\s*/g)) {
    const base = marks.length ? marks[marks.length - 1].bodyStart : 0;
    const before = flat.slice(base, m.index);
    const tail = /[^.!?:]*$/.exec(before)[0];
    let name = tail.trim();
    let start = m.index - tail.trimStart().length;
    if (!/^[A-Z]/.test(name) || name.split(/\s+/).length > 6) {
      const t = SA_TITLE.exec(before);
      if (!t) continue;
      name = t[1];
      start = base + before.lastIndexOf(name);
    }
    marks.push({ name, kind: m[1], start, bodyStart: m.index + m[0].length });
  }
  marks.forEach((mk, i) => {
    const text = flat.slice(mk.bodyStart, i + 1 < marks.length ? marks[i + 1].start : flat.length).trim();
    const dc = /DC\s*(\d+)/.exec(text) || /\bsave\s+(?:Fort|Ref|Will)\w*\s+(\d+)/.exec(text);
    out.push({ name: mk.name, kind: mk.kind, text, dc: dc ? Number(dc[1]) : null });
  });
  return out;
}

function titleCaseIfShouting(s) {
  if (/[a-z]/.test(s) || !/[A-Z]{2}/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function parseCR(s) {
  const m = /^(\d+)(?:\s*\/\s*(\d+))?/.exec(s);
  if (!m) return null;
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}

// ---------------------------------------------------------------- main

export function parsePf1(input) {
  const c = emptyCreature();
  c.raw = String(input ?? '');
  let text = normalize(input);
  if (!text) return c;

  // Special abilities: everything after the header, up to DESCRIPTION (or an
  // ECOLOGY that comes after it, as in some later bestiaries).
  let saText = '';
  const sa = findRegion(text, /(?<=^|\s)(?:SPECIAL\s+ABILITIES\b|Special Abilities(?=\n))/, [/(?<=^|\s)(?:DESCRIPTION|ECOLOGY)\b/, /\nDescription\n/]);
  if (sa) {
    saText = text.slice(sa.bodyStart, sa.end);
    text = text.slice(0, sa.start) + '\n\n' + text.slice(sa.end);
  }
  if (!sa && /^[A-Z][^()]{0,60}\((?:Ex|Su|Sp)\)/.test(text) && !scanLabels(text).some((h) => h.start === 0)) {
    // No header, and it opens with "Stench (Ex)": the whole paste is special abilities.
    c.specialAbilities = parseSpecialAbilities(text);
    return c;
  }
  const desc = /(?<=^|\s)DESCRIPTION\b|\nDescription\n/.exec(text);
  if (desc) text = text.slice(0, desc.index);

  // Tactics: prose that repeats labels. Ends where STATISTICS (or Str) starts.
  const tac = findRegion(text, /(?<=^|\s)(?:TACTICS\b|Tactics(?=\n)|Before\s+Combat\s|During\s+Combat\s|Morale\s|Base\s+Statistics\s)/,
    [/(?<=^|\s)(?:STATISTICS\b|Statistics(?=\n))/, /(?<=^|\s)Str\s+(?:\d+|—|-)\s*,?\s*Dex/]);
  if (tac) {
    c.tactics = squash(text.slice(tac.start, tac.end).replace(/^(?:TACTICS|Tactics)\s*/, ''));
    text = text.slice(0, tac.start) + '\n\n' + text.slice(tac.end);
  }

  const hits = scanLabels(text);
  const first = (k) => hits.find((h) => h.key === k);
  const val = (k) => first(k)?.value ?? null;

  // ---- title: name + CR
  const crHit = first('cr');
  let headerRest = '';
  if (crHit) {
    let pre = text.slice(0, crHit.start).trim();
    if (pre.includes('\n')) pre = pre.split('\n').filter((l) => l.trim()).pop() || '';
    pre = pre.split(/(?<=[.!?])\s+/).pop();
    c.name = titleCaseIfShouting(squash(pre));
    const crm = /^(\d+(?:\s*\/\s*\d+)?)(?:\s*\/\s*MR\s*(\d+))?/.exec(crHit.value);
    if (crm) {
      c.cr = parseCR(crm[1]);
      if (crm[2]) c.mr = Number(crm[2]);
      headerRest += ' ' + crHit.value.slice(crm[0].length);
    }
  } else {
    // No CR at all: the name is whatever comes before the first label on the
    // first line, and nothing when a label opens the paste ("Melee bite +9 ...").
    const firstStart = hits.length ? hits[0].start : text.length;
    c.name = titleCaseIfShouting(squash(text.slice(0, firstStart).split('\n')[0]));
  }
  if (c.type === 'dragon' || /\bdragon\b/i.test(c.name)) {
    const age = new RegExp(`(?:^|,\\s*)(${DRAGON_AGES.join('|')})\\b`, 'i').exec(c.name);
    if (age) c.ageCategory = age[1].toLowerCase();
  }
  const src = val('source');
  if (src) c.source = src;
  const xp = val('xp');
  if (xp) {
    const m = /^([\d,]+)/.exec(xp);
    c.xp = m ? num(m[1]) : null;
    headerRest += ' ' + xp.slice(m ? m[0].length : 0);
  }
  headerRest = squash(headerRest);
  const alRe = new RegExp(`(?<=^|\\s)(LG|NG|CG|LN|N|CN|LE|NE|CE|Any|any|Always [LNC][GNE]?|Usually [LNC][GNE]?)\\s+(${SIZES.join('|')})\\s+(${TYPES.join('|')})(?:\\s*\\(([^)]*)\\))?`);
  const al = alRe.exec(headerRest);
  if (al) {
    c.alignment = al[1];
    c.size = al[2];
    c.type = al[3];
    c.subtypes = al[4] ? splitTop(al[4], ',') : [];
    c.classLine = headerRest.slice(0, al.index).trim();
  } else {
    c.classLine = headerRest;
  }

  // ---- init / senses / perception / aura
  const init = val('init');
  if (init != null) c.init = signed(init);
  const sensesVal = val('senses');
  const headerZone = hits.filter((h) => ['init', 'senses'].includes(h.key)).map((h) => h.value).join(' ');
  const perc = /Perception\s*([+-]?\d+)/.exec(headerZone);
  if (perc) c.perception = signed(perc[1]);
  if (sensesVal) {
    const list = sensesVal.split(/;\s*Perception/)[0];
    c.senses = splitTop(list, ',;').filter((x) => !/^Perception/.test(x)).map((x) => {
      const r = /(\d+)\s*(?:ft|feet)/.exec(x);
      return { name: x.replace(/\s*\d+\s*(?:ft|feet)\.?/, '').replace(/\s+/g, ' ').trim(), range: r ? Number(r[1]) : null };
    });
  }
  const aura = val('aura');
  if (aura) {
    c.aura = splitTop(aura, ',;').map((x) => {
      const r = /(\d+)[- ](?:ft|feet)/.exec(x);
      const dc = /DC\s*(\d+)/.exec(x);
      return { name: x.replace(/\s*\(.*$/, '').trim(), range: r ? Number(r[1]) : null, dc: dc ? Number(dc[1]) : null, text: x };
    });
  }

  // ---- defense
  const ac = val('ac');
  if (ac) {
    const m = /^(\d+)(?:\s*,?\s*touch\s+(\d+))?(?:\s*,?\s*flat-?\s*footed\s+(\d+))?/.exec(ac);
    if (m) c.ac = { total: num(m[1]), touch: num(m[2]), flatFooted: num(m[3]), components: {}, notes: '' };
    const br = /\(([^)]*)\)/.exec(ac);
    let after = m ? ac.slice(m[0].length) : '';
    if (br) {
      for (const part of splitTop(br[1], ',')) {
        const pm = /^([+-]\d+)\s+(.+)$/.exec(part);
        if (pm) c.ac.components[pm[2].toLowerCase()] = signed(pm[1]);
      }
      after = ac.slice(br.index + br[0].length);
    }
    // "(+5 armor) (+4 dodge vs. giants)" or "...; +4 dodge vs. giants"
    const notes = after.trim().replace(/^[;,]\s*/, '').replace(/^\((.*)\)$/, '$1').trim();
    if (notes) c.ac.notes = notes;
  }
  const hp = val('hp');
  if (hp) {
    const parts = splitTop(hp, ';');
    const m = /^(\d+)(\s+each)?\s*(?:\(([^)]*)\))?/.exec(parts[0]);
    if (m) {
      c.hp.total = num(m[1]);
      if (m[2]) c.hp.each = true;
      if (m[3]) {
        const inner = m[3].trim();
        const dm = /^(\d+\s*(?:HD|d\d+)(?:\s*[+-]\s*\d+(?!d))?(?:\s*\+\s*\d+d\d+(?:\s*[+-]\s*\d+(?!d))?)*)/i.exec(inner);
        c.hp.hd = dm ? dm[1].replace(/\s+/g, '') : inner;
        const extra = dm ? inner.slice(dm[0].length).trim() : '';
        if (extra) c.hp.notes = extra.replace(/^plus\s+/, '');
        const hdCount = [...c.hp.hd.matchAll(/(\d+)(?:d\d+|\s*HD)/gi)].reduce((a, x) => a + Number(x[1]), 0);
        c.hp.hitDice = hdCount || null;
      }
    }
    for (const extra of parts.slice(1)) c.defensive.other.push(...splitTop(extra, ','));
  }
  const fort = val('fort'), ref = val('ref'), will = val('will');
  if (fort != null) c.saves.fort = signed(fort);
  if (ref != null) c.saves.ref = signed(ref);
  if (will != null) {
    c.saves.will = signed(will);
    const note = will.replace(/^[+-]?\d+\s*[;,]?\s*/, '').trim();
    if (note) c.saves.notes = note;
  }
  const da = val('defensiveAbilities');
  if (da) c.defensive.other.push(...splitTop(da, ',;'));
  for (const h of hits.filter((x) => x.key === 'dr')) {
    for (const part of splitTop(h.value, ',;')) {
      const m = /^(\d+)\s*\/\s*(.+)$/.exec(part);
      if (m) c.defensive.dr.push({ amount: Number(m[1]), bypass: /^[—-]$/.test(m[2].trim()) ? '-' : m[2].trim() });
    }
  }
  const imm = val('immune');
  if (imm) c.defensive.immune = splitTop(imm, ',;');
  const res = val('resist');
  if (res) {
    c.defensive.resist = splitTop(res, ',;').map((x) => {
      const m = /^(.*?)\s+(\d+)\s*(.*)$/.exec(x);
      return m ? { type: m[1].trim(), amount: Number(m[2]), ...(m[3] ? { note: m[3] } : {}) } : { type: x, amount: null };
    });
  }
  const sr = val('sr');
  if (sr) c.defensive.sr = num(/^\d+/.exec(sr)?.[0]);
  const weak = val('weaknesses');
  if (weak) c.defensive.weaknesses = splitTop(weak, ',;');

  // ---- offense
  const speed = val('speed');
  if (speed) {
    c.speed.other = [];
    const parts = splitTop(speed, ',;');
    parts.forEach((p, i) => {
      const mode = /^(fly|swim|climb|burrow)\s+(\d+)\s*(?:ft|feet)\.?\s*(?:\(([^)]*)\))?/i.exec(p);
      if (mode) {
        const k = mode[1].toLowerCase();
        c.speed[k] = Number(mode[2]);
        if (k === 'fly' && mode[3]) {
          const man = /(clumsy|poor|average|good|perfect)/i.exec(mode[3]);
          c.speed.flyManeuver = man ? man[1].toLowerCase() : mode[3];
        }
      } else if (i === 0 && /^\d+\s*(?:ft|feet)/.test(p)) {
        c.speed.land = Number(/^\d+/.exec(p)[0]);
        const n = /\(([^)]*)\)/.exec(p);
        if (n) c.speed.notes = n[1].trim();
      } else {
        c.speed.other.push(p);
      }
    });
  }
  const melee = val('melee');
  if (melee) c.melee = parseAttacks(melee, false);
  const ranged = val('ranged');
  if (ranged) c.ranged = parseAttacks(ranged, true);
  const space = val('space');
  if (space) c.space = feet(space) ?? c.space;
  const reach = val('reach');
  if (reach) {
    c.reach = feet(reach) ?? c.reach;
    const n = /\(([^)]*)\)/.exec(reach);
    if (n) c.reachNotes = n[1];
  }
  const spa = val('specialAttacks');
  if (spa) c.specialAttacks = splitTop(spa, ',;');

  // Spell blocks, plus the trailer lines that belong to the block before them.
  let lastCaster = null;
  for (const h of hits) {
    if (h.key === 'sla') {
      const b = parseSla(h.value);
      const src2 = /^(.*?)\s*Spell-Like/.exec(h.label)[1];
      if (src2) b.source = src2;
      c.spellLikeAbilities.push(b);
    } else if (h.key === 'spells') {
      lastCaster = parseSpellBlock(h.label, h.value);
      c.spellcasting.push(lastCaster);
    } else if (lastCaster && ['domains', 'opposition', 'bloodline', 'mystery', 'patron'].includes(h.key)) {
      lastCaster[h.key] = h.key === 'bloodline' || h.key === 'mystery' || h.key === 'patron' ? h.value : splitTop(h.value, ',;');
    }
  }

  // ---- statistics
  const abil = first('abilities');
  if (abil) {
    const s = 'Str ' + abil.value;
    for (const [k, lab] of [['str', 'Str'], ['dex', 'Dex'], ['con', 'Con'], ['int', 'Int'], ['wis', 'Wis'], ['cha', 'Cha']]) {
      const m = new RegExp(`${lab}\\s+(\\d+|—|-)`).exec(s);
      c.abilities[k] = m && /\d/.test(m[1]) ? Number(m[1]) : null;
    }
  }
  const bab = val('bab'); if (bab) c.bab = signed(bab);
  const paren = (s) => (/\(([^)]*)\)/.exec(s)?.[1] ?? '').trim();
  const cmb = val('cmb');
  if (cmb && /^[+-]?\d/.test(cmb)) { c.cmb = signed(cmb); c.cmbNotes = paren(cmb); }
  const cmd = val('cmd');
  if (cmd && /^\d/.test(cmd)) { c.cmd = num(/^\d+/.exec(cmd)[0]); c.cmdNotes = paren(cmd); }
  const feats = val('feats');
  if (feats) c.feats = splitTop(feats, ',;').map((f) => f.replace(/(?<=[a-z)])[BM]$/, '').trim());
  const skills = val('skills');
  if (skills) {
    c.skills = splitTop(skills, ',;').map((x) => {
      const m = /^(.*?)\s+([+-]\d+)\s*(?:\((.*)\))?$/.exec(x);
      return m ? { name: m[1].trim(), bonus: signed(m[2]), ...(m[3] ? { note: m[3].trim() } : {}) } : { name: x, bonus: null };
    });
  }
  const rm = val('racialMods'); if (rm) c.racialMods = rm;
  const lang = val('languages');
  if (lang) {
    const [main, ...special] = splitTop(lang, ';');
    c.languages = splitTop(main || '', ',');
    c.languageSpecial = special.flatMap((x) => splitTop(x, ','));
  }
  const sq = val('sq'); if (sq) c.sq = splitTop(sq, ',;');
  const cg = val('combatGear'), og = val('otherGear') ?? val('gear');
  if (cg || og) c.gear = { combat: cg ? splitTop(cg, ',;') : [], other: og ? splitTop(og, ',;') : [] };
  const env = val('environment'), org = val('organization'), tr = val('treasure');
  if (env || org || tr) c.ecology = { environment: env || '', organization: org || '', treasure: tr || '' };

  // ---- special abilities
  c.specialAbilities = parseSpecialAbilities(saText);
  return c;
}

// ---------------------------------------------------------------- back to text

// The label the form puts in front of each section's text before re-parsing
// it: parsePf1(`${SECTION_LABELS[key]} ${formatPf1Section(c, key)}`) gives
// back c[key]. An empty label means the text carries its own labels: the
// defensive line is several fields ("DR 10/magic; Immune ...; SR 18"), and a
// creature can have more than one spell block, each with its own header.
export const SECTION_LABELS = {
  aura: 'Aura',
  senses: 'Senses',
  defensive: '',
  speed: 'Speed',
  melee: 'Melee',
  ranged: 'Ranged',
  specialAttacks: 'Special Attacks',
  spellLikeAbilities: '',
  spellcasting: '',
  feats: 'Feats',
  skills: 'Skills',
  languages: 'Languages',
  sq: 'SQ',
  specialAbilities: 'SPECIAL ABILITIES',
};

const sgn = (n) => (n < 0 ? `-${-n}` : `+${n}`);
const ordinal = (n) => {
  if (n === 0) return '0';
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};
function plural(name) {
  if (/hoof$/.test(name)) return name.replace(/hoof$/, 'hooves');
  if (/(?:s|x|ch|sh)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

function formatAttack(a) {
  const name = a.count > 1 ? `${a.count} ${plural(a.name)}` : a.name;
  const bonus = a.bonus?.length ? ' ' + a.bonus.map(sgn).join('/') : '';
  const touch = a.touch && !/(?:^|\s)touch$/.test(a.name) ? ' touch' : '';
  let inner = a.damage || '';
  if (a.crit) inner += `/${a.crit}`;
  if (a.extra) inner += inner ? ` plus ${a.extra}` : a.extra;
  let s = `${name}${bonus}${touch}${inner ? ` (${inner})` : ''}`;
  if (a.range != null && !/\brange\b|\d[- ]ft\.? range/.test(inner)) s += `, range ${a.range} ft.`;
  return s;
}

function formatAttacks(list) {
  const groups = [];
  for (const a of list || []) (groups[a.group || 0] ||= []).push(formatAttack(a));
  return groups.filter(Boolean).map((g) => g.join(', ')).join(' or ');
}

function formatSpell(sp) {
  const marker = sp.domain ? 'D' : sp.school ? 'S' : sp.bloodline ? 'B' : '';
  // "burning hands (electricity; DC 15)", "cure light wounds (2)"
  const tail = [sp.count > 1 ? String(sp.count) : '', sp.dc != null ? `DC ${sp.dc}` : ''].filter(Boolean).join(', ');
  const inner = [sp.note, tail].filter(Boolean).join('; ');
  return `${sp.name}${marker}${inner ? ` (${inner})` : ''}`;
}

function casterHead(b) {
  const parts = [];
  if (b.cl != null) parts.push(`CL ${ordinal(b.cl)}`);
  if (b.concentration != null) parts.push(`concentration ${sgn(b.concentration)}`);
  if (b.notes) parts.push(b.notes);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

const FREQ_TEXT = (f) => (f === 'at will' ? 'At will' : f.charAt(0).toUpperCase() + f.slice(1));

/** One section of a parsed creature back as PF1e stat block text, without its label. */
export function formatPf1Section(c, key) {
  switch (key) {
    case 'aura':
      return (c.aura || []).map((a) => {
        if (a.text) return a.text;
        const inner = [a.range != null ? `${a.range} ft.` : '', a.dc != null ? `DC ${a.dc}` : ''].filter(Boolean).join(', ');
        return inner ? `${a.name} (${inner})` : a.name;
      }).join(', ');
    case 'senses': {
      const list = (c.senses || []).map((s) => (s.range != null ? `${s.name} ${s.range} ft.` : s.name)).join(', ');
      const perc = c.perception != null ? `Perception ${sgn(c.perception)}` : '';
      return [list, perc].filter(Boolean).join('; ');
    }
    case 'defensive': {
      const d = c.defensive || {};
      const out = [];
      if (d.other?.length) out.push(`Defensive Abilities ${d.other.join(', ')}`);
      if (d.dr?.length) out.push(`DR ${d.dr.map((r) => `${r.amount}/${r.bypass === '-' ? '—' : r.bypass}`).join(', ')}`);
      if (d.immune?.length) out.push(`Immune ${d.immune.join(', ')}`);
      if (d.resist?.length) out.push(`Resist ${d.resist.map((r) => [r.type, r.amount, r.note].filter((x) => x != null && x !== '').join(' ')).join(', ')}`);
      if (d.sr != null) out.push(`SR ${d.sr}`);
      if (d.weaknesses?.length) out.push(`Weaknesses ${d.weaknesses.join(', ')}`);
      return out.join('; ');
    }
    case 'speed': {
      const s = c.speed || {};
      const out = [];
      if (s.land != null) out.push(`${s.land} ft.${s.notes ? ` (${s.notes})` : ''}`);
      if (s.burrow != null) out.push(`burrow ${s.burrow} ft.`);
      if (s.climb != null) out.push(`climb ${s.climb} ft.`);
      if (s.fly != null) out.push(`fly ${s.fly} ft.${s.flyManeuver ? ` (${s.flyManeuver})` : ''}`);
      if (s.swim != null) out.push(`swim ${s.swim} ft.`);
      out.push(...(s.other || []));
      return out.join(', ');
    }
    case 'melee': return formatAttacks(c.melee);
    case 'ranged': return formatAttacks(c.ranged);
    case 'specialAttacks': return (c.specialAttacks || []).join(', ');
    case 'feats': return (c.feats || []).join(', ');
    case 'sq': return (c.sq || []).join(', ');
    case 'skills': {
      const list = (c.skills || []).map((s) => `${s.name}${s.bonus != null ? ` ${sgn(s.bonus)}` : ''}${s.note ? ` (${s.note})` : ''}`).join(', ');
      return [list, c.racialMods ? `Racial Modifiers ${c.racialMods}` : ''].filter(Boolean).join('; ');
    }
    case 'languages':
      return [(c.languages || []).join(', '), (c.languageSpecial || []).join(', ')].filter(Boolean).join('; ');
    case 'spellLikeAbilities':
      return (c.spellLikeAbilities || []).map((b) => [
        `${b.source ? `${b.source} ` : ''}Spell-Like Abilities${casterHead(b)}`,
        ...b.entries.map((e) => `${FREQ_TEXT(e.freq)}—${e.spells.map(formatSpell).join(', ')}`),
      ].join('\n')).join('\n');
    case 'spellcasting':
      return (c.spellcasting || []).map((b) => {
        const lines = [`${b.className ? `${b.className} ` : ''}Spells ${b.kind === 'known' ? 'Known' : 'Prepared'}${casterHead(b)}`];
        for (const lv of b.levels) {
          const pd = lv.perDay == null ? '' : lv.perDay === 'at will' ? ' (at will)' : typeof lv.perDay === 'number' ? ` (${lv.perDay}/day)` : ` (${lv.perDay})`;
          lines.push(`${ordinal(lv.level)}${pd}—${lv.spells.map(formatSpell).join(', ')}`);
        }
        if (b.domains?.length) lines.push(`Domains ${b.domains.join(', ')}`);
        if (b.opposition?.length) lines.push(`Opposition Schools ${b.opposition.join(', ')}`);
        if (b.bloodline) lines.push(`Bloodline ${b.bloodline}`);
        if (b.mystery) lines.push(`Mystery ${b.mystery}`);
        if (b.patron) lines.push(`Patron ${b.patron}`);
        return lines.join('\n');
      }).join('\n');
    case 'specialAbilities':
      return (c.specialAbilities || []).map((a) => `${a.name} (${a.kind || 'Ex'}) ${a.text}`).join('\n\n');
    default:
      throw new Error(`formatPf1Section: no section called "${key}"`);
  }
}
