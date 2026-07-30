# 15 — The Fracture Cycle

You are working on The Fracture Cycle, a choose-your-own-adventure set in Dota 2's lore, on
greyversusblue.com. At 675 lines it is the **smallest game in the repo**, which makes it the one
where a session can plausibly finish something end to end. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/the-fracture-cycle.html` (675 lines, 35 KB)
- Any new folder you create under `Projects/` **named for this game** — e.g.
  `Projects/the-fracture-cycle/`

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
| `Projects/daredevil_r4.html` | Prompt 13. The repo's other `Narrative` game, and 10× your size. |
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
2. `gvb-site-handoff-v7.md` §10 (locked decisions), §8 (backlog state), §1 (the shared save
   module), §9 (the two open save-design questions).
3. `assets/js/gvb-save.js` and `assets/js/README.md`, plus
   `Projects/fourth-quarter/js/campaign.js` as the worked example.
4. `gvb-site-handoff-v6.md` §1 and §3 on how previews and OG cards get made, and locked decisions
   #28, #29, #31, #32 — relevant because this game has no preview and probably should.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** You have three font hotlinks — see below.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). You currently have none. Whatever you pick
  is the name it keeps forever.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` — a
  bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).

## What is actually here

675 lines in one file, 35 KB. Title: "The Fracture Cycle — A Dota 2 Lore CYOA". Tagged `Narrative`
on the board, sealed with the book glyph. No preview and no OG image, unlike the seven games that
have them. **The smallest game in the repo by a wide margin** — the next smallest, Integer Foundry,
is 935 lines and it is a puzzle game with a whole tile engine.

**No persistence at all.** Zero `localStorage` calls, no export, no import. A branching story you
cannot bookmark, and one where discovering you took a wrong turn means starting over.

**It hotlinks three Google Font families** — Cinzel, EB Garamond and JetBrains Mono — at lines 24
and 25. v7 §5 claims the site makes zero offsite requests site-wide. That is wrong for fifteen
pages, and the suite cannot see it: `prepPage()` in `Tools/board-check/harness.mjs` *fulfills*
Google Fonts requests locally from bundled `@fontsource` packages before the blocked-list check
runs, so font hotlinks never reach `page.__blocked`. **JetBrains Mono** is already on disk in
`Tools/board-check/node_modules/@fontsource/`; Cinzel and EB Garamond are not. Nothing at runtime
may reference `node_modules` either way.

**A licensing note worth thinking about, not worrying about.** This is a fan work using Valve's
Dota 2 setting on a personal site with no monetisation, which is the same footing as thousands of
fan works and Valve is famously relaxed about it. Nothing here needs fixing. But if the page does
not already say it is an unofficial fan work, adding one line is cheap and honest, and it is the
kind of thing that is easier to add now than to be asked about later. Your call; mention it either
way.

## Your task

There is no handoff backlog for this game. It has never been the subject of a session.

**675 lines is small enough that you can genuinely finish things here.** Treat that as the
opportunity: this is the one prompt in the set where "leave it in a state where nothing is
outstanding" is realistic. Prefer completing three items to starting six.

**Task one: play it to every ending and map it.** All of them — at 675 lines that is achievable.
Write down the branch structure: how many choice points, how many endings, whether branches
reconverge or stay split, and how long a run takes. That map does not exist anywhere and everything
below depends on it.

**Task two: give it a save.** Adopt `assets/js/gvb-save.js` rather than hand-rolling. You get
`localStorage` persistence, file export and import, a memory-backed fallback for browsers that
block storage (reading the `localStorage` property *throws outright* in that configuration, which
a naive `try/catch` around `setItem` never reaches), and validation so a corrupt blob is refused
rather than `JSON.parse`d into state.

For a CYOA the design question is what the save holds, and it matters more than the plumbing:

- **A node id plus a flag set is small and survives you rewriting the prose.** A serialised engine
  state does not. If you want to keep editing the story after players have saves, the save must not
  embed the story.
- **Consider whether a CYOA wants a save at all, or wants something better.** Two alternatives worth
  weighing in the plan: a visible "you have seen 6 of 9 endings" tracker, which turns replaying from
  a chore into the point; or a shareable URL that encodes the path, which needs no storage at all and
  is a better fit for a short branching story than a save slot is. **Say which you chose and why.**
  An ending tracker plus no mid-story save is a completely defensible answer for a fifteen-minute
  game, and it is more interesting than the obvious one.

