// spells.js — PF1e spell lookup and the PF1e -> PF2e spell map.
//
// Four files feed it:
//   converter-assets/data/pf1-spells.json   every PF1e spell (fetch-pf1-spells.py)
//   converter-assets/data/spell-map.json    the curated PF1e -> PF2e map
//   converter-assets/data/embeds.json       the actions PF2e spells @Embed, a
//                                           slice of data/action.json (embedSlice)
//   data/spell.json                         the Anathema Archive's PF2e spells,
//                                           read under data/README.md's contract
// The loader takes them already parsed so Node tests can hand them in from
// disk and the page can hand them in from fetch().

// "Cure Light Wounds, Mass", "mass cure light wounds" and "cure light wounds
// (mass)" all key the same. Superscript markers stat blocks carry (D for a
// domain slot, M for mythic) are the caller's to strip; see cleanSpellName.
const MODIFIERS = ['mass', 'greater', 'lesser', 'communal', 'improved', 'quickened', 'heightened'];

export function spellKey(name) {
  let n = String(name || '').toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const mods = [];
  // trailing ", mass" / " (mass)"
  for (;;) {
    const m = n.match(/^(.*?)(?:,\s*|\s*\()(mass|greater|lesser|communal|improved)\)?$/);
    if (!m) break;
    mods.unshift(m[2]);
    n = m[1].trim();
  }
  // leading "mass " / "greater "
  for (;;) {
    const m = n.match(/^(mass|greater|lesser|communal|improved) (.+)$/);
    if (!m) break;
    mods.push(m[1]);
    n = m[2];
  }
  mods.sort();
  return (mods.length ? mods.join(' ') + ' ' : '') + n.replace(/[^a-z0-9' ]/g, '').trim();
}

// A spell name as it appears in a stat block line: "dimension door (self only)",
// "fireball (DC 17)", "cure light wounds (2)", "bless^D", "haste M".
export function cleanSpellName(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/\((?:DC|dc)\s*\d+[^)]*\)/g, '');
  s = s.replace(/\(\d+\)/g, '');
  s = s.replace(/\^?[DM]$/, '');
  s = s.replace(/\s+[DM]$/, '');
  s = s.replace(METAMAGIC, '');
  return s.replace(/\s+/g, ' ').trim();
}

// Metamagic a stat block bakes into a spell's name: "quickened magic missile".
// PF2e has no metamagic on creature spells, so the prefix is dropped and
// metamagicOf() reports it for the conversion notes.
const METAMAGIC = /^(?:(?:maximized|quickened|extended|empowered|enlarged|widened|silent|still|heightened|persistent|dazing|intensified|reach|selective|bouncing|disruptive|ectoplasmic|elemental|focused|lingering|merciful|piercing|rime|sickening|thundering|toppling|threnodic|furious|burning|flaring|concussive|echoing|thanatopic|tenacious|umbral|traumatic|scarring|preferred|consecrate|fearsome|jinxed|logical|coaxing|contingent|shadow grasp|solid shadows|yai-mimic)\s+)+/i;
export function metamagicOf(raw) {
  const m = String(raw || '').trim().match(METAMAGIC);
  return m ? m[0].trim().toLowerCase() : '';
}

const stripHtml = (s, rank, embeds) => inlineRefs(withEmbeds(String(s || ''), embeds)
  .replace(/<\/p>\s*<p>/g, '\n\n')
  .replace(/<br\s*\/?>/g, '\n')
  .replace(/<hr\s*\/?>/g, '\n\n')
  .replace(/<li[^>]*>\s*/g, '\n• ')
  .replace(/<\/(?:ul|ol)>/g, '\n\n')
  .replace(/<\/t[dh]>\s*(?=<t[dh])/g, ' | ')
  .replace(/<\/tr>/g, '\n')
  .replace(/<\/(?:table|p)>/g, '\n\n')
  .replace(/<[^>]+>/g, ''), rank)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/^(• .*)\n\n(?=• )/gm, '$1\n').replace(/^(• .*)\n\n(?=• )/gm, '$1\n')
  .replace(/^(.* \| .*)\n\n(?=.* \| )/gm, '$1\n').replace(/^(.* \| .*)\n\n(?=.* \| )/gm, '$1\n')
  .trim();

// @Embed[Compendium.pf2e.actionspf2e.Item.<id> inline] prints that action's own
// description in place (Divine Dragon's Watch prints Dragon's Protection's
// trigger and effect). The spell already prints the action's name and traits
// above it. embeds is embeds.json's { id: { name, description } }; an id it
// lacks falls through to refText, which drops it.
function withEmbeds(html, embeds) {
  if (!embeds) return html;
  return html.replace(/@Embed\[Compendium\.pf2e\.\w+\.Item\.(\w+)(?: inline)?\]/g,
    (whole, id) => (embeds[id] ? embeds[id].description : whole));
}

