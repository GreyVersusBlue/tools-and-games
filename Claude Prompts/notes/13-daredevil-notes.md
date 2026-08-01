# Daredevil — session notes

## What it is

**Daredevil is a 1970s American stunt-rider story: 207 scenes, about 21,200 words
of narration and dialogue, five milestones, eight endings.** It was the largest
single file in the repo and no handoff had ever described it before round 1, so
this section — carried forward from that session, updated where the restructure
changed a number — is still the point of it.

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
Round 1 made the mentor ending reachable for the first time (`GS.rels.pete` was
read in five places and assigned in none).

**Three canvas minigames, and as of this round all three are wired to a call
site.** The Stunt Run is a side-on jump: throttle up into a green speed band
before the lip, then fight rotation in the air to meet the landing slope at
-18 degrees. It is the marquee one and it is good. The Recovery is a
hold-the-input-in-the-band drill that runs after a hard crash. **Work the
Crowd** — three crowd moods, an energy meter, a nerve gate at 45 — sat finished
and unreachable through round 1; this round placed it. See "What changed" below.

**The state of the writing: finished.** Consistent voice, no placeholder prose,
no lorem. Duke's interiority is rendered as "He thought:" which sounds like a tic
written down and reads well in play. Round 1 found the code disagreeing with the
prose in three places (STUB chapter headers, an "END OF BUILD" ending screen, two
misleadingly-named scene ids) and fixed all of it; this round found two more
places where the prose disagreed with itself — see "The Ruthie continuity holes"
below.

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
this project, still the thing every change in this round was checked against.

---

## What changed

Round 2 picked up round 1's own "Next session" list in order: the restructure
first (it was blocking, and round 1 said why), then Work the Crowd, then the
prose pass. All inside `Projects/daredevil_r4.html` (now a redirect stub) and
`Projects/daredevil/`. Nothing outside them was touched, except two shared-file
edits this project cannot make itself — see "Shared-file requests".

### The restructure, now that it was safe

Round 1 deliberately did not do this and said why in its own notes: "the game
had five bugs that made it impossible to finish, and it had no test of any
kind... the right order is: make it finishable, prove it with a suite that plays
it end to end, then move the furniture." Both halves were true this round, so
this was the job.

**`Projects/daredevil_r4.html` (6,888 lines, 355,972 bytes) is now four files**
under `Projects/daredevil/`:

| File | Lines | Bytes | What it is |
| --- | --- | --- | --- |
| `index.html` | 505 | 31,720 | head, CSS, body markup, one `<script type="module" src="./js/engine.js">` |
| `js/state.js` | 42 | 2,211 | the leaf: `GS`, `STAT_LABELS`, `N`/`D`/`C`/`NF` |
| `js/scenes.js` | 4,303 | 216,848 | the story, as data — `SCENES` |
| `js/engine.js` | 2,113 | 109,459 | screens, rendering, the four hubs, the three minigames, the epilogue, boot |
| `js/save.js` | 167 | 6,312 | unchanged — the save format, on `assets/js/gvb-save.js` |

360,238 bytes across the four files this round touched, against 355,972 before —
about 1.2% growth, all of it import/export lines, file-header comments, and this
round's fixes. Nothing was re-typed: the split was done by a script that sliced
the original file at four confirmed line boundaries (`const SCENES = {` /
`}; // end SCENES` bracket the data cleanly) and wrote each piece into its new
file with only the intended edits applied as targeted, verified-unique string
replacements. I diffed each new file against the corresponding unedited slice of
the original afterward — byte-for-byte identical outside the handful of lines
listed below. That diff, not just the test suite, is what I'm trusting for "the
split didn't quietly change anything."

