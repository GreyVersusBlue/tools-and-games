// ui-creature.js — the Creature tab: paste, form, and the PF2e stat block.
//
// The form is the single source of truth. Reading a stat block fills it;
// every edit rebuilds a creature from it and converts again. Number fields
// map straight onto the schema. The longer sections are 1e text ("bite +9
// (1d8+4 plus grab), 2 claws +8 (1d6+4)"), re-read through parsePf1 with
// their label in front, so the form speaks the same language as the paste.

import { parsePf1, formatPf1Section, SECTION_LABELS } from './parse-pf1.js';
import { emptyCreature } from './pf1-schema.js';
import { convertCreature, toText, ordinal } from './convert.js';
import { toFoundryJson, foundryFileName } from './foundry.js';

// The mark on an ability no rule in abilities.js rewrote.
const PF1E_WORDING = 'Kept in its First Edition wording: no rule reads this construction, so it was not rewritten. Its DCs and action costs are converted.';
import { maxRankForLevel } from './spells.js';
import { actionGlyph, pf2Card, FIT_TEXT } from './ui-spells.js';
import { EXAMPLE } from './example.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const why = (text, w) => (w ? `<span class="why" title="${esc(w)}">${text}</span>` : text);

// [key, label, kind, width]; kind "num", "text", or "sec" (a 1e text section).
const FIELDS = [
  ['Identity', [
    ['name', 'Name', 'text', 3], ['cr', 'CR', 'text', 1], ['alignment', 'Alignment', 'text', 1], ['size', 'Size', 'text', 1],
    ['type', 'Type', 'text', 3], ['subtypes', 'Subtypes (comma separated)', 'text', 3],
    ['perception', 'Perception', 'num', 2], ['init', 'Init', 'num', 2], ['senses', 'Senses', 'sec', 6], ['aura', 'Aura', 'sec', 6],
  ]],
  ['Defense', [
    ['ac.total', 'AC', 'num', 2], ['ac.touch', 'Touch', 'num', 2], ['ac.flatFooted', 'Flat-footed', 'num', 2],
    ['hp.total', 'HP', 'num', 2], ['hp.hd', 'Hit dice', 'text', 4],
    ['saves.fort', 'Fort', 'num', 2], ['saves.ref', 'Ref', 'num', 2], ['saves.will', 'Will', 'num', 2],
    ['saves.notes', 'Save notes', 'text', 6],
    ['defensive', 'DR, immunities, resistances, SR, weaknesses', 'sec', 6],
  ]],
  ['Offense', [
    ['speed', 'Speed', 'sec', 6], ['melee', 'Melee', 'sec', 6], ['ranged', 'Ranged', 'sec', 6],
    ['space', 'Space (ft.)', 'num', 3], ['reach', 'Reach (ft.)', 'num', 3],
    ['specialAttacks', 'Special attacks', 'sec', 6],
    ['spellLikeAbilities', 'Spell-like abilities', 'sec', 6], ['spellcasting', 'Spells', 'sec', 6],
  ]],
  ['Statistics', [
    ['abilities.str', 'Str', 'num', 1], ['abilities.dex', 'Dex', 'num', 1], ['abilities.con', 'Con', 'num', 1],
    ['abilities.int', 'Int', 'num', 1], ['abilities.wis', 'Wis', 'num', 1], ['abilities.cha', 'Cha', 'num', 1],
    ['skills', 'Skills', 'sec', 6], ['feats', 'Feats', 'sec', 6], ['languages', 'Languages', 'sec', 6], ['sq', 'SQ', 'sec', 6],
  ]],
  ['Special abilities', [['specialAbilities', 'Special abilities', 'sec', 6]]],
];

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] ??= {};
  x[ks[ks.length - 1]] = v;
};
const fid = (key) => 'f-' + key.replace(/\./g, '-');

function buildForm() {
  const form = $('pf1-form');
  form.innerHTML = FIELDS.map(([legend, fields], i) => {
    const body = `<div class="form-grid">${fields.map(([key, label, kind, w]) => {
      const id = fid(key);
      const input = kind === 'sec'
        ? `<textarea id="${id}" data-key="${key}" data-kind="sec" rows="${['spellcasting', 'spellLikeAbilities', 'specialAbilities'].includes(key) ? 4 : 2}" spellcheck="false"></textarea>`
        : `<input type="${kind === 'num' ? 'number' : 'text'}" id="${id}" data-key="${key}" data-kind="${kind}">`;
      return `<div class="w${w}"><label class="lbl" for="${id}">${label}</label>${input}</div>`;
    }).join('')}</div>`;
    return i < 3 ? `<fieldset><legend>${legend}</legend>${body}</fieldset>`
      : `<details class="form-details"><summary>${legend}</summary>${body}</details>`;
  }).join('');
}

