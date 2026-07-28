// library.js — the bundled content packs, reachable from inside the game.
//
// Two finished packs shipped in this repo for a year and the page never
// mentioned them. Nothing in torchbearer.html referenced the folder, so the
// only way to play "The Long Vigil at Thornwake Bridge" was to know it existed,
// find it on GitHub, download the raw JSON, and hand it to the file picker. A
// platform whose sample content can only be loaded that way is a platform
// nobody tries.
//
// This is progressive enhancement on purpose. The manifest is fetched after
// the title screen is already up and interactive; if the fetch fails — opened
// over file://, offline, a 404 — the library section hides itself and Load
// Content JSON is still there. The engine's own CORE_PACK and ADVENTURE_PACK
// stay inline in the HTML so booting never depends on a request.
//
// Paths resolve from this module, not from whichever page imported it, so
// moving torchbearer.html doesn't break the library.

const MANIFEST_URL = new URL("../packs/index.json", import.meta.url);

/** Fetch the manifest. Returns [] rather than throwing — see the note above. */
export async function fetchLibrary() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.packs) ? data.packs.filter(p => p && p.file && p.id) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Fetch one pack's full JSON. Throws with a readable message — unlike the
 * manifest, this one is a response to a click and the player deserves to know
 * why nothing happened.
 */
export async function fetchPack(entry) {
  const url = new URL(entry.file, MANIFEST_URL);
  let res;
  try { res = await fetch(url, { cache: "no-cache" }); }
  catch (e) { throw new Error(`Could not reach ${entry.file}. ${e.message}`); }
  if (!res.ok) throw new Error(`${entry.file} returned HTTP ${res.status}.`);
  try { return await res.json(); }
  catch (e) { throw new Error(`${entry.file} is not valid JSON. ${e.message}`); }
}