**Why `state.js` is its own file and not folded into `engine.js`.** `scenes.js`'s
`SCENES` object calls `N()`/`D()`/`C()` and reads `GS.town`/`GS.name` at
module-evaluation time, not inside functions. If `engine.js` imported `SCENES`
from `scenes.js` and `state.js`'s contents lived inside `engine.js`, the import
would be circular (`engine.js` → `scenes.js` → `engine.js`), and whichever
module's turn it was to evaluate second would read the first module's bindings
out of the temporal dead zone — `GS` would not exist yet when `SCENES`'s object
literal tried to read `GS.town`. `state.js` is a leaf both `scenes.js` and
`engine.js` depend on, depending on neither, so there is no cycle. Full
reasoning is in `state.js`'s own header and `js/README.md`, which is new this
round and does for this project's content schema what
`Projects/torchbearer/content-authoring-guide.md` does for Torchbearer's packs
— the same-repo precedent the prompt pointed at.

**Font paths in `index.html`'s `<style>` block moved from `daredevil/fonts/...`
to `fonts/...`**, the one substantive change to the markup — `index.html` and
`fonts/` are now siblings instead of parent/child. The `gvb:social:start`/`end`
block was left untouched, verbatim, per locked decision #31; its `og:url` still
names the old path and will be wrong until prompt 21 regenerates it after the
board `href` changes — see "Shared-file requests".

**Two misleadingly-named scene ids were renamed while I was already touching
every line for the split**, something round 1 flagged as "free to do as part of
the restructure": `m1_earl_card_stub` → `m1_earl_card`, `m3_end_stub` →
`m3_aftermath`. Both are finished scenes; neither name described what was in
them. 7 total occurrences (2 definitions, 5 `next:` references), all inside
`scenes.js`, all plain string literals — no `goToScene()` special-casing to
update, since these were never leading-underscore procedural routes.

**`Projects/daredevil_r4.html` is now a redirect stub**, matching locked
decision #46's pattern (I copied the Schedule Browser stub's shape exactly):
`noindex`, a `meta http-equiv="refresh"` to `daredevil/`, a canonical link, and
a one-paragraph explanation. The URL cost the prompt warned about is real —
`/Projects/daredevil_r4.html` no longer serves the game — but nothing that
already linked or bookmarked it 404s.

### Work the Crowd, placed

90 finished lines — three crowd moods, an energy meter, a nerve gate at 45 —
had no `launchMinigame('crowd')` call site anywhere in the file through round 1.
I placed it rather than deleting it.

**Where: the Milestone 1 stunt aftermath, on the one outcome (`m1_stunt_perfect`)
where Duke is shown actively performing for the crowd** — its own prose already
has "He raised one hand. He wasn't sure why he did it. It seemed right." The
other candidate the prompt named, Danny's FR2 head-to-head, already has a
finished, stat-gated two-choice resolution (55 feet clean vs. 52 feet
controlled); routing that through a different minigame would have meant
rewriting an already-complete beat's structure, which is a bigger and less
invited change than wiring an existing feature to a natural gap. The four other
M1 outcomes (upright-but-shaky, chaos, two crash tiers) go straight to Earl as
they did before — none of their prose reads as a crowd-working beat, and a hard
crash in particular is the wrong tone for a bonus performance minigame right
after it.

**It is upside-only and does not change the story graph.** `m1_stunt_perfect`
now routes to the new procedural id `_minigame_crowd_m1` instead of straight to
`m1_earl_approach_perfect`; `handleCrowdM1Result()` adds +1 Showmanship on a
`SUCCESS` verdict and otherwise changes nothing, then sends the player to
exactly the scene `m1_stunt_perfect` used to route to directly. A player who
loses the round loses nothing but the bonus stat point — Earl still approaches
the same way. This was a deliberate choice to keep the change "cheap," per round
1's own framing of this task: wiring a finished feature to a natural gap, not a
new story decision layered on top of someone else's finished beat.

