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

/**
 * The three points at which this engine's turn loop can be interrupted, and
 * the two things a reaction is allowed to do when it is.
 *
 * These are closed vocabularies for the same reason the tile names are: a
 * command whose `triggers` names a fourth event would sit in the pack looking
 * correct and never fire, which is the kind of silence a content author cannot
 * debug. `game.js` fires exactly these three names and nothing else, and
 * `smoke.mjs` asserts the two lists match.
 *
 * The names are Torchbearer's. Its `js/combat.js` shipped the same seam first
 * (its Phase 3), and the two projects agreed to spell the events the same way
 * even though locked #17 keeps them from sharing a line of code — an engine
 * that calls the moment "move-out-of-reach" and another that calls it
 * "leaves-reach" makes every future comparison an act of translation.
 */
export const REACTION_TRIGGERS = Object.freeze([
  // A Strike is about to be rolled. Fired from both sides of the board.
  "incoming-attack",
  // Someone has just stepped out of a square within the reactor's reach.
  "move-out-of-reach",
  // Damage is resolved and about to land. The last point at which it can be
  // reduced, and the only one at which the number is known.
  "incoming-damage",
]);

/** What a reaction does when it fires. */
export const REACTION_EFFECTS = Object.freeze([
  // A Strike back, at no MAP. The PC's numbers come from the command; a
  // creature's come from its own stat block, because a basalt fist is not a
  // longsword whichever feat swings it.
  "strike",
  // Reduce `ctx.dmg` by `hardness`, before a single hit point moves.
  "reduce",
]);

