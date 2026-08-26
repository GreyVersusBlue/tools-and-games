// cloud.js — a design that outlives the tab it was drawn in.
//
// The wishlist has wanted this since Phase 9 and it has always been the same
// sentence: **the first thing in this project that needs a server**. Phase 9
// answered it with share.js, which puts the whole design in the fragment of a
// URL, and that is still the right answer for most of what people do with a
// link. It has one hard edge, measured rather than guessed: a design carrying
// a tracing image or an imported model does not fit in a link and says so in
// a dialog. Those designs cannot travel at all today.
//
// So this file is the client half, and it is deliberately *only* the client
// half. What it ships is a contract narrow enough to implement over a lunch
// break in whatever a person already runs:
//
//   GET    {base}/health              → { ok: true, maxBytes }
//   GET    {base}/d/{id}              → the save file, as JSON
//   PUT    {base}/d/{id}?key={key}    → stores it; the first PUT claims the id
//   DELETE {base}/d/{id}?key={key}    → forgets it
//
// Two ids, and the difference between them is the whole security model. The
// **design id** is in the link and lets anybody who has the link read it. The
// **write key** never leaves the browser that made the design, and without it
// a PUT to that id is refused. That is not accounts and it is not permissions;
// it is "whoever has the link can see it, whoever made it can change it",
// which is what a pair of teachers actually want and is the most a server this
// small can honestly promise. It is worth saying plainly: **a design put in
// the cloud is readable by anybody with the link.** The panel says so too.
//
// Unconfigured — which is what every copy of this tool is until somebody types
// an address — every function here refuses politely and nothing else in the
// tool changes. That is the phase's own rule: offline is the normal case, and
// anything that makes the file-only path worse is out of scope.
//
// No DOM except `localStorage` for the config, and `fetch` is injectable, so
// the suite exercises every path against a stub. Exercised by
// test/cloud.test.mjs.

const CONFIG_KEY = 'sg.cloud';
const KEYS_KEY = 'sg.cloud.keys';

// A cloud save is a whole save file, tracing image and all. Ten megabytes is
// a generous school; past it the refusal should be local and specific rather
// than a 413 from somebody else's proxy.
export const MAX_BYTES = 10 * 1024 * 1024;

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const pick = (rand, n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length)];
  return s;
};

export const newDesignId = (rand = Math.random) => pick(rand, 12);
export const newWriteKey = (rand = Math.random) => pick(rand, 24);

export const validId = (id) => typeof id === 'string' && /^[a-z0-9]{6,40}$/.test(id);

// ---------- configuration ----------

const store = () => (typeof localStorage === 'undefined' ? null : localStorage);

