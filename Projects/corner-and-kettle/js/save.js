// save.js — Corner & Kettle's save layer, on top of the shared gvb-save module.
//
// Split out of coffee_shop_sim.html so a Node test can import it. The page
// itself is still one file; only the save schema lives here, because the save
// schema is the part with rules worth asserting.
//
// Imported by RELATIVE path so `node test/smoke-save.mjs` can resolve it.
// A leading slash is a browser-only convenience Node refuses.

import { createSaveSlot } from "../../../assets/js/gvb-save.js";

/** Never change this (locked decision #36). Unversioned saves read as v0. */
export const SAVE_KEY = "cornerKettleSave_v1";
export const SAVE_VERSION = 1;
export const GAME_SLUG = "corner-and-kettle";

/** Highest index `LOYALTY_UPGRADES[level-1]` may be asked for. */
export const LOYALTY_MAX = 2;
export const SHIELD_MAX = 3;
export const STATION_MIN = 2;
export const STATION_MAX = 4;
export const BARISTA_CAP = 3;

/* ---------- small coercers ---------- */

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const intIn = (v, lo, hi, fallback) =>
  Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : fallback;
const strOrNull = v => (typeof v === "string" ? v : null);
const strList = (v, allowed) => {
  if (!Array.isArray(v)) return [];
  const out = v.filter(x => typeof x === "string" && (!allowed || allowed.has(x)));
  return [...new Set(out)];
};

/**
 * What the game persists. Everything else — the queue, the cups on the
 * counter, the clock, today's stats — is deliberately not saved: a reload
 * reopens the shop at Dawn on the same day.
 */
export function freshSaveData(catalog) {
  return {
    day: 1,
    money: 60,
    unlockedRecipes: [...catalog.starting.recipes],
    unlockedSyrups: [...catalog.starting.syrups],
    unlockedToppings: [...catalog.starting.toppings],
    unlockedFoods: [...catalog.starting.foods],
    stationCount: STATION_MIN,
    muted: false,
    regulars: {},
    baristas: [],
    loyaltyLevel: 0,
    comboShields: 0,
    shieldsPurchased: 0,
    presets: [],
    reputation: 50,
    upgrades: [],
    prestigeLevel: 0,
    dailyModifierId: null,
    eventFiredThisShift: false,
    // Rolled by repairSave, which every fresh state goes through too — so
    // fresh() and load() can't hand back differently-shaped objects.
    eventTriggerAt: null,
  };
}

/**
 * Is this plausibly a Corner & Kettle save at all?
 *
 * Deliberately narrow: three fields every save this game has ever written
 * carries. Anything that fails here is refused outright rather than repaired,
 * which is the whole point — `repair` below is forgiving enough that without a
 * real gate here a stray JSON file would boot as a coffee shop.
 */
export function validateSave(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (!Number.isFinite(s.day) || s.day < 1) return false;
  if (!Number.isFinite(s.money)) return false;
  if (!Array.isArray(s.unlockedRecipes)) return false;
  return true;
}

/**
 * Version drift only (locked decision #37).
 *
 * There is exactly one historical reshape: before staff were a list, a save
 * carried a single `baristaLevel` number. Everything else that an old save is
 * missing is a fill-in, and fill-ins live in `repair`.
 */
export function migrateSave(s, from, catalog) {
  if (from < 1 && !Array.isArray(s.baristas) && Number.isFinite(s.baristaLevel) && s.baristaLevel > 0) {
    s.baristas = [{
      id: "b_migrated",
      name: catalog.baristaNames[0],
      level: s.baristaLevel >= 2 ? 2 : 1,
      spec: null,
      trained: false,
      working: true,
    }];
    delete s.baristaLevel;
  }
  return s;
}

/* ---------- the nested repairs ---------- */

/**
 * A saved cup. `shots` is the field that matters: it is the only number in a
 * preset, `applyPreset` copies it straight onto the live cup, and the Base
 * station does `cup.shots++`. An `undefined` there becomes NaN on the first
 * click, `NaN >= 1` is false forever, and the ticket's base line can never be
 * ticked off — no error, no crash, just a drink the player cannot finish.
 * Same shape as the Fourth Quarter's staffer with no walking speed (v7 §2).
 */
function repairCup(cup, catalog) {
  const c = cup && typeof cup === "object" ? cup : {};
  const base = strOrNull(c.base);
  return {
    base: base && catalog.bases.has(base) ? base : null,
    shots: intIn(c.shots, 0, 9, 0),
    milk: catalog.milks.has(c.milk) ? c.milk : null,
    milkSteamed: !!c.milkSteamed,
    syrup: catalog.syrups.has(c.syrup) ? c.syrup : null,
    toppings: strList(c.toppings, catalog.toppings),
    ice: !!c.ice,
    blended: !!c.blended,
  };
}

