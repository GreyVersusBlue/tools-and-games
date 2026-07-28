# 21 — General Site Improvements

You own the shared infrastructure of greyversusblue.com: the board, the 404 page, the shared save
module, the dev tooling, and the handoff. **Twenty other Claude sessions are working on individual
projects in parallel and none of them may touch any of it** — instead each one writes what it needs
into a notes file, and applying those is your job.

**Read the sequencing section before you start.** This prompt has work you can do immediately and work
that must wait for the other twenty to finish.

## Your boundary

You own these paths:

- `index.html` — the board. The single most contested file in the repo.
- `404.html`
- `assets/js/gvb-save.js` and `assets/js/gvb-save.test.mjs` — the shared save module
- `assets/js/README.md`
- `assets/previews/**`, `assets/og/**`, and their READMEs — generated artifacts
- `Tools/board-check/**` — **except `play-castle.mjs`, which belongs to prompt 05.** Castle Conundrum
  is its only consumer, so no other thread can conflict with it, and Castle work is unverifiable
  without being able to add beats.
- `CNAME`
- `gvb-site-handoff-v8.md` — **which you write.** The v1 through v7 files are history; read them,
  never edit them.
- `Tools/creature_artwork_gallery.html` — **which you delete.** See task one.
- `Claude Prompts/notes/**` — you read all twenty. You write none of them except your own.

**Everything else is read-only to you.** Every project under `Projects/`, `Pathfinder/` and `Tools/`
belongs to one of the other twenty prompts. If a project needs an internal fix, **it is not yours to
make** — note it in the handoff as backlog for that project's next session. The one exception is the
gallery you are deleting.

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't.

## Sequencing — read this before you start

**Do now, independent of everyone else:**

- Task one: delete the Bestiary Gallery.
- Task two: close the offsite-request measurement hole.
- Task three: vendor `index.html`'s and `404.html`'s own fonts.
- Task four: 404 page and board review.

**Do only after the other twenty threads have finished and their notes files exist:**

- Task five: apply every Shared-file request.
- Task six: bump the version line and write `gvb-site-handoff-v8.md`.

If you are running before the others are done, do tasks one through four, then stop and say clearly in
your notes that five and six are outstanding and need a second pass. **Do not write
`gvb-site-handoff-v8.md` from an incomplete set of notes files** — a handoff that claims to summarise
twenty-one sessions but saw six is worse than no handoff, because the next session will trust it.

## Required reading

1. This whole file.
2. `Claude Prompts/README.md` — how the twenty-one-way split works and which prompt owns what.
3. `gvb-site-handoff-v7.md`, all of it, then §10's locked-decision list plus the earlier lists it
   cites: v1 §3, v2 §8, v3 §6, v4 §5, v5 §6, v6 §9. **You are the thread most likely to break one of
   those forty-two decisions**, because you own the files they are mostly about.
4. `Tools/board-check/README.md`, then `harness.mjs`, `sync-social-tags.mjs`, `check-integrity.mjs`,
   `capture-previews.mjs`, `games.mjs`.
5. `assets/js/gvb-save.js` and its test, in full.
6. Every `Claude Prompts/notes/*.md` file that exists when you start.

## House rules

