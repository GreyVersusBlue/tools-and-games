// game.js — the run. State, turns, triggers, and every rules call the player
// can make. Headless: no DOM, no canvas, no timers.
//
// Two things follow from headless, and both of them are the point:
//
//   1. test/balance.mjs can play ten thousand encounters under Node in a few
//      seconds, with a seeded RNG, and answer "is this fight winnable" with a
//      number instead of an adjective. It is: the shipped build was not, and
//      nothing short of measuring it would have said so.
//   2. Animation is the renderer's problem. An action that moves a creature
//      resolves instantly here and hands back the squares it crossed; ui.js
//      plays that back at whatever speed it likes. Nothing in the rules waits
//      on a setTimeout, so nothing in the rules can be raced by one.

import {
  DEG, DEG_NAME, check, die, rollDamage, basicSaveDamage, mapPenalty,
  feetBetween, isAdjacent, stridesFor,
} from "./rules.js";
import { makeWorld, TILE, packExplored, unpackExplored } from "./world.js";
import {
  CONDITIONS, modifiers, addCondition, removeCondition, hasCondition, valueOf,
  makeCondition, persistentIn, tick, describe, packBag,
} from "./conditions.js";

export const LOG_MEMORY = 200;   // entries kept in RAM
export const LOG_SAVED = 60;     // entries written to a save

/**
 * Stable identity for a placed creature: the area, the id, and where it was
 * placed. The area has to be in the key now that more than one of them
 * exists — two areas can otherwise place the same creature id at the same
 * coordinates and collide.
 */
const placementKey = (areaId, pl) => `${areaId}:${pl.creature}@${pl.x},${pl.y}`;

/** Every creature in every area, flattened, each tagged with its area id. */
function allPlacements(content) {
  const out = [];
  for (const areaId of content.areaOrder) {
    for (const pl of content.areas[areaId].placements) out.push({ areaId, ...pl });
  }
  return out;
}

