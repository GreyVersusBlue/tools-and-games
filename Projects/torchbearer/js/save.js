// save.js — Torchbearer's slot on the shared save system.
//
// Before session 8 this game hand-rolled all three doors: `localStorage` under
// `torchbearer-save`, a Blob download named `<hero>.torchsave.json`, and a
// `<input type="file">` that JSON.parsed whatever it was handed and passed it
// straight to `finalizeCharacter`. A file with `{"build":{"cls":"nonsense"}}`
// got as far as `cls.perception` before anything noticed.
//
// The key stays `torchbearer-save` (locked decision #36). Old saves carry
// `{"v":1}` rather than gvb-save's `__v`, so `normalize()` reads them as
// version 0 and they come through `migrate` then `repair` like any other.
//
// Imported RELATIVELY so test/smoke.mjs can load this under plain Node —
// a leading slash is not resolvable there (v7 §7).
import { createSaveSlot } from "../../../assets/js/gvb-save.js";
import { CHAR_LEVEL, MAX_LEVEL } from "./rules.js";

export const SAVE_KEY = "torchbearer-save";
/**
 * 3 since Phase 6: `build.level`, `build.advances` (the per-level choice map)
 * and `xp` on the snapshot. All three are additive. A version-2 save is a
 * level-3 hero by definition — nothing before Phase 6 could forge anything
 * else — so `migrate` stamps that rather than leaving `repair` to guess it.
 *
 * Still 3 after Phase 7. `campaignId`, `campaignFlags` and `completed` are
 * additive too, and unlike `build.level` their pre-Phase-7 value is not a fact
 * `migrate` has to know — it is the same "no campaign" that `repair` fills in
 * for any save missing them (locked #122).
 */
export const SAVE_VERSION = 3;

const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** The resource block every hero combatant needs to exist. */
export function blankResources() {
  return { slots: { 1: 0, 2: 0 }, focus: 0, font: 0, potions: [] };
}

/**
 * `potions` used to be a bare count, so Drink Potion always rolled a flat
 * `1d8` no matter which healing item the hero was actually holding — the
 * Lesser Healing Potion's own text promises `2d8+5` (session 10, "the potion
 * heal question"). It is now a stack of item ids so the action can look up
 * each one's own `heal` formula. A save written before this change (or a
 * hand-built snapshot) still carries a plain number; read it back as that
 * many `healing-potion-minor`s, since that was the only potion the old code
 * could ever have counted.
 */
function normalizePotions(v) {
  if (Array.isArray(v)) return v.filter(id => typeof id === "string");
  const n = num(v, 0);
  return n > 0 ? Array(Math.floor(n)).fill("healing-potion-minor") : [];
}

/**
 * The three fields `finalizeCharacter` dereferences without a guard, and the
 * three `Builder` writes into. A build missing any of them threw before it
 * could be rejected.
 */
export function repairBuild(build) {
  const b = obj(build) || {};
  b.name = typeof b.name === "string" ? b.name : "";
  b.boosts = obj(b.boosts) || { ancestry: [], bgA: null, bgFree: null, key: null, free: [] };
  b.boosts.ancestry = Array.isArray(b.boosts.ancestry) ? b.boosts.ancestry : [];
  b.boosts.free = Array.isArray(b.boosts.free) ? b.boosts.free : [];
  b.skills = Array.isArray(b.skills) ? b.skills : [];
  b.loreExtra = Array.isArray(b.loreExtra) ? b.loreExtra : [];
  b.extraPicks = Array.isArray(b.extraPicks) ? b.extraPicks : [];
  b.feats = obj(b.feats) || {};
  b.focusChoices = obj(b.focusChoices) || {};
  b.spells = obj(b.spells) || {};
  b.spells.cantrips = Array.isArray(b.spells.cantrips) ? b.spells.cantrips : [];
  b.spells.r1 = Array.isArray(b.spells.r1) ? b.spells.r1 : [];
  b.spells.r2 = Array.isArray(b.spells.r2) ? b.spells.r2 : [];
  b.gear = obj(b.gear) || { weapon: null, weapon2: null, ranged: null, armor: null, shield: false };
  b.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(num(b.level, CHAR_LEVEL))));
  b.advances = repairAdvances(b.advances);
  return b;
}

/**
 * The per-level choice map: `{ "4": { feats: {class4: id}, skillIncrease: id|null,
 * boosts: [abil…] }, … }`, one entry per level from 4 up, written by the
 * level-up flow and read by `rules.js`. Keys that are not whole levels above
 * 3 are dropped; an entry's three fields are shaped the way the builder's
 * own `feats`, `skillIncrease` and `boosts.free` are.
 */
export function repairAdvances(advances) {
  const out = {};
  const a = obj(advances) || {};
  for (const k of Object.keys(a)) {
    const l = Number(k);
    if (!Number.isInteger(l) || l < 4 || l > MAX_LEVEL || String(l) !== k) continue;
    const e = obj(a[k]) || {};
    out[k] = {
      feats: obj(e.feats) || {},
      skillIncrease: typeof e.skillIncrease === "string" ? e.skillIncrease : null,
      boosts: Array.isArray(e.boosts) ? e.boosts.filter(b => typeof b === "string") : []
    };
  }
  return out;
}

