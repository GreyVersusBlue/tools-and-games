import { el, esc, toggleClass } from '../util.js';
import { simpleTooltip } from '../Tooltip.js';

// Talent tree: a tree button left of the ability bar that glows when a talent can be picked, and a
// popup with the 4 tiers (25 at the top, 10 at the bottom), two options each. Hover the button to peek, click to
// pin the popup open; click an option to learn it (costs an ability point). Reads game.talents (gameplay/talents).
const TREE_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 2c-3.6 0-6.3 2.5-6.8 5.6C6.6 8.3 5 10.6 5 13.2c0 2.3 1.2 4.3 3.1 5.4-.1.4-.1.7-.1 1.1 0 3 2.5 5.3 5.6 5.3h.9V30h3v-5h.9c3.1 0 5.6-2.3 5.6-5.3 0-.4 0-.7-.1-1.1 1.9-1.1 3.1-3.1 3.1-5.4 0-2.6-1.6-4.9-4.2-5.6C22.3 4.5 19.6 2 16 2zm-1.5 10.5 1.5 3 1.5-3 1.4.9-2.9 4.8V22h-.1-.1v-3.8l-2.9-4.8z"/></svg>`;

const CSS = `
.bp-center { position: relative; }
.tal-btn { position: absolute; left: 2px; top: 34px; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; pointer-events: auto;
  display: grid; place-items: center; color: #9a8a66; background: radial-gradient(circle at 50% 35%, #2b2f36, #0c0e11 75%);
  border: 2px solid #5a4a2c; box-shadow: 0 0 0 1px #000, inset 0 0 8px rgba(0,0,0,.8); transition: color .2s, box-shadow .2s; z-index: 3; }
.tal-btn svg { width: 24px; height: 24px; }
.tal-btn .tal-pips { position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%); display: flex; gap: 2px; }
.tal-btn .tal-pips i { width: 6px; height: 4px; background: #222; border: 1px solid #000; }
.tal-btn .tal-pips i.on { background: #f1c75a; }
.tal-btn:hover { color: #f1d9a0; }
.tal-btn.avail { color: #ffe08a; border-color: #f1c75a; animation: talGlow 1.2s ease-in-out infinite; }
@keyframes talGlow { 0%,100% { box-shadow: 0 0 0 1px #000, 0 0 6px 1px rgba(255,200,80,.55); } 50% { box-shadow: 0 0 0 1px #000, 0 0 16px 5px rgba(255,210,90,.9); } }
.tal-pop { position: absolute; bottom: 166px; width: 470px; padding: 10px 10px 8px; pointer-events: auto; display: none; z-index: 30;
  background: linear-gradient(180deg, rgba(26,29,34,.97), rgba(10,12,15,.98)); border: 1px solid #6a5530;
  box-shadow: 0 8px 24px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,230,170,.12); font-family: Rajdhani, sans-serif; }
.tal-pop.show { display: block; }
.tal-pop h4 { margin: 0 0 8px; text-align: center; font: 700 14px Cinzel, serif; letter-spacing: .12em; color: #f1d9a0; text-transform: uppercase; }
.tal-pop h4 em { font-style: normal; color: #ffe08a; margin-left: 6px; font-size: 12px; }
.tal-row { display: grid; grid-template-columns: 1fr 44px 1fr; align-items: stretch; gap: 6px; margin-bottom: 6px; }
.tal-lv { display: grid; place-items: center; font: 700 15px Cinzel, serif; color: #c8a255; border: 1px solid #3a3222; background: radial-gradient(circle, #20242a, #0b0c0e); border-radius: 50%; width: 40px; height: 40px; margin: auto; }
.tal-row.locked .tal-lv { color: #666; }
.tal-opt { min-height: 40px; padding: 4px 8px; display: flex; align-items: center; font-size: 14px; font-weight: 600; line-height: 1.1; color: #b9b2a0;
  background: linear-gradient(180deg, #1c2026, #121418); border: 1px solid #333a42; cursor: default; }
.tal-opt.l { justify-content: flex-end; text-align: right; }
.tal-row.locked .tal-opt { color: #6b6b6b; }
.tal-row.avail .tal-opt { cursor: pointer; color: #efe6cf; border-color: #8a6f3a; }
.tal-row.avail .tal-opt:hover { background: linear-gradient(180deg, #3a3120, #1d1a12); color: #fff; box-shadow: 0 0 10px rgba(255,200,80,.45); }
.tal-opt.chosen { color: #ffe9a8; border-color: #f1c75a; background: linear-gradient(180deg, #4a3a18, #241c0c); box-shadow: inset 0 0 12px rgba(255,200,80,.35); }
.tal-opt.other { color: #555; text-decoration: line-through; text-decoration-color: rgba(120,120,120,.5); }
.tal-hint { text-align: center; font-size: 12px; color: #8d8672; margin-top: 2px; }
`;

