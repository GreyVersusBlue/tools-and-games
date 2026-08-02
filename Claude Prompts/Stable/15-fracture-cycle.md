# 15 — The Fracture Cycle

**This project has had nothing outstanding for two rounds running.** Round 1 (2026-07-30) fixed
the one real bug this game had, added a save, vendored fonts, fixed two accessibility issues, and
got a preview/OG card. Round 2 (2026-08-01) opened the file, checked every one of round 1's claims
against the live repo, and made **zero edits** — everything held: all 5 endings still reachable
(`node Projects/the-fracture-cycle/test/smoke.mjs` → 26 passed, 0 failed, re-confirmed at this
refresh), fonts still vendored (0 offsite requests), preview/OG still present. Round 2's own notes
suggested this prompt might not belong in every round's default rotation at all — that's exactly
what moving it to `Claude Prompts/Stable/` does. See `Claude Prompts/README.md` for what living here
means: not archived, still re-surveyed every round, moves back to the live folder the moment
something real changes.

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
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 22. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `assets/previews/fracture-cycle.jpg`, `assets/og/fracture-cycle.jpg` | Generated. Prompt 22. This game has both — see "What is actually here." |
| `Tools/board-check/**` | Shared dev tooling. Prompt 22. |
| `Projects/daredevil/` | Prompt 13. The repo's other `Narrative` game, and about 10x your size — restructured into a folder this round; the old `Projects/daredevil_r4.html` is now just a redirect stub. |
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
2. **`Claude Prompts/notes/15-fracture-cycle-notes.md`** — round 2's session: a full re-verification
   pass, zero edits, everything confirmed still true. Read it first; it's short. Round 1's original
   session (the full branch map, the align-gate fix, the save/font/accessibility work) is archived
   at `Claude Prompts/archive/round-1/notes/15-fracture-cycle-notes.md` — read that one for the
   actual branch-map detail, since round 2 didn't re-derive it.
3. `gvb-site-handoff-v9.md` §10 (locked decisions — #51-53 are new this round) and §8 (backlog
   state).
4. `assets/js/gvb-save.js` and `assets/js/README.md` if you touch the save at all. Unchanged for
   this project's purposes since round 1 — `defaults`, `repair`, `validate` and `mountSaveBar`'s
   `buttons` option already cover everything this game needs.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** This game has none — its three fonts are vendored locally in
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
  instead"** (locked decision #44). `check-integrity.mjs` runs a static source sweep of every
  `.html` file for offsite hosts — if you touch fonts or add any external reference, run
  `cd Tools/board-check && npm run check` and trust its output over a hand grep.
- **A real-time movement or physics assertion failing under this environment's Linux/software-
  rendered Chromium is inconclusive, not confirmed** (locked decision #53). Doesn't affect this
  project directly — it's a static CYOA, no three.js, no real-time physics — but worth knowing if
  you script anything through `harness.mjs`.

## What is actually here

799 lines in one file, ~38.9 KB. Title: "The Fracture Cycle — A Dota 2 Lore CYOA". Tagged
`Narrative` on the board, sealed with the book glyph. **Round 1 gave it a preview and an OG card**
(`assets/previews/fracture-cycle.jpg`, `assets/og/fracture-cycle.jpg`) — the capture landed on the
"The Sanctuary's Dawn" ending after 8 choices, with the endings-discovered tracker and save
controls both visible in frame. Still the **smallest game in the repo by a wide margin**.

**25 nodes, 5 endings, all reachable.** Three prongs (Radiant/Dire/Invoker) converge at a hub, then
either push to a final confrontation or detour through side content, then a fork with 5 possible
endings gated on accumulated `align`, `favor.invoker`, and fragment count. Full branch map, choice-
point count, and run-length estimate are in round 1's archived notes.

**A save exists, and it's deliberately an ending tracker, not a mid-story save.**
`Projects/the-fracture-cycle/save-config.js`, wired through `assets/js/gvb-save.js`, storage key
`fracture-cycle-v1`. It holds exactly one thing: which of the 5 ending ids you've seen across every
playthrough. `reset` is deliberately not mounted — the page already has its own "Begin the Cycle
Anew" button.

**Fonts are vendored, zero offsite requests.** Cinzel, EB Garamond, JetBrains Mono, local woff2 in
`Projects/the-fracture-cycle/fonts/` — 108 KB, 5 files.

**Two accessibility fixes from round 1 still hold.** `#nodeTitle` is a real `<h2>`. `.node-title.
dire-tone`'s contrast is ~4.9:1, clearing the 3:1 WCAG AA floor.

**A one-line fan-work notice** sits under the restart button.

**A test suite exists:** `Projects/the-fracture-cycle/test/smoke.mjs`, 26 checks, 0 failed, unchanged
across two rounds. Not part of `npm run games` — this project owns its own test folder rather than
a `play-games.mjs` recipe for regression beats; the shared suite only has a preview-capture recipe
for this game.

## Your task

**Two rounds running with nothing outstanding.** The one real bug (the unreachable ending) is
fixed, the save question is answered and implemented, the fonts are vendored, the accessibility
issues are fixed, and the test suite passes. Read both notes files before assuming otherwise — don't
invent busywork for a 799-line game with every ending reachable, a working save, no offsite
requests, and no known accessibility or mobile issues.

**The list below is only for if Devon deliberately decides to expand scope** — none of it is an
obvious next step:

1. **A 4th prong, or deeper side content.** The three existing prongs and the side-hub detour are
   each a complete beginning/middle/payoff shape, not truncated. Adding more would be new content
   Devon chooses to commission, not a gap being filled. If you do this, replay every existing path
   afterward — a narrative game that silently loses a branch gives no error, the choice just isn't
   there.
2. **Re-verify the branch map after any future edit.** If a later round touches the story logic at
   all, rerun `node Projects/the-fracture-cycle/test/smoke.mjs` and replay by hand.
3. **Nothing else.** If you open this prompt and the game is untouched since round 2, the honest
   move is to say so in your notes, confirm the numbers below, and move to something with real
   backlog. Don't feel obligated to find work here.

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
  #44) — as of this refresh: **335 units checked, 0 broken; 0 collisions across nine widths,
  tightest vertical gap 3.5px**. `npm run social:check` → **17 notices, 17 already current** (down
  from 22 — Devon consolidated six standalone Tools notices into one "School Tools" card this
  round; a real, correct drop, not a regression).
- Locked decision #34: for any new guard-rail, break the thing on purpose first and watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time. This game's own `test/smoke.mjs` is plain Node and has no such restriction, and
none of its assertions are timing-sensitive, so locked decision #53 (real-time assertions unreliable
on this environment's software-rendered Chromium) doesn't touch it either.

## Output: your notes file

Write `Claude Prompts/notes/15-fracture-cycle-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — `gvb-site-handoff-v*.md`
gets assembled from all the projects' notes files each round.

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
points, endings, whether branches reconverge, run length, and whether the story is finished. If
nothing changed, say the branch map is unchanged from round 1's notes rather than re-deriving it
from scratch, and cite the file (`Claude Prompts/archive/round-1/notes/15-fracture-cycle-notes.md`).

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
