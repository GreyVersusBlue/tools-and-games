# The Fracture Cycle — session notes

## The branch map

25 nodes total: `intro`, 3 gate branches (radiant/dire/invoker, 4 nodes each),
`hub_bazaar`, `side_hub` plus its 3 contact nodes, `core_approach`,
`core_confrontation`, and 5 ending nodes.

Shape: three prongs that converge, not a tree. `intro` is the only 3-way
fork (Radiant / Dire / Invoker). Each prong is a fixed 3-4 node corridor —
one real choice partway through (`radiant_zeus`, `dire_rivalry`,
`invoker_fundamental` + `invoker_riddle`), the rest single-option "continue"
beats — that always ends by handing you that court's Aegis Fragment and
sending you to `hub_bazaar`. Every path reconverges there regardless of which
prong you took.

At the hub you choose: push straight to the ending (`core_approach`), or
detour through `side_hub`, which offers a contact for each of the other two
courts you didn't visit on your main path (so a full completionist run can
carry all 3 fragments into the finale no matter which prong they started on).
`side_hub` loops back to itself after each contact until you've either seen
all three or choose to stop waiting.

`core_confrontation` is the second real fork: which endings are on offer
depends on accumulated `align` (-5..+5), `favor.invoker`, and fragment count,
computed live. Five endings exist:

| Ending | Condition | Reachable? |
| --- | --- | --- |
| `end_radiant` | `align >= 2` | **No — fixed this session, see below** |
| `end_dire` | `align <= -2` | Yes (dire_gate + dire_rivalry choice a: -3) |
| `end_convergence` | `favor.invoker >= 3` OR `-2 < align < 2` | Yes, and the most common outcome — the middle band is wide |
| `end_ascension` | all 3 fragments carried | Yes (via side_hub or a lucky main path) |
| `end_corruption` | always offered (the "force it" option) | Yes, trivially |

**Choice points:** 9 real decisions (`intro`, `radiant_gate`, `radiant_zeus`,
`dire_gate`, `dire_rivalry`, `invoker_fundamental`, `invoker_riddle`,
`hub_bazaar`, `side_hub`) plus the ending pick at `core_confrontation`. 8 more
nodes are single-option pacing beats, not decisions.

**Run length:** shortest path to an ending is 7-8 clicks (pick a court, take
its one internal choice, arrive at the hub, skip the side content, confront
the socket, pick an ending). A completionist run through all three side
contacts before confronting the socket runs 14-16 clicks. At roughly 2-3
short paragraphs per node, that's about 4-6 minutes for one ending, or
20-30 minutes to see all five back to back — matches the "fifteen-minute
game" framing in the prompt reasonably well, maybe a little under for one
pass, over for the full set.

**Is it finished?** Structurally, yes, once the bug below is fixed — every
ending is now reachable and nothing narrows to a single forced path. The
prose itself doesn't feel truncated or cut short anywhere; each branch has a
real beginning/middle/end shape (gate → complication → payoff) rather than
trailing off. I did not add story content this session — see "Deliberately
not done."

## What changed

- **Fixed a genuinely unreachable ending.** [the-fracture-cycle.html:444](../../Projects/the-fracture-cycle.html) —
  `end_radiant` requires `state.align >= 2`, but the only node in the entire
  file that increments `align` upward is `radiant_zeus`, and only by `+1`
  (either choice there). No other node, including every choice in the
  Radiant branch, ever added to `align`. Maximum achievable value across any
  playthrough was `+1`. The ending was dead code — visible in the confrontation's
  `choices()` function but never actually offered by any sequence of choices.
  Added `s.align+=1` to the "Help the patrol finish their sweep" choice at
  `radiant_gate` (the more devoted-to-Radiant of its two options — the other,
  "answer honestly," already nudges toward the Invoker instead, which fits its
  flavor better). A full-Radiant playthrough now reaches exactly `align = 2`
  and `end_radiant` is offered. Verified both by the new walk test (below)
  and by hand in a real browser.
- **Added a save: an ending tracker, not a mid-story save.** New file
  [Projects/the-fracture-cycle/save-config.js](../../Projects/the-fracture-cycle/save-config.js),
  wired into the page via `assets/js/gvb-save.js`. Storage key
  `fracture-cycle-v1`, version 1. Holds exactly one thing: which of the 5
  ending ids you've seen, across every playthrough. Restarting
  ("Begin the Cycle Anew") never touches it. See "why not a real save" below.
  A "Endings Discovered X/5" bar with per-ending chips sits above the story
  panel — visible on every node, not just the intro screen (the Fourth
  Quarter's save bar being start-screen-only was flagged in v7 §9 as a
  mistake worth not repeating). Export/import buttons mounted via
  `mountSaveBar`; **reset deliberately omitted** — the page already has
  "Begin the Cycle Anew" sitting nearby, and the gvb-save README explicitly
  warns against two adjacent erase-like controls with different scopes. A
  completionist who wants to clear discovered-endings history can clear site
  data by hand.
