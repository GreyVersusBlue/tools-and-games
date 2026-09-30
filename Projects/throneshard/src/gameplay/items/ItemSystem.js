// Items + shop logic. Owned by the Items agent.
//
// Public API (game.items):
//   buy(hero, id) → {ok, reason, item}            sell(hero, slot) → {ok, reason, gold}
//   use(hero, slot, target?) → {ok, reason}       canUse(hero, slot) → {ok, reason}
//   swap(hero, a, b) (slots 0-5 inventory, 6-8 backpack)   inShopRange(hero) → 'base'|'secret'|null
//   getShopCategories(), getBuildPath(id), getBuildsInto(id), recommendedItems(heroId), nextRecommended(hero),
//   autoBuy(hero) (bot helper), getItemDef(id), getItemIcon(id), defs (ITEM_DEFS), costToBuy(hero, id),
//   hasItem(hero, id), findItem(hero, id) → slot, tryBlockSpell(target, caster) (Warding Sphere), dispel(unit, strong)
// Slots: number 0-5 = inventory, 6-8 = backpack, 'tp' = hero.homeScroll, 'stash:N', or an item instance.
import * as THREE from 'three';
import { ITEM_DEFS, SHOP_CATEGORIES, getItemDef } from './ItemDefs.js';
import { getItemIcon } from './ItemIcons.js';
import { RECOMMENDED, GENERIC_BUILDS } from './ItemBuilds.js';
import { SHOPS, SHOP_RADIUS, FOUNTAIN, du } from '../../core/constants.js';

const INV_SIZE = 6, BACKPACK_SIZE = 3, STASH_SIZE = 6;
const FULL_REFUND_WINDOW = 10;
const BACKPACK_SWAP_COOLDOWN = 6;
const FOUNTAIN_RADIUS = 12;
const COURIER_SPEED = du(550);
const CREEP_KINDS = new Set(['creep', 'neutral', 'summon']);
let UID = 1;

const ok = (extra) => ({ ok: true, ...extra });
const fail = (reason) => ({ ok: false, reason });
const isUnit = (t) => !!(t && t.position && t.alive !== undefined);
const heroOf = (u) => (u?.kind === 'hero' ? u : u?.owner?.kind === 'hero' ? u.owner : null);

// ------------------------------------------------------------------ item instance (Ability-shaped)
export class ItemInstance {
  constructor(system, def, hero, charges) {
    this.system = system;
    this.def = def;
    this.hero = hero;
    this.uid = UID++;
    this.isItem = true;
    this.level = 1;
    this.charges = charges ?? def.charges ?? 0;
    this.cooldownRemaining = 0;
    this.cooldownTotal = def.cooldown ?? 0;
    this.purchaseTime = system.game.time;
    this.purchaser = hero;
    this.treadsAttr = def.id === 'shifting_treads' ? 'str' : null;
    this._tickFrame = -1;
  }
  get id() { return this.def.id; }
  get name() { return this.def.name; }
  get icon() { return this.def.icon; }
  get isToggle() { return this.def.id === 'shifting_treads'; }
  getCooldown() { return this.def.cooldown ?? 0; }
  getManaCost() { return this.def.manaCost ?? 0; }
  getCastRange() {
    const r = this.def.castRange ?? 0;
    if (r <= 0) return 0;
    return r + (this.hero?.bonusFromSources?.('castRange') ?? 0);
  }
  canCast(target) { return this.system.canCastItem(this, target); }
  cast(target) { return this.system.castItem(this, target); }
  toggle() { return this.system.castItem(this, null); }
  update(dt) {
    const f = this.system.game.frame;
    if (this._tickFrame === f) return;
    this._tickFrame = f;
    if (this.cooldownRemaining > 0) this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
  }
}

// ------------------------------------------------------------------ system
export class ItemSystem {
  constructor(game) {
    this.game = game;
    this.defs = ITEM_DEFS;
    this.autoCourier = true; // stash items are flown to the hero automatically
    this.stock = {};
    this._deferred = [];
    this._wired = false;
  }

  async init() { this.wireEvents(); }

  wireEvents() {
    if (this._wired) return;
    this._wired = true;
    const bus = this.game.bus;
    bus.on('unit:damaged', ({ unit, source, amount }) => {
      if (unit?.kind !== 'hero' || !(amount > 0)) return;
      const h = heroOf(source);
      if ((h && h.team !== unit.team) || source?.kind === 'grimmaw') unit.data.lastHeroDamageTime = this.game.time;
    });
    bus.on('ability:cast', ({ hero }) => { this.onSpellCast(hero, true); });
    bus.on('item:used', ({ hero, item }) => { if ((item?.def?.manaCost ?? 0) > 0) this.onSpellCast(hero, true); });
    bus.on('unit:order', ({ unit }) => {
      const m = unit?.modifiers?.find((x) => x.id === 'item_tp_channel');
      if (m && m.startFrame !== this.game.frame) this.cancelChannel(unit);
    });
    bus.on('unit:died', ({ unit, killer }) => this.onUnitDied(unit, killer));
  }

  onMatchStart() {
    this.wireEvents();
    this.stock = {};
    for (const team of ['sunward', 'duskward']) {
      this.stock[team] = {};
      for (const d of Object.values(ITEM_DEFS)) if (d.stock) this.stock[team][d.id] = { count: d.stock.initial, timer: d.stock.restock };
    }
    for (const h of this.game.heroes) if (!h.homeScroll) h.homeScroll = new ItemInstance(this, ITEM_DEFS.homeward_scroll, h, 1);
  }

  setupHero(hero) {
    hero.inventory ??= new Array(INV_SIZE).fill(null);
    hero.backpack ??= new Array(BACKPACK_SIZE).fill(null);
    hero.stash ??= [];
    // Everyone starts with a free TP scroll in the dedicated TP slot.
    hero.homeScroll = new ItemInstance(this, ITEM_DEFS.homeward_scroll, hero, 1);
    hero.data.itemSig = '';
    hero.data.unbreakableUses = 0;
    hero.data.hasScepter = false;
  }

  // ================================================================== queries
  getItemDef(id) { return getItemDef(id); }
  getItemDefs() { return ITEM_DEFS; }
  getItemIcon(id) { return getItemIcon(id); }

  getShopCategories() {
    return SHOP_CATEGORIES.map((c) => ({ ...c, items: Object.values(ITEM_DEFS).filter((d) => d.category === c.id).map((d) => d.id) }));
  }

  getBuildPath(id) {
    const d = ITEM_DEFS[id];
    if (!d) return null;
    return {
      id, name: d.name, icon: d.icon, cost: d.cost, recipeCost: d.recipeCost ?? 0,
      components: (d.components ?? []).map((c) => this.getBuildPath(c)),
    };
  }
  getBuildsInto(id) { return [...(ITEM_DEFS[id]?.buildsInto ?? [])]; }

  recommendedItems(heroId) {
    const hdef = this.game.heroDefs?.[heroId];
    const b = RECOMMENDED[heroId] ?? GENERIC_BUILDS[hdef?.primary] ?? GENERIC_BUILDS.str;
    return { starting: [...b.starting], early: [...b.early], core: [...b.core], late: [...b.late], all: [...b.early, ...b.core, ...b.late] };
  }

  inShopRange(hero) {
    if (!hero) return null;
    const p = hero.position;
    const base = SHOPS[hero.team];
    if (base && Math.hypot(p.x - base[0], p.z - base[1]) <= SHOP_RADIUS) return 'base';
    const f = FOUNTAIN[hero.team];
    if (f && Math.hypot(p.x - f[0], p.z - f[1]) <= SHOP_RADIUS + 4) return 'base';
    for (const s of SHOPS.secret ?? []) if (Math.hypot(p.x - s[0], p.z - s[1]) <= SHOP_RADIUS * 0.8) return 'secret';
    return null;
  }
  inFountain(hero) {
    const f = FOUNTAIN[hero.team];
    return !!f && Math.hypot(hero.position.x - f[0], hero.position.z - f[1]) <= FOUNTAIN_RADIUS;
  }

  allItems(hero, { stash = true, tp = true } = {}) {
    const out = [];
    hero.inventory?.forEach((it, i) => it && out.push({ item: it, where: 'inventory', index: i }));
    hero.backpack?.forEach((it, i) => it && out.push({ item: it, where: 'backpack', index: i }));
    if (stash) hero.stash?.forEach((it, i) => it && out.push({ item: it, where: 'stash', index: i }));
    if (tp && hero.homeScroll) out.push({ item: hero.homeScroll, where: 'tp', index: 0 });
    return out;
  }
  hasItem(hero, id, includeStash = false) { return this.allItems(hero, { stash: includeStash }).some((e) => e.item.def.id === id); }
  findItem(hero, id) {
    if (id === 'homeward_scroll' && hero.homeScroll) return 'tp';
    let i = hero.inventory.findIndex((it) => it?.def.id === id);
    if (i >= 0) return i;
    i = hero.backpack.findIndex((it) => it?.def.id === id);
    return i >= 0 ? INV_SIZE + i : -1;
  }

