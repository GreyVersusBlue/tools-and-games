// Signal City: level pack 1. A level is plain data the World reads:
//
//   network     { legs, lanesPerDir }           the intersection's shape
//   controller  { phases?, timing, mode, plan, rules, startPhase }
//   demand      { N: veh/h, ... }               Poisson arrivals per leg
//   demandCurve (fraction of duration) -> multiplier, for surges
//   mix         { archetype: weight }
//   turns       { T, L, R } weights
//   spawns      [{ t, leg, archetype, turn }]   scripted arrivals
//   duration    seconds
//   target      cars to clear for a star
//   waitTarget  average wait, seconds, for the second star
//   mode        'soft' (collisions count) | 'hard' (one collision ends it)
//   unlocks     which signal controls the panel shows
//
// Milestone 4 ships level 1 and a free-play board. Levels 2 to 6 are the
// campaign in WISHLIST.md, one mechanic each.

export const LEVELS = [
  {
    id: 'first-light',
    name: 'First Light',
    blurb: 'One crossroads, two phases, and a button. Keep them moving.',
    hint: 'Press 1 and 2, or click a phase. Every change runs yellow, then all-red, then the next green: plan for the four seconds it costs.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 1 },
    controller: { timing: { yellow: 3, allRed: 1, minGreen: 4 } },
    demand: { N: 330, S: 330, E: 220, W: 220 },
    mix: { standard: 8, granny: 2 },
    // few lefts: with one lane, a permissive left waiting for a gap holds its
    // whole queue, and level 1 has no protected phase to give it
    turns: { T: 0.74, L: 0.06, R: 0.2 },
    duration: 180,
    target: 32,
    waitTarget: 15,
    mode: 'soft',
    unlocks: ['phases'],
  },
  {
    id: 'free-play',
    name: 'Free Play',
    blurb: 'Every driver in the city, five minutes, an ambulance at the one-minute mark. No stars, just the board.',
    hint: 'Click an emergency vehicle, or press E, to force its corridor green. Watch the truck: it needs the whole box.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 1 },
    controller: { timing: { yellow: 3, allRed: 1, minGreen: 4 }, rules: [{ when: 'elapsed', seconds: 24, then: 'next' }] },
    demand: { N: 360, S: 360, E: 300, W: 300 },
    mix: { standard: 5, granny: 1, aggressive: 1.5, tourist: 1, trucker: 0.6, student: 0.8, rideshare: 1.2 },
    spawns: [{ t: 60, leg: 'W', archetype: 'emergency', turn: 'T' }, { t: 200, leg: 'S', archetype: 'emergency', turn: 'L' }],
    duration: 300,
    target: 60,
    waitTarget: 30,
    mode: 'soft',
    sandbox: true,
    unlocks: ['phases', 'priority', 'auto'],
  },
];

export function levelById(id) { return LEVELS.find(l => l.id === id) || null; }
