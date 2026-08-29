// What a service worker is allowed to keep, and for how long. Run
// `node --test` from Projects/school-generator.
//
// A service worker is the least debuggable thing in a browser: it survives
// reloads, it serves the page that would show you what it did, and getting it
// wrong ships a version of the tool nobody can update. So the decisions are
// all here, where they are functions of a URL and a method, and the properties
// worth holding are the ones whose failure mode is "a user is stuck on last
// week's build": the collab server is never cached, the worker never caches
// itself, `libs/` is cached hard and only a revision bump frees it, and an
// older revision's caches are the only ones ever deleted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  REV, CACHE_PREFIX, PRECACHE, ROUTES,
  cacheName, staleCaches, routeFor, registrable, offlineStatus, INSTALL_LABEL,
} from '../js/offline.js';

const ORIGIN = 'https://greyversusblue.com';
const HERE = `${ORIGIN}/Projects/school-generator/`;
const route = (path, opts = {}) => routeFor(new URL(path, HERE).href, { origin: ORIGIN, ...opts });

// ---------- the revision, and the cache it names ----------

test('the cache is named for the revision, and only this tool’s caches are ever dropped', () => {
  assert.match(REV, /^\d+\.\d+$/);
  assert.equal(cacheName(), `${CACHE_PREFIX}${REV}`);
  assert.equal(cacheName('9.9'), `${CACHE_PREFIX}9.9`);

  const names = [cacheName(), cacheName('29.4'), 'numina-v3', 'workbox-precache', ''];
  const stale = staleCaches(names);
  assert.deepEqual(stale, [cacheName('29.4')]);
  // A site with three apps on it keeps the other two.
  assert.ok(!stale.includes('numina-v3'));
  assert.deepEqual(staleCaches(null), []);
  assert.deepEqual(staleCaches([cacheName()]), []);
});

test('the precached shell is the shell, and every entry is relative', () => {
  assert.ok(PRECACHE.includes('./index.html'));
  assert.ok(PRECACHE.includes('./js/main.js'));
  assert.ok(PRECACHE.includes('./libs/three.module.js'));
  for (const p of PRECACHE) assert.ok(p.startsWith('./'), `${p} is not relative to the scope`);
  // Small on purpose: precaching eighty modules by hand is a list that is
  // wrong within a phase, and the other seventy-five arrive through `fresh`.
  assert.ok(PRECACHE.length <= 8, 'the precache has grown into a manifest');
});

// ---------- the one decision ----------

test('the vendored libraries and the assets are cached hard', () => {
  assert.equal(route('libs/three.module.js'), 'immutable');
  assert.equal(route('libs/addons/EffectComposer.js'), 'immutable');
  assert.equal(route('/assets/fonts/public-sans-latin-400-normal.woff2'), 'immutable');
  // A cache-busting query is still the same immutable resource, stored under
  // its own key — the route is decided by the path, not by the search.
  assert.equal(route('libs/three.module.js?v=2'), 'immutable');
});

test('the tool’s own source is network first, so a deploy reaches somebody online', () => {
  assert.equal(route(''), 'fresh');
  assert.equal(route('index.html'), 'fresh');
  assert.equal(route('js/main.js'), 'fresh');
  assert.equal(route('js/gallerystock.js'), 'fresh');
  assert.equal(route('tools/walk-shell.html'), 'fresh');
});

test('the collab server is never this worker’s business', () => {
  // A cached list of designs, or a cached session join, is worse than no
  // worker at all — see server/README.md for what these answer.
  for (const p of ['api/designs', 'designs/abc', 'session/xyz', 'relay']) {
    assert.equal(route(p), 'bypass', `${p} was intercepted`);
  }
  assert.equal(routeFor(`${ORIGIN}/api/designs`, { origin: ORIGIN }), 'bypass');
});

test('a worker that serves its own predecessor never updates', () => {
  assert.equal(route('sw.js'), 'bypass');
});