/**
 * A named regular's standing order. Stored once and replayed every time they
 * walk in, so a malformed one is a crash that repeats: `cloneOrderContent`
 * spreads `content.custom.toppings`, and that runs inside `generateOrder()`
 * inside the requestAnimationFrame loop. One bad regular takes the whole loop
 * down on the next spawn. Returns null for anything unusable — dropping a
 * regular costs the player a favourite, not a shop.
 */
function repairRegular(content, catalog) {
  if (!content || typeof content !== "object") return null;
  // `food` was the flag's name before `isFood`; accept both.
  const isFood = !!(content.isFood || content.food);
  if (isFood) {
    if (!catalog.foods.has(content.foodId)) return null;
    return { isFood: true, foodId: content.foodId, price: num(content.price, 0) };
  }
  if (!catalog.recipes.has(content.recipeId)) return null;
  const custom = content.custom && typeof content.custom === "object" ? content.custom : {};
  return {
    isFood: false,
    recipeId: content.recipeId,
    price: num(content.price, 0),
    custom: {
      milk: catalog.milks.has(custom.milk) ? custom.milk : undefined,
      syrup: catalog.syrups.has(custom.syrup) ? custom.syrup : undefined,
      toppings: strList(custom.toppings, catalog.toppings),
      ice: !!custom.ice,
    },
  };
}

function repairBarista(b, catalog, index) {
  if (!b || typeof b !== "object") return null;
  return {
    id: typeof b.id === "string" && b.id ? b.id : "b_repaired_" + index,
    name: typeof b.name === "string" && b.name ? b.name : catalog.baristaNames[index % catalog.baristaNames.length],
    level: b.level === 2 ? 2 : 1,
    spec: b.spec === "bar" || b.spec === "kitchen" ? b.spec : null,
    trained: !!b.trained,
    working: b.working !== false,
  };
}

function repairPreset(p, catalog, index) {
  if (!p || typeof p !== "object") return null;
  return {
    id: typeof p.id === "string" && p.id ? p.id : "p_repaired_" + index,
    name: typeof p.name === "string" && p.name ? p.name.slice(0, 24) : "Preset " + (index + 1),
    cup: repairCup(p.cup, catalog),
  };
}

/**
 * Runs on every accepted load, from every door: localStorage, an imported
 * file, a pasted blob, and a save this build wrote thirty seconds ago.
 *
 * Two jobs. Fill in fields added since a save was written — that is the
 * historical one. And clamp everything that indexes a table or lands in
 * arithmetic, because after `validate` the only things known to be sane are
 * `day`, `money` and `unlockedRecipes`.
 */
export function repairSave(s, catalog, rng = Math.random) {
  s.day = Math.max(1, Math.round(num(s.day, 1)));
  s.money = Math.round(num(s.money, 60));

  // Unlocks: union with the starting set. A save that lost 'drip' leaves
  // generateOrderContent picking from an empty pool, and rand([]) is undefined.
  const union = (v, allowed, starting) =>
    [...new Set([...starting, ...strList(v, allowed)])];
  s.unlockedRecipes = union(s.unlockedRecipes, catalog.recipes, catalog.starting.recipes);
  s.unlockedSyrups = union(s.unlockedSyrups, catalog.syrups, catalog.starting.syrups);
  s.unlockedToppings = union(s.unlockedToppings, catalog.toppings, catalog.starting.toppings);
  s.unlockedFoods = union(s.unlockedFoods, catalog.foods, catalog.starting.foods);
  s.upgrades = strList(s.upgrades, catalog.upgrades);

  s.stationCount = intIn(s.stationCount, STATION_MIN, STATION_MAX, STATION_MIN);
  s.muted = !!s.muted;

  // LOYALTY_UPGRADES[loyaltyLevel-1].tipBonus is read on every serve and
  // .patienceBonus on every spawn. An out-of-range level throws inside the
  // rAF loop, which is a frozen game rather than a wrong number.
  s.loyaltyLevel = intIn(s.loyaltyLevel, 0, LOYALTY_MAX, 0);
  s.comboShields = intIn(s.comboShields, 0, SHIELD_MAX, 0);
  s.shieldsPurchased = Math.max(0, Math.round(num(s.shieldsPurchased, 0)));
  s.reputation = clamp(num(s.reputation, 50), 0, 100);
  s.prestigeLevel = Math.max(0, Math.round(num(s.prestigeLevel, 0)));

  s.dailyModifierId = catalog.modifiers.has(s.dailyModifierId) ? s.dailyModifierId : null;
  s.eventFiredThisShift = !!s.eventFiredThisShift;
  s.eventTriggerAt = Number.isFinite(s.eventTriggerAt) && s.eventTriggerAt >= 0
    ? s.eventTriggerAt
    : Math.round(catalog.shiftMs * (0.2 + rng() * 0.5));

  s.baristas = (Array.isArray(s.baristas) ? s.baristas : [])
    .map((b, i) => repairBarista(b, catalog, i))
    .filter(Boolean)
    .slice(0, BARISTA_CAP);

  s.presets = (Array.isArray(s.presets) ? s.presets : [])
    .map((p, i) => repairPreset(p, catalog, i))
    .filter(Boolean)
    .slice(0, catalog.presetMax);

  const regulars = {};
  if (s.regulars && typeof s.regulars === "object" && !Array.isArray(s.regulars)) {
    for (const [name, content] of Object.entries(s.regulars)) {
      const fixed = repairRegular(content, catalog);
      if (fixed) regulars[name] = fixed;
    }
  }
  s.regulars = regulars;

  // Drop anything an older or newer build wrote that this one doesn't know.
  const known = new Set(Object.keys(freshSaveData(catalog)));
  for (const k of Object.keys(s)) if (!known.has(k)) delete s[k];

  return s;
}

