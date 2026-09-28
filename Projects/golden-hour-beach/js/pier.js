import * as THREE from 'three';
import { PIER, pierDeckY, mulberry32 } from './field.js';
import { REF, variant, instances, byVariant } from './pieces.js';

// The old pier: the groyne's grown-up sibling. Paired piles every few metres,
// weathered planking out to the collapsed span, then bare broken stumps
// walking on without you. field.js owns the geometry facts (the deck IS the
// ground there); this file only dresses them in wood.

// Every pile, stump, plank and stringer is a piece from the prop pack
// (pieces.js, B6), stood where the builder stood its primitive. The deck the
// walker is on is still field.js's, so the planks sit on pierDeckY and the
// mesh decides nothing. The rnd() calls are the builder's, in its order, so
// every pile and every missing plank is where it was.

export function buildPier(scene, pieces) {
  const rnd = mulberry32(0x91e5);
  const group = new THREE.Group();
  group.name = 'pier';

  // Piles, in pairs, all the way out to stumpEnd. Past the collapsed span
  // they get shorter and more broken.
  // Pile bases sit in the SAND under the deck — groundHeight can't provide
  // that inside the deck rectangle (there, the deck IS the ground; that's what
  // makes it walkable), so the local beach/seabed slope is applied directly.
  const sandY = z => (z < -6 ? (z + 6) * 0.10 : (z + 6) * 0.055);
  const piles = [], stumps = [];
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
      const seed = (px * 977 + pz * 131) | 0;
      (broken ? stumps : piles).push({
        v: variant(seed, 2),
        x: px, y: seabed + len / 2, z: pz, rz: (rnd() - 0.5) * 0.06,
        sy: len / (broken ? REF.stump.len : REF.pile.len),
      });
    }
  }

  // Planking: slightly gapped, slightly askew boards across the walkable run.
  // A plank has no seed of its own, so its variant is its place along the pier.
  const planks = [];
  let n = 0;
  for (let z = PIER.deckStart - 0.3; z >= PIER.deckEnd + 0.2; z -= 0.62) {
    const plank = {
      v: variant(n++, 3),
      x: PIER.x + (rnd() - 0.5) * 0.1, y: pierDeckY(z) - 0.05, z,
      ry: (rnd() - 0.5) * 0.04, sx: (PIER.halfW * 2 + 0.3) / REF.plank.w,
    };
    // The odd missing plank near the broken end sells the ruin.
    if (z < PIER.deckEnd + 6 && rnd() < 0.18) continue;
    planks.push(plank);
  }

  // Two stringers under the planks.
  const len = PIER.deckStart - PIER.deckEnd + 0.6;
  const beams = [-1, 1].map(sx => ({
    x: PIER.x + sx * (PIER.halfW - 0.3), y: pierDeckY((PIER.deckStart + PIER.deckEnd) / 2) - 0.18,
    z: (PIER.deckStart + PIER.deckEnd) / 2,
    rx: Math.atan2(PIER.y1 - PIER.y0, len), sz: len / REF.stringer.len, sx: 1, sy: 1,
  }));

  for (const o of [
    ...byVariant(pieces, ['pier-pile-1', 'pier-pile-2'], piles),
    ...byVariant(pieces, ['pier-stump-1', 'pier-stump-2'], stumps),
    ...byVariant(pieces, ['pier-plank-1', 'pier-plank-2', 'pier-plank-3'], planks),
    instances(pieces, 'pier-stringer', beams),
  ]) group.add(o);

  scene.add(group);
  return group;
}