/**
 * The hero's in-combat state. `hp: null` means "unrecorded" — restore to full
 * rather than to NaN.
 *
 * This is the fill-in that `repair` exists for, and Torchbearer had the exact
 * bug the hook was written to catch. `App.loadSave` used to assign
 * `cb.resources = s.hero.resources` wholesale. A save whose resource block
 * predates a field — `potions` is the one that bites, because `gotoScene`
 * does `hero.resources.potions++` on any scene handing out a healing potion —
 * turns that counter into NaN. The Chronicle still prints "Gained: Lesser
 * Healing Potion", the button is gated behind `(cb.resources.potions||0)>0`,
 * and the potion silently never exists. A missing `slots` is louder: the party
 * panel does `cb.resources.slots[1]` and throws on render.
 */
export function repairHero(hero) {
  const h = obj(hero);
  if (!h) return null;
  const r = obj(h.resources) || {};
  const slots = obj(r.slots) || {};
  return {
    hp: Number.isFinite(+h.hp) ? +h.hp : null,
    wounded: num(h.wounded, 0),
    resources: {
      slots: { 1: num(slots[1], 0), 2: num(slots[2], 0) },
      focus: num(r.focus, 0),
      font: num(r.font, 0),
      potions: normalizePotions(r.potions)
    }
  };
}

/** Runs on every accepted load, from every door (locked decision #37). */
export function repairSnapshot(state) {
  const s = state;
  s.build = repairBuild(s.build);
  s.flags = obj(s.flags) || {};
  s.dailyLuckUsed = !!s.dailyLuckUsed;
  s.xp = Math.max(0, num(s.xp, 0));
  s.advId = typeof s.advId === "string" ? s.advId : null;
  s.sceneId = typeof s.sceneId === "string" ? s.sceneId : null;
  /* Phase 7's three fields, and the reason `SAVE_VERSION` did not move for
     them (locked decision #122). A save written before campaigns existed is a
     hero with no campaign, no folded flags and nothing finished — which is
     exactly what these three lines compute for any save that omits them. A
     `migrate` step would have nothing left to do, and #37 says migrate is for
     version drift while repair runs on every load. `campaignFlags` is the
     campaign-scoped half of the flag grammar in js/campaign.js; `completed`
     is the adventures this campaign has finished, in the order they finished. */
  s.campaignId = typeof s.campaignId === "string" ? s.campaignId : null;
  s.campaignFlags = obj(s.campaignFlags) || {};
  s.completed = Array.isArray(s.completed)
    ? s.completed.filter((id, i, a) => typeof id === "string" && a.indexOf(id) === i)
    : [];
  s.hero = repairHero(s.hero);
  s.companions = Array.isArray(s.companions)
    ? s.companions.filter(c => obj(c) && typeof c.id === "string")
        .map(c => ({ id: c.id, hp: Number.isFinite(+c.hp) ? +c.hp : null }))
    : [];
  // The Chronicle is replayed with innerHTML, so it is the one part of a save
  // an imported file could use to inject markup. Nothing here has a session or
  // a credential to steal, but there is no reason to accept a 40 MB blob or a
  // <script> either: cap the length, keep the last 80 entries the writer keeps.
  s.chronicle = Array.isArray(s.chronicle)
    ? s.chronicle.filter(e => obj(e) && typeof e.html === "string")
        .slice(-80)
        .map(e => ({
          html: e.html.length > 4000 ? e.html.slice(0, 4000) : e.html,
          cls: typeof e.cls === "string" ? e.cls : ""
        }))
    : [];
  return s;
}

/**
 * A save has to name an ancestry, a background and a class. Everything else
 * `finalizeCharacter` reads has a default; those three it indexes straight
 * into the Registry and then dereferences.
 */
export function validateSnapshot(state) {
  const s = obj(state);
  if (!s) return false;
  const b = obj(s.build);
  if (!b) return false;
  return ["ancestry", "background", "cls"].every(k => typeof b[k] === "string" && b[k].length > 0);
}

export function createTorchSlot(storage) {
  return createSaveSlot({
    game: "torchbearer",
    key: SAVE_KEY,
    version: SAVE_VERSION,
    validate: validateSnapshot,
    // Version drift only. v1 stamped its own `v: 1` inside the state; gvb-save
    // keeps the stamp in `__v` and strips it, so the old field is dead weight.
    // v3 added the level record: a v2 build is a level-3 hero with nothing
    // chosen above 3 — its level-1-to-3 choices are already the flat `feats`,
    // `skillIncrease` and `boosts` fields — and no experience banked.
    // `validate` has not run yet here, so the build is only touched if it is
    // an object at all.
    migrate: (s, from) => {
      if (from < 2) delete s.v;
      if (from < 3) {
        if (obj(s.build)) { s.build.level = CHAR_LEVEL; s.build.advances = {}; }
        s.xp = 0;
      }
      return s;
    },
    repair: repairSnapshot,
    // No `defaults`: a fresh Torchbearer state is "no hero yet", which the
    // title screen already represents by having nothing to resume. `reset()`
    // returning null is correct here rather than a bug.
    defaults: null,
    storage: storage || null
  });
}
