# assets/landing

Media for `landing.html`, the studio-style landing mockup at the site root.

## What is here

- `og-landing.jpg` — 1200×630 still of the rendered hero ("The Seal") with
  the headline in frame, used as the page's `og:image`.
- `hero-poster.jpg` — the same frame with the words hidden, shown behind the
  hero when WebGL is unavailable or JavaScript is off.

Both were captured headlessly with Playwright's Chromium on SwiftShader
(`page.screenshot({ type: 'jpeg' })` at a 1200×630 viewport), so they are a
touch softer than a GPU render; recapture locally with a real GPU any time the
scene changes.

## The media hotswap contract

The page was built with the site's own renders (`assets/og/*.jpg`,
`assets/previews/*.jpg`, `Numina/assets/social-card.png`) as its photography.
It was designed so licensed stock photos or a hero video can replace them
later without touching markup. Everything goes through the `MEDIA` object at
the top of the inline module in `landing.html`:

| Key | What it replaces | Expected file |
| --- | --- | --- |
| `MEDIA.heroVideo = { src, poster }` | adds a muted looping video behind the 3D canvas | mp4/webm, 1920×1080 or 1080×1920, ≤ 4 MB, plus a jpg poster |
| `MEDIA.featured['<slug>']` | one of the four Commission stills | jpg, 1200×630 (any 40:21) |
| `MEDIA.previews['<slug>']` | a sealed tile in the Ledger (`blue-hour-trail`, `bell-to-bell`, `hearth`) | jpg, 330×200 |
| `MEDIA.backdrops.chronicles` / `.numina` | the section backdrop | jpg, ≥ 1600 wide |

**Same-origin only.** Download the stock file into this folder (Unsplash and
Pexels licences both allow it; keep the credit in a comment here) and point
the key at `assets/landing/<file>`. Do not hotlink `images.unsplash.com` or
`videos.pexels.com`: the site's rule is zero offsite requests, and
`Tools/board-check/check-integrity.mjs` fails `npm run check` on any
`<img>`, `<video>`, `<source>` or CSS `url()` that points off-site. That
check reads raw source, HTML comments included, so keep example URLs out of
the markup entirely — that is why the slot comments in `landing.html` are
prose rather than commented-out tags.

## Credits

_None yet — every image on the page is a render from this repo._
