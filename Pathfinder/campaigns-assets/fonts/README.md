# Vendored fonts

Five files, 84 KB total, replacing the `fonts.googleapis.com` hotlink this page
used to make on every load.

| File | Family | Weight/style | Used by |
| --- | --- | --- | --- |
| `cinzel-700.woff2` | Cinzel | 700 | `.campaign-title`, `.scenario-title`, `.org-header`, `.scenario-group-head h4`, `.seal` |
| `cinzel-900.woff2` | Cinzel | 900 | `h1.title` |
| `crimson-pro-400.woff2` | Crimson Pro | 400 regular | body text |
| `crimson-pro-400-italic.woff2` | Crimson Pro | 400 italic | `.subtitle`, `.section-lede`, `.roster .bio` |
| `oswald-400.woff2` | Oswald | 400 | nav tabs, ribbons, pills, table headers, footer — all the small-caps labels |

The hotlinked URL requested nine weights across three families
(`Cinzel:500,700,900`, `Crimson Pro` roman+italic across four weights,
`Oswald:400,500,600`). The page only ever sets five of those, so only five
shipped. Latin subset only — the page has no non-Latin content.

## Source and licence

All three families are Google Fonts, pulled from the same npm packages
`Tools/board-check/harness.mjs` already uses to serve fonts locally during
`npm run check` (`@fontsource/cinzel`, `@fontsource/crimson-pro`,
`@fontsource/oswald`, all version 5.3.0). The woff2 files here are direct
copies of `files/*-latin-<weight>-<style>.woff2` from those packages, renamed
for clarity. `node_modules` itself is never referenced at runtime — this is
just where the bytes came from.

All three are licensed under the **SIL Open Font License, version 1.1**
(copyright the respective font project authors — Cinzel Project, Crimson Pro
Project, Oswald Project). Full license text: https://scripts.sil.org/OFL
