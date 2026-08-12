import * as THREE from 'three';
import { groundHeight, shorelineZ, beachSlope } from './field.js';

// Sandcastles. Kneel on damp sand, shape one; it rises under your hands.
// Build it too close to the water and the swash takes it back — a scale-melt,
// slow at the base and then all at once, which is exactly how it goes. There
// is no prompt beyond the verb and no reward beyond having made a thing the
// sea gets to decide about. A tiny meditation on tides.

const MAX_CASTLES = 5;

function makeCastle(sandColor) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: sandColor, roughness: 0.98 });
  const keep = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.5, 10), mat);
  keep.position.y = 0.25;
  g.add(keep);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 9), mat);
  upper.position.y = 0.62;
  g.add(upper);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 9), mat);
  cap.position.y = 0.85;
  g.add(cap);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 7), mat);
    tower.position.set(Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5);
    g.add(tower);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.12, 7), mat);
    tip.position.set(Math.cos(a) * 0.5, 0.45, Math.sin(a) * 0.5);
    g.add(tip);
  }
  return g;
}

export function buildSandcastles(scene, interact, controls, camera, audio, ocean) {
  const castles = [];   // { group, x, z, rise, melt }
  let next = 0;

  function dampHere() {
    const x = controls.pos.x, z = controls.pos.z;
    const s = z - shorelineZ(x);
    // Damp sand: above the swash's reach, below the dry ripples.
    return s > 2.2 && s < 9 && groundHeight(x, z) < 1.2;
  }

  interact.register({
    // The verb follows the walker; position is refreshed on every query.
    get x() { return controls.pos.x; },
    get z() { return controls.pos.z; },
    get y() { return controls.pos.y - 1; },
    radius: 2,
    available: () =>
      dampHere() && !castles.some(c =>
        Math.hypot(c.x - controls.pos.x, c.z - controls.pos.z) < 4),
    label: () => 'shape a sandcastle · E',
    use: () => {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const x = controls.pos.x + fwd.x * 1.3;
      const z = controls.pos.z + fwd.z * 1.3;
      const g = makeCastle(0xb59a72);
      g.position.set(x, groundHeight(x, z), z);
      g.scale.setScalar(0.01);
      scene.add(g);
      const c = { group: g, x, z, rise: 0, melt: 0 };
      if (castles.length >= MAX_CASTLES) {
        const old = castles[next % MAX_CASTLES];
        scene.remove(old.group);
        castles[next % MAX_CASTLES] = c;
      } else {
        castles.push(c);
      }
      next++;
      if (audio) audio.thud();
    },
  });

  return {
    update(dt) {
      const waterY = ocean.water.position.y;
      for (const c of castles) {
        if (!c.group.parent) continue;
        if (c.rise < 1) {
          c.rise = Math.min(1, c.rise + dt / 2.4);
          const e = 1 - Math.pow(1 - c.rise, 3);
          c.group.scale.setScalar(0.2 + e * 0.8);
        }
        // The swash line at this castle's x, right now.
        const reach = shorelineZ(c.x) + waterY / beachSlope();
        if (c.melt > 0 || (c.z < reach + 0.4 && c.rise >= 1)) {
          c.melt += dt;
          const k = Math.max(0, 1 - c.melt / 6);
          c.group.scale.set(1 + (1 - k) * 0.4, k * k, 1 + (1 - k) * 0.4);
          if (k <= 0) c.group.parent?.remove(c.group);
        }
      }
    },
  };
}