  // slot → {item, where, index}
  resolveSlot(hero, slot) {
    if (!hero) return null;
    if (slot && typeof slot === 'object' && slot.isItem) {
      return this.allItems(hero).find((e) => e.item === slot) ?? null;
    }
    if (slot === 'tp') return hero.homeScroll ? { item: hero.homeScroll, where: 'tp', index: 0 } : null;
    if (typeof slot === 'string') {
      const m = /^(inventory|backpack|stash):(\d+)$/.exec(slot);
      if (m) { const it = hero[m[1]]?.[+m[2]]; return it ? { item: it, where: m[1], index: +m[2] } : null; }
      const s = this.findItem(hero, slot);
      return s === -1 ? null : this.resolveSlot(hero, s);
    }
    if (typeof slot === 'number') {
      if (slot >= 0 && slot < INV_SIZE) return hero.inventory[slot] ? { item: hero.inventory[slot], where: 'inventory', index: slot } : null;
      const b = slot - INV_SIZE;
      if (b >= 0 && b < BACKPACK_SIZE) return hero.backpack[b] ? { item: hero.backpack[b], where: 'backpack', index: b } : null;
    }
    return null;
  }
  removeAt(hero, e) {
    if (e.where === 'tp') hero.homeScroll = null;
    else if (e.where === 'stash') { const i = hero.stash.indexOf(e.item); if (i >= 0) hero.stash.splice(i, 1); }
    else if (hero[e.where][e.index] === e.item) hero[e.where][e.index] = null;
    else { const i = hero[e.where].indexOf(e.item); if (i >= 0) hero[e.where][i] = null; }
    this.markDirty(hero);
  }

  // Place an item: inventory → backpack → (stash if allowed). Returns location string or null.
  giveItem(hero, item, { allowStash = true, preferSlot = null } = {}) {
    item.hero = hero;
    if (item.def.id === 'homeward_scroll') {
      if (hero.homeScroll) { hero.homeScroll.charges = Math.min(hero.homeScroll.charges + item.charges, item.def.maxCharges ?? 99); return 'tp'; }
      hero.homeScroll = item; return 'tp';
    }
    if (item.def.stackable) {
      const s = [...hero.inventory, ...hero.backpack].find((x) => x?.def.id === item.def.id && x.charges < (x.def.maxCharges ?? 99));
      if (s) { s.charges = Math.min(s.charges + item.charges, s.def.maxCharges ?? 99); return 'stacked'; }
    }
    this.markDirty(hero);
    if (preferSlot) {
      const arr = hero[preferSlot.where];
      if (arr && preferSlot.where !== 'stash' && !arr[preferSlot.index]) { arr[preferSlot.index] = item; return preferSlot.where; }
    }
    let i = hero.inventory.indexOf(null);
    if (i >= 0) { hero.inventory[i] = item; return 'inventory'; }
    i = hero.backpack.indexOf(null);
    if (i >= 0) { hero.backpack[i] = item; return 'backpack'; }
    if (allowStash && hero.stash.length < STASH_SIZE) { hero.stash.push(item); return 'stash'; }
    return null;
  }
  putInStash(hero, item) {
    item.hero = hero;
    if (item.def.stackable || item.def.id === 'homeward_scroll') {
      const s = hero.stash.find((x) => x.def.id === item.def.id && x.charges < (x.def.maxCharges ?? 99));
      if (s) { s.charges = Math.min(s.charges + item.charges, s.def.maxCharges ?? 99); return true; }
    }
    if (hero.stash.length >= STASH_SIZE) return false;
    hero.stash.push(item);
    return true;
  }
  freeSlots(hero) { return hero.inventory.filter((x) => !x).length + hero.backpack.filter((x) => !x).length; }

  // ================================================================== shop
  // Works out what buying `id` costs given the components the hero already owns.
  planPurchase(hero, id) {
    const pool = this.allItems(hero, { tp: false });
    const used = new Set();
    const consumed = [];
    const newLeafs = [];
    let cost = 0, recipes = 0;
    const need = (cid, top) => {
      const d = ITEM_DEFS[cid];
      if (!d) return;
      if (!top) {
        const found = pool.find((p) => !used.has(p.item) && p.item.def.id === cid && !d.stackable);
        if (found) { used.add(found.item); consumed.push(found); return; }
      }
      if (d.components) {
        for (const c of d.components) need(c, false);
        cost += d.recipeCost ?? 0;
        recipes += d.recipeCost ?? 0;
      } else {
        cost += d.cost ?? 0;
        newLeafs.push(d);
      }
    };
    need(id, true);
    return { cost, consumed, newLeafs, recipes };
  }
  costToBuy(hero, id) { return this.planPurchase(hero, id).cost; }

  buy(hero, id) {
    const g = this.game;
    const def = ITEM_DEFS[id];
    if (!hero || hero.kind !== 'hero') return fail('No hero');
    if (!def) return fail('Unknown item');
    if (g.matchOver) return fail('The match is over');
    const st = def.stock ? this.stock[hero.team]?.[id] : null;
    if (st && st.count <= 0) return fail('Out of stock');
    const plan = this.planPurchase(hero, id);
    const gold = Math.floor(hero.gold);
    if (gold < plan.cost) return fail(`Not enough gold (${plan.cost - gold} more needed)`);

    const shop = hero.alive ? this.inShopRange(hero) : null;
    // Delivered directly when the hero stands in a shop that sells every newly bought component (the hidden bazaar
    // also stocks basic items; secret items need the hidden bazaar), or when only a recipe is needed — carried
    // components combine in place. Otherwise the item goes to the stash and the courier brings it.
    const direct = plan.newLeafs.length === 0 || (!!shop && plan.newLeafs.every((l) => l.shop !== 'secret' || shop === 'secret'));
    const item = new ItemInstance(this, def, hero);
    // Transfer charges (Resonant Reed → Resonant Wand).
    if (def.maxCharges && def.keepAtZero) {
      const ch = plan.consumed.reduce((s, e) => s + (e.item.def.keepAtZero ? e.item.charges : 0), 0);
      if (ch) item.charges = Math.min(def.maxCharges, item.charges + ch);
    }

    // Capacity check before spending gold.
    const invConsumed = plan.consumed.filter((e) => e.where !== 'stash').length;
    const stashConsumed = plan.consumed.length - invConsumed;
    const canStack = (list) => def.stackable && list.some((x) => x?.def.id === id && x.charges < (def.maxCharges ?? 99));
    if (id !== 'homeward_scroll') {
      if (direct) {
        if (!invConsumed && this.freeSlots(hero) === 0 && !canStack([...hero.inventory, ...hero.backpack]) && hero.stash.length - stashConsumed >= STASH_SIZE) return fail('Inventory and stash are full');
      } else if (hero.stash.length - stashConsumed >= STASH_SIZE && !canStack(hero.stash)) return fail('Stash is full');
    }

    // Commit
    const preferSlot = plan.consumed.find((e) => e.where === 'inventory') ?? plan.consumed.find((e) => e.where === 'backpack') ?? null;
    for (const e of plan.consumed) this.removeAt(hero, e);
    hero.addGold(-plan.cost, 'purchase');
    if (st) st.count--;
    let where;
    if (direct) where = this.giveItem(hero, item, { preferSlot });
    else where = this.putInStash(hero, item) ? 'stash' : this.giveItem(hero, item);
    this.autoCombine(hero);
    this.markDirty(hero);
    g.bus.emit('item:bought', { hero, item, cost: plan.cost, where });
    if (where === 'stash' && hero === g.player?.hero && !hero.alive) g.bus.emit('ui:message', { text: `${def.name} placed in stash`, color: '#e0c060' });
    return ok({ item, where, cost: plan.cost });
  }

  // Combine free recipes (no scroll) whenever all components are present in the same place.
  autoCombine(hero) {
    let changed = true, guard = 0;
    while (changed && guard++ < 10) {
      changed = false;
      for (const d of Object.values(ITEM_DEFS)) {
        if (!d.components || (d.recipeCost ?? 0) > 0) continue;
        for (const group of [['inventory', 'backpack'], ['stash']]) {
          const pool = this.allItems(hero, { tp: false }).filter((e) => group.includes(e.where));
          const used = [];
          let okAll = true;
          for (const c of d.components) {
            const f = pool.find((e) => !used.includes(e) && e.item.def.id === c);
            if (!f) { okAll = false; break; }
            used.push(f);
          }
          if (!okAll) continue;
          const preferSlot = used.find((e) => e.where === 'inventory') ?? used.find((e) => e.where === 'backpack');
          for (const e of used) this.removeAt(hero, e);
          const item = new ItemInstance(this, d, hero);
          item.purchaseTime = Math.max(...used.map((e) => e.item.purchaseTime));
          if (group[0] === 'stash') hero.stash.push(item);
          else this.giveItem(hero, item, { preferSlot });
          this.game.bus.emit('item:combined', { hero, item });
          changed = true;
        }
      }
    }
  }

