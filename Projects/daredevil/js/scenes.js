// scenes.js — Daredevil's story, as data.
//
// Split out of daredevil_r4.html's inline module script in the round-2
// restructure. 4,260 of the monolith's 6,888 lines (62%, 208.3 KB) were this
// object; a full run reads 43% of it. See HISTORY.md, round 2, for the
// account of the split, and Projects/torchbearer/content-authoring-guide.md
// for the same-repo precedent on documenting a content format with an authoring
// contract — that guide is the model for js/README.md in this folder.
//
// Every scene: { art, artLabel, bgText?, lines[], choices?, statUpdate?, next?,
// _requires?, _gateCheck?, _gateRoute?, _dynamic? }. A line is built by N()
// (narration), D() (Duke), or C(speaker, text) (anyone else). Pass N() or C()
// a function instead of a string — N(()=> cond ? 'a' : 'b') — for a line
// whose truth depends on GS.rels or GS.flags; buildLines() in engine.js calls
// it at render time. NF(fn) does the same thing through a second, otherwise-
// unused code path (`_fn` instead of `text`) that predates this round.
// A plain template literal, by contrast, is evaluated exactly once, at
// import time, with whatever GS held then — that is what let m5_retire_clean
// claim Ruthie was told something on runs where she was never established
// (fixed this round; see the notes file). `goto` and `next` each name either
// a real key in this object or one of goToScene()'s leading-underscore
// procedural routes in engine.js.
//
// This module and engine.js both depend on state.js and nothing else, by
// design — see state.js's own header for why the natural-looking
// alternative (SCENES importing GS from engine.js) does not work.

import { GS, N, D, C, NF, statesOf, presentStates, isPresent } from './state.js';
// The hub economy (Phase 6). The story needs three of these: the twelve
// hundred `fr2_debt_01` is about, the deposit thirteen buses want, and the
// integer both are measured against.
import { CAR_MONEY, SOLO_LOAN, SELF_FUND_NET, BUS_DEPOSIT, monthlyOn, money, canAffordBuses } from './money.js';

// Relationship requirements are data (Phase 3). A choice or a hub card that
// exists only for some state of a character says so as `_needs: { id: [state,
// ...] }` — a list of the states that satisfy it, built from the cast table so
// a typo throws at import rather than gating on nothing. goToScene() drops a
// choice whose `_needs` the run does not meet, the way it always dropped one
// whose `_requires()` was false. `_requires` is still here for anything
// genuinely computed; nothing in this file uses it to test a relationship, and
// smoke-save.mjs fails if something starts to.
const EARL_PRESENT = statesOf('earl', { not: ['absent'] });
const PETE_PRESENT = presentStates('pete');

// Phase 1, the backer-less branch. "Not interested" at the fair leaves
// rels.earl 'absent' from Milestone 2 to the ending screen (decision #265), so
// from m2_solo_entry on, every line that names Earl, his sponsor, his calendar
// or his phone reads this first and says who is actually there instead. On the
// solo branch that is Dot Kessler, the Speedway's promoter, Roy Petersen, the
// regional crew's cameraman who came for the feature race, and Cal.
const solo = ()=> GS.rels.earl === 'absent';

// Where Tommy stands at the close of Free Roam 2, in one clause. He was
// "either in his corner or not, depending on the week" on every run, in three
// versions of the same paragraph, which stopped being true the moment Free
// Roam 2's bar night could hand him the car show's warm-up slot (Phase 4).
// He cannot be 'absent' yet — that is Free Roam 3's evening.
const tommyAtFR2Close = ()=> GS.rels.tommy === 'ally'
  ? `Tommy had a date in October and a plank ramp to rebuild before it.`
  : GS.flags.debtSource === 'tommy'
  ? `Tommy was owed nothing now, and both of them knew what the twelve hundred had cost anyway.`
  : `Tommy was either in his corner or not, depending on the week.`;

/**
 * The three Milestone 4 stunts and what each one wants (Phase 6).
 *
 * `m4_stunt_select`'s choices carried these tests inline, and Free Roam 3's
 * "Available stunts:" hint carried a second copy — `canBuses` and `canInferno`
 * in `renderHubFR3`, re-derived from the same stats. One table now, read by
 * both ends, so a fourth stunt or a changed threshold is one row.
 *
 * The Bus Stack's third requirement is the one this phase added, and it was
 * already written: on the backer branch Earl has the stadium booked, and on
 * the solo branch the same paragraph says "a school district that would rent
 * him the buses against a deposit he did not have yet". Nothing read it.
 */
export const M4_STUNT_GATES = [
  {
    choice: 'buses',
    label: 'Bus Stack',
    check: ()=> GS.stats.showmanship >= 4 && GS.stats.precision >= 3 && canAffordBuses(GS),
    reason: ()=> {
      const want = [];
      if(GS.stats.showmanship < 4) want.push('Showmanship ≥ 4');
      if(GS.stats.precision < 3) want.push('Precision ≥ 3');
      if(!canAffordBuses(GS)) want.push(`a $${BUS_DEPOSIT} deposit (short $${BUS_DEPOSIT - money(GS)})`);
      return `Requires ${want.join(' · ')}`;
    },
  },
  { choice: 'inferno',  label: 'Inferno',  check: ()=> GS.stats.nerve >= 4, reason: 'Requires Nerve ≥ 4' },
  { choice: 'symbolic', label: 'Symbolic', check: ()=> true },
];

/** The row for one stunt, by its `m4Choice` value. */
export const m4Gate = choice => M4_STUNT_GATES.find(g => g.choice === choice);

// Who Duke talks to before a stunt, and who asks him the question at the end,
// as tables (Phase 3): the engine takes the first row whose character is in
// one of the listed states, and the fallback is the scene for nobody. These
// replaced two `if` ladders in goToScene() and one in `_m3_prestunt`, and the
// rows are in the order those ladders asked in. The pre-stunt tables follow
// the cast's order; Milestone 5's does not — the game has always let Ruthie
// ask before Cal, and this row was not the one to change who asks. The one
// thing the table cannot say is Milestone 5's exception, which the engine
// keeps: if Cal already asked the question in Free Roam 4
// (`calAskedTheQuestion`), he comes first. The old ladder also tested Ruthie
// for `'warm'`, a state she has never had; the table does not.
export const M3_PRESTUNT_ROUTES = [
  { who: 'cal',    states: ['loyal'], scene: 'm3_prestunt_cal' },
  { who: 'ruthie', states: ['solid'], scene: 'm3_prestunt_ruthie' },
];
export const M3_PRESTUNT_FALLBACK = 'm3_prestunt_alone';
export const M4_PRESTUNT_ROUTES = [
  { who: 'cal',    states: ['loyal'],         scene: 'm4_prestunt_cal_m4' },
  { who: 'ruthie', states: ['solid'],         scene: 'm4_prestunt_ruthie_m4' },
  { who: 'pete',   states: presentStates('pete'), scene: 'm4_prestunt_pete_m4' },
  { who: 'earl',   states: presentStates('earl'), scene: 'm4_prestunt_earl_m4' },
];
export const M4_PRESTUNT_FALLBACK = 'm4_prestunt_nobody_m4';
export const M5_QUESTION_ROUTES = [
  { who: 'ruthie', states: ['solid'],         scene: 'm5_question_ruthie' },
  { who: 'cal',    states: ['loyal', 'warm'], scene: 'm5_question_cal' },
  { who: 'earl',   states: ['mentor'],        scene: 'm5_question_earl' },
];
export const M5_QUESTION_FALLBACK = 'm5_question_nobody';

// Milestone 5's last stunt has two ways in — Duke picked it
// (m5_last_stunt_setup) or Earl did (m5_last_stunt_earl) — and one pair of
// outcome scenes between them. Both scenes named `last_stunt_win` /
// `last_stunt_loss` flatly, so `m5Outcome === 'last_stunt_earl'` — a headline,
// a nerve verdict and a three-line retrospective, all written — could never be
// true on any run. The decision rides through now (Phase 2), and
// `m5StuntCleared` keeps the one thing the flatten would otherwise lose:
// whether he made it. The outcome scene knows that — m5_stunt_win passes true —
// and the ending screen's retrospective reads it.
const m5StuntFlags = cleared => ({
  m5Complete: true,
  m5StuntCleared: cleared,
  m5Outcome: GS.flags.m5Decision === 'last_stunt_earl'
    ? 'last_stunt_earl'
    : (cleared ? 'last_stunt_win' : 'last_stunt_loss'),
});

