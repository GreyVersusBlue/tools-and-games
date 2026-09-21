// Signal City: level pack 1. A level is plain data the World reads:
//
//   network     { legs, lanesPerDir, leftLane } the intersection's shape
//   controller  { phases?, lefts?, timing, mode, plan, rules, startPhase }
//   demand      { N: veh/h, ... }               Poisson arrivals per leg
//   demandCurve (fraction of duration) -> multiplier, for surges
//   mix         { archetype: weight }
//   turns       { T, L, R } weights
//   spawns      [{ t, leg, archetype, turn }]   scripted arrivals
//   duration    seconds
//   target      cars to clear for a star
//   waitTarget  average wait, seconds, for the second star
//   mode        'soft' (collisions count) | 'hard' (one collision ends it)
//   unlocks     which signal controls the panel shows:
//               phases    the phase buttons
//               auto      the rule panel (elapsed rules; queue rules wait for M6)
//               allred    the yellow and all-red sliders
//               lefts     nothing extra to show: the level's four phases are
//                         the unlock, the panel names it
//               flash     the flashing red / flashing yellow / signals buttons
//               priority  the emergency corridor button
//
// Milestone 4 shipped level 1 and the free-play board; milestone 5 levels 2
// and 3. Levels 4 to 6 are the rest of the campaign in WISHLIST.md.

export const LEVELS = [
  {
    id: 'first-light',
    name: 'First Light',
    blurb: 'One crossroads, two phases, and a button. Keep them moving.',
    hint: 'Press 1 and 2, or click a phase. Every change runs yellow, then all-red, then the next green: plan for the five seconds it costs.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 1 },
    // a 2 s all-red: the tutorial has no slider, and at 1 s a left finishing
    // on the clearance met a trusting starter in 3 of 24 calibration cells
    controller: { timing: { yellow: 3, allRed: 2, minGreen: 4 } },
    demand: { N: 330, S: 330, E: 220, W: 220 },
    mix: { standard: 8, granny: 2 },
    // few lefts: with one lane, a permissive left waiting for a gap holds its
    // whole queue, and level 1 has no protected phase to give it
    turns: { T: 0.74, L: 0.06, R: 0.2 },
    duration: 180,
    target: 32,
    waitTarget: 15,
    mode: 'soft',
    unlocks: ['phases', 'auto'],
  },
  {
    id: 'stem',
    name: 'Stem',
    blurb: 'A T-junction. The main road is quick, the stem is impatient, and one second of all-red is not enough.',
    hint: 'The stem drivers arrive on the green at speed. Raise the all-red until the main road has cleared the box before they get there, and give the main road most of the cycle.',
    network: { legs: ['N', 'E', 'S'], lanesPerDir: 1 },
    controller: { timing: { yellow: 3, allRed: 1, minGreen: 4 } },
    demand: { N: 380, S: 380, E: 320 },
    mix: { standard: 6, granny: 1.5, aggressive: 2.5 },
    turns: { T: 0.6, L: 0.2, R: 0.2 },
    duration: 180,
    target: 30,
    waitTarget: 15,
    mode: 'soft',
    unlocks: ['phases', 'auto', 'allred'],
  },
  {
    id: 'four-ways',
    name: 'Four Ways',
    blurb: 'Two lanes each way, a quarter of them turning left, and four phases to serve them. Two would not.',
    hint: 'Lefts leave from the inner lane on their own arrow: phases 2 and 4. Keep them short. Flash red stops everyone and they take turns; Signals brings the phases back.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 2, leftLane: true },
    controller: { lefts: true, timing: { yellow: 3, allRed: 1.5, minGreen: 4 } },
    demand: { N: 560, S: 560, E: 440, W: 440 },
    mix: { standard: 5, granny: 1, tourist: 1.5, trucker: 0.8 },
    turns: { T: 0.55, L: 0.25, R: 0.2 },
    duration: 240,
    target: 52,
    waitTarget: 32,
    // four phases make a 90 s cycle; a car that just misses its green waits
    // most of one, so the 120 s single-car gridlock wait of a two-phase
    // board is ordinary queueing here
    gridlockWait: 180,
    mode: 'soft',
    unlocks: ['phases', 'auto', 'allred', 'lefts', 'flash'],
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
    unlocks: ['phases', 'auto', 'allred', 'flash', 'priority'],
  },
];

export function levelById(id) { return LEVELS.find(l => l.id === id) || null; }