test('anything that is not a same-origin GET is left entirely alone', () => {
  assert.equal(route('js/main.js', { method: 'POST' }), 'bypass');
  assert.equal(route('js/main.js', { method: 'head' }), 'bypass');
  assert.equal(routeFor('https://example.net/tracker.js', { origin: ORIGIN }), 'bypass');
  assert.equal(routeFor('ws://localhost:8080/relay', { origin: ORIGIN }), 'bypass');
  assert.equal(routeFor('data:text/plain,hello', { origin: ORIGIN }), 'bypass');
  assert.equal(routeFor('http://[', { origin: ORIGIN }), 'bypass');
  assert.equal(routeFor(null, { origin: ORIGIN }), 'bypass');
  assert.equal(routeFor('', { origin: ORIGIN }), 'bypass');
  // ...but an ordinary relative URL is exactly what a page asks for, and is
  // routed as one rather than thrown away.
  assert.equal(routeFor('js/main.js', { origin: ORIGIN }), 'fresh');
});

test('every answer is one of the three routes', () => {
  const paths = ['', 'index.html', 'js/main.js', 'libs/three.module.js', 'sw.js',
    'api/designs', '/assets/textures/README.md', 'manifest.webmanifest'];
  for (const p of paths) assert.ok(ROUTES.includes(route(p)), `${p} answered off the list`);
});

// ---------- what the page says about it ----------

test('registrable names the reason rather than shrugging', () => {
  assert.deepEqual(registrable({ navigator: {}, isSecureContext: true }),
    { ok: false, why: 'This browser has no service workers, so the tool needs the network.' });
  const nav = { serviceWorker: {} };
  assert.equal(registrable({ navigator: nav, isSecureContext: false }).ok, false);
  assert.match(registrable({ navigator: nav, isSecureContext: false }).why, /secure origin/);
  assert.equal(registrable({ navigator: nav, isSecureContext: true, location: { protocol: 'file:' } }).ok, false);
  assert.deepEqual(registrable({ navigator: nav, isSecureContext: true, location: { protocol: 'https:' } }),
    { ok: true, why: '' });
});

test('the offline row says one thing per state', () => {
  const said = new Set([
    offlineStatus({}),
    offlineStatus({ registered: true }),
    offlineStatus({ registered: true, controlling: true, rev: REV }),
    offlineStatus({ error: 'module workers are not supported here' }),
  ]);
  assert.equal(said.size, 4, 'two states share a sentence');
  assert.match(offlineStatus({ registered: true, controlling: true }), new RegExp(REV));
  assert.match(offlineStatus({ error: 'nope' }), /nope/);
  assert.equal(typeof INSTALL_LABEL, 'string');
});

// ---------- the worker and the manifest, as files ----------

test('sw.js takes every decision from this module and none of its own', async () => {
  const src = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/js\/offline\.js'/, 'the worker has stopped importing its policy');
  // The failure this guards against is a second copy of the routing rules
  // growing inside the worker, where nothing can test them.
  assert.ok(!/libs\//.test(src.replace(/^\s*\/\/.*$/gm, '')),
    'sw.js has grown a path rule of its own — it belongs in routeFor');
  for (const hook of ['install', 'activate', 'fetch']) {
    assert.match(src, new RegExp(`addEventListener\\('${hook}'`), `no ${hook} handler`);
  }
});

test('the manifest is valid JSON, in scope, and points at an icon that exists', async () => {
  const here = (p) => new URL(p, import.meta.url);
  const m = JSON.parse(await readFile(here('../manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'School Generator');
  assert.equal(m.scope, './');
  assert.equal(m.start_url, './');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.length >= 1);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'no maskable icon');
  for (const icon of m.icons) {
    assert.match(icon.src, /^\.\//, 'an icon outside the scope');
    const svg = await readFile(here(`../${icon.src.slice(2)}`), 'utf8');
    assert.match(svg, /^<svg/, `${icon.src} is not an SVG`);
  }
  // The manifest is precached: an install prompt that 404s its own manifest
  // offline is an install prompt that fails on the one load that needed it.
  assert.ok(PRECACHE.includes('./manifest.webmanifest'));
});
