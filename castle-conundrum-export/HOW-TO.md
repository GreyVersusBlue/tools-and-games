# Castle Conundrum, packaged for upload

Everything the new repo needs is in this folder. **This branch is a delivery
box, not work — do not merge it into `main`.** Delete it once the new repo has
its contents.

The real move is
[tools-and-games#322](https://github.com/GreyVersusBlue/tools-and-games/pull/322),
which deletes `Projects/Castle Conundrum/` from this repo. **Do not merge that
one until `castle-conundrum` actually has the code**, or the board card points
at nothing.

## What is here

| File | What it is |
| --- | --- |
| `castle-conundrum.zip` | The whole tree, 371 files, 36.8 MB. Unzips to `castle-conundrum/`. |
| `castle-conundrum-upload-batches.zip` | The same 371 files pre-split into five folders of 100 or fewer, because GitHub's web uploader refuses more than 100 files at a time. |
| `CLAUDE.md` `README.md` `BACKLOG.md` `HISTORY.md` `PLAN.md` | The new repo's docs, unzipped so you can read them in the browser without downloading anything. |

Both zips were verified: unpacked from scratch, `npm ci`, `npm run build`, and
**all 8 suites passed**. The batches recombine byte-identically to the full
tree (`diff -r`, 371 files, no differences).

## Route 1 — one click, keeps the history (best)

The branch is already built in the session that made this: two commits, the
30-commit subtree history underneath, all suites green. It could not be pushed
because the Claude GitHub App has no write access to
`GreyVersusBlue/castle-conundrum` (`git push` → 403; the REST API says
`Resource not accessible by integration`). Reads work, writes do not.

Grant it access — <https://github.com/apps/claude/installations/select_target>,
or reconnect GitHub at
<https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1> —
and the branch pushes with its history intact and its PR opens. **This is a
browser page, not the desktop app.** Nothing else on this list gives you the
history for free.

## Route 2 — a browser terminal, keeps the history

If granting access is not on, a GitHub Codespace on *this* repo gives you git
and a terminal in the browser, with your credentials already loaded. On
`tools-and-games`: **Code → Codespaces → Create codespace on main**. Then:

```bash
git subtree split --prefix='Projects/Castle Conundrum' -b castle-split
git clone https://github.com/GreyVersusBlue/castle-conundrum ../cc
cd ../cc
git fetch ../tools-and-games castle-split:castle-split
git merge castle-split --allow-unrelated-histories -m "Castle Conundrum moves here"
```

That reproduces the history exactly — `git subtree split` is deterministic, so
you get the same 30 commits the session produced. It does **not** reproduce the
Vite migration, the renamed asset folders or the new docs, so unzip
`castle-conundrum.zip` over the result, then commit:

```bash
rm -rf src test data assets index.html libs WISHLIST.md
unzip -o /path/to/castle-conundrum.zip -d /tmp/cc && cp -r /tmp/cc/castle-conundrum/. .
git add -A && git commit -m "Castle Conundrum is its own repo: Vite, npm three, its own CI"
git push -u origin main
```

Check `npm ci && npm run build && npm test` before pushing. It takes about four
minutes, `built.mjs` and `plan-vs-scene.mjs` being most of it.

## Route 3 — web upload, no terminal, loses the history

The new repo ends up with one flat commit and no past. Everything else is
identical, and `PLAN.md` plus `HISTORY.md` still carry the whole record in
prose, so what is lost is `git log`, not the story.

Download `castle-conundrum-upload-batches.zip` (the **Download raw file**
button on its page) and unzip it. You get `batch-1` through `batch-5`. On
`castle-conundrum`, for each batch in order: **Add file → Upload files**, open
`batch-N`, select **the items inside it** — not the `batch-N` folder itself —
and drag them in. Commit, then do the next one.

| Batch | Files | What to drag from inside it |
| --- | --- | --- |
| 1 | 45 | `src`, `test`, `data`, `.github`, and the loose files (`index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `.gitignore`, and the five `.md` files) |
| 2 | 99 | `assets` |
| 3 | 100 | `assets` |
| 4 | 100 | `assets` |
| 5 | 27 | `assets` |

Dragging the *contents* is what matters: GitHub builds each path from what you
dropped, so dropping `assets` from batch-4 lands its files beside the ones
batch-3 already committed. Dropping the `batch-4` folder would create a
`batch-4/` directory instead.

**Two files may not survive the drag.** `.gitignore` and
`.github/workflows/ci.yml` are hidden on macOS and Linux, and some file pickers
skip them. After batch 1, check whether they are there. If either is missing,
**Add file → Create new file**, type the path, and paste:

`.gitignore`

```
node_modules/
dist/
# `npm run play` writes a numbered screenshot per beat here for eyeballing.
shots/
```

`.github/workflows/ci.yml` — copy it out of `batch-1/.github/workflows/ci.yml`
in the unzipped folder. It is 2 KB and it is what makes CI run at all; without
it the repo is green because nothing is checking.

### After the upload

Clone or open the repo and run:

```
npm ci
npm run build
npm test
```

Expect `all 8 suites passed` and a 42.0 MB `dist/`. If `npm test` says
`ERR_MODULE_NOT_FOUND`, a file did not make it up — compare against the 371 in
`castle-conundrum.zip`.

## What is in the tree, so you can spot a gap

371 files, 43 MB:

- `index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `.gitignore`
- `README.md`, `CLAUDE.md`, `BACKLOG.md`, `HISTORY.md`, `PLAN.md`
- `src/` — 16 files, including `castle-plan.js` (1,798 lines) and the vendored `gvb-save.js`
- `test/` — 13 files: the seven suites that moved, plus `harness.mjs`, `drive.mjs`, `play-castle.mjs`, `built.mjs`, `run.mjs` and `blank.html`
- `data/` — 5 JSON files
- `assets/` — 326 files: `poly-haven/` 96, `kenney_retro-fantasy-kit/` 227, `NPCs/` 3
- `.github/workflows/ci.yml`

There is no `libs/` and no import map: three comes from npm at `0.169.0` and
Vite resolves it. There is no `WISHLIST.md`: it is `PLAN.md`, moved unedited.