export const SCENES = {

/* ============================================================
   COLD OPEN
   ============================================================ */
cold_open_01: {
  art:'cold_open', artLabel:'Cold Open · Panel 1',
  bgText:'DAREDEVIL',
  lines:[
    N(`There's a place in ${GS.town} where the county road dips before the bridge. On a bike, if you hit it right, you leave the ground.`),
    N(`Everyone in town knew about that dip. Most people lifted off the seat, held on, came down.`),
    N(`He didn't do it that way.`),
  ],
  next:'cold_open_02'
},
cold_open_02: {
  art:'cold_open', artLabel:'Cold Open · Panel 2',
  bgText: `${GS.town}`,
  lines:[
    N(`${GS.town} had a grain elevator, two churches, and one stoplight that nobody paid much attention to. It had a fairground that smelled like cut grass and motor oil every summer.`),
    N(`It had people who were going places and people who knew they weren't. The difference was something you could feel in a handshake.`),
    N(`He didn't know yet which kind he was. He had some guesses.`),
  ],
  next:'cold_open_03'
},
cold_open_03: {
  art:'cold_open', artLabel:'Cold Open · Panel 3',
  bgText:'TWO WHEELS',
  lines:[
    N(`He'd been on two wheels since before he should have been. His first bike was held together with baling wire and stubbornness. He crashed it into the same fence three times in one afternoon.`),
    N(`The fence lost.`),
    N(`He didn't think about why he kept getting back up. It didn't occur to him that some people wouldn't.`),
  ],
  next:'cold_open_origin_choice'
},
cold_open_origin_choice: {
  art:'cold_open', artLabel:'Cold Open · Origin',
  bgText:'THE MOMENT',
  lines:[
    N(`Every daredevil has a moment. The one that made it real.`),
    N(`His was—`),
  ],
  choices:[
    { label:'A', text:'The irrigation ditch. Twelve feet across. Nobody thought he\'d clear it.',
      subtext:"He didn\'t think about clearing it. He thought about the other side.",
      effects:{ flags:{ originTrait:'fearless' }, stats:{ nerve:1 } }, goto:'cold_open_04' },
    { label:'B', text:'The water tower. Tommy dared him. Everyone was watching.',
      subtext:'He got to the third rung and stopped. He never forgot it.',
      effects:{ flags:{ originTrait:'haunted' } }, goto:'cold_open_04' },
    { label:'C', text:'The Founders\' Day parade. He crashed his trick. The crowd laughed.',
      subtext:"He stood up, took a bow. They weren\'t laughing anymore.",
      effects:{ flags:{ originTrait:'performer' }, stats:{ showmanship:1 } }, goto:'cold_open_04' },
    { label:'D', text:'The ravine jump. He made it, mostly. Two years of a shoulder that didn\'t sit right.',
      subtext:"He was back on the bike in a week. Because the alternative didn\'t make sense.",
      effects:{ flags:{ originTrait:'ironborn' }, stats:{ condition:1 } }, goto:'cold_open_04' },
  ]
},
cold_open_04: {
  art:'cold_open', artLabel:'Cold Open · Family',
  bgText:'FAMILY',
  lines:[
    N(`Everyone came from somewhere. He came from—`),
  ],
  choices:[
    { label:'A', text:'A father who pushed.',
      subtext:`A man who wanted things and couldn't say what they were. He pushed Duke sideways — through silence, through a look that meant you could be more than this.`,
      effects:{ flags:{ familyOrigin:'father' } }, goto:'cold_open_05' },
    { label:'B', text:'A mother who worried.',
      subtext:`She called at bad moments. She asked if he was eating. She asked the way you ask about things you can't fix.`,
      effects:{ flags:{ familyOrigin:'mother' } }, goto:'cold_open_05' },
    { label:'C', text:'Raised himself, mostly.',
      subtext:`No safety net. What he built was his. What he lost was also his. There was a cleanness to that.`,
      effects:{ flags:{ familyOrigin:'self' }, stats:{ hustle:1 } }, goto:'cold_open_05' },
  ]
},
cold_open_05: {
  art:'cold_open', artLabel:'Cold Open · Panel 5',
  bgText:'THE BIKE',
  lines:[
    N(`His first real bike cost him two summers of fence work and one summer of lying about his age to drive a delivery truck.`),
    N(`He kept it running with borrowed tools and stubbornness. He took it apart and put it back together more times than was strictly necessary. He needed to know how it worked from the inside.`),
    N(`It wasn't just a bike. He knew that. He didn't say that to anyone.`),
  ],
  next:'cold_open_06'
},
cold_open_06: {
  art:'cold_open', artLabel:'Cold Open · Panel 6',
  bgText:'PRACTICE',
  lines:[
    N(`He practiced at the fairground in the off-season when no one was watching. Sometimes Tommy came. Mostly he was alone.`),
    N(`Alone was when he got better. Alone, there was nobody to perform for, so he had to be honest about what he could and couldn't do.`),
    N(`Some of what he couldn't do, he learned. Some of it he accepted. A few things he attempted anyway.`),
  ],
  next:'cold_open_07'
},
cold_open_07: {
  art:'cold_open', artLabel:'Cold Open · Panel 7',
  bgText:'THE FEELING',
  lines:[
    N(`What did he want? He'd been asked that. He didn't always have a clean answer.`),
    N(`He wanted the feeling. That was the best he could do. The moment at the top of the arc — engine quiet for half a second, nothing under you, everything still — and the absolute certainty that you either had it or you didn't, and the answer was about to be settled.`),
    N(`You can't explain that to most people. He'd stopped trying.`),
  ],
  next:'cold_open_08'
},
cold_open_08: {
  art:'cold_open', artLabel:'Cold Open · Panel 8',
  bgText:'COUNTY FAIR',
  lines:[
    N(`The ${GS.town} Fair. August. Hot the way August is hot in the middle of the country, like the air forgot to move.`),
    N(`He'd been at the fairground since six. The ramp had been measured four times. The cows were in a pen by the east fence, doing what cows do, which is stand there and make the whole thing seem simultaneously more and less reasonable.`),
    N(`Three cows. He was going to jump three cows on a dirt bike in front of a few hundred people and one man he'd heard was coming to look.`),
    N(`He was ready. He'd been ready for a long time.`),
    N(`He checked the bike once more anyway.`),
  ],
  // Chapter transition to Milestone 1
  next:'_chapter_m1'
},

/* ============================================================
   MILESTONE 1 — THE COUNTY FAIR
   ============================================================ */
m1_rival_rumor: {
  art:'milestone1', artLabel:'Milestone 1 · Beat 1',
  bgText:'THE FAIR',
  lines:[
    N(`Tommy found him before nine.`),
    C('TOMMY', `You hear about Diamondback Danny?`),
    D(`Who?`),
    C('TOMMY', `Danny Reeves. From over in Larkin. Does the trick riding thing. I heard he's performing today.`),
    C('TOMMY', `Heard he's pretty good.`),
    N(`Tommy said the last part a half-beat too carefully.`),
  ],
  choices:[
    { label:'A', text:`"What time is he on?"`,
      subtext:'Get on right before him. Make the contrast work in your favor.',
      effects:{ stats:{ showmanship:1 }, flags:{ dannySchemed:true } }, goto:'m1_b1_scheme' },
    { label:'B', text:`"I'll go introduce myself."`,
      subtext:"Friendly competition. See what you\'re dealing with.",
      effects:{ flags:{ dannyMet:true } }, goto:'m1_b1_introduce' },
    { label:'C', text:`"Doesn't matter. I've got my own show."`,
      subtext:'Stay focused. Nothing else needs your attention right now.',
      effects:{}, goto:'m1_b1_ignore' },
  ]
},
m1_b1_scheme: {
  art:'milestone1', artLabel:'Beat 1 · Scheme',
  bgText:'THE FAIR',
  lines:[
    D(`What time is he on?`),
    C('TOMMY', `Two o'clock, I think. Why?`),
    D(`Because I want to go on at one-thirty.`),
    N(`Tommy grinned. He always grinned when Duke decided something. It was one of the better things about Tommy.`),
    C('TOMMY', `I'll go find the schedule man.`),
  ],
  next:'m1_beat_2'
},
m1_b1_introduce: {
  art:'milestone1', artLabel:'Beat 1 · Introduction',
  bgText:'THE FAIR',
  lines:[
    D(`Point me at him.`),
    N(`Danny Reeves was twenty-two or twenty-three, good-looking in the way that made you want to dislike him before you had a reason. He was checking his own ramp when Duke walked up.`),
    D(`Duke Harlan. I hear we're both performing today.`),
    C('DANNY', `Diamondback Danny.`),
    N(`He said it like he was introducing himself at a press conference. Duke liked him slightly despite himself.`),
    C('DANNY', `What are you doing?`),
    D(`Three cows. You?`),
    C('DANNY', `Five barrels, fire trick, trick finish.`),
    D(`Hm.`),
    C('DANNY', `Hm what?`),
    D(`Nothing. Good luck.`),
  ],
  next:'m1_beat_2'
},
m1_b1_ignore: {
  art:'milestone1', artLabel:'Beat 1 · Focus',
  bgText:'THE FAIR',
  lines:[
    D(`Doesn't matter.`),
    C('TOMMY', `He's good, Duke. People are saying—`),
    D(`Tommy.`),
    N(`Tommy stopped talking. He usually did, eventually.`),
    N(`Duke went back to the ramp. He had his own work.`),
  ],
  next:'m1_beat_2'
},

/* ---- BEAT 2 — CAL'S OFFER ---- */
m1_beat_2: {
  art:'milestone1', artLabel:'Milestone 1 · Beat 2',
  bgText:'THE BIKE',
  lines:[
    N(`Cal Briggs had come with the truck and hadn't said much since. He had his hands in the engine bay of the flatbed, though there was nothing wrong with it that Duke knew of. Cal did that — kept his hands busy when he was thinking.`),
    N(`Without looking up, he said:`),
    C('CAL', `I could look at the bike.`),
    N(`That was Cal's version of offering. Duke knew it.`),
  ],
  choices:[
    { label:'A', text:`"Yeah. I'd appreciate it."`,
      subtext:`Let him work. No commentary.`,
      effects:{ rels:{ cal:'warm' }, stats:{ precision:1 }, flags:{ calWarmed:true } }, goto:'m1_b2_accept' },
    { label:'B', text:`"Sure. But walk me through what you're checking."`,
      subtext:`Trust, but verify.`,
      effects:{ rels:{ cal:'neutral' } }, goto:'m1_b2_micromanage' },
    { label:'C', text:`"I've got it. Thanks."`,
      subtext:`Your bike. Your prep.`,
      effects:{ stats:{ precision:-1 }, rels:{ cal:'neutral' } }, goto:'m1_b2_yourself' },
    { label:'D', text:`"Yeah. Thanks, Cal." (then take credit for his work)`,
      subtext:`Accept the help, claim the result.`,
      effects:{ rels:{ cal:'strained' }, flags:{ calStrained:true } }, goto:'m1_b2_credit' },
  ]
},
m1_b2_accept: {
  art:'milestone1', artLabel:'Beat 2 · Accept',
  bgText:'THE BIKE',
  lines:[
    D(`Yeah. I'd appreciate it.`),
    N(`Cal nodded once. He went to the bike without fanfare. He moved the way he moved around engines — no wasted motion, no announcement.`),
    N(`Fifteen minutes later he straightened up.`),
    C('CAL', `Rear brake's a little soft. Fixed it. You're good.`),
    D(`Thanks, Cal.`),
    C('CAL', `Mm.`),
    N(`That was a conversation with Cal. Duke had learned not to want more than that.`),
  ],
  next:'m1_beat_3'
},
m1_b2_micromanage: {
  art:'milestone1', artLabel:'Beat 2 · Micromanage',
  bgText:'THE BIKE',
  lines:[
    D(`Sure. But walk me through what you're checking.`),
    N(`A pause.`),
    C('CAL', `Brake feel. Chain tension. Tire pressure.`),
    D(`Right. And the—`),
    C('CAL', `Duke.`),
    D(`Yeah?`),
    C('CAL', `I've done this.`),
    N(`He had. Duke knew he had.`),
    D(`Right. Go ahead.`),
    N(`Cal did the work. Duke watched. He told himself he was learning something.`),
  ],
  next:'m1_beat_3'
},
m1_b2_yourself: {
  art:'milestone1', artLabel:'Beat 2 · Solo',
  bgText:'THE BIKE',
  lines:[
    D(`I've got it. Thanks.`),
    N(`Cal's hands went still in the engine bay. He looked at Duke once. Then he went back to what he was doing and didn't offer again.`),
    N(`Duke tuned the bike himself. He did a decent job. He missed two things that weren't critical and one thing that was.`),
    N(`He wouldn't know about the third one until he was in the air.`),
  ],
  next:'m1_beat_3'
},
m1_b2_credit: {
  art:'milestone1', artLabel:'Beat 2 · Credit',
  bgText:'THE BIKE',
  lines:[
    D(`Yeah. Thanks, Cal.`),
    N(`Cal did the work. The bike was better for it.`),
    N(`Twenty minutes later, Tommy said something to a bystander about how Duke had tuned the machine himself. Duke didn't correct him.`),
    N(`Cal was within earshot. He didn't say anything. He never said anything when things like this happened.`),
    N(`But he heard it.`),
  ],
  next:'m1_beat_3'
},

/* ---- BEAT 3 — THE KID ---- */
m1_beat_3: {
  art:'milestone1', artLabel:'Milestone 1 · Beat 3',
  bgText:'THE KID',
  lines:[
    N(`He was lining up the approach angle when a boy appeared at the fence — maybe ten years old, with a program that had already been folded and refolded too many times.`),
    C('BOY', `Mr. Harlan? Can I get your autograph?`),
    N(`Duke looked at him. He hadn't done anything yet. He was just a man with a bike.`),
  ],
  choices:[
    { label:'A', text:`Sign it, say something warm.`,
      subtext:`"Sure, kid. What's your name?"`,
      effects:{ stats:{ showmanship:1 }, flags:{ rickySigned:true } }, goto:'m1_b3_sign' },
    { label:'B', text:`Wave him off. You're focused.`,
      subtext:`"Not right now."`,
      effects:{}, goto:'m1_b3_ignore' },
    { label:'C', text:`Sign it. Tell him he'll remember this.`,
      subtext:`"Someday you'll say you knew me before."`,
      effects:{ stats:{ showmanship:1 }, flags:{ rickySigned:true, rickyLegacy:true } }, goto:'m1_b3_legacy' },
  ]
},
m1_b3_sign: {
  art:'milestone1', artLabel:'Beat 3 · Warm',
  bgText:'THE KID',
  lines:[
    N(`He signed it. The boy's name was Ricky.`),
    N(`Ricky folded the program carefully and put it in his back pocket and went off through the crowd without looking back, already protecting the thing he'd gotten.`),
    N(`Duke watched him go. He thought: good.`),
  ],
  next:'m1_stunt_approach'
},
m1_b3_ignore: {
  art:'milestone1', artLabel:'Beat 3 · Ignore',
  bgText:'THE KID',
  lines:[
    N(`"Not right now."`),
    N(`The boy's face did something careful and then he went. Duke went back to the approach angle.`),
    N(`He thought about the boy's face during the stunt. He didn't know why. He just did.`),
  ],
  next:'m1_stunt_approach'
},
m1_b3_legacy: {
  art:'milestone1', artLabel:'Beat 3 · Legacy',
  bgText:'THE KID',
  lines:[
    N(`He signed it. He looked at the boy for a moment.`),
    D(`You know what? Someday you'll say you knew me before.`),
    N(`The boy considered this.`),
    C('BOY', `Before what?`),
    D(`That's a good question.`),
    N(`He gave the program back. The boy went off with it, uncertain but satisfied. Duke watched him go.`),
    N(`He meant it when he said it. He meant it in a way that felt bigger than the moment.`),
  ],
  next:'m1_stunt_approach'
},

/* ---- THE STUNT APPROACH ---- */
m1_stunt_approach: {
  art:'stunt', artLabel:'The Stunt',
  bgText:'THREE COWS',
  lines:[
    N(`The crowd had gathered the way fair crowds gather — too many people pretending they weren't there on purpose. Someone on the PA said his name wrong. He didn't correct it.`),
    N(`The ramp was twelve inches of plywood over a steel frame. The cows were lined up and docile and approximately enormous. Three of them.`),
    N(`He sat on the bike at the end of the track and let the engine idle.`),
    N(`This was the part he didn't talk about. This moment, right here, before anything happened. The noise of the crowd went somewhere he couldn't hear it. Everything went very specific.`),
    N(`The bike. The ramp. The sky. Three cows.`),
  ],
  // origin trait line inserted dynamically in render
  next:'_minigame_stunt_m1'
},

/* ---- STUNT OUTCOMES ---- */
m1_stunt_perfect: {
  art:'stunt', artLabel:'The Stunt · Perfect',
  bgText:'CLEAN',
  lines:[
    N(`He hit the ramp at exactly the speed he intended.`),
    N(`At the top of the arc — that half-second — everything was exactly where it was supposed to be.`),
    N(`He cleared the cows by four feet. The landing was clean. The crowd's sound hit him a moment after his wheels touched the dirt, like thunder after lightning.`),
    N(`He brought the bike to a stop and turned it around. He raised one hand. He wasn't sure why he did it. It seemed right.`),
  ],
  statUpdate:{ title:'A Perfect Run', reason:'Clean arc. Clean landing. The crowd knows what it saw.', deltas:{ nerve:1, showmanship:1 } },
  next:'_minigame_crowd_m1'
},
m1_stunt_messy: {
  art:'stunt', artLabel:'The Stunt · Upright',
  bgText:'HELD IT',
  lines:[
    N(`He hit the ramp a half-beat faster than he'd planned. The correction had to happen in the air.`),
    N(`His weight went wrong. He didn't fight it — fighting it would have finished it. He leaned into the correction the way you lean into a skid, which is to say you trust something that isn't logic.`),
    N(`He came down with his front wheel cocked left. He held it. He held it. He held it.`),
    N(`The bike came straight.`),
    N(`The crowd was already screaming before he stopped because they'd seen what almost happened and it was worse and better than what they'd expected.`),
    N(`He sat there for a moment. Breathing.`),
    N(`He was upright. He counted that.`),
  ],
  statUpdate:{ title:'Messy. Upright.', reason:'Sheer will in the last ten feet. The crowd saw it.', deltas:{ nerve:1 } },
  next:'m1_earl_approach_messy'
},
m1_stunt_clipped: {
  art:'stunt', artLabel:'The Stunt · Chaos',
  bgText:'CHAOS',
  lines:[
    N(`He cleared the first two cows clean.`),
    N(`The third cow had moved.`),
    N(`He caught it with the back tire — a glancing thing, a mistake — and the bike bucked sideways and the crowd made a sound he'd never heard before, a collective inhale that turned into something like a scream.`),
    N(`He did not think. His body made decisions his brain would have been slower at.`),
    N(`When he landed — when the bike finally stopped doing what physics insisted on doing — he was upright, sideways to the ramp, dust still settling.`),
    N(`The cow appeared uninjured. It had moved back to its original position with the serene indifference of livestock.`),
    N(`The crowd was losing its mind.`),
  ],
  statUpdate:{ title:'Chaos With Style', reason:'Not planned. But the crowd will remember it that way.', deltas:{ showmanship:2, precision:-1 } },
  next:'m1_earl_approach_clipped'
},
m1_stunt_crash_walk: {
  art:'stunt', artLabel:'The Stunt · Crash',
  bgText:'UP',
  lines:[
    N(`He hit the ramp right. He hit the cows wrong.`),
    N(`It happened fast enough that the narrative — this is where it went wrong — arrived after the fact. The front wheel drifted. The bike went.`),
    N(`He hit the dirt on his left side. The world made a hard noise.`),
    N(`He lay there for one second. Two. He did an inventory: pain, yes; broken, he didn't think so; crowd very quiet.`),
    N(`He stood up.`),
    N(`He didn't plan to raise his fist. It just happened. Like the body making a declaration the brain didn't have words for yet.`),
    N(`The crowd came back to itself.`),
  ],
  statUpdate:{ title:'Down. Back Up.', reason:'The fist. The crowd will remember the fist.', deltas:{ nerve:-1, precision:-1, showmanship:1 } },
  next:'m1_earl_approach_crash_walk'
},
m1_stunt_crash_bad: {
  art:'stunt', artLabel:'The Stunt · Hard Fall',
  bgText:'DOWN',
  lines:[
    N(`He hit the dirt and something was wrong in a way he knew immediately.`),
    N(`He tried to get up. His leg wasn't part of the plan.`),
    N(`Cal reached him first. Cal was already moving before the crowd registered what had happened. He crouched next to Duke and didn't say anything and put his hand on Duke's shoulder.`),
    N(`Duke heard the crowd and then he stopped hearing it.`),
    C('CAL', `Stay down. You hear me? Stay there.`),
    N(`He stayed there.`),
    N(`Somewhere at the edge of the scene, a man in a brimmed hat watched from behind the fence. He watched for a long time. Then he turned and said something to the man next to him and took out a card and set it on the rail.`),
    N(`Someone told Cal about the card later.`),
  ],
  statUpdate:{ title:'Hard Down', reason:'The body took a real hit. This will need time.', deltas:{ nerve:-2, precision:-1, condition:-2 } },
  next:'m1_earl_card'
},

/* ---- EARL APPROACH ---- */
m1_earl_approach_perfect: {
  art:'milestone1', artLabel:'Earl · Perfect',
  bgText:'EARL',
  lines:[
    N(`He didn't get far. A man materialized at his elbow — big brimmed hat, unlit cigar, the kind of silver belt buckle that announces its own opinion.`),
    N(`He didn't extend a hand right away. He stood there and looked at Duke the way you look at something you're considering buying.`),
    C('EARL', `Son, I've been to Vegas. I've been to Houston. I saw a man jump fourteen cars in 1963 and the crowd didn't make a sound like that crowd just made.`),
    N(`He let that sit.`),
    C('EARL', `Earl Maddox.`),
    N(`Duke knew the name. He'd done his research.`),
  ],
  next:'m1_earl_modifiers'
},
m1_earl_approach_messy: {
  art:'milestone1', artLabel:'Earl · Upright',
  bgText:'EARL',
  lines:[
    N(`The man was there when Duke turned around. Big hat, unlit cigar, a belt buckle that had opinions about itself.`),
    N(`He didn't say anything right away. He looked at Duke — not at the ramp, not at the crowd, at Duke — and then he said:`),
    C('EARL', `That last ten feet. That's what I'm buying.`),
    N(`He said it like it was already settled. Duke noticed that.`),
    C('EARL', `Earl Maddox.`),
  ],
  next:'m1_earl_modifiers'
},
m1_earl_approach_clipped: {
  art:'milestone1', artLabel:'Earl · Clipped',
  bgText:'EARL',
  lines:[
    N(`The man found him while Duke was still getting his heart rate down.`),
    C('EARL', `Chaos with style.`),
    N(`Duke looked at him. Hat. Cigar. Belt buckle.`),
    C('EARL', `Do you know how many people pay for chaos with style? A significant number of people pay for chaos with style.`),
    N(`He seemed genuinely pleased. Duke wasn't entirely sure what to do with that.`),
    C('EARL', `Earl Maddox. Don't let anyone tell you that cow wasn't on purpose.`),
  ],
  next:'m1_earl_modifiers'
},
m1_earl_approach_crash_walk: {
  art:'milestone1', artLabel:'Earl · Fist',
  bgText:'EARL',
  lines:[
    N(`Duke was still dusty when the man appeared. Hat. Cigar. A quiet authority that had nothing to do with volume.`),
    N(`He looked at Duke for a long moment. Then:`),
    C('EARL', `The fist.`),
    N(`A pause.`),
    C('EARL', `Did you plan that?`),
    N(`Duke didn't answer.`),
    C('EARL', `Doesn't matter. Plan it next time.`),
    N(`He didn't say it critically. He said it like a note on a take.`),
    C('EARL', `Earl Maddox. You already know why I'm here.`),
  ],
  next:'m1_earl_modifiers'
},
m1_earl_card: {
  art:'milestone1', artLabel:'Earl · Card',
  bgText:'THE CARD',
  lines:[
    N(`He didn't meet Earl Maddox that day. He was in too much pain, and Earl — whoever he was — seemed to understand that.`),
    N(`Cal showed him the card later. White card. One name, one number.`),
    C('CAL', `Man left this on the fence rail. Said to give it to you when you were up.`),
    N(`Duke took the card. He didn't have much to say about it right then.`),
  ],
  statUpdate:{ title:'Down for Now', reason:'The body needs rest. Earl can wait.', deltas:{} },
  next:'m1_close'
},

m1_earl_modifiers: {
  art:'milestone1', artLabel:'Earl · Context',
  bgText:'LEVERAGE',
  // Dynamic content built in renderScene based on flags
  lines:[],
  _dynamic: true,
  next:'m1_player_response'
},

/* ---- PLAYER RESPONSE TO EARL ---- */
m1_player_response: {
  art:'milestone1', artLabel:'Response to Earl',
  bgText:'YOUR MOVE',
  lines:[
    N(`Earl had finished saying whatever he'd come to say. The space where Duke answered opened up.`),
  ],
  choices:[
    { label:'1', text:`"I'm listening."`,
      subtext:`Let him set the pace.`,
      effects:{ rels:{ earl:'backer' } }, goto:'m1_r1' },
    { label:'2', text:`"What's your cut?"`,
      subtext:`Signal business sense right out of the gate.`,
      effects:{ stats:{ hustle:1 }, rels:{ earl:'backer' } }, goto:'m1_r2' },
    { label:'3', text:`"I've got a mechanic. He comes with me."`,
      subtext:`Cal's part of the deal. Non-negotiable.`,
      effects:{ rels:{ earl:'backer', cal:'loyal' } }, goto:'m1_r3' },
    { label:'4', text:`"I want to see a contract before I say anything."`,
      subtext:`No handshakes without paper.`,
      effects:{ stats:{ hustle:2 }, rels:{ earl:'backer' } }, goto:'m1_r4' },
    { label:'5', text:`"I need to talk to someone first."`,
      subtext:`There's a person in the crowd you want to find.`,
      effects:{ flags:{ ruthieEstablished:true } }, goto:'m1_r5' },
    { label:'6', text:`"Not interested."`,
      subtext:`You don't need this man.`,
      effects:{ rels:{ earl:'absent' }, flags:{ earlResponse:'not_interested' } }, goto:'m1_r6' },
  ]
},
m1_r1: {
  art:'milestone1', artLabel:'Response · Listening',
  bgText:'EARL',
  lines:[
    D(`I'm listening.`),
    N(`Earl smiled. It was a small smile, and it had experience in it.`),
    C('EARL', `Good. Then let's find somewhere that isn't a fairground.`),
    N(`He produced a card. He set it in Duke's hand.`),
    C('EARL', `I'll be in town through tomorrow. You call when you're ready.`),
    N(`He walked off through the crowd and the crowd parted for him, though he didn't ask it to.`),
    N(`Duke looked at the card. It had Earl's name and a telephone number and nothing else. People with a certain kind of money don't need to explain what they do.`),
  ],
  next:'m1_close'
},
m1_r2: {
  art:'milestone1', artLabel:'Response · Cut',
  bgText:'EARL',
  lines:[
    D(`What's your cut?`),
    N(`Earl looked at him. Something shifted, slightly, in his expression.`),
    C('EARL', `Forty percent.`),
    D(`Of what?`),
    C('EARL', `Of what you make.`),
    D(`And what do I make?`),
    C('EARL', `More than you're making now.`),
    N(`Duke held his gaze. Earl held it back.`),
    C('EARL', `You've done this before. Or you've thought about it.`),
    D(`I've thought about it.`),
    C('EARL', `Good. That's actually good.`),
    N(`He gave Duke the card. Duke took it.`),
    C('EARL', `When you've thought about it some more, call.`),
  ],
  statUpdate:{ title:'First Signal', reason:'Earl recalibrated when you asked the cut question first. He noticed.', deltas:{ hustle:0 } },
  next:'m1_close'
},
m1_r3: {
  art:'milestone1', artLabel:'Response · Mechanic',
  bgText:'EARL',
  lines:[
    D(`I've got a mechanic. He comes with me.`),
    N(`A short pause. Earl looked toward the truck, where Cal was doing something with a wrench.`),
    C('EARL', `The quiet one.`),
    D(`The quiet one.`),
    C('EARL', `And if I say no?`),
    D(`Then we've had a nice conversation.`),
    N(`Earl looked at Duke. Then he looked at Cal again. Cal didn't look back. He never did.`),
    C('EARL', `Alright. He comes with you.`),
    N(`It cost Earl something and he absorbed it without showing it. Duke filed that away too.`),
  ],
  statUpdate:{ title:'Cal\'s In', reason:'You went to bat for Cal before the ink dried on anything. He heard.', deltas:{}, rels:{ cal:'loyal' } },
  next:'m1_close'
},
m1_r4: {
  art:'milestone1', artLabel:'Response · Contract',
  bgText:'EARL',
  lines:[
    D(`I want to see a contract before I say anything.`),
    N(`Earl stopped. This was the first time anything had stopped him.`),
    N(`He looked at Duke with something that might have been reassessment.`),
    C('EARL', `Most people don't say that.`),
    D(`I'm not most people.`),
    C('EARL', `No. You're also not as green as you're dressed.`),
    N(`He gave Duke the card. He looked at him a beat longer than necessary.`),
    C('EARL', `I'll have something drawn up. You read it — actually read it — and we'll talk.`),
    N(`He walked off. Duke had the feeling that he'd surprised the man.`),
    N(`He'd take it.`),
  ],
  statUpdate:{ title:'Earl Surprised', reason:`"I want a contract" — most people don't say that. Earl will come in with better first terms.`, deltas:{ hustle:1 } },
  next:'m1_close'
},
m1_r5: {
  art:'milestone1', artLabel:'Response · Ruthie',
  bgText:'SOMEONE FIRST',
  lines:[
    D(`I need to talk to someone first.`),
    N(`Earl accepted that with a nod.`),
    C('EARL', `She here today?`),
    D(`She might be.`),
    C('EARL', `Smart man.`),
    N(`Earl gave him the card. He walked off without another word. Whether he admired it or filed it away as a vulnerability, Duke couldn't tell.`),
  ],
  next:'m1_ruthie'
},
m1_r6: {
  art:'milestone1', artLabel:'Response · Pass',
  bgText:'EARL',
  lines:[
    D(`Not interested.`),
    N(`Earl looked at him. He didn't look offended. He looked like a man recalculating.`),
    C('EARL', `Alright.`),
    N(`He reached into his jacket. He set a card on the ramp.`),
    C('EARL', `That's for when you change your mind.`),
    D(`I said not interested.`),
    C('EARL', `I heard what you said.`),
    N(`He walked off through the crowd. He didn't look back.`),
    N(`Duke left the card on the ramp for ten minutes before he picked it up.`),
  ],
  next:'m1_close'
},

/* ---- RUTHIE SCENE ---- */
m1_ruthie: {
  art:'milestone1', artLabel:'Ruthie',
  bgText:'RUTHIE',
  lines:[
    N(`She was by the livestock barn, which was where she always ended up at the fair because she liked the animals and didn't care who knew it. He found her watching the draft horses.`),
    D(`Hey.`),
    C('RUTHIE', `Hey.`),
    N(`She didn't ask how it went. She'd seen it. She was waiting on him to decide what it was.`),
    D(`Some man wants to put money into the act.`),
    C('RUTHIE', `What kind of man?`),
    D(`Big hat. Texas money. Seemed like he knew what he was doing.`),
    C('RUTHIE', `Those are the ones to watch.`),
    N(`She wasn't wrong and he knew it.`),
    D(`I wanted to tell you before I did anything.`),
    C('RUTHIE', `I appreciate that.`),
    D(`I haven't done anything yet.`),
    C('RUTHIE', `I know.`),
    N(`She turned to look at him then. She had a way of looking at people that made them feel accurately understood, which was not always comfortable.`),
    C('RUTHIE', `What do you want to do?`),
  ],
  choices:[
    { label:'A', text:`"I think I want to take it."`,
      effects:{ rels:{ ruthie:'solid' } }, goto:'m1_ruthie_a' },
    { label:'B', text:`"I don't know yet. That's why I'm here."`,
      effects:{ rels:{ ruthie:'solid' } }, goto:'m1_ruthie_b' },
    { label:'C', text:`"What do you think I should do?"`,
      effects:{ rels:{ ruthie:'solid' } }, goto:'m1_ruthie_c' },
  ]
},
m1_ruthie_a: {
  art:'milestone1', artLabel:'Ruthie · A',
  bgText:'RUTHIE',
  lines:[
    D(`I think I want to take it.`),
    C('RUTHIE', `Okay.`),
    D(`That's all?`),
    C('RUTHIE', `What did you want me to say?`),
    D(`I don't know. Something.`),
    C('RUTHIE', `Duke. You were going to do something like this eventually. It was always going to come to a man with a hat and a card.`),
    N(`She said it without judgment. That was the thing about Ruthie — she could say a true and inconvenient thing and it came out sounding like weather.`),
    C('RUTHIE', `Read the contract first.`),
    D(`That's the plan.`),
    C('RUTHIE', `Good.`),
    N(`She went back to watching the horses. He stood there another moment.`),
    D(`You're not worried?`),
    C('RUTHIE', `I didn't say that.`),
  ],
  statUpdate:{ title:'Ruthie — Solid', reason:'She\'s steady about it. That counts for something.', deltas:{ nerve:1 }, rels:{ ruthie:'solid' } },
  next:'m1_close'
},
m1_ruthie_b: {
  art:'milestone1', artLabel:'Ruthie · B',
  bgText:'RUTHIE',
  lines:[
    D(`I don't know yet. That's why I'm here.`),
    N(`Something shifted in her expression — slightly, the way things shift in Ruthie when they matter to her.`),
    C('RUTHIE', `You came to me before you'd decided.`),
    D(`Yeah.`),
    C('RUTHIE', `Okay.`),
    N(`She was quiet for a moment. The horse nearest them put its nose over the fence.`),
    C('RUTHIE', `I think you should read the contract before you decide anything. And I think you should sleep on it.`),
    D(`That's it?`),
    C('RUTHIE', `That's it.`),
    D(`I thought you'd have more to say about it.`),
    C('RUTHIE', `I'll have more to say when you've decided. Right now you haven't decided, so there's nothing to say yet.`),
    N(`He looked at her. He thought: this is a person who understands the difference between a decision and a conversation about a decision.`),
    C('RUTHIE', `Come find me tonight.`),
    D(`Yeah.`),
  ],
  statUpdate:{ title:'Ruthie — Solid', reason:'Coming to her before you decided. She noticed.', deltas:{ nerve:1 }, rels:{ ruthie:'solid' } },
  next:'m1_close'
},
m1_ruthie_c: {
  art:'milestone1', artLabel:'Ruthie · C',
  bgText:'RUTHIE',
  lines:[
    D(`What do you think I should do?`),
    N(`She looked at him with a particular expression he'd learned to recognize: she was deciding whether to answer the question or the thing underneath it.`),
    C('RUTHIE', `I think you've already decided.`),
    D(`I asked what you thought.`),
    C('RUTHIE', `And I'm telling you — you've already decided. You're asking me because you want permission or because you want someone to talk you out of it. Which is it?`),
    N(`He didn't answer right away. That was an answer.`),
    C('RUTHIE', `Don't take it because you want my permission. I won't give that. And if you need talking out of it, I'm the wrong person.`),
    D(`Why?`),
    C('RUTHIE', `Because I'd rather you do the thing honestly and fail at it than not do it and wonder the rest of your life.`),
    N(`She paused.`),
    C('RUTHIE', `Read the contract, though.`),
    D(`Yeah.`),
  ],
  statUpdate:{ title:'Ruthie — Solid', reason:'She gave it to you straight. She always does.', deltas:{}, rels:{ ruthie:'solid' } },
  next:'m1_close'
},

/* ---- MILESTONE 1 CLOSE ---- */
m1_close: {
  art:'milestone1', artLabel:'Milestone 1 · Close',
  bgText:'THE END OF THE DAY',
  lines:[
    N(`The fair went on. People ate things on sticks and watched the livestock judging and played games that were rigged the way carnival games are always rigged.`),
    N(`Duke found the truck and sat on the tailgate. Cal was there. They didn't talk.`),
    N(`Tommy came by eventually and talked enough for both of them. Tommy always did.`),
    N(`The card was in Duke's pocket. He'd check it again later. Right now he was just sitting with the afternoon and the way it felt to have done the thing and still be on this side of it.`),
    N(`That was enough. For now, that was enough.`),
  ],
  next:'_chapter_fr1'
},

/* ============================================================
   FREE ROAM 1
   ============================================================ */
fr1_hub_open: {
  art:'fr1', artLabel:'Free Roam 1',
  bgText:'EARLY DAYS',
  lines:[
    N(`The weeks after the fair had a different texture than the weeks before it.`),
    N(`Before, he'd been building toward something. After, he was waiting on something he'd set in motion — and the waiting had its own specific weight. Earl's card was on the kitchen table. The contract was coming. In the meantime, there was the rest of his life.`),
    N(`He had evenings. He had the bike. He had people he hadn't called back yet.`),
    N(`He had some decisions to make.`),
  ],
  next:'_hub_fr1'
},

/* ---- DAY SCENES ---- */
fr1_organizer: {
  art:'fr1', artLabel:'Fair Organizer',
  bgText:'NEXT YEAR',
  lines:[
    N(`Lloyd Perkins had run the booking side of the ${GS.town} Fair for eleven years. He had a clipboard, a short-sleeved button-up, and the careful confidence of a man who was a big fish in a pond he understood precisely.`),
    N(`He found Duke outside the auto parts store.`),
    C('ORGANIZER', `Mr. Harlan. Got a minute?`),
    D(`I've got a few.`),
    C('ORGANIZER', `Good crowd response last Saturday. I wanted to talk about next August.`),
    D(`I'm listening.`),
    C('ORGANIZER', `We'd like to have you back. We'd bill you proper this time — marquee act, not just a feature. Maybe four or five cows. Whatever you're comfortable with.`),
    N(`He said the last part in the way that people say things they know aren't entirely true.`),
    C('ORGANIZER', `We can offer a hundred and twenty dollars for the performance. That's more than what you made Saturday.`),
  ],
  choices:[
    { label:'A', text:`"I'd need a hundred and fifty."`,
      subtext:"Counter high. See what he\'s actually got.",
      effects:{ stats:{ hustle:1 } }, goto:'fr1_org_counter' },
    { label:'B', text:`"A hundred twenty works."`,
      subtext:"Take the deal. It\'s fair.",
      effects:{}, goto:'fr1_org_accept' },
    { label:'C', text:`"I need to think about it. I've got other conversations happening."`,
      subtext:`Leverage what you have — even if it's mostly potential.`,
      effects:{ stats:{ hustle:1 } }, goto:'fr1_org_wait' },
    { label:'D', text:`"I appreciate the offer. I'll pass for now."`,
      subtext:`Keep the table clean for Earl's conversation.`,
      effects:{}, goto:'fr1_org_decline' },
  ]
},
fr1_org_counter: {
  art:'fr1', artLabel:'Organizer · Counter',
  bgText:'DEAL',
  lines:[
    D(`I'd need a hundred and fifty.`),
    N(`Perkins wrote something on his clipboard.`),
    C('ORGANIZER', `I can do a hundred and thirty-five. And I'll put you in the program by name, not just "motorcycle demonstration."`),
    D(`Deal.`),
    C('ORGANIZER', `Good. I'll draw something up.`),
    N(`He turned to go and then stopped.`),
    C('ORGANIZER', `You're going to want to get bigger before next year. People are going to expect more.`),
    D(`Yeah.`),
    C('ORGANIZER', `Not saying that as a threat. Just — I've seen this go a few ways.`),
    N(`He said it like someone who'd watched a few too many county fair acts reach the edge of what county fairs could hold.`),
  ],
  statUpdate:{ title:'$135 and a Name in Print', reason:'You pushed. He moved. First real negotiation.', deltas:{ hustle:0 }, flags:{ fairOrganizerDone:true, perkinsBooking:'booked', perkinsFee:135 } },
  next:'_hub_fr1'
},
fr1_org_accept: {
  art:'fr1', artLabel:'Organizer · Accept',
  bgText:'DEAL',
  lines:[
    D(`A hundred twenty works. Let's talk terms.`),
    N(`Perkins looked briefly surprised. He'd expected at least one counter.`),
    C('ORGANIZER', `Alright. Straightforward. I like that.`),
    N(`He liked it because it meant he'd won. Duke knew that about five seconds after he said it.`),
    N(`He took the deal. He didn't think about it again right away. He thought about it later, once.`),
  ],
  statUpdate:{ title:'Done Deal', reason:'Clean. Fast. Lloyd got the better end.', deltas:{}, flags:{ fairOrganizerDone:true, perkinsBooking:'booked', perkinsFee:120 } },
  next:'_hub_fr1'
},
fr1_org_wait: {
  art:'fr1', artLabel:'Organizer · Wait',
  bgText:'LEVERAGE',
  lines:[
    D(`I need to think about it. I've got other conversations happening.`),
    N(`That was not entirely true. It was about forty percent true.`),
    C('ORGANIZER', `Other conversations.`),
    D(`That's right.`),
    C('ORGANIZER', `With who, if you don't mind.`),
    N(`Duke looked at him.`),
    D(`I mind a little.`),
    N(`Perkins wrote something down. Duke suspected it said "difficult" but he was willing to live with that.`),
    C('ORGANIZER', `I can do a hundred and forty. But I'd need an answer by end of the week.`),
    D(`That works.`),
  ],
  statUpdate:{ title:'$140 — Hustle Pays', reason:`Strategic delay. He respected that you had other conversations — even the forty-percent-true kind.`, deltas:{ hustle:1 }, flags:{ fairOrganizerDone:true, perkinsBooking:'booked', perkinsFee:140 } },
  next:'_hub_fr1'
},
fr1_org_decline: {
  art:'fr1', artLabel:'Organizer · Pass',
  bgText:'NOT YET',
  lines:[
    D(`I appreciate the offer. I'll pass for now.`),
    N(`Perkins blinked.`),
    C('ORGANIZER', `Can I ask why?`),
    D(`I've got something I'm figuring out first. I'd rather not overcommit.`),
    C('ORGANIZER', `Fair enough.`),
    N(`He wrote something on the clipboard and flipped it shut. He didn't argue. Duke respected that.`),
    C('ORGANIZER', `If you change your mind in the next couple of weeks—`),
    D(`I know where to find you.`),
    C('ORGANIZER', `Right. Good luck, then.`),
    N(`Duke watched him walk back toward the fairground parking lot.`),
    N(`He didn't know yet if that was the right call. He'd know at Milestone 2.`),
  ],
  statUpdate:{ title:'Table Stays Clean', reason:`"I'd rather not overcommit." Sometimes that's the right move.`, deltas:{}, flags:{ fairOrganizerDone:true, perkinsBooking:'declined' } },
  next:'_hub_fr1'
},

/* ---- YOUNG WANNABE ---- */
fr1_wannabe_intro: {
  art:'fr1', artLabel:'The Young Wannabe',
  bgText:'THE KID',
  lines:[
    N(`He'd seen the kid around. Not Ricky — a different one. Older. Maybe sixteen. He'd been at the fair with a bicycle and a length of plywood propped over a stack of tires in the parking lot.`),
    N(`The kid found him at the gas station.`),
    C('WANNABE', `Mr. Harlan.`),
    D(`Just Duke.`),
    C('WANNABE', `Duke. I saw you at the fair.`),
    D(`Most people did.`),
    C('WANNABE', `I want to do what you do. I've been working on some jumps. I've got a setup in my uncle's lot. I was wondering if you'd—`),
    N(`He stopped himself and recalibrated.`),
    C('WANNABE', `I was wondering if you'd take a look. Just take a look. I'm not asking you to do anything.`),
  ],
  choices:[
    { label:'A', text:`"Show me what you've got."`,
      subtext:`Go see. Doesn't cost you anything but an hour.`,
      effects:{ flags:{ wannabeMet:true }, stats:{ showmanship:1 } }, goto:'fr1_wannabe_look' },
    { label:'B', text:`"I'm pretty busy right now. Maybe later."`,
      subtext:`Defer but don't close.`,
      effects:{}, goto:'fr1_wannabe_defer' },
    { label:'C', text:`"This isn't something I can teach."`,
      subtext:`Be straight with him.`,
      effects:{}, goto:'fr1_wannabe_close' },
  ]
},
fr1_wannabe_look: {
  art:'fr1', artLabel:'Wannabe · Agree',
  bgText:'PETE',
  lines:[
    D(`Show me what you've got.`),
    N(`The kid's face changed the way faces change when something goes better than expected.`),
    C('WANNABE', `Yeah? Right now?`),
    D(`You got somewhere else to be?`),
    C('WANNABE', `No sir. I mean — no.`),
    N(`The uncle's lot was three blocks away. The setup was exactly what Duke had expected: plywood over tires, too steep an angle, bicycle that had been modified more than was advisable.`),
    N(`The kid went over it twice. The second pass was cleaner than the first.`),
    D(`The angle's wrong on the ramp.`),
    C('WANNABE', `I know. I can't get it right.`),
    D(`It's the legs. They're not even. You need to—`),
    N(`He stopped. He got down and showed him.`),
    N(`It took about ten minutes. The kid watched the whole time with the specific attention of someone memorizing something.`),
    D(`Try it now.`),
    N(`He did. It was better. Not good yet — but the improvement was visible.`),
    C('WANNABE', `Huh.`),
    D(`Yeah.`),
    N(`Duke stood up and dusted his hands.`),
    D(`What's your name?`),
    C('WANNABE', `Pete. Pete Garland.`),
  ],
  // `rels.pete` was read in five places and assigned in none, so it was always
  // undefined — which silently removed Milestone 5's "mentor the apprentice"
  // ending from the list (its `_needs` tests exactly that) and made
  // `m4_prestunt_pete_m4` unreachable. The thread starts here.
  statUpdate:{ title:'Pete Garland', reason:`You showed him the ramp angle. He memorized every move. Thread active.`, deltas:{ showmanship:0 }, rels:{ pete:'hanger_on' }, flags:{ wannabeMet:true } },
  next:'_hub_fr1'
},
fr1_wannabe_defer: {
  art:'fr1', artLabel:'Wannabe · Later',
  bgText:'MAYBE LATER',
  lines:[
    D(`I'm pretty busy right now. Maybe later.`),
    C('WANNABE', `Oh. Okay.`),
    N(`The kid absorbed this with the practiced evenness of someone who'd heard "maybe later" before.`),
    C('WANNABE', `Sure. I'll — yeah. Thanks.`),
    N(`He went. Duke watched him go and thought, briefly, about the fair parking lot and the plywood ramp and the look on the kid's face.`),
    N(`He thought: I know that look.`),
  ],
  next:'_hub_fr1'
},
fr1_wannabe_close: {
  art:'fr1', artLabel:'Wannabe · Close',
  bgText:'NOT TODAY',
  lines:[
    D(`This isn't something I can teach.`),
    N(`The kid looked at him for a moment.`),
    C('WANNABE', `I wasn't asking you to teach me anything. Just to look.`),
    N(`Duke looked at him. The kid had a point.`),
    D(`Go find yourself a better ramp setup. The plywood over tires thing — that angle's going to hurt you.`),
    C('WANNABE', `Yeah. Okay.`),
    N(`He went. Duke watched him go. He thought: that was probably not the right call. He filed it away.`),
  ],
  next:'_hub_fr1'
},

/* ---- EVENING SCENES (stubs for now — will expand) ---- */
fr1_eve_ruthie: {
  art:'fr1', artLabel:'Evening · Ruthie',
  bgText:'HOME',
  _isEvening: true,
  lines:[
    N(`He found her in the kitchen. She was reading something, one knee up on the chair the way she sat when she didn't expect company.`),
    N(`She didn't say anything when he came in. She moved over slightly, which was its own kind of invitation.`),
    N(`They talked about things that weren't the fair and weren't Earl's card and weren't the contract coming. That was most of the evening. It was enough.`),
    C('RUTHIE', `You sleeping okay?`),
    D(`Better than last week.`),
    C('RUTHIE', `Good.`),
    N(`She went back to her book. He stayed. Outside, the town made its quiet sounds.`),
  ],
  statUpdate:{ title:'An Evening at Home', reason:'She grounds things. That has a value you can\'t put on a stat sheet.', deltas:{ nerve:1, condition:1 }, _isEvening:true },
  next:'_hub_fr1'
},
fr1_eve_cal: {
  art:'fr1', artLabel:'Evening · Cal',
  bgText:'THE GARAGE',
  _isEvening: true,
  lines:[
    N(`Cal's garage smelled like motor oil and metal dust and a coffee that had been sitting on the workbench too long.`),
    N(`They went over the bike for two hours. Cal didn't talk much; Duke had learned to follow his hands instead of waiting for words.`),
    C('CAL', `You been running her hard.`),
    D(`That's what she's for.`),
    C('CAL', `Sure.`),
    N(`He said "sure" the way he said most things, which left room for a different interpretation if you were paying attention.`),
    N(`Duke was starting to pay attention.`),
  ],
  statUpdate:{ title:'Two Hours in the Garage', reason:'Cal teaches sideways. But he teaches.', deltas:{ precision:1 }, _isEvening:true },
  next:'_hub_fr1'
},
fr1_eve_practice: {
  art:'fr1', artLabel:'Evening · Practice',
  bgText:'ALONE',
  _isEvening: true,
  lines:[
    N(`The fairground in the off-season had a specific quiet to it. No crowd sounds to fill the air. Just the engine and the ramp and the sound of his own breathing.`),
    N(`He ran the approach a dozen times. He wasn't trying to impress anyone. That was the point.`),
    N(`Around the eighth pass, something clicked. He didn't know what exactly. He just felt the difference.`),
  ],
  statUpdate:{ title:'Solo Practice', reason:'No one watching. The honest version of the work.', deltas:{ precision:1, nerve:1 }, _isEvening:true },
  next:'_hub_fr1'
},
fr1_eve_bar: {
  art:'fr1', artLabel:'Evening · Bar',
  bgText:'THE BAR',
  _isEvening: true,
  lines:[
    N(`Tommy knew everybody at the Rusty Nail and everybody knew Tommy. That was a double-edged thing, and Duke understood it better by the end of the evening than he had at the start.`),
    C('TOMMY', `People are talking about you. From the fair.`),
    D(`What are they saying?`),
    C('TOMMY', `They're saying you're either going somewhere or you got lucky with a cow.`),
    D(`Which do you think?`),
    N(`Tommy considered this with the seriousness of a man on his third beer.`),
    C('TOMMY', `I think you're going somewhere. I also think that cow was in the wrong spot.`),
    N(`That was fair.`),
    N(`The bar got louder around them. Tommy was three deep into a story Duke had heard twice, about a man in Larkin and a flatbed, and he was going to get to the end of it whether anyone was listening or not.`),
  ],
  // Phase 4. Tommy was `hanger_on` at the first line of the game and
  // `hanger_on` at the ending screen, on every run ever played, while two hub
  // cards gated on him not being gone and a Free Roam 4 line read
  // `rels.tommy === 'ally'`. The track starts here: this is the first evening
  // in the game where Duke can ask Tommy a question about Tommy.
  // The deltas are on the choices, not on the arms' `statUpdate`s, and that is
  // deliberate: a scene reached by a choice and carrying a `statUpdate` fires
  // it twice — once from `handleChoice` before the scene and once from
  // `afterScene` at the end of it — so its deltas apply twice. Measured on
  // `fr2_danny_01` option B: showmanship 0 goes to 3 for a choice that grants
  // +1 and a scene that grants +1. That is a known engine bug, on the standing
  // backlog, and it moves every transcript at once to fix, so this row routes
  // around it instead: numbers through `effects`, which `applyEffects` runs
  // exactly once, and the relationship and flag writes on the `statUpdate`,
  // where the stat screen announces them (they are idempotent, so firing twice
  // is harmless).
  choices:[
    { label:'A', text:`"What have you been doing?"`,
      subtext:'He has been waiting eight months for somebody to ask.',
      effects:{ stats:{ showmanship:1, condition:-1 } },
      goto:'fr1_eve_bar_him' },
    { label:'B', text:`Let him finish the flatbed story.`,
      subtext:"It\'s a good story. It is also the easy version of the evening.",
      effects:{ stats:{ showmanship:1, condition:-1 } },
      goto:'fr1_eve_bar_fair' },
  ]
},
fr1_eve_bar_him: {
  art:'fr1', artLabel:'Evening · Bar',
  bgText:'THE BAR',
  _isEvening: true,
  lines:[
    D(`What have you been doing?`),
    N(`Tommy stopped mid-flatbed. It took him a second.`),
    C('TOMMY', `Me?`),
    D(`You.`),
    C('TOMMY', `Hinkle's got a lot out past the grain elevator. Sundays, when it's closed.`),
    D(`Doing what?`),
    C('TOMMY', `Two cars. Off a plank ramp I built. It's not — it's not what you do.`),
    N(`He said it fast, to get in front of it. Duke let it go by.`),
    D(`How's the ramp?`),
    C('TOMMY', `It's a plank.`),
    D(`Angle it two more degrees and nail a lip on the end.`),
    N(`Tommy looked at him. Then he got out a pen and wrote it on the back of the bar receipt, which was the most serious Duke had ever seen him about anything.`),
  ],
  statUpdate:{
    title:'Night at the Nail',
    reason:"Good for Showmanship. Hard on Condition. He wrote it on a receipt.",
    deltas:{},
    flags:{ tommyAsked:true },
    _isEvening:true,
  },
  next:'_hub_fr1'
},
fr1_eve_bar_fair: {
  art:'fr1', artLabel:'Evening · Bar',
  bgText:'THE BAR',
  _isEvening: true,
  lines:[
    N(`The flatbed story ended the way it always ended, with the man from Larkin in a ditch and Tommy delighted about it.`),
    N(`Then it was about the fair again, and the cow, and what people were saying, and Duke let it be about that, because it was easier and because it was pleasant to be talked about.`),
    N(`Tommy walked him out to the truck at closing. He said something about next Saturday. Duke said sure.`),
    N(`On the drive home Duke could not have said what Tommy had done with the last eight months, and it did not occur to him that this was a thing a person might know.`),
  ],
  statUpdate:{ title:'Night at the Nail', reason:'Good for Showmanship. Hard on Condition. Tommy means well.', deltas:{}, _isEvening:true },
  next:'_hub_fr1'
},
fr1_eve_contract: {
  art:'fr1', artLabel:'Evening · The Contract',
  bgText:'READ IT',
  _isEvening: true,
  lines:[
    N(`He sat at the kitchen table with Earl's preliminary terms and a notepad and went through it three times.`),
    N(`It was twenty-two pages. He read all twenty-two.`),
    N(`Around page fourteen, he found the clause.`),
    N(`It was the insurance clause. Earl's version of it put the full cost of medical care back on Duke in the event of "non-approved stunt activities." The phrase "non-approved" was not defined.`),
    N(`He wrote that down.`),
    N(`He thought: I'll need to know what that phrase means before I sign anything.`),
  ],
  statUpdate:{ title:'The Fine Print', reason:'You found the insurance clause. Page fourteen. Not defined. That matters.', deltas:{ hustle:2 }, _isEvening:true },
  next:'_hub_fr1'
},

/* ============================================================
   MILESTONE 2 — THE INVESTOR OFFER
   ============================================================ */

/* --- M2 ENTRY (routes based on Earl state and timing) --- */
m2_entry: {
  art:'m2', artLabel:'Milestone 2',
  bgText:'THE OFFER',
  lines:[
    N(`Earl's office was the back room of a building on the edge of a city Duke had driven through before but never stopped in. The building had a different business on the door. That was probably deliberate.`),
    N(`Cal was with him. Duke hadn't said he was bringing Cal. He had. Cal didn't comment.`),
    N(`Earl was already seated when they came in. That was also probably deliberate.`),
    C('EARL',`Duke. Good to finally have the table between us instead of a fairground.`),
    D(`Earl.`),
    N(`He gestured at Cal.`),
    C('EARL',`This your man?`),
    D(`That's Cal Briggs. He's in the contract.`),
    N(`Earl looked at Cal the way a man looks at something he'd already accounted for.`),
    C('EARL',`Mr. Briggs. Heard good things.`),
    N(`Cal nodded. He didn't say anything, which was probably the right move.`),
    C('EARL',`Let's talk numbers.`),
  ],
  next:'m2_round1'
},

m2_entry_waited: {
  art:'m2', artLabel:'Milestone 2',
  bgText:'THE OFFER',
  lines:[
    N(`Earl's office. He'd kept Duke waiting a week and a half before calling back, and Duke had let him — the calculation being that a man who called first was the buyer, not the seller.`),
    N(`Earl was standing when they came in. He let them sit first.`),
    C('EARL',`You made me work for it.`),
    D(`You said call when I was ready.`),
    C('EARL',`Fair enough.`),
    N(`He sat. He put his hands on the table in the way of a man who had done this a hundred times and planned to do it a hundred more.`),
    C('EARL',`Forty percent. That's the opening number.`),
    N(`Duke had read the contract. He knew what forty percent meant in practice. He also knew what the insurance clause on page three meant.`),
    C('EARL',`You want to counter or do you want the rest of the pitch first?`),
  ],
  choices:[
    { label:'A', text:`"Give me the rest of the pitch first."`, subtext:'Make him work. More information is always useful.', effects:{}, goto:'m2_round1_pitch' },
    { label:'B', text:`"Thirty percent."`, subtext:'Come in low. See how he reacts.', effects:{ stats:{ hustle:1 } }, goto:'m2_round1_counter_low' },
    { label:'C', text:`"Before we get to percentages — I want to talk about the insurance clause."`, subtext:'You read the contract. Use it.', effects:{ stats:{ hustle:1 } }, goto:'m2_round1_clause_first' },
  ]
},

m2_entry_recovery: {
  art:'m2', artLabel:'Milestone 2 · Recovery',
  bgText:'THE OFFER',
  lines:[
    N(`The card had come through Cal. That should have been the first tell — Earl sending word through a side door instead of the front.`),
    N(`Duke met him in the parking lot of the physical therapy center. His left shoulder was still doing the thing. He didn't let it show.`),
    C('EARL',`I heard you were getting up and around.`),
    D(`Getting there.`),
    C('EARL',`Good. That's what I like to hear.`),
    N(`Earl didn't look at the shoulder. He was being careful not to look at it, which was its own kind of acknowledgment.`),
    C('EARL',`I've got an offer for you. I wanted to make it before someone else did.`),
    D(`You said that at the fair too.`),
    N(`Earl smiled. It was a real smile — whatever else he was, he appreciated the callback.`),
    C('EARL',`Then you already know I mean it. Forty-five percent, Duke. Given the situation.`),
  ],
  choices:[
    { label:'A', text:`"The situation doesn't change what I'm worth."`, subtext:'Hold the line. Injured or not.', effects:{ stats:{ nerve:1 } }, goto:'m2_recovery_counter' },
    { label:'B', text:`"I'm listening."`, subtext:'Let him talk. More information before you move.', effects:{}, goto:'m2_recovery_listen' },
    { label:'C', text:`"Forty-five is too high. Counter me properly."`, subtext:'Signal you know the game — even flat on your back.', effects:{ stats:{ hustle:1 } }, goto:'m2_recovery_hustle' },
  ]
},

/* --- ROUND 1: THE PERCENTAGE --- */
m2_round1: {
  art:'m2', artLabel:'Round 1 · The Number',
  bgText:'40%',
  lines:[
    C('EARL',`Forty percent. Standard arrangement for an act I'm developing from local to regional.`),
    D(`Standard for who?`),
    N(`Earl tilted his head slightly. He liked that.`),
    C('EARL',`For the twelve acts I've managed over nineteen years. Some of them did well.`),
    D(`Some of them.`),
    C('EARL',`It's a percentage, not a guarantee. You want a guarantee, go find somebody selling one.`),
    N(`Duke thought about the contract on the kitchen table. The clause on page three. The word he'd written next to it.`),
  ],
  choices:[
    { label:'A', text:`"Thirty percent. I've got other interest."`, subtext:'Bluff or leverage — same word, different meaning depending on what you have.', effects:{ stats:{ hustle:1 } }, goto:'m2_counter_30' },
    { label:'B', text:`"Thirty-five. And I want the insurance clause rewritten."`, subtext:'You read the contract. Use what you found.', effects:{ stats:{ hustle:1 } }, goto:'m2_counter_35_clause' },
    { label:'C', text:`"What have you done for those twelve acts?"`, subtext:'Make him sell you on the track record before you agree to anything.', effects:{}, goto:'m2_ask_track' },
    { label:'D', text:`"Fine. Forty percent."`, subtext:"Accept the opening. It\'s the whole pie split two ways.", effects:{}, goto:'m2_accept_40' },
  ]
},

m2_round1_pitch: {
  art:'m2', artLabel:'Round 1 · The Pitch',
  bgText:'THE PITCH',
  lines:[
    C('EARL',`The pitch. Alright.`),
    N(`He leaned back.`),
    C('EARL',`You've done county fairs. They're good for what they are — local exposure, a check, a place to work out the rough edges. I'm not going to tell you they're bad. I'm going to tell you they've got a ceiling and you can feel it.`),
    N(`Duke didn't say anything.`),
    C('EARL',`I book regional venues. Stadiums, not fields. I've got press contacts in four states and a relationship with a TV producer who's looking for exactly what you do — which is not quite a stunt show and not quite a circus act. It's a kind of performance that's harder to find than you'd think.`),
    C('EARL',`That's the pitch. The number is forty percent. Now what do you want to counter with?`),
  ],
  choices:[
    { label:'A', text:`"Thirty percent."`, subtext:'Low counter. Anchor the negotiation on your side.', effects:{ stats:{ hustle:1 } }, goto:'m2_counter_30' },
    { label:'B', text:`"Thirty-five. And we talk about the clause on page three."`, subtext:'You found the problem. Put it on the table.', effects:{ stats:{ hustle:1 } }, goto:'m2_counter_35_clause' },
    { label:'C', text:`"What happened to the twelve acts?"`, subtext:'He mentioned them twice. Make him account for them.', effects:{}, goto:'m2_ask_track' },
  ]
},

m2_round1_clause_first: {
  art:'m2', artLabel:'Round 1 · The Clause',
  bgText:'PAGE THREE',
  lines:[
    N(`Earl stopped. He looked at Duke with a different kind of attention.`),
    C('EARL',`You read the contract.`),
    D(`That's what you told me to do.`),
    C('EARL',`I did.`),
    N(`He was quiet for a moment.`),
    C('EARL',`The insurance clause is standard language.`),
    D(`"Non-approved stunt activities" isn't defined.`),
    C('EARL',`It means stunts I haven't signed off on.`),
    D(`That's what I thought it meant.`),
    N(`Earl looked at him. Then at Cal. Cal was studying the wall.`),
    C('EARL',`Alright. We can define the phrase. What does that get me on the percentage?`),
  ],
  choices:[
    { label:'A', text:`"Thirty-five percent. Defined language. We both know where we stand."`, subtext:'Clean deal. Both of you know what you signed.', effects:{ stats:{ hustle:1 } }, goto:'m2_deal_35_clean' },
    { label:'B', text:`"The clause stays undefined, you come down to thirty percent."`, subtext:'Different trade. Fewer constraints, lower cut.', effects:{ stats:{ hustle:1 } }, goto:'m2_deal_30_clause' },
    { label:'C', text:`"Define the language and leave the number where it is."`, subtext:'The clause fix matters more than the percentage. Long game.', effects:{}, goto:'m2_deal_40_defined' },
  ]
},

m2_counter_30: {
  art:'m2', artLabel:'Counter · 30%',
  bgText:'COUNTER',
  lines:[
    D(`Thirty percent.`),
    N(`Earl looked at him the way a man looks at someone who has said an entertaining thing.`),
    C('EARL',`Thirty.`),
    D(`That's right.`),
    C('EARL',`Duke. You're talented. You don't have regional bookings, press contacts, or a relationship with anyone who books stadiums. You've got a county fair and a mechanic. I appreciate both of those things. They aren't worth thirty percent.`),
    N(`Duke didn't say anything.`),
    C('EARL',`But I'll tell you what they're worth. Thirty-five. If you sit still and listen to what the clause actually says.`),
  ],
  next:'m2_round2_enter'
},

m2_counter_35_clause: {
  art:'m2', artLabel:'Counter · 35% + Clause',
  bgText:'PAGE THREE',
  lines:[
    D(`Thirty-five. And I want the insurance clause rewritten.`),
    N(`Earl was quiet for a moment. He hadn't expected both at once.`),
    C('EARL',`You read the contract.`),
    D(`Cover to cover.`),
    N(`Earl looked at Cal. Cal was looking at his hands.`),
    C('EARL',`The clause is standard language.`),
    D(`"Non-approved stunt activities" isn't defined. I need to know what you mean by that before I sign anything.`),
    C('EARL',`Fair.`),
    N(`He said it simply. No argument. Duke filed that away.`),
    C('EARL',`Thirty-seven and a half. I define the language. You keep the percentage in that range, we move forward.`),
  ],
  choices:[
    { label:'A', text:`"Thirty-five. Defined language. That's the deal."`, subtext:'Hold the line.', effects:{ stats:{ hustle:1 } }, goto:'m2_deal_35_clean' },
    { label:'B', text:`"Thirty-seven and a half works."`, subtext:'Meet in the middle. Both of you got something.', effects:{}, goto:'m2_deal_375' },
  ]
},

m2_ask_track: {
  art:'m2', artLabel:'Track Record',
  bgText:'TWELVE ACTS',
  lines:[
    D(`What happened to the twelve acts?`),
    N(`Earl looked at him.`),
    C('EARL',`Seven of them are still performing. Three retired on their own terms. One had a bad crash — nothing I booked, nothing I approved. And one quit to run his wife's family's hardware business, which I'll admit I didn't see coming.`),
    D(`That's eleven.`),
    N(`Earl smiled. It was a real one.`),
    C('EARL',`I've been waiting for you to say that.`),
    D(`What about twelve?`),
    C('EARL',`Twelve got famous enough that he didn't need me anymore. Which is what I told him when he left. And which is what I'll tell you, if that day comes.`),
    N(`Duke sat with that for a moment.`),
    C('EARL',`Now. Thirty-eight percent. Because you asked the right question and I want you to know I noticed.`),
  ],
  choices:[
    { label:'A', text:`"Thirty-five. And I want the clause looked at."`, subtext:'You got a better opening. Now close it right.', effects:{ stats:{ hustle:1 } }, goto:'m2_counter_35_clause' },
    { label:'B', text:`"Thirty-eight works. Let's talk about the clause."`, subtext:'Take the gift. Move to round two.', effects:{}, goto:'m2_round2_enter' },
    { label:'C', text:`"I appreciate the straight answer. Thirty-eight. Let's go."`, subtext:'The honesty was worth something. Acknowledge it.', effects:{ stats:{ nerve:1 } }, goto:'m2_round2_enter' },
  ]
},

m2_accept_40: {
  art:'m2', artLabel:'Accepted · 40%',
  bgText:'DEAL',
  lines:[
    D(`Fine. Forty percent.`),
    N(`Earl nodded. He wrote it down. He didn't say anything.`),
    N(`Duke had the feeling he'd given something away, but he couldn't name it precisely enough to take it back.`),
    N(`Cal, from the wall, didn't say anything either.`),
    C('EARL',`Good. Now there's one other thing I want to put in front of you.`),
  ],
  next:'m2_round2_enter'
},

m2_deal_35_clean: {
  art:'m2', artLabel:'Agreed · 35%',
  bgText:'DEFINED',
  lines:[
    C('EARL',`Thirty-five. And I'll define the phrase to mean stunts not on the approved event list, which you can add to with two weeks' notice and my written sign-off.`),
    D(`That works.`),
    N(`He wrote it down. The room was quiet in the way that rooms get quiet when something is settled.`),
    N(`Cal made a small sound that might have been approval and might have been clearing his throat.`),
    C('EARL',`There's one more thing I want to put in front of you.`),
  ],
  next:'m2_round2_enter'
},

m2_deal_375: {
  art:'m2', artLabel:'Agreed · 37.5%',
  bgText:'DEAL',
  lines:[
    D(`Thirty-seven and a half.`),
    C('EARL',`Thirty-seven and a half.`),
    N(`He wrote it down. Duke had the feeling they'd both landed somewhere neither had quite planned on, which in his experience usually meant a fair deal.`),
    C('EARL',`There's one more thing.`),
  ],
  next:'m2_round2_enter'
},

m2_deal_30_clause: {
  art:'m2', artLabel:'Counter · 30% No Def',
  bgText:'THE TERMS',
  lines:[
    N(`Earl considered that.`),
    C('EARL',`Thirty percent, clause stays general.`),
    D(`I understand what that means. You understand what I'm trading away.`),
    C('EARL',`I do. And I'm accepting it. Which means I'm betting on you not doing anything I haven't approved, and you're betting on keeping the money.`),
    N(`Duke thought about it.`),
    C('EARL',`There's something refreshing about a man who knows exactly what he's trading. Thirty percent. Done.`),
    N(`He wrote it down. Duke felt clean about it and slightly nervous at the same time. Both seemed appropriate.`),
  ],
  next:'m2_round2_enter'
},

m2_deal_40_defined: {
  art:'m2', artLabel:'Agreed · Defined Terms',
  bgText:'LANGUAGE',
  lines:[
    D(`Define the language. Leave the number where it is.`),
    N(`Earl looked at him.`),
    C('EARL',`You're not fighting the percentage.`),
    D(`I'm fighting the ambiguity. Those are different things.`),
    N(`Another pause. Then Earl nodded — once, slowly.`),
    C('EARL',`Forty percent. Defined language. Non-approved means not on the current event list, or added with written notice.`),
    D(`That's the language.`),
    C('EARL',`That's the language. Alright. There's one more thing.`),
  ],
  next:'m2_round2_enter'
},

m2_recovery_counter: {
  art:'m2', artLabel:'Recovery · Counter',
  bgText:'NOT DESPERATE',
  lines:[
    D(`The situation doesn't change what I'm worth.`),
    N(`Earl looked at him for a long moment.`),
    C('EARL',`That's not what most people say from that parking lot.`),
    D(`I'm not most people.`),
    N(`Earl smiled. Whatever else this was, he appreciated it.`),
    C('EARL',`No. You're not. Thirty-eight percent. Let's talk about what happens next.`),
  ],
  next:'m2_round2_enter'
},

m2_recovery_listen: {
  art:'m2', artLabel:'Recovery · Listening',
  bgText:'THE PITCH',
  lines:[
    D(`I'm listening.`),
    N(`Earl talked. He knew how to talk — unhurried, comprehensive, leaving enough room for Duke to ask questions without feeling crowded.`),
    C('EARL',`The recovery is a story, not just a setback. A man who comes back from something gets attention that a man who never fell doesn't. I know how to use that.`),
    D(`You want to market the crash.`),
    C('EARL',`I want to market the comeback. There's a difference.`),
    N(`Duke thought about that.`),
    C('EARL',`Forty-two percent, given the timeline of the recovery. It goes down as you perform. This is the entry point.`),
  ],
  choices:[
    { label:'A', text:`"Thirty-eight. And it doesn't go up from there."`, subtext:'Negotiate from strength, not sympathy.', effects:{ stats:{ hustle:1 } }, goto:'m2_recovery_counter' },
    { label:'B', text:`"How far does it go down?"`, subtext:'Get the specifics before you agree to anything.', effects:{ stats:{ hustle:1 } }, goto:'m2_recovery_terms' },
  ]
},

m2_recovery_hustle: {
  art:'m2', artLabel:'Recovery · Counter',
  bgText:'THE TERMS',
  lines:[
    D(`Forty-five is too high. Counter me properly.`),
    N(`Earl didn't flinch. He recalibrated, the way he did when something surprised him pleasantly.`),
    C('EARL',`Thirty-eight. Flat. No sliding scale.`),
    D(`Defined terms on the insurance clause.`),
    C('EARL',`Non-approved means not on the event list. Written notice to add.`),
    D(`That works.`),
    N(`Earl wrote it down. He almost smiled.`),
  ],
  next:'m2_round2_enter'
},

m2_recovery_terms: {
  art:'m2', artLabel:'Recovery · Sliding Scale',
  bgText:'THE TERMS',
  lines:[
    C('EARL',`It goes down one point per successful show. Floor at thirty-five. Cap at forty-two until you've done three clean shows.`),
    N(`Duke ran the math. It wasn't bad — it rewarded recovery, which was at least honest about what it was measuring.`),
    D(`Define the insurance clause.`),
    C('EARL',`Done. Non-approved means not on the event list.`),
    D(`Fine.`),
    N(`He shook Earl's hand. It was the right hand, which the shoulder didn't like. He didn't let that show.`),
  ],
  next:'m2_round2_enter'
},

m2_round1_counter_low: {
  art:'m2', artLabel:'Counter · Low Ball',
  bgText:'30%',
  lines:[
    D(`Thirty percent.`),
    C('EARL',`You made me wait ten days to come in at thirty?`),
    D(`I've been thinking.`),
    C('EARL',`Well. That's good. Thirty-six. Because you thought.`),
    N(`Duke sat with it. That was a real concession — Earl had come down four points without being pushed.`),
  ],
  choices:[
    { label:'A', text:`"Thirty-four. And the clause."`, subtext:'Keep pushing. You have leverage.', effects:{ stats:{ hustle:1 } }, goto:'m2_counter_35_clause' },
    { label:'B', text:`"Thirty-six works."`, subtext:'You got a good deal from a strong position. Take it.', effects:{}, goto:'m2_round2_enter' },
  ]
},

/* --- ROUND 2: THE CLAUSE --- */
m2_round2_enter: {
  art:'m2', artLabel:'Round 2',
  bgText:'THE CLAUSE',
  lines:[
    C('EARL',`There's a clause I want to include. Standard in my deals. I want you to hear it before we get to signing.`),
    N(`Duke waited.`),
  ],
  next:'m2_round2_clause'
},

m2_round2_clause: {
  art:'m2', artLabel:'Round 2 · The Clause',
  bgText:'THE CLAUSE',
  get lines(){
    // Clause varies by Earl relationship state
    const earl = GS.rels.earl;
    if(earl === 'mentor'){
      return [
        C('EARL',`Exclusivity. You perform with my booking or you don't perform above a certain gate. Right of first refusal, effectively.`),
        N(`Duke had half-expected this. It wasn't unreasonable — it was the kind of thing a man said when he was actually invested, not just mining a deal.`),
        C('EARL',`I put this in because I want to know what you're doing. Not to own you. To build something that makes sense.`),
        D(`What's the gate number?`),
        C('EARL',`Five hundred attendance or higher. Below that, you do what you want. Above it, you run it by me first.`),
      ];
    } else if(earl === 'backer'){
      return [
        C('EARL',`Insurance clause. Medical costs fall to you in the event of a non-approved stunt activity.`),
        N(`Duke had read this one. Page three of the preliminary contract. He had a word written next to it.`),
        C('EARL',`It's standard language in this business. Most performers don't read it.`),
        D(`I read it.`),
        N(`Earl nodded slowly.`),
        C('EARL',`I see that.`),
      ];
    } else {
      return [
        C('EARL',`Image clause. I hold approval rights on how your name and likeness are used in marketing above a regional level.`),
        N(`That one landed differently than the others. Duke kept his face still.`),
        C('EARL',`What that means practically: I approve press releases, promo materials, any merchandise that bears your name. You don't lose the name. You just run it by me first.`),
        D(`That's not a small thing.`),
        C('EARL',`No. It isn't.`),
      ];
    }
  },
  choices:[
    { label:'A', text:`"That clause doesn't work for me as written."`, subtext:'Push back. Make him revise or drop it.', effects:{ stats:{ hustle:1 } }, goto:'m2_clause_negotiate' },
    { label:'B', text:`"I can live with it."`, subtext:"Accept. It\'s the cost of the deal.", effects:{}, goto:'m2_round3_enter' },
    { label:'C', text:`"That's a deal-breaker."`, subtext:'Draw the line. See if he flinches.', effects:{ stats:{ nerve:1 } }, goto:'m2_clause_walkaway' },
  ]
},

m2_clause_negotiate: {
  art:'m2', artLabel:'Negotiate · The Clause',
  bgText:'REVISE IT',
  lines:[
    N(`He laid out the problem. Earl listened. Cal was still studying the wall.`),
    C('EARL',`What do you want instead?`),
    N(`Duke had thought about this during the wait. He had an answer.`),
    D(`A time limit. Eighteen months. After that, we renegotiate the clause or it lapses.`),
    N(`Earl looked at him.`),
    C('EARL',`Twelve months.`),
    D(`Fifteen.`),
    C('EARL',`Done.`),
    N(`He wrote it down. Just like that. Duke thought: he expected that. He'd built room for it. That meant the clause wasn't the thing he actually cared about most.`),
    N(`He filed that thought away.`),
  ],
  next:'m2_round3_enter'
},

m2_clause_walkaway: {
  art:'m2', artLabel:'Walkaway',
  bgText:'THE LINE',
  lines:[
    C('EARL',`That's your call to make.`),
    N(`He didn't argue. He picked up his pen and made a small note on his own copy of the document.`),
    C('EARL',`I'll tell you what I'll do. Drop the clause entirely. Percentage goes to forty-two.`),
    N(`Duke thought about it.`),
    N(`Without the clause, he had clean rights over his own name and image for the life of the deal. The extra two percent on the percentage was Earl buying that back from him at a price he was deciding right now.`),
  ],
  choices:[
    { label:'A', text:`"Drop the clause. I'll live with forty-two."`, subtext:'Clean rights are worth the extra two points.', effects:{}, goto:'m2_round3_enter' },
    { label:'B', text:`"Drop the clause. Percentage stays where it is."`, subtext:"Don\'t let him buy back what he was asking you to give away.", effects:{ stats:{ hustle:1 } }, goto:'m2_walkaway_hold' },
  ]
},

m2_walkaway_hold: {
  art:'m2', artLabel:'Hold the Line',
  bgText:'FIRM',
  lines:[
    N(`Earl looked at him for a long moment.`),
    C('EARL',`You know what you're doing.`),
    D(`I read the contract.`),
    C('EARL',`Drop the clause. Percentage stays. Deal.`),
    N(`He wrote it down. Duke had the feeling he'd just won something he didn't fully understand yet.`),
    N(`He'd understand it later.`),
  ],
  next:'m2_round3_enter'
},

/* --- ROUND 3: THE HANDSHAKE --- */
m2_round3_enter: {
  art:'m2', artLabel:'Round 3',
  bgText:'HANDSHAKE',
  lines:[
    C('EARL',`We're close. One more thing before we shake on it.`),
    N(`He put his pen down. That was the tell — pen down meant what came next was personal, not business.`),
    C('EARL',`I've made twelve men famous. I want to make you the thirteenth. But I want you to know something: I'm not doing this out of generosity. I think you're going to make me money. I think you know that.`),
    D(`I know that.`),
    C('EARL',`Good. Then we're starting honest, which is better than most.`),
  ],
  next:'m2_round3_cal'
},

m2_round3_cal: {
  art:'m2', artLabel:'Round 3 · Cal',
  bgText:'THE TELL',
  get lines(){
    const calState = GS.rels.cal;
    if(calState === 'poached'){
      return [
        N(`Cal was on the wrong side of the table. That was the simple version of it.`),
        N(`Earl leaned over and said something to his assistant. Duke saw the folder — it had Cal's name on a tab. Earl had done his homework, and the homework included the mechanic.`),
        C('EARL',`Your man has good instincts about suspension geometry. He mentioned it when we spoke.`),
        N(`He hadn't known they'd spoken. The number Cal had given Earl — Duke's weight distribution preference, his approach angle bias — were small things that added up to a picture.`),
        N(`He felt it in his chest: not betrayal exactly. Cal had made a calculation. Duke would figure out what it meant later.`),
      ];
    } else {
      return [
        N(`Cal stepped forward. He didn't speak loudly. He spoke toward Duke, not at Earl.`),
        C('CAL',`He tapped his pen three times before he wrote down the thirty-seven. First two numbers, third offer.`),
        N(`Duke looked at him.`),
        C('CAL',`He's got a tell. Three taps. He did it every time he was going to move.`),
        N(`He stepped back. Earl had heard it. Earl was looking at Cal with something that was almost respect.`),
        C('EARL',`Your mechanic watches things.`),
        D(`That's why he's in the contract.`),
      ];
    }
  },
  choices:[
    { label:'A', text:`Accept and shake.`, subtext:"You\'ve heard what you need to hear. Sign the deal.", effects:{ stats:{ hustle:1 }, rels:{ earl:'backer' }, flags:{ m2Complete:true } }, goto:'m2_sign' },
    { label:'B', text:`"One more thing before we shake."`, subtext:'Cal gave you something. Use it.', effects:{ stats:{ hustle:1 } }, goto:'m2_use_tell' },
  ]
},

m2_use_tell: {
  art:'m2', artLabel:'Using the Tell',
  bgText:'THREE TAPS',
  lines:[
    N(`Duke looked at Earl.`),
    D(`You've got room to move on this.`),
    C('EARL',`On what specifically?`),
    D(`On whatever you were going to ask me to accept next.`),
    N(`Earl was quiet. He looked at Cal again. Cal had gone back to studying the wall.`),
    C('EARL',`I was going to ask for approval rights on the first three shows. Venue selection.`),
    D(`Drop it.`),
    C('EARL',`...Alright.`),
    N(`He wrote something. Crossed something out. Wrote something else.`),
    C('EARL',`You've got a good team.`),
    D(`Yeah. I do.`),
  ],
  next:'m2_sign'
},

m2_sign: {
  art:'m2', artLabel:'The Signing',
  bgText:'SIGNED',
  lines:[
    N(`Earl extended his hand. Duke shook it.`),
    C('EARL',`Welcome to the bigger world, son.`),
    N(`He'd said it simply. Duke heard the word — *son* — and filed it.`),
    N(`Cal didn't say anything. He picked up his jacket from the back of the chair. That was his version of congratulations.`),
    N(`The drive home was quiet. Duke thought about the percentage and the clause and the tell and the way Earl had said *son* like it was a thing he meant.`),
    N(`He thought: there's a version of this where that's true. He thought: there's a version where it isn't.`),
    N(`He didn't know which one yet. He was about to find out.`),
  ],
  // The two flags here used to sit on one choice — "Accept and shake" at
  // m2_round3_cal — so a run that used Cal's tell instead reached the ending
  // with rels.earl still 'unknown' after signing a contract with the man:
  // no Earl row on the ending screen, none of the `backer` epilogue, and
  // `m2Complete` false, which is what currentHubRoute() reads to know it is
  // in Free Roam 2. They belong on the signing, which is the one scene every
  // backer path passes through (Phase 2).
  statUpdate:{
    title:'The Deal Is Signed',
    reason:'Earl Maddox. Percentage settled. Cal in the room. The bigger world starts Thursday.',
    deltas:{ showmanship:1 },
    rels:{ earl:'backer' },
    flags:{ m2Complete:true }
  },
  next:'fr2_hub_open'
},

/* ============================================================
   MILESTONE 2 — SOLO. The backer-less middle game (Phase 1, shape B).
   Reached only from _chapter_m2 when GS.rels.earl === 'absent': the
   player said "Not interested" at the fair and nothing since has
   changed that. The same three-round shape as the negotiation above —
   a promoter, a bank, and Duke's own arithmetic — and it ends where
   m2_sign ends, at fr2_hub_open, so Free Roam 2 opens on the same scene.
   Every line that depends on state is a function; nothing here joins
   patchDynamicScenes().
   ============================================================ */
m2_solo_entry: {
  art:'m2', artLabel:'Milestone 2 · Solo',
  bgText:'NO CONTRACT',
  lines:[
    N(`There was no office. There was the kitchen table, the notebook, and the card Earl had left on the ramp, which was in the drawer under the phone book because throwing it away had felt like a statement and keeping it out had felt like another one.`),
    N(()=> GS.flags.stuntOutcome === 'crash_bad'
      ? `His left shoulder still did the thing when he reached across himself. He'd stopped mentioning it. Nobody was sending a card through Cal about it, either, because nobody was sending anything.`
      : `Three weeks since the fair. The phone had rung twice. Once was Tommy. Once was a man selling aluminum siding.`),
    N(()=> GS.flags.perkinsBooking === 'booked'
      ? `Lloyd Perkins had next August in writing — $${GS.flags.perkinsFee || 120} and a name in the program. August was eleven months off. Eleven months was a long time to be a marquee act with no marquee.`
      : GS.flags.perkinsBooking === 'declined'
      ? `He'd told Lloyd Perkins he'd pass for now, to keep the table clean for a conversation he had then ended in two words. The table was clean. There was nothing on it.`
      : `Lloyd Perkins had said something about next August, back at the fair, and Duke had never followed up. It was the only lead he had that came with a phone number.`),
    N(`He'd made ninety dollars at the fair. He had the truck, the bike, a trailer with one bad tire, and a mechanic who had not asked once what the plan was, which meant he was waiting to be told.`),
    N(`Cal came by at seven. He sat down across the table and looked at the notebook upside down.`),
    C('CAL',`What's that?`),
    D(`A list.`),
    C('CAL',`Of what?`),
    D(`People who book things.`),
    N(`Cal read it upside down. It was not a long list.`),
    C('CAL',`Maddox would've made these calls.`),
    D(`Maddox would've taken forty percent to make these calls.`),
    C('CAL',`I'm not arguing. I'm saying it's the trade.`),
    N(`He thought: three calls. A man who books rooms, a man who lends money, and the arithmetic. He thought: nobody makes them for you. That was the whole idea.`),
  ],
  next:'m2_solo_round1'
},

/* --- SOLO ROUND 1: THE PROMOTER --- */
m2_solo_round1: {
  art:'m2', artLabel:'Solo · Round 1 · The Promoter',
  bgText:'THE ROOMS',
  lines:[
    N(()=> GS.flags.perkinsBooking === 'declined'
      ? `Perkins took the call like a man who had once written "difficult" on a clipboard and was now being proven right. He didn't say so. He let Duke get all the way through the sentence.`
      : `Perkins took the call on the second ring. He had the clipboard voice on before Duke finished saying his name.`),
    C('ORGANIZER',()=> GS.flags.perkinsBooking === 'declined'
      ? `Changed your mind about August, then.`
      : `Mr. Harlan. August is still August. What can I do for you?`),
    D(()=> GS.flags.perkinsBooking === 'declined' ? `About August. And about between now and August.` : `I need between now and August.`),
    N(`A pause with paper in it.`),
    C('ORGANIZER',`I book one fair. I know the people who book the others. That's a different thing from being able to book them for you.`),
    D(`I know the difference.`),
    C('ORGANIZER',`Alright. Here's what there is. Tri-County runs a Saturday program through October — fifty, sixty dollars a show, gravel lots, they'll want the cows. And there's the Smithson Speedway. Dot Kessler runs a Friday night card there and she's been asking me who the motorcycle was. She doesn't pay a fee. She pays a cut of the gate, and if it rains you drive home with nothing.`),
    N(`He thought: Earl would have had the Speedway on the phone before the sentence was over. He thought: Earl would also have had the gate.`),
  ],
  choices:[
    { label:'A', text:`"Make the Tri-County calls. I'll take the Saturdays."`, subtext:'Small, steady, and somebody else dials. He will want something for it.', effects:{}, goto:'m2_solo_perkins_calls' },
    { label:'B', text:`"Give me the names. I'll call them myself."`, subtext:'No middleman. You get talked down by strangers instead of friends.', effects:{ stats:{ hustle:1 } }, goto:'m2_solo_perkins_names' },
    { label:'C', text:`"Give me Dot Kessler's number."`, subtext:'The bigger room. A cut of the gate, and nothing if it rains.', effects:{ stats:{ nerve:1 } }, goto:'m2_solo_kessler' },
  ]
},

m2_solo_perkins_calls: {
  art:'m2', artLabel:'Solo · Perkins Dials',
  bgText:'SATURDAYS',
  lines:[
    D(`Make the calls. I'll take the Saturdays.`),
    C('ORGANIZER',`I can do that.`),
    N(`He could. It took him four days and he came back with six Saturdays at fifty-five dollars, the cows, a lot in Tri-County that was mostly gravel, and one condition.`),
    C('ORGANIZER',()=> GS.flags.perkinsBooking === 'booked'
      ? `August stays where it is. Same number we agreed. I don't want to hear about a bigger offer in July.`
      : `August. Marquee, a hundred and twenty, and I don't want to hear about a bigger offer in July.`),
    D(`Done.`),
    N(`No percentage. No paper past a handshake. Six Saturdays that added up to three hundred and thirty dollars if it didn't rain on any of them, and a man who now felt, correctly, that Duke owed him one.`),
    N(`He thought: that's the shape of it without Earl. Smaller numbers, and you can count the people you owe on one hand.`),
  ],
  statUpdate:{ title:'Six Saturdays', reason:'Perkins dialed. Fifty-five a show, the cows, and August locked. You owe him one.', deltas:{}, flags:{ soloCircuit:'perkins', perkinsBooking:'booked' } },
  next:'m2_solo_round2_enter'
},

m2_solo_perkins_names: {
  art:'m2', artLabel:'Solo · Your Own Voice',
  bgText:'THE PAY PHONE',
  lines:[
    D(`Give me the names. I'll call them myself.`),
    N(`Perkins gave him the names. He gave them a little slowly, the way a man hands over something he thinks you're going to drop.`),
    N(`Duke made the calls from the pay phone outside the auto parts store, because the kitchen phone was a party line and the woman two houses down had opinions about motorcycles.`),
    N(`Tri-County offered sixty. He asked for seventy-five and got sixty. A fair in the next county over offered forty-five and a place to park the trailer, and when he asked for more the man said "Son, I don't know who you are," which was accurate.`),
    N(`He got five dates. He wrote each one down with the number next to it. Two hundred and eighty-five dollars, if it didn't rain.`),
    N(`He thought: Earl gets seventy-five where I get sixty, and he gets it in one call. He thought: Earl also keeps thirty of it. He did that arithmetic twice and it came out the same both times, which was the annoying part.`),
  ],
  statUpdate:{ title:'Five Dates, Your Voice', reason:'Talked down by strangers. Two hundred and eighty-five dollars nobody takes a cut of.', deltas:{}, flags:{ soloCircuit:'self' } },
  next:'m2_solo_round2_enter'
},

m2_solo_kessler: {
  art:'m2', artLabel:'Solo · Dot Kessler',
  bgText:'THE GATE',
  lines:[
    D(`Give me Dot Kessler's number.`),
    N(`Perkins gave it to him and said "she's direct" in the tone of a man who had been on the receiving end.`),
    N(`She was. She met him in the Speedway's ticket booth, which was where she did business because it had the only working heater.`),
    C('KESSLER',`Perkins says you jumped three cows and a man in a hat tried to buy you.`),
    D(`That's about the size of it.`),
    C('KESSLER',`I don't buy anybody. I've got a Friday night card, a grandstand that holds nineteen hundred, and a gate that averages eleven. You go on between the modifieds and the feature. Twelve percent of the gate.`),
    D(`Fifteen.`),
    C('KESSLER',`Twelve. You're not the reason they're here yet. Be the reason and we'll talk.`),
    N(`Twelve percent of eleven hundred people at a dollar and a half was a hundred and ninety-eight dollars on a good Friday and nothing on a wet one. She said the last part herself so he wouldn't have to.`),
    C('KESSLER',`No fee. No advance. I don't hold your money and I don't hold your leash. You want somebody to do either of those, Perkins says you already met him.`),
    N(`He thought: that's the opposite of the man in the hat. He thought: it's also nothing at all if it rains.`),
    D(`Fridays. Twelve percent.`),
    C('KESSLER',`Bring your own cows.`),
  ],
  statUpdate:{ title:'Twelve Percent of Whatever Shows Up', reason:'The Speedway. No fee, no advance, no leash. Bring your own cows.', deltas:{}, flags:{ soloCircuit:'speedway' } },
  next:'m2_solo_round2_enter'
},

/* --- SOLO ROUND 2: THE BANK --- */
m2_solo_round2_enter: {
  art:'m2', artLabel:'Solo · Round 2',
  bgText:'THE BANK',
  lines:[
    N(`Dates were one problem. The dates cost money before they paid any. A second set of ramps, because the ones he had did not travel. The trailer tire. Gas to Tri-County and back six times. Cal's parts invoice, which Cal had not mentioned, which was how Duke knew it was overdue.`),
    N(`He added it up. Four hundred and ten dollars he did not have, needed by a Saturday he already had booked.`),
    N(`He thought: this is the part Earl's forty percent was for. Not the calls. This.`),
  ],
  next:'m2_solo_round2'
},

m2_solo_round2: {
  art:'m2', artLabel:'Solo · Round 2 · The Bank',
  bgText:'COLLATERAL',
  lines:[
    N(`The loan officer at Buford County Savings was a man named Garrett Pyle, who had grown up two streets over from Duke and had last spoken to him at a funeral five years ago.`),
    N(`He looked at the application the way he would have looked at a motorcycle parked in his lobby.`),
    C('PYLE',`Four hundred and ten dollars.`),
    D(`That's right.`),
    C('PYLE',`For ramps.`),
    D(`And a tire.`),
    C('PYLE',`Who's behind you on this? Is there a promoter? A sponsor?`),
    D(`No.`),
    N(`Pyle wrote that down. Duke watched him write it. It was one word and it took him a while.`),
    C('PYLE',`Then it's a personal note and I need collateral or a co-signer. Bank policy. I'm not being difficult.`),
    N(`He was being a little difficult. He was also right, which was worse.`),
  ],
  choices:[
    // Phase 6: the monthly number goes on the CHOICE, not on the scene's
    // `statUpdate`. A scene reached by a choice fires its statUpdate twice —
    // the standing-backlog double-apply, frozen in `smoke-save.mjs` — and the
    // doubling is invisible for a flag or a relationship write and is not for
    // an accumulating number. The first version of this put it on the update
    // and the solo transcripts came out at seventy-four dollars a month
    // against a prose line that says thirty-seven.
    { label:'A', text:`"The equipment. The bike, the truck, the trailer."`, subtext:'Put up everything you own. Twelve months, eight percent, real.', effects:{ owePerMonth: monthlyOn(SOLO_LOAN) }, goto:'m2_solo_bank_collateral' },
    { label:'B', text:`"Forget the note. I'll do it on cash."`, subtext:'Walk out with nothing but your own name. Then make the math work.', effects:{ stats:{ hustle:1 } }, goto:'m2_solo_bank_walk' },
    { label:'C', text:`"Tommy'll co-sign."`, subtext:"He would. He\'ll never mention it. You\'ll both know.", effects:{ owePerMonth: monthlyOn(SOLO_LOAN) }, goto:'m2_solo_bank_tommy' },
  ]
},

m2_solo_bank_collateral: {
  art:'m2', artLabel:'Solo · Paper on the Bike',
  bgText:'EIGHT PERCENT',
  lines:[
    D(`The equipment. The bike, the truck, the trailer.`),
    C('PYLE',`A motorcycle. A truck with — how many miles?`),
    D(`A lot.`),
    C('PYLE',`And a trailer with a bad tire, against which you are borrowing money to fix the tire.`),
    D(`That's the shape of it.`),
    N(`Pyle looked at him for a long moment. Then he did the thing Duke had not expected, which was laugh, once, and approve it.`),
    C('PYLE',`Four hundred and ten. Twelve months. Eight percent. If you go off a ramp wrong, this bank owns a motorcycle it does not want.`),
    D(`Then I won't.`),
    N(`The monthly number was thirty-seven dollars. He wrote it in the notebook on its own page. It was the first number in there that was going to arrive whether he did or not.`),
  ],
  // The monthly number has been in this scene's prose since Phase 1 — "It was
  // the first number in there that was going to arrive whether he did or not"
  // — and nothing held it. It comes off every later hub's take now (Phase 6),
  // written by the choice that leads here rather than by this update.
  statUpdate:{ title:'Paper on the Bike', reason:'Thirty-seven dollars a month, twelve times, rain or not. Pyle owns the downside now.', deltas:{}, flags:{ soloBank:'collateral' } },
  next:'m2_solo_round3'
},

m2_solo_bank_walk: {
  art:'m2', artLabel:'Solo · On Cash',
  bgText:'NO NOTE',
  lines:[
    D(`Forget the note. I'll do it on cash.`),
    C('PYLE',`You don't have the cash. That's why you're here.`),
    D(`I'll have it.`),
    N(`He got up. Pyle didn't. Pyle looked, briefly, like a man who wanted to say something that wasn't bank policy, and then didn't.`),
    C('PYLE',`The offer stands if you change your mind. Collateral or a co-signer.`),
    D(`I know where you are.`),
    N(`He built the second set of ramps out of the first set and two sheets of three-quarter plywood from the lumber yard, on credit, which was a loan by another name and he knew it. Cal welded the frame and did not send an invoice for the welding, which was another one.`),
    N(`The tire he bought used. It was fine. It was fine for about five weeks.`),
    N(`He thought: nobody holds paper on the bike. He thought: four people hold something smaller instead, and none of them wrote it down, and that is not the same thing as free.`),
  ],
  statUpdate:{ title:'On Cash', reason:'No note. Plywood on credit, a used tire, and favors nobody wrote down.', deltas:{}, flags:{ soloBank:'none' } },
  next:'m2_solo_round3'
},

m2_solo_bank_tommy: {
  art:'m2', artLabel:'Solo · A Second Name',
  bgText:'CO-SIGNED',
  lines:[
    D(`Tommy'll co-sign.`),
    N(`Tommy co-signed. He did it on his lunch break from the lot job, in work boots, and he read the whole form, which Duke had not expected, and then signed it without asking a single question, which he had.`),
    C('TOMMY',`That it?`),
    D(`That's it.`),
    C('TOMMY',`Alright. I've got to get back.`),
    N(`He went. Pyle stamped the thing. Four hundred and ten dollars, twelve months, eight percent, and a second name under Duke's that would be there for a year whether either of them thought about it or not.`),
    N(`At the bar that weekend Tommy did not mention it. He did not mention it so carefully that it was in the room the whole time, sitting between them like a third glass.`),
    N(`He thought: Earl would have held the number. Tommy's holding it instead, and Tommy will never say so, and that's worse in a way he couldn't have explained to Pyle.`),
  ],
  statUpdate:{ title:'A Second Name', reason:"Tommy co-signed in his work boots and read the whole form. He'll never mention it.", deltas:{}, flags:{ soloBank:'tommy' } },
  next:'m2_solo_round3'
},

/* --- SOLO ROUND 3: THE ARITHMETIC --- */
m2_solo_round3: {
  art:'m2', artLabel:'Solo · Round 3 · The Arithmetic',
  bgText:'THE MATH',
  lines:[
    N(`Round three was at the garage, because that was where the calculator was. It was Cal's and it had grease in the keys.`),
    N(()=> GS.flags.soloCircuit === 'speedway'
      ? `Twelve percent of a Friday gate that averaged eleven hundred. Perkins in August. The cows, the gas, the tire.`
      : GS.flags.soloCircuit === 'self'
      ? `Five dates at his own numbers. Perkins in August, maybe. The cows, the gas, the tire.`
      : `Six Saturdays at fifty-five. Perkins in August. The cows, the gas, the tire.`),
    N(()=> GS.flags.soloBank === 'collateral'
      ? `Thirty-seven dollars a month to Pyle, on its own line, underlined.`
      : GS.flags.soloBank === 'tommy'
      ? `Thirty-seven dollars a month to Pyle, on its own line, with Tommy's name next to it in Duke's handwriting because it had felt wrong to leave it off.`
      : `No line for the bank. Four favors that didn't fit on a line.`),
    N(`It came out ahead. Barely. It came out ahead the way a man comes out ahead of a dog that has stopped chasing him.`),
    N(`Cal looked at the page for a while.`),
    C('CAL',`There's no line for when you go down.`),
    D(`I'm not going down.`),
    C('CAL',`Everybody's not going down. Maddox had a clause for it. Page three. You'd have hated it and it would've paid the hospital.`),
    N(`That was true. Duke had not read the contract, because he had not taken the contract, and Cal knew that, and had read it anyway, because somebody should.`),
    D(`What's the number?`),
    C('CAL',`For a bad one? More than everything on that page.`),
    N(`He thought: that's the trade. Nobody takes forty percent. Nobody catches you, either.`),
    N(`Then Cal said the other thing, the thing he'd come to say.`),
    C('CAL',()=> GS.flags.soloCircuit === 'speedway'
      ? `Kessler's people were asking about a car show. Season closer at the Speedway. Five cars. Somebody's got to buy the cars.`
      : `Perkins says the Speedway's doing a car show for the season closer. Five cars. They asked him who the motorcycle was. Somebody's got to buy the cars.`),
  ],
  choices:[
    { label:'A', text:`"We don't book the cars until we can pay for the cars."`, subtext:'Slow. Cows all fall; the car show when the page says so.', effects:{ stats:{ precision:1 } }, goto:'m2_solo_plan_slow' },
    { label:'B', text:`"Book it. I'll find the money when it's due."`, subtext:'Fast. Five cars on a page that barely holds three cows.', effects:{ stats:{ nerve:1 } }, goto:'m2_solo_plan_fast' },
  ]
},

m2_solo_plan_slow: {
  art:'m2', artLabel:'Solo · The Slow Page',
  bgText:'WHEN THE PAGE SAYS',
  lines:[
    D(`We don't book the cars until we can pay for the cars.`),
    C('CAL',`Alright.`),
    N(`He said it the way he said everything he agreed with, which was exactly the way he said everything he didn't.`),
    N(`Duke wrote it at the bottom of the page. Cows through October. Cars when the page says cars.`),
    N(`He thought: this is what it looks like when nobody's pushing. He thought: it looks slow. He thought: it looks like mine.`),
  ],
  statUpdate:{ title:'Cars When the Page Says Cars', reason:'Slow, and yours. Cows through October.', deltas:{}, flags:{ soloPlan:'slow' } },
  next:'m2_solo_close'
},

m2_solo_plan_fast: {
  art:'m2', artLabel:'Solo · Booked Anyway',
  bgText:'FIND IT',
  lines:[
    D(`Book it. I'll find the money when it's due.`),
    N(`Cal didn't say anything for long enough that it counted as saying something.`),
    C('CAL',`That's a Maddox sentence.`),
    D(`Maddox would've found it by now.`),
    C('CAL',`Maddox would've *had* it by now. Different thing.`),
    N(`Duke wrote it at the bottom of the page anyway. Season closer. Five cars. A number he didn't have next to a date he did.`),
    N(`He thought: that's the whole difference, right there in Cal's grammar. Had it. Find it.`),
  ],
  statUpdate:{ title:'Booked It Anyway', reason:'Five cars on a page that barely holds three cows. Cal called it a Maddox sentence.', deltas:{}, flags:{ soloPlan:'fast' } },
  next:'m2_solo_close'
},

m2_solo_close: {
  art:'m2', artLabel:'Solo · No Signature',
  bgText:'NOBODY\'S',
  lines:[
    N(`There was no handshake, because there was nobody to shake with. Cal turned the calculator off and put it back in the drawer with the feeler gauges.`),
    N(`The drive home was quiet. Duke thought about the page — the dates, the thirty-seven dollars or the favors, the line Cal had said wasn't there.`),
    N(`He thought: nobody called him *son* tonight. He thought: nobody's going to.`),
    N(`He didn't know yet whether that was the good version or the other one. He was about to find out.`),
  ],
  statUpdate:{
    title:'No Deal Signed',
    reason:'Nobody holds a percentage. Nobody makes the calls, either. The bigger world starts Saturday, if you can get there.',
    deltas:{ hustle:1 },
    rels:{},
    flags:{ m2Complete:true }
  },
  next:'fr2_hub_open'
},

/* ============================================================
   FREE ROAM 2 — HUB OPEN
   ============================================================ */
fr2_hub_open: {
  art:'fr2', artLabel:'Free Roam 2',
  bgText:'BUILDING THE ACT',
  lines:[
    N(`The shows got bigger. Not dramatically — not overnight — but in the way things actually grow, which is incrementally and without announcement until you look back and the county fair is a different category of thing from where you are now.`),
    N(()=> GS.rels.earl === 'absent'
      ? `Nobody called about dates. Duke made the calls himself, from the pay phone outside the auto parts store, and wrote what he got in a notebook he kept in the truck. Cal had opinions about the suspension, which turned out to be the right opinions, as Cal's opinions about mechanical things always did.`
      : `Earl's people called about dates. Duke wrote them down in a notebook he kept in the truck. Cal had opinions about the suspension, which turned out to be the right opinions, as Cal's opinions about mechanical things always did.`),
    N(`There was more to do than there used to be. That was the simple version.`),
  ],
  next:'_hub_fr2'
},

/* --- FR2 EVENING SCENES --- */
fr2_eve_cal: {
  art:'fr2', artLabel:'Evening · Cal',
  bgText:'THE GARAGE',
  _isEvening:true,
  lines:[
    N(()=> GS.rels.earl === 'absent'
      ? `Cal had said "come by this week" the night they did the arithmetic. Duke came by on Thursday.`
      : `Cal had said "come by this week" the night of the signing. Duke came by on Thursday.`),
    N(`The garage smelled the same as it always had — oil and cold concrete and something electrical that Cal could never quite locate the source of. The bike was up on the stand.`),
    C('CAL',`Left fork seal's been weeping since the fair.`),
    D(`I know.`),
    C('CAL',`You didn't know. You noticed it felt different and you compensated.`),
    N(`That was an accurate distinction.`),
    C('CAL',`Shows are getting bigger. Bigger show, longer haul, more vibration. The whole suspension geometry needs a conversation.`),
    D(`Can we have that conversation?`),
    C('CAL',`We're having it.`),
    N(`He handed Duke a sketch on the back of an invoice — measurements, load tolerances, a note in the margin that said: *clearance — don't go wider than this.*`),
    C('CAL',()=> GS.rels.earl === 'absent'
      ? `One other thing. Somebody with money's going to show up again. When they do, they're going to want input on the bike setup.`
      : `One other thing. Earl's people are going to want input on the bike setup eventually.`),
    D(`What do you say when that happens?`),
    C('CAL',`I say the bike does what it does or it doesn't work at all.`),
    N(()=> GS.rels.earl === 'absent'
      ? `He picked up a wrench. That was the end of the conversation about money.`
      : `He picked up a wrench. That was the end of the conversation about Earl.`),
  ],
  statUpdate:{ title:'The Suspension Talk', reason:'Cal already fixed the seal. He\'s telling you why. That\'s the difference.', deltas:{ precision:1 }, _isEvening:true },
  next:'_hub_fr2'
},

fr2_eve_ruthie: {
  art:'fr2', artLabel:'Evening · Ruthie',
  bgText:'HOME',
  _isEvening:true,
  lines:[
    N(`Earl had booked a show three hours away. Bigger venue, better money, a reporter from the regional paper. Duke mentioned it over dinner.`),
    C('RUTHIE',`How long are you gone?`),
    D(`Three days. Maybe four.`),
    C('RUTHIE',`Okay.`),
    N(`She said it simply. He waited for more and it didn't come.`),
    D(`You can come.`),
    C('RUTHIE',`I've got work.`),
    D(`I know.`),
    C('RUTHIE',`Ask me the next one.`),
    N(`He looked at her.`),
    D(`You want to come to a show.`),
    C('RUTHIE',`I want to come to *a* show. I don't need to come to all of them.`),
    N(`He hadn't thought about it that way. He wasn't sure why.`),
    C('RUTHIE',`Find the right show. I'll be there.`),
  ],
  statUpdate:{ title:'An Evening at Home', reason:'She\'s steady. That matters more than you say out loud.', deltas:{ nerve:1 }, _isEvening:true },
  next:'_hub_fr2'
},

fr2_eve_practice: {
  art:'fr2', artLabel:'Evening · Practice',
  bgText:'NEW DISTANCES',
  _isEvening:true,
  lines:[
    N(`He set up a longer approach. Not a different stunt — just more runway, which changed the math in ways that weren't entirely about distance.`),
    N(`He ran it six times. The first three were an argument with the approach. The last three were a conversation with it.`),
    N(()=> GS.rels.earl === 'absent'
      ? `He thought about the car show on his own page. Five cars, if the page ever said cars. He'd jumped three cows. The geometry was different in ways he needed to understand before the day of.`
      : `He thought about the car show on Earl's calendar. Five cars. He'd jumped three cows. The geometry was different in ways he needed to understand before the day of.`),
    N(`He worked until the light went and then a little past that.`),
  ],
  statUpdate:{ title:'New Distances', reason:'The cows were a county fair. This is something else. Better to know that now.', deltas:{ precision:1, nerve:1 }, _isEvening:true },
  next:'_hub_fr2'
},

fr2_eve_bar: {
  art:'fr2', artLabel:'Evening · Bar',
  bgText:'THE BAR',
  _isEvening:true,
  lines:[
    N(`Tommy had a theory about Diamondback Danny.`),
    C('TOMMY',`He's going to end up on TV.`),
    D(`Maybe.`),
    C('TOMMY',`He's got the look. The name. The name especially — "Diamondback Danny." You can't compete with that from a naming standpoint.`),
    D(`Duke Harlan's not a bad name.`),
    C('TOMMY',`Duke Harlan's a solid name. Diamondback Danny is a *television* name.`),
    N(`Duke let that sit.`),
    C('TOMMY',`I'm just saying. He's going to move faster than you think.`),
    D(`You think that bothers me.`),
    C('TOMMY',`I think it should. Because if you're not paying attention to who's behind you, you'll be the guy they tell stories about at the next guy's show.`),
    N(`It was the smartest thing Tommy had said in a while. Duke let it land without commenting.`),
    // Phase 4's `no_danny` sweep. A run that answered "Doesn't matter, I've got
    // my own show" at the fair never went and looked at Danny's ramp, so it
    // cannot have a fire trick to remember. Tommy's theory it can have — Tommy
    // talks about Danny whether Duke has met him or not.
    N(()=> isPresent('danny', GS.rels)
      ? `On the walk home he thought about Danny's setup at the fair. The fire trick.`
      : `On the walk home he thought about the one thing Tommy had said that he could use, which was that a show is a thing people describe to each other afterwards.`),
    N(`He thought: *fire's a good idea. I should think about fire.*`),
    N(`He also thought about the car show in October, and the forty minutes before the gate that nobody was going to fill.`),
  ],
  // Phase 4. The second half of Tommy's track: the Free Roam 1 bar night is
  // what makes the first answer here exist at all — without `tommyAsked` Duke
  // does not know there is a lot out past the grain elevator, and the only
  // thing on the board is the version of the evening where Tommy is an
  // audience. This is the one place in the game that writes `tommy: 'ally'`
  // before Free Roam 3.
  choices:[
    { label:'A', text:`"Do the warm-up at the car show."`,
      subtext:'Forty minutes before the gate. His name on the handbill.',
      _requires:()=> !!GS.flags.tommyAsked,
      effects:{ stats:{ showmanship:1, condition:-1 } },
      goto:'fr2_eve_bar_hinkle' },
    { label:'B', text:`"He's not behind me. He's beside me."`,
      subtext:'Keep it about Danny. That is what the evening was about.',
      effects:{ stats:{ showmanship:1, condition:-1 } },
      goto:'fr2_eve_bar_danny' },
  ]
},
fr2_eve_bar_hinkle: {
  art:'fr2', artLabel:'Evening · Bar',
  bgText:'FORTY MINUTES',
  _isEvening:true,
  lines:[
    D(`The car show in October. There's forty minutes before the gate and nothing in it.`),
    C('TOMMY',`So?`),
    D(`So do the warm-up.`),
    N(`Tommy laughed. Then he stopped laughing, because Duke had not.`),
    C('TOMMY',`Two cars off a plank ramp.`),
    D(`Two cars off a plank ramp, in front of eleven hundred people, with your name on the handbill.`),
    C('TOMMY',`My name.`),
    D(`Your name. On the handbill, under mine.`),
    N(`Tommy looked at the bar for a while. When he looked up he had the expression of a man doing arithmetic he had never been allowed to do before.`),
    C('TOMMY',`I'd need the ramp built by September.`),
    D(`Then build it by September.`),
    N(`Duke thought: he has been in every crowd I have ever had. He thought: that is not the same as being in this.`),
  ],
  statUpdate:{
    title:'Night at the Bar',
    reason:"Forty minutes and a handbill. He stopped being somebody who watches.",
    deltas:{},
    rels:{ tommy:'ally' },
    _isEvening:true,
  },
  next:'_hub_fr2'
},
fr2_eve_bar_danny: {
  art:'fr2', artLabel:'Evening · Bar',
  bgText:'THE BAR',
  _isEvening:true,
  lines:[
    D(`He's not behind me. He's beside me. That's a different problem.`),
    C('TOMMY',`Is it?`),
    D(`It's the one I can do something about.`),
    N(`Tommy accepted this, or at least stopped arguing with it, which with Tommy was the same transaction.`),
    N(`They closed the place out talking about fire, and ramps, and a man in Larkin with a flatbed. Tommy paid for the last round, which he did about a third of the time and never mentioned either way.`),
  ],
  statUpdate:{ title:'Night at the Bar', reason:'Tommy said something true. He does that sometimes.', deltas:{}, _isEvening:true },
  next:'_hub_fr2'
},

fr2_eve_press: {
  art:'fr2', artLabel:'Evening · Press',
  bgText:'THE PIECE',
  _isEvening:true,
  lines:[
    N(`Sandra called about a feature.`),
    C('SANDRA',()=> GS.rels.earl === 'absent'
      ? `Regional paper. Not the Courier — the Smithson Standard. They want a half-page on the rider who turned Earl Maddox down. That's the angle. That's the headline, probably.`
      : `Regional paper. Not the Courier — the Smithson Standard. They want a half-page spread on the deal with Maddox.`),
    D(`Who told them about Maddox?`),
    C('SANDRA',()=> GS.rels.earl === 'absent'
      ? `Someone at his office. He tells the story either way, Duke. If you'd signed, it'd be his find. You didn't, so it's the one that got away, and he still comes out of it as the man with the eye.`
      : `Someone at his office. That's how he works — he announces the talent before the talent knows they're being announced. It's a technique.`),
    D(`Mm.`),
    C('SANDRA',`Do you want to get ahead of it or react to it?`),
    D(`What do I get ahead of it with?`),
    C('SANDRA',`An interview. Your terms. Before they write it based on his office's version.`),
    N(`Duke thought about that.`),
    D(`Set it up.`),
    C('SANDRA',`I'll call you Monday.`),
  ],
  statUpdate:{ title:'The Feature', reason:()=> GS.rels.earl === 'absent' ? 'Earl told the story of the man who said no before you told it. Now you respond.' : 'Earl announced you before you announced yourself. Now you respond.', deltas:{ showmanship:1, hustle:1 }, _isEvening:true },
  next:'_hub_fr2'
},

/* --- FR2 DANNY SCENES --- */
fr2_danny_01: {
  art:'fr2', artLabel:'Danny · First Contact',
  bgText:'DIAMONDBACK',
  lines:[
    N(`He was at the regional show in Smithson. Duke saw him from across the lot — the truck with the custom lettering, the bike that cost more than it needed to.`),
    N(`Danny was signing something for a kid. He looked up when Duke walked past.`),
    C('DANNY',`Duke Harlan.`),
    D(`Danny.`),
    C('DANNY',()=> GS.rels.earl === 'absent' ? `Heard Maddox made you an offer.` : `Heard you signed with Maddox.`),
    D(`News travels.`),
    C('DANNY',()=> GS.rels.earl === 'absent'
      ? `It does. Heard you passed, too. I had a conversation with his office eight months ago. They passed on me.`
      : `It does. I had a conversation with his office eight months ago. They passed.`),
    N(`He said it without malice. He was stating a fact and watching to see what Duke did with it.`),
    D(`What did they say?`),
    C('DANNY',`They said I was too polished. Whatever that means.`),
    N(`Duke thought he knew what it meant. He didn't say.`),
    C('DANNY',`I'm jumping seven barrels at the end of the second set. You should stay and watch.`),
  ],
  choices:[
    { label:'A', text:`"Good for you."`, subtext:'Flat. Let him figure out what it means.', effects:{ rels:{ danny:'nemesis' }, flags:{ dannyMet:true } }, goto:'fr2_danny_01_flat' },
    { label:'B', text:`"Good setup?"`, subtext:'Professional interest. Slightly wrong-foots him.', effects:{ stats:{ showmanship:1 }, rels:{ danny:'frenemy' }, flags:{ dannyMet:true } }, goto:'fr2_danny_01_pro' },
    { label:'C', text:`"I'll stay."`, subtext:"Watch him. Know what you\'re dealing with.", effects:{ stats:{ showmanship:1 }, rels:{ danny:'frenemy' }, flags:{ dannyMet:true } }, goto:'fr2_danny_01_watch' },
  ]
},

fr2_danny_01_flat: {
  art:'fr2', artLabel:'Danny · Flat',
  bgText:'DISMISSED',
  lines:[
    D(`Good for you.`),
    N(`Danny clocked it. Filed it. The smile didn't change.`),
    C('DANNY',`See you on the circuit, Harlan.`),
    N(`Duke walked on. He heard the show. Seven barrels, clean landing. The crowd noise was genuine.`),
    N(`He thought: that was probably the wrong call. He'd made it anyway.`),
  ],
  statUpdate:{ title:'Danny — First Contact', reason:'Filed. Circuit noted.', deltas:{}, flags:{ fr2Danny01Done:true } },
  next:'_hub_fr2'
},

fr2_danny_01_pro: {
  art:'fr2', artLabel:'Danny · Professional',
  bgText:'CIRCUIT TALK',
  lines:[
    D(`Good setup?`),
    N(`Danny was slightly wrong-footed — he'd expected the flat dismissal.`),
    C('DANNY',`Good enough. Ramp angle's off by two degrees but I know how to compensate.`),
    D(`You always compensate or you fix it?`),
    N(`Danny looked at him.`),
    C('DANNY',`Usually fix it.`),
    D(`Good.`),
    N(`Duke walked on. Neither of them said anything else, which was its own kind of conversation.`),
  ],
  statUpdate:{ title:'Danny — First Contact', reason:'Professional. Neither of them said more than needed.', deltas:{ showmanship:1 }, flags:{ fr2Danny01Done:true } },
  next:'_hub_fr2'
},

fr2_danny_01_watch: {
  art:'fr2', artLabel:'Danny · You Watched',
  bgText:'SEVEN BARRELS',
  lines:[
    N(`He stayed. He watched.`),
    N(`Seven barrels, fire on the edges, the landing held. The crowd noise was genuine and Danny knew how to take it — arms wide, one slow revolution, the kind of acknowledgment that looked spontaneous and wasn't.`),
    N(`Duke watched the whole thing. Afterward, Danny found him in the lot.`),
    C('DANNY',`You stayed.`),
    D(`You said to.`),
    C('DANNY',`Most people don't.`),
    N(`He didn't say what he thought of the jump. He didn't need to.`),
    N(`Danny nodded slowly.`),
    C('DANNY',`See you out there, Harlan.`),
    N(`It wasn't a threat. It was something else.`),
  ],
  statUpdate:{ title:'Danny — You Stayed', reason:'You watched the whole show. Danny noted it.', deltas:{ showmanship:1 }, flags:{ fr2Danny01Done:true } },
  next:'_hub_fr2'
},

/* --- FR2 PETE SCENES --- */
fr2_pete_01: {
  art:'fr2', artLabel:'Pete · Ongoing',
  bgText:'THE APPRENTICE',
  lines:[
    N(`Pete had gotten better. That was the simple fact of it — he'd been working on his own, mostly, and the improvement was visible in the things Duke hadn't taught him.`),
    N(`He found Duke at the practice lot.`),
    C('PETE',`I'm doing the county fair in Hagerstown. In three weeks.`),
    D(`What are you jumping?`),
    C('PETE',`Three barrels. Maybe four if the ramp holds.`),
    D(`The ramp.`),
    C('PETE',`I know. I'm fixing the legs.`),
    N(`Duke looked at him. He was sixteen. He had the focus Duke remembered having at sixteen except Duke at sixteen hadn't known what to do with it yet.`),
    C('PETE',`You don't have to come.`),
    D(`I know I don't have to.`),
  ],
  choices:[
    // Committing or teaching moves Pete from someone who follows you around to
    // someone you have a working relationship with, which is what Milestone 5's
    // mentor ending is gated on. "Send me the date" deliberately does not.
    { label:'A', text:`"Send me the date."`, subtext:"You\'ll try to make it. Both of you know what that means.", effects:{}, goto:'fr2_pete_01_maybe' },
    { label:'B', text:`"I'll be there."`, subtext:'Commit. See what he does with it.', effects:{ stats:{ showmanship:1 }, rels:{ pete:'ally' } }, goto:'fr2_pete_01_yes' },
    { label:'C', text:`"Here's what you need to watch on the approach."`, subtext:'Teach him something specific. Better than showing up.', effects:{ stats:{ precision:1 }, rels:{ pete:'ally' } }, goto:'fr2_pete_01_teach' },
  ]
},

fr2_pete_01_yes: {
  art:'fr2', artLabel:'Pete · Committed',
  bgText:'I\'LL BE THERE',
  lines:[
    D(`I'll be there.`),
    N(`Pete's face did the thing it did when something went better than expected.`),
    C('PETE',`Yeah?`),
    D(`Fix the ramp first.`),
    C('PETE',`I'm fixing the ramp.`),
    N(`He went. Duke watched him go and thought about the plywood over tires in the uncle's lot two years ago. The angle that was wrong. The difference between then and now.`),
    N(`He thought: that's what teaching is, maybe. Not the lesson — the gap.`),
  ],
  next:'_hub_fr2'
},

fr2_pete_01_maybe: {
  art:'fr2', artLabel:'Pete · Maybe',
  bgText:'SEND THE DATE',
  lines:[
    D(`Send me the date. I'll try to make it.`),
    N(`Pete absorbed this with the practiced evenness of someone who'd heard "maybe" before.`),
    C('PETE',`Sure.`),
    N(`He sent the date. Duke looked at the calendar. He had a show two counties over the same weekend.`),
    N(`He sent Pete a note: *can't make it. Send me the landing footage.*`),
    N(`Pete sent the footage. Three barrels, clean. The ramp held.`),
    N(`Duke watched the footage once and put it away.`),
  ],
  next:'_hub_fr2'
},

fr2_pete_01_teach: {
  art:'fr2', artLabel:'Pete · Teaching',
  bgText:'THE APPROACH',
  lines:[
    D(`Here's what you need to watch on the approach.`),
    N(`Pete listened with the specific attention of someone memorizing something.`),
    D(`The commit point. You know where it is?`),
    C('PETE',`When I get on the ramp.`),
    D(`Earlier than that. The commit point is when you stop calculating and start trusting the calculation you already did. If you're thinking past that point, you're late.`),
    N(`Pete looked at him.`),
    C('PETE',`How do you know where that is?`),
    D(`You practice until you recognize it. That's all.`),
    N(`He went. Duke stood in the lot for a moment.`),
    N(`He thought: that's a harder thing to teach than the approach.`),
  ],
  next:'_hub_fr2'
},

/* --- FR2 DEBT SCENE --- */
fr2_debt_01: {
  art:'fr2', artLabel:'The Cost',
  bgText:'TWELVE HUNDRED',
  lines:[
    N(()=> GS.rels.earl !== 'absent'
      ? `The next show on Earl's calendar required a specific setup — a row of cars that had to be acquired, positioned, and cleared. The venue didn't cover it. The cars were Duke's problem.`
      : GS.flags.soloPlan === 'slow'
      ? `He'd said cars when the page said cars. The page said cars in October — the Speedway's season closer, a row of them that had to be acquired, positioned, and cleared. Kessler didn't cover it. Nobody's office was going to. The cars were Duke's problem, which was the deal he'd made at a kitchen table.`
      : `The season closer needed a row of cars — acquired, positioned, and cleared. Kessler didn't cover it. Nobody's office was going to. The cars were Duke's problem, which was the deal he'd made at a kitchen table, and the money he'd said he'd find was now due.`),
    N(`Twelve hundred dollars. That was the number.`),
    N(()=> GS.rels.earl !== 'absent'
      ? `He'd made eighteen hundred at the last three shows combined. He also had rent, the truck payment, and a parts invoice from Cal that was sitting on the counter.`
      : GS.flags.soloBank === 'none'
      ? `He'd made six hundred and forty at the last five shows combined. He also had rent, the truck payment, the lumber yard, and a parts invoice from Cal that was sitting on the counter.`
      : `He'd made six hundred and forty at the last five shows combined. He also had rent, the truck payment, thirty-seven dollars a month to Pyle, and a parts invoice from Cal that was sitting on the counter.`),
    N(`The math was specific.`),
  ],
  choices:[
    // Phase 6: each answer sources the twelve hundred differently, and now the
    // difference is a number. Earl advances it against the next show and holds
    // it; the bank hands it over and takes a hundred and eight dollars a month
    // back for a year, priced the way this game has always priced a note
    // (`monthlyOn`); Tommy lends it and is paid back out of the show, which
    // costs nothing but him; self-funding is the only one that comes out of
    // Duke's own pocket — twelve hundred for the cars, nine hundred back when
    // he sells them, and one more small show to cover the rest.
    { label:'A', text:`Borrow from Earl.`, subtext:"He\'ll advance it against the next show. No interest. But he holds the number.", effects:{ flags:{ debtSource:'earl' } }, goto:'fr2_debt_earl',
      _needs:{ earl: EARL_PRESENT } },
    { label:'B', text:`Local bank loan.`, subtext:'Straightforward. Twelve months. Eight percent. Garrett Pyle will have opinions.', effects:{ flags:{ debtSource:'bank' }, owePerMonth: monthlyOn(CAR_MONEY) }, goto:'fr2_debt_bank' },
    { label:'C', text:`Borrow from Tommy.`, subtext:"He has it. He\'ll lend it. That\'ll be a thing.", effects:{ flags:{ debtSource:'tommy' } }, goto:'fr2_debt_tommy' },
    { label:'D', text:`Self-fund. Make the math work.`, subtext:'Cut expenses. Call in favors. Keep it clean. It comes out of what you have.', effects:{ stats:{ hustle:1 }, flags:{ debtSource:'self' }, money: SELF_FUND_NET }, goto:'fr2_debt_self' },
  ]
},

fr2_debt_earl: {
  art:'fr2', artLabel:'Debt · Earl',
  bgText:'THE ADVANCE',
  lines:[
    N(`He called Earl.`),
    C('EARL',`Twelve hundred. I'll advance it against your next show.`),
    N(`No negotiation. No pause.`),
    D(`That simple?`),
    C('EARL',`It's not simple. It's an advance. You know the difference.`),
    D(`I know the difference.`),
    C('EARL',`Good. Call my office. They'll have the paperwork Thursday.`),
    N(`He hung up. Duke sat there.`),
    N(`He thought: twelve hundred is not a lot of money in the sense that it doesn't change his life. He thought: twelve hundred is a lot of money in the sense that Earl now has the number. He thought: Earl has had the number since the signing. This is just the first time it has a dollar sign on it.`),
  ],
  next:'_hub_fr2'
},

fr2_debt_bank: {
  art:'fr2', artLabel:'Debt · Bank',
  bgText:'COLLATERAL',
  lines:[
    N(()=> GS.rels.earl !== 'absent'
      ? `The loan officer at Buford County Savings was a man named Garrett Pyle, who had grown up two streets over from Duke and had last spoken to him at a funeral five years ago.`
      : GS.flags.soloBank === 'none'
      ? `Garrett Pyle had said the offer stood if Duke changed his mind. Duke had changed his mind by twelve hundred dollars.`
      : `Garrett Pyle already held paper on the bike. He looked like a man being asked how he felt about the truck.`),
    N(`Garrett Pyle looked at the loan application like it was a document he was being asked to sign in another language.`),
    C('PYLE',`What's the collateral?`),
    D(`The equipment. The bike.`),
    C('PYLE',`A motorcycle.`),
    D(()=> GS.rels.earl === 'absent'
      ? `There's an income stream. The shows. Fridays at the Speedway, Perkins in August.`
      : `There's an income stream. The shows. Earl Maddox is the promoter. You know who Earl Maddox is.`),
    C('PYLE',()=> GS.rels.earl === 'absent' ? `I've seen the Speedway's gate on a wet night.` : `I've heard the name.`),
    N(`He approved it. Twelve hundred dollars, twelve months, eight percent. Duke drove home and thought about the monthly number and how many shows it took to make that number disappear. Neither number was alarming. They were just real. The realness was new.`),
  ],
  next:'_hub_fr2'
},

fr2_debt_tommy: {
  art:'fr2', artLabel:'Debt · Tommy',
  bgText:'THE ASK',
  lines:[
    N(()=> GS.flags.soloBank === 'tommy'
      ? `He hated asking. He'd asked once already this year, in a bank lobby, and Tommy had read the whole form. He asked anyway.`
      : `He hated asking. He asked anyway.`),
    D(`I need to borrow twelve hundred.`),
    C('TOMMY',`When do you need it?`),
    D(`By the end of the week.`),
    C('TOMMY',`Okay.`),
    D(`Tommy.`),
    C('TOMMY',`I've got it. From the lot job.`),
    N(`He paid him back after the show. Tommy didn't make it a thing. The thing that would not be a thing was already a thing, though — both of them knew it. The twelve hundred lived in the friendship from then on, very small, very quiet. Not poisonous. Just present.`),
    N(`At a bar six weeks later:`),
    C('TOMMY',`You know, when you needed that twelve hundred —`),
    D(`I paid you back.`),
    C('TOMMY',`I know. I just — I was glad to. That's what I was going to say.`),
    N(`He meant it. He also needed Duke to know he meant it. Those were two separate things.`),
    N(`Whatever else Tommy was after that, he was a man Duke had needed. That is a specific thing to be, and it is not the same thing as a partner, and it does not go away when the money does.`),
  ],
  // Phase 4. The lasting cost of this arm. Borrowing from Tommy puts him back
  // to `hanger_on` from wherever the car-show warm-up left him: the Free Roam
  // 4 evening's `ally` line goes away, and the ending screen says Hanger-On.
  // It is written flat rather than conditionally because the demotion is the
  // same fact either way — a man you owe is not a man beside you — and the
  // stat screen is the only place the game ever says a relationship moved.
  // Free Roam 3's evening is the way back, and it costs an evening.
  statUpdate:{
    title:'Twelve Hundred',
    reason:"He had it and he lent it and he read nothing. That sits where a partnership was going to.",
    deltas:{},
    rels:{ tommy:'hanger_on' },
  },
  next:'_hub_fr2'
},

fr2_debt_self: {
  art:'fr2', artLabel:'Debt · Self',
  bgText:'CLEAN',
  lines:[
    N(`He went through the numbers three times.`),
    N(`If he pushed the truck payment to the end of the month. If he used the parts money he'd been holding and called Cal about deferring the invoice — Cal would defer it, without being asked to be thanked for it.`),
    N(`It came out to eleven-forty. He needed twelve hundred.`),
    N(`He did one more show — a small one, the kind he'd have passed on before — and made enough.`),
    N(`He bought the cars himself. Which meant he had to sell them after. That took two Saturdays. He got nine hundred back.`),
    N(`He told no one. It was the cleanest solution and also slightly exhausting and he was proud of it in the way you're proud of something only you know about.`),
  ],
  statUpdate:{ title:'Self-Funded', reason:'Nobody holds the number. That\'s worth the two Saturdays.', deltas:{} },
  next:'_hub_fr2'
},

/* --- FR2 CLOSE --- */
fr2_close: {
  art:'fr2', artLabel:'Free Roam 2 · Close',
  bgText:'MILESTONE 3',
  // A getter rather than N(fn) lines: the phone call at the end has a different
  // speaker on each branch, and C()'s speaker is not a function.
  get lines(){
    if(GS.rels.earl === 'absent'){
      const debt = GS.flags.debtSource;
      return [
        N(`By the time Milestone 3 was on the horizon, the shape of things had changed.`),
        N(`Not all at once — incrementally, in the way he was starting to expect things to change. The shows were bigger. The distances were longer. The notebook had dates in it that were two states away, and every one of them was in his own handwriting.`),
        N(debt === 'bank'
          ? `He'd made money. He'd spent most of it, and a set amount of it went to Garrett Pyle on the first of every month whether he'd made any or not. Cal said the suspension geometry was right. Sandra had run two pieces. ${tommyAtFR2Close()}`
          : debt === 'tommy'
          ? `He'd made money. He'd spent most of it, and twelve hundred of it had gone back to Tommy, who had not made it a thing, which was its own kind of thing. Cal said the suspension geometry was right. Sandra had run two pieces.`
          : `He'd made money. He'd spent most of it, two Saturdays of it selling cars back to the people he'd bought them from. Cal said the suspension geometry was right. Sandra had run two pieces. ${tommyAtFR2Close()}`),
        // The same sweep. Both lines are a history with Danny in it, and a run
        // that declined him at the fair does not have one; `null` drops a line
        // in buildLines().
        N(()=> isPresent('danny', GS.rels) ? `And there was Danny Reeves — still performing, still watching, still doing the thing where he said the accurate thing in the wrong way.` : null),
        N(()=> isPresent('danny', GS.rels) ? `Duke thought about Danny more than he wanted to.` : null),
        N(`Then Dot Kessler called about the car show. The real one. Five cars, the Speedway's season closer, and a regional TV crew that was coming for the feature race and would point the camera at whatever was in the lot. No sponsor. The cars were his.`),
        N(`He listened to the whole pitch without interrupting. It was not a long pitch. She didn't do long.`),
        N(`When she finished she said:`),
        C('KESSLER',`Well?`),
        D(`I think I'm ready.`),
        N(`A pause. Not a tell. Just a woman in a ticket booth deciding whether to believe him.`),
        C('KESSLER',`Then be the reason they're here.`),
      ];
    }
    return [
    N(`By the time Milestone 3 was on the horizon, the shape of things had changed.`),
    N(`Not all at once — incrementally, in the way he was starting to expect things to change. The shows were bigger. The distances were longer. Earl's calendar had dates in it that were three states away.`),
    N(()=> `He'd made money. He'd spent most of it. Cal said the suspension geometry was right. Sandra had run two pieces. ${tommyAtFR2Close()}`),
    N(()=> isPresent('danny', GS.rels) ? `And there was Danny Reeves — still performing, still watching, still doing the thing where he said the accurate thing in the wrong way.` : null),
    N(()=> isPresent('danny', GS.rels) ? `Duke thought about Danny more than he wanted to.` : null),
    N(`Then Earl called about the car show. The real one. Five cars, a national sponsor interested, a regional TV crew.`),
    N(`He listened to the whole pitch without interrupting.`),
    N(`When Earl finished he said:`),
    C('EARL',`What do you think?`),
    D(`I think I'm ready.`),
    N(`A pause. Earl's tell — not tapping a pen. Just quiet.`),
    C('EARL',`Good. Because this one matters.`),
    ];
  },
  next:'_chapter_m3'
},

/* ============================================================
   MILESTONE 3 — THE BIG BREAK (STUB)
   ============================================================ */
m3_entry: {
  art:'m3', artLabel:'Milestone 3',
  bgText:'THE BIG BREAK',
  lines:[
    N(()=> solo()
      ? `Five cars. A row of them in the Smithson Speedway's back lot, which smelled like asphalt and sunscreen and the specific kind of hope that collects where large crowds gather. His cars. The receipts were in the glovebox.`
      : `Five cars. A row of them in a stadium parking lot that smelled like asphalt and sunscreen and the specific kind of hope that collects where large crowds gather.`),
    N(()=> solo()
      ? `The regional TV crew had a camera on the infield scaffold, pointed at the grid for the feature race. Nothing was on the ramp but the ramp. The man behind the camera — Roy Petersen, the crew called him — had walked over during setup, looked at the ramp for a long time, said nothing, and walked back.`
      : `The regional TV crew had a camera on a scaffold. The sponsor's logo was on the ramp.`),
    N(`Cal had checked everything twice. He'd been quiet since they arrived, which meant he'd found something he didn't like and fixed it and wasn't going to say what it was.`),
    N(`Duke stood at the end of the approach and looked at the five cars and felt the distance in the way you feel something you've run a thousand times in your head and never once in your body.`),
    N(`He thought: this is the part where you find out.`),
  ],
  next:'_m3_prestunt'
},

/* M3 PRE-STUNT CONVERSATION — Cal version */
m3_prestunt_cal: {
  art:'m3', artLabel:'Milestone 3 · Before',
  bgText:'THE LAST HOUR',
  lines:[
    N(`Cal found him an hour before they opened the gates. He had something in his hand — a short bolt, worn on the threads, the kind you pull when you replace it with something better.`),
    N(`He set it on the tailgate between them without explaining it.`),
    C('CAL',`Found that in the left fork housing. Replaced it.`),
    D(`When?`),
    C('CAL',`Two nights ago.`),
    N(`Duke looked at it. The threads were almost gone. Another run, maybe two.`),
    C('CAL',`You should postpone.`),
    D(`The TV crew is already here.`),
    C('CAL',`I know.`),
    N(`A pause. Cal picked up the bolt and turned it in his fingers.`),
    C('CAL',`Bike's right now. I fixed it. I'm just telling you what was in there.`),
    D(`Why?`),
    C('CAL',`Because you should know.`),
    N(`He put the bolt in his shirt pocket. He walked back to the bike. Duke watched him go and thought: that's information. Not a warning. Not a request. Information. Cal trusted him to know the difference.`),
    N(`He thought: the bike is right now.`),
    N(`He thought: let's find out what I am.`),
  ],
  choices:[
    { label:'A', text:`Go. The bike's right.`, subtext:"Cal said so. That's enough.", effects:{}, goto:'_minigame_stunt_m3' },
    { label:'B', text:`Walk the approach one more time.`, subtext:`You've walked it four times. This is number five.`, effects:{ stats:{ precision:1 } }, goto:'_minigame_stunt_m3' },
  ]
},

/* M3 PRE-STUNT — Ruthie version */
m3_prestunt_ruthie: {
  art:'m3', artLabel:'Milestone 3 · Before',
  bgText:'THE LAST HOUR',
  lines:[
    N(`She'd driven three hours. She was standing at the fence line where the families and the day-of crew were sorted into different categories of allowed. He found her there.`),
    C('RUTHIE',`Hey.`),
    D(`Hey. You drove.`),
    C('RUTHIE',`I drove.`),
    N(`He'd told her about it. He hadn't asked her to come. She was here anyway, which was a thing she did — arrived without making it a thing.`),
    N(`She didn't say *be careful.* She'd never once said *be careful.* He'd noticed that a long time ago.`),
    C('RUTHIE',`Come back.`),
    N(`That was all. She said it the way you say something that's been decided — not a request, not a prayer. A statement. She'd already worked out that he was going to do it. She was telling him the part that came after.`),
    D(`I will.`),
    C('RUTHIE',`I know.`),
    N(`She looked at the ramp. She'd been looking at it the whole time, he realized — the whole time she'd been looking at him she'd also been looking at it, in the way she measured things she couldn't stop.`),
    N(`He thought: she's not asking me not to. She's just telling me what matters.`),
    N(`Come back. Two words. He filed them somewhere that wasn't going anywhere.`),
  ],
  choices:[
    { label:'A', text:`Go.`, subtext:`She said what she needed to. You heard it.`, effects:{}, goto:'_minigame_stunt_m3' },
  ]
},

/* M3 PRE-STUNT — alone version */
m3_prestunt_alone: {
  art:'m3', artLabel:'Milestone 3 · Before',
  bgText:'THE LAST HOUR',
  lines:[
    N(`He walked the approach a fifth time. Not because he needed to. Because it was something to do that was in the direction of the thing.`),
    N(`Nobody came to find him. He'd stopped expecting them.`),
    N(()=> solo()
      ? `Kessler had a feature race to run. Cal did the bike and didn't add anything to it. The TV crew was the race's, not his.`
      : `Earl had his own preparations. Cal did the bike and didn't add anything to it. The TV crew was its own organism.`),
    N(`He stood at the lip of the ramp and looked at five cars and thought about the county fair. Three cows. The dirt under his wheels. The crowd.`),
    N(`The crowd here was ten times that. He'd stopped thinking about crowds as a fixed category — there was the county fair crowd and there was this, and the number in between was not a meaningful number, it was just more.`),
    N(`He was not scared. He thought about whether not being scared was itself something to worry about. He decided it wasn't.`),
    N(()=> solo()
      ? `He had no voice in his head telling him anything — no Cal, no Ruthie, no promoter with a number. Just the ramp. Just the five cars. Just him.`
      : `He had no voice in his head telling him anything — no Cal, no Ruthie, no Earl. Just the ramp. Just the five cars. Just him.`),
    N(`He thought: that's information. Not triumph. Not recovery declared.`),
    N(`Just information. He knew what he was doing. He'd go find out.`),
  ],
  choices:[
    { label:'A', text:`Go.`, subtext:`You've been here before. Different scale. Same thing.`, effects:{}, goto:'_minigame_stunt_m3' },
  ]
},

/* ---- M3 FOUR OUTCOME STATES ---- */

m3_triumph_clean: {
  art:'m3', artLabel:'Milestone 3 · Triumph',
  bgText:'CLEAN',
  // A getter, like fr2_close: the person who meets him off the ramp has a
  // different name on each branch, and C()'s speaker is not a function.
  get lines(){
    const head = [
    N(`Clean arc. Clean landing. The back wheel kissed the ramp mat with the specific weight of something that had gone exactly right — every calculation confirmed in the same half-second.`),
    N(`The crowd noise was the kind that doesn't build. It arrives all at once, like a weather event.`),
    N(`Duke held it for a moment — hands on the bars, feet down, the bike still running. He looked at the five cars and then at the scaffold camera and then at Cal, who was standing twenty feet away doing nothing, which was Cal's version of a standing ovation.`),
    ];
    if(solo()) return [...head,
    N(`He rode off the ramp. Nobody was there, which was the arrangement. Then Petersen's camera came off the grid and found him and stayed, and Kessler was walking across the lot from the ticket booth with the cash box under her arm.`),
    C('KESSLER',`They came for the race.`),
    D(`I know.`),
    C('KESSLER',`They'll say they came for this.`),
    N(`She said it simply. Duke thought about the ticket booth — the pause, the deciding whether to believe him — and thought: she's not deciding any more.`),
    ];
    return [...head,
    N(`He rode off the ramp. Earl was there.`),
    C('EARL',`That's what I've been waiting for.`),
    N(`He said it simply. Duke thought about the tell — the three taps — and thought: he's not performing that one.`),
    ];
  },
  statUpdate:{
    title:'Five Cars Clean',
    reason:()=> solo()
      ? 'Petersen turned the camera. Kessler got it. Cal got it. The crowd got it. Nothing left on the table.'
      : 'The TV crew got it. Earl got it. Cal got it. The crowd got it. Nothing left on the table.',
    deltas:{ nerve:2, showmanship:2, precision:1 },
    flags:{ m3Complete:true, m3Outcome:'triumph_clean' }
  },
  next:'m3_aftermath'
},

m3_triumph_messy: {
  art:'m3', artLabel:'Milestone 3 · Triumph',
  bgText:'HELD IT',
  get lines(){
    const head = [
    N(`He cleared it. The last ten feet were not the plan — the rear wheel kicked on landing and he felt the whole back end slide two feet to the right before his body decided what to do about it, which was: weight left, grip, don't let go.`),
    N(`He didn't let go. The bike straightened. The crowd had already made its noise — the one where nobody was sure yet — and then he was upright and they made a different noise.`),
    N(`He got off the ramp. His hands had that specific vibration in them that isn't quite shaking.`),
    ];
    const tail = [
    N(`Cal looked at the tire marks. He didn't say anything for a while.`),
    C('CAL',`Rear suspension compressed early. We'll look at it.`),
    N(`That was Cal's version of: *you made it, let's not do that again.*`),
    ];
    if(solo()) return [...head,
    N(`Kessler came over. She wasn't moving fast, which was how she moved.`),
    C('KESSLER',`That last ten feet. That's what they'll be talking about in the parking lot.`),
    D(`I didn't plan that.`),
    C('KESSLER',`I know. They can't tell.`),
    ...tail];
    return [...head,
    N(`Earl came over. He wasn't moving fast, which was the tell.`),
    C('EARL',`That last ten feet — that's what I'm buying.`),
    D(`I didn't plan that.`),
    C('EARL',`I know. That's why I'm buying it.`),
    ...tail];
  },
  statUpdate:{
    title:'Five Cars — Held It',
    reason:()=> solo()
      ? "Cleared it messy. The crowd saw the recovery. Kessler saw something she can book again. Cal saw something to fix."
      : "Cleared it messy. The crowd saw the recovery. Earl saw something he can sell. Cal saw something to fix.",
    deltas:{ nerve:1, showmanship:2, condition:-1 },
    flags:{ m3Complete:true, m3Outcome:'triumph_messy' }
  },
  next:'m3_aftermath'
},

m3_failure_walk: {
  art:'m3', artLabel:'Milestone 3 · Failure',
  bgText:'DOWN',
  get lines(){
    const head = [
    N(`He clipped the fourth car. The bike went sideways and he let it go — the thing you train for, the thing Cal had made him practice until it was reflex: let the bike go, tuck, roll.`),
    N(`He came up in the gravel. His left shoulder took the weight.`),
    N(`The crowd made a sound. Not panic — that specific tight silence of two thousand people waiting to see if something was wrong.`),
    N(`He got up. His left shoulder disagreed with this plan but he got up anyway.`),
    N(`He raised his right fist.`),
    N(`The crowd came back to itself.`),
    ];
    if(solo()) return [...head,
    N(`Cal reached him first. Nobody called that evening. He sat in the truck with the shoulder packed in ice from the concession stand and ran it back himself.`),
    N(`He thought: the fist. Did I plan that?`),
    N(`He thought: no.`),
    N(`He thought: plan it next time.`),
    ];
    return [...head,
    N(`Cal reached him first. Earl called that evening.`),
    C('EARL',`The fist. Did you plan that?`),
    D(`No.`),
    C('EARL',`Plan it next time.`),
    ];
  },
  statUpdate:{
    title:'Down on Four',
    reason:()=> solo()
      ? 'The fist mattered. Cal was right about the shoulder. Nobody called, so he is already thinking about next time himself.'
      : 'The fist mattered. Cal was right about the shoulder. Earl is already thinking about next time.',
    deltas:{ condition:-2, showmanship:1, nerve:-1 },
    flags:{ m3Complete:true, m3Outcome:'failure_walk' }
  },
  next:'m3_aftermath'
},

m3_failure_bad: {
  art:'m3', artLabel:'Milestone 3 · Down Hard',
  bgText:'STAY DOWN',
  lines:[
    N(`He knew before he left the ramp that something was wrong. He went anyway, which was either courage or the inability to stop — he'd never been entirely sure of the boundary between those two things.`),
    N(`The landing was wrong in a way that was over before he could correct it. The bike went left, he went right, and the tarmac came up faster than the tarmac was supposed to.`),
    N(`He didn't get up right away.`),
    N(`He knew he should. He'd done it before — the count, the fist, the crowd comes back. He knew the sequence. His body was not interested in the sequence.`),
    N(()=> solo()
      ? `Cal was there. Then the medical crew. He heard the track announcer somewhere behind him, over the PA, saying something calm about a delay. Not close. Professional.`
      : `Cal was there. Then the medical crew. He heard Earl's voice somewhere behind him — not close. Assessing.`),
    N(()=> solo()
      ? `He thought: I'm on the ground and there's nobody to tell it's fine. That was the arrangement. It had sounded better in Cal's garage.`
      : `He thought: I'm on the ground and I can't tell Earl it's fine because Earl can see it isn't fine.`),
    N(()=> solo() ? `He thought: this is going to be a bill.` : `He thought: this is going to be a conversation.`),
  ],
  next:'_m3_recovery_then_fail'
},

m3_aftermath: {
  art:'m3', artLabel:'Milestone 3 · Close',
  bgText:'WHAT COMES NEXT',
  lines:[
    N(`That was one thing taken care of.`),
    N(`Cal loaded the ramp into the trailer without speaking. Duke watched him do it.`),
    N(()=> solo()
      ? `The show had already moved on to whatever comes after a show. The crowd, the feature race's winner in the infield, the TV crew folding cable. Nobody doing anything on his behalf, which was the deal he'd made, and which he noticed.`
      : `The show had already moved on to whatever comes after a show. The crowd, the sponsor's people, the TV crew folding cable. Earl somewhere doing what Earl did after a show.`),
    N(`Duke sat on the tailgate and thought: that was one thing. Now there's another.`),
    N(`There's always another.`),
  ],
  next:'_chapter_fr3'
},

/* ============================================================
   M3 BAD FAILURE — recovery then stub
   ============================================================ */
m3_failure_bad_after: {
  art:'m3', artLabel:'Milestone 3 · Aftermath',
  bgText:'STILL HERE',
  get lines(){
    const head = [
    N(`The medical crew helped him to the folding table behind the gate. He sat. His left hip was going to be a conversation. His right wrist was already changing color.`),
    N(`Cal came and stood next to him and didn't say anything, which was what Duke needed him to do.`),
    ];
    if(solo()) return [...head,
    N(`Kessler came after the feature race, with a bank envelope. She set it on the folding table next to his wrist. Whatever the gate had been, his piece of it was in there, counted.`),
    C('KESSLER',`How bad?`),
    D(`I don't know yet.`),
    C('KESSLER',`The camera was on you.`),
    D(`I couldn't get up to do the fist.`),
    C('KESSLER',`No. I know. Petersen stayed on you anyway. Forty seconds, he told me. He's never held a shot forty seconds on my track.`),
    N(`Duke looked at her.`),
    C('KESSLER',`A man on the ground who hasn't got up yet is a different picture than the fist. It's not the one you wanted. It's the one they've got.`),
    N(`Duke thought: she's not wrong. He also thought: I'd rather have the fist.`),
    N(`He didn't say it. He looked at his wrist. He looked at the envelope. He thought about the next part, which was the part he was going to have to build from, and pay for.`),
    ];
    return [...head,
    N(`Earl arrived five minutes later. He sat down across from Duke. He looked at him for a long moment.`),
    C('EARL',`How bad?`),
    D(`I don't know yet.`),
    C('EARL',`The fist.`),
    D(`I couldn't get up to do the fist.`),
    C('EARL',`No. I know. It still — there was a moment, right after the landing, when the camera was on you and you didn't move. That moment's going to be a photograph.`),
    N(`Duke looked at him.`),
    C('EARL',`The photograph of a man who went down and hasn't gotten up yet is a different kind of story. It's not the fist. But it's something.`),
    N(`Duke thought: he's not wrong. He also thought: I'd rather have the fist.`),
    N(`He didn't say it. He looked at his wrist. He thought about the next part, which was the part he was going to have to build from.`),
    ];
  },
  statUpdate:{
    title:'Down — Hard',
    reason:'The crash was the show. Recovery starts now. Cal is already thinking about what comes next.',
    deltas:{ condition:-3, nerve:-1, showmanship:1 },
    flags:{ m3Complete:true, m3Outcome:'failure_bad' }
  },
  next:'m3_aftermath'
},

/* ============================================================
   FR2 COMPLETIONS
   ============================================================ */

/* --- FR2 Danny 02 — the public challenge --- */
fr2_danny_02: {
  art:'fr2', artLabel:'Free Roam 2 · Danny',
  bgText:'THE CHALLENGE',
  lines:[
    N(`Danny had gone to the papers. Not the big papers — the circuit papers, the regional stuff that circulates at fairgrounds and reaches exactly the people whose opinion matters in this particular world.`),
    N(`Sandra read the quote to Duke over the phone:`),
    N(`"Duke Harlan's good. I'd like to see if he's good in the same zip code as me at the same time. Open invitation."`),
    N(`She'd read it twice. The first time she was trying not to laugh.`),
    C('SANDRA',`He called it an 'open invitation.'`),
    D(`I heard.`),
    C('SANDRA',`Do you want to respond?`),
    D(`What did you print?`),
    C('SANDRA',`Nothing yet. I wanted to ask you first.`),
    D(`That's generous.`),
    C('SANDRA',`I thought so.`),
  ],
  choices:[
    { label:'A', text:`"Tell him I'm available the fifteenth."`, subtext:'Give him a date. See if it was really an open invitation.', effects:{ stats:{ showmanship:2 }, flags:{ fr2Danny02Done:true, dannyChallenge:'accept' } }, goto:'fr2_danny_headtohead_accept' },
    { label:'B', text:`"Tell him I'll do it. My show, my date, my conditions."`, subtext:"Control the terms. He'll think about it.", effects:{ stats:{ hustle:1, showmanship:1 }, flags:{ fr2Danny02Done:true, dannyChallenge:'counter' } }, goto:'fr2_danny_headtohead_counter' },
    { label:'C', text:`"Tell him I'm focused on my own calendar."`, subtext:'Decline with grace. Danny loses some credibility for pushing it.', effects:{ flags:{ fr2Danny02Done:true, dannyChallenge:'decline' } }, goto:'fr2_danny_headtohead_decline' },
    { label:'D', text:`Don't respond.`, subtext:"Let it sit. The circuit will decide what that means.", effects:{ stats:{ showmanship:-1 }, flags:{ fr2Danny02Done:true, dannyChallenge:'silence' } }, goto:'fr2_danny_headtohead_silence' },
  ]
},

fr2_danny_headtohead_accept: {
  art:'fr2', artLabel:'Free Roam 2 · Danny',
  bgText:'THE FIFTEENTH',
  lines:[
    D(`Tell him I'm available the fifteenth.`),
    N(`Sandra said nothing for a beat.`),
    C('SANDRA',`The fifteenth.`),
    D(`He wants an open invitation, give him a date.`),
    C('SANDRA',`He might not be available.`),
    D(`Then he doesn't get to call it an open invitation anymore.`),
    N(`Sandra was quiet in the way she was quiet when she was deciding whether to print something.`),
    C('SANDRA',`I'll pass it along.`),
    D(`You're going to write about it.`),
    C('SANDRA',`I'm a reporter.`),
    D(`I know.`),
    N(`The fifteenth. He had three weeks. He called Cal.`),
  ],
  next:'fr2_danny_event'
},

fr2_danny_event: {
  art:'fr2', artLabel:'Free Roam 2 · Head-to-Head',
  bgText:'SAME ZIP CODE',
  lines:[
    N(`Danny showed up. That was the first thing — he actually showed up, which some part of Duke had not completely assumed.`),
    N(`The white leather jacket was gone. He was in red, which was a better call. Someone had advised him.`),
    N(`The crowd was bigger than any Duke had drawn in the county. That was Danny's doing — his people had promoted it, which meant his people were competent, which meant he had people.`),
    N(()=> solo()
      ? `They went in the order determined by a coin flip that Duke won and chose to go second on, which Cal — watching from the fence — nodded at once and only.`
      : `They went in the order determined by a coin flip that Duke won and chose to go second on, which Earl — watching from the fence — nodded at once and only.`),
    N(`Danny went first. Fifty-three feet, clean. The crowd liked it.`),
    N(`Duke's turn.`),
  ],
  choices:[
    { label:'A', text:`Go all out — fifty-five feet.`, subtext:'Cal worked the numbers. You trust the numbers.', effects:{ stats:{ showmanship:2, nerve:1 }, rels:{ danny:'nemesis' }, flags:{ fr2DannyEventDone:true, dannyEventOutcome:'win' } }, goto:'fr2_danny_event_win' },
    { label:'B', text:`Fifty-two. Controlled run.`, subtext:"It's one foot short. But it's clean.", effects:{ stats:{ precision:1 }, flags:{ fr2DannyEventDone:true, dannyEventOutcome:'narrow_loss' } }, goto:'fr2_danny_event_narrow' },
  ]
},

fr2_danny_event_win: {
  art:'fr2', artLabel:'Free Roam 2 · Head-to-Head',
  bgText:'FIFTY-FIVE',
  lines:[
    N(`He cleared fifty-five feet, and the crowd made the noise it makes when something is decided, and Danny was standing next to the ramp with his arms crossed, and when Duke rode past him Danny said something that the engine noise swallowed.`),
    N(`Duke didn't ask him to repeat it.`),
    N(`Afterward, Sandra asked if he had a comment.`),
    D(`He's good.`),
    C('SANDRA',`That's it?`),
    D(`That's it.`),
    N(`Danny who loses cleanly is more dangerous than Danny who wins, because losing cleanly means he has to invent a reason.`),
  ],
  next:'fr2_danny_03'
},

fr2_danny_event_narrow: {
  art:'fr2', artLabel:'Free Roam 2 · Head-to-Head',
  bgText:'ONE FOOT',
  lines:[
    N(`One foot. The crowd clapped for both of them, which was fair and also infuriating.`),
    N(`Danny didn't gloat. That was the part that got under Duke's skin — he'd been ready for the gloat and Danny didn't give it to him. He just stood there in the red jacket and shook Duke's hand and said:`),
    C('DANNY',`Next time.`),
    N(`He said it quietly enough that nobody else could hear. Duke wasn't sure if it was a threat or a compliment. He suspected Danny wasn't sure either.`),
    N(`Cal, afterward:`),
    C('CAL',`The launch angle was half a degree off. We fix it.`),
    N(`The half degree had a name: the crowd. Duke had heard them before he went off the ramp. He'd adjusted wrong. He won't make that adjustment again.`),
  ],
  statUpdate:{
    title:'One Foot Short',
    reason:'Close showing. Danny won the day. Cal has the fix. The adjustment is already logged.',
    deltas:{ nerve:-1, precision:1 },
    flags:{ fr2DannyEventDone:true, dannyEventOutcome:'narrow_loss' }
  },
  next:'fr2_danny_03'
},

fr2_danny_headtohead_counter: {
  art:'fr2', artLabel:'Free Roam 2 · Danny',
  bgText:'MY TERMS',
  lines:[
    D(`Tell him I'll do it. My show, my date, my conditions.`),
    N(`Sandra was quiet.`),
    C('SANDRA',`What are the conditions?`),
    D(`Same distance. He goes first. I set the bar.`),
    C('SANDRA',`You want him to establish the distance so you can clear it.`),
    D(`I want him to establish the distance so he's committed to it.`),
    C('SANDRA',`That's actually smart.`),
    D(`Thank you, Sandra.`),
    C('SANDRA',`I'll print 'Duke Harlan accepts, terms pending.' Does that work?`),
    D(`That works.`),
    N(`Danny, when Sandra passed it along, said: "Fine." He said it too fast, which meant he wanted to accept all along. His issue was never the competition — it was the lack of a platform. Duke's show would give him one. The Frenemy seed planted itself quietly even on the Nemesis track.`),
  ],
  statUpdate:{
    title:'Counter Accepted',
    reason:'Duke controlled the terms. The event is booked on his calendar.',
    deltas:{ hustle:1, showmanship:1 },
    flags:{ fr2Danny02Done:true, fr2DannyEventDone:true, dannyChallenge:'counter', dannyEventOutcome:'counter_terms' }
  },
  next:'_hub_fr2'
},

fr2_danny_headtohead_decline: {
  art:'fr2', artLabel:'Free Roam 2 · Danny',
  bgText:'NO COMMENT',
  lines:[
    D(`Tell him I'm focused on my own calendar right now.`),
    N(`A pause.`),
    C('SANDRA',`That's a decline.`),
    D(`That's a statement of priorities.`),
    C('SANDRA',`He's going to say you're scared.`),
    D(`He's going to say that regardless.`),
    C('SANDRA',`Fair.`),
    N(`She printed: "Duke Harlan, through a spokesperson, declined to comment on Reeves' challenge, citing scheduling commitments."`),
    N(`Duke did not have a spokesperson. Sandra used the phrase anyway. It sounded better.`),
    N(`The circuit talked about it for two weeks. Danny, when asked, said: "I hope he's ready when the calendar clears." He said it pleasantly, which was the worst way to say it.`),
  ],
  statUpdate:{
    title:'Declined the Challenge',
    reason:"Danny's credibility dips slightly. The circuit will remember Duke didn't answer.",
    deltas:{},
    flags:{ fr2Danny02Done:true, fr2DannyEventDone:true, dannyChallenge:'decline' }
  },
  next:'_hub_fr2'
},

fr2_danny_headtohead_silence: {
  art:'fr2', artLabel:'Free Roam 2 · Danny',
  bgText:'NO ANSWER',
  lines:[
    N(`Duke didn't respond.`),
    N(`The circuit took that the way the circuit takes silence, which is as an answer.`),
    N(`Danny's next quote, one week later: "I guess he's busy."`),
    N(`It was a small quote. It landed large.`),
    N(`Duke's thought, privately: he wasn't scared. He just didn't want to give Danny the stage. The distinction felt important and also somewhat academic, given that the circuit had already made up its mind.`),
  ],
  statUpdate:{
    title:'No Answer Given',
    reason:'The circuit read the silence. Danny got the stage anyway.',
    deltas:{ showmanship:-1 },
    flags:{ fr2Danny02Done:true, fr2DannyEventDone:true, dannyChallenge:'silence' }
  },
  next:'_hub_fr2'
},

fr2_danny_03: {
  art:'fr2', artLabel:'Free Roam 2 · Danny',
  bgText:'AFTER',
  lines:[
    N(`He found Danny at the water barrel behind the venue about twenty minutes after everything.`),
    N(`Not intentionally. He'd gone for water.`),
    N(`Danny was already there. His jacket was off. Without it, he looked like what he was — a man who jumps motorcycles for a living, which meant he looked slightly worn and slightly careful and significantly more real than the jacket allowed.`),
    C('DANNY',`Harlan.`),
    D(`Danny.`),
    N(`The appropriate dialogue entered then, based on how the event went. They stood at the barrel. Danny refilled his cup and handed the ladle over without comment.`),
    N(`It was the closest they'd come to each other as people. Duke thought: this is the version of him nobody in the circuit sees. He didn't know what to do with that, so he did nothing with it and went back to the show.`),
  ],
  statUpdate:{
    title:'Water Barrel',
    reason:'No crowd. No jacket. Just two men who do the same thing.',
    deltas:{},
    flags:{ fr2Danny03Done:true }
  },
  next:'_hub_fr2'
},

/* --- FR2 Pete Mistake --- */
fr2_pete_02: {
  art:'fr2', artLabel:'Free Roam 2 · Pete',
  bgText:'THE MISTAKE',
  lines:[
    N(`Cal told him. Which meant Cal had heard it from someone, which meant it had moved through the county.`),
    C('CAL',`Your kid did a jump.`),
    D(`My kid.`),
    C('CAL',`Pete Garland. Community day at the park. Borrowed Elden Marsh's Honda.`),
    D(`How'd it go.`),
    C('CAL',`He went about fifteen feet. Didn't account for the grass.`),
    D(`He land it?`),
    C('CAL',`He landed something.`),
    N(`Duke thought about it.`),
    C('CAL',`He told the kids he learned from you.`),
    D(`Did he.`),
    C('CAL',`That's why I'm telling you.`),
    N(`He found Pete at the lot where Pete usually showed up.`),
  ],
  next:'fr2_pete_mistake_confrontation'
},

fr2_pete_mistake_confrontation: {
  art:'fr2', artLabel:'Free Roam 2 · Pete',
  bgText:'THE TALK',
  lines:[
    N(`Pete saw him coming and the expression on Pete's face was the expression of a sixteen-year-old who knows exactly what the conversation is going to be.`),
    C('PETE',`I was going to tell you.`),
    D(`Were you.`),
    C('PETE',`Yeah.`),
    D(`When?`),
    C('PETE',`...After.`),
    D(`After what?`),
    N(`Pete had the decency not to answer that.`),
  ],
  choices:[
    { label:'A', text:`Come down hard.`, subtext:"Make the authority clear. Pete stops overstepping.", effects:{ flags:{ fr2PeteMistakeDone:true, peteMistakeResponse:'hard' } }, goto:'fr2_pete_hard' },
    { label:'B', text:`Come down measured.`, subtext:"Best outcome — Pete understands without shutting down.", effects:{ flags:{ fr2PeteMistakeDone:true, peteMistakeResponse:'measured' } }, goto:'fr2_pete_measured' },
    { label:'C', text:`Let it go.`, subtext:"Pete will interpret this as permission.", effects:{ stats:{ nerve:-1 }, flags:{ fr2PeteMistakeDone:true, peteMistakeResponse:'soft' } }, goto:'fr2_pete_soft' },
    { label:'D', text:`"Why'd you do it?"`, subtext:"Pete's answer reveals his character. You learn something true.", effects:{ flags:{ fr2PeteMistakeDone:true, peteMistakeResponse:'why' } }, goto:'fr2_pete_why' },
  ]
},

fr2_pete_hard: {
  art:'fr2', artLabel:'Free Roam 2 · Pete',
  bgText:'THE LESSON',
  lines:[
    D(`You told those kids you learned from me.`),
    C('PETE',`I did learn from you.`),
    D(`And when you hit the grass in front of them, who does that land on?`),
    C('PETE',`Me.`),
    D(`You think those kids know the difference?`),
    N(`Pete looked at the ground.`),
    D(`You're not ready for a crowd. You know that.`),
    C('PETE',`I thought—`),
    D(`I know what you thought. You thought the feeling you get in practice is the same as the feeling in front of people. It's not. The crowd changes the math.`),
    C('PETE',`I wanted to see if I could do it.`),
    D(`Then do it in an empty field. You want to find out what you can do, find out what you can do. You want to perform — that's different. That's something you earn.`),
    N(`Pete nodded. He was sixteen; he was trying not to show how much the conversation was costing him.`),
    D(`You back here Thursday?`),
    C('PETE',`Yeah.`),
    D(`Then we'll work on the grass landing.`),
    N(`He walked off. It was not a warm conversation. It was the right one.`),
  ],
  statUpdate:{
    title:'Hard Lesson',
    reason:"Pete understands now. He won't overstep again. He'll get good on earned terms.",
    deltas:{},
    flags:{ fr2PeteMistakeDone:true }
  },
  next:'_hub_fr2'
},

fr2_pete_measured: {
  art:'fr2', artLabel:'Free Roam 2 · Pete',
  bgText:'THE CALIBRATION',
  lines:[
    D(`You hurt?`),
    C('PETE',`No.`),
    D(`The bike?`),
    C('PETE',`It's Elden Marsh's. He's not happy.`),
    D(`You pay him back?`),
    C('PETE',`I'm going to.`),
    D(`Okay.`),
    N(`Pete waited. This was the part where the speech arrived.`),
    D(`Why'd you do it?`),
    C('PETE',`I wanted to know if I was actually getting better or if I just felt better.`),
    D(`Did you find out?`),
    C('PETE',`I think so. I can do the jump. I can't do the landing on grass yet.`),
    D(`That's a useful thing to know.`),
    C('PETE',`I should've found it out somewhere else.`),
    D(`Yeah.`),
    N(`He looked at Pete for a moment.`),
    D(`Be here Thursday. We'll work on grass.`),
    N(`Pete nodded. He had the look of someone who had been through something and come out of it slightly more calibrated. Duke thought: that's actually the point. He didn't say it.`),
  ],
  statUpdate:{
    title:'Calibrated',
    reason:"Best outcome. Pete knows where he is. The relationship deepens on honest terms.",
    deltas:{ showmanship:1 },
    flags:{ fr2PeteMistakeDone:true }
  },
  next:'_hub_fr2'
},

fr2_pete_soft: {
  art:'fr2', artLabel:'Free Roam 2 · Pete',
  bgText:'LEFT ALONE',
  lines:[
    D(`How'd it feel?`),
    C('PETE',`Bad, mostly.`),
    D(`The jump or the fall?`),
    C('PETE',`Both.`),
    N(`Duke nodded. He didn't say anything else about it.`),
    N(`He should have said something else about it.`),
    N(`Pete came back Thursday like nothing had happened. Duke let it go because he didn't know what the right thing to say was and so he said nothing. That was a choice — it just didn't feel like one.`),
    N(`Pete tried a bigger jump without asking, six weeks later. He went to the hospital for three days. It wasn't Duke's fault. The narration noted, briefly, that it also wasn't entirely not Duke's fault.`),
  ],
  statUpdate:{
    title:'Let It Go',
    reason:"Pete interpreted the silence as permission. The next mistake was bigger.",
    deltas:{ nerve:-1 },
    rels:{ pete:'absent' },
    flags:{ fr2PeteMistakeDone:true, peteMistakeResponse:'soft', peteGone:true }
  },
  next:'_hub_fr2'
},

fr2_pete_why: {
  art:'fr2', artLabel:'Free Roam 2 · Pete',
  bgText:'THE REAL QUESTION',
  lines:[
    D(`Why'd you do it?`),
    N(`Pete hadn't expected the question. He'd expected the speech.`),
    C('PETE',`I — I don't know. I just—`),
    D(`Take a minute.`),
    N(`Pete took a minute.`),
    C('PETE',`I wanted to know if they'd watch. Like, if the kind of people who show up to community day — if they'd look at me the way people look at you.`),
    D(`Did they?`),
    C('PETE',`Before the grass, kind of.`),
    D(`And after?`),
    C('PETE',`Not the same way.`),
    N(`Duke looked at him. He thought: Performer origin. He thought: I know this kid. I was this kid.`),
    D(`The watching part's a drug.`),
    C('PETE',`Yeah.`),
    D(`You know what the problem with a drug is.`),
    C('PETE',`You need more of it.`),
    D(`Right. You need to earn the watching. Not because of some rule. Because if you don't earn it, the watching doesn't fill the thing you're trying to fill.`),
    N(`Pete looked at him.`),
    C('PETE',`Did it? For you?`),
    D(`Sometimes.`),
    C('PETE',`Not always?`),
    D(`Not always.`),
    N(`The most honest thing Duke had said to another person in a while. It surprised him.`),
  ],
  statUpdate:{
    title:'The Honest Answer',
    reason:"Pete heard something real. So did Duke. The relationship has a new depth.",
    deltas:{ nerve:1 },
    flags:{ fr2PeteMistakeDone:true, peteMistakeResponse:'why' }
  },
  next:'_hub_fr2'
},

/* --- FR2 Ruthie 02 --- */
fr2_eve_ruthie_02: {
  art:'fr2', artLabel:'Free Roam 2 · Evening',
  bgText:'THE QUESTION',
  lines:[
    N(`She asked him one evening, out of nowhere:`),
    C('RUTHIE',`What do you get out of it?`),
    D(`Out of what?`),
    C('RUTHIE',`You know what.`),
    N(`He did know. He thought about it for a moment — not performing thought, actually thinking.`),
  ],
  choices:[
    { label:'A', text:`"The feeling. Between the ramp and the landing."`, subtext:'The honest answer. She receives it.', effects:{ rels:{ ruthie:'solid' }, flags:{ ruthieAsked:true } }, goto:'fr2_ruthie_q_a' },
    { label:'B', text:`"The crowd."`, subtext:"Performer-honest. She'll probe further.", effects:{ flags:{ ruthieAsked:true } }, goto:'fr2_ruthie_q_b' },
    { label:'C', text:`"The money."`, subtext:'Deflection. She knows it.', effects:{ flags:{ ruthieAsked:true } }, goto:'fr2_ruthie_q_c' },
    { label:'D', text:`"I don't know."`, subtext:'Unexpected honesty. She sits with it.', effects:{ rels:{ ruthie:'solid' }, flags:{ ruthieAsked:true, ruthieDontKnow:true } }, goto:'fr2_ruthie_q_d' },
  ]
},

fr2_ruthie_q_a: {
  art:'fr2', artLabel:'Free Roam 2 · Evening',
  bgText:'QUIET',
  lines:[
    D(`The feeling. Between the ramp and the landing.`),
    C('RUTHIE',`What does it feel like?`),
    D(`Like the only time everything's quiet.`),
    N(`She looked at him for a long moment.`),
    C('RUTHIE',`Okay.`),
    D(`That's it? Okay?`),
    C('RUTHIE',`What do you want me to say?`),
    D(`I don't know.`),
    C('RUTHIE',`I asked because I wanted to know. Now I know.`),
    N(`She went back to what she was doing. He thought that was probably the most important conversation they'd ever had, and they'd had it in about forty seconds.`),
  ],
  statUpdate:{
    title:'The Honest Answer',
    reason:"She knows now. Something settled between them.",
    deltas:{ nerve:1 },
    flags:{}
  },
  next:'_hub_fr2'
},

fr2_ruthie_q_b: {
  art:'fr2', artLabel:'Free Roam 2 · Evening',
  bgText:'THE CROWD',
  lines:[
    D(`The crowd.`),
    N(`She looked at him.`),
    C('RUTHIE',`All of it? Just the crowd?`),
    D(`It's not nothing.`),
    C('RUTHIE',`I know it's not nothing. I'm asking if you'd do it in an empty field.`),
    N(`He thought about it. The honest answer surprised him.`),
    D(`Yeah. I think I would.`),
    C('RUTHIE',`Then it's not just the crowd.`),
    N(`She said it like she'd been trying to locate something and had now located it.`),
  ],
  statUpdate:{
    title:'Not Just the Crowd',
    reason:"Ruthie's logic cuts against the easy answer. Duke found something truer.",
    deltas:{},
    flags:{ ruthieAsked:true }
  },
  next:'_hub_fr2'
},

fr2_ruthie_q_c: {
  art:'fr2', artLabel:'Free Roam 2 · Evening',
  bgText:'DEFLECTION',
  lines:[
    D(`The money.`),
    N(`She looked at him.`),
    C('RUTHIE',`Duke.`),
    D(`It pays well.`),
    C('RUTHIE',`You were doing it before it paid anything.`),
    N(`He didn't answer. She let the silence do the work, the way she sometimes did.`),
    C('RUTHIE',`You don't have to tell me.`),
    D(`I know.`),
    C('RUTHIE',`But you should probably know yourself.`),
    N(`She said it without edge. That was worse somehow — if she'd been angry, he could have been angry back.`),
  ],
  statUpdate:{
    title:'Deflection Noted',
    reason:"She filed it away. Not as a grievance. As information.",
    deltas:{},
    flags:{ ruthieAsked:true, ruthieStrainSeed:true }
  },
  next:'_hub_fr2'
},

fr2_ruthie_q_d: {
  art:'fr2', artLabel:'Free Roam 2 · Evening',
  bgText:'I DON\'T KNOW',
  lines:[
    D(`I don't know.`),
    N(`She hadn't expected that.`),
    N(`He could tell because she looked up from what she'd been doing and just looked at him — not probing, not solving, just looking, like he'd said something that required being in the room with.`),
    C('RUTHIE',`Okay.`),
    D(`That's not a satisfying answer.`),
    C('RUTHIE',`It's an honest one.`),
    N(`She went back to what she was doing. After a while she said, not looking up:`),
    C('RUTHIE',`You don't have to know why. You just have to know that you do.`),
    N(`He thought about that for a long time afterward. He wasn't sure it was right. He wasn't sure it was wrong.`),
  ],
  statUpdate:{
    title:'The Honest Uncertainty',
    reason:"She gave him something to carry. It'll surface at the right moment.",
    deltas:{ nerve:1 },
    flags:{ ruthieAsked:true, ruthieDontKnow:true }
  },
  next:'_hub_fr2'
},

/* --- FR2 Cal 02 --- */
fr2_eve_cal_02: {
  art:'fr2', artLabel:'Free Roam 2 · Evening',
  bgText:'BIKE\'S RIGHT',
  lines:[
    N(`It happened on a Tuesday. Not even a show night — just a Tuesday, Cal under the bike, Duke sitting on an overturned bucket watching him work.`),
    D(`You'd tell me if something was wrong with it.`),
    C('CAL',`I'm a mechanic. That's all I do.`),
    D(`I mean before I ride it.`),
    C('CAL',`I know what you meant.`),
    N(`A pause. Cal kept working.`),
    C('CAL',`That what you're worried about?`),
    D(`I'm not worried.`),
    C('CAL',`Mm.`),
    N(`Another pause. Cal set down the wrench.`),
    C('CAL',`The bike's right. I'll tell you when it isn't.`),
    D(`Okay.`),
    C('CAL',`You could just ask about the bike.`),
    D(`I am asking about the bike.`),
    N(`Cal looked at him. Then he picked the wrench back up.`),
    C('CAL',`Bike's right.`),
  ],
  statUpdate:{
    title:'Bike\'s Right',
    reason:"Cal said it. That's the whole conversation.",
    deltas:{ nerve:1 },
    flags:{ fr2Cal02Done:true }
  },
  next:'_hub_fr2'
},

/* ============================================================
   FREE ROAM 3 — THE PRICE OF FAME
   ============================================================ */

fr3_hub_open: {
  art:'fr3', artLabel:'Free Roam 3',
  bgText:'WHAT COMES NEXT',
  lines:[
    N(`The show was done. Not the career — just the show. There was a difference. He was getting better at knowing the difference.`),
    N(()=> solo()
      ? `Cal had a trailer to load. The TV people had their tape. The calls were his to make, and he would make them Monday.`
      : `Earl had calls to make. Cal had a trailer to load. The TV people had their tape.`),
    N(`Duke sat on the tailgate in the empty lot and looked at where the five cars had been and thought about whatever came after five cars.`),
    N(`There was going to be a whatever-came-after. He'd known it since before the stunt. You don't clear something like that and walk away from the thing that got you there. You walk toward the next version of it.`),
    N(`The circuit was talking. The papers had a story. A man from Los Angeles had been in the fourth row.`),
    N(`Duke thought: I have some time before all of that becomes the next thing.`),
    N(`He thought: I should use it well.`),
  ],
  next:'_hub_fr3'
},

fr3_eve_earl: {
  art:'fr3', artLabel:'Free Roam 3 · Earl',
  bgText:'RENEGOTIATION',
  lines:[
    N(`Earl came to him, not the other way around. That was the first tell.`),
    N(`He sat down across the table with a folder and a glass of water and said what he'd come to say with the specific directness he used when he'd already decided something.`),
    C('EARL',`The Dallas show changed some numbers. I want to talk about them.`),
    D(`What numbers.`),
    C('EARL',`The split.`),
    N(`Duke looked at him.`),
    C('EARL',`You've earned a better split. I'm not saying that as a favor. I'm saying it because the man from Los Angeles wants to do business, and to do business with him I need you to be a partner in this, not a performer on salary.`),
    N(`He waited. Duke thought about the clause — the exclusivity clause, the thing from M2 that was still in the contract somewhere. He thought about the tell.`),
  ],
  choices:[
    { label:'A', text:`"What's the new number?"`, subtext:"Engage. See what he's actually offering.", effects:{ stats:{ hustle:1 }, flags:{ fr3EarlTalked:true } }, goto:'fr3_eve_earl_engage' },
    { label:'B', text:`"I want Cal in the room."`, subtext:"If this is a real conversation, it's a real meeting.", effects:{ stats:{ hustle:1 }, rels:{ cal:'loyal' }, flags:{ fr3EarlTalked:true } }, goto:'fr3_eve_earl_cal' },
    { label:'C', text:`"Let me read it before we talk."`, subtext:'The contract first. The conversation after.', effects:{ stats:{ hustle:1 }, flags:{ fr3EarlTalked:true } }, goto:'fr3_eve_earl_read' },
  ]
},

fr3_eve_earl_engage: {
  art:'fr3', artLabel:'Free Roam 3 · Earl',
  bgText:'THE NEW NUMBER',
  lines:[
    D(`What's the new number.`),
    C('EARL',`Sixty-forty. Your favor.`),
    N(`Duke looked at him for a moment.`),
    D(`What's in the new clause.`),
    N(`Earl didn't blink.`),
    C('EARL',`Extension. Five years instead of three.`),
    N(`Duke thought: there it is. The thing under the thing. The better split was real. The extension was the cost.`),
    D(`I'll need a few days.`),
    C('EARL',`Take the week.`),
    N(`He said it like a man who was already planning around the answer.`),
  ],
  statUpdate:{
    title:'The New Numbers',
    reason:"Sixty-forty. Five-year extension. Duke has the week to decide.",
    deltas:{ hustle:1 },
    flags:{ fr3EarlDeal:'pending' }
  },
  next:'_hub_fr3'
},

fr3_eve_earl_cal: {
  art:'fr3', artLabel:'Free Roam 3 · Earl',
  bgText:'CAL IN THE ROOM',
  lines:[
    D(`I want Cal in the room.`),
    N(`Earl looked at him.`),
    C('EARL',`Cal's a mechanic.`),
    D(`He's been in every important conversation I've had. He should be in this one.`),
    N(`A pause. Earl decided something.`),
    C('EARL',`Fine. Get him.`),
    N(`Cal, when Duke found him, wiped his hands on a rag and looked at Duke and said nothing, which was Cal accepting.`),
    N(`The meeting went differently with Cal in it — not because Cal said much. He said almost nothing. But Earl was aware of him the whole time, which changed the geometry of what Earl was willing to put on the table.`),
    N(`The split came in at sixty-five/thirty-five. The extension was three years, not five. Cal had said one thing: he'd looked at the paper and said, "Three years is a fair number," and Earl had looked at him and then at Duke and agreed.`),
    N(`Duke looked at Cal afterward and Cal said: "Bike's right."`)
  ],
  statUpdate:{
    title:'Cal in the Room',
    reason:"The numbers got better. Cal being there changed what Earl put on the table.",
    deltas:{ hustle:2 },
    rels:{ cal:'loyal', earl:'mentor' },
    flags:{ fr3EarlDeal:'signed', fr3EarlCalTalked:true }
  },
  next:'_hub_fr3'
},

fr3_eve_earl_read: {
  art:'fr3', artLabel:'Free Roam 3 · Earl',
  bgText:'READ IT FIRST',
  lines:[
    D(`Let me read it before we talk.`),
    N(`Earl slid the folder across. Duke took it.`),
    N(`He read it on the drive home. He read it again in the kitchen. The split was real — sixty-forty. The extension was five years. The clause on page seven was new: Earl got first right of refusal on any television deal Duke entered.`),
    N(`Duke sat with that for a while. Television was the next thing. Earl knew it was the next thing. Page seven meant Earl wanted to be in the next thing too, on his terms.`),
    N(`He called Earl the next morning.`),
    D(`Page seven.`),
    C('EARL',`What about it.`),
    D(`Take it out.`),
    N(`A pause. The long kind.`),
    C('EARL',`Three years on the extension.`),
    D(`Deal.`),
    N(`He hung up. He thought: that was a negotiation. He'd had them before. This one felt different — like the first time he'd known exactly what the other person wanted before he asked for it.`),
  ],
  statUpdate:{
    title:'Read the Contract',
    reason:"Page seven removed. Extension to three years. Duke knew what he was giving up before he gave it up.",
    deltas:{ hustle:2 },
    flags:{ fr3EarlDeal:'signed_clean' }
  },
  next:'_hub_fr3'
},

fr3_eve_ruthie: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'SHE SAW IT',
  lines:[
    N(`She came to find him two days after the show. Not the day of — she'd given him a day, which was Ruthie's version of space.`),
    N(`They sat on his front porch. She had coffee.`),
    C('RUTHIE',`I was in the sixth row.`),
    D(`I know. I saw you.`),
    C('RUTHIE',`Could you see me from the ramp?`),
    D(`I can always see you from the ramp.`),
    N(`She looked at her coffee.`),
    C('RUTHIE',`The fourth car — when you went sideways—`),
    D(`It was fine.`),
    C('RUTHIE',`I know it was fine. I was there. I'm not asking about the fourth car. I'm telling you what I saw.`),
    N(`He let her.`),
    C('RUTHIE',`It was close.`),
    N(`He didn't argue with that.`),
  ],
  choices:[
    { label:'A', text:`"Yes. It was."`, subtext:'Give her the truth of it.', effects:{ rels:{ ruthie:'solid' } }, goto:'fr3_ruthie_honest' },
    { label:'B', text:`"I had it the whole time."`, subtext:"Not a lie. Not the whole truth.", effects:{}, goto:'fr3_ruthie_deflect' },
    { label:'C', text:`"What do you need from me right now?"`, subtext:"Ask instead of answer.", effects:{ rels:{ ruthie:'solid' }, stats:{ nerve:1 } }, goto:'fr3_ruthie_ask' },
  ],
  _gateRoute: ()=> GS.flags.ruthieAsked ? 'fr3_ruthie_already_asked' : null
},
fr3_ruthie_honest: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'YES',
  lines:[
    D(`Yes. It was.`),
    N(`She nodded. She looked at the road.`),
    C('RUTHIE',`I want to ask you something.`),
    N(`He waited. This was the question — he could feel it coming, the one he'd been carrying since she'd asked in Free Roam 2 or the one she'd been building to since then.`),
    C('RUTHIE',`What do you get out of it?`),
    N(`He'd heard that question before from her. This time it landed differently. She'd been at the show. She'd seen the fourth car.`),
    D(`The same thing I always get.`),
    C('RUTHIE',`And is it still worth it?`),
    N(`He thought about that for a real moment. He thought about the fourth car. He thought about the back wheel on the mat. He thought about the way the crowd noise arrived all at once, like weather.`),
    D(`Yeah.`),
    N(`She looked at him.`),
    C('RUTHIE',`Okay.`),
    N(`Not resigned — decided. She'd done the calculation too, at some point between the sixth row and this porch. He thought: she's going to keep watching. She's going to keep being here. She'd decided that, and she was telling him without making it a speech.`),
  ],
  statUpdate:{
    title:'Honest Answer',
    reason:"She knows now. She stayed with the answer. That means something.",
    deltas:{ nerve:1 },
    rels:{ ruthie:'solid' },
    flags:{ fr3RuthieTalked:true }
  },
  next:'_hub_fr3'
},

