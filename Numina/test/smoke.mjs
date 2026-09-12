// Smoke checks for the built Numina site. Run from anywhere:
//   node Numina/test/smoke.mjs
// Exits non-zero on any failure (repo convention).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { autolink, buildVocabulary, mainRegion } from "../tools/autolink.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/Numina/";
// Must match tools/clean.mjs's GENERATED list.
const GENERATED = ["index.html", "sitemap.xml", "search", "new-to-numina", "lore", "mechanics", "css", "js", "fonts", "assets", "pagefind"];
// greyversusblue.com is our own deployed origin: canonical/OG URLs are absolute
// by spec, so they show up as offsite hrefs here.
const OFFSITE_ALLOWED = ["www.numinalarp.com", "numina.lorelogic.info", "discord.gg", "pagefind.app", "greyversusblue.com"];

let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}`); }
}

function walk(dir, matcher, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".cache") continue;
      walk(p, matcher, acc);
    } else if (matcher(p)) acc.push(p);
  }
  return acc;
}

// 1. Every source page has non-empty built output.
console.log("# built pages");
const passthrough = ["_includes", "_data", "css", "js", "fonts", "assets"];
const sourcePages = walk(join(root, "src"), (p) => /\.(md|njk)$/.test(p)).filter(
  (p) => !passthrough.some((d) => relative(join(root, "src"), p).split(sep)[0] === d)
);
for (const src of sourcePages) {
  const rel = relative(join(root, "src"), src).replace(/\\/g, "/").replace(/\.(md|njk)$/, "");
  // A template with an explicit permalink (sitemap.xml) lands where it says,
  // not at <rel>/index.html.
  const permalink = readFileSync(src, "utf8").match(/^permalink:\s*(\S+)\s*$/m);
  const outPath = permalink
    ? join(root, permalink[1].replace(/^\//, ""))
    : rel === "index" || rel.endsWith("/index")
      ? join(root, rel.replace(/index$/, ""), "index.html")
      : join(root, rel, "index.html");
  ok(existsSync(outPath) && statSync(outPath).size > 0, `built: ${rel}`);
}

// 2. Internal links in built HTML resolve; 3. offsite hosts limited to allowlist.
console.log("# links");
const builtHtml = GENERATED.filter((g) => existsSync(join(root, g))).flatMap((g) => {
  const p = join(root, g);
  return statSync(p).isDirectory() ? walk(p, (f) => f.endsWith(".html")) : g === "index.html" ? [p] : [];
});
let badLinks = [];
let badHosts = new Set();
let badFragments = [];
for (const file of builtHtml) {
  const html = readFileSync(file, "utf8");
  // Same-page fragments (TOC entries, heading permalinks) are skipped by the
  // path check below — the pattern needs at least one character before "#" —
  // so they are validated here against the ids the page actually emits.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(m[1])) badFragments.push(`${relative(root, file)} → #${m[1]}`);
  }
  for (const m of html.matchAll(/(?:href|src)="([^"#?]+)[^"]*"/g)) {
    const url = m[1];
    const offsite = url.match(/^https?:\/\/([^/]+)/);
    if (offsite) {
      if (!OFFSITE_ALLOWED.includes(offsite[1])) badHosts.add(offsite[1]);
      continue;
    }
    if (url.startsWith("mailto:") || url.startsWith("data:")) continue;
    let target;
    if (url.startsWith(PREFIX)) target = join(root, url.slice(PREFIX.length));
    else if (url.startsWith("/")) { badLinks.push(`${relative(root, file)} → ${url} (unprefixed)`); continue; }
    else target = join(dirname(file), url);
    const candidates = [target, join(target, "index.html")];
    if (!candidates.some((c) => existsSync(c))) badLinks.push(`${relative(root, file)} → ${url}`);
  }
}
ok(badLinks.length === 0, `all internal links resolve${badLinks.length ? `:\n      ${badLinks.slice(0, 10).join("\n      ")}` : ""}`);
ok(badHosts.size === 0, `no unexpected offsite hosts in HTML${badHosts.size ? `: ${[...badHosts].join(", ")}` : ""}`);
ok(badFragments.length === 0, `all same-page #fragments resolve to an id${badFragments.length ? `:\n      ${badFragments.slice(0, 10).join("\n      ")}` : ""}`);

