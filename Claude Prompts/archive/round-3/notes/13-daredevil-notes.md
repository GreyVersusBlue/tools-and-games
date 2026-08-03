# Daredevil — session notes

## What it is

**Daredevil is a 1970s American stunt-rider story: 207 scenes, about 21,200 words
of narration and dialogue, five milestones, eight endings.** It was the largest
single file in the repo and no handoff had ever described it before round 1, so
this section — carried forward unchanged from round 1 and round 2, since round 3
touched prose inside existing scenes but added or removed none — is still the
point of it.

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
that close content off for the rest of a run — and, as of this round, one of
them is now known to close off far less than advertised:

- **Earl.** Answering "Not interested" at the fair sets `rels.earl='absent'` and
  is *supposed* to remove the contract evening, the FR3 renegotiation and the
  FR4 Vegas call. It does remove those three optional evening cards. **It does
  not remove Milestone 2, 3, or 4 themselves** — see "The Earl-rejection
  railroad" below, this round's headline finding.
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
Ruthie, Tommy, Earl, Danny the rival, Pete the apprentice. Of the six, only
Ruthie, Earl and Pete have a genuine "never established" state (`unknown` /
`absent`); Cal, Tommy and Danny always exist as characters in the story and only
vary in warmth, so the class of bug this round hunted for doesn't apply to them
the same way — see "What I verified" for the Cal check.

**Eight endings**, all at Milestone 5, all rendering through one epilogue screen
that composes a newspaper headline, a career track (The Legend, The Businessman,
Regional King or The Burnout, inferred from final stats), five verdict lines
(body, legacy, home, the work, nerve) and the relationship roster. The eight:
retire clean, one last stunt on his terms, one last stunt Earl's way, walk away
quietly, keep going, mentor Pete, a symbolic jump at the county fair, disappear.

**Three canvas minigames, all wired to a call site since round 2.** The Stunt Run
is a side-on jump: throttle up into a green speed band before the lip, then
fight rotation in the air to meet the landing slope at -18 degrees. The
Recovery is a hold-the-input-in-the-band drill that runs after a hard crash.
Work the Crowd is three crowd moods, an energy meter, a nerve gate at 45, fired
on the one Milestone 1 outcome where Duke performs for the crowd.

**The state of the writing: finished, with one real gap found this round.**
Consistent voice, no placeholder prose, no lorem. Duke's interiority is
rendered as "He thought:" which sounds like a tic written down and reads well
in play. Round 1 found the code disagreeing with the prose in three places and
fixed it; round 2 found two Ruthie-continuity holes and fixed those; round 3
(this round) found a much bigger one — see below — plus two smaller
Pete-continuity holes of the same shape as round 2's Ruthie ones.

### Round 1: nobody had ever finished it

**Before round 1 the game could not be completed by any route, and it stopped at
the same place every time: the Milestone 3 pre-stunt choice, about 60% of the way
in.** Five separate wiring bugs, none of which threw or logged anything a player
would see: every hub gated its milestone button on a counter that could not
reach zero; `_minigame_stunt_m3` was named by four choices and answered by
nothing; two hub cards were gated on flags their own scenes never set;
`GS.rels.pete` was read in five places and assigned in none, silently deleting
the mentor ending; and three of four stunt-result handlers read `res.outcome`
instead of the real field, `res.result`. All five were fixed. 73 scenes, 88.1
KB, 42% of the scene database, were unreachable before round 1 and are reachable
now. Full account: `Claude Prompts/archive/round-1/notes/13-daredevil-notes.md`.

Round 1 also gave the game a save (`daredevil-save-v1`, on `assets/js/gvb-save.js`),
vendored its seven fonts (100.3 KB, zero offsite requests), and wrote the first
test suite this project ever had — `Projects/daredevil/test/`, still owned by
this project, still the thing every change in every round is checked against.

### Round 2: the restructure, Work the Crowd, and the Ruthie holes

