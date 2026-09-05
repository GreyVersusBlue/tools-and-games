// smoke.mjs — Torchbearer's first test suite.
//
//   node Projects/torchbearer/test/smoke.mjs
//
// Exits non-zero on any failure (locked decision #13). Two things are under
// test, and they are the two contracts this game has:
//
//   1. The pack validator, against every pack that ships — CORE_PACK and
//      ADVENTURE_PACK sliced out of torchbearer.html, plus both bundled files
//      in ../packs — and against a deliberately broken pack per rule.
//   2. The save slot, through every door: localStorage, an exported file, a
//      pasted blob, a save written by a build that predates a field.
//   3. The rules core in js/rules.js — every core class forged at level 3 and
//      checked against the numbers the Player Core prints, every row of the
//      effects DSL in guide §6 pinned to what the engine actually does with it
//      (including the three rows that do nothing), and Assurance's floor.
//   4. The combat core in js/combat.js — the geometry, the AC and attack math,
//      damage, and the two strike paths, driven headless. Everything in section
//      9 had been verified exactly once each, by a session clicking through a
//      browser, and never again.
//
// Nothing here needs a browser. Anything that only breaks in a browser is
// verified by hand and written up in the session notes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, "..");
const PAGE = path.join(PROJECT, "..", "torchbearer.html");

// Windows: a bare `C:\...` is read by Node as URL scheme `c:` and refused
// outright, so every dynamic import goes through pathToFileURL (v7 §7).
const mod = p => import(pathToFileURL(path.join(PROJECT, p)).href);
const { Validator, emptyRegistry } = await mod("js/registry.js");
const { createTorchSlot, repairSnapshot, repairBuild, repairHero, validateSnapshot, SAVE_KEY, SAVE_VERSION }
  = await mod("js/save.js");
const { Registry, PROF_VAL, SKILLS, CHAR_LEVEL, Dice, setDiceSource, activeEffects, abilityMods,
        finalizeCharacter, skillMod, assuranceFloor, assuranceDegree } = {
  ...await mod("js/registry.js"), ...await mod("js/rules.js")
};
const { newCombat } = await mod("js/combat.js");

/* ---------------- harness ---------------- */
let pass = 0; const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (got, want, label) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const group = name => console.log("\n── " + name);

/** An in-memory stand-in for localStorage. */
function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: m
  };
}

/**
 * Pull a `const NAME = {...}` object literal out of the page and parse it.
 * The two inline packs are JSON with /* *\/ comments between the sections, so
 * strip those on the way past. Brace-counting, string-aware: a `{` inside a
 * description does not end the object.
 */
