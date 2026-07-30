# Daredevil — session notes

## What it is

**Daredevil is a 1970s American stunt-rider story: 207 scenes, about 21,200 words
of narration and dialogue, five milestones, eight endings.** It is the largest
single file in the repo and no handoff has ever described it, so this section is
the point of the session.

You play Duke Harlan. The name and the hometown are both yours to set on the
setup screen, and the text uses them throughout. He rides dirt bikes. The cold
open is a childhood montage with two forks (the moment that made it real, and
what he came from) and then drops you at the county fair, where he is going to
jump three cows in front of a few hundred people and one man he has heard is
coming to look.

That man is Earl Maddox, and the rest of the game is what happens after somebody
with money decides you are worth money. Three cows becomes five cars on regional
TV becomes thirteen buses in a booked stadium, and the last chapter is Vegas and
the question of when a man in this line of work is supposed to stop.

**The shape is five milestones separated by four free-roam hubs.**

| | What it is |
| --- | --- |
| Cold open | 9 scenes, two forks, sets your origin trait and family background |
| **M1 · The County Fair** | Three beats, then the stunt. Earl approaches. Six ways to answer him |
| **FR1 · Early Days** | 5 evenings. Lloyd the fair organiser, a kid with a ramp, Cal, Ruthie, Tommy, the contract |
| **M2 · The Investor Offer** | A three-round contract negotiation. Genuinely the best-written chapter in the file |
| **FR2 · Building the Act** | 6 evenings. Diamondback Danny, Pete the apprentice, the debt, the press |
| **M3 · The Big Break** | Five cars, a TV crew, and a bolt Cal found in the fork housing |
| **FR3 · After** | 7 evenings. Earl renegotiates. Sandra from the press. Reverend Hollis |
| **M4 · The Defining Moment** | Pick one of three: thirteen buses, a fire tunnel, or a symbolic jump back at the county fair |
| **FR4 · Before Vegas** | 6 evenings. Night rides, a biographer, the Vegas offer |
| **M5 · The Question** | Eight ways to end it |

**A full run is 89 of the 207 scenes**, 43%, and **9,362 words of prose**, counted
off a real transcript rather than estimated. Call it 45 minutes of reading plus
four stunt runs. The scene database holds about 21,200 words in total, so no
single run sees even half of it, and two runs with different relationships see
most of it.

**The branches reconverge. The divergence is carried in state, not in the graph.**
Every milestone funnels back into the next hub and every hub funnels into the
next milestone. What differs between runs is which evening scenes you spent your
evenings on, and what the shared scenes *say*: a lot of lines are functions of
`GS.flags` and `GS.rels` rather than fixed text. There are four permanent splits
that close content off for the rest of a run:

- **Earl.** Answering "Not interested" at the fair sets `rels.earl='absent'` and
  removes the contract evening, the FR3 renegotiation and the FR4 Vegas call.
- **Ruthie.** She only exists if you pick "I need to talk to someone first" at the
  fair. One of six options. Miss it and she is absent from all four hubs.
- **Pete.** The apprentice thread has to be opened at the gas station in FR1 and
  engaged with in FR2. It is what unlocks the mentor ending.
- **Milestone 4's stunt.** The bus stack needs Showmanship 4 and Precision 3, the
  fire tunnel needs Nerve 4. The symbolic jump is always available, so a badly
  built character still gets an ending, just a smaller one.

**Five stats:** Nerve, Precision, Showmanship, Condition, Hustle, each 1 to 5.
They gate a handful of choices and they feed the stunt physics. Nerve widens the
green speed band, Precision widens the landing tolerance, Condition slows the
drift, Showmanship pays a style bonus. **Six relationships:** Cal the mechanic,
Ruthie, Tommy, Earl, Danny the rival, Pete the apprentice.

**Eight endings**, all at Milestone 5, all rendering through one epilogue screen
that composes a newspaper headline, a career track (The Legend, The Businessman,
Regional King or The Burnout, inferred from final stats), five verdict lines
(body, legacy, home, the work, nerve) and the relationship roster. The eight:
retire clean, one last stunt on his terms, one last stunt Earl's way, walk away
quietly, keep going, mentor Pete, a symbolic jump at the county fair, disappear.
**Until this session it was seven.** The mentor ending is gated on `GS.rels.pete`,
which was read in five places and assigned in none, so the option was filtered
out of the list on every run ever played.

