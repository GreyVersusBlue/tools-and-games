# gvb-site-handoff-v7.md

Handoff from **session 7** (site version 8) → whoever picks this up next.
Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v6.md` first if you have not. Everything in it still
holds unless contradicted below.

---

## 0. What changed in one paragraph

Session 7 cleared v6's top three. **`gvb-save.js` finally has an adopter** — The
Fourth Quarter — after four sessions on the list, and the adoption paid for itself
by finding three gaps in the shared module and two bugs in the game (§1, §2).
**`npm run games` is a new end-to-end regression suite** for the six games that
aren't Castle Conundrum: 94 assertions driving real pages with real clicks, which
is where the FQ save work got verified and where three more bugs surfaced (§3).
Getting into each game now lives in one place, `games.mjs`, shared with the preview
capture (§4). **Golden Hour's sand texture is vendored** — the site's last offsite
request is gone, and the estimate that made it look expensive was wrong by 4× (§5).
Two things worth reading even if you skip the rest: the start-screen tag that
quietly lied about what day it was for anyone who moved venue (§2), and the
seven-game run that failed twice and passed on retry because Chrome throttles a
window nobody is looking at (§6).

---

## 1. The shared save system has an adopter

`Projects/fourth-quarter/js/campaign.js` now persists through
`assets/js/gvb-save.js`. The storage key is unchanged — `fq3d-save` — so every
campaign saved by an older build still loads. Those saves carry no version stamp,
which `normalize()` reads as version 0.

What the game got: **export a campaign to a file and load it back** (Export save /
Import save on the start screen, under New Game), a memory-backed fallback when the
browser blocks storage, and one implementation of "refuse to load garbage" rather
than one per project.

Three things the module was missing, all found by being used:

- **`defaults` may be a factory.** `newCampaign()` rolls three random job
  applicants, so day one cannot be a literal — and without this, `slot.reset()`
  handed back `null` and was useless to the one game trying to use it.
- **`repair`, a new hook.** `migrate(state, from)` only runs when the stored
  version differs. The fill-in-the-gaps pass that lived in every project's own
  `load()` has to run on *every* accepted load, from every door — localStorage, an
  imported file, a pasted blob — including a save the current build wrote. There
  was no hook with that shape. There is now, and `repairCampaign()` is it.
- **`buttons` on `mountSaveBar`.** The Fourth Quarter's start screen has shipped a
  "New Game (wipe save)" button since long before this module existed, and
  mounting the bar's "Start over" beside it would have put two campaign-erasers
  side by side. It mounts `["export", "import"]`. Each button also carries
  `data-gvb="export|import|reset"` so a driver can click one without depending on
  label text or order.

Nothing in this project touches `localStorage` directly any more, including
`main.js`. Reading that property throws outright in a browser configured to block
storage, which is the exact case the module's memory fallback exists to survive —
so `campaignSlot()` takes no argument in the game and lets gvb-save do the probing.
Tests pass a stub, same as before.

The import is **relative** (`../../../assets/js/gvb-save.js`), not
`/assets/js/gvb-save.js`. `campaign.js` is imported by `test/smoke-campaign.mjs`
under plain Node, which cannot resolve a leading slash.

---

## 2. Two bugs in The Fourth Quarter, both found by adopting

**The start screen lied about the day.** `#startTag` read
`campaign.stats.nights ? "Day N at …" : "Day 1 at The Corner Tap"`. But
`settleDarkNight()` advances the day for each closed night of a venue move
*without* counting a night played — so a player who moved to the Fieldhouse on day
one came back to "Day 1 at The Fieldhouse", and a dev-warped campaign at day 8 said
day 1. It now reads `campaign.day > 1 || stats.nights > 0`, and it takes the venue
name off the campaign instead of hardcoding the Corner Tap, which also matters for
an imported save that could be at any tier.

**A staffer from before roles existed had no walking speed.** The old loader
filled in `role` and `skill` for a save that predated them but never `speed`, and
`beginNight()` multiplies that straight into a Server's metres per second — an
`undefined` there makes a floor NPC with a NaN speed that never arrives anywhere.
`repairCampaign()` derives it from skill now. Both the Node suite and the browser
suite assert it.

---

