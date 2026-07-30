# 15 — The Fracture Cycle

**This project had nothing outstanding as of round 1, 2026-07-30, verified against the repository
just now: all 5 endings are reachable (`node Projects/the-fracture-cycle/test/smoke.mjs` → 26
passed, 0 failed), the save round-trips (`fracture-cycle-v1`, chip bar shows discovered endings
across reloads), zero offsite requests remain (`grep -c fonts.googleapis.com
Projects/the-fracture-cycle.html` → 0), and the test suite passes clean.** Round 1 fixed the one
real bug this game had — a mathematically unreachable ending — added a save, vendored its fonts,
fixed two accessibility issues, and got a preview/OG card. Its own session notes said plainly that
nothing else rises to "worth doing" absent a deliberate scope decision. This prompt stays in the
rotation, but a future round can skip it unless Devon wants to expand the story.

You are working on The Fracture Cycle, a choose-your-own-adventure set in Dota 2's lore, on
greyversusblue.com. At 799 lines it is still the **smallest game in the repo**. This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/the-fracture-cycle.html` (799 lines, ~38.9 KB)
- `Projects/the-fracture-cycle/` — `fonts/` (vendored woff2s + README), `save-config.js`,
  `test/smoke.mjs` — all added in round 1, all yours
- Any other new folder you create under `Projects/` **named for this game**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this same repo at the
same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/fracture-cycle.jpg`, `assets/og/fracture-cycle.jpg` | Generated. Prompt 21. This game now has both — see "What is actually here." |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
| `Projects/daredevil_r4.html` | Prompt 13. The repo's other `Narrative` game, and about 10x your size. |
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
2. **`Claude Prompts/notes/15-fracture-cycle-notes.md`** — round 1's session notes for this exact
   project. It has the full branch map, exactly what changed and why, and what verification was
   run. Read it before you open the HTML file. `Claude Prompts/archive/` holds earlier rounds if
   you need history beyond round 1.
3. `gvb-site-handoff-v8.md` §9 (locked decisions, all of them — 43-50 are new this round), §4 (the
   shared save module: five real gaps found and fixed since round 1, all backward-compatible), §6
   (this game's preview capture, already done).
4. `assets/js/gvb-save.js` and `assets/js/README.md` if you touch the save at all — the module
   picked up `clear()`, argument-forwarding `fresh`/`reset`, a guarded `load()`, and
   `mountSaveBar`'s `filename`/`labels` overrides since round 1 (locked decisions #47-49). None of
   this was requested by this project and none of it is a gap here — round 1's own notes confirm
   `defaults`, `repair`, `validate` and `mountSaveBar`'s `buttons` option already covered
   everything this game needed.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** This game now has none — its three fonts are vendored locally in
  `Projects/the-fracture-cycle/fonts/`.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). This game's key is `fracture-cycle-v1`. It
  keeps that name forever.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` — a
  bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).
- **`page.__blocked` is "offsite and refused"; `page.__shimmed` is "offsite and fulfilled locally
  instead"** (locked decision #44). `check-integrity.mjs` now runs a static source sweep of every
  `.html` file for offsite hosts — if you touch fonts or add any external reference, run
  `cd Tools/board-check && npm run check` and trust its output over a hand grep; it's the check
  that actually scales.

## What is actually here

799 lines in one file, ~38.9 KB. Title: "The Fracture Cycle — A Dota 2 Lore CYOA". Tagged
`Narrative` on the board, sealed with the book glyph. **Round 1 gave it a preview and an OG card**
(`assets/previews/fracture-cycle.jpg`, `assets/og/fracture-cycle.jpg`) — the capture landed on the
"The Sanctuary's Dawn" ending after 8 choices, with the endings-discovered tracker and save
controls both visible in frame. Still the **smallest game in the repo by a wide margin**.

**25 nodes, 5 endings, all reachable.** Three prongs (Radiant/Dire/Invoker) converge at a hub, then
either push to a final confrontation or detour through side content, then a fork with 5 possible
endings gated on accumulated `align`, `favor.invoker`, and fragment count. `end_radiant` was
genuinely unreachable at the start of round 1 — its `align >= 2` gate could never be hit because
the only node that ever raised `align` added just +1. Fixed with a one-line addition at
`radiant_gate`; a full-Radiant run now reaches `align = 2` and the ending is offered. See the
notes file for the full branch map, choice-point count, and run-length estimate.

**A save exists, and it's deliberately an ending tracker, not a mid-story save.** New file
`Projects/the-fracture-cycle/save-config.js`, wired through `assets/js/gvb-save.js`, storage key
`fracture-cycle-v1`. It holds exactly one thing: which of the 5 ending ids you've seen across every
playthrough. Restarting never touches it. A visible "Endings Discovered X/5" bar with per-ending
chips sits above the story panel on every node. `reset` is deliberately not mounted — the page
already has its own "Begin the Cycle Anew" button, and two adjacent erase-like controls with
different scopes is the thing the gvb-save README warns against.

**Fonts are vendored, zero offsite requests.** Cinzel, EB Garamond, JetBrains Mono, local woff2 in
`Projects/the-fracture-cycle/fonts/` — 108 KB, 5 files, only the weights the CSS actually sets.
Confirmed by grep and by a live browser network log.

**Two accessibility fixes landed.** `#nodeTitle` is now a real `<h2>` instead of a bare `<div>`
(previously the whole page had exactly one heading total). `.node-title.dire-tone`'s contrast went
from ~2.3:1 to ~4.9:1 via a new `--dire-text` variable, clearing the 3:1 WCAG AA floor.