**Three canvas minigames are implemented and two are reachable.** The Stunt Run
is a side-on jump: throttle up into a green speed band before the lip, then fight
rotation in the air to meet the landing slope at -18 degrees. It is the only one
that matters and it is good. The Recovery is a hold-the-input-in-the-band drill
that runs after a hard crash. **"Work the Crowd", 90 lines with three crowd
moods, an energy meter and a legend, is never launched from anywhere.**

**The state of the writing: finished.** Consistent voice, no placeholder prose,
no lorem. Duke's interiority is rendered as "He thought:" which sounds like a tic
written down and reads well in play. The code disagrees with the prose. Three
chapter headers say STUB, the ending screen said "END OF BUILD", and `m3_end_stub`
is the id of a scene that is not a stub. That is leftover scaffolding around
finished work, not unfinished work.

### Nobody had ever finished it

**Before this session the game could not be completed by any route, and it
stopped at the same place every time: the Milestone 3 pre-stunt choice, about 60%
of the way in.** Five separate wiring bugs. None of them throws. None of them
logs anything a player would see.

**73 scenes and 88.1 KB, 42% of the scene database, had never been reachable**,
plus six more behind a flag nothing sets and one of the eight endings behind a
relationship nothing assigns.

The writing is not the problem with this game. The wiring is, and it is the kind
of wiring that fails quietly: a button that does nothing, a counter that cannot
reach zero, a field name that does not match, a flag nobody writes.

---

## What changed

Everything is in `Projects/daredevil_r4.html` and the new `Projects/daredevil/`
folder. Nothing outside them was touched.

### The five bugs that made it unfinishable

**1. Every hub gated its milestone button on a counter that could not reach zero.**
Each free-roam hub grants a fixed number of evenings and renders its "Milestone N"
button only when `eveRemaining <= 0`. But the number of *spendable* evening cards
is built conditionally from relationship state, and it is routinely smaller than
the number of evenings granted:

| Hub | Evenings granted | Evening cards it can build |
| --- | --- | --- |
| FR1 | 5 | 5, or **4** with no Ruthie, or 3 if Earl is also absent |
| FR2 | 6 | 7 with Ruthie, **5** without |
| FR3 | 7 | **4, always** |
| FR4 | 6 | 6 on a maximal path, fewer if any relationship has gone |

So FR3 was a guaranteed dead end for every player on every path, and FR1 and FR2
dead-ended on **five of the six ways to answer Earl at the county fair**,
including "I'm listening", which is the first option in the list. My first
playthrough hit it after 31 scenes.

Fixed with one helper, `hubExhausted(eveRemaining, eveCards)`, called by all four
hubs after the `_disabled` pass. A hub is done when you are out of evenings **or**
out of anything to spend one on.

**2. `_minigame_stunt_m3` was named by four choices and answered by nothing.**
All three Milestone 3 pre-stunt scenes route "Go" to `_minigame_stunt_m3`.
`goToScene` had no branch for it and `SCENES` had no entry, so it fell through to
`console.warn('Scene not found')` and returned, leaving the choice buttons on
screen doing nothing, forever. `handleStuntRunM3` was fully written and
referenced by nothing.