  sellValue(item) {
    const d = item.def;
    const recent = this.game.time - item.purchaseTime <= FULL_REFUND_WINDOW;
    let v = (d.cost ?? 0) * (recent ? 1 : 0.5);
    if (d.consumable && d.charges > 0) v *= Math.max(0, item.charges) / d.charges;
    return Math.floor(v);
  }

  sell(hero, slot) {
    const e = this.resolveSlot(hero, slot);
    if (!e) return fail('No item in that slot');
    if (e.where !== 'stash' && !this.inShopRange(hero)) return fail('Must be near a shop to sell');
    const gold = this.sellValue(e.item);
    this.removeAt(hero, e);
    hero.addGold(gold, 'sell');
    this.game.bus.emit('item:sold', { hero, item: e.item, gold });
    return ok({ gold });
  }

  // Swap two slots (0-5 inventory, 6-8 backpack). Items moved into the inventory from the backpack get a 6s cooldown.
  swap(hero, a, b) {
    const loc = (s) => (s < INV_SIZE ? ['inventory', s] : ['backpack', s - INV_SIZE]);
    if (typeof a !== 'number' || typeof b !== 'number' || a === b) return fail('Invalid slots');
    if (a < 0 || b < 0 || a >= INV_SIZE + BACKPACK_SIZE || b >= INV_SIZE + BACKPACK_SIZE) return fail('Invalid slots');
    const [wa, ia] = loc(a), [wb, ib] = loc(b);
    const A = hero[wa][ia], B = hero[wb][ib];
    hero[wa][ia] = B;
    hero[wb][ib] = A;
    const toInv = (it, from, to) => { if (it && from === 'backpack' && to === 'inventory' && it.def.active) it.cooldownRemaining = Math.max(it.cooldownRemaining, BACKPACK_SWAP_COOLDOWN); };
    toInv(A, wa, wb);
    toInv(B, wb, wa);
    this.markDirty(hero);
    this.game.bus.emit('item:swapped', { hero, a, b });
    return ok();
  }

  // Move a stash item into the inventory (only at base).
  takeFromStash(hero, stashIndex) {
    const it = hero.stash[stashIndex];
    if (!it) return fail('Empty stash slot');
    if (this.inShopRange(hero) !== 'base') return fail('Must be at base');
    hero.stash.splice(stashIndex, 1);
    if (!this.giveItem(hero, it, { allowStash: false })) { hero.stash.splice(stashIndex, 0, it); return fail('Inventory is full'); }
    this.autoCombine(hero);
    return ok();
  }

  // Bot helpers ------------------------------------------------------
  ownsOrBuilt(hero, id) {
    const owned = this.allItems(hero).map((e) => e.item.def.id);
    if (owned.includes(id)) return true;
    // owned something that builds from it (e.g. boots → surge boots)
    const containsComp = (big, small, depth = 0) => {
      const d = ITEM_DEFS[big];
      if (!d?.components || depth > 5) return false;
      return d.components.some((c) => c === small || containsComp(c, small, depth + 1));
    };
    return owned.some((o) => containsComp(o, id));
  }
  nextRecommended(hero) {
    const r = this.recommendedItems(hero.heroId);
    return r.all.find((id) => !this.ownsOrBuilt(hero, id)) ?? null;
  }
  // Buys the next affordable piece of the hero's build (whole item if affordable, else the priciest missing component).
  autoBuy(hero, { maxPurchases = 4 } = {}) {
    const bought = [];
    for (let n = 0; n < maxPurchases; n++) {
      const target = this.nextRecommended(hero);
      if (!target) break;
      const plan = this.planPurchase(hero, target);
      let pick = null;
      if (plan.cost <= hero.gold) pick = target;
      else {
        const leafs = [];
        const walk = (id) => {
          const d = ITEM_DEFS[id];
          for (const c of d.components ?? []) {
            if (this.ownsOrBuilt(hero, c) && this.countOwned(hero, c) >= this.countNeeded(target, c)) continue;
            const cp = this.planPurchase(hero, c);
            if (cp.cost <= hero.gold) leafs.push({ id: c, cost: cp.cost }); else walk(c);
          }
        };
        walk(target);
        leafs.sort((a, b) => b.cost - a.cost);
        pick = leafs[0]?.id ?? null;
      }
      if (!pick) break;
      const res = this.buy(hero, pick);
      if (!res.ok) break;
      bought.push(pick);
    }
    return bought;
  }
  countOwned(hero, id) { return this.allItems(hero).filter((e) => e.item.def.id === id).length; }
  countNeeded(target, id) { return (ITEM_DEFS[target]?.components ?? []).filter((c) => c === id).length; }
  buyStartingItems(hero) {
    const r = this.recommendedItems(hero.heroId);
    return r.starting.map((id) => this.buy(hero, id)).filter((x) => x.ok).length;
  }

  // ================================================================== using items
  canUse(hero, slot) {
    const e = this.resolveSlot(hero, slot);
    if (!e) return fail('No item');
    return this.canCastItem(e.item, undefined, true);
  }

  canCastItem(item, target, skipTarget = false) {
    const hero = item.hero;
    const d = item.def;
    if (!hero?.alive) return fail('Dead');
    if (d.targetType === 'passive' || !d.active) return fail('Item has no active ability');
    const where = hero.homeScroll === item ? 'tp' : hero.inventory.includes(item) ? 'inventory' : hero.backpack.includes(item) ? 'backpack' : 'stash';
    if (where === 'backpack') return fail('Item is in the backpack');
    if (where === 'stash') return fail('Item is in the stash');
    if (hero.isStunned) return fail('Stunned');
    if (hero.hasState('morph')) return fail('Transformed');
    if (hero.hasState('muted')) return fail('Muted');
    if (item.cooldownRemaining > 0) return fail('Item is on cooldown');
    if (hero.mana < item.getManaCost()) return fail('Not enough mana');
    if ((d.consumable || d.keepAtZero) && item.charges <= 0 && d.id !== 'shifting_treads') return fail(d.id === 'bottle' ? 'Bottle is empty' : 'No charges');
    if (d.active.channel && hero.hasModifier('item_tp_channel')) return fail('Already channeling');
    if (d.id === 'flicker_dagger' && this.game.time - (hero.data.lastHeroDamageTime ?? -99) < 3) return fail('Flicker Dagger is disabled');
    if (skipTarget) return ok();
    const tt = d.targetType;
    if (tt === 'unit') {
      const t = target ?? (d.targetTeam !== 'enemy' ? hero : null);
      if (!isUnit(t)) return fail('Must target a unit');
      if (!t.alive) return fail('Target is dead');
      if (d.targetTeam === 'enemy' && t.team === hero.team) return fail('Must target an enemy');
      if (d.targetTeam === 'ally' && t.team !== hero.team) return fail('Must target an ally');
      if (t.isInvulnerable) return fail('Target is invulnerable');
      if (t.isStructure || t.kind === 'ward') return fail('Cannot target structures');
      if (t.team !== hero.team && t.isMagicImmune && d.id !== 'chasm_blade') return fail('Target is magic immune');
      if (t.team !== hero.team && !this.game.canSee(hero.team, t)) return fail('Target not visible');
      if (d.id === 'gilded_gauntlet') {
        if (t.kind === 'hero' || t.kind === 'grimmaw' || t.kind === 'ward' || /throneshard/.test(String(t.subtype ?? ''))) return fail("Can't target heroes or thrones");
      }
    } else if (tt === 'point') {
      if (!target) return fail('Must target a point');
    }
    return ok();
  }

  // hero.issueOrder-free use. Casts immediately when possible (items don't interrupt), else issues a cast order.
  use(hero, slot, target = null) {
    const e = this.resolveSlot(hero, slot);
    if (!e) return fail('No item');
    const item = e.item;
    const d = item.def;
    if (target && !isUnit(target) && target.x !== undefined && !(target instanceof THREE.Vector3)) target = new THREE.Vector3(target.x, target.y ?? 0, target.z);
    const tt = d.targetType;
    if (tt === 'unit' && !target && d.targetTeam !== 'enemy') target = hero;
    if (tt === 'point' && isUnit(target)) target = target.position.clone();
    const chk = this.canCastItem(item, target);
    if (!chk.ok) {
      if (hero === this.game.player?.hero) this.game.bus.emit('ui:error', { unit: hero, message: chk.reason });
      return chk;
    }
    if (tt === 'none' || tt === 'toggle') return this.castItem(item, null) ? ok() : fail('Failed');
    const range = item.getCastRange();
    const dist = tt === 'unit' ? (target === hero ? 0 : hero.edgeDistanceTo(target)) : hero.distanceTo(target);
    if (range <= 0 || dist <= range + 0.1 || d.id === 'flicker_dagger') {
      const tp = target.position ?? target;
      if (tp && target !== hero) hero.facing = Math.atan2(tp.x - hero.position.x, tp.z - hero.position.z);
      return this.castItem(item, target) ? ok() : fail('Failed');
    }
    const order = { type: 'cast', ability: item };
    if (tt === 'unit') order.target = target; else order.point = target;
    hero.issueOrder(order);
    return ok({ queued: true });
  }

