# Prompt Builder's fonts

Six woff2 files, 165.1 KB total, backing the three typefaces
`Tools/prompt-builder.html` uses. The page hotlinked `fonts.googleapis.com`
for its entire history and was the last standing `npm run check` failure on
`main`:

```
FAIL Tools/prompt-builder.html
     references offsite host(s): fonts.googleapis.com, fonts.gstatic.com
```

| File | Weight / style | Used by |
| --- | --- | --- |
| `fraunces-latin-standard-normal.woff2` | Fraunces variable, opsz 9–144 + wght 100–900 | `header h1`, `.section h2` |
| `inter-latin-400-normal.woff2` | Inter 400 normal | `body`, and everything that inherits it |
| `inter-latin-500-normal.woff2` | Inter 500 normal | one rule, the copy button's label |
| `inter-latin-600-normal.woff2` | Inter 600 normal | labels, buttons, the output header |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono 400 normal | the output pane, inputs, chips |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono 500 normal | the section eyebrows |

Weights are read from the page's own CSS, not from the hotlink it shipped
with, the same way `assets/fonts/README.md` describes. The hotlink asked for
Fraunces 500 and 700, which no rule in the file sets — every `font-weight` in
the page is 400, 500 or 600. Latin subset only; the page renders no text
outside it, and it never goes italic.

`<strong>` at line 773 is the one element that wants 700, and it gets a
synthetic bold from Inter 600. That is not a regression: the hotlink never
requested Inter 700 either, so the browser was synthesising it before this
change too. Vendoring a real 700 would be a rendering change, not a fix.

## Why Fraunces is the variable cut and the other two are not

Fraunces is the one face here with an optical-size axis, and the page's CSS
opts into it: `header h1` sets `font-optical-sizing: auto` and sizes itself
`clamp(2.2rem, 5vw, 3.2rem)`, while `.section h2` uses the same family at
1.12rem. That is a 3x size range across two rules, which is the whole reason
the axis exists. Google's `css2` link was serving the variable font, so
swapping in a static 600 would have quietly changed what the page renders and
left `font-optical-sizing: auto` as a dead declaration.

The cost is 67.3 KB for the variable "standard" cut (opsz + wght) against
18.1 KB for a static 600 — 49.2 KB to keep the page looking like it looks
today. Inter and IBM Plex Mono have no optical axis and the CSS names discrete
weights, so those are statics: five files, 102.0 KB, against 130 KB or so for
two variable cuts covering ranges nothing asks for.

## Why here and not `assets/fonts/`

Locked decision #17: each project vendors its own copy, nothing shared across
projects. `assets/fonts/` is the stated exception (#43, extended by #51) and
it is scoped to the four pages that *are* the site — `index.html`, `404.html`,
`newindex.html`, `landing.html`. Prompt Builder is a Tools page, not the site
chrome, so it gets its own folder on the pattern
`Tools/name-picker/fonts/` and `Tools/seating-chart/fonts/` already set.

Two of these files are byte-for-byte duplicates of files in `assets/fonts/`
(`ibm-plex-mono-latin-400-normal.woff2` and `-500-`). That duplication is the
rule working as intended, not an oversight: #17 says a duplicated 40 KB beats
a cross-project coupling.

Source: [Fontsource](https://fontsource.org). `@fontsource/inter` and
`@fontsource/ibm-plex-mono` v5.3.0, copied byte-for-byte from
`Tools/board-check/node_modules`, which already carries both for
`harness.mjs`'s font shim. `@fontsource-variable/fraunces` v5.2.8 is not one
of the twelve families that folder carries, so it was fetched from the
registry (`npm pack @fontsource-variable/fraunces@5.2.8`) the same way
`assets/fonts/`'s Space Grotesk was. Nothing at runtime references
`node_modules` either way. All three families are licensed
**SIL Open Font License 1.1**; the texts are in this folder.
