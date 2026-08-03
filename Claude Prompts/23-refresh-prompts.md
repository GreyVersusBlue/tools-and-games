# 23 — Refresh the prompts

You are not working on a project. You are maintaining the twenty-two prompts in
`Claude Prompts/`, so they describe the site as it is now rather than as it was when they were
written.

**Run this between rounds**, after prompts 01–21 have finished and prompt 22 has applied their
shared-file requests and written the new handoff. Then round two uses the refreshed prompts.

This is a general prompt, not a one-off. It handles all twenty-two files and it is designed to be
run again after every round. Nothing in it is specific to round one.

## Why this exists

Each project prompt has two kinds of content:

| Durable — survives many rounds | Perishable — wrong the moment a round lands |
| --- | --- |
| Ownership boundary and the off-limits table | "What is actually here" — hotlinks, storage keys, line counts, persistence gaps |
| House rules and locked decisions | The numbered task list, most of which gets done |
| Notes-file format and headings | Expected counts: `npm run games` checks, notice count, per-suite assertion totals |
| Writing style | Handoff citations, once a newer handoff exists |
| The one-browser-suite-at-a-time note | The "already on disk in `@fontsource`" shortcuts |
| Student-data rules, where they apply | Anything phrased as "there is no backlog for this project" |

Roughly 60% is durable. The other 40% actively misleads after a round: a prompt that says "it
hotlinks three Google Font families" when the thread already vendored them sends a session chasing
work that is done, and "expect 23 notices" is wrong the moment the Bestiary Gallery is deleted.

**Your job is to rewrite the perishable 40% from ground truth and leave the durable 60% alone.**

## Your boundary

You own exactly this:

- `Claude Prompts/**` — all twenty-two prompt files, both READMEs, the notes folder, and the archive
  folder you are about to create

**The entire rest of the repository is read-only to you.** You read all of it — that is the whole
job — and you change none of it.

That means no project files, no `index.html`, no `assets/js/gvb-save.js`, no `Tools/board-check/**`,
and **no handoff files**. If your survey turns up a real bug, **you do not fix it.** You write it
into the relevant prompt's task list as work for that project's next session, and you note it in
your own notes file. A refresh session that starts fixing things is a refresh session that stops
being repeatable.

You may **run** anything — the suites, the checkers, a browser — because running is reading. You may
not edit what you run.

## Required reading

1. This whole file.
2. `Claude Prompts/README.md` and `Claude Prompts/notes/README.md`.
3. **The newest `gvb-site-handoff-v*.md`.** All of it, and its locked-decisions section plus the
   earlier lists it carries forward. New locked decisions are the main durable thing that changes
   between rounds, and they have to reach every prompt they apply to.
4. **Every file in `Claude Prompts/notes/`.** These tell you what each session intended, what it
   left, and what it wants next. Treat them as testimony, not as fact — see below.
5. Prompt 22's notes file specifically, and its "Requests applied, and requests refused" section. A
   refused request is work that fell on the floor, and it needs to land in a prompt's task list or
   it is lost.

## Step one: archive

Create `Claude Prompts/archive/round-N/`, where N is one more than the highest existing
`round-*` folder, or `1` if there are none.

**Copy the entire current contents of `Claude Prompts/` into it** — all twenty-two prompt files,
`README.md`, and the whole `notes/` folder. Not a move, a copy.

The notes folder matters as much as the prompts: round two's threads will overwrite
`notes/01-anathema-archive-notes.md` with their own, and the round-one version is the only record of
what happened. Archive it or lose it.

Write `Claude Prompts/archive/round-N/README.md` with:

