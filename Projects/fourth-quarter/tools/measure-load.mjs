// measure-load.mjs — what a first visit costs, per texture tier, in numbers.
//
//   npm i --no-save playwright-core        (from this folder; node_modules/ is ignored)
//   CHROME=/path/to/chrome node tools/measure-load.mjs [--mbps 20] [--tiers 1k,2k]
//
// Boots the page in headless Chromium once per tier with `?tex=<tier>`, the
// network throttled through CDP to --mbps down (default 20, a middling home
// connection; 66 MB at 20 Mbps is 27 s on paper), and reports per tier:
//
//   bytes      every response body the page pulled, and the textures' share
//   first rAF  navigation start → the first requestAnimationFrame the page ran
//   textured   navigation start → the LoadingManager's onLoad (all 27 files)
//   meshes / triangles   a window.__fq.scene traverse after the room is built
//
// Mesh and triangle counts come from a traverse, not from hooking
// WebGLRenderer.prototype.render: r160 assigns render as an own property on
// the instance and a prototype patch never fires (WISHLIST.md, Phase 4).
//
// Exits non-zero when a tier fails to finish its textures, when any file 404s,
// or when the 1k tier is not at least 5× lighter on the wire than 2k — a
// measurement that only prints is a measurement that gets ignored (#13).

import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textureFiles } from "../js/textures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "..", "..");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const args = process.argv.slice(2);
const flag = (name, dflt) => args.includes(name) ? args[args.indexOf(name) + 1] : dflt;
const MBPS = Number(flag("--mbps", "20"));
const TIERS = flag("--tiers", "1k,2k").split(",");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".ogg": "audio/ogg" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Content-Length": fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/Projects/fourth-quarter/index.html`;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = {};
let bad = 0;

for (const tier of TIERS) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: MBPS * 125000, uploadThroughput: MBPS * 125000 });
  const bodies = {}; // url → bytes
  cdp.on("Network.loadingFinished", e => { bodies[e.requestId] = (bodies[e.requestId] || 0) + e.encodedDataLength; });
  const urls = {};
  cdp.on("Network.requestWillBeSent", e => { urls[e.requestId] = e.request.url; });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));

  // first rAF relative to navigationStart, recorded by the page itself
  await page.addInitScript(() => { requestAnimationFrame(() => { window.__firstRaf = performance.now(); }); });
  const t0 = Date.now();
  // "domcontentloaded", not "load": the load event waits for every Image the
  // TextureLoader started, which at 2k on a throttled line is the thing being measured.
  await page.goto(`${base}?tex=${tier}`, { waitUntil: "domcontentloaded", timeout: 600000 });
  const textured = await page.waitForFunction(() => window.__fq && window.__fq.textures.done, null, { timeout: 600000 })
    .then(() => page.evaluate(() => performance.now())).catch(() => null);
  await page.waitForTimeout(500); // let the last loadingFinished events land
  const st = await page.evaluate(() => window.__fq.textures);
  const firstRaf = await page.evaluate(() => window.__firstRaf ?? null);
  const counts = await page.evaluate(() => {
    let meshes = 0, tris = 0;
    window.__fq.scene.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry, idx = g.index;
      tris += Math.round((idx ? idx.count : g.attributes.position.count) / 3);
    });
    return { meshes, tris };
  });
  let total = 0, tex = 0, texFiles = 0;
  for (const [id, n] of Object.entries(bodies)) {
    total += n;
    if (/\/textures\//.test(urls[id] || "")) { tex += n; texFiles++; }
  }
  const r = { tier, total, tex, texFiles, firstRaf, textured, loaded: st.loaded, failed: st.failed, tierChosen: st.tier, ...counts, errors: errors.length, wall: Date.now() - t0 };
  results[tier] = r;
  if (st.tier !== tier) { bad++; console.error(`FAIL ${tier}: page chose ${st.tier}`); }
  if (!st.done || st.failed) { bad++; console.error(`FAIL ${tier}: textures done=${st.done} failed=${st.failed}`); }
  if (texFiles !== textureFiles().length) { bad++; console.error(`FAIL ${tier}: ${texFiles} texture responses, expected ${textureFiles().length}`); }
  if (errors.length) { bad++; console.error(`FAIL ${tier}: page errors: ${errors.join(" | ")}`); }
  await context.close();
}
await browser.close();
server.close();

const mb = n => (n / 1048576).toFixed(2) + " MB";
const s = n => n == null ? "—" : (n / 1000).toFixed(2) + " s";
console.log(`\nThrottle: ${MBPS} Mbps down, 40 ms latency. Chromium headless, swiftshader, 1280×800 at dpr 1.\n`);
console.log("| tier | textures on the wire | all responses | first rAF | fully textured | meshes | triangles |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of Object.values(results)) {
  console.log(`| ${r.tier} | ${mb(r.tex)} (${r.texFiles} files) | ${mb(r.total)} | ${s(r.firstRaf)} | ${s(r.textured)} | ${r.meshes} | ${r.tris.toLocaleString()} |`);
}
if (results["1k"] && results["2k"]) {
  const ratio = results["2k"].tex / results["1k"].tex;
  console.log(`\n1k is ${ratio.toFixed(1)}× lighter than 2k on the wire.`);
  if (ratio < 5) { bad++; console.error("FAIL: the 1k tier is not 5× lighter than 2k"); }
}
process.exit(bad ? 1 : 0);
