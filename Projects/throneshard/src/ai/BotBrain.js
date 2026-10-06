import * as THREE from 'three';
import { FOUNTAIN, TEAM, enemyOf, armorMultiplier, du, GRIMMAW_LAIR } from '../core/constants.js';
import { LANE_PATHS } from './LanePath.js';
import { WARD_SPOTS, SENTRY_SPOTS } from './WardSpots.js';

// Difficulty profiles
// combo: disable-first spell chains + no wasted disables; lead: aim delayed/skillshot spells at predicted positions;
// smart: incoming-damage aware retreat / fight evaluation; aware: map awareness (avoid farming where enemies were last seen,
// deward, contest Grimmaw more readily); runes/wards: rune pickup and warding behaviour.
export const DIFFICULTY = {
  easy: { think: 0.4, lhAcc: 0.8, lhMiss: 0.35, abilityUse: 0.3, engage: 1.7, retreatHp: 0.22, harass: 0.04, deny: 0.1, focus: 0.5, dive: false, itemUse: 0.4, runes: 0.3, wards: false },
  normal: { think: 0.2, lhAcc: 0.9, lhMiss: 0.1, abilityUse: 0.65, engage: 1.3, retreatHp: 0.3, harass: 0.12, deny: 0.45, focus: 0.8, dive: false, itemUse: 0.8, runes: 1, wards: true },
  hard: { think: 0.1, lhAcc: 0.9, lhMiss: 0.03, abilityUse: 1, engage: 1.0, retreatHp: 0.3, harass: 0.3, deny: 0.9, focus: 1, dive: true, itemUse: 1, runes: 1, wards: true, combo: true, lead: true, smart: true, aware: true },
};

const LANE_PHASE_END = 660; // seconds; laners keep last-hitting until then unless a kill or a big edge is on
const LANE_ENGAGE_RATIO = 2.1;
const HEAL_ITEM = /salve|healing|bark_ration|clarity|honeyed_plum|flask|wisp_ember/i;
const MANA_ITEM = /clarity|honeyed_plum|flask|tidecall/i;
const _v = new THREE.Vector3();
const v3 = (x, z) => new THREE.Vector3(x, 0, z);

// Per-hero bot controller. Attached as hero.controller; the Unit calls update(unit, dt) every frame.
export class BotBrain {
  constructor(director, hero) {
    this.d = director;
    this.game = director.game;
    this.hero = hero;
    this.team = hero.team;
    this.enemy = enemyOf(hero.team);
    this.diff = DIFFICULTY[this.game.difficulty] ?? DIFFICULTY.normal;
    this.t = Math.random() * 0.3;
    this.mode = 'idle';
    this.retreating = false;
    this.lateral = ((hero.id * 7919) % 7 - 3) * 0.9; // per-bot lateral offset in lane
    this.stuck = { pos: hero.position.clone(), t: 0, count: 0, until: 0 };
    this.busyUntil = 0;
    this.harassUntil = 0;
    this.shopT = 0;
    this.itemT = 0;
    this.lastThink = 0;
    this.errLogged = false;
    this.lhTarget = null;
    this.denyPending = 0;
    this.campTarget = null;
    this.debug = '';
  }

  // ---------------------------------------------------------------- frame / think
  update(hero, dt) {
    if (hero.isPlayerControlled && !hero.isBot) return;
    // Guard: a cast order without an ability would throw inside Unit.processCastOrder every frame
    if (hero.order?.type === 'cast' && !hero.order.ability) hero.issueOrder({ type: 'stop' });
    // Guard: died mid cast-point → castWindup survives respawn while the order is idle (core quirk)
    if (hero.castWindup >= 0 && hero.order?.type !== 'cast') hero.castWindup = -1;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.diff.think * (0.85 + Math.random() * 0.3);
    try {
      this.think();
    } catch (e) {
      if (!this.errLogged) { console.error('[BotBrain]', hero.name, e); this.errLogged = true; }
    }
  }

  ensurePassive() {
    // Bots pick every target themselves; a hidden modifier disables Unit's idle auto-acquire.
    const h = this.hero;
    if (!h.hasModifier('bot_control')) h.addModifier({ id: 'bot_control', name: '', hidden: true, duration: Infinity, bonus: { acquireRange: -1000 } });
  }

  think() {
    const g = this.game, h = this.hero;
    if (!h.alive) return;
    this.ensurePassive();
    this.now = g.time;
    this.levelUp();
    this.ctx = this.sense();
    if (this.diff.lead) this.trackVelocities();
    this.checkStuck();
    if (g.time < this.stuck.until) return; // executing an unstuck nudge
    this.useItems();
    this.tryShop();

    // Channeling: never interrupt (any order cancels a channel) unless about to die
    if (this.isChanneling() && h.healthPct > 0.15) return;
    // Casting in progress: let it finish (unless in danger)
    if ((h.order.type === 'cast' || h.castWindup >= 0) && g.time < this.busyUntil && !this.shouldRetreat()) return;

    if (this.shouldRetreat()) { this.mode = 'retreat'; this.doRetreat(); return; }
    if (this.handleTowerDanger()) return;
    if (this.tryFight()) return;
    if (this.tryDeward()) return;

    const plan = this.d.planFor(h);
    this.plan = plan;
    if (plan.type !== 'defend' && plan.type !== 'grimmaw' && this.tryRune()) return;
    if (plan.type !== 'defend' && plan.type !== 'grimmaw' && plan.type !== 'push' && this.tryWard()) return;
    switch (plan.type) {
      case 'defend': this.mode = 'defend'; this.doDefend(plan); break;
      case 'push': this.mode = 'push'; this.doPush(plan); break;
      case 'grimmaw': this.mode = 'grimmaw'; this.doGrimmaw(plan); break;
      case 'farm': this.mode = 'farm'; this.doFarm(plan); break;
      case 'shop': this.mode = 'shop'; this.goFountain(); break;
      default: this.mode = 'lane'; this.doLane(plan.lane ?? h.lane ?? 'mid');
    }
  }

  // ---------------------------------------------------------------- perception
  sense() {
    const g = this.game, h = this.hero;
    const R = 30;
    const near = g.unitsInRadius(h.position, R);
    const c = {
      enemyHeroes: [], allyHeroes: [], enemyCreeps: [], allyCreeps: [], enemyTowers: [], allyTowers: [],
      neutrals: [], enemyStructures: [], enemyWards: [],
    };
    for (const u of near) {
      if (u === h) continue;
      const enemy = u.team === this.enemy;
      if (u.kind === 'hero') {
        if (enemy) { if (g.canSee(this.team, u)) c.enemyHeroes.push(u); } else if (u.team === this.team) c.allyHeroes.push(u);
      } else if (u.kind === 'creep' || u.kind === 'summon') {
        if (enemy) { if (g.canSee(this.team, u)) c.enemyCreeps.push(u); } else if (u.team === this.team) c.allyCreeps.push(u);
      } else if (u.kind === 'tower' || u.kind === 'building') {
        if (enemy) { c.enemyStructures.push(u); if (u.kind === 'tower' || u.subtype === 'fountain') c.enemyTowers.push(u); } else if (u.kind === 'tower' || u.subtype === 'fountain') c.allyTowers.push(u);
      } else if (u.kind === 'neutral' || u.kind === 'grimmaw') c.neutrals.push(u);
      else if (u.kind === 'ward' && enemy && g.canSee(this.team, u)) c.enemyWards.push(u);
    }
    // Hard bots remember where enemy heroes were last seen (map awareness)
    if (this.diff.aware) for (const e of c.enemyHeroes) this.d.noteSeen?.(this.team, e);
    return c;
  }

  // Rough combat value of a hero: effective HP & DPS plus a spell burst estimate
  heroDps(u) {
    const dmg = (u.getStat('damageMin') + u.getStat('damageMax')) / 2 + u.bonusFromSources('damage');
    return dmg / Math.max(0.2, u.attackInterval) + (u.level ?? 1) * 7;
  }
  heroEhp(u) {
    return u.hp / armorMultiplier(u.getStat('armor'));
  }
  myDamageVs(target) {
    const h = this.hero;
    let dmg = h.getStat('damageMin') + h.bonusFromSources('damage');
    dmg *= armorMultiplier(target.getStat('armor'));
    if (target.isStructure) dmg *= 0.75;
    return dmg;
  }

