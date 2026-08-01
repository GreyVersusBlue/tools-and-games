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
ok(html.includes('from "./torchbearer/js/save.js"'), "imports save.js");
ok(html.includes('from "./torchbearer/js/library.js"'), "imports library.js");
// The whole point of adopting gvb-save: one implementation of storage, in one
// place. If a direct localStorage call reappears in the page, this fails.
// Comments are stripped first — this file explains the adoption in prose, and
// matching the word rather than the call would fail on its own documentation.
const codeOnly = html
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
ok(!/localStorage\s*\./.test(codeOnly), "the page makes no direct localStorage call");
ok(!/const (Registry|Validator) = \{/.test(html), "Registry and Validator are not inlined again");
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

/* ---------------- report ---------------- */
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL  " + f);
  process.exit(1);
}