function sliceLiteral(src, name) {
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

const html = fs.readFileSync(PAGE, "utf8");
const readPack = f => JSON.parse(fs.readFileSync(path.join(PROJECT, "packs", f), "utf8"));

/* ---------------- 1. the page still wires up the modules ---------------- */
group("page wiring");
ok(/<script type="module">/.test(html), "the script tag is a module");
ok(html.includes('from "../assets/js/gvb-save.js"'), "imports the shared save module");
ok(html.includes('from "./torchbearer/js/registry.js"'), "imports registry.js");
ok(html.includes('from "./torchbearer/js/rules.js"'), "imports rules.js");
ok(html.includes('from "./torchbearer/js/save.js"'), "imports save.js");
ok(html.includes('from "./torchbearer/js/library.js"'), "imports library.js");
ok(html.includes('from "./torchbearer/js/combat.js"'), "imports combat.js");
ok(html.includes('from "./torchbearer/js/text.js"'), "imports text.js");
// The whole point of adopting gvb-save: one implementation of storage, in one
// place. If a direct localStorage call reappears in the page, this fails.
// Comments are stripped first — this file explains the adoption in prose, and
// matching the word rather than the call would fail on its own documentation.
const codeOnly = html
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
ok(!/localStorage\s*\./.test(codeOnly), "the page makes no direct localStorage call");
ok(!/const (Registry|Validator) = \{/.test(html), "Registry and Validator are not inlined again");
// Same guard for the rules core: a copy left behind in the page would shadow the
// import and every check in section 7 would be testing a file nobody runs.
ok(!/^function (activeEffects|abilityMods|finalizeCharacter|skillMod)\(/m.test(html),
  "the rules core is not inlined again");
ok(!/^const (Dice|PROF_VAL|SKILLS|CHAR_LEVEL) ?=/m.test(html), "the rules constants are not inlined again");
// Same guard again for the combat core. A method left behind in the page would
// shadow the prototype and section 9 would be testing a file nobody runs.
ok(!/^  (strike|strikeMonster|effAC|applyDamage|reachable|losClear|isFlanking|mapPenalty|rollSave)\(/m.test(html),
  "the combat core is not inlined again");
ok(!/^function (esc|cap)\(/m.test(html), "esc and cap come from text.js, not a second copy in the page");
// The engine's side of the seam is useless if the page stops listening.
ok(/onEvent\(ev\)/.test(html), "the page listens for combat events");
// Locked decision #31: never hand-edit between the gvb:social markers.
ok(/<!-- gvb:social:start/.test(html) && /gvb:social:end -->/.test(html), "the social block is intact");

/* ---------------- 2. every pack that ships validates ---------------- */
group("shipped content validates");
const core = JSON.parse(sliceLiteral(html, "CORE_PACK"));
const advPack = JSON.parse(sliceLiteral(html, "ADVENTURE_PACK"));
const reg = emptyRegistry();
eq(Validator.validate(core, reg), [], "CORE_PACK validates");
reg.loadPack(core);
eq(Validator.validate(advPack, reg), [], "ADVENTURE_PACK validates");
reg.loadPack(advPack);
ok(reg.hasPack("core") && reg.hasPack("bell-of-barrowmoor"), "both inline packs register");

/* ---------------- 3. the bundled library matches its manifest ---------------- */
group("packs/index.json");
const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT, "packs", "index.json"), "utf8"));
ok(Array.isArray(manifest.packs) && manifest.packs.length > 0, "the manifest lists packs");

const onDisk = fs.readdirSync(path.join(PROJECT, "packs")).filter(f => f.endsWith(".json") && f !== "index.json").sort();
eq(manifest.packs.map(p => p.file).sort(), onDisk, "every pack file on disk is listed, and vice versa");

for (const entry of manifest.packs) {
  const pack = readPack(entry.file);
  // The manifest is what the title screen renders before it has fetched
  // anything, so a stale field there is a lie on the shelf.
  eq(pack.pack.id, entry.id, `${entry.file}: id matches the manifest`);
  eq(pack.pack.name, entry.name, `${entry.file}: name matches the manifest`);
  eq(pack.pack.type, entry.type, `${entry.file}: type matches the manifest`);
  eq(pack.pack.description, entry.description, `${entry.file}: description matches the manifest`);
  eq(Validator.validate(pack, reg), [], `${entry.file}: validates against core`);
  // A shelf pack the player can't do anything with is a bad shelf pack.
  ok((pack.adventures || []).length > 0, `${entry.file}: brings at least one adventure`);
}
ok(!onDisk.some(f => /[ ()]/.test(f)), "no pack filename has a space or a download suffix");

/* ---------------- 4. the validator's rules actually fire ----------------
   Locked decision #34: every guard-rail gets the bug it guards reintroduced.
   Each case below is a real pack with exactly one thing wrong. */
group("validator rejects broken packs");

const base = () => ({
  pack: { id: "t", name: "T", type: "adventure" },
  monsters: [{ id: "m", name: "M", ac: 15, hp: 20, attacks: [], saves: { fort: 5, ref: 5, will: 5 } }],
  companions: [{ id: "c", name: "C", ac: 15, hp: 20, attacks: [], saves: { fort: 5, ref: 5, will: 5 } }],
  adventures: [{
    id: "a", name: "A", start: "s1",
    companionsOffered: ["c"],
    scenes: {
      s1: { title: "One", text: ["p"], choices: [{ text: "go", goto: "s2" }] },
      s2: { title: "Two", text: ["p"], choices: [{ text: "fight", combat: "e1", victory: "s1", defeat: "s1" }] }
    },
    encounters: { e1: { name: "E", w: 8, h: 8, pcStarts: [[0, 0]], foes: [{ monster: "m", x: 4, y: 4 }] } }
  }]
});

const hits = (mutate, needle, label) => {
  const p = base(); mutate(p);
  const errs = Validator.validate(p, emptyRegistry());
  ok(errs.some(e => e.includes(needle)), `${label} — errors were ${JSON.stringify(errs)}`);
};

eq(Validator.validate(base(), emptyRegistry()), [], "the control pack is clean");
hits(p => { p.adventures[0].start = "nowhere"; }, "start scene", "a start pointing at no scene");
hits(p => { delete p.adventures[0].scenes.s1.text; }, 'needs "text"', "a scene with no text (used to throw at runtime)");
hits(p => { delete p.adventures[0].scenes.s1.title; }, 'missing a "title"', "a scene with no title");
hits(p => { p.adventures[0].scenes.s2.choices[0].victory = "nowhere"; }, "victory points to missing scene", "a dangling victory");
hits(p => { p.adventures[0].scenes.s2.choices[0].defeat = "nowhere"; }, "defeat points to missing scene", "a dangling defeat");
hits(p => { p.adventures[0].encounters.e1.foes[0].monster = "typo"; }, "unknown monster", "an encounter foe that does not exist");
hits(p => { p.adventures[0].companionsOffered = ["ghost"]; }, "unknown companion", "an offered companion that does not exist");
hits(p => { p.adventures[0].scenes.s1.choices[0].goto = "nowhere"; }, "missing scene", "a dangling goto (the original rule)");
hits(p => { delete p.pack.name; }, '"pack" metadata', "a pack with no name");
hits(p => { delete p.monsters[0].ac; }, 'missing required field "ac"', "a monster with no AC");
hits(p => {
  p.backgrounds = [{ id: "b", name: "B", boosts: [["str"], ["free"]], skills: ["crafting"], feat: "no-such-feat" }];
}, 'feat "no-such-feat" does not exist', "a background granting a feat nobody defined");

// A cross-pack reference is legal — that is what "IDs are global" means.
{
  const host = emptyRegistry();
  host.loadPack({ pack: { id: "host", name: "Host" }, monsters: [{ id: "borrowed", name: "B", ac: 15, hp: 9, attacks: [], saves: {} }] });
  const p = base();
  p.monsters = [];
  p.adventures[0].encounters.e1.foes[0].monster = "borrowed";
  eq(Validator.validate(p, host), [], "a foe defined by an already-loaded pack is accepted");
}

/* ---------------- 5. the save slot ---------------- */
group("save slot");
eq(SAVE_KEY, "torchbearer-save", "the storage key is unchanged (locked #36)");

const goodBuild = () => ({
  name: "Wren", ancestry: "human", heritage: "skilled-human", background: "scout", cls: "fighter",
  subclass: null, boosts: { ancestry: ["str"], bgA: "dex", bgFree: "con", key: "str", free: ["wis"] },
  skills: ["athletics"], loreExtra: [], feats: { "class-1": "power-attack" }, extraPicks: [],
  focusChoices: {}, spells: { cantrips: [], r1: [], r2: [] },
  gear: { weapon: "longsword", weapon2: null, ranged: null, armor: "chain-shirt", shield: true }
});
const goodSnap = () => ({
  build: goodBuild(), advId: "bell-of-barrowmoor", sceneId: "arrival", flags: { "met-someone": true },
  dailyLuckUsed: false,
  hero: { hp: 31, wounded: 1, resources: { slots: { 1: 2, 2: 1 }, focus: 1, font: 0, potions: 2 } }, // legacy numeric count — repair should stack it
  companions: [{ id: "aldous", hp: 22 }],
  chronicle: [{ html: "<b>x</b>", cls: "narr" }]
});

{
  const store = memStore();
  const slot = createTorchSlot(store);
  ok(slot.save(goodSnap()), "save() writes");
  const back = slot.load();
  ok(!!back, "load() returns the state");
  eq(back.hero.resources.potions, ["healing-potion-minor", "healing-potion-minor"],
    "a legacy numeric potion count repairs into a stack of that many minor potions");
  eq(back.build.name, "Wren", "the build survives a round trip");
  ok(!("__v" in back) && !("v" in back), "no version field leaks into game state");
  eq(JSON.parse(store._raw.get(SAVE_KEY)).__v, SAVE_VERSION, "the stored blob carries the version stamp");
}

{ // the export file, which is the only format that leaves the browser
  const slot = createTorchSlot(memStore());
  const text = slot.serialize(goodSnap());
  const env = JSON.parse(text);
  eq(env.format, "gvb-save", "an export is a gvb-save envelope");
  eq(env.game, "torchbearer", "an export is stamped torchbearer");
  eq(slot.deserialize(text).hero.hp, 31, "an export deserializes back to the same state");
  ok(slot.deserialize('{"format":"gvb-save","game":"closing-time","version":3,"state":{"day":1}}') === null,
    "another game's save file is refused");
}

{ // the committed preview save (session 10) — a real export from a real playthrough,
  // used by `npm run games`/the preview capture to reach the Thornwake bridge scene
  // without playing the nine-step builder blind. If this ever stops deserializing,
  // the preview recipe silently has nothing to import.
  const slot = createTorchSlot(memStore());
  const text = fs.readFileSync(path.join(PROJECT, "test", "sera-voss.torchsave.json"), "utf8");
  const state = slot.deserialize(text);
  ok(state !== null, "the committed preview save deserializes");
  eq(state?.build?.name, "Sera Voss", "the committed save is the expected hero");
  eq(state?.advId, "thornwake", "the committed save targets Thornwake Vigil");
  eq(state?.sceneId, "bridge-fog", "the committed save lands at the bridge-fog scene");
  eq(state?.hero?.resources?.potions, ["healing-potion-minor", "healing-potion-minor"],
    "the committed save's potions are already in the new stack shape");
}

{ // the corrupt-file cases, which used to reach finalizeCharacter
  const slot = createTorchSlot(memStore());
  ok(slot.deserialize("not json at all") === null, "a non-JSON file is refused");
  ok(slot.deserialize("[1,2,3]") === null, "a JSON array is refused");
  ok(slot.deserialize('{"build":null}') === null, "a save with no build is refused");
  ok(slot.deserialize('{"build":{"ancestry":"human"}}') === null, "a build missing its class is refused");
  ok(slot.deserialize('{"build":{"ancestry":"human","background":"scout","cls":""}}') === null, "an empty class id is refused");
  ok(slot.deserialize(JSON.stringify(goodSnap())) !== null, "a bare state blob (not an envelope) is accepted");
}

{ // a save written before gvb-save: `v: 1`, no `__v`, read as version 0
  const store = memStore();
  const legacy = goodSnap(); legacy.v = 1;
  store.setItem(SAVE_KEY, JSON.stringify(legacy));
  const back = createTorchSlot(store).load();
  ok(!!back, "a pre-adoption save still loads");
  ok(!("v" in back), "migrate strips the old v field");
  eq(back.hero.resources.potions, ["healing-potion-minor", "healing-potion-minor"],
    "a pre-adoption save keeps its potions, normalized into a stack");
}

{ // a corrupt blob in storage must not take the boot down
  const store = memStore();
  store.setItem(SAVE_KEY, "{{{ not json");
  ok(createTorchSlot(store).load() === null, "a corrupt localStorage value loads as null, not a throw");
  store.setItem(SAVE_KEY, JSON.stringify({ build: { cls: 7 } }));
  ok(createTorchSlot(store).load() === null, "a garbage build in localStorage loads as null");
}

/* ---------------- 6. repair — the fields added since ---------------- */
group("repair");
{
  /* Wiring, not logic. The first version of this suite called repairSnapshot()
     directly everywhere below, so unhooking `repair` from createTorchSlot
     entirely still passed all 80 checks — the exact shape of the two
     line-of-sight checks in v6 that guarded nothing. These three go through
     the slot's own doors instead: storage, an envelope, and a bare blob. */
  const store = memStore();
  const thin = goodSnap();
  thin.hero.resources = { slots: { 1: 2, 2: 1 }, focus: 1 };   // pre-`potions`
  delete thin.flags;
  store.setItem(SAVE_KEY, JSON.stringify(thin));
  const slot = createTorchSlot(store);
  eq(slot.load().hero.resources.potions, [], "load() repairs a save missing potions");
  eq(slot.load().flags, {}, "load() repairs a save missing flags");
  eq(slot.deserialize(JSON.stringify(thin)).hero.resources.potions, [], "deserialize() repairs a pasted blob");
  eq(slot.deserialize(slot.serialize(thin)).hero.resources.potions, [], "deserialize() repairs an exported file");
}
{
  /* Same wiring question for the validator: loadPack has to reject, not just
     collect. Deleting the `if (errs.length) throw` would otherwise be silent. */
  const r = emptyRegistry();
  let threw = false;
  try { r.loadPack({ pack: { id: "x", name: "X" }, monsters: [{ id: "m", name: "M" }] }); }
  catch (e) { threw = /rejected/.test(e.message); }
  ok(threw, "loadPack throws on a pack the validator rejects");
  ok(!r.hasPack("x"), "a rejected pack registers nothing");
}
{
  // The bug this hook exists for. A save whose resource block predates
  // `potions` used to be assigned wholesale over the fresh one. Session 10
  // turned `potions` from a bare count into a stack of item ids (so Drink
  // Potion can read each item's own `heal` formula instead of a hardcoded
  // `1d8` — see the potion-heal decision in the session notes), which makes
  // the unrepaired failure louder: `gotoScene`'s `hero.resources.potions.push(it)`
  // now throws on undefined outright instead of silently going to NaN. Louder
  // is better, but a throw mid-scene is still exactly what repair exists to
  // prevent.
  const s = goodSnap();
  s.hero.resources = { slots: { 1: 2, 2: 1 }, focus: 1 };     // no font, no potions
  const r = repairSnapshot(s);
  eq(r.hero.resources.potions, [], "a missing potion stack repairs to [], not undefined");
  eq(r.hero.resources.font, 0, "a missing font count repairs to 0");
  ok(Array.isArray(r.hero.resources.potions), "the repaired stack survives .push()");
  r.hero.resources.potions.push("healing-potion-minor");
  eq(r.hero.resources.potions.length, 1, "…and picking up a potion doesn't throw");

  // Prove the bug is real, not theoretical: the same field without repair.
  const raw = { potions: undefined };
  let threw = false;
  try { raw.potions.push("healing-potion-minor"); } catch (e) { threw = true; }
  ok(threw, "…and that an unrepaired one throws instead");
}
{
  const r = repairHero({ hp: 40, resources: {} });
  eq(r.resources.slots, { 1: 0, 2: 0 }, "a missing slots block repairs (the party panel indexes it on render)");
}
{
  eq(repairHero({ hp: 10, resources: { potions: ["healing-potion-minor", "healing-potion-lesser"] } }).resources.potions,
    ["healing-potion-minor", "healing-potion-lesser"], "an array of potion ids passes through repair unchanged");
  eq(repairHero({ hp: 10, resources: { potions: [1, "healing-potion-lesser", null] } }).resources.potions,
    ["healing-potion-lesser"], "repair drops non-string entries from the potion stack");
  eq(repairHero({ hp: 10, resources: { potions: 3 } }).resources.potions,
    ["healing-potion-minor", "healing-potion-minor", "healing-potion-minor"],
    "a legacy count of 3 repairs to three minor potions, since minor was the only potion the old counter could track");
}
{
  eq(repairHero({ resources: {} }).hp, null, "an unrecorded hp becomes null, not NaN");
  eq(repairHero({ hp: "31", resources: {} }).hp, 31, "a stringified hp is coerced");
  eq(repairHero(null), null, "no hero block stays no hero block");
}
{
  const b = repairBuild({ ancestry: "human", background: "scout", cls: "fighter" });
  // Every one of these is dereferenced by finalizeCharacter with no guard.
  ok(Array.isArray(b.skills) && Array.isArray(b.spells.cantrips) && Array.isArray(b.spells.r1)
    && Array.isArray(b.spells.r2) && b.gear && b.feats && b.focusChoices && b.boosts,
    "repairBuild fills every field finalizeCharacter dereferences");
  eq(repairBuild(null).skills, [], "even a null build comes back usable");
}
{
  const s = goodSnap();
  s.companions = [{ id: "aldous", hp: 22 }, null, { hp: 9 }, { id: "wren" }];
  s.flags = "not an object";
  s.chronicle = Array.from({ length: 200 }, (_, i) => ({ html: "e" + i }));
  const r = repairSnapshot(s);
  eq(r.companions.length, 2, "companions with no id are dropped");
  eq(r.companions[1], { id: "wren", hp: null }, "a companion with no hp restores to full");
  eq(r.flags, {}, "a non-object flags bag is replaced");
  eq(r.chronicle.length, 80, "the chronicle is capped at the 80 entries the writer keeps");
  eq(r.chronicle[0].html, "e120", "the cap keeps the newest entries");
}
{
  const s = goodSnap();
  s.chronicle = [{ html: "x".repeat(9000) }];
  eq(repairSnapshot(s).chronicle[0].html.length, 4000, "an oversized chronicle entry is truncated");
}
{
  ok(validateSnapshot(goodSnap()), "a good snapshot validates");
  ok(!validateSnapshot({ build: { ancestry: "human", background: "scout" } }), "a snapshot with no class does not");
  ok(!validateSnapshot(null), "null does not");
}

/* ---------------- 7. the rules core, at level 3 ----------------
   Until this session `finalizeCharacter` could not be called from Node at all,
   so the numbers every sheet in the game is printed from had never once been
   checked against the book. Each expected value below is derived by hand from
   the PF2e Remaster Player Core, not read back off the engine.

   One build shape for all eight classes, so the arithmetic stays legible:

     Human (8 HP, Speed 25, two free ancestry boosts, no flaw), Skilled Human,
     Soldier background, Explorer's Clothing (unarmored, +0 AC, no Dex cap),
     no feats, level 3.

     Boosts: ancestry con+dex, background con (Soldier offers Str or Con) and a
     free str, the class key ability, and the four level-1 free boosts on dex,
     wis, int, cha. Nothing is boosted twice except through the key, so every
     modifier is +1, +2 on con and dex, and +1 more on whatever the class keys
     off. Rogue therefore reads Dex +3 and everyone else Dex +2.

   From that: AC is 10 + (2 + 3 trained) + Dex + 0 = 15 + Dex. HP is
   8 + (class HP + 2) x 3. Perception is (rank bonus) + Wis. Class DC is
   10 + (2 + 3 trained) + key. Slots come straight off the class. */
group("core classes at level 3");
Registry.loadPack(core);
ok(Registry.hasPack("core"), "the rules-core registry has the core pack");
eq(CHAR_LEVEL, 3, "CHAR_LEVEL is 3 (Phase 6 changes it here and nowhere else)");

const KEY = { bard:"cha", cleric:"wis", druid:"wis", fighter:"str", ranger:"str", rogue:"dex", witch:"int", wizard:"int" };
/** The one build shape above, for a class. `over` patches it for a targeted check. */
const forge = (cls, over = {}) => finalizeCharacter({
  name: "Testcase", ancestry: "human", heritage: "skilled-human", background: "soldier",
  cls, subclass: null,
  boosts: { ancestry: ["con", "dex"], bgA: "con", bgFree: "str", key: KEY[cls] || "str", free: ["dex", "wis", "int", "cha"] },
  skills: [], loreExtra: [], feats: {}, extraPicks: [], focusChoices: {},
  spells: { cantrips: [], r1: [], r2: [] },
  gear: { weapon: null, weapon2: null, ranged: null, armor: "explorers-clothing", shield: false },
  ...over
});

/* subclass, AC, HP, Perception, class DC, {fort,ref,will}, rank-1/2 slots.
   The saves are here because three of them are the only proof that a level-3
   `profUp` feature fires at all: Bard's Lightning Reflexes, Druid's Great
   Fortitude, Ranger's Iron Will. Druid's Perception 9 is Alertness. */
const CORE_SHEETS = [
  ["bard",    "maestro",              17, 38, 8, 17, { fort: 7, ref: 9, will: 8 },  { 1: 3, 2: 2 }],
  ["cleric",  "cloistered-sarenrae",  17, 38, 7, 17, { fort: 7, ref: 7, will: 9 },  { 1: 3, 2: 2 }],
  ["druid",   "storm",                17, 38, 9, 17, { fort: 9, ref: 7, will: 9 },  { 1: 3, 2: 2 }],
  ["fighter", null,                   17, 44, 8, 17, { fort: 9, ref: 9, will: 6 },  null],
  ["ranger",  "precision",            17, 44, 8, 17, { fort: 9, ref: 9, will: 8 },  null],
  ["rogue",   "thief",                18, 38, 8, 18, { fort: 7, ref: 10, will: 8 }, null],
  ["witch",   "wilding-steward",      17, 32, 6, 17, { fort: 7, ref: 7, will: 8 },  { 1: 3, 2: 2 }],
  ["wizard",  "school-battle-magic",  17, 32, 6, 17, { fort: 7, ref: 9, will: 8 },  { 1: 3, 2: 2 }]
];
ok(CORE_SHEETS.length === Object.keys(Registry.classes).length,
  `every class in CORE_PACK has a sheet here — ${Object.keys(Registry.classes).join(", ")}`);

for (const [cls, subclass, ac, hp, per, dc, saves, slots] of CORE_SHEETS) {
  const ch = forge(cls, { subclass });
  eq(ch.ac, ac, `${cls}: AC`);
  eq(ch.hpMax, hp, `${cls}: HP`);
  eq(ch.perception, per, `${cls}: Perception`);
  eq(ch.classDC, dc, `${cls}: class DC`);
  eq(ch.saves, saves, `${cls}: saves`);
  eq(ch.casting ? ch.casting.slots : null, slots, `${cls}: spell slots`);
  eq(ch.speed, 25, `${cls}: Speed (Explorer's Clothing has no penalty)`);
}

// Second Doctrine is `profUp save.fort ifSubclass warpriest`, and it is the only
// place in core content where the subclass gate decides a printed number.
eq(forge("cleric", { subclass: "warpriest-gorum" }).saves.fort, 9, "a Warpriest cleric's Fortitude is expert at 3");
eq(forge("cleric", { subclass: "cloistered-pharasma" }).saves.fort, 7, "a Cloistered cleric's stays trained");
eq(forge("cleric", { subclass: "cloistered-sarenrae" }).casting.font, { spell: "heal", uses: 4 },
  "the divine font is four bonus heals");

// Armor is the other half of AC, and the Dex cap is where it goes wrong.
eq(forge("fighter", { gear: { weapon: null, weapon2: null, ranged: null, armor: "chain-shirt", shield: false } }).ac,
  19, "Chain Shirt: 10 + 5 trained + 2 Dex + 2 = 19");
eq(forge("rogue", { gear: { weapon: null, weapon2: null, ranged: null, armor: "studded-leather", shield: false } }).ac,
  20, "Studded Leather takes a Rogue's +3 Dex whole: 10 + 5 + 3 + 2 = 20");
// The Dex cap only bites above the cap, so it needs a build the standard one
// does not produce: a Rogue with Dex +4, one over Chain Shirt's cap of 3.
{
  const capped = forge("rogue", {
    boosts: { ancestry: ["dex", "con"], bgA: "con", bgFree: "dex", key: "dex", free: ["dex", "wis", "int", "cha"] },
    gear: { weapon: null, weapon2: null, ranged: null, armor: "chain-shirt", shield: false }
  });
  eq(capped.abil.dex, 4, "the capped-Dex build really has Dex +4");
  eq(capped.ac, 20, "Chain Shirt caps Dex at +3: 10 + 5 + 3 + 2 = 20, not 21");
}

// skillMod, the other export the page leans on for every check in the game.
{
  const ch = forge("fighter");
  eq(ch.skills.athletics, "T", "Soldier trains Athletics");
  eq(skillMod(ch, "athletics"), PROF_VAL.T + 3 + ch.abil.str, "a trained skill is rank + level + ability");
  eq(skillMod(ch, "occultism"), ch.abil.int, "an untrained skill is ability only, with no level added");
  eq(skillMod(ch, "perception"), ch.perception, "skillMod('perception') hands back the sheet's Perception");
  ok(Object.keys(SKILLS).every(s => typeof skillMod(ch, s) === "number"),
    "every skill in SKILLS resolves to a number");
}

/* ---------------- 8. the effects DSL, row by row ----------------
   One check per row of content-authoring-guide.md §6, against a feat that
   carries nothing but that row. Three of them are pinned as *currently
   dropped*: the guide says so, and Phase 5 changing any of them should show up
   as a diff in this file rather than as a silent behaviour change. */
group("effects DSL (guide §6)");

let probeN = 0;
/** Forge a fighter holding one made-up feat with exactly these effects. */
function withEffects(effects, over = {}) {
  const id = `smoke-probe-${++probeN}`;
  Registry.feats[id] = { id, name: `Probe ${probeN}`, type: "class", level: 1, effects };
  return forge(over.cls || "fighter", { ...over, feats: { "class-1": id } });
}
const BASE = withEffects([]);
eq([BASE.speed, BASE.hpMax, BASE.initBonus, BASE.perception], [25, 44, 0, 8],
  "the control fighter, holding a feat that does nothing");

eq(withEffects([{ bonus: { target: "speed", value: 10, type: "status" } }]).speed, 35, "bonus/speed adds to Speed");
eq(withEffects([{ bonus: { target: "speed", value: 10, vs: "seek" } }]).speed, 25, "bonus/speed with a `vs` is a note, not a number");
eq(withEffects([{ bonus: { target: "hp", value: 5 } }]).hpMax, 49, "bonus/hp adds to max HP");
eq(withEffects([{ bonus: { target: "hp", value: 5, vs: "seek" } }]).hpMax, 49, "a `vs` on hp is ignored and the bonus applies flatly (§6)");
eq(withEffects([{ bonus: { target: "initiative", value: 1 } }]).initBonus, 1, "bonus/initiative reaches the sheet");
eq(withEffects([{ profUp: { target: "perception", rank: "M" } }]).perception, 10, "profUp/perception raises Perception");
eq(withEffects([{ profUp: { target: "save.will", rank: "M" } }]).saves.will, 10, "profUp/save.will raises Will");
eq(withEffects([{ profUp: { target: "save.will", rank: "T" } }]).saves.will, 6, "profUp never lowers a rank");
eq(withEffects([{ profUp: { target: "save.will", rank: "M", ifSubclass: "warpriest" } }]).saves.will, 6,
  "profUp/ifSubclass does nothing when the subclass does not match");
eq(withEffects([{ attackProf: { advanced: "E" } }]).prof.attacks.advanced, "E", "attackProf merges weapon proficiency");
eq(withEffects([{ armorProf: { heavy: "E" } }]).prof.defenses.heavy, "E", "armorProf merges armor proficiency");
eq(withEffects([{ trainSkill: "nature" }]).skills.nature, "T", "trainSkill trains that skill");
eq(withEffects([{ trainSkill: "choice" }]).skills.nature, "U", 'trainSkill "choice" is a builder pick, not a training');
eq(withEffects([{ grantLore: "Bardic Lore", rank: "E" }]).lores.slice(-1),
  [{ name: "Bardic Lore", rank: "E" }], "grantLore adds a Lore at its stated rank");
eq(withEffects([{ grantLore: "Bardic Lore" }]).lores.slice(-1), [{ name: "Bardic Lore", rank: "T" }],
  "grantLore defaults to trained");
eq(withEffects([{ sense: "darkvision" }]).senses, ["darkvision"], "sense reaches the sheet");
eq(withEffects([{ resist: { type: "fire", value: "halfLevel" } }]).resists, [{ type: "fire", value: 1 }],
  'resist "halfLevel" is floor(3/2) = 1 at level 3');
eq(withEffects([{ resist: { type: "cold", value: 7 } }]).resists, [{ type: "cold", value: 7 }], "a numeric resist passes through");
eq(withEffects([{ focusPoints: 1 }, { focusPoints: 1 }, { focusPoints: 1 }, { focusPoints: 1 }]).focusMax, 3,
  "focusPoints caps the pool at 3");
eq(withEffects([{ grantFocusSpell: "fire-ray" }]).focusSpells, ["fire-ray"], "grantFocusSpell adds a focus spell");
ok(withEffects([{ note: "free text" }]).notes.some(n => n.endsWith(": free text")), "note reaches the sheet, credited to its source");
ok(withEffects([{ special: "totally-made-up" }]).specials.includes("totally-made-up"),
  "an unknown special id is carried, harmlessly (§6)");
eq(withEffects([{ special: "toughness" }]).hpMax, 44 + CHAR_LEVEL, "special/toughness adds level to HP");
eq(withEffects([{ grantCantrip: { tradition: "primal" } }], { cls: "wizard", subclass: "school-battle-magic" }).casting.cantrips,
  [], "grantCantrip is a builder pick — the tradition on it is not read (§6)");
eq(withEffects([{ tradition: "occult" }], { cls: "witch", subclass: "wilding-steward" }).casting.tradition,
  "occult", 'tradition resolves a "patron" caster');
ok(withEffects([{ font: "heal" }], { cls: "cleric", subclass: "cloistered-sarenrae" }).casting.font.uses === 4,
  "font grants the divine font");

// grantFeat, one level deep. A Wizard has no Shield Block of its own, so the
// special on the sheet can only have come through the grant.
{
  const ch = withEffects([{ grantFeat: "shield-block" }], { cls: "wizard", subclass: "school-battle-magic" });
  ok(ch.specials.includes("shield-block"), "grantFeat applies the named feat's own effects");
  ok(!forge("wizard", { subclass: "school-battle-magic" }).specials.includes("shield-block"),
    "…and a wizard without it does not have Shield Block");
}
{
  // "a granted feat's grantFeat is not followed" (§6). Two probes: one that
  // grants a feat that grants shield-block, and shield-block itself for contrast.
  Registry.feats["smoke-inner"] = { id: "smoke-inner", name: "Inner", type: "class", level: 1, effects: [{ grantFeat: "shield-block" }] };
  const ch = withEffects([{ grantFeat: "smoke-inner" }], { cls: "wizard", subclass: "school-battle-magic" });
  ok(!ch.specials.includes("shield-block"), "grantFeat expands exactly one level deep, so no cycles");
}
{
  const ch = withEffects([{ grantFocusSpellChoice: ["fire-ray", "bit-of-luck"] }]);
  eq(ch.focusSpells, ["fire-ray"], "grantFocusSpellChoice defaults to the first option");
  const picked = finalizeCharacter({
    ...forge("fighter").build, feats: { "class-1": `smoke-probe-${probeN}` },
    focusChoices: { [`Probe ${probeN}`]: "bit-of-luck" }
  });
  eq(picked.focusSpells, ["bit-of-luck"], "…and honours the player's pick, keyed by the granting feature's name");
}

/* The three rows the guide says parse and do nothing. Each is asserted as
   dropped, so Phase 5 wiring any of them up is a visible diff here. */
eq(withEffects([{ bonus: { target: "perception", value: 2 } }]).perception, BASE.perception,
  "currently dropped: bonus on perception (only speed, hp and initiative are read)");
eq(withEffects([{ bonus: { target: "save.all", value: 1 } }]).saves, BASE.saves,
  "currently dropped: bonus on save.all");
eq(withEffects([{ profUp: { target: "save.all", rank: "M" } }]).saves, BASE.saves,
  "currently dropped: profUp on save.all (§6 says list the three saves separately)");

/* ---------------- 9. Assurance, and a die a test can pin ---------------- */
group("assurance and dice");
{
  const ch = forge("fighter");                       // Athletics trained, Str +2
  eq(ch.skills.athletics, "T", "the fighter under test is trained in Athletics");
  eq(assuranceFloor(ch, "athletics"), 10 + PROF_VAL.T + 3,
    "Assurance is 10 + proficiency bonus: no ability modifier, no item bonus");
  ok(assuranceFloor(ch, "athletics") !== 10 + PROF_VAL.T + 3 + ch.abil.str,
    "…and specifically not the skill modifier, which is 2 higher here");
  eq(assuranceFloor(ch, "occultism"), 10, "untrained Assurance is a flat 10, not 10 + level");
  const floor = assuranceFloor(ch, "athletics");
  eq(assuranceDegree(floor, floor), 2, "meeting the DC exactly is a success");
  eq(assuranceDegree(floor, floor + 1), 1, "missing it by one is a failure");
  eq(assuranceDegree(floor, floor - 10), 2, "beating it by ten is still only a success — Assurance cannot crit");
  eq(assuranceDegree(floor, floor + 10), 1, "…and missing by ten is still only a failure");
  // The Assurance feats in core content are keyed per skill, which is what lets
  // the page ask `specials.includes("assurance-athletics")`.
  const farmhand = forge("fighter", { background: "farmhand", feats: { "skill-1": "assurance-athletics" } });
  ok(farmhand.specials.includes("assurance-athletics") && !farmhand.specials.includes("assurance"),
    "an Assurance feat lands on the sheet keyed by its skill, not as a bare 'assurance'");
}
{
  // Dice.d is the only place randomness enters the game, so pinning the source
  // pins every roll. Without this a test could not assert a natural 20.
  const rolls = [];
  setDiceSource(() => rolls.shift());
  rolls.push(0.999999);
  eq(Dice.d(20), 20, "a pinned source rolls a natural 20");
  rolls.push(0);
  eq(Dice.d(20), 1, "…and a natural 1");
  rolls.push(0.5, 0.5);
  eq(Dice.roll("2d6+3").total, 4 + 4 + 3, "Dice.roll sums its dice and its flat modifier");
  setDiceSource();
  ok(Dice.d(20) >= 1 && Dice.d(20) <= 20, "clearing the source restores Math.random");
  // degree(), which every check in the game reads.
  eq([Dice.degree(10, 25, 15), Dice.degree(10, 15, 15), Dice.degree(10, 14, 15), Dice.degree(10, 5, 15)],
    [3, 2, 1, 0], "degree: +10 crits, meeting succeeds, under fails, -10 crit-fails");
  eq(Dice.degree(20, 15, 15), 3, "a natural 20 steps the degree up one");
  eq(Dice.degree(1, 15, 15), 1, "a natural 1 steps it down one");
  eq(Dice.degree(20, 5, 15), 1, "a natural 20 on a would-be critical failure is only a failure");
}
{
  // activeEffects and abilityMods, the two exports nothing above calls directly.
  const b = forge("fighter").build;
  ok(activeEffects(b).some(x => x.e.special === "reactive-strike"),
    "activeEffects collects a class feature at or below level 3");
  ok(activeEffects(b).some(x => x.e.special === "bravery"),
    "…and a level-3 one: Bravery is in range at CHAR_LEVEL 3");
  ok(!activeEffects({ ...b, cls: "wizard", subclass: "school-battle-magic" }).some(x => x.e.special === "bravery"),
    "…while another class's features are not");
  eq(abilityMods(b), { str: 2, dex: 2, con: 2, int: 1, wis: 1, cha: 1 }, "abilityMods reproduces the boost sheet");
  eq(abilityMods({ boosts: { ancestry: [], bgA: null, bgFree: null, key: "str", free: ["str", "str", "str", "str", "str"] }, ancestry: "human" }).str,
    4, "no ability climbs past +4");
  eq(abilityMods({ boosts: { ancestry: ["con"], bgA: null, bgFree: null, key: null, free: [] }, ancestry: "dwarf" }),
    { str: 0, dex: 0, con: 2, int: 0, wis: 1, cha: -1 }, "an ancestry's fixed boosts and its flaw both apply");
}

/* ---------------- 9. the combat core (js/combat.js) ---------------- */
/* Everything below was verified exactly once each, by a session clicking
   through a browser, and then never again. `newCombat` stands up a board with
   no pack, no adventure and no DOM, so these are now arithmetic. */
group("combat core: the file itself");
{
  const src = fs.readFileSync(path.join(PROJECT, "js", "combat.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  ok(!/\bdocument\b/.test(code), "js/combat.js never touches the DOM");
  ok(!/\bsetTimeout\b/.test(code), "js/combat.js drives no clock");
  ok(!/\bApp\./.test(code), "js/combat.js never reaches back into the page");
  ok(!/\bwindow\b/.test(code), "js/combat.js has no window");
}

/** A combatant. Every field the core reads has a default; `over` sets the rest. */
const mk = (over = {}) => ({
  id: "c", name: "Someone", side: "foe", x: 0, y: 0,
  hp: 40, hpMax: 40, tempHP: 0, ac: 18, dead: false, dying: 0, mapCount: 0,
  saves: { fort: 8, ref: 8, will: 8 }, perception: 8,
  conditions: [], buffs: [], attacks: [], ...over
});
/** A board. `cbs` doubles as the initiative order unless one is given. */
const arena = (cbs, over = {}) => newCombat({
  ...over,
  active: true, cbs, order: over.order || [...cbs],
  mapW: over.mapW ?? 6, mapH: over.mapH ?? 6,
  walls: new Set(over.walls || []), diff: new Set(over.diff || [])
});
/** Pin the dice: `pin([20, 15], [10, 10])` is a d20 of 15, then a d10 of 10. */
const pin = (...spec) => {
  const q = spec.map(([sides, value]) => (value - 0.5) / sides);
  setDiceSource(() => (q.length ? q.shift() : 0.5));
};
const weapon = (over = {}) => ({
  name: "Longsword", bonus: 11, die: "1d8", dmgMod: 4, statusDmg: 0,
  damageType: "slashing", traits: [], range: 1, ranged: false, ...over
});

group("combat core: geometry");
{
  // A 6x6 room with a pillar at (2,2) and a bog at (1,0).
  const eng = arena([], { walls: ["2,2"], diff: ["1,0"] });
  eq(eng.losClear({ x: 0, y: 0 }, { x: 4, y: 4 }), false, "line of sight stops at a wall on the diagonal");
  eq(eng.losClear({ x: 0, y: 0 }, { x: 5, y: 0 }), true, "…and is clear along an open row");
  eq(eng.losClear({ x: 2, y: 2 }, { x: 4, y: 2 }), true, "the wall a caster stands on does not block its own line");

  const mover = mk({ side: "pc", x: 0, y: 3 });
  const ally = mk({ side: "pc", x: 1, y: 3 });
  const foe = mk({ id: "f", side: "foe", x: 0, y: 4 });
  const e2 = arena([mover, ally, foe], { walls: ["2,2"] });
  eq(e2.passable(-1, 3, mover), false, "off the west edge is not passable");
  eq(e2.passable(6, 3, mover), false, "…nor off the east edge");
  eq(e2.passable(2, 2, mover), false, "a wall is not passable");
  eq(e2.passable(1, 3, mover), true, "an ally's square is passable");
  eq(e2.passable(0, 4, mover), false, "an enemy's square is not");

  // 5-10-5: the first diagonal costs 1, the second costs 2, and a bog costs
  // one extra on entry.
  const walker = mk({ side: "pc", x: 0, y: 0 });
  const open = arena([walker]);
  const r = open.reachable(walker, 4);
  eq(r["1,1"].cost, 1, "the first diagonal step costs 1");
  eq(r["2,2"].cost, 3, "the second costs 2 more — 5-10-5");
  eq(r["3,3"].cost, 4, "and the third costs 1 again");
  eq(r["4,0"].cost, 4, "a straight run costs one per square");
  eq(r["5,0"], undefined, "…and nothing past the budget is reachable at all");
  eq(open.reachable(walker, 0)["1,0"], undefined, "a budget of 0 reaches nowhere");
  const bog = arena([walker], { diff: ["1,0"] });
  eq(bog.reachable(walker, 4)["1,0"].cost, 2, "difficult terrain costs one extra to enter");
}

group("combat core: off-guard");
{
  // Flanking. Two allies on exactly opposite squares, target between them.
  const a = mk({ id: "a", side: "pc", name: "Alis", x: 0, y: 1 });
  const b = mk({ id: "b", side: "pc", name: "Bran", x: 2, y: 1 });
  const t = mk({ id: "t", x: 1, y: 1, ac: 18 });
  const eng = arena([a, b, t]);
  eq(eng.isFlanking(a, t), true, "two allies on opposite sides of a target are flanking");
  eq(eng.effAC(t, a).offGuard, true, "…so the target is off-guard");
  eq(eng.effAC(t, a).ac, 16, "…and off-guard is exactly -2 AC");
  b.x = 0; b.y = 0;
  eq(eng.isFlanking(a, t), false, "two allies on the same side are not flanking");
  b.x = 2; b.y = 1; b.dead = true;
  eq(eng.isFlanking(a, t), false, "a dead ally does not flank");
  b.dead = false; b.dying = 1;
  eq(eng.isFlanking(a, t), false, "…nor a downed one");
  b.dying = 0;
  eq(eng.effAC(t, { ...a, ranged: true }).offGuard, false, "a ranged attacker gets no flanking");

  // Monsters do not flank the party, and have not since the game shipped: a
  // foe combatant is built without a `dying` field, so the `a.dying===0` test
  // in isFlanking is `undefined===0`, and strikeMonster hands effAC a bare
  // {id,ranged} with no x or y. Pinned as-is rather than fixed, because a
  // refactor that also buffs every monster in the game makes the next
  // balance regression unattributable. Locked decision #90; the fix is in
  // the standing backlog.
  const f1 = mk({ id: "f1", side: "foe", x: 0, y: 1 }); delete f1.dying;
  const f2 = mk({ id: "f2", side: "foe", x: 2, y: 1 }); delete f2.dying;
  const pc = mk({ id: "p", side: "pc", x: 1, y: 1 });
  const e2 = arena([f1, f2, pc]);
  eq(e2.isFlanking(f1, pc), false, "monsters do not flank today (#90) — foes carry no `dying` field");
  eq(e2.effAC(pc, { id: "f1", ranged: false }).offGuard, false,
    "…and strikeMonster's bare {id,ranged} has no square to flank from");

  // Prone, deny-advantage, a raised shield.
  const t2 = mk({ id: "t2", x: 4, y: 4, ac: 18 });
  const far = mk({ id: "far", side: "pc", x: 0, y: 0 });
  const e3 = arena([t2, far]);
  eq(e3.effAC(t2, far).ac, 18, "an unmodified target is its own AC");
  e3.addCond(t2, "prone", 1, undefined, true);
  eq(e3.effAC(t2, far), { ac: 16, offGuard: true }, "prone is off-guard");
  t2.conditions = [];
  t2.shieldRaised = true;
  eq(e3.effAC(t2, far).ac, 20, "a raised shield is +2 AC");
  t2.shieldRaised = false;
  t2.char = { specials: ["deny-advantage"] };
  eq(e3.effAC(t2, far, { forceOffGuard: true }), { ac: 18, offGuard: true },
    "Deny Advantage reports off-guard but keeps the -2");
}

group("combat core: Surprise Attack, Feint, Outwit");
{
  // Surprise Attack (Rogue 1): off-guard until the creature has acted, which
  // is turn order in round 1 — not "the whole of round 1".
  const rogue = mk({ id: "hero", side: "pc", name: "Vex", x: 0, y: 0, char: { specials: ["surprise-attack"] } });
  const early = mk({ id: "e", x: 1, y: 0 });
  const late = mk({ id: "l", x: 2, y: 0 });
  const eng = arena([rogue, early, late], { order: [rogue, early, late], round: 1, turnIdx: 0 });
  eq(eng.effAC(early, rogue).offGuard, true, "Surprise Attack: a foe that has not acted is off-guard");
  eq(eng.effAC(late, rogue).offGuard, true, "…including one further down the order");
  eng.turnIdx = 2;                       // `early` has taken its turn
  eq(eng.effAC(early, rogue).offGuard, false, "…and stops the instant that foe has acted");
  eq(eng.effAC(late, rogue).offGuard, true, "…while a foe still to act is off-guard on the same turn");
  eng.turnIdx = 0; eng.round = 2;
  eq(eng.effAC(early, rogue).offGuard, false, "Surprise Attack is round 1 only");

  // Feint: this feinter's attacks only, this turn only.
  const e2 = arena([rogue, early], { order: [rogue, early], round: 3, turnIdx: 1 });
  early.feint = { by: "hero", round: 3, turnIdx: 1, usesLeft: 1 };
  eq(e2.effAC(early, rogue).offGuard, true, "a plain Feint makes the next Strike off-guard");
  eq(e2.effAC(early, rogue).offGuard, false, "…and exactly one: the second Strike is not");
  early.feint = { by: "hero", round: 3, turnIdx: 1, usesLeft: Infinity };
  eq([e2.effAC(early, rogue).offGuard, e2.effAC(early, rogue).offGuard, e2.effAC(early, rogue).offGuard],
    [true, true, true], "a racket-scoundrel Feint holds for every attack this turn");
  e2.turnIdx = 2;
  eq(e2.effAC(early, rogue).offGuard, false, "…and expires when the turn does, not when the round does");
  e2.turnIdx = 1;
  eq(e2.effAC(early, { id: "someone-else", x: 1, y: 1 }).offGuard, false,
    "…and never applies to anybody but the feinter");

  // Outwit: +1 circumstance AC against your own hunted prey, and nobody else's.
  const ranger = mk({ id: "hero", side: "pc", x: 0, y: 0, ac: 17, char: { specials: ["edge-outwit"] } });
  const prey = mk({ id: "prey", x: 3, y: 3 });
  const other = mk({ id: "other", x: 4, y: 4 });
  const e3 = arena([ranger, prey, other], { huntPreyId: "prey" });
  eq(e3.effAC(ranger, prey).ac, 18, "Outwit is +1 AC against the ranger's own hunted prey");
  eq(e3.effAC(ranger, other).ac, 17, "…and nothing at all against anything else");
  e3.huntPreyId = null;
  eq(e3.effAC(ranger, prey).ac, 17, "…and nothing when no prey is marked");
}

group("combat core: MAP");
{
  const eng = arena([]);
  const plain = { traits: [] }, agile = { traits: ["agile"] };
  const cb = mk({ id: "hero", side: "pc" });
  eq([0, 1, 2, 3].map(n => { cb.mapCount = n; return eng.mapPenalty(cb, plain); }),
    [0, -5, -10, -10], "MAP is 0 / -5 / -10, and stops at -10");
  eq([0, 1, 2, 3].map(n => { cb.mapCount = n; return eng.mapPenalty(cb, agile); }),
    [0, -4, -8, -8], "agile MAP is 0 / -4 / -8");
  // Flurry (Ranger edge): -3/-6, -2/-4 agile, against the hunted prey only.
  const prey = mk({ id: "prey" });
  cb.char = { specials: ["edge-flurry"] };
  const e2 = arena([cb, prey], { huntPreyId: "prey", sel: prey });
  eq([1, 2].map(n => { cb.mapCount = n; return e2.mapPenalty(cb, plain); }), [-3, -6], "Flurry MAP is -3 / -6");
  eq([1, 2].map(n => { cb.mapCount = n; return e2.mapPenalty(cb, agile); }), [-2, -4], "…and -2 / -4 agile");
  e2.sel = mk({ id: "not-the-prey" });
  cb.mapCount = 1;
  eq(e2.mapPenalty(cb, plain), -5, "Flurry does not apply to anything but the prey");
}

group("combat core: damage");
{
  const eng = arena([]);
  const t = mk({ side: "pc", hp: 40, hpMax: 40, char: { resists: [] } });
  eq(eng.applyDamage(t, 10, "slashing"), 10, "damage is damage");
  eq(t.hp, 30, "…and comes off HP");
  t.weaknesses = [{ type: "fire", value: 5 }];
  eq(eng.applyDamage(t, 10, "fire"), 15, "a weakness adds its value");
  t.resistances = [{ type: "cold", value: 4 }];
  eq(eng.applyDamage(t, 10, "cold"), 6, "a resistance subtracts its value");
  eq(eng.applyDamage(t, 2, "cold"), 0, "…and never below zero");
  t.immunities = ["poison"];
  const hpBefore = t.hp;
  eq(eng.applyDamage(t, 99, "poison"), 0, "an immunity is a flat zero");
  eq(t.hp, hpBefore, "…and does not touch HP");
  t.tempHP = 6;
  eng.applyDamage(t, 10, "slashing");
  eq(t.tempHP, 0, "temporary HP absorbs first");
  eq(t.hp, hpBefore - 4, "…and only the remainder lands");

  // Physical resistance covers all three physical types; a named one does not.
  const r = mk({ resistances: [{ type: "physical", value: 3 }], hp: 40, hpMax: 40 });
  const e2 = arena([r]);
  eq(["slashing", "piercing", "bludgeoning"].map(d => e2.applyDamage(r, 10, d)), [7, 7, 7],
    "resist physical covers slashing, piercing and bludgeoning");
  eq(e2.applyDamage(r, 10, "fire"), 10, "…and not fire");

  // Dying, wounded, and the second fall.
  const pc = mk({ side: "pc", hp: 5, hpMax: 40, char: { resists: [] } });
  const e3 = arena([pc]);
  e3.applyDamage(pc, 20, "slashing");
  eq([pc.hp, pc.dying, pc.wounded], [0, 1, 1], "a PC at 0 HP is dying 1, wounded 1");
  pc.hp = 5; pc.dying = 0;
  e3.applyDamage(pc, 20, "slashing");
  eq([pc.dying, pc.wounded], [2, 2], "…and falls at dying 2 the second time");
  // A foe at 0 HP dies outright.
  const foe = mk({ id: "f", side: "foe", hp: 3, hpMax: 20, name: "Ghoul" });
  const e4 = arena([foe]);
  e4.applyDamage(foe, 5, "slashing");
  ok(foe.dead && foe.hp === 0, "a foe at 0 HP is destroyed");
  ok(e4.events.some(ev => ev.text.includes("Ghoul") && ev.text.includes("destroyed")),
    "…and says so in the Chronicle");

  // heal caps at hpMax and pulls a dying character back.
  const hurt = mk({ side: "pc", hp: 10, hpMax: 40, dying: 2 });
  const e5 = arena([hurt]);
  eq(e5.heal(hurt, 100), 30, "healing is capped at missing HP");
  eq(hurt.dying, 0, "…and clears dying");
}

group("combat core: Shield Block");
{
  const pc = mk({ side: "pc", hp: 40, hpMax: 40, shieldRaised: true, reactionUsed: false,
                  name: "Ward", char: { specials: ["shield-block"], resists: [] } });
  const eng = arena([pc]);
  eq(eng.applyDamage(pc, 12, "slashing"), 7, "Shield Block eats 5 of a physical hit");
  eq(pc.reactionUsed, true, "…by spending the reaction");
  eq(eng.applyDamage(pc, 12, "slashing"), 12, "…which is gone for the rest of the round: once only");
  pc.reactionUsed = false;
  eq(eng.applyDamage(pc, 3, "slashing"), 0, "a hit smaller than the block is absorbed whole");
  pc.reactionUsed = false;
  eq(eng.applyDamage(pc, 12, "fire"), 12, "Shield Block is physical damage only");
  eq(pc.reactionUsed, false, "…and does not burn the reaction on fire");
  const noShield = mk({ side: "pc", hp: 40, hpMax: 40, shieldRaised: false,
                        char: { specials: ["shield-block"], resists: [] } });
  const e2 = arena([noShield]);
  eq(e2.applyDamage(noShield, 12, "slashing"), 12, "…and does nothing with the shield down");
}

group("combat core: strikes");
{
  // A plain hit: d20 of 15 against AC 5, then 1d8 of 6, +4 from the weapon.
  const att = mk({ id: "hero", side: "pc", name: "Alis", x: 0, y: 0, char: { specials: [], resists: [] } });
  const def = mk({ id: "t", name: "Ghoul", x: 3, y: 3, ac: 5, hp: 60, hpMax: 60 });
  const eng = arena([att, def]);
  pin([20, 15], [8, 6]);
  eq(eng.strike(att, def, weapon()), 3, "a d20 of 15 at +11 against AC 5 is a critical success");
  eq(def.hp, 60 - 20, "…and a crit doubles (6+4) to 20");
  eq(att.mapCount, 1, "…and raises MAP");
  const roll = eng.events.find(ev => ev.kind === "roll");
  ok(roll && roll.d20 === 15 && roll.deg === 3, "the strike emits a roll event carrying its d20 and degree");
  ok(roll.text.includes("Alis") && roll.text.includes("Ghoul"), "…naming both sides");

  // A miss raises MAP; an Exacting Strike miss does not.
  att.mapCount = 0; def.hp = 60;
  pin([20, 2]);
  eq(eng.strike(att, def, weapon({ bonus: 0 }), { exacting: true }), 1, "a d20 of 2 at +0 against AC 60 misses");
  eq(att.mapCount, 0, "Exacting Strike: a miss does not raise MAP");
  pin([20, 2]);
  eng.strike(att, def, weapon({ bonus: 0 }));
  eq(att.mapCount, 1, "…but a plain miss does");
  att.mapCount = 0;
  pin([20, 2]);
  eng.strike(att, def, weapon({ bonus: 0 }), { noMAP: true });
  eq(att.mapCount, 0, "…and a Reactive Strike never does");

  // Crossbow Ace: 1d10 and +2, on prey or after reloading, and on neither
  // otherwise. The die is pinned at its maximum so 1d10 and 1d8 differ.
  const ace = mk({ id: "hero", side: "pc", x: 0, y: 0, char: { specials: ["crossbow-ace"], resists: [] } });
  const prey = mk({ id: "prey", x: 3, y: 3, ac: 16, hp: 99, hpMax: 99 });
  const e2 = arena([ace, prey], { huntPreyId: "prey" });
  const bow = weapon({ name: "Crossbow", die: "1d8", dmgMod: 0, ranged: true, range: 12, traits: ["reload-1"] });
  pin([20, 11], [10, 10]);
  e2.strike(ace, prey, bow);
  eq(prey.hp, 99 - 12, "Crossbow Ace against hunted prey: 1d10 and +2");
  ace.mapCount = 0; prey.hp = 99; e2.huntPreyId = null; ace.reloadedThisTurn = true;
  pin([20, 11], [10, 10]);
  e2.strike(ace, prey, bow);
  eq(prey.hp, 99 - 12, "…and the same after reloading, with no prey marked");
  ace.mapCount = 0; prey.hp = 99; ace.reloadedThisTurn = false;
  pin([20, 11], [8, 8]);
  e2.strike(ace, prey, bow);
  eq(prey.hp, 99 - 8, "…and neither trigger means a plain 1d8 with no +2");
  ace.mapCount = 0; prey.hp = 99; ace.reloadedThisTurn = true;
  pin([20, 11], [8, 8]);
  e2.strike(ace, prey, weapon({ name: "Shortbow", die: "1d8", dmgMod: 0, ranged: true, range: 12 }));
  eq(prey.hp, 99 - 8, "…and it never fires on a weapon without reload-1");

  // Sneak attack needs off-guard AND a qualifying weapon.
  const rogue = mk({ id: "hero", side: "pc", x: 0, y: 0, char: { specials: ["sneak-attack"], resists: [] } });
  const mark = mk({ id: "m", x: 1, y: 0, ac: 16, hp: 99, hpMax: 99 });
  const e3 = arena([rogue, mark]);
  const dagger = weapon({ name: "Dagger", die: "1d4", dmgMod: 0, traits: ["agile", "finesse"] });
  pin([20, 11], [4, 4]);
  e3.strike(rogue, mark, dagger);
  eq(mark.hp, 99 - 4, "no sneak attack against a target that is not off-guard");
  rogue.mapCount = 0; mark.hp = 99;
  pin([20, 11], [4, 4], [6, 6]);
  e3.strike(rogue, mark, dagger, { forceOffGuard: true });
  eq(mark.hp, 99 - 10, "…and 1d6 precision on top when it is");
  rogue.mapCount = 0; mark.hp = 99;
  pin([20, 11], [8, 8]);
  e3.strike(rogue, mark, weapon({ die: "1d8", dmgMod: 0 }), { forceOffGuard: true });
  eq(mark.hp, 99 - 8, "…and none at all on a weapon that is neither agile, finesse nor ranged");

  // strikeMonster: MAP, the agile variant, and Nimble Dodge.
  const foe = mk({ id: "f", side: "foe", name: "Ghast", x: 0, y: 0 });
  const hero = mk({ id: "hero", side: "pc", name: "Alis", x: 1, y: 0, ac: 18, hp: 40, hpMax: 40,
                    char: { specials: ["nimble-dodge"], resists: [] } });
  const e4 = arena([foe, hero]);
  pin([20, 10]);
  e4.strikeMonster(foe, hero, { name: "Claw", bonus: 9, die: "1d6", traits: [], damageType: "slashing" });
  ok(e4.events.some(ev => ev.text.includes("Nimbly Dodges")), "Nimble Dodge fires on the first attack");
  eq([hero.nimbleUsed, hero.reactionUsed], [true, true], "…and spends both the use and the reaction");
  const seal = e4.events.filter(ev => ev.kind === "roll").pop();
  ok(seal.math.includes("vs AC 20"), "…which is +2 AC on the roll the player sees");
  eq(foe.mapCount, 1, "a monster's Strike raises its own MAP");
}

group("combat core: saves and the event log");
{
  const t = mk({ id: "t", name: "Alis", saves: { fort: 9, ref: 7, will: 5 } });
  const eng = arena([t]);
  pin([20, 10]);
  eq(eng.rollSave(t, "reflex", 17, "Fireball"), 2, "a d20 of 10 at +7 meets DC 17 — a success");
  eng.addCond(t, "frightened", 2, undefined, true);
  eq(eng.saveMod(t, "reflex"), 5, "frightened is a penalty to every save");
  eng.addCond(t, "clumsy", 1, undefined, true);
  eq(eng.saveMod(t, "reflex"), 4, "…and clumsy hits Reflex only");
  eq(eng.saveMod(t, "will"), 3, "…which is why Will is still only down by the frightened 2");

  // Every name the engine interpolates goes through esc, because a pack is a
  // file anyone can write.
  const nasty = mk({ id: "n", side: "foe", name: "<img src=x onerror=1>", hp: 1, hpMax: 1 });
  const e2 = arena([nasty]);
  e2.applyDamage(nasty, 5, "slashing");
  ok(e2.events.every(ev => !ev.text.includes("<img")), "a combatant's name is escaped in every event it appears in");
  ok(e2.events.some(ev => ev.text.includes("&lt;img")), "…and is still there, escaped");

  // onEvent is the whole of the page's side of the seam.
  const seen = [];
  const e3 = arena([mk({ id: "x", name: "Bran" })], { onEvent: ev => seen.push(ev) });
  e3.log("hello");
  eq(seen.length, 1, "onEvent receives every event");
  eq(seen[0], { kind: "log", text: "hello", cls: "combat" }, "…as {kind, text, cls}");
  eq(e3.events.length, 1, "…and the engine keeps its own copy");
}
setDiceSource();

/* ---------------- report ---------------- */
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL  " + f);
  process.exit(1);
}
