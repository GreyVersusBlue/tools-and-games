// smoke-save.mjs — Corner & Kettle's save layer under plain Node.
//
//   node Projects/corner-and-kettle/test/smoke-save.mjs
//
// Exits non-zero on any failure (locked decision #13). No dependencies, no
// DOM: everything under test is pure, which is why the save schema was split
// out of coffee_shop_sim.html in the first place.

import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Windows is the dev machine (v7 §7). A bare C:\... import is read as URL
// scheme `c:` and refused, so route the path through pathToFileURL.
const here = dirname(fileURLToPath(import.meta.url));
const mod = p => import(pathToFileURL(join(here, p)).href);

const {
  SAVE_KEY, SAVE_VERSION, GAME_SLUG,
  buildCatalog, createCornerKettleSlot, freshSaveData,
  validateSave, migrateSave, repairSave, toSaveData, applyToState,
} = await mod("../js/save.js");

/* ---------- harness ---------- */

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; return true; }
  failures.push(label);
  return false;
}
function eq(actual, expected, label) {
  return ok(Object.is(actual, expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function section(name) { process.stdout.write(`\n${name}\n`); }

/* ---------- fixtures ---------- */

// Mirrors the tables in coffee_shop_sim.html. The page builds its catalog from
// those tables directly, so this is a copy of the ids only.
const CATALOG = buildCatalog({
  recipes: ["drip","americano","latte","cappuccino","icedcoffee","mocha","caramelmac",
            "icedvanilla","frappe","chai","coldbrew","nitrocoldbrew","affogato","ristretto","doppio"],
  foods: ["croissant","bagel","muffin","cookie"],
  syrups: ["vanilla","caramel","mocha","hazelnut","peppermint"],
  toppings: ["whip","cinnamon","caramelDrizzle","chocoDrizzle","sprinkles"],
  milks: ["whole","oat","almond","skim"],
  bases: ["espresso","drip","tea","frappeBase"],
  upgrades: ["espresso2","espresso3","grinder","pos2","generator","foodprep",
             "seating","music","decor","sign","franchise"],
  modifiers: ["icedMonday","pastryRush","quietDay","regularsDay"],
  baristaNames: ["Pip","Juno","Casey","Rowan","Sage","Milo"],
  starting: {
    recipes: ["drip","americano","latte","cappuccino","icedcoffee"],
    syrups: ["vanilla","caramel"],
    toppings: ["whip","cinnamon"],
    foods: ["croissant","bagel"],
  },
  shiftMs: 4 * 34000,
  presetMax: 6,
});

/** A localStorage stub. gvb-save takes one so nothing here touches a browser. */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: m,
  };
}
const newSlot = store => createCornerKettleSlot(CATALOG, { storage: store || memStore(), rng: () => 0.5 });

/** The live-state shape applyToState writes into. */
function blankState() {
  return { slots: [], queue: [], presets: [], baristas: [], regulars: {},
    unlockedRecipes: new Set(), unlockedSyrups: new Set(),
    unlockedToppings: new Set(), unlockedFoods: new Set(), upgrades: new Set() };
}

/* ---------- 1. the key and the envelope ---------- */

section("1. key and envelope");
eq(SAVE_KEY, "cornerKettleSave_v1", "storage key is unchanged (locked decision #36)");
eq(SAVE_VERSION, 1, "schema version");
eq(GAME_SLUG, "corner-and-kettle", "game slug");
{
  const slot = newSlot();
  const env = JSON.parse(slot.serialize(slot.fresh()));
  eq(env.format, "gvb-save", "export uses the shared envelope");
  eq(env.game, "corner-and-kettle", "export stamps the game slug");
  eq(env.version, 1, "export stamps the version");
  ok(typeof env.savedAt === "string", "export stamps a timestamp");
}

/* ---------- 2. fresh() ---------- */

section("2. fresh state");
{
  const slot = newSlot();
  const f = slot.fresh();
  ok(f !== null, "fresh() is not null — defaults is a factory, not a literal (v7 §1)");
  eq(f.day, 1, "fresh day");
  eq(f.money, 60, "fresh money");
  eq(f.stationCount, 2, "fresh station count");
  ok(Number.isFinite(f.eventTriggerAt) && f.eventTriggerAt > 0,
    "fresh() rolls an event time — a 0 there fires the day's event at Dawn");
  ok(f.unlockedRecipes.includes("drip"), "fresh menu has House Drip");
  eq(f.unlockedRecipes.length, 5, "fresh menu is the five starters");
  eq(validateSave(f), true, "fresh state passes its own validator");
}

/* ---------- 3. refusing garbage ---------- */

section("3. refuse to load garbage");
{
  const slot = newSlot();
  const refused = [
    ["null", null],
    ["a string", "not a save"],
    ["an empty object", {}],
    ["an array", [1, 2, 3]],
    ["another game's export", { format: "gvb-save", game: "closing-time", version: 1, state: { day: 3, money: 10, unlockedRecipes: [] } }],
    ["day as a string", { day: "lots", money: 10, unlockedRecipes: [] }],
    ["day zero", { day: 0, money: 10, unlockedRecipes: [] }],
    ["NaN money", { day: 3, money: NaN, unlockedRecipes: [] }],
    ["no unlockedRecipes", { day: 3, money: 10 }],
  ];
  for (const [label, blob] of refused) {
    eq(slot.normalize(blob), null, `refuses ${label}`);
  }
  eq(slot.deserialize("{ this is not json"), null, "refuses malformed JSON");
  eq(slot.deserialize('{"day":4}'), null, "refuses a plausible-looking but incomplete blob");

  // And the one that has to survive: a real save.
  const real = { day: 4, money: 900, unlockedRecipes: ["drip", "latte"] };
  ok(slot.normalize(real) !== null, "accepts a minimal real save");
}

/* ---------- 4. the round trip ---------- */

section("4. round trip through storage and through a file");
{
  const store = memStore();
  const slot = newSlot(store);
  const state = blankState();
  applyToState(state, slot.fresh());
  state.day = 7;
  state.money = 4210;
  state.unlockedRecipes.add("frappe");
  state.upgrades.add("grinder");
  state.slots = [null, null, null];
  state.loyaltyLevel = 2;
  state.presets = [{ id: "p1", name: "Oat Vanilla Latte",
    cup: { base: "espresso", shots: 2, milk: "oat", milkSteamed: true, syrup: "vanilla", toppings: ["whip"], ice: false, blended: false } }];
  state.baristas = [{ id: "b1", name: "Juno", level: 2, spec: "bar", trained: true, working: true, targetSlot: 1, acc: 900 }];

  ok(slot.save(toSaveData(state)), "save() reports it stuck");
  const reloaded = slot.load();
  ok(reloaded !== null, "load() returns state");
  eq(reloaded.day, 7, "day survives");
  eq(reloaded.money, 4210, "money survives");
  eq(reloaded.stationCount, 3, "bought station survives");
  eq(reloaded.loyaltyLevel, 2, "loyalty level survives");
  ok(reloaded.unlockedRecipes.includes("frappe"), "bought recipe survives");
  ok(reloaded.upgrades.includes("grinder"), "bought equipment survives");
  eq(reloaded.presets[0].cup.shots, 2, "preset shots survive");
  eq(reloaded.baristas[0].level, 2, "barista tier survives");
  eq(reloaded.baristas[0].spec, "bar", "barista specialisation survives");

  const after = blankState();
  applyToState(after, reloaded);
  eq(after.slots.length, 3, "applyToState rebuilds three stations");
  eq(after.baristas[0].targetSlot, null, "a reloaded barista claims no slot");
  eq(after.baristas[0].acc, 0, "a reloaded barista's timer starts at zero");
  eq(after.upgrades.has("grinder"), true, "upgrades come back as a Set");

  // The file door: export bytes in, state out, no storage involved.
  const text = slot.serialize(toSaveData(after));
  const imported = slot.deserialize(text);
  ok(imported !== null, "an exported file deserialises");
  eq(imported.day, 7, "day survives the file round trip");
  eq(imported.presets[0].name, "Oat Vanilla Latte", "presets survive the file round trip");

  // A cleared browser: wipe the store, import the file, same shop.
  store._raw.clear();
  eq(slot.load(), null, "storage is empty after the wipe");
  slot.save(imported);
  eq(slot.load().money, 4210, "the shop is back after importing the file");
}

/* ---------- 5. the legacy save ---------- */

section("5. a save written before the current build");
{
  const slot = newSlot();
  // No version stamp (reads as v0), no reputation / upgrades / prestige /
  // dailyModifier / eventTriggerAt, and staff as a single baristaLevel number.
  const legacy = {
    day: 5, money: 1200,
    unlockedRecipes: ["drip", "americano", "latte", "cappuccino", "icedcoffee", "mocha"],
    unlockedSyrups: ["vanilla", "caramel", "mocha"],
    unlockedToppings: ["whip", "cinnamon"],
    unlockedFoods: ["croissant", "bagel"],
    stationCount: 3, muted: true, baristaLevel: 2,
  };
  const s = slot.normalize(legacy);
  ok(s !== null, "a pre-versioning save still loads");
  eq(s.day, 5, "legacy day survives");
  eq(s.baristas.length, 1, "baristaLevel migrates to one staffer");
  eq(s.baristas[0].level, 2, "at the tier it was saved at");
  eq(s.baristas[0].name, "Pip", "with a name");
  eq(s.baristas[0].working, true, "and on today's schedule");
  eq(s.reputation, 50, "reputation fills in");
  eq(s.prestigeLevel, 0, "prestige level fills in");
  eq(s.loyaltyLevel, 0, "loyalty level fills in");
  eq(s.comboShields, 0, "shields fill in");
  eq(Array.isArray(s.upgrades) && s.upgrades.length, 0, "upgrades fill in empty");
  eq(s.dailyModifierId, null, "daily modifier fills in");
  ok(Number.isFinite(s.eventTriggerAt) && s.eventTriggerAt > 0, "event time is rolled, not left undefined");
  eq(Array.isArray(s.presets) && s.presets.length, 0, "presets fill in empty");
  ok(s.baristaLevel === undefined, "the migrated field is dropped");

  // Nothing in the repaired state may be undefined or NaN — that is the whole
  // walking-speed lesson (v7 §2): a missing field that lands in arithmetic.
  for (const [k, v] of Object.entries(s)) {
    ok(v !== undefined, `legacy load: ${k} is not undefined`);
    ok(!(typeof v === "number" && Number.isNaN(v)), `legacy load: ${k} is not NaN`);
  }
}

/* ---------- 6. the walking-speed class, one level down ---------- */

section("6. nested fields that land in arithmetic");
{
  const slot = newSlot();
  const base = { day: 3, money: 500, unlockedRecipes: ["drip", "latte"] };

  // 6a. A preset cup with no `shots`. applyPreset copies it onto the live cup,
  // the Base station does cup.shots++, and undefined++ is NaN. NaN >= 1 is
  // false forever, so the ticket's base line can never be ticked off.
  const noShots = slot.normalize({ ...base,
    presets: [{ id: "p1", name: "Old Latte", cup: { base: "espresso", milk: "oat", toppings: ["whip"] } }] });
  eq(noShots.presets[0].cup.shots, 0, "a preset with no shots repairs to 0");
  ok(Number.isFinite(noShots.presets[0].cup.shots + 1), "and survives cup.shots++");
  eq(noShots.presets[0].cup.blended, false, "a preset with no blended flag repairs to false");
  eq(noShots.presets[0].cup.ice, false, "a preset with no ice flag repairs to false");

  // 6b. A preset cup with no `toppings`. applyPreset spreads it: [...undefined]
  // throws inside a click handler.
  const noToppings = slot.normalize({ ...base,
    presets: [{ id: "p1", name: "Plain", cup: { base: "drip", shots: 0 } }] });
  ok(Array.isArray(noToppings.presets[0].cup.toppings), "a preset with no toppings repairs to []");
  ok((() => { try { return [...noToppings.presets[0].cup.toppings].length === 0; } catch (e) { return false; } })(),
    "and survives the spread applyPreset does");

  // 6c. A regular whose standing order has no custom block. cloneOrderContent
  // spreads content.custom.toppings, and that runs inside generateOrder()
  // inside the rAF loop — one bad regular kills the game loop on next spawn.
  const badRegular = slot.normalize({ ...base, regulars: { Nora: { isFood: false, recipeId: "latte", price: 45 } } });
  ok(badRegular.regulars.Nora, "a regular with no custom block is kept");
  ok(Array.isArray(badRegular.regulars.Nora.custom.toppings), "with toppings repaired to []");
  eq(badRegular.regulars.Nora.custom.ice, false, "and ice repaired to false");

  // 6d. The older `food:true` flag rather than `isFood:true`.
  const oldFoodFlag = slot.normalize({ ...base, regulars: { Otis: { food: true, foodId: "bagel", price: 26 } } });
  eq(oldFoodFlag.regulars.Otis.isFood, true, "a regular saved with the old `food` flag reads as food");
  eq(oldFoodFlag.regulars.Otis.foodId, "bagel", "and keeps their order");

  // 6e. A regular pointing at an id that no longer exists is dropped, not kept
  // — RECIPES.find() would return undefined and .base would throw.
  const goneRecipe = slot.normalize({ ...base,
    regulars: { Nora: { isFood: false, recipeId: "pumpkinspice", custom: { toppings: [] } },
                Gideon: { isFood: false, recipeId: "latte", price: 45, custom: { milk: "oat", toppings: [] } } } });
  eq(goneRecipe.regulars.Nora, undefined, "a regular wanting a recipe that no longer exists is dropped");
  ok(goneRecipe.regulars.Gideon, "the regular next to them is kept");

  // 6f. Unknown milk / syrup / topping ids inside a live-looking save.
  const junkIds = slot.normalize({ ...base,
    regulars: { Talia: { isFood: false, recipeId: "latte", price: 45,
      custom: { milk: "unicorn", syrup: "battery", toppings: ["whip", "gravel"] } } } });
  eq(junkIds.regulars.Talia.custom.milk, undefined, "an unknown milk is dropped");
  eq(junkIds.regulars.Talia.custom.syrup, undefined, "an unknown syrup is dropped");
  eq(junkIds.regulars.Talia.custom.toppings.length, 1, "an unknown topping is dropped");
  eq(junkIds.regulars.Talia.custom.toppings[0], "whip", "the real one is kept");
}

/* ---------- 7. clamps on everything that indexes a table ---------- */

section("7. clamps");
{
  const slot = newSlot();
  const base = { day: 3, money: 500, unlockedRecipes: ["drip"] };

  // LOYALTY_UPGRADES[level-1].tipBonus is read on every serve. Level 9 throws
  // inside serveSlot; level 9 from generateOrder throws inside the rAF loop.
  eq(slot.normalize({ ...base, loyaltyLevel: 9 }).loyaltyLevel, 2, "loyaltyLevel clamps to the table length");
  eq(slot.normalize({ ...base, loyaltyLevel: -3 }).loyaltyLevel, 0, "loyaltyLevel clamps at zero");
  eq(slot.normalize({ ...base, comboShields: 99 }).comboShields, 3, "comboShields clamps to the cap");
  eq(slot.normalize({ ...base, reputation: 400 }).reputation, 100, "reputation clamps to 100");
  eq(slot.normalize({ ...base, reputation: -400 }).reputation, 0, "reputation clamps to 0");
  eq(slot.normalize({ ...base, stationCount: 40 }).stationCount, 4, "stationCount clamps to the buyable max");
  eq(slot.normalize({ ...base, stationCount: 1 }).stationCount, 2, "stationCount clamps to the starting two");
  eq(slot.normalize({ ...base, stationCount: 2.5 }).stationCount, 3, "a fractional stationCount rounds — new Array(2.5) throws");

  // BARISTA_TIERS[level] is read on every tick and every wage calculation.
  const manyStaff = slot.normalize({ ...base,
    baristas: [{ id: "a", name: "A", level: 1 }, { id: "b", name: "B", level: 7 },
               { id: "c", name: "C", level: 2 }, { id: "d", name: "D", level: 1 },
               { id: "e", name: "E", level: 1 }] });
  eq(manyStaff.baristas.length, 3, "the roster clamps to the hire cap");
  eq(manyStaff.baristas[1].level, 1, "an out-of-range tier reads as Junior");
  eq(slot.normalize({ ...base, baristas: [{ level: 2 }] }).baristas[0].name, "Pip", "a nameless staffer gets a name");
  ok(slot.normalize({ ...base, baristas: [{ level: 2 }] }).baristas[0].id, "and an id");
  eq(slot.normalize({ ...base, baristas: "nope" }).baristas.length, 0, "a non-array roster reads as empty");

  // rand([]) is undefined, and generateOrderContent picks from the unlocked
  // pool on every spawn.
  const strippedMenu = slot.normalize({ ...base, unlockedRecipes: [], unlockedFoods: [], unlockedSyrups: [] });
  ok(strippedMenu.unlockedRecipes.includes("drip"), "an empty menu is unioned back to the starters");
  eq(strippedMenu.unlockedFoods.length, 2, "so is the food menu");
  eq(strippedMenu.unlockedSyrups.length, 2, "and the syrup shelf");

  eq(slot.normalize({ ...base, dailyModifierId: "nonsense" }).dailyModifierId, null, "an unknown daily modifier reads as none");
  eq(slot.normalize({ ...base, upgrades: ["grinder", "teleporter"] }).upgrades.length, 1, "an unknown upgrade is dropped");
  eq(slot.normalize({ ...base, presets: Array.from({ length: 40 }, (_, i) => ({ id: "p" + i, name: "x", cup: {} })) }).presets.length,
    6, "presets clamp to the slot cap");
  ok(slot.normalize({ ...base, sneakyExtraField: 1 }).sneakyExtraField === undefined,
    "a field this build doesn't know is dropped");
}

/* ---------- 8. repair runs on every door, and is idempotent ---------- */

section("8. repair on every door");
{
  const slot = newSlot();
  const holed = { day: 3, money: 500, unlockedRecipes: ["drip"], __v: 1,
    presets: [{ id: "p1", name: "Old", cup: { base: "drip" } }] };

  // __v: 1 means the version matches, so migrate does NOT run. repair still has to.
  const viaStorage = slot.normalize(holed);
  eq(viaStorage.presets[0].cup.shots, 0, "repair runs on a save the current build wrote (migrate would not)");

  const viaFile = slot.deserialize(JSON.stringify({ format: "gvb-save", game: "corner-and-kettle", version: 1,
    state: { day: 3, money: 500, unlockedRecipes: ["drip"], presets: [{ id: "p1", name: "Old", cup: { base: "drip" } }] } }));
  eq(viaFile.presets[0].cup.shots, 0, "repair runs on an imported file too");

  const once = repairSave({ day: 3, money: 500, unlockedRecipes: ["drip"] }, CATALOG, () => 0.5);
  const twice = repairSave(JSON.parse(JSON.stringify(once)), CATALOG, () => 0.5);
  eq(JSON.stringify(once), JSON.stringify(twice), "repair is idempotent");

  // migrate is version drift only.
  const noDrift = { day: 3, money: 500, unlockedRecipes: ["drip"], baristaLevel: 2, __v: 1 };
  eq(slot.normalize(noDrift).baristas.length, 0, "migrate does not run when the version matches");
}

/* ---------- 9. the memory fallback ---------- */

section("9. blocked storage");
{
  // No storage at all — which is what gvb-save falls back to under Node, and
  // the shape the browser's memory stub takes when localStorage is blocked.
  const slot = createCornerKettleSlot(CATALOG, { storage: null, rng: () => 0.5 });
  eq(slot.load(), null, "load() returns null rather than throwing with no storage");
  eq(slot.save({ day: 1 }), false, "save() reports failure instead of throwing");
  ok(slot.fresh() !== null, "fresh() still works with no storage at all");
  ok(slot.reset() !== null, "reset() still hands back a fresh shop");
  // The pure pair does not care about storage, which is what makes export the
  // right advice when a browser blocks it.
  const text = slot.serialize(slot.fresh());
  ok(slot.deserialize(text) !== null, "export/import works with no storage");

  // A store whose getItem throws. gvb-save's load() now wraps its getItem
  // call in try/catch (locked decision #49, fixed in response to this
  // project's own shared-file request), so this returns null instead of
  // propagating.
  const hostile = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const hostileSlot = createCornerKettleSlot(CATALOG, { storage: hostile, rng: () => 0.5 });
  eq(hostileSlot.save({ day: 1 }), false, "a throwing setItem is already caught");
  let threw = false;
  try { hostileSlot.load(); } catch (e) { threw = true; }
  eq(threw, false, "a throwing getItem is now caught too (locked decision #49)");
}

/* ---------- 10. the guard-rails, broken on purpose ---------- */

// Locked decision #34: prove each guard by reintroducing the bug it guards.
section("10. guard-rails verified by breaking them");
{
  const slot = newSlot();
  const base = { day: 3, money: 500, unlockedRecipes: ["drip"] };

  // Without the shots repair: undefined++ is NaN, and NaN >= 1 never becomes true.
  const rawCup = { base: "espresso", milk: "oat", toppings: [] };
  let shots = rawCup.shots;
  shots++;
  ok(Number.isNaN(shots), "unrepaired: pulling a shot on a preset cup gives NaN");
  eq(shots >= 1, false, "unrepaired: the base requirement can never be satisfied");
  const fixedCup = slot.normalize({ ...base, presets: [{ id: "p", name: "n", cup: rawCup }] }).presets[0].cup;
  let fixedShots = fixedCup.shots;
  fixedShots++;
  eq(fixedShots, 1, "repaired: pulling a shot gives 1");
  eq(fixedShots >= 1, true, "repaired: the base requirement is satisfiable");

  // Without the toppings repair: the spread throws.
  let spreadThrew = false;
  try { [...{ base: "drip" }.toppings]; } catch (e) { spreadThrew = true; }
  eq(spreadThrew, true, "unrepaired: applyPreset's spread throws on a cup with no toppings");

  // Without the custom repair: the same spread throws inside the rAF loop.
  let regularThrew = false;
  try { [...{ isFood: false, recipeId: "latte" }.custom.toppings]; } catch (e) { regularThrew = true; }
  eq(regularThrew, true, "unrepaired: cloneOrderContent throws on a regular with no custom block");

  // Without the loyalty clamp: the table lookup throws.
  const LOYALTY_UPGRADES = [{ tipBonus: 0.15 }, { tipBonus: 0.30 }];
  let loyaltyThrew = false;
  try { LOYALTY_UPGRADES[9 - 1].tipBonus; } catch (e) { loyaltyThrew = true; }
  eq(loyaltyThrew, true, "unrepaired: loyaltyLevel 9 throws reading the bonus table");
  eq(LOYALTY_UPGRADES[slot.normalize({ ...base, loyaltyLevel: 9 }).loyaltyLevel - 1].tipBonus, 0.30,
    "repaired: it reads the top tier instead");

  // Without validate: a corrupt blob boots the game.
  const corrupt = { day: "banana", money: "free", lol: true };
  eq(JSON.parse(JSON.stringify(corrupt)).day, "banana", "unrepaired: JSON.parse hands the game a string day");
  eq(slot.normalize(corrupt), null, "validated: the corrupt blob is refused");

  // Without the station clamp: new Array(2.5) throws outright.
  let arrayThrew = false;
  try { new Array(2.5); } catch (e) { arrayThrew = true; }
  eq(arrayThrew, true, "unrepaired: new Array(2.5) throws");
  eq(new Array(slot.normalize({ ...base, stationCount: 2.5 }).stationCount).length, 3, "repaired: it builds three stations");
}

/* ---------- report ---------- */

process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) process.stdout.write(`  FAIL  ${f}\n`);
  process.exit(1);
}