export class TalentPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.pinned = false;
    this.hover = false;
    this.acc = 0;
    this.sig = '';
    if (!document.getElementById('talent-panel-css')) {
      const st = document.createElement('style');
      st.id = 'talent-panel-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const bottom = ui.bottom?.node;
    const center = bottom?.querySelector('.bp-center');
    this.btn = el('div', 'tal-btn', `${TREE_SVG}<div class="tal-pips"><i></i><i></i><i></i><i></i></div>`);
    this.pips = [...this.btn.querySelectorAll('.tal-pips i')];
    this.pop = el('div', 'tal-pop', '');
    (center ?? bottom ?? ui.hud ?? ui.root).appendChild(this.btn);
    (bottom ?? ui.hud ?? ui.root).appendChild(this.pop);
    this.btn.addEventListener('mouseenter', () => { this.hover = true; this.refresh(true); });
    this.btn.addEventListener('mouseleave', () => { this.hover = false; setTimeout(() => this.refresh(true), 120); });
    this.pop.addEventListener('mouseenter', () => { this.hover = true; });
    this.pop.addEventListener('mouseleave', () => { this.hover = false; this.refresh(true); });
    this.btn.addEventListener('mousedown', (e) => { e.stopPropagation(); this.pinned = !this.pinned; this.refresh(true); });
    this.pop.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const o = e.target.closest?.('.tal-opt');
      if (!o) return;
      const tier = +o.dataset.tier, idx = +o.dataset.idx;
      const h = this.hero;
      const r = this.game.talents?.choose?.(h, tier, idx);
      if (r?.ok) { this.ui.sfx?.('learn'); this.ui.message?.(`Talent learned: ${r.talent.name}`, '#ffd24a', 2); }
      else if (r?.reason) this.ui.error?.(r.reason);
      this.refresh(true);
    });
    ui.tooltip?.attach?.(this.btn, () => (this.open ? null : simpleTooltip('Talent Tree', 'Pick one talent at levels 10, 15, 20 and 25 (costs an ability point). Click to pin.')), 'top');
    this.refresh(true);
  }

  get hero() { const h = this.game.player?.hero; return h?.kind === 'hero' ? h : null; }
  get open() { return this.pinned || this.hover; }

  // Position the popup above the tree button (in the zoomed hud-bottom coordinate space).
  place() {
    const b = this.ui.bottom?.node;
    if (!b || this.pop.parentNode !== b) return;
    const br = b.getBoundingClientRect(), r = this.btn.getBoundingClientRect();
    const k = br.width / Math.max(1, b.offsetWidth); // zoom factor
    const x = (r.left - br.left) / k - 40;
    this.pop.style.left = `${Math.max(0, Math.min(b.offsetWidth - 470, x))}px`;
  }

  refresh(force = false) {
    const g = this.game, h = this.hero, T = g.talents;
    if (!h || !T) { this.btn.style.display = 'none'; this.pop.classList.remove('show'); return; }
    this.btn.style.display = '';
    const avail = T.available(h);
    toggleClass(this.btn, 'avail', avail.length > 0);
    T.tiers.forEach((t, i) => toggleClass(this.pips[i], 'on', h.talents?.[t] != null));
    const open = this.open;
    toggleClass(this.pop, 'show', open);
    if (!open) return;
    const tree = T.tree(h);
    const sig = `${h.heroId}|${h.level}|${h.abilityPoints}|${JSON.stringify(h.talents)}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const rows = [...T.tiers].reverse().map((tier) => {
      const chosen = h.talents?.[tier];
      const state = chosen != null ? 'done' : h.level >= tier && h.abilityPoints > 0 ? 'avail' : 'locked';
      const opt = (i) => {
        const t = tree[tier]?.[i];
        const cls = chosen == null ? '' : chosen === i ? 'chosen' : 'other';
        return `<div class="tal-opt ${i === 0 ? 'l' : 'r'} ${cls}" data-tier="${tier}" data-idx="${i}">${esc(t?.name ?? '—')}</div>`;
      };
      return `<div class="tal-row ${state}">${opt(0)}<div class="tal-lv">${tier}</div>${opt(1)}</div>`;
    }).join('');
    const pts = avail.length ? `<em>${h.abilityPoints} point${h.abilityPoints === 1 ? '' : 's'} available</em>` : '';
    this.pop.innerHTML = `<h4>${esc(h.name)} Talents${pts}</h4>${rows}<div class="tal-hint">${avail.length ? 'Choose one talent per level' : 'Talents unlock at levels 10 / 15 / 20 / 25'}</div>`;
    this.place();
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    this.refresh(false);
  }
}
