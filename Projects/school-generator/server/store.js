// store.js — every decision the design store makes, and no disk.
//
// `cloud.js` writes the contract down as four lines:
//
//   GET    {base}/health              → { ok: true, maxBytes }
//   GET    {base}/d/{id}              → the save file, as JSON
//   PUT    {base}/d/{id}?key={key}    → stores it; the first PUT claims the id
//   DELETE {base}/d/{id}?key={key}    → forgets it
//
// ...and it writes down the security model in one sentence, which is the part
// worth being careful about: **the design id is in the link and lets anybody
// who has the link read it; the write key never leaves the browser that made
// the design, and without it a PUT to that id is refused.** That is not
// accounts and it is not permissions. Whoever has the link can see it,
// whoever made it can change it.
//
// So this file is the policy and `index.mjs` is the plumbing. `decide()`
// takes a request and what the store already knows about that id, and answers
// with a status and what to do — which means every rule below can be asserted
// without a socket, a temp directory, or a clock.
//
// Pure module. Exercised by test/server-store.test.mjs.

import { timingSafeEqual } from 'node:crypto';

// The same grammars cloud.js generates and validates. Restated rather than
// imported, for the reason relay.js restates its own: a store should be
// runnable beside a copy of the page nobody has read.
export const validId = (id) => typeof id === 'string' && /^[a-z0-9]{6,40}$/.test(id);
// A write key is 24 characters out of cloud.js's alphabet. The range is wide
// because a key is somebody's secret and this is not the place to be precious
// about the exact length; what it must not be is empty, which is the shape a
// client bug takes when it has forgotten a key and sends `?key=`.
export const validKey = (key) => typeof key === 'string' && /^[A-Za-z0-9._~-]{8,128}$/.test(key);

// The default this store advertises, and the one cloud.js assumes when a
// `/health` says nothing: 10MB, which is a generous school with a tracing
// image in it.
export const MAX_BYTES = 10 * 1024 * 1024;

// ---------- routing ----------

// A method and a URL, as far as this store cares. Nothing clever: `/health`,
// `/d/{id}`, and anything else is not here.
export function route(method, url) {
  const text = String(url || '');
  const q = text.indexOf('?');
  const path = (q < 0 ? text : text.slice(0, q)).replace(/\/+$/, '') || '/';
  const query = q < 0 ? '' : text.slice(q + 1);
  let key = '';
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== 'key') continue;
    try { key = decodeURIComponent(part.slice(eq + 1)); } catch { key = ''; }
  }
  if (path === '/health') return { kind: 'health', method, path, key };
  const m = /^\/d\/([^/]+)$/.exec(path);
  if (m) {
    let id = m[1];
    try { id = decodeURIComponent(id); } catch { /* keep it raw and fail validId */ }
    return { kind: 'design', method, path, id, key };
  }
  return { kind: 'none', method, path, key };
}

// ---------- the answer ----------