fr3_ruthie_deflect: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'I HAD IT',
  lines:[
    D(`I had it the whole time.`),
    N(`She looked at him. The look lasted about a second longer than comfortable.`),
    C('RUTHIE',`Duke.`),
    D(`I'm serious. The correction was already happening before—`),
    C('RUTHIE',`I know what I saw.`),
    N(`A pause.`),
    N(`He thought about arguing and decided it would be the wrong kind of argument. The kind you can't win because the other person was there.`),
    D(`It was close.`),
    N(`She nodded. That was the end of it. They sat with it for a while.`),
  ],
  statUpdate:{
    title:'Not the Whole Truth',
    reason:"She knew. He eventually gave her the truth. They sat with it.",
    deltas:{},
    flags:{ fr3RuthieTalked:true }
  },
  next:'_hub_fr3'
},

fr3_ruthie_ask: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'WHAT DO YOU NEED',
  lines:[
    D(`What do you need from me right now?`),
    N(`She looked at him. He'd surprised her.`),
    C('RUTHIE',`That's not how you usually ask questions.`),
    D(`I know.`),
    N(`She thought about it. She set down her coffee.`),
    C('RUTHIE',`I need you to not pretend it wasn't close.`),
    D(`It was close.`),
    C('RUTHIE',`I know. I was there.`),
    D(`I know you were there.`),
    N(`A pause. She picked up her coffee again.`),
    C('RUTHIE',`That's it. That's all I needed.`),
    N(`He thought: that's the thing about Ruthie. She doesn't need a lot. She needs it to be real.`),
  ],
  statUpdate:{
    title:'What She Needed',
    reason:"The honest acknowledgment. She got it. The relationship holds.",
    deltas:{ nerve:1 },
    rels:{ ruthie:'solid' },
    flags:{ fr3RuthieTalked:true }
  },
  next:'_hub_fr3'
},

