# tools & games — how this repo works

A static site at [greyversusblue.com](https://greyversusblue.com): browser
games under `Projects/`, classroom tools under `Tools/`, the Numina rules site
under `Numina/`, PF2e Remaster reference data under `Pathfinder/`, and shared
media and JS under `assets/` and `Audio/`. The repo root is served whole
(Firebase Hosting was dropped on 2026-09-23 and `firebase.json` with it; the
`CNAME` and `.nojekyll` files are the host's config now), so **every file here
is a live URL**, markdown included, and nothing can be hidden from the web by
an ignore rule any more.

**`BACKLOG.md` is the entry point. `HISTORY.md` is the record. `ARCHIVE.md`
is work that will not be done.** Open work is ranked in `BACKLOG.md`; the
per-project `WISHLIST.md` files hold the plans it links to. Nothing open lives
in `HISTORY.md`, and nothing that already shipped belongs in `BACKLOG.md`.

**The five teaching tools under `Tools/` are archived** (locked decision #206,
2026-09-08): the Final Grade Checker, Image to PDF, Name Picker, Seating Chart
Generator and Schedule Visualizer are no longer maintained or improved here.
Their pages still serve and their suites still pass — nothing was deleted — but
do not open work against them, and do not move a row back out of `ARCHIVE.md`.
`Tools/board-check/` is not a teaching tool and is not archived; neither is
`Tools/prompt-builder.html`, whose fonts are vendored now (#354) and which owns
its own area in `Tools/board-check/ownership.json` (#355).

`Projects/bell-to-bell/CLAUDE.md` governs inside its own folder; where it and
this file disagree about anything under `Projects/bell-to-bell/`, it wins.

**Castle Conundrum left this repo on 2026-09-15** (#491). It lives in
[`GreyVersusBlue/castle-conundrum`](https://github.com/GreyVersusBlue/castle-conundrum)
now, with its history, its seven phase plans, its eight suites and its own CI.
Nothing about it is open here and nothing about it should be opened here.
`HISTORY.md` keeps a pointer rather than a copy of its 102 locked decisions, and
`Tools/board-check/play-castle.mjs` went with it. **Three things of its stayed**:
the board card in `index.html` and `landing.html`,
`assets/previews/castle-conundrum.jpg` and `assets/og/castle-conundrum.jpg`.
The card links <https://greyversusblue.github.io/castle-conundrum/> now (#493),
so the page is offsite as far as every check here is concerned and
`sync-social-tags.mjs` skips it the same way it skips the aspermylessonplan.com
notice. The two images are still served from here and
`promote-previews.mjs`/`candidates/chosen.json` still know the slug, so a
capture taken in the other repo can be dropped into `candidates/` and promoted
from here.

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
  literally nothing, and Absalom's stride sweep went on passing against a
  deliberately inverted planner because the sweep had re-implemented it. A test
  that re-implements the thing it checks is not a check. Watch it fail from a
  green baseline, and read the failure message: a suite that dies of
  `ERR_MODULE_NOT_FOUND` is not catching your bug. And watch **which**
  assertion fails: a break caught by a different assertion than the one whose
  comment claims it means that comment is wrong. Two lines guarding the same
  absence stay green when either is deleted, so a test written against the pair
  is testing neither. Absalom's Phase 2 shipped that twice in one file. And when
  a break leaves the suite green, ask whether the assertion's *comment* is the
  thing that is wrong: a claim the arithmetic cannot distinguish is worth
  keeping only if it says so out loud (#147).
- **Assert against the DOM for anything that just happened, and against the
  save only for what a reload has to survive** (#39).
- **A real-time movement or physics assertion failing under a Linux/software-
  rendered Chromium is inconclusive, not confirmed** (#53). Re-verify from a
  machine with real GPU compositing before trusting either a pass or a fail.
- **A scroll container that centres its content needs `safe`** (#132).
  `overflow-y:auto` plus `justify-content:center` puts the overflow *above* the
  scroll origin, where nothing can reach it. Torchbearer's title screen lost its
  top three buttons to this the day it grew a fourth shelf card, with 1,531
  Node assertions green.

`HISTORY.md` carries the locked decisions by number, **one short entry each**
(bold rule, one to three sentences of why), then a log of one paragraph per
phase or batch. It was cut from 11,791 lines to about 1,300 on 2026-09-23; the
long form of any entry is `git show ce70ad9:HISTORY.md`. Keep new entries in the
same shape and append them; do not grow it back. **#389 to #394 and #411 to
#490 are Castle Conundrum's and moved with the project**, and this file keeps a
pointer where they were. A number in that band cited by code in
*this* repo resolves in the other one. This repo's own numbering continues from
#491, and so does theirs — from #491 the two files number independently (#492),
so a number means the file it is written in.

## Writing style

The handoffs have a voice: direct, specific, no em dashes, no rule-of-three
padding, no corporate throat-clearing. Numbers over adjectives. When something
was wrong, say what was wrong and what the evidence was. Match it. Do not
write "comprehensive" or "robust" anywhere.

## The npm scripts, and where each one runs

There is no root `package.json`. Six `package.json` files exist, and only
`Tools/board-check/` carries the site-wide scripts:

| Where | Scripts |
| --- | --- |
| `Tools/board-check/` | `check` (integrity + collisions), `integrity`, `collisions`, `games`, `tools`, `shoot`, `previews`, `promote`, `social`, `social:check` |
| `Numina/` | `build`, `clean`, `serve`, `test` |
| `Numina/test/a11y/` | none — run `node axe.mjs` and `node layout.mjs` directly, after `npm install && npx playwright install chromium` in that folder |
| `Projects/Ren-Faire-Claude/` | `test`, `shoot` (the layout camera), `touch` (the readout on a real touchscreen) |
| `Projects/hearth/test/` | `soak`, `determinism`, `save`, `nan` |
| `Projects/bell-to-bell/` | none — run `node tests/smoke.mjs` and `node tests/balance.mjs` directly |

Every other project's suite is a bare `node` invocation against a file under
its own `test/` or `tools/` folder. `Projects/school-generator/` is the one
with a non-obvious form: `node --test 'test/*.test.mjs'` (quoted glob — plain
`node --test test/` fails with `MODULE_NOT_FOUND` on Node 22).

**`npm run games` and `npm run previews` open real, visible
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

**Size the batch by the Size column and by how many areas it spans** (#382), never by a
count. Rows all in one area: up to 6 quarters, 3 halves, or one 1 plus two quarters. Rows
spanning areas: 4 quarters, 2 halves, or one 1. A 2+ row is the whole batch either way. The
second axis is there because what scales with a batch is the closeout — a suite, a
`HISTORY.md` entry and a backlog rewrite per area — not the code. **Whatever the batch, it
merges to `main` as one PR** — every row in the batch, never one PR per row. A 2+ row will
not finish in one session — do one increment, ship it, and leave the row in place with its
text rewritten to say what is done. Never mix a 2+ row into a batch with others.
`BACKLOG.md`'s "How this repo is worked" carries the table, the measurements behind it, and
the prompt a session is started with.

Still not a session's call: **re-ranking the list wholesale**, and **overruling the
Ownership table**.

**Three subagents live in `.claude/agents/`** (#533), carried over from Castle
Conundrum's split and rewritten against this repo's own files instead of its
`SPECS.md`/`ROADMAP.md`: `architect` (opus) makes the judgement call a row
needs before it can be built — a locked decision, a storage-key or
`migrate`/`repair` change, an assertion moved across a suite line, a Size or
Model call — and writes down what the next `builder` increment is. `builder`
(opus) ships that increment inside one area's Ownership once every open call
is already resolved, and never touches `HISTORY.md` or `BACKLOG.md` itself.
`scribe` (sonnet) does the bookkeeping afterward: the `BACKLOG.md`
header/ranks/Claimed column, the `HISTORY.md` entry, retiring a row into
`ARCHIVE.md`. Using them is optional — a session can still do all three
itself, as before — but a session that delegates keeps the lead role: it
still claims the row on `main` first, still opens the one PR for the whole
batch, and still owns the definition of done below.

## Ownership, and claiming a row

The parallel-round system that used to keep sessions off each other's files is
retired. Two things replace it:

1. **The Ownership table in `BACKLOG.md`** says which paths each area owns and
   which shared paths it may not touch on its own.
2. **The `Claimed` column in `BACKLOG.md`'s ranked table.** Write your branch
   name into the row before you start; clear it after your merge is confirmed.
   A row with somebody else's branch in it is taken. **The claim has to be on
   `main` to be seen** (#283): commit it alone, open a PR, merge it, then
   start. Two sessions once built the same row in full because each had
   claimed it on a branch the other could not read.

**Shared-file edits go in the same PR as the project change now, not in a
request queue.** The four shared things — `index.html`, `assets/js/gvb-save.js`,
`Tools/board-check/**`, and the generated `assets/previews` + `assets/og` —
used to belong to one session, and everyone else queued a written request for
them. That queue is gone. If your change needs one of them, make the edit in
your own branch, in the same commit, and say so in the PR body.

## Definition of done for a session

1. The work is on a branch, and the branch is a pull request — **one PR for the whole
   batch**, whatever its size, not one per row.
2. Every suite the change could touch passes, run from the directory that owns
   it (see the table above). At minimum:
   `cd Tools/board-check && npm run check && npm run social:check`. **Both are
   green on `main` as of 2026-09-13** (#354 to #358), and
   `Tools/board-check/known-failures.json` is empty in all three sections.
   `.github/workflows/site-ci.yml` runs `node ci-check.mjs`, which fails a PR
   that adds a failure not in that list and a PR that fixes one without deleting
   its line (#352). Run it rather than reading the output yourself. An empty list
   is the goal state: the next entry to land there should have to argue for
   itself.
3. Any guard-rail you added has been broken on purpose once, and you watched it
   fail (#34).
4. The PR merged to `main` with CI green.
5. The closing report names the next open item's rank and its model, so
   whoever opens the next session knows which row to take.
6. **Update `BACKLOG.md` as soon as your merge is confirmed** — its header (the
   last **batch of ranked work** that shipped and its PR number, the ranked-item
   count, what to pick up next), the ranks if your work reordered anything, and
   the `Claimed` column, which your row should no longer be in. A PR that only
   changes `BACKLOG.md`, `HISTORY.md` or this file is not a batch and does not
   take that line (#382). **Never leave this for a later
   session.** It is the rule most likely to be dropped as batches grow, and its
   casualty is on record in the sibling repo (`GreyVersusBlue/AI_Tools`): a
   session batched two phases, saved both backlog rewrites for the end, and its
   first PR merged with the row still in the ranked table — the next session
   spent an hour rebuilding what already existed.
7. **The session's last message ends with a handoff prompt** (#600): one fenced
   block, ready to paste into a fresh session, that starts the next piece of
   work. It names the row (rank, Size, Model, area), the plan it points at
   (`WISHLIST.md` item, or the `BACKLOG.md` section), the open call the next
   session has to make first if there is one, the `HISTORY.md` decisions the
   work builds on, what cost this session time and how to avoid it, the setup
   and the suites to run with their current counts, and the house rules that
   bite on that row. It goes in the chat, not in a file: every file here is a
   live URL, and a handoff file would be stale by the next merge. When the
   next row is a 2+, the prompt is for its next increment; when this session
   stopped mid-row, it says exactly where.
