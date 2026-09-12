// axe-core over the built Numina site. Run from anywhere:
//   node Numina/test/a11y/axe.mjs
// Exits non-zero on any violation (repo convention, #13).
//
// This is the check that stops the audit's section B coming back. Six of its
// seven findings were one-line fixes and every one of them was written by hand
// and could be undone by hand: a role="img" back on the map, an aria-hidden
// back on a group label, a gold token nudged a shade lighter. Nothing in the
// build or in npm test could see any of it.
//
// Why a separate package rather than a devDependency of the site: the build
// job runs `npm ci` for Eleventy and Pagefind on every Numina PR, and a
// browser in that lockfile would be a browser downloaded on every one of them.
// Hearth's test/ folder is the same arrangement for the same reason.
//
// What it covers: four pages that between them carry every piece of chrome the
// site has — the map and the card grids (home), the infobox and the drop cap
// (a nation), the TOC and 96 headings of tables (Core Rules), and a widget
// whose markup is a third party's (search). Each runs twice, in the light
// theme and the dark one, because a contrast rule only checks the palette that
// is actually in force.
//
// What it does NOT cover, and no automated pass does: whether the map's
// regions are in a sensible order, whether a heading says anything, or whether
// the skip link goes anywhere useful. Roughly a third of WCAG is machine
// checkable. A green run here is a floor.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const numina = resolve(here, "..", "..");
const site = resolve(numina, "..");
const axeSource = readFileSync(join(here, "node_modules", "axe-core", "axe.min.js"), "utf8");

// The four pages, by the URL a visitor would type. Paths are the built output,
// which is what is deployed — nothing here runs Eleventy.
const PAGES = [
  ["home", "/Numina/"],
  ["a nation (Aluvair)", "/Numina/lore/nations/aluvair/"],
  ["Core Rules", "/Numina/mechanics/core-rules/"],
  ["search", "/Numina/search/"],
];
const THEMES = ["light", "dark"];
// WCAG 2.1 A and AA, plus axe's best-practice set. best-practice is in because
// two of the things section B was made of live there and nowhere else:
// heading-order, and nested-interactive — which is the rule that fires when the
// map goes back to role="img" with 16 links inside it.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

// The contrast pass runs against the page with its decoration flattened, and
// this is why. Every surface on this site is a colour under a low-alpha noise
// texture, and the chrome is drawn with masked pseudo-elements over it. axe
// samples a computed background and gives up when it finds an image or an
// overlapping element, so on the page as served it returns "incomplete" rather
// than a ratio: 642 of 710 text nodes on Core Rules, and that is the rule that
// was supposed to catch a 3.11:1 gold. The texture is alpha 0.07 over --paper
// and the pseudo-elements are ornament, so the flattened page is the same
// colours a reader sees. With it, --gold at 3.11:1 on .hero__kicker comes back
// as a violation naming the ratio.
//
// It does not reach everything even then: an icon button with no text, an h1
// with a text-shadow, a map label over a filled region, a TOC link the sticky
// header overlaps. Those stay incomplete and the count is printed rather than
// swallowed. The gate that does not depend on any of this is in
// test/smoke.mjs, which computes the ratio from the two token values.
const FLATTEN = [
  "*{background-image:none!important}",
  ".card::before,.card::after,.home-card::before,.home-card::after,",
  ".infobox::before,.infobox::after,.toc::before,.toc::after,",
  ".site-header::after,.site-footer::before,.wordmark::before,hr::after,",
  ".shell main>h2::after{content:none!important;display:none!important}",
].join("");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
  ".xml": "application/xml; charset=utf-8", ".wasm": "application/wasm",
  ".pagefind": "application/octet-stream", ".pf_fragment": "application/octet-stream",
  ".pf_index": "application/octet-stream", ".pf_meta": "application/octet-stream",
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

let failures = 0;
function report(label, violations) {
  if (!violations.length) { console.log(`  ok  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}: ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`        ${v.id} (${v.impact}) — ${v.help}`);
    for (const node of v.nodes.slice(0, 4)) {
      console.error(`          ${node.target.join(" ")}`);
      const detail = [...node.any, ...node.all, ...node.none].map((c) => c.message).join("; ");
      if (detail) console.error(`            ${detail}`);
    }
    if (v.nodes.length > 4) console.error(`          …and ${v.nodes.length - 4} more`);
    console.error(`          ${v.helpUrl}`);
  }
}

if (!existsSync(join(numina, "index.html"))) {
  console.error("FAIL  no built site — run `npm run build` in Numina first");
  process.exit(1);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const theme of THEMES) {
    console.log(`# ${theme} theme`);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: theme,
    });
    // The site stores the visitor's choice and applies it before paint. Setting
    // it here rather than trusting colorScheme alone means the run exercises
    // the same code path a returning visitor does, [data-theme] and all.
    await context.addInitScript((t) => {
      try { localStorage.setItem("numina.theme", t); } catch (e) {}
    }, theme);
    const page = await context.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(base + path, { waitUntil: "networkidle" });
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(
        (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
        TAGS
      );
      report(`${name} — ${theme}`, result.violations);

      // Second pass, contrast only, over the flattened page (see FLATTEN).
      await page.addStyleTag({ content: FLATTEN });
      const contrast = await page.evaluate(() =>
        window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] } })
      );
      const counted = contrast.passes.reduce((n, r) => n + r.nodes.length, 0);
      const unread = contrast.incomplete.reduce((n, r) => n + r.nodes.length, 0);
      report(`${name} — ${theme} — contrast (${counted} read, ${unread} axe could not read)`, contrast.violations);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : `\nall ${PAGES.length * THEMES.length * 2} runs clean`);
process.exit(failures ? 1 : 0);
