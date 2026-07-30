// save.js — this game's slot on the shared save system.
//
// Relative import, not "/assets/js/gvb-save.js": test/smoke.mjs imports this
// module under plain Node, which cannot resolve a site-absolute specifier. The
// relative form behaves identically in the browser.
import { createSaveSlot } from "../../../assets/js/gvb-save.js";
import { LOG_SAVED } from "./game.js";
import { TILE } from "./world.js";

/**
 * THE STORAGE KEY. Locked decision #36: this is the name it keeps forever.
 * Changing it silently abandons everyone mid-run. It follows the convention
 * Integer Foundry and Aphelion already use — `<slug>-save-v1`.
 */
export const SAVE_KEY = "absalom-inheritance-save-v1";

/** Bump only when the shape changes in a way `repair` cannot cover. */
export const SAVE_VERSION = 1;

/** The gate on garbage: the fields nothing downstream can work without. */
export function validRun(s) {
  return !!s
    && typeof s === "object"
    && !!s.pc && typeof s.pc.hp === "number" && typeof s.pc.x === "number" && typeof s.pc.y === "number"
    && Array.isArray(s.creatures)
    && Array.isArray(s.inventory);
}

/**
 * Fill in what a save can be missing, and clamp what it can get wrong.
 *
 * This runs on every accepted load — localStorage, an imported file, a save
 * this build wrote thirty seconds ago (locked decision #37). It is not the
 * place for version-specific reshaping; that is `migrate`, and there is
 * nothing in it yet because version 1 is the first version.
 *
 * The bug class it exists for, from v7 §2: The Fourth Quarter loaded a staffer
 * saved before roles existed, filled in `role` and `skill`, missed `speed`, and
 * multiplied `undefined` into metres per second. No crash, no error — an NPC
 * that walked nowhere forever. The CRPG equivalent is a creature saved before a
 * resistance, a condition, or a Speed existed. So every field below is filled
 * from content rather than assumed present, including the ones that cannot be
 * missing today, because the whole point is the version where they can.
 */
