// registry.js — the content store and the pack validator.
//
// Lifted out of torchbearer.html unchanged in behaviour, for one reason: the
// validator IS the contract described in content-authoring-guide.md, and a
// contract nothing tests drifts. `test/smoke.mjs` imports this and runs both
// bundled packs plus a set of deliberately broken ones through it under plain
// Node. Nothing in here touches the DOM.
//
// The page still holds CORE_PACK and ADVENTURE_PACK inline. Moving those to
// fetched JSON would make the title screen depend on a network round trip that
// can fail; the bundled library in ../packs/ is progressive enhancement and can
// afford to.

import { flagsSetBy, isScoped, SCOPE } from "./campaign.js";

/* ---------- Content Registry ---------- */
export const Registry = {
  packs: [], ancestries: {}, backgrounds: {}, classes: {}, feats: {}, spells: {}, items: {},
  monsters: {}, companions: {}, adventures: {}, campaigns: {},
  loadPack(pack) {
    const errs = Validator.validate(pack, this);
    if (errs.length) throw new Error("Content pack rejected:\n• " + errs.join("\n• "));
    const put = (map, arr) => { (arr || []).forEach(o => { map[o.id] = o; }); };
    put(this.ancestries, pack.ancestries); put(this.backgrounds, pack.backgrounds);
    put(this.classes, pack.classes); put(this.feats, pack.feats); put(this.spells, pack.spells);
    put(this.items, pack.items); put(this.monsters, pack.monsters); put(this.companions, pack.companions);
    put(this.adventures, pack.adventures); put(this.campaigns, pack.campaigns);
    this.packs.push(pack.pack);
    return pack.pack;
  },
  /** True once a pack with this id has been loaded. Drives the library UI. */
  hasPack(id) { return this.packs.some(p => p.id === id); },
  list(map, filter) { return Object.values(map).filter(filter || (() => true)); }
};

/** A registry with nothing in it — what the tests validate a pack against. */
export function emptyRegistry() {
  return {
    ...Registry,
    packs: [], ancestries: {}, backgrounds: {}, classes: {}, feats: {}, spells: {},
    items: {}, monsters: {}, companions: {}, adventures: {}, campaigns: {}
  };
}

/**
 * Every reaction id a monster's `"reactions"` field may name.
 *
 * The source of truth is `REACTIONS` in js/combat.js; this is a copy, because
 * combat.js imports this file and the dependency cannot run both ways. A copy
 * that drifts is worse than no check at all, so `smoke.mjs` asserts the two
 * lists are identical and fails when either side grows without the other.
 */
export const KNOWN_REACTIONS = ["reactive-strike", "shield-block", "nimble-dodge"];

/**
 * PF2e's six sizes, smallest first, and the vocabulary a monster's or an
 * ancestry's `"size"` field is checked against.
 *
 * It lives here rather than in rules.js because the validator needs it and the
 * dependency runs one way — combat.js imports rules.js imports registry.js.
 * rules.js re-exports it so nothing outside has to know that, and there is one
 * copy rather than the KNOWN_REACTIONS arrangement of two kept honest by a
 * test.
 */
export const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

/* ---------- Pack validation (friendly errors for JSON authors) ----------
   Every check here is a promise the authoring guide makes. Five of them were
   promises the guide made and this file did not keep — a scene with no `text`
   validated fine and then threw `sc.text.map is not a function` the moment a
   player walked into it. Those are the ones marked "added session 8". */
