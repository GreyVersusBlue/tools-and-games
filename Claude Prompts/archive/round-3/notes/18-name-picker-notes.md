# Name Picker — session notes

Round 2's own notes are below the `---` split, round 1's below that again. This
round's one required task was the engine-mismatch bug prompt 18 itself flagged in
this project's own `test/browser.mjs` — fixed and verified. The rest of the
session went to the top item on round 1 and round 2's shared "if session left
over" list: multiple rosters under real use, untouched by either prior round.
Nothing else needed touching. The tool is in a stable state with no outstanding
bugs I found — see "Next session" for what is left, and none of it is urgent.

## Student data

Nothing storage-related changed this round — the one task was a test-harness fix,
not a code change to the page or `np-store.js`. So the answer is unchanged from
round 2's own answer, re-confirmed rather than assumed: no real student names
anywhere (checked the diff I actually produced — it touches only `test/browser.mjs`
and this README, neither of which holds a name); thirteen `np_` keys in
`localStorage`, nothing else, zero network requests; the 🔒 Data tab's single
"Erase All Student Data" button still clears exactly the six keys with names in
them; the UI still tells the truth about what it stores and where. The new
two-roster browser check adds a fourteenth fabricated fixture split (`CLASS_OF_28`
sliced into two 14-name halves, "Period 3" and "Period 5"), not a new name list —
same names `test/smoke.mjs` and the rest of `test/browser.mjs` already use.

## What changed

### Task one — the engine-mismatch bug in this project's own `test/browser.mjs`

Prompt 18 named two shapes of the same bug — the `npm run games`-wide
Playwright-vs-puppeteer-core mismatch, in a project-owned file prompt 22's repo-wide
fix explicitly didn't reach:

- `page.waitForFunction(() => window.__npExports.length > 0, null, { timeout: 5000 })`
  (old line 163) — Playwright's three-argument signature; `puppeteer-core`'s is
  `(fn, options, ...args)`, so the literal `null` lands in `options`.
- Ten bare `page.textContent(selector)` calls (old lines 102, 108, 113, 195, 201,
  210, 213, 240, 242, 264) — a Playwright-only convenience method `puppeteer-core`
  never had.

Fixed the same way every other project's copy of this bug was fixed this round:
imported `waitFor`/`textContent` from `Tools/board-check/drive.mjs` (already used
by other passing suites in this repo, e.g. this project's sibling
`Tools/seating-chart/test/drive-seating.mjs`) and swapped all eleven call sites.
Mechanical — no assertion text, no selector, no timeout value changed. `git diff`
on this file shows exactly that: one new import line and eleven one-line swaps,
nothing else.

**One honest caveat: I could not reproduce the crash myself.** This session runs
on Windows, and `harness.mjs`'s `launch()` only takes the `puppeteer-core` branch
on `process.platform === 'linux'` — on Windows it always launches Playwright, so
`page.__engine === 'playwright'` here and the buggy code was never actually broken
in this environment. I confirmed this the direct way, not by reading the code and
assuming: stashed this fix, ran the suite against the un-fixed file, and it passed
44/0 clean, no crash, on this machine. Un-stashed the fix and it still passes
54/0 (see task two). So the bug is real and platform-specific, exactly as prompt 18
described ("throws under this environment's puppeteer-core") — that environment
was Linux, this one is not. The fix is verified correct by construction (identical
pattern to every other project's fix this round, and to `drive.mjs`'s own
documented contract for both engines) rather than by a repro I could actually
produce here. Flagging the limits of what I verified rather than claiming a crash
I didn't personally see.

### Task three (partial) — multiple rosters under real use

Round 1's own list flagged this, round 2 left it untouched a second time:
`np_rosters` handles more than one saved roster structurally, but neither browser
suite had ever saved two, switched between them, or deleted one beside a
survivor. New block in `test/browser.mjs`, fresh browser context (does not share
storage with the other three blocks): saves two 14-name rosters ("Period 3",
"Period 5") under two `prompt()` answers in sequence, confirms both show up in
the roster list with correct counts, switches to Period 3 and confirms the names
box holds exactly Period 3's 14 (not both classes merged), switches to Period 5
and confirms the same in reverse, deletes Period 3, and confirms Period 5 survives
untouched with its full count. 10 new checks (44 → 54).

