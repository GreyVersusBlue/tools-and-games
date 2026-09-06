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
//   4. The combat engine in js/combat.js — the geometry, the AC and attack math,
//      damage, and the two strike paths (section 9), then the turn loop, `start`,
//      the player's actions, the spells, the monster AI and two whole encounters
//      played headless from the real packs (section 10). Everything in both had
//      been verified exactly once each, by a session clicking through a browser,
//      and never again.
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
const { Validator, emptyRegistry, KNOWN_REACTIONS } = await mod("js/registry.js");
const { createTorchSlot, repairSnapshot, repairBuild, repairHero, validateSnapshot, SAVE_KEY, SAVE_VERSION }
  = await mod("js/save.js");
const { Registry, PROF_VAL, SKILLS, CHAR_LEVEL, Dice, setDiceSource, activeEffects, abilityMods,
        finalizeCharacter, skillMod, assuranceFloor, assuranceDegree, SIZES, sizeIndex, levelDC } = {
  ...await mod("js/registry.js"), ...await mod("js/rules.js")
};
const { newCombat, heroCombatant, companionCombatant, REACTIONS, MANEUVERS, LORE_SKILL } = await mod("js/combat.js");

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
ok(!/^  (beginTurn|endTurn|nextTurn|checkEnd|aiTurn|aiStep|castAt|armSpell|spendSpell|effectFor|spellRows|resolveTargeted|doMove|provokeAlong|actionClick|cellClick|tokenClick|targets|check)\(/m.test(html)
   && !/^  start\(encId/m.test(html) && !/^  finish\(victory\)/m.test(html),
  "the turn loop, the actions, the spells and the AI are not inlined again");
// What is left of Combat in the page is a view. If it rolls a die, applies
// damage or reaches for the clock outside its two hooks, a rule has crept back.
const pageCombat = html.slice(html.indexOf("const Combat = Object.assign(newCombat(), {"), html.indexOf("const App = {"));
ok(pageCombat.length > 0 && !/\bDice\.|applyDamage|addCond|\.spend\(|strike\(/.test(pageCombat), "the page's Combat rolls no dice, deals no damage and spends no actions");
eq((pageCombat.match(/setTimeout/g) || []).length, 2, "…and its only two setTimeouts are defer and the floating number");
ok(!/\{id:"hero",side:"pc"/.test(html) && !/\{id:"comp-"\+id/.test(html), "the party builders come from combat.js, not a second copy in the page");
ok(!/App\.rollCheck\(`\$\{cb\.name\}/.test(html), "no combat action rolls through App.rollCheck any more");
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
hits(p => { p.monsters[0].reactions = ["counterspell"]; }, 'unknown reaction "counterspell"', "a monster claiming a reaction the engine does not implement");
hits(p => { p.monsters[0].reactions = "reactive-strike"; }, '"reactions" must be an array', "a monster whose reactions field is a bare string");
hits(p => { p.monsters[0].reach = 0; }, '"reach" is in cells', "a monster with a reach of zero");
hits(p => { p.monsters[0].reach = 1.5; }, '"reach" is in cells', "…or half a square");
{
  const p = base();
  p.monsters[0].reactions = ["reactive-strike", "shield-block", "nimble-dodge"];
  p.monsters[0].reach = 2;
  eq(Validator.validate(p, emptyRegistry()), [], "every reaction the engine implements is accepted, and so is reach 2");
}

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
// Phase 4: a `vs` bonus is no longer dropped on the floor — it is collected on
// the sheet as `condBonuses`, where a check site that knows the condition can
// read it. Exactly one does today (Seek).
eq(withEffects([{ bonus: { target: "perception", value: 2, type: "circumstance", vs: "seek" } }]).condBonuses,
  [{ target: "perception", value: 2, type: "circumstance", vs: "seek" }],
  "a conditional bonus lands on the sheet as condBonuses");
eq(withEffects([{ bonus: { target: "perception", value: 2, type: "circumstance", vs: "seek" } }]).perception, 8,
  "…and does not touch the flat Perception the sheet prints");
eq(BASE.condBonuses, [], "a feat with no `vs` contributes nothing to condBonuses");
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
  eq(e3.effAC(t2, far), { ac: 16, offGuard: true, cover: 0 }, "prone is off-guard");
  t2.conditions = [];
  t2.shieldRaised = true;
  eq(e3.effAC(t2, far).ac, 20, "a raised shield is +2 AC");
  t2.shieldRaised = false;
  t2.char = { specials: ["deny-advantage"] };
  eq(e3.effAC(t2, far, { forceOffGuard: true }), { ac: 18, offGuard: true, cover: 0 },
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
  const other = mk({ id: "other", x: 0, y: 4 }); // off the prey's line, so no cover in the way
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

/* ---------------- 10. the combat engine, second cut ---------------- */
/* Increment 2 took the turn loop, `start`, the player's actions, the spells
   and the monster AI out of the page. The clock is `defer`, which here runs
   its callback at once, so a monster's whole turn — and every monster turn
   after it — resolves inside one synchronous call. */
group("combat engine: the seams");
{
  const eng = arena([mk({ id: "t", side: "pc" })]);
  const order = [];
  eng.defer(() => order.push("ran"), 700);
  eq(order, ["ran"], "the engine's own defer runs the callback at once, whatever the wait");
  pin([20, 12]);
  const r = eng.check("Someone Demoralizes Nobody", 3, 15);
  eq(r, { d20: 12, total: 15, deg: 2 }, "check rolls one d20 against a DC and returns the degree");
  eq(eng.events.at(-1).kind, "roll", "…and it goes through the seal like every other d20");
  eq(eng.events.at(-1).math, "12+3 = 15 vs DC 15", "…with the arithmetic the page prints");
  // The view hooks exist and do nothing. A test never has to stub them.
  for (const h of ["renderAll", "hint", "toast", "mount", "autosave", "floatText"])
    eq(eng[h]("x"), undefined, `${h} is a no-op the page overrides`);
}

group("combat engine: the turn loop");
{
  const hooks = () => { const h = { victory: 0, defeat: 0, saves: 0 };
    return { h, enc: { name: "The Test" }, onVictory: () => h.victory++, onDefeat: () => h.defeat++, autosave: () => h.saves++ }; };
  // A turn starts with a clean slate and three actions.
  {
    const pc = mk({ id: "p", side: "pc", reactionUsed: true, shieldRaised: true, nimbleUsed: true, mapCount: 2, flourishUsed: true, hexUsed: true, reloadedThisTurn: true });
    const foe = mk({ id: "f" });
    const eng = arena([pc, foe], hooks());
    eng.beginTurn(0);
    eq([pc.reactionUsed, pc.shieldRaised, pc.nimbleUsed, pc.mapCount, pc.flourishUsed, pc.hexUsed, pc.reloadedThisTurn],
      [false, false, false, 0, false, false, false], "beginTurn resets every per-turn flag");
    eq(eng.actions, 3, "…and deals three actions");
    eq([eng.armed, eng.sel], [null, null], "…with nothing armed and nothing selected");
  }
  // Stunned eats actions and goes away; slowed just eats them.
  {
    const pc = mk({ id: "p", side: "pc", conditions: [{ c: "stunned", v: 2 }] });
    const eng = arena([pc, mk({ id: "f" })], hooks());
    eng.beginTurn(0);
    eq(eng.actions, 1, "stunned 2 leaves one action");
    eq(pc.conditions, [], "…and the stun is spent by taking them");
    const zombie = mk({ id: "z", x: 5, y: 5, slowedBase: 1, conditions: [{ c: "slowed-feet", v: 1 }] });
    const e3 = arena([zombie, mk({ id: "p", side: "pc" })], hooks());
    e3.aiTurn = function(){ }; // hold the AI so the budget can be read
    e3.beginTurn(0);
    eq(e3.actions, 1, "a shambler (slowed 1) with slowed-feet 1 gets one action");
    zombie.slowedBase = 3; e3.beginTurn(0);
    eq(e3.actions, 0, "…and the budget never goes below zero");
  }
  // Recovery checks. DC is 10 + dying; a natural 1 slips two, and nothing here
  // reads Dice.degree — a natural 20 is just a 20.
  {
    const down = mk({ id: "d", side: "pc", name: "Alis", hp: 0, dying: 1, wounded: 1 });
    const up = mk({ id: "u", side: "pc", name: "Bran" });
    const foe = mk({ id: "f" });
    const eng = arena([down, up, foe], hooks());
    pin([20, 11]); eng.beginTurn(0);
    eq(down.dying, 0, "an 11 against DC 11 is a success: dying 1 becomes 0");
    eq(down.hp, 1, "…and the hero wakes with 1 HP");
    ok(eng.events.some(ev => /regains consciousness/.test(ev.text)), "…which the Chronicle announces");
    eq(eng.cur(), down, "…and then takes the rest of the turn");
    eq(eng.actions, 3, "…with all three actions");

    down.hp = 0; down.dying = 2;
    pin([20, 12]); eng.beginTurn(0);
    eq(down.dying, 1, "a 12 against DC 12 is a success: dying 2 becomes 1");
    eq(eng.cur(), up, "…and still dying, the turn passes on at once through defer");

    down.dying = 1;
    pin([20, 5]); eng.beginTurn(0);
    eq(down.dying, 2, "a 5 against DC 11 is a failure: dying 1 becomes 2");
    pin([20, 1]); eng.beginTurn(0);
    eq(down.dying, 4 - 0, "a natural 1 slips two: dying 2 becomes 4…");
    eq(down.dead, true, "…and dying 4 is death");
    ok(eng.events.some(ev => /falls, and does not rise/.test(ev.text)), "…announced as the page always has");

    const tough = mk({ id: "t", side: "pc", name: "Cass", hp: 0, dying: 3, char: { specials: ["diehard"] } });
    const e2 = arena([tough, up, foe], hooks());
    pin([20, 5]); e2.beginTurn(0);
    eq([tough.dying, tough.dead], [4, false], "Diehard survives dying 4…");
    pin([20, 5]); e2.beginTurn(0);
    eq(tough.dead, true, "…and dies at 5");
  }
  // Persistent damage ticks at the start of the turn and ends on a 15.
  {
    const pc = mk({ id: "p", side: "pc", hp: 20, conditions: [{ c: "persistent", formula: "3", dtype: "fire", dur: 99 }] });
    const eng = arena([pc, mk({ id: "f" })], hooks());
    pin([20, 14]); eng.beginTurn(0);
    eq(pc.hp, 17, "persistent fire 3 burns for 3 at the start of the turn");
    eq(pc.conditions.length, 1, "…and a 14 on the flat check leaves it burning");
    pin([20, 15]); eng.beginTurn(0);
    eq(pc.hp, 14, "…it burns again");
    eq(pc.conditions, [], "…and a 15 puts it out");
    ok(eng.events.some(ev => /The fire afflicting/.test(ev.text)), "…with a line saying so");
    const frail = mk({ id: "q", hp: 2, conditions: [{ c: "persistent", formula: "3", dtype: "fire", dur: 99 }] });
    const e2 = arena([mk({ id: "p", side: "pc" }), frail, mk({ id: "g", x: 5, y: 5 })], hooks());
    e2.aiTurn = function(){ }; // hold the AI: this is about the tick, not the turn
    e2.beginTurn(1);
    eq(frail.dead, true, "a foe that burns to death at the top of its turn never acts");
    eq(e2.cur().id, "g", "…and the turn passes");
  }
  // The end of a turn ticks buffs and conditions.
  {
    const pc = mk({ id: "p", side: "pc",
      buffs: [{ name: "Bless", duration: 2 }, { name: "Shield", duration: 1 }, { name: "Sure Strike", fortune: true }],
      conditions: [{ c: "frightened", v: 2 }, { c: "sickened", v: 1 }, { c: "clumsy", v: 1, dur: 2 }, { c: "enfeebled", v: 1, dur: 1 }, { c: "fatigued", v: 1, dur: 99 }, { c: "prone", v: 1 }] });
    const eng = arena([pc, mk({ id: "f" })], hooks());
    eng.turnIdx = 0; eng.aiTurn = function(){ }; // stop at the foe
    eng.endTurn();
    eq(pc.buffs.map(b => b.name), ["Bless", "Sure Strike"], "a buff with a duration ticks down and leaves at 0; one without stays");
    eq(pc.buffs[0].duration, 1, "…Bless has one round left");
    eq(pc.conditions.map(c => c.c + c.v + (c.dur === undefined ? "" : "/" + c.dur)),
      ["frightened1", "clumsy1/1", "fatigued1/99", "prone1"],
      "frightened and sickened fall by 1, a timed condition ticks and leaves at 0, and 99 means the scene");
    const brave = mk({ id: "b", side: "pc", char: { specials: ["bravery"] }, conditions: [{ c: "frightened", v: 2 }] });
    const e2 = arena([brave, mk({ id: "f" })], hooks());
    e2.aiTurn = function(){ }; e2.endTurn();
    eq(brave.conditions, [], "Bravery shakes frightened off two at a time");
  }
  // The order wraps, skips the dead, and the ambush ends with round 1.
  {
    const a = mk({ id: "a", side: "pc" }), b = mk({ id: "b", side: "pc", dead: true }), f = mk({ id: "f" });
    const eng = arena([a, b, f], { ...hooks(), surprise: true });
    eng.aiTurn = function(){ };
    eng.turnIdx = 0; eng.nextTurn();
    eq(eng.turnIdx, 2, "the dead are skipped");
    eq(eng.round, 1, "…without touching the round");
    eng.nextTurn();
    eq([eng.turnIdx, eng.round], [0, 2], "wrapping to the top of the order starts round 2");
    eq(eng.surprise, false, "…and the scripted ambush is over");
  }
  // Victory and defeat.
  {
    const h = hooks();
    const hero = mk({ id: "h", side: "pc", hp: 20, hpMax: 40, char: { focusMax: 2 }, resources: { focus: 0 }, conditions: [{ c: "frightened", v: 1 }], buffs: [{ name: "x" }] });
    const down = mk({ id: "d", side: "pc", hp: 0, hpMax: 40, dying: 2 });
    const foe = mk({ id: "f", dead: true });
    const eng = arena([hero, down, foe], h);
    eq(eng.checkEnd(), true, "no foe standing ends the fight");
    eq(eng.active, false, "…and the engine goes inactive");
    eq(hero.hp, 30, "victory heals half of what is missing: 20 of 40 becomes 30");
    eq([down.dying, down.hp], [0, 21], "a dying hero gets up on 1 and then heals half of the rest");
    eq([hero.conditions, hero.buffs], [[], []], "conditions and buffs are cleared");
    eq(hero.resources.focus, 2, "focus is restored");
    eq(h.h.saves, 1, "the save-slot hook fires once");
    eq(h.h.victory, 1, "…and onVictory follows through defer");
    ok(eng.events.some(ev => /<b>Victory\.<\/b> The The Test is yours/.test(ev.text)), "the victory line names the encounter");

    const h2 = hooks();
    const e2 = arena([mk({ id: "p", side: "pc", dying: 1 }), mk({ id: "f" })], h2);
    eq(e2.checkEnd(), true, "every hero down ends the fight");
    eq([h2.h.defeat, h2.h.victory, e2.active], [1, 0, false], "…as a defeat");
    const e3 = arena([mk({ id: "p", side: "pc" }), mk({ id: "f" })], hooks());
    eq(e3.checkEnd(), false, "one hero standing and one foe standing is still a fight");
  }
}

group("combat engine: start");
Registry.loadPack(advPack);
ok(Registry.hasPack("barrowmoor") || Registry.adventures.barrowmoor, "the adventure pack is in the registry");
const ADV = Registry.adventures.barrowmoor;
/** A fighter with a longsword, a crossbow, a chain shirt and a shield. */
const fighter = (over = {}) => forge("fighter", { gear: { weapon: "longsword", weapon2: null, ranged: "crossbow", armor: "chain-shirt", shield: true }, ...over });
/** An engine with the hooks a fight needs to end, and counters on each. */
const fight = (over = {}) => {
  const h = { victory: 0, defeat: 0, saves: 0, mounts: 0, toasts: [], hints: [] };
  const eng = newCombat({ ...over });
  eng.autosave = () => h.saves++; eng.mount = () => h.mounts++;
  eng.toast = m => h.toasts.push(m); eng.hint = t => h.hints.push(t);
  eng.h = h;
  return eng;
};
const begin = (eng, encId, party, flags = {}, adv = ADV) =>
  eng.start(encId, adv, { party, flags, onVictory: () => eng.h.victory++, onDefeat: () => eng.h.defeat++ });
{
  const hero = heroCombatant(fighter());
  eq([hero.id, hero.side, hero.hp, hero.hpMax, hero.ac, hero.dying, hero.wounded], ["hero", "pc", 44, 44, 19, 0, 0],
    "heroCombatant carries the sheet's HP and AC and starts standing");
  eq(hero.resources, { slots: { 1: 0, 2: 0 }, focus: 0, font: 0, potions: ["healing-potion-minor", "healing-potion-minor"] },
    "a fighter has no slots, no focus, no font and the two potions every hero starts with");
  eq(hero.attacks.length, 2, "…and a copy of each attack");
  ok(hero.attacks[0] !== fighter().attacks[0], "…a copy, not the sheet's own object");
  const cleric = heroCombatant(forge("cleric", { subclass: "cloistered-sarenrae", spells: { cantrips: ["divine-lance"], r1: ["heal"], r2: ["heal"] } }));
  eq([cleric.resources.slots, cleric.resources.font, cleric.resources.focus], [{ 1: 3, 2: 2 }, 4, 1],
    "a cloistered cleric brings 3/2 slots, four font heals and one focus point");
  const wren = companionCombatant("wren");
  eq([wren.id, wren.side, wren.hp, wren.initSkill], ["comp-wren", "pc", 38, 12], "a companion is built from its Registry entry");
  eq(wren.attacks[0], { name: "Shortbow", bonus: 11, damage: "1d6", damageType: "piercing", range: 12, sneak: "1d6", die: "1d6", dmgMod: 0, traits: [], ranged: true },
    "…with `die` and `ranged` derived the way strike wants them");
  eq(companionCombatant("aldous").abilities[0].uses, 3, "…and its abilities copied with their uses");

  // The Causeway Pack, party of two.
  const eng = fight();
  const party = [heroCombatant(fighter()), companionCombatant("aldous")];
  // Initiative: hero (Perception 8), Aldous (initSkill 9), then the four foes.
  pin([20, 20], [20, 1], [20, 10], [20, 10], [20, 10], [20, 5]);
  begin(eng, "enc-moor", party);
  eq(eng.cbs.length, 6, "two heroes and four foes: the fifth foe needs a party of three");
  eq(eng.cbs.filter(c => c.side === "foe").map(c => c.id), ["foe0", "foe1", "foe2", "foe3"], "foe ids follow the encounter's own indices");
  eq(eng.cbs.filter(c => c.side === "foe").map(c => c.letter), ["M1", "M2", "S3", "M4"], "…and each gets an initial and a number for the token");
  eq([eng.mapW, eng.mapH, eng.walls.size, eng.diff.size], [13, 9, 6, 12], "the map, the walls and the bog come from the encounter");
  eq([party[0].x, party[0].y, party[1].x, party[1].y], [1, 4, 1, 3], "the party stands on pcStarts in order");
  eq([eng.cbs[2].x, eng.cbs[2].y, eng.cbs[2].hp, eng.cbs[2].ac, eng.cbs[2].speed], [8, 3, 24, 16, 7], "a hound stands where the encounter put it, with its stat block");
  eq(eng.cbs[4].immunities, ["void", "mental", "poison"], "a skeleton's immunities are on the combatant");
  eq(eng.cbs.map(c => c.init), [28, 10, 17, 17, 12, 12], "initiative is d20 + Perception (or initSkill)");
  eq(eng.order.map(c => c.id), ["hero", "foe0", "foe1", "foe2", "foe3", "comp-aldous"], "…and the order sorts by it, ties in place");
  eq([eng.round, eng.turnIdx, eng.active, eng.actions], [1, 0, true, 3], "the hero goes first with three actions");
  ok(/^<b>The Causeway Pack\.<\/b> Peat-black hounds lope up the causeway/.test(eng.events[0].text), "the first line is the encounter's name and intro");
  eq(eng.h.mounts, 1, "mount is called once, so the page can build the combat DOM");
  eq(eng.enc, ADV.encounters["enc-moor"], "…and the encounter is kept for finish to name");
  ok(eng.cbs[2].dying === undefined, "a foe still has no dying field (locked #90 — pinned, not fixed)");

  // A scripted ambush.
  const flags = { "surprise-round": true, "fatigued-start": true, other: true };
  const e2 = fight();
  const p2 = [heroCombatant(fighter()), companionCombatant("aldous")];
  pin([20, 1], [20, 1], [20, 20], [20, 20], [20, 20], [20, 20]);
  begin(e2, "enc-moor", p2, flags);
  eq(e2.surprise, true, "the surprise-round flag sets the ambush");
  eq(flags, { other: true }, "…and both start flags are consumed off the flags object, in place");
  eq(e2.order.slice(0, 2).map(c => c.side), ["pc", "pc"], "every ambushed foe acts after every hero, whatever it rolled");
  eq(e2.cbs[2].init, -73, "…because its initiative is docked 100: 20 + 7 − 100");
  eq(p2.map(c => c.conditions), [[{ c: "fatigued", v: 1, dur: 99 }], [{ c: "fatigued", v: 1, dur: 99 }]], "fatigued-start fatigues the whole party for the scene");
  ok(!e2.events.some(ev => /fatigued/.test(ev.text)), "…silently");
  eq(e2.effAC(e2.cbs[2], p2[0]).offGuard, true, "in the surprise round every foe is off-guard");
  // Play the round out: hero ends, Aldous ends, four foes act. Round 2.
  e2.actionClick("end"); e2.actionClick("end");
  eq(e2.round, 2, "two End Turns and four monster turns later it is round 2");
  eq(e2.surprise, false, "…and the ambush is spent");
  eq(e2.effAC(e2.cbs[2], p2[0]).offGuard, false, "…so the foes are no longer off-guard for free");
  ok(e2.events.filter(ev => ev.kind === "roll").length >= 4, "the monsters rolled something on their way in");

  // Boss flags.
  const e3 = fight();
  pin([20, 20]);
  begin(e3, "enc-crypt", [heroCombatant(fighter())], { "knows-rite": true });
  const boss = e3.cbs.find(c => c.boss);
  eq(boss.name, "The Bell-Warden", "the crypt has a boss");
  eq(boss.conditions, [{ c: "sickened", v: 1, dur: 99 }], "knowing the Rite sickens it for the scene");
  ok(e3.events.some(ev => /the Bell-Warden STAGGERS/.test(ev.text)), "…with the scene's own line");
  const e4 = fight(); pin([20, 20]);
  begin(e4, "enc-crypt", [heroCombatant(fighter())], {});
  eq(e4.cbs.find(c => c.boss).conditions, [], "…and not otherwise");
  eq(e4.cbs.filter(c => c.side === "foe").length, 3, "a lone hero faces the Warden and two guards; the champion and the wisp need a bigger party");
}
setDiceSource();

group("combat engine: the player's actions");
/** A board with the hooks a fight needs to end, three actions, and counters. */
const stage = (cbs, over = {}) => {
  const eng = arena(cbs, { actions: 3, enc: { name: "The Test" }, mapW: 10, mapH: 10, ...over });
  const h = { victory: 0, defeat: 0, saves: 0, toasts: [], hints: [] };
  eng.onVictory = () => h.victory++; eng.onDefeat = () => h.defeat++; eng.autosave = () => h.saves++;
  eng.toast = m => h.toasts.push(m); eng.hint = t => h.hints.push(t); eng.h = h;
  eng.aiTurn = function(){ }; // these are about the hero's turn; the monsters wait
  eng.beginTurn(0);           // per-turn flags (mapCount, reactionUsed…) come from here
  return eng;
};
/** A moor hound, as `start` would build it, at (x, y). */
const hound = (over = {}) => mk({ id: "f", name: "Hound", side: "foe", x: 2, y: 1, ac: 16, hp: 24, hpMax: 24, speed: 7,
  saves: { fort: 7, ref: 9, will: 5 }, perception: 7, immunities: [],
  attacks: [{ name: "Bite", bonus: 9, damage: "1d8+3", damageType: "piercing", range: 1 }],
  monster: { level: 1, traits: ["beast"] }, ...over });
/** The fighter at (1,1), a hound adjacent at (2,1), the fighter's turn. */
const duel = (chOver = {}, foeOver = {}, over = {}) => {
  const ch = fighter(chOver);
  const hero = Object.assign(heroCombatant(ch), { x: 1, y: 1 });
  const foe = hound(foeOver);
  const eng = stage([hero, foe], over);
  return { eng, hero, foe, ch };
};
const rolls = eng => eng.events.filter(ev => ev.kind === "roll");
{
  // Stride and Step.
  const { eng, hero, foe } = duel();
  eng.actionClick("stride");
  eq(eng.armed, { kind: "move", budget: 5, cost: 1, btn: "stride" }, "Stride arms a move with the hero's speed in squares");
  eq(eng.h.hints.at(-1), "Choose a highlighted square to Stride to.", "…and says what to do");
  eng.cellClick(9, 9);
  eq([hero.x, hero.y, eng.actions], [1, 1, 3], "a square past the budget is ignored");
  eng.cellClick(2, 1);
  eq([hero.x, hero.y, eng.actions], [1, 1, 3], "…as is the hound's own square");
  eng.cellClick(1, 4);
  eq([hero.x, hero.y, eng.actions, eng.armed], [1, 4, 2, null], "a reachable square moves the hero, costs one action and disarms");
  eng.actionClick("step");
  eq([eng.armed.budget, eng.armed.step], [1, true], "Step is a one-square move");
  eng.cellClick(1, 6);
  eq([hero.x, hero.y], [1, 4], "…so two squares is too far");
  eng.cellClick(2, 5);
  eq([hero.x, hero.y, eng.actions], [2, 5, 1], "…and one diagonal is fine");

  // Raise a Shield, Reload.
  const d2 = duel();
  d2.eng.actionClick("raise");
  eq([d2.hero.shieldRaised, d2.eng.actions], [true, 2], "Raise a Shield costs one action and raises it");
  eq(d2.eng.effAC(d2.hero).ac, 21, "…for +2 AC");
  ok(d2.eng.events.some(ev => /raises a shield/.test(ev.text)), "…and a Chronicle line");
  d2.eng.actionClick("reload");
  eq([d2.hero.reloadedThisTurn, d2.eng.actions], [true, 1], "Reload costs one action and marks the crossbow loaded");

  // Strike, through the target flow.
  const d3 = duel();
  const far = hound({ id: "g", name: "Far Hound", x: 8, y: 8 });
  d3.eng.cbs.push(far); d3.eng.order.push(far);
  d3.eng.tokenClick(d3.foe);
  eq(d3.eng.h.toasts, ["Hound: HP 24/24 · AC 16"], "clicking a token with nothing armed shows its stats");
  d3.eng.actionClick("strike0");
  eq(d3.eng.armed, { kind: "target", range: 1, cost: 1, mode: "strike", atkIdx: 0, btn: "strike0" }, "Strike arms a target within the weapon's range");
  eq(d3.eng.targets(d3.eng.armed).map(t => t.id), ["f"], "…and only the adjacent hound qualifies");
  d3.eng.tokenClick(far);
  eq([d3.eng.actions, !!d3.eng.armed], [3, true], "clicking a foe out of range does nothing");
  pin([20, 15], [8, 4]);
  d3.eng.tokenClick(d3.foe);
  eq(d3.foe.hp, 18, "15+10 vs AC 16 hits for 1d8+2 = 6");
  eq([d3.eng.actions, d3.eng.armed, d3.eng.sel], [2, null, null], "…costs one action, and disarms");
  d3.eng.actionClick("strike1");
  eq(d3.eng.targets(d3.eng.armed).map(t => t.id), ["f", "g"], "the crossbow reaches both hounds");
  const e2 = stage([Object.assign(heroCombatant(fighter()), { x: 1, y: 1 }), hound({ x: 5, y: 1 })], { walls: ["3,1"] });
  e2.actionClick("strike1");
  eq(e2.targets(e2.armed), [], "…but not through a wall");

  // targets() and friendly fire.
  const ally = mk({ id: "a", side: "pc", name: "Bran", x: 1, y: 2, dying: 1 });
  const d4 = duel(); d4.eng.cbs.push(ally);
  eq(d4.eng.targets({ kind: "target", range: 1, friendly: true }).map(t => t.id), ["hero"], "a friendly action skips a dying ally by default");
  eq(d4.eng.targets({ kind: "target", range: 1, friendly: true, canDowned: true }).map(t => t.id), ["hero", "a"], "…unless it can reach the downed");

  // Hunt Prey.
  const d5 = duel();
  d5.eng.actionClick("hunt"); d5.eng.tokenClick(d5.foe);
  eq([d5.eng.huntPreyId, d5.eng.actions], ["f", 2], "Hunt Prey marks the target and costs an action");
  ok(d5.eng.events.some(ev => /<b>Hunts Prey<\/b>: Hound/.test(ev.text)), "…and says so");
}
{
  // Demoralize: Intimidation vs 10 + Will + level, −4 without a shared language.
  const { eng, hero, foe, ch } = duel();
  eq(skillMod(ch, "intimidation"), 1, "an untrained fighter's Intimidation is just Charisma");
  eng.actionClick("demoralize");
  eq(eng.armed.range, 6, "Demoralize reaches 30 feet");
  pin([20, 20]); eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "20-3 = 17 vs DC 18", "a −4 for no shared language: 1 − 4 = −3 against DC 10 + 5 + 3");
  eq(rolls(eng).at(-1).deg, 2, "…17 misses 18, and the natural 20 makes it a success");
  eq(foe.conditions, [{ c: "frightened", v: 1, dur: undefined }], "…frightened 1");
  eq([foe.demoralized, eng.actions], [true, 2], "…and the hound remembers, and it cost an action");
  const d2 = duel({}, {}, {}); d2.ch.specials.push("intimidating-glare", "terrified-retreat");
  d2.eng.actionClick("demoralize"); pin([20, 20]); d2.eng.tokenClick(d2.foe);
  eq(rolls(d2.eng).at(-1).math, "20+1 = 21 vs DC 18", "Intimidating Glare drops the language penalty");
  eq(d2.foe.conditions.map(c => c.c + c.v), ["frightened2", "fleeing1"], "a critical success is frightened 2, and Terrified Retreat sends a level-1 hound running");
  const d3 = duel({}, { immunities: ["void", "mental", "poison"], name: "Skeleton" });
  d3.eng.actionClick("demoralize"); pin([20, 20]); d3.eng.tokenClick(d3.foe);
  eq(d3.foe.conditions, [], "a mindless skeleton cannot be frightened");
  ok(d3.eng.events.some(ev => /Skeleton is immune \(mindless\)/.test(ev.text)), "…and the Chronicle says why");

  // Feint: Deception vs 10 + Perception.
  const d4 = duel();
  d4.eng.actionClick("feint"); pin([20, 20]); d4.eng.tokenClick(d4.foe);
  eq(rolls(d4.eng).at(-1).math, "20+1 = 21 vs DC 17", "Feint is Deception against 10 + the hound's Perception 7");
  eq(d4.foe.feint, { by: "hero", round: 1, turnIdx: 0, usesLeft: 1 }, "a success is one off-guard Strike, this turn, from this feinter");
  ok(d4.eng.events.some(ev => /off-guard to Testcase's attacks \(next Strike\)/.test(ev.text)), "…announced");
  const d5 = duel(); d5.ch.specials.push("racket-scoundrel");
  d5.eng.actionClick("feint"); pin([20, 20]); d5.eng.tokenClick(d5.foe);
  ok(d5.foe.feint.usesLeft === Infinity, "a Scoundrel's Feint lasts the whole turn");
  const d6 = duel();
  d6.eng.actionClick("feint"); pin([20, 5]); d6.eng.tokenClick(d6.foe);
  eq(d6.foe.feint, undefined, "a failed Feint leaves nothing");
  ok(d6.eng.events.some(ev => /Feint fails to fool Hound/.test(ev.text)), "…but a line");

  // Battle Medicine: Medicine vs DC 15.
  const patient = () => mk({ id: "a", side: "pc", name: "Bran", x: 1, y: 2, hp: 20, hpMax: 44 });
  const d7 = duel(); const p7 = patient(); d7.eng.cbs.push(p7);
  d7.eng.actionClick("battlemed");
  eq([d7.eng.armed.friendly, d7.eng.armed.canDowned], [true, true], "Battle Medicine targets an ally, downed or not");
  pin([20, 14], [8, 3], [8, 4]); d7.eng.tokenClick(p7);
  eq(rolls(d7.eng).at(-1).math, "14+1 = 15 vs DC 15", "…against a flat DC 15");
  eq(p7.hp, 27, "a success heals 2d8: 3 + 4");
  const d8 = duel(); const p8 = patient(); d8.eng.cbs.push(p8);
  d8.eng.actionClick("battlemed"); pin([20, 20], [8, 3], [8, 4]); d8.eng.tokenClick(p8);
  eq(p8.hp, 37, "a critical success heals 2d8+10");
  const d9 = duel(); const p9 = patient(); d9.eng.cbs.push(p9);
  d9.eng.actionClick("battlemed"); pin([20, 1], [8, 5]); d9.eng.tokenClick(p9);
  eq(p9.hp, 15, "a critical failure cuts the patient for 1d8");

  // A potion.
  const d10 = duel();
  d10.eng.actionClick("potion"); pin([8, 6]); d10.eng.tokenClick(d10.hero);
  eq(d10.hero.resources.potions.length, 1, "drinking a potion spends it");
  ok(d10.eng.events.some(ev => /Testcase drinks Minor Healing Potion \(\+6\)/.test(ev.text)), "…and names it");
  eq(d10.eng.actions, 2, "…for one action");
}
{
  // The fighter's feats.
  const d1 = duel(); d1.ch.specials.push("power-attack");
  d1.eng.actionClick("powerattack");
  eq([d1.eng.armed.cost, d1.eng.armed.mode], [2, "powerattack"], "Power Attack costs two actions");
  pin([20, 15], [8, 4], [8, 3]); d1.eng.tokenClick(d1.foe);
  eq(rolls(d1.eng).at(-1).math, "15+5 = 20 vs AC 16", "…and counts as two attacks for MAP: −5 on the roll itself");
  eq(d1.foe.hp, 15, "…hitting for two dice: 4 + 3 + 2");
  eq([d1.hero.mapCount, d1.eng.actions], [2, 1], "…leaving the MAP at two attacks");

  const d2 = duel(); d2.ch.specials.push("intimidating-strike");
  d2.eng.actionClick("intstrike"); pin([20, 15], [8, 4]); d2.eng.tokenClick(d2.foe);
  eq(d2.foe.conditions.map(c => c.c + c.v), ["frightened1"], "Intimidating Strike frightens on a hit");
  eq(d2.eng.actions, 1, "…for two actions");

  const d3 = duel(); d3.ch.specials.push("brutish-shove");
  d3.eng.actionClick("brutish"); pin([20, 15], [8, 4]); d3.eng.tokenClick(d3.foe);
  eq([d3.foe.offGuardUntil, d3.foe.conditions], [1, [{ c: "clumsy", v: 1, dur: 1 }]], "Brutish Shove leaves the target off-guard and clumsy for a round");
  eq(d3.eng.effAC(d3.foe, d3.hero, { forceOffGuard: d3.foe.offGuardUntil === d3.eng.round }).ac, 13, "…AC 16 less clumsy 1 less off-guard 2");

  const d4 = duel(); d4.ch.specials.push("exacting-strike");
  d4.eng.actionClick("exacting"); pin([20, 2], [8, 4]); d4.eng.tokenClick(d4.foe);
  eq(d4.hero.mapCount, 0, "an Exacting Strike that misses does not raise the MAP");

  const d5 = duel(); d5.ch.specials.push("sudden-charge");
  d5.eng.actionClick("charge");
  eq([d5.eng.armed.budget, d5.eng.armed.cost, d5.eng.armed.charge], [10, 2, true], "Sudden Charge is a double-speed move for two actions");
  d5.eng.cellClick(1, 2);
  eq([d5.eng.actions, d5.eng.armed.mode, d5.eng.armed.btn], [1, "strike", "charge2"], "…and then arms a free Strike");
  eq(d5.eng.h.hints.at(-1), "Now Strike an adjacent foe (free).", "…and says so");
  pin([20, 15], [8, 4]); d5.eng.tokenClick(d5.foe);
  eq([d5.foe.hp, d5.eng.actions], [18, 1], "…which costs nothing");
}
{
  // The ranger's flourishes.
  const ranger = () => forge("ranger", { subclass: "flurry", gear: { weapon: "shortsword", weapon2: "shortsword", ranged: "shortbow", armor: "studded-leather", shield: false } });
  const r1 = ranger();
  const hero = Object.assign(heroCombatant(r1), { x: 1, y: 1 });
  const foe = hound();
  const eng = stage([hero, foe]);
  r1.specials.push("hunted-shot", "twin-takedown", "twin-feint");
  eng.actionClick("huntedshot"); eng.tokenClick(foe);
  eq([eng.actions, eng.h.hints.at(-1)], [3, "Hunted Shot only works on your prey."], "Hunted Shot without prey refuses, for free");
  eng.huntPreyId = "f"; eng.armed = null;
  eng.actionClick("huntedshot");
  eq(eng.armed.range, 12, "…and reaches as far as the bow");
  pin([20, 15], [6, 3], [20, 15], [6, 3]); eng.tokenClick(foe);
  eq(rolls(eng).length, 2, "Hunted Shot is two Strikes");
  eq(rolls(eng)[1].math.startsWith("15+"), true, "…the second under MAP");
  eq([hero.flourishUsed, eng.actions], [true, 2], "…one flourish, one action");
  const e2 = stage([Object.assign(heroCombatant(ranger()), { x: 1, y: 1 }), hound()], { huntPreyId: "f" });
  e2.cur().char.specials.push("twin-takedown", "twin-feint");
  e2.actionClick("twintake"); pin([20, 15], [6, 3], [20, 15], [6, 3]); e2.tokenClick(e2.cbs[1]);
  eq(rolls(e2).map(r => r.text.split(":")[1].trim().split(" vs")[0]), ["Shortsword", "Shortsword"], "Twin Takedown swings both blades");
  const e3 = stage([Object.assign(heroCombatant(ranger()), { x: 1, y: 1 }), hound()]);
  e3.cur().char.specials.push("twin-feint");
  e3.actionClick("twinfeint"); pin([20, 15], [6, 3], [20, 15], [6, 3]); e3.tokenClick(e3.cbs[1]);
  eq(rolls(e3).map(r => /off-guard/.test(r.text)), [false, true], "Twin Feint lands the second blade off-guard");
  eq(e3.actions, 1, "…for two actions");
}
{
  // A companion's ability, Cackle, and End Turn.
  const hero = Object.assign(heroCombatant(fighter()), { x: 1, y: 1, hp: 10 });
  const aldous = Object.assign(companionCombatant("aldous"), { x: 1, y: 2 });
  const foe = hound();
  const eng = stage([aldous, hero, foe]);
  eng.actionClick("abil0");
  eq([eng.armed.mode, eng.armed.cost, eng.armed.friendly, eng.armed.range], ["companion-abil", 2, true, 6], "Aldous's Heal arms a two-action friendly target");
  pin([8, 3], [8, 4]); eng.tokenClick(hero);
  eq(hero.hp, 33, "…and heals 2d8+16: 3 + 4 + 16");
  eq([aldous.abilities[0].uses, eng.actions], [2, 1], "…spending one use and two actions");

  const witch = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
  witch.char.focusMax = 2; witch.resources.focus = 0; witch.char.specials.push("cackle");
  const e2 = stage([witch, hound()]);
  e2.actionClick("cackle");
  eq([witch.resources.focus, witch.cackled, e2.actions], [1, true, 3], "Cackle is a free action for one focus point");

  const e3 = stage([Object.assign(heroCombatant(fighter()), { x: 1, y: 1 }), hound()]);
  e3.actionClick("end");
  eq([e3.turnIdx, e3.cur().id], [1, "f"], "End Turn hands the turn to the hound");
}
{
  // Reactive Strike, through provokeAlong.
  const knight = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
  const foe = hound();
  const eng = stage([knight, foe]);
  pin([20, 15], [8, 4]);
  eng.provokeAlong(foe, [{ x: 2, y: 1 }, { x: 2, y: 2 }]);
  eq(rolls(eng).length, 0, "a hound that stays in reach provokes nothing");
  eng.provokeAlong(foe, [{ x: 4, y: 1 }, { x: 5, y: 1 }]);
  eq(rolls(eng).length, 0, "…nor one that was never in reach");
  eng.provokeAlong(foe, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  eq(rolls(eng).length, 1, "…one that leaves reach takes a Reactive Strike");
  eq([foe.hp, knight.reactionUsed, knight.mapCount], [18, true, 0], "…which hits, spends the reaction, and does not touch the MAP");
  ok(eng.events.some(ev => /<b>Reactive Strike!<\/b> Testcase lashes out as Hound moves/.test(ev.text)), "…with its line");
  eng.provokeAlong(foe, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  eq(rolls(eng).length, 1, "…and the reaction is spent for the turn");
  // Two fighters, one hound with 1 HP: the first kills it and the second has nothing to hit.
  const k1 = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
  const k2 = Object.assign(heroCombatant(fighter()), { id: "hero2", x: 1, y: 2 });
  const frail = hound({ hp: 1, x: 2, y: 1 });
  const e2 = stage([k1, k2, frail]);
  pin([20, 15], [8, 4]);
  e2.provokeAlong(frail, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  eq([frail.dead, rolls(e2).length, k2.reactionUsed], [true, 1, undefined], "a hound killed mid-step stops there, and the second fighter keeps their reaction");
  // Phase 3: the side check is gone. A hero who Strides out of a monster's
  // reach provokes exactly as a monster does.
  const e3 = stage([Object.assign(heroCombatant(fighter()), { x: 2, y: 1 }), hound({ x: 1, y: 1, reactions: ["reactive-strike"] })]);
  pin([20, 15], [8, 4]);
  e3.provokeAlong(e3.cbs[0], [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  eq(rolls(e3).length, 1, "a moving hero provokes a monster that carries the reaction");
  ok(e3.events.some(ev => /<b>Reactive Strike!<\/b> Hound lashes out as Testcase moves/.test(ev.text)), "…with the same line, the other way round");
}
setDiceSource();

/* ---------------- 11. the reaction bus ---------------- */
/* Phase 3. Three reactions used to fire from wherever they happened to be
   reachable — two from inside the damage path, the third from a provokeAlong
   that refused any mover that was not a foe. They are on one bus now. */
group("combat engine: the reaction bus");
{
  // registry.js cannot import combat.js, because combat.js imports registry.js.
  // So the reaction ids live in two files, and this is the only thing that
  // notices when one of them grows and the other does not.
  eq(Object.keys(REACTIONS).sort(), [...KNOWN_REACTIONS].sort(),
    "js/combat.js and js/registry.js name the same reactions");
  for (const [id, r] of Object.entries(REACTIONS)) {
    ok(Array.isArray(r.triggers) && r.triggers.length > 0, `${id} answers at least one trigger`);
    ok(typeof r.qualifies === "function" && typeof r.resolve === "function", `${id} brings both halves`);
  }
  eq(REACTIONS["reactive-strike"].triggers, ["move-out-of-reach", "manipulate"],
    "Reactive Strike answers a move and a manipulate, as the feat text says");
}
{
  // Reach, read per combatant.
  const tyrant = hound({ id: "t", name: "Tyrant", x: 2, y: 2, reach: 2, reactions: ["reactive-strike"] });
  const runner = Object.assign(heroCombatant(fighter()), { x: 4, y: 2 });
  const eng = stage([runner, tyrant]);
  eq([eng.reachOf(tyrant), eng.reachOf(runner)], [2, 1],
    "reach comes off the combatant in cells, and defaults to the eight squares around it");
  pin([20, 15], [8, 4]);
  eng.provokeAlong(runner, [{ x: 4, y: 2 }, { x: 5, y: 2 }]);
  eq(rolls(eng).length, 1, "leaving the second ring of a reach-2 monster provokes");
  tyrant.reactionUsed = false; eng.events.length = 0;
  eng.provokeAlong(runner, [{ x: 3, y: 2 }, { x: 4, y: 2 }]);
  eq(rolls(eng).length, 0, "…and moving from its first ring to its second does not");

  // One reaction per turn, whatever the trigger.
  tyrant.reactionUsed = false; eng.events.length = 0;
  pin([20, 15], [8, 4], [20, 15], [8, 4]);
  eng.provokeAlong(runner, [{ x: 4, y: 2 }, { x: 5, y: 2 }]);
  eng.trigger("manipulate", { actor: runner });
  eq(rolls(eng).length, 1, "a second trigger in the same round finds the reaction already spent");
  tyrant.reactionUsed = false; eng.events.length = 0;
  pin([20, 15], [8, 4]);
  eng.trigger("manipulate", { actor: runner });
  eq(rolls(eng).length, 1, "…and on a fresh reaction, a manipulate provokes from anyone already within reach");
}
{
  // Mobility, which had never been readable by any code at all.
  const walker = Object.assign(heroCombatant(fighter()), { x: 2, y: 1 });
  walker.char = { ...walker.char, specials: [...walker.char.specials, "mobility"] };
  const guard = hound({ x: 1, y: 1, reactions: ["reactive-strike"] });
  const eng = stage([walker, guard]);
  eq(eng.moveBudget(walker), 5, "the fighter Strides five squares, so Mobility covers two");
  pin([20, 18], [8, 8]);
  eng.actionClick("stride");
  eng.cellClick(4, 1);
  eq([walker.x, rolls(eng).length], [4, 0], "a Stride of half speed draws nothing");
  ok(eng.events.some(ev => /<b>Mobility<\/b> gives nothing away/.test(ev.text)), "…and the Chronicle says why");
  walker.x = 2; walker.y = 1; guard.reactionUsed = false; eng.events.length = 0; eng.actions = 3;
  pin([20, 18], [8, 8]);
  eng.actionClick("stride");
  eng.cellClick(5, 1);
  eq([walker.x, rolls(eng).length], [5, 1], "one square further than half speed does not");

  // Without the feat, the same two squares provoke.
  const plain = Object.assign(heroCombatant(fighter()), { x: 2, y: 1 });
  const g2 = hound({ x: 1, y: 1, reactions: ["reactive-strike"] });
  const e2 = stage([plain, g2]);
  pin([20, 18], [8, 8]);
  e2.actionClick("stride");
  e2.cellClick(4, 1);
  eq(rolls(e2).length, 1, "…and a hero without Mobility is struck for the same short walk");
}
{
  // A foe that dies to a Reactive Strike mid-move stops where it fell, and its
  // turn ends rather than stalling the loop.
  const knight = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
  const frail = hound({ hp: 1, hpMax: 24, x: 2, y: 1 });
  const eng = stage([knight, frail], { order: null });
  eng.addCond(frail, "fleeing", 1, 2, true);
  eng.turnIdx = 1; eng.actions = 3;
  pin([20, 18], [8, 8]);
  const step = eng.aiStep(frail);
  eq([frail.dead, frail.x, frail.y], [true, 2, 1], "a hound cut down as it flees never reaches the square it ran to");
  eq(step, null, "…and its turn is over");
  eq([eng.active, eng.h.victory], [false, 1], "…ended rather than stalled: the last foe is down, so the fight is won");

  // And the same thing one step later: a foe killed by a reaction during its
  // own move finds itself dead when `aiStep` comes round again, which is the
  // only place left that can hand the turn on.
  const knight2 = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
  const gone = hound({ x: 4, y: 4, dead: true });
  const second = hound({ id: "f2", name: "Second", x: 5, y: 5 });
  const e2 = stage([knight2, gone, second], { order: null });
  e2.turnIdx = 1; e2.actions = 2;
  eq(e2.aiStep(gone), null, "a foe already dead when its next step comes round takes no action");
  eq(e2.turnIdx, 2, "…and its turn is handed on rather than stalling the loop");
}
{
  // The ask, and what a "no" costs. Only a combatant carrying more than one
  // reaction is asked, because one reaction is not a choice.
  const ward = mk({ id: "w", side: "pc", name: "Ward", hp: 40, hpMax: 40, shieldRaised: true, reactionUsed: false,
                    char: { specials: ["shield-block", "nimble-dodge"], resists: [] } });
  const eng = arena([ward]);
  const asked = [];
  eng.askReaction = (cb, rid) => { asked.push(rid); return false; };
  eq(eng.applyDamage(ward, 12, "slashing"), 12, "a refused Shield Block does not eat the hit");
  eq([asked, ward.reactionUsed], [["shield-block"], false], "…and leaves the reaction unspent for the next trigger");
  eng.askReaction = () => true;
  eq(eng.applyDamage(ward, 12, "slashing"), 7, "…which a yes then spends");

  const solo = mk({ id: "s", side: "pc", name: "Solo", hp: 40, hpMax: 40, shieldRaised: true, reactionUsed: false,
                    char: { specials: ["shield-block"], resists: [] } });
  const e2 = arena([solo]);
  let count = 0; e2.askReaction = () => { count++; return true; };
  eq(e2.applyDamage(solo, 12, "slashing"), 7, "one reaction in the kit still fires");
  eq(count, 0, "…without asking, because there is nothing to weigh it against");
}
{
  // Drink Potion and Reload are manipulate actions, and manipulate provokes.
  const drinker = Object.assign(heroCombatant(fighter()), { x: 2, y: 2, hp: 20 });
  const watcher = hound({ x: 3, y: 2, reactions: ["reactive-strike"] });
  const eng = stage([drinker, watcher]);
  pin([20, 3], [8, 6]);
  eng.actionClick("potion");
  eng.tokenClick(drinker);
  eq(rolls(eng).length, 1, "drinking a potion provokes from an adjacent foe");
  eq([drinker.resources.potions.length, drinker.hp], [1, 26], "…and the potion is still drunk when the strike misses");

  watcher.reactionUsed = false; eng.events.length = 0; eng.actions = 3;
  pin([20, 3]);
  eng.actionClick("reload");
  eq([rolls(eng).length, drinker.reloadedThisTurn], [1, true], "Reload provokes too, and still reloads");
}
{
  // start reads both new fields off the monster, and defaults them.
  Registry.monsters["reach-test"] = {
    id: "reach-test", name: "Long-Arm", ac: 18, hp: 30, speed: 25, perception: 8,
    saves: { fort: 8, ref: 8, will: 8 }, reach: 2, reactions: ["reactive-strike"],
    attacks: [{ name: "Halberd", bonus: 12, damage: "1d10+4", damageType: "slashing", range: 1 }]
  };
  const adv = { encounters: { e: { name: "Reach", w: 8, h: 8, terrain: {}, pcStarts: [[0, 0]],
    foes: [{ monster: "reach-test", x: 4, y: 4 }, { monster: "moor-hound", x: 5, y: 5 }] } } };
  const eng = fight();
  eng.aiTurn = function(){ };
  begin(eng, "e", [heroCombatant(fighter())], {}, adv);
  const [longArm, plain] = eng.cbs.filter(c => c.side === "foe");
  eq([longArm.reach, longArm.reactions], [2, ["reactive-strike"]], "start carries reach and reactions off the monster");
  eq([plain.reach, plain.reactions], [1, []], "…and a monster that declares neither threatens one square and reacts to nothing");
  eq(eng.reactionsOf(longArm), ["reactive-strike"], "reactionsOf reads a monster's data");
  eq(eng.reactionsOf(eng.cbs[0]).includes("shield-block"), true, "…and a hero's feats");
  delete Registry.monsters["reach-test"];
}
{
  // A monster's Reactive Strike is off-turn, so it must not spend the MAP its
  // own turn is counting.
  const knight = Object.assign(heroCombatant(fighter()), { x: 2, y: 1 });
  const guard = hound({ x: 1, y: 1, reactions: ["reactive-strike"], mapCount: 1 });
  const eng = stage([knight, guard]);
  pin([20, 15], [8, 4]);
  eng.provokeAlong(knight, [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
  eq([rolls(eng).length, guard.mapCount], [1, 1], "a monster's Reactive Strike leaves its own MAP where it was");
  const seal = rolls(eng)[0];
  ok(seal && seal.math.startsWith("15+9"), "…and is rolled at the flat attack bonus, not the second-attack penalty");
}
setDiceSource();

group("combat engine: spells");
const CLERIC = () => forge("cleric", { subclass: "cloistered-sarenrae", spells: { cantrips: ["divine-lance", "stabilize", "guidance"], r1: ["heal", "bless", "fear", "bane"], r2: ["heal", "resist-energy"] } });
const WIZARD = () => forge("wizard", { subclass: "school-battle-magic", spells: { cantrips: ["electric-arc", "ignition", "frostbite", "shield"], r1: ["force-barrage", "grim-tendrils", "breathe-fire", "sure-strike"], r2: ["blazing-bolt", "false-life", "blur"] } });
/** A caster at (2,2), an ally at (2,3) on 10 HP, a hound at (4,2) and a skeleton at (5,2). */
const sanctum = (ch, over = {}) => {
  const caster = Object.assign(heroCombatant(ch), { x: 2, y: 2 });
  const ally = mk({ id: "a", side: "pc", name: "Bran", x: 2, y: 3, hp: 10, hpMax: 44 });
  const foe = hound({ x: 4, y: 2 });
  const skel = hound({ id: "s", name: "Skeleton Guard", x: 5, y: 2, hp: 8, hpMax: 8, saves: { fort: 2, ref: 8, will: 2 },
    immunities: ["void", "mental", "poison"], resistances: [{ type: "cold", value: 1 }, { type: "electricity", value: 1 }, { type: "fire", value: 1 }, { type: "piercing", value: 1 }],
    monster: { level: -1, traits: ["undead", "skeleton", "mindless"] } });
  const eng = stage([caster, ally, foe, skel], over);
  const arm = (id, rank, pool) => eng.armSpell(caster, { sp: Registry.spells[id], rank, pool });
  return { eng, caster, ally, foe, skel, arm };
};
{
  // The menu's rows.
  const { eng, caster } = sanctum(CLERIC());
  const rows = eng.spellRows(caster, false);
  eq(rows.map(r => r.label), ["Divine Lance (cantrip)", "Stabilize (cantrip)", "Guidance (cantrip)", "Heal (rank 1)", "Bless (rank 1)", "Fear (rank 1)", "Bane (rank 1)", "Heal (rank 2)", "Resist Energy (rank 2)", "Heal — Divine Font (rank 2)"],
    "the menu lists cantrips, rank 1, rank 2, then the font");
  eq(rows.map(r => r.rank), [2, 2, 2, 1, 1, 1, 1, 2, 2, 2], "cantrips heighten to rank 2 at level 3");
  eq(rows.map(r => r.pool), ["cantrip", "cantrip", "cantrip", "r1", "r1", "r1", "r1", "r2", "r2", "font"], "…each row knows which pool it spends");
  eq(rows.every(r => !r.spent && !r.hexBlocked), true, "with full slots nothing is greyed out");
  caster.resources.slots[1] = 0; caster.resources.font = 0;
  const rows2 = eng.spellRows(caster, false);
  eq(rows2.filter(r => r.spent).map(r => r.label), ["Heal (rank 1)", "Bless (rank 1)", "Fear (rank 1)", "Bane (rank 1)"], "empty rank-1 slots grey out every rank-1 row");
  eq(rows2.some(r => r.pool === "font"), false, "…and a spent font has no row at all");
  const focus = eng.spellRows(caster, true);
  eq(focus.map(r => [r.label, r.pool, r.spent]), [["Fire Ray (1 focus)", "focus", false]], "the focus menu is the class's focus spell");
  caster.resources.focus = 0;
  eq(eng.spellRows(caster, true)[0].spent, true, "…greyed out with no focus left");
  const witch = Object.assign(heroCombatant(forge("witch", { subclass: "wilding-steward" })), { x: 2, y: 2 });
  const e2 = stage([witch, hound()]);
  eq(e2.spellRows(witch, true).map(r => [r.label, r.spent, r.hexBlocked]), [["Wilding Word (Hex) (hex — free, 1/turn)", false, false]], "a hex is free");
  witch.resources.focus = 0;
  eq(e2.spellRows(witch, true)[0].spent, false, "…even with no focus");
  witch.hexUsed = true;
  eq(e2.spellRows(witch, true)[0].hexBlocked, true, "…but once per turn");

  // effectFor picks the highest rank at or below the cast.
  eq(eng.effectFor(Registry.spells.heal, 2), { heal: "2d8+16" }, "Heal at rank 2 is 2d8+16");
  eq(eng.effectFor(Registry.spells.heal, 1), { heal: "1d8+8" }, "…and at rank 1, 1d8+8");
  eq(eng.effectFor(Registry.spells["blazing-bolt"], 1).damage[0].formula, "2d6", "a spell with no entry that low falls back to its first");

  // spendSpell.
  const c3 = heroCombatant(CLERIC());
  eng.spendSpell(c3, { pool: "r1", spell: Registry.spells.heal });
  eng.spendSpell(c3, { pool: "r2", spell: Registry.spells.heal });
  eng.spendSpell(c3, { pool: "font", spell: Registry.spells.heal });
  eng.spendSpell(c3, { pool: "focus", spell: Registry.spells["fire-ray"] });
  eq([c3.resources.slots, c3.resources.font, c3.resources.focus], [{ 1: 2, 2: 1 }, 3, 0], "each pool loses one");
  const w3 = heroCombatant(forge("witch", { subclass: "wilding-steward" }));
  eng.spendSpell(w3, { pool: "focus", spell: Registry.spells["wilding-word"] });
  eq([w3.resources.focus, w3.hexUsed], [1, true], "a hex costs no focus and marks the turn");
}
{
  // armSpell: what each shape arms.
  const { eng, caster, arm } = sanctum(CLERIC());
  arm("heal", 1, "r1");
  eq(eng.armed, { kind: "target", btn: "spell", mode: "spell-target", spell: Registry.spells.heal, castRank: 1, pool: "r1", cost: 2, range: 6, friendly: true, canDowned: true },
    "Heal arms a friendly target within 30 feet, downed or not");
  eq(eng.h.hints.at(-1), "Casting Heal — choose a target.", "…and says so");
  arm("divine-lance", 2, "cantrip");
  eq([eng.armed.kind, eng.armed.friendly, eng.armed.range], ["target", false, 12], "Divine Lance arms an enemy target within 60 feet");
  const { eng: w, arm: warm, caster: wiz } = sanctum(WIZARD());
  warm("breathe-fire", 1, "r1");
  eq([w.armed.kind, w.armed.range, w.armed.wedge], ["cell", 3, "cone"], "Breathe Fire arms a 15-foot cone");
  warm("grim-tendrils", 1, "r1");
  eq([w.armed.kind, w.armed.range, w.armed.wedge], ["cell", 6, "line"], "Grim Tendrils arms a 30-foot line");
  const fireball = { id: "fireball", name: "Fireball", actions: 2, range: 500, area: { shape: "burst", radius: 20 }, save: "reflex", basic: true, rankEffects: { 3: { damage: [{ formula: "6d6", type: "fire" }] } } };
  w.armSpell(wiz, { sp: fireball, rank: 3, pool: "r2" });
  eq([w.armed.kind, w.armed.range, w.armed.radius], ["cell", 100, 4], "a burst arms a point within range, with its radius in squares");
  w.actions = 1; w.armed = null;
  w.armSpell(wiz, { sp: Registry.spells["force-barrage"], rank: 1, pool: "r1" });
  eq([w.armed, w.h.toasts.at(-1)], [null, "Not enough actions."], "a two-action spell with one action left is refused with a toast");
  eq(wiz.resources.slots[1], 3, "…and nothing is spent");
}
{
  // Heal, in its three shapes.
  const { eng, caster, ally, foe, skel, arm } = sanctum(CLERIC());
  arm("heal", 1, "r1"); pin([8, 5]); eng.tokenClick(ally);
  eq(ally.hp, 23, "Heal at rank 1 is 1d8+8: 5 + 8 = 13");
  eq([caster.resources.slots[1], eng.actions, eng.armed], [2, 1, null], "…for a rank-1 slot and two actions, and disarms");
  ok(eng.events.some(ev => /Testcase casts <b>Heal<\/b>/.test(ev.text)) && eng.events.some(ev => /Bran regains 13 HP/.test(ev.text)), "…with both lines");
  const s2 = sanctum(CLERIC()); s2.caster.char.specials.push("healing-hands"); s2.eng.actions = 3;
  s2.arm("heal", 2, "r2"); pin([10, 7], [10, 9]); s2.eng.tokenClick(s2.ally);
  eq(s2.ally.hp, 42, "Healing Hands rolls d10s: 7 + 9 + 16 = 32");
  const s3 = sanctum(CLERIC());
  const zombie = hound({ id: "z", name: "Zombie", x: 3, y: 2, hp: 22, hpMax: 22, saves: { fort: 6, ref: 0, will: 2 }, weaknesses: [{ type: "vitality", value: 3 }], monster: { level: -1, traits: ["undead", "zombie"] } });
  s3.eng.cbs.push(zombie);
  s3.arm("heal", 1, "r1");
  eq(s3.eng.targets(s3.eng.armed).map(t => t.id), ["hero", "a"], "a friendly Heal only lists allies…");
  pin([8, 5], [20, 5]); s3.eng.castAt(s3.caster, s3.eng.armed, zombie);
  eq(rolls(s3.eng).at(-1).text, "Zombie: Fortitude save vs Heal", "…but cast at undead it is a Fortitude save");
  eq(zombie.hp, 6, "…a failed save takes the full 13 vitality, plus the zombie's weakness 3");
  ok(s3.eng.events.some(ev => /Weakness to vitality! \+3/.test(ev.text)), "…which the Chronicle notes");
  // Hymn's temporary HP, and Stabilize.
  const s4 = sanctum(CLERIC());
  pin([8, 2]); s4.eng.castAt(s4.caster, { kind: "target", spell: Registry.spells["hymn-of-healing"], castRank: 1, pool: "focus", cost: 2 }, s4.ally);
  eq([s4.ally.hp, s4.ally.tempHP], [16, 2], "Hymn of Healing heals 1d8+4 and grants 2 temporary HP");
  const s5 = sanctum(CLERIC()); s5.ally.hp = 0; s5.ally.dying = 2;
  s5.arm("stabilize", 2, "cantrip"); s5.eng.tokenClick(s5.ally);
  eq([s5.ally.dying, s5.ally.hp], [0, 0], "Stabilize ends dying without healing");
  ok(s5.eng.events.some(ev => /Bran is stabilized/.test(ev.text)), "…and says so");
}
{
  // Attack rolls, auto-hits and saves.
  const { eng, caster, foe, arm } = sanctum(WIZARD());
  arm("ignition", 2, "cantrip"); pin([20, 12], [4, 2], [4, 3], [4, 4]); eng.tokenClick(foe);
  eq(rolls(eng).at(-1), { kind: "roll", text: "Ignition vs Hound", cls: "roll", d20: 12, math: "12+7 = 19 vs AC 16", deg: 2 }, "a spell attack is d20 + the casting attack bonus against AC");
  eq(foe.hp, 15, "Ignition at rank 2 is 3d4 fire: 2 + 3 + 4 = 9");
  eq(caster.mapCount, 1, "…and it counts toward the MAP");
  const s2 = sanctum(WIZARD()); s2.caster.char.specials.push("burn-it");
  s2.arm("ignition", 2, "cantrip"); pin([20, 20], [4, 2], [4, 3], [4, 4]); s2.eng.tokenClick(s2.foe);
  eq(s2.foe.hp, 4, "a natural 20 doubles it, and Burn It! adds one first: (9 + 1) × 2");
  const s3 = sanctum(CLERIC()); s3.eng.actions = 3;
  pin([20, 20], [6, 3], [6, 3]); s3.eng.castAt(s3.caster, { kind: "target", spell: Registry.spells["fire-ray"], castRank: 2, pool: "focus", cost: 2 }, s3.foe);
  eq(s3.foe.conditions, [{ c: "persistent", formula: "1d4", dtype: "fire", dur: 99 }], "Fire Ray's critical hit leaves persistent fire");
  const s4 = sanctum(WIZARD());
  s4.arm("force-barrage", 1, "r1"); pin([4, 2], [4, 3]); s4.eng.tokenClick(s4.foe);
  eq([s4.foe.hp, rolls(s4.eng).length], [17, 0], "Force Barrage rolls nothing but damage: 2d4+2 = 7");

  // Basic saves, all four degrees. Frostbite is 3d4 cold against Fortitude 7 vs DC 17.
  const save = (d20, dice) => { const s = sanctum(WIZARD()); s.arm("frostbite", 2, "cantrip"); pin([20, d20], ...dice.map(v => [4, v])); s.eng.tokenClick(s.foe); return s; };
  eq(save(1, [2, 2, 2]).foe.hp, 12, "a natural 1 (total 8, a failure) is a critical failure: double damage");
  eq(save(5, [2, 2, 2]).foe.hp, 18, "a failure takes it all");
  eq(save(10, [2, 2, 3]).foe.hp, 21, "a success halves it, rounding down: 7 → 3");
  const s5 = save(20, [2, 2, 2]);
  eq(s5.foe.hp, 24, "a critical success takes none");
  ok(s5.eng.events.some(ev => /Hound evades entirely/.test(ev.text)), "…and the Chronicle says so");
  // Fear: no damage, a condition per degree. Will 5 vs DC 17.
  const fear = d20 => { const s = sanctum(CLERIC()); s.arm("fear", 1, "r1"); pin([20, d20]); s.eng.tokenClick(s.foe); return s.foe.conditions.map(c => c.c + c.v); };
  eq(fear(12), ["frightened1"], "Fear on a success is frightened 1");
  eq(fear(8), ["frightened2"], "…on a failure, frightened 2");
  eq(fear(1), ["frightened3", "fleeing1"], "…and on a critical failure, frightened 3 and fleeing");
  // Living only.
  const s6 = sanctum(WIZARD());
  s6.eng.castAt(s6.caster, { kind: "target", spell: Registry.spells["void-warp"], castRank: 2, pool: "cantrip", cost: 2 }, s6.skel);
  eq([s6.skel.hp, rolls(s6.eng).length], [8, 0], "Void Warp has nothing to drain from a skeleton");
  ok(s6.eng.events.some(ev => /Skeleton Guard has no life to drain/.test(ev.text)), "…and says so");
}
{
  // Areas: a line, a cone, an emanation, a burst, and an arc.
  const { eng, caster, ally, foe, skel, arm } = sanctum(WIZARD());
  const inTheWay = mk({ id: "w", side: "pc", name: "Wren", x: 3, y: 2, hp: 30, hpMax: 38 }); eng.cbs.push(inTheWay);
  arm("grim-tendrils", 1, "r1"); pin([20, 5], [4, 2], [4, 3]); eng.cellClick(6, 2);
  eq(foe.hp, 19, "Grim Tendrils along the row catches the hound: a failed Reflex save, 2d4 void");
  eq(foe.conditions, [{ c: "persistent", formula: "1", dtype: "bleed", dur: 99 }], "…and it bleeds");
  eq(skel.hp, 8, "the skeleton on the same line has no life to drain");
  eq([ally.hp, inTheWay.hp], [10, 30], "…the ally beside the caster is not on it, and the ally standing in it is not an enemy");
  const s2 = sanctum(WIZARD());
  const south = hound({ id: "south", name: "South Hound", x: 2, y: 4 }), behind = hound({ id: "behind", name: "Behind Hound", x: 0, y: 2 });
  s2.eng.cbs.push(south, behind);
  s2.arm("breathe-fire", 1, "r1"); pin([20, 5], [6, 2], [6, 2], [20, 5], [6, 2], [6, 2]); s2.eng.cellClick(4, 2);
  eq([s2.foe.hp, behind.hp, s2.ally.hp], [20, 24, 10], "Breathe Fire east catches the hound ahead, not the one behind, and never an ally");
  eq(south.hp, 20, "…and also a hound due south two squares away: the cone is a quadrant test (standing backlog, pinned as-is)");
  const s3 = sanctum(CLERIC());
  s3.arm("bane", 1, "r1");
  eq(s3.eng.armed, null, "an emanation casts at once, centred on the caster");
  eq(rolls(s3.eng).map(r => r.text), ["Hound: Will save vs Bane"], "…and the hound two squares off saves; the skeleton three off does not");
  const s4 = sanctum(WIZARD());
  const fireball = { id: "fireball", name: "Fireball", actions: 2, range: 500, area: { shape: "burst", radius: 20 }, save: "reflex", basic: true, rankEffects: { 3: { damage: [{ formula: "3", type: "fire" }] } } };
  s4.eng.walls.add("3,2"); s4.eng.armSpell(s4.caster, { sp: fireball, rank: 3, pool: "r2" });
  pin([20, 5], [20, 5]); s4.eng.cellClick(4, 2);
  eq([s4.foe.hp, s4.skel.hp, s4.ally.hp, s4.caster.hp], [21, 6, 10, 32], "a burst hits every foe in its radius and no ally; the skeleton resists fire 1");
  ok(s4.eng.walls.has("3,2") && s4.foe.hp === 21, "…through a wall: bursts never call losClear (standing backlog, pinned as-is)");
  const s5 = sanctum(WIZARD());
  s5.eng.armSpell(s5.caster, { sp: { ...fireball, friendlyFire: true }, rank: 3, pool: "r2" });
  pin([20, 5], [20, 5], [20, 5], [20, 5]); s5.eng.cellClick(3, 2);
  eq(rolls(s5.eng).length, 4, "…unless the spell says friendly fire, and then it hits the caster's side too");
  const s6 = sanctum(WIZARD());
  s6.eng.cbs.push(hound({ id: "third", name: "Third Hound", x: 6, y: 2 }));
  s6.arm("electric-arc", 2, "cantrip"); pin([20, 5], [4, 2], [4, 2], [4, 2], [20, 5], [4, 2], [4, 2], [4, 2]); s6.eng.tokenClick(s6.foe);
  eq(rolls(s6.eng).map(r => r.text), ["Hound: Reflex save vs Electric Arc", "Skeleton Guard: Reflex save vs Electric Arc"], "Electric Arc leaps to the next nearest foe, and only that one");
  ok(s6.eng.events.some(ev => /The spell arcs to Skeleton Guard as well/.test(ev.text)), "…and says so");
  eq(s6.skel.hp, 3, "…the skeleton takes 3d4 less its electricity resistance 1: 6 − 1 = 5");
}
{
  // Buffs: party, self, ally.
  const { eng, caster, ally, foe, arm } = sanctum(CLERIC());
  const down = mk({ id: "d", side: "pc", x: 1, y: 1, dying: 1 }); eng.cbs.push(down);
  arm("bless", 1, "r1");
  eq([caster.buffs.length, ally.buffs.length, down.buffs.length], [1, 1, 0], "Bless lifts every standing ally at once");
  eq(caster.buffs[0], { name: "Bless", bonuses: [{ target: "attack", value: 1, type: "status" }], duration: 4 }, "…+1 status to attack, three rounds plus this one");
  ok(eng.events.some(ev => /Bless lifts the whole line \(\+1 for 3 rounds\)/.test(ev.text)), "…announced");
  const w = sanctum(WIZARD());
  w.arm("shield", 2, "cantrip");
  eq(w.eng.effAC(w.caster).ac, 18, "Shield is +1 AC until next turn");
  eq([w.eng.actions, w.eng.armed], [2, null], "…cast at once for one action");
  w.arm("false-life", 2, "r2");
  eq(w.caster.tempHP, 10, "False Life is 10 temporary HP");
  w.eng.actions = 3; w.arm("sure-strike", 1, "r1");
  eq(w.caster.buffs.some(b => b.fortune), true, "Sure Strike is a fortune buff on the next attack");
  const d = sanctum(forge("druid", { subclass: "untamed" }));
  d.eng.castAt(d.caster, { kind: "target", spell: Registry.spells["untamed-claw"], castRank: 1, pool: "focus", cost: 1 }, d.caster);
  eq([d.caster.attacks[0].name, d.caster.attacks[0].die, d.caster.attacks[0].dmgMod, d.caster.attacks[0].traits], ["Wild Claw", "1d8", d.caster.char.abil.str + 2, ["agile", "finesse"]],
    "Untamed Claw puts a 1d8 claw at the front of the attack list, Strength plus 2 to damage");
  const g = sanctum(CLERIC());
  g.arm("guidance", 2, "cantrip"); g.eng.tokenClick(g.ally);
  eq(g.ally.buffs, [{ name: "Guidance", bonuses: [{ target: "attack", value: 1, type: "status" }], duration: 1 }], "Guidance's next-check bonus lands on attack rolls");
  g.eng.actions = 3; g.arm("resist-energy", 2, "r2"); g.eng.tokenClick(g.ally);
  eq(g.ally.resistances.map(r => r.type + r.value), ["fire5", "cold5", "electricity5", "acid5", "sonic5"], "Resist Energy grants 5 against every energy type at once");
  ok(g.eng.events.some(ev => /Bran is warded against the elements \(resist 5\)/.test(ev.text)), "…announced");
  const rw = sanctum(WIZARD());
  rw.arm("runic-weapon", 1, "r1"); rw.eng.tokenClick(rw.ally);
  eq(rw.ally.buffs[0].bonuses.map(b => b.target), ["attack", "bonus-die"], "Runic Weapon carries both its bonuses");
  eq(rw.ally.buffs[0].duration, 3, "…for three rounds");
  rw.eng.actions = 3; rw.arm("blur", 2, "r2"); rw.eng.tokenClick(rw.ally);
  eq(rw.ally.buffs.some(b => b.flag === "blurred" && b.duration === 10), true, "Blur is a flag strike reads, for ten rounds");
  ok(rw.eng.events.filter(ev => /Bran is bolstered by/.test(ev.text)).length === 2, "…each with the generic line");
}
setDiceSource();

group("combat engine: the monster AI");
/** A hound's turn, held before its first step: `aiTurn` is stubbed so `aiStep` can be driven by hand. */
const kennel = (foeOver = {}, pcs = null, over = {}) => {
  const hero = Object.assign(heroCombatant(fighter()), { x: 1, y: 1, hp: 30 });
  const ally = mk({ id: "a", side: "pc", name: "Bran", x: 1, y: 2, hp: 20, hpMax: 44 });
  const foe = hound({ x: 2, y: 1, ...foeOver });
  const eng = stage([foe, ...(pcs || [hero, ally])], { order: [foe, ...(pcs || [hero, ally])], ...over });
  return { eng, hero, ally, foe };
};
{
  // Adjacent: strike the lowest-HP neighbour, alternate attacks, stop at MAP 2.
  const { eng, hero, ally, foe } = kennel({ attacks: [{ name: "Bite", bonus: 9, damage: "1d8+3", damageType: "piercing", range: 1 }, { name: "Claw", bonus: 9, damage: "1d4+3", damageType: "slashing", range: 1, traits: ["agile"] }] });
  pin([20, 12], [8, 4]);
  const r1 = eng.aiStep(foe);
  eq(r1, { action: "strike", target: "a", wait: 550 }, "a hound with two neighbours bites the one with less HP, and asks for a 550ms beat");
  eq(rolls(eng).at(-1).text, "Hound: Bite vs Bran", "…with its first attack");
  eq([ally.hp, eng.actions], [13, 2], "12+9 vs AC 18 hits for 1d8+3 = 7, one action gone");
  pin([20, 12], [4, 2]);
  const r2 = eng.aiStep(foe);
  eq(rolls(eng).at(-1).text, "Hound: Claw vs Bran", "the second attack is the second in the list");
  eq(rolls(eng).at(-1).math, "12+5 = 17 vs AC 18", "…at −4 for an agile second attack");
  eq([r2.action, eng.actions], ["strike", 1], "…one action left");
  const r3 = eng.aiStep(foe);
  eq(r3, { action: "pass", wait: 300 }, "at MAP 2 it stops swinging and passes the rest");
  eq(eng.actions, 0, "…spending what is left");
  eq(eng.aiStep(foe), null, "with no actions the turn is over");
  eq(eng.cur().id, "hero", "…and it is the hero's turn");
  eq(eng.actions, 3, "…with three actions");
}
{
  // Nobody adjacent: close in, then bite. Speed 35 is 7 squares.
  const { eng, hero, foe } = kennel({ x: 9, y: 1 }, null);
  const r = eng.aiStep(foe);
  eq([r.action, r.wait], ["move", 450], "a hound seven squares off closes to the nearest hero");
  eq([eng.dist(foe, hero), eng.actions], [1, 2], "…and stands adjacent, one action spent");
  pin([20, 12], [8, 4]);
  eq(eng.aiStep(foe).action, "strike", "…then bites");
  // Too far even to close: it walks and walks.
  const far = kennel({ x: 9, y: 9 }, null, { mapW: 12, mapH: 12 });
  far.eng.aiStep(far.foe);
  eq([far.foe.x, far.foe.y, far.eng.dist(far.foe, far.hero)], [4, 4, 3], "a hound eight squares off on the diagonal gets five diagonals for its seven (5-10-5), to within three…");
  eq(far.eng.aiStep(far.foe).action, "move", "…and keeps coming");
  eq(far.eng.dist(far.foe, far.hero), 1, "…until it is adjacent");
  // Nothing to do at all: pass, and the turn ends.
  const pinned = kennel({ x: 5, y: 5 }, null, { walls: ["4,4", "4,5", "4,6", "5,4", "5,6", "6,4", "6,5", "6,6"] });
  eq(pinned.eng.aiStep(pinned.foe), { action: "pass", wait: 300 }, "a hound walled in on every side passes");
  eq(pinned.eng.aiStep(pinned.foe), null, "…and its turn is over");
  // Downed heroes are not targets; when every hero is down the turn just ends.
  const { eng: e3, foe: f3, hero: h3, ally: a3 } = kennel();
  h3.dying = 1; a3.dying = 1;
  eq(e3.aiStep(f3), null, "with every hero down there is nothing to bite");
  eq(e3.h.defeat, 1, "…and the fight is over");
}
{
  // Ranged: shoot the nearest hero it can see, in range; otherwise close.
  const wisp = { name: "Grave Wisp", x: 6, y: 1, speed: 6, attacks: [{ name: "Corpse-Light Spark", bonus: 9, damage: "1d6+2", damageType: "electricity", range: 6 }] };
  const { eng, hero, foe } = kennel(wisp);
  pin([20, 12], [6, 3]);
  const r = eng.aiStep(foe);
  eq(r, { action: "shoot", target: "hero", wait: 550 }, "a wisp five squares off shoots");
  eq(rolls(eng).at(-1).text, "Grave Wisp: Corpse-Light Spark vs Testcase", "…at the nearest hero");
  eq(hero.hp, 25, "12+9 vs AC 19 hits for 1d6+2 = 5");
  const blind = kennel(wisp, null, { walls: ["3,1", "3,2", "3,0"] });
  eq(blind.eng.aiStep(blind.foe).action, "move", "…but not through a wall: with no line of sight it closes instead");
  const outOfRange = kennel({ ...wisp, x: 9, y: 1 });
  eq(outOfRange.eng.aiStep(outOfRange.foe).action, "move", "…and not from eight squares with a six-square spark");
  eq(outOfRange.eng.dist(outOfRange.foe, outOfRange.hero), 2, "…so it comes forward");
  pin([20, 12], [6, 3]);
  eq(outOfRange.eng.aiStep(outOfRange.foe).action, "shoot", "…and shoots from there");
}
{
  // Fleeing: run to the reachable square farthest from the nearest hero.
  const { eng, hero, foe } = kennel({ conditions: [{ c: "fleeing", v: 1, dur: 1 }] });
  const r = eng.aiStep(foe);
  eq(r, { action: "flee", wait: 450 }, "a fleeing hound runs");
  eq(eng.dist(foe, hero), 8, "…as far from the nearest hero as seven squares allow");
  eq(eng.actions, 0, "…spending its whole turn");
  ok(eng.events.some(ev => /Hound flees in terror!/.test(ev.text)), "…and the Chronicle says so");
}
{
  // A power: Toll of the Deep, when two heroes stand inside it.
  const toll = { name: "Toll of the Deep", cost: 2, cooldown: 3, type: "aoe", save: "will", dc: 21, radius: 3, damage: "2d6", damageType: "sonic", onFail: [{ c: "frightened", v: 1 }], onCritFail: [{ c: "frightened", v: 2 }], flavor: "It RINGS." };
  const warden = () => ({ name: "The Bell-Warden", x: 2, y: 1, hp: 62, hpMax: 62, ac: 21, powers: [{ ...toll, cd: 0 }], attacks: [{ name: "Bite", bonus: 14, damage: "2d8+5", damageType: "piercing", range: 1 }] });
  const { eng, hero, ally, foe } = kennel(warden());
  pin([20, 8], [6, 3], [6, 4], [20, 1], [6, 3], [6, 4]);
  const r = eng.aiStep(foe);
  eq(r, { action: "power", name: "Toll of the Deep", wait: 600 }, "with both heroes in the bell's reach the Warden rings it");
  eq(rolls(eng).map(x => x.text), ["Testcase: Will save vs Toll of the Deep", "Bran: Will save vs Toll of the Deep"], "…and both save");
  eq([hero.hp, hero.conditions.map(c => c.c + c.v)], [23, ["frightened1"]], "a failure (8+6 vs 21) takes 2d6 sonic and frightened 1");
  eq([ally.hp, ally.conditions.map(c => c.c + c.v)], [6, ["frightened2"]], "a critical failure takes double and frightened 2");
  eq([foe.powers[0].cd, eng.actions], [3, 1], "…the power goes on cooldown and two actions are spent");
  ok(eng.events.some(ev => /<b>The Bell-Warden: Toll of the Deep!<\/b> <i>It RINGS\.<\/i>/.test(ev.text)), "…announced with its flavour");
  pin([20, 12], [8, 4], [8, 4]);
  eq(eng.aiStep(foe).action, "strike", "…and with one action left it bites");
  // One hero in reach of two is not worth the ring.
  const solo = kennel(warden(), null); solo.ally.x = 8; solo.ally.y = 8;
  pin([20, 12], [8, 4], [8, 4]);
  eq(solo.eng.aiStep(solo.foe).action, "strike", "with only one hero in reach it bites instead");
  eq(solo.foe.powers[0].cd, 0, "…and keeps the power");
}
{
  // aiTurn runs the whole turn in one synchronous call through defer, and the
  // next foe's turn after that, until a hero is up.
  const hero = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
  const h1 = hound({ id: "h1", name: "First", x: 2, y: 1 }), h2 = hound({ id: "h2", name: "Second", x: 2, y: 2 });
  const eng = stage([hero, h1, h2]);
  delete eng.aiTurn; // stage() holds the AI; this test wants it running
  setDiceSource(() => 0.5); // every die lands in the middle: d20 = 11
  const beats = []; eng.defer = function(fn, ms){ beats.push(ms); fn(); };
  eng.actionClick("end");
  eq(eng.cur().id, "hero", "End Turn: both hounds take a whole turn each and it is the hero's turn again");
  eq(eng.round, 2, "…in round 2");
  eq(rolls(eng).filter(r => /^First/.test(r.text)).length, 2, "the first hound bit twice…");
  eq(rolls(eng).filter(r => /^Second/.test(r.text)).length, 2, "…and so did the second");
  eq(beats, [600, 550, 550, 300, 600, 550, 550, 300], "the page would have paused 600ms before each turn and 550/550/300 between steps — the pacing the engine asks for, not the one it takes");
  eq(eng.events.filter(ev => typeof ev.text === "string" && /undefined|NaN/.test(ev.text)).length, 0, "no line reads undefined or NaN");
}
setDiceSource();

group("combat engine: a headless encounter");
/**
 * Play a fight to the end with a simple party policy: Strike an adjacent foe
 * while there are actions, otherwise Stride toward the nearest one; Aldous
 * heals a dying neighbour first. The monsters run themselves. Returns a
 * summary; throws if the fight has not ended after `cap` hero turns.
 */
function play(eng, cap = 60) {
  let heroTurns = 0; const squares = [];
  while (eng.active) {
    const cb = eng.cur();
    if (cb.side !== "pc") throw new Error(`the engine stopped on ${cb.name}'s turn — a monster turn did not run through defer`);
    if (++heroTurns > cap) throw new Error(`no result after ${cap} hero turns`);
    // Occupancy: no two living combatants on one square.
    const live = eng.cbs.filter(c => !c.dead).map(c => eng.key(c.x, c.y));
    squares.push(new Set(live).size === live.length);
    let guard = 0;
    while (eng.active && eng.cur() === cb && eng.actions > 0 && guard++ < 6) {
      const foes = eng.alive("foe");
      const near = foes.slice().sort((a, b) => eng.dist(cb, a) - eng.dist(cb, b))[0];
      const downed = eng.cbs.find(c => c.side === "pc" && !c.dead && c.dying > 0 && eng.dist(cb, c) <= 6);
      if (cb.abilities?.[0]?.uses > 0 && downed && eng.actions >= 2) { eng.actionClick("abil0"); eng.tokenClick(downed); continue; }
      if (near && eng.dist(cb, near) <= 1) { eng.actionClick("strike0"); eng.tokenClick(near); continue; }
      if (near) {
        eng.actionClick("stride");
        const reach = eng.reachable(cb, eng.armed.budget);
        let best = null, bd = 1e9;
        for (const k of Object.keys(reach)) {
          const [x, y] = k.split(",").map(Number);
          if (eng.occupied(x, y) && !(x === cb.x && y === cb.y)) continue;
          const d = eng.dist({ x, y }, near);
          if (d < bd || (d === bd && reach[k].cost < reach[eng.key(best.x, best.y)].cost)) { bd = d; best = { x, y }; }
        }
        if (!best || (best.x === cb.x && best.y === cb.y)) { eng.armed = null; break; }
        eng.cellClick(best.x, best.y); continue;
      }
      break;
    }
    if (eng.active && eng.cur() === cb) eng.actionClick("end");
  }
  return { heroTurns, rounds: eng.round, occupancyHeld: squares.every(Boolean),
    foesLeft: eng.alive("foe").length, pcs: eng.cbs.filter(c => c.side === "pc").map(c => `${c.name} ${c.hp}/${c.hpMax}${c.dead ? " dead" : c.dying ? " dying " + c.dying : ""}`),
    rolls: eng.events.filter(ev => ev.kind === "roll").length, lines: eng.events.length,
    dirty: eng.events.filter(ev => /undefined|NaN|\[object/.test(String(ev.text)) || /undefined|NaN/.test(String(ev.math || ""))).length };
}
{
  setDiceSource(() => 0.5); // every die lands mid-face: a d20 is always 11
  const run = () => { const eng = fight(); begin(eng, "enc-moor", [heroCombatant(fighter()), companionCombatant("aldous")]); return { eng, ...play(eng) }; };
  const a = run();
  eq(a.eng.active, false, "The Causeway Pack, a fighter and Brother Aldous, every die an 11: the fight ends");
  eq([a.eng.h.victory, a.eng.h.defeat, a.eng.h.saves], [1, 0, 1], "…in a victory, saved once");
  eq(a.foesLeft, 0, "…with every hound and the skeleton down");
  eq(a.pcs, ["Testcase 32/44", "Brother Aldous 23/44 dead"], "…the fighter on 32 after the victory heal, and Aldous dead");
  // Aldous died at dying 4 and still left the field on 23 HP: `finish` restores
  // every party member, dead or not, and `start` sets dead=false on the whole
  // party at the next encounter. Pinned as-is; it is in the standing backlog.
  ok(a.eng.cbs[1].dead && a.eng.cbs[1].hp === 23, "a dead companion is healed by the victory anyway (standing backlog, pinned as-is)");
  eq([a.rounds, a.heroTurns], [6, 9], "it takes six rounds");
  eq(a.dirty, 0, "no Chronicle line reads undefined or NaN");
  eq(a.occupancyHeld, true, "no two living combatants ever shared a square at the top of a hero turn");
  ok(a.rolls >= 12, `the monsters and heroes rolled ${a.rolls} d20s between them`);
  const b = run();
  eq(b.eng.events.map(ev => ev.text + (ev.math || "")), a.eng.events.map(ev => ev.text + (ev.math || "")), "the same die gives the same fight, line for line");
}
{
  // The crypt: the Bell-Warden's Toll, a champion, and a wisp that shoots. Party of three.
  setDiceSource(() => 0.5);
  const eng = fight();
  begin(eng, "enc-crypt", [heroCombatant(fighter()), companionCombatant("aldous"), companionCombatant("wren")], { "knows-rite": true });
  eq(eng.cbs.filter(c => c.side === "foe").map(c => c.name), ["The Bell-Warden", "Skeleton Guard", "Skeleton Guard", "Skeletal Champion", "Grave Wisp"], "a party of three faces all five");
  const r = play(eng);
  eq(eng.active, false, "the crypt fight ends");
  eq(r.dirty, 0, "…with no undefined or NaN in the Chronicle");
  eq(r.occupancyHeld, true, "…and nobody ever stacked");
  ok(eng.events.some(ev => /Toll of the Deep!/.test(ev.text)), "the Warden rang the bell at least once");
  ok(eng.events.some(ev => /Grave Wisp: Corpse-Light Spark vs/.test(ev.text)), "the wisp shot at somebody");
  eq([eng.h.victory + eng.h.defeat, r.rounds > 1], [1, true], "…it went more than one round and ended one way");
  eq([eng.h.defeat, r.rounds, r.pcs], [1, 7, ["Testcase 0/44 dead", "Brother Aldous 0/44 dying 1", "Wren Thistledown 0/38 dead"]],
    "…pinned: with average dice and no tactics, the Warden wins in seven rounds. A balance change moves this line on purpose");
}
setDiceSource();

/* ---------------- 12. detection: Hide, Seek, cover, the flat check ----------------
   Phase 4. Before this every combatant saw every other one, `losClear` was
   consulted for ranged attacks and `maxTargets` and nothing else, and half the
   Stealth feats in the pack described an action the engine did not have. */
group("detection: the map");
{
  const seer = mk({ id: "o", side: "pc", name: "Alis", x: 0, y: 0 });
  const quarry = mk({ id: "q", name: "Quarry", x: 3, y: 0 });
  const other = mk({ id: "p", name: "Other", x: 0, y: 3 });
  const eng = arena([seer, quarry, other]);
  eq(eng.detectState(seer, quarry), "observed", "with nothing written down, everybody is observed");
  eq(eng.flatCheckDC(seer, quarry), 0, "…and an observed target forces no flat check");
  eq(eng.isHidden(seer, quarry), false, "…and is not hidden");

  eng.setDetect(seer, quarry, "hidden");
  eq([eng.detectState(seer, quarry), eng.flatCheckDC(seer, quarry), eng.isHidden(seer, quarry)], ["hidden", 11, true],
    "a hidden target is DC 11");
  eq(eng.detectState(other, quarry), "observed", "…to that observer only: the map is per pair");
  eng.setDetect(seer, quarry, "observed");
  eq(eng.detect.o, {}, "writing `observed` clears the override rather than pinning it");

  // The two conditions are the base the map falls back to.
  eng.addCond(quarry, "concealed", 1, undefined, true);
  eq([eng.detectState(seer, quarry), eng.flatCheckDC(seer, quarry)], ["concealed", 5], "the `concealed` condition is DC 5, to everyone");
  eng.setDetect(seer, quarry, "hidden");
  eq(eng.detectState(seer, quarry), "hidden", "…and an override outranks it");
  eng.reveal(quarry);
  eq(eng.detectState(seer, quarry), "concealed", "…so dropping the override falls back to concealed, not to observed");
  quarry.conditions = [];
  eng.addCond(quarry, "invisible", 1, undefined, true);
  eq([eng.detectState(seer, quarry), eng.flatCheckDC(seer, quarry), eng.isHidden(seer, quarry)], ["undetected", 11, true],
    "the `invisible` condition is undetected, and undetected still rolls DC 11 for anyone who could target it");
}

group("detection: cover off the same Bresenham walk");
{
  const shooter = mk({ id: "s", side: "pc", x: 0, y: 0 });
  const target = mk({ id: "t", x: 4, y: 0 });
  const body = mk({ id: "b", x: 2, y: 0 });
  const eng = arena([shooter, target, body], { mapW: 10, mapH: 10 });
  eq(eng.coverBonus(shooter, target), 2, "a living body on the line is lesser cover, +2");
  eq(eng.effAC(target, shooter).cover, 2, "…and effAC reports it");
  eq(eng.effAC(target, shooter).ac, 20, "…as +2 on an AC of 18");
  body.dead = true;
  eq(eng.coverBonus(shooter, target), 0, "a corpse is not cover");
  body.dead = false; body.y = 2;
  eq(eng.coverBonus(shooter, target), 0, "…and neither is a body off the line");
  eq(eng.coverBonus(shooter, { x: 1, y: 0 }), 0, "adjacent squares have nothing between them at all");

  const wall = arena([shooter, target], { walls: ["2,0"], mapW: 10, mapH: 10 });
  eq(wall.coverBonus(shooter, target), 4, "a wall on the line is greater cover, +4");
  eq(wall.effAC(target, shooter).ac, 22, "…which is +4 on the roll the player sees");
  eq(wall.losClear(shooter, target), false, "…and the same wall is what stops line of sight");

  // Neither endpoint's own square is read. A caster standing on a wall does
  // not block its own line (the same rule losClear already keeps), and a
  // target standing on one is not behind it either.
  const doorway = arena([shooter, target], { walls: ["0,0", "4,0"], mapW: 10, mapH: 10 });
  eq(doorway.coverBonus(shooter, target), 0, "the square a shooter stands on is not its own cover");
  eq(doorway.coverBonus(target, shooter), 0, "…and neither is the square the target stands on");
}

group("detection: Take Cover");
{
  const { eng, hero, foe } = duel({}, {}, { walls: ["1,0"] });
  eq(eng.nearCover(hero), true, "a wall in one of the eight squares around you is something to duck behind");
  eng.actionClick("takecover");
  eq([hero.takingCover, eng.actions], [true, 2], "Take Cover is one action");
  eq(eng.effAC(hero, foe).cover, 2, "…and +2 AC against an adjacent foe with nothing else in the way");
  ok(eng.events.some(ev => /<b>Takes Cover<\/b>/.test(ev.text)), "…which the Chronicle says");

  // Circumstance bonuses do not stack: the larger one is the whole of it.
  const behind = arena([mk({ id: "s", side: "pc", x: 0, y: 0 }), mk({ id: "t", x: 4, y: 0, takingCover: true })],
    { walls: ["2,0"], mapW: 10, mapH: 10 });
  eq(behind.effAC(behind.cbs[1], behind.cbs[0]).cover, 4, "Take Cover behind a wall is +4, not +6");

  // It ends on a move.
  eng.actionClick("stride"); eng.cellClick(1, 2);
  eq([hero.x, hero.y, hero.takingCover], [1, 2, false], "…and a Stride gives it up");

  // It ends on a Strike, hit or miss.
  const d2 = duel({}, {}, { walls: ["1,0"] });
  d2.eng.actionClick("takecover");
  pin([20, 1], [8, 1]);
  d2.eng.actionClick("strike0"); d2.eng.tokenClick(d2.foe);
  eq(d2.hero.takingCover, false, "…and so does swinging out of it, even on a miss");

  // Nothing to duck behind.
  const d3 = duel();
  d3.eng.actionClick("takecover");
  eq([d3.hero.takingCover, d3.eng.actions, d3.eng.h.toasts], [undefined, 3, ["Nothing here to duck behind."]],
    "in the open it costs nothing and does nothing");
}

group("detection: Hide");
{
  /** A hero with trained Stealth at (0,0) and a hound at (4,0), wall between. */
  const hidden = (chOver = {}, over = {}) => {
    const ch = fighter({ skills: ["stealth"], ...chOver });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const foe = hound({ x: 4, y: 0 });
    const eng = stage([hero, foe], { walls: ["2,0"], ...over });
    return { eng, hero, foe, ch };
  };
  {
    const { eng, hero, foe } = hidden();
    eq(eng.canHideFrom(hero, foe), true, "greater cover is something to hide behind");
    pin([20, 15]);
    eng.actionClick("hide");
    eq(rolls(eng).at(-1).math, "15+7 = 22", "Hide is one Stealth roll: trained 7 at level 3, Dex +2");
    eq([eng.detectState(foe, hero), hero.hideDC, eng.actions], ["hidden", 22, 2],
      "…22 against the hound's Perception DC 17 hides, and the roll becomes the DC to find it");
    ok(eng.events.some(ev => /slips out of Hound's sight/.test(ev.text)), "…and the Chronicle says so");
  }
  {
    const { eng, hero, foe } = hidden();
    pin([20, 1]);
    eng.actionClick("hide");
    eq([eng.detectState(foe, hero), hero.hideDC, eng.actions], ["observed", undefined, 2],
      "1 + 7 = 8 against DC 17 is seen, and the action is spent anyway");
    ok(eng.events.some(ev => /Hound keeps Testcase in view/.test(ev.text)), "…and the Chronicle says that too");
  }
  {
    // Nothing to hide behind: no wall, no body, no concealment.
    const ch = fighter({ skills: ["stealth"] });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const foe = hound({ x: 4, y: 0 });
    const eng = stage([hero, foe]);
    eq(eng.canHideFrom(hero, foe), false, "an open floor is not cover");
    eng.actionClick("hide");
    eq([eng.actions, eng.h.toasts], [3, ["Nothing here to hide behind."]], "…so Hide costs nothing and does nothing");
    eq(rolls(eng).length, 0, "…and never rolls");
  }
  {
    // Per pair: the hound behind the wall loses you, the one with a clear line
    // never had to look.
    const ch = fighter({ skills: ["stealth"] });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const blind = hound({ id: "f", name: "Hound", x: 4, y: 0 });
    const watcher = hound({ id: "g", name: "Watcher", x: 0, y: 4 });
    const eng = stage([hero, blind, watcher], { walls: ["2,0"] });
    pin([20, 20]);
    eng.actionClick("hide");
    eq([eng.detectState(blind, hero), eng.detectState(watcher, hero)], ["hidden", "observed"],
      "one roll, two answers: the foe you have cover from loses you and the other does not");
    ok(!eng.events.some(ev => /Watcher keeps/.test(ev.text)), "…and the foe with no cover between you is never even rolled against");
  }
  {
    // Outwit: +2 Stealth against your own hunted prey, and the guide has said
    // for two sessions that this third of the feat went nowhere.
    const { eng, hero, foe } = hidden({ feats: { "class-1": "outwit-probe" } });
    eq(hero.char.specials.includes("edge-outwit"), false, "control: the plain fighter has no edge");
    pin([20, 8]);
    eng.actionClick("hide");
    eq(eng.detectState(foe, hero), "observed", "8 + 7 = 15 against DC 17 is two short");

    const o = hidden();
    o.hero.char = { ...o.hero.char, specials: [...o.hero.char.specials, "edge-outwit"] };
    o.eng.huntPreyId = o.foe.id;
    pin([20, 8]);
    o.eng.actionClick("hide");
    eq(o.eng.detectState(o.foe, o.hero), "hidden", "…and Outwit's +2 against the hunted prey covers exactly that gap");
    eq(rolls(o.eng).at(-1).math, "8+7 = 15", "…without touching the roll everyone sees");

    const n = hidden();
    n.hero.char = { ...n.hero.char, specials: [...n.hero.char.specials, "edge-outwit"] };
    n.eng.huntPreyId = "somebody-else";
    pin([20, 8]);
    n.eng.actionClick("hide");
    eq(n.eng.detectState(n.foe, n.hero), "observed", "…and nothing at all against anything that is not your prey");
  }
  {
    // Take Cover is somewhere to hide even when the line to that foe is clear:
    // the point of the action is that you have put something between you and
    // the room by hand.
    const ch = fighter({ skills: ["stealth"] });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const foe = hound({ x: 4, y: 0 });
    const eng = stage([hero, foe], { walls: ["0,1"] });
    eq(eng.coverBonus(foe, hero), 0, "a wall beside you is not a wall on the line");
    eq(eng.canHideFrom(hero, foe), false, "…so there is nothing to hide behind yet");
    eng.actionClick("takecover");
    eq(eng.canHideFrom(hero, foe), true, "…until you have Taken Cover behind it");
    pin([20, 20]);
    eng.actionClick("hide");
    eq(eng.detectState(foe, hero), "hidden", "…and then the Hide is allowed to roll at all");
  }
  {
    // Distracting Shadows: a body is lesser cover, which is not enough to hide
    // behind unless the feat that says so is on the sheet.
    const ch = fighter({ skills: ["stealth"] });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const screen = companionCombatant("aldous"); screen.x = 2; screen.y = 0;
    const foe = hound({ x: 4, y: 0 });
    const eng = stage([hero, screen, foe]);
    eq(eng.coverBonus(foe, hero), 2, "Brother Aldous in the way is lesser cover");
    eq(eng.canHideFrom(hero, foe), false, "…which is not enough to hide behind");
    hero.char = { ...hero.char, specials: [...hero.char.specials, "distracting-shadows"] };
    eq(eng.canHideFrom(hero, foe), true, "…until Distracting Shadows says it is");
  }
  {
    // Expiry. Hiding does not survive the hider moving, or striking out of it.
    const { eng, hero, foe } = hidden();
    pin([20, 20]);
    eng.actionClick("hide");
    eq(eng.detectState(foe, hero), "hidden", "hidden behind the wall");
    eng.actionClick("stride"); eng.cellClick(0, 1);
    eq(eng.detectState(foe, hero), "observed", "…and a Stride gives the place away");
    ok(eng.events.some(ev => /gives the hiding place away, on the move/.test(ev.text)), "…with a line saying why");
  }
  {
    // …and the fallback after a reveal is the condition, not `observed`.
    const ch = fighter({ skills: ["stealth"] });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const foe = hound({ x: 4, y: 0 });
    const eng = stage([hero, foe]);
    eng.addCond(hero, "concealed", 1, undefined, true);
    eq(eng.canHideFrom(hero, foe), true, "concealment is something to hide in with no wall at all");
    pin([20, 20]);
    eng.actionClick("hide");
    eq(eng.detectState(foe, hero), "hidden", "…and hiding in it beats being merely blurry");
    pin([20, 20], [8, 5]);
    eng.actionClick("strike1"); eng.tokenClick(foe);
    eq(eng.detectState(foe, hero), "concealed", "a Strike gives the hiding place away, back to concealed and no further");
    ok(eng.events.some(ev => /gives the hiding place away, striking out of it/.test(ev.text)), "…and says which it was");
  }
}

group("detection: Seek");
{
  /** A hero at (0,0) and a hound at (3,0) already hidden from them at DC 15. */
  const lost = (over = {}) => {
    const hero = Object.assign(heroCombatant(fighter()), { x: 0, y: 0 });
    const foe = hound({ x: 3, y: 0 });
    const eng = stage([hero, foe], over);
    eng.setDetect(hero, foe, "hidden"); foe.hideDC = 15;
    return { eng, hero, foe };
  };
  {
    const { eng, hero, foe } = lost();
    pin([20, 10]);
    eng.actionClick("seek"); eng.cellClick(3, 0);
    eq(rolls(eng).at(-1).math, "10+8 = 18", "Seek is one Perception roll");
    eq([eng.detectState(hero, foe), eng.actions], ["observed", 2], "…18 against a Stealth DC of 15 finds it, for one action");
    ok(eng.events.some(ev => /<b>Testcase finds Hound<\/b>/.test(ev.text)), "…and the Chronicle names what turned up");
  }
  {
    const { eng, hero, foe } = lost();
    pin([20, 1]);
    eng.actionClick("seek"); eng.cellClick(3, 0);
    eq(eng.detectState(hero, foe), "hidden", "1 + 8 = 9 against DC 15 finds nothing");
    ok(eng.events.some(ev => /searches, and turns up nothing/.test(ev.text)), "…and says so");
  }
  {
    // The burst is three squares across. Two away from the point is outside it.
    const { eng, hero, foe } = lost();
    foe.x = 5;
    pin([20, 20]);
    eng.actionClick("seek"); eng.cellClick(3, 0);
    eq(eng.detectState(hero, foe), "hidden", "a natural 20 two squares outside the burst still finds nothing");
    foe.x = 4;
    pin([20, 20]);
    eng.actions = 3;
    eng.actionClick("seek"); eng.cellClick(3, 0);
    eq(eng.detectState(hero, foe), "observed", "…and one square outside the point is inside the burst");
  }
  {
    // The DC to find a hider is the roll it Hid with, not a number off a stat
    // block: a hound that never hid is found at 10 + its Stealth, and one that
    // rolled 22 is found at 22.
    const ch = fighter({ skills: ["stealth"] });
    const hero = Object.assign(heroCombatant(ch), { x: 0, y: 0 });
    const foe = hound({ x: 4, y: 0 });
    const eng = stage([hero, foe], { walls: ["2,0"] });
    pin([20, 15]);
    eng.actionClick("hide");
    eq([eng.detectState(foe, hero), hero.hideDC], ["hidden", 22], "the hero hides on a 22");
    eq([eng.stealthDC(hero), eng.stealthDC(foe)], [22, 17], "…so 22 is the DC to find them, where the hound is 10 + Stealth 7");
    pin([20, 12]);
    eng.seek(foe, { x: 0, y: 0 }, 1);
    eq(eng.detectState(foe, hero), "hidden", "12 + 7 = 19 clears 17 and is still under the 22 that matters");
    pin([20, 15]);
    eng.seek(foe, { x: 0, y: 0 }, 1);
    eq(eng.detectState(foe, hero), "observed", "…and 15 + 7 = 22 is exactly enough");
  }
  {
    // Range: the point has to be within 30 feet.
    const { eng, hero, foe } = lost();
    eng.actionClick("seek"); eng.cellClick(9, 9);
    eq([eng.actions, rolls(eng).length], [3, 0], "a point past 30 ft is not a Seek at all");
  }
  {
    // Invisibility survives being found. Seek beats the hiding place, not the
    // spell.
    const hero = Object.assign(heroCombatant(fighter()), { x: 0, y: 0 });
    const foe = hound({ x: 1, y: 0 });
    const eng = stage([hero, foe]);
    eng.addCond(foe, "invisible", 1, undefined, true);
    eq(eng.detectState(hero, foe), "undetected", "an invisible hound is undetected");
    eq(eng.targets({ range: 1, mode: "strike" }).length, 0, "…and cannot be targeted at all, even from the next square over");
    pin([20, 20]);
    eng.actionClick("seek"); eng.cellClick(1, 0);
    eq(eng.detectState(hero, foe), "hidden", "…and finding it makes it hidden, not observed");
    ok(eng.events.some(ev => /an outline in the air/.test(ev.text)), "…which the Chronicle is explicit about");
    eq(eng.flatCheckDC(hero, foe), 11, "…so it still costs a DC 11 flat check to hit");
    eq(eng.targets({ range: 1, mode: "strike" }).length, 1, "…and it can be swung at now, at the price of that check");
  }
  {
    // Sensate Gnome: the first conditional `bonus` anything in the engine reads.
    // Two gnome heritages off the same build, so the only difference between
    // the control and the subject is the one line of the DSL.
    const GNOME = h => forge("fighter", { ancestry: "gnome", heritage: h });
    eq([GNOME("umbral-gnome").perception, GNOME("sensate-gnome").perception], [8, 8],
      "both gnomes print the same Perception on the sheet");
    eq([GNOME("umbral-gnome").condBonuses, GNOME("sensate-gnome").condBonuses],
      [[], [{ target: "perception", value: 2, type: "circumstance", vs: "seek" }]],
      "…and only one of them carries a conditional bonus");

    const plain = lost();
    plain.foe.hideDC = 16;
    plain.hero.char = GNOME("umbral-gnome");
    pin([20, 7]);
    plain.eng.actionClick("seek"); plain.eng.cellClick(3, 0);
    eq(rolls(plain.eng).at(-1).math, "7+8 = 15", "7 + 8 = 15 against a Stealth DC of 16…");
    eq(plain.eng.detectState(plain.hero, plain.foe), "hidden", "…is one short");

    const keen = lost();
    keen.foe.hideDC = 16;
    keen.hero.char = GNOME("sensate-gnome");
    pin([20, 7]);
    keen.eng.actionClick("seek"); keen.eng.cellClick(3, 0);
    eq(rolls(keen.eng).at(-1).math, "7+10 = 17", "…and Seek adds Sensate Gnome's +2: 8 + 2");
    eq(keen.eng.detectState(keen.hero, keen.foe), "observed", "…which is exactly the square it was short by");
  }
}

group("detection: the flat check");
{
  {
    // Hidden: DC 11, and a failure costs the action and raises the MAP.
    const { eng, hero, foe } = duel();
    eng.setDetect(hero, foe, "hidden");
    pin([20, 10]);
    eng.actionClick("strike0"); eng.tokenClick(foe);
    eq(rolls(eng).map(r => r.math), ["10 vs DC 11"], "a 10 against DC 11 is the only die the swing rolls");
    eq([foe.hp, hero.mapCount, eng.actions], [24, 1, 2], "…no damage, but the action and the MAP are both spent");
    ok(eng.events.some(ev => /finds only the empty air where Hound was/.test(ev.text)), "…and the Chronicle says where the blow went");
  }
  {
    const { eng, hero, foe } = duel();
    eng.setDetect(hero, foe, "hidden");
    pin([20, 11], [20, 20], [8, 8]);
    eng.actionClick("strike0"); eng.tokenClick(foe);
    eq(rolls(eng).map(r => r.math), ["11 vs DC 11", "20+10 = 30 vs AC 16"], "…and an 11 lets the attack roll happen");
    ok(foe.hp < 24, "…and land");
  }
  {
    // Concealed: DC 5.
    const { eng, hero, foe } = duel();
    eng.addCond(foe, "concealed", 1, undefined, true);
    pin([20, 4]);
    eng.actionClick("strike0"); eng.tokenClick(foe);
    eq(rolls(eng).map(r => r.math), ["4 vs DC 5"], "concealment is a DC 5 flat check");
    eq(rolls(eng).at(-1).text, "Testcase: flat check vs concealed Hound", "…named for what is in the way");
    pin([20, 5], [20, 20], [8, 8]);
    eng.actions = 3;
    eng.actionClick("strike0"); eng.tokenClick(foe);
    eq(rolls(eng).length, 3, "…and a 5 goes through");
  }
  {
    // A monster's attack rolls it too.
    const { eng, hero, foe } = duel();
    eng.setDetect(foe, hero, "hidden");
    pin([20, 3]);
    eng.strikeMonster(foe, hero, { name: "Bite", bonus: 9, die: "1d8+3", damageType: "piercing", traits: [], range: 1 });
    eq([hero.hp, foe.mapCount], [44, 1], "a hidden hero takes nothing from a hound that rolled a 3");
    eq(rolls(eng).map(r => r.math), ["3 vs DC 11"], "…because the flat check happens before the attack roll");
  }
  {
    // …and so does a spell that names a creature.
    const { eng, caster, foe, arm } = sanctum(WIZARD());
    eng.setDetect(caster, foe, "hidden");
    pin([20, 2]);
    arm("ignition", 2, "cantrip");
    eng.tokenClick(foe);
    eq(rolls(eng).map(r => r.math), ["2 vs DC 11"], "a targeted spell rolls the same flat check");
    eq(foe.hp, 24, "…and a failure is the whole of the spell");
    eq(eng.actions, 1, "…which still cost the two actions to cast");
  }
  {
    // An area spell names a square, not a creature, and asks nothing.
    const { eng, caster, foe, skel, arm } = sanctum(WIZARD());
    eng.setDetect(caster, foe, "hidden");
    pin([20, 20], [20, 20], [4, 2], [4, 2], [4, 2]);
    arm("breathe-fire", 1, "r1");
    eng.cellClick(4, 2);
    eq(eng.events.filter(ev => /flat check/.test(ev.text)).length, 0, "a cone rolls no flat check against anybody");
  }
}

group("detection: the monster AI");
{
  {
    // A monster cannot swing at what it cannot detect, so it Seeks instead.
    const hero = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
    const foe = hound({ x: 2, y: 1 });
    const eng = stage([hero, foe]);
    eng.addCond(hero, "invisible", 1, undefined, true);
    eng.actions = 3;
    pin([20, 1]);
    const step = eng.aiStep(foe);
    eq(step.action, "seek", "with every hero undetected the hound Seeks rather than biting the air");
    eq(eng.detectState(foe, hero), "undetected", "…and a 1 finds nothing");
    ok(eng.events.some(ev => /casts about for something it can no longer see/.test(ev.text)), "…with a line saying why");
    eng.actions = 3;
    pin([20, 20]);
    eng.aiStep(foe);
    eq(eng.detectState(foe, hero), "hidden", "…and a 20 turns the invisible hero into an outline it can target");
  }
  {
    // A hidden hero is still a target; the hound just has to roll for it.
    const hero = Object.assign(heroCombatant(fighter()), { x: 1, y: 1 });
    const foe = hound({ x: 2, y: 1 });
    const eng = stage([hero, foe]);
    eng.setDetect(foe, hero, "hidden");
    eng.actions = 3;
    pin([20, 1]);
    const step = eng.aiStep(foe);
    eq(step.action, "strike", "a hidden hero is still something to bite at");
    eq([hero.hp, rolls(eng).map(r => r.math)], [44, ["1 vs DC 11"]], "…and the flat check is the whole of the attempt");
  }
  {
    // Cover reaches the monster's attack path too, which is the half of it a
    // bare {id,ranged} stand-in would have silently dropped (locked #90).
    const hero = Object.assign(heroCombatant(fighter()), { x: 0, y: 0 });
    const screen = companionCombatant("aldous"); screen.x = 2; screen.y = 0;
    const wisp = hound({ id: "w", name: "Grave Wisp", x: 4, y: 0,
      attacks: [{ name: "Spark", bonus: 11, damage: "1d6", damageType: "electricity", range: 12 }] });
    const eng = stage([hero, screen, wisp]);
    eq(eng.effAC(hero, { id: "w", ranged: true }, { from: wisp }).cover, 2, "a body between the wisp and the hero is +2 AC");
    pin([20, 8], [6, 3]);
    eng.strikeMonster(wisp, hero, { name: "Spark", bonus: 11, die: "1d6", damageType: "electricity", traits: [], range: 12, ranged: true });
    ok(rolls(eng).at(-1).math.includes("vs AC 21"), "…and it is on the roll the player sees: 19 + 2");
    eq(hero.hp, 44, "…which is the difference between a hit and a miss here");
  }
}

/* ---------------- 13. the rest of the action economy ----------------
   Phase 5. Titan Wrestler let you Grapple creatures two sizes larger in a game
   with no Grapple and no sizes; `size` was in the monster schema and on every
   ancestry and read by nothing; `bonus-dmg-vs-large` and `cooperative-nature`
   had been inert since they shipped; and nothing in the engine removed `prone`,
   so the condition existed and could not have been applied by anything. */
group("size, and the level-based DC");
{
  eq(SIZES, ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"], "six sizes, smallest first");
  eq([sizeIndex("Medium"), sizeIndex("Large"), sizeIndex("Colossal"), sizeIndex(undefined)], [2, 3, 2, 2],
    "…and anything the table does not name reads as Medium");
  // The GM Core's level-based DC table, row for row, not a formula guessed at.
  eq([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(levelDC), [13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27],
    "the level-based DC table from -1 to 10");
  eq(levelDC(20), 40, "…and level 20 is 40");

  const ch = fighter();
  eq(ch.size, "Medium", "a human hero's size is on the sheet now, off the ancestry");
  eq(finalizeCharacter({ ...ch.build, ancestry: "gnome", heritage: "sensate-gnome" }).size, "Small",
    "…and a gnome's is Small");
}

group("maneuvers: Trip");
{
  // Athletics 7 (trained 2 + level 3 + Str 2) against 10 + the hound's Reflex 9.
  const { eng, hero, foe } = duel();
  eng.actionClick("trip");
  eq(eng.armed, { kind: "target", range: 1, cost: 1, mode: "trip", btn: "trip" }, "Trip arms an adjacent target");
  eq(eng.targets(eng.armed).map(t => t.id), ["f"], "…and only the adjacent hound qualifies");
  pin([20, 12]);
  eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "12+7 = 19 vs DC 19", "Trip is Athletics against 10 + the target's Reflex");
  eq(foe.conditions.map(c => c.c), ["prone"], "…and a success puts it on the floor");
  eq([eng.actions, hero.mapCount], [2, 1], "…for one action, and it raises the MAP the way a Strike does");
  eq(eng.effAC(foe, hero).offGuard, true, "…which leaves the hound off-guard");

  // Critical success: prone and 1d6 bludgeoning.
  const d2 = duel();
  pin([20, 20], [6, 4]);
  d2.eng.actionClick("trip"); d2.eng.tokenClick(d2.foe);
  eq([d2.foe.hp, d2.foe.conditions.map(c => c.c)], [20, ["prone"]], "a critical Trip is prone plus 1d6 bludgeoning");

  // Critical failure: you go down instead.
  const d3 = duel();
  pin([20, 1]);
  d3.eng.actionClick("trip"); d3.eng.tokenClick(d3.foe);
  eq([d3.foe.conditions, d3.hero.conditions.map(c => c.c)], [[], ["prone"]],
    "a critical failure and the fighter overbalances instead");
  ok(d3.eng.events.some(ev => /overbalances and goes down instead/.test(ev.text)), "…and the Chronicle says so");

  // The MAP is taken as well as raised: a second maneuver is at -5.
  const d4 = duel();
  pin([20, 12], [20, 12]);
  d4.eng.actionClick("trip"); d4.eng.tokenClick(d4.foe);
  d4.eng.actionClick("trip"); d4.eng.tokenClick(d4.foe);
  eq(rolls(d4.eng).at(-1).math, "12+2 = 14 vs DC 19", "…and the second one in a turn is at -5");
}

group("maneuvers: Shove");
{
  // 10 + the hound's Fortitude 7 = DC 17.
  const { eng, foe } = duel();
  pin([20, 12]);
  eng.actionClick("shove"); eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "12+7 = 19 vs DC 17", "Shove is Athletics against 10 + Fortitude");
  eq([foe.x, foe.y], [3, 1], "…and a success drives the hound one square straight back");
  ok(eng.events.some(ev => /driven back 5 feet/.test(ev.text)), "…which the Chronicle measures in feet");

  const d2 = duel();
  pin([20, 20]);
  d2.eng.actionClick("shove"); d2.eng.tokenClick(d2.foe);
  eq([d2.foe.x, d2.foe.y], [4, 1], "a critical Shove is two squares");

  // Nothing to give: a wall directly behind.
  const d3 = duel({}, {}, { walls: ["3,1"] });
  pin([20, 12]);
  d3.eng.actionClick("shove"); d3.eng.tokenClick(d3.foe);
  eq([d3.foe.x, d3.foe.y], [2, 1], "a target braced against a wall does not move");
  ok(d3.eng.events.some(ev => /does not give an inch/.test(ev.text)), "…and the line says why");

  // Forced movement is not a Stride: it provokes nothing.
  const d4 = duel({}, { reactions: ["reactive-strike"] });
  pin([20, 12]);
  d4.eng.actionClick("shove"); d4.eng.tokenClick(d4.foe);
  eq(rolls(d4.eng).length, 1, "being Shoved provokes no Reactive Strike — it is not a Stride");

  // Brutish Shove's second half was text until there was a Shove to do it with.
  const d5 = duel(); d5.ch.specials.push("brutish-shove");
  pin([20, 18], [8, 5]);
  d5.eng.actionClick("brutish"); d5.eng.tokenClick(d5.foe);
  eq([d5.foe.x, d5.foe.y], [3, 1], "Brutish Shove actually Shoves now, free and without a second check");
  eq(d5.foe.offGuardUntil, 1, "…and still leaves the target off-guard");
}

group("maneuvers: Grapple and Escape");
{
  const { eng, hero, foe } = duel();
  pin([20, 12]);
  eng.actionClick("grapple"); eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "12+7 = 19 vs DC 17", "Grapple is Athletics against 10 + Fortitude");
  eq([foe.grabbedBy, foe.grabDC, eng.condVal(foe, "grabbed")], ["hero", 19, 1],
    "…and the total that made the grab is the DC to break it");
  eq(eng.effAC(foe, hero).offGuard, true, "grabbed is off-guard");
  ok(eng.events.some(ev => /<b>Escape DC 19.<\/b>/.test(ev.text)), "…and the Chronicle prints the number");

  // The grabbed creature cannot walk out of it.
  const held = eng.cbs.find(c => c.id === "f");
  eq(eng.condVal(held, "grabbed"), 1, "the hound is held");

  // A grabbed hero's three ways to change square all refuse.
  const d2 = duel();
  d2.eng.grab(d2.foe, d2.hero, 18);
  d2.eng.actionClick("stride");
  eq([d2.eng.armed, d2.eng.h.toasts.at(-1)], [null, "You are grabbed — Escape first."], "a grabbed hero cannot Stride");
  d2.eng.actionClick("step");
  eq(d2.eng.armed, null, "…nor Step");
  d2.eng.actionClick("charge");
  eq([d2.eng.armed, d2.eng.actions], [null, 3], "…nor Sudden Charge, and none of them costs an action");

  // Escape: the better of Athletics and Acrobatics, against that DC.
  pin([20, 12]);
  d2.eng.actionClick("escape");
  eq(rolls(d2.eng).at(-1).math, "12+7 = 19 vs DC 18", "Escape rolls the better of Athletics and Acrobatics");
  eq([d2.eng.condVal(d2.hero, "grabbed"), d2.hero.grabbedBy, d2.eng.actions], [0, null, 2],
    "…and a success is free of it, for one action");
  eq(d2.hero.mapCount, 1, "…and Escape has the attack trait, so it raises the MAP");

  // A failed Escape stays held.
  const d3 = duel();
  d3.eng.grab(d3.foe, d3.hero, 25);
  pin([20, 5]);
  d3.eng.actionClick("escape");
  eq(d3.eng.condVal(d3.hero, "grabbed"), 1, "a failed Escape is still held");
  ok(d3.eng.events.some(ev => /strains against the grip and stays held/.test(ev.text)), "…and says so");

  // The grip ends when the grabber dies, or walks off.
  const d4 = duel();
  pin([20, 12]);
  d4.eng.actionClick("grapple"); d4.eng.tokenClick(d4.foe);
  d4.eng.kill(d4.hero);
  eq([d4.eng.condVal(d4.foe, "grabbed"), d4.foe.grabbedBy], [0, null], "a dead grabber lets go");
  const d5 = duel();
  pin([20, 12]);
  d5.eng.actionClick("grapple"); d5.eng.tokenClick(d5.foe);
  d5.eng.actionClick("stride"); d5.eng.cellClick(1, 4);
  eq(d5.eng.condVal(d5.foe, "grabbed"), 0, "…and so does one that walks away from it");

  // Critical failure: the grappler loses the footing too.
  const d6 = duel();
  pin([20, 1]);
  d6.eng.actionClick("grapple"); d6.eng.tokenClick(d6.foe);
  eq([d6.eng.condVal(d6.foe, "grabbed"), d6.hero.conditions.map(c => c.c)], [0, ["prone"]],
    "a critical failure and the grappler ends up on the floor");
}

group("maneuvers: Disarm");
{
  // 10 + the hound's Reflex 9 = DC 19, and Disarm alone requires training.
  const { eng, foe } = duel();
  pin([20, 12]);
  eng.actionClick("disarm"); eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "12+7 = 19 vs DC 19", "Disarm is Athletics against 10 + Reflex");
  eq(foe.conditions.map(c => c.c + c.v), ["disarmed1"], "…and a success is disarmed 1");
  pin([20, 10]);
  eng.strikeMonster(foe, eng.cbs[0], { name: "Bite", bonus: 9, die: "1d8+3", damageType: "piercing", traits: [], range: 1 });
  ok(rolls(eng).at(-1).math.startsWith("10+7 "), "…which is -2 on everything the hound swings: 9 becomes 7");

  // Critical: the weapon is on the floor and costs an action to pick up.
  const d2 = duel();
  pin([20, 20]);
  d2.eng.actionClick("disarm"); d2.eng.tokenClick(d2.foe);
  eq(d2.foe.disarmDropped, true, "a critical Disarm drops the weapon");
  d2.eng.order = [d2.foe, d2.hero]; d2.eng.aiTurn = function () { };
  d2.eng.beginTurn(0);
  eq([d2.eng.actions, d2.foe.disarmDropped], [2, false], "…and the hound's next turn spends one action retrieving it");
  ok(d2.eng.events.some(ev => /snatches up its weapon/.test(ev.text)), "…which the Chronicle says once");
}

group("maneuvers: size, and Titan Wrestler");
{
  const large = hound({ id: "g", name: "Ogre", x: 2, y: 1, monster: { level: 3, traits: ["giant"], size: "Large" } });
  const huge = hound({ id: "h", name: "Troll King", x: 1, y: 2, monster: { level: 5, traits: ["giant"], size: "Huge" } });
  const ch = fighter();
  const hero = Object.assign(heroCombatant(ch), { x: 1, y: 1 });
  const eng = stage([hero, large, huge]);
  eq([eng.sizeOf(hero), eng.sizeOf(large), eng.sizeOf(huge)], ["Medium", "Large", "Huge"],
    "size comes off the sheet for a hero and off the Registry entry for a monster");
  eq(eng.sizeOf(mk({})), "Medium", "…and anything that names none is Medium");
  eq([eng.canWrestle(hero, large), eng.canWrestle(hero, huge)], [true, false],
    "one size larger is fair game; two is not");
  ch.specials.push("titan-wrestler");
  eq(eng.canWrestle(hero, huge), true, "Titan Wrestler is exactly the second size, and nothing else");

  // The action itself refuses, costs nothing, and stays armed.
  const ch2 = fighter();
  const hero2 = Object.assign(heroCombatant(ch2), { x: 1, y: 1 });
  const e2 = stage([hero2, hound({ id: "h", name: "Troll King", x: 2, y: 1, monster: { level: 5, traits: ["giant"], size: "Huge" } })]);
  e2.actionClick("grapple"); e2.tokenClick(e2.cbs[1]);
  eq([e2.actions, e2.h.toasts.at(-1), !!e2.armed], [3, "Troll King is too big to grapple.", true],
    "a maneuver against something too big costs nothing and leaves the action armed");

  // bonus-dmg-vs-large: on the sheet and inert since it shipped.
  const ch3 = fighter(); ch3.specials.push("bonus-dmg-vs-large");
  const hero3 = Object.assign(heroCombatant(ch3), { x: 1, y: 1 });
  const ogre = hound({ id: "g", name: "Ogre", x: 2, y: 1, hp: 99, hpMax: 99, monster: { level: 3, traits: ["giant"], size: "Large" } });
  const e3 = stage([hero3, ogre]);
  pin([20, 15], [8, 4]);
  e3.actionClick("strike0"); e3.tokenClick(ogre);
  eq(ogre.hp, 99 - 7, "Mountain Strategy is +1 damage against a Large foe: 1d8+2 becomes 7");
  const medium = hound({ id: "m", x: 2, y: 1, hp: 99, hpMax: 99 });
  const e4 = stage([Object.assign(heroCombatant(ch3), { x: 1, y: 1 }), medium]);
  pin([20, 15], [8, 4]);
  e4.actionClick("strike0"); e4.tokenClick(medium);
  eq(medium.hp, 99 - 6, "…and nothing at all against a Medium one");
}

group("Stand, and a monster that gets back up");
{
  const { eng, hero } = duel();
  eng.addCond(hero, "prone", 1);
  eq(eng.atkMod(hero, hero.attacks[0]), hero.attacks[0].bonus - 2, "prone is -2 to your own attacks");
  eng.actionClick("stand");
  eq([eng.condVal(hero, "prone"), eng.actions], [0, 2], "Stand is one action and gets you back up");
  eng.actionClick("stand");
  eq([eng.actions, eng.h.toasts.at(-1)], [2, "You are already on your feet."], "…and costs nothing when you already are");

  // Grabbed beats prone: you cannot stand out of a grip.
  const d2 = duel();
  d2.eng.addCond(d2.hero, "prone", 1);
  d2.eng.grab(d2.foe, d2.hero, 18);
  d2.eng.actionClick("stand");
  eq([d2.eng.condVal(d2.hero, "prone"), d2.eng.actions, d2.eng.h.toasts.at(-1)], [1, 3, "You are grabbed — Escape first."],
    "a grabbed hero cannot Stand either");

  // The AI: before Phase 5 nothing removed prone, so a tripped monster fought
  // the rest of the fight from the floor.
  const d3 = duel();
  d3.eng.addCond(d3.foe, "prone", 1);
  d3.eng.order = [d3.foe, d3.hero];
  d3.eng.turnIdx = 0; d3.eng.actions = 3;
  const step = d3.eng.aiStep(d3.foe);
  eq([step.action, d3.eng.condVal(d3.foe, "prone"), d3.eng.actions], ["stand", 0, 2], "a prone monster stands before it swings");

  // …and a grabbed one breaks the grip rather than trying to walk.
  const d4 = duel({}, { x: 6, y: 6 });
  d4.eng.grab(d4.hero, d4.foe, 12);
  d4.eng.order = [d4.foe, d4.hero];
  d4.eng.turnIdx = 0; d4.eng.actions = 3;
  pin([20, 20]);
  const s4 = d4.eng.aiStep(d4.foe);
  eq([s4.action, d4.eng.condVal(d4.foe, "grabbed"), d4.foe.x], ["escape", 0, 6],
    "a grabbed monster Escapes instead of moving, and does not budge until it is free");
}

group("Aid");
{
  /** Two heroes and a hound. Bran is a second fighter one square south. */
  const pair = (aiderOver = {}) => {
    const ch = fighter(), ach = fighter(aiderOver);
    const hero = Object.assign(heroCombatant(ch), { x: 1, y: 1 });
    const bran = Object.assign(heroCombatant(ach), { id: "ally", name: "Bran", x: 1, y: 2 });
    const foe = hound({ x: 2, y: 1 });
    const eng = stage([hero, bran, foe]);
    return { eng, hero, bran, foe, ch, ach };
  };
  const { eng, hero, bran, foe } = pair();
  eng.actionClick("aid");
  eq(eng.armed.friendly, true, "Aid arms a friendly target");
  eq(eng.targets(eng.armed).map(t => t.id).sort(), ["ally", "hero"], "…reaching an adjacent ally");
  eng.tokenClick(bran);
  eq([bran.aidedBy, hero.aidPrepared, eng.actions], [{ by: "hero", round: 1 }, "ally", 2],
    "preparing to Aid costs an action and is remembered at both ends");
  eng.actionClick("aid"); eng.tokenClick(hero);
  eq([eng.h.toasts.at(-1), eng.actions], ["You cannot Aid yourself.", 2], "…and you cannot prepare it on yourself");
  eng.armed = null;

  // The only action in the game that outlives the turn that spent it.
  eng.endTurn();
  eq(eng.cur().id, "ally", "Bran is up");
  eq(bran.aidedBy, { by: "hero", round: 1 }, "…and the prepared Aid survived the turn boundary");
  pin([20, 12], [20, 10], [8, 3]);
  eng.actionClick("strike0"); eng.tokenClick(foe);
  eq(rolls(eng)[0].math, "12+7 = 19 vs DC 15", "the Aid check is the aider's Athletics against a flat DC 15");
  eq(rolls(eng)[1].math.startsWith("10+11 "), true, "…and a success is +1 on Bran's attack: 10 becomes 11");
  eq(bran.aidedBy, null, "…spent, once");

  // Cooperative Nature, inert since it shipped.
  const p3 = pair();
  p3.ch.specials.push("cooperative-nature");
  p3.eng.actionClick("aid"); p3.eng.tokenClick(p3.bran);
  p3.eng.endTurn();
  pin([20, 14], [20, 10], [8, 3]);
  p3.eng.actionClick("strike0"); p3.eng.tokenClick(p3.foe);
  eq(rolls(p3.eng)[0].math, "14+11 = 25 vs DC 15", "Cooperative Nature is +4 on the Aid check");
  eq(rolls(p3.eng)[1].math.startsWith("10+12 "), true, "…and a critical success is +2 rather than +1");

  // A critical failure is -1, and it lands.
  const p4 = pair();
  p4.eng.actionClick("aid"); p4.eng.tokenClick(p4.bran);
  p4.eng.endTurn();
  pin([20, 1], [20, 10], [8, 3]);
  p4.eng.actionClick("strike0"); p4.eng.tokenClick(p4.foe);
  eq(rolls(p4.eng)[1].math.startsWith("10+9 "), true, "a critical failure gets in the way: -1");
  ok(p4.eng.events.some(ev => /gets in the way/.test(ev.text)), "…and the Chronicle says whose fault it was");

  // It expires at the start of the aider's next turn, used or not.
  const p5 = pair();
  p5.eng.actionClick("aid"); p5.eng.tokenClick(p5.bran);
  p5.eng.endTurn(); p5.eng.endTurn(); p5.eng.endTurn();
  eq([p5.eng.cur().id, p5.bran.aidedBy, p5.hero.aidPrepared], ["hero", null, null],
    "an Aid nobody used is dropped when the aider's next turn starts");

  // A maneuver reads it too.
  const p6 = pair();
  p6.eng.actionClick("aid"); p6.eng.tokenClick(p6.bran);
  p6.eng.endTurn();
  pin([20, 12], [20, 12]);
  p6.eng.actionClick("trip"); p6.eng.tokenClick(p6.foe);
  eq(rolls(p6.eng)[1].math, "12+8 = 20 vs DC 19", "…and an Athletics maneuver reads the same prepared Aid");
}

group("Recall Knowledge");
{
  // A level-1 beast is DC 15, and a fighter's Nature is untrained: Wisdom alone.
  const { eng, foe } = duel({}, { monster: { level: 1, traits: ["beast"], lore: "They hunt by sound." } });
  eq(eng.recallSkill(foe), "nature", "a beast is a Nature question");
  eng.actionClick("recall");
  eq(eng.armed.range, 6, "Recall Knowledge reaches 30 feet");
  pin([20, 15]);
  eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "15+1 = 16 vs DC 15", "…against the level-based DC for a level-1 creature");
  ok(eng.events.some(ev => /<b>Hound<\/b> — AC 16, HP 24\/24\./.test(ev.text)), "a success is the AC and what is left of it");
  ok(!eng.events.some(ev => /They hunt by sound/.test(ev.text)), "…and no more than that");
  eq([foe.recalled, foe.recallTries, eng.actions], [true, 1, 2], "…for one action");

  // A second attempt against the same creature is two harder.
  pin([20, 15]);
  eng.actionClick("recall"); eng.tokenClick(foe);
  eq(rolls(eng).at(-1).math, "15+1 = 16 vs DC 17", "asking twice about the same creature is +2 DC");

  // A critical success adds the saves, the weaknesses, and the monster's lore.
  const d2 = duel({}, { monster: { level: 1, traits: ["beast"], lore: "They hunt by sound." },
    weaknesses: [{ type: "fire", value: 3 }], immunities: ["poison"] });
  pin([20, 20]);
  d2.eng.actionClick("recall"); d2.eng.tokenClick(d2.foe);
  ok(d2.eng.events.some(ev => /Fort \+7, Ref \+9, Will \+5 · weak to fire 3 · immune to poison\./.test(ev.text)),
    "a critical success is the saves and what it is weak to");
  ok(d2.eng.events.some(ev => /<i>They hunt by sound\.<\/i>/.test(ev.text)), "…plus the monster's own `lore` line");

  // A critical failure says something, and all of it is wrong.
  const d3 = duel();
  pin([20, 1]);
  d3.eng.actionClick("recall"); d3.eng.tokenClick(d3.foe);
  ok(d3.eng.events.some(ev => /every word of it is wrong/.test(ev.text)), "a critical failure remembers the wrong thing");
  eq(d3.foe.recalled, undefined, "…and learns nothing");

  // The trait table, and its fallback.
  eq(LORE_SKILL.undead, "religion", "undead is a Religion question");
  eq(eng.recallSkill(mk({ monster: { traits: ["ooze"] } })), "occultism", "…and something nobody has a word for is Occultism");
  eq(eng.recallSkill(mk({})), "occultism", "…as is a creature with no traits at all");
}

group("Delay");
{
  const a = mk({ id: "a", side: "pc", name: "Alis", x: 0, y: 0, char: { specials: [], resists: [] } });
  const b = mk({ id: "b", name: "Bran", x: 2, y: 0 });
  const c = mk({ id: "c", name: "Cass", x: 3, y: 0 });
  const eng = stage([a, b, c], { order: [a, b, c] });
  eq(eng.cur().id, "a", "Alis is up");
  eng.doDelay();
  eq(eng.order.map(x => x.id), ["b", "c", "a"], "Delay moves the delayer to the end of the initiative order");
  eq([eng.cur().id, eng.round], ["b", 1], "…and the next combatant acts, in the same round");
  eq(eng.turnIdx, 0, "…in the slot the delayer vacated");
  ok(eng.events.some(ev => /<b>Alis Delays<\/b>/.test(ev.text)), "…and the Chronicle says so");

  // Once per round: two Delays in one round is a combatant that never acts.
  eng.endTurn(); eng.endTurn();
  eq(eng.cur().id, "a", "the delayed turn comes round at the end");
  eq(eng.doDelay(), false, "…and a second Delay in the same round is refused");
  eq(eng.h.toasts.at(-1), "You have already Delayed this round.", "…out loud");

  // A combatant already last has nothing to move past.
  const e2 = stage([a, b, c], { order: [a, b, c] });
  e2.turnIdx = 2;
  const before = e2.order.map(x => x.id);
  e2.doDelay();
  eq(e2.order.map(x => x.id), before, "a combatant already last in the order stays where it is");
  eq([e2.cur().id, e2.round], ["a", 2], "…and simply ends its turn, which ends the round");

  // Conditions do not tick on a Delay: the turn has not happened yet. Fresh
  // combatants, because `delayedRound` is written onto them and the two
  // engines above have already used these three.
  const a2 = mk({ id: "a", side: "pc", name: "Alis", x: 0, y: 0, char: { specials: [], resists: [] } });
  const b2 = mk({ id: "b", name: "Bran", x: 2, y: 0 });
  const c2 = mk({ id: "c", name: "Cass", x: 3, y: 0 });
  const e3 = stage([a2, b2, c2], { order: [a2, b2, c2] });
  e3.addCond(a2, "frightened", 2);
  eq(e3.doDelay(), true, "a combatant that has not Delayed this round may");
  eq(e3.condVal(a2, "frightened"), 2, "…and Delay is not End Turn: nothing ticks");
  e3.endTurn(); e3.endTurn();
  eq(e3.cur().id, "a", "the delayed turn is the last of the round");
  e3.endTurn();
  eq(e3.condVal(a2, "frightened"), 1, "…and it ticks when that turn ends, like anybody else's");
}

group("Ready");
{
  /** The fighter at (1,1) with a hound five squares east, the fighter's turn. */
  const setup = () => {
    const ch = fighter();
    const hero = Object.assign(heroCombatant(ch), { x: 1, y: 1 });
    const foe = hound({ x: 6, y: 1 });
    const eng = stage([hero, foe]);
    return { eng, hero, foe, ch };
  };
  const { eng, hero, foe } = setup();
  eng.actionClick("ready");
  eq([hero.readied, eng.actions], [{ kind: "strike" }, 1], "Ready is two actions and arms one Strike");
  ok(eng.events.some(ev => /<b>Readies<\/b> a Strike/.test(ev.text)), "…and says what it is waiting for");

  // It fires on the step that brings a foe into reach, not before.
  pin([20, 15], [8, 4]);
  eng.provokeAlong(foe, [{ x: 6, y: 1 }, { x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }]);
  eq(rolls(eng).length, 1, "a readied Strike fires exactly once, on the step that enters reach");
  eq([foe.hp, hero.readied, hero.reactionUsed], [24 - 6, null, true],
    "…it lands, it is spent, and it costs the hero its reaction for the round");
  ok(eng.events.some(ev => /<b>Readied Strike!<\/b>/.test(ev.text)), "…and the Chronicle names it");

  // A move that never enters reach leaves it armed.
  const s2 = setup();
  s2.eng.actionClick("ready");
  s2.eng.provokeAlong(s2.foe, [{ x: 6, y: 1 }, { x: 6, y: 2 }, { x: 6, y: 3 }]);
  eq([s2.hero.readied, s2.hero.reactionUsed], [{ kind: "strike" }, false], "a foe that stays out of reach does not set it off");

  // Nor does one already inside it that merely shuffles: the trigger is
  // entering reach, which is both halves of the comparison and not just the
  // second one.
  const s2b = setup();
  s2b.foe.x = 2; s2b.foe.y = 1;
  s2b.eng.actionClick("ready");
  s2b.eng.provokeAlong(s2b.foe, [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]);
  eq([s2b.hero.readied, s2b.foe.hp], [{ kind: "strike" }, 24],
    "a foe already within reach that moves inside it does not set it off either");

  // It is not a reaction id, so content cannot name it and the validator does
  // not know it: the two lists stay exactly what Phase 3 made them.
  eq(KNOWN_REACTIONS.includes("readied"), false, "a readied action is not a reaction id");

  // It is dropped at the start of the readier's next turn, fired or not.
  const s3 = setup();
  s3.eng.actionClick("ready");
  s3.eng.endTurn();
  s3.eng.aiTurn = function () { };
  s3.eng.beginTurn(0);
  eq(s3.hero.readied, null, "a readied Strike nobody triggered is gone by your next turn");

  // An ally moving past does not set it off.
  const s4 = setup();
  const ally = mk({ id: "a", side: "pc", name: "Bran", x: 6, y: 1 });
  s4.eng.cbs.push(ally); s4.eng.order.push(ally);
  s4.eng.actionClick("ready");
  s4.eng.provokeAlong(ally, [{ x: 6, y: 1 }, { x: 5, y: 1 }, { x: 2, y: 1 }]);
  eq(s4.hero.readied, { kind: "strike" }, "a readied Strike is aimed at the other side only");
}

group("conditional save bonuses off the sheet");
{
  // Two heritages carried `{"bonus":{"target":"save.all","vs":…}}` and nothing
  // read them: they were collected onto the sheet and stopped there. The base
  // save is read back off `saveMod` rather than hard-coded, because the claim
  // here is "one more than it was", not "8".
  const dwarf = forge("fighter", { ancestry: "dwarf", heritage: "ancient-blooded-dwarf" });
  eq(dwarf.condBonuses, [{ target: "save.all", value: 1, type: "status", vs: "magic" }],
    "Ancient-Blooded Dwarf's +1 vs magic is on the sheet");
  const hero = Object.assign(heroCombatant(dwarf), { x: 0, y: 0 });
  const eng = stage([hero, hound({ x: 2, y: 0 })]);
  const will = eng.saveMod(hero, "will");
  pin([20, 10]);
  eng.rollSave(hero, "will", 20, "Fear", ["magic", "emotion", "mental"]);
  eq(rolls(eng).at(-1).math, `10+${will + 1} = ${11 + will} vs DC 20`, "…and a save against a spell reads it: one more than the sheet");
  pin([20, 10]);
  eng.rollSave(hero, "will", 20, "Toll of the Deep", []);
  eq(rolls(eng).at(-1).math, `10+${will} = ${10 + will} vs DC 20`, "…while a monster's power, which is not magic, does not");

  const halfling = forge("fighter", { ancestry: "halfling", heritage: "gutsy-halfling" });
  eq(halfling.condBonuses, [{ target: "save.all", value: 1, type: "circumstance", vs: "emotion" }],
    "Gutsy Halfling's +1 vs emotion is on the sheet too");
  const h2 = Object.assign(heroCombatant(halfling), { x: 0, y: 0 });
  const e2 = stage([h2, hound({ x: 2, y: 0 })]);
  const will2 = e2.saveMod(h2, "will");
  pin([20, 10]);
  e2.rollSave(h2, "will", 20, "Fear", ["magic", "emotion", "mental"]);
  eq(rolls(e2).at(-1).math, `10+${will2 + 1} = ${11 + will2} vs DC 20`, "…and an emotion spell is what reads it");
  pin([20, 10]);
  e2.rollSave(h2, "will", 20, "Phantom Pain", ["magic", "mental"]);
  eq(rolls(e2).at(-1).math, `10+${will2} = ${10 + will2} vs DC 20`, "…while a spell carrying neither trait does not");

  // And it reaches the real spell path, not just a direct call.
  const caster = Object.assign(heroCombatant(forge("wizard", { spells: { cantrips: [], r1: ["fear"], r2: [] } })), { x: 0, y: 0 });
  const target = Object.assign(heroCombatant(dwarf), { id: "t", side: "foe", name: "Dwarf", x: 1, y: 0 });
  const e3 = stage([caster, target]);
  const fear = Registry.spells.fear;
  ok(fear && (fear.traits || []).includes("emotion"), "the shipped Fear spell carries emotion, fear and mental");
  const will3 = e3.saveMod(target, "will");
  pin([20, 10]);
  e3.castAt(caster, { spell: fear, castRank: 1, pool: "r1", cost: 2, kind: "target" }, target);
  eq(rolls(e3).at(-1).math.startsWith(`10+${will3 + 1} `), true, "…and casting it at the dwarf reads the +1 through castAt");
}

group("three feats stopped being note text");
{
  // The three hooks Phase 5 wired reach `specials` from the shipped pack, not
  // just from a test that pushes them on by hand. Two of them were `note`
  // entries in CORE_PACK and had to become `special` ids for any of the code
  // above to ever run: a feat whose effect is a note is a feat the engine
  // cannot see.
  const withFeat = id => forge("fighter", { feats: { skill: [id] } }).specials;
  ok(withFeat("titan-wrestler").includes("titan-wrestler"),
    "Titan Wrestler is a wired hook now, not a note reading 'Wrestle giants'");
  ok(withFeat("cooperative-nature").includes("cooperative-nature"),
    "…and so is Cooperative Nature, whose +4 to Aid was a note reading '+4 to Aid'");
  ok(withFeat("mountain-strategy").includes("bonus-dmg-vs-large"),
    "Mountain Strategy already carried `bonus-dmg-vs-large`; it just did nothing");
  ok(withFeat("titan-slinger").includes("bonus-dmg-vs-large"), "…as did Titan Slinger");
  // Rock Dwarf stays a note on purpose: nothing in the game can Shove or Trip
  // a hero, so there is no DC for its +2 to apply to.
  ok(forge("fighter", { ancestry: "dwarf", heritage: "rock-dwarf" }).notes
      .some(n => /\+2 DC vs Shove\/Trip\/prone/.test(n)),
    "Rock Dwarf is still a note, because only heroes make maneuvers");
}

group("the monster schema grew two fields");
{
  const base = { pack: { id: "p", name: "P", type: "content" } };
  const errs = s => Validator.validate(s, emptyRegistry());
  eq(errs({ ...base, monsters: [{ id: "m", name: "M", ac: 10, hp: 10, attacks: [], saves: {}, size: "Enormous" }] }),
    ['Monster "m": unknown size "Enormous" (known: Tiny, Small, Medium, Large, Huge, Gargantuan).'],
    "a misspelled size is rejected rather than silently reading as Medium");
  eq(errs({ ...base, monsters: [{ id: "m", name: "M", ac: 10, hp: 10, attacks: [], saves: {}, size: "Huge" }] }), [],
    "…and a real one passes");
  eq(errs({ ...base, monsters: [{ id: "m", name: "M", ac: 10, hp: 10, attacks: [], saves: {}, lore: 7 }] }),
    ['Monster "m": "lore" must be a string — the one line a critical Recall Knowledge prints.'],
    "`lore` has to be the line it prints");
  eq(errs({ ...base, ancestries: [{ id: "a", name: "A", hp: 8, speed: 25, boosts: [], heritages: [], size: "Enormous" }] }),
    ['Ancestry "a": unknown size "Enormous" (known: Tiny, Small, Medium, Large, Huge, Gargantuan).'],
    "…and an ancestry's size is checked the same way");
  ok(Object.values(Registry.monsters).every(m => m.size === undefined || SIZES.includes(m.size)),
    "every monster that ships names a size the table knows");
  eq(Object.values(Registry.monsters).filter(m => typeof m.lore === "string").length, 6,
    "…and the six core monsters carry a lore line for a critical Recall Knowledge");
}

setDiceSource();

/* ---------------- report ---------------- */
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL  " + f);
  process.exit(1);
}