// An address with the scheme on it and nothing after the host but a path.
// Rejecting anything that is not http(s) is not paranoia: a `javascript:` in
// this field would be handed to `fetch` and, worse, printed as a link.
export function normalizeBase(raw) {
  const text = String(raw || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  if (!/^https?:\/\/[^\s/]+/i.test(text)) return '';
  return text;
}

// The relay is a WebSocket address rather than an HTTP one, and it is here
// rather than in wire.js for one reason: the same server usually does both,
// and somebody who has typed one address should not have to type a second.
export function normalizeRelay(raw) {
  const text = String(raw || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  if (!/^wss?:\/\/[^\s/]+/i.test(text)) return '';
  return text;
}

// The relay implied by a store address, when nobody has said otherwise:
// same host, `ws`/`wss` to match, `/relay` on the end. A guess, and one the
// panel shows so it can be overtyped.
export function impliedRelay(base) {
  const url = normalizeBase(base);
  if (!url) return '';
  return `${url.replace(/^http/i, 'ws')}/relay`;
}

export function readConfig(ls = store()) {
  const out = { base: '', relay: '', name: '' };
  if (!ls) return out;
  try {
    const raw = ls.getItem(CONFIG_KEY);
    if (!raw) return out;
    const d = JSON.parse(raw);
    out.base = normalizeBase(d && d.base);
    out.relay = normalizeRelay(d && d.relay);
    out.name = typeof (d && d.name) === 'string' ? d.name.slice(0, 24) : '';
  } catch { /* a corrupt config is no config */ }
  return out;
}

export function writeConfig(cfg, ls = store()) {
  const out = {
    base: normalizeBase(cfg && cfg.base),
    relay: normalizeRelay(cfg && cfg.relay),
    name: typeof (cfg && cfg.name) === 'string' ? cfg.name.trim().slice(0, 24) : '',
  };
  if (ls) {
    try { ls.setItem(CONFIG_KEY, JSON.stringify(out)); } catch { /* private mode */ }
  }
  return out;
}

export const cloudReady = (cfg) => !!normalizeBase(cfg && cfg.base);

// ---------- the write keys ----------
//
// Kept beside the config rather than in it, because they are the one thing in
// this tool that is genuinely secret and they should not be in anything that
// gets pasted into a bug report.

export function readKeys(ls = store()) {
  if (!ls) return {};
  try {
    const raw = ls.getItem(KEYS_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}

export function rememberKey(id, key, name, ls = store()) {
  const all = readKeys(ls);
  all[id] = { key, name: String(name || '').slice(0, 60), at: null };
  if (ls) {
    try { ls.setItem(KEYS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
  }
  return all;
}

export const keyFor = (id, ls = store()) => {
  const rec = readKeys(ls)[id];
  return rec && typeof rec.key === 'string' ? rec.key : '';
};

export function forgetKey(id, ls = store()) {
  const all = readKeys(ls);
  if (!(id in all)) return all;
  delete all[id];
  if (ls) {
    try { ls.setItem(KEYS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
  }
  return all;
}

// ---------- links ----------

export const CLOUD_KEY = 'd';

export function cloudFragment(id, base = '') {
  const body = base ? `${id}~${encodeURIComponent(base)}` : String(id);
  return `#${CLOUD_KEY}=${body}`;
}

export function readCloudFragment(hash) {
  const text = String(hash || '');
  const body = text.startsWith('#') ? text.slice(1) : text;
  if (!body) return null;
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== CLOUD_KEY) continue;
    const value = part.slice(eq + 1).trim();
    const tilde = value.indexOf('~');
    const id = tilde < 0 ? value : value.slice(0, tilde);
    if (!validId(id)) return null;
    let base = '';
    if (tilde >= 0) {
      try { base = normalizeBase(decodeURIComponent(value.slice(tilde + 1))); } catch { base = ''; }
    }
    return { id, base };
  }
  return null;
}

export function cloudURL(href, id, base = '') {
  const at = String(href || '');
  const cut = at.indexOf('#');
  return `${cut < 0 ? at : at.slice(0, cut)}${cloudFragment(id, base)}`;
}

// ---------- the four calls ----------

const netFetch = (opts) => (opts && opts.fetch) || (typeof fetch === 'function' ? fetch : null);

// Every failure a person can see, in a sentence they can act on. A store that
// is down and a store that has never been configured are different problems
// and are never reported as the same one.
async function call(method, url, opts, body) {
  const f = netFetch(opts);
  if (!f) throw new Error('This browser has no way to make network requests');
  let res;
  try {
    res = await f(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body,
    });
  } catch {
    throw new Error('Could not reach the store — check the address, or that you are online');
  }
  if (!res || typeof res.status !== 'number') throw new Error('The store answered with nothing');
  if (res.status === 404) throw new Error('There is no design at that address any more');
  if (res.status === 403 || res.status === 401) {
    throw new Error('That design belongs to another browser — save it as a copy instead');
  }
  if (res.status === 413) throw new Error('The store refused this design for being too large');
  if (res.status >= 400) throw new Error(`The store refused the request (${res.status})`);
  return res;
}

// Is there anything at this address, and what will it take. Deliberately
// tolerant: a store that answers 200 to /health with no body at all is a
// working store as far as this tool is concerned.
export async function checkStore(base, opts = {}) {
  const url = normalizeBase(base);
  if (!url) throw new Error('That is not an http address');
  const res = await call('GET', `${url}/health`, opts);
  let info = {};
  try { info = await res.json(); } catch { info = {}; }
  return {
    ok: true,
    maxBytes: typeof info.maxBytes === 'number' ? info.maxBytes : MAX_BYTES,
    note: typeof info.note === 'string' ? info.note.slice(0, 120) : '',
  };
}

export async function getDesign(base, id, opts = {}) {
  const url = normalizeBase(base);
  if (!url) throw new Error('No store address is set');
  if (!validId(id)) throw new Error('That is not a design address');
  const res = await call('GET', `${url}/d/${id}`, opts);
  const text = await res.text();
  if (!text) throw new Error('The store returned an empty design');
  return text;
}

export async function putDesign(base, id, key, json, opts = {}) {
  const url = normalizeBase(base);
  if (!url) throw new Error('No store address is set');
  if (!validId(id)) throw new Error('That is not a design address');
  const text = String(json || '');
  const bytes = text.length;
  if (bytes > MAX_BYTES) {
    throw new Error(`This design is ${Math.round(bytes / 1024 / 1024)} MB — past the ${Math.round(MAX_BYTES / 1024 / 1024)} MB the store takes`);
  }
  await call('PUT', `${url}/d/${id}?key=${encodeURIComponent(key)}`, opts, text);
  return { id, bytes };
}

export async function deleteDesign(base, id, key, opts = {}) {
  const url = normalizeBase(base);
  if (!url) throw new Error('No store address is set');
  await call('DELETE', `${url}/d/${id}?key=${encodeURIComponent(key)}`, opts);
  return true;
}

// ---------- what to say about it ----------

export function describeCloud(cfg) {
  if (!cloudReady(cfg)) {
    return 'No store is set, so designs stay in this browser and in the files you save. Everything else works exactly as it does now.';
  }
  return `Designs go to ${normalizeBase(cfg.base)}. Anybody with the link can open one; only this browser can change it.`;
}

export const STORE_CONTRACT = [
  'GET  {base}/health           → { ok: true, maxBytes }',
  'GET  {base}/d/{id}           → the save file',
  'PUT  {base}/d/{id}?key={key} → stores it; the first PUT claims the id',
  'DELETE {base}/d/{id}?key={key}',
];
