import * as THREE from 'three';
import { groundHeight, shorelineZ, waterLineZ } from './field.js';
import { pieceMesh } from './pieces.js';

// Sandcastles. Kneel on damp sand, shape one; it rises under your hands.
// Build it too close to the water and the swash takes it back — a scale-melt,
// slow at the base and then all at once, which is exactly how it goes. There
// is no prompt beyond the verb and no reward beyond having made a thing the
// sea gets to decide about. A tiny meditation on tides.

const MAX_CASTLES = 5;

// The sandcastle piece is makeCastle() whole, its base on the sand as the
// builder's group had it (pieces.js). The group is still what rises and melts.
function makeCastle(pieces) {
  const g = new THREE.Group();
  g.name = 'sandcastle';
  g.add(pieceMesh(pieces, 'sandcastle'));
  return g;
}

export function buildSandcastles(scene, interact, controls, camera, audio, ocean, pieces) {
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
      const g = makeCastle(pieces);
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
        // The swash line at this castle's x, right now. With a tide under the
        // swash this is the whole mechanic rather than a flourish: a castle
        // built on the damp sand at low water is well above the wave that
        // shaped it and gone by high water, which is the first thing anyone
        // who has built one on a beach already knows.
        const reach = waterLineZ(c.x, waterY);
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
