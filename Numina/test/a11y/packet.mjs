// The two things Phase 7 built that a file on disk cannot settle: whether a
// packet assembles into one document in a real browser, and whether the site
// actually opens with the network gone. Run from anywhere:
//   node Numina/test/a11y/packet.mjs
// Exits non-zero on failure (#13).
//
// It lives beside axe.mjs and layout.mjs because it needs the same thing they
// do — a browser and an origin. A service worker will not register from
// file://, and packet.js fetches chapters, so nothing here can run in the
// build job. Same local server, same pinned Chromium.
//
// What it will not tell you: how a packet looks on paper. The page counter is
// checked by asking Chromium whether it parsed the @page margin box at all,
// because a rule Blink does not understand is dropped from the CSSOM rather
// than kept and ignored. That is the fact worth guarding: the numbering is the
// one part of this that depends on a feature Firefox still has not shipped, so
// a browser bump that took it away in Chromium too should be one line in a log
// and not a stack of unnumbered packets at an event.
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
  ".pagefind": "application/octet-stream", ".pf_meta": "application/octet-stream",
  ".pf_index": "application/octet-stream", ".pf_fragment": "application/octet-stream",
};

function serve() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = join(site, normalize(url).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(site + sep) && file !== site) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404).end(`not found: ${url}`); return; }
    // no-store on everything. Without it the browser's own HTTP cache answers
    // the offline navigation below and the assertion passes with the service
    // worker's cache emptied — which is how it passed the first time it was
    // broken on purpose. Cache Storage is explicit and unaffected, so the kit
    // still installs; the only thing that can answer offline is the worker.
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  // Shutting the origin down is the only way to prove the offline kit is what
  // answers. Playwright's setOffline is emulated per page and a service
  // worker's own fetch goes out on a session it does not cover, so with the
  // server still listening the worker fetched Core Rules over the network and
  // the assertion below passed with its cache disabled.
  server.stop = () =>
    new Promise((done) => {
      for (const socket of sockets) socket.destroy();
      server.close(done);
    });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}`); }
}

if (!existsSync(join(numina, "sw.js"))) {
  console.error("FAIL  no built site — run `npm run build` in Numina first");
  process.exit(1);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
// 127.0.0.1 is a secure context, which is what a service worker needs.
const PACKET = `${base}/Numina/mechanics/packet/`;
const browser = await chromium.launch();

try {
  // --- a prebuilt packet assembles -----------------------------------------
  console.log("# the packet");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${PACKET}?p=npc`);
  await page.waitForSelector("[data-packet-doc][data-chapters]", { timeout: 20000 });

  const packet = await page.evaluate(() => {
    const doc = document.querySelector("[data-packet-doc]");
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    const chapters = [...doc.querySelectorAll(".packet-chapter")];
    return {
      chapters: chapters.length,
      contents: doc.querySelectorAll(".packet-contents li").length,
      cover: doc.querySelector(".packet-cover__title")?.textContent ?? "",
      // One h1 in the whole document: the page's own. Six chapters carrying
      // their own would be six documents stapled together.
      h1s: document.querySelectorAll("main h1").length,
      docH1s: doc.querySelectorAll("h1").length,
      duplicateIds: ids.length - new Set(ids).size,
      // A link that still points at another chapter's web address is a link
      // that does nothing in a field.
      outward: [...doc.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href"))
        .filter((h) => h.startsWith("/Numina/mechanics/core-rules/")).length,
      inward: [...doc.querySelectorAll('a[href^="#"]')].length,
      dangling: [...doc.querySelectorAll('a[href^="#"]')]
        .map((a) => a.getAttribute("href").slice(1))
        .filter((id) => id && !doc.querySelector(`[id="${CSS.escape(id)}"]`)).length,
      chrome: doc.querySelectorAll(".crumb, .toc, .print-action, .heading-anchor, .skill-anchor").length,
    };
  });

  ok(packet.chapters === 4, `the NPC packet assembles its four chapters (${packet.chapters})`);
  ok(packet.contents === packet.chapters, `the contents lists every chapter (${packet.contents})`);
  ok(packet.cover === "NPC Packet", `the cover carries the packet's name (${JSON.stringify(packet.cover)})`);
  ok(packet.docH1s === 0 && packet.h1s === 1, `the packet is one document with one h1 (${packet.h1s} on the page, ${packet.docH1s} in the packet)`);
  ok(packet.duplicateIds === 0, `no two elements in the packet share an id (${packet.duplicateIds} duplicates)`);
  ok(packet.chrome === 0, `no breadcrumb, contents box, print button or § permalink came along (${packet.chrome})`);
  ok(packet.outward === 0, `no link in the packet still points at a chapter's web address (${packet.outward})`);
  ok(packet.inward > 0 && packet.dangling === 0, `all ${packet.inward} links inside the packet resolve inside it (${packet.dangling} dangling)`);

  const levels = await page.evaluate(() =>
    [...document.querySelectorAll("[data-packet-doc] :is(h1,h2,h3,h4,h5,h6)")].map((h) => Number(h.tagName[1]))
  );
  ok(levels.length > 50 && Math.min(...levels) === 2, `every heading in the packet is h2 or deeper (${levels.length} headings, shallowest h${Math.min(...levels)})`);

  // The bottom of the shift, on a chapter that actually reaches it. The four
  // chapters above stop at h4, so an h5 → h6 bug is invisible to them: Faith &
  // Religion and the Skills landing page are the only two pages on the site
  // with an h5, and this is the one of them the packet offers.
  const deep = await page.evaluate(async () => {
    for (const box of document.querySelectorAll("[data-packet-chapter]")) {
      box.checked = box.value.endsWith("/lore/religion/");
    }
    document.querySelector("[data-packet-assemble]").click();
    const doc = document.querySelector("[data-packet-doc]");
    for (let i = 0; i < 200 && !doc.querySelector(".packet-chapter"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const headings = [...doc.querySelectorAll(":is(h1,h2,h3,h4,h5,h6)")].map((h) => Number(h.tagName[1]));
    return { deepest: Math.max(...headings), sixes: headings.filter((l) => l === 6).length };
  });
  ok(deep.sixes > 0, `Faith & Religion's h5s land as h6 (${deep.sixes} of them), so the bottom of the shift is exercised`);
  ok(deep.deepest === 6, `and nothing goes past h6 (deepest h${deep.deepest})`);

  // --- the page counter -----------------------------------------------------
  console.log("# page numbering");
  const pageRule = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.constructor.name === "CSSPageRule" && rule.selectorText === "packet") return rule.cssText;
      }
    }
    return null;
  });
  ok(pageRule !== null, "print.css's @page packet rule reaches the browser");
  ok(
    pageRule !== null && /@bottom-center/.test(pageRule) && /counter\(page\)/.test(pageRule),
    "this browser keeps the page counter in the margin box, so a printed packet is numbered"
  );

  // --- the offline kit ------------------------------------------------------
  console.log("# the offline kit");
  await page.goto(`${base}/Numina/`);
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return !!registration.active;
  });
  ok(registered, "the service worker registers and activates from a page load");

  const version = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data);
        navigator.serviceWorker.controller.postMessage({ type: "numina-version" }, [channel.port2]);
        setTimeout(() => resolve(null), 5000);
      })
  );
  ok(version && /^[0-9a-f]{12}$/.test(version.version), `the worker names its build (${version?.version ?? "no answer"})`);
  ok(version && version.files > 70, `and precaches the site (${version?.files ?? 0} files)`);

  // The whole point: the network goes away and a page nobody has opened yet
  // still opens. Core Rules was not visited above — it was fetched into a
  // packet on a different page, which is not the same as having been loaded.
  // The origin is shut down rather than emulated away, and setOffline is here
  // only so navigator.onLine reads false for the banner.
  await server.stop();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const response = await offlinePage.goto(`${base}/Numina/mechanics/core-rules/`).catch(() => null);
  const heading = await offlinePage.textContent("main h1").catch(() => null);
  ok(response !== null && heading === "Core Rules", `with the network gone, Core Rules still opens (${JSON.stringify(heading)})`);
  const styled = await offlinePage.evaluate(() => getComputedStyle(document.body).fontFamily);
  ok(/Alegreya/.test(styled), `and it is still the styled site, not bare HTML (${styled})`);
  const banner = await offlinePage.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    const el = document.querySelector(".offline-banner");
    return el && !el.hidden ? el.querySelector(".offline-banner__text").textContent : null;
  });
  ok(
    banner !== null && /saved on this device, build [0-9a-f]{12}/.test(banner),
    `the offline banner names the build it is showing (${JSON.stringify(banner)})`
  );
  await context.close();
} finally {
  await browser.close();
  await server.stop();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
