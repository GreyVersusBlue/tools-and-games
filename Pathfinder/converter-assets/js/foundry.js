// foundry.js — a converted creature (convert.js's output) in, a Foundry VTT
// pf2e NPC actor out, as the plain object "Import Data" reads from a JSON file.
//
// The shape is the one the pf2e system's own NPCs have in Pathfinder/data/npcs
// (copied from its compendium packs on 2026-09-09), and nothing else: a field
// that no printed NPC there carries is not written. Every number is the
// converter's own; nothing is recomputed here. A word goes into a slug field
// (trait, language, sense, immunity, weakness, resistance) only if it is in
// foundry-vocab.js, the list of slugs those NPCs use. What does not fit a
// field for certain is written into the actor's private notes as text, under
// "Not written into a field", so nothing the converter said is dropped and
// nothing is guessed. ../README.md says which fields are sure and which are a
// best reading.
//
// Pure and deterministic: the same creature gives the same bytes. Item ids are
// hashed from the creature and the item, not drawn at random.

import { VOCAB } from './foundry-vocab.js';

export const FOUNDRY_TARGET = 'Foundry VTT pf2e system, NPC actor, the shape of its compendium NPCs as of 2026-09-09';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const has = (list, x) => VOCAB[list].includes(x);

// A Foundry document id is 16 characters of [A-Za-z0-9]. Four rounds of
// FNV-1a over the seed, each salted, give 16 base-62 digits.
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function idFor(seed) {
  let out = '';
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ (round * 0x9e3779b1);
    const s = `${round}:${seed}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h >>>= 0;
    for (let k = 0; k < 4; k++) { out += B62[h % 62]; h = Math.floor(h / 62); }
  }
  return out;
}

const SIZE = { fine: 'tiny', diminutive: 'tiny', tiny: 'tiny', small: 'sm', medium: 'med', large: 'lg', huge: 'huge', gargantuan: 'grg', colossal: 'grg' };
const RARITY = ['common', 'uncommon', 'rare', 'unique'];
const TRADITIONS = ['arcane', 'divine', 'occult', 'primal'];
const DAMAGE_TYPES = ['bludgeoning', 'piercing', 'slashing', 'acid', 'cold', 'electricity', 'fire', 'sonic', 'force', 'vitality', 'void', 'spirit', 'mental', 'poison', 'bleed'];
// The Remaster's names for the languages a PF1e block lists.
const LANGUAGE = {
  abyssal: 'chthonian', infernal: 'diabolic', celestial: 'empyrean', giant: 'jotun', terran: 'petran', auran: 'sussuran',
  ignan: 'pyric', aquan: 'thalassic', sylvan: 'fey', undercommon: 'sakvroth', druidic: 'wildsong', gnoll: 'kholo',
  gnome: 'gnomish', orc: 'orcish', daemonic: 'daemonic',
};
const SKILLS = ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature',
  'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery'];
// Strike riders with an attack effect of the same name in the system.
const ATTACK_EFFECT = { grab: 'grab', knockdown: 'knockdown', push: 'push' };

export function toFoundry(o, opts = {}) {
  const left = []; // what did not fit a field: "Not written into a field"
  const renamed = []; // written, under the Remaster's word for it
  const seed = `${o.name}|${o.level.value}`;
  const items = [];
  const add = (item) => {
    item._id = idFor(`${seed}|${item.type}|${items.length}|${item.name}`);
    item.sort = (items.length + 1) * 100000;
    items.push(item);
    return item;
  };

  // ---- traits, size, rarity ----
  const traits = [];
  for (const t of o.traits) {
    const s = slugify(t);
    if (has('traits', s)) traits.push(s); else left.push(`Trait "${t}": not a trait any printed Remaster NPC carries.`);
  }
  const size = SIZE[String(o.size).toLowerCase()];
  if (!size) left.push(`Size "${o.size}": written as Medium.`);
  else if (/^(fine|diminutive|colossal)$/i.test(o.size)) renamed.push(`Size ${o.size} is ${size === 'tiny' ? 'Tiny' : 'Gargantuan'}; PF2e has nothing smaller or larger.`);

  // ---- perception and senses ----
  const senses = [], senseText = [];
  for (const raw of o.senses) {
    const m = String(raw).match(/^(.*?)(?:\s+\((precise|imprecise|vague)\))?(?:\s+(\d+) feet)?$/);
    const type = slugify(m[1]);
    if (!has('senses', type)) { senseText.push(raw); continue; }
    const s = { type };
    if (m[2]) s.acuity = m[2];
    if (m[3]) s.range = Number(m[3]);
    senses.push(s);
  }

  // ---- languages ----
  const languages = [], languageText = [];
  for (const raw of o.languages) {
    const m = String(raw).match(/^([A-Za-z' -]+?)\s*(?:\((.*)\))?$/);
    const base = m ? m[1].toLowerCase().trim() : '';
    const slug = LANGUAGE[base] || slugify(base);
    if (!m || !has('languages', slug)) { languageText.push(raw); continue; }
    if (!languages.includes(slug)) languages.push(slug);
    if (m[2]) languageText.push(`${m[1].trim()} (${m[2]})`);
    if (LANGUAGE[base] && LANGUAGE[base] !== base) renamed.push(`Language ${m[1].trim()} is ${slug}.`);
  }

  // ---- skills: the sixteen go on the actor, a Lore is an item ----
  const skills = {};
  const lores = [];
  for (const sk of o.skills) {
    const s = slugify(sk.name);
    if (SKILLS.includes(s)) skills[s] = { base: sk.value };
    else lores.push(sk);
    if (sk.note) left.push(`${sk.name} ${sk.note}: a conditional bonus, kept as PF1e wrote it.`);
  }

  // ---- immunities, weaknesses, resistances ----
  const immunities = [];
  for (const raw of o.immunities) {
    const type = slugify(raw);
    if (has('immunities', type)) immunities.push({ type });
    else left.push(`Immunity "${raw}": no immunity of that name on a printed Remaster NPC.`);
  }
  const weaknesses = [];
  for (const w of o.weaknesses) {
    const type = slugify(w.type);
    if (has('weaknesses', type)) weaknesses.push({ type, value: w.value });
    else left.push(`Weakness ${w.type} ${w.value}: no weakness of that name on a printed Remaster NPC.`);
  }
  const resistances = [];
  for (const r of o.resistances) {
    const type = slugify(r.type);
    const label = `Resistance ${r.type} ${r.value}${r.except ? ` (except ${r.except})` : ''}`;
    if (!has('resistances', type)) { left.push(`${label}: no resistance of that name on a printed Remaster NPC.`); continue; }
    const out = { type, value: r.value };
    const exceptions = String(r.except || '').split(/\s+or\s+/).map(slugify).filter(Boolean);
    if (exceptions.length) {
      if (exceptions.every((e) => has('exceptions', e))) out.exceptions = exceptions;
      else left.push(`${label}: the exception was not written; add it by hand.`);
    }
    resistances.push(out);
  }

  // ---- speeds ----
  let land = null;
  const otherSpeeds = [], speedText = [];
  for (const raw of o.speeds) {
    const m = String(raw).match(/^(?:(burrow|climb|fly|swim) )?(\d+) feet$/);
    if (!m) speedText.push(raw);
    else if (m[1]) otherSpeeds.push({ type: m[1], value: Number(m[2]) });
    else land = Number(m[2]);
  }

  // ---- hit point details: regeneration and fast healing, as print does ----
  const regen = o.defAbilities.filter((d) => /^(Regeneration|Fast Healing)/.test(d.name));
  const hpDetails = regen.map((r) => `${r.name.toLowerCase()}${r.text ? ' ' + r.text : ''}`).join(', ');

  // ---- strikes ----
  for (const s of o.strikes) {
    const m = String(s.damage).match(/^(\S+) (.+)$/);
    const itemSeed = `${seed}|strike|${items.length}|${s.name}`;
    const rolls = {};
    const text = [];
    if (m && DAMAGE_TYPES.includes(m[2])) rolls[idFor(`${itemSeed}|damage|0`)] = { damage: m[1], damageType: m[2] };
    else left.push(`${s.name} damage "${s.damage}": not written as a damage roll.`);
    const tr = [], effects = [];
    let range = null;
    for (const t of s.traits) {
      const reach = t.match(/^reach (\d+) feet$/), inc = t.match(/^range increment (\d+) feet$/);
      if (reach) tr.push(`reach-${reach[1]}`);
      else if (inc) range = { increment: Number(inc[1]), max: null };
      else if (t === 'agile' || t === 'magical') tr.push(t);
      else left.push(`${s.name}: trait "${t}" not written.`);
    }
    for (const r of s.riders) {
      const dice = String(r).match(/^(\d+d\d+(?:[+-]\d+)?) ([a-z]+)$/);
      const effect = ATTACK_EFFECT[String(r).toLowerCase()];
      if (dice && DAMAGE_TYPES.includes(dice[2])) rolls[idFor(`${itemSeed}|damage|${Object.keys(rolls).length}`)] = { damage: dice[1], damageType: dice[2] };
      else if (effect) effects.push(effect);
      else text.push(r);
    }
    if (s.kind === 'ranged' && !range) left.push(`${s.name}: a ranged Strike with no range increment in the PF1e block; it imports as a melee Strike until you give it one.`);
    add({
      name: s.name.replace(/^\w/, (c) => c.toUpperCase()), type: 'melee',
      system: {
        bonus: { value: s.bonus },
        damageRolls: rolls,
        attackEffects: { value: effects },
        traits: { value: tr },
        range,
        description: { value: text.length ? `<p>plus ${esc(text.join(' and '))}</p>` : '' },
      },
    });
  }

  // ---- spellcasting ----
  const marked = []; // partial matches, each one marked on its spell
  for (const sc of o.spellcasting) {
    const first = sc.name.split(' ')[0].toLowerCase();
    const tradition = TRADITIONS.includes(first) ? first : 'arcane';
    if (tradition !== first) left.push(`${sc.name}: tradition not recognised; written as arcane.`);
    const prepared = sc.innate ? 'innate' : /Spontaneous/.test(sc.name) ? 'spontaneous' : 'prepared';
    const entry = add({
      name: sc.name, type: 'spellcastingEntry',
      system: {
        tradition: { value: tradition },
        prepared: { value: prepared },
        spelldc: { dc: sc.dc, value: sc.attack },
        slots: {},
      },
    });
    for (const r of sc.ranks) {
      const slot = entry.system.slots[`slot${r.rank}`] = { max: 0 };
      if (prepared === 'prepared') slot.prepared = [];
      for (const sp of r.spells) {
        const full = opts.spellIndex?.pf2ByName?.get(sp.name.toLowerCase());
        // The whole spell as the Archive holds it (Foundry's own data), or the
        // few fields the converter knows when there is no index to look in.
        const system = full ? structuredClone(full.system) : {
          level: { value: sp.target?.rank || 1 },
          traits: { value: [...(sp.target?.traits || []), ...(r.rank === 0 ? ['cantrip'] : [])], rarity: sp.target?.rarity || 'common', traditions: sp.target?.traditions || [] },
          description: { value: '' },
        };
        const base = system.level.value;
        system.location = { value: entry._id };
        if (r.rank > 0 && r.rank !== base) system.location.heightenedLevel = r.rank;
        let name = sp.name;
        const perDay = String(sp.freq || '').match(/^(\d+)\/day$/);
        if (sp.freq === 'at will') name += ' (At Will)';
        else if (sp.freq === 'constant') name += ' (Constant)';
        else if (perDay) system.location.uses = { value: Number(perDay[1]), max: Number(perDay[1]) };
        else if (sp.freq) left.push(`${sp.name}: "${sp.freq}" is not a use count Foundry holds; track it by hand.`);
        if (sp.fit === 'partial') {
          name += ' [partial match]';
          const line = `Partial match for PF1e ${sp.pf1}${sp.note ? ': ' + sp.note : '.'}`;
          system.description = { ...system.description, value: `<p><strong>${esc(line)}</strong></p>${system.description?.value ? '\n<hr />\n' + system.description.value : ''}` };
          marked.push(`${sp.name} (${sc.name}, for PF1e ${sp.pf1})${sp.note ? ': ' + sp.note : ''}`);
        }
        if (!full) left.push(`${sp.name}: no spell data to copy, so it is a name and a rank only; drag the real spell over it.`);
        const item = add({ name, type: 'spell', system });
        const n = Math.max(1, sp.count || 1);
        if (prepared === 'prepared') for (let i = 0; i < n; i++) slot.prepared.push({ id: item._id });
      }
      if (prepared === 'prepared') slot.max = slot.prepared.length;
      else if (prepared === 'spontaneous' && r.slots) { slot.max = r.slots; slot.value = r.slots; }
      else delete entry.system.slots[`slot${r.rank}`];
    }
  }

  // ---- lores ----
  for (const sk of lores) add({ name: sk.name, type: 'lore', system: { mod: { value: sk.value } } });

  // ---- abilities, as passive or activated action items ----
  const ability = (a, category) => {
    const tr = [];
    for (const t of a.traits || []) {
      const s = slugify(t);
      if (has('actionTraits', s)) tr.push(s); else left.push(`${a.name}: trait "${t}" not written.`);
    }
    const n = Number(a.actions);
    const reaction = a.name === 'Reactive Strike';
    add({
      name: a.name, type: 'action',
      system: {
        actionType: { value: reaction ? 'reaction' : n >= 1 && n <= 3 ? 'action' : 'passive' },
        actions: { value: !reaction && n >= 1 && n <= 3 ? n : null },
        category,
        traits: { value: tr },
        description: { value: a.text ? `<p>${esc(a.text)}</p>` : '' },
      },
    });
  };
  for (const d of o.defAbilities) ability(d, 'defensive');
  for (const a of o.offAbilities) ability(a, 'offensive');
  for (const a of o.otherAbilities) ability(a, 'offensive');

  // ---- notes ----
  const ul = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const notes = [`<p>Converted from a First Edition stat block by the Conversion Codex (greyversusblue.com). Target: ${esc(FOUNDRY_TARGET)}.</p>`];
  if (marked.length) notes.push(`<h3>Partial spell matches</h3><p>Each is marked [partial match] on the sheet. Read the PF2e spell before you cast it.</p>${ul(marked)}`);
  if (left.length) notes.push(`<h3>Not written into a field</h3>${ul(left)}`);
  if (renamed.length) notes.push(`<h3>Written under its Remaster name</h3>${ul(renamed)}`);
  const conv = [...o.notes.map((n) => n.text), ...o.spellNotes.map((s) => `${s.pf1}: ${s.note}`)];
  if (conv.length) notes.push(`<h3>Conversion notes</h3>${ul(conv)}`);

  return {
    name: o.name,
    type: 'npc',
    system: {
      abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => [k, { mod: o.attrs[k].value }])),
      attributes: {
        ac: { value: o.ac.value, details: '' },
        allSaves: { value: o.saveNote || '' },
        hp: { value: o.hp.value, max: o.hp.value, temp: 0, details: hpDetails },
        speed: { value: land, otherSpeeds, details: speedText.join(', ') },
        immunities, weaknesses, resistances,
      },
      details: {
        level: { value: o.level.value },
        languages: { value: languages, details: languageText.join(', ') },
        blurb: '',
        publicNotes: '',
        privateNotes: notes.join('\n'),
      },
      initiative: { statistic: 'perception' },
      perception: { mod: o.perception.value, details: senseText.join(', '), senses },
      saves: {
        fortitude: { value: o.saves.fort.value, saveDetail: '' },
        reflex: { value: o.saves.ref.value, saveDetail: '' },
        will: { value: o.saves.will.value, saveDetail: '' },
      },
      skills,
      traits: { value: traits, rarity: RARITY.includes(o.rarity) ? o.rarity : 'common', size: { value: size || 'med' } },
    },
    items,
    prototypeToken: { name: o.name },
  };
}

// The text of the file the page downloads, and a name for it.
export const toFoundryJson = (o, opts) => JSON.stringify(toFoundry(o, opts), null, 2) + '\n';
export const foundryFileName = (o) => `${slugify(o.name) || 'creature'}.foundry-npc.json`;
