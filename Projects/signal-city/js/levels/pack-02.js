// Signal City: level pack 2 (R13). The same plain data as pack 1 (see its
// header for every field), one level at a time, each with R1's two tables
// and R2's rule from its first commit: Market Ring (#782), Boulevard (#926), Cross Town (#929). pack-01.js splices these in before
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
    // box is two lanes wide: with one car in ten turning right, six seeds
    // at a 16 s offset read 8 collisions in the boxes at 1.5 s and 1 at
    // 2.5 s, as it ships
    controller: { main: 'EW', mode: 'timed', plan: [{ phase: 0, green: 13 }, { phase: 1, green: 9 }], timing: { yellow: 3, allRed: 2.5, minGreen: 4 } },
    controllers: [{ offset: 0 }, { offset: 0 }],
    demand: [{ W: 600, N: 220, S: 220 }, { E: 600, N: 220, S: 220 }],
    mix: { standard: 5, aggressive: 1.5, rideshare: 1.2, trucker: 0.6 },
    // one car in ten turns right and none left (#928). A car handed on in
    // the inner lane that draws a right moves to the curb lane on the
    // straight (R12) when the gap is there, the car across the join
    // counted (#927), or keeps its lane and goes through. No lefts: a left
    // across two lanes on a two-phase plan is another level
    turns: { T: 0.9, L: 0, R: 0.1 },
    duration: 240,
    // calibrated on six seeds (R13, #926, again with the turns, #928).
    // Nothing pressed: 100 to 131 cleared at 7 to 10 s, 75 to 91% of the
    // handed-on cars stopping again, one star on all six. The east box 16 s
    // behind from the start: 107 to 134 at 5 to 6 s, 7 to 27% stopping
    // again, the lesson on all six and three stars on five (seed 1 loses
    // one to a crash in the east box, a side-street car through its red).
    // The bar is 30%: every offset from 12 to 20 s meets it on all six
    // seeds, and 0 and 8 s on none. The wait does not tell the two apart
    // by enough to be a star, and the target is under the worst seed with
    // nothing pressed, so the offset is the second star
    target: 88,
    waitTarget: 10,
    lesson: { kind: 'progression', stops: 0.3 },
    mode: 'soft',
    unlocks: ['phases', 'offset'],
  },
  {
    id: 'cross-town',
    name: 'Cross Town',
    blurb: 'Three lights in a row on one street, and an ambulance that has to cross all three. Its corridor follows it from box to box, and at each one the queue is still in the road.',
    hint: 'Call the corridor the moment the ambulance is on the map (E, or click it). The corridor follows it, but a box only goes green for it when it is handed over, a block away, and by then that box\'s queue is standing in its lane. Pick the next box and give its east-west phase before the ambulance gets there, then the one after. It has 100 seconds from the map edge.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 1, nodes: 3, spacing: 220 },
    // phase 0 is the street the ambulance takes, E-W (`main: 'EW'`); every
    // box on Rush Hour's 22 s rule, so the board runs itself until the call
    controller: { main: 'EW', timing: { yellow: 3, allRed: 1.5, minGreen: 4 }, rules: [{ when: 'elapsed', seconds: 22, then: 'next' }] },
    demand: [{ W: 380, N: 240, S: 240 }, { N: 240, S: 240 }, { E: 380, N: 240, S: 240 }],
    mix: { standard: 6, granny: 1, aggressive: 1.5, rideshare: 1 },
    // nobody turns: a car handed to the next box draws its turn from these
    // weights (R12), the ambulance with it, and the level is the ambulance
    // crossing every box. With any turn in the weights it leaves at box 2
    // or 3 on some seeds (Known gaps: an event's turn is the first box's)
    turns: { T: 1 },
    events: [{ kind: 'ambulance', at: 90, leg: 'W', turn: 'T', within: 100 }],
    duration: 240,
    // calibrated on six seeds (R13, #929), `calibrate.mjs cross-town
    // --baseline --hand`. One lane, so the ambulance is never faster than
    // the car in front of it: its 660 m take 54 s at best. Nothing pressed:
    // 99 to 116 cleared, the ambulance 99 to 136 s on the map or still on
    // it at the end, one star on all six. The hand's corridor as it arrives
    // and the boxes ahead left alone: 69 to 113 s, on time on four seeds.
    // The hand in full, the green given at each box ahead of it: 54 to
    // 80 s, on time and three stars on all six. 100 s is 5 s clear of the
    // nearest seed either side of it without the road ahead (95 and 105 s).
    // The target is under the worst run of all (93), so the second star is
    // the ambulance on time on its corridor
    target: 88,
    waitTarget: 20,
    lesson: { kind: 'ambulance' },
    // E-W held at two boxes for a minute is a long red, not a lock
    gridlockWait: 150,
    mode: 'soft',
    unlocks: ['phases', 'auto', 'allred', 'priority'],
  },
];