export function makeRepair(content) {
  const { area } = content;
  const clampInt = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  };

  /** Somewhere a body can actually stand. */
  const standable = (x, y, gateOpen) => {
    if (x < 0 || y < 0 || x >= area.width || y >= area.height) return false;
    const t = area.tiles[y][x];
    if (t === TILE.WALL || t === TILE.PILLAR) return false;
    if (t === TILE.GATE && !gateOpen) return false;
    return true;
  };

  return function repairRun(s) {
    s.packId ??= content.pack.id;
    s.areaId ??= area.id;

    // --- progress flags, first, because where the PC may legally stand depends
    // on whether the gate is open ---
    s.loreRead = (s.loreRead || []).filter(id => content.lore[id]);
    s.gateOpen = !!s.gateOpen
      || (content.gate.requiresLore.length > 0
        && content.gate.requiresLore.every(id => s.loreRead.includes(id)));

    // --- the PC ---
    // Clamping a wild coordinate into bounds is not enough: x=900 clamps to the
    // border wall, and a PC inside a wall cannot path anywhere ever again. Any
    // position that is not somewhere a body can stand goes back to the spawn.
    s.pc.x = clampInt(s.pc.x, 0, area.width - 1, area.pcSpawn.x);
    s.pc.y = clampInt(s.pc.y, 0, area.height - 1, area.pcSpawn.y);
    if (!standable(s.pc.x, s.pc.y, s.gateOpen)) {
      s.pc.x = area.pcSpawn.x;
      s.pc.y = area.pcSpawn.y;
    }
    s.pc.hp = clampInt(s.pc.hp, 0, content.pc.hp, content.pc.hp);
    s.pc.slots = clampInt(s.pc.slots, 0, content.pc.slots, content.pc.slots);
    s.pc.focus = clampInt(s.pc.focus, 0, content.pc.focus, content.pc.focus);

    // --- creatures ---
    // A save can name a creature the current content no longer defines (the
    // pack was edited between sessions). Dropping it is right: the alternative
    // is a walking `undefined` in every damage roll it makes.
    s.creatures = (s.creatures || []).filter(c => c && content.creatures[c.creature]);
    const placed = new Map(area.placements.map(p => [`${p.creature}@${p.x},${p.y}`, p]));
    for (const c of s.creatures) {
      const d = content.creatures[c.creature];
      c.key ??= `${c.creature}@${c.x},${c.y}`;
      c.wakesOn = placed.get(c.key)?.wakesOn ?? c.wakesOn ?? "notice";
      const home = placed.get(c.key);
      c.x = clampInt(c.x, 0, area.width - 1, home?.x ?? area.pcSpawn.x);
      c.y = clampInt(c.y, 0, area.height - 1, home?.y ?? area.pcSpawn.y);
      // Same trap as the PC: a creature clamped into masonry never Strides again,
      // and a dungeon whose guard is stuck in a wall reads as a broken game.
      if (!standable(c.x, c.y, s.gateOpen) && home) { c.x = home.x; c.y = home.y; }
      c.hp = clampInt(c.hp, 0, d.hp, d.hp);
      c.dead = !!c.dead || c.hp === 0;
      c.awake = !!c.awake && !c.dead;
    }
    // A placement the save never mentioned — a creature added to the pack after
    // this run started — arrives dormant and at full HP rather than not at all.
    for (const [key, p] of placed) {
      if (s.creatures.some(c => c.key === key)) continue;
      s.creatures.push({
        key, creature: p.creature, wakesOn: p.wakesOn, x: p.x, y: p.y,
        hp: content.creatures[p.creature].hp, awake: false, dead: false,
      });
    }

    // A gate that is open has already released whatever it was holding shut.
    if (s.gateOpen) {
      for (const c of s.creatures) if (c.wakesOn === "gate-opened" && !c.dead) c.wakesOn = "notice";
    }

    if (typeof s.explored !== "string" || s.explored.length !== area.width * area.height) {
      // Wrong length means the area changed shape under the save. Forgetting the
      // map is survivable; indexing a bitfield with the wrong stride is not.
      s.explored = "";
    }

    // --- inventory ---
    s.inventory = (s.inventory || [])
      .filter(i => i && content.items[i.item])
      .map((i, n) => ({ item: i.item, slot: clampInt(i.slot, 0, content.inventorySlots - 1, n) }));
    // Two items in one slot renders as one item and silently loses the other.
    const taken = new Set();
    for (const i of s.inventory) {
      while (taken.has(i.slot)) i.slot = (i.slot + 1) % content.inventorySlots;
      taken.add(i.slot);
    }

    // --- the rest ---
    s.log = Array.isArray(s.log)
      ? s.log.filter(e => e && typeof e.text === "string").slice(-LOG_SAVED)
      : [];
    s.stats = { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, ...(s.stats || {}) };
    if (!["victory", "defeat", null, undefined].includes(s.outcome)) s.outcome = null;
    s.outcome ??= null;
    // Dead is dead: a save at 0 HP with no outcome would boot into a playable
    // corpse.
    if (s.pc.hp === 0 && !s.outcome) s.outcome = "defeat";

    return s;
  };
}

/**
 * Build the slot. Pass a storage stub in tests; pass nothing in the browser and
 * let gvb-save probe for itself — reading the `localStorage` property throws
 * outright where storage is blocked, which is the case its memory fallback
 * exists to survive.
 */
export function makeSaveSlot(content, storage) {
  return createSaveSlot({
    game: "absalom-inheritance",
    key: SAVE_KEY,
    version: SAVE_VERSION,
    storage,
    validate: validRun,
    repair: makeRepair(content),
    // Character generation is not randomised today, but the starting state is
    // still derived from the content pack rather than a literal, and a factory
    // is what keeps `slot.reset()` from handing back a shared object every
    // caller can scribble on. Passing a literal here is how The Fourth Quarter's
    // reset() ended up returning null (v7 §1).
    defaults: () => freshRun(content),
  });
}

/** A brand-new run, straight from the content pack. */
export function freshRun(content) {
  return {
    packId: content.pack.id,
    areaId: content.area.id,
    pc: {
      x: content.area.pcSpawn.x, y: content.area.pcSpawn.y,
      hp: content.pc.hp, slots: content.pc.slots, focus: content.pc.focus,
    },
    creatures: content.area.placements.map(p => ({
      key: `${p.creature}@${p.x},${p.y}`, creature: p.creature, wakesOn: p.wakesOn,
      x: p.x, y: p.y, hp: content.creatures[p.creature].hp, awake: false, dead: false,
    })),
    loreRead: [],
    gateOpen: false,
    explored: "",
    inventory: content.startingInventory.map((item, slot) => ({ item, slot })),
    log: [],
    stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0 },
    outcome: null,
  };
}
