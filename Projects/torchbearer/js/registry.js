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
import { parseCoins, priceOf, treasureBudget, treasureIn, coinText } from "./shop.js";
import { OPENER_FLAGS, EXPLORATION_IDS } from "./downtime.js";

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

/**
 * Every value a scene's `"kind"` may take. A scene without one is prose and
 * choices, which is what every scene was before Phase 7's second increment.
 *
 * It is a closed list because the failure is silent: `"kind": "stop"` renders
 * a perfectly ordinary scene, the shop never appears, and the only symptom is
 * a player standing in a market with no way to buy anything.
 */
export const SCENE_KINDS = ["shop", "explore"];

/* ---------- the scene graph ----------
   Phase 7's second increment shipped a shop the player could reach only
   because a session opened a browser and walked into it. Nothing under Node
   knew what a scene pointed at, so an adventure could carry a scene nothing
   ever reached — a shop, an ending, a whole branch — and every check in the
   suite would pass.

   These two functions are that walk. `sceneEdges` is the one list of every way
   out of a scene, and it is the list the *engine* actually follows, which is
   why the implicit one is in it: `App.choose` runs `this.gotoScene(c.defeat||
   "gameover")`, so every combat choice without an explicit `defeat` is an edge
   to a scene named "gameover" whether the author wrote one or not. */

/** Every scene id one scene can lead to, including "END". Duplicates kept out. */
export function sceneEdges(sc) {
  const out = [];
  const add = id => { if (typeof id === "string" && id && !out.includes(id)) out.push(id); };
  ((sc && sc.choices) || []).forEach(c => {
    if (!c || typeof c !== "object") return;
    add(c.goto);
    if (c.check && typeof c.check === "object") { add(c.check.success); add(c.check.failure); }
    add(c.victory);
    // The default the page supplies when a battle is lost and the author said
    // nothing. A scene reachable only this way is still reachable.
    if (c.combat) add(c.defeat || "gameover");
  });
  if (sc && sc.explore && typeof sc.explore === "object") add(sc.explore.goto);
  return out;
}

/**
 * Walk one adventure from its start scene and report what the walk found:
 * every scene it reached, every scene it did not, every edge naming a scene
 * that does not exist, and every ending — reachable or not.
 *
 * The whole graph, not one path: a branch is walked down both sides, so this
 * is what the player *could* see rather than what any one playthrough does.
 */
export function sceneGraph(adv) {
  const scenes = (adv && adv.scenes) || {};
  const start = adv && adv.start;
  const reached = [];
  const dangling = [];
  const queue = scenes[start] ? [start] : [];
  if (queue.length) reached.push(start);
  while (queue.length) {
    const id = queue.shift();
    sceneEdges(scenes[id]).forEach(to => {
      if (to === "END") return;
      if (!scenes[to]) { if (!dangling.some(d => d.from === id && d.to === to)) dangling.push({ from: id, to }); return; }
      if (!reached.includes(to)) { reached.push(to); queue.push(to); }
    });
  }
  const all = Object.keys(scenes);
  return {
    start: scenes[start] ? start : null,
    reached,
    unreachable: all.filter(id => !reached.includes(id)),
    dangling,
    endings: all.filter(id => scenes[id] && scenes[id].ending),
    endingsReached: all.filter(id => scenes[id] && scenes[id].ending && reached.includes(id))
  };
}

/**
 * Is `wrote` a typo of `want`? One insertion, one deletion or one substitution,
 * case and punctuation ignored — which is the whole shape of the mistake this
 * exists to catch: `suprise-round`, `surprise_round`, `Surprise-Round`.
 *
 * Deliberately narrow. Two characters out is a different word, and a validator
 * that guesses at those starts rejecting flags an author meant to write.
 */
