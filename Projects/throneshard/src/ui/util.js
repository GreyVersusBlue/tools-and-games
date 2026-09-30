// Shared helpers for the UI module.

import { ITEM_DEFS } from '../gameplay/items/ItemDefs.js';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtTime(t) {
  const neg = t < 0;
  const a = Math.abs(neg ? Math.ceil(t) : Math.floor(t));
  const m = Math.floor(a / 60), s = a % 60;
  return (neg ? '-' : '') + m + ':' + String(s).padStart(2, '0');
}

export function fmtNum(n) {
  n = Math.round(n);
  return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

export const ATTR = {
  str: { name: 'Strength', short: 'STR', color: '#e2412c', glow: '#ff7a55' },
  agi: { name: 'Agility', short: 'AGI', color: '#35c94f', glow: '#7dff8f' },
  int: { name: 'Intelligence', short: 'INT', color: '#2e9be6', glow: '#7cd0ff' },
  uni: { name: 'Universal', short: 'UNI', color: '#b36ee8', glow: '#e0b0ff' },
};

export function cssColor(c, fallback = '#7a6a4a') {
  if (c == null) return fallback;
  if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0');
  if (typeof c === 'object' && c.getHexString) return '#' + c.getHexString();
  return String(c);
}

// Deterministic hue from a string (fallback hero colors).
export function hashColor(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 38%)`;
}

export function initials(name) {
  const parts = String(name ?? '?').split(/[\s_-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : String(name ?? '?').slice(0, 2)).toUpperCase();
}

// Convert image-ish values (URL string, data URL, HTMLImageElement, canvas) to a URL string, else null.
const _urlCache = new WeakMap();
export function toImageURL(v) {
  if (!v) return null;
  if (typeof v === 'string') return isURL(v) ? v : null;
  if (typeof v === 'object') {
    if (_urlCache.has(v)) return _urlCache.get(v);
    let u = null;
    try {
      if (v instanceof HTMLImageElement) u = v.src;
      else if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) u = v.toDataURL();
      else if (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas) u = null;
      else if (v.url) u = v.url;
      else if (v.src) u = v.src;
    } catch { u = null; }
    _urlCache.set(v, u);
    return u;
  }
  return null;
}

export function isURL(s) {
  return typeof s === 'string' && (/^(data:|blob:|https?:|\/|\.\/)/.test(s) || /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(s));
}

// Icon markup: image URL → <img>, short string (emoji/glyph) → span, else initials on gradient.
export function iconHTML(icon, label, color) {
  const url = toImageURL(icon);
  if (url) return `<img class="ic-img" src="${esc(url)}" draggable="false" alt="">`;
  if (typeof icon === 'string' && icon.length && icon.length <= 4) return `<span class="ic-glyph">${esc(icon)}</span>`;
  return `<span class="ic-text" style="--ic-bg:${color ?? hashColor(label)}">${esc(initials(label))}</span>`;
}

export function getItemDefs(game) {
  const it = game.items;
  const d = it?.defs ?? it?.itemDefs ?? it?.ITEM_DEFS ?? it?.getItemDefs?.();
  if (d && Object.keys(d).length) return d;
  return ITEM_DEFS;
}

export function getItemDef(game, id) {
  if (!id) return null;
  return game.items?.getItemDef?.(id) ?? getItemDefs(game)[id] ?? null;
}

export function itemIcon(game, idOrDef) {
  const def = typeof idOrDef === 'string' ? getItemDef(game, idOrDef) : idOrDef;
  const id = typeof idOrDef === 'string' ? idOrDef : def?.id;
  let ic = null;
  try { ic = game.items?.getItemIcon?.(id); } catch { /* ignore */ }
  return iconHTML(ic ?? def?.icon, def?.name ?? id, '#3b3325');
}

export function abilityDef(game, idOrAbility) {
  if (!idOrAbility) return null;
  if (typeof idOrAbility === 'object') return idOrAbility.def ?? idOrAbility;
  try { return game.abilities?.getAbilityDef?.(idOrAbility) ?? null; } catch { return null; }
}

export function abilityIcon(def, id) {
  return iconHTML(def?.icon, def?.name ?? id, '#2c3a4a');
}

// Pretty stat names for item bonuses.
const STAT_NAMES = {
  str: 'Strength', agi: 'Agility', int: 'Intelligence', allStats: 'All Attributes', damage: 'Attack Damage',
  armor: 'Armor', maxHp: 'Health', maxMana: 'Mana', hpRegen: 'Health Regen', manaRegen: 'Mana Regen',
  attackSpeed: 'Attack Speed', moveSpeed: 'Movement Speed', magicResist: 'Magic Resistance', attackRange: 'Attack Range',
  moveSpeedPct: 'Movement Speed', damagePct: 'Damage', manaRegenPct: 'Mana Regen', hpRegenPct: 'Health Regen',
  spellAmp: 'Spell Amplification', evasion: 'Evasion', lifesteal: 'Lifesteal', castRange: 'Cast Range',
  incomingDamagePct: 'Incoming Damage', vision: 'Vision',
};
export function fmtBonus(key, v) {
  const name = STAT_NAMES[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  let val = v;
  if (/Pct$/.test(key) || key === 'magicResist' || key === 'evasion' || key === 'lifesteal' || key === 'spellAmp') val = Math.round(v * 100) + '%';
  else if (key === 'moveSpeed' || key === 'attackRange' || key === 'castRange' || key === 'vision') val = Math.round(v * 40);
  else val = Number.isInteger(v) ? v : +v.toFixed(1);
  return `${v >= 0 ? '+' : ''}${val} ${name}`;
}

export function levelValue(arr, level) {
  if (arr == null) return null;
  if (!Array.isArray(arr)) return arr;
  return arr[Math.max(0, Math.min(arr.length - 1, (level || 1) - 1))];
}

// Cached DOM writes: only touch the DOM if value changed.
export function setText(e, v) { if (e._t !== v) { e._t = v; e.textContent = v; } }
export function setHTML(e, v) { if (e._h !== v) { e._h = v; e.innerHTML = v; } }
export function setStyle(e, prop, v) {
  const k = '_s_' + prop;
  if (e[k] !== v) { e[k] = v; e.style.setProperty(prop, v); }
}
export function toggleClass(e, cls, on) {
  const k = '_c_' + cls;
  if (e[k] !== on) { e[k] = on; e.classList.toggle(cls, on); }
}

export const TEAM_NAME = { sunward: 'Sunward', duskward: 'Duskward', neutral: 'Neutral' };
