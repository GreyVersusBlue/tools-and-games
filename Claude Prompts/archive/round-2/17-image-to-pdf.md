# 17 — Image → PDF Assembler

You are working on the Image → PDF Assembler, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It turns a set of images into a single PDF, entirely in the
browser. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/image-to-pdf.html` (978 lines, 33 KB)
- `Tools/image-to-pdf/` — the folder this tool now has, holding `libs/jspdf.umd.min.js` (the
  vendored jsPDF) and `libs/README.md`
- Any new folder you create under `Tools/` **named for this tool**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Up to twenty other Claude sessions are working on other projects in this same repo right
now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. |
| `Tools/creature_artwork_gallery.html` | **Being deleted this round** by prompt 21. Not yours; don't reference it. |
| Every other file in `Tools/` | Prompts 16, 18, 19, 20. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git
and GitHub Pages don't. If you rename anything, verify the rename landed in git and not only on
disk.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading
your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file.
2. `Claude Prompts/notes/17-image-to-pdf-notes.md` — round one's session on this exact tool. It
   vendored jsPDF, added JPEG/WEBP input, quality presets, per-page orientation, reorder/remove,
   and found two real bugs by testing. Read it before you touch anything; the task list below
   already reflects it, but the reasoning behind what it declined to do is there, not here.
   `Claude Prompts/archive/` holds every earlier round's prompts and notes if you need more history
   than that.
3. `gvb-site-handoff-v8.md` §9 (locked decisions), §7 (backlog state), and §5 for `npm run tools`,
   the new sweep that now covers this page.
4. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools." This
   is one, and it stays there.
5. `assets/js/gvb-save.js` and `assets/js/README.md`, if you conclude the tool should remember
   anything — but read "Deliberately not done" in the notes file first. Round one considered this
   and decided against `gvb-save.js` specifically: three primitive UI preferences with no student
   data don't need its versioned-slot machinery. Plain `localStorage` is proportionate here, if you
   still decide to build it at all.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** You have one — see below.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
  In particular, do **not** create a shared `Tools/libs/jspdf/` for the other tools that also use
  jsPDF. Two of them do, and two other threads are working on them in parallel right now. A
  duplicated 350 KB file beats a cross-tool coupling and a merge conflict.
- **Never change a storage key** (locked decision #36). You currently have none.
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Measure before deciding an asset is too heavy** (locked decision #42). It exists because a size
  estimate that was wrong by 4× blocked a good decision for two sessions.

## Student data: handle with care

A teacher using this tool is very likely assembling scans of student work. Two hard rules:

- **Everything stays in the browser.** No network calls, no upload endpoint, no analytics, ever.
  The tool is currently clean on this apart from the CDN script below, and it must stay clean.
- **Do not put real student work or names in the repo.** Any sample or test fixture uses obviously
  fake content.

If you add persistence, remember that anything cached in `localStorage` or IndexedDB sits on a
shared classroom machine until something clears it. Images are large enough that this matters
practically as well as legally: a visible "clear" control is not optional, and neither is being
honest in the UI about what is stored and where.

## What is actually here

978 lines, 33 KB (33,466 bytes) in the main file, plus a `Tools/image-to-pdf/libs/` folder round
one added. Title: "Image → PDF Assembler". Tagged with the school stamp under Town Services. Still
no `localStorage` — no persistence at all, deliberately (see below).

**jsPDF is vendored, not hotlinked.** `Tools/image-to-pdf/libs/jspdf.umd.min.js`, 357 KB (365,730
bytes), pinned to **2.5.2** — the last patch on the 2.x line matching what used to be hotlinked,
not the current 4.x, because two major-version jumps was judged too much unverified change for a
978-line tool with no prior test suite, and the 4.x UMD build is bigger, not smaller, so there was
no size argument for going there either. Reasoning is written down in
`Tools/image-to-pdf/libs/README.md`. `grep -c cdnjs Tools/image-to-pdf.html` → 0. (If you grep the
vendored library file itself, the minified source happens to contain the literal string
`cdnjs.cloudflare.com` somewhere internally — inert text, never executed, confirmed inert by
network panel showing nothing left the machine when a PDF is generated. Don't mistake that for a
live hotlink.)

**Input formats, quality, and orientation are real now, not the round-one gaps.** The tool accepts
`.png`, `.svg`, `.jpg/.jpeg`, and `.webp` — JPEG in particular is what phones actually produce, and
the tool couldn't take a phone photo at all before this. Three quality presets (Standard / High /
Original) downscale and re-encode as JPEG, except Original+PNG, which stays raw and lossless.
Orientation is picked per page from that image's own aspect ratio (Auto, default), not forced
document-wide. "Match image size" is clamped to 25–432mm so a 4032×3024 photo no longer becomes a
room-sized page, and the default page size is Letter.

**EXIF rotation is handled for phone photos, but not for a scanner-fed sideways page — these are
different problems and only one is fixed.** A phone photo carries an EXIF orientation tag; the
browser auto-rotates it for display, but jsPDF's raw JPEG embed doesn't read that tag, so passing
JPEG bytes through unmodified at "Original" quality would land a correctly-oriented-on-screen photo
sideways in the PDF. Fixed by routing JPEG through canvas even at Original (0.95, near-lossless).
This fix is verified by reasoning through documented browser behavior, not against an actual
sideways photo (no camera in round one's sandbox) — **that verification is still outstanding, see
task two.** Separately, a flatbed scan fed in backwards has no EXIF tag to correct and no rotate
button exists for it — that's a real, smaller, still-open gap, see task one.

**Per-file reorder, remove, and error isolation all work.** Every row has Up/Down/Remove buttons —
the primary reorder mechanism and the only one verified to work on a touch phone. HTML5
drag-and-drop is wired as a desktop-mouse bonus but was not separately exercised with a simulated
drag; treat it as unverified. Each file gets its own try/catch during PDF generation, so one
corrupt file no longer kills a batch that was otherwise fine — this was tested by deliberately
feeding it corrupt bytes (locked decision #34), not just written and trusted.

**Touch targets were measured, not eyeballed, and fixed:** row buttons were 21×24px, now ~50×40px,
caught by `getBoundingClientRect` in an actual 375×812 viewport rather than guessed from the CSS.

**Clean under the new `Tools/board-check` sweep.** `npm run tools` opens all six Tools pages headless
and asserts a real title, zero offsite requests, zero console errors — 18 checks, 0 failed, and this
page is one of the six. `check-integrity.mjs`'s static source sweep (locked decision #44) doesn't flag
this file either.

**No settings persistence.** Considered and deliberately declined this round as a separable
feature, not because it's a bad idea — see task three.

**No real HEIC decoding.** Not possible client-side without a new WASM dependency for a format
problem that has a one-step fix on the phone that created the file; the rejection message tells the
teacher that fix by name instead of a generic "unsupported file" error.

## Your task

Round one closed the gaps that made this tool unable to do its actual job (JPEG input, quality
control, reorder, page sizing). What's left is smaller and more specific — see the notes file for
the full reasoning behind each of these.

**Task one: a rotation control for a scanner-fed sideways page.** 90°-at-a-time, per page — two
small buttons per row is enough UI. This is the one item from the original audit ("a landscape scan
rotated the wrong way") not yet covered: EXIF-rotated phone photos are handled automatically (see
above), but a page that's genuinely upside-down or sideways in the source file — as a flatbed scan
fed in backwards would be — has no fix. Build the guard-rail, then verify it by rotating a page the
wrong way on purpose and confirming the button corrects it (locked decision #34).

**Task two: verify the EXIF fix against a real photo.** Round one's fix is reasoned correctly from
documented browser behavior but was never checked against an actual sideways phone photo — no
camera in that sandbox. Five minutes with a real device closes this. If you find the reasoning was
wrong somewhere, that's the most valuable thing this task could turn up.

**Task three, lower priority, conditional: settings persistence.** Only worth building if a teacher
using this repeatedly actually asks for page size / quality / orientation to be remembered between
visits — round one looked at this and decided it's a real but separable convenience, not a gap that
blocks the tool's actual job. If you build it: plain `localStorage` for three primitive values is
proportionate. Do **not** reach for `assets/js/gvb-save.js`'s versioned-slot machinery here — it's
built for game campaign state, and round one's own assessment was that it would be overhead for
three dropdowns with no student data involved. That's a considered call, not an oversight; revisit
it only if the actual shape of the need changes.

**If genuinely nothing else surfaces after those three:** this is a small, single-purpose tool that
now does its one job (assembling real phone photos into a PDF) on its actual input. Say so rather
than inventing scope. 978 lines, one file, one job — restructuring into a folder of modules was
considered in round one and declined; it would cost the board's `/Tools/image-to-pdf.html` link for
no real readability win at this size. Don't reopen that unless the file has grown enough since to
change the answer.

- **Mobile.** 375×812 remains **the single best mobile case in the whole repo** — the images are on
  the phone that took them. Round one verified the core flow here and caught the touch-target bug
  this way; if you add the rotation control, verify it on a phone too, not just desktop.
- **Accessibility.** `aria-live` regions and button labels exist from round one. Check anything you
  add gets the same treatment.

## Verification

This tool has no test suite. Most of what matters here is visual and cannot be asserted, so
by-hand verification is the real instrument — but the parts that are arithmetic (fitting an image
of a given aspect ratio into a page of a given size) are testable, and if you touch that logic it
should get a Node test in a folder you own, exiting non-zero on failure (locked decision #13).

- **After vendoring, actually generate a PDF and open it.** A vendored library with a wrong path
  fails at the moment you use it, not at load, and the page will look perfectly healthy until you
  click the button. This is the one verification step you must not skip.
- Load the page with the network panel open and confirm zero requests leave the site, then grep the
  file for `cdnjs.cloudflare.com` → zero hits.
- Do the eight-to-ten-image mixed-orientation run described above and record the output file size.
- Try a non-image file and a very large image, and record what happens.
- `cd Tools/board-check && npm run check` → 331 units, 0 collisions across nine widths, tightest
  vertical gap 9.2px. Run it before you finish, especially if you renamed anything. One unit is
  currently broken — `newindex.html`, which references offsite fonts. That's a separate file outside
  every project's Tools boundary, not something this session touches or should fix; if your own run
  shows a different broken count, or a failure inside `Tools/`, that's a real finding.
- `npm run social:check` → expect 22 notices, 22 already current (dropped from 23 when the Bestiary
  Gallery was deleted). As of this refresh the check itself fails before it gets that far —
  `only parsed 17 notices out of index.html — the notice markup has changed shape` — a repo-wide
  parsing problem unrelated to this file. Don't chase it here. Confirm by hand instead: `git diff` on
  `Tools/image-to-pdf.html` should show nothing between `<!-- gvb:social:start -->` and
  `<!-- gvb:social:end -->`.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time. `npm run tools` (18 checks, includes this page) runs headless and doesn't compete
for focus with those — safe to run whenever.

## Output: your notes file

Write `Claude Prompts/notes/17-image-to-pdf-notes.md`. Nobody else writes that file, so it can never
conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

Use these headings:

```
# Image → PDF Assembler — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, with paths. Vendored jsPDF size in KB, and the version
  you pinned with the reason.
- **What I verified** — actual commands and actual output. **Include the real assembly run**: how
  many images, what orientations, what the output PDF size was, and whether it looked right when you
  opened it. "Should work" is not verification, and for this tool "the code looks correct" is worth
  nothing.
- **Shared-file requests** — a board `href` if you restructured, any `gvb-save.js` gap with the
  exact hook signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason. "This tool is small and does its one job, and here is why adding X would make it worse" is
  a strong answer for a 978-line single-purpose tool.
- **Next session** — ordered by value per effort. If there is genuinely nothing left, say that.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