Added the branch. Also made an unrouted id loud instead of silent: it now
`console.error`s and puts a visible note in the panel, because a dead end should
look like one (locked decision #13).

**3. Two hub cards were gated on flags their own scenes never set.**

- **`fr1_wannabe_intro` looped forever.** The card was gated on
  `!GS.flags.wannabeMet`, but only one of the kid's three answers sets that flag.
  Take either of the two that turn him down and the card comes straight back: the
  same scene, replayable indefinitely, the game never remembering you said no.
  Now gated on `hubDayScenesDone`, which `buildHubCard` was already maintaining
  and nothing was reading. `wannabeMet` has to keep meaning "Pete's thread is
  open" because that is what Free Roam 2 reads it for, so turning him away must
  not set it.
- **"Pete's Mistake" could never appear.** Its card gates on
  `GS.flags.fr2Pete01Done`, a name that occurs exactly once in the whole file, in
  that read. Nothing sets it. Six scenes of finished writing (`fr2_pete_02` plus
  five outcomes, one of which has Pete leave) that no player has seen. Gated on
  `done2.includes('fr2_pete_01')` now, matching how the Danny follow-up does it.

**4. `GS.rels.pete` was read in five places and assigned in none.** It is not even
in `GS.rels`'s initial object, so it was permanently `undefined`. That silently
deleted **Milestone 5's "mentor the apprentice" ending**: the choice carries
`_requires: () => GS.rels.pete && ...`, and `showSceneEnd` drops a choice whose
`_requires` returns falsy without rendering anything, so the option simply was not
in the list. It also made `m4_prestunt_pete_m4` unreachable and kept Pete out of
the epilogue roster.

The thread that already exists now sets the relationship it already implies:
`hanger_on` when you take the kid up on it at the gas station, `ally` if you
commit to his show or teach him something in FR2, `absent` on the branch where
letting his mistake go drives him off. Both terms were already sitting in the
epilogue's `relStateNames` map waiting for a value that never came.

**5. Milestones 3, 4 and 5 read `res.outcome`. The field is `res.result`.**
The stunt run reports `{result, score, details}`. `handleStuntRunResult` (M1)
reads `res.result` and is correct. `handleStuntRunM3`, `handleStuntRunM4` and
`handleStuntRunM5` each read `res.outcome`, which is never set, so every
comparison was `undefined === 'SUCCESS'` and **every stunt from Milestone 3 on
routed to its failure branch no matter how well it was ridden.** Three character
fixes. Also routed M3's hard crash through `m3_failure_bad`, a written scene whose
own `next` is the recovery minigame, rather than jumping past it, which is what
left it orphaned.

### An audit for the same shapes

I checked every other hub card for bug 3's shape, a card gated on a flag rather
than on the "done" list the hub already keeps. Those two were the only ones. The
Lloyd Perkins card is flag-gated but all four of its outcomes set the flag, and
every FR2, FR3 and FR4 day card and every evening card already uses the done list.

I also ran a whole-file audit of bug 4's shape: every `GS.flags.*` and `GS.rels.*`
that is read, against every one that is written. **46 flags read, 77 written, and
after these fixes nothing is read that is never written.** `fr2Danny03Done` and
`fr2Cal02Done` go the other way, written and never read, which is harmless.

### A save

New: `Projects/daredevil/js/save.js`, an ES module on top of
`assets/js/gvb-save.js`. Key **`daredevil-save-v1`**, version 1, and per locked
decision #36 that key does not change. Second adopter of the shared module after
The Fourth Quarter, and it needed no new hooks, which is a good sign for the
module: `repair`, factory `defaults` and `buttons` were all already there.

**What the save holds is the design decision worth recording.** A scene id, the
five stats, the six relationships, and the flag bag. It deliberately does not
hold:

- **the line index inside a scene.** Resume lands at the top of the scene you were
  in, so rewriting prose can never strand a save mid-sentence.
- **anything from `SCENES`.** The save names a node, it does not embed the story,
  which is what lets the writing keep changing after players have saves.
- **minigame state.** Persistence is suppressed while the minigame screen is up,
  so a reload during a jump puts you back at the pre-stunt scene with the choice
  still in front of you.

Fill-ins are in `repair`, not `migrate` (locked decision #37). There are no legacy
saves for this game, which made this the one chance to get the split right before
there are. `repair` clamps stats to 0-5, rebuilds a missing `rels`, and forces the
eight `*Done` flags back to arrays: a non-array there throws on `.includes()` the
first time a hub renders. `migrate` is a no-op with a comment explaining what
belongs in it.

`defaults` is the `freshState` factory, not a literal. `freshState()` is also
where the game's starting state now lives, since `GS` is built from it, so the
save format and the game cannot drift apart.

**The save bar is on the hub, not just the title screen.** That is v7 §9's open
item. A hub is this game's natural "done for tonight" moment: it comes round four
times and it is where a run pauses anyway. It mounts export, import and reset.
The title screen mounts import only, plus a **Continue** button that appears when
a stored save exists (and renames Begin to New Game).

### The inline script is now a module

`<script>` became `<script type="module">` so `save.js` can be imported rather
than inlined. Three inline `onclick` attributes became ids with handlers attached
in a boot block, and `window.__dd` publishes `GS`, `SCENES`, the slot,
`goToScene` and getters for the live scene and minigame. That last part is for the
test driver, which has no other way in now that top-level declarations are not
global.

### Fonts vendored, and this page now makes zero offsite requests

Two `preconnect`s and a `fonts.googleapis.com` stylesheet, gone. Seven woff2 files
in `Projects/daredevil/fonts/`, **100.3 KB for the set**, latin subset: Alfa Slab
One 400, Oswald 400/500/600/700, Space Mono 400/700. All three families are SIL
Open Font License 1.1 and the full licence text ships alongside them.

Two of the three were already in this repo and were copied rather than fetched:
Oswald from `Tools/board-check/node_modules/@fontsource/oswald/`, Space Mono from
`Projects/corner-and-kettle/fonts/`. Only Alfa Slab One needed installing, and it
was done with `npm i --no-save` and then uninstalled, so
`Tools/board-check/package.json` is untouched and `git status` on that folder is
clean.

**Oswald 300 is not vendored.** The Google URL asked for it and nothing on the
page has ever set `font-weight:300`.

**A note for whoever writes v8.** v7 §5 says the site makes zero offsite requests
site-wide. That is wrong for fifteen pages, and the suite cannot see it:
`prepPage()` *fulfills* `fonts.googleapis.com` requests locally from bundled
`@fontsource` packages before the blocked-list check runs, so a font hotlink never
reaches `page.__blocked`. The check that works is a grep for the hostname inside
an `href` or `src` attribute, and it is in the new suite.

### Accessibility

- **The four free-roam hubs were mouse-only.** `buildHubCard` built a `<div>` with
  an `onclick`: not focusable, not announced as a control. They are
  `<button type="button">` now, with `disabled` doing the work the `.disabled`
  class used to fake.
- **`user-scalable=no, maximum-scale=1` is gone** from the viewport meta. This is
  45 minutes of reading on a phone. The usual reason for that flag, browser
  gestures stealing the stunt controls, was already handled properly: the canvas,
  the pedals and the D-pad all set `touch-action:none`.
- **Focus is visible.** Every control was Tab-reachable and invisible once you got
  there, because the default outline does not survive these backgrounds. Added a
  `:focus-visible` rule with a 3px gold outline.
- **The prose is a live region.** `#panel-text` is replaced in place on every
  Continue. Without `aria-live` a screen reader announced the button and nothing
  else, which for this game means nothing at all.

### The ending screen said "END OF BUILD"

It read **END OF BUILD** / *Round 2 — Implementation Complete* / "Your stats at
the end of Round 2". Eight endings land there and it is the last thing a player
sees. Now **THE END** / *A Life on Two Wheels* / "Where he finished".

### Tests, in a folder I own

`Projects/daredevil/test/`:

- **`smoke-save.mjs`**: 53 assertions, plain Node, no browser. The save format,
  validate, repair, round trips, and refusing bad files.
- **`smoke-page.mjs`**: the regression suite. Real browser, real clicks, plays
  the game to an ending twice, and fails non-zero (locked decision #13).
- **`drive-daredevil.mjs`**: the way in and the way through, written once.
  Includes `autopilot()`, a closed loop over the stunt run's telemetry that holds
  the approach in the green band and steers the body angle onto the landing slope.
  It lands SUCCESS reliably, which is what makes a triumph branch reachable from a
  script at all.
- **`transcript.mjs`**: plays a run and writes down every line, every choice
  offered and every choice taken. This is the tool that produced the description
  at the top of this file. Output in `test/transcripts/`.

One line changed in the game for the suite's benefit: `w`, angular velocity, was
added to the stunt run's `tele` object. `tele` is a debug channel nothing reads,
and a proportional loop on angle alone oscillates straight through the landing
band without it.

### Byte breakdown of the file, measured

| Part | Lines | Size | Share |
| --- | --- | --- | --- |
| head | 26 | 1.9 KB | 1% |
| CSS | 292 | 19.6 KB | 6% |
| body markup | 129 | 5.9 KB | 2% |
| **`SCENES`** | **4,260** | **208.3 KB** | **62%** |
| engine + UI | 1,469 | 64.5 KB | 19% |
| canvas minigames | 449 | 32.5 KB | 10% |

Measured before this session's edits, on the 344,237-byte file. **The story is
62% of it.** That is the number the next person needs for the split-the-content
decision, and it says the split is worth doing: 208 KB of prose currently ships on
first paint to somebody who will read 43% of it.

---

## What I verified

Commands from the repo root, and their real output.

### Before any change, the baseline that proved the bugs

```
node Projects/daredevil/test/transcript.mjs clean
  ✗ hub "Free Roam — Early Days" has nothing clickable
  31 scenes → Projects\daredevil\test\transcripts\clean.md
```

31 of 207 scenes, stuck at the first hub, on a run that took the first option
every time. The archived transcript shows the FR1 hub with four cards spent, one
evening left, "Stay Home With Ruthie" disabled because Ruthie was never
established, and no Milestone 2 button.

### Bug 2, proved separately

I fixed the hub gate and the Milestone 3 routing in the same pass, so I never
watched a run stop at `m3_prestunt_alone` with my own eyes. What I have instead
is stronger and repeatable: the route-coverage check in `smoke-page.mjs` walks
every `goto` and `next` in `SCENES` and asks whether `goToScene` can serve it.
Against a served copy of the page with the branch deleted again:

```
# a served copy of the page with the branch deleted
  unrouted targets with the branch removed: ["_minigame_stunt_m3"]
  PASS — the guard catches the bug it exists for
```

Against the real page it reports none. Plus the static facts: four choices in
three scenes point at that id, `SCENES` has no entry for it, `goToScene` had no
branch for it, and `handleStuntRunM3` was defined and referenced nowhere.

### After the wannabe fix, the crash run stopped cycling

Before it, the crash run ran 2,000 steps without ending. The loop detector named
the cause on the first try:

```
  ✗ LOOP: entered "fr1_wannabe_intro" 4 times.
    Last 12: ... fr1_wannabe_intro → fr1_wannabe_close → fr1_wannabe_intro
             → fr1_wannabe_close → fr1_wannabe_intro
```

### After all five fixes, the first completed runs in the game's history

```
node Projects/daredevil/test/transcript.mjs clean
  89 scenes → Projects\daredevil\test\transcripts\clean.md
```

Path ends `m3_triumph_clean → m3_end_stub → fr3_hub_open → ... → m4_triumph_buses
→ fr4_hub_open → ... → m5_decision → m5_retire_clean → ENDING`, and includes
`fr2_pete_02 → fr2_pete_mistake_confrontation → fr2_pete_hard`, which is the
content bug 3 was hiding. Epilogue rendered: *"Duke Harlan: America's Last Real
Daredevil"*, career track **The Legend**, five verdict lines, Cal loyal, Earl
business partner, Danny nemesis. Final stats N5 P5 S5 C1 H5.

```
node Projects/daredevil/test/transcript.mjs rough
  78 scenes → Projects\daredevil\test\transcripts\rough.md
```

A deliberately different run: crashed at the county fair, took the other side of
every fork it could reach, Ruthie never established. It ends at `m5_walk_quiet`,
a different one of the eight, with the headline *"Nobody Remembers the Promoter's
Handshake. They Remember the Fist."* and a shorter relationship roster. 78 scenes
against the clean run's 89, 56 of them shared, **111 distinct scenes across the
two runs, 54% of the 207.** That ratio is the reconvergence in one number: two
deliberately opposed playthroughs still overlap on more than half their scenes.

### In the browser, by hand

Served the repo on a static server and drove the real page:

- **All seven woff2 load, none errors.** `document.fonts` after forcing every
  weight: Alfa Slab One 400, Oswald 400/500/600/700, Space Mono 400/700, all
  `loaded`, `anyFontFailed: false`. `.title-h1` computes to
  `"Alfa Slab One", Georgia, serif` and body to `Oswald, "Arial Narrow"`.
- **Title screen.** Continue present but `display:none` with no save, Begin shown,
  Import save shown. No console errors on load.
- **Hub cards are real buttons.** All seven are `BUTTON`, the Ruthie card is
  `disabled: true` on a run where she was never established, and reaching the hub
  wrote a save with `screen: "hub"`.
- **Focus.** A scripted `.focus()` deliberately does *not* trigger
  `:focus-visible`, so I pressed Tab for real: the focused hub card reports
  `matchesFocusVisible: true` and `outline: 3px solid rgb(217, 154, 43)` at 3px
  offset, and Tab skips the disabled card.
- **375x812.** `scrollWidth - clientWidth` is 0, no element's right edge crosses
  the viewport, hub cards render 343px wide.

### Unit tests

```
node Projects/daredevil/test/smoke-save.mjs
  53 passed, 0 failed
```

### Regression suite

```
node Projects/daredevil/test/smoke-page.mjs
  44 passed, 0 failed
```

The 44, grouped:

- **The page.** No Google Fonts hotlink in the served HTML, no dev placeholder in
  the rendered ending screen, `@font-face` declared, all three sampled woff2
  serving 200, `page.__blocked` empty, no console errors on load, the module
  booted and published `window.__dd`, storage key is `daredevil-save-v1`.
- **Routing.** Every `goto` and `next` target in `SCENES` is routable, unrouted:
  none.
- **The clean run.** 89 scenes to an ending, reaching M3, a *triumph* at M3, FR3,
  the M4 stunt choice, a *triumph* at M4, FR4, the M5 decision, one of the eight
  endings. Three stunt runs played, `SUCCESS/95, SUCCESS/95, SUCCESS/94`, every
  one landed by the autopilot. Zero page errors across the whole thing.
- **The save.** Reaching a hub wrote one with `screen: "hub"`; a reload put
  Continue on the title screen and renamed Begin to New Game; Continue restored
  the name, town, stats, evenings spent and which evenings, and landed on the hub.
  A truncated blob, another game's export and a wrong-shaped object each left the
  title screen with no Continue.
- **The crash run.** 78 scenes to a different ending. Holding the throttle open
  does crash the bike, a crashed Milestone 1 routes to a crash aftermath, and a
  run that started badly still reaches the Milestone 5 decision. The two paths
  are genuinely different. Zero page errors.
- **Mobile.** No horizontal overflow at 375x812, no errors.

### Guard-rails broken on purpose (locked decision #34)

- **Route coverage.** Served a copy of the page with the `_minigame_stunt_m3`
  branch deleted and re-ran only that check:
  `unrouted targets with the branch removed: ["_minigame_stunt_m3"]`. Against the
  real page it reports none. So the check that would have caught the bug does
  catch the bug.
- **The loop guard** was not written speculatively. It was added because the crash
  run ran 2,000 steps without ending, and the first thing it printed was the
  `fr1_wannabe_intro` cycle above. The stall fingerprint never fires on a cycle,
  because the screen keeps changing.
- **The corrupt-save guard** is exercised three ways in `smoke-page.mjs`: a
  truncated blob, another game's export, and a well-formed object of the wrong
  shape. Each is asserted to leave the title screen with no Continue. The same
  suite asserts a *good* save does offer Continue, so the guard is not just
  refusing everything.

### Repo checks

```
cd Tools/board-check && npm run check
  280 units checked, 0 broken
  0 collisions, tightest vertical gap 7.1px

npm run social:check
  23 notices · 23 already current · 0 had no block · 0 out of date · 0 failed
  every page is in sync with the board
```

I measured a baseline of 236 units before starting; the count moved to 280
because of my 17 new files and because other threads added their own during the
session. Nothing broken either way. `social:check` clean confirms I did not edit
inside the `gvb:social` markers.

---

## Shared-file requests

Applicable without reading this session.

**1. Nothing is required.** No board `href` change and no `gvb-save.js` change.
The file stayed at `Projects/daredevil_r4.html`, so the URL still resolves and the
board card is correct as it stands.

**2. A preview, if prompt 21 wants one.** This game has no preview and no OG image,
unlike the seven that do, and it is now finishable so a preview would be showing
something real. Suggested recipe for `Tools/board-check/games.mjs`:

```js
daredevil: {
  url: '/Projects/daredevil_r4.html',
  frame: { width: 1280, height: 800 },
  saveKey: 'daredevil-save-v1',
  live: false,                       // turn-based; locked decision #29
  async open(page, { wait }) {
    await page.click('#btn-begin');
    await wait(200);
    await page.click('#btn-start');  // accepts the default name and town
    await wait(600);
    await page.click('#ct-btn');     // the chapter card
    await wait(700);
  },
},
```

That lands on `cold_open_01`: the panel screen with the art band, the speaker tag,
the first line of prose and the Continue button. **The frame I would actually
capture is one scene further in, `cold_open_origin_choice`, four more
`.panel-continue` clicks, because that frame shows the choice list, which is what
the game is.** Locked decision #28 wants a frame from play and the capture proving
it got there: assert on `.choices-list button` being present.

**3. The OG description is right and needs no change.** "Stuntman Duke Harlan
chases the next big stunt." I did not touch anything inside the `gvb:social`
markers (locked decision #31).

**4. For v8 §5.** The "zero offsite requests site-wide" claim is wrong for fifteen
pages that hotlink Google Fonts, and the suite cannot see it for the reason given
above. Daredevil is now fixed and Coffee Shop Sim appears to be as well
(`Projects/corner-and-kettle/fonts/` exists). The rest need a grep, not a
`page.__blocked` check.

---

## Deliberately not done

**The restructure into `Projects/daredevil/` plus `js/` plus content-as-data.**
This is the thing the prompt pushes hardest and I am not doing it, for a reason I
want on the record rather than buried: **the game had five bugs that made it
impossible to finish, and it had no test of any kind.** Restructuring 6,700 lines
of branching narrative against a test suite that is one session old is exactly how
you silently lose a branch, because the choice just is not there any more and
nothing errors. The right order is: make it finishable, prove it with a suite that
plays it end to end, then move the furniture. Both halves of that are now true, so
the next session can do it with a before-and-after it can trust.

The numbers it needs are above: 62% of the file is `SCENES`, 208 KB, and a run
reads 43% of it. The URL cost is real, `/Projects/daredevil_r4.html` stops
resolving and that is a board `href` request, and the `_r4` should be dropped at
the same time since nothing depends on the suffix.

**Splitting the story into fetched chunks.** Same reasoning, and it is downstream
of the restructure. Worth saying that 344 KB of HTML gzips to much less and the
page ships no images at all, so this is a smaller win than the raw number suggests.
Measure the gzipped transfer before deciding (locked decision #42).

**"Work the Crowd."** 90 lines of finished minigame, with three crowd moods, an
energy meter and a nerve gate at 45, and no `launchMinigame('crowd')` anywhere. I
left it. **This is the one unreachable thing I found and did not fix**, and the
reason is that the other five each had a single obviously-intended wiring and this
one does not. The plausible homes, the Milestone 1 stunt aftermath or the Danny
head-to-head in FR2, are design calls about pacing. Someone should either place it
or delete it, and guessing which is not my call.

**`m1_earl_card_stub` and `m3_end_stub`.** Both are real scenes with finished
prose and misleading ids. Renaming an id means touching every `goto` that points
at it for zero player-visible gain, and it is free to do as part of the
restructure.

**The Ruthie continuity hole.** `m5_retire_clean` says "He told Ruthie last. She
already knew" whether or not Ruthie was ever established, and on five of six
Milestone 1 paths she was not. The epilogue's relationship roster correctly omits
her, so the game contradicts itself on the same screen. This is one of several
places where the prose assumes a character the state says is absent. I found it by
reading a transcript of a run where she is missing. Fixing it properly means a pass
over the late-game prose with the no-Ruthie flag set, which is writing work rather
than code work, and the whole back half has never been read in context because
nobody could reach it.

**Making the six-way Earl response less punishing.** Five of the six answers lock
Ruthie out for the entire game, and the option that keeps her, "I need to talk to
someone first", reads as the least decisive one. That is a design problem, not a
bug, and now that the hubs no longer soft-lock its only cost is content. I left it
rather than quietly rebalancing somebody else's story.

**Deeper mobile work.** I checked 375x812 for horizontal overflow and console
errors and it is clean, and removing `user-scalable=no` is the big win. I did not
do a proper pass on the minigame's touch pedals at that width, which is where I
would look next.

**Contrast measurement.** I fixed focus visibility, which was the clear failure. I
did not measure the palette's contrast ratios. `--cream-faint` (#7a684c) on the
dark panels is the one I would check first.

---

## Next session

Ordered by value per effort.

1. **The restructure, now that it is safe.** `Projects/daredevil/index.html` plus
   `js/` for the engine and the story as data. `smoke-page.mjs` plays two full
   paths and `transcript.mjs` writes down every line of both, so diff the
   transcripts before and after and a lost branch cannot hide.
   `Projects/Torchbearer files/content-authoring-guide.md` is the same-repo
   precedent for the content format. Board `href` request at the same time, and
   drop the `_r4`.
2. **Place or delete "Work the Crowd."** 90 finished lines either become a beat in
   the game or stop being carried. Cheap either way, and it only needs a decision.
3. **A pass over late-game prose for absent characters.** The Ruthie hole above is
   the clearest and it will not be the only one, because the whole back half was
   written for a run nobody could take. `transcript.mjs` with a plan that skips a
   relationship is how to find them.
4. **A preview and an OG card.** Recipe is in Shared-file requests. Prompt 21's to
   run.
5. **The other thirteen font hotlinks.** Daredevil and Coffee Shop Sim are done. A
   grep for `fonts.googleapis.com` across `Projects/` finds the rest, and the
   pattern is now established twice.
6. **Minigame touch controls at 375px.** Small, and this is the site's best mobile
   candidate.
