// Ability system — implements the Ability contract from ARCHITECTURE.md.
// Each hero's abilities live in ./heroes/<heroId>.js as an array of "specs". A spec is also the public `def`:
//   { id, name, icon, description, targetType: 'none'|'unit'|'point'|'passive'|'toggle', targetTeam, ultimate,
//     maxLevel, castPoint, cooldown[], manaCost[], castRange[] (world units), radius?, damageType?, values{},
//     pierceImmunity?, allowSelf?, targetStructures?, heroesOnly?, autocast?, charges?{max, restore},
//     hint?{type, radius, range}, aim?(vfx name shown on target during cast point),
//     cast(ab, target), passive(ab) -> modifier, aura{radius, interval, targets(ab)->units, modifier(ab,u)},
//     toggle{on(ab), off(ab), tick(ab, dt)}, channel{duration(ab), tick(ab, dt, t), end(ab, interrupted)},
//     onLearn(ab), onLevel(ab), update(ab, dt) }
import { lv, isUnit, posOf } from './util.js';

import brakka from './heroes/brakka.js';
import kenshar from './heroes/kenshar.js';
import isolde from './heroes/isolde.js';
import pell from './heroes/pell.js';
import sera from './heroes/sera.js';
import gorrow from './heroes/gorrow.js';
import vesna from './heroes/vesna.js';
import aldric from './heroes/aldric.js';
import morvane from './heroes/morvane.js';
import sable from './heroes/sable.js';
import thalor from './heroes/thalor.js';
import vashkar from './heroes/vashkar.js';
import ondur from './heroes/ondur.js';
import liora from './heroes/liora.js';

const ALL_SPECS = [brakka, kenshar, isolde, pell, sera, gorrow, vesna, aldric, morvane, sable, thalor, vashkar, ondur, liora].flat();
// Tooltips (ui/Tooltip.js) render def.scepterDescription in their own "Ascendant Scepter" box.
for (const s of ALL_SPECS) if (s.scepter?.description) s.scepterDescription = s.scepter.description;
export const ABILITY_DEFS = Object.fromEntries(ALL_SPECS.map((s) => [s.id, s]));

const DEFAULTS = { targetTeam: 'enemy', ultimate: false, castPoint: 0.3, cooldown: [0], manaCost: [0], castRange: [0], maxLevel: undefined };

export class Ability {
  constructor(system, hero, def) {
    this.system = system;
    this.game = system.game;
    this.hero = hero;
    this.def = { ...DEFAULTS, ...def };
    if (this.def.maxLevel == null) this.def.maxLevel = this.def.ultimate ? 3 : 4;
    // Live tooltip text: base description + learned talents for this ability.
    const baseDesc = def.description ?? '';
    Object.defineProperty(this.def, 'description', {
      enumerable: true, configurable: true,
      get: () => {
        let d = baseDesc;
        const notes = this.game.talents?.notesFor?.(this);
        if (notes) d += ` — 🌳 Talents: ${notes}`;
        return d;
      },
    });
    this.level = 0;
    this.cooldownRemaining = 0;
    this.isItem = false;
    this.toggled = false; // toggle / autocast state
    this.channel = null; // { t, duration }
    this.charges = def.charges ? def.charges.max : undefined;
    this.chargeTimer = 0;
    this.data = {}; // per-instance scratch storage for ability implementations
    this._auraTimer = 0;
    this._aimFx = null;
  }

  // ---- values ----
  // Ability values honour Ascendant Scepter overrides (def.scepter.values) and talent modifiers
  // (hero.talentMods[abilityId][key], additive) so talents/scepter need no per-cast plumbing.
  get hasScepter() { return !!(this.def.scepter && this.hero?.data?.hasScepter); }
  talentMod(key) { const m = this.hero?.talentMods?.[this.def.id]; return m ? m[key] ?? 0 : 0; }
  v(key, level = this.level) {
    const sv = this.hasScepter ? this.def.scepter.values?.[key] : undefined;
    const base = lv(sv !== undefined ? sv : this.def.values?.[key], level);
    const t = this.talentMod(key);
    return t && typeof base === 'number' ? base + t : base;
  }
  get isPassive() { return this.def.targetType === 'passive'; }
  get isToggle() { return this.def.targetType === 'toggle'; }
  get isChanneling() { return !!this.channel; }
  get cooldownTotal() { return this._cdTotal ?? this.getCooldown(); }

