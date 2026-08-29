// sw.js — the tool, kept on the disk it was opened from.
//
// Phase 30. Deliberately the thinnest file in the project: three event
// listeners and no decisions. Every decision — which requests are this
// worker's business, which are answered from the cache without asking, which
// caches belong to an older revision — is `js/offline.js`, which is a pure
// module with a suite, because a service worker is the least debuggable thing
// a browser runs and the half worth getting right is the half Node can hold.
//
// It is a **module** worker (`registered with { type: 'module' }`), which is
// the only way it can import that module without a build step to bundle one.
// Engines that do not support module workers reject the registration, main.js
// catches it, and the tool is exactly what it was before this phase — online,
// working, and saying so in the offline row rather than failing quietly.
//
// The bargain with `libs/`: within one `REV` they are answered from the cache
// with no network at all, which is the `immutable` year the wishlist wanted
// and could not have while the paths carry no version. Bumping `REV` renames
// the cache, and `activate` deletes every cache that is not the current one.

import { REV, cacheName, PRECACHE, staleCaches, routeFor } from './js/offline.js';

const CACHE = cacheName(REV);

// Install: the shell, and nothing else. `addAll` is all-or-nothing on
// purpose — half a shell in the cache is a tool that opens to a broken page
// offline, which is worse than one that admits it needs the network.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    // The new worker takes over at the next load rather than waiting for
    // every tab to close: a design tool people leave open for days would
    // otherwise never see a deploy.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(staleCaches(names, REV).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const route = routeFor(e.request.url, { method: e.request.method, origin: self.location.origin });
  if (route === 'bypass') return;
  e.respondWith(route === 'immutable' ? fromCache(e.request) : fromNetwork(e.request));
});

// Cache first, network only on a miss. The stored copy is never revalidated:
// that is what makes it immutable, and what `REV` is for.
async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

// Network first, cache as the fallback — and the cache is refreshed by every
// success, so going offline keeps whatever the last online visit saw.
async function fromNetwork(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // A navigation with nothing cached for it still gets the shell — the
    // tool's own page is what somebody typing the address offline wants,
    // whichever URL under it they typed.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
