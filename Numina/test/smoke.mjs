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