function parseCr(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const f = t.match(/^1\s*\/\s*(\d+)$/);
  if (f) return 1 / Number(f[1]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const fmtCr = (cr) => (cr == null ? '' : cr > 0 && cr < 1 ? `1/${Math.round(1 / cr)}` : String(cr));

function fillForm(c) {
  for (const el of $('pf1-form').querySelectorAll('[data-key]')) {
    const key = el.dataset.key, kind = el.dataset.kind;
    if (kind === 'sec') {
      let v = formatPf1Section(c, key) || '';
      // Perception has its own field; the senses box shouldn't repeat it.
      if (key === 'senses') v = v.replace(/;?\s*Perception\s*[+-]?\d+.*$/i, '').trim();
      el.value = v;
      continue;
    }
    let v = getPath(c, key);
    if (key === 'cr') v = fmtCr(v);
    if (key === 'subtypes') v = (v || []).join(', ');
    el.value = v ?? '';
  }
}

let base = emptyCreature();

function readForm() {
  const c = structuredClone(base);
  for (const el of $('pf1-form').querySelectorAll('[data-key]')) {
    const key = el.dataset.key, kind = el.dataset.kind, v = el.value;
    if (kind === 'num') setPath(c, key, v === '' ? null : Number(v));
    else if (key === 'cr') c.cr = parseCr(v);
    else if (key === 'subtypes') c.subtypes = v.split(',').map((s) => s.trim()).filter(Boolean);
    else if (kind === 'text') setPath(c, key, v);
    else {
      const parsed = v.trim() ? parsePf1(`${SECTION_LABELS[key]} ${v}`) : emptyCreature();
      if (key === 'defensive') c.defensive = parsed.defensive;
      else if (key === 'speed') c.speed = parsed.speed;
      else if (key === 'melee') c.melee = parsed.melee;
      else if (key === 'ranged') c.ranged = parsed.ranged;
      else if (key === 'senses') c.senses = parsed.senses;
      else if (key === 'languages') { c.languages = parsed.languages; c.languageSpecial = parsed.languageSpecial; }
      else c[key] = parsed[key];
    }
  }
  return c;
}

// ---- rendering ----
// Each spell in the block is a button; renderBlock numbers them into
// spellRefs, and the card opens in a row under the spell line (openSpell).
let spellRefs = [];

function renderBlock(o) {
  spellRefs = [];
  const traits = [
    o.rarity !== 'common' ? `<span class="trait rarity-${o.rarity}">${esc(o.rarity)}</span>` : '',
    `<span class="trait size">${esc(o.size)}</span>`,
    ...o.traits.map((t) => `<span class="trait">${esc(t)}</span>`),
  ].join('');
  const line = (label, html) => (html ? `<p class="sb-line"><b>${label}</b> ${html}</p>` : '');
  const list = (xs) => xs.join(', ');
  const top = maxRankForLevel(o.level.value);
  const spellLine = (sc) => {
    const ranks = sc.ranks.map((r) => {
      const head = r.rank === 0 ? `Cantrips (${ordinal(sc.top)})` : `${ordinal(r.rank)}${r.slots ? ` (${r.slots} slots)` : ''}`;
      const items = r.spells.map((s) => `<button type="button" class="spell-ref fit-${s.fit}" data-ref="${spellRefs.push({ ...s, rank: r.rank }) - 1}" aria-expanded="false" title="${esc(s.why)}"><i>${esc(s.name.toLowerCase())}</i></button>${s.freq && s.freq !== 'at will' ? ` (${esc(s.freq)})` : s.freq === 'at will' ? ' (at will)' : ''}${s.count > 1 ? ` (×${s.count})` : ''}`);
      return `<b>${head}</b> ${items.join(', ')}`;
    }).join('; ');
    return `<p class="sb-line"><b>${esc(sc.name)}</b> ${why(`DC ${sc.dc}`, sc.why)}, attack ${signed(sc.attack)}; ${ranks}</p>`;
  };
  const pf1Mark = (a) => (a.wording === 'pf1e' ? ` <span class="sb-pf1" title="${esc(PF1E_WORDING)}">PF1e wording</span>` : '');
  const ability = (a) => `<p class="sb-line"><b>${esc(a.name)}</b>${pf1Mark(a)}${a.actions ? ` <span class="act">${actionGlyph(a.actions)}</span>` : ''}${a.traits?.length ? ` (${esc(a.traits.join(', '))})` : ''} ${a.why ? why(esc(a.text), a.why) : esc(a.text)}</p>`;
  const regen = o.defAbilities.filter((d) => /^(Regeneration|Fast Healing)/.test(d.name));
  const hpBits = [why(`${o.hp.value}`, o.hp.why),
    ...regen.map((r) => why(esc(`${r.name.toLowerCase()}${r.text ? ' ' + r.text : ''}`), r.why)),
    o.immunities.length ? `<b>Immunities</b> ${esc(list(o.immunities))}` : '',
    o.weaknesses.length ? `<b>Weaknesses</b> ${o.weaknesses.map((w) => why(esc(`${w.type} ${w.value}`), w.why)).join(', ')}` : '',
    o.resistances.length ? `<b>Resistances</b> ${o.resistances.map((r) => why(esc(`${r.type} ${r.value}${r.except ? ` (except ${r.except})` : ''}`), r.why)).join(', ')}` : '',
  ].filter(Boolean);

  return `
    <div class="sb-head"><h3 class="sb-name">${esc(o.name)}</h3><span class="sb-kind">${why(`Creature ${o.level.value}`, o.level.why)}</span></div>
    <div class="sb-traits">${traits}</div>
    ${line('Perception', why(signed(o.perception.value), o.perception.why) + (o.senses.length ? '; ' + esc(list(o.senses)) : ''))}
    ${line('Languages', esc(list(o.languages)))}
    ${line('Skills', o.skills.map((s) => why(`${esc(s.name)} ${signed(s.value)}`, s.why)).join(', '))}
    <p class="sb-line">${['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => `<b>${k[0].toUpperCase() + k.slice(1)}</b> ${why(signed(o.attrs[k].value), o.attrs[k].why)}`).join(', ')}</p>
    <hr class="sb-rule">
    <p class="sb-line"><b>AC</b> ${why(o.ac.value, o.ac.why)}; <b>Fort</b> ${why(signed(o.saves.fort.value), o.saves.fort.why)}, <b>Ref</b> ${why(signed(o.saves.ref.value), o.saves.ref.why)}, <b>Will</b> ${why(signed(o.saves.will.value), o.saves.will.why)}${o.saveNote ? '; ' + esc(o.saveNote) : ''}</p>
    <p class="sb-line"><b>HP</b> ${hpBits.join('; ')}</p>
    ${o.defAbilities.filter((d) => !regen.includes(d)).map((d) => `<p class="sb-line"><b>${esc(d.name)}</b>${d.name === 'Reactive Strike' ? ' <span class="act">⟲</span>' : ''} ${d.why ? why(esc(d.text || ''), d.why) : esc(d.text || '')}</p>`).join('')}
    <hr class="sb-rule">
    ${line('Speed', esc(list(o.speeds)) || '—')}
    ${o.strikes.map((s) => `<p class="sb-line"><b>${s.kind === 'melee' ? 'Melee' : 'Ranged'}</b> <span class="act">◆</span> ${esc(s.name)} ${why(signed(s.bonus), s.bonusWhy)}${s.traits.length ? ` (${esc(s.traits.join(', '))})` : ''}, <b>Damage</b> ${why(esc(s.damage), s.damageWhy)}${s.riders.length ? ' plus ' + esc(s.riders.join(' and ')) : ''}</p>`).join('')}
    ${o.spellcasting.map(spellLine).join('')}
    ${o.offAbilities.map(ability).join('')}
    ${o.otherAbilities.map(ability).join('')}
  `;
}

// The PF2e spell card for a spell in the block, as a row under its line.
// One open at a time; the same spell again, the close button, or Escape shuts
// it and hands focus back to the spell.
function closeSpell(refocus) {
  const pop = $('spell-pop');
  if (!pop) return;
  const btn = document.querySelector(`#pf2-block .spell-ref[data-ref="${pop.dataset.ref}"]`);
  pop.remove();
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }
}

function openSpell(btn) {
  const was = $('spell-pop')?.dataset.ref;
  closeSpell(false);
  if (was === btn.dataset.ref) { btn.focus(); return; }
  const s = spellRefs[Number(btn.dataset.ref)];
  if (!s?.target) return;
  const t = s.target;
  const at = s.rank === 0 ? 'as a cantrip' : s.rank === t.rank ? `at rank ${s.rank}` : `at rank ${s.rank}, heightened from ${t.rank}`;
  const pop = document.createElement('div');
  pop.id = 'spell-pop';
  pop.className = 'spell-pop';
  pop.dataset.ref = btn.dataset.ref;
  pop.setAttribute('role', 'region');
  pop.setAttribute('aria-label', `${t.name}, PF2e spell card`);
  pop.tabIndex = -1;
  pop.innerHTML = `<div class="spell-pop-bar"><span><span class="fit ${s.fit}">${FIT_TEXT[s.fit] || s.fit}</span> for PF1e <i>${esc(s.pf1)}</i>; cast here ${at}.</span>`
    + `<span><a href="#spell/${encodeURIComponent(s.pf1)}">Spells tab</a> <button type="button" class="spell-pop-close" aria-label="Close ${esc(t.name)}">×</button></span></div>`
    + (s.note ? `<p class="hint">${esc(s.note)}</p>` : '') + pf2Card(t);
  btn.closest('.sb-line').after(pop);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', 'spell-pop');
  pop.focus();
}

function renderNotes(o) {
  const items = [
    ...o.notes.map((n) => `<li class="${n.warn ? 'warn' : ''}">${esc(n.text)}</li>`),
    ...o.spellNotes.map((s) => `<li class="${s.fit === 'none' || s.fit === 'unmapped' ? 'warn' : ''}"><i>${esc(s.pf1)}</i>: ${esc(s.note)}</li>`),
  ];
  return items.length ? `<h3>Conversion notes</h3><ul>${items.join('')}</ul><p class="hint">Hover any underlined number for where it came from.</p>` : '';
}

export function initCreature(getIndex) {
  buildForm();
  let last = null;
  const run = () => {
    const c = readForm();
    const hasAnything = c.name || c.cr != null || c.ac?.total != null || c.hp?.total != null;
    if (!hasAnything) {
      $('pf2-block').innerHTML = '<p class="empty">Nothing to convert yet.</p>';
      $('pf2-notes').innerHTML = '';
      last = null;
      return;
    }
    const lv = $('opt-level').value;
    try {
      last = convertCreature(c, {
        level: lv === '' ? undefined : Number(lv),
        rarity: $('opt-rarity').value,
        hp: $('opt-hp').value,
        spellIndex: getIndex(),
      });
      $('pf2-block').innerHTML = renderBlock(last);
      $('pf2-notes').innerHTML = renderNotes(last);
    } catch (err) {
      console.error(err);
      $('pf2-block').innerHTML = `<p class="empty">Could not convert: ${esc(err.message)}</p>`;
    }
  };
  const load = (text) => {
    base = parsePf1(text);
    fillForm(base);
    $('opt-level').value = '';
    run();
  };

  $('parse-btn').addEventListener('click', () => load($('pf1-paste').value));
  $('example-btn').addEventListener('click', () => { $('pf1-paste').value = EXAMPLE; load(EXAMPLE); });
  $('clear-btn').addEventListener('click', () => { $('pf1-paste').value = ''; base = emptyCreature(); fillForm(base); run(); });
  let t = null;
  $('pf1-form').addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  for (const id of ['opt-level', 'opt-rarity', 'opt-hp']) $(id).addEventListener('input', run);
  $('copy-btn').addEventListener('click', async () => {
    if (!last) return;
    try {
      await navigator.clipboard.writeText(toText(last));
      $('copy-status').textContent = 'Copied';
    } catch { $('copy-status').textContent = 'Clipboard blocked'; }
    setTimeout(() => { $('copy-status').textContent = ''; }, 1800);
  });
  $('pf2-block').addEventListener('click', (e) => {
    const ref = e.target.closest('.spell-ref');
    if (ref) openSpell(ref);
    else if (e.target.closest('.spell-pop-close')) closeSpell(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('spell-pop')) { e.preventDefault(); closeSpell(true); }
  });
  $('print-btn').addEventListener('click', () => window.print());
  // A file, not the clipboard: Foundry's Import Data reads a .json from disk.
  $('foundry-btn').addEventListener('click', () => {
    if (!last) return;
    const url = URL.createObjectURL(new Blob([toFoundryJson(last, { spellIndex: getIndex() })], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = foundryFileName(last);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('copy-status').textContent = `Saved ${a.download}`;
    setTimeout(() => { $('copy-status').textContent = ''; }, 2500);
  });
  return { rerun: run, load };
}