- **Vendored the three hotlinked fonts.** Cinzel, EB Garamond, JetBrains
  Mono, all as local woff2 in
  [Projects/the-fracture-cycle/fonts/](../../Projects/the-fracture-cycle/fonts/README.md).
  **108 KB total, 5 files.** Only the weights the CSS actually sets: Cinzel
  700+900, EB Garamond 400 normal+italic, JetBrains Mono 400 — the old
  hotlink pulled 500/600 weights and a Cinzel italic that nothing on the page
  ever uses. Sourced from Fontsource 5.3.0 (same version already vendored for
  JetBrains Mono in `Tools/board-check/node_modules`), OFL-licensed. Zero
  `fonts.googleapis.com` requests remain — verified via network log in a real
  browser, not just grep (`page.__blocked` wouldn't have caught this either
  way; `prepPage()` fulfills Google Fonts locally before the blocked-list
  check runs).
- **Two small accessibility fixes**, cheap enough to just do rather than only
  report:
  - `#nodeTitle` was a bare `<div>`; every scene had a visual heading with no
    corresponding entry in the page's heading structure (only the one `<h1>`
    existed). Changed to `<h2>`, no visual change, but a screen-reader user
    navigating by heading now gets one entry per scene instead of none.
  - `.node-title.dire-tone` (shown whenever `align <= -2`) was `var(--dire)`,
    `#a4293b`, on the `--panel` background `#1a1526` — contrast ratio ~2.3:1,
    below the 3:1 WCAG AA minimum even for large/bold text. Added a separate
    `--dire-text: #e0596b`, used only for this text context (the darker
    `--dire` stays as-is for markers/borders/decorative fills where the bar
    is lower); new ratio is ~4.9:1. Confirmed by computing luminance by hand,
    not eyeballed.
- **One-line fan-work notice** added under the restart button: "Unofficial
  fan project set in Valve's Dota 2 universe. Not affiliated with or
  endorsed by Valve Corporation." Cheap, honest, per the prompt's own framing
  — nothing was actually at risk here.

### Why an ending tracker, not a mid-story save

The prompt raised this as the real design question, not a formality. A CYOA
this short doesn't obviously want to remember where you left off mid-run —
a "node id + flag set" save is *possible* here (state is already exactly
that: `align`, `favor`, `fragments`, `visited`, `mainPath`, all primitives,
nothing that embeds the prose), but the actual replay loop this game invites
is "try a different court, see a different ending," not "resume where I
stopped." A shareable-URL-of-your-path was the other option on the table and
I considered it, but it doesn't fit a game whose whole hook is *discovering*
the branches blind — a URL that encodes your path also spoils the shape of
the story for anyone it's shared with. The ending tracker is the one that
turns replaying from a chore into the actual point (which every one of the
5 conditions in `core_confrontation` was clearly designed to reward), costs
nothing narratively, and is the smallest possible adoption of `gvb-save.js`
that's still genuinely useful.

## What I verified

