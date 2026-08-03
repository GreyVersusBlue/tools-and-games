import * as THREE from 'three';

// Every material carries a thermal twin. Withitness swaps the whole scene
// over in one traversal, so anything added to the world must be registered.
const PALETTE = {
  floor:  [0xC9BFA8, 0x0A1420],
  wall:   [0xD8DCD2, 0x08111C],
  ceil:   [0xE9ECE6, 0x060D16],
  board:  [0xF2F4F0, 0x0D1E30],
  desk:   [0xBFA478, 0x102438],
  metal:  [0x7A8078, 0x0C1826],
  wood:   [0x8A6A44, 0x102438],
  rug:    [0x6E7F8C, 0x0B1826],
  poster: [0xE0C24A, 0x14283C],
  skin:   [0xD9A579, 0xFF9C4A],
  shirtA: [0x4A6E8C, 0xE86A18],
  shirtB: [0x8C5A5A, 0xF07A22],
  shirtC: [0x5A7A5A, 0xE8721C],
  hair:   [0x3A2E26, 0xC65210],
  glass:  [0xCFE4F2, 0x123048]
};

export function createMaterials() {
  const mats = {};
  for (const [key, [normal, thermal]] of Object.entries(PALETTE)) {
    const transparent = key === 'glass';
    const m = new THREE.MeshLambertMaterial({ color: normal, transparent, opacity: transparent ? 0.75 : 1 });
    m.userData.thermal = new THREE.MeshBasicMaterial({ color: thermal, transparent, opacity: transparent ? 0.75 : 1 });
    mats[key] = m;
  }
  return mats;
}

export function createRegistry() {
  const meshes = [];
  return {
    add(mesh) { meshes.push(mesh); return mesh; },
    setThermal(on) {
      for (const m of meshes) {
        if (on) {
          if (!m.userData.orig) m.userData.orig = m.material;
          const t = m.userData.orig.userData?.thermal;
          if (t) m.material = t;
        } else if (m.userData.orig) {
          m.material = m.userData.orig;
        }
      }
    }
  };
}
