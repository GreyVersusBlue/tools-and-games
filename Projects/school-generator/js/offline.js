// offline.js — what a service worker is allowed to keep, and for how long.
//
// Phase 30's second item, and the one that finally answers a complaint this
// file's own wishlist has carried since arc three: *the vendored `libs/` are
// 1.3 MB and cannot be cached hard because the paths carry no version.* The
// fix that was written down there was to put a version in the directory name,
// which costs an edit to the import map and a rebuild of the 2.9 MB walk
// template. This is the cheaper one: a cache named for the worker's own
// revision. Within a revision `libs/three.module.js` is answered from disk
// without a byte of network — which is what `immutable` buys — and bumping
// `REV` invalidates every one of them at once. Not a single import path moves.
//
// Everything here is a *decision*, and every decision is a pure function of a
// URL and a method, which is the whole reason this module exists apart from
// `sw.js`: a service worker is the least debuggable thing in a browser, and
// the half of it worth getting right is the half that can be tested in Node.
// `sw.js` is the other half — the event listeners, and nothing else.
//
// The three routes, and why each is what it is:
//
//   **bypass** — anything this worker has no business touching: another
//   origin, a method other than GET, the collab server's own endpoints, the
//   worker and manifest themselves. A bypassed request is not intercepted at
//   all; the browser does what it would have done with no worker installed.
//
//   **immutable** — `libs/` and `assets/`: vendored three.js, the fonts, the
//   textures. Cache first, network never, until `REV` changes. These are the
//   bytes the complaint was about.
//
//   **fresh** — the tool's own source: `index.html` and `js/`. Network first,
//   cache as the fallback. A deploy has to reach somebody who is online, and
//   an eighty-module tool served half from a week-old cache and half from
//   today is a bug report nobody can read. Offline, the fallback is the whole
//   point and the cache answers everything.
//
// Pure module: no DOM, no `caches`, no `fetch`. Exercised by
// test/offline.test.mjs.

// The worker's own revision, and therefore the name of its cache. Bump it
// when the vendored libraries change, or when a release should drop every
// cached byte and start again. It is deliberately a hand-typed string: there
// is no build step to stamp a hash into, and a revision somebody has to think
// about once a phase is more honest than one that changes when a comment does.
export const REV = '30.1';

export const CACHE_PREFIX = 'school-generator-';

export const cacheName = (rev = REV) => `${CACHE_PREFIX}${rev}`;

// The shell, fetched at install so a first visit that goes offline before it
// has walked anywhere still opens. Everything else arrives through `fresh` and
// `immutable` as the page asks for it — precaching eighty modules by hand is a
// list that would be wrong within a phase.
export const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/main.js',
  './libs/three.module.js',
];

// Caches from an older revision of this worker — the ones `activate` deletes.
// Only ever this tool's own: a site with three apps on it keeps the other two.
export function staleCaches(names, rev = REV) {
  const keep = cacheName(rev);
  return (Array.isArray(names) ? names : [])
    .filter((n) => typeof n === 'string' && n.startsWith(CACHE_PREFIX) && n !== keep);
}

// Endpoints belonging to the optional design store and session relay. They are
// a *server*, and a server's answers are not this worker's to keep — a cached
// list of designs or a cached session join is worse than no worker at all.
const SERVER_PATHS = ['/api/', '/designs/', '/session/', '/relay'];

export const ROUTES = ['bypass', 'immutable', 'fresh'];

// The one decision. `url` is anything `new URL()` accepts; `opts` carries the
// request's method and the worker's own origin.
//
// Written against a parsed URL rather than a Request so it can be called with
// a string in a test, which is the same trick `readShareFragment` plays.
export function routeFor(url, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET') return 'bypass';
  let u;
  if (!(url instanceof URL) && (typeof url !== 'string' || !url.trim())) return 'bypass';
  try {
    u = url instanceof URL ? url : new URL(url, opts.origin || 'https://example.org/');
  } catch {
    return 'bypass';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'bypass';
  if (opts.origin && u.origin !== new URL(opts.origin).origin) return 'bypass';
  const path = u.pathname;
  if (SERVER_PATHS.some((p) => path.includes(p))) return 'bypass';
  // The worker and the manifest are the browser's own to refresh; a worker
  // that serves its predecessor from cache is a worker that never updates.
  if (/\/sw\.js$/.test(path)) return 'bypass';
  if (/\/(libs|assets)\//.test(path)) return 'immutable';
  return 'fresh';
}

// A query string is a different resource, and every fetch in this tool that
// carries one is a cache-buster or a session token. Kept out of the cache key
// rather than out of the route, so `libs/x.js?v=2` is still immutable and
// still stored under its own key.
export const cacheKey = (url) => String(url);

// ---------- what the page says about it ----------

// Whether registering is even worth attempting, and the sentence to print
// when it is not. A service worker needs a secure context and a real origin;
// `file://` has neither, and the tool over `file://` is already broken in a
// louder way (see bootcheck.js).
export function registrable(env = {}) {
  const nav = env.navigator || (typeof navigator === 'undefined' ? null : navigator);
  const loc = env.location || (typeof location === 'undefined' ? null : location);
  if (!nav || !('serviceWorker' in nav)) {
    return { ok: false, why: 'This browser has no service workers, so the tool needs the network.' };
  }
  const secure = env.isSecureContext !== undefined
    ? !!env.isSecureContext
    : (typeof isSecureContext === 'undefined' ? true : isSecureContext);
  if (!secure) {
    return { ok: false, why: 'Offline needs a secure origin — https, or localhost.' };
  }
  if (loc && String(loc.protocol) === 'file:') {
    return { ok: false, why: 'Offline needs the page served, not opened from disk.' };
  }
  return { ok: true, why: '' };
}

// The status line for the offline row, in the four states it can be in. One
// function so the palette entry, the welcome note and the status bar cannot
// disagree about what "installed" means.
export function offlineStatus(s = {}) {
  if (s.error) return `Offline is not available here: ${s.error}`;
  if (s.controlling) {
    return `Ready offline — this school generator runs with the network off (revision ${s.rev || REV}).`;
  }
  if (s.registered) return 'Saving the tool for offline use — it will be ready on the next load.';
  return 'Not saved for offline use yet.';
}

// The install prompt, as a sentence. `beforeinstallprompt` fires on exactly
// one engine family and never on the rest, so the button it belongs to is
// created by the event rather than waiting for it.
export const INSTALL_LABEL = 'Install School Generator';
