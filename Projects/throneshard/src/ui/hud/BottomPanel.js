import { el, esc, iconHTML, itemIcon, abilityIcon, levelValue, setText, setHTML, setStyle, toggleClass, ATTR, fmtNum } from '../util.js';
import { abilityTooltip, itemTooltip, simpleTooltip } from '../Tooltip.js';
import { XP_TABLE, MAX_LEVEL } from '../../core/constants.js';

const AB_KEYS = ['Q', 'W', 'E', 'R', 'D', 'F'];
const INV_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N'];
// Hotkey labels follow the player's keybinds (src/input/Keybinds.js) when available.
const abKey = (g, i) => g.input?.keyLabel?.(`ability${i + 1}`) ?? AB_KEYS[i] ?? '';
const invKey = (g, i) => g.input?.keyLabel?.(`item${i + 1}`) ?? INV_KEYS[i] ?? '';
const RING_R = 19, RING_C = 2 * Math.PI * RING_R;

export class BottomPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.unit = null;
    this.abSig = '';
    this.modSig = '';
    this.node = el('div', 'hud-bottom', `
      <div class="bp-buffs"></div>
      <div class="bp-body">
        <div class="bp-stats panel-inset">
          <div class="st-row"><i class="st-ic dmg"></i><b class="st-dmg">0</b><em class="st-dmgb"></em></div>
          <div class="st-row"><i class="st-ic arm"></i><b class="st-arm">0</b></div>
          <div class="st-row"><i class="st-ic ms"></i><b class="st-ms">0</b></div>
          <div class="st-attrs">
            <div class="st-attr" data-a="str"><i class="orb orb-str"></i><b>0</b><em></em></div>
            <div class="st-attr" data-a="agi"><i class="orb orb-agi"></i><b>0</b><em></em></div>
            <div class="st-attr" data-a="int"><i class="orb orb-int"></i><b>0</b><em></em></div>
          </div>
        </div>
        <div class="bp-portrait">
          <div class="bp-pt-wrap"></div>
          <div class="bp-name"></div>
          <div class="bp-lvl">
            <svg viewBox="0 0 44 44"><circle class="ring-bg" cx="22" cy="22" r="${RING_R}"/><circle class="ring" cx="22" cy="22" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
            <b>1</b>
          </div>
          <div class="bp-lvlup">Level Up!</div>
        </div>
        <div class="bp-center">
          <div class="bp-abilities"></div>
          <div class="bp-bars">
            <div class="bar hp"><i class="lag"></i><i class="fill"></i><span class="val"></span><span class="rg"></span></div>
            <div class="bar mp"><i class="fill"></i><span class="val"></span><span class="rg"></span></div>
          </div>
        </div>
        <div class="bp-inv">
          <div class="inv-grid"></div>
          <div class="inv-back"></div>
          <div class="inv-tp"></div>
        </div>
      </div>`);
    const q = (s) => this.node.querySelector(s);
    this.buffs = q('.bp-buffs');
    this.stats = { dmg: q('.st-dmg'), dmgb: q('.st-dmgb'), arm: q('.st-arm'), ms: q('.st-ms'), attrs: [...this.node.querySelectorAll('.st-attr')] };
    this.ptWrap = q('.bp-pt-wrap');
    this.name = q('.bp-name');
    this.lvl = q('.bp-lvl b');
    this.lvlBox = q('.bp-lvl');
    this.ring = q('.ring');
    this.lvlUp = q('.bp-lvlup');
    this.abWrap = q('.bp-abilities');
    this.hp = { fill: q('.bar.hp .fill'), lag: q('.bar.hp .lag'), val: q('.bar.hp .val'), rg: q('.bar.hp .rg') };
    this.mp = { fill: q('.bar.mp .fill'), val: q('.bar.mp .val'), rg: q('.bar.mp .rg') };
    this.mpBar = q('.bar.mp');
    this.invGrid = q('.inv-grid');
    this.invBack = q('.inv-back');
    this.invTp = q('.inv-tp');
    this.lagPct = 1;

    this.ptWrap.addEventListener('click', () => { const u = this.unit; if (u) this.game.cameraCtl?.focus?.(u.position.x, u.position.z); });
    this.ptWrap.addEventListener('dblclick', () => { const u = this.unit; if (u) this.game.cameraCtl?.lock?.(u); });
    ui.tooltip.attach(q('.bp-stats'), () => this.statsTooltip(), 'top');
    this.buildInventory();
    this.game.input?.keybinds?.onChange?.(() => this.refreshKeyLabels());
  }

  refreshKeyLabels() {
    const g = this.game;
    this.abEls?.forEach((r, i) => { const k = r.e.querySelector('.ab-key'); if (k) k.textContent = abKey(g, i); });
    this.invEls?.forEach((r, i) => { const k = r.e.querySelector('.inv-key'); if (k) k.textContent = invKey(g, i); });
    const t = this.tpEl?.querySelector('.inv-key');
    if (t) t.textContent = g.input?.keyLabel?.('tp') ?? 'T';
  }

  own() { return this.unit && this.unit === this.game.player.hero; }

  // ---------- abilities ----------
  buildAbilities() {
    const u = this.unit;
    this.abWrap.innerHTML = '';
    this.abEls = [];
    const abs = (u?.abilities ?? []).filter(Boolean);
    toggleClass(this.abWrap, 'empty', !abs.length);
    abs.forEach((ab, i) => {
      const def = ab.def ?? {};
      const passive = def.targetType === 'passive';
      const maxL = def.maxLevel ?? (def.ultimate ? 3 : 4);
      const e = el('div', `ab ${passive ? 'passive' : ''} ${def.ultimate ? 'ult' : ''}`, `
        <button class="ab-up" title="Learn ability">+</button>
        <div class="ab-frame">
          <div class="ab-ic">${abilityIcon(def, def.id)}</div>
          <div class="ab-cd"></div><div class="ab-cdt"></div>
          ${passive ? '' : `<div class="ab-key">${abKey(this.game, i)}</div>`}
          <div class="ab-mana"></div>
          <div class="ab-glow"></div>
        </div>
        <div class="ab-pips">${Array.from({ length: maxL }, () => '<i></i>').join('')}</div>`);
      const r = { ab, e, cd: e.querySelector('.ab-cd'), cdt: e.querySelector('.ab-cdt'), mana: e.querySelector('.ab-mana'), up: e.querySelector('.ab-up'), pips: [...e.querySelectorAll('.ab-pips i')], frame: e.querySelector('.ab-frame') };
      r.frame.addEventListener('click', (ev) => { ev.stopPropagation(); if (ev.ctrlKey || ev.altKey) this.pingAbility(ab); else this.castAbility(ab, i); });
      r.frame.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (def.targetType === 'toggle' || def.autocast) this.castAbility(ab, i, true); });
      r.up.addEventListener('click', (ev) => { ev.stopPropagation(); this.learn(i); });
      this.ui.tooltip.attach(r.frame, () => abilityTooltip(this.game, ab), 'top');
      this.abWrap.appendChild(e);
      this.abEls.push(r);
    });
  }

  learn(i) {
    const h = this.unit;
    if (!this.own() || !h.levelAbility) return;
    if (h.levelAbility(i)) { this.ui.sfx('learn'); this.ui.tooltip.refresh(); }
    else this.ui.error('Cannot learn that ability yet');
  }

  castAbility(ab, i, alt = false) {
    const g = this.game, h = this.unit;
    if (!this.own()) return;
    if (!h.alive) return this.ui.error('You are dead');
    if (!ab.level) return this.ui.error('Ability not learned');
    const tt = ab.def?.targetType;
    if (tt === 'passive') return this.ui.error('Ability is passive');
    if (g.input?.beginCast) { try { g.input.beginCast(ab, { alt }); } catch (e) { console.warn(e); } return; }
    if (tt === 'none' || tt === 'toggle') {
      const c = ab.canCast?.() ?? { ok: true };
      if (!c.ok) return this.ui.error(c.reason ?? 'Cannot cast');
      h.issueOrder({ type: 'cast', ability: ab });
    } else this.ui.error('Select a target');
  }

  pingAbility(ab) {
    const g = this.game;
    const ready = ab.level > 0 && !(ab.cooldownRemaining > 0);
    const txt = ready ? `${ab.def?.name} is ready` : ab.level ? `${ab.def?.name} is on cooldown (${Math.ceil(ab.cooldownRemaining)}s)` : `${ab.def?.name} is not learned`;
    this.ui.notify.chat?.(txt);
  }

  // ---------- inventory ----------
  buildInventory() {
    this.invEls = [];
    this.invGrid.innerHTML = '';
    this.invBack.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const back = i >= 6;
      const e = el('div', `inv ${back ? 'bk' : ''}`, `<div class="inv-ic"></div><div class="inv-cd"></div><div class="inv-cdt"></div>${back ? '' : `<div class="inv-key">${invKey(this.game, i)}</div>`}<div class="inv-ch"></div>`);
      e.dataset.slot = i;
      const r = { e, i, item: undefined, ic: e.querySelector('.inv-ic'), cd: e.querySelector('.inv-cd'), cdt: e.querySelector('.inv-cdt'), ch: e.querySelector('.inv-ch') };
      e.addEventListener('click', (ev) => { ev.stopPropagation(); if (!back) this.useItem(i); });
      e.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.sellItem(i); });
      e.draggable = true;
      e.addEventListener('dragstart', (ev) => {
        if (!this.own() || !this.slotItem(i)) { ev.preventDefault(); return; }
        ev.dataTransfer.setData('text/slot', String(i));
        ev.dataTransfer.effectAllowed = 'move';
        this.ui.tooltip.hide();
      });
      e.addEventListener('dragover', (ev) => { ev.preventDefault(); e.classList.add('drop'); });
      e.addEventListener('dragleave', () => e.classList.remove('drop'));
      e.addEventListener('drop', (ev) => {
        ev.preventDefault(); e.classList.remove('drop');
        const from = +ev.dataTransfer.getData('text/slot');
        if (Number.isFinite(from) && from !== i) this.swap(from, i);
      });
      this.ui.tooltip.attach(e, () => {
        const it = this.slotItem(i);
        if (!it) return null;
        const inShop = this.own() && this.game.items?.inShopRange?.(this.unit);
        return itemTooltip(this.game, it, { sellHint: this.own() ? (inShop ? 'Right-click to sell' : back ? 'Backpack items are inactive' : '') : '' });
      }, 'top');
      (back ? this.invBack : this.invGrid).appendChild(e);
      this.invEls.push(r);
    }
    this.tpEl = el('div', 'inv tp', `<div class="inv-ic"></div><div class="inv-cd"></div><div class="inv-cdt"></div><div class="inv-key">${this.game.input?.keyLabel?.('tp') ?? 'T'}</div><div class="inv-ch"></div>`);
    this.tp = { e: this.tpEl, item: undefined, ic: this.tpEl.querySelector('.inv-ic'), cd: this.tpEl.querySelector('.inv-cd'), cdt: this.tpEl.querySelector('.inv-cdt'), ch: this.tpEl.querySelector('.inv-ch') };
    this.tpEl.addEventListener('click', (ev) => { ev.stopPropagation(); this.useTp(); });
    this.ui.tooltip.attach(this.tpEl, () => {
      const it = this.tpItem();
      return it ? itemTooltip(this.game, it) : simpleTooltip('Homeward Scroll', 'Teleport to an allied structure. Purchase one from the shop.');
    }, 'top');
    this.invTp.appendChild(this.tpEl);
  }

  slotItem(i) {
    const h = this.unit;
    if (!h) return null;
    return i < 6 ? h.inventory?.[i] ?? null : h.backpack?.[i - 6] ?? null;
  }
  tpItem() {
    const h = this.unit;
    return h?.homeScroll ?? h?.tpSlot ?? h?.data?.homeScroll ?? null;
  }

  useItem(i) {
    const g = this.game, h = this.unit;
    if (!this.own()) return;
    const it = this.slotItem(i);
    if (!it) return;
    if (!h.alive) return this.ui.error('You are dead');
    if (g.input?.beginItemCast) { try { g.input.beginItemCast(i); } catch (e) { console.warn(e); } return; }
    const act = it.def?.active;
    if (!act) return this.ui.error('Item has no active ability');
    if (act.targetType === 'none' || !act.targetType) {
      const c = it.canCast?.() ?? g.items?.canUse?.(h, i) ?? { ok: true };
      if (c && c.ok === false) return this.ui.error(c.reason ?? 'Cannot use');
      if (g.items?.use) g.items.use(h, i); else h.issueOrder({ type: 'cast', ability: it });
    } else this.ui.error('Select a target');
  }
  useTp() {
    const g = this.game;
    if (!this.own()) return;
    if (!this.tpItem()) return this.ui.error('No Homeward Scroll');
    if (g.input?.beginItemCast) { try { g.input.beginItemCast('tp'); } catch (e) { console.warn(e); } }
  }

  sellItem(i) {
    const g = this.game, h = this.unit;
    if (!this.own() || !this.slotItem(i)) return;
    if (!g.items?.sell) return this.ui.error('Cannot sell items right now');
    if (g.items.inShopRange && !g.items.inShopRange(h)) return this.ui.error('Must be near a shop to sell');
    const r = g.items.sell(h, i);
    if (r && r.ok === false) this.ui.error(r.reason ?? 'Cannot sell');
    else { this.ui.sfx('sell'); this.ui.tooltip.hide(); }
  }

  swap(a, b) {
    const g = this.game, h = this.unit;
    if (!this.own()) return;
    if (g.items?.swap) { const r = g.items.swap(h, a, b); if (r && r.ok === false) this.ui.error(r.reason); return; }
    // fallback: swap directly
    const get = (i) => (i < 6 ? h.inventory[i] : h.backpack[i - 6]);
    const set = (i, v) => { if (i < 6) h.inventory[i] = v; else h.backpack[i - 6] = v; };
    const tmp = get(a); set(a, get(b)); set(b, tmp);
  }

  updateSlot(r, it, hero) {
    if (r.item !== it || r.itemId !== it?.def?.id) {
      r.item = it; r.itemId = it?.def?.id;
      setHTML(r.ic, it ? itemIcon(this.game, it.def) : r === this.tp ? '<span class="ic-glyph dim">📜</span>' : '');
      toggleClass(r.e, 'filled', !!it);
    }
    if (!it) { setStyle(r.cd, 'opacity', '0'); setText(r.cdt, ''); setText(r.ch, ''); return; }
    const cdr = it.cooldownRemaining ?? 0;
    const total = (typeof it.getCooldown === 'function' ? it.getCooldown() : levelValue(it.def?.active?.cooldown, 1)) || cdr || 1;
    if (cdr > 0) {
      const f = Math.min(1, cdr / total);
      setStyle(r.cd, 'opacity', '1');
      setStyle(r.cd, '--p', (f * 360).toFixed(0) + 'deg');
      setText(r.cdt, cdr >= 1 ? String(Math.ceil(cdr)) : cdr.toFixed(1));
    } else { setStyle(r.cd, 'opacity', '0'); setText(r.cdt, ''); }
    setText(r.ch, it.charges != null && (it.charges > 1 || it.def?.showCharges || it.def?.charges) ? String(it.charges) : '');
    const mc = levelValue(it.def?.active?.manaCost, 1) ?? 0;
    toggleClass(r.e, 'nomana', mc > 0 && hero && hero.mana < mc);
  }

  // ---------- buffs ----------
  updateBuffs() {
    const u = this.unit;
    const mods = (u?.modifiers ?? []).filter((m) => !m.hidden && (m.icon || m.name));
    const sig = mods.map((m) => (m.id ?? m.name) + ':' + (m.stacks ?? 1)).join('|');
    if (sig !== this.modSig) {
      this.modSig = sig;
      this.buffs.innerHTML = '';
      this.buffEls = mods.map((m) => {
        const e = el('div', `bf ${m.debuff ? 'debuff' : ''}`, `<div class="bf-ic">${iconHTML(m.icon, m.name ?? m.id, m.debuff ? '#5a1d16' : '#1d4a2a')}</div><div class="bf-sweep"></div>${(m.stacks ?? 1) > 1 ? `<b class="bf-st">${m.stacks}</b>` : ''}`);
        this.ui.tooltip.attach(e, () => simpleTooltip(m.name ?? prettify(m.id), `${m.description ? esc(m.description) + '<br>' : ''}${Number.isFinite(m.remaining) ? `<span class="tt-dim">${m.remaining.toFixed(1)}s remaining</span>` : ''}`), 'top');
        this.buffs.appendChild(e);
        return { m, e, sw: e.querySelector('.bf-sweep') };
      });
    }
    for (const b of this.buffEls ?? []) {
      const m = b.m;
      const f = Number.isFinite(m.remaining) && m.duration ? Math.max(0, m.remaining / m.duration) : 1;
      setStyle(b.sw, '--p', ((1 - f) * 360).toFixed(0) + 'deg');
    }
  }

  // ---------- main update ----------
  setUnit(u) {
    if (u === this.unit) return;
    this.unit = u;
    this.abSig = '';
    this.modSig = '';
    this.ptSig = null;
    this.lagPct = u ? u.healthPct : 1;
  }

  update() {
    const g = this.game;
    const sel = g.player.selected?.find((x) => x?.alive || x?.kind === 'hero') ?? g.player.hero;
    this.setUnit(sel ?? null);
    const u = this.unit;
    if (!u) return;
    const own = this.own();
    const hero = u.kind === 'hero';
    toggleClass(this.node, 'own', own);
    toggleClass(this.node, 'other', !own);
    toggleClass(this.node, 'enemy', u.team !== g.player.team);
    toggleClass(this.node, 'nohero', !hero);

    // portrait
    const ptSig = hero ? u.heroId : 'u' + u.id;
    if (ptSig !== this.ptSig) {
      this.ptSig = ptSig;
      this.ptWrap.innerHTML = this.ui.portraits.unitHTML(u, 'bp-pt');
      setText(this.name, u.name ?? u.kind);
    }
    toggleClass(this.ptWrap, 'dead', !u.alive);

    // level + xp
    if (hero) {
      setText(this.lvl, String(u.level));
      const lo = XP_TABLE[u.level - 1] ?? 0, hi = XP_TABLE[u.level] ?? lo + 1;
      const f = u.level >= MAX_LEVEL ? 1 : Math.max(0, Math.min(1, (u.xp - lo) / Math.max(1, hi - lo)));
      setStyle(this.ring, 'stroke-dashoffset', (RING_C * (1 - f)).toFixed(1));
    }
    const canLevel = own && u.abilityPoints > 0;
    toggleClass(this.lvlUp, 'show', canLevel);
    toggleClass(this.lvlBox, 'pulse', canLevel);

    // bars
    const maxHp = Math.max(1, u.getStat('maxHp')), maxMp = u.getStat('maxMana');
    const hpP = Math.max(0, Math.min(1, u.hp / maxHp));
    if (hpP >= this.lagPct || !u.alive) this.lagPct = hpP; else this.lagPct = Math.max(hpP, this.lagPct - 0.02);
    setStyle(this.hp.fill, 'width', (hpP * 100).toFixed(2) + '%');
    setStyle(this.hp.lag, 'width', (this.lagPct * 100).toFixed(2) + '%');
    setText(this.hp.val, `${Math.ceil(u.hp)} / ${Math.ceil(maxHp)}`);
    const hr = u.getStat('hpRegen');
    setText(this.hp.rg, (hr >= 0 ? '+' : '') + hr.toFixed(1));
    toggleClass(this.mpBar, 'hidden', !(maxMp > 0));
    if (maxMp > 0) {
      setStyle(this.mp.fill, 'width', ((u.mana / maxMp) * 100).toFixed(2) + '%');
      setText(this.mp.val, `${Math.floor(u.mana)} / ${Math.ceil(maxMp)}`);
      setText(this.mp.rg, '+' + u.getStat('manaRegen').toFixed(1));
    }

    // stats
    const dmin = u.getStat('damageMin'), dmax = u.getStat('damageMax'), bonus = u.bonusFromSources('damage');
    setText(this.stats.dmg, `${Math.round((dmin + dmax) / 2)}`);
    setText(this.stats.dmgb, bonus ? `+${Math.round(bonus)}` : '');
    setText(this.stats.arm, u.getStat('armor').toFixed(1));
    setText(this.stats.ms, String(Math.round(u.getStat('moveSpeed') * 40)));
    for (const a of this.stats.attrs) {
      const k = a.dataset.a;
      if (!hero || !u.attr) { toggleClass(a, 'hidden', true); continue; }
      toggleClass(a, 'hidden', false);
      const base = u.def[k] + (u.def[k + 'Gain'] ?? 0) * (u.level - 1);
      const tot = u.attr(k);
      setText(a.querySelector('b'), String(Math.floor(base)));
      setText(a.querySelector('em'), tot - base >= 1 ? `+${Math.floor(tot - base)}` : '');
      toggleClass(a, 'prim', u.def.primary === k || u.def.primary === 'uni');
    }

    // abilities
    const abs = (u.abilities ?? []).filter(Boolean);
    const sig = abs.map((a) => a.def?.id).join(',') + '#' + u.id;
    if (sig !== this.abSig) { this.abSig = sig; this.buildAbilities(); }
    const silenced = u.isSilenced;
    for (const r of this.abEls ?? []) {
      const ab = r.ab, def = ab.def ?? {};
      const lvl = ab.level ?? 0;
      r.pips.forEach((p, i) => toggleClass(p, 'on', i < lvl));
      toggleClass(r.e, 'unlearned', lvl <= 0);
      const cdr = ab.cooldownRemaining ?? 0;
      const total = (typeof ab.getCooldown === 'function' ? ab.getCooldown() : levelValue(def.cooldown, lvl)) || cdr || 1;
      if (cdr > 0) {
        setStyle(r.cd, 'opacity', '1');
        setStyle(r.cd, '--p', ((Math.min(1, cdr / total)) * 360).toFixed(0) + 'deg');
        setText(r.cdt, cdr >= 1 ? String(Math.ceil(cdr)) : cdr.toFixed(1));
      } else { setStyle(r.cd, 'opacity', '0'); setText(r.cdt, ''); }
      toggleClass(r.e, 'cooling', cdr > 0);
      const mc = (typeof ab.getManaCost === 'function' ? ab.getManaCost() : levelValue(def.manaCost, lvl)) ?? 0;
      setText(r.mana, mc > 0 && def.targetType !== 'passive' ? String(Math.round(mc)) : '');
      toggleClass(r.e, 'nomana', lvl > 0 && mc > 0 && u.mana < mc);
      toggleClass(r.e, 'silenced', lvl > 0 && !!silenced && def.targetType !== 'passive');
      toggleClass(r.e, 'ready', lvl > 0 && cdr <= 0 && !(mc > 0 && u.mana < mc));
      toggleClass(r.e, 'active', !!(ab.toggled || ab.active || g.input?.pendingCast?.ability === ab || g.input?.targeting?.ability === ab));
      const canUp = own && u.canLevelAbility?.(abs.indexOf(ab));
      toggleClass(r.e, 'can-up', !!canUp);
    }

    // inventory
    if (hero) {
      for (const r of this.invEls) this.updateSlot(r, this.slotItem(r.i), u);
      this.updateSlot(this.tp, this.tpItem(), u);
    }
    toggleClass(this.node, 'no-inv', !hero);
    this.updateBuffs();
  }

  statsTooltip() {
    const u = this.unit;
    if (!u) return null;
    const row = (k, v) => `<div class="tt-kv"><span>${k}</span><b>${v}</b></div>`;
    const as = u.getStat('attackSpeed');
    const mr = Math.round(Math.min(u.getStat('magicResist'), 0.9) * 100);
    let attrs = '';
    if (u.kind === 'hero' && u.attr) {
      attrs = ['str', 'agi', 'int'].map((a) => `<div class="tt-kv attr-${a}"><span><i class="orb orb-${a}"></i> ${ATTR[a].name}${u.def.primary === a ? ' (Primary)' : ''}</span><b>${Math.floor(u.attr(a))} <em>+${(u.def[a + 'Gain'] ?? 0).toFixed(1)}/lvl</em></b></div>`).join('');
    }
    return `<div class="tt tt-stats"><div class="tt-title">${esc(u.name)}</div><div class="tt-body">
      ${row('Damage', `${Math.round(u.getStat('damageMin') + u.bonusFromSources('damage'))}–${Math.round(u.getStat('damageMax') + u.bonusFromSources('damage'))}`)}
      ${row('Attack Speed', `${Math.round(as)} (${u.attackInterval.toFixed(2)}s)`)}
      ${row('Attack Range', Math.round(u.getStat('attackRange') * 40))}
      ${row('Armor', u.getStat('armor').toFixed(1))}
      ${row('Magic Resistance', mr + '%')}
      ${row('Move Speed', Math.round(u.getStat('moveSpeed') * 40))}
      ${row('Health Regen', u.getStat('hpRegen').toFixed(1))}
      ${row('Mana Regen', u.getStat('manaRegen').toFixed(1))}
      ${u.kind === 'hero' ? row('Gold', fmtNum(u.gold)) : ''}
      ${attrs}
    </div></div>`;
  }
}

function prettify(id) {
  return String(id ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
