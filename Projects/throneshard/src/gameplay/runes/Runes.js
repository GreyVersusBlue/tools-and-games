import * as THREE from 'three';
import { du, TEAM } from '../../core/constants.js';

// Runes (game.runes).
// Timing (documented choice): boon runes spawn every 2 minutes from 2:00 at ONE of the two river spots (random),
// replacing an unclaimed one. Windfall runes spawn at 0:00 and every 2 minutes at the four jungle windfall spots.
// Pickup: right-click the rune (the move order to it) or walk over it; bots use botWantsRune()/claim().
// A hero carrying a Flask stores boon runes in it (player heroes only) instead of activating them.
// Events: rune:spawned {rune}, rune:picked {hero, type, rune, stored}, rune:activated {hero, type}.
export const RUNE_TYPES = {
  haste: { name: 'Haste', color: 0xff3a2a, icon: '👟', duration: 22, desc: 'Movement speed set to maximum.' },
  double_damage: { name: 'Double Damage', color: 0x3a7aff, icon: '⚔️', duration: 45, desc: '+100% base attack damage.' },
  regeneration: { name: 'Regeneration', color: 0x40e040, icon: '💚', duration: 30, desc: 'Rapidly restores health and mana; broken by damage.' },
  invisibility: { name: 'Invisibility', color: 0xb070ff, icon: '👻', duration: 45, desc: 'Invisible until attacking or casting.' },
  arcane: { name: 'Arcane', color: 0xff60d0, icon: '🔮', duration: 50, desc: '-30% cooldowns and mana costs.' },
  illusion: { name: 'Illusion', color: 0xffd040, icon: '🎭', duration: 75, desc: 'Creates two illusions of your hero.' },
  windfall: { name: 'Windfall', color: 0xffc830, icon: '💰', duration: 0, desc: 'Gold for your whole team.' },
};
const BOON = ['haste', 'double_damage', 'regeneration', 'invisibility', 'arcane', 'illusion'];

// River boon rune spots (top near Grimmaw, bottom) and jungle windfall spots (2 per side).
export const BOON_RUNE_SPOTS = [[-22, -22], [24, 24]];
export const WINDFALL_RUNE_SPOTS = [[-45, 5], [20, 45], [45, -5], [-20, -45]];
export const RUNE_INTERVAL = 120;
export const BOON_RUNE_START = 120;
const PICK_RANGE = 1.6;

