# Hearth v2 — Sprint 9 handoff ("Solid ground")

Deliverable: `hearth.html` (single file, ~174 KB, zero deps, runs from `file://`) **plus, for the first time, `test/` — the soak harness, committed.** Sprint 9 is the debt sprint from the roadmap: no new simulation systems, no new audio. It pays down the sprint 8 leftover list, rebuilds the lost test rig, and ships the two cheap player-facing wins (mobile discoverability, autosave). The harness paid for itself within an hour of existing, twice.

## Changelog (5 lines)

1. **People respect the shore now.** `walk()` finally checks the ground, the same discipline the animals got in sprint 8: refuse the sea, slide along it, and — new for people — **wade the stream**, slowly, with a log line ("hitches up and wades the stream, feeling for the stones"). Once the bridge is up, targets across the stream route through it via a single waypoint (no A*, one line-sample check when a target changes). The bridge's finish line stops being a lie.
2. **The harness is back, in the repo this time.** `test/harness.mjs` (Node + Playwright, replacing the never-committed `harness.py`): `soak` (all species + people audited every 25 steps across 5 islands, 2 of them random), `determinism` (same seed twice → compare `pack()` hashes), `save` (autosave round-trip through a real reload), `nan` (long soak with periodic starvation stress). Verified this sprint: **200 sim-days, ~22,500 full-cast audits, 0 violations, 0 breadcrumbs; determinism PASS on a plain island and a stream island.**
3. **Time can no longer run backward — and a real double-day bug died for it.** The first RAF frame's timestamp can predate the `performance.now()` captured at boot, giving a **negative dt**; and `pack()` rounds a dawn save to sit exactly on a day boundary. Together: every autosave restore stepped time backward across the boundary, and the `!==` day check fired `newDay()` **twice** — two phantom days on every dawn-saved load. Fixed both ends: dt clamped at 0, and the crossing check is `>` not `!==`.
4. **The island keeps itself.** At each dawn the world is packed and written to `localStorage` (`hearth.auto`); on boot with no link in the address bar it comes back with one line — "The island kept itself while you were away." "keep" remains the deliberate sharing act; "new island" clears the autosave so a deliberate fresh start stays fresh.
5. **The watcher is finally told what a watcher can do, on phones too.** The `#hint` block is hidden under 520px, so mobile players never learned the blessing system existed. Now: a "?" button (mobile only) opens the full hint text, and the log itself teaches — one dim italic line per real-time minute ("The grass would take a seed, if something planted one."), only for acts never yet used, never again once each act has been done once (tracked in prefs, not the save). Plus: the keeper child's granary draws below 4 are witnessed with escalating lines, ending at "takes the last measure from the store and sets the empty lid down beside it, gently." — a silent island death is now a seen one.

**What I'd cut if it were too big:** nothing was close; the sprint came in at +6.3 KB against a +5–6 KB estimate.

## What I did, in order

- Rewrote `walk()`: `canWalk` (any non-water tile, plus the bridge tile once built), `canWade` (stream tiles only — springs are refused and slid around), slide on one axis when the direct step fails, `blockedStop()` when both fail (release the task where they stand; deterministic, no `rnd()`). A target tile that is itself sea (shore tasks get ±.4 offsets) counts as arrived at the water's edge inside 1.2 tiles.
- Added `routeVia()`: when a person's target changes and the straight line to it crosses a stream tile and the bridge is up, insert the bridge as a waypoint. Computed lazily in `walk()` on target change, so every task assignment gets it without touching call sites.
- Ran the soak. It caught two real bugs:
  - **My own:** the fishing boat drops its rower at the mooring (`landing + 0.9` — a water tile). Under the old wade-anywhere `walk()` they'd stroll ashore invisibly; under the new one the escape step was smaller than the tile and they were stranded forever — sleeping, marketing, "fishing" from one exact point in the sea, every rower accumulating at the same coordinates. Fixed at the source (rower steps ashore at the landing) **and** with the same self-heal people-side that the animals got in sprint 8: anyone standing in open water snaps to the nearest shore, deterministically.
  - **The base game's:** the negative-dt double-newDay described in the changelog, found because the autosave round-trip test restored to day 6 from a day-4 save. Stack-traced through a patched `appendChild` to `step()`'s day-crossing branch running on a backward wobble.
