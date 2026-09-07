// browser.mjs — the surface half of the test suite.
//
// smoke.mjs checks the engine under bare Node, where there is no DOM and the
// only thing a hint or a log kind can be is a string. This one boots the real
// page in real Chromium and asserts what a player actually sees: the hint bar
// after a stairway, the log's colours, the build's own prism on the board, and
// a keyboard that answers when it refuses (locked decision #39).
//
//   node test/browser.mjs
//
// Needs playwright-core and a Chromium on disk — neither is a dependency of
// the game itself, which has none, and neither is in CI. Point CHROME at a
// binary if the default (the Playwright cache) is not where yours lives:
//
//   npm i playwright-core
//   CHROME=/path/to/chrome node test/browser.mjs
//
// Serves the site root itself, so the relative content fetch and
// assets/js/gvb-save.js resolve exactly as they do in play.
//
// Nothing here is a frame-timing or motion assertion, so locked #53 does not
// apply: this game draws on input and sits still between clicks (#29), and a
// software-rendered Chromium reaches the same DOM and the same pixels a real
// GPU does.

import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "..", "..");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PACK = JSON.parse(fs.readFileSync(path.join(HERE, "..", "content", "vault.json"), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, "..", "content", "packs.json"), "utf8"));

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("nope");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/Projects/absalom_inheritance.html`;

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
};
const eq = (label, actual, want) => ok(label, actual === want, actual === want ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
const group = t => console.log(`\n${t}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

const boot = async () => {
  await page.goto(URL_, { waitUntil: "load" });
};

/**
 * Write a doctored state into the save slot and boot on it.
 *
 * The wait is not padding. main.js runs a coalesced autosave that marks itself
 * on every action and flushes on `pagehide`, so a state written here while a
 * mark is still pending is overwritten by the live game's own snapshot on the
 * way out — which is what happened the first time this file tried it, and it
 * looked exactly like a save that had not been written at all. gvb-save's
 * flush is a no-op when nothing is dirty, so letting the 1500 ms timer fire
 * first is the whole fix.
 */
const seedSave = async (mutate, arg) => {
  await page.waitForTimeout(1700);
  await page.evaluate(([fnText, a]) => {
    const st = __absalom.game.snapshot();
    // eslint-disable-next-line no-new-func
    new Function("st", "arg", fnText)(st, a);
    __absalom.slot.save(st);
  }, [mutate, arg]);
  await boot();
  await page.waitForFunction(() => !!window.__absalom, null, { timeout: 20000 });
};

/* ========================================================================= *
 * The picker                                                                *
 * ========================================================================= */
group("the character picker");
await boot();
await page.waitForSelector("#create-veil.open .pc-card");
const cards = await page.$$("#create-grid .pc-card");
eq("one card per build in the pack", cards.length, PACK.pcOptions.length);

// The swatch is the same three colours render.js extrudes the prism from. A
// card that says "the blue one" over a board that draws green is worse than no
// swatch, so both read content.pc.palette and this checks they agree.
const swatches = await page.$$eval("#create-grid .pc-card .pc-swatch polygon",
  ns => ns.map(n => n.getAttribute("fill")));
const wanted = PACK.pcOptions.flatMap(p => [p.palette.top, p.palette.left, p.palette.right]);
eq("every card carries its build's own three faces", swatches.join(","), wanted.join(","));

const names = await page.$$eval("#create-grid .pc-card h3", ns => ns.map(n => n.textContent));
const fighterIdx = PACK.pcOptions.findIndex(p => p.id === "fighter");
eq("the fighter's card is where the pack puts her", names[fighterIdx], PACK.pcOptions[fighterIdx].name);

