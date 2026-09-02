// share.js — a design, compressed into a link.
//
// Phase 9's third item, and the one that prices the no-server stance most
// explicitly: cloud saves are the grown-up version of this and the first
// thing on the whole wishlist that needs a backend. This is what you can have
// without one — the design itself in the URL, after the `#`, which is the one
// part of a URL a browser never sends to a server. Paste the link into a
// message and the person who opens it has your school; nothing was uploaded,
// nothing expires, and there is nothing to take down.
//
// The bargain, stated plainly so the UI can quote it:
//
//   - The payload is deflate-raw'd JSON in base64url. `CompressionStream` is
//     platform, not a dependency — which is the whole reason this fits the
//     no-deps stance — and it is asynchronous, which is why every function
//     here that touches it returns a promise.
//   - A school's JSON compresses hard (it is mostly repeated small objects),
//     so a generated three-storey school lands in a few kilobytes. A design
//     carrying a tracing image or an imported model does not, which is why
//     both are dropped before encoding rather than quietly blowing past a
//     limit nobody stated.
//   - Long links break in the middle in some chat clients and get truncated
//     by some mail gateways, so there are two thresholds rather than one: a
//     comfortable size that goes anywhere, and a hard cap past which this
//     refuses and says to use a save file instead.
//
// The tag on the front of the payload is a version, and it exists so that the
// day this switches to a better codec, today's links still open.

// What fits everywhere without being mangled. Past this a link still works in
// every current browser — the cap below is the real limit — but it is long
// enough that a chat client may wrap it, so the UI says so.
import { FRAGMENT_KEYS, fragmentValue } from './fragment.js';

export const COMFORT_CHARS = 8000;
// The hard refusal. Browsers themselves manage far more, but a link this long
// has stopped being a link.
export const MAX_CHARS = 60000;

// The fragment key. `#s=` rather than a bare fragment so an anchor, a
// future second key, and this can share the hash.
export const SHARE_KEY = FRAGMENT_KEYS.share;

const TAG_DEFLATE = 'z1';
const TAG_PLAIN = 'u1';

// ---------- base64url ----------

export function bytesToBase64url(bytes) {
  let s = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- compression ----------

export const canCompress = () =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipeThrough(bytes, stream) {
  const writer = stream.writable.getWriter();
  // The write and the close are deliberately not awaited — the whole payload
  // goes in before anything comes out — but a corrupt payload errors the
  // *stream*, which rejects both of those promises as well as the read. They
  // are swallowed here so the read below is the single place a bad link is
  // reported, rather than an unhandled rejection racing it.
  const ignore = () => {};
  writer.write(bytes).catch(ignore);
  writer.close().catch(ignore);
  const chunks = [];
  const reader = stream.readable.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export const deflate = (bytes) => pipeThrough(bytes, new CompressionStream('deflate-raw'));
export const inflate = (bytes) => pipeThrough(bytes, new DecompressionStream('deflate-raw'));

// ---------- the payload ----------

// Text in, `tag.payload` out. Falls back to uncompressed base64url where
// `CompressionStream` is missing, which costs about a third more characters
// and is still a working link.
export async function encodeShare(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (!canCompress()) return `${TAG_PLAIN}.${bytesToBase64url(bytes)}`;
  const packed = await deflate(bytes);
  // A payload that compresses *worse* than it started (already-compressed
  // bytes, or a design small enough that the deflate header dominates) goes
  // out plain — nobody should get a longer link for having used the codec.
  if (packed.length >= bytes.length) return `${TAG_PLAIN}.${bytesToBase64url(bytes)}`;
  return `${TAG_DEFLATE}.${bytesToBase64url(packed)}`;
}

export async function decodeShare(payload) {
  const text = String(payload || '').trim();
  const dot = text.indexOf('.');
  if (dot < 0) throw new Error('This link is not a shared design');
  const tag = text.slice(0, dot);
  const body = text.slice(dot + 1);
  if (!body) throw new Error('This link is not a shared design');
  let bytes;
  try {
    bytes = base64urlToBytes(body);
  } catch {
    throw new Error('This link is damaged — it may have been cut short');
  }
  if (tag === TAG_PLAIN) return new TextDecoder().decode(bytes);
  if (tag !== TAG_DEFLATE) throw new Error(`This link was made by a newer version (${tag})`);
  if (!canCompress()) throw new Error('This browser cannot open compressed links');
  let out;
  try {
    out = await inflate(bytes);
  } catch {
    throw new Error('This link is damaged — it may have been cut short');
  }
  return new TextDecoder().decode(out);
}

// ---------- fragments and links ----------

export const shareFragment = (payload) => `#${SHARE_KEY}=${payload}`;

// The payload out of a `location.hash`, or null for an ordinary one. Written
// against the string rather than against `URL` so it can be tested headless
// and so a hash this build didn't write can't throw.
export const readShareFragment = (hash) => fragmentValue(hash, SHARE_KEY);

// A whole link. The current page's query string goes with it (it may name the
// build), the current fragment does not — a share link replaces a share link
// rather than stacking on it.
export function shareURL(href, payload) {
  const base = String(href || '');
  const cut = base.indexOf('#');
  return `${cut < 0 ? base : base.slice(0, cut)}${shareFragment(payload)}`;
}

// ---------- what to tell the person clicking Share ----------

export function shareStatus(payload, href = '') {
  const chars = String(payload || '').length + String(href || '').length + SHARE_KEY.length + 2;
  const kb = chars / 1024;
  if (chars > MAX_CHARS) {
    return {
      chars, kb, ok: false, comfortable: false,
      note: `This design needs ${Math.round(kb)} KB of link, past the ${Math.round(MAX_CHARS / 1024)} KB limit — save a file and send that instead.`,
    };
  }
  if (chars > COMFORT_CHARS) {
    return {
      chars, kb, ok: true, comfortable: false,
      note: `${Math.round(kb)} KB of link — long enough that some chat apps will cut it. Copy it as a link, not as text.`,
    };
  }
  return { chars, kb, ok: true, comfortable: true, note: `${Math.round(kb * 10) / 10} KB of link — short enough to paste anywhere.` };
}

// What a design gives up to fit in a link, so the dialog can say it before
// the link is made rather than after somebody has sent it. Both of these are
// the megabyte-sized records: a tracing image and imported model files.
export function shareOmissions(state) {
  const out = [];
  if (state && state.overlay) out.push('the tracing image');
  const models = state && Array.isArray(state.models) ? state.models.length : 0;
  if (models) out.push(models === 1 ? 'one imported model' : `${models} imported models`);
  return out;
}

export function omissionNote(state) {
  const omitted = shareOmissions(state);
  if (!omitted.length) return '';
  const list = omitted.length === 1 ? omitted[0] : `${omitted.slice(0, -1).join(', ')} and ${omitted[omitted.length - 1]}`;
  return `A link cannot carry ${list} — everything else travels.`;
}
