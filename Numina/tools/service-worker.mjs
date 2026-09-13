// Generates sw.js, the offline kit's service worker, from the built output.
// Runs last in `npm run build` — after Eleventy and after Pagefind — because
// the precache manifest is a list of files that have to exist to be listed.
//
// Two properties of this file are load-bearing, and test/smoke.mjs pins both:
//
// 1. **The manifest is sorted and complete.** Every built page, both
//    stylesheets, every script, the five woff2 and the two assets, ordered by
//    URL. Sorted because two builds of the same source have to produce a
//    byte-identical sw.js or CI's "did you rebuild?" check fails on sw.js
//    itself, and complete because a page added later that is not in the kit is
//    a page that is missing in the field.
// 2. **Nothing under pagefind/ contributes to the version.** Pagefind's index
//    chunk names are content hashes over a sharding that is not stable across
//    machines — that is exactly why numina-ci.yml already excludes pagefind/
//    from the rebuild check — so a version hashed over any of it would differ
//    between two builds of the same source. The bundle's fixed-name files are
//    precached by name; the chunks it derives at search time are not, and the
//    service worker's runtime cache is what carries those.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { PATH_PREFIX } from "../eleventy.config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Top-level directories that hold built pages. index.html at the root is the
// home page and is added beside them.
const PAGE_DIRS = ["lore", "mechanics", "new-to-numina", "search"];
// Passthrough directories, and the extensions worth carrying to a field. An
// allowlist rather than a skip list, so fonts/README.md — copied because
// Eleventy passes the whole folder through — stays out without being named.
const ASSET_DIRS = ["css", "js", "fonts", "assets"];
const ASSET_EXTENSIONS = [".css", ".js", ".woff2", ".svg", ".png"];
// Pagefind's fixed-name files: the loader, the Component UI, its stylesheet, the
// two wasm builds and the entry manifest. Everything else in that folder is
// named after a content hash (see the note above).
//
// Phase 8 swapped the Default UI (pagefind-ui.js and pagefind-ui.css) for the
// Component UI here, in the same commit that changed which of them the pages
// load. Pagefind still writes the Default UI's two files on every build and
// nothing loads them, so precaching them would put 100 KB on every device to
// serve no page; precaching the wrong pair would leave the field kit with a
// search bundle that is not there. test/smoke.mjs checks this list against the
// scripts and stylesheets the built pages actually reference.
const PAGEFIND_FILES = [
  "pagefind-component-ui.css",
  "pagefind-component-ui.js",
  "pagefind-entry.json",
  "pagefind.js",
  "wasm.en.pagefind",
  "wasm.unknown.pagefind",
];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// The files whose bytes decide the version, as { url, file } pairs. Pagefind is
// deliberately not here.
export function hashedFiles(siteRoot = root) {
  const files = [];
  const home = join(siteRoot, "index.html");
  if (exists(home)) files.push(home);
  for (const dir of PAGE_DIRS) {
    const p = join(siteRoot, dir);
    if (exists(p)) files.push(...walk(p).filter((f) => f.endsWith("index.html")));
  }
  for (const dir of ASSET_DIRS) {
    const p = join(siteRoot, dir);
    if (exists(p)) files.push(...walk(p).filter((f) => ASSET_EXTENSIONS.some((e) => f.endsWith(e))));
  }
  return files
    .map((file) => ({
      url: PATH_PREFIX + relative(siteRoot, file).replace(/\\/g, "/").replace(/index\.html$/, ""),
      file,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

// Everything the worker precaches: the hashed files plus Pagefind's fixed-name
// ones, sorted as one list.
export function precacheUrls(siteRoot = root) {
  const pagefind = PAGEFIND_FILES.filter((name) => exists(join(siteRoot, "pagefind", name))).map(
    (name) => `${PATH_PREFIX}pagefind/${name}`
  );
  return [...hashedFiles(siteRoot).map((e) => e.url), ...pagefind].sort((a, b) => a.localeCompare(b));
}

// A hash over what the visitor would actually receive: each file's URL and the
// sha256 of its bytes. Twelve hex characters is 48 bits, which is far more than
// enough to tell one build of this site from the next and short enough to print
// in a banner a player reads.
export function versionFor(siteRoot = root) {
  const digest = createHash("sha256");
  for (const { url, file } of hashedFiles(siteRoot)) {
    digest.update(url);
    digest.update("\0");
    digest.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    digest.update("\n");
  }
  return digest.digest("hex").slice(0, 12);
}

export function renderServiceWorker(version, urls) {
  const list = urls.map((u) => `  ${JSON.stringify(u)},`).join("\n");
  return `// Generated by tools/service-worker.mjs. Do not edit by hand — run
// \`npm run build\` in Numina/ and commit what it writes.
//
// The offline kit. An event is a weekend in a field with no signal, so every
// page of this site, both stylesheets, every script, the five fonts and
// Pagefind's loader are put on the device the first time a browser visits.
//
// VERSION is a hash over the bytes of everything in the list below except
// Pagefind's, which is not stable across machines. It changes when the site
// changes and only then, so an unchanged rebuild produces this file unchanged
// and CI's rebuild check stays quiet.
const VERSION = ${JSON.stringify(version)};
const CACHE = \`numina-\${VERSION}\`;
const SCOPE = ${JSON.stringify(PATH_PREFIX)};

const PRECACHE = [
${list}
];

// Pagefind needs one more file before it can answer anything: the language
// metadata chunk, whose name carries a content hash. That hash is not stable
// across machines, so it cannot be written into the list above — it is read out
// of pagefind-entry.json at install time instead. The index chunks and result
// fragments underneath it are fetched as a search needs them and land in the
// same cache through the runtime path below, so search works offline for what
// has been searched for online at least once.
async function pagefindMeta() {
  try {
    const entry = await fetch(\`\${SCOPE}pagefind/pagefind-entry.json\`, { cache: "reload" });
    if (!entry.ok) return [];
    const data = await entry.json();
    return Object.values(data.languages ?? {})
      .map((lang) => lang.hash)
      .filter(Boolean)
      .map((hash) => \`\${SCOPE}pagefind/pagefind.\${hash}.pf_meta\`);
  } catch {
    return [];
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const urls = PRECACHE.concat(await pagefindMeta());
      // Not cache.addAll: it rejects the whole list if any single response is
      // not ok, which would leave a visitor with no kit at all because one file
      // 404'd. Each failure costs its own file and nothing else.
      await Promise.all(
        urls.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      // No skipWaiting here. A new build takes over when the reader presses the
      // button that says so, not underneath a page they are reading.
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("numina-") && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

// Cache first, then refresh in the background: the field case has to answer
// from the device without waiting for a network that is not there, and a
// half-bar of signal is slower than no signal at all. Freshness is the
// version's job, not this handler's.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  event.respondWith(respond(event));
});

async function respond(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  // ignoreSearch, so /mechanics/packet/?p=new-player is served by the copy of
  // /mechanics/packet/ that is already on the device.
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  if (request.mode === "navigate") {
    const home = await cache.match(SCOPE);
    if (home) return home;
  }
  return new Response("This page is not in the copy of Numina saved on this device.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  const reply = (message) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(message);
    else if (event.source) event.source.postMessage(message);
  };
  if (data.type === "numina-version") reply({ type: "numina-version", version: VERSION, files: PRECACHE.length });
  else if (data.type === "numina-update") self.skipWaiting();
});
`;
}

// Only when run as a script. test/smoke.mjs imports the three functions above
// to recompute the manifest and the version from the built output and compare
// them with what is committed; importing must not rewrite the file it checks.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = versionFor();
  const urls = precacheUrls();
  writeFileSync(join(root, "sw.js"), renderServiceWorker(version, urls));
  console.log(`service worker: build ${version}, ${urls.length} files precached`);
}
