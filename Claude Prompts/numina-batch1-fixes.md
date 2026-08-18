# Numina batch 1 — audit fixes #1, #3, #5, #6, #9

Work in `Projects/Numina/` (Eleventy site, source in `src/`, **built output is
committed** — the deploy serves this repo as-is). Repo convention for every
change: edit `src/` (or config), run `npm run build`, run `npm test`, and
commit source + regenerated output together. Builds are deterministic; a
no-op rebuild produces no diff. Do not edit generated files
(`index.html`, `lore/`, `mechanics/`, `search/`, `css/`, `js/`, `fonts/`,
`assets/`, `pagefind/` at the project root) by hand.

Full context lives in `numina-audit-2026-08.md` at the repo root (read it if
present). Implement these five items:

## 1. Rewrite "New Players Start Here" (audit A1)

`src/mechanics/new-players.md` is 172 words and doesn't deliver its own
summary ("what a LARP event is like, what you need, and how to join your
first game"). It is the primary hero CTA for prospective players. Rewrite it
into a real onboarding page covering, in roughly this order: what Numina is
in one paragraph for someone who has never LARPed; what an event weekend is
like; what you need to bring or can borrow (costume/garb expectations, weapon
basics); NPCing as a low-cost first taste; how character creation works at a
high level (link to Building a Character and Skills); and how to actually
join (link to the official site and Discord from `src/_data/site.json`).

**Hard constraint: do not invent facts.** Source every claim from
`source-material/rules-2026-v3.51.pdf` (the "Welcome to Numina" and
etiquette/safety chapters) and `source-material/campaign-book-2025.pdf`, or
from pages already in `src/`. Where a practical detail (event dates, prices,
location, registration mechanics) is not in the books, do not guess — link
to the official site/Discord for it instead. Keep the existing CP paragraph's
facts. Follow `CONTENT-GUIDE.md` conventions (no top-level `#`, cross-link
with root-relative paths).

## 2. Stop deploying the source books (audit E1)

Firebase Hosting deploys the whole repo (`firebase.json` at the **repo
root**, `public: "."`), so `Projects/Numina/source-material/**` — the full
copyrighted book PDFs and raw markdown conversions — is publicly
downloadable. Add `**/source-material/**` to the hosting `ignore` list.
Don't remove the files from git.

## 3. Mobile fixes (audit C1 + C2)

- On narrow screens the sidebar `<details>` renders open and pushes page
  content a full viewport down. Make it collapsed by default on mobile while
  staying open on desktop. Prefer a no-JS or minimal-JS approach; keep the
  disclosure usable and don't regress desktop.
- The inline SVG map's nation labels (18px in a 1000-unit viewBox) are ~6px
  on phones. Since the SVG is inline, CSS can target it: under a narrow
  media query enlarge `.map-region text` meaningfully (and thin out or hide
  the decorative layer if labels collide). Alternative if enlarging labels
  can't get legible: hide labels on small screens — the card grid duplicates
  every link.

Verify both by screenshotting with headless Chromium (Playwright is
preinstalled; launch with `executablePath: '/opt/pw-browsers/chromium'` or
the installed headless shell) at 390px and 1440px against a local static
server serving the repo root, light and dark themes. Look at the screenshots
before calling it done.

## 4. Sharing & SEO metadata (audit D1–D4)

All in `src/_includes/layouts/base.njk` unless noted:
- **Favicon**: an SVG favicon reusing the site's leaf/vine ornament art
  (see the `--orn-leaf` mask data-URI in `src/css/main.css`), gold on
  transparent so it works on light and dark tabs. Put it in `src/assets/`
  and link it. Add a fallback `<link rel="icon">` only if needed.
- **Open Graph + Twitter cards**: `og:title`, `og:description` (per-page
  `summary` already flows into the meta description — reuse that logic),
  `og:type`, `og:url`, `og:site_name`, `twitter:card`, and one `og:image`.
  For the image, produce a static 1200×630 social card (screenshot or
  compose the existing map/hero art — stay within the site's established
  parchment/gold visual system), commit it under `src/assets/`, and
  reference it with an absolute URL. The canonical origin is
  `https://greyversusblue.com` + the `/Projects/Numina/` path prefix; derive
  URLs so they survive the planned custom-domain move (a single site-data
  `origin` value is fine).
- **Canonical URL** per page.
- **sitemap.xml**: generate with Eleventy listing all content pages, and a
  `robots.txt` **at the domain root** (repo root — it must not live in the
  Numina subdirectory) referencing it. Since the repo root is the deployed
  site root, coordinate: robots.txt is a repo-root file, the sitemap can
  live under the Numina project.
- Footer official-site link in `src/_data/site.json` is `http://` — check
  whether `https://www.numinalarp.com` responds; upgrade the scheme if it
  does, leave it and note why if it doesn't.
- The smoke test allowlists offsite hosts and checks top-level output
  entries — update `test/smoke.mjs` expectations as needed (e.g. sitemap).

## 5. Repo/process hardening (audit E2, E3, E6 subset)

- **CI**: add a GitHub Actions workflow that, on PRs touching
  `Projects/Numina/**`, runs `npm ci`, `npm run build`,
  `git diff --exit-code` (catches "forgot to rebuild"), and `npm test` in
  `Projects/Numina`. Node 22. Don't touch the existing Firebase deploy
  workflows.
- **nav.json drift guard**: `src/_data/nav.json` duplicates page
  order/titles; a page added to `src/` but not nav.json silently disappears
  from navigation. Add a smoke-test check that every built content page
  (lore + mechanics, nations exempt — they're generated from the
  collection) appears in nav.json. Prefer the test over refactoring nav
  generation.
- Remove the no-op `eleventyConfig.amendLibrary("md", () => {})` from
  `eleventy.config.mjs`.
- Add cache headers in `firebase.json` for `/Projects/Numina/pagefind/**`
  (content-hashed fragments — long max-age) and fonts.
- Add a small "Looking for Numina?" link back to `/Projects/Numina/` on the
  repo-root `404.html`, styled consistently with that page.

## Done means

`npm run build && npm test` clean; screenshots confirm the mobile fixes; a
second no-op rebuild produces no git diff. Commit in logical chunks with
clear messages. If `main` moves before you push (another Numina session is
running concurrently), merge `origin/main`, resolve source conflicts
normally, and resolve any conflict in generated output by re-running
`npm run build` — never hand-merge generated files. Push your branch and
open a PR summarizing each of the five items with before/after notes.
