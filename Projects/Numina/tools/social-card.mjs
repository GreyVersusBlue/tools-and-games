// Regenerates src/assets/social-card.png — the 1200x630 og:image.
//
// Not part of `npm run build`: the card is a committed static asset and only
// needs redrawing when the wordmark, the palette or the map art changes.
// Playwright is not a project dependency; run this against whatever Playwright
// you have. In a Claude Code web session:
//
//   npm run build
//   npx http-server -p 8099 -c-1 ../..        # serve the repo root
//   node tools/social-card.mjs src/assets/social-card.png
//
// It loads the real /lore/nations/ page so the card inherits the site's own
// fonts, color tokens and map art instead of re-implementing them, then
// recomposes that page into the card and screenshots it.
//
// Args: <output path> [base URL, default http://127.0.0.1:8099/Projects/Numina]
// Env:  CHROMIUM_PATH — explicit browser binary, if Playwright cannot find one.

import { chromium } from "playwright";

const OUT = process.argv[2];
const BASE = process.argv[3] || "http://127.0.0.1:8099/Projects/Numina";
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
const page = await ctx.newPage();
await page.goto(`${BASE}/lore/nations/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const svg = document.querySelector(".world-map svg").cloneNode(true);
  svg.removeAttribute("style");
  // Drop the map's own chrome: its frame would fight the card's border, and its
  // sea rect would cover the card's parchment. The land, the regions and the
  // terrain decoration are what we want.
  svg.querySelectorAll(".map-frame, .map-cartouche, .map-sea, .map-grain, .map-waves, .map-compass").forEach((n) => n.remove());
  svg.setAttribute("viewBox", "62 34 742 642");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  document.body.innerHTML = "";
  document.body.className = "";
  document.documentElement.setAttribute("data-theme", "light");
  const card = document.createElement("div");
  card.id = "card";
  card.innerHTML = `
    <div class="card-map"></div>
    <div class="card-text">
      <p class="card-eyebrow">The Age of Works</p>
      <h1 class="card-title">NUMINA</h1>
      <div class="card-leaf"></div>
      <p class="card-tagline">A live-action roleplay campaign<br>in the world of Aeledd</p>
      <p class="card-foot">Lore &middot; Rules &middot; Player guides</p>
    </div>`;
  card.querySelector(".card-map").appendChild(svg);
  document.body.appendChild(card);
});
await page.addStyleTag({ content: `
  html, body { margin: 0; padding: 0; background: var(--paper); overflow: hidden; }
  #card {
    position: relative;
    width: 1200px; height: 630px;
    background: var(--paper);
    background-image: var(--texture);
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    overflow: hidden;
  }
  #card::after {
    content: ""; position: absolute; inset: 22px;
    border: 3px solid var(--gold); outline: 1px solid var(--gold-dim); outline-offset: 5px;
    z-index: 3;
    pointer-events: none;
  }
  .card-map { position: absolute; right: 40px; top: 52px; width: 566px; height: 526px; }
  .card-map svg { width: 100%; height: 100%; }
  .card-text {
    position: relative; z-index: 2;
    padding: 0 0 0 76px;
    background: linear-gradient(90deg, var(--paper) 70%, rgba(240,230,205,0.9) 88%, rgba(240,230,205,0));
    height: 630px; display: flex; flex-direction: column; justify-content: center;
    width: 640px;
  }
  .card-eyebrow {
    font-family: var(--caps); font-size: 22px; letter-spacing: 0.34em;
    color: var(--gold); margin: 0 0 6px; text-transform: uppercase;
  }
  .card-title {
    font-family: var(--display); font-weight: 700; font-size: 116px; line-height: 0.95;
    letter-spacing: 0.06em; color: var(--heading); margin: 0;
  }
  .card-leaf {
    width: 230px; height: 40px; margin: 18px 0 20px;
    background-color: var(--gold);
    -webkit-mask: var(--orn-leaf) left center / contain no-repeat;
    mask: var(--orn-leaf) left center / contain no-repeat;
  }
  .card-tagline {
    font-family: var(--body); font-style: italic; font-size: 34px; line-height: 1.32;
    color: var(--ink); margin: 0;
  }
  .card-foot {
    font-family: var(--caps); font-size: 19px; letter-spacing: 0.22em;
    color: var(--ink-soft); margin: 26px 0 0;
  }
` });
await page.waitForTimeout(600);
await page.locator("#card").screenshot({ path: OUT });
await browser.close();
console.log("wrote", OUT);