**Verified the new checks actually catch a broken build, not just a working one**
(same spirit as round 2's sabotage-and-revert on the corrupt-roster guard, locked
decision #34): commented out the one line `delete rosters[name];` in
`deleteRoster()` (`Tools/Name Picker.html`), leaving everything else — the
`confirm()`, the `store.set`, the UI refresh — intact. Ran the suite:
`FAIL Period 3 is gone after its own delete`, 53 passed, 1 failed. Reverted
(`git diff` on the page confirms nothing left), reran, back to 54/0. The app code
itself was never actually changed on disk between these runs except during that
one-line sabotage window.

### Task two — the rename, not touched, flagged again

Per the prompt's own framing, this is not this thread's call: renaming
`Tools/Name Picker.html` needs a session that also owns `index.html` so the board
`href` changes in the same commit. Round 1 and round 2 both declined it for the
same reason; nothing changed this round that would revisit that. See Shared-file
requests for the exact edit, in case a session with that boundary wants it.

### Files touched

| Path | What |
| --- | --- |
| `Tools/name-picker/test/browser.mjs` | engine-aware `waitFor`/`textContent` imported and swapped in at all eleven sites; new two-roster block, +10 checks (44 → 54) |
| `Tools/name-picker/README.md` | mentions the new two-roster coverage in the file table and the `browser.mjs` prose |

No storage key touched, added, or removed. `Tools/Name Picker.html` has no net
change (the sabotage-and-revert above left it byte-identical to before — checked
with `git diff`, not assumed).

## What I verified

**`node Tools/name-picker/test/smoke.mjs` → 213 passed, 0 failed.** Unchanged,
since nothing in `np-store.js`/`np-pick.js` was touched.

**`node Tools/name-picker/test/browser.mjs` → 54 passed, 0 failed, twice in a
row** (checked it wasn't flaky, same practice as round 2). Before the two-roster
block existed it was 44/0, twice in a row, immediately after the engine-mismatch
fix and before I added anything else.

**Reproduced the pre-fix state on purpose rather than trusting the prompt's own
account** (see task one above): `git stash push -- test/browser.mjs`, ran the
suite against the original code — 44/0, no crash, because this machine runs
Playwright, not `puppeteer-core`. `git stash pop` restored the fix; reran,
54/0. `git diff --stat` before writing this file confirms only
`test/browser.mjs` and `README.md` are modified in my boundary, and `Tools/Name
Picker.html` shows no diff.

**Sabotaged and reverted `deleteRoster()` to prove the new roster-switch checks
are real** (see task three above): one line removed, suite went to 53/1 with the
correct failure, one line restored, suite back to 54/0. `git diff` on the page
confirmed clean before moving on.

**`node Tools/name-picker/test/blocked-storage.html` → 10 of 10 pass**, checked in
a real browser (spun up a spare static server on port 8150 via `harness.mjs`'s own
`serve()`, since this project's usual test port and the games/play/previews
screen were both free to use for a headless page). I did not touch
`np-store.js` this round, so this was a re-confirmation rather than a check driven
by a code change, but the notes format asks for actual output, not "should still
pass."

**`cd Tools/board-check && npm run tools` → 18 checks, 0 failed**, this page
included: title non-empty, no offsite requests, no console errors.

**`cd Tools/board-check && npm run check` → 357 units checked, 0 broken; 0
collisions across nine widths, tightest vertical gap 9.1px.** Moving target —
was 335 in round 2's own run, 350 then 357 across two of my own runs this
session, because other sessions are writing files into this repo at the same
time I am. 0 broken is the number that matters, same caveat every prior round of
this file has given.

**`npm run social:check` → 18 notices · 12 already current · 1 had no block · 5
out of date · 0 failed.** None of the six out-of-sync pages are this project's —
`Projects/daredevil/index.html`, `Projects/torchbearer.html`,
`Projects/fourth-quarter/index.html`, `Projects/Ren-Faire-Claude/index.html`,
`Projects/orbital/index.html`, and `newindex.html`. That last one is worth a note
for whoever owns it: round 2's notes describe it as untracked and breaking
`npm run check`'s unit count; it's tracked by git now and `npm run check` passes
clean (0 broken) with it in the tree, so at least one of those two problems has
already been fixed by another session. Not my file, not fixing it, just
recording the state I actually saw.

## Shared-file requests

None new to `assets/js/gvb-save.js`. One repeat, not urgent, same as round 2:

**The rename**, if a session that owns `index.html` wants to do it. Exact edit:

- `Tools/Name Picker.html` → `Tools/name-picker.html` (the folder is already
  `Tools/name-picker/`, so this pairs it up)
- `index.html`'s board card `href="Tools/Name%20Picker.html"` →
  `href="Tools/name-picker.html"`, same commit as the rename, or the card 404s in
  between.

## Deliberately not done

**Two of round 1 and round 2's three "if session left over" items, still
untouched:**

- **Mobile and accessibility re-verification.** Round 1 checked 375×812 and
  `prefers-reduced-motion`; nobody has touched CSS or layout since, including this
  round, so there is nothing that could have regressed. Still due for a fresh
  check at some point on general principle, not because anything points at a
  problem.
- **`leastPicked()` wiring.** Still written, still tested, still unused. Fair
  rotation makes it mostly redundant; the Stats tab's own "Least Picked" sort
  covers the same need.

**Did not touch the rotation-persistence question.** Same call both prior rounds
made: it needs an answer to "is a reload the same period or the next one," not
code, and nobody's asked it yet.

**Did not investigate `newindex.html` or the `social:check` drift list beyond
noting the current state.** Neither is this project's file or job.

**Did not try to reproduce the engine-mismatch crash in a Linux environment.**
This session only has Windows available. The fix is verified by construction and
by matching every other project's identical fix this round, not by watching the
crash happen and then not happen — see task one's caveat above.

## Next session

1. **The rename**, whenever a session owning `index.html` wants to pick it up —
   exact edit above. Not urgent; the current path still resolves fine.
2. **Mobile and accessibility re-verification**, carried over twice now.
   Low urgency: nothing has changed in that area since round 1 checked it.
3. **`leastPicked()` wiring**, a two-line job if anyone wants a "who's due"
   display.
4. **The rotation-persistence question**, if a teacher ever asks for it.

No open bugs, no failing checks, no student-data gap. This project is in a
stable state.

---

# Name Picker — session notes (round 2)

Round 1's own notes are below the `---` split. This round was two specific tasks
off round 1's own "Next session" list: build the browser suite, and decide
`np_history`'s day boundary. Both done. Nothing else in this file's own scope
needed touching.

## Student data

Still no real student names anywhere. `test/browser.mjs` adds one more fabricated
fixture — the same 28-name `CLASS_OF_28` list `test/smoke.mjs` already used
(Aiden Alvarez, Zoe Zaman, etc.) — rather than inventing a second one, so this
project's fixtures don't multiply. I did not re-check the full git history myself
this round; round 1 already did (`git show ef8f69c`) and nothing in this session
added, exported, or logged a real name anywhere.

What the tool stores and where is unchanged from round 1: thirteen `np_` keys in
`localStorage`, nothing else, zero network requests after load (re-confirmed:
`npm run tools` still reports 0 offsite requests refused for this page). The
🔒 Data tab's single "Erase All Student Data" button still clears exactly the six
keys with names in them and leaves the other seven alone — verified fresh this
round in `test/browser.mjs`'s erase block, which snapshots every `prefs` key
before erasing and asserts each one is byte-identical after, not just "still
there."

One change worth calling out under this heading specifically: `np_history`
entries now carry a `date` field (below). That field is a calendar date, not a
name, and it does not change which of the thirteen keys is student data — history
was already in the `records` group and still is.

## What changed

### Task one — `Tools/name-picker/test/browser.mjs` (new, 44 checks)

Round 1 flagged this as the highest-value gap: `npm run games` drives seven games
and zero tools, `Tools/board-check/tools.mjs` opens this page headless and checks
title/offsite/console but nothing clicks anything. This is that suite, scoped to
this project's own `test/` folder rather than `Tools/board-check/` (which prompt
21 owns) — same pattern as `Tools/seating-chart/test/drive-seating.mjs` and
`Projects/integer-foundry/test/browser.mjs`, both of which already import
`board-check/harness.mjs` by relative path from outside that folder. Headless: this
tool needs no WebGL or pointer lock, so it never has to fight `npm run
games`/`play`/`previews` for the screen the way a headed suite would.

One continuous run through the real page:

- Load 28 names, save them as a roster, confirm the Data tab's census and its
  13-row key table.
- Four rounds of multi-pick (7 at a time) through real clicks — not the pick
  module directly — then read `np_history`/`np_stats` off disk.
- Export: hook `URL.createObjectURL` and neuter the anchor click (per the prompt's
  own instruction) rather than using Playwright's `download` event, so this stays
  portable to the puppeteer engine `harness.mjs` uses on Linux. Capture both the
  envelope and the `a.download` filename.
- Erase: snapshot every prefs key before, assert it is unchanged after, assert
  every student-data key is `null`.
- Import: a real file chooser (`page.waitForFileChooser`/`waitForEvent
  ('filechooser')`, engine-aware, same split as `play-games.mjs`'s `setFiles`),
  not a shortcut around it. Assert the roster is back immediately (before any
  reload), then reload and assert the tool's own UI — not just `localStorage` —
  picked the restored roster back up.
- Two distinct corrupt-roster shapes, in separate fresh browser contexts so
  neither pollutes the other's storage: a truncated JSON blob (round 1's own bug),
  and a roster whose value is a number rather than an array (round 1's *second*,
  distinct bug in the same function — `loadRosterByName`'s `.join('\n')`).

I put both corrupt-roster bugs back on purpose rather than trusting the fix from
memory (locked decision #34) — details under "What I verified."

**One thing this uncovered that round 1's notes get slightly wrong:** the
truncated-JSON case is now guarded twice, not once. Prompt 21 already applied
round 1's own shared-file request — `gvb-save.js`'s `load()` now wraps
`store.getItem(key)` in its own `try/catch` (see the current file; round 1's notes
still describe this as an open request). So a syntactically-broken `np_rosters`
never even reaches `np-store.js`'s `fix()` any more — `load()` itself returns
`null` and the key falls back to its default. The non-array-value case (valid
JSON, wrong shape) is the one that still depends solely on this project's own
`fix()`, and that's the one I actually sabotaged to prove the guard matters (see
below) — sabotaging the JSON-syntax path no longer reproduces a crash, because
the shared module already stops it first.

### Task two — `np_history` gets a `date` field; the tab clears on the first pick of a new day

The History tab has said "picked this session" (banner) and "No picks yet today"
(empty state) since round 1, and neither was true: the key was never cleared, so
after the first day it silently accumulated last week's picks under a label that
implied otherwise. `repair` already caps it at 500 entries, which bounds it but
doesn't fix the label.

Decision: clear on the first pick of a new calendar day, not on load and not
never. On load would mean a teacher reopening the page mid-morning loses the
first period's picks the moment second period's roster loads — the "today"
framing is about a teaching day, not a browser session, and this project's own
groups already treat a fresh roster load as a fresh round (`rotation=freshRotation()`
in `loadNamesFromInput()`) rather than a fresh page. "Never" is the status quo and
is what makes the label false. First-pick-of-the-day is the smallest change that
makes "No picks yet today" literally true without a teacher doing anything.

Implementation: three near-identical `history.push(...); incrementStats(...)` call
sites (`selectWinner`, `multiPick`, `selectTournamentWinner`) collapsed into one
`recordPick(name)` (`Tools/Name Picker.html`, next to `saveHistory`/`loadHistory`).
It stamps every entry with today's date and clears `history` first if the last
entry's date differs from today. `np_history`'s `fix()` in `np-store.js` now
carries an optional `date` field through repair — legacy entries with none just
never trigger the clear, they still load. Also relabeled the History tab's banner
from "All names picked this session" to "All names picked today," since "session"
was never really true either (a reload doesn't clear it, only a new day or the
existing "Clear pick history" button does).

Verified by hand in a real browser (not just the suite): seeded a history entry
dated yesterday, reloaded — entry survived untouched, because no pick had
happened yet. Then clicked Pick — the yesterday entry was gone, replaced by a
single today-dated entry. Exactly the boundary the decision describes.

### Files touched

| Path | What |
| --- | --- |
| `Tools/Name Picker.html` | new `recordPick()` helper; three call sites collapsed into it; History banner reworded |
| `Tools/name-picker/np-store.js` | `history`'s `fix()` carries an optional `date` field |
| `Tools/name-picker/test/smoke.mjs` | +6 assertions for the `date` field (207 → 213) |
| `Tools/name-picker/test/browser.mjs` | new, 44 checks |
| `Tools/name-picker/test/.gitignore` | new — `shots/`, same as the other project `test/` folders |
| `Tools/name-picker/README.md` | documents `browser.mjs`, the `date` field, updated assertion count |

Every storage key: unchanged from round 1's table except `np_history`, which
gained one optional field (`date`) inside its existing JSON array — same key,
same wire format, no migration needed. No key was added or removed.

## What I verified

**`node Tools/name-picker/test/smoke.mjs` → 213 passed, 0 failed** (was 207; +6 for
the `date` field: a well-formed date round-trips, a malformed one becomes `''` not
the garbage string, a missing one is the same as malformed, and legacy fixtures
with no `date` at all still load clean).

**`node Tools/name-picker/test/browser.mjs` → 44 passed, 0 failed**, twice in a row
(checked it wasn't flaky on the timer-driven multi-pick animation). Full beats:

```
picks: 28   distinct: 28   duplicates: 0   back-to-back: 0
every history entry dated today
every student's pick count: 1 (28 students tracked)
export: name-picker-roster-backup-YYYY-MM-DD.json, format gvb-save, game
        name-picker, version 3, 13 keys, no "__v" anywhere in the file
erase: all 6 student-data keys null, all 6 prefs keys byte-identical to before
import: roster back immediately (pre-reload), then a reload shows the tool's own
        UI (namesInput, #countDisplay, #rosterList) picked it up, not just
        localStorage
corrupt np_rosters (truncated JSON): #countDisplay stays "3 names in pool",
        #rosterList says "No saved rosters yet", 0 page errors
corrupt np_rosters (value is a number, not an array): the good roster beside it
        survives with its full count, the bad one is silently dropped, 0 page
        errors
```

**Reintroduced both corrupt-roster bugs on purpose (locked decision #34), not
trusted from memory:**

- Removed `boxed()`'s `try/catch` around `JSON.parse` in `np-store.js` — the
  truncated-JSON test still passed. That's the finding above: this path is now
  guarded one layer up, in `gvb-save.js`'s own `load()`, which prompt 21 already
  patched. Reverted the change (confirmed `git diff` shows nothing left) once I
  understood why it didn't reproduce.
- Replaced `rosters`' `fix()` with `v => v` (no repair at all) — **this one broke
  immediately**: `pageerror: list.forEach is not a function`, in the same
  function round 1 named (`loadRosterByName`'s `.join`/`.forEach` on a non-array
  value). Reverted; suite back to 44/44.

**Day-boundary clear, by hand in a real browser** (`Tools/board-check` static
server, a spare port since another session had the usual one in use): seeded
`np_history` with an entry dated the day before, reloaded — entry present and
unchanged, `#countDisplay` correct. Clicked Pick once — the old entry was gone,
replaced by a single entry dated today. Confirmed the History tab's banner reads
"All names picked today" in the live DOM.

**`cd Tools/board-check && npm run tools` → 18 checks, 0 failed**, including this
page: title non-empty, no offsite requests refused, no console errors.

**`node Tools/name-picker/test/blocked-storage.html` → 10 of 10 pass**, checked by
hand in a real browser this round (not assumed from round 1's notes), since I
touched `np-store.js`'s storage-adjacent code (the `history` descriptor's `fix`).
Still needs a real browser — a throwing `localStorage` property getter can't be
reproduced in plain Node.

**`cd Tools/board-check && npm run check` → 346 units checked, 1 broken.** The one
break is `newindex.html` at the repo root hotlinking Google Fonts — not a file
this project touches, not tracked by git in this working copy, looks like another
session's in-progress draft of a board replacement. Flagging it since it showed
up in a check I ran, not fixing it — outside my boundary (index.html is prompt
21's, and this isn't even that file).

**`npm run social:check` → failed to parse: "only parsed 17 notices out of
index.html — the notice markup has changed shape."** Also not this project;
`index.html` is being edited by another session as I ran this. Re-run it yourself
before trusting either of these two numbers — moving target, same caveat round
1's notes gave for the unit count.

`grep -c "fonts.googleapis.com\|fonts.gstatic.com" "Tools/Name Picker.html"` → 0,
unchanged.

## Shared-file requests

None new. Both of this project's round-1 requests to `assets/js/gvb-save.js` are
already applied (locked decisions #48 and #49) — confirmed by reading the current
file, not by trusting the old notes, since that's what let me find the
guarded-twice finding above.

## Deliberately not done

**The three "worth a look if session left over" items from round 1's own list.**
Session went entirely into the two assigned tasks plus verifying them properly
(including the sabotage-and-revert check, which took longer than either task's
own code). Untouched, in the same state round 1 left them:

- **Multiple rosters under real use** — `np_rosters` handles it structurally
  (`test/browser.mjs` only exercises one roster at a time, same as round 1's own
  browser verification did).
- **Mobile and accessibility re-verification** — round 1 already checked 375×812
  and `prefers-reduced-motion`; I did not re-run either, and did not touch any CSS
  or layout this round, so there is nothing here that could have regressed.
- **`leastPicked()` wiring** — still written, still tested, still unused. Fair
  rotation still makes it mostly redundant.

**Did not investigate `newindex.html` or the `social:check` parse failure beyond
noting them.** Neither is this project's file or this project's job — see above.

**Did not persist the fair-rotation round across a reload.** Same call round 1
made: it needs an answer to "is a reload the same period or the next one," not
code, and nobody's asked that question yet.

## Next session

1. **Whoever owns `index.html`** (prompt 21) should know `npm run check` and
   `npm run social:check` both currently fail because of files at the repo root
   that aren't this project's — see "What I verified" above for both.
2. **Multiple-roster real-use check and mobile/accessibility re-verification**,
   carried over from round 1's own list, untouched this round.
3. **`leastPicked()`** — still a two-line wiring job if anyone wants a "who's due"
   display.
4. **The rotation-persistence question**, if a teacher ever says they want it.

---

# Name Picker — session notes (round 1, preserved below)

## Student data

**No real student names were in the file.** The only names present were three
placeholders in the roster textarea's `placeholder` attribute — Aiden Smith,
Brooklyn Jones, Charlie Patel — which are generic and obviously invented. I checked
the whole git history too, not just the working copy: `git show ef8f69c` (the
original commit that added the tool) has the same three and nothing else. Every
name I added for tests and fixtures is fabricated.

**What it stores and where.** Thirteen `localStorage` keys under the `np_` prefix,
in the browser on whatever machine the page is open on. Nowhere else. The tool made
no network requests before this session except three Google Fonts hotlinks, and
those are gone, so it now makes **zero** requests after the page loads. No account,
no server, no analytics. Six of the thirteen keys hold student names:

| Key | Holds |
| --- | --- |
| `np_rosters` | every saved roster, by period |
| `np_current` | the roster on screen |
| `np_lucky` | one student's name plus a date |
| `np_stats` | lifetime pick counts, keyed by name |
| `np_history` | every pick, name and time |
| `np_hof` | Hall of Fame entries, by name |

`np_lucky` is the one that is easy to miss. The key name says nothing about student
data and it sits among preference-looking keys, but it stores a child's name.

**Can a user clear all of it in one action? Yes, now.** There is a new **🔒 Data**
tab with a single **Erase All Student Data** button. It clears those six keys and
keeps the other seven — themes, task prompts, options, and the unlocked retro
theme. That split was the interesting part of the work: "clear site data" in Chrome
takes the earned easter egg with it, and a teacher who wants the class list gone
does not want to re-unlock anything. A second, quieter button erases everything
including settings.

The confirm dialog states real counts before it does anything, e.g. *"This removes
28 student names, 1 roster, 28 sets of pick counts, 28 history entries and 0 Hall
of Fame entries."* Verified in a browser: after the erase, `Object.keys(localStorage)`
is `['np_options','np_theme']` and a regex for the seeded names across the whole of
storage returns `null`.

**Does the UI tell the truth about it? Yes.** The Data tab opens with a plain
paragraph saying everything stays in this browser on this computer, that there is
no account, server or analytics, and that the page makes no network requests. It
then says the catch out loud: a cleared browser or a reimaged machine takes the
rosters with it. Under that is a live census — rosters, names, students with pick
counts, history entries, Hall of Fame entries — and a table of all thirteen keys
saying which erase button gets each one. If the browser is blocking storage the
census area turns red and says nothing will survive closing the tab.

**On export.** It is a file of children's names leaving a managed machine, so:
the filename is `name-picker-roster-backup-YYYY-MM-DD.json` rather than the
module's default `name-picker-save-…`; the confirm dialog says how many names are
in it before writing anything (*"It will contain 28 student names across 1 roster,
plus pick counts and history, in plain text"*); and the text above the button says
to treat it like a printed class list and keep it on a school-managed drive rather
than a personal cloud folder or a shared machine's Downloads. Export and import
moved off the Names tab so they sit directly under that sentence instead of under
"Saved Rosters", where the honest framing was nowhere near the button.

---

## What changed

### Task one — the unguarded roster reads

Four bare `JSON.parse(localStorage.getItem('np_rosters')||'{}')` calls, at the old
lines 1009, 1016, 1026 and 1032 (`saveRoster`, `updateRosterUI`,
`loadRosterByName`, `deleteRoster`), plus two more in `exportAllData`. All six gone.
Reads go through the store, which refuses a bad blob rather than throwing.

Two distinct failures were in there, not one:

- **Corrupt JSON killed the page on load.** `updateRosterUI()` runs from the `load`
  handler, so a truncated `np_rosters` threw before the handler finished.
- **A roster whose value was not an array killed it on use.**
  `loadRosterByName` does `rosters[name].join('\n')`; if the value was a number
  that throws on click. The store's repair drops that one entry and keeps every
  healthy roster beside it, which is the real difference — the old code lost the
  whole set to one bad entry.

### Task two — adopted `assets/js/gvb-save.js`

Every one of the forty-six direct `localStorage` call sites is gone. `grep -n
localStorage 'Tools/Name Picker.html'` returns three hits and all three are inside
comments. New module: `Tools/name-picker/np-store.js`, imported by relative path so
the Node suite resolves it.

**All twelve key names are unchanged (locked decision #36), and so is every byte on
disk.** That second part took the design work. `gvb-save`'s `save()` does
`JSON.stringify({...state, __v: version})`. Spreading `__v` into an object-valued
key is harmless, but four of these keys hold arrays — `{...['a','b'], __v:1}` is an
object with numeric keys — and five hold bare strings that are not JSON at all
(`np_theme` is literally `medieval`, `np_crazy` is `1`). Either would have silently
discarded a teacher's stored value on first load.

So `boxed()` sits between the slot and storage: `gvb-save` sees `{value: <disk>}`,
`localStorage` sees exactly what the old build wrote. **Adopting the module rewrote
no stored data.** Asserted both ways — the suite checks `np_theme` is still a bare
string and `np_history` still starts with `[`, and in a real browser after a full
28-pick session no key anywhere in storage contains `__v`.

The module also made me keep three representations straight, which was the first
bug I wrote and fixed: **disk** (`'1'`), **app** (`true`), **box**
(`{value:'1'}`). `ok`/`fix` judge the disk form; `decode`/`encode` cross between
disk and app. My first draft had `snapshot()` returning app values and handing them
to validators expecting disk values, which silently dropped four keys from every
export.

**Grouping — the design question the prompt flagged.** Three groups, in a table in
code rather than a comment:

```
roster    np_rosters  np_current  np_lucky              student names
records   np_stats    np_history  np_hof                names + what they did
prefs     np_theme  np_prompts  np_options  np_crazy    no student data
          np_lucky_enabled  np_retro_active  np_retro_unlocked
```

`roster` and `records` are what the erase button clears. `prefs` survives. Putting
`np_lucky` in `roster` is the whole reason the grouping is worth having: it looks
like a preference and it is a student's name.

**`repair`, not `migrate`, for the per-key slots** (locked decision #37). All twelve
keys hold unversioned data on real machines, which reads as version 0, so `migrate`
would fire on every single load. My version of the bug v7 §2 describes — a field
added since shipping, absent from existing data, used somewhere that turns
`undefined` into a failure — is the **Hall of Fame ticker**: `updateHofTicker()`
calls `e.tier.toLowerCase()` on every entry, so one entry without a `tier` threw and
killed the ticker permanently. An entry can arrive without one from a hand-edited
key, a write truncated by a quota error, or a merge from an older backup. `repair`
drops entries with no usable name or tier and fills `tierClass`, `emoji` and `date`
on the rest. `np_options` is the same shape of problem by construction: every
option added later arrives as a fill-in.

`migrate` runs in exactly one place — the export bundle — where it lifts the
hand-rolled `{version: 2, rosters, currentRoster, hallOfFame, …}` backup format onto
the `np_` keys, so a backup a teacher saved months ago still restores. Those files
carry `version: 2` but no `format`, so `gvb-save` reads them as version 0 and hands
the whole object to `migrate`. That is version-specific reshaping, which is what
`migrate` is for.

**`defaults` is a factory on all thirteen slots** (`() => ({value: d.blank()})`),
not because any default is non-literal but because `blank()` for `np_options`
returns a spread of a shared object and a literal would have handed out the same
mutable reference.

**`mountSaveBar` is deliberately not used.** Reasons in *Deliberately not done*.

Export/import go through one extra slot, `key: 'np_bundle'`, given a
**memory-backed storage stub** so it can serialize, download and open a file picker
without ever becoming a fourteenth stored key. Asserted: `np_bundle` never appears
in storage.

### Task three — vendored the three fonts

Two `<link rel="preconnect">` tags and the `css2?family=Bungee&family=Outfit&…`
stylesheet deleted. Nine local `@font-face` rules with `unicode-range`.

**96.9 KB on disk across nine `.woff2` files** (99,192 bytes exactly). What a real
page load actually fetches is smaller, and that is the point:

- **41.5 KB on a normal first paint** — Bungee 400, Outfit 400, Outfit 600. Measured
  from the network log, not estimated.
- 55.3 KB once the settings panel pulls Outfit 700.
- The three Outfit and one Bungee `latin-ext` files (30.1 KB) are fetched only when
  a name on screen has a glyph in that range. An all-ASCII roster never touches
  them. They are vendored because this tool renders student names, and a name is
  the one string on a page you do not get to approximate.
- **Press Start 2P (12.5 KB) is never fetched unless the Konami code is entered.**
  No JS lazy-loading needed — `@font-face` is lazy by definition and nothing applies
  that family until `body.retro-mode` exists. Verified in the network log: three
  page loads requested it zero times, and it appeared immediately after the Konami
  sequence.

Weights: the old hotlink asked for Outfit 400, 600 and **800**, but the page uses
400, 600 and **700** (`.soundboard-btn` and one `<strong>`). Nothing used 800 — CSS
font matching was substituting 800 for the 700 request. I vendored 400/600/700, so
`font-weight:700` now renders as an actual 700. Soundboard buttons are very slightly
lighter than they were; that was an accident before, not a decision.

`Tools/name-picker/fonts/README.md` names sources, versions, designers and the
OFL-1.1 licence, with the three upstream `LICENSE` files copied in beside it.
Also records *why* the hotlink went unnoticed: `prepPage()` fulfils Google Fonts
requests locally from bundled `@fontsource` packages before the blocked-list check
runs, so `page.__blocked` was empty, and the browser suites only drive the seven
games. None of these three families were among the twelve `@fontsource` packages
already in `board-check/node_modules`, so I sourced them with `npm pack`.

`grep -c fonts.googleapis.com 'Tools/Name Picker.html'` → **0**. Same for
`fonts.gstatic.com`. My own comment about the change names "Google's font CDN"
rather than the domain, so that grep stays a meaningful check for the next session.

### Task four — fairness, which was the real bug

**Randomness was not fair, and this is a name picker's entire job.** Two separate
problems.

**1. Every pick was an independent uniform draw.** Over 28 students that repeats the
previous student about once every 28 picks and, after a full 28 picks, leaves
roughly ten of them never called — `1 - (1-1/28)^28 ≈ 0.64` coverage. `np_stats` and
`np_history` existed and were being written on every pick; **nothing ever read them
back**. New `Tools/name-picker/np-pick.js`: `fairPick` draws without replacement
inside a round, refills from the current eligible pool, and excludes the previous
pick from the first draw of a new round so a round boundary cannot produce a
back-to-back repeat.

New **⚖️ Fair rotation** option, **on by default**. Off gives the old independent
draws, and the label says plainly that they will repeat students and skip others.

Making that real needed a structural change: **every mode now chooses the winner
first and animates towards it.** Three of the five let the animation decide — jump
mode took whoever the last random highlight landed on, disappear mode the last card
standing, tournament mode the last spotlight. There was nothing to be fair about in
those modes because nothing chose a winner. Jump and tournament now land their final
highlight on the chosen name and stay off it on the penultimate hop so the last move
is visible; disappear mode eliminates everyone else in a shuffled order.

Multi-pick draws through the same rotation, so picking 4 partners spends 4 turns
rather than sidestepping the round. Seven picks of four cover a class of 28 exactly
once.

**2. `makeGroups()` was not shuffling.** It used
`originalNames.slice().sort(() => Math.random() - 0.5)`. The comparator is
inconsistent, so the result depends on the sort implementation and strongly favours
leaving elements near where they started. Measured over 20,000 shuffles of six
names: the first slot deviated by up to **2,438 from an expected 3,333** — the first
name on the roster landed in group 1 far more often than one in n. Fisher-Yates
deviates by 68. Also switched group dealing so sizes differ by at most one.

The rotation lives **in memory, per page load**, not in storage. A class period is
one page session and it was not worth a fourteenth key. Loading a different roster
or pressing Reset Board starts a clean round; marking a student absent mid-period
does not reset anybody's turn.

### Also fixed: none of the options persisted

Only the theme, Crazy mode, the retro unlock and the lucky-student switch survived a
reload. Sound, confetti, dramatic pause, cold-call, rarity, sudden death, the Hall of
Fame ticker, multi-pick count, group count, mode and speed all reset every time the
page opened — noticeable on the second period of the day. `np_lucky_enabled` existing
at all is evidence somebody had already hit this once and solved it for one switch.

All of them now live in **one new key, `np_options`**, rather than eleven. It is the
only key I added, and anything added later arrives through `repair` as a fill-in.

### Accessibility, projector and mobile

- **`@media (prefers-reduced-motion: reduce)`** — nine rules. A picker animates by
  definition, so this keeps the pick legible and drops what moves the whole screen:
  shakes, the background pulse, the chaos particle stream, confetti, fireworks,
  lightning, the scrolling ticker. The highlight and winner still scale up, they
  just stop lurching.
- **`:focus-visible`** outlines on every control. There were none.
- **Mobile at 375×812.** No horizontal overflow, all 28 name cards inside the
  viewport, the panel goes full-width, the tab row wraps to two lines, PICK A NAME
  is full-width and 55px tall. Header and footer controls measured 31–35px tall,
  which is a miss for a thumb reaching up mid-lesson; they are 40px minimum now.

### Files

| Path | What |
| --- | --- |
| `Tools/Name Picker.html` | rewired: module script, no direct storage, fair picking, Data tab, vendored fonts, reduced motion, mobile |
| `Tools/name-picker/np-store.js` | new — thirteen keys on `gvb-save`, grouped |
| `Tools/name-picker/np-pick.js` | new — fair rotation, Fisher-Yates, groups |
| `Tools/name-picker/test/smoke.mjs` | new — 207 assertions, plain Node |
| `Tools/name-picker/test/blocked-storage.html` | new — the case Node cannot reach |
| `Tools/name-picker/fonts/` | new — nine woff2 (96.9 KB), README, three licences |
| `Tools/name-picker/README.md` | new |

The page **stayed at `Tools/Name Picker.html`**, space and all, so
`Tools/Name%20Picker.html` and the board's `href` both still resolve. **No
shared-file `href` request is needed.** Reasoning in *Deliberately not done*.

### Every storage key, and what happened to it

| Key | Group | Before | Now |
| --- | --- | --- | --- |
| `np_rosters` | roster | 9 sites, 4 of them unguarded `JSON.parse` | store slot; bad blob refused, bad entry dropped, rest kept |
| `np_current` | roster | 3 sites, array | store slot; array on disk unchanged |
| `np_lucky` | roster | 3 sites | store slot; **reclassified as student data** |
| `np_stats` | records | 5 sites, `try/catch` | store slot; non-numeric counts coerced to 0, no more `NaN%` bar widths |
| `np_history` | records | 5 sites, `try/catch` | store slot; unusable rows dropped, `time` never `undefined` |
| `np_hof` | records | 5 sites, `try/catch` | store slot; **entry with no `tier` no longer kills the ticker** |
| `np_prompts` | prefs | 5 sites, `try/catch` | store slot |
| `np_theme` | prefs | 3 sites, bare string | store slot; **still a bare string on disk** |
| `np_crazy` | prefs | 2 sites, `'1'`/`'0'` | store slot; still `'1'`/`'0'` on disk |
| `np_lucky_enabled` | prefs | 3 sites | store slot; unchanged on disk |
| `np_retro_active` | prefs | 2 sites | store slot; unchanged on disk |
| `np_retro_unlocked` | prefs | 2 sites | store slot; **survives a student-data erase** |
| `np_options` | prefs | did not exist | **new.** Eleven options that never persisted, in one key |

Vendored font total: **96.9 KB** on disk, **41.5 KB** on a typical first paint.

---

## What I verified

### `node Tools/name-picker/test/smoke.mjs` → 207 passed, 0 failed

```
name-picker smoke

  fair rotation over 280 picks:  min 10, max 10, spread 0
  uniform draws over 280 picks:  min 6, max 16, spread 10
  first-pick uniformity over 28000 rounds: expected 1000, worst deviation 67
  shuffle bias, position 1 of 6 over 20000 shuffles: comparator worst 2437.7, Fisher-Yates worst 67.7 (expected 3333.3)

name-picker: 207 passed, 0 failed
```

Seeded LCG rather than `Math.random()`, so a distribution assertion cannot pass or
fail on luck (locked decision #40).

### The corrupt-data case, before and after (locked decision #34)

I put the bug back rather than trusting the fix. `git show HEAD:"Tools/Name
Picker.html"` into a temp copy, served it, seeded `np_current` with three valid
names and `np_rosters` with a truncated `{"Period 3":["Aiden Alvarez"`, reloaded.

**Before** — evaluated in the page:

```
JSON.parse(localStorage.getItem('np_rosters')||'{}')
  → SyntaxError: Expected ',' or ']' after array element in JSON at position …
#rosterList.innerHTML   →  ""      (updateRosterUI died mid-function)
#countDisplay.textContent → ""     (the statement AFTER it never ran)
#statsList.innerHTML    →  ""
names.length            →  3       (so it was not an empty-roster case)
```

The empty `#countDisplay` with `names.length === 3` is the clean proof: the load
handler aborted inside `updateRosterUI()` and everything after it was skipped. Temp
copy deleted.

**After** — same corrupt value still on disk, unmodified:

```
localStorage.getItem('np_rosters')  →  {"Period 3":["Aiden Alvarez"   (untouched)
#rosterList.innerHTML  →  <p class="muted-text">No saved rosters yet</p>
#countDisplay          →  "3 names in pool"
.name-card count       →  3
```

The bad value is **refused, not rewritten** — the store does not overwrite data it
cannot read, so nothing is destroyed on the way past. The suite also drives five
more shapes (`undefined`, empty string, `[]`, `42`, `"a string"`, `null`) and the
mixed case where one roster is a number and another is a valid list: the number is
dropped, the list survives.

### Storage blocked → `Tools/name-picker/test/blocked-storage.html`, 10 of 10 pass

Chrome's site settings cannot be driven from a script, so the fixture installs the
real failure — a throwing getter on the `localStorage` **property**, which is what
Chrome actually does, rather than a failing `setItem`. Installed before the module
imports.

```
PASS  the localStorage property really does throw when touched   1 access threw
PASS  createStore() survives it
PASS  the store reports memoryOnly
PASS  reading a key does not throw
PASS  a blocked read returns the default
PASS  writing a key does not throw
PASS  the write is readable back from memory
PASS  defaults come through for every key                        13 keys
PASS  snapshot, census and both erase paths all run
PASS  export still serializes, so a roster can be rescued to a file
All 10 checks passed — the tool runs with storage blocked.
```

The page does not white-screen and the Data tab turns red to say nothing will
survive the tab closing. The Node suite covers the same ground with an injected
throwing stub, which is how I found the `gvb-save` gap below.

### Export / import round trip

Verified twice: in Node, and end-to-end in a real browser.

**In the browser.** The export side needs no engine knowledge, per v7 §3 — hook
`URL.createObjectURL` to read the exact bytes a download would have written and
neuter the anchor click so no file is saved. Seeded 8 names through the real UI,
saved a roster, then clicked the real **Save a Backup File** button:

```
confirm text   "Save a backup file?  It will contain 8 student names across 1
                roster, plus pick counts and history, in plain text.
                File name: name-picker-roster-backup-2026-07-29.json
                Save it somewhere you would be comfortable keeping a printed
                class list."
a.download     name-picker-roster-backup-2026-07-29.json
blob type      application/json
bytes          1153
envelope       format gvb-save · game name-picker · version 3 · savedAt present
state keys     all 13
np_rosters     {"Period 5 Honors": [8 names, in order]}
"__v" in file  false
```

Then erased through the real **Erase All Student Data** button (`localStorage` down
to `['np_theme']`, no name anywhere), and fed those exact captured bytes back as a
real `File` through `store.bundle.importFromFile` — the same path `promptImport()`
uses, minus the OS dialog these tools cannot answer:

```
importFromFile error   null
keys written           13
roster back            {"Period 5 Honors": [all 8 names, same order]}
```

A foreign save file through the same call is refused:
`"That is not a valid name-picker save."`

Finally reloaded the page to prove the tool itself picks the restored data up rather
than just localStorage looking right:

```
names input      8 lines, first "Aiden Alvarez"
roster list      "Period 5 Honors (8)"
count display    "8 names in pool"
census           1 saved roster, 8 student names
console errors   none
```

**In Node**, asserted:

- envelope is `format: "gvb-save"`, `game: "name-picker"`, `version: 3`, stamped
- filename is `name-picker-roster-backup-2026-07-28.json`
- `clearAll()`, then import → all 13 keys back, 3 rosters, 24 names in Period 3,
  pick counts, theme, Hall of Fame tier, retro unlock
- rubbish refused: non-JSON, a bare array, and a file with `game: "fourth-quarter"`
  all return `null` rather than half-loading
- merge mode: rosters add, pick counts sum (5 + 3 = 8), a teacher's own prompts are
  not overwritten, settings are not reached into
- **a real `version: 2` backup file still imports** and lands on the `np_` keys

### Fair picking, end to end in a real browser

Not just the module — the actual page, real clicks. Loaded a class of 28, set
multi-pick to 7, ran four picks through the UI, then read `np_history` off disk:

```
picks: 28   distinct: 28   duplicates: []   backToBack: []
```

Every student in the class called exactly once before anyone twice, no student
called twice in a row, and `np_stats` came back with all 28 students on a count of 1.

### The on-disk format did not change

After that full session in a real browser:

```
keys           np_current  np_history  np_options  np_rosters  np_stats  np_theme
__v anywhere   []                       ← nothing leaked a version stamp
np_history     starts with "["          ← still an array, not an object
np_stats       starts with "{"
np_theme       "default"                ← still a bare string, not JSON
```

### Erase, in a real browser

```
confirm text: "Erase all student data from this browser?  This removes 28 student
names, 1 roster, 28 sets of pick counts, 28 history entries and 0 Hall of Fame
entries.  Your themes, task prompts, options and anything you have unlocked are
kept.  This cannot be undone. If you have not saved a backup file, cancel and do
that first."

after:  keys = ['np_options','np_theme']
        /Rosa Reyes|Aiden Alvarez|Zoe Zaman/ across all of storage  →  null
        census = 0 rosters, 0 names, 0 counts, 0 history, 0 hall of fame
        board = 0 cards, names input empty
```

The suite additionally asserts every one of the 28 fabricated names is absent from
a dump of storage after `clearStudentData()`, and that each non-`prefs` key is
`null` — removed, not emptied.

### Fonts

Network log for a real page load, three separate loads:

```
GET /Tools/name-picker/fonts/bungee-latin-400-normal.woff2   200
GET /Tools/name-picker/fonts/outfit-latin-400-normal.woff2   200
GET /Tools/name-picker/fonts/outfit-latin-600-normal.woff2   200
GET /Tools/name-picker/fonts/outfit-latin-700-normal.woff2   200   (panel opened)
```

Nothing else. **No request left localhost.** No `latin-ext` file was requested at
all (ASCII roster), and `press-start-2p-latin-400-normal.woff2` appeared **only**
after I dispatched the Konami sequence:

```
before konami:  document.fonts loaded = [Bungee 400, Outfit 400, Outfit 600]
                press-start-2p requested: never
after konami:   body.retro-mode = true, unlock banner shown,
                np_retro_unlocked = "1", np_retro_active = "1",
                .title font-family = "Press Start 2P", monospace
                GET press-start-2p-latin-400-normal.woff2  200
```

`grep -c fonts.googleapis.com` → 0. `grep -c fonts.gstatic.com` → 0.
`page.__blocked` is **not** what I used, per the prompt.

### Mobile, 375×812

```
horizontal overflow            0px
body scrollable sideways       false
name cards rendered            28
cards outside the viewport     0
PICK A NAME                    355×55, full width
smallest header/footer control 40px  (was 31px — fixed this session)
settings panel                 full viewport width
tab row                        wraps to two rows
```

### Reduced motion

The media block is present and matched 9 rules, targeting the right things
(`*/::before/::after`, `.shake-active*`, `body.crazy-active, body.sudden-death`, the
particle and confetti containers, the ticker, the highlight and winner states). I
could **not** force `prefers-reduced-motion: reduce` on — the browser tools here
have no emulation for it — so this is a static check that the rules exist and
select correctly, not a rendered before/after. Flagging it rather than claiming
more than I did.

### Repo-wide

```
node assets/js/gvb-save.test.mjs   →  39 passed, 0 failed   (file untouched)
npm run check                      →  298 units checked, 0 broken
                                      0 collisions, tightest vertical gap 7.1px
npm run social:check               →  23 notices · 23 already current · 0 out of date
```

Two notes on those numbers. **The unit count is 298, not the 235 the prompt
expects** — the baseline moved under me while I worked, because roughly twenty other
sessions are adding files to this repo right now. I watched it go 292 → 298 between
two of my own runs. My files account for **+5** of it: three `.mjs`/`.js` modules
plus the two inline scripts in `blocked-storage.html`. 0 broken is the number that
matters.

**`social:check` showed 2 DRIFT mid-session**, on `Tools/Schedule Browser as of
260715.html` and `Tools/Schedule Visualizer and Browser Generator v60.html` — prompt
19's files, not mine. Both were clean by my final run; another thread fixed them. My
page was in the "already current" set throughout. I did not touch anything inside
the `gvb:social` markers.

`npm run games`, `npm run play` and `npm run previews` were **not** run. They open
real visible browser windows, other threads may be using them, and none of them
drives the tools anyway.

---

## Shared-file requests

Two, both in `assets/js/gvb-save.js`. Neither is urgent; the Name Picker works
around both locally.

### 1. `load()` does not guard `store.getItem` — one line

`save()` wraps `setItem` in a `try`. `reset()` wraps `removeItem`. `load()` wraps
`JSON.parse` but calls `getItem` bare:

```js
  function load() {
    if (!store) return null;
    const raw = store.getItem(key);      // ← the one unguarded storage touch
    if (!raw) return null;
```

So a storage object whose `getItem` throws propagates straight out through
`load()`, past the "returns `null`, never throws" contract the README states. Its
own `defaultStorage()` hides this — a browser that blocks storage fails the
`setItem` probe and gets swapped for a memory stub before any read happens — but an
**injected** storage gets no such treatment, and injecting one is exactly what the
tests do. I hit it as a hard crash in my suite:

```
Error: The operation is insecure.
    at Object.getItem (test/smoke.mjs:262)
    at Object.load (assets/js/gvb-save.js:137)
```

Applicable blind:

```js
  function load() {
    if (!store) return null;
    let raw;
    try { raw = store.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
```

Worked around in `np-store.js`'s `boxed()`, which try/catches `getItem`,
`removeItem` and the `__memoryOnly` getter. Six projects read `gvb-save.js`, so I
did not edit it.

**Round 2 update: applied.** The current `gvb-save.js` already has this exact guard
(confirmed by reading the file, not the old note) — this request is closed.

### 2. `mountSaveBar` cannot set the export filename

`mountSaveBar`'s export button calls `slot.exportToFile(getState())` with no name,
so it always gets `slot.filename()` — `<game>-save-YYYY-MM-DD.json`. There is no
way to override it from the mount call, even though `exportToFile(state, name)`
accepts one.

That is why this tool does not use the save bar. Its export file is a plain-text
list of children's names, and `name-picker-save-2026-07-28.json` does not say so
where it matters — in a Downloads folder, six months later, on a shared machine.
`name-picker-roster-backup-2026-07-28.json` does.

Applicable blind — add a `filename` handler alongside `getState`:

```js
  const {
    getState, setState, onMessage, confirmReset = true,
    buttons = ["export", "import", "reset"],
    filename = null,                    // () => string, or a string
  } = handlers;
```

and in the export button:

```js
    export: () => button("export", "Export save", "Download this save as a file", () => {
      const want = typeof filename === "function" ? filename() : filename;
      const name = slot.exportToFile(getState(), want || slot.filename());
      say("Saved to " + name);
    }),
```

Worked around by keeping the tool's own two buttons wired to
`store.bundle.exportToFile(snapshot, name)` and `store.bundle.promptImport()`. No
`reset` button is mounted anywhere, per the prompt's warning — this tool has two
erase controls of its own and a third would be the exact footgun `buttons` exists to
prevent.

**Round 2 update: this tool still doesn't need the save bar** (its own two buttons
still do the job), so whether this landed elsewhere wasn't re-checked this round.

### Not a request, but worth recording

`gvb-save`'s `save()` writes `JSON.stringify({...state, __v: version})`, which means
**a slot cannot hold an array or a scalar**. Every current adopter happens to store
an object, so nothing has hit it. This tool has nine keys that are arrays or bare
strings, and `boxed()` in `np-store.js` is the workaround: box as `{value: …}` for
the module, unbox on write so the disk format is untouched. If a second project
needs the same thing, that adapter is the piece to lift into the module — as a
`box: true` option, say — rather than writing it twice. I am not requesting it yet
on one data point.

---

## Deliberately not done

**The easter eggs, left alone once I knew what they do.** Four of the twelve keys
looked like cruft and none of it is:

- `np_retro_unlocked` / `np_retro_active` — the **Konami code** (`↑↑↓↓←→←→BA`,
  detected globally, even inside text inputs) unlocks a full retro arcade theme:
  scanlines, a vignette, magenta-on-cyan, Press Start 2P everywhere, and an
  ACHIEVEMENT UNLOCKED banner. Unlocked and active are separate keys so the toggle
  works without re-earning it. The Options tab has a deliberately vague hint:
  *"🕹️ Secret: try the classic cheat code..."* This is the same family as locked
  decision #7's Anathema Archive egg. Left exactly as it was, except that the
  unlock now **survives an erase of student data** — it is not student data, and
  making a teacher re-earn it to clear a class list would be daft.
- `np_crazy` — not an egg, just persistence for the LET'S GO CRAZY toggle.
- `np_lucky` / `np_lucky_enabled` — "Lucky Student of the Day". One student per day
  gets reweighted rarity rolls (`[25,25,22,15,8,5]` instead of
  `[50,25,14,7,3,1]`) and a ⭐ on their card. It only touches which *rarity banner*
  shows, never who gets picked, so it does not fight fair rotation. Reclassified as
  student data because it stores a name; otherwise untouched.

**Did not rename the file or split it further.** 1,700 lines with a store and a
picker extracted is defensible now, and the prompt is right that a full split is
too. I did not, and it was the biggest call of the session: renaming
`Tools/Name Picker.html` breaks `/Tools/Name%20Picker.html` for anyone who has
bookmarked or projected it, and makes the board `href` a shared-file request that
has to land in the same commit as my rename or the card 404s. With roughly twenty
other sessions in this repo, a two-file atomic change across an ownership boundary
is the thing most likely to go wrong. **The URL still works and the board needs no
edit.** Losing the space is a good idea for a session that also owns `index.html`.

**Did not persist the fair-rotation round.** It is in memory, so a mid-period reload
starts the round over. Storing it needs a fourteenth key, and the honest reason not
to is that I do not know what a teacher wants: is a reload the same period, or the
next one? Getting it wrong is worse than restarting, because a stored round that
outlives the period silently refuses to call the students who "already had a turn"
yesterday.

**Did not fix `np_history` growing forever.** The History tab says "All names picked
this session" and the info banner says "No picks yet today", but the key is never
cleared, so it accumulates across days and the tab shows last week's picks. `repair`
caps it at 500 entries, so it is bounded rather than unbounded now. The actual fix is
a policy decision — clear on the first pick of a new day, or keep it and relabel the
tab honestly — and it belongs with whoever decides what "session" means here. Same
shape as v7 §9's Faire Weekend report-phase question.

**Did not add a "who's due" display.** `leastPicked()` is written and tested in
`np-pick.js` and nothing calls it. Fair rotation made it much less necessary; the
Stats tab's existing "Least Picked" sort covers the same need. Left as a two-line
wiring job for whoever wants it in the footer.

**Did not touch the rarity system, soundboard, tournament mode, sudden death or
achievements.** All working, none of them storage or fairness.

---

## Next session (round 1's own list — see round 2's list above for what's current)

Ordered by value per effort.

1. ~~**Decide `np_history`'s day boundary**~~ — done in round 2, above.
2. **Rename `Name Picker.html` to `name-picker.html` and update the board `href`**,
   from a session that owns `index.html` (prompt 21's territory). Both edits in one
   commit. My folder is already `Tools/name-picker/` so the pairing is done; this is
   just the page and the link.
3. ~~**The two `gvb-save` requests above**~~ — both applied by prompt 21; confirmed
   in round 2.
4. ~~**A browser suite for the tools.**~~ — done in round 2, above.
5. **Four pages were still hotlinking Google Fonts when I finished**, so v7 §5's
   "zero offsite requests site-wide" is still wrong — but by much less than the
   prompt says. It told me fifteen pages; a grep at the end of my session found
   **four**, because other threads vendored theirs while I worked:

   ```
   ./404.html                          ← the board's (prompt 21)
   ./index.html                        ← the board's (prompt 21)
   ./Projects/Ren-Faire-Claude/index.html
   ./Projects/daredevil_r4.html
   ```

   Moving target with this many sessions running, so re-grep rather than trusting
   that list. `grep -rl fonts.googleapis.com --include=*.html . | grep -v node_modules`
   is the check; `page.__blocked` is not, because `prepPage()` fulfils those
   requests locally.
6. **Persist the rotation, if a teacher says they want it** (see above). Needs a
   question answered, not code.
