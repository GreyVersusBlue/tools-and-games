# 17 — Image → PDF Assembler

You are working on the Image → PDF Assembler, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It turns a set of images into a single PDF, entirely in the
browser. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/image-to-pdf.html` (748 lines, 24 KB)
- Any new folder you create under `Tools/` **named for this tool** — e.g. `Tools/image-to-pdf/`

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
2. `gvb-site-handoff-v7.md` §10 (locked decisions), §8 (backlog state).
3. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools." This
   is one, and it stays there.
4. `assets/js/gvb-save.js` and `assets/js/README.md`, if you conclude the tool should remember
   anything.

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

748 lines, 24 KB, one file — **the smallest tool in the set**. Title: "Image → PDF Assembler".
Tagged with the school stamp under Town Services. No `localStorage` at all.

**It pulls jsPDF from `cdnjs.cloudflare.com`** at line 24:

```
cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
```

That is a real offsite request in production, and it is the tool's entire reason for existing —
without it there is no PDF. v7 §5 claims the site makes zero offsite requests site-wide; the claim
is wrong, and the reason nobody caught it is that the browser suites only ever drive the seven
games, never the tools. Nothing measures this file.

**The practical consequence matters more than the privacy one here.** A teacher on school wifi
behind a content filter that blocks cdnjs gets a page that loads, looks fine, and then does nothing
when they click the button. That is the worst possible failure mode for a single-purpose tool, and
it is entirely avoidable.

It hotlinks no Google Fonts, which puts it in a minority of pages in this repo.

## Your task

There is no handoff backlog for this tool. It has never been the subject of a session.

**Task one, concrete and known: vendor jsPDF.** Copy `jspdf.umd.min.js` at version 2.5.1 into a
`libs/` folder you own and point the script tag at a local path. Include a README naming the
library, the version, the licence (MIT) and where it came from, the way
`Projects/golden-hour-beach/assets/textures/README.md` does for its textures. Measure the file and
report the number (locked decision #42).

While you are there, check whether 2.5.1 is the version you want. A newer jsPDF may be smaller,
may fix a bug you are working around, or may have changed an API you depend on. Pin deliberately
and write the reason down — a vendored version with no note about why becomes unupgradable folklore.

**Task two: audit and plan, then build what fits.** This is the smallest tool in the set, which
means a session can plausibly finish it. Prefer completing three things to starting six. Write a
prioritized plan into your notes and then build the top items.

Worth forming an opinion about:

- **Actually use it for the job it exists for.** Take a stack of eight or ten photographed pages of
  varying orientation, resolution and aspect ratio — some landscape, some portrait, one enormous,
  one tiny — and assemble a PDF. Then open the PDF and look at it. That single exercise will find
  more than reading the code will. Specific things that go wrong in this class of tool: images
  silently letterboxed with huge white margins, a landscape scan rotated the wrong way, page order
  not matching the order you added them, a 12 MP phone photo embedded at full resolution making a
  40 MB PDF nobody can email.
- **Is there a resolution or quality control?** If every image goes in at native resolution, the
  output is unusable for the most common purpose (emailing or uploading to Schoology). A quality or
  target-size setting is a small change with a large effect. Report actual before-and-after
  file sizes.
- **Reordering and removing.** If you can add ten images but not drag one into a different position
  or delete the one you scanned twice, the tool forces a restart for a trivial mistake. Check
  whether that is the case.
- **Page size and orientation.** Letter versus A4, portrait versus landscape, and whether the tool
  picks per page or once for the document. A US school tool should default to Letter.
- **What happens with a non-image file, a HEIC, or a 100 MB TIFF.** Error handling in a
  drag-and-drop tool is most of the user experience, and "nothing happens" is the usual bug.
- **Should it remember settings?** Page size, quality and orientation are re-chosen every time
  otherwise. That is a legitimate use for `assets/js/gvb-save.js` — but read the student-data
  section first, do not persist the images themselves without a very good reason and a visible
  clear control, keep whatever key you pick forever (locked decision #36), and put fill-ins in
  `repair` rather than `migrate` (locked decision #37). A missing hook in the module is a
  Shared-file request, not an edit.
- **748 lines does not need restructuring** and you should probably say so rather than doing it.
  If you split it anyway, `/Tools/image-to-pdf.html` stops resolving and the board `href` is a
  Shared-file request.
- **Mobile.** 375×812. **This is the single best mobile case in the whole repo**: the images are on
  the phone that took them, and a teacher photographing a stack of worksheets would rather not move
  them to a laptop first. If it works on a phone, that is worth knowing. If it doesn't, that is
  probably the highest-value item in the plan.
- **Accessibility.** A drag-and-drop-only interface is unusable without a mouse. Check there is a
  file-picker path, that every control has a label, and that progress and errors are announced
  rather than only shown.

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
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you
  finish, especially if you renamed anything.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited
  inside the `gvb:social` markers.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

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
  a strong answer for a 748-line single-purpose tool.
- **Next session** — ordered by value per effort. If there is genuinely nothing left, say that.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
