// Phase 8's search, in a real browser. Run from anywhere:
//   node Numina/test/a11y/search.mjs
// Exits non-zero on any failure (repo convention, #13).
//
// Everything here needs a browser and an origin, and nothing here is visible in
// the built HTML, which is why it is not in test/smoke.mjs:
//
//   - The modal does not exist in any page's markup. js/search-modal.js fetches
//     the 175 KB Component UI bundle on the first open and builds the elements
//     then, so the only way to know the lazy path works is to press the keys.
//   - Whether a <dialog> traps focus and whether Escape closes it are the
//     browser's answers, not the markup's.
//   - The ?q= handoff sets an input's value and fires the event the component
//     listens for. A grep of the page proves the code is there, not that a term
//     arrives as results.
//   - A search needs the index over HTTP. Pagefind's loader fetches wasm and
//     index chunks; from file:// none of it runs.
//
// The one that would otherwise have shipped broken: bundle-path. Written
// relative the way the old constructor call had it, or without the /Numina/
// prefix, every element renders, the input takes typing and every search comes
// back with nothing, because the index 404'd behind it.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..", "..", "..");

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
function ok(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}`); }
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// A console error here is usually the bundle failing to load or Pagefind failing
// to find its index, and both of those otherwise look like "no results".
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  // --- the header swap ----------------------------------------------------
  console.log("# the header");
  await page.goto(`${origin}/Numina/mechanics/core-rules/`, { waitUntil: "load" });
  const trigger = page.locator("[data-search-open]");
  await trigger.waitFor({ state: "visible" });
  ok(await trigger.isVisible(), "with JS, the header shows the modal trigger");
  ok(!(await page.locator(".header-search").isVisible()), "and hides the form it replaces");
  // The no-JS path, from the same page with scripts off. The form is what has to
  // be there, and it has to be able to submit.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const plain = await noJs.newPage();
  await plain.goto(`${origin}/Numina/mechanics/core-rules/`, { waitUntil: "load" });
  ok(await plain.locator(".header-search").isVisible(), "without JS, the form is the one that is visible");
  ok(!(await plain.locator("[data-search-open]").isVisible()), "and the trigger stays hidden");
  ok(
    await plain.locator('.header-search button[type="submit"]').isVisible(),
    "and it has a submit button a pointer can press"
  );
  await noJs.close();

  // --- the modal ----------------------------------------------------------
  console.log("# the modal");
  // Nothing of the bundle is on the page until it is asked for. This is the
  // whole reason for the lazy load, so it is the first thing checked.
  ok(
    (await page.locator("pagefind-modal").count()) === 0,
    "before the first open, no modal and no bundle are on the page"
  );
  await page.keyboard.press("Control+k");
  const dialog = page.locator("pagefind-modal dialog");
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  ok(await dialog.isVisible(), "Ctrl+K loads the bundle and opens the modal");
  ok(
    await page.evaluate(() => document.querySelector("pagefind-modal dialog")?.matches(":modal") === true),
    "as a modal dialog, which is what trapping focus and handling Escape comes from"
  );
  ok(
    await page.evaluate(() => {
      const d = document.querySelector("pagefind-modal dialog");
      return !!d && d.contains(document.activeElement);
    }),
    "and focus is inside it"
  );
  ok(
    await page.evaluate(() => document.activeElement?.tagName === "INPUT"),
    "on the search input, so a visitor can type straight away"
  );

  // A search from the modal, which is the one that proves the lazily injected
  // bundle found its index at the bundle-path the trigger carries.
  await page.keyboard.type("longbow");
  const results = page.locator("pagefind-modal .pf-result, pagefind-modal [data-pf-result-index]");
  await results.first().waitFor({ state: "visible", timeout: 15000 });
  const count = await results.count();
  ok(count > 0, `typing in the modal returns results (${count})`);
  const firstHref = await page.locator("pagefind-modal a[href*='/Numina/']").first().getAttribute("href");
  ok(
    !!firstHref && firstHref.startsWith("/Numina/"),
    `and a result links into the site (${firstHref ?? "none"})`
  );

  // Tab from the last focusable stays inside: the browser's own trap, asserted
  // rather than assumed, because a non-modal <dialog> would not do it.
  const before = await page.evaluate(() => document.activeElement?.tagName);
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  ok(
    await page.evaluate(() => {
      const d = document.querySelector("pagefind-modal dialog");
      return !!d && d.contains(document.activeElement);
    }),
    `25 tabs later focus is still in the dialog (started on ${before})`
  );

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  ok(!(await dialog.isVisible()), "Escape closes it");
  ok(
    await page.evaluate(() => document.activeElement?.matches("[data-search-open]") === true),
    "and focus goes back to the trigger that opened it"
  );
  // Second open: the bundle is already in, so this is the path where the
  // component's own state has to be reusable.
  await page.keyboard.press("Control+k");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  ok(await dialog.isVisible(), "and Ctrl+K opens it again");
  await page.keyboard.press("Escape");

  // --- the search page ----------------------------------------------------
  console.log("# /search/ and the ?q= handoff");
  await page.goto(`${origin}/Numina/search/?q=longbow`, { waitUntil: "load" });
  const pageResults = page.locator("pagefind-results .pf-result, pagefind-results [data-pf-result-index]");
  await pageResults.first().waitFor({ state: "visible", timeout: 15000 });
  ok((await pageResults.count()) > 0, `?q= arrives as results (${await pageResults.count()})`);
  ok(
    (await page.locator("pagefind-input input").inputValue()) === "longbow",
    "and the term is in the input, not just in the result list"
  );
  const summary = (await page.locator("pagefind-summary").textContent())?.trim() ?? "";
  ok(/longbow/i.test(summary), `the count names the term (${JSON.stringify(summary)})`);
  // On this page the shortcut focuses the input that is already here rather than
  // stacking a modal on top of the same search.
  await page.locator("h1").click();
  await page.keyboard.press("Control+k");
  ok(
    await page.evaluate(() => document.activeElement?.closest("pagefind-input") !== null),
    "Ctrl+K on /search/ focuses the page's own input"
  );
  ok((await page.locator("pagefind-modal").count()) === 0, "and builds no modal over it");

  ok(consoleErrors.length === 0, `no page errors${consoleErrors.length ? `: ${consoleErrors.slice(0, 3).join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
