# gvb-site-handoff-v9.md

Handoff from **session 9** (site version 10) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v8.md` first if you have not. Everything in it still
holds unless contradicted below.

Same twenty-one-way parallel split `Claude Prompts/README.md` describes. All
twenty project threads had posted round-2 notes by the time this thread's
second pass ran (its first pass, partial, only saw nine of them and correctly
stopped rather than write a handoff from an incomplete set — see this
thread's own notes file for that partial-pass record). This is the full pass:
every shared-file request from all twenty, plus the version bump and this
file.

---

## Three things that matter more than anything below

**Devon has now decided all three of v8's open questions.** None of them
needed code from this thread; all three are settled, not open anymore:

1. **Final Grade Checker's quality-point rounding, asked directly this
   round.** Quality points do **not** round up at .5; the percentage average
   **does**. Round 1 made both methods round the same way, which was still
   wrong, just in a smaller and more specific way — an averaged QP figure
   sitting exactly on 3.5/2.5/1.5/0.5 now has to clear the line, not just meet
   it. Fixed in `grade-math.mjs` (`>=` to `>` in `qpToFinalLetter`). **New
   question this creates, still open:** between round 1's session and this
   one, any student whose QP average landed exactly on a boundary and whose
   QP method was the reported one got a letter one grade too high. Shorter
   window than the original percentage bug, but the same kind of call —
   check old report cards from that window, or don't. Not a code decision.
2. **The committed schedule data (`Tools/schedule-browser.html`,
   `Tools/schedule-visualizer.html`) — leave it as is.** No student names, so
   no FERPA issue; the school-security question (34 real staff surnames,
   rooms, and — combined with the floor plan — every teacher's
   planning-period block, at a public URL) was decided this round: change
   nothing.
3. **The Pathfinder Campaigns/Characters merge recommendation, raised
   independently three times across two rounds — decided as "harmonize, don't
   share."** Devon extended prompt 03's scope this round to actually do the
   comparison with both files open at once (the thing every prior session
   correctly refused to do solo). Outcome: `[shared]` comment markers added at
   every point the two pages' CSS/JS are byte-identical, as a drift guardrail
   — no new shared file, no `Pathfinder/shared.css`, locked decision #17
   stays in force. This recurring backlog item is closed; don't re-raise it
   as an open question next round.

**`Pathfinder/data/` is still open — the fourth and fifth time it's been
raised.** Torchbearer and The Absalom Inheritance both flagged it again this
round, same as round 1. Still Devon's call, still not code. If a sixth thread
raises it, that's worth asking about directly rather than carrying it forward
a third round.

---

## 0. What changed in one paragraph

**A live problem, not caused by any of the twenty projects, is fixed:** Devon
committed `newindex.html` (a "Town Services" landing page for the six Tools
pages) and a matching `index.html` notice change directly, mid-round, which
broke `npm run check` (offsite font hotlinks) and `npm run social:check`
(the notice-count floor) for every one of the twenty threads that ran after
it landed — nineteen of them hit this and correctly flagged it as "not mine"
(§1, §2). **A second, more consequential bug, also not caused by any project
thread, is fixed:** three independent sessions (Closing Time, The Fourth
Quarter, Golden Hour) found the same `puppeteer-core` incompatibility
breaking `npm run games`/`npm run previews` completely, for every game, on
this environment (§3) — fixing it exposed a further, structural finding about
this environment's three.js rendering that is worth reading before trusting
any real-time movement assertion here (§4). **Torchbearer has a preview, an
OG card, and a `npm run games` entry for the first time** (§5), now that a
real committed save exists. **Daredevil's board `href` and preview pipeline
now point at its restructured folder** (§6). **`package-lock.json` is
tracked now** (§7). Castle Conundrum's requested preview recapture could not
be completed this session — see §4 for why, and §8 for what's still needed.

---

## 1. `newindex.html`'s fonts are vendored

Not a project's fault — this file was committed directly by Devon
(`git log`: "Update newindex.html" x2, "new link for tools") as a Town
Services landing page for the six Tools pages, linked from a new notice card
in `index.html`'s Town Services section. It hotlinked Google Fonts (Space
Grotesk, Public Sans, IBM Plex Mono) and had its own hand-written favicon and
`<meta name="description">`.

Treated it the way locked decision #43 already treats `index.html`/`404.html`
— it's the site itself, not a project, and it's board-adjacent — and
extended that decision (new #51, below) rather than inventing a new rule.
Five files, read from the CSS actually used (Space Grotesk 600 only; Public
Sans 400 and 700; IBM Plex Mono 400 and 500 — the hotlink asked for the full
400–700 range of two families plus italics neither one renders), joined the
existing five in `assets/fonts/`. `@fontsource/space-grotesk` isn't one of
the twelve families already vendored in `Tools/board-check/node_modules`, so
its one file came straight from the registry (`npm pack
@fontsource/space-grotesk@5.3.0`, same version as everything else here).

Its hand-written favicon and description were removed so `sync-social-tags.mjs`
could manage it like any other page a board notice links to (see §2) — it
now carries the same shared favicon and a description generated from its own
notice's copy, like every other linked page.

**Verified per locked decision #34**: re-added a `fonts.googleapis.com` link
to `newindex.html`, watched `check-integrity.mjs` fail naming it, removed it,
watched it pass.

## 2. `sync-social-tags.mjs`'s notice count: 22 → 17, and that's correct

The same Devon commit that added `newindex.html` also replaced Town
Services' six standalone notices (Name Picker, Seating Chart Generator,
Schedule Browser, Schedule Visualizer, Final Grade Checker, Image → PDF) with
one "School Tools" card pointing at it. `sync-social-tags.mjs`'s own regex
parses all seventeen remaining notices cleanly — this was never a markup-shape
break the way the error message suggested. The actual bug: a hardcoded safety
floor (`notices.length < 20`) written when 22 was the real count and never
revisited, refusing a **correct** 17 as if it were a parse failure. Fixed by
lowering the floor to 15 — the same two-notice buffer the original 20 was
relative to 22 — with a comment explaining why the number moved and that it's
a sanity check, not a count this script should ever need pinned exactly.

`newindex.html` also needed its hand-written icon/`og:*` tags removed (see
§1) before `npm run social` would insert a generated block — the script
correctly refuses to insert a second copy over hand-written tags rather than
guessing.

**`npm run social:check` → 17 notices · 17 already current · 0 failed.**
Every notice count from every one of the twenty projects' own verification
this round (all citing 22, all confirmed clean at the time they ran) is now
stale by six — not a regression in anything they did, just Devon's own
mid-round board change landing after they ran their checks. Read 17 as the
new baseline.

## 3. The `waitForFunction` bug: found by three threads independently, fixed once

`page.waitForFunction(fn, arg, options)` is Playwright's signature.
`harness.mjs`'s Linux branch (this environment, always — not a fallback, the
primary path) drives Chromium through `puppeteer-core`, whose
`waitForFunction` is `(fn, options, ...args)` instead. Every call site in this
repo that wrote `page.waitForFunction(fn, null, { timeout })` — copying a
shape that only works under Playwright — put `null` where puppeteer-core
expects `options`, and it threw `Cannot read properties of null (reading
'polling')` on **every single game, every single run**, on this environment,
for the round's whole duration until this session. Closing Time, The Fourth
Quarter and Golden Hour each independently found this, each while trying to
verify their own round-2 work, and each correctly filed it as a shared-file
request rather than trying to patch `Tools/board-check` themselves.

**Fix:** a new `waitFor(page, fn, opts)` in `drive.mjs`, branching on
`page.__engine` (already set by `harness.mjs`'s `prepPage`), used in place of
every bare `page.waitForFunction(fn, null, opts)` in `drive.mjs`,
`play-games.mjs`, `capture-previews.mjs` and `games.mjs`. **Not applied to
`play-castle.mjs`** — that file belongs to prompt 05 (Castle Conundrum is its
only consumer), so its one instance (line ~432) is flagged here rather than
edited; the identical one-line fix is ready for whoever runs that prompt next.

**Two more engine differences surfaced once the crash stopped masking them,
both fixed the same way:**

- `page.waitForTimeout(ms)` — recent `puppeteer-core` dropped it entirely.
  `drive.mjs`'s internal calls (`turnBy`, `walkTo`) now use the module's own
  plain-`setTimeout` `wait(ms)`, which needs no engine branch at all.
- `page.textContent(selector)` — a Playwright convenience method
  `puppeteer-core` never had. New `textContent(page, sel)` in `drive.mjs`,
  branching to `page.$eval(sel, el => el.textContent)` under puppeteer.

All three (`waitFor`, `wait`, `textContent`), plus `setFiles` (moved here from
`play-games.mjs`, which had its own private copy — `games.mjs`'s Torchbearer
recipe needed it too, see §5), are documented in `README.md`'s `drive.mjs`
section now, with the exact crash message, so the next session that adds a
call site copies the right shape instead of Playwright's.

**Same bug class exists in at least one project-owned file, not fixed
here:** `Projects/integer-foundry/test/browser.mjs:199` has the identical
`waitForFunction(fn, null, opts)` shape. That file is prompt 14's own test
suite, not `Tools/board-check/**`, so it's flagged in the backlog table
rather than touched.

## 4. What the fixed harness found next: this environment's three.js rendering is very slow, inconsistently so

Fixing §3 let every suite run past its first `waitForFunction` call for the
first time all round — and exposed a second, more fundamental limitation
underneath it. `harness.mjs`'s Linux launch args force software rendering
(`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), and on
**this session's specific sandbox**, that makes real-time three.js movement
run far slower and far less consistently than the games' own physics assume:

- **Castle Conundrum**, measured directly: ten 400ms `KeyW` bursts (nominally
  ~2m each at the documented 5.2 m/s walk speed, ~20m total) covered **0.78m**,
  and several individual bursts covered **exactly zero** distance. `npm run
  previews castle-conundrum` could not reach the requested 6.4m standoff
  distance and aborted — see §8.
- **Golden Hour's** existing real-time assertions (walk distance, sun
  descent, fog colour, arrow-key turn) fail inconsistently run to run in this
  same sandbox — sometimes 2 of 4, sometimes all 4 — for the identical
  reason. This round's two new beats (wading depth, footprints — see §5) ran
  without crashing but couldn't be meaningfully verified here either: the
  walker never got far enough into the water in the 26 seconds budgeted.
- **The Fourth Quarter's** existing "the doors opened and the room filled"
  check (present before this session) and this round's new walk-to-the-Real-
  Estate-station beat (§5) both failed the same way — a station 6-8m from
  spawn, or a crowd simulation that needs real elapsed time, doesn't converge
  reliably here.
- **Integer Foundry's** own suite (`play-games.mjs`, unrelated to anything
  this session touched) hit a `Node is detached from document` abort on one
  full-suite run and passed clean on an immediate retry of the same suite in
  isolation — consistent with the same class of timing sensitivity, not a
  regression.
- **Daredevil's own** `smoke-page.mjs` (headless, no compositing needed at
  all) hit `minigame never finished in 60000ms` on its physics-timed Stunt Run
  minigame — the same RAF-timing sensitivity shows up even without a visible
  window, so this isn't only about pointer-lock/compositing.

**None of this is a regression from anything in this session** — `git diff`
confirms none of the affected files' own game logic was touched, and the
scheduling note in this prompt's own house rules already warned "if a
frame-motion assertion fails once and passes on retry, that is what
happened, not a regression." What's new is that the harness crash from §3
was hiding this all round; every project that measured movement by hand
instead of trusting `npm run games` (Closing Time, Fourth Quarter, Golden
Hour — all three built their own scratch verification scripts specifically
because the shared suite was broken) unknowingly worked around this too.

**Recommendation for whoever runs this next**: on a machine where
`harness.mjs`'s non-Linux branch applies (real Chrome/Edge via Playwright,
per "Windows is the dev machine" in earlier locked decisions), these same
assertions should be reliable — this is specific to software-rendered
Chromium, not the assertions themselves. Treat a real-time movement failure
on this Linux sandbox as inconclusive, not a confirmed regression, and
re-verify from a machine with real GPU compositing before trusting either
verdict. New locked decision #53 below.

## 5. Torchbearer: preview, OG card, and a `npm run games` entry, finally

`Projects/torchbearer/test/sera-voss.torchsave.json` (a real, hand-played
save — Dwarf Fighter, Farmhand background, Thornwake Vigil, mid-combat at the
Vanguard's Watch) was committed this round by Torchbearer's own session,
closing the one gap that blocked this since round 1. Recipe added to
`games.mjs`: Shelf-load Thornwake, dismiss the "Content Loaded" modal
`applyPack()` opens (a full-screen `#modal-veil` overlay left open sits on
top of `#save-bar` — a click meant for the import button lands on the veil
instead and no file chooser ever opens; this cost the most debugging time of
anything in this session), import the committed save, confirm it lands on
`bridge-fog`. `play-games.mjs`'s new suite (7 checks, 0 failed, no
timing-sensitive assertions — this is a 2D DOM game, not three.js, so §4
doesn't apply) drives the rest: engaging the pickets opens the Vanguard's
Watch grid (91 cells, 5 tokens), a build naming unloaded content is refused
with the "Content Missing" modal rather than crashing, and the live journey
survives the rejected import. `capture-previews.mjs` got the matching
recipe; captured, reviewed, and promoted (9.2 KB preview, 64.4 KB OG card,
both comfortably under budget). `promote-previews.mjs`'s `KNOWN` allowlist
gained `torchbearer`. `index.html`'s Torchbearer card gained
`data-preview="assets/previews/torchbearer.jpg"`.

**Golden Hour's two requested beats** (wading settles at a knee-depth limit
rather than dropping further; footprints appear as a small-geometry
`InstancedMesh`) are added to `play-games.mjs`, adapted in one place: the
request's own sketch read `pos[1]` for eye height, but `camState`'s `pos` is
`[x, z]` only — eye height is the separate `y` field. Fixed to read `.y`. See
§4 for why these couldn't be fully verified in this session's environment.

**The Fourth Quarter's requested Real Estate suite** is added as a
self-contained block at the end of the existing suite (not threaded into the
middle of the existing door-panel/save-bar sequence, which tests a different,
adjacent flow at the cornerTap tier and would have been put at risk by
interleaving a venue change into it): walk to the Real Estate station
(6.7, -0.8), sign the lease, confirm the venue and dark-night state, confirm
the door ring shows "Tonight" during the move with no Open the Doors button,
push through, confirm the day advanced and cash dropped, confirm the door
ring returns to normal. Written and wired; blocked from actually completing
by §4's walk-speed finding in this session ("never got in range" on the walk
beat, so everything gated behind it correctly skipped rather than cascading
into further failures). Ready to verify for real from a machine without this
environment's rendering limitation.

## 6. Daredevil: board `href` and `games.mjs` recipe repointed

Both required shared-file requests from Daredevil's restructure (round 2):
`index.html`'s card now points at `Projects/daredevil/` (was
`Projects/daredevil_r4.html`, which is a redirect stub per locked decision
#46's pattern, so nothing already linked or bookmarked breaks); `games.mjs`'s
recipe URL now reads `/Projects/daredevil/index.html`. `npm run social`
re-run afterward to regenerate the page's own `og:url`. `npm run previews
daredevil` reached gameplay clean against the new path with no recipe
changes needed (the DOM ids the recipe clicks are unchanged by the
restructure). Daredevil's own `smoke-page.mjs` still passes 36 of 37 — the
one failure is §4's class of issue, not anything to do with the path change
(confirmed: nothing in this session touched any file under
`Projects/daredevil/`).

## 7. `package-lock.json` is tracked now

Closing Time's finding: `Tools/board-check/.gitignore` excluded it, so every
session's `npm install` floated on whatever the registry served that day,
with no diff to point at when a dependency's behavior changed underneath
everyone — exactly how §3's bug went unnoticed for a whole round. `node_modules/`
stays ignored (locked decision #12, dev-only tooling); the lockfile itself is
now committed, 40 KB.

---

## 8. Backlog state

| Item | State |
| --- | --- |
| `newindex.html` fonts vendored | **Done.** See §1 |
| `sync-social-tags.mjs`'s notice-count floor | **Done.** See §2 |
| `waitForFunction` bug (`drive.mjs`, `play-games.mjs`, `capture-previews.mjs`, `games.mjs`) | **Done.** See §3 |
| `waitForFunction` bug in `play-castle.mjs` | **Not done — prompt 05's file.** One-line fix identical to §3, ready to apply |
| `waitForFunction` bug in `Projects/integer-foundry/test/browser.mjs` | **Not done — prompt 14's file.** Same one-line fix |
| Torchbearer preview, OG card, `npm run games` entry | **Done.** See §5 |
| Golden Hour's wading/footprint beats | **Added, unverifiable in this environment.** See §4, §5 |
| Fourth Quarter's Real Estate suite | **Added, unverifiable in this environment.** See §4, §5 |
| Daredevil `href`/`games.mjs` recipe | **Done.** See §6 |
| `package-lock.json` tracked | **Done.** See §7 |
| Castle Conundrum preview recapture | **Not done — blocked by §4.** Recipe and vantage point unchanged; needs a session with working real-time three.js rendering |
| Final Grade Checker's QP rounding bug | **Decided and fixed.** See the top of this file |
| Committed schedule data question | **Decided: leave it.** See the top of this file |
| Pathfinder Campaigns/Characters merge | **Decided: harmonize, don't share.** See the top of this file |
| `Pathfinder/data/` as a shared interface | **Still open**, raised a fourth/fifth time. Devon's call |
| Corner & Kettle's and Seating Chart's one expected test failure each | **Unchanged from v8 — still not this thread's file.** Both projects' own round-2 sessions confirmed the fix landed but did not report inverting the assertion; check next round |
| Everything else in each of the twenty projects' own "Next session" sections | **Unchanged by this thread** — see each project's own notes file |

## 9. Things I found and deliberately did not fix

**This environment's three.js rendering speed.** See §4. Not this thread's
to fix — it's a property of the sandbox this session happened to run in, not
a bug in any project's code or in `Tools/board-check`. Flagging prominently
rather than either hiding the failures or mis-filing them as regressions.

**Castle Conundrum's stale preview.** See §4, §8. Prompt 05's own repeated
request; the recapture recipe is unchanged and correct, it just couldn't
complete here.

**The two same-class `waitForFunction` bugs outside this thread's
boundary** (`play-castle.mjs`, `Projects/integer-foundry/test/browser.mjs`).
See §3, §8.

**Corner & Kettle's and Seating Chart's one expected-failing test each**
(carried over from v8, still not independently confirmed inverted this
round — neither project's round-2 notes mention it, and it wasn't this
round's assigned task for either). Still a one-line edit in a file this
thread doesn't own.

## 10. Locked decisions

Everything through #50 (v1 §3, v2 §8, v3 §6, v4 §5, v5 §6, v6 §9, v7's
numbered list 36–42, v8's 43–50) still stands. Added:

51. **`assets/fonts/` extends to any file that is the site itself, not just
    `index.html`/`404.html`.** `newindex.html`, linked directly from a board
    notice and committed by Devon rather than any of the twenty-one prompts,
    is board-adjacent the same way — its fonts joined the shared folder
    rather than starting a third precedent. See §1, `assets/fonts/README.md`.
52. **`Tools/board-check/package-lock.json` is tracked; `node_modules/` stays
    ignored.** An unpinned lockfile is exactly how #3's bug went unnoticed
    for a whole round — see §3, §7.
53. **A real-time movement or physics assertion failing under this
    environment's Linux/software-rendered Chromium is inconclusive, not
    confirmed.** `harness.mjs`'s Linux launch args force software rendering,
    which measurably (§4) runs three.js scenes far slower and less
    consistently than their own physics assume, on at least this session's
    sandbox. Re-verify from a machine where the non-Linux branch applies
    (real Chrome/Edge via Playwright) before treating a failure here as real,
    and before treating a pass here as proof it works everywhere.

## 11. Suggested next session

Roughly in order of value per effort:

1. **Re-verify §4/§5's new beats (Golden Hour's wading/footprints, Fourth
   Quarter's Real Estate suite) from a machine with working real-time
   three.js rendering.** The code is written and gated correctly (skips
   cleanly rather than cascading when the environment can't support it); it
   just needs a fair environment to actually prove itself.
2. **Apply the one-line `waitForFunction` fix to `play-castle.mjs` and
   `Projects/integer-foundry/test/browser.mjs`** (§3, §8) — from those
   prompts' own sessions, not this thread.
3. **Castle Conundrum's preview recapture** (§4, §8), once the environment
   question above is settled.
4. **Invert Corner & Kettle's and Seating Chart's one expected-failing test
   each** (§9) — unchanged ask from v8, still outstanding.
5. **`Pathfinder/data/` as a shared interface or not** (top of this file) —
   raised a fourth and fifth time now. Cheaper to decide than to keep
   carrying forward.
6. Everything else in each of the twenty projects' own notes files under
   their own "Next session" — unchanged by this thread, carried forward
   there rather than duplicated here.

---

## Verified this session

- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed** (module
  untouched this round)
- `cd Tools/board-check && npm run check` → **336 units checked, 0 broken;
  0 collisions across nine widths, tightest gap 3.5px**
- `npm run social:check` → **17 notices, 17 already current** (was 22 —
  see §2, this is a real drop, not a regression)
- `npm run tools` → **18 checks, 0 failed**
- `npm run games` → moving target in this environment, both in count and in
  which timing-sensitive checks fail on a given run (§4). A representative
  full run: **119 checks, 8 FAILED** — Torchbearer's new suite clean at 7/7;
  every failure elsewhere is one of §4's timing-sensitive assertions
  (Golden Hour, The Fourth Quarter) or a one-off flake (Integer Foundry,
  passed clean on immediate retry in isolation)
- `npm run previews torchbearer` → reached gameplay, 0 failed, promoted
- `npm run previews daredevil` → reached gameplay against the new URL, 0
  failed
- `npm run previews castle-conundrum` → **could not reach gameplay** — see
  §4, §8
- `npm run promote` → torchbearer's preview/OG pair written, 9.2 KB / 64.4 KB
  (60 KB / 300 KB ceilings)
- `node Projects/daredevil/test/smoke-page.mjs` → 36 passed, 1 failed (§4's
  class of issue, unrelated to this session's `href`/URL change — confirmed
  no file under `Projects/daredevil/` was touched)
- Locked decision #34: `newindex.html`'s font hotlink, added back and
  removed, `npm run check` failed then passed; `sync-social-tags.mjs`'s
  pre-fix state (17 parsed, floor at 20, exit 2) observed directly before the
  floor was lowered, confirmed passing after