## 3. `npm run games` — the regression suite

`Tools/board-check/play-games.mjs`. Six games, 94 assertions, real clicks and
keystrokes against real pages, screenshots in `shots/games/`, non-zero exit on any
miss. Castle Conundrum stays with `npm run play`, which goes deeper on one game.

**The case for it, given four of these projects already have Node smoke suites:**
those suites import the engine modules and drive them directly — Faire Weekend's
even builds a JSDOM — and they are blind to the wiring. `day.rebuildStations` was
the proof: 122 campaign assertions passing while "New Game" threw on the first
click a player makes. Nothing here re-tests engine arithmetic. Every beat is
something that only breaks in a browser.

| Game | What it drives |
| --- | --- |
| Integer Foundry | builds an 8-tile production line, watches the sink judge what arrives, reloads, fills an order |
| Closing Time | renders all six desk screens, ends 14 days (handling event modals), reloads mid-career |
| Faire Weekend | builds and commits four plots, opens the gates across a weekend, reloads |
| Golden Hour | walks, turns, and asserts the vendored sand is on the ground and nothing left the site |
| Aphelion | fade, three HUD gauges, the CERES toast, walking, TAB opening the logbook |
| The Fourth Quarter | the whole save story: bar, ladder warps, export, reload, import, legacy save, New Game, doors open |

Four things learned writing it, all of which cost a run:

- **Read the DOM, not the save, for anything just-happened.** Integer Foundry
  autosaves on an 8-second interval; Closing Time saves on render; Faire Weekend's
  `render()` returns early for the report/victory/gameOver/weekendEnd phases and
  only reaches `saveState()` on the planning path, so **a report is never on disk
  while it is on screen**. Assert against a stale save and you will report a
  working game as broken — which this did, twice, before the comments went in.
- **Randomised targets need seeding, not luck.** Integer Foundry's sink asks for a
  number up to 12 and a straight 8-cell row only holds six `+1`s, so "did it pay
  out" is unassertable as-is. The suite writes `sinks[0].target = 3` into the save
  and reloads — and neuters `localStorage.setItem` on the outgoing page first,
  because its autosave is still armed and will write the old target back.
- **`window.__scene` and `window.__cam` die with a reload.** Any suite that
  reloads has to call the probe again before touching the camera; `t.probe()` is
  there for that.
- **A file picker has to be answered before it is opened.** `promptImport()`
  creates a hidden `<input type="file">` and clicks it. Playwright wants
  `page.waitForEvent('filechooser')` registered before the click, Puppeteer wants
  `waitForFileChooser()`; `prepPage()` now sets `page.__engine` so a script can
  tell. The export side needs no engine knowledge — hooking `URL.createObjectURL`
  reads the exact bytes a download would have written, and neutering the anchor
  click stops the browser saving a file.

---

## 4. `games.mjs` — the way into each game, written once

v6's §6 moved the game-*driving* code into `drive.mjs`. This does the same for the
game-*entering* code: URL, frame size, three.js specifier, intro overlays, save
key, and `open()` — the clicks between a blank page and the first frame of play.
`enter()` wraps that with "load it, wipe whatever save this browser has for it,
play it in".

`capture-previews.mjs` lost all seven openings to it and keeps only what is about
framing a picture. Two consequences worth knowing:

- The Fourth Quarter recipe **no longer clicks `#wipeBtn`** — `enter()` clears the
  key before the page that reads it boots, then reloads. (Clearing without a reload
  does nothing: the module has already read the save and built its campaign.)
- `open()` takes per-caller options. `fourth-quarter` has `start: false`, because
  the save bar lives on the start overlay and the regression suite needs it up
  while a screenshot needs it gone.

One trap that bit here, and it is not the one v6 documented: Closing Time's
`boot()` awaits `loadAll()` before rendering anything, so testing for
`.start-screen` without waiting first finds neither the modal nor the nav, and then
waits out the full timeout on a nav that is never coming. Wait for
`'.start-screen, #nav [data-nav]'` — whichever arrives.

---

## 5. Golden Hour's sand is vendored — zero offsite requests site-wide