Split the 356 KB monolith `daredevil_r4.html` into `Projects/daredevil/`'s four
files (`index.html`, `js/state.js`, `js/scenes.js`, `js/engine.js`, plus the
already-separate `js/save.js`), byte-for-byte diffed against the original
outside the intended edits. Placed the previously-unreachable Work the Crowd
minigame at the Milestone 1 stunt-perfect aftermath. Fixed two Ruthie-continuity
holes (`m5_retire_clean`, `fr4_night_ride`) where prose unconditionally
referenced Ruthie on runs where she'd never been established. Fixed a fourth,
smaller bug found while tracing `GS.town`: `patchDynamicScenes()` missed 2 of 5
places a custom hometown gets baked in, including the game's own opening line.
`daredevil_r4.html` became a redirect stub. Full account in this file's git
history / round 2's version of these notes.

---

## What changed

Round 3 was the "what's left" list from round 2's own notes, in order: measure
gzipped transfer size before deciding on further splitting, run a broader
absent-relationship prose sweep beyond Ruthie, verify touch controls at 375px
under real touch-emulated input, and measure the `--cream-faint` contrast
question that had gone unmeasured for two rounds running. The prose sweep
surfaced this round's real find. All work is inside `Projects/daredevil/`;
nothing outside it was touched.

### The Earl-rejection railroad — this round's headline finding

The absent-relationship prose sweep (see "the method" below) started by finally
playing out the "Not interested" branch at the fair end-to-end, something no
previous round's transcripts had ever exercised — both `clean` and `rough`
happen to hit other options on that six-way choice by way of their own
fallback rules. **`GS.rels.earl` does correctly become `'absent'`** — confirmed
by reading it directly off the live page after making the choice — **but
Milestone 2, 3 and 4's own chapter transitions never check it.**
`goToScene()`'s `_chapter_m2` branch in `engine.js` picks its entry scene from
`GS.flags.stuntOutcome` and `GS.flags.hubEveningsUsed` only; `showChapter()`'s
subtitle is a fixed string, `` `Earl Maddox is waiting. The contract is on the
table.` ``, regardless of relationship state. The result: a player who flatly
turns Earl down at the fair still gets marched through the entire investor
negotiation, the TV deal, and everything built on it, with dialogue that
assumed the player had cooperated the whole way — worst of all,
`m2_entry_waited` had Duke say **"You said call when I was ready,"** a line
that is not just tonally off but factually false in this branch: in the
rejection branch Duke's actual last words to Earl were "I said not interested,"
and Earl's parting line was "That's for when you change your mind," not an
agreed-upon callback.

**What I did and didn't fix.** Rewriting Milestones 2 through 4 to have a real
alternate path for a rejected Earl is a content-authoring decision on the scale
of round 1's six-way-response question — not something to improvise solo. What
I did fix, the same minimal way round 2 fixed the Ruthie holes: patched the
one factually false exchange in `m2_entry_waited` (the "you said call when I
was ready" line and the sentence before it, which claimed Duke deliberately
made Earl wait — also false in this branch) so that a rejected-and-returned
Earl reads as a coherent narrative beat ("you're a hard man to reach... I
heard the part that mattered") instead of erasing the rejection outright.
Everything downstream of that point — Earl still negotiates, the player can
still sign or not, `_chapter_fr2`'s "You signed. Earl shook your hand." still
fires because the transcript shows the negotiation really does end in `m2_sign`
regardless of the opening exchange — reads fine under the "Earl doesn't take no
for an answer" interpretation and needed no further changes. `_chapter_m2` and
`_chapter_m4`'s fixed subtitles ("Earl Maddox is waiting" / "Earl has
proposals") are ambiguous enough to support that reading too, so I left them.

**This is bigger than a prose fix and I'm flagging it as such.** The "Not
interested" option is fully reachable, not locked or hidden, and a player who
picks it expecting a different game is instead reading dialogue built for the
branch they just declined, mostly unremarked. I fixed the one line that was
flatly false; I did not attempt to make "Not interested" tell a materially
different story, because that's new content, not a bug fix. See "Next
session."

### Two Pete-continuity holes, same shape as round 2's Ruthie ones

Declining Pete's thread at the gas station (`fr1_wannabe_intro`, choosing "This
isn't something I can teach" or "Maybe later" — neither sets `wannabeMet`, so
`GS.rels.pete` stays `undefined` for the rest of the run, same as never having
met him) surfaced two scenes that mention Pete by name regardless of whether
he was ever established:

1. **`fr4_biographer`** (accepting the biographer): "He thought about Pete's
   sentence. He finds the number in the air, not on the ground." — crediting
   Pete with a line he only ever says in `m4_prestunt_pete_m4`, a scene gated
   on Pete being active. Fixed to fall back to Duke's own version of the
   thought, unattributed, when Pete was never met.
