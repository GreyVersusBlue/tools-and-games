// Regenerates src/assets/social-card.png — the 1200x630 og:image.
//
//   npm run build        # the card is a screenshot of the built site
//   npm run card         # writes src/assets/social-card.png
//   npm run build        # copies it to assets/, which is what is served
//
// Not part of `npm run build`: the card is a committed static asset and only
// needs redrawing when the wordmark, the palette or the map art changes.
// `npm test` says when that is: this tool records a hash of the palette and
// the map in tools/social-card.inputs.json, and test/smoke.mjs fails when the
// files no longer match it (see tools/social-card-inputs.mjs).
//
// It needs a browser and the site does not, so Playwright is not in this
// folder's package.json. It is borrowed from test/a11y, which pins it for the
// accessibility checks: `cd test/a11y && npm install && npx playwright install
// chromium` once, the same install README.md asks for before axe.mjs.
//
// It loads the real /lore/nations/ page so the card inherits the site's own
// fonts, color tokens and map art instead of re-implementing them, then
// recomposes that page into the card and screenshots it. The page is served by
// this script, on whatever port the OS hands out, and the server is closed
// again before it exits.
//
// Args: [output path, default src/assets/social-card.png]
//       [base URL of an already-running site, e.g. http://127.0.0.1:8080/Numina;
//        given one, no server is started]
// Env:  CHROMIUM_PATH — explicit browser binary, if Playwright cannot find one.

import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { cardInputsHash, INPUTS, RECORD } from "./social-card-inputs.mjs";

const numina = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(numina, "..");
const DEFAULT_OUT = join(numina, "src", "assets", "social-card.png");
const OUT = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;

// require() rather than import(): it resolves from test/a11y's node_modules by
// name, and an absolute import() path on Windows would need pathToFileURL.
let chromium;
try {
  ({ chromium } = createRequire(join(numina, "test", "a11y", "package.json"))("playwright"));
} catch {
  console.error("FAIL  no Playwright in test/a11y — run `npm install && npx playwright install chromium` in Numina/test/a11y first");
  process.exit(1);
}

if (!process.argv[3] && !existsSync(join(numina, "lore", "nations", "index.html"))) {
  console.error("FAIL  no built site — run `npm run build` in Numina first");
  process.exit(1);
}

// The same static server test/a11y/axe.mjs runs: the repo root, because the
// built pages link each other under /Numina/.
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
};
function serve() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    // normalize() first so "/../" cannot climb out of the repo.
    let file = join(site, normalize(url).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(site + sep) && file !== site) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404).end(`not found: ${url}`); return; }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const server = process.argv[3] ? null : await serve();
const base = process.argv[3] || `http://127.0.0.1:${server.address().port}/Numina`;
let browser;
try {
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${base}/lore/nations/`, { waitUntil: "networkidle" });
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
} finally {
  await browser?.close();
  server?.close();
}
console.log("wrote", OUT);
// Only the committed card moves the record: a trial run written somewhere else
// has not brought src/assets/social-card.png up to date.
if (OUT === DEFAULT_OUT) {
  writeFileSync(RECORD, JSON.stringify({ inputs: INPUTS, sha256: cardInputsHash() }, null, 2) + "\n");
  console.log("recorded the palette and map hash in tools/social-card.inputs.json; `npm run build` copies the card to assets/");
}
