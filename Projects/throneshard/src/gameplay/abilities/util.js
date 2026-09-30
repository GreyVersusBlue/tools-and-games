import * as THREE from 'three';
import { du, armorMultiplier } from '../../core/constants.js';

export { du, armorMultiplier, THREE };

// Per-level value helper: lv([1,2,3,4], level) -> value for that level (clamped). Scalars pass through.
export const lv = (v, level) => (Array.isArray(v) ? v[Math.max(0, Math.min(v.length - 1, (level || 1) - 1))] : v);

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const flat = (p) => new THREE.Vector3(p.x, 0, p.z);
export const posOf = (t) => (t?.position ? t.position : t);
export const isUnit = (t) => !!(t && t.position && typeof t.takeDamage === 'function');

export function dirTo(from, to) {
  const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  const l = d.length();
  if (l < 1e-4) return d.set(0, 0, 1);
  return d.divideScalar(l);
}
export const facingDir = (u) => new THREE.Vector3(Math.sin(u.facing), 0, Math.cos(u.facing));
export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function unitHeight(u) { return u?.model?.height ?? (u?.kind === 'hero' ? 2.2 : 1.6); }
export function chest(u, f = 0.6) { const p = u.position.clone(); p.y += unitHeight(u) * f; return p; }

// Valid enemy for a spell (alive, not invulnerable, optionally not magic immune).
export function validEnemy(src, u, { pierceImmunity = false, structures = false } = {}) {
  if (!u || !u.alive || u.team === src.team || u.isInvulnerable) return false;
  if (!structures && u.isStructure) return false;
  if (!pierceImmunity && u.isMagicImmune) return false;
  return true;
}

export function enemiesIn(game, src, pos, r, opts = {}) {
  return game.unitsInRadius(pos, r, (u) => validEnemy(src, u, opts) && (!opts.heroesOnly || u.kind === 'hero') && (!opts.filter || opts.filter(u)));
}
export function alliesIn(game, src, pos, r, filter) {
  return game.unitsInRadius(pos, r, (u) => u.team === src.team && !u.isStructure && (!filter || filter(u)));
}

export function nearest(list, pos) {
  let best = null, bd = Infinity;
  for (const u of list) { const d = dist2d(u.position, pos); if (d < bd) { bd = d; best = u; } }
  return best;
}

// Spell damage wrapper (respects magic immunity through Unit.takeDamage).
export function damage(target, amount, type, source, ability, extra = {}) {
  if (!target?.alive || amount <= 0) return 0;
  // Spell amplification (items: Clearmind etc.) applies to ability damage, never to self-damage
  if (ability && source && source !== target) {
    const amp = source.bonusFromSources?.('spellAmp') ?? 0;
    if (amp) amount *= 1 + amp;
  }
  return target.takeDamage(amount, type ?? 'magical', source, { ability, ...extra });
}

// ---- status effects (modifiers) ----
export function stun(target, duration, source, opts = {}) {
  if (!target?.alive || duration <= 0) return null;
  if (target.isMagicImmune && !opts.pierceImmunity) return null;
  return target.addModifier({
    id: opts.id ?? 'stunned', name: 'Stunned', icon: '💫', debuff: true, duration, stun: true, source,
    vfxName: 'vfxName' in opts ? opts.vfxName : 'stun', noStunVfx: 'vfxName' in opts && !opts.vfxName, ...(opts.mod ?? {}),
  });
}
export function slow(target, pct, duration, source, opts = {}) {
  if (!target?.alive) return null;
  if (target.isMagicImmune && !opts.pierceImmunity) return null;
  const bonus = { ...(opts.bonus ?? {}) };
  if (opts.attackSlow) bonus.attackSpeed = (bonus.attackSpeed ?? 0) - opts.attackSlow;
  return target.addModifier({
    id: opts.id ?? 'slowed', name: opts.name ?? 'Slowed', icon: opts.icon ?? '🐌', debuff: true, duration, slow: pct, bonus, source,
    vfxName: opts.vfxName, ...(opts.mod ?? {}),
  });
}
export function silence(target, duration, source, opts = {}) {
  if (!target?.alive || (target.isMagicImmune && !opts.pierceImmunity)) return null;
  return target.addModifier({ id: opts.id ?? 'silenced', name: 'Silenced', icon: '🤐', debuff: true, duration, silence: true, source, vfxName: 'silence' });
}