const KINDS = ["attack", "self-buff", "self-heal", "cone", "unerring", "consume", "reaction"];

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

  // ---- commands -------------------------------------------------------
  // Parsed before pcOptions because each build's own `commands` list is
  // validated against these ids.
  need(Array.isArray(raw.commands) && raw.commands.length, "content: commands must be a non-empty array");
  const commands = raw.commands.map(c => {
    need(c.id && c.name, "content: every command needs an id and a name");
    // A reaction costs a reaction, which is not one of the three actions, so
    // it is the one kind allowed to cost 0. Everything else is 1-3.
    const costFloor = c.kind === "reaction" ? 0 : 1;
    need(typeof c.cost === "number" && c.cost >= costFloor && c.cost <= 3,
      `content: command "${c.id}" cost must be ${costFloor}-3, got ${c.cost}`);
    const out = {
      id: c.id, name: c.name, flavour: c.flavour || "", cost: c.cost,
      costGlyph: c.costGlyph || (c.kind === "reaction" ? "↺" : "◆".repeat(c.cost)), kind: c.kind,
      hint: c.hint || "", note: c.note || "",
      target: c.target || null, agile: !!c.agile,
      spendSlot: !!c.spendSlot, spendFocus: !!c.spendFocus,
      consumes: c.consumes || null,
      attackBonus: c.attackBonus, acBonus: c.acBonus,
      coneFeet: c.coneFeet, rangeFeet: c.rangeFeet,
      save: c.save || null, damageType: c.damageType || "damage",
      // Reaction fields. Null on every other kind rather than absent, so a
      // consumer never has to ask whether the property exists first.
      triggers: null, effect: null, hardness: null, damageTypes: null,
      requiresShield: !!c.requiresShield,
    };
    if (c.damage) out.damage = parseDamage(c.damage);
    if (c.healing) out.healing = parseDamage(c.healing);
    need(KINDS.includes(out.kind),
      `content: command "${c.id}" has unknown kind "${c.kind}"`);
    if (out.kind === "attack") need(typeof out.attackBonus === "number" && out.damage,
      `content: attack command "${c.id}" needs attackBonus and damage`);
    if (out.kind === "cone") need(out.coneFeet && out.damage && out.save,
      `content: cone command "${c.id}" needs coneFeet, damage and save`);
    if (out.kind === "unerring") need(out.rangeFeet && out.damage,
      `content: unerring command "${c.id}" needs rangeFeet and damage`);
    if (out.kind === "self-heal" || out.kind === "consume") need(out.healing,
      `content: command "${c.id}" needs healing`);
    if (out.kind === "reaction") {
      need(Array.isArray(c.triggers) && c.triggers.length,
        `content: reaction command "${c.id}" needs a non-empty triggers array`);
      for (const t of c.triggers) {
        need(REACTION_TRIGGERS.includes(t),
          `content: reaction command "${c.id}" names unknown trigger "${t}" ` +
          `(known: ${REACTION_TRIGGERS.join(", ")})`);
      }
      need(REACTION_EFFECTS.includes(c.effect),
        `content: reaction command "${c.id}" needs an effect of ${REACTION_EFFECTS.join(" or ")}, got "${c.effect}"`);
      out.triggers = Object.freeze([...c.triggers]);
      out.effect = c.effect;
      if (out.effect === "strike") {
        need(typeof out.attackBonus === "number" && out.damage,
          `content: strike reaction "${c.id}" needs attackBonus and damage (a creature using it strikes with its own attack instead)`);
      }
      if (out.effect === "reduce") {
        need(typeof c.hardness === "number" && c.hardness > 0,
          `content: reduce reaction "${c.id}" needs a positive hardness`);
        out.hardness = c.hardness;
        // Absent means "any damage". Present narrows it, which is what keeps
        // Shield Block off a fire cone.
        if (c.damageTypes) {
          need(Array.isArray(c.damageTypes) && c.damageTypes.length,
            `content: reduce reaction "${c.id}" damageTypes must be a non-empty array when present`);
          out.damageTypes = Object.freeze([...c.damageTypes]);
        }
      }
    }
    return Object.freeze(out);
  });
  const commandById = Object.fromEntries(commands.map(c => [c.id, c]));
  const allCommandIds = commands.map(c => c.id);

  // ---- pcOptions --------------------------------------------------------
  // What used to be a single `pc` object is now an array of builds — this is
  // the whole point of character creation: `pcOptions[i]` is one full
  // character sheet, and `commands` on a build is which of the pack's global
  // commands that build can use (a Fighter and a Wizard read from the same
  // command list; each just gets a different slice of it). A build that omits
  // `commands` gets all of them, which is what kept a one-build pack (this
  // engine's whole history before this) working without every field present.
  need(Array.isArray(raw.pcOptions) && raw.pcOptions.length,
    "content: pcOptions must be a non-empty array");
  const pcOptions = raw.pcOptions.map(p => {
    need(p.id, "content: every pcOptions entry needs an id");
    need(typeof p.hp === "number" && p.hp > 0, `content: pcOptions "${p.id}".hp must be a positive number`);
    need(typeof p.ac === "number", `content: pcOptions "${p.id}".ac must be a number`);
    need(p.saves && ["fort", "ref", "will"].every(k => typeof p.saves[k] === "number"),
      `content: pcOptions "${p.id}" needs fort, ref and will saves`);
    const cmdIds = p.commands && p.commands.length ? p.commands : allCommandIds;
    for (const id of cmdIds) {
      need(commandById[id], `content: pcOptions "${p.id}" lists unknown command "${id}"`);
    }
    return Object.freeze({
      id: p.id,
      name: p.name || "The heir", title: p.title || "", note: p.note || "",
      blurb: p.blurb || "",
      hp: p.hp, ac: p.ac, acNote: p.acNote || "", speed: p.speed || 25,
      // How far this build threatens, for the reaction bus. Every level-1
      // weapon in this pack is 5 ft; a reach weapon would say 10 and the
      // move-out-of-reach trigger would follow it without another change.
      reachFeet: p.reachFeet || 5,
      perception: p.perception || 0, saves: { ...p.saves },
      spellDC: p.spellDC || 10, spellAttack: p.spellAttack || 0,
      slots: p.slots || 0, focus: p.focus || 0,
      commands: Object.freeze([...cmdIds]),
    });
  });
  need(new Set(pcOptions.map(p => p.id)).size === pcOptions.length,
    "content: pcOptions ids must be unique");
  const pcById = Object.fromEntries(pcOptions.map(p => [p.id, p]));

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
      reachFeet: c.reachFeet || 5,
      // Which reaction commands this creature can fire. The ids are looked up
      // in the pack's whole command list, not the chosen build's slice — a
      // creature's feats have nothing to do with which heir walked in.
      reactions: Object.freeze([...(c.reactions || [])]),
      deathLine: c.deathLine || "{name} falls.",
      wakeLine: c.wakeLine || "{name} stirs.",
      sleepLine: c.sleepLine || "{name} settles back into stillness.",
    });
  }

  for (const [id, c] of Object.entries(creatures)) {
    for (const rid of c.reactions) {
      need(commandById[rid], `content: creature "${id}" lists unknown reaction "${rid}"`);
      need(commandById[rid].kind === "reaction",
        `content: creature "${id}" lists "${rid}", which is a ${commandById[rid].kind} command, not a reaction`);
    }
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
    // `pc` here is a convenience default (the first build) for any caller that
    // has not chosen one yet. Real play always goes through `selectPc` below —
    // this is what game.js, save.js, ui.js and render.js read, and none of
    // them changed for character creation because every one of them just
    // trusts whatever `content.pc` says.
    pc: pcOptions[0],
    pcOptions: Object.freeze(pcOptions),
    pcById: Object.freeze(pcById),
    commands: Object.freeze(commands),
    commandById: Object.freeze(commandById),
    creatures: Object.freeze(creatures),
    items: Object.freeze(items),
    // Every command in the pack, by id, and it stays whole through selectPc()
    // — which narrows `commands`/`commandById` to one build. A creature's
    // reaction is looked up here for exactly that reason: the Vault Keeper
    // does not stop having Reactive Strike because the Wizard was picked.
    allCommandById: Object.freeze({ ...commandById }),
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

/**
 * Resolve a loaded pack onto one chosen build.
 *
 * Every other module in this engine (game.js, save.js, ui.js, render.js,
 * test/autopilot.mjs) reads `content.pc`, `content.commands` and
 * `content.commandById` as if there were only ever one PC — that was true for
 * two whole rounds, and staying true to it is what let character creation land
 * without touching any of those files. This function is the one place the
 * pack-with-many-builds becomes the content-with-one-pc every other module
 * still expects: `pc` becomes the chosen build, and `commands`/`commandById`
 * narrow to exactly the ids that build lists, so a Fighter cannot spend a
 * Wizard's Shield cantrip just because the definition still exists globally.
 *
 * An unknown or missing `buildId` falls back to `pcOptions[0]` rather than
 * throwing — the one case that matters in practice is a save written before
 * this feature existed, which has no `buildId` at all and always meant the
 * one build that existed then. `pcOptions[0]` has to stay that build for that
 * fallback to mean what it says; see save.js's `repair`.
 */
export function selectPc(content, buildId) {
  const pc = content.pcById[buildId] || content.pcOptions[0];
  const commands = content.commands.filter(c => pc.commands.includes(c.id));
  return Object.freeze({
    ...content,
    pc,
    commands: Object.freeze(commands),
    commandById: Object.freeze(Object.fromEntries(commands.map(c => [c.id, c]))),
  });
}

/** Browser door: fetch and parse. Relative so it works from any host path. */
export async function fetchPack(url) {
  const res = await fetch(url);
  if (!res.ok) throw new ContentError(`content: ${url} returned ${res.status}`);
  return loadPack(await res.json());
}

export { ContentError };