2. **`fr4_biographer_no`** (declining the biographer): "And some numbers you
   don't need someone else to write down" — a direct callback to Pete having
   written that line in his notebook, which never happened if Pete doesn't
   exist. Fixed the same way.
3. **`fr4_night_ride`** — already had a `GS.rels.ruthie` branch from round 2's
   fix, but the "He thought about Pete finding it in Lubbock" clause sitting
   right next to it was unconditional. Extended the existing branch to also
   check Pete, so all four combinations of Ruthie-established × Pete-active
   render correctly instead of two.

All three are `N(fn)` prose swaps, same pattern as round 2's Ruthie fixes and
the one already in this scene — no flag, stat, or routing change. Confirmed
real and not hypothetical: the existing `rough` baseline transcript (Mack
Teller, crash at the fair) already never establishes Pete, so re-running it
after the fix changed exactly these three lines and nothing else — this bug
was sitting inside a transcript this project has been diffing clean for two
rounds, because nobody had grepped it for "Pete."

**The Cal check came back empty.** Cal has no `unknown`/`absent` state — he's
always in the story as the mechanic, only his warmth varies (`neutral`,
`warm`, `strained`, `loyal`) — so the "referenced a character who was never
established" bug class doesn't apply to him the same way. Grepped for
unconditional Cal mentions claiming special warmth or loyalty outside the
already-correctly-gated spots; found two generic "Cal is a good mechanic"
lines that are true in every run regardless of relationship state, and nothing
that assumed `loyal` when a run hadn't earned it.

### `GS.flags.earlResponse` was read but never assigned

Found while tracing the Earl-rejection branch. `engine.js` reads
`GS.flags.earlResponse==='not_interested'` to decide whether the disabled "Read
the Contract" evening card should say "(No contract yet)" instead of the
generic "Costs 1 Evening" — but nothing in `scenes.js` ever set that flag, so a
player who turned Earl down saw a locked card that still said "Costs 1
Evening," which reads as "you haven't gotten to this yet," not "there's no
contract because you turned him down." Same shape as round 1's `GS.rels.pete`
bug: a value read in one place, written in none. One-line fix: the "Not
interested" choice's `effects` now also sets `flags:{earlResponse:'not_interested'}`.
Confirmed by transcript: the FR1 hub in the `no_earl` run now shows "(No
contract yet)" on that card instead of the wrong generic text.

### Gzipped transfer size, measured for the first time (locked decision #42)

Two rounds running, "measure the gzipped size before deciding scenes.js is too
heavy" sat as a "deliberately not done." Measured this round with Node's
`zlib`, gzip level 9, against the actual files on disk:

```
index.html        31.5 KB raw ->  7.7 KB gzip
js/state.js         2.2 KB raw ->  1.0 KB gzip
js/scenes.js      211.8 KB raw -> 58.7 KB gzip   (48.6 KB brotli)
js/engine.js      106.9 KB raw -> 30.9 KB gzip
js/save.js          6.2 KB raw ->  2.6 KB gzip
-----------------------------------------------
TOTAL             358.4 KB raw -> 100.9 KB gzip
```

**Verdict: not worth splitting.** The entire game — every scene, all four
milestones, every ending, the whole engine — is a ~101 KB gzipped download,
smaller than a single moderate JPEG, fetched once per session (GitHub Pages
serves gzip/brotli automatically for static text assets). `scenes.js` alone is
58.7 KB gzipped against 211.8 KB raw, a 3.6x reduction, exactly the "344 KB of
HTML with no images gzips to much less than the raw number suggests" round 1
predicted. Splitting into fetched chunks would trade a single ~59 KB request
for several smaller ones plus round-trip overhead, for a page that's already
well under any meaningful budget. Closing this "deliberately not done" as
resolved, not deferred again.

### Contrast, measured for the first time (two rounds running)

`--cream-faint` was `#8a7a60` in the file (not `#7a684c` as earlier rounds'
notes said — that number appears to be stale; the CSS itself only ever
defines the one value, so I'm trusting what's actually in the file). Computed
WCAG contrast ratios against every dark surface it renders on:

