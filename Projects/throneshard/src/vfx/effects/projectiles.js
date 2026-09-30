import * as THREE from 'three';
import { FRAME } from '../textures.js';
import { GEO, fresnelMat, fireMat } from '../meshfx.js';

// Projectile visual styles. Every style shares materials (cached) so spawning projectiles allocates only Object3Ds.
const TEAM_ORB = { sunward: 0x9dff6a, duskward: 0xff6a3a, neutral: 0xffd060 };
const TOWER_ORB = { sunward: 0x7fe0ff, duskward: 0xff5030, neutral: 0xffd060 };

const STYLES = {
  default: { glow: 0xffe6aa, size: 0.9, trail: { rate: 30, color: 0xffe6aa, size: [0.4, 0.05], life: 0.25 }, impact: 'spark' },
  pell: { glow: 0xffd9a0, size: 0.9, mesh: 'bullet', streak: 0xffcc66, trail: { rate: 60, color: 0xaaa090, alpha: true, size: [0.2, 0.5], life: 0.35 }, impact: 'bullet' },
  vesna: { glow: 0xe8f4ff, size: 0.7, mesh: 'arrow', trail: { rate: 25, color: 0xdfefff, size: [0.18, 0.02], life: 0.2 }, impact: 'spark_small' },
  vesna_chill_arrow: { glow: 0x7fd0ff, size: 1.5, mesh: 'arrow', trail: { rate: 60, color: 0xbfe8ff, color2: 0x3a8cff, size: [0.35, 0.05], life: 0.35, frame: FRAME.FLAKE }, impact: 'frost_small' },
  vesna_hunters_eye: { glow: 0xffffff, size: 1.4, mesh: 'arrow', trail: { rate: 90, color: 0xffffff, color2: 0x88ccff, size: [0.35, 0.02], life: 0.3, frame: FRAME.SPARK }, impact: 'pierce' },
  sera: { glow: 0xff9a30, size: 1.3, trail: { rate: 70, color: 0xffdd66, color2: 0xff2200, size: [0.7, 0.05], life: 0.35, up: 0.8 }, core: 0xffffcc, impact: 'fire' },
  isolde: { glow: 0x88ccff, size: 1.1, mesh: 'crystal', crystal: 0xcdeeff, trail: { rate: 45, color: 0xffffff, color2: 0x66aaff, size: [0.3, 0.05], life: 0.35, frame: FRAME.FLAKE }, impact: 'frost_small' },
  morvane: { glow: 0x40e0c0, size: 1.1, trail: { rate: 45, color: 0x9fffee, color2: 0x106a6a, size: [0.45, 0.05], life: 0.4 }, core: 0xe0fff8, impact: 'frost_small' },
  thalor: { glow: 0x9fd8ff, size: 1.2, trail: { rate: 70, color: 0xffffff, color2: 0x55aaff, size: [0.35, 0.02], life: 0.18, frame: FRAME.SPARK, spread: 0.3 }, core: 0xffffff, impact: 'zap' },
  vashkar: { glow: 0xff5530, size: 1.0, trail: { rate: 45, color: 0xffaa66, color2: 0x661100, size: [0.45, 0.05], life: 0.3 }, core: 0xffddaa, impact: 'spark' },
  creep_ranged: { team: TEAM_ORB, size: 0.75, trail: { rate: 30, size: [0.35, 0.05], life: 0.25 }, impact: 'spark_small' },
  creep_siege: { mesh: 'boulder', glow: 0xffaa55, size: 0.6, trail: { rate: 25, color: 0x8a7a66, alpha: true, size: [0.4, 1.0], life: 0.6 }, impact: 'boulder' },
  tower: { team: TOWER_ORB, size: 1.8, trail: { rate: 80, size: [0.7, 0.05], life: 0.35, spread: 0.15 }, core: 0xffffff, impact: 'tower' },
  fountain: { team: TOWER_ORB, size: 2.2, trail: { rate: 90, size: [0.8, 0.05], life: 0.35 }, core: 0xffffff, impact: 'tower' },
  neutral: { glow: 0xd0ff90, size: 0.8, trail: { rate: 30, color: 0xd0ff90, size: [0.35, 0.05], life: 0.25 }, impact: 'spark_small' },
  // Ability projectiles
  flame_wave: { size: 0, wave: 'fire', impact: 'none' },
  hush_wind: { size: 0, wave: 'wind', impact: 'none' },
  stone_spines: { size: 0, spikes: true, impact: 'none' },
  thunder_gauntlet: { glow: 0x66bbff, size: 2.2, mesh: 'hammer', trail: { rate: 80, color: 0xffffff, color2: 0x3388ff, size: [0.4, 0.03], life: 0.25, frame: FRAME.SPARK, spread: 0.4 }, core: 0xffffff, impact: 'none' },
  grave_frost: { glow: 0x66c8ff, size: 2.0, mesh: 'crystal', crystal: 0xbfe8ff, crystalScale: 0.35, trail: { rate: 80, color: 0xffffff, color2: 0x3a9cff, size: [0.5, 0.05], life: 0.45, frame: FRAME.FLAKE, spread: 0.3 }, core: 0xffffff, impact: 'none' },
  leaping_cold: { glow: 0x55bbff, size: 2.6, mesh: 'orb', orb: 0x88ddff, trail: { rate: 100, color: 0xeaf8ff, color2: 0x2266ff, size: [0.55, 0.05], life: 0.55, frame: FRAME.FLAKE, spread: 0.5 }, core: 0xffffff, impact: 'none' },
  final_round: { glow: 0xffa040, size: 1.6, mesh: 'bullet', streak: 0xff7a20, streakLen: 4, trail: { rate: 120, color: 0xbbb0a0, alpha: true, size: [0.3, 1.0], life: 0.7 }, core: 0xffffff, impact: 'none' },
  throwing_knife: { glow: 0xc080ff, size: 1.6, mesh: 'dagger', trail: { rate: 90, color: 0xe0c0ff, color2: 0x6020a0, size: [0.55, 0.03], life: 0.3 }, impact: 'none' },
};