fr3_eve_cal: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'THE NEXT ONE',
  lines:[
    N(`Cal had a question.`),
    N(`He asked it sideways, the way he asked things — through the bike, not at Duke.`),
    C('CAL',`You're going to want more distance.`),
    D(`Probably.`),
    C('CAL',`What are you thinking.`),
    D(()=> solo() ? `I'm thinking about buses.` : `Earl's talking about buses.`),
    N(`Cal set down the wrench.`),
    N(`That was a thing Cal did when the conversation had moved past maintenance into something else.`),
    C('CAL',`How many.`),
    D(`I don't know yet. Depends on the venue.`),
    C('CAL',`Buses are different from cars.`),
    D(`I know.`),
    C('CAL',`Higher center of gravity. If you clip one it doesn't just fall — it moves wrong.`),
    D(`I know.`),
    N(`Cal picked up the wrench. He turned it in his hands.`),
    C('CAL',`How much time do we have.`),
    N(`And there it was — the *we.* Not a question about the schedule. A statement about who was going.`),
    D(`Six months. Maybe eight.`),
    C('CAL',`That's enough time.`),
    D(`Is it?`),
    C('CAL',`To do it right. Yeah.`),
    N(`He went back to work. Duke sat with the word *right* for a while.`),
  ],
  statUpdate:{
    title:'Six Months',
    reason:"Cal's in. The planning starts now. Buses are different from cars — he's already thinking about how.",
    deltas:{ precision:1 },
    rels:{ cal:'loyal' },
    flags:{ fr3CalTalked:true, nextStuntBuses:true }
  },
  next:'_hub_fr3'
},

