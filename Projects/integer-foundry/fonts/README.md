# Integer Foundry's fonts

Local copies of the three families `integer-foundry.html` used to pull from
`fonts.googleapis.com`. The hotlink is gone; the page makes no offsite request.

| File | Family | Weight | Bytes |
| --- | --- | --- | --- |
| `inter-400.woff2` | Inter | 400 | 23,664 |
| `inter-700.woff2` | Inter | 700 | 24,356 |
| `jetbrains-mono-400.woff2` | JetBrains Mono | 400 | 21,168 |
| `jetbrains-mono-700.woff2` | JetBrains Mono | 700 | 21,908 |
| `oswald-600.woff2` | Oswald | 600 | 12,740 |
| `oswald-700.woff2` | Oswald | 700 | 12,672 |

**116,508 bytes — 114 KB for the six.** Measured, not estimated (locked decision
#42). For scale, Golden Hour's vendored sand is 370 KB and the Castle Conundrum
asset kit is 178 MB.

## Source

Copied from the `@fontsource` packages already installed under
`Tools/board-check/node_modules/@fontsource/` — the same files `harness.mjs`
serves when it shims a Google Fonts request, so an offline render and a real
visitor now get byte-identical fonts. Latin subset only, `normal` style only;
no italic is used anywhere on the page.

- Inter — https://github.com/rsms/inter
- JetBrains Mono — https://github.com/JetBrains/JetBrainsMono
- Oswald — https://github.com/googlefonts/OswaldFont

Nothing at runtime references `node_modules`. These are plain files served from
the site.

## Licence

All three are SIL Open Font License 1.1. Full texts alongside, as the OFL
requires: `LICENSE-Inter.txt`, `LICENSE-JetBrainsMono.txt`, `LICENSE-Oswald.txt`.

## Which weights, and one deliberate change

Only the weights the page actually asks for:

- **Oswald 700** — `#topbar h1` and every `.panel h2` (both bold by default).
- **Oswald 600** — `#prestige-btn`.
- **JetBrains Mono 400** — the log, sink labels, buy buttons, footer.
- **JetBrains Mono 700** — `.packet`.
- **Inter 400** — body text and the fabricator buttons.
- **Inter 700** — `.stat .val`.

The old `@import` requested Oswald 500/600/700, JetBrains Mono 400/500/700 and
Inter 400/500/600. Three of those nine were never used by any selector, and one
weight the CSS *does* ask for — Inter 700, on the three numbers in the top bar —
was never requested at all, so the browser synthesised a fake bold from Inter 600.
That weight is now real. It is the only intentional visual difference from the
hotlinked build.

`font-display:swap`, so the page paints in the fallback stack immediately rather
than holding the first frame for a font file.
