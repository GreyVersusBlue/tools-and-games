// Signal City: level pack 1. A level is plain data the World reads:
//
//   network     { legs, lanesPerDir, leftLane, nodes, spacing } the shape:
//               `nodes: 2` is a corridor, two boxes `spacing` m apart on an
//               east-west main street (M6)
//   controller  { phases?, lefts?, peds?, main?, timing, mode, plan, rules, startPhase }
//   controllers [{ offset, startPhase }, ...]    per-node overrides of it
//   demand      { N: veh/h, ... }               Poisson arrivals per leg, or
//               one such object per node in an array
//   pedDemand   { N: calls/h, ... }             pedestrian calls per leg
//   pedWait     seconds a call may wait before it costs satisfaction
//   sensors     true: the induction loops are live and `queue` rules fire
//   loops       the movements that have a loop (default: every lane)
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
//               peds      the pedestrian call buttons and the walk lamps
//               sensors   a note: the loops are live and the queue rules run
//               offset    the offset slider and the platoon diagram: the
//                         second box runs its plan `offset` seconds behind
//                         the first, and moving it re-aligns the running
//                         plan through its own yellows (M7)
//
// Milestone 4 shipped level 1 and the free-play board; milestone 5 levels 2
// and 3; milestone 6 levels 4 and 5. Level 6 is M8's, with the campaign.

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
    id: 'crossing',
    name: 'Crossing',
    blurb: 'Four Ways again, with people. A call on any leg wants a walk, and a walk holds the green until the last walker is across.',
    hint: 'Calls light up on the panel and on the map. The walk runs with the through phase parallel to it; give the E-W phase when N or S calls, and the loops in the left bays will ask for the arrows for you.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 2, leftLane: true },
    // a full bay pulls its arrow in once the through has had 16 s; the
    // elapsed rule keeps the board cycling on its own. `after` matters: at
    // the 4 s minimum green the bays cut every through short and the board
    // locked on 3 of 6 seeds
    controller: {
      lefts: true, peds: true, timing: { yellow: 3, allRed: 1.5, minGreen: 4 },
      rules: [
        { when: 'queue', movement: 'N-L', threshold: 3, after: 16, then: 1 },
        { when: 'queue', movement: 'E-L', threshold: 3, after: 16, then: 3 },
        { when: 'elapsed', seconds: 24, then: 'next' },
      ],
    },
    demand: { N: 520, S: 520, E: 400, W: 400 },
    pedDemand: { N: 60, S: 60, E: 60, W: 60 },
    pedWait: 45,
    sensors: true,
    loops: ['N-L', 'S-L', 'E-L', 'W-L'],
    mix: { standard: 5, granny: 1, tourist: 1.5, student: 1.5 },
    turns: { T: 0.55, L: 0.25, R: 0.2 },
    duration: 240,
    target: 48,
    waitTarget: 36,
    gridlockWait: 180,
    mode: 'soft',
    unlocks: ['phases', 'auto', 'allred', 'lefts', 'flash', 'peds', 'sensors'],
  },
  {
    id: 'two-blocks',
    name: 'Two Blocks',
    blurb: 'Two crossroads on one street, 220 m apart, on a timed plan. The east box runs 16 s behind the west one, so a platoon released at one meets a green at the other.',
    hint: 'Both boxes run the same plan, the east one behind the west by the offset. The diagram draws where each box\'s green will be and where a platoon leaving one lands at the other: slide the offset until the line meets the green, both ways if you can. Press a phase to override the selected box.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 1, nodes: 2, spacing: 220 },
    // phase 0 is the main street, E-W here (`main: 'EW'`): 22 s to it, 12 to the side streets
    controller: { main: 'EW', mode: 'timed', plan: [{ phase: 0, green: 22 }, { phase: 1, green: 12 }], timing: { yellow: 3, allRed: 1.5, minGreen: 4 } },
    controllers: [{ offset: 0 }, { offset: 16 }],
    demand: [{ W: 520, N: 220, S: 220 }, { E: 520, N: 220, S: 220 }],
    mix: { standard: 5, aggressive: 1.5, rideshare: 1.2, trucker: 0.6 },
    turns: { T: 0.7, L: 0.1, R: 0.2 },
    duration: 240,
    // the offset is the second star: at 22 s the shipped 16 s offset waits
    // 8 to 14 s over six seeds, offset 0 waits 12 to 19
    target: 80,
    waitTarget: 16,
    mode: 'soft',
    unlocks: ['phases', 'allred', 'offset'],
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