// Four cards, on a phone. `grid-template-columns: repeat(auto-fit,
// minmax(240px, 1fr))` stacks by arithmetic rather than by a media query, so
// the thing worth asserting is the arithmetic's answer at the narrowest width
// this site designs for — and the way a card grid goes wrong is two columns of
// 170px, not zero. Same class of bug as #132: the shelf that fit until it grew
// a fourth thing.
//
// Broken on purpose by dropping minmax's floor to 100px, which put two columns
// on a 375px screen and 24 px of blurb per line.
await page.setViewportSize({ width: 375, height: 780 });
const lefts = await page.$$eval("#create-grid .pc-card", ns => ns.map(n => n.getBoundingClientRect().left));
eq("four cards stack to one column at 375px", new Set(lefts.map(Math.round)).size, 1);
const cardW = await page.$$eval("#create-grid .pc-card", ns => ns.map(n => Math.round(n.getBoundingClientRect().width)));
ok("and each is the full width of the column", cardW.every(w => w > 240), cardW.join(", "));
ok("with nothing running off the side of the page",
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.setViewportSize({ width: 1280, height: 800 });

await page.click(`#create-grid .pc-card:nth-of-type(${fighterIdx + 1}) .pc-begin`);
await page.waitForFunction(() => !!window.__absalom, null, { timeout: 20000 });
eq("beginning as Kessa boots the fighter", await page.evaluate(() => __absalom.content.pc.id), "fighter");
ok("no page errors on the way in", errors.length === 0, errors.slice(0, 3).join(" | "));

// The boot path is the manifest now, not a literal URL, so the page has to
// have read it and resolved a file off it. A 404 on either would have been
// caught by the error listener above, but "it booted the pack the manifest
// says it boots" is the thing that is actually under test.
eq("the page booted through the manifest", await page.evaluate(() => __absalom.entry.id), MANIFEST.default);
eq("and onto the pack that entry names", await page.evaluate(() => __absalom.pack.pack.id), MANIFEST.default);
eq("the shipping pack keeps the bare storage key it has always written to",
  await page.evaluate(() => __absalom.slot.key), "absalom-inheritance-save-v1");
eq("and the manifest lists every pack this game ships",
  await page.evaluate(() => __absalom.manifest.packs.length), MANIFEST.packs.length);

/* ========================================================================= *
 * The build, on the board                                                   *
 * ========================================================================= */
group("the heir looks like the build she is");

/** How many pixels on the canvas are exactly this colour. */
const countColour = hex => page.evaluate(h => {
  const c = document.getElementById("game");
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b) n++;
  return n;
}, hex);

const fighterPal = PACK.pcOptions.find(p => p.id === "fighter").palette;
const wizardPal = PACK.pcOptions.find(p => p.id === "wizard").palette;
const fighterTop = await countColour(fighterPal.top);
const wizardTop = await countColour(wizardPal.top);
ok("the fighter's top face is on the board", fighterTop > 20, `${fighterTop} px`);
// The one that would have failed before this phase, when both builds drew
// PALETTE.pcTop: the wizard's blue was on screen no matter who was playing.
eq("and the wizard's is not", wizardTop, 0);

/* ========================================================================= *
 * The keyboard, when it refuses                                             *
 * ========================================================================= */
group("a keyboard that answers");
const say = async key => {
  await page.evaluate(() => { document.getElementById("live").textContent = ""; });
  await page.keyboard.press(key);
  return page.textContent("#live");
};
// Kessa's list is Strike (1), Drink Healing Potion (2), Reactive Strike (3).
const kessaCmds = await page.evaluate(() => __absalom.content.commands.map(c => ({ name: c.name, kind: c.kind })));
const strikeKey = String(kessaCmds.findIndex(c => c.kind === "attack") + 1);
const reactionKey = String(kessaCmds.findIndex(c => c.kind === "reaction") + 1);
const refused = await say(strikeKey);
ok("a command blocked outside an encounter says why", /not outside an encounter/.test(refused), JSON.stringify(refused));
const reaction = await say(reactionKey);
ok("and a reaction's key says a reaction has no key", /fires on its own trigger/.test(reaction), JSON.stringify(reaction));
// The verbs that are not blocked still work off the keyboard: the potion is a
// consume, which is the one kind usable in exploration.
const potionKey = String(kessaCmds.findIndex(c => c.kind === "consume") + 1);
const potionsBefore = await page.evaluate(() => __absalom.game.potionCount());
await page.keyboard.press(potionKey);
eq("a usable command still fires off its number key", await page.evaluate(() => __absalom.game.potionCount()), potionsBefore - 1);

/* ========================================================================= *
 * The hint bar, across a stairway                                           *
 * ========================================================================= */
group("the hint bar on a transition");

// Put her at the top of the stair with the vault cleared, through the save
// slot and a reload — the same door an imported file comes through, so nothing
// here reaches past a hook the page does not already expose.
const stairSquare = await page.evaluate(() => Object.keys(__absalom.game.area.stairs)[0].split(",").map(Number));
await seedSave(`
  st.gateOpen = true;
  st.loreRead = ["bequest", "condition"];
  st.pc.x = arg[0]; st.pc.y = arg[1] + 1;
  for (const c of st.creatures) { c.dead = true; c.awake = false; }
`, stairSquare);