// `req` is `{ method, url, bytes, body }` and `known` is what the store has
// for that id already — `null` when nobody has claimed it, or
// `{ key, bytes, at }` when somebody has.
//
// Answers `{ status, action, headers?, json?, error? }`. `action` is what the
// plumbing has to actually do: 'read', 'write', 'delete', or nothing.
export function decide(req, known = null, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const r = route(req.method, req.url);

  // The browser asks before it PUTs, because a PUT with a JSON content-type
  // is not a simple request. A store that does not answer this is a store
  // that works perfectly from curl and not at all from the tool — which is
  // the single most likely way for a deployment of this to look broken.
  if (req.method === 'OPTIONS') {
    return { status: 204, action: 'none', preflight: true };
  }

  if (r.kind === 'health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return { status: 405, action: 'none', error: 'GET /health' };
    }
    return {
      status: 200,
      action: 'none',
      json: {
        ok: true,
        maxBytes,
        // cloud.js prints this in the panel, trimmed to 120 characters, so it
        // is the one place a person running a store can say something to the
        // people using it.
        note: String(opts.note || '').slice(0, 120),
      },
    };
  }

  if (r.kind !== 'design') return { status: 404, action: 'none', error: 'no such path' };
  // An id that is not an id is a 404 rather than a 400: there is no design at
  // that address, which is exactly what cloud.js will tell the person.
  if (!validId(r.id)) return { status: 404, action: 'none', error: 'not a design address' };

  if (req.method === 'GET' || req.method === 'HEAD') {
    // **No key, on purpose.** Anybody with the link can read it. cloud.js
    // says so in the panel and this is the line that makes it true.
    if (!known) return { status: 404, action: 'none', error: 'no design at that address' };
    return { status: 200, action: 'read', id: r.id };
  }

  if (req.method === 'PUT') {
    if (!validKey(r.key)) return { status: 403, action: 'none', error: 'no write key' };
    if (req.bytes > maxBytes) {
      return { status: 413, action: 'none', error: `past the ${maxBytes} bytes this store takes` };
    }
    if (!req.bytes) return { status: 400, action: 'none', error: 'empty design' };
    // A store that will hold anything is a file host. This one holds save
    // files, and the cheapest honest check that a body is one is that it
    // parses — which also means a truncated upload is refused at the door
    // rather than served back to somebody as a broken design later.
    if (!looksLikeJSON(req.body)) {
      return { status: 400, action: 'none', error: 'that is not a save file' };
    }
    // The first PUT claims the id; every one after it has to prove it is the
    // same browser. A mismatch is 403 and cloud.js turns that into "that
    // design belongs to another browser — save it as a copy instead", which
    // is the only sentence a person can actually act on.
    if (known && !safeEqual(known.key, r.key)) {
      return { status: 403, action: 'none', error: 'that design belongs to another browser' };
    }
    return { status: known ? 200 : 201, action: 'write', id: r.id, key: r.key, claimed: !known };
  }

  if (req.method === 'DELETE') {
    if (!validKey(r.key)) return { status: 403, action: 'none', error: 'no write key' };
    // Deleting something that was never there is not an error worth a
    // different answer than deleting something that was: either way it is
    // gone, and saying which would tell an unauthenticated caller whether an
    // id exists.
    if (!known) return { status: 404, action: 'none', error: 'no design at that address' };
    if (!safeEqual(known.key, r.key)) {
      return { status: 403, action: 'none', error: 'that design belongs to another browser' };
    }
    return { status: 200, action: 'delete', id: r.id };
  }

  return { status: 405, action: 'none', error: 'GET, PUT or DELETE' };
}

// Does this body parse as JSON? Cheap first — an object or an array is what a
// save file is, and a body that does not even start with a brace is not worth
// handing to the parser.
export function looksLikeJSON(body) {
  const text = typeof body === 'string' ? body : String(body ?? '');
  const head = text.trimStart()[0];
  if (head !== '{' && head !== '[') return false;
  try { JSON.parse(text); return true; } catch { return false; }
}

// Constant-time compare, so that a key cannot be guessed a character at a
// time off how long the answer took. Not the threat this store is under — it
// is two teachers and a link — but it is four lines, and the day somebody
// puts one of these on the internet is not the day to start thinking about
// it. The length is compared first and in the open, which leaks the length of
// a key and nothing else; every implementation of this does the same.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// ---------- what the browser needs to be allowed to ask ----------
//
// The tool is a static page on somebody else's origin, so every one of the
// four calls above is cross-origin. Without these headers the store works
// from curl and not at all from the thing it exists for.
//
// `*` rather than an origin list, and it is a deliberate reading of what this
// store is: it holds no cookies, issues no session, and authorises writes on
// a key in the query string that a browser will not send on a request the
// page did not make. There is nothing here for a same-origin policy to
// protect — the design is readable by anybody with the link by design.
export const corsHeaders = (maxAge = 86400) => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': String(maxAge),
});