```
cream-faint (#8a7a60) vs --bg     (#241a12)  4.09:1
cream-faint (#8a7a60) vs --bg2    (#2f2117)  3.73:1
cream-faint (#8a7a60) vs --panel  (#38281a)  3.39:1
cream-faint (#8a7a60) vs --panel2 (#43301d)  3.00:1
```

All four fail WCAG AA's 4.5:1 threshold for normal text (this is small UI
text — subtitles, stat labels, choice hints — never large/bold, so the 3:1
large-text exception doesn't apply). Fixed by moving the value to `#ac9a7f`,
chosen as the lightest point that still clears 4.5:1 against the worst case
(`--panel2`) with a small margin, without going all the way to `--cream-dim`
and losing the visual distinction the faint tier exists for:

```
cream-faint (#ac9a7f) vs --panel2 (#43301d)  4.58:1
cream-faint (#ac9a7f) vs --panel  (#38281a)  5.17:1
cream-faint (#ac9a7f) vs --bg     (#241a12)  6.24:1
```

One CSS variable, `index.html` line 57. Confirmed the new value is live via
`getComputedStyle` in a browser tab and re-ran the full suite afterward — no
test asserts on the literal hex, so nothing else could have broken, and
nothing did.

### Minigame touch controls at 375px, verified under touch-emulated input

Round 2 read `bindHold()` in `engine.js`, found it already uses pointer events
(`pointerdown`/`pointerup`/`pointercancel`/`pointerleave`) and `touch-action:
none` on the canvas, pedals and D-pad, and explicitly declined to call it
fixed on a code read alone. Wrote
`Projects/daredevil/test/verify-touch-375.mjs`, a one-off manual check (not
part of the committed regression suite, but kept in `test/` the way
`transcript.mjs` is — a tool, not an assertion) that boots the page at 375x812
with Playwright's `hasTouch`/`isMobile` context, drives it to the Stunt Run
minigame, and dispatches real `pointerType:'touch'` pointer events against the
gas pedal:

```
ok   reached the Stunt Run minigame
ok   deck rendered pedal controls
ok   no horizontal overflow with the minigame deck visible — 0px
ok   pedal computed touch-action is none — none
ok   canvas computed touch-action is none — none
ok   gas pedal hit target is at least 44x44 CSS px — 300x87
ok   a touch pointerdown adds the .held class
ok   the throttle speed rose while the touch pointer held gas — 0.0 -> 116.0
ok   a touch pointerup removes the .held class
ok   pointercancel releases a held touch the same as pointerup
```

**What this proves and what it doesn't.** This confirms the actual code path —
computed `touch-action:none`, a 300x87 CSS-pixel hit target (well past the
44px minimum), and a real hold/release/cancel cycle that moves the game's own
telemetry — behaves correctly under Playwright's touch-emulated pointer
events, which is real evidence, not a code read. It is still not a physical
touchscreen: real hardware also involves the OS/browser's own scroll-gesture
recognition, which `touch-action:none` is supposed to suppress before any JS
ever sees a pointer event, and no software emulation fully stands in for that.
Upgrading this from "unverified" to "verified under touch-emulated pointer
input, not yet on physical hardware" — a real step, not a full close-out.

---

## What I verified

Commands from the repo root, real output.

### Syntax and the fast suite

```
node --check Projects/daredevil/js/scenes.js    — OK
node Projects/daredevil/test/smoke-save.mjs
  53 passed, 0 failed
```

### The regression suite, after all edits

```
node Projects/daredevil/test/smoke-page.mjs
  44 passed, 0 failed
```

Same 44 checks as round 2, all still green — the contrast fix is CSS-only and
the scene edits are prose-only, so this was the expected result, confirmed
rather than assumed.

### Transcripts, before and after every edit, diffed line for line

Took fresh baselines of `clean` and `rough` before touching anything (matching
round 2's own paths exactly — 89 and 78 scenes, identical routes, confirming
the game was stable going in). Wrote two new plans into `transcript.mjs`'s
`RUNS` table for this round's sweep:

- **`no_earl`** (Ray Dockery of Split Oak): answers "Not interested" at the
  fair.
- **`no_pete`** (Ellis Boone of Cutter Ridge): declines the Young Wannabe at
  the gas station.

Ran all four, applied the fixes, ran all four again, diffed old against new:

