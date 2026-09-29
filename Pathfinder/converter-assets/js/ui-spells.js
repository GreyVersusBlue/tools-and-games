// ui-spells.js — the Spells tab: PF1e autocomplete and the PF2e equivalent.

import { suggest, findPf1, convertSpell } from './spells.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const FIT_TEXT = {
  exact: 'Direct equivalent',
  close: 'Close equivalent',
  partial: 'Partial: covers some of it',
  none: 'No PF2e equivalent',
  unmapped: 'Not in the map yet',
};

export const ACTIONS = { '1': '◆', '2': '◆◆', '3': '◆◆◆', 'reaction': '⟲', 'free': '◇', '1 to 3': '◆ to ◆◆◆', '1 or 2': '◆ or ◆◆', '2 or 3': '◆◆ or ◆◆◆' };
export const actionGlyph = (a) => ACTIONS[String(a).toLowerCase()] || a;

function levelsText(levels) {
  return Object.entries(levels || {}).map(([c, l]) => `${c} ${l}`).join(', ');
}

function pf1Card(s) {
  if (!s) return '';
  const rows = [
    ['School', [s.school, s.subschool && `(${s.subschool})`, s.descriptors?.length && `[${s.descriptors.join(', ')}]`].filter(Boolean).join(' ')],
    ['Level', levelsText(s.levels)],
    ['Casting Time', s.castingTime], ['Components', s.components],
    ['Range', s.range], ['Area', s.area], ['Target', s.target], ['Effect', s.effect],
    ['Duration', s.duration], ['Saving Throw', s.save], ['Spell Resistance', s.sr],
  ].filter(([, v]) => v);
  return `<div class="spell-card">
    <h3><span>${esc(s.name)}</span><span>Level ${esc(s.level ?? '?')}</span></h3>
    <div class="meta">${rows.map(([k, v]) => `<b>${k}</b> ${esc(v)}`).join('; ')}</div>
    <div class="meta"><i>${esc(s.source || '')}</i></div>
    <div class="body">${esc(s.description || '')}</div>
  </div>`;
}

export function pf2Card(t) {
  const rank = t.cantrip ? 'Cantrip' : t.ritual ? `Ritual ${t.rank}` : `Spell ${t.rank}`;
  const traits = [t.rarity !== 'common' ? t.rarity : null, ...t.traits].filter(Boolean);
  const rows = [
    ['Traditions', t.traditions.join(', ')],
    ['Cast', t.actions && actionGlyph(t.actions)],
    ['Range', t.range], ['Area', t.area], ['Targets', t.target],
    ['Defense', t.defense], ['Duration', (t.sustained ? 'sustained ' : '') + (t.duration || '')],
  ].filter(([, v]) => v && String(v).trim());
  return `<div class="spell-card">
    <h3><span>${esc(t.name)}</span><span>${rank}</span></h3>
    <div class="sb-traits">${traits.map((x) => `<span class="trait${x === t.rarity ? ' rarity-' + x : ''}">${esc(x)}</span>`).join('')}</div>
    <div class="meta">${rows.map(([k, v]) => `<b>${k}</b> ${esc(v)}`).join('; ')}</div>
    <div class="meta"><i>${esc(t.source)}${t.remaster ? '' : ' (legacy)'}</i></div>
    <div class="body">${esc(t.text)}</div>
  </div>`;
}

export function initSpells(getIndex) {
  const q = $('spell-q'), list = $('spell-suggest');
  let active = -1, items = [];
  const recent = [];

  function close() { list.hidden = true; q.setAttribute('aria-expanded', 'false'); active = -1; }
  function render() {
    const index = getIndex();
    if (!index) return;
    items = suggest(index, q.value, 14);
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((n, i) => {
      const s = findPf1(index, n);
      return `<li role="option" id="sug-${i}" aria-selected="${i === active}" data-name="${esc(n)}">${esc(n)}<small>${esc(s?.school || '')} ${s?.level ?? ''}</small></li>`;
    }).join('');
    list.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    q.setAttribute('aria-activedescendant', active >= 0 ? `sug-${active}` : '');
  }

  function show(name) {
    const index = getIndex();
    if (!index) return;
    const r = convertSpell(index, name);
    q.value = r.pf1?.name || name;
    close();
    $('pf1-spell').innerHTML = r.pf1 ? pf1Card(r.pf1) : `<p class="empty">No PF1e spell called “${esc(name)}”.</p>`;
    const head = `<p><span class="fit ${r.fit}">${FIT_TEXT[r.fit]}</span></p>${r.note ? `<p>${esc(r.note)}</p>` : ''}`;
    const miss = r.missing.length ? `<p class="hint">The map names ${r.missing.map(esc).join(', ')}, which the Archive's spell list does not have.</p>` : '';
    $('pf2-spell').innerHTML = head + r.targets.map(pf2Card).join('') + miss
      + (!r.targets.length && r.fit !== 'none' ? '<p class="empty">No PF2e spell on file for this one yet.</p>' : '');
    if (r.pf1) {
      const i = recent.indexOf(r.pf1.name);
      if (i >= 0) recent.splice(i, 1);
      recent.unshift(r.pf1.name);
      recent.length = Math.min(recent.length, 10);
      $('spell-recent').innerHTML = recent.map((n) => `<button type="button" data-name="${esc(n)}">${esc(n)}</button>`).join('');
      history.replaceState(null, '', '#spell/' + encodeURIComponent(r.pf1.name));
    }
  }

  q.addEventListener('input', () => { active = -1; render(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) render();
      if (!items.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
      document.getElementById(`sug-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) show(items[active]);
      else if (items[0]) show(items[0]);
      else if (q.value.trim()) show(q.value.trim());
    } else if (e.key === 'Escape') close();
  });
  q.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-name]');
    if (li) { e.preventDefault(); show(li.dataset.name); }
  });
  $('spell-recent').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-name]');
    if (b) show(b.dataset.name);
  });
  return { show };
}
