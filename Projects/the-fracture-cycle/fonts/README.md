# Vendored fonts

Five files, 108 KB total. Replaces the Google Fonts hotlink
(`fonts.googleapis.com/css2?family=Cinzel...`) that used to sit in
`the-fracture-cycle.html`'s `<head>`.

| File | Family | Weight | Style | Used for |
| --- | --- | --- | --- | --- |
| `cinzel-latin-700-normal.woff2` | Cinzel | 700 | normal | `.node-title` |
| `cinzel-latin-900-normal.woff2` | Cinzel | 900 | normal | `h1` |
| `eb-garamond-latin-400-normal.woff2` | EB Garamond | 400 | normal | body text |
| `eb-garamond-latin-400-italic.woff2` | EB Garamond | 400 | italic | `.node-text em`, `.sub` |
| `jetbrains-mono-latin-400-normal.woff2` | JetBrains Mono | 400 | normal | labels, mono UI |

Only the weights the page's CSS actually sets are here. The old hotlink pulled
Cinzel 500/700/900, EB Garamond 400/500/600 (+ 400 italic), and JetBrains Mono
400/600 — but grep the page's `font-weight` rules and only two exist at all
(`700` and `900`, both Cinzel); everything else renders at the default `400`.
500/600 weights and a Cinzel italic were dead weight, never referenced by any
selector. Latin subset only — no accented characters appear in the story text,
just em dashes and curly quotes, both inside the standard Latin subset's
Unicode range.

Source: [Fontsource](https://fontsource.org/) packages `@fontsource/cinzel`,
`@fontsource/eb-garamond`, `@fontsource/jetbrains-mono`, version `5.3.0` (same
version already vendored for `JetBrains Mono` in
`Tools/board-check/node_modules/@fontsource/jetbrains-mono`, kept in sync).
Each font is the original Google Fonts release repackaged as static woff2
files; license is **SIL Open Font License 1.1** for all three (Cinzel and EB
Garamond by their respective type designers, JetBrains Mono by JetBrains s.r.o.)
— free to bundle, modify, and redistribute, including with a commercial
product, with no attribution required (though it's given here anyway).

## Why these are in the repo

The game hotlinked three Google Font families, the only outside request this
page made. Session 8 vendored them:

- 108 KB, trivial next to this repo's asset budgets elsewhere
- no third party sees the IP address of everyone who opens the game
- text renders identically offline or if Google Fonts' CDN is ever unreachable