fr3_eve_tommy: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'SOMETHING TRUE',
  lines:[
    N(`Tommy found him at the bar after the Dallas coverage ran in the regional paper. He'd been there a while before Duke arrived, which was a certain kind of tell.`),
    C('TOMMY',`I saw the piece.`),
    D(`Sandra's piece?`),
    C('TOMMY',`She wrote you up good.`),
    D(`She writes what she sees.`),
    C('TOMMY',`She sees you pretty clearly.`),
    N(`Tommy looked at his drink. He was in that mode Duke recognized — not drunk enough to be incoherent, not sober enough to be performing. The mode where things came out true.`),
    C('TOMMY',`I've been doing the Hinkle lot jumps.`),
    D(`I know.`),
    C('TOMMY',`You heard.`),
    // Phase 4. He told Duke himself, at the Nail, if Duke ever asked.
    D(()=> GS.flags.tommyAsked
      ? `You told me. At the Nail, before any of this started.`
      : `Cal mentioned it.`),
    N(`Tommy nodded. He picked up his glass and set it down.`),
    C('TOMMY',`The crowd's small. Twelve, fifteen people. Half of them are there for the used cars.`),
    D(`But they watch.`),
    C('TOMMY',`Yeah. They watch.`),
    N(`He said it like the two words meant more than two words, which they did.`),
    C('TOMMY',()=> solo()
      ? `I thought I wanted what you have. The big crowds. The Speedway. Sandra writing about me.`
      : `I thought I wanted what you have. The big crowds. Earl. Sandra writing about me.`),
    D(`Do you?`),
    N(`Tommy looked at his drink for a while. A real while.`),
    C('TOMMY',`I think I want the twelve people who are there for me.`),
    N(`He said it like he was discovering it as he said it. Duke thought: that's the most honest thing Tommy has ever said. Possibly the most honest thing he's capable of saying. He thought: Tommy is figuring himself out, which was something Tommy had needed to do for a long time.`),
    N(`He didn't say any of that. He had to say something.`),
  ],
  // Phase 4. The other end of Tommy's track, and the only way he leaves the
  // story. `TOMMY_NOT_GONE` gated this card on a state he could not hold for
  // the game's whole life; after this it is a gate that can actually close.
  choices:[
    { label:'A', text:`"That's a good thing to want."`,
      subtext:'Say it flat. Let it be true.',
      effects:{ stats:{ showmanship:1 } },
      goto:'fr3_eve_tommy_true' },
    { label:'B', text:`"Twelve people isn't a career."`,
      subtext: `Measure it against what you have. He half asked you to.`,
      goto:'fr3_eve_tommy_measured' },
  ]
},
fr3_eve_tommy_true: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'SOMETHING TRUE',
  lines:[
    D(`That's a good thing to want.`),
    C('TOMMY',`Yeah?`),
    D(`Yeah.`),
    N(`Tommy nodded. He drank. He was quiet for a while after, which was its own kind of answer.`),
    N(`He said, at the door, that the Hinkle crowd was going to be nineteen next time, because the lot next door had started doing a chicken thing on the same afternoon. He had counted ahead. Duke thought about that the whole drive back.`),
  ],
  statUpdate:{
    title:'Something True',
    reason:"Tommy said the thing he needed to say. Duke let him say it.",
    deltas:{},
    rels:{ tommy:'ally' },
    flags:{ fr3TommyTalked:true, tommyKnowsWhatHeWants:true }
  },
  next:'_hub_fr3'
},
fr3_eve_tommy_measured: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'TWELVE PEOPLE',
  lines:[
    D(`Twelve people isn't a career.`),
    N(`It came out of him in somebody else's cadence. Sandra's, or the regional paper's, or the man who reads the introduction before a show. Not his own.`),
    N(`Tommy didn't argue. That was the part Duke thought about later. Tommy argued about everything, all the time, cheerfully, for sport, and he did not argue about this.`),
    C('TOMMY',`No. Probably not.`),
    N(`He finished his drink. He paid for it himself, which he never did when Duke was at the table, and he said something about Sunday and the lot and getting out ahead of the weather.`),
    N(`He was not at the bar the next week, or the week after. Cal mentioned, without being asked, that Tommy was still doing the Hinkle jumps. Duke said good. That was where it stayed.`),
  ],
  statUpdate:{
    title:'Twelve People',
    reason:"He offered the one honest thing he had. Duke measured it against something else.",
    deltas:{},
    rels:{ tommy:'absent' },
    flags:{ fr3TommyTalked:true }
  },
  next:'_hub_fr3'
},

