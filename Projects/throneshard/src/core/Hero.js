import { Unit } from './Unit.js';
import { XP_TABLE, MAX_LEVEL, respawnTime, du, FOUNTAIN, STARTING_GOLD } from './constants.js';

// Hero definition shape (see src/gameplay/heroes/HeroDefs.js):
// { id, name, title, primary: 'str'|'agi'|'int'|'uni', model, icon, color, attackType: 'melee'|'ranged',
//   str, agi, int, strGain, agiGain, intGain, baseArmor, baseDamage: [min,max], moveSpeed (game units),
//   attackRange (game units), bat, attackPoint, projectileSpeed (game units, 0 melee), baseHpRegen, baseManaRegen,
//   abilities: [q, w, e, r] ability ids, roles: [], lore }
export class Hero extends Unit {
  constructor(game, def, opts) {
    super(game, {
      ...opts,
      kind: 'hero',
      name: def.name,
      modelKind: def.model ?? def.id,
      stats: {
        maxHp: 120, maxMana: 75,
        hpRegen: def.baseHpRegen ?? 1.0, manaRegen: def.baseManaRegen ?? 0.5,
        armor: def.baseArmor ?? 1, magicResist: 0.25,
        damageMin: def.baseDamage?.[0] ?? 30, damageMax: def.baseDamage?.[1] ?? 36,
        attackRange: du(def.attackRange ?? 150),
        bat: def.bat ?? 1.7,
        attackSpeed: 100,
        attackPoint: def.attackPoint ?? 0.4,
        projectileSpeed: def.projectileSpeed ? du(def.projectileSpeed) : 0,
        moveSpeed: du(def.moveSpeed ?? 300),
        turnRate: def.turnRate ?? 10,
        collisionRadius: 0.7,
        vision: 22,
        acquireRange: du(def.attackType === 'ranged' ? 800 : 600),
      },
    });
    this.def = def;
    this.heroId = def.id;
    this.level = 1;
    this.xp = 0;
    this.gold = STARTING_GOLD;
    this.abilityPoints = 1;
    this.abilities = []; // Ability instances, index 0..3 = Q W E R (filled by game.abilities)
    this.inventory = [null, null, null, null, null, null]; // Item instances (filled by game.items)
    this.backpack = [null, null, null];
    this.stash = [];
    this.neutralItem = null;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.lastHits = 0; this.denies = 0;
    this.streak = 0;
    this.respawnTimer = 0;
    this.buybackCooldown = 0;
    this.buybacks = 0;
    // Talents (levels 10/15/20/25): chosen[tier] = 0|1; talentBonus = flat stat bonuses from talents;
    // talentMods[abilityId][valueKey] = additive ability value changes (read by Ability.v / getCooldown ...).
    this.talents = {};
    this.talentBonus = {};
    this.talentMods = {};
    this.isBot = opts.isBot ?? true;
    this.damageContributors = new Map(); // heroId -> last time damaged by (for assists)
    this.lane = opts.lane ?? null;
    this.hp = this.getStat('maxHp');
    this.mana = this.getStat('maxMana');
  }

  // Attributes include per-level gains and bonuses from items/modifiers.
  attr(a) {
    const base = this.def[a] + this.def[a + 'Gain'] * (this.level - 1);
    return base + this.bonusFromSources(a) + this.bonusFromSources('allStats');
  }