export class Runes {
  constructor(game) {
    this.game = game;
    this.runes = []; // { id, type, pos: Vector3, spot, kind: 'boon'|'windfall', mesh, spawnedAt }
    this.nextBoon = BOON_RUNE_START;
    this.nextWindfall = 0;
    this.stats = { spawned: 0, picked: {}, stored: 0 };
    this._id = 1;
    this._t = 0;
    this.boonSpots = BOON_RUNE_SPOTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.windfallSpots = WINDFALL_RUNE_SPOTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  onMatchStart() {
    const g = this.game;
    this.nextBoon = BOON_RUNE_START;
    this.nextWindfall = 0;
  }

  // ---------------------------------------------------------------- spawning
  spawn(type, spot, kind) {
    const g = this.game;
    // replace an unclaimed rune at the same spot
    for (const r of [...this.runes]) if (r.spot === spot) this.remove(r);
    const pos = spot.clone();
    pos.y = g.world?.getHeight?.(pos.x, pos.z) ?? 0;
    const rune = { id: this._id++, type, kind, spot, pos, spawnedAt: g.time, mesh: this.makeMesh(type) };
    rune.mesh.position.copy(pos);
    g.scene?.add(rune.mesh);
    this.runes.push(rune);
    this.stats.spawned++;
    g.bus.emit('rune:spawned', { rune });
    return rune;
  }

  remove(rune) {
    const i = this.runes.indexOf(rune);
    if (i >= 0) this.runes.splice(i, 1);
    rune.mesh?.parent?.remove(rune.mesh);
    rune.mesh?.traverse?.((o) => { o.geometry?.dispose?.(); if (o.material && !o.material._shared) o.material.dispose?.(); });
    rune.removed = true;
  }

  makeMesh(type) {
    const def = RUNE_TYPES[type];
    const grp = new THREE.Group();
    grp.name = 'rune_' + type;
    const col = new THREE.Color(def.color);
    // floating gem
    const gem = new THREE.Mesh(
      type === 'windfall' ? new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20).rotateX(Math.PI / 2) : new THREE.OctahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.25, transparent: true, opacity: 0.95 }),
    );
    gem.position.y = 1.1;
    gem.castShadow = false;
    grp.add(gem);
    // inner core
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    core.position.y = 1.1;
    grp.add(core);
    // outer glow halo (additive sprite-like sphere)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = 1.1;
    grp.add(halo);
    // ground ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 0.06;
    grp.add(ring);
    // (no PointLight: changing the scene's light count would force every lit material to recompile)
    grp.userData = { gem, core, halo, ring, noPick: true };
    grp.scale.setScalar(1.35);
    grp.traverse((o) => { o.userData.noPick = true; o.raycast = () => {}; });
    return grp;
  }

  // ---------------------------------------------------------------- pickup / effects
  canPick(hero, rune) {
    if (!hero?.alive || hero.kind !== 'hero' || hero.isIllusion || hero.data?.isIllusion) return false;
    if (hero.isStunned) return false;
    const d = Math.hypot(hero.position.x - rune.pos.x, hero.position.z - rune.pos.z);
    if (d > PICK_RANGE) return false;
    if (d < 0.9) return true;
    // Deliberate pickup: the hero was ordered to (right-clicked) the rune spot, or a bot claimed it
    const o = hero.order;
    if (o?.point && Math.hypot(o.point.x - rune.pos.x, o.point.z - rune.pos.z) < 3) return true;
    if (hero.data?.runeClaim === rune.id) return true;
    return hero.order?.type === 'idle';
  }

  pick(hero, rune) {
    const g = this.game;
    this.remove(rune);
    this.stats.picked[rune.type] = (this.stats.picked[rune.type] ?? 0) + 1;
    if (hero.data) hero.data.runeClaim = null;
    let stored = false;
    if (rune.kind === 'boon' && !hero.isBot) {
      const flask = (hero.inventory ?? []).find((it) => it?.def?.id === 'flask');
      if (flask && !flask.storedRune) {
        flask.storedRune = rune.type;
        flask.storedAt = g.time;
        flask.charges = flask.def.maxCharges ?? 3;
        stored = true;
        this.stats.stored++;
        g.bus.emit('ui:message', { text: `${RUNE_TYPES[rune.type].name} rune stored`, color: '#' + RUNE_TYPES[rune.type].color.toString(16).padStart(6, '0') });
      }
    }
    g.audio?.play?.('rune', { position: rune.pos });
    g.bus.emit('rune:picked', { hero, type: rune.type, rune, stored });
    if (!stored) this.activate(hero, rune.type);
  }

  activate(hero, type, opts = {}) {
    const g = this.game;
    const def = RUNE_TYPES[type];
    if (!def || !hero?.alive) return;
    const base = { name: def.name + ' Rune', icon: def.icon, duration: def.duration, rune: true };
    switch (type) {
      case 'windfall': {
        const gold = Math.round(36 + 2 * Math.max(0, Math.floor(g.time / 60)));
        for (const h of g.heroes) if (h.team === hero.team) h.addGold(gold, 'windfall');
        hero.addXp?.(Math.round(20 + 3 * Math.floor(Math.max(0, g.time) / 60)));
        g.bus.emit('gold:popup', { unit: hero, hero, amount: gold });
        break;
      }
      case 'haste':
        // movement speed becomes the maximum (550)
        hero.addModifier({ ...base, id: 'rune_haste', vfxName: 'rune_haste', bonus: { get moveSpeed() { return Math.max(0, du(550) - hero.baseStats.moveSpeed); } } });
        break;
      case 'double_damage':
        hero.addModifier({ ...base, id: 'rune_double_damage', vfxName: 'rune_double_damage', bonus: { get damage() { return (hero.baseStats.damageMin + hero.baseStats.damageMax) / 2 + (hero.def?.primary && hero.def.primary !== 'uni' ? hero.attr(hero.def.primary) : 0); } } });
        break;
      case 'regeneration':
        hero.addModifier({ ...base, id: 'rune_regeneration', vfxName: 'rune_regeneration',
          bonus: { get hpRegen() { return 0.06 * hero.getStat('maxHp'); }, get manaRegen() { return 0.06 * hero.getStat('maxMana'); } },
          onTick(u) { if (u.hp >= u.getStat('maxHp') - 1 && u.mana >= u.getStat('maxMana') - 1) this.remaining = 0; },
          onDamageTaken(u, info) {
            const s = info.source;
            if (info.amount > 0 && s && s.team !== u.team && (s.kind === 'hero' || s.owner?.kind === 'hero' || s.kind === 'tower' || s.kind === 'grimmaw')) this.remaining = 0;
          } });
        break;
      case 'invisibility':
        hero.addModifier({ ...base, id: 'rune_invisibility', invisible: true, breakOnAttack: true, breakOnCast: true, appliedFrame: g.frame });
        break;
      case 'arcane':
        hero.addModifier({ ...base, id: 'rune_arcane', vfxName: 'rune_arcane', bonus: { cooldownReduction: 0.3, manaCostReduction: 0.3 } });
        break;
      case 'illusion':
        try { g.items?.spawnIllusions?.(hero, 2, def.duration); } catch (e) { console.warn('[runes] illusions', e); }
        break;
    }
    g.bus.emit('rune:activated', { hero, type, fromFlask: !!opts.fromFlask });
    if (hero === g.player?.hero || hero.team === g.player?.team) g.bus.emit('ui:message', { text: `${hero.name} activated ${def.name}${type === 'windfall' ? '' : ' rune'}`, color: '#' + def.color.toString(16).padStart(6, '0') });
  }

  // ---------------------------------------------------------------- bot helpers
  // Rune a bot of `team` could go for: visible, near, not claimed by an ally who is closer.
  runeFor(hero, maxDist = 30) {
    let best = null, bd = maxDist;
    for (const r of this.runes) {
      const d = Math.hypot(hero.position.x - r.pos.x, hero.position.z - r.pos.z);
      if (d > bd) continue;
      if (!this.game.world?.isVisible?.(hero.team, r.pos.x, r.pos.z) && !(d < 20)) continue;
      const claimant = this.game.heroes.find((h) => h !== hero && h.team === hero.team && h.alive && h.data?.runeClaim === r.id);
      if (claimant && claimant.distanceTo(r.pos) < d) continue;
      bd = d; best = r;
    }
    return best;
  }
  // Seconds until the next rune spawn of any kind.
  timeToNextSpawn() { return Math.min(this.nextBoon, this.nextWindfall) - this.game.time; }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    if (!g.running || g.matchOver) return;
    if (dt > 0) {
      if (g.time >= this.nextWindfall) {
        for (const s of this.windfallSpots) this.spawn('windfall', s, 'windfall');
        this.nextWindfall += RUNE_INTERVAL;
      }
      if (g.time >= this.nextBoon) {
        const spot = this.boonSpots[Math.floor(Math.random() * this.boonSpots.length)];
        for (const r of [...this.runes]) if (r.kind === 'boon') this.remove(r); // only one boon rune on the map
        this.spawn(BOON[Math.floor(Math.random() * BOON.length)], spot, 'boon');
        this.nextBoon += RUNE_INTERVAL;
      }
      // pickups
      for (const r of [...this.runes]) {
        for (const h of g.unitsInRadius(r.pos, PICK_RANGE + 0.5, (u) => u.kind === 'hero')) {
          if (this.canPick(h, r)) { this.pick(h, r); break; }
        }
      }
      // stored runes auto-activate after 90s
      for (const h of g.heroes) {
        for (const it of h.inventory ?? []) {
          if (it?.storedRune && g.time - (it.storedAt ?? g.time) > 90 && h.alive) { const t = it.storedRune; it.storedRune = null; this.activate(h, t, { fromFlask: true }); }
        }
      }
    }
    // visuals: bob/spin; only visible when the player's team has vision of the spot
    const team = g.player?.team ?? TEAM.SUNWARD;
    const t = g.realTime ?? 0;
    for (const r of this.runes) {
      const m = r.mesh, u = m.userData;
      const vis = g.world?.isVisible ? g.world.isVisible(team, r.pos.x, r.pos.z) : true;
      m.visible = vis;
      if (!vis) continue;
      u.gem.rotation.y = t * 1.6;
      u.gem.position.y = u.core.position.y = u.halo.position.y = 1.1 + Math.sin(t * 2.2 + r.id) * 0.15;
      u.halo.scale.setScalar(1 + Math.sin(t * 3 + r.id) * 0.08);
      u.ring.rotation.y = -t * 0.8;
      u.ring.material.opacity = 0.4 + Math.sin(t * 4) * 0.15;
    }
  }

  // Minimap markers (read by the minimap overlay): only runes the given team can see.
  markers(team) {
    const g = this.game;
    return this.runes.filter((r) => !g.world?.isVisible || g.world.isVisible(team, r.pos.x, r.pos.z))
      .map((r) => ({ x: r.pos.x, z: r.pos.z, color: '#' + RUNE_TYPES[r.type].color.toString(16).padStart(6, '0'), kind: r.kind, type: r.type }));
  }
}