/* --- FR3 Day Scenes --- */
fr3_hollis: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'REVEREND',
  lines:[
    N(`Hollis found him at the hardware store, which was the kind of thing that only happened in a town like this — the man who protested your shows and the man whose shows were protested, buying materials in the same aisle.`),
    N(`He had a sign under his arm. Not the usual one — a new one, plywood, freshly painted. Duke looked at it. It said: HAVE YOU CONSIDERED WHAT COMES AFTER.`),
    D(`Reverend.`),
    C('HOLLIS',`Duke.`),
    N(`A pause. They were both looking at the same stretch of shelf.`),
    C('HOLLIS',`I was at the Dallas show.`),
    D(`I know. You're always at the shows.`),
    C('HOLLIS',`I've been at every one.`),
    D(`I know.`),
    N(`Hollis set the sign down.`),
    C('HOLLIS',`I've been asking you to stop for six years.`),
    D(`I know.`),
    C('HOLLIS',`I'm not going to ask you to stop.`),
    N(`Duke looked at him.`),
    C('HOLLIS',`I've been watching you for six years. I don't think stopping is the point. I think the question is what you're going toward.`),
    N(`He said it without righteousness, which was not how Hollis usually said things. This was a different mode.`),
    C('HOLLIS',`You cleared five cars and I watched the crowd and do you know what they felt?`),
    D(`What.`),
    C('HOLLIS',`The same thing they feel in a pew. Which is not nothing. It's just not enough by itself.`),
    N(`Duke looked at the sign. HAVE YOU CONSIDERED WHAT COMES AFTER.`),
    D(`I've thought about it.`),
    C('HOLLIS',`Good.`),
    N(`He picked up the sign. He bought his materials. He left.`),
    N(`Duke stood in the hardware store aisle for a moment. He thought: that was not the conversation he expected. He thought about what Hollis had said — the crowd, the pew, the same feeling. He didn't know what to do with it. He filed it anyway.`),
  ],
  statUpdate:{
    title:'Hollis at the Hardware Store',
    reason:"Not a protest. Something else. Duke heard it.",
    deltas:{ showmanship:1, nerve:1 },
    flags:{ fr3HollisTalked:true }
  },
  next:'_hub_fr3'
},

fr3_press_sandra: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'BIGGER OFFER',
  lines:[
    N(`Sandra called on a Wednesday. She'd been calling on Wednesdays for two years now. Duke had stopped being surprised by the Wednesdays.`),
    C('SANDRA',`I have something I want to discuss.`),
    D(`All right.`),
    C('SANDRA',`The regional TV station wants to do a profile. Not a spot — a real feature. Thirty minutes, prime time, regional broadcast.`),
    N(`Duke said nothing.`),
    C('SANDRA',`I'm the reporter attached to it. Meaning I'd write the piece and conduct the interview. The station does the production.`),
    D(()=> solo() ? `Who else knows about this.` : `What does Earl know about this.`),
    C('SANDRA',()=> solo() ? `Nobody yet. That's why I'm calling you first.` : `Nothing yet. That's why I'm calling you first.`),
    N(()=> solo()
      ? `Duke thought about that. He thought about the fact that there was no page seven. No television clause, no first right of refusal, nobody's signature on what he could say into a camera but his own. It was the thing he'd chosen. It was also, he noticed, a thing nobody had ever asked him to read.`
      : `Duke thought about that. He thought about page seven of the new contract — the television clause. He thought about Earl's version of first right of refusal.`),
    N(`He thought about the man from Los Angeles in the fourth row.`),
    D(`How much time do I have.`),
    C('SANDRA',`Two weeks to decide. They want to air before end of quarter.`),
  ],
  choices:[
    { label:'A', text:`"I'm in. Set it up."`, subtext:()=> solo() ? 'Move fast. Nobody else is going to.' : 'Move fast. Control the narrative before Earl does.', effects:{ stats:{ showmanship:2 }, flags:{ fr3SandraTV:true, sandraResponse:'accept' } }, goto:'fr3_press_sandra_accept' },
    { label:'B', text:()=> solo() ? `"I need to check something first."` : `"I need to check something in my contract first."`, subtext:()=> solo() ? "The Speedway's Friday card. Kessler gets a call." : 'Page seven. Earl gets a call.', effects:{ stats:{ hustle:1 }, flags:{ fr3SandraTV:true, sandraResponse:'check' } }, goto:'fr3_press_sandra_check' },
    { label:'C', text:`"Tell them I want approval over the narrative."`, subtext:'You want control. Sandra will negotiate it.', effects:{ stats:{ showmanship:1, hustle:1 }, flags:{ fr3SandraTV:true, sandraResponse:'control' } }, goto:'fr3_press_sandra_control' },
  ]
},

fr3_press_sandra_accept: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'SET IT UP',
  get lines(){
    const head = [
    D(`I'm in. Set it up.`),
    N(`A pause.`),
    C('SANDRA',`That's fast.`),
    D(`Is that a problem?`),
    C('SANDRA',`No. I just — okay. I'll set it up.`),
    ];
    const feature = N(`The feature ran six weeks later. Thirty minutes, prime time. Sandra asked two questions that were harder than they sounded. Duke answered them the way he'd learned to answer things: directly, and only as much as was true.`);
    if(solo()) return [...head,
    N(`Duke hung up. He noticed there was nobody to call next — that on the other side of things, this was where you called the man with the calendar. He called Cal.`),
    C('CAL',`Okay.`),
    N(`That was the whole call.`),
    feature,
    N(`The man from Los Angeles called the Speedway office the day after it aired. Kessler gave him Duke's number, and then called Duke to say she had.`),
    ];
    return [...head,
    N(`Duke hung up and then called Earl, which was the right order. He told Earl what was happening. Earl was quiet for a moment.`),
    C('EARL',`You called her before me.`),
    D(`She called me first.`),
    C('EARL',`I see.`),
    N(`He said it in a way that had two meanings. Duke filed both of them.`),
    feature,
    N(`The man from Los Angeles called Earl the day after it aired.`),
    ];
  },
  statUpdate:{
    title:'Regional TV Feature',
    reason:"Thirty minutes, prime time. The profile ran. The man from LA made the call.",
    deltas:{ showmanship:2 },
    flags:{ sandraFeatureDone:true }
  },
  next:'_hub_fr3'
},

fr3_press_sandra_check: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'PAGE SEVEN',
  lines:[
    D(()=> solo() ? `I need to check something first.` : `I need to check something in my contract first.`),
    C('SANDRA',()=> solo() ? `The Friday card.` : `The television clause.`),
    D(`You know about it.`),
    C('SANDRA',`I'm a reporter.`),
    N(`Duke thought: of course she does.`),
    D(`I'll call you in two days.`),
    N(()=> solo()
      ? `He called Kessler. Kessler already knew — Sandra had reached out to the Speedway the same day, which was Sandra being a reporter.`
      : `He called Earl. Earl already knew — Sandra had apparently reached out to him the same day, which was Sandra being a reporter.`),
    N(()=> solo()
      ? `The negotiation between Duke and the station lasted four days, with nobody in the middle. The result: Duke did the feature, the station paid an appearance fee that went straight into the notebook against the cars, and Sandra wrote the piece the way she wrote all her pieces — without asking anyone's permission for the important parts.`
      : `The negotiation between Earl and the station, with Duke in the middle, lasted four days. The result: Duke did the feature, Earl got a consulting credit and a production fee, and Sandra wrote the piece the way she wrote all her pieces — without asking anyone's permission for the important parts.`),
    N(()=> solo()
      ? `Duke thought: it worked out. He also thought: four days on the phone is what a percentage buys you. He thought: I'd still rather have the four days.`
      : `Duke thought: it worked out. He also thought: Earl will do something with that consulting credit.`),
  ],
  statUpdate:{
    title:()=> solo() ? 'Checked the Card' : 'Checked the Contract',
    reason:()=> solo()
      ? "No consulting credit. Four days on the phone. The feature ran, and the fee went against the cars."
      : "Earl got his consulting credit. The feature ran. Duke knows more about how Earl operates than he did before.",
    deltas:{ hustle:1, showmanship:1 },
    flags:{ sandraFeatureDone:true }
  },
  next:'_hub_fr3'
},

fr3_press_sandra_control: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'THE NARRATIVE',
  lines:[
    D(`Tell them I want approval over the narrative.`),
    N(`A pause.`),
    C('SANDRA',`They won't give you that.`),
    D(`Then we negotiate down to something.`),
    C('SANDRA',`Duke. I'm the one who writes it.`),
    N(`He thought about that.`),
    D(`What do you want out of this piece?`),
    C('SANDRA',`The true version.`),
    D(`That's what I want too.`),
    C('SANDRA',`Then we're already in agreement.`),
    N(`The feature ran without narrative approval from Duke. It was the true version, which was most of what he'd wanted. There was one line — about the county fair, about the way Cal had been standing twenty feet away after the landing — that Duke read seventeen times.`),
    N(`It wasn't wrong. That was the thing. It was just very true.`),
  ],
  statUpdate:{
    title:'The True Version',
    reason:"Sandra wrote what she saw. It was true. Duke read it seventeen times.",
    deltas:{ showmanship:2 },
    flags:{ sandraFeatureDone:true }
  },
  next:'_hub_fr3'
},

/* --- FR3 Danny — somebody else signed him (Phase 4) ---------------------
   Danny Reeves could only ever be `frenemy` or `nemesis`, both written in
   Free Roam 2, and the epilogue's table had labels for `poached` and `absent`
   that no run could reach. This is the card that reaches them. It pays off
   the thing Tommy says at the Free Roam 2 bar — "he's going to end up on TV"
   — and it is Duke's answer, not the signing, that decides which of the two
   states the ending screen prints. Nothing here names Earl on the solo
   branch: from Milestone 3 on, that is the rule (decision #265) and
   smoke-page.mjs fails on a violation. */
fr3_danny: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'SIGNED',
  lines:[
    N(()=> solo()
      ? `Sandra had it before the circuit papers did. A syndicate out of Fort Worth had signed Diamondback Danny for twelve half-hours. Studio audience, a ramp built indoors, a man in a jacket saying the name.`
      : `Sandra had it before the circuit papers did. Earl Maddox had signed Diamondback Danny. Same office, same letterhead, a Thursday.`),
    C('SANDRA',`I wanted you to hear it from me.`),
    D(`Why?`),
    C('SANDRA',`Because you're going to hear it from four people today and I'd like to have been the first one.`),
    N(()=> solo()
      ? `Twelve half-hours. Duke did the arithmetic on the back of an envelope while she was still talking, and the number at the end of it was larger than every gate he had taken that year put together.`
      : `Duke sat with it. It was not a betrayal — there was nothing in the contract about a roster of one, and he had read the contract — but it was a fact with a shape, and the shape took a while to turn around.`),
    // Tommy's Free Roam 2 theory, which only a run that spent that evening
    // heard. `fr2EveningsDone` carries both arms of the bar night — the theory
    // is in the shared lines above the fork.
    N(()=> (GS.flags.fr2EveningsDone || []).includes('fr2_eve_bar')
      ? `Tommy had said it at a bar in the spring. He had said it about the name. He had been right about the name.`
      : `Somebody had told him this was coming, months back, and he could not now remember who, which bothered him more than the news did.`),
    N(`Sandra waited. She had the patience of somebody who does this for a living.`),
  ],
  choices:[
    { label:'A', text:`"Get me his number."`,
      subtext:'Say it to him. Whatever it turns out to be.',
      effects:{ stats:{ showmanship:1 } },
      goto:'fr3_danny_call' },
    { label:'B', text:`"Nothing from me."`,
      subtext:"Let him have it. Let the calendar do the rest.",
      goto:'fr3_danny_quiet' },
  ]
},
fr3_danny_call: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'THE CALL',
  lines:[
    N(`He called from the shop phone, with Cal pretending to be busy eight feet away.`),
    C('DANNY',`Duke Harlan.`),
    D(`Congratulations.`),
    N(`A pause long enough that Duke checked the line.`),
    C('DANNY',`You're the second person to say that and mean it.`),
    D(`Who was the first?`),
    C('DANNY',`My mother.`),
    N(`Duke laughed. So did Danny, and it sounded like a man who had been holding his breath for a day and a half.`),
    C('DANNY',()=> solo()
      ? `They want twelve. They've got a ramp angle drawn by a man who has never seen a ramp. I'm going to spend a year jumping somebody's idea of a jump.`
      : `They've got a calendar and I'm on it. Every date. I looked at the year and there isn't a Saturday in it that's mine.`),
    D(`Take it anyway.`),
    C('DANNY',`I already did.`),
    N(`They talked for eleven minutes about ramp lips and landing slope, which is the only subject on earth the two of them had ever been able to discuss without either one of them performing.`),
    N(`Duke thought: he said the accurate thing in the wrong way for two years and I never once asked him a question. He thought: that is a thing I keep doing.`),
  ],
  statUpdate:{
    title:'Diamondback Danny',
    reason:()=> solo()
      ? "Twelve half-hours and a ramp drawn by a man who has never seen one. Duke called him anyway."
      : "Somebody else's calendar, every Saturday of it. Duke called him anyway.",
    deltas:{},
    rels:{ danny:'poached' },
    flags:{ fr3DannySigned:true }
  },
  next:'_hub_fr3'
},
fr3_danny_quiet: {
  art:'fr3', artLabel:'Free Roam 3 · Day',
  bgText:'NOTHING FROM ME',
  lines:[
    D(`Nothing from me.`),
    C('SANDRA',`That's a quote I can't use.`),
    D(`It isn't a quote.`),
    N(`She wrote the piece without him in it, which was the correct decision and which Duke felt for about nine days.`),
    N(`The dates stopped overlapping after that. Not deliberately — a man on somebody else's calendar is on somebody else's calendar, and the circuit is a set of fairgrounds that either intersect or do not.`),
    N(`Duke saw him once more that year, across a parking lot in Amarillo, getting into a car with a driver. Danny raised a hand. Duke raised a hand. Then the car went, and that was the whole of it.`),
    N(`He thought about Danny more than he wanted to. He had thought that before, standing in a lot behind a venue with a ladle in his hand, and he had not done anything about it that time either.`),
  ],
  statUpdate:{
    title:'Diamondback Danny',
    reason:"He raised a hand across a parking lot in Amarillo. That was the whole of it.",
    deltas:{},
    rels:{ danny:'absent' },
    flags:{ fr3DannySigned:true }
  },
  next:'_hub_fr3'
},

