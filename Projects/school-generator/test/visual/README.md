# Visual regression — the sheets and the chrome

The WISHLIST called the blueprint canvas the largest untested surface in the
codebase. This directory is the day's work it asked for: pixel-level
regression for the printable sheets and for the editor chrome, compared
against committed baselines.

Deliberately **outside** the `node --test` suite. The pure suite proves the
*numbers* are right and needs nothing but Node; this harness proves the
*pictures* are right and needs a browser. A machine without one loses the
pictures, not the suite.

## Running it

```
node test/visual/run.mjs             # compare against baselines/
node test/visual/run.mjs --update    # rewrite baselines/ from this run
node test/visual/run.mjs --only sheet-floor-plan
```

Requires Playwright with its Chromium (`npm i -g playwright && npx playwright
install chromium`, or any environment that already has both — the harness
finds a global install by itself). No `package.json` appears in this project;
the runtime stays build-free and this stays optional tooling.

A run exits 0 when every capture matches, 1 when any differs (the candidate
and a red-on-grey diff land in `failures/`, which git ignores), and 2 when
Playwright is missing.

## What is captured

| Capture | What it proves |
|---|---|
| `sheet-floor-plan` | `computeFloorPlan` → `drawFloorPlan` over the sample school, with furniture and dimension strings |
| `sheet-site-plan` | `computeSitePlan` → `drawSitePlan` — contours, regions, the building outline |
| `chrome-edit` | The default editor chrome at 1600px |
| `chrome-rail` | All five rail panels open, the sky panel folded |
| `chrome-walk-overlay` | The walkthrough cheat sheet, first-run state |
| `chrome-narrow` | The 900px narrow-desktop layout |

The sheets are drawn in a minimal harness page that imports `js/sample.js`
and `js/blueprint.js` directly — pure state in, canvas out, no app, no
WebGL — after forcing the sheet's own faces (Public Sans, IBM Plex Mono) to
load, so text renders the way it prints. The whole path is deterministic:
nothing in the sample builder or the sheet modules calls `Math.random`, and
the title block's date — which defaults to today — is pinned via `opts.date`
so the baselines don't expire at midnight.

Chrome captures load the real app and then hide the WebGL canvas before the
screenshot, so what is compared is the chrome on the page's own background.

## What is deliberately not captured

- **The 3D viewport.** A software rasterizer in CI and a GPU on a desk do not
  produce the same pixels, and the render's correctness is not a chrome
  question. The scene's *data* is tested where it lives (`lights`, `sky`,
  `shapes`, …).
- **The spec sheet.** `renderSpecSheetCanvas` wants the report's numbers,
  which want the nav graph the app builds; wiring that up here would mean
  test hooks in app code. If the report pipeline ever gets a pure entry
  point, add it.

## When it fails

A failure means the picture changed, not necessarily that it broke. Look at
`failures/<name>-diff.png` (red pixels are the change), decide whether the
change is intended, and if it is, `--update` and commit the new baseline with
the change that caused it.

Baselines are tied loosely to a Chromium generation — a major browser bump
can move antialiasing by more than the harness's tolerance (a >0.1% pixel
budget at 8/255 per channel). That shows up as a uniform sprinkle in the
diff rather than a localized block; re-baseline when it does.