```diff
# clean.md — no prose touched (Earl backer, Pete active in this run already)
- STUNT RESULT — SUCCESS / 94
+ STUNT RESULT — SUCCESS / 95        (autopilot timing jitter, not a regression)
```

```diff
# rough.md — Pete was never established in this run either (its own fallback
# rules happen to decline him), so both Pete fixes fire here for free:
- He thought about Pete's sentence. He finds the number in the air, not on the ground.
+ He thought about the number — the one you found in the air, not on the ground.
- And some numbers you don't need someone else to write down.
+ Some numbers were never anybody else's to keep track of.
- He thought about Pete finding it in Lubbock. He thought about Roy filming...
+ He thought about Roy filming the three seconds after.
```

```diff
# no_earl.md — the M2 entry fix, verbatim:
- Earl's office. He'd kept Duke waiting a week and a half before calling back...
+ Earl's office. Duke hadn't called. He'd told the man to lose his number...
- EARL: You made me work for it.       DUKE: You said call when I was ready.
+ EARL: You're a hard man to reach.    DUKE: I told you I wasn't interested.
```

```diff
# no_pete.md — both fr4_biographer-branch fixes, verbatim, plus fr4_night_ride:
  (same three hunks as rough.md above)
```

Every run kept its exact scene path and scene count (89 / 78 / 88 / 84) before
and after — nothing rerouted, only prose changed, and only in the hunks this
round intended. The only other diffs across all four transcripts were ±1
stunt-score jitter from the autopilot's frame-timing, the same variance round
2's own notes already called out as expected.

Also confirmed directly (not just inferred from the code) that
`GS.rels.earl` really does become `'absent'` immediately after choosing "Not
interested," by reading `window.__dd.GS.rels` off the live page right after
the click — the contradiction was real, not a transcript artifact.

### Touch controls and contrast

Covered above in "What changed" — both are new measurements this round, not
carried over.

### Repo checks

```
cd Tools/board-check && npm run check
  integrity sweep: 362 units checked, 0 broken
  0 collisions, tightest vertical gap 9.1px
```

```
npm run social:check
  18 notices · 12 already current · 1 had no block · 5 out of date · 0 failed
  DRIFT  Projects/daredevil/index.html   (among 6 pages out of sync)
```

**Daredevil's own `gvb:social` block is drifted again** — its `og:url` already
correctly reads `.../Projects/daredevil/` (so whatever ran `npm run social`
after v9's board-`href` fix did land), but the sync check still flags it out
of sync against the board's current notice, for a reason I can't diagnose
without touching `index.html` or `sync-social-tags.mjs`, both off-limits to
this prompt. Not this project's file to fix — see "Shared-file requests."

```
grep -c fonts.googleapis.com Projects/daredevil/index.html
  1
```

Not a live hotlink — it's the one-line code comment in `index.html`'s
`<style>` block explaining the fonts used to be hotlinked before being
vendored (references "v7" of the handoff docs, so this documentation predates
this round). No `<link>`, `@font-face src`, or CSS `url()` in the file
actually points offsite; `npm run check`'s static-source sweep (the check
locked decision #44 says to trust) reports 0 broken units and doesn't flag
this file. Left the comment as-is — it's history, not a live reference.

### Guard-rail discipline (locked decision #34)

Didn't add a new automated guard-rail this round (the fixes are prose-only,
same as round 2's Ruthie fixes, which also didn't get one) — but did verify
each fix the equivalent way: confirmed the *broken* text via a real transcript
before patching (the `no_earl`/`no_pete`/`rough` diffs above are literally
"here is the bug, verbatim, from a real playthrough" for every fix in this
round), then confirmed the *fixed* text the same way afterward. That is the
break-it-and-watch-it-fail / fix-it-and-watch-it-pass shape locked decision
#34 asks for, done through the transcript tool rather than a new assertion.

---

## Shared-file requests

Nothing new required from this project's own files — everything under
`Projects/daredevil/` needed for this round's work is done. One update to a
still-open item from round 2:

