# Vendored fonts

Five woff2 files, 77.8 KB total — the only weight/style combinations this page's
CSS actually calls for, not the nine the old hotlink requested:

| File | Family | Weight | Style | Size |
| --- | --- | --- | --- | --- |
| `cinzel-latin-700-normal.woff2` | Cinzel | 700 | normal | 14.8 KB |
| `cinzel-latin-900-normal.woff2` | Cinzel | 900 | normal | 14.5 KB |
| `crimson-pro-latin-400-normal.woff2` | Crimson Pro | 400 | normal | 17.9 KB |
| `crimson-pro-latin-400-italic.woff2` | Crimson Pro | 400 | italic | 18.7 KB |
| `oswald-latin-400-normal.woff2` | Oswald | 400 | normal | 12.0 KB |

Checked against the stylesheet: nothing on the page sets Cinzel 500, Crimson Pro
500/600, or Oswald 500/600, even though the hotlinked Google Fonts URL asked for
all of them.

Source: [Fontsource](https://fontsource.org) — `@fontsource/cinzel`,
`@fontsource/crimson-pro`, `@fontsource/oswald`, version 5.3.0, which repackages
the same files Google Fonts serves. All three are licensed under the
[SIL Open Font License 1.1](https://scripts.sil.org/OFL).

## Why these are in the repo

`characters.html` used to hotlink `fonts.googleapis.com` / `fonts.gstatic.com`,
one of the last real offsite requests on the site. Vendoring it:

- 77.8 KB, once, instead of a request to Google on every visit
- no more handing Google the IP address of everyone who opens a character sheet
- the page renders identically if Google Fonts ever changes a URL or a subset

`Tools/board-check`'s `prepPage()` fulfills Google Fonts requests locally from its
own bundled `@fontsource` copies before the offsite-request check runs, which is
why the hotlink never tripped `page.__blocked` in nine sessions of the suite
passing. It was still a real request in production.