- Fixed a latent voyage stall while in there: a mourning interrupt (or the new `blockedStop`) could knock the voyager off `task='voyage'` with the voyage stuck at `st='going'` forever. The morning trigger now re-kicks a going-but-idle voyager (without repeating the breakfast line).
- Autosave (`autoSave()` at the end of `newDay()`, try/catch — sprint 6 taught that localStorage can throw), boot restore path, "new island" clearing.
- Hints: `HINTS` list, `hintsDone` in prefs, `hintTick()` on **real** frame time in the RAF loop (presentation only — it never touches the sim or `R()`), act-completion hooks in `showCard`/sapling/`skipStone`/`makeSpring`/`gustAt`/`rainOn`/`dreamOf`/lullaby/`tellStory`. The "?" button and `#hint.show` overlay for mobile.
- Keeper-child floor lines in the `tend` granary draw.
- Exposed `canWalk`, `canWade`, `routeVia`, `wadeTiles`, `bridgeUp`, `bridgeSite`, `autoSave` on `window.__hearth` for the harness.

## Numbers, measured

- Soak after fixes: **5 islands (3 fixed, 2 random) × 40 days = 200 sim-days, ~22,465 full-cast audits (every person, animal, and boat every 25 steps), 0 water violations, 0 non-finite breadcrumbs.** Three of the five islands had streams; all three built their bridge and routed over it.
- Before the fix, the stranded-rower bug logged **21,271 violations on one island in 40 days** — all at a single coordinate, the boat mooring.
- Determinism: seed 7 and seed 20260819 (stream + bridge), 30 days, two fresh runs each: **identical `pack()` hashes** (`d6f7319e` / `22d843d7`).
- Autosave round-trip (seeds 7, 4242): save at dawn day 4 → reload → day 4, same people, quiet line shown. Before the dt fix this restored to **day 6**.
- Populations at day 41 across the five soak islands: 19–23 — the historical band, so terrain-aware walking did not warp the economy.
- Bridge usage, seed 20260819 over 25 days (sampled every 5 steps): **2,134 person-samples en route via the bridge waypoint, 198 samples standing on the bridge tile mid-crossing, 1,249 legal wade samples** (pre-bridge days and short hops — "several people do anyway", as the finish line promised).
- File: **174.0 KB** of the ~250 KB budget (+6.3 KB this sprint).

## Issues / complications I hit

- **An inserted `//` comment mid-edit swallowed the rest of a one-line statement** and killed the whole IIFE — the page loaded with no `__hearth` at all. The harness's 30s `waitForFunction` timeout is what caught it. If you edit this file, remember almost every statement shares a line with its neighbors; use `/* */` inline.
- **The mooring bug is a warning for sprint 10+:** any code that *places* a person (boat arrivals, births at a doorstep, future mill/well trips) must place them on ground `walk()` accepts, or they are now stuck rather than invisibly wading. The self-heal converts such mistakes into a one-frame snap to shore, but don't lean on it.
- The browser preview pane loads the game as a `data:` snapshot where `localStorage` throws — autosave silently no-ops there (the try/catch holds). On real `file://` and `https://` it works; the harness proves it through a real reload.

## Victories

- The rebuilt harness caught a five-sprint-old class of bug (people-on-water), a brand-new bug (stranded rowers), and a genuinely subtle base-game bug (negative-dt double-day) in its first afternoon of existence. Committing it this time.
- The bridge, two sprints after it was built, finally has people walking over it — and the ford line ("feeling for the stones") reads like it was always there.

## Where the thing stands

Sprints 1–9 in, ~174 KB of ~250 KB, one file, no dependencies, no build step, plus a committed test rig (`test/`, `npm install && npm run soak`).

**Still owed from this sprint's plan — the audio listening pass.** Every sound in the game remains verified only by graph inspection and FFT. Devon: open the game with sound on, on a phone speaker and on headphones, in quiet and in rain, and note anything harsh, missing, or mistimed (the tuning list goes in this file). The roadmap gates ALL new audio behind this pass. It is now four sprints old.

**The NaN case is closed.** The long hunt ran: **5 islands × 400 days = 2,000 sim-days, ~225,860 full-cast audits, with food and granary forcibly zeroed every 30 days past day 20 (the observed risk profile — a starving island). Zero breadcrumbs, zero non-finite positions.** Combined with sprint 8's ~700 days, the bug has now failed to reproduce across ~2,700 sim-days including forced starvation. Per the roadmap: the heal-plus-breadcrumb guard is documented as the permanent answer. If `hearth: non-finite position` ever appears in a real console, the task name in it is the lead — but nothing is owed on it any more.

Quality-bar leftovers, if there is ever a Sprint 10 (the roadmap says there is):
- `blockedStop()` releases a cornered person's task where they stand. Watched for churn in the soaks and saw none, but if sprint 10's carriers (farm→mill→granary) ever loop against a blocked route, look here first.
- The hint lines only show under 520px. A desktop player who never notices `#hint` in the corner gets no teaching; arguably fine (the hint is visible), noting it.
- Wildlife still respawns rather than restores on load (pre-existing; unchanged).