// The actions data/spell.json embeds, by id, read from data/action.json:
// embeds.json's contents. converter-assets/vendor-embeds.mjs writes the file,
// and converter-spells.test.mjs fails when it no longer matches the Archive.
export function embedSlice(spells, actions) {
  const ids = new Set();
  for (const s of spells) {
    for (const m of (s.system.description.value || '').matchAll(/@Embed\[Compendium\.pf2e\.\w+\.Item\.(\w+)/g)) ids.add(m[1]);
  }
  const out = {};
  for (const a of actions) {
    if (ids.has(a._id)) out[a._id] = { name: a.name, description: a.system.description.value };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// Foundry's inline markup, read as the printed book would print it.
//   @UUID[Compendium.pf2e.spells-srd.Item.Heal]         Heal
//   @UUID[...]{Frightened 1}                              Frightened 1
//   @UUID[Compendium.pf2e.spell-effects.Item.Spell Effect: Shield]
//                                                         dropped: an apply-effect button
//   @Damage[(ceil(@item.level/2))[persistent,acid]]       1 persistent acid (at the spell's rank)
//   @Check[perception|dc:15]                              DC 15 Perception
//   @Template[emanation|distance:30]                      30-foot emanation
//   [[/r 1d4 #rounds]]  [[/act escape]]                   1d4   Escape
// Any of them followed by {label} reads as the label. Brackets nest (a damage
// formula carries its types in [...]), so each reference is scanned to its
// matching close rather than matched by regex.
function closeOf(s, open, depth0 = 1) {
  let depth = depth0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

function inlineRefs(s, rank) {
  let out = '';
  let i = 0;
  for (;;) {
    const at = s.slice(i).search(/@\w+\[|\[\[\//);
    if (at < 0) return out + s.slice(i);
    const start = i + at;
    out += s.slice(i, start);
    let kind, body, end;
    if (s[start] === '@') {
      kind = s.slice(start + 1, s.indexOf('[', start));
      const open = start + kind.length + 2;
      const close = closeOf(s, open);
      if (close < 0) return out + s.slice(start);
      body = s.slice(open, close);
      end = close + 1;
    } else {
      const open = start + 3;
      const close = closeOf(s, open, 2);
      if (close < 0) return out + s.slice(start);
      const cmd = s.slice(open).match(/^\w+/)[0];
      kind = '/' + cmd;
      body = s.slice(open + cmd.length, close - 1).trim();
      end = close + 1;
    }
    let label = null;
    const lab = s.slice(end).match(/^\{([^}]*)\}/);
    if (lab) { label = lab[1]; end += lab[0].length; }
    const rest = s.slice(end);
    out += label !== null ? label : refText(kind, body, rank, rest);
    i = end;
  }
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function refText(kind, body, rank, rest) {
  if (kind === 'UUID') {
    if (/Compendium\.pf2e\.(?:spell|feat)-effects\./.test(body)) return '';
    return body.replace(/^.*\.Item\./, '').replace(/^.*\./, '');
  }
  if (kind === 'Damage') {
    const parts = splitTop(body.split('|')[0]).map((inst) => damageText(inst, rank));
    return parts.join(' plus ');
  }
  if (kind === 'Check') {
    const [head, ...opts] = body.split('|');
    const kv = Object.fromEntries(opts.map((o) => [o.split(':')[0], o.split(':').slice(1).join(':')]));
    const type = head.replace(/^type:/, '');
    const dc = /^\d+$/.test(kv.dc || '') ? `DC ${kv.dc} ` : '';
    const name = type === 'flat' ? 'flat' : type.split('-').map(cap).join(' ');
    const basic = 'basic' in kv ? 'basic ' : '';
    const noun = type === 'flat' || !['fortitude', 'reflex', 'will'].includes(type) ? 'check' : 'save';
    return `${dc}${basic}${name}${/^\s*(?:check|save|saving)/i.test(rest) ? '' : ' ' + noun}`;
  }
  if (kind === 'Template') {
    const kv = Object.fromEntries(body.split('|').map((o) => o.includes(':') ? o.split(':') : ['type', o]));
    return kv.distance ? `${kv.distance}-foot ${kv.type}` : kv.type;
  }
  if (kind === '/act') return body.split(/\s/)[0].split('-').map(cap).join(' ');
  if (kind.startsWith('/')) return body.replace(/#.*$/, '').replace(/^\{(.*)\}$/, '$1').trim();
  return ''; // @Embed and anything newer: nothing a reader can use
}

// "1d4[fire],1d6[cold]" -> the comma-separated instances at bracket depth 0.
function splitTop(s) {
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[' || s[i] === '(') depth++;
    else if (s[i] === ']' || s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { parts.push(s.slice(from, i)); from = i + 1; }
  }
  parts.push(s.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// "(ceil(@item.level/2))d4[persistent,bleed]" at rank 3 -> "2d4 persistent bleed".
function damageText(inst, rank) {
  let formula = inst, types = '';
  if (inst.endsWith(']')) {
    // The types are the last top-level bracket: walk back to its opener.
    let depth = 0, j = inst.length - 1;
    for (; j >= 0; j--) {
      if (inst[j] === ']') depth++;
      else if (inst[j] === '[' && --depth === 0) break;
    }
    if (j >= 0) { formula = inst.slice(0, j); types = inst.slice(j + 1, -1); }
  }
  const words = types.split(',').map((t) => t.trim()).filter((t) => t && !/[\[\]()@]/.test(t));
  // Healing prints the amount alone: the prose already follows it with "Hit
  // Points" or "HP".
  const shown = words.includes('healing') ? [] : words;
  return [diceText(formula, rank), ...shown].join(' ');
}

// A Foundry roll formula with @item.level / @item.rank set to the spell's rank,
// folded to "NdS + C". Only numbers, + - * /, parentheses, dice and
// ceil/floor/max/min/ternary and the gte-style comparisons are read; anything
// else prints as written.
const FNS = {
  ceil: Math.ceil, floor: Math.floor, max: Math.max, min: Math.min,
  ternary: (c, a, b) => (c ? a : b),
  gte: (a, b) => +(a >= b), gt: (a, b) => +(a > b), lte: (a, b) => +(a <= b), lt: (a, b) => +(a < b), eq: (a, b) => +(a === b),
};

function diceText(formula, rank) {
  const src = formula.replace(/@item\.(?:level|rank)/g, String(rank ?? 1)).replace(/\s+/g, '');
  let p = 0;
  const peek = () => src[p];
  const fail = () => { throw new Error('formula'); };
  const konst = (v) => (Object.keys(v.dice).length ? fail() : v.c);
  const add = (a, b, sign) => {
    const dice = { ...a.dice };
    for (const [k, n] of Object.entries(b.dice)) dice[k] = (dice[k] || 0) + sign * n;
    return { c: a.c + sign * b.c, dice };
  };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = src[p++]; v = add(v, term(), op === '+' ? 1 : -1); }
    return v;
  };
  const term = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[p++];
      const r = factor();
      if (op === '/') v = { c: konst(v) / konst(r), dice: {} };
      else if (!Object.keys(r.dice).length) v = { c: v.c * r.c, dice: Object.fromEntries(Object.entries(v.dice).map(([k, n]) => [k, n * r.c])) };
      else v = { c: 0, dice: Object.fromEntries(Object.entries(r.dice).map(([k, n]) => [k, n * konst(v)])) };
    }
    return v;
  };
  const factor = () => {
    let v;
    const fn = src.slice(p).match(/^(ceil|floor|max|min|ternary|gte|gt|lte|lt|eq)\(/);
    if (fn) {
      p += fn[0].length;
      const args = [konst(expr())];
      while (peek() === ',') { p++; args.push(konst(expr())); }
      if (src[p++] !== ')') fail();
      v = { c: FNS[fn[1]](...args), dice: {} };
    } else if (peek() === '(') {
      p++; v = expr(); if (src[p++] !== ')') fail();
    } else {
      const m = src.slice(p).match(/^\d+(?:\.\d+)?/);
      if (m) { p += m[0].length; v = { c: Number(m[0]), dice: {} }; }
      else if (peek() === 'd') v = { c: 1, dice: {} };
      else fail();
    }
    if (peek() === 'd') {
      p++;
      const m = src.slice(p).match(/^\d+/) || fail();
      p += m[0].length;
      v = { c: 0, dice: { [m[0]]: konst(v) } };
    }
    return v;
  };
  try {
    const v = expr();
    if (p !== src.length) fail();
    const dice = Object.entries(v.dice).filter(([, n]) => n).sort((a, b) => b[0] - a[0]).map(([s, n]) => `${n}d${s}`);
    const c = Math.round(v.c * 100) / 100;
    if (!dice.length) return String(c);
    return dice.join(' + ') + (c > 0 ? ` + ${c}` : c < 0 ? ` - ${-c}` : '');
  } catch {
    return formula.replace(/@item\.(?:level|rank)/g, 'rank');
  }
}

// The fields of a PF2e spell this module reads. tests/converter-spells.test.mjs
// asserts each of them against the real data/spell.json, per data/README.md.
export function pf2Summary(s, embeds) {
  const sy = s.system;
  const traits = sy.traits?.value || [];
  const cantrip = traits.includes('cantrip');
  return {
    name: s.name,
    rank: cantrip ? 0 : sy.level?.value,
    cantrip,
    focus: traits.includes('focus'),
    ritual: !!sy.ritual || traits.includes('ritual'),
    rarity: sy.traits?.rarity || 'common',
    traditions: sy.traits?.traditions || [],
    traits: traits.filter((t) => t !== 'cantrip'),
    actions: sy.time?.value || '',
    range: sy.range?.value || '',
    area: sy.area ? `${sy.area.value}-foot ${sy.area.type}` : '',
    target: sy.target?.value || '',
    defense: sy.defense ? [sy.defense.save?.basic ? 'basic' : '', sy.defense.save?.statistic || sy.defense.passive?.statistic || ''].join(' ').trim() : '',
    duration: sy.duration?.value || '',
    sustained: !!sy.duration?.sustained,
    heightens: !!sy.heightening,
    remaster: !!sy.publication?.remaster,
    source: sy.publication?.title || '',
    text: stripHtml(sy.description?.value, sy.level?.value, embeds),
  };
}

export function buildSpellIndex({ pf1, pf2, map, embeds = {} }) {
  const pf1ByKey = new Map();
  for (const s of pf1) pf1ByKey.set(spellKey(s.name), s);
  const pf2ByName = new Map();
  for (const s of pf2) {
    // Where a remaster and a legacy spell share a name, keep the remaster.
    const prev = pf2ByName.get(s.name.toLowerCase());
    if (prev && prev.system.publication?.remaster && !s.system.publication?.remaster) continue;
    pf2ByName.set(s.name.toLowerCase(), s);
  }
  const mapByKey = new Map();
  for (const [k, v] of Object.entries(map.map || map)) mapByKey.set(spellKey(k), v);
  const pf1Names = pf1.map((s) => s.name).sort((a, b) => a.localeCompare(b));
  const lowerNames = pf1Names.map((n) => n.toLowerCase());
  return { pf1ByKey, pf2ByName, mapByKey, pf1Names, lowerNames, embeds };
}

// Autocomplete: names starting with the query first, then words starting
// with it, then anywhere. Case-insensitive.
export function suggest(index, query, limit = 12) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const starts = [], words = [], inside = [];
  index.lowerNames.forEach((n, i) => {
    if (n.startsWith(q)) starts.push(i);
    else if (n.includes(' ' + q) || n.includes('(' + q) || n.includes(', ' + q)) words.push(i);
    else if (n.includes(q)) inside.push(i);
  });
  return [...starts, ...words, ...inside].slice(0, limit).map((i) => index.pf1Names[i]);
}

export function findPf1(index, name) {
  if (!index) return null;
  return index.pf1ByKey.get(spellKey(cleanSpellName(name))) || null;
}

// { pf1, fit, note, targets: [pf2Summary...], missing: [names the map names
// but data/spell.json does not have] }. fit is exact|close|partial|none, or
// "unmapped" when the spell has no entry in the map at all.
export function convertSpell(index, name) {
  const key = spellKey(cleanSpellName(name));
  const pf1 = index.pf1ByKey.get(key) || null;
  const entry = index.mapByKey.get(key);
  if (!entry) {
    // No curated entry: a same-named PF2e spell is still worth offering.
    const same = index.pf2ByName.get(cleanSpellName(pf1?.name || name).toLowerCase());
    return {
      pf1, fit: same ? 'close' : 'unmapped',
      note: same ? 'Same name in PF2e; not yet checked by hand.' : '',
      targets: same ? [pf2Summary(same, index.embeds)] : [], missing: [],
    };
  }
  const targets = [], missing = [];
  for (const t of entry.to || []) {
    const s = index.pf2ByName.get(t.toLowerCase());
    if (s) targets.push(pf2Summary(s, index.embeds)); else missing.push(t);
  }
  return { pf1, fit: entry.fit, note: entry.note || '', targets, missing };
}

// The PF2e rank a converted caster should cast a spell at. A PF1e caster's
// top spell level lands on the PF2e creature's top rank and everything below
// scales with it, never below the PF2e spell's own base rank.
//   pf1Level  the spell's level in the caster's list (0 = cantrip)
//   pf1Top    the highest spell level that caster has
//   pf2Top    the converted creature's highest rank, maxRankForLevel(level)
//   baseRank  the PF2e spell's own rank (0 = cantrip)
export function rankFor({ pf1Level, pf1Top, pf2Top, baseRank }) {
  if (baseRank === 0) return 0;
  if (pf1Level === 0) return Math.max(1, baseRank);
  const top = Math.max(1, pf1Top || pf1Level);
  const scaled = Math.max(1, Math.round((pf1Level * pf2Top) / top));
  return Math.min(10, Math.max(baseRank ?? 1, scaled));
}

// A PF2e creature of level L casts up to rank ceil(L/2), 1..10.
export function maxRankForLevel(level) {
  return Math.min(10, Math.max(1, Math.ceil(level / 2)));
}