export const Validator = {
  validate(pack, registry) {
    const errs = [];
    if (!pack || typeof pack !== "object") { return ["Top level must be a JSON object."]; }
    if (!pack.pack || !pack.pack.id || !pack.pack.name) errs.push('Missing "pack" metadata: needs at least {"id","name","type"}.');
    const checkIds = (arr, label, req) => {
      (arr || []).forEach((o, i) => {
        if (!o.id) errs.push(`${label}[${i}] is missing an "id".`);
        if (!o.name) errs.push(`${label}[${i}] (${o.id || "?"}) is missing a "name".`);
        (req || []).forEach(k => { if (o[k] === undefined) errs.push(`${label} "${o.id || i}" is missing required field "${k}".`); });
      });
    };
    checkIds(pack.ancestries, "ancestries", ["hp", "speed", "boosts", "heritages"]);
    (pack.ancestries || []).forEach(a => {
      if (a.size !== undefined && !SIZES.includes(a.size)) {
        errs.push(`Ancestry "${a.id}": unknown size "${a.size}" (known: ${SIZES.join(", ")}).`);
      }
    });
    checkIds(pack.backgrounds, "backgrounds", ["boosts", "skills"]);
    checkIds(pack.classes, "classes", ["hp", "keyAbility", "perception", "saves", "attacks", "defenses", "skillCount"]);
    checkIds(pack.feats, "feats", ["type", "level"]);
    checkIds(pack.spells, "spells", ["rank", "traditions", "actions", "rankEffects"]);
    checkIds(pack.items, "items", ["category"]);
    checkIds(pack.monsters, "monsters", ["ac", "hp", "attacks", "saves"]);
    checkIds(pack.adventures, "adventures", ["start", "scenes"]);
    checkIds(pack.campaigns, "campaigns", ["adventures"]);

    // added Phase 3: `reactions` and `reach` are the two fields §10 grew when
    // the trigger bus landed. An unknown reaction id is exactly as dead as an
    // unknown monster id and gets the same treatment — a reaction the engine
    // does not implement is a monster that silently never reacts.
    (pack.monsters || []).forEach(m => {
      if (m.reactions !== undefined) {
        if (!Array.isArray(m.reactions)) errs.push(`Monster "${m.id}": "reactions" must be an array of reaction ids.`);
        else m.reactions.forEach(r => {
          if (!KNOWN_REACTIONS.includes(r)) errs.push(`Monster "${m.id}": unknown reaction "${r}" (known: ${KNOWN_REACTIONS.join(", ")}).`);
        });
      }
      if (m.reach !== undefined && (!Number.isInteger(m.reach) || m.reach < 1)) {
        errs.push(`Monster "${m.id}": "reach" is in cells and must be a whole number of 1 or more.`);
      }
      // added Phase 5: `size` was in the schema and in every shipped monster
      // and read by nothing. Athletics maneuvers read it now, so a misspelled
      // one silently reads as Medium and a Huge creature becomes wrestleable.
      if (m.size !== undefined && !SIZES.includes(m.size)) {
        errs.push(`Monster "${m.id}": unknown size "${m.size}" (known: ${SIZES.join(", ")}).`);
      }
      // added Phase 5: `lore` is the line a critical Recall Knowledge prints.
      if (m.lore !== undefined && typeof m.lore !== "string") {
        errs.push(`Monster "${m.id}": "lore" must be a string — the one line a critical Recall Knowledge prints.`);
      }
    });

    // Everything the pack brings with it, plus everything already loaded.
    // A pack may lean on core ids (that is the whole point of §1's "IDs are
    // global"), so an id counts as real if either side has it.
    const find = (collection, id) => {
      if (!id) return null;
      const mine = (pack[collection] || []).find(o => o.id === id);
      if (mine) return mine;
      const map = registry && registry[collection];
      return (map && map[id]) || null;
    };
    const known = (collection, id) => !!find(collection, id);

    (pack.adventures || []).forEach(a => {
      const scenes = a.scenes || {};

      // added session 8: `start` was a required *field*, never a checked
      // *reference*. A typo there validated and then dead-ended on "Missing
      // scene" the instant the player picked the adventure.
      if (a.start && a.start !== "END" && !scenes[a.start]) {
        errs.push(`Adventure "${a.id}": start scene "${a.start}" does not exist.`);
      }
      // added session 8: companionsOffered pointing at nothing renders a card
      // for `undefined` and throws on click.
      (a.companionsOffered || []).forEach(cid => {
        if (!known("companions", cid)) errs.push(`Adventure "${a.id}": companionsOffered lists unknown companion "${cid}".`);
      });

      Object.entries(scenes).forEach(([sid, sc]) => {
        // added session 8: the engine does `sc.text.map(...)` with no guard.
        if (!Array.isArray(sc.text)) errs.push(`Adventure "${a.id}": scene "${sid}" needs "text" as an array of paragraphs.`);
        if (!sc.title) errs.push(`Adventure "${a.id}": scene "${sid}" is missing a "title".`);

        (sc.choices || []).forEach((c, i) => {
          const dest = c.goto || (c.check && (c.check.success || c.check.failure)) || c.combat;
          if (!dest && !c.combat) errs.push(`Adventure "${a.id}" scene "${sid}" choice ${i} has no destination (goto/check/combat).`);
          if (c.goto && c.goto !== "END" && !scenes[c.goto]) errs.push(`Adventure "${a.id}": scene "${sid}" points to missing scene "${c.goto}".`);
          if (c.check) ["success", "failure"].forEach(k => { if (c.check[k] && !scenes[c.check[k]]) errs.push(`Adventure "${a.id}": check in "${sid}" points to missing scene "${c.check[k]}".`); });
          if (c.combat && a.encounters && !a.encounters[c.combat] && !((pack.adventures || []).some(x => x.encounters && x.encounters[c.combat]))) errs.push(`Adventure "${a.id}": scene "${sid}" references missing encounter "${c.combat}".`);
          // added session 8: victory/defeat are gotos too, and were unchecked.
          ["victory", "defeat"].forEach(k => {
            if (c[k] && c[k] !== "END" && !scenes[c[k]]) errs.push(`Adventure "${a.id}": scene "${sid}" ${k} points to missing scene "${c[k]}".`);
          });
        });
      });

      // added session 8: guide §14 tells an author to check "every referenced
      // monster id exists" against "the validator's rules". It wasn't one of
      // them. A typo in a foe spawned a battle that threw on the first frame.
      Object.entries(a.encounters || {}).forEach(([eid, enc]) => {
        (enc.foes || []).forEach((f, i) => {
          if (!known("monsters", f.monster)) errs.push(`Adventure "${a.id}": encounter "${eid}" foe ${i} references unknown monster "${f.monster}".`);
          // added Phase 6: `minLevel`/`maxLevel` beside `minParty`. All three
          // are read with `&&`, so a string "2" would compare as a number by
          // accident and a typo like `"minParty": true` would spawn nothing.
          ["minParty", "minLevel", "maxLevel"].forEach(k => {
            if (f[k] !== undefined && (!Number.isInteger(f[k]) || f[k] < 1)) {
              errs.push(`Adventure "${a.id}": encounter "${eid}" foe ${i} "${k}" must be a whole number of 1 or more.`);
            }
          });
          if (Number.isInteger(f.minLevel) && Number.isInteger(f.maxLevel) && f.minLevel > f.maxLevel) {
            errs.push(`Adventure "${a.id}": encounter "${eid}" foe ${i} has minLevel ${f.minLevel} above maxLevel ${f.maxLevel}, so it can never spawn.`);
          }
        });
      });

      // added Phase 6: `awards` is what an adventure credits toward the next
      // level — a whole number of XP per encounter id, paid on victory, and
      // one under "ending", paid on the first ending scene. Absent, the
      // ending is a milestone worth a level (rules.js `awardFor`). A key
      // naming no encounter is XP nothing can ever earn, so it is an error.
      if (a.awards !== undefined) {
        if (!a.awards || typeof a.awards !== "object" || Array.isArray(a.awards)) {
          errs.push(`Adventure "${a.id}": "awards" must be an object of {encounterId or "ending": xp}.`);
        } else {
          Object.entries(a.awards).forEach(([k, v]) => {
            if (k !== "ending" && !(a.encounters && a.encounters[k])) errs.push(`Adventure "${a.id}": awards names "${k}", which is neither an encounter of this adventure nor "ending".`);
            if (!Number.isInteger(v) || v < 0) errs.push(`Adventure "${a.id}": awards "${k}" must be a whole number of XP, 0 or more.`);
          });
        }
      }
    });

    // added Phase 7: `campaigns` — an ordered list of adventures with gates on
    // the flags earlier ones set. Every check here exists because the failure
    // it prevents is silent rather than loud: a campaign whose gate names a
    // flag nothing sets is not an error at load, it is a road the player can
    // see and can never walk, and the only symptom is a locked card that never
    // unlocks.
    (pack.campaigns || []).forEach(c => {
      if (c.level !== undefined && (!Number.isInteger(c.level) || c.level < 1)) {
        errs.push(`Campaign "${c.id}": "level" is the level heroes start it at and must be a whole number of 1 or more.`);
      }
      if (c.adventures !== undefined && !Array.isArray(c.adventures)) {
        errs.push(`Campaign "${c.id}": "adventures" must be an array of {"adventure": id} entries, in order.`);
        return;
      }
      // Array-or-nothing rather than `c.adventures || []`: the validator's job
      // is to report a malformed pack, never to throw on one, and `{}.forEach`
      // is not a function.
      const list = Array.isArray(c.adventures) ? c.adventures : [];
      if (Array.isArray(c.adventures) && list.length === 0) {
        errs.push(`Campaign "${c.id}": "adventures" is empty, so the campaign has nothing to play.`);
      }
      const seen = [];
      list.forEach((e, i) => {
        if (!e || typeof e !== "object" || Array.isArray(e) || typeof e.adventure !== "string") {
          errs.push(`Campaign "${c.id}": adventures[${i}] must be an object naming one adventure, as {"adventure": "some-id"}.`);
          return;
        }
        const adv = find("adventures", e.adventure);
        if (!adv) {
          errs.push(`Campaign "${c.id}": adventures[${i}] names unknown adventure "${e.adventure}".`);
        }
        if (seen.includes(e.adventure)) {
          errs.push(`Campaign "${c.id}": adventure "${e.adventure}" is listed twice, so "finished" could not mean one of them.`);
        }
        if (e.locked !== undefined && typeof e.locked !== "string") {
          errs.push(`Campaign "${c.id}": adventures[${i}] "locked" must be a string — the one line the board prints over a closed road.`);
        }
        if (e.if !== undefined) {
          if (typeof e.if !== "string" || !e.if) {
            errs.push(`Campaign "${c.id}": adventures[${i}] "if" must be a flag expression, e.g. "some-adventure/some-flag".`);
          } else {
            const name = e.if.startsWith("!") ? e.if.slice(1) : e.if;
            if (!isScoped(name)) {
              errs.push(`Campaign "${c.id}": adventures[${i}] gate "${e.if}" is unscoped. A campaign gate reads the record, so it names the adventure too: "earlier-adventure${SCOPE}some-flag".`);
            } else {
              const at = name.indexOf(SCOPE);
              const fromId = name.slice(0, at), flag = name.slice(at + SCOPE.length);
              if (!seen.includes(fromId)) {
                errs.push(`Campaign "${c.id}": adventures[${i}] gate "${e.if}" reads adventure "${fromId}", which this campaign does not list before it, so the gate can never open.`);
              } else {
                const from = find("adventures", fromId);
                const can = from ? flagsSetBy(from) : [];
                if (!can.includes(flag)) {
                  errs.push(`Campaign "${c.id}": adventures[${i}] gate "${e.if}" reads a flag "${fromId}" never sets (it sets: ${can.join(", ") || "nothing"}).`);
                }
              }
            }
          }
        }
        if (typeof e.adventure === "string") seen.push(e.adventure);
      });
    });

    // added session 8: a background's `feat` is documented in §3 as "must be
    // the id of a skill feat that exists after your pack loads".
    (pack.backgrounds || []).forEach(b => {
      if (b.feat && !known("feats", b.feat)) errs.push(`Background "${b.id}": feat "${b.feat}" does not exist.`);
    });

    return errs;
  }
};
