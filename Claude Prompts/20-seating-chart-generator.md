# 20 — Seating Chart Generator

You are working on the Seating Chart Generator, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It builds classroom seating charts. **Round 3 fixed the rotated
desk labels (they now counter-rotate so text stays upright) and this project's own
Playwright-only test bugs (three of them, one beyond what was originally flagged).** This is the
first refresh with genuinely nothing carried over from this project's own work. This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Seating Chart Generator.html` (1,444 lines)
- `Tools/seating-chart/` — `seating.mjs` (pure logic, no DOM), `test/smoke-seating.mjs`,
  `test/drive-seating.mjs`, `fonts/`, `README.md`, `.gitignore`, `shots/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Other Claude sessions may be working on other projects in this same repo, and
this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 22. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 19. `Tools/board-check/` is prompt 22's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Your filename contains spaces
(`Tools/Seating%20Chart%20Generator.html`). If you rename it, verify the rename landed in git and
the board `href` becomes a Shared-file request.

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section.
2. **`Claude Prompts/notes/20-seating-chart-generator-notes.md`** — round 3's session: the rotated
   desk-label counter-rotation fix and the three Playwright-only bugs in this project's own
   `test/drive-seating.mjs`. Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/20-seating-chart-generator-notes.md` — room zones with a
   real solver constraint, four layout presets, print-all-sections, and its own test-assertion
   inversion. Round 1's are at
   `Claude Prompts/archive/round-1/notes/20-seating-chart-generator-notes.md` — the original save
   adoption, the rewritten print stylesheet, keyboard operation, the two solver bugs.
3. `assets/js/gvb-save.js` and `assets/js/README.md`.
4. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58).
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."

## Student data: this is the part that matters

**A seating chart is a list of student names mapped to physical positions in a room.** That is an
education record under FERPA, and it is also the kind of document that gets printed and left on a
desk.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint.
- **Do not put real student names in the repo.** Checked again this round from scratch, still clean
  — only historical-figure placeholders. Check again anyway before you touch anything.
- **A visible "clear all data" control exists.** "Erase saved data" in the toolbar.
- **Zone tagging holds to the same print bar as the flag and notes field** — a desk's zone badge is
  hidden on the printed page, same reasoning as the gold flag outline: the tool needs to know where
  a student sits; whoever picks the sheet off a desk doesn't.

## What is actually here

1,437 lines, one file. Title: "Seating Chart Generator." Tagged with the school stamp under Town
Services.

**Persistence, through `assets/js/gvb-save.js`.** Storage key `seating-chart-v1`, schema version
still 1 — this round's additions are new fields on the existing shape, filled in by `repair`
(locked decision #37), not a version bump.

**Room zones exist, with a real solver constraint.** `ZONES` is three fixed entries (front row, by
the door, back corner). A desk carries a `zone` field, a student carries `zoneNeed`; both are `''`
unless set by hand — **deliberately not inferred from x/y coordinates**, since a desk's position
doesn't say what it means in a horseshoe or a pod layout, which is exactly where the flag matters
most. `onePass` filters a student's candidate desks to the matching zone before the existing
keep-apart/put-together filters run.

**Four layout presets exist**: `horseshoeDesks`, `podsDesks`, `doubleRowDesks`, `labBenchDesks`.
Each returns a desk array in the same shape `gridDesks`/`rowDesks` already produce, clamped inside
the room. Zone tagging is deliberately not part of any preset — guessing a zone from a preset's own
coordinates would be exactly the guess the room model exists to avoid.

**Print all sections in one job.** A new toolbar button builds a static, independently-scaled copy
of every section's floor into one holder, one page per section with `page-break-after: always`.
Falls back to the existing single-print path below two sections.

**`Tools/seating-chart/test/smoke-seating.mjs`, 153 assertions, all passing.**
`test/drive-seating.mjs`, **111 checks, all passing** — fixed this round, see below.

**Rotated desk labels counter-rotate now**, so text stays upright regardless of the desk's own
rotation — fixed at both call sites (`renderFloor()` and `buildSectionPrintHTML()`) via a
`rotate(${-d.rot}deg)` counter-transform. If a future preset or render path adds a new place a desk
gets drawn, this fix needs copying there too.

**All three Playwright-only bugs in this project's own `test/drive-seating.mjs` are fixed** — one
more than originally flagged. `textContent` now imports from `Tools/board-check/drive.mjs`; a local
`isHidden(page, sel)` helper uses `$eval`/`offsetParent` instead of the Playwright-only
`page.isHidden()`; and a third, previously unflagged instance — `page.addInitScript()`, also
Playwright-only — now branches to `page.evaluateOnNewDocument()` under `puppeteer-core` via a local
helper. All three confirmed via direct code read, not just a clean test run.

## Your task

**This is the first refresh with nothing carried over from this project's own work.** If your own
pass turns up something new, add it here. The two items round 1 raised and every round since
re-verified without acting on (whether anyone rotates desks enough to matter; the four pages that
used to hotlink Google Fonts, none of them this project's own files) are stale carryovers from
other projects' work, not this one's — check `gvb-site-handoff-v10.md`'s backlog table rather than
this file if you want their current status.

## Verification

- `node Tools/seating-chart/test/smoke-seating.mjs` → **153 passed, 0 failed**.
- `node Tools/seating-chart/test/drive-seating.mjs` → **111 checks, 0 failed**.
- `node assets/js/gvb-save.test.mjs` → 50 passed, 0 failed.
- `cd Tools/board-check && npm run tools` → 18 checks, 0 failed.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken; 0
  collisions, tightest vertical gap 9.1px.** (The unit count moves every round as files are added
  elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round).
- Locked decision #34 still applies to anything new you add.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus. This page isn't part of `npm run games`,
but the one-suite-at-a-time rule still applies if another thread is running one alongside you.

## Output: your notes file

Write `Claude Prompts/notes/20-seating-chart-generator-notes.md`. Nobody else writes that file, so
it can never conflict. It is the only record of this session that survives — the next handoff gets
assembled from all twenty-two of them each round.

Use these headings:

```
# Seating Chart Generator — session notes

## Student data
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Answer it directly:** whether any
real student names were in the file, what the tool stores and where, whether a user can clear all
of it in one action, whether the UI tells them the truth about it.

- **What changed** — files touched and why, with paths. Name every storage key explicitly if you
  touch storage.
- **What I verified** — actual commands, actual output. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you renamed, any `gvb-save.js` gap with the exact
  hook signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