  getCastRange() {
    const r = lv((this.hasScepter && this.def.scepter.castRange) || this.def.castRange, this.level) ?? 0;
    if (!r) return 0;
    return r + this.talentMod('castRange') + (this.hero.bonusFromSources?.('castRange') ?? 0);
  }
  getCooldown() {
    const cd = Math.max(0, (lv((this.hasScepter && this.def.scepter.cooldown) || this.def.cooldown, this.level) ?? 0) - this.talentMod('cooldown'));
    const cdr = Math.min(0.5, this.hero.bonusFromSources?.('cooldownReduction') ?? 0);
    return cd * (1 - cdr);
  }
  getManaCost() {
    const mc = Math.max(0, (lv((this.hasScepter && this.def.scepter.manaCost) || this.def.manaCost, this.level) ?? 0) - this.talentMod('manaCost'));
    const red = Math.min(0.5, this.hero?.bonusFromSources?.('manaCostReduction') ?? 0); // e.g. arcane rune
    return red ? mc * (1 - red) : mc;
  }
  getRadius() { const r = lv((this.hasScepter && this.def.scepter.radius) || this.def.radius, this.level) ?? 0; return r ? r + this.talentMod('radius') : r; }

  // ---- validation ----
  canCast(target) {
    const h = this.hero, d = this.def;
    if (this.level <= 0) return { ok: false, reason: 'Ability not learned yet' };
    if (!h.alive) return { ok: false, reason: 'Dead' };
    if (this.isPassive) return { ok: false, reason: 'Ability is passive' };
    if (this.isToggle && this.toggled) return { ok: true }; // can always toggle off
    if (d.charges ? this.charges <= 0 : this.cooldownRemaining > 0) return { ok: false, reason: 'Ability on cooldown' };
    if (h.isStunned) return { ok: false, reason: 'Stunned' };
    if (h.isSilenced) return { ok: false, reason: 'Silenced' };
    if (!d.autocast && h.mana < this.getManaCost()) return { ok: false, reason: 'Not enough mana' };
    if (d.canCast) { const r = d.canCast(this, target); if (r && !r.ok) return r; }
    if (d.targetType === 'unit') return this.validateUnitTarget(target);
    if (d.targetType === 'point') {
      const p = posOf(target);
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return { ok: false, reason: 'Must target a location' };
    }
    return { ok: true };
  }

  validateUnitTarget(t) {
    const h = this.hero, d = this.def;
    if (!isUnit(t)) return { ok: false, reason: 'Must target a unit' };
    if (!t.alive) return { ok: false, reason: 'Target is dead' };
    if (t === h && !d.allowSelf) return { ok: false, reason: 'Ability cannot target self' };
    const team = d.targetTeam ?? 'enemy';
    if (team === 'enemy' && t.team === h.team) return { ok: false, reason: 'Must target an enemy' };
    if (team === 'ally' && t.team !== h.team) return { ok: false, reason: 'Must target an ally' };
    if (t.isStructure && !d.targetStructures) return { ok: false, reason: 'Cannot target buildings' };
    if (d.heroesOnly && t.kind !== 'hero') return { ok: false, reason: 'Must target a hero' };
    if (t.isInvulnerable && t.team !== h.team) return { ok: false, reason: 'Target is invulnerable' };
    if (t.team !== h.team && t.isMagicImmune && !(d.pierceImmunity || (this.hasScepter && d.scepter.pierceImmunity))) return { ok: false, reason: 'Target is magic immune' };
    if (t.team !== h.team && this.game.canSee && !this.game.canSee(h.team, t)) return { ok: false, reason: 'Target not visible' };
    return { ok: true };
  }

  // ---- casting ----
  cast(target) {
    const h = this.hero, d = this.def, g = this.game;
    if (this.level <= 0 || !h.alive) return false;
    if (this.isToggle) {
      this.setToggle(!this.toggled);
      g.bus.emit('ability:cast', { hero: h, ability: this, target: null, toggle: this.toggled });
      return true;
    }
    if (this.isPassive) return false;
    const cost = this.getManaCost();
    if (h.mana < cost) return false;
    h.spendMana(cost);
    this.startCooldown();
    let tgt = target;
    if (d.targetType === 'point' && isUnit(target)) tgt = target.position.clone();
    else if (d.targetType === 'point' && tgt?.clone) tgt = tgt.clone();
    if (d.targetType === 'none') tgt = null;
    // face the target
    const tp = posOf(tgt);
    if (tp && (Math.abs(tp.x - h.position.x) + Math.abs(tp.z - h.position.z)) > 0.05) h.facing = Math.atan2(tp.x - h.position.x, tp.z - h.position.z);
    g.bus.emit('ability:cast', { hero: h, ability: this, target: tgt });
    // Warding Sphere style spell block (items module)
    if (d.targetType === 'unit' && isUnit(tgt) && tgt.team !== h.team) {
      let blocked = false;
      try { blocked = !!g.items?.tryBlockSpell?.(tgt, h, this); } catch (e) { console.warn('[ability] tryBlockSpell', e); }
      if (blocked) { g.bus.emit('ability:blocked', { hero: h, ability: this, target: tgt }); return true; }
    }
    try {
      d.cast?.(this, tgt);
    } catch (e) { console.error('[ability]', d.id, e); }
    if (d.channel && h.alive) this.startChannel(lv(typeof d.channel.duration === 'function' ? d.channel.duration(this) : d.channel.duration, this.level), tgt);
    return true;
  }