- Which round this was, and the site version line in `index.html` at the time (read it, don't
  assume — locked decision #9 bumps it every session).
- Which of the twenty-two prompts produced a notes file and which did not.
- One line per project: what shipped, drawn from its notes.

Do not rename, renumber or reorganise anything in the live folder. `01` stays `01`. The numbering is
in the notes filenames and in Devon's head, and a renumber breaks both.

## Step two: survey for ground truth

**Do not write the new prompts from the notes files.** A notes file records what a session claims it
did. Some of those claims will be wrong — not dishonestly, but because a thread ran out of context,
or reported a plan as an outcome, or fixed something and broke something adjacent.

For each of the twenty-one projects, open the files it owns and establish, from the file:

- **Line count and byte size.** Every prompt quotes these.
- **Offsite requests.** Grep for `fonts.googleapis.com`, `fonts.gstatic.com`,
  `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, and any other non-local host. The prompts contain a
  per-page inventory of these and it should shrink every round. Prompt 22 was asked to add a static
  sweep of exactly this to `check-integrity.mjs` — **if it exists now, run it and use its output
  instead of grepping by hand**, and say so in the refreshed prompts so the next round uses it too.
- **Storage keys and persistence.** Grep for `localStorage`, `sessionStorage`, `indexedDB`, and
  imports of `assets/js/gvb-save.js`. Several prompts say things like "no persistence at all" or
  "twelve keys, forty-six call sites, hand-rolled" — re-derive both numbers. If a project adopted
  the shared module, the prompt's whole save section changes from "adopt it" to "it is adopted, here
  is the key and here is what `repair` currently handles".
- **File layout.** Did the project restructure from a single HTML file into a folder? If so its
  ownership boundary paths are now wrong, which is a durable-section edit — one of the few you are
  allowed to make. Check `index.html` for the current `href` too.
- **Whether a test suite now exists**, where it lives, and what it reports.
- **Whether the project has a preview and OG card** in `assets/previews/` and `assets/og/`.

Then get fresh numbers by running things. Every prompt quotes expected output and every figure will
have moved:

```bash
cd Tools/board-check && npm run check
```

```bash
cd Tools/board-check && npm run social:check
```

```bash
node assets/js/gvb-save.test.mjs
```

Plus the per-project suites: `Projects/fourth-quarter/test/smoke-campaign.mjs` and
`smoke-engine.mjs`, `Projects/Closing Time/tools/smoke.mjs`,
`Projects/Ren-Faire-Claude/tests/smoke.mjs` (needs `npm install --prefix "Projects/Ren-Faire-Claude"`
once for jsdom), and any new suite a round added. Then the browser suites, `npm run games` and
`npm run play`.

**One browser suite at a time.** They open real visible windows and Chrome throttles a window nobody
is looking at — the newest handoff's section on this documents a run that failed twice and passed on
retry because someone clicked another application. If a frame-motion or walk assertion fails once and
passes on retry, that is what happened, and it is not a finding.

**Where a notes file and the repository disagree, the repository wins, and the disagreement is a
finding.** Write it in your notes with both sides. A session that reported a fix that is not on disk
is the single most valuable thing this step can surface, because everything downstream trusted it.

## Step three: rewrite each prompt

For each of the twenty-two, edit in place. Same filename, same number, same section order.

**Refresh these:**

- **"What is actually here"** — rewrite from your survey. Correct line counts, byte sizes, storage
  keys, hotlink inventory, whether a suite exists, whether a preview exists. Delete facts that are no
  longer true rather than hedging them; a prompt that says "it may still hotlink fonts" is worse than
  one that says nothing.
- **The task list** — this is the biggest edit. Remove completed tasks. Promote whatever the notes'
  **Next session** section put first. Add anything prompt 22 refused, and say it was refused so the
  thread does not simply re-request it. Add anything your own survey turned up. Renumber so the
  headline task is task one.
- **Every quoted count** — checks, beats, notices, assertions, units. Any figure in the prompts that
  your run contradicts.
- **Handoff citations** — point at the newest handoff. Where a section number changed meaning between
  versions, cite the new one. Where an old section is still the best explanation of something, keep
  citing it; history does not expire.
- **"There is no handoff backlog for this project"** — false for anything that ran. Replace with a
  short statement of what the last round did and what it left.
- **The `@fontsource`-already-on-disk shortcuts** — only useful while a project still has fonts to
  vendor. Drop them once it doesn't.

**Leave these alone unless something genuinely changed:**

- The ownership boundary table, **except** where a project restructured and its paths moved, or where
  a file was deleted, or where prompt 22 handed ownership of something to a project thread.
- House rules and locked decisions — **but add any new locked decisions** from the newest handoff to
  every prompt they apply to. This is the main durable change each round and it is easy to skip. If
  the handoff numbers a new decision 43 about where the site's own fonts live, every prompt that
  vendors a font needs it.
- The notes-file format, the writing-style section, the one-suite-at-a-time note.

**Add to every project prompt, if it is not already there:** a line near the top of the required
reading telling the thread to read **its own notes file from the previous round**, at
`Claude Prompts/notes/<its-name>-notes.md`, and that the archived copies under
`Claude Prompts/archive/` hold earlier rounds. The prompt is the standing brief; the notes file is
what happened last time. A thread should read both.

**Add a "Questions for Devon" block to any prompt with a real open decision.** Some backlog items
are not code — a design call, a policy fact only Devon knows, a scope choice, a security/privacy
tradeoff. When a project's notes raise one of these (or your own survey does), do not leave it as
prose buried in a task description. Put it in a short, clearly-labeled block near the top of the
prompt, each item phrased as a direct question with enough context to answer it cold, e.g.:

```
## Questions for Devon

- Should `campaigns.html` and `characters.html`'s shared CSS/fonts actually be merged into one
  file, or does "harmonize, don't share" (locked decision #17) stay the answer? Raised
  independently three times across two rounds.
- Any report card graded between round 1 and round 2 with a QP average sitting exactly on
  3.5/2.5/1.5/0.5 got a letter one grade too high before this round's rounding fix. Worth checking
  old report cards from that window, or not?
```

Word each question so a "yes," "no," or one sentence resolves it — not "thoughts on X?" A thread
picking up this prompt reads the block first and works within whatever answer is there (or, if it's
still blank, treats the question as still open and works around it rather than guessing). Once
Devon answers a question — in conversation, in a commit, in the handoff — remove it from this block
and record the decision in the prompt's durable section (or as a new locked decision in the next
handoff) instead of leaving it to accumulate.

**Prompt 22 needs the most work**, because most of its round-one task list was one-off site surgery.
Delete what is done. Its last two tasks — apply every shared-file request, then bump the version line
and write the next handoff — are permanent and stay. Fill the gap with the site-level work the newest
handoff's suggested-next-session list puts first, plus anything the twenty notes files asked for that
is nobody's project.

**Do not rewrite this file, prompt 23.** It describes a process, not a state. Archive it, leave it.
If the process itself needs changing, say so in your notes and let Devon decide.

## Step four: the special cases

- **A project with no notes file** never ran. Leave its prompt exactly as it is and list it in your
  notes as still pending. Do not refresh a prompt against a round that did not happen to it.
- **A project whose notes say it is finished** — some prompts explicitly invite that answer, and for a
  675-line CYOA or a 748-line single-purpose tool it is a real outcome. Verify the claim against the
  file, then mark the prompt clearly at the top: **this project had nothing outstanding as of round
  N**, with the date and what was checked. Do not delete the prompt or its content.

  **Move the file into `Claude Prompts/Stable/`, keeping the exact same filename** (`Stable/15-fracture-cycle.md`,
  not a renumber). This is what makes the live `Claude Prompts/` folder show, at a glance, only what
  still needs a session — the point of Devon's own ask that started this convention. Update:
  - The boundary-table row in `Claude Prompts/README.md` to point at the new path.
  - The prompt's own notes-file pointer — it stays `Claude Prompts/notes/<name>-notes.md`; only the
    prompt file itself moves.
  - Any other prompt that cross-references this one by path.

  A stable prompt is not archived and not frozen: the next round's survey still opens it, still
  checks its claim against the live repo, and if a real change surfaces — a shared dependency shifts
  under it, Devon wants to expand its scope, a regression turns up — **move it back to the live
  folder** (reverse the same steps) and give it a real task list again. List every project you moved
  either direction in your own notes file, under a `## Stable/active moves` heading, so it isn't
  quietly lost.
- **A project that restructured** into a folder: fix its boundary paths, fix its `href` references,
  and check whether `index.html` was updated to match. If the board still points at a file that moved,
  that is a broken link on a live site — **report it at the top of your notes** and put it in prompt
  21's task list. Do not fix it yourself.
- **A project that got blocked** on a `gvb-save.js` hook prompt 22 refused: its task one is now
  "here is what was refused and why, work within it or make the case again". Say which, so the thread
  does not spend the session re-litigating a decision.
- **Two prompts that were told not to build the same shared thing** — 02 and 03, the Pathfinder twins
  — may both have recommended merging. If they agree, that is a real signal, and it belongs in your
  notes as a suggestion for Devon to run as one session with both files in scope. **Do not merge them
  yourself and do not lift the restriction**; it is what keeps them parallel-safe.

## Step five: update the READMEs

`Claude Prompts/README.md` needs:

- Any boundary table row that changed, including every project you moved into or out of `Stable/`
  this round — the path in the table has to match where the file actually lives.
- A short explanation of the `Stable/` folder if this is the first round it exists: what it means for
  a prompt to be there (nothing outstanding as of the round noted at its top, still re-surveyed every
  round, not archived), and that `archive/round-N/` is a different thing (a frozen copy of a past
  round, never re-read as a live prompt).
- Any note about counts that moved — the round-one README flags that deleting the Bestiary Gallery
  drops the board from 23 notices to 22, and that kind of note goes stale and needs replacing rather
  than accumulating.
- A short "rounds so far" section: what round N covered, which projects are done (and now live in
  `Stable/`), which are next.
  One line each.
- Anything in the "two facts these prompts were written on, which the handoff gets wrong" section
  that has since been fixed. That section was true when written. **Correct it rather than deleting
  it** — say what was wrong, that it is now fixed, and where. A prompt set that quietly rewrites its
  own history teaches the next session nothing.

`Claude Prompts/notes/README.md` needs updating only if the filename list or the required headings
changed.

## Verification

- Every one of the twenty-two prompt files still opens, still has its boundary table, and still names
  the correct notes filename — including the ones now living in `Stable/`.
- **Spot-check three refreshed prompts end to end** as if you were the thread receiving one: are the
  paths right, do the cited handoff sections exist and say what you claim, is task one actually the
  most valuable thing left, and is every count something you personally ran?
- **Grep the whole `Claude Prompts/` folder for the old counts** you replaced — "23 notices", "94
  checks", "235 units", "137 passed", whatever the previous figures were. A stale number surviving in
  one file is the most likely failure of this session, because these figures repeat across twenty-two
  files and it only takes one miss.
- **Every prompt you moved to `Stable/` actually has nothing outstanding** — verified against the live
  repo yourself, not just carried forward the notes file's own claim. Every "Questions for Devon"
  block has questions that are still genuinely unanswered as of this survey, not ones the notes files
  or the handoff already resolved.
- Confirm the archive is a complete copy, including `notes/` and `Stable/` if it exists yet, and that
  nothing in the live folder was moved rather than copied.
- Confirm your own edits are scoped to `Claude Prompts/` only: everything else `git status` shows is
  the round's already-completed project work (the twenty-one project threads' own commits-to-be, plus
  prompt 22's), not something you created. Read through it if anything looks unfamiliar, but it is not
  yours to edit.

## Step six: commit and push everything (added 2026-08-03, at Devon's explicit request)

**This is the one deliberate exception to "you touch nothing outside `Claude Prompts/`."** By the
time prompt 23 runs, a full round's worth of work — twenty-one projects plus prompt 22's shared-file
pass — usually sits uncommitted in the working tree, because nothing earlier in the cycle commits
anything. Prompt 23 runs last, so it is the natural place to close the round out with a real commit
and push, the same way prompt 22 was already the natural place to bump the version line and write the
handoff.

After Verification above passes:

1. **Run `git status` and look at it before staging anything.** Confirm what's there is what you'd
   expect from a completed round: the twenty-one projects' own changes, prompt 22's shared-file work,
   your own `Claude Prompts/**` refresh. If anything looks like unrelated in-progress work that isn't
   part of this round (an unfamiliar file, a change with no notes-file account of it anywhere), stop
   and ask rather than commit it blind — the usual git-safety judgment applies here same as anywhere
   else.
2. **Stage everything that belongs to the round** — this is a repo-wide `git add`, not scoped to
   `Claude Prompts/`, since the round's whole point was to let twenty-two parallel threads touch the
   rest of the repo. Review what actually got staged before committing, the same way you would before
   any commit: skim for anything that looks like a secret, a credential, or student data that
   shouldn't be there (see every project prompt's own "Student data" section — this is exactly the
   kind of accidental-inclusion moment those rules exist to catch).
3. **Commit with a message that names the round and the headline finds** — not just "round N". Look at
   what you wrote in `Claude Prompts/archive/round-N/README.md` and the fresh `gvb-site-handoff-v*.md`
   for the actual content; a commit message that just says "refresh" wastes the one line of `git log`
   that could have told a future reader what shipped.
4. **Push to `origin/main`.** If the push is rejected (a remote change landed since this session
   started), do not force-push — pull/rebase or merge as the situation actually calls for, the same
   judgment call you'd make for any push conflict, and say what happened in your notes.
5. **If a future round's prompt 22 or an individual project thread already committed and pushed its
   own work before prompt 23 ran** (the cycle doesn't currently require this, but nothing prevents an
   individual session from doing it), do not re-commit what's already committed — `git status`
   showing a clean tree for a given path before you even start staging is your signal that this
   already happened, and step two's own review will surface it either way.

Note in your own notes file (see below) that this step ran, what was committed, and the resulting
commit hash — this is the one part of a refresh session's own account that isn't just about
`Claude Prompts/**`.

## Output: your notes file

Write `Claude Prompts/notes/23-refresh-prompts-notes.md`.

```
# Refresh — round N notes

## Where the notes and the repository disagreed
## Fresh numbers
## What I changed in each prompt
## Stable/active moves
## Questions raised for Devon
## Projects that are done
## Projects that never ran
## Found but not fixed
## Commit and push
## Next round
```

- **Where the notes and the repository disagreed** — first, because it is the most valuable thing
  here. Any session that reported something not on disk, with both claims side by side. If there are
  none, say so plainly; that is worth knowing too.
- **Fresh numbers** — a table of every count you ran, old value and new. This is what the twenty-two
  prompts now quote, so it needs to be right.
- **What I changed in each prompt** — one or two lines each. Which tasks came off, which went on.
- **Stable/active moves** — every project moved into `Stable/` this round (with what you verified to
  justify it) and every project moved back out (with what changed that reopened it).
- **Questions raised for Devon** — every "Questions for Devon" block you added or removed this round,
  one line each: which prompt, the question, and if removed, how it was answered and where that
  answer is now recorded (a durable-section edit, a new locked decision).
- **Projects that are done** — droppable from the next round (now living in `Stable/`), with what you
  verified.
- **Projects that never ran** — prompts left untouched, still pending.
- **Found but not fixed** — bugs your survey turned up. You are forbidden from fixing them, so this
  section is the only place they exist. Say which prompt's task list you put each one in.
- **Commit and push** — per Step six: what was staged, the commit message and hash, and confirmation
  the push landed (or, if it didn't, why not and what you did instead).
- **Next round** — which prompts to run, roughly in order of value.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