  getStat(name) {
    if (!this.def) return super.getStat(name);
    // attributes are only evaluated for the stats that use them (hot path: getStat is called per unit per frame)
    const p = this.def.primary;
    let extra = 0;
    switch (name) {
      case 'maxHp': extra = this.attr('str') * 22; break;
      case 'maxMana': extra = this.attr('int') * 12; break;
      case 'hpRegen': extra = this.attr('str') * 0.1; break;
      case 'manaRegen': extra = this.attr('int') * 0.05; break;
      case 'armor': extra = this.attr('agi') * 0.167; break;
      case 'attackSpeed': extra = this.attr('agi'); break;
      case 'magicResist': extra = this.attr('int') * 0.001; break;
      case 'damageMin':
      case 'damageMax':
        extra = p === 'uni' ? (this.attr('str') + this.attr('agi') + this.attr('int')) * 0.7 : this.attr(p);
        break;
    }
    const saved = this.baseStats[name] ?? 0;
    // compute via Unit logic with attribute bonus folded into base
    this.baseStats[name] = saved + extra;
    const v = super.getStat(name);
    this.baseStats[name] = saved;
    return v;
  }

  bonusFromSources(name) {
    let v = super.bonusFromSources(name);
    const inv = this.inventory;
    if (inv) for (let i = 0; i < inv.length; i++) { const it = inv[i]; if (it?.def?.bonus?.[name]) v += it.def.bonus[name]; }
    if (this.neutralItem?.def?.bonus?.[name]) v += this.neutralItem.def.bonus[name];
    if (this.talentBonus?.[name]) v += this.talentBonus[name];
    return v;
  }

  addXp(amount) {
    if (!this.alive && amount > 0) amount *= 1; // dead heroes still gain xp; keep simple
    if (this.level >= MAX_LEVEL) return;
    this.xp += amount;
    while (this.level < MAX_LEVEL && this.xp >= XP_TABLE[this.level]) {
      const hpPct = this.healthPct, mpPct = this.manaPct;
      this.level++;
      this.abilityPoints++;
      this.hp = hpPct * this.getStat('maxHp');
      this.mana = mpPct * this.getStat('maxMana');
      this.game.bus.emit('hero:levelUp', { hero: this, level: this.level });
    }
  }
  addGold(amount, reason = '') {
    this.gold = Math.max(0, this.gold + amount);
    this.game.bus.emit('hero:gold', { hero: this, amount, reason });
  }

  // Can this ability slot be leveled right now? (Ult at 6/12/18, others max 4, need level >= 2*abilityLevel+1)
  canLevelAbility(i) {
    const ab = this.abilities[i];
    if (!ab || this.abilityPoints <= 0) return false;
    const max = ab.def.maxLevel ?? (ab.def.ultimate ? 3 : 4);
    if (ab.level >= max) return false;
    if (ab.def.ultimate) return this.level >= [6, 12, 18][ab.level];
    return this.level >= ab.level * 2 + 1;
  }
  levelAbility(i) {
    if (!this.canLevelAbility(i)) return false;
    this.abilities[i].level++;
    this.abilityPoints--;
    this.abilities[i].onLevelUp?.();
    this.game.bus.emit('ability:learned', { hero: this, ability: this.abilities[i], index: i });
    return true;
  }

  onDeath(killer) {
    this.deaths++;
    this.streak = 0;
    this.respawnTimer = respawnTime(this.level);
    this.game.delay(3, () => { if (!this.alive) this.object.visible = false; });
  }

  update(dt) {
    if (!this.alive) {
      this.respawnTimer -= dt;
      this.model?.update?.(dt);
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }
    super.update(dt);
    for (const ab of this.abilities) ab?.update?.(dt);
    for (const it of this.inventory) it?.update?.(dt);
  }

  respawn() {
    this.game._gridDirty = true;
    const [fx, fz] = FOUNTAIN[this.team];
    this.position.set(fx + (Math.random() - 0.5) * 4, 0, fz + (Math.random() - 0.5) * 4);
    this.alive = true;
    this.state = 'idle';
    this.hp = this.getStat('maxHp');
    this.mana = this.getStat('maxMana');
    this.order = { type: 'idle' };
    this.attackTarget = null;
    this.attackWindup = -1;
    this.castWindup = -1;
    this.object.visible = true;
    this.playAnim('idle');
    this.game.bus.emit('hero:respawn', { hero: this });
  }
}