  // Performs the item effect. Returns true on success.
  castItem(item, target) {
    const hero = item.hero;
    const d = item.def;
    const chk = this.canCastItem(item, target ?? (d.targetType === 'unit' && d.targetTeam !== 'enemy' ? hero : target));
    if (!chk.ok) return false;
    if (d.targetType === 'unit') target = target ?? hero;
    let res;
    try {
      res = this.activate(item, hero, target);
    } catch (e) {
      console.error('[items] activate failed', d.id, e);
      return false;
    }
    if (res === false) return false;
    if (d.manaCost) hero.spendMana(d.manaCost);
    this.startCooldown(hero, item);
    if (d.consumable && res !== 'keepCharge') {
      item.charges--;
      if (item.charges <= 0) this.removeItemInstance(hero, item);
    }
    this.game.bus.emit('item:used', { hero, item, target });
    this.game.audio?.play?.('item_' + d.id, { position: hero.position });
    return true;
  }

  startCooldown(hero, item, cd = item.getCooldown()) {
    if (!cd) return;
    for (const e of this.allItems(hero, { stash: false })) {
      if (e.item.def.id === item.def.id) { e.item.cooldownRemaining = cd; e.item.cooldownTotal = cd; }
    }
  }
  removeItemInstance(hero, item) {
    const e = this.allItems(hero).find((x) => x.item === item);
    if (e) this.removeAt(hero, e);
  }