v6 §8 left this open and estimated "two 1k JPEGs (~1–2 MB)". **They are 370 KB for
the pair** (113 KB diffuse, 257 KB normal), which is nothing against a repo whose
Castle Conundrum asset kit alone is 178 MB. The estimate was the only real argument
against vendoring, and it was wrong by 4×. Measure before deciding this kind of
thing.

They live in `Projects/golden-hour-beach/assets/textures/` with a README naming the
source and the CC0 licence. `terrain.js` still paints its procedural canvas sand
first and swaps these in when they decode, so deleting them makes the beach look
hand-mixed rather than breaking it.

Beyond the size: it stopped handing a third party the IP address of everyone who
opened the beach, every visitor now sees the same shoreline, and it matches what v4
already decided for three.js. **`page.__blocked` is empty everywhere now** — the
site makes no offsite requests at all, and `play-games.mjs` and `play-castle.mjs`
both assert it. `prepPage()`'s `allow` list has no users left; it is kept for the
next dependency that has to be seen to be believed.

---

## 6. Chrome throttles a window nobody is looking at

A full seven-game `npm run previews` failed twice: Golden Hour's two "is the frame
moving" screenshots came out byte-identical, and Castle Conundrum's walk covered no
ground. Both passed on their own a minute later. Nothing was wrong with either
game — click another application while a headed run is playing and Chrome stops
compositing and throttles `requestAnimationFrame`, so the render loop stalls and
keyboard input moves nobody.

`harness.mjs` now launches with `--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding` and `--disable-background-timer-throttling` on
both engines. All seven passed in one run afterwards. If you see a frame-motion or
a walk assertion fail once and pass on retry, this is the first thing to suspect —
and check the flags survived.

---

## 7. Faire Weekend's smoke suite was unrunnable on Windows

`Projects/Ren-Faire-Claude/tests/smoke.mjs` — 684 assertions — could not run here
at all. Two reasons, both now fixed:

- It `import()`s modules by absolute path. On Windows that starts with a drive
  letter, which Node reads as the URL scheme `c:` and refuses outright
  (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). It works on Linux and macOS only because a
  POSIX absolute path happens to be a valid relative URL. There is a `mod()` helper
  at the top now that runs paths through `pathToFileURL`. **Same family as the
  brace-expansion hazard in v6 §5: this repo is developed on Windows and tooling
  written elsewhere assumes it isn't.**
- It needs `jsdom`, which is a devDependency of that project and is not vendored.
  Run `npm install` inside `Projects/Ren-Faire-Claude` once. (`node_modules/` is
  already gitignored there.)

684 passed, 0 failed, after that.

---

## 8. Backlog state

| Item | State |
| --- | --- |
| Adopt `gvb-save.js` in The Fourth Quarter | **Done**, after four sessions on this list. See §1 |
| Regression suite for the other six games | **Done.** `npm run games`, 94 assertions. See §3 |
| Decide about Golden Hour's hotlinked sand | **Decided: vendored.** See §5 |
| Start-screen tag showed Day 1 after a venue move | **New, fixed.** See §2 |
| Legacy staffer loaded with no walking speed | **New, fixed.** See §2 |
| Faire Weekend's suite unrunnable on Windows | **New, fixed.** See §7 |
| Headed runs flaky when the window loses focus | **New, fixed** in the harness. See §6 |
| Castle Conundrum wall textures read blurry | **Still not fixed.** v6 §8 stands: UV or texture-sourcing work, budget a session |
| Scholar clips through a hall table; braziers look unsupported | **Still cosmetic, still not fixed** |
| Faire Weekend never saves during a report phase | **New, not fixed.** See §9 |
| The save bar is only reachable from the start screen | **New, not fixed.** See §9 |
| Vendor CDN dependencies | **Complete.** Zero offsite requests site-wide (§5) |
| `Tools/board-check` on Windows | Fixed in v4; `npm run check` passes — 235 units, 0 broken, 0 collisions |
| Previews, favicons, OG tags, line of sight | All fixed in v6, untouched, still passing |
| End-to-end play test for Castle Conundrum | v5's `npm run play`, still 22 beats, all passing |

---

## 9. Two things I found and deliberately did not fix

