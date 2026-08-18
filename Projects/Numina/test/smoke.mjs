// Smoke checks for the built Numina site. Run from anywhere:
//   node Projects/Numina/test/smoke.mjs
// Exits non-zero on any failure (repo convention).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/Projects/Numina/";
// Must match tools/clean.mjs's GENERATED list.
const GENERATED = ["index.html", "search", "lore", "mechanics", "css", "js", "fonts", "assets", "pagefind"];
const OFFSITE_ALLOWED = ["www.numinalarp.com", "discord.gg", "pagefind.app"];

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
  const outPath = rel === "index" || rel.endsWith("/index")
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

// 6. Output hygiene: clean manifest covers every generated top-level entry.
console.log("# hygiene");
const expectedTopLevel = new Set([
  ...GENERATED, "src", "test", "tools", "source-material", "node_modules",
  "README.md", "CONTENT-GUIDE.md", "package.json", "package-lock.json",
  ".gitignore", "eleventy.config.mjs", ".cache",
]);
const unexpected = readdirSync(root).filter((e) => !expectedTopLevel.has(e));
ok(unexpected.length === 0, `no unexpected top-level entries${unexpected.length ? `: ${unexpected.join(", ")}` : ""}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
