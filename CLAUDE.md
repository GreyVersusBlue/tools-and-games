# tools & games — how this repo works

A static site at [greyversusblue.com](https://greyversusblue.com): browser
games under `Projects/`, classroom tools under `Tools/`, the Numina rules site
under `Numina/`, PF2e Remaster reference data under `Pathfinder/`, and shared
media and JS under `assets/` and `Audio/`. Firebase Hosting serves the repo
root whole (`firebase.json` sets `"public": "."`), so **every file here is a
live URL**, markdown included.

**`BACKLOG.md` is the entry point. `HISTORY.md` is the record.** Open work is
ranked in `BACKLOG.md`; the per-project `WISHLIST.md` files hold the plans it
links to. Nothing open lives in `HISTORY.md`, and nothing that already shipped
belongs in `BACKLOG.md`.

`Projects/bell-to-bell/CLAUDE.md` governs inside its own folder; where it and
this file disagree about anything under `Projects/bell-to-bell/`, it wins.

## House rules for every file in this repo

- **No build step.** Static files served from the repo root. Plain ES modules,
  no bundler, no transpiler, no runtime npm dependency. If it needs `npm run`
  something to work in a browser, it is wrong. (Numina is the one exception —
  an Eleventy site whose build output is committed.)
- **Zero offsite requests.** Every dependency gets vendored into the repo.
- **Each project vendors its own copy; nothing is shared across projects**
  (locked decision #17). Do not create a shared `Pathfinder/fonts/` for all
  three Pathfinder pages, and do not hoist anything up a level. A duplicated
  40 KB font beats a cross-project coupling. `assets/fonts/` is the stated
  exception, for files that are the site itself rather than a project
  (decisions #43 and #51).
- **Never change a storage key** (locked decision #36). Changing a key
  silently abandons anyone mid-use. Unversioned saves read as version 0 and
  come through `repair`.
- **`migrate` is for version drift; `repair` is for every load** (#37).
- **Windows is the dev machine.** An absolute `import()` path needs
  `pathToFileURL` — a bare `C:\...` is read by Node as URL scheme `c:` and
  refused outright. Do not lean on shell brace expansion either.
- **A check that only prints is a check that gets ignored** (#13). Anything
  you add that verifies something exits non-zero on failure.
- **Verify a guard-rail by reintroducing the bug it guards** (#34). If you add
  a test, break the thing on purpose and watch the test fail first. Two
  versions of the line-of-sight check once passed the entire suite while doing
  literally nothing.
- **Assert against the DOM for anything that just happened, and against the
  save only for what a reload has to survive** (#39).
- **A real-time movement or physics assertion failing under a Linux/software-
  rendered Chromium is inconclusive, not confirmed** (#53). Re-verify from a
  machine with real GPU compositing before trusting either a pass or a fail.

`HISTORY.md` carries all 91 locked decisions in full, by number.

## Writing style

The handoffs have a voice: direct, specific, no em dashes, no rule-of-three
padding, no corporate throat-clearing. Numbers over adjectives. When something
was wrong, say what was wrong and what the evidence was. Match it. Do not
write "comprehensive" or "robust" anywhere.

## The npm scripts, and where each one runs

There is no root `package.json`. Five `package.json` files exist, and only
`Tools/board-check/` carries the site-wide scripts:

| Where | Scripts |
| --- | --- |
| `Tools/board-check/` | `check` (integrity + collisions), `integrity`, `collisions`, `play` (Castle Conundrum), `games`, `tools`, `shoot`, `previews`, `promote`, `social`, `social:check` |
| `Numina/` | `build`, `clean`, `serve`, `test` |
| `Projects/Ren-Faire-Claude/` | `test` |
| `Projects/hearth/test/` | `soak`, `determinism`, `save`, `nan` |
| `Projects/bell-to-bell/` | none — run `node tests/smoke.mjs` and `node tests/balance.mjs` directly |

Every other project's suite is a bare `node` invocation against a file under
its own `test/` or `tools/` folder. `Projects/school-generator/` is the one
with a non-obvious form: `node --test 'test/*.test.mjs'` (quoted glob — plain
`node --test test/` fails with `MODULE_NOT_FOUND` on Node 22).

**`npm run games`, `npm run play` and `npm run previews` open real, visible
browser windows.** Only one at a time — two will steal focus from each other
and produce frame-motion and walk failures that look exactly like bugs.

## How this repo is worked

**The standing instruction is "work the next batch of ranked items in `BACKLOG.md`, open a
PR, merge to `main`."** It runs unattended; Devon is not reviewing these rounds (2026-09-05).
So: **never stop to ask.** If a row needs a judgement call, decide it, ship it, and record
the call in `HISTORY.md` as a locked decision so it can be reversed cheaply. A row in
`BACKLOG.md`'s "Questions for Devon" **no longer blocks its work** — but answer only the
question actually standing in front of your row, not the list; Devon intends to work through
the rest himself.

**Size the batch by the Size column, never by a count:** up to 4 quarter-session rows (they
may share one PR), 2–3 half-session rows, one 1-session row, or a single 2+ row on its own.
A 2+ row will not finish in one session — do one increment, ship it, and leave the row in
place with its text rewritten to say what is done. Never mix a 2+ row into a batch with
others. `BACKLOG.md`'s "How this repo is worked" carries the table and the reasoning.

Still not a session's call: **re-ranking the list wholesale**, and **overruling the
Ownership table**.

## Ownership, and claiming a row

The parallel-round system that used to keep sessions off each other's files is
retired. Two things replace it:

1. **The Ownership table in `BACKLOG.md`** says which paths each area owns and
   which shared paths it may not touch on its own.
2. **The `Claimed` column in `BACKLOG.md`'s ranked table.** Write your branch
   name into the row before you start; clear it after your merge is confirmed.
   A row with somebody else's branch in it is taken.

**Shared-file edits go in the same PR as the project change now, not in a
request queue.** The four shared things — `index.html`, `assets/js/gvb-save.js`,
`Tools/board-check/**`, and the generated `assets/previews` + `assets/og` —
used to belong to one session, and everyone else queued a written request for
them. That queue is gone. If your change needs one of them, make the edit in
your own branch, in the same commit, and say so in the PR body.

## Definition of done for a session

1. The work is on a branch, and the branch is a pull request.
2. Every suite the change could touch passes, run from the directory that owns
   it (see the table above). At minimum:
   `cd Tools/board-check && npm run check && npm run social:check`.
3. Any guard-rail you added has been broken on purpose once, and you watched it
   fail (#34).
4. The PR merged to `main` with CI green.
5. The closing report names the next open item's rank and its model, so
   whoever opens the next session knows which row to take.
6. **Update `BACKLOG.md` after your merge is confirmed** — its header (the
   last thing that shipped and its PR number, the ranked-item count, what to
   pick up next), the ranks if your work reordered anything, and the `Claimed`
   column, which your row should no longer be in. **This happens after *each*
   merge, never saved for the end of a batch.** It is the rule most likely to
   be dropped as batches grow, and its casualty is on record in the sibling
   repo (`GreyVersusBlue/AI_Tools`): a session batched two phases, saved both
   backlog rewrites for the end, and its first PR merged with the row still in
   the ranked table — the next session spent an hour rebuilding what already
   existed.
