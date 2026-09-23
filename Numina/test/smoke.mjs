// Smoke checks for the built Numina site. Run from anywhere:
//   node Numina/test/smoke.mjs
// Exits non-zero on any failure (repo convention).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { autolink, buildVocabulary, mainRegion } from "../tools/autolink.mjs";
import { hashedFiles, precacheUrls, renderServiceWorker, versionFor } from "../tools/service-worker.mjs";
import { eventAnchor } from "../tools/see-also.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/Numina/";
// Must match tools/clean.mjs's GENERATED list.
const GENERATED = ["index.html", "sitemap.xml", "sw.js", "search", "new-to-numina", "lore", "mechanics", "css", "js", "fonts", "assets", "pagefind"];
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
ok(existsSync(join(pf, "pagefind-component-ui.js")), "pagefind-component-ui.js exists");
ok(existsSync(join(pf, "pagefind-component-ui.css")), "pagefind-component-ui.css exists");
ok(walk(pf, (p) => /wasm.*\.pagefind$/.test(p)).length > 0, "pagefind wasm exists");
const fragments = existsSync(join(pf, "fragment")) ? readdirSync(join(pf, "fragment")).length : 0;
const indexedPages = builtHtml.filter((f) => readFileSync(f, "utf8").includes("data-pagefind-body")).length;
ok(fragments >= indexedPages, `index fresh (${fragments} fragments ≥ ${indexedPages} indexed pages)`);

// 4a. Phase 8's Component UI, and the four facts about it a diff does not show.
//
// The search page is the Component UI's four custom elements now, not a
// `new PagefindUI({…})` call. bundle-path is checked for the path prefix
// because getting it wrong is silent: the elements render, the input takes
// typing, and every search comes back empty because the index 404'd.
const searchHtml = readFileSync(join(root, "search", "index.html"), "utf8");
for (const el of ["pagefind-config", "pagefind-input", "pagefind-summary", "pagefind-results"]) {
  ok(searchHtml.includes(`<${el}`), `the search page carries <${el}>`);
}
ok(searchHtml.includes("pagefind-component-ui.js"), "the search page loads the Component UI bundle");
ok(!searchHtml.includes("pagefind-ui.js"), "and not the Default UI it replaced");
ok(
  searchHtml.includes(`bundle-path="${PREFIX}pagefind/"`),
  `the search page's bundle-path carries the path prefix (${PREFIX}pagefind/)`
);
ok(searchHtml.includes("<noscript>"), "the search page keeps its no-JS fallback");

// The header's two search controls. The form is the no-JS path and has to keep
// its action, its q and — new in Phase 8, and the one real finding
// html-validate's wcag/h32 made before that rule was turned off — a submit
// button, because "press Enter" is not a control a pointer can find. The button
// beside it is the modal's, ships hidden, and carries the bundle path because
// js/search-modal.js is on pages four levels deep and cannot write a relative
// one.
const headerPages = builtHtml.filter((f) => readFileSync(f, "utf8").includes('class="header-search"'));
ok(headerPages.length === builtHtml.length, `the header search form is on all ${builtHtml.length} pages (${headerPages.length})`);
const headerGaps = [];
for (const file of builtHtml) {
  const html = readFileSync(file, "utf8");
  const form = html.slice(html.indexOf('<form class="header-search"'), html.indexOf("</form>"));
  if (!/action="[^"]*\/search\/"/.test(form)) headerGaps.push(`${relative(root, file)}: form does not GET /search/`);
  if (!form.includes('name="q"')) headerGaps.push(`${relative(root, file)}: form has no q`);
  if (!/<button type="submit"/.test(form)) headerGaps.push(`${relative(root, file)}: form has no submit button`);
  if (!html.includes(`data-pagefind="${PREFIX}pagefind/"`)) headerGaps.push(`${relative(root, file)}: trigger has no bundle path`);
  if (!/class="search-trigger"[^>]*hidden/.test(html)) headerGaps.push(`${relative(root, file)}: trigger does not ship hidden`);
}
ok(headerGaps.length === 0, `every page's header carries a submitting form and a hidden modal trigger${headerGaps.length ? `: ${headerGaps.slice(0, 3).join("; ")}` : ""}`);
ok(existsSync(join(root, "js", "search-modal.js")), "js/search-modal.js is in the build");
ok(
  builtHtml.every((f) => readFileSync(f, "utf8").includes("/js/search-modal.js")),
  "and every page loads it"
);