- **No build step.** Static files served by GitHub Pages from the repo root at `greyversusblue.com`.
  Plain ES modules, no bundler, no runtime npm dependency. `Tools/board-check` is dev-only and
  gitignores its own dependencies (locked decision #12).
- **The ledger rail is generated from the DOM, never hand-authored** (locked decision #6). Adding a
  card with `data-tags="Sim"` updates the chip counts automatically. **Don't hard-code counts** —
  which matters this session because you are removing a card.
- **Seal glyphs are per project; ribbon tags are per genre** (locked decision #5). Two different axes
  on purpose. Don't collapse them.
- **`404.html` links are root-absolute** (locked decision #8). Relative links break it on subpaths.
- **`#quest-board .notice { padding-top: 2.15rem }` is load-bearing** (locked decision #10). It is the
  reserved band the corner ornaments live in; removing it reintroduces the overlaps, and
  `check-collisions.mjs` will catch that.
- **Never hand-edit inside the `gvb:social` markers in any page** (locked decision #31). Reword the
  notice in `index.html` and run `npm run social`.
- **The favicon is one shared inline SVG data-URI on every page** (locked decision #32). Per-project
  marks were considered and rejected: the icon is the site's identity and it costs zero requests this
  way. `index.html`, `404.html` and every generated head already agree; `sync-social-tags.mjs` says so
  in a comment. Leave it alone.
- **A check that only prints is a check that gets ignored** (locked decision #13). Both checkers exit
  non-zero. Keep that.
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34). Two versions of the
  line-of-sight check passed the full suite while doing nothing at all, and the only thing that caught
  either was moving the Guard back into the wall. **This applies directly to task two.**
- **Measure before deciding an asset is too heavy** (locked decision #42). It exists because a size
  estimate wrong by 4× blocked the Golden Hour sand decision for two sessions. Two `curl -I`s settled
  it.
- **Windows is the dev machine** (v7 §7, v6 §5). Absolute `import()` paths need `pathToFileURL`; don't
  lean on shell brace expansion.

## Task one: delete the Bestiary Gallery

`Tools/creature_artwork_gallery.html` goes. Devon's call, and the reason he gave is that the links are
all broken and the tool is no longer useful.

**There is a stronger reason to add to the record: the file makes 3,894 requests to
`2e.aonprd.com`.** It is an index of Archives of Nethys bestiary art that hotlinks every image. It has
been the site's largest offsite dependency by three orders of magnitude the entire time, and it was
never noticed because the browser suites only ever drive the seven games.

What to do:

1. Delete `Tools/creature_artwork_gallery.html`.
2. Remove its `<a class="notice">` block from `index.html` — it is at roughly line 621, in the
   **Pathfinder** section, not Town Services. That placement was a deliberate v1 decision (locked
   decision #3: it is a PF2e reference, not a schoolhouse tool), so removing it changes the Pathfinder
   section's card count.
3. Check nothing else references it. `gvb-site-handoff-v1.md` mentions it at lines 34 and 51 — **those
   are history and stay exactly as they are.** Do not retrospectively edit a handoff.
4. **The notice count drops from 23 to 22.** This matters more than it looks:
   `sync-social-tags.mjs` hard-fails if it parses fewer than 20 notices, with the message "the notice
   markup has changed shape, fix the regexes rather than shipping a partial sweep". 22 is safely above
   the floor, but **every expected-output figure in this repo that says "23 notices" is now stale**,
   including in the other twenty prompts and in `gvb-site-handoff-v7.md`'s verification list. Note the
   new number prominently in your handoff so the next session doesn't read 22 as a regression.
5. Run `npm run check` and `npm run social:check` afterwards. `check-integrity.mjs` is the sweep that
   catches a link to a file that no longer exists.

## Task two: close the offsite-request measurement hole

**`gvb-site-handoff-v7.md` §5 claims the site makes zero offsite requests site-wide. That is false,
and the suite is built so it cannot notice.** This is the most interesting finding available to you
this session and it is a guard-rail that has been passing while doing nothing — exactly what locked
decision #34 was written about.

Two independent holes:

**Hole one: `prepPage()` fulfills Google Fonts requests before the blocked-list check runs.** In
`harness.mjs`, the route handler does this, in this order:

```js
if (/fonts\.googleapis\.com\/css/.test(u))   return route.fulfill({ ...fontCssFor(u, base) });
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u)) return route.fulfill({ ... });
// ... and only after that:
if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) { blocked.push(...); return route.abort(); }
```

So a font hotlink is satisfied locally from the bundled `@fontsource` packages and **never reaches
`blocked`**. `page.__blocked` is empty because the harness is helping, not because the page is clean.
The docstring above `prepPage()` says the empty `allow` list "is what makes `page.__blocked` an honest
inventory" — that comment is wrong and should be fixed as part of this task.

**Fifteen pages still hotlink `fonts.googleapis.com`, including four of the six games `npm run games`
drives and both files you own:**

| Page | Families |
| --- | --- |
| `index.html` | Alegreya, Alegreya SC, Grenze Gotisch |
| `404.html` | Alegreya, Alegreya SC, Grenze Gotisch |
| `Projects/aphelion/index.html` | IBM Plex Mono, Lora |
| `Projects/Closing Time/index.html` | IBM Plex Mono, Public Sans, Zilla Slab |
| `Projects/Ren-Faire-Claude/index.html` | Barlow Semi Condensed, Fraunces, Grenze Gotisch |
| `Projects/integer-foundry.html` | Inter, JetBrains Mono, Oswald |
| `Projects/coffee_shop_sim.html` | Kalam, Quicksand, Space Mono |
| `Projects/daredevil_r4.html` | Alfa Slab One, Oswald, Space Mono |
| `Projects/the-fracture-cycle.html` | Cinzel, EB Garamond, JetBrains Mono |
| `Pathfinder/campaigns.html` | Cinzel, Crimson Pro, Oswald |
| `Pathfinder/characters.html` | Cinzel, Crimson Pro, Oswald |
| `Tools/Name Picker.html` | Bungee, Outfit, Press Start 2P |
| `Tools/Schedule Visualizer ... v60.html` | DM Sans, DM Mono, Fraunces, Public Sans |
| `Tools/Schedule Browser as of 260715.html` | Fraunces, Public Sans |
| `Tools/Seating Chart Generator.html` | Fraunces, Spline Sans |

The eighteen project threads own their own files and each has a "vendor your fonts" task, so **most of
that table will be clearing itself while you work.** Your two files are yours (task three), and your
job here is the measurement, not the fixing.

**Hole two: the suites only drive the seven games.** `play-games.mjs` and `play-castle.mjs` assert
`page.__blocked` is empty for six games and Castle Conundrum. Nothing has ever loaded the tools, the
Pathfinder pages, `404.html`, or the Bestiary Gallery — which is how 3,894 hotlinked images went
unnoticed across seven sessions. Three tools also pull jsPDF, jspdf-autotable and xlsx from
`cdnjs.cloudflare.com`.

**What to build.** The right fix is probably not to stop fulfilling fonts — `fontCssFor()` exists so
screenshots render with the right typefaces, and breaking that would make every preview wrong. The fix
is to **record what you fulfill and let the caller assert on it**, plus a separate audit that covers
every page rather than only the games. Shape worth considering:

- Add a `page.__offsite` (or extend `__allowed`) that records every offsite URL the harness satisfied
  on the page's behalf, fonts included, so "we intercepted this" and "the page didn't ask for it" stop
  being the same observation.
- Add a static sweep — a source grep across every `.html` in the repo for offsite hosts — to
  `check-integrity.mjs`. This is the check that actually scales: it covers all 22 pages including ones
  no browser suite drives, it needs no browser, and it would have caught the gallery on day one. Exit
  non-zero (locked decision #13).
- Fix the misleading docstring above `prepPage()`.

**Then verify it the way locked decision #34 demands: reintroduce the bug.** Add a font hotlink back
into a page on purpose, watch the new check fail, remove it, watch it pass. A check you have not seen
fail is not a check — this whole task exists because that lesson was learned twice already and once
right here in this file.

## Task three: vendor `index.html`'s and `404.html`'s fonts

Both hotlink Alegreya, Alegreya SC and Grenze Gotisch. **All three are already on disk** in
`Tools/board-check/node_modules/@fontsource/` — copy woff2 files out of them, but nothing at runtime
may reference `node_modules`.

Where they live is a decision, not an obvious answer. Locked decision #17 says each project vendors its
own copy and nothing is shared across projects — but `index.html` and `404.html` are not projects, they
are the site, and they use the same three families. `assets/fonts/` is the natural home for the site's
own typefaces, alongside `assets/js/gvb-save.js` which is already the one deliberately shared runtime
file in the repo. **Put them in `assets/fonts/` with a README naming source and licence**, the way
`Projects/golden-hour-beach/assets/textures/README.md` does, and record the reasoning as a new locked
decision so the next session doesn't read it as a violation of #17.

Ship only the weights actually used; read the CSS rather than trusting the hotlinked URL, which asks
for more. Measure and report the total (locked decision #42).

## Task four: 404 page and board review

`404.html` is 159 lines and already good — on-theme, root-absolute links per locked decision #8,
correct shared favicon, a `prefers-reduced-motion` guard, and copy that fits the noticeboard conceit
("NOTICE TORN DOWN", "Somebody took this one and never brought it back. The barkeep says that
happens."). **Don't rewrite it for the sake of having done something.** Devon named it as an example of
general site work, not as a complaint.

What is actually worth doing:

- Its three section links point at `/#quests`, `/#pathfinder` and `/#services`. **Confirm all three
  anchors still exist in `index.html`** — an anchor that has been renamed makes the 404 page's one job
  fail silently.
- It is not one of the 22 notices, so `sync-social-tags.mjs` does not manage its head. Check whether it
  should have a description and OG tags at all. A 404 has no business being shared, so "deliberately
  bare" is a legitimate answer — write it down either way.
- **Test it on a real subpath**, not just at the root. That is what locked decision #8 is about, and it
  is the kind of thing that gets broken by a change and never noticed. `/Projects/nonexistent-thing`
  should show it with working links.
- On the board: five live games have no preview and no OG card — Absalom Inheritance, Coffee Shop Sim,
  Daredevil, Torchbearer, The Fracture Cycle. Adding one means a recipe in `games.mjs` and a run of
  `npm run previews` and `npm run promote`. **Several of those threads are being asked to request a
  preview and say what frame it should show**, so read their notes before you build recipes — that is
  task five's territory. Locked decision #28: a preview is a frame from *play* and the capture has to
  prove it got there. Locked decision #29: a turn-based game legitimately gets `live: false`; don't
  animate something to satisfy a motion check. Locked decision #30: one chosen frame produces both the
  330×200 hover preview and the 1200×630 share card, resized in a canvas — do not add an image library
  to that folder.
- The archived Fourth Quarter card stays exactly as it is (locked decision #2): it points at
  `Projects/The-Fourth-Quarter.html`, carries `class="archived"`, and reads "OLD NOTICE — STILL
  PINNED". Prompt 07 has been told not to touch it either.

## Task five: apply every Shared-file request (after the other twenty finish)

Read all twenty notes files. Each has a **Shared-file requests** section written to be applied without
reading that session. Expect:

- Board card rewordings, and new `href`s from threads that restructured a single-file project into a
  folder. **Several will break existing URLs** and the notes are required to say so. `404.html` catches
  the fallout gracefully, which is part of why it matters.
- **Requests for new hooks on `gvb-save.js`.** Up to eight threads were told to adopt the module and all
  of them were told to request rather than edit. **Reconcile before you implement**: if three threads
  independently ask for the same thing, that is a real gap in the module's shape and worth designing
  once, properly, rather than bolting on three hooks. Prompt 06 (Closing Time) was specifically asked
  whether the module's shape held up for a second adopter, and prompt 18 (Name Picker) has twelve
  storage keys and forty-six call sites, so it is the most likely to have found something real. Read
  those two first.
- **Regression-suite changes.** Prompt 14 (Integer Foundry) was asked to fix the bug that
  `play-games.mjs` currently works around by seeding `sinks[0].target = 3` and neutering
  `localStorage.setItem`; if it succeeded, that workaround comes out. Prompt 07 (Fourth Quarter) moved
  the save bar off the start screen, which the existing beats depend on finding there. Prompt 09 (Faire
  Weekend) may have changed report-phase saving, which is why that suite reads history rather than
  `lastResult`.
- Preview and OG requests for the five games that lack them.

When you touch `gvb-save.js`, `node assets/js/gvb-save.test.mjs` must still pass — currently 39, up from
32 last session — and grow. Every project that imports it must still work; you cannot verify that
without running their suites, so run them.

## Task six: version line and handoff (after task five)

- **Bump the version line** in `index.html` from `version 8` to `version 9`
  (`<p class="board-note version">`). Locked decision #9: bump it by one every session, and there is an
  HTML comment above it saying so. Twenty other threads were told not to touch it precisely so this
  stays a one-line change here.
- **Write `gvb-site-handoff-v8.md`**, assembled from all twenty-one notes files plus your own work.
  Follow the shape of v7: a one-paragraph summary, numbered sections for the things worth reading, a
  backlog-state table, a "things I found and deliberately did not fix" section, a locked-decisions
  section that carries the previous forty-two forward and numbers new ones from 43, a suggested-next-
  session list ordered by value per effort, and a "Verified this session" list of actual commands and
  actual counts.

Things that should end up in it, if the notes bear them out:

- **Correct v7 §5.** It says zero offsite requests site-wide; that was true only of the seven games. Say
  what was actually true, what the measurement hole was, and what now covers it. Getting this wrong
  twice would be worse than the original error.
- The Bestiary Gallery deletion and the 3,894-request reason.
- The new notice count of 22, flagged so it doesn't read as a regression.
- New locked decisions from 43. Candidates: where the site's own fonts live and why that is not a
  violation of #17; whatever the fonts-are-fulfilled-not-blocked fix settles about what `page.__blocked`
  means; whatever prompt 06 and 18 concluded about the save module's shape; whatever prompt 09 decided
  about report-phase saving; whatever prompt 19 decided about versioned filenames.
- **Any finding from prompt 16 about the grade arithmetic**, and **any finding from prompt 19 about
  what is in the publicly committed schedule data.** Those two were asked to answer specific questions
  that could matter outside this repo. If either found something, it goes near the top, not in a table.

## Verification

- `cd Tools/board-check && npm run check` → currently 235 units, 0 broken, 0 collisions across nine
  widths. Expect the unit count to move when you delete a card.
- `npm run social:check` → **currently 23 notices; expect 22 after task one.** Then `npm run social` and
  `npm run social:check` again to confirm 22 already current.
- `node assets/js/gvb-save.test.mjs` → currently 39 passed, 0 failed.
- `npm run games` → currently 94 checks, 0 failed. `npm run play` → 22 beats.
- `npm run previews` → all seven reached gameplay, plus any you add.
- Every project suite whose files you touched through a shared-file request:
  `Projects/fourth-quarter/test/smoke-campaign.mjs` (137) and `smoke-engine.mjs` (179), Closing Time's
  `tools/smoke.mjs` (`SMOKE OK`), Ren-Faire's `tests/smoke.mjs` (684, needs
  `npm install --prefix "Projects/Ren-Faire-Claude"` once for jsdom).
- **Test `404.html` on a real subpath.**
- **Locked decision #34, and it is the point of task two:** reintroduce a font hotlink and watch the new
  check fail before you believe it works.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window nobody is looking at — v7 §6 is a whole section about a
seven-game run that failed twice and passed on retry because someone clicked another application.
`harness.mjs` launches with `--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding` and `--disable-background-timer-throttling`, which fixed it. **You
own that file — check those flags survive anything you change.** Other threads may be running these
suites; only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/21-general-site-improvements-notes.md` **as well as**
`gvb-site-handoff-v8.md`. The notes file records what you did; the handoff records what the whole batch
did. They are different documents and you need both — the notes file is what someone reads to audit
your session specifically.

Use these headings:

```
# General Site Improvements — session notes

## What changed
## What I verified
## Requests applied, and requests refused
## Deliberately not done
## Next session
```

Note the third heading, which replaces the usual "Shared-file requests" since you are the one applying
them. **List every request from every notes file and say what happened to it.** A request you declined
is fine and often correct — three threads asking for overlapping `gvb-save.js` hooks should not produce
three hooks — but a request that silently vanished leaves a project thread believing something shipped
that didn't. If you refuse one, say so and say why, so it lands in that project's next-session backlog
instead of being lost.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was wrong,
say what was wrong and what the evidence was. Sections are allowed to be opinionated and to say "I
looked at this and left it, here's why". Match that — **you are writing the next one, so this matters
more for you than for anyone else in the batch.** Do not write "comprehensive" or "robust" anywhere.
