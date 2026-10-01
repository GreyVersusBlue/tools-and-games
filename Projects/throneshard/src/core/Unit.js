import * as THREE from 'three';
import { armorMultiplier, enemyOf } from './constants.js';

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Default stat block. Distances/speeds are in WORLD units (use du() from constants to convert from game units).
export const DEFAULT_STATS = {
  maxHp: 500, maxMana: 0, hpRegen: 0, manaRegen: 0,
  armor: 0, magicResist: 0,
  damageMin: 20, damageMax: 24,
  attackRange: 3.5, // world units, edge-to-edge-ish (we add collision radii)
  bat: 1.7, // base attack time
  attackSpeed: 100, // IAS points; 100 = base
  attackPoint: 0.4, // seconds of windup before damage/projectile
  projectileSpeed: 0, // 0 = melee (instant on attack point)
  moveSpeed: 7.5, // world units / sec
  turnRate: 10, // rad/sec
  collisionRadius: 0.8,
  vision: 20, // world units (day)
  acquireRange: 12,
  bountyGold: [36, 46],
  bountyXp: 57,
};

// Base class for everything that has HP: heroes, creeps, towers, barracks, throneshard, neutrals, summons.
// kind: 'hero' | 'creep' | 'tower' | 'building' | 'neutral' | 'summon' | 'ward' | 'grimmaw'
// '<stat>Pct' key per stat name (getStat is a hot path; avoids a string concat per call)
const PCT_KEY = Object.create(null);

export class Unit {
  constructor(game, opts) {
    this.game = game;
    this.id = NEXT_ID++;
    this.kind = opts.kind ?? 'creep';
    this.subtype = opts.subtype ?? null; // e.g. 'melee', 'ranged', 'siege', tower tier, camp kind
    this.name = opts.name ?? this.kind;
    this.team = opts.team;
    this.baseStats = { ...DEFAULT_STATS, ...(opts.stats ?? {}) };
    this.position = opts.position ? opts.position.clone() : new THREE.Vector3();
    this.facing = opts.facing ?? 0; // yaw radians; 0 faces +Z
    this.isStructure = this.kind === 'tower' || this.kind === 'building';
    this.immobile = opts.immobile ?? this.isStructure;
    this.lane = opts.lane ?? null;
    this.modelKind = opts.modelKind ?? this.kind;
    this.controller = opts.controller ?? null; // AI brain object; { update(unit, dt) }
    this.isPlayerControlled = false;
    this.owner = opts.owner ?? null; // owning hero for summons
    this.data = opts.data ?? {}; // free-form per-module storage

    this.modifiers = [];
    this.alive = true;
    this.hp = this.getStat('maxHp');
    this.mana = this.getStat('maxMana');
    this.invulnerable = opts.invulnerable ?? false; // e.g. protected towers (backdoor/tier protection)

    this.order = { type: 'idle' };
    this.orderQueue = [];
    this.state = 'idle'; // idle | moving | attacking | casting | dead
    this.attackTarget = null;
    this.attackCooldown = 0;
    this.attackWindup = -1; // >=0 while in attack point
    this.castWindup = -1;
    this.path = [];
    this.repathTimer = 0;
    this.lastAttacker = null;
    this.lastDamagedTime = -999;
    this.deathTime = 0;

    // Visuals. model = { root, height, play(name, opts), update(dt), setTeamColor?, dispose() }
    this.model = null;
    this.object = new THREE.Group();
    this.object.userData.unit = this;
    this.object.position.copy(this.position);
    // Off-screen culling wrapper for the model (kept separate from object.visible, which fog/morph/etc. own)
    this.cull = new THREE.Group();
    this.object.add(this.cull);
    game.scene?.add(this.object);
    if (game.models) {
      try {
        this.model = game.models.create(this.modelKind, { team: this.team, unit: this });
        if (this.model?.root) this.cull.add(this.model.root);
      } catch (e) {
        console.warn('model create failed for', this.modelKind, e);
      }
    }
    this._anim = null;
    this.playAnim('idle');
  }

