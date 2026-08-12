// The journal's pure half: what can be known, and what a stored journal is
// allowed to look like. No three.js, no DOM, no imports — test/smoke.mjs
// exercises this under Node the same way it does field.js.

// Everything observable, with the pencil-outline hint shown for an empty slot.
// The hints are the journal whispering what else is out there — specific
// enough to send you looking, vague enough to leave the finding to you.
export const SPECIES = [
  { id: 'gull', name: 'Herring Gull', kind: 'creature', hint: 'loud, patient, knows about crumbs' },
  { id: 'dolphin', name: 'Bottlenose Dolphin', kind: 'creature', hint: 'watch the water out past the break' },
  { id: 'sanderling', name: 'Sanderling', kind: 'creature', hint: 'small, quick, chases the edge of every wave' },
  { id: 'crab', name: 'Ghost Crab', kind: 'creature', hint: 'the wrack line moves, after sundown' },
  { id: 'pelican', name: 'Brown Pelican', kind: 'creature', hint: 'a line of heavy wings, skimming the water' },
  { id: 'seal', name: 'Harbour Seal', kind: 'creature', hint: 'hauled out somewhere rocky — approach gently' },
  { id: 'starfish', name: 'Ochre Starfish', kind: 'creature', hint: 'look into the still water on the shelf' },
  { id: 'shanny', name: 'Rock Pool Shanny', kind: 'creature', hint: 'quicker than your shadow on the pool' },
  { id: 'firefly', name: 'Fireflies', kind: 'creature', hint: 'the dune hollows, in the half-light' },
  { id: 'owl', name: 'Barn Owl', kind: 'creature', hint: 'something watches from the dead snag at night' },
  { id: 'bat', name: 'Pipistrelle Bats', kind: 'creature', hint: 'jagged little flights over the camp at dusk' },
  { id: 'sailboat', name: 'Sloop, westbound', kind: 'passage', hint: 'something crosses, unhurried' },
  { id: 'jet', name: 'Jet, transatlantic', kind: 'passage', hint: 'a line being drawn very high up' },
  { id: 'moon', name: 'The Moon, rising', kind: 'sky', hint: 'stay past the last of the light' },
  { id: 'meteor', name: 'Shooting Star', kind: 'sky', hint: 'a wish, if you are quick' },
];

// Shell names, grouped by the procedural kind that renders them. shells.js
// imports this grouping (this file has no three.js in it, so it can), which is
// what keeps the beachcombing page and the beach itself from ever disagreeing
// about what a find is called.
export const SHELL_NAMES_BY_KIND = {
  cockle: ['Banded Cockle', 'Dog Cockle', 'Spiny Cockle'],
  whelk: ['Spired Whelk', 'Common Whelk', 'Netted Dog Whelk'],
  sanddollar: ['Sand Dollar', 'Keyhole Sand Dollar'],
  seaglass: ['Sea Glass — bottle green', 'Sea Glass — cornflower', 'Sea Glass — amber'],
};
export const SHELL_NAMES = Object.values(SHELL_NAMES_BY_KIND).flat();

// Places the coast can teach you.
export const PLACES = [
  { id: 'camp', name: 'The Camp' },
  { id: 'dunes', name: 'The Dune Trail' },
  { id: 'headland', name: 'The Headland' },
  { id: 'lighthouse', name: 'The Lighthouse' },
  { id: 'pools', name: 'The Tide Pools' },
];

const speciesIds = new Set(SPECIES.map(s => s.id));
const placeIds = new Set(PLACES.map(p => p.id));

/** True if this could be a stored journal at all. The save slot's validate. */
export function isJournalShape(s) {
  return !!s && Array.isArray(s.species) && Array.isArray(s.shells) && Array.isArray(s.places);
}

/**
 * Take any journal-shaped object and return a clean one: known ids only,
 * strings only, deduped, order preserved. Runs on every load (the slot's
 * repair hook) so a hand-edited or truncated save degrades to a smaller
 * journal instead of a crash. Idempotent.
 */
export function normalizeJournal(s) {
  const dedupe = (arr, allow) => {
    const seen = new Set(), out = [];
    for (const v of arr) {
      if (typeof v !== 'string' || seen.has(v)) continue;
      if (allow && !allow.has(v)) continue;
      seen.add(v); out.push(v);
    }
    return out;
  };
  return {
    species: dedupe(s.species, speciesIds),
    shells: dedupe(s.shells, new Set(SHELL_NAMES)),
    places: dedupe(s.places, placeIds),
  };
}

/** Add an entry if it is new. Returns true when the journal changed. */
export function record(list, id) {
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}
