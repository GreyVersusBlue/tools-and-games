# campaigns.html block generator

Turns structured JSON into the HTML blocks `campaigns.html` hand-authors
today — `<article class="campaign">`, `<div class="scenario-group">`, and
`<div class="scenario">`. Round 1 and round 2 both concluded this page
shouldn't get `localStorage`-backed editing (a DM's chronicle updates a
handful of times a year; hardcoded HTML with git history is a better fit
than browser storage that can silently drift or get cleared — see
`Claude Prompts/notes/02-pathfinder-campaigns-notes.md`). This script keeps
that property — everything still gets pasted into the page and committed —
while cutting the copy-paste-and-fix-the-quotes friction of writing the
markup by hand.

It does not touch `campaigns.html`. It only prints a block to stdout for
you to paste in and diff-review like any other edit.

## Usage

```
node generate.mjs campaign        [path/to/data.json]
node generate.mjs scenario-group  [path/to/data.json]
node generate.mjs scenario        [path/to/data.json]
```

With no path, each mode runs against its matching file in `examples/` so
you can see the expected shape before writing your own.

## Data shapes

**`campaign`** — one `<article class="campaign">` for the "As Game Master" panel.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | |
| `spineColor` | string | a CSS value, e.g. `"var(--oxblood)"` |
| `comingSoon` | boolean | adds the `.coming-soon` class (desaturates the card) |
| `ribbon` | `{text, sequel}` or `null` | `sequel: true` adds the slate `.sequel` ribbon color instead of dustrose |
| `pills` | array of string or `{text, status}` | `status` is `"completed"` or `"soon"`, or omit for a plain pill |
| `blurb` | string | |
| `roster` | array of `{name, aside?, bio}` | omit or leave empty for a coming-soon card with no roster; `aside` renders as the dim parenthetical after the name (ancestry/deity notes) |

**`scenario-group`** — one `<div class="scenario-group">` chronicle table, used
in both the By Character and Chronological views.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | element id, e.g. `"kaeta-jadeharbor-log"` |
| `characterName` | string | |
| `characterAnchor` | string or omit | links to `characters.html#<anchor>`; omit for the Chronological view's plain "Chronicle Order" heading (no link) |
| `summary` | string | the `.log-summary` line, e.g. `"19 scenarios · 76 XP"` |
| `columns` | array of string | table header cells |
| `numColumns` | array of boolean, same length as `columns` | which columns get `class="num"` (right-aligned, tabular numerals) — XP and Gold/Credits/Reward yes, Character/Scenario/Reputation no |
| `rows` | array of `{cells}` | `cells` is an array of strings, **one per column, in order** |
| `totals` | string | the `.log-totals` line |

Cell strings are written to the page **as raw HTML, not escaped** — the
source file's own chronicle tables put `<a href="characters.html#...">` links
and `<span style="opacity:.6">(holding)</span>` asides directly inside table
cells (see the Chronological view's Character column, or any "holding"
row). Escape `&`, `<`, `>` yourself in a cell string if you actually mean
those characters literally.

**`scenario`** — one `<div class="scenario">`, for a single one-shot with no
chronicle table (a character who's played exactly one scenario so far).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `seal` | string | the single letter/glyph shown in the `.seal` circle |
| `title` | string | |
| `meta` | string | the `.scenario-meta` line, e.g. `"PFS Scenario · 4 XP · 14 gp · Grand Archive +4"` |
| `characterName` | string | |
| `characterAnchor` | string | |

## What this doesn't do

- **No Chronological-view assembly.** The Chronological tab is the same
  scenarios re-sorted by scenario number across all characters in one
  org's table. Generating it from the same per-character data (instead of
  hand-keeping two views in sync) is a reasonable next step, but it needs
  a merge/sort step this script doesn't have yet — build it if the two
  views actually drift, not speculatively.
- **No writing to `campaigns.html`.** Deliberate — see the top of this file.
- **No validation beyond `JSON.parse`.** A missing field just prints
  `undefined` in the output; check the block before you paste it, same as
  you'd proofread anything else you typed by hand.
