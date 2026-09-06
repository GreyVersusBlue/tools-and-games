// corepack.js — read the two inline packs out of torchbearer.html.
//
// `CORE_PACK` and `ADVENTURE_PACK` live inline in the page on purpose: the
// title screen must not depend on a network round trip that can fail, and
// js/library.js says so at length. That is right for the game and awkward for
// everything else, because the core ids are what a new pack leans on — a scene
// that hands out `healing-potion-lesser`, an encounter that reuses
// `skeleton-guard`, a background whose feat is a core skill feat. A tool that
// validates a pack against an empty registry reports every one of those as a
// broken reference.
//
// So both the test suite and authoring.html read the page's source and slice
// the literals out of it. `test/smoke.mjs` has done this since session 8 and it
// has never once been wrong; this file is that function, moved somewhere the
// browser can import it too, which means the whole suite now covers the code
// path the authoring page depends on.

/**
 * Pull a `const NAME = {...}` object literal out of the page source and return
 * it as JSON text. The two inline packs are JSON with block comments between
 * the sections, so strip those on the way past. Brace-counting and
 * string-aware: a `{` inside a description does not end the object.
 */
export function sliceLiteral(src, name) {
  const at = src.indexOf(`const ${name} = {`);
  if (at < 0) throw new Error(`${name} is not in torchbearer.html`);
  const start = src.indexOf("{", at);
  let depth = 0, inStr = false, esc = false, out = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 1; continue; }
    out += c;
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return out; }
  }
  throw new Error(`${name} is unterminated`);
}

/** Both inline packs, in load order, from the page's source text. */
export function packsIn(src) {
  return [JSON.parse(sliceLiteral(src, "CORE_PACK")), JSON.parse(sliceLiteral(src, "ADVENTURE_PACK"))];
}

/**
 * Fetch the page and return both inline packs, in load order.
 *
 * Throws with a readable message rather than returning an empty list: an
 * authoring tool silently validating against no core content would report
 * dozens of "unknown item" errors that are not the author's fault, which is
 * worse than saying the reference content could not be loaded.
 */
export async function fetchCorePacks(url) {
  let res;
  try { res = await fetch(url, { cache: "no-cache" }); }
  catch (e) { throw new Error(`Could not read ${url}. ${e.message}`); }
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}.`);
  return packsIn(await res.text());
}
