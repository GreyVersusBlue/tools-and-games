// Signal City: level pack 2 (R13). The same plain data as pack 1 (see its
// header for every field), one level at a time, each with R1's two tables
// and R2's rule from its first commit. pack-01.js splices these in before
// Free Play, so the campaign runs on from Main Street.
//
//   ringMeter   { leg, red } on a level built as a ring: the entry meter
//               the panel offers, at the red it starts on (R10, #778)

export const PACK_02 = [
  {
    id: 'market-ring',
    name: 'Market Ring',
    blurb: 'A roundabout on the market road. The east leg floods the ring with lefts, and the north leg starves behind them. One light to set.',
    hint: 'Nothing here has a phase. Put the entry meter on the leg that floods the ring: it holds that leg a few seconds whenever the next leg round has queued past its loop. Try a red, watch the north queue, and try another.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 1, roundabout: true },
    controller: {},
    demand: { N: 520, S: 150, E: 700, W: 180 },
    mix: { standard: 6, granny: 1, aggressive: 1, tourist: 1, rideshare: 1, student: 0.5 },
    // two in five from the east turn left: the long way round, past the north join
    turns: { T: 0.5, L: 0.4, R: 0.1 },
    duration: 240,
    target: 50,
    waitTarget: 16,
    lesson: { kind: 'meter', wait: 16 },
    ringMeter: { leg: 'E', red: 4 },
    mode: 'soft',
    unlocks: [],
  },
];
