# 12 — Coffee Shop Sim (Corner & Kettle)

You are working on Corner & Kettle, a coffee shop management sim on greyversusblue.com. This
prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/coffee_shop_sim.html` (2,418 lines, 95 KB)
- Any new folder you create under `Projects/` **named for this game** — e.g.
  `Projects/corner-and-kettle/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this same
repo right now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/**`, `assets/og/**` | Generated. Prompt 21. This game has neither. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
| `Projects/fourth-quarter/**`, `Projects/Closing Time/**` | Prompts 07 and 06. **Read both** — they are your two closest siblings and both are ahead of you on save handling. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those
markers** (locked decision #31). Regenerated from the board's notice by `npm run social`; your
edit will be silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file.
2. `gvb-site-handoff-v7.md` §1 (the shared save module and the three gaps adopting it found), §2
   (the two bugs adoption surfaced — **read these, one of them is a bug class you almost
   certainly have**), §9 (the two things deliberately not fixed, both about save design), §10
   locked decisions #36 through #40.
3. `assets/js/gvb-save.js` and `assets/js/README.md`.
4. `Projects/fourth-quarter/js/campaign.js` — the worked example. It is a service-industry sim
   with staff, shifts and a day loop, so it is close to your problem.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** You have three — see below.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). Yours is `cornerKettleSave_v1`, at line
  824. **It keeps that name.** Changing it silently abandons everyone mid-save. Unversioned saves
  read as version 0 and come through `repair`.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` — a
  bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).

## What is actually here

2,418 lines in one file, 95 KB. Title: "Corner & Kettle — Coffee Shop Sim". Tagged `Sim` on the
board. No preview and no OG image, unlike the seven games that have them.

**Persistence is hand-rolled and thin.** Four `localStorage` calls around lines 2313–2361, on
`SAVE_KEY = 'cornerKettleSave_v1'` (line 824), each wrapped in a bare `try {} catch (e) {}` with
comments like `/* localStorage unavailable — ignore */`. There is no version stamp and no
validation, so a corrupt blob is `JSON.parse`d straight into game state and the game boots on it.
There is no file export or import, so a cleared browser loses the shop.

That `try/catch` deserves a specific note, because the comment shows the intent was right and the
implementation doesn't reach it: in a browser configured to block storage, **reading the
`localStorage` property throws outright** — not `setItem`, the property access itself. Depending
on where your `try` starts, that may or may not be caught, and it will never fall back to
anything. `assets/js/gvb-save.js` has a memory-backed fallback for exactly this case, and it
probes rather than guesses.

**It hotlinks three Google Font families** — Kalam, Quicksand and Space Mono — at lines 24 and
25. v7 §5 claims the site makes zero offsite requests site-wide. That is wrong for fifteen pages,
and the suite cannot see it: `prepPage()` in `Tools/board-check/harness.mjs` *fulfills* Google
Fonts requests locally from bundled `@fontsource` packages before the blocked-list check runs, so
font hotlinks never reach `page.__blocked`. None of your three families are among the twelve
already on disk in `Tools/board-check/node_modules/@fontsource/`, so you will be sourcing these
yourself. Nothing at runtime may reference `node_modules` either way.

## Your task

There is no handoff backlog for this game. It has never been the subject of a session.

**Task one, concrete and known: vendor the three fonts.** Kalam, Quicksand and Space Mono. Local
`@font-face`, woff2 in a folder you own, hotlinks deleted, only the weights the page actually
uses — read the CSS and check, because the hotlinked URL asks for more than the page needs.
Include a README naming source and licence, the way
`Projects/golden-hour-beach/assets/textures/` does. Measure the total and put the number in your
notes (locked decision #42, which exists because a size estimate that was wrong by 4× blocked a
good decision for two sessions).

**Task two, concrete and known: adopt `assets/js/gvb-save.js`.** This is the same job that paid
for itself in The Fourth Quarter last session — adopting it found three gaps in the module and two
bugs in the game. What you get: file export and import, a memory-backed fallback for blocked
storage, validation so a corrupt blob is refused, and one implementation of "refuse to load
garbage" instead of none.

Specifics that will bite you, all learned expensively in v7 §1 and §2:

- **Keep the key `cornerKettleSave_v1`** (locked decision #36).
- **`defaults` may be a factory, and probably has to be.** If a new shop involves anything
  randomised — starting customers, a rolled staff pool, a seeded market — day one cannot be a
  literal, and passing one means `slot.reset()` hands back `null` and the module is useless to
  you. That exact gap was found by The Fourth Quarter's three random job applicants.
- **Fill-ins go in `repair`, not `migrate`** (locked decision #37). `migrate(state, from)` only
  runs when the stored version differs; `repair` runs on **every** accepted load from every door
  — localStorage, an imported file, a pasted blob, and a save the current build just wrote. The
  pass that currently lives in your load path has exactly that shape.
- **Go looking for your version of the walking-speed bug.** The Fourth Quarter had a staffer saved
  before roles existed; the old loader filled in `role` and `skill` but never `speed`, and
  `beginNight()` multiplied that straight into metres per second. An `undefined` there made a
  floor NPC with a NaN speed that never arrived anywhere — no error, no crash, just something
  that silently never happens. **You are a staff-and-shifts sim with the same shape.** Enumerate
  every field added to the save since it shipped, check whether an old save has it, and check
  whether it lands in arithmetic. This is the highest-value thing in the task and it is the part
  people skip.
- **`mountSaveBar` takes a `buttons` option** (`["export", "import"]`, etc.) and each button
  carries `data-gvb="export|import|reset"` so a driver can click it without depending on label
  text or order. If your game already has a "new game / wipe" button somewhere, **do not mount
  "reset" next to it** — two save-erasers side by side is the exact footgun that `buttons` option
  exists to prevent.
- **Put the save bar somewhere reachable during play.** v7 §9 has an item still open because The
  Fourth Quarter's bar lives only on the start screen, so exporting mid-week means reloading the
  page to get the overlay back. Nothing is lost but it is a step nobody should have to think of.
  A day-end or shift-end screen is the natural home.
- **Stop touching `localStorage` directly anywhere afterwards.** Let the module do the probing.
- **Import relatively** — `../assets/js/gvb-save.js`, not `/assets/js/gvb-save.js` — so any Node
  test can resolve it.
- **A missing hook is a Shared-file request, not an edit** to `gvb-save.js`. Six projects read
  that file. Write the exact signature you need.

**Task three: audit and plan, then build what fits.** Write a prioritized plan into your notes.
Worth an opinion:

- **Play it to the end and say how long that took.** Then say what the cheapest change is that
  would make the second playthrough different from the first. For a management sim that is usually
  either a difficulty curve or a build choice, not more content.
- **Is there a difficulty curve, or does day 30 play like day 3?** Numbers if you can get them:
  revenue per day, customers per day, staff cost.
- **2,418 lines in one file.** You may restructure into `Projects/corner-and-kettle/index.html`
  plus `js/` and `css/`. For a 95 KB sim with a day loop, an economy and a UI, splitting engine
  from UI is a real gain. **But it breaks the URL** — `/Projects/coffee_shop_sim.html` stops
  resolving — so the board `href` becomes a Shared-file request and you should say plainly that
  the old URL breaks. Note the current filename uses underscores where most of the repo uses
  hyphens. Decide on merit and say why either way.
- **No preview and no OG card.** Getting one means a recipe in `Tools/board-check/games.mjs` and a
  run of `npm run previews`, both prompt 21's. If you think it deserves one, request it and say
  what frame should show. Locked decision #28: a preview is a frame from *play* and the capture
  has to prove it got there; locked decision #29 says a turn-based game legitimately gets
  `live: false` and you should not animate something just to satisfy a motion check.
- **Mobile.** 375×812. A DOM-based management sim genuinely could work on a phone.
- **Accessibility.** Heading order, contrast, keyboard navigation, whether the day's numbers read
  sensibly to a screen reader.

## Verification

This game has no test suite. If you adopt the save module, that needs one — put it in a folder you
own and make it exit non-zero on failure (locked decision #13).

- Open the page in a real browser and play it to the end. You cannot plan improvements to a sim you
  have not finished.
- Test the save round trip by hand: play a few days, reload, confirm the same state. Then export to
  a file, clear storage, import, confirm the same state again. Then feed it a deliberately corrupt
  file and confirm it is refused rather than loaded — right now it would not be, and that is the
  argument for this whole task in one sentence.
- **Load an old save written by the current build before your changes**, and confirm it still works
  after. Save one to a file first, before you start editing. This is the single most likely thing to
  break and the easiest to forget.
- After vendoring, grep the file for `fonts.googleapis.com` → zero hits. `page.__blocked` is **not**
  the check; `prepPage()` fulfills those requests.
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

Write `Claude Prompts/notes/12-coffee-shop-sim-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

Use these headings:

```
# Corner & Kettle — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, in prose, with paths. Vendored font total in KB.
- **What I verified** — actual commands, actual output. Include the save round trip, the corrupt-file
  test and the old-save test. "Should work" is not verification.
- **Shared-file requests** — a new board `href` if you restructured, a preview recipe if you want
  one, any `gvb-save.js` gap with the exact hook signature. Applicable blind. Empty is fine; keep
  the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