// 2b. Cross-links: the autolinker rewrites 39 chapters nobody reads the diff of,
// so what holds it honest is here. A page linking itself is the failure its
// self-link guard exists to prevent; a fragment that resolves nowhere is the
// failure a term slugged from the wrong text produces (the glossary's headings
// are slugged from the typographer's output — "fortune%E2%80%99s-bend", not
// "fortune's-bend"); and running the linker over its own output has to be a
// no-op or every rebuild adds another link to the same page.
console.log("# cross-links");
const urlFor = (file) => PREFIX + relative(root, file).replace(/\\/g, "/").replace(/index\.html$/, "");
const idsByUrl = new Map();
const mains = new Map();
for (const file of builtHtml) {
  const html = readFileSync(file, "utf8");
  const region = mainRegion(html);
  idsByUrl.set(urlFor(file), new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  if (region) mains.set(file, html.slice(region.start, region.end));
}

const selfLinks = [];
const danglingFragments = [];
for (const [file, main] of mains) {
  const self = urlFor(file);
  for (const m of main.matchAll(/href="([^"]+)"/g)) {
    const [target, fragment] = m[1].split("#");
    // Any absolute link back to this page, fragment or not: same-page anchors
    // are written as bare "#id" (the TOC and the heading permalinks), so an
    // absolute one is the autolinker having pointed a term at its own page.
    if (target === self) selfLinks.push(`${relative(root, file)} → ${m[1]}`);
    if (!fragment || !target || !target.startsWith(PREFIX)) continue;
    const ids = idsByUrl.get(target.endsWith("/") ? target : `${target}/`);
    if (ids && !ids.has(fragment)) danglingFragments.push(`${relative(root, file)} → ${m[1]}`);
  }
}
ok(selfLinks.length === 0, `no page body links to itself${selfLinks.length ? `:\n      ${selfLinks.slice(0, 10).join("\n      ")}` : ""}`);
ok(
  danglingFragments.length === 0,
  `every cross-page #fragment resolves to an id on its target${danglingFragments.length ? `:\n      ${danglingFragments.slice(0, 10).join("\n      ")}` : ""}`
);

const vocabulary = buildVocabulary(root);
const notIdempotent = [];
for (const [file, main] of mains) {
  if (/data-autolink="off"/.test(readFileSync(file, "utf8"))) continue;
  const again = autolink(main, { pageUrl: urlFor(file).slice(PREFIX.length - 1), ...vocabulary, prefix: PREFIX });
  if (again.linked.length > 0) notIdempotent.push(`${relative(root, file)}: ${again.linked.map((l) => l.term).join(", ")}`);
}
ok(
  notIdempotent.length === 0,
  `autolinker is idempotent over the built HTML${notIdempotent.length ? `:\n      ${notIdempotent.slice(0, 10).join("\n      ")}` : ` (${mains.size} pages)`}`
);

const autolinkData = JSON.parse(readFileSync(join(root, "src", "_data", "autolink.json"), "utf8"));
const unexplained = autolinkData.exclude.filter((e) => !e.term || !(e.why ?? "").trim());
ok(
  unexplained.length === 0,
  `every autolink exclusion names the collision it avoids (${autolinkData.exclude.length})${unexplained.length ? `: ${unexplained.map((e) => e.term).join(", ")}` : ""}`
);
const stillLinked = autolinkData.exclude.filter((e) => vocabulary.terms.some((t) => t.term === e.term));
ok(stillLinked.length === 0, `no excluded term is in the link list${stillLinked.length ? `: ${stillLinked.map((e) => e.term).join(", ")}` : ""}`);
// An exclusion that changes nothing is a claim nobody can check. Every entry has
// to be a term the linker would otherwise have used: "Garb" would not (two
// records claim it, so the ambiguity rule drops it), and listing it here would
// read as the reason it is not linked when it is not.
const openVocabulary = buildVocabulary(root, { exclude: [] });
const deadWeight = autolinkData.exclude.filter((e) => !openVocabulary.terms.some((t) => t.term === e.term));
ok(
  deadWeight.length === 0,
  `every autolink exclusion removes a term that would otherwise be linked${deadWeight.length ? ` (these are dropped by another rule already, delete them): ${deadWeight.map((e) => e.term).join(", ")}` : ""}`
);