  startCooldown(cd = this.getCooldown()) {
    if (this.def.charges) {
      if (this.charges === this.def.charges.max) this.chargeTimer = lv(this.def.charges.restore, this.level);
      this.charges = Math.max(0, this.charges - 1);
      this.cooldownRemaining = this.charges > 0 ? 0 : this.chargeTimer;
      this._cdTotal = lv(this.def.charges.restore, this.level);
      return;
    }
    this.cooldownRemaining = cd;
    this._cdTotal = cd;
  }
  // Refresh (e.g. Executioner's Cleave kill)
  resetCooldown() { this.cooldownRemaining = 0; if (this.def.charges) { this.charges = this.def.charges.max; } }

  setToggle(on) {
    if (on === this.toggled) return;
    this.toggled = on;
    try { on ? this.def.toggle?.on?.(this) : this.def.toggle?.off?.(this); } catch (e) { console.error('[toggle]', this.def.id, e); }
  }

  // ---- channeling ----
  startChannel(duration, target) {
    const h = this.hero;
    if (!duration || duration <= 0) return;
    h.data.channeling?.stopChannel?.(true);
    this.channel = { t: 0, duration, target };
    h.data.channeling = this;
    h.addModifier({ id: 'channeling', name: 'Channeling', hidden: true, disarm: true, duration: duration + 0.1, channel: true });
    h.playAnim?.('cast', { loop: true });
    h.state = 'casting';
  }
  stopChannel(interrupted = false) {
    if (!this.channel) return;
    const h = this.hero;
    this.channel = null;
    if (h.data.channeling === this) h.data.channeling = null;
    h.removeModifier('channeling');
    if (h.alive) { h.state = 'idle'; h.playAnim?.('idle'); }
    try { this.def.channel?.end?.(this, interrupted); } catch (e) { console.error('[channel end]', this.def.id, e); }
  }

  onLevelUp() {
    try {
      if (this.level === 1) this.def.onLearn?.(this);
      this.def.onLevel?.(this);
    } catch (e) { console.error('[ability onLevel]', this.def.id, e); }
    if (this.def.charges && this.level === 1) this.charges = this.def.charges.max;
    if (this.isPassive || this.def.passive) this.refreshPassive(true);
  }

  refreshPassive(force = false) {
    const d = this.def;
    if (!d.passive || this.level <= 0 || !this.hero.alive) return;
    const id = 'passive_' + d.id;
    if (force) this.hero.removeModifier(id);
    if (!this.hero.hasModifier(id)) {
      const m = d.passive(this);
      if (m) this.hero.addModifier({ hidden: true, passive: true, name: d.name, icon: d.icon, ...m, id });
    }
  }

  // Called while hero is dead too (cooldowns keep ticking while dead).
  tickTimers(dt) {
    if (this.def.charges && this.charges < this.def.charges.max && this.level > 0) {
      this.chargeTimer -= dt;
      if (this.chargeTimer <= 0) {
        this.charges++;
        this.chargeTimer = this.charges < this.def.charges.max ? lv(this.def.charges.restore, this.level) : 0;
      }
      this.cooldownRemaining = this.charges > 0 ? 0 : Math.max(0, this.chargeTimer);
    } else if (this.cooldownRemaining > 0) this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
  }

