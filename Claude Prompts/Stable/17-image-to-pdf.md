**This project had nothing outstanding as of round 3 (2026-08-03).** Checked: both rotation
problems from the original audit remain closed, re-verified fresh against a real generated PDF
rather than trusting round 2's proof to still hold; `npm run tools` 18/18; zero offsite requests;
no code changes needed. The two remaining items (the EXIF fix against a real phone photo, a real
screenshot of the mobile layout) are environmental verification gaps — no camera, no compositing
browser pane, identical across three straight sessions — not code defects. Re-verified against the
live repo by this refresh, not just carried forward on the session's own claim. If a real device or
a fair environment ever closes those two checks, or a new code gap surfaces, move this back to the
live `Claude Prompts/` folder.

# 17 — Image → PDF Assembler

You are working on the Image → PDF Assembler, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It turns a set of images into a single PDF, entirely in the
browser. Round 2 added a per-page 90°-rotation control, verified pixel-correct against real
generated PDFs. Round 3 re-verified everything fresh and made no code changes. This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/image-to-pdf.html` (1033 lines)
- `Tools/image-to-pdf/` — `libs/jspdf.umd.min.js` (vendored jsPDF) and `libs/README.md`
- Any new folder you create under `Tools/` **named for this tool**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Other Claude sessions may be working on other projects in this same repo at the
same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 22. |
| Every other file in `Tools/` | Prompts 16, 18, 19, 20. `Tools/board-check/` is prompt 22's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git
and GitHub Pages don't.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading
your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file.
2. **`Claude Prompts/notes/17-image-to-pdf-notes.md`** — round 3's session: re-verified the
   rotation fix fresh against a new real generated PDF, confirmed the screenshot gap is now a
   three-round-running sandbox property rather than a flaky one-off. Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/17-image-to-pdf-notes.md` — the rotation control itself,
   verified against real generated PDFs by extracting and decoding the raw JPEG byte streams. Round
   1's are at `Claude Prompts/archive/round-1/notes/17-image-to-pdf-notes.md` — jsPDF vendoring,
   JPEG/WEBP input, quality presets, reorder/remove, the EXIF-orientation fix.
3. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58) and §8 (backlog state).
4. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
5. `assets/js/gvb-save.js` and `assets/js/README.md`, if you conclude the tool should remember
   anything — both rounds considered this and decided against it. Not re-litigated this round.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.**
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). You currently have none.
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Measure before deciding an asset is too heavy** (locked decision #42).

## Student data: handle with care

A teacher using this tool is very likely assembling scans of student work. Two hard rules:

- **Everything stays in the browser.** No network calls, no upload endpoint, no analytics, ever.
- **Do not put real student work or names in the repo.**

## What is actually here

1033 lines (up from 978), plus `Tools/image-to-pdf/libs/`. Title: "Image → PDF Assembler". Tagged
with the school stamp under Town Services. Still no `localStorage`.

**jsPDF is vendored, not hotlinked.**

**A rotation control exists, 90° at a time, per page.** Two buttons (⟲/⟳) per file-queue row; each
file carries a `rotation` value (0/90/180/270) that travels with it through reorder, sort, and
removal. `processRaster` and `processSVG` both take the rotation and, for a non-zero value, route
through the canvas path even for a PNG that would otherwise pass through unmodified — the canvas is
sized to the post-rotation footprint (dimensions swap on 90°/270°) and the returned `naturalW`/
`naturalH` are swapped to match, so page-size decisions downstream see the rotated shape.
**Verified pixel-correct, not just dimension-correct**: built synthetic images with an asymmetric
marker in one corner, rotated them, generated real PDFs, extracted the raw JPEG byte streams back
out (jsPDF embeds JPEG as literal DCTDecode data) and decoded them to confirm the marker moved to
exactly where each rotation should put it. The `#file-list li` markup is restructured into two rows
(filename/badges, then all five action buttons) so five buttons fit at 375px without crowding.

**Input formats, quality, and orientation** — all round 1, unchanged.

**EXIF rotation is handled for phone photos; the scanner-fed-sideways-page problem is now also
handled, by the rotation control above.** Both of the original audit's rotation problems are closed.
**The EXIF fix itself is still unverified against a real device** — see task one.

**No settings persistence, no real HEIC decoding.** Both considered and declined across two rounds
now; not gaps, considered calls.

## Your task

**Nothing is outstanding as things stand.** Two purely environmental checks remain, worth doing if
the hardware ever allows it, not worth retrying with the same approach a fourth time:

1. **Verify the EXIF fix against a real sideways phone photo**, from an environment with an actual
   camera or a real device to hand. Three rounds running without one in this sandbox — the fix is
   reasoned correctly from documented browser auto-rotation behavior, but reasoning from spec isn't
   the standard of proof this tool otherwise holds itself to.
2. **A real screenshot of the two-row mobile layout**, from an environment where the browser pane
   actually composites a frame. Three identical failures ("the Browser pane is not displayed, so
   the page is not compositing frames") suggest this sandbox specifically can't do it, not that
   retrying will eventually work.
3. **Settings persistence, only if an actual teacher asks for it.** Still just a convenience, still
   not a gap in the tool's core job. If built: plain `localStorage` for three primitive values, not
   `gvb-save.js`.

## Verification

This tool has no test suite for anything visual — by-hand verification is the real instrument, but
the rotation math now has a real, reproducible verification method (extract the raw JPEG bytes from
a generated PDF and decode them) if you touch it again.

- **After any change, actually generate a PDF and open it.** A vendored library or a rotation bug
  fails at the moment you use it, not at load.
- Load the page with the network panel open and confirm zero requests leave the site.
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed**, this page included.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units, 0 broken; 0 collisions
  across nine widths, tightest vertical gap 9.1px.** (The unit count moves every round as files are
  added elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round).
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail — the way round 2's rotation work did, by extracting bytes from a real PDF rather than
  trusting the canvas math by reasoning alone.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time. `npm run tools` runs headless and doesn't compete for focus — safe to run
whenever.

## Output: your notes file

Write `Claude Prompts/notes/17-image-to-pdf-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v*.md` gets
assembled from all twenty-two of them each round.

Use these headings:

```
# Image → PDF Assembler — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, with paths. Vendored jsPDF size in KB.
- **What I verified** — actual commands and actual output. Include the real assembly run: how many
  images, what orientations, what the output PDF size was. "Should work" is not verification.
- **Shared-file requests** — any `gvb-save.js` gap with the exact hook signature. Applicable
  blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort. If there is genuinely nothing left, say that.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
