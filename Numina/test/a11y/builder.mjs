// The character builder page, in a real browser. Run from anywhere:
//   node Numina/test/a11y/builder.mjs
// Exits non-zero on any failure (repo convention, #13).
//
// test/builder.test.mjs checks the pure modules and the built markup in Node.
// What it cannot see is src/js/builder.js, the one file that reads the form,
// writes localStorage and rewrites the URL fragment, and that is all this
// checks: ticking a box moves the CP total by the printed cost, the save
// survives a reload, a link opens the same build in a browser that has never
// seen it, a save or link older than the current shape still loads, a fourth
// Quick Reflexes is refused, and the page is no wider than a phone at 390 px.
//
// Every wait polls for the state it wants (page.waitForFunction); nothing here
// sleeps. The page works out its numbers inside the input event, so a poll
// usually passes on its first look and a page that never gets there fails
// after 5 seconds with the number it did show.
//
// Names are the rulebook's own (Excellencies, skills), which is the data the
// page is built from. No person's name appears.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..", "..", "..");
const PAGE = "/Numina/mechanics/character-builder/";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg",
  ".xml": "application/xml; charset=utf-8",
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
const pageErrors = [];

// A fresh browser context is an empty localStorage, which is what "a browser
// that has never seen this build" means.
async function fresh(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  return page;
}

async function open(page, hash = "") {
  await page.goto(`${origin}${PAGE}${hash}`, { waitUntil: "load" });
  await page.waitForSelector("[data-builder]:not([hidden])", { timeout: 5000 });
}

// A save written into storage and then read by a full reload. The reload has
// no fragment, which is the only way the page reads storage at all (a fragment
// wins over the save), so the URL is cleared first. The page's own first paint
// has just cleared the key (an empty build removes it), so the write comes
// after the load and the reload is what reads it.
async function openWithSave(page, text) {
  await open(page);
  await page.evaluate((t) => {
    localStorage.setItem("numina.build", t);
    history.replaceState(null, "", location.pathname);
  }, text);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-builder]:not([hidden])", { timeout: 5000 });
}

// The page's numbers, read out of its own verdict panel ("18 CP of 50 spent").
const spentNow = (page) =>
  page.locator("[data-verdict]").innerText().then((t) => Number(/(\d+) CP of 50 spent/.exec(t)?.[1] ?? NaN));

