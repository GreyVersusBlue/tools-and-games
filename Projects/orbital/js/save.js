// Orbital: the save. One slot through the site's gvb-save.js, on the key the
// game has always had, `orbital_progress_v2`, never to be renamed (locked
// decision #36). It holds one object, level key to the fewest attempts that
// level was won in ("basics#0": 1); the stars are worked out from that number
// and nothing mid-flight is saved.
//
// A save written before the slot (2026-10-07) is the bare object with no
// `__v`. It reads as version 0, takes `migrate`, which has nothing to do, and
// comes out of `repair` as the object it went in as. The slot's version is 2
// because the key says 2; there has been no file format before this one.
//
// `migrate` is for version drift; `repair` runs on every load and on every
// imported file (#37). The one older shape, `orbital_progress_v1`, is another
// key and not another version, so it is read here and not in `migrate`.
//
// An ES module, and the only one on the page. index.html loads it ahead of
// game.js, and every script there is `defer`, so this has run and left
// `OrbitalSave` on the window by the time game.js asks for the save.

import { createSaveSlot, mountSaveBar } from "../../../assets/js/gvb-save.js";

export const SAVE_KEY = "orbital_progress_v2";
export const SAVE_VERSION = 2;
const OLD_KEY = "orbital_progress_v1";

const isRecord = s => !!s && typeof s === "object" && !Array.isArray(s);

// An attempt count is a whole number from 1 up. Anything else under a key is
// dropped, so a hand-edited file cannot put NaN stars on the sector map. A key
// this build has no level for is kept: a pack that is not loaded today may be
// tomorrow, which is what saving by key was for.
export function repair(state) {
  const out = {};
  for (const [k, v] of Object.entries(isRecord(state) ? state : {})) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 1) out[k] = Math.floor(v);
  }
  return out;
}

export function makeSlot(options = {}) {
  return createSaveSlot({
    game: "orbital", key: SAVE_KEY, version: SAVE_VERSION,
    defaults: {}, validate: isRecord, repair,
    ...options,
  });
}

// The first build saved under `orbital_progress_v1`, keyed by a level's plain
// index, when Basics was the only pack. It is read when the v2 key holds
// nothing readable and is not written back until the next win, as before.
function readOld(storage) {
  try {
    const old = JSON.parse(storage.getItem(OLD_KEY) || "null");
    if (!isRecord(old)) return null;
    const mig = {};
    for (const k in old) if (/^\d+$/.test(k)) mig["basics#" + k] = old[k];
    return repair(mig);
  } catch (e) { return null; }
}

/** What game.js starts from: the v2 save, else the v1 one carried over, else nothing. */
export function loadProgress(slot, storage) {
  return slot.load() ?? (storage ? readOld(storage) : null) ?? slot.fresh();
}

// The bar is Export and Import only: the sector map has had its own "Reset
// progress" since before this, and two buttons that wipe a save do not sit
// side by side.
export function mountBar(container, slot, handlers) {
  return mountSaveBar(container, slot, { buttons: ["export", "import"], ...handlers });
}

if (typeof window !== "undefined") {
  let storage = null;
  try { storage = window.localStorage; } catch (e) { /* blocked: the slot falls back to memory */ }
  const slot = makeSlot();
  window.OrbitalSave = {
    slot,
    load: () => loadProgress(slot, storage),
    save: o => slot.save(o),
    mountBar: (container, handlers) => mountBar(container, slot, handlers),
  };
}
