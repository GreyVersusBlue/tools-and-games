# 18 — Name Picker

You are working on the Name Picker, a classroom tool on greyversusblue.com under the board's "Town
Services" section. It picks students at random from a roster. Round 1 gave it a full data-safety
pass, moved all thirteen storage keys onto the shared save module, and fixed a real fairness bug.
Round 2 built the browser suite round 1 flagged as the top gap and decided/shipped the history
day-boundary policy. **Round 3 fixed `test/browser.mjs`'s own engine-mismatch bug and found that
the rename deadlock (see "Questions for Devon") now targets a different file than previously
thought.** This prompt is self-contained.

## Questions for Devon

- **The `Tools/Name Picker.html` → `name-picker.html` rename has been raised three rounds
  running, and it's now a structural deadlock, not just repeated caution.** The board's Town
  Services section no longer links to this file directly — it links to `newindex.html` (a new
  Devon-authored landing page, owned by prompt 22), which itself holds the real
  `href="Tools/Name%20Picker.html"` link. So the same-commit change a rename needs is now one line
  in `newindex.html`, not `index.html` — and no single prompt owns both that line and this file.
  Even prompt 22 (which owns `newindex.html`) has explicitly declined to do the rename itself,
  since the file being renamed isn't its own. Should Devon authorize a one-time cross-boundary
  exception (either this prompt touches `newindex.html`'s one line, or prompt 22 does the rename),
  or is "leave it forever" the actual answer, so it stops recurring as a carried-over item every
  round?

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Name Picker.html` (2,052 lines)
- `Tools/name-picker/` — `np-store.js`, `np-pick.js`, `test/smoke.mjs`, `test/browser.mjs` (new,
  round 2), `test/blocked-storage.html`, `fonts/`, `README.md`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Other Claude sessions may be working on other projects in this same repo at the
same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 22. Its Town Services section links to `newindex.html`, not this file directly, as of round 2/3 — see below. |
| `newindex.html` | Prompt 22's file. Holds the real `href="Tools/Name%20Picker.html"` link now — see "Questions for Devon." |
| Every other file in `Tools/` | Prompts 16, 17, 19, 20. `Tools/board-check/` is prompt 22's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). The page deliberately **stayed** at
`Tools/Name Picker.html`, space and all — a rename needs the linking `href` changed in the same
commit, and that link now lives in `newindex.html` (prompt 22's file), not `index.html` — see
"Questions for Devon."

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section, which is not boilerplate here.
2. **`Claude Prompts/notes/18-name-picker-notes.md`** — round 3's session: fixed
   `test/browser.mjs`'s own engine-mismatch bug, found the rename question now targets
   `newindex.html`. Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/18-name-picker-notes.md` — the 44-check browser suite,
   and the `np_history` day-boundary decision (clears on the first pick of a new calendar day, not
   on load and not never). Round 1's are at
   `Claude Prompts/archive/round-1/notes/18-name-picker-notes.md` — the full data-safety pass, the
   thirteen-key `gvb-save.js` adoption, and the fairness fix.
3. `assets/js/gvb-save.js` and `assets/js/README.md`.
4. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58).
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

A mature, well-tested tool. **2,052 lines** in `Tools/Name Picker.html`, plus `Tools/name-picker/`:
`np-store.js`, `np-pick.js`, `test/smoke.mjs` (**213 assertions**), `test/browser.mjs` (**44
checks, engine-mismatch bug fixed this round, see below**), `test/blocked-storage.html` (10
assertions), `fonts/`, `README.md`.

**`np-store.js`'s own header comment has a stale count, worth a one-line fix**: it says "the Name
Picker's **twelve** storage keys" / "all **twelve**," but the real, correct count (confirmed by the
`KEYS` array, and stated correctly everywhere else — the README, this prompt, the notes) is
**thirteen**. Minor, not urgent.

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

**The engine-mismatch bug in this project's own test file is fixed, round 3.** `test/browser.mjs`
now imports `waitFor`/`textContent` from `Tools/board-check/drive.mjs` (`waitFor` at line 164, over
a dozen `textContent(page, ...)` call sites), a mechanical swap from the bare
Playwright-shaped calls. 44/44 passing.

## Your task

Round 3 fixed the engine-mismatch bug. What's left:

1. **The rename deadlock — see "Questions for Devon."** Waiting on Devon, not code.
2. **The stale "twelve keys" comment in `np-store.js`** (see "What is actually here") — a one-line
   fix, low urgency.
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
- `node "Tools/name-picker/test/browser.mjs"` → **44 checks, 0 failed**, engine-mismatch bug fixed
  as of this round.
- `Tools/name-picker/test/blocked-storage.html` → **10 of 10 pass**, needs a real browser.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 9.1px.** (The unit count moves every round as
  files are added elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round).
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed**, this page included.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/18-name-picker-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v*.md` gets
assembled from all twenty-two of them each round.

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
