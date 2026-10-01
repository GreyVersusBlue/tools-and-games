import { toImageURL, cssColor, hashColor, initials, ATTR, esc } from './util.js';

// Portrait service: resolves hero portraits from game.models.getPortrait (sync, promise, canvas or URL) and
// falls back to a styled gradient card. Elements created via html() get upgraded when an async portrait arrives.
export class Portraits {
  constructor(game) {
    this.game = game;
    this.cache = new Map(); // heroId -> url | null | 'pending'
  }

  heroColor(def) {
    return cssColor(def?.color, null) ?? hashColor(def?.id ?? def?.name);
  }

  url(heroId) {
    if (this.cache.has(heroId)) {
      const v = this.cache.get(heroId);
      return v === 'pending' ? null : v;
    }
    const def = this.game.heroDefs?.[heroId];
    let res = null;
    try { res = this.game.models?.getPortrait?.(def?.model ?? heroId, { heroId, def }); } catch { res = null; }
    if (res && typeof res.then === 'function') {
      this.cache.set(heroId, 'pending');
      res.then((v) => {
        const u = toImageURL(v);
        this.cache.set(heroId, u);
        if (u) this.upgrade(heroId, u);
      }).catch(() => this.cache.set(heroId, null));
      return null;
    }
    const u = toImageURL(res) ?? toImageURL(def?.portrait);
    this.cache.set(heroId, u);
    return u;
  }

  // Re-query (e.g. after the models module finished loading)
  refresh() {
    for (const [id, v] of this.cache) if (v == null) this.cache.delete(id);
    for (const e of document.querySelectorAll('[data-portrait]')) {
      const u = this.url(e.dataset.portrait);
      if (u) this.apply(e, u);
    }
  }

  apply(e, u) {
    e.style.backgroundImage = `url("${u}")`;
    e.classList.add('has-img');
  }

  upgrade(heroId, u) {
    for (const e of document.querySelectorAll(`[data-portrait="${CSS.escape(heroId)}"]`)) this.apply(e, u);
  }

  // Returns HTML for a portrait box. cls adds sizing classes.
  html(heroId, cls = '') {
    const def = this.game.heroDefs?.[heroId] ?? { id: heroId, name: heroId };
    const u = this.url(heroId);
    const col = this.heroColor(def);
    const attr = ATTR[def.primary] ?? ATTR.str;
    const icon = def.icon && !toImageURL(def.icon) && String(def.icon).length <= 4 ? def.icon : '';
    const style = `--hc:${col};--ac:${attr.color};${u ? `background-image:url('${u}')` : ''}`;
    return `<div class="portrait ${cls} ${u ? 'has-img' : ''}" data-portrait="${esc(heroId)}" style="${style}">
      <span class="pt-glyph">${icon ? esc(icon) : ''}</span><span class="pt-init">${esc(initials(def.name))}</span></div>`;
  }

  // Portrait html for non-hero units (creeps, towers...)
  unitHTML(unit, cls = '') {
    if (unit?.kind === 'hero') return this.html(unit.heroId, cls);
    const glyphs = { creep: '⚔', tower: '♜', building: '🏛', neutral: '🐾', grimmaw: '🐲', summon: '✦', ward: '👁' };
    const col = unit?.team === 'sunward' ? '#35602a' : unit?.team === 'duskward' ? '#6a2a22' : '#5e4a22';
    const g = glyphs[unit?.kind] ?? '•';
    return `<div class="portrait ${cls}" style="--hc:${col};--ac:#8a7440"><span class="pt-glyph big">${g}</span><span class="pt-init"></span></div>`;
  }
}