/* ---------- live state <-> save data ---------- */

/** The live `state` object (Sets and all) down to a plain, serializable blob. */
export function toSaveData(state) {
  return {
    day: state.day,
    money: state.money,
    unlockedRecipes: [...state.unlockedRecipes],
    unlockedSyrups: [...state.unlockedSyrups],
    unlockedToppings: [...state.unlockedToppings],
    unlockedFoods: [...state.unlockedFoods],
    stationCount: state.slots.length,
    muted: state.muted,
    regulars: state.regulars,
    baristas: state.baristas.map(b => ({
      id: b.id, name: b.name, level: b.level,
      spec: b.spec || null, trained: !!b.trained, working: b.working !== false,
    })),
    loyaltyLevel: state.loyaltyLevel,
    comboShields: state.comboShields,
    shieldsPurchased: state.shieldsPurchased,
    presets: state.presets,
    reputation: state.reputation,
    upgrades: [...state.upgrades],
    prestigeLevel: state.prestigeLevel,
    dailyModifierId: state.dailyModifierId,
    eventFiredThisShift: state.eventFiredThisShift,
    eventTriggerAt: state.eventTriggerAt,
  };
}

/**
 * A repaired blob back into the live state object, in place.
 *
 * Deliberately dumb — no `typeof` checks and no fallbacks. Everything this
 * reads is guaranteed by `repairSave`, and a second layer of defaults here is
 * where the two would drift apart.
 */
export function applyToState(state, data) {
  state.day = data.day;
  state.money = data.money;
  state.unlockedRecipes = new Set(data.unlockedRecipes);
  state.unlockedSyrups = new Set(data.unlockedSyrups);
  state.unlockedToppings = new Set(data.unlockedToppings);
  state.unlockedFoods = new Set(data.unlockedFoods);
  state.slots = new Array(data.stationCount).fill(null);
  state.focusedSlot = 0;
  state.muted = data.muted;
  state.regulars = data.regulars;
  state.baristas = data.baristas.map(b => ({ ...b, targetSlot: null, acc: 0 }));
  state.loyaltyLevel = data.loyaltyLevel;
  state.comboShields = data.comboShields;
  state.shieldsPurchased = data.shieldsPurchased;
  state.presets = data.presets;
  state.reputation = data.reputation;
  state.upgrades = new Set(data.upgrades);
  state.prestigeLevel = data.prestigeLevel;
  state.dailyModifierId = data.dailyModifierId;
  state.eventFiredThisShift = data.eventFiredThisShift;
  state.eventTriggerAt = data.eventTriggerAt;
  // Not persisted: the queue, the cups on the counter, the clock, today's
  // stats. A reload reopens at Dawn on the same day.
  state.queue = [];
  state.combo = 0;
  state.bestCombo = 0;
  state.shiftElapsed = 0;
  state.shiftRunning = true;
  state.marketingRemaining = 0;
  state.activeEvent = null;
  return state;
}

/**
 * The slot. `catalog` is built by the caller from its own tables so the id
 * lists here can't drift from the ones the game actually renders; the Node
 * test passes a fixture with the same shape.
 */
export function createCornerKettleSlot(catalog, { storage = null, rng = Math.random } = {}) {
  return createSaveSlot({
    game: GAME_SLUG,
    key: SAVE_KEY,
    version: SAVE_VERSION,
    storage,
    // A factory, not a literal: day one rolls an event time. Passing a literal
    // is what made slot.reset() hand back null for the Fourth Quarter (v7 §1).
    // Run through repair so fresh() and load() agree on shape.
    defaults: () => repairSave(freshSaveData(catalog), catalog, rng),
    validate: validateSave,
    migrate: (s, from) => migrateSave(s, from, catalog),
    repair: s => repairSave(s, catalog, rng),
  });
}

/** Turn the game's own data tables into the id sets `repair` needs. */
export function buildCatalog({ recipes, foods, syrups, toppings, milks, bases, upgrades, modifiers, baristaNames, starting, shiftMs, presetMax }) {
  return {
    recipes: new Set(recipes),
    foods: new Set(foods),
    syrups: new Set(syrups),
    toppings: new Set(toppings),
    milks: new Set(milks),
    bases: new Set(bases),
    upgrades: new Set(upgrades),
    modifiers: new Set(modifiers),
    baristaNames,
    starting,
    shiftMs,
    presetMax,
  };
}