async function spentIs(page, n) {
  try {
    await page.waitForFunction(
      (want) => Number(/(\d+) CP of 50 spent/.exec(document.querySelector("[data-verdict]").innerText)?.[1]) === want,
      n,
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function settles(page, condition, arg, timeout = 5000) {
  try {
    await page.waitForFunction(condition, arg, { timeout });
    return true;
  } catch {
    return false;
  }
}

const box = (page, name, value, repeat) =>
  page.locator(`input[name="${name}"][value="${value}"]${repeat === undefined ? ":not([data-repeat])" : `[data-repeat="${repeat}"]`}`);
const hash = (page) => page.evaluate(() => location.hash);
const stored = (page) => page.evaluate(() => localStorage.getItem("numina.build"));
// Read from the step lists, not the verdict panel, which repeats each of them.
const problemCodes = (page) =>
  page.evaluate(() => [...document.querySelectorAll("[data-step-problems] [data-problem]")].map((e) => e.dataset.problem).sort());
const checkedValues = (page, name) =>
  page.locator(`input[name="${name}"]:checked`).evaluateAll((els) => els.map((e) => e.value));
// The printed cost of the skill row a box sits in, as the page shows it.
const printedCost = (input) =>
  input.evaluate((e) => Number(/(\d+) CP/.exec(e.closest("li").querySelector(".builder__cost")?.textContent ?? "")?.[1] ?? NaN));

const QR = "open-skills/open-skills/quick-reflexes";
const ARCHERY = "open-skills/open-skills/archery";
const REFRESH = "excellencies/ballista/refresh-quiver";
const HEAT = "excellencies/forge-fire/heat-the-forge";
const BASE = "a=arcane&f=military&c=aluvair&d=air";

try {
  // --- an empty page -----------------------------------------------------
  console.log("# a page nobody has used");
  {
    const page = await fresh();
    await open(page);
    ok(await spentIs(page, 0), "it opens at 0 CP spent");
    ok((await problemCodes(page)).length >= 4, "with the four missing-choice problems showing");
    ok((await hash(page)) === "" && (await stored(page)) === null, "and writes neither a fragment nor a save for an empty build");
    ok((await page.locator("[data-builder-needs-js]").isHidden()), "the no-JS notice is hidden");
    await page.context().close();
  }

  // --- ticking boxes -----------------------------------------------------
  console.log("# ticking boxes");
  let linkAfterBuild;
  {
    const page = await fresh();
    await open(page);
    await page.locator('input[name="aspects"][value="arcane"]').check();
    await page.locator('input[name="foundation"][value="military"]').check();
    await page.locator('input[name="culture"][value="aluvair"]').check();
    await page.locator('input[name="domain"][value="air"]').check();
    ok((await problemCodes(page)).length === 0, "an Aspect, a Foundation, a Culture and a Domain clear the four problems");
    const base = await spentNow(page);
    ok(base === 0, `and the four choices themselves are free (${base} CP)`);
    ok((await hash(page)).startsWith("#a=arcane&f=military&c=aluvair&d=air"), `the address bar is the share link (${await hash(page)})`);
    ok(
      (await page.locator("[data-share]").inputValue()) === `${origin}${PAGE}${await hash(page)}`,
      "and the share box holds the same link, origin and all"
    );
    ok(JSON.parse((await stored(page)) ?? "{}").build?.domain === "air", "and the save holds the Domain");

    // One skill from an Excellency: not offered until the Excellency is held.
    ok((await box(page, "excellencySkills", REFRESH).count()) === 0, "step 7 lists no Ballista skill before Ballista is chosen");
    await page.locator('input[name="excellencies"][value="Ballista"]').check();
    ok(await settles(page, (v) => document.querySelector(`input[value="${v}"]`) !== null, REFRESH), "choosing Ballista lists its skills");
    const withBallista = await spentNow(page);
    ok(withBallista > base, `and the Excellency itself is charged (${base} to ${withBallista} CP)`);
    const refresh = box(page, "excellencySkills", REFRESH);
    const refreshCost = await printedCost(refresh);
    ok(refreshCost === 4, `Refresh Quiver prints 4 CP (${refreshCost})`);
    await refresh.check();
    ok(await spentIs(page, withBallista + 4), "ticking it adds its printed cost");
    await refresh.uncheck();
    ok(await spentIs(page, withBallista), "and unticking takes it back");
    await refresh.check();

    // A skill the book lets a character buy twice has two boxes.
    await page.locator('input[name="excellencies"][value="Forge fire"]').check();
    const heat0 = box(page, "excellencySkills", HEAT);
    const heat1 = box(page, "excellencySkills", HEAT, 1);
    ok((await heat0.count()) === 1 && (await heat1.count()) === 1, "Heat the Forge has two boxes, as its row says");
    const heatCost = await printedCost(heat0);
    const beforeHeat = await spentNow(page);
    await heat0.check();
    await heat1.check();
    ok(await spentIs(page, beforeHeat + 2 * heatCost), `both boxes are charged (2 x ${heatCost} CP)`);
    ok(
      (await hash(page)).split("&xs=")[1]?.split("&")[0].split(",").filter((s) => s === HEAT).length === 2,
      "and the link carries the skill twice under xs"
    );

    // Quick Reflexes, up to three times at 1 CP each.
    const qr = [box(page, "openSkills", QR), box(page, "openSkills", QR, 1), box(page, "openSkills", QR, 2)];
    ok((await page.locator(`input[name="openSkills"][value="${QR}"]`).count()) === 3, "Quick Reflexes has three boxes and no fourth");
    const beforeQr = await spentNow(page);
    for (let i = 0; i < 3; i++) {
      await qr[i].check();
      ok(await spentIs(page, beforeQr + i + 1), `${i + 1} Quick Reflexes box${i ? "es" : ""} ticked: ${i + 1} CP more`);
    }
    ok((await problemCodes(page)).length === 0, "three of them is not a problem");
    linkAfterBuild = await hash(page);
    ok(linkAfterBuild.includes(`o=${QR},${QR},${QR}`), "and the link carries three entries under o");

    // The save outlives the page.
    const total = await spentNow(page);
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("[data-builder]:not([hidden])", { timeout: 5000 });
    ok(await spentIs(page, total), `reloaded with no fragment, the save brings back the same ${total} CP`);
    ok(
      (await checkedValues(page, "excellencies")).sort().join() === "Ballista,Forge fire" &&
        (await checkedValues(page, "openSkills")).length === 3 &&
        (await checkedValues(page, "excellencySkills")).length === 3,
      "and the same boxes are ticked"
    );
    ok((await hash(page)) === linkAfterBuild, "and the fragment is written back to match");

    // Reset.
    await page.locator("[data-reset]").click();
    ok(await spentIs(page, 0) && (await hash(page)) === "" && (await stored(page)) === null, "Reset clears the form, the fragment and the save");
    await page.context().close();
  }

  // --- a link --------------------------------------------------------------
  console.log("# a link");
  {
    const page = await fresh();
    await open(page, linkAfterBuild);
    const checked = await checkedValues(page, "openSkills");
    ok(checked.length === 3 && (await checkedValues(page, "excellencySkills")).length === 3, "a link opened in a browser with no save rebuilds the form");
    ok((await problemCodes(page)).length === 0, "and prices it without a problem");
    const total = await spentNow(page);
    // A pasted link over the open page is a new build.
    await page.evaluate(() => (location.hash = "#a=arcane"));
    ok(await settles(page, () => document.querySelectorAll('input[name="openSkills"]:checked').length === 0), "a new fragment pasted over the page replaces the build (hashchange)");
    ok(total > (await spentNow(page)), "and its price follows");
    // A link wins over a save.
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("[data-builder]:not([hidden])", { timeout: 5000 });
    ok(
      (await checkedValues(page, "aspects")).join() === "arcane" && (await checkedValues(page, "excellencies")).length === 0,
      "reloaded without a fragment, the save (the pasted build) is what comes back, not the first link"
    );
    await page.context().close();
  }
  {
    // A heading link is a link, not a build: with a save on the shelf, the save
    // is what opens, because a fragment that decodes to nothing does not win.
    const page = await fresh();
    await openWithSave(page, JSON.stringify({ v: 1, build: { aspects: ["arcane"], domain: "air" } }));
    await page.evaluate(() => history.replaceState(null, "", `${location.pathname}#step-5`));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("[data-builder]:not([hidden])", { timeout: 5000 });
    ok((await checkedValues(page, "domain")).join() === "air", "a link to a heading (#step-5) is not read as a build, so the save opens");
    await page.context().close();
  }

  // --- older saves and links ----------------------------------------------
  console.log("# older saves and links");
  {
    const bare = { aspects: ["arcane"], foundation: "military", culture: "aluvair", domain: "air", openSkills: [QR] };
    const page = await fresh();
    await openWithSave(page, JSON.stringify({ v: 1, build: bare }));
    ok((await checkedValues(page, "openSkills")).join() === QR && (await checkedValues(page, "domain")).join() === "air", "a v1 save with no Excellency skill list loads");
    const v1 = await spentNow(page);
    ok((await problemCodes(page)).length === 0, "without a problem");
    await openWithSave(page, JSON.stringify(bare));
    ok((await checkedValues(page, "openSkills")).join() === QR && (await spentNow(page)) === v1, `an unversioned save loads and prices the same (${v1} CP)`);
    await openWithSave(page, "this is not a build");
    ok((await spentNow(page)) === 0, "a save that is not JSON loads as an empty build");
    ok(
      await page.evaluate(() => localStorage.getItem("numina.build")) === null,
      "and is cleared rather than kept"
    );
    await page.context().close();

    const link = await fresh();
    await open(link, "#a=arcane&x=Ballista");
    ok((await checkedValues(link, "excellencies")).join() === "Ballista" && (await box(link, "excellencySkills", REFRESH).count()) === 1, "an old link with no xs key opens, Ballista held, none of its skills");
    ok((await problemCodes(link)).length === 3, "and shows the three choices it still lacks");
    await link.context().close();

    // A typed name that is on neither list keeps its own box.
    const typed = await fresh();
    await open(typed, "#a=arcane&x=Ritual%20Curse%20Removal");
    ok(
      (await typed.locator('[data-unlisted] input[name="excellencies"]:checked').evaluateAll((e) => e.map((x) => x.value))).join() === "Ritual Curse Removal",
      "an old typed Excellency name keeps a ticked box of its own"
    );
    await typed.context().close();
  }

  // --- the fourth Quick Reflexes ---------------------------------------------
  console.log("# a fourth Quick Reflexes");
  {
    const three = await fresh();
    await open(three, `#${BASE}&o=${QR},${QR},${QR}`);
    const threePrice = await spentNow(three);
    await three.context().close();
    const page = await fresh();
    await open(page, `#${BASE}&o=${QR},${QR},${QR},${QR}`);
    ok((await page.locator(`input[name="openSkills"][value="${QR}"]:checked`).count()) === 3, "an edited link with four shows three ticked boxes");
    ok((await problemCodes(page)).join() === "duplicate-selection", `and reports the fourth as a problem (${(await problemCodes(page)).join()})`);
    ok(await spentIs(page, threePrice), `without charging for it (${threePrice} CP)`);
    await page.context().close();
  }

  // --- Tornado and Archery ----------------------------------------------------
  console.log("# Tornado and Archery");
  {
    const page = await fresh();
    await open(page, `#${BASE}&x=Tornado`);
    ok((await problemCodes(page)).join() === "prerequisite-missing", "Tornado without Archery carries the prerequisite problem");
    ok(
      (await page.locator('[data-step-problems="7"] [data-problem="prerequisite-missing"]').count()) === 1 &&
        (await page.locator('[data-step-problems="5"] [data-problem]').count()) === 0,
      "under step 7, where Archery is sold, and not under step 5"
    );
    ok((await page.locator('[data-prerequisite="excellencies/tornado-air-lightning/bow-and-sword"]').count()) === 1, "and step 7 says so under Tornado's heading");
    const without = await spentNow(page);
    const archery = box(page, "openSkills", ARCHERY);
    ok((await printedCost(archery)) === 3, "Archery prints 3 CP");
    await archery.check();
    ok(await spentIs(page, without + 3), "ticking Archery costs 3 CP");
    ok((await problemCodes(page)).length === 0, "and clears the problem");
    ok(await settles(page, () => location.hash.includes("open-skills/open-skills/archery")), "and the link now names it");
    await archery.uncheck();
    ok((await problemCodes(page)).join() === "prerequisite-missing", "unticking it brings the problem back");
    await page.context().close();
  }

  // --- a phone ---------------------------------------------------------------
  console.log("# 390 px wide");
  {
    // Three Excellencies, one of them a typed name 125 characters long: the
    // shape that once made the page 509 px wide.
    const long = "Q".repeat(125);
    const page = await fresh(390);
    await open(page, `#${BASE}&x=Tornado,Ballista,Forge%20fire,${long}&xs=${REFRESH},${HEAT},${HEAT}&o=${QR},${QR},${QR},${ARCHERY}`);
    const width = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    let w = await width();
    ok(w.client === 390 && w.scroll <= 390, `three Excellencies and a long typed name: the page is ${w.scroll} px wide in a ${w.client} px window`);
    ok((await page.locator('[data-unlisted] input[name="excellencies"]:checked').count()) === 1, "the long name kept its box");
    await page.locator('[data-reset]').click();
    ok(await spentIs(page, 0), "Reset works on the narrow page");
    w = await width();
    ok(w.scroll <= 390, `and the empty page is no wider (${w.scroll} px)`);
    await page.context().close();
  }

  ok(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