  update(dt) {
    const h = this.hero, d = this.def;
    this.tickTimers(dt);
    if (!h.alive) {
      if (this.channel) this.stopChannel(true);
      if (this.toggled && !d.autocast) this.setToggle(false);
      this.clearAim();
      return;
    }
    if (this.level <= 0) return;
    if (d.passive) this.refreshPassive();
    // channel
    if (this.channel) {
      if (h.isStunned || h.isSilenced || h.hasState('morph')) this.stopChannel(true);
      else {
        const c = this.channel;
        c.t += dt;
        h.state = 'casting';
        try { d.channel?.tick?.(this, dt, c.t); } catch (e) { console.error('[channel]', d.id, e); this.stopChannel(true); }
        if (this.channel && c.t >= c.duration) this.stopChannel(false);
      }
    }
    if (this.toggled && d.toggle?.tick) {
      try { d.toggle.tick(this, dt); } catch (e) { console.error('[toggle tick]', d.id, e); }
    }
    if (d.aura) {
      this._auraTimer -= dt;
      if (this._auraTimer <= 0) {
        this._auraTimer = d.aura.interval ?? 0.25;
        try {
          const targets = d.aura.targets ? d.aura.targets(this) : this.game.alliesInRadius(h.team, h.position, lv(d.aura.radius, this.level) ?? 10);
          for (const u of targets) {
            const m = d.aura.modifier(this, u);
            if (m) u.addModifier({ duration: 0.6, ...m });
          }
        } catch (e) { console.error('[aura]', d.id, e); }
      }
    }
    if (d.update) {
      try { d.update(this, dt); } catch (e) { console.error('[ability update]', d.id, e); }
    }
    // Aim indicator during the cast point (e.g. Final Round crosshair)
    if (d.aim) {
      const casting = h.castWindup >= 0 && h.order?.ability === this && h.order?.target;
      if (casting && !this._aimFx) this._aimFx = this.game.vfx?.attachToUnit?.(h.order.target, d.aim, { source: h, color: 0xff3030 }) ?? null;
      else if (!casting) this.clearAim();
    }
  }
  clearAim() { if (this._aimFx) { this._aimFx.remove?.(); this._aimFx = null; } }
}

export class AbilitySystem {
  constructor(game) {
    this.game = game;
    this.defs = ABILITY_DEFS;
    this.tasks = [];
  }

  async init() {
    const bus = this.game.bus;
    // Any new order interrupts a channel (genre convention).
    bus.on('unit:order', ({ unit }) => {
      const ch = unit?.data?.channeling;
      if (ch && ch.channel) ch.stopChannel(true);
    });
  }

  setupHero(hero) {
    const def = hero.def;
    hero.abilities = (def.abilities ?? []).slice(0, 4).map((id) => {
      const spec = ABILITY_DEFS[id];
      if (!spec) { console.warn('[abilities] unknown ability', id); return new Ability(this, hero, { id, name: id, targetType: 'passive' }); }
      return new Ability(this, hero, spec);
    });
    if (def.projectileKind) hero.data.projectileKind = def.projectileKind;
  }

  getAbilityDef(id) { return ABILITY_DEFS[id] ?? null; }

  // Hint for bot AI: how should this ability be used?
  // Returns { type: 'enemy'|'self'|'ally'|'point'|'aoe'|'passive'|'toggle', radius, range, ... }
  botCastHint(hero, abilityIndex) {
    const ab = hero?.abilities?.[abilityIndex];
    if (!ab) return null;
    const d = ab.def;
    const range = ab.getCastRange();
    const radius = ab.getRadius();
    let base;
    if (d.targetType === 'passive') base = { type: 'passive' };
    else if (d.targetType === 'toggle') base = { type: 'toggle', radius };
    else if (d.targetType === 'unit') base = { type: d.targetTeam === 'ally' ? 'ally' : 'enemy', radius };
    else if (d.targetType === 'point') base = { type: radius ? 'aoe' : 'point', radius };
    else base = { type: 'self', radius };
    return { range, ...base, ...(typeof d.hint === 'function' ? d.hint(ab) : d.hint ?? {}) };
  }

  // Per-frame tasks for ability logic that must outlive a single cast (hooks, bouncing orbs, zones...).
  // fn(dt) -> true when finished.
  addTask(fn) { this.tasks.push(fn); return fn; }

  update(dt) {
    if (this.tasks.length) {
      const keep = [];
      for (const t of this.tasks) {
        let done = true;
        try { done = t(dt); } catch (e) { console.error('[ability task]', e); }
        if (!done) keep.push(t);
      }
      // (tasks pushed during iteration are visited by for..of, so `keep` already contains them)
      this.tasks = keep;
    }
    for (const h of this.game.heroes) {
      if (!h.alive) for (const ab of h.abilities) ab?.update?.(dt); // alive heroes are updated by Hero.update
    }
    // Airborne visuals (knockback arcs, leaps)
    for (const u of this.game.units) {
      if (u.data?.airHeight > 0 && u.object) u.object.position.y = u.position.y + u.data.airHeight;
    }
  }
}
