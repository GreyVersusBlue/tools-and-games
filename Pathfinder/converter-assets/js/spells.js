// spells.js — PF1e spell lookup and the PF1e -> PF2e spell map.
//
// Three files feed it:
//   converter-assets/data/pf1-spells.json   every PF1e spell (fetch-pf1-spells.py)
//   converter-assets/data/spell-map.json    the curated PF1e -> PF2e map
//   data/spell.json                         the Anathema Archive's PF2e spells,
//                                           read under data/README.md's contract
// The loader takes the three already-parsed arrays so Node tests can hand them
// in from disk and the page can hand them in from fetch().

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

const stripHtml = (s) => String(s || '')
  .replace(/<\/p>\s*<p>/g, '\n\n')
  .replace(/<br\s*\/?>/g, '\n')
  .replace(/<hr\s*\/?>/g, '\n\n')
  .replace(/<[^>]+>/g, '')
  .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
  .replace(/@\w+\[([^\]|]*)(?:\|[^\]]*)?\](?:\{([^}]*)\})?/g, (_, a, b) => b || a)
  .replace(/\[\[\/\w+ ([^\]]*)\]\](?:\{([^}]*)\})?/g, (_, a, b) => b || a)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// The fields of a PF2e spell this module reads. tests/converter-spells.test.mjs
// asserts each of them against the real data/spell.json, per data/README.md.
export function pf2Summary(s) {
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
    text: stripHtml(sy.description?.value),
  };
}

export function buildSpellIndex({ pf1, pf2, map }) {
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
  return { pf1ByKey, pf2ByName, mapByKey, pf1Names, lowerNames };
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
      targets: same ? [pf2Summary(same)] : [], missing: [],
    };
  }
  const targets = [], missing = [];
  for (const t of entry.to || []) {
    const s = index.pf2ByName.get(t.toLowerCase());
    if (s) targets.push(pf2Summary(s)); else missing.push(t);
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