**The test-support gap this created, and how it was closed.** Work the Crowd is
a "choices"-type minigame (three buttons: Pump It Up / Build It Slow / The
Unexpected), not a "pedals" one like the Stunt Run. `drive-daredevil.mjs`'s
`autopilot()` only knew how to read `mg.tele.phase` and press gas/lean —
against a minigame with no `tele` at all, it does nothing every frame, and the
Crowd game's own per-round timeout resolves each unanswered round as a miss.
Under `good` policy, that runs the meter down to a FAIL almost every time — and
`smoke-page.mjs` asserts `clean.stunts.every(s => verdict is SUCCESS or PARTIAL)`
across every entry that reaches the result-ticket screen, minigame or not. Left
alone, placing Work the Crowd would have silently broken a passing assertion the
moment it became reachable — exactly the "looks fine, isn't" failure mode this
whole project is about. Fixed the same way round 1 fixed the equivalent gap for
the Stunt Run (exposing `tele.w` for `autopilot()` to steer with): the crowd
game object now exposes a `get correctCall()` getter naming the right card for
the current mood, and `autopilot()` gained a branch that clicks it under `good`
policy and does nothing under `crash` policy (letting the round time out on
purpose, consistent with what "crash" means everywhere else in the driver).
Verified by running `smoke-page.mjs` with and without the `autopilot()` branch —
see "What I verified".

### The Ruthie continuity holes

Two, both confirmed by reading real transcripts rather than just reading code,
both fixed the same way: swap a plain template literal for `N(()=> cond ? a : b)`,
the pattern already used elsewhere in this same file (`fr4_eve_ruthie`, `m4_prestunt`
scenes) for exactly this reason.

1. **`m5_retire_clean`** said "He told Ruthie last. She already knew. He thought:
   she probably knew before Earl. He thought: the hands." on every run that
   reaches that ending, whether or not Ruthie was ever established — true on
   five of the six ways to answer Earl at the fair. The epilogue's own
   relationship roster correctly omits her when absent, so the game contradicted
   itself on its own last screen. This is the hole round 1's notes named
   explicitly as the clearest example and the one to fix first.
2. **`fr4_night_ride`**, reachable from the FR4 hub regardless of any
   relationship state, said "He thought about Pete finding it in Lubbock. He
   thought about what Ruthie had said about the hands. He thought about Roy
   filming the three seconds after." The "hands" line only exists at all on
   the `GS.rels.ruthie === 'solid'` branch of `fr4_eve_ruthie` — on any other
   run, Ruthie never said anything about hands, so this scene had Duke
   remembering a conversation that never happened. Found by grepping the
   restructure's own `rough.md` baseline transcript (a confirmed no-Ruthie run)
   for "Ruthie" and reading every hit in context, per the prompt's own
   suggested method — not by re-deriving it from the code.

Both now branch on `GS.rels.ruthie`. Neither branch changes any flag, stat, or
routing — this is a prose fix, not a mechanics one. I did not go looking for a
third; the prompt named the first as "the clearest" and warned there would be
more, and a `grep -i ruthie` of both transcripts plus a read of every hit in
context is what a targeted pass looks like, not an exhaustive rewrite of a
9,300-word run's worth of prose against every relationship's absent state.

### A fourth fix, found while tracing `GS.town` for the restructure

**`patchDynamicScenes()` patched 3 of the 5 places a plain template literal
bakes in `GS.town` at module-load time — never `cold_open_01`'s own opening
line, and never `cold_open_02`'s `bgText`.** A player who sets a custom hometown
on the setup screen would see it everywhere in the game except the very first
line they read, which still said "Buford County." Found by grepping every
`GS.town` usage in the file and checking each one against the patch list while
building `state.js`'s and `scenes.js`'s headers. Both are now patched alongside
the three `patchDynamicScenes()` already handled.

---

## What I verified

Commands from the repo root, real output.

### Extraction fidelity

Diffed each new file against the unedited slice of the original it came from
(a one-off comparison script, not kept):

```
scenes.js: 3 hunks — m1_stunt_perfect's `next`, and the two Ruthie N(fn) swaps
engine.js: 4 hunks — patchDynamicScenes, the _minigame_crowd_m1 route,
           handleCrowdM1Result, and the correctCall getter
```

Every other line, byte-for-byte identical. This is what "the split didn't
quietly change anything" is actually resting on, not just the suite below.

### Syntax and the fast suite