// Smoothly move a unit to `dest` over `duration` seconds. Unit is disabled while moving (standard knockbacks/pulls).
// opts: { arc (height), disable (default true), onEnd(unit), id, faceDir }
export function forceMove(game, unit, dest, duration, opts = {}) {
  if (!unit?.alive || unit.immobile) return null;
  const w = game.world;
  const start = unit.position.clone();
  let end = dest.clone();
  if (w?.isWalkable && !w.isWalkable(end.x, end.z)) end = safePoint(game, end, start);
  const id = opts.id ?? 'forced_move';
  let t = 0;
  unit.removeModifier(id);
  const mod = unit.addModifier({
    id, hidden: true, debuff: opts.disable !== false, duration: duration + 0.05,
    stun: opts.disable !== false, noStunVfx: true, vfxName: null,
    onTick(u, dt) {
      t = Math.min(duration, t + dt);
      const k = duration > 0 ? t / duration : 1;
      u.position.x = start.x + (end.x - start.x) * k;
      u.position.z = start.z + (end.z - start.z) * k;
      u.data.airHeight = opts.arc ? Math.sin(Math.PI * k) * opts.arc : 0; // applied visually by AbilitySystem.update
    },
    onExpire(u) {
      u.data.airHeight = 0;
      if (u.alive) {
        u.position.x = end.x; u.position.z = end.z;
        u.path = [];
        opts.onEnd?.(u);
      }
    },
  });
  if (opts.disable !== false) unit.interrupt?.();
  return mod;
}

// Find a walkable point near `p` (falls back toward `fallback`).
export function safePoint(game, p, fallback) {
  const w = game.world;
  const q = new THREE.Vector3(p.x, 0, p.z);
  if (!w?.isWalkable || w.isWalkable(q.x, q.z)) return q;
  const nw = w.nearestWalkable?.(q.x, q.z) ?? w.nearestWalkable?.(q);
  if (nw) return new THREE.Vector3(nw.x, 0, nw.z ?? nw.y);
  // spiral search
  for (let r = 0.5; r < 8; r += 0.5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = q.x + Math.cos(a) * r, z = q.z + Math.sin(a) * r;
      if (w.isWalkable(x, z)) return new THREE.Vector3(x, 0, z);
    }
  }
  return fallback ? new THREE.Vector3(fallback.x, 0, fallback.z) : q;
}

// Instantly relocate a unit (blink). Clears pathing/orders sensibly.
export function blinkTo(game, unit, point, maxRange = Infinity) {
  const from = unit.position.clone();
  const d = dirTo(from, point);
  const dist = Math.min(dist2d(from, point), maxRange);
  let dest = from.clone().addScaledVector(d, dist);
  dest = safePoint(game, dest, from);
  game.vfx?.spawn?.('blink', { position: from.clone(), color: 0x66aaff });
  unit.position.x = dest.x; unit.position.z = dest.z;
  unit.path = [];
  if (unit.object) unit.object.position.set(dest.x, unit.object.position.y, dest.z);
  if (dist > 0.01) unit.facing = Math.atan2(d.x, d.z);
  game.vfx?.spawn?.('blink', { position: dest.clone(), color: 0x66aaff, arrive: true });
  return dest;
}

// Points along a segment, useful for line AOE checks.
export function unitsOnLine(game, src, from, dir, length, width, opts = {}) {
  const out = [];
  for (const u of game.units) {
    if (!validEnemy(src, u, opts)) continue;
    const rx = u.position.x - from.x, rz = u.position.z - from.z;
    const along = rx * dir.x + rz * dir.z;
    if (along < -width || along > length + width) continue;
    const perp = Math.abs(rx * dir.z - rz * dir.x);
    if (perp <= width + (u.radius ?? 0.5)) out.push(u);
  }
  return out;
}

export function fx(game, name, opts) {
  try { return game.vfx?.spawn?.(name, opts) ?? null; } catch (e) { console.warn('[vfx]', name, e); return null; }
}
export function sfx(game, name, pos) {
  try { game.audio?.play?.(name, { position: pos }); } catch { /* audio optional */ }
}

// Critical strike helper for onAttackStart hooks: highest multiplier wins.
export function applyCrit(info, mult, tag) {
  if (info.base == null) info.base = info.amount;
  if (mult > (info.critMult ?? 1)) {
    info.critMult = mult;
    info.amount = info.base * mult + (info.flatAfterCrit ?? 0);
    info.crit = true;
    info.critTag = tag;
  }
}

// Pseudo-random distribution (PRD) — keeps proc streaks sane. c constants for common chances.
const PRD_C = { 0.05: 0.0038, 0.1: 0.01475, 0.15: 0.03222, 0.17: 0.04, 0.2: 0.0557, 0.25: 0.08475, 0.3: 0.11895, 0.35: 0.16, 0.4: 0.20155, 0.5: 0.30210 };
export function prd(unit, key, chance) {
  const c = PRD_C[Math.round(chance * 100) / 100] ?? chance * 0.5;
  const st = (unit.data._prd ??= {});
  const n = (st[key] = (st[key] ?? 0) + 1);
  if (Math.random() < c * n) { st[key] = 0; return true; }
  return false;
}

// Issue an order from inside ability.cast(). Unit.updateCast calls nextOrder() right after cast(),
// so when cast came from a cast order we queue it at the front instead of issuing directly.
export function orderAfterCast(unit, ab, order) {
  if (unit.order?.type === 'cast' && unit.order.ability === ab) unit.orderQueue.unshift(order);
  else unit.issueOrder(order);
}