**A one-line fan-work notice** sits under the restart button: "Unofficial fan project set in
Valve's Dota 2 universe. Not affiliated with or endorsed by Valve Corporation."

**A test suite exists:** `Projects/the-fracture-cycle/test/smoke.mjs`, 26 checks, 0 failed. Walks
every reachable `(node, state)` combination from `intro`, confirms all 5 endings are hit, confirms
no dangling `next` targets, confirms every node is reachable. Not part of `npm run games` — this
project owns its own test folder rather than a `play-games.mjs` recipe for regression beats; the
shared suite only has a preview-capture recipe for this game.

## Your task

**Round 1's own notes were explicit: there is nothing left here that rises to "worth doing."** The
one real bug (the unreachable ending) is fixed, the save question is answered and implemented, the
fonts are vendored, the accessibility issues are fixed, and a test suite exists. Read the notes
file before assuming otherwise — don't invent busywork for a 799-line game with every ending
reachable, a working save, no offsite requests, and no known accessibility or mobile issues.

**The list below is only for if Devon deliberately decides to expand scope** — none of it is an
obvious next step, and the notes file says so plainly:

1. **A 4th prong, or deeper side content.** The three existing prongs and the side-hub detour are
   each a complete beginning/middle/payoff shape, not truncated. Adding more would be new content
   Devon chooses to commission, not a gap being filled. If you do this, replay every existing path
   afterward — a narrative game that silently loses a branch gives no error, the choice just isn't
   there.
2. **Re-verify the branch map after any future edit.** If a later round touches the story logic at
   all, rerun `node Projects/the-fracture-cycle/test/smoke.mjs` and replay by hand; that suite is
   the only thing standing between an edit and a silently broken branch.
3. **Nothing else.** If you open this prompt and the game is untouched since round 1, the honest
   move is to say so in your notes and move to something with real backlog.

## Verification

If you change anything, this game already has a way to check it:

- `node Projects/the-fracture-cycle/test/smoke.mjs` → **26 passed, 0 failed** is the current
  baseline. If you edit story logic, rerun it; if you edit prose only, still rerun it (a typo in a
  `next` id breaks reachability without touching any logic).
- **Play every path by hand** after any change, not just the automated suite — a narrative game
  that silently loses a branch gives you no error.
- If you touch the save or tracker: mid-story, reload, confirm the tracker survived. Export, clear
  storage, import, confirm again. Corrupt file, refused.
- After any font or asset change, grep for `fonts.googleapis.com` → should stay at 0. Prefer
  `cd Tools/board-check && npm run check`'s static source sweep over a hand grep (locked decision
  #44) — **327 units checked, 0 broken; 0 collisions across nine widths, tightest vertical gap
  9.2px** is the current baseline. `npm run social:check` → **22 notices, 22 already current, 0
  out of date, 0 failed**.
- Locked decision #34: for any new guard-rail, break the thing on purpose first and watch it fail,
  the way round 1 did for the align-gate fix.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time. This game's own `test/smoke.mjs` is plain Node and has no such restriction.

## Output: your notes file

Write `Claude Prompts/notes/15-fracture-cycle-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — `gvb-site-handoff-v9.md`
(or whatever the next handoff is numbered) gets assembled from all the projects' notes files.

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
points, endings, whether branches reconverge, run length, and whether the story is finished. Round
1 already did this in full; if nothing changed, say the branch map is unchanged from round 1's
notes rather than re-deriving it from scratch, and cite the file.

- **What changed** — files touched and why, with paths. If nothing changed, say so plainly rather
  than padding this section.
- **What I verified** — actual commands, actual output, and which paths you played. "Should work"
  is not verification.
- **Shared-file requests** — empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason. **"This game is small and finished, and here is why adding X would make it worse" is a
  strong answer here**, more so than in any other prompt in this set.
- **Next session** — ordered by value per effort. If there is genuinely nothing left, say that.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
</content>