// Model-kind aliases -> style keys
const ALIAS = {
  brakka: 'default', kenshar: 'default', gorrow: 'default', aldric: 'default', sable: 'default',
  neutral_small: 'neutral', neutral_medium: 'neutral', neutral_large: 'neutral', neutral_elder: 'neutral',
  chill_arrow: 'vesna_chill_arrow', arrow: 'vesna', fireball: 'sera', ice: 'isolde', lightning: 'thalor', bullet: 'pell',
};

export function styleFor(kind) {
  if (STYLES[kind]) return STYLES[kind];
  if (ALIAS[kind]) return STYLES[ALIAS[kind]];
  if (kind?.startsWith?.('tower')) return STYLES.tower;
  if (kind?.startsWith?.('creep_siege')) return STYLES.creep_siege;
  if (kind?.startsWith?.('creep')) return STYLES.creep_ranged;
  if (kind?.startsWith?.('neutral')) return STYLES.neutral;
  return STYLES.default;
}

function fireMatCached(vfx) {
  return cached(vfx, 'dragon_fire', () => { const m = fireMat(vfx, 0xffd070, 0xff2a00, 3); m.uniforms.uOpacity.value = 1.0; return m; });
}
function cached(vfx, key, make) {
  return (vfx.sharedMats[key] ??= make());
}
function glowMat(vfx, color) {
  return cached(vfx, 'glow_' + color, () => new THREE.SpriteMaterial({ map: vfx.tex.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
}

function buildMesh(vfx, st, g) {
  switch (st.mesh) {
    case 'arrow': {
      const wood = cached(vfx, 'arrow_wood', () => new THREE.MeshBasicMaterial({ color: 0x7a5a3a }));
      const tip = cached(vfx, 'arrow_tip', () => new THREE.MeshBasicMaterial({ color: 0xdde8f0 }));
      const s = new THREE.Mesh(GEO.arrowShaft, wood); s.scale.set(1, 1, 1.1);
      const h = new THREE.Mesh(GEO.arrowHead, tip);
      g.add(s, h);
      break;
    }
    case 'bullet': {
      const m = cached(vfx, 'streak_' + st.streak, () => new THREE.MeshBasicMaterial({ color: st.streak, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const s = new THREE.Mesh(GEO.streak, m);
      const L = st.streakLen ?? 1.6;
      s.scale.set(st.streakLen ? 3 : 1.5, st.streakLen ? 3 : 1.5, L);
      g.add(s);
      break;
    }
    case 'crystal': {
      const m = cached(vfx, 'crystal_' + st.crystal, () => new THREE.MeshBasicMaterial({ color: st.crystal, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const c = new THREE.Mesh(GEO.shard, m);
      const s = st.crystalScale ?? 0.22;
      c.scale.set(s, s, s * 1.8);
      c.userData.spin = true;
      g.add(c);
      break;
    }
    case 'orb': {
      const m = fresnelMat(vfx, st.orb, { power: 1.6, noise: 0.7 });
      const o = new THREE.Mesh(GEO.sphere, m);
      o.scale.setScalar(0.55);
      o.userData.ownMat = m;
      o.userData.spin = true;
      g.add(o);
      break;
    }
    case 'hammer': {
      const metal = cached(vfx, 'hammer_metal', () => new THREE.MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.8, roughness: 0.3, emissive: 0x2255aa, emissiveIntensity: 0.6 }));
      const grip = cached(vfx, 'hammer_grip', () => new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.8 }));
      const hg = new THREE.Group();
      const head = new THREE.Mesh(GEO.box, metal); head.scale.set(0.7, 0.4, 0.4); head.position.y = 0.4;
      const handle = new THREE.Mesh(GEO.box, grip); handle.scale.set(0.1, 0.9, 0.1);
      hg.add(head, handle);
      hg.userData.tumble = true;
      g.add(hg);
      break;
    }
    case 'boulder': {
      const m = cached(vfx, 'boulder', () => new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.95, flatShading: true }));
      const b = new THREE.Mesh(GEO.dodeca, m);
      b.scale.setScalar(0.4);
      b.userData.tumble = true;
      g.add(b);
      break;
    }
    case 'dagger': {
      const blade = cached(vfx, 'dagger_blade', () => new THREE.MeshBasicMaterial({ color: 0xe8e0ff, side: THREE.DoubleSide }));
      const d = new THREE.Group();
      const b = new THREE.Mesh(GEO.blade, blade);
      d.add(b);
      d.userData.flip = true;
      g.add(d);
      break;
    }
    default:
  }
}

export function createProjectileVisual(vfx, kind, opts = {}) {
  const st = styleFor(kind);
  const team = opts.source?.team ?? 'neutral';
  const color = st.team ? st.team[team] ?? 0xffffff : st.glow ?? 0xffffff;
  const g = new THREE.Group();
  vfx.root.add(g);
  if (st.size > 0) {
    const s = new THREE.Sprite(glowMat(vfx, color));
    s.scale.set(st.size, st.size, 1);
    s.renderOrder = 22;
    g.add(s);
    if (st.core) {
      const c = new THREE.Sprite(glowMat(vfx, st.core));
      c.scale.set(st.size * 0.35, st.size * 0.35, 1);
      c.renderOrder = 23;
      g.add(c);
    }
  }
  buildMesh(vfx, st, g);
  let curtain = null;
  if (st.wave === 'fire') {
    // Fire curtain perpendicular to travel (object +Z = travel direction)
    const w = (opts.width ?? 2) + 0.8;
    const mat = fireMatCached(vfx);
    curtain = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(GEO.plane, mat);
      m.scale.set(w * 2.4, 3.2, 1);
      m.position.set(0, 0.6, -0.8 * i);
      curtain.add(m);
    }
    g.add(curtain);
  }
  const tr = st.trail;
  const trailColor = tr ? tr.color ?? color : 0;
  const trailColor2 = tr ? tr.color2 ?? trailColor : 0;
  let acc = 0, t = 0;
  const last = new THREE.Vector3();
  let hasLast = false;
  const width = (opts.width ?? 1) + 0.8;
  const tmp = new THREE.Vector3();
  let spikeDist = 0;

  const update = (dt) => {
    t += dt;
    if (curtain) {
      curtain.children[0].material.uniforms.uTime.value += dt * 0.5;
      g.position.y = vfx.groundY(g.position.x, g.position.z) + 1.0;
    }
    const p = g.position;
    for (const c of g.children) {
      if (c.userData.spin) { c.rotation.z += dt * 8; c.userData.ownMat && (c.userData.ownMat.uniforms.uTime.value = t); }
      if (c.userData.tumble) { c.rotation.x += dt * 14; }
      if (c.userData.flip) { c.rotation.y += dt * 25; }
    }
    if (tr) {
      acc += dt * tr.rate * vfx.quality;
      const n = Math.floor(acc);
      acc -= n;
      if (n > 0) {
        const o = { position: p, spread: tr.spread ?? 0.08, life: [tr.life * 0.7, tr.life], size: tr.size, color: trailColor, color2: trailColor2, frame: tr.frame ?? (tr.alpha ? FRAME.SMOKE : FRAME.GLOW), up: tr.up ?? 0, rotSpeed: 2, alpha: tr.alpha ? 0.45 : 1 };
        // distribute along the segment travelled this frame for continuous trails
        for (let i = 0; i < n; i++) {
          if (hasLast) tmp.lerpVectors(last, p, (i + 1) / n); else tmp.copy(p);
          o.position = tmp;
          tr.alpha ? vfx.alpha.emit(1, o) : vfx.add.emit(1, o);
        }
      }
    }
    // Linear "wave" projectiles (Flame Wave, Hush Wind) — emit across the width, perpendicular to travel
    if (st.wave && hasLast) {
      const dir = tmp.subVectors(p, last);
      const len = dir.length();
      if (len > 1e-4) {
        dir.divideScalar(len);
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        const gy = vfx.groundY(p.x, p.z);
        const n = Math.ceil(len * (st.wave === 'fire' ? 14 : 8) * vfx.quality);
        for (let i = 0; i < n; i++) {
          const w = (Math.random() * 2 - 1) * width;
          const base = new THREE.Vector3().lerpVectors(last, p, Math.random()).addScaledVector(side, w);
          if (st.wave === 'fire') {
            base.y = gy + 0.4 + Math.random() * 1.2;
            vfx.add.emit(1, { position: base, velocity: dir.clone().multiplyScalar(6), up: [1, 3], life: [0.35, 0.6], size: [1.6, 0.3], color: 0xffe080, color2: 0xff2a00, frame: FRAME.GLOW, drag: 3 });
            if (Math.random() < 0.12) vfx.alpha.emit(1, { position: base.clone().setY(gy + 1.8), up: [1, 2], life: [0.8, 1.2], size: [1.2, 2.5], color: 0x3a2a20, alpha: 0.35, frame: FRAME.SMOKE, rotSpeed: 1 });
          } else {
            base.y = gy + 0.3 + Math.random() * 1.6;
            vfx.alpha.emit(1, { position: base, velocity: dir.clone().multiplyScalar(10), life: [0.3, 0.5], size: [1.2, 2.2], color: 0xe8f4ff, alpha: 0.3, frame: FRAME.SMOKE, drag: 4, rotSpeed: 2 });
            if (Math.random() < 0.3) vfx.add.emit(1, { position: base, velocity: dir.clone().multiplyScalar(18), life: 0.2, size: [0.5, 0.1], color: 0xcfe8ff, frame: FRAME.SPARK });
          }
        }
        if (st.wave === 'fire') {
          // leading bright crest
          vfx.add.emit(2, { position: new THREE.Vector3(p.x, gy + 1, p.z), shape: 'box', spread: { x: Math.abs(side.x) * width, y: 0.4, z: Math.abs(side.z) * width }, life: 0.2, size: [2.2, 0.6], color: 0xffffff, color2: 0xffa030, frame: FRAME.GLOW });
        }
      }
    }
    if (st.spikes && hasLast) {
      spikeDist += last.distanceTo(p);
      while (spikeDist > 1.1) {
        spikeDist -= 1.1;
        const q = new THREE.Vector3(p.x, 0, p.z);
        vfx.shards({ position: q, radius: 0.9, count: 4, height: 2.4, width: 0.55, duration: 1.1, color: 0x8a7458, emissive: 0x2a1a08, emissiveIntensity: 0.2, outward: false });
        vfx.add.emit(3, { position: q.clone().setY(vfx.groundY(q.x, q.z) + 0.3), shape: 'disc', radius: 0.8, up: [2, 4], life: 0.4, size: [0.3, 0.05], color: 0xffaa55, frame: FRAME.SPARK, gravity: 10 });
        vfx.alpha.emit(3, { position: q.clone().setY(vfx.groundY(q.x, q.z) + 0.3), shape: 'disc', radius: 0.8, up: [0.5, 1.5], life: [0.6, 1], size: [1, 2], color: 0x7a6a50, alpha: 0.5, frame: FRAME.SMOKE });
      }
    }
    last.copy(p);
    hasLast = true;
  };

  return {
    object: g,
    update,
    dispose() {
      g.parent?.remove(g);
      g.traverse((o) => { o.userData?.ownMat?.dispose?.(); });
    },
  };
}

export function projectileImpact(vfx, kind, pos, p) {
  const st = styleFor(kind);
  const team = p?.source?.team ?? 'neutral';
  const color = st.team ? st.team[team] ?? 0xffffff : st.glow ?? 0xffffff;
  switch (st.impact) {
    case 'none': return;
    case 'spark_small':
      vfx.emit(5, { position: pos, speed: [1.5, 4], life: [0.12, 0.25], size: [0.3, 0.05], color: 0xffffff, color2: color, frame: FRAME.SPARK, drag: 3 });
      vfx.emit(1, { position: pos, life: 0.15, size: [1, 0.2], color, frame: FRAME.GLOW, fadeIn: 0 });
      return;
    case 'bullet':
      vfx.emit(6, { position: pos, speed: [3, 7], life: [0.1, 0.2], size: [0.3, 0.05], color: 0xffffff, color2: 0xffaa33, frame: FRAME.SPARK, drag: 3 });
      vfx.emitAlpha(3, { position: pos, spread: 0.2, speed: [0.3, 1], life: 0.5, size: [0.4, 1], color: 0x999088, alpha: 0.5, frame: FRAME.SMOKE });
      return;
    case 'fire':
      vfx.emit(12, { position: pos, spread: 0.2, speed: [1, 3.5], up: [0.5, 1.5], life: [0.2, 0.45], size: [0.8, 0.1], color: 0xffdd66, color2: 0xff3300, frame: FRAME.GLOW, drag: 2 });
      return;
    case 'frost_small':
      vfx.emit(8, { position: pos, speed: [1, 3], life: [0.25, 0.5], size: [0.3, 0.05], color: 0xffffff, color2: color, frame: FRAME.FLAKE, rotSpeed: 3, drag: 2 });
      vfx.emit(1, { position: pos, life: 0.2, size: [1.4, 0.3], color, frame: FRAME.GLOW, fadeIn: 0 });
      return;
    case 'zap':
      vfx.emit(10, { position: pos, speed: [3, 7], life: [0.1, 0.25], size: [0.35, 0.03], color: 0xffffff, color2: 0x66aaff, frame: FRAME.SPARK, drag: 3 });
      vfx.emit(1, { position: pos, life: 0.12, size: [2, 0.4], color: 0xaaddff, frame: FRAME.FLARE, fadeIn: 0 });
      return;
    case 'pierce':
      vfx.emit(14, { position: pos, speed: [3, 8], life: [0.15, 0.3], size: [0.4, 0.03], color: 0xffffff, color2: 0x88ccff, frame: FRAME.SPARK, drag: 2 });
      vfx.emit(1, { position: pos, life: 0.2, size: [2.2, 0.4], color: 0xffffff, frame: FRAME.FLARE, fadeIn: 0 });
      return;
    case 'boulder':
      vfx.emitAlpha(10, { position: pos, spread: 0.3, speed: [1, 3], up: [0.5, 2], life: [0.6, 1.1], size: [0.8, 2], color: 0x8a7a66, alpha: 0.6, frame: FRAME.SMOKE, rotSpeed: 1, drag: 2 });
      vfx.emitAlpha(6, { position: pos, speed: [2, 5], up: [2, 4], life: [0.5, 0.8], size: [0.25, 0.2], color: 0x5a5048, frame: FRAME.CHUNK, gravity: 15, rotSpeed: 6, fadeIn: 0 });
      vfx.emit(1, { position: pos, life: 0.2, size: [2, 0.5], color: 0xffaa55, frame: FRAME.GLOW, fadeIn: 0 });
      return;
    case 'tower':
      vfx.emit(16, { position: pos, speed: [2, 6], life: [0.2, 0.4], size: [0.4, 0.05], color: 0xffffff, color2: color, frame: FRAME.SPARK, drag: 3 });
      vfx.emit(1, { position: pos, life: 0.25, size: [3, 0.5], color, frame: FRAME.FLARE, fadeIn: 0 });
      return;
    default:
      vfx.emit(8, { position: pos, speed: [2, 5], life: [0.15, 0.3], size: [0.35, 0.05], color: 0xffffff, color2: color, frame: FRAME.SPARK, drag: 3 });
      vfx.emit(1, { position: pos, life: 0.15, size: [1.3, 0.2], color, frame: FRAME.GLOW, fadeIn: 0 });
  }
}
