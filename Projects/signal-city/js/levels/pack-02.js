// Signal City: level pack 2 (R13). The same plain data as pack 1 (see its
// header for every field), one level at a time, each with R1's two tables
// and R2's rule from its first commit: Market Ring (#782), Boulevard (#926), Cross Town (#929), Lights Out (#933). pack-01.js splices these in before
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
  {
    id: 'lights-out',
    name: 'Lights Out',
    blurb: 'Boulevard\'s two lights with the wave already running, and a power cut on the way. When the lights come back the wave does not.',
    hint: 'The wave is set: watch it work. At 78 seconds the power goes for twelve, both boxes go dark and every car takes its turn. When it comes back each box starts again from the top of the green it was in, so the two clocks agree with each other and no longer with the slider: the diagram shows it, the lines landing on red. The slider moves the east box on from where it stands, so slide it until the lines land in green again and let it re-align. Sooner is better: every car that stops twice still counts.',
    network: { legs: ['N', 'E', 'S', 'W'], lanesPerDir: 2, nodes: 2, spacing: 220 },
    // Boulevard's plan and its 33 s cycle, and Boulevard's answer already in:
    // the east box 16 s on, so the level opens on a wave both ways
    controller: { main: 'EW', mode: 'timed', plan: [{ phase: 0, green: 13 }, { phase: 1, green: 9 }], timing: { yellow: 3, allRed: 2.5, minGreen: 4 } },
    controllers: [{ offset: 0 }, { offset: 16 }],
    demand: [{ W: 600, N: 220, S: 220 }, { E: 600, N: 220, S: 220 }],
    mix: { standard: 5, aggressive: 1.5, rideshare: 1.2, trucker: 0.6 },
    turns: { T: 0.9, L: 0, R: 0.1 },
    // the outage is the level, and its second is chosen: 78 s is 12 s into
    // the west box's third cycle and 28 s into the east box's, so the west
    // box is on its boulevard green and the east box on the yellow that ends
    // its side street's. A box comes back to the phase it was in or was
    // going to (sim.js _endEvent), from the top of that green: both come
    // back on the boulevard at the same instant, the offset the slider still
    // calls 16 s is 0 on the street, and the wave is gone both ways until
    // the slider moves the east box another half cycle. A second either way
    // (77 or 79 s) and the boxes come back half a cycle apart with nothing
    // to do. Twelve seconds, because a box comes back through one all-red
    // and a car still crossing on its turn is hit by the first green: 20 s
    // of dark read 8 such crashes in 24 seeds, 12 s read 5 in 48
    events: [{ kind: 'outage', at: 78, for: 12 }],
    duration: 300,
    // calibrated on six seeds (R13, #933), `calibrate.mjs lights-out
    // --baseline --hand`. Nothing pressed: 120 to 168 cleared at 7 to 8 s,
    // 60 to 70% of the handed-on cars stopping again (3 of 64 before the
    // power goes), one star on all six, no lock. The slider moved to 32
    // (the east box 16 s on) 10 s after the lights come back: 12 to 28%,
    // the lesson on all six, three stars on two. The tool's sweep by fours
    // at that second keeps 4 (21 s on): the lesson on six and three stars
    // on five; the star lost either way is a crash, and this street
    // crashes with nobody's help. To 32 at 5, 20 and 30 s after the lights:
    // 14 to 35%, the lesson on all six each time. To 24, a quarter of a
    // cycle off: 32 to 58%, the lesson on one seed. The bar is 40%: 20
    // points under the best seed with nothing pressed and 5 over the worst
    // with the slider moved 30 s late. The target is under the worst run of
    // all (120), so the slider is the second star
    target: 110,
    waitTarget: 10,
    lesson: { kind: 'progression', stops: 0.4 },
    mode: 'soft',
    unlocks: ['phases', 'offset'],
  },
];
