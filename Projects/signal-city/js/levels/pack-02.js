// Signal City: level pack 2 (R13). The same plain data as pack 1 (see its
// header for every field), one level at a time, each with R1's two tables
// and R2's rule from its first commit: Market Ring (#782), Boulevard (#926). pack-01.js splices these in before
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
  {
    id: 'boulevard',
    name: 'Boulevard',
    blurb: 'Two lanes each way between two lights 220 m apart, and traffic both ways at once. One number decides whether a platoon leaving one light meets a green or a red at the other.',
    hint: 'Both boxes run one plan on one clock, and that stops nearly every car twice. Slide the offset and watch the diagram: a line leaves each green\'s start and lands on the other box. On Two Blocks one line could land in green; here the trip between the lights is half the cycle, so one setting lands both. Set it early: every car that has already stopped twice still counts.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 2, nodes: 2, spacing: 220 },
    // 13 s to the boulevard, 9 to the side streets, and 5.5 s of clearance
    // twice: a 33 s cycle, so the 15.7 s between the boxes is half of it and
    // a wave one way is a wave both ways. The all-red is 2.5 s because the
    // box is two lanes wide: in the sweep with one car in ten turning right,
    // six seeds at a 16 s offset read 8 collisions in the boxes at 1.5 s
    // and 1 at 2.5 s; as it ships, none
    controller: { main: 'EW', mode: 'timed', plan: [{ phase: 0, green: 13 }, { phase: 1, green: 9 }], timing: { yellow: 3, allRed: 2.5, minGreen: 4 } },
    controllers: [{ offset: 0 }, { offset: 0 }],
    demand: [{ W: 600, N: 220, S: 220 }, { E: 600, N: 220, S: 220 }],
    mix: { standard: 5, aggressive: 1.5, rideshare: 1.2, trucker: 0.6 },
    // nobody turns. A car handed to the next box in a lane that does not
    // take its turn changes lanes in its first metre there (R12), and the
    // gap check does not see a car alongside that has not been handed on
    // yet: with one in ten turning right that was 9 sideswipes at the join
    // in 36 runs, which no offset prevents (WISHLIST, Known gaps). Straight
    // on, no car changes lanes and 114 runs read none
    turns: { T: 1, L: 0, R: 0 },
    duration: 240,
    // calibrated on six seeds (R13, #926). Nothing pressed: 93 to 135
    // cleared at 7 to 8 s, 77 to 91% of the handed-on cars stopping again,
    // one star on all six. The east box 16 s behind from the start: 110 to
    // 128 at 3 to 7 s, 4 to 11% stopping again, three stars on all six.
    // The bar is 30%: every offset from 12 to 18 s meets it on all six
    // seeds and 8 s on none; 16 s set 30 s into the run still meets it on
    // six, 45 s in on four, a minute in on none. The wait does not tell
    // the two apart by enough to be a star, and the target is under the
    // worst seed with nothing pressed, so the offset is the second star
    target: 88,
    waitTarget: 10,
    lesson: { kind: 'progression', stops: 0.3 },
    mode: 'soft',
    unlocks: ['phases', 'offset'],
  },
];