If you do adopt the module, the specifics that bit the first adopter (v7 §1 and §2):

- **Pick the key once and keep it forever** (locked decision #36). Something like
  `fracture-cycle-v1`.
- **`defaults` may be a factory** — if a new run randomises anything, pass a function, or
  `slot.reset()` hands back `null`.
- **Fill-ins go in `repair`, not `migrate`** (locked decision #37): `repair` runs on every accepted
  load from every door, `migrate` only on version drift. You have no legacy saves, so this is the one
  chance to get the shape right before you do.
- **`mountSaveBar` takes a `buttons` option** and each button carries
  `data-gvb="export|import|reset"`. Put it somewhere reachable during play — v7 §9 has an item open
  because The Fourth Quarter's is only on its start screen.
- **Import relatively** — `../assets/js/gvb-save.js` — so any Node test can resolve it.
- **A missing hook is a Shared-file request, not an edit** to `gvb-save.js`.

**Task three: vendor the three fonts.** Cinzel, EB Garamond, JetBrains Mono. Local `@font-face`,
woff2 in a folder you own, hotlinks deleted, only the weights the page uses — read the CSS and
check. README naming source and licence, the way `Projects/golden-hour-beach/assets/textures/` does.
Measure and report the total (locked decision #42).

**Task four: ask whether the story is finished.** 675 lines is short for a CYOA, and the honest
question after mapping it is whether the branch structure is complete or whether it narrows to one
path. If a branch dead-ends where it shouldn't, that is content work and content work is what this
game most likely needs. Say what you found, and if you write more, say how much.

**Task five: audit and plan the rest.** Worth an opinion:

- **No preview and no OG card.** Getting one means a recipe in `Tools/board-check/games.mjs` and a
  run of `npm run previews`, both prompt 21's. Request it and say what the frame should show. Locked
  decision #28: a preview is a frame from *play* and the capture has to prove it got there. Locked
  decision #29: a turn-based game legitimately gets `live: false`; don't animate something to satisfy
  a motion check.
- **675 lines does not need restructuring** and you should probably say so rather than doing it. If
  you split it anyway, `/Projects/the-fracture-cycle.html` stops resolving and the board `href` is a
  Shared-file request.
- **Mobile.** 375×812. A text-and-choices game is the best mobile candidate on the site; check
  whether it works.
- **Accessibility.** Heading order, contrast, keyboard navigation, whether choices are reachable
  without a mouse, and whether the prose reads sensibly to a screen reader. A narrative game has the
  least excuse for getting this wrong.

## Verification

This game has no test suite. At 675 lines a small one is cheap, and if you add a save it is worth
having — put it in a folder you own and make it exit non-zero on failure (locked decision #13). A
reachability test that walks every branch and asserts every ending is hit is exactly the right size
for this game.

- **Play every path before you change anything**, and write down what you did. That is your
  regression baseline and nothing else exists.
- If you restructure or edit the prose, **replay every path afterwards.** A narrative game that
  silently loses a branch gives you no error — the choice just isn't there. Nothing catches that but
  a human or a walk test.
- Once a save or tracker exists, test it by hand: mid-story, reload, confirm you are where you were.
  Export, clear storage, import, confirm again. Corrupt file, refused.
- After vendoring, grep the file for `fonts.googleapis.com` → zero hits. `page.__blocked` is **not**
  the check; `prepPage()` fulfills those requests.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. `npm run social:check`
  → 23 notices, 23 already current.
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

## Output: your notes file

Write `Claude Prompts/notes/15-fracture-cycle-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — `gvb-site-handoff-v8.md` gets
assembled from all twenty-one of them.

Use these headings:

```
# The Fracture Cycle — session notes

## The branch map
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Write the branch map** — choice
points, endings, whether branches reconverge, run length, and whether the story is finished. At 675
lines you can actually know all of that, and nobody currently does.

- **What changed** — files touched and why, with paths. Vendored font total in KB. If you wrote
  prose, how much.
- **What I verified** — actual commands, actual output, and which paths you played. "Should work" is
  not verification.
- **Shared-file requests** — a preview recipe if you want one, a board `href` if you restructured,
  any `gvb-save.js` gap with the exact hook signature. Applicable blind. Empty is fine; keep the
  heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason. **"This game is small and finished, and here is why adding X would make it worse" is a
  strong answer here**, more so than in any other prompt in this set.
- **Next session** — ordered by value per effort. If there is genuinely nothing left, say that.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