  // ---------------------------------------------------------------- abilities / leveling
  levelUp() {
    const h = this.hero;
    let guard = 0;
    while (h.abilityPoints > 0 && guard++ < 6) {
      const abs = h.abilities ?? [];
      if (!abs.length) return;
      let pick = -1;
      if (abs[3] && h.canLevelAbility(3)) pick = 3;
      else if (this.game.talents?.available?.(h)?.length) {
        if (this.game.talents.botChoose(h)) continue;
      }
      if (pick < 0) {
        let best = Infinity;
        const pref = this.levelPref ?? (this.levelPref = this.computeLevelPref());
        for (let i = 0; i < 3; i++) {
          if (!abs[i] || !h.canLevelAbility(i)) continue;
          const s = abs[i].level + pref[i];
          if (s < best) { best = s; pick = i; }
        }
      }
      if (pick < 0 || !h.levelAbility(pick)) return;
    }
  }
  computeLevelPref() {
    // Prefer damaging/disabling actives first, passives/toggles last.
    return [0, 1, 2].map((i) => {
      const def = this.hero.abilities[i]?.def ?? {};
      let p = i * 0.3;
      if (def.targetType === 'passive' || def.targetType === 'toggle') p += 0.6;
      return p;
    });
  }

  // Normalised ability usage info. Uses game.abilities.botCastHint when present
  // ({type:'enemy'|'ally'|'self'|'point'|'aoe'|'passive'|'toggle', radius, range, minEnemies, finisher, ...}),
  // otherwise infers from def.targetType / targetTeam / description.
  abilityInfo(ab, i) {
    const def = ab.def ?? {};
    let hint = null;
    try { hint = this.game.abilities?.botCastHint?.(this.hero, i) ?? null; } catch (e) { hint = null; }
    const text = `${def.id ?? ''} ${def.name ?? ''} ${def.description ?? ''}`.toLowerCase();
    let kind = hint?.type;
    if (!kind) {
      const tt = def.targetType ?? 'none';
      if (tt === 'passive' || tt === 'toggle') kind = tt;
      else if (tt === 'unit') kind = def.targetTeam === 'ally' ? 'ally' : 'enemy';
      else if (tt === 'point') kind = (ab.getRadius?.() ?? 0) > 0 ? 'aoe' : 'point';
      else kind = 'self';
    }
    const radius = hint?.radius ?? ab.getRadius?.() ?? (Array.isArray(def.radius) ? def.radius[0] : def.radius) ?? 0;
    return {
      ...(hint ?? {}),
      kind,
      radius,
      range: hint?.range ?? ab.getCastRange?.() ?? 0,
      disable: hint?.disable ?? (def.stun || /stun|toad|morph|root|sleep|disable|silence|freez/.test(text)),
      healing: hint?.healing ?? /heal|restor|regenerat/.test(text),
      escape: hint?.escape ?? (/blink|leap|dash|escape/.test(text) && kind !== 'enemy'),
      ult: !!def.ultimate,
      never: hint === false,
    };
  }

  isChanneling() {
    const h = this.hero;
    const ch = h.data?.channeling;
    return !!(ch && (ch.channel || ch.itemId)) || h.modifiers.some((m) => m.channel);
  }

  // Try to cast one ability this think. ctxTarget = current fight target (enemy hero) if any.
  // opts: { retreat, farm, push }
  tryCast(ctxTarget, opts = {}) {
    const h = this.hero;
    if (h.isSilenced || h.order.type === 'cast' || h.castWindup >= 0 || this.isChanneling()) return false;
    if (Math.random() > this.diff.abilityUse) return false;
    const abs = h.abilities ?? [];
    const enemies = this.ctx.enemyHeroes.filter((e) => e.alive && !e.isInvulnerable);
    const mobs = this.ctx.enemyCreeps.concat(this.ctx.neutrals).filter((u) => u.alive && !u.isInvulnerable);
    const fighting = enemies.length > 0 && !!ctxTarget;
    const f = FOUNTAIN[this.team];
    const towardFountain = (r) => {
      const dx = f[0] - h.position.x, dz = f[1] - h.position.z, l = Math.hypot(dx, dz) || 1;
      return v3(h.position.x + (dx / l) * r, h.position.z + (dz / l) * r);
    };
    let order = [3, 0, 1, 2];
    if (this.diff.combo && ctxTarget && !opts.retreat) {
      // Spell combos: open with a disable when the target is free, follow up with damage while it is disabled.
      const disabled = this.isDisabled(ctxTarget);
      const rank = (i) => { const ab = abs[i]; if (!ab) return 9; const inf = this.abilityInfo(ab, i); return (inf.disable ? (disabled ? 2 : 0) : 1) + (i === 3 ? -0.5 : 0); };
      order = [0, 1, 2, 3].sort((a, b) => rank(a) - rank(b));
    }
    for (const i of order) {
      const ab = abs[i];
      if (!ab || !(ab.level > 0)) continue;
      const info = this.abilityInfo(ab, i);
      if (info.never || info.kind === 'passive') continue;
      if (info.kind !== 'toggle' && (ab.cooldownRemaining ?? 0) > 0) continue;
      if (ab.def?.charges && ab.charges <= 0) continue;
      if (h.mana < (ab.getManaCost?.() ?? 0)) continue;
      const range = info.range || 0;
      const r = info.radius || 0;
      let cast = null;

      // Channeled spells only when not under pressure from multiple enemies
      if (info.channel && !opts.farm && enemies.filter((e) => h.distanceTo(e) < 12).length > (info.kind === 'self' ? 3 : 1) && !info.disable) continue;

      if (opts.retreat) {
        if (info.escape && (info.kind === 'point' || info.kind === 'aoe')) cast = { point: towardFountain(Math.max(4, range || 12)) };
        else if (info.escape && info.kind === 'self') cast = {};
        else if (info.kind === 'enemy' && info.disable) {
          const chaser = enemies.find((e) => h.edgeDistanceTo(e) <= range + 0.5 && !e.isStunned);
          if (chaser) cast = { target: chaser };
        } else if (info.kind === 'ally' && info.defensive) cast = { target: h };
        else if (info.healing && info.selfPoint) cast = { point: h.position.clone() };
        if (cast && ab.def?.allowSelf === false && cast.target === h) cast = null;
        if (cast && this.issueCast(ab, cast)) return true;
        continue;
      }

      switch (info.kind) {
        case 'toggle': {
          if (info.autocast) { if (!ab.toggled) cast = {}; break; }
          const want = enemies.some((e) => h.distanceTo(e) < (r || 8) + 2) || (opts.farm && mobs.filter((m) => h.distanceTo(m) < (r || 6)).length >= 2 && h.manaPct > 0.5);
          if (want !== !!ab.toggled) cast = {};
          break;
        }
        case 'enemy': {
          let t = ctxTarget && enemies.includes(ctxTarget) ? ctxTarget : null;
          if (!t) t = enemies.filter((e) => h.distanceTo(e) <= range + 4).sort((a, b) => a.hp - b.hp)[0] ?? null;
          if (t && h.distanceTo(t) > range + 5) t = null;
          if (t) {
            const mr = 1 - Math.min(0.9, t.getStat('magicResist') ?? 0.25);
            if (info.finisher) { if (t.hp > info.finisher * mr * 1.05 && !(enemies.length >= 3 && t.healthPct < 0.4)) t = null; }
            else if (info.executeBelowHp) { if (t.hp > info.executeBelowHp) t = null; }
            else if (info.disable && (t.isStunned || t.hasState?.('morph'))) t = null;
            else if (info.gapCloser && h.distanceTo(t) < h.getStat('attackRange') + 2) t = null;
            else if (info.teamfight && enemies.length < 2 && t.healthPct > 0.5) t = null;
            else if (info.ult && !fighting && t.healthPct > 0.6) t = null;
            else if (!fighting && !info.harass && t.healthPct > 0.5 && h.manaPct < 0.6) t = null;
            if (t) cast = { target: t };
          } else if ((opts.farm || opts.push) && !info.ult && !info.finisher && !info.executeBelowHp && !info.channel && h.manaPct > 0.65) {
            const c = mobs.filter((u) => h.distanceTo(u) <= range + 1 && u.hp > 250 && u.kind !== 'grimmaw').sort((a, b) => b.hp - a.hp)[0];
            if (c && (info.lastHit || info.harass || Math.random() < 0.3)) cast = { target: c };
          }
          break;
        }
        case 'ally': {
          const allies = [h, ...this.ctx.allyHeroes].filter((a) => a.alive && h.distanceTo(a) <= range + 6 && (a !== h || ab.def?.allowSelf !== false));
          allies.sort((a, b) => a.healthPct - b.healthPct);
          const a = allies[0];
          if (!a) break;
          if (info.defensive || info.healing) { if (a.healthPct < 0.55 && (enemies.length || info.healing)) cast = { target: a }; }
          else if (fighting) {
            // Offensive buff: best right-clicker near the fight
            const best = allies.filter((x) => x.kind === 'hero').sort((x, y) => this.heroDps(y) - this.heroDps(x))[0];
            if (best) cast = { target: best };
          }
          break;
        }
        case 'self': {
          const rr = r || h.getStat('attackRange') + 3;
          const n = enemies.filter((e) => h.distanceTo(e) <= rr + 0.5).length;
          const need = info.minEnemies ?? (info.teamfight || info.ult ? Math.min(2, Math.max(1, enemies.length)) : 1);
          if (info.escape) { if (this.retreating && this.now - h.lastDamagedTime < 2) cast = {}; break; }
          if (n >= need && (n > 0 || info.minEnemies === 0)) cast = {};
          else if ((opts.farm || opts.push) && !info.ult && !info.channel && r > 0 && h.manaPct > 0.6 && mobs.filter((m) => h.distanceTo(m) <= r).length >= 3) cast = {};
          else if (info.healing && (h.healthPct < 0.6 || this.ctx.allyHeroes.some((a) => a.healthPct < 0.5 && h.distanceTo(a) < 10))) cast = {};
          break;
        }
        case 'point':
        case 'aoe': {
          if (info.healing && info.selfPoint) {
            const hurt = [h, ...this.ctx.allyHeroes].filter((a) => a.alive && a.healthPct < 0.6 && h.distanceTo(a) < 8).length;
            if (hurt && (enemies.length || h.healthPct < 0.5)) cast = { point: h.position.clone() };
            break;
          }
          if (info.escape) {
            if (ctxTarget && fighting && h.distanceTo(ctxTarget) > h.getStat('attackRange') + 4 && h.distanceTo(ctxTarget) <= range + 1 && h.healthPct > 0.5) cast = { point: ctxTarget.position.clone() };
            break;
          }
          if (info.line || info.skillshot || info.cone) {
            // Aim at the fight target (or the lowest nearby enemy)
            const t = (ctxTarget && enemies.includes(ctxTarget) && h.distanceTo(ctxTarget) <= range + 1) ? ctxTarget
              : enemies.filter((e) => h.distanceTo(e) <= range + 1).sort((a, b) => a.hp - b.hp)[0];
            if (t && (fighting || info.harass || t.healthPct < 0.6 || h.manaPct > 0.7)) cast = { point: this.aimPoint(t, ab, info) };
            else if ((opts.farm || opts.push) && !info.ult && !info.skillshot && h.manaPct > 0.6) {
              const cr = this.bestCluster(mobs, Math.max(r, 2.5), range);
              if (cr && cr.count >= 3) cast = { point: cr.point };
            }
            break;
          }
          const rad = Math.max(r, 2.5);
          const best = this.bestCluster(enemies, rad, range + 1);
          const need = info.minEnemies ?? (info.ult || info.teamfight ? Math.min(2, enemies.length) : 1);
          if (best && best.count >= Math.max(1, need)) {
            cast = { point: best.point };
            // Hard: delayed AoE (e.g. Pillar of Flame) on a lone moving target → lead it
            if (this.diff.lead && best.count === 1 && info.delay) { const t1 = enemies.find((e) => e.distanceTo(best.point) < 1.5); if (t1 && !this.isDisabled(t1)) cast = { point: this.aimPoint(t1, ab, info) }; }
          }
          else if ((opts.farm || opts.push) && !info.ult && h.manaPct > 0.6) {
            const cr = this.bestCluster(mobs, rad, range);
            if (cr && cr.count >= 3) cast = { point: cr.point };
          }
          break;
        }
      }
      if (cast && this.issueCast(ab, cast)) return true;
    }
    return false;
  }