/* ============================================================
   MILESTONE 4 STUB
   ============================================================ */

m4_entry: {
  art:'m4', artLabel:'Milestone 4',
  bgText:'THE DEFINING MOMENT',
  get lines(){
    if(solo()) return [
    N(`Duke put the folder on the table himself.`),
    N(`Inside: three proposals, in his own handwriting, worked out over four weeks of evenings with Cal's calculator and a road atlas. Three different versions of what the next stunt could be. Each one bigger than five cars. Each one requiring a different thing from him, and each one with a number at the bottom that was his to find.`),
    N(`Nobody needed an answer by Friday. That was the trouble with Friday: nobody was going to set it but him.`),
    N(`He set it for Friday. He picked up the folder.`),
    ];
    return [
    N(`Earl put the folder on the table.`),
    N(`Inside: three proposals. Three different versions of what the next stunt could be. Each one bigger than five cars. Each one requiring a different thing from Duke.`),
    C('EARL',`Take your time. I need an answer by Friday.`),
    N(`Duke picked up the folder.`),
    ];
  },
  next:'m4_stunt_select'
},

m4_stunt_select: {
  art:'m4', artLabel:'Milestone 4 · Choice',
  bgText:'WHAT\'S NEXT',
  lines:[
    N(`Three options. He read them the way Cal read an engine — looking for the thing underneath the thing.`),
    N(()=> solo()
      ? `The bus stack was the obvious one. Thirteen buses, end to end. Longer than anything he'd attempted. There was a stadium in Fort Worth that would rent him the lot against a percentage of the gate, and a school district that wanted $${BUS_DEPOSIT} in hand before it would let thirteen buses out of the yard.`
      : `The bus stack was the obvious one. Thirteen buses, end to end. Longer than anything he'd attempted. Earl had a stadium booked.`),
    N(()=> GS.flags.nextStuntBuses ? `Cal had already started working on the ramp geometry for it. Duke had not asked him to. That was Cal.` : `The geometry was straightforward on paper. Everything was straightforward on paper.`),
    N(()=> solo()
      ? `The inferno tunnel was the theatrical one. A ring of fire on a quarter-mile straight. The station that had filmed the Speedway had asked what came after five cars; this was an answer they could point a camera at. High risk in a different way than the buses.`
      : `The inferno tunnel was the theatrical one. A ring of fire on a quarter-mile straight. National TV interest. High risk in a different way than the buses.`),
    N(`The third was smaller. A symbolic stunt at the county fair — where it started. Local crowd, people who knew him before any of this. Lower risk, but a different kind of statement.`),
    N(`He set the folder down and looked at the window for a while.`),
  ],
  choices:[
    {
      label:'A',
      text:`The Bus Stack — thirteen buses.`,
      subtext:()=> solo()
        ? `Requires Showmanship ≥ 4, Precision ≥ 3 and $${BUS_DEPOSIT} for the school district. The Legend ceiling.`
        : `Requires Showmanship ≥ 4 and Precision ≥ 3. Earl has the stadium. The Legend ceiling.`,
      // The deposit is spent here rather than at the ramp, because that is
      // when a school district cashes it, and only on the branch where it is
      // Duke's to find. `effects.money` resolves a function, the same way a
      // line or a subtext does.
      effects:{ flags:{ m4Choice:'buses' }, money: ()=> solo() ? -BUS_DEPOSIT : 0 },
      goto:'m4_prestunt',
      _gateCheck: m4Gate('buses').check,
      _gateReason: m4Gate('buses').reason
    },
    {
      label:'B',
      text:`The Inferno — fire tunnel.`,
      subtext:()=> solo() ? `Requires Nerve ≥ 4. Theatrical. Regional TV, and whoever they sell it to.` : `Requires Nerve ≥ 4. Theatrical. National TV.`,
      effects:{ flags:{ m4Choice:'inferno' } },
      goto:'m4_prestunt',
      _gateCheck: m4Gate('inferno').check,
      _gateReason: m4Gate('inferno').reason
    },
    {
      label:'C',
      text:`The Symbolic Stunt — county fair, full circle.`,
      subtext:`Always available. Low danger. High emotional payoff.`,
      effects:{ flags:{ m4Choice:'symbolic' } },
      goto:'m4_prestunt'
    },
  ]
},

m4_prestunt: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'THE LAST HOUR',
  lines:[
    N(`The day before.`),
    N(`He found himself alone at the site in the hour before the crew arrived. He'd driven out early without quite planning to, the way he'd done a hundred times before a hundred different things.`),
    N(`He thought about the county fair. He thought about three cows. He thought about the things that had happened since then — the gradients, not the events.`),
    N(`Somebody found him.`),
  ],
  next:'_m4_prestunt_route'
},

m4_prestunt_cal_m4: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'THE BOLT',
  lines:[
    N(`Cal had something in his hand. A bolt — short, threads worn smooth. The kind you pull when you replace it with something better.`),
    N(`He set it on the hood of the truck between them without explanation.`),
    C('CAL',`Found that in the primary drive housing. Replaced it.`),
    D(`When?`),
    C('CAL',`This morning.`),
    N(`Duke looked at it.`),
    C('CAL',`You should postpone.`),
    N(`A long pause.`),
    D(`I've heard that before.`),
    C('CAL',`I know. I keep saying it.`),
    D(`The bike's right now.`),
    C('CAL',`Bike's right now.`),
    N(`He put the bolt in his pocket. Duke thought: he's going to keep that bolt. He's going to keep it the way people keep things that have a story.`),
    N(`He thought: the bike is right. Let's go find out what I am.`),
  ],
  choices:[
    { label:'A', text:`"We go."`, subtext:`Cal fixed it. The bike is right.`, effects:{}, goto:'_m4_launch' },
    { label:'B', text:`"Walk me through what you found."`, subtext:`You want to understand it before you trust it.`, effects:{ stats:{ precision:1 } }, goto:'m4_prestunt_cal_detail' },
  ]
},

m4_prestunt_cal_detail: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'THE DETAIL',
  lines:[
    D(`Walk me through what you found.`),
    N(`Cal looked at him. Then he took the bolt out of his pocket and turned it in his fingers.`),
    C('CAL',`Primary drive housing. This bolt retains the sprocket carrier. If it stripped out at speed — not on takeoff, on landing, on the deceleration — the carrier can shift. Shift enough and you lose chain tension.`),
    D(`How much shift?`),
    C('CAL',`Depends. Could be nothing. Could be the chain drops.`),
    N(`Duke thought about that.`),
    D(`What are the odds.`),
    C('CAL',`With the old bolt? High enough that I replaced it.`),
    D(`With the new one.`),
    C('CAL',`Zero. New bolt's torqued to spec. I checked it twice.`),
    D(`Then we go.`),
    N(`Cal nodded. He put the bolt back in his pocket.`),
    N(`Duke thought: that's Cal's version of prayer. Not hoping nothing goes wrong. Knowing exactly what was wrong and fixing it.`),
  ],
  next:'_m4_launch'
},

m4_prestunt_ruthie_m4: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'COME BACK',
  lines:[
    N(`She'd driven out. He hadn't asked her to. He'd told her the date and the venue and she was here — standing at the fence line with her hand shading her eyes against the morning light.`),
    N(`He found her. They stood there for a minute looking at the setup — the buses, or the fire rigs, or whatever it was, this version of the thing he kept doing.`),
    N(`She didn't say don't. She'd never said don't.`),
    C('RUTHIE',`Come back.`),
    N(`Two words. He'd heard them before. This time they had a different weight — six years of shows behind them, all the mornings she'd done the math and made the decision and not said the other thing.`),
    D(`I will.`),
    N(`She looked at him.`),
    C('RUTHIE',`I know.`),
    N(`She went back to her car. She was going to be in the crowd somewhere. She would find the spot where she could see the whole arc without being pressed against anyone — she always found that spot.`),
    N(`He thought: come back. Two words that held a decade.`),
  ],
  choices:[
    { label:'A', text:`Go.`, subtext:`She said what she needed to. The ramp is ready.`, effects:{}, goto:'_m4_launch' },
  ]
},

m4_prestunt_nobody_m4: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'ALONE',
  lines:[
    N(`Nobody came.`),
    N(`He'd half expected someone. He waited past the point where waiting makes sense and then stopped waiting and just stood there.`),
    N(`There was no voice in his head from anyone else. Just the site, and the setup, and the thing he was about to do.`),
    N(`He thought about that for a moment. He thought: that's information. Not triumph. Not recovery declared.`),
    N(`Just information. He was here. He knew what he was doing. He was going to go find out.`),
    N(`He'd built this out of himself, whatever this was. Every practice run. Every conversation with Cal. Every night he rode alone. All of it fed into this moment, which was now, which was just information.`),
    N(`He went back to the bike. He put on the jacket.`),
  ],
  choices:[
    { label:'A', text:`Go.`, subtext:`You've been here alone before. Different scale. Same thing.`, effects:{ stats:{ nerve:1 } }, goto:'_m4_launch' },
  ]
},

m4_triumph_buses: {
  art:'m4', artLabel:'Milestone 4 · Triumph',
  bgText:'THIRTEEN CLEAN',
  get lines(){
    const head = [
    N(`Thirteen buses. He cleared all of them.`),
    N(`The crowd sound was different from any crowd sound he'd heard before — not louder, exactly, but denser, like the same amount of noise compressed into half the space.`),
    N(`He landed on the mat. Cal was twenty feet away, hands in his jacket pockets, which was not the way Cal stood when something had gone wrong.`),
    ];
    if(solo()) return [...head,
    N(`Nobody got there after Cal. Cal took his hands out of his pockets.`),
    C('CAL',`Yeah.`),
    N(`He said it the way he said it when he meant it. This was the third time. Duke had been counting.`),
    N(`He thought: that's the third time. He thought: I should probably tell him I noticed.`),
    N(`He didn't. But he filed it for later.`),
    ];
    return [...head,
    N(`Earl got there three seconds after Cal.`),
    C('EARL',`Son.`),
    N(`He said it the way he said it when he meant it. This was the third time. Duke had been counting.`),
    N(`He thought: that's the third time. He thought: I should probably tell him I noticed.`),
    N(`He didn't. But he filed it for later.`),
    ];
  },
  statUpdate:{
    title:'Thirteen Buses',
    reason:()=> solo()
      ? "The Legend ceiling. Cal said yeah. Nobody's name on the ramp but his. The LA man was in the fourth row again."
      : "The Legend ceiling. Earl said son. Cal had his hands in his pockets. The LA man was in the fourth row again.",
    deltas:{ nerve:2, showmanship:3, precision:1 },
    flags:{ m4Complete:true, m4Outcome:'triumph', m4Stunt:'buses' }
  },
  next:'_chapter_fr4'
},

m4_triumph_inferno: {
  art:'m4', artLabel:'Milestone 4 · Triumph',
  bgText:'THROUGH THE FIRE',
  lines:[
    N(`The fire tunnel: a quarter mile, two hundred and forty feet of flame on each side, close enough that he felt the heat through the jacket sleeves.`),
    N(`He went through it in eight seconds. He knew the time because the timer board at the end said so.`),
    N(`The crowd had been quiet for eight seconds. They'd never been that quiet at any show he'd done. He thought: that was the fire. Not him — the fire. Even the people who came to watch couldn't look straight at it for very long.`),
    N(`He rode out the other end and the sound came back all at once.`),
    N(`His jacket was warm on the outside. He unzipped it.`),
    N(()=> solo()
      ? `Kessler was standing at the tent. She'd driven up for it, which she had not said she would do. She looked at him. She gave a single nod.`
      : `Earl was standing at the tent, talking on the phone. He looked up. He gave a single nod.`),
    N(()=> solo() ? `That was the Kessler version of a standing ovation.` : `That was the Earl version of a standing ovation.`),
  ],
  statUpdate:{
    title:'Through the Fire',
    reason:()=> solo()
      ? "Eight seconds. Quarter mile. The crowd went quiet. Kessler nodded once."
      : "Eight seconds. Quarter mile. The crowd went quiet. Earl nodded once.",
    deltas:{ nerve:2, showmanship:2 },
    flags:{ m4Complete:true, m4Outcome:'triumph', m4Stunt:'inferno' }
  },
  next:'_chapter_fr4'
},

m4_triumph_symbolic: {
  art:'m4', artLabel:'Milestone 4 · Triumph',
  bgText:'FULL CIRCLE',
  lines:[
    N(`The county fair. Same fairground, same smell of cut grass and motor oil. Different crowd — not just locals, not anymore, but a lot of people who'd been here the first time.`),
    N(`He jumped three cows.`),
    N(`Not because three cows was impressive anymore — it wasn't, and the crowd knew it wasn't. He did it because three cows was where it started, and there was a thing he wanted to say that wasn't a speech.`),
    N(`He landed and held the landing for a moment. He looked at the crowd the way he'd looked at it a decade ago.`),
    N(`A kid in the front row — maybe eight, nine years old — was looking at him the way he'd been looked at once, a long time ago, by a kid who'd shown up to a county fair and seen something.`),
    N(`Duke looked at him.`),
    N(`He nodded.`),
    N(`That was the whole show.`),
  ],
  statUpdate:{
    title:'Full Circle',
    reason:"Three cows. Full circle. The crowd understood.",
    deltas:{ showmanship:2, nerve:1 },
    flags:{ m4Complete:true, m4Outcome:'triumph', m4Stunt:'symbolic' }
  },
  next:'_chapter_fr4'
},

m4_failure_buses: {
  art:'m4', artLabel:'Milestone 4 · Down',
  bgText:'TWELVE',
  lines:[
    N(`He cleared twelve of the thirteen.`),
    N(`The thirteenth — the last one — he caught the rear. The bike went right, he went left, and the tarmac was immediate in the way tarmac is when you're going seventy miles an hour and suddenly aren't.`),
    N(`He was down for a long moment. He was aware of the crowd going quiet.`),
    N(`He got up. Slower than usual. But he got up.`),
    N(`He didn't raise the fist — he didn't have it in him for the fist. He just stood there. He looked at the thirteen buses.`),
    N(`Twelve.`),
    N(`The crowd started again after a moment. Not the triumph sound — a different sound. The sound of people watching a man stand up.`),
    C('CAL',`How bad.`),
    D(`I don't know yet.`),
    C('CAL',`Walk first. Then we figure it out.`),
    N(`He walked. He figured it out.`),
  ],
  statUpdate:{
    title:'Twelve of Thirteen',
    reason:"One short. He got up. The crowd saw a man stand up from something big.",
    deltas:{ condition:-3, nerve:-1, showmanship:1 },
    flags:{ m4Complete:true, m4Outcome:'failure', m4Stunt:'buses' }
  },
  next:'_chapter_fr4_failure'
},

m4_failure_inferno: {
  art:'m4', artLabel:'Milestone 4 · Down',
  bgText:'THE HEAT',
  lines:[
    N(`He went in at the right speed. He went in right. At the midpoint something changed — the bike started to drift, he corrected, the correction was a degree off.`),
    N(`At two-thirds through, the bike went sideways.`),
    N(`The fire crew had it controlled in six seconds. That was what the fire crew was for. He was on the tarmac inside the tunnel and the only thought he had was: the fire is managed, I am not currently on fire, these are good facts.`),
    N(`He was not on fire. He was on the ground.`),
    N(`He got up.`),
    N(`The crowd at the end of the tunnel saw him walk out. That was the image: walking out of the fire. It wasn't the stunt. It was something else.`),
  ],
  statUpdate:{
    title:'Walked Out',
    reason:"Not the stunt. Something else. Walking out of fire is its own kind of image.",
    deltas:{ condition:-2, showmanship:2, nerve:-1 },
    flags:{ m4Complete:true, m4Outcome:'failure_walk', m4Stunt:'inferno' }
  },
  next:'_chapter_fr4_failure'
},


// ================================================================
// ROUND 4 NEW SCENES
// ================================================================

// ----------------------------------------------------------------
// FR3 RUTHIE SPLIT — ruthieAsked path
// ----------------------------------------------------------------
fr3_ruthie_already_asked: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'SOMETHING SHIFTED',
  lines:[
    N(`She came to find him two days after the show. She didn't bring the question this time.`),
    N(`She sat on his front porch with coffee. She looked at the yard for a while.`),
    C('RUTHIE',`I keep waiting to feel differently about it.`),
    N(`Duke looked at her.`),
    C('RUTHIE',`The show. The close call. All of it.`),
    N(`A pause.`),
    C('RUTHIE',`I don't.`),
    N(`He understood what that meant. She wasn't asking him to explain anything. She wasn't asking him to change anything. She was reporting a fact about herself.`),
  ],
  choices:[
    { label:'A', text:`"That's enough for me."`, subtext:'Mutual acceptance. The simplest true thing.', effects:{ rels:{ ruthie:'solid' } }, goto:'fr3_ruthie_shifted_accept' },
    { label:'B', text:`"Do you want to?"`, subtext:'The question opens something. Most intimate dialogue in FR3.', effects:{ rels:{ ruthie:'solid' } }, goto:'fr3_ruthie_shifted_open' },
    { label:'C', text:`Say nothing. Be there.`, subtext:'The Gritty register. The right beat for this moment.', effects:{ rels:{ ruthie:'solid' }, stats:{ nerve:1 } }, goto:'fr3_ruthie_shifted_quiet' },
  ]
},

fr3_ruthie_shifted_accept: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'ENOUGH',
  lines:[
    D(`That's enough for me.`),
    N(`She looked at him. She seemed to consider it — not whether it was true, but whether he meant it.`),
    C('RUTHIE',`Good.`),
    N(`She drank her coffee. The street was quiet. He thought: this is what it looks like when something doesn't need to be resolved. He thought: I should remember this.`),
  ],
  next:'_hub_fr3'
},

fr3_ruthie_shifted_open: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'DO YOU WANT TO',
  lines:[
    D(`Do you want to? Feel differently.`),
    N(`She was quiet for a moment. This was the kind of quiet she went into when she was finding the honest answer rather than the convenient one.`),
    C('RUTHIE',`I don't know. I think I used to want to want to. That's probably not the same thing.`),
    D(`No.`),
    C('RUTHIE',`I was watching Roy's footage. The three seconds after the stunt. He filmed me.`),
    D(`I know.`),
    C('RUTHIE',`He wants to use it.`),
    D(`I know.`),
    N(`She turned her coffee cup in her hands.`),
    C('RUTHIE',`I told him yes. Because that's true. That's what I actually do. And I figure — if that's what it is, it might as well be in the film.`),
    N(`He thought about that for a while.`),
    D(`Yeah.`),
    N(`She looked at him. There was something in the look that was not the question and not the answer but the space where both of them had already arrived.`),
  ],
  next:'_hub_fr3'
},

fr3_ruthie_shifted_quiet: {
  art:'fr3', artLabel:'Free Roam 3 · Evening',
  bgText:'JUST HERE',
  lines:[
    N(`He didn't say anything.`),
    N(`She didn't seem to expect him to. She turned her coffee cup in her hands and looked at the street.`),
    N(`They sat. The evening came down over the yard. A car went by. A dog barked somewhere down the block.`),
    N(`After a while she set down her cup.`),
    C('RUTHIE',`I drove forty-five minutes to say that.`),
    N(`He thought: yes. And that's what you get for forty-five minutes.`),
    N(`He thought: some things don't need to be said back to be received.`),
    N(`He thought: she knows that. That's why she said it.`),
  ],
  next:'_hub_fr3'
},

// ----------------------------------------------------------------
// M4 PRE-STUNT — Pete Garland (from dialogue file exactly)
// ----------------------------------------------------------------
m4_prestunt_pete_m4: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'THE NOTEBOOK',
  lines:[
    N(`Pete had driven out without asking, which surprised Duke less than it would have two years ago.`),
    N(`He didn't say much. He wasn't that kid anymore — the one who corrected himself mid-sentence and looked at Duke like Duke was something to be decoded. He was still figuring things out, but he was figuring them out quietly now, which was its own kind of progress.`),
    D(`You're not supposed to be here.`),
    C('PETE',`I know. Cal said I could help with the ramp measurements.`),
    D(`Cal said that.`),
    C('PETE',`He said I could hold the tape.`),
    N(`Duke thought about this.`),
    D(`Why are you here, Pete.`),
    N(`Pete looked at the canyon. He was quiet long enough that it was a real answer.`),
    C('PETE',`I wanted to see what it looks like from the outside.`),
    N(`That was Ruthie's language. That was Roy's language. It was the language of people who were trying to understand something they could only see from one side, and Pete was standing there with the notebook — it was on the seat of his car; Duke had seen it — and saying it as simply as if it were just a fact.`),
    D(`What does it look like?`),
    C('PETE',`... Ask me after.`),
    C('PETE',`I'm doing a show in Lubbock in April.`),
    N(`Duke looked at him.`),
    C('PETE',`Small. Eight cars. It's not—`),
    N(`He stopped.`),
    C('PETE',`I wanted to tell you before you heard about it some other way.`),
    N(`Duke felt something that was not quite pride and not quite loss and was probably both of those things occupying the same space, which he had heard was not supposed to be possible but turned out to be entirely possible.`),
    D(`Eight cars is a good number.`),
    C('PETE',`Cal helped me with the ramp angle.`),
    D(`I know. Cal told me.`),
    C('PETE',`... Was that —`),
    D(`It was fine, Pete.`),
    N(`He meant it.`),
    C('PETE',`I wrote something down. After the Dallas show. I've been — I carry it around.`),
    D(`What'd you write?`),
    C('PETE',`I wrote: 'he finds the number in the air, not on the ground.'`),
    N(`Duke didn't say anything.`),
    C('PETE',`That's it. I don't know if it's right. I just — that's what it looked like. From the outside.`),
    N(`He did not say that Pete was right, because it was a private thing to say about yourself. He looked at the canyon. He thought about the two-degree correction at Dallas, the one Roy had been watching specifically. He thought about the county fair, three cows, the correction that had kept him upright.`),
    N(`He thought Pete might be right.`),
  ],
  next:'_m4_launch'
},

// ----------------------------------------------------------------
// M4 PRE-STUNT — Earl (from dialogue file)
// ----------------------------------------------------------------
m4_prestunt_earl_m4: {
  art:'m4', artLabel:'Milestone 4 · Before',
  bgText:'THE RIM',
  lines:[
    N(`Earl came to the canyon the day before. He didn't bring anyone. No lawyers, no press contacts, no Roy Petersen. He came alone, which Duke had not seen him do before.`),
    N(`He stood at the rim in his hat and looked at it for a while.`),
    C('EARL',`Wider than I expected.`),
    D(`Yeah.`),
    C('EARL',`You've been out here a few days.`),
    D(`Yeah.`),
    C('EARL',`Stopped surprising you?`),
    N(`Duke thought about it.`),
    D(`No.`),
    N(`Earl nodded. He seemed to appreciate that.`),
    C('EARL',`You know what I was doing the day before I made my first real deal? First real one, not a county fair situation.`),
    D(`What.`),
    C('EARL',`Sitting outside the motel for six hours. I had the number I was going in with. I had the number I'd take. I just sat there.`),
    D(`Why.`),
    C('EARL',`Because I didn't know yet if I was the kind of person who could walk in and say the number.`),
    N(`Duke looked at him.`),
    C('EARL',`That's all. I found out I was. I want you to know I understand the sitting.`),
    N(()=> (GS.rels.earl === 'mentor') ? `Earl looked at him. Not at the canyon — at Duke. The way he looked when he was saying something he meant rather than something that served a purpose.` : ``),
    C('EARL',()=> (GS.rels.earl === 'mentor') ? `Son — you've been the kind of person who could do this since before the county fair. I just needed you to find that out for yourself.` : ``),
    N(()=> (GS.rels.earl === 'mentor') ? `Duke filed it. The fourth use. Complete.` : `Earl nodded once. He left. The canyon stayed.`),
  ],
  next:'_m4_launch'
},

// ----------------------------------------------------------------
// M4 PRE-STUNT — ruthieDontKnow callback
// (Added as dynamic injection into m4_prestunt_ruthie_m4 via buildLines)
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// FR4 SHELL + SCENES
// ----------------------------------------------------------------
fr4_hub_open: {
  art:'fr4', artLabel:'Free Roam 4',
  bgText:'AFTERMATH',
  lines:[
    N(`The show was done. Whatever came next was going to be different from whatever had come before.`),
    N(`He thought: that's always been true. He thought: this time I know it.`),
  ],
  next:'_hub_fr4'
},

fr4_hub_open_failure: {
  art:'fr4', artLabel:'Free Roam 4',
  bgText:'GET UP',
  lines:[
    N(`He got up. That was the thing that happened first.`),
    N(`What came after the getting up was going to take longer to figure out.`),
  ],
  next:'_hub_fr4'
},

fr4_night_ride: {
  art:'fr4', artLabel:'Free Roam 4 · Night',
  bgText:'MILE TWENTY-TWO',
  lines:[
    N(`He took the bike out after dark.`),
    N(`Not to practice. Not toward anything. The road north of town went flat for twenty-two miles before it hit anything worth stopping for, and he had been on it enough times that he could feel the surface through the tires like a conversation he knew by heart.`),
    N(`He thought about the canyon. He thought about Vegas. He thought about the number — the one you found in the air, not on the ground.`),
    N(()=>{
      const peteActive = GS.rels.pete && GS.rels.pete !== 'absent' && GS.rels.pete !== 'unknown';
      const ruthieSolid = GS.rels.ruthie === 'solid';
      if (peteActive && ruthieSolid) return `He thought about Pete finding it in Lubbock. He thought about what Ruthie had said about the hands. He thought about Roy filming the three seconds after.`;
      if (peteActive) return `He thought about Pete finding it in Lubbock. He thought about Roy filming the three seconds after.`;
      if (ruthieSolid) return `He thought about what Ruthie had said about the hands. He thought about Roy filming the three seconds after.`;
      return `He thought about Roy filming the three seconds after.`;
    }),
    N(`He thought: some things are the same from the inside and the outside. The ones that matter usually are.`),
    N(`He turned around at mile twenty-two.`),
    N(`The fork seal, which Cal had replaced, held.`),
  ],
  statUpdate:{
    title:'Night Ride',
    reason:"Twenty-two miles out. Twenty-two back. The bike held.",
    deltas:{ nerve:1 },
    flags:{}
  },
  next:'_hub_fr4'
},

fr4_eve_ruthie: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'THE HANDS',
  _gateRoute: ()=> (GS.rels.ruthie === 'absent' || GS.rels.ruthie === 'unknown') ? 'fr4_ruthie_gone' : null,
  lines:[
    N(()=> GS.rels.ruthie === 'strained'
      ? `She was there. The distance between them had a specific quality — not cold, but careful. Like two people being considerate of something fragile.`
      : `She cooked. He didn't ask her to — she arrived with groceries at seven and was in the kitchen before he'd sorted it out.`
    ),
    N(()=> GS.rels.ruthie === 'solid'
      ? `He sat at the table and watched her work. He had watched her do this for years. The fact of it was ordinary and specific in the way ordinary and specific things became important when you'd been somewhere that wasn't this.`
      : `He sat. She moved around the kitchen with the particular efficiency of someone who was not going to be stopped from this.`
    ),
    C('RUTHIE',()=> GS.rels.ruthie === 'solid' ? `Sandra called me.` : `How are you sleeping?`),
    D(()=> GS.rels.ruthie === 'solid' ? `Yeah?` : `Fine.`),
    C('RUTHIE',()=> GS.rels.ruthie === 'solid' ? `For the follow-up piece.` : `That's not what Cal said.`),
    D(()=> GS.rels.ruthie === 'solid' ? `What'd she ask.` : `Cal doesn't know what he's talking about.`),
    C('RUTHIE',()=> GS.rels.ruthie === 'solid' ? `She asked what it's like to watch.` : `Cal knows exactly what he's talking about. That's why you told him.`),
    N(()=> GS.rels.ruthie === 'solid' ? `He thought about Roy's footage. Ruthie's face, three seconds, the thing faces do when the thing you were afraid of did not happen.` : `Duke didn't say anything to that.`),
    C('RUTHIE',()=> GS.rels.ruthie === 'solid' ? `I said: I've stopped watching the jump. I watch his hands before the jump. His hands tell you everything.` : `You should eat something.`),
    N(()=> GS.rels.ruthie === 'solid' ? `He looked at his hands.` : `She set a plate down. He ate. It was the most domestic and careful they'd been in a while.`),
    C('RUTHIE',()=> GS.rels.ruthie === 'solid' ? `Left hand open on the grip means he's found what he needs. Closed means he hasn't yet.` : ``),
    N(()=> GS.rels.ruthie === 'solid' ? `He thought about the canyon. The open hand.` : ``),
    D(()=> GS.rels.ruthie === 'solid' ? `How long have you known that.` : ``),
    C('RUTHIE',()=> GS.rels.ruthie === 'solid' ? `Since the county fair.` : ``),
    N(()=> GS.rels.ruthie === 'solid' ? `He thought: she has been reading me since the county fair. He thought: Roy was looking for something I didn't know about myself and Ruthie already knew it. He thought: that's what 'I'll still be here' was. That was the whole of it.` : ``),
  ],
  statUpdate:{
    title:'Evening With Ruthie',
    reason:"She was there. She's still reading the hands.",
    deltas:{ nerve:1 },
    rels: {},
    flags:{}
  },
  next:'_hub_fr4'
},

fr4_ruthie_gone: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'NO CALL',
  lines:[
    N(`He thought about calling her.`),
    N(`He didn't.`),
    N(`He sat in the kitchen for a while. He thought about the county fair, which was a long time ago and was also not a long time ago depending on which way you were counting.`),
    N(`He thought: some decisions have a date and some decisions have a drift. He wasn't sure which kind this one had been.`),
    N(`He went to bed at a reasonable hour.`),
  ],
  next:'_hub_fr4'
},

fr4_eve_cal: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'THE QUESTION',
  lines:[
    N(`He went to the garage.`),
    N(`Cal was there, which was not surprising. Cal was usually in the garage in the evening when there was a bike that needed attention, and there was always a bike that needed attention.`),
    N(`Duke pulled up a stool.`),
    C('CAL',`Vegas specs came in.`),
    D(()=> solo() ? `The man from California sent them. To the house. There was nobody else to send them to.` : `Earl sent them.`),
    C('CAL',`Stadium floor. Sealed concrete. I want to run different tire pressure than the canyon.`),
    D(`How different.`),
    C('CAL',`I'll tell you when I know.`),
    N(`Duke watched him work. Cal's hands on the fork assembly — the same work he'd done before Dallas, before the canyon. The same focus, the same precision, the same quality of attention that Duke had spent ten years learning to trust completely.`),
    C('CAL',`Fork seal.`),
    D(`I figured.`),
    C('CAL',`It's ritual now.`),
    N(`Duke looked at him.`),
    C('CAL',`I replace it before every major event. It's been ritual since the canyon.`),
    N(`He said it matter-of-factly, like a man reporting a maintenance schedule. Not sentiment — policy.`),
    N(`Duke thought about the clipboard. In case I'm wrong about something.`),
    N(`He thought: Cal has built a ritual around the thing that might have failed and didn't. He thought: that is exactly what you do with a thing like that.`),
    D(`Good.`),
    C('CAL',`Yeah.`),
    N(`They worked until ten. Cal talked about tire pressure and Duke handed him tools and the garage smelled like oil and the fork seal was fine.`),
    N(`After a while Cal set down the wrench. He picked up a different wrench. He used it. He set it down. He did not look at Duke.`),
    C('CAL',`You know you don't have to keep going.`),
    N(`Duke looked at him.`),
    N(`That was the question. That was Cal's version of it, anyway — not dressed up, not with all the angles covered. Just the thing.`),
    D(`I know.`),
    C('CAL',`Bike's right.`),
    N(`He meant the bike. He also meant something else.`),
    N(`Duke thought: that's the whole conversation. He thought: I'll need to sit with that.`),
  ],
  statUpdate:{
    title:'Garage With Cal',
    reason:"Fork seal ritual. Cal asked the question. The bike is right.",
    deltas:{ precision:1 },
    flags:{ calAskedTheQuestion:true }
  },
  next:'_hub_fr4'
},

fr4_eve_tommy: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'THERE HE IS',
  lines:[
    N(`Tommy had opinions about Vegas.`),
    C('TOMMY',`What you need is an entrance.`),
    D(`I have an entrance.`),
    C('TOMMY',`A real entrance. Like—`),
    N(`He gestured broadly, which was Tommy's primary conversational tool.`),
    C('TOMMY',`Pyrotechnics. Or a car. You come in on a motorcycle through the doors of the place—`),
    D(`It's an amphitheater, Tommy.`),
    C('TOMMY',`Through the doors of the amphitheater. The crowd's already there and you just — come in. From outside.`),
    N(`Duke drank his beer.`),
    D(`I'll think about it.`),
    C('TOMMY',`Don't think about it, do it.`),
    D(`I'll think about doing it.`),
    N(`Tommy considered this and apparently found it satisfactory. He flagged down the bartender.`),
    C('TOMMY',`The canyon.`),
    D(`Mm.`),
    C('TOMMY',`I was there, you know.`),
    D(`I know, Tommy.`),
    C('TOMMY',`I saw the whole thing.`),
    D(`I know.`),
    C('TOMMY',`From the bleachers.`),
    N(`Duke waited. With Tommy, this was always the preamble to something he'd thought about more than he was letting on.`),
    C('TOMMY',`When you came over the rim — the second you cleared — I said 'there he is.' Out loud. I don't know who I said it to. Nobody around me. I just said it.`),
    N(`Duke looked at him.`),
    C('TOMMY',`There he is.`),
    N(`He shrugged.`),
    C('TOMMY',`That's all.`),
    N(`Duke thought about the county fair. He thought about Tommy in the early days, bar nights, enthusiastic and unreliable and there. He thought about lawn chairs.`),
    // Phase 4. Both arms are reachable now. `tommyKnowsWhatHeWants` was set by
    // the Free Roam 3 evening and read by nothing for two phases; this is the
    // line that reads it.
    N(()=> GS.rels.tommy === 'ally'
      ? `He thought: Tommy is going to be in Roy's film whether Roy knows it or not. He thought: there he is is probably the most accurate thing Tommy has ever said about him.`
      : `He thought: Tommy had been at more of his shows than he'd kept track of. He thought: that was a fact. He was going to have to figure out what to do with it.`
    ),
    N(()=> GS.flags.tommyKnowsWhatHeWants
      ? `He thought about the twelve people at the Hinkle lot, and the nineteen Tommy was expecting next time, and the fact that Tommy had counted ahead.`
      : `He thought: I have never once asked him what he does on a Sunday.`
    ),
    D(`I know the entrance I want.`),
    C('TOMMY',`Yeah?`),
    D(`I'll tell you when it's real.`),
    C('TOMMY',`Deal.`),
  ],
  statUpdate:{
    title:'Bar With Tommy',
    reason:"There he is. Tommy was at the canyon.",
    deltas:{ showmanship:1 },
    flags:{}
  },
  next:'_hub_fr4'
},

