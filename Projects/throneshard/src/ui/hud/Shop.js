import { el, esc, itemIcon, getItemDefs, getItemDef, fmtNum, setText, toggleClass } from '../util.js';
import { itemTooltip } from '../Tooltip.js';

// Shop: category tabs, search, item grid, recommended tab, detail pane with build path.
export class Shop {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.open = false;
    this.tab = 'rec';
    this.query = '';
    this.sel = null;
    this.node = el('div', 'hud-shop panel-frame', `
      <div class="sh-head">
        <div class="sh-title"><i class="i-shop"></i>Shop</div>
        <input class="sh-search" type="text" placeholder="Search items…" spellcheck="false">
        <div class="sh-gold"><i class="i-gold"></i><b>0</b></div>
        <button class="md-x sh-close" title="Close (F4)">✕</button>
      </div>
      <div class="sh-tabs"></div>
      <div class="sh-status"></div>
      <div class="sh-grid"></div>
      <div class="sh-detail"></div>`);
    this.tabsEl = this.node.querySelector('.sh-tabs');
    this.grid = this.node.querySelector('.sh-grid');
    this.detail = this.node.querySelector('.sh-detail');
    this.goldEl = this.node.querySelector('.sh-gold b');
    this.status = this.node.querySelector('.sh-status');
    this.search = this.node.querySelector('.sh-search');
    this.search.addEventListener('input', () => { this.query = this.search.value.trim().toLowerCase(); this.renderGrid(); });
    this.search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { this.search.blur(); this.toggle(false); } if (e.key === 'Enter') { const f = this.grid.querySelector('.sh-item'); if (f) this.buy(f.dataset.id); } });
    this.search.addEventListener('keyup', (e) => e.stopPropagation());
    this.node.querySelector('.sh-close').onclick = () => this.toggle(false);
    this.node.addEventListener('contextmenu', (e) => e.preventDefault());
    this.node.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  // Normalize categories from items module into [{id, name, items:[ids]}]
  categories() {
    const defs = getItemDefs(this.game);
    let raw = null;
    try { raw = this.game.items?.getShopCategories?.(); } catch { raw = null; }
    const out = [];
    const byCat = (cat) => Object.values(defs).filter((d) => d.category === cat && d.purchasable !== false && !d.hidden).map((d) => d.id);
    if (Array.isArray(raw)) {
      for (const c of raw) {
        if (typeof c === 'string') out.push({ id: c, name: c, items: byCat(c) });
        else if (c) out.push({ id: c.id ?? c.name, name: c.name ?? c.id, items: c.items ?? byCat(c.id ?? c.name), icon: c.icon });
      }
    } else if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) out.push({ id: k, name: typeof v === 'object' && !Array.isArray(v) ? v.name ?? k : k, items: Array.isArray(v) ? v : v.items ?? byCat(k) });
    }
    if (!out.length) {
      const cats = [...new Set(Object.values(defs).map((d) => d.category ?? 'misc'))];
      for (const c of cats) out.push({ id: c, name: c, items: Object.values(defs).filter((d) => (d.category ?? 'misc') === c && d.purchasable !== false && !d.hidden).map((d) => d.id) });
    }
    return out.map((c) => ({ ...c, name: pretty(c.name) }));
  }

  recommended() {
    const h = this.game.player.hero;
    let r = null;
    try { r = this.game.items?.recommendedItems?.(h?.heroId, h); } catch { r = null; }
    if (!r) return [];
    // may be flat list or {phase: [ids]}
    if (Array.isArray(r)) return typeof r[0] === 'object' && r[0]?.items ? r : [{ name: 'Recommended', items: r }];
    return Object.entries(r).filter(([k, v]) => k !== 'all' && Array.isArray(v) && v.length).map(([k, v]) => ({ name: pretty(k), items: v }));
  }

  buildTabs() {
    this.cats = this.categories();
    const tabs = [{ id: 'rec', name: 'Recommended' }, ...this.cats.map((c) => ({ id: c.id, name: c.name }))];
    if (!tabs.some((t) => t.id === this.tab)) this.tab = 'rec';
    this.tabsEl.innerHTML = tabs.map((t) => `<button class="sh-tab ${t.id === this.tab ? 'on' : ''}" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('');
    this.tabsEl.querySelectorAll('.sh-tab').forEach((b) => b.onclick = () => {
      this.tab = b.dataset.id;
      this.tabsEl.querySelectorAll('.sh-tab').forEach((x) => x.classList.toggle('on', x === b));
      this.ui.sfx('click');
      this.renderGrid();
    });
  }

  buildsInto(id) {
    const r = this.game.items?.getBuildsInto?.(id);
    if (Array.isArray(r)) return r;
    return Object.values(getItemDefs(this.game)).filter((d) => d.components?.includes(id)).map((d) => d.id);
  }

  itemCell(id) {
    const d = getItemDef(this.game, id);
    if (!d) return '';
    return `<div class="sh-item ${this.sel === id ? 'sel' : ''} ${d.shop === 'secret' ? 'secret' : ''}" data-id="${esc(id)}">
      <div class="sh-ic">${itemIcon(this.game, d)}</div><div class="sh-cost">${d.cost ?? ''}</div></div>`;
  }

  renderGrid() {
    const defs = getItemDefs(this.game);
    let html = '';
    if (this.query) {
      const list = Object.values(defs).filter((d) => d.purchasable !== false && !d.hidden && ((d.name ?? d.id).toLowerCase().includes(this.query) || (d.description ?? '').toLowerCase().includes(this.query)))
        .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
      html = list.length ? `<div class="sh-sec"><div class="sh-sec-h">Results</div><div class="sh-items">${list.map((d) => this.itemCell(d.id)).join('')}</div></div>` : '<div class="sh-empty">No items match your search.</div>';
    } else if (this.tab === 'rec') {
      const rec = this.recommended();
      html = rec.length ? rec.map((s) => `<div class="sh-sec"><div class="sh-sec-h">${esc(s.name)}</div><div class="sh-items">${(s.items ?? []).map((id) => this.itemCell(id)).join('')}</div></div>`).join('')
        : `<div class="sh-empty">${Object.keys(defs).length ? 'No recommendations for this hero. Browse the categories above.' : 'The shop is closed — no items are available.'}</div>`;
    } else {
      const c = this.cats?.find((x) => x.id === this.tab);
      const ids = [...(c?.items ?? [])].sort((a, b) => (getItemDef(this.game, a)?.cost ?? 0) - (getItemDef(this.game, b)?.cost ?? 0));
      html = `<div class="sh-sec"><div class="sh-items">${ids.map((id) => this.itemCell(id)).join('')}</div></div>`;
    }
    this.grid.innerHTML = html;
    this.grid.querySelectorAll('.sh-item').forEach((e) => {
      const id = e.dataset.id;
      e.addEventListener('click', () => this.select(id));
      e.addEventListener('dblclick', () => this.buy(id));
      e.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.buy(id); });
      this.ui.tooltip.attach(e, () => itemTooltip(this.game, getItemDef(this.game, id), { buildsInto: this.buildsInto(id) }), 'left');
    });
    this.refreshAffordable();
  }

  select(id) {
    this.sel = id;
    this.grid.querySelectorAll('.sh-item').forEach((e) => e.classList.toggle('sel', e.dataset.id === id));
    const d = getItemDef(this.game, id);
    if (!d) { this.detail.innerHTML = ''; return; }
    const comps = d.components ?? [];
    const into = this.buildsInto(id);
    this.detail.innerHTML = `
      <div class="sd-row">
        <div class="sd-ic">${itemIcon(this.game, d)}</div>
        <div class="sd-info"><div class="sd-name">${esc(d.name ?? id)}</div><div class="sd-cost"><i class="i-gold"></i>${d.cost ?? '—'}</div></div>
        <button class="btn-buy">Buy</button>
      </div>
      ${comps.length ? `<div class="sd-build"><span class="sd-lbl">Build</span>${comps.map((c) => `<div class="sd-c" data-id="${esc(c)}">${itemIcon(this.game, c)}</div>`).join('<em>+</em>')}${d.recipeCost ? `<em>+</em><div class="sd-c recipe"><span class="ic-glyph">📜</span><b>${d.recipeCost}</b></div>` : ''}</div>` : ''}
      ${into.length ? `<div class="sd-build"><span class="sd-lbl">Into</span>${into.slice(0, 6).map((c) => `<div class="sd-c" data-id="${esc(c)}">${itemIcon(this.game, c)}</div>`).join('')}</div>` : ''}`;
    this.detail.querySelector('.btn-buy').onclick = () => this.buy(id);
    this.detail.querySelectorAll('.sd-c[data-id]').forEach((e) => {
      e.onclick = () => this.select(e.dataset.id);
      e.oncontextmenu = (ev) => { ev.preventDefault(); this.buy(e.dataset.id); };
      this.ui.tooltip.attach(e, () => itemTooltip(this.game, getItemDef(this.game, e.dataset.id)), 'top');
    });
    this.refreshAffordable();
  }

  buy(id) {
    const g = this.game, h = g.player.hero;
    if (!h) return;
    if (!g.items?.buy) return this.ui.error('The shop is unavailable');
    let r;
    try { r = g.items.buy(h, id); } catch (e) { console.warn(e); r = { ok: false, reason: 'Cannot buy that item' }; }
    if (r && r.ok === false) { this.ui.error(r.reason ?? 'Cannot buy that item'); return; }
    this.ui.sfx('buy');
    this.refreshAffordable();
    const e = this.grid.querySelector(`.sh-item[data-id="${CSS.escape(id)}"]`);
    if (e) { e.classList.remove('bought'); void e.offsetWidth; e.classList.add('bought'); }
  }

  refreshAffordable() {
    const h = this.game.player.hero;
    const gold = h?.gold ?? 0;
    for (const e of this.grid.querySelectorAll('.sh-item')) {
      const d = getItemDef(this.game, e.dataset.id);
      toggleClass(e, 'poor', (d?.cost ?? 0) > gold);
    }
    const btn = this.detail.querySelector('.btn-buy');
    if (btn && this.sel) btn.classList.toggle('poor', (getItemDef(this.game, this.sel)?.cost ?? 0) > gold);
  }

  toggle(force) {
    const open = force ?? !this.open;
    if (open === this.open) return;
    this.open = open;
    toggleClass(this.node, 'show', open);
    this.ui.bottomRight?.setShopOpen?.(open);
    if (open) {
      this.buildTabs();
      this.renderGrid();
      this.ui.sfx('shop');
    } else {
      this.search.blur();
      this.ui.tooltip.hide();
    }
  }

  update() {
    if (!this.open) return;
    const h = this.game.player.hero;
    setText(this.goldEl, fmtNum(h?.gold ?? 0));
    const inRange = this.game.items?.inShopRange ? this.game.items.inShopRange(h) : true;
    setText(this.status, inRange ? '' : 'You are not in range of a shop');
    toggleClass(this.status, 'show', !inRange);
    if ((this._aff = (this._aff ?? 0) + 1) % 5 === 0) this.refreshAffordable();
  }
}

function pretty(s) {
  s = String(s ?? '');
  return s.length ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}
