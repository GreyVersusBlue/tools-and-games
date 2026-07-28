# Vendored fonts

Seven woff2 faces, latin subset, **124 KB total** (127,000 bytes):

| Family | Weights | Bytes | Used for |
| --- | --- | --- | --- |
| Zilla Slab | 500, 700 | 52,568 | `--display` — the letterhead, card titles, flyer addresses, stamps |
| Public Sans | 400, 600, 700 | 43,824 | `--body` — everything else, plus `<b>` at 700 |
| IBM Plex Mono | 500, 600 | 30,508 | `--mono` — prices, dates, tags, DOM counters, the ledger gutter |

Source: the [Fontsource](https://fontsource.org) packages already installed for
`Tools/board-check` (`@fontsource/zilla-slab`, `@fontsource/public-sans`,
`@fontsource/ibm-plex-mono`), copied out of `files/`. Those packages repackage
the upstream Google Fonts releases; the files are byte-identical to what the
hotlink was serving.

All three are **SIL Open Font License 1.1**. Zilla Slab is © 2017 The Mozilla
Foundation, Public Sans © 2015 The Public Sans Project Authors, IBM Plex Mono
© 2017 IBM Corp. OFL permits bundling and redistribution; the licence text
ships with each Fontsource package if you need the full copy.

**Nothing at runtime may reference `node_modules`.** These are copies, on
purpose. `Tools/board-check` is dev tooling and is not deployed.

## Why these are in the repo

`index.html` hotlinked all three families from `fonts.googleapis.com`, which
made this page the last thing on greyversusblue.com reaching an outside host
while a visitor was on it. v7 §5 claimed the site made zero offsite requests
site-wide; that was wrong, and the regression suite could not see it, because
`prepPage()` in `Tools/board-check/harness.mjs` fulfills Google Fonts requests
locally from these same Fontsource packages before the blocked-list check runs.
So the hotlinks never reached `page.__blocked`. Grep `index.html` for
`fonts.googleapis.com` instead — that is the check that works.

124 KB is roughly a third of Golden Hour's vendored sand, in a repo whose
Castle Conundrum asset kit alone is 178 MB.

## Adding a weight

`fonts.css` declares only the weights `css/style.css` asks for. A rule that
asks for a weight with no file renders in the nearest one that exists, silently
— which is already true of `.card-title` (asks 400, gets 500) and matches what
the Google stylesheet did. If you add a weight to `style.css`, copy the matching
`*-latin-<weight>-normal.woff2` out of Fontsource and add a `@font-face` here.