fr4_eve_earl: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'THE MAN FROM LA',
  lines:[
    N(`Earl called at seven in the evening. Duke had been expecting the call.`),
    C('EARL',`I've got the man from California on the other line.`),
    D(`I know.`),
    N(()=> GS.flags.m4Outcome === 'triumph' || GS.flags.m4Outcome === 'triumph_clean'
      ? `There was a pause. The pause-before-real-numbers.`
      : `There was a pause. The kind where Earl was deciding how to frame something.`
    ),
    C('EARL',()=> GS.flags.m4Outcome === 'triumph' || GS.flags.m4Outcome === 'triumph_clean'
      ? `He has a venue. Vegas. A specific evening. He says the canyon is the reason he's calling — he watched the reel, he wants what comes next.`
      : `He has a recovery package. He's heard the news. He wants to talk about what comes after the recovery — and what Duke might be willing to do to make that conversation worth everyone's time.`
    ),
    D(()=> (GS.flags.m4Outcome === 'triumph' || GS.flags.m4Outcome === 'triumph_clean') ? `What are the terms.` : `What's the structure.`),
    C('EARL',()=> (GS.flags.m4Outcome === 'triumph' || GS.flags.m4Outcome === 'triumph_clean')
      ? `Standard gate split, sixty-forty in your favor. Licensing rights for the footage — he's already talking to Roy. Promotional obligations: two appearances, one interview, one print piece.`
      : `He'll front the medical and recovery overhead. In exchange, he wants right of first refusal on the next major event. First two years, forty percent of the net.`
    ),
    N(()=> (GS.flags.m4Outcome !== 'triumph' && GS.flags.m4Outcome !== 'triumph_clean') && GS.stats.hustle >= 3
      ? `Duke heard it clearly. First two years, forty percent, right of first refusal. He thought: that's not a recovery package, that's an acquisition.`
      : ``
    ),
    N(()=> (GS.flags.m4Outcome !== 'triumph' && GS.flags.m4Outcome !== 'triumph_clean') && GS.stats.hustle < 3
      ? `Duke heard it as an offer of help. He thought: Earl is doing what Earl does. He thought: I should think about this more carefully before I answer.`
      : ``
    ),
  ],
  choices:[
    {
      label:'A',
      text:`"Tell him yes."`,
      subtext:'Take the deal. Vegas or recovery — whatever Earl is offering.',
      effects:{ flags:{ fr4EarlDeal:'signed' } },
      goto:'fr4_earl_signed'
    },
    {
      label:'B',
      text:`"Get me the full terms in writing first."`,
      subtext:'Professional caution. Earl respects this.',
      effects:{ flags:{ fr4EarlDeal:'pending' } },
      goto:'fr4_earl_pending'
    },
    {
      label:'C',
      text:`"Tell him I'll call him myself."`,
      subtext:'Cut out the middleman. Earl notes this.',
      effects:{ flags:{ fr4EarlDeal:'direct' }, stats:{ hustle:1 } },
      goto:'fr4_earl_direct'
    },
  ]
},

fr4_earl_signed: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'YES',
  lines:[
    C('EARL',`I'll tell him tonight.`),
    N(`A pause. Not the numbers-pause. The other kind.`),
    C('EARL',`Duke.`),
    D(`Yeah.`),
    C('EARL',`Good.`),
    N(`That was all. Duke hung up. He sat with the phone for a moment.`),
    N(`He thought: Vegas. He thought: that's information. Not triumph. Not recovery declared.`),
    N(`He thought: that's the next thing.`),
  ],
  next:'_hub_fr4'
},

fr4_earl_pending: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'IN WRITING',
  lines:[
    C('EARL',`I'll have Margaret send the full sheet by morning.`),
    D(`Good.`),
    N(`A pause.`),
    C('EARL',`That's the right call.`),
    N(`Duke looked at the phone. He thought: Earl just said that. He thought: Earl doesn't say that unless he means it.`),
    N(`He thought: Earl has been patient about this in ways I haven't always noticed.`),
  ],
  next:'_hub_fr4'
},

fr4_earl_direct: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'HIMSELF',
  lines:[
    N(`There was a pause. A different kind — Earl processing something.`),
    C('EARL',`I can arrange that.`),
    D(`Good.`),
    N(`Another pause.`),
    C('EARL',`He'll want to know why.`),
    D(`Tell him I like to know who I'm talking to.`),
    N(`A beat.`),
    C('EARL',`That's a good answer.`),
    N(`Duke thought: Earl gave him that line. He thought: that might have been a gift or it might have been a maneuver. He thought: with Earl, sometimes it was both.`),
  ],
  statUpdate:{
    title:'Dealing Direct',
    reason:"Duke called it himself. Earl noted it. The Hustle stat knows.",
    deltas:{ hustle:1 },
    flags:{}
  },
  next:'_hub_fr4'
},

// The backer-less branch's version of fr4_eve_earl (Phase 1, increment 2).
// On the other branch the Vegas offer arrives through Earl, who holds the
// other line; here the man from California got the number from the Speedway
// office and is calling for himself, and there is nobody to hand the phone to.
// renderHubFR4 offers exactly one of the two cards, by rels.earl.
fr4_eve_california: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'THE MAN FROM CALIFORNIA',
  lines:[
    N(`The phone rang at seven in the evening. Duke had been expecting it for a week, since Kessler called to say she'd given out his number.`),
    N(`It was the man from California. He said his name, which Duke had heard twice now and could not have spelled. He said he'd been in the fourth row at the Speedway.`),
    N(()=> GS.flags.fr4Failure
      ? `He said he'd watched Duke get up. He said that twice, in two different sentences, like a man making sure it was on the record.`
      : `He said he'd been in the fourth row again for the last one. He said he didn't fly out for many things.`),
    N(`Then he said Vegas.`),
    N(()=> GS.flags.fr4Failure
      ? `Not a recovery package. He didn't have the word for that, or didn't use it. A date, a stadium floor, a gate split — sixty-forty, Duke's side of it — and the footage his. He said the date was far enough out to heal into.`
      : `A date, a stadium floor, a gate split — sixty-forty, Duke's side of it — and the footage his. Two appearances, one interview, one print piece. He read it off something.`),
    N(`There was nobody on the other line. There was nobody to hand the phone to. There was the kitchen, and the man from California, and whatever Duke said next.`),
    N(`He thought: this is what the percentage was for. He thought: alright.`),
  ],
  choices:[
    { label:'A', text:`"Yes. Set the date."`, subtext:'Take it as read. He said the number; you heard it.', effects:{ flags:{ fr4VegasDeal:'yes' } }, goto:'fr4_california_close' },
    { label:'B', text:`"Send me the paper first."`, subtext:'Garrett Pyle taught you to read a page before you sign it.', effects:{ stats:{ hustle:1 }, flags:{ fr4VegasDeal:'paper' } }, goto:'fr4_california_close' },
    { label:'C', text:`"Sixty-forty is the opening number. Say the other one."`, subtext:'Nobody is holding the number for you. Hold it yourself.', effects:{ stats:{ hustle:1, nerve:1 }, flags:{ fr4VegasDeal:'counter' } }, goto:'fr4_california_close' },
  ]
},

fr4_california_close: {
  art:'fr4', artLabel:'Free Roam 4 · Evening',
  bgText:'THE KITCHEN',
  lines:[
    N(()=> ({
      yes: `He said yes. The man from California said: good. He said he'd have the paper out by Friday. Duke said: Friday. That was the call.`,
      paper: `He said: send me the paper first. A pause — the kind Duke recognized from the other side of the bank's desk. Then: of course. It came Thursday, eleven pages. He read all eleven at the kitchen table with a pencil, and on page seven, where a television clause would go, there wasn't one. He signed it on the porch.`,
      counter: `He said sixty-forty was the opening number. He said: say the other one. A pause. The man from California said sixty-five. Duke said: alright. He thought: that was a hundred and twenty dollars at Perkins' fairground once. He thought: it's the same conversation.`,
    })[GS.flags.fr4VegasDeal] || `That was the call.`),
    N(`He hung up. He sat at the table for a while.`),
    N(`He thought: nobody advanced anything. Nobody took a percentage. Nobody made the call for him, and nobody would have.`),
    N(`He thought: Vegas.`),
  ],
  statUpdate:{
    title:'The Man from California',
    reason:()=> ({
      yes: 'Vegas, direct. No middleman, because there was never one.',
      paper: 'Eleven pages, read with a pencil. Vegas, on paper.',
      counter: 'Sixty-five. He held the number himself.',
    })[GS.flags.fr4VegasDeal] || 'Vegas.',
    deltas:{ showmanship:1 },
    flags:{}
  },
  next:'_hub_fr4'
},

fr4_biographer: {
  art:'fr4', artLabel:'Free Roam 4 · Day',
  bgText:'THE BOOK',
  lines:[
    N(`A man named Fisk came to find him. Not Sandra — not a journalist. A publisher, out of New York, who'd flown in specifically.`),
    N(`He had Roy's footage on a reel he'd watched three times. He had a contract in his briefcase that he didn't open during the first conversation.`),
    C('FISK',`There's a book here. I don't mean the stunts — I mean the thing underneath the stunts. What you're actually doing.`),
    N(`Duke looked at him.`),
    C('FISK',`I've been doing this for twenty years. I know the difference between a career and a story. You have a story.`),
    N(()=>{
      const peteActive = GS.rels.pete && GS.rels.pete !== 'absent' && GS.rels.pete !== 'unknown';
      const petePart = peteActive ? ` He thought about Pete's sentence. He finds the number in the air, not on the ground.` : ` He thought about the number — the one you found in the air, not on the ground.`;
      return `The second section of the contract he'd seen briefly was a paragraph about narrative rights.${petePart} He thought about Fisk sitting across from him with the footage already in his head.`;
    }),
    N(`He thought: Fisk had gotten there on his own.`),
  ],
  choices:[
    {
      label:'A',
      text:`"Let's talk."`,
      subtext:'The story will be told. Duke can shape it.',
      effects:{ stats:{ showmanship:1 }, flags:{ biographerYes:true } },
      goto:'fr4_biographer_yes'
    },
    {
      label:'B',
      text:`"Not yet. Ask me in a year."`,
      subtext:'The timing is wrong. The right time is later.',
      effects:{ flags:{ biographerLater:true } },
      goto:'fr4_biographer_later'
    },
    {
      label:'C',
      text:`"No."`,
      subtext:"Duke owns what happened. He doesn't need it in print.",
      effects:{ stats:{ nerve:1 }, flags:{ biographerNo:true } },
      goto:'fr4_biographer_no'
    },
  ]
},

fr4_biographer_yes: {
  art:'fr4', artLabel:'Free Roam 4 · Day',
  bgText:'THE STORY',
  lines:[
    C('FISK',`Good. I want to start with the county fair.`),
    D(`That's where I'd start.`),
    N(`Fisk opened his briefcase. He took out a notepad, not a contract. Duke thought: that's the right order. He thought: this man knows what he's doing.`),
    N(`They talked for two hours. Fisk asked about the cows, which Duke had not expected. He asked about what it felt like the first time the crowd went quiet. He asked about Cal — how long, what the arrangement was, whether it was a friendship or a working relationship.`),
    D(`Both.`),
    N(`Fisk wrote that down.`),
    N(`He thought: that's going to be in the book. He thought: that's fine. That's true.`),
  ],
  statUpdate:{
    title:'The Book Starts',
    reason:"Fisk is writing it. Duke is shaping it. The story has a shape.",
    deltas:{ showmanship:1 },
    flags:{}
  },
  next:'_hub_fr4'
},

fr4_biographer_later: {
  art:'fr4', artLabel:'Free Roam 4 · Day',
  bgText:'NOT YET',
  lines:[
    C('FISK',`A year.`),
    D(`Maybe less. Depends on what happens next.`),
    C('FISK',`Fair enough.`),
    N(`He didn't argue. He closed his briefcase — the contract still inside, unopened. He stood and shook Duke's hand.`),
    C('FISK',`I'll be here when you're ready.`),
    N(`Duke thought: he means that. He thought: the story will still be there.`),
    N(`He thought: some things are better for the waiting.`),
  ],
  next:'_hub_fr4'
},

fr4_biographer_no: {
  art:'fr4', artLabel:'Free Roam 4 · Day',
  bgText:'NO',
  lines:[
    N(`Fisk looked at him.`),
    C('FISK',`Can I ask why?`),
    N(`Duke thought about it.`),
    D(`Because what it is doesn't need to be explained.`),
    N(`A long pause.`),
    C('FISK',`That might be the best reason I've ever heard.`),
    N(`He closed his briefcase. He shook Duke's hand. He left without arguing.`),
    N(`Duke thought: that went the only way it could go. He thought: I'm going to remember that I said that.`),
    N(()=>{
      const peteActive = GS.rels.pete && GS.rels.pete !== 'absent' && GS.rels.pete !== 'unknown';
      return peteActive
        ? `He thought: he finds the number in the air, not on the ground. And some numbers you don't need someone else to write down.`
        : `He thought: he finds the number in the air, not on the ground. Some numbers were never anybody else's to keep track of.`;
    }),
  ],
  statUpdate:{
    title:'No.',
    reason:"Duke owns the story. Nobody writes it down.",
    deltas:{ nerve:1 },
    flags:{}
  },
  next:'_hub_fr4'
},

fr4_ruthie_thread_close: {
  art:'fr4', artLabel:'Free Roam 4 · Close',
  bgText:'WEDNESDAY',
  lines:[
    N(`It was a Wednesday evening. He remembered that specifically — not because Wednesday was important, but because she had driven out on a weekday, which she didn't usually do, and when he asked why she said: I wanted a weekday. Weekends feel like something.`),
    N(`They sat on the porch. Not the canyon porch — his porch, at home, which was small and faced the street and had two chairs that needed to be replaced but hadn't been.`),
    N(`She had a cup of coffee. He had a cup of coffee. The street was quiet.`),
    C('RUTHIE',`Roy's film.`),
    D(`Yeah.`),
    C('RUTHIE',`He told me he wants to use the three seconds.`),
    D(`At the canyon.`),
    C('RUTHIE',`Yes.`),
    N(`Duke thought about the footage. The white wall. Ruthie's face — three seconds, the thing you couldn't ask someone to do on purpose.`),
    D(`Is that alright.`),
    C('RUTHIE',`I told him yes.`),
    D(`Okay.`),
    C('RUTHIE',`I told him: that's how I know he made it.`),
    N(`He looked at her.`),
    C('RUTHIE',`Every stunt. I don't watch the landing. I watch your face on the ramp, and then I watch the crowd. If the crowd makes the right sound, I look. But those three seconds before the crowd — that's what I was doing.`),
    D(`That's what Roy filmed.`),
    C('RUTHIE',`He didn't ask me to do it. He said: that's what you'd want.`),
    N(`He thought about Roy. He thought about what Ruthie had told him, which was the same thing from the other side.`),
    D(`Come to Vegas.`),
    C('RUTHIE',`You already asked me.`),
    D(`I'm asking again.`),
    N(`She looked at him over her coffee cup with the expression she used when she was reading the thing under the thing.`),
    C('RUTHIE',`I'll still be there.`),
    N(`He thought about Free Roam 1. I'll still be here. He thought about the distance between here and there — not geography, but years.`),
    N(`They sat until the street got dark. She drove home. He watched her taillights reach the corner and turn.`),
    N(`He thought: I'll remember that it was Wednesday. He thought: I'm not sure why. He thought: some things you just remember.`),
  ],
  statUpdate:{
    title:'Wednesday',
    reason:"She'll be there. The thread holds. Vegas.",
    deltas:{ nerve:1 },
    flags:{ ruthieThreadClosed:true }
  },
  next:'_chapter_m5'
},

fr4_close: {
  art:'fr4', artLabel:'Free Roam 4 · Close',
  bgText:'VEGAS',
  // Reached by the Milestone 5 button on both branches (renderHubFR4). Until
  // Phase 2 only the solo arm was named by anything, and the backer arm below
  // — the whole reason the scene exists — had never been read by a run.
  get lines(){
    const head = [
    N(`He sat at the kitchen table with the piece of paper.`),
    N(`Stunts. What else. The thing before the jump.`),
    N(`He had an answer now. He had had it for a while — it had arrived somewhere in the night rides and the garage with Cal and the porch on Wednesday. He had not announced it to himself when it arrived. It had just been there.`),
    N(`He thought: that's the question.`),
    ];
    const tail = [
    N(`Duke hung up. He sat at the table. The kitchen was quiet. Out the window, the street. The lawn, mowed. The truck in the driveway. The sky — through the glass, going dark at the edge — the same as it had always been.`),
    N(`He thought: some things you just remember.`),
    N(`He thought: Vegas.`),
    ];
    if(solo()) return [...head,
    N(`He folded the piece of paper and put it in his jacket pocket and called California. The number was on the wall by the phone, in his own handwriting, which was where every number he had was.`),
    N(()=> GS.flags.fr4VegasDeal
      ? `The man from California picked up on the second ring. Duke said: set the date. A pause. Not the pause-before-numbers. The other kind. The man said: alright. He said he'd call tomorrow.`
      : `The man from California picked up on the second ring. He'd been in the fourth row at the Speedway. He'd been calling. Duke said: yes. Set the date. A pause. Not the pause-before-numbers. The other kind. The man said: alright. He said he'd call tomorrow.`),
    N(`Duke hung up. He thought: on the other side of things, this is where somebody says good work. He sat with that. Then he picked the phone back up and called the garage, and when Cal answered he said it himself.`),
    D(`Good work.`),
    C('CAL',`Yeah.`),
    N(`A longer pause.`),
    C('CAL',`You too.`),
    ...tail];
    // What Duke says next depends on what he already told Earl in Free Roam 4.
    // `signed` means Earl said "I'll tell him tonight" that evening and there
    // is nothing left to authorise; `direct` means Duke asked to make the call
    // himself. The rest of the exchange is the same in all three, and is the
    // point of the scene.
    const dealt = GS.flags.fr4EarlDeal;
    return [...head,
    N(`He folded the piece of paper and put it in his jacket pocket and called Earl.`),
    C('EARL',`Duke.`),
    dealt === 'signed' ? D(`The Vegas date. Put it on the calendar.`)
    : dealt === 'direct' ? D(`I talked to him myself. The answer's yes.`)
    : D(`Tell the man from California yes.`),
    N(`A pause. Not the pause-before-numbers or the pause-before-leverage. The other kind.`),
    C('EARL',`Alright.`),
    D(`Set the date.`),
    C('EARL',`I'll call you tomorrow.`),
    D(`Earl.`),
    C('EARL',`Yeah.`),
    D(`Good work.`),
    N(`A longer pause.`),
    C('EARL',`You too.`),
    ...tail];
  },
  next:'_chapter_m5'
},

// ----------------------------------------------------------------
// MILESTONE 5 — The Retirement Question
// ----------------------------------------------------------------
m5_entry: {
  art:'m5', artLabel:'Milestone 5',
  bgText:'THE QUESTION',
  lines:[
    N(`The question arrived. He had known it was coming. He had not known when.`),
    N(`He was in the kitchen. Or in the garage. Or somewhere that was quiet enough to hear it.`),
    N(`It was not a dramatic question. It was just the next thing. After a certain number of shows, after a certain number of mornings when the shoulder didn't feel right and he went anyway, after a certain number of times Cal replaced the fork seal and didn't say anything and they both knew what that meant — after all of it, the question was just: what now.`),
  ],
  next:'_m5_question_route'
},

m5_question_cal: {
  art:'m5', artLabel:'Milestone 5',
  bgText:'THE WRENCH',
  lines:[
    N(`He was in the garage.`),
    N(`Cal had a wrench in his hand. He was working on the secondary chain housing — not because anything was wrong with it, but because that was how Cal thought. Preventive. Iterative. Every part checked on a schedule that was slightly ahead of any problem that might develop.`),
    N(`He didn't look at Duke.`),
    C('CAL',`You know you don't have to.`),
    N(`Duke looked at him.`),
    N(`Cal kept working. He tightened the housing bolt. He set down the wrench and picked up a rag. He did not elaborate.`),
    N(`That was the question. That was all of it.`),
    N(`Duke thought: Cal has been waiting to say that for a long time. He thought: Cal said it exactly right. He thought: I'm going to have to sit with this.`),
  ],
  next:'m5_decision'
},

m5_question_ruthie: {
  art:'m5', artLabel:'Milestone 5',
  bgText:'THE KITCHEN',
  lines:[
    N(()=> GS.flags.ruthieThreadClosed
      ? `It was his kitchen. She had driven out on a Thursday. He hadn't asked why Thursday.`
      : `It was somewhere unfamiliar. He was not sure whose kitchen. It wasn't a question he'd thought to ask.`
    ),
    N(`She had coffee. She looked at the table for a while.`),
    C('RUTHIE',`I'm not going to ask you to stop.`),
    N(`He waited.`),
    C('RUTHIE',`I just want to know if you've asked yourself the question.`),
    D(`Which question.`),
    C('RUTHIE',`You know which one.`),
    N(`He thought about the county fair. He thought about the three cows. He thought about all the mornings between then and now — the ones where he got on the bike and the ones where he sat in the truck for a while first.`),
    N(`He thought: yes. He thought: I've asked it. I just haven't answered it yet.`),
    D(`Yeah. I've asked it.`),
    N(`She nodded. She drank her coffee. She didn't ask what the answer was.`),
    N(`He thought: she already knows what the answer looks like. She's been watching the hands.`),
  ],
  next:'m5_decision'
},

m5_question_nobody: {
  art:'m5', artLabel:'Milestone 5',
  bgText:'ALONE',
  lines:[
    N(`He was sitting alone.`),
    N(`He wasn't sure where, exactly. The kitchen, maybe. The truck. The edge of something.`),
    N(`The question was just there.`),
    N(`Not from outside — nobody said it. Nobody had to say it. It had been building since the county fair, probably, or maybe since before that, and it had finally arrived in the room he was sitting in and was waiting for him to notice it.`),
    N(`He noticed it.`),
    N(`He thought: alright. He thought: that's the question.`),
  ],
  next:'m5_decision'
},

m5_question_earl: {
  art:'m5', artLabel:'Milestone 5',
  bgText:'THE CONTRACT MEETING',
  lines:[
    N(`It was a contract meeting. Earl had the room, which was Earl's preferred arrangement.`),
    N(`They were three pages into the Vegas addendum when Earl set down his pen.`),
    N(`He looked at Duke across the table.`),
    C('EARL',`I want to ask you something that's not about the contract.`),
    D(`Alright.`),
    N(`Earl folded his hands. He looked at the window for a moment.`),
    C('EARL',`How long are you going to do this?`),
    N(`Duke looked at him.`),
    C('EARL',`I'm not asking as your manager. I'm asking as a man who has watched you do it for a while and wants to know what you're thinking.`),
    N(`Duke thought: this is the question. Earl is asking it in a contract meeting because Earl doesn't know any other room.`),
    N(`He thought: that's actually the right room for Earl to ask it in. That's very Earl.`),
  ],
  next:'m5_decision'
},

m5_decision: {
  art:'m5', artLabel:'Milestone 5',
  bgText:'WHAT NOW',
  lines:[
    N(`He held the question for a while.`),
    N(()=>{
      // Count what the choice list below actually offers: F needs Pete, C
      // needs Earl. "Eight" was a plain literal for three rounds, and read
      // "Eight options" over seven buttons on every run that turned Pete down.
      const peteActive = GS.rels.pete && GS.rels.pete !== 'absent' && GS.rels.pete !== 'unknown';
      const n = 8 - (peteActive ? 0 : 1) - (solo() ? 1 : 0);
      const word = { 8:'Eight', 7:'Seven', 6:'Six' }[n];
      return `${word} options. Not choices exactly — more like the ${word.toLowerCase()} things a man in his position could do next, and only one of them was the right one, and he'd know it when he found it.`;
    }),
  ],
  choices:[
    {
      label:'A',
      text:`Retire clean on top.`,
      subtext:'Walk away while the name still means something. Classic ending.',
      effects:{ flags:{ m5Decision:'retire_clean' } },
      goto:'m5_retire_clean'
    },
    {
      label:'B',
      text:`One last stunt — planned, on his terms.`,
      subtext:'Duke picks the stunt. Prepared. Medium risk.',
      effects:{ flags:{ m5Decision:'last_stunt_planned' } },
      goto:'m5_last_stunt_setup'
    },
    {
      label:'C',
      text:`One last stunt — Earl picks.`,
      subtext:"Earl's choice. Higher risk. Higher payout. His agenda, not Duke's.",
      effects:{ flags:{ m5Decision:'last_stunt_earl' } },
      goto:'m5_last_stunt_earl',
      // Nobody picks for a man who turned the picker down at the county fair.
      _needs:{ earl: EARL_PRESENT }
    },
    {
      label:'D',
      text:`Walk away quietly.`,
      subtext:'No announcement. Some people never know he retired.',
      effects:{ flags:{ m5Decision:'walk_quiet' } },
      goto:'m5_walk_quiet'
    },
    {
      label:'E',
      text:`Keep going.`,
      subtext:'The circuit continues. Condition-dependent. Duke knows the cost.',
      effects:{ flags:{ m5Decision:'keep_going' } },
      goto:'m5_keep_going'
    },
    {
      label:'F',
      text:`Mentor the apprentice.`,
      subtext:"Duke steps back. Pete steps forward. Legacy continues through him.",
      effects:{ flags:{ m5Decision:'mentor' } },
      goto:'m5_mentor',
      _needs:{ pete: PETE_PRESENT }
    },
    {
      label:'G',
      text:`Symbolic stunt — own terms.`,
      subtext:'Not dangerous. Meaningful. The crowd that matters most.',
      effects:{ flags:{ m5Decision:'symbolic_own' } },
      goto:'m5_symbolic_own'
    },
    {
      label:'H',
      text:`Disappear.`,
      subtext:'Duke leaves. No retirement, no announcement. Just gone.',
      effects:{ flags:{ m5Decision:'disappear' } },
      goto:'m5_disappear'
    },
  ]
},

m5_retire_clean: {
  art:'m5', artLabel:'Milestone 5 · Ending',
  bgText:'THE TOP',
  lines:[
    N(`He made the call.`),
    N(()=> solo()
      ? `He told Cal first. There was nobody in front of Cal to tell — there hadn't been since the county fair, and he noticed, dialing, that he'd stopped minding somewhere around the Speedway. Cal said: I figured. Duke said: how long. Cal said: since the canyon. He said it without sentiment. He meant it as a compliment.`
      : `He told Earl first — that was the right order. Earl was quiet for a moment. Then he said: I had a feeling. Duke said: no you didn't. Earl said: no, I didn't. But I thought it was possible.`),
    N(()=> solo() ? `` : `He told Cal next. Cal said: I figured. Duke said: how long. Cal said: since the canyon. He said it without sentiment. He meant it as a compliment.`),
    N(()=> (GS.rels.ruthie && GS.rels.ruthie !== 'absent' && GS.rels.ruthie !== 'unknown')
      ? (solo()
        ? `He told Ruthie last. She already knew. He thought: she probably knew before Cal. He thought: the hands.`
        : `He told Ruthie last. She already knew. He thought: she probably knew before Earl. He thought: the hands.`)
      : `There was no Ruthie to tell. He thought about the fork at the county fair more than once over the years. Mostly he didn't regret it. Mostly.`
    ),
    N(`The announcement ran in three papers and the circuit wire. Sandra wrote it herself. She got the county fair detail right.`),
    N(`He thought: that's the story. He thought: that's actually the story.`),
    N(`He thought: it's enough.`),
  ],
  statUpdate:{
    title:'Clean Exit',
    reason:"On top. The name means something. It always will.",
    deltas:{ showmanship:1 },
    flags:{ m5Complete:true, m5Outcome:'retire_clean' }
  },
  next:'_game_end'
},

m5_last_stunt_setup: {
  art:'m5', artLabel:'Milestone 5 · One More',
  bgText:'LAST RUN',
  lines:[
    N(`He picked the stunt.`),
    N(`Not the buses — he'd done the buses. Not the fire. He picked something that was his: a long straightaway jump, a gap he'd had his eye on for two years, a specific distance that meant something because he'd looked at it and thought: that's the one.`),
    N(`Cal said nothing. He rebuilt the bike from the frame up. He replaced the fork seal. He replaced it twice.`),
    N(`Duke thought: this is what Cal does when he knows it matters. He thought: I know what that is.`),
    N(`The day of — he sat with it the way he'd always sat with it. Until it was just information. Until the gap was just a number. Until the number was in the air.`),
  ],
  next:'_minigame_stunt_m5'
},

m5_stunt_win: {
  art:'m5', artLabel:'Milestone 5 · Triumph',
  bgText:'THE LAST ONE',
  lines:[
    N(`He cleared it.`),
    N(`He didn't know if it was the best jump he'd ever done. It might have been. He wasn't sure that was the right thing to be thinking about.`),
    N(`He landed. He held the landing. He looked at the gap — the other side of it — and thought about all the other gaps, all the other landings, all the other times he'd held a landing and thought: that one.`),
    N(`He thought: that one.`),
    N(`Cal was there. He didn't say anything. He picked up his clipboard.`),
    N(`Duke thought: that's the one. He thought: I'm done.`),
  ],
  get statUpdate(){ return {
    title:'The Last Jump',
    reason:"He cleared it. He held the landing. He said: I'm done.",
    deltas:{ nerve:1, showmanship:2 },
    flags: m5StuntFlags(true)
  }; },
  next:'_game_end'
},

m5_stunt_loss: {
  art:'m5', artLabel:'Milestone 5 · Down',
  bgText:'GOT UP',
  lines:[
    N(`He didn't clear it.`),
    N(`He got close. He got closer than anyone expected. Then the rear wheel caught the edge and the bike went sideways and he was on the tarmac at speed.`),
    N(`He lay there for a moment. He thought about the bus jump. He thought about Cal's bolt. He thought: okay.`),
    N(`He got up.`),
    N(`The crowd made a sound he had heard before — not the triumph sound, not the horror sound. The sound of people watching a man get up from something real.`),
    N(`He thought: that's the last time I'm going to make that sound happen.`),
    N(`He thought: I'm done.`),
  ],
  get statUpdate(){ return {
    title:'Down. Up. Done.',
    reason:"He didn't clear it. He got up. He said: I'm done.",
    deltas:{ condition:-2, nerve:1 },
    flags: m5StuntFlags(false)
  }; },
  next:'_game_end'
},

m5_last_stunt_earl: {
  art:'m5', artLabel:"Milestone 5 · Earl's Call",
  bgText:'HIS CHOICE',
  lines:[
    N(`Duke told Earl: you pick the stunt.`),
    N(`Earl was quiet for a moment. Then he said: you're sure.`),
    N(`Duke said: I'm sure.`),
    N(`The stunt Earl picked was the canyon — the real canyon, not the stadium version. The actual geography. Two hundred and forty-seven feet. Enough room that if everything went right, it would be the footage Roy had always wanted. Enough room that if anything went wrong, there wouldn't be footage of much else.`),
    N(`Cal did not say: you should postpone. He replaced the fork seal. He replaced it twice.`),
    N(`Duke thought: Earl picked the biggest thing. He thought: of course he did.`),
    N(`He thought: alright. Let's go find out.`),
  ],
  next:'_minigame_stunt_m5'
},

m5_walk_quiet: {
  art:'m5', artLabel:'Milestone 5 · Ending',
  bgText:'NO ANNOUNCEMENT',
  lines:[
    N(`He didn't announce it.`),
    N(`He told Cal on a Tuesday. Cal said: okay. He didn't ask why Tuesday. He asked about the bike — what Duke wanted to do with it. Duke said: keep it right. Cal said: okay.`),
    N(()=> solo()
      ? `There was nobody else who needed telling right away. Kessler figured it out a month later, when the season card went out without him on it, and called and said: you could have told me. Duke said: I know. She said: alright.`
      : `He didn't tell Earl right away. When Earl figured it out, a month later, he called and said: you could have told me. Duke said: I know. Earl said: alright.`),
    N(`Some people never knew he retired. They thought he was between shows, between seasons, between whatever came before and whatever came next.`),
    N(`He thought: that's fine. He thought: the ones who need to know know.`),
    N(`He thought: some things don't need a headline.`),
  ],
  statUpdate:{
    title:'Quiet Exit',
    reason:"No announcement. No headline. Just gone.",
    deltas:{ nerve:1 },
    flags:{ m5Complete:true, m5Outcome:'walk_quiet' }
  },
  next:'_game_end'
},

m5_keep_going: {
  art:'m5', artLabel:'Milestone 5 · Continuing',
  bgText:'NEXT SHOW',
  lines:[
    N(`He didn't stop.`),
    N(`The shoulder got worse and then better and then worse again. He adjusted. Cal adjusted the bike setup to account for it. They did not discuss what they were adjusting for.`),
    N(()=> GS.stats.condition >= 3 ? `He was still right. The body held. Some things were different — he felt the landings more than he used to — but he was still himself on the bike, which was the only thing that mattered.` : `He was not entirely right. He knew it. Cal knew it. He went anyway. Some mornings were harder than others. He went anyway.`),
    N(`The shows got smaller. Not because the name got smaller — the name was fine — but because the stunts he could do safely had a different ceiling now, and he was not going to perform below his own standards.`),
    N(`He thought: this is what continuing looks like. He thought: it's different from what I expected. He thought: most things are.`),
  ],
  statUpdate:{
    title:'Still Going',
    reason:"The circuit continues. Duke continues. Condition is the question.",
    deltas:{ showmanship:1 },
    flags:{ m5Complete:true, m5Outcome:'keep_going' }
  },
  next:'_game_end'
},

m5_mentor: {
  art:'m5', artLabel:'Milestone 5 · Legacy',
  bgText:'STEP BACK',
  lines:[
    N(`He called Pete.`),
    N(`Pete said: I know. Duke said: how long. Pete said: since Lubbock.`),
    N(`That was the right answer. Duke thought: he found out in Lubbock. He was going to figure it out eventually. The timeline is right.`),
    N(`The arrangement was simple: Pete took the major shows. Duke consulted on the bike setup — that was the word they used, consulted, which was a polite word for Cal still did most of it and Duke stood nearby and confirmed things. Pete did the jumps.`),
    N(`The first time Duke watched Pete clear a distance he'd cleared himself, he thought about the county fair kid in the front row. He thought: that's the number. That's where the number went. He thought: Pete found it in the air, not on the ground.`),
    N(`He was glad he'd told Pete it was fine.`),
    N(`He thought: eight cars in Lubbock was the right starting point.`),
  ],
  statUpdate:{
    title:'The Apprentice Steps Up',
    reason:"Pete takes the shows. Duke stays near the bike. The work continues.",
    deltas:{ showmanship:2 },
    flags:{ m5Complete:true, m5Outcome:'mentor' }
  },
  next:'_game_end'
},

m5_symbolic_own: {
  art:'m5', artLabel:'Milestone 5 · Own Terms',
  bgText:'JUST THIS',
  lines:[
    N(`He didn't pick a dangerous stunt. He'd done dangerous. He'd done dangerous enough times that the word had a different texture now — not lesser, but different, like a word in a language you spoke fluently for a long time.`),
    N(`He picked something small and specific and his. A stunt at the county fair, which had already been done — symbolically, after M4 — but this was different. This was the last one. He wanted it to be something he'd choose, not something that needed to be impressive.`),
    N(`Three cows. Same as the first time. Not because three cows meant something to the crowd — it didn't, not anymore. But it meant something to him, and he thought: that's the criterion. This one is for me.`),
    N(`The crowd didn't know it was the last one. He didn't tell them. He just did it. He landed it. He held the landing the way he'd held every landing.`),
    N(`He thought: that's the last number I'm ever going to find in the air.`),
    N(`He thought: it was a good number. He thought: they all were.`),
  ],
  statUpdate:{
    title:'Own Terms',
    reason:"His stunt. His call. Three cows. The last number.",
    deltas:{ showmanship:1, nerve:2 },
    flags:{ m5Complete:true, m5Outcome:'symbolic_own' }
  },
  next:'_game_end'
},

m5_disappear: {
  art:'m5', artLabel:'Milestone 5 · Gone',
  bgText:'JUST GONE',
  lines:[
    N(`He left.`),
    N(()=> solo()
      ? `He didn't announce it. There was nobody to not tell, which on his side of things had been true for a while. He told Cal — not that he was leaving, but where the bike keys were and that the service manual was on the second shelf and that the fork seal was recently replaced.`
      : `He didn't announce it. He didn't tell Earl. He told Cal — not that he was leaving, but where the bike keys were and that the service manual was on the second shelf and that the fork seal was recently replaced.`),
    N(`Cal said: okay.`),
    N(`That was the last conversation. Duke didn't know, in the moment, that it was the last one. He found out later, which was the only way to find out.`),
    N(`He drove north. He thought about the county fair. He thought about the number — the one in the air, not on the ground. He thought: I've been finding it long enough. I want to see what it's like to not be looking for it.`),
    N(`He stopped at a motor inn somewhere he'd never been. He slept for eleven hours.`),
    N(`In the morning he drove further north.`),
  ],
  statUpdate:{
    title:'Gone',
    reason:"No announcement. No retirement. Duke left. That's what happened.",
    deltas:{ nerve:2 },
    flags:{ m5Complete:true, m5Outcome:'disappear' }
  },
  next:'_game_end'
},

}; // end SCENES
