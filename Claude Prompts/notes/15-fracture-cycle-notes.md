# The Fracture Cycle — session notes

## The branch map

Unchanged from round 1. See `Claude Prompts/archive/round-1/notes/15-fracture-cycle-notes.md` for
the full write-up: 25 nodes, three prongs (Radiant/Dire/Invoker) converging at `hub_bazaar`, an
optional `side_hub` detour, and a final fork at `core_confrontation` gating 5 endings on `align`,
`favor.invoker`, and fragment count. All 5 endings reachable, 9 real choice points, 7-8 clicks for
the shortest ending, 14-16 for a completionist run.

## What changed

Nothing. This is round 2. I read the prompt's own preamble (verified again below rather than
trusted blind), then round 1's notes in full, then checked the live files against both. Every file
round 1 touched is still exactly as it left them:

- `Projects/the-fracture-cycle.html` — no diff since round 1's fix at `radiant_gate`.
- `Projects/the-fracture-cycle/save-config.js`, `fonts/`, `test/smoke.mjs` — untouched.
- `assets/previews/fracture-cycle.jpg`, `assets/og/fracture-cycle.jpg` — both present. Round 1's
  own "Shared-file requests" asked prompt 21 for exactly these two files; that request has been
  fulfilled since (this prompt's own preamble already noted it, and I confirmed both files exist).

I made no edits. There is nothing in this game that rises to "worth doing" per round 1's own
assessment, and my own pass here didn't turn up anything that assessment missed.

## What I verified

- `node Projects/the-fracture-cycle/test/smoke.mjs` → **26 passed, 0 failed.** Matches round 1's
  baseline exactly, no drift.
- `grep -c fonts.googleapis.com Projects/the-fracture-cycle.html` → **0.** Still zero offsite font
  requests.
- `ls Projects/the-fracture-cycle/fonts/` → all 5 vendored woff2 files present (Cinzel 700/900, EB
  Garamond 400 normal/italic, JetBrains Mono 400), matching round 1's 108 KB / 5-file description.
- `assets/previews/fracture-cycle.jpg` and `assets/og/fracture-cycle.jpg` both exist — round 1's one
  open shared-file request (a preview/OG card) has been fulfilled since.
- `cd Tools/board-check && npm run check` → integrity sweep found 1 broken unit, but it's
  `newindex.html` referencing `fonts.googleapis.com`/`fonts.gstatic.com` — not this project, not a
  file I own, and not touched by me. `the-fracture-cycle.html` itself is not flagged. Ran
  `node check-collisions.mjs` separately since the integrity failure short-circuited the combined
  `check` script: **0 collisions, tightest vertical gap 9.2px**, matching the prompt's own stated
  baseline exactly.
- Compared the live `Claude Prompts/notes/15-fracture-cycle-notes.md` against
  `Claude Prompts/archive/round-1/notes/15-fracture-cycle-notes.md` byte-for-byte before touching
  anything: identical. Confirms this file hadn't been overwritten yet this round and round 1's
  record was still the authoritative one going into this session.
- Did not re-run the full browser click-through of all 5 endings by hand. The prompt's own
  verification section ties that requirement to "after any change" and I made none; the automated
  smoke test already walks every reachable `(node, state)` pair from `intro` and confirms all 5
  endings hit, which is the thing a hand playthrough would otherwise be checking for. Re-clicking
  every branch with zero code changed would be process for its own sake.

## Shared-file requests

None. Round 1's only request (preview + OG card) is already fulfilled — see "What changed."

## Deliberately not done

Same list as round 1, still valid, nothing has changed to reopen any of these:

- **No restructuring.** Still one file, still small enough to hold in one read.
- **No mid-story save.** The ending-tracker design was the actual answer to what this game's replay
  loop wants, not a placeholder for a "real" save — see round 1's notes for the full reasoning.
- **No new prose / no 4th prong.** Every reachable branch has a complete beginning/middle/payoff
  shape. Adding more content is a scope decision for Devon to make deliberately, not a gap this
  session found. I looked for a truncated or dead-ending branch and didn't find one, same as round
  1 didn't.
- **No `reset` button on the save bar.** Still avoiding two adjacent erase-like controls with
  different scopes ("Begin the Cycle Anew" already exists).

## Next session

This game has had two rounds now with the same verdict: done, and confirmed done again. Ordered
by value per effort:

1. **Nothing, unless Devon deliberately expands scope.** The one thing round 1 flagged as
   outstanding (preview/OG card) is fulfilled. There is no known bug, no accessibility gap, no
   offsite request, and no reachability problem. A third round of "verify nothing changed" on an
   untouched 799-line game is worth less than a round spent on a project with real backlog.
2. **If Devon does want to expand it:** a 4th prong or deeper side content is the one path listed
   in the prompt itself. Whoever does that must replay every existing path afterward and rerun
   `smoke.mjs` — a silently lost branch gives no error in a game like this.
3. Consider whether prompt 15 belongs in every future round's default rotation at all, or should
   move to an as-needed list, given two consecutive rounds with zero changes. That's a process
   question for prompt 22, not something to decide from inside this prompt.