  // ================================================================== active effects
  activate(item, hero, target) {
    const g = this.game;
    const d = item.def;
    const vfx = g.vfx;
    const pos = hero.position;
    switch (d.id) {
      case 'bark_ration':
        hero.addModifier({ id: 'item_bark_ration', name: 'Bark Ration', icon: '🌿', duration: 16, bonus: { hpRegen: 7 } });
        return true;
      case 'healing_salve':
        hero.addModifier(this.regenMod('item_salve', 'Healing Salve', '🧪', 10, { hpRegen: 40 }));
        vfx?.spawn?.('heal', { unit: hero, position: pos.clone(), color: 0x60ff60 });
        return true;
      case 'clarity':
        hero.addModifier(this.regenMod('item_clarity', 'Clarity', '💧', 25, { manaRegen: 6 }, true));
        return true;
      case 'honeyed_plum':
        hero.restoreMana(100);
        vfx?.floatingText?.('+100', pos.clone().setY(3), { color: '#5aa0ff' });
        return true;
      case 'wisp_ember':
        hero.heal(85, hero);
        vfx?.spawn?.('heal', { unit: hero, position: pos.clone(), color: 0xff80e0 });
        return true;
      case 'bottle':
        if (item.storedRune && g.runes?.activate) { const r = item.storedRune; item.storedRune = null; g.runes.activate(hero, r, { fromBottle: true }); return true; }
        item.charges--;
        hero.addModifier({ id: 'item_bottle', name: 'Bottle', icon: '🍾', duration: 2.5, bonus: { hpRegen: 44, manaRegen: 24 } });
        return true;
      case 'resonant_reed':
      case 'resonant_wand': {
        const n = item.charges;
        hero.heal(15 * n, hero);
        hero.restoreMana(15 * n);
        item.charges = 0;
        vfx?.spawn?.('heal', { unit: hero, position: pos.clone(), color: 0xc080ff });
        return true;
      }
      case 'lookout_ward':
      case 'seeker_ward':
        this.spawnWard(hero, target, d.id === 'seeker_ward' ? 'sentry' : 'observer');
        return true;
      case 'ashveil_powder':
        for (const u of g.alliesInRadius(hero.team, pos, d.radius, (u) => u.kind === 'hero' || u.owner === hero)) {
          u.addModifier(this.invisMod('item_smoke', 'Ashveil Powder', '🌫️', 35, { bonus: { moveSpeedPct: 0.15 }, smoke: true }));
        }
        vfx?.spawn?.('smoke', { position: pos.clone(), radius: d.radius, color: 0x8090a0 });
        return true;
      case 'glimmerdust':
        for (const u of g.unitsInRadius(pos, d.radius, (u) => u.team !== hero.team && u.team !== 'neutral')) u.addModifier(this.dustMod());
        vfx?.spawn?.('dust', { position: pos.clone(), radius: d.radius, color: 0xd0b0ff });
        return true;
      case 'homeward_scroll':
      case 'wayfarer_boots':
        return this.startTeleport(item, hero, target, d.id === 'wayfarer_boots') ? 'keepCharge' : false;
      case 'shifting_treads': {
        const order = ['str', 'int', 'agi'];
        item.treadsAttr = order[(order.indexOf(item.treadsAttr) + 1) % 3];
        this.markDirty(hero);
        return true;
      }
      case 'surge_boots':
        hero.addModifier({ id: 'item_surge', name: 'Surge', icon: '👟', duration: 3, bonus: { moveSpeedPct: hero.isMelee ? 0.2 : 0.1 } });
        return true;
      case 'tidecall_boots':
        for (const u of g.alliesInRadius(hero.team, pos, d.radius, (u) => u.kind === 'hero')) u.restoreMana(175);
        vfx?.spawn?.('mana', { position: pos.clone(), radius: d.radius, color: 0x4080ff });
        return true;
      case 'gilded_gauntlet': {
        const xp = (target.baseStats.bountyXp ?? 0) * 2.1;
        target.baseStats.bountyGold = [0, 0];
        target.baseStats.bountyXp = 0;
        vfx?.spawn?.('gold', { position: target.position.clone(), unit: target });
        target.die(hero);
        hero.addGold(160, 'gild');
        hero.addXp?.(xp);
        g.bus.emit('gold:popup', { unit: target, hero, amount: 160 });
        return true;
      }
      case 'frenzy_mask':
        hero.addModifier({ id: 'item_frenzy', name: 'Frenzy', icon: '👺', duration: 6, bonus: { attackSpeed: 110, moveSpeedPct: 0.3, armor: -8 } });
        return true;
      case 'clockwork_mender':
        for (const u of g.alliesInRadius(hero.team, pos, d.radius, (u) => u.kind === 'hero')) { u.heal(275, hero); vfx?.spawn?.('heal', { unit: u, position: u.position.clone() }); }
        return true;
      case 'keepers_greaves':
        this.dispel(hero, false);
        for (const u of g.alliesInRadius(hero.team, pos, d.radius, (u) => u.kind === 'hero')) {
          u.heal(350, hero); u.restoreMana(200);
          vfx?.spawn?.('heal', { unit: u, position: u.position.clone() });
        }
        return true;
      case 'crimson_bulwark':
        for (const u of g.alliesInRadius(hero.team, pos, d.radius, (u) => u.kind === 'hero' || u.isStructure)) {
          u.addModifier({ id: 'item_crimson_bulwark', name: 'Guard', icon: '🟥', duration: 12,
            onDamageTaken(v, info) { if (info.isAttack) info.amount = Math.max(0, info.amount - 72); } });
        }
        vfx?.spawn?.('shield', { position: pos.clone(), radius: d.radius, color: 0xff4040 });
        return true;
      case 'thrust_staff': {
        const t = target ?? hero;
        const dir = new THREE.Vector3(Math.sin(t.facing), 0, Math.cos(t.facing));
        const speed = du(600) / 0.4;
        t.addModifier({ id: 'item_thrust', name: 'Thrust', icon: '🦯', duration: 0.4,
          onTick(u, dt) { u.tryStep(dir.x * speed * dt, dir.z * speed * dt); u.path = []; } });
        vfx?.spawn?.('force', { unit: t, position: t.position.clone(), direction: dir });
        return true;
      }
      case 'shimmer_cloak': {
        const t = target ?? hero;
        g.delay(0.5, () => {
          if (!t.alive) return;
          t.addModifier(this.invisMod('item_glimmer', 'Shimmer Cloak', '🌌', 5, {}));
          let barrier = 450;
          t.addModifier({ id: 'item_shimmer_barrier', name: 'Shimmer Barrier', icon: '🌌', duration: 5,
            onDamageTaken(u, info) { if (info.type === 'magical' && barrier > 0) { const a = Math.min(barrier, info.amount); info.amount -= a; barrier -= a; } } });
        });
        vfx?.spawn?.('shield', { unit: t, position: t.position.clone(), color: 0x8060ff, duration: 5.5 });
        return true;
      }
      case 'whirlwind_scepter':
        this.cyclone(hero, target);
        return true;
      case 'silencing_bloom':
      case 'thornbloom':
        if (this.tryBlockSpell(target, hero)) return true;
        target.addModifier(this.soulBurnMod(hero, d.id === 'thornbloom'));
        vfx?.spawn?.('silence', { unit: target, position: target.position.clone(), color: 0xc040c0 });
        return true;
      case 'morphing_scythe':
        if (this.tryBlockSpell(target, hero)) return true;
        target.addModifier(this.morphMod(3.5));
        vfx?.spawn?.('morph', { unit: target, position: target.position.clone(), color: 0x8060ff });
        return true;
      case 'renewal_orb':
        for (const ab of hero.abilities ?? []) if (ab) ab.cooldownRemaining = 0;
        for (const e of this.allItems(hero)) if (e.item.def.id !== 'renewal_orb') e.item.cooldownRemaining = 0;
        vfx?.spawn?.('refresh', { unit: hero, position: pos.clone(), color: 0x40ffc0 });
        return true;
      case 'unbroken_standard': {
        const dur = Math.max(5, 9 - (hero.data.unbreakableUses ?? 0));
        hero.data.unbreakableUses = (hero.data.unbreakableUses ?? 0) + 1;
        this.dispel(hero, false);
        hero.addModifier({ id: 'item_unbreakable', name: 'Unbreakable', icon: '🏏', duration: dur, magicImmune: true, bonus: { magicResist: 0 } });
        const h = vfx?.attachToUnit?.(hero, 'unbreakable', { color: 0xffd040, duration: dur });
        if (!h) vfx?.spawn?.('shield', { unit: hero, position: pos.clone(), color: 0xffd040, duration: dur });
        return true;
      }
      case 'frostguard_mail': {
        let r = 0;
        const hit = new Set();
        const max = d.radius, speed = max / 0.9;
        hero.addModifier({ id: 'item_glacial_blast', name: 'Glacial Pulse', duration: 1.0, hidden: true,
          onTick: (u, dt) => {
            r = Math.min(max, r + speed * dt);
            for (const e of g.enemiesInRadius(u.team, u.position, r, (x) => !hit.has(x) && !x.isStructure && x.kind !== 'ward')) {
              hit.add(e);
              if (e.isMagicImmune) continue;
              e.takeDamage(200, 'magical', u, { ability: 'frostguard_mail' });
              e.addModifier({ id: 'item_glacial_slow', name: 'Glacial Pulse', icon: '❄️', debuff: true, duration: 4, slow: 0.4 });
            }
          } });
        vfx?.spawn?.('frost', { position: pos.clone(), radius: max, color: 0x80d0ff, duration: 1 });
        return true;
      }
      case 'mirror_mantle':
        this.dispel(hero, false);
        this.spawnIllusions(hero, 2, 20);
        return true;
      case 'hungering_blade':
        this.dispel(hero, false);
        hero.addModifier({ id: 'item_crimson_hunger', name: 'Crimson Hunger', icon: '😈', duration: 6, lifestealBonus: 1.75 });
        vfx?.spawn?.('blood', { unit: hero, position: pos.clone(), color: 0xff2020 });
        return true;
      case 'chasm_blade':
        if (this.tryBlockSpell(target, hero)) return true;
        target.addModifier({ id: 'item_crushing_blow', name: 'Crushing Blow', icon: '🌑', debuff: true, stun: true, duration: 2 });
        vfx?.spawn?.('stun', { unit: target, position: target.position.clone() });
        return true;
      case 'flicker_dagger': {
        const from = pos.clone();
        const dx = target.x - pos.x, dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        const max = item.getCastRange();
        const go = dist > max ? max * 0.8 : dist;
        const nx = dist > 1e-4 ? dx / dist : 0, nz = dist > 1e-4 ? dz / dist : 0;
        let tx = pos.x + nx * go, tz = pos.z + nz * go;
        const w = g.world;
        for (let i = 0; i < 20 && w?.isWalkable && !w.isWalkable(tx, tz); i++) { tx -= nx * 0.5; tz -= nz * 0.5; }
        hero.position.x = tx; hero.position.z = tz;
        hero.path = [];
        if (dist > 1e-4) hero.facing = Math.atan2(nx, nz);
        vfx?.spawn?.('blink', { position: from, color: 0x6080ff });
        vfx?.spawn?.('blink', { position: hero.position.clone(), color: 0x6080ff });
        g.audio?.play?.('blink', { position: hero.position });
        return true;
      }
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- effect helpers
  regenMod(id, name, icon, duration, bonus, manaOnly = false) {
    const sys = this;
    return {
      id, name, icon, duration, bonus,
      onDamageTaken(u, info) {
        if (!(info.amount > 0)) return;
        const s = info.source;
        const hostile = s && s.team !== u.team && (heroOf(s) || s.kind === 'tower' || s.kind === 'grimmaw');
        if (hostile && !(manaOnly && !heroOf(s))) sys.defer(() => u.removeModifier(id));
      },
    };
  }

  invisMod(id, name, icon, duration, extra = {}) {
    const g = this.game;
    const sys = this;
    return {
      id, name, icon, duration, invisible: true, breakOnAttack: true, breakOnCast: true, appliedFrame: g.frame, ...extra,
      onAttackStart(u) { sys.defer(() => u.removeModifier(id)); },
      onTick(u) {
        if (!this.smoke || g.frame % 6 !== u.id % 6) return;
        const near = g.enemiesInRadius(u.team, u.position, du(1025), (e) => e.kind === 'hero' || e.kind === 'tower');
        if (near.length) u.removeModifier(id);
      },
    };
  }

  dustMod() {
    return {
      id: 'item_glimmerdust', name: 'Glimmerdust', icon: '✨', debuff: true, duration: 12, slow: 0.2,
      onTick(u) { for (const m of u.modifiers) if (m.invisible && m !== this) { m.invisible = false; m._dusted = true; } },
      onExpire(u) { for (const m of u.modifiers) if (m._dusted) { m.invisible = true; m._dusted = false; } },
    };
  }

  soulBurnMod(caster, thornbloom) {
    const g = this.game;
    return {
      id: thornbloom ? 'item_thornbloom' : 'item_silencing_bloom', name: thornbloom ? 'Rend' : 'Wither', icon: thornbloom ? '🩸' : '🌸',
      debuff: true, silence: true, duration: 5, stored: 0,
      onDamageTaken(u, info) {
        if (thornbloom && info.isAttack && info.source && info.source.team !== u.team) { info.amount *= 1.45; info.bloodthornCrit = true; }
        if (!info.soulBurn) this.stored += Math.max(0, info.amount);
      },
      onExpire(u) {
        if (!u.alive || this.remaining > 0 || this.stored <= 0) return;
        const dmg = this.stored * 0.3;
        g.delay(0, () => u.alive && u.takeDamage(dmg, 'magical', caster, { ability: 'silencing_bloom', soulBurn: true }));
      },
    };
  }

  morphMod(duration) {
    return {
      id: 'item_morph', name: 'Beastshape', icon: '🐑', debuff: true, morph: true, duration, slow: 0.5,
      onApply(u) {
        u.interrupt?.();
        try {
          const grp = new THREE.Group();
          const wool = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 1 });
          const dark = new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.8 });
          const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), wool);
          body.scale.set(1, 0.85, 1.3); body.position.y = 0.75; grp.add(body);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), dark);
          head.position.set(0, 0.95, 0.72); grp.add(head);
          for (const [x, z] of [[-0.25, 0.35], [0.25, 0.35], [-0.25, -0.35], [0.25, -0.35]]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 6), dark);
            leg.position.set(x, 0.22, z); grp.add(leg);
          }
          grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          this._sheep = grp;
          if (u.model?.root) { this._wasVisible = u.model.root.visible; u.model.root.visible = false; }
          u.object?.add(grp);
        } catch { /* headless or no three scene */ }
      },
      onTick(u) { if (this._sheep) this._sheep.position.y = Math.abs(Math.sin(u.game.time * 10)) * 0.08 * (u.state === 'moving' ? 1 : 0); },
      onExpire(u) {
        if (this._sheep) {
          this._sheep.parent?.remove(this._sheep);
          this._sheep.traverse((o) => { o.geometry?.dispose?.(); });
          this._sheep = null;
        }
        if (u.model?.root) u.model.root.visible = this._wasVisible ?? true;
      },
    };
  }

  cyclone(caster, target) {
    const g = this.game;
    const enemy = target.team !== caster.team;
    if (enemy && this.tryBlockSpell(target, caster)) return;
    if (!enemy) this.dispel(target, false);
    target.addModifier({
      id: 'item_whirlwind', name: 'Whirlwind', icon: '🌪️', debuff: enemy, stun: true, invulnerable: true, duration: 2.5, t: 0,
      onTick(u, dt) {
        this.t += dt;
        const r = u.model?.root;
        if (r) { r.position.y = Math.min(1, this.t * 3) * (2.2 + Math.sin(this.t * 6) * 0.25); r.rotation.y += dt * 12; }
      },
      onExpire(u) {
        const r = u.model?.root;
        if (r) { r.position.y = 0; r.rotation.y = 0; }
        if (enemy && u.alive) g.delay(0, () => u.alive && u.takeDamage(50, 'magical', caster, { ability: 'whirlwind_scepter' }));
      },
    });
    g.vfx?.spawn?.('cyclone', { unit: target, position: target.position.clone(), duration: 2.5, color: 0xc0f0ff });
  }

  // Basic dispel (strong also removes stuns). Removes debuffs from `unit`.
  dispel(unit, strong = false) {
    for (const m of [...unit.modifiers]) {
      if (!m.debuff || m.undispellable) continue;
      if (!strong && (m.stun || m.morph) ) continue;
      unit.removeModifier(m);
    }
  }

  // Warding Sphere. Ability code may call game.items.tryBlockSpell(target, caster) for targeted spells.
  tryBlockSpell(target, caster) {
    if (!target || !caster || target.team === caster?.team) return false;
    const agg = target.data?.itemAgg;
    if (!agg?.spellBlock) return false;
    const now = this.game.time;
    if ((target.data.spellBlockReadyAt ?? 0) > now) return false;
    target.data.spellBlockReadyAt = now + agg.spellBlock;
    this.game.vfx?.spawn?.('shield', { unit: target, position: target.position.clone(), color: 0x40a0ff, duration: 0.8 });
    this.game.bus.emit('item:spellBlocked', { unit: target, caster });
    return true;
  }

  spawnWard(hero, point, type) {
    const g = this.game;
    const p = new THREE.Vector3(point.x, 0, point.z);
    const obs = type === 'observer';
    const ward = g.spawnUnit({
      kind: 'ward', subtype: type, name: obs ? 'Lookout Ward' : 'Seeker Ward', team: hero.team, position: p,
      modelKind: 'ward', owner: hero, immobile: true,
      stats: { maxHp: 4, hpRegen: 0, manaRegen: 0, armor: 0, magicResist: 0, damageMin: 0, damageMax: 0, attackRange: 0,
        acquireRange: 0, moveSpeed: 0, collisionRadius: 0.3, vision: obs ? du(1600) : du(150), bountyGold: [0, 0], bountyXp: 0 },
      data: { ward: type, trueSight: obs ? 0 : du(900), trueSightRadius: obs ? 0 : du(900), sentry: !obs },
    });
    ward.addModifier({ id: 'ward_invis', name: 'Invisible', invisible: true, undispellable: true, hidden: true });
    ward.addModifier({ id: 'ward_disarm', disarm: true, hidden: true, undispellable: true,
      onDamageTaken(u, info) { info.amount = info.isAttack ? (heroOf(info.source) ? 1 : 0.25) : 0; } });
    ward.addModifier({ id: 'ward_life', name: 'Ward', hidden: true, duration: obs ? 360 : 420, undispellable: true,
      onExpire(u) { if (this.remaining <= 0 && u.alive) g.delay(0, () => u.alive && u.die(null)); } });
    g.vfx?.spawn?.('spawn', { position: p.clone(), color: obs ? 0xffd060 : 0x60a0ff });
    g.bus.emit('ward:placed', { hero, ward, type });
    return ward;
  }

  spawnIllusions(hero, count, duration) {
    const g = this.game;
    const out = [];
    const angle0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = angle0 + (i / count) * Math.PI * 2;
      const pos = hero.position.clone().add(new THREE.Vector3(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6));
      const bonusDmg = hero.bonusFromSources('damage');
      let ill;
      try {
        ill = g.spawnUnit({
          kind: 'summon', subtype: 'illusion', name: hero.name, team: hero.team, position: pos, modelKind: 'illusion', owner: hero,
          stats: {
            maxHp: hero.getStat('maxHp'), maxMana: 0, hpRegen: hero.getStat('hpRegen'), manaRegen: 0,
            armor: hero.getStat('armor'), magicResist: hero.getStat('magicResist'),
            damageMin: (hero.getStat('damageMin') + bonusDmg) * 0.33, damageMax: (hero.getStat('damageMax') + bonusDmg) * 0.33,
            attackRange: hero.getStat('attackRange'), bat: hero.getStat('bat'), attackSpeed: hero.getStat('attackSpeed'),
            attackPoint: hero.getStat('attackPoint'), projectileSpeed: hero.getStat('projectileSpeed'),
            moveSpeed: hero.getStat('moveSpeed'), turnRate: hero.getStat('turnRate'), collisionRadius: hero.radius,
            vision: hero.getStat('vision'), acquireRange: hero.getStat('acquireRange'), bountyGold: [10, 14], bountyXp: 0,
          },
          data: { isIllusion: true, illusionOf: hero, heroId: hero.heroId, heroModel: hero.def?.model ?? hero.heroId, projectileKind: hero.data.projectileKind ?? hero.modelKind },
        });
      } catch (e) { console.warn('[items] illusion spawn failed', e); continue; }
      ill.isIllusion = true;
      ill.hp = ill.getStat('maxHp') * hero.healthPct;
      ill.facing = hero.facing;
      ill.addModifier({ id: 'illusion', name: 'Illusion', icon: '🌊', duration, bonus: { incomingDamagePct: 2.5 }, undispellable: true,
        onExpire(u) { if (this.remaining <= 0 && u.alive) { u.baseStats.bountyGold = [0, 0]; g.delay(0, () => u.alive && u.die(null)); } } });
      ill.controller = {
        t: 0,
        update(u, dt) {
          this.t -= dt;
          if (this.t > 0) return;
          this.t = 0.35;
          const h = u.owner;
          if (!h?.alive) { u.baseStats.bountyGold = [0, 0]; u.die(null); return; }
          const tgt = h.attackTarget ?? (h.order?.type === 'attack' ? h.order.target : null);
          if (tgt && u.canAttack(tgt)) { if (u.order.target !== tgt) u.issueOrder({ type: 'attack', target: tgt }); }
          else if (u.order.type !== 'attackMove' && u.distanceTo(h) > 7) u.issueOrder({ type: 'follow', target: h });
          else if (u.order.type === 'follow' && u.distanceTo(h) <= 4) u.issueOrder({ type: 'attackMove', point: h.position.clone() });
        },
      };
      g.vfx?.spawn?.('spawn', { position: pos.clone(), color: 0x60a0ff });
      out.push(ill);
    }
    // Shuffle the hero's position with an illusion to confuse enemies
    if (out.length && Math.random() < 0.67) {
      const o = out[Math.floor(Math.random() * out.length)];
      const tmp = hero.position.clone();
      hero.position.copy(o.position);
      o.position.copy(tmp);
    }
    g.bus.emit('illusions:spawned', { hero, units: out });
    return out;
  }

  // ---------------------------------------------------------------- TP / channel
  teleportDestination(hero, point, allowUnits) {
    const g = this.game;
    const cands = g.units.filter((u) => u.alive && u.team === hero.team && u !== hero &&
      (u.isStructure || (allowUnits && (u.kind === 'creep')) ));
    let best = null, bd = Infinity;
    for (const u of cands) {
      const dd = Math.hypot(u.position.x - point.x, u.position.z - point.z);
      if (dd < bd) { bd = dd; best = u; }
    }
    const f = FOUNTAIN[hero.team];
    const fd = Math.hypot(f[0] - point.x, f[1] - point.z);
    let base, radius;
    if (!best || fd < bd) { base = new THREE.Vector3(f[0], 0, f[1]); radius = 5; }
    else { base = best.position.clone(); radius = (best.radius ?? 1) + (best.isStructure ? 3.5 : 1.2); }
    const dx = point.x - base.x, dz = point.z - base.z;
    const dd = Math.hypot(dx, dz);
    const off = Math.min(dd, radius);
    const dest = new THREE.Vector3(base.x + (dd > 1e-4 ? (dx / dd) * off : radius), 0, base.z + (dd > 1e-4 ? (dz / dd) * off : 0));
    return dest;
  }

  startTeleport(item, hero, point, allowUnits) {
    const g = this.game;
    if (!point) return false;
    const dest = this.teleportDestination(hero, point, allowUnits);
    const duration = item.def.active.channel ?? 3;
    const sys = this;
    hero.interrupt?.();
    hero.attackTarget = null;
    hero.orderQueue.length = 0;
    hero.path = [];
    hero.state = 'casting';
    hero.playAnim?.('cast', { once: false });
    const endFx = g.vfx?.spawn?.('teleport', { position: dest.clone(), duration, color: hero.team === 'sunward' ? 0x60ff80 : 0xff6040 });
    const startFx = g.vfx?.spawn?.('teleport', { position: hero.position.clone(), unit: hero, duration, color: 0x80c0ff });
    hero.data.channeling = { itemId: item.def.id, start: g.time, duration, dest: dest.clone() };
    hero.addModifier({
      id: 'item_tp_channel', name: 'Teleporting', icon: '📜', duration, root: true, disarm: true, channel: true,
      startFrame: g.frame, cancelled: false, endFx, startFx,
      onTick(u) { if (u.isStunned || u.hasState('morph')) sys.defer(() => sys.cancelChannel(u)); },
      onExpire(u) {
        u.data.channeling = null;
        if (this.cancelled || this.remaining > 0 || !u.alive) {
          for (const fx of [this.endFx, this.startFx]) { fx?.dispose?.(); fx?.remove?.(); }
          return;
        }
        const from = u.position.clone();
        u.position.set(dest.x, 0, dest.z);
        u.path = [];
        u.order = { type: 'idle' };
        u.state = 'idle';
        u.playAnim?.('idle');
        const cur = item.hero === u ? item : null;
        if (cur) { cur.charges--; if (cur.def.consumable && cur.charges <= 0) sys.removeItemInstance(u, cur); }
        g.bus.emit('item:teleported', { hero: u, from, to: dest.clone() });
        g.vfx?.spawn?.('teleport', { position: dest.clone(), duration: 0.6, color: 0xffffff });
        if (u === g.player?.hero) { g.cameraCtl?.focus?.(dest.x, dest.z); g.bus.emit('camera:focus', { x: dest.x, z: dest.z, position: dest.clone() }); }
      },
    });
    g.bus.emit('item:channelStart', { hero, item, duration, dest });
    return true;
  }

  cancelChannel(hero) {
    const m = hero.modifiers.find((x) => x.id === 'item_tp_channel');
    if (!m) return;
    m.cancelled = true;
    hero.removeModifier(m);
    hero.data.channeling = null;
    this.game.bus.emit('item:channelCancel', { hero });
  }

  // ================================================================== passives
  markDirty(hero) { if (hero?.data) hero.data.itemsDirty = true; }

  // Aggregate the hero's inventory passives into hero.data.itemAgg and the shared passive modifier.
  recompute(hero) {
    const agg = {
      crits: [], bash: null, lifesteal: 0, cleave: null, corruption: null, evasion: 0, block: null, trueStrike: false,
      proc: null, chain: null, creepBonus: null, auras: new Set(), heartRegen: 0, spellBlock: 0, echo: 0, bonus: {},
    };
    let miss = 1;
    const melee = hero.isMelee;
    const addBonus = (b) => { for (const k in b) agg.bonus[k] = (agg.bonus[k] ?? 0) + b[k]; };
    for (const it of hero.inventory) {
      if (!it) continue;
      const d = it.def, p = d.passive ?? {};
      if (d.bonus.evasion) miss *= 1 - d.bonus.evasion;
      if (d.bonus.lifesteal) agg.lifesteal = Math.max(agg.lifesteal, d.bonus.lifesteal);
      if (p.crit) agg.crits.push(p.crit);
      if (p.bash && (!agg.bash || p.bash.chance > agg.bash.chance)) agg.bash = p.bash;
      if (p.cleave) agg.cleave = p.cleave;
      if (p.corruption && (!agg.corruption || p.corruption.armor < agg.corruption.armor)) agg.corruption = p.corruption;
      if (p.block && (!agg.block || p.block.melee > agg.block.melee)) agg.block = p.block;
      if (p.trueStrike) agg.trueStrike = true;
      if (p.proc && (!agg.proc || p.proc.damage > agg.proc.damage)) agg.proc = p.proc;
      if (p.chain) agg.chain = p.chain;
      if (p.creepBonus && (!agg.creepBonus || p.creepBonus.melee > agg.creepBonus.melee)) agg.creepBonus = p.creepBonus;
      if (p.aura) agg.auras.add(p.aura);
      if (p.heartRegen) agg.heartRegen = Math.max(agg.heartRegen, p.heartRegen);
      if (p.spellBlock) agg.spellBlock = p.spellBlock;
      if (p.echo) agg.echo = p.echo;
      if (d.meleeBonus && melee) addBonus(d.meleeBonus);
      if (d.rangedBonus && !melee) addBonus(d.rangedBonus);
      if (it.treadsAttr) addBonus({ [it.treadsAttr]: d.passive.treads ?? 10 });
    }
    agg.evasion = 1 - miss;
    hero.data.itemAgg = agg;
    hero.data.hasScepter = hero.inventory.some((it) => it?.def.id === 'ascendant_scepter') || !!hero.data.scepterConsumed;
    // Pyre Brand glow
    if (agg.auras.has('pyre_brand') && !hero.data.pyreFx) hero.data.pyreFx = this.game.vfx?.attachToUnit?.(hero, 'pyre_brand', { radius: du(700), color: 0xffb030 }) ?? true;
    if (!agg.auras.has('pyre_brand') && hero.data.pyreFx) {
      const fx = hero.data.pyreFx;
      if (fx !== true) { fx.dispose?.(); fx.remove?.(); fx.parent?.remove?.(fx); }
      hero.data.pyreFx = null;
    }
    const mod = this.ensurePassiveMod(hero);
    if (mod) {
      for (const k of Object.keys(mod.bonus)) delete mod.bonus[k];
      Object.assign(mod.bonus, agg.bonus);
      mod.staticBonus = { ...agg.bonus };
    }
  }

  ensurePassiveMod(hero) {
    if (!hero.alive) return null;
    let m = hero.modifiers.find((x) => x.id === 'items_passive');
    if (m) return m;
    const sys = this;
    m = hero.addModifier({
      id: 'items_passive', name: 'Items', hidden: true, undispellable: true, bonus: {}, staticBonus: {}, _auraT: 0, _burnT: 0,
      onTick(u, dt) { sys.passiveTick(u, this, dt); },
      onAttackStart(u, target, info) { sys.passiveAttackStart(u, target, info); },
      onAttackLanded(u, target, landed) { sys.passiveAttackLanded(u, target, landed); },
      onDamageTaken(u, info) { sys.passiveDamageTaken(u, info); },
    });
    return m;
  }

  passiveTick(u, m, dt) {
    const agg = u.data.itemAgg;
    if (!agg) return;
    const g = this.game;
    if (agg.heartRegen) m.bonus.hpRegen = (m.staticBonus.hpRegen ?? 0) + agg.heartRegen * u.getStat('maxHp');
    else if (m.bonus.hpRegen !== m.staticBonus.hpRegen) m.bonus.hpRegen = m.staticBonus.hpRegen ?? 0;
    if (!agg.auras.size) return;
    m._auraT -= dt;
    if (m._auraT <= 0) {
      m._auraT = 0.5;
      if (agg.auras.has('assault')) {
        for (const a of g.alliesInRadius(u.team, u.position, du(1200), (x) => x.kind !== 'ward')) {
          a.addModifier({ id: 'aura_assault', name: 'Siege Cuirass', icon: '🛡️', duration: 1, bonus: { attackSpeed: 30, armor: 5 }, undispellable: true });
        }
        for (const e of g.enemiesInRadius(u.team, u.position, du(1200), (x) => x.kind !== 'ward')) {
          e.addModifier({ id: 'aura_assault_neg', name: 'Siege Cuirass', icon: '🛡️', debuff: true, duration: 1, bonus: { armor: -5 }, undispellable: true });
        }
      }
      if (agg.auras.has('frostguard')) {
        for (const e of g.enemiesInRadius(u.team, u.position, du(1200), (x) => !x.isStructure && x.kind !== 'ward')) {
          e.addModifier({ id: 'aura_frostguard', name: "Frostguard Mail", icon: '❄️', debuff: true, duration: 1, bonus: { attackSpeed: -45 }, undispellable: true });
        }
      }
    }
    if (agg.auras.has('pyre_brand')) {
      m._burnT -= dt;
      if (m._burnT <= 0) {
        m._burnT = 1;
        for (const e of g.enemiesInRadius(u.team, u.position, du(700), (x) => !x.isStructure && x.kind !== 'ward')) {
          e.takeDamage(60, 'magical', u, { ability: 'pyre_brand', noEvent: e.kind !== 'hero' });
          if (!e.alive && e.kind !== 'hero') { /* kill credit handled by die(source) */ }
        }
      }
    }
  }

  passiveAttackStart(u, target, info) {
    const agg = u.data.itemAgg;
    // Breaking invisibility on attack (smoke / glimmer / shadow)
    for (const m of u.modifiers) if (m.breakOnAttack) { const id = m.id; this.defer(() => u.removeModifier(id)); }
    if (!agg || !target) return;
    if (agg.creepBonus && CREEP_KINDS.has(target.kind) && !target.data?.isIllusion) info.amount += u.isMelee ? agg.creepBonus.melee : agg.creepBonus.ranged;
    if (agg.crits.length && !target.isStructure) {
      let best = 1;
      for (const c of agg.crits) if (Math.random() < c.chance) best = Math.max(best, c.mult);
      if (best > 1) { info.amount *= best; info.crit = true; info.critMult = best; }
    }
    if (agg.trueStrike) info.trueStrike = true;
  }

  passiveAttackLanded(u, target, landed) {
    const agg = u.data.itemAgg;
    if (!agg || !target || !(landed.dealt > 0)) return;
    const g = this.game;
    const structure = target.isStructure;
    // Lifesteal (not from buildings / wards)
    const rage = u.modifiers.find((m) => m.lifestealBonus);
    const ls = agg.lifesteal + (rage?.lifestealBonus ?? 0);
    if (ls > 0 && !structure && target.kind !== 'ward') {
      u.heal(landed.dealt * ls, u);
      if (landed.dealt * ls > 20) g.vfx?.spawn?.('lifesteal', { unit: u, position: u.position.clone(), color: 0xff3040 });
    }
    if (agg.corruption) {
      target.addModifier({ id: 'item_corruption', name: 'Corruption', icon: '🔥', debuff: true, duration: agg.corruption.duration, bonus: { armor: agg.corruption.armor } });
    }
    if (structure || target.kind === 'ward') return;
    if (agg.bash) {
      const b = agg.bash;
      const chance = u.isMelee ? b.chance : b.rangedChance;
      if ((u.data.bashReadyAt ?? 0) <= g.time && Math.random() < chance) {
        u.data.bashReadyAt = g.time + b.cooldown;
        target.addModifier({ id: 'item_bash', name: 'Bashed', icon: '🔨', debuff: true, stun: true, duration: b.duration });
        target.takeDamage(b.damage, 'physical', u, { ability: 'bash' });
        g.vfx?.spawn?.('stun', { unit: target, position: target.position.clone(), duration: b.duration });
        g.bus.emit('item:bash', { unit: u, target });
      }
    }
    if (agg.proc && target.alive && !target.isMagicImmune && Math.random() < agg.proc.chance) {
      target.takeDamage(agg.proc.damage, 'magical', u, { ability: 'pierce' });
    }
    if (agg.chain && Math.random() < agg.chain.chance) this.chainLightning(u, target, agg.chain);
    if (agg.cleave && u.isMelee) {
      const fx = Math.sin(u.facing), fz = Math.cos(u.facing);
      const dmg = landed.amount * agg.cleave.pct;
      for (const e of g.enemiesInRadius(u.team, target.position, agg.cleave.radius * 0.6, (x) => x !== target && !x.isStructure && x.kind !== 'ward')) {
        const dx = e.position.x - u.position.x, dz = e.position.z - u.position.z;
        const dd = Math.hypot(dx, dz) || 1;
        if ((dx * fx + dz * fz) / dd < 0.3 || dd > agg.cleave.radius) continue;
        e.takeDamage(dmg, 'pure', u, { ability: 'cleave' });
      }
      g.vfx?.spawn?.('cleave', { unit: u, position: target.position.clone(), direction: new THREE.Vector3(fx, 0, fz) });
    }
    if (agg.echo && u.isMelee && (u.data.echoReadyAt ?? 0) <= g.time) {
      u.data.echoReadyAt = g.time + agg.echo;
      u.attackCooldown = 0;
      target.addModifier({ id: 'item_twinstrike_slow', name: 'Twinstrike Slow', icon: '🔊', debuff: true, duration: 0.8, slow: 1 });
    }
  }

  chainLightning(u, first, c) {
    const g = this.game;
    const hit = new Set();
    let cur = first, prev = u;
    for (let i = 0; i < c.bounces + 1 && cur; i++) {
      hit.add(cur);
      if (!cur.isMagicImmune) cur.takeDamage(c.damage, 'magical', u, { ability: 'stormcoil' });
      g.vfx?.spawn?.('lightning', { position: prev.position.clone(), target: cur.position.clone(), unit: cur, color: 0x80c0ff });
      prev = cur;
      const next = g.enemiesInRadius(u.team, cur.position, c.radius, (x) => !hit.has(x) && !x.isStructure && x.kind !== 'ward');
      next.sort((a, b) => a.distanceTo(cur) - b.distanceTo(cur));
      cur = next[0] ?? null;
    }
  }

  passiveDamageTaken(u, info) {
    const agg = u.data.itemAgg;
    if (!agg || !info.isAttack || !info.source || info.source.team === u.team) return;
    const src = info.source;
    if (agg.evasion > 0 && !src.data?.itemAgg?.trueStrike && !u.hasModifier('item_thornbloom') && Math.random() < agg.evasion) {
      info.amount = 0;
      info.evaded = true;
      this.game.vfx?.floatingText?.('Miss', u.position.clone().setY(3), { color: '#ffffff', size: 0.8 });
      this.game.bus.emit('attack:miss', { unit: u, source: src });
      return;
    }
    if (agg.block && !src.isStructure && info.amount > 0) {
      info.amount = Math.max(0, info.amount - (u.isMelee ? agg.block.melee : agg.block.ranged));
    }
  }

  onSpellCast(hero, _isSpell) {
    if (!hero) return;
    const g = this.game;
    // Casting breaks invisibility
    for (const m of hero.modifiers ?? []) if (m.breakOnCast && m.appliedFrame !== g.frame) { const id = m.id; this.defer(() => hero.removeModifier(id)); }
    if (hero.kind !== 'hero') return;
    for (const h of g.heroes) {
      if (h.team === hero.team || !h.alive || h.distanceTo(hero) > du(1200)) continue;
      for (const it of [...h.inventory, ...h.backpack]) {
        if (it?.def.passive?.stick) it.charges = Math.min(it.def.passive.stick, it.charges + 1);
      }
    }
  }

  onUnitDied(unit, killer) {
    if (unit?.kind !== 'hero') {
      if (unit?.kind === 'ward') {
        const kh = heroOf(killer);
        if (kh && kh.team !== unit.team) { const gold = unit.subtype === 'observer' ? 100 : 50; kh.addGold(gold, 'ward'); this.game.bus.emit('gold:popup', { unit, hero: kh, amount: gold }); }
      }
      return;
    }
    if (unit.data.channeling) unit.data.channeling = null;
    // Fateblade drops to the killer
    const kh = heroOf(killer);
    for (let i = 0; i < unit.inventory.length; i++) {
      const it = unit.inventory[i];
      if (!it?.def.passive?.dropsOnDeath) continue;
      if (!kh || kh === unit) continue;
      unit.inventory[i] = null;
      it.purchaseTime = -999;
      if (!this.giveItem(kh, it)) this.putInStash(kh, it);
      this.game.bus.emit('item:dropped', { hero: unit, item: it, pickedBy: kh });
      this.game.bus.emit('ui:message', { text: `${kh.name} picked up Fateblade from ${unit.name}!`, color: '#ffd040' });
    }
    this.markDirty(unit);
    this.markDirty(kh);
  }

  defer(fn) { this._deferred.push(fn); }

  // ================================================================== update
  update(dt) {
    const g = this.game;
    if (this._deferred.length) {
      const list = this._deferred.splice(0);
      for (const fn of list) { try { fn(); } catch (e) { console.error('[items] deferred', e); } }
    }
    if (!(dt > 0)) return;
    for (const team in this.stock) {
      for (const id in this.stock[team]) {
        const s = this.stock[team][id], def = ITEM_DEFS[id];
        if (s.count >= def.stock.max) { s.timer = def.stock.restock; continue; }
        s.timer -= dt;
        if (s.timer <= 0) { s.count++; s.timer = def.stock.restock; }
      }
    }
    for (const hero of g.heroes) {
      try { this.updateHero(hero, dt); } catch (e) { if (!this._heroErr) { console.error('[items] hero update', e); this._heroErr = true; } }
    }
  }

  updateHero(hero, dt) {
    const g = this.game;
    // cooldowns everywhere (inventory items are also ticked by Hero.update; ItemInstance guards against double ticks)
    for (const e of this.allItems(hero)) e.item.update?.(dt);
    // detect external inventory changes
    const sig = hero.inventory.map((it) => (it ? it.def.id + (it.treadsAttr ?? '') : '-')).join(',') + (hero.isMelee ? 'm' : 'r');
    if (sig !== hero.data.itemSig) { hero.data.itemSig = sig; hero.data.itemsDirty = true; }
    // re-add passive modifier after death / purge
    if (hero.alive && !hero.modifiers.some((m) => m.id === 'items_passive')) hero.data.itemsDirty = true;
    if (hero.data.itemsDirty && hero.alive) { hero.data.itemsDirty = false; this.recompute(hero); }
    if (!hero.alive) return;
    // bottle refill at fountain
    if (this.inFountain(hero)) for (const it of hero.inventory) if (it?.def.id === 'bottle') it.charges = it.def.maxCharges;
    // stash delivery
    if (hero.stash.length) {
      if (this.inShopRange(hero) === 'base') this.deliverStash(hero);
      else if (this.autoCourier) {
        const c = hero.data.courier;
        if (!c) {
          const f = FOUNTAIN[hero.team];
          const dist = Math.hypot(hero.position.x - f[0], hero.position.z - f[1]);
          hero.data.courier = { eta: g.time + Math.max(3, dist / COURIER_SPEED) };
          g.bus.emit('courier:dispatched', { hero, eta: hero.data.courier.eta });
        } else if (g.time >= c.eta) {
          hero.data.courier = null;
          const n = this.deliverStash(hero);
          if (n && hero === g.player?.hero) g.bus.emit('ui:message', { text: 'Courier delivered your items', color: '#9fd08a' });
        }
      }
    } else hero.data.courier = null;
  }

  deliverStash(hero) {
    let n = 0;
    for (const it of [...hero.stash]) {
      const where = this.giveItem(hero, it, { allowStash: false });
      if (!where) continue;
      hero.stash.splice(hero.stash.indexOf(it), 1);
      n++;
    }
    if (n) { this.autoCombine(hero); this.markDirty(hero); this.game.bus.emit('courier:delivered', { hero, count: n }); }
    return n;
  }
}