  // ----- stats -----
  getStat(name) {
    let v = this.baseStats[name] ?? 0;
    v += this.bonusFromSources(name);
    const pct = this.bonusFromSources(PCT_KEY[name] ?? (PCT_KEY[name] = name + 'Pct')); // e.g. moveSpeedPct: 0.2 = +20%
    if (pct) v *= 1 + pct;
    if (name === 'moveSpeed') {
      let slow = 0;
      for (const m of this.modifiers) if (m.slow) slow = Math.max(slow, m.slow);
      v *= 1 - slow;
      v = Math.max(v, 2.5);
      if (this.hasState('root') || this.hasState('stun')) v = 0;
    }
    if (name === 'attackSpeed') v = Math.min(Math.max(v, 20), 700);
    return v;
  }
  bonusFromSources(name) {
    let v = 0;
    const mods = this.modifiers;
    for (let i = 0; i < mods.length; i++) { const m = mods[i]; if (m.bonus && m.bonus[name]) v += m.bonus[name] * (m.stacks ?? 1); }
    return v;
  }
  get attackInterval() { return this.getStat('bat') / (this.getStat('attackSpeed') / 100); }
  get isMelee() { return !this.getStat('projectileSpeed'); }
  get radius() { return this.getStat('collisionRadius'); }

  // ----- modifiers (buffs / debuffs) -----
  // mod: { id, name, icon, debuff, duration, source, stacks, stun, silence, root, disarm, morph, invulnerable,
  //        invisible, magicImmune, slow (0..1), bonus: {stat: value}, onApply(unit), onTick(unit, dt), onExpire(unit),
  //        onAttackLanded(unit, target, info), onDamageTaken(unit, info) , vfx (Object3D attached to unit) }
  addModifier(mod) {
    const existing = mod.id ? this.modifiers.find((m) => m.id === mod.id) : null;
    if (existing) {
      if (mod.stackable) existing.stacks = Math.min((existing.stacks ?? 1) + 1, mod.maxStacks ?? 99);
      existing.remaining = Math.max(existing.remaining ?? 0, mod.duration ?? Infinity);
      return existing;
    }
    const m = { stacks: 1, ...mod, remaining: mod.duration ?? Infinity };
    this.modifiers.push(m);
    m.onApply?.(this);
    if (m.stun || m.morph) this.interrupt();
    this.game.bus.emit('modifier:added', { unit: this, modifier: m });
    return m;
  }
  removeModifier(idOrMod) {
    const i = this.modifiers.findIndex((m) => m === idOrMod || m.id === idOrMod);
    if (i < 0) return;
    const [m] = this.modifiers.splice(i, 1);
    m.onExpire?.(this);
    if (m.vfx) m.vfx.parent?.remove(m.vfx);
    this.game.bus.emit('modifier:removed', { unit: this, modifier: m });
  }
  hasModifier(id) { return this.modifiers.some((m) => m.id === id); }
  hasState(flag) { return this.modifiers.some((m) => m[flag]); }
  get isStunned() { return this.hasState('stun'); }
  get isSilenced() { return this.hasState('silence') || this.hasState('morph') || this.isStunned; }
  get isDisarmed() { return this.hasState('disarm') || this.hasState('morph') || this.isStunned; }
  get isInvulnerable() { return this.invulnerable || this.hasState('invulnerable'); }
  get isMagicImmune() { return this.hasState('magicImmune'); }
  get isInvisible() { return this.hasState('invisible'); }

