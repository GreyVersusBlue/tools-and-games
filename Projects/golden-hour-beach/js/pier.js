import * as THREE from 'three';
import { PIER, pierDeckY, mulberry32 } from './field.js';

// The old pier: the groyne's grown-up sibling. Paired piles every few metres,
// weathered planking out to the collapsed span, then bare broken stumps
// walking on without you. field.js owns the geometry facts (the deck IS the
// ground there); this file only dresses them in wood.

function roughen(geo, amount, seed) {
  const s = (seed >>> 0) % 1000 * 0.017;
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 1.7 + s) * Math.sin(v.y * 2.3 - s * 1.6) * Math.sin(v.z * 1.9 + s * 2.4);
    v.multiplyScalar(1 + n * amount);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function buildPier(scene) {
  const rnd = mulberry32(0x91e5);
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x584a3c, roughness: 0.95 });
  const oldWood = new THREE.MeshStandardMaterial({ color: 0x453a30, roughness: 1.0 });

  // Piles, in pairs, all the way out to stumpEnd. Past the collapsed span
  // they get shorter and more broken.
  // Pile bases sit in the SAND under the deck — groundHeight can't provide
  // that inside the deck rectangle (there, the deck IS the ground; that's what
  // makes it walkable), so the local beach/seabed slope is applied directly.
  const sandY = z => (z < -6 ? (z + 6) * 0.10 : (z + 6) * 0.055);
  for (let z = PIER.deckStart; z >= PIER.stumpEnd; z -= 4.4) {
    for (const sx of [-1, 1]) {
      const px = PIER.x + sx * (PIER.halfW - 0.25) + (rnd() - 0.5) * 0.2;
      const pz = z + (rnd() - 0.5) * 0.3;
      const seabed = sandY(pz) - 1;
      const broken = pz < PIER.deckEnd;
      const top = broken
        ? pierDeckY(pz) - 0.4 - rnd() * 1.2
        : pierDeckY(pz) + 0.15;
      const len = top - seabed;
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, len, 7), broken ? oldWood : wood);
      roughen(pile.geometry, 0.08, (px * 977 + pz * 131) | 0);
      pile.position.set(px, seabed + len / 2, pz);
      pile.rotation.z = (rnd() - 0.5) * 0.06;
      group.add(pile);
    }
  }

  // Planking: slightly gapped, slightly askew boards across the walkable run.
  for (let z = PIER.deckStart - 0.3; z >= PIER.deckEnd + 0.2; z -= 0.62) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(PIER.halfW * 2 + 0.3, 0.09, 0.5), wood);
    plank.position.set(PIER.x + (rnd() - 0.5) * 0.1, pierDeckY(z) - 0.05, z);
    plank.rotation.y = (rnd() - 0.5) * 0.04;
    group.add(plank);
    // The odd missing plank near the broken end sells the ruin.
    if (z < PIER.deckEnd + 6 && rnd() < 0.18) group.remove(plank);
  }

  // Two stringers under the planks.
  for (const sx of [-1, 1]) {
    const len = PIER.deckStart - PIER.deckEnd + 0.6;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, len), oldWood);
    beam.position.set(PIER.x + sx * (PIER.halfW - 0.3), pierDeckY((PIER.deckStart + PIER.deckEnd) / 2) - 0.18,
      (PIER.deckStart + PIER.deckEnd) / 2);
    beam.rotation.x = Math.atan2(PIER.y1 - PIER.y0, len);
    group.add(beam);
  }

  scene.add(group);
  return group;
}