export function createGame({ content, rng = Math.random, state = null }) {
  const { tuning } = content;

  const listeners = new Set();
  const emit = ev => { for (const fn of listeners) fn(ev); };

  /* ------------------------------------------------------------------ *
   * Persistent state — everything a reload has to survive.             *
   * Runtime-only fields (turn order, actions left, the armed command)  *
   * live in `turn` below and are deliberately not saved.               *
   * ------------------------------------------------------------------ */
  const run = state || freshState();

  // The area the PC is currently in, and its world. Both are reassigned by
  // transitionTo() on a stairway; every function below reads them through
  // these closures rather than a value captured once at boot, which is what
  // lets a transition change the board under the renderer without it having
  // to know anything happened.
  let area = content.areas[run.areaId] || content.areas[content.startArea];
  let world = makeWorld(area);

  // A state handed straight in — a save this build wrote, or the hand-built
  // ones test/smoke.mjs constructs — is not guaranteed to carry a condition
  // bag: `conditions` is additive and absent from every save written before
  // this phase. save.js's repair fills it for a loaded save; this fills it for
  // the ones that never went through repair, so nothing below has to ask
  // whether the array exists before reading it.
  run.pc.conditions ??= [];
  for (const c of run.creatures) c.conditions ??= [];

  function freshState() {
    const startArea = content.areas[content.startArea];
    return {
      packId: content.pack.id,
      // content.pc is already the one build a caller resolved via selectPc()
      // before constructing this game — see content.js. Stamping its id here
      // keeps this internal fallback (used when no explicit state is passed,
      // mostly by tests) shaped the same as save.js's freshRun().
      buildId: content.pc.id,
      areaId: content.startArea,
      pc: {
        x: startArea.pcSpawn.x, y: startArea.pcSpawn.y,
        hp: content.pc.hp, slots: content.pc.slots, focus: content.pc.focus,
        conditions: [],
      },
      // Every area's creatures exist in the state from the start, not just the
      // one the PC is standing in — a construct in a room you have not opened
      // the door to yet still has to be there, dormant, when you arrive.
      creatures: allPlacements(content).map(pl => ({
        key: placementKey(pl.areaId, pl), area: pl.areaId, creature: pl.creature, wakesOn: pl.wakesOn,
        x: pl.x, y: pl.y, hp: content.creatures[pl.creature].hp,
        awake: false, dead: false, conditions: [],
      })),
      loreRead: [],
      gateOpen: false,
      fog: {},
      inventory: content.startingInventory.map((item, slot) => ({ item, slot })),
      log: [],
      stats: { rounds: 0, dealt: 0, taken: 0, woken: 0, slain: 0, reactions: 0 },
      outcome: null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Runtime turn state.                                                *
   * ------------------------------------------------------------------ */
  const turn = {
    mode: "explore",         // "explore" | "combat" | "over"
    queue: [],               // creature keys plus "pc", in initiative order
    idx: 0,
    actions: 3,
    attacks: 0,              // this turn's Multiple Attack Penalty counter
    // Whose turn is actually in progress, which is not the same question as
    // `queue[idx]`: the end-of-turn boundary has to know who is finishing, and
    // by the time advance() has moved idx the answer is gone. Null between
    // encounters and at the very first advance() of one.
    acting: null,
    // The reaction budget: one per actor per round, and runtime-only. A save
    // never carries it, because a reaction is spent inside a turn and a reload
    // re-rolls initiative anyway (see begin()). `reaction` is the PC's;
    // `reacted` holds the keys of creatures that have spent theirs, and an
    // actor's is refreshed in advance() at the top of its own turn.
    reaction: 1,
    reacted: new Set(),
  };

  let explored = unpackExplored(run.fog[run.areaId], area.width, area.height);
  let visible = new Set();

  /* ------------------------------------------------------------------ *
   * Log                                                                *
   * ------------------------------------------------------------------ */
  function push(kind, text, math, deg) {
    const entry = { kind, text };
    if (math) entry.math = math;
    if (deg !== undefined) entry.deg = deg;
    run.log.push(entry);
    if (run.log.length > LOG_MEMORY) run.log.splice(0, run.log.length - LOG_MEMORY);
    emit({ type: "log", entry });
    return entry;
  }
  const narrative = t => push("narrative", t);
  const info = t => push("info", t);
  const dice = (t, math, deg) => push("dice", t, math, deg);

  /* ------------------------------------------------------------------ *
   * Actors                                                             *
   * ------------------------------------------------------------------ */
  const def = c => content.creatures[c.creature];
  // Scoped to the area the PC is standing in. A creature's state persists
  // while you are elsewhere, but it cannot occupy a square, wake, or fight
  // in a room its body is not in.
  const living = () => run.creatures.filter(c => c.area === run.areaId && !c.dead);
  const awake = () => run.creatures.filter(c => c.area === run.areaId && c.awake && !c.dead);
  const byKey = k => (k === "pc" ? null : run.creatures.find(c => c.key === k));

  function occupied(x, y, ignoreKey) {
    if (run.pc.x === x && run.pc.y === y && ignoreKey !== "pc") return true;
    return living().some(c => c.x === x && c.y === y && c.key !== ignoreKey);
  }
  const creatureAt = (x, y) => living().find(c => c.x === x && c.y === y) || null;

  const pathOpts = ignoreKey => ({
    gateOpen: run.gateOpen,
    occupied: (x, y) => occupied(x, y, ignoreKey),
  });

  /* ------------------------------------------------------------------ *
   * Conditions                                                         *
   *                                                                    *
   * `turn.shielded` used to be a boolean on the runtime turn object and *
   * it was the whole of this engine's status-effect system: one buff,  *
   * hardcoded at four call sites, with nowhere for a second one to go.  *
   * A condition bag replaces it, and the Shield cantrip is now an       *
   * ordinary entry in that bag with the pack's own acBonus as its       *
   * value. The boolean is gone from `turn` entirely, which is the proof *
   * the funnel below is real rather than a second path beside it.       *
   *                                                                    *
   * The bags live on the saved run — `run.pc.conditions` and a          *
   * `conditions` array on each creature — because a condition is        *
   * exactly the thing a reload has to survive, and that is the opposite *
   * case from `turn.reaction`, which a reload re-rolls initiative past  *
   * anyway. Additive: absent from a save with none (#37).               *
   * ------------------------------------------------------------------ */

  const bagOf = a => (a === "pc" ? run.pc : a).conditions;
  const setBag = (a, bag) => { (a === "pc" ? run.pc : a).conditions = bag; };
  const nameOf = a => (a === "pc" ? content.pc.name : def(a).name);
  const actorKeyOf = a => (a === "pc" ? "pc" : a.key);

  /**
   * The funnel. Every modifier this engine applies to a number comes from
   * here, for the four kinds conditions.js names, and there is no second way
   * in: a bonus that is not in an actor's bag does not exist.
   */
  function modifiersFor(actor, kind) {
    return modifiers(bagOf(actor), kind);
  }

  /**
   * The only d20 in this file.
   *
   * Every check the engine rolls — an attack, a save, a Perception check for
   * initiative, a reaction's Strike — goes through this one function so the
   * modifier lookup cannot be forgotten at a call site. smoke.mjs reads this
   * file's own source and fails if a second `check(` appears anywhere in it,
   * the same drift guard the three trigger names already have, and for the
   * same reason: the bug is silence, not a crash.
   *
   * The one d20 that deliberately does not come through here is the flat
   * check that ends persistent damage. A flat check takes no modifiers at all
   * (Player Core p.409), so it rolls a bare die rather than pretending the
   * funnel applies and passing zero.
   */
  function roll(actor, kind, bonus, dc) {
    return check(bonus + modifiersFor(actor, kind), dc, rng);
  }

  /** Effective AC for either side, conditions included. */
  const acOf = actor =>
    (actor === "pc" ? content.pc.ac : def(actor).ac) + modifiersFor(actor, "ac");
  const pcAC = () => acOf("pc");

  /** Note that a condition has come off, without touching the bag. */
  function noteEnd(actor, id, why) {
    info(`${nameOf(actor)} is no longer ${CONDITIONS[id].name.toLowerCase()}${why ? ` — ${why}` : ""}.`);
    emit({ type: "condition", actor: actorKeyOf(actor), condition: id, value: 0 });
  }

  /**
   * Put a condition on somebody. Returns whether anything changed — a second
   * frightened 1 on an already-frightened 1 actor is not news.
   */
  function applyCondition(actor, id, value, until = null) {
    const had = valueOf(bagOf(actor), id);
    setBag(actor, addCondition(bagOf(actor), makeCondition(id, { value, until })));
    const now = valueOf(bagOf(actor), id);
    if (now === had) return false;
    info(`${nameOf(actor)} is ${describe({ id, value: now }).toLowerCase()}.`);
    emit({ type: "condition", actor: actorKeyOf(actor), condition: id, value: now });
    return true;
  }

  function endCondition(actor, id, why) {
    if (!hasCondition(bagOf(actor), id)) return false;
    setBag(actor, removeCondition(bagOf(actor), id));
    noteEnd(actor, id, why);
    return true;
  }

  /** Everything on one actor, for the sheet, the renderer and the suite. */
  const conditionsOf = actor => bagOf(actor).map(c => ({ ...c }));

  /**
   * A command or a creature's attack that leaves something behind.
   *
   * `deg` is the degree the *roller* got, which is the attacker for "hit" and
   * "crit" and the target for "crit-fail" — an attack that lands and a save
   * that is critically failed are the two shapes a pack can ask for, and each
   * reads from the roll that already happened rather than a second one.
   */
  function applyInflict(spec, target, deg) {
    if (!spec) return false;
    if (target !== "pc" && (target.dead || !target.awake)) return false;
    if (run.outcome) return false;
    const fires = spec.on === "crit" ? deg === DEG.CRIT_SUCC
      : spec.on === "hit" ? deg >= DEG.SUCC
        : deg === DEG.CRIT_FAIL;
    if (!fires) return false;
    return applyCondition(target, spec.condition, spec.value);
  }

  /* ------------------------------------------------------------------ *
   * Vision                                                             *
   * ------------------------------------------------------------------ */
  function recomputeVision() {
    visible = world.fieldOfView(run.pc.x, run.pc.y, tuning.visionFeet, run.gateOpen);
    for (const k of visible) explored.add(k);
    run.fog[run.areaId] = packExplored(explored, area.width, area.height);
  }

  /* ------------------------------------------------------------------ *
   * Damage and healing                                                 *
   * ------------------------------------------------------------------ */
  function hurtCreature(c, amount, math, type, from) {
    // The last point at which a number can still be changed, and the only one
    // at which it is known — so this is where "damage is about to land" fires,
    // rather than at each of the four call sites that can produce damage.
    amount = softenedBy({ actor: from, target: c, dmg: amount, dtype: type });
    c.hp = Math.max(0, c.hp - amount);
    run.stats.dealt += amount;
    push("damage", `→ ${def(c).name} takes ${amount} ${type}`,
      `${math}  |  HP ${c.hp}/${def(c).hp}`);
    if (c.hp === 0) {
      c.dead = true; c.awake = false;
      run.stats.slain++;
      narrative(def(c).deathLine.replace("{name}", def(c).name));
      emit({ type: "died", key: c.key });
      checkTreasure();
      // Kill the last thing that was awake and the encounter is over now, not
      // when you get round to ending your turn. Waiting left the banner reading
      // "Encounter" over an empty floor, and left ordinary walking still being
      // charged as Strides.
      if (turn.mode === "combat" && !run.outcome && !awake().length) endCombat("cleared");
    }
    return amount;
  }

  function hurtPC(amount, math, type, from) {
    amount = softenedBy({ actor: from, target: "pc", dmg: amount, dtype: type });
    run.pc.hp = Math.max(0, run.pc.hp - amount);
    run.stats.taken += amount;
    push("damage", `→ ${content.pc.name} takes ${amount} ${type}`,
      `${math}  |  HP ${run.pc.hp}/${content.pc.hp}`);
    if (run.pc.hp === 0) finish("defeat");
    return amount;
  }

  function healPC(amount, math) {
    const before = run.pc.hp;
    run.pc.hp = Math.min(content.pc.hp, run.pc.hp + amount);
    push("damage", `→ ${content.pc.name} regains ${run.pc.hp - before} HP`,
      `${math}  |  HP ${run.pc.hp}/${content.pc.hp}`);
  }

  function finish(outcome) {
    if (run.outcome) return;
    run.outcome = outcome;
    turn.mode = "over";
    const block = outcome === "victory" ? content.treasure : content.defeat;
    emit({ type: "end", outcome, title: block.title, body: block.body });
  }

  /* ------------------------------------------------------------------ *
   * The reaction bus                                                   *
   *                                                                    *
   * Everything above this line resolves in a straight line: an action  *
   * starts, finishes, and nothing speaks in between. This is the seam. *
   *                                                                    *
   * There are exactly three named points at which the engine asks "does *
   * anyone want to interrupt this", and each is a string literal at a   *
   * fireTrigger() call below. content.js's REACTION_TRIGGERS is the     *
   * same three; smoke.mjs reads the literals back out of this file's    *
   * own source and fails on the line where the two lists disagree, so   *
   * a pack naming a fourth event cannot validate and then never fire.   *
   *                                                                    *
   * The three rules are Torchbearer's — its js/combat.js shipped this   *
   * seam first — so the two engines can be read against each other:     *
   *                                                                    *
   *   1. One reaction per actor per round. `turn.reaction` for the PC,  *
   *      `turn.reacted` for creatures; both refreshed at the top of     *
   *      that actor's own turn in advance(), and nowhere else.          *
   *   2. A reaction resolves *before* the action that triggered it      *
   *      completes. The caller hands over what it is about to do in     *
   *      `ctx` and reads `ctx` back afterwards.                         *
   *   3. Nobody reacts to their own side, which is also what stops      *
   *      anyone reacting to themselves. The offer walks initiative.     *
   *                                                                    *
   * A reaction can kill the actor mid-action. Every fire site checks    *
   * for that afterwards, which is what makes a Stride interruptible     *
   * between two squares rather than merely observable.                  *
   * ------------------------------------------------------------------ */

  const sideOf = a => (a === "pc" ? "pc" : a ? "foe" : null);
  const posOf = a => (a === "pc" ? run.pc : a);
  const keyOf = a => (a === "pc" ? "pc" : a.key);
  const reachOf = a => (a === "pc" ? content.pc.reachFeet : def(a).reachFeet);

  /** Everyone who could react, in initiative order, the PC included. */
  function reactors() {
    const line = turn.queue.length ? turn.queue : ["pc", ...awake().map(c => c.key)];
    const out = [];
    for (const key of line) {
      if (key === "pc") { if (!run.outcome) out.push("pc"); continue; }
      const c = byKey(key);
      if (c && c.awake && !c.dead) out.push(c);
    }
    return out;
  }

  /** The reaction commands `who` owns that answer to `event`. */
  function reactionsFor(who, event) {
    const ids = who === "pc"
      ? content.pc.commands            // already narrowed to this build
      : def(who).reactions;
    const table = who === "pc" ? content.commandById : content.allCommandById;
    const out = [];
    for (const id of ids) {
      const cmd = table[id];
      if (cmd && cmd.kind === "reaction" && cmd.triggers.includes(event)) out.push(cmd);
    }
    return out;
  }

  const reactionSpent = who => (who === "pc" ? turn.reaction < 1 : turn.reacted.has(who.key));

  function spendReaction(who) {
    if (who === "pc") turn.reaction = 0;
    else turn.reacted.add(who.key);
    run.stats.reactions++;
  }

  /**
   * Why `cmd` cannot fire for `who` right now, or null if it can.
   *
   * A reason string, the way commandBlocked() already refuses an action, and
   * for the same reason: "it did not happen" is not a debuggable answer when
   * the question is why a longsword stayed still.
   */
  function reactionBlocked(who, cmd, ctx) {
    if (reactionSpent(who)) return "spent";
    if (sideOf(who) === sideOf(ctx.actor)) return "ally";
    // The Shield cantrip is this engine's only shield, and blocking with it
    // ends it (Player Core: the force disc is destroyed). Only the PC has one.
    if (cmd.requiresShield && !(who === "pc" && hasCondition(bagOf("pc"), "shielded"))) return "no-shield";

    // Exactly one reach test per trigger, and the move trigger owns its own.
    // Both halves matter and they fail differently: without the first, a
    // creature crossing the room provokes from anywhere; without the second,
    // shuffling from one square beside a foe to another provokes, which is a
    // free hit every time a player repositions in melee.
    const here = posOf(who), R = reachOf(who);
    if (ctx.event === "move-out-of-reach") {
      if (feetBetween(here.x, here.y, ctx.from.x, ctx.from.y) > R) return "not-in-reach";
      if (feetBetween(here.x, here.y, ctx.to.x, ctx.to.y) <= R) return "still-in-reach";
    } else if (cmd.effect === "strike") {
      // Everything else is measured from where the actor actually stands.
      const at = posOf(ctx.actor);
      if (!at) return "no-target";
      if (feetBetween(here.x, here.y, at.x, at.y) > R) return "out-of-reach";
    }

    if (cmd.effect === "reduce") {
      if (who !== ctx.target) return "not-the-target";
      if (!(ctx.dmg > 0)) return "no-damage";
      if (cmd.damageTypes && !cmd.damageTypes.includes(ctx.dtype)) return "damage-type";
    }
    return null;
  }

  /** Fire one reaction that has already been paid for. */
  function resolveReaction(who, cmd, ctx) {
    if (cmd.effect === "reduce") {
      const blocked = Math.min(cmd.hardness, ctx.dmg);
      ctx.dmg -= blocked;
      const name = who === "pc" ? content.pc.name : def(who).name;
      info(`↺ ${name} — ${cmd.name}: ${blocked} damage stopped (hardness ${cmd.hardness}).`);
      // The disc is spent whether it soaked one point or five.
      if (cmd.requiresShield) endCondition(who, "shielded", "the disc shatters");
      return;
    }

    // effect === "strike". The victim is whoever set the trigger off.
    const victim = ctx.actor;
    if (!victim || (victim !== "pc" && (victim.dead || !victim.awake))) return;
    const mine = who === "pc";
    const name = mine ? content.pc.name : def(who).name;
    const label = mine ? cmd.name : `${def(who).name} — ${cmd.name}`;
    // A reaction happens on somebody else's turn, so it is not part of the
    // reactor's own action sequence: no MAP is applied and none is added.
    // turn.attacks belongs to the PC's own turn and is deliberately untouched.
    const bonus = mine ? cmd.attackBonus : def(who).attackBonus;
    const dmgSpec = mine ? cmd.damage : def(who).damage;
    const dtype = mine ? cmd.damageType : def(who).damageType;
    const ac = acOf(victim);
    const vname = victim === "pc" ? content.pc.name : def(victim).name;
    info(ctx.event === "move-out-of-reach"
      ? `↺ ${name} — ${cmd.name}, as ${vname} leaves reach.`
      : `↺ ${name} — ${cmd.name}, against ${vname}.`);
    const r = roll(who, "attack", bonus, ac);
    dice(`${label} vs ${vname} (AC ${ac})`, r.math, r.deg);
    if (r.deg < DEG.SUCC) return;
    const dmg = rollDamage(dmgSpec, rng);
    let total = dmg.total, math = dmg.math;
    if (r.deg === DEG.CRIT_SUCC) { total *= 2; math += ` ×2 (crit) = ${total}`; }
    if (victim === "pc") hurtPC(total, math, dtype, who);
    else hurtCreature(victim, total, math, dtype, who);
  }

  /**
   * Offer `event` to everyone who could answer it.
   *
   * Returns the ctx, mutated: `fired` lists what went off and `refusals` lists
   * what did not, each with the reason. The ctx is also parked under its event
   * name and readable as `game.lastTrigger(event)`, which is how the suite
   * tells "nothing happened" apart from "nothing happened for the right
   * reason" — the two look identical from outside, and only the second is
   * worth shipping. Two shapes here were wrong before this one: a single
   * last-reason string, which depended on whose refusal came last in
   * initiative, and a single last-ctx, which depended on which trigger fired
   * last in the turn. Both read as passing tests that were asserting nothing.
   */
  const lastByEvent = new Map();
  function fireTrigger(event, ctx) {
    ctx = ctx || {};
    ctx.event = event;
    ctx.fired = [];
    ctx.refusals = [];
    lastByEvent.set(event, ctx);
    if (turn.mode !== "combat" || run.outcome) return ctx;
    for (const who of reactors()) {
      // Nobody reacts to themselves, and nobody reacts to their own side —
      // both of which are the one sideOf() test in reactionBlocked(), since an
      // actor is always on its own side. A second self-check here would be a
      // guard nothing can break, which is a guard nothing tests.
      for (const cmd of reactionsFor(who, event)) {
        const why = reactionBlocked(who, cmd, ctx);
        if (why) { ctx.refusals.push({ actor: keyOf(who), command: cmd.id, why }); continue; }
        spendReaction(who);
        ctx.fired.push({ actor: keyOf(who), command: cmd.id });
        emit({ type: "reaction", actor: keyOf(who), command: cmd.id, event });
        resolveReaction(who, cmd, ctx);
        break;                     // one reaction per actor per trigger
      }
      // A reaction that put the actor down ends the offer: there is no longer
      // an action in progress for anyone else to interrupt.
      if (run.outcome) break;
      if (ctx.actor && ctx.actor !== "pc" && ctx.actor.dead) break;
    }
    return ctx;
  }

  /** `incoming-damage`, folded down to the number that actually lands. */
  function softenedBy(ctx) {
    const before = ctx.dmg;
    if (!(before > 0)) return before;
    fireTrigger("incoming-damage", ctx);
    return Math.max(0, ctx.dmg);
  }

  /** `incoming-attack`: fired before a Strike is rolled, from either side. */
  function announceStrike(attacker, target) {
    return fireTrigger("incoming-attack", { actor: attacker, target });
  }

  /**
   * Somebody has just stepped from `from` to `to`. Anyone who threatened the
   * square they left and does not threaten the one they arrived at gets the
   * offer.
   */
  function announceStep(mover, from, to) {
    return fireTrigger("move-out-of-reach", { actor: mover, from, to });
  }

  /* ------------------------------------------------------------------ *
   * Waking, initiative, disengaging                                    *
   * ------------------------------------------------------------------ */

  /** Does this dormant creature notice the PC from where it stands? */
  function notices(c) {
    if (c.wakesOn !== "notice") return false;
    return feetBetween(c.x, c.y, run.pc.x, run.pc.y) <= tuning.noticeFeet
      && world.hasLoS(c.x, c.y, run.pc.x, run.pc.y, run.gateOpen);
  }

  /**
   * Wake one creature.
   *
   * The shipped build woke every sentinel the moment any one of them saw you,
   * which put a solo level-1 wizard against two creatures at once — 30 XP
   * against a 20 XP moderate budget for a one-PC party, and measurably a rout.
   * Creatures notice the PC one at a time now, and a fight already in progress
   * takes the newcomer into the existing initiative order rather than starting
   * over.
   */
  function wake(c) {
    if (c.awake || c.dead) return;
    c.awake = true;
    run.stats.woken++;
    narrative(def(c).wakeLine.replace("{name}", def(c).name));
    emit({ type: "woke", key: c.key });
    if (turn.mode === "combat") {
      const r = roll(c, "perception", def(c).perception, 0);
      dice(`Initiative — ${def(c).name}`, initiativeMath(r), DEG.SUCC);
      // Slot it in after whoever is acting, so a creature that wakes mid-round
      // does not get a free turn ahead of the PC who just walked past it.
      turn.queue.splice(turn.idx + 1, 0, c.key);
    } else {
      startCombat();
    }
  }

  /**
   * Initiative reads as a Perception check rather than a check against a DC,
   * so it gets its own line rather than `r.math`'s "vs DC 0". `r.bonus` and
   * not the creature's raw Perception: a frightened sentinel rolls initiative
   * at its penalty, and a readout that showed the sheet number would be the
   * one place in the log where the funnel is invisible.
   */
  const initiativeMath = r =>
    `Perception: d20(${r.natural}) ${r.bonus >= 0 ? "+" : "-"}${Math.abs(r.bonus)} = ${r.total}`;

  function startCombat() {
    turn.mode = "combat";
    run.stats.rounds++;
    turn.reaction = 1; turn.reacted.clear();
    const rolls = [];
    const pcRoll = roll("pc", "perception", content.pc.perception, 0);
    dice(`Initiative — ${content.pc.name}`, initiativeMath(pcRoll), DEG.SUCC);
    rolls.push({ key: "pc", total: pcRoll.total, isPC: true });
    for (const c of awake()) {
      const r = roll(c, "perception", def(c).perception, 0);
      dice(`Initiative — ${def(c).name}`, initiativeMath(r), DEG.SUCC);
      rolls.push({ key: c.key, total: r.total, isPC: false });
    }
    rolls.sort((a, b) => b.total - a.total || (a.isPC ? -1 : 1)); // PC wins ties
    turn.queue = rolls.map(r => r.key);
    turn.idx = -1;
    emit({ type: "mode", mode: "combat" });
    advance();
  }

  /**
   * A woken creature that cannot see the PC at the end of the PC's turn loses
   * interest, settles, and reknits to full HP.
   *
   * The full heal is the anti-cheese: without it, "wake it, hit it twice, step
   * behind a pillar, repeat" grinds any creature down at zero risk. With it,
   * breaking line of sight is an escape rather than an exploit, and the four
   * wall blocks flanking the pillars become cover worth using.
   */
  function checkDisengage() {
    let any = false;
    for (const c of awake()) {
      if (world.hasLoS(c.x, c.y, run.pc.x, run.pc.y, run.gateOpen)) continue;
      c.awake = false;
      c.hp = def(c).hp;
      // It reknits to full HP; it reknits out of whatever was stuck to it too.
      // A construct that walks away burning and comes back at full HP still
      // burning is the one shape neither rule was arguing for.
      for (const cond of c.conditions) noteEnd(c, cond.id, "it settles back into stone");
      c.conditions = [];
      narrative(def(c).sleepLine.replace("{name}", def(c).name));
      emit({ type: "slept", key: c.key });
      any = true;
    }
    if (any && !awake().length && turn.mode === "combat") endCombat("lost");
  }

  function endCombat(why) {
    turn.mode = "explore";
    turn.queue = []; turn.idx = 0; turn.actions = 3; turn.attacks = 0;
    turn.acting = null;
    turn.reaction = 1; turn.reacted.clear();
    // Every duration in this engine is measured in turn boundaries, and there
    // are none outside an encounter: a frightened PC would stay frightened
    // across the whole delve and a burning sentinel would burn forever, both
    // because the clock they tick against stopped. So the encounter ending
    // ends them, out loud (locked #137).
    for (const cond of run.pc.conditions) noteEnd("pc", cond.id, "the encounter ends");
    run.pc.conditions = [];
    for (const c of living()) {
      for (const cond of c.conditions) noteEnd(c, cond.id, "the encounter ends");
      c.conditions = [];
    }
    if (why === "cleared") narrative("Silence returns to the vault.");
    emit({ type: "mode", mode: "explore" });
    setHint(run.gateOpen ? content.gate.openHint : "The way is clear, for now.");
    // A standing condition, not an event, for the same reason checkTreasure()
    // below already is: a Stride taken mid-fight can land the PC exactly on a
    // stairway, and checkStairs() (by design) refuses to fire while combat is
    // still under way. `turn.mode` is "explore" again as of the top of this
    // function, so this is the first point it is safe to ask.
    if (checkStairs()) return;
    checkTreasure();
  }

  let hint = "";
  function setHint(t) { hint = t; emit({ type: "hint", text: t }); }

  /* ------------------------------------------------------------------ *
   * Turn order                                                         *
   * ------------------------------------------------------------------ */

  /**
   * Move to the next actor.
   *
   * Returns `{ actor: "pc" }` when it is the player's turn, or
   * `{ actor: key, script }` for a creature, where `script` is the list of
   * things it did — strides with their squares, strikes with their rolls — for
   * the renderer to play back. Nothing here sleeps.
   */
  /**
   * Every actor's durations, at one boundary.
   *
   * `boundary` is whose turn is starting or ending; each bag is ticked as its
   * own owner, because the two are different questions. A condition that
   * expires "at the start of your next turn" names an actor, and it can be an
   * actor other than the one wearing it — the Shield cantrip happens to be
   * self-owned, and building only for that case is how the next one arrives
   * broken. A value that wears off does so at the end of the afflicted
   * actor's own turn and nowhere else.
   */
  function boundary(who, when) {
    for (const actor of ["pc", ...living()]) {
      const owner = actor === "pc" ? "pc" : actor.key;
      const { bag, expired } = tick(bagOf(actor), owner, who, when);
      // Unconditionally, not only when something expired: a value that decays
      // from 2 to 1 produces a new bag and an empty `expired` list, and an
      // assignment guarded on that list is a frightened 2 that never becomes a
      // frightened 1. It read as working — the condition was there, the chip
      // was there, the penalty was there — and only the number was frozen.
      setBag(actor, bag);
      for (const e of expired) noteEnd(actor, e.id, e.why === "decayed" ? null : "its duration runs out");
    }
  }

  /**
   * The end of one actor's turn: persistent damage, then durations.
   *
   * Persistent damage first because it can kill, and a creature that dies to
   * the fire it is standing in should not first have the fire tick down. The
   * flat check that ends it is the one d20 in this file that does not go
   * through `roll` — a flat check takes no modifiers (Player Core p.409), and
   * routing it through the funnel would let a frightened creature burn longer,
   * which is not a rule anybody wrote.
   */
  function endOfTurn(who) {
    const actor = who === "pc" ? "pc" : byKey(who);
    if (!actor) return;
    for (const p of persistentIn(bagOf(actor))) {
      if (run.outcome || turn.mode !== "combat") break;
      if (actor !== "pc" && actor.dead) break;
      const dmg = rollDamage(p.damage, rng);
      const name = CONDITIONS[p.id].name.toLowerCase();
      if (actor === "pc") hurtPC(dmg.total, `${name}: ${dmg.math}`, p.dtype, null);
      else hurtCreature(actor, dmg.total, `${name}: ${dmg.math}`, p.dtype, null);
      if (actor !== "pc" && actor.dead) break;
      const nat = die(20, rng);
      const beat = nat >= p.flatDC;
      dice(`${nameOf(actor)} — flat check to end ${name}`,
        `d20(${nat}) vs DC ${p.flatDC}`, beat ? DEG.SUCC : DEG.FAIL);
      if (beat) endCondition(actor, p.id, "the flames gutter out");
    }
    boundary(who, "end");
  }

  function advance() {
    if (turn.mode !== "combat") return null;
    // The turn that is finishing, before the one that is starting. This is the
    // only place in the engine a duration moves, and `turn.acting` is the only
    // reason it can be: by the time `idx` has moved, whose turn just ended is
    // no longer a question the queue can answer.
    if (turn.acting) { const done = turn.acting; turn.acting = null; endOfTurn(done); }
    if (turn.mode !== "combat" || run.outcome) return null;
    if (!awake().length) { endCombat("cleared"); return null; }

    for (let guard = 0; guard <= turn.queue.length + 1; guard++) {
      turn.idx = (turn.idx + 1) % turn.queue.length;
      if (turn.idx === 0) run.stats.rounds++;
      const key = turn.queue[turn.idx];
      if (key === "pc") {
        if (run.outcome) return null;
        turn.actions = 3;
        turn.attacks = 0;
        turn.reaction = 1;          // one reaction, refreshed here and nowhere else
        turn.acting = "pc";
        // Shield lapses here, but as a duration expiring rather than a field
        // being cleared: it is `{ who: "pc", when: "start" }` on an ordinary
        // condition, and this line no longer knows the cantrip exists.
        boundary("pc", "start");
        emit({ type: "turn", actor: "pc" });
        setHint("Your turn: 3 actions. Stride, Strike, or cast.");
        return { actor: "pc" };
      }
      const c = byKey(key);
      if (!c || c.dead || !c.awake) {
        // Dead or settled: drop it from the order rather than skipping it
        // every round forever.
        turn.queue.splice(turn.idx, 1);
        turn.idx--;
        if (!turn.queue.length || !awake().length) { endCombat("cleared"); return null; }
        continue;
      }
      turn.reacted.delete(key);   // this creature's reaction, refreshed
      turn.acting = key;
      boundary(key, "start");
      emit({ type: "turn", actor: key });
      return { actor: key, script: runCreatureTurn(c) };
    }
    return null;
  }

  /**
   * One creature's turn, as steps a caller drains rather than one function
   * that returns when it is over.
   *
   * This is the shape change the reaction bus needed. A Stride used to assign
   * the creature's final square in one statement, which left no instant at
   * which anything could say "wait": the creature was beside you, then it was
   * across the room, and the two facts had no moment between them. It walks
   * square by square now, and every square is a point at which the bus can
   * fire and, if the reaction kills it, the turn stops there — with the stride
   * step carrying only the squares it actually crossed.
   *
   * The script keeps its old shape on purpose. ui.js reads nothing out of it
   * (it paces a redraw and reads the log), and the phase's rule was that the
   * renderer must not have to change to *see* a reaction, only to animate one.
   * A renderer that later wants to animate one has the `{type:"reaction"}`
   * listener event, which carries the actor and the command; the script stays
   * strides and strikes.
   */
  function* creatureTurn(c) {
    let actions = 3, attacks = 0;
    const d = def(c);

    while (actions > 0 && !c.dead && !run.outcome) {
      if (isAdjacent(c, run.pc)) {
        actions--;
        const pen = mapPenalty(attacks, false);
        attacks++;
        // Before the roll, not after: a reaction on this trigger is answering
        // the swing, and it has to land while the swing is still in the air.
        announceStrike(c, "pc");
        if (c.dead || run.outcome) return;
        const ac = pcAC();
        const r = roll(c, "attack", d.attackBonus - pen, ac);
        dice(`${d.name} — ${d.attackName} vs ${content.pc.name} (AC ${ac})`, r.math, r.deg);
        const step = { kind: "strike", target: "pc", deg: r.deg };
        if (r.deg >= DEG.SUCC) {
          const dmg = rollDamage(d.damage, rng);
          let total = dmg.total, math = dmg.math;
          if (r.deg === DEG.CRIT_SUCC) { total *= 2; math += ` ×2 (crit) = ${total}`; }
          // What the defender actually took, which is not what was rolled
          // once anything on incoming-damage has had its say.
          step.damage = hurtPC(total, math, d.damageType, c);
        }
        applyInflict(d.inflicts, "pc", r.deg);
        yield step;
        continue;
      }

      // Stride toward the closest open square beside the PC. The planner is
      // world.planApproach so that the suite walks the engine's own, not a copy.
      const leg = world.planApproach(c, run.pc, d.speed, pathOpts(c.key));
      if (!leg) break;                       // boxed in: end the turn
      actions--;

      // Square by square. The creature's own position is the truth at every
      // step, so a reaction that fires halfway across the floor is measured
      // against where it actually stands.
      const walked = [{ x: c.x, y: c.y }];
      let cutShort = false;
      for (let i = 1; i < leg.length; i++) {
        const from = { x: c.x, y: c.y };
        c.x = leg[i].x; c.y = leg[i].y;
        walked.push({ x: c.x, y: c.y });
        announceStep(c, from, { x: c.x, y: c.y });
        if (c.dead || run.outcome) { cutShort = true; break; }
      }
      const feet = leg[walked.length - 1].g;
      info(`${d.name} Strides ${feet} ft.`);
      yield { kind: "stride", path: walked };
      if (cutShort) return;
    }
  }

  /** Drain a creature's turn into the playback script advance() hands back. */
  function runCreatureTurn(c) {
    const script = [];
    for (const step of creatureTurn(c)) script.push(step);
    return script;
  }

  /** The player ends their turn. Disengage is checked here and nowhere else. */
  function endTurn() {
    if (turn.mode !== "combat") return null;
    checkDisengage();
    if (turn.mode !== "combat") return null;
    return advance();
  }

  const isPCTurn = () => turn.mode !== "combat" || turn.queue[turn.idx] === "pc";

  /* ------------------------------------------------------------------ *
   * Movement                                                           *
   * ------------------------------------------------------------------ */

  /**
   * Walk the PC toward (tx, ty).
   *
   * In exploration the walk is free and stops the moment something notices.
   * In an encounter it costs one Stride per Speed's worth of feet, refuses if
   * that is more actions than are left, and still stops on a trigger.
   */
  function walkTo(tx, ty) {
    if (run.outcome) return { ok: false, reason: "over" };
    if (!isPCTurn()) return { ok: false, reason: "not-your-turn" };
    if (!explored.has(tx + "," + ty)) {
      setHint("You can't see a path into the dark.");
      return { ok: false, reason: "unexplored" };
    }
    const path = world.findPath(run.pc.x, run.pc.y, tx, ty, pathOpts("pc"));
    if (!path || path.length < 2) {
      setHint("No path — the way is blocked.");
      return { ok: false, reason: "no-path" };
    }
    const feet = path[path.length - 1].g;

    if (turn.mode === "combat") {
      const strides = stridesFor(feet, content.pc.speed);
      if (strides > turn.actions) {
        setHint(`Too far: ${feet} ft needs ${strides} actions (you have ${turn.actions}).`);
        return { ok: false, reason: "too-far", feet, strides };
      }
      turn.actions -= strides;
      info(`Stride ×${strides} — ${feet} ft of movement (Speed ${content.pc.speed}).`);
    }

    // Walk it square by square so a trigger fires where it actually happens.
    const walked = [{ x: run.pc.x, y: run.pc.y }];
    let stoppedBy = null;
    for (let i = 1; i < path.length; i++) {
      const from = { x: run.pc.x, y: run.pc.y };
      run.pc.x = path[i].x; run.pc.y = path[i].y;
      walked.push({ x: path[i].x, y: path[i].y });
      // Leaving a square something threatened is a trigger, and it fires here
      // rather than at the end of the walk: which square the PC left is the
      // whole question, and the end of a three-square Stride has forgotten it.
      announceStep("pc", from, { x: run.pc.x, y: run.pc.y });
      if (run.outcome) { stoppedBy = "interrupted"; break; }
      recomputeVision();
      const trig = checkTriggers();
      if (trig) { stoppedBy = trig; break; }
    }
    recomputeVision();
    emit({ type: "moved", path: walked, stoppedBy });
    const spent = turn.mode === "combat" && turn.actions === 0;
    return { ok: true, path: walked, stoppedBy, exhausted: spent };
  }

  /**
   * Is the PC standing on the casket with nothing left guarding it?
   *
   * Called on every step, and also whenever a creature dies or an encounter
   * ends, because the winning condition is a standing state rather than an
   * event. The treasure chamber is four squares by four and two of them are the
   * casket, so a player who kills the Keeper while standing on the lid is the
   * common case, not the corner case. Checking this only on movement — which is
   * what it did first — left a third of the balance harness's runs finishing the
   * fight, standing on the prize, and never being told they had won.
   */
  function checkTreasure() {
    if (run.outcome) return null;
    if (area.tiles[run.pc.y][run.pc.x] !== TILE.TREASURE) return null;
    const guarded = content.treasure.requiresDown
      .some(id => run.creatures.some(c => c.creature === id && !c.dead));
    if (guarded) {
      setHint(content.treasure.blockedHint);
      return "treasure-blocked";
    }
    finish("victory");
    return "victory";
  }

  /**
   * Take the stairs, if the PC is standing on one.
   *
   * Only outside an encounter — leaving mid-fight is not a move the engine
   * offers a way to trigger by accident, since the only way onto a stairway
   * square during combat would be a Stride that also happened to end a fight,
   * and a creature disengaging when its target vanishes into another area is
   * a state nothing downstream is built to describe.
   */
  function checkStairs() {
    if (run.outcome || turn.mode === "combat") return null;
    const dest = area.stairs[run.pc.x + "," + run.pc.y];
    if (!dest) return null;
    transitionTo(dest);
    return "transitioned";
  }

  /**
   * Move the PC to another area.
   *
   * The current area's fog is banked under its own id in `run.fog` before the
   * switch, `area` and `world` are reassigned so every closure in this module
   * that reads them sees the new area on its next call, and vision is
   * recomputed fresh from the arrival square.
   */
  function transitionTo(dest) {
    const from = area;
    run.fog[from.id] = packExplored(explored, from.width, from.height);

    area = content.areas[dest.area];
    world = makeWorld(area);
    run.areaId = area.id;
    run.pc.x = dest.x;
    run.pc.y = dest.y;
    explored = unpackExplored(run.fog[area.id], area.width, area.height);
    visible = new Set();

    narrative(`— ${area.name} —`);
    recomputeVision();
    emit({ type: "area", areaId: area.id });
    checkTreasure();
  }

  /**
   * Everything that can happen because the PC is standing somewhere new.
   * Returns a reason string if the walk should stop here.
   */
  function checkTriggers() {
    for (const c of run.creatures) {
      if (c.area !== run.areaId) continue;
      if (!c.dead && !c.awake && notices(c)) { wake(c); return "noticed"; }
    }
    const stairs = checkStairs();
    if (stairs) return stairs;
    return checkTreasure();
  }

  /* ------------------------------------------------------------------ *
   * Pillars and the gate                                               *
   * ------------------------------------------------------------------ */
  function readPillar(x, y) {
    const loreId = area.pillars[x + "," + y];
    if (!loreId) return { ok: false, reason: "not-a-pillar" };
    if (feetBetween(run.pc.x, run.pc.y, x, y) > 5) {
      setHint("Move adjacent to the pillar to read it.");
      return { ok: false, reason: "too-far" };
    }
    if (run.loreRead.includes(loreId)) {
      info("You have already read this pillar.");
      return { ok: false, reason: "already-read" };
    }
    run.loreRead.push(loreId);
    const l = content.lore[loreId];
    if (l.logLine) narrative(l.logLine);
    emit({ type: "lore", lore: l });
    maybeOpenGate();
    return { ok: true, lore: l };
  }

  function maybeOpenGate() {
    if (run.gateOpen) return false;
    const need = content.gate.requiresLore;
    if (!need.length || !need.every(id => run.loreRead.includes(id))) return false;
    run.gateOpen = true;
    narrative(content.gate.openNarrative);

    // The seal's release is also the adventure's only rest. It exists so the
    // Keeper beyond the gate is a fight the player arrives at with spells, not
    // a fight they lose because they spent them on the way in.
    const restored = [];
    if (content.gate.restore.includes("slots") && run.pc.slots < content.pc.slots) {
      run.pc.slots = content.pc.slots; restored.push("slots");
    }
    if (content.gate.restore.includes("focus") && run.pc.focus < content.pc.focus) {
      run.pc.focus = content.pc.focus; restored.push("focus");
    }
    if (content.gate.restore.includes("hp") && run.pc.hp < content.pc.hp) {
      const amount = content.gate.restoreHp ?? content.pc.hp;
      const before = run.pc.hp;
      run.pc.hp = Math.min(content.pc.hp, run.pc.hp + amount);
      push("damage", `→ ${content.pc.name} regains ${run.pc.hp - before} HP`,
        `the seal's rest  |  HP ${run.pc.hp}/${content.pc.hp}`);
      restored.push("hp");
    }
    if (restored.length && content.gate.restoreNarrative) narrative(content.gate.restoreNarrative);

    for (const c of run.creatures) if (c.wakesOn === "gate-opened" && !c.dead) c.wakesOn = "notice";
    recomputeVision();
    setHint(content.gate.openHint);
    emit({ type: "gate", open: true });
    return true;
  }

  function touchGate() {
    if (run.gateOpen) return { ok: true };
    setHint(content.gate.sealedHint);
    info(content.gate.sealedLog);
    return { ok: false };
  }

  /* ------------------------------------------------------------------ *
   * Commands                                                           *
   * ------------------------------------------------------------------ */
  const potionCount = () => run.inventory.filter(i => i.item === "potion").length;

  /** Why a command is unavailable right now, or null if it is fine. */
  function commandBlocked(id) {
    const cmd = content.commandById[id];
    if (!cmd) return "unknown";
    if (run.outcome) return "over";
    // A reaction is spent on somebody else's turn, so it answers to none of
    // the action-economy rules below: not your turn is exactly when it is
    // useful, and it costs no action. What it can run out of is itself.
    if (cmd.kind === "reaction") {
      if (turn.mode !== "combat") return "explore";
      if (turn.reaction < 1) return "reaction-spent";
      if (cmd.requiresShield && !hasCondition(bagOf("pc"), "shielded")) return "no-shield";
      return null;
    }
    if (turn.mode === "combat") {
      if (!isPCTurn()) return "not-your-turn";
      if (turn.actions < cmd.cost) return "actions";
    } else if (cmd.kind !== "consume") {
      return "explore";     // out of combat, only Interact-style commands apply
    }
    if (cmd.spendSlot && run.pc.slots < 1) return "slots";
    if (cmd.spendFocus && run.pc.focus < 1) return "focus";
    if (cmd.consumes && !run.inventory.some(i => i.item === cmd.consumes)) return "supply";
    return null;
  }

  function spend(cmd) {
    if (turn.mode === "combat") turn.actions -= cmd.cost;
    if (cmd.spendSlot) run.pc.slots--;
    if (cmd.spendFocus) run.pc.focus--;
    if (cmd.consumes) {
      const i = run.inventory.findIndex(it => it.item === cmd.consumes);
      if (i >= 0) run.inventory.splice(i, 1);
    }
  }

  /**
   * Run a command. `target` is a creature key for attack/unerring, or {x,y}
   * for a cone. Returns { ok, reason } — a refusal never mutates anything.
   */
  function useCommand(id, target) {
    // A reaction is not an action, and there is no button that spends one. It
    // fires from the bus at one of the three named points or it does not fire,
    // which is what stops a player Reactive Striking on their own turn.
    const known = content.commandById[id];
    if (known && known.kind === "reaction") return { ok: false, reason: "reaction-only" };
    const blocked = commandBlocked(id);
    if (blocked) return { ok: false, reason: blocked };
    const cmd = content.commandById[id];

    if (cmd.kind === "attack") {
      const c = byKey(target);
      if (!c || c.dead) return { ok: false, reason: "no-target" };
      if (!isAdjacent(c, run.pc)) { setHint("Not adjacent — Stride closer first."); return { ok: false, reason: "range" }; }
      spend(cmd);
      const pen = mapPenalty(turn.attacks, cmd.agile);
      turn.attacks++;
      announceStrike("pc", c);
      // A reaction can end the swing before it is rolled — by killing its
      // target, or by killing you. The action is spent either way.
      if (run.outcome || c.dead) return after(cmd, { ok: true, interrupted: true });
      const ac = acOf(c);
      const r = roll("pc", "attack", cmd.attackBonus - pen, ac);
      dice(`${cmd.name} vs ${def(c).name} (AC ${ac})`, r.math, r.deg);
      if (r.deg >= DEG.SUCC) {
        const dmg = rollDamage(cmd.damage, rng);
        let total = dmg.total, math = dmg.math;
        if (r.deg === DEG.CRIT_SUCC) { total *= 2; math += ` ×2 (crit) = ${total}`; }
        hurtCreature(c, total, math, cmd.damageType, "pc");
      }
      applyInflict(cmd.inflicts, c, r.deg);
      return after(cmd, { ok: true, deg: r.deg });
    }

    if (cmd.kind === "unerring") {
      const c = byKey(target);
      if (!c || c.dead) return { ok: false, reason: "no-target" };
      const feet = feetBetween(run.pc.x, run.pc.y, c.x, c.y);
      if (feet > cmd.rangeFeet || !world.hasLoS(run.pc.x, run.pc.y, c.x, c.y, run.gateOpen)) {
        setHint(`No line of effect within ${cmd.rangeFeet} ft.`);
        return { ok: false, reason: "range" };
      }
      spend(cmd);
      info(`Cast ${cmd.name} (${cmd.costGlyph}${cmd.spendFocus ? ", 1 Focus Point" : ""}) — unerring.`);
      const dmg = rollDamage(cmd.damage, rng);
      hurtCreature(c, dmg.total, dmg.math, cmd.damageType, "pc");
      return after(cmd, { ok: true });
    }

    if (cmd.kind === "cone") {
      if (!target || typeof target.x !== "number") return { ok: false, reason: "no-target" };
      spend(cmd);
      info(`Cast ${cmd.name} (${cmd.costGlyph}${cmd.spendSlot ? ", spends a rank-1 slot" : ""}) — a ${cmd.coneFeet}-foot cone.`);
      // Cone approximation: within range, and within ±45° of the clicked
      // bearing. A true PF2e cone template is a different shape; this is close
      // enough on a 22-square grid and is documented rather than pretended.
      const ang = Math.atan2(target.y - run.pc.y, target.x - run.pc.x);
      const dmg = rollDamage(cmd.damage, rng);
      let hitAny = false;
      for (const c of living()) {
        if (feetBetween(run.pc.x, run.pc.y, c.x, c.y) > cmd.coneFeet) continue;
        let da = Math.atan2(c.y - run.pc.y, c.x - run.pc.x) - ang;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > Math.PI / 4 + 0.01) continue;
        if (!world.hasLoS(run.pc.x, run.pc.y, c.x, c.y, run.gateOpen)) continue;
        hitAny = true;
        // A creature caught in a spell notices the caster, whatever it was doing.
        if (!c.awake) wake(c);
        const r = roll(c, "save", def(c).saves[cmd.save], content.pc.spellDC);
        dice(`${def(c).name} — basic ${cmd.save === "ref" ? "Reflex" : cmd.save} save`, r.math, r.deg);
        const dealt = basicSaveDamage(r.deg, dmg.total);
        if (dealt > 0) {
          hurtCreature(c, dealt, `${dmg.math} → ${DEG_NAME[r.deg]} → ${dealt}`, cmd.damageType, "pc");
        } else {
          push("damage", `→ ${def(c).name} takes no damage`, "critical success on the save");
        }
        // "crit-fail" reads the target's own save, not the caster's roll: this
        // is the one shape where the degree that matters belongs to the
        // creature the effect landed on.
        applyInflict(cmd.inflicts, c, r.deg);
      }
      if (!hitAny) info("The flames scorch empty stone — no creature in the cone.");
      return after(cmd, { ok: true });
    }

    if (cmd.kind === "self-buff") {
      spend(cmd);
      // The value is the pack's own acBonus, so a pack that writes a +2 disc
      // gets a +2 disc without this line or conditions.js knowing the number.
      // `until` is the whole of "lasts until the start of your next turn" —
      // the boundary code in advance() takes it from here.
      applyCondition("pc", "shielded", cmd.acBonus || 1, { who: "pc", when: "start" });
      info(`Cast ${cmd.name} (${cmd.costGlyph}) — AC ${content.pc.ac} → ${pcAC()} until your next turn.`);
      return after(cmd, { ok: true });
    }

    if (cmd.kind === "self-heal" || cmd.kind === "consume") {
      spend(cmd);
      info(turn.mode === "combat" && cmd.kind === "consume"
        ? `Interact (${cmd.costGlyph}): ${cmd.name.toLowerCase()}.`
        : `${cmd.name}.`);
      const h = rollDamage(cmd.healing, rng);
      healPC(h.total, h.math);
      return after(cmd, { ok: true });
    }

    return { ok: false, reason: "unhandled" };
  }

  /** Shared tail: an action that used the last action ends the turn. */
  function after(cmd, result) {
    emit({ type: "acted", command: cmd.id });
    if (turn.mode === "combat" && turn.actions <= 0 && !run.outcome) {
      result.turnEnded = true;
      result.next = endTurn();
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Inventory                                                          *
   * ------------------------------------------------------------------ */
  function bulkCarried() {
    let whole = 0, lights = 0;
    for (const slotted of run.inventory) {
      const it = content.items[slotted.item];
      if (!it) continue;
      if (it.bulk === "L") lights++; else whole += it.bulk;
    }
    // 10 Light items make 1 Bulk (Player Core p.271). The leftover tenths are
    // shown so the readout moves when you pick something up; encumbrance uses
    // the whole number.
    return { exact: whole + lights / 10, forEncumbrance: whole + Math.floor(lights / 10) };
  }

  function moveItem(fromSlot, toSlot) {
    const item = run.inventory.find(i => i.slot === fromSlot);
    if (!item) return false;
    if (toSlot < 0 || toSlot >= content.inventorySlots) return false;
    const occupant = run.inventory.find(i => i.slot === toSlot);
    if (occupant) occupant.slot = fromSlot;
    item.slot = toSlot;
    return true;
  }

  function dropItem(fromSlot) {
    const i = run.inventory.findIndex(it => it.slot === fromSlot);
    if (i < 0) return false;
    info(`Discarded: ${content.items[run.inventory[i].item].name}.`);
    run.inventory.splice(i, 1);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Boot                                                               *
   * ------------------------------------------------------------------ */
  function begin() {
    recomputeVision();
    // A save could in principle land the PC exactly on a stairway (mid-combat
    // autosave, or a hand-built state in a test) with nothing awake to trigger
    // a re-check of it. checkStairs() re-runs recomputeVision() for the new
    // area itself when it fires, so nothing here needs to know which area it
    // ends up looking at next.
    checkStairs();
    // A save can have been written with the PC already standing on an unguarded
    // casket — the win is a standing state, so booting has to look at it too.
    checkTreasure();
    if (run.outcome) { emit({ type: "mode", mode: "over" }); return; }
    // A restored save can land mid-encounter. Rather than trying to rebuild a
    // half-finished round, initiative is re-rolled: the creatures that were
    // awake are still awake, still hurt, still where they stood.
    if (awake().length) startCombat();
    else emit({ type: "mode", mode: turn.mode });
  }

  return {
    content, run, turn,
    // world and area are getters, not plain fields, because transitionTo()
    // reassigns both when the PC takes a stairway — a plain field captured
    // once at construction would still point at the area the PC left.
    get world() { return world; },
    get area() { return area; },

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    begin,

    // queries
    get mode() { return run.outcome ? "over" : turn.mode; },
    get hint() { return hint; },
    get visible() { return visible; },
    get explored() { return explored; },
    get actionsLeft() { return turn.mode === "combat" ? turn.actions : 3; },
    get shielded() { return hasCondition(bagOf("pc"), "shielded"); },
    conditionsOf, modifiersFor,
    get reactionLeft() { return turn.reaction > 0; },
    lastTrigger: event => lastByEvent.get(event) || null,
    reachOf,
    get currentActor() { return turn.mode === "combat" ? turn.queue[turn.idx] : null; },
    pcAC, isPCTurn, creatureAt, byKey, def, living, awake, occupied,
    potionCount, bulkCarried, commandBlocked,
    isPillar: (x, y) => !!area.pillars[x + "," + y],
    tileAt: (x, y) => area.tiles[y]?.[x],
    mapPenaltyNow: agile => mapPenalty(turn.attacks, agile),

    // actions
    walkTo, useCommand, endTurn, advance, readPillar, touchGate,
    moveItem, dropItem, setHint,

    // for the save layer
    snapshot() {
      // packBag() drops an empty bag rather than writing `conditions: []`, so
      // a run with nothing stuck to anybody writes the same save this game
      // wrote before conditions existed. Additive means additive.
      const packed = o => {
        const out = { ...o };
        const bag = packBag(o.conditions);
        if (bag) out.conditions = bag; else delete out.conditions;
        return out;
      };
      return {
        ...run,
        log: run.log.slice(-LOG_SAVED),
        creatures: run.creatures.map(packed),
        pc: packed(run.pc),
        inventory: run.inventory.map(i => ({ ...i })),
        stats: { ...run.stats },
        // A fresh object, not the live one — run.fog keeps mutating after this
        // is handed to the save layer, and an aliased object would let a later
        // move rewrite a snapshot an autosave has not flushed yet.
        fog: { ...run.fog },
      };
    },
  };
}