const loadedHint = await page.textContent("#hint");
ok("a loaded save comes back with a hint bar rather than an empty one", loadedHint.trim().length > 0, JSON.stringify(loadedHint));
eq("and it is the vault's opening line, because the start area has no hint of its own",
  loadedHint.trim(), PACK.intro.hint);

// Onto the stair with the keyboard: the cursor starts on the heir, one arrow
// press puts it on the stairway, Enter walks her onto it. No click on the
// canvas first — the keydown listener is on the window, and a click on the
// board is itself a move.
await page.keyboard.press("ArrowUp");
eq("the cursor is on the stairway", (await page.textContent("#live")).trim(), "A stairway onward.");
await page.keyboard.press("Enter");
await page.waitForFunction(() => __absalom.game.run.areaId === "undercroft", null, { timeout: 10000 });
eq("the stairway lands her in the undercroft", await page.evaluate(() => __absalom.game.run.areaId), "undercroft");
eq("and the hint bar reads the room she is standing in", (await page.textContent("#hint")).trim(), PACK.areas.undercroft.hint);
eq("with the board still out of combat", await page.evaluate(() => __absalom.game.mode), "explore");

// The per-area tuning, in the browser rather than in a unit: the renderer
// draws whatever `game.visible` holds, and the thing that shrank it is a
// number the pack wrote for this one room. `visionFeet` is 20 here and 30 in
// the vault, and the fog is the only place a player ever sees the difference.
eq("the darker room's own tuning is what the engine is reading",
  await page.evaluate(() => __absalom.game.area.tuning.visionFeet), PACK.areas.undercroft.tuning.visionFeet);
ok("and it is not the pack's",
  PACK.areas.undercroft.tuning.visionFeet !== PACK.tuning.visionFeet,
  `${PACK.areas.undercroft.tuning.visionFeet} vs ${PACK.tuning.visionFeet}`);

/* ========================================================================= *
 * The log's two new colours                                                 *
 * ========================================================================= */
group("reactions and conditions, in the log");

// Through a saved log rather than a fought one: what is under test is
// ui.js's kind-to-class table, and a Shield Block landing on any given seed is
// not something a browser run should be made to wait for. smoke.mjs is what
// proves the engine writes these kinds in the first place.
await seedSave(`
  st.log = [
    { kind: "narrative", text: "The gate's counterweights release." },
    { kind: "info", text: "You have already read this pillar." },
    { kind: "dice", text: "Strike vs AC 16", math: "d20(14) +7 = 21", deg: 2 },
    { kind: "reaction", text: "\u21ba Kessa Vane — Reactive Strike, as it leaves reach." },
    { kind: "condition", text: "Kessa Vane is off-guard." },
    { kind: "from-a-newer-build", text: "Something this page has never heard of." },
  ];
`);
const logClasses = await page.$$eval("#log .log-entry", ns => ns.map(n => n.className));
ok("the reaction line is styled as a reaction", logClasses.some(c => /\breaction\b/.test(c)), logClasses.join(" | "));
ok("the condition line is styled as a condition", logClasses.some(c => /\bcondition\b/.test(c)));
eq("a kind from a newer build renders unstyled rather than as a dice roll",
  logClasses[5], "log-entry ");
eq("and the dice roll is still a dice roll", logClasses[2], "log-entry dice");
// The colours are real, not just class names: an unstyled entry and a styled
// one have to differ on the page, or the CSS never landed.
const borders = await page.$$eval("#log .log-entry",
  ns => ns.map(n => getComputedStyle(n).borderLeftColor));
ok("the reaction stripe is a different colour from a plain line", borders[3] !== borders[1], `${borders[3]} vs ${borders[1]}`);
ok("and so is the condition stripe", borders[4] !== borders[1], `${borders[4]} vs ${borders[1]}`);
ok("and the two are not the same colour as each other", borders[3] !== borders[4], `${borders[3]} vs ${borders[4]}`);

/* ========================================================================= *
 * A second adventure, off the same page                                     *
 * ========================================================================= */
group("?pack= opens another adventure");

