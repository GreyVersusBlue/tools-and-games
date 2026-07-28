# Vendored fonts

Seven woff2 faces, **121.6 KB (124,488 bytes) for the set**. Latin subset only —
the page is ASCII plus emoji, and emoji come from the system font.

| File | Family | Weight | Bytes |
| --- | --- | --- | --- |
| `kalam-latin-400-normal.woff2` | Kalam | 400 | 22,336 |
| `kalam-latin-700-normal.woff2` | Kalam | 700 | 22,144 |
| `quicksand-latin-400-normal.woff2` | Quicksand | 400 | 15,776 |
| `quicksand-latin-600-normal.woff2` | Quicksand | 600 | 15,864 |
| `quicksand-latin-700-normal.woff2` | Quicksand | 700 | 15,124 |
| `space-mono-latin-400-normal.woff2` | Space Mono | 400 | 16,520 |
| `space-mono-latin-700-normal.woff2` | Space Mono | 700 | 16,724 |

Source: the official [Fontsource](https://fontsource.org) npm packages, at the
versions below. Byte-identical copies of the `files/*-latin-*-normal.woff2` each
package ships — nothing was re-subset or re-encoded here.

- `@fontsource/kalam@5.3.0`
- `@fontsource/quicksand@5.3.0`
- `@fontsource/space-mono@5.3.0`

Fontsource repackages the Google Fonts originals. All three families are **SIL
Open Font License 1.1**:

- Kalam — Copyright (c) 2014 Indian Type Foundry
- Quicksand — Copyright 2019 The Quicksand Project Authors, reserved font name
  "Quicksand"
- Space Mono — Copyright 2016 The Space Mono Project Authors

Full licence text ships in each npm package's `LICENSE`. The OFL permits
redistribution of the font files as long as they are not sold on their own and
the copyright notice travels with them, which is what this file is for.

## Why these are in the repo

`coffee_shop_sim.html` hotlinked `fonts.googleapis.com` for all three. That made
this page one of fifteen still reaching an outside host while a visitor was on
it, contradicting what v7 §5 claims about the site. The board-check suite could
not see it: `prepPage()` in `Tools/board-check/harness.mjs` fulfills Google Fonts
requests locally from bundled `@fontsource` packages before the blocked-list
check runs, so a font hotlink never reaches `page.__blocked`. The check that
matters here is grepping the page for `fonts.googleapis.com`.

## What the hotlink asked for versus what the page uses

The deleted `<link>` requested `Kalam:wght@400;700`,
`Quicksand:wght@500;600;700` and `Space+Mono:wght@400;700`. Reading the CSS,
that was wrong in both directions on Quicksand:

- **500 was requested and is never used.** No rule in the page sets
  `font-weight:500`.
- **400 was not requested and is the page's most common weight** — `body`,
  `.draghint`, the day-summary rows and every unstyled run of text. Chrome was
  serving those from the 500 face.

So the vendored set is 400/600/700 for Quicksand, and the body copy is now
actually the weight the CSS asks for. Kalam and Space Mono are 400/700 as
before; both use 400 for body runs and 700 for headings (Kalam) and the ticket's
`<b>` drink name (Space Mono).

Delete this folder and the page falls back to `cursive` / `sans-serif` /
`monospace`. It stays playable and looks generic.