**1. Daredevil's social tags are still out of sync — `npm run social:check`
confirms it, this round, independently of round 2's or v9's claims.** The
`og:url` inside `Projects/daredevil/index.html`'s `gvb:social` block already
correctly names `.../Projects/daredevil/`, so the board-`href` fix did
propagate at some point — but `sync-social-tags.mjs --check` still reports
this page as `DRIFT` against the board's current notice, for a reason I
can't diagnose without reading/editing `index.html` (the board) or
`sync-social-tags.mjs`, both outside this prompt's boundary. Whoever owns
that script next should treat this as unresolved, not re-fixed — 6 pages are
currently out of sync repo-wide (`Projects/daredevil/index.html`,
`Projects/torchbearer.html`, `Projects/fourth-quarter/index.html`,
`Projects/Ren-Faire-Claude/index.html`, `Projects/orbital/index.html`,
`newindex.html`), so this may be a repo-wide regression in the sync script or
its board-notice parsing, not specific to Daredevil.

**2. Nothing else.** No new `gvb-save.js` gap (storage key unchanged, no new
hooks needed), no board `href` change, no `games.mjs` recipe change (still
correctly pointed at `/Projects/daredevil/index.html`).

---

## Deliberately not done

**A full alternate Milestone 2–4 narrative for a rejected Earl.** This round's
biggest finding — see "The Earl-rejection railroad" above — is that saying
"Not interested" removes three optional evening cards but does not meaningfully
change the milestone spine: Earl comes back, negotiates, and the story
proceeds almost exactly as if he'd said yes. I fixed the one line that was
flatly false (the invented callback promise) so the branch at least tells a
coherent story ("he didn't take no for an answer"), but I did not write new
content to make "Not interested" a materially different playthrough. That's a
content-authoring decision on the same scale as the six-way-response question
below, not a bug-fix-sized task, and it's Devon's call whether "Earl doesn't
take no for an answer" is the intended reading or whether this option deserves
real alternate content.

**The six-way Earl response at the fair remains a design question, not a
bug**, same as the last two rounds. Five of six answers lock Ruthie out for
the whole game. Left as Devon's call.

**A fourth-relationship sweep (Danny, Tommy).** This round covered Cal, Pete,
and Earl per the prompt's own list. Danny and Tommy both default to a
"present but not yet warm" state (`unknown`/`hanger_on`) rather than a true
"never met" state the way Ruthie, Earl and Pete do, so the exact bug class
this round hunted for is less likely to apply — but it wasn't checked, and
I'd rather say so than imply it was.

**A physical touch-device test.** Upgraded from "code read only" to "verified
under Playwright's touch-emulated pointer events, DOM- and telemetry-asserted"
this round — a real step — but still not physical hardware. See "What
changed" for exactly what the new check does and doesn't prove.

## Next session

Ordered by value per effort.

1. **Decide what "Not interested" should actually do**, now that it's confirmed
   the milestone spine ignores it almost entirely. This is the highest-value
   open item by a wide margin — bigger than anything flagged in round 1 or 2 —
   and it's a content decision, not something to fix blind. Options range from
   "leave it as 'Earl doesn't take no for an answer,' maybe add one more line
   of acknowledgment at M3/M4" to "write a genuinely smaller, backer-less
   version of the middle game," and that range is exactly why it's Devon's
   call.
2. **A Danny/Tommy pass**, if it seems worth it after #1 — same
   `transcript.mjs`-plan method, lower expected yield since neither has a true
   absent state.
3. **A physical touch-device pass**, to close out what round 3's
   `verify-touch-375.mjs` couldn't: real OS-level touch-scroll suppression,
   which no in-environment emulation fully replicates.
4. **Daredevil's social-tag drift** — not this project's file, see
   "Shared-file requests." Someone auditing `sync-social-tags.mjs` should
   treat all 6 currently-drifted pages as one investigation, not six.

## Is the project stable right now?

**Yes, as a shippable state: both suites are green (53/53, 44/44), all four
transcripts — including the two new ones this round — are diffed clean against
their prior baselines with only the intended hunks changed, and the repo-wide
integrity/collision sweep reports 0 broken and 0 collisions.** Nothing in this
project is currently failing, dead-ended, or regressed.

**Not stable in the "fully resolved" sense**, though: this round's headline
finding (item 1 above) is a real, confirmed design gap, not a passing-tests
false confidence. A player who picks "Not interested" gets a technically
non-broken but narratively hollow version of the back half of the game, and
that will still be true next session unless Devon decides what should replace
it. Everything I could fix at prose-fix scale, I fixed and verified; the one
thing left that matters is a decision, not a bug.