```
node --check Projects/daredevil/js/state.js    (and scenes.js, engine.js)  — all OK
node Projects/daredevil/test/smoke-save.mjs
  53 passed, 0 failed
```

### The regression suite, against the restructured page

```
node Projects/daredevil/test/smoke-page.mjs
  44 passed, 0 failed
```

Same 44 checks as round 1, all green against `Projects/daredevil/index.html` instead of
the old monolith. Two numbers worth calling out:

- **"it played at least two stunt runs (SUCCESS/94, SUCCESS/100, SUCCESS/95, SUCCESS/95)"**
  — four results now, not three: the new Work the Crowd stop scored **SUCCESS/100**,
  a clean sweep of all three rounds under `autopilot()`'s new `correctCall` branch.
- **"the autopilot landed every stunt it was asked to land"** — this is the exact
  assertion Work the Crowd would have broken if placed without teaching the driver
  to answer it (see "What changed"). It still passes.

### Transcripts, before and after, diffed line for line

Fresh baselines were taken before touching anything:

```
node Projects/daredevil/test/transcript.mjs clean   → 89 scenes (unchanged path)
node Projects/daredevil/test/transcript.mjs rough   → 78 scenes (unchanged path)
```

Then again after the restructure, Work the Crowd, and both prose fixes, diffed
line for line:

```diff
 Scene path (89): ... m3_triumph_clean →
-m3_end_stub → fr3_hub_open ...
+m3_aftermath → fr3_hub_open ...
```

```diff
+> _[minigame: Work the Crowd]_
+
+> **STUNT RESULT — SUCCESS / 100** — Worked the crowd to 100% energy over 3 calls.
```

```diff
-### `m3_end_stub`
+### `m3_aftermath`
```

```diff
-He thought about Pete finding it in Lubbock. He thought about what Ruthie had said about the hands. He thought about Roy filming the three seconds after.
+He thought about Pete finding it in Lubbock. He thought about Roy filming the three seconds after.
```

```diff
-He told Ruthie last. She already knew. He thought: she probably knew before Earl. He thought: the hands.
+There was no Ruthie to tell. He thought about the fork at the county fair more than once over the years. Mostly he didn't regret it. Mostly.
```

Five hunks in the clean run's transcript, every one of them an intended change
(the rename, the new minigame stop, and both Ruthie fixes — Ruthie was never
established in either baseline run, so both fixes fire in the clean transcript
too). Nothing else moved: same 89 scenes, same order, same choices offered.

The rough run (crash at the fair, never reaches `m1_stunt_perfect`; custom name
Mack Teller of Cold Spring) diffed to four hunks, all intended:

```diff
-There's a place in Buford County where the county road dips before the bridge...
+There's a place in Cold Spring where the county road dips before the bridge...
```

```diff
-### `m1_earl_card_stub`
+### `m1_earl_card`
```

```diff
-### `m3_end_stub`
+### `m3_aftermath`
```

```diff
-He thought about Pete finding it in Lubbock. He thought about what Ruthie had said about the hands. He thought about Roy filming the three seconds after.
+He thought about Pete finding it in Lubbock. He thought about Roy filming the three seconds after.
```

The first hunk is the `cold_open_01`/`patchDynamicScenes()` fix, caught live: this
run sets a custom town ("Cold Spring") and the old code would have left the
game's very first line saying "Buford County" regardless. It doesn't in the
restructured version. The other three are the two id renames and the
`fr4_night_ride` Ruthie fix (this run also never establishes Ruthie). No Work
the Crowd stop, since that outcome is never reached by a crashed Milestone 1, as
designed. Same 78 scenes, same order, same choices offered, same ending
(`m5_walk_quiet`).

### Guard-rail verified by breaking it on purpose (locked decision #34)

Not the whole `smoke-page.mjs` suite — a targeted script that boots the page,
plays to the Milestone 1 stunt and the new Work the Crowd stop under `good`
policy, and reads the result ticket. First with `autopilot()`'s `correctCall`
branch commented out (`if (false && ...)`):