  isSupportHero(u) { return u?.kind === 'hero' && u.def?.roles?.[0] === 'Support' && u.lane !== 'mid'; }
  isDisabled(u) { return !!u && (u.isStunned || u.hasState?.('morph') || u.hasState?.('root')); }

  // Predicted position of `t` when the spell lands (hard bots lead moving targets; others aim at the current spot).
  aimPoint(t, ab, info = {}) {
    const p = t.position.clone();
    if (!this.diff.lead || this.isDisabled(t)) return p;
    const v = this.vel?.get(t);
    if (!v || this.now - v.t > 1) return p;
    const h = this.hero;
    const speed = ab.v?.('speed');
    const travel = typeof speed === 'number' && speed > 0 ? h.distanceTo(t) / speed : 0;
    const delay = (ab.def?.castPoint ?? 0.3) + (info.delay ?? 0) + travel + 0.1;
    p.x += v.vx * delay; p.z += v.vz * delay;
    return p;
  }
  trackVelocities() {
    this.vel ??= new Map();
    for (const e of this.ctx.enemyHeroes) {
      const o = this.vel.get(e);
      if (o && this.now - o.t > 0.05 && this.now - o.t < 1) {
        const dt = this.now - o.t;
        o.vx = o.vx * 0.4 + ((e.position.x - o.x) / dt) * 0.6; o.vz = o.vz * 0.4 + ((e.position.z - o.z) / dt) * 0.6;
        o.x = e.position.x; o.z = e.position.z; o.t = this.now;
      } else this.vel.set(e, { x: e.position.x, z: e.position.z, t: this.now, vx: 0, vz: 0 });
    }
  }

  issueCast(ab, cast) {
    const h = this.hero;
    const target = cast.target ?? cast.point ?? undefined;
    try {
      const chk = ab.canCast?.(target) ?? { ok: true };
      if (chk && chk.ok === false) {
        // Out of range is fine (the order walks us in); anything else → skip
        if (!/range|far/i.test(chk.reason ?? '')) return false;
      }
    } catch (e) { return false; }
    h.issueOrder({ type: 'cast', ability: ab, target: cast.target, point: cast.point });
    this.busyUntil = this.now + (ab.def?.castPoint ?? 0.3) + 1.2;
    return true;
  }

  bestCluster(units, r, maxRange) {
    const h = this.hero;
    let best = null;
    for (const u of units) {
      if (h.distanceTo(u) > maxRange + r) continue;
      let n = 0, sx = 0, sz = 0;
      for (const o of units) if (o.distanceTo(u) <= r) { n++; sx += o.position.x; sz += o.position.z; }
      if (!best || n > best.count) best = { count: n, point: v3(sx / n, sz / n) };
    }
    if (best && h.distanceTo(best.point) > maxRange) {
      // pull the point into range
      const dx = best.point.x - h.position.x, dz = best.point.z - h.position.z, l = Math.hypot(dx, dz);
      if (l - maxRange > r * 0.6) return null;
      best.point.set(h.position.x + (dx / l) * maxRange, 0, h.position.z + (dz / l) * maxRange);
    }
    return best;
  }

  // ---------------------------------------------------------------- items
  itemsOwned() {
    const h = this.hero;
    return [...(h.inventory ?? []), ...(h.backpack ?? []), ...(h.stash ?? [])].filter(Boolean);
  }
  useItems() {
    const g = this.game, h = this.hero, items = g.items;
    if (!items || this.now < this.itemT) return;
    this.itemT = this.now + 0.5;
    const inv = h.inventory ?? [];
    const recentlyHit = this.now - h.lastDamagedTime < 3;
    const fighting = this.ctx.enemyHeroes.some((e) => h.distanceTo(e) < 14);
    for (let slot = 0; slot < inv.length; slot++) {
      const it = inv[slot];
      if (!it?.def) continue;
      const def = it.def;
      const id = `${def.id} ${def.name ?? ''}`;
      const cu = items.canUse ? items.canUse(h, slot) : (it.cooldownRemaining ?? 0) <= 0;
      const canUse = typeof cu === 'object' ? !!cu?.ok : !!cu;
      if (!canUse || !def.active) continue;
      if (Math.random() > this.diff.itemUse) continue;
      const act = def.active;
      let target;
      let want = false;
      if (HEAL_ITEM.test(id)) {
        const needHp = h.healthPct < 0.55 && !recentlyHit && !/clarity/i.test(id);
        const needMana = MANA_ITEM.test(id) && h.manaPct < 0.35 && !recentlyHit;
        if (/bark_ration/i.test(id)) {
          // Bark Ration needs a tree: let the item system resolve it if it can (no target), else skip
          want = h.healthPct < 0.7 && !fighting;
          target = items.findTree?.(h) ?? undefined;
          if (items.findTree && !target) want = false;
        } else want = needHp || needMana || (/honeyed_plum|flask/i.test(id) && h.healthPct < 0.35);
        if (want && act.targetType === 'unit') target = h;
      } else if (fighting && this.fightTarget) {
        const t = this.fightTarget;
        if (act.targetType === 'unit' && act.targetTeam !== 'ally') {
          want = h.distanceTo(t) < (act.castRange ?? 12) + 2; target = t;
          if (this.diff.combo && this.isDisabled(t) && /scythe|toadcurse|silencing_bloom|thornbloom|chasm_blade|whirlwind_scepter|sheep/i.test(id)) want = false;
        }
        else if (act.targetType === 'unit') { want = h.healthPct < 0.6; target = h; }
        else if (act.targetType === 'none') want = true;
        else if (act.targetType === 'point' && /flicker/i.test(id)) {
          const d = h.distanceTo(t);
          want = d > h.getStat('attackRange') + 4 && d < (act.castRange ?? 30);
          target = t.position.clone();
        }
      } else if (this.retreating && act.targetType === 'point' && /flicker/i.test(id)) {
        const f = FOUNTAIN[this.team];
        const dx = f[0] - h.position.x, dz = f[1] - h.position.z, l = Math.hypot(dx, dz) || 1;
        const r = Math.min(act.castRange ?? 25, l);
        want = recentlyHit;
        target = v3(h.position.x + (dx / l) * r, h.position.z + (dz / l) * r);
      }
      if (!want) continue;
      try {
        if (items.use) items.use(h, slot, target);
        else h.issueOrder({ type: 'cast', ability: it, target: target?.isVector3 ? undefined : target, point: target?.isVector3 ? target : undefined });
      } catch (e) { /* ignore */ }
      return;
    }
  }

