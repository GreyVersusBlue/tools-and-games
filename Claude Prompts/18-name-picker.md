# 18 — Name Picker

You are working on the Name Picker, a classroom tool on greyversusblue.com under the board's "Town
Services" section. It picks students at random from a roster. Round 1 gave it a full data-safety
pass, moved all thirteen storage keys onto the shared save module, and fixed a real fairness bug.
Round 2 built the browser suite round 1 flagged as the top gap and decided/shipped the history
day-boundary policy. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Name Picker.html` (2,070 lines)
- `Tools/name-picker/` — `np-store.js`, `np-pick.js`, `test/smoke.mjs`, `test/browser.mjs` (new,
  round 2), `test/blocked-storage.html`, `fonts/`, `README.md`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Other Claude sessions may be working on other projects in this same repo at the
same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. The board `href` still points at `Tools/Name%20Picker.html`, space and all. |
| Every other file in `Tools/` | Prompts 16, 17, 19, 20. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). The page deliberately **stayed** at
`Tools/Name Picker.html`, space and all — a rename needs the board `href` changed in the same
commit, and that's prompt 21's file, not a solo run of this prompt's to touch.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section, which is not boilerplate here.
2. **`Claude Prompts/notes/18-name-picker-notes.md`** — round 2's session: the 44-check browser
   suite, and the `np_history` day-boundary decision (clears on the first pick of a new calendar
   day, not on load and not never). Round 1's notes are archived at
   `Claude Prompts/archive/round-1/notes/18-name-picker-notes.md` — the full data-safety pass, the
   thirteen-key `gvb-save.js` adoption, and the fairness fix.
3. `assets/js/gvb-save.js` and `assets/js/README.md`.
4. `gvb-site-handoff-v9.md` §3 (a bug **found in your own `test/browser.mjs`** this refresh, not
   fixed there — see below) and §10 (locked decisions #51-53).
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
6. Locked decision #7 in v1 §3 — the site's easter-egg pattern.

## Student data: this is the part that matters

**This tool stores student names in `localStorage` on whatever machine it runs on.** Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint.
- **Do not put real student names in the repo.** Checked back to the original commit, none found.
  Any fixture or test data you add is fabricated.
- **A visible, unmissable "clear all data" control exists**: the 🔒 Data tab's "Erase All Student
  Data" button. Keep the `roster`/`records`/`prefs` group split (`GROUPS` in `np-store.js`) if you
  touch this area.
- **The UI says in plain language what is stored and where.** If you add a fourteenth key, it needs
  a row in the Data tab's table and a group in `GROUPS`.

## What is actually here

A mature, well-tested tool. **2,070 lines** in `Tools/Name Picker.html`, plus `Tools/name-picker/`:
`np-store.js`, `np-pick.js`, `test/smoke.mjs` (**213 assertions**, up from 207), `test/browser.mjs`
(**new this round, 44 checks**), `test/blocked-storage.html` (10 assertions), `fonts/`, `README.md`.

**A real browser suite exists now** (`Tools/name-picker/test/browser.mjs`, own folder, not
`Tools/board-check/`): loads 28 names, saves a roster, four rounds of multi-pick through real
clicks, export (hooked `URL.createObjectURL`, neutered anchor click), erase, a real file-chooser
import, and two distinct corrupt-roster shapes in separate browser contexts.

**`np_history` now clears on the first pick of a new calendar day**, making "No picks yet today"
literally true for the first time. Entries carry a `date` field; the History tab's banner reads
"All names picked today" (was "this session," which was also never true — a reload didn't clear
it). Legacy entries with no `date` just never trigger the clear; they still load.

**Thirteen `np_` keys, all on `assets/js/gvb-save.js`**, unchanged from round 1.

**The fairness bug is fixed** (round 1) — fair rotation by default, real Fisher-Yates shuffle.

**Zero offsite requests.**

**A real, newly-found bug in this project's own test file, not previously flagged: `test/browser.mjs`
has the same engine-mismatch problem that broke `npm run games` repo-wide this round, in two
different forms, neither covered by prompt 21's fix (that fix only touched `Tools/board-check/**`,
not this project-owned file).** Confirmed by direct run this refresh:
- `page.waitForFunction(() => window.__npExports.length > 0, null, { timeout: 5000 })` at line 163
  — the exact Playwright-vs-puppeteer-core shape mismatch. Throws under this environment's
  `puppeteer-core`.
- Multiple `page.textContent(selector)` calls throughout (lines 102, 108, 113, 195, 201, 210, 213,
  240, 242, 264, and more) — a Playwright-only convenience method `puppeteer-core` never had.
  Confirmed by direct run: `TypeError: page.textContent is not a function`.

Both are fixable the same way every other project's copy of this bug was fixed this round:
`Tools/board-check/drive.mjs` exports engine-aware `waitFor(page, fn, opts)` and
`textContent(page, sel)` — import them and do a mechanical swap. See task one.

## Your task

Round 2 closed both of the previous round's tasks. What's left:

1. **Fix `test/browser.mjs`'s own copy of the engine-mismatch bug** (see above) — the same class of
   bug that broke `npm run games` for every project this round, in a file that's yours and that
   prompt 21's fix explicitly didn't reach (project-owned test files are out of its boundary).
   Import `waitFor`/`textContent` from `Tools/board-check/drive.mjs` and swap the calls. Verify per
   locked decision #34.
2. **Not this project's job, flag it instead: renaming `Tools/Name Picker.html` to
   `name-picker.html`.** Round 2 considered and declined this again — still not this thread's call
   to make unprompted, still needs a session that also owns `index.html`. Write the exact
   before/after `href` into Shared-file requests if you think it's worth doing; don't touch
   `index.html` yourself.
3. If there's session left over:
   - **The three levels / multiple rosters under real use.** `np_rosters` handles it structurally;
     neither round's browser suite has exercised more than one roster at a time.
   - **Mobile and accessibility re-verification.** Round 1 checked 375×812 and
     `prefers-reduced-motion`; neither round since has touched CSS or layout, so nothing here could
     have regressed, but a fresh check is still due at some point.
   - **`leastPicked()`** — written and tested, still unused. Two-line wiring job if anyone wants a
     "who's due" display.
   - **The rotation-persistence question** — still needs an answer to "is a reload the same period
     or the next one," not code. Nobody's asked yet.

## Verification

- `node "Tools/name-picker/test/smoke.mjs"` → **213 passed, 0 failed.**
- `node "Tools/name-picker/test/browser.mjs"` → currently **aborts** on the bug in task one above.
  Fix that first, then expect 44 checks, 0 failed (confirmed twice in round 2, not flaky on the
  timer-driven multi-pick animation).
- `Tools/name-picker/test/blocked-storage.html` → **10 of 10 pass**, needs a real browser.
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 3.5px.**
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression).
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed**, this page included.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/18-name-picker-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v*.md` gets
assembled from all twenty-one of them each round.

Use these headings:

```
# Name Picker — session notes

## Student data
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Answer it directly:** whether any
real student names were in the file, what the tool now stores and where, whether a user can clear
all of it in one action, and whether the UI tells them the truth about it.

- **What changed** — files touched and why, with paths.
- **What I verified** — actual commands, actual output. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you're recommending the rename. Any new `gvb-save.js`
  gap. Applicable blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