```
MINIGAME: The Stunt Run
RESULT: SUCCESS 94 Cleared the cows and landed dead level
MINIGAME: Work the Crowd
RESULT: FAIL 31 Worked the crowd to 31% energy over 3 calls.
```

Confirmed: without the fix, Work the Crowd self-resolves to FAIL under `good`
policy exactly as predicted — the failure mode that would have broken
`smoke-page.mjs`'s "every stunt the autopilot was asked to land, it landed"
assertion. Restored the branch and ran the same script again:

```
MINIGAME: The Stunt Run
RESULT: SUCCESS 94 Cleared the cows and landed dead level
MINIGAME: Work the Crowd
RESULT: SUCCESS 100 Worked the crowd to 100% energy over 3 calls.
```

The guard catches the bug it exists for, and the full suite (`smoke-page.mjs`,
44/44, see above) confirms it stays fixed in the real page, not just this
isolated script.

### Repo checks

```
cd Tools/board-check && npm run check
  integrity sweep
    FAIL newindex.html
         references offsite host(s): fonts.googleapis.com, fonts.gstatic.com
  346 units checked, 1 broken
```

**That failure is not this project's.** `newindex.html` is a tracked, committed
file at the repo root, last touched by a commit outside any of the 21 prompts'
owned paths — nothing under `Projects/daredevil` or `Projects/daredevil_r4.html`
appears anywhere in the integrity sweep's output. I did not create or touch that
file and it is outside my boundary either way. Ran the collision check
independently since the `&&` chain stopped before reaching it:

```
node check-collisions.mjs
  0 collisions, tightest vertical gap 9.2px
```

346 units against round 1's 331 (other threads' files landing this round, same
as round 1 noted about its own baseline) — 0 collisions is what to hold to, and
it holds.

```
npm run social:check
  only parsed 17 notices out of index.html — the notice markup has changed
  shape, fix the regexes rather than shipping a partial sweep
```

**Also not this project's**, and worth flagging loudly rather than burying: I
never touched `index.html` or `sync-social-tags.mjs`, both off-limits to this
prompt, and this failure means the board's own notice markup has drifted from
what the sync script parses — a site-wide problem, not specific to Daredevil's
notice. Flagging in Shared-file requests below since prompt 21 owns both sides
of that check.

---

## Shared-file requests

Applicable without reading this session. Two are required; this project's own
files (`daredevil_r4.html`'s new redirect stub, everything under
`Projects/daredevil/`) are already done and need nothing further.

**1. The board `href`, required.** `index.html` line 384 currently reads:

```html
<a class="notice" data-tags="Narrative" data-preview="assets/previews/daredevil.jpg" href="Projects/daredevil_r4.html">
```

Change `href="Projects/daredevil_r4.html"` to `href="Projects/daredevil/"`. The
redirect stub means this is not urgent — the old link still lands on the game,
one hop later — but the board should point straight there.

**2. `Tools/board-check/games.mjs`'s Daredevil recipe, required for `npm run
games` and the preview/OG capture pipeline to keep exercising the real page
instead of the redirect stub.** Line 173 currently reads:

```js
url: '/Projects/daredevil_r4.html',
```

Change to `url: '/Projects/daredevil/index.html'`. Nothing else in that recipe
(the `open()` steps, the save key, `live: false`) needs to change — the DOM ids
and classes it clicks are unchanged by the restructure. `capture-previews.mjs`'s
Daredevil recipe and `promote-previews.mjs`/`candidates/chosen.json` all key off
the slug `'daredevil'`, not the URL, so those need nothing.

**3. Regenerate the social tags after #1 lands.** `index.html`'s own
`og:url` for Daredevil, and the copy baked into
`Projects/daredevil/index.html`'s `gvb:social` block (currently still
`https://greyversusblue.com/Projects/daredevil_r4.html`, untouched by this
session per locked decision #31), will both still name the old path until
`npm run social` re-runs against the updated board `href`. One run after #1
lands should fix both.

**4. `npm run social:check` is currently broken, repo-wide, unrelated to this
project — flagging since I ran it as part of this project's own verification
and it's worth surfacing rather than burying in a passing checklist:**