// The point of the manifest, end to end: the same HTML file, one query string,
// a different pack, a different save key. Nothing in js/ names either of them.
const SMALL = JSON.parse(fs.readFileSync(path.join(HERE, "..", "content", "proving-ground.json"), "utf8"));
await page.goto(URL_ + "?pack=proving-ground", { waitUntil: "load" });
await page.waitForSelector("#create-veil.open .pc-card");
eq("the proving ground's one build gets one card",
  (await page.$$("#create-grid .pc-card")).length, SMALL.pcOptions.length);
await page.click("#create-grid .pc-card:nth-of-type(1) .pc-begin");
await page.waitForFunction(() => !!window.__absalom, null, { timeout: 20000 });
eq("and the page is playing it", await page.evaluate(() => __absalom.pack.pack.id), "proving-ground");
eq("under its own storage key, so the vault run it did not touch is still there",
  await page.evaluate(() => __absalom.slot.key), "absalom-inheritance-save-v1:proving-ground");
ok("the vault's own save is untouched on disk",
  await page.evaluate(() => !!localStorage.getItem("absalom-inheritance-save-v1")));
eq("the board is the second pack's room", await page.evaluate(() => __absalom.game.area.width), SMALL.areas.yard.rows[0].length);
eq("and the tab says which adventure this is", await page.title(), `${SMALL.pack.name} — The Absalom Inheritance`);

// A ?pack= nobody ships is a thing a player can mistype, and it boots the
// adventure they came for rather than an error page. No picker to click here:
// the vault's own save is still on this origin, untouched by the run above,
// so falling back to it boots straight into that run — which is the same
// assertion twice over.
await page.goto(URL_ + "?pack=not-a-pack", { waitUntil: "load" });
// Caught rather than awaited bare: the failure this guards against is a page
// that never boots, and a bare wait turns that into a stack trace with no
// assertion attached to it. Broken on purpose by dropping main.js's `||`,
// which left `entry` undefined — this line failed, carrying the sentence the
// player would have been left staring at.
const bootedAnyway = await page.waitForFunction(() => !!window.__absalom, null, { timeout: 8000 })
  .then(() => true, () => false);
ok("an unknown ?pack= still boots the page", bootedAnyway, bootedAnyway ? "" : (await page.textContent("#hint")).trim());
eq("an unknown ?pack= falls back to the manifest's default",
  bootedAnyway ? await page.evaluate(() => __absalom.pack.pack.id) : "(never booted)", MANIFEST.default);
eq("and the vault run that was there all along comes back with it",
  bootedAnyway ? await page.evaluate(() => __absalom.game.run.areaId) : "(never booted)", "undercroft");

/* ========================================================================= *
 * The two new heirs, and the two things about them a player can see          *
 * ========================================================================= */
group("a satchel and a ward per build");

// A clean slate, so the picker comes up rather than the run that has been
// accumulating through this file. Last group in the file for exactly that
// reason: everything above needs that save to still be there.
await page.goto(URL_, { waitUntil: "load" });
await page.evaluate(() => localStorage.clear());
// The page rolls its dice on `Math.random`, not on a seed — main.js hands
// createGame the real one — so a fight here is a different fight every run,
// and the group below wants to be about the ward rather than about a d20.
// Pinned to one stream before boot, which is the only place a page's own
// Math.random can be replaced from outside it.
await page.addInitScript(() => {
  let s = 20260907;
  Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
});
await boot();
await page.waitForSelector("#create-veil.open .pc-card");
const clericIdx = PACK.pcOptions.findIndex(p => p.id === "cleric");
await page.click(`#create-grid .pc-card:nth-of-type(${clericIdx + 1}) .pc-begin`);
await page.waitForFunction(() => !!window.__absalom, null, { timeout: 20000 });
eq("beginning as Isbeth boots the cleric", await page.evaluate(() => __absalom.content.pc.id), "cleric");

// The satchel is per build now, and the inventory panel is where a player
// finds it out. Broken on purpose by dropping selectPc's per-build lookup:
// the Cleric opened her bag on a longsword and a spellbook.
await page.click("#btn-inv");
await page.waitForSelector("#inv-veil.open .inv-item");
const carried = await page.$$eval("#inv-grid .inv-item .iname", ns => ns.map(n => n.textContent));
ok("the Cleric's bag holds her own mace", carried.some(n => /Mace/.test(n)), carried.join(", "));
ok("and the reliquary font", carried.some(n => /Font/.test(n)));
ok("and no spellbook, which is the thing every build used to carry",
  !carried.some(n => /Spellbook/.test(n)), carried.join(", "));