const cssJs = walk(join(root, "css"), () => true).concat(walk(join(root, "js"), () => true));
const offsiteCssJs = cssJs.filter((f) => /https?:\/\//.test(readFileSync(f, "utf8")));
ok(offsiteCssJs.length === 0, "no offsite URLs in built css/js");

// 4. Pagefind bundle present and fresh.
console.log("# search");
const pf = join(root, "pagefind");
ok(existsSync(join(pf, "pagefind.js")), "pagefind.js exists");
ok(existsSync(join(pf, "pagefind-ui.js")), "pagefind-ui.js exists");
ok(walk(pf, (p) => /wasm.*\.pagefind$/.test(p)).length > 0, "pagefind wasm exists");
const fragments = existsSync(join(pf, "fragment")) ? readdirSync(join(pf, "fragment")).length : 0;
const indexedPages = builtHtml.filter((f) => readFileSync(f, "utf8").includes("data-pagefind-body")).length;
ok(fragments >= indexedPages, `index fresh (${fragments} fragments ≥ ${indexedPages} indexed pages)`);
ok(readFileSync(join(root, "search", "index.html"), "utf8").includes("pagefind-ui.js"), "search page references bundle");

// 5. Map regions, timeline hrefs, fonts.
console.log("# features");
const nationsIndex = readFileSync(join(root, "lore", "nations", "index.html"), "utf8");
const nationSlugs = readdirSync(join(root, "src", "lore", "nations"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(".md", ""));
for (const slug of nationSlugs) {
  ok(nationsIndex.includes(`${PREFIX}lore/nations/${slug}/`), `map/cards link nation: ${slug}`);
}
const timeline = JSON.parse(readFileSync(join(root, "src", "_data", "timeline.json"), "utf8"));
const badTimeline = timeline.filter((ev) => ev.href && !existsSync(join(root, ev.href.slice(1), "index.html")));
ok(badTimeline.length === 0, `timeline hrefs resolve (${timeline.length} events)`);
const mainCss = readFileSync(join(root, "css", "main.css"), "utf8");
const fontRefs = [...mainCss.matchAll(/url\("\.\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
ok(fontRefs.length >= 5 && fontRefs.every((f) => existsSync(join(root, "fonts", f))), `all ${fontRefs.length} font files present`);

// 6. Sharing/SEO metadata: every page carries canonical + OG, and the sitemap
// lists exactly the pages that were built.
console.log("# metadata");
const ORIGIN = "https://greyversusblue.com";
const missingMeta = builtHtml.filter((f) => {
  const html = readFileSync(f, "utf8");
  return !/<link rel="canonical" href="https:\/\//.test(html) ||
    !/<meta property="og:title"/.test(html) ||
    !/<meta property="og:image" content="https:\/\//.test(html) ||
    !/<meta name="twitter:card"/.test(html);
});
ok(missingMeta.length === 0, `canonical + OG + twitter card on all ${builtHtml.length} pages${missingMeta.length ? `: ${missingMeta.slice(0, 3).map((f) => relative(root, f)).join(", ")}` : ""}`);
ok(existsSync(join(root, "assets", "favicon.svg")), "favicon.svg published");
ok(existsSync(join(root, "assets", "social-card.png")), "og:image social card published");

const sitemapPath = join(root, "sitemap.xml");
ok(existsSync(sitemapPath), "sitemap.xml generated");
if (existsSync(sitemapPath)) {
  const locs = [...readFileSync(sitemapPath, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const pageUrls = new Set(
    builtHtml.map((f) => ORIGIN + PREFIX + relative(root, f).replace(/\\/g, "/").replace(/index\.html$/, ""))
  );
  const missing = [...pageUrls].filter((u) => !locs.includes(u));
  const extra = locs.filter((u) => !pageUrls.has(u));
  ok(missing.length === 0, `sitemap lists every built page${missing.length ? `, missing: ${missing.slice(0, 5).join(", ")}` : ` (${locs.length})`}`);
  ok(extra.length === 0, `sitemap has no dangling entries${extra.length ? `: ${extra.slice(0, 5).join(", ")}` : ""}`);
  const robots = join(root, "..", "robots.txt");
  ok(existsSync(robots) && readFileSync(robots, "utf8").includes(`${ORIGIN}${PREFIX}sitemap.xml`), "repo-root robots.txt points at the sitemap");
}

// 7. Navigation drift: _data/nav.json duplicates page order and titles by hand,
// so a page added under src/lore or src/mechanics without a nav.json entry
// builds and is linkable but never appears in any sidebar.
console.log("# navigation");
const nav = JSON.parse(readFileSync(join(root, "src", "_data", "nav.json"), "utf8"));
const navUrls = new Set();
for (const section of nav.sections) {
  navUrls.add(section.url);
  for (const pg of section.pages) {
    navUrls.add(pg.url);
    for (const child of pg.children ?? []) navUrls.add(child.url);
  }
}
// Nation pages are exempt: the sidebar generates them from the nations
// collection, so they cannot drift.
const contentUrls = builtHtml
  .filter((f) => /^(lore|mechanics|new-to-numina)[\\/]/.test(relative(root, f)))
  .map((f) => "/" + relative(root, f).replace(/\\/g, "/").replace(/index\.html$/, ""))
  .filter((u) => !/^\/lore\/nations\/./.test(u));
const orphaned = contentUrls.filter((u) => !navUrls.has(u));
ok(
  orphaned.length === 0,
  `every built content page is in nav.json (${contentUrls.length})${orphaned.length ? `, missing: ${orphaned.join(", ")}` : ""}`
);

// 7. Output hygiene: clean manifest covers every generated top-level entry.
console.log("# hygiene");
const expectedTopLevel = new Set([
  ...GENERATED, "src", "test", "tools", "source-material", "node_modules",
  "README.md", "CONTENT-GUIDE.md", "WISHLIST.md", "package.json", "package-lock.json",
  ".gitignore", "eleventy.config.mjs", ".cache", "discord-logs",
]);
const unexpected = readdirSync(root).filter((e) => !expectedTopLevel.has(e));
ok(unexpected.length === 0, `no unexpected top-level entries${unexpected.length ? `: ${unexpected.join(", ")}` : ""}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