// 4b. The "come play" block (Phase 5). Three things matter about it and none
// of them is visible in a diff of the partial: that it is on the three pages a
// stranger actually lands on, that it carries all three official links off
// site.json rather than a hand-typed copy, and that it carries no fact that
// moves. The last is the one with a two-year precedent behind it — "$100 per
// event" sat on Quick Reference because somebody lifted it out of a 2024
// Discord message — so a price, a date or a month in this block fails here.
console.log("# come play");
const site = JSON.parse(readFileSync(join(root, "src", "_data", "site.json"), "utf8"));
const COME_PLAY_PAGES = ["index.html", join("new-to-numina", "index.html"), join("mechanics", "new-players", "index.html")];
const comePlayFound = builtHtml.filter((f) => readFileSync(f, "utf8").includes('class="come-play"'));
ok(
  comePlayFound.length === COME_PLAY_PAGES.length &&
    COME_PLAY_PAGES.every((p) => comePlayFound.some((f) => relative(root, f) === p)),
  `the come-play block is on exactly the three entry pages (${comePlayFound.map((f) => relative(root, f)).join(", ") || "none"})`
);
const comePlayGaps = [];
for (const file of comePlayFound) {
  const html = readFileSync(file, "utf8");
  const block = html.slice(html.indexOf('<section class="come-play">'), html.indexOf("</section>", html.indexOf('<section class="come-play">')));
  for (const [key, url] of Object.entries(site.official)) {
    if (key.endsWith("Note")) continue;
    if (!block.includes(`href="${url}"`)) comePlayGaps.push(`${relative(root, file)}: no link to site.official.${key}`);
  }
  // A number with a currency mark, or a month name: the two shapes the rule is about.
  const volatile = block.match(/[$£€]\s?\d|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/);
  if (volatile) comePlayGaps.push(`${relative(root, file)}: the block names something that moves (${volatile[0]})`);
}
ok(comePlayGaps.length === 0, `every come-play block carries all three official links and no date or price${comePlayGaps.length ? `:\n      ${comePlayGaps.join("\n      ")}` : ""}`);
// The registration host is in site.json now, and site.json is what the block
// renders. A second copy typed into the partial would pass the check above and
// silently stop tracking a move of the host, so the partial holds no URL.
const partial = readFileSync(join(root, "src", "_includes", "partials", "come-play.njk"), "utf8");
ok(!/https?:\/\//.test(partial), "the come-play partial hardcodes no URL of its own");

// 4c. The four landing pages are indexed (Phase 5). The search page is not, and
// that is deliberate: indexing the page that shows results puts every result
// snippet in the index.
const unindexed = builtHtml.filter((f) => !readFileSync(f, "utf8").includes("data-pagefind-body")).map((f) => relative(root, f));
ok(
  unindexed.length === 1 && unindexed[0] === join("search", "index.html"),
  `every built page but the search page is in the index (${builtHtml.length - unindexed.length} indexed)${unindexed.length === 1 && unindexed[0] === join("search", "index.html") ? "" : `; not indexed: ${unindexed.join(", ")}`}`
);

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
// A "Read more" is a page and, since Phase 6, sometimes a fragment on one: the
// Vargoth Empire's entry points at the glossary term rather than a nation page
// it has none of. Both halves are checked here. The cross-link section above
// also catches a bad fragment today, but only because the one page that renders
// the timeline is a page it scans; an event whose href is never rendered into
// any <main> would reach production on that check alone.
const badTimeline = [];
for (const ev of timeline) {
  if (!ev.href) continue;
  const [path, fragment] = ev.href.split("#");
  const page = join(root, path.slice(1), "index.html");
  if (!existsSync(page)) { badTimeline.push(`${ev.title} → ${ev.href}`); continue; }
  if (!fragment) continue;
  const ids = new Set([...readFileSync(page, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  if (!ids.has(decodeURIComponent(fragment)) && !ids.has(fragment)) badTimeline.push(`${ev.title} → ${ev.href}`);
}
ok(badTimeline.length === 0, `timeline hrefs resolve (${timeline.length} events)${badTimeline.length ? `:\n      ${badTimeline.join("\n      ")}` : ""}`);
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

// 7. Navigation drift. _data/nav.json duplicates page order and titles that
// frontmatter mostly already carries, and Phase 8 asked whether to derive the
// sidebar from collections and delete the file, or keep it and write down that
// the duplication is deliberate. Kept, and #329 records why. Four things in it
// are in no page's frontmatter: the position of the three nav entries whose
// templates carry no `order` (Character Builder, Print Packet, All Skills), the
// two-level nesting under Skills, the one nav title that is deliberately not the
// page title ("Skills" for a page whose h1 reads "Adventurer Skills"), and the
// `nations: true` flag that splices the nations collection into that section.
// Deriving the sidebar means adding all four back as frontmatter to produce the
// same file under another name — and the file now has three readers rather than
// one, because /mechanics/packet/ generates its 49-chapter list from it.
//
// So the guard stays, and it runs both ways now. Forwards: a page added under
// src/lore or src/mechanics without a nav.json entry builds and is linkable but
// appears in no sidebar. Backwards: an entry pointing at a page that is not
// built is a dead sidebar link on every page of its section, and a chapter the
// packet offers and cannot fetch.
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
const builtUrls = new Set(contentUrls);
const dead = [...navUrls].filter((u) => !builtUrls.has(u));
ok(
  dead.length === 0,
  `every nav.json entry is a built page (${navUrls.size})${dead.length ? `, dead: ${dead.join(", ")}` : ""}`
);

// 8. The offline kit (Phase 7). sw.js is generated, so the failure worth
// catching is not that it is wrong but that it is stale or machine-dependent:
// a manifest missing a page added last week is a page missing in a field, and
// a version that moves between two builds of the same source turns CI's
// rebuild check red on a file nobody edited.
console.log("# offline kit");
const swPath = join(root, "sw.js");
ok(existsSync(swPath), "sw.js generated");
const sw = existsSync(swPath) ? readFileSync(swPath, "utf8") : "";
const manifest = [...sw.matchAll(/^  "([^"]+)",$/gm)].map((m) => m[1]);
const swVersion = sw.match(/^const VERSION = "([0-9a-f]+)";$/m)?.[1] ?? "";

// The generator, run again over the same output, has to produce the file that
// is committed byte for byte. This is the determinism check and it is also the
// "did you rebuild?" check for sw.js specifically, which CI would otherwise
// only catch as an unexplained diff.
ok(
  sw === renderServiceWorker(versionFor(root), precacheUrls(root)),
  `the committed sw.js is what tools/service-worker.mjs writes for this build (${swVersion || "no version"})`
);
// Sorted, checked here rather than trusted from the generator: two builds that
// walk the tree in a different order have to produce the same list.
ok(
  manifest.length > 0 && manifest.every((u, i) => i === 0 || manifest[i - 1].localeCompare(u) < 0),
  `the precache manifest is sorted and has no duplicates (${manifest.length} files)`
);
// Completeness, derived from the pages this file already found rather than
// from the generator's own walk: the two agree or one of them is wrong.
const manifestSet = new Set(manifest);
const uncached = builtHtml.map(urlFor).filter((u) => !manifestSet.has(u));
ok(
  uncached.length === 0,
  `every built page is in the precache manifest (${builtHtml.length})${uncached.length ? `, missing: ${uncached.slice(0, 5).join(", ")}` : ""}`
);
const wantedAssets = [`${PREFIX}css/main.css`, `${PREFIX}css/print.css`, ...fontRefs.map((f) => `${PREFIX}fonts/${f}`)];
const missingAssets = wantedAssets.filter((u) => !manifestSet.has(u));
ok(
  missingAssets.length === 0,
  `both stylesheets and all ${fontRefs.length} fonts are in the manifest${missingAssets.length ? `, missing: ${missingAssets.join(", ")}` : ""}`
);
ok(
  manifest.some((u) => u.startsWith(`${PREFIX}pagefind/`)),
  "Pagefind's fixed-name files are in the manifest"
);
// And they are the ones the pages actually load. Phase 8 changed which UI the
// site loads, and the kit's PAGEFIND_FILES names those files by hand because
// everything else in that folder is named after a content hash. The two lists
// moving apart is silent online and fatal in a field: the browser has the page,
// the page asks for a bundle that was never put on the device, and search is
// the one thing that does not work. So every pagefind/ file referenced by a
// built page, or injected by js/search-modal.js, has to be in the manifest.
const pagefindRefs = new Set();
for (const file of [...builtHtml, join(root, "js", "search-modal.js")]) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/pagefind\/(pagefind[\w.-]+\.(?:js|css|json))/g)) {
    pagefindRefs.add(`${PREFIX}pagefind/${m[1]}`);
  }
  // search-modal.js builds its URLs as base + "pagefind-component-ui.css".
  for (const m of text.matchAll(/"(pagefind-component-ui\.(?:js|css))"/g)) {
    pagefindRefs.add(`${PREFIX}pagefind/${m[1]}`);
  }
}
const unkitted = [...pagefindRefs].filter((u) => !manifestSet.has(u)).sort();
// Two is the floor because markup and search-modal.js between them name exactly
// the Component UI's script and stylesheet. pagefind.js, pagefind-entry.json and
// the two wasm builds are fetched by that bundle at runtime rather than written
// into any page, which is why PAGEFIND_FILES names them and the assertion above
// is what holds them.
ok(
  pagefindRefs.size >= 2 && unkitted.length === 0,
  `every Pagefind file a page loads is in the kit (${pagefindRefs.size} referenced)${unkitted.length ? `, missing: ${unkitted.join(", ")}` : ""}`
);
// And nothing under pagefind/ decides the version. Its index chunks are named
// after content hashes over a sharding that is not stable across machines —
// numina-ci.yml excludes the folder from the rebuild check for that reason — so
// a version hashed over any of it would differ between two builds of the same
// source and every PR would be told to rebuild.
const hashedPagefind = hashedFiles(root).filter((e) => e.url.startsWith(`${PREFIX}pagefind/`));
ok(
  hashedPagefind.length === 0,
  `no file under pagefind/ contributes to the version${hashedPagefind.length ? `: ${hashedPagefind.map((e) => e.url).join(", ")}` : ` (${hashedFiles(root).length} files hashed)`}`
);
// The worker updates only when the browser fetches a new sw.js. That used to
// rest on a no-cache header in firebase.json; the site left Firebase and the
// host sets no per-file headers now, so it rests on the registration instead.
// The default `updateViaCache: 'imports'` already skips the HTTP cache for
// sw.js itself; `'all'` would let a cached copy hide every update.
const offlineJs = readFileSync(join(root, "js", "offline.js"), "utf8");
ok(
  !/updateViaCache\s*:\s*["']all["']/.test(offlineJs),
  "offline.js does not register sw.js with updateViaCache 'all', which is the whole update path"
);
// The banner and the registration ship on every page, not just the one that
// talks about them.
const noOffline = builtHtml.filter((f) => !readFileSync(f, "utf8").includes(`src="${PREFIX}js/offline.js"`));
ok(noOffline.length === 0, `offline.js is on all ${builtHtml.length} pages${noOffline.length ? `: ${noOffline.slice(0, 3).map((f) => relative(root, f)).join(", ")}` : ""}`);

// 8b. The packet page (Phase 7). Its chapter list is generated from nav.json,
// so the drift worth catching is a prebuilt packet naming a chapter the form
// does not offer, or a URL that is not a page.
console.log("# print packet");
const packetHtml = readFileSync(join(root, "mechanics", "packet", "index.html"), "utf8");
const offered = [...packetHtml.matchAll(/<input type="checkbox" value="([^"]+)" data-packet-chapter/g)].map((m) => m[1]);
ok(offered.length >= 40, `the packet page offers the site's chapters (${offered.length})`);
const badOffered = offered.filter((u) => !existsSync(join(root, u.slice(PREFIX.length), "index.html")));
ok(badOffered.length === 0, `every chapter the packet offers is a built page${badOffered.length ? `: ${badOffered.slice(0, 5).join(", ")}` : ""}`);
// Neither the builder nor this page itself: one is an application and the
// other is the form doing the asking.
const shouldNotOffer = [`${PREFIX}mechanics/character-builder/`, `${PREFIX}mechanics/packet/`].filter((u) => offered.includes(u));
ok(shouldNotOffer.length === 0, `the packet does not offer itself or the builder${shouldNotOffer.length ? `: ${shouldNotOffer.join(", ")}` : ""}`);
const packetData = JSON.parse(readFileSync(join(root, "src", "_data", "packets.json"), "utf8")).packets;
const offeredSet = new Set(offered);
const badPrebuilt = [];
for (const packet of packetData) {
  for (const url of packet.chapters ?? []) {
    if (!offeredSet.has(PREFIX.replace(/\/$/, "") + url)) badPrebuilt.push(`${packet.id} → ${url}`);
  }
  if (packet.page && !existsSync(join(root, packet.page.replace(/^\//, ""), "index.html"))) {
    badPrebuilt.push(`${packet.id} → ${packet.page}`);
  }
}
ok(
  packetData.length === 3 && badPrebuilt.length === 0,
  `all ${packetData.length} prebuilt packets name chapters the page offers${badPrebuilt.length ? `:\n      ${badPrebuilt.join("\n      ")}` : ""}`
);
// The Combat Card is the Combat Quick Reference page as it already prints, so
// the packet that names it has to point at a page that is still cardsheet.
const cardPacket = packetData.find((p) => p.page);
const cardSource = cardPacket ? readFileSync(join(root, cardPacket.page.replace(/^\//, ""), "index.html"), "utf8") : "";
ok(/<body class="[^"]*cardsheet/.test(cardSource), `the Combat Card packet points at a page that still prints as a card sheet`);
// print.css's side: the packet prints the document and not the form that built
// it, and the page counter is on a named page so the six chapters that already
// print one at a time — the card sheet above especially — are untouched by it.
const printCss = readFileSync(join(root, "css", "print.css"), "utf8");
ok(/\.packet-page > \*:not\(\.packet-doc\) \{[^}]*display:\s*none/.test(printCss), "print.css prints the packet document and hides the rest of the page");
ok(/@page packet \{[\s\S]*?@bottom-center \{[\s\S]*?counter\(page\)/.test(printCss), "print.css numbers the packet's pages");
ok(/\.packet-doc \{ page: packet; \}/.test(printCss), "the page counter is scoped to the packet by a named page, not applied to every printable chapter");

// 8. The accessibility pass (Phase 4). axe-core covers what a machine can see
// in a rendered page and is the check that would catch a contrast token drifting
// back or a heading level going missing, but it runs in test/a11y with a browser
// and a lockfile of its own. These are the facts of the markup that axe has no
// rule for — the ones section B was made of — and they cost no browser.
console.log("# accessibility");
const count = (html, re) => (html.match(re) ?? []).length;
const mainOf = (html) => {
  const region = mainRegion(html);
  return region ? html.slice(region.start, region.end) : null;
};

// The skip link is the first focusable thing on the page, and it has somewhere
// to land. Both halves matter: an href pointing at an id nothing carries is a
// link that does nothing, and it is the half a template edit loses.
const badSkip = [];
for (const file of builtHtml) {
  const html = readFileSync(file, "utf8");
  const body = html.slice(html.indexOf("<body"));
  const firstAnchor = body.match(/<a\b[^>]*>/);
  const where = relative(root, file);
  if (!firstAnchor || !/class="skip-link"/.test(firstAnchor[0])) badSkip.push(`${where}: first <a> is not the skip link`);
  else if (!/href="#main"/.test(firstAnchor[0])) badSkip.push(`${where}: skip link does not target #main`);
  else if (!/<main\b[^>]*\sid="main"/.test(html)) badSkip.push(`${where}: no id="main" for it to land on`);
  else if (!/<main\b[^>]*\stabindex="-1"/.test(html)) badSkip.push(`${where}: <main> has no tabindex="-1", so the jump moves the scroll and not the focus`);
}
ok(badSkip.length === 0, `every page opens with a skip link that lands on its <main> (${builtHtml.length})${badSkip.length ? `:\n      ${badSkip.slice(0, 5).join("\n      ")}` : ""}`);

// The map is role="group", not role="img". role="img" flattens the subtree and
// the subtree is 16 nation links, which on the home page are the only ones.
const mapPages = builtHtml.filter((f) => readFileSync(f, "utf8").includes('class="world-map'));
const badMaps = [];
for (const file of mapPages) {
  const html = readFileSync(file, "utf8");
  const open = html.indexOf('<svg viewBox="0 0 1000 700"');
  const svg = html.slice(open, html.indexOf("</svg>", open));
  const regions = count(svg, /class="map-region"/g);
  if (!/role="group"/.test(svg)) badMaps.push(`${relative(root, file)}: the map svg is not role="group"`);
  if (!/aria-label="[^"]+"/.test(svg.slice(0, 200))) badMaps.push(`${relative(root, file)}: the map svg has no aria-label`);
  if (regions !== nationSlugs.length) badMaps.push(`${relative(root, file)}: ${regions} region links inside the svg, expected ${nationSlugs.length}`);
}
ok(mapPages.length > 0 && badMaps.length === 0, `the map exposes all ${nationSlugs.length} nation links on ${mapPages.length} page(s)${badMaps.length ? `:\n      ${badMaps.slice(0, 5).join("\n      ")}` : ""}`);

// Every table in a page body is wrapped, because the horizontal scroll lives on
// the wrapper: `display: block` on the <table> itself is what a screen reader
// reads as "not a table". Three code paths emit tables (the markdown renderer,
// all-skills.njk, build-view.js) and this is the one check over all three.
const unwrapped = [];
for (const file of builtHtml) {
  const main = mainOf(readFileSync(file, "utf8"));
  if (!main) continue;
  for (const m of main.matchAll(/<table\b/g)) {
    const before = main.slice(Math.max(0, m.index - 120), m.index);
    if (!/<div class="table-scroll">\s*$/.test(before)) unwrapped.push(`${relative(root, file)} @${m.index}`);
  }
}
ok(unwrapped.length === 0, `every <table> in a page body is inside div.table-scroll${unwrapped.length ? `:\n      ${unwrapped.slice(0, 5).join("\n      ")}` : ""}`);

// No page body skips a heading level, and no heading is hidden from the
// accessibility tree. Neither half has ever failed on this site — the era
// banners, which is what prompted the check, did not skip a level, because the
// event h3s already sat under the chapter's own h2. Both were verified by
// introducing the fault: an h2 → h4 in a chapter, and an aria-hidden on the era
// heading. What catches the era regression itself is the assertion below.
const skipped = [];
for (const file of builtHtml) {
  const main = mainOf(readFileSync(file, "utf8"));
  if (!main) continue;
  let prev = 0;
  for (const m of main.matchAll(/<h([1-6])\b([^>]*)>/g)) {
    const level = Number(m[1]);
    if (/aria-hidden="true"/.test(m[2])) skipped.push(`${relative(root, file)}: an h${level} is aria-hidden`);
    else if (prev && level > prev + 1) skipped.push(`${relative(root, file)}: h${prev} → h${level}`);
    if (!/aria-hidden="true"/.test(m[2])) prev = level;
  }
}
ok(skipped.length === 0, `no page body skips or hides a heading level${skipped.length ? `:\n      ${skipped.slice(0, 5).join("\n      ")}` : ""}`);

// The timeline's era is a heading now, and names its group.
const historyMain = mainOf(readFileSync(join(root, "lore", "history", "index.html"), "utf8")) ?? "";
const eraHeadings = count(historyMain, /<h2 class="timeline__era">/g);
ok(eraHeadings > 0, `the timeline's era banners are headings (${eraHeadings} of them)`);

// The theme button is a toggle, so it says which way it is set, and theme.js
// keeps that in step with the theme actually in force.
const themeJs = readFileSync(join(root, "js", "theme.js"), "utf8");
const missingPressed = builtHtml.filter((f) => !/class="theme-toggle"[^>]*aria-pressed="(true|false)"/.test(readFileSync(f, "utf8")));
ok(missingPressed.length === 0, `the theme toggle ships aria-pressed on all ${builtHtml.length} pages${missingPressed.length ? `: ${missingPressed.slice(0, 3).map((f) => relative(root, f)).join(", ")}` : ""}`);
ok(/setAttribute\("aria-pressed"/.test(themeJs), "theme.js keeps aria-pressed in sync with the theme in force");

// The stylesheet's side of the same two facts.
const tableRule = mainCss.match(/\ntable \{[\s\S]*?\n\}/);
ok(tableRule !== null && !/display:\s*block/.test(tableRule[0]), "main.css's table rule does not set display: block");
ok(/\.table-scroll \{[^}]*overflow-x:\s*auto/.test(mainCss), "main.css puts the horizontal scroll on .table-scroll");

// Gold text against paper, at the two tokens' own values. axe measures the
// rendered page; this measures the tokens, so a nudge back toward the ornament
// gold fails here without a browser.
const tokenValue = (block, name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
const lightBlock = mainCss.slice(mainCss.indexOf(":root {"), mainCss.indexOf("@media (prefers-color-scheme: dark)"));
const contrast = (a, b) => {
  const lum = (hex) => {
    const chan = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const goldText = tokenValue(lightBlock, "gold-text");
const paper = tokenValue(lightBlock, "paper");
const goldRatio = goldText && paper ? contrast(goldText, paper) : 0;
ok(goldRatio >= 4.5, `--gold-text clears AA on --paper (${goldRatio.toFixed(2)}:1, needs 4.5)`);
// (?<![-\w]) so background-color and border-color do not read as text colour.
const goldUses = [...mainCss.matchAll(/^([^{\n]+)\{[^}]*(?<![-\w])color:\s*var\(--gold\)/gm)].map((m) => m[1].trim());
ok(
  goldUses.length === 1 && goldUses[0] === ".orn",
  `--gold is left to the ornaments; text uses --gold-text${goldUses.length === 1 && goldUses[0] === ".orn" ? "" : `: ${goldUses.join(" | ")}`}`
);

// The file says the two dark token blocks must stay identical and nothing was
// checking it. Editing one and not the other gives a visitor on a dark OS a
// different palette from a visitor who pressed the button.
const darkBlocks = [...mainCss.matchAll(/:root(?::not\(\[data-theme="light"\]\))?\[?[^{]*\{([\s\S]*?)\n\s*\}/g)]
  .map((m) => m[1])
  .filter((b) => /--paper:\s*#0f1713/.test(b))
  .map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean).join("\n"));
ok(darkBlocks.length === 2 && darkBlocks[0] === darkBlocks[1], `the two dark token blocks declare the same tokens (${darkBlocks.length} found)`);

// 8c. The generated "See also" blocks (Phase 8). Nothing in them is written by
// hand, so the failures worth catching are the ones generation makes rather than
// the ones typing makes: a join key that stopped resolving, a fragment that
// points at an id no page has, and a relation that silently produced nothing at
// all. The last is the one a diff hides — an empty block renders as no block.
console.log("# see also");
const skillData = JSON.parse(readFileSync(join(root, "src", "_data", "skills.json"), "utf8"));

// The one hand-written part: each nation's `culture` frontmatter. 16 nations and
// 16 cultures, and the pairing has to be one for one in both directions — a
// nation naming a culture that does not exist already throws in the build, but a
// culture no nation claims is silent and means a nation page is reading somebody
// else's row.
const nationCultures = nationSlugs.map((slug) => {
  const front = readFileSync(join(root, "src", "lore", "nations", `${slug}.md`), "utf8");
  return { slug, culture: front.match(/^culture:\s*"?([^"\n]+?)"?\s*$/m)?.[1] };
});
const cultureNames = new Set(skillData.cultures.map((c) => c.name));
const unjoined = nationCultures.filter((n) => !n.culture || !cultureNames.has(n.culture));
const unclaimed = [...cultureNames].filter((name) => !nationCultures.some((n) => n.culture === name));
ok(
  unjoined.length === 0,
  `every nation names a culture in skills.json (${nationCultures.length})${unjoined.length ? `, broken: ${unjoined.map((n) => `${n.slug} → ${n.culture ?? "none"}`).join(", ")}` : ""}`
);
ok(
  unclaimed.length === 0,
  `every culture in skills.json is claimed by a nation (${cultureNames.size})${unclaimed.length ? `, orphaned: ${unclaimed.join(", ")}` : ""}`
);

// Excellency alignment, which is what the Domains chapter's blocks are built
// from. Read out of excellencies.md's heading structure, so the check is that
// every Excellency got one and every Domain that has a page is named by at
// least one — an alignment list that came back empty would render six missing
// blocks and no error.
const excellencyTables = skillData.tables.filter((t) => t.groupKind === "Excellency");
const domainNames = skillData.tables.filter((t) => t.groupKind === "Domain").map((t) => t.group);
const unaligned = excellencyTables.filter((t) => !(t.domains ?? []).length);
const domainless = domainNames.filter((d) => !excellencyTables.some((t) => (t.domains ?? []).includes(d)));
ok(
  excellencyTables.length === 30 && unaligned.length === 0,
  `all 30 Excellencies carry a Domain alignment (${excellencyTables.length} tables)${unaligned.length ? `, unaligned: ${unaligned.map((t) => t.group).join(", ")}` : ""}`
);
ok(
  domainNames.length === 6 && domainless.length === 0,
  `each of the ${domainNames.length} Domains has Excellencies aligned to it${domainless.length ? `, empty: ${domainless.join(", ")}` : ""}`
);

// The blocks on the page. Six on the Domains chapter, one per Domain section,
// and one on every nation page.
const domainsHtml = readFileSync(join(root, "mechanics", "skills", "domains", "index.html"), "utf8");
const domainBlocks = [...domainsHtml.matchAll(/<div class="see-also"/g)].length;
ok(domainBlocks === domainNames.length, `the Domains chapter carries one See also per Domain (${domainBlocks} of ${domainNames.length})`);
const nationsWithout = nationSlugs.filter(
  (slug) => !readFileSync(join(root, "lore", "nations", slug, "index.html"), "utf8").includes('<div class="see-also"')
);
ok(nationsWithout.length === 0, `every nation page carries a See also (${nationSlugs.length})${nationsWithout.length ? `: ${nationsWithout.join(", ")}` : ""}`);

// Every link inside a block resolves to a built page and, where it has one, to
// an id that page actually has. Section 3's cross-link check walks <main> and
// would catch most of this, but it is not the check whose message names the
// generator — and a block's links are the whole point of the block.
const seeAlsoBad = [];
let seeAlsoLinks = 0;
for (const file of builtHtml) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/<div class="see-also"[\s\S]*?<\/div>/g)) {
    for (const link of m[0].matchAll(/href="([^"]+)"/g)) {
      seeAlsoLinks++;
      const [path, fragment] = link[1].split("#");
      if (!path.startsWith(PREFIX)) { seeAlsoBad.push(`${relative(root, file)}: ${link[1]} is not on this site`); continue; }
      const page = join(root, path.slice(PREFIX.length), "index.html");
      if (!existsSync(page)) { seeAlsoBad.push(`${relative(root, file)}: ${link[1]} is not a page`); continue; }
      if (!fragment) continue;
      const ids = new Set([...readFileSync(page, "utf8").matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
      if (!ids.has(fragment) && !ids.has(decodeURIComponent(fragment))) {
        seeAlsoBad.push(`${relative(root, file)}: ${link[1]} has no such id`);
      }
    }
  }
}
ok(
  seeAlsoLinks > 0 && seeAlsoBad.length === 0,
  `every See also link resolves (${seeAlsoLinks} links)${seeAlsoBad.length ? `:\n      ${seeAlsoBad.slice(0, 6).join("\n      ")}` : ""}`
);

// Events both ways. /lore/history/ gives every event an id, from the same
// eventAnchor the nation pages link it by; and an event that names nations now
// links them, which is what the colour used to be the only sign of.
const historyHtml = readFileSync(join(root, "lore", "history", "index.html"), "utf8");
const missingEventIds = timeline.filter((ev) => !historyHtml.includes(`id="${eventAnchor(ev.title)}"`));
ok(
  missingEventIds.length === 0,
  `every timeline event has its id on /lore/history/ (${timeline.length})${missingEventIds.length ? `, missing: ${missingEventIds.map((e) => e.title).join(", ")}` : ""}`
);
const eventsWithNations = timeline.filter((ev) => (ev.nations ?? []).length);
const missingEventLinks = [];
for (const ev of eventsWithNations) {
  const at = historyHtml.indexOf(`id="${eventAnchor(ev.title)}"`);
  const block = historyHtml.slice(at, historyHtml.indexOf("</li>", at));
  for (const slug of ev.nations) {
    if (!block.includes(`href="${PREFIX}lore/nations/${slug}/"`)) missingEventLinks.push(`${ev.title} → ${slug}`);
  }
}
ok(
  eventsWithNations.length > 0 && missingEventLinks.length === 0,
  `every event links the nations it names (${eventsWithNations.length} events)${missingEventLinks.length ? `: ${missingEventLinks.join(", ")}` : ""}`
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