await page.click('#inv-veil [data-close="inv-veil"]');

// The second buff, on the surface. The AC readout's ▲ and the ring the
// renderer draws were both `game.shielded` — the Shield cantrip's own
// condition — until this phase, so a Cleric who has never held a shield would
// have raised her AC on screen with nothing saying why.
//
// Broken on purpose by putting `game.shielded` back in ui.js and render.js:
// the readout dropped its ▲ and the ring pixels went to zero, with the AC
// number itself still visibly moving.
const sentinel = PACK.areas.vault.rows.findIndex(r => r.includes("e"));
await seedSave(`
  st.pc.x = arg[0]; st.pc.y = arg[1];
  st.creatures[0].awake = true;
  st.creatures[0].x = arg[0] + 1; st.creatures[0].y = arg[1];
`, [PACK.areas.vault.rows[sentinel].indexOf("e") - 1, sentinel]);
await page.waitForFunction(() => __absalom.game.mode === "combat", null, { timeout: 10000 });
// Initiative is `Math.random` on the page, not a seed, so the sentinel wins it
// about half the time and the renderer plays its turn back before the board
// takes a keypress. Waiting for the heir's own turn is the difference between
// this file passing and this file passing every other run.
// Whoever won initiative, the heir gets a turn: `ui.resume()` is what plays
// the creatures' back after a boot, and without it a save reopened on a
// sentinel's turn sits frozen forever. Reported as a failure with the board's
// own state rather than left to time out into a stack trace, because "the
// board never moved" is the thing under test here and a trace says nothing.
const hersToTake = await page.waitForFunction(
  () => __absalom.game.isPCTurn() && __absalom.game.actionsLeft > 1,
  null, { timeout: 20000 }).then(() => true, () => false);
ok("the board plays the creatures' turns back and reaches the heir's", hersToTake,
  hersToTake ? "" : JSON.stringify(await page.evaluate(() => ({
    mode: __absalom.game.mode, pcTurn: __absalom.game.isPCTurn(),
    actions: __absalom.game.actionsLeft, hp: __absalom.game.run.pc.hp,
  }))));

// The ring is stroked rgba(127,169,212,.85) and antialiased over whatever it
// crosses, so no two of its pixels are the same colour and an exact match
// counts nothing. What is countable is the *difference* the ward makes to one
// board: the same square, the same zoom, one condition apart. 94 blue-ish
// pixels are on this board either way — that number on its own says nothing,
// which is why this reads the delta and not the total (#147).
const blueish = () => page.evaluate(() => {
  const c = document.getElementById("game");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 2] > d[i] + 30 && d[i + 2] > 120 && d[i + 1] > d[i]) n++;
  }
  return n;
});
// Everything below reads a board that has to be hers to act on. Skipped
// rather than crashed when it is not: a group that dies here reports nothing
// about the ward, which is what it was written to check.
if (hersToTake) {
const acBefore = (await page.textContent("#ac-val")).trim();
const ringBefore = await blueish();
const litanyKey = String(await page.evaluate(() => __absalom.content.commands.findIndex(c => c.kind === "buff") + 1));
await page.keyboard.press(litanyKey);
const acAfter = (await page.textContent("#ac-val")).trim();
eq("with the ward on the sheet, not the disc",
  await page.evaluate(() => __absalom.game.conditionsOf("pc")[0].id), "warded");
ok("the litany moves the AC number", acAfter !== acBefore, `${acBefore} → ${acAfter}`);
// The one that catches the regression: with `game.shielded` back in ui.js the
// number above still visibly climbs from 16 to 17 and only the marker goes
// quiet, which is worse than either — a bonus the player can see in the
// arithmetic and cannot see the source of.
ok("and marks it as a bonus that is standing", acAfter.includes("▲"), JSON.stringify(acAfter));
// Two frames, because the board draws on requestAnimationFrame and the
// keypress only changes the state it draws from.
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const ringAfter = await blueish();
ok("and draws a ring around the heir who has never held a shield",
  ringAfter - ringBefore > 20, `${ringBefore} px → ${ringAfter} px`);
}

group("the whole run");
ok("no page errors, start to finish", errors.length === 0, errors.slice(0, 5).join(" | "));

console.log(`\n${pass + fail} checks, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