```
only parsed 17 notices out of index.html — the notice markup has changed
shape, fix the regexes rather than shipping a partial sweep
```

I did not touch `index.html` or `sync-social-tags.mjs` (both off-limits to this
prompt) and can't diagnose which of the board's 22 notices changed shape or
why. This blocks request #3 above until fixed — regenerating social tags isn't
possible while the sweep only parses 17 of 22 notices.

**5. `npm run check`'s integrity sweep is also currently failing, also
unrelated to this project:** `newindex.html` (a tracked file at the repo root,
outside any of the 21 prompts' owned paths) references `fonts.googleapis.com`
and `fonts.gstatic.com`. Not introduced by this session — nothing under
`Projects/daredevil` appears in that sweep's output — but worth a look since it
means `npm run check` currently exits non-zero for reasons that have nothing to
do with any project thread's own work. The collision check underneath it is
unaffected: `node check-collisions.mjs` run directly still reports 0
collisions, tightest gap 9.2px.

**6. Nothing else.** No `gvb-save.js` change (the storage key is unchanged, no
new hooks were needed), no OG image change (`daredevil.jpg` still applies to
the same game at a new path).

---

## Deliberately not done

**Splitting the story further, into fetched chunks rather than one `scenes.js`
module.** Round 1 flagged this as downstream of the restructure and noted that
344 KB of HTML gzips to much less with no images at all, making it a smaller win
than the raw number suggests (locked decision #42: measure the gzipped transfer
before deciding). Nothing this round changes that math — `scenes.js` is 208 KB
of the total either way, loaded eagerly by `engine.js`'s import. Worth
re-measuring gzipped size before anyone does this.

**The six-way Earl response at the fair.** Five of six answers lock Ruthie out
for the whole game, and the option that keeps her, "I need to talk to someone
first," reads as the least decisive one. Round 1 called this a design problem,
not a bug, and left it rather than quietly rebalancing someone else's story. I
made the Ruthie-absent case read correctly wherever I found it broken this
round, which is a different thing from making her harder to lose in the first
place — that's still not my call.

**Minigame touch controls at 375px.** Looked at `bindHold()` in `engine.js`
while moving it: it already uses pointer events (`pointerdown`/`pointerup`/
`pointercancel`/`pointerleave`), not mouse-only handlers, and the CSS already
sets `touch-action:none` on the canvas, pedals and D-pad. This may already work
better than round 1's note suggested — but I did not test on an actual touch
device or verify hit-target sizing at 375px, so I'm leaving the item rather than
asserting it's fixed on code-reading alone.

**Contrast measurement.** Still not measured. `--cream-faint` (#7a684c) on the
dark panels is still the one to check first.

**A third or later Ruthie-absent prose hole, if one exists.** I checked both
existing transcripts for every "Ruthie" mention and fixed the two that read
wrong out of context; I did not write new transcript plans specifically
targeting every other absent-relationship combination (no-Cal, no-Pete,
no-Earl) to hunt for the same class of bug elsewhere. `transcript.mjs` with a
plan that skips a different relationship is how to find those, same method as
this round.

---

## Next session

Ordered by value per effort.

1. **Apply the two required shared-file edits** (board `href`,
   `games.mjs`'s recipe `url`) and re-run `npm run social` — items 1–3 above.
   Prompt 21's, not a project thread's.
2. **Re-measure gzipped transfer size** before deciding whether splitting
   `scenes.js` further into fetched chunks is worth it (locked decision #42).
   `scenes.js` alone is 208 KB uncompressed; find out what it actually costs a
   player.
3. **A broader absent-relationship prose sweep**, using `transcript.mjs` with
   plans that specifically avoid Cal, Pete, and Earl in turn (not just Ruthie),
   the same method that found this round's two fixes.
4. **Minigame touch controls at 375px** — verify on an actual touch device or
   with real touch-emulation clicks, not just a read of the event-binding code.
5. **Contrast measurement.** `--cream-faint` on the dark panels first.