**Faire Weekend never writes a save while a report is on screen.** `render()`
returns early for the report, victory, gameOver and weekendEnd phases, and
`saveState()` is on the planning path below that. So reloading while looking at a
day's takings rewinds to before the gates opened, and the day is replayable. It is
consistently forgiving rather than broken, and "fix" here means choosing a policy
(persist the report, or persist and lock the day) rather than moving one line. The
regression suite reads history rather than `lastResult` because of it, with a
comment saying why.

**The save bar is only on the start screen.** Exporting a campaign mid-week means
reloading the page to get the start overlay back. Everything is saved by then, so
nothing is lost, but it is a step nobody should have to think of. The right home is
probably the box score, next to Tomorrow's Ledger — that is the natural "I'm done
for tonight" moment. Left alone because it is a design call about a screen that
currently has one button on purpose.

---

## 10. Locked decisions

Everything in v1 §3, v2 §8, v3 §6, v4 §5, v5 §6 and v6 §9 still stands. Added:

36. **A project adopting `gvb-save.js` keeps its existing storage key.** Changing
    it silently abandons everyone mid-campaign. Unversioned saves read as version 0
    and come through `repair`.
37. **`migrate` is for version drift; `repair` is for every load.** If a fill-in
    has to happen whatever the version says — and the pass a project already had in
    its own `load()` always does — it goes in `repair`.
38. **The way into a game lives in `games.mjs`, once.** Any new script that has to
    get past a title screen imports `enter()`. Two copies of an opening is the
    thing `drive.mjs` and this file both exist to prevent.
39. **Assert against the DOM for anything that just happened, and against the save
    only for what a reload has to survive.** Three of these six games write to
    localStorage on a timer or on a code path a report never reaches; a stale save
    reads exactly like a broken game.
40. **A guard-rail that can be satisfied by luck gets seeded, not retried.**
    Integer Foundry's random sink target is written into the save before the run
    that depends on it, with the outgoing page's autosave disarmed first.
41. **Headed runs launch with backgrounding disabled.** A suite whose result
    depends on whether the person running it clicked away is not a suite.
42. **Measure before deciding an asset is too heavy.** The one argument against
    vendoring the sand texture for two sessions was a size estimate that was 4×
    too big and had never been checked. Two `curl -I`s settled it.

---

## 11. Suggested next session

Roughly in order of value per effort:

1. **Adopt `gvb-save.js` in a second game — Closing Time is the obvious one.**
   It has a hand-rolled `save()`/`loadSave()`/`wipeSave()` on `closingTime.save.v1`
   with no version stamp and no validation at all: a corrupt blob is `JSON.parse`d
   straight into `S` and the game boots on it. The Fourth Quarter is now a worked
   example, `repair` exists for precisely the "fields added since" problem, and
   `play-games.mjs` already drives the game and can grow the same beats.
2. **Move the save bar somewhere reachable mid-campaign** (§9). Small, and it
   completes the export/import feature rather than shipping it behind a reload.
3. **Castle Conundrum's blurry walls** (v6 §8). Unchanged and still the biggest
   visual win available. Budget a session; `npm run play` plus the preview capture
   give you a before/after.
4. **Decide Faire Weekend's report-phase save policy** (§9) — or write down that
   replayable days are intended, which is a legitimate answer.
5. **Cosmetic, low priority:** the Scholar still stands half-inside a hall table
   and the interior candelabra still read as floating. Both visible in
   `shots/play/`.

Remember to bump the version line to `version 9` and write
`gvb-site-handoff-v8.md` before signing off.

---

## Verified this session

- `node assets/js/gvb-save.test.mjs` → **39 passed, 0 failed** (was 32)
- `node Projects/fourth-quarter/test/smoke-campaign.mjs` → **137 passed** (was 122)
- `node Projects/fourth-quarter/test/smoke-engine.mjs` → **179 passed**
- `node tools/smoke.mjs` in Closing Time → **SMOKE OK**
- `node tests/smoke.mjs` in Ren-Faire-Claude → **684 passed** (first run on Windows)
- `npm run check` → **235 units, 0 broken; 0 collisions across nine widths**
- `npm run social:check` → **23 notices, 23 already current**
- `npm run games` → **94 checks, 0 failed**
- `npm run play` → **22 beats, all passing**
- `npm run previews` → **all seven reached gameplay** in one run