  nextItemToBuy() {
    const g = this.game, h = this.hero;
    let list = [];
    try { list = g.items?.recommendedItems?.(h.heroId, h) ?? []; } catch (e) { list = []; }
    if (list && !Array.isArray(list)) list = list.all ?? [...(list.starting ?? []), ...(list.early ?? []), ...(list.core ?? []), ...(list.late ?? [])];
    const owned = this.itemsOwned().map((i) => i.def?.id);
    const counts = {};
    for (const id of owned) counts[id] = (counts[id] ?? 0) + 1;
    const want = {};
    for (const entry of list) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (!id) continue;
      want[id] = (want[id] ?? 0) + 1;
      if ((counts[id] ?? 0) >= want[id]) continue;
      if (this.failedItems?.[id] > 3) continue;
      return id;
    }
    return null;
  }

  tryShop() {
    const g = this.game, h = this.hero, items = g.items;
    if (!items?.buy || this.now < this.shopT) return;
    this.shopT = this.now + 1;
    // Item system with stash + courier: buy from anywhere
    if (items.autoBuy) {
      this.shopT = this.now + 2;
      try { items.autoBuy(h, { maxPurchases: 3 }); } catch (e) { /* ignore */ }
      return;
    }
    const inRange = items.inShopRange ? items.inShopRange(h) : this.atFountain();
    if (!inRange) return;
    for (let n = 0; n < 4; n++) {
      const id = this.nextItemToBuy();
      if (!id) return;
      let r;
      try { r = items.buy(h, id); } catch (e) { r = { ok: false, reason: 'error' }; }
      if (r?.ok) continue;
      // Not enough gold for the whole item: buy a missing component instead
      const def = items.getItemDef?.(id) ?? items.defs?.[id] ?? items.ITEM_DEFS?.[id] ?? null;
      const comps = def?.components ?? [];
      const owned = this.itemsOwned().map((i) => i.def?.id);
      let bought = false;
      for (const c of comps) {
        const i = owned.indexOf(c);
        if (i >= 0) { owned.splice(i, 1); continue; }
        let rc;
        try { rc = items.buy(h, c); } catch (e) { rc = null; }
        if (rc?.ok) { bought = true; }
        break;
      }
      if (!bought) {
        if (r && !/gold/i.test(r.reason ?? '')) { this.failedItems ??= {}; this.failedItems[id] = (this.failedItems[id] ?? 0) + 1; }
        return;
      }
    }
  }

  // Cost of the next wanted item (for deciding to go shopping)
  nextItemCost() {
    const id = this.nextItemToBuy();
    if (!id) return Infinity;
    const items = this.game.items;
    const def = items?.getItemDef?.(id) ?? items?.defs?.[id] ?? items?.ITEM_DEFS?.[id];
    return def?.cost ?? Infinity;
  }

  atFountain() {
    const f = FOUNTAIN[this.team];
    return Math.hypot(this.hero.position.x - f[0], this.hero.position.z - f[1]) < 13;
  }

  // ---------------------------------------------------------------- retreat
  shouldRetreat() {
    const h = this.hero;
    const hp = h.healthPct;
    if (this.retreating) {
      // Stay in retreat until healed up (at fountain) or regenerated enough away from danger
      const full = hp > 0.92 && (h.getStat('maxMana') <= 0 || h.manaPct > 0.6);
      if (full) { this.retreating = false; return false; }
      if (!this.atFountain() && hp > 0.75 && !this.ctx.enemyHeroes.length) { this.retreating = false; return false; }
      return true;
    }
    let danger = hp < this.diff.retreatHp;
    if (!danger && hp < 0.5 && this.ctx.enemyHeroes.length) {
      const ratio = this.fightRatio(this.ctx.enemyHeroes[0]);
      if (ratio < 0.8) danger = true;
    }
    if (!danger && hp < 0.25 + 0.1 * this.ctx.enemyHeroes.length && this.now - h.lastDamagedTime < 2) danger = true;
    // Hard: burst-aware — leave before the incoming damage kills us
    if (!danger && this.diff.smart && this.ctx.enemyHeroes.length) {
      const dps = this.d.incomingDps(h);
      if (dps > 0 && h.hp < dps * 2.2 && !(this.fightTarget?.alive && this.fightTarget.hp < this.estimateBurst(this.fightTarget) * 0.6)) danger = true;
    }
    // Out of mana and hurt: go home
    if (!danger && h.getStat('maxMana') > 150 && h.manaPct < 0.12 && hp < 0.5) danger = true;
    // Go shopping when rich enough and not needed
    if (!danger && this.plan?.type !== 'defend' && !this.ctx.enemyHeroes.length) {
      const cost = this.nextItemCost();
      if (h.gold >= cost && cost >= 900 && (hp < 0.7 || h.gold > cost + 600) && !this.game.items?.autoBuy) danger = true;
    }
    if (danger) this.retreating = true;
    return danger;
  }

  doRetreat() {
    const h = this.hero;
    this.fightTarget = null;
    // Use escape / disable / heal while running if hit recently
    if (this.now - h.lastDamagedTime < 2.5 && this.tryCast(null, { retreat: true })) return;
    this.goFountain();
  }

  goFountain() {
    const f = FOUNTAIN[this.team];
    const dx = f[0] - this.hero.position.x, dz = f[1] - this.hero.position.z;
    if (Math.hypot(dx, dz) < 4) { this.stop(); return; }
    this.moveTo(v3(f[0] + (this.team === TEAM.SUNWARD ? 2 : -2), f[1] + (this.team === TEAM.SUNWARD ? -2 : 2)), 2.5);
  }

  // ---------------------------------------------------------------- tower danger
  // Returns true if we had to step out of an enemy tower's range.
  handleTowerDanger() {
    const h = this.hero;
    for (const t of this.ctx.enemyTowers) {
      if (!t.alive) continue;
      const range = t.getStat('attackRange') + 1.5;
      const d = h.edgeDistanceTo(t);
      if (d > range) continue;
      const targetingMe = t.order?.target === h || t.attackTarget === h;
      const tanks = this.ctx.allyCreeps.filter((c) => c.edgeDistanceTo(t) < range - 0.5).length;
      const allowDive = this.diveOk(t);
      if (t.subtype === 'fountain' || (targetingMe && !allowDive) || (tanks === 0 && !allowDive && !(this.mode === 'push' && !t.invulnerable && this.ctx.allyHeroes.length >= 2))) {
        const away = _v.set(h.position.x - t.position.x, 0, h.position.z - t.position.z).normalize();
        const dist = range - d + 3;
        this.moveTo(v3(h.position.x + away.x * dist, h.position.z + away.z * dist), 0.8, true);
        this.debug = 'tower-avoid';
        return true;
      }
    }
    return false;
  }
  diveOk(tower) {
    // Hard bots dive a nearly dead hero if healthy; everyone may hit a nearly dead tower with support
    const h = this.hero;
    const ft = this.fightTarget;
    if (ft?.alive && ft.healthPct < 0.2 && h.healthPct > 0.6 && this.diff.dive) return true;
    if (tower.healthPct < 0.15 && h.healthPct > 0.5 && this.ctx.allyHeroes.length >= 1) return true;
    return h.healthPct > 0.7 && this.ctx.allyHeroes.length >= 3 && this.mode === 'push';
  }

  // ---------------------------------------------------------------- fighting
  fightRatio(target) {
    const h = this.hero;
    const center = target?.position ?? h.position;
    const allies = [h, ...this.ctx.allyHeroes.filter((a) => a.alive && a.distanceTo(center) < 24)];
    const enemies = this.ctx.enemyHeroes.filter((e) => e.alive && e.distanceTo(center) < 26);
    let aH = 0, aD = 0, eH = 0, eD = 0;
    for (const a of allies) { aH += this.heroEhp(a); aD += this.heroDps(a); }
    for (const e of enemies) { eH += this.heroEhp(e); eD += this.heroDps(e); }
    // Towers join fights
    for (const t of this.ctx.enemyTowers) if (t.alive && t.distanceTo(center) < t.getStat('attackRange') + 2) eD += 90;
    for (const t of this.ctx.allyTowers) if (t.alive && t.distanceTo(center) < t.getStat('attackRange') + 2) aD += 90;
    // Creep pressure (small)
    aD += Math.min(6, this.ctx.allyCreeps.length) * 6;
    eD += Math.min(6, this.ctx.enemyCreeps.length) * 6;
    if (!eH || !eD) return 99;
    return (aH * aD) / (eH * eD);
  }

  pickFightTarget() {
    const h = this.hero;
    let best = null, bestS = Infinity;
    const focus = this.d.teamFocus(this.team);
    for (const e of this.ctx.enemyHeroes) {
      if (!e.alive || e.isInvulnerable || !h.canAttack(e)) continue;
      const d = h.distanceTo(e);
      if (d > 26) continue;
      let s = this.heroEhp(e) * (0.5 + 0.5 * this.diff.focus) + d * 25 * (1.2 - this.diff.focus);
      if (e === focus) s *= this.diff.combo ? 0.5 : 0.7;
      if (e === this.fightTarget) s *= 0.85; // stickiness
      if (e.isStunned) s *= this.diff.combo ? 0.65 : 0.8;
      if (s < bestS) { bestS = s; best = e; }
    }
    return best;
  }

  tryFight() {
    const h = this.hero;
    if (!this.ctx.enemyHeroes.length) { this.fightTarget = null; return false; }
    const target = this.pickFightTarget();
    if (!target) { this.fightTarget = null; return false; }
    const ratio = this.fightRatio(target);
    const myBurst = this.estimateBurst(target);
    const killable = target.hp < myBurst && h.healthPct > 0.35;
    const committed = this.fightTarget === target && ratio > this.diff.engage * 0.7;
    const laning = this.plan?.type === 'lane' || !this.plan;
    let engage = ratio > this.diff.engage || killable || committed;
    // In lane, only commit to real kill chances or big advantages; otherwise harass
    // (Before LANE_PHASE_END the bar is the same for every difficulty: hard's lower `engage` used to pull its
    // laners into skirmishes and cost them a third of their last hits, 10.3 against normal's 15.9 at 10 min.)
    const laneBar = this.game.time < LANE_PHASE_END ? Math.max(this.diff.engage * 1.6, LANE_ENGAGE_RATIO) : this.diff.engage * 1.6;
    if (laning && !killable && ratio < laneBar && !committed) engage = false;
    // Being attacked by a hero in lane: fight back if not losing
    if (!engage && target.attackTarget === h && ratio > 0.9 && h.distanceTo(target) < h.getStat('attackRange') + 3) engage = true;
    // Don't chase under enemy towers
    if (engage && !this.diff.dive && this.underEnemyTower(target.position) && !(target.healthPct < 0.12 && h.healthPct > 0.6)) engage = false;
    if (engage && h.distanceTo(target) > 22 && !killable) engage = false;
    if (!engage) {
      this.fightTarget = null;
      // a creep that can be taken now is worth more than a poke at the enemy laner
      if (laning && this.tryLastHit()) return true;
      return this.tryHarass(target);
    }
    this.fightTarget = target;
    this.d.reportFocus(this.team, target);
    this.mode = 'fight';
    if (this.tryCast(target)) return true;
    if (h.order.type !== 'attack' || h.order.target !== target) h.issueOrder({ type: 'attack', target });
    return true;
  }

  estimateBurst(target) {
    const h = this.hero;
    let dmg = this.myDamageVs(target) * 3;
    for (const ab of h.abilities ?? []) {
      if (!ab || !(ab.level > 0) || (ab.cooldownRemaining ?? 0) > 0) continue;
      if (ab.def?.targetType === 'passive') continue;
      if (h.mana < (ab.getManaCost?.() ?? 0)) continue;
      let v = null;
      try { v = ab.v?.('damage'); } catch (e) { v = null; }
      if (typeof v !== 'number') {
        const d = ab.def?.damage;
        const lvl = ab.level - 1;
        v = Array.isArray(d) ? d[Math.min(lvl, d.length - 1)] : typeof d === 'number' ? d : (ab.def?.targetType === 'toggle' ? 0 : 40 + 40 * ab.level * (ab.def?.ultimate ? 2 : 1));
      }
      dmg += v * (1 - (target.getStat('magicResist') ?? 0.25));
    }
    return dmg;
  }

  underEnemyTower(pos) {
    return this.ctx.enemyTowers.some((t) => t.alive && t.distanceTo(pos) < t.getStat('attackRange') + 2);
  }

  tryHarass(target) {
    const h = this.hero;
    if (this.now < this.harassUntil) {
      if (h.order.type === 'attack' && h.order.target === target) {
        // Cancel after one attack has gone out
        if (h.attackWindup < 0 && h.attackCooldown > 0 && h.attackCooldown < h.attackInterval * 0.8) { this.stop(); this.harassUntil = 0; return false; }
        return true;
      }
      return false;
    }
    if (this.plan && this.plan.type !== 'lane') return false;
    const range = h.getStat('attackRange');
    const d = h.edgeDistanceTo(target);
    if (d > range + 1.5 || h.healthPct < 0.5 || h.healthPct < target.healthPct - 0.15) return false;
    if (this.underEnemyTower(target.position) || this.underEnemyTower(h.position)) return false;
    const aggroCreeps = this.ctx.enemyCreeps.filter((c) => c.distanceTo(h) < du(500)).length;
    if (aggroCreeps > 3) return false;
    // one roll per half second, whatever the think interval (hard thinks every 0.1 s and used to poke twice as often for it)
    if (this.now < (this.harassRollAt ?? 0)) return false;
    this.harassRollAt = this.now + 0.5;
    if (Math.random() > this.diff.harass) {
      // occasionally nuke in lane on hard/normal
      if (target.healthPct < 0.6 && Math.random() < this.diff.abilityUse * 0.25 && h.manaPct > 0.5) return this.tryCast(target);
      return false;
    }
    this.harassUntil = this.now + h.attackInterval + 0.8;
    h.issueOrder({ type: 'attack', target });
    return true;
  }

  // ---------------------------------------------------------------- laning
  laneFront(lane) { return this.d.laneFront(this.team, lane); }

  // Step back along the lane if enemy creeps are hitting us (drop creep aggro)
  avoidCreepAggro(lane) {
    const h = this.hero;
    const hitters = this.ctx.enemyCreeps.filter((c) => c.order?.target === h && c.distanceTo(h) < 16).length;
    if (!hitters || (hitters < 2 && h.healthPct > 0.6)) return false;
    const path = LANE_PATHS[this.team][lane];
    const pr = path.project(h.position.x, h.position.z);
    const p = path.pointAt(pr.s - 9);
    this.moveTo(v3(p.x, p.z), 1, true);
    this.debug = 'drop-aggro';
    return true;
  }

  doLane(lane) {
    const h = this.hero;
    if (this.avoidCreepAggro(lane)) return;
    if (this.tryLastHit()) return;
    const f = this.laneFront(lane);
    const path = f.path;
    const ownTower = this.d.structures.frontTower(this.team, lane);
    const towerS = ownTower ? path.project(ownTower.position.x, ownTower.position.z).s : 10;
    const ranged = !h.isMelee;
    const back = ranged ? Math.max(4, h.getStat('attackRange') * 0.6) : 2.5;
    let s;
    if (f.myN > 0) {
      const clash = f.enN > 0 ? Math.min(f.my, f.en) : f.my;
      s = clash - back;
    } else if (f.enN > 0) {
      // Enemy wave without ours: farm near our tower, don't overextend
      s = Math.min(f.en - back - 2, towerS + 4);
    } else s = towerS + 6;
    // Don't go past the enemy's front tower range when nothing tanks
    const et = this.d.structures.frontTower(this.enemy, lane);
    if (et) {
      const es = path.project(et.position.x, et.position.z).s;
      const safe = es - et.getStat('attackRange') - 2;
      if (s > safe && !f.myN) s = safe;
    }
    const p = path.pointAt(s);
    const dir = path.dirAt(s);
    const dest = v3(p.x - dir.z * this.lateral, p.z + dir.x * this.lateral);
    // Last-hit creeps under/near the enemy tower only if a wave tanks it; else just hold position
    this.moveTo(dest, 1.5);
    this.debug = `lane ${lane} s=${s.toFixed(0)}`;
  }

  // Predict creep HP at the time our hit would land; returns true if we issued/are executing a last hit or deny.
  tryLastHit() {
    const g = this.game, h = this.hero;
    // Continue an in-flight last-hit attack order
    const cur = h.order.type === 'attack' ? h.order.target : null;
    if (cur && cur === this.lhTarget) {
      if (!cur.alive) { this.lhTarget = null; return false; }
      const justAttacked = h.attackWindup < 0 && h.attackCooldown > 0 && h.attackCooldown < h.attackInterval * 0.85;
      if (justAttacked && this.predictHp(cur, h.attackCooldown) > this.myDamageVs(cur) * 1.05) { this.stop(); this.lhTarget = null; return false; }
      if (this.now < this.lhUntil) return true;
    }
    this.lhTarget = null;
    const range = h.getStat('attackRange');
    const ms = h.getStat('moveSpeed');
    // Farm priority: a lane support leaves last hits to the allied core next to it (still denies).
    const yieldFarm = !this.game.botLegacyLastHit && this.isSupportHero(h) && this.ctx.allyHeroes.some((a) => a.alive && !this.isSupportHero(a) && a.distanceTo(h) < 16);
    const pool = yieldFarm ? [] : this.ctx.enemyCreeps.concat(this.ctx.neutrals.filter((n) => n.kind === 'neutral' && n.lastAttacker?.team === this.team));
    let best = null, bestHp = Infinity;
    for (const c of pool) {
      if (!c.alive || !h.canAttack(c)) continue;
      const ed = h.edgeDistanceTo(c);
      if (ed > range + 8) continue;
      if (this.underEnemyTower(c.position) && !this.towerBusy(c.position)) continue;
      const tHit = this.timeToHit(c, ed, range, ms);
      const pred = this.predictHp(c, tHit);
      const dmg = this.myDamageVs(c) * this.diff.lhAcc;
      if (pred > 0 && pred <= dmg && c.hp < bestHp) { best = c; bestHp = c.hp; }
    }
    // Nothing killable yet: stand next to the lowest creep that will soon be killable and react faster
    if (!best) {
      let soon = null, soonHp = Infinity;
      for (const c of pool) {
        if (!c.alive || !h.canAttack(c) || c.kind !== 'creep') continue;
        const ed = h.edgeDistanceTo(c);
        if (ed > range + 7 || this.underEnemyTower(c.position) && !this.towerBusy(c.position)) continue;
        if (c.hp < this.myDamageVs(c) * 2.5 && c.hp < soonHp) { soon = c; soonHp = c.hp; }
      }
      if (soon) {
        this.t = Math.min(this.t, 0.1);
        if (h.edgeDistanceTo(soon) > range) {
          const dx = h.position.x - soon.position.x, dz = h.position.z - soon.position.z, l = Math.hypot(dx, dz) || 1;
          const want = Math.max(0.5, range - 0.3) + soon.radius + h.radius;
          this.moveTo(v3(soon.position.x + (dx / l) * want, soon.position.z + (dz / l) * want), 0.5);
          this.debug = 'lh-wait';
          return true;
        }
      }
    }
    if (best && Math.random() > this.diff.lhMiss) {
      this.lhTarget = best;
      this.lhUntil = this.now + 1.2;
      if (h.order.type !== 'attack' || h.order.target !== best) h.issueOrder({ type: 'attack', target: best });
      this.debug = 'lasthit';
      return true;
    }
    // Deny: allied creep under 50% that would die to our hit
    if (Math.random() < this.diff.deny && this.now > this.denyPending) {
      for (const c of this.ctx.allyCreeps) {
        if (!c.alive || c.kind !== 'creep' || c.healthPct > 0.5) continue;
        const ed = h.edgeDistanceTo(c);
        if (ed > range + 0.3) continue;
        const pred = this.predictHp(c, h.getStat('attackPoint') + (h.isMelee ? 0 : ed / Math.max(1, h.getStat('projectileSpeed'))));
        if (pred > 0 && pred <= this.myDamageVs(c) * 0.95 && h.attackCooldown <= 0) {
          this.manualAttack(c);
          return true;
        }
      }
    }
    return false;
  }

  towerBusy(pos) {
    // Enemy tower near pos is currently shooting one of our creeps
    return this.ctx.enemyTowers.some((t) => t.alive && t.distanceTo(pos) < t.getStat('attackRange') + 2 && t.order?.target && t.order.target.kind === 'creep');
  }

  timeToHit(c, ed, range, ms) {
    const h = this.hero;
    const walk = Math.max(0, ed - range) / Math.max(1, ms);
    const aSpd = h.getStat('attackSpeed') / 100;
    const windup = h.getStat('attackPoint') / aSpd;
    const cd = Math.max(0, h.attackCooldown);
    const proj = h.isMelee ? 0 : Math.min(ed, range) / Math.max(1, h.getStat('projectileSpeed'));
    return Math.max(walk, cd) + windup + proj + 0.1;
  }

  // Predicted HP of creep `c` just before a hit landing `t` seconds from now: subtracts every attack that will land
  // before then — projectiles already in flight and the attack cycles (windup + projectile travel + attack interval)
  // of every unit currently attacking it. Falls back to recent average DPS when nothing is known.
  predictHp(c, t) {
    if (this.game.botLegacyLastHit) return c.hp - this.d.incomingDps(c) * t; // A/B test hook (scripts/lh_test.mjs)
    const hits = this.pendingHits(c, t + 0.05);
    let hp = c.hp + (c.getStat?.('hpRegen') ?? 0) * t;
    for (const x of hits) if (x.t < t) hp -= x.dmg;
    // Known hits say it dies before our hit lands → not ours to take;
    if (hp <= 0) return hp;
    // plus a fraction of the recent average DPS for damage we cannot foresee (retargeting creeps, spells, heroes)
    const k = this.game.botLhBlend ?? 0.3;
    return hp - this.d.incomingDps(c) * t * k;
  }

  pendingHits(c, horizon) {
    const g = this.game, h = this.hero, out = [];
    const armor = armorMultiplier(c.getStat('armor'));
    const avgDmg = (u) => ((u.getStat('damageMin') + u.getStat('damageMax')) / 2 + u.bonusFromSources('damage')) * armor;
    for (const p of g.projectiles?.list ?? []) {
      if (p.dead || p.target !== c || !p.isAttack || !p.source || p.source === h) continue;
      const d = Math.hypot(p.pos.x - c.position.x, p.pos.z - c.position.z);
      const t = Math.max(0, d - 0.2) / Math.max(1, p.speed);
      if (t <= horizon) out.push({ t, dmg: avgDmg(p.source) });
    }
    for (const u of g.unitsInRadius(c.position, 16)) {
      if (u === h || u === c || !u.alive) continue;
      const tgt = u.attackTarget ?? (u.order?.type === 'attack' ? u.order.target : null);
      if (tgt !== c || u.isDisarmed) continue;
      const as = Math.max(0.2, u.getStat('attackSpeed') / 100);
      const ps = u.getStat('projectileSpeed');
      const travel = ps > 0 ? Math.max(0, u.edgeDistanceTo(c)) / ps : 0;
      let t;
      if (u.attackWindup >= 0) t = u.attackWindup / as + travel;
      else if (u.inAttackRange(c, 0.3)) t = Math.max(0, u.attackCooldown) + u.getStat('attackPoint') / as + travel;
      else continue;
      const dmg = avgDmg(u) * (u.kind === 'tower' ? 1 : 1);
      const iv = Math.max(0.2, u.attackInterval);
      for (let k = 0; k < 6 && t <= horizon; k++, t += iv) out.push({ t, dmg });
    }
    return out;
  }

  // Attack an allied unit (deny) — core orders refuse allied targets, so replicate the attack here.
  manualAttack(target) {
    const g = this.game, h = this.hero;
    // Core supports explicit deny orders (canAttack(target, true)) — use them when available
    if (h.canDeny?.(target) || h.canAttack?.(target, true)) {
      h.issueOrder({ type: 'attack', target });
      this.lhTarget = target;
      this.lhUntil = this.now + 1.2;
      this.denyPending = this.now + 0.5;
      this.debug = 'deny';
      return;
    }
    this.stop();
    h.facing = Math.atan2(target.position.x - h.position.x, target.position.z - h.position.z);
    h.attackCooldown = h.attackInterval;
    h.playAnim('attack', h.attackAnimOpts?.() ?? { once: true, speed: Math.max(1, h.getStat('attackSpeed') / 100), duration: h.attackInterval });
    const wind = h.getStat('attackPoint') / (h.getStat('attackSpeed') / 100);
    this.denyPending = this.now + wind + 0.2;
    g.delay(wind, () => {
      if (!h.alive || !target.alive || h.isStunned || h.isDisarmed) return;
      if (h.edgeDistanceTo(target) > h.getStat('attackRange') + 1) return;
      try { h.releaseAttack(target); } catch (e) { /* ignore */ }
    });
    this.debug = 'deny';
  }

  // ---------------------------------------------------------------- push / defend / farm / grimmaw
  doPush(plan) {
    const h = this.hero;
    const lane = plan.lane;
    const target = this.d.structures.nextTarget(this.team, lane);
    if (!target) { this.doLane(lane); return; }
    // Gather first if the group is not there yet
    const rally = plan.rally ?? target.position;
    const nearAllies = this.ctx.allyHeroes.filter((a) => a.distanceTo(h) < 18).length;
    const dT = h.distanceTo(target);
    if (dT > 40 && plan.gathered === false && h.distanceTo(rally) > 8) { this.moveTo(rally, 3); this.debug = 'rally'; return; }
    this.tryCast(null, { farm: true, push: true });
    // Kill creeps near us / near the structure first
    const creep = this.ctx.enemyCreeps.filter((c) => c.alive && h.canAttack(c) && h.distanceTo(c) < 14)
      .sort((a, b) => a.hp - b.hp)[0];
    const range = target.getStat?.('attackRange') ?? 0;
    const tankers = this.ctx.allyCreeps.filter((c) => target.kind === 'tower' && c.edgeDistanceTo(target) < range).length;
    const canHit = !target.isInvulnerable && (target.kind !== 'tower' || tankers > 0 || (nearAllies >= 2 && h.healthPct > 0.6) || target.healthPct < 0.2 || target.order?.target !== h);
    if (creep && (!canHit || dT > 10 || creep.distanceTo(h) < 5)) {
      if (h.order.type !== 'attack' || h.order.target !== creep) h.issueOrder({ type: 'attack', target: creep });
      this.debug = 'push-creep';
      return;
    }
    if (canHit && dT < 45) {
      if (h.order.type !== 'attack' || h.order.target !== target) h.issueOrder({ type: 'attack', target });
      this.debug = 'push-structure';
      return;
    }
    if (target.isInvulnerable) {
      // Something else protects it (e.g. T4 needs a T3 down) — push the lane's next thing via lane creeps
      this.doLane(lane);
      return;
    }
    // Wait just outside tower range for creeps
    const path = LANE_PATHS[this.team][lane];
    const ts = path.project(target.position.x, target.position.z).s;
    const p = path.pointAt(ts - (range || 10) - 3);
    this.moveTo(v3(p.x + this.lateral, p.z - this.lateral), 2);
    this.debug = 'push-wait';
  }

  doDefend(plan) {
    const h = this.hero;
    const s = plan.structure;
    if (!s?.alive) { this.doLane(h.lane ?? 'mid'); return; }
    this.tryCast(null, { farm: true });
    const foes = this.game.unitsInRadius(s.position, 22, (u) => u.team === this.enemy && h.canAttack(u) && u.kind !== 'ward')
      .sort((a, b) => (a.kind === 'hero' ? 0 : 1) - (b.kind === 'hero' ? 0 : 1) || a.hp - b.hp);
    const t = foes[0];
    if (t && h.distanceTo(s) < 35) {
      if (h.order.type !== 'attack' || h.order.target !== t) h.issueOrder({ type: 'attack', target: t });
      this.debug = 'defend-attack';
    } else this.moveTo(s.position, 6);
  }

  doFarm(plan) {
    const h = this.hero;
    // 1) enemy creeps in our half of a lane
    if (plan.lane) { this.doLaneFarm(plan.lane); return; }
    // 2) jungle camp
    const camp = plan.camp;
    if (!camp) { this.doLane(h.lane ?? 'mid'); return; }
    const alive = camp.units.filter((u) => u.alive);
    if (!alive.length) { this.moveTo(camp.pos, 3); return; }
    if (this.tryLastHit()) return;
    this.tryCast(null, { farm: true });
    const t = alive.sort((a, b) => a.hp - b.hp)[0];
    if (h.order.type !== 'attack' || h.order.target !== t) h.issueOrder({ type: 'attack', target: t });
    this.debug = 'jungle';
  }

  doLaneFarm(lane) {
    const h = this.hero;
    const f = this.laneFront(lane);
    if (f.enN) {
      const pt = f.path.pointAt(f.en);
      const creep = this.ctx.enemyCreeps.filter((c) => c.alive && h.canAttack(c) && !this.underEnemyTower(c.position)).sort((a, b) => a.hp - b.hp)[0];
      if (creep && h.distanceTo(creep) < 16) {
        this.tryCast(null, { farm: true });
        if (h.order.type !== 'attack' || h.order.target !== creep) h.issueOrder({ type: 'attack', target: creep });
        this.debug = 'lanefarm';
        return;
      }
      this.moveTo(v3(pt.x, pt.z), 3);
      return;
    }
    this.doLane(lane);
  }

  doGrimmaw(plan) {
    const h = this.hero;
    const grim = this.d.neutrals.grimmaw;
    const pit = v3(GRIMMAW_LAIR[0], GRIMMAW_LAIR[1]);
    if (!grim?.alive) { this.doLane(h.lane ?? 'mid'); return; }
    if (plan.contest) {
      // Contesting: converge on the pit from our side; fights with the Grimmaw team are picked up by tryFight.
      const f = FOUNTAIN[this.team];
      const dx = f[0] - pit.x, dz = f[1] - pit.z, l = Math.hypot(dx, dz) || 1;
      if (h.distanceTo(pit) > 12) { this.moveTo(v3(pit.x + (dx / l) * 8 + this.lateral, pit.z + (dz / l) * 8 - this.lateral), 3); this.debug = 'grim-contest'; return; }
      if (h.canAttack(grim) && (h.order.type !== 'attack' || h.order.target !== grim)) h.issueOrder({ type: 'attack', target: grim });
      this.debug = 'grim-steal';
      return;
    }
    const near = this.ctx.allyHeroes.filter((a) => a.distanceTo(pit) < 14).length + 1;
    if (h.distanceTo(pit) > 12 || near < Math.min(3, plan.count ?? 3)) { this.moveTo(v3(pit.x + this.lateral, pit.z - this.lateral + 6), 3); this.debug = 'grim-gather'; return; }
    this.tryCast(null, { farm: true });
    if (h.order.type !== 'attack' || h.order.target !== grim) h.issueOrder({ type: 'attack', target: grim });
    this.debug = 'grimmaw';
  }

  // ---------------------------------------------------------------- runes / wards
  // Walk to a nearby visible rune (claimed so allies don't all go). Runes.canPick() completes the pickup.
  tryRune() {
    const g = this.game, h = this.hero, runes = g.runes;
    if (!runes?.runes?.length || this.retreating) { if (h.data.runeClaim) h.data.runeClaim = null; return false; }
    if ((this.runeRoll ?? 1) > (this.diff.runes ?? 1)) return false;
    const early = g.time < 100;
    const lane = this.plan?.type === 'lane';
    const maxD = early ? 50 : lane ? 30 : 38;
    const r = runes.runeFor(h, maxD);
    if (!r) { h.data.runeClaim = null; this.runeRoll = Math.random(); return false; }
    // Opening bounty runes: supports / non-mid heroes only (mid goes to lane)
    if (early && r.kind === 'bounty' && h.lane === 'mid') return false;
    const foes = this.ctx.enemyHeroes.filter((e) => e.distanceTo(r.pos) < 14).length;
    const friends = 1 + this.ctx.allyHeroes.filter((a) => a.distanceTo(r.pos) < 18).length;
    if (foes > friends || (foes && h.healthPct < 0.5)) { h.data.runeClaim = null; return false; }
    if (this.underEnemyTower(r.pos)) return false;
    h.data.runeClaim = r.id;
    this.moveTo(r.pos, 0.2);
    this.mode = 'rune';
    this.debug = 'rune ' + r.type;
    return true;
  }

  // One or two designated warders per team (supports / poorest bot) buy observer + sentry wards and plant them.
  isWarder() { return this.d.isWarder?.(this.hero) ?? false; }
  wardItems() {
    const out = { obs: -1, sen: -1, any: false };
    const inv = this.hero.inventory ?? [];
    for (let i = 0; i < inv.length; i++) {
      const id = inv[i]?.def?.id;
      if (id === 'lookout_ward' && out.obs < 0) out.obs = i;
      if (id === 'seeker_ward' && out.sen < 0) out.sen = i;
    }
    out.any = out.obs >= 0 || out.sen >= 0;
    return out;
  }
  buyWards() {
    const g = this.game, h = this.hero, items = g.items;
    if (!items?.buy || this.now < (this.wardBuyT ?? 0)) return;
    this.wardBuyT = this.now + 10;
    const owned = (id) => this.itemsOwned().some((it) => it.def?.id === id);
    const stock = (id) => items.stock?.[this.team]?.[id]?.count ?? 1;
    try {
      if (!owned('lookout_ward') && stock('lookout_ward') > 0) items.buy(h, 'lookout_ward');
      // Sentries from 10:00 roughly every 4 minutes (dewarding + invisible heroes)
      if (g.time > 600 && !owned('seeker_ward') && this.now > (this.sentryT ?? 0) && h.gold > 400 && stock('seeker_ward') > 0) {
        if (items.buy(h, 'seeker_ward')?.ok) this.sentryT = this.now + 240;
      }
    } catch (e) { /* ignore */ }
  }
  spotPos(spot) {
    const cache = (this.d._wardSpotCache ??= new Map());
    const key = spot.pos.join(',');
    if (cache.has(key)) return cache.get(key);
    const w = this.game.world;
    let p = v3(spot.pos[0], spot.pos[1]);
    if (w?.isWalkable && !w.isWalkable(p.x, p.z)) {
      const n = w.nearestWalkable?.(p.x, p.z, 8);
      p = n ? v3(n.x, n.z ?? n.y) : null;
    }
    cache.set(key, p);
    return p;
  }
  pickWardSpot(obs) {
    const g = this.game, h = this.hero;
    const list = (obs ? WARD_SPOTS : SENTRY_SPOTS)[this.team] ?? [];
    const sub = obs ? 'observer' : 'sentry';
    const wards = g.units.filter((u) => u.kind === 'ward' && u.alive && u.team === this.team && u.subtype === sub);
    const enemyTowers = this.d.structures.aliveStructures(this.enemy).filter((t) => t.kind === 'tower');
    const maxD = g.time < 540 ? 45 : 80;
    let best = null, bs = Infinity;
    for (const s of list) {
      if (g.time < (s.from ?? 0)) continue;
      const p = this.spotPos(s);
      if (!p) continue;
      if (wards.some((w) => w.distanceTo(p) < (obs ? 22 : 14))) continue;
      if ((this.badSpots?.get(s.name) ?? 0) > this.now) continue;
      const d = h.distanceTo(p);
      if (d > maxD) continue;
      if (enemyTowers.some((t) => t.distanceTo(p) < t.getStat('attackRange') + 4)) continue;
      const sc = (s.prio ?? 0) * 22 + d;
      if (sc < bs) { bs = sc; best = { pos: p, obs, name: s.name, until: this.now + 35 }; }
    }
    return best;
  }
  tryWard() {
    const g = this.game, h = this.hero, items = g.items;
    if (!this.diff.wards || !items?.use || !this.isWarder()) return false;
    this.buyWards();
    const wi = this.wardItems();
    if (!wi.any) { this.wardSpot = null; return false; }
    if (this.ctx.enemyHeroes.length || h.healthPct < 0.45) return false;
    const o = h.order;
    if (o.type === 'cast' && o.ability?.isItem && /^ward_/.test(o.ability.def?.id ?? '')) return true; // walking to plant
    const obs = wi.obs >= 0;
    if (!this.wardSpot || this.wardSpot.obs !== obs || this.now > this.wardSpot.until) {
      if (this.wardSpot && this.now > this.wardSpot.until) (this.badSpots ??= new Map()).set(this.wardSpot.name, this.now + 90);
      this.wardSpot = this.pickWardSpot(obs);
    }
    const sp = this.wardSpot;
    if (!sp) return false;
    if (h.distanceTo(sp.pos) > 11) { this.moveTo(sp.pos, 10); this.mode = 'ward'; this.debug = 'ward-walk ' + sp.name; return true; }
    let r;
    try { r = items.use(h, obs ? wi.obs : wi.sen, sp.pos.clone()); } catch (e) { r = null; }
    if (r?.ok) { this.lastWardAt = this.now; this.wardSpot = null; this.busyUntil = this.now + 0.4; this.debug = 'ward-plant'; }
    else { (this.badSpots ??= new Map()).set(sp.name, this.now + 60); this.wardSpot = null; }
    return true;
  }
  // Attack visible enemy wards nearby when it is safe (bounty + deny vision).
  tryDeward() {
    const h = this.hero;
    const w = this.ctx.enemyWards?.filter((x) => x.alive && h.distanceTo(x) < 16)[0];
    if (!w || this.ctx.enemyHeroes.some((e) => h.distanceTo(e) < 14) || h.healthPct < 0.4 || this.underEnemyTower(w.position)) return false;
    if (h.order.type !== 'attack' || h.order.target !== w) h.issueOrder({ type: 'attack', target: w });
    this.mode = 'deward';
    this.debug = 'deward';
    return true;
  }

  // ---------------------------------------------------------------- movement helpers
  // Teleport (TP scroll) toward far objectives when the item system supports it
  tryTeleport(point) {
    const g = this.game, h = this.hero, items = g.items;
    if (!items?.use || !h.homeScroll || this.retreating || this.now < (this.tpT ?? 0)) return false;
    if (h.distanceTo(point) < 70 || this.ctx.enemyHeroes.length) return false;
    const mode = this.plan?.type;
    if (mode !== 'defend' && mode !== 'push' && mode !== 'lane' && mode !== 'farm') return false;
    this.tpT = this.now + 5;
    let cu;
    try { cu = items.canUse?.(h, 'tp'); } catch (e) { cu = null; }
    if (!(typeof cu === 'object' ? cu?.ok : cu)) return false;
    // Only worth it if an allied structure is much closer to the destination than we are
    const structs = this.d.structures.aliveStructures(this.team).filter((s) => s.subtype !== 'fountain');
    const best = structs.reduce((b, s) => Math.min(b, s.distanceTo(point)), Infinity);
    if (best > h.distanceTo(point) - 40) return false;
    try {
      const r = items.use(h, 'tp', point.clone ? point.clone() : v3(point.x, point.z));
      if (r?.ok) { this.debug = 'tp'; this.stuck.until = this.now + 3.2; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  moveTo(point, tol = 1.5, force = false) {
    const h = this.hero;
    if (h.modifiers.some((m) => m.channel)) return;
    if (h.distanceTo(point) > 70 && this.tryTeleport(point)) return;
    if (h.distanceTo(point) <= tol) {
      if (h.order.type === 'move' || h.order.type === 'attack' || h.order.type === 'attackMove') this.stop();
      return;
    }
    const o = h.order;
    if (!force && o.type === 'move' && o.point && Math.hypot(o.point.x - point.x, o.point.z - point.z) < Math.max(1.5, tol)) return;
    const p = point.clone ? point.clone() : v3(point.x, point.z);
    p.y = 0;
    h.issueOrder({ type: 'move', point: p });
  }
  stop() {
    const h = this.hero;
    if (h.order.type !== 'idle') h.issueOrder({ type: 'stop' });
  }

  checkStuck() {
    const h = this.hero, s = this.stuck;
    const wantsMove = h.order.type === 'move' || (h.order.type === 'attack' && h.order.target && !h.inAttackRange(h.order.target)) || (h.order.type === 'cast' && h.castWindup < 0);
    const moved = Math.hypot(h.position.x - s.pos.x, h.position.z - s.pos.z);
    const dtT = this.now - (s.last ?? this.now);
    s.last = this.now;
    if (!wantsMove || h.isStunned || h.hasState('root') || moved > 0.25 * h.getStat('moveSpeed') * dtT) {
      s.t = Math.max(0, s.t - dtT);
      if (moved > 3) s.count = Math.max(0, s.count - 1);
    } else s.t += dtT;
    s.pos.copy(h.position);
    // Standing inside an unwalkable cell (e.g. spawned into a footprint): every step is rejected — pop out.
    const w0 = this.game.world;
    if (s.t > 0.6 && w0?.isWalkable && !w0.isWalkable(h.position.x, h.position.z)) {
      for (let r = 1; r <= 8; r++) {
        let done = false;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const nx = h.position.x + Math.cos(a) * r, nz = h.position.z + Math.sin(a) * r;
          if (w0.isWalkable(nx, nz)) { h.position.x = nx; h.position.z = nz; done = true; break; }
        }
        if (done) break;
      }
      s.t = 0;
      return;
    }
    if (s.t > 1.8) {
      s.t = 0;
      s.count++;
      // Nudge in a random direction (bigger each time), then re-path
      const a = Math.random() * Math.PI * 2, r = 3 + s.count * 2;
      let nx = h.position.x + Math.cos(a) * r, nz = h.position.z + Math.sin(a) * r;
      const w = this.game.world;
      for (let k = 0; k < 8 && w?.isWalkable && !w.isWalkable(nx, nz); k++) {
        const b = Math.random() * Math.PI * 2;
        nx = h.position.x + Math.cos(b) * r; nz = h.position.z + Math.sin(b) * r;
      }
      h.issueOrder({ type: 'move', point: v3(nx, nz) });
      this.stuck.until = this.now + 0.8 + s.count * 0.2;
      if (s.count >= 4) {
        // Give up on the current objective for a while
        s.count = 0;
        this.lhTarget = null;
        this.d.botStuck?.(this);
      }
    }
  }
}
