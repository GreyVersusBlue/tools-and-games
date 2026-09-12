// The four facts of this pass that only a rendered page can settle. Run from
// anywhere: node Numina/test/a11y/layout.mjs. Exits non-zero on failure (#13).
//
// axe.mjs beside this file checks what axe-core has a rule for. These are the
// ones it does not: whether the skip link moves focus rather than only the
// scroll, whether a table is still a table after the CSS is applied, whether
// the toggle's state follows the click, and whether --header-h is the height
// the header actually has.
//
// The table check is the one worth reading twice. `table { display: block }`
// leaves every row and cell in the DOM and changes nothing a parser can see —
// the markup is a perfectly good table and the accessibility tree has no table
// in it. Asserting over the HTML would pass. So this asserts over the computed
// style of a real markdown table on a real page, which is where the bug lived.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const numina = resolve(here, "..", "..");
const site = resolve(numina, "..");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
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

if (!existsSync(join(numina, "index.html"))) {
  console.error("FAIL  no built site — run `npm run build` in Numina first");
  process.exit(1);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  // --- the skip link actually moves focus ------------------------------------
  console.log("# the skip link");
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/Numina/mechanics/core-rules/`, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => ({
    cls: document.activeElement.className,
    text: document.activeElement.textContent.trim(),
    onScreen: document.activeElement.getBoundingClientRect().left >= 0,
  }));
  ok(first.cls === "skip-link", `the first Tab lands on the skip link (got "${first.cls}")`);
  ok(first.text === "Skip to content", `and it reads "Skip to content" (got "${first.text}")`);
  ok(first.onScreen, "and focusing it brings it on screen");
  await page.keyboard.press("Enter");
  const landed = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    id: document.activeElement.id,
  }));
  ok(landed.tag === "MAIN" && landed.id === "main", `pressing it moves focus to <main>, not only the scroll (got ${landed.tag}#${landed.id})`);

  // --- a table is a table ----------------------------------------------------
  // Crafting, because Core Rules is 96 headings of prose and has no table in it.
  console.log("# tables");
  await page.goto(`${base}/Numina/mechanics/crafting/`, { waitUntil: "networkidle" });
  const table = await page.evaluate(() => {
    const t = document.querySelector("main table");
    if (!t) return null;
    const wrap = t.parentElement;
    return {
      display: getComputedStyle(t).display,
      rows: t.rows.length,
      cells: t.rows[0]?.cells.length ?? 0,
      wrapper: wrap.className,
      wrapperOverflow: getComputedStyle(wrap).overflowX,
    };
  });
  ok(table !== null, "Crafting has a table in its body to check");
  ok(table?.display === "table", `a markdown table computes to display: table (got ${table?.display})`);
  ok(table?.rows > 1 && table?.cells > 1, `and it has rows and columns (${table?.rows} x ${table?.cells})`);
  ok(table?.wrapper === "table-scroll" && table?.wrapperOverflow === "auto", `the horizontal scroll is on the wrapper (${table?.wrapper}, overflow-x: ${table?.wrapperOverflow})`);

  // --- the toggle says which way it is set -----------------------------------
  console.log("# the theme toggle");
  const before = await page.getAttribute("[data-theme-toggle]", "aria-pressed");
  await page.click("[data-theme-toggle]");
  const after = await page.getAttribute("[data-theme-toggle]", "aria-pressed");
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  ok(before !== after, `aria-pressed follows the click (${before} → ${after})`);
  ok(after === String(theme === "dark"), `and it names the theme in force (data-theme="${theme}", aria-pressed="${after}")`);
  await page.close();

  // --- --header-h is the header's height -------------------------------------
  //
  // The sticky timeline-era chips are positioned at top: var(--header-h). Too
  // small and a chip tucks under the header; too large and it floats below it
  // with a gap. The header is the same height at every width (the wordmark is
  // its tallest item at all of them), so both viewports must agree.
  console.log("# --header-h");
  for (const width of [1280, 390]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    await p.goto(`${base}/Numina/lore/history/`, { waitUntil: "networkidle" });
    const m = await p.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const declared = parseFloat(root.getPropertyValue("--header-h")) * parseFloat(root.fontSize);
      return { declared, real: document.querySelector(".site-header").getBoundingClientRect().height };
    });
    const slack = m.declared - m.real;
    ok(slack >= 0 && slack < 2, `at ${width}px the header is ${m.real.toFixed(2)}px and --header-h is ${m.declared.toFixed(2)}px (slack ${slack.toFixed(2)}px, wanted 0 to 2)`);

    // And the chip that rides on it meets the header when it is stuck. Below
    // 52rem the chip is position: static by design, so there is nothing to
    // measure — the media query is the assertion there.
    const sticky = await p.evaluate(() => getComputedStyle(document.querySelector(".timeline__era")).position);
    ok(sticky === (width > 832 ? "sticky" : "static"), `at ${width}px the era chip is position: ${sticky}`);
    const stuck = sticky !== "sticky" ? null : await p.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const height = document.documentElement.scrollHeight;
      let best = null;
      for (let y = 0; y < height; y += 40) {
        window.scrollTo(0, y);
        const headerBottom = document.querySelector(".site-header").getBoundingClientRect().bottom;
        for (const era of document.querySelectorAll(".timeline__era")) {
          const box = era.getBoundingClientRect();
          const chip = era.querySelector("span").getBoundingClientRect();
          // Stuck: sitting exactly at its `top` offset rather than scrolling.
          if (Math.abs(box.top - parseFloat(getComputedStyle(era).top)) > 1) continue;
          // The worst reading over the whole scroll, because a chip that meets
          // the header at one offset and hides under it at another is still
          // wrong. Sub-pixel scroll positions put a stuck element within about
          // half a pixel of its `top`, so the tolerance below is symmetric.
          const gap = chip.top - headerBottom;
          if (best === null || Math.abs(gap) > Math.abs(best)) best = gap;
        }
      }
      return best;
    });
    if (sticky === "sticky") {
      ok(stuck !== null, `at ${width}px an era chip does stick (so the check means something)`);
      ok(stuck !== null && Math.abs(stuck) < 1.5, `at ${width}px the stuck chip meets the header within ${stuck?.toFixed(2)}px (wanted under 1.5)`);
    }
    await p.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
