# 11 — The Absalom Inheritance

You are working on The Absalom Inheritance, an isometric CRPG built on the Pathfinder 2e
Remaster rules, on greyversusblue.com. It carries `class="has-suite"` on the board. This
prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/absalom_inheritance.html` (1,190 lines, 54 KB)
- Any new folder you create under `Projects/` **named for this game** — e.g.
  `Projects/absalom-inheritance/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this same
repo right now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `Pathfinder/**` | Prompts 01, 02, 03. **Relevant to you** — `Pathfinder/data/` holds 24 JSON files of PF2e rules data. Read it; don't edit it; don't build a runtime dependency on it this session. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/**`, `assets/og/**` | Generated. Prompt 21. This game has neither. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
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
2. `gvb-site-handoff-v7.md` §10 (locked decisions), §8 (backlog state), §1 (what the shared
   save module does and what adopting it found).
3. `assets/js/gvb-save.js` and `assets/js/README.md`, plus
   `Projects/fourth-quarter/js/campaign.js` as the worked example.
4. Locked decision #3 in `gvb-site-handoff-v1.md` §3, so you understand why a PF2e game sits
   under Quests rather than under the board's Pathfinder section: the Pathfinder section is for
   reference and campaign material, Quests is for games. This one is a game.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** This game hotlinks nothing — no Google Fonts, no CDN. It is one of
  the few pages in the repo where that is genuinely true, and fifteen others are not. Don't
  regress it.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). You currently have none — see below.
  Whatever you pick, that is the name it keeps forever.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` — a
  bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what
  a reload has to survive** (locked decision #39).

## What is actually here

1,190 lines in one file, 54 KB. Title: "The Absalom Inheritance — A PF2e Remaster Isometric
CRPG". Tagged `CRPG` with `has-suite` on the board. No preview and no OG image, unlike the seven
games that have them.

**It has no persistence of any kind.** Zero `localStorage` calls, no `JSON.stringify`, no
download link, no file input. Nothing a player does survives closing the tab.

For most pages in this repo that is a minor gap. **For an isometric CRPG it is the defining
limitation**, and it is almost certainly why the game is 1,190 lines rather than 5,000: you
cannot write a long game that nobody can leave. Everything else you might improve here is
downstream of that.

Also worth knowing: it hotlinks no fonts, which puts it in a small minority. v7 §5 claims the
site makes zero offsite requests site-wide, and that claim is wrong for fifteen pages —
`prepPage()` in `Tools/board-check/harness.mjs` *fulfills* Google Fonts requests locally before
the blocked-list check runs, so font hotlinks are invisible to the suite. You are clean. Stay
clean, and if you add a typeface, vendor it.

## Your task

There is no handoff backlog for this game. It has never been the subject of a session.

**Audit, plan, then build the top items.** Write a prioritized improvement plan into your notes,
ordered by value per effort, with tradeoffs named. Then implement the highest value-per-effort
items in this same session and verify them. Don't stop at the plan.

**The obvious first item, and you should treat it as the default plan unless the audit changes
your mind: adopt `assets/js/gvb-save.js` and give this game a save.**

What you get from the module rather than hand-rolling: `localStorage` persistence, file export
and import so a character survives a cleared browser, a memory-backed fallback for browsers
configured to block storage (reading the `localStorage` property *throws outright* in that
case, which is exactly the trap a naive `try/catch` around `setItem` doesn't cover), validation
so a corrupt blob is refused rather than `JSON.parse`d straight into game state, and one shared
implementation instead of a fourth private one.

Specifics that bit the first adopter, from v7 §1 and §2 — read them, they cost a session to
learn:

- **Pick the storage key once and keep it forever** (locked decision #36). Something like
  `absalom-save-v1`. Changing it later silently abandons everyone mid-campaign.
- **`defaults` may be a factory, and for a CRPG it has to be.** Character generation is
  randomised, so the initial state cannot be a literal — pass a function. Passing a literal is
  how `slot.reset()` ends up handing back `null`, which is the gap The Fourth Quarter's three
  random job applicants found.
- **Fill-ins go in `repair`, not `migrate`** (locked decision #37). `migrate(state, from)` only
  runs when the stored version differs; `repair` runs on **every** accepted load from every
  door — localStorage, an imported file, a pasted blob, including a save the current build just
  wrote. You are starting fresh so you have no legacy saves yet, which means this is the one
  chance to get the shape right before you do.
- **The bug class `repair` catches**, so you design against it from day one: The Fourth Quarter
  had a staffer saved before roles existed; the loader filled in `role` and `skill` but never
  `speed`, and that got multiplied straight into metres per second. An `undefined` there made a
  floor NPC with a NaN speed that never arrived anywhere. No error, no crash, just something
  that silently never happens. In a CRPG the equivalent is a stat, a resistance or a condition
  added in a later version.
- **`mountSaveBar` takes a `buttons` option** (`["export", "import"]`, etc.) and each button
  carries `data-gvb="export|import|reset"` so a driver can click it without depending on label
  text or order. **Put the bar somewhere reachable during play**, not only on a title screen —
  v7 §9 has an item open specifically because The Fourth Quarter's is only on its start screen,
  so exporting mid-game means reloading the page.
- **Import relatively** — `../assets/js/gvb-save.js`, not `/assets/js/gvb-save.js` — so any
  Node test can resolve the path.
- **A missing hook is a Shared-file request, not an edit** to `gvb-save.js`. Six projects read
  that file. Write the exact signature you need and work around it locally meanwhile.

**Other things worth an opinion:**

- **How much game is here?** 1,190 lines is small for a CRPG. Play it end to end and say what
  exists: how many encounters, how much map, whether there is a build to make. Then say what
  the cheapest thing is that would double the play time. Content, not systems, is usually the
  answer, and content is what the next item is about.
- **Is the content data-driven?** If encounters, items and maps are hardcoded in JS, adding an
  area means editing the engine. A JSON content format — the way Torchbearer next door has one,
  with an authoring guide — is what turns a demo into something you keep adding to. Read
  `Projects/Torchbearer files/content-authoring-guide.md` for a same-repo precedent.
- **PF2e rules data is next door.** `Pathfinder/data/` has 24 JSON files: ancestries, classes,
  feats, spells, heritages, backgrounds, deities, conditions, hazards, treasure, weapons, armor.
  A Remaster CRPG that read real rules data instead of a hardcoded subset would be a different
  game. **You do not own that folder** — this belongs in the plan and in Shared-file requests,
  not in code this session.
- **1,190 lines in one file** is not yet a problem. If you add a content format and a save
  system it will be. You may restructure into `Projects/absalom-inheritance/index.html` plus
  `js/` and `css/`; **it breaks the URL**, so the board `href` becomes a Shared-file request and
  you should say plainly that `/Projects/absalom_inheritance.html` stops resolving. Note the
  current filename uses an underscore where most of the repo uses hyphens, so a restructure is
  also a chance to fix that.
- **No preview and no OG card.** Getting one means a recipe in `Tools/board-check/games.mjs` and
  a run of `npm run previews`, both prompt 21's. If you think it deserves one, request it and
  say what the frame should show. Locked decision #28: a preview is a frame from *play* and the
  capture has to prove it got there. An isometric CRPG is a good screenshot, so this is worth
  asking for.
- **Isometric rendering and input.** Check it at 375×812 and with keyboard only. Isometric
  click-to-move is one of the harder things to make accessible; say what state it is in.

## Verification

This game has no test suite. If you add a save system, it needs one — put it in a folder you
own and make it exit non-zero on failure (locked decision #13).

- Open the page in a real browser and play it end to end. You cannot plan improvements to a game
  you have not finished.
- Once a save exists, test the full round trip by hand: save, close the tab, reopen, confirm the
  same state. Then export to a file, clear storage, import, confirm the same state again. Then
  feed it a deliberately corrupt file and confirm it is refused rather than loaded.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you
  finish, especially if you renamed anything — this is the sweep that catches a broken link.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited
  inside the `gvb:social` markers.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch
  it fail. A save test that passes against a game with no save is not a test.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/11-absalom-inheritance-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v8.md` gets assembled from all twenty-one of them.

Use these headings:

```
# The Absalom Inheritance — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, in prose, with paths. **If you added a save, name
  the storage key explicitly** — it is now permanent and the next session needs to know it.
- **What I verified** — actual commands, actual output. Include the save round trip and the
  corrupt-file test. "Should work" is not verification.
- **Shared-file requests** — a new board `href` if you restructured, a preview recipe if you want
  one, anything you need from `Pathfinder/data/`, any `gvb-save.js` gap with the exact hook
  signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort. Be honest about how much game there is; that
  number is the most useful thing you can hand forward.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
