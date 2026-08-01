// content.js — read a content pack, refuse a broken one, hand back a usable
// object with the strings already parsed into numbers.
//
// The rule here is the same one gvb-save applies to a save file: reject at the
// door rather than let a missing field turn into an `undefined` that multiplies
// into somebody's damage roll three modules later. An author who mistypes
// "1d6+" gets a line number's worth of complaint at load, not a sentinel that
// silently hits for nothing.
//
// Pure — no DOM, no fetch. `loadPack` takes an already-parsed object so the
// browser can fetch() it and a Node test can readFileSync it.

import { parseDamage } from "./rules.js";
import { TILE } from "./world.js";

const TILE_BY_NAME = {
  floor: TILE.FLOOR, wall: TILE.WALL, gate: TILE.GATE,
  pillar: TILE.PILLAR, treasure: TILE.TREASURE, stairs: TILE.STAIRS,
};

class ContentError extends Error {}

function need(cond, msg) {
  if (!cond) throw new ContentError(msg);
}

/**
 * Validate and normalise a parsed pack.
 *
 * Returns a frozen object. The engine never writes to content — a run's state
 * lives in game.js — so freezing it makes "the sentinel's max HP changed
 * halfway through" impossible rather than merely unlikely.
 */
export function loadPack(raw) {
  need(raw && typeof raw === "object", "content: pack is not an object");
  need(raw.pack && raw.pack.id, "content: pack.id is required");
  need(raw.pack.schema === 1, `content: pack.schema must be 1, got ${raw.pack.schema}`);

  const tuning = {
    visionFeet: 30, noticeFeet: 30, standardDC: 15,
    ...(raw.tuning || {}),
  };

  // ---- PC -------------------------------------------------------------
  const p = raw.pc;
  need(p && typeof p.hp === "number" && p.hp > 0, "content: pc.hp must be a positive number");
  need(typeof p.ac === "number", "content: pc.ac must be a number");
  need(p.saves && ["fort", "ref", "will"].every(k => typeof p.saves[k] === "number"),
    "content: pc.saves needs fort, ref and will");
  const pc = {
    name: p.name || "The heir", title: p.title || "", note: p.note || "",
    hp: p.hp, ac: p.ac, acNote: p.acNote || "", speed: p.speed || 25,
    perception: p.perception || 0, saves: { ...p.saves },
    spellDC: p.spellDC || 10, spellAttack: p.spellAttack || 0,
    slots: p.slots || 0, focus: p.focus || 0,
  };

  // ---- commands -------------------------------------------------------
  need(Array.isArray(raw.commands) && raw.commands.length, "content: commands must be a non-empty array");
  const commands = raw.commands.map(c => {
    need(c.id && c.name, "content: every command needs an id and a name");
    need(typeof c.cost === "number" && c.cost >= 1 && c.cost <= 3,
      `content: command "${c.id}" cost must be 1-3, got ${c.cost}`);
    const out = {
      id: c.id, name: c.name, flavour: c.flavour || "", cost: c.cost,
      costGlyph: c.costGlyph || "◆".repeat(c.cost), kind: c.kind,
      hint: c.hint || "", note: c.note || "",
      target: c.target || null, agile: !!c.agile,
      spendSlot: !!c.spendSlot, spendFocus: !!c.spendFocus,
      consumes: c.consumes || null,
      attackBonus: c.attackBonus, acBonus: c.acBonus,
      coneFeet: c.coneFeet, rangeFeet: c.rangeFeet,
      save: c.save || null, damageType: c.damageType || "damage",
    };
    if (c.damage) out.damage = parseDamage(c.damage);
    if (c.healing) out.healing = parseDamage(c.healing);
    need(["attack", "self-buff", "self-heal", "cone", "unerring", "consume"].includes(out.kind),
      `content: command "${c.id}" has unknown kind "${c.kind}"`);
    if (out.kind === "attack") need(typeof out.attackBonus === "number" && out.damage,
      `content: attack command "${c.id}" needs attackBonus and damage`);
    if (out.kind === "cone") need(out.coneFeet && out.damage && out.save,
      `content: cone command "${c.id}" needs coneFeet, damage and save`);
    if (out.kind === "unerring") need(out.rangeFeet && out.damage,
      `content: unerring command "${c.id}" needs rangeFeet and damage`);
    if (out.kind === "self-heal" || out.kind === "consume") need(out.healing,
      `content: command "${c.id}" needs healing`);
    return Object.freeze(out);
  });

  // ---- creatures ------------------------------------------------------
  need(raw.creatures && typeof raw.creatures === "object", "content: creatures must be an object");
  const creatures = {};
  for (const [id, c] of Object.entries(raw.creatures)) {
    need(typeof c.hp === "number" && c.hp > 0, `content: creature "${id}" needs a positive hp`);
    need(typeof c.ac === "number", `content: creature "${id}" needs an ac`);
    need(c.saves && ["fort", "ref", "will"].every(k => typeof c.saves[k] === "number"),
      `content: creature "${id}" needs fort, ref and will saves`);
    creatures[id] = Object.freeze({
      id, name: c.name || id, level: c.level ?? 0,
      hp: c.hp, ac: c.ac, perception: c.perception || 0,
      // The Fourth Quarter shipped a saved staffer with no walking speed and
      // multiplied the undefined straight into metres per second (v7 §2). A
      // creature with no Speed here would path zero feet and stand still
      // forever, which reads as a broken game rather than an error.
      speed: c.speed || 25,
      saves: { ...c.saves },
      attackBonus: c.attackBonus ?? 0,
      attackName: c.attackName || "Strike",
      damage: parseDamage(c.damage),
      damageType: c.damageType || "damage",
      deathLine: c.deathLine || "{name} falls.",
      wakeLine: c.wakeLine || "{name} stirs.",
      sleepLine: c.sleepLine || "{name} settles back into stillness.",
    });
  }

  // ---- items ----------------------------------------------------------
  need(Array.isArray(raw.items), "content: items must be an array");
  const items = {};
  for (const it of raw.items) {
    need(it.id && it.name, "content: every item needs an id and a name");
    need(it.bulk === "L" || typeof it.bulk === "number",
      `content: item "${it.id}" bulk must be a number or "L"`);
    items[it.id] = Object.freeze({ id: it.id, name: it.name, glyph: it.glyph || "▪", bulk: it.bulk });
  }
  const startingInventory = (raw.startingInventory || []).map(id => {
    need(items[id], `content: startingInventory names unknown item "${id}"`);
    return id;
  });

  // ---- lore -----------------------------------------------------------
  const lore = {};
  for (const [id, l] of Object.entries(raw.lore || {})) {
    need(l.title && Array.isArray(l.body), `content: lore "${id}" needs a title and a body array`);
    lore[id] = Object.freeze({ id, title: l.title, body: [...l.body], logLine: l.logLine || "" });
  }

  // ---- areas ------------------------------------------------------------
  // `raw.areas` is an object keyed by area id; `raw.startArea` names the one
  // the PC begins in. A legend entry whose tile is "stairs" needs a `to`
  // naming the destination area and square — validated in a second pass below
  // once every area has been parsed, so a stairway can point forward at an
  // area declared later in the file.
  need(raw.areas && typeof raw.areas === "object" && Object.keys(raw.areas).length,
    "content: areas must be a non-empty object, keyed by area id");
  need(raw.startArea && raw.areas[raw.startArea], "content: startArea must name a defined area");

  const areas = {};
  for (const [areaId, a] of Object.entries(raw.areas)) {
    need(a && Array.isArray(a.rows) && a.rows.length,
      `content: area "${areaId}".rows must be a non-empty array`);
    need(a.legend && typeof a.legend === "object", `content: area "${areaId}".legend is required`);
    const height = a.rows.length;
    const width = a.rows[0].length;
    a.rows.forEach((r, i) => need(r.length === width,
      `content: area "${areaId}" row ${i} is ${r.length} wide, expected ${width}`));

    const tiles = [];
    const pillars = {};          // "x,y" -> lore id
    const placements = [];       // { creature, x, y, wakesOn }
    const stairs = {};           // "x,y" -> { area, x, y }
    let pcSpawn = null;

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const ch = a.rows[y][x];
        const def = a.legend[ch];
        need(def, `content: area "${areaId}" row ${y} column ${x} uses "${ch}", which is not in the legend`);
        const t = TILE_BY_NAME[def.tile];
        need(t !== undefined, `content: area "${areaId}" legend "${ch}" has unknown tile "${def.tile}"`);
        row.push(t);
        if (def.lore) {
          need(lore[def.lore], `content: area "${areaId}" legend "${ch}" points at unknown lore "${def.lore}"`);
          pillars[x + "," + y] = def.lore;
        }
        if (def.creature) {
          need(creatures[def.creature],
            `content: area "${areaId}" legend "${ch}" points at unknown creature "${def.creature}"`);
          placements.push({ creature: def.creature, x, y, wakesOn: def.wakesOn || "notice" });
        }
        if (def.spawn === "pc") pcSpawn = { x, y };
        if (def.tile === "stairs") {
          need(def.to && typeof def.to.area === "string"
            && typeof def.to.x === "number" && typeof def.to.y === "number",
            `content: area "${areaId}" legend "${ch}" is stairs and needs a "to": {area, x, y}`);
          stairs[x + "," + y] = { area: def.to.area, x: def.to.x, y: def.to.y };
        }
      }
      tiles.push(row);
    }
    if (areaId === raw.startArea) {
      need(pcSpawn, `content: the start area "${areaId}" has no pc spawn — mark one square with spawn "pc"`);
    }
    need(placements.length, `content: area "${areaId}" places no creatures`);
    for (const pl of placements) {
      need(["notice", "gate-opened"].includes(pl.wakesOn),
        `content: area "${areaId}" creature placement at ${pl.x},${pl.y} has unknown wakesOn "${pl.wakesOn}"`);
    }

    areas[areaId] = Object.freeze({
      id: areaId, name: a.name || areaId, width, height,
      tiles: Object.freeze(tiles.map(r => Object.freeze(r))),
      pillars: Object.freeze(pillars),
      placements: Object.freeze(placements.map(Object.freeze)),
      pcSpawn: pcSpawn ? Object.freeze(pcSpawn) : null,
      stairs: Object.freeze(stairs),
    });
  }

  // Second pass: a stairway's destination area and square must actually
  // exist. Nothing above can check this while areas are still being built,
  // since a stairway is allowed to point at an area declared later in the
  // object.
  for (const a of Object.values(areas)) {
    for (const [k, dest] of Object.entries(a.stairs)) {
      need(areas[dest.area], `content: area "${a.id}" stairs at ${k} point at unknown area "${dest.area}"`);
      const target = areas[dest.area];
      need(dest.x >= 0 && dest.y >= 0 && dest.x < target.width && dest.y < target.height,
        `content: area "${a.id}" stairs at ${k} land outside area "${dest.area}"`);
    }
  }

  const areaOrder = raw.areaOrder || Object.keys(areas);
  need(Array.isArray(areaOrder) && areaOrder.every(id => areas[id]),
    "content: areaOrder must list only defined area ids");

  // ---- gate and treasure ----------------------------------------------
  const gate = { requiresLore: [], restore: [], ...(raw.gate || {}) };
  for (const id of gate.requiresLore) {
    need(lore[id], `content: gate.requiresLore names unknown lore "${id}"`);
  }
  const treasure = { requiresDown: [], body: [], ...(raw.treasure || {}) };
  for (const id of treasure.requiresDown) {
    need(creatures[id], `content: treasure.requiresDown names unknown creature "${id}"`);
  }

  return Object.freeze({
    pack: Object.freeze({ ...raw.pack }),
    tuning: Object.freeze(tuning),
    pc: Object.freeze(pc),
    commands: Object.freeze(commands),
    commandById: Object.freeze(Object.fromEntries(commands.map(c => [c.id, c]))),
    creatures: Object.freeze(creatures),
    items: Object.freeze(items),
    startingInventory: Object.freeze(startingInventory),
    inventorySlots: raw.inventorySlots || 8,
    bulkLimit: raw.bulkLimit ?? 5,
    bulkLimitNote: raw.bulkLimitNote || "",
    lore: Object.freeze(lore),
    areas: Object.freeze(areas),
    startArea: raw.startArea,
    areaOrder: Object.freeze(areaOrder),
    gate: Object.freeze(gate),
    treasure: Object.freeze(treasure),
    defeat: Object.freeze({ title: "Defeated", body: [], ...(raw.defeat || {}) }),
    intro: Object.freeze({ narrative: "", goal: "", hint: "", ...(raw.intro || {}) }),
  });
}

/** Browser door: fetch and parse. Relative so it works from any host path. */
export async function fetchPack(url) {
  const res = await fetch(url);
  if (!res.ok) throw new ContentError(`content: ${url} returned ${res.status}`);
  return loadPack(await res.json());
}

export { ContentError };
