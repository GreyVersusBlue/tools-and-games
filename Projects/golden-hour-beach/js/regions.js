import { regionAt, LAYOUT, PIER, CAVE } from './field.js';
import { LIGHTHOUSE } from './lighthouse.js';

// Region arrivals: crossing into a named stretch of coast for the first time
// this session raises a quiet name card, and the first time ever writes the
// place into the journal. Cards show once per session per place — a walker
// pacing the dune-trail mouth should not be applauded for it twice a minute.

const CARDS = {
  headland: 'The Headland',
  dunes: 'The Dune Trail',
  lighthouse: 'The Lighthouse',
  pools: 'The Tide Pools',
  estuary: 'The River Mouth',
  pier: 'The Old Pier',
  cave: 'The Sea Cave',
};

export function buildRegions(controls, journal) {
  const card = document.getElementById('region-card');
  const shown = new Set();
  let cardT = 0;

  function arrive(id) {
    if (shown.has(id)) return;
    shown.add(id);
    journal.visitPlace(id);
    card.textContent = CARDS[id];
    card.classList.add('show');
    cardT = 4.2;
  }

  return {
    update(dt) {
      const x = controls.pos.x, z = controls.pos.z;
      const r = regionAt(x, z);
      if (CARDS[r]) arrive(r);

      // Point places: the tower, the pool shelf, the pier deck, the cave.
      if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 24) arrive('lighthouse');
      else if (Math.abs(x - PIER.x) < 6 && z < PIER.deckStart + 4) arrive('pier');
      else if (Math.hypot(x - CAVE.x, z - CAVE.z) < CAVE.r) arrive('cave');
      else {
        for (const p of LAYOUT.headland.pools) {
          if (Math.hypot(x - p.x, z - p.z) < 9) { arrive('pools'); break; }
        }
      }

      if (cardT > 0) {
        cardT -= dt;
        if (cardT <= 0) card.classList.remove('show');
      }
    },
  };
}