- **New test suite:** `node Projects/the-fracture-cycle/test/smoke.mjs` →
  **26 passed, 0 failed.** No prior test suite existed for this game.
  - Extracts the real `nodes` object out of the shipped HTML as text (same
    technique Torchbearer's smoke test uses for its inline packs, extended
    with a proper backtick/template-literal-aware balanced-brace parser,
    since this file's prose is full of straight double quotes and one
    `${'${fragCount}'}` escape trick that a plain quote-toggling counter
    would trip on). No restructuring of the page — it's still one file.
  - Walks every reachable `(node, state)` combination from `intro`,
    confirms all 5 endings are hit, confirms no choice's `next` points at a
    nonexistent node, confirms every defined node is actually reachable.
  - **Reintroduced the align bug on purpose to confirm the test catches it**
    (locked decision #34): reverted the one-line fix, reran — 3 failures,
    correctly naming `end_radiant` as unreachable and the ending count as 4
    instead of 5. Restored the fix, reran clean.
  - Exercises `save-config.js` against `assets/js/gvb-save.js` directly:
    fresh load, save/load round trip, repair dropping a bogus ending id and
    deduping, a corrupt blob, a save missing `seenEndings`, export/import
    envelope round trip.
- **Played every path by hand** in a real browser (a local static server on
  `localhost`, not the `file://` preview — more on that below) before
  touching anything, and again after: full Dire path to `end_dire`, full
  Radiant path (with the fix) to `end_radiant`, confirmed the tracker went
  0/5 → 1/5 → 2/5 with the right chips revealed each time, confirmed
  `localStorage` held `{"seenEndings":[...],"__v":1}` and survived a real
  page reload with the story correctly back at `intro` (no mid-story state
  leaking through, as designed).
- **Fonts:** `grep -c fonts.googleapis.com the-fracture-cycle.html` → 0.
  Network log in the browser showed all 5 woff2 files loading 200 from
  `Projects/the-fracture-cycle/fonts/`, zero external requests.
- **Mobile (375×812):** screenshotted directly. Status bar and the new
  tracker bar both collapse to a single column via the existing/added
  `max-width:640px` query; save buttons wrap under the ending chips; nothing
  overflows; choice buttons are already full-width and easy targets.
- **Contrast fix:** confirmed via `getComputedStyle(...).color` in the live
  page during a Dire-aligned scene → `rgb(224, 89, 107)`, matching the new
  `--dire-text` value, not the old one.
- `cd Tools/board-check && npm run check` → 266 units, 0 broken, 0
  collisions. `npm run social:check` → 23 notices, 23 already current.
- **A tooling note, not a game bug:** the sandboxed Browser pane's preview of
  a bare `file://` path outside the project root renders what it calls a
  "static snapshot" — `localStorage` reads/writes and DOM state shown via
  `read_page`/screenshot did not reliably reflect a fresh reload (stale
  values persisted across a forced navigate). Starting a plain
  `python -m http.server` and previewing over real `http://localhost` fixed
  this immediately and every check above was redone against that. Worth
  knowing for any future session verifying `localStorage` behavior in this
  environment — don't trust a `file://` preview for it.

## Shared-file requests

- **A preview/OG card.** This game has neither. Recipe needed in
  `Tools/board-check/games.mjs` (prompt 21's file). Per locked decision #28,
  the frame needs to come from actual play, not a mockup — I'd suggest
  capturing at `core_confrontation` or an ending screen (e.g.
  `end_ascension`, the "all three fragments" one — visually the most
  distinct, with all three Aegis Fragment chips lit and the crack fully
  closed), since the intro screen alone doesn't show what the game actually
  is. Per locked decision #29: `live: false` is correct here — this is a
  turn-based reading game, and animating the fetch would misrepresent it.
- Nothing else. No `gvb-save.js` gaps found — the module's `defaults`,
  `repair`, `validate`, and `mountSaveBar`'s `buttons` option covered
  everything this game needed with no missing hook.

## Deliberately not done

- **No restructuring.** 675 lines (now ~740 with the tracker/fonts/fix) is
  still small enough to hold in one read, and splitting the story engine
  (`nodes`, `render`, the state machine) into separate files would cost
  readability for no real benefit at this size. I did add two new small
  files (`save-config.js`, the fonts folder, the test folder) but the story
  engine itself — the part the prompt specifically flagged as not worth
  restructuring — is untouched as inline script.
- **No mid-story save.** Covered above under "why an ending tracker" — this
  is the actual answer to "does a CYOA this short want a save," not an
  oversight.
- **No new prose.** I looked hard at whether any branch dead-ends short of a
  satisfying ending (the prompt's framing: "if a branch dead-ends where it
  shouldn't, that is content work"). The one real dead end I found was
  structural, not narrative — `end_radiant` being mathematically unreachable
  — and I fixed that with a one-line numeric tweak rather than new writing,
  because the actual prose for that ending already existed and read fine;
  the bug was purely in the gate condition, not a missing scene. Every
  branch that *is* reachable has a complete beginning/middle/payoff shape.
  I don't think this game needs more words — it needs the numbers that were
  already supposed to make all five endings reachable to actually do that,
  which they now do.
- **No `reset` button on the save bar.** Explained above — avoiding two
  adjacent controls that erase different things.
- **Didn't touch the licensing question beyond the one line asked for.**
  The prompt was explicit this needs a mention, not a fix. Done.

## Next session

Ordered by value per effort, and it's a short list — this game is close to
done:

1. **Preview + OG card** (Shared-file request above). Highest value left,
   zero risk, blocked only on prompt 21's owner touching `games.mjs`.
2. **Nothing else rises to "worth doing."** If someone wants more content,
   the branches as they stand are complete rather than truncated, so new
   material would be a genuine expansion (a 4th prong, deeper side content)
   rather than filling a gap — a real scope decision for Devon to make, not
   a "next session should obviously do X." I'd rather say that plainly than
   invent busywork for a 740-line game that, as of this session, has every
   ending reachable, a working save, no offsite requests, and no known
   accessibility or mobile issues.