  // ----- damage / heal -----
  // type: 'physical' | 'magical' | 'pure'. opts: { isAttack, ability, noEvent, crit }
  takeDamage(amount, type, source, opts = {}) {
    if (!this.alive || this.isInvulnerable) return 0;
    if (type === 'magical' && this.isMagicImmune) return 0;
    let dmg = amount;
    if (type === 'physical') dmg *= armorMultiplier(this.getStat('armor'));
    else if (type === 'magical') dmg *= 1 - Math.min(this.getStat('magicResist'), 0.9);
    const incPct = this.bonusFromSources('incomingDamagePct');
    if (incPct) dmg *= 1 + incPct;
    const info = { amount: dmg, raw: amount, type, source, ...opts };
    for (const m of [...this.modifiers]) m.onDamageTaken?.(this, info);
    dmg = Math.max(0, info.amount);
    this.hp -= dmg;
    this.lastAttacker = source ?? this.lastAttacker;
    this.lastDamagedTime = this.game.time;
    if (!opts.noEvent) this.game.bus.emit('unit:damaged', { unit: this, source, amount: dmg, type, crit: opts.crit, isAttack: !!opts.isAttack, ability: opts.ability });
    if (this.hp <= 0) this.die(source);
    return dmg;
  }
  heal(amount, source) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.getStat('maxHp'), this.hp + amount);
    if (this.hp - before > 1) this.game.bus.emit('unit:healed', { unit: this, source, amount: this.hp - before });
  }
  restoreMana(amount) { this.mana = Math.min(this.getStat('maxMana'), this.mana + amount); }
  spendMana(amount) { if (this.mana < amount) return false; this.mana -= amount; return true; }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.state = 'dead';
    this.deathTime = this.game.time;
    this.order = { type: 'idle' };
    this.orderQueue.length = 0;
    this.attackTarget = null;
    this.attackWindup = -1;
    this.castWindup = -1;
    for (const m of [...this.modifiers]) this.removeModifier(m);
    this.playAnim('death', { once: true });
    this.game.bus.emit('unit:died', { unit: this, killer });
    this.onDeath(killer);
  }
  onDeath() {
    // Non-heroes are removed after the death animation.
    this.game.delay(this.isStructure ? 4 : 2.5, () => this.game.removeUnit(this));
  }

  // ----- orders -----
  // Orders: {type:'idle'} {type:'move', point} {type:'attack', target} {type:'attackMove', point}
  //         {type:'cast', ability, target?, point?} {type:'hold'} {type:'stop'} {type:'follow', target}
  issueOrder(order, queue = false) {
    if (!this.alive) return;
    if (order.type === 'stop') order = { type: 'idle' };
    if (queue && this.order.type !== 'idle') { this.orderQueue.push(order); return; }
    this.orderQueue.length = 0;
    if (this.castWindup >= 0 && order.type !== 'cast') this.castWindup = -1;
    this.order = order;
    this.path = [];
    this.repathTimer = 0;
    this.attackTarget = order.type === 'attack' ? order.target : null;
    if (order.type !== 'attack') this.attackWindup = -1;
    this.game.bus.emit('unit:order', { unit: this, order });
  }
  interrupt() {
    this.attackWindup = -1;
    this.castWindup = -1;
  }
  nextOrder() {
    this.order = this.orderQueue.shift() ?? { type: 'idle' };
    this.path = [];
    this.attackTarget = this.order.type === 'attack' ? this.order.target : null;
  }

  isEnemy(other) { return other && other.team !== this.team; }
  canAttack(target, explicit = false) {
    if (!target || !target.alive || target.isInvulnerable) return false;
    if (!this.isEnemy(target)) return explicit && this.canDeny(target);
    return this.game.canSee(this.team, target);
  }
  // Denies: explicitly ordered heroes may attack allied creeps/towers under 50% HP.
  canDeny(target) {
    return this.kind === 'hero' && target !== this && target.team === this.team &&
      (target.kind === 'creep' || target.kind === 'tower') && target.healthPct < 0.5;
  }
  distanceTo(other) {
    const p = other.position ?? other;
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }
  edgeDistanceTo(other) { return this.distanceTo(other) - this.radius - (other.radius ?? 0); }
  inAttackRange(target, extra = 0) { return this.edgeDistanceTo(target) <= this.getStat('attackRange') + extra; }

  findAcquireTarget(range = this.getStat('acquireRange')) {
    let best = null, bestD = Infinity;
    for (const u of this.game.unitsInRadius(this.position, range + 2)) {
      if (!this.canAttack(u)) continue;
      const d = this.edgeDistanceTo(u);
      if (d < bestD && d <= range) { bestD = d; best = u; }
    }
    return best;
  }

  // ----- per-frame -----
  update(dt) {
    if (!this.alive) { this.model?.update?.(dt); return; }
    this.updateModifiers(dt);
    if (!this.alive) return;
    this.regen(dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.controller?.update?.(this, dt);
    if (!this.isStunned && !this.hasState('morph_frozen')) this.processOrder(dt);
    else if (this.state !== 'idle') { this.state = 'idle'; }
    this.syncVisual(dt);
  }

  updateModifiers(dt) {
    for (const m of [...this.modifiers]) {
      m.onTick?.(this, dt);
      m.remaining -= dt;
      if (m.remaining <= 0) this.removeModifier(m);
      if (!this.alive) return;
    }
  }

  regen(dt) {
    const maxHp = this.getStat('maxHp');
    const maxMana = this.getStat('maxMana');
    if (this.hp < maxHp) this.hp = Math.min(maxHp, this.hp + this.getStat('hpRegen') * dt);
    if (this.mana < maxMana) this.mana = Math.min(maxMana, this.mana + this.getStat('manaRegen') * dt);
    if (this.hp > maxHp) this.hp = maxHp;
    if (this.mana > maxMana) this.mana = maxMana;
  }

  processOrder(dt) {
    const o = this.order;
    // Casting windup takes priority
    if (this.castWindup >= 0) { this.updateCast(dt); return; }
    switch (o.type) {
      case 'move':
        if (this.moveToward(o.point, dt, 0.3)) this.nextOrder();
        break;
      case 'follow':
        if (!o.target?.alive) { this.nextOrder(); break; }
        if (this.distanceTo(o.target) > 3) this.moveToward(o.target.position, dt, 2.5); else this.setState('idle');
        break;
      case 'attack':
        if (!this.canAttack(o.target, true)) { this.attackWindup = -1; this.nextOrder(); break; }
        this.doAttack(o.target, dt);
        break;
      case 'attackMove': {
        if (this.attackTarget && !this.canAttack(this.attackTarget)) this.attackTarget = null;
        if (!this.attackTarget || (this.attackWindup < 0 && this.game.frame % 15 === this.id % 15)) {
          const t = this.findAcquireTarget();
          if (t) this.attackTarget = t;
        }
        if (this.attackTarget && !this.isDisarmed) this.doAttack(this.attackTarget, dt);
        else if (this.moveToward(o.point, dt, 0.5)) this.nextOrder();
        break;
      }
      case 'cast':
        this.processCastOrder(o, dt);
        break;
      case 'hold':
      case 'idle':
      default: {
        // Auto-attack: acquire targets in range (hold = don't chase)
        if (this.attackTarget && (!this.canAttack(this.attackTarget) || (o.type === 'hold' && !this.inAttackRange(this.attackTarget)))) this.attackTarget = null;
        if (!this.attackTarget && this.game.frame % 10 === this.id % 10 && !this.isDisarmed) {
          const t = this.findAcquireTarget(o.type === 'hold' || this.immobile ? this.getStat('attackRange') + 0.5 : this.getStat('acquireRange'));
          if (t) this.attackTarget = t;
        }
        if (this.attackTarget) {
          if (o.type === 'hold' || this.immobile) {
            if (this.inAttackRange(this.attackTarget, 0.5)) this.doAttack(this.attackTarget, dt, false);
            else this.attackTarget = null;
          } else if (this.distanceTo(this.attackTarget) > this.getStat('acquireRange') * 1.6) this.attackTarget = null;
          else this.doAttack(this.attackTarget, dt);
        } else this.setState('idle');
      }
    }
  }

  // Returns true when arrived
  moveToward(point, dt, arriveDist = 0.3) {
    if (this.immobile) return true;
    const dx = point.x - this.position.x, dz = point.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= arriveDist) { this.path = []; this.setState('idle'); return true; }
    const speed = this.getStat('moveSpeed');
    if (speed <= 0) { this.setState('idle'); return false; }
    // Path planning via world navgrid (if present)
    this.repathTimer -= dt;
    const pathGoal = this.path._goal;
    if (this.game.world?.findPath && (this.repathTimer <= 0 && (!pathGoal || pathGoal.distanceToSquared(point) > 4 || this.path.length === 0))) {
      this.path = this.game.world.findPath(this.position, point) ?? [];
      this.path._goal = point.clone();
      this.repathTimer = 0.5;
    }
    let target = point;
    while (this.path.length) {
      const wp = this.path[0];
      if (Math.hypot(wp.x - this.position.x, wp.z - this.position.z) < 0.6 && this.path.length > 1) this.path.shift();
      else { target = wp; break; }
    }
    _v.set(target.x - this.position.x, 0, target.z - this.position.z);
    const len = _v.length();
    if (len < 1e-4) return false;
    _v.divideScalar(len);
    const desiredYaw = Math.atan2(_v.x, _v.z);
    const diff = this.turnToward(desiredYaw, dt);
    // Only move forward once roughly facing the direction
    const step = Math.min(len, speed * dt) * (Math.abs(diff) < 1.2 ? 1 : 0.2);
    this.tryStep(_v.x * step, _v.z * step);
    this.setState('moving');
    return false;
  }

  tryStep(dx, dz) {
    const nx = this.position.x + dx, nz = this.position.z + dz;
    const w = this.game.world;
    if (!w?.isWalkable || w.isWalkable(nx, nz)) { this.position.x = nx; this.position.z = nz; }
    else if (w.isWalkable(nx, this.position.z)) this.position.x = nx;
    else if (w.isWalkable(this.position.x, nz)) this.position.z = nz;
  }

  turnToward(yaw, dt) {
    let diff = yaw - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = this.getStat('turnRate') * dt;
    this.facing += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
    return diff;
  }
  faceToward(pos, dt) {
    return this.turnToward(Math.atan2(pos.x - this.position.x, pos.z - this.position.z), dt);
  }

  doAttack(target, dt, allowChase = true) {
    if (this.isDisarmed) { this.setState('idle'); return; }
    if (this.attackWindup >= 0) {
      this.faceToward(target.position, dt);
      this.attackWindup -= dt * (this.getStat('attackSpeed') / 100);
      if (this.attackWindup < 0) this.releaseAttack(target);
      return;
    }
    if (!this.inAttackRange(target)) {
      if (allowChase && !this.immobile) this.moveToward(target.position, dt, 0);
      return;
    }
    const diff = this.faceToward(target.position, dt);
    if (Math.abs(diff) > 0.35 && !this.immobile) { this.setState('idle'); return; }
    if (this.attackCooldown > 0) { this.setState('idle'); return; }
    // begin attack
    this.attackWindup = this.getStat('attackPoint');
    this.attackCooldown = this.attackInterval;
    this.setState('attacking');
    this.playAnim('attack', this.attackAnimOpts());
    this.game.bus.emit('unit:attack', { unit: this, target });
  }

  // Attack animation timing: scale the clip so the weapon connects exactly at the damage point / projectile launch
  // (windup = attackPoint / attackSpeed factor, see doAttack). model.attackHitFraction (0..1) marks the connect frame.
  attackAnimOpts() {
    const as = Math.max(0.2, this.getStat('attackSpeed') / 100);
    const windup = this.getStat('attackPoint') / as;
    const m = this.model;
    const frac = Math.min(0.95, Math.max(0.1, m?.attackHitFraction ?? m?.cfg?.hitFrac ?? 0.5));
    return { once: true, speed: as, duration: Math.max(0.2, windup / frac), hitTime: windup };
  }

  releaseAttack(target) {
    this.attackWindup = -1;
    if (!target.alive) return;
    const dmgInfo = this.rollAttackDamage(target);
    const speed = this.getStat('projectileSpeed');
    if (speed > 0 && this.game.projectiles) {
      this.game.projectiles.launch({
        source: this, target, speed, kind: this.data.projectileKind ?? this.modelKind, isAttack: true,
        onHit: (t) => this.landAttack(t, dmgInfo),
      });
    } else this.landAttack(target, dmgInfo);
  }

  rollAttackDamage(target) {
    const min = this.getStat('damageMin'), max = this.getStat('damageMax');
    let dmg = min + Math.random() * (max - min) + this.bonusFromSources('damage');
    const info = { amount: dmg, crit: false, target };
    // Modifiers can mutate info (crit, bash, cleave...) via onAttackStart
    for (const m of this.modifiers) m.onAttackStart?.(this, target, info);
    return info;
  }

  landAttack(target, info) {
    if (!target.alive) return;
    let dmg = info.amount;
    if (target.isStructure && this.kind === 'creep' && this.subtype === 'siege') dmg *= 2.5;
    else if (target.isStructure && this.kind === 'hero') dmg *= 0.75;
    else if (target.isStructure && this.kind === 'creep') dmg *= 0.6;
    if (this.kind === 'tower' && target.kind === 'hero') dmg *= 1.0;
    const dealt = target.takeDamage(dmg, 'physical', this, { isAttack: true, crit: info.crit });
    const landed = { ...info, dealt, target };
    for (const m of [...this.modifiers]) m.onAttackLanded?.(this, target, landed);
    this.game.bus.emit('unit:attackLanded', { unit: this, target, damage: dealt, crit: info.crit });
  }

  // ----- casting (ability logic lives in gameplay/abilities; this handles approach + cast point) -----
  processCastOrder(o, dt) {
    const ab = o.ability;
    const check = ab.canCast?.(o.target ?? o.point) ?? { ok: true };
    if (!check.ok) { this.game.bus.emit('ui:error', { unit: this, message: check.reason }); this.nextOrder(); return; }
    const tpos = o.target?.position ?? o.point;
    if (tpos) {
      if (o.target && !o.target.alive) { this.nextOrder(); return; }
      const range = ab.getCastRange?.() ?? 0;
      const d = o.target ? this.edgeDistanceTo(o.target) : this.distanceTo(tpos);
      if (range > 0 && d > range) { this.moveToward(tpos, dt, 0); return; }
      const diff = this.faceToward(tpos, dt);
      if (Math.abs(diff) > 0.3) { this.setState('idle'); return; }
    }
    this.castWindup = ab.def?.castPoint ?? 0.3;
    this.setState('casting');
    this.playAnim('cast', { once: true });
  }
  updateCast(dt) {
    const o = this.order;
    if (o.target?.position) this.faceToward(o.target.position, dt);
    this.castWindup -= dt;
    if (this.castWindup >= 0) return;
    this.castWindup = -1;
    if (this.isSilenced && !o.ability.isItem) { this.nextOrder(); return; }
    const target = o.target ?? o.point ?? null;
    const check = o.ability.canCast?.(target) ?? { ok: true };
    if (check.ok) o.ability.cast(target);
    this.nextOrder();
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (s === 'moving') this.playAnim('run');
    else if (s === 'idle') this.playAnim('idle');
  }
  playAnim(name, opts) {
    this._anim = name;
    this.model?.play?.(name, opts);
  }

  syncVisual(dt) {
    const y = this.game.world?.getHeight ? this.game.world.getHeight(this.position.x, this.position.z) : 0;
    this.position.y = y;
    this.object.position.copy(this.position);
    this.object.rotation.y = this.facing;
    // Hide + skip world-matrix traversal (skeleton bones etc.) for off-screen models; big win with 100+ skinned units.
    const on = !this.game.isOnScreen || this.game.isOnScreen(this.position, this.isStructure ? 14 : 6);
    if (on && !this.cull.parent) this.object.add(this.cull);
    else if (!on && this.cull.parent) this.object.remove(this.cull);
    this.model?.update?.(dt);
  }

  // Separation from nearby units (called by Game)
  separate(others, dt) {
    if (this.immobile || !this.alive) return;
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const dx = this.position.x - o.position.x, dz = this.position.z - o.position.z;
      const minD = this.radius + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) * (o.immobile ? 1 : 0.5) * Math.min(1, dt * 10);
      this.tryStep((dx / d) * push, (dz / d) * push);
    }
  }

  get enemyTeam() { return enemyOf(this.team); }
  get healthPct() { return this.hp / Math.max(1, this.getStat('maxHp')); }
  get manaPct() { return this.mana / Math.max(1, this.getStat('maxMana')); }

  dispose() {
    this.object.parent?.remove(this.object);
    this.model?.dispose?.();
  }
}

export const tmpVec = _v2;