function nearMiss(want, wrote) {
  const a = String(want).toLowerCase().replace(/[^a-z]/g, "");
  const b = String(wrote).toLowerCase().replace(/[^a-z]/g, "");
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

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

    // added Phase 7 increment 2: `level` and `price`. Both are silent when
    // wrong. A price the parser cannot read makes an item that cannot be
    // bought or sold and says nothing about why; the shop just renders a card
    // with no number on it.
    (pack.items || []).forEach(it => {
      if (it.level !== undefined && (!Number.isInteger(it.level) || it.level < 0)) {
        errs.push(`Item "${it.id}": "level" is the item's level and must be a whole number of 0 or more.`);
      }
      if (it.price !== undefined && parseCoins(it.price) === null) {
        errs.push(`Item "${it.id}": price ${JSON.stringify(it.price)} is not a price the engine can read. Write it the way the Player Core prints it: "12 gp", "2 sp", "5 cp", or "1 gp, 5 sp".`);
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

        // added Phase 7 increment 2: the scene kinds, the treasure a scene
        // hands out, and the shop's stock. Every one of these is a failure the
        // player meets and the author never sees.
        if (sc.kind !== undefined && !SCENE_KINDS.includes(sc.kind)) {
          errs.push(`Adventure "${a.id}": scene "${sid}" has unknown kind "${sc.kind}" (known: ${SCENE_KINDS.join(", ")}; leave it out for an ordinary scene).`);
        }
        if (sc.onEnter) {
          if (sc.onEnter.gold !== undefined && parseCoins(sc.onEnter.gold) === null) {
            errs.push(`Adventure "${a.id}": scene "${sid}" onEnter.gold ${JSON.stringify(sc.onEnter.gold)} is not a price the engine can read. Write it like "45 gp".`);
          }
          if (sc.onEnter.items !== undefined && !Array.isArray(sc.onEnter.items)) {
            errs.push(`Adventure "${a.id}": scene "${sid}" onEnter.items must be an array of item ids.`);
          }
          // added Phase 7 increment 2, and it was reachable before it: a typo
          // here printed "Gained: healing-potion-lesserr" into the Chronicle
          // and handed over nothing.
          (Array.isArray(sc.onEnter.items) ? sc.onEnter.items : []).forEach(id => {
            if (!known("items", id)) errs.push(`Adventure "${a.id}": scene "${sid}" onEnter.items grants unknown item "${id}".`);
          });
          /* added Phase 7 increment 3. An `onEnter.flag` may be anything the
             author likes — that is the whole point of the flag map — except a
             near-miss of an opener. `Combat.start` consumes the five names in
             OPENERS exactly; `"surprise_round"` sets a flag nothing ever reads,
             the ambush is an ordinary fight, and nothing anywhere says so. */
          if (typeof sc.onEnter.flag === "string" && !OPENER_FLAGS.includes(sc.onEnter.flag)) {
            const near = OPENER_FLAGS.find(f => nearMiss(f, sc.onEnter.flag));
            if (near) errs.push(`Adventure "${a.id}": scene "${sid}" sets flag "${sc.onEnter.flag}", which is one character from the encounter opener "${near}" and does nothing. Spell it "${near}" or rename it so it reads as an ordinary flag.`);
          }
        }
        if (sc.kind === "shop") {
          if (!Array.isArray(sc.stock) || !sc.stock.length) {
            errs.push(`Adventure "${a.id}": shop scene "${sid}" needs a "stock" array of item ids — a shop with nothing in it is a scene the player cannot leave anything in.`);
          } else {
            sc.stock.forEach(id => {
              const it = find("items", id);
              if (!it) { errs.push(`Adventure "${a.id}": shop scene "${sid}" stocks unknown item "${id}".`); return; }
              // A stocked item with no price renders a card that can never be
              // bought, which reads as a broken button rather than as an
              // authoring mistake.
              if (priceOf(it) === null) errs.push(`Adventure "${a.id}": shop scene "${sid}" stocks "${id}", which has no "price", so nothing can buy it.`);
            });
          }
        } else if (sc.stock !== undefined) {
          errs.push(`Adventure "${a.id}": scene "${sid}" declares "stock" but is not a shop. Add "kind": "shop" or drop the stock.`);
        }

        /* added Phase 7 increment 3: the exploration scene, and the opener
           vocabulary it writes into.

           An opener is a flag with a reserved name, so the two failures are
           both silent. A scene that offers exploration with nowhere to go
           renders three cards and then strands the player; a flag spelled
           `suprise-round` sits in the map forever, is never consumed by
           `Combat.start`, and the ambush the author wrote is an ordinary fight
           with no error anywhere. */
        if (sc.kind === "explore") {
          const ex = sc.explore;
          if (!ex || typeof ex !== "object" || Array.isArray(ex)) {
            errs.push(`Adventure "${a.id}": explore scene "${sid}" needs an "explore" object, as {"dc": 18, "goto": "next-scene"}.`);
          } else {
            if (!Number.isInteger(ex.dc) || ex.dc < 1) {
              errs.push(`Adventure "${a.id}": explore scene "${sid}" needs "explore.dc" as a whole number of 1 or more — the DC every activity here is rolled against.`);
            }
            if (typeof ex.goto !== "string" || !ex.goto) {
              errs.push(`Adventure "${a.id}": explore scene "${sid}" needs "explore.goto" — where the hero goes once they have chosen an activity.`);
            } else if (ex.goto !== "END" && !scenes[ex.goto]) {
              errs.push(`Adventure "${a.id}": explore scene "${sid}" goes to missing scene "${ex.goto}".`);
            }
            if (ex.activities !== undefined) {
              if (!Array.isArray(ex.activities) || !ex.activities.length) {
                errs.push(`Adventure "${a.id}": explore scene "${sid}" "explore.activities" must be a non-empty array of activity ids (known: ${EXPLORATION_IDS.join(", ")}). Leave it out to offer all three.`);
              } else {
                ex.activities.forEach(id => {
                  if (!EXPLORATION_IDS.includes(id)) {
                    errs.push(`Adventure "${a.id}": explore scene "${sid}" offers unknown activity "${id}" (known: ${EXPLORATION_IDS.join(", ")}).`);
                  }
                });
              }
            }
          }
        } else if (sc.explore !== undefined) {
          errs.push(`Adventure "${a.id}": scene "${sid}" declares "explore" but is not an explore scene. Add "kind": "explore" or drop it.`);
        }

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

      // added Phase 7 increment 2: the treasure budget.
      //
      // PF2e's Treasure by Level is the curve the whole item economy assumes,
      // and an adventure that hands out five times its level's share breaks it
      // invisibly: nothing errors, nothing looks wrong, and two adventures
      // later the hero is buying gear four levels above them. The sum is taken
      // across every scene rather than along one path, so it is the ceiling no
      // playthrough can pass, and an adventure inside it is safe however it
      // branches. An adventure that declares no `level` is not checked — there
      // is no row to check it against.
      if (a.level !== undefined && (!Number.isInteger(a.level) || a.level < 1)) {
        errs.push(`Adventure "${a.id}": "level" must be a whole number of 1 or more.`);
      } else if (Number.isInteger(a.level)) {
        const budget = treasureBudget(a.level);
        const total = treasureIn(a, id => find("items", id));
        if (total > budget) {
          errs.push(`Adventure "${a.id}": hands out ${coinText(total)} across its scenes, above the ${coinText(budget)} one hero's share of a level-${a.level} adventure is worth. Cut the treasure or raise the adventure's level.`);
        }
      }

      /* added Phase 7 increment 3: the walk.
         Every edge above is checked one at a time — a `goto` points at a real
         scene, a check's two branches exist, victory and defeat exist. None of
         that says anything about whether the player can ever stand there. An
         orphaned scene is the most expensive kind of authoring mistake because
         it looks finished: the prose is written, the choices are wired, the
         shop is stocked, and the only symptom is that nobody ever sees it.
         Reported one scene at a time, sorted, because "3 scenes are
         unreachable" sends an author looking and a name does not. */
      if (a.start && scenes[a.start]) {
        sceneGraph(a).unreachable.sort().forEach(sid => {
          errs.push(`Adventure "${a.id}": scene "${sid}" cannot be reached from "${a.start}". Nothing points at it, so no player will ever see it.`);
        });
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
