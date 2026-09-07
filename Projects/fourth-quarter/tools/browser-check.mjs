// browser-check.mjs — the room on screen agrees with the room on paper.
//
// smoke-layout.mjs checks layout.js under bare Node. This boots the real page
// in real Chromium and asserts what world.js and day.js actually did with the
// description: the module-level seats and colliders are the derived ones, the
// stand-points are the description's, and the two paths that rebuild the room
// on a live page — "New Game (wipe save)" and a dev-menu venue warp — leave the
// same lists, the rings on their stations, and no error on the console. Phase 1
// shipped its first draft of day.js with a key clash that only this could see:
// every test in test/ was green, and a signed lease threw.
//
//   node tools/browser-check.mjs
//
// Lives under tools/ rather than test/ on purpose: fourth-quarter-ci.yml runs
// every test/*.mjs, and this needs playwright-core and a Chromium on disk,
// neither of which the game has any use for. Run it by hand, the way Absalom's
// and Blue Hour's test/browser.mjs are run:
//
//   npm i playwright-core          (from this folder; node_modules/ is ignored)
//   CHROME=/path/to/chrome node tools/browser-check.mjs
//
// Nothing here is a frame-timing or motion assertion, so locked #53 does not
// apply; a software-rendered Chromium reaches the same lists a real GPU does.

import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../js/layout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "..", "..");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
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
const URL_ = `http://127.0.0.1:${server.address().port}/Projects/fourth-quarter/index.html`;

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
};
const group = t => console.log(`\n${t}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });

// what the page's world.js holds right now, as plain numbers
const probe = () => page.evaluate(async () => {
  const w = await import("./js/world.js");
  const v = p => ({ x: p.x, y: p.y, z: p.z });
  return {
    layout: w.currentLayout().id,
    seats: w.seats.map(s => ({ id: s.id, x: s.pos.x, z: s.pos.z, ax: s.approach.x, az: s.approach.z })),
    colliders: w.colliders.map(b => ({ min: v(b.min), max: v(b.max) })),
    points: { door: v(w.DOOR), doorOut: v(w.DOOR_OUT), passFood: v(w.PASS_FOOD), passDrink: v(w.PASS_DRINK),
      passFoodShelf: v(w.PASS_FOOD_SHELF), passDrinkShelf: v(w.PASS_DRINK_SHELF),
      stove: v(w.STOVE_STATION), tap: v(w.TAP_STATION), upgrades: v(w.UPGRADES_STATION) },
    inBounds: [[0, 0], [2.9, -5.5], [0.5, -5.5], [6, -7], [0, 5.4]].map(([x, z]) => w.inBounds(x, z)),
  };
});

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sameRoom = (label, got, venueId) => {
  const desc = L.layoutFor(venueId);
  const seats = L.seatsFor(desc), cols = L.collidersFor(desc), pts = L.standPointsFor(desc);
  ok(`${label}: layout is ${desc.id}`, got.layout === desc.id, got.layout);
  ok(`${label}: ${seats.length} seats`, got.seats.length === seats.length, `got ${got.seats.length}`);
  ok(`${label}: every seat is the derived one, in order`,
    got.seats.every((s, i) => s.id === seats[i].id && near(s.x, seats[i].x) && near(s.z, seats[i].z) && near(s.ax, seats[i].ax) && near(s.az, seats[i].az)));
  ok(`${label}: ${cols.length} colliders`, got.colliders.length === cols.length, `got ${got.colliders.length}`);
  ok(`${label}: every collider is the derived box, in order`,
    got.colliders.every((b, i) => ["x", "y", "z"].every(a => near(b.min[a], cols[i].min[a]) && near(b.max[a], cols[i].max[a]))));
  ok(`${label}: stand-points are the description's`,
    Object.entries(got.points).every(([k, p]) => near(p.x, pts[k].x) && near(p.y, pts[k].y) && near(p.z, pts[k].z)));
  ok(`${label}: inBounds answers room / doorway / wall / kitchen / south wall`,
    got.inBounds.join() === [true, true, false, true, false].join(), got.inBounds.join());
};

group("boot");
await page.goto(URL_, { waitUntil: "load" });
await page.waitForTimeout(2500);
ok("no page errors on boot", errors.length === 0, errors.join(" | "));
sameRoom("boot", await probe(), "cornerTap");

group("New Game (wipe save) → rebuildVenue()");
await page.click("text=New Game (wipe save)");
await page.waitForTimeout(600);
ok("no page errors after the wipe", errors.length === 0, errors.join(" | "));
sameRoom("wipe", await probe(), "cornerTap");

group("dev warp to the flagship → rebuildVenue()");
await page.click("text=Take the Floor");
await page.waitForTimeout(300);
await page.keyboard.press("Backquote");
await page.waitForTimeout(400);
await page.click("[data-warp=flagship]", { timeout: 5000 });
await page.waitForTimeout(600);
ok("no page errors after the warp", errors.length === 0, errors.join(" | "));
const warped = await probe();
sameRoom("warp", warped, "flagship");
ok("seats did not stack across three builds", warped.seats.length === L.seatsFor(L.layoutFor("flagship")).length);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
